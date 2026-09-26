"""The design-inspection sweep on project open (spec §4.4). Wired into project_opened() by F0.

Interrupted `building` design surfaces are S2's surface sweep's job (it covers every kind).
"""

from __future__ import annotations

import logging
import shutil
from datetime import UTC, datetime, timedelta
from pathlib import Path

from app.surfaces.design import store

MAX_AGE = timedelta(hours=24)
INTERRUPTED = "interrupted by application restart; {}"
log = logging.getLogger(__name__)


def _created(request: dict, folder: Path) -> datetime:
    try:
        created = datetime.fromisoformat(request["created_at"])
    except (KeyError, TypeError, ValueError):
        return datetime.fromtimestamp(folder.stat().st_mtime, UTC)
    # A naive `created_at` (no tzinfo) would otherwise raise TypeError when compared against the
    # aware `now` in sweep_interrupted; a corrupt or hand-written request.json must not crash it.
    return created if created.tzinfo is not None else created.replace(tzinfo=UTC)


def _fail_interrupted(folder: Path) -> None:
    insp = folder / "inspection.json"
    if insp.is_file() and store.read_json(insp).get("state") == "inspecting":
        store.patch_json(insp, state="failed", error=INTERRUPTED.format("read the file again"))
    for p in (folder / "previews").glob("*/preview.json"):
        if store.read_json(p).get("state") == "running":
            store.patch_json(p, state="failed", error=INTERRUPTED.format("preview again"))


def _sweep_one(folder: Path, now: datetime, runner) -> bool:
    """True when `folder` was removed as stale. Any other outcome (kept live, kept fresh, marked
    interrupted) is False; the caller's per-folder try/except is what keeps one bad folder
    (a non-dict request.json, a naive created_at, a stat() race) from aborting the rest."""
    try:
        request = store.read_json(folder / "request.json")
    except (OSError, ValueError):
        request = {}
    if not isinstance(request, dict):
        request = {}
    if any(runner.is_live(j) for j in store.job_ids(request)):
        return False
    if now - _created(request, folder) > MAX_AGE:
        shutil.rmtree(folder, ignore_errors=True)
        return not folder.exists()  # a handle Windows still holds can leave files behind
    _fail_interrupted(folder)
    return False


def sweep_interrupted(handle, runner) -> list[str]:
    """Remove inspection folders no live job holds and older than 24 h; fail interrupted ones."""
    root = store.inspections_root(handle)
    if not root.is_dir():
        return []
    now, removed = datetime.now(UTC), []
    for folder in sorted(p for p in root.iterdir() if p.is_dir()):
        try:
            if _sweep_one(folder, now, runner):
                removed.append(folder.name)
        except Exception:
            log.exception("could not sweep design inspection %s", folder.name)
    if removed:
        log.info("removed %d stale design inspection(s) in project %s", len(removed), handle.id)
    return removed
