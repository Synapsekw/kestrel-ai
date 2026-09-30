"""Appendix (spec §7.2). R2 stub: one "No data" paragraph until R2 Task 9 fills it in
(plan R2 section module protocol: KEY, TITLE, compose; optional page, outline, fingerprint,
USES_FINDINGS)."""

from __future__ import annotations

from app.reports import blocks
from app.reports.context import ComposeContext
from app.reports.schemas import ReportSectionDoc

KEY = "appendix"
TITLE = "Appendix"
USES_FINDINGS = True


def compose(ctx: ComposeContext) -> ReportSectionDoc:
    return ReportSectionDoc(key=KEY, title=TITLE, blocks=[blocks.para("No data", style="note")])
