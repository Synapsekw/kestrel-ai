"""The `surface_build` core (spec 2026-09-23-volumes §5): a point cloud -> a height grid.

Memory is set by one 512 x 512 block, never by the site:

- pass 0 (auto cell only) streams the points into a coarse occupancy grid to measure the density;
- pass 1 streams them again and appends `(uint32 cell-in-block, float32 z)` records into per-block
  spill files, keeping at most BIN_BUFFER_BYTES in RAM;
- pass 2 reduces one block file at a time (a lexsort, then the per-cell statistic) into raw.tif;
- pass 3 reads each block of raw.tif with a halo, despikes, fills small gaps and writes the final
  grid through `SurfaceWriter`.

No database and no project handle: the job wrapper (`jobs_build.py`) owns the rows and folders.
"""

from __future__ import annotations

import math
import sys
import time
import warnings
from collections.abc import Callable, Iterator
from dataclasses import dataclass
from pathlib import Path

import laspy
import numpy as np
import rasterio
from pyproj import CRS, Transformer
from pyproj.exceptions import CRSError
from rasterio.windows import Window
from scipy import ndimage

from app.surfaces.grid import (
    BLOCK,
    MAX_CELLS,
    GridError,
    GridSpec,
    SurfaceStats,
    SurfaceWriter,
    aligned_grid,
    crs_problem,
)

CHUNK_POINTS = 2_000_000
BIN_BUFFER_BYTES = 256 * 2**20
REDUCE_MAX_POINTS = 16_000_000
READ_CHUNK_RECORDS = 4_000_000
LADDER = (0.02, 0.05, 0.1, 0.2, 0.25, 0.5, 1.0, 2.0)
NOISE_CLASSES = (7, 18)
MAX_FILL_RINGS = 8
FILL_MIN_NEIGHBOURS = 5
DESPIKE_MAX_COUNT = 2
COUNT_GRID_MAX = 16_000_000
EDGE_SAMPLES = 21
METHODS = ("median", "mean", "max", "min")
RECORD = np.dtype([("cell", "<u4"), ("z", "<f4")])
NO_POINTS = "no points are left after filtering (noise classes, withheld points and the Z clip)"
FEET = "feet-based clouds are not supported; export the cloud in a metric CRS"
NO_CRS = "this cloud has no coordinate system; tick “Assume metres” to build it in local coordinates"

_K8 = np.ones((3, 3))
_K8[1, 1] = 0.0

Progress = Callable[[float, str], None]


class BuildRejected(Exception):
    """A build that cannot run, with a code for the API (422) and a message for the operator."""

    def __init__(self, code: str, message: str):
        super().__init__(message)
        self.code, self.message = code, message


@dataclass(frozen=True)
class BuildParams:
    method: str = "median"
    cell_size_m: float | None = None  # None = auto
    hole_fill_max_gap_m: float = 1.0
    despike_m: float | None = 1.0
    z_clip: tuple[float, float] | None = None
    drop_noise_classes: bool = True
    assume_metres: bool = False


@dataclass(frozen=True)
class CloudSource:
    path: Path
    point_count: int
    crs_wkt: str | None
    bounds_native: tuple[float, float, float, float, float, float]  # minx, miny, minz, maxx, maxy, maxz


@dataclass(frozen=True)
class CrsPlan:
    crs_wkt: str | None  # the grid's CRS; None = local metres
    epsg: int | None
    transformer: Transformer | None  # cloud -> grid, geographic clouds only
    reprojected_from_epsg: int | None


@dataclass
class Counters:
    points_read: int = 0
    noise_class: int = 0
    withheld: int = 0
    z_clip: int = 0
    used: int = 0


@dataclass(frozen=True)
class BuildResult:
    spec: GridSpec
    stats: SurfaceStats
    build_stats: dict
    cell_size_m: float
    auto_cell: bool


def utm_epsg(lon: float, lat: float) -> int:
    zone = min(60, max(1, int(math.floor((lon + 180.0) / 6.0)) + 1))
    return (32600 if lat >= 0 else 32700) + zone


