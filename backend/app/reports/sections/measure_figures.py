"""A figure per measurement for the measurements section (reports spec §7.2; plan R9-M Rulings 5-7).
Map rows are drawn on their map, else their first ready surface (as an elevation hillshade), else
the newest covering map; cloud rows take R9-C's `measurement_figure`; volumes print their own
`volume` block (`volume_block.py`) and have no figure here. One `MapMeasurement` row (its geometry
and, for a profile, its results arrays) is loaded at a time."""

from __future__ import annotations

import math
from datetime import date

from app.db.models import GeoMap, MapMeasurement, Surface
from app.measurements.schemas import MeasurementItem
from app.reports import blocks
from app.reports.context import ComposeContext
from app.reports.figures import cloud, map_geo, map_specs
from app.reports.schemas import Block
from app.workspace.frame import WGS84

MAX_PROFILE_POINTS = 120
NO_TARGET_TEXT = "no map or elevation model covers this measurement."
OTHER_FRAME_TEXT = "drawn in another coordinate frame; open it in Maps to see it."


def figures_for(ctx: ComposeContext, item: MeasurementItem) -> list[Block]:
    """The figure(s) for one measurements-table row (Rulings 5-7): a map row draws on its target
    and, for a profile, adds a decimated line chart after it; a cloud row hands off to R9-C's
    `cloud.measurement_figure` (`[]` when it returns `None`, index reconciliation 6); a volume row
    has no figure here."""
    if item.kind == "cloud":
        fig = cloud.measurement_figure(ctx, item)
        return [fig] if fig is not None else []
    if item.kind == "map":
        return _map_blocks(ctx, item.id)
    return []


def _target(s, row: MapMeasurement) -> tuple[str, str, str | None, str] | None:
    """(kind, id, crs_wkt, caption tail) of what the measurement is drawn on (Ruling 5):
    1) its own `map_id` map if ready; else 2) its first ready surface (`surface_ids` order), as an
    elevation hillshade; else 3) the newest ready map covering its centroid (georeferenced frames
    only); else `None` (no figure, just a note)."""
    if row.map_id:
        gm = s.get(GeoMap, row.map_id)
        if gm is not None and gm.status == "ready":
            return "map", gm.id, gm.crs_wkt, f"{gm.name} · {map_geo.day_text(map_geo.survey_day(gm))}"
    for sid in row.surface_ids or []:
        sf = s.get(Surface, sid)
        if sf is not None and sf.status == "ready":
            return "elevation", sf.id, sf.crs_wkt, sf.name
    if row.crs_wkt and row.geometry:
        lonlat = map_geo.to_crs([map_geo.centroid(row.geometry)], row.crs_wkt, WGS84)
        gm = map_geo.covering_map(s, *lonlat[0]) if lonlat else None
        if gm is not None:
            return "map", gm.id, gm.crs_wkt, f"{gm.name} · {map_geo.day_text(map_geo.survey_day(gm))}"
    return None


def _map_blocks(ctx: ComposeContext, measurement_id: str) -> list[Block]:
    with ctx.session() as s:
        row = s.get(MapMeasurement, measurement_id)
        if row is None:
            return []
        name, kind, crs, vertices = row.name, row.kind, row.crs_wkt, list(row.geometry or [])
        target = _target(s, row)
        results = dict(row.results or {}) if kind == "profile" else {}
    out: list[Block] = []
    if target is None:
        ctx.warn("measurement_no_map", "{n} map measurements have no map to draw on", count=1)
        out.append(blocks.para(f"{name}: {NO_TARGET_TEXT}", style="note"))
    else:
        tkind, tid, twkt, tail = target
        pts = map_geo.to_crs(vertices, crs, twkt)
        if pts is None:
            out.append(blocks.para(f"{name}: {OTHER_FRAME_TEXT}", style="note"))
        else:
            geometry = map_geo.polygon(pts) if kind == "area" else map_geo.line(pts)
            caption = f"{name} · {tail}"
            if tkind == "map":
                out.append(
                    map_specs.map_figure(
                        ctx,
                        map_id=tid,
                        geometry=geometry,
                        colour=map_specs.MEASURE_COLOUR,
                        label=name,
                        caption=caption,
                    )
                )
            else:
                out.append(
                    map_specs.elevation_figure(ctx, surface_id=tid, geometry=geometry, caption=caption)
                )
    if kind == "profile":
        chart = profile_chart(results)
        if chart is not None:
            out.append(chart)
    return out


def _series_name(series: dict) -> str:
    d = series.get("date")
    if not d:
        return series.get("label") or "Surface"
    return f"{series.get('label') or 'Surface'} ({map_geo.day_text(date.fromisoformat(str(d)[:10]))})"


def _z(values: list, i: int) -> float | None:
    v = values[i] if i < len(values) else None
    return None if v is None or not math.isfinite(v) else round(float(v), 3)


def profile_chart(results: dict) -> Block | None:
    """A decimated `line` chart for a map profile (Ruling 7): x labels `"<station> m"`, series named
    `"<label> (<date>)"` (or the label alone), values `z` rounded to 3 decimals with `None` for a
    gap, decimated to <= `MAX_PROFILE_POINTS` by stride. `None` when there is nothing to chart."""
    stations = results.get("stations_m") or []
    series = results.get("series") or []
    if not stations or not series:
        return None
    step = max(1, math.ceil(len(stations) / MAX_PROFILE_POINTS))
    idx = range(0, len(stations), step)
    return blocks.chart(
        "line",
        [{"name": _series_name(sr), "values": [_z(sr.get("z") or [], i) for i in idx]} for sr in series],
        [f"{stations[i]:.0f} m" for i in idx],
        "m",
    )
