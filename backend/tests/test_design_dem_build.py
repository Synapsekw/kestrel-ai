"""DEM copy and re-grid (spec §6 Build, §15.3 DEM, §16.1, §16.5)."""

import math
import os

import numpy as np
import pytest
import rasterio
from design_targets import target_spec, write_dem, write_target
from designs import E0, N0, plane_z
from pyproj import CRS, Transformer
from rasterio.enums import Resampling
from rasterio.vrt import WarpedVRT
from rasterio.windows import Window

from app.jobs.cancellation import JobCancelled, JobFailure
from app.surfaces import grid
from app.surfaces.design import dem_build
from app.surfaces.design import placement as pl

INTERNAL = {"nodata": None, "sentinel": False, "mask": False, "scale": 1.0, "offset": 0.0, "rotated": False}


def opts(**kw):
    return {
        "candidate_ids": ["c0"],
        "source_crs": "EPSG:32639",
        "horizontal_unit": "metre",
        "vertical_unit": "metre",
        **kw,
    }


def build(tmp_path, src, spec, p, internal=INTERNAL):
    out = tmp_path / "out" / "surface.tif"
    out.parent.mkdir(parents=True, exist_ok=True)
    with grid.SurfaceWriter(out, spec) as w:
        dem_build.regrid(src, spec, w, p, internal, progress=lambda f, m: None, check_cancelled=lambda: None)
        w.finish()
    with rasterio.open(out) as r:
        return r.read(1)


def centres(spec):
    return spec.cell_centres(Window(0, 0, spec.width, spec.height))


def steep_plane(x, y):
    """A steeper plane than designs.plane_z (slope 0.3, matching the reviewer's fix-round-1
    probes) so a contaminated cell's error clears the 1 mm oracle instead of hiding under it."""
    return 10.0 + 0.3 * (np.asarray(x) - E0) - 0.15 * (np.asarray(y) - N0)


def test_a_conforming_dem_on_the_target_lattice_is_copied_byte_for_byte(tmp_path):
    target = target_spec()
    src = write_target(tmp_path / "design.tif", target, lambda x, y: plane_z(x, y) - 1.0)
    p = pl.resolve(opts(), "geotiff", target)
    assert grid.convention_problems(src) == []
    assert dem_build.can_copy(src, p, target, INTERNAL)
    dst = tmp_path / "surface.tif"
    dem_build.copy_file(src, dst, progress=lambda f, m: None, check_cancelled=lambda: None)
    with rasterio.open(src) as a, rasterio.open(dst) as b:
        assert np.array_equal(a.read(1), b.read(1), equal_nan=True)
    assert not dst.with_name("surface.tif.partial").exists()


@pytest.mark.parametrize(
    ("case", "kw"),
    [
        ("plain tiff", {}),
        ("feet heights", {"vertical_unit": "international_foot"}),
        ("other crs", {"source_crs": "EPSG:32638"}),
    ],
)
def test_anything_else_is_regridded(tmp_path, case, kw):
    target = target_spec()
    if case == "plain tiff":
        src = write_dem(tmp_path / "d.tif", np.ones((200, 400), np.float32), x0=E0, y0=N0 + 100, cell=0.5)
    else:
        src = write_target(tmp_path / "d.tif", target, plane_z)
    assert not dem_build.can_copy(src, pl.resolve(opts(**kw), "geotiff", target), target, INTERNAL)
    assert not dem_build.can_copy(
        src, pl.resolve(opts(), "geotiff", target), target, {**INTERNAL, "sentinel": True}
    )


def test_a_plane_in_utm_38_regrids_onto_a_utm_39_target_within_a_millimetre(tmp_path):
    to38 = Transformer.from_crs(32639, 32638, always_xy=True)
    target = target_spec((250_000.0, 3_000_000.0, 250_400.0, 3_000_300.0), cell=0.5)
    xs, ys = to38.transform(
        [250_000, 250_400, 250_400, 250_000], [3_000_000, 3_000_000, 3_000_300, 3_000_300]
    )
    x0, y1 = min(xs) - 20, max(ys) + 20
    w, h = int(max(xs) - x0 + 20), int(y1 - (min(ys) - 20))
    X0, Y0 = x0, y1

    def plane38(x, y):
        return 10.0 + 0.02 * (x - X0) - 0.01 * (Y0 - y)

    cols, rows = np.meshgrid(np.arange(w) + 0.5, np.arange(h) + 0.5)
    src = write_dem(
        tmp_path / "p38.tif", plane38(x0 + cols, y1 - rows), x0=x0, y0=y1, cell=1.0, crs="EPSG:32638"
    )
    p = pl.resolve(opts(source_crs="EPSG:32638"), "geotiff", target)
    out = build(tmp_path, src, target, p)
    X, Y = centres(target)
    ex, ey = to38.transform(X, Y)
    assert np.isfinite(out).all()
    assert np.abs(out - plane38(ex, ey)).max() < 1e-3


