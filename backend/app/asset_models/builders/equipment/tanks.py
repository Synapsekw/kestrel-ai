"""Tanks: storage_tank_small and tank_lng (unit B2)."""

from __future__ import annotations

import math
from collections import Counter
from dataclasses import dataclass
from typing import Literal

import numpy as np
import trimesh
from pydantic import Field
from shapely.geometry import Point, Polygon

from app.asset_models.builders.base import BuildCtx, MeshNode, Params, builder
from app.asset_models.builders.equipment import _kit as k
from app.asset_models.builders.equipment.vessels import head_depth
from app.asset_models.spec import Item, NonNeg, Pos

H_STS = 8.0
FOUND_H = 0.3
TANK_POST_PITCH = 1.0  # small tank roof rail; dense like Cowork's


class StorageTankSmallParams(Params):
    form: Literal["auto", "vertical", "horizontal"] = Field(
        "auto", description="auto: circle footprint -> vertical tank, otherwise a horizontal tank in a bund"
    )
    roof: Literal["cone", "dome", "flat"] = "cone"
    roof_slope: float = Field(0.2, gt=0, le=1, description="Cone roof rise per run")
    handrail: bool = True
    ladder: bool = True
    bund_h_m: NonNeg = Field(0.6, description="Horizontal form: concrete bund wall height, m (0 = none)")


DOC_STS = (
    "Small storage tank. Vertical form (circle footprint = shell OD): concrete ring foundation, shell, "
    "cone/dome/flat roof, roof-edge handrail and a ladder. Horizontal form (rect footprint): cylindrical "
    "tank on two saddles inside a low concrete bund. top_el = roof crown or handrail top."
)


@builder(
    "storage_tank_small",
    family="equipment",
    params=StorageTankSmallParams,
    doc=DOC_STS,
    default_height_m=H_STS,
)
def build_storage_tank_small(item: Item, ctx: BuildCtx) -> list[MeshNode]:
    p = k.params(item, StorageTankSmallParams)
    plan = k.plan_of(item, ctx)
    H, _ = k.height(item, ctx, H_STS)
    form = p.form if p.form != "auto" else ("vertical" if plan.is_round else "horizontal")
    if form == "vertical":
        nodes, derived = _vertical(p, plan, H, ctx)
    else:
        nodes, derived = _horizontal(p, plan, H, ctx)
    return k.finish(k.turn(nodes, plan.place()), item, p, {"form": form, **derived})


def _vertical(p: StorageTankSmallParams, plan: k.Plan, H: float, ctx: BuildCtx):
    r = min(plan.along, plan.across) / 2
    rise = {"cone": min(r * p.roof_slope, 0.25 * H), "dome": min(0.3 * r, 0.25 * H), "flat": 0.0}[p.roof]
    rail = k.RAIL_H if p.handrail else 0.0
    y_s = H - max(rise, rail, 0.05)
    if y_s - FOUND_H < 0.3:
        raise ValueError("storage_tank_small: height too small for the shell")
    if p.roof == "cone":
        roof = k.lathe([(0.0, y_s), (r + 0.05, y_s), (0.0, y_s + rise)], ctx, r)
    elif p.roof == "dome":
        roof = k.placed(k.ell_cap(r + 0.05, rise, ctx, steps=6), k.T(0, y_s, 0))
    else:
        roof = k.vcyl(r + 0.05, 0.05, ctx, y0=y_s)
    nodes = [
        k.node("foundation", "Concrete", k.vcyl(r + 0.4, FOUND_H, ctx)),
        k.node("shell", "Equipment_White", k.vcyl(r, y_s - FOUND_H, ctx, y0=FOUND_H)),
        k.node("roof", "Equipment_White", roof),
    ]
    if p.handrail:
        nodes += k.ring_handrail("roof", r - 0.15, y_s, ctx, pitch=TANK_POST_PITCH, toe=True)
    if p.ladder:
        nodes += k.ladder("ladder", -(r + 0.4), 0.0, FOUND_H, y_s, 0.0)
    return nodes, {"d_m": 2 * r, "shell_h_m": y_s - FOUND_H}


