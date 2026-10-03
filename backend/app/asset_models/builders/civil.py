"""Civil builders (plant model spec 2026-10-03 §6, unit B3) and the B3 footprint helpers.

Item-local frame: metres, Y up from base_el, x = plant north, z = plant east, origin at the
footprint reference point. A 2D outline here is a shapely Polygon in (x, z). Flat items (road,
paved, laydown, parking, revetment) are thin slabs whose top sits a few centimetres above base_el;
each type has its own lift so overlapping surfaces never z-fight. Pure and deterministic.
"""

from __future__ import annotations

import math

import numpy as np
import trimesh
from pydantic import BaseModel, Field
from shapely import make_valid
from shapely.geometry import LineString, Point, Polygon
from shapely.geometry.polygon import orient
from shapely.prepared import prep

from app.asset_models.builders.base import BuildCtx, Instanced, MeshNode, Params, builder
from app.asset_models.siteframe import footprint_polygon
from app.asset_models.spec import Item

MAX_INSTANCES = 5000  # per node; spacing grows past this so one long fence can't explode the GLB
MIN_SEG_M = 1e-3  # consecutive points closer than this are one point
_Y_UP = trimesh.transformations.rotation_matrix(math.pi / 2, [1, 0, 0])  # (x, y, z) -> (x, -z, y)

# top-of-surface lift above base_el and slab thickness, per flat material (metres)
LIFT = {"Asphalt": 0.15, "Paving": 0.12, "Laydown": 0.10, "Rock_Armour": 0.06, "Slope": 0.08}
SLAB_T = 0.4


class B3Params(Params):
    """The base of the B3 params models (F0's Params: unknown keys and NaN are errors)."""


# ------------------------------------------------------------------ footprint helpers
def clean_line(pts: np.ndarray) -> np.ndarray:
    """Drop consecutive points closer than MIN_SEG_M; (k, 2) in, (j, 2) out."""
    pts = np.asarray(pts, dtype=float).reshape(-1, 2)
    if not np.isfinite(pts).all():
        raise ValueError("footprint has a non-finite coordinate")
    keep = [0]
    for i in range(1, len(pts)):
        if np.hypot(*(pts[i] - pts[keep[-1]])) > MIN_SEG_M:
            keep.append(i)
    return pts[keep]


def is_closed(pts: np.ndarray) -> bool:
    return len(pts) > 2 and float(np.hypot(*(pts[0] - pts[-1]))) <= MIN_SEG_M


def largest_polygon(geom) -> Polygon:
    """The biggest polygon of a (possibly invalid) geometry, exterior counter-clockwise in (x, z)."""
    if not geom.is_valid:
        geom = make_valid(geom)
    polys, todo = [], [geom]
    while todo:  # make_valid can nest: GeometryCollection[MultiPolygon, LineString, ...]
        g = todo.pop()
        if isinstance(g, Polygon):
            if g.area > 1e-6:
                polys.append(g)
        else:
            todo.extend(getattr(g, "geoms", []))
    if not polys:
        raise ValueError("footprint has no area")
    best = max(polys, key=lambda p: (p.area, p.bounds))
    return orient(best, sign=1.0)


def local_line(item: Item, ctx: BuildCtx) -> np.ndarray:
    """A line footprint's points in item-local (x, z), duplicates removed."""
    fp = item.footprint
    pts = np.asarray(fp.pts, dtype=float)
    loc = np.asarray(ctx.local(item, pts[:, 0], pts[:, 1]), dtype=float).reshape(-1, 2)
    loc = clean_line(loc)
    if len(loc) < 2:
        raise ValueError("line footprint has no length")
    return loc


def outline(item: Item, ctx: BuildCtx) -> Polygon:
    """The item's plan outline in item-local (x, z). A line is buffered by its width (flat ends)."""
    fp = item.footprint
    if fp.kind == "line":
        line = LineString(local_line(item, ctx))
        return largest_polygon(
            line.buffer(fp.width / 2, cap_style="flat", join_style="mitre", mitre_limit=2.0)
        )
    ring = np.asarray(footprint_polygon(fp), dtype=float)
    loc = clean_line(np.asarray(ctx.local(item, ring[:, 0], ring[:, 1]), dtype=float).reshape(-1, 2))
    if len(loc) < 3:
        raise ValueError("footprint has fewer than 3 distinct points")
    return largest_polygon(Polygon(loc))


