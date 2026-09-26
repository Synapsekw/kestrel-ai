"""GET /projects never fails for one project; Retry (foundation spec §9.2, §11.3, §15)."""

import threading

import pytest
from migration_helpers import (
    HeldStep,
    arm,
    at_revision,
    legacy_at_head,
    revision_of,
    set_schema_version,
    sha256,
    wait_library_job,
)

from app.migration import backup
from app.migration import job as migration_job
from app.migration.backup import latest_backup
from app.migration.pipeline import Step
from app.migration.state import MigrationStates

RETRY = "/api/v1/projects/migrations/retry"
REVEAL = "/api/v1/projects/migrations/reveal-backup"


@pytest.fixture
def held(client, monkeypatch):
    h = HeldStep()
    arm(monkeypatch, h.step())
    yield h
    h.release.set()


@pytest.fixture
def blocked_old(app, tmp_path, monkeypatch):
    """A 0008 project whose backup cannot be written (a file named `backups`), in the recent list."""
    arm(monkeypatch)
    monkeypatch.setattr(backup, "BACKUP_BEFORE", "0009")
    old = at_revision(tmp_path / "old", "0008", pid="p-old", name="Old")
    (old / "backups").write_text("in the way", "utf-8")
    app.state.projects.appdata.remember("p-old", "Old", str(old))
    return old


@pytest.fixture
def launched(monkeypatch) -> list[str]:
    from app.exports import reveal

    calls: list[str] = []
    monkeypatch.setattr(reveal, "launch", calls.append)
    return calls


def _items(client) -> dict:
    r = client.get("/api/v1/projects")
    assert r.status_code == 200, r.text
    return {p["id"]: p for p in r.json()["items"]}


def test_one_failing_project_never_fails_the_list(client, project_id, blocked_old):
    before = sha256(blocked_old / "project.db")
    items = _items(client)
    assert items[project_id]["migration"]["state"] == "ok"
    old = items["p-old"]
    assert (old["name"], old["folder"]) == ("Old", str(blocked_old))
    assert old["migration"]["state"] == "failed" and old["migration"]["code"] == "backup_failed"
    assert "backed up" in old["migration"]["error"]
    # Built from the recent entry: its last_opened_at is kept, not dropped to null.
    assert old["last_opened_at"] is not None and old["created_at"]
    assert sha256(blocked_old / "project.db") == before


def test_an_unreadable_database_is_listed_as_failed(app, client, project_id, tmp_path):
    broken = tmp_path / "broken"
    broken.mkdir()
    (broken / "project.db").write_bytes(b"not a database" * 64)
    app.state.projects.appdata.remember("p-broken", "Broken", str(broken))
    item = _items(client)["p-broken"]
    assert item["migration"]["state"] == "failed" and item["migration"]["code"] == "open_failed"
    assert item["migration"]["error"]


def test_a_deleted_folder_is_listed_as_missing_and_can_be_removed(app, client, project_id, tmp_path):
    gone = tmp_path / "gone"
    app.state.projects.appdata.remember("p-gone", "Gone", str(gone))  # never existed on disk
    item = _items(client)["p-gone"]
    assert item["availability"] == "missing" and item["migration"]["state"] == "ok"
    assert (item["name"], item["folder"]) == ("Gone", str(gone))
    assert item.get("summary") is None  # BC adds `summary`; MG never fills it
    assert _items(client)[project_id]["availability"] == "ok"
    assert client.delete("/api/v1/projects/p-gone").status_code == 204
    assert "p-gone" not in _items(client)


def test_locating_a_moved_folder_replaces_the_missing_entry(app, client, tmp_path):
    import shutil

    folder = tmp_path / "old-place"
    r = client.post("/api/v1/projects", json={"name": "Moved", "folder": str(folder), "type_ids": []})
    pid = r.json()["id"]
    app.state.projects.close_all()  # release the SQLite handles before moving the folder
    moved = tmp_path / "new-place"
    shutil.move(str(folder), str(moved))
    assert _items(client)[pid]["availability"] == "missing"
    assert client.post("/api/v1/projects/open", json={"folder": str(moved)}).status_code == 200
    items = [p for p in client.get("/api/v1/projects").json()["items"] if p["id"] == pid]
    assert [(p["folder"], p["availability"]) for p in items] == [(str(moved), "ok")]


