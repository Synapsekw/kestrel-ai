"""Startup sweep for drawings (spec 2026-09-26-map-workspace §12), wired into `project_opened` by M-C0.

An `importing` drawing whose `drawing_import` job this process does not hold becomes `failed`
("interrupted"). M-B3 extends this sweep with the cleanup of partial output under `drawings/`. The step
logs and continues: a failing sweep never stops a project from opening.
"""

import logging

from sqlalchemy import select

from app.db.models import Drawing
from app.projects.service import ProjectHandle

INTERRUPTED = "import interrupted by application restart; import the drawing again"
log = logging.getLogger(__name__)


def sweep_interrupted(handle: ProjectHandle, runner) -> list[str]:
    swept: list[str] = []
    with handle.session() as s:
        for row in s.execute(select(Drawing).where(Drawing.status == "importing")).scalars():
            if row.job_id and runner.is_live(row.job_id):
                continue
            row.status, row.error = "failed", INTERRUPTED
            swept.append(row.id)
    if swept:
        log.info("marked %d interrupted drawing import(s) failed in project %s", len(swept), handle.id)
    return swept
