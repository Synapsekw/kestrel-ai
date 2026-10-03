"""Equipment builders (unit B2, plan docs/superpowers/plans/2026-10-03-plant-model-b2.md)."""

from __future__ import annotations

import functools
import inspect
import json
import math
import os
from dataclasses import dataclass, field
from pathlib import Path

import numpy as np
import pytest
import trimesh
from PIL import Image
from pydantic import BaseModel
from shapely.geometry import Polygon

from app.asset_models.builders import geom
from app.asset_models.builders.base import (
    REGISTRY,
    BuildCtx,
    Instanced,
    MeshNode,
    build_item,
    builder,
    load_all,
)
from app.asset_models.builders.palette import PALETTE
from app.asset_models.raster import View, render
from app.asset_models.siteframe import footprint_polygon, footprint_ref
from app.asset_models.spec import Item

C = (1000.0, 500.0)  # plant [E, N] of every test item's reference point


def make_item(
    type_: str, footprint: dict, *, h: float | None = None, base: float = 100.0, params: dict | None = None
) -> Item:
    return Item.model_validate(
        {
            "id": f"t-{type_}",
            "name": type_,
            "type": type_,
            "footprint": footprint,
            "base_el": base,
            "top_el": None if h is None else base + h,
            "params": params or {},
            "source": {"kind": "assumed"},
        }
    )


def circle(d: float) -> dict:
    return {"kind": "circle", "center": list(C), "d": d}


def rect(along: float, across: float, rot: float = 0.0) -> dict:
    return {"kind": "rect", "center": list(C), "size": [along, across], "rot_deg": rot}


def poly(pts) -> dict:
    return {"kind": "polygon", "pts": [list(p) for p in pts]}


def test_f0_interfaces_b2_relies_on():
    # the decorator B2 registers with
    assert list(inspect.signature(builder).parameters) == [
        "type",
        "family",
        "params",
        "doc",
        "default_height_m",
    ]
    # segments_for: an int that grows with the radius
    assert isinstance(geom.segments_for(1.0), int)
    assert geom.segments_for(10.0) >= geom.segments_for(1.0) >= 3
    # BuildCtx: lod 1 by default; local() is vectorised plant [E, N] -> item-local [x north, z east]
    ctx = BuildCtx(grid=None)
    assert ctx.lod == 1.0
    it = make_item("other", rect(4.0, 2.0, 30.0), h=5.0)
    loc = np.asarray(ctx.local(it, np.array([C[0], C[0] + 1.0]), np.array([C[1] + 2.0, C[1]])), dtype=float)
    np.testing.assert_allclose(loc.reshape(-1, 2), [[2.0, 0.0], [0.0, 1.0]], atol=1e-9)
    # height(): (base_el, top_el, defaulted)
    assert ctx.height(it, 9.0) == (100.0, 105.0, False)
    assert ctx.height(make_item("other", rect(4.0, 2.0)), 9.0) == (100.0, 109.0, True)
    # polygon helpers: open ring of plant [E, N]; reference point = area centroid
    sq = poly([(C[0] - 1, C[1] - 1), (C[0] + 3, C[1] - 1), (C[0] + 3, C[1] + 1), (C[0] - 1, C[1] + 1)])
    p_it = make_item("other", sq, h=1.0)
    assert np.asarray(footprint_polygon(p_it.footprint)).shape == (4, 2)
    np.testing.assert_allclose(footprint_ref(p_it.footprint), (C[0] + 1, C[1]), atol=1e-9)
    # node containers
    assert MeshNode("a", "Concrete", trimesh.creation.box()).extras == {}
    Instanced(mesh=trimesh.creation.box(), transforms=np.eye(4)[None])
    # palette: Cowork's 34 names
    assert len(PALETTE) == 34
    assert {"Concrete_Tank", "Handrail", "Pump_Blue", "Aluminium_Panel", "Safety_Red"} <= set(PALETTE)


# ------------------------------------------------------------------ kit
from app.asset_models.builders.equipment import _kit as k  # noqa: E402


def test_kit_yaw_turns_north_to_the_bearing():
    v = k.yaw(90.0) @ np.array([1.0, 0.0, 0.0, 1.0])
    np.testing.assert_allclose(v[:3], [0.0, 0.0, 1.0], atol=1e-12)  # 90 deg = east = +z
    v = k.yaw(30.0) @ np.array([1.0, 0.0, 0.0, 1.0])
    np.testing.assert_allclose(
        v[:3], [math.cos(math.radians(30)), 0.0, math.sin(math.radians(30))], atol=1e-12
    )
    assert np.linalg.det(k.yaw(123.0)[:3, :3]) == pytest.approx(1.0)


def test_kit_primitives_sit_on_their_base_and_are_closed():
    ctx = BuildCtx(grid=None)
    b = k.box(2.0, 3.0, 4.0, x=1.0, y0=0.5, z=-1.0)
    np.testing.assert_allclose(b.bounds, [[0.0, 0.5, -3.0], [2.0, 3.5, 1.0]], atol=1e-9)
    c = k.vcyl(1.0, 2.0, ctx, y0=1.0)
    np.testing.assert_allclose(c.bounds[:, 1], [1.0, 3.0], atol=1e-9)
    assert c.is_watertight
    ring = k.lathe([(1.0, 0.0), (1.2, 0.0), (1.2, 0.5), (1.0, 0.5)], ctx)
    assert ring.is_watertight and ring.volume > 0
    cap = k.ell_cap(1.0, 0.5, ctx)
    np.testing.assert_allclose(cap.bounds[:, 1], [0.0, 0.5], atol=1e-6)