def test_a_live_upgrade_is_listed_as_running(app, client, tmp_path, held):
    folder = legacy_at_head(tmp_path / "legacy")
    app.state.projects.appdata.remember("p-legacy", "Legacy", str(folder))
    job = migration_job.submit(app.state.jobs, app.state.projects, folder, "p-legacy")
    assert held.entered.wait(10)
    item = _items(client)["p-legacy"]
    assert item["migration"]["state"] == "running" and item["migration"]["job_id"] == job.id


def test_the_list_of_open_projects_never_waits_on_the_registry_lock(app, client, project_id):
    """F12: a job holds the registry lock while it backs a project up; a project already open is
    listed from the cache without taking that lock."""
    reg = app.state.projects
    result: dict = {}

    def list_projects():
        result["r"] = client.get("/api/v1/projects")

    with reg._lock:  # what a job holds during a backup
        t = threading.Thread(target=list_projects, daemon=True)
        t.start()
        t.join(10)
        answered = not t.is_alive()
    t.join(10)
    assert answered, "GET /projects waited on the registry lock"
    assert [p["id"] for p in result["r"].json()["items"]] == [project_id]


def test_retry_upgrades_a_project_whose_backup_failed(client, blocked_old):
    assert _items(client)["p-old"]["migration"]["state"] == "failed"
    (blocked_old / "backups").unlink()
    r = client.post(RETRY, json={"folder": str(blocked_old)})
    assert r.status_code == 202, r.text
    assert r.json()["state"] == "pending" and r.json()["job_id"]
    assert wait_library_job(client, r.json()["job_id"])["state"] == "succeeded"
    assert _items(client)["p-old"]["migration"]["state"] == "ok"
    assert revision_of(latest_backup(blocked_old)) == "0008"


def test_retry_while_an_upgrade_runs_is_409(app, client, tmp_path, held):
    folder = legacy_at_head(tmp_path / "legacy")
    job = migration_job.submit(app.state.jobs, app.state.projects, folder, "p-legacy")
    assert held.entered.wait(10)
    r = client.post(RETRY, json={"folder": str(folder)})
    assert r.status_code == 409 and r.json()["error"]["code"] == "job_running"
    assert r.json()["error"]["details"] == {"job_id": job.id}


def test_retry_of_an_upgraded_project_is_409(client, tmp_path):
    folder = legacy_at_head(tmp_path / "legacy")
    set_schema_version(folder, 2)
    r = client.post(RETRY, json={"folder": str(folder)})
    assert r.status_code == 409 and r.json()["error"]["code"] == "conflict"
    assert MigrationStates(client.app.state.settings.data_dir).get(folder) is None


def test_reveal_backup_shows_the_recorded_copy_in_explorer(client, blocked_old, launched):
    assert client.post(REVEAL, json={"folder": str(blocked_old)}).status_code == 404
    (blocked_old / "backups").unlink()
    r = client.post(RETRY, json={"folder": str(blocked_old)})
    assert wait_library_job(client, r.json()["job_id"])["state"] == "succeeded"
    assert client.post(REVEAL, json={"folder": str(blocked_old)}).status_code == 204
    assert len(launched) == 1 and "/select," in launched[0] and str(latest_backup(blocked_old)) in launched[0]


def test_reveal_backup_finds_a_backup_no_job_recorded(client, tmp_path, monkeypatch, launched):
    """F6: open_project_db backed the project up, but no `project_migrate` job ever recorded it."""
    arm(monkeypatch)
    monkeypatch.setattr(backup, "BACKUP_BEFORE", "0009")
    folder = at_revision(tmp_path / "old", "0008")
    assert client.post("/api/v1/projects/open", json={"folder": str(folder)}).status_code == 200
    assert (MigrationStates(client.app.state.settings.data_dir).get(folder) or {}).get("backup_path") is None
    found = latest_backup(folder)
    assert found is not None
    assert client.post(REVEAL, json={"folder": str(folder)}).status_code == 204
    assert len(launched) == 1 and str(found) in launched[0]


def test_retry_of_a_folder_without_a_project_is_404(client, tmp_path):
    assert client.post(RETRY, json={"folder": str(tmp_path / "nothing")}).status_code == 404


def test_retry_without_the_library_is_503(app, client, tmp_path, monkeypatch):
    folder = legacy_at_head(tmp_path / "legacy")
    monkeypatch.setattr(app.state.jobs, "library", None)
    r = client.post(RETRY, json={"folder": str(folder)})
    assert r.status_code == 503 and r.json()["error"]["code"] == "library_unavailable"


