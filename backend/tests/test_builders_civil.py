"""Civil builders (plant model spec 2026-10-03 §6, unit B3): road, paved, laydown, parking, trench,
channel, basin, wall, fence, revetment, and the B3 footprint helpers in `builders/civil.py`."""

from __future__ import annotations

import math

import numpy as np
import pytest
from plant_b3_helpers import CTX, cowork, cowork_item, make_item
from shapely.geometry import Polygon

from app.asset_models.builders import civil
from app.asset_models.builders.palette import PALETTE
from app.asset_models.siteframe import footprint_polygon, footprint_ref

E0, N0 = 500.0, 300.0
RECT = {"kind": "rect", "center": [E0, N0], "size": [20.0, 10.0], "rot_deg": 0}  # 20 along north
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
ROAD = {"kind": "line", "pts": [[E0, N0], [E0 + 100, N0], [E0 + 100, N0 + 50]], "width": 8.0}
FENCE_30 = {"kind": "line", "pts": [[E0, N0], [E0 + 30, N0]], "width": 0.1}
FENCE_RING = {
    "kind": "line",
    "pts": [[E0, N0], [E0 + 10, N0], [E0 + 10, N0 + 20], [E0, N0 + 20], [E0, N0]],
    "width": 0.1,
}
CIVIL = ["road", "paved", "laydown", "parking", "trench", "channel", "basin", "wall", "fence", "revetment"]
B3_MATERIALS = {
    "Concrete",
    "Concrete_Dark",
    "Steel_Structure",
    "Steel_Dark",
    "Grating",
    "Building_Wall",
    "Building_Roof",
    "Shelter_Roof",
    "Glass",
    "Ground",
    "Asphalt",
    "Paving",
    "Laydown",
    "Rock_Armour",
    "Slope",
    "Water_Pit",
    "Sea",
    "Fence",
}
SAMPLE = {  # one representative item per civil type, for determinism and goldens
    "road": (ROAD, None, {"markings": True}),
    "paved": (L_POLY, None, {}),
    "laydown": (RECT, None, {}),
    "parking": ({"kind": "rect", "center": [E0, N0], "size": [60.0, 5.5], "rot_deg": 0}, None, {}),
    "trench": (
        {"kind": "line", "pts": [[E0, N0], [E0 + 20, N0], [E0 + 20, N0 + 10]], "width": 1.2},
        101.0,
        {},
    ),
    "channel": (
        {"kind": "line", "pts": [[E0, N0], [E0 + 10, N0], [E0 + 10, N0 - 18]], "width": 1.9},
        102.0,
        {},
    ),
    "basin": (L_POLY, 103.0, {}),
    "wall": ({"kind": "line", "pts": [[E0, N0], [E0 + 40, N0], [E0 + 40, N0 + 30]], "width": 0.7}, 103.0, {}),
    "fence": (FENCE_RING, 102.5, {}),
    "revetment": (
        {
            "kind": "polygon",
            "pts": [
                [E0, N0],
                [E0 + 80, N0],
                [E0 + 120, N0 + 20],
                [E0 + 120, N0 + 26],
                [E0 + 78, N0 + 6],
                [E0, N0 + 6],
            ],
        },
        None,
        {},
    ),
}


def sample(type_: str):
    fp, top, params = SAMPLE[type_]
    return make_item(type_, fp, top_el=top, params=params)


# ------------------------------------------------------------------ F0 interfaces B3 relies on
def test_f0_interfaces_b3_relies_on():
    item = make_item("paved", RECT)
    e, n = footprint_ref(item.footprint)
    assert (e, n) == pytest.approx((E0, N0))
    loc = np.asarray(CTX.local(item, np.array([E0 + 1.0]), np.array([N0 + 2.0]))).reshape(-1, 2)
    assert loc[0] == pytest.approx([2.0, 1.0])  # x = north, z = east
    ring = np.asarray(footprint_polygon(item.footprint))
    assert ring.shape == (4, 2)
    base, top, defaulted = CTX.height(make_item("wall", RECT, top_el=None), 3.0)
    assert (base, top, defaulted) == (100.0, 103.0, True)
    assert B3_MATERIALS <= set(PALETTE)


