"""Map, elevation and pair snapshots (spec §9.3): one decimated windowed read per item, bounded by
`out` and never by the raster, then the geometry, a scale bar, a north arrow and an attribution
line (item name and date).

Map windows are computed in the display raster's pixel space: a rotated geotransform is printed in
pixel orientation (the four-corner pixel bbox, spec §9.3 step 2) with the north arrow turned to grid
north. Elevation windows are in the surface's world coordinates (surfaces are always north-up)."""

from __future__ import annotations

import math
from collections.abc import Callable
from dataclasses import dataclass
from datetime import date
from pathlib import Path

import numpy as np
import rasterio
from PIL import Image as PILImage
from PIL import ImageDraw
from pyproj import CRS, Transformer
from rasterio.enums import Resampling
from shapely.geometry import shape as shapely_shape

from app.db.models import GeoMap, Surface
from app.maps import raster
from app.maps.georef import EDGE_SAMPLES, M_PER_DEG_LAT, M_PER_DEG_LON_EQUATOR, Georef
from app.maps.startup import map_dir, map_raster_path
from app.reports.snapshots import MISSING, SnapshotUnavailable, opt, out_of
from app.reports.snapshots.draw import (
    DEFAULT_COLOUR,
    INK,
    WHITE,
    chip_size,
    draw_chip,
    font,
    paste_inset,
    pin,
    rgb,
    text_box,
)
from app.reports.snapshots.keys import plain
from app.surfaces.grid import MAX_READ, hillshade, open_surface
from app.surfaces.paths import surface_path
from app.volumes.plan_image import _nice
from app.volumes.regions import lattice_window

PAD = 0.25
MIN_EXTENT_M = 40.0
NODATA_GREY = 128  # as raster.write_preview paints nodata
FILL_ALPHA = 38  # 15 % of 255
MAX_GEOMETRY_VERTICES = 120
MONTHS = ("Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec")
ELEVATION_NODATA = 245  # as volumes/plan_image paints nodata
GUTTER = 8
NO_COMMON_AREA = "No common area"


# --- items -------------------------------------------------------------------------------------


@dataclass(frozen=True)
class MapItem:
    id: str
    name: str
    captured_on: date | None
    width: int
    height: int
    geotransform: tuple[float, ...]
    crs_wkt: str
    bounds_wgs84: tuple[float, ...] | None
    path: Path


@dataclass(frozen=True)
class SurfaceItem:
    id: str
    name: str
    captured_on: date | None
    crs_wkt: str | None
    bounds_native: tuple[float, ...] | None
    path: Path


def map_item(handle, item_id: str) -> MapItem | str:
    """The ready map and its display raster, or the operator's reason it cannot be printed."""
    with handle.session() as s:
        row = s.get(GeoMap, item_id)
        if row is None:
            return "The map was deleted"
        if row.status != "ready":
            return "The map is not ready"
        if not row.geotransform or not row.crs_wkt:
            return "The map has no coordinates"
        item = MapItem(
            row.id,
            row.name,
            row.captured_on,
            row.width,
            row.height,
            tuple(row.geotransform),
            row.crs_wkt,
            tuple(row.bounds_wgs84) if row.bounds_wgs84 else None,
            map_raster_path(handle, row.id),
        )
    return item if item.path.is_file() else "The map file is missing"


def surface_item(handle, item_id: str) -> SurfaceItem | str:
    with handle.session() as s:
        row = s.get(Surface, item_id)
        if row is None:
            return "The elevation was deleted"
        if row.status != "ready":
            return "The elevation is not ready"
        item = SurfaceItem(
            row.id,
            row.name,
            row.captured_on,
            row.crs_wkt,
            tuple(row.bounds_native) if row.bounds_native else None,
            surface_path(handle, row.id),
        )
    return item if item.path.is_file() else "The elevation file is missing"


def _item(handle, spec):
    return map_item(handle, spec.item_id) if spec.kind == "map" else surface_item(handle, spec.item_id)


