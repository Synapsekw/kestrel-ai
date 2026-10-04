"""Process equipment: heater, vaporizer_orv, vaporizer_scv, stack, flare, package (unit B2)."""

from __future__ import annotations

import math
from typing import Literal

import numpy as np
from pydantic import Field

from app.asset_models.builders.base import BuildCtx, MeshNode, Params, builder
from app.asset_models.builders.equipment import _kit as k
from app.asset_models.builders.equipment.vessels import head_depth
from app.asset_models.spec import Item, Pos

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
    "top walkway. Needs a footprint at least ~7.2 m wide (the side walkway lane)."
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


H_STACK, H_FLARE, H_PACKAGE = 15.0, 50.0, 3.0
PACKAGE_COLOUR = {
    "grey": "Equipment_Grey",
    "white": "Equipment_White",
    "red": "Safety_Red",
    "green": "Machine_Green",
    "blue": "Pump_Blue",
}


class StackParams(Params):
    top_d_ratio: float = Field(0.8, gt=0, le=1, description="Top OD / base OD")
    bands: int = Field(2, ge=0, le=6, description="Red aviation bands at the top")
    platform: bool | None = Field(None, description="Sampling platform at 0.75 H. Default: H >= 15 m.")
    ladder: bool | None = Field(None, description="Ladder. Default: H >= 6 m.")


class FlareParams(Params):
    support: Literal["derrick", "guyed", "self"] = "derrick"
    riser_d_m: Pos | None = Field(None, description="Riser OD. Default 0.3 x footprint d, at most 1.5 m.")
    tip_d_m: Pos | None = Field(None, description="Flare tip OD. Default 1.3 x riser.")
    derrick_base_m: Pos | None = Field(
        None, description="Derrick base width. Default max(footprint d, 0.16 H)."
    )
    platforms: int = Field(
        2, ge=0, le=6, description="Derrick platforms; the top one sits just under the tip"
    )


class PackageParams(Params):
    style: Literal["auto", "skid", "enclosure", "cabinet"] = Field(
        "auto", description="auto: plan area < 4 m2 -> cabinet; height <= 2.5 m -> skid; else enclosure"
    )
    colour: Literal["grey", "white", "red", "green", "blue"] = Field(
        "grey", description="Main body colour; red for fire and safety packages"
    )


DOC_STACK = (
    "Free-standing stack or chimney: plinth, base ring, tapered steel shell, red aviation bands, a sampling "
    "platform with handrail and a ladder. Footprint: circle = base OD. top_el = stack top."
)
DOC_FLARE = (
    "Elevated flare: riser with molecular seal and red flare tip, supported by a 4-leg lattice derrick with "
    "platforms (default), guy wires, or self-supported. Footprint: circle = flare base. top_el = tip top."
)
DOC_PACKAGE = (
    "Generic packaged unit. skid: steel skid with a small vessel, a module box and piping. enclosure: walled "
    "box with roof and door on a pad. cabinet: a small cabinet with a canopy. Use colour red for fire/safety."
)


@builder("stack", family="equipment", params=StackParams, doc=DOC_STACK, default_height_m=H_STACK)
def build_stack(item: Item, ctx: BuildCtx) -> list[MeshNode]:
    p = k.params(item, StackParams)
    plan = k.plan_of(item, ctx)
    H, _ = k.height(item, ctx, H_STACK)
    if H < 2.0:
        raise ValueError("stack: height too small")
    r0 = min(plan.along, plan.across) / 2
    rt = r0 * p.top_d_ratio

    def r_at(y: float) -> float:
        return r0 + (rt - r0) * (y - 0.45) / (H - 0.45)

    nodes = [
        k.node("plinth", "Concrete", k.vcyl(r0 + 0.3, 0.3, ctx, n=8)),
        # the base ring stays on the plinth (r0 + 0.3) on a wide stack too
        k.node("base_ring", "Steel_Dark", k.vcyl(min(r0 * 1.1, r0 + 0.25), 0.15, ctx, y0=0.3)),
        k.node("shell", "Steel_Dark", k.lathe([(0.0, 0.45), (r0, 0.45), (rt, H), (0.0, H)], ctx, r0)),
    ]
    bh = min(0.05 * H, 1.5)
    bands = []
    for i in range(p.bands):
        yt = H - i * 2 * bh
        yb = yt - bh
        if yb <= 0.45:
            break
        bands.append(k.lathe([(0.0, yb), (r_at(yb) + 0.02, yb), (r_at(yt) + 0.02, yt), (0.0, yt)], ctx, r0))
    if bands:
        nodes.append(k.node("bands", "Safety_Red", *bands))
    want_platform = p.platform if p.platform is not None else H >= 15.0
    want_ladder = p.ladder if p.ladder is not None else H >= 6.0
    yp = min(0.75 * H, H - k.RAIL_H - 0.1)
    if want_platform:
        rp = r_at(yp)
        deck = k.lathe(
            [(rp, yp - k.DECK_T), (rp + 1.0, yp - k.DECK_T), (rp + 1.0, yp), (rp, yp)], ctx, rp + 1.0
        )
        nodes.append(k.node("platform_deck", "Grating", deck))
        nodes += k.ring_handrail("platform", rp + 0.95, yp, ctx)
    if want_ladder:
        # from grade beside the plinth, leaning with the taper so it keeps 0.4 m off the shell and lands
        # inside the platform rail
        y1 = yp if want_platform else H - 0.5
        xb, xt = r_at(0.0) + 0.4, r_at(y1) + 0.4
        lean = math.atan2(xb - xt, y1)
        tilt = np.eye(4)
        tilt[0, 0], tilt[0, 1], tilt[1, 0], tilt[1, 1] = (
            math.cos(lean),
            math.sin(lean),
            -math.sin(lean),
            math.cos(lean),
        )
        nodes += k.turn(k.ladder("ladder", 0.0, 0.0, 0.0, math.hypot(xb - xt, y1), 0.0), k.T(-xb) @ tilt)
    return k.finish(k.turn(nodes, plan.place()), item, p, {"d_m": 2 * r0, "top_d_m": 2 * rt})


