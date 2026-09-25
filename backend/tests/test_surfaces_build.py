"""The surface build pipeline (spec 2026-09-23-volumes §5, tests in §13)."""

import math
import tracemalloc

import laspy
import numpy as np
import pytest
from pyproj import CRS, Transformer
from rasterio.windows import Window
from surfaces import EPSG, WKT, X0, Y1, cone_cloud, plane, write_cloud

from app.surfaces import build
from app.surfaces.build import (
    BuildParams,
    BuildRejected,
    CloudSource,
    build_surface,
    despike_and_fill,
    fill_rings,
    reduce_cells,
)
from app.surfaces.grid import convention_problems, open_surface


def _source(path, xyz, crs_wkt=WKT) -> CloudSource:
    mins, maxs = xyz.min(axis=0), xyz.max(axis=0)
    return CloudSource(path, len(xyz), crs_wkt, (mins[0], mins[1], mins[2], maxs[0], maxs[1], maxs[2]))


DEFAULTS = BuildParams()


def _build(tmp_path, xyz, params=DEFAULTS, crs_wkt=WKT, name="s", **cloud):
    path = write_cloud(tmp_path / f"{name}.las", xyz, **cloud)
    src = _source(path, xyz, crs_wkt)
    out = tmp_path / name / "surface.tif"
    seen: list[tuple[float, str]] = []
    result = build_surface(
        src,
        params,
        out,
        tmp_path / name / ".build",
        progress=lambda f, m: seen.append((f, m)),
        check_cancelled=lambda: None,
    )
    return result, out, seen


def _lattice(density: float, size: float = 60.0) -> np.ndarray:
    """A regular lattice at `density` points per m², offset half a spacing from the bbox corners,
    with two anchor points on the corners so no point lies on a count-grid edge."""
    s = 1.0 / math.sqrt(density)
    n = int(round(size / s))
    g = (np.arange(n) + 0.5) * s
    xs, ys = np.meshgrid(X0 + g, Y1 - g)
    pts = np.column_stack([xs.ravel(), ys.ravel(), plane(xs.ravel(), ys.ravel())])
    anchors = np.array([[X0, Y1 - size, 50.0], [X0 + size, Y1, 50.0]])
    return np.vstack([pts, anchors])


@pytest.mark.parametrize(
    ("cells", "method", "want"),
    [
        ([0, 0, 0], "median", 2.0),
        ([0, 0, 0, 0], "median", 2.5),
        ([0, 0, 0, 0], "mean", 2.75),
        ([0, 0, 0, 0], "max", 5.0),
        ([0, 0, 0, 0], "min", 1.0),
    ],
)
def test_statistics_of_hand_made_cells(cells, method, want):
    z = np.array([3.0, 1.0, 2.0, 5.0][: len(cells)], np.float32)
    ucells, values, counts = reduce_cells(np.array(cells, np.uint32), z, method)
    assert ucells.tolist() == [0] and counts.tolist() == [len(cells)]
    assert values[0] == pytest.approx(want)


@pytest.mark.parametrize(("density", "cell"), [(25, 0.5), (100, 0.2), (400, 0.1)])
def test_auto_cell_for_known_densities(tmp_path, density, cell):
    result, out, _ = _build(tmp_path, _lattice(density), name=f"d{density}")
    assert result.cell_size_m == cell and result.auto_cell
    assert result.build_stats["density_per_m2"] == pytest.approx(density, rel=0.02)
    assert result.build_stats["spacing_m"] == pytest.approx(1 / math.sqrt(density), rel=0.01)
    assert convention_problems(out) == []


def test_noise_classes_withheld_and_z_clip_are_counted(tmp_path):
    xyz = _lattice(25)
    n = len(xyz)
    cls = np.full(n, 2)
    cls[:10], cls[10:15] = 7, 18
    withheld = np.zeros(n, bool)
    withheld[20:23] = True
    xyz[30:34, 2] = 500.0
    params = BuildParams(cell_size_m=0.5, z_clip=(0.0, 100.0))
    result, _, _ = _build(tmp_path, xyz, params, classification=cls, withheld=withheld)
    dropped = result.build_stats["points_dropped"]
    assert dropped == {"noise_class": 15, "withheld": 3, "z_clip": 4}
    assert result.build_stats["points_used"] == n - 22 and result.build_stats["points_read"] == n


