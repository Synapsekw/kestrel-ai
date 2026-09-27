"""The elevation profile and the 3D length (plan maps-b4 Task 3; spec §9.2, §13, §14, §15:
"the profile on a plane and a cone (closed form), with NaN gaps, the chunked read spy, and cut/fill
areas between two planes"; "3D length on a plane (closed form)").

Contract ruling C5/C6 (BINDING, overrides the brief): `profile()`'s dict has no top-level
`step_m`, and each `series` entry has only `surface_id, label, date, z` (no per-series
`nodata_fraction`). Tests below assert the absence of both instead of asserting their values, and
use the top-level `nodata_fraction` (identical to the removed per-series value for a
single-surface profile) where the brief used the per-series figure.
"""

import math
from datetime import date

import numpy as np
import pytest
from surfaces import CX, CY, EPSG, WKT, X0, Y1, cone, fixture_spec, plane, write_surface

from app.errors import AppError
from app.mapmeasure import profile
from app.mapmeasure.frames import SiteFrame
from app.mapmeasure.geodesy import distance_results
from app.mapmeasure.profile import SurfaceRef
from app.surfaces import grid

UTM = SiteFrame("crs", WKT, EPSG)
LOCAL = SiteFrame.local()


def _ref(tmp_path, name, fn, cell=0.1, *, local=False) -> SurfaceRef:
    spec = fixture_spec(cell, crs_wkt=None, epsg=None) if local else fixture_spec(cell)
    path = tmp_path / name / "surface.tif"
    write_surface(path, spec, fn)
    return SurfaceRef(name, name.upper(), date(2026, 9, 14), spec.crs_wkt, spec.epsg, spec.cell_size, path)


def _along(line, stations):
    (x0, y0), (x1, y1) = line
    length = math.hypot(x1 - x0, y1 - y0)
    t = np.asarray(stations) / length
    return x0 + (x1 - x0) * t, y0 + (y1 - y0) * t


def _z(series) -> np.ndarray:
    return np.array([np.nan if v is None else v for v in series["z"]], dtype=np.float64)


def test_profile_on_a_plane_is_the_plane(tmp_path):
    ref = _ref(tmp_path, "p", plane)
    line = [[X0 + 5, Y1 - 5], [X0 + 55, Y1 - 50]]
    out = profile.profile(line, UTM, [ref])
    length = math.hypot(50, 45)
    assert len(out["stations_m"]) == math.ceil(length / 0.1)
    assert "step_m" not in out  # C5: the step is internal only
    xs, ys = _along(line, out["stations_m"])
    assert np.max(np.abs(_z(out["series"][0]) - plane(xs, ys))) < 2e-4
    s = out["series"][0]
    assert (s["surface_id"], s["label"], s["date"]) == ("p", "P", "2026-09-14")
    assert "nodata_fraction" not in s  # C6: no per-series nodata_fraction
    assert out["nodata_fraction"] == 0.0
    assert out["cut_area_m2"] is None and out["fill_area_m2"] is None
    assert out["grid_length_m"] == pytest.approx(length) and out["length_m"] > 0


def test_profile_across_a_cone_is_the_cone(tmp_path):
    ref = _ref(tmp_path, "c", cone, cell=0.05)
    line = [[CX - 15, CY], [CX + 15, CY]]
    out = profile.profile(line, UTM, [ref])
    xs, ys = _along(line, out["stations_m"])
    assert np.max(np.abs(_z(out["series"][0]) - cone(xs, ys))) < 0.03
    assert out["z_max"] == pytest.approx(5.0, abs=0.03) and out["z_min"] == pytest.approx(0.0, abs=1e-6)


def test_nan_band_gives_null_gaps_and_nodata_fraction(tmp_path):
    def band(xs, ys):
        return np.where((xs > X0 + 20) & (xs < X0 + 25), np.nan, plane(xs, ys))

    ref = _ref(tmp_path, "g", band)
    line = [[X0 + 5, Y1 - 30], [X0 + 45, Y1 - 30]]
    out = profile.profile(line, UTM, [ref])
    xs, _ = _along(line, out["stations_m"])
    z = out["series"][0]["z"]
    assert all(v is None for x, v in zip(xs, z, strict=True) if X0 + 20.2 < x < X0 + 24.8)
    assert all(v is not None for x, v in zip(xs, z, strict=True) if x < X0 + 19.8 or x > X0 + 25.2)
    # C6: no per-series nodata_fraction; the top-level value stands in (single surface here).
    assert "nodata_fraction" not in out["series"][0]
    assert 0.12 <= out["nodata_fraction"] <= 0.135


def test_partial_cover_gives_gaps_not_an_error(tmp_path):
    ref = _ref(tmp_path, "p", plane)
    out = profile.profile([[X0 + 50, Y1 - 30], [X0 + 80, Y1 - 30]], UTM, [ref])
    assert out["series"][0]["z"][0] is not None and out["series"][0]["z"][-1] is None
    assert 0.6 <= out["nodata_fraction"] <= 0.7


