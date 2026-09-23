"""Small synthetic GeoTIFFs, generated at test time (nothing binary is committed)."""

from __future__ import annotations

from pathlib import Path

import numpy as np
import rasterio
from affine import Affine
from rasterio.enums import ColorInterp


def make_geotiff(
    path: Path,
    width: int,
    height: int,
    *,
    count: int = 3,
    dtype: str = "uint8",
    crs: str | None = "EPSG:32633",
    pixel: float = 0.03,
    origin: tuple[float, float] = (500000.0, 4983000.0),
    rotation: float = 0.0,
    nodata: float | None = None,
    alpha_border: float = 0.0,
    seed: int = 0,
) -> Path:
    """Seeded noise. `alpha_border` masks that fraction of the width on each side through a 4th
    alpha band; `nodata` zeroes the same border and declares it nodata instead."""
    rng = np.random.default_rng(seed)
    top = 255 if dtype == "uint8" else 4000
    data = rng.integers(1, top, size=(count, height, width)).astype(dtype)
    border = int(width * alpha_border)
    if nodata is not None and border:
        data[:, :, :border] = nodata
        data[:, :, width - border :] = nodata
    transform = (
        Affine.translation(*origin) * Affine.rotation(rotation) * Affine.scale(pixel, -pixel)
        if crs
        else Affine.identity()
    )
    bands = count + (1 if alpha_border and nodata is None else 0)
    profile = dict(driver="GTiff", width=width, height=height, count=bands, dtype=dtype, transform=transform)
    if crs:
        profile["crs"] = crs
    if nodata is not None:
        profile["nodata"] = nodata
    path.parent.mkdir(parents=True, exist_ok=True)
    with rasterio.open(path, "w", **profile) as dst:
        dst.write(data, indexes=list(range(1, count + 1)))
        if bands > count:
            alpha = np.full((height, width), top, dtype=dtype)
            alpha[:, :border] = 0
            alpha[:, width - border :] = 0
            dst.write(alpha, bands)
            dst.colorinterp = [ColorInterp.red, ColorInterp.green, ColorInterp.blue, ColorInterp.alpha]
    return path
