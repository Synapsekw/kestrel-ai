"""Startup sweep for drawings (spec 2026-09-26-map-workspace §12), wired into `project_opened` by M-C0.

An `importing` drawing whose `drawing_import` job this process does not hold becomes `failed`
("interrupted") and loses its partial folder under `drawings/` (M-B3); drawing-inspection folders no
live job holds are removed after 24 h, and a younger one still `inspecting` is marked failed. A folder
under `drawings/` with no Drawing row (a DELETE whose removal met a file held open) is removed. Each
item is swept on its own and nothing raises: a failing sweep never stops a project from opening.
"""

import logging
import shutil
from datetime import UTC, datetime, timedelta
from pathlib import Path

from sqlalchemy import select

from app.db.base import utcnow
from app.db.models import Drawing
from app.drawings import store
from app.surfaces.design.store import ID_RE
from app.projects.service import ProjectHandle

INTERRUPTED = "import interrupted by application restart; import the drawing again"
MAX_AGE = timedelta(hours=24)
log = logging.getLogger(__name__)


def _created(request: dict, folder: Path) -> datetime:
    try:
        created = datetime.fromisoformat(request["created_at"])
    except (KeyError, TypeError, ValueError):
        return datetime.fromtimestamp(folder.stat().st_mtime, UTC)
    return created if created.tzinfo is not None else created.replace(tzinfo=UTC)


def sweep_inspections(handle: ProjectHandle, runner) -> list[str]:
    root, removed, now = store.inspections_root(handle), [], datetime.now(UTC)
    if not root.is_dir():
        return removed
    for folder in sorted(p for p in root.iterdir() if p.is_dir()):
        try:
            try:
                request = store.read_json(folder / "request.json")
            except (OSError, ValueError):
                request = {}
            if not isinstance(request, dict):
                request = {}
            jobs = [request.get("inspect_job_id"), *request.get("build_job_ids", [])]
            if any(j and runner.is_live(j) for j in jobs):
                continue
            if now - _created(request, folder) > MAX_AGE:
                shutil.rmtree(folder, ignore_errors=True)
                if not folder.exists():
                    removed.append(folder.name)
                continue
            insp = folder / "inspection.json"
            if insp.is_file() and store.read_json(insp).get("state") == "inspecting":
                store.patch_json(
                    insp, state="failed", error="interrupted by application restart; read the file again"
                )
        except Exception:
            log.exception("could not sweep drawing inspection %s", folder.name)
    return removed


def sweep_orphan_folders(handle: ProjectHandle) -> list[str]:
    """Remove every drawing-id folder under `drawings/` whose Drawing row is gone."""
    root, removed = Path(handle.drawings_dir), []
    if not root.is_dir():
        return removed
    with handle.session() as s:
        known = set(s.execute(select(Drawing.id)).scalars())
    for folder in sorted(root.iterdir()):
        try:
            if not folder.is_dir() or not ID_RE.fullmatch(folder.name) or folder.name in known:
                continue
            shutil.rmtree(folder)
            removed.append(folder.name)
        except Exception:
            log.exception("could not remove orphan drawing folder %s", folder.name)
    if removed:
        log.info("removed %d orphan drawing folder(s) in project %s", len(removed), handle.id)
    return removed


def sweep_interrupted(handle: ProjectHandle, runner) -> list[str]:
    swept: list[str] = []
    with handle.session() as s:
        for row in s.execute(select(Drawing).where(Drawing.status == "importing")).scalars():
            if row.job_id and runner.is_live(row.job_id):
                continue
            row.status, row.error, row.updated_at = "failed", INTERRUPTED, utcnow()
            swept.append(row.id)
    for did in swept:
        shutil.rmtree(store.drawing_dir(handle, did), ignore_errors=True)
    if swept:
        log.info("marked %d interrupted drawing import(s) failed in project %s", len(swept), handle.id)
    try:
        sweep_inspections(handle, runner)
    except Exception:
        log.exception("could not sweep drawing inspections in project %s", handle.id)
    try:
        sweep_orphan_folders(handle)
    except Exception:
        log.exception("could not sweep orphan drawing folders in project %s", handle.id)
    return swept
