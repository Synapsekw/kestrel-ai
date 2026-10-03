"""Jetty and safety equipment: loading_arm, crane, monitor, nav_aid (unit B2)."""

from __future__ import annotations

import math
from typing import Literal

import numpy as np
from pydantic import Field

from app.asset_models.builders.base import BuildCtx, MeshNode, Params, builder
from app.asset_models.builders.equipment import _kit as k
from app.asset_models.spec import Item, Pos

H_ARM, H_CRANE, H_MON, H_NAV = 18.0, 8.0, 15.0, 6.0
LIGHT = {"red": "Safety_Red", "green": "Machine_Green", "white": "Equipment_White", "yellow": "Handrail"}


class LoadingArmParams(Params):
    slew_deg: float = Field(90.0, description="Bearing the arms reach toward (the berth face); default east")
    riser_frac: float = Field(0.45, gt=0.1, lt=0.9, description="Riser height / H")
    inner_up_deg: float = Field(65.0, ge=10, le=90, description="Inner arm elevation (stowed ~65)")
    outer_down_deg: float = Field(75.0, ge=0, le=90, description="Outer arm angle below horizontal")
    pipe_d_m: Pos | None = Field(None, description="Arm pipe OD. Default 0.5 x footprint d, at most 0.6 m.")


class CraneParams(Params):
    kind: Literal["jib", "pedestal"] = "jib"
    reach_m: Pos = Field(7.0, description="Jib or boom reach from the mast axis, m")
    slew_deg: float = Field(0.0, description="Bearing the jib or boom points to (stowed)")
    boom_up_deg: float = Field(45.0, ge=0, le=85, description="Pedestal crane boom elevation")


class MonitorParams(Params):
    tower: Literal["column", "lattice"] = "column"
    platform_m: Pos = Field(2.0, description="Square platform side at the top, m")
    aim_deg: float = Field(90.0, description="Bearing the monitor nozzle points to")


class NavAidParams(Params):
    kind: Literal["light", "horn", "beacon"] = "light"
    colour: Literal["red", "green", "white", "yellow"] = "red"


DOC_ARM = (
    "Marine loading arm: riser on a base plate, slewing bearing, inner arm, outer arm hanging to the "
    "coupler, swivels, counterweight and pantograph, stowed toward slew_deg (the berth). "
    "Footprint: circle = riser base."
)
DOC_CRANE = (
    "Crane. jib: pillar jib crane (mast, horizontal jib with knee brace, hoist and hook) - the tank-roof and "
    "platform cranes. pedestal: pedestal crane with cab and luffed boom. Footprint: circle = mast base."
)
DOC_MON = (
    "Elevated fire water monitor: red column or lattice tower, grating platform with handrail, "
    "monitor nozzle aimed at aim_deg and a ladder. Footprint: circle = tower base. top_el = monitor top."
)
DOC_NAV = (
    "Navigation aid on a mast: light (lantern, cap, solar panel), horn (fog horn and junction box) or beacon "
    "(lantern plus daymark board). Footprint: circle = mast base. colour sets the lantern/horn colour."
)


