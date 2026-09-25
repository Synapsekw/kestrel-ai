"""The surface grid convention (spec 2026-09-23-volumes §4, tests in §13)."""

import math
import shutil
import warnings

import numpy as np
import pytest
import rasterio
from pyproj import CRS, Transformer
from rasterio.enums import Resampling
from rasterio.transform import from_origin
from rasterio.windows import Window
from surfaces import EPSG, WKT, X0, Y1, fixture_spec, plane, write_surface

from app.surfaces import grid
from app.surfaces.grid import (
    BLOCK,
    MAX_READ,
    GridError,
    GridSpec,
    SurfaceWriter,
    aligned_grid,
    block_windows,
    compute_stats,
    convention_problems,
    hillshade,
    open_surface,
    read_windows,
    resample_onto,
    same_lattice,
)


def test_aligned_grid_snaps_to_the_lattice_and_keeps_edge_points():
    spec = aligned_grid((12.3, 4.05, 20.0, 9.0), 0.1, WKT, EPSG)
    assert (spec.x0, spec.y0) == (pytest.approx(12.3), pytest.approx(9.0))
    assert spec.x0 / 0.1 == pytest.approx(round(spec.x0 / 0.1), abs=1e-9)
    # a point on maxx and one on miny land inside
    assert spec.x0 + spec.width * 0.1 > 20.0 and spec.y0 - spec.height * 0.1 < 4.05
    assert (spec.width, spec.height) == (78, 50)
    off = aligned_grid((12.34, 4.0, 13.0, 5.0), 0.25, WKT, EPSG)
    assert off.x0 == pytest.approx(12.25) and off.y0 == pytest.approx(5.0)


@pytest.mark.parametrize(
    ("crs", "cell", "message"),
    [
        (CRS.from_epsg(4326).to_wkt(), 0.1, "geographic"),
        (CRS.from_epsg(2278).to_wkt(), 0.1, "not in metres"),
        (WKT, 0.0, "positive"),
    ],
)
def test_aligned_grid_refuses(crs, cell, message):
    with pytest.raises(GridError, match=message):
        aligned_grid((0, 0, 10, 10), cell, crs, None)


def test_aligned_grid_refuses_too_many_cells():
    with pytest.raises(GridError, match="more than"):
        aligned_grid((0, 0, 1000, 1000), 0.1, None, None, max_cells=1000)


def test_same_lattice_true_and_near_miss():
    a = aligned_grid((500000.0, 3299000.0, 500100.0, 3299100.0), 0.1, WKT, EPSG)
    b = aligned_grid((500012.3, 3299001.0, 500050.0, 3299050.0), 0.1, WKT, EPSG)
    assert same_lattice(a, b)
    shifted = GridSpec(b.crs_wkt, b.epsg, b.cell_size, b.x0 + 0.0001, b.y0, b.width, b.height)
    assert not same_lattice(a, shifted)
    assert not same_lattice(a, GridSpec(None, None, a.cell_size, a.x0, a.y0, a.width, a.height))
    assert not same_lattice(a, aligned_grid((500000.0, 3299000.0, 500100.0, 3299100.0), 0.2, WKT, EPSG))


def test_window_for_bounds_and_crop():
    spec = GridSpec(WKT, EPSG, 0.5, 1000.0, 2000.0, 100, 80)
    w = spec.window_for_bounds((1010.2, 1990.1, 1012.0, 1995.0))
    assert (w.col_off, w.row_off, w.width, w.height) == (20, 10, 4, 10)
    padded = spec.window_for_bounds((1010.2, 1990.1, 1012.0, 1995.0), pad=2)
    assert (padded.col_off, padded.row_off, padded.width, padded.height) == (18, 8, 8, 14)
    assert spec.window_for_bounds((0, 0, 1, 1)).width == 0
    sub = spec.crop(w)
    assert same_lattice(spec, sub) and (sub.x0, sub.y0) == (1010.0, 1995.0)
    xs, ys = spec.cell_centres(w)
    assert xs[0, 0] == 1010.25 and ys[0, 0] == 1994.75 and xs.shape == (10, 4)
    assert GridSpec.from_json(spec.to_json()) == spec


def test_block_and_read_windows_cover_the_grid_once():
    spec = GridSpec(None, None, 1.0, 0.0, 0.0, 1300, 700)
    blocks = list(block_windows(spec))
    assert len(blocks) == 3 * 2 and blocks[-1].width == 1300 - 1024 and blocks[-1].height == 700 - 512
    reads = list(read_windows(spec, max_side=1024))
    assert sum(int(w.width) * int(w.height) for w in reads) == 1300 * 700
    within = list(block_windows(spec, Window(600, 100, 10, 10)))
    assert [(int(w.col_off), int(w.row_off)) for w in within] == [(512, 0)]
    with pytest.raises(GridError):
        list(read_windows(spec, max_side=1000))


