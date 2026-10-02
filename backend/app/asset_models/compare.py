"""Model vs. scan (spec 2026-10-02 §7.3 `compare_to_cloud`). Metres in, millimetres out.

The agent supplies where the asset origin is in the cloud and which way plant north points (M3
replaces this with registration). Distances are exact point-to-triangle distances over 8 candidate
triangles per point, found through a KD-tree of dense surface samples.
"""

from __future__ import annotations

import math
from dataclasses import dataclass

import numpy as np
from scipy.spatial import cKDTree

SURFACE_SAMPLES = 400_000
CANDIDATES = 8
SEED = 7


@dataclass(frozen=True)
class CloudTransform:
    origin: tuple[float, float, float]
    yaw_deg: float  # bearing of plant north, clockwise from the cloud's +Y


def cloud_to_asset(xyz: np.ndarray, t: CloudTransform) -> np.ndarray:
    d = np.asarray(xyz, dtype=float) - np.asarray(t.origin, dtype=float)
    s, c = math.sin(math.radians(t.yaw_deg)), math.cos(math.radians(t.yaw_deg))
    north = d[:, 0] * s + d[:, 1] * c
    east = d[:, 0] * c - d[:, 1] * s
    return np.column_stack([north, d[:, 2], east])


def _dot(u, v):
    return np.einsum("ij,ij->i", u, v)


def closest_points(p, a, b, c) -> np.ndarray:
    """Ericson, Real-Time Collision Detection 5.1.5, vectorised over rows."""
    ab, ac, ap = b - a, c - a, p - a
    d1, d2 = _dot(ab, ap), _dot(ac, ap)
    bp = p - b
    d3, d4 = _dot(ab, bp), _dot(ac, bp)
    cp = p - c
    d5, d6 = _dot(ab, cp), _dot(ac, cp)
    vc = d1 * d4 - d3 * d2
    vb = d5 * d2 - d1 * d6
    va = d3 * d6 - d5 * d4
    out = np.empty_like(p, dtype=float)
    done = np.zeros(len(p), dtype=bool)

    def take(mask, value):
        nonlocal done
        m = mask & ~done
        out[m] = value[m]
        done |= m

    with np.errstate(divide="ignore", invalid="ignore"):
        take((d1 <= 0) & (d2 <= 0), a)
        take((d3 >= 0) & (d4 <= d3), b)
        take((vc <= 0) & (d1 >= 0) & (d3 <= 0), a + (d1 / (d1 - d3))[:, None] * ab)
        take((d6 >= 0) & (d5 <= d6), c)
        take((vb <= 0) & (d2 >= 0) & (d6 <= 0), a + (d2 / (d2 - d6))[:, None] * ac)
        take(
            (va <= 0) & ((d4 - d3) >= 0) & ((d5 - d6) >= 0),
            b + ((d4 - d3) / ((d4 - d3) + (d5 - d6)))[:, None] * (c - b),
        )
        denom = 1.0 / (va + vb + vc)
        take(np.ones(len(p), bool), a + ab * (vb * denom)[:, None] + ac * (vc * denom)[:, None])
    return out


@dataclass(frozen=True)
class PartStat:
    id: str
    n: int
    median_mm: float | None
    p95_mm: float | None


@dataclass(frozen=True)
class Comparison:
    overall: PartStat
    parts: list[PartStat]
    inlier_share: float
    points_used: int

    def as_dict(self) -> dict:
        def r(v):
            return None if v is None else round(v, 1)

        def stat(s: PartStat) -> dict:
            return {"id": s.id, "n": s.n, "median_mm": r(s.median_mm), "p95_mm": r(s.p95_mm)}

        return {
            "overall": stat(self.overall),
            "parts": [stat(p) for p in self.parts],
            "inlier_share": round(self.inlier_share, 4),
            "points_used": self.points_used,
        }


def _stat(pid: str, d_m: np.ndarray) -> PartStat:
    if len(d_m) == 0:
        return PartStat(pid, 0, None, None)
    mm = d_m * 1000.0
    return PartStat(pid, int(len(mm)), float(np.median(mm)), float(np.percentile(mm, 95)))


def compare(meshes, points, *, max_points: int = 200_000, inlier_m: float = 0.25) -> Comparison:
    """Distance of each scan point to its nearest model part; points beyond inlier_m are dropped."""
    rng = np.random.default_rng(SEED)
    pts = np.asarray(points, dtype=float).reshape(-1, 3)
    if len(pts) > max_points:
        pts = pts[np.sort(rng.choice(len(pts), max_points, replace=False))]
    ids = list(meshes)
    empty = Comparison(
        PartStat("overall", 0, None, None), [PartStat(i, 0, None, None) for i in ids], 0.0, len(pts)
    )
    if not ids or len(pts) == 0:
        return empty
    area = np.concatenate([meshes[i].area_faces for i in ids])
    if len(area) == 0 or not area.sum() > 0:
        return empty
    tris = np.concatenate([meshes[i].triangles for i in ids])  # (T,3,3)
    owner = np.concatenate([np.full(len(meshes[i].faces), k) for k, i in enumerate(ids)])
    tri_of = rng.choice(len(tris), SURFACE_SAMPLES, p=area / area.sum())
    u, v = rng.random(SURFACE_SAMPLES), rng.random(SURFACE_SAMPLES)
    flip = u + v > 1
    u[flip], v[flip] = 1 - u[flip], 1 - v[flip]
    t = tris[tri_of]
    samples = t[:, 0] + u[:, None] * (t[:, 1] - t[:, 0]) + v[:, None] * (t[:, 2] - t[:, 0])
    _, nn = cKDTree(samples).query(pts, k=CANDIDATES)
    cand = tri_of[nn]  # (N,k) triangle ids
    p_rep = np.repeat(pts, CANDIDATES, axis=0)
    flat = cand.ravel()
    cp = closest_points(p_rep, tris[flat, 0], tris[flat, 1], tris[flat, 2])
    dist = np.linalg.norm(cp - p_rep, axis=1).reshape(-1, CANDIDATES)
    best = dist.argmin(axis=1)
    rows = np.arange(len(pts))
    d = dist[rows, best]
    part = owner[cand[rows, best]]
    inlier = d <= inlier_m
    stats = [_stat(pid, d[inlier & (part == k)]) for k, pid in enumerate(ids)]
    return Comparison(_stat("overall", d[inlier]), stats, float(inlier.mean()), int(len(pts)))
