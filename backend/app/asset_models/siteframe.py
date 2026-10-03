"""The plant grid (spec 2026-10-03-plant-model-generator §5, D9; plan 2026-10-03-plant-model-f0 Task 3).

Three frames:
- plant: [E, N] metres in the drawing's own grid, elevations as plant EL;
- site: [X, Y] metres in the site CRS: [X, Y] = origin_crs + R(θ)·[E, N] with
  R(θ) = [[cos θ, sin θ], [-sin θ, cos θ]], θ = plant_north_deg (plant north, clockwise from grid north);
- scene (and GLB): metres, Y up: x = plant N, y = EL - datum.el_m, z = plant E.

Pinned by contract/fixtures/plant-grid-vectors.json (the KIPIC register) in pytest and, in S1, vitest.
"""

from __future__ import annotations

import math

import numpy as np
from numpy.typing import ArrayLike
from shapely.geometry import LineString

from app.asset_models.spec import Footprint, SiteFrame

CIRCLE_SEGMENTS = 64


class GridError(Exception):
    """The grid cannot answer: no usable CRS for a lon/lat, or too few or coincident fit points."""


class PlantGrid:
    def __init__(self, frame: SiteFrame):
        self.frame = frame
        self._ox, self._oy = float(frame.origin_crs[0]), float(frame.origin_crs[1])
        t = math.radians(frame.plant_north_deg)
        self._c, self._s = math.cos(t), math.sin(t)
        self._datum = float(frame.datum.el_m)
        self._to_wgs = None  # pyproj transformers, built on first use
        self._from_wgs = None

    def plant_to_site(self, e: ArrayLike, n: ArrayLike) -> tuple[np.ndarray, np.ndarray]:
        e, n = np.asarray(e, dtype=np.float64), np.asarray(n, dtype=np.float64)
        return self._ox + self._c * e + self._s * n, self._oy - self._s * e + self._c * n

    def site_to_plant(self, x: ArrayLike, y: ArrayLike) -> tuple[np.ndarray, np.ndarray]:
        dx = np.asarray(x, dtype=np.float64) - self._ox
        dy = np.asarray(y, dtype=np.float64) - self._oy
        return self._c * dx - self._s * dy, self._s * dx + self._c * dy

    def plant_to_scene(self, e: ArrayLike, n: ArrayLike, el: ArrayLike) -> np.ndarray:
        e, n, el = np.broadcast_arrays(*(np.asarray(v, dtype=np.float64) for v in (e, n, el)))
        return np.stack([n, el - self._datum, e], axis=-1)

    def scene_to_plant(self, xyz: np.ndarray) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
        xyz = np.asarray(xyz, dtype=np.float64)
        return xyz[..., 2], xyz[..., 0], xyz[..., 1] + self._datum

    def _transformers(self):
        if self._to_wgs is None:
            from pyproj import CRS, Transformer

            crs = self.frame.crs
            if crs.epsg is None and not crs.wkt:
                raise GridError("the site frame has no CRS")
            try:
                src = CRS.from_epsg(crs.epsg) if crs.epsg is not None else CRS.from_wkt(crs.wkt)
            except Exception:
                raise GridError("the site CRS is not one pyproj knows") from None
            wgs = CRS.from_epsg(4326)
            self._to_wgs = Transformer.from_crs(src, wgs, always_xy=True)
            self._from_wgs = Transformer.from_crs(wgs, src, always_xy=True)
        return self._to_wgs, self._from_wgs

    def site_to_lonlat(self, x: ArrayLike, y: ArrayLike) -> tuple[np.ndarray, np.ndarray]:
        to_wgs, _ = self._transformers()
        lon, lat = to_wgs.transform(np.asarray(x, dtype=np.float64), np.asarray(y, dtype=np.float64))
        return np.asarray(lon, dtype=np.float64), np.asarray(lat, dtype=np.float64)

    def convergence_deg(self) -> float:
        """The true bearing of grid north at the plant origin, clockwise from true north. The true
        bearing of plant north is then plant_north_deg + convergence_deg() (spec §9)."""
        to_wgs, from_wgs = self._transformers()
        lon, lat = to_wgs.transform(self._ox, self._oy)
        x2, y2 = from_wgs.transform(lon, lat + 1e-4)
        return -math.degrees(math.atan2(x2 - self._ox, y2 - self._oy))