def _require(found):
    if isinstance(found, str):
        raise SnapshotUnavailable(found)
    return found


def item_source_version(handle, spec) -> str:
    """The raster file's size and mtime, plus the name and date the attribution line prints."""
    found = _item(handle, spec)
    if isinstance(found, str):
        return MISSING + found
    try:
        st = found.path.stat()
    except OSError:
        return MISSING + (
            "The map file is missing" if spec.kind == "map" else "The elevation file is missing"
        )
    return f"{st.st_size}:{st.st_mtime_ns}:{found.name}:{found.captured_on or ''}"


map_source_version = item_source_version


def date_text(d: date | None) -> str:
    """`14 Sep 2026`; fixed English month names, never strftime (locale-independent bytes)."""
    return f"{d.day} {MONTHS[d.month - 1]} {d.year}" if d else ""


def attribution_text(item) -> str:
    when = date_text(item.captured_on)
    return f"{item.name} · {when}" if when else item.name


# --- geometry ------------------------------------------------------------------------------------


def geometry_coords(geometry: dict) -> list[tuple[float, float]]:
    kind, c = geometry["type"], geometry["coordinates"]
    if kind == "Point":
        return [(float(c[0]), float(c[1]))]
    if kind == "LineString":
        return [(float(p[0]), float(p[1])) for p in c]
    if kind == "Polygon":
        return [(float(p[0]), float(p[1])) for p in c[0]]
    raise SnapshotUnavailable(f"A {kind} cannot be drawn in a report")


def _round(v: float) -> float:
    """Millimetres for projected coordinates, ~1 cm for degrees: short enough for a URL."""
    v = float(v)
    return round(v, 3) if abs(v) > 360 else round(v, 7)


def _vertices(g) -> int:
    return len(g.exterior.coords) if g.geom_type == "Polygon" else len(g.coords)


def compact_geometry(geometry: dict, max_vertices: int = MAX_GEOMETRY_VERTICES) -> dict:
    """The geometry rounded and simplified (doubling tolerance from 1e-4 of its extent) until it
    has at most `max_vertices` vertices, so a map spec fits a URL."""
    kind = geometry["type"]
    if kind == "Point":
        return {"type": "Point", "coordinates": [_round(v) for v in geometry["coordinates"][:2]]}
    original = shapely_shape(geometry)
    g = original
    minx, miny, maxx, maxy = original.bounds
    tol = max(maxx - minx, maxy - miny, 1e-9) * 1e-4
    while _vertices(g) > max_vertices and tol < 1e9:
        simple = original.simplify(tol, preserve_topology=True)
        if simple.geom_type == original.geom_type and not simple.is_empty:
            g = simple
        tol *= 2
    coords = list(g.exterior.coords) if kind == "Polygon" else list(g.coords)
    line = [[_round(p[0]), _round(p[1])] for p in coords]
    return {"type": kind, "coordinates": [line] if kind == "Polygon" else line}


# --- windows and views ---------------------------------------------------------------------------


def plan_window(bounds, *, pad: float, floor: float, aspect: float) -> tuple[float, float, float, float]:
    """`bounds` (minx, miny, maxx, maxy) grown by `pad` of its size on each side, each side at least
    `floor`, then widened to `aspect` (w / h) about its centre. Same units in and out."""
    minx, miny, maxx, maxy = (float(v) for v in bounds)
    cx, cy = (minx + maxx) / 2, (miny + maxy) / 2
    w = max((maxx - minx) * (1 + 2 * pad), floor, 1e-9)
    h = max((maxy - miny) * (1 + 2 * pad), floor, 1e-9)
    if w / h < aspect:
        w = h * aspect
    else:
        h = w / aspect
    return (cx - w / 2, cy - h / 2, cx + w / 2, cy + h / 2)


def pixel_window(bounds) -> tuple[int, int, int, int]:
    x0, y0 = math.floor(bounds[0]), math.floor(bounds[1])
    return x0, y0, max(1, math.ceil(bounds[2]) - x0), max(1, math.ceil(bounds[3]) - y0)