# ------------------------------------------------------------------ mesh helpers
def prism(poly: Polygon, y0: float, y1: float) -> trimesh.Trimesh:
    """A closed prism of the outline from y0 to y1 (y1 > y0); outward normals."""
    if not y1 > y0:
        raise ValueError("prism needs y1 > y0")
    m = trimesh.creation.extrude_polygon(poly, y1 - y0, engine="earcut")
    m.apply_transform(_Y_UP)
    m.apply_translation([0.0, y1, 0.0])
    return m


def surface(poly: Polygon, y: float) -> trimesh.Trimesh:
    """A single-sided, up-facing cap of the outline at height y (earcut; concave-safe)."""
    v2, f = trimesh.creation.triangulate_polygon(poly, engine="earcut")
    v = np.column_stack([v2[:, 0], np.full(len(v2), y), v2[:, 1]])
    m = trimesh.Trimesh(v, f, process=False)
    flip = m.face_normals[:, 1] < 0
    if flip.any():
        faces = m.faces.copy()
        faces[flip] = faces[flip][:, ::-1]
        m = trimesh.Trimesh(v, faces, process=False)
    return m


def flat_slab(poly: Polygon, material: str) -> trimesh.Trimesh:
    top = LIFT[material]
    return prism(poly, top - SLAB_T, top)


def yaw(dx: float, dz: float) -> np.ndarray:
    """4x4 rotation about +Y that turns local +x onto the plan direction (dx, dz)."""
    return trimesh.transformations.rotation_matrix(math.atan2(-dz, dx), [0, 1, 0])


def bar(p0, p1, y0: float, y1: float, t: float) -> trimesh.Trimesh:
    """A box over the plan segment p0 -> p1 (x, z), t thick across it, from y0 to y1."""
    p0, p1 = np.asarray(p0, dtype=float), np.asarray(p1, dtype=float)
    d = p1 - p0
    length = float(np.hypot(*d))
    if length <= MIN_SEG_M:
        raise ValueError("bar has no length")
    m = trimesh.creation.box(extents=(length, y1 - y0, t))
    m.apply_transform(yaw(d[0] / length, d[1] / length))
    mid = (p0 + p1) / 2
    m.apply_translation([mid[0], (y0 + y1) / 2, mid[1]])
    return m


def unit_box(w: float, h: float, d: float) -> trimesh.Trimesh:
    """A w (x) by h (y) by d (z) box with its base centred on the origin."""
    m = trimesh.creation.box(extents=(w, h, d))
    m.apply_translation([0.0, h / 2, 0.0])
    return m


def xform(x: float, y: float, z: float, dx: float = 1.0, dz: float = 0.0) -> np.ndarray:
    t = yaw(dx, dz)
    t[:3, 3] = (x, y, z)
    return t


def thin(rows, cap: int = MAX_INSTANCES) -> np.ndarray:
    """At most `cap` rows of (n, 4), picked evenly with the first and last kept; deterministic."""
    arr = np.asarray(rows, dtype=float).reshape(-1, 4)
    if len(arr) > cap:
        arr = arr[np.unique(np.linspace(0, len(arr) - 1, cap).round().astype(int))]
    return arr


def stations(pts: np.ndarray, spacing: float, lod: float) -> np.ndarray:
    """Evenly spaced points along a polyline, every vertex included, the closing vertex of a
    closed ring not repeated. Returns (n, 4): x, z, and the unit direction of the segment.
    Never more than MAX_INSTANCES rows: past the cap the rows are thinned evenly (both ends kept,
    so a many-vertex line can lose vertex stations)."""
    pts = clean_line(pts)
    closed = is_closed(pts)
    seglen = np.hypot(*np.diff(pts, axis=0).T)
    step = max(spacing / max(lod, 1e-3), seglen.sum() / MAX_INSTANCES)
    out = []
    for (a, b), length in zip(zip(pts[:-1], pts[1:], strict=True), seglen, strict=True):
        n = max(1, math.ceil(length / step - 1e-9))
        d = (b - a) / length
        for k in range(n):
            p = a + (b - a) * (k / n)
            out.append((p[0], p[1], d[0], d[1]))
    if not closed:
        d = (pts[-1] - pts[-2]) / seglen[-1]
        out.append((pts[-1][0], pts[-1][1], d[0], d[1]))
    return thin(out)


