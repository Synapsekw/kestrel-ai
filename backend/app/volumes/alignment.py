"""Stable-area alignment check between two surveys (spec 2026-09-23-volumes §6.7).

Over the operator's stable polygon, d = top - base on cells valid in both and outside every clutter
region. Its median is the vertical offset (the only correction offered), its MAD the noise, and a
plane fitted to d says whether the surveys are tilted, which a shift cannot fix.
"""

from __future__ import annotations

import math
from collections.abc import Callable
from dataclasses import dataclass

import numpy as np
from rasterio.features import geometry_mask
from rasterio.windows import Window
from shapely.geometry import Polygon
from shapely.geometry.base import BaseGeometry

from app.surfaces.grid import GridSpec, read_windows

SAMPLE_MAX = 4_000_000
MIN_CELLS = 400
MIN_AREA_M2 = 50.0
OFFSET_M = 0.03
DATUM_M = 2.0
NOISY_M = 0.05
TILT_MM_PER_M = 0.5
TILT_DRIFT_M = 0.025
MAD_SCALE = 1.4826


def _cells(geom: BaseGeometry, spec: GridSpec, window: Window, *, all_touched: bool) -> np.ndarray:
    # Deliberately duplicates Task 5's regions.cells_in: keeps Tasks 5 and 6 buildable in parallel.
    shape = (int(window.height), int(window.width))
    return geometry_mask(
        [geom], out_shape=shape, transform=spec.window_transform(window), all_touched=all_touched, invert=True
    )


@dataclass(frozen=True)
class AlignmentStats:
    n_cells: int
    median_dz: float
    mad: float
    sigma: float
    tilt_mm_per_m: float
    span_m: float

    def to_json(self) -> dict:
        return {
            "n_cells": self.n_cells,
            "median_dz": self.median_dz,
            "mad": self.mad,
            "sigma": self.sigma,
            "tilt_mm_per_m": self.tilt_mm_per_m,
            "span_m": self.span_m,
        }


def measure_alignment(
    spec: GridSpec,
    read_top: Callable[[Window], np.ndarray],
    read_base: Callable[[Window], np.ndarray],
    stable_ring: list[list[float]],
    blocked: BaseGeometry | None,
    *,
    check_cancelled: Callable[[], None] = lambda: None,
) -> AlignmentStats | None:
    """The statistics, or None when the stable area has fewer than 400 usable cells or under 50 m².
    A deterministic stride (global cell index modulo k) keeps the sample at 4 M cells or fewer."""
    poly = Polygon(stable_ring)
    area_cell = spec.cell_size**2
    k = max(1, math.ceil(poly.area / area_cell / SAMPLE_MAX))
    within = spec.window_for_bounds(poly.bounds)
    ds, xs_all, ys_all = [], [], []
    valid_cells = 0
    for win in read_windows(spec, within):
        check_cancelled()
        inside = _cells(poly, spec, win, all_touched=False)
        if not inside.any():
            continue
        if blocked is not None and not blocked.is_empty:
            inside &= ~_cells(blocked, spec, win, all_touched=True)
        top, base = read_top(win), read_base(win)
        ok = inside & np.isfinite(top) & np.isfinite(base)
        valid_cells += int(ok.sum())
        r0, c0 = int(win.row_off), int(win.col_off)
        rows = np.arange(r0, r0 + ok.shape[0], dtype=np.int64)[:, None]
        cols = np.arange(c0, c0 + ok.shape[1], dtype=np.int64)[None, :]
        pick = ok & ((rows * spec.width + cols) % k == 0)
        if pick.any():
            x, y = spec.cell_centres(win)
            ds.append((top[pick] - base[pick]).astype(np.float64))
            xs_all.append(x[pick])
            ys_all.append(y[pick])
    d = np.concatenate(ds) if ds else np.empty(0)
    if d.size < MIN_CELLS or valid_cells * area_cell < MIN_AREA_M2:
        return None
    xs, ys = np.concatenate(xs_all), np.concatenate(ys_all)
    med = float(np.median(d))
    mad = float(np.median(np.abs(d - med)))
    sigma = MAD_SCALE * mad
    keep = np.abs(d - med) <= 3.0 * sigma + 1e-12
    cx, cy = float(xs[keep].mean()), float(ys[keep].mean())
    design = np.column_stack([xs[keep] - cx, ys[keep] - cy, np.ones(int(keep.sum()))])
    a, b, _ = np.linalg.lstsq(design, d[keep], rcond=None)[0]
    span = float(math.hypot(xs.max() - xs.min(), ys.max() - ys.min()))
    return AlignmentStats(int(d.size), med, mad, sigma, 1000.0 * float(math.hypot(a, b)), span)


def alignment_warnings(stats: AlignmentStats | None, *, has_stable: bool, apply_shift: bool) -> list[dict]:
    """The §6.7 checks for a surface base."""
    if not has_stable:
        return [
            _w(
                "no_stable_area",
                "warn",
                "no stable area is drawn: how well the two surveys agree is unknown, and the ± leaves it out",
            )
        ]
    if stats is None:
        return [
            _w(
                "stable_area_small",
                "warn",
                f"the stable area has fewer than {MIN_CELLS} usable cells or {MIN_AREA_M2:.0f} m²; "
                "draw it larger on ground that did not change",
            )
        ]
    out = []
    if abs(stats.median_dz) > DATUM_M:
        out.append(
            _w(
                "alignment_datum",
                "danger",
                f"the surveys differ by {stats.median_dz:+.2f} m on stable ground: "
                "different height references (ellipsoidal vs sea level?)",
            )
        )
    if abs(stats.median_dz) > OFFSET_M and not apply_shift:
        out.append(
            _w(
                "alignment_offset",
                "warn",
                f"surveys differ by {stats.median_dz:+.3f} m on stable ground; apply the shift?",
            )
        )
    if stats.sigma > NOISY_M:
        out.append(
            _w(
                "alignment_noisy",
                "warn",
                f"stable area disagrees by ±{stats.sigma:.3f} m — is it really unchanged, "
                "or are the surveys offset horizontally?",
            )
        )
    if stats.tilt_mm_per_m > TILT_MM_PER_M and stats.tilt_mm_per_m * stats.span_m / 1000.0 > TILT_DRIFT_M:
        out.append(
            _w(
                "alignment_tilt",
                "warn",
                f"tilted by {stats.tilt_mm_per_m:.2f} mm/m: a vertical shift cannot correct this; "
                "tie both flights to the same control",
            )
        )
    return out


def _w(code: str, severity: str, message: str) -> dict:
    return {"code": code, "severity": severity, "message": message}
