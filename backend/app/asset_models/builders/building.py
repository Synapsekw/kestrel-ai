"""Building builders (plant model spec 2026-10-03 §6, unit B3): building, substation,
analyzer_house, shelter, gate.

A house is a plinth (optional), walls, a roof slab (optionally overhanging) and a parapet ring,
with glazing bands per storey and door panels on the longest walls. Glazing and doors are thin
boxes 3 cm proud of the wall face. Same item-local frame and helpers as `civil`.
"""

from __future__ import annotations

import math

import numpy as np
from pydantic import Field
from shapely.geometry import Polygon

from app.asset_models.builders.base import BuildCtx, MeshNode, builder
from app.asset_models.builders.civil import (
    B3Params,
    bar,
    largest_polygon,
    merge,
    outline,
    prism,
    record,
)
from app.asset_models.spec import Item

PROUD = 0.03  # glazing and doors stand this far off the wall face
MIN_WALL_M = 0.5


class HouseParams(B3Params):
    plinth_h: float = Field(0.0, ge=0, le=5)
    roof_t: float = Field(0.3, gt=0, le=3)
    parapet_h: float = Field(0.6, ge=0, le=3)
    parapet_t: float = Field(0.25, gt=0, le=1)
    roof_overhang: float = Field(0.0, ge=0, le=5)
    storey_h: float = Field(4.0, gt=2, le=10)
    windows: bool = True
    sill_h: float = Field(1.2, ge=0, le=5)
    window_h: float = Field(0.9, gt=0, le=5)
    doors: int = Field(1, ge=0, le=8)
    door_w: float = Field(2.0, gt=0.5, le=10)
    door_h: float = Field(2.4, gt=1, le=10)
    hvac: bool = False  # a wall-hung air-conditioning unit on the shortest wall


class SubstationParams(HouseParams):
    plinth_h: float = Field(1.5, ge=0, le=5)
    windows: bool = False
    door_w: float = Field(3.0, gt=0.5, le=10)
    door_h: float = Field(3.0, gt=1, le=10)


class AnalyzerHouseParams(HouseParams):
    parapet_h: float = Field(0.0, ge=0, le=3)
    roof_overhang: float = Field(0.3, ge=0, le=5)
    windows: bool = False
    door_w: float = Field(1.0, gt=0.5, le=10)
    door_h: float = Field(2.1, gt=1, le=10)
    hvac: bool = True


def _edges(poly: Polygon):
    """(a, b, outward unit normal, length) per exterior edge; the exterior is counter-clockwise."""
    ring = np.asarray(poly.exterior.coords)
    out = []
    for a, b in zip(ring[:-1], ring[1:], strict=True):
        d = b - a
        length = float(np.hypot(*d))
        if length > 1e-6:
            out.append((a, b, np.array([d[1], -d[0]]) / length, length))
    return out


def house(poly: Polygon, h: float, p: HouseParams, lod: float) -> list[MeshNode]:
    stack = p.plinth_h + p.roof_t + p.parapet_h
    k = min(1.0, max(h - MIN_WALL_M, 0.0) / stack) if stack > 0 else 1.0
    plinth, roof_t, parapet = p.plinth_h * k, p.roof_t * k, p.parapet_h * k
    if h - plinth - roof_t - parapet <= 0:
        raise ValueError("building needs a height")
    wall_top = h - parapet - roof_t
    nodes: list[MeshNode] = []
    if plinth > 0:
        nodes.append(MeshNode("plinth", "Concrete", prism(poly, 0.0, plinth)))
    nodes.append(MeshNode("walls", "Building_Wall", prism(poly, plinth, wall_top)))
    roof_poly = poly
    if p.roof_overhang > 0:
        roof_poly = largest_polygon(poly.buffer(p.roof_overhang, join_style="mitre", mitre_limit=2.0))
    roof = [prism(roof_poly, wall_top, wall_top + roof_t)]
    if parapet > 0:
        inner = poly.buffer(-p.parapet_t, join_style="mitre", mitre_limit=2.0)
        if not inner.is_empty and inner.area > 1e-3:
            ring = poly.difference(largest_polygon(inner))
            for g in getattr(ring, "geoms", [ring]):
                if isinstance(g, Polygon) and g.area > 1e-6:
                    roof.append(prism(g, wall_top + roof_t, h))
    nodes.append(MeshNode("roof", "Building_Roof", merge(roof)))
    edges = _edges(poly)
    if p.windows and lod >= 0.5:
        storeys = max(1, math.floor((wall_top - plinth) / p.storey_h))
        bands = []
        for s in range(storeys):
            y0 = plinth + s * p.storey_h + p.sill_h
            y1 = min(y0 + p.window_h, wall_top - 0.2)
            if y1 - y0 < 0.2:
                continue
            for a, b, nrm, length in edges:
                if length < 2.0:
                    continue
                d = (b - a) / length
                off = nrm * PROUD
                bands.append(bar(a + d * 0.5 + off, b - d * 0.5 + off, y0, y1, 0.04))
        if bands:
            nodes.append(MeshNode("glazing", "Glass", merge(bands)))
    if p.doors:
        doors = []
        for a, b, nrm, length in sorted(edges, key=lambda e: (-e[3], tuple(e[0])))[: p.doors]:
            w = min(p.door_w, length - 0.4)
            dh = min(p.door_h, wall_top - plinth - 0.1)
            if w <= 0.3 or dh <= 0.5:
                continue
            mid = (a + b) / 2
            d = (b - a) / length
            off = nrm * PROUD
            doors.append(bar(mid - d * w / 2 + off, mid + d * w / 2 + off, plinth, plinth + dh, 0.05))
        if doors:
            nodes.append(MeshNode("doors", "Steel_Dark", merge(doors)))
    if p.hvac:
        a, b, nrm, length = min(edges, key=lambda e: (e[3], tuple(e[0])))
        d = (b - a) / length
        w = min(1.0, length - 0.4)
        y0 = plinth + min(1.5, max(wall_top - plinth - 1.0, 0.0))
        if w > 0.2:
            mid = (a + b) / 2 + nrm * 0.3
            unit = bar(mid - d * w / 2, mid + d * w / 2, y0, y0 + 0.8, 0.6)
            nodes.append(MeshNode("hvac", "Equipment_Grey", unit))
    return nodes


def _house_builder(params_cls: type[HouseParams], default_h: float):
    def fn(item: Item, ctx: BuildCtx) -> list[MeshNode]:
        p = params_cls.model_validate(item.params)
        base, top, defaulted = ctx.height(item, default_h)
        return record(house(outline(item, ctx), top - base, p, ctx.lod), p, defaulted)

    return fn


builder(
    "building",
    family="building",
    params=HouseParams,
    default_height_m=6.0,
    doc="Building: walls, roof slab with parapet, glazing bands per storey, doors on the longest walls.",
)(_house_builder(HouseParams, 6.0))
builder(
    "substation",
    family="building",
    params=SubstationParams,
    default_height_m=9.0,
    doc="Substation: a building on a 1.5 m cable-cellar plinth, unglazed, with equipment doors.",
)(_house_builder(SubstationParams, 9.0))
builder(
    "analyzer_house",
    family="building",
    params=AnalyzerHouseParams,
    default_height_m=3.5,
    doc="Analyzer house: a small unglazed hut with an overhanging roof and one door.",
)(_house_builder(AnalyzerHouseParams, 3.5))