def fit_plant_grid(
    pairs: list[tuple[tuple[float, float], tuple[float, float]]],
) -> tuple[tuple[float, float], float, float]:
    """[((E, N), (X, Y)), ...] (at least 2) -> (origin_crs, plant_north_deg, rms_residual_m).

    Least squares over a rotation and a translation, no scale: the drawing's grid is in metres."""
    if len(pairs) < 2:
        raise GridError("a plant grid needs at least two points")
    p = np.array([pe for pe, _ in pairs], dtype=np.float64).reshape(-1, 2)
    q = np.array([qx for _, qx in pairs], dtype=np.float64).reshape(-1, 2)
    if not (np.isfinite(p).all() and np.isfinite(q).all()):
        raise GridError("the grid points must be finite")
    pt, qt = p - p.mean(axis=0), q - q.mean(axis=0)
    if float(np.abs(pt).max()) < 1e-6:
        raise GridError("the plant points coincide")
    a = float(np.sum(qt[:, 0] * pt[:, 0] + qt[:, 1] * pt[:, 1]))
    b = float(np.sum(qt[:, 0] * pt[:, 1] - qt[:, 1] * pt[:, 0]))
    theta = math.atan2(b, a)
    c, s = math.cos(theta), math.sin(theta)
    r = np.array([[c, s], [-s, c]])
    origin = q.mean(axis=0) - r @ p.mean(axis=0)
    resid = q - (origin + p @ r.T)
    rms = float(np.sqrt(np.mean(np.sum(resid**2, axis=1))))
    return (float(origin[0]), float(origin[1])), math.degrees(theta), rms


def _signed_area(ring: np.ndarray) -> float:
    x, y = ring[:, 0], ring[:, 1]
    return 0.5 * float(np.dot(x, np.roll(y, -1)) - np.dot(np.roll(x, -1), y))


def _ccw(ring: np.ndarray) -> np.ndarray:
    return ring[::-1].copy() if _signed_area(ring) < 0 else ring


def _open_ring(pts) -> np.ndarray:
    ring = np.asarray(pts, dtype=np.float64).reshape(-1, 2)
    if len(ring) > 1 and np.allclose(ring[0], ring[-1]):
        ring = ring[:-1]
    return ring


def footprint_ref(fp: Footprint) -> tuple[float, float]:
    """The item's reference point, plant [E, N]: rect and circle centre; polygon area-weighted
    centroid; line length-weighted centroid. A degenerate polygon or line falls back to the mean."""
    if fp.kind in ("rect", "circle"):
        return float(fp.center[0]), float(fp.center[1])
    if fp.kind == "polygon":
        pts = _open_ring(fp.pts)
        x, y = pts[:, 0], pts[:, 1]
        xn, yn = np.roll(x, -1), np.roll(y, -1)
        cross = x * yn - xn * y
        area = 0.5 * float(cross.sum())
        if abs(area) > 1e-12:
            return float(((x + xn) * cross).sum() / (6 * area)), float(((y + yn) * cross).sum() / (6 * area))
    else:
        pts = np.asarray(fp.pts, dtype=np.float64)
        seg = np.diff(pts, axis=0)
        lengths = np.hypot(seg[:, 0], seg[:, 1])
        if lengths.sum() > 1e-12:
            c = (((pts[:-1] + pts[1:]) / 2) * lengths[:, None]).sum(axis=0) / lengths.sum()
            return float(c[0]), float(c[1])
    m = pts.mean(axis=0)
    return float(m[0]), float(m[1])


def footprint_polygon(fp: Footprint) -> np.ndarray:
    """The outline, (k, 2) plant [E, N], counter-clockwise, the closing point not repeated. A line
    is its outline at `width` (flat ends, mitred corners); a line with no length raises ValueError."""
    if fp.kind == "rect":
        t = math.radians(fp.rot_deg)
        u = np.array([math.sin(t), math.cos(t)])  # along: rot_deg clockwise from plant north, [dE, dN]
        v = np.array([math.cos(t), -math.sin(t)])  # across: `along` turned 90 degrees clockwise
        c = np.asarray(fp.center, dtype=np.float64)
        a, b = fp.size[0] / 2.0, fp.size[1] / 2.0
        return np.array([c - v * b - u * a, c + v * b - u * a, c + v * b + u * a, c - v * b + u * a])
    if fp.kind == "circle":
        k = np.arange(CIRCLE_SEGMENTS) * (2 * math.pi / CIRCLE_SEGMENTS)
        r = fp.d / 2.0
        return np.column_stack([fp.center[0] + r * np.cos(k), fp.center[1] + r * np.sin(k)])
    if fp.kind == "polygon":
        return _ccw(_open_ring(fp.pts))
    outline = LineString(fp.pts).buffer(fp.width / 2.0, cap_style="flat", join_style="mitre", mitre_limit=5.0)
    if outline.is_empty or outline.geom_type != "Polygon":
        raise ValueError("the line footprint has no length")
    return _ccw(_open_ring(np.asarray(outline.exterior.coords)))
