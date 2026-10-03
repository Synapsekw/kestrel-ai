"""Process equipment: heater, vaporizer_orv, vaporizer_scv, stack, flare, package (unit B2)."""

from __future__ import annotations

from typing import Literal

import numpy as np
from pydantic import Field

from app.asset_models.builders.base import BuildCtx, MeshNode, Params, builder
from app.asset_models.builders.equipment import _kit as k
from app.asset_models.builders.equipment.vessels import head_depth
from app.asset_models.spec import Item

H_HEATER, H_ORV, H_SCV = 5.0, 8.0, 6.0


class HeaterParams(Params):
    kind: Literal["water_bath", "fired_box"] = "water_bath"
    stack: bool = True


class OrvParams(Params):
    panels: int | None = Field(
        None, ge=1, le=60, description="Panels along the rack. Default round(0.85 along / 0.6)."
    )
    stairs: bool = True


class ScvParams(Params):
    stack: bool = Field(
        False, description="Build the exhaust stack here; Cowork tags it as its own stack item."
    )
    blower_end: Literal["start", "end"] = "start"


DOC_HEATER = (
    "Heater along the footprint's long axis. water_bath: skid on a pad, horizontal bath shell with heads, "
    "burner box and stack (or coil nozzles). fired_box: radiant box, convection section, stack and a ladder."
)
DOC_ORV = (
    "Open rack vaporizer: concrete pad and sea-water trough, a bank of aluminium heat-exchange panels "
    "across the long axis, top distribution troughs, LNG inlet and NG outlet headers, a side stair and a "
    "top walkway."
)
DOC_SCV = (
    "Submerged combustion vaporizer: pad, water bath tank with handrailed top and ladder, combustion air "
    "blower and duct at one end. The exhaust stack is usually its own `stack` item (stack=false)."
)


@builder("heater", family="equipment", params=HeaterParams, doc=DOC_HEATER, default_height_m=H_HEATER)
def build_heater(item: Item, ctx: BuildCtx) -> list[MeshNode]:
    p = k.params(item, HeaterParams)
    plan = k.plan_of(item, ctx)
    H, _ = k.height(item, ctx, H_HEATER)
    if H < 1.0:
        raise ValueError("heater: height too small")
    L, W = plan.along, plan.across
    nodes = [k.node("pad", "Concrete", k.box(L, 0.2, W))]
    derived: dict = {"kind": p.kind}
    if p.kind == "water_bath":
        rails = [k.box(0.95 * L, 0.25, 0.15, z=s * 0.3 * W, y0=0.2) for s in (-1, 1)]
        xs = np.arange(-0.45 * L, 0.45 * L + 1e-6, 2.0)
        nodes.append(k.node("skid", "Steel_Structure", *rails))
        nodes.append(
            MeshNode(
                "skid_cross",
                "Steel_Structure",
                k.inst(k.box(0.15, 0.25, 0.65 * W), [k.T(float(x), 0.2, 0) for x in xs]),
            )
        )
        y = 0.45
        d = min(0.8 * W, 0.7 * (H - y), H - y - (0.0 if p.stack else 0.4))
        if d < 0.2:
            raise ValueError("heater: height too small for the bath")
        r, hd = d / 2, head_depth("ellipsoidal", d)
        yc = y + r
        x0, x1 = -0.38 * L + hd, 0.42 * L - hd
        if x1 - x0 < 0.2:
            raise ValueError("heater: footprint too short for the bath")
        cap = k.ell_cap(r, hd, ctx, steps=6)
        bx0, bx1 = -0.49 * L, x0 - 0.5 * hd
        nodes += [
            k.node("bath_shell", "Equipment_White", k.rod((x0, yc, 0), (x1, yc, 0), r, ctx)),
            k.node(
                "bath_heads",
                "Equipment_White",
                k.placed(cap, k.T(x1, yc, 0) @ k.Y_TO_X),
                k.placed(cap, k.T(x0, yc, 0) @ k.S(-1, 1, 1) @ k.Y_TO_X),
            ),
            # the burner box is bolted onto the start head: it runs into the head, not short of it
            k.node("burner", "Equipment_Grey", k.box(bx1 - bx0, 0.6 * d, 0.6 * W, x=(bx0 + bx1) / 2, y0=y)),
        ]

        def over_shell(x: float, rr: float) -> float:  # keep a riser on the cylindrical shell, off the heads
            lo, hi = x0 + rr, x1 - rr
            return float(np.clip(x, lo, hi)) if lo <= hi else (x0 + x1) / 2

        if p.stack:
            rs = max(0.15, 0.08 * d)
            xs_ = over_shell(-0.3 * L, rs)
            nodes.append(k.node("stack", "Steel_Dark", k.rod((xs_, yc + 0.8 * r, 0), (xs_, H, 0), rs, ctx)))
        else:
            rn = max(0.05, 0.05 * d)
            nodes.append(
                k.node(
                    "nozzles",
                    "Pipe",
                    *[
                        k.rod((over_shell(x, rn), yc + 0.8 * r, 0), (over_shell(x, rn), H, 0), rn, ctx)
                        for x in (0.15 * L, 0.3 * L)
                    ],
                )
            )
        derived["bath_d_m"] = d
    else:
        y = 0.2
        hr = 0.55 * (H - y) if p.stack else 0.75 * (H - y)
        hc = 0.2 * (H - y) if p.stack else H - y - hr
        nodes += [
            k.node("radiant_box", "Equipment_White", k.box(0.9 * L, hr, 0.9 * W, y0=y)),
            k.node("convection", "Equipment_Grey", k.box(0.4 * L, hc, 0.6 * W, y0=y + hr)),
        ]
        if p.stack:
            nodes.append(
                k.node(
                    "stack",
                    "Steel_Dark",
                    k.vcyl(max(0.2, 0.06 * min(L, W)), H - y - hr - hc, ctx, y0=y + hr + hc),
                )
            )
        nodes += k.ladder("ladder", 0.0, -0.47 * W, y, y + hr, 90.0)
    return k.finish(k.turn(nodes, plan.place()), item, p, derived)


