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
    # tolerance below the smaller spacing, so only piles shared by two runs merge, never a bent's own
    piles = k.dedupe(np.vstack(bents), min(p.bay_spacing_m, p.pile_spacing_m) * 0.45)
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


# ---------------------------------------------------------------- racks, sleepers, overbridges
class PipeRackParams(_P):
    bent_spacing_m: float = Field(6.0, gt=1, le=30)
    columns_across: int = Field(2, ge=1, le=6)
    n_tiers: int = Field(2, ge=1, le=6, description="used when levels is empty")
    tier_gap_m: float = Field(2.0, gt=0.3, le=10)
    column_section_m: float = Field(0.35, gt=0.05, le=2)
    beam_depth_m: float = Field(0.35, gt=0.05, le=2)
    bracing: Literal["none", "end_bays", "all"] = "end_bays"
    lines: list[RackLine] = Field(default_factory=list, max_length=200)
    pipe_fill: bool = Field(True, description="draw indicative pipes when lines is empty")


def _tiers(item: Item, base: float, h: float, n: int, gap: float) -> list[float]:
    ys = _levels(item, base, h)
    if not ys:
        ys = [h - gap * i for i in range(n)]
        ys = sorted(y for y in ys if y > 0.5) or [h]
    if abs(ys[-1] - h) > 1e-6:
        ys = sorted(set(ys) | {h})
    return ys


def _rack(item, ctx, p, base, h, bent_spacing, bracing, knee=False):
    tiers = _tiers(item, base, h, p.n_tiers, p.tier_gap_m)
    c, bd = p.column_section_m, p.beam_depth_m
    cols, cross, longs, braces, lines = [], [], [], [], []
    for run in k.runs(item, ctx):
        ss = (
            np.linspace(-run.width / 2 + c / 2, run.width / 2 - c / 2, p.columns_across)
            if p.columns_across > 1
            else np.zeros(1)
        )
        ts = k.stations(run.length, bent_spacing, c / 2)
        cols += [(run.at(t, s), run.u) for t in ts for s in ss]
        for t in ts:
            for y in tiers:
                cross.append(
                    k.member(
                        k.xz(run.at(t, ss[0] - c / 2), y - bd / 2),
                        k.xz(run.at(t, ss[-1] + c / 2), y - bd / 2),
                        c,
                        bd,
                    )
                )
        for s in ss:
            for y in tiers:
                longs.append(
                    k.member(
                        k.xz(run.at(0, s), y - bd / 2),
                        k.xz(run.at(run.length, s), y - bd / 2),
                        0.25,
                        bd * 0.8,
                    )
                )
        bays = list(zip(ts[:-1], ts[1:], strict=True))
        pick = (
            bays
            if bracing == "all"
            else (sorted({bays[0], bays[-1]}) if bracing == "end_bays" and bays else [])
        )
        for t0, t1 in pick:
            for s in ss:
                braces.append(k.member(k.xz(run.at(t0, s), FOOT), k.xz(run.at(t1, s), tiers[0] - bd), 0.15))
                braces.append(k.member(k.xz(run.at(t1, s), FOOT), k.xz(run.at(t0, s), tiers[0] - bd), 0.15))
        if knee:
            for t, dt in ((ts[0], 1.0), (ts[-1], -1.0)):
                for s in ss:
                    braces.append(
                        k.member(
                            k.xz(run.at(t, s), tiers[-1] - 1.2), k.xz(run.at(t + dt, s), tiers[-1] - bd), 0.15
                        )
                    )
        for d, ins, y, s in _fill_lines(run.width - 2 * c, tiers, p.lines, p.pipe_fill):
            lines.append((d, ins, k.xz(run.at(0, s), y + d / 2), k.xz(run.at(run.length, s), y + d / 2)))
    keep = k.dedupe_index(np.array([q for q, _ in cols]), 0.1)
    col = k.column_mesh(tiers[-1], c)
    xf = np.concatenate([k.posed(k.xz(cols[i][0], 0.0)[None], cols[i][1]) for i in keep])
    nodes = [
        MeshNode("columns", "Steel_Structure", Instanced(col, xf)),
        MeshNode("beams", "Steel_Structure", k.merge(cross + longs)),
    ]
    if braces:
        nodes.append(MeshNode("bracing", "Steel_Structure", k.merge(braces)))
    nodes += k.pipe_nodes(lines, ctx)
    return nodes


RACK_DOC = (
    "Steel pipe rack: column bents at bent spacing, a cross beam per tier per bent, longitudinal beams, "
    "bracing in the end bays, and pipes along the rack (params.lines, or an indicative fill). "
    "Footprint: line (centreline + rack width; preferred), rect or polygon (long axis). base_el = grade; "
    "top_el = top of steel of the highest tier; levels = tier elevations (top of steel)."
)


