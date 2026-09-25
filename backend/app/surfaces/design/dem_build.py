"""DEM build paths (spec §6 Build): copy as-is when the file already is a surface on the lattice,
else re-grid window by window through a WarpedVRT onto the output grid. No read exceeds 2048².

The warp runs with an effectively exact transformer (tolerance 1e-9; GDAL refuses 0.0) rather than
GDAL's default approximate transformer (0.125 px), which can miss the spec's 1 mm oracle over a
big enough re-grid (ADR 2026-09-24 GDAL warp tolerance).

An output cell whose bilinear kernel would reach past the source DEM's own raster edge is never
trusted as-is: the valid footprint is eroded by the kernel's half-pixel reach and anything outside
it comes back NaN, so "every covered cell within 1 mm" (spec §16.1) holds at the outer ring too.
"""

from __future__ import annotations

import math
import os
from pathlib import Path

import numpy as np
from pyproj import CRS, Transformer
from rasterio.windows import Window

from app.jobs.cancellation import JobFailure
from app.surfaces import grid
from app.surfaces.design.placement import Placement, raster_envelope

COPY_CHUNK = 64 * 2**20
MESSAGE = "Importing design surface"
WARP_TOLERANCE = 1e-9  # effectively exact; GDAL raises ObjectNullError on 0.0 (rasterio 1.4.4 / GDAL 3.10.3)
KERNEL_REACH = 0.5  # bilinear needs a source pixel centre on each side; erode the footprint by this
COVERAGE_EPS = 1e-6  # pixels: floating-point slack so an exactly-aligned edge cell is not eroded


def check_unchanged(path: Path, internal: dict) -> None:
    try:
        st = Path(path).stat()
    except OSError:
        raise JobFailure(f"{Path(path).name} is no longer there; read the file again") from None
    if st.st_size != internal.get("file_size") or st.st_mtime_ns != internal.get("mtime_ns"):
        raise JobFailure(f"{Path(path).name} changed since it was read; read it again")


def footprint(path: Path, p: Placement) -> tuple[float, float, float, float]:
    import rasterio
    from rasterio.warp import transform_bounds

    with rasterio.open(path) as src:
        env = raster_envelope(src.transform, src.width, src.height)
    if p.out_crs is None or p.source_crs.equals(p.out_crs):
        return env
    return tuple(transform_bounds(p.source_crs.to_wkt(), p.out_crs.to_wkt(), *env, densify_pts=21))


def can_copy(path: Path, p: Placement, target: grid.GridSpec | None, internal: dict) -> bool:
    """Spec §6: the copied file must be a valid surface on the aligned lattice as it is."""
    import rasterio

    if internal.get("sentinel") or internal.get("scale", 1.0) != 1.0 or internal.get("offset", 0.0) != 0.0:
        return False
    if p.z_factor != 1.0 or grid.convention_problems(path):
        return False
    with rasterio.open(path) as src:
        spec = grid.GridSpec.from_dataset(src)
    if spec.crs_wkt is None or p.out_crs is None:
        return False
    if not (CRS.from_wkt(spec.crs_wkt).equals(p.source_crs) and p.source_crs.equals(p.out_crs)):
        return False
    if target is not None:
        return grid.same_lattice(spec, target)
    return math.isclose(spec.cell_size, p.cell_size, rel_tol=1e-9)


def copy_file(src: Path, dst: Path, *, progress, check_cancelled) -> None:
    partial = dst.with_name(dst.name + ".partial")
    size, done = max(src.stat().st_size, 1), 0
    try:
        with open(src, "rb") as fi, open(partial, "wb") as fo:
            while chunk := fi.read(COPY_CHUNK):
                check_cancelled()
                fo.write(chunk)
                done += len(chunk)
                progress(done / size, MESSAGE)
        os.replace(partial, dst)
    except BaseException:
        partial.unlink(missing_ok=True)
        raise


def _src_cell(src) -> float:
    t = src.transform
    return min(math.hypot(t.a, t.d), math.hypot(t.b, t.e))