def test_cowork_fixture_footprints_are_valid():
    nodes = cowork()["nodes"]
    assert len(nodes) == 266
    for node in nodes:
        poly = footprint_polygon(cowork_item(node).footprint)
        assert np.isfinite(np.asarray(poly)).all()
        assert not math.isnan(node["base_el"])


# ------------------------------------------------------------------ helpers
def test_clean_line_drops_repeated_points():
    pts = civil.clean_line(np.array([[0, 0], [0, 0], [10, 0], [10, 0.0005], [20, 0]]))
    assert pts.tolist() == [[0, 0], [10, 0], [20, 0]]


def test_clean_line_rejects_non_finite():
    with pytest.raises(ValueError, match="non-finite"):
        civil.clean_line(np.array([[0, 0], [np.nan, 1]]))


def test_stations_open_closed_lod_and_cap():
    line = np.array([[0.0, 0.0], [30.0, 0.0]])
    assert len(civil.stations(line, 3.0, 1.0)) == 11  # both ends
    ring = np.array([[0.0, 0.0], [10.0, 0.0], [10.0, 20.0], [0.0, 20.0], [0.0, 0.0]])
    assert len(civil.stations(ring, 3.0, 1.0)) == 4 + 7 + 4 + 7  # closing corner not doubled
    assert len(civil.stations(line, 3.0, 0.5)) == 6  # half the detail: 6 m spacing
    long = np.array([[0.0, 0.0], [100_000.0, 0.0]])
    assert len(civil.stations(long, 3.0, 1.0)) <= civil.MAX_INSTANCES + 1


def test_yaw_turns_x_onto_the_plan_direction():
    d = np.array([3.0, 4.0]) / 5.0
    v = civil.yaw(d[0], d[1]) @ np.array([1.0, 0.0, 0.0, 1.0])
    assert v[[0, 2]] == pytest.approx(d)
    assert v[1] == pytest.approx(0.0)


def test_prism_of_a_concave_outline_is_closed_and_exact():
    poly = Polygon([(0, 0), (10, 0), (10, 30), (0, 30), (0, 20), (5, 20), (5, 10), (0, 10)])  # notch
    m = civil.prism(civil.largest_polygon(poly), 1.0, 4.0)
    assert m.is_watertight
    assert m.volume == pytest.approx(poly.area * 3.0)
    assert m.bounds[:, 1].tolist() == pytest.approx([1.0, 4.0])


def test_surface_faces_up_and_covers_the_area():
    poly = civil.largest_polygon(Polygon([(0, 0), (10, 0), (10, 10), (5, 4), (0, 10)]))
    m = civil.surface(poly, 2.0)
    assert (m.face_normals[:, 1] > 0.99).all()
    assert m.area == pytest.approx(poly.area)


def test_largest_polygon_repairs_a_bow_tie():
    poly = civil.largest_polygon(Polygon([(0, 0), (10, 10), (10, 0), (0, 10)]))
    assert poly.is_valid and poly.area == pytest.approx(25.0)


def test_bar_spans_its_segment_and_heights():
    m = civil.bar([0.0, 0.0], [3.0, 4.0], 1.0, 2.0, 0.1)
    assert m.is_watertight
    assert m.volume == pytest.approx(5.0 * 1.0 * 0.1)
    assert m.bounds[:, 1].tolist() == pytest.approx([1.0, 2.0])


def test_outline_of_a_line_is_buffered_by_its_width_with_flat_ends():
    poly = civil.outline(
        make_item("road", {"kind": "line", "pts": [[E0, N0], [E0 + 10, N0]], "width": 4.0}), CTX
    )
    assert poly.area == pytest.approx(40.0)
    assert poly.bounds == pytest.approx((-2.0, -5.0, 2.0, 5.0))  # (x=N, z=E) around the line's centroid


def test_largest_polygon_repairs_a_bow_tie_with_a_spike():
    # make_valid gives GeometryCollection[MultiPolygon, LineString]: the polygons are one level down
    poly = civil.largest_polygon(Polygon([(0, 0), (10, 10), (10, 0), (0, 10), (0, 5), (-5, 5), (0, 5)]))
    assert poly.is_valid and poly.area == pytest.approx(25.0)
