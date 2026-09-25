"""DEM build paths (spec §6 Build): copy as-is when the file already is a surface on the lattice,
else re-grid window by window through a WarpedVRT onto the output grid. No read exceeds 2048².

The warp runs with an effectively exact transformer (tolerance 1e-9; GDAL refuses 0.0) rather than
GDAL's default approximate transformer (0.125 px), which can miss the spec's 1 mm oracle over a
big enough re-grid (ADR 2026-09-24 GDAL warp tolerance). Every bilinear warp also pins GDAL's own
kernel scale via real `XSCALE=1, YSCALE=1` keyword arguments -- not a `warp_extras={...}` dict,
which rasterio nests under its own `"warp_extras"` key and GDAL never sees. Without this, GDAL
widens the bilinear kernel whenever the target cell is coarser than the source (even a 1.2x ratio),
or when the source is reprojected into another CRS on the way, biasing interior cells by a
centimetre or more; passed as real kwargs, the same warp is accurate to a few hundredths of a
millimetre (ADR 2026-09-24, "Fix round 2").

A destination cell is trusted only where an independent validity band -- 1.0 where the source is
valid (its own nodata, mask and any not-yet-declared sentinel value all count), 0.0 elsewhere --
comes back effectively fully covered (>= 1 - 1e-6) when warped through the *identical*
CRS/transform/resampling/tolerance/XSCALE pipeline as the heights. This is what actually erodes an
under-covered cell, whatever the reason: the DEM's own outer edge, an interior nodata hole's
contaminated rim (GDAL's bilinear renormalises weights across a hole, so the data band alone does
not show it), or a wide `Resampling.average` kernel's reach when the target cell is more than
double the source cell -- not a fixed pixel distance, which misses all three. The validity band
itself is written to a temporary GeoTIFF on disk (tiled, DEFLATE), not held as a single in-memory
array, so a large source DEM does not blow the bounded-memory budget; GDAL's own warp memory limit
(`warp_mem_limit`, 64 MB by default) separately bounds how much of either warp's source is read for
any one destination window, and the validity band's own construction reads `grid.MAX_READ` chunks
at a time.
"""

from __future__ import annotations

import math
import os
import shutil
import tempfile
from pathlib import Path

import numpy as np
from affine import Affine
from pyproj import CRS
from rasterio.windows import Window

from app.jobs.cancellation import JobFailure
from app.surfaces import grid
from app.surfaces.design.placement import Placement, raster_envelope

COPY_CHUNK = 64 * 2**20
MESSAGE = "Importing design surface"
WARP_TOLERANCE = 1e-9  # effectively exact; GDAL raises ObjectNullError on 0.0 (rasterio 1.4.4 / GDAL 3.10.3)
VALIDITY_SHARE = 0.2  # of the re-grid's progress spent on the validity pass over the whole source
COVERAGE_EPS = 1e-6  # a warped validity of 1 - COVERAGE_EPS or better counts as fully covered


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


def _warp_params(src, spec: grid.GridSpec):
    """The resampling and GDAL kernel-scale kwargs shared by the height warp and its validity
    companion (they must match exactly, or the coverage mask does not describe the actual height
    kernel). `XSCALE`/`YSCALE` must be passed as real keyword arguments to `WarpedVRT`, not inside a
    `warp_extras={...}` dict -- rasterio stores that dict verbatim under its own `"warp_extras"` key
    instead of merging its contents into the options GDAL reads, so GDAL never sees them.
    """
    from rasterio.enums import Resampling

    resampling = Resampling.bilinear if spec.cell_size <= 2 * _src_cell(src) else Resampling.average
    kernel_kwargs = {"XSCALE": 1, "YSCALE": 1} if resampling == Resampling.bilinear else {}
    return resampling, kernel_kwargs


def _open_warped(src, spec: grid.GridSpec, p: Placement, internal: dict, resampling, kernel_kwargs):
    from rasterio.vrt import WarpedVRT

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
        **kernel_kwargs,
    )


