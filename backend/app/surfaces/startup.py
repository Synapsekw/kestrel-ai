"""Startup sweep for surfaces (spec 2026-09-23-volumes §3), wired into `project_opened` by F0.

A `building` surface of any kind (S3's design builds included) whose job this process does not hold
becomes `failed`; its `.build/` and any orphan `*.partial` under `surfaces/` are removed. Each step
logs and continues: a failing sweep never stops a project from opening.
"""

import logging
import shutil

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
    if swept:
        log.info("marked %d interrupted surface build(s) failed in project %s", len(swept), handle.id)
    return swept