def read_window_rgb(src, win, out_w: int, out_h: int) -> np.ndarray:
    """(out_h, out_w, 3) uint8 of pixel window `win` (x, y, w, h), which may reach past the raster:
    the part inside is one decimated `raster.read_rgb`, the rest and nodata are neutral grey."""
    x, y, w, h = win
    canvas = np.full((out_h, out_w, 3), NODATA_GREY, np.uint8)
    ix0, iy0 = max(0, x), max(0, y)
    ix1, iy1 = min(src.width, x + w), min(src.height, y + h)
    if ix1 <= ix0 or iy1 <= iy0:
        return canvas
    sx, sy = out_w / w, out_h / h
    ox0, oy0 = round((ix0 - x) * sx), round((iy0 - y) * sy)
    ox1, oy1 = min(out_w, round((ix1 - x) * sx)), min(out_h, round((iy1 - y) * sy))
    if ox1 <= ox0 or oy1 <= oy0:
        return canvas
    rgb_, valid = raster.read_rgb(src, ix0, iy0, ix1 - ix0, iy1 - iy0, ox1 - ox0, oy1 - oy0)
    part = rgb_.copy()
    part[~valid] = NODATA_GREY
    canvas[oy0:oy1, ox0:ox1] = part
    return canvas


def north_angle(georef: Georef, px: float, py: float) -> float:
    """Grid north at pixel (px, py), in degrees clockwise from the image's up."""
    a = georef.affine
    step = 10 * math.sqrt(abs(a.a * a.e - a.b * a.d))  # ~10 pixels in native units
    x, y = georef.pixel_to_native(px, py)
    qx, qy = ~a @ (x, y + step)
    return math.degrees(math.atan2(qx - px, -(qy - py)))


@dataclass(frozen=True)
class View:
    image: PILImage.Image  # RGB, exactly `out`
    to_out: Callable[[float, float], tuple[float, float]]  # native CRS -> output pixel
    m_per_px: float  # metres per output pixel
    north_deg: float  # clockwise from up


def map_view(src, georef: Georef, win, out, mpp: float) -> View:
    x, y, w, h = win
    out_w, out_h = int(out[0]), int(out[1])
    img = PILImage.fromarray(read_window_rgb(src, win, out_w, out_h), "RGB")
    inverse = ~georef.affine
    sx, sy = out_w / w, out_h / h

    def to_out(nx: float, ny: float) -> tuple[float, float]:
        px, py = inverse @ (nx, ny)
        return ((px - x) * sx, (py - y) * sy)

    return View(img, to_out, mpp * w / out_w, north_angle(georef, x + w / 2, y + h / 2))


# --- decoration ----------------------------------------------------------------------------------


def draw_geometry(img: PILImage.Image, geometry: dict, to_out, colour) -> PILImage.Image:
    """A point as a pin with a white outline; a line at 3 px on a white halo; a polygon as a 3 px
    outline with a 15 % fill (spec §9.3 step 5). `img` is RGBA; returns the drawn image."""
    kind = geometry["type"]
    pts = [to_out(x, y) for x, y in geometry_coords(geometry)]
    if kind == "Point":
        d = ImageDraw.Draw(img)
        pin(d, pts[0], colour)
        return img
    if kind == "LineString":
        d = ImageDraw.Draw(img)
        d.line(pts, fill=WHITE, width=7, joint="curve")
        d.line(pts, fill=colour, width=3, joint="curve")
        return img
    overlay = PILImage.new("RGBA", img.size, (0, 0, 0, 0))
    ImageDraw.Draw(overlay).polygon(pts, fill=(*colour, FILL_ALPHA))
    img = PILImage.alpha_composite(img, overlay)
    ImageDraw.Draw(img).line(pts + [pts[0]], fill=colour, width=3, joint="curve")
    return img


