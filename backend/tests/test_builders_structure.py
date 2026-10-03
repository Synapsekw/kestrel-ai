"""Structure builders (B1): spec §6 / §13 gate tests for the 11 structure types."""

from __future__ import annotations

import math
from dataclasses import dataclass

import numpy as np
import pytest
import trimesh

from app.asset_models.builders import structure_kit as k
from app.asset_models.builders.base import REGISTRY, BuildCtx, Instanced, MeshNode, build_item, load_all
from app.asset_models.builders.palette import PALETTE
from app.asset_models.siteframe import footprint_polygon
from app.asset_models.spec import Item

load_all()

CTX = BuildCtx(grid=None)


def line(pts, width):
    return {"kind": "line", "pts": pts, "width": width}


def rect(along, across, rot=0.0, center=(0.0, 0.0)):
    return {"kind": "rect", "center": list(center), "size": [along, across], "rot_deg": rot}


@dataclass(frozen=True)
class TypeSpec:
    """A type's canonical test case (default params) and what it must satisfy."""

    footprint: dict
    base: float
    top: float
    rot: dict  # a rect version (along > across) for the rotation test
    required: set[str]  # realism floor: sub-part node names (Cowork's sub-parts + spec §6)
    pad_xz: float = 0.1  # plan reach past the footprint, m (ruling R2)
    pad_y: float = 1.2  # reach above top_el, m: handrails 1.1 m (ruling R2)
    piped: bool = False


SPECS: dict[str, TypeSpec] = {}
# -- piled decks (task 3)
SPECS["trestle"] = TypeSpec(
    line([[0, 0], [0, 40]], 12), 93.56, 104.5, rect(40, 12),
    {"deck", "piles", "headstocks", "bracing", "handrail_posts", "handrail_rails", "rack_sleepers"},
    piped=True,
)  # fmt: skip
SPECS["jetty_platform"] = TypeSpec(
    rect(30, 20), 93.56, 104.5, rect(30, 20), {"deck", "piles", "handrail_posts", "handrail_rails"}
)
SPECS["dolphin"] = TypeSpec(
    rect(7, 6), 93.56, 104.5, rect(7, 6), {"cap", "piles", "fender", "bollards"}, pad_xz=1.05, pad_y=0.8
)
# -- racks (task 4)
# -- access (task 5)
# -- platforms (task 6)
TYPES = list(SPECS)


def item(type_, footprint, base, top, *, levels=(), params=None) -> Item:
    return Item.model_validate(
        {
            "id": f"t-{type_}",
            "name": type_,
            "type": type_,
            "footprint": footprint,
            "base_el": base,
            "top_el": top,
            "levels": list(levels),
            "params": params or {},
            "source": {"kind": "assumed"},
        }
    )


def case(type_, *, footprint=None, top="spec", levels=(), params=None) -> Item:
    s = SPECS[type_]
    return item(
        type_, footprint or s.footprint, s.base, s.top if top == "spec" else top, levels=levels, params=params
    )


def build(it: Item, ctx: BuildCtx = CTX) -> list[MeshNode]:
    return REGISTRY[it.type].fn(it, ctx)


def expand(nodes: list[MeshNode]) -> dict[str, trimesh.Trimesh]:
    out = {}
    for n in nodes:
        g = n.geometry
        if isinstance(g, Instanced):
            parts = []
            for xf in g.transforms:
                m = g.mesh.copy()
                m.apply_transform(xf)
                parts.append(m)
            out[n.name] = trimesh.util.concatenate(parts)
        else:
            out[n.name] = g
    return out


def all_vertices(nodes) -> np.ndarray:
    return np.vstack([m.vertices for m in expand(nodes).values()])


def footprint_local(it: Item) -> np.ndarray:
    return k.local_pts(it, CTX, footprint_polygon(it.footprint))


def node(nodes, name) -> MeshNode:
    return next(n for n in nodes if n.name == name)


def instances(nodes, name) -> int:
    return len(node(nodes, name).geometry.transforms)


# ---------------------------------------------------------------- per-type invariants
@pytest.mark.parametrize("type_", TYPES)
def test_bounds_stay_inside_footprint_and_height(type_):
    s = SPECS[type_]
    it = case(type_)
    v = all_vertices(build(it))
    ring = footprint_local(it)
    assert v[:, 0].min() >= ring[:, 0].min() - s.pad_xz and v[:, 0].max() <= ring[:, 0].max() + s.pad_xz
    assert v[:, 2].min() >= ring[:, 1].min() - s.pad_xz and v[:, 2].max() <= ring[:, 1].max() + s.pad_xz
    h = s.top - s.base
    assert v[:, 1].min() >= -1e-6
    assert v[:, 1].max() <= h + s.pad_y + 1e-6
    assert v[:, 1].max() >= h - 1e-6  # reaches its top


@pytest.mark.parametrize("type_", TYPES)
def test_nodes_are_named_coloured_and_meet_the_realism_floor(type_):
    nodes = build(case(type_))
    names = [n.name for n in nodes]
    assert len(names) == len(set(names)), names
    assert SPECS[type_].required <= set(names), SPECS[type_].required - set(names)
    if SPECS[type_].piped:
        assert any(n.startswith("pipes_") for n in names)
    for n in nodes:
        assert n.material in PALETTE, (n.name, n.material)
        g = n.geometry
        mesh = g.mesh if isinstance(g, Instanced) else g
        assert len(mesh.faces) > 0, n.name
        assert np.isfinite(mesh.vertices).all(), n.name
        if isinstance(g, Instanced):
            assert g.transforms.shape[1:] == (4, 4) and len(g.transforms) >= 1
            assert np.isfinite(g.transforms).all()