def test_kit_bar_and_rod_span_their_endpoints():
    ctx = BuildCtx(grid=None)
    m = k.bar((0, 0, 0), (3, 4, 0), 0.1)
    assert m.bounds[1][0] == pytest.approx(3.0, abs=0.08) and m.bounds[1][1] == pytest.approx(4.0, abs=0.08)
    with pytest.raises(ValueError, match="zero-length"):
        k.bar((1, 1, 1), (1, 1, 1), 0.1)
    r = k.rod((0, 1, 0), (5, 1, 0), 0.5, ctx)
    np.testing.assert_allclose(r.bounds[:, 0], [0.0, 5.0], atol=1e-9)


def test_kit_slab_extrudes_a_plan_polygon_upward():
    m = k.slab([(0, 0), (4, 0), (4, 2), (0, 2)], 1.0, 0.1)
    np.testing.assert_allclose(m.bounds, [[0.0, 1.0, 0.0], [4.0, 1.1, 2.0]], atol=1e-9)  # plan y -> z


def test_kit_handrail_posts_are_instanced_along_the_edges():
    nodes = k.handrail("p", [(0, 0), (3.6, 0), (3.6, 1.8), (0, 1.8)], 2.0)
    posts = next(n for n in nodes if n.name == "p_posts")
    assert isinstance(posts.geometry, Instanced)
    assert len(posts.geometry.transforms) == 2 + 1 + 2 + 1  # ceil(edge / 1.8) per edge, closed
    assert {n.name for n in nodes} == {"p_posts", "p_rails"}
    rails = next(n for n in nodes if n.name == "p_rails").geometry
    assert rails.bounds[1][1] == pytest.approx(2.0 + k.RAIL_H + k.RAIL_W / 2, abs=1e-6)


def test_kit_ladder_rungs_follow_the_pitch():
    nodes = k.ladder("l", 1.0, 0.0, 0.0, 3.0, 180.0)
    rungs = next(n for n in nodes if n.name == "l_rungs").geometry
    assert len(rungs.transforms) == len(np.arange(k.RUNG_PITCH, 3.0 - 0.05, k.RUNG_PITCH))
    assert k.ladder("l", 0, 0, 0, 0.4, 0) == []


def test_kit_stair_treads_follow_the_rise():
    nodes = k.stair("s", (0, 0, 0), (3, 2, 0), 1.0)
    treads = next(n for n in nodes if n.name == "s_treads").geometry
    assert len(treads.transforms) == math.ceil(2 / k.TREAD_RISE) - 1


def test_kit_turn_moves_meshes_and_instances_alike():
    ctx = BuildCtx(grid=None)
    nodes = [
        k.node("m", "Concrete", k.box(1, 1, 1, x=2)),
        MeshNode("i", "Grating", k.inst(k.box(1, 1, 1), [k.T(2, 0, 0)])),
    ]
    out = k.turn(nodes, k.yaw(90.0))
    assert out[0].geometry.centroid[2] == pytest.approx(2.0)
    assert out[1].geometry.transforms[0][2, 3] == pytest.approx(2.0)
    assert nodes[0].geometry.centroid[0] == pytest.approx(2.0)  # inputs untouched
    assert ctx.lod == 1.0


def test_kit_plan_of_reads_every_footprint_kind():
    ctx = BuildCtx(grid=None)
    p = k.plan_of(make_item("other", circle(6.0), h=1), ctx)
    assert (p.along, p.across, p.bearing_deg, p.is_round) == (6.0, 6.0, 0.0, True)
    p = k.plan_of(make_item("other", rect(10.0, 4.0, 30.0), h=1), ctx)
    assert (p.along, p.across, p.bearing_deg) == (10.0, 4.0, 30.0)
    # a polygon whose long side runs N 30 deg E (clockwise from north)
    a = math.radians(30)
    u, v = np.array([math.sin(a), math.cos(a)]), np.array([math.cos(a), -math.sin(a)])  # [E, N]
    corners = [np.array(C) + su * 5 * u + sv * 2 * v for su, sv in ((-1, -1), (1, -1), (1, 1), (-1, 1))]
    p = k.plan_of(make_item("other", poly(corners), h=1), ctx)
    assert p.along == pytest.approx(10.0) and p.across == pytest.approx(4.0)
    assert p.bearing_deg == pytest.approx(30.0, abs=1e-6)
    assert (p.cx, p.cz) == (pytest.approx(0.0, abs=1e-9), pytest.approx(0.0, abs=1e-9))


def test_kit_height_refuses_an_item_without_height():
    ctx = BuildCtx(grid=None)
    with pytest.raises(ValueError, match="height"):
        k.height(make_item("other", circle(1.0), h=0.0), ctx, 5.0)
    assert k.height(make_item("other", circle(1.0)), ctx, 5.0) == (5.0, True)


def test_kit_finish_records_defaults_and_derived():
    class P(BaseModel):
        a: float = 1.0
        b: float = 2.0

    it = make_item("other", circle(1.0), h=1.0, params={"a": 3.0})
    nodes = k.finish([k.node("x", "Concrete", k.box(1, 1, 1))], it, P(a=3.0), {"d_m": 1.23456, "kind": "x"})
    assert nodes[0].extras == {"defaults": ["b"], "derived": {"d_m": 1.235, "kind": "x"}}
    with pytest.raises(ValueError, match="no geometry"):
        k.finish([], it, P(), {})


# ------------------------------------------------------------------ harness
load_all()
DATA = Path(__file__).parent / "data" / "plant"
GOLDEN = DATA / "golden" / "equipment"
COWORK = json.loads((DATA / "cowork_nodes" / "equipment.json").read_text(encoding="utf-8"))["types"]
UPDATE = os.environ.get("KESTREL_UPDATE_GOLDENS") == "1"
CTX = BuildCtx(grid=None)
RASTER_GROUP = {  # palette material -> M1 raster colour group, for readable goldens
    "Concrete": "Bottom",
    "Concrete_Tank": "Bottom",
    "Concrete_Dark": "Lining",
    "Steel_Dark": "Lining",
    "Steel_Structure": "Support",
    "Pump_Blue": "Support",
    "Grating": "Access",
    "Machine_Green": "Access",
    "Handrail": "Nozzle",
    "Safety_Red": "Manway",
    "Pipe": "Internal",
    "Pipe_Insulated": "Internal",
}


