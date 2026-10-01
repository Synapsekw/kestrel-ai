"""`GET /overview/site` (spec 2026-09-30-project-landing section 4.2). Bounds come from the hero map,
else the newest ready point cloud, else the photo sample. The photo sample is one IN-list read of
at most SITE_SAMPLE primary keys spread evenly over 1..max(rowid): bounded whatever the image count."""

from math import radians, sin

from sqlalchemy import bindparam, func, select, text
from sqlalchemy.orm import Session

from app.db.models import GeoMap, PointCloud, Source
from app.overview.service import hero_map_id, newest_ready_cloud_id

SITE_SAMPLE = 500
EARTH_RADIUS_M = 6_371_008.8
_SAMPLE_SQL = text("SELECT lon, lat FROM image WHERE rowid IN :ids").bindparams(
    bindparam("ids", expanding=True)
)


def probes(top: int, n: int = SITE_SAMPLE) -> list[int]:
    """Up to `n` distinct rowids spread evenly over 1..top."""
    if top <= n:
        return list(range(1, top + 1))
    return sorted({1 + (i * (top - 1)) // (n - 1) for i in range(n)})


def bbox_area_m2(b: list[float]) -> float:
    minlon, minlat, maxlon, maxlat = b
    return (
        abs(radians(maxlon - minlon)) * abs(sin(radians(maxlat)) - sin(radians(minlat))) * EARTH_RADIUS_M**2
    )


def photo_sample(s: Session) -> tuple[list[list[float]], int]:
    top = s.execute(text("SELECT max(rowid) FROM image")).scalar()
    if not top:
        return [], 0
    rows = s.execute(_SAMPLE_SQL, {"ids": probes(int(top))}).all()
    points = [[lon, lat] for lon, lat in rows if lon is not None and lat is not None]
    if not rows:
        return [], 0
    population = s.execute(
        select(func.coalesce(func.sum(Source.image_count), 0)).where(Source.kind == "images")
    ).scalar_one()
    return points, round(population * len(points) / len(rows))


def _bounds_of(points: list[list[float]]) -> list[float] | None:
    if not points:
        return None
    lons = [p[0] for p in points]
    lats = [p[1] for p in points]
    return [min(lons), min(lats), max(lons), max(lats)]


def build(s: Session) -> dict:
    points, total = photo_sample(s)
    bounds, source = None, None
    map_id = hero_map_id(s)
    if map_id:
        bounds, source = s.get(GeoMap, map_id).bounds_wgs84, "map"
    if bounds is None:
        cloud_id = newest_ready_cloud_id(s)
        if cloud_id:
            bounds = s.get(PointCloud, cloud_id).bounds_wgs84
            source = "point_cloud" if bounds else None
    if bounds is None:
        bounds = _bounds_of(points)
        source = "images" if bounds else None
    return {
        "center": [(bounds[0] + bounds[2]) / 2, (bounds[1] + bounds[3]) / 2] if bounds else None,
        "bounds_wgs84": bounds,
        "source": source,
        "area_m2": bbox_area_m2(bounds) if bounds else None,
        "photo_points": points,
        "photo_points_total": total,
    }
