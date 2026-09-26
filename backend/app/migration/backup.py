"""Copy-first backup of a project database before a schema change (foundation spec §11.2).

`open_project_db` asks `needs_backup` before Alembic runs. When the upgrade will apply
`BACKUP_BEFORE`, it takes a backup with SQLite's own online backup API, which is consistent under
WAL. A backup that cannot be written, or that does not pass `PRAGMA quick_check`, raises
`BackupFailed`, and the upgrade does not run: the project's data is left logically unchanged (not
byte-identical: the `wal_checkpoint(TRUNCATE)` taken before the copy may already have moved pages
from `project.db-wal` into `project.db`). The app never deletes a backup and never restores one by
itself.

Only the standard library and Alembic's exception types are imported here: `app.db.session`
imports this module.
"""

from __future__ import annotations

import os
import re
import sqlite3
from datetime import UTC, datetime
from pathlib import Path
from urllib.request import pathname2url

from alembic.script.revision import ResolutionError
from alembic.util import CommandError

BACKUP_BEFORE = "0010"  # the foundation revision (foundation spec §11.1)
BACKUP_LABEL = "v1"  # the schema generation the copy holds
BACKUPS_DIR = "backups"
DB_NAME = "project.db"
_NAME = re.compile(r"^project\.db\.[A-Za-z0-9]+-(?P<stamp>\d{8}T\d{6}Z)(?:-(?P<n>\d+))?\.bak$")


class BackupFailed(Exception):
    """The copy could not be written or did not pass its check; nothing was upgraded."""

    code = "backup_failed"


def backups_dir(folder: Path) -> Path:
    return Path(folder) / BACKUPS_DIR


def needs_backup(current: str | None, script) -> bool:
    """True when upgrading from `current` to head will apply `BACKUP_BEFORE`.

    `current` None is a database with no revision yet (a new project): there is nothing to lose.
    A chain without `BACKUP_BEFORE`, or a revision this build does not know (a database written by
    a newer build), never asks for one; Alembic then reports the real problem itself. Any other
    error propagates: the open fails closed rather than upgrading without a copy.
    """
    if current is None or current == BACKUP_BEFORE:
        return False
    try:
        script.get_revision(BACKUP_BEFORE)
        pending = {rev.revision for rev in script.walk_revisions(base=current, head="heads")}
    except (CommandError, ResolutionError):  # an id this chain does not know
        return False
    pending.discard(current)
    return BACKUP_BEFORE in pending


def ro_uri(path) -> str:
    """A read-only SQLite `file:` URI for `path`, for `sqlite3.connect(..., uri=True)`.

    `Path.as_uri()` puts a UNC server in the URI authority (`file://server/share/...`), which
    SQLite refuses; `pathname2url` keeps it in the path with an empty authority
    (`file:////server/share/...`) and percent-encodes what a URI must not carry. The path is made
    absolute without touching the file system, so a pure path works too."""
    return f"file:{pathname2url(os.path.abspath(str(path)))}?mode=ro"


def quick_check(path: Path) -> str:
    """`PRAGMA quick_check`: "ok", or SQLite's first complaint. It runs on the backup's own fresh
    partial, so a plain path is enough (no URI, which a UNC folder would trip over)."""
    con = sqlite3.connect(str(path))
    try:
        return str(con.execute("PRAGMA quick_check").fetchone()[0])
    finally:
        con.close()


def latest_backup(folder: Path) -> Path | None:
    """The newest backup in `<folder>/backups`, by its stamp and then its `-n` suffix. A folder
    that cannot be read (`PermissionError`, a vanished drive) has no backup to offer: None."""
    found = []
    d = backups_dir(folder)
    try:
        if d.is_dir():
            for p in d.iterdir():
                m = _NAME.match(p.name)
                if m and p.is_file():
                    found.append(((m["stamp"], int(m["n"] or 1)), p))
    except OSError:
        return None
    return max(found)[1] if found else None


def backup_path(entry: dict | None, folder) -> str | None:
    """The project's pre-upgrade backup: the one `migrations.json` records, else the newest real
    backup on disk (F6) — the window between the Alembic backup `open_project_db` takes and a
    `project_migrate` job recording its own. `Project.migration`, the 409s and Reveal backup all
    show this one path; `entry` None asks for the newest on disk only."""
    recorded = (entry or {}).get("backup_path")
    if recorded:
        return recorded
    found = latest_backup(folder)
    return str(found) if found else None


def _target(folder: Path, now: datetime) -> Path:
    stem = f"{DB_NAME}.{BACKUP_LABEL}-{now.astimezone(UTC).strftime('%Y%m%dT%H%M%SZ')}"
    path, n = backups_dir(folder) / f"{stem}.bak", 2
    while path.exists() or path.with_name(path.name + ".partial").exists():
        path, n = backups_dir(folder) / f"{stem}-{n}.bak", n + 1
    return path


def _discard(partial: Path | None) -> None:
    if partial is not None:
        try:
            partial.unlink(missing_ok=True)
        except OSError:
            pass


def backup_project_db(folder: Path, now: datetime | None = None) -> Path:
    """Write and check `<folder>/backups/project.db.v1-<UTC stamp>.bak`; raise BackupFailed."""
    folder = Path(folder)
    partial: Path | None = None
    try:
        backups_dir(folder).mkdir(exist_ok=True)
        target = _target(folder, now or datetime.now(UTC))
        partial = target.with_name(target.name + ".partial")
        src = sqlite3.connect(folder / DB_NAME)
        try:
            src.execute("PRAGMA wal_checkpoint(TRUNCATE)")
            dst = sqlite3.connect(partial)
            try:
                src.backup(dst)
            finally:
                dst.close()
        finally:
            src.close()
        verdict = quick_check(partial)
        if verdict != "ok":
            raise BackupFailed(f"The backup copy failed its integrity check ({verdict}).")
        os.replace(partial, target)
        return target
    except BackupFailed:
        _discard(partial)
        raise
    except (OSError, sqlite3.Error) as e:
        _discard(partial)
        raise BackupFailed(f"The project database could not be backed up: {e}") from e
