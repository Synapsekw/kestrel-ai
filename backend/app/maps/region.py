"""Region-scoped AI runs (map workspace spec §9.3, decision M14).

A region is drawn in the site frame and stored on the run in map pixels (`MapRun.region_px`). The
`map_detect` job plans the map's windows as always and looks only at those that intersect the region,
keeping only detections whose centre lies inside it. A region run never speaks for a survey
(`timeline.is_survey_run`).
"""

from __future__ import annotations

from collections.abc import Sequence

import numpy as np
import rasterio
import shapely
from affine import Affine
from shapely.geometry import Polygon, box
from sqlalchemy.orm import Session

from app.db.models import GeoMap
from app.errors import AppError
from app.maps import raster
from app.maps.site_crs import site_to_crs
from app.maps.startup import map_raster_path
from app.maps.windows import SKIP_MASKED, MapWindow, gsd_scale, masked_fraction, plan_windows
from app.providers.base import Detection


def invalid(message: str) -> AppError:
    return AppError("invalid_geometry", message, 422)


def polygon(region_px: Sequence[Sequence[float]]) -> Polygon:
    """The region as a valid polygon with an area, or 422."""
    if len(region_px) < 3:
        raise invalid("A region needs at least three points.")
    poly = Polygon([(float(p[0]), float(p[1])) for p in region_px])
    if not poly.is_valid or poly.area <= 0:
        raise invalid("The region crosses itself or has no area; draw it again.")
    return poly


def to_map_px(s: Session, gmap: GeoMap, polygon_site: Sequence[Sequence[float]]) -> list[list[float]]:
    """The site-frame polygon in the map's pixels (through its CRS and geotransform, rotation included)."""
    if not gmap.geotransform or not gmap.crs_wkt:
        raise invalid(f"{gmap.name} has no georeference, so a region cannot be placed on it.")
    native = site_to_crs(s, polygon_site, gmap.crs_wkt)
    inverse = ~Affine.from_gdal(*gmap.geotransform)
    px = [[float(c) for c in inverse @ (x, y)] for x, y in native]
    polygon(px)
    return px


def windows_in(wins: list[MapWindow], region_px: Sequence[Sequence[float]]) -> list[MapWindow]:
    """The windows that intersect the region (their footprint in map pixels), in plan order."""
    poly = polygon(region_px)
    return [w for w in wins if poly.intersects(box(w.x, w.y, w.x + w.w, w.y + w.h))]


def require_imagery(
    handle,
    map_id: str,
    region_px: Sequence[Sequence[float]],
    tile_size: int,
    overlap: float,
    target_gsd_cm: float | None,
) -> None:
    """422 `empty_region` unless at least one window inside the region has imagery (spec §14).
    Bounded: the window plan and one low-resolution validity mask, never the raster itself."""
    with handle.session() as s:
        gmap = s.get(GeoMap, map_id)
        width, height, gsd = gmap.width, gmap.height, gmap.gsd_cm
    wins = windows_in(
        plan_windows(width, height, tile_size, overlap, gsd_scale(gsd, target_gsd_cm)), region_px
    )
    if wins:
        with rasterio.open(map_raster_path(handle, map_id)) as src:
            mask, mscale = raster.low_res_mask(src)
        if any(masked_fraction(mask, mscale, w) < SKIP_MASKED for w in wins):
            return
    raise AppError(
        "empty_region",
        "There is no imagery inside that region: draw it over the covered part of the map.",
        422,
        {"map_id": map_id},
    )


def keep_inside(dets: list[Detection], region_px: Sequence[Sequence[float]]) -> list[Detection]:
    """Only the detections whose box centre lies inside the region."""
    if not dets:
        return dets
    poly = polygon(region_px)
    xs = np.array([d.x + d.w / 2 for d in dets], dtype=np.float64)
    ys = np.array([d.y + d.h / 2 for d in dets], dtype=np.float64)
    inside = shapely.contains_xy(poly, xs, ys)
    return [d for d, keep in zip(dets, inside, strict=True) if keep]
