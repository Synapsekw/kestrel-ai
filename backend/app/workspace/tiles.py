"""Site tiles (spec 2026-09-26-map-workspace section 6): every raster layer warped into the fixed
site grid, generalised from `surfaces/tiles.render_ortho_tile`.

For a layer and a tile: (1) transform the tile's bounds into the source CRS and return None (204)
when they miss `bounds_native` - no I/O; (2) open the source at the overview whose resolution is at
or below the tile's; (3) read one WarpedVRT of 256 x 256 (258 x 258 with a halo); (4) paint by kind;
(5) cache in an LRU of 1024 keyed by (project, layer, kind, version, frame, z, x, y, style).

Kinds register a resolver (`register_site_tile_source`): map here, surface and volume_diff below;
drawing_raster in the drawings unit (M-B3), with one line in its own module.
"""

from __future__ import annotations

import io
import math
from collections.abc import Callable
from dataclasses import dataclass
from functools import partial
from pathlib import Path

import numpy as np
import rasterio
from affine import Affine
from PIL import Image as PILImage
from pyproj import CRS
from rasterio.enums import Resampling
from rasterio.vrt import WarpedVRT

from app.db.models import GeoMap, Surface
from app.errors import AppError, not_found
from app.maps.georef import Georef
from app.maps.startup import map_raster_path
from app.maps.tiles import TileCache
from app.projects.service import ProjectHandle
from app.surfaces.grid import hillshade
from app.surfaces.paths import surface_path
from app.surfaces.tiles import ALTITUDE, AZIMUTH, diff_colours, tint
from app.workspace import grid
from app.workspace.frame import SiteFrame, bbox_from_site, not_in_frame

KINDS = ("map", "surface", "volume_diff", "drawing_raster")
CACHE_ITEMS = 1024
SITE_TILES = TileCache(CACHE_ITEMS)  # keys: (project_id, layer_id, kind, ...) - drop_map(layer_id) works
LOCAL_CRS = CRS.from_epsg(3857)  # plan deviation 8: the same stand-in on both sides = a pure resample
KNOCKOUT_MIN = 245


@dataclass(frozen=True)
class TileStyle:
    style: str | None = None
    interval: float | None = None
    knockout: bool = False
    preview: tuple[float, float, float, float, float, float] | None = None

    @property
    def key(self) -> tuple:
        return (self.style, self.interval, self.knockout)  # a preview is never cached (R-B1-11)


def _invalid_preview(message: str) -> AppError:
    return AppError("invalid_preview", message, 422)


def parse_preview(t: str | None) -> tuple[float, float, float, float, float, float] | None:
    """The `t` query: "a,b,c,d,e,f", a preview placement from drawing coordinates to the site frame
    (E = a*x + b*y + c, N = d*x + e*y + f) used instead of the stored georef while aligning; the
    drawing_raster resolver (M-B3) composes it with the plan pixel -> drawing coordinates transform.
    Ruling R-B1-11: anything else, non-finite values or a near-singular 2x2 part is 422 invalid_preview."""
    if t is None:
        return None
    try:
        values = tuple(float(v) for v in t.split(","))
    except ValueError:
        values = ()
    if len(values) != 6 or not all(math.isfinite(v) for v in values):
        raise _invalid_preview("t must be six finite numbers a,b,c,d,e,f of an invertible affine")
    a, b, _c, d, e, _f = values
    tolerance = 1e-12 * max(1.0, abs(a), abs(b), abs(d), abs(e)) ** 2
    if abs(a * e - b * d) <= tolerance:
        raise _invalid_preview("t must be six finite numbers a,b,c,d,e,f of an invertible affine")
    return values


@dataclass(frozen=True)
class TileContext:
    frame: SiteFrame
    z: int
    x: int
    y: int
    res: float
    halo: int


Paint = Callable[[np.ndarray, np.ndarray, TileContext], "np.ndarray | None"]


@dataclass(frozen=True)
class SiteTileSource:
    layer_id: str
    version: str
    path: Path
    crs_wkt: str | None
    bounds_native: tuple[float, float, float, float]
    native_res_m: float
    paint: Paint
    bands: tuple[int, ...] = (1, 2, 3)
    float_data: bool = False
    alpha_band: int | None = None
    halo: int = 0
    src_transform: Affine | None = (
        None  # replaces the file's geotransform (the drawing preview); None = its own
    )


Resolver = Callable[[ProjectHandle, str, TileStyle], SiteTileSource]
_RESOLVERS: dict[str, Resolver] = {}


def register_site_tile_source(kind: str, resolve: Resolver) -> None:
    if kind not in KINDS:
        raise ValueError(f"{kind} is not a site tile kind ({', '.join(KINDS)})")
    _RESOLVERS[kind] = resolve


