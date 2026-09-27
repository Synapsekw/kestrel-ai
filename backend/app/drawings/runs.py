"""Flattened linework of a vector drawing and its bucket index (spec §8.1 storage, §8.4 lookup).

lines.f64     (N, 2) float64 vertices in drawing coordinates
runs.i64      (K + 1,) int64 offsets: run k is lines[runs[k]:runs[k+1]] (every run has >= 2 vertices)
runlayer.i32  (K,) int32 index into the drawing's layer list
runbbox.f64   (K, 4) float64 minx, miny, maxx, maxy of each run            (build_index)
buckets.i64   GRID*GRID + 1 cell offsets, then the run ids of every cell    (build_index)
meta.json     {"runs": K, "vertices": N, "extent": [minx, miny, maxx, maxy] | null, "grid": 64, ...}
labels.json   [{text, x, y, height, rotation, layer}], at most 20 000 (the readers write it)

Writers stream to disk; the index is built over memory-mapped runs in chunks of 65 536 runs.
"""

from __future__ import annotations

import gc
import math
import traceback
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw

from app.surfaces.design.store import _map, read_json, write_json

GRID = 64
CHUNK_RUNS = 65_536
LABEL_CAP = 20_000
THUMB_VERTICES = 200_000
THUMB_COLOUR = (60, 200, 230, 255)


def _noop(*_args) -> None:
    return None


def _drop_frames(exc: BaseException) -> None:
    """Clear the locals of the finished frames an in-flight exception carries. A memmap view held by
    one of them would keep its file open on Windows, and the job's cleanup could not remove the
    folder while the exception is still being handled."""
    traceback.clear_frames(exc.__traceback__)


class RunWriter:
    def __init__(self, folder: Path):
        folder.mkdir(parents=False, exist_ok=True)  # never recreate a deleted parent
        self.folder = folder
        self._files = []
        try:
            for n in ("lines.f64", "runs.i64", "runlayer.i32"):
                self._files.append((folder / n).open("wb"))
        except BaseException:
            self.abort()
            raise
        self._lines, self._runs, self._layer = self._files
        self._runs.write(np.zeros(1, np.int64).tobytes())
        self.vertex_count = self.run_count = 0
        self._lo, self._hi = np.full(2, np.inf), np.full(2, -np.inf)

    def add(self, xy, layer: int) -> None:
        a = np.ascontiguousarray(xy, dtype=np.float64).reshape(-1, 2)
        if len(a) < 2 or not np.isfinite(a).all():
            return
        self.add_many(a, np.array([len(a)], np.int64), np.array([layer], np.int32))

    def add_many(self, xy, lengths, layers) -> None:
        """Append runs whose vertices are `xy` in order; every length must be >= 2."""
        a = np.ascontiguousarray(xy, dtype=np.float64).reshape(-1, 2)
        lengths = np.asarray(lengths, np.int64)
        if not len(lengths):
            return
        self._lines.write(a.tobytes())
        self._runs.write((self.vertex_count + np.cumsum(lengths)).astype(np.int64).tobytes())
        self._layer.write(np.asarray(layers, np.int32).tobytes())
        self.vertex_count += len(a)
        self.run_count += len(lengths)
        self._lo, self._hi = np.minimum(self._lo, a.min(0)), np.maximum(self._hi, a.max(0))

    def abort(self) -> None:
        for f in self._files:
            if not f.closed:
                f.close()

    def close(self, **extra) -> dict:
        self.abort()
        extent = [float(v) for v in (*self._lo, *self._hi)] if self.run_count else None
        meta = {
            "runs": self.run_count,
            "vertices": self.vertex_count,
            "extent": extent,
            "grid": GRID,
            **extra,
        }
        write_json(self.folder / "meta.json", meta)
        return meta


class RunStore:
    """Memory-mapped runs. On Windows a live memmap keeps its file open: call release() before a
    delete or a move."""

    def __init__(self, folder: Path):
        self.meta = read_json(folder / "meta.json")
        self.lines = _map(folder / "lines.f64", np.float64, 2)
        self.runs = _map(folder / "runs.i64", np.int64, 1)
        self.layer = _map(folder / "runlayer.i32", np.int32, 1)

    @classmethod
    def open(cls, folder: Path) -> RunStore:
        return cls(folder)

    @property
    def run_count(self) -> int:
        return max(len(self.runs) - 1, 0)

    def release(self) -> None:
        self.lines = self.runs = self.layer = None
        gc.collect()


def run_bboxes(rs: RunStore, a: int, b: int) -> np.ndarray:
    lo, hi = int(rs.runs[a]), int(rs.runs[b])
    pts = np.asarray(rs.lines[lo:hi])
    starts = np.asarray(rs.runs[a:b]) - lo
    return np.stack(
        [
            np.minimum.reduceat(pts[:, 0], starts),
            np.minimum.reduceat(pts[:, 1], starts),
            np.maximum.reduceat(pts[:, 0], starts),
            np.maximum.reduceat(pts[:, 1], starts),
        ],
        axis=1,
    )


