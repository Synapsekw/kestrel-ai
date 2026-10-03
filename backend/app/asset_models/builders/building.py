"""Building builders (plant model spec 2026-10-03 §6, unit B3): building, substation,
analyzer_house, shelter, gate.

A house is a plinth (optional), walls, a roof slab (optionally overhanging) and a parapet ring,
with glazing bands per storey and door panels on the longest walls. Glazing and doors are thin
boxes 3 cm proud of the wall face. Same item-local frame and helpers as `civil`.
"""

from __future__ import annotations

import math

import numpy as np
import trimesh
from pydantic import Field
from shapely.geometry import Point, Polygon

from app.asset_models.builders.base import BuildCtx, MeshNode, builder
from app.asset_models.builders.civil import (
    MAX_INSTANCES,
    B3Params,
    axes,
    bar,
    instanced,
    largest_polygon,
    local_line,
    merge,
    outline,
    prism,
    record,
    stations,
    unit_box,
    yaw,
)
from app.asset_models.spec import Item

PROUD = 0.03  # glazing and doors stand this far off the wall face
MIN_WALL_M = 0.5
LEAF_MIN_M = 0.12  # a gate leaf's two end stiles; a shorter leaf would invert


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
    door_edges: set[int] = set()  # the HVAC unit keeps off these walls
    if p.doors:
        doors = []
        order = sorted(range(len(edges)), key=lambda i: (-edges[i][3], tuple(edges[i][0])))
        for i in order[: p.doors]:
            a, b, nrm, length = edges[i]
            w = min(p.door_w, length - 0.4)
            dh = min(p.door_h, wall_top - plinth - 0.1)
            if w <= 0.3 or dh <= 0.5:
                continue
            mid = (a + b) / 2
            d = (b - a) / length
            off = nrm * PROUD
            doors.append(bar(mid - d * w / 2 + off, mid + d * w / 2 + off, plinth, plinth + dh, 0.05))
            door_edges.add(i)
        if doors:
            nodes.append(MeshNode("doors", "Steel_Dark", merge(doors)))
    if p.hvac:
        free = [e for i, e in enumerate(edges) if i not in door_edges] or edges
        a, b, nrm, length = min(free, key=lambda e: (e[3], tuple(e[0])))
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


def _thin(rows: list, cap: int = MAX_INSTANCES) -> np.ndarray:
    """At most `cap` rows, picked evenly (first and last kept), as an (n, 4) array."""
    arr = np.asarray(rows, dtype=float).reshape(-1, 4)
    if len(arr) > cap:
        arr = arr[np.unique(np.linspace(0, len(arr) - 1, cap).round().astype(int))]
    return arr


# ------------------------------------------------------------------ shelter
class ShelterParams(B3Params):
    bay: float = Field(6.0, gt=1, le=30)
    column: float = Field(0.3, gt=0.05, le=2)
    roof_t: float = Field(0.35, gt=0, le=2)
    slab_t: float = Field(0.2, ge=0, le=2)
    beam_d: float = Field(0.4, gt=0, le=3)
    roof_overhang: float = Field(0.3, ge=0, le=5)