@builder("pipe_rack", family="structure", params=PipeRackParams, doc=RACK_DOC, default_height_m=6.0)
def build_pipe_rack(item: Item, ctx: BuildCtx) -> list[MeshNode]:
    p = PipeRackParams.model_validate(item.params)
    base, top_el, dflt = ctx.height(item, 6.0)
    nodes = _rack(item, ctx, p, base, top_el - base, p.bent_spacing_m, p.bracing)
    return _stamp(nodes, p, dflt)


class OverbridgeParams(_P):
    columns_across: int = Field(2, ge=2, le=4)
    n_tiers: int = Field(2, ge=1, le=4)
    tier_gap_m: float = Field(1.5, gt=0.3, le=6)
    column_section_m: float = Field(0.35, gt=0.05, le=2)
    beam_depth_m: float = Field(0.35, gt=0.05, le=2)
    lines: list[RackLine] = Field(default_factory=list, max_length=100)
    pipe_fill: bool = True


OVERBRIDGE_DOC = (
    "Pipe overbridge over a road: two portal frames at the ends of the span with knee braces, cross and "
    "longitudinal beams per tier, pipes along the span. Footprint: rect (along = span direction) or line "
    "(span centreline + width). base_el = grade; top_el = top of steel; levels = tier elevations."
)


@builder("overbridge", family="structure", params=OverbridgeParams, doc=OVERBRIDGE_DOC, default_height_m=7.0)
def build_overbridge(item: Item, ctx: BuildCtx) -> list[MeshNode]:
    p = OverbridgeParams.model_validate(item.params)
    base, top_el, dflt = ctx.height(item, 7.0)
    nodes = _rack(item, ctx, p, base, top_el - base, 1e6, "none", knee=True)
    return _stamp(nodes, p, dflt)


class PipeSleeperParams(_P):
    sleeper_spacing_m: float = Field(6.0, gt=0.5, le=30)
    sleeper_width_m: float = Field(0.5, gt=0.1, le=3)
    lines: list[RackLine] = Field(default_factory=list, max_length=200)
    pipe_fill: bool = True


SLEEPER_DOC = (
    "Pipe sleeper band at grade: concrete sleepers across the band at spacing, pipes running along on "
    "top. Footprint: line (centreline + band width; preferred) or rect. base_el = grade; top_el = top of "
    "sleepers (pipes rest on it)."
)


@builder("pipe_sleeper", family="structure", params=PipeSleeperParams, doc=SLEEPER_DOC, default_height_m=0.6)
def build_pipe_sleeper(item: Item, ctx: BuildCtx) -> list[MeshNode]:
    p = PipeSleeperParams.model_validate(item.params)
    base, top_el, dflt = ctx.height(item, 0.6)
    h = top_el - base
    xf, lines = [], []
    rs = k.runs(item, ctx)
    width = rs[0].width
    for run in rs:
        for t in k.stations(run.length, p.sleeper_spacing_m, p.sleeper_width_m / 2):
            xf.append(k.posed(k.xz(run.at(t), h / 2)[None], run.v)[0])
        for d, ins, _y, s in _fill_lines(run.width - 0.2, [h], p.lines, p.pipe_fill):
            lines.append((d, ins, k.xz(run.at(0, s), h + d / 2), k.xz(run.at(run.length, s), h + d / 2)))
    sl = k.block((width, h, p.sleeper_width_m))
    nodes = [MeshNode("sleepers", "Concrete", Instanced(sl, np.array(xf)))] + k.pipe_nodes(lines, ctx)
    return _stamp(nodes, p, dflt)


# ---------------------------------------------------------------- catwalk, walkway, gangway
class CatwalkParams(_P):
    panel_m: float = Field(3.5, gt=0.5, le=10, description="truss panel length")
    chord_m: float = Field(0.2, gt=0.05, le=1)
    grating_m: float = Field(0.08, gt=0.01, le=0.5)
    handrail: bool = True
    post_spacing_m: float = Field(3.0, gt=0.5, le=10)


CATWALK_DOC = (
    "Steel truss catwalk spanning between structures (dolphins, platforms): two side trusses (chords, "
    "verticals, diagonals), cross beams, grating deck on top, handrails both sides. Footprint: line "
    "(centreline + walkway width). base_el = truss bottom chord; top_el = walking level (truss depth "
    "= top_el - base_el, default 1.5 m)."
)