def test_writer_rejects_misaligned_blocks_and_removes_the_partial(tmp_path):
    spec = GridSpec(WKT, EPSG, 0.1, 500000.0, 3300000.0, 700, 600)
    path = tmp_path / "s.tif"
    with pytest.raises(GridError, match="aligned"):
        with SurfaceWriter(path, spec) as w:
            w.write_block(Window(10, 0, 512, 512), np.zeros((512, 512)))
    assert not path.exists() and not (tmp_path / "s.tif.partial").exists()
    with pytest.raises(RuntimeError):
        with SurfaceWriter(path, spec) as w:
            w.write_block(Window(0, 0, 512, 512), np.zeros((512, 512)))
            raise RuntimeError("boom")
    assert not path.exists() and not (tmp_path / "s.tif.partial").exists()


def test_unwritten_blocks_read_back_as_nan_and_inf_becomes_nan(tmp_path):
    spec = GridSpec(WKT, EPSG, 0.1, 500000.0, 3300000.0, 1100, 600)
    data = np.ones((512, 512), np.float32)
    data[0, 0] = np.inf
    with SurfaceWriter(tmp_path / "s.tif", spec) as w:
        w.write_block(Window(0, 0, 512, 512), data)
        stats = w.finish()
    assert stats.valid_cells == 512 * 512 - 1
    with open_surface(tmp_path / "s.tif") as r:
        assert np.isnan(r.read(Window(600, 0, 500, 512))).all()
        assert np.isnan(r.read(Window(0, 0, 1, 1))[0, 0])
        assert same_lattice(r.spec, spec) and (r.spec.width, r.spec.height) == (1100, 600)


def test_overview_of_a_block_with_nans_is_the_nanmean(tmp_path):
    spec = GridSpec(WKT, EPSG, 0.1, 500000.0, 3300000.0, 512, 512)
    rng = np.random.default_rng(1)
    a = (rng.random((512, 512)) * 10).astype(np.float32)
    a[rng.random((512, 512)) < 0.3] = np.nan
    a[0:2, 0:2] = np.nan
    with SurfaceWriter(tmp_path / "s.tif", spec) as w:
        w.write_block(Window(0, 0, 512, 512), a)
        w.finish()
    with rasterio.open(tmp_path / "s.tif", overview_level=0) as ov:
        got = ov.read(1)
    with warnings.catch_warnings():
        warnings.simplefilter("ignore", RuntimeWarning)
        want = np.nanmean(a.reshape(256, 2, 256, 2), axis=(1, 3))
    assert np.array_equal(np.isnan(got), np.isnan(want))
    assert np.nanmax(np.abs(got - want)) < 1e-5


def test_read_past_max_read_raises_and_the_spy_sees_every_read(tmp_path, monkeypatch):
    spec = GridSpec(WKT, EPSG, 0.1, 500000.0, 3300000.0, 2600, 600)
    write_surface(tmp_path / "s.tif", spec, lambda xs, ys: xs * 0)
    seen = []
    real = grid._raw_read

    def spy(ds, window, out_shape, resampling):
        seen.append(out_shape)
        return real(ds, window, out_shape, resampling)

    monkeypatch.setattr(grid, "_raw_read", spy)
    with open_surface(tmp_path / "s.tif") as r:
        with pytest.raises(GridError, match="exceeds"):
            r.read(Window(0, 0, 2600, 600))
        r.read(Window(0, 0, 2600, 600), out_shape=(300, 1300))
        r.read(Window(-5, -5, 20, 20), boundless=True)
        with pytest.raises(GridError, match="boundless"):
            r.read(Window(-5, -5, 20, 20))
    assert seen and all(max(s) <= MAX_READ for s in seen)


def test_boundless_read_pads_with_nan(tmp_path):
    spec = GridSpec(WKT, EPSG, 1.0, 0.0, 100.0, 10, 10)
    write_surface(tmp_path / "s.tif", spec, lambda xs, ys: xs + 0 * ys)
    with open_surface(tmp_path / "s.tif") as r:
        got = r.read(Window(-2, -1, 5, 3), boundless=True)
    assert np.isnan(got[:, :2]).all() and np.isnan(got[0]).all()
    assert got[1:, 2:].tolist() == [[0.5, 1.5, 2.5], [0.5, 1.5, 2.5]]


