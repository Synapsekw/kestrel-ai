"""Building builders (plant model spec 2026-10-03 §6, unit B3): building, substation,
analyzer_house, shelter, gate."""

from __future__ import annotations

import numpy as np
import pytest
from plant_b3_helpers import (
    CTX,
    assert_golden,
    bounds,
    build_ok,
    by_name,
    make_item,
    materials,
    same_geometry,
    tri_count,
)
from shapely.geometry import Point

from app.asset_models.builders.base import REGISTRY, BuildCtx, Instanced, build_item
from app.asset_models.builders.civil import MAX_INSTANCES, outline

E0, N0 = 500.0, 300.0
RECT = {"kind": "rect", "center": [E0, N0], "size": [30.0, 20.0], "rot_deg": 0}  # 30 along north, 20 east
L_POLY = {
    "kind": "polygon",
    "pts": [
        [E0, N0],
        [E0 + 30, N0],
        [E0 + 30, N0 + 10],
        [E0 + 10, N0 + 10],
        [E0 + 10, N0 + 25],
        [E0, N0 + 25],
    ],
}  # concave, area 450
TYPES = ["building", "substation", "analyzer_house", "shelter", "gate"]
SAMPLE = {
    "building": (L_POLY, 109.0, {}),
    "substation": (RECT, 109.0, {}),
    "analyzer_house": ({"kind": "rect", "center": [E0, N0], "size": [6.0, 5.0], "rot_deg": 20}, 103.5, {}),
    "shelter": ({"kind": "rect", "center": [E0, N0], "size": [13.4, 6.6], "rot_deg": 0}, 105.0, {}),
    "gate": ({"kind": "line", "pts": [[E0, N0], [E0 + 13.5, N0 + 1.4]], "width": 0.3}, 102.5, {}),
}


def sample(type_: str):
    fp, top, params = SAMPLE[type_]
    return make_item(type_, fp, top_el=top, params=params)


# ------------------------------------------------------------------ houses
def test_building_walls_roof_parapet_glazing_and_door():
    nodes = by_name(build_ok(make_item("building", RECT, top_el=109.0)))
    assert set(nodes) == {"walls", "roof", "glazing", "doors"}
    assert nodes["walls"].geometry.is_watertight
    assert nodes["walls"].geometry.volume == pytest.approx(600 * (9.0 - 0.6 - 0.3))
    assert bounds(list(nodes.values()))[:, 1].tolist() == pytest.approx([0.0, 9.0])
    assert nodes["roof"].geometry.bounds[:, 1].tolist() == pytest.approx([8.1, 9.0])  # slab + parapet
    assert len(nodes["glazing"].geometry.faces) == 4 * 2 * 12  # 4 walls x 2 storeys, one box each
    door = nodes["doors"].geometry.bounds
    assert abs(abs(door[:, 2].mean()) - 10.0) < 0.1  # on a 30 m (north-running) wall, 10 m east/west
    assert materials(list(nodes.values())) == {"Building_Wall", "Building_Roof", "Glass", "Steel_Dark"}


def test_concave_building_keeps_its_notch():
    nodes = by_name(build_ok(make_item("building", L_POLY, top_el=106.0)))
    assert nodes["walls"].geometry.volume == pytest.approx(450 * (6.0 - 0.9))


def test_substation_sits_on_a_plinth_without_glazing():
    nodes = by_name(build_ok(sample("substation")))
    assert set(nodes) == {"plinth", "walls", "roof", "doors"}
    assert nodes["plinth"].material == "Concrete"
    assert nodes["plinth"].geometry.bounds[:, 1].tolist() == pytest.approx([0.0, 1.5])
    assert nodes["walls"].geometry.bounds[0, 1] == pytest.approx(1.5)


def test_analyzer_house_roof_overhangs_and_has_no_parapet():
    item = make_item(
        "analyzer_house", {"kind": "rect", "center": [E0, N0], "size": [6.0, 5.0], "rot_deg": 0}, top_el=103.5
    )
    nodes = by_name(build_ok(item))
    walls, roof = nodes["walls"].geometry.bounds, nodes["roof"].geometry.bounds
    assert roof[1, 1] == pytest.approx(3.5)
    assert (walls[0, [0, 2]] - roof[0, [0, 2]]).tolist() == pytest.approx([0.3, 0.3])
    assert "glazing" not in nodes
    assert nodes["hvac"].material == "Equipment_Grey"


def test_a_low_building_shrinks_its_roof_stack_instead_of_failing():
    nodes = build_ok(make_item("building", RECT, top_el=101.0))
    b = bounds(nodes)
    assert b[:, 1].tolist() == pytest.approx([0.0, 1.0])
    walls = by_name(nodes)["walls"].geometry.bounds
    assert walls[1, 1] - walls[0, 1] == pytest.approx(0.5)