def test_feet_heights_become_metres(tmp_path):
    target = target_spec()
    z = plane_z(*centres(target)) / 0.3048
    src = write_dem(tmp_path / "ft.tif", z.astype(np.float32), x0=target.x0, y0=target.y0, cell=0.5)
    out = build(
        tmp_path, src, target, pl.resolve(opts(vertical_unit="international_foot"), "geotiff", target)
    )
    assert np.abs(out - plane_z(*centres(target))).max() < 1e-4


@pytest.mark.parametrize(
    ("dtype", "nodata", "internal"),
    [("int16", -32767, {"nodata": -32767.0}), ("float32", None, {"nodata": -9999.0, "sentinel": True})],
)
def test_nodata_and_sentinels_become_nan(tmp_path, dtype, nodata, internal):
    target = target_spec()
    z = np.full((target.height, target.width), 12, dtype=dtype)
    z[:, :40] = -32767 if dtype == "int16" else -9999
    src = write_dem(tmp_path / "n.tif", z, x0=target.x0, y0=target.y0, cell=0.5, dtype=dtype, nodata=nodata)
    out = build(tmp_path, src, target, pl.resolve(opts(), "geotiff", target), {**INTERNAL, **internal})
    assert np.isnan(out[:, :39]).all() and np.nanmin(out) == 12.0


def test_no_read_is_larger_than_2048(tmp_path, monkeypatch):
    target = target_spec((E0, N0, E0 + 300.0, N0 + 250.0), cell=0.1)
    assert target.width > 2048
    src = write_dem(tmp_path / "big.tif", np.ones((250, 300), np.float32), x0=E0, y0=N0 + 250, cell=1.0)
    sizes, real = [], dem_build.read_window

    def spy(vrt, window):
        sizes.append((window.width, window.height))
        return real(vrt, window)

    monkeypatch.setattr(dem_build, "read_window", spy)
    build(tmp_path, src, target, pl.resolve(opts(), "geotiff", target))
    assert sizes and max(max(s) for s in sizes) == 2048


def test_the_preview_read_is_one_window(tmp_path):
    target = target_spec()
    src = write_target(tmp_path / "d.tif", target, plane_z)
    p = pl.resolve(opts(), "geotiff", target)
    prev, _ = pl.preview_grid(target.bounds, target)
    out = dem_build.read_preview(src, prev, p, INTERNAL)
    assert out.shape == (prev.height, prev.width) and np.isfinite(out).mean() > 0.95


def test_a_changed_file_is_refused(tmp_path):
    src = write_dem(tmp_path / "d.tif", np.ones((10, 10), np.float32), x0=E0, y0=N0 + 10, cell=1.0)
    st = src.stat()
    internal = {"file_size": st.st_size, "mtime_ns": st.st_mtime_ns}
    dem_build.check_unchanged(src, internal)
    os.utime(src, ns=(st.st_atime_ns, st.st_mtime_ns + 5_000_000_000))
    with pytest.raises(JobFailure, match="changed since it was read"):
        dem_build.check_unchanged(src, internal)


def test_footprint_in_another_crs(tmp_path):
    src = write_dem(tmp_path / "d.tif", np.ones((10, 10), np.float32), x0=E0, y0=N0 + 10, cell=1.0)
    p = pl.resolve(opts(), "geotiff", target_spec(epsg=32638))
    minx, miny, maxx, maxy = dem_build.footprint(src, p)
    assert maxx - minx > 9 and CRS.from_wkt(p.out_crs_wkt).to_epsg() == 32638


