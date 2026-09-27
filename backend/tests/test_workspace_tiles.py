"""The site tile renderer (spec 2026-09-26-map-workspace section 6), without HTTP."""

from pathlib import Path

import numpy as np
import pytest
import rasterio
from affine import Affine
from pyproj import CRS
from workspace_rows import rgba, write_plan_tif

from app.errors import AppError
from app.surfaces.grid import hillshade
from app.workspace import grid, tiles
from app.workspace.frame import LOCAL, frame_for_epsg

UTM39 = CRS.from_epsg(32639).to_wkt()
F39 = frame_for_epsg(32639)
ORIGIN = (500000.0, 3300000.0)
PLAN_GT = Affine(0.125, 0, 500000.0, 0, -0.125, 3300000.0)
pytestmark = pytest.mark.usefixtures("fresh_site_tiles")


def _rgb_tif(path: Path, origin=ORIGIN, px=0.125, size=512, value=200, mask_left=0) -> Path:
    with rasterio.open(
        path,
        "w",
        driver="GTiff",
        width=size,
        height=size,
        count=3,
        dtype="uint8",
        crs=UTM39,
        transform=Affine(px, 0, origin[0], 0, -px, origin[1]),
        tiled=True,
        blockxsize=256,
        blockysize=256,
    ) as ds:
        ds.write(np.full((3, size, size), value, np.uint8))
        mask = np.full((size, size), 255, np.uint8)
        mask[:, :mask_left] = 0
        ds.write_mask(mask)
    return path


def _source(path: Path, *, origin=ORIGIN, px=0.125, size=512, **kw) -> tiles.SiteTileSource:
    bounds = (origin[0], origin[1] - size * px, origin[0] + size * px, origin[1])
    return tiles.SiteTileSource(
        layer_id="L",
        version="1",
        path=path,
        crs_wkt=UTM39,
        bounds_native=bounds,
        native_res_m=px,
        paint=tiles.paint_rgb,
        **kw,
    )


def test_a_fully_covered_tile_is_opaque_png(tmp_path):
    src = _source(_rgb_tif(tmp_path / "m.tif"))
    x, y = grid.tile_of(500001.0, 3299999.0, 13)  # res 0.125 m: one tile = 32 m, fully on the map
    img = rgba(tiles.render_site_tile(F39, src, 13, x, y, tiles.TileStyle()))
    assert img.shape == (256, 256, 4) and (img[..., 3] == 255).all() and (img[..., 0] == 200).all()


def test_outside_the_footprint_is_none_without_any_io(tmp_path, monkeypatch):
    src = _source(_rgb_tif(tmp_path / "m.tif"))
    monkeypatch.setattr(tiles, "_open", lambda *a, **k: (_ for _ in ()).throw(AssertionError("I/O")))
    assert tiles.render_site_tile(F39, src, 13, 0, 0, tiles.TileStyle()) is None


def test_one_pixel_read_per_tile(tmp_path, monkeypatch):
    src = _source(_rgb_tif(tmp_path / "m.tif"))
    calls = []
    real = tiles._read_vrt
    monkeypatch.setattr(tiles, "_read_vrt", lambda vrt, s: calls.append(1) or real(vrt, s))
    x, y = grid.tile_of(500001.0, 3299999.0, 13)
    tiles.render_site_tile(F39, src, 13, x, y, tiles.TileStyle())
    assert len(calls) == 1


def test_masked_and_outside_pixels_are_transparent(tmp_path):
    x, y = grid.tile_of(500001.0, 3299999.0, 13)  # the tile starting exactly at E 500000
    src = _source(_rgb_tif(tmp_path / "m.tif", mask_left=64))  # the map's west 8 m masked
    img = rgba(tiles.render_site_tile(F39, src, 13, x, y, tiles.TileStyle()))
    assert (img[:, :62, 3] == 0).all() and (img[:, 66:, 3] == 255).all()
    west = (499990.0, 3300000.0)  # a map starting 22 m east of the west neighbour's edge (E 499968)
    src = _source(_rgb_tif(tmp_path / "n.tif", origin=west), origin=west)
    img = rgba(tiles.render_site_tile(F39, src, 13, x - 1, y, tiles.TileStyle()))
    cut = int((499990.0 - grid.tile_bounds(13, x - 1, y)[0]) / 0.125)  # 176
    assert (img[:, : cut - 2, 3] == 0).all() and (img[:, cut + 2 :, 3] == 255).all()


