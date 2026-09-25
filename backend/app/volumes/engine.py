"""The volume engine (spec 2026-09-23-volumes §6, §7.1): pure, no database.

Prism per cell: dz = top - (base + shift), fill = Σ max(dz, 0) A, cut = Σ max(-dz, 0) A, float64,
over the cells whose centre is in the polygon. The loop runs window by window (≤ 2048², on the top
surface's lattice, over the polygon's bbox - past the grid's edge too, where cells are nodata), so
memory never depends on the site. Every number carries its areas, what was masked, what had no
data, and named uncertainty terms.
"""

from __future__ import annotations

import math
from collections.abc import Callable
from dataclasses import dataclass, field
from pathlib import Path

import numpy as np
from pyproj import CRS, Proj, Transformer
from rasterio.windows import Window
from shapely.geometry import Polygon, box
from shapely.ops import unary_union

from app.surfaces.grid import BLOCK, MAX_READ, SurfaceReader, SurfaceWriter, resample_onto
from app.volumes.alignment import alignment_warnings, measure_alignment
from app.volumes.bases import (
    EDGE_WARN,
    FIT_POOR_M,
    BaseFitError,
    Flat,
    fit_toe_plane,
    fit_toe_surface,
    flat_fit,
    sample_edge,
)
from app.volumes.regions import cells_in, form_regions, lattice_window, paste, patch_part

ENGINE_VERSION = 1  # bump on any change to the maths: every stored result then turns stale
NODATA_WARN = 0.02
NODATA_DANGER = 0.10
DIFF_SCALE_MIN_M = 0.1
DIFF_SAMPLE = 1_000_000
MIN_POLYGON_CELLS = 25
TOE_KINDS = ("toe_plane", "toe_surface")


class EngineFailure(Exception):
    """The measurement cannot be computed; the message is written for the operator."""


@dataclass
class EngineInputs:
    polygon: list[list[float]]
    top: SurfaceReader
    base_kind: str  # toe_plane | toe_surface | flat | surface
    base_z: float | None = None
    base: SurfaceReader | None = None
    footprints: list[Polygon] = field(default_factory=list)
    exclusions: list[tuple[list[list[float]], str]] = field(default_factory=list)
    stable_polygon: list[list[float]] | None = None
    apply_shift: bool = False
    extra_warnings: list[dict] = field(default_factory=list)
    diff_path: Path | None = None
    progress: Callable[[float, str], None] = lambda f, m: None
    check_cancelled: Callable[[], None] = lambda: None


def ring_polygon(ring: list[list[float]]) -> Polygon:
    """The measurement polygon: a repeated closing vertex and the winding do not matter."""
    pts = [tuple(map(float, p)) for p in ring]
    if len(pts) > 3 and pts[0] == pts[-1]:
        pts = pts[:-1]
    poly = Polygon(pts)
    if len(pts) < 3 or not poly.is_valid or poly.area <= 0:
        raise EngineFailure("the polygon crosses itself or has no area; redraw it")
    return poly


def areal_scale(crs_wkt: str | None, x: float, y: float) -> float:
    """Grid-to-ground areal scale factor at (x, y); 1 for local metres."""
    if crs_wkt is None:
        return 1.0
    crs = CRS.from_user_input(crs_wkt)
    lon, lat = Transformer.from_crs(crs, CRS.from_epsg(4326), always_xy=True).transform(x, y)
    return float(Proj(crs).get_factors(lon, lat).areal_scale)


def _warning(code: str, severity: str, message: str) -> dict:
    return {"code": code, "severity": severity, "message": message}


