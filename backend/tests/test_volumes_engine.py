"""The volume engine against closed-form fixtures (spec 2026-09-23-volumes §7.2, §13, §14)."""

import math

import numpy as np
import pytest
import shapely
from rasterio.windows import Window
from shapely import affinity
from shapely.geometry import Polygon, box
from surfaces import CELLS, CX, CY, X0, Y1, circle, cone, fixture_spec, plane, write_surface

from app.surfaces import grid
from app.surfaces.grid import MAX_READ, convention_problems, open_surface
from app.volumes.engine import EngineFailure, EngineInputs, measure
from app.volumes.regions import cells_in

CONE = math.pi * 10**2 * 5 / 3  # 523.599 m³
BOX = 20.3 * 12.7 * 2  # 515.620 m³
FRUSTUM = 4 / 3 * (400 + 64 + math.sqrt(400 * 64))  # 832.000 m³
MACHINE = affinity.rotate(box(CX + 4 - 1.5, CY + 2 - 1.0, CX + 4 + 1.5, CY + 2 + 1.0), 33.0)


def _run(tmp_path, cell, top_fn, polygon, *, name="top", base_fn=None, base_spec=None, **kw):
    spec = fixture_spec(cell)
    write_surface(tmp_path / f"{name}.tif", spec, top_fn)
    base_reader = None
    if base_fn is not None:
        write_surface(tmp_path / f"{name}-base.tif", base_spec or spec, base_fn)
        base_reader = open_surface(tmp_path / f"{name}-base.tif")
    with open_surface(tmp_path / f"{name}.tif") as top:
        try:
            return measure(EngineInputs(polygon=polygon, top=top, base=base_reader, **kw))
        finally:
            if base_reader:
                base_reader.close()


def _codes(res):
    return {w["code"] for w in res["warnings"]}


@pytest.mark.parametrize("cell", CELLS)
def test_cone_on_a_tilted_plane_with_a_toe_plane(tmp_path, cell):
    res = _run(
        tmp_path, cell, lambda x, y: plane(x, y) + cone(x, y), circle(CX, CY, 12.0), base_kind="toe_plane"
    )
    assert res["fill_m3"] == pytest.approx(CONE, rel=0.001)
    assert res["cut_m3"] < 0.001 * CONE and res["nodata_area_m2"] == 0
    assert res["measured_area_m2"] == pytest.approx(res["area_m2"])
    assert res["area_m2"] == pytest.approx(res["polygon_area_m2"], rel=0.003)
    assert res["base_fit"]["kind"] == "toe_plane" and res["base_fit"]["rejected"] == 0


@pytest.mark.parametrize("cell", CELLS)
def test_rotated_box_with_a_toe_plane(tmp_path, cell):
    footprint = affinity.rotate(box(CX - 10.15, CY - 6.35, CX + 10.15, CY + 6.35), 30.0)

    def top(x, y):
        return plane(x, y) + np.where(shapely.contains_xy(footprint, x, y), 2.0, 0.0)

    res = _run(tmp_path, cell, top, circle(CX, CY, 16.0, 64), base_kind="toe_plane")
    # A sharp-edged box quantises its 66 m outline to whole cells: at 0.5 m that is ±0.3 % by
    # itself (plan deviation 16), so the spec's 0.1 % holds from 0.05 to 0.25 m.
    assert res["fill_m3"] == pytest.approx(BOX, rel=0.001 if cell <= 0.25 else 0.004)


@pytest.mark.parametrize("cell", CELLS)
def test_rotated_frustum_with_a_toe_plane(tmp_path, cell):
    a = math.radians(17)

    def top(x, y):
        u = (x - CX) * math.cos(a) + (y - CY) * math.sin(a)
        v = -(x - CX) * math.sin(a) + (y - CY) * math.cos(a)
        return plane(x, y) + np.clip((10 - np.maximum(np.abs(u), np.abs(v))) / 6 * 4, 0, 4)

    res = _run(tmp_path, cell, top, circle(CX, CY, 16.0, 64), base_kind="toe_plane")
    assert res["fill_m3"] == pytest.approx(FRUSTUM, rel=0.001)


def _cut_fill_top(x, y):
    ra = np.hypot(x - (CX - 12), y - (CY + 9))
    rb = np.hypot(x - (CX + 13), y - (CY - 8))
    return plane(x, y) + np.where(ra < 8, 3 * (1 - ra / 8), 0) - np.where(rb < 6, 2 * (1 - rb / 6), 0) + 0.07