def _open_warped(src, spec: grid.GridSpec, p: Placement, internal: dict):
    from rasterio.enums import Resampling
    from rasterio.vrt import WarpedVRT

    resampling = Resampling.bilinear if spec.cell_size <= 2 * _src_cell(src) else Resampling.average
    return WarpedVRT(
        src,
        src_crs=p.source_crs.to_wkt(),
        crs=spec.crs_wkt or p.source_crs.to_wkt(),
        transform=spec.transform,
        width=spec.width,
        height=spec.height,
        src_nodata=internal.get("nodata"),
        nodata=np.nan,
        dtype="float32",
        resampling=resampling,
        tolerance=WARP_TOLERANCE,
    )


def read_window(vrt, window: Window) -> np.ndarray:
    """The one pixel read of the DEM paths; never above MAX_READ on a side (spied by the tests)."""
    if window.width > grid.MAX_READ or window.height > grid.MAX_READ:
        raise grid.GridError(f"a read of {window.width} x {window.height} exceeds {grid.MAX_READ}")
    return vrt.read(1, window=window, masked=True).astype(np.float32).filled(np.nan)


def _covered(xs: np.ndarray, ys: np.ndarray, p: Placement, src) -> np.ndarray:
    """True where a bilinear sample of `src` at (xs, ys) (output CRS) needs only source pixels that
    actually exist: the source footprint eroded inward by half a source pixel on every side (R7).
    Without this, GDAL's own edge handling can return a value for a kernel that reaches past the
    DEM's raster edge, silently wrong rather than absent.
    """
    if p.out_crs is not None and not p.source_crs.equals(p.out_crs):
        tr = Transformer.from_crs(p.out_crs, p.source_crs, always_xy=True)
        sx, sy = tr.transform(xs, ys)
    else:
        sx, sy = xs, ys
    col, row = ~src.transform @ (np.asarray(sx, dtype=np.float64), np.asarray(sy, dtype=np.float64))
    lo = KERNEL_REACH - COVERAGE_EPS
    hi_col, hi_row = src.width - lo, src.height - lo
    return (col >= lo) & (col <= hi_col) & (row >= lo) & (row <= hi_row)


def _heights(data: np.ndarray, internal: dict, z_factor: float) -> np.ndarray:
    z = data.astype(np.float64) * internal.get("scale", 1.0) + internal.get("offset", 0.0)
    return (z * z_factor).astype(np.float32)


def _erase_uncovered(data: np.ndarray, window: Window, spec: grid.GridSpec, p: Placement, src) -> np.ndarray:
    xs, ys = spec.cell_centres(window)
    mask = _covered(xs, ys, p, src)
    return np.where(mask, data, np.float32(np.nan))


def regrid(
    path: Path, spec: grid.GridSpec, writer, p: Placement, internal: dict, *, progress, check_cancelled
) -> None:
    """Every read_windows window of `spec` that meets the DEM's footprint, through SurfaceWriter."""
    import rasterio

    within = spec.window_for_bounds(footprint(path, p), pad=1)
    if within.width == 0 or within.height == 0:
        return
    windows = list(grid.read_windows(spec, within=within))
    with rasterio.open(path) as src, _open_warped(src, spec, p, internal) as vrt:
        for i, win in enumerate(windows):
            check_cancelled()
            data = _heights(read_window(vrt, win), internal, p.z_factor)
            data = _erase_uncovered(data, win, spec, p, src)
            if np.isfinite(data).any():
                writer.write_block(win, data)
            progress((i + 1) / len(windows), MESSAGE)


def read_preview(path: Path, pspec: grid.GridSpec, p: Placement, internal: dict) -> np.ndarray:
    import rasterio

    with rasterio.open(path) as src, _open_warped(src, pspec, p, internal) as vrt:
        window = Window(0, 0, pspec.width, pspec.height)
        data = _heights(read_window(vrt, window), internal, p.z_factor)
        return _erase_uncovered(data, window, pspec, p, src)
