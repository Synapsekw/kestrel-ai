"""Validation of a preview against the target surface (spec §10).

All target reads are overview reads: one SurfaceReader.read at <= 512 px for the whole target, and
grid.resample_onto on the preview grid (at most 513 x 513). The hypotheses re-place up to 20 000
sampled file vertices under each alternative (swap, other units) and look them up in the overview.
"""

from __future__ import annotations

from dataclasses import dataclass, field

import numpy as np
from pyproj import CRS
from rasterio.windows import Window

from app.surfaces import grid
from app.surfaces.design import codes, preview_image
from app.surfaces.design import placement as placing
from app.surfaces.design.codes import DesignNote
from app.surfaces.design.units import (
    FEET,
    UNIT_LABEL,
    LinearUnit,
    UnsupportedCrsUnit,
    crs_axis_unit,
    horizontal_crs,
)

OVERVIEW_SIDE = 512
NO_OVERLAP, LOW_OVERLAP = 0.05, 0.5
SUGGEST_MIN, SUGGEST_GAIN = 0.5, 0.30
Z_OFFSET_M = 15.0
Z_RANGE_MIN_M = 2.0
FOOT_RATIOS = (3.2808, 0.3048)
LOCAL_LIMIT = 100_000.0


def _pct(x: float) -> str:
    return f"{round(100 * x)} %"


@dataclass
class TargetOverview:
    z: np.ndarray
    x0: float
    y0: float
    cell_x: float
    cell_y: float
    crs_wkt: str | None

    @property
    def _layer(self) -> preview_image.Layer:
        # bounds is the same north-up-raster geometry as preview_image.Layer; the Layer computes
        # it once and TargetOverview reuses that instead of repeating the arithmetic here.
        return preview_image.Layer(self.z, self.x0, self.y0, self.cell_x, self.cell_y)

    @property
    def bounds(self) -> tuple[float, float, float, float]:
        return self._layer.bounds

    @property
    def valid_area_m2(self) -> float:
        return float(np.isfinite(self.z).sum()) * self.cell_x * self.cell_y

    def sample(self, x, y) -> np.ndarray:
        h, w = self.z.shape
        col = np.floor((np.asarray(x) - self.x0) / self.cell_x).astype(np.int64)
        row = np.floor((self.y0 - np.asarray(y)) / self.cell_y).astype(np.int64)
        ok = (col >= 0) & (col < w) & (row >= 0) & (row < h)
        out = np.full(np.shape(x), np.nan, np.float32)
        out[ok] = self.z[row[ok], col[ok]]
        return out


def read_target_overview(reader) -> TargetOverview:
    spec = reader.spec
    f = max(1.0, max(spec.width, spec.height) / OVERVIEW_SIDE)
    h, w = max(1, round(spec.height / f)), max(1, round(spec.width / f))
    z = reader.read(Window(0, 0, spec.width, spec.height), out_shape=(h, w))
    return TargetOverview(
        z, spec.x0, spec.y0, spec.width * spec.cell_size / w, spec.height * spec.cell_size / h, spec.crs_wkt
    )


@dataclass
class ValidationInput:
    fmt: str
    options: dict
    detected: dict
    internal: dict
    file_bounds: tuple[float, float, float, float]
    placement: placing.Placement
    design: np.ndarray
    pspec: grid.GridSpec
    target_spec: grid.GridSpec | None = None
    target_on_preview: np.ndarray | None = None
    overview: TargetOverview | None = None
    samples: np.ndarray | None = None
    tin: dict = field(default_factory=dict)


@dataclass
class ValidationResult:
    overlap_fraction: float | None
    target_covered_fraction: float | None
    design_area_m2: float
    z_check: dict | None
    warnings: list[DesignNote]
    suggestions: list[dict]


