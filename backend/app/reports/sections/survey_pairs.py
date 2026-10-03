"""Survey pairs for the comparison section (reports spec §9.3 "Pair / swipe", §16; plan R9-M Rulings
10-12). A survey is a ready map with a WGS84 footprint; pairs are consecutive surveys, or the
operator's. Reads: one geo_map column select, one AVG per pair. No raster."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import date

from sqlalchemy import func, select

from app.db.models import Finding, GeoMap
from app.reports import blocks
from app.reports.context import ComposeContext
from app.reports.figures import map_geo, map_specs
from app.reports.figures.map_geo import BBox
from app.reports.schemas import Block
from app.workspace.frame import WGS84

NO_COMMON = "no common area"


@dataclass(frozen=True)
class SurveyMap:
    id: str
    name: str
    day: date
    crs_wkt: str | None
    bounds: BBox
    ring: list[list[float]]  # the footprint in the map's own CRS


def survey_maps(handle) -> list[SurveyMap]:
    """Ready maps with a WGS84 footprint, in `(day, created_at, id)` order (Ruling 10, Global
    Constraints "Determinism")."""
    cols = (
        GeoMap.id,
        GeoMap.name,
        GeoMap.captured_on,
        GeoMap.created_at,
        GeoMap.crs_wkt,
        GeoMap.bounds_wgs84,
        GeoMap.bounds_native,
    )
    with handle.session() as s:
        rows = s.execute(
            select(*cols).where(GeoMap.status == "ready", GeoMap.bounds_wgs84.is_not(None))
        ).all()
    out = []
    for id_, name, captured, created, wkt, wgs, native in rows:
        day = captured or created.date()
        ring: list[list[float]] = []
        if native:
            x0, y0, x1, y1 = native
            ring = [[x0, y0], [x1, y0], [x1, y1], [x0, y1]]
        out.append((day, created, id_, SurveyMap(id_, name, day, wkt, tuple(wgs), ring)))
    return [m for *_, m in sorted(out, key=lambda t: t[:3])]


def auto_pairs(maps: list[SurveyMap]) -> list[tuple[SurveyMap, SurveyMap]]:
    """Each consecutive pair in survey order (Ruling 10)."""
    return list(zip(maps, maps[1:], strict=False))


def explicit_pairs(
    maps: list[SurveyMap], wanted: list[dict]
) -> tuple[list[tuple[SurveyMap, SurveyMap, BBox | None]], int]:
    """The operator's pairs (`item_a`/`item_b`/`bbox_wgs84`, Ruling P3): an entry naming a missing
    or unready map is skipped and counted (Ruling 10; the caller warns with `pair_missing`)."""
    by_id = {m.id: m for m in maps}
    pairs: list[tuple[SurveyMap, SurveyMap, BBox | None]] = []
    missing = 0
    for w in wanted:
        a, b = by_id.get(w.get("item_a")), by_id.get(w.get("item_b"))
        if a is None or b is None:
            missing += 1
            continue
        given = w.get("bbox_wgs84")
        pairs.append((a, b, tuple(given) if given else None))
    return pairs, missing


def finding_centre(handle, a_id: str, b_id: str) -> tuple[float, float] | None:
    """The mean lon/lat of every finding on either map, one `AVG`, independent of the report's
    finding filters (Ruling 11)."""
    with handle.session() as s:
        lon, lat = s.execute(
            select(func.avg(Finding.lon), func.avg(Finding.lat)).where(
                Finding.map_id.in_([a_id, b_id]), Finding.lon.is_not(None), Finding.lat.is_not(None)
            )
        ).one()
    return (float(lon), float(lat)) if lon is not None and lat is not None else None


def frame(a: SurveyMap, b: SurveyMap, given: BBox | None, centre: tuple[float, float] | None) -> BBox | None:
    """The comparison frame (Ruling 11): the WGS84 intersection of the two footprints, narrowed to
    an explicit `bbox_wgs84` when given, else shrunk to a 4:3 window around the findings' centre
    (falling back to the common area's own centre). An explicit bbox that misses the common area
    falls back to that automatic frame: the maps do overlap, so "no common area" would be false.
    `None` only when the footprints do not overlap."""
    common = map_geo.intersect(a.bounds, b.bounds)
    if common is None:
        return None
    if given is not None:
        clipped = map_geo.intersect(given, common)
        if clipped is not None:
            return clipped
    inside = centre if centre is not None and map_geo.contains(common, *centre) else None
    return map_geo.aspect_4_3(common, inside)


def _label(m: SurveyMap) -> str:
    return f"{m.name} · {map_geo.day_text(m.day)}"


def _frame_ring(bbox: BBox, wkt: str | None) -> list[list[float]] | None:
    """The WGS84 frame's corners in the map's own CRS; None when they cannot be projected (never
    WGS84 degrees passed off as native coordinates)."""
    lo_x, lo_y, hi_x, hi_y = bbox
    corners = [[lo_x, lo_y], [hi_x, lo_y], [hi_x, hi_y], [lo_x, hi_y]]
    return map_geo.to_crs(corners, WGS84, wkt)


def _own_footprints(ctx: ComposeContext, a: SurveyMap, b: SurveyMap) -> list[Block]:
    return [
        blocks.figure_row(
            [
                map_specs.map_figure(
                    ctx,
                    map_id=m.id,
                    geometry=map_geo.polygon(m.ring),
                    colour=map_specs.MEASURE_COLOUR,
                    caption=f"{_label(m)}: {NO_COMMON}",
                    size_mm=map_specs.HALF_MM,
                )
                for m in (a, b)
            ]
        )
    ]


def pair_blocks(ctx: ComposeContext, a: SurveyMap, b: SurveyMap, bbox: BBox | None, mode: str) -> list[Block]:
    """The blocks for one pair (Ruling 12). No common area (or a frame that cannot be projected into
    either map's CRS): one `figure_row` of each survey's own footprint, captioned "no common area"
    (Ruling 11). Otherwise: one `pair` figure per requested mode (`both` prints swipe then
    side_by_side)."""
    a_ring = _frame_ring(bbox, a.crs_wkt) if bbox is not None else None
    b_ring = _frame_ring(bbox, b.crs_wkt) if bbox is not None else None
    if bbox is None or a_ring is None or b_ring is None:
        return _own_footprints(ctx, a, b)
    caption = f"A: {_label(a)}   B: {_label(b)}"
    modes = ["swipe", "side_by_side"] if mode == "both" else [mode]
    return [
        map_specs.pair_figure(
            ctx,
            a_id=a.id,
            a_ring=a_ring,
            b_id=b.id,
            b_ring=b_ring,
            bbox_wgs84=bbox,
            mode=m,
            caption=caption,
        )
        for m in modes
    ]
