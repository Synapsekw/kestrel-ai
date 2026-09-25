"""Clutter and exclusion regions, and patching (spec 2026-09-23-volumes §6.5).

Patch regions (detection footprints plus "patch" exclusions, merged) are re-interpolated from a
ring of the surrounding ground of the same surface; exclude regions are taken out of the
measurement. A patch part is an estimate, so its area and ring roughness feed the ± (§7.1).
"""

from __future__ import annotations

import math
from collections.abc import Callable
from dataclasses import dataclass

import numpy as np
from rasterio.features import geometry_mask
from rasterio.windows import Window
from scipy.interpolate import LinearNDInterpolator
from scipy.spatial import Delaunay, QhullError
from shapely.geometry import MultiPolygon, Polygon
from shapely.geometry.base import BaseGeometry
from shapely.ops import unary_union

from app.surfaces.grid import MAX_READ, GridSpec

MAX_PATCH_AREA_M2 = 400.0
RING_MIN_WIDTH_M = 0.3
MIN_RING_CELLS = 8
MIN_QUADRANTS = 3


def lattice_window(spec: GridSpec, bounds: tuple[float, float, float, float], pad: int = 0) -> Window:
    """The cells of `spec`'s lattice whose area meets `bounds`, grown by `pad` - **not** clipped to
    the grid (offsets may be negative), for boundless reads."""
    c = spec.cell_size
    minx, miny, maxx, maxy = bounds
    c0 = math.floor(round((minx - spec.x0) / c, 9)) - pad
    c1 = max(math.ceil(round((maxx - spec.x0) / c, 9)), c0 + pad + 1) + pad
    r0 = math.floor(round((spec.y0 - maxy) / c, 9)) - pad
    r1 = max(math.ceil(round((spec.y0 - miny) / c, 9)), r0 + pad + 1) + pad
    return Window(c0, r0, c1 - c0, r1 - r0)


def cells_in(geom: BaseGeometry, spec: GridSpec, window: Window, *, all_touched: bool) -> np.ndarray:
    """Boolean (h, w): the window's cells in `geom`; centre rule unless `all_touched`."""
    shape = (int(window.height), int(window.width))
    if geom is None or geom.is_empty:
        return np.zeros(shape, dtype=bool)
    return geometry_mask(
        [geom], out_shape=shape, transform=spec.window_transform(window), all_touched=all_touched, invert=True
    )


def _parts(geom: BaseGeometry) -> list[Polygon]:
    if geom.is_empty:
        return []
    if isinstance(geom, Polygon):
        return [geom]
    if isinstance(geom, MultiPolygon):
        return list(geom.geoms)
    return [g for g in getattr(geom, "geoms", []) if isinstance(g, Polygon)]


@dataclass
class Regions:
    patch_parts: list[Polygon]  # interpolated from their ring
    too_large: list[Polygon]  # > 400 m² (or a window past MAX_READ): nodata, `patch_too_large`
    exclude: BaseGeometry | None  # removed from the measurement
    footprints_used: int

    @property
    def blocked(self) -> BaseGeometry | None:
        """Everything that is not observed ground: edge samples and rings avoid it."""
        geoms = [*self.patch_parts, *self.too_large]
        if self.exclude is not None:
            geoms.append(self.exclude)
        return unary_union(geoms) if geoms else None


def form_regions(
    footprints: list[Polygon],
    exclusions: list[tuple[list[list[float]], str]],
    measure: Polygon,
    spec: GridSpec,
) -> Regions:
    """Patch regions = union(footprints ∪ patch exclusions), split into parts; parts that miss the
    measurement polygon are dropped. Exclude regions = union(exclude exclusions)."""
    used = [f for f in footprints if f.intersects(measure)]
    patches = [*used, *(Polygon(r) for r, mode in exclusions if mode == "patch")]
    excludes = [Polygon(r) for r, mode in exclusions if mode == "exclude"]
    parts = [p for p in _parts(unary_union(patches)) if p.intersects(measure)] if patches else []
    ring = max(2 * spec.cell_size, RING_MIN_WIDTH_M)
    pad = math.ceil(ring / spec.cell_size) + 1
    small, large = [], []
    for part in parts:
        win = lattice_window(spec, part.bounds, pad)
        too_big = part.area > MAX_PATCH_AREA_M2 or max(int(win.width), int(win.height)) > MAX_READ
        (large if too_big else small).append(part)
    exclude = unary_union(excludes) if excludes else None
    return Regions(small, large, exclude, len(used))


