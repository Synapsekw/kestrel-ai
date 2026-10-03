"""The plant grid against the KIPIC register (spec 2026-10-03-plant-model-generator §5, §15; plan
pm-f0 Task 3). The golden file is contract/fixtures/plant-grid-vectors.json; S1's vitest reads it too."""

import csv
import json
import math
from pathlib import Path

import numpy as np
import pytest

from app.asset_models.siteframe import (
    CIRCLE_SEGMENTS,
    GridError,
    PlantGrid,
    fit_plant_grid,
    footprint_polygon,
    footprint_ref,
)
from app.asset_models.spec import (
    CircleFootprint,
    LineFootprint,
    PolygonFootprint,
    RectFootprint,
    SiteFrame,
)

ROOT = Path(__file__).resolve().parents[2]
REGISTER = Path(__file__).parent / "data" / "plant" / "kipic_register.csv"
VECTORS = ROOT / "contract" / "fixtures" / "plant-grid-vectors.json"
TOL_M = 0.05


def _frame(**over) -> SiteFrame:
    raw = {**json.loads(VECTORS.read_text("utf-8"))["frame"], "source": {"kind": "assumed"}, **over}
    return SiteFrame.model_validate(raw)


@pytest.fixture(scope="module")
def grid() -> PlantGrid:
    return PlantGrid(_frame())


@pytest.fixture(scope="module")
def register() -> list[dict]:
    with REGISTER.open(encoding="utf-8", newline="") as f:
        return [r for r in csv.DictReader(f) if r["plant_E"]]


def _cols(rows, *names):
    return [np.array([float(r[n]) for r in rows]) for n in names]


def test_every_register_row_maps_to_its_utm_columns(grid, register):
    assert len(register) == 878
    e, n, x, y = _cols(register, "plant_E", "plant_N", "utm39_E", "utm39_N")
    sx, sy = grid.plant_to_site(e, n)
    err = np.hypot(sx - x, sy - y)
    assert err.max() < TOL_M, (float(err.max()), register[int(err.argmax())]["node"])
    assert np.abs(sx - x).max() <= 0.011 and np.abs(sy - y).max() <= 0.011  # Cowork rounded to 1 cm


def test_the_golden_vectors_are_register_rows_and_hold(grid, register):
    doc = json.loads(VECTORS.read_text("utf-8"))
    assert (
        doc["frame"]["origin_crs"] == [244338.089, 3179515.69] and doc["frame"]["plant_north_deg"] == 17.9991
    )
    assert len(doc["rows"]) == 50
    by_node = {r["node"]: r for r in register}
    for v in doc["rows"]:
        r = by_node[v["node"]]
        assert (v["plant_E"], v["plant_N"]) == (float(r["plant_E"]), float(r["plant_N"]))
        assert (v["site_X"], v["site_Y"]) == (float(r["utm39_E"]), float(r["utm39_N"]))
        sx, sy = grid.plant_to_site(v["plant_E"], v["plant_N"])
        assert math.hypot(float(sx) - v["site_X"], float(sy) - v["site_Y"]) < TOL_M
    for v in doc["scene"]:
        assert grid.plant_to_scene(v["plant_E"], v["plant_N"], v["el"]).tolist() == pytest.approx(
            [v["x"], v["y"], v["z"]]
        )


def test_site_to_plant_inverts_plant_to_site(grid, register):
    e, n = _cols(register, "plant_E", "plant_N")
    back = grid.site_to_plant(*grid.plant_to_site(e, n))
    assert np.abs(back[0] - e).max() < 1e-6 and np.abs(back[1] - n).max() < 1e-6


def test_the_scene_frame_is_north_up_east(grid):
    xyz = grid.plant_to_scene([1300.0, 0.0], [450.0, 10.0], [104.5, 100.0])
    assert xyz.tolist() == [[450.0, 4.5, 1300.0], [10.0, 0.0, 0.0]]
    e, n, el = grid.scene_to_plant(xyz)
    assert (e.tolist(), n.tolist(), el.tolist()) == ([1300.0, 0.0], [450.0, 10.0], [104.5, 100.0])


