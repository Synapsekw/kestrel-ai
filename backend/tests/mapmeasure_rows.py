"""Rows for the map-measurement and Measurements-union tests (plan maps-b4): the site frame, map
measurements, cloud and volume measurements, inserted directly. No raster is needed for the union."""

from __future__ import annotations

from datetime import datetime

from pyproj import CRS
from sqlalchemy import select

from app.db.models import CloudMeasurement, MapMeasurement, MapWorkspace, VolumeMeasurement


def set_site_frame(handle, epsg: int | None) -> None:
    """The one map_workspace row: a CRS frame for `epsg`, or the local-metres frame for None."""
    with handle.session() as s:
        row = s.execute(select(MapWorkspace)).scalars().first()
        if row is None:
            row = MapWorkspace(state={}, planned_surveys=[])
            s.add(row)
        row.frame_kind = "local" if epsg is None else "crs"
        row.crs_wkt = None if epsg is None else CRS.from_epsg(epsg).to_wkt()
        row.epsg = epsg


def add_map_measurement(
    handle,
    *,
    kind: str,
    created_at: datetime,
    updated_at: datetime | None = None,
    name: str = "m",
    results: dict | None = None,
    map_id: str | None = None,
    surface_ids: tuple[str, ...] = (),
    epsg: int | None = 32639,
) -> str:
    vertices = [[0.0, 0.0], [1.0, 0.0], [1.0, 1.0]] if kind == "area" else [[0.0, 0.0], [1.0, 0.0]]
    with handle.session() as s:
        row = MapMeasurement(
            kind=kind,
            name=name,
            crs_wkt=None if epsg is None else CRS.from_epsg(epsg).to_wkt(),
            epsg=epsg,
            geometry=vertices,
            surface_ids=list(surface_ids),
            map_id=map_id,
            results=results or {},
            created_at=created_at,
            updated_at=updated_at or created_at,
        )
        s.add(row)
        s.flush()
        return row.id


def add_cloud_measurement(
    handle,
    cloud_id: str,
    *,
    created_at: datetime,
    updated_at: datetime | None = None,
    kind: str = "distance",
    name: str = "c",
    results: dict | None = None,
    z: float = 12.5,
) -> str:
    with handle.session() as s:
        row = CloudMeasurement(
            point_cloud_id=cloud_id,
            kind=kind,
            name=name,
            points=[{"x": 0.0, "y": 0.0, "z": z, "uncertainty_m": 0.01}],
            results=results or {},
            created_at=created_at,
            updated_at=updated_at or created_at,
        )
        s.add(row)
        s.flush()
        return row.id


def add_volume(
    handle,
    surface_id: str,
    *,
    created_at: datetime,
    updated_at: datetime | None = None,
    name: str = "v",
    status: str = "ready",
    net: float | None = None,
) -> str:
    with handle.session() as s:
        row = VolumeMeasurement(
            name=name,
            polygon_native=[[0.0, 0.0], [1.0, 0.0], [1.0, 1.0]],
            top_surface_id=surface_id,
            base={"kind": "toe_plane", "z": None, "surface_id": None},
            status=status,
            results=None if net is None else {"net_m3": net},
            created_at=created_at,
            updated_at=updated_at or created_at,
        )
        s.add(row)
        s.flush()
        return row.id