@dataclass(frozen=True)
class Case:
    type: str
    footprint: dict
    h: float
    params: dict = field(default_factory=dict)
    margin: float = 0.3  # m allowed outside the footprint's local bounding box
    tris: tuple[int, int] = (1, 4000)
    parts: frozenset[str] = frozenset()  # node names that must be present
    golden: tuple[str, ...] = ("iso",)


CASES: dict[str, Case] = {
    # --- vessels (Task 4)
    "vessel_v": Case(  # Cowork 30-V-0001 recondenser: D 5.9, 25 m
        "vessel_v",
        circle(5.9),
        25.0,
        margin=1.2,
        tris=(480, 4000),
        parts=frozenset({"plinth", "shell", "head_top", "head_bottom", "skirt", "nozzles", "ladder_rungs"}),
    ),
    "vessel_v_drum": Case(  # Cowork 30-V-0002A vent drum on PF 104.5: D ~1.0, 1.8 m
        "vessel_v", circle(1.0), 1.8, margin=0.4, tris=(100, 4000), golden=()
    ),
    "vessel_h": Case(  # Cowork 10-V-0001 jetty KO drum: L 17.4, W 3.86, rot 96
        "vessel_h",
        rect(17.4, 3.86, 96.0),
        3.86,
        margin=0.5,
        tris=(408, 2000),
        parts=frozenset({"shell", "head_a", "head_b", "saddles", "piers"}),
        golden=("iso", "top"),
    ),
    # --- tanks (Tasks 5, 6)
    "storage_tank_small": Case(  # Cowork 70-T-0002 fire water tank: R 5.3, 10 m
        "storage_tank_small",
        circle(10.6),
        10.0,
        margin=0.7,
        tris=(1952, 4000),
        parts=frozenset({"foundation", "shell", "roof", "roof_posts", "roof_rails", "ladder_rungs"}),
    ),
    "storage_tank_small_horizontal": Case(  # Cowork 20-A-0009-V-01 diesel tank skid: 5.8 x 3.8, 3 m
        "storage_tank_small",
        rect(5.8, 3.8),
        3.0,
        margin=0.3,
        tris=(200, 4000),
        parts=frozenset({"bund", "saddles", "shell", "heads"}),
    ),
    "tank_lng": Case(  # Cowork 20-T-0001: wall OD 93.5, base EL 100, dome top EL 151.5
        "tank_lng",
        circle(93.5),
        51.5,
        margin=6.0,
        tris=(19500, 32000),
        parts=frozenset(
            {
                "slab",
                "wall_dome",
                "roof_edge_deck",
                "roof_edge_posts",
                "roof_edge_rails",
                "platform_pump_deck",
                "platform_safety_deck",
                "platform_instrument_deck",
                "platform_flare_deck",
                "platform_unloading_deck",
                "walkway_deck",
                "stair_tower_columns",
                "stair_tower_treads",
                "risers",
            }
        ),
        golden=("iso", "top"),
    ),
    # --- rotating (Tasks 7, 8)
    "pump": Case(  # Cowork 20-P-0001A LP LNG pump head on the tank roof: R 0.9, 2 m
        "pump",
        circle(1.8),
        2.0,
        tris=(128, 800),
        parts=frozenset({"baseplate", "pump_head", "motor"}),
    ),
    "pump_horizontal": Case(
        "pump",
        rect(2.4, 0.9, 30.0),
        1.2,
        tris=(128, 800),
        parts=frozenset({"plinth", "baseplate", "casing", "discharge", "coupling_guard", "motor"}),
    ),
    "pump_group": Case(  # Cowork 70-P-0005B fire sea water pump row: 3.2 x 7.7, 3 m
        "pump_group",
        rect(7.7, 3.2),
        3.0,
        tris=(140, 6000),
        parts=frozenset({"plinth", "casing", "motor"}),
    ),
    "compressor": Case(  # Cowork 40-K-0001D BOG compressor with operating floor PF 103.8
        "compressor",
        rect(11.4, 11.2),
        8.5,
        params={"operating_floor_m": 3.8},
        tris=(104, 3000),
        parts=frozenset(
            {"plinth", "crankcase", "cylinders", "bottles", "motor", "lube_oil_console", "floor_deck"}
        ),
    ),
    # --- power (Task 8)
    "generator": Case(  # Cowork 70-A-0012-G-01 containerised genset: 16.75 x 4.3, 4 m
        "generator",
        rect(16.75, 4.3, 90.0),
        4.0,
        tris=(36, 1500),
        parts=frozenset({"plinth", "fuel_base", "enclosure", "radiator", "radiator_louvres", "exhaust"}),
    ),
    "generator_polygon": Case(  # Cowork 10-A-0003-G-01: a rotated 4-point polygon
        "generator",
        poly([(992.0, 502.28), (992.64, 496.11), (1008.06, 497.74), (1007.42, 503.88)]),
        4.0,
        tris=(36, 1500),
        golden=("top",),
    ),
    "transformer": Case(  # Cowork 70-SS-01-tx-n1: 4 walled bays, 24.5 x 10.9, 4 m
        "transformer",
        rect(24.5, 10.9, 90.0),
        4.0,
        tris=(36, 4000),
        parts=frozenset({"plinths", "tanks", "radiator_fins", "bushings", "conservators", "firewalls"}),
    ),
    # --- process (Tasks 9, 10)
    "heater": Case(  # Cowork 50-F-0002A NG trim heater, water bath: 16 x 8.5 (E-W), 5 m
        "heater",
        rect(16.0, 8.5, 90.0),
        5.0,
        tris=(36, 2000),
        parts=frozenset({"pad", "skid", "bath_shell", "bath_heads", "burner", "stack"}),
    ),
    "vaporizer_orv": Case(  # Cowork 50-E-0001A open rack vaporizer: 16.1 x 10.2 (E-W), 8 m
        "vaporizer_orv",
        rect(16.1, 10.2, 90.0),
        8.0,
        tris=(252, 4000),
        parts=frozenset(
            {"pad", "trough", "panels", "distribution_troughs", "headers", "top_walkway", "stair_treads"}
        ),
    ),
    "vaporizer_scv": Case(  # Cowork 50-F-0001A submerged combustion vaporizer: 28.4 x 9.2 (E-W), 6 m
        "vaporizer_scv",
        rect(28.4, 9.2, 90.0),
        6.0,
        tris=(36, 2000),
        parts=frozenset({"pad", "water_bath", "blower", "air_duct", "bath_top_posts"}),
    ),
    "stack": Case(  # Cowork 50-F-0001A-stack: D 3.22, 15 m
        "stack",
        circle(3.22),
        15.0,
        margin=1.2,
        tris=(192, 2500),
        parts=frozenset({"shell", "bands", "platform_deck", "ladder_rungs"}),
    ),
    "flare": Case(  # Cowork 60-A-0001 flare package: circle R 2.25, 50 m on the flare platform
        "flare",
        circle(4.5),
        50.0,
        margin=3.0,
        tris=(404, 5000),
        parts=frozenset({"foundation", "riser", "seal", "tip", "derrick", "leg_footings", "platform_0_deck"}),
    ),
    "package": Case(  # Cowork 20-DCP-001 dry chemical skid: 5.9 x 2.5, 2 m
        "package",
        rect(5.9, 2.5),
        2.0,
        tris=(36, 800),
        parts=frozenset({"skid_frame", "skid_vessel", "skid_module", "piping"}),
    ),
    "package_enclosure": Case(
        "package",
        rect(6.0, 4.0, 45.0),
        3.5,
        params={"colour": "red"},
        tris=(36, 800),
        parts=frozenset({"pad", "enclosure", "roof", "door"}),
    ),
    "package_cabinet": Case(
        "package",
        rect(1.5, 1.0),
        2.0,
        tris=(36, 800),
        parts=frozenset({"plinth", "cabinet", "canopy"}),
        golden=(),
    ),
    # --- jetty (Task 11)
}
FIRST: dict[str, str] = {}
for _cid, _case in CASES.items():
    FIRST.setdefault(_case.type, _cid)
