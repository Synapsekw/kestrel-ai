"""The TIN rasteriser (spec §9.2): a numpy barycentric scan over cell centres, window by window.

Pure: numpy and rasterio.windows only; it never imports app.surfaces.grid. The build passes a
grid.GridSpec (it has the Lattice attributes) and the windows of grid.read_windows(spec).

Barycentrics are computed relative to each triangle's first vertex (not the window origin, as the
spec's §9.2 first said): the float result at a cell is then the same whichever window computed it,
so tiled output is bit-identical to a single-window run (ADR 2026-09-24 barycentric origin), and
the small relative coordinates avoid cancellation at UTM magnitudes.
"""

from __future__ import annotations

from collections.abc import Callable
from dataclasses import dataclass
from typing import Protocol

import numpy as np
from rasterio.windows import Window

SMALL = 8  # triangles whose clipped range fits in SMALL x SMALL cells are scanned in batches
BATCH = 16_384  # <= the spec's 65 536; keeps the (n, 8, 8) float64 temporaries near 8 MB each
CHUNK_CELLS = 4_000_000
RANGE_CHUNK = 65_536  # == the spec's 64 k cap; check_cancelled() runs once per this many triangles indexed
INSIDE_EPS = -1e-9
OVERLAP_DZ = 1e-3
DEGENERATE_REL = 1e-12
_STEPS = np.arange(SMALL)


class Lattice(Protocol):
    x0: float
    y0: float
    cell_size: float
    width: int
    height: int


@dataclass(frozen=True)
class SimpleLattice:
    x0: float
    y0: float
    cell_size: float
    width: int
    height: int


@dataclass(frozen=True)
class RasterStats:
    triangles: int
    degenerate_triangles: int
    empty_triangles: int
    overlapping_triangles: int


