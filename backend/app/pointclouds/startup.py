"""Imports a crash cut short (spec §3 "Startup sweep"). Each step logs and continues.

The folder passes run only when the rows could be read: without them a live import's `.work`, or a
whole cloud, would look like leftovers. A folder with no row is one a delete could not remove (on
Windows an open octree stream holds it); the folders are listed before the rows are read, and a row
is always written before its folder, so a folder listed with no row is never a new import's.
"""

from __future__ import annotations

import logging
import shutil
from datetime import UTC, datetime
from pathlib import Path

from sqlalchemy import select

from app.db.models import CloudMeasurement, PointCloud
from app.projects.service import ProjectHandle

INTERRUPTED = "import interrupted by application restart; import the file again"
log = logging.getLogger(__name__)


def _folders(base: Path) -> list[Path]:
    try:
        return [f for f in base.iterdir() if f.is_dir()] if base.is_dir() else []
    except OSError:
        log.exception("could not list the point-cloud folders in %s", base)
        return []


def sweep_interrupted(handle: ProjectHandle, runner) -> list[str]:
    base = handle.pointclouds_dir
    folders = _folders(base)  # before the rows: see the module docstring
    swept: list[str] = []
    live: set[str] = set()
    known: set[str] = set()
    try:
        with handle.session() as s:
            for row in s.execute(select(PointCloud)).scalars():
                known.add(row.id)
                if row.status != "importing":
                    continue
                if row.job_id and runner.is_live(row.job_id):
                    live.add(row.id)
                    continue
                row.status, row.error = "failed", INTERRUPTED
                swept.append(row.id)
    except Exception:
        log.exception("could not mark interrupted point-cloud imports in project %s", handle.id)
        return []  # no rows, no folder pass: it could take a live import's work
    for cloud_id in swept:
        shutil.rmtree(base / cloud_id / "octree", ignore_errors=True)
    for folder in folders:
        try:
            if folder.name not in known:
                shutil.rmtree(folder)
                log.info("removed the point-cloud folder %s, which has no cloud", folder.name)
            elif folder.name not in live:
                shutil.rmtree(folder / ".work", ignore_errors=True)
        except Exception:
            log.exception("could not sweep the point-cloud folder %s in project %s", folder.name, handle.id)
    if swept:
        log.info("marked %d interrupted point-cloud import(s) failed in project %s", len(swept), handle.id)
    return swept


def sweep_profiles(handle: ProjectHandle, runner) -> list[str]:
    """Profiles a restart cut short (spec 2026-09-26-point-cloud-workspace section 8.4 step 5).

    A `computing` profile whose job this process does not hold becomes `failed` ("interrupted by
    application restart; save the profile again"). Then, per cloud folder, `profiles/*.partial`
    files not being written by a live job are removed, and so are `profiles/*.json` files whose
    measurement no longer exists (plan Ruling 14). The file pass runs only when the rows could be
    read. Returns the measurement ids it marked. Each failure logs and the step continues."""
    from app.pointclouds import profile  # not at module level: profile imports the jobs runner

    swept: list[str] = []
    known: set[str] = set()
    writing: set[str] = set()
    try:
        with handle.session() as s:
            query = select(CloudMeasurement).where(CloudMeasurement.kind == "profile")
            for row in s.execute(query).scalars():
                known.add(row.id)
                if row.status != "computing":
                    continue
                if row.job_id and runner.is_live(row.job_id):
                    writing.add(row.id)
                    continue
                row.status, row.error = "failed", profile.INTERRUPTED
                row.updated_at = datetime.now(UTC)
                swept.append(row.id)
    except Exception:
        log.exception("could not mark interrupted cloud profiles in project %s", handle.id)
        return []
    for folder in _folders(handle.pointclouds_dir):
        profiles = folder / "profiles"
        if not profiles.is_dir():
            continue
        try:
            for f in profiles.iterdir():
                stale_partial = f.suffix == ".partial" and f.stem not in writing
                orphan = f.suffix == ".json" and f.stem not in known
                if stale_partial or orphan:
                    f.unlink(missing_ok=True)
        except Exception:
            log.exception(
                "could not sweep the profiles of point cloud %s in project %s", folder.name, handle.id
            )
    if swept:
        log.info("marked %d interrupted cloud profile(s) failed in project %s", len(swept), handle.id)
    return swept


def sweep_views(handle: ProjectHandle) -> int:
    """Report-view files with no `cloud_view` row, and `views/.partial-*` a crash left (section 11.2).
    Returns the number of files removed (`app/pointclouds/views.py::sweep_all`)."""
    from app.pointclouds import views

    return views.sweep_all(handle)
