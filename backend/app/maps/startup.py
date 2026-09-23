"""Where a map lives on disk, and the sweep for imports a crash cut short (spec section 3)."""

import logging
from pathlib import Path

from sqlalchemy import select

from app.db.models import GeoMap
from app.projects.service import ProjectHandle

INTERRUPTED_IMPORT = "import interrupted by application restart; import the file again"
log = logging.getLogger(__name__)


def map_dir(handle: ProjectHandle, map_id: str) -> Path:
    return handle.maps_dir / map_id


def map_raster_path(handle: ProjectHandle, map_id: str) -> Path:
    """The display raster: 8-bit RGB, 512 px blocks, internal overviews and mask."""
    return map_dir(handle, map_id) / "map.tif"


def sweep_interrupted_imports(handle: ProjectHandle, runner) -> list[str]:
    """Mark `importing` maps whose job this process does not hold as `failed`; returns their ids."""
    swept: list[str] = []
    with handle.session() as s:
        for row in s.execute(select(GeoMap).where(GeoMap.status == "importing")).scalars():
            if row.job_id and runner.is_live(row.job_id):
                continue
            row.status, row.error = "failed", INTERRUPTED_IMPORT
            swept.append(row.id)
    if swept:
        log.info("marked %d interrupted map import(s) failed in project %s", len(swept), handle.id)
    return swept
