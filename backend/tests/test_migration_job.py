"""The `project_migrate` job and the registry's copy-first hooks (foundation spec §11.2, §11.3)."""

import threading
import time
from pathlib import Path

import pytest
from migration_helpers import (
    HeldStep,
    arm,
    at_revision,
    legacy_at_head,
    revision_of,
    sha256,
    wait_library_job,
)
from sqlalchemy import text

from app.errors import AppError
from app.jobs.registry import register_job_type
from app.migration import backup
from app.migration import job as migration_job
from app.migration.pipeline import Step
from app.migration.state import MigrationStates

EVENTS = "/api/v1/events?token=test-token"


def _rename(ctx):
    ctx.session.execute(text("UPDATE project SET name = name || ' (upgraded)'"))
    return {"renamed": 1}


def _states(app) -> MigrationStates:
    return MigrationStates(app.state.settings.data_dir)


def _submit(app, folder):
    return migration_job.submit(app.state.jobs, app.state.projects, folder, "p-legacy")


def _next_migration_event(ws, job_id: str, *, code: str | None = None, tries: int = 20) -> dict:
    """The next `migration.changed` event for `job_id` (optionally matching `code`), off an open
    websocket: submit and the job's own terminal publish can both name the same job, so a caller
    after a specific one (e.g. the failure) must skip earlier ones (e.g. the running one)."""
    for _ in range(tries):
        ev = ws.receive_json()
        if ev["type"] == "migration.changed" and ev["job_id"] == job_id:
            if code is None or ev["payload"].get("code") == code:
                return ev
    raise AssertionError(f"no migration.changed for job {job_id} (code={code}) within {tries} events")


def test_the_job_runs_the_steps_and_records_ok(app, client, tmp_path, monkeypatch):
    arm(monkeypatch, Step("rename", "Renaming", _rename))
    folder = legacy_at_head(tmp_path / "legacy")
    job = _submit(app, folder)
    done = wait_library_job(client, job.id)
    assert done["state"] == "succeeded", done
    entry = _states(app).get(folder)
    assert (entry["state"], entry["job_id"], entry["project_id"]) == ("ok", job.id, "p-legacy")
    assert entry["report_path"].endswith("migration-v2.json")
    handle = app.state.projects.open(folder, remember=False)
    assert handle.schema_version == 2
    with handle.session() as s:
        assert handle.row(s).name == "Legacy (upgraded)"


def test_disarmed_the_job_only_opens_the_project(app, client, tmp_path, monkeypatch):
    arm(monkeypatch)
    folder = legacy_at_head(tmp_path / "legacy")
    assert wait_library_job(client, _submit(app, folder).id)["state"] == "succeeded"
    assert _states(app).get(folder)["state"] == "ok"
    assert app.state.projects.open(folder, remember=False).schema_version == 1


def test_one_live_job_per_folder_however_it_is_spelled(app, client, tmp_path, monkeypatch):
    held = HeldStep()
    arm(monkeypatch, held.step())
    folder = legacy_at_head(tmp_path / "Legacy")
    try:
        first = _submit(app, folder)
        assert held.entered.wait(10)
        assert _submit(app, Path(str(folder).upper())) is None
    finally:
        held.release.set()
    assert wait_library_job(client, first.id)["state"] == "succeeded"


def test_a_failed_step_flags_the_project_and_a_new_job_resumes(app, client, tmp_path, monkeypatch):
    ran = []

    def first(ctx):
        ran.append("first")
        return {}

    def broken(ctx):
        raise RuntimeError("the disk is full")

    arm(monkeypatch, Step("first", "First", first), Step("second", "Second", broken))
    folder = legacy_at_head(tmp_path / "legacy")
    done = wait_library_job(client, _submit(app, folder).id)
    assert done["state"] == "failed" and "second" in done["error"] and "the disk is full" in done["error"]
    entry = _states(app).get(folder)
    assert (entry["state"], entry["code"], entry["step"]) == ("failed", "step_failed", "second")
    arm(monkeypatch, Step("first", "First", first), Step("second", "Second", lambda ctx: {}))
    assert wait_library_job(client, _submit(app, folder).id)["state"] == "succeeded"
    assert ran == ["first"]  # the recorded step did not run again
    assert _states(app).get(folder)["state"] == "ok"