def _horizontal(p: StorageTankSmallParams, plan: k.Plan, H: float, ctx: BuildCtx):
    L, W = plan.along, plan.across
    nh = min(0.4, 0.1 * H)  # vent stub above the shell crown
    d = min(W - 0.6, H - 0.5 - nh)
    if d < 0.2:
        raise ValueError("storage_tank_small: footprint or height too small for a horizontal tank")
    r, hd = d / 2, head_depth("ellipsoidal", d)
    yc = H - nh - r
    shell_len = L - 1.0 - 2 * hd
    if shell_len < 0.2:
        raise ValueError("storage_tank_small: footprint too short for a horizontal tank")
    x0, x1 = -shell_len / 2, shell_len / 2
    cap = k.ell_cap(r, hd, ctx, steps=6)
    nodes = []
    if p.bund_h_m > 0:
        b = p.bund_h_m
        nodes.append(
            k.node(
                "bund",
                "Concrete",
                k.box(L, b, 0.2, z=-(W / 2 - 0.1)),
                k.box(L, b, 0.2, z=W / 2 - 0.1),
                k.box(0.2, b, W - 0.4, x=-(L / 2 - 0.1)),
                k.box(0.2, b, W - 0.4, x=L / 2 - 0.1),
            )
        )
    saddles = [k.box(0.4, yc, 0.8 * d, x=x) for x in (-0.3 * shell_len, 0.3 * shell_len)]
    nodes += [
        k.node("saddles", "Concrete", *saddles),
        k.node("shell", "Equipment_White", k.rod((x0, yc, 0), (x1, yc, 0), r, ctx)),
        k.node(
            "heads",
            "Equipment_White",
            k.placed(cap, k.T(x1, yc, 0) @ k.Y_TO_X),
            k.placed(cap, k.T(x0, yc, 0) @ k.S(-1, 1, 1) @ k.Y_TO_X),
        ),
    ]
    xn, rn = 0.2 * shell_len, max(0.04, 0.05 * d)  # vent: from inside the shell up through the crown
    nodes.append(k.node("nozzles", "Pipe", k.rod((xn, yc + 0.7 * r, 0), (xn, H, 0), rn, ctx)))
    return nodes, {"d_m": d, "shell_len_m": shell_len}


H_LNG = 51.5
REF_OD = 93.5  # Cowork 20-T-0001 outer wall OD; default layouts are stored at this size
DOME_RISE_RATIO = 10.5 / 93.5
WALK_CLEAR = 0.6  # walkway deck centre above the dome surface, m


class RoofPlatform(Params):
    kind: Literal["pump", "safety", "instrument", "flare", "unloading"]
    shape: Literal["rect", "arc"] = "rect"
    bearing_deg: float
    r_m: Pos = Field(
        description="Centre (rect) or mid (arc) radius from the tank axis, at the 93.5 m reference"
    )
    depth_m: Pos = Field(description="Radial size, m, at the reference")
    width_m: Pos = Field(1.0, description="Tangential size, m, at the reference (rect)")
    span_deg: float = Field(60.0, gt=0, le=180, description="Angular span (arc)")
    deck_above_wall_m: NonNeg = Field(description="Deck height above the wall top, m, at the reference")


class RoofWalkway(Params):
    from_bearing_deg: float = 311.0
    from_r_m: NonNeg = 36.0
    to_bearing_deg: float = 134.0
    to_r_m: NonNeg = 17.0
    width_m: Pos = 1.5