IDS = list(CASES)
TYPES_BUILT = sorted(FIRST)


def make(c: Case) -> Item:
    return make_item(c.type, c.footprint, h=c.h, params=c.params)


@functools.cache
def built(cid: str, lod: float = 1.0) -> tuple:
    c = CASES[cid]
    return tuple(REGISTRY[c.type].fn(make(c), BuildCtx(grid=None, lod=lod)))


def expanded(g) -> trimesh.Trimesh:
    if isinstance(g, Instanced):
        return trimesh.util.concatenate([g.mesh.copy().apply_transform(t) for t in g.transforms])
    return g


def tris(nodes) -> int:
    return sum(
        len(n.geometry.mesh.faces) * len(n.geometry.transforms)
        if isinstance(n.geometry, Instanced)
        else len(n.geometry.faces)
        for n in nodes
    )


def bounds(nodes) -> tuple[np.ndarray, np.ndarray]:
    b = np.array([expanded(n.geometry).bounds for n in nodes])
    return b[:, 0].min(axis=0), b[:, 1].max(axis=0)


def footprint_box(fp: dict) -> tuple[tuple[float, float], tuple[float, float]]:
    """The footprint's bounding box in item-local [x north, z east], origin at footprint_ref."""
    if fp["kind"] == "circle":
        r = fp["d"] / 2
        return (-r, -r), (r, r)
    if fp["kind"] == "rect":
        a = math.radians(fp["rot_deg"])
        u, v = np.array([math.cos(a), math.sin(a)]), np.array([-math.sin(a), math.cos(a)])
        al, ac = fp["size"]
        pts = [su * al / 2 * u + sv * ac / 2 * v for su in (-1, 1) for sv in (-1, 1)]
    else:
        en = np.asarray(fp["pts"], dtype=float)
        ref = Polygon(en).centroid
        pts = [np.array([n_ - ref.y, e_ - ref.x]) for e_, n_ in en]
    p = np.array(pts)
    return tuple(p.min(axis=0)), tuple(p.max(axis=0))


def principal_bearing(nodes, name: str) -> float:
    """Plan bearing (0..180, clockwise from north) of a node's long axis."""
    v = expanded(next(n for n in nodes if n.name == name).geometry).vertices
    xz = v[:, [0, 2]] - v[:, [0, 2]].mean(axis=0)
    _, vec = np.linalg.eigh(np.cov(xz.T))
    a = vec[:, -1]
    return math.degrees(math.atan2(a[1], a[0])) % 180.0


def render_nodes(nodes, view: str) -> Image.Image:
    meshes = {n.name: expanded(n.geometry) for n in nodes}
    groups = {n.name: RASTER_GROUP.get(n.material, "Shell") for n in nodes}
    return render(meshes, View(view), size=256, groups=groups)


def test_harness_types_are_cowork_types():
    assert set(FIRST) <= set(COWORK)


@pytest.mark.parametrize("cid", IDS)
def test_builds_clean_nodes(cid):
    nodes = built(cid)
    assert nodes
    names = [n.name for n in nodes]
    assert len(set(names)) == len(names), "node names repeat"
    for n in nodes:
        assert n.material in PALETTE, (n.name, n.material)
        m = expanded(n.geometry)
        assert len(m.faces) > 0 and np.isfinite(m.vertices).all(), n.name
    missing = CASES[cid].parts - set(names)
    assert not missing, missing


