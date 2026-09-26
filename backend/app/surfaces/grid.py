"""The surface grid convention (spec 2026-09-23-volumes §4), the one grid interface of S1-S3.

A surface is a single-band float32 GeoTIFF: NaN is the only nodata signal (no internal mask),
512 x 512 tiles, DEFLATE with PREDICTOR 3, north-up, square cells, the origin on integer
multiples of the cell size, and NaN-aware average overviews. Two surfaces with the same cell and
CRS therefore share cells exactly.

Pure: rasterio, numpy, pyproj and affine only. No database, no project handle. S3 imports this
module; the names below are frozen.
"""

from __future__ import annotations

import math
import os
from collections.abc import Callable, Iterator
from dataclasses import dataclass
from pathlib import Path

import numpy as np
import rasterio
from affine import Affine
from pyproj import CRS, Transformer
from pyproj.exceptions import CRSError
from rasterio.enums import Compression, MaskFlags, Resampling
from rasterio.windows import Window

BLOCK: int = 512  # internal TIFF tile and write unit
MAX_READ: int = 2048  # largest output side of any single read
MAX_CELLS: int = 500_000_000  # width * height ceiling (2 GB of raw float32)
OVERVIEW_MIN_SIDE = 256
STATS_SAMPLE = 1_000_000  # cells considered for the p02/p98 sample
LATTICE_TOL = 1e-6

PROFILE = {
    "driver": "GTiff",
    "count": 1,
    "dtype": "float32",
    "nodata": float("nan"),
    "tiled": True,
    "blockxsize": BLOCK,
    "blockysize": BLOCK,
    "compress": "deflate",
    "predictor": 3,
    "BIGTIFF": "IF_SAFER",
    "SPARSE_OK": "TRUE",
}


class GridError(ValueError):
    """Geographic CRS, bad cell size, too many cells, misaligned write, oversized read."""


def _q(v: float) -> float:
    """Round a quotient to 1e-9 first, so 12.3 / 0.1 is 123 and not 122.99999999999999."""
    return round(v, 9)


def crs_problem(crs_wkt: str | None) -> str | None:
    """None when the CRS is absent (local metres) or projected in metres; otherwise why not."""
    if crs_wkt is None:
        return None
    try:
        crs = CRS.from_user_input(crs_wkt)
    except CRSError as e:
        return f"the coordinate system could not be read: {e}"
    if crs.is_geographic:
        return "the coordinate system is geographic (degrees); a surface needs a projected system in metres"
    if not crs.is_projected:
        return f"the coordinate system {crs.name} is not a projected system"
    unit = crs.axis_info[0].unit_conversion_factor if crs.axis_info else 1.0
    if abs(unit - 1.0) > 1e-9:
        return f"the coordinate system {crs.name} is not in metres"
    return None


def _same_crs(a: str | None, b: str | None) -> bool:
    if a is None or b is None:
        return a is None and b is None
    return a == b or CRS.from_user_input(a).equals(CRS.from_user_input(b))


