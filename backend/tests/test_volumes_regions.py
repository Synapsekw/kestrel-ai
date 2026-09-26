"""Clutter regions and ring patching (spec 2026-09-23-volumes §6.5)."""

import numpy as np
import pytest
import shapely
from rasterio.windows import Window
from shapely import affinity
from shapely.geometry import Point, Polygon, box
from surfaces import CX, CY, X0, Y1, circle, cone, fixture_spec, plane, write_surface

from app.surfaces.grid import open_surface
from app.volumes.regions import (
    MAX_PATCH_AREA_M2,
    PatchOutcome,
    cells_in,
    form_regions,
    lattice_window,
    paste,
    patch_part,
)

MEASURE = Polygon(circle(CX, CY, 12.0))


def _machine(dx=4.0, dy=2.0, angle=33.0, w=3.0, h=2.0) -> Polygon:
    return affinity.rotate(box(CX + dx - w / 2, CY + dy - h / 2, CX + dx + w / 2, CY + dy + h / 2), angle)


def test_lattice_window_is_not_clipped():
    spec = fixture_spec(0.5)
    w = lattice_window(spec, (X0 - 3, Y1 - 2, X0 + 1, Y1 + 1), pad=1)
    assert w.col_off < 0 and w.row_off < 0
    assert int(w.width) == 11 and int(w.height) == 9  # 9 x 7 cells meet the bounds, plus the pad


def test_overlapping_footprints_merge_and_far_ones_are_dropped():
    spec = fixture_spec(0.1)
    a, b = _machine(), _machine(dx=5.5)
    far = affinity.translate(_machine(), 40, 0)
    regions = form_regions([a, b, far], [], MEASURE, spec)
    assert len(regions.patch_parts) == 1 and regions.footprints_used == 2
    assert regions.patch_parts[0].area == pytest.approx(a.union(b).area)
    assert regions.too_large == [] and regions.exclude is None


def test_patch_over_400_m2_is_too_large_and_exclusions_are_kept_apart():
    spec = fixture_spec(0.1)
    big = [[CX - 11, CY - 11], [CX + 11, CY - 11], [CX + 11, CY + 11], [CX - 11, CY + 11]]
    corner = [[CX - 2, CY - 2], [CX, CY - 2], [CX, CY], [CX - 2, CY]]
    regions = form_regions([], [(big, "patch"), (corner, "exclude")], MEASURE, spec)
    assert regions.patch_parts == [] and len(regions.too_large) == 1
    assert regions.too_large[0].area > MAX_PATCH_AREA_M2
    assert regions.exclude.area == pytest.approx(4.0)
    assert regions.blocked.area == pytest.approx(22 * 22)


def test_patching_a_machine_on_the_cone_flank_restores_the_cone(tmp_path):
    spec = fixture_spec(0.1)
    machine = _machine()
    footprint = machine.buffer(0.5)

    def top_fn(xs, ys):
        z = plane(xs, ys) + cone(xs, ys)
        return np.where(shapely.contains_xy(machine, xs, ys), z + 2.5, z)

    write_surface(tmp_path / "s.tif", spec, top_fn)
    with open_surface(tmp_path / "s.tif") as top:
        out = patch_part(footprint, spec, lambda w: top.read(w, boundless=True), None)
    assert out.ok and out.rms_m < 0.2
    xs, ys = spec.cell_centres(out.window)
    truth = (plane(xs, ys) + cone(xs, ys))[out.cells]
    assert np.abs(out.values - truth).max() < 0.25  # the curved cone flank, interpolated across 4 m


def test_patch_fails_without_three_quadrants_or_eight_ring_cells(tmp_path):
    spec = fixture_spec(0.1)
    part = Point(CX, CY).buffer(1.0)

    def east_only(xs, ys):
        return np.where(xs > CX + 0.5, plane(xs, ys), np.nan)

    write_surface(tmp_path / "s.tif", spec, east_only)
    with open_surface(tmp_path / "s.tif") as top:
        out = patch_part(part, spec, lambda w: top.read(w, boundless=True), None)
        assert not out.ok and out.values is None
        blocked = Point(CX, CY).buffer(3.0).difference(part)
        write_surface(tmp_path / "p.tif", spec, plane)
    with open_surface(tmp_path / "p.tif") as flat:
        out = patch_part(part, spec, lambda w: flat.read(w, boundless=True), blocked)
    assert not out.ok  # every ring cell lies in another region


def test_paste_writes_only_the_overlap():
    spec = fixture_spec(0.1)
    part = box(CX - 0.5, CY - 0.5, CX + 0.5, CY + 0.5)
    win = lattice_window(spec, part.bounds, 2)
    cells = cells_in(part, spec, win, all_touched=True)
    ok = PatchOutcome(True, win, cells, np.full(int(cells.sum()), 7.0), 0.01, 1.0)
    target_win = Window(int(win.col_off) + 3, int(win.row_off), int(win.width), int(win.height))
    target = np.zeros((int(win.height), int(win.width)))
    patched = np.zeros(target.shape, bool)
    nodata = np.zeros(target.shape, bool)
    paste(ok, target, target_win, patched, nodata)
    assert patched.sum() == cells[:, 3:].sum() and (target[patched] == 7.0).all() and not nodata.any()
    bad = PatchOutcome(False, win, cells, None, 0.0, 1.0)
    paste(bad, target, target_win, patched, nodata)
    assert nodata.sum() == cells[:, 3:].sum()