def test_sample_bilinear_is_exact_on_a_plane_and_strict_about_nan(tmp_path):
    spec = fixture_spec(0.25)
    write_surface(tmp_path / "s.tif", spec, plane)
    rng = np.random.default_rng(3)
    xs = X0 + 1 + rng.random(500) * 58
    ys = Y1 - 1 - rng.random(500) * 58
    with open_surface(tmp_path / "s.tif") as r:
        got = r.sample_bilinear(xs, ys)
        assert np.abs(got - plane(xs, ys)).max() < 1e-4
        assert np.isnan(r.sample_bilinear(np.array([X0 - 5]), np.array([Y1 - 5])))[0]
        cx, cy = spec.cell_centres(Window(spec.width - 1, 3, 1, 1))
        assert r.sample_bilinear(cx, cy)[0, 0] == pytest.approx(plane(cx, cy)[0, 0], abs=1e-4)

    def holed(xs, ys):
        z = plane(xs, ys)
        z[10, 10] = np.nan
        return z

    write_surface(tmp_path / "h.tif", fixture_spec(0.25), holed)
    with open_surface(tmp_path / "h.tif") as r:
        cx, cy = spec.cell_centres(Window(10, 10, 1, 1))
        near = r.sample_bilinear(cx + 0.1, cy - 0.1)
        far = r.sample_bilinear(cx + 1.0, cy - 1.0)
    assert np.isnan(near[0, 0]) and np.isfinite(far[0, 0])


def test_sample_bilinear_splits_reads(tmp_path, monkeypatch):
    spec = GridSpec(WKT, EPSG, 0.1, 500000.0, 3300000.0, 5000, 20)
    write_surface(tmp_path / "s.tif", spec, lambda xs, ys: xs - 500000.0)
    seen = []
    real = grid._raw_read
    monkeypatch.setattr(grid, "_raw_read", lambda ds, w, o, r: seen.append(o) or real(ds, w, o, r))
    with open_surface(tmp_path / "s.tif") as r:
        got = r.sample_bilinear(np.array([500000.05, 500499.95]), np.array([3299999.5, 3299999.5]))
    assert got == pytest.approx([0.05, 499.95], abs=1e-3)
    assert len(seen) == 2 and all(max(s) <= MAX_READ for s in seen)


def test_resample_onto_same_lattice_is_bit_identical(tmp_path):
    spec = fixture_spec(0.1)
    write_surface(tmp_path / "s.tif", spec, lambda xs, ys: plane(xs, ys) + np.sin(xs))
    dst = spec.crop(Window(100, 50, 300, 200))
    with open_surface(tmp_path / "s.tif") as r:
        direct = r.read(Window(100, 50, 300, 200))
        got = resample_onto(r, dst, Window(0, 0, 300, 200))
    assert np.array_equal(got, direct)


def test_resample_onto_another_lattice_and_a_finer_base(tmp_path):
    top = fixture_spec(0.25)
    base = aligned_grid((X0 - 2, Y1 - 62, X0 + 62, Y1 + 2), 0.1, WKT, EPSG)
    base = GridSpec(base.crs_wkt, base.epsg, 0.1, base.x0 + 0.037, base.y0 - 0.021, base.width, base.height)
    write_surface(tmp_path / "b.tif", base, plane)
    with open_surface(tmp_path / "b.tif") as r:
        win = Window(4, 4, top.width - 8, top.height - 8)
        got = resample_onto(r, top, win)
    xs, ys = top.cell_centres(win)
    assert np.nanmax(np.abs(got - plane(xs, ys))) < 1e-4 and np.isfinite(got).all()


def test_resample_onto_another_crs(tmp_path):
    top = fixture_spec(0.25)
    to_3857 = Transformer.from_crs(EPSG, 3857, always_xy=True)
    back = Transformer.from_crs(3857, EPSG, always_xy=True)
    x0, y0 = to_3857.transform(X0 - 3, Y1 + 3)
    x1, y1 = to_3857.transform(X0 + 63, Y1 - 63)
    base = aligned_grid(
        (min(x0, x1), min(y0, y1), max(x0, x1), max(y0, y1)), 0.2, CRS.from_epsg(3857).to_wkt(), 3857
    )

    def plane_in_3857(xs, ys):
        ux, uy = back.transform(xs, ys)
        return plane(np.asarray(ux), np.asarray(uy))

    write_surface(tmp_path / "b.tif", base, plane_in_3857)
    with open_surface(tmp_path / "b.tif") as r:
        win = Window(0, 0, top.width, top.height)
        got = resample_onto(r, top, win)
    xs, ys = top.cell_centres(win)
    assert np.nanmax(np.abs(got - plane(xs, ys))) < 1e-3


def test_convention_problems_accepts_writer_output(tmp_path):
    spec = fixture_spec(0.05)
    write_surface(tmp_path / "s.tif", spec, plane)
    assert convention_problems(tmp_path / "s.tif") == []


