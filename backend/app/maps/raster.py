"""Everything that touches raster pixels, through rasterio (spec sections 4, 5 and 6).

Every read here is bounded: a window, or a decimated read of the whole extent whose longest side
is capped. GDAL serves decimated reads from the overviews, so their cost does not grow with the map.
"""

from __future__ import annotations

import os
import warnings
from collections.abc import Callable
from dataclasses import dataclass
from pathlib import Path

import numpy as np
import rasterio
from PIL import Image as PILImage
from rasterio.enums import ColorInterp, Resampling
from rasterio.errors import NotGeoreferencedWarning, RasterioIOError
from rasterio.windows import Window

BLOCK = 512  # internal tile size of the display raster; JPEG-in-TIFF needs a multiple of 16
MIN_OVERVIEW_SIDE = 256
STATS_SIDE = 1024
PERCENTILES = (2.0, 98.0)
JPEG_QUALITY = 90


class RasterError(Exception):
    """The file cannot be used as a map; the message is written for the operator."""


@dataclass(frozen=True)
class RasterInfo:
    width: int
    height: int
    band_count: int
    dtype: str
    crs_wkt: str | None
    epsg: int | None
    proj4: str | None
    geotransform: tuple[float, ...] | None


@dataclass(frozen=True)
class Stretch:
    bands: tuple[int, int, int]
    lo: tuple[float, float, float]
    hi: tuple[float, float, float]

    def to_dict(self) -> dict:
        return {"bands": list(self.bands), "lo": list(self.lo), "hi": list(self.hi)}

    @classmethod
    def from_dict(cls, d: dict) -> Stretch:
        return cls(tuple(d["bands"]), tuple(float(v) for v in d["lo"]), tuple(float(v) for v in d["hi"]))


def inspect_raster(path: Path) -> RasterInfo:
    try:
        with warnings.catch_warnings():
            warnings.simplefilter("ignore", NotGeoreferencedWarning)
            with rasterio.open(path) as src:
                georeferenced = src.crs is not None and not src.transform.is_identity
                crs_wkt = src.crs.to_wkt() if georeferenced else None
                epsg = src.crs.to_epsg() if georeferenced else None
                geotransform = tuple(src.transform.to_gdal()) if georeferenced else None
                info = (src.width, src.height, src.count, src.dtypes[0])
    except RasterioIOError as e:
        raise RasterError(f"{Path(path).name} is not a readable raster ({e})") from None
    proj4 = None
    if crs_wkt:
        from pyproj import CRS

        proj4 = CRS.from_wkt(crs_wkt).to_proj4()
    return RasterInfo(*info, crs_wkt=crs_wkt, epsg=epsg, proj4=proj4, geotransform=geotransform)


def _rgb_bands(src) -> tuple[int, int, int]:
    interp = list(src.colorinterp)
    wanted = [ColorInterp.red, ColorInterp.green, ColorInterp.blue]
    if all(c in interp for c in wanted):
        return tuple(interp.index(c) + 1 for c in wanted)
    if src.count >= 3:
        return (1, 2, 3)
    return (1, 1, 1)


def _decimated_shape(src, max_side: int) -> tuple[int, int, float]:
    scale = min(1.0, max_side / max(src.width, src.height))
    return max(1, round(src.height * scale)), max(1, round(src.width * scale)), scale


def compute_stretch(src) -> Stretch:
    """8-bit sources pass through; anything else maps its 2nd-98th percentile per band to 0-255."""
    bands = _rgb_bands(src)
    if all(src.dtypes[b - 1] == "uint8" for b in bands):
        return Stretch(bands, (0.0, 0.0, 0.0), (255.0, 255.0, 255.0))
    h, w, _ = _decimated_shape(src, STATS_SIDE)
    unique = sorted(set(bands))
    data = src.read(unique, out_shape=(len(unique), h, w), resampling=Resampling.nearest)
    valid = src.dataset_mask(out_shape=(h, w)) > 0
    per_band: dict[int, tuple[float, float]] = {}
    for i, b in enumerate(unique):
        values = data[i][valid] if valid.any() else data[i].ravel()
        lo, hi = np.percentile(values, PERCENTILES)
        per_band[b] = (float(lo), float(hi) if hi > lo else float(lo) + 1.0)
    return Stretch(bands, tuple(per_band[b][0] for b in bands), tuple(per_band[b][1] for b in bands))


