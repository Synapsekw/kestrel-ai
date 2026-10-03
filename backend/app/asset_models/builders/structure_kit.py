"""Shared pieces for the structure builders (B1): footprint frames, members, handrails, pipes.

Item-local frame (index "Binding interfaces"): metres, Y up from base_el, x = plant north,
z = plant east, origin at footprint_ref. 2-D points here are local [x, z]. Every geom call the
structure family makes goes through this module, so a change in F0's helpers is fixed here once.
"""

from __future__ import annotations

import math
from dataclasses import dataclass

import numpy as np
import trimesh
from scipy.spatial import cKDTree
from shapely.geometry import Point, Polygon
from shapely.geometry.polygon import orient

from app.asset_models.builders import geom
from app.asset_models.builders.base import BuildCtx, Instanced, MeshNode
from app.asset_models.siteframe import footprint_polygon
from app.asset_models.spec import Item

UP = np.array([0.0, 1.0, 0.0])
MIN_SEG = 8


@dataclass(frozen=True)
class Run:
    """A straight stretch of a linear structure: centreline p0 -> p1 (local [x, z]) and its width."""

    p0: np.ndarray
    p1: np.ndarray
    width: float

    @property
    def length(self) -> float:
        return float(np.linalg.norm(self.p1 - self.p0))

    @property
    def u(self) -> np.ndarray:  # unit along
        return (self.p1 - self.p0) / max(self.length, 1e-9)

    @property
    def v(self) -> np.ndarray:  # unit across; +v is the right-hand side walking p0 -> p1
        return np.array([-self.u[1], self.u[0]])

    def at(self, t: float, s: float = 0.0) -> np.ndarray:
        """Local [x, z] at distance t along and s across (+ = right)."""
        return self.p0 + self.u * t + self.v * s


def segs(r: float, ctx: BuildCtx) -> int:
    return max(MIN_SEG, round(geom.segments_for(r) * ctx.lod))


def local_pts(item: Item, ctx: BuildCtx, pts) -> np.ndarray:
    """Plant [E, N] points (k, 2) -> item-local [x, z] (k, 2), through F0's BuildCtx.local."""
    pts = np.asarray(pts, dtype=float)
    return np.asarray(ctx.local(item, pts[:, 0], pts[:, 1]), dtype=float)


def outline(item: Item, ctx: BuildCtx) -> np.ndarray:
    """The footprint as a counter-clockwise local [x, z] ring (k, 2), not closed."""
    ring = np.asarray(footprint_polygon(item.footprint), dtype=float)
    if ring.ndim != 2 or len(ring) < 3:
        raise ValueError("footprint has no area")
    poly = Polygon(local_pts(item, ctx, ring))
    if not poly.is_valid or poly.area < 1e-4:
        raise ValueError("footprint is not a simple polygon with area")
    poly = orient(poly, sign=1.0)
    return np.asarray(poly.exterior.coords, dtype=float)[:-1]


def runs(item: Item, ctx: BuildCtx) -> list[Run]:
    """Linear stretches: each segment of a line footprint; one run along the long axis otherwise.

    rect: along its longer side (size[0] at rot_deg when that is the longer one).
    polygon/circle: along the long side of the minimum rotated rectangle, through its centre.
    """
    fp = item.footprint
    if fp.kind == "line":
        loc = local_pts(item, ctx, fp.pts)
        out = [Run(loc[k], loc[k + 1], float(fp.width)) for k in range(len(loc) - 1)]
        out = [r for r in out if r.length > 0.01]
        if not out:
            raise ValueError("line footprint has no length")
        return out
    if fp.kind == "rect":
        along_m, across_m = float(fp.size[0]), float(fp.size[1])
        t = math.radians(fp.rot_deg)
        if across_m > along_m:  # ruling R4: a linear run follows the rect's longer side
            along_m, across_m, t = across_m, along_m, t + math.pi / 2
        u_plant = np.array([math.sin(t), math.cos(t)])  # [E, N] of the along axis
        c = np.asarray(fp.center, dtype=float)
        ends = np.array([c - along_m / 2 * u_plant, c + along_m / 2 * u_plant])
        loc = local_pts(item, ctx, ends)
        return [Run(loc[0], loc[1], across_m)]
    return [rect_run(outline(item, ctx))]


