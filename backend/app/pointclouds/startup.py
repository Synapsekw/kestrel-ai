"""Imports a crash cut short (spec §3 "Startup sweep"). Each step logs and continues."""

from __future__ import annotations

import logging
import shutil

from sqlalchemy import select

from app.db.models import PointCloud
from app.projects.service import ProjectHandle

INTERRUPTED = "import interrupted by application restart; import the file again"
log = logging.getLogger(__name__)


def sweep_interrupted(handle: ProjectHandle, runner) -> list[str]:
    swept: list[str] = []
    live: set[str] = set()
    try:
        with handle.session() as s:
            for row in s.execute(select(PointCloud).where(PointCloud.status == "importing")).scalars():
                if row.job_id and runner.is_live(row.job_id):
                    live.add(row.id)
                    continue
                row.status, row.error = "failed", INTERRUPTED
                swept.append(row.id)
    except Exception:
        log.exception("could not mark interrupted point-cloud imports in project %s", handle.id)
    base = handle.pointclouds_dir
    for cloud_id in swept:
        shutil.rmtree(base / cloud_id / "octree", ignore_errors=True)
    try:
        if base.is_dir():
            for folder in base.iterdir():
                if folder.name not in live:
                    shutil.rmtree(folder / ".work", ignore_errors=True)
    except Exception:
        log.exception("could not sweep point-cloud work folders in project %s", handle.id)
    if swept:
        log.info("marked %d interrupted point-cloud import(s) failed in project %s", len(swept), handle.id)
    return swept