def validate(v: ValidationInput) -> ValidationResult:
    notes: list[DesignNote] = []
    dvalid = np.isfinite(v.design)
    n_design = int(dvalid.sum())
    cell_area = v.pspec.cell_size**2
    if n_design == 0:
        notes.append(
            codes.block(
                "empty_result",
                "the design covers no cell of the grid — check the CRS, the units and the selection",
            )
        )
    overlap = covered = z_check = None
    suggestions: list[dict] = []
    if v.target_on_preview is None:
        notes.append(
            codes.info(
                "no_target", "no cloud surface was chosen, so the design can't be checked against the site"
            )
        )
    else:
        t = v.target_on_preview
        both = dvalid & np.isfinite(t)
        n_both = int(both.sum())
        overlap = n_both / n_design if n_design else 0.0
        area = v.overview.valid_area_m2 if v.overview is not None else 0.0
        covered = min(1.0, n_both * cell_area / area) if area > 0 else 0.0
        if overlap < NO_OVERLAP:
            notes.append(
                codes.warn(
                    "no_overlap",
                    f"the design and the cloud surface don't overlap "
                    f"({_pct(overlap)} of the design lies on it)",
                )
            )
        elif overlap < LOW_OVERLAP:
            notes.append(
                codes.warn("low_overlap", f"only {_pct(overlap)} of the design lies on the cloud surface")
            )
        if n_both:
            z_check = _z_check(v.design, t, dvalid, both, notes)
        suggestions = _suggestions(v)
    notes += _coordinate_notes(v)
    notes += _tin_notes(v.tin)
    return ValidationResult(overlap, covered, n_design * cell_area, z_check, notes, suggestions)


def _z_check(design, t, dvalid, both, notes) -> dict:
    dz = design[both].astype(np.float64) - t[both]
    med, p5, p95 = (float(x) for x in np.percentile(dz, [50, 5, 95]))
    if abs(med) > Z_OFFSET_M:
        notes.append(
            codes.warn(
                "z_offset",
                f"the design sits {med:+.1f} m from the cloud surface (median) — "
                "ellipsoidal vs orthometric heights, or a units problem; "
                "S2's alignment check can measure and apply a vertical shift",
            )
        )
    d_lo, d_hi = np.percentile(design[both], [5, 95])
    t_lo, t_hi = np.percentile(t[both], [5, 95])
    d_range, t_range = float(d_hi - d_lo), float(t_hi - t_lo)
    if d_range > Z_RANGE_MIN_M and t_range > Z_RANGE_MIN_M:
        ratio = d_range / t_range
        if any(abs(ratio - f) <= 0.15 * f for f in FOOT_RATIOS):
            notes.append(
                codes.warn(
                    "z_units",
                    f"the design's height range is {ratio:.2f} × the cloud surface's — the heights may "
                    "be in feet read as metres, or the other way round",
                )
            )
    dsg = design[dvalid]
    return {
        "median_dz_m": med,
        "p05_dz_m": p5,
        "p95_dz_m": p95,
        "n_samples": int(both.sum()),
        "design_z_min_m": float(dsg.min()),
        "design_z_max_m": float(dsg.max()),
    }


def _file_unit(v: ValidationInput) -> LinearUnit | None:
    if v.fmt != "geotiff":
        return LinearUnit(v.options["horizontal_unit"])
    try:
        return crs_axis_unit(v.placement.source_crs)
    except UnsupportedCrsUnit:
        return None