def test_square_analyzer_house_keeps_hvac_off_the_door_wall():
    item = make_item(
        "analyzer_house", {"kind": "rect", "center": [E0, N0], "size": [3.0, 3.0], "rot_deg": 0}, top_el=103.5
    )
    nodes = by_name(build_ok(item))
    door, hvac = nodes["doors"].geometry.bounds, nodes["hvac"].geometry.bounds
    overlap = np.minimum(door[1], hvac[1]) - np.maximum(door[0], hvac[0])
    assert (overlap <= 1e-9).any()  # the boxes are disjoint along at least one axis


def test_low_lod_drops_glazing():
    nodes = by_name(build_ok(make_item("building", RECT, top_el=109.0), BuildCtx(grid=None, lod=0.4)))
    assert "glazing" not in nodes


def test_rotated_building_stays_on_its_footprint():
    item = make_item(
        "building", {"kind": "rect", "center": [E0, N0], "size": [30.0, 20.0], "rot_deg": 30}, top_el=106.0
    )
    walls = by_name(build_ok(item))["walls"].geometry
    assert walls.volume == pytest.approx(600 * 5.1)
    half = np.abs(walls.vertices[:, [0, 2]]).max(axis=0)
    assert half.max() > 15.0  # a 30 m wall at 30 degrees spans more than its half-length on an axis


def test_house_defaults_are_recorded():
    nodes = build_ok(make_item("building", RECT, top_el=None, params={"doors": 2}))
    rec = nodes[0].extras["defaults"]
    assert "doors" not in rec and "parapet_h" in rec and rec[-1] == "height"


@pytest.mark.parametrize("type_", ["building", "substation", "analyzer_house"])
def test_house_goldens(type_):
    assert_golden(build_ok(sample(type_)), type_)


def test_house_types_are_registered():
    for t in ("building", "substation", "analyzer_house"):
        assert REGISTRY[t].family == "building"
    assert REGISTRY["substation"].default_height_m == 9.0


# ------------------------------------------------------------------ shelter
def test_shelter_column_grid_is_instanced():
    nodes = by_name(build_ok(sample("shelter")))
    cols = nodes["columns"].geometry
    assert isinstance(cols, Instanced) and len(cols.transforms) == 4 * 3
    assert materials(list(nodes.values())) == {"Concrete", "Steel_Structure", "Shelter_Roof"}
    assert bounds(list(nodes.values()))[:, 1].tolist() == pytest.approx([0.0, 5.0])
    assert nodes["roof"].geometry.bounds[0, 1] == pytest.approx(5.0 - 0.35)


def test_shelter_on_a_concave_footprint_keeps_columns_inside():
    nodes = by_name(build_ok(make_item("shelter", L_POLY, top_el=106.0)))
    xf = nodes["columns"].geometry.transforms
    poly = outline(make_item("shelter", L_POLY), CTX).buffer(1e-6)
    assert len(xf) > 0
    assert all(poly.contains(Point(t[0, 3], t[2, 3])) for t in xf)


@pytest.mark.parametrize("d", [3.0, 2.0])
def test_a_small_round_shelter_still_has_a_column(d):
    fp = {"kind": "circle", "center": [E0, N0], "d": d}
    nodes = by_name(build_ok(make_item("shelter", fp, top_el=105.0)))
    xf = nodes["columns"].geometry.transforms
    poly = outline(make_item("shelter", fp), CTX).buffer(1e-6)
    assert len(xf) > 0
    assert all(poly.contains(Point(t[0, 3], t[2, 3])) for t in xf)


def test_too_low_shelter_falls_back():
    _, flags = build_item(make_item("shelter", RECT, top_el=100.8), BuildCtx(grid=None))
    assert [f.code for f in flags] == ["builder_fallback"]


def test_shelter_narrower_than_its_columns_falls_back():
    fp = {"kind": "rect", "center": [E0, N0], "size": [6.0, 0.4], "rot_deg": 0}
    _, flags = build_item(make_item("shelter", fp, top_el=105.0), BuildCtx(grid=None))
    assert [f.code for f in flags] == ["builder_fallback"]


def test_a_huge_shelter_caps_its_columns():
    fp = {"kind": "rect", "center": [E0, N0], "size": [2000.0, 2000.0], "rot_deg": 0}
    nodes = by_name(build_ok(make_item("shelter", fp, top_el=106.0, params={"bay": 2.0})))
    assert 0 < len(nodes["columns"].geometry.transforms) <= MAX_INSTANCES


