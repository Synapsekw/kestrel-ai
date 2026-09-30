"""Shared builders for R3's snapshot tests: a real display raster behind a GeoMap row, a SimpleNamespace
spec (renderers read specs by attribute, so a plain object stands in for R0's pydantic model), and a
fuzzy pixel match (`near`) for edges an exact `getpixel` would flake on (rounding, stroke width)."""

from __future__ import annotations

from datetime import date
from types import SimpleNamespace

import rasterio
from geotiffs import make_geotiff

from app.db.models import GeoMap
from app.maps.startup import map_raster_path

MAP_WIDTH = 2000
MAP_HEIGHT = 1500
MAP_PIXEL = 0.03


def add_map_file(
    handle,
    *,
    rotation: float = 0.0,
    name: str = "April",
    captured_on: date | None = date(2026, 9, 14),
) -> str:
    """A `ready` GeoMap row backed by a real 60 x 45 m display raster at 3 cm/px (tests/geotiffs.py)."""
    with handle.session() as s:
        row = GeoMap(name=name, status="ready", source_path="x.tif", source_size=1, captured_on=captured_on)
        s.add(row)
        s.flush()
        map_id = row.id
    path = map_raster_path(handle, map_id)
    make_geotiff(path, MAP_WIDTH, MAP_HEIGHT, pixel=MAP_PIXEL, rotation=rotation)
    with rasterio.open(path) as src:
        geotransform = list(src.transform.to_gdal())
        crs_wkt = src.crs.to_wkt()
    with handle.session() as s:
        row = s.get(GeoMap, map_id)
        row.width, row.height = MAP_WIDTH, MAP_HEIGHT
        row.geotransform, row.crs_wkt = geotransform, crs_wkt
    return map_id


def map_spec(item_id, geometry, **overrides) -> SimpleNamespace:
    """A `map` spec; unset fields are `None` so `opt()` falls through to R3's defaults."""
    fields = dict(
        kind="map",
        item_id=item_id,
        geometry=geometry,
        colour=None,
        label=None,
        min_extent_m=None,
        out=None,
        scale_bar=None,
        north=None,
        inset=None,
    )
    fields.update(overrides)
    return SimpleNamespace(**fields)


def near(img, xy, colour, r: int = 2) -> bool:
    """Whether any pixel within `r` of `xy` (rounded) is exactly `colour`: edges land on a
    sub-pixel boundary (fill/stroke rounding), so a single `getpixel` would flake."""
    x, y = round(xy[0]), round(xy[1])
    colour = tuple(colour)
    for dy in range(-r, r + 1):
        for dx in range(-r, r + 1):
            px, py = x + dx, y + dy
            if 0 <= px < img.width and 0 <= py < img.height and img.getpixel((px, py)) == colour:
                return True
    return False