@dataclass(frozen=True)
class GridSpec:
    crs_wkt: str | None  # None = local metres
    epsg: int | None
    cell_size: float  # metres
    x0: float  # west edge of column 0
    y0: float  # north edge of row 0
    width: int
    height: int

    @property
    def transform(self) -> Affine:
        return Affine(self.cell_size, 0.0, self.x0, 0.0, -self.cell_size, self.y0)

    @property
    def geotransform(self) -> tuple[float, float, float, float, float, float]:
        return (self.x0, self.cell_size, 0.0, self.y0, 0.0, -self.cell_size)

    @property
    def bounds(self) -> tuple[float, float, float, float]:
        c = self.cell_size
        return (self.x0, self.y0 - self.height * c, self.x0 + self.width * c, self.y0)

    def window_transform(self, window: Window) -> Affine:
        c = self.cell_size
        return Affine(c, 0.0, self.x0 + int(window.col_off) * c, 0.0, -c, self.y0 - int(window.row_off) * c)

    def window_for_bounds(self, bounds: tuple[float, float, float, float], *, pad: int = 0) -> Window:
        """The cells whose area meets `bounds`, grown by `pad` cells and clipped to the grid;
        width or height 0 when disjoint."""
        c = self.cell_size
        minx, miny, maxx, maxy = bounds
        c0 = math.floor(_q((minx - self.x0) / c))
        c1 = max(math.ceil(_q((maxx - self.x0) / c)), c0 + 1)
        r0 = math.floor(_q((self.y0 - maxy) / c))
        r1 = max(math.ceil(_q((self.y0 - miny) / c)), r0 + 1)
        c0, r0 = max(c0 - pad, 0), max(r0 - pad, 0)
        c1, r1 = min(c1 + pad, self.width), min(r1 + pad, self.height)
        if c1 <= c0 or r1 <= r0:
            return Window(min(c0, self.width), min(r0, self.height), 0, 0)
        return Window(c0, r0, c1 - c0, r1 - r0)

    def cell_centres(self, window: Window) -> tuple[np.ndarray, np.ndarray]:
        c = self.cell_size
        cols = int(window.col_off) + np.arange(int(window.width), dtype=np.float64) + 0.5
        rows = int(window.row_off) + np.arange(int(window.height), dtype=np.float64) + 0.5
        xs, ys = np.meshgrid(self.x0 + cols * c, self.y0 - rows * c)
        return xs, ys

    def crop(self, window: Window) -> GridSpec:
        c = self.cell_size
        return GridSpec(
            self.crs_wkt,
            self.epsg,
            c,
            self.x0 + int(window.col_off) * c,
            self.y0 - int(window.row_off) * c,
            int(window.width),
            int(window.height),
        )

    def to_json(self) -> dict:
        return {
            "crs_wkt": self.crs_wkt,
            "epsg": self.epsg,
            "cell_size": self.cell_size,
            "x0": self.x0,
            "y0": self.y0,
            "width": self.width,
            "height": self.height,
        }

    @classmethod
    def from_json(cls, d: dict) -> GridSpec:
        return cls(
            d["crs_wkt"],
            d["epsg"],
            float(d["cell_size"]),
            float(d["x0"]),
            float(d["y0"]),
            int(d["width"]),
            int(d["height"]),
        )

    @classmethod
    def from_dataset(cls, ds) -> GridSpec:
        t = ds.transform
        if t.b != 0 or t.d != 0 or t.a <= 0 or t.e >= 0 or not math.isclose(t.a, -t.e, rel_tol=1e-9):
            raise GridError("the raster is not north-up with square cells")
        crs_wkt = ds.crs.to_wkt() if ds.crs else None
        epsg = ds.crs.to_epsg() if ds.crs else None
        return cls(crs_wkt, epsg, float(t.a), float(t.c), float(t.f), int(ds.width), int(ds.height))


def aligned_grid(
    bounds: tuple[float, float, float, float],
    cell_size: float,
    crs_wkt: str | None,
    epsg: int | None,
    *,
    max_cells: int = MAX_CELLS,
) -> GridSpec:
    """The grid on the lattice of integer multiples of `cell_size` that holds `bounds`; a point on
    maxx or miny still lands inside."""
    if not cell_size > 0:
        raise GridError(f"cell size must be positive, got {cell_size}")
    problem = crs_problem(crs_wkt)
    if problem:
        raise GridError(problem)
    c = float(cell_size)
    minx, miny, maxx, maxy = bounds
    x0 = math.floor(_q(minx / c)) * c
    y0 = math.ceil(_q(maxy / c)) * c
    width = math.floor(_q((maxx - x0) / c)) + 1
    height = math.floor(_q((y0 - miny) / c)) + 1
    if width * height > max_cells:
        raise GridError(f"{width} x {height} cells at {c} m is more than {max_cells} cells")
    return GridSpec(crs_wkt, epsg, c, x0, y0, width, height)


def same_lattice(a: GridSpec, b: GridSpec, *, tol: float = LATTICE_TOL) -> bool:
    if not _same_crs(a.crs_wkt, b.crs_wkt):
        return False
    c = a.cell_size
    if abs(a.cell_size - b.cell_size) > tol * c:
        return False
    dx, dy = (a.x0 - b.x0) / c, (a.y0 - b.y0) / c
    return abs(dx - round(dx)) <= tol and abs(dy - round(dy)) <= tol