WHOLE = [[X0 + 1, Y1 - 1], [X0 + 59, Y1 - 1], [X0 + 59, Y1 - 50], [X0 + 1, Y1 - 50]]
STABLE = [[X0 + 1, Y1 - 55], [X0 + 58, Y1 - 55], [X0 + 58, Y1 - 59], [X0 + 1, Y1 - 59]]


@pytest.mark.parametrize("cell", CELLS)
def test_cut_and_fill_against_an_earlier_survey_with_the_shift(tmp_path, cell):
    res = _run(
        tmp_path,
        cell,
        _cut_fill_top,
        WHOLE,
        base_fn=plane,
        base_kind="surface",
        stable_polygon=STABLE,
        apply_shift=True,
    )
    assert res["shift_applied_m"] == pytest.approx(0.07, abs=0.001)
    assert res["fill_m3"] == pytest.approx(math.pi * 64 * 3 / 3, rel=0.001)  # 201.062
    assert res["cut_m3"] == pytest.approx(math.pi * 36 * 2 / 3, rel=0.001)  # 75.398
    assert res["alignment"]["median_dz"] == pytest.approx(0.07, abs=1e-6)
    un = res["unshifted"]
    assert un["net_m3"] == pytest.approx(
        res["net_m3"] + res["shift_applied_m"] * res["measured_area_m2"], rel=1e-9
    )
    assert res["uncertainty"]["complete"] and "alignment_offset" not in _codes(res)


def test_the_same_without_the_shift_warns_and_counts_the_offset(tmp_path):
    res = _run(
        tmp_path, 0.25, _cut_fill_top, WHOLE, base_fn=plane, base_kind="surface", stable_polygon=STABLE
    )
    assert res["shift_applied_m"] == 0 and res["unshifted"] is None
    assert res["net_m3"] == pytest.approx(201.062 - 75.398 + 0.07 * res["measured_area_m2"], rel=0.001)
    assert "alignment_offset" in _codes(res)
    a = res["alignment"]
    assert res["uncertainty"]["alignment_m3"] == pytest.approx(
        res["measured_area_m2"] * math.hypot(a["median_dz"], a["sigma"])
    )


def test_surface_base_without_a_stable_area_is_incomplete(tmp_path):
    res = _run(tmp_path, 0.5, _cut_fill_top, WHOLE, base_fn=plane, base_kind="surface")
    assert not res["uncertainty"]["complete"] and res["uncertainty"]["alignment_m3"] is None
    assert "no_stable_area" in _codes(res)


def test_base_on_another_lattice_is_used_through_resample(tmp_path):
    base_spec = fixture_spec(0.1)
    res = _run(
        tmp_path,
        0.25,
        lambda x, y: plane(x, y) + cone(x, y),
        circle(CX, CY, 12.0),
        base_fn=plane,
        base_spec=base_spec,
        base_kind="surface",
    )
    assert res["fill_m3"] == pytest.approx(CONE, rel=0.001)


@pytest.mark.parametrize("masked", [False, True])
def test_machine_on_the_cone_flank(tmp_path, masked):
    def top(x, y):
        z = plane(x, y) + cone(x, y)
        return np.where(shapely.contains_xy(MACHINE, x, y), z + 2.5, z)

    footprints = [MACHINE.buffer(0.5)] if masked else []
    res = _run(tmp_path, 0.1, top, circle(CX, CY, 12.0), base_kind="toe_plane", footprints=footprints)
    if masked:
        assert res["fill_m3"] == pytest.approx(CONE, rel=0.005)
        spec = fixture_spec(0.1)
        whole = Window(0, 0, spec.width, spec.height)
        want = cells_in(MACHINE.buffer(0.5), spec, whole, all_touched=True).sum() * 0.01
        assert res["masked_area_m2"] == pytest.approx(want)
        assert res["footprints_used"] == 1 and res["uncertainty"]["patch_m3"] > 0
    else:
        assert res["fill_m3"] == pytest.approx(CONE + 15.0, rel=0.005)
        assert res["masked_area_m2"] == 0


def test_hole_is_reported_as_nodata_not_zero(tmp_path):
    spec = fixture_spec(0.1)
    hx, hy = spec.cell_centres(Window(270, 310, 6, 6))

    def top(x, y):
        z = plane(x, y) + cone(x, y)
        hole = (np.abs(x - hx.mean()) < 0.3) & (np.abs(y - hy.mean()) < 0.3)
        return np.where(hole, np.nan, z)

    full = _run(
        tmp_path,
        0.1,
        lambda x, y: plane(x, y) + cone(x, y),
        circle(CX, CY, 12.0),
        name="full",
        base_kind="toe_plane",
    )
    res = _run(tmp_path, 0.1, top, circle(CX, CY, 12.0), base_kind="toe_plane")
    assert res["nodata_area_m2"] == pytest.approx(36 * 0.01)
    hole_dz = cone(hx, hy).sum() * 0.01
    assert res["fill_m3"] == pytest.approx(full["fill_m3"] - hole_dz, abs=0.02)
    assert res["uncertainty"]["nodata_m3"] > 0
    assert res["measured_area_m2"] == pytest.approx(res["area_m2"] - res["nodata_area_m2"])