@builder(
    "shelter",
    family="building",
    params=ShelterParams,
    default_height_m=6.0,
    doc="Open shelter: slab, a column grid at bay spacing (instanced), eaves and cross beams, roof.",
)
def build_shelter(item: Item, ctx: BuildCtx) -> list[MeshNode]:
    p = ShelterParams.model_validate(item.params)
    base, top, defaulted = ctx.height(item, 6.0)
    h = top - base
    if h <= p.roof_t + p.slab_t + p.beam_d + 0.5:
        raise ValueError("shelter is too low for its roof")
    poly = outline(item, ctx)
    c, u, v, lu, lv = axes(poly)
    inset = p.column / 2 + 0.1
    if min(lu, lv) <= 2 * inset + 0.1:  # the column grid would invert: no room between the edges
        raise ValueError("shelter is narrower than its columns")
    step = p.bay / max(ctx.lod, 1e-3)
    nu = max(1, math.ceil((lu - 2 * inset) / step - 1e-9))
    nv = max(1, math.ceil((lv - 2 * inset) / step - 1e-9))
    while (nu + 1) * (nv + 1) > MAX_INSTANCES:  # a huge footprint widens its bays instead
        nu, nv = max(1, nu * 9 // 10), max(1, nv * 9 // 10)
    us = np.linspace(-lu / 2 + inset, lu / 2 - inset, nu + 1)
    vs = np.linspace(-lv / 2 + inset, lv / 2 - inset, nv + 1)
    keep_in = poly.buffer(1e-6)
    grid = [[c + u * a + v * b for a in us] for b in vs]
    cols = [q for row in grid for q in row if keep_in.contains(Point(float(q[0]), float(q[1])))]
    under = h - p.roof_t
    col_h = under - p.slab_t
    nodes = []
    if p.slab_t > 0:
        nodes.append(MeshNode("slab", "Concrete", prism(poly, 0.0, p.slab_t)))
    if cols:
        rows = np.array([(q[0], q[1], u[0], u[1]) for q in cols])
        column = unit_box(p.column, col_h, p.column)
        nodes.append(MeshNode("columns", "Steel_Structure", instanced(column, rows, p.slab_t)))
    beams = []
    for row in grid:
        beams.append(bar(row[0], row[-1], under - p.beam_d, under, p.column))
    for j in range(len(us)):
        beams.append(bar(grid[0][j], grid[-1][j], under - p.beam_d, under, p.column))
    nodes.append(MeshNode("beams", "Steel_Structure", merge(beams)))
    roof_poly = poly
    if p.roof_overhang > 0:
        roof_poly = largest_polygon(poly.buffer(p.roof_overhang, join_style="mitre", mitre_limit=2.0))
    nodes.append(MeshNode("roof", "Shelter_Roof", prism(roof_poly, under, h)))
    return record(nodes, p, defaulted)


# ------------------------------------------------------------------ gate
class GateParams(B3Params):
    post: float = Field(0.2, gt=0.05, le=1)
    picket_spacing: float = Field(0.5, gt=0.05, le=5)
    leaf_max: float = Field(4.0, gt=0.5, le=20)  # a wider opening is split into two leaves


@builder(
    "gate",
    family="building",
    params=GateParams,
    default_height_m=2.5,
    doc="Gate: posts at the ends, leaves with top/bottom rails, a diagonal brace and pickets (instanced).",
)
def build_gate(item: Item, ctx: BuildCtx) -> list[MeshNode]:
    p = GateParams.model_validate(item.params)
    base, top, defaulted = ctx.height(item, 2.5)
    h = top - base
    if not h > 0.5:
        raise ValueError("gate needs a height above 0.5 m")
    if item.footprint.kind == "line":
        pts = local_line(item, ctx)
    else:
        c, u, _, lu, _ = axes(outline(item, ctx))
        pts = np.array([c - u * lu / 2, c + u * lu / 2])
    posts: dict[tuple[float, float], tuple] = {}  # keyed by plan position: a corner gets one post
    frame, picket_rows = [], []
    for a, b in zip(pts[:-1], pts[1:], strict=True):
        length = float(np.hypot(*(b - a)))
        leaves = 2 if length > p.leaf_max else 1
        lw = (length - p.post) / leaves
        # each leaf keeps 0.05 m clear of its neighbours and needs room for its two 0.06 m stiles
        if length <= p.post * 2 or lw - 0.1 <= LEAF_MIN_M + 1e-9:
            continue
        d = (b - a) / length
        for q in (a, b):
            posts.setdefault((round(float(q[0]), 6), round(float(q[1]), 6)), (q[0], q[1], d[0], d[1]))
        for k in range(leaves):
            s0 = a + d * (p.post / 2 + k * lw + 0.05)
            s1 = a + d * (p.post / 2 + (k + 1) * lw - 0.05)
            frame += [bar(s0, s1, 0.1, 0.18, 0.06), bar(s0, s1, h - 0.18, h - 0.1, 0.06)]
            frame += [bar(s0, s0 + d * 0.06, 0.1, h - 0.1, 0.06), bar(s1 - d * 0.06, s1, 0.1, h - 0.1, 0.06)]
            frame.append(_brace(s0, s1, h))
            seg = np.array([s0, s1])
            rows = stations(seg, p.picket_spacing, ctx.lod)[1:-1]
            picket_rows += [tuple(r) for r in rows]
    if not posts:
        raise ValueError("gate line is shorter than its posts")
    nodes = [
        MeshNode(
            "posts",
            "Steel_Dark",
            instanced(unit_box(p.post, h + 0.1, p.post), np.array(list(posts.values()))),
        ),
        MeshNode("frame", "Steel_Dark", merge(frame)),
    ]
    if picket_rows:
        nodes.append(
            MeshNode(
                "pickets",
                "Steel_Dark",
                instanced(unit_box(0.03, h - 0.36, 0.03), _thin(picket_rows), 0.18),
            )
        )
    return record(nodes, p, defaulted)


def _brace(s0, s1, h):
    """A diagonal flat bar from the bottom of s0 to the top of s1 (a thin sloped box)."""
    d = s1 - s0
    length = float(np.hypot(*d))
    rise = h - 0.36
    m = trimesh.creation.box(extents=(math.hypot(length, rise), 0.06, 0.04))
    m.apply_transform(trimesh.transformations.rotation_matrix(math.atan2(rise, length), [0, 0, 1]))
    m.apply_transform(yaw(d[0] / length, d[1] / length))
    mid = (s0 + s1) / 2
    m.apply_translation([mid[0], h / 2, mid[1]])
    return m