def test_a_dem_offset_from_the_target_lattice_holds_a_millimetre_at_the_edge_ring(tmp_path):
    """R7: an output cell whose bilinear kernel reaches past the source DEM's own edge must come
    back NaN, not a silently wrong value -- so every *covered* cell, including the outer ring, is
    still within 1 mm (spec §16.1). Without eroding the footprint by the kernel's reach, the plan's
    original code left the outer ring ~7.5 mm off (see Task 14's feet-DEM offset finding)."""
    target = target_spec()
    off = 0.2  # source cells; < 0.5 so only the outer ring of the target grid is affected
    shifted = grid.GridSpec(
        target.crs_wkt,
        target.epsg,
        target.cell_size,
        target.x0 + off * target.cell_size,
        target.y0 - off * target.cell_size,
        target.width,
        target.height,
    )
    xs, ys = shifted.cell_centres(Window(0, 0, target.width, target.height))
    src = write_dem(
        tmp_path / "offset.tif",
        plane_z(xs, ys).astype(np.float32),
        x0=shifted.x0,
        y0=shifted.y0,
        cell=shifted.cell_size,
    )
    p = pl.resolve(opts(), "geotiff", target)
    out = build(tmp_path, src, target, p)
    X, Y = centres(target)
    finite = np.isfinite(out)
    # the shifted top row / left column genuinely fall outside the source's own footprint
    assert finite.any() and not finite.all()
    assert np.abs(out[finite] - plane_z(X, Y)[finite]).max() < 1e-3


def test_gdal_default_warp_tolerance_misses_the_millimetre_oracle_but_1e9_holds(tmp_path):
    """ADR 2026-09-24: GDAL's approximate transformer at its default tolerance (0.125 source
    pixels) can miss the spec's 1 mm oracle over a big enough re-grid; dem_build's tolerance=1e-9
    does not. This pins the R1 controller ruling (WarpedVRT tolerance=0.0 is refused by GDAL)."""
    to38 = Transformer.from_crs(32639, 32638, always_xy=True)
    target = target_spec((E0, N0, E0 + 1_800.0, N0 + 1_800.0), cell=6.0)  # 300 x 300, 1.8 km across
    scell, slope, pad = 100.0, 0.25, 15
    n = 40
    cc = np.linspace(0.5, target.width - 0.5, n)
    rr = np.linspace(0.5, target.height - 0.5, n)
    cx, ry = np.meshgrid(cc, rr)
    ex, ey = to38.transform(
        target.x0 + cx.ravel() * target.cell_size, target.y0 - ry.ravel() * target.cell_size
    )
    x0 = math.floor(ex.min() - pad * scell)
    y1 = math.ceil(ey.max() + pad * scell)
    w = int(math.ceil((ex.max() + pad * scell - x0) / scell)) + 2
    h = int(math.ceil((y1 - (ey.min() - pad * scell)) / scell)) + 2
    cols, rows = np.meshgrid(np.arange(w) + 0.5, np.arange(h) + 0.5)
    z = 10.0 + slope * (cols * scell) - 0.5 * slope * (rows * scell)
    src = write_dem(
        tmp_path / "steep38.tif", z.astype(np.float32), x0=x0, y0=y1, cell=scell, crs="EPSG:32638"
    )
    p = pl.resolve(opts(source_crs="EPSG:32638"), "geotiff", target)

    X, Y = centres(target)
    EX, EY = to38.transform(X, Y)
    exact = 10.0 + slope * (EX - x0) - 0.5 * slope * (y1 - EY)

    with rasterio.open(src) as ds:
        with WarpedVRT(
            ds,
            src_crs="EPSG:32638",
            crs=target.crs_wkt,
            transform=target.transform,
            width=target.width,
            height=target.height,
            dtype="float32",
            resampling=Resampling.bilinear,
            tolerance=0.125,  # GDAL's own default: the approximate transformer this ADR replaces
        ) as vrt:
            default_tol = vrt.read(1)
    assert np.abs(default_tol - exact).max() > 1e-3, "fixture stopped exercising the default-tolerance gap"

    out = build(tmp_path, src, target, p)
    assert np.abs(out - exact).max() < 1e-3


