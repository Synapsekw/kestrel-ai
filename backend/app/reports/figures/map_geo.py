"""Pure geometry for R9-M's map figures (reports spec §9.3): coordinates into an item's CRS, GeoJSON
builders, WGS84 frames for survey pairs. Nothing here reads a raster; `covering_map` reads a few
`geo_map` columns (tens of rows)."""

from __future__ import annotations

import math
from collections.abc import Sequence
from datetime import date

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.db.models import GeoMap
from app.workspace.frame import transform_xy

BBox = tuple[float, float, float, float]
Points = Sequence[Sequence[float]]
ASPECT = 4 / 3
# Ruling 6: False only if R3's map renderer cannot draw a LineString (Task 1 Step 1). Confirmed True:
# the merged app/reports/snapshots/map_view.py draws Point, LineString and Polygon geometry.
LINESTRING_SUPPORTED = True


def to_crs(points: Points, src_wkt: str | None, dst_wkt: str | None) -> list[list[float]] | None:
    """`points` from `src_wkt` into `dst_wkt` (None = local metres). None for no points, a local /
    georeferenced mismatch, or a point pyproj cannot place."""
    pts = [[float(p[0]), float(p[1])] for p in points]
    if not pts:
        return None
    if src_wkt is None or dst_wkt is None:
        return pts if src_wkt is None and dst_wkt is None else None
    xs, ys = transform_xy(src_wkt, dst_wkt, [p[0] for p in pts], [p[1] for p in pts], strict=False)
    out = [[float(x), float(y)] for x, y in zip(xs, ys, strict=True)]
    return out if all(math.isfinite(v) for p in out for v in p) else None


def point(x: float, y: float) -> dict:
    return {"type": "Point", "coordinates": [float(x), float(y)]}


def polygon(ring: Points) -> dict:
    pts = [list(p) for p in ring]
    if pts and pts[0] != pts[-1]:
        pts.append(list(pts[0]))
    return {"type": "Polygon", "coordinates": [pts]}


def line(points: Points) -> dict:
    pts = [list(p) for p in points]
    if LINESTRING_SUPPORTED:
        return {"type": "LineString", "coordinates": pts}
    return {"type": "Polygon", "coordinates": [pts + [list(p) for p in reversed(pts[:-1])]]}


def centroid(points: Points) -> tuple[float, float]:
    n = len(points)
    return sum(p[0] for p in points) / n, sum(p[1] for p in points) / n


def contains(bbox: Sequence[float], lon: float, lat: float) -> bool:
    return bbox[0] <= lon <= bbox[2] and bbox[1] <= lat <= bbox[3]


def intersect(a: Sequence[float], b: Sequence[float]) -> BBox | None:
    lo_x, lo_y = max(a[0], b[0]), max(a[1], b[1])
    hi_x, hi_y = min(a[2], b[2]), min(a[3], b[3])
    return (lo_x, lo_y, hi_x, hi_y) if hi_x > lo_x and hi_y > lo_y else None


def aspect_4_3(bbox: Sequence[float], centre: tuple[float, float] | None = None) -> BBox:
    """The largest 4:3 (in metres) window inside `bbox`, centred on `centre` where it fits."""
    minx, miny, maxx, maxy = bbox
    k = math.cos(math.radians((miny + maxy) / 2)) or 1e-12
    w_deg, h_deg = maxx - minx, maxy - miny
    if w_deg <= 0 or h_deg <= 0:
        return (minx, miny, maxx, maxy)
    if (w_deg * k) / h_deg > ASPECT:
        w_deg = h_deg * ASPECT / k
    else:
        h_deg = w_deg * k / ASPECT
    cx, cy = centre if centre else ((minx + maxx) / 2, (miny + maxy) / 2)
    cx = min(max(cx, minx + w_deg / 2), maxx - w_deg / 2)
    cy = min(max(cy, miny + h_deg / 2), maxy - h_deg / 2)
    return (cx - w_deg / 2, cy - h_deg / 2, cx + w_deg / 2, cy + h_deg / 2)


def survey_day(gmap) -> date:
    """A survey's date: `captured_on`, else the import date (timeline rule)."""
    return gmap.captured_on or gmap.created_at.date()


def day_text(d: date) -> str:
    return d.strftime("%d %b %Y")


def covering_map(s: Session, lon: float, lat: float) -> GeoMap | None:
    """The newest ready map whose WGS84 footprint holds the point."""
    rows = s.execute(
        select(GeoMap).where(GeoMap.status == "ready", GeoMap.bounds_wgs84.is_not(None))
    ).scalars()
    best = None
    for m in rows:
        if m.bounds_wgs84 and contains(m.bounds_wgs84, lon, lat):
            if best is None or (survey_day(m), m.created_at, m.id) > (
                survey_day(best),
                best.created_at,
                best.id,
            ):
                best = m
    return best
