"""Measurements (spec §7.2). R2 stub: one "No data" paragraph until R9-M fills it in
(plan R2 section module protocol: KEY, TITLE, compose; optional page, outline, fingerprint,
USES_FINDINGS)."""

from __future__ import annotations

from app.reports import blocks
from app.reports.context import ComposeContext
from app.reports.schemas import ReportSectionDoc

KEY = "measurements"
TITLE = "Measurements"
USES_FINDINGS = False


def compose(ctx: ComposeContext) -> ReportSectionDoc:
    return ReportSectionDoc(key=KEY, title=TITLE, blocks=[blocks.para("No data", style="note")])