def test_a_failed_backup_flags_backup_failed_and_touches_nothing(app, client, tmp_path, monkeypatch):
    arm(monkeypatch)
    monkeypatch.setattr(backup, "BACKUP_BEFORE", "0009")
    folder = at_revision(tmp_path / "old", "0008")
    (folder / "backups").write_text("in the way", "utf-8")
    before = sha256(folder / "project.db")
    with client.websocket_connect(EVENTS) as ws:
        job = _submit(app, folder)
        done = wait_library_job(client, job.id)
        assert done["state"] == "failed" and "backed up" in done["error"] and done["result"] is None
        # F7: the entry keeps the live job's id (no job_id=None overwrite), and the registry's own
        # backup_failed flag is still published as a migration.changed event by the job.
        ev = _next_migration_event(ws, job.id, code="backup_failed")
        assert ev["payload"]["state"] == "failed"
    entry = _states(app).get(folder)
    assert (entry["state"], entry["code"], entry["job_id"]) == ("failed", "backup_failed", job.id)
    assert sha256(folder / "project.db") == before and revision_of(folder / "project.db") == "0008"


def test_opening_a_project_whose_backup_fails_is_409_upgrade_failed(app, client, tmp_path, monkeypatch):
    monkeypatch.setattr(backup, "BACKUP_BEFORE", "0009")
    folder = at_revision(tmp_path / "old", "0008")
    (folder / "backups").write_text("in the way", "utf-8")
    with pytest.raises(AppError) as err:
        app.state.projects.open(folder, remember=False)
    assert (err.value.code, err.value.status) == ("project_upgrade_failed", 409)
    assert err.value.details["backup_path"] is None and "backed up" in err.value.details["error"]


def test_without_the_library_nothing_is_submitted(app, client, tmp_path, monkeypatch):
    arm(monkeypatch, Step("rename", "Renaming", _rename))
    monkeypatch.setattr(app.state.jobs, "library", None)
    folder = legacy_at_head(tmp_path / "legacy")
    assert _submit(app, folder) is None
    assert _states(app).get(folder) is None


# --- review fix round 1: queued cancel, mid-pipeline failure/cancel, shutdown, the promoted minors ---

_HOLD = threading.Event()


@register_job_type("mg_test_hold")
def _hold_job(ctx):
    _HOLD.wait(10)
    return None


def test_a_queued_job_cancelled_flags_failed_cancelled_and_is_not_requeued(
    app, client, tmp_path, monkeypatch
):
    """A `project_migrate` job cancelled while still queued behind other work never runs
    `migrate_project`, so only the type's `on_cancelled_before_start` hook can flag it (Important 1)."""
    ran = []
    arm(monkeypatch, Step("rename", "Renaming", lambda ctx: ran.append(1)))
    folder = legacy_at_head(tmp_path / "legacy")
    _HOLD.clear()
    n = app.state.jobs._workers
    holders = [app.state.jobs.submit(app.state.library, "mg_test_hold", {}) for _ in range(n)]
    try:
        job = _submit(app, folder)
        assert job is not None
        cancelled = app.state.jobs.cancel(app.state.library, job.id)
        assert cancelled.state == "cancelled" and not app.state.jobs.is_live(job.id)
    finally:
        _HOLD.set()
    for h in holders:
        wait_library_job(client, h.id)
    entry = _states(app).get(folder)
    assert (entry["state"], entry["code"]) == ("failed", "cancelled")
    assert ran == []  # migrate_project itself never ran
    # A new job for the same folder is not blocked by the dead job id.
    assert _submit(app, folder) is not None


def test_a_failure_finishing_the_upgrade_flags_the_project(app, client, tmp_path, monkeypatch):
    """`finish()` (pipeline.py) runs outside any per-step try; a failure there must still flag the
    project instead of leaving it `pending` for startup to silently re-queue (Important 2)."""
    from app.migration import pipeline as pipeline_module

    def broken_finish(handle, report):
        raise RuntimeError("the disk is full")

    arm(monkeypatch, Step("rename", "Renaming", _rename))
    monkeypatch.setattr(pipeline_module, "finish", broken_finish)
    folder = legacy_at_head(tmp_path / "legacy")
    done = wait_library_job(client, _submit(app, folder).id)
    assert done["state"] == "failed" and "disk is full" in done["error"]
    entry = _states(app).get(folder)
    assert (entry["state"], entry["code"]) == ("failed", "step_failed")


def test_submit_publishes_running_not_pending_while_the_job_is_live(app, client, tmp_path, monkeypatch):
    """C0 derives `running` from a `pending` entry with a live job; the event must agree, not
    report the raw stored `pending` (Important 3)."""
    held = HeldStep()
    arm(monkeypatch, held.step())
    folder = legacy_at_head(tmp_path / "legacy")
    try:
        with client.websocket_connect(EVENTS) as ws:
            job = _submit(app, folder)
            ev = _next_migration_event(ws, job.id)
        assert ev["payload"]["state"] == "running"
        assert held.entered.wait(10)
    finally:
        held.release.set()
    assert wait_library_job(client, job.id)["state"] == "succeeded"