def plan_crs(src: CloudSource, assume_metres: bool) -> CrsPlan:
    if src.crs_wkt is None:
        if not assume_metres:
            raise BuildRejected("unsupported_crs", NO_CRS)
        return CrsPlan(None, None, None, None)
    problem = crs_problem(src.crs_wkt)
    try:
        crs = CRS.from_user_input(src.crs_wkt)
    except CRSError as e:
        raise BuildRejected("unsupported_crs", problem) from e
    if crs.is_geographic:
        minx, miny, _, maxx, maxy, _ = src.bounds_native
        epsg = utm_epsg((minx + maxx) / 2, (miny + maxy) / 2)
        target = CRS.from_epsg(epsg)
        return CrsPlan(
            target.to_wkt(), epsg, Transformer.from_crs(crs, target, always_xy=True), crs.to_epsg()
        )
    if problem:
        message = FEET if "is not in metres" in problem else problem
        raise BuildRejected("unsupported_crs", message)
    return CrsPlan(src.crs_wkt, crs.to_epsg(), None, None)


def grid_bounds(src: CloudSource, plan: CrsPlan) -> tuple[float, float, float, float]:
    minx, miny, _, maxx, maxy, _ = src.bounds_native
    if plan.transformer is None:
        return (minx, miny, maxx, maxy)
    t = np.linspace(0.0, 1.0, EDGE_SAMPLES)
    xs = np.concatenate(
        [minx + t * (maxx - minx), minx + t * (maxx - minx), np.full_like(t, minx), np.full_like(t, maxx)]
    )
    ys = np.concatenate(
        [np.full_like(t, miny), np.full_like(t, maxy), miny + t * (maxy - miny), miny + t * (maxy - miny)]
    )
    ux, uy = plan.transformer.transform(xs, ys)
    return (float(np.min(ux)), float(np.min(uy)), float(np.max(ux)), float(np.max(uy)))


def iter_points(
    src: CloudSource,
    plan: CrsPlan,
    params: BuildParams,
    counters: Counters,
    check_cancelled: Callable[[], None],
) -> Iterator[tuple[np.ndarray, np.ndarray, np.ndarray]]:
    """Chunks of kept points in the grid's CRS; every drop is counted by reason."""
    with laspy.open(src.path) as reader:
        for pts in reader.chunk_iterator(CHUNK_POINTS):
            check_cancelled()
            n = len(pts)
            counters.points_read += n
            withheld = np.asarray(pts.withheld).astype(bool)
            keep = ~withheld
            counters.withheld += int(withheld.sum())
            if params.drop_noise_classes:
                noise = np.isin(np.asarray(pts.classification), NOISE_CLASSES) & keep
                counters.noise_class += int(noise.sum())
                keep &= ~noise
            z = np.asarray(pts.z, dtype=np.float64)
            if params.z_clip is not None:
                lo, hi = params.z_clip
                clipped = ((z < lo) | (z > hi)) & keep
                counters.z_clip += int(clipped.sum())
                keep &= ~clipped
            x = np.asarray(pts.x, dtype=np.float64)[keep]
            y = np.asarray(pts.y, dtype=np.float64)[keep]
            z = z[keep]
            if plan.transformer is not None and x.size:
                x, y = (np.asarray(v) for v in plan.transformer.transform(x, y))
            counters.used += int(x.size)
            if x.size:
                yield x, y, z