def read_window(vrt, window: Window) -> np.ndarray:
    """The one pixel read of the DEM paths; never above MAX_READ on a side (spied by the tests)."""
    if window.width > grid.MAX_READ or window.height > grid.MAX_READ:
        raise grid.GridError(f"a read of {window.width} x {window.height} exceeds {grid.MAX_READ}")
    return vrt.read(1, window=window, masked=True).astype(np.float32).filled(np.nan)


def _heights(data: np.ndarray, internal: dict, z_factor: float) -> np.ndarray:
    z = data.astype(np.float64) * internal.get("scale", 1.0) + internal.get("offset", 0.0)
    return (z * z_factor).astype(np.float32)


def _validity_halo(src, spec: grid.GridSpec) -> int:
    """Pixels of explicit 0.0 border the validity raster carries beyond `src`'s own extent, so a
    destination kernel that reaches past the DEM's true edge blends in real invalid data instead of
    silently renormalising over nothing. Without an explicit border, "outside the array" and "inside
    the array but invalid" behave differently in GDAL's own warp, and only the second is detected.
    Sized to the resampling kernel's reach (empirically converged at 1 px even at a 4x downsampling
    ratio; kept a further margin here since GDAL's `Resampling.average` kernel width grows with the
    cell ratio in general).
    """
    ratio = spec.cell_size / _src_cell(src)
    return max(2, math.ceil(ratio) + 1)


def _no_op(*_args) -> None:
    return None


def _build_validity_source(src, spec: grid.GridSpec, internal: dict, *, check_cancelled, progress=_no_op):
    """A uint8 1/0 raster covering `src`'s own extent plus a `_validity_halo` border of explicit 0:
    1 wherever `src` is valid (finite, not equal to `internal["nodata"]` -- which also covers a
    sentinel value never declared as the file's own nodata -- and not masked by the source's own
    GDAL mask when `internal["mask"]` says one is present), 0 everywhere else, including the border.

    Written to a temporary GeoTIFF on disk (tiled, DEFLATE) rather than an in-memory array: a large
    source DEM (tens of thousands of pixels per side) would otherwise put a full uncompressed copy
    in RAM, breaking the bounded-memory invariant. Read and written `grid.MAX_READ` chunks at a
    time, so the whole source is never held in memory at once either way. Returns the temp
    directory's path (the caller removes it, including on cancellation or failure) and the
    validity file's own path.

    The pass reads the whole source DEM, so it calls `check_cancelled` once per chunk (a cancel
    raises out of it and the temp directory is removed) and reports `progress(fraction)`.
    """
    import rasterio

    halo = _validity_halo(src, spec)
    padded_transform = src.transform @ Affine.translation(-halo, -halo)
    width, height = src.width + 2 * halo, src.height + 2 * halo
    tmp_dir = tempfile.mkdtemp(prefix="dem_validity_")
    try:
        vpath = Path(tmp_dir) / "validity.tif"
        with rasterio.open(
            vpath,
            "w",
            driver="GTiff",
            width=width,
            height=height,
            count=1,
            dtype="uint8",
            crs=src.crs,
            transform=padded_transform,
            tiled=True,
            blockxsize=512,
            blockysize=512,
            compress="deflate",
        ) as vds:
            nodata = internal.get("nodata")
            want_mask = bool(internal.get("mask"))
            rows = range(0, src.height, grid.MAX_READ)
            cols = range(0, src.width, grid.MAX_READ)
            total, done = len(rows) * len(cols), 0
            for r0 in rows:
                rh = min(grid.MAX_READ, src.height - r0)
                for c0 in cols:
                    check_cancelled()
                    cw = min(grid.MAX_READ, src.width - c0)
                    win = Window(c0, r0, cw, rh)
                    raw = src.read(1, window=win)
                    valid = np.isfinite(raw.astype(np.float64))
                    if nodata is not None and not (isinstance(nodata, float) and math.isnan(nodata)):
                        valid &= raw != nodata
                    if want_mask:
                        valid &= src.read_masks(1, window=win) > 0
                    vds.write(valid.astype(np.uint8), 1, window=Window(c0 + halo, r0 + halo, cw, rh))
                    done += 1
                    progress(done / total)
    except BaseException:
        shutil.rmtree(tmp_dir, ignore_errors=True)
        raise
    return tmp_dir, vpath