def test_exclude_removes_area_and_patch_keeps_it(tmp_path):
    corner = [[CX - 3, CY - 3], [CX - 1, CY - 3], [CX - 1, CY - 1], [CX - 3, CY - 1]]

    def run(mode):
        return _run(
            tmp_path,
            0.1,
            lambda x, y: plane(x, y) + cone(x, y),
            circle(CX, CY, 12.0),
            name=mode,
            base_kind="toe_plane",
            exclusions=[(corner, mode)],
        )

    excl, patch = run("exclude"), run("patch")
    assert excl["excluded_area_m2"] > 4.0 and excl["area_m2"] < patch["area_m2"]
    assert excl["polygon_area_m2"] == pytest.approx(Polygon(circle(CX, CY, 12.0)).area - 4.0)
    assert patch["masked_area_m2"] > 4.0 and patch["excluded_area_m2"] == 0


def test_patch_over_400_m2_becomes_nodata_with_a_warning(tmp_path):
    big = [[CX - 11, CY - 11], [CX + 11, CY - 11], [CX + 11, CY + 11], [CX - 11, CY + 11]]
    res = _run(
        tmp_path,
        0.25,
        lambda x, y: plane(x, y) + cone(x, y),
        circle(CX, CY, 25.0),
        base_kind="flat",
        base_z=40.0,
        exclusions=[(big, "patch")],
    )
    assert "patch_too_large" in _codes(res) and res["nodata_area_m2"] > 400
    assert "nodata_high" in _codes(res)


def test_toe_edge_half_missing_fails_and_seventy_percent_warns(tmp_path):
    def missing_west(cut):
        return lambda x, y: np.where(x < CX - 12 + cut, np.nan, plane(x, y) + cone(x, y))

    with pytest.raises(EngineFailure, match="missing or masked ground"):
        _run(tmp_path, 0.25, missing_west(14.0), circle(CX, CY, 12.0), name="a", base_kind="toe_plane")
    res = _run(tmp_path, 0.25, missing_west(6.0), circle(CX, CY, 12.0), name="b", base_kind="toe_plane")
    assert "edge_coverage_low" in _codes(res)


def test_uncertainty_terms_follow_their_formulas(tmp_path):
    res = _run(
        tmp_path, 0.25, lambda x, y: plane(x, y) + cone(x, y), circle(CX, CY, 12.0), base_kind="toe_plane"
    )
    u = res["uncertainty"]
    assert u["base_m3"] == pytest.approx(res["measured_area_m2"] * res["base_fit"]["rms_m"])
    terms = [
        u[k] for k in ("base_m3", "alignment_m3", "cell_size_m3", "nodata_m3", "patch_m3") if u[k] is not None
    ]
    assert u["total_m3"] == pytest.approx(math.sqrt(sum(t * t for t in terms)))
    assert u["alignment_m3"] is None and u["complete"] and u["cell_size_m3"] >= 0
    flat = _run(
        tmp_path,
        0.25,
        lambda x, y: plane(x, y) + cone(x, y),
        circle(CX, CY, 12.0),
        name="f",
        base_kind="flat",
        base_z=51.0,
    )
    assert flat["uncertainty"]["base_m3"] == 0.0 and flat["base_fit"]["kind"] == "flat"
    assert flat["cut_m3"] > 0 and flat["fill_m3"] > 0  # the tilted ground crosses the 51 m level


def test_cut_and_fill_labels_are_sign_correct(tmp_path):
    res = _run(
        tmp_path,
        0.5,
        lambda x, y: np.full(x.shape, 48.0),
        box(X0 + 10, Y1 - 30, X0 + 30, Y1 - 10).exterior.coords[:-1],
        base_kind="flat",
        base_z=50.0,
    )
    assert (
        res["fill_m3"] == 0
        and res["cut_m3"] == pytest.approx(2.0 * 400)
        and res["net_m3"] == pytest.approx(-800)
    )


