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
from pydantic import BaseModel
from shapely import make_valid
from shapely.geometry import LineString, Polygon
from shapely.geometry.polygon import orient

from app.asset_models.builders.base import BuildCtx, Instanced, MeshNode, Params
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
    polys = [g for g in getattr(geom, "geoms", [geom]) if isinstance(g, Polygon) and g.area > 1e-6]
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
