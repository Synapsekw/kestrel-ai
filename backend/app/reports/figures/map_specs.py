"""R9-M's one seam onto R0's block/spec models and R2's `ComposeContext.ref` (which reaches R3's
snapshot key). Everything R9-M prints as a picture is built here: a SnapshotSpec plus its ref, never
a rendered image (reports spec §8.2 step 4, §9.1). Sizes follow Ruling 1: 4:3 snapshots, 140x105 mm
plates, 83x52 mm locators."""

from __future__ import annotations

from collections.abc import Sequence

from sqlalchemy.orm import Session

from app.db.models import ProjectType
from app.reports import blocks
from app.reports.context import ComposeContext
from app.reports.figures import map_geo
from app.reports.schemas import ElevationSpec, Figure, MapSpec, PairSpec, SnapshotRef, VolumePlanSpec

OUT = (1200, 900)
MAIN_MM = (140.0, 105.0)
HALF_MM = (83.0, 52.0)
PLATE_MM = (140.0, 105.0)
MEASURE_COLOUR = "#8F7BFF"  # the print violet (spec §10.1)
UNKNOWN_TYPE = ("Unknown type", MEASURE_COLOUR)


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
        geometry=geometry,
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
        kind="elevation", item_id=surface_id, geometry=geometry, overlay="none", out=list(OUT)
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


def options_of(ctx: ComposeContext, key: str) -> dict:
    """The options of section `key` in the report's config, as a plain dict (`{}` when the section
    is absent or carries no options), per controller Ruling P3."""
    try:
        opts = ctx.options(key)
    except KeyError:
        return {}
    return opts.model_dump(mode="json") if opts is not None else {}


def type_look(s: Session, type_id: str) -> tuple[str, str]:
    """(name, colour) of a project type; an unknown or since-removed type prints generically.
    Findings use `FindingRow.type_name`/`type_colour` instead (Ruling P4); this is for figures that
    carry a bare type id with no `FindingRow` (e.g. a non-finding map annotation)."""
    row = s.get(ProjectType, type_id)
    return (row.name, row.colour) if row else UNKNOWN_TYPE