# --- paints ---------------------------------------------------------------------------------------


def paint_rgb(data: np.ndarray, valid: np.ndarray, ctx: TileContext) -> np.ndarray:
    """A map: RGB, masked and outside pixels transparent."""
    rgba = np.zeros((*valid.shape, 4), dtype=np.uint8)
    rgba[..., :3] = np.moveaxis(data[:3], 0, -1)
    rgba[..., 3] = np.where(valid, 255, 0)
    return rgba


def _paint_rgba(data: np.ndarray, valid: np.ndarray, ctx: TileContext, *, knockout_white: bool) -> np.ndarray:
    rgba = np.ascontiguousarray(np.moveaxis(data[:4], 0, -1)).astype(np.uint8)
    alpha = np.where(valid, rgba[..., 3], 0)
    if knockout_white:
        alpha = np.where(rgba[..., :3].min(axis=-1) >= KNOCKOUT_MIN, 0, alpha)
    rgba[..., 3] = alpha
    return rgba


def rgba_paint(knockout_white: bool) -> Paint:
    """A drawing raster (RGBA plan.tif); with `knockout_white`, min(R, G, B) >= 245 is transparent."""
    return partial(_paint_rgba, knockout_white=knockout_white)


CONTOUR_ALPHA = 140  # white at 55 %
NICE = (1.0, 2.0, 2.5, 5.0)


def nice_interval(lo: float, hi: float) -> float:
    """The nice number (1, 2, 2.5, 5 x 10^k) nearest (hi - lo) / 20 on a log scale; 1 m when flat."""
    target = (hi - lo) / 20.0
    if not (math.isfinite(target) and target > 0):
        return 1.0
    k = math.floor(math.log10(target))
    candidates = [m * 10.0**e for e in (k - 1, k, k + 1) for m in NICE]
    return min(candidates, key=lambda c: abs(math.log(c / target)))


def paint_hillshade(
    data: np.ndarray, valid: np.ndarray, ctx: TileContext, *, tint_range: tuple[float, float] | None = None
) -> np.ndarray:
    """Hillshade with the effective cell = the tile resolution; with `tint_range`, tint x hillshade.
    `data` carries a one-pixel halo that is cropped here."""
    z = data[0].astype(np.float64)
    shade = hillshade(z, ctx.res, ctx.res, azimuth=AZIMUTH, altitude=ALTITUDE)[1:-1, 1:-1]
    grey = shade.astype(np.float64)[..., None]
    if tint_range is not None:
        rgb = grey / 255.0 * tint(z[1:-1, 1:-1], *tint_range)
    else:
        rgb = np.repeat(grey, 3, axis=-1)
    rgba = np.zeros((*shade.shape, 4), dtype=np.uint8)
    rgba[..., :3] = np.clip(np.rint(rgb), 0, 255).astype(np.uint8)
    rgba[..., 3] = np.where(shade > 0, 255, 0)  # valid shade is 1..255, so 0 only marks NaN
    return rgba


def paint_contours(
    data: np.ndarray, valid: np.ndarray, ctx: TileContext, *, interval: float
) -> np.ndarray | None:
    """A pixel is on a contour when its band floor(z / interval) is greater than a 4-neighbour's
    (plan deviation 4: 1 px lines), drawn white at 55 % on a transparent tile."""
    band = np.floor(data[0].astype(np.float64) / interval)
    c = band[1:-1, 1:-1]
    on = np.zeros(c.shape, dtype=bool)
    with np.errstate(invalid="ignore"):
        for n in (band[:-2, 1:-1], band[2:, 1:-1], band[1:-1, :-2], band[1:-1, 2:]):
            on |= np.isfinite(n) & (c > n)
    on &= np.isfinite(c)
    if not on.any():
        return None
    rgba = np.zeros((*c.shape, 4), dtype=np.uint8)
    rgba[on] = (255, 255, 255, CONTOUR_ALPHA)
    return rgba


def paint_diff(data: np.ndarray, valid: np.ndarray, ctx: TileContext, *, scale: float) -> np.ndarray:
    return diff_colours(data[0].astype(np.float64), scale)


# --- the pipeline ---------------------------------------------------------------------------------


def _open(path: Path, **kwargs):
    """Every file open of the renderer goes through here (tests spy on it: no I/O before the 204)."""
    return rasterio.open(path, **kwargs)


def _read_vrt(vrt, src: SiteTileSource) -> tuple[np.ndarray, np.ndarray]:
    """The one pixel read per tile (tests spy on it)."""
    if src.float_data:
        data = vrt.read(list(src.bands)).astype(np.float32, copy=False)
        return data, np.isfinite(data).all(axis=0)
    arr = vrt.read()
    data = arr[[b - 1 for b in src.bands]]
    alpha = arr[(src.alpha_band or vrt.count) - 1]
    return data, alpha > 0


