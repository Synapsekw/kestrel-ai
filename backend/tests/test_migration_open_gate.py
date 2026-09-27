"""The on-open sweeps wait for a project's upgrade, and the startup probe cannot hold up start-up
(coordinator hand-off 5, foundation spec §11.3)."""

import logging
import threading
import time

import pytest
from fastapi.testclient import TestClient
from migration_helpers import (
    AUTH,
    PID,
    HeldStep,
    arm,
    legacy_at_head,
    set_schema_version,
    wait_library_job,
)

from app.library import adoption
from app.migration import startup as migration_startup
from app.migration.pipeline import Step
from app.migration.state import MigrationStates


def _noop(ctx):
    return {}


def _boom(ctx):
    raise RuntimeError("boom")


@pytest.fixture
def adoption_calls(monkeypatch):
    """Model adoption is the last on-open sweep: record each call as (project id, schema version)."""
    calls = []
    real = adoption.submit_if_pending

    def spy(handle, runner):
        calls.append((handle.id, handle.schema_version))
        return real(handle, runner)

    monkeypatch.setattr(adoption, "submit_if_pending", spy)
    return calls


def _open(client, folder) -> dict:
    r = client.post("/api/v1/projects/open", json={"folder": str(folder)})
    assert r.status_code == 200, r.text
    return r.json()


def test_the_sweeps_wait_for_the_upgrade_and_run_once_after_it(client, tmp_path, monkeypatch, adoption_calls):
    held = HeldStep()
    arm(monkeypatch, held.step())
    try:
        project = _open(client, legacy_at_head(tmp_path / "legacy"))
        job_id = project["migration"]["job_id"]
        assert job_id and held.entered.wait(10)
        # Opened by the API and again by the job's own `registry.open` (a cached handle): no sweep yet.
        _open(client, tmp_path / "legacy")
        assert adoption_calls == []
    finally:
        held.release.set()
    assert wait_library_job(client, job_id)["state"] == "succeeded"
    assert adoption_calls == [(PID, 2)]
    # A later open finds the cached handle: the sweeps do not run a second time.
    _open(client, tmp_path / "legacy")
    assert adoption_calls == [(PID, 2)]


def test_a_project_already_at_version_2_sweeps_on_open(app, client, tmp_path, monkeypatch, adoption_calls):
    arm(monkeypatch, Step("noop", "Noop", _noop))
    folder = legacy_at_head(tmp_path / "current")
    set_schema_version(folder, 2)
    assert _open(client, folder)["migration"]["state"] == "ok"
    assert adoption_calls == [(PID, 2)]
    assert MigrationStates(app.state.settings.data_dir).get(folder) is None


def test_disarmed_a_version_1_project_sweeps_on_open(client, tmp_path, monkeypatch, adoption_calls):
    arm(monkeypatch)
    _open(client, legacy_at_head(tmp_path / "legacy"))
    assert adoption_calls == [(PID, 1)]


def test_a_failed_upgrade_never_runs_the_sweeps(app, client, tmp_path, monkeypatch, adoption_calls):
    arm(monkeypatch, Step("boom", "Boom", _boom))
    folder = legacy_at_head(tmp_path / "legacy")
    _open(client, folder)
    # The job may already have failed by the time the open answers: read its id from the state file.
    job_id = MigrationStates(app.state.settings.data_dir).get(folder)["job_id"]
    assert wait_library_job(client, job_id)["state"] == "failed"
    _open(client, tmp_path / "legacy")
    assert adoption_calls == []


def test_a_slow_startup_probe_does_not_hold_up_start(app, monkeypatch, caplog):
    release = threading.Event()

    def slow(app):
        release.wait(30)
        return []

    monkeypatch.setattr(migration_startup, "submit_pending", slow)
    caplog.set_level(logging.WARNING)
    try:
        started = time.monotonic()
        with TestClient(app, headers=AUTH) as c:
            elapsed = time.monotonic() - started
            assert elapsed < migration_startup.SUBMIT_PENDING_TIMEOUT + 1.5, elapsed
            assert c.get("/api/v1/health").status_code == 200
    finally:
        release.set()
    assert "still running" in caplog.text


def test_a_failing_startup_probe_does_not_stop_start(app, monkeypatch, caplog):
    def broken(app):
        raise RuntimeError("probe exploded")

    monkeypatch.setattr(migration_startup, "submit_pending", broken)
    with TestClient(app, headers=AUTH) as c:
        assert c.get("/api/v1/health").status_code == 200
    assert "probe exploded" in caplog.text