def _scale_bar(d, size, m_per_px: float) -> None:
    """Bottom-left, the idiom of volumes/plan_image.py: a `_nice()` length near a quarter width."""
    w, h = size
    bar_m = _nice(w * m_per_px / 4)
    bar_px = bar_m / m_per_px
    f = font(14)
    label = f"{bar_m:g} m"
    tw, th, left, top = text_box(d, label, f)
    d.rectangle([6, h - 30 - th, 18 + max(bar_px, tw), h - 6], fill=WHITE)
    d.rectangle([12, h - 16, 12 + bar_px, h - 11], fill=INK)
    d.text((12 - left, h - 22 - th - top), label, fill=INK, font=f)


def _north_arrow(d, size, deg: float) -> None:
    w, _ = size
    cx, cy = w - 30, 34
    r = math.radians(deg)
    c, s = math.cos(r), math.sin(r)
    arrow = [(0, -18), (-9, 12), (0, 6), (9, 12)]
    d.ellipse([cx - 24, cy - 24, cx + 24, cy + 24], fill=WHITE)
    d.polygon([(cx + x * c - y * s, cy + x * s + y * c) for x, y in arrow], fill=INK)
    f = font(12)
    tw, _, left, top = text_box(d, "N", f)
    tip_x, tip_y = cx + 22 * s, cy - 22 * c
    d.text((tip_x - tw / 2 - left, tip_y - 6 - top), "N", fill=INK, font=f)


def _attribution(d, size, text: str) -> None:
    w, h = size
    f = font(13)
    tw, th, left, top = text_box(d, text, f)
    d.rectangle([w - tw - 16, h - th - 14, w - 4, h - 4], fill=WHITE)
    d.text((w - tw - 10 - left, h - th - 9 - top), text, fill=INK, font=f)


def decorate(view: View, geometry, *, colour, label, scale_bar: bool, north: bool, attribution: str):
    img = view.image.convert("RGBA")
    if geometry:
        img = draw_geometry(img, geometry, view.to_out, rgb(colour))
    d = ImageDraw.Draw(img)
    if label:
        draw_chip(d, (12, 12), label)
    if scale_bar:
        _scale_bar(d, img.size, view.m_per_px)
    if north:
        _north_arrow(d, img.size, view.north_deg)
    if attribution:
        _attribution(d, img.size, attribution)
    return img.convert("RGB")


# --- the map adapter -----------------------------------------------------------------------------


def _map_inset(handle, item: MapItem, img, win) -> None:
    preview = map_dir(handle, item.id) / "preview.jpg"  # the ~1024 px import preview, never the raster
    if not preview.is_file():
        return
    with PILImage.open(preview) as p:
        p.load()
        s = p.width / item.width
        x, y, w, h = win
        paste_inset(img, p, (x * s, y * s, (x + w) * s, (y + h) * s), colour=rgb(DEFAULT_COLOUR), bottom=40)


def render_map_spec(handle, spec) -> PILImage.Image:
    item = _require(map_item(handle, spec.item_id))
    out = out_of(spec)
    aspect = out[0] / out[1]
    geometry = plain(opt(spec, "geometry"))
    georef = Georef(item.geotransform, item.crs_wkt)
    mpp = georef.metres_per_pixel(item.width, item.height)
    if geometry:
        inverse = ~georef.affine
        pts = [inverse @ xy for xy in geometry_coords(geometry)]
        bounds = (
            min(p[0] for p in pts),
            min(p[1] for p in pts),
            max(p[0] for p in pts),
            max(p[1] for p in pts),
        )
        floor = float(opt(spec, "min_extent_m", MIN_EXTENT_M)) / mpp
        win = pixel_window(plan_window(bounds, pad=PAD, floor=floor, aspect=aspect))
    else:
        win = pixel_window(plan_window((0, 0, item.width, item.height), pad=0.0, floor=1.0, aspect=aspect))
    with rasterio.open(item.path) as src:
        view = map_view(src, georef, win, out, mpp)
    img = decorate(
        view,
        geometry,
        colour=opt(spec, "colour", DEFAULT_COLOUR),
        label=opt(spec, "label"),
        scale_bar=bool(opt(spec, "scale_bar", True)),
        north=bool(opt(spec, "north", True)),
        attribution=attribution_text(item),
    )
    if opt(spec, "inset", False):
        _map_inset(handle, item, img, win)
    return img


