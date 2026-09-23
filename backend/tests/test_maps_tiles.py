import io

import numpy as np
import rasterio
from geotiffs import make_geotiff
from PIL import Image

from app.maps import raster, tiles


def _display(tmp_path, w, h, **kw):
    src = make_geotiff(tmp_path / "src.tif", w, h, **kw)
    dst = tmp_path / "map.tif"
    with rasterio.open(src) as s:
        stretch = raster.compute_stretch(s)
    raster.write_display_raster(src, dst, stretch, progress=lambda *a: None, check_cancelled=lambda: None)
    return dst


def test_max_zoom():
    assert tiles.max_zoom(200, 100) == 0
    assert tiles.max_zoom(257, 10) == 1
    assert tiles.max_zoom(80000, 60000) == 9


def test_tile_window():
    mz = tiles.max_zoom(1000, 600)  # 2
    assert tiles.tile_window(2, 0, 0, 1000, 600, mz) == tiles.TileWindow(0, 0, 256, 256, 256, 256)
    edge = tiles.tile_window(2, 3, 2, 1000, 600, mz)  # x0 768, y0 512
    assert edge == tiles.TileWindow(768, 512, 232, 88, 232, 88)
    assert tiles.tile_window(0, 0, 0, 1000, 600, mz) == tiles.TileWindow(0, 0, 1000, 600, 250, 150)
    assert tiles.tile_window(2, 4, 0, 1000, 600, mz) is None  # past the right edge
    assert tiles.tile_window(3, 0, 0, 1000, 600, mz) is None  # deeper than full resolution


def test_full_resolution_tile_matches_a_direct_read(tmp_path):
    path = _display(tmp_path, 1000, 600)
    with rasterio.open(path) as src:
        body, media = tiles.render_tile(src, 1000, 600, 2, 1, 1)
        direct, _ = raster.read_rgb(src, 256, 256, 256, 256, 256, 256)
    assert media == "image/jpeg"
    decoded = np.asarray(Image.open(io.BytesIO(body)).convert("RGB")).astype(int)
    assert np.abs(decoded - direct.astype(int)).mean() < 8  # JPEG on JPEG, same pixels


def test_edge_and_masked_tiles_are_png_and_empty_ones_are_none(tmp_path):
    path = _display(tmp_path, 1000, 600, alpha_border=0.3)
    with rasterio.open(path) as src:
        # x 512-768 by y 512-600: valid up to x 700, masked border after, raster ends at y 600
        body, media = tiles.render_tile(src, 1000, 600, 2, 2, 2)
        assert media == "image/png"
        im = Image.open(io.BytesIO(body))
        assert im.mode == "RGBA" and im.size == (256, 256)
        assert im.getpixel((250, 250))[3] == 0  # outside the raster: transparent
        assert tiles.render_tile(src, 1000, 600, 2, 0, 0) is None  # inside the masked border


def test_reads_are_bounded(tmp_path, monkeypatch):
    path = _display(tmp_path, 3000, 2000)
    shapes = []
    real = raster.read_rgb

    def spy(src, x, y, w, h, out_w, out_h):
        shapes.append((out_w, out_h))
        return real(src, x, y, w, h, out_w, out_h)

    monkeypatch.setattr(tiles.raster, "read_rgb", spy)
    with rasterio.open(path) as src:
        for z in range(tiles.max_zoom(3000, 2000) + 1):
            tiles.render_tile(src, 3000, 2000, z, 0, 0)
    assert shapes and all(w <= 256 and h <= 256 for w, h in shapes)


def test_cache_is_lru_and_drops_a_map():
    cache = tiles.TileCache(max_items=2)
    cache.put(("p", "m1", 0, 0, 0), (b"a", "image/jpeg"))
    cache.put(("p", "m2", 0, 0, 0), (b"b", "image/jpeg"))
    cache.get(("p", "m1", 0, 0, 0))
    cache.put(("p", "m3", 0, 0, 0), (b"c", "image/jpeg"))
    assert cache.get(("p", "m2", 0, 0, 0)) is None
    cache.drop_map("m1")
    assert cache.get(("p", "m1", 0, 0, 0)) is None