def test_an_interior_nodata_hole_erodes_its_contaminated_rim_not_just_itself(tmp_path):
    """R7 fix round 1: GDAL's bilinear renormalises weights across a source nodata hole, so a cell
    just outside the hole is never actually purely a blend of valid neighbours -- the data band
    alone does not show this (it comes back a plausible-looking, silently wrong value). The
    coverage mask (a validity band warped through the identical pipeline) catches the whole
    contaminated rim, not just the hole's own footprint."""
    target = target_spec()
    off = 0.2  # source cells, offset from the target lattice, like the edge-ring case
    shifted = grid.GridSpec(
        target.crs_wkt,
        target.epsg,
        target.cell_size,
        target.x0 + off * target.cell_size,
        target.y0 - off * target.cell_size,
        target.width,
        target.height,
    )
    xs, ys = shifted.cell_centres(Window(0, 0, target.width, target.height))
    z = steep_plane(xs, ys).astype(np.float32)
    z[80:100, 80:100] = -9999.0  # an interior hole, well inside the target -- not at any outer edge
    src = write_dem(tmp_path / "hole.tif", z, x0=shifted.x0, y0=shifted.y0, cell=shifted.cell_size)
    internal = {**INTERNAL, "nodata": -9999.0, "sentinel": True}
    p = pl.resolve(opts(), "geotiff", target)
    out = build(tmp_path, src, target, p, internal)
    X, Y = centres(target)
    finite = np.isfinite(out)
    assert finite.any() and not finite.all()  # the hole and its contaminated rim are both eroded
    assert np.abs(out[finite] - steep_plane(X, Y)[finite]).max() < 1e-3


def test_a_one_point_two_ratio_target_cell_holds_a_millimetre(tmp_path):
    """R7 fix round 1: without XSCALE=1/YSCALE=1, GDAL widens the bilinear kernel whenever the
    target cell is coarser than the source -- here a 0.6 m target on a 0.5 m source (ratio 1.2) --
    biasing interior cells well past 1 mm even generously clear of any edge."""
    target = target_spec(cell=0.6)
    off = 0.2
    src_cell = 0.5
    pad = 6  # source cells of slack around the target footprint: isolate the ratio bias, not R7's erosion
    x0 = target.x0 - pad * src_cell + off * src_cell
    y0 = target.y0 + pad * src_cell - off * src_cell
    w = int(round((target.width * target.cell_size + 2 * pad * src_cell) / src_cell))
    h = int(round((target.height * target.cell_size + 2 * pad * src_cell) / src_cell))
    cols, rows = np.meshgrid(np.arange(w) + 0.5, np.arange(h) + 0.5)
    z = steep_plane(x0 + cols * src_cell, y0 - rows * src_cell).astype(np.float32)
    src = write_dem(tmp_path / "ratio12.tif", z, x0=x0, y0=y0, cell=src_cell)
    p = pl.resolve(opts(), "geotiff", target)
    out = build(tmp_path, src, target, p)
    X, Y = centres(target)
    assert np.isfinite(out).all()
    assert np.abs(out - steep_plane(X, Y)).max() < 1e-3


@pytest.mark.parametrize(("case", "target_cell"), [("ratio 1", 0.5), ("ratio 1.2", 0.6)])
def test_a_reprojected_steep_plane_holds_a_millimetre(tmp_path, case, target_cell):
    """Fix round 2: a CRS-reprojected source needs the real `XSCALE`/`YSCALE` kwargs even at ratio
    1 -- round 1's exact-bilinear workaround (reproject at the source's own resolution, then
    hand-interpolate) still missed the 1 mm oracle by ~15 mm here, because that reprojection step
    itself goes through the same GDAL bilinear kernel, which is biased without the real kwargs
    (passing them inside `warp_extras={...}` does not reach GDAL at all -- see the ADR)."""
    to38 = Transformer.from_crs(32639, 32638, always_xy=True)
    target = target_spec((250_000.0, 3_000_000.0, 250_400.0, 3_000_300.0), cell=target_cell)
    xs, ys = to38.transform(
        [250_000, 250_400, 250_400, 250_000], [3_000_000, 3_000_000, 3_000_300, 3_000_300]
    )
    x0, y1 = min(xs) - 20, max(ys) + 20
    src_cell = 0.5
    w = int((max(xs) - x0 + 20) / src_cell)
    h = int((y1 - (min(ys) - 20)) / src_cell)
    X0, Y0 = x0, y1

    def plane38(x, y):
        return 10.0 + 0.3 * (x - X0) - 0.15 * (Y0 - y)

    cols, rows = np.meshgrid(np.arange(w) + 0.5, np.arange(h) + 0.5)
    src = write_dem(
        tmp_path / "p38steep.tif",
        plane38(x0 + cols * src_cell, y1 - rows * src_cell),
        x0=x0,
        y0=y1,
        cell=src_cell,
        crs="EPSG:32638",
    )
    p = pl.resolve(opts(source_crs="EPSG:32638"), "geotiff", target)
    out = build(tmp_path, src, target, p)
    X, Y = centres(target)
    ex, ey = to38.transform(X, Y)
    assert np.isfinite(out).all()
    assert np.abs(out - plane38(ex, ey)).max() < 1e-3


