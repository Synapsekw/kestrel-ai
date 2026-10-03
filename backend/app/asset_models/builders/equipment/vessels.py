"""Vessels: vessel_v and vessel_h (unit B2)."""

from __future__ import annotations

import math
from typing import Literal

from pydantic import Field

from app.asset_models.builders.base import BuildCtx, MeshNode, Params, builder
from app.asset_models.builders.equipment import _kit as k
from app.asset_models.spec import Item, NonNeg, Pos

HEAD_STEPS = 8
PLINTH_H = 0.3
NOZZLE_ROOM = 0.3  # vessel_h: space above the shell for top nozzles
H_VV, H_VH = 8.0, 4.0


def head_depth(kind: str, d: float) -> float:
    return {"ellipsoidal": d / 4, "hemispherical": d / 2, "flat": 0.05}[kind]


def shell_material(insulated: bool) -> str:
    return "Insulation_Clad" if insulated else "Equipment_White"


class VesselVParams(Params):
    d_m: Pos | None = Field(None, description="Shell OD, m. Default: the footprint diameter (or short side).")
    head: Literal["ellipsoidal", "hemispherical", "flat"] = "ellipsoidal"
    skirt_h_m: NonNeg | None = Field(
        None, description="Skirt height above the plinth, m. Default min(0.15 H, 3)."
    )
    insulated: bool = False
    ladder: bool | None = Field(None, description="Ladder to the top. Default: when H >= 5 m.")
    top_platform: bool | None = Field(
        None, description="Ring platform at the top tangent. Default: H >= 8 m."
    )
    nozzles: int = Field(3, ge=0, le=12)


class VesselHParams(Params):
    orient: Literal["ns", "ew"] | None = Field(
        None, description="Axis N-S or E-W; overrides the footprint axis."
    )
    d_m: Pos | None = Field(
        None, description="Shell OD, m. Default: footprint short side, limited by height."
    )
    head: Literal["ellipsoidal", "hemispherical"] = "ellipsoidal"
    saddle_h_m: NonNeg | None = Field(
        None, description="Grade to shell bottom, m. Default H - d - 0.3 (>= 0.3)."
    )
    insulated: bool = False
    nozzles: int = Field(3, ge=0, le=12)


DOC_VV = (
    "Vertical pressure vessel or drum: concrete plinth, skirt, shell, two heads (2:1 ellipsoidal by "
    "default), shell nozzles, and on tall vessels a ladder and a ring platform at the top tangent line. "
    "Footprint: circle = shell OD. base_el = grade or platform, top_el = top of the top head."
)
DOC_VH = (
    "Horizontal drum or vessel: shell, two heads, two steel saddles on concrete piers, top nozzles and a "
    "manway. Footprint: rect along the vessel axis (overall length incl. heads x shell OD); orient "
    "'ns'/'ew' overrides. top_el = top of the shell (or nozzles)."
)


@builder("vessel_v", family="equipment", params=VesselVParams, doc=DOC_VV, default_height_m=H_VV)
def build_vessel_v(item: Item, ctx: BuildCtx) -> list[MeshNode]:
    p = k.params(item, VesselVParams)
    plan = k.plan_of(item, ctx)
    H, _ = k.height(item, ctx, H_VV)
    d = p.d_m or min(plan.along, plan.across)
    r = d / 2
    hd = head_depth(p.head, d)
    sk = p.skirt_h_m if p.skirt_h_m is not None else min(0.15 * H, 3.0)
    shell_len = H - PLINTH_H - sk - 2 * hd
    if shell_len < 0.1:  # a squat drum: give up the skirt first
        sk = max(0.0, H - PLINTH_H - 2 * hd - 0.1)
        shell_len = H - PLINTH_H - sk - 2 * hd
    if shell_len < 0.05:
        raise ValueError("vessel_v: height too small for the heads")
    y_bt = PLINTH_H + sk + hd
    y_tt = y_bt + shell_len
    mat = shell_material(p.insulated)
    cap = k.ell_cap(r, hd, ctx, steps=HEAD_STEPS)
    nodes = [
        k.node("plinth", "Concrete", k.vcyl(r + 0.3, PLINTH_H, ctx, n=8)),
        k.node("shell", mat, k.vcyl(r, shell_len, ctx, y0=y_bt)),
        k.node("head_top", mat, k.placed(cap, k.T(0, y_tt, 0))),
        k.node("head_bottom", mat, k.placed(cap, k.T(0, y_bt, 0) @ k.S(1, -1, 1))),
    ]
    if sk > 0.05:
        nodes.append(k.node("skirt", "Steel_Dark", k.vcyl(r * 0.98, sk + hd, ctx, y0=PLINTH_H)))
    noz = []
    rn = max(0.05, 0.06 * d)
    for i in range(p.nozzles):
        a = math.radians(360.0 * i / p.nozzles + 30.0)
        y = y_bt + shell_len * (0.2 + 0.6 * ((i * 0.618) % 1.0))
        ux, uz = math.cos(a), math.sin(a)
        noz.append(k.rod((ux * r * 0.9, y, uz * r * 0.9), (ux * (r + 0.3), y, uz * (r + 0.3)), rn, ctx))
    if noz:
        nodes.append(k.node("nozzles", "Pipe", *noz))
    want_ladder = p.ladder if p.ladder is not None else H >= 5.0
    want_platform = p.top_platform if p.top_platform is not None else H >= 8.0
    y_pf = min(y_tt, H - k.RAIL_H)
    if want_platform:
        deck = k.lathe(
            [(r, y_pf - k.DECK_T), (r + 1.0, y_pf - k.DECK_T), (r + 1.0, y_pf), (r, y_pf)], ctx, r + 1.0
        )
        nodes.append(k.node("platform_deck", "Grating", deck))
        nodes += k.ring_handrail("platform", r + 0.95, y_pf, ctx)
    if want_ladder:
        a = math.radians(200.0)
        top = y_pf if want_platform else y_tt
        nodes += k.ladder("ladder", math.cos(a) * (r + 0.4), math.sin(a) * (r + 0.4), PLINTH_H, top, 20.0)
    nodes = k.turn(nodes, plan.place())
    return k.finish(nodes, item, p, {"d_m": d, "skirt_h_m": sk, "shell_len_m": shell_len})


