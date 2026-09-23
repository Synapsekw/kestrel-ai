"""Site areas on a map (spec 2026-09-23 section 9.3, plan 2 deviation 2).

A `SiteArea` is stored in WGS84 and projected into each map's pixel space through the map's CRS and
geotransform. Membership is a box-centre point-in-polygon test in map pixels; nothing is clipped,
so no `shapely`. An area is "partly covered" when any of its vertices falls off the map.
"""

from __future__ import annotations

import math
from dataclasses import dataclass

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.db.models import GeoMap, SiteArea
from app.maps.georef import Georef

Point = tuple[float, float]


@dataclass(frozen=True)
class ProjectedArea:
    area_id: str
    polygon_px: list[Point]
    partial: bool


def _georef(gmap: GeoMap) -> Georef | None:
    if not gmap.geotransform or not gmap.crs_wkt or not gmap.width or not gmap.height:
        return None
    try:
        return Georef(gmap.geotransform, gmap.crs_wkt)
    except Exception:  # an unreadable CRS: the map simply has no areas
        return None


def _point_in_polygon(x: float, y: float, polygon: list[Point]) -> bool:
    """Even-odd ray casting; a point exactly on an edge may land either side."""
    inside = False
    j = len(polygon) - 1
    for i, (xi, yi) in enumerate(polygon):
        xj, yj = polygon[j]
        if (yi > y) != (yj > y) and x < (xj - xi) * (y - yi) / (yj - yi) + xi:
            inside = not inside
        j = i
    return inside


def _cross(o: Point, a: Point, b: Point) -> float:
    return (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0])


def _segments_cross(p1: Point, p2: Point, q1: Point, q2: Point) -> bool:
    d1, d2 = _cross(q1, q2, p1), _cross(q1, q2, p2)
    d3, d4 = _cross(p1, p2, q1), _cross(p1, p2, q2)
    return (d1 > 0) != (d2 > 0) and (d3 > 0) != (d4 > 0)


def _edges(polygon: list[Point]) -> list[tuple[Point, Point]]:
    return list(zip(polygon, polygon[1:] + polygon[:1], strict=True))


def project_area(gmap: GeoMap, area: SiteArea) -> ProjectedArea | None:
    """The area in this map's pixels, or None when it does not overlap the map at all."""
    georef = _georef(gmap)
    if georef is None or len(area.polygon_wgs84 or []) < 3:
        return None
    lons = [float(v[0]) for v in area.polygon_wgs84]
    lats = [float(v[1]) for v in area.polygon_wgs84]
    xs, ys = georef.wgs84_to_pixel(lons, lats)
    polygon = list(zip(xs, ys, strict=True))
    if not all(math.isfinite(c) for p in polygon for c in p):
        return None
    w, h = float(gmap.width), float(gmap.height)
    on_map = [0.0 <= x <= w and 0.0 <= y <= h for x, y in polygon]
    if all(on_map):
        return ProjectedArea(area.id, polygon, partial=False)
    corners: list[Point] = [(0.0, 0.0), (w, 0.0), (w, h), (0.0, h)]
    overlaps = (
        any(on_map)
        or any(_point_in_polygon(cx, cy, polygon) for cx, cy in corners)
        or any(_segments_cross(a, b, c, d) for a, b in _edges(polygon) for c, d in _edges(corners))
    )
    return ProjectedArea(area.id, polygon, partial=True) if overlaps else None


def areas_for_map(s: Session, gmap: GeoMap) -> list[ProjectedArea]:
    """Every project site area that overlaps this map, projected into its pixels."""
    areas = s.execute(select(SiteArea).order_by(SiteArea.created_at, SiteArea.id)).scalars()
    projected = (project_area(gmap, area) for area in areas)
    return [p for p in projected if p is not None]


def area_ids_for_point(areas: list[ProjectedArea], x: float, y: float) -> list[str]:
    """The ids of the areas whose polygon holds the point (a box centre), in the given order."""
    return [a.area_id for a in areas if _point_in_polygon(x, y, a.polygon_px)]