def _open_validity_warp(vsrc, spec: grid.GridSpec, p: Placement, resampling, kernel_kwargs):
    """The validity companion to `_open_warped`: identical CRS/transform/resampling/tolerance/
    XSCALE kwargs, but no nodata of its own -- a 0 (invalid) pixel must blend into the kernel as
    real data, not be masked out and renormalised away, or it can never pull a covered value below
    1.0.
    """
    from rasterio.vrt import WarpedVRT

    return WarpedVRT(
        vsrc,
        src_crs=p.source_crs.to_wkt(),
        crs=spec.crs_wkt or p.source_crs.to_wkt(),
        transform=spec.transform,
        width=spec.width,
        height=spec.height,
        dtype="float32",
        resampling=resampling,
        tolerance=WARP_TOLERANCE,
        **kernel_kwargs,
    )


def regrid(
    path: Path, spec: grid.GridSpec, writer, p: Placement, internal: dict, *, progress, check_cancelled
) -> None:
    """Every read_windows window of `spec` that meets the DEM's footprint, through SurfaceWriter."""
    import rasterio

    within = spec.window_for_bounds(footprint(path, p), pad=1)
    if within.width == 0 or within.height == 0:
        return
    windows = list(grid.read_windows(spec, within=within))
    with rasterio.open(path) as src:
        resampling, kernel_kwargs = _warp_params(src, spec)
        # The validity pass is the first VALIDITY_SHARE of the re-grid's progress, the windows the rest.
        tmp_dir, vpath = _build_validity_source(
            src,
            spec,
            internal,
            check_cancelled=check_cancelled,
            progress=lambda f: progress(VALIDITY_SHARE * f, MESSAGE),
        )
        try:
            with (
                rasterio.open(vpath) as vsrc,
                _open_warped(src, spec, p, internal, resampling, kernel_kwargs) as vrt,
                _open_validity_warp(vsrc, spec, p, resampling, kernel_kwargs) as vvrt,
            ):
                for i, win in enumerate(windows):
                    check_cancelled()
                    data = _heights(read_window(vrt, win), internal, p.z_factor)
                    coverage = read_window(vvrt, win)
                    data = np.where(coverage >= 1.0 - COVERAGE_EPS, data, np.float32(np.nan))
                    if np.isfinite(data).any():
                        writer.write_block(win, data)
                    progress(VALIDITY_SHARE + (1 - VALIDITY_SHARE) * (i + 1) / len(windows), MESSAGE)
        finally:
            shutil.rmtree(tmp_dir, ignore_errors=True)


def read_preview(
    path: Path, pspec: grid.GridSpec, p: Placement, internal: dict, *, check_cancelled=_no_op
) -> np.ndarray:
    import rasterio

    with rasterio.open(path) as src:
        resampling, kernel_kwargs = _warp_params(src, pspec)
        tmp_dir, vpath = _build_validity_source(src, pspec, internal, check_cancelled=check_cancelled)
        try:
            with (
                rasterio.open(vpath) as vsrc,
                _open_warped(src, pspec, p, internal, resampling, kernel_kwargs) as vrt,
                _open_validity_warp(vsrc, pspec, p, resampling, kernel_kwargs) as vvrt,
            ):
                window = Window(0, 0, pspec.width, pspec.height)
                data = _heights(read_window(vrt, window), internal, p.z_factor)
                coverage = read_window(vvrt, window)
                return np.where(coverage >= 1.0 - COVERAGE_EPS, data, np.float32(np.nan))
        finally:
            shutil.rmtree(tmp_dir, ignore_errors=True)
