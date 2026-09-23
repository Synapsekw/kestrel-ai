"""`kestrel-backend.exe geo-selftest`: proves the frozen bundle carries a working GDAL and PROJ.

It writes a small georeferenced source GeoTIFF, then drives it through the real display-raster
pipeline — `app.maps.raster.compute_stretch` and `app.maps.raster.write_display_raster`, the same
functions and the same GDAL creation options `map_import` uses to build the tiled, JPEG-in-TIFF,
internally-masked raster with overviews the viewer reads. It reopens that raster to check the tile
layout, the overviews and the mask, reads one bounded window back through `app.maps.raster.read_rgb`,
and reprojects one point from UTM 33N to WGS84. Each step exercises a different piece of native code
the PyInstaller spec has to collect; the display-raster step in particular proves the frozen
libjpeg/libtiff accept the overview compression options the real import path relies on.
"""

from __future__ import annotations

import tempfile
from pathlib import Path

import numpy as np

SIZE = 1024  # big enough that overview_factors() actually returns levels
PIXEL = 0.05
ORIGIN = (500000.0, 4983000.0)


def run() -> dict:
    """Write, process and read back a small GeoTIFF; return the facts `main()` checks and prints."""
    import rasterio
    from pyproj import Transformer
    from rasterio.transform import from_origin

    from app.maps.raster import compute_stretch, read_rgb, write_display_raster

    with tempfile.TemporaryDirectory(prefix="kestrel-geo-") as tmp:
        src_path = Path(tmp) / "selftest.tif"
        dst_path = Path(tmp) / "display.tif"
        profile = dict(
            driver="GTiff",
            width=SIZE,
            height=SIZE,
            count=3,
            dtype="uint8",
            crs="EPSG:32633",
            transform=from_origin(ORIGIN[0], ORIGIN[1], PIXEL, PIXEL),
        )
        data = np.random.default_rng(0).integers(0, 255, (3, SIZE, SIZE), dtype=np.uint8)
        with rasterio.open(src_path, "w", **profile) as dst:
            dst.write(data)

        with rasterio.open(src_path) as src:
            stretch = compute_stretch(src)
        write_display_raster(
            src_path, dst_path, stretch, progress=lambda *_a: None, check_cancelled=lambda: None
        )

        with rasterio.open(dst_path) as out:
            block_shapes = out.block_shapes[0]
            overviews = out.overviews(1)
            mask = out.dataset_mask()
            rgb, valid = read_rgb(out, 0, 0, out.width, out.height, 64, 64)
            epsg = out.crs.to_epsg()
            x, y = out.transform * (SIZE // 2, SIZE // 2)

    lon, lat = Transformer.from_crs(f"EPSG:{epsg}", "EPSG:4326", always_xy=True).transform(x, y)
    return {
        "epsg": epsg,
        "lon": lon,
        "lat": lat,
        "block_shapes": block_shapes,
        "overviews": overviews,
        "mask_shape": mask.shape,
        "mask_full": bool((mask > 0).all()),
        "rgb_shape": rgb.shape,
        "valid_shape": valid.shape,
    }


def main() -> int:
    facts = run()
    assert facts["block_shapes"] == (512, 512), f"unexpected block layout: {facts['block_shapes']}"
    assert facts["overviews"], "write_display_raster built no overviews"
    assert facts["mask_shape"] == (SIZE, SIZE), f"mask is not full-size: {facts['mask_shape']}"
    assert facts["mask_full"], "dataset_mask reports invalid pixels on an unmasked source"
    assert facts["rgb_shape"] == (64, 64, 3), f"read_rgb returned {facts['rgb_shape']}"
    assert facts["valid_shape"] == (64, 64), f"read_rgb mask returned {facts['valid_shape']}"
    print(f"geo ok {facts['epsg']} {facts['lon']:.6f} {facts['lat']:.6f}", flush=True)
    return 0