@pytest.mark.parametrize("type_", TYPES)
def test_build_is_deterministic(type_):
    a, b = build(case(type_)), build(case(type_))
    assert [n.name for n in a] == [n.name for n in b]
    for x, y in zip(a, b, strict=True):
        if isinstance(x.geometry, Instanced):
            assert np.array_equal(x.geometry.transforms, y.geometry.transforms)
            assert np.array_equal(x.geometry.mesh.vertices, y.geometry.mesh.vertices)
        else:
            assert np.array_equal(x.geometry.vertices, y.geometry.vertices)
            assert np.array_equal(x.geometry.faces, y.geometry.faces)


@pytest.mark.parametrize("type_", TYPES)
@pytest.mark.parametrize("rot", [30.0, 90.0])
def test_rot_deg_turns_the_build_clockwise_from_north(type_, rot):
    plain = build(case(type_, footprint=SPECS[type_].rot))
    turned = build(case(type_, footprint=dict(SPECS[type_].rot, rot_deg=rot)))
    assert k.triangles(turned) == k.triangles(plain)
    v = all_vertices(turned)
    t = math.radians(rot)  # local (x = N, z = E); plant clockwise from north -> undo it
    back = np.c_[
        v[:, 0] * math.cos(t) + v[:, 2] * math.sin(t), v[:, 1], -v[:, 0] * math.sin(t) + v[:, 2] * math.cos(t)
    ]
    p = all_vertices(plain)
    # 5 cm: a cylinder's facets do not turn with the item
    assert np.allclose(back.min(axis=0), p.min(axis=0), atol=0.05)
    assert np.allclose(back.max(axis=0), p.max(axis=0), atol=0.05)


@pytest.mark.parametrize("type_", TYPES)
def test_missing_top_uses_the_default_height_and_says_so(type_):
    nodes = build(case(type_, top=None))
    assert nodes[0].extras["defaults"][-1] == "height"
    assert all_vertices(nodes)[:, 1].max() >= REGISTRY[type_].default_height_m - 1e-6


@pytest.mark.parametrize("type_", TYPES)
def test_every_param_has_a_default_and_defaults_are_recorded(type_):
    params_cls = REGISTRY[type_].params
    params_cls()  # every field has a default
    nodes = build(case(type_))
    assert nodes[0].extras["defaults"] == sorted(params_cls.model_fields)  # top given: no "height"


@pytest.mark.parametrize("type_", TYPES)
def test_lower_lod_never_adds_triangles(type_):
    it = case(type_)
    assert k.triangles(build(it, BuildCtx(grid=None, lod=0.5))) <= k.triangles(build(it))


# ---------------------------------------------------------------- piled decks (task 3)
def test_given_params_are_not_listed_as_defaults():
    defaults = build(case("trestle", params={"bay_spacing_m": 10.0}))[0].extras["defaults"]
    assert "bay_spacing_m" not in defaults and "pile_d_m" in defaults


def test_trestle_deck_top_follows_levels():
    deck = node(build(case("trestle", levels=[103.0])), "deck").geometry
    assert deck.bounds[1][1] == pytest.approx(103.0 - 93.56)


def test_trestle_pile_bents_and_rack_band():
    nodes = build(case("trestle"))
    assert instances(nodes, "piles") == 21  # 7 bents (40 m at 7.5 m) x 3 piles (12 m at 7.5 m)
    assert instances(nodes, "rack_sleepers") == 8  # every 6 m over 38 m
    no_rack = build(case("trestle", params={"rack_side": "none"}))
    assert not any(n.name.startswith("pipes_") or n.name == "rack_sleepers" for n in no_rack)


def test_close_pile_spacing_keeps_every_pile():
    # jetty 30 x 20: 5 rows (30 m at 7.5 m) x 11 piles (20 m at 2 m) = 55, none lost to dedupe
    assert instances(build(case("jetty_platform", params={"pile_spacing_m": 2.0})), "piles") == 55
    # trestle 40 x 12: 7 bents (40 m at 7.5 m) x 7 piles (12 m at 2 m) = 49
    assert instances(build(case("trestle", params={"pile_spacing_m": 2.0})), "piles") == 49


def test_trestle_rack_band_sits_on_the_chosen_side():
    right = node(build(case("trestle")), "rack_sleepers").geometry.transforms[:, 2, 3]
    left = node(build(case("trestle", params={"rack_side": "left"})), "rack_sleepers").geometry.transforms[
        :, 2, 3
    ]
    assert (right > 0).all() and (left < 0).all()  # walking north, right = east = +z


def test_dolphin_pile_group_and_fender_side():
    assert instances(build(case("dolphin")), "piles") == 9
    assert instances(build(case("dolphin", params={"piles_along": 2, "piles_across": 4})), "piles") == 8
    fender = node(build(case("dolphin", params={"fender_side": "left"})), "fender").geometry
    assert fender.bounds[0][2] < -3.0  # west face, past the 6 m cap's -3 m edge


def test_jetty_bollards_are_optional_and_instanced():
    assert "bollards" not in {n.name for n in build(case("jetty_platform"))}
    nodes = build(case("jetty_platform", params={"bollard_spacing_m": 10.0}))
    assert instances(nodes, "bollards") >= 9  # ~97 m of edge at 10 m


@pytest.mark.parametrize("params", [{"pile_d_m": -1}, {"bay_spacing_m": float("nan")}, {"bogus": 1}])
def test_bad_params_fall_back(params):
    _nodes, flags = build_item(case("trestle", params=params), CTX)
    assert [f.code for f in flags] == ["builder_fallback"]
