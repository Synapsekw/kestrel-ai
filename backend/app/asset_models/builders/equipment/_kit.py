"""Equipment geometry kit (unit B2), private to the equipment family.

Item-local frame, metres: Y up from base_el, x = plant north, z = plant east, origin at the
footprint reference point. A bearing is clockwise from plant north, so bearing t points along
(cos t, 0, sin t), as in M1's placement. Everything here is pure and deterministic.
"""

from __future__ import annotations

import math
from collections.abc import Sequence
from dataclasses import dataclass

import numpy as np
import trimesh
from pydantic import BaseModel
from shapely.geometry import Polygon

from app.asset_models.builders import geom
from app.asset_models.builders.base import BuildCtx, Instanced, MeshNode
from app.asset_models.siteframe import footprint_polygon
from app.asset_models.spec import CircleFootprint, Item, RectFootprint

POST_W = 0.06  # handrail post section, m
RAIL_W = 0.05  # rail section, m
RAIL_H = 1.1  # top rail above the deck, m
POST_PITCH = 1.8  # post spacing on straight edges, m
RUNG_PITCH = 0.3  # ladder rung pitch, m
TREAD_RISE = 0.2  # stair riser, m
DECK_T = 0.08  # grating deck thickness, m

Z_TO_Y = trimesh.transformations.rotation_matrix(-math.pi / 2, [1, 0, 0])  # +Z -> +Y
Y_TO_X = trimesh.transformations.rotation_matrix(-math.pi / 2, [0, 0, 1])  # +Y -> +X
_EXTRUDE_UP = trimesh.transformations.rotation_matrix(math.pi / 2, [1, 0, 0])  # plan y -> z, +Z -> -Y

Pt = Sequence[float]


def segs(r: float, ctx: BuildCtx, *, lo: int = 8, hi: int = 128) -> int:
    """Segments around a circle of radius r (m): F0's chord rule, scaled by the LOD, clamped."""
    n = geom.segments_for(max(float(r), 1e-3))
    return int(max(lo, min(hi, round(n * ctx.lod))))


def T(x: float = 0.0, y: float = 0.0, z: float = 0.0) -> np.ndarray:
    m = np.eye(4)
    m[:3, 3] = (x, y, z)
    return m


def S(sx: float = 1.0, sy: float = 1.0, sz: float = 1.0) -> np.ndarray:
    return np.diag([sx, sy, sz, 1.0])


def yaw(bearing_deg: float) -> np.ndarray:
    """Rotation about +Y turning local +x (north) to the bearing, clockwise from north (90 = +z)."""
    a = math.radians(bearing_deg)
    c, s = math.cos(a), math.sin(a)
    m = np.eye(4)
    m[0, 0], m[0, 2], m[2, 0], m[2, 2] = c, -s, s, c
    return m


def placed(mesh: trimesh.Trimesh, M: np.ndarray) -> trimesh.Trimesh:
    out = mesh.copy()
    out.apply_transform(M)  # trimesh flips the winding for a reflection
    return out


def box(
    sx: float, sy: float, sz: float, *, x: float = 0.0, y0: float = 0.0, z: float = 0.0
) -> trimesh.Trimesh:
    """Axis-aligned box: sx along x (north), sy tall, sz along z (east); base at y0, centred on (x, z)."""
    m = trimesh.creation.box(extents=[sx, sy, sz])
    m.apply_translation([x, y0 + sy / 2, z])
    return m


def vcyl(
    r: float,
    h: float,
    ctx: BuildCtx,
    *,
    x: float = 0.0,
    y0: float = 0.0,
    z: float = 0.0,
    n: int | None = None,
) -> trimesh.Trimesh:
    """A closed vertical cylinder standing on y0."""
    m = trimesh.creation.cylinder(radius=r, height=h, sections=n or segs(r, ctx))
    m.apply_transform(Z_TO_Y)
    m.apply_translation([x, y0 + h / 2, z])
    return m


def rod(p0: Pt, p1: Pt, r: float, ctx: BuildCtx, *, n: int | None = None) -> trimesh.Trimesh:
    """A closed cylinder between two points: pipes, arms, shells, risers."""
    return trimesh.creation.cylinder(
        radius=r, segment=[np.asarray(p0, float), np.asarray(p1, float)], sections=n or segs(r, ctx)
    )


