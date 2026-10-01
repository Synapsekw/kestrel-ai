"""Map figures on a finding's page (reports spec §7.3, §9.3; plan R9-M Rulings 1-4).

A map-anchored finding gets its main figure: the anchor's pin or polygon on its own map, with the
locator inset. An image or cloud finding whose lon/lat falls inside a ready map gets a small
locator on the newest such map. Only specs are built here; R3 renders them.

A figure module may also define `warnings(ctx) -> None`; the outline calls it (plan R2 Ruling 11),
and `fingerprint(ctx) -> str`; finding_pages appends it to the section etag, so an input the figures
read that no finding row carries can still move the preview. Only `fingerprint` is defined here: the
anchor fields live on the finding row, but the map a figure resolves to (`covering_map` reads
`bounds_wgs84`, `to_crs` reads `crs_wkt`) can be re-georeferenced without touching any finding."""

from __future__ import annotations

from app.reports.context import ComposeContext, FindingRow
from app.reports.figures import map_geo, map_specs
from app.reports.schemas import Figure
from app.reports.sections import m_etag
from app.workspace.frame import WGS84


def fingerprint(ctx: ComposeContext) -> str:
    """Digest over GeoMap(id, status, bounds_wgs84, crs_wkt) ordered by id (a column select of tens of
    rows): a re-georeference changes no finding row, so this is what moves the finding_pages etag."""
    with ctx.session() as s:
        return m_etag.maps(s)


def finding_figures(ctx: ComposeContext, finding: FindingRow) -> list[Figure]:
    """Built from the FindingRow's own anchor fields (anchor_kind, map_id, geometry, lon/lat) plus a
    column select of the one map it resolves to; the finding is never re-read."""
    label = f"{finding.label} · {finding.type_name}"
    with ctx.session() as s:
        if finding.anchor_kind == "map":
            gmap = map_geo.map_ref(s, finding.map_id)
            if gmap is None or not finding.geometry:
                return []
            map_id, geometry = gmap.id, dict(finding.geometry)
            caption = f"{gmap.name} · {map_geo.day_text(map_geo.survey_day(gmap))}"
            size, inset = map_specs.MAIN_MM, True
        else:
            if finding.lon is None or finding.lat is None:
                return []
            gmap = map_geo.covering_map(s, finding.lon, finding.lat)
            if gmap is None:
                return []
            xy = map_geo.to_crs([[finding.lon, finding.lat]], WGS84, gmap.crs_wkt)
            if xy is None:
                return []
            map_id, geometry = gmap.id, map_geo.point(*xy[0])
            caption = f"Location on {gmap.name} · {map_geo.day_text(map_geo.survey_day(gmap))}"
            size, inset = map_specs.HALF_MM, False
    return [
        map_specs.map_figure(
            ctx,
            map_id=map_id,
            geometry=geometry,
            colour=finding.type_colour,
            label=label,
            caption=caption,
            size_mm=size,
            inset=inset,
        )
    ]