COWORK_ROOF: tuple[RoofPlatform, ...] = (
    RoofPlatform(kind="pump", bearing_deg=134.0, r_m=34.4, depth_m=35.1, width_m=34.7, deck_above_wall_m=9.3),
    RoofPlatform(
        kind="safety",
        shape="arc",
        bearing_deg=347.0,
        r_m=39.5,
        depth_m=4.0,
        span_deg=110.0,
        deck_above_wall_m=6.7,
    ),
    RoofPlatform(
        kind="instrument", bearing_deg=95.0, r_m=41.0, depth_m=8.4, width_m=18.8, deck_above_wall_m=4.7
    ),
    RoofPlatform(kind="flare", bearing_deg=222.0, r_m=45.0, depth_m=8.9, width_m=15.2, deck_above_wall_m=3.4),
    RoofPlatform(
        kind="unloading", bearing_deg=188.0, r_m=38.5, depth_m=22.4, width_m=37.6, deck_above_wall_m=7.2
    ),
)


class TankLngParams(Params):
    dome_rise_m: Pos | None = Field(
        None, description="Dome rise above the wall top. Default 0.1123 x OD (Cowork)."
    )
    slab_overhang_m: NonNeg = Field(1.5, description="Base slab radius beyond the wall, m")
    slab_t_m: Pos = 1.0
    wall_t_m: Pos = 0.8
    roof_handrail: bool = True
    roof_platforms: list[RoofPlatform] | None = Field(
        None,
        max_length=12,
        description=(
            "None = Cowork's five roof platforms scaled to the OD; [] = none (the drawing tags them as items)"
        ),
    )
    walkway: RoofWalkway | None = Field(
        default_factory=RoofWalkway, description="Walking platform over the dome"
    )
    stair_tower_bearing_deg: float | None = Field(
        115.0, description="Stair tower at grade outside the wall; null = none"
    )
    risers_bearing_deg: float | None = Field(128.0, description="Pipe risers up the wall; null = none")
    riser_od_m: list[Pos] = Field(default_factory=lambda: [0.9, 0.75, 0.6, 0.6, 0.45], max_length=12)


DOC_LNG = (
    "Full-containment LNG tank: base slab, concrete outer wall and dome, roof-edge deck and handrail, roof "
    "platforms (pump, safety, instrument, flare, unloading) and the walking platform, a stair tower and pipe "
    "risers. Footprint: circle = outer wall OD. top_el = dome crown. Roof pumps, jib cranes and the DCP "
    "package are their own items. Switch off parts the drawing tags separately."
)


@dataclass(frozen=True)
class _Dome:
    ro: float
    hw: float
    rise: float

    @property
    def rs(self) -> float:
        return (self.ro**2 + self.rise**2) / (2 * self.rise)

    def y(self, r: float) -> float:
        """Outer roof surface height above base at radius r (the wall top beyond the wall)."""
        if r >= self.ro:
            return self.hw
        return self.hw + self.rise - self.rs + math.sqrt(self.rs**2 - r**2)


def _wall_dome(ro: float, ri: float, y0: float, hw: float, rise: float, ctx: BuildCtx) -> trimesh.Trimesh:
    dome = _Dome(ro, hw, rise)
    t = min(0.5, rise / 4)
    rs, rsi = dome.rs, dome.rs - t
    yc = hw + rise - rs
    m = max(6, round(24 * ctx.lod))
    phi_o, phi_i = math.asin(ro / rs), math.asin(ri / rsi)
    outer = [(rs * math.sin(f), yc + rs * math.cos(f)) for f in np.linspace(phi_o, 0.0, m + 1)]
    inner = [(rsi * math.sin(f), yc + rsi * math.cos(f)) for f in np.linspace(0.0, phi_i, m + 1)]
    n = int(min(128, max(48, round(2 * math.pi * ro / 2.75 * ctx.lod))))
    return k.lathe([(ri, y0), (ro, y0), *outer, *inner], ctx, ro, n=n)


def _polar(bearing_deg: float, r: float) -> np.ndarray:
    a = math.radians(bearing_deg)
    return np.array([r * math.cos(a), r * math.sin(a)])