def rect_run(ring: np.ndarray) -> Run:
    """The minimum rotated rectangle of a ring as a run along its long side."""
    rect = np.asarray(Polygon(ring).minimum_rotated_rectangle.exterior.coords, dtype=float)[:4]
    e0, e1 = rect[1] - rect[0], rect[2] - rect[1]
    if np.linalg.norm(e1) > np.linalg.norm(e0):
        rect = np.roll(rect, -1, axis=0)
        e0, e1 = e1, rect[2] - rect[1]
    width = float(np.linalg.norm(e1))
    mid0 = (rect[0] + rect[3]) / 2
    mid1 = (rect[1] + rect[2]) / 2
    return Run(mid0, mid1, width)


def stations(length: float, spacing: float, inset: float = 0.0) -> np.ndarray:
    """Evenly spaced positions from inset to length - inset, gaps never above spacing (>= 2 points)."""
    span = max(length - 2 * inset, 0.0)
    n = max(2, math.ceil(span / spacing - 1e-9) + 1)
    return np.linspace(inset, inset + span, n)


def dedupe_index(pts: np.ndarray, tol: float) -> list[int]:
    """Indices of the points kept, in order, when a point within tol of a kept one is dropped."""
    pts = np.asarray(pts, dtype=float)
    if len(pts) == 0:
        return []
    tree = cKDTree(pts)
    dropped = np.zeros(len(pts), dtype=bool)
    kept: list[int] = []
    for i in range(len(pts)):
        if dropped[i]:
            continue
        kept.append(i)
        for j in tree.query_ball_point(pts[i], tol - 1e-12):
            if j > i:
                dropped[j] = True
    return kept


def dedupe(pts: np.ndarray, tol: float) -> np.ndarray:
    return np.asarray(pts)[dedupe_index(np.asarray(pts), tol)]


def xz(p2: np.ndarray, y: float) -> np.ndarray:
    return np.array([p2[0], y, p2[1]], dtype=float)


def translate(points3: np.ndarray) -> np.ndarray:
    """(N, 4, 4) pure translations."""
    pts = np.atleast_2d(np.asarray(points3, dtype=float))
    out = np.tile(np.eye(4), (len(pts), 1, 1))
    out[:, :3, 3] = pts
    return out


def along(p0: np.ndarray, p1: np.ndarray) -> np.ndarray:
    """4x4 that takes a unit-length mesh along +Y from the origin onto p0 -> p1 (scale on Y only)."""
    d = np.asarray(p1, float) - np.asarray(p0, float)
    length = float(np.linalg.norm(d))
    rot = trimesh.geometry.align_vectors(UP, d / length)
    scale = np.diag([1.0, length, 1.0, 1.0])
    m = rot @ scale
    m[:3, 3] = p0
    return m


def uncap(m: trimesh.Trimesh, axis: np.ndarray) -> trimesh.Trimesh:
    """Drop the faces facing along axis (end caps nobody sees): 12 -> 8 triangles for a member."""
    a = np.asarray(axis, dtype=float)
    a = a / np.linalg.norm(a)
    keep = np.abs(m.face_normals @ a) < 0.99
    out = m.copy()
    out.update_faces(keep)
    out.remove_unreferenced_vertices()
    return out


