"""Shared mesh helpers for the plant builders (spec 2026-10-03-plant-model-generator §6; plan F0 Task 5).

Item-local frame: metres, Y up from the item's base_el, x = plant north, z = plant east, origin at
the footprint's reference point. A degenerate input (zero length, no area, a non-positive size)
raises ValueError; `build_item` turns that into a fallback, so a helper never has to guess.
"""

from __future__ import annotations

import math

import numpy as np
import trimesh
from shapely.geometry import Polygon
from shapely.geometry.polygon import orient

MIN_SEGMENTS, MAX_SEGMENTS = 8, 128
# trimesh builds prisms in its XY plane along +Z. (X, Y, Z) -> (X, Z, -Y) is a proper rotation
# (det +1, so face winding survives): height lands on +Y, and a plan point [x, z] is drawn at
# (X, Y) = (x, -z) so that it lands back on z.
Z_UP_TO_Y_UP = np.array([[1, 0, 0, 0], [0, 0, 1, 0], [0, -1, 0, 0], [0, 0, 0, 1]], dtype=np.float64)


def segments_for(r: float, chord_err: float = 0.02) -> int:
    """Segments for a circle of radius r (metres) whose chord sags at most chord_err, in [8, 128]."""
    if not r > 0:
        raise ValueError("the radius must be positive")
    if chord_err >= r:
        return MIN_SEGMENTS
    n = math.ceil(math.pi / math.acos(1.0 - chord_err / r))
    return int(min(MAX_SEGMENTS, max(MIN_SEGMENTS, n)))


def yaw(deg: float) -> np.ndarray:
    """4x4 rotation about +Y that turns plant north (+x) deg clockwise, seen from above, toward east (+z)."""
    t = math.radians(deg)
    c, s = math.cos(t), math.sin(t)
    return np.array([[c, 0, -s, 0], [0, 1, 0, 0], [s, 0, c, 0], [0, 0, 0, 1]], dtype=np.float64)


def place(x: float, y: float, z: float, yaw_deg: float = 0.0) -> np.ndarray:
    """4x4: turn by yaw_deg (see `yaw`), then move to (x, y, z)."""
    m = yaw(yaw_deg)
    m[:3, 3] = (x, y, z)
    return m


def box(w: float, l: float, h: float) -> trimesh.Trimesh:  # noqa: E741 - length along plant north
    """A box l along x (north), h up, w along z (east); base on y = 0, centred on x and z."""
    if min(w, l, h) <= 0:
        raise ValueError("a box needs positive sizes")
    m = trimesh.creation.box(extents=(l, h, w))
    m.apply_translation((0.0, h / 2.0, 0.0))
    return m


def cyl(r: float, h: float, segments: int | None = None) -> trimesh.Trimesh:
    """A closed cylinder on +Y: radius r, base on y = 0, top at y = h, centred on x and z."""
    if not (r > 0 and h > 0):
        raise ValueError("a cylinder needs a positive radius and height")
    m = trimesh.creation.cylinder(radius=r, height=h, sections=segments or segments_for(r))
    m.apply_translation((0.0, 0.0, h / 2.0))
    m.apply_transform(Z_UP_TO_Y_UP)
    return m


def extrude(poly2d, h: float) -> trimesh.Trimesh:
    """Extrude a plan outline [[x, z], ...] (item-local metres, either orientation, not closed) from
    y = 0 to y = h. A self-crossing or zero-area outline raises ValueError."""
    pts = np.asarray(poly2d, dtype=np.float64)
    if pts.ndim != 2 or pts.shape[1] != 2 or pts.shape[0] < 3 or not np.isfinite(pts).all():
        raise ValueError("an outline needs at least three finite [x, z] points")
    if not h > 0:
        raise ValueError("an extrusion needs a positive height")
    work = Polygon(np.column_stack([pts[:, 0], -pts[:, 1]]))
    if not work.is_valid or work.area <= 1e-9:
        raise ValueError("the outline crosses itself or has no area")
    m = trimesh.creation.extrude_polygon(orient(work, 1.0), h)
    m.apply_transform(Z_UP_TO_Y_UP)
    return m


def beam(p0, p1, section: tuple[float, float] = (0.3, 0.3)) -> trimesh.Trimesh:
    """A rectangular member from p0 to p1 (item-local metres). section = (w, h): w across, kept
    horizontal; h deep, in the vertical plane through the member. A vertical member's w lies along x."""
    a, b = np.asarray(p0, dtype=np.float64), np.asarray(p1, dtype=np.float64)
    d = b - a
    length = float(np.linalg.norm(d))
    w, hgt = section
    if length < 1e-6 or not (w > 0 and hgt > 0) or not np.isfinite(d).all():
        raise ValueError("a beam needs two distinct finite points and a positive section")
    axis = d / length
    side = np.cross((0.0, 1.0, 0.0), axis)
    if np.linalg.norm(side) < 1e-6:
        side = np.array([1.0, 0.0, 0.0])
    side /= np.linalg.norm(side)
    normal = np.cross(axis, side)
    m = trimesh.creation.box(extents=(w, hgt, length))
    xf = np.eye(4)
    xf[:3, 0], xf[:3, 1], xf[:3, 2] = side, normal, axis
    xf[:3, 3] = (a + b) / 2.0
    m.apply_transform(xf)
    return m


def ring_polyline(pts2d, y: float, r: float, closed: bool = True, segments: int = 6) -> trimesh.Trimesh:
    """A round bar of radius r along a plan polyline [[x, z], ...] at height y (handrails, rings).
    closed=True joins the last point back to the first."""
    pts = np.asarray(pts2d, dtype=np.float64)
    if pts.ndim != 2 or pts.shape[1] != 2 or pts.shape[0] < 2 or not r > 0:
        raise ValueError("a ring needs at least two [x, z] points and a positive radius")
    p3 = np.column_stack([pts[:, 0], np.full(len(pts), float(y)), pts[:, 1]])
    if closed:
        p3 = np.vstack([p3, p3[:1]])
    bars = [
        trimesh.creation.cylinder(radius=r, segment=[p3[i], p3[i + 1]], sections=segments)
        for i in range(len(p3) - 1)
        if np.linalg.norm(p3[i + 1] - p3[i]) > 1e-6
    ]
    if not bars:
        raise ValueError("a ring needs two distinct points")
    return trimesh.util.concatenate(bars)


def instanced_cyl(r: float, h: float, xforms):
    """One cylinder (see `cyl`) placed by each 4x4 of xforms, as an Instanced geometry."""
    from app.asset_models.builders.base import Instanced  # base never imports geom at module level

    t = np.asarray(xforms, dtype=np.float64).reshape(-1, 4, 4)
    if len(t) == 0:
        raise ValueError("instancing needs at least one transform")
    return Instanced(mesh=cyl(r, h), transforms=t)
