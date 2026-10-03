"""Rotating equipment: pump, pump_group, compressor (unit B2)."""

from __future__ import annotations

from typing import Literal

from pydantic import Field

from app.asset_models.builders.base import BuildCtx, MeshNode, Params, builder
from app.asset_models.builders.equipment import _kit as k
from app.asset_models.spec import Item, Pos

H_PUMP, H_GROUP = 2.0, 2.5
UNIT_PLINTH = 0.15


class PumpParams(Params):
    kind: Literal["auto", "horizontal", "vertical_inline", "column"] = Field(
        "auto",
        description="auto: circle footprint -> column (can / tank-roof pump head), otherwise horizontal",
    )
    driver: Literal["motor", "engine"] = "motor"
    plinth: bool = True


class PumpGroupParams(Params):
    n: int | None = Field(None, ge=1, le=24, description="Pumps in the row. Default floor(along / pitch).")
    pitch_m: Pos | None = Field(
        None, description="Centre spacing along the row. Default 2.5 m, or along / n."
    )
    kind: Literal["horizontal", "vertical_inline", "column"] = "horizontal"
    driver: Literal["motor", "engine"] = "motor"


DOC_PUMP = (
    "Pump. horizontal: plinth, baseplate, volute casing with suction and discharge, coupling guard, "
    "motor (or diesel engine + radiator) along the footprint's long axis. column: vertical can/roof "
    "pump head with motor on top (circle footprint). vertical_inline: inline body with motor above. "
    "top_el = discharge or motor top."
)
DOC_GROUP = (
    "Row of identical pumps on one concrete plinth, laid along the footprint's long axis, each pump's "
    "shaft across the row. Give n (or pitch_m), kind and driver; Cowork's fire-water diesel units are "
    "n=1, driver=engine."
)


def _column(d: float, H: float, y: float, ctx: BuildCtx) -> list[MeshNode]:
    avail = H - y - 0.1
    if avail < 0.3:
        raise ValueError("pump: height too small")
    yb = y + 0.1
    head_h, stool_h, motor_h = 0.45 * avail, 0.1 * avail, 0.37 * avail
    y_stool, y_motor = yb + head_h, yb + head_h + stool_h
    y_cap = y_motor + motor_h
    rh = 0.32 * d
    ym = yb + 0.5 * head_h
    return [
        k.node("baseplate", "Steel_Dark", k.vcyl(0.5 * d, 0.1, ctx, y0=y)),
        k.node(
            "pump_head",
            "Pump_Blue",
            k.vcyl(rh, head_h, ctx, y0=yb),
            k.rod((0, ym, 0), (0.5 * d, ym, 0), 0.35 * rh, ctx),
        ),
        k.node("motor_stool", "Steel_Dark", k.vcyl(0.22 * d, stool_h, ctx, y0=y_stool)),
        k.node(
            "motor",
            "Equipment_Grey",
            k.vcyl(0.28 * d, motor_h, ctx, y0=y_motor),
            k.lathe([(0.0, y_cap), (0.2 * d, y_cap), (0.0, H)], ctx, 0.2 * d),
        ),
    ]


def _inline(L: float, W: float, H: float, y: float, ctx: BuildCtx) -> list[MeshNode]:
    avail = H - y - 0.1
    if avail < 0.3:
        raise ValueError("pump: height too small")
    yb = y + 0.1
    rb = min(0.3 * W, 0.3 * L, 0.2 * avail)
    body_h, motor_h = 0.35 * avail, 0.5 * avail
    ym = yb + body_h
    yn = yb + 0.4 * body_h
    return [
        k.node("baseplate", "Steel_Dark", k.box(0.8 * L, 0.1, 0.8 * W, y0=y)),
        k.node(
            "casing",
            "Pump_Blue",
            k.vcyl(rb, body_h, ctx, y0=yb),
            k.rod((-0.5 * L, yn, 0), (0.5 * L, yn, 0), 0.4 * rb, ctx),
        ),
        k.node(
            "motor",
            "Equipment_Grey",
            k.vcyl(0.8 * rb, motor_h, ctx, y0=ym),
            k.lathe([(0.0, ym + motor_h), (0.6 * rb, ym + motor_h), (0.0, H)], ctx, 0.6 * rb),
        ),
    ]


