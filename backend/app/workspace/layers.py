"""Every layer the workspace can show, in the site frame (spec 2026-09-26-map-workspace section 12,
`listWorkspaceLayers`): one row per ready map, surface and drawing (tens), newest first per group."""

from __future__ import annotations

import math
from datetime import date

import numpy as np
from sqlalchemy import select

from app.db.models import Drawing, GeoMap, PointCloud, Surface
from app.errors import AppError
from app.projects.service import ProjectHandle
from app.workspace import grid
from app.workspace.frame import (
    EDGE_SAMPLES,
    SiteFrame,
    affine_points_to_site,
    densify_bbox,
    map_pixels_to_site,
    points_to_site,
)
from app.workspace.schemas import WorkspaceLayerOut
from app.workspace.service import get_frame
from app.workspace.tiles import map_native_m

VECTOR_FORMATS = {"dxf", "landxml"}


def human_size(n: int) -> str:
    size = float(n)
    for unit in ("B", "KB", "MB"):
        if size < 1000:
            return f"{size:.0f} {unit}" if unit != "MB" else f"{size:.1f} {unit}"
        size /= 1000
    return f"{size:.1f} GB"


def _footprint(frame: SiteFrame, crs_wkt: str | None, convert) -> list[float] | None:
    """The site bounding box of an item's densified outline, or None when it is not in the frame."""
    if not frame.holds(crs_wkt):
        return None
    try:
        ring = np.asarray(convert())
    except AppError:
        return None  # not projectable into this frame
    return [
        float(ring[:, 0].min()),
        float(ring[:, 1].min()),
        float(ring[:, 0].max()),
        float(ring[:, 1].max()),
    ]


def map_date(m: GeoMap) -> tuple[date, bool]:
    """A map's survey date: its own `captured_on`, else its import date (flagged). Controller ruling
    F10: the one rule for a map's date, used by both `layers` and `surveys`."""
    return (m.captured_on, False) if m.captured_on else (m.created_at.date(), True)


def surface_date(row: Surface, cloud_captured: date | None) -> tuple[date | None, bool]:
    """A surface's survey date: designs are undated; a DSM or DEM uses its own date, else its
    cloud's, else its import date (flagged)."""
    if row.kind == "design":
        return None, False
    d = row.captured_on or cloud_captured
    return (d, False) if d else (row.created_at.date(), True)


def _map_row(frame: SiteFrame, m: GeoMap) -> WorkspaceLayerOut:
    d, imported = map_date(m)
    footprint, native = None, None
    if m.crs_wkt and m.geotransform:
        native = map_native_m(m)
        outline = densify_bbox((0.0, 0.0, float(m.width), float(m.height)), EDGE_SAMPLES)
        footprint = _footprint(
            frame, m.crs_wkt, lambda: map_pixels_to_site(frame, m.crs_wkt, m.geotransform, outline)
        )
    gsd = f"{m.gsd_cm:.1f} cm GSD · " if m.gsd_cm else ""
    return WorkspaceLayerOut(
        kind="map",
        id=m.id,
        name=m.name,
        group="base",
        status=m.status,
        in_frame=footprint is not None,
        tile_kind="map",
        vector=False,
        version=m.id,
        date=d,
        date_is_import_date=imported,
        footprint_site=footprint,
        max_zoom=grid.max_zoom_for(native) if footprint and native else None,
        meta=f"{gsd}{human_size(m.source_size)}",
        surface_kind=None,
        elevation_role=None,
        drawing_format=None,
        placed=None,
    )


def _surface_row(frame: SiteFrame, row: Surface, cloud_captured: date | None) -> WorkspaceLayerOut:
    d, imported = surface_date(row, cloud_captured)
    outline = densify_bbox(tuple(row.bounds_native), EDGE_SAMPLES)
    footprint = _footprint(frame, row.crs_wkt, lambda: points_to_site(frame, row.crs_wkt, outline))
    meta = f"{row.z_min:.1f} – {row.z_max:.1f} m" if row.z_min is not None and row.z_max is not None else ""
    return WorkspaceLayerOut(
        kind="surface",
        id=row.id,
        name=row.name,
        group="elevation",
        status=row.status,
        in_frame=footprint is not None,
        tile_kind="surface",
        vector=False,
        version=row.job_id or "1",
        date=d,
        date_is_import_date=imported,
        footprint_site=footprint,
        max_zoom=grid.max_zoom_for(float(row.cell_size_m)) if footprint else None,
        meta=meta,
        surface_kind=row.kind,
        elevation_role=row.elevation_role,
        drawing_format=None,
        placed=None,
    )


def _drawing_meta(georef: dict | None) -> str:
    if not georef or not georef.get("method"):
        return "not placed"
    if georef["method"] == "control_points":
        n = len(georef.get("points") or [])
        rmse = georef.get("rmse_m")
        return f"{n} control pts · RMSE {rmse * 100:.0f} cm" if rmse is not None else f"{n} control pts"
    return "placed by coordinates"


def _drawing_row(frame: SiteFrame, row: Drawing) -> WorkspaceLayerOut:
    georef = row.georef or {}
    vector = row.format in VECTOR_FORMATS
    placed = bool(georef.get("method")) and georef.get("transform") is not None and bool(row.extent_src)
    footprint, max_zoom = None, None
    if placed:
        t, dst = georef["transform"], georef.get("dst_crs_wkt")
        outline = densify_bbox(tuple(row.extent_src), EDGE_SAMPLES)
        footprint = _footprint(frame, dst, lambda: affine_points_to_site(frame, t, dst, outline))
        if footprint is not None:
            native = math.sqrt(abs(t[0] * t[4] - t[1] * t[3]))
            max_zoom = grid.Z_MAX if vector or not native else grid.max_zoom_for(native)
    return WorkspaceLayerOut(
        kind="drawing",
        id=row.id,
        name=row.name,
        group="drawing",
        status=row.status,
        in_frame=footprint is not None,
        tile_kind=None if vector else "drawing_raster",
        vector=vector,
        version=str(row.georef_version or 0),
        date=row.captured_on,
        date_is_import_date=False,
        footprint_site=footprint,
        max_zoom=max_zoom,
        meta=_drawing_meta(row.georef),
        surface_kind=None,
        elevation_role=None,
        drawing_format=row.format,
        placed=placed,
    )


def list_layers(handle: ProjectHandle) -> tuple[SiteFrame, list[WorkspaceLayerOut]]:
    frame = get_frame(handle)
    out: list[WorkspaceLayerOut] = []
    with handle.session() as s:
        maps = s.execute(select(GeoMap).where(GeoMap.status == "ready")).scalars().all()
        for m in sorted(
            maps, key=lambda m: (m.captured_on or m.created_at.date(), m.created_at), reverse=True
        ):
            out.append(_map_row(frame, m))
        clouds = dict(s.execute(select(PointCloud.id, PointCloud.captured_on)).all())
        surfaces = s.execute(select(Surface).where(Surface.status == "ready")).scalars().all()
        for row in sorted(surfaces, key=lambda r: r.created_at, reverse=True):
            out.append(_surface_row(frame, row, clouds.get(row.point_cloud_id)))
        drawings = s.execute(select(Drawing).where(Drawing.status == "ready")).scalars().all()
        for row in sorted(drawings, key=lambda r: r.created_at, reverse=True):
            out.append(_drawing_row(frame, row))
    return frame, out