def member(p0, p1, w: float, h: float | None = None) -> trimesh.Trimesh:
    """A rectangular member p0 -> p1 without end caps (8 triangles).

    w is the width across, level (horizontal, square to the member in plan); h is the depth in the
    vertical plane through the member. A vertical member is square to plant north (local x).
    """
    p0, p1 = np.asarray(p0, float), np.asarray(p1, float)
    d = p1 - p0
    e1 = d / np.linalg.norm(d)
    side = np.cross(UP, e1)
    ew = side / np.linalg.norm(side) if np.linalg.norm(side) > 1e-9 else np.array([1.0, 0.0, 0.0])
    eh = np.cross(e1, ew)
    hh = w if h is None else h
    corners = [(-1, -1), (1, -1), (1, 1), (-1, 1)]
    verts = np.array([p + ew * (cx * w / 2) + eh * (cz * hh / 2) for p in (p0, p1) for cx, cz in corners])
    faces = []
    for j in range(4):
        a, b = j, (j + 1) % 4
        faces += [[a, b, 4 + b], [a, 4 + b, 4 + a]]
    m = trimesh.Trimesh(verts, np.array(faces), process=False)
    mid = (p0 + p1) / 2
    out = np.einsum("ij,ij->i", m.face_normals, m.triangles_center - mid) < 0  # point every face outward
    f = m.faces.copy()
    f[out] = f[out][:, ::-1]
    return trimesh.Trimesh(verts, f, process=False)


def pile_mesh(r: float, h: float, ctx: BuildCtx) -> trimesh.Trimesh:
    """An uncapped vertical cylinder, base at the origin (the cap sits under a deck)."""
    return uncap(geom.cyl(r, h, segs(r, ctx)), UP)


def column_mesh(h: float, w: float) -> trimesh.Trimesh:
    """A square column, base at the origin, top at y = h."""
    return member((0.0, 0.0, 0.0), (0.0, h, 0.0), w)


def merge(meshes: list[trimesh.Trimesh]) -> trimesh.Trimesh:
    return trimesh.util.concatenate([m for m in meshes if m is not None and len(m.faces)])


def slab(ring: np.ndarray, y0: float, y1: float) -> trimesh.Trimesh:
    m = geom.extrude(ring, y1 - y0)
    m.apply_translation((0.0, y0, 0.0))
    return m


def tube(r: float, seg: int) -> trimesh.Trimesh:
    """Open unit-length cylinder along +Y from the origin (2*seg triangles); pipes."""
    k = np.arange(seg) * (2 * math.pi / seg)
    ring = np.c_[r * np.cos(k), np.zeros(seg), r * np.sin(k)]
    verts = np.vstack([ring, ring + UP])
    faces = []
    for i in range(seg):
        j = (i + 1) % seg
        faces += [[i, seg + j, j], [i, seg + i, seg + j]]
    m = trimesh.Trimesh(verts, np.array(faces), process=False)
    m.fix_normals()
    return m


def handrail(path: np.ndarray, y: float, *, height: float, spacing: float, closed: bool, lod: float):
    """Posts (instanced) and top + knee rails along a local [x, z] polyline at deck level y."""
    pts = np.asarray(path, dtype=float)
    if closed:
        pts = np.vstack([pts, pts[:1]])
    post_xy: list[np.ndarray] = []
    rails: list[trimesh.Trimesh] = []
    step = spacing / max(lod, 0.25)
    post_dir: list[np.ndarray] = []
    for a, b in zip(pts[:-1], pts[1:], strict=True):
        seg_len = float(np.linalg.norm(b - a))
        if seg_len < 1e-6:
            continue
        for t in stations(seg_len, step)[:-1] if closed else stations(seg_len, step):
            post_xy.append(a + (b - a) * (t / seg_len))
            post_dir.append((b - a) / seg_len)
        for ry in (height, height * 0.5):
            rails.append(member(xz(a, y + ry), xz(b, y + ry), 0.05))
    keep = dedupe_index(np.array(post_xy), 0.05) if post_xy else []
    post = column_mesh(height, 0.06)
    nodes = [MeshNode("handrail_rails", "Handrail", merge(rails))]
    if keep:
        xf = np.concatenate([posed(xz(post_xy[i], y)[None], post_dir[i]) for i in keep])
        nodes.insert(0, MeshNode("handrail_posts", "Handrail", Instanced(post, xf)))
    return nodes


