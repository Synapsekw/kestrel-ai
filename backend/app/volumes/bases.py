"""Base models for a volume measurement (spec 2026-09-23-volumes §6.3).

The three toe-derived bases come from the polygon's edge: the ring is densified at one cell, the
top surface is sampled there, and samples on missing or masked ground are dropped, so the toe is
fitted to observed ground only. A surface base is `grid.resample_onto` and lives in the engine.
"""

from __future__ import annotations

import math
from dataclasses import dataclass

import numpy as np
import shapely
from scipy.interpolate import LinearNDInterpolator
from scipy.spatial import Delaunay

from app.surfaces.grid import SurfaceReader

MAX_EDGE_SAMPLES = 20_000
MIN_PLANE_SAMPLES = 10
MIN_PLANE_EIGEN_M2 = 0.25  # (0.5 m)^2: the edge must span both directions
REJECT_FLOOR_M = 0.05
MAD_SCALE = 1.4826
RUNMED_WINDOW = 5
EDGE_FAIL = 0.5
EDGE_WARN = 0.8
FIT_POOR_M = 0.10
TOO_STRAIGHT = "edge too short or too straight for a plane"


class BaseFitError(Exception):
    """The base cannot be fitted; the message is written for the operator."""


@dataclass(frozen=True)
class EdgeSamples:
    xs: np.ndarray  # usable samples, in ring order
    ys: np.ndarray
    zs: np.ndarray
    total: int
    perimeter_m: float

    @property
    def usable_fraction(self) -> float:
        return self.xs.size / self.total if self.total else 0.0


@dataclass(frozen=True)
class BaseFit:
    kind: str
    samples: int
    rejected: int
    usable_edge_fraction: float
    rms_m: float
    plane: list[float] | None  # [a, b, c]: z = a (x - cx) + b (y - cy) + c

    def to_json(self) -> dict:
        return {
            "kind": self.kind,
            "samples": self.samples,
            "rejected": self.rejected,
            "usable_edge_fraction": self.usable_edge_fraction,
            "rms_m": self.rms_m,
            "plane": self.plane,
        }


def densify_ring(ring: list[list[float]], step: float) -> tuple[np.ndarray, np.ndarray, float]:
    """Points every `step` metres along the closed ring (the step grows past MAX_EDGE_SAMPLES)."""
    pts = np.asarray(ring, dtype=np.float64)
    if np.allclose(pts[0], pts[-1]):
        pts = pts[:-1]
    closed = np.vstack([pts, pts[:1]])
    seg = np.hypot(np.diff(closed[:, 0]), np.diff(closed[:, 1]))
    perimeter = float(seg.sum())
    step = max(step, perimeter / MAX_EDGE_SAMPLES)
    along = np.arange(0.0, perimeter, step)
    cum = np.r_[0.0, np.cumsum(seg)]
    i = np.clip(np.searchsorted(cum, along, side="right") - 1, 0, len(seg) - 1)
    t = np.where(seg[i] > 0, (along - cum[i]) / np.where(seg[i] > 0, seg[i], 1.0), 0.0)
    xs = closed[i, 0] + t * (closed[i + 1, 0] - closed[i, 0])
    ys = closed[i, 1] + t * (closed[i + 1, 1] - closed[i, 1])
    return xs, ys, perimeter


def sample_edge(
    top: SurfaceReader, ring: list[list[float]], blocked=None, *, require: bool = True
) -> EdgeSamples:
    """The top surface along the ring; NaN samples and samples inside `blocked` (the union of the
    patch and exclude regions) are dropped. With `require` (the toe fits), fails below half the
    edge usable; a flat base only reports the edge, so it passes `require=False`."""
    xs, ys, perimeter = densify_ring(ring, top.spec.cell_size)
    zs = top.sample_bilinear(xs, ys)
    keep = np.isfinite(zs)
    if blocked is not None and not blocked.is_empty:
        keep &= ~shapely.contains_xy(blocked, xs, ys)
    edge = EdgeSamples(xs[keep], ys[keep], zs[keep], xs.size, perimeter)
    if require and edge.usable_fraction < EDGE_FAIL:
        missing = (1.0 - edge.usable_fraction) * perimeter
        raise BaseFitError(
            f"the polygon edge runs over {missing:.0f} m of missing or masked ground — "
            "redraw the edge on bare ground"
        )
    return edge


@dataclass(frozen=True)
class Plane:
    a: float
    b: float
    c: float
    cx: float
    cy: float

    def z_at(self, xs: np.ndarray, ys: np.ndarray) -> np.ndarray:
        return self.a * (np.asarray(xs) - self.cx) + self.b * (np.asarray(ys) - self.cy) + self.c


