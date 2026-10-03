"""Equipment builders (unit B2, plan docs/superpowers/plans/2026-10-03-plant-model-b2.md)."""

from __future__ import annotations

import inspect

import numpy as np
import trimesh

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