def _blocks(window: Window) -> Window:
    """`window` expanded outward to BLOCK multiples (offsets may be negative)."""
    c0 = (int(window.col_off) // BLOCK) * BLOCK
    r0 = (int(window.row_off) // BLOCK) * BLOCK
    c1 = -(-(int(window.col_off) + int(window.width)) // BLOCK) * BLOCK
    r1 = -(-(int(window.row_off) + int(window.height)) // BLOCK) * BLOCK
    return Window(c0, r0, c1 - c0, r1 - r0)


def _steps(ext: Window) -> list[Window]:
    c0, r0, w, h = int(ext.col_off), int(ext.row_off), int(ext.width), int(ext.height)
    return [
        Window(c, r, min(MAX_READ, c0 + w - c), min(MAX_READ, r0 + h - r))
        for r in range(r0, r0 + h, MAX_READ)
        for c in range(c0, c0 + w, MAX_READ)
    ]


def _quads(a: np.ndarray) -> np.ndarray:
    h2, w2 = (a.shape[0] // 2) * 2, (a.shape[1] // 2) * 2
    return a[:h2, :w2].reshape(h2 // 2, 2, w2 // 2, 2)


def measure(inp: EngineInputs) -> dict:
    """The numeric part of VolumeResults (spec §6.9); the job adds provenance, inputs and times."""
    spec = inp.top.spec
    cell = spec.cell_size
    area_cell = cell * cell
    poly = ring_polygon(inp.polygon)
    if poly.area / area_cell < MIN_POLYGON_CELLS:
        raise EngineFailure(f"the polygon covers fewer than {MIN_POLYGON_CELLS} cells of this surface")
    surface_base = inp.base_kind == "surface"
    if surface_base and inp.base is None:
        raise EngineFailure("the base surface is missing")
    regions = form_regions(inp.footprints, inp.exclusions, poly, spec)
    blocked = regions.blocked
    warnings = list(inp.extra_warnings)
    if regions.too_large:
        warnings.append(
            _warning(
                "patch_too_large",
                "warn",
                f"{len(regions.too_large)} masked area(s) larger than 400 m² were not interpolated; "
                "their cells count as no data",
            )
        )

    def read_top(win: Window) -> np.ndarray:
        return inp.top.read(win, boundless=True).astype(np.float64)

    def read_base(win: Window) -> np.ndarray:
        return resample_onto(inp.base, spec, win).astype(np.float64)

    # 1. Alignment (surface base only).
    stats = None
    if surface_base:
        inp.progress(0.02, "checking the stable area")
        if inp.stable_polygon:
            stats = measure_alignment(
                spec, read_top, read_base, inp.stable_polygon, blocked, check_cancelled=inp.check_cancelled
            )
        warnings += alignment_warnings(
            stats, has_stable=bool(inp.stable_polygon), apply_shift=inp.apply_shift
        )
    shift = stats.median_dz if (inp.apply_shift and stats is not None) else 0.0

    # 2. The base model (toe kinds and flat) from observed edge ground.
    model, fit = None, None
    if not surface_base:
        inp.progress(0.05, "fitting the base")
        try:
            edge = sample_edge(inp.top, inp.polygon, blocked, require=inp.base_kind != "flat")
            if inp.base_kind == "toe_plane":
                model, fit = fit_toe_plane(edge)
            elif inp.base_kind == "toe_surface":
                model, fit = fit_toe_surface(edge)
            else:
                if inp.base_z is None:
                    raise EngineFailure("a flat base needs a height")
                model, fit = Flat(inp.base_z), flat_fit(edge, inp.base_z)
        except BaseFitError as e:
            raise EngineFailure(str(e)) from e
        if fit.usable_edge_fraction < EDGE_WARN:
            warnings.append(
                _warning(
                    "edge_coverage_low",
                    "warn",
                    f"only {fit.usable_edge_fraction:.0%} of the polygon edge is on observed ground",
                )
            )
        if inp.base_kind in TOE_KINDS and fit.rms_m > FIT_POOR_M:
            warnings.append(
                _warning(
                    "base_fit_poor",
                    "warn",
                    f"the toe departs from the base by {fit.rms_m:.2f} m RMS: it is not planar or smooth, "
                    "so the choice of base kind matters",
                )
            )

    # 3. The measure loop.
    ext = _blocks(lattice_window(spec, poly.bounds))
    diff_spec = spec.crop(ext)
    windows = _steps(ext)
    others = [blocked.difference(p) if blocked is not None else None for p in regions.patch_parts]
    too_large = unary_union(regions.too_large) if regions.too_large else None
    k = max(1, math.ceil(poly.area / area_cell / DIFF_SAMPLE))
    acc = dict.fromkeys(("fill", "cut", "fill0", "cut0", "abs", "fill2", "fill1"), 0.0)
    n = dict.fromkeys(("inside", "excluded", "measured", "nodata", "masked", "full"), 0)
    part_rms: dict[int, tuple[float, float]] = {}
    failed_parts: set[int] = set()
    samples: list[np.ndarray] = []
    writer = (
        SurfaceWriter(inp.diff_path, diff_spec, check_cancelled=inp.check_cancelled)
        if inp.diff_path
        else None
    )
    if writer:
        writer.__enter__()
    try:
        for i, win in enumerate(windows, 1):
            inp.check_cancelled()
            inp.progress(0.1 + 0.85 * (i - 1) / len(windows), f"window {i} / {len(windows)}")
            inside = cells_in(poly, spec, win, all_touched=False)
            if not inside.any():
                continue
            top = read_top(win)
            xs, ys = spec.cell_centres(win)
            if surface_base:
                base = read_base(win)
            else:
                base = np.full(top.shape, np.nan)
                base[inside] = model.z_at(xs[inside], ys[inside])
            excluded = inside & cells_in(regions.exclude, spec, win, all_touched=True)
            failed = cells_in(too_large, spec, win, all_touched=True)
            patched = np.zeros(top.shape, dtype=bool)
            unused = np.zeros(top.shape, dtype=bool)
            win_box = box(
                *spec.window_transform(win) * (0, int(win.height)),
                *spec.window_transform(win) * (int(win.width), 0),
            )
            for j, part in enumerate(regions.patch_parts):
                if not part.intersects(win_box):
                    continue
                outcome = patch_part(part, spec, read_top, others[j])
                paste(outcome, top, win, patched, failed)
                if outcome.ok:
                    part_rms[j] = (float(part.intersection(poly).area), outcome.rms_m)
                else:
                    failed_parts.add(j)
                if surface_base:
                    paste(patch_part(part, spec, read_base, others[j]), base, win, unused, failed)
            usable = inside & ~excluded
            measured = usable & np.isfinite(top) & np.isfinite(base) & ~failed
            dz0 = top - base
            dz = dz0 - shift
            d, d0 = dz[measured], dz0[measured]
            acc["fill"] += float(np.clip(d, 0, None).sum())
            acc["cut"] += float(np.clip(-d, 0, None).sum())
            acc["fill0"] += float(np.clip(d0, 0, None).sum())
            acc["cut0"] += float(np.clip(-d0, 0, None).sum())
            acc["abs"] += float(np.abs(d).sum())
            n["inside"] += int(inside.sum())
            n["excluded"] += int(excluded.sum())
            n["measured"] += int(measured.sum())
            n["nodata"] += int((usable & ~measured).sum())
            n["masked"] += int((measured & patched).sum())
            full = _quads(measured).all(axis=(1, 3))
            if full.any():
                dz2 = _quads(top).mean(axis=(1, 3)) - _quads(base).mean(axis=(1, 3)) - shift
                acc["fill2"] += 4.0 * float(np.clip(dz2[full], 0, None).sum())
                acc["fill1"] += float(np.clip(_quads(dz), 0, None).sum(axis=(1, 3))[full].sum())
                n["full"] += 4 * int(full.sum())
            rows = np.arange(
                int(win.row_off) - int(ext.row_off), int(win.row_off) - int(ext.row_off) + top.shape[0]
            )
            cols = np.arange(
                int(win.col_off) - int(ext.col_off), int(win.col_off) - int(ext.col_off) + top.shape[1]
            )
            pick = measured & ((rows[:, None] * int(ext.width) + cols[None, :]) % k == 0)
            samples.append(np.abs(dz[pick]))
            if writer:
                writer.write_block(
                    Window(
                        int(win.col_off) - int(ext.col_off),
                        int(win.row_off) - int(ext.row_off),
                        top.shape[1],
                        top.shape[0],
                    ),
                    np.where(measured, dz, np.nan),
                )
        if n["measured"] == 0:
            raise EngineFailure(
                "nothing inside the polygon could be measured: the surfaces have no data there"
            )
        inp.progress(0.96, "building zoom levels")
        if writer:
            writer.finish()
    finally:
        if writer:
            writer.__exit__(None, None, None)

    # 4. Areas, uncertainty and warnings.
    if failed_parts:
        warnings.append(
            _warning(
                "patch_failed",
                "warn",
                f"{len(failed_parts)} masked area(s) could not be re-interpolated (too little valid "
                "ground around them); their cells count as no data",
            )
        )
    area = (n["inside"] - n["excluded"]) * area_cell
    measured_area = n["measured"] * area_cell
    nodata_area = n["nodata"] * area_cell
    mean_abs = acc["abs"] / n["measured"]
    if inp.base_kind in TOE_KINDS:
        base_m3 = measured_area * fit.rms_m
    elif inp.base_kind == "flat":
        base_m3 = 0.0
    else:
        base_m3 = None
    alignment_m3 = None
    if surface_base and stats is not None:
        sigma = stats.sigma
        alignment_m3 = measured_area * (sigma if inp.apply_shift else math.hypot(stats.median_dz, sigma))
    cell_m3 = abs(acc["fill2"] - acc["fill1"]) * area_cell * (n["measured"] / n["full"]) if n["full"] else 0.0
    nodata_m3 = nodata_area * mean_abs
    patch_m3 = sum(a * rms for a, rms in part_rms.values())
    terms = [t for t in (base_m3, alignment_m3, cell_m3, nodata_m3, patch_m3) if t is not None]
    total = math.sqrt(sum(t * t for t in terms))
    share = nodata_area / area if area else 0.0
    if share > NODATA_WARN:
        warnings.append(
            _warning(
                "nodata_high",
                "danger" if share > NODATA_DANGER else "warn",
                f"No data: {nodata_area:,.1f} m² ({share:.1%}) — volume there is unknown, "
                f"estimated ± {nodata_m3:,.1f} m³",
            )
        )
    excl_poly = regions.exclude
    polygon_area = poly.difference(excl_poly).area if excl_poly is not None else poly.area
    c = poly.centroid
    sample = np.concatenate(samples) if samples else np.empty(0)
    fill, cut = acc["fill"] * area_cell, acc["cut"] * area_cell
    return {
        "fill_m3": fill,
        "cut_m3": cut,
        "net_m3": fill - cut,
        "unshifted": (
            {
                "fill_m3": acc["fill0"] * area_cell,
                "cut_m3": acc["cut0"] * area_cell,
                "net_m3": (acc["fill0"] - acc["cut0"]) * area_cell,
            }
            if shift
            else None
        ),
        "area_m2": area,
        "polygon_area_m2": float(polygon_area),
        "measured_area_m2": measured_area,
        "masked_area_m2": n["masked"] * area_cell,
        "excluded_area_m2": n["excluded"] * area_cell,
        "nodata_area_m2": nodata_area,
        "cell_size_m": cell,
        "areal_scale_factor": areal_scale(spec.crs_wkt, c.x, c.y),
        "shift_applied_m": shift,
        "alignment": stats.to_json() if stats is not None else None,
        "base_fit": fit.to_json() if fit is not None else None,
        "uncertainty": {
            "total_m3": total,
            "base_m3": base_m3,
            "alignment_m3": alignment_m3,
            "cell_size_m3": cell_m3,
            "nodata_m3": nodata_m3,
            "patch_m3": patch_m3,
            "complete": not (surface_base and alignment_m3 is None),
        },
        "warnings": warnings,
        "footprints_used": regions.footprints_used,
        "patch_regions": len(regions.patch_parts) + len(regions.too_large),
        "diff_scale_m": max(DIFF_SCALE_MIN_M, float(np.percentile(sample, 98)) if sample.size else 0.0),
    }