def _coordinate_notes(v: ValidationInput) -> list[DesignNote]:
    out: list[DesignNote] = []
    minx, miny, maxx, maxy = v.file_bounds
    maxabs = max(abs(minx), abs(miny), abs(maxx), abs(maxy))
    projected = horizontal_crs(v.placement.source_crs).is_projected
    if projected and v.fmt != "geotiff" and -180 <= minx and maxx <= 180 and -90 <= miny and maxy <= 90:
        out.append(
            codes.warn(
                "looks_geographic",
                "the coordinates look like degrees, but the source CRS is projected — check the CRS",
            )
        )
    if (
        v.target_spec is not None
        and v.target_spec.crs_wkt
        and CRS.from_wkt(v.target_spec.crs_wkt).is_projected
    ):
        if maxabs < LOCAL_LIMIT and max(abs(b) for b in v.target_spec.bounds) > LOCAL_LIMIT:
            out.append(
                codes.warn(
                    "looks_local", "coordinates look like a local site grid; site calibration isn't supported"
                )
            )
    if _file_unit(v) in FEET or v.internal.get("insunits") == 2:
        shift = maxabs * 2e-6 * 0.3048
        out.append(
            codes.warn(
                "foot_ambiguity",
                "US survey and international feet differ by 2 ppm: survey vs international foot moves "
                f"this design by up to {shift:.2f} m — check which foot the designer used",
            )
        )
    if v.fmt != "geotiff" and projected and v.placement.xy_factor != 1.0:
        label = UNIT_LABEL[LinearUnit(v.options["horizontal_unit"])]
        out.append(
            codes.info(
                "units_mismatch_crs",
                f"the file's unit ({label}) differs from the CRS unit: coordinates were scaled by "
                f"{v.placement.xy_factor:.9g}",
            )
        )
    if v.fmt == "dxf" and v.internal.get("insunits") == 0 and v.options["horizontal_unit"] == "metre":
        out.append(
            codes.warn(
                "units_assumed",
                "the DXF declares no unit ($INSUNITS=0); metres were assumed — confirm the unit",
            )
        )
    detected = v.detected or {}
    chosen = v.placement.source_crs
    if detected.get("crs_wkt") and chosen.equals(CRS.from_wkt(detected["crs_wkt"])):
        out.append(
            codes.info("crs_from_file", f"CRS from the file ({detected.get('crs_source') or 'its CRS'})")
        )
    elif not detected.get("crs_wkt") and v.target_spec is not None and v.target_spec.crs_wkt:
        if chosen.equals(CRS.from_wkt(v.target_spec.crs_wkt)):
            out.append(
                codes.info(
                    "crs_assumed", "the file names no CRS; the cloud surface's CRS was assumed — confirm it"
                )
            )
    return out


def _tin_notes(tin: dict) -> list[DesignNote]:
    out: list[DesignNote] = []
    if tin.get("overlapping_triangles"):
        out.append(
            codes.warn(
                "overlapping_triangles",
                f"{tin['overlapping_triangles']:,} triangles overlap others (a folded or broken TIN); "
                "where they overlap the last one wins",
            )
        )
    if "long_edges_removed" in tin:
        limit = tin.get("max_edge_m") or 0.0
        message = (
            f"{tin['long_edges_removed']:,} long triangles were trimmed from the edges "
            f"(maximum edge {limit:.1f} m)"
            if limit > 0
            else "edge trimming is off (maximum edge 0)"
        )
        out.append(codes.info("long_edges_removed", message))
    if tin.get("duplicate_points"):
        out.append(
            codes.info(
                "duplicate_points",
                f"{tin['duplicate_points']:,} positions had different heights (crossing contours?) "
                "and were averaged",
            )
        )
    if tin.get("degenerate_triangles"):
        out.append(
            codes.info(
                "degenerate_triangles", f"{tin['degenerate_triangles']:,} zero-area triangles were skipped"
            )
        )
    return out


def _sample_overlap(v: ValidationInput, options: dict) -> float:
    try:
        p = placing.resolve(options, v.fmt, v.target_spec)
        xy = placing.place_vertices(v.samples, p)
    except placing.PlacementBlocked:
        return 0.0
    return float(np.isfinite(v.overview.sample(xy[:, 0], xy[:, 1])).mean())


def _suggestions(v: ValidationInput) -> list[dict]:
    if v.fmt == "geotiff" or v.samples is None or len(v.samples) == 0 or v.overview is None:
        return []
    current = _sample_overlap(v, v.options)
    variants = [("swap_xy", {"swap_xy": not bool(v.options.get("swap_xy"))})]
    variants += [
        ("horizontal_unit", {"horizontal_unit": u.value})
        for u in LinearUnit
        if u.value != v.options["horizontal_unit"]
    ]
    best: dict[str, dict] = {}
    for code, patch in variants:
        frac = _sample_overlap(v, {**v.options, **patch})
        if frac < SUGGEST_MIN or frac - current < SUGGEST_GAIN:
            continue
        if frac > best.get(code, {}).get("overlap_fraction", -1.0):
            message = (
                f"With easting/northing swapped the design covers {_pct(frac)} of the cloud surface."
                if code == "swap_xy"
                else f"Read in {UNIT_LABEL[LinearUnit(patch['horizontal_unit'])]} the design covers "
                f"{_pct(frac)} of the cloud surface."
            )
            best[code] = {"code": code, "message": message, "overlap_fraction": frac, "options_patch": patch}
    return sorted(best.values(), key=lambda s: -s["overlap_fraction"])
