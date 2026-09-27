"""The map workspace's one row (map spec §6), written straight into the project DB for tests."""

from __future__ import annotations

from pyproj import CRS
from sqlalchemy import delete


def set_site_frame(handle, crs_wkt: str | None) -> None:
    """A site frame in `crs_wkt`, or the local-metres frame for None."""
    from app.db.models import MapWorkspace

    with handle.session() as s:
        s.execute(delete(MapWorkspace))
        s.add(
            MapWorkspace(
                frame_kind="crs" if crs_wkt else "local",
                crs_wkt=crs_wkt,
                epsg=CRS.from_user_input(crs_wkt).to_epsg() if crs_wkt else None,
                state={},
                planned_surveys=[],
            )
        )
