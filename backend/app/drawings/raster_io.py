"""PNG/JPG/TIF drawings (spec §8.2): inspect, RGBA conversion, and (task 5) the windowed copy into
plan.tif. Never a whole-image decode: reads are windows of <= 2048² or decimated to a thumbnail.

Loaded only inside the `drawing_import` job (phase_inspect imports readers by name), so rasterio at
module scope here never reaches the router's import chain."""

from __future__ import annotations

import contextlib
import os
import warnings
from pathlib import Path

import numpy as np
import rasterio
from affine import Affine
from PIL import Image
from rasterio.crs import CRS
from rasterio.enums import ColorInterp, Resampling
from rasterio.errors import NotGeoreferencedWarning
from rasterio.windows import Window

from app.drawings import store
from app.drawings.inspected import Inspected, warning
from app.maps.raster import overview_factors

MESSAGE = "Reading drawing"
THUMB = 160
WORLD_FILE_NEEDS_CRS = "A world file places this image; choose its coordinate system"


@contextlib.contextmanager
def quiet():
    with warnings.catch_warnings():
        warnings.simplefilter("ignore", NotGeoreferencedWarning)
        yield


def _to_uint8(data: np.ndarray) -> np.ndarray:
    """Plan Ruling 12: 16-bit >> 8, other integers and floats clipped to 0..255."""
    if data.dtype == np.uint8:
        return data
    if data.dtype == np.uint16:
        return (data >> 8).astype(np.uint8)
    return np.clip(np.nan_to_num(data.astype(np.float64)), 0, 255).astype(np.uint8)


def read_rgba(src, window=None, out_shape: tuple[int, int] | None = None) -> np.ndarray:
    """(4, h, w) uint8 RGBA of a window (or the whole raster decimated to out_shape)."""
    interp = list(src.colorinterp)
    paletted = src.count == 1 and interp[0] == ColorInterp.palette
    kw: dict = {"window": window}
    mask_kw: dict = {"window": window}
    if out_shape is not None:
        resampling = Resampling.nearest if paletted else Resampling.average
        kw.update(out_shape=(src.count, *out_shape), resampling=resampling)
        mask_kw["out_shape"] = out_shape
    data = src.read(**kw)
    out = np.empty((4, *data.shape[1:]), np.uint8)
    if paletted:
        lut = np.zeros((256, 4), np.uint8)
        for k, v in src.colormap(1).items():
            if 0 <= k < 256:
                lut[k] = v
        out[:] = np.moveaxis(lut[data[0].astype(np.intp).clip(0, 255)], -1, 0)
        return out
    data8 = _to_uint8(data)
    if src.count == 1:
        out[0] = out[1] = out[2] = data8[0]
        out[3] = src.dataset_mask(**mask_kw)
    elif src.count == 2:
        out[0] = out[1] = out[2] = data8[0]
        out[3] = data8[1]
    else:
        out[:3] = data8[:3]
        has_alpha = src.count >= 4 and interp[3] == ColorInterp.alpha
        out[3] = data8[3] if has_alpha else src.dataset_mask(**mask_kw)
    return out


def _png(rgba: np.ndarray, out: Path) -> None:
    out.parent.mkdir(parents=False, exist_ok=True)  # never recreate a deleted inspection folder
    tmp = out.with_name(out.name + ".tmp")  # atomic: a reader never sees a half-written PNG
    Image.fromarray(np.moveaxis(rgba, 0, -1), "RGBA").save(tmp, format="PNG")
    os.replace(tmp, out)


def write_thumbnail(src, out: Path, size: int = THUMB) -> None:
    scale = size / max(src.width, src.height)
    shape = (max(1, round(src.height * scale)), max(1, round(src.width * scale)))
    _png(read_rgba(src, out_shape=shape), out)


def _embedded(src) -> dict | None:
    """A GeoTIFF CRS + geotransform, or a world file (no CRS). The transform is (col, -row) -> (E, N):
    [a, -b, c, d, -e, f] of the pixel geotransform Affine(a, b, c, d, e, f)."""
    t = src.transform
    if t.is_identity:
        return None
    crs = src.crs
    return {
        "source": "geotiff" if crs is not None else "world_file",
        "crs_wkt": crs.to_wkt() if crs is not None else None,
        "epsg": crs.to_epsg() if crs is not None else None,
        "transform": [t.a, -t.b, t.c, t.d, -t.e, t.f],
        "needs_crs": crs is None,
    }


