"""Surfaces and clouds generated at test time (spec 2026-09-23-volumes §7.2, §13).

Every fixture sits on the tilted plane z = 50 + 0.02 (x - X0) - 0.013 (y - Y1), and the shapes are
placed relative to (X0, Y1), which is offset by (+0.037, -0.021) m from any round lattice, so no
cell edge lines up with a shape by accident.
"""

from __future__ import annotations

import math
from collections.abc import Callable
from pathlib import Path

import laspy
import numpy as np
from pyproj import CRS

from app.surfaces.grid import GridSpec, SurfaceStats, SurfaceWriter, aligned_grid, block_windows

X0 = 500_000.037
Y1 = 3_299_999.979
EPSG = 32639
WKT = CRS.from_epsg(EPSG).to_wkt()
CX, CY = X0 + 27.3, Y1 - 31.9  # the shapes' centre
CELLS = (0.05, 0.1, 0.25, 0.5)


def plane(xs: np.ndarray, ys: np.ndarray) -> np.ndarray:
    return 50.0 + 0.02 * (xs - X0) - 0.013 * (ys - Y1)


def cone(xs, ys, *, cx=CX, cy=CY, r=10.0, h=5.0) -> np.ndarray:
    d = np.hypot(xs - cx, ys - cy)
    return np.where(d < r, h * (1 - d / r), 0.0)


def fixture_spec(
    cell: float, size: float = 60.0, *, crs_wkt: str | None = WKT, epsg: int | None = EPSG
) -> GridSpec:
    return aligned_grid((X0, Y1 - size, X0 + size, Y1), cell, crs_wkt, epsg)


def write_surface(
    path: Path, spec: GridSpec, fn: Callable[[np.ndarray, np.ndarray], np.ndarray]
) -> SurfaceStats:
    """`fn(X, Y)` evaluated at every cell centre, written through SurfaceWriter."""
    with SurfaceWriter(path, spec) as w:
        for win in block_windows(spec):
            xs, ys = spec.cell_centres(win)
            w.write_block(win, fn(xs, ys))
        return w.finish()


def circle(cx: float, cy: float, r: float, n: int = 256) -> list[list[float]]:
    return [
        [cx + r * math.cos(2 * math.pi * i / n), cy + r * math.sin(2 * math.pi * i / n)] for i in range(n)
    ]


def write_cloud(
    path: Path,
    xyz: np.ndarray,
    *,
    classification: np.ndarray | None = None,
    withheld: np.ndarray | None = None,
    scale: float = 0.001,
) -> Path:
    """A LAS 1.2, point format 3 cloud. The CRS lives on the PointCloud row, not in the file."""
    header = laspy.LasHeader(point_format=3, version="1.2")
    header.scales = [scale, scale, scale]
    header.offsets = [math.floor(xyz[:, 0].min()), math.floor(xyz[:, 1].min()), 0.0]
    las = laspy.LasData(header)
    las.x, las.y, las.z = xyz[:, 0], xyz[:, 1], xyz[:, 2]
    las.classification = (
        np.full(len(xyz), 2, np.uint8) if classification is None else classification.astype(np.uint8)
    )
    if withheld is not None:
        las.withheld = withheld.astype(bool)
    path.parent.mkdir(parents=True, exist_ok=True)
    las.write(path)
    return path


def cone_cloud(
    density: float, sigma: float, outliers: float, *, seed: int = 11, size: float = 60.0
) -> np.ndarray:
    """The §5.3 synthetic cloud: uniform points on the cone-on-plane, Gaussian vertical noise, a
    fraction of outliers at -50 m or +30 m."""
    rng = np.random.default_rng(seed)
    n = int(density * size * size)
    x = X0 + rng.random(n) * size
    y = Y1 - rng.random(n) * size
    z = plane(x, y) + cone(x, y) + rng.normal(0.0, sigma, n)
    k = int(n * outliers)
    idx = rng.choice(n, k, replace=False)
    z[idx] = np.where(rng.random(k) < 0.5, -50.0, z[idx] + 30.0)
    return np.column_stack([x, y, z])
