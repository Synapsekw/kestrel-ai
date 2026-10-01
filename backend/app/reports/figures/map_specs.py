"""R9-M's one seam onto R0's block/spec models and R2's `ComposeContext.ref` (which reaches R3's
snapshot key). Everything R9-M prints as a picture is built here: a SnapshotSpec plus its ref, never
a rendered image (reports spec §8.2 step 4, §9.1). Sizes follow Ruling 1: 4:3 snapshots, 140x105 mm
plates, 83x52 mm locators."""

from __future__ import annotations

import logging
from collections.abc import Sequence

from app.reports import blocks
from app.reports.context import ComposeContext
from app.reports.figures import map_geo
from app.reports.schemas import ElevationSpec, Figure, MapSpec, PairSpec, SnapshotRef, VolumePlanSpec

OUT = (1200, 900)
MAIN_MM = (140.0, 105.0)
HALF_MM = (83.0, 52.0)
PLATE_MM = (140.0, 105.0)
MEASURE_COLOUR = "#8F7BFF"  # the print violet (spec §10.1)

log = logging.getLogger(__name__)


def compact(geometry: dict) -> dict:
    """R3's `compact_geometry` (rounded, simplified to <= 120 vertices) so the spec stays inside R3's
    vertex limit and the preview URL's `MAX_SPEC_CHARS`. Imported lazily, as `context._engine_key`
    does, so compose never needs PIL/shapely/rasterio at import; without the engine the geometry
    passes unchanged (the ref then carries the no-engine reason anyway), as does a shape shapely
    cannot read."""
    try:
        from shapely.errors import ShapelyError

        from app.reports.snapshots import SnapshotUnavailable
        from app.reports.snapshots.map_view import compact_geometry
    except ImportError:
        log.warning("the snapshot engine is not installed; a figure geometry is not compacted")
        return geometry
    try:
        return compact_geometry(geometry)
    except (ShapelyError, SnapshotUnavailable, ValueError, TypeError, IndexError, KeyError):
        return geometry  # a degenerate or unknown shape: R3 decides (it refuses what it cannot draw)


def ref(ctx: ComposeContext, spec) -> SnapshotRef:
    """`spec`'s `SnapshotRef` via R2's `ctx.ref`, the only path that honours a test's `key_for` and
    the no-engine fallback (controller Ruling P1). Sized from the spec's own `out`; a spec without
    one (`pair`, `volume_plan`) prints at the module's `OUT`."""
    out = getattr(spec, "out", None) or OUT
    return ctx.ref(spec, width_px=out[0], height_px=out[1])


def figure(ctx: ComposeContext, spec, caption: str, size_mm: tuple[float, float]) -> Figure:
    return blocks.figure(ref(ctx, spec), caption, size_mm[0], size_mm[1])


def _map_spec(map_id: str, geometry: dict, colour: str, label: str | None, inset: bool) -> MapSpec:
    return MapSpec(
        kind="map",
        item_id=map_id,
        geometry=compact(geometry),
        colour=colour,
        label=label,
        min_extent_m=40,
        out=list(OUT),
        scale_bar=True,
        north=True,
        inset=inset,
    )


def map_figure(
    ctx: ComposeContext,
    *,
    map_id: str,
    geometry: dict,
    colour: str,
    caption: str,
    label: str | None = None,
    size_mm: tuple[float, float] = PLATE_MM,
    inset: bool = False,
) -> Figure:
    return figure(ctx, _map_spec(map_id, geometry, colour, label, inset), caption, size_mm)


def elevation_figure(
    ctx: ComposeContext,
    *,
    surface_id: str,
    geometry: dict,
    caption: str,
    size_mm: tuple[float, float] = PLATE_MM,
) -> Figure:
    spec = ElevationSpec(
        kind="elevation", item_id=surface_id, geometry=compact(geometry), overlay="none", out=list(OUT)
    )
    return figure(ctx, spec, caption, size_mm)


def pair_figure(
    ctx: ComposeContext,
    *,
    a_id: str,
    a_ring: Sequence[Sequence[float]],
    b_id: str,
    b_ring: Sequence[Sequence[float]],
    bbox_wgs84: Sequence[float],
    mode: str,
    caption: str,
    size_mm: tuple[float, float] = PLATE_MM,
) -> Figure:
    spec = PairSpec(
        kind="pair",
        a=_map_spec(a_id, map_geo.polygon(a_ring), MEASURE_COLOUR, None, False),
        b=_map_spec(b_id, map_geo.polygon(b_ring), MEASURE_COLOUR, None, False),
        bbox_wgs84=[float(v) for v in bbox_wgs84],
        mode=mode,
        split=0.5,
    )
    return figure(ctx, spec, caption, size_mm)


def volume_plan_figure(
    ctx: ComposeContext, *, measurement_id: str, caption: str, size_mm: tuple[float, float] = PLATE_MM
) -> Figure:
    return figure(ctx, VolumePlanSpec(kind="volume_plan", measurement_id=measurement_id), caption, size_mm)
