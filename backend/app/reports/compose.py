"""Compose a report (spec 2026-09-26-reports §8): config + baseline -> ReportDocument.

Section module protocol (every module in SECTION_MODULES; R9 units fill theirs in place and never
edit this file):
  KEY: str, TITLE: str
  compose(ctx) -> ReportSectionDoc                        required
  page(ctx, cursor, limit) -> (list[Block], str | None)   optional; default slices compose() by offset
  outline(ctx) -> SectionStats                            optional; default len(compose().blocks), 1 page
  fingerprint(ctx) -> str                                 optional; extra input to the section etag
  USES_FINDINGS: bool                                     optional (True); the finding aggregate
                                                            joins the etag
"""

from __future__ import annotations

from datetime import datetime

from app.errors import AppError
from app.pagination import decode_cursor, encode_cursor
from app.reports.context import (  # noqa: F401 - re-exported: R5 and R9 import them from here
    PAGE,
    Baseline,
    ComposeContext,
    FindingRow,
    SectionStats,
    count_findings,
    findings_page,
    iter_findings,
)
from app.reports.schemas import Block, ReportConfig, ReportDocument
from app.reports.sections import (
    appendix,
    comparison,
    cover,
    finding_pages,
    findings_table,
    measurements,
    object_counts,
    summary,
)

SECTION_MODULES = {
    m.KEY: m
    for m in (
        cover,
        summary,
        findings_table,
        finding_pages,
        measurements,
        comparison,
        object_counts,
        appendix,
    )
}
SECTION_COMPOSERS = {key: mod.compose for key, mod in SECTION_MODULES.items()}


def section_title(key: str) -> str:
    return SECTION_MODULES[key].TITLE


def compose_in(ctx: ComposeContext, *, theme_version: str = "") -> ReportDocument:
    sections = [SECTION_MODULES[s.key].compose(ctx) for s in ctx.config.sections if s.enabled]
    return ReportDocument.model_validate(
        {
            "report_id": ctx.report_id,
            "version": ctx.version,
            "generated_at": ctx.generated_at,
            "theme_version": theme_version,
            "paper": ctx.config.paper,
            "sections": sections,
        }
    )


def compose(
    handle,
    config: ReportConfig,
    *,
    report_id: str,
    baseline: Baseline | None,
    generated_at: datetime,
    version: int | None = None,
    issued: bool = False,
    theme_version: str = "",
    key_for=None,
) -> ReportDocument:
    ctx = ComposeContext(
        handle=handle,
        config=config,
        report_id=report_id,
        baseline=baseline,
        generated_at=generated_at,
        version=version,
        issued=issued,
        key_for=key_for,
    )
    return compose_in(ctx, theme_version=theme_version)


def section_page(
    ctx: ComposeContext, key: str, cursor: str | None, limit: int
) -> tuple[list[Block], str | None]:
    mod = SECTION_MODULES[key]
    pager = getattr(mod, "page", None)
    if pager is not None:
        return pager(ctx, cursor, limit)
    items = mod.compose(ctx).blocks
    start = 0
    if cursor:
        i = decode_cursor(cursor, "i")["i"]
        if not isinstance(i, int) or isinstance(i, bool) or i < 0:
            raise AppError("validation_error", "invalid cursor", 422)
        start = i
    end = start + limit
    return list(items[start:end]), (encode_cursor(i=end) if end < len(items) else None)


def section_stats(ctx: ComposeContext, key: str) -> SectionStats:
    mod = SECTION_MODULES[key]
    fn = getattr(mod, "outline", None)
    return (
        fn(ctx)
        if fn is not None
        else SectionStats(block_count=len(mod.compose(ctx).blocks), estimated_pages=1)
    )