def pipe_nodes(lines: list[tuple[float, bool, np.ndarray, np.ndarray]], ctx: BuildCtx) -> list[MeshNode]:
    """Pipes as instanced unit tubes, one node per (diameter, insulated); lines are (d, ins, p0, p1)."""
    groups: dict[tuple[float, bool], list[np.ndarray]] = {}
    for d, ins, p0, p1 in lines:
        if np.linalg.norm(np.asarray(p1) - np.asarray(p0)) > 1e-6:
            groups.setdefault((round(d, 4), ins), []).append(along(p0, p1))
    out = []
    for (d, ins), xf in sorted(groups.items()):
        name = f"pipes_{'ins_' if ins else ''}{round(d * 1000)}"
        out.append(
            MeshNode(
                name,
                "Pipe_Insulated" if ins else "Pipe",
                Instanced(tube(d / 2, segs(d / 2, ctx)), np.array(xf)),
            )
        )
    return out


def triangles(nodes: list[MeshNode]) -> int:
    n = 0
    for node in nodes:
        g = node.geometry
        n += len(g.mesh.faces) * len(g.transforms) if isinstance(g, Instanced) else len(g.faces)
    return n


def posed(points3: np.ndarray, u: np.ndarray) -> np.ndarray:
    """(N, 4, 4): rotate about Y so local +X points along u (local [x, z]), then translate."""
    c, s = float(u[0]), -float(u[1])
    rot = np.array([[c, 0.0, s, 0.0], [0.0, 1.0, 0.0, 0.0], [-s, 0.0, c, 0.0], [0.0, 0.0, 0.0, 1.0]])
    out = np.tile(rot, (len(np.atleast_2d(points3)), 1, 1))
    out[:, :3, 3] = np.atleast_2d(np.asarray(points3, dtype=float))
    return out


def block(size: tuple[float, float, float]) -> trimesh.Trimesh:
    """A box centred on the origin, extents (along X, up Y, across Z)."""
    return trimesh.creation.box(extents=size)


def placed_block(center3, size, u) -> trimesh.Trimesh:
    m = block(size)
    m.apply_transform(posed(np.asarray(center3, float)[None], u)[0])
    return m


def grid_rows(
    ring: np.ndarray, run: Run, along_sp: float, across_sp: float, inset: float
) -> list[np.ndarray]:
    """Grid points on the run's axes (rows across, one per station along), kept inside the ring.

    Points sit `inset` in from the run's rectangle; they are kept when inside the ring shrunk by
    inset / 2, so a ring that is not quite its minimum rectangle still keeps its edge rows.
    """
    poly = Polygon(ring)
    inner = poly.buffer(-inset / 2)
    if inner.is_empty:
        inner = poly
    inner = inner.buffer(1e-6)
    rows = []
    for t in stations(run.length, along_sp, inset):
        row = [run.at(t, s) for s in stations(run.width, across_sp, inset) - run.width / 2]
        row = [p for p in row if inner.contains(Point(p))]
        if row:
            rows.append(np.array(row))
    if not rows:
        rows = [np.array([run.at(run.length / 2)])]
    return rows


def perimeter_points(ring: np.ndarray, spacing: float, inset: float) -> np.ndarray:
    """Column spots round a ring shrunk by inset: its corners (rings of <= 12 vertices) plus one
    every `spacing` along it. Circles and many-sided rings get the spaced points only."""
    inner = Polygon(ring).buffer(-inset, join_style=2)
    if inner.is_empty:
        inner = Polygon(ring)
    edge = inner.exterior
    corners = np.asarray(edge.coords, dtype=float)[:-1] if len(ring) <= 12 else np.zeros((0, 2))
    n = max(3, math.ceil(edge.length / spacing - 1e-9))
    spaced = np.array([[q.x, q.y] for q in (edge.interpolate(i / n, normalized=True) for i in range(n))])
    return np.vstack([corners, spaced])