@builder("loading_arm", family="equipment", params=LoadingArmParams, doc=DOC_ARM, default_height_m=H_ARM)
def build_loading_arm(item: Item, ctx: BuildCtx) -> list[MeshNode]:
    p = k.params(item, LoadingArmParams)
    plan = k.plan_of(item, ctx)
    H, _ = k.height(item, ctx, H_ARM)
    d0 = min(plan.along, plan.across)
    rr = d0 / 2
    rp = (p.pipe_d_m or min(0.6, 0.5 * d0)) / 2
    yr = p.riser_frac * H
    ti, to = math.radians(p.inner_up_deg), math.radians(p.outer_down_deg)
    p0 = np.array([0.0, yr + 0.6, 0.0])
    li = (H - 0.1 - rp - p0[1]) / max(math.sin(ti), 1e-3)
    if li < 0.5:
        raise ValueError("loading_arm: height too small for the inner arm")
    li = min(li, 0.6 * H)
    di = np.array([math.cos(ti), math.sin(ti), 0.0])
    p1 = p0 + li * di
    if H - (p1[1] + 1.4 * rp) > max(0.05 * H, 0.5):
        raise ValueError(
            "loading_arm: inner_up_deg too flat for the height (raise riser_frac or inner_up_deg)"
        )
    lo = 1.15 * li
    if math.sin(to) > 1e-3:
        lo = min(lo, (p1[1] - 0.5) / math.sin(to))
    p2 = p1 + lo * np.array([math.cos(to), -math.sin(to), 0.0])
    # the counterweight beam runs straight back from the pivot so it never cuts into the riser
    pc = p0 - np.array([max(0.3 * li, 1.2 * rr + 0.8), 0.0, 0.0])
    across = np.array([0.0, 0.0, 2.2 * rp])
    coupler = min(1.0, p2[1] - 0.1)
    nodes = [
        k.node("base", "Steel_Dark", k.vcyl(rr * 1.4, 0.15, ctx)),
        k.node("riser", "Equipment_White", k.vcyl(rr, yr - 0.15, ctx, y0=0.15)),
        k.node(
            "slew_bearing",
            "Steel_Dark",
            k.vcyl(rr * 1.2, 0.3, ctx, y0=yr),
            k.vcyl(rr * 0.8, 0.3, ctx, y0=yr + 0.3),
        ),
        k.node("inner_arm", "Equipment_White", k.rod(p0, p1, rp, ctx), k.rod(p0, pc, 0.8 * rp, ctx)),
        k.node("outer_arm", "Equipment_White", k.rod(p1, p2, rp, ctx)),
        k.node(
            "swivels",
            "Steel_Dark",
            k.rod(p0 - across, p0 + across, 1.4 * rp, ctx),
            k.rod(p1 - across, p1 + across, 1.4 * rp, ctx),
            *([k.rod(p2, p2 - np.array([0.0, coupler, 0.0]), 1.2 * rp, ctx)] if coupler > 0.05 else []),
        ),
        k.node("counterweight", "Steel_Dark", k.box(1.2, 1.2, 1.0, x=float(pc[0]), y0=float(pc[1]) - 0.6)),
        k.node("pantograph", "Handrail", k.bar(pc + np.array([0.0, 0.6, 0.0]), p1, 0.08)),
    ]
    nodes = k.turn(nodes, k.T(plan.cx, 0.0, plan.cz) @ k.yaw(p.slew_deg))
    return k.finish(nodes, item, p, {"inner_m": li, "outer_m": lo, "reach_m": float(p2[0])})


