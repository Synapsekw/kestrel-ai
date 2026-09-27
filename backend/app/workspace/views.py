"""Workspace reads and conversions over other units' data (spec 2026-09-26-map-workspace sections
9.4 and 12): the finding anchor, the readout sample, findings in view, and (Task 9) the `frame=site`
variants of existing endpoints. Every read is bounded (plan budget)."""

from __future__ import annotations

import numpy as np
from affine import Affine
from sqlalchemy import select

from app.db.models import Finding, GeoMap, Surface
from app.errors import AppError, not_found
from app.findings.anchors import centroid, check_geometry, to_wgs84
from app.projects.service import ProjectHandle
from app.surfaces.grid import open_surface
from app.surfaces.paths import surface_path
from app.workspace.frame import (
    BBox,
    densify_bbox,
    geometry_from_site,
    geometry_to_site,
    points_from_site,
    site_to_wgs84,
)
from app.workspace.schemas import AnchorOut, MapFindingPinOut, SurfaceZOut
from app.workspace.service import get_frame

MAX_FINDINGS = 5000
MAX_ANCHOR_VERTICES = 5000
NO_ORTHO = "Findings need an orthomosaic under them."


def parse_bbox(text: str | None) -> BBox | None:
    if not text:
        return None
    try:
        x0, y0, x1, y1 = (float(v) for v in text.split(","))
    except ValueError:
        raise AppError("validation_error", "bbox must be minx,miny,maxx,maxy", 422) from None
    return min(x0, x1), min(y0, y1), max(x0, x1), max(y0, y1)


def convert_anchor(handle: ProjectHandle, map_id: str, geometry_site: dict) -> AnchorOut:
    """Ruling R-B1-6: the map (404, no_coordinates), the frame (local_frame), the geometry, then the
    centroid must be on the map (outside_map, plan deviation 7)."""
    with handle.session() as s:
        m = s.get(GeoMap, map_id)
        if m is None or m.status != "ready":
            raise not_found("map", map_id)
        crs, gt, width, height = m.crs_wkt, m.geotransform, m.width, m.height
    if not crs or not gt:
        raise AppError("no_coordinates", f"map {map_id} has no coordinates", 422)
    frame = get_frame(handle)
    if frame.kind == "local":
        raise AppError("local_frame", "findings need a map CRS; the workspace is in local metres", 422)
    site = check_geometry(geometry_site)
    vertices = 1 if site["type"] == "Point" else len(site["coordinates"][0])
    if vertices > MAX_ANCHOR_VERTICES:
        raise AppError("invalid_geometry", f"an anchor has at most {MAX_ANCHOR_VERTICES} vertices", 422)
    try:
        native = geometry_from_site(frame, crs, site)
    except AppError:
        raise AppError("outside_map", NO_ORTHO, 422) from None
    cx, cy = centroid(native)
    px, py = ~Affine.from_gdal(*gt) * (cx, cy)
    if not (0 <= px <= width and 0 <= py <= height):
        raise AppError("outside_map", NO_ORTHO, 422)
    lon, lat = to_wgs84(crs, cx, cy)
    if lon is None or lat is None:
        raise AppError("outside_map", NO_ORTHO, 422)
    return AnchorOut(map_id=map_id, geometry=native, lon=lon, lat=lat)


def sample(handle: ProjectHandle, x: float, y: float, surface_ids: list[str]) -> list[SurfaceZOut]:
    """Ruling R-B1-5: a surface that cannot answer gives null. One 2 x 2 read per surface."""
    frame = get_frame(handle)
    out = []
    for sid in surface_ids:
        z = None
        with handle.session() as s:
            row = s.get(Surface, sid)
            ok = row is not None and row.status == "ready" and frame.holds(row.crs_wkt)
            crs = row.crs_wkt if ok else None
        if ok:
            try:
                ((sx, sy),) = points_from_site(frame, crs, [[x, y]])
                with open_surface(surface_path(handle, sid)) as reader:
                    v = float(reader.sample_bilinear(np.array([sx]), np.array([sy]))[0])
                z = v if np.isfinite(v) else None
            except (AppError, OSError):
                z = None
        out.append(SurfaceZOut(surface_id=sid, z=z))
    return out


def findings_in_view(
    handle: ProjectHandle, bbox: BBox, map_ids: list[str] | None
) -> tuple[list[MapFindingPinOut], bool]:
    frame = get_frame(handle)
    if frame.kind == "local":
        return [], False  # plan deviation 6
    lonlat = np.asarray(site_to_wgs84(frame, densify_bbox(bbox)))
    q = select(Finding).where(
        Finding.anchor_kind == "map",
        Finding.lon.between(float(lonlat[:, 0].min()), float(lonlat[:, 0].max())),
        Finding.lat.between(float(lonlat[:, 1].min()), float(lonlat[:, 1].max())),
    )
    if map_ids:
        q = q.where(Finding.map_id.in_(map_ids))
    q = q.order_by(Finding.severity.desc().nulls_last(), Finding.number).limit(MAX_FINDINGS + 1)
    with handle.session() as s:
        rows = list(s.execute(q).scalars())
        truncated = len(rows) > MAX_FINDINGS
        rows = rows[:MAX_FINDINGS]
        ids = {r.map_id for r in rows}
        crs = (
            dict(s.execute(select(GeoMap.id, GeoMap.crs_wkt).where(GeoMap.id.in_(ids))).all()) if ids else {}
        )
        out = []
        for r in rows:
            wkt = crs.get(r.map_id)
            if not wkt:
                continue  # the map is gone or has no CRS: no place on the site
            try:
                geometry = geometry_to_site(frame, wkt, r.geometry)
            except AppError:
                continue
            out.append(
                MapFindingPinOut(
                    id=r.id,
                    number=r.number,
                    type_id=r.type_id,
                    severity=r.severity,
                    status=r.status,
                    created_by=r.created_by,
                    map_id=r.map_id,
                    geometry_site=geometry,
                )
            )
    return out, truncated