def _roof_platform(name: str, pf: RoofPlatform, scale: float, dome: _Dome, H: float) -> list[MeshNode]:
    rc, depth = pf.r_m * scale, pf.depth_m * scale
    if pf.shape == "arc":
        steps = max(4, math.ceil(pf.span_deg / 5))
        angs = np.radians(np.linspace(-pf.span_deg / 2, pf.span_deg / 2, steps + 1))
        r_out, r_in = rc + depth / 2, max(rc - depth / 2, 0.5)
        pts = [(r_out * math.cos(a), r_out * math.sin(a)) for a in angs]
        pts += [(r_in * math.cos(a), r_in * math.sin(a)) for a in angs[::-1]]
    else:
        w = pf.width_m * scale
        r_in = max(rc - depth / 2, 0.0)
        pts = [
            (rc - depth / 2, -w / 2),
            (rc + depth / 2, -w / 2),
            (rc + depth / 2, w / 2),
            (rc - depth / 2, w / 2),
        ]
    deck_y = max(dome.hw + pf.deck_above_wall_m * scale, dome.y(r_in) + 0.3)
    deck_y = min(deck_y, H - k.RAIL_H - k.DECK_T)
    poly = Polygon(pts)
    minx, miny, maxx, maxy = poly.bounds
    cand = [(float(x), float(z)) for x, z in pts]
    cand += [
        (float(x), float(z))
        for x in np.arange(minx + 3.0, maxx, 6.0)
        for z in np.arange(miny + 3.0, maxy, 6.0)
        if poly.contains(Point(x, z))
    ]
    legs = []
    for x, z in cand:
        r = math.hypot(x, z)
        if r > dome.ro - 0.3:
            continue  # cantilevered over the wall edge
        ys = dome.y(r)
        if deck_y - ys > 0.1:
            legs.append(k.T(x, ys, z) @ k.S(1.0, deck_y - ys, 1.0))
    nodes = [k.node(f"{name}_deck", "Grating", k.slab(pts, deck_y, k.DECK_T))]
    if legs:
        nodes.append(MeshNode(f"{name}_legs", "Steel_Structure", k.inst(k.box(0.2, 1.0, 0.2), legs)))
    nodes += k.handrail(name, pts, deck_y + k.DECK_T)
    return k.turn(nodes, k.yaw(pf.bearing_deg))


def _walk_points(w: RoofWalkway, scale: float) -> list[np.ndarray]:
    """Plan points along the walkway, at most 3 m apart (each segment is sloped to follow the dome)."""
    a, b = _polar(w.from_bearing_deg, w.from_r_m * scale), _polar(w.to_bearing_deg, w.to_r_m * scale)
    span = float(np.linalg.norm(b - a))
    if span < 1.0:
        return []
    count = max(2, math.ceil(span / 3.0))
    return [a + (b - a) * i / count for i in range(count + 1)]


def _walk_top() -> float:
    """Walkway top (post tops) above the dome surface under it, m."""
    return WALK_CLEAR + k.DECK_T / 2 + k.RAIL_H


def _fit_rise(ro: float, hw: float, rise: float, r_min: float, H: float) -> float:
    """Lower the dome crown so a walkway passing radius r_min tops out at H (the item's top_el)."""

    def over(x: float) -> float:
        return _Dome(ro, hw, x).y(r_min) + _walk_top() - H

    lo, hi = 1e-3, rise
    if r_min >= ro or over(hi) <= 0 or over(lo) > 0:
        return rise  # fits already, or lowering the dome cannot help
    for _ in range(50):
        mid = (lo + hi) / 2
        lo, hi = (mid, hi) if over(mid) <= 0 else (lo, mid)
    return lo


