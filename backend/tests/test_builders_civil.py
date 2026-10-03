"""Civil builders (plant model spec 2026-10-03 §6, unit B3): road, paved, laydown, parking, trench,
channel, basin, wall, fence, revetment, and the B3 footprint helpers in `builders/civil.py`."""

from __future__ import annotations

import math

import numpy as np
import pytest
from plant_b3_helpers import (
    CTX,
    assert_golden,
    bounds,
    build_ok,
    by_name,
    cowork,
    cowork_item,
    make_item,
    materials,
    tri_count,
)
from shapely.geometry import Point, Polygon

from app.asset_models.builders import civil
from app.asset_models.builders.base import BuildCtx, Instanced
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


# ------------------------------------------------------------------ flat surfaces
def test_road_is_a_slab_along_its_centreline():
    nodes = build_ok(make_item("road", ROAD))
    assert [n.name for n in nodes] == ["surface"]
    b = bounds(nodes)
    assert b[:, 1].tolist() == pytest.approx([civil.LIFT["Asphalt"] - civil.SLAB_T, civil.LIFT["Asphalt"]])
    # north: 50 + half width below the mitred corner; east: 100 + half width past the corner
    assert b[1, 0] - b[0, 0] == pytest.approx(54.0, abs=0.01)
    assert b[1, 2] - b[0, 2] == pytest.approx(104.0, abs=0.01)
    assert 12 <= tri_count(nodes) <= 60
    assert nodes[0].material == "Asphalt"


def test_road_markings_are_instanced_dashes():
    nodes = by_name(build_ok(make_item("road", ROAD, params={"markings": True})))
    dashes = nodes["markings"].geometry
    assert isinstance(dashes, Instanced)
    assert len(dashes.transforms) == 11 + 6  # 3 m dash every 9 m on the 100 m and 50 m legs
    assert nodes["markings"].material == "Paving"


@pytest.mark.parametrize(
    ("type_", "material"), [("paved", "Paving"), ("laydown", "Laydown"), ("revetment", "Rock_Armour")]
)
def test_flat_surfaces_cover_a_concave_footprint(type_, material):
    nodes = build_ok(make_item(type_, L_POLY))
    (node,) = nodes
    assert node.material == material
    top = civil.LIFT[material]
    up = node.geometry.face_normals[:, 1] > 0.99
    tops = node.geometry.triangles[up][:, :, 1]
    assert np.allclose(tops, top)
    assert node.geometry.area_faces[up].sum() == pytest.approx(450.0)  # notch not filled


def test_parking_has_stall_lines_along_its_long_side():
    nodes = by_name(build_ok(sample("parking")))
    stalls = nodes["stalls"].geometry
    assert isinstance(stalls, Instanced) and len(stalls.transforms) == 25  # 60 m / 2.5 m + 1
    deep = make_item("parking", {"kind": "rect", "center": [E0, N0], "size": [60.0, 20.0], "rot_deg": 0})
    assert len(by_name(build_ok(deep))["stalls"].geometry.transforms) == 50  # two rows
    plain = by_name(build_ok(make_item("parking", RECT, params={"markings": False})))
    assert set(plain) == {"surface"}


@pytest.mark.parametrize("type_", ["road", "paved", "laydown", "parking", "revetment"])
def test_flat_goldens(type_):
    assert_golden(build_ok(sample(type_)), type_)


def test_parking_stalls_are_capped_at_max_instances():
    huge = make_item("parking", {"kind": "rect", "center": [E0, N0], "size": [30_000.0, 40.0], "rot_deg": 0})
    stalls = by_name(build_ok(huge))["stalls"].geometry
    assert 0 < len(stalls.transforms) <= civil.MAX_INSTANCES