def measure_density(
    src: CloudSource,
    plan: CrsPlan,
    params: BuildParams,
    bounds: tuple[float, float, float, float],
    *,
    progress: Progress,
    check_cancelled: Callable[[], None],
) -> tuple[float, float]:
    """(points per m², spacing in m) from the median count of the occupied cells of a coarse grid."""
    minx, miny, maxx, maxy = bounds
    area = max((maxx - minx) * (maxy - miny), 1e-9)
    cg = max(1.0, math.sqrt(area / COUNT_GRID_MAX))
    nx = int((maxx - minx) // cg) + 1
    ny = int((maxy - miny) // cg) + 1
    counts = np.zeros(nx * ny, dtype=np.int32)
    counters = Counters()
    total = max(src.point_count, 1)
    for x, y, _ in iter_points(src, plan, params, counters, check_cancelled):
        ix = np.clip(((x - minx) // cg).astype(np.int64), 0, nx - 1)
        iy = np.clip(((maxy - y) // cg).astype(np.int64), 0, ny - 1)
        cells, n = np.unique(iy * nx + ix, return_counts=True)
        counts[cells] += n.astype(np.int32)
        read = counters.points_read
        progress(min(1.0, read / total), f"measuring point density {read / 1e6:.1f} M / {total / 1e6:.1f} M")
    occupied = counts[counts > 0]
    if not occupied.size:
        raise BuildRejected("no_points", NO_POINTS)
    density = float(np.median(occupied)) / (cg * cg)
    return density, 1.0 / math.sqrt(density)


def grid_cells(bounds, cell: float, plan: CrsPlan) -> int:
    spec = aligned_grid(bounds, cell, plan.crs_wkt, plan.epsg, max_cells=sys.maxsize)
    return spec.width * spec.height


def choose_cell(spacing: float, bounds, plan: CrsPlan) -> float:
    """The smallest ladder value at least 2 x spacing (about 4 points per cell) that fits MAX_CELLS."""
    want = 2.0 * spacing * (1.0 - 1e-6)
    start = next((i for i, c in enumerate(LADDER) if c >= want), len(LADDER) - 1)
    for cell in LADDER[start:]:
        if grid_cells(bounds, cell, plan) <= MAX_CELLS:
            return cell
    raise BuildRejected("grid_too_large", grid_too_large_message(bounds, LADDER[-1], plan))


def smallest_fitting_cell(bounds, plan: CrsPlan) -> float:
    minx, miny, maxx, maxy = bounds
    cell = max(0.01, math.ceil(math.sqrt((maxx - minx) * (maxy - miny) / MAX_CELLS) * 100) / 100)
    while grid_cells(bounds, cell, plan) > MAX_CELLS:
        cell = round(cell + 0.01, 2)
    return cell


def grid_too_large_message(bounds, cell: float, plan: CrsPlan) -> str:
    n = grid_cells(bounds, cell, plan)
    return (
        f"a {cell} m surface of this cloud would need {n:,} cells, more than {MAX_CELLS:,}; "
        f"the smallest cell size that fits is {smallest_fitting_cell(bounds, plan)} m"
    )


def fill_rings(cell: float, gap_m: float) -> int:
    if not gap_m:
        return 0
    return min(MAX_FILL_RINGS, math.ceil(round(gap_m / (2.0 * cell), 9)))


def reduce_cells(cells: np.ndarray, z: np.ndarray, method: str) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    """(unique cells, statistic per cell, count per cell). Median of an even count is the mean of
    the two middle values."""
    order = np.lexsort((z, cells))
    cs, zs = cells[order], z[order].astype(np.float64)
    starts = np.flatnonzero(np.r_[True, cs[1:] != cs[:-1]])
    counts = np.diff(np.r_[starts, cs.size])
    if method == "median":
        hi = starts + counts // 2
        lo = starts + np.maximum(counts // 2 - 1, 0)
        values = np.where(counts % 2 == 1, zs[hi], 0.5 * (zs[lo] + zs[hi]))
    elif method == "mean":
        values = np.add.reduceat(zs, starts) / counts
    elif method == "max":
        values = zs[starts + counts - 1]
    elif method == "min":
        values = zs[starts]
    else:
        raise BuildRejected("invalid_build_request", f"unknown method {method!r}")
    return cs[starts], values, counts


def _neighbour_median(z: np.ndarray) -> np.ndarray:
    h, w = z.shape
    p = np.pad(z, 1, constant_values=np.nan)
    stack = np.stack(
        [p[1 + dr : 1 + dr + h, 1 + dc : 1 + dc + w] for dr in (-1, 0, 1) for dc in (-1, 0, 1) if dr or dc]
    )
    with warnings.catch_warnings():
        warnings.simplefilter("ignore", RuntimeWarning)
        return np.nanmedian(stack, axis=0)


def despike_and_fill(
    z: np.ndarray, counts: np.ndarray, *, despike_m: float | None, rings: int
) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    """(z, despiked mask, filled mask). Despike: a cell with <= 2 points whose height is more than
    `despike_m` from the median of its valid 8-neighbours becomes NaN. Fill: `rings` passes, each
    giving a NaN cell the mean of its valid 8-neighbours when at least 5 of the 8 are valid, so an
    enclosed gap closes and a straight data edge (3 valid neighbours) never grows."""
    z = np.array(z, dtype=np.float64, copy=True)
    counts = np.nan_to_num(np.asarray(counts, dtype=np.float64), nan=0.0)
    despiked = np.zeros(z.shape, dtype=bool)
    if despike_m is not None:
        med = _neighbour_median(z)
        with np.errstate(invalid="ignore"):
            despiked = np.isfinite(z) & (counts <= DESPIKE_MAX_COUNT) & (np.abs(z - med) > despike_m)
        z[despiked] = np.nan
    filled = np.zeros(z.shape, dtype=bool)
    for _ in range(rings):
        valid = np.isfinite(z)
        total = ndimage.convolve(np.where(valid, z, 0.0), _K8, mode="constant", cval=0.0)
        n = ndimage.convolve(valid.astype(np.float64), _K8, mode="constant", cval=0.0)
        ok = ~valid & (n >= FILL_MIN_NEIGHBOURS)
        if not ok.any():
            break
        z[ok] = total[ok] / n[ok]
        filled |= ok
    return z, despiked, filled


class _Binner:
    """Per-block record buffers; the largest are appended to `<br>_<bc>.bin` whenever the total
    passes the cap, until it is under half the cap. One file handle is open at a time."""

    def __init__(self, folder: Path, spec: GridSpec, cap: int):
        self.folder, self.spec, self.cap = folder, spec, cap
        self.nbx = -(-spec.width // BLOCK)
        self.nby = -(-spec.height // BLOCK)
        self.buf: dict[int, list[np.ndarray]] = {}
        self.size: dict[int, int] = {}
        self.total = 0
        self.nonempty: set[int] = set()

    def path(self, key: int) -> Path:
        return self.folder / f"{key // self.nbx}_{key % self.nbx}.bin"

    def add(self, x: np.ndarray, y: np.ndarray, z: np.ndarray) -> None:
        s = self.spec
        col = np.clip(np.floor((x - s.x0) / s.cell_size).astype(np.int64), 0, s.width - 1)
        row = np.clip(np.floor((s.y0 - y) / s.cell_size).astype(np.int64), 0, s.height - 1)
        block = (row // BLOCK) * self.nbx + col // BLOCK
        rec = np.empty(x.size, dtype=RECORD)
        rec["cell"] = ((row % BLOCK) * BLOCK + col % BLOCK).astype(np.uint32)
        rec["z"] = z.astype(np.float32)
        order = np.argsort(block, kind="stable")
        block, rec = block[order], rec[order]
        starts = np.flatnonzero(np.r_[True, block[1:] != block[:-1]])
        for s0, s1 in zip(starts, np.r_[starts[1:], block.size], strict=True):
            key, part = int(block[s0]), rec[s0:s1]
            self.buf.setdefault(key, []).append(part)
            self.size[key] = self.size.get(key, 0) + part.nbytes
            self.total += part.nbytes
            self.nonempty.add(key)
        if self.total > self.cap:
            for key in sorted(self.size, key=self.size.__getitem__, reverse=True):
                if self.total <= self.cap // 2:
                    break
                self._write(key)

    def _write(self, key: int) -> None:
        parts = self.buf.pop(key, [])
        self.total -= self.size.pop(key, 0)
        if parts:
            with open(self.path(key), "ab") as f:
                for part in parts:
                    f.write(part.tobytes())

    def flush(self) -> None:
        for key in list(self.buf):
            self._write(key)


def _records(path: Path) -> Iterator[np.ndarray]:
    with open(path, "rb") as f:
        while True:
            chunk = np.fromfile(f, dtype=RECORD, count=READ_CHUNK_RECORDS)
            if not chunk.size:
                return
            yield chunk


def _band(path: Path, row_lo: int, row_hi: int) -> np.ndarray:
    parts = []
    for chunk in _records(path):
        rows = chunk["cell"] // BLOCK
        parts.append(chunk[(rows >= row_lo) & (rows < row_hi)])
    return np.concatenate(parts) if parts else np.empty(0, dtype=RECORD)


def _band_count(path: Path, row_lo: int, row_hi: int) -> int:
    n = 0
    for chunk in _records(path):
        rows = chunk["cell"] // BLOCK
        n += int(((rows >= row_lo) & (rows < row_hi)).sum())
    return n


def _reduced(path: Path, method: str, row_lo: int = 0, row_hi: int = BLOCK, n: int | None = None):
    """Reduce one block file, splitting it into row bands (512 / 2^k rows) so that no step holds
    more than REDUCE_MAX_POINTS points."""
    if n is None:
        n = path.stat().st_size // RECORD.itemsize
    if n <= REDUCE_MAX_POINTS or row_hi - row_lo == 1:
        rec = (
            np.fromfile(path, dtype=RECORD) if (row_lo, row_hi) == (0, BLOCK) else _band(path, row_lo, row_hi)
        )
        if rec.size:
            yield reduce_cells(rec["cell"], rec["z"], method)
        return
    mid = (row_lo + row_hi) // 2
    for lo, hi in ((row_lo, mid), (mid, row_hi)):
        yield from _reduced(path, method, lo, hi, _band_count(path, lo, hi))


def _block_window(spec: GridSpec, key: int, nbx: int) -> Window:
    br, bc = divmod(key, nbx)
    return Window(
        bc * BLOCK, br * BLOCK, min(BLOCK, spec.width - bc * BLOCK), min(BLOCK, spec.height - br * BLOCK)
    )


def _reduce_pass(
    binner: _Binner, spec: GridSpec, raw_path: Path, method: str, progress, check_cancelled
) -> None:
    keys = sorted(binner.nonempty)
    with rasterio.open(
        raw_path,
        "w",
        driver="GTiff",
        width=spec.width,
        height=spec.height,
        count=2,
        dtype="float32",
        nodata=float("nan"),
        tiled=True,
        blockxsize=BLOCK,
        blockysize=BLOCK,
        crs=spec.crs_wkt,
        transform=spec.transform,
        BIGTIFF="IF_SAFER",
        SPARSE_OK="TRUE",
    ) as raw:
        for i, key in enumerate(keys, 1):
            check_cancelled()
            win = _block_window(spec, key, binner.nbx)
            zb = np.full(BLOCK * BLOCK, np.nan, dtype=np.float32)
            cb = np.zeros(BLOCK * BLOCK, dtype=np.float32)
            for cells, values, counts in _reduced(binner.path(key), method):
                zb[cells] = values
                cb[cells] = counts
            h, w = int(win.height), int(win.width)
            raw.write(zb.reshape(BLOCK, BLOCK)[:h, :w], 1, window=win)
            raw.write(cb.reshape(BLOCK, BLOCK)[:h, :w], 2, window=win)
            progress(i / len(keys), f"gridding block {i} / {len(keys)}")


def _read_padded(ds, band: int, win: Window, pad: int, spec: GridSpec) -> np.ndarray:
    c0, r0, w, h = int(win.col_off), int(win.row_off), int(win.width), int(win.height)
    out = np.full((h + 2 * pad, w + 2 * pad), np.nan, dtype=np.float64)
    ic0, ir0 = max(0, c0 - pad), max(0, r0 - pad)
    ic1, ir1 = min(spec.width, c0 + w + pad), min(spec.height, r0 + h + pad)
    data = ds.read(band, window=Window(ic0, ir0, ic1 - ic0, ir1 - ir0))
    out[ir0 - (r0 - pad) : ir1 - (r0 - pad), ic0 - (c0 - pad) : ic1 - (c0 - pad)] = data
    return out


def _finish_pass(
    raw_path: Path,
    spec: GridSpec,
    out_path: Path,
    params: BuildParams,
    rings: int,
    binner: _Binner,
    progress,
    check_cancelled,
) -> tuple[SurfaceStats, int, int]:
    halo = rings + 2  # despike reads one ring, each fill pass one more: seams stay exact
    todo = sorted(
        {
            (br + dr) * binner.nbx + bc + dc
            for key in binner.nonempty
            for br, bc in [divmod(key, binner.nbx)]
            for dr in (-1, 0, 1)
            for dc in (-1, 0, 1)
            if 0 <= br + dr < binner.nby and 0 <= bc + dc < binner.nbx
        }
    )
    despiked = filled = 0
    with (
        rasterio.open(raw_path) as raw,
        SurfaceWriter(out_path, spec, check_cancelled=check_cancelled) as writer,
    ):
        for i, key in enumerate(todo, 1):
            win = _block_window(spec, key, binner.nbx)
            z = _read_padded(raw, 1, win, halo, spec)
            counts = _read_padded(raw, 2, win, halo, spec)
            z, d, f = despike_and_fill(z, counts, despike_m=params.despike_m, rings=rings)
            inner = (slice(halo, halo + int(win.height)), slice(halo, halo + int(win.width)))
            despiked += int(d[inner].sum())
            filled += int(f[inner].sum())
            writer.write_block(win, z[inner])
            progress(i / len(todo), f"filling gaps {i} / {len(todo)}")
        progress(1.0, "building zoom levels")
        stats = writer.finish()
    return stats, despiked, filled


def build_surface(
    src: CloudSource,
    params: BuildParams,
    out_path: Path,
    work_dir: Path,
    *,
    progress: Progress,
    check_cancelled: Callable[[], None],
) -> BuildResult:
    """Build `out_path` from the cloud. `work_dir` holds the spill files and raw.tif; the caller
    removes it in every outcome."""
    t0 = time.perf_counter()
    if params.method not in METHODS:
        raise BuildRejected("invalid_build_request", f"unknown method {params.method!r}")
    plan = plan_crs(src, params.assume_metres)
    bounds = grid_bounds(src, plan)
    auto = params.cell_size_m is None
    density = spacing = None
    lead = 0.0
    if auto:
        lead = 0.15
        density, spacing = measure_density(
            src,
            plan,
            params,
            bounds,
            progress=lambda f, m: progress(lead * f, m),
            check_cancelled=check_cancelled,
        )
        cell = choose_cell(spacing, bounds, plan)
    else:
        cell = float(params.cell_size_m)
    try:
        spec = aligned_grid(bounds, cell, plan.crs_wkt, plan.epsg, max_cells=MAX_CELLS)
    except GridError as e:
        raise BuildRejected("grid_too_large", grid_too_large_message(bounds, cell, plan)) from e
    bins = work_dir / "bins"
    bins.mkdir(parents=True, exist_ok=True)
    for stale in bins.iterdir():  # a crashed earlier build's spill files must not merge in
        if stale.is_file():
            stale.unlink()
    counters = Counters()
    binner = _Binner(bins, spec, BIN_BUFFER_BYTES)
    total = max(src.point_count, 1)
    for x, y, z in iter_points(src, plan, params, counters, check_cancelled):
        binner.add(x, y, z)
        read = counters.points_read
        progress(
            lead + (0.45 - lead) * min(1.0, read / total),
            f"reading points {read / 1e6:.1f} M / {total / 1e6:.1f} M",
        )
    binner.flush()
    if counters.used == 0:
        raise BuildRejected("no_points", NO_POINTS)
    raw = work_dir / "raw.tif"
    _reduce_pass(binner, spec, raw, params.method, lambda f, m: progress(0.45 + 0.35 * f, m), check_cancelled)
    rings = fill_rings(cell, params.hole_fill_max_gap_m)

    def finish_progress(f: float, m: str) -> None:
        progress(0.95 if m == "building zoom levels" else min(0.95, 0.80 + 0.15 * f), m)

    stats, despiked, filled = _finish_pass(
        raw, spec, out_path, params, rings, binner, finish_progress, check_cancelled
    )
    build_stats = {
        "points_read": counters.points_read,
        "points_used": counters.used,
        "points_dropped": {
            "noise_class": counters.noise_class,
            "withheld": counters.withheld,
            "z_clip": counters.z_clip,
        },
        "density_per_m2": density,
        "spacing_m": spacing,
        "auto_cell": auto,
        "cells_valid": stats.valid_cells,
        "cells_despiked": despiked,
        "cells_filled": filled,
        "z_p02": stats.z_p02,
        "z_p98": stats.z_p98,
        "reprojected_from_epsg": plan.reprojected_from_epsg,
        "build_s": round(time.perf_counter() - t0, 2),
    }
    return BuildResult(spec, stats, build_stats, cell, auto)