# --- elevation -----------------------------------------------------------------------------------

elevation_source_version = item_source_version


def elevation_view(reader, bounds, out) -> View:
    """A hillshade of the surface over world `bounds`, as volumes/plan_image.render_plan_image draws
    it, from one boundless read of exactly `out` cells (spec §9.3 step 7).

    `SurfaceReader.read` refuses an output side over `MAX_READ` (amendment A10): the read is capped
    to `MAX_READ` per side, keeping `out`'s aspect, and the hillshade is then LANCZOS-resized up to
    exactly `out`."""
    spec = reader.spec
    win = lattice_window(spec, bounds)
    out_w, out_h = int(out[0]), int(out[1])
    scale = min(1.0, MAX_READ / out_w, MAX_READ / out_h)
    read_w, read_h = max(1, round(out_w * scale)), max(1, round(out_h * scale))
    z = reader.read(win, out_shape=(read_h, read_w), resampling=Resampling.bilinear, boundless=True)
    read_cw = int(win.width) * spec.cell_size / read_w
    read_ch = int(win.height) * spec.cell_size / read_h
    shade = hillshade(z, read_cw, read_ch)
    grey = np.where(shade > 0, shade, ELEVATION_NODATA).astype(np.uint8)
    img = PILImage.fromarray(np.stack([grey] * 3, axis=-1), "RGB")
    if (read_w, read_h) != (out_w, out_h):
        img = img.resize((out_w, out_h), PILImage.LANCZOS)
    cw = int(win.width) * spec.cell_size / out_w
    ch = int(win.height) * spec.cell_size / out_h
    x0 = spec.x0 + int(win.col_off) * spec.cell_size
    y0 = spec.y0 - int(win.row_off) * spec.cell_size

    def to_out(nx: float, ny: float) -> tuple[float, float]:
        return ((nx - x0) / cw, (y0 - ny) / ch)

    return View(img, to_out, cw, 0.0)


def render_elevation_spec(handle, spec) -> PILImage.Image:
    """`overlay` is ignored: a diff overlay in comparisons is deferred (spec §20; plan ruling 7)."""
    item = _require(surface_item(handle, spec.item_id))
    out = out_of(spec)
    aspect = out[0] / out[1]
    geometry = plain(opt(spec, "geometry"))
    with open_surface(item.path) as reader:
        if geometry:
            xs, ys = zip(*geometry_coords(geometry), strict=True)
            floor = float(opt(spec, "min_extent_m", MIN_EXTENT_M))
            bounds = plan_window((min(xs), min(ys), max(xs), max(ys)), pad=PAD, floor=floor, aspect=aspect)
        else:
            bounds = plan_window(reader.spec.bounds, pad=0.0, floor=1e-6, aspect=aspect)
        view = elevation_view(reader, bounds, out)
    return decorate(
        view,
        geometry,
        colour=opt(spec, "colour", DEFAULT_COLOUR),
        label=opt(spec, "label"),
        scale_bar=True,
        north=True,
        attribution=attribution_text(item),
    )


# --- pair ------------------------------------------------------------------------------------------


def pair_source_version(handle, spec) -> str:
    a, b = item_source_version(handle, spec.a), item_source_version(handle, spec.b)
    for v in (a, b):
        if v.startswith(MISSING):
            return v
    return f"a={a}|b={b}"