def _axis(plan: k.Plan, orient: str | None) -> tuple[float, float, float]:
    """(axis bearing, overall length, width) for a horizontal vessel."""
    long_, short = max(plan.along, plan.across), min(plan.along, plan.across)
    if orient == "ns":
        return 0.0, long_, short
    if orient == "ew":
        return 90.0, long_, short
    if plan.is_round:
        return 0.0, plan.along, plan.along / 3
    return plan.bearing_deg, plan.along, plan.across


@builder("vessel_h", family="equipment", params=VesselHParams, doc=DOC_VH, default_height_m=H_VH)
def build_vessel_h(item: Item, ctx: BuildCtx) -> list[MeshNode]:
    p = k.params(item, VesselHParams)
    plan = k.plan_of(item, ctx)
    H, _ = k.height(item, ctx, H_VH)
    bearing, L, W = _axis(plan, p.orient)
    room = NOZZLE_ROOM if p.nozzles else 0.0
    d = p.d_m or min(W, H)
    sh = p.saddle_h_m if p.saddle_h_m is not None else max(0.3, H - d - room)
    if sh + d + room > H + 1e-9:
        d = H - sh - room
    if d < 0.1:
        raise ValueError("vessel_h: height too small for the shell")
    r, hd = d / 2, head_depth(p.head, d)
    shell_len = L - 2 * hd
    if shell_len < 0.1:
        raise ValueError("vessel_h: footprint too short for the heads")
    yc = sh + r
    x0, x1 = -shell_len / 2, shell_len / 2
    mat = shell_material(p.insulated)
    cap = k.ell_cap(r, hd, ctx, steps=HEAD_STEPS)
    xs = (-0.3 * shell_len, 0.3 * shell_len)
    ph = min(0.6, 0.5 * sh)
    st = max(0.2, 0.05 * d)
    nodes = [
        k.node("shell", mat, k.rod((x0, yc, 0), (x1, yc, 0), r, ctx)),
        k.node("head_a", mat, k.placed(cap, k.T(x1, yc, 0) @ k.Y_TO_X)),
        k.node("head_b", mat, k.placed(cap, k.T(x0, yc, 0) @ k.S(-1, 1, 1) @ k.Y_TO_X)),
        k.node("piers", "Concrete", *[k.box(3 * st, max(ph, 0.05), d, x=x) for x in xs]),
        k.node("saddles", "Steel_Structure", *[k.box(st, yc - ph, 0.85 * d, x=x, y0=ph) for x in xs]),
    ]
    rn = max(0.05, 0.06 * d)
    if p.nozzles and H - (yc + r) > 0.05:
        noz = []
        for i in range(p.nozzles):
            xn = x0 + shell_len * (i + 0.5) / p.nozzles
            noz.append(k.rod((xn, yc + 0.9 * r, 0), (xn, H, 0), rn, ctx))
        nodes.append(k.node("nozzles", "Pipe", *noz))
    rm = max(0.3, 0.12 * d)
    if rm < 0.8 * r:
        nodes.append(
            k.node("manway", "Steel_Dark", k.rod((x1 + 0.6 * hd, yc, 0), (x1 + hd + 0.3, yc, 0), rm, ctx))
        )
    nodes = k.turn(nodes, k.T(plan.cx, 0.0, plan.cz) @ k.yaw(bearing))
    derived = {"d_m": d, "saddle_h_m": sh, "length_m": L, "axis_bearing_deg": bearing % 360.0}
    return k.finish(nodes, item, p, derived)
