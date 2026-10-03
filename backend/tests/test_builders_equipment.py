"""Equipment builders (unit B2, plan docs/superpowers/plans/2026-10-03-plant-model-b2.md)."""

from __future__ import annotations

import inspect
import math

import numpy as np
import pytest
import trimesh
from pydantic import BaseModel

from app.asset_models.builders import geom
from app.asset_models.builders.base import BuildCtx, Instanced, MeshNode, builder
from app.asset_models.builders.palette import PALETTE
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
