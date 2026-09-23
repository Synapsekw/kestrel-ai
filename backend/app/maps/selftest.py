"""`kestrel-backend.exe geo-selftest`: proves the frozen bundle carries a working GDAL and PROJ.

It writes a small georeferenced tiled GeoTIFF with JPEG compression, an internal mask and
overviews (the exact layout `map_import` writes), reads a decimated window back, and reprojects
one point from UTM 33N to WGS84. Each step exercises a different piece of native code the
PyInstaller spec has to collect.
"""

from __future__ import annotations

import tempfile
from pathlib import Path

import numpy as np


def main() -> int:
    import rasterio
    from pyproj import Transformer
    from rasterio.enums import Resampling
    from rasterio.transform import from_origin
    from rasterio.windows import Window

    with tempfile.TemporaryDirectory(prefix="kestrel-geo-") as tmp:
        path = Path(tmp) / "selftest.tif"
        profile = dict(
            driver="GTiff",
            width=1024,
            height=1024,
            count=3,
            dtype="uint8",
            crs="EPSG:32633",
            transform=from_origin(500000, 4983000, 0.05, 0.05),
            tiled=True,
            blockxsize=512,
            blockysize=512,
            compress="JPEG",
            photometric="YCBCR",
        )
        data = np.random.default_rng(0).integers(0, 255, (3, 1024, 1024), dtype=np.uint8)
        with rasterio.Env(GDAL_TIFF_INTERNAL_MASK=True):
            with rasterio.open(path, "w", **profile) as dst:
                dst.write(data)
                dst.write_mask(np.full((1024, 1024), 255, np.uint8))
            with rasterio.open(path, "r+") as dst:
                dst.build_overviews([2, 4], Resampling.average)
        with rasterio.open(path) as src:
            small = src.read([1, 2, 3], window=Window(0, 0, 1024, 1024), out_shape=(3, 64, 64))
            assert small.shape == (3, 64, 64)
            epsg = src.crs.to_epsg()
            x, y = src.transform * (512, 512)
    lon, lat = Transformer.from_crs(f"EPSG:{epsg}", "EPSG:4326", always_xy=True).transform(x, y)
    print(f"geo ok {epsg} {lon:.6f} {lat:.6f}", flush=True)
    return 0