def test_opening_a_failed_folder_queues_no_new_job(app, client, tmp_path, monkeypatch):
    arm(monkeypatch, Step("noop", "Noop", lambda ctx: {}))
    folder = legacy_at_head(tmp_path / "legacy")
    states = MigrationStates(app.state.settings.data_dir)
    states.set(folder, state="failed", code="step_failed", error="x", job_id=None)
    r = client.post("/api/v1/projects/open", json={"folder": str(folder)})
    assert r.status_code == 200, r.text
    assert r.json()["migration"]["state"] == "failed"
    assert states.get(folder)["job_id"] is None


def test_forgetting_a_project_that_cannot_open_drops_it(app, client, project_id, blocked_old):
    before = sha256(blocked_old / "project.db")
    assert client.delete("/api/v1/projects/p-old").status_code == 204
    assert "p-old" not in _items(client)
    assert sha256(blocked_old / "project.db") == before


def test_forgetting_a_project_whose_upgrade_runs_is_409(app, client, tmp_path, held):
    folder = legacy_at_head(tmp_path / "legacy")
    app.state.projects.appdata.remember("p-legacy", "Legacy", str(folder))
    job = migration_job.submit(app.state.jobs, app.state.projects, folder, "p-legacy")
    assert held.entered.wait(10)
    r = client.delete("/api/v1/projects/p-legacy")
    assert r.status_code == 409 and r.json()["error"]["code"] == "job_running"
    assert r.json()["error"]["details"] == {"job_id": job.id}
    assert "p-legacy" in _items(client)


def test_a_folder_that_cannot_be_read_is_listed_as_failed(app, client, project_id, tmp_path, monkeypatch):
    """Python 3.11's `Path.exists` re-raises a `PermissionError`: one such folder never fails the list."""
    import pathlib

    locked = tmp_path / "locked"
    app.state.projects.appdata.remember("p-locked", "Locked", str(locked))
    real_exists = pathlib.Path.exists

    def exists(self, *args, **kwargs):
        if self.parent == locked:
            raise PermissionError(13, "Access is denied", str(self))
        return real_exists(self, *args, **kwargs)

    monkeypatch.setattr(pathlib.Path, "exists", exists)
    items = _items(client)
    assert items[project_id]["migration"]["state"] == "ok"
    item = items["p-locked"]
    assert (item["name"], item["availability"]) == ("Locked", "ok")
    assert item["migration"]["state"] == "failed" and item["migration"]["code"] == "open_failed"
    assert "PermissionError" in item["migration"]["error"]


def test_reveal_backup_of_an_unreadable_backups_folder_is_404(client, tmp_path, monkeypatch, launched):
    import pathlib

    folder = legacy_at_head(tmp_path / "legacy")
    (folder / "backups").mkdir()
    real_iterdir = pathlib.Path.iterdir

    def iterdir(self):
        if self == folder / "backups":
            raise PermissionError(13, "Access is denied", str(self))
        return real_iterdir(self)

    monkeypatch.setattr(pathlib.Path, "iterdir", iterdir)
    r = client.post(REVEAL, json={"folder": str(folder)})
    assert r.status_code == 404 and r.json()["error"]["code"] == "not_found"
    assert launched == []


# --- final-review fixes -----------------------------------------------------------------------


def test_a_retry_whose_submit_fails_leaves_the_entry_failed(app, client, blocked_old, monkeypatch):
    """Minor 3: Retry does not pre-set `pending`; a submit that raises (the library DB is locked)
    leaves the entry `failed`, so startup never re-queues it by itself."""
    import sqlite3

    from fastapi.testclient import TestClient

    assert _items(client)["p-old"]["migration"]["state"] == "failed"

    def locked(*args, **kwargs):
        raise sqlite3.OperationalError("database is locked")

    monkeypatch.setattr(app.state.jobs, "submit", locked)
    loose = TestClient(app, raise_server_exceptions=False, headers={"Authorization": "Bearer test-token"})
    assert loose.post(RETRY, json={"folder": str(blocked_old)}).status_code == 500
    entry = MigrationStates(app.state.settings.data_dir).get(blocked_old)
    assert (entry["state"], entry["code"]) == ("failed", "backup_failed")


