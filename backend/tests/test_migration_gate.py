"""No project route runs on half-migrated data (foundation spec §11.3, §15)."""

import pytest
from fastapi.testclient import TestClient
from migration_helpers import (
    AUTH,
    HeldStep,
    add_ledger_table,
    arm,
    at_revision,
    legacy_at_head,
    set_schema_version,
    wait_library_job,
)

from app.appdata import AppData
from app.migration import backup
from app.migration.gate import migration_state
from app.migration.pipeline import Step
from app.migration.state import MigrationStates


def _noop(ctx):
    return {}


def _boom(ctx):
    raise RuntimeError("boom")


def _make_legacy(handle):
    set_schema_version(handle.folder, 1)
    add_ledger_table(handle.folder)
    handle.schema_version = 1


@pytest.fixture
def held(client, monkeypatch):
    h = HeldStep()
    arm(monkeypatch, h.step())
    yield h
    h.release.set()


def test_disarmed_a_version_1_project_opens(client, project_id, handle, monkeypatch):
    arm(monkeypatch)
    _make_legacy(handle)
    assert client.get(f"/api/v1/projects/{project_id}").status_code == 200


def test_an_upgrading_project_answers_409_until_the_job_finishes(client, project_id, handle, held):
    _make_legacy(handle)
    r = client.get(f"/api/v1/projects/{project_id}")
    assert r.status_code == 409 and r.json()["error"]["code"] == "project_upgrading"
    job_id = r.json()["error"]["details"]["job_id"]
    assert job_id and held.entered.wait(10)
    again = client.get(f"/api/v1/projects/{project_id}/stats")
    assert again.status_code == 409 and again.json()["error"]["details"]["job_id"] == job_id
    held.release.set()
    assert wait_library_job(client, job_id)["state"] == "succeeded"
    assert client.get(f"/api/v1/projects/{project_id}").status_code == 200


def test_a_failed_upgrade_answers_409_with_the_error_and_is_not_rerun(
    app, client, project_id, handle, monkeypatch
):
    _make_legacy(handle)
    arm(monkeypatch, Step("boom", "Boom", _boom))
    job_id = client.get(f"/api/v1/projects/{project_id}").json()["error"]["details"]["job_id"]
    assert wait_library_job(client, job_id)["state"] == "failed"
    r = client.get(f"/api/v1/projects/{project_id}")
    assert r.status_code == 409 and r.json()["error"]["code"] == "project_upgrade_failed"
    details = r.json()["error"]["details"]
    assert "boom" in details["error"] and "backup_path" in details
    assert MigrationStates(app.state.settings.data_dir).get(handle.folder)["job_id"] == job_id


def test_without_the_library_the_project_waits(app, client, project_id, handle, monkeypatch):
    _make_legacy(handle)
    arm(monkeypatch, Step("noop", "Noop", _noop))
    monkeypatch.setattr(app.state.jobs, "library", None)
    r = client.get(f"/api/v1/projects/{project_id}")
    assert r.status_code == 409 and r.json()["error"]["code"] == "project_upgrading"
    assert r.json()["error"]["details"] == {"job_id": None}
    assert "model library" in r.json()["error"]["message"]


def test_opening_a_legacy_folder_queues_its_upgrade(app, client, tmp_path, monkeypatch):
    arm(monkeypatch, Step("noop", "Noop", _noop))
    folder = legacy_at_head(tmp_path / "legacy")
    assert client.post("/api/v1/projects/open", json={"folder": str(folder)}).status_code == 200
    entry = MigrationStates(app.state.settings.data_dir).get(folder)
    assert entry and entry["job_id"]
    assert wait_library_job(client, entry["job_id"])["state"] == "succeeded"


def test_startup_queues_every_recent_project_below_version_2(app, settings, tmp_path, monkeypatch):
    arm(monkeypatch, Step("noop", "Noop", _noop))
    legacy = legacy_at_head(tmp_path / "legacy")
    current = legacy_at_head(tmp_path / "current", pid="p-current")
    set_schema_version(current, 2)
    recent = AppData(settings.data_dir)
    recent.remember("p-current", "Current", str(current))
    recent.remember("p-legacy", "Legacy", str(legacy))
    with TestClient(app, headers=AUTH) as c:
        states = MigrationStates(settings.data_dir)
        entry = states.get(legacy)
        assert entry and entry["job_id"]
        assert states.get(current) is None
        assert wait_library_job(c, entry["job_id"])["state"] == "succeeded"


