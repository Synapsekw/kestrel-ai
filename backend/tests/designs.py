"""Analytic design surfaces for the S3 tests (spec §15.1). Real UTM magnitudes on purpose, so float
cancellation is exercised: E ~ 500 000, N ~ 2 800 000."""

from __future__ import annotations

import math

import numpy as np
from scipy.spatial import Delaunay

from app.surfaces.design.rasterise import SimpleLattice

E0 = 500_000.0
N0 = 2_800_000.0
CONE_CENTRE = (E0 + 50.0, N0 + 50.0)


def plane_z(x, y):
    return 10.0 + 0.02 * (np.asarray(x) - E0) - 0.01 * (np.asarray(y) - N0)


def _with_z(xy: np.ndarray, fn) -> np.ndarray:
    return np.column_stack([xy[:, 0], xy[:, 1], fn(xy[:, 0], xy[:, 1])])


def two_triangle_plane(size: float = 100.0) -> tuple[np.ndarray, np.ndarray]:
    xy = np.array([[E0, N0], [E0 + size, N0], [E0 + size, N0 + size], [E0, N0 + size]])
    return _with_z(xy, plane_z), np.array([[0, 1, 2], [0, 2, 3]], np.int32)


def random_plane_tin(n_points: int = 2_600, seed: int = 0, size: float = 100.0):
    """About 5 000 random triangles over the same square as two_triangle_plane."""
    rng = np.random.default_rng(seed)
    corners = np.array([[0, 0], [size, 0], [size, size], [0, size]], float)
    xy = np.vstack([corners, rng.uniform(0, size, (n_points - 4, 2))]) + [E0, N0]
    tri = Delaunay(xy - [E0, N0])
    return _with_z(xy, plane_z), tri.simplices.astype(np.int32)


def pyramid_z(x, y):
    dx, dy = np.asarray(x) - (E0 + 20.0), np.asarray(y) - (N0 + 20.0)
    return 10.0 * (1.0 - np.maximum(np.abs(dx), np.abs(dy)) / 20.0)


def pyramid_tin():
    """A 40 x 40 base, apex 10 m: four planar faces. Volume 40 * 40 * 10 / 3 = 5 333.3 m³."""
    v = np.array(
        [[E0, N0, 0], [E0 + 40, N0, 0], [E0 + 40, N0 + 40, 0], [E0, N0 + 40, 0], [E0 + 20, N0 + 20, 10]],
        float,
    )
    return v, np.array([[0, 1, 4], [1, 2, 4], [2, 3, 4], [3, 0, 4]], np.int32)


def cone_z(x, y):
    r = np.hypot(np.asarray(x) - CONE_CENTRE[0], np.asarray(y) - CONE_CENTRE[1])
    return 20.0 - 0.5 * r


def cone_tin(ring_step: float = 0.5, sectors: int = 128, radius: float = 40.0):
    """z = 20 - 0.5 r, r <= 40, as a polar TIN (Delaunay of the centre and the ring vertices).
    Returns (vertices, triangles, delaunay) so a test can hand the same triangles to scipy."""
    rings = np.arange(ring_step, radius + 1e-9, ring_step)
    ang = np.linspace(0, 2 * math.pi, sectors, endpoint=False)
    xy = [np.zeros((1, 2))]
    for r in rings:
        xy.append(np.column_stack([r * np.cos(ang), r * np.sin(ang)]))
    local = np.vstack(xy)
    tri = Delaunay(local)
    xy_abs = local + CONE_CENTRE
    return _with_z(xy_abs, cone_z), tri.simplices.astype(np.int32), tri


def lattice_over(bounds: tuple[float, float, float, float], cell: float) -> SimpleLattice:
    """An aligned lattice (origin on multiples of `cell`) covering `bounds`, as grid.aligned_grid makes."""
    minx, miny, maxx, maxy = bounds
    x0 = math.floor(round(minx / cell, 9)) * cell
    y0 = math.ceil(round(maxy / cell, 9)) * cell
    return SimpleLattice(x0, y0, cell, int((maxx - x0) // cell) + 1, int((y0 - miny) // cell) + 1)


def l_shape_points(hole: bool = True):
    """A 1 m grid over 100 x 100 m minus a 30 x 30 m notch (x, y > 70), and minus an enclosed
    25 x 25 m patch (20 < x, y < 45) that stays surrounded by points. Every point is a run of 1."""
    g = np.arange(0, 101, 1.0)
    xx, yy = np.meshgrid(g, g)
    x, y = xx.ravel(), yy.ravel()
    keep = ~((x > 70) & (y > 70))
    if hole:
        keep &= ~((x > 20) & (x < 45) & (y > 20) & (y < 45))
    pts = np.column_stack([x[keep] + E0, y[keep] + N0, np.full(int(keep.sum()), 5.0)])
    return pts, np.arange(len(pts) + 1, dtype=np.int64)


def crossing_runs():
    """Two 2-vertex runs crossing at (E0 + 5, N0) at heights 5 and 7, plus four corner points."""
    pts = np.array(
        [
            [E0, N0, 5.0],
            [E0 + 10, N0, 5.0],
            [E0 + 5, N0 - 5, 7.0],
            [E0 + 5, N0 + 5, 7.0],
            [E0 - 2, N0 - 7, 6.0],
            [E0 + 12, N0 - 7, 6.0],
            [E0 + 12, N0 + 7, 6.0],
            [E0 - 2, N0 + 7, 6.0],
        ]
    )
    return pts, np.array([0, 2, 4, 5, 6, 7, 8], np.int64)


def cone_contour_runs(points_per_ring: int = 256):
    """Contours of cone_z: closed circles at z = 0..19 with radius 2 (20 - z)."""
    ang = np.linspace(0, 2 * math.pi, points_per_ring + 1)  # the last vertex closes the ring
    pts, runs = [], [0]
    for z in range(20):
        r = 2.0 * (20 - z)
        ring = np.column_stack(
            [CONE_CENTRE[0] + r * np.cos(ang), CONE_CENTRE[1] + r * np.sin(ang), np.full(len(ang), float(z))]
        )
        pts.append(ring)
        runs.append(runs[-1] + len(ring))
    return np.vstack(pts), np.array(runs, np.int64)
