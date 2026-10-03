"""Structure builders (B1): the 11 structure types of spec §6, at or above Cowork's detail.

Each builder: a params model (all fields defaulted), a function Item -> list[MeshNode] in the
item-local frame (metres, Y up from base_el, x north, z east), a catalogue doc, a default height.
Repeated members (piles, columns, posts, treads, sleepers, pipes) are Instanced. The first node
carries extras["defaults"]: the param names not given, plus "height" (ruling R1).
Height rule (ruling R2): top_el is the deck / walking level or the top of steel; handrails, fenders
and pipes resting on the top tier may stand above it.
"""

from __future__ import annotations

import math
from typing import Literal

import numpy as np
from pydantic import Field
from shapely.geometry import Point, Polygon

from app.asset_models.builders import geom
from app.asset_models.builders import structure_kit as k
from app.asset_models.builders.base import BuildCtx, Instanced, MeshNode, Params, builder
from app.asset_models.spec import Item

RAIL_H = 1.1
FOOT = 0.15  # inclined members start this far above their base, so their section stays above it
DEFAULT_PIPE_D = (0.3, 0.45, 0.6, 0.36)


class _P(Params):
    """Strict params base: builders.base.Params (extra=forbid, allow_inf_nan=False)."""


class RackLine(_P):
    d_m: float = Field(gt=0, le=3.0, description="outside diameter incl. insulation, m")
    tier: int = Field(0, ge=0, le=9, description="0 = lowest tier")
    insulated: bool = False
    count: int = Field(1, ge=1, le=100)


def _stamp(nodes: list[MeshNode], p: _P, height_defaulted: bool) -> list[MeshNode]:
    """Record defaulted params on the first node (B3's convention, ruling R1): a sorted list of the
    param names not given, then "height" when ctx.height defaulted. A1 writes it to CSV notes."""
    names = sorted(set(type(p).model_fields) - p.model_fields_set)
    nodes[0].extras["defaults"] = [*names, "height"] if height_defaulted else names
    return nodes


def _levels(item: Item, base: float, h: float) -> list[float]:
    """item.levels as local y, kept inside (0, h], ascending, unique to 1 cm."""
    ys = sorted({round(lv - base, 2) for lv in item.levels if 0 < lv - base <= h + 1e-6})
    return ys