@pytest.mark.parametrize("cid", IDS)
def test_bounds(cid):
    c = CASES[cid]
    lo, hi = bounds(built(cid))
    (x0, z0), (x1, z1) = footprint_box(c.footprint)
    assert lo[0] >= x0 - c.margin and hi[0] <= x1 + c.margin, (lo, hi, (x0, x1))
    assert lo[2] >= z0 - c.margin and hi[2] <= z1 + c.margin, (lo, hi, (z0, z1))
    assert lo[1] >= -0.01
    assert abs(hi[1] - c.h) <= max(0.05 * c.h, 0.5), (hi[1], c.h)


@pytest.mark.parametrize("cid", IDS)
def test_triangle_range(cid):
    lo, hi = CASES[cid].tris
    assert lo <= tris(built(cid)) <= hi, tris(built(cid))


@pytest.mark.parametrize("type_", TYPES_BUILT)
def test_realism_floor_vs_cowork(type_):
    nodes = built(FIRST[type_])
    ref = COWORK[type_]
    floor = int(0.8 * ref["tris_median"]) if type_ == "tank_lng" else ref["tris_median"]
    assert tris(nodes) >= floor
    assert len(nodes) >= ref["submeshes_max"]
    assert len({n.material for n in nodes}) >= min(len(ref["materials"]), 2)


@pytest.mark.parametrize("type_", TYPES_BUILT)
def test_registered_with_catalogue_fields(type_):
    d = REGISTRY[type_]
    assert d.family == "equipment"
    assert d.default_height_m > 0
    assert 40 <= len(d.doc) <= 600
    d.params.model_validate({})  # every top-level param has a default
    assert d.params.model_json_schema()["properties"]


@pytest.mark.parametrize("type_", TYPES_BUILT)
def test_defaults_recorded(type_):
    c = CASES[FIRST[type_]]
    nodes = built(FIRST[type_])
    fields = REGISTRY[type_].params.model_fields
    assert nodes[0].extras["defaults"] == sorted(f for f in fields if f not in c.params)
    assert nodes[0].extras["derived"], "derived values missing"


@pytest.mark.parametrize("cid", IDS)
def test_deterministic(cid):
    c = CASES[cid]
    a = REGISTRY[c.type].fn(make(c), CTX)
    b = REGISTRY[c.type].fn(make(c), CTX)
    assert [n.name for n in a] == [n.name for n in b]
    for x, y in zip(a, b, strict=True):
        gx, gy = x.geometry, y.geometry
        if isinstance(gx, Instanced):
            assert np.array_equal(gx.transforms, gy.transforms)
            gx, gy = gx.mesh, gy.mesh
        assert np.array_equal(gx.vertices, gy.vertices) and np.array_equal(gx.faces, gy.faces)


@pytest.mark.parametrize("cid", IDS)
def test_build_item_uses_the_builder(cid):
    nodes, flags = build_item(make(CASES[cid]), CTX)
    assert not [f for f in flags if f.code == "builder_fallback"]
    assert CASES[cid].parts <= {n.name for n in nodes}


@pytest.mark.parametrize(("cid", "view"), [(cid, v) for cid, c in CASES.items() for v in c.golden])
def test_golden_render(cid, view):
    img = render_nodes(built(cid), view)
    path = GOLDEN / f"{cid}_{view}.png"
    if UPDATE:
        path.parent.mkdir(parents=True, exist_ok=True)
        img.save(path)
        return
    assert path.exists(), f"missing golden {path.name}: run with KESTREL_UPDATE_GOLDENS=1 and review it"
    golden = np.asarray(Image.open(path).convert("RGB"), dtype=np.int16)
    diff = np.abs(np.asarray(img, dtype=np.int16) - golden)
    assert (diff > 40).mean() < 0.01  # under 1 % of pixels differ visibly


# ------------------------------------------------------------------ vessels
def test_tiny_vessel_v_has_no_ladder_or_platform():  # Review Focus 2
    names = {n.name for n in built("vessel_v_drum")}
    assert not any(n.startswith(("ladder", "platform")) for n in names)
    assert {"shell", "head_top", "head_bottom"} <= names


def test_tall_vessel_v_gets_ladder_and_platform_by_default():
    names = {n.name for n in built("vessel_v")}
    assert {"ladder_rungs", "platform_deck", "platform_posts"} <= names


@pytest.mark.parametrize(
    ("footprint", "orient", "expected"),
    [
        (rect(17.4, 3.86, 0.0), None, 0.0),
        (rect(17.4, 3.86, 30.0), None, 30.0),
        (rect(17.4, 3.86, 0.0), "ew", 90.0),
        (rect(3.86, 17.4, 0.0), "ns", 0.0),
        (circle(6.0), "ew", 90.0),
    ],
)
def test_vessel_h_orientation(footprint, orient, expected):
    params = {"orient": orient} if orient else {}
    nodes = REGISTRY["vessel_h"].fn(make_item("vessel_h", footprint, h=3.0, params=params), CTX)
    got = principal_bearing(nodes, "shell")
    assert min(abs(got - expected), 180 - abs(got - expected)) < 0.5
    assert nodes[0].extras["derived"]["axis_bearing_deg"] == pytest.approx(expected % 360)


def test_vessel_v_lod_lowers_triangles():
    assert tris(built("vessel_v", 0.25)) < tris(built("vessel_v"))


def test_vessel_v_heads_too_tall_for_height_raise():
    with pytest.raises(ValueError, match="height"):
        REGISTRY["vessel_v"].fn(make_item("vessel_v", circle(6.0), h=2.0), CTX)


# ------------------------------------------------------------------ tanks
def test_storage_tank_small_form_follows_the_footprint():
    assert built("storage_tank_small")[0].extras["derived"]["form"] == "vertical"
    assert built("storage_tank_small_horizontal")[0].extras["derived"]["form"] == "horizontal"