def dashes(pts: np.ndarray, dash: float, gap: float, lod: float) -> np.ndarray:
    """Centres and directions (n, 4) of dashes laid along a polyline, restarting per segment;
    at most MAX_INSTANCES rows (thinned evenly past the cap)."""
    out = []
    pitch = (dash + gap) / max(lod, 1e-3)
    pts = clean_line(pts)
    total = float(np.hypot(*np.diff(pts, axis=0).T).sum())
    pitch = max(pitch, total / MAX_INSTANCES)
    for a, b in zip(pts[:-1], pts[1:], strict=True):
        length = float(np.hypot(*(b - a)))
        if length < dash:
            continue
        d = (b - a) / length
        s = dash / 2
        while s <= length - dash / 2 + 1e-9:
            p = a + d * s
            out.append((p[0], p[1], d[0], d[1]))
            s += pitch
    return thin(out)


def instanced(mesh: trimesh.Trimesh, rows: np.ndarray, y: float = 0.0) -> Instanced:
    xf = np.stack([xform(r[0], y, r[1], r[2], r[3]) for r in rows]) if len(rows) else np.zeros((0, 4, 4))
    return Instanced(mesh=mesh, transforms=xf)


def merge(meshes: list[trimesh.Trimesh]) -> trimesh.Trimesh:
    return trimesh.util.concatenate([m for m in meshes if m is not None and len(m.faces)])


def defaults_of(p: BaseModel, height_defaulted: bool = False) -> list[str]:
    names = sorted(set(type(p).model_fields) - p.model_fields_set)
    return [*names, "height"] if height_defaulted else names


def record(nodes: list[MeshNode], p: BaseModel, height_defaulted: bool = False) -> list[MeshNode]:
    """Put the defaulted param names (and "height") on the first node's extras for A1's CSV notes."""
    if nodes:
        nodes[0].extras["defaults"] = defaults_of(p, height_defaulted)
    return nodes


# ------------------------------------------------------------------ flat surfaces
class RoadParams(B3Params):
    markings: bool = False
    dash_m: float = Field(3.0, gt=0, le=50)
    gap_m: float = Field(6.0, gt=0, le=50)


class SurfaceParams(B3Params):
    pass


class ParkingParams(B3Params):
    markings: bool = True
    stall_w: float = Field(2.5, gt=0.5, le=10)
    stall_d: float = Field(5.0, gt=1, le=20)


@builder(
    "road",
    family="civil",
    params=RoadParams,
    default_height_m=SLAB_T,  # flat: height is ignored; F0 refuses a non-positive default
    doc="Road: a line footprint (centreline + width) as an asphalt slab; optional centre dashes.",
)
def build_road(item: Item, ctx: BuildCtx) -> list[MeshNode]:
    p = RoadParams.model_validate(item.params)
    nodes = [MeshNode("surface", "Asphalt", flat_slab(outline(item, ctx), "Asphalt"))]
    if p.markings and item.footprint.kind == "line":
        rows = dashes(local_line(item, ctx), p.dash_m, p.gap_m, ctx.lod)
        if len(rows):
            dash = unit_box(p.dash_m, 0.02, 0.15)
            nodes.append(MeshNode("markings", "Paving", instanced(dash, rows, LIFT["Asphalt"])))
    return record(nodes, p)


def _flat(material: str):
    def fn(item: Item, ctx: BuildCtx) -> list[MeshNode]:
        p = SurfaceParams.model_validate(item.params)
        return record([MeshNode("surface", material, flat_slab(outline(item, ctx), material))], p)

    return fn


builder(
    "paved",
    family="civil",
    params=SurfaceParams,
    default_height_m=SLAB_T,
    doc="Paved area: the footprint as a concrete paving slab.",
)(_flat("Paving"))
builder(
    "laydown",
    family="civil",
    params=SurfaceParams,
    default_height_m=SLAB_T,
    doc="Laydown or graded pad: the footprint as a gravel slab.",
)(_flat("Laydown"))
builder(
    "revetment",
    family="civil",
    params=SurfaceParams,
    default_height_m=SLAB_T,
    doc="Revetment or rock armour band: the footprint as a rock-armour slab.",
)(_flat("Rock_Armour"))


def axes(poly: Polygon):
    """Centre, long unit axis, short unit axis, long length, short length of the min rotated rect."""
    rect = np.asarray(poly.minimum_rotated_rectangle.exterior.coords)[:4]
    e0, e1 = rect[1] - rect[0], rect[2] - rect[1]
    l0, l1 = float(np.hypot(*e0)), float(np.hypot(*e1))
    if l0 >= l1:
        u, lu, v, lv = e0 / l0, l0, e1 / l1, l1
    else:
        u, lu, v, lv = e1 / l1, l1, e0 / l0, l0
    if u[0] < 0 or (abs(u[0]) < 1e-9 and u[1] < 0):  # canonical sign: deterministic across inputs
        u = -u
    v = np.array([-u[1], u[0]])
    return rect.mean(axis=0), u, v, lu, lv