def bar(p0: Pt, p1: Pt, w: float, h: float | None = None) -> trimesh.Trimesh:
    """A rectangular member between two points (w across, h deep; square when h is None)."""
    a, b = np.asarray(p0, float), np.asarray(p1, float)
    d = b - a
    length = float(np.linalg.norm(d))
    if length < 1e-6:
        raise ValueError("zero-length member")
    m = trimesh.creation.box(extents=[length, h or w, w])
    m.apply_transform(trimesh.geometry.align_vectors([1.0, 0.0, 0.0], d / length))
    m.apply_translation((a + b) / 2)
    return m


def lathe(
    profile_ry: Sequence[Pt], ctx: BuildCtx, r_for_segs: float | None = None, *, n: int | None = None
) -> trimesh.Trimesh:
    """Revolve a closed (r, y) profile about +Y. The profile is given open; it is closed here."""
    pts = np.asarray(profile_ry, dtype=float)
    if not np.allclose(pts[0], pts[-1]):
        pts = np.vstack([pts, pts[:1]])
    sections = n or segs(r_for_segs if r_for_segs is not None else float(pts[:, 0].max()), ctx)
    m = trimesh.creation.revolve(pts, sections=sections)
    m.apply_transform(Z_TO_Y)
    m.fix_normals()
    return m


def ell_cap(
    r: float, depth: float, ctx: BuildCtx, *, steps: int = 8, n: int | None = None
) -> trimesh.Trimesh:
    """A solid half-ellipsoid: flat face on y = 0, crown at y = depth (2:1 head when depth = r / 2)."""
    ts = np.linspace(0.0, math.pi / 2, steps + 1)
    arc = [(r * math.cos(t), depth * math.sin(t)) for t in ts]
    return lathe([(0.0, 0.0), *arc], ctx, r, n=n)


def slab(pts_xz: Sequence[Pt], y0: float, t: float) -> trimesh.Trimesh:
    """Extrude a plan polygon (x north, z east) from y0 up by t."""
    m = trimesh.creation.extrude_polygon(Polygon([(float(p[0]), float(p[1])) for p in pts_xz]), t)
    m.apply_transform(_EXTRUDE_UP)
    m.apply_translation([0.0, y0 + t, 0.0])
    return m


def inst(mesh: trimesh.Trimesh, xforms) -> Instanced:
    x = np.asarray(xforms, dtype=float).reshape(-1, 4, 4)
    if len(x) == 0:
        raise ValueError("no instances")
    return Instanced(mesh=mesh, transforms=x)


def node(name: str, material: str, *meshes: trimesh.Trimesh) -> MeshNode:
    g = meshes[0] if len(meshes) == 1 else trimesh.util.concatenate(list(meshes))
    return MeshNode(name, material, g)


def turn(nodes: list[MeshNode], M: np.ndarray) -> list[MeshNode]:
    """Apply M to every node: meshes are transformed, instance transforms are left-multiplied."""
    out = []
    for nd in nodes:
        g = nd.geometry
        if isinstance(g, Instanced):
            g = Instanced(mesh=g.mesh, transforms=np.einsum("ij,njk->nik", M, g.transforms))
        else:
            g = placed(g, M)
        out.append(MeshNode(nd.name, nd.material, g, dict(nd.extras)))
    return out


def edge_points(pts: Sequence[Pt], closed: bool, pitch: float) -> list[np.ndarray]:
    """Points along a polyline, at most `pitch` apart, corners included."""
    ring = [np.asarray(p, dtype=float) for p in pts]
    edges = (
        list(zip(ring, ring[1:] + ring[:1], strict=True))
        if closed
        else list(zip(ring[:-1], ring[1:], strict=True))
    )
    out: list[np.ndarray] = []
    for a, b in edges:
        steps = max(1, math.ceil(float(np.linalg.norm(b - a)) / pitch))
        out.extend(a + (b - a) * (i / steps) for i in range(steps))
    if not closed:
        out.append(ring[-1])
    return out