@builder("catwalk", family="structure", params=CatwalkParams, doc=CATWALK_DOC, default_height_m=1.5)
def build_catwalk(item: Item, ctx: BuildCtx) -> list[MeshNode]:
    p = CatwalkParams.model_validate(item.params)
    base, top_el, dflt = ctx.height(item, 1.5)
    h = top_el - base
    ring = k.outline(item, ctx)
    nodes = [MeshNode("deck", "Grating", k.slab(ring, h - p.grating_m, h))]
    chords, diag, verts, cross, rails = [], [], [], [], []
    yt, yb = h - p.grating_m - p.chord_m / 2, p.chord_m / 2
    for run in k.runs(item, ctx):
        ts = k.stations(run.length, p.panel_m)
        for s in (-run.width / 2 + p.chord_m / 2, run.width / 2 - p.chord_m / 2):
            for y in (yt, yb):
                chords.append(k.member(k.xz(run.at(0, s), y), k.xz(run.at(run.length, s), y), p.chord_m))
            verts += [(k.xz(run.at(t, s), yb), run.u) for t in ts]
            for i, (t0, t1) in enumerate(zip(ts[:-1], ts[1:], strict=True)):
                a, b = (yb, yt) if i % 2 == 0 else (yt, yb)
                diag.append(k.member(k.xz(run.at(t0, s), a), k.xz(run.at(t1, s), b), p.chord_m * 0.6))
        for t in ts:
            cross.append(
                k.member(
                    k.xz(run.at(t, -run.width / 2), yt), k.xz(run.at(t, run.width / 2), yt), p.chord_m * 0.8
                )
            )
        if p.handrail:
            for s in (-run.width / 2 + 0.05, run.width / 2 - 0.05):
                rails += k.handrail(
                    np.array([run.at(0, s), run.at(run.length, s)]),
                    h,
                    height=RAIL_H,
                    spacing=p.post_spacing_m,
                    closed=False,
                    lod=ctx.lod,
                )
    vert = k.column_mesh(max(yt - yb, 0.05), p.chord_m * 0.6)
    nodes += [
        MeshNode("chords", "Steel_Structure", k.merge(chords + cross)),
        MeshNode(
            "verticals",
            "Steel_Structure",
            Instanced(vert, np.concatenate([k.posed(q[None], u) for q, u in verts])),
        ),
        MeshNode("diagonals", "Steel_Structure", k.merge(diag)),
    ]
    nodes += _merge_rails(rails)
    return _stamp(nodes, p, dflt)


class WalkwayParams(_P):
    deck_thickness_m: float = Field(0.05, gt=0.01, le=0.5)
    panel_m: float = Field(6.0, gt=0.5, le=20, description="grating panel length along the walkway")
    handrail: bool = False
    post_spacing_m: float = Field(3.0, gt=0.5, le=10)


WALKWAY_DOC = (
    "Grating walkway at grade or on a roof: grating panels on two bearers, optional handrails. "
    "Footprint: line (centreline + width), rect or polygon. base_el = the surface it stands on; top_el = "
    "walking level (default 0.3 m above)."
)


@builder("walkway", family="structure", params=WalkwayParams, doc=WALKWAY_DOC, default_height_m=0.3)
def build_walkway(item: Item, ctx: BuildCtx) -> list[MeshNode]:
    p = WalkwayParams.model_validate(item.params)
    base, top_el, dflt = ctx.height(item, 0.3)
    h = top_el - base
    ring = k.outline(item, ctx)
    poly = Polygon(ring)
    y0 = max(h - p.deck_thickness_m, 0.0)
    panels, stools, rails = [], [], []
    for run in k.runs(item, ctx):
        ts = k.stations(run.length, p.panel_m)
        for t0, t1 in zip(ts[:-1], ts[1:], strict=True):
            strip = Polygon(
                [
                    run.at(t0 + 0.025, -run.width),
                    run.at(t1 - 0.025, -run.width),
                    run.at(t1 - 0.025, run.width),
                    run.at(t0 + 0.025, run.width),
                ]
            )
            piece = poly.intersection(strip)
            for g in getattr(piece, "geoms", [piece]):
                if isinstance(g, Polygon) and g.area > 0.01:
                    panels.append(
                        k.slab(np.asarray(g.exterior.coords)[:-1], y0, max(h, y0 + p.deck_thickness_m))
                    )
        if y0 > 0.02:
            for s in (-run.width / 2 + 0.15, run.width / 2 - 0.15):
                stools.append(
                    k.member(k.xz(run.at(0, s), y0 / 2), k.xz(run.at(run.length, s), y0 / 2), 0.1, y0)
                )
        if p.handrail:
            for s in (-run.width / 2 + 0.05, run.width / 2 - 0.05):
                rails += k.handrail(
                    np.array([run.at(0, s), run.at(run.length, s)]),
                    h,
                    height=RAIL_H,
                    spacing=p.post_spacing_m,
                    closed=False,
                    lod=ctx.lod,
                )
    if not panels:
        panels = [k.slab(ring, y0, max(h, y0 + p.deck_thickness_m))]
    nodes = [MeshNode("deck", "Grating", k.merge(panels))]
    if stools:
        nodes.append(MeshNode("bearers", "Steel_Structure", k.merge(stools)))
    nodes += _merge_rails(rails)
    return _stamp(nodes, p, dflt)


