"""The resumable step pipeline (foundation spec §11.4, §16: idempotent, kill between steps, resume)."""

import json
import logging

import pytest
from migration_helpers import legacy_at_head, open_handle
from sqlalchemy import text

from app.jobs.cancellation import JobCancelled
from app.migration.pipeline import REPORT_NAME, MigrationEnv, Step, StepFailed, run_pipeline


def _steps(calls, fail_at=None, cancel_at=None):
    def make(name):
        def run(ctx):
            calls.append(name)
            ctx.session.execute(text("INSERT INTO scratch (name) VALUES (:n)"), {"n": name})
            if name == fail_at:
                raise RuntimeError("the disk is full")
            if name == cancel_at:
                raise JobCancelled()
            return {"wrote": name, "warnings": ["saw something odd"] if name == "b" else []}

        return Step(name, f"Step {name}", run)

    return tuple(make(n) for n in ("a", "b", "c"))


@pytest.fixture
def handle(tmp_path):
    h = open_handle(legacy_at_head(tmp_path / "p"))
    with h.session() as s:
        s.execute(text("CREATE TABLE scratch (name TEXT)"))
    yield h
    h.engine.dispose()


def _env(handle, progress=None, check_cancelled=None):
    return MigrationEnv(
        library=None,
        catalogue=None,
        origin_folder=handle.folder,
        log=logging.getLogger("test.migration"),
        progress=progress or (lambda fraction, message="": None),
        check_cancelled=check_cancelled or (lambda: None),
    )


def _read(handle, sql):
    with handle.session() as s:
        return list(s.execute(text(sql)).scalars())


def test_steps_run_in_order_are_recorded_and_the_project_finishes(handle):
    calls, seen = [], []
    report = run_pipeline(handle, _env(handle, progress=lambda f, m="": seen.append(m)), _steps(calls))
    assert calls == ["a", "b", "c"]
    assert sorted(_read(handle, "SELECT name FROM migration_step")) == ["a", "b", "c", "finish"]
    assert _read(handle, "SELECT schema_version FROM project") == [2]
    assert report["warnings"] == ["b: saw something odd"]
    assert [s["name"] for s in report["steps"]] == ["a", "b", "c"]
    written = json.loads((handle.folder / "backups" / REPORT_NAME).read_text("utf-8"))
    assert written["steps"][1]["detail"]["wrote"] == "b" and written["seconds"] >= 0
    assert seen[:3] == ["Step a", "Step b", "Step c"]


def test_a_failed_step_names_itself_rolls_back_and_stops(handle):
    calls = []
    with pytest.raises(StepFailed) as err:
        run_pipeline(handle, _env(handle), _steps(calls, fail_at="b"))
    assert err.value.step == "b" and err.value.message == "the disk is full"
    assert calls == ["a", "b"]
    assert _read(handle, "SELECT name FROM scratch") == ["a"]  # b's own write rolled back
    assert _read(handle, "SELECT name FROM migration_step") == ["a"]
    assert _read(handle, "SELECT schema_version FROM project") == [1]
    assert not (handle.folder / "backups" / REPORT_NAME).exists()


def test_a_rerun_resumes_at_the_first_unrecorded_step(handle):
    with pytest.raises(StepFailed):
        run_pipeline(handle, _env(handle), _steps([], fail_at="b"))
    calls = []
    report = run_pipeline(handle, _env(handle), _steps(calls))
    assert calls == ["b", "c"]
    assert report["steps"][0] == {"name": "a", "skipped": True}
    assert _read(handle, "SELECT name FROM scratch ORDER BY rowid") == ["a", "b", "c"]


def test_a_cancel_between_steps_resumes_later(handle):
    with pytest.raises(JobCancelled):
        run_pipeline(handle, _env(handle), _steps([], cancel_at="b"))
    calls = []
    run_pipeline(handle, _env(handle), _steps(calls))
    assert calls == ["b", "c"]


def test_cancellation_is_checked_before_every_step(handle):
    checks = []

    def check():
        checks.append(1)
        if len(checks) == 2:
            raise JobCancelled()

    calls = []
    with pytest.raises(JobCancelled):
        run_pipeline(handle, _env(handle, check_cancelled=check), _steps(calls))
    assert calls == ["a"]
