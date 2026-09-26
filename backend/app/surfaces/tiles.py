"""Surface tiles (spec 2026-09-23-volumes §8): hillshade, the ortho warped into the surface's grid,
and the cut/fill diff, all in the **top surface's pixel grid** with the maps tile pyramid.

At zoom z one tile pixel covers 2^(max_zoom - z) cells (`app.maps.tiles`), so the frontend reuses
`makeTileGrid` unchanged. Every tile is one read of at most 258 x 258 output pixels. The colours
are data colours, rendered here so the TSX carries no raw colour.
"""

from __future__ import annotations

import io

import numpy as np
import rasterio
from affine import Affine
from PIL import Image as PILImage
from rasterio.enums import Resampling
from rasterio.vrt import WarpedVRT
from rasterio.windows import Window

from app.maps.tiles import TILE, TileCache, TileWindow, max_zoom, tile_window
from app.surfaces.grid import GridSpec, SurfaceReader, hillshade

AZIMUTH, ALTITUDE = 315.0, 45.0
JPEG_QUALITY = 90
# A muted hypsometric ramp (low -> high): sage, olive, sand, clay, stone.
RAMP = np.array(
    [[96, 125, 98], [141, 160, 110], [196, 186, 140], [176, 142, 108], [150, 140, 135]], dtype=np.float64
)
DIFF_NEUTRAL = np.array([214, 214, 204], dtype=np.float64)
DIFF_FILL = np.array([33, 102, 172], dtype=np.float64)  # above the base: blue
DIFF_CUT = np.array([178, 24, 43], dtype=np.float64)  # below the base: red
DIFF_NEUTRAL_BAND_M = 0.02
DIFF_ALPHA, DIFF_NEUTRAL_ALPHA = 190, 70

SURFACE_TILES = TileCache()  # keys: (project_id, surface_id, "hs" | "ortho", ...) - drop_map(surface_id)
DIFF_TILES = TileCache()  # keys: (project_id, measurement_id, v, z, x, y) - drop_map(measurement_id)


def _window(spec: GridSpec, z: int, x: int, y: int) -> tuple[TileWindow, int] | None:
    mz = max_zoom(spec.width, spec.height)
    win = tile_window(z, x, y, spec.width, spec.height, mz)
    return (win, 2 ** (mz - z)) if win else None


def _png(rgba: np.ndarray) -> bytes:
    canvas = np.zeros((TILE, TILE, 4), dtype=np.uint8)
    canvas[: rgba.shape[0], : rgba.shape[1]] = rgba
    buf = io.BytesIO()
    PILImage.fromarray(canvas, "RGBA").save(buf, "PNG", optimize=False)
    return buf.getvalue()


def tint(z: np.ndarray, lo: float, hi: float) -> np.ndarray:
    """(h, w, 3) float colours of the ramp across lo..hi."""
    t = np.clip((z - lo) / (hi - lo), 0.0, 1.0) if hi > lo else np.full(z.shape, 0.5)
    t = np.nan_to_num(t, nan=0.5)
    stops = np.linspace(0.0, 1.0, len(RAMP))
    return np.stack([np.interp(t, stops, RAMP[:, k]) for k in range(3)], axis=-1)


def render_hillshade_tile(
    reader: SurfaceReader, z: int, x: int, y: int, *, tint_range: tuple[float, float] | None = None
) -> bytes | None:
    """A PNG, or None when the tile is outside the grid or every pixel is nodata (the route answers
    204). One read of the tile window grown by one output pixel on each side."""
    spec = reader.spec
    found = _window(spec, z, x, y)
    if found is None:
        return None
    win, res = found
    halo = Window(win.x - res, win.y - res, win.w + 2 * res, win.h + 2 * res)
    zs = reader.read(halo, out_shape=(win.out_h + 2, win.out_w + 2), boundless=True)
    cell = spec.cell_size * res
    shade = hillshade(zs, cell, cell, azimuth=AZIMUTH, altitude=ALTITUDE)[1:-1, 1:-1]
    if not shade.any():
        return None
    grey = shade.astype(np.float64)[..., None]
    if tint_range is not None:
        rgb = grey / 255.0 * tint(zs[1:-1, 1:-1].astype(np.float64), *tint_range)
    else:
        rgb = np.repeat(grey, 3, axis=-1)
    rgba = np.zeros((*shade.shape, 4), dtype=np.uint8)
    rgba[..., :3] = np.clip(np.rint(rgb), 0, 255).astype(np.uint8)
    rgba[..., 3] = np.where(shade > 0, 255, 0)
    return _png(rgba)