def _intersects(frame: SiteFrame, src: SiteTileSource, bounds) -> bool:
    b = bbox_from_site(frame, src.crs_wkt, bounds, strict=False)
    if b is None:
        return False  # Review Focus 1: pyproj cannot place this tile in the source CRS at all
    sx0, sy0, sx1, sy1 = src.bounds_native
    return b[0] < sx1 and b[2] > sx0 and b[1] < sy1 and b[3] > sy0


def _overview_level(factors: list[int], native_res_m: float, tile_res_m: float) -> int | None:
    fitting = [i for i, f in enumerate(factors) if native_res_m * f <= tile_res_m]
    return fitting[-1] if fitting else None


def _warp_read(
    frame: SiteFrame, src: SiteTileSource, z: int, x: int, y: int
) -> tuple[np.ndarray, np.ndarray]:
    size = grid.TILE + 2 * src.halo
    with _open(src.path) as probe:
        factors = probe.overviews(src.bands[0])
        full_w, full_h = probe.width, probe.height
    level = _overview_level(factors, src.native_res_m, grid.res(z))
    kwargs = {"overview_level": level} if level is not None else {}
    vrt_kwargs: dict = {
        "crs": LOCAL_CRS if frame.kind == "local" else frame.crs_wkt,
        "transform": grid.tile_transform(z, x, y, halo=src.halo),
        "width": size,
        "height": size,
        "resampling": Resampling.bilinear,
    }
    if frame.kind == "local":
        vrt_kwargs["src_crs"] = LOCAL_CRS
    if src.float_data:
        vrt_kwargs.update(src_nodata=np.nan, nodata=np.nan, dtype="float32")
    elif src.alpha_band is None:
        vrt_kwargs["add_alpha"] = True  # the warped alpha carries the source mask and the no-overlap area
    with _open(src.path, **kwargs) as ds:
        if src.src_transform is not None:
            # the preview affine is for full-resolution pixels: scale it to the opened overview
            vrt_kwargs["src_transform"] = src.src_transform @ Affine.scale(
                full_w / ds.width, full_h / ds.height
            )
            if frame.kind != "local":
                vrt_kwargs["src_crs"] = frame.crs_wkt
        with WarpedVRT(ds, **vrt_kwargs) as vrt:
            return _read_vrt(vrt, src)


def _png(rgba: np.ndarray) -> bytes:
    buf = io.BytesIO()
    PILImage.fromarray(rgba, "RGBA").save(buf, "PNG", optimize=False)
    return buf.getvalue()


def render_site_tile(
    frame: SiteFrame, src: SiteTileSource, z: int, x: int, y: int, style: TileStyle
) -> bytes | None:
    """A PNG, or None (the route's 204) outside the footprint, outside the frame, or when nothing is
    drawn."""
    if not frame.holds(src.crs_wkt) or not _intersects(frame, src, grid.tile_bounds(z, x, y)):
        return None
    data, valid = _warp_read(frame, src, z, x, y)
    rgba = src.paint(data, valid, TileContext(frame, z, x, y, grid.res(z), src.halo))
    if rgba is None or not rgba[..., 3].any():
        return None
    return _png(rgba)


def _normalise(kind: str, style: TileStyle) -> TileStyle:
    """Ruling R-B1-3: each option only for its kind, so unstyled kinds share one cache entry. The
    contract (getSiteTile 422) overrides R-B1-11: a `t` on any other kind is 422 invalid_preview."""
    if style.preview is not None and kind != "drawing_raster":
        raise _invalid_preview(f"t is a drawing preview; a {kind} tile does not take it")
    if kind == "surface":
        return TileStyle(style.style, style.interval)
    if kind == "drawing_raster":
        return TileStyle(knockout=style.knockout, preview=style.preview)
    return TileStyle()


def is_preview(kind: str, style: TileStyle) -> bool:
    """The route answers `Cache-Control: no-store` for these (R-B1-11)."""
    return kind == "drawing_raster" and style.preview is not None


def serve_site_tile(
    handle: ProjectHandle,
    frame: SiteFrame,
    kind: str,
    layer_id: str,
    z: int,
    x: int,
    y: int,
    style: TileStyle,
) -> bytes | None:
    style = _normalise(kind, style)
    resolve = _RESOLVERS.get(kind)
    if resolve is None:
        raise not_found("site tile layer kind", kind)
    src = resolve(handle, layer_id, style)
    if not frame.holds(src.crs_wkt):
        raise not_in_frame(f"{kind} {layer_id}")  # ruling R-B1-10
    if is_preview(kind, style):
        return render_site_tile(frame, src, z, x, y, style)  # never cached: the affine changes per drag
    key = (handle.id, layer_id, kind, src.version, frame.key, z, x, y, style.key)
    hit = SITE_TILES.get(key)
    if hit is None:
        hit = (render_site_tile(frame, src, z, x, y, style),)
        SITE_TILES.put(key, hit)
    return hit[0]


