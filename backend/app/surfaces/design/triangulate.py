"""Delaunay for points and contours (spec §9.1): densify, deduplicate, Delaunay, boundary peeling.

Densifying to 2 x cell makes Delaunay nearly respect the contour lines (a conforming approximation,
not a constrained triangulation). Peeling removes long triangles only from the boundary inwards,
so big interior triangles on flat ground survive; a global edge cut would punch holes there.
"""

from __future__ import annotations

from collections import deque
from collections.abc import Callable
from dataclasses import dataclass

import numpy as np
from scipy.spatial import Delaunay, QhullError

from app.surfaces.design import admission

QHULL_BYTES_PER_POINT = 700  # measured ~683 B/point on the build machine, rounded up to the next 100
DEDUPE_M = 0.001
EDGE_SAMPLE = 1_000_000
NOTHING = "the selected layers' points lie on a line — nothing to triangulate"


class NothingToTriangulate(ValueError):
    """Fewer than 3 points, or all collinear (the `nothing_to_triangulate` block)."""


@dataclass
class Triangulation:
    vertices: np.ndarray  # (N, 3) float64, deduplicated
    triangles: np.ndarray  # (M, 3) int32, after peeling
    max_edge_m: float  # the rule used; 0 = off
    long_edges_removed: int
    duplicate_positions: int  # positions whose heights differed by > 1 mm (averaged)
    input_points: int


def densify(points: np.ndarray, runs: np.ndarray, spacing: float) -> np.ndarray:
    """Every run's segments split to <= `spacing` (XY), Z linear along each segment."""
    p = np.asarray(points, dtype=np.float64)
    runs = np.asarray(runs, dtype=np.int64)
    if len(p) < 2:
        return p.copy()
    within = np.ones(len(p) - 1, bool)
    ends = runs[1:-1] - 1  # the last vertex of every run but the final one
    within[ends[(ends >= 0) & (ends < len(p) - 1)]] = False
    seg = np.flatnonzero(within)
    a, b = p[seg], p[seg + 1]
    n = np.maximum(1, np.ceil(np.hypot(b[:, 0] - a[:, 0], b[:, 1] - a[:, 1]) / spacing).astype(np.int64))
    extra = n - 1
    total = int(extra.sum())
    if total == 0:
        return p.copy()
    s = np.repeat(np.arange(len(seg)), extra)
    k = np.arange(total) - np.repeat(np.cumsum(extra) - extra, extra) + 1
    t = (k / np.repeat(n, extra))[:, None]
    return np.concatenate([p, a[s] + t * (b[s] - a[s])])


def dedupe(xyz: np.ndarray) -> tuple[np.ndarray, int]:
    """One vertex per 1 mm XY key, Z averaged; returns (vertices, keys whose Z spread > 1 mm)."""
    kx = np.round(xyz[:, 0] / DEDUPE_M).astype(np.int64)
    ky = np.round(xyz[:, 1] / DEDUPE_M).astype(np.int64)
    kx -= kx.min()
    ky -= ky.min()
    key = kx * (int(ky.max()) + 1) + ky
    uniq, inv, counts = np.unique(key, return_inverse=True, return_counts=True)
    if len(uniq) == len(key):
        return xyz, 0
    out = np.column_stack([np.bincount(inv, weights=xyz[:, i]) / counts for i in range(3)])
    order = np.argsort(inv, kind="stable")
    starts = np.concatenate([[0], np.cumsum(counts)[:-1]])
    zs = xyz[order, 2]
    spread = np.maximum.reduceat(zs, starts) - np.minimum.reduceat(zs, starts)
    return out, int(((counts > 1) & (spread > DEDUPE_M)).sum())


def _longest_edges(xy: np.ndarray, simp: np.ndarray) -> np.ndarray:
    a, b, c = xy[simp[:, 0]], xy[simp[:, 1]], xy[simp[:, 2]]
    return np.maximum.reduce([np.hypot(*(a - b).T), np.hypot(*(b - c).T), np.hypot(*(c - a).T)])


def _auto_max_edge(xy: np.ndarray, simp: np.ndarray, floor: float) -> float:
    s = simp[:: max(1, len(simp) // EDGE_SAMPLE)]
    edges = np.concatenate([np.hypot(*(xy[s[:, i]] - xy[s[:, (i + 1) % 3]]).T) for i in range(3)])
    return max(3.0 * float(np.percentile(edges, 95)), floor)


def peel(neighbors: np.ndarray, longest: np.ndarray, max_edge: float) -> np.ndarray:
    """Remove triangles longer than `max_edge` reachable from the hull (O(M)); returns the mask."""
    removed = np.zeros(len(neighbors), bool)
    if max_edge <= 0:
        return removed
    long = longest > max_edge
    queue = deque(np.flatnonzero((neighbors == -1).any(1)).tolist())
    while queue:
        t = queue.popleft()
        if removed[t] or not long[t]:
            continue
        removed[t] = True
        for n in neighbors[t]:
            if n != -1 and not removed[n]:
                queue.append(int(n))
    return removed


def triangulate(
    points: np.ndarray,
    runs: np.ndarray,
    *,
    spacing: float,
    max_edge_m: float | None,
    auto_floor: float,
    check_cancelled: Callable[[], None] | None = None,
    admit: Callable[..., None] = admission.admit,
) -> Triangulation:
    check = check_cancelled or (lambda: None)
    dense = densify(points, runs, spacing)
    check()
    pts, duplicates = dedupe(dense)
    check()
    admit(
        QHULL_BYTES_PER_POINT * len(pts),
        f"Triangulating {len(pts):,} points",
        "Choose a coarser cell size, or select fewer layers.",
    )
    if len(pts) < 3:
        raise NothingToTriangulate(NOTHING)
    xy = pts[:, :2] - pts[:, :2].mean(0)  # centred for Qhull precision at UTM magnitudes
    try:
        tri = Delaunay(xy, qhull_options="Qbb Qc Qz Q12")
    except QhullError:
        raise NothingToTriangulate(NOTHING) from None
    if len(tri.simplices) == 0:
        raise NothingToTriangulate(NOTHING)
    check()
    simp = tri.simplices.astype(np.int32)
    limit = _auto_max_edge(xy, simp, auto_floor) if max_edge_m is None else float(max_edge_m)
    removed = peel(tri.neighbors, _longest_edges(xy, simp), limit)
    return Triangulation(pts, simp[~removed], limit, int(removed.sum()), duplicates, len(points))
