"""Placement (spec §5): swap, horizontal scale, Z scale, reprojection, the output and preview grids.

Vertices are moved (exact at the vertices); rasters are warped later by dem_build. The output grid
is always grid.aligned_grid: with a target it adopts the target's CRS and cell, so
same_lattice(output, target) holds and S2 reads both surfaces with an integer offset (case R1).
"""

from __future__ import annotations

import math
from dataclasses import dataclass

import numpy as np
from pyproj import CRS, Transformer

from app.surfaces import grid
from app.surfaces.design import codes
from app.surfaces.design.codes import DesignNote
from app.surfaces.design.units import (
    LinearUnit,
    UnsupportedCrsUnit,
    horizontal_crs,
    unit_from_factor,
    unit_to_m,
    xy_scale,
)

CHUNK = 1_000_000
PREVIEW_SIDE = 512
LARGE_GRID_CELLS = 250_000_000


class PlacementBlocked(Exception):
    """A `block` warning found while placing: the preview reports it and no import is possible."""

    def __init__(self, note: DesignNote):
        super().__init__(note.message)
        self.note = note


@dataclass(frozen=True)
class Placement:
    source_crs: CRS
    out_crs: CRS | None
    out_crs_wkt: str | None
    out_epsg: int | None
    cell_size: float
    swap_xy: bool
    xy_factor: float
    z_factor: float

    def transformer(self) -> Transformer | None:
        if self.out_crs is None or self.source_crs.equals(self.out_crs):
            return None
        return Transformer.from_crs(self.source_crs, self.out_crs, always_xy=True)


def parse_crs(text: str) -> CRS:
    return CRS.from_user_input(text.strip())


def resolve(options: dict, fmt: str, target: grid.GridSpec | None) -> Placement:
    """Options -> Placement. `target` is the target surface's GridSpec, or None."""
    src = parse_crs(options["source_crs"])
    try:
        xy = 1.0 if fmt == "geotiff" else xy_scale(options["horizontal_unit"], src)
    except UnsupportedCrsUnit as e:
        raise PlacementBlocked(codes.block("unsupported_crs_unit", str(e))) from None
    z = unit_to_m(options["vertical_unit"])
    swap = bool(options.get("swap_xy")) and fmt != "geotiff"
    if target is not None:
        out = CRS.from_wkt(target.crs_wkt) if target.crs_wkt else None
        return Placement(src, out, target.crs_wkt, target.epsg, target.cell_size, swap, xy, z)
    h = horizontal_crs(src)
    if not h.is_projected:
        raise PlacementBlocked(
            codes.block(
                "geographic_output",
                "the source CRS is geographic (degrees): choose a target cloud surface so the design "
                "lands on a grid in metres",
            )
        )
    if unit_from_factor(h.axis_info[0].unit_conversion_factor) is not LinearUnit.metre:
        raise PlacementBlocked(
            codes.block(
                "non_metric_output",
                f"the source CRS is in {h.axis_info[0].unit_name}: choose a target cloud surface so the "
                "design lands on a grid in metres",
            )
        )
    return Placement(src, h, h.to_wkt(), h.to_epsg(), float(options["cell_size_m"]), swap, xy, z)


def place_vertices(xyz, p: Placement, *, check_cancelled=None) -> np.ndarray:
    """File-unit vertices -> output CRS, Z in metres (spec §5 steps 1-4), in chunks of 1 M."""
    check = check_cancelled or (lambda: None)
    n = len(xyz)
    out = np.empty((n, 3), dtype=np.float64)
    tr = p.transformer()
    for s in range(0, n, CHUNK):
        check()
        c = np.asarray(xyz[s : s + CHUNK], dtype=np.float64)
        x, y = (c[:, 1], c[:, 0]) if p.swap_xy else (c[:, 0], c[:, 1])
        if p.xy_factor != 1.0:
            x, y = x * p.xy_factor, y * p.xy_factor
        if tr is not None:
            x, y = tr.transform(x, y)
        out[s : s + len(c), 0] = x
        out[s : s + len(c), 1] = y
        out[s : s + len(c), 2] = c[:, 2] * p.z_factor if p.z_factor != 1.0 else c[:, 2]
    if n and not np.isfinite(out[:, :2]).all():
        raise PlacementBlocked(
            codes.block(
                "empty_result",
                "the design's coordinates can't be placed in the output CRS — check the source CRS",
            )
        )
    return out


def xy_bounds(v: np.ndarray) -> tuple[float, float, float, float]:
    return float(v[:, 0].min()), float(v[:, 1].min()), float(v[:, 0].max()), float(v[:, 1].max())


def output_grid(bounds, p: Placement) -> tuple[grid.GridSpec, list[DesignNote]]:
    try:
        spec = grid.aligned_grid(tuple(bounds), p.cell_size, p.out_crs_wkt, p.out_epsg, max_cells=2**62)
    except grid.GridError as e:
        raise PlacementBlocked(
            codes.block("non_metric_output", f"the output grid can't be made: {e}")
        ) from None
    cells = spec.width * spec.height
    if cells > grid.MAX_CELLS:
        raise PlacementBlocked(
            codes.block(
                "grid_too_large",
                f"the output grid would have {cells:,} cells, more than the {grid.MAX_CELLS:,} a surface "
                "can hold: choose a coarser cell",
            )
        )
    notes = []
    if cells > LARGE_GRID_CELLS:
        notes.append(
            codes.info("large_grid", f"the output grid has {cells:,} cells: the import takes a few minutes")
        )
    return spec, notes


def preview_grid(bounds, out: grid.GridSpec) -> tuple[grid.GridSpec, int]:
    """aligned_grid at k x cell, k = ceil(max(w, h) / 512): each preview cell is k x k output cells."""
    k = max(1, math.ceil(max(out.width, out.height) / PREVIEW_SIDE))
    return grid.aligned_grid(tuple(bounds), k * out.cell_size, out.crs_wkt, out.epsg), k


def raster_envelope(transform, width: int, height: int) -> tuple[float, float, float, float]:
    """The axis-aligned envelope of a (possibly rotated) raster's four corners."""
    xs, ys = zip(*(transform @ c for c in ((0, 0), (width, 0), (width, height), (0, height))), strict=True)
    return min(xs), min(ys), max(xs), max(ys)