def edge_samples(bbox) -> tuple[list[float], list[float]]:
    """EDGE_SAMPLES points along each edge of `bbox`: edges curve under reprojection."""
    minx, miny, maxx, maxy = (float(v) for v in bbox)
    xs: list[float] = []
    ys: list[float] = []
    for i in range(EDGE_SAMPLES):
        t = i / (EDGE_SAMPLES - 1)
        x, y = minx + t * (maxx - minx), miny + t * (maxy - miny)
        xs += [x, x, minx, maxx]
        ys += [miny, maxy, y, y]
    return xs, ys


def footprint_wgs84(handle, spec) -> tuple[float, float, float, float]:
    item = _require(_item(handle, spec))
    if spec.kind == "map":
        if item.bounds_wgs84:
            return tuple(item.bounds_wgs84)
        return tuple(Georef(item.geotransform, item.crs_wkt).bounds_wgs84(item.width, item.height))
    if not item.crs_wkt or not item.bounds_native:
        raise SnapshotUnavailable("The elevation has no coordinates")
    t = Transformer.from_crs(CRS.from_wkt(item.crs_wkt), CRS.from_epsg(4326), always_xy=True)
    lons, lats = t.transform(*edge_samples(item.bounds_native))
    return (min(lons), min(lats), max(lons), max(lats))


def fit_aspect_wgs84(bbox, aspect: float, *, grow: bool = False) -> tuple[float, float, float, float]:
    """`bbox` shrunk (or, with `grow`, enlarged) about its centre to `aspect` measured in metres."""
    minx, miny, maxx, maxy = (float(v) for v in bbox)
    cx, cy = (minx + maxx) / 2, (miny + maxy) / 2
    m_lon = M_PER_DEG_LON_EQUATOR * math.cos(math.radians(cy))
    w_m, h_m = (maxx - minx) * m_lon, (maxy - miny) * M_PER_DEG_LAT
    if w_m <= 0 or h_m <= 0:
        raise SnapshotUnavailable("The comparison area is empty")
    if (w_m / h_m > aspect) != grow:
        w_m = h_m * aspect
    else:
        h_m = w_m / aspect
    half_lon, half_lat = w_m / (2 * m_lon), h_m / (2 * M_PER_DEG_LAT)
    return (cx - half_lon, cy - half_lat, cx + half_lon, cy + half_lat)


def common_bbox(a, b, aspect: float) -> tuple[float, float, float, float] | None:
    """The intersection of two WGS84 footprints shrunk to `aspect` about its centre (spec §9.3),
    or None when they do not overlap."""
    minx, miny = max(a[0], b[0]), max(a[1], b[1])
    maxx, maxy = min(a[2], b[2]), min(a[3], b[3])
    if maxx <= minx or maxy <= miny:
        return None
    return fit_aspect_wgs84((minx, miny, maxx, maxy), aspect)


def item_over_bbox(handle, spec, bbox_wgs84, size) -> PILImage.Image:
    """One map or elevation item read over a WGS84 bbox projected into its own CRS (spec §9.3). Each
    call builds the WGS84 <-> item CRS `Transformer` once, for all `edge_samples` points."""
    item = _require(_item(handle, spec))
    aspect = size[0] / size[1]
    xs, ys = edge_samples(bbox_wgs84)
    if spec.kind == "map":
        georef = Georef(item.geotransform, item.crs_wkt)
        pxs, pys = georef.wgs84_to_pixel(xs, ys)
        bounds = (min(pxs), min(pys), max(pxs), max(pys))
        win = pixel_window(plan_window(bounds, pad=0.0, floor=1.0, aspect=aspect))
        with rasterio.open(item.path) as src:
            view = map_view(src, georef, win, size, georef.metres_per_pixel(item.width, item.height))
    else:
        if not item.crs_wkt:
            raise SnapshotUnavailable("The elevation has no coordinates")
        t = Transformer.from_crs(CRS.from_epsg(4326), CRS.from_wkt(item.crs_wkt), always_xy=True)
        nx, ny = t.transform(xs, ys)
        bounds = plan_window((min(nx), min(ny), max(nx), max(ny)), pad=0.0, floor=1e-6, aspect=aspect)
        with open_surface(item.path) as reader:
            view = elevation_view(reader, bounds, size)
    return decorate(
        view,
        plain(opt(spec, "geometry")),
        colour=opt(spec, "colour", DEFAULT_COLOUR),
        label=None,
        scale_bar=True,
        north=True,
        attribution=attribution_text(item),
    )