# ------------------------------------------------------------------ gate
def test_gate_has_posts_two_leaves_and_pickets():
    nodes = by_name(build_ok(sample("gate")))
    assert len(nodes["posts"].geometry.transforms) == 2
    assert len(nodes["pickets"].geometry.transforms) == 2 * 13
    assert materials(list(nodes.values())) == {"Steel_Dark"}
    assert bounds(list(nodes.values()))[1, 1] == pytest.approx(2.6)  # posts stand 0.1 m proud


def test_a_gate_shorter_than_its_posts_falls_back():
    item = make_item("gate", {"kind": "line", "pts": [[E0, N0], [E0 + 0.3, N0]], "width": 0.3})
    _, flags = build_item(item, BuildCtx(grid=None))
    assert [f.code for f in flags] == ["builder_fallback"]


@pytest.mark.parametrize(
    ("length", "params"),
    [
        (0.13, {"post": 0.06}),  # longer than two posts, but no room for a leaf's two stiles
        (0.40, {}),
        (0.41, {}),
        (0.42, {}),
        (0.6, {"leaf_max": 0.55}),  # split in two leaves, each too short
    ],
)
def test_a_gate_too_short_for_its_leaves_falls_back(length, params):
    item = make_item(
        "gate",
        {"kind": "line", "pts": [[E0, N0], [E0 + length, N0]], "width": 0.3},
        top_el=102.5,
        params=params,
    )
    _, flags = build_item(item, BuildCtx(grid=None))
    assert [f.code for f in flags] == ["builder_fallback"]


def test_a_short_gate_keeps_its_leaf_between_the_posts():
    item = make_item("gate", {"kind": "line", "pts": [[E0, N0], [E0 + 0.45, N0]], "width": 0.3}, top_el=102.5)
    nodes = by_name(build_ok(item))
    a, b = nodes["posts"].geometry.transforms[:, [0, 2], 3]
    d = (b - a) / np.hypot(*(b - a))
    s = (nodes["frame"].geometry.vertices[:, [0, 2]] - a) @ d  # distance along the gate line
    assert s.min() >= 0.1 - 1e-9 and s.max() <= 0.45 - 0.1 + 1e-9  # clear of both posts' faces


def test_a_very_long_gate_caps_its_pickets():
    item = make_item(
        "gate",
        {"kind": "line", "pts": [[E0, N0], [E0 + 10000.0, N0]], "width": 0.3},
        top_el=102.5,
        params={"picket_spacing": 0.1},
    )
    nodes = by_name(build_ok(item))
    assert 0 < len(nodes["pickets"].geometry.transforms) <= MAX_INSTANCES


def test_a_corner_of_a_gate_line_gets_one_post():
    zig = [[E0, N0], [E0 + 5.0, N0 + 5.0], [E0 + 10.0, N0]]
    nodes = by_name(build_ok(make_item("gate", {"kind": "line", "pts": zig, "width": 0.3}, top_el=102.5)))
    assert len(nodes["posts"].geometry.transforms) == 3


def test_a_rect_gate_spans_its_footprint():
    fp = {"kind": "rect", "center": [E0, N0], "size": [0.3, 6.0], "rot_deg": 0}
    nodes = by_name(build_ok(make_item("gate", fp, top_el=102.5)))
    xf = nodes["posts"].geometry.transforms
    assert len(xf) == 2
    span = np.hypot(*(xf[0, [0, 2], 3] - xf[1, [0, 2], 3]))
    assert span == pytest.approx(6.0)
    mid = (xf[0, [0, 2], 3] + xf[1, [0, 2], 3]) / 2
    poly = outline(make_item("gate", fp), CTX)
    assert poly.contains(Point(*mid))


# ------------------------------------------------------------------ all building-family types
def test_types_are_registered_in_the_building_family():
    for t in TYPES:
        assert REGISTRY[t].family == "building"


@pytest.mark.parametrize("type_", TYPES)
def test_builds_are_deterministic(type_):
    assert same_geometry(build_ok(sample(type_)), build_ok(sample(type_)))


@pytest.mark.parametrize(
    ("type_", "lo", "hi"),
    [
        ("building", 150, 600),
        ("substation", 60, 300),
        ("analyzer_house", 40, 200),
        ("shelter", 150, 800),
        ("gate", 200, 800),
    ],
)
def test_triangle_ranges(type_, lo, hi):
    assert lo <= tri_count(build_ok(sample(type_))) <= hi


@pytest.mark.parametrize("type_", ["shelter", "gate"])
def test_shelter_gate_goldens(type_):
    assert_golden(build_ok(sample(type_)), type_)
