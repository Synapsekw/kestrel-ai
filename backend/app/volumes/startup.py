"""Startup sweep for measurements (spec 2026-09-23-volumes §3), wired into `project_opened` by F0.

A `calculating` measurement whose job this process does not hold becomes `stale` when it has
earlier results and `failed` otherwise; orphan partial and staged diff files are removed, and so is
any folder no measurement row names (a delete that met a held file on Windows).
"""

from __future__ import annotations

import logging
from typing import TYPE_CHECKING

from sqlalchemy import select

from app.db.models import VolumeMeasurement
from app.surfaces.startup import remove_orphan_folders

if TYPE_CHECKING:
    from app.projects.service import ProjectHandle

INTERRUPTED = "interrupted by application restart; calculate it again"
log = logging.getLogger(__name__)


def sweep_interrupted(handle: ProjectHandle, runner) -> list[str]:
    """Returns the ids of the rows it changed."""
    swept: list[str] = []
    live: set[str] = set()
    with handle.session() as s:
        for row in s.execute(
            select(VolumeMeasurement).where(VolumeMeasurement.status == "calculating")
        ).scalars():
            if row.job_id and runner.is_live(row.job_id):
                live.add(row.id)
                continue
            if row.results:
                row.status = "stale"
            else:
                row.status, row.error = "failed", INTERRUPTED
            swept.append(row.id)
    if handle.volumes_dir.is_dir():
        for leftover in [*handle.volumes_dir.glob("*/*.partial"), *handle.volumes_dir.glob("*/diff-*.tif")]:
            if leftover.parent.name in live:
                continue
            try:
                leftover.unlink()
            except OSError:
                log.warning("could not remove %s", leftover)
    remove_orphan_folders(handle.volumes_dir, lambda: _measurement_ids(handle), live)
    if swept:
        log.info("reset %d interrupted volume calculation(s) in project %s", len(swept), handle.id)
    return swept


def _measurement_ids(handle: ProjectHandle) -> set[str]:
    with handle.session() as s:
        return set(s.execute(select(VolumeMeasurement.id)).scalars())
