"""Model vs. scan (spec 2026-10-02 §7.3 `compare_to_cloud`). Metres in, millimetres out.

The agent supplies where the asset origin is in the cloud and which way plant north points (M3
replaces this with registration). Distances are exact point-to-triangle distances over 8 candidate
triangles per point, found through a KD-tree of dense surface samples.
"""

from __future__ import annotations

import math
from dataclasses import dataclass

import numpy as np


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