def test_the_overview_matching_the_tile_is_used(tmp_path, monkeypatch):
    path = _rgb_tif(tmp_path / "m.tif", size=2048)
    with rasterio.open(path, "r+") as ds:
        ds.build_overviews([2, 4, 8])
    opened = []
    real = tiles._open
    monkeypatch.setattr(tiles, "_open", lambda p, **kw: opened.append(kw) or real(p, **kw))
    x, y = grid.tile_of(500001.0, 3299999.0, 11)  # res 0.5 m = 4 native pixels: overview x4 (level 1)
    tiles.render_site_tile(F39, _source(path, size=2048), 11, x, y, tiles.TileStyle())
    assert {"overview_level": 1} in opened


def test_knockout_white_and_rgba_sources(tmp_path):
    data = np.zeros((4, 256, 256), np.uint8)
    data[:3, :, :128] = 250  # white paper on the left half
    data[:3, :, 128:] = 40  # dark ink on the right half
    data[3] = 255
    path = write_plan_tif(tmp_path / "plan.tif", data, crs_wkt=UTM39, transform=PLAN_GT)
    x, y = grid.tile_of(500001.0, 3299999.0, 13)
    for knockout, left_alpha in ((False, 255), (True, 0)):
        src = tiles.SiteTileSource(
            layer_id="D",
            version="1",
            path=path,
            crs_wkt=UTM39,
            bounds_native=(500000.0, 3299968.0, 500032.0, 3300000.0),
            native_res_m=0.125,
            paint=tiles.rgba_paint(knockout),
            bands=(1, 2, 3, 4),
            alpha_band=4,
        )
        img = rgba(tiles.render_site_tile(F39, src, 13, x, y, tiles.TileStyle(knockout=knockout)))
        assert (img[:, 10:120, 3] == left_alpha).all() and (img[:, 136:250, 3] == 255).all()


def test_registry_refuses_unknown_kinds_and_reports_missing_resolvers(handle, drawing_resolver):
    with pytest.raises(ValueError):
        tiles.register_site_tile_source("dsm_diff", lambda h, i, s: None)
    tiles._RESOLVERS.pop("drawing_raster", None)  # the fixture restores M-B3's resolver, if any
    with pytest.raises(AppError) as e:
        tiles.serve_site_tile(handle, F39, "drawing_raster", "x", 0, 0, 0, tiles.TileStyle())
    assert e.value.status == 404


def test_a_source_outside_the_frame_is_422(handle, tmp_path, drawing_resolver):
    src = _source(_rgb_tif(tmp_path / "m.tif"))
    drawing_resolver(lambda h, i, s: src)
    with pytest.raises(AppError) as e:
        tiles.serve_site_tile(handle, LOCAL, "drawing_raster", "D", 13, 0, 0, tiles.TileStyle())
    assert (e.value.status, e.value.code) == (422, "no_coordinates")


def test_parse_preview():
    assert tiles.parse_preview(None) is None
    assert tiles.parse_preview("0.125,0,500000,0,-0.125,3300000") == (
        0.125,
        0.0,
        500000.0,
        0.0,
        -0.125,
        3300000.0,
    )
    for bad in (
        "1,2,3",
        "a,b,c,d,e,f",
        "1,0,0,0,0,0",
        "nan,0,0,0,1,0",
        "1,2,3,2,4,6",
        "1e-300,0,0,0,1e-300,0",  # near-singular: exact a*e == b*d is not the only case to refuse
    ):
        with pytest.raises(AppError) as e:
            tiles.parse_preview(bad)
        assert (e.value.status, e.value.code) == (422, "invalid_preview"), bad


def test_a_preview_on_another_kind_is_422_before_any_resolver(handle, monkeypatch):
    """Contract getSiteTile 422: `t` sent for a kind other than drawing_raster is invalid_preview."""
    monkeypatch.setitem(tiles._RESOLVERS, "map", lambda *a: pytest.fail("resolved"))
    style = tiles.TileStyle(preview=(0.125, 0.0, 500000.0, 0.0, -0.125, 3300000.0))
    for kind in ("map", "surface", "volume_diff"):
        with pytest.raises(AppError) as e:
            tiles.serve_site_tile(handle, F39, kind, "M", 13, 0, 0, style)
        assert (e.value.status, e.value.code) == (422, "invalid_preview"), kind