def _overview_level(map_path, map_gsd_m: float | None, tile_res_m: float) -> int | None:
    """The coarsest overview whose resolution is still at or below the tile's (None = full res)."""
    if not map_gsd_m:
        return None
    with rasterio.open(map_path) as probe:
        factors = probe.overviews(1)
    fitting = [i for i, f in enumerate(factors) if map_gsd_m * f <= tile_res_m]
    return fitting[-1] if fitting else None


def render_ortho_tile(
    map_path, spec: GridSpec, map_gsd_m: float | None, z: int, x: int, y: int
) -> tuple[bytes, str] | None:
    """The map's display raster warped into this surface tile: JPEG when fully covered, PNG with
    alpha otherwise, None when there is no overlap. The surface must have a CRS."""
    if spec.crs_wkt is None:
        raise ValueError("a surface without coordinates cannot show an ortho underlay")
    found = _window(spec, z, x, y)
    if found is None:
        return None
    win, _ = found
    cell = spec.cell_size * win.w / win.out_w
    transform = Affine(
        cell, 0.0, spec.x0 + win.x * spec.cell_size, 0.0, -cell, spec.y0 - win.y * spec.cell_size
    )
    level = _overview_level(map_path, map_gsd_m, cell)
    kwargs = {"overview_level": level} if level is not None else {}
    with (
        rasterio.open(map_path, **kwargs) as src,
        WarpedVRT(
            src,
            crs=spec.crs_wkt,
            transform=transform,
            width=win.out_w,
            height=win.out_h,
            resampling=Resampling.bilinear,
            add_alpha=True,  # the warped alpha carries the map's own mask and the no-overlap area
        ) as vrt,
    ):
        rgb = vrt.read([1, 2, 3])
        valid = vrt.read(vrt.count) > 0
    if not valid.any():
        return None
    rgb = np.moveaxis(rgb, 0, -1)
    buf = io.BytesIO()
    if valid.all() and (win.out_w, win.out_h) == (TILE, TILE):
        PILImage.fromarray(rgb, "RGB").save(buf, "JPEG", quality=JPEG_QUALITY)
        return buf.getvalue(), "image/jpeg"
    rgba = np.zeros((win.out_h, win.out_w, 4), dtype=np.uint8)
    rgba[..., :3] = rgb
    rgba[..., 3] = np.where(valid, 255, 0)
    return _png(rgba), "image/png"


def diff_colours(dz: np.ndarray, scale: float) -> np.ndarray:
    """(h, w, 4) uint8: blue above the base, red below, symmetric at ±scale, a faint neutral band
    within ±0.02 m, transparent where dz is NaN."""
    finite = np.isfinite(dz)
    d = np.where(finite, dz, 0.0)
    t = np.clip(np.abs(d) / max(scale, 1e-9), 0.0, 1.0)[..., None]
    end = np.where((d > 0)[..., None], DIFF_FILL, DIFF_CUT)
    rgb = DIFF_NEUTRAL * (1 - t) + end * t
    neutral = np.abs(d) < DIFF_NEUTRAL_BAND_M
    rgba = np.zeros((*dz.shape, 4), dtype=np.uint8)
    rgba[..., :3] = np.clip(np.rint(rgb), 0, 255).astype(np.uint8)
    rgba[..., 3] = np.where(~finite, 0, np.where(neutral, DIFF_NEUTRAL_ALPHA, DIFF_ALPHA))
    return rgba


def render_diff_tile(
    diff: SurfaceReader, top: GridSpec, scale: float, z: int, x: int, y: int
) -> bytes | None:
    """The diff grid read in the **top** surface's tile grid: the diff grid is a crop of the top's
    lattice, so the tile window moves by a whole number of cells."""
    found = _window(top, z, x, y)
    if found is None:
        return None
    win, _ = found
    dc = round((diff.spec.x0 - top.x0) / top.cell_size)
    dr = round((top.y0 - diff.spec.y0) / top.cell_size)
    dz = diff.read(
        Window(win.x - dc, win.y - dr, win.w, win.h), out_shape=(win.out_h, win.out_w), boundless=True
    )
    if not np.isfinite(dz).any():
        return None
    return _png(diff_colours(dz.astype(np.float64), scale))