def _lstsq_plane(xs, ys, zs, cx, cy) -> Plane:
    design = np.column_stack([xs - cx, ys - cy, np.ones_like(xs)])
    a, b, c = np.linalg.lstsq(design, zs, rcond=None)[0]
    return Plane(float(a), float(b), float(c), cx, cy)


def robust_plane(xs: np.ndarray, ys: np.ndarray, zs: np.ndarray) -> tuple[Plane, np.ndarray]:
    """A least-squares plane, refitted once without the samples whose residual is more than
    max(3s, 0.05 m) from the median residual (s = 1.4826 MAD). Returns the plane and the kept mask.

    Measured about the median, not about zero (plan deviation 1): 10 % of samples pushed up
    shift the first fit, and |r| alone would then reject every clean sample."""
    if xs.size < MIN_PLANE_SAMPLES:
        raise BaseFitError(TOO_STRAIGHT)
    cx, cy = float(xs.mean()), float(ys.mean())
    first = _lstsq_plane(xs, ys, zs, cx, cy)
    r = zs - first.z_at(xs, ys)
    med = float(np.median(r))
    s = MAD_SCALE * float(np.median(np.abs(r - med)))
    keep = np.abs(r - med) <= max(3.0 * s, REJECT_FLOOR_M)
    if keep.sum() < MIN_PLANE_SAMPLES:
        raise BaseFitError(TOO_STRAIGHT)
    cov = np.cov(np.vstack([xs[keep] - cx, ys[keep] - cy]))
    if float(np.linalg.eigvalsh(cov)[0]) < MIN_PLANE_EIGEN_M2:
        raise BaseFitError(TOO_STRAIGHT)
    return _lstsq_plane(xs[keep], ys[keep], zs[keep], cx, cy), keep


def _rms(r: np.ndarray) -> float:
    return float(math.sqrt(np.mean(np.square(r)))) if r.size else 0.0


def fit_toe_plane(edge: EdgeSamples) -> tuple[Plane, BaseFit]:
    plane, keep = robust_plane(edge.xs, edge.ys, edge.zs)
    rms = _rms(edge.zs[keep] - plane.z_at(edge.xs[keep], edge.ys[keep]))
    fit = BaseFit(
        "toe_plane",
        int(edge.xs.size),
        int((~keep).sum()),
        edge.usable_fraction,
        rms,
        [plane.a, plane.b, plane.c],
    )
    return plane, fit


class ToeSurface:
    """A linear TIN through the kept edge samples; cells outside its hull take the robust plane."""

    def __init__(self, xs: np.ndarray, ys: np.ndarray, zs: np.ndarray, fallback: Plane):
        self.fallback = fallback
        self._interp = LinearNDInterpolator(Delaunay(np.column_stack([xs, ys])), zs)

    def z_at(self, xs: np.ndarray, ys: np.ndarray) -> np.ndarray:
        xs, ys = np.asarray(xs, dtype=np.float64), np.asarray(ys, dtype=np.float64)
        z = self._interp(xs, ys)
        outside = ~np.isfinite(z)
        if outside.any():
            z[outside] = self.fallback.z_at(xs[outside], ys[outside])
        return z


def _running_median(z: np.ndarray, window: int = RUNMED_WINDOW) -> np.ndarray:
    half = window // 2
    return np.median(np.stack([np.roll(z, k) for k in range(-half, half + 1)]), axis=0)


def fit_toe_surface(edge: EdgeSamples) -> tuple[ToeSurface, BaseFit]:
    """Samples in ring order, a circular running median over 5, samples more than max(3s, 0.05 m)
    from it rejected (s = 1.4826 MAD of z - runmed), then a TIN on the rest."""
    if edge.xs.size < MIN_PLANE_SAMPLES:
        raise BaseFitError(TOO_STRAIGHT)
    runmed = _running_median(edge.zs)
    r = edge.zs - runmed
    s = MAD_SCALE * float(np.median(np.abs(r - np.median(r))))
    keep = np.abs(r) <= max(3.0 * s, REJECT_FLOOR_M)
    xs, ys, zs = edge.xs[keep], edge.ys[keep], edge.zs[keep]
    plane, _ = robust_plane(xs, ys, zs)
    fit = BaseFit(
        "toe_surface", int(edge.xs.size), int((~keep).sum()), edge.usable_fraction, _rms(r[keep]), None
    )
    return ToeSurface(xs, ys, zs, plane), fit


class Flat:
    def __init__(self, z: float):
        self.z = float(z)

    def z_at(self, xs: np.ndarray, ys: np.ndarray) -> np.ndarray:
        return np.full(np.shape(xs), self.z, dtype=np.float64)


def flat_fit(edge: EdgeSamples, z: float) -> BaseFit:
    """Information only: how far the edge sits from the chosen level."""
    return BaseFit("flat", int(edge.xs.size), 0, edge.usable_fraction, _rms(edge.zs - z), None)