def test_storage_tank_small_roof_posts_are_instanced():
    posts = next(n for n in built("storage_tank_small") if n.name == "roof_posts").geometry
    assert isinstance(posts, Instanced) and len(posts.transforms) >= 20


def test_storage_tank_small_horizontal_vent_protrudes_above_the_shell():
    nodes = {n.name: n for n in built("storage_tank_small_horizontal")}
    shell_top = expanded(nodes["shell"].geometry).bounds[1][1]
    vent_top = expanded(nodes["nozzles"].geometry).bounds[1][1]
    assert vent_top > shell_top + 0.1
    assert vent_top == pytest.approx(CASES["storage_tank_small_horizontal"].h, abs=0.01)


def test_storage_tank_small_lod_lowers_triangles():
    assert tris(built("storage_tank_small", 0.25)) < tris(built("storage_tank_small"))


def test_tank_lng_roof_posts_are_instanced_round_the_edge():
    posts = next(n for n in built("tank_lng") if n.name == "roof_edge_posts").geometry
    assert isinstance(posts, Instanced)
    assert len(posts.transforms) == max(8, math.ceil(2 * math.pi * (93.5 / 2 - 0.1) / k.POST_PITCH))


def test_tank_lng_parts_can_be_switched_off():
    params = {
        "roof_platforms": [],
        "walkway": None,
        "stair_tower_bearing_deg": None,
        "risers_bearing_deg": None,
    }
    nodes = REGISTRY["tank_lng"].fn(make_item("tank_lng", circle(93.5), h=51.5, params=params), CTX)
    names = {n.name for n in nodes}
    assert not any(n.startswith(("platform_", "walkway", "stair_tower", "riser")) for n in names)
    assert {"slab", "wall_dome", "roof_edge_posts"} <= names


def test_tank_lng_platform_sits_at_its_bearing():
    deck = next(n for n in built("tank_lng") if n.name == "platform_pump_deck").geometry
    x, _, z = deck.centroid
    assert math.degrees(math.atan2(z, x)) % 360 == pytest.approx(134.0, abs=2.0)


def test_tank_lng_scales_to_other_diameters():  # Review Focus 4
    nodes = REGISTRY["tank_lng"].fn(make_item("tank_lng", circle(60.0), h=35.0), CTX)
    lo, hi = bounds(nodes)
    assert max(abs(lo[0]), abs(hi[0]), abs(lo[2]), abs(hi[2])) <= 30.0 + 6.0
    assert abs(hi[1] - 35.0) <= max(0.05 * 35.0, 0.5)
    names = {n.name for n in nodes}
    assert {f"platform_{kd}_deck" for kd in ("pump", "safety", "instrument", "flare", "unloading")} <= names
    assert nodes[0].extras["derived"]["scale"] == pytest.approx(60.0 / 93.5, abs=1e-3)


def test_tank_lng_lod_lowers_triangles():
    assert tris(built("tank_lng", 0.25)) < tris(built("tank_lng"))


def _lng_dome_y(derived: dict, r: np.ndarray) -> np.ndarray:
    ro, hw, rise = derived["od_m"] / 2, derived["wall_top_m"], derived["dome_rise_m"]
    rs = (ro**2 + rise**2) / (2 * rise)
    return np.where(r >= ro, hw, hw + rise - rs + np.sqrt(np.maximum(rs**2 - r**2, 0.0)))


@pytest.mark.parametrize(("d", "h"), [(93.5, 51.5), (60.0, 35.0)])
def test_tank_lng_walkway_deck_clears_the_dome(d, h):
    nodes = REGISTRY["tank_lng"].fn(make_item("tank_lng", circle(d), h=h), CTX)
    deck = next(n for n in nodes if n.name == "walkway_deck").geometry
    v = expanded(deck).vertices
    clear = v[:, 1] - _lng_dome_y(nodes[0].extras["derived"], np.hypot(v[:, 0], v[:, 2]))
    assert clear.min() > 0.0, clear.min()


def test_tank_lng_riser_runs_clear_the_roof_edge_rail():
    nodes = {n.name: n for n in built("tank_lng")}
    rail_top = expanded(nodes["roof_edge_rails"].geometry).bounds[1][1]
    v = expanded(nodes["risers"].geometry).vertices
    over_wall = v[np.hypot(v[:, 0], v[:, 2]) < 93.5 / 2]  # the inner ends of the horizontal runs
    assert len(over_wall) and over_wall[:, 1].min() > rail_top


# ------------------------------------------------------------------ rotating
def test_pump_kind_follows_the_footprint():
    assert built("pump")[0].extras["derived"]["kind"] == "column"
    assert built("pump_horizontal")[0].extras["derived"]["kind"] == "horizontal"


def test_pump_horizontal_shaft_follows_rot_deg():
    assert principal_bearing(built("pump_horizontal"), "motor") == pytest.approx(30.0, abs=1.0)


def test_pump_group_instances_one_unit_per_pump():
    nodes = built("pump_group")
    casing = next(n for n in nodes if n.name == "casing").geometry
    assert isinstance(casing, Instanced) and len(casing.transforms) == 3  # floor(7.7 / 2.5)
    assert nodes[0].extras["derived"]["n"] == 3


def test_pump_group_max_units_stays_inside():  # Review Focus 5
    it = make_item("pump_group", rect(3.0, 2.0), h=2.5, params={"n": 24})
    nodes = REGISTRY["pump_group"].fn(it, CTX)
    lo, hi = bounds(nodes)
    assert lo[0] >= -1.5 - 0.05 and hi[0] <= 1.5 + 0.05
    assert lo[2] >= -1.0 - 0.05 and hi[2] <= 1.0 + 0.05
    assert tris(nodes) <= 24 * 800


def test_pump_engine_driver_has_engine_and_radiator():
    it = make_item("pump", rect(3.5, 1.2), h=1.8, params={"driver": "engine"})
    names = {n.name for n in REGISTRY["pump"].fn(it, CTX)}
    assert {"engine", "radiator"} <= names and "motor" not in names


