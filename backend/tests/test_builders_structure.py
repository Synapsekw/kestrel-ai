"""Structure builders (B1): spec §6 / §13 gate tests for the 11 structure types."""

from __future__ import annotations

import math
import time
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
SPECS["pipe_rack"] = TypeSpec(
    line([[0, 0], [0, 30]], 6), 100.0, 106.0, rect(30, 6), {"columns", "beams", "bracing"},
    pad_y=0.65, piped=True,
)  # fmt: skip
SPECS["overbridge"] = TypeSpec(
    rect(9, 5), 100.0, 107.0, rect(9, 5), {"columns", "beams", "bracing"}, pad_y=0.65, piped=True
)
SPECS["pipe_sleeper"] = TypeSpec(
    line([[0, 0], [0, 30]], 4), 100.0, 100.6, rect(30, 4), {"sleepers"}, pad_y=0.65, piped=True
)
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


# ---------------------------------------------------------------- racks (task 4)
def _pipe_centres_y(nodes) -> set[float]:
    return {
        round(float(xf[1, 3]), 3)
        for n in nodes
        if n.name.startswith("pipes_")
        for xf in n.geometry.transforms
    }


def test_pipe_rack_bents_tiers_and_pipes():
    nodes = build(case("pipe_rack"))
    assert instances(nodes, "columns") == 12  # 6 bents over 30 m at 6 m, 2 columns each
    for n in nodes:
        if n.name.startswith("pipes_"):
            assert isinstance(n.geometry, Instanced)
    tiers = {4.0, 6.0}  # n_tiers 2, tier_gap 2 m, top of steel at 6 m
    ys = _pipe_centres_y(nodes)
    assert {min(tiers, key=lambda t: abs(t - y)) for y in ys} == tiers


def test_pipe_rack_tiers_follow_levels():
    ys = _pipe_centres_y(build(case("pipe_rack", levels=[102.0, 104.0, 106.0])))
    tiers = {2.0, 4.0, 6.0}
    assert {min(tiers, key=lambda t: abs(t - y)) for y in ys} == tiers
    assert all(any(0 < y - t <= 0.31 for t in tiers) for y in ys)  # pipe centre = tier + d / 2


def test_pipe_rack_explicit_lines_replace_the_fill():
    lines = [{"d_m": 0.8, "tier": 1, "insulated": True, "count": 3}]
    pipes = [n for n in build(case("pipe_rack", params={"lines": lines})) if n.name.startswith("pipes_")]
    assert [(n.name, n.material, len(n.geometry.transforms)) for n in pipes] == [
        ("pipes_ins_800", "Pipe_Insulated", 3)
    ]
    assert not [
        n for n in build(case("pipe_rack", params={"pipe_fill": False})) if n.name.startswith("pipes_")
    ]


def test_rack_bracing_modes():
    def bracing_faces(mode):
        nodes = build(case("pipe_rack", params={"bracing": mode}))
        hit = [n for n in nodes if n.name == "bracing"]
        return len(hit[0].geometry.faces) if hit else 0

    assert bracing_faces("end_bays") == 2 * 2 * 2 * 8  # 2 end bays x 2 column lines x X (2 members)
    assert bracing_faces("all") == 5 * 2 * 2 * 8
    assert bracing_faces("none") == 0


def test_overbridge_is_two_portals_with_pipes_along_the_span():
    nodes = build(case("overbridge"))
    assert instances(nodes, "columns") == 4
    xf = next(n for n in nodes if n.name.startswith("pipes_")).geometry.transforms[0]
    axis = xf[:3, :3] @ [0, 1, 0]
    assert abs(axis[0]) == pytest.approx(9.0, abs=1e-6)  # pipes run the 9 m span (north)


def test_sleepers_cross_the_band_at_spacing():
    nodes = build(case("pipe_sleeper"))
    assert instances(nodes, "sleepers") == 6  # 30 m at 6 m, 0.25 m in from each end
    v = expand(nodes)["sleepers"].vertices
    assert np.ptp(v[:, 2]) == pytest.approx(4.0)  # full band width across (east)


def test_rot_90_swaps_the_plan_extents():
    a = all_vertices(build(case("pipe_rack", footprint=rect(30, 6))))
    b = all_vertices(build(case("pipe_rack", footprint=rect(30, 6, rot=90))))
    ea, eb = np.ptp(a, axis=0), np.ptp(b, axis=0)
    assert ea[0] == pytest.approx(eb[2], abs=0.05) and ea[2] == pytest.approx(eb[0], abs=0.05)
    assert ea[0] > 29 and eb[2] > 29  # rot 0 runs north (x); rot 90 runs east (z)


def _dist_to_polyline(p, pts) -> float:
    best = math.inf
    for a, b in zip(pts[:-1], pts[1:], strict=True):
        ab = b - a
        t = np.clip((p - a) @ ab / (ab @ ab), 0, 1)
        best = min(best, float(np.linalg.norm(p - (a + t * ab))))
    return best


@pytest.mark.parametrize(
    ("type_", "member"), [("pipe_rack", "columns"), ("trestle", "piles"), ("pipe_sleeper", "sleepers")]
)
def test_line_footprint_follows_the_polyline(type_, member):
    pts = [[0, 0], [0, 40], [30, 70]]
    width = SPECS[type_].footprint["width"]
    it = case(type_, footprint=line(pts, width))
    loc = k.local_pts(it, CTX, pts)
    centres = node(build(it), member).geometry.transforms[:, [0, 2], 3]
    assert all(_dist_to_polyline(c, loc) <= width / 2 + 1e-6 for c in centres)
    for leg in ((loc[0] + loc[1]) / 2, (loc[1] + loc[2]) / 2):  # both legs carry members
        assert min(np.linalg.norm(centres - leg, axis=1)) < 8.0
    if type_ == "pipe_rack":  # the shared corner column is not doubled
        d = np.linalg.norm(centres[:, None] - centres[None], axis=2) + np.eye(len(centres)) * 1e9
        assert d.min() >= 0.1


def test_zero_length_line_raises_and_build_item_falls_back():
    it = case("pipe_rack", footprint=line([[5, 5], [5, 5]], 6))
    with pytest.raises(ValueError):
        build(it)
    _nodes, flags = build_item(it, CTX)
    assert [f.code for f in flags] == ["builder_fallback"]


def test_a_three_km_polyline_builds_quickly():
    pts = [[i * 50.0, (i % 2) * 5.0] for i in range(61)]  # 3 km zig-zag, 60 legs
    for type_ in ("pipe_rack", "trestle"):
        it = case(type_, footprint=line(pts, SPECS[type_].footprint["width"]))
        t0 = time.perf_counter()
        nodes = build(it)
        assert time.perf_counter() - t0 < 5.0, type_
        assert k.triangles(nodes) < 200_000, type_
