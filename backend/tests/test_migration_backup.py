"""Copy-first backup in open_project_db (foundation spec §11.2, §16 "Migration")."""

import os
import sqlite3
from datetime import UTC, datetime
from pathlib import Path, PureWindowsPath

import pytest
from migration_helpers import at_revision, revision_of, sha256

from app.db.session import current_revision, head_revision, open_project_db, project_script
from app.migration import backup
from app.migration.backup import (
    BackupFailed,
    backup_project_db,
    latest_backup,
    needs_backup,
    quick_check,
    ro_uri,
)


@pytest.fixture
def guard_0009(monkeypatch):
    """Stand-in for 0010 until BC's revision exists: the backup guards 0009, so 0008 needs one."""
    monkeypatch.setattr(backup, "BACKUP_BEFORE", "0009")


def test_needs_backup_only_when_the_upgrade_applies_the_guarded_revision(guard_0009):
    script = project_script()
    assert needs_backup("0008", script) is True
    assert needs_backup("0001", script) is True
    assert needs_backup("0009", script) is False
    assert needs_backup(None, script) is False


def test_an_unknown_revision_never_asks_for_a_backup(monkeypatch):
    monkeypatch.setattr(backup, "BACKUP_BEFORE", "9999")
    assert needs_backup("0001", project_script()) is False
    monkeypatch.setattr(backup, "BACKUP_BEFORE", "0009")
    assert needs_backup("not-a-revision", project_script()) is False  # a newer build's database


def test_the_backup_is_taken_before_the_upgrade_and_passes_quick_check(tmp_path, guard_0009):
    folder = at_revision(tmp_path / "old", "0008")
    open_project_db(folder).dispose()
    copy = latest_backup(folder)
    assert copy is not None and copy.parent == folder / "backups"
    assert copy.name.startswith("project.db.v1-") and copy.name.endswith(".bak")
    assert quick_check(copy) == "ok"
    assert revision_of(copy) == "0008"  # taken before 0009 ran
    assert revision_of(folder / "project.db") == head_revision()


def test_a_new_project_and_a_current_one_take_no_backup(tmp_path, guard_0009):
    fresh = tmp_path / "fresh"
    fresh.mkdir()
    assert current_revision(fresh) is None
    open_project_db(fresh).dispose()
    current = at_revision(tmp_path / "current", "0009")
    open_project_db(current).dispose()
    assert latest_backup(fresh) is None and latest_backup(current) is None


def test_a_failed_backup_leaves_the_database_byte_identical_and_not_upgraded(tmp_path, guard_0009):
    folder = at_revision(tmp_path / "old", "0008")
    (folder / "backups").write_text("a file where the folder should be", "utf-8")
    before = sha256(folder / "project.db")
    with pytest.raises(BackupFailed) as err:
        open_project_db(folder)
    assert err.value.code == "backup_failed"
    assert sha256(folder / "project.db") == before
    assert revision_of(folder / "project.db") == "0008"


def test_a_copy_that_fails_quick_check_is_discarded_and_nothing_upgrades(tmp_path, guard_0009, monkeypatch):
    folder = at_revision(tmp_path / "old", "0008")
    before = sha256(folder / "project.db")
    monkeypatch.setattr(backup, "quick_check", lambda path: "*** in database main *** Page 3 is never used")
    with pytest.raises(BackupFailed, match="integrity check"):
        open_project_db(folder)
    assert sha256(folder / "project.db") == before
    assert list((folder / "backups").iterdir()) == []


def test_backups_are_kept_and_the_newest_is_found(tmp_path):
    folder = at_revision(tmp_path / "old", "0008")
    now = datetime(2026, 9, 26, 10, 15, tzinfo=UTC)
    first = backup_project_db(folder, now=now)
    second = backup_project_db(folder, now=now)
    third = backup_project_db(folder, now=now)
    assert len({first, second, third}) == 3 and all(p.exists() for p in (first, second, third))
    assert second.name == "project.db.v1-20260926T101500Z-2.bak"
    assert latest_backup(folder) == third


# --- final-review fixes -----------------------------------------------------------------------


def test_the_read_only_uri_keeps_a_unc_server_in_the_path():
    """Important 1: `Path.as_uri()` puts a UNC server in the URI authority, which SQLite refuses."""
    unc = PureWindowsPath(r"\\srv\share\p\project.db")
    assert ro_uri(unc) == "file:////srv/share/p/project.db?mode=ro"


def test_the_read_only_uri_opens_a_local_database_read_only(tmp_path):
    folder = at_revision(tmp_path / "old", "0008")
    con = sqlite3.connect(ro_uri(folder / "project.db"), uri=True)
    try:
        assert con.execute("SELECT name FROM project").fetchone() == ("Legacy",)
        with pytest.raises(sqlite3.OperationalError, match="readonly"):
            con.execute("UPDATE project SET name = 'x'")
    finally:
        con.close()


def test_quick_check_opens_its_own_copy_by_plain_path(tmp_path, monkeypatch):
    """Important 1: the backup's own partial needs no URI, so a UNC folder can be backed up."""
    folder = at_revision(tmp_path / "old", "0008")
    opened = []
    real_connect = sqlite3.connect

    def connect(target, *args, **kwargs):
        opened.append((str(target), kwargs.get("uri", False)))
        return real_connect(target, *args, **kwargs)

    monkeypatch.setattr(backup.sqlite3, "connect", connect)
    assert quick_check(folder / "project.db") == "ok"
    assert opened == [(str(folder / "project.db"), False)]


def test_an_unexpected_error_asking_for_a_backup_stops_the_open(tmp_path, guard_0009, monkeypatch):
    """Fail closed: only Alembic's "unknown revision" errors mean "no backup needed"; anything
    else propagates, so nothing is upgraded without a copy."""
    from app.db import session

    folder = at_revision(tmp_path / "old", "0008")
    before = sha256(folder / "project.db")
    script = project_script()

    def broken_walk(*args, **kwargs):
        raise RuntimeError("the revision graph could not be read")

    monkeypatch.setattr(script, "walk_revisions", broken_walk)
    monkeypatch.setattr(session, "project_script", lambda: script)
    with pytest.raises(RuntimeError, match="revision graph"):
        open_project_db(folder)
    assert sha256(folder / "project.db") == before
    assert revision_of(folder / "project.db") == "0008"
    assert not (folder / "backups").exists()


def test_a_project_reached_by_a_unc_path_is_backed_up(tmp_path):
    """Important 1, end to end: the same temp folder reached through the `localhost` admin share `C$`
    (the admin share; skipped where it is not reachable) backs up, passes its check and probes."""
    from app.migration.startup import probe_schema_version

    folder = at_revision(tmp_path / "old", "0008")
    drive, rest = os.path.splitdrive(str(folder))
    unc = Path(chr(92) * 2 + "localhost" + chr(92) + drive.rstrip(":") + "$" + rest)
    if not drive or not (unc / "project.db").is_file():
        pytest.skip("the administrative share of the temp drive is not reachable")
    copy = backup_project_db(unc)
    assert quick_check(copy) == "ok" and revision_of(folder / "backups" / copy.name) == "0008"
    assert probe_schema_version(unc) == 1
