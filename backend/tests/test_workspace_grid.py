"""The site tile grid (spec 2026-09-26-map-workspace section 6), pinned by M-C0's shared vectors,
which W1's siteGrid.ts reads too."""

import json
from pathlib import Path

import pytest
from affine import Affine

from app.workspace import grid

_VECTORS_PATH = Path(__file__).resolve().parents[2] / "contract" / "fixtures" / "site-grid-vectors.json"
VECTORS = json.loads(_VECTORS_PATH.read_text("utf-8"))


def test_tile_px():
    assert grid.TILE == VECTORS["tile_px"] == 256


@pytest.mark.parametrize("case", VECTORS["res"], ids=lambda c: f"z{c['z']}")
def test_res(case):
    assert grid.res(case["z"]) == case["res"]


@pytest.mark.parametrize("case", VECTORS["tiles"], ids=lambda c: f"{c['e']},{c['n']}@{c['z']}")
def test_point_to_tile(case):
    assert grid.tile_of(case["e"], case["n"], case["z"]) == (case["x"], case["y"])


@pytest.mark.parametrize("case", VECTORS["bounds"], ids=lambda c: f"{c['z']}/{c['x']}/{c['y']}")
def test_tile_to_bounds(case):
    want = (case["minx"], case["miny"], case["maxx"], case["maxy"])
    assert grid.tile_bounds(case["z"], case["x"], case["y"]) == want


@pytest.mark.parametrize("case", VECTORS["max_zoom"], ids=lambda c: str(c["native_m"]))
def test_max_zoom(case):
    assert grid.max_zoom_for(case["native_m"]) == case["max_zoom"]


@pytest.mark.parametrize("z,x,y", [(17, 1907, -12589), (3, -1, -1), (20, -3, 5), (0, 0, 0)])
def test_a_point_inside_a_tile_maps_back_to_it(z, x, y):
    minx, miny, maxx, maxy = grid.tile_bounds(z, x, y)
    assert grid.tile_of((minx + maxx) / 2, (miny + maxy) / 2, z) == (x, y)
    assert grid.tile_of(minx, maxy, z) == (x, y)  # the north-west corner belongs to the tile
    assert grid.tile_of(maxx, maxy, z) == (x + 1, y)  # the east edge belongs to the next column


def test_tile_transform_with_and_without_a_halo():
    r = grid.res(17)
    assert grid.tile_transform(17, 1907, -12589) == Affine(r, 0, 3814.0, 0, -r, 25178.0)
    assert grid.tile_transform(17, 1907, -12589, halo=1) == Affine(r, 0, 3814.0 - r, 0, -r, 25178.0 + r)


def test_out_of_range_zoom_and_resolution_are_refused():
    with pytest.raises(ValueError):
        grid.res(21)
    with pytest.raises(ValueError):
        grid.res(-1)
    with pytest.raises(ValueError):
        grid.max_zoom_for(0.0)
    with pytest.raises(ValueError):
        grid.max_zoom_for(float("nan"))


def test_bounds_never_carry_negative_zero():
    assert str(grid.tile_bounds(3, -1, -1)[1]) == "0.0"
    assert str(grid.tile_bounds(3, -1, -1)[2]) == "0.0"