@builder("vaporizer_orv", family="equipment", params=OrvParams, doc=DOC_ORV, default_height_m=H_ORV)
def build_vaporizer_orv(item: Item, ctx: BuildCtx) -> list[MeshNode]:
    p = k.params(item, OrvParams)
    plan = k.plan_of(item, ctx)
    H, _ = k.height(item, ctx, H_ORV)
    L, W = plan.along, plan.across
    yw = H - k.RAIL_H - k.DECK_T
    ph = yw - 0.5 - 1.1
    if ph < 0.5:
        raise ValueError("vaporizer_orv: height too small")
    # a 1 m side lane at -across carries the stair and the walkway columns, clear of the basin
    bw = min(0.425 * W, W / 2 - 1.0)
    if bw < 0.36 * W:
        raise ValueError("vaporizer_orv: footprint too narrow for the side walkway")
    zt = min(0.38 * W, bw - 0.04 * W)  # distribution troughs inside the basin, over the panel edges
    r_lo = max(0.1, 0.03 * W)
    n = p.panels or min(60, max(1, round(0.85 * L / 0.6)))
    xs = [-0.425 * L + (j + 0.5) * 0.85 * L / n for j in range(n)]
    zw = -(W / 2 - 0.5)
    nodes = [
        k.node("pad", "Concrete", k.box(L, 0.3, W)),
        k.node("trough", "Concrete_Dark", k.box(0.92 * L, 0.8, 2 * bw, y0=0.3)),
        MeshNode("panels", "Aluminium_Panel", k.inst(k.box(0.06, ph, 0.7 * W), [k.T(x, 1.1, 0) for x in xs])),
        k.node(
            "distribution_troughs",
            "Concrete_Dark",
            *[k.box(0.85 * L, 0.4, 0.08 * W, z=s * zt, y0=1.1 + ph) for s in (-1, 1)],
        ),
        k.node(
            "headers",
            "Equipment_Grey",
            k.rod((-0.46 * L, 1.1 + r_lo, 0), (0.46 * L, 1.1 + r_lo, 0), r_lo, ctx),  # on the basin
            k.rod((-0.46 * L, 1.3 + ph, 0), (0.46 * L, 1.3 + ph, 0), max(0.15, 0.04 * W), ctx),
        ),
    ]
    x_w0 = -0.46 * L
    if p.stairs:
        rise = yw - 0.3
        run = min(rise, 0.55 * L)
        x_bot = -0.48 * L
        nodes += k.stair("stair", (x_bot, 0.3, zw), (x_bot + run, yw, zw), 0.9)
        x_w0 = x_bot + run
    nodes.append(
        k.node(
            "top_walkway",
            "Grating",
            k.box(0.46 * L - x_w0, k.DECK_T, 1.0, x=(x_w0 + 0.46 * L) / 2, z=zw, y0=yw),
        )
    )
    cols = [
        k.T(float(q[0]), 0.3, zw + dz)
        for q in k.edge_points([(x_w0, 0), (0.46 * L, 0)], False, 4.0)
        for dz in (-0.4, 0.4)
    ]
    nodes.append(
        MeshNode("top_walkway_columns", "Steel_Structure", k.inst(k.box(0.12, yw - 0.3, 0.12), cols))
    )
    nodes += k.handrail(
        "top_walkway", [(x_w0, -W / 2 + 0.03), (0.46 * L, -W / 2 + 0.03)], yw + k.DECK_T, closed=False
    )
    return k.finish(k.turn(nodes, plan.place()), item, p, {"panels": n})