def test_every_point_filtered_is_a_readable_failure(tmp_path):
    xyz = _lattice(25)
    with pytest.raises(BuildRejected, match="no points are left"):
        _build(tmp_path, xyz, BuildParams(cell_size_m=0.5), classification=np.full(len(xyz), 7))
    with pytest.raises(BuildRejected, match="no points are left"):
        _build(tmp_path, xyz, BuildParams(), name="auto", classification=np.full(len(xyz), 18))


def test_isolated_low_point_is_despiked_and_a_real_step_is_kept():
    z = np.full((9, 9), 10.0)
    counts = np.full((9, 9), 6.0)
    z[4, 4], counts[4, 4] = -50.0, 1.0  # one wild point alone in a sparse cell
    z[:, 6:] = 13.0  # a 3 m step backed by many points
    out, despiked, _ = despike_and_fill(z, counts, despike_m=1.0, rings=0)
    assert despiked[4, 4] and np.isnan(out[4, 4])
    assert despiked.sum() == 1 and (out[:, 6:] == 13.0).all()


def test_hole_fill_closes_small_gaps_and_never_grows_the_edge():
    z = np.full((30, 30), np.nan)
    z[5:25, 5:25] = 7.0
    z[10:12, 10:12] = np.nan  # a 2 x 2 hole (0.4 m at 0.2 m cells)
    z[14:22, 14:22] = np.nan  # an 8 x 8 hole, wider than 2 rings can close
    out, _, filled = despike_and_fill(z, np.full(z.shape, 4.0), despike_m=None, rings=2)
    assert (out[10:12, 10:12] == 7.0).all()
    assert np.isnan(out[16:20, 16:20]).all()
    assert np.isnan(out[:5]).all() and np.isnan(out[25:]).all()
    assert np.isnan(out[:, :5]).all() and np.isnan(out[:, 25:]).all()
    assert filled[10:12, 10:12].all()


def test_fill_rings():
    assert fill_rings(0.2, 1.0) == 3 and fill_rings(0.02, 1.0) == 8 and fill_rings(0.2, 0.0) == 0


def test_blockwise_finish_equals_the_whole_array(tmp_path):
    """Pass 3 runs block by block with a halo; the result must equal despike + fill on the whole
    array at once, including around a hole that straddles a block seam."""
    rng = np.random.default_rng(5)
    x = X0 + rng.random(120_000) * 130
    y = Y1 - rng.random(120_000) * 130
    keep = ~((np.abs(x - (X0 + 102.4)) < 0.6) & (np.abs(y - (Y1 - 50)) < 0.6))
    xyz = np.column_stack([x[keep], y[keep], plane(x[keep], y[keep]) + rng.normal(0, 0.02, keep.sum())])
    result, out, _ = _build(tmp_path, xyz, BuildParams(cell_size_m=0.2))
    spec = result.spec
    assert spec.width > 512  # the grid really has block seams
    with open_surface(out) as r:
        got = r.read(Window(0, 0, spec.width, spec.height))
    las = laspy.read(tmp_path / "s.las")  # the stored (quantised) coordinates, as the build read them
    xs, ys, zs = np.asarray(las.x), np.asarray(las.y), np.asarray(las.z)
    col = np.floor((xs - spec.x0) / spec.cell_size).astype(np.int64)
    row = np.floor((spec.y0 - ys) / spec.cell_size).astype(np.int64)
    cells, values, counts = reduce_cells(
        (row * spec.width + col).astype(np.uint32), zs.astype(np.float32), "median"
    )
    z = np.full(spec.width * spec.height, np.nan)
    n = np.zeros(spec.width * spec.height)
    z[cells], n[cells] = values.astype(np.float32), counts
    want, _, _ = despike_and_fill(
        z.reshape(spec.height, spec.width),
        n.reshape(spec.height, spec.width),
        despike_m=1.0,
        rings=fill_rings(0.2, 1.0),
    )
    assert np.array_equal(np.isnan(got), np.isnan(want))
    assert np.nanmax(np.abs(got - want)) < 1e-4