def test_a_failed_backup_keeps_the_recorded_copy_and_reports_one_on_disk(app, client, tmp_path, monkeypatch):
    """Minor 4: `_backup_failed` never erases a recorded `backup_path`, and its 409 falls back to the
    newest backup on disk, like `Project.migration`."""
    import shutil

    from app.db import session
    from app.migration.backup import BackupFailed

    monkeypatch.setattr(backup, "BACKUP_BEFORE", "0009")
    folder = at_revision(tmp_path / "old", "0008")
    (folder / "backups").mkdir()
    earlier = folder / "backups" / "project.db.v1-20260101T000000Z.bak"
    shutil.copy2(folder / "project.db", earlier)

    def fails(folder, now=None):
        raise BackupFailed("The project database could not be backed up: disk full")

    monkeypatch.setattr(session, "backup_project_db", fails)
    r = client.post("/api/v1/projects/open", json={"folder": str(folder)})
    assert r.status_code == 409 and r.json()["error"]["details"]["backup_path"] == str(earlier)
    states = MigrationStates(app.state.settings.data_dir)
    states.set(folder, backup_path="C:/recorded/project.db.v1-20251231T000000Z.bak")
    r = client.post("/api/v1/projects/open", json={"folder": str(folder)})
    assert r.status_code == 409
    assert r.json()["error"]["details"]["backup_path"] == "C:/recorded/project.db.v1-20251231T000000Z.bak"
    assert states.get(folder)["backup_path"] == "C:/recorded/project.db.v1-20251231T000000Z.bak"
    assert revision_of(folder / "project.db") == "0008"


def _deny_is_file(monkeypatch, target):
    import pathlib

    real_is_file = pathlib.Path.is_file

    def is_file(self):
        if self == target:
            raise PermissionError(13, "Access is denied", str(self))
        return real_is_file(self)

    monkeypatch.setattr(pathlib.Path, "is_file", is_file)


def test_retry_of_an_unreadable_folder_is_404(client, tmp_path, monkeypatch):
    """Minor 5: Python 3.11's `Path.is_file` re-raises a `PermissionError`; that is not a 500."""
    folder = legacy_at_head(tmp_path / "legacy")
    _deny_is_file(monkeypatch, folder / "project.db")
    r = client.post(RETRY, json={"folder": str(folder)})
    assert r.status_code == 404 and r.json()["error"]["code"] == "not_found"


def test_reveal_backup_of_an_unreadable_backup_is_404(app, client, tmp_path, monkeypatch, launched):
    folder = legacy_at_head(tmp_path / "legacy")
    (folder / "backups").mkdir()
    copy = folder / "backups" / "project.db.v1-20260101T000000Z.bak"
    copy.write_bytes(b"")
    MigrationStates(app.state.settings.data_dir).set(folder, state="ok", backup_path=str(copy))
    _deny_is_file(monkeypatch, copy)
    r = client.post(REVEAL, json={"folder": str(folder)})
    assert r.status_code == 404 and r.json()["error"]["code"] == "not_found"
    assert launched == []


def test_a_hand_damaged_recent_entry_is_skipped_not_a_500(app, client, project_id, tmp_path, caplog):
    """Minor 6: a recent entry that fails validation twice (a non-string name) is skipped and logged."""
    import json

    appdata = app.state.projects.appdata
    entries = json.loads(appdata._recent.read_text("utf-8"))
    entries.append({"id": "p-bad", "name": 123, "folder": str(tmp_path / "gone")})
    appdata._recent.write_text(json.dumps(entries), "utf-8")
    items = _items(client)
    assert project_id in items and "p-bad" not in items
    assert "p-bad" in caplog.text or str(tmp_path / "gone") in caplog.text


def test_disarmed_a_version_1_project_lists_as_ok_with_no_job(app, client, tmp_path, monkeypatch):
    """Minor 8: Part A ships disarmed; a pre-foundation project lists as `ok` and no job is queued."""
    arm(monkeypatch)
    folder = legacy_at_head(tmp_path / "legacy")
    app.state.projects.appdata.remember("p-legacy", "Legacy", str(folder))
    item = _items(client)["p-legacy"]
    assert item["migration"]["state"] == "ok" and item["migration"]["job_id"] is None
    assert item["schema_version"] == 1
    assert MigrationStates(app.state.settings.data_dir).get(folder) is None