def test_compressor_centrifugal_and_enclosure():
    it = make_item("compressor", rect(8.0, 4.0), h=5.0, params={"kind": "centrifugal", "enclosure": True})
    names = {n.name for n in REGISTRY["compressor"].fn(it, CTX)}
    assert {"casing", "gearbox", "motor", "nozzles", "enclosure_columns", "enclosure_roof"} <= names


# ------------------------------------------------------------------ power
def test_polygon_footprint_follows_long_axis():  # Review Focus 1
    pts = CASES["generator_polygon"].footprint["pts"]
    de, dn = pts[2][0] - pts[1][0], pts[2][1] - pts[1][1]  # the long side, plant [E, N]
    expected = math.degrees(math.atan2(de, dn)) % 180.0
    got = principal_bearing(built("generator_polygon"), "enclosure")
    assert min(abs(got - expected), 180 - abs(got - expected)) < 2.0


def test_transformer_bays_fins_and_walls_are_instanced():
    nodes = {n.name: n.geometry for n in built("transformer")}
    assert len(nodes["radiator_fins"].transforms) == 4 * 12  # round(24.5 / 6) bays x 12 fins
    assert len(nodes["firewalls"].transforms) == 5
    assert len(nodes["tanks"].transforms) == 4


def test_generator_doors_are_instanced():
    doors = next(n for n in built("generator") if n.name == "doors").geometry
    assert len(doors.transforms) == 6


def test_compressor_floor_below_the_machinery_is_refused():
    c = CASES["compressor"]
    low = make_item("compressor", c.footprint, h=c.h, params={"operating_floor_m": 2.0})
    with pytest.raises(ValueError, match="operating floor"):
        REGISTRY["compressor"].fn(low, CTX)
    _, flags = build_item(low, CTX)
    assert [f for f in flags if f.code == "builder_fallback"]
    assert "floor_deck" in {n.name for n in built("compressor")}


@pytest.mark.parametrize(("size", "h"), [((20.0, 20.0), 20.0), ((30.0, 24.0), 30.0)])
def test_compressor_large_units_stay_above_base(size, h):
    nodes = REGISTRY["compressor"].fn(make_item("compressor", rect(*size), h=h), CTX)
    assert bounds(nodes)[0][1] >= -0.01


def test_generator_louvres_sit_on_the_radiator_face():
    for along in (16.75, 3.0):
        nodes = {
            n.name: n for n in REGISTRY["generator"].fn(make_item("generator", rect(along, 2.0), h=3.0), CTX)
        }
        face = expanded(nodes["radiator"].geometry).bounds[1][0]
        lo, hi = expanded(nodes["radiator_louvres"].geometry).bounds[:, 0]
        assert lo == pytest.approx(face, abs=1e-6) and hi <= along / 2 + 1e-6


def test_transformer_conservators_are_supported_from_the_tank():
    nodes = {n.name: n for n in built("transformer")}
    tank_top = expanded(nodes["tanks"].geometry).bounds[1][1]
    sup = expanded(nodes["conservator_supports"].geometry).bounds
    cons = expanded(nodes["conservators"].geometry).bounds
    assert sup[0][1] == pytest.approx(tank_top, abs=1e-6) and sup[1][1] >= cons[0][1]
    assert len(nodes["conservator_supports"].geometry.transforms) == 4


# ------------------------------------------------------------------ process
def test_orv_panels_are_instanced_across_the_rack():
    panels = next(n for n in built("vaporizer_orv") if n.name == "panels").geometry
    assert isinstance(panels, Instanced) and len(panels.transforms) == 23  # round(0.85 * 16.1 / 0.6)


def test_scv_stack_is_off_by_default_and_on_by_param():
    assert "stack" not in {n.name for n in built("vaporizer_scv")}
    it = make_item("vaporizer_scv", rect(28.4, 9.2, 90.0), h=15.0, params={"stack": True})
    assert "stack" in {n.name for n in REGISTRY["vaporizer_scv"].fn(it, CTX)}


def test_fired_heater_builds():
    it = make_item("heater", rect(10.0, 6.0), h=12.0, params={"kind": "fired_box"})
    names = {n.name for n in REGISTRY["heater"].fn(it, CTX)}
    assert {"pad", "radiant_box", "convection", "stack", "ladder_rungs"} <= names


def _parts(type_: str, fp: dict, h: float, params: dict | None = None) -> dict:
    return {
        n.name: expanded(n.geometry)
        for n in REGISTRY[type_].fn(make_item(type_, fp, h=h, params=params), CTX)
    }


def test_heater_burner_meets_the_bath_head():
    for fp, h in ((rect(16.0, 8.5), 5.0), (rect(6.0, 6.0), 10.0)):
        p = _parts("heater", fp, h)
        assert p["burner"].bounds[1][0] > p["bath_heads"].bounds[0][0] + 0.01


@pytest.mark.parametrize("params", [{}, {"stack": False}])
def test_heater_stack_and_nozzles_rise_from_the_shell_not_the_heads(params):
    p = _parts("heater", rect(6.0, 6.0), 10.0, params)  # a short fat bath: d > 0.32 along
    shell = p["bath_shell"].bounds
    riser = p["stack" if not params else "nozzles"].bounds
    assert riser[0][0] >= shell[0][0] - 1e-6 and riser[1][0] <= shell[1][0] + 1e-6