class GangwayParams(_P):
    tower_size_m: float = Field(1.8, gt=0.5, le=6)
    boom_width_m: float = Field(1.0, gt=0.4, le=3)
    boom_slope_deg: float = Field(15.0, ge=0, le=45)
    rung_spacing_m: float = Field(0.5, gt=0.2, le=2)
    counterweight: bool = True


GANGWAY_DOC = (
    "Shore gangway / gangway tower: braced steel tower with a top platform at the footprint's start, a "
    "boom (stringers, treads, handrails) sloping down along the footprint, a counterweight. Footprint: "
    "rect (along = boom direction, tower at the low-along end) or line (tower at the first point). "
    "base_el = deck the tower stands on; top_el = tower top platform."
)


@builder("gangway", family="structure", params=GangwayParams, doc=GANGWAY_DOC, default_height_m=6.0)
def build_gangway(item: Item, ctx: BuildCtx) -> list[MeshNode]:
    p = GangwayParams.model_validate(item.params)
    base, top_el, dflt = ctx.height(item, 6.0)
    h = top_el - base
    run = k.runs(item, ctx)[0]
    ts = min(p.tower_size_m, run.length / 3, run.width)
    c = 0.2
    corners = [run.at(t, s) for t in (c / 2, ts - c / 2) for s in (-ts / 2 + c / 2, ts / 2 - c / 2)]
    nodes = [
        MeshNode(
            "tower_columns",
            "Steel_Structure",
            Instanced(k.column_mesh(h, c), k.posed(np.array([k.xz(q, 0.0) for q in corners]), run.u)),
        )
    ]
    braces = []
    order = [0, 1, 3, 2, 0]
    n_pan = max(1, round(h / 3))
    for a, b in zip(order[:-1], order[1:], strict=True):
        for j in range(n_pan):
            y0, y1 = h * j / n_pan, h * (j + 1) / n_pan
            pa, pb = (corners[a], corners[b]) if j % 2 == 0 else (corners[b], corners[a])
            braces.append(k.member(k.xz(pa, max(y0, FOOT)), k.xz(pb, y1), 0.1))
    nodes.append(MeshNode("tower_bracing", "Steel_Structure", k.merge(braces)))
    top_ring = np.array([run.at(0, -ts / 2), run.at(ts, -ts / 2), run.at(ts, ts / 2), run.at(0, ts / 2)])
    nodes.append(MeshNode("tower_platform", "Grating", k.slab(top_ring, h - 0.05, h)))
    nodes += k.handrail(top_ring, h, height=RAIL_H, spacing=2.5, closed=True, lod=ctx.lod)
    span = max(run.length - ts, 0.5)
    drop = min(span * math.tan(math.radians(p.boom_slope_deg)), max(h - 0.5, 0.0))
    t0, t1 = ts, ts + span
    y0, y1 = h, h - drop
    bw = p.boom_width_m
    boom = []
    for s in (-bw / 2, bw / 2):
        boom.append(k.member(k.xz(run.at(t0, s), y0 - 0.15), k.xz(run.at(t1, s), y1 - 0.15), 0.12, 0.3))
        boom.append(k.member(k.xz(run.at(t0, s), y0 + RAIL_H), k.xz(run.at(t1, s), y1 + RAIL_H), 0.05))
        for t in k.stations(span, 2.5):
            yy = y0 + (y1 - y0) * t / span
            boom.append(k.member(k.xz(run.at(t0 + t, s), yy), k.xz(run.at(t0 + t, s), yy + RAIL_H), 0.05))
    nodes.append(MeshNode("boom", "Steel_Structure", k.merge(boom)))
    n_r = max(2, int(span / p.rung_spacing_m))
    tr = [k.xz(run.at(t0 + span * (i + 0.5) / n_r), y0 + (y1 - y0) * (i + 0.5) / n_r) for i in range(n_r)]
    rung = k.block((0.25, 0.04, bw))
    nodes.append(MeshNode("treads", "Grating", Instanced(rung, k.posed(np.array(tr), run.u))))
    if p.counterweight:
        cw = k.placed_block(k.xz(run.at(ts * 0.25), h + 0.5), (ts * 0.4, 1.0, ts * 0.8), run.u)
        nodes.append(MeshNode("counterweight", "Steel_Dark", cw))
    return _stamp(nodes, p, dflt)