def test_line_off_every_surface_is_no_surface_under_line(tmp_path):
    ref = _ref(tmp_path, "p", plane)
    with pytest.raises(AppError) as e:
        profile.profile([[X0 + 100, Y1 - 30], [X0 + 120, Y1 - 30]], UTM, [ref])
    assert (e.value.code, e.value.status) == ("no_surface_under_line", 422)


def test_cut_and_fill_between_two_planes(tmp_path):
    flat = _ref(tmp_path, "flat", lambda xs, ys: np.full_like(xs, 50.0))
    tilt = _ref(tmp_path, "tilt", lambda xs, ys: 50.0 + 0.02 * (xs - (X0 + 30)))
    out = profile.profile([[X0 + 10, Y1 - 30], [X0 + 50, Y1 - 30]], UTM, [flat, tilt])
    # series[1] - series[0] runs linearly from -0.4 to +0.4 over 40 m: two triangles of 0.5*20*0.4
    assert out["cut_area_m2"] == pytest.approx(4.0, abs=1e-3)
    assert out["fill_area_m2"] == pytest.approx(4.0, abs=1e-3)


def test_cut_fill_is_trapezoidal_and_skips_gaps():
    s = np.array([0.0, 1.0, 2.0])
    assert profile.cut_fill(s, np.zeros(3), np.ones(3)) == (0.0, 2.0)
    assert profile.cut_fill(s, np.ones(3), np.zeros(3)) == (2.0, 0.0)
    assert profile.cut_fill(s, np.zeros(3), np.array([1.0, np.nan, 1.0])) == (0.0, 0.0)
    cut, fill = profile.cut_fill(np.array([0.0, 2.0]), np.zeros(2), np.array([-1.0, 1.0]))
    assert (cut, fill) == pytest.approx((0.5, 0.5))


def test_every_read_is_chunked_under_max_read(tmp_path, monkeypatch):
    ref = _ref(tmp_path, "p", plane)
    line = [[X0 + 5, Y1 - 5], [X0 + 55, Y1 - 50]]
    want = profile.profile(line, UTM, [ref])
    seen = []
    real = grid._raw_read
    monkeypatch.setattr(grid, "_raw_read", lambda ds, w, o, r: seen.append(o) or real(ds, w, o, r))
    monkeypatch.setattr(grid, "MAX_READ", 64)
    got = profile.profile(line, UTM, [ref])
    assert len(seen) > 1 and all(max(o) <= 64 for o in seen)
    assert got["series"][0]["z"] == want["series"][0]["z"]


def test_a_coarse_step_reads_decimated(tmp_path, monkeypatch):
    ref = _ref(tmp_path, "p", plane)
    monkeypatch.setattr(profile, "MAX_STATIONS", 100)  # step 0.68 m on a 0.1 m grid -> factor 4
    seen = []
    real = grid._raw_read
    monkeypatch.setattr(grid, "_raw_read", lambda ds, w, o, r: seen.append((w, o)) or real(ds, w, o, r))
    line = [[X0 + 5, Y1 - 5], [X0 + 55, Y1 - 50]]
    out = profile.profile(line, UTM, [ref])
    assert seen and all(round(w.width / o[1]) == 4 for w, o in seen)
    xs, ys = _along(line, out["stations_m"])
    # GDAL may serve the decimated read from an overview whose cell is not exactly 2x (601 -> 301
    # columns), so the sample position drifts by up to one full-resolution cell on a 0.02 slope.
    assert np.nanmax(np.abs(_z(out["series"][0]) - plane(xs, ys))) < 5e-3


def test_decimation_is_the_largest_power_of_two_within_the_step():
    assert profile.decimation(0.1, 0.05) == 1
    assert profile.decimation(0.1, 0.39) == 2
    assert profile.decimation(0.1, 0.68) == 4
    assert profile.decimation(0.1, 0.8) == 8


def test_length_3d_on_a_plane_is_closed_form(tmp_path):
    ref = _ref(tmp_path, "l", plane, local=True)
    line = [[X0 + 5, Y1 - 5], [X0 + 45, Y1 - 5], [X0 + 45, Y1 - 40]]
    got, nodata = profile.length_3d(line, LOCAL, ref, 1.0)
    want = 0.0
    for (x0, y0), (x1, y1) in zip(line, line[1:], strict=False):
        want += math.hypot(math.hypot(x1 - x0, y1 - y0), plane(x1, y1) - plane(x0, y0))
    assert got == pytest.approx(want, abs=1e-3) and nodata == 0.0


def test_length_3d_in_utm_uses_the_ground_length(tmp_path):
    ref = _ref(tmp_path, "u", plane)
    line = [[X0 + 5, Y1 - 5], [X0 + 55, Y1 - 50]]
    d = distance_results(line, UTM)
    got, nodata = profile.length_3d(line, UTM, ref, d["scale_factor"])
    dz = plane(line[1][0], line[1][1]) - plane(line[0][0], line[0][1])
    assert got == pytest.approx(math.hypot(d["length_m"], dz), abs=1e-3) and nodata == 0.0


def test_length_3d_off_the_dsm_is_null(tmp_path):
    ref = _ref(tmp_path, "p", plane)
    assert profile.length_3d([[X0 + 100, Y1 - 30], [X0 + 120, Y1 - 30]], UTM, ref, 1.0) == (None, 1.0)