def test_polygon_off_the_grid_counts_as_nodata(tmp_path):
    """Review focus 1: cells beyond the surface are unknown, not zero."""
    ring = circle(X0 + 2, Y1 - 30, 8.0)  # half of it west of the grid
    res = _run(tmp_path, 0.25, lambda x, y: plane(x, y) + 1.0, ring, base_kind="flat", base_z=50.0)
    assert res["area_m2"] == pytest.approx(Polygon(ring).area, rel=0.01)
    assert res["nodata_area_m2"] > 0.3 * res["area_m2"]  # the part west of the grid
    assert any(w["code"] == "nodata_high" and w["severity"] == "danger" for w in res["warnings"])


def test_base_surface_partial_cover_is_nodata(tmp_path):
    """Review focus 2: an earlier survey that stops half way leaves the rest unknown."""
    res = _run(
        tmp_path,
        0.25,
        lambda x, y: plane(x, y) + 1.0,
        WHOLE,
        base_fn=lambda x, y: np.where(x < X0 + 30, plane(x, y), np.nan),
        base_kind="surface",
    )
    assert res["nodata_area_m2"] == pytest.approx(res["area_m2"] / 2, rel=0.02)
    assert res["fill_m3"] == pytest.approx(res["measured_area_m2"] * 1.0, rel=1e-6)


def test_ring_orientation_and_closure_do_not_matter(tmp_path):
    """Review focus 5."""
    ring = circle(CX, CY, 12.0)
    runs = [
        _run(tmp_path, 0.25, lambda x, y: plane(x, y) + cone(x, y), r, name=f"o{i}", base_kind="toe_plane")
        for i, r in enumerate([ring, ring[::-1], ring + [ring[0]]])
    ]
    for r in runs[1:]:
        assert r["fill_m3"] == pytest.approx(runs[0]["fill_m3"], rel=1e-6)  # edge samples start elsewhere
        assert r["area_m2"] == runs[0]["area_m2"]


def test_diff_grid_is_written_on_the_lattice_and_reads_stay_bounded(tmp_path, monkeypatch):
    seen = []
    real = grid._raw_read
    monkeypatch.setattr(grid, "_raw_read", lambda ds, w, o, r: seen.append(o) or real(ds, w, o, r))
    diff = tmp_path / "diff.tif"
    res = _run(
        tmp_path,
        0.1,
        lambda x, y: plane(x, y) + cone(x, y),
        circle(CX, CY, 12.0),
        base_kind="toe_plane",
        diff_path=diff,
    )
    assert all(max(s) <= MAX_READ for s in seen)
    assert convention_problems(diff) == [] and not (tmp_path / "diff.tif.partial").exists()
    with open_surface(diff) as d:
        z = d.sample_bilinear(np.array([CX]), np.array([CY]))
        assert grid.same_lattice(d.spec, fixture_spec(0.1))
    assert z[0] == pytest.approx(5.0, abs=0.06)
    assert res["diff_scale_m"] > 3.0


def test_a_tiny_or_self_crossing_polygon_is_refused(tmp_path):
    with pytest.raises(EngineFailure, match="fewer than 25 cells"):
        _run(tmp_path, 0.5, plane, circle(CX, CY, 1.0), base_kind="flat", base_z=50.0)
    bow = [[CX - 5, CY - 5], [CX + 5, CY + 5], [CX + 5, CY - 5], [CX - 5, CY + 5]]
    with pytest.raises(EngineFailure, match="crosses itself"):
        _run(tmp_path, 0.5, plane, bow, name="b", base_kind="flat", base_z=50.0)


def test_patch_with_ground_on_one_side_only_warns_and_becomes_nodata(tmp_path):
    """Ruling (Task 8): a footprint whose ring has valid ground on one side only (fewer than 3
    quadrants / 8 ring cells) cannot be patched. It still becomes nodata, but must be reported
    with a `patch_failed` warning rather than silently disappearing into the nodata total."""
    footprint = box(CX - 1, CY - 1, CX + 1, CY + 1)

    def top(x, y):
        z = plane(x, y) + cone(x, y)
        # NaN everywhere in a 2 m ring around the footprint except the north-east quadrant, so
        # the footprint's own ring has ground on one side only.
        local = (np.abs(x - CX) < 2) & (np.abs(y - CY) < 2)
        keep = (x >= CX) & (y >= CY)
        return np.where(local & ~keep, np.nan, z)

    res = _run(tmp_path, 0.1, top, circle(CX, CY, 12.0), base_kind="toe_plane", footprints=[footprint])
    assert "patch_failed" in _codes(res)
    assert any(w["code"] == "patch_failed" and w["severity"] == "warn" for w in res["warnings"])