def test_the_fit_recovers_the_frame_from_three_rows_and_from_all(register):
    e, n, x, y = _cols(register, "plant_E", "plant_N", "utm39_E", "utm39_N")
    pairs = [((e[i], n[i]), (x[i], y[i])) for i in range(len(e))]
    origin, deg, rms = fit_plant_grid([pairs[0], pairs[400], pairs[800]])
    assert math.hypot(origin[0] - 244338.089, origin[1] - 3179515.690) < TOL_M
    assert deg == pytest.approx(17.9991, abs=1e-3) and rms < 0.01
    origin, deg, rms = fit_plant_grid(pairs)
    assert math.hypot(origin[0] - 244338.089, origin[1] - 3179515.690) < 0.01
    assert deg == pytest.approx(17.9991, abs=1e-4) and rms < 0.01


def test_the_fit_needs_two_distinct_finite_points():
    with pytest.raises(GridError):
        fit_plant_grid([((0, 0), (1, 1))])
    with pytest.raises(GridError):
        fit_plant_grid([((5, 5), (1, 1)), ((5, 5), (2, 2))])
    with pytest.raises(GridError):
        fit_plant_grid([((0, 0), (1, 1)), ((1, math.nan), (2, 2))])


def test_lonlat_and_grid_convergence_at_the_kipic_origin(grid):
    lon, lat = grid.site_to_lonlat(244338.089, 3179515.690)
    assert (float(lon), float(lat)) == pytest.approx((48.382707, 28.717689), abs=1e-5)
    # West of UTM 39's central meridian grid north points west of true north, so plant north's true
    # bearing is 17.9991 - 1.2583 (spec §9: plant_north_deg + convergence).
    assert grid.convergence_deg() == pytest.approx(-1.2583, abs=1e-3)


def test_a_frame_without_a_crs_has_no_lonlat():
    grid = PlantGrid(_frame(crs={"epsg": None, "wkt": None}))
    assert grid.plant_to_site(0, 0)[0] == pytest.approx(244338.089)  # the grid itself still works
    with pytest.raises(GridError):
        grid.site_to_lonlat(0, 0)
    with pytest.raises(GridError):
        PlantGrid(_frame(crs={"wkt": "not a crs"})).convergence_deg()


def test_rect_outline_turns_clockwise_from_north():
    north = footprint_polygon(RectFootprint(kind="rect", center=[0, 0], size=[10, 4]))
    assert north.tolist() == [[-2, -5], [2, -5], [2, 5], [-2, 5]]  # along = 10 runs north
    east = footprint_polygon(RectFootprint(kind="rect", center=[0, 0], size=[10, 4], rot_deg=90))
    assert np.allclose(east, [[-5, 2], [-5, -2], [5, -2], [5, 2]])  # along turned to run east
    assert footprint_ref(RectFootprint(kind="rect", center=[3, 4], size=[1, 1])) == (3.0, 4.0)


def test_circle_polygon_and_line_outlines():
    ring = footprint_polygon(CircleFootprint(kind="circle", center=[10, 20], d=8))
    assert len(ring) == CIRCLE_SEGMENTS
    assert np.allclose(np.hypot(ring[:, 0] - 10, ring[:, 1] - 20), 4)
    cw_closed = PolygonFootprint(kind="polygon", pts=[[0, 0], [0, 4], [4, 4], [4, 0], [0, 0]])
    poly = footprint_polygon(cw_closed)
    assert len(poly) == 4 and poly.tolist() == [[4, 0], [4, 4], [0, 4], [0, 0]]  # CCW, not repeated
    line = LineFootprint(kind="line", pts=[[0, 0], [10, 0], [10, 10]], width=2)
    outline = footprint_polygon(line)
    x, y = outline[:, 0], outline[:, 1]
    area = 0.5 * float(np.dot(x, np.roll(y, -1)) - np.dot(np.roll(x, -1), y))
    assert area == pytest.approx(40.0)  # 20 m of 2 m wide line, mitred corner
    with pytest.raises(ValueError):
        footprint_polygon(LineFootprint(kind="line", pts=[[1, 1], [1, 1]], width=2))


def test_reference_points_weigh_area_and_length():
    l_shape = PolygonFootprint(kind="polygon", pts=[[0, 0], [4, 0], [4, 1], [1, 1], [1, 4], [0, 4]])
    assert footprint_ref(l_shape) == pytest.approx((19 / 14, 19 / 14))
    line = LineFootprint(kind="line", pts=[[0, 0], [10, 0], [10, 10]], width=2)
    assert footprint_ref(line) == pytest.approx((7.5, 2.5))
    flat = PolygonFootprint(kind="polygon", pts=[[0, 0], [1, 0], [2, 0]])
    assert footprint_ref(flat) == pytest.approx((1.0, 0.0))  # no area: the mean