def test_a_preview_affine_replaces_the_files_geotransform_and_is_never_cached(
    handle, tmp_path, drawing_resolver
):
    """The K tool's live placement: plan.tif keeps its own geotransform; `t` moves it 32 m east."""
    data = np.full((4, 256, 256), 40, np.uint8)
    data[3] = 255  # opaque dark ink
    path = write_plan_tif(tmp_path / "plan.tif", data, crs_wkt=UTM39, transform=PLAN_GT)
    preview = (0.125, 0.0, 500032.0, 0.0, -0.125, 3300000.0)

    def resolve(h, layer_id, style):
        t = style.preview
        return tiles.SiteTileSource(
            layer_id=layer_id,
            version="preview" if t else "1",
            path=path,
            crs_wkt=UTM39,
            bounds_native=(t[2], t[5] - 32.0, t[2] + 32.0, t[5])
            if t
            else (500000.0, 3299968.0, 500032.0, 3300000.0),
            native_res_m=0.125,
            paint=tiles.rgba_paint(False),
            bands=(1, 2, 3, 4),
            alpha_band=4,
            src_transform=Affine(*t) if t else None,
        )

    drawing_resolver(resolve)
    x, y = grid.tile_of(500001.0, 3299999.0, 13)
    style = tiles.TileStyle(preview=preview)
    assert tiles.serve_site_tile(handle, F39, "drawing_raster", "D", 13, x, y, style) is None  # moved away
    moved = tiles.serve_site_tile(handle, F39, "drawing_raster", "D", 13, x + 1, y, style)
    assert (rgba(moved)[..., 3] == 255).all()
    assert not [k for k in tiles.SITE_TILES._items if k[:2] == (handle.id, "D")]  # nothing cached
    assert tiles.is_preview("drawing_raster", style) and not tiles.is_preview("map", style)


def test_local_frame_uses_the_stand_in_crs(tmp_path):
    path = tmp_path / "local.tif"
    with rasterio.open(
        path,
        "w",
        driver="GTiff",
        width=256,
        height=256,
        count=3,
        dtype="uint8",
        transform=Affine(0.125, 0, -16.0, 0, -0.125, 16.0),
    ) as ds:
        ds.write(np.full((3, 256, 256), 90, np.uint8))
    src = tiles.SiteTileSource(
        layer_id="L",
        version="1",
        path=path,
        crs_wkt=None,
        bounds_native=(-16.0, -16.0, 16.0, 16.0),
        native_res_m=0.125,
        paint=tiles.paint_rgb,
    )
    img = rgba(tiles.render_site_tile(LOCAL, src, 13, -1, -1, tiles.TileStyle()))  # E -32..0, N 0..32
    assert (img[130:, 130:, 3] == 255).all() and (img[:120, :, 3] == 0).all()
    assert tiles.render_site_tile(F39, src, 13, -1, -1, tiles.TileStyle()) is None  # not in a CRS frame


def _ctx(res=0.125, halo=1):
    return tiles.TileContext(F39, 13, 0, 0, res, halo)


def test_nice_interval_is_the_nearest_nice_number():
    assert tiles.nice_interval(0.0, 20.0) == 1.0
    assert tiles.nice_interval(598.1, 624.8) == 1.0  # 26.7 / 20 = 1.335 -> 1
    assert tiles.nice_interval(0.0, 7.0) == 0.25  # 0.35 is nearer 0.25 than 0.5 on a log scale
    assert tiles.nice_interval(0.0, 90.0) == 5.0  # 4.5 -> 5
    assert tiles.nice_interval(3.0, 3.0) == 1.0  # a flat surface


def test_contours_are_one_pixel_lines_every_interval():
    cols = np.arange(258, dtype=np.float32)
    z = np.tile(cols * 0.05, (258, 1))[None]  # 1 m every 20 px
    img = tiles.paint_contours(z, np.isfinite(z[0]), _ctx(), interval=1.0)
    assert img.shape == (256, 256, 4)
    on = np.nonzero(img[128, :, 3])[0]
    assert list(on) == [c - 1 for c in range(20, 257, 20)]  # halo column c is output column c - 1
    lit = img[..., 3] > 0
    assert (img[..., 3][lit] == 140).all() and (img[..., :3][lit] == 255).all()
    assert (img[:, :, 3] == img[128, :, 3]).all()  # the same columns on every row


def test_contours_skip_nan():
    z = np.full((1, 258, 258), np.nan, np.float32)
    assert tiles.paint_contours(z, np.zeros((258, 258), bool), _ctx(), interval=1.0) is None


def test_hillshade_paint_equals_the_grid_hillshade_cropped():
    rng = np.random.default_rng(1)
    z = rng.normal(50, 2, (1, 258, 258)).astype(np.float32)
    img = tiles.paint_hillshade(z, np.isfinite(z[0]), _ctx())
    want = hillshade(z[0], 0.125, 0.125, azimuth=tiles.AZIMUTH, altitude=tiles.ALTITUDE)[1:-1, 1:-1]
    assert (img[..., 0] == want).all() and (img[..., 3] == np.where(want > 0, 255, 0)).all()
    tinted = tiles.paint_hillshade(z, np.isfinite(z[0]), _ctx(), tint_range=(45.0, 55.0))
    assert not (tinted[..., 0] == tinted[..., 1]).all()  # coloured, not grey
