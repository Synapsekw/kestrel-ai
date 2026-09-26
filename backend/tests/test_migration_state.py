"""migrations.json (foundation spec §11.3): keyed by the lower-cased folder, atomic, never fatal."""

import json
import threading
from pathlib import Path

import pytest

from app.migration.state import FILE_NAME, MigrationStates, failed_error, upgrading_error


def test_entries_are_keyed_by_the_lower_cased_resolved_folder(tmp_path):
    folder = tmp_path / "Projects" / "AHTest"
    folder.mkdir(parents=True)
    states = MigrationStates(tmp_path / "appdata")
    states.set(folder, state="failed", code="backup_failed", error="disk full")
    same = Path(str(folder).upper())
    got = states.get(same)
    assert got["state"] == "failed" and got["code"] == "backup_failed" and got["error"] == "disk full"
    assert got["folder"] == str(folder.resolve()) and got["updated_at"]
    assert list(states.all()) == [str(folder.resolve()).lower()]


def test_set_merges_into_the_existing_entry(tmp_path):
    states = MigrationStates(tmp_path)
    states.set(tmp_path / "p", state="pending", job_id="j1", project_id="p1")
    states.set(tmp_path / "p", state="ok", error=None)
    got = states.get(tmp_path / "p")
    assert (got["state"], got["job_id"], got["project_id"], got["error"]) == ("ok", "j1", "p1", None)


def test_unknown_fields_and_states_are_refused(tmp_path):
    states = MigrationStates(tmp_path)
    with pytest.raises(ValueError, match="stat"):
        states.set(tmp_path / "p", stat="ok")
    with pytest.raises(ValueError, match="upgrading"):
        states.set(tmp_path / "p", state="upgrading")


def test_a_damaged_file_reads_as_empty_and_is_logged(tmp_path, caplog):
    (tmp_path / FILE_NAME).write_text("{ not json", "utf-8")
    states = MigrationStates(tmp_path)
    assert states.all() == {} and states.get(tmp_path / "p") is None
    assert FILE_NAME in caplog.text
    states.set(tmp_path / "p", state="ok")  # a write replaces the damaged file
    assert json.loads((tmp_path / FILE_NAME).read_text("utf-8"))


def test_writes_leave_no_temporary_files(tmp_path):
    states = MigrationStates(tmp_path)
    for i in range(5):
        states.set(tmp_path / f"p{i}", state="ok")
    assert sorted(p.name for p in tmp_path.iterdir()) == [FILE_NAME]


def test_concurrent_writers_lose_nothing(tmp_path):
    states = MigrationStates(tmp_path)

    def write(n):
        for i in range(25):
            states.set(tmp_path / f"t{n}-{i}", state="pending", job_id=f"{n}-{i}")

    threads = [threading.Thread(target=write, args=(n,)) for n in range(8)]
    for t in threads:
        t.start()
    for t in threads:
        t.join()
    assert len(MigrationStates(tmp_path).all()) == 200


def test_the_409s_carry_the_contract_details():
    failed = failed_error({"error": "step 2 failed", "backup_path": "C:/p/backups/x.bak"})
    assert (failed.code, failed.status) == ("project_upgrade_failed", 409)
    assert failed.details == {"error": "step 2 failed", "backup_path": "C:/p/backups/x.bak"}
    upgrading = upgrading_error("job-1")
    assert (upgrading.code, upgrading.status, upgrading.details) == (
        "project_upgrading",
        409,
        {"job_id": "job-1"},
    )
    assert "model library" in upgrading_error(None, "Waiting for the model library.").message


def test_a_write_over_an_unparseable_file_keeps_it_aside(tmp_path, caplog):
    """Final review Minor 2: a file that cannot be parsed is copied aside, never silently lost."""
    damaged = '{"other": {"state": "failed", "code": "step_failed"'
    (tmp_path / FILE_NAME).write_text(damaged, "utf-8")
    states = MigrationStates(tmp_path)
    states.set(tmp_path / "p", state="ok")
    kept = sorted(tmp_path.glob(f"{FILE_NAME}.damaged-*"))
    assert len(kept) == 1 and kept[0].read_text("utf-8") == damaged
    assert list(states.all()) == [MigrationStates.key(tmp_path / "p")]
    assert kept[0].name in caplog.text


def test_a_write_over_a_file_that_could_not_be_read_keeps_it_aside(tmp_path, monkeypatch):
    """A transient read failure (an antivirus lock) must not drop every other project's entry."""
    states = MigrationStates(tmp_path)
    states.set(tmp_path / "other", state="failed", code="step_failed", error="x")
    original = (tmp_path / FILE_NAME).read_text("utf-8")
    real_read_text = Path.read_text

    def read_text(self, *args, **kwargs):
        if self.name == FILE_NAME:
            raise PermissionError(13, "The process cannot access the file", str(self))
        return real_read_text(self, *args, **kwargs)

    monkeypatch.setattr(Path, "read_text", read_text)
    assert states.get(tmp_path / "other") is None  # reads still treat it as empty
    states.set(tmp_path / "p", state="ok")
    monkeypatch.undo()
    kept = sorted(tmp_path.glob(f"{FILE_NAME}.damaged-*"))
    assert len(kept) == 1 and kept[0].read_text("utf-8") == original


def test_a_write_that_cannot_keep_the_unreadable_file_aside_refuses(tmp_path, monkeypatch):
    from app.migration import state as state_module

    (tmp_path / FILE_NAME).write_text("{ not json", "utf-8")

    def no_copy(*args, **kwargs):
        raise PermissionError(13, "Access is denied")

    monkeypatch.setattr(state_module.shutil, "copy2", no_copy)
    with pytest.raises(OSError):
        MigrationStates(tmp_path).set(tmp_path / "p", state="ok")
    assert (tmp_path / FILE_NAME).read_text("utf-8") == "{ not json"