def _walkway(w: RoofWalkway, pts: list[np.ndarray], dome: _Dome) -> list[MeshNode]:
    a, b = pts[0], pts[-1]
    span = float(np.linalg.norm(b - a))
    ys = [dome.y(float(np.hypot(*q))) + WALK_CLEAR for q in pts]
    deck = [
        k.bar((p0[0], y0, p0[1]), (p1[0], y1, p1[1]), w.width_m, k.DECK_T)
        for p0, p1, y0, y1 in zip(pts[:-1], pts[1:], ys[:-1], ys[1:], strict=True)
    ]
    u = (b - a) / span
    side = np.array([-u[1], u[0]]) * (w.width_m / 2)
    xf, rails = [], []
    for s in (-1, 1):
        prev = None
        for q, y in zip(pts, ys, strict=True):
            c = q + s * side
            xf.append(k.T(c[0], y + k.DECK_T / 2, c[1]))
            if prev is not None:
                rails.append(
                    k.bar((prev[0][0], prev[1] + k.RAIL_H, prev[0][1]), (c[0], y + k.RAIL_H, c[1]), k.RAIL_W)
                )
            prev = (c, y)
    return [
        k.node("walkway_deck", "Grating", *deck),
        MeshNode("walkway_posts", "Handrail", k.inst(k.box(k.POST_W, k.RAIL_H, k.POST_W), xf)),
        k.node("walkway_rails", "Handrail", *rails),
    ]


def _stair_tower(ro: float, hw: float) -> list[MeshNode]:
    """A switchback stair tower at grade outside the wall (built at bearing 0), bridged to the roof edge."""
    x0, dx, dz = ro + 1.0, 4.0, 8.0
    xc = x0 + dx / 2
    count = max(1, math.ceil(hw / 3.6))
    lv = [0.15 + (hw - 0.15) * i / count for i in range(count + 1)]  # first flight starts on a 0.15 m pad
    corners = [(x0, -dz / 2), (x0 + dx, -dz / 2), (x0 + dx, dz / 2), (x0, dz / 2)]
    nodes = [
        MeshNode(
            "stair_tower_columns",
            "Steel_Structure",
            k.inst(k.box(0.25, 1.0, 0.25), [k.T(x, 0, z) @ k.S(1, hw + k.RAIL_H, 1) for x, z in corners]),
        ),
        MeshNode(
            "stair_tower_landings",
            "Grating",
            k.inst(k.box(dx, 0.06, 1.5), [k.T(xc, y, s * (dz / 2 - 0.75)) for y in lv[1:] for s in (-1, 1)]),
        ),
    ]
    stringers, xforms, tread = [], [], None
    for i in range(count):
        s = 1 if i % 2 == 0 else -1
        lane = xc - dx / 4 if i % 2 == 0 else xc + dx / 4
        st, tread, xf = k.stair_parts(
            (lane, lv[i], -s * (dz / 2 - 1.5)), (lane, lv[i + 1], s * (dz / 2 - 1.5)), dx / 2 - 0.2
        )
        stringers.append(st)
        xforms += xf
    nodes.append(k.node("stair_tower_stringers", "Steel_Structure", *stringers))
    nodes.append(MeshNode("stair_tower_treads", "Grating", k.inst(tread, xforms)))
    braces = []
    for i in range(count):
        braces.append(k.bar((x0 + dx, lv[i], -dz / 2), (x0 + dx, lv[i + 1], dz / 2), 0.12))
        braces.append(k.bar((x0 + dx, lv[i], dz / 2), (x0 + dx, lv[i + 1], -dz / 2), 0.12))
    nodes.append(k.node("stair_tower_bracing", "Steel_Structure", *braces))
    bridge = k.box(x0 - (ro - 1.2), k.DECK_T, 1.5, x=(x0 + ro - 1.2) / 2, y0=hw)
    nodes.append(k.node("stair_tower_bridge", "Grating", bridge))
    nodes += k.handrail("stair_tower_top", corners, hw + 0.06)
    return nodes


