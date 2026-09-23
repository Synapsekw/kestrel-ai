"""Site areas: create, redraw, rename, delete, and the `area_recount` job (spec 2026-09-23 section 9.3).

An area is stored in WGS84 only. The UI draws it on one map, in that map's pixels, and the server
converts the outline with the map's georeference, so the same area lands on every other map.
Every change to an outline submits one `area_recount` job, which rebuilds each map run's
`area_counts` (and, through the same counting rules, its totals) from its detections.
"""

from __future__ import annotations

import math
from collections.abc import Sequence

from sqlalchemy import select

from app.db.models import GeoMap, MapRun, SiteArea
from app.detect.areas import areas_for_map
from app.detect.counts import recount_map_run
from app.errors import AppError, not_found
from app.jobs.registry import register_job_type
from app.jobs.runner import JobContext
from app.maps.georef import Georef
from app.projects.service import ProjectHandle

AREA_RECOUNT_JOB = "area_recount"
MAX_VERTICES = 1000


def _invalid(message: str) -> AppError:
    return AppError("validation_error", message, 422)


def validate_wgs84(points: Sequence[Sequence[float]]) -> list[list[float]]:
    """At least three finite [lon, lat] points on the globe, returned as plain float pairs."""
    if len(points) < 3:
        raise _invalid("a site area needs at least three points")
    if len(points) > MAX_VERTICES:
        raise _invalid(f"a site area has at most {MAX_VERTICES} points")
    out: list[list[float]] = []
    for p in points:
        if len(p) != 2:
            raise _invalid("each point is [longitude, latitude]")
        lon, lat = float(p[0]), float(p[1])
        if not (math.isfinite(lon) and math.isfinite(lat)):
            raise _invalid("a point is not a finite number")
        if not (-180.0 <= lon <= 180.0 and -90.0 <= lat <= 90.0):
            raise _invalid(f"[{lon}, {lat}] is not a longitude and latitude")
        out.append([lon, lat])
    return out


def outline_wgs84(
    handle: ProjectHandle,
    polygon_wgs84: Sequence[Sequence[float]] | None,
    map_id: str | None,
    polygon_px: Sequence[Sequence[float]] | None,
) -> list[list[float]] | None:
    """The outline in WGS84 from either shape of the request; None when neither was given."""
    if polygon_wgs84 is not None and (map_id is not None or polygon_px is not None):
        raise _invalid("give either polygon_wgs84, or map_id with polygon_px, not both")
    if polygon_wgs84 is not None:
        return validate_wgs84(polygon_wgs84)
    if map_id is None and polygon_px is None:
        return None
    if map_id is None or polygon_px is None:
        raise _invalid("a polygon drawn on a map needs both map_id and polygon_px")
    if len(polygon_px) < 3:
        raise _invalid("a site area needs at least three points")
    with handle.session() as s:
        gmap = s.get(GeoMap, map_id)
        if gmap is None:
            raise not_found("map", map_id)
        gt, wkt = gmap.geotransform, gmap.crs_wkt
    if not gt or not wkt:
        raise _invalid("this map has no georeference, so an area drawn on it cannot be placed")
    georef = Georef(gt, wkt)
    points = []
    for p in polygon_px:
        if len(p) != 2 or not all(math.isfinite(float(c)) for c in p):
            raise _invalid("each pixel point is [x, y]")
        points.append(georef.pixel_to_wgs84(float(p[0]), float(p[1])))
    return validate_wgs84(points)


def _detached(s, row: SiteArea) -> SiteArea:
    s.flush()
    s.refresh(row)
    s.expunge(row)
    return row


def list_areas(handle: ProjectHandle) -> list[SiteArea]:
    with handle.session() as s:
        rows = list(s.execute(select(SiteArea).order_by(SiteArea.created_at, SiteArea.id)).scalars())
        for r in rows:
            s.expunge(r)
    return rows


def create_area(handle: ProjectHandle, name: str, polygon_wgs84: list[list[float]]) -> SiteArea:
    with handle.session() as s:
        row = SiteArea(name=name, polygon_wgs84=polygon_wgs84)
        s.add(row)
        return _detached(s, row)


def update_area(
    handle: ProjectHandle, area_id: str, name: str | None, polygon_wgs84: list[list[float]] | None
) -> SiteArea:
    with handle.session() as s:
        row = s.get(SiteArea, area_id)
        if row is None:
            raise not_found("site area", area_id)
        if name is not None:
            row.name = name
        if polygon_wgs84 is not None:
            row.polygon_wgs84 = polygon_wgs84
        return _detached(s, row)


def delete_area(handle: ProjectHandle, area_id: str) -> None:
    with handle.session() as s:
        row = s.get(SiteArea, area_id)
        if row is None:
            raise not_found("site area", area_id)
        s.delete(row)


@register_job_type(AREA_RECOUNT_JOB)
def run_area_recount(ctx: JobContext) -> dict:
    """Rebuild every map run's counts against the current site areas, one run per transaction.

    Bounded: each run streams its detections through `recount_map_run` (`yield_per`), and the
    site areas are projected once per map."""
    with ctx.project.session() as s:
        run_ids = list(
            s.execute(select(MapRun.id, MapRun.map_id).order_by(MapRun.map_id, MapRun.created_at)).all()
        )
    total = len(run_ids)
    ctx.progress(0.0, f"Recounting {total} map runs")
    projected: dict[str, list] = {}
    for i, (run_id, map_id) in enumerate(run_ids):
        ctx.check_cancelled()
        with ctx.project.session() as s:
            run, gmap = s.get(MapRun, run_id), s.get(GeoMap, map_id)
            if run is None or gmap is None:  # deleted while the job ran
                continue
            if map_id not in projected:
                projected[map_id] = areas_for_map(s, gmap)
            recount_map_run(s, run, projected[map_id])
        ctx.progress((i + 1) / total, f"Recounted {i + 1} of {total} map runs")
    return {"runs": total}