def test_a_cancel_mid_pipeline_flags_failed_cancelled(app, client, tmp_path, monkeypatch):
    """An operator cancel of a *running* upgrade (not a graceful shutdown) still flags
    `failed/cancelled` (Important 4, the non-shutdown branch)."""
    entered = threading.Event()

    def slow(ctx):
        entered.set()
        for _ in range(500):
            ctx.env.check_cancelled()
            time.sleep(0.01)
        return {}

    arm(monkeypatch, Step("slow", "Slow", slow))
    folder = legacy_at_head(tmp_path / "legacy")
    job = _submit(app, folder)
    assert entered.wait(10)
    app.state.jobs.cancel(app.state.library, job.id)
    done = wait_library_job(client, job.id)
    assert done["state"] == "cancelled"
    entry = _states(app).get(folder)
    assert (entry["state"], entry["code"]) == ("failed", "cancelled")


def test_a_shutdown_mid_pipeline_leaves_the_project_pending(app, client, tmp_path, monkeypatch):
    """A graceful app quit mid-upgrade (`begin_shutdown`) is not an operator cancel: the entry is
    left `pending` so the next start resumes it (Important 4, the shutdown branch)."""
    entered = threading.Event()

    def slow(ctx):
        entered.set()
        for _ in range(500):
            ctx.env.check_cancelled()
            time.sleep(0.01)
        return {}

    arm(monkeypatch, Step("slow", "Slow", slow))
    folder = legacy_at_head(tmp_path / "legacy")
    job = _submit(app, folder)
    assert entered.wait(10)
    migration_job.begin_shutdown()
    try:
        app.state.jobs.cancel(app.state.library, job.id)
        done = wait_library_job(client, job.id)
        assert done["state"] == "cancelled"
        entry = _states(app).get(folder)
        assert entry["state"] == "pending"
    finally:
        migration_job.reset_shutdown()


def test_the_project_id_falls_back_to_the_recent_list_then_to_library(app, client, tmp_path):
    """F1: the entry's own `project_id`, else the folder's recent-list id, else `"library"`."""
    folder = tmp_path / "legacy"
    folder.mkdir()
    assert migration_job._project_id_for(app.state.jobs, folder, {"project_id": "p-explicit"}) == "p-explicit"
    assert migration_job._project_id_for(app.state.jobs, folder, {}) == "library"
    app.state.projects.appdata.remember("p-recent", "Legacy", str(folder.resolve()))
    assert migration_job._project_id_for(app.state.jobs, folder, {}) == "p-recent"


def test_the_job_result_has_folder_and_report_path(app, client, tmp_path, monkeypatch):
    """F2: the job result carries C0's `folder`/`report_path` plus the brief's extras."""
    arm(monkeypatch, Step("rename", "Renaming", _rename))
    folder = legacy_at_head(tmp_path / "legacy")
    done = wait_library_job(client, _submit(app, folder).id)
    assert done["state"] == "succeeded"
    result = done["result"]
    assert result["folder"] == str(folder)
    assert result["report_path"].endswith("migration-v2.json")
    assert result["project_id"] == "p-legacy"
    assert result["steps_run"] == 1
    assert result["warnings"] == 0


def test_open_failed_flags_the_project_open_failed(app, client, tmp_path):
    """A folder whose project cannot even be opened (here: no `project.db`) is flagged
    `failed/open_failed`, not left `pending`."""
    folder = tmp_path / "missing"
    folder.mkdir()
    job = migration_job.submit(app.state.jobs, app.state.projects, folder, "p-missing")
    assert job is not None
    done = wait_library_job(client, job.id)
    assert done["state"] == "failed"
    entry = _states(app).get(folder)
    assert (entry["state"], entry["code"]) == ("failed", "open_failed")


def test_a_queued_job_cancelled_by_a_graceful_shutdown_stays_pending(app, client, tmp_path):
    """Final review Minor 1: `JobRunner.stop` cancels every context before draining the queue, so a
    worker can still hand a queued upgrade to the cancelled-before-start hook during a quit. That
    is not the operator's cancel: the entry stays `pending` for the next start to resume."""
    from types import SimpleNamespace

    folder = legacy_at_head(tmp_path / "legacy")
    states = _states(app)
    states.set(folder, state="pending", job_id="job-queued-at-quit", project_id="p-legacy")
    ctx = SimpleNamespace(runner=app.state.jobs, params={"folder": str(folder), "project_id": "p-legacy"})
    migration_job.begin_shutdown()
    try:
        migration_job._cancelled_before_start(ctx)
    finally:
        migration_job.reset_shutdown()
    entry = states.get(folder)
    assert (entry["state"], entry["job_id"], entry.get("code")) == ("pending", "job-queued-at-quit", None)