@pytest.mark.parametrize(
    ("over", "needle"),
    [
        ({"dtype": "int16", "nodata": -9999, "predictor": 2}, "int16"),
        ({"nodata": -9999.0}, "nodata is -9999.0"),
        ({"mask": True}, "internal mask"),
        ({"tiled": False, "blockxsize": None, "blockysize": None}, "not tiled"),
        ({"compress": "lzw"}, "not DEFLATE"),
        ({"transform": from_origin(500000.03, 3300000.0, 0.1, 0.1)}, "not a multiple"),
        ({"crs": CRS.from_epsg(4326).to_wkt(), "transform": from_origin(50.0, 30.0, 0.1, 0.1)}, "geographic"),
    ],
)
def test_convention_problems_names_each_breach(tmp_path, over, needle):
    over = {k: v for k, v in over.items() if v is not None}
    if "tiled" in over:
        over.pop("blockxsize", None)
        over.pop("blockysize", None)
    path = tmp_path / "x.tif"
    base = dict(
        driver="GTiff",
        width=600,
        height=300,
        count=1,
        dtype="float32",
        nodata=float("nan"),
        tiled=True,
        blockxsize=512,
        blockysize=512,
        compress="deflate",
        predictor=3,
        crs=WKT,
        transform=from_origin(500000.0, 3300000.0, 0.1, 0.1),
    )
    if not over.get("tiled", True):
        base.pop("blockxsize")
        base.pop("blockysize")
    base.update(over)
    mask = base.pop("mask", False)
    with rasterio.open(path, "w", **base) as ds:
        ds.write(np.ones((300, 600), base["dtype"]), 1)
        if mask:
            ds.write_mask(np.full((300, 600), 255, np.uint8))
        ds.build_overviews([2], Resampling.average)
    problems = convention_problems(path)
    assert any(needle in p for p in problems), problems


def test_convention_problems_missing_overviews(tmp_path):
    path = tmp_path / "x.tif"
    with rasterio.open(
        path,
        "w",
        driver="GTiff",
        width=600,
        height=300,
        count=1,
        dtype="float32",
        nodata=float("nan"),
        tiled=True,
        blockxsize=512,
        blockysize=512,
        compress="deflate",
        predictor=3,
        crs=WKT,
        transform=from_origin(500000.0, 3300000.0, 0.1, 0.1),
    ) as ds:
        ds.write(np.ones((300, 600), "float32"), 1)
    assert convention_problems(path) == ["internal overviews are missing"]


def test_compute_stats_matches_the_writer(tmp_path, monkeypatch):
    spec = GridSpec(WKT, EPSG, 0.1, 500000.0, 3300000.0, 2700, 900)

    def fn(xs, ys):
        z = np.sin(xs) * 10 + ys * 0
        z[::7, ::3] = np.nan
        return z

    written = write_surface(tmp_path / "s.tif", spec, fn)
    shutil.copy(tmp_path / "s.tif", tmp_path / "copy.tif")
    seen = []
    real = grid._raw_read
    monkeypatch.setattr(grid, "_raw_read", lambda ds, w, o, r: seen.append(o) or real(ds, w, o, r))
    assert compute_stats(tmp_path / "copy.tif") == written
    assert written.z_p02 is not None and written.z_p02 < written.z_p98
    assert all(max(s) <= MAX_READ for s in seen)


def test_hillshade_of_a_plane_matches_the_closed_form():
    cell = 0.5
    p, q = 0.4, -0.25  # z = p * east + q * north
    rows, cols = np.mgrid[0:20, 0:20]
    z = p * (cols + 0.5) * cell + q * -((rows + 0.5) * cell)
    shade = hillshade(z, cell, cell)
    n = np.array([-p, -q, 1.0]) / math.sqrt(p * p + q * q + 1)
    az, alt = math.radians(315), math.radians(45)
    sun = np.array([math.sin(az) * math.cos(alt), math.cos(az) * math.cos(alt), math.sin(alt)])
    want = 1 + 254 * max(0.0, float(n @ sun))
    assert shade.dtype == np.uint8
    assert np.abs(shade[1:-1, 1:-1].astype(int) - want).max() <= 1
    flat = hillshade(np.zeros((5, 5)), 1.0, 1.0)
    assert (flat == round(1 + 254 * math.cos(math.radians(45)))).all()


def test_hillshade_zeroes_nan_and_its_neighbours():
    z = np.arange(100, dtype=float).reshape(10, 10)
    z[5, 5] = np.nan
    shade = hillshade(z, 1.0, 1.0)
    assert (shade[4:7, 4:7] == 0).all()
    assert (shade[0:3, 0:3] > 0).all()


def test_block_constant_is_the_tile():
    assert BLOCK == 512 and MAX_READ == 2048