@builder(
    "parking",
    family="civil",
    params=ParkingParams,
    default_height_m=SLAB_T,
    doc="Parking: an asphalt slab with stall lines along its long side (two rows when deep).",
)
def build_parking(item: Item, ctx: BuildCtx) -> list[MeshNode]:
    p = ParkingParams.model_validate(item.params)
    poly = outline(item, ctx)
    nodes = [MeshNode("surface", "Asphalt", flat_slab(poly, "Asphalt"))]
    if p.markings:
        c, u, v, lu, lv = axes(poly)
        depth = min(p.stall_d, lv - 0.5)
        if depth > 0.5:
            sides = [-1, 1] if lv >= 2 * p.stall_d + 6.0 else [-1]
            n = max(1, math.floor(lu * ctx.lod / p.stall_w))
            n = max(1, min(n, MAX_INSTANCES // len(sides) - 1))  # (n + 1) per row stays under the cap
            inside = prep(poly.buffer(0.05))  # a few cm so stalls on the edge of a plain rect stay
            rows = []
            for side in sides:
                mid_v = side * (lv / 2 - 0.25 - depth / 2)
                for k in range(n + 1):
                    s = -lu / 2 + k * lu / n
                    q = c + u * s + v * mid_v
                    if inside.contains(Point(q[0], q[1])):  # concave lot: no stalls in the notch
                        rows.append((q[0], q[1], v[0], v[1]))
            if rows:
                line = unit_box(depth, 0.02, 0.12)
                nodes.append(MeshNode("stalls", "Paving", instanced(line, np.asarray(rows), LIFT["Asphalt"])))
    return record(nodes, p)


# ------------------------------------------------------------------ walls and fences
class WallParams(B3Params):
    coping: bool = True


class FenceParams(B3Params):
    post_spacing: float = Field(3.0, gt=0.5, le=20)
    post: float = Field(0.08, gt=0.01, le=1)


@builder(
    "wall",
    family="civil",
    params=WallParams,
    default_height_m=3.0,
    doc="Wall: a line footprint (width = thickness) extruded to height, with a coping.",
)
def build_wall(item: Item, ctx: BuildCtx) -> list[MeshNode]:
    p = WallParams.model_validate(item.params)
    base, top, defaulted = ctx.height(item, 3.0)
    h = top - base
    if not h > 0:
        raise ValueError("wall needs a height")
    poly = outline(item, ctx)
    cop = min(0.1, h / 10) if p.coping else 0.0
    nodes = [MeshNode("wall", "Concrete", prism(poly, 0.0, h - cop))]
    if cop:
        cap = largest_polygon(poly.buffer(0.05, join_style="mitre", mitre_limit=2.0))
        nodes.append(MeshNode("coping", "Concrete_Dark", prism(cap, h - cop, h)))
    return record(nodes, p, defaulted)


def fence_like(pts: np.ndarray, h: float, p: FenceParams, lod: float) -> list[MeshNode]:
    rows = stations(pts, p.post_spacing, lod)  # capped at MAX_INSTANCES
    post = unit_box(p.post, h, p.post)
    panels, rails = [], []
    for a, b in zip(pts[:-1], pts[1:], strict=True):
        if np.hypot(*(b - a)) <= MIN_SEG_M:
            continue
        panels.append(bar(a, b, 0.05, h - 0.05, 0.02))
        rails.append(bar(a, b, h - 0.06, h - 0.01, 0.05))
    return [
        MeshNode("posts", "Steel_Dark", instanced(post, rows)),
        MeshNode("rails", "Steel_Dark", merge(rails)),
        MeshNode("mesh", "Fence", merge(panels)),
    ]


@builder(
    "fence",
    family="civil",
    params=FenceParams,
    default_height_m=2.5,
    doc="Fence: posts (instanced) at post_spacing along a line footprint, mesh panels, top rail.",
)
def build_fence(item: Item, ctx: BuildCtx) -> list[MeshNode]:
    p = FenceParams.model_validate(item.params)
    base, top, defaulted = ctx.height(item, 2.5)
    h = top - base
    if not h > 0.2:
        raise ValueError("fence needs a height above 0.2 m")
    if item.footprint.kind == "line":
        pts = local_line(item, ctx)
    else:
        pts = np.asarray(outline(item, ctx).exterior.coords)  # closed ring: first point repeated last
    return record(fence_like(pts, h, p, ctx.lod), p, defaulted)


# ------------------------------------------------------------------ trenches, channels, basins
class TrenchParams(B3Params):
    wall_t: float = Field(0.15, gt=0.02, le=2)
    floor_t: float = Field(0.15, gt=0.02, le=2)
    covered: bool = False


class ChannelParams(B3Params):
    wall_t: float = Field(0.25, gt=0.02, le=2)
    floor_t: float = Field(0.25, gt=0.02, le=2)
    water: float = Field(0.5, ge=0, le=1)  # water surface as a fraction of the depth


class BasinParams(B3Params):
    wall_t: float = Field(0.3, gt=0.02, le=2)
    floor_t: float = Field(0.3, gt=0.02, le=2)
    kerb_h: float = Field(0.3, ge=0, le=2)
    freeboard: float = Field(0.6, ge=0, le=10)


def open_box(poly: Polygon, h: float, wall_t: float, floor_t: float, wall_mat: str):
    """Walls (outline minus its inset) from 0 to h and a floor slab; returns (nodes, inner)."""
    inner = poly.buffer(-wall_t, join_style="mitre", mitre_limit=2.0)
    if inner.is_empty or inner.area < 1e-3:
        return [MeshNode("body", wall_mat, prism(poly, 0.0, h))], None
    inner = largest_polygon(inner)
    ring = poly.difference(inner)
    walls = [
        prism(g, 0.0, h) for g in getattr(ring, "geoms", [ring]) if isinstance(g, Polygon) and g.area > 1e-6
    ]
    nodes = [
        MeshNode("walls", wall_mat, merge(walls)),
        MeshNode("floor", wall_mat, prism(inner, 0.0, floor_top(h, floor_t))),
    ]
    return nodes, inner


def floor_top(h: float, floor_t: float) -> float:
    """The top of open_box's floor slab for walls of height h."""
    return min(floor_t, h / 2)


WATER_CLEAR = 0.02  # a water surface keeps this far off the floor top and below the wall tops


def water(inner: Polygon, y: float, h: float, floor_t: float) -> list[MeshNode]:
    """The water surface at y, clamped into (floor top, wall top h) with WATER_CLEAR either side
    so it never z-fights the floor or rises over the walls; none when that band is empty."""
    lo, hi = floor_top(h, floor_t) + WATER_CLEAR, h - WATER_CLEAR
    if lo > hi:
        return []
    return [MeshNode("water", "Water_Pit", surface(inner, min(max(y, lo), hi)))]


def _depth(item: Item, ctx: BuildCtx, default: float) -> tuple[float, bool]:
    base, top, defaulted = ctx.height(item, default)
    if not top - base > 0:
        raise ValueError("needs a depth (top_el above base_el)")
    return top - base, defaulted


@builder(
    "trench",
    family="civil",
    params=TrenchParams,
    default_height_m=1.0,
    doc="Trench or ditch: an open concrete U along a line (base_el = invert), optional grating.",
)
def build_trench(item: Item, ctx: BuildCtx) -> list[MeshNode]:
    p = TrenchParams.model_validate(item.params)
    h, defaulted = _depth(item, ctx, 1.0)
    nodes, inner = open_box(outline(item, ctx), h, p.wall_t, p.floor_t, "Concrete_Dark")
    if p.covered and inner is not None:
        nodes.append(MeshNode("cover", "Grating", prism(inner, h - 0.05, h)))
    return record(nodes, p, defaulted)


@builder(
    "channel",
    family="civil",
    params=ChannelParams,
    default_height_m=2.0,
    doc="Open water channel or culvert: a concrete U with a water surface at a fraction of depth.",
)
def build_channel(item: Item, ctx: BuildCtx) -> list[MeshNode]:
    p = ChannelParams.model_validate(item.params)
    h, defaulted = _depth(item, ctx, 2.0)
    nodes, inner = open_box(outline(item, ctx), h, p.wall_t, p.floor_t, "Concrete")
    if inner is not None and p.water > 0:
        nodes += water(inner, h * p.water, h, p.floor_t)
    return record(nodes, p, defaulted)


@builder(
    "basin",
    family="civil",
    params=BasinParams,
    default_height_m=3.0,
    doc="Basin or pit: concrete walls with a kerb above grade, floor, and water below freeboard.",
)
def build_basin(item: Item, ctx: BuildCtx) -> list[MeshNode]:
    p = BasinParams.model_validate(item.params)
    h, defaulted = _depth(item, ctx, 3.0)
    nodes, inner = open_box(outline(item, ctx), h + p.kerb_h, p.wall_t, p.floor_t, "Concrete")
    if inner is not None:
        nodes += water(inner, h - p.freeboard, h + p.kerb_h, p.floor_t)
    return record(nodes, p, defaulted)
