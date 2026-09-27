"""The cross-section cut (spec 2026-09-26-point-cloud-workspace sections 8.2 and 8.4), pure: no DB.

The section frame is the horizontal line A -> B: s runs along it from A, t across it, z up. The source
is streamed in 2 M-point chunks; the points with |t| <= thickness/2 and 0 <= s <= L are kept as
float32 (s, z) plus uint16 rgb. When the kept buffer passes 2 M points it is thinned on a 2D (s, z)
grid to at most 1 M; the output is thinned to `max_points`. Thinning keeps the point nearest each
cell centre and always keeps the z minimum and maximum. Plan 2026-09-27-clouds-b2, Rulings 5-9.
"""

from __future__ import annotations

import math
from collections.abc import Callable
from dataclasses import dataclass
from pathlib import Path

import laspy
import numpy as np

CHUNK = 2_000_000
BUFFER_MAX = 2_000_000
EPS = 1e-6  # slab and segment edges are inclusive within this (float64 noise at UTM magnitudes)
WIDTH_BIN_M = 0.1
WIDTH_GAP_M = 1.0  # wider than a shell, narrower than a stack's hollow
RGB = ("red", "green", "blue")


@dataclass
class ProfileCut:
    s: np.ndarray  # float32, metres along the line from A
    z: np.ndarray  # float32, native heights
    rgb: np.ndarray | None  # uint8 (n, 3); None when the format has no colour
    length_m: float
    z_min: float | None  # over every kept point, float64
    z_max: float | None
    width_max_m: float | None
    cell_m: float | None  # the last thinning cell; None when nothing was thinned
    scanned: int

    @property
    def count(self) -> int:
        return int(self.s.size)


def _grid_keep(s: np.ndarray, z: np.ndarray, cell: float) -> np.ndarray:
    """Indices of the point nearest each (s, z) cell centre, plus the z minimum and maximum."""
    s64, z64 = s.astype(np.float64), z.astype(np.float64)
    ix = np.floor(s64 / cell).astype(np.int64)
    iz = np.floor(z64 / cell).astype(np.int64)
    d2 = (s64 - (ix + 0.5) * cell) ** 2 + (z64 - (iz + 0.5) * cell) ** 2
    iz -= iz.min()
    key = ix * (int(iz.max()) + 1) + iz
    order = np.lexsort((d2, key))
    ks = key[order]
    first = np.ones(ks.size, dtype=bool)
    first[1:] = ks[1:] != ks[:-1]
    keep = np.concatenate([order[first], [int(np.argmin(z64)), int(np.argmax(z64))]])
    return np.unique(keep)


def thin_to(
    s: np.ndarray, z: np.ndarray, c: np.ndarray | None, target: int, cell: float
) -> tuple[np.ndarray, np.ndarray, np.ndarray | None, float]:
    """Grid-thin to at most `target` points; the cell grows (and the thin restarts from the input)
    until it fits. Returns the kept arrays and the cell used."""
    while s.size > target:
        idx = _grid_keep(s, z, cell)
        if idx.size <= target:
            return s[idx], z[idx], (None if c is None else c[idx]), cell
        cell *= max(1.1, math.sqrt(idx.size / target))
    return s, z, c, cell


def _counted(lo, hi, lo2, hi2) -> np.ndarray:
    """Which clusters (lo, hi) of one bin a cluster of the neighbouring bin (lo2, hi2) confirms.

    Clusters in a bin are sorted by s and disjoint, so the neighbours that can overlap (lo, hi) --
    hi2 >= lo and lo2 <= hi, which a positive overlap needs -- are one contiguous range, found by
    binary search; only those pairs are tested (plan Ruling 8's test, unchanged)."""
    j0 = np.searchsorted(hi2, lo, side="left")
    j1 = np.searchsorted(lo2, hi, side="right")
    n = np.maximum(j1 - j0, 0)
    hit = np.zeros(lo.size, dtype=bool)
    if not n.any():
        return hit
    ci = np.repeat(np.arange(lo.size), n)
    nj = np.repeat(j0, n) + (np.arange(ci.size) - np.repeat(np.cumsum(n) - n, n))
    e, e2 = hi[ci] - lo[ci], hi2[nj] - lo2[nj]
    small = np.minimum(e, e2)
    ok = (np.maximum(e, e2) <= 2 * small) & (
        np.minimum(hi[ci], hi2[nj]) - np.maximum(lo[ci], lo2[nj]) >= 0.5 * small
    )
    hit[ci[ok]] = True
    return hit


WIDTH_CANCEL_EVERY = 64  # bins between cancel checks


