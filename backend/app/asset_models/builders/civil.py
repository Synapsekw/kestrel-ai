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
from shapely.geometry import LineString, Polygon
from shapely.geometry.polygon import orient

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


def stations(pts: np.ndarray, spacing: float, lod: float) -> np.ndarray:
    """Evenly spaced points along a polyline, every vertex included, the closing vertex of a
    closed ring not repeated. Returns (n, 4): x, z, and the unit direction of the segment."""
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
    return np.asarray(out, dtype=float)


def dashes(pts: np.ndarray, dash: float, gap: float, lod: float) -> np.ndarray:
    """Centres and directions (n, 4) of dashes laid along a polyline, restarting per segment."""
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
    return np.asarray(out, dtype=float).reshape(-1, 4)


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
            rows = []
            for side in sides:
                mid_v = side * (lv / 2 - 0.25 - depth / 2)
                for k in range(n + 1):
                    s = -lu / 2 + k * lu / n
                    q = c + u * s + v * mid_v
                    rows.append((q[0], q[1], v[0], v[1]))
            line = unit_box(depth, 0.02, 0.12)
            nodes.append(MeshNode("stalls", "Paving", instanced(line, np.asarray(rows), LIFT["Asphalt"])))
    return record(nodes, p)
