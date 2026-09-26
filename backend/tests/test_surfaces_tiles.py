"""Surface tile rendering (spec 2026-09-23-volumes §8)."""

import io

import numpy as np
import pytest
import rasterio
from PIL import Image as PILImage
from pyproj import CRS, Transformer
from rasterio.enums import Resampling
from rasterio.transform import from_origin
from rasterio.windows import Window
from surfaces import EPSG, WKT, X0, Y1, cone, fixture_spec, plane, write_surface

from app.maps.tiles import max_zoom
from app.surfaces import grid
from app.surfaces.grid import MAX_READ, GridSpec, hillshade, open_surface
from app.surfaces.tiles import (
    DIFF_ALPHA,
    DIFF_CUT,
    DIFF_FILL,
    diff_colours,
    render_diff_tile,
    render_hillshade_tile,
    render_ortho_tile,
)


def _rgba(png: bytes) -> np.ndarray:
    return np.asarray(PILImage.open(io.BytesIO(png)).convert("RGBA"))


@pytest.fixture
def cone_surface(tmp_path):
    spec = fixture_spec(0.1)  # 601 x 601 -> max_zoom 2
    write_surface(tmp_path / "s.tif", spec, lambda xs, ys: plane(xs, ys) + cone(xs, ys))
    return tmp_path / "s.tif", spec


def test_full_resolution_tile_equals_hillshade_of_a_direct_read(cone_surface):
    path, spec = cone_surface
    mz = max_zoom(spec.width, spec.height)
    with open_surface(path) as r:
        png = render_hillshade_tile(r, mz, 1, 1)
        direct = r.read(Window(255, 255, 258, 258))
    want = hillshade(direct, spec.cell_size, spec.cell_size)[1:-1, 1:-1]
    got = _rgba(png)
    assert (got[..., 0] == want).all() and (got[..., 3] == 255).all()


def test_edge_tile_is_transparent_past_the_grid_and_off_grid_is_none(cone_surface):
    path, spec = cone_surface
    mz = max_zoom(spec.width, spec.height)
    with open_surface(path) as r:
        png = render_hillshade_tile(r, mz, 2, 2)  # cells 512..600: 89 wide
        assert render_hillshade_tile(r, mz, 5, 5) is None
    got = _rgba(png)
    assert got[0, 100, 3] == 0 and got[10, 10, 3] == 255


def test_tint_follows_the_range_and_keeps_nan_transparent(tmp_path):
    spec = fixture_spec(0.25)

    def fn(xs, ys):
        z = plane(xs, ys)
        z[:20, :20] = np.nan
        return z

    write_surface(tmp_path / "s.tif", spec, fn)
    with open_surface(tmp_path / "s.tif") as r:
        plain = _rgba(render_hillshade_tile(r, 0, 0, 0))
        tinted = _rgba(render_hillshade_tile(r, 0, 0, 0, tint_range=(49.0, 52.0)))
    assert (plain[5, 5] == 0).all() and tinted[5, 5, 3] == 0
    assert not np.array_equal(plain[100, 100, :3], tinted[100, 100, :3])
    assert plain[100, 100, 0] == plain[100, 100, 1] == plain[100, 100, 2]


def test_overview_tile_stays_within_max_read(tmp_path, monkeypatch):
    spec = GridSpec(WKT, EPSG, 0.1, 500000.0, 3300000.0, 3000, 2600)
    write_surface(tmp_path / "s.tif", spec, lambda xs, ys: np.sin(xs) + ys * 0)
    seen = []
    real = grid._raw_read
    monkeypatch.setattr(grid, "_raw_read", lambda ds, w, o, rs: seen.append(o) or real(ds, w, o, rs))
    with open_surface(tmp_path / "s.tif") as r:
        assert render_hillshade_tile(r, 0, 0, 0) is not None
    assert seen and all(max(s) <= 258 for s in seen) and MAX_READ >= 258


