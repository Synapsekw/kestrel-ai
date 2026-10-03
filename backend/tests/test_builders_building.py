"""Building builders (plant model spec 2026-10-03 §6, unit B3): building, substation,
analyzer_house, shelter, gate."""

from __future__ import annotations

import numpy as np
import pytest
from plant_b3_helpers import (
    assert_golden,
    bounds,
    build_ok,
    by_name,
    make_item,
    materials,
)

from app.asset_models.builders.base import REGISTRY, BuildCtx

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