def _copy_chunk(rs: RunStore, w: RunWriter, remap: np.ndarray, a: int, b: int) -> None:
    new = remap[np.asarray(rs.layer[a:b])]
    keep = new >= 0
    if not keep.any():
        return
    offs = np.asarray(rs.runs[a : b + 1])
    lens = np.diff(offs)
    pts = np.asarray(rs.lines[offs[0] : offs[-1]])
    w.add_many(pts[np.repeat(keep, lens)], lens[keep], new[keep])


def copy_runs(
    src: Path, dst: Path, remap: np.ndarray, *, check_cancelled, progress=_noop, **meta_extra
) -> dict:
    """Stream the runs whose layer `remap`s to >= 0 into `dst`, in chunks of CHUNK_RUNS runs.
    `progress(fraction)` after each chunk. Every memmap is dropped on the way out, success or not."""
    rs, w = RunStore.open(src), None
    try:
        w = RunWriter(dst)
        k = rs.run_count
        for a in range(0, k, CHUNK_RUNS):
            check_cancelled()
            b = min(k, a + CHUNK_RUNS)
            _copy_chunk(rs, w, remap, a, b)
            progress(b / k)
    except BaseException as e:
        if w is not None:
            w.abort()
        _drop_frames(e)
        raise
    finally:
        rs.release()
    return w.close(**meta_extra)


def _cells(bb: np.ndarray, extent, cw: float, ch: float) -> tuple[np.ndarray, ...]:
    x0, y0 = extent[0], extent[1]
    cx0 = np.clip(np.floor((bb[:, 0] - x0) / cw), 0, GRID - 1).astype(np.int64)
    cy0 = np.clip(np.floor((bb[:, 1] - y0) / ch), 0, GRID - 1).astype(np.int64)
    cx1 = np.clip(np.floor((bb[:, 2] - x0) / cw), 0, GRID - 1).astype(np.int64)
    cy1 = np.clip(np.floor((bb[:, 3] - y0) / ch), 0, GRID - 1).astype(np.int64)
    return cx0, cy0, cx1, cy1


def _cell_size(extent) -> tuple[float, float]:
    return max(extent[2] - extent[0], 1e-9) / GRID, max(extent[3] - extent[1], 1e-9) / GRID


def build_index(folder: Path, *, check_cancelled=_noop, progress=_noop) -> None:
    """runbbox.f64 and buckets.i64 in three passes over the memory-mapped runs (bboxes, count, fill),
    in chunks of CHUNK_RUNS runs. `progress(fraction)` after each chunk. Every memmap is dropped on
    the way out, success or not, so a cancelled build's folder can be removed on Windows."""
    rs, bbox = RunStore.open(folder), None
    try:
        k, extent = rs.run_count, rs.meta["extent"] or [0.0, 0.0, 0.0, 0.0]
        cw, ch = _cell_size(extent)
        chunks = [(a, min(k, a + CHUNK_RUNS)) for a in range(0, k, CHUNK_RUNS)]
        steps, done = 3 * len(chunks), 0
        with (folder / "runbbox.f64").open("wb") as f:
            for a, b in chunks:
                check_cancelled()
                f.write(run_bboxes(rs, a, b).tobytes())
                done += 1
                progress(done / steps)
        rs.release()
        bbox = _map(folder / "runbbox.f64", np.float64, 4)
        counts = np.zeros(GRID * GRID, np.int64)
        for a, b in chunks:
            check_cancelled()
            _count_chunk(counts, np.asarray(bbox[a:b]), extent, cw, ch)
            done += 1
            progress(done / steps)
        offsets = np.zeros(GRID * GRID + 1, np.int64)
        np.cumsum(counts, out=offsets[1:])
        ids = np.empty(int(offsets[-1]), np.int64)
        cursor = offsets[:-1].copy()
        for a, b in chunks:
            check_cancelled()
            _fill_chunk(ids, cursor, np.asarray(bbox[a:b]), a, extent, cw, ch)
            done += 1
            progress(done / steps)
    except BaseException as e:
        _drop_frames(e)
        raise
    finally:
        rs.release()
        bbox = None
        gc.collect()
    with (folder / "buckets.i64").open("wb") as f:
        f.write(offsets.tobytes())
        f.write(ids.tobytes())
    if not chunks:
        progress(1.0)


