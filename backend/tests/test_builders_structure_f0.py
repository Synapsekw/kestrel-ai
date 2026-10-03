"""What the structure family (B1) relies on from F0. If one of these fails after F0 changes, fix the
adapter in builders/structure_kit.py (local_pts, slab, pile_mesh, segs), not the builders."""

from __future__ import annotations

import numpy as np
import pytest
import trimesh
from pydantic import BaseModel

from app.asset_models.builders import geom
from app.asset_models.builders.base import REGISTRY, BuildCtx, BuilderDef, Instanced, MeshNode, build_item
from app.asset_models.builders.palette import PALETTE
from app.asset_models.siteframe import footprint_polygon, footprint_ref
from app.asset_models.spec import Item

CTX = BuildCtx(grid=None)
STRUCTURE_MATERIALS = {
    "Concrete", "Concrete_Dark", "Steel_Structure", "Steel_Dark",
    "Grating", "Handrail", "Pipe", "Pipe_Insulated",
}  # fmt: skip


def item(fp, base=100.0, top=None) -> Item:
    return Item.model_validate(
        {"id": "f0", "name": "f0", "type": "other", "footprint": fp, "base_el": base, "top_el": top,
         "source": {"kind": "assumed"}}
    )  # fmt: skip


def test_geom_cyl_stands_on_the_origin_along_y():
    m = geom.cyl(0.5, 3.0, 12)
    assert m.bounds[0][1] == pytest.approx(0) and m.bounds[1][1] == pytest.approx(3)
    assert np.allclose(m.bounds[:, [0, 2]], [[-0.5, -0.5], [0.5, 0.5]], atol=0.02)


def test_geom_extrude_takes_local_xz_and_rises_in_y():
    m = geom.extrude(np.array([[0.0, 0.0], [4.0, 0.0], [4.0, 2.0], [0.0, 2.0]]), 1.5)
    assert np.allclose(m.bounds, [[0, 0, 0], [4, 1.5, 2]])
    assert m.is_watertight


def test_geom_segments_for_grows_with_radius():
    assert geom.segments_for(0.05) <= geom.segments_for(0.55) <= geom.segments_for(5.0)


def test_ctx_local_is_north_then_east_from_the_footprint_ref():
    it = item({"kind": "rect", "center": [100.0, 200.0], "size": [4, 2], "rot_deg": 0})
    assert footprint_ref(it.footprint) == pytest.approx((100.0, 200.0))
    loc = np.asarray(CTX.local(it, np.array([100.0, 101.0, 99.0]), np.array([200.0, 203.0, 198.0])))
    assert loc.shape == (3, 2)
    assert np.allclose(loc, [[0, 0], [3, 1], [-2, -1]])  # [x = N - 200, z = E - 100]


def test_ctx_height_returns_base_top_and_whether_it_defaulted():
    assert CTX.height(item({"kind": "circle", "center": [0, 0], "d": 2}, 100.0, None), 6.0) == (
        100.0,
        106.0,
        True,
    )
    assert CTX.height(item({"kind": "circle", "center": [0, 0], "d": 2}, 100.0, 104.0), 6.0) == (
        100.0,
        104.0,
        False,
    )


def test_rect_footprint_turns_clockwise_from_north():
    it = item({"kind": "rect", "center": [0.0, 0.0], "size": [10.0, 2.0], "rot_deg": 90.0})
    ring = np.asarray(footprint_polygon(it.footprint))
    assert np.ptp(ring[:, 0]) == pytest.approx(10.0)  # along runs east at 90 deg
    assert np.ptp(ring[:, 1]) == pytest.approx(2.0)


def test_palette_has_the_structure_materials():
    assert STRUCTURE_MATERIALS <= set(PALETTE)


def test_meshnode_and_instanced_shapes():
    box = trimesh.creation.box((1, 1, 1))
    n = MeshNode("x", "Concrete", Instanced(box, np.tile(np.eye(4), (2, 1, 1))))
    assert n.extras == {} and n.geometry.transforms.shape == (2, 4, 4)


def test_build_item_turns_a_raising_builder_into_a_flagged_fallback(monkeypatch):
    class NoParams(BaseModel):
        pass

    def boom(item, ctx):
        raise ValueError("broken")

    monkeypatch.setitem(
        REGISTRY,
        "b1_probe",
        BuilderDef(
            type="b1_probe", family="structure", params=NoParams, fn=boom, doc="probe", default_height_m=1.0
        ),
    )
    it = item({"kind": "rect", "center": [0, 0], "size": [2, 2], "rot_deg": 0}, 100.0, 101.0)
    nodes, flags = build_item(it.model_copy(update={"type": "b1_probe"}), CTX)
    assert nodes and [f.code for f in flags] == ["builder_fallback"]