def test_an_upgrade_the_last_run_left_unfinished_is_queued_again(app, settings, tmp_path, monkeypatch):
    arm(monkeypatch, Step("noop", "Noop", _noop))
    folder = legacy_at_head(tmp_path / "legacy")
    AppData(settings.data_dir).remember("p-legacy", "Legacy", str(folder))
    MigrationStates(settings.data_dir).set(folder, state="pending", job_id="job-from-the-last-run")
    with TestClient(app, headers=AUTH) as c:
        entry = MigrationStates(settings.data_dir).get(folder)
        assert entry["job_id"] != "job-from-the-last-run"
        assert wait_library_job(c, entry["job_id"])["state"] == "succeeded"


def test_startup_leaves_a_failed_project_for_retry(app, settings, tmp_path, monkeypatch):
    arm(monkeypatch, Step("noop", "Noop", _noop))
    folder = legacy_at_head(tmp_path / "legacy")
    AppData(settings.data_dir).remember("p-legacy", "Legacy", str(folder))
    MigrationStates(settings.data_dir).set(folder, state="failed", code="step_failed", error="x", job_id=None)
    with TestClient(app, headers=AUTH):
        assert MigrationStates(settings.data_dir).get(folder)["job_id"] is None


def test_a_broken_recent_entry_never_stops_startup(app, settings, tmp_path, monkeypatch):
    arm(monkeypatch, Step("noop", "Noop", _noop))
    broken = tmp_path / "broken"
    broken.mkdir()
    (broken / "project.db").write_bytes(b"not a database" * 64)
    AppData(settings.data_dir).remember("p-broken", "Broken", str(broken))
    with TestClient(app, headers=AUTH) as c:
        assert c.get("/api/v1/health").status_code == 200
        # F13: the broken folder's own entry is flagged, not just "the app still answers".
        states = MigrationStates(settings.data_dir)
        entry = states.get(broken)
        assert entry and entry["job_id"]
        assert wait_library_job(c, entry["job_id"])["state"] == "failed"
        assert states.get(broken)["code"] == "open_failed"


# --- controller rulings ---------------------------------------------------------------------


def test_require_ready_never_reads_migrations_json_when_disarmed(client, project_id, handle, monkeypatch):
    """F9 (bounded hot path): require_ready must answer a request for a project that is disarmed
    or already at the target schema without ever reading migrations.json. Every project-scoped
    request goes through get_project -> require_ready, so this must stay a cheap, file-free check.
    """
    arm(monkeypatch)  # disarmed

    from app.migration import gate as gate_module

    def _boom(registry):
        raise AssertionError("require_ready read migrations.json while disarmed")

    monkeypatch.setattr(gate_module, "states_for", _boom)
    assert client.get(f"/api/v1/projects/{project_id}").status_code == 200
    assert client.get(f"/api/v1/projects/{project_id}/stats").status_code == 200


def test_require_ready_never_reads_migrations_json_once_at_the_target_schema(
    client, project_id, handle, monkeypatch
):
    """Same F9 guarantee, armed this time: a project already at schema_version 2 must not pay for
    a state-file read either."""
    arm(monkeypatch, Step("noop", "Noop", _noop))
    handle.schema_version = 2

    from app.migration import gate as gate_module

    def _boom(registry):
        raise AssertionError("require_ready read migrations.json at the target schema")

    monkeypatch.setattr(gate_module, "states_for", _boom)
    assert client.get(f"/api/v1/projects/{project_id}").status_code == 200


def test_a_real_backup_is_reported_before_any_migration_job_records_one(client, tmp_path, monkeypatch):
    """F6: migration_state falls back to the newest real backup on disk when migrations.json has
    none recorded yet. The project's Alembic upgrade (in open_project_db) already took one; the
    project_migrate job submitted on open (Task 6) has not reached its own backup_path bookkeeping
    yet because its one step is held. Uses the Task 1 test pattern: BACKUP_BEFORE patched to a
    revision this build actually has, and the project built at the revision just before it."""
    monkeypatch.setattr(backup, "BACKUP_BEFORE", "0009")
    folder = at_revision(tmp_path / "old", "0008")
    add_ledger_table(folder)
    held = HeldStep()
    arm(monkeypatch, held.step())
    try:
        handle = client.app.state.projects.open(folder, remember=False)
        assert handle.schema_version == 1
        assert held.entered.wait(10)
        found = backup.latest_backup(folder)
        assert found is not None
        state = migration_state(handle, client.app.state.jobs)
        assert state["state"] == "running"
        assert state["backup_path"] == str(found)
        entry = MigrationStates(client.app.state.settings.data_dir).get(folder)
        assert entry.get("backup_path") is None  # not yet recorded by the job itself
    finally:
        held.release.set()
    entry = MigrationStates(client.app.state.settings.data_dir).get(folder)
    assert wait_library_job(client, entry["job_id"])["state"] == "succeeded"