@builder("crane", family="equipment", params=CraneParams, doc=DOC_CRANE, default_height_m=H_CRANE)
def build_crane(item: Item, ctx: BuildCtx) -> list[MeshNode]:
    p = k.params(item, CraneParams)
    plan = k.plan_of(item, ctx)
    H, _ = k.height(item, ctx, H_CRANE)
    if H < 2.5:
        raise ValueError("crane: height too small")
    d = min(plan.along, plan.across)
    reach = p.reach_m
    if p.kind == "jib":
        rm = max(0.15, 0.3 * d)
        if 0.35 * reach < rm + 0.1:
            raise ValueError("crane: reach_m too short for the mast (brace and hoist would sit inside it)")
        yj = H - 0.25
        xh = 0.7 * reach
        nodes = [
            k.node("base", "Steel_Dark", k.vcyl(min(1.6 * rm, d / 2), 0.1, ctx)),
            k.node("mast", "Handrail", k.vcyl(rm, H - 0.1, ctx, y0=0.1)),
            k.node("jib", "Handrail", k.bar((0, yj, 0), (reach, yj, 0), 0.25, 0.4)),
            k.node(
                "knee_brace", "Handrail", k.bar((0, max(0.5, yj - 1.2), 0), (0.35 * reach, yj - 0.2, 0), 0.1)
            ),
            k.node("hoist", "Steel_Dark", k.box(0.6, 0.4, 0.5, x=xh, y0=yj - 0.6)),
            k.node(
                "hook",
                "Steel_Dark",
                k.bar((xh, yj - 0.6, 0), (xh, max(0.5, yj - 2.5), 0), 0.03),
                k.box(0.25, 0.25, 0.25, x=xh, y0=max(0.25, yj - 2.75)),
            ),
        ]
    else:
        rm = max(0.4, 0.35 * d)
        hp = 0.55 * H
        cab_h = max(0.5, min(2.0, H - hp - 0.4))
        b0 = np.array([0.4 * rm, hp + 0.8, 0.0])
        b = math.radians(p.boom_up_deg)
        lb = reach / math.cos(b)
        if b0[1] + lb * math.sin(b) > H - 0.2 and math.sin(b) > 1e-3:
            lb = (H - 0.2 - b0[1]) / math.sin(b)
            reach = lb * math.cos(b)
        tip = b0 + lb * np.array([math.cos(b), math.sin(b), 0.0])
        a_top = np.array([-0.2, min(H, hp + 3.0), 0.0])
        cab_top = hp + 0.3 + cab_h
        if H - max(tip[1] + 0.2, a_top[1], cab_top) > max(0.05 * H, 0.5):
            raise ValueError("crane: the boom stops short of top_el (raise reach_m or boom_up_deg)")
        nodes = [
            k.node("pedestal", "Handrail", k.vcyl(rm, hp, ctx)),
            k.node("slew_ring", "Steel_Dark", k.vcyl(1.15 * rm, 0.3, ctx, y0=hp)),
            k.node("cab", "Equipment_White", k.box(1.6, cab_h, 1.4, x=-0.5, y0=hp + 0.3)),
            k.node("boom", "Handrail", k.bar(b0, tip, 0.4), k.bar((-0.2, cab_top, 0.0), a_top, 0.15)),
            k.node("luffing_rope", "Steel_Dark", k.bar(a_top, tip, 0.04)),
            k.node(
                "hook", "Steel_Dark", k.bar(tip, tip - np.array([0.0, min(2.0, tip[1] - 0.3), 0.0]), 0.03)
            ),
        ]
    nodes = k.turn(nodes, k.T(plan.cx, 0.0, plan.cz) @ k.yaw(p.slew_deg))
    return k.finish(nodes, item, p, {"reach_m": reach})