def test_parking_stalls_stay_inside_a_concave_lot():
    # a 60 x 10 leg plus a 10 x 30 leg: the min rotated rect covers a big empty corner
    lot = {
        "kind": "polygon",
        "pts": [
            [E0, N0],
            [E0 + 60, N0],
            [E0 + 60, N0 + 10],
            [E0 + 10, N0 + 10],
            [E0 + 10, N0 + 40],
            [E0, N0 + 40],
        ],
    }
    item = make_item("parking", lot)
    poly = civil.outline(item, CTX).buffer(0.05)
    stalls = by_name(build_ok(item))["stalls"].geometry
    centres = stalls.transforms[:, [0, 2], 3]
    assert len(centres) > 0
    assert all(poly.contains(Point(x, z)) for x, z in centres)


# ------------------------------------------------------------------ walls and fences
def test_wall_has_height_thickness_and_coping():
    item = make_item("wall", {"kind": "line", "pts": [[E0, N0], [E0 + 40, N0]], "width": 0.7}, top_el=103.0)
    nodes = by_name(build_ok(item))
    assert nodes["wall"].geometry.is_watertight
    assert nodes["wall"].geometry.volume == pytest.approx(40 * 0.7 * 2.9, rel=1e-6)
    assert bounds(list(nodes.values()))[:, 1].tolist() == pytest.approx([0.0, 3.0])
    assert nodes["coping"].material == "Concrete_Dark"


def test_fence_posts_are_instanced_along_the_line():
    nodes = by_name(build_ok(make_item("fence", FENCE_30, top_el=102.5)))
    posts = nodes["posts"].geometry
    assert isinstance(posts, Instanced) and len(posts.transforms) == 11
    assert materials(list(nodes.values())) == {"Steel_Dark", "Fence"}
    assert bounds(list(nodes.values()))[:, 1].tolist() == pytest.approx([0.0, 2.5])


def test_closed_fence_ring_does_not_double_the_corner_post():
    nodes = by_name(build_ok(make_item("fence", FENCE_RING)))
    xf = nodes["posts"].geometry.transforms
    assert len(xf) == 4 + 7 + 4 + 7
    xz = np.round(xf[:, [0, 2], 3], 6)
    assert len({tuple(p) for p in xz}) == len(xz)


def test_fence_with_repeated_points_builds_without_nan():
    fp = {
        "kind": "line",
        "pts": [[E0, N0], [E0, N0], [E0 + 15, N0], [E0 + 15, N0], [E0 + 30, N0]],
        "width": 0.1,
    }
    nodes = by_name(build_ok(make_item("fence", fp)))
    xf = nodes["posts"].geometry.transforms
    assert np.isfinite(xf).all() and len(xf) == 11


def test_fence_lod_halves_the_posts():
    nodes = by_name(build_ok(make_item("fence", FENCE_30), BuildCtx(grid=None, lod=0.5)))
    assert len(nodes["posts"].geometry.transforms) == 6


def test_fence_around_a_polygon_footprint_follows_its_outline():
    nodes = by_name(build_ok(make_item("fence", RECT)))
    assert len(nodes["posts"].geometry.transforms) == 4 + 7 + 4 + 7


def test_very_long_fence_posts_stay_within_max_instances():
    # one straight 100 km run (stations alone gives MAX_INSTANCES + 1: both ends), and a
    # 500-vertex zigzag of ~1 km legs where every leg's ceil() adds a post over the cap
    straight = {"kind": "line", "pts": [[E0, N0], [E0 + 100_000, N0]], "width": 0.1}
    zigzag = {"kind": "line", "pts": [[E0 + 1000 * i, N0 + 5 * (i % 2)] for i in range(500)], "width": 0.1}
    for fp in (straight, zigzag):
        xf = by_name(build_ok(make_item("fence", fp)))["posts"].geometry.transforms
        assert 0 < len(xf) <= civil.MAX_INSTANCES
        assert np.isfinite(xf).all()


@pytest.mark.parametrize("type_", ["wall", "fence"])
def test_wall_fence_goldens(type_):
    assert_golden(build_ok(sample(type_)), type_)