def _count_chunk(counts: np.ndarray, bb: np.ndarray, extent, cw: float, ch: float) -> None:
    cx0, cy0, cx1, cy1 = _cells(bb, extent, cw, ch)
    single = (cx0 == cx1) & (cy0 == cy1)
    np.add.at(counts, cy0[single] * GRID + cx0[single], 1)
    for i in np.flatnonzero(~single):
        counts.reshape(GRID, GRID)[cy0[i] : cy1[i] + 1, cx0[i] : cx1[i] + 1] += 1


def _fill_chunk(
    ids: np.ndarray, cursor: np.ndarray, bb: np.ndarray, a: int, extent, cw: float, ch: float
) -> None:
    cx0, cy0, cx1, cy1 = _cells(bb, extent, cw, ch)
    single = (cx0 == cx1) & (cy0 == cy1)
    cell, rid = cy0[single] * GRID + cx0[single], np.arange(a, a + len(bb), dtype=np.int64)[single]
    order = np.argsort(cell, kind="stable")
    cs = cell[order]
    rank = np.arange(len(cs)) - np.searchsorted(cs, cs, side="left")
    ids[cursor[cs] + rank] = rid[order]
    np.add.at(cursor, cs, 1)
    for i in np.flatnonzero(~single):
        for cy in range(cy0[i], cy1[i] + 1):
            for cx in range(cx0[i], cx1[i] + 1):
                c = cy * GRID + cx
                ids[cursor[c]] = a + i
                cursor[c] += 1


class BucketIndex:
    def __init__(self, folder: Path):
        self.extent = read_json(folder / "meta.json")["extent"]
        raw = _map(folder / "buckets.i64", np.int64, 1)
        # A real copy, not a memmap view: release() must be able to drop `buckets.i64` entirely
        # (F9), so a deleted drawing's folder can be removed right after on Windows.
        self.offsets = np.array(raw[: GRID * GRID + 1])
        self.ids = raw[GRID * GRID + 1 :]
        self.bbox = _map(folder / "runbbox.f64", np.float64, 4)

    def query(self, box) -> np.ndarray:
        if self.extent is None or not len(self.bbox):
            return np.zeros(0, np.int64)
        bx0, by0, bx1, by1 = box
        x0, y0, x1, y1 = self.extent
        if bx0 > x1 or bx1 < x0 or by0 > y1 or by1 < y0:
            return np.zeros(0, np.int64)
        cw, ch = _cell_size(self.extent)
        c0, c1 = (int(np.clip(math.floor((v - x0) / cw), 0, GRID - 1)) for v in (bx0, bx1))
        r0, r1 = (int(np.clip(math.floor((v - y0) / ch), 0, GRID - 1)) for v in (by0, by1))
        parts = [
            self.ids[self.offsets[r * GRID + c0] : self.offsets[r * GRID + c1 + 1]] for r in range(r0, r1 + 1)
        ]
        cand = np.unique(np.concatenate(parts)) if parts else np.zeros(0, np.int64)
        b = np.asarray(self.bbox[cand])
        hit = (b[:, 0] <= bx1) & (b[:, 2] >= bx0) & (b[:, 1] <= by1) & (b[:, 3] >= by0)
        return cand[hit]

    def release(self) -> None:
        self.offsets = self.ids = self.bbox = None
        gc.collect()


def extent_with_labels(extent, labels: list[dict]) -> list[float] | None:
    xs = [p["x"] for p in labels]
    ys = [p["y"] for p in labels]
    if extent is not None:
        xs += [extent[0], extent[2]]
        ys += [extent[1], extent[3]]
    if not xs:
        return None
    return [float(min(xs)), float(min(ys)), float(max(xs)), float(max(ys))]


def runs_thumbnail(folder: Path, out: Path, size: int = 160) -> None:
    """At most 200 000 vertices (every n-th run), cyan on transparent, square-scaled."""
    rs = RunStore.open(folder)
    try:
        ext = rs.meta["extent"]
        if ext is None:
            return
        w, h = max(ext[2] - ext[0], 1e-9), max(ext[3] - ext[1], 1e-9)
        scale = (size - 1) / max(w, h)
        img = Image.new("RGBA", (int(round(w * scale)) + 1, int(round(h * scale)) + 1), (0, 0, 0, 0))
        draw = ImageDraw.Draw(img)
        step = max(1, math.ceil(rs.meta["vertices"] / THUMB_VERTICES))
        for r in range(0, rs.run_count, step):
            pts = np.asarray(rs.lines[int(rs.runs[r]) : int(rs.runs[r + 1])])
            xy = np.column_stack([(pts[:, 0] - ext[0]) * scale, (ext[3] - pts[:, 1]) * scale])
            draw.line([tuple(p) for p in xy], fill=THUMB_COLOUR, width=1)
        out.parent.mkdir(parents=False, exist_ok=True)
        img.save(out)
    except BaseException as e:
        _drop_frames(e)
        raise
    finally:
        rs.release()
