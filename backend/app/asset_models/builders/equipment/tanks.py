"""Tanks: storage_tank_small and tank_lng (unit B2)."""

from __future__ import annotations

from typing import Literal

from pydantic import Field

from app.asset_models.builders.base import BuildCtx, MeshNode, Params, builder
from app.asset_models.builders.equipment import _kit as k
from app.asset_models.builders.equipment.vessels import head_depth
from app.asset_models.spec import Item, NonNeg

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
    d = min(W - 0.6, H - 0.5)
    if d < 0.2:
        raise ValueError("storage_tank_small: footprint or height too small for a horizontal tank")
    r, hd = d / 2, head_depth("ellipsoidal", d)
    yc = H - r
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
    if H - (yc + r) <= 0.05:  # vent nozzle sits inside the shell's top band
        xn, rn = 0.2 * shell_len, max(0.04, 0.05 * d)
        nodes.append(k.node("nozzles", "Pipe", k.rod((xn, yc + 0.7 * r, 0), (xn, H, 0), rn, ctx)))
    return nodes, {"d_m": d, "shell_len_m": shell_len}