def test_geographic_cloud_is_reprojected_to_utm(tmp_path):
    to_ll = Transformer.from_crs(EPSG, 4326, always_xy=True)
    xyz = _lattice(25, size=30.0)
    lon, lat = to_ll.transform(xyz[:, 0], xyz[:, 1])
    ll = np.column_stack([lon, lat, xyz[:, 2]])
    params = BuildParams(cell_size_m=0.5)
    result, out, _ = _build(tmp_path, ll, params, crs_wkt=CRS.from_epsg(4326).to_wkt(), scale=1e-7)
    assert result.spec.epsg == 32639 and result.build_stats["reprojected_from_epsg"] == 4326
    with open_surface(out) as r:
        z = r.sample_bilinear(np.array([X0 + 15]), np.array([Y1 - 15]))
    assert z[0] == pytest.approx(plane(np.array([X0 + 15]), np.array([Y1 - 15]))[0], abs=0.02)


def test_feet_and_missing_crs_are_refused(tmp_path):
    xyz = _lattice(25, size=10.0)
    with pytest.raises(BuildRejected, match="feet-based"):
        _build(tmp_path, xyz, BuildParams(cell_size_m=0.5), crs_wkt=CRS.from_epsg(2278).to_wkt())
    with pytest.raises(BuildRejected, match="Assume metres"):
        _build(tmp_path, xyz, BuildParams(cell_size_m=0.5), crs_wkt=None, name="n1")
    result, _, _ = _build(
        tmp_path, xyz, BuildParams(cell_size_m=0.5, assume_metres=True), crs_wkt=None, name="n2"
    )
    assert result.spec.crs_wkt is None


def test_malformed_crs_is_a_readable_rejection_not_a_raw_pyproj_error(tmp_path):
    xyz = _lattice(25, size=10.0)
    with pytest.raises(BuildRejected, match="could not be read") as e:
        _build(tmp_path, xyz, BuildParams(cell_size_m=0.5), crs_wkt="not a valid crs at all")
    assert e.value.code == "unsupported_crs"
    assert "feet" not in e.value.message


def test_geocentric_crs_gets_its_own_message_not_the_feet_message(tmp_path):
    xyz = _lattice(25, size=10.0)
    with pytest.raises(BuildRejected, match="not a projected system") as e:
        _build(tmp_path, xyz, BuildParams(cell_size_m=0.5), crs_wkt=CRS.from_epsg(4978).to_wkt())
    assert e.value.code == "unsupported_crs"
    assert "feet" not in e.value.message


def test_too_many_cells_names_the_smallest_cell_that_fits(tmp_path, monkeypatch):
    monkeypatch.setattr(build, "MAX_CELLS", 10_000)
    xyz = _lattice(25, size=60.0)
    with pytest.raises(BuildRejected, match="smallest cell size that fits is 0.61 m") as e:
        _build(tmp_path, xyz, BuildParams(cell_size_m=0.1))
    assert e.value.code == "grid_too_large"


def test_progress_messages_and_monotonic_fractions(tmp_path):
    _, _, seen = _build(tmp_path, _lattice(25))
    messages = [m for _, m in seen]
    assert any(m.startswith("measuring point density") for m in messages)
    assert any(m.startswith("reading points") for m in messages)
    assert any(m.startswith("gridding block") for m in messages)
    assert any(m.startswith("filling gaps") for m in messages)
    assert messages[-1] == "building zoom levels"
    fractions = [f for f, _ in seen]
    assert fractions == sorted(fractions) and fractions[-1] <= 1.0


def test_cancel_raises_from_inside(tmp_path):
    class Stop(Exception):
        pass

    def cancel():
        raise Stop()

    xyz = _lattice(25, size=10.0)
    path = write_cloud(tmp_path / "c.las", xyz)
    with pytest.raises(Stop):
        build_surface(
            _source(path, xyz),
            BuildParams(),
            tmp_path / "o.tif",
            tmp_path / ".b",
            progress=lambda f, m: None,
            check_cancelled=cancel,
        )
    assert not (tmp_path / "o.tif").exists()


