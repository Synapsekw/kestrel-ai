"""Startup sweep for surfaces (spec 2026-09-23-volumes §3), wired into `project_opened` by F0.

A `building` surface of any kind (S3's design builds included) whose job this process does not hold
becomes `failed`; its `.build/`, any orphan `*.partial` under `surfaces/` and any folder no surface
row names (a delete that met a held file on Windows) are removed. Each step
logs and continues: a failing sweep never stops a project from opening.
"""

import logging
import shutil
from collections.abc import Callable
from pathlib import Path

from sqlalchemy import select

from app.db.models import Surface
from app.projects.service import ProjectHandle
from app.surfaces.paths import build_dir

INTERRUPTED = "interrupted by application restart; build it again"
log = logging.getLogger(__name__)


def sweep_interrupted(handle: ProjectHandle, runner) -> list[str]:
    swept: list[str] = []
    live: set[str] = set()
    with handle.session() as s:
        for row in s.execute(select(Surface).where(Surface.status == "building")).scalars():
            if row.job_id and runner.is_live(row.job_id):
                live.add(row.id)
                continue
            row.status, row.error = "failed", INTERRUPTED
            swept.append(row.id)
    for surface_id in swept:
        shutil.rmtree(build_dir(handle, surface_id), ignore_errors=True)
    if handle.surfaces_dir.is_dir():
        for partial in handle.surfaces_dir.glob("*/*.partial"):
            if partial.parent.name in live:
                continue
            try:
                partial.unlink()
            except OSError:
                log.warning("could not remove %s", partial)
    remove_orphan_folders(handle.surfaces_dir, lambda: _ids(handle, Surface), live)
    if swept:
        log.info("marked %d interrupted surface build(s) failed in project %s", len(swept), handle.id)
    return swept


def _ids(handle: ProjectHandle, model) -> set[str]:
    with handle.session() as s:
        return set(s.execute(select(model.id)).scalars())


def remove_orphan_folders(root: Path, known_ids: Callable[[], set[str]], live: set[str]) -> list[str]:
    """Remove folders under `root` that no row names: a delete whose `rmtree` met a file a tile
    reader still held on Windows leaves one behind. The folders are listed before the ids are read,
    so a row created meanwhile (its row is written before its folder) is never mistaken for an
    orphan. A folder that cannot be removed is logged and left for the next open."""
    if not root.is_dir():
        return []
    folders = [p for p in root.iterdir() if p.is_dir()]
    known = known_ids() | live
    removed = []
    for folder in folders:
        if folder.name in known:
            continue
        try:
            shutil.rmtree(folder)
            removed.append(folder.name)
        except OSError:
            log.warning("could not remove orphan folder %s", folder)
    return removed