def handrail(
    name: str,
    pts_xz: Sequence[Pt],
    y_deck: float,
    *,
    closed: bool = True,
    material: str = "Handrail",
    pitch: float = POST_PITCH,
) -> list[MeshNode]:
    """Instanced posts plus top and knee rails along a plan polyline at deck level."""
    post = box(POST_W, RAIL_H, POST_W)
    xf = [T(float(p[0]), y_deck, float(p[1])) for p in edge_points(pts_xz, closed, pitch)]
    ring = [np.asarray(p, dtype=float) for p in pts_xz]
    edges = (
        list(zip(ring, ring[1:] + ring[:1], strict=True))
        if closed
        else list(zip(ring[:-1], ring[1:], strict=True))
    )
    rails = [
        bar((a[0], y_deck + hh, a[1]), (b[0], y_deck + hh, b[1]), RAIL_W)
        for a, b in edges
        if float(np.linalg.norm(b - a)) > 1e-6
        for hh in (RAIL_H, RAIL_H / 2)
    ]
    return [
        MeshNode(f"{name}_posts", material, inst(post, xf)),
        MeshNode(f"{name}_rails", material, trimesh.util.concatenate(rails)),
    ]


def ring_handrail(
    name: str,
    r: float,
    y_deck: float,
    ctx: BuildCtx,
    *,
    pitch: float = POST_PITCH,
    toe: bool = False,
    material: str = "Handrail",
) -> list[MeshNode]:
    """A circular handrail of radius r: instanced posts plus revolved rails (and a toe rail)."""
    count = max(8, math.ceil(2 * math.pi * r / pitch))
    angles = np.linspace(0.0, 2 * math.pi, count, endpoint=False)
    xf = [T(r * math.cos(a), y_deck, r * math.sin(a)) for a in angles]
    heights = (RAIL_H - RAIL_W, RAIL_H / 2) + ((0.05,) if toe else ())
    half = RAIL_W / 2
    rails = [
        lathe(
            [
                (r - half, y_deck + y),
                (r + half, y_deck + y),
                (r + half, y_deck + y + RAIL_W),
                (r - half, y_deck + y + RAIL_W),
            ],
            ctx,
            r,
        )
        for y in heights
    ]
    return [
        MeshNode(f"{name}_posts", material, inst(box(POST_W, RAIL_H, POST_W), xf)),
        MeshNode(f"{name}_rails", material, trimesh.util.concatenate(rails)),
    ]


def ladder(
    name: str,
    x: float,
    z: float,
    y0: float,
    y1: float,
    facing_deg: float,
    *,
    material: str = "Steel_Structure",
) -> list[MeshNode]:
    """A vertical ladder at plan (x, z) from y0 to y1. facing_deg is the bearing the climber faces."""
    if y1 - y0 < 0.6:
        return []
    a = math.radians(facing_deg + 90.0)
    ux, uz = math.cos(a) * 0.225, math.sin(a) * 0.225
    stiles = trimesh.util.concatenate(
        [bar((x + s * ux, y0, z + s * uz), (x + s * ux, y1, z + s * uz), 0.06) for s in (-1, 1)]
    )
    nodes = [MeshNode(f"{name}_stiles", material, stiles)]
    ys = np.arange(y0 + RUNG_PITCH, y1 - 0.05, RUNG_PITCH)
    if len(ys):
        rung = bar((-0.225, 0.0, 0.0), (0.225, 0.0, 0.0), 0.03)
        turn_ = yaw(facing_deg + 90.0)
        nodes.append(MeshNode(f"{name}_rungs", material, inst(rung, [T(x, float(y), z) @ turn_ for y in ys])))
    return nodes


def stair_parts(p0: Pt, p1: Pt, width: float) -> tuple[trimesh.Trimesh, trimesh.Trimesh, list[np.ndarray]]:
    """A straight flight from p0 (bottom centre) to p1 (top centre): stringers, tread mesh, tread xforms."""
    a, b = np.asarray(p0, dtype=float), np.asarray(p1, dtype=float)
    run = b - a
    flat = np.array([run[0], 0.0, run[2]])
    reach = float(np.linalg.norm(flat))
    if reach < 1e-6 or run[1] <= 0:
        raise ValueError("a stair flight needs rise and run")
    u = flat / reach
    side = np.array([-u[2], 0.0, u[0]]) * (width / 2)
    stringers = trimesh.util.concatenate([bar(a + s * side, b + s * side, 0.08, 0.25) for s in (-1, 1)])
    steps = max(2, math.ceil(run[1] / TREAD_RISE))
    turn_ = yaw(math.degrees(math.atan2(u[2], u[0])))
    xforms = [T(*(a + run * (i / steps))) @ turn_ for i in range(1, steps)]
    return stringers, box(0.25, 0.04, width), xforms