# --- resolvers ------------------------------------------------------------------------------------


def _not_ready(what: str, name: str, status: str) -> AppError:
    return AppError("not_ready", f"{what} {name} is {status}, not ready", 409)


def map_native_m(m: GeoMap) -> float:
    """A georeferenced map's full-resolution ground pixel in metres: its GSD, else the geotransform's
    pixel size. The one rule for it (controller ruling F10): import this, never re-derive it."""
    if m.gsd_cm:
        return m.gsd_cm / 100
    return Georef(m.geotransform, m.crs_wkt).metres_per_pixel(m.width, m.height)


def _map_source(handle: ProjectHandle, map_id: str, style: TileStyle) -> SiteTileSource:
    with handle.session() as s:
        m = s.get(GeoMap, map_id)
        if m is None or m.status == "failed":
            raise not_found("map", map_id)
        if m.status != "ready":
            raise _not_ready("map", m.name, m.status)
        if not m.crs_wkt or not m.geotransform:
            raise not_in_frame(f"map {m.name}, which has no coordinates,")
        g = Georef(m.geotransform, m.crs_wkt)
        bounds = tuple(m.bounds_native) if m.bounds_native else tuple(g.bounds_native(m.width, m.height))
        native = map_native_m(m)
        crs = m.crs_wkt
    return SiteTileSource(
        layer_id=map_id,
        version=map_id,  # ruling R-B1-2: a re-import is a new id
        path=map_raster_path(handle, map_id),
        crs_wkt=crs,
        bounds_native=bounds,
        native_res_m=native,
        paint=paint_rgb,
    )


def _surface_source(handle: ProjectHandle, surface_id: str, style: TileStyle) -> SiteTileSource:
    with handle.session() as s:
        row = s.get(Surface, surface_id)
        if row is None or row.status == "failed":
            raise not_found("surface", surface_id)
        if row.status != "ready":
            raise _not_ready("surface", row.name, row.status)
        stats = row.stats or {}
        lo, hi = stats.get("z_p02"), stats.get("z_p98")
        if lo is None or hi is None:
            lo, hi = row.z_min, row.z_max
        fields = dict(
            layer_id=row.id,
            version=row.job_id or "1",  # ruling R-B1-2
            path=surface_path(handle, row.id),
            crs_wkt=row.crs_wkt,
            bounds_native=tuple(row.bounds_native),
            native_res_m=float(row.cell_size_m),
        )
    has_range = lo is not None and hi is not None
    mode = style.style or "hillshade"  # ruling R-B1-3
    if mode == "contours":
        interval = style.interval or (nice_interval(lo, hi) if has_range else 1.0)
        paint = partial(paint_contours, interval=interval)
    elif mode == "tint" and has_range:
        paint = partial(paint_hillshade, tint_range=(float(lo), float(hi)))
    else:
        paint = paint_hillshade
    return SiteTileSource(**fields, paint=paint, bands=(1,), float_data=True, halo=1)


def _diff_source(handle: ProjectHandle, measurement_id: str, style: TileStyle) -> SiteTileSource:
    # local imports: importing `tiles` never pulls the volumes engine at module load
    from app.surfaces.service import require_ready
    from app.volumes.engine import ring_polygon
    from app.volumes.paths import diff_path
    from app.volumes.service import peek

    out = peek(handle, measurement_id)  # 404 when absent
    if out.status == "failed":
        raise not_found("volume measurement", measurement_id)  # ruling R-B1-10 (controller F15)
    if out.status == "calculating":
        # a recalculation keeps the previous results and diff.tif until the job swaps them (R-B1-10)
        raise _not_ready("volume measurement", out.name, out.status)
    path = diff_path(handle, measurement_id)
    if out.results is None or not path.is_file():
        raise AppError("not_ready", f"{out.name} has no results yet; calculate it first", 409)
    top = require_ready(handle, out.results.top_surface.id)
    return SiteTileSource(
        layer_id=measurement_id,
        version=out.results.computed_at.isoformat(),  # ruling R-B1-2
        path=path,
        crs_wkt=top.crs_wkt,
        bounds_native=tuple(ring_polygon(out.polygon_native).bounds),  # deviation 5: no I/O
        native_res_m=float(top.cell_size_m),
        paint=partial(paint_diff, scale=out.results.diff_scale_m),
        bands=(1,),
        float_data=True,
    )


register_site_tile_source("map", _map_source)
register_site_tile_source("surface", _surface_source)
register_site_tile_source("volume_diff", _diff_source)
