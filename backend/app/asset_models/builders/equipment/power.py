"""Power equipment: generator and transformer (unit B2)."""

from __future__ import annotations

from typing import Literal

import trimesh
from pydantic import Field

from app.asset_models.builders.base import BuildCtx, MeshNode, Params, builder
from app.asset_models.builders.equipment import _kit as k
from app.asset_models.spec import Item

H_GEN, H_TX = 4.0, 4.0


class GeneratorParams(Params):
    radiator_end: Literal["start", "end"] = Field(
        "end", description="Radiator at the start (-along) or end (+along) of the long axis"
    )
    exhaust: bool = True


class TransformerParams(Params):
    bays: int | None = Field(
        None, ge=1, le=12, description="Transformer bays along the long axis. Default round(along / 6)."
    )
    firewalls: bool = True


DOC_GEN = (
    "Containerised diesel generator: concrete plinth, fuel base tank, acoustic enclosure with doors, "
    "radiator end with louvres, exhaust silencer and stack, along the footprint's long axis. "
    "top_el = stack top."
)
DOC_TX = (
    "Transformer bays along the footprint's long axis: per bay a plinth, main tank, radiator fins, HV "
    "bushings, conservator and a cable gantry; concrete fire walls between and at the ends of the bays."
)


@builder("generator", family="equipment", params=GeneratorParams, doc=DOC_GEN, default_height_m=H_GEN)
def build_generator(item: Item, ctx: BuildCtx) -> list[MeshNode]:
    p = k.params(item, GeneratorParams)
    plan = k.plan_of(item, ctx)
    H, _ = k.height(item, ctx, H_GEN)
    if H < 1.5:
        raise ValueError("generator: height too small")
    L, W = plan.along, plan.across
    s = 1.0 if p.radiator_end == "end" else -1.0
    ex = min(1.2, 0.25 * (H - 0.6)) if p.exhaust else 0.0
    he = H - 0.6 - ex
    louvres = max(3, int(he / 0.25))
    door = k.box(0.9, min(2.1, 0.8 * he), 0.03)
    door_xf = [k.T(-s * 0.1 * L + o * L, 0.6, sz * 0.451 * W) for o in (-0.25, 0.0, 0.25) for sz in (-1, 1)]
    louvre_xf = [k.T(s * 0.465 * L, 0.6 + (j + 0.5) * he / louvres, 0) for j in range(louvres)]
    nodes = [
        k.node("plinth", "Concrete", k.box(L, 0.2, W)),
        k.node("fuel_base", "Steel_Dark", k.box(0.95 * L, 0.4, 0.9 * W, y0=0.2)),
        k.node("enclosure", "Machine_Green", k.box(0.76 * L, he, 0.9 * W, x=-s * 0.1 * L, y0=0.6)),
        k.node("radiator", "Equipment_White", k.box(0.18 * L, he, 0.9 * W, x=s * 0.37 * L, y0=0.6)),
        MeshNode("radiator_louvres", "Steel_Dark", k.inst(k.box(0.04, 0.05, 0.8 * W), louvre_xf)),
        MeshNode("doors", "Steel_Dark", k.inst(door, door_xf)),
    ]
    if p.exhaust:
        rs = 0.3 * ex
        ys = 0.6 + he + rs
        nodes.append(
            k.node(
                "exhaust",
                "Steel_Dark",
                k.rod((-s * 0.3 * L, ys, 0), (-s * 0.05 * L, ys, 0), rs, ctx),
                k.rod((-s * 0.05 * L, ys, 0), (-s * 0.05 * L, H, 0), 0.4 * rs, ctx),
            )
        )
    return k.finish(
        k.turn(nodes, plan.place()), item, p, {"enclosure_h_m": he, "axis_bearing_deg": plan.bearing_deg}
    )


@builder("transformer", family="equipment", params=TransformerParams, doc=DOC_TX, default_height_m=H_TX)
def build_transformer(item: Item, ctx: BuildCtx) -> list[MeshNode]:
    p = k.params(item, TransformerParams)
    plan = k.plan_of(item, ctx)
    H, _ = k.height(item, ctx, H_TX)
    if H < 1.0:
        raise ValueError("transformer: height too small")
    L, W = plan.along, plan.across
    bays = p.bays or max(1, round(L / 6.0))
    pb = L / bays
    xs = [(i - (bays - 1) / 2) * pb for i in range(bays)]
    th = 0.5 * H
    yt = 0.3 + th

    def per_bay(mesh: trimesh.Trimesh):
        return k.inst(mesh, [k.T(x, 0.0, 0.0) for x in xs])

    gantry = trimesh.util.concatenate(
        [k.bar((-0.3 * pb, 0.3, z), (-0.3 * pb, H - 0.075, z), 0.15) for z in (-0.3 * W, 0.3 * W)]
        + [k.bar((-0.3 * pb, H - 0.075, -0.3 * W), (-0.3 * pb, H - 0.075, 0.3 * W), 0.15)]
    )
    yc = yt + 0.15 * H
    fins = [
        k.T(x - 0.15 * pb + j * 0.06 * pb, 0.3 + 0.05 * H, s * 0.225 * W)
        for x in xs
        for s in (-1, 1)
        for j in range(6)
    ]
    bushings = [k.T(x, yt, z * W) for x in xs for z in (-0.1, 0.0, 0.1)]
    conservator = k.rod((0.12 * pb, yc, -0.15 * W), (0.12 * pb, yc, 0.15 * W), min(0.06 * H, 0.1 * pb), ctx)
    nodes = [
        MeshNode("plinths", "Concrete", per_bay(k.box(0.85 * pb, 0.3, 0.8 * W))),
        MeshNode("tanks", "Steel_Dark", per_bay(k.box(0.4 * pb, th, 0.35 * W, y0=0.3))),
        MeshNode("radiator_fins", "Steel_Dark", k.inst(k.box(0.04, 0.4 * H, 0.1 * W), fins)),
        MeshNode("bushings", "Equipment_White", k.inst(k.vcyl(0.08, 0.18 * H, ctx), bushings)),
        MeshNode("conservators", "Steel_Dark", per_bay(conservator)),
        MeshNode("gantries", "Steel_Structure", per_bay(gantry)),
    ]
    if p.firewalls:
        walls = [
            k.T(min(max(-L / 2 + j * pb, -L / 2 + 0.125), L / 2 - 0.125), 0.0, 0.0) for j in range(bays + 1)
        ]
        nodes.append(MeshNode("firewalls", "Concrete", k.inst(k.box(0.25, H, 0.9 * W), walls)))
    return k.finish(k.turn(nodes, plan.place()), item, p, {"bays": bays, "bay_pitch_m": pb})