@pytest.mark.parametrize(
    ("fp", "h", "params"), [(rect(16.1, 10.2), 8.0, {}), (rect(30.0, 14.0), 12.0, {"stairs": False})]
)
def test_orv_walkway_is_carried_and_the_side_lane_is_clear(fp, h, params):
    p = _parts("vaporizer_orv", fp, h, params)
    deck, cols, basin = p["top_walkway"].bounds, p["top_walkway_columns"].bounds, p["trough"].bounds
    assert cols[0][1] == pytest.approx(0.3) and cols[1][1] == pytest.approx(deck[0][1])
    assert cols[0][0] <= deck[0][0] + 0.1 and cols[1][0] >= deck[1][0] - 0.1
    for name in ("stair_stringers", "stair_treads", "top_walkway_columns"):
        if name in p:
            assert p[name].bounds[1][2] <= basin[0][2] + 1e-6, name  # the lane sits beside the basin
    for side in (0, 1):  # the distribution troughs stay inside the basin
        assert abs(p["distribution_troughs"].bounds[side][2]) <= abs(basin[side][2]) + 1e-6


def test_orv_too_narrow_for_the_side_lane_is_refused():
    with pytest.raises(ValueError, match="too narrow"):
        REGISTRY["vaporizer_orv"].fn(make_item("vaporizer_orv", rect(16.0, 7.0), h=8.0), CTX)


def test_orv_lower_header_sits_on_the_basin():
    p = _parts("vaporizer_orv", rect(16.1, 10.2), 8.0)
    assert p["headers"].bounds[0][1] == pytest.approx(p["trough"].bounds[1][1], abs=0.01)  # faceted rod


@pytest.mark.parametrize(("fp", "h", "end"), [(rect(8.0, 4.0), 2.5, "start"), (rect(6.0, 3.0), 3.0, "end")])
def test_scv_ladder_on_the_pad_and_duct_below_the_bath_top(fp, h, end):
    p = _parts("vaporizer_scv", fp, h, {"blower_end": end})
    half = fp["size"][0] / 2
    lad = p["ladder_stiles"].bounds
    assert lad[0][0] >= -half - 1e-6 and lad[1][0] <= half + 1e-6
    assert p["air_duct"].bounds[1][1] <= p["water_bath"].bounds[1][1] + 1e-6


def test_package_style_auto_and_colour():
    assert built("package")[0].extras["derived"]["style"] == "skid"
    assert built("package_enclosure")[0].extras["derived"]["style"] == "enclosure"
    assert built("package_cabinet")[0].extras["derived"]["style"] == "cabinet"
    assert next(n for n in built("package_enclosure") if n.name == "enclosure").material == "Safety_Red"


@pytest.mark.parametrize("support", ["guyed", "self"])
def test_flare_other_supports_build(support):
    it = make_item("flare", circle(4.5), h=50.0, params={"support": support})
    names = {n.name for n in REGISTRY["flare"].fn(it, CTX)}
    assert {"riser", "tip", "tip_platform_deck"} <= names
    assert ("guys" in names) == (support == "guyed")


def test_stack_lod_lowers_triangles():
    assert tris(built("stack", 0.25)) < tris(built("stack"))


@pytest.mark.parametrize(("d", "h", "ratio"), [(3.22, 15.0, 0.8), (10.0, 40.0, 0.5)])
def test_stack_ladder_stands_on_grade_follows_the_taper_and_lands_on_the_deck(d, h, ratio):
    p = _parts("stack", circle(d), h, {"top_d_ratio": ratio})
    v = p["ladder_stiles"].vertices
    assert v[:, 1].min() == pytest.approx(0.0, abs=0.05)  # on grade, not hung off the shell
    r0, rt = d / 2, d / 2 * ratio
    shell_r = r0 + (rt - r0) * (v[:, 1] - 0.45) / (h - 0.45)
    gap = np.abs(v[:, 0]) - shell_r
    assert gap.min() > 0.2 and gap.max() < 0.7  # a steady stand-off from the tapering shell
    deck = p["platform_deck"].bounds
    top = v[v[:, 1] > v[:, 1].max() - 0.05]
    assert (np.abs(top[:, 0]) < deck[1][0] - 0.1).all()  # the climber arrives inside the deck rail


def test_stack_base_ring_stays_on_the_plinth():
    p = _parts("stack", circle(10.0), 30.0)
    assert p["base_ring"].bounds[1][0] <= p["plinth"].bounds[1][0] + 1e-6


def test_flare_derrick_reaches_the_top_platform():
    p = _parts("flare", circle(4.5), 50.0)
    assert p["derrick"].bounds[1][1] >= p["platform_0_deck"].bounds[0][1]


@pytest.mark.parametrize(
    ("params", "match"), [({"derrick_base_m": 2.0}, "derrick base"), ({"riser_d_m": 5.0}, "riser")]
)
def test_flare_parts_that_would_intersect_are_refused(params, match):
    with pytest.raises(ValueError, match=match):
        REGISTRY["flare"].fn(make_item("flare", circle(4.5), h=50.0, params=params), CTX)


def test_flare_guys_hang_below_the_tip_platform():
    p = _parts("flare", circle(4.5), 10.0, {"support": "guyed"})
    assert p["guys"].bounds[1][1] <= p["tip_platform_deck"].bounds[0][1]


@pytest.mark.parametrize(("fp", "h"), [(rect(5.9, 2.5), 2.0), (rect(4.0, 2.5), 1.0), (rect(12.0, 4.0), 2.5)])
def test_package_skid_vessel_sits_in_saddles_and_the_pipe_rises_from_it(fp, h):
    p = _parts("package", fp, h)
    vessel, frame = p["skid_vessel"], p["skid_frame"]
    assert frame.bounds[1][1] > vessel.bounds[0][1] + 0.05  # saddles reach up into the vessel
    r = (vessel.bounds[1][1] - vessel.bounds[0][1]) / 2
    pipe = p["piping"].bounds
    assert pipe[1][2] <= r  # the riser leaves the vessel within its radius, not beside it


def test_package_skid_on_a_tiny_footprint_is_refused():
    it = make_item("package", rect(0.8, 0.3), h=1.0, params={"style": "skid"})
    with pytest.raises(ValueError, match="too small"):
        REGISTRY["package"].fn(it, CTX)