@builder("vaporizer_scv", family="equipment", params=ScvParams, doc=DOC_SCV, default_height_m=H_SCV)
def build_vaporizer_scv(item: Item, ctx: BuildCtx) -> list[MeshNode]:
    p = k.params(item, ScvParams)
    plan = k.plan_of(item, ctx)
    H, _ = k.height(item, ctx, H_SCV)
    if H < 2.0:
        raise ValueError("vaporizer_scv: height too small")
    L, W = plan.along, plan.across
    s = -1.0 if p.blower_end == "start" else 1.0
    y = 0.3
    bh = 0.55 * (H - y) if p.stack else H - y - k.RAIL_H - 0.02
    xb = -s * 0.12 * L
    rb = min(0.12 * W, 0.2 * (H - y), 0.06 * L)
    xbl = s * 0.38 * L
    edge = xb + s * 0.35 * L
    y_duct = min(0.9 * bh, bh - 0.35 * rb)  # the duct meets the bath face below its top
    nodes = [
        k.node("pad", "Concrete", k.box(L, y, W)),
        k.node("water_bath", "Equipment_Grey", k.box(0.7 * L, bh, 0.85 * W, x=xb, y0=y)),
        k.node(
            "blower",
            "Machine_Green",
            k.rod((xbl, y + rb, -0.25 * W), (xbl, y + rb, 0.05 * W), rb, ctx),
            k.rod((xbl, y + rb, 0.05 * W), (xbl, y + rb, 0.3 * W), 0.6 * rb, ctx),
        ),
        k.node(
            "air_duct",
            "Equipment_Grey",
            k.bar((xbl, y + 2 * rb, -0.1 * W), (edge, y + y_duct, -0.1 * W), 0.6 * rb),
        ),
    ]
    corners = [
        (xb - 0.35 * L, -0.425 * W),
        (xb + 0.35 * L, -0.425 * W),
        (xb + 0.35 * L, 0.425 * W),
        (xb - 0.35 * L, 0.425 * W),
    ]
    nodes += k.handrail("bath_top", corners, y + bh)
    xl = xb - s * (0.35 * L + min(0.25, max(0.05, 0.03 * L - 0.04)))  # the ladder stays on the pad
    nodes += k.ladder("ladder", xl, 0.0, y, y + bh, 180.0 if xl > xb else 0.0)
    if p.stack:
        nodes.append(
            k.node(
                "stack",
                "Steel_Dark",
                k.vcyl(max(0.3, 0.1 * W), H - y - bh, ctx, x=xb - s * 0.2 * L, y0=y + bh),
            )
        )
    return k.finish(k.turn(nodes, plan.place()), item, p, {"bath_h_m": bh})