@builder("flare", family="equipment", params=FlareParams, doc=DOC_FLARE, default_height_m=H_FLARE)
def build_flare(item: Item, ctx: BuildCtx) -> list[MeshNode]:
    p = k.params(item, FlareParams)
    plan = k.plan_of(item, ctx)
    H, _ = k.height(item, ctx, H_FLARE)
    d = min(plan.along, plan.across)
    rd = p.riser_d_m or min(1.5, 0.3 * d)
    td = p.tip_d_m or 1.3 * rd
    tip_h = max(2.0, 2.0 * td)
    y_tip = H - tip_h
    if y_tip < 3.0:
        raise ValueError("flare: height too small")
    riser_r = rd / 2 * (1.3 if p.support == "self" else 1.0)
    seal_r, seal_h = min(0.9 * rd, d / 2 - 0.05), min(6.0, 0.12 * H)
    if seal_r <= riser_r + 0.02:
        raise ValueError("flare: riser too wide for the footprint (the seal drum would vanish inside it)")
    nodes = [
        k.node("foundation", "Concrete", k.vcyl(d / 2, 0.3, ctx)),
        k.node("riser", "Steel_Dark", k.vcyl(riser_r, y_tip - 0.3, ctx, y0=0.3)),
        k.node("seal", "Steel_Dark", k.vcyl(seal_r, seal_h, ctx, y0=0.3)),
        k.node(
            "tip", "Safety_Red", k.lathe([(0.0, y_tip), (td / 2, y_tip), (td / 2, H), (0.0, H)], ctx, td / 2)
        ),
    ]
    derived: dict = {"riser_d_m": rd, "tip_d_m": td}
    if p.support == "derrick":
        b = p.derrick_base_m or max(d, 0.16 * H)
        tw = max(rd + 1.0, 0.25 * b)
        hd = y_tip - 0.3  # the derrick carries the top platform just under the tip

        def half(y: float) -> float:
            return b / 2 + (tw / 2 - b / 2) * min(y, hd) / hd

        if half(0.3 + seal_h) - 0.15 <= seal_r + 0.05:
            raise ValueError("flare: derrick base too narrow for the seal drum")

        corners = ((1, 1), (1, -1), (-1, -1), (-1, 1))
        legs_y0 = 0.4  # legs stand on the 0.4 m footings
        nodes.append(k.node("derrick", "Steel_Structure", *k.lattice(b, tw, legs_y0, hd, 0.8 * b, 0.3, 0.12)))
        nodes.append(
            MeshNode(
                "leg_footings",
                "Concrete",
                k.inst(k.box(1.2, 0.4, 1.2), [k.T(c[0] * b / 2, 0, c[1] * b / 2) for c in corners]),
            )
        )
        levels = ([hd] + [hd * j / p.platforms for j in range(1, p.platforms)]) if p.platforms else []
        for i, yl in enumerate(levels):
            hw = half(yl) + 0.6
            sq = [(hw, hw), (hw, -hw), (-hw, -hw), (-hw, hw)]
            nodes.append(k.node(f"platform_{i}_deck", "Grating", k.slab(sq, yl - k.DECK_T, k.DECK_T)))
            nodes += k.handrail(f"platform_{i}", sq, yl)
        derived["derrick_base_m"] = b
    else:
        yl = y_tip - 0.3
        deck = k.lathe(
            [(riser_r, yl - k.DECK_T), (riser_r + 1.0, yl - k.DECK_T), (riser_r + 1.0, yl), (riser_r, yl)],
            ctx,
            riser_r + 1.0,
        )
        nodes.append(k.node("tip_platform_deck", "Grating", deck))
        nodes += k.ring_handrail("tip_platform", riser_r + 0.95, yl, ctx)
        if p.support == "guyed":
            anchors = [
                (0.5 * H * math.cos(a), 0.5 * H * math.sin(a)) for a in np.radians([0.0, 120.0, 240.0])
            ]
            yg = min(0.7 * H, yl - k.DECK_T - 0.2)  # guys leave the riser below the tip platform
            guys = [k.bar((0, yg, 0), (ax, 0.3, az), 0.05) for ax, az in anchors]
            nodes.append(k.node("guys", "Steel_Structure", *guys))
            pads = k.inst(k.box(1.0, 0.6, 1.0), [k.T(ax, 0, az) for ax, az in anchors])
            nodes.append(MeshNode("guy_anchors", "Concrete", pads))
    return k.finish(k.turn(nodes, plan.place()), item, p, derived)