def stair(name: str, p0: Pt, p1: Pt, width: float) -> list[MeshNode]:
    stringers, tread, xforms = stair_parts(p0, p1, width)
    return [
        MeshNode(f"{name}_stringers", "Steel_Structure", stringers),
        MeshNode(f"{name}_treads", "Grating", inst(tread, xforms)),
    ]


def lattice(
    base_w: float, top_w: float, y0: float, y1: float, bay: float, leg_w: float, brace_w: float
) -> list[trimesh.Trimesh]:
    """A square tapering lattice tower: legs, X bracing on every face and a ring at every bay level."""
    nb = max(1, math.ceil((y1 - y0) / bay))
    ys = [y0 + (y1 - y0) * i / nb for i in range(nb + 1)]
    corners = ((1, 1), (1, -1), (-1, -1), (-1, 1))

    def pt(c, y):
        half = (base_w + (top_w - base_w) * (y - y0) / (y1 - y0)) / 2
        return (c[0] * half, y, c[1] * half)

    out = []
    for i in range(nb):
        lo, hi = ys[i], ys[i + 1]
        for j, c in enumerate(corners):
            c2 = corners[(j + 1) % 4]
            out += [
                bar(pt(c, lo), pt(c, hi), leg_w),
                bar(pt(c, lo), pt(c2, hi), brace_w),
                bar(pt(c2, lo), pt(c, hi), brace_w),
                bar(pt(c, hi), pt(c2, hi), brace_w),
            ]
    return out


@dataclass(frozen=True)
class Plan:
    """An item's plan envelope in item-local metres: centre, sizes, long-axis bearing."""

    cx: float
    cz: float
    along: float
    across: float
    bearing_deg: float
    is_round: bool

    def place(self) -> np.ndarray:
        """Plan frame (centre at origin, along = +x) -> item-local."""
        return T(self.cx, 0.0, self.cz) @ yaw(self.bearing_deg)


def plan_of(item: Item, ctx: BuildCtx) -> Plan:
    fp = item.footprint
    if isinstance(fp, CircleFootprint):
        return Plan(0.0, 0.0, float(fp.d), float(fp.d), 0.0, True)
    if isinstance(fp, RectFootprint):
        return Plan(0.0, 0.0, float(fp.size[0]), float(fp.size[1]), float(fp.rot_deg) % 360.0, False)
    ring = np.asarray(footprint_polygon(fp), dtype=float)
    loc = np.asarray(ctx.local(item, ring[:, 0], ring[:, 1]), dtype=float).reshape(-1, 2)
    rect = Polygon(loc).minimum_rotated_rectangle
    c = np.asarray(rect.exterior.coords)[:4]
    e0, e1 = c[1] - c[0], c[2] - c[1]
    a, b = (e0, e1) if np.linalg.norm(e0) >= np.linalg.norm(e1) else (e1, e0)
    centre = c.mean(axis=0)
    bearing = math.degrees(math.atan2(a[1], a[0])) % 180.0
    return Plan(
        float(centre[0]), float(centre[1]), float(np.linalg.norm(a)), float(np.linalg.norm(b)), bearing, False
    )


def height(item: Item, ctx: BuildCtx, default_m: float) -> tuple[float, bool]:
    """Usable height H = top_el - base_el, and whether it was defaulted. Raises when there is none.

    F0's ctx.height never raises (a top_el not above the base silently becomes base + default), so an
    explicit top_el at or below base + 0.05 m is refused here instead of being hidden by the default.
    """
    base, top, defaulted = ctx.height(item, default_m)
    if item.top_el is not None and float(item.top_el) - float(base) <= 0.05:
        raise ValueError("item has no usable height")
    h = float(top) - float(base)
    if not math.isfinite(h) or h <= 0.05:
        raise ValueError("item has no usable height")
    return h, bool(defaulted)


def params(item: Item, model: type[BaseModel]):
    return model.model_validate(item.params)


def finish(nodes: list[MeshNode], item: Item, p: BaseModel, derived: dict) -> list[MeshNode]:
    """Record the defaulted params and the derived values on the first node (A1 writes them to notes)."""
    if not nodes:
        raise ValueError("builder produced no geometry")
    given = set(item.params)
    nodes[0].extras["defaults"] = sorted(f for f in type(p).model_fields if f not in given)
    nodes[0].extras["derived"] = {
        key: (round(float(v), 3) if isinstance(v, int | float) and not isinstance(v, bool) else v)
        for key, v in sorted(derived.items())
    }
    return nodes
