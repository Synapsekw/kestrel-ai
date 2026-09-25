"""Cloud-surface targets and DEM files for the S3 tests (spec §15.3), written at test time."""

from __future__ import annotations

from pathlib import Path

import numpy as np
import rasterio
from affine import Affine
from designs import E0, N0
from pyproj import CRS

from app.surfaces import grid


def target_spec(
    bounds=(E0, N0, E0 + 200.0, N0 + 100.0), cell: float = 0.5, epsg: int = 32639
) -> grid.GridSpec:
    return grid.aligned_grid(bounds, cell, CRS.from_epsg(epsg).to_wkt(), epsg)


def write_target(path: Path, spec: grid.GridSpec, fn) -> Path:
    """A surface.tif through S2's writer, heights fn(X, Y) at the cell centres."""
    path.parent.mkdir(parents=True, exist_ok=True)
    with grid.SurfaceWriter(path, spec) as w:
        for win in grid.read_windows(spec):
            x, y = spec.cell_centres(win)
            w.write_block(win, np.asarray(fn(x, y), dtype=np.float32))
        w.finish()
    return path


def add_target(handle, spec: grid.GridSpec, fn, *, name: str = "Site DSM") -> str:
    """A ready cloud_dsm Surface row with its surface.tif, as S2's surface_build leaves it."""
    from app.db.models import Surface
    from app.surfaces.paths import surface_path

    with handle.session() as s:
        row = Surface(name=name, kind="cloud_dsm", status="building")
        s.add(row)
        s.flush()
        sid = row.id
    path = write_target(surface_path(handle, sid), spec, fn)
    stats = grid.compute_stats(path)
    with handle.session() as s:
        row = s.get(Surface, sid)
        row.status, row.method = "ready", "median"
        row.crs_wkt, row.epsg, row.cell_size_m = spec.crs_wkt, spec.epsg, spec.cell_size
        row.width, row.height = spec.width, spec.height
        row.geotransform, row.bounds_native = list(spec.geotransform), list(spec.bounds)
        row.z_min, row.z_max, row.coverage_fraction = stats.z_min, stats.z_max, stats.coverage_fraction
    return sid


def write_dem(
    path: Path,
    z,
    *,
    x0: float,
    y0: float,
    cell: float,
    crs: str | None = "EPSG:32639",
    dtype: str = "float32",
    nodata: float | None = None,
    scale: float | None = None,
    offset: float | None = None,
    rotation: float = 0.0,
    count: int = 1,
    identity: bool = False,
) -> Path:
    """A plain (untiled, uncompressed) GeoTIFF: never a conforming surface unless written by write_target."""
    data = np.asarray(z)
    if data.ndim == 2:
        data = data[None]
    _, h, w = data.shape
    transform = (
        Affine.identity()
        if identity
        else Affine.translation(x0, y0) * Affine.rotation(rotation) * Affine.scale(cell, -cell)
    )
    profile = dict(driver="GTiff", width=w, height=h, count=count, dtype=dtype, transform=transform)
    if crs:
        profile["crs"] = crs
    if nodata is not None:
        profile["nodata"] = nodata
    path.parent.mkdir(parents=True, exist_ok=True)
    with rasterio.open(path, "w", **profile) as dst:
        dst.write(data.astype(dtype))
        if scale is not None or offset is not None:
            dst.scales = (scale if scale is not None else 1.0,) * count
            dst.offsets = (offset if offset is not None else 0.0,) * count
    return path