def test_row_band_reduce_equals_the_direct_reduce(tmp_path, monkeypatch):
    xyz = cone_cloud(100, 0.03, 0.001, size=40.0)
    direct, out1, _ = _build(tmp_path, xyz, BuildParams(cell_size_m=0.1), name="direct")
    monkeypatch.setattr(build, "REDUCE_MAX_POINTS", 10_000)
    monkeypatch.setattr(build, "BIN_BUFFER_BYTES", 2**20)
    banded, out2, _ = _build(tmp_path, xyz, BuildParams(cell_size_m=0.1), name="banded")
    with open_surface(out1) as a, open_surface(out2) as b:
        w = Window(0, 0, a.spec.width, a.spec.height)
        assert np.array_equal(a.read(w), b.read(w), equal_nan=True)


def test_stale_bin_file_from_a_crashed_build_does_not_change_the_result(tmp_path):
    """A previous build in the same `.build` folder that crashed after appending to a spill file
    must not have its leftover records merge into a fresh build's grid."""
    xyz = _lattice(25, size=20.0)
    path = write_cloud(tmp_path / "s.las", xyz)
    src = _source(path, xyz)
    work = tmp_path / "s" / ".build"
    (work / "bins").mkdir(parents=True)
    (work / "bins" / "0_0.bin").write_bytes(b"\xff" * 800)  # a crashed earlier build's leftovers
    result = build_surface(
        src,
        BuildParams(cell_size_m=0.5),
        tmp_path / "s" / "surface.tif",
        work,
        progress=lambda f, m: None,
        check_cancelled=lambda: None,
    )
    clean, _, _ = _build(tmp_path, xyz, BuildParams(cell_size_m=0.5), name="clean")
    assert result.build_stats["points_used"] == clean.build_stats["points_used"]
    with (
        open_surface(tmp_path / "s" / "surface.tif") as a,
        open_surface(tmp_path / "clean" / "surface.tif") as b,
    ):
        w = Window(0, 0, a.spec.width, a.spec.height)
        assert np.array_equal(a.read(w), b.read(w), equal_nan=True)


def test_memory_is_bounded_by_the_block_not_the_site(tmp_path, monkeypatch):
    monkeypatch.setattr(build, "BIN_BUFFER_BYTES", 2**20)
    monkeypatch.setattr(build, "REDUCE_MAX_POINTS", 10_000)
    monkeypatch.setattr(build, "CHUNK_POINTS", 50_000)
    rng = np.random.default_rng(2)
    peaks = []
    for size in (120.0, 480.0):  # extents differing 16x in area, the same point count, full blocks
        n = 150_000
        x, y = X0 + rng.random(n) * size, Y1 - rng.random(n) * size
        xyz = np.column_stack([x, y, plane(x, y)])
        path = write_cloud(tmp_path / f"m{int(size)}.las", xyz)
        tracemalloc.start()
        build_surface(
            _source(path, xyz),
            BuildParams(cell_size_m=0.2),
            tmp_path / f"m{int(size)}.tif",
            tmp_path / f".m{int(size)}",
            progress=lambda f, m: None,
            check_cancelled=lambda: None,
        )
        peaks.append(tracemalloc.get_traced_memory()[1])
        tracemalloc.stop()
    assert max(peaks) / min(peaks) < 1.3, peaks


def test_synthetic_cone_volume_with_the_median(tmp_path):
    """§5.3: 100 pts/m², σ 3 cm, 0.1 % outliers, median at the auto cell; the prism volume above the
    known plane is within 0.6 % of πR²H/3 (the full volume check through the engine is in Task 11)."""
    xyz = cone_cloud(100, 0.03, 0.001)
    result, out, _ = _build(tmp_path, xyz)
    assert result.cell_size_m in (0.2, 0.25)
    with open_surface(out) as r:
        w = Window(0, 0, r.spec.width, r.spec.height)
        z = r.read(w).astype(np.float64)
        xs, ys = r.spec.cell_centres(w)
    inside = np.hypot(xs - (X0 + 27.3), ys - (Y1 - 31.9)) < 12
    dz = (z - plane(xs, ys))[inside]
    assert np.isnan(dz).mean() < 0.001
    vol = np.nansum(np.clip(dz, 0, None)) * result.cell_size_m**2
    assert vol == pytest.approx(math.pi * 100 * 5 / 3, rel=0.006)
