"""Map figures of a finding page (spec §7.3, §9.3). R2 stub -> R9-M."""

from __future__ import annotations

from app.reports.blocks import Figure
from app.reports.context import ComposeContext, FindingRow


def finding_figures(ctx: ComposeContext, finding: FindingRow) -> list[Figure]:
    return []