@builder("package", family="equipment", params=PackageParams, doc=DOC_PACKAGE, default_height_m=H_PACKAGE)
def build_package(item: Item, ctx: BuildCtx) -> list[MeshNode]:
    p = k.params(item, PackageParams)
    plan = k.plan_of(item, ctx)
    H, _ = k.height(item, ctx, H_PACKAGE)
    if H < 0.5:
        raise ValueError("package: height too small")
    L, W = plan.along, plan.across
    style = p.style
    if style == "auto":
        style = "cabinet" if L * W < 4.0 else ("skid" if H <= 2.5 else "enclosure")
    mat = PACKAGE_COLOUR[p.colour]
    if style == "skid":
        if min(L, W) < 1.0:
            raise ValueError("package: footprint too small for a skid")
        fr = 0.2
        d = min(0.5 * W, 0.6 * (H - fr))
        r = d / 2
        yc = fr + r + 0.05
        yp = min(yc + r + 0.25, H - 0.05)
        rp = max(0.03, 0.05 * d)
        zp = min(0.15 * W, 0.5 * r)  # the riser leaves the vessel's top, not the air beside it
        frame = [k.box(L, fr, 0.15, z=s * (W / 2 - 0.075)) for s in (-1, 1)]
        frame += [k.box(0.15, fr, W - 0.3, x=s * (L / 2 - 0.075)) for s in (-1, 1)]
        # two saddles bridge the side rails and cradle the vessel
        frame += [k.box(0.15, yc - 0.4 * r - fr, W - 0.15, x=xs_, y0=fr) for xs_ in (-0.32 * L, -0.08 * L)]
        nodes = [k.node("skid_frame", "Steel_Structure", *frame)]
        xs = np.arange(-L / 2 + 1.5, L / 2 - 0.5, 1.5)
        if len(xs):
            cross = k.inst(k.box(0.12, fr, W - 0.3), [k.T(float(x), 0, 0) for x in xs])
            nodes.append(MeshNode("skid_cross", "Steel_Structure", cross))
        nodes += [
            k.node("skid_vessel", mat, k.rod((-0.42 * L, yc, 0), (0.02 * L, yc, 0), r, ctx)),
            k.node("skid_module", mat, k.box(0.36 * L, H - fr, 0.7 * W, x=0.26 * L, y0=fr)),
            k.node(
                "piping",
                "Pipe",
                k.rod((-0.2 * L, yc + 0.8 * r, zp), (-0.2 * L, yp, zp), rp, ctx),
                k.rod((-0.2 * L, yp, zp), (0.08 * L, yp, zp), rp, ctx),
            ),
        ]
    elif style == "enclosure":
        door = k.box(0.03, min(2.1, 0.8 * (H - 0.4)), min(1.0, 0.4 * W), x=0.48 * L + 0.015, y0=0.15)
        nodes = [
            k.node("pad", "Concrete", k.box(L, 0.15, W)),
            k.node("enclosure", mat, k.box(0.96 * L, H - 0.4, 0.96 * W, y0=0.15)),
            k.node("roof", "Equipment_White", k.box(L, 0.25, W, y0=H - 0.25)),
            k.node("door", "Steel_Dark", door),
        ]
    else:
        nodes = [
            k.node("plinth", "Concrete", k.box(L, 0.1, W)),
            k.node("cabinet", mat, k.box(0.9 * L, H - 0.2, 0.9 * W, y0=0.1)),
            k.node("canopy", "Equipment_White", k.box(L, 0.1, W, y0=H - 0.1)),
        ]
    return k.finish(k.turn(nodes, plan.place()), item, p, {"style": style})