def width_max(
    s: np.ndarray, z: np.ndarray, *, check_cancelled: Callable[[], None] | None = None
) -> float | None:
    """The largest horizontal extent of a wall-like cluster at one height (plan Ruling 8)."""
    n = s.size
    if n == 0:
        return None
    s64 = s.astype(np.float64)
    zb = np.floor(z.astype(np.float64) / WIDTH_BIN_M).astype(np.int64)
    order = np.lexsort((s64, zb))
    ss, bb = s64[order], zb[order]
    brk = np.ones(n, dtype=bool)
    brk[1:] = (bb[1:] != bb[:-1]) | (np.diff(ss) > WIDTH_GAP_M)
    starts = np.flatnonzero(brk)
    ends = np.append(starts[1:], n) - 1
    cb, clo, chi = bb[starts], ss[starts], ss[ends]
    bins, first = np.unique(cb, return_index=True)  # cb is sorted: each bin is one slice
    last = np.append(first[1:], cb.size)
    where = {int(b): (int(i), int(j)) for b, i, j in zip(bins, first, last, strict=True)}
    best: float | None = None
    for k, b in enumerate(bins.tolist()):
        if check_cancelled is not None and k % WIDTH_CANCEL_EVERY == 0:
            check_cancelled()
        i, j = where[b]
        lo, hi = clo[i:j], chi[i:j]
        hit = np.zeros(lo.size, dtype=bool)
        for nb in (b - 1, b + 1):
            if nb in where:
                i2, j2 = where[nb]
                hit |= _counted(lo, hi, clo[i2:j2], chi[i2:j2])
        if hit.any():
            e = float((hi[hit] - lo[hit]).max())
            best = e if best is None else max(best, e)
    return best


def to_uint8(c: np.ndarray) -> np.ndarray:
    """16-bit LAS colour to 8 bits; colour an 8-bit writer stored (every value <= 255) is kept."""
    if c.size and int(c.max()) > 255:
        return (c >> 8).astype(np.uint8)
    return c.astype(np.uint8)


def _merge(parts: list[np.ndarray], dtype, width: int | None = None) -> np.ndarray:
    if parts:
        return np.concatenate(parts)
    return np.zeros((0,) if width is None else (0, width), dtype=dtype)


def cut(
    source: Path,
    *,
    a: tuple[float, float],
    b: tuple[float, float],
    thickness_m: float,
    max_points: int,
    scale: float,
    progress: Callable[[int, int], None],
    check_cancelled: Callable[[], None],
) -> ProfileCut:
    ax, ay = a
    length = math.hypot(b[0] - ax, b[1] - ay)
    ux, uy = (b[0] - ax) / length, (b[1] - ay) / length
    half = thickness_m / 2
    cell = max(scale, length / 4000)
    s_parts: list[np.ndarray] = []
    z_parts: list[np.ndarray] = []
    c_parts: list[np.ndarray] = []
    held = scanned = 0
    z_min: float | None = None
    z_max: float | None = None
    thinned = False
    with laspy.open(source) as r:
        total = int(r.header.point_count)
        has_rgb = set(RGB) <= set(r.header.point_format.dimension_names)
        for pts in r.chunk_iterator(CHUNK):
            check_cancelled()
            dx = np.asarray(pts.x) - ax
            dy = np.asarray(pts.y) - ay
            s = dx * ux + dy * uy
            t = dy * ux - dx * uy
            keep = (np.abs(t) <= half + EPS) & (s >= -EPS) & (s <= length + EPS)
            scanned += len(pts)
            if keep.any():
                z = np.asarray(pts.z)[keep]
                lo, hi = float(z.min()), float(z.max())
                z_min = lo if z_min is None else min(z_min, lo)
                z_max = hi if z_max is None else max(z_max, hi)
                s_parts.append(np.clip(s[keep], 0.0, length).astype(np.float32))
                z_parts.append(z.astype(np.float32))
                if has_rgb:
                    c_parts.append(
                        np.column_stack([np.asarray(getattr(pts, k))[keep] for k in RGB]).astype(np.uint16)
                    )
                held += int(keep.sum())
                if held > BUFFER_MAX:
                    s_all, z_all = _merge(s_parts, np.float32), _merge(z_parts, np.float32)
                    c_all = _merge(c_parts, np.uint16, 3) if has_rgb else None
                    s_all, z_all, c_all, cell = thin_to(s_all, z_all, c_all, BUFFER_MAX // 2, cell)
                    s_parts, z_parts = [s_all], [z_all]
                    c_parts = [c_all] if c_all is not None else []
                    held, thinned = s_all.size, True
            progress(scanned, total)
    s_all, z_all = _merge(s_parts, np.float32), _merge(z_parts, np.float32)
    c_all = _merge(c_parts, np.uint16, 3) if has_rgb else None
    width = width_max(s_all, z_all, check_cancelled=check_cancelled)
    if s_all.size > max_points:
        s_all, z_all, c_all, cell = thin_to(s_all, z_all, c_all, max_points, cell)
        thinned = True
    return ProfileCut(
        s=s_all,
        z=z_all,
        rgb=None if c_all is None else to_uint8(c_all),
        length_m=length,
        z_min=z_min,
        z_max=z_max,
        width_max_m=width,
        cell_m=cell if thinned else None,
        scanned=scanned,
    )