def test_a_four_times_ratio_target_cell_holds_a_millimetre_at_the_edge_ring(tmp_path):
    """R7 fix round 1: the Resampling.average path (target cell more than double the source cell --
    here a 2 m target on a 0.5 m source, ratio 4) needs the same coverage-based erosion as bilinear;
    a fixed pixel-distance reach sized for bilinear left its edge ring badly off."""
    target = target_spec(cell=2.0)
    off = 0.3
    src_cell = 0.5  # target cell / src cell = 4 -> Resampling.average
    xs, ys = target.cell_centres(Window(0, 0, target.width, target.height))
    x0 = target.x0 + off * src_cell  # the source covers exactly the target's own extent, shifted
    y0 = target.y0 - off * src_cell
    w = int(round(target.width * target.cell_size / src_cell))
    h = int(round(target.height * target.cell_size / src_cell))
    cols, rows = np.meshgrid(np.arange(w) + 0.5, np.arange(h) + 0.5)
    z = steep_plane(x0 + cols * src_cell, y0 - rows * src_cell).astype(np.float32)
    src = write_dem(tmp_path / "ratio4.tif", z, x0=x0, y0=y0, cell=src_cell)
    p = pl.resolve(opts(), "geotiff", target)
    out = build(tmp_path, src, target, p)
    X, Y = centres(target)
    finite = np.isfinite(out)
    assert finite.any() and not finite.all()  # the tightly-covering source leaves a genuine edge ring
    assert np.abs(out[finite] - steep_plane(X, Y)[finite]).max() < 1e-3


class _CancelAfter:
    """A check_cancelled that raises JobCancelled on its `n`-th call."""

    def __init__(self, n):
        self.n, self.calls = n, 0

    def __call__(self):
        self.calls += 1
        if self.calls >= self.n:
            raise JobCancelled()


def _spy_tmp_dirs(monkeypatch):
    made = []
    real = dem_build.tempfile.mkdtemp

    def spy(*a, **kw):
        made.append(real(*a, **kw))
        return made[-1]

    monkeypatch.setattr(dem_build.tempfile, "mkdtemp", spy)
    return made


def _coarse_spec():
    """A 2 m grid over the 40 x 40 m test DEM."""
    return grid.GridSpec(
        crs_wkt=CRS.from_epsg(32639).to_wkt(),
        epsg=32639,
        cell_size=2.0,
        x0=E0,
        y0=N0 + 40,
        width=20,
        height=20,
    )


def test_a_cancel_stops_the_preview_validity_pass_and_removes_its_temp_dir(tmp_path, monkeypatch):
    # Final review 4: the validity pass reads the whole source DEM; it must honour a cancel per chunk.
    src = write_dem(tmp_path / "d.tif", np.ones((40, 40), np.float32), x0=E0, y0=N0 + 40, cell=1.0)
    monkeypatch.setattr(grid, "MAX_READ", 8)  # 25 chunks of 8 x 8
    made = _spy_tmp_dirs(monkeypatch)
    p = pl.resolve(opts(), "geotiff", _coarse_spec())
    pspec = _coarse_spec()
    cancel = _CancelAfter(3)
    with pytest.raises(JobCancelled):
        dem_build.read_preview(src, pspec, p, INTERNAL, check_cancelled=cancel)
    assert cancel.calls == 3  # stopped in the third of the 25 chunks
    assert made and not any(os.path.exists(d) for d in made)


def test_a_cancel_stops_the_regrid_validity_pass_and_reports_its_progress(tmp_path, monkeypatch):
    src = write_dem(tmp_path / "d.tif", np.ones((40, 40), np.float32), x0=E0, y0=N0 + 40, cell=1.0)
    monkeypatch.setattr(grid, "MAX_READ", 8)
    made = _spy_tmp_dirs(monkeypatch)
    spec = _coarse_spec()
    p = pl.resolve(opts(), "geotiff", spec)
    fractions = []
    cancel = _CancelAfter(6)
    out = tmp_path / "out.tif"
    with pytest.raises(JobCancelled), grid.SurfaceWriter(out, spec) as w:
        dem_build.regrid(
            src, spec, w, p, INTERNAL, progress=lambda f, m: fractions.append(f), check_cancelled=cancel
        )
    assert fractions and max(fractions) <= dem_build.VALIDITY_SHARE * 5 / 25 + 1e-9
    assert made and not any(os.path.exists(d) for d in made)