def _fill_lines(width: float, tiers: list[float], lines: list[RackLine], fill: bool):
    """[(d, insulated, tier_y, s)] pipe positions across a width; explicit lines win over the fill."""
    per_tier: dict[int, list[tuple[float, bool]]] = {}
    if lines:
        for ln in lines:
            t = min(ln.tier, len(tiers) - 1)
            per_tier.setdefault(t, []).extend([(ln.d_m, ln.insulated)] * ln.count)
    elif fill:
        n = int(min(16, max(2, width // 0.8)))
        for t in range(len(tiers)):
            per_tier[t] = [(DEFAULT_PIPE_D[i % 4], i % 3 == 2) for i in range(n)]
    out = []
    for t, pipes in per_tier.items():
        slots = (np.arange(len(pipes)) + 0.5) / len(pipes) * width - width / 2
        out += [(d, ins, tiers[t], float(s)) for (d, ins), s in zip(pipes, slots, strict=True)]
    return out


# ---------------------------------------------------------------- piled decks (trestle, jetty)
class TrestleParams(_P):
    deck_thickness_m: float = Field(1.2, gt=0, le=5)
    bay_spacing_m: float = Field(7.5, gt=1, le=60, description="pile bent spacing along the trestle")
    pile_spacing_m: float = Field(7.5, gt=1, le=30, description="pile spacing across a bent")
    pile_d_m: float = Field(1.1, gt=0.1, le=4)
    pile_inset_m: float = Field(0.6, ge=0, le=5)
    headstock: bool = True
    bracing: bool = True
    handrail: bool = True
    post_spacing_m: float = Field(3.0, gt=0.5, le=10)
    rack_side: Literal["none", "left", "right"] = "right"
    rack_width_m: float = Field(7.5, gt=0, le=40)
    rack_pipes: int = Field(6, ge=0, le=40)


class JettyPlatformParams(_P):
    deck_thickness_m: float = Field(1.8, gt=0, le=5)
    bay_spacing_m: float = Field(7.5, gt=1, le=60)
    pile_spacing_m: float = Field(7.5, gt=1, le=30)
    pile_d_m: float = Field(1.1, gt=0.1, le=4)
    pile_inset_m: float = Field(0.6, ge=0, le=5)
    headstock: bool = False
    bracing: bool = False
    handrail: bool = True
    post_spacing_m: float = Field(3.0, gt=0.5, le=10)
    bollard_spacing_m: float = Field(0, ge=0, le=100, description="0 = no bollards")


def _deck_top(item: Item, base: float, h: float) -> float:
    ys = _levels(item, base, h)
    return ys[-1] if ys else h


def _piled_deck(item: Item, ctx: BuildCtx, p, base: float, h: float, *, rail: Literal["sides", "perimeter"]):
    ring = k.outline(item, ctx)
    rs = k.runs(item, ctx)
    top = _deck_top(item, base, h)
    deck_bot = top - p.deck_thickness_m
    hs_d = 1.0 if p.headstock else 0.0
    pile_top = max(deck_bot - hs_d, 0.1)
    nodes = [MeshNode("deck", "Concrete", k.slab(ring, deck_bot, top))]
    bents: list[np.ndarray] = []
    for run in rs:
        bents += k.grid_rows(ring, run, p.bay_spacing_m, p.pile_spacing_m, p.pile_inset_m)
    piles = k.dedupe(np.vstack(bents), p.bay_spacing_m * 0.45)
    pile = k.pile_mesh(p.pile_d_m / 2, pile_top, ctx)
    xf = k.translate(np.c_[piles[:, 0], np.zeros(len(piles)), piles[:, 1]])
    nodes.append(MeshNode("piles", "Steel_Dark", Instanced(pile, xf)))
    if p.headstock:
        heads = [
            k.member(
                k.xz(row[0], pile_top + hs_d / 2), k.xz(row[-1], pile_top + hs_d / 2), p.pile_d_m + 0.3, hs_d
            )
            for row in bents
            if len(row) > 1
        ]
        if heads:
            nodes.append(MeshNode("headstocks", "Concrete_Dark", k.merge(heads)))
    if p.bracing:
        braces = []
        for row in bents:
            for i, (a, b) in enumerate(zip(row[:-1], row[1:], strict=True)):
                lo, hi = (a, b) if i % 2 == 0 else (b, a)
                braces.append(k.member(k.xz(lo, pile_top * 0.35), k.xz(hi, pile_top - 0.3), 0.3))
        if braces:
            nodes.append(MeshNode("bracing", "Steel_Dark", k.merge(braces)))
    if p.handrail:
        nodes += _deck_rail(ring, rs, top, p.post_spacing_m, ctx, rail)
    return nodes, ring, rs, top


def _deck_rail(ring, rs, y, spacing, ctx, rail):
    inner = np.asarray(Polygon(ring).buffer(-0.1, join_style=2).exterior.coords, dtype=float)[:-1]
    if rail == "perimeter":
        return k.handrail(inner, y, height=RAIL_H, spacing=spacing, closed=True, lod=ctx.lod)
    out = []
    axes = [r.u for r in rs]
    pts = np.vstack([inner, inner[:1]])
    for a, b in zip(pts[:-1], pts[1:], strict=True):
        d = b - a
        n = np.linalg.norm(d)
        if n < 2.0:
            continue
        if max(abs(float(d @ u)) / n for u in axes) >= math.cos(math.radians(20)):
            out += k.handrail(np.array([a, b]), y, height=RAIL_H, spacing=spacing, closed=False, lod=ctx.lod)
    return _merge_rails(out)


def _merge_rails(nodes: list[MeshNode]) -> list[MeshNode]:
    """Fold several handrail() results into one posts node and one rails node."""
    posts = [n.geometry for n in nodes if n.name == "handrail_posts"]
    rails = [n.geometry for n in nodes if n.name == "handrail_rails"]
    out = []
    if posts:
        out.append(
            MeshNode(
                "handrail_posts",
                "Handrail",
                Instanced(posts[0].mesh, np.concatenate([g.transforms for g in posts])),
            )
        )
    if rails:
        out.append(MeshNode("handrail_rails", "Handrail", k.merge(rails)))
    return out


TRESTLE_DOC = (
    "Piled approach trestle (jetty causeway). Concrete deck slab on steel pile bents at bay spacing, "
    "concrete headstocks, bent bracing, handrail on both long sides, and a pipe-rack band of pipes on "
    "sleepers along one side. Footprint: line (centreline + deck width; one bent line per segment) or "
    "polygon/rect (deck outline; bents across its long axis). base_el = pile base used as model base "
    "(e.g. MSL or seabed); top_el or levels[-1] = deck top. Set rack_side none when there is no rack."
)


@builder("trestle", family="structure", params=TrestleParams, doc=TRESTLE_DOC, default_height_m=11.0)
def build_trestle(item: Item, ctx: BuildCtx) -> list[MeshNode]:
    p = TrestleParams.model_validate(item.params)
    base, top_el, dflt = ctx.height(item, 11.0)
    nodes, ring, rs, top = _piled_deck(item, ctx, p, base, top_el - base, rail="sides")
    if p.rack_side != "none" and p.rack_pipes > 0:
        sign = 1.0 if p.rack_side == "right" else -1.0
        sleepers, lines = [], []
        for run in rs:
            band = min(p.rack_width_m, run.width)
            s0 = sign * (run.width / 2 - band / 2 - 0.2)
            for t in k.stations(run.length, 6.0, 1.0):
                sleepers.append((run.at(t, s0), run.u))
            for d, ins, _y, s in _fill_lines(band - 0.6, [0.0], [], True)[: p.rack_pipes]:
                y = top + 0.5 + d / 2
                lines.append((d, ins, k.xz(run.at(0, s0 + s), y), k.xz(run.at(run.length, s0 + s), y)))
        sl = k.block((0.5, 0.5, max(p.rack_width_m - 0.4, 0.5)))
        sl.apply_translation((0, 0.25, 0))
        pts = np.array([k.xz(c, top) for c, _ in sleepers])
        xf = np.concatenate([k.posed(pt[None], u) for pt, (_, u) in zip(pts, sleepers, strict=True)])
        nodes.append(MeshNode("rack_sleepers", "Concrete", Instanced(sl, xf)))
        nodes += k.pipe_nodes(lines, ctx)
    return _stamp(nodes, p, dflt)


JETTY_DOC = (
    "Jetty head / loading platform / piled deck. Concrete deck (polygon outline) on a steel pile grid "
    "clipped to the outline, handrail round the edge, optional bollards. Footprint: polygon or rect. "
    "base_el = pile base used as model base (e.g. MSL); top_el or levels[-1] = deck top. Equipment on "
    "the deck (loading arms, houses) are separate items."
)


@builder(
    "jetty_platform", family="structure", params=JettyPlatformParams, doc=JETTY_DOC, default_height_m=11.0
)
def build_jetty_platform(item: Item, ctx: BuildCtx) -> list[MeshNode]:
    p = JettyPlatformParams.model_validate(item.params)
    base, top_el, dflt = ctx.height(item, 11.0)
    nodes, ring, _rs, top = _piled_deck(item, ctx, p, base, top_el - base, rail="perimeter")
    if p.bollard_spacing_m > 0:
        edge = Polygon(ring).buffer(-0.8, join_style=2).exterior
        n = max(2, int(edge.length // p.bollard_spacing_m))
        pts = [edge.interpolate(i / n, normalized=True) for i in range(n)]
        bol = geom.cyl(0.25, 0.7, k.segs(0.25, ctx))
        xf = k.translate(np.array([[q.x, top, q.y] for q in pts]))
        nodes.append(MeshNode("bollards", "Steel_Dark", Instanced(bol, xf)))
    return _stamp(nodes, p, dflt)


# ---------------------------------------------------------------- dolphin
class DolphinParams(_P):
    cap_thickness_m: float = Field(1.8, gt=0, le=6)
    pile_d_m: float = Field(1.1, gt=0.1, le=4)
    piles_along: int = Field(3, ge=1, le=10)
    piles_across: int = Field(3, ge=1, le=10)
    pile_inset_m: float = Field(0.8, ge=0, le=5)
    fender: bool = True
    fender_side: Literal["left", "right", "front", "back"] = "right"
    bollards: int = Field(1, ge=0, le=6, description="bollards / quick-release hooks on the cap")


DOLPHIN_DOC = (
    "Mooring or breasting dolphin: concrete cap on a pile group, a fender panel on the berth face, "
    "bollards on top. Footprint: rect (cap; size = along, across) or circle/polygon. base_el = pile base "
    "used as model base (e.g. MSL); top_el = cap top. fender_side: right/left = across the rect's along "
    "axis, front/back = its ends; set fender false for mooring dolphins."
)


@builder("dolphin", family="structure", params=DolphinParams, doc=DOLPHIN_DOC, default_height_m=11.0)
def build_dolphin(item: Item, ctx: BuildCtx) -> list[MeshNode]:
    p = DolphinParams.model_validate(item.params)
    base, top_el, dflt = ctx.height(item, 11.0)
    h = top_el - base
    ring = k.outline(item, ctx)
    run = k.runs(item, ctx)[0]
    cap_bot = max(h - p.cap_thickness_m, 0.1)
    nodes = [MeshNode("cap", "Concrete", k.slab(ring, cap_bot, h))]
    ins = min(p.pile_inset_m, run.length / 3, run.width / 3)
    ts = (
        np.linspace(ins, run.length - ins, p.piles_along) if p.piles_along > 1 else np.array([run.length / 2])
    )
    ss = (
        np.linspace(-run.width / 2 + ins, run.width / 2 - ins, p.piles_across)
        if p.piles_across > 1
        else np.zeros(1)
    )
    poly = Polygon(ring).buffer(1e-6)
    pts = np.array([run.at(t, s) for t in ts for s in ss])
    pts = np.array([q for q in pts if poly.contains(Point(q))] or [run.at(run.length / 2)])
    pile = k.pile_mesh(p.pile_d_m / 2, cap_bot, ctx)
    nodes.append(
        MeshNode(
            "piles",
            "Steel_Dark",
            Instanced(pile, k.translate(np.c_[pts[:, 0], np.zeros(len(pts)), pts[:, 1]])),
        )
    )
    if p.fender:
        side = {
            "right": (run.length / 2, run.width / 2 + 0.7, run.u, 0.7 * run.length),
            "left": (run.length / 2, -run.width / 2 - 0.7, run.u, 0.7 * run.length),
            "front": (run.length + 0.7, 0.0, run.v, 0.7 * run.width),
            "back": (-0.7, 0.0, run.v, 0.7 * run.width),
        }[p.fender_side]
        t, s, u, span = side
        hgt = p.cap_thickness_m + 2.5
        c = k.xz(run.at(t, s), h + 0.5 - hgt / 2)
        nodes.append(MeshNode("fender", "Steel_Dark", k.placed_block(c, (span, hgt, 0.6), u)))
    if p.bollards:
        bol = geom.cyl(0.25, 0.7, k.segs(0.25, ctx))
        ts_b = (np.arange(p.bollards) + 0.5) / p.bollards * run.length
        xf = k.translate(np.array([k.xz(run.at(t, 0.0), h) for t in ts_b]))
        nodes.append(MeshNode("bollards", "Steel_Dark", Instanced(bol, xf)))
    return _stamp(nodes, p, dflt)
