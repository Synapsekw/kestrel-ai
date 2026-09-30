"""Map figures of a finding page (spec §7.3, §9.3). R2 stub -> R9-M.
A figure module may also define `warnings(ctx) -> None`; the outline calls it (plan R2 Ruling 11),
and `fingerprint(ctx) -> str`; finding_pages appends it to the section etag, so an input the figures
read that no finding row carries can still move the preview."""

from __future__ import annotations

from app.reports.blocks import Figure
from app.reports.context import ComposeContext, FindingRow


def finding_figures(ctx: ComposeContext, finding: FindingRow) -> list[Figure]:
    return []