def inspect_file(path: Path, idir: Path, *, progress, check_cancelled) -> Inspected:
    with quiet(), rasterio.open(path) as src:
        check_cancelled()
        width, height = src.width, src.height
        embedded = _embedded(src)
        progress(0.5, MESSAGE)
        write_thumbnail(src, store.page_thumb(idir, 1))
    warnings_ = []
    if embedded is not None and embedded["needs_crs"]:
        warnings_.append(warning("world_file_needs_crs", WORLD_FILE_NEEDS_CRS))
    progress(1.0, MESSAGE)
    return Inspected(
        extent_src=[0.0, float(-height), float(width), 0.0],
        width=width,
        height=height,
        embedded=embedded,
        warnings=warnings_,
    )


BLOCK = 512
COPY_BLOCK = 2048


def plan_profile(width: int, height: int) -> dict:
    """plan.tif (spec §8.1): RGBA 8-bit, tiled 512, DEFLATE; overviews are added after the write."""
    return dict(
        driver="GTiff",
        width=width,
        height=height,
        count=4,
        dtype="uint8",
        tiled=True,
        blockxsize=BLOCK,
        blockysize=BLOCK,
        compress="DEFLATE",
        predictor=2,
        photometric="RGB",
        bigtiff="IF_SAFER",
    )


@contextlib.contextmanager
def open_plan(path: Path, width: int, height: int):
    with quiet(), rasterio.open(path, "w", **plan_profile(width, height)) as dst:
        dst.colorinterp = [ColorInterp.red, ColorInterp.green, ColorInterp.blue, ColorInterp.alpha]
        yield dst


def build_overviews(path: Path, *, progress, check_cancelled) -> None:
    with quiet(), rasterio.open(path) as probe:
        factors = overview_factors(probe.width, probe.height)
    if not factors:
        return
    progress(0.9, "building zoom levels")
    check_cancelled()
    env = rasterio.Env(COMPRESS_OVERVIEW="DEFLATE", PREDICTOR_OVERVIEW=2)
    with quiet(), env, rasterio.open(path, "r+") as dst:
        dst.build_overviews(factors, Resampling.average)


def copy_to_plan(
    src_path: Path, dst: Path, *, progress, check_cancelled, block: int = COPY_BLOCK
) -> tuple[int, int]:
    """The source, window by window, as plan.tif (written to .partial, renamed when complete)."""
    partial = dst.with_name(dst.name + ".partial")
    try:
        with quiet(), rasterio.open(src_path) as src:
            width, height = src.width, src.height
            cells = [(r, c) for r in range(0, height, block) for c in range(0, width, block)]
            with open_plan(partial, width, height) as out:
                for i, (r, c) in enumerate(cells, start=1):
                    check_cancelled()
                    win = Window(c, r, min(block, width - c), min(block, height - r))
                    out.write(read_rgba(src, window=win), window=win)
                    progress(0.85 * i / len(cells), f"block {i} / {len(cells)}")
        build_overviews(partial, progress=progress, check_cancelled=check_cancelled)
        os.replace(partial, dst)
    except BaseException:
        partial.unlink(missing_ok=True)
        raise
    return width, height


def write_plan_georef(path: Path, transform, crs_wkt: str | None) -> None:
    """The placement as plan.tif's own geotransform (M-B1 warps plan.tif like an ortho). A metadata
    write (r+), so overviews stay valid. (col, -row) -> (E, N) = [a, b, c, d, e, f] is the pixel
    geotransform Affine(a, -b, c, d, -e, f)."""
    a, b, c, d, e, f = transform
    with quiet(), rasterio.open(path, "r+") as dst:
        dst.transform = Affine(a, -b, c, d, -e, f)
        # a local placement unsets the CRS: M-B1 warps a CRS frame by the file's own CRS (task 16 (a))
        dst.crs = CRS.from_wkt(crs_wkt) if crs_wkt else CRS()


def clear_plan_georef(path: Path) -> None:
    with quiet(), rasterio.open(path, "r+") as dst:
        dst.transform = Affine.identity()
        dst.crs = CRS()


def write_plan_thumbnail(plan: Path, out: Path) -> None:
    with quiet(), rasterio.open(plan) as src:
        write_thumbnail(src, out)
