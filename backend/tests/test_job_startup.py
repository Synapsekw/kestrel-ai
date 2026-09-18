"""Orphan job sweep: rows a previous process left behind can never finish (spec section 10)."""

import threading
import time
from pathlib import Path

from sqlalchemy import select

from app.db.models import Job
from app.jobs.registry import register_job_type
from app.jobs.startup import RESTART_ERROR, sweep_orphans
from app.projects.service import ProjectRegistry

BLOCKED = threading.Event()


@register_job_type("test_sweep_block")
def _blocking_job(ctx):
    BLOCKED.wait(10)
    return {}


def add_jobs(handle, *states: str) -> list[str]:
    """Rows as a killed process would leave them: no runner context anywhere."""
    ids = []
    with handle.session() as s:
        for i, state in enumerate(states):
            job = Job(type="train", state=state, params={}, log_path=f"runs/{i}/job.log")
            s.add(job)
            s.flush()
            ids.append(job.id)
    return ids


def states(handle) -> dict[str, str]:
    with handle.session() as s:
        return {j.id: j.state for j in s.execute(select(Job)).scalars()}


def test_running_jobs_fail_and_queued_jobs_are_cancelled(handle, app):
    running, queued, done = add_jobs(handle, "running", "queued", "succeeded")

    swept = sweep_orphans(handle, app.state.jobs)

    assert {j["id"]: j["state"] for j in swept} == {running: "failed", queued: "cancelled"}
    assert states(handle) == {running: "failed", queued: "cancelled", done: "succeeded"}
    with handle.session() as s:
        row = s.get(Job, running)
        assert row.error == RESTART_ERROR
        assert row.finished_at is not None
        assert s.get(Job, queued).error is None


def test_jobs_of_this_process_are_left_alone(handle, app):
    """Reopening a project while its own jobs run must not kill them."""
    orphan = add_jobs(handle, "running")[0]
    BLOCKED.clear()
    live = app.state.jobs.submit(handle, "test_sweep_block", {})
    try:
        deadline = time.time() + 5
        while states(handle).get(live.id) != "running" and time.time() < deadline:
            time.sleep(0.02)

        swept = sweep_orphans(handle, app.state.jobs)

        assert [j["id"] for j in swept] == [orphan]
        assert states(handle)[live.id] == "running"
    finally:
        BLOCKED.set()


def test_nothing_to_sweep_is_a_no_op(handle, app):
    add_jobs(handle, "succeeded", "failed", "cancelled")
    assert sweep_orphans(handle, app.state.jobs) == []


def test_opening_a_project_in_a_fresh_registry_sweeps_it(handle, app, tmp_path: Path):
    """The sweep runs where a project becomes live: projects open lazily, one at a time."""
    running, queued = add_jobs(handle, "running", "queued")
    registry = ProjectRegistry(tmp_path / "other-appdata", on_open=lambda h: sweep_orphans(h, app.state.jobs))

    reopened = registry.open(handle.folder)

    assert states(reopened) == {running: "failed", queued: "cancelled"}
    registry.close_all()


def test_a_failing_sweep_never_blocks_opening_a_project(handle, tmp_path: Path, caplog):
    """The project is what the operator asked for; a sweep that raises is a log line, not a 500."""

    def boom(_handle):
        raise RuntimeError("sweep exploded")

    registry = ProjectRegistry(tmp_path / "third-appdata", on_open=boom)

    reopened = registry.open(handle.folder)

    assert reopened.folder == handle.folder
    assert "sweep exploded" in caplog.text
    registry.close_all()
