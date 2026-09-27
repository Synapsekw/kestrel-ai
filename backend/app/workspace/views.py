"""Workspace reads and conversions over other units' data (spec 2026-09-26-map-workspace sections
9.4 and 12): the finding anchor, the readout sample, findings in view, and (Task 9) the `frame=site`
variants of existing endpoints. Every read is bounded (plan budget)."""

from __future__ import annotations

import numpy as np
from affine import Affine
from sqlalchemy import select

from app.db.models import Finding, GeoMap, MapRun, Surface
from app.errors import AppError, not_found
from app.findings.anchors import centroid, check_geometry, to_wgs84
from app.maps.georef import box_corners
from app.projects.service import ProjectHandle
from app.surfaces.grid import open_surface
from app.surfaces.paths import surface_path
from app.workspace.frame import (
    BBox,
    SiteFrame,
    densify_bbox,
    geometry_from_site,
    geometry_to_site,
    map_pixels_to_site,
    not_in_frame,
    points_from_site,
    points_to_site,
    site_bbox_to_map_pixels,
    site_to_wgs84,
    wgs84_to_site,
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


# --- frame=site on existing endpoints (plan deviation 1: additive fields) ---------------------------


def _run_frame(handle: ProjectHandle, run_id: str) -> tuple[str, list[float], SiteFrame]:
    """The run's map CRS and geotransform, and the workspace frame, once the map is confirmed to be
    in it (the 4-line guard the brief repeated per function, factored per F8)."""
    with handle.session() as s:
        run = s.get(MapRun, run_id)
        if run is None:
            raise not_found("run", run_id)
        m = s.get(GeoMap, run.map_id)
        crs, gt = m.crs_wkt, m.geotransform
    frame = get_frame(handle)
    if not crs or not gt or not frame.holds(crs):
        raise not_in_frame("this map")
    return crs, gt, frame


def _corners_site(frame: SiteFrame, crs: str, gt: list[float], rows: list) -> list[list[list[float]]]:
    """Each row's box corners (`box_corners`) converted to site coordinates, one batched call."""
    flat: list[list[float]] = []
    counts: list[int] = []
    for r in rows:
        corners = [list(p) for p in box_corners(r.x, r.y, r.w, r.h, r.angle)]
        flat += corners
        counts.append(len(corners))
    site = map_pixels_to_site(frame, crs, gt, flat) if flat else []
    out, i = [], 0
    for n in counts:
        out.append(site[i : i + n])
        i += n
    return out


def detections_in_site(handle: ProjectHandle, run_id: str, bbox: str | None, min_conf, class_id):
    from app.maps import service as maps_service
    from app.maps.schemas import MapDetectionOut, MapDetectionPage

    crs, gt, frame = _run_frame(handle, run_id)
    px_bbox = None
    box = parse_bbox(bbox)
    if box is not None:
        px_bbox = ",".join(f"{v:.6f}" for v in site_bbox_to_map_pixels(frame, crs, gt, box))
    rows, truncated = maps_service.detections_in(handle, run_id, px_bbox, min_conf, class_id)
    corners = _corners_site(frame, crs, gt, rows)
    items = [
        MapDetectionOut.from_row(r).model_copy(update={"corners_site": c})
        for r, c in zip(rows, corners, strict=True)
    ]
    return MapDetectionPage(items=items, truncated=truncated)


def detection_with_site(handle: ProjectHandle, run_id: str, detection):
    """One detection (nextUnreviewedMapDetection) with its site corners (R-B1-12)."""
    crs, gt, frame = _run_frame(handle, run_id)
    (corners,) = _corners_site(frame, crs, gt, [detection])
    return detection.model_copy(update={"corners_site": corners})


def density_in_site(handle: ProjectHandle, run_id: str, cells: int, min_conf):
    from app.maps import service as maps_service
    from app.maps.schemas import MapDensity, MapDensityCell

    crs, gt, frame = _run_frame(handle, run_id)
    cell, rows = maps_service.density(handle, run_id, cells, min_conf)
    centres = [[(r["gx"] + 0.5) * cell, (r["gy"] + 0.5) * cell] for r in rows]
    site = map_pixels_to_site(frame, crs, gt, centres) if centres else []
    return MapDensity(
        cell_size=cell, cells=[MapDensityCell(**r, center_site=c) for r, c in zip(rows, site, strict=True)]
    )


def site_areas_in_site(handle: ProjectHandle, items: list) -> list:
    frame = get_frame(handle)
    if frame.kind == "local":
        return items
    out = []
    for item in items:
        try:
            out.append(item.model_copy(update={"polygon_site": wgs84_to_site(frame, item.polygon_wgs84)}))
        except AppError:
            out.append(item)
    return out


def volume_in_site(handle: ProjectHandle, out):
    with handle.session() as s:
        top = s.get(Surface, out.top_surface_id)
        crs = top.crs_wkt if top is not None else None
    frame = get_frame(handle)
    if top is None or not frame.holds(crs):
        return out
    try:
        return out.model_copy(update={"polygon_site": points_to_site(frame, crs, out.polygon_native)})
    except AppError:
        return out


def footprints_in_site(handle: ProjectHandle, surface_crs_wkt: str | None, items: list) -> list:
    frame = get_frame(handle)
    if not items or not frame.holds(surface_crs_wkt):
        return items
    flat = [p for f in items for p in f.ring]
    try:
        site = points_to_site(frame, surface_crs_wkt, flat)
    except AppError:
        return items
    out, i = [], 0
    for f in items:
        n = len(f.ring)
        out.append(f.model_copy(update={"ring_site": site[i : i + n]}))
        i += n
    return out