def _horizontal(driver: str, L: float, W: float, H: float, y: float, ctx: BuildCtx) -> list[MeshNode]:
    nodes = [k.node("baseplate", "Steel_Dark", k.box(0.95 * L, 0.1, 0.85 * W, y0=y))]
    y += 0.1
    avail = H - y
    if avail < 0.2:
        raise ValueError("pump: height too small")
    rv = min(0.45 * W, 0.3 * avail)
    yc = y + rv
    rm = min(0.4 * W, 0.9 * rv)
    nodes.append(
        k.node(
            "casing",
            "Pump_Blue",
            k.rod((0.2 * L, yc, 0), (0.36 * L, yc, 0), rv, ctx),
            k.rod((0.36 * L, yc, 0), (0.5 * L, yc, 0), 0.45 * rv, ctx),
        )
    )
    if H - (yc + 0.8 * rv) > 0.05:
        nodes.append(
            k.node(
                "discharge",
                "Pump_Blue",
                k.rod((0.28 * L, yc + 0.8 * rv, 0), (0.28 * L, H, 0), 0.35 * rv, ctx),
            )
        )
    nodes.append(
        k.node(
            "coupling_guard",
            "Equipment_Grey",
            k.box(0.17 * L, 1.2 * rm, 1.1 * rm, x=0.03 * L, y0=yc - 0.6 * rm),
        )
    )
    if driver == "engine":
        eh = min(2.2 * rm, avail)
        nodes.append(k.node("engine", "Machine_Green", k.box(0.4 * L, eh, 0.8 * W, x=-0.25 * L, y0=y)))
        nodes.append(k.node("radiator", "Equipment_White", k.box(0.05 * L, eh, 0.8 * W, x=-0.475 * L, y0=y)))
    else:
        nodes.append(
            k.node(
                "motor",
                "Equipment_Grey",
                k.rod((-0.45 * L, yc, 0), (-0.05 * L, yc, 0), rm, ctx),
                k.rod((-0.5 * L, yc, 0), (-0.45 * L, yc, 0), 0.85 * rm, ctx),
            )
        )
        if yc - rm - y > 0.02:
            nodes.append(
                k.node("motor_feet", "Steel_Dark", k.box(0.3 * L, yc - rm - y, 1.2 * rm, x=-0.25 * L, y0=y))
            )
    return nodes


def pump_unit(
    kind: str, driver: str, L: float, W: float, H: float, ctx: BuildCtx, *, plinth: bool = True
) -> list[MeshNode]:
    """One pump in its own frame: centred on the origin, shaft along +x, base at y = 0, top at H."""
    nodes: list[MeshNode] = []
    y = 0.0
    if plinth:
        nodes.append(k.node("plinth", "Concrete", k.box(L, UNIT_PLINTH, W)))
        y = UNIT_PLINTH
    if kind == "column":
        return nodes + _column(min(L, W), H, y, ctx)
    if kind == "vertical_inline":
        return nodes + _inline(L, W, H, y, ctx)
    return nodes + _horizontal(driver, L, W, H, y, ctx)


@builder("pump", family="equipment", params=PumpParams, doc=DOC_PUMP, default_height_m=H_PUMP)
def build_pump(item: Item, ctx: BuildCtx) -> list[MeshNode]:
    p = k.params(item, PumpParams)
    plan = k.plan_of(item, ctx)
    H, _ = k.height(item, ctx, H_PUMP)
    kind = p.kind if p.kind != "auto" else ("column" if plan.is_round else "horizontal")
    nodes = pump_unit(kind, p.driver, plan.along, plan.across, H, ctx, plinth=p.plinth)
    return k.finish(
        k.turn(nodes, plan.place()), item, p, {"kind": kind, "along_m": plan.along, "across_m": plan.across}
    )


@builder("pump_group", family="equipment", params=PumpGroupParams, doc=DOC_GROUP, default_height_m=H_GROUP)
def build_pump_group(item: Item, ctx: BuildCtx) -> list[MeshNode]:
    p = k.params(item, PumpGroupParams)
    plan = k.plan_of(item, ctx)
    H, _ = k.height(item, ctx, H_GROUP)
    if H <= 0.5:
        raise ValueError("pump_group: height too small")
    row, deep = plan.along, plan.across
    if p.n is not None:
        n = p.n
        pitch = p.pitch_m or row / n
    else:
        pitch = p.pitch_m or 2.5
        n = max(1, int(row // pitch))
    n = min(n, 24)
    if n * pitch > row + 1e-6:
        pitch = row / n
    if p.kind == "column":
        size = 0.8 * min(pitch, deep)
        unit = pump_unit("column", p.driver, size, size, H - 0.2, ctx, plinth=False)
    else:
        unit = pump_unit(p.kind, p.driver, 0.85 * deep, 0.8 * pitch, H - 0.2, ctx, plinth=False)
    xf = [k.T((i - (n - 1) / 2) * pitch, 0.2, 0.0) @ k.yaw(90.0) for i in range(n)]
    nodes = [k.node("plinth", "Concrete", k.box(row, 0.2, deep))]
    nodes += [MeshNode(u.name, u.material, k.inst(u.geometry, xf)) for u in unit]
    return k.finish(k.turn(nodes, plan.place()), item, p, {"n": n, "pitch_m": pitch})