@dataclass
class PatchOutcome:
    ok: bool
    window: Window  # the part's own window on the lattice
    cells: np.ndarray  # the part's cells in that window (all_touched)
    values: np.ndarray | None  # float64 heights on `cells`; None when the patch failed
    rms_m: float
    area_m2: float


def patch_part(
    part: Polygon, spec: GridSpec, read: Callable[[Window], np.ndarray], others: BaseGeometry | None
) -> PatchOutcome:
    """Heights for the part's cells from a linear TIN through the valid ring cells around it
    (outside every other region); cells outside the TIN hull take the ring's plane. Fails (the
    cells become nodata) with fewer than 8 ring cells or rings covering fewer than 3 quadrants."""
    width = max(2 * spec.cell_size, RING_MIN_WIDTH_M)
    window = lattice_window(spec, part.bounds, math.ceil(width / spec.cell_size) + 1)
    data = np.asarray(read(window), dtype=np.float64)
    cells = cells_in(part, spec, window, all_touched=True)
    band = part.buffer(width).difference(part)
    ring = cells_in(band, spec, window, all_touched=False) & ~cells & np.isfinite(data)
    if others is not None and not others.is_empty:
        ring &= ~cells_in(others, spec, window, all_touched=True)
    failed = PatchOutcome(False, window, cells, None, 0.0, float(part.area))
    xs, ys = spec.cell_centres(window)
    rx, ry, rz = xs[ring], ys[ring], data[ring]
    if rx.size < MIN_RING_CELLS:
        return failed
    c = part.centroid
    quadrants = {(bool(dx >= 0), bool(dy >= 0)) for dx, dy in zip(rx - c.x, ry - c.y, strict=True)}
    if len(quadrants) < MIN_QUADRANTS:
        return failed
    design = np.column_stack([rx - c.x, ry - c.y, np.ones_like(rx)])
    coef = np.linalg.lstsq(design, rz, rcond=None)[0]
    rms = float(np.sqrt(np.mean(np.square(rz - design @ coef))))
    px, py = xs[cells], ys[cells]
    try:
        values = LinearNDInterpolator(Delaunay(np.column_stack([rx, ry])), rz)(px, py)
    except QhullError:
        return failed
    outside = ~np.isfinite(values)
    values[outside] = coef[0] * (px[outside] - c.x) + coef[1] * (py[outside] - c.y) + coef[2]
    return PatchOutcome(True, window, cells, values, rms, float(part.area))


def paste(
    outcome: PatchOutcome, target: np.ndarray, target_window: Window, patched: np.ndarray, nodata: np.ndarray
) -> None:
    """Apply a patch to the arrays of one measure window: heights into `target` and the cells into
    `patched` (success) or `nodata` (failure). Only the overlap of the two windows is touched."""
    oc0, or0 = int(outcome.window.col_off), int(outcome.window.row_off)
    tc0, tr0 = int(target_window.col_off), int(target_window.row_off)
    c0, r0 = max(oc0, tc0), max(or0, tr0)
    c1 = min(oc0 + int(outcome.window.width), tc0 + int(target_window.width))
    r1 = min(or0 + int(outcome.window.height), tr0 + int(target_window.height))
    if c1 <= c0 or r1 <= r0:
        return
    src = (slice(r0 - or0, r1 - or0), slice(c0 - oc0, c1 - oc0))
    dst = (slice(r0 - tr0, r1 - tr0), slice(c0 - tc0, c1 - tc0))
    cells = outcome.cells[src]
    if outcome.ok:
        full = np.full(outcome.cells.shape, np.nan)
        full[outcome.cells] = outcome.values
        target[dst][cells] = full[src][cells]
        patched[dst] |= cells
    else:
        nodata[dst] |= cells