def _expanded(spec: GridSpec, within: Window | None) -> tuple[int, int, int, int] | None:
    """`within` (or the grid) expanded outward to BLOCK edges and clipped: c0, r0, c1, r1."""
    if within is None:
        c0, r0, c1, r1 = 0, 0, spec.width, spec.height
    else:
        c0, r0 = int(within.col_off), int(within.row_off)
        c1, r1 = c0 + int(within.width), r0 + int(within.height)
    if c1 <= c0 or r1 <= r0:
        return None
    c0, r0 = max(0, (c0 // BLOCK) * BLOCK), max(0, (r0 // BLOCK) * BLOCK)
    c1 = min(spec.width, -(-c1 // BLOCK) * BLOCK)
    r1 = min(spec.height, -(-r1 // BLOCK) * BLOCK)
    if c1 <= c0 or r1 <= r0:
        return None
    return c0, r0, c1, r1


def _stepped(box: tuple[int, int, int, int] | None, step: int) -> Iterator[Window]:
    if box is None:
        return
    c0, r0, c1, r1 = box
    for r in range(r0, r1, step):
        for c in range(c0, c1, step):
            yield Window(c, r, min(step, c1 - c), min(step, r1 - r))


def block_windows(spec: GridSpec, within: Window | None = None) -> Iterator[Window]:
    """BLOCK-aligned blocks, row-major, clipped to the grid (and to `within`, expanded outward)."""
    yield from _stepped(_expanded(spec, within), BLOCK)


def read_windows(spec: GridSpec, within: Window | None = None, max_side: int = MAX_READ) -> Iterator[Window]:
    """BLOCK-aligned windows of at most `max_side` (a multiple of BLOCK), row-major."""
    if max_side <= 0 or max_side % BLOCK:
        raise GridError(f"max_side must be a positive multiple of {BLOCK}, got {max_side}")
    yield from _stepped(_expanded(spec, within), max_side)


def _overview_factors(width: int, height: int) -> list[int]:
    out, f = [], 2
    while max(width, height) / f >= OVERVIEW_MIN_SIDE:
        out.append(f)
        f *= 2
    return out


@dataclass(frozen=True)
class SurfaceStats:
    z_min: float | None
    z_max: float | None
    valid_cells: int
    coverage_fraction: float  # valid_cells / (width * height)
    z_p02: float | None  # from a deterministic sample of at most 1 M valid cells
    z_p98: float | None


class _StatsAccumulator:
    """z range, valid count and a p02/p98 sample. The sample is every cell whose global index
    `row * width + col` is a multiple of `k`, so it does not depend on how the grid was split."""

    def __init__(self, spec: GridSpec):
        self.spec = spec
        self.k = max(1, math.ceil(spec.width * spec.height / STATS_SAMPLE))
        self.z_min, self.z_max, self.valid = math.inf, -math.inf, 0
        self.samples: list[np.ndarray] = []

    def add(self, window: Window, data: np.ndarray) -> None:
        valid = np.isfinite(data)
        n = int(valid.sum())
        if not n:
            return
        values = data[valid]
        self.valid += n
        self.z_min = min(self.z_min, float(values.min()))
        self.z_max = max(self.z_max, float(values.max()))
        r0, c0 = int(window.row_off), int(window.col_off)
        rows = np.arange(r0, r0 + data.shape[0], dtype=np.int64)[:, None]
        cols = np.arange(c0, c0 + data.shape[1], dtype=np.int64)[None, :]
        pick = valid & ((rows * self.spec.width + cols) % self.k == 0)
        if pick.any():
            self.samples.append(data[pick].astype(np.float64))

    def result(self) -> SurfaceStats:
        if not self.valid:
            return SurfaceStats(None, None, 0, 0.0, None, None)
        sample = np.concatenate(self.samples) if self.samples else np.empty(0)
        p02 = float(np.percentile(sample, 2)) if sample.size else None
        p98 = float(np.percentile(sample, 98)) if sample.size else None
        total = self.spec.width * self.spec.height
        return SurfaceStats(self.z_min, self.z_max, self.valid, self.valid / total, p02, p98)


class SurfaceWriter:
    """Writes `path` block by block, as `<path>.partial`, renamed on finish(). Profile: GTiff,
    float32, 1 band, nodata NaN, tiled 512, DEFLATE, PREDICTOR=3, BIGTIFF=IF_SAFER, SPARSE_OK=TRUE,
    crs and transform from the spec. Overviews: factors 2, 4, 8... while the side divided by the
    factor is at least 256, Resampling.average (NaN-aware), DEFLATE plus PREDICTOR 3."""

    def __init__(
        self,
        path: Path,
        spec: GridSpec,
        *,
        progress: Callable[[float, str], None] | None = None,
        check_cancelled: Callable[[], None] | None = None,
        overviews: bool = True,
    ) -> None:
        if spec.width <= 0 or spec.height <= 0 or spec.width * spec.height > MAX_CELLS:
            raise GridError(f"a {spec.width} x {spec.height} grid cannot be written")
        self.path = Path(path)
        self.partial = self.path.with_name(self.path.name + ".partial")
        self.spec = spec
        self._progress, self._check, self._overviews = progress, check_cancelled, overviews
        self._ds = None
        self._stats = _StatsAccumulator(spec)
        self._total = -(-spec.width // BLOCK) * -(-spec.height // BLOCK)
        self._done = 0

    def __enter__(self) -> SurfaceWriter:
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self.partial.unlink(missing_ok=True)
        self._ds = rasterio.open(
            self.partial,
            "w",
            width=self.spec.width,
            height=self.spec.height,
            crs=self.spec.crs_wkt,
            transform=self.spec.transform,
            **PROFILE,
        )
        return self

    def __exit__(self, *exc) -> None:
        # Still open here means finish() never ran: an exception, or a caller that gave up.
        if self._ds is not None:
            try:
                self._ds.close()
            finally:
                self._ds = None
                self.partial.unlink(missing_ok=True)

    def write_block(self, window: Window, data: np.ndarray) -> None:
        if self._check:
            self._check()
        c0, r0, w, h = int(window.col_off), int(window.row_off), int(window.width), int(window.height)
        s = self.spec
        aligned = c0 % BLOCK == 0 and r0 % BLOCK == 0 and c0 >= 0 and r0 >= 0
        sides = (w % BLOCK == 0 or c0 + w == s.width) and (h % BLOCK == 0 or r0 + h == s.height)
        inside = w > 0 and h > 0 and c0 + w <= s.width and r0 + h <= s.height
        if not (aligned and sides and inside):
            raise GridError(f"window {c0},{r0} {w}x{h} is not aligned to {BLOCK} px blocks of the grid")
        arr = np.asarray(data, dtype=np.float32)
        if arr.shape != (h, w):
            raise GridError(f"data shape {arr.shape} does not match the window {h}x{w}")
        arr = np.where(np.isfinite(arr), arr, np.float32(np.nan))
        self._ds.write(arr, 1, window=Window(c0, r0, w, h))
        self._stats.add(window, arr)
        self._done += -(-w // BLOCK) * -(-h // BLOCK)
        if self._progress:
            self._progress(min(1.0, self._done / self._total), f"writing block {self._done} / {self._total}")

    def finish(self) -> SurfaceStats:
        factors = _overview_factors(self.spec.width, self.spec.height) if self._overviews else []
        if factors:
            with rasterio.Env(COMPRESS_OVERVIEW="DEFLATE", PREDICTOR_OVERVIEW="3"):
                self._ds.build_overviews(factors, Resampling.average)
        self._ds.close()
        self._ds = None
        try:
            os.replace(self.partial, self.path)
        except OSError:
            self.partial.unlink(missing_ok=True)
            raise
        return self._stats.result()


def _raw_read(ds, window: Window, out_shape: tuple[int, int], resampling: Resampling) -> np.ndarray:
    """Every pixel read of a surface goes through here (tests spy on it to check read sizes)."""
    return ds.read(1, window=window, out_shape=out_shape, resampling=resampling)


class SurfaceReader:
    spec: GridSpec

    def __init__(self, path: Path) -> None:
        self._ds = rasterio.open(path)
        try:
            self.spec = GridSpec.from_dataset(self._ds)
        except Exception:
            self._ds.close()
            raise

    def __enter__(self) -> SurfaceReader:
        return self

    def __exit__(self, *exc) -> None:
        self.close()

    def close(self) -> None:
        self._ds.close()

    def read(
        self,
        window: Window,
        *,
        out_shape: tuple[int, int] | None = None,
        resampling: Resampling = Resampling.average,
        boundless: bool = False,
    ) -> np.ndarray:
        """float32 (h, w), NaN = nodata. GridError when the output exceeds MAX_READ on a side. With
        `boundless`, cells outside the grid come back as NaN."""
        c0, r0, w, h = int(window.col_off), int(window.row_off), int(window.width), int(window.height)
        oh, ow = out_shape if out_shape else (h, w)
        if oh > MAX_READ or ow > MAX_READ:
            raise GridError(f"a read of {ow} x {oh} exceeds {MAX_READ} per side")
        if w <= 0 or h <= 0 or oh <= 0 or ow <= 0:
            return np.full((max(oh, 0), max(ow, 0)), np.nan, np.float32)
        s = self.spec
        ic0, ir0 = max(c0, 0), max(r0, 0)
        ic1, ir1 = min(c0 + w, s.width), min(r0 + h, s.height)
        if (ic0, ir0, ic1, ir1) == (c0, r0, c0 + w, r0 + h):
            return self._read(Window(c0, r0, w, h), (oh, ow), resampling)
        if not boundless:
            raise GridError("the window reaches outside the grid; pass boundless=True")
        out = np.full((oh, ow), np.nan, np.float32)
        if ic1 <= ic0 or ir1 <= ir0:
            return out
        fx, fy = w / ow, h / oh
        oc0, or0 = round((ic0 - c0) / fx), round((ir0 - r0) / fy)
        oc1, or1 = round((ic1 - c0) / fx), round((ir1 - r0) / fy)
        if oc1 > oc0 and or1 > or0:
            inner = Window(ic0, ir0, ic1 - ic0, ir1 - ir0)
            out[or0:or1, oc0:oc1] = self._read(inner, (or1 - or0, oc1 - oc0), resampling)
        return out

    def _read(self, window: Window, shape: tuple[int, int], resampling: Resampling) -> np.ndarray:
        return _raw_read(self._ds, window, shape, resampling).astype(np.float32, copy=False)

    def sample_bilinear(self, xs: np.ndarray, ys: np.ndarray) -> np.ndarray:
        """Bilinear between the four surrounding cell centres; NaN when any of them is NaN or
        outside the grid. Reads only windows covering the points, each at most MAX_READ."""
        s = self.spec
        return _bilinear(
            lambda c0, r0, w, h: self.read(Window(c0, r0, w, h)).astype(np.float64),
            s.width,
            s.height,
            s.x0,
            s.y0,
            s.cell_size,
            xs,
            ys,
        )


def _bilinear(read, width, height, x0, y0, cell, xs, ys) -> np.ndarray:
    """Bilinear sampling on a lattice through `read(c0, r0, w, h)`, grouping points so that no read
    exceeds MAX_READ. A zero-weight neighbour is not required, so an exact centre on the last
    row or column still samples."""
    xs = np.asarray(xs, dtype=np.float64)
    ys = np.asarray(ys, dtype=np.float64)
    shape = xs.shape
    x, y = xs.ravel(), ys.ravel()
    out = np.full(x.shape, np.nan, dtype=np.float64)
    fc = (x - x0) / cell - 0.5
    fr = (y0 - y) / cell - 0.5
    finite = np.isfinite(fc) & np.isfinite(fr)
    fc, fr = np.where(finite, fc, -1.0), np.where(finite, fr, -1.0)
    # a centre computed as 3.9999999999 is the centre 4: snap within 1e-9 of a cell
    fc = np.where(np.abs(fc - np.rint(fc)) < 1e-9, np.rint(fc), fc)
    fr = np.where(np.abs(fr - np.rint(fr)) < 1e-9, np.rint(fr), fr)
    c0 = np.floor(fc).astype(np.int64)
    r0 = np.floor(fr).astype(np.int64)
    tx, ty = fc - c0, fr - r0
    c1 = np.where(tx > 0, c0 + 1, c0)
    r1 = np.where(ty > 0, r0 + 1, r0)
    ok = finite & (c0 >= 0) & (r0 >= 0) & (c1 < width) & (r1 < height)
    idx = np.flatnonzero(ok)
    if idx.size:
        span = MAX_READ - 1
        keys = (r0[idx] // span) * (width // span + 2) + (c0[idx] // span)
        for key in np.unique(keys):
            sel = idx[keys == key]
            rr0, cc0 = int(r0[sel].min()), int(c0[sel].min())
            rr1, cc1 = int(r1[sel].max()), int(c1[sel].max())
            arr = read(cc0, rr0, cc1 - cc0 + 1, rr1 - rr0 + 1)
            a = arr[r0[sel] - rr0, c0[sel] - cc0]
            b = arr[r0[sel] - rr0, c1[sel] - cc0]
            c = arr[r1[sel] - rr0, c0[sel] - cc0]
            d = arr[r1[sel] - rr0, c1[sel] - cc0]
            t, u = tx[sel], ty[sel]
            out[sel] = (a * (1 - t) + b * t) * (1 - u) + (c * (1 - t) + d * t) * u
    return out.reshape(shape)


def open_surface(path: Path) -> SurfaceReader:
    return SurfaceReader(path)


def _split(window: Window, side: int) -> Iterator[Window]:
    c0, r0, w, h = int(window.col_off), int(window.row_off), int(window.width), int(window.height)
    for r in range(r0, r0 + h, side):
        for c in range(c0, c0 + w, side):
            yield Window(c, r, min(side, c0 + w - c), min(side, r0 + h - r))


def resample_onto(src: SurfaceReader, dst: GridSpec, window: Window) -> np.ndarray:
    """`src` sampled at the cell centres of `dst` inside `window` -> float32 (h, w).

    R1 same lattice: an integer-offset read. R2 same CRS, other lattice: bilinear at the centres,
    NaN if any neighbour is NaN; a src finer than half the dst cell is first averaged down by an
    integer factor. R3 other CRS: the centres are transformed dst -> src (horizontal only), then R2.
    """
    h, w = int(window.height), int(window.width)
    out = np.full((h, w), np.nan, dtype=np.float32)
    if h <= 0 or w <= 0:
        return out
    s = src.spec
    if same_lattice(s, dst):
        dc = round((dst.x0 - s.x0) / dst.cell_size)
        dr = round((s.y0 - dst.y0) / dst.cell_size)
        for sub in _split(window, MAX_READ):
            r, c = int(sub.row_off) - int(window.row_off), int(sub.col_off) - int(window.col_off)
            src_win = Window(int(sub.col_off) + dc, int(sub.row_off) + dr, int(sub.width), int(sub.height))
            out[r : r + int(sub.height), c : c + int(sub.width)] = src.read(src_win, boundless=True)
        return out
    xs, ys = dst.cell_centres(window)
    if not _same_crs(s.crs_wkt, dst.crs_wkt):
        if s.crs_wkt is None or dst.crs_wkt is None:
            raise GridError("a surface without coordinates can only be compared on its own lattice")
        t = Transformer.from_crs(
            CRS.from_user_input(dst.crs_wkt), CRS.from_user_input(s.crs_wkt), always_xy=True
        )
        xs, ys = t.transform(xs, ys)
    if s.cell_size < 0.5 * dst.cell_size:
        f = int(math.floor(dst.cell_size / s.cell_size))

        def coarse(c0: int, r0: int, cw: int, ch: int) -> np.ndarray:
            win = Window(c0 * f, r0 * f, cw * f, ch * f)
            return src.read(win, out_shape=(ch, cw), boundless=True).astype(np.float64)

        out[:] = _bilinear(coarse, s.width // f, s.height // f, s.x0, s.y0, s.cell_size * f, xs, ys)
    else:
        out[:] = src.sample_bilinear(xs, ys)
    return out


def convention_problems(path: Path) -> list[str]:
    """One readable string per breach of the grid convention; [] means `path` may be used as a
    surface.tif unchanged. Metadata only: no pixel is read."""
    problems: list[str] = []
    with rasterio.open(path) as ds:
        if ds.driver != "GTiff":
            problems.append(f"driver is {ds.driver}, not GTiff")
        if ds.count != 1:
            problems.append(f"{ds.count} bands, not 1")
        if ds.dtypes[0] != "float32":
            problems.append(f"data type is {ds.dtypes[0]}, not float32")
        if ds.nodata is None or not math.isnan(ds.nodata):
            problems.append(f"nodata is {ds.nodata}, not NaN")
        if any(MaskFlags.per_dataset in flags for flags in ds.mask_flag_enums):
            problems.append("has an internal mask; NaN must be the only nodata signal")
        if ds.block_shapes[0] != (BLOCK, BLOCK):
            problems.append(f"blocks are {ds.block_shapes[0]}, not tiled {BLOCK} x {BLOCK}")
        if ds.compression != Compression.deflate:
            problems.append(f"compression is {ds.compression}, not DEFLATE")
        if ds.tags(ns="IMAGE_STRUCTURE").get("PREDICTOR") != "3":
            problems.append("predictor is not 3 (floating point)")
        try:
            spec = GridSpec.from_dataset(ds)
        except GridError as e:
            problems.append(str(e))
            return problems
        crs = crs_problem(spec.crs_wkt)
        if crs:
            problems.append(crs)
        for name, v in (("x0", spec.x0), ("y0", spec.y0)):
            q = v / spec.cell_size
            if abs(q - round(q)) > LATTICE_TOL:
                problems.append(f"origin {name}={v} is not a multiple of the cell size {spec.cell_size}")
        if spec.width * spec.height > MAX_CELLS:
            problems.append(f"{spec.width} x {spec.height} is more than {MAX_CELLS} cells")
        if _overview_factors(spec.width, spec.height) and not ds.overviews(1):
            problems.append("internal overviews are missing")
    return problems


def compute_stats(
    path: Path,
    *,
    progress: Callable[[float, str], None] | None = None,
    check_cancelled: Callable[[], None] | None = None,
) -> SurfaceStats:
    """The SurfaceStats `SurfaceWriter.finish()` returns, by a windowed pass over `path`."""
    with open_surface(path) as reader:
        acc = _StatsAccumulator(reader.spec)
        windows = list(read_windows(reader.spec))
        for i, win in enumerate(windows, 1):
            if check_cancelled:
                check_cancelled()
            acc.add(win, reader.read(win))
            if progress:
                progress(i / len(windows), f"reading heights {i} / {len(windows)}")
        return acc.result()


def hillshade(
    z: np.ndarray, cell_x: float, cell_y: float, *, azimuth: float = 315.0, altitude: float = 45.0
) -> np.ndarray:
    """Horn gradient, NaN-aware: uint8 shade 1..255, and 0 wherever z or any of its 8 neighbours is
    NaN. Grid edges use edge-replicated neighbours; pass a one-cell halo and crop for exact edges."""
    z = np.asarray(z, dtype=np.float64)
    p = np.pad(z, 1, mode="edge")
    a, b, c = p[:-2, :-2], p[:-2, 1:-1], p[:-2, 2:]
    d, f = p[1:-1, :-2], p[1:-1, 2:]
    g, h, i = p[2:, :-2], p[2:, 1:-1], p[2:, 2:]
    dzdx = ((c + 2 * f + i) - (a + 2 * d + g)) / (8.0 * cell_x)
    dzdy = ((g + 2 * h + i) - (a + 2 * b + c)) / (8.0 * cell_y)
    zenith = math.radians(90.0 - altitude)
    az = math.radians((360.0 - azimuth + 90.0) % 360.0)
    slope = np.arctan(np.hypot(dzdx, dzdy))
    aspect = np.arctan2(dzdy, -dzdx)
    shade = math.cos(zenith) * np.cos(slope) + math.sin(zenith) * np.sin(slope) * np.cos(az - aspect)
    out = np.clip(np.rint(1.0 + 254.0 * np.clip(shade, 0.0, 1.0)), 1, 255)
    bad = ~(np.isfinite(dzdx) & np.isfinite(dzdy) & np.isfinite(z))
    return np.where(bad, 0, out).astype(np.uint8)
