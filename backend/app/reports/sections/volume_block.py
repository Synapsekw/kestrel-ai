"""One volume measurement as the report's `volume` block (index "Block kinds"; reports spec §16;
plan R9-M Ruling 9). Stale is decided read-only: the stored status, or the stored inputs
fingerprint against the current inputs - the same test `volumes.service._refresh` makes, without
writing the row. A stale block carries no numbers and no figure."""

from __future__ import annotations

from datetime import datetime

from app.db.models import VolumeMeasurement
from app.reports import blocks
from app.reports.figures import map_specs
from app.reports.figures.map_geo import day_text
from app.reports.schemas import VolumeBlock
from app.volumes.items import ExportItem
from app.volumes.service import fingerprint, inputs_snapshot, stale_reasons

STALE = "stale, recalculate"


def is_stale(s, row: VolumeMeasurement) -> bool:
    if row.status != "ready" or not row.results:
        return True
    return fingerprint(inputs_snapshot(s, row)) != row.results.get("inputs_fingerprint")


def _why(s, row: VolumeMeasurement) -> str:
    if row.status == "calculating":
        return "a calculation is running"
    if row.status == "failed":
        return f"failed: {row.error or 'unknown error'}"
    if not row.results:
        return "never calculated"
    reasons = stale_reasons(row.results.get("inputs", {}), inputs_snapshot(s, row))
    return "; ".join(reasons) or "inputs changed since the calculation"


def _calculated(value) -> str:
    """The calculation day as the report prints dates (`2 Sep 2026`); the raw text if unparseable."""
    if not value:
        return blocks.NONE
    try:
        return day_text(datetime.fromisoformat(str(value)).date())
    except ValueError:
        return str(value)[:10]


def m3(v) -> str:
    return blocks.NONE if v is None else f"{v:,.1f} m³"


def m2(v) -> str:
    return blocks.NONE if v is None else f"{v:,.1f} m²"


def volume_block(ctx, measurement_id: str, *, with_figure: bool) -> VolumeBlock:
    with ctx.handle.session() as s:
        row = s.get(VolumeMeasurement, measurement_id)
        if row is None:
            return VolumeBlock(
                measurement_id=measurement_id,
                title="Deleted measurement",
                rows=[["Status", STALE], ["Why", "the measurement was deleted"]],
                figure=None,
                stale=True,
            )
        if is_stale(s, row):
            return VolumeBlock(
                measurement_id=row.id,
                title=row.name,
                rows=[["Status", STALE], ["Why", _why(s, row)]],
                figure=None,
                stale=True,
            )
        r = dict(row.results)
        item = ExportItem(
            id=row.id,
            name=row.name,
            status=row.status,
            polygon=row.polygon_native,
            base=dict(row.base),
            masks=dict(row.masks or {}),
            alignment=dict(row.alignment or {}),
            results=r,
            epsg=None,
            crs_wkt=None,
        )
        title = row.name
    lab = item.labels
    rows = [
        [lab.fill, m3(r.get("fill_m3"))],
        [lab.cut, m3(r.get("cut_m3"))],
        ["Net", m3(r.get("net_m3"))],
        ["± (indicative)", m3((r.get("uncertainty") or {}).get("total_m3"))],
        ["Area", m2(r.get("area_m2"))],
        ["Top surface", (r.get("top_surface") or {}).get("name", blocks.NONE)],
        ["Base", item.base_detail],
        ["Calculated", _calculated(r.get("computed_at"))],
    ]
    figure = (
        map_specs.volume_plan_figure(ctx, measurement_id=measurement_id, caption=f"Plan of {title}")
        if with_figure
        else None
    )
    return VolumeBlock(measurement_id=measurement_id, title=title, rows=rows, figure=figure, stale=False)