@builder("monitor", family="equipment", params=MonitorParams, doc=DOC_MON, default_height_m=H_MON)
def build_monitor(item: Item, ctx: BuildCtx) -> list[MeshNode]:
    p = k.params(item, MonitorParams)
    plan = k.plan_of(item, ctx)
    H, _ = k.height(item, ctx, H_MON)
    d = min(plan.along, plan.across)
    yp = H - k.RAIL_H - k.DECK_T
    if yp < 1.0:
        raise ValueError("monitor: height too small")
    rt = max(0.25, d / 2)
    if p.tower == "column":
        tower = [k.vcyl(rt, yp, ctx)]
        rl, lb = rt + 0.4, p.aim_deg + 180.0
    else:
        wb = max(d, 1.2)
        # legs from 0.1 m so no bar dips below grade; base plates carry them down to it
        tower = k.lattice(wb, 0.8, 0.1, yp, 3.0, 0.15, 0.08)
        tower += [k.box(0.3, 0.12, 0.3, x=sx * wb / 2, z=sz * wb / 2) for sx in (-1, 1) for sz in (-1, 1)]
        rl, lb = wb / 2 + 0.2, 90.0 * round((p.aim_deg + 180.0) / 90.0)  # on a face, clear of the legs
    pm = p.platform_m
    if pm / 2 < rl + 0.1:
        raise ValueError("monitor: platform_m too small to cover the tower and its ladder")
    sq = [(pm / 2, pm / 2), (pm / 2, -pm / 2), (-pm / 2, -pm / 2), (-pm / 2, pm / 2)]
    a, pitch = math.radians(p.aim_deg), math.radians(15.0)
    base = np.array([0.0, yp + 0.9, 0.0])
    tip = base + 1.2 * np.array(
        [math.cos(a) * math.cos(pitch), math.sin(pitch), math.sin(a) * math.cos(pitch)]
    )
    la = math.radians(lb)
    nodes = [
        k.node("tower", "Safety_Red", *tower),
        k.node("platform", "Grating", k.box(pm, k.DECK_T, pm, y0=yp)),
        *k.handrail("platform", sq, yp + k.DECK_T),
        k.node(
            "monitor", "Safety_Red", k.vcyl(0.12, 0.82, ctx, y0=yp + k.DECK_T), k.rod(base, tip, 0.08, ctx)
        ),
        *k.ladder("ladder", math.cos(la) * rl, math.sin(la) * rl, 0.0, yp, lb - 180.0),
    ]
    return k.finish(k.turn(nodes, plan.place()), item, p, {"platform_el_m": yp})


def _light_head(ym: float, H: float, lamp: str, ctx: BuildCtx) -> list[MeshNode]:
    return [
        k.node("lantern", lamp, k.vcyl(0.2, 0.45, ctx, y0=ym)),
        k.node("cap", "Steel_Dark", k.lathe([(0.0, ym + 0.45), (0.22, ym + 0.45), (0.0, H)], ctx, 0.22)),
    ]


@builder("nav_aid", family="equipment", params=NavAidParams, doc=DOC_NAV, default_height_m=H_NAV)
def build_nav_aid(item: Item, ctx: BuildCtx) -> list[MeshNode]:
    p = k.params(item, NavAidParams)
    plan = k.plan_of(item, ctx)
    H, _ = k.height(item, ctx, H_NAV)
    if H < 1.2:  # the light's solar panel hangs 1.1 m below the top
        raise ValueError("nav_aid: height too small")
    lamp = LIGHT[p.colour]
    nodes = [k.node("base", "Steel_Dark", k.vcyl(0.3, 0.05, ctx, n=8))]
    if p.kind == "horn":
        horn = k.placed(
            k.lathe([(0.0, 0.0), (0.06, 0.0), (0.25, 0.6), (0.0, 0.6)], ctx, 0.25),
            k.T(0.06, H - 0.45, 0) @ k.Y_TO_X,
        )
        nodes += [
            k.node("mast", "Handrail", k.vcyl(0.08, H - 0.05, ctx, y0=0.05)),
            k.node("horn", lamp, horn),
            k.node("junction_box", "Steel_Dark", k.box(0.25, 0.3, 0.2, x=-0.15, y0=H - 1.0)),
        ]
    else:
        ym = H - 0.6
        nodes.append(k.node("mast", "Handrail", k.vcyl(0.08, ym - 0.05, ctx, y0=0.05)))
        nodes += _light_head(ym, H, lamp, ctx)
        if p.kind == "beacon":
            nodes.append(
                k.node("daymark", lamp, k.box(0.03, min(1.0, ym - 0.3), 1.0, x=0.09, y0=max(0.3, ym - 1.1)))
            )
        else:
            nodes.append(
                k.node(
                    "solar_panel",
                    "Steel_Dark",
                    k.box(0.4, 0.03, 0.5, x=-0.3, y0=ym - 0.5),
                    k.bar((-0.05, ym - 0.48, 0), (-0.12, ym - 0.48, 0), 0.04),
                )
            )
    return k.finish(k.turn(nodes, plan.place()), item, p, {"kind": p.kind})
