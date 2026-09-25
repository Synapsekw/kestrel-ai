"""DEM build paths (spec §6 Build): copy as-is when the file already is a surface on the lattice,
else re-grid window by window through a WarpedVRT onto the output grid. No read exceeds 2048².

The warp runs with an effectively exact transformer (tolerance 1e-9; GDAL refuses 0.0) rather than
GDAL's default approximate transformer (0.125 px), which can miss the spec's 1 mm oracle over a
big enough re-grid (ADR 2026-09-24 GDAL warp tolerance). `XSCALE=1, YSCALE=1` is also pinned on every
bilinear warp in this module; on this rasterio/GDAL build it measurably changes nothing (see the
ADR), so the actual fix for GDAL's own bilinear kernel bias when the target cell is coarser than the
source by up to 2x is `_needs_exact_bilinear` + `_open_reprojected_native` +
`_bilinear_from_native`: reproject at the source's own resolution (ratio 1, where the kernel is
exact) and interpolate onto the target lattice by hand with the plain 4-neighbour formula.

A destination cell is trusted only where an independent validity band -- 1.0 where the source is
valid (its own nodata, mask and any not-yet-declared sentinel value all count), 0.0 elsewhere --
comes back effectively fully covered (>= 1 - 1e-6) when warped through the *identical* pipeline as
the heights (same CRS/transform/resampling/tolerance/XSCALE, or the same exact-bilinear path). This
is what actually erodes an under-covered cell, whatever the reason: the DEM's own outer edge, an
interior nodata hole's contaminated rim (GDAL's bilinear renormalises weights across a hole, so the
data band alone does not show it), or a wide `Resampling.average` kernel's reach when the target
cell is more than double the source cell -- not a fixed pixel distance, which misses all three.
GDAL's own warp memory limit (`warp_mem_limit`, 64 MB by default) bounds how much of the source
either WarpedVRT reads for any one destination window; the source-side reads used to build the
validity band, and every read `_bilinear_from_native` does, are `grid.MAX_READ`-bounded too.
"""

from __future__ import annotations

import math
import os
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
COVERAGE_EPS = 1e-6  # a warped validity of 1 - COVERAGE_EPS or better counts as fully covered
EXACT_MAX_SIDE = 512  # target-window cap for the exact-bilinear path (see _needs_exact_bilinear)
NATIVE_PAD = 2  # native cells of slack the exact-bilinear intermediate keeps beyond a window


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
    """The resampling and GDAL warp options shared by the height warp and its validity companion
    (they must match exactly, or the coverage mask does not describe the actual height kernel)."""
    from rasterio.enums import Resampling

    resampling = Resampling.bilinear if spec.cell_size <= 2 * _src_cell(src) else Resampling.average
    warp_extras = {"XSCALE": 1, "YSCALE": 1} if resampling == Resampling.bilinear else {}
    return resampling, warp_extras


def _open_warped(src, spec: grid.GridSpec, p: Placement, internal: dict, resampling, warp_extras):
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
        warp_extras=warp_extras,
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


def _build_validity_source(src, spec: grid.GridSpec, internal: dict):
    """A float32 1.0/0.0 raster covering `src`'s own extent plus a `_validity_halo` border of
    explicit 0.0: 1.0 wherever `src` is valid (finite, not equal to `internal["nodata"]` -- which
    also covers a sentinel value never declared as the file's own nodata -- and not masked by the
    source's own GDAL mask when `internal["mask"]` says one is present), 0.0 everywhere else,
    including the border. Read and written `grid.MAX_READ` chunks at a time, so the whole source is
    never held in memory at once. The caller closes the returned dataset and its backing MemoryFile.
    """
    from rasterio.io import MemoryFile

    halo = _validity_halo(src, spec)
    padded_transform = src.transform @ Affine.translation(-halo, -halo)
    width, height = src.width + 2 * halo, src.height + 2 * halo
    memfile = MemoryFile()
    with memfile.open(
        driver="GTiff",
        width=width,
        height=height,
        count=1,
        dtype="float32",
        crs=src.crs,
        transform=padded_transform,
    ) as vds:
        nodata = internal.get("nodata")
        want_mask = bool(internal.get("mask"))
        for r0 in range(0, src.height, grid.MAX_READ):
            rh = min(grid.MAX_READ, src.height - r0)
            for c0 in range(0, src.width, grid.MAX_READ):
                cw = min(grid.MAX_READ, src.width - c0)
                win = Window(c0, r0, cw, rh)
                raw = src.read(1, window=win)
                valid = np.isfinite(raw.astype(np.float64))
                if nodata is not None and not (isinstance(nodata, float) and math.isnan(nodata)):
                    valid &= raw != nodata
                if want_mask:
                    valid &= src.read_masks(1, window=win) > 0
                vds.write(valid.astype(np.float32), 1, window=Window(c0 + halo, r0 + halo, cw, rh))
    return memfile, memfile.open()


