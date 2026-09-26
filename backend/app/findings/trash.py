"""Where a deleted finding's photos go (spec 2026-09-26-foundation section 8.5):
`findings/_trash/`, purged after 30 days. Files move only after the deleting transaction commits, so
a rolled-back delete never loses a photo."""

import logging
import os
import shutil
from collections.abc import Iterable
from datetime import UTC, datetime, timedelta
from pathlib import Path

TRASH = "_trash"
KEEP_DAYS = 30
STAMP = "%Y%m%dT%H%M%SZ"
log = logging.getLogger(__name__)


def findings_dir(handle) -> Path:
    return handle.folder / "findings"


def finding_dir(handle, finding_id: str) -> Path:
    return findings_dir(handle) / finding_id


def _stamp(now: datetime | None) -> str:
    return (now or datetime.now(UTC)).strftime(STAMP)


def move(handle, finding_ids: Iterable[str], now: datetime | None = None) -> int:
    """Each finding's folder -> `_trash/<finding_id>-<UTC stamp>`; returns how many moved."""
    moved = 0
    for fid in finding_ids:
        src = finding_dir(handle, fid)
        if not src.is_dir():
            continue
        dest = findings_dir(handle) / TRASH / f"{fid}-{_stamp(now)}"
        try:
            dest.parent.mkdir(parents=True, exist_ok=True)
            os.replace(src, dest)
            moved += 1
        except OSError:
            log.exception("could not move %s to the trash", src)
    return moved


def move_file(handle, rel_path: str, now: datetime | None = None) -> None:
    """One attachment -> `_trash/<finding_id>-<UTC stamp>/<file>`."""
    src = handle.folder / rel_path
    if not src.is_file():
        return
    dest = findings_dir(handle) / TRASH / f"{src.parent.name}-{_stamp(now)}" / src.name
    try:
        dest.parent.mkdir(parents=True, exist_ok=True)
        os.replace(src, dest)
    except OSError:
        log.exception("could not move %s to the trash", src)


def purge(handle, now: datetime | None = None, keep_days: int = KEEP_DAYS) -> int:
    """Remove trash entries older than `keep_days`; returns how many actually went (an entry that a
    locked file keeps is tried again on the next purge). Runs on project open."""
    root = findings_dir(handle) / TRASH
    if not root.is_dir():
        return 0
    cutoff = (now or datetime.now(UTC)) - timedelta(days=keep_days)
    removed = 0
    for entry in root.iterdir():
        try:
            when = datetime.strptime(entry.name.rsplit("-", 1)[-1], STAMP).replace(tzinfo=UTC)
        except ValueError:
            continue
        if when >= cutoff:
            continue
        try:
            if entry.is_dir():
                shutil.rmtree(entry, ignore_errors=True)
            else:
                entry.unlink(missing_ok=True)
        except OSError:
            log.warning("could not purge %s from the trash", entry, exc_info=True)
        if entry.exists():
            continue
        removed += 1
    return removed