class TinRasteriser:
    """Bins triangles to the `side`-cell blocks of `lattice`, then rasterises one block on request."""

    def __init__(
        self,
        vertices,
        triangles,
        lattice: Lattice,
        *,
        side: int,
        check_cancelled: Callable[[], None] | None = None,
    ):
        self.v = np.asarray(vertices, dtype=np.float64)
        self.t = triangles
        self.lat = lattice
        self.side = int(side)
        self._check = check_cancelled or (lambda: None)
        self._degenerate = 0
        self._empty = 0
        self._index()
        self._overlap = np.zeros(len(self.ids), dtype=bool)

    # -- indexing -------------------------------------------------------------------------------
    def _index(self) -> None:
        x0, y0, c = self.lat.x0, self.lat.y0, self.lat.cell_size
        w, h = self.lat.width, self.lat.height
        ids, ranges = [], []
        for s in range(0, len(self.t), RANGE_CHUNK):
            self._check()
            tri = np.asarray(self.t[s : s + RANGE_CHUNK], dtype=np.int64)
            xs, ys = self.v[tri, 0], self.v[tri, 1]
            minx, maxx, miny, maxy = xs.min(1), xs.max(1), ys.min(1), ys.max(1)
            ex, ey = xs[:, 1:] - xs[:, :1], ys[:, 1:] - ys[:, :1]
            area2 = np.abs(ex[:, 0] * ey[:, 1] - ex[:, 1] * ey[:, 0])
            diag2 = (maxx - minx) ** 2 + (maxy - miny) ** 2
            degenerate = (diag2 == 0) | (0.5 * area2 < DEGENERATE_REL * diag2)
            c0 = np.maximum(np.ceil((minx - x0) / c - 0.5), 0)
            c1 = np.minimum(np.floor((maxx - x0) / c - 0.5), w - 1)
            r0 = np.maximum(np.ceil((y0 - maxy) / c - 0.5), 0)
            r1 = np.minimum(np.floor((y0 - miny) / c - 0.5), h - 1)
            empty = ~degenerate & ((c0 > c1) | (r0 > r1))
            keep = ~degenerate & ~empty
            self._degenerate += int(degenerate.sum())
            self._empty += int(empty.sum())
            ids.append(np.flatnonzero(keep).astype(np.int64) + s)
            ranges.append(np.stack([r0[keep], r1[keep], c0[keep], c1[keep]], 1).astype(np.int32))
        self.ids = np.concatenate(ids) if ids else np.zeros(0, np.int64)
        self.rng = np.concatenate(ranges) if ranges else np.zeros((0, 4), np.int32)
        side = self.side
        self.nbx = -(-w // side)
        nblocks = self.nbx * -(-h // side)
        br0, br1 = self.rng[:, 0] // side, self.rng[:, 1] // side
        bc0, bc1 = self.rng[:, 2] // side, self.rng[:, 3] // side
        nbc = (bc1 - bc0 + 1).astype(np.int64)
        per = (br1 - br0 + 1).astype(np.int64) * nbc
        # One (block, triangle) pair per block a triangle's cell range reaches: a triangle that
        # spans several blocks appears in each (spec §9.2 step 2).
        pos = np.repeat(np.arange(len(per), dtype=np.int64), per)
        k = np.arange(len(pos), dtype=np.int64) - np.repeat(np.cumsum(per) - per, per)
        nbc_r = np.repeat(nbc, per)
        block = (
            (np.repeat(br0.astype(np.int64), per) + k // nbc_r) * self.nbx
            + np.repeat(bc0.astype(np.int64), per)
            + k % nbc_r
        )
        del k, nbc_r
        order = np.argsort(block, kind="stable")  # stable: triangle order is kept inside a block
        self._pairs = pos[order]
        self._offsets = np.concatenate([[0], np.cumsum(np.bincount(block, minlength=nblocks))])

    # -- rasterising ------------------------------------------------------------------------------
    def rasterise_window(self, window: Window) -> np.ndarray | None:
        side = self.side
        r_off, c_off = int(window.row_off), int(window.col_off)
        hh, ww = int(window.height), int(window.width)
        if r_off % side or c_off % side or hh > side or ww > side:
            raise ValueError(f"window {window} is not one of the {side}-cell blocks")
        b = (r_off // side) * self.nbx + c_off // side
        if b + 1 >= len(self._offsets):
            return None
        sel = self._pairs[self._offsets[b] : self._offsets[b + 1]]
        if sel.size == 0:
            return None
        rng = self.rng[sel]
        cr0, cr1 = np.maximum(rng[:, 0], r_off), np.minimum(rng[:, 1], r_off + hh - 1)
        cc0, cc1 = np.maximum(rng[:, 2], c_off), np.minimum(rng[:, 3], c_off + ww - 1)
        out = np.full((hh, ww), np.nan, np.float32)
        hit = np.zeros((hh, ww), bool)
        small = ((cr1 - cr0) < SMALL) & ((cc1 - cc0) < SMALL)
        idx = np.flatnonzero(small)
        for s in range(0, len(idx), BATCH):
            self._check()
            part = idx[s : s + BATCH]
            self._small(sel[part], cr0[part], cr1[part], cc0[part], cc1[part], out, hit, r_off, c_off)
        for i in np.flatnonzero(~small):
            self._check()
            self._large(
                int(sel[i]), int(cr0[i]), int(cr1[i]), int(cc0[i]), int(cc1[i]), out, hit, r_off, c_off
            )
        return out if hit.any() else None

    def stats(self) -> RasterStats:
        return RasterStats(len(self.t), self._degenerate, self._empty, int(self._overlap.sum()))

    def _verts(self, pos: np.ndarray) -> np.ndarray:
        tri = np.asarray(self.t[self.ids[pos]], dtype=np.int64)
        return self.v[tri]  # (n, 3 vertices, 3 coords)

    def _bary(self, tv: np.ndarray, rows: np.ndarray, cols: np.ndarray):
        """z and inside at the centres (rows, cols), both broadcast against (n, ...)."""
        lat = self.lat
        e = (slice(None),) + (None,) * (rows.ndim - 1)
        ax, ay, az = tv[:, 0, 0][e], tv[:, 0, 1][e], tv[:, 0, 2][e]
        bx, by = tv[:, 1, 0][e] - ax, tv[:, 1, 1][e] - ay
        cx, cy = tv[:, 2, 0][e] - ax, tv[:, 2, 1][e] - ay
        px = (cols + 0.5) * lat.cell_size + (lat.x0 - ax)
        py = (lat.y0 - ay) - (rows + 0.5) * lat.cell_size
        det = bx * cy - cx * by
        l1 = (px * cy - cx * py) / det
        l2 = (bx * py - px * by) / det
        l0 = 1.0 - l1 - l2
        inside = (l0 >= INSIDE_EPS) & (l1 >= INSIDE_EPS) & (l2 >= INSIDE_EPS)
        return l0 * az + l1 * tv[:, 1, 2][e] + l2 * tv[:, 2, 2][e], inside

    def _small(self, pos, r0, r1, c0, c1, out, hit, r_off, c_off) -> None:
        tv = self._verts(pos)
        rows = (r0[:, None, None] + _STEPS[None, :, None]).astype(np.float64)
        cols = (c0[:, None, None] + _STEPS[None, None, :]).astype(np.float64)
        z, inside = self._bary(tv, rows, cols)
        m = inside & (rows <= r1[:, None, None]) & (cols <= c1[:, None, None])
        rr = np.broadcast_to(rows, m.shape)[m].astype(np.int64) - r_off
        cc = np.broadcast_to(cols, m.shape)[m].astype(np.int64) - c_off
        self._write(out, hit, rr, cc, z[m], np.broadcast_to(pos[:, None, None], m.shape)[m])

    def _large(self, pos, r0, r1, c0, c1, out, hit, r_off, c_off) -> None:
        tv = self._verts(np.array([pos]))
        cols = np.arange(c0, c1 + 1, dtype=np.float64)[None, None, :]
        step = max(1, CHUNK_CELLS // (c1 - c0 + 1))
        for ra in range(r0, r1 + 1, step):
            self._check()
            rows = np.arange(ra, min(ra + step, r1 + 1), dtype=np.float64)[None, :, None]
            z, inside = self._bary(tv, rows, cols)
            rr, cc = np.nonzero(inside[0])
            self._write(out, hit, rr + (ra - r_off), cc + (c0 - c_off), z[0][rr, cc], np.full(len(rr), pos))

    def _write(self, out, hit, rr, cc, z, pos) -> None:
        """Last write wins, in triangle order; a rewrite that moves a cell by > 1 mm marks overlap."""
        if rr.size == 0:
            return
        lin = rr.astype(np.int64) * out.shape[1] + cc
        order = np.argsort(lin, kind="stable")
        lin, z, pos = lin[order], z[order], pos[order]
        same = lin[1:] == lin[:-1]
        self._overlap[pos[1:][same & (np.abs(z[1:] - z[:-1]) > OVERLAP_DZ)]] = True
        flat_out, flat_hit = out.reshape(-1), hit.reshape(-1)
        self._overlap[pos[flat_hit[lin] & (np.abs(flat_out[lin] - z) > OVERLAP_DZ)]] = True
        last = np.ones(lin.size, bool)
        last[:-1] = ~same
        flat_out[lin[last]] = z[last]
        flat_hit[lin[last]] = True


def rasterise_to_array(
    vertices, triangles, lattice: Lattice, *, check_cancelled: Callable[[], None] | None = None
) -> tuple[np.ndarray, RasterStats]:
    """The whole lattice as one window (the preview grid, at most 1024 per side)."""
    if max(lattice.width, lattice.height) > 1024:
        raise ValueError("rasterise_to_array is for preview grids; use TinRasteriser windows")
    r = TinRasteriser(
        vertices, triangles, lattice, side=max(lattice.width, lattice.height), check_cancelled=check_cancelled
    )
    out = r.rasterise_window(Window(0, 0, lattice.width, lattice.height))
    if out is None:
        out = np.full((lattice.height, lattice.width), np.nan, np.float32)
    return out, r.stats()
