"""Elevation along a line (spec 2026-09-26-map-workspace §9.2, §13, §14): synchronous and bounded.

Stations: n = min(MAX_STATIONS, ceil(length / cell)) (at least 2), evenly spaced by grid chainage
along the polyline, where `cell` is the finest cell among the chosen surfaces. Each surface is
sampled bilinearly with strict NaN through `SurfaceReader.read`, which caps every read at
MAX_READ per side. When the station step spans several cells, the reads are decimated by the
largest power of two within the step (the coarse-read pattern of `grid.resample_onto`), so GDAL
serves them from the surface's NaN-aware average overviews.

Contract ruling C5/C6: `profile()`'s dict has no top-level `step_m`, and each `series` entry has
only `surface_id, label, date, z` (no per-series `nodata_fraction`). The step is still computed
internally to drive the read decimation, and the overall `nodata_fraction` key stays.
"""

from __future__ import annotations

import math
from dataclasses import dataclass
from datetime import date
from pathlib import Path

import numpy as np
from rasterio.windows import Window

from app.errors import AppError
from app.mapmeasure.frames import SiteFrame, convert_xy, frame_of, unit_factor
from app.mapmeasure.geodesy import distance_results
from app.surfaces.grid import _bilinear, open_surface

MAX_STATIONS = 2000
MAX_3D_SAMPLES = 20_000
Z_DECIMALS = 4


@dataclass(frozen=True)
class SurfaceRef:
    id: str
    name: str
    captured_on: date | None
    crs_wkt: str | None
    epsg: int | None
    cell_size_m: float
    path: Path


def densify(vertices, n: int) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    """`n` stations evenly spaced by chainage along the polyline: (chainage, xs, ys), frame units."""
    v = np.asarray(vertices, dtype=np.float64).reshape(-1, 2)
    seg = np.hypot(*np.diff(v, axis=0).T)
    v = v[np.concatenate([[True], seg > 0])]  # a repeated vertex adds no chainage
    cum = np.concatenate([[0.0], np.cumsum(seg[seg > 0])])
    s = np.linspace(0.0, cum[-1], n)
    return s, np.interp(s, cum, v[:, 0]), np.interp(s, cum, v[:, 1])


def decimation(cell_m: float, step_m: float) -> int:
    f = 1
    while f * 2 * cell_m <= step_m:
        f *= 2
    return f


def sample_surface(ref: SurfaceRef, xs, ys, frame: SiteFrame, step_m: float) -> np.ndarray:
    """z at (xs, ys) given in `frame`; NaN where any bilinear neighbour is nodata or off the grid."""
    xs, ys = convert_xy(xs, ys, frame, frame_of(ref.crs_wkt, ref.epsg))
    f = decimation(ref.cell_size_m, step_m)
    with open_surface(ref.path) as src:
        if f == 1:
            return src.sample_bilinear(xs, ys)
        s = src.spec

        def coarse(c0: int, r0: int, cw: int, ch: int) -> np.ndarray:
            win = Window(c0 * f, r0 * f, cw * f, ch * f)
            return src.read(win, out_shape=(ch, cw), boundless=True).astype(np.float64)

        return _bilinear(coarse, s.width // f, s.height // f, s.x0, s.y0, s.cell_size * f, xs, ys)


def cut_fill(stations_m, a, b) -> tuple[float, float]:
    """(cut, fill) areas in m2 of `b` against `a`: fill where b is above a. Trapezoidal, split
    exactly at a sign change; a step with a NaN end is skipped."""
    d = np.asarray(b, dtype=np.float64) - np.asarray(a, dtype=np.float64)
    d0, d1, ds = d[:-1], d[1:], np.diff(np.asarray(stations_m, dtype=np.float64))
    ok = np.isfinite(d0) & np.isfinite(d1)
    d0, d1, ds = d0[ok], d1[ok], ds[ok]
    same = d0 * d1 >= 0
    x0, x1, dx = d0[~same], d1[~same], ds[~same]
    t = x0 / (x0 - x1)
    p = np.concatenate([(d0[same] + d1[same]) / 2 * ds[same], x0 * t * dx / 2, x1 * (1 - t) * dx / 2])
    return float(-p[p < 0].sum()), float(p[p > 0].sum())


def _json_z(z: np.ndarray) -> list[float | None]:
    return [round(float(v), Z_DECIMALS) if math.isfinite(v) else None for v in z]


def profile(vertices, frame: SiteFrame, refs: list[SurfaceRef]) -> dict:
    k = unit_factor(frame)
    d = distance_results(vertices, frame)
    cell = min(r.cell_size_m for r in refs)
    n = max(2, min(MAX_STATIONS, math.ceil(d["grid_length_m"] / cell)))
    s, xs, ys = densify(vertices, n)
    stations_m = s * k
    step_m = float(stations_m[-1] / (n - 1))
    zs = [sample_surface(r, xs, ys, frame, step_m) for r in refs]
    if not any(np.isfinite(z).any() for z in zs):
        raise AppError(
            "no_surface_under_line",
            "no elevation under this line; draw it over one of the chosen surfaces",
            422,
        )
    finite = np.concatenate([z[np.isfinite(z)] for z in zs])
    cut, fill = cut_fill(stations_m, zs[0], zs[1]) if len(zs) >= 2 else (None, None)
    return {
        "length_m": d["length_m"],
        "grid_length_m": d["grid_length_m"],
        "stations_m": [round(float(v), 4) for v in stations_m],
        "series": [
            {
                "surface_id": r.id,
                "label": r.name,
                "date": r.captured_on.isoformat() if r.captured_on else None,
                "z": _json_z(z),
            }
            for r, z in zip(refs, zs, strict=True)
        ],
        "z_min": float(finite.min()),
        "z_max": float(finite.max()),
        "cut_area_m2": cut,
        "fill_area_m2": fill,
        "nodata_fraction": float(sum(int(np.isnan(z).sum()) for z in zs) / (n * len(zs))),
    }


def length_3d(vertices, frame: SiteFrame, ref: SurfaceRef, scale: float) -> tuple[float | None, float]:
    """The slope length over `ref` in ground metres, and the nodata fraction. A step with a NaN
    end counts flat; with no value under the line at all: (None, 1.0)."""
    k = unit_factor(frame)
    grid_m = distance_results(vertices, frame)["grid_length_m"]
    n = max(2, min(MAX_3D_SAMPLES, math.ceil(grid_m / ref.cell_size_m) + 1))
    s, xs, ys = densify(vertices, n)
    z = sample_surface(ref, xs, ys, frame, float(s[-1] * k / (n - 1)))
    nodata = float(np.isnan(z).mean())
    if nodata == 1.0:
        return None, 1.0
    ds = np.diff(s) * k / scale
    dz = np.diff(z)
    ok = np.isfinite(dz)
    return float(np.sqrt(ds[ok] ** 2 + dz[ok] ** 2).sum() + ds[~ok].sum()), nodata
