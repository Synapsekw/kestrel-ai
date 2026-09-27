"""Fixture writers for the drawings tests (plan 2026-09-27-maps-b3). Nothing binary is committed."""

from __future__ import annotations

from pyproj import CRS
from sqlalchemy import delete

from app.db.models import MapWorkspace

BASE = "/api/v1/projects"


def seed_frame(handle, epsg: int | None) -> None:
    """The project's site frame, as M-B1's GET /map-workspace would create it (epsg None = local)."""
    with handle.session() as s:
        s.execute(delete(MapWorkspace))
        s.add(
            MapWorkspace(
                id=1,
                frame_kind="local" if epsg is None else "crs",
                crs_wkt=None if epsg is None else CRS.from_epsg(epsg).to_wkt(),
                epsg=epsg,
                state={},
                planned_surveys=[],
            )
        )