def _map(path, crs, transform, size=400):
    left = np.zeros((3, size, size), np.uint8)
    left[0, :, : size // 2] = 220  # red west half
    left[2, :, size // 2 :] = 220  # blue east half
    with rasterio.open(
        path,
        "w",
        driver="GTiff",
        width=size,
        height=size,
        count=3,
        dtype="uint8",
        crs=crs,
        transform=transform,
        tiled=True,
        blockxsize=256,
        blockysize=256,
    ) as ds:
        ds.write(left)
        ds.write_mask(np.full((size, size), 255, np.uint8))
        ds.build_overviews([2, 4], Resampling.average)
    return path


def test_ortho_tile_is_the_map_warped_into_the_surface_grid(tmp_path, cone_surface):
    _, spec = cone_surface
    to_ll = Transformer.from_crs(EPSG, 4326, always_xy=True)
    lon0, lat1 = to_ll.transform(X0 - 5, Y1 + 5)
    lon1, lat0 = to_ll.transform(X0 + 65, Y1 - 65)
    px = (lon1 - lon0) / 400
    map_path = _map(
        tmp_path / "map.tif", CRS.from_epsg(4326).to_wkt(), from_origin(lon0, lat1, px, (lat1 - lat0) / 400)
    )
    split_lon = lon0 + 200 * px
    split_x, _ = Transformer.from_crs(4326, EPSG, always_xy=True).transform(split_lon, (lat0 + lat1) / 2)
    body, media = render_ortho_tile(map_path, spec, 0.175, 0, 0, 0)
    got = _rgba(body)
    res = 2 ** max_zoom(spec.width, spec.height)
    col_west = int((split_x - 3 - spec.x0) / (spec.cell_size * res))
    col_east = int((split_x + 3 - spec.x0) / (spec.cell_size * res))
    assert got[60, col_west, 0] > 150 and got[60, col_west, 2] < 60
    assert got[60, col_east, 2] > 150 and got[60, col_east, 0] < 60
    assert media == "image/png"  # the grid does not fill the 256 px tile at zoom 0


def test_ortho_tile_outside_the_map_is_none_and_needs_a_crs(tmp_path, cone_surface):
    _, spec = cone_surface
    far = _map(tmp_path / "far.tif", WKT, from_origin(600000.0, 3400000.0, 0.1, 0.1))
    assert render_ortho_tile(far, spec, 0.1, 0, 0, 0) is None
    local = GridSpec(None, None, spec.cell_size, spec.x0, spec.y0, spec.width, spec.height)
    with pytest.raises(ValueError):
        render_ortho_tile(far, local, 0.1, 0, 0, 0)


def test_diff_colours_are_signed_symmetric_and_transparent_on_nan():
    rgba = diff_colours(np.array([[1.0, -1.0, 0.01, np.nan, 0.5]]), 1.0)
    assert tuple(rgba[0, 0, :3]) == tuple(DIFF_FILL.astype(np.uint8))
    assert tuple(rgba[0, 1, :3]) == tuple(DIFF_CUT.astype(np.uint8))
    assert rgba[0, 0, 3] == DIFF_ALPHA and rgba[0, 2, 3] < DIFF_ALPHA and rgba[0, 3, 3] == 0


def test_diff_tile_reads_the_crop_in_the_top_grid(tmp_path, cone_surface):
    _, top = cone_surface
    crop = top.crop(Window(512, 0, 89, 512))
    write_surface(tmp_path / "d.tif", crop, lambda xs, ys: np.where(xs > X0 + 55, 2.0, -2.0))
    mz = max_zoom(top.width, top.height)
    with open_surface(tmp_path / "d.tif") as d:
        png = render_diff_tile(d, top, 1.0, mz, 2, 0)
        assert render_diff_tile(d, top, 1.0, mz, 0, 0) is None  # the diff does not reach tile (0, 0)
        direct = d.read(Window(0, 0, 89, 256))
    got = _rgba(png)
    assert np.array_equal(got[:, :89, :], diff_colours(direct.astype(np.float64), 1.0))
    assert (got[:, 89:, 3] == 0).all()