def _open_validity_warp(vsrc, spec: grid.GridSpec, p: Placement, resampling, warp_extras):
    """The validity companion to `_open_warped`: identical CRS/transform/resampling/tolerance/
    XSCALE, but no nodata of its own -- a 0.0 (invalid) pixel must blend into the kernel as real
    data, not be masked out and renormalised away, or it can never pull a covered value below 1.0.
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
        warp_extras=warp_extras,
    )


def _needs_exact_bilinear(src, spec: grid.GridSpec) -> bool:
    """True in the one regime GDAL's own bilinear warp kernel is measurably biased in this
    rasterio/GDAL build: the target cell is coarser than the source but not by more than 2x (where
    `_warp_params` would switch to `Resampling.average`), *and* actually coarser -- upsampling
    (ratio <= 1) already warps exactly (see ADR). `XSCALE=1, YSCALE=1` does not change this (verified
    empirically across several orders of magnitude of override values, with and without a CRS, with
    plain `DatasetReader.read(out_shape=...)` as well as `WarpedVRT` -- the bias is identical either
    way), so this regime is instead handled by `_open_reprojected_native` + `_bilinear_from_native`:
    reproject at the source's own resolution (ratio 1, so the kernel is exact), then interpolate onto
    the target lattice by hand with the standard 4-neighbour bilinear formula.
    """
    ratio = spec.cell_size / _src_cell(src)
    return 1.0 + 1e-9 < ratio <= 2.0


def _open_reprojected_native(ds, p: Placement, out_crs_wkt, bounds, pad_cells: int, src_nodata):
    """`ds` reprojected into `out_crs_wkt` at its own cell size -- ratio 1 to itself, so GDAL's warp
    kernel is exact (see `_needs_exact_bilinear`) -- covering `bounds` (a GridSpec.bounds tuple in
    the output CRS) padded by `pad_cells` native cells on every side. Returns the open WarpedVRT
    together with its transform/width/height for `_bilinear_from_native`; the caller closes it.
    """
    from rasterio.enums import Resampling
    from rasterio.vrt import WarpedVRT

    native_cell = _src_cell(ds)
    minx, miny, maxx, maxy = bounds
    pad = pad_cells * native_cell
    x0, y1 = minx - pad, maxy + pad
    width = int(math.ceil((maxx - minx + 2 * pad) / native_cell)) + 1
    height = int(math.ceil((maxy - miny + 2 * pad) / native_cell)) + 1
    transform = Affine.translation(x0, y1) @ Affine.scale(native_cell, -native_cell)
    vrt = WarpedVRT(
        ds,
        src_crs=p.source_crs.to_wkt(),
        crs=out_crs_wkt or p.source_crs.to_wkt(),
        transform=transform,
        width=width,
        height=height,
        src_nodata=src_nodata,
        nodata=np.nan,
        dtype="float32",
        resampling=Resampling.bilinear,
        tolerance=WARP_TOLERANCE,
        warp_extras={"XSCALE": 1, "YSCALE": 1},
    )
    return vrt, transform, width, height


def _bilinear_from_native(
    vrt, transform: Affine, width: int, height: int, xs: np.ndarray, ys: np.ndarray
) -> np.ndarray:
    """The standard 4-neighbour bilinear formula, sampling `vrt` (already reprojected to the query
    CRS at ratio 1 to its own source -- see `_open_reprojected_native`) at (xs, ys). Reads only the
    small bounding window each call's points need, still MAX_READ-bounded. `WarpedVRT` refuses a
    boundless read, so a point whose neighbourhood reaches past `vrt`'s own edge (only possible for
    the outermost cells of `within`, given `_open_reprojected_native`'s `NATIVE_PAD` margin) is
    clamped into range instead -- harmless, since the separate coverage mask (built the same way)
    already erodes any cell that genuinely lacks that data.
    """
    x = np.asarray(xs, dtype=np.float64)
    y = np.asarray(ys, dtype=np.float64)
    shape = x.shape
    col, row = ~transform @ (x.ravel(), y.ravel())
    fc, fr = col - 0.5, row - 0.5
    c0, r0 = np.floor(fc).astype(np.int64), np.floor(fr).astype(np.int64)
    tx, ty = fc - c0, fr - r0
    c0 = np.clip(c0, 0, width - 2)
    r0 = np.clip(r0, 0, height - 2)
    cc0, rr0 = int(c0.min()), int(r0.min())
    win_w, win_h = int(c0.max()) - cc0 + 2, int(r0.max()) - rr0 + 2
    if win_w > grid.MAX_READ or win_h > grid.MAX_READ:
        raise grid.GridError(f"a read of {win_w} x {win_h} exceeds {grid.MAX_READ}")
    arr = vrt.read(1, window=Window(cc0, rr0, win_w, win_h), masked=True).astype(np.float64).filled(np.nan)
    rr, cc = r0 - rr0, c0 - cc0
    a, b = arr[rr, cc], arr[rr, cc + 1]
    c, d = arr[rr + 1, cc], arr[rr + 1, cc + 1]
    out = (a * (1 - tx) + b * tx) * (1 - ty) + (c * (1 - tx) + d * tx) * ty
    return out.astype(np.float32).reshape(shape)


def _regrid_exact_bilinear(src, vsrc, spec: grid.GridSpec, p: Placement, internal: dict, within: Window):
    """The `_needs_exact_bilinear` path: one native-resolution reprojection of `src` (heights) and
    of `vsrc` (coverage), then an exact bilinear sample of each onto every `EXACT_MAX_SIDE` window
    of `spec` within `within`. Yields (window, data, coverage) triples; the caller writes them.
    """
    bounds = spec.crop(within).bounds
    hvrt, htransform, hw, hh = _open_reprojected_native(
        src, p, spec.crs_wkt, bounds, NATIVE_PAD, internal.get("nodata")
    )
    cvrt, ctransform, cw, ch = _open_reprojected_native(vsrc, p, spec.crs_wkt, bounds, NATIVE_PAD, None)
    try:
        for win in grid.read_windows(spec, within=within, max_side=EXACT_MAX_SIDE):
            xs, ys = spec.cell_centres(win)
            raw = _bilinear_from_native(hvrt, htransform, hw, hh, xs, ys)
            data = _heights(raw, internal, p.z_factor)
            coverage = _bilinear_from_native(cvrt, ctransform, cw, ch, xs, ys)
            yield win, data, coverage
    finally:
        hvrt.close()
        cvrt.close()


def regrid(
    path: Path, spec: grid.GridSpec, writer, p: Placement, internal: dict, *, progress, check_cancelled
) -> None:
    """Every read_windows window of `spec` that meets the DEM's footprint, through SurfaceWriter."""
    import rasterio

    within = spec.window_for_bounds(footprint(path, p), pad=1)
    if within.width == 0 or within.height == 0:
        return
    with rasterio.open(path) as src:
        exact = _needs_exact_bilinear(src, spec)
        resampling, warp_extras = _warp_params(src, spec)
        windows = list(
            grid.read_windows(spec, within=within, max_side=EXACT_MAX_SIDE if exact else grid.MAX_READ)
        )
        memfile, vsrc = _build_validity_source(src, spec, internal)
        try:
            if exact:
                total = len(windows)
                for i, (win, data, coverage) in enumerate(
                    _regrid_exact_bilinear(src, vsrc, spec, p, internal, within)
                ):
                    check_cancelled()
                    data = np.where(coverage >= 1.0 - COVERAGE_EPS, data, np.float32(np.nan))
                    if np.isfinite(data).any():
                        writer.write_block(win, data)
                    progress((i + 1) / max(total, 1), MESSAGE)
            else:
                with (
                    _open_warped(src, spec, p, internal, resampling, warp_extras) as vrt,
                    _open_validity_warp(vsrc, spec, p, resampling, warp_extras) as vvrt,
                ):
                    for i, win in enumerate(windows):
                        check_cancelled()
                        data = _heights(read_window(vrt, win), internal, p.z_factor)
                        coverage = read_window(vvrt, win)
                        data = np.where(coverage >= 1.0 - COVERAGE_EPS, data, np.float32(np.nan))
                        if np.isfinite(data).any():
                            writer.write_block(win, data)
                        progress((i + 1) / len(windows), MESSAGE)
        finally:
            vsrc.close()
            memfile.close()


