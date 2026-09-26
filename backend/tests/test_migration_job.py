"""The `project_migrate` job and the registry's copy-first hooks (foundation spec §11.2, §11.3)."""

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
from app.migration import backup
from app.migration import job as migration_job
from app.migration.pipeline import Step
from app.migration.state import MigrationStates


def _rename(ctx):
    ctx.session.execute(text("UPDATE project SET name = name || ' (upgraded)'"))
    return {"renamed": 1}


def _states(app) -> MigrationStates:
    return MigrationStates(app.state.settings.data_dir)


def _submit(app, folder):
    return migration_job.submit(app.state.jobs, app.state.projects, folder, "p-legacy")


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
    done = wait_library_job(client, _submit(app, folder).id)
    assert done["state"] == "failed" and "backed up" in done["error"]
    entry = _states(app).get(folder)
    assert (entry["state"], entry["code"]) == ("failed", "backup_failed")
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