def swipe_composite(a: PILImage.Image, b: PILImage.Image, split: float) -> PILImage.Image:
    """Columns [0, split*W) from `a`, the rest from `b`, a 2 px white divider (M's swipe, printed)."""
    w, h = a.size
    cut = min(w - 1, max(1, round(split * w)))
    out = a.copy()
    out.paste(b.crop((cut, 0, w, h)), (cut, 0))
    ImageDraw.Draw(out).rectangle([cut - 1, 0, cut, h - 1], fill=WHITE)
    return out


def side_by_side(a: PILImage.Image, b: PILImage.Image, size) -> PILImage.Image:
    out = PILImage.new("RGB", (int(size[0]), int(size[1])), WHITE)
    out.paste(a, (0, 0))
    out.paste(b, (a.width + GUTTER, 0))
    return out


def _when(item) -> str:
    return date_text(item.captured_on) or item.name


def _pair_chips(img, a_item, b_item, *, b_x: int | None = None) -> None:
    d = ImageDraw.Draw(img)
    draw_chip(d, (12, 12), f"A · {_when(a_item)}")
    text = f"B · {_when(b_item)}"
    draw_chip(d, (b_x if b_x is not None else img.width - chip_size(text)[0] - 70, 12), text)


def _side_by_side_pair(handle, a, b, a_item, b_item, bbox_a, bbox_b, panel, out_size) -> PILImage.Image:
    """One side-by-side composite: `a` over `bbox_a` and `b` over `bbox_b` (the same common bbox, or
    each item's own footprint when there is none), with the A/B date chips (spec §16, amendment A16:
    one helper instead of the repeated side-by-side + chips block)."""
    left = item_over_bbox(handle, a, bbox_a, panel)
    right = item_over_bbox(handle, b, bbox_b, panel)
    img = side_by_side(left, right, out_size)
    _pair_chips(img, a_item, b_item, b_x=panel[0] + GUTTER + 12)
    return img


def render_pair_spec(handle, spec) -> PILImage.Image:
    a, b = spec.a, spec.b
    out_w, out_h = out_of(a)
    mode = opt(spec, "mode", "swipe")
    a_item, b_item = _require(_item(handle, a)), _require(_item(handle, b))
    fa, fb = footprint_wgs84(handle, a), footprint_wgs84(handle, b)
    panel = ((out_w - GUTTER) // 2, out_h)
    size = panel if mode == "side_by_side" else (out_w, out_h)
    given = opt(spec, "bbox_wgs84")
    bbox = fit_aspect_wgs84(given, size[0] / size[1]) if given else common_bbox(fa, fb, size[0] / size[1])
    if bbox is None:  # spec §16: side by side over each item's own footprint
        img = _side_by_side_pair(
            handle,
            a,
            b,
            a_item,
            b_item,
            fit_aspect_wgs84(fa, panel[0] / panel[1], grow=True),
            fit_aspect_wgs84(fb, panel[0] / panel[1], grow=True),
            panel,
            (out_w, out_h),
        )
        cw, _ = chip_size(NO_COMMON_AREA)
        draw_chip(ImageDraw.Draw(img), ((out_w - cw) / 2, 64), NO_COMMON_AREA)
        return img
    if mode == "side_by_side":
        return _side_by_side_pair(handle, a, b, a_item, b_item, bbox, bbox, panel, (out_w, out_h))
    left, right = item_over_bbox(handle, a, bbox, size), item_over_bbox(handle, b, bbox, size)
    img = swipe_composite(left, right, float(opt(spec, "split", 0.5)))
    _pair_chips(img, a_item, b_item)
    return img
