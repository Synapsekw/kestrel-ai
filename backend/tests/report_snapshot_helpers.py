"""Shared builders for R3's snapshot tests: a real display raster behind a GeoMap row, a SimpleNamespace
spec (renderers read specs by attribute, so a plain object stands in for R0's pydantic model), and a
fuzzy pixel match (`near`) for edges an exact `getpixel` would flake on (rounding, stroke width)."""

from __future__ import annotations

from datetime import date
from pathlib import Path
from types import SimpleNamespace

import rasterio
from geotiffs import make_geotiff
from PIL import Image as PILImage

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
    seed: int = 0,
    origin: tuple[float, float] = (500000.0, 4983000.0),
) -> str:
    """A `ready` GeoMap row backed by a real 60 x 45 m display raster at 3 cm/px (tests/geotiffs.py).
    `seed` and `origin` let a pair test build two distinct, or non-overlapping, map files."""
    with handle.session() as s:
        row = GeoMap(name=name, status="ready", source_path="x.tif", source_size=1, captured_on=captured_on)
        s.add(row)
        s.flush()
        map_id = row.id
    path = map_raster_path(handle, map_id)
    make_geotiff(path, MAP_WIDTH, MAP_HEIGHT, pixel=MAP_PIXEL, rotation=rotation, seed=seed, origin=origin)
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


# --- R3 T3: image crop --------------------------------------------------------------------------


def write_grey(path: Path, size: tuple[int, int], fmt: str = "JPEG", colour=(128, 128, 128)) -> Path:
    path.parent.mkdir(parents=True, exist_ok=True)
    PILImage.new("RGB", size, colour).save(path, fmt)
    return path


def add_image(handle, name: str, size: tuple[int, int], *, fmt: str = "JPEG") -> str:
    """A grey photo at `<project>/images/<name>` and its Image row; returns the image id."""
    from app.db.models import Image, Source

    write_grey(Path(handle.folder) / "images" / name, size, fmt)
    with handle.session() as s:
        src = Source(folder="C:/flights/r3", site="R3")
        s.add(src)
        s.flush()
        row = Image(path=f"images/{name}", width=size[0], height=size[1], source_id=src.id)
        s.add(row)
        s.flush()
        return row.id


def add_box(handle, image_id: str, *, shape="box", x=0.0, y=0.0, w=0.0, h=0.0, angle=0.0, points=None) -> str:
    from app.db.models import Box

    with handle.session() as s:
        box = Box(
            image_id=image_id,
            class_id="c-crack",
            x=x,
            y=y,
            w=w,
            h=h,
            angle=angle,
            shape=shape,
            points=points,
            provenance_kind="person",
            review_state="accepted",
        )
        s.add(box)
        s.flush()
        return box.id


def image_crop_spec(image_id: str, ring, **overrides) -> SimpleNamespace:
    fields = dict(
        kind="image_crop",
        image_id=image_id,
        annotation_id=None,
        ring=ring,
        colour="#ff0000",
        label=None,
        context=3.0,
        out=[1200, 900],
        inset=False,
    )
    fields.update(overrides)
    return SimpleNamespace(**fields)


# --- R3 T5: elevation and pair -------------------------------------------------------------------


def elevation_spec(item_id, geometry, **overrides) -> SimpleNamespace:
    """An `elevation` spec; unset fields are `None` so `opt()` falls through to R3's defaults."""
    fields = dict(
        kind="elevation",
        item_id=item_id,
        geometry=geometry,
        overlay=None,
        overlay_item_id=None,
        out=None,
        colour=None,
        label=None,
        min_extent_m=None,
    )
    fields.update(overrides)
    return SimpleNamespace(**fields)


def pair_spec(a: SimpleNamespace, b: SimpleNamespace, **overrides) -> SimpleNamespace:
    """A `pair` spec over two full `map`/`elevation` specs; unset fields fall through to R3's
    defaults (mode `swipe`, split 0.5)."""
    fields = dict(kind="pair", a=a, b=b, bbox_wgs84=None, mode=None, split=None)
    fields.update(overrides)
    return SimpleNamespace(**fields)


# --- R3 T6: volume plan and the R9 stubs ---------------------------------------------------------


def ns(**fields) -> SimpleNamespace:
    """A bare spec of exactly the given attributes (no defaults): `volume_plan`, `attachment` and
    `view3d` have no optional fields R3 fills in with `opt()`, unlike `map`/`elevation`/`pair`."""
    return SimpleNamespace(**fields)