def _risers(ro: float, y0: float, hw: float, ods: list[float], ctx: BuildCtx) -> list[MeshNode]:
    """Pipe risers up the outer wall face (built at bearing 0) and over the wall top."""
    pipes, z = [], -(len(ods) - 1) * 0.6
    zs = []
    for od in ods:
        x, y_top = ro + 0.3 + od / 2, hw + k.DECK_T + k.RAIL_H + 0.3 + od / 2  # runs clear the roof-edge rail
        pipes.append(k.rod((x, y0, z), (x, y_top, z), od / 2, ctx))
        pipes.append(k.rod((x, y_top, z), (ro - 1.0, y_top, z), od / 2, ctx))
        zs.append(z)
        z += 1.2
    supports = [
        k.bar((ro + 0.3, y, zs[0] - 0.6), (ro + 0.3, y, zs[-1] + 0.6), 0.15)
        for y in np.arange(y0 + 3.0, hw, 6.0)
    ]
    nodes = [k.node("risers", "Pipe_Insulated", *pipes)]
    if supports:
        nodes.append(k.node("riser_supports", "Steel_Structure", *supports))
    return nodes


@builder("tank_lng", family="equipment", params=TankLngParams, doc=DOC_LNG, default_height_m=H_LNG)
def build_tank_lng(item: Item, ctx: BuildCtx) -> list[MeshNode]:
    p = k.params(item, TankLngParams)
    plan = k.plan_of(item, ctx)
    H, _ = k.height(item, ctx, H_LNG)
    od = min(plan.along, plan.across)
    ro = od / 2
    ri = ro - p.wall_t_m
    if ri <= 0:
        raise ValueError("tank_lng: wall thicker than the radius")
    rise = p.dome_rise_m if p.dome_rise_m is not None else DOME_RISE_RATIO * od
    hw = H - rise
    if hw < p.slab_t_m + 2.0:
        raise ValueError("tank_lng: height too small for the wall and dome")
    scale = od / REF_OD
    walk = _walk_points(p.walkway, scale) if p.walkway is not None else []
    if walk:
        rise = _fit_rise(ro, hw, rise, min(float(np.hypot(*q)) for q in walk), H)
    dome = _Dome(ro, hw, rise)
    rs = ro + p.slab_overhang_m
    nodes = [
        k.node(
            "slab", "Concrete", k.lathe([(0.0, 0.0), (rs, 0.0), (rs, p.slab_t_m), (0.0, p.slab_t_m)], ctx, ro)
        ),
        k.node("wall_dome", "Concrete_Tank", _wall_dome(ro, ri, p.slab_t_m, hw, rise, ctx)),
    ]
    if p.roof_handrail:
        edge = k.lathe([(ro - 1.2, hw), (ro, hw), (ro, hw + k.DECK_T), (ro - 1.2, hw + k.DECK_T)], ctx, ro)
        nodes.append(k.node("roof_edge_deck", "Grating", edge))
        nodes += k.ring_handrail("roof_edge", ro - 0.1, hw + k.DECK_T, ctx)
    platforms = COWORK_ROOF if p.roof_platforms is None else tuple(p.roof_platforms)
    kinds = Counter(pf.kind for pf in platforms)
    for i, pf in enumerate(platforms):
        name = f"platform_{pf.kind}" if kinds[pf.kind] == 1 else f"platform_{pf.kind}_{i}"
        nodes += _roof_platform(name, pf, scale, dome, H)
    if walk:
        nodes += _walkway(p.walkway, walk, dome)
    if p.stair_tower_bearing_deg is not None:
        nodes += k.turn(_stair_tower(ro, hw), k.yaw(p.stair_tower_bearing_deg))
    if p.risers_bearing_deg is not None and p.riser_od_m:
        nodes += k.turn(_risers(ro, p.slab_t_m, hw, list(p.riser_od_m), ctx), k.yaw(p.risers_bearing_deg))
    nodes = k.turn(nodes, k.T(plan.cx, 0.0, plan.cz))
    return k.finish(nodes, item, p, {"od_m": od, "wall_top_m": hw, "dome_rise_m": rise, "scale": scale})
