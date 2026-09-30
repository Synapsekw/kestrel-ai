"""3D views of a finding page and of a cloud measurement (spec §9.4). R2 stub -> R9-C.
A figure module may also define `warnings(ctx) -> None`; the outline calls it (plan R2 Ruling 11),
and `fingerprint(ctx) -> str`; finding_pages appends it to the section etag, so an input the figures
read that no finding row carries can still move the preview."""

from __future__ import annotations

from app.measurements.schemas import MeasurementItem
from app.reports.blocks import Figure
from app.reports.context import ComposeContext, FindingRow


def finding_figures(ctx: ComposeContext, finding: FindingRow) -> list[Figure]:
    return []


def measurement_figure(ctx: ComposeContext, row: MeasurementItem) -> Figure | None:
    return None