def apply_stretch(data: np.ndarray, stretch: Stretch) -> np.ndarray:
    """(3, h, w) of any dtype to (3, h, w) uint8."""
    lo = np.array(stretch.lo, dtype=np.float32).reshape(3, 1, 1)
    hi = np.array(stretch.hi, dtype=np.float32).reshape(3, 1, 1)
    scaled = (data.astype(np.float32) - lo) * (255.0 / (hi - lo))
    return np.clip(scaled, 0, 255).astype(np.uint8)


def overview_factors(width: int, height: int) -> list[int]:
    factors, f = [], 2
    while max(width, height) / f >= MIN_OVERVIEW_SIDE:
        factors.append(f)
        f *= 2
    return factors


def write_display_raster(
    src_path: Path,
    dst_path: Path,
    stretch: Stretch,
    *,
    progress: Callable[[float, str], None],
    check_cancelled: Callable[[], None],
    block: int = 2048,
) -> None:
    """The display raster, block by block: 8-bit RGB, JPEG/YCbCr in 512 px tiles, internal mask,
    internal overviews. Written to `<dst>.partial` and renamed only when complete."""
    assert block % BLOCK == 0, "blocks must align with the internal tiles, or JPEG tiles are re-encoded"
    partial = dst_path.with_name(dst_path.name + ".partial")
    try:
        with warnings.catch_warnings():
            warnings.simplefilter("ignore", NotGeoreferencedWarning)
            with rasterio.Env(GDAL_TIFF_INTERNAL_MASK=True), rasterio.open(src_path) as src:
                profile = dict(
                    driver="GTiff",
                    width=src.width,
                    height=src.height,
                    count=3,
                    dtype="uint8",
                    tiled=True,
                    blockxsize=BLOCK,
                    blockysize=BLOCK,
                    compress="JPEG",
                    photometric="YCBCR",
                    jpeg_quality=JPEG_QUALITY,
                    bigtiff="IF_SAFER",
                )
                if src.crs is not None and not src.transform.is_identity:
                    profile.update(crs=src.crs, transform=src.transform)
                cells = [(r, c) for r in range(0, src.height, block) for c in range(0, src.width, block)]
                with rasterio.open(partial, "w", **profile) as dst:
                    for i, (row, col) in enumerate(cells, start=1):
                        check_cancelled()
                        win = Window(col, row, min(block, src.width - col), min(block, src.height - row))
                        data = src.read(list(stretch.bands), window=win)
                        dst.write(apply_stretch(data, stretch), window=win)
                        dst.write_mask(src.dataset_mask(window=win), window=win)
                        progress(0.85 * i / len(cells), f"block {i} / {len(cells)}")
            factors = overview_factors(profile["width"], profile["height"])
            if factors:
                progress(0.87, "building zoom levels")
                check_cancelled()
                env = dict(
                    GDAL_TIFF_INTERNAL_MASK=True,
                    COMPRESS_OVERVIEW="JPEG",
                    PHOTOMETRIC_OVERVIEW="YCBCR",
                    INTERLEAVE_OVERVIEW="PIXEL",
                    JPEG_QUALITY_OVERVIEW=JPEG_QUALITY,
                )
                with rasterio.Env(**env), rasterio.open(partial, "r+") as dst:
                    dst.build_overviews(factors, Resampling.average)
        os.replace(partial, dst_path)
    except BaseException:
        partial.unlink(missing_ok=True)
        raise


def read_rgb(src, x: int, y: int, w: int, h: int, out_w: int, out_h: int) -> tuple[np.ndarray, np.ndarray]:
    """One window of the display raster as (out_h, out_w, 3) uint8 plus a validity mask."""
    win = Window(x, y, w, h)
    data = src.read([1, 2, 3], window=win, out_shape=(3, out_h, out_w), resampling=Resampling.bilinear)
    valid = src.dataset_mask(window=win, out_shape=(out_h, out_w)) > 0
    return np.moveaxis(data, 0, -1), valid


def low_res_mask(src, max_side: int = 2048) -> tuple[np.ndarray, float]:
    h, w, scale = _decimated_shape(src, max_side)
    return src.dataset_mask(out_shape=(h, w)) > 0, scale


def write_preview(src, dst_path: Path, max_side: int = 1024) -> None:
    h, w, _ = _decimated_shape(src, max_side)
    rgb, valid = read_rgb(src, 0, 0, src.width, src.height, w, h)
    rgb = rgb.copy()
    rgb[~valid] = 128
    PILImage.fromarray(rgb, "RGB").save(dst_path, "JPEG", quality=85)