def read_preview(path: Path, pspec: grid.GridSpec, p: Placement, internal: dict) -> np.ndarray:
    import rasterio

    with rasterio.open(path) as src:
        exact = _needs_exact_bilinear(src, pspec)
        resampling, warp_extras = _warp_params(src, pspec)
        memfile, vsrc = _build_validity_source(src, pspec, internal)
        try:
            out = np.full((pspec.height, pspec.width), np.nan, np.float32)
            full = Window(0, 0, pspec.width, pspec.height)
            if exact:
                for win, data, coverage in _regrid_exact_bilinear(src, vsrc, pspec, p, internal, full):
                    c0, r0, w, h = int(win.col_off), int(win.row_off), int(win.width), int(win.height)
                    block = np.where(coverage >= 1.0 - COVERAGE_EPS, data, np.float32(np.nan))
                    out[r0 : r0 + h, c0 : c0 + w] = block
            else:
                with (
                    _open_warped(src, pspec, p, internal, resampling, warp_extras) as vrt,
                    _open_validity_warp(vsrc, pspec, p, resampling, warp_extras) as vvrt,
                ):
                    data = _heights(read_window(vrt, full), internal, p.z_factor)
                    coverage = read_window(vvrt, full)
                    out = np.where(coverage >= 1.0 - COVERAGE_EPS, data, np.float32(np.nan))
            return out
        finally:
            vsrc.close()
            memfile.close()
