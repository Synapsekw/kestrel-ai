"""The findings table (spec §7.2; plan R2 Task 7, Ruling 10): plain string rows in `table` blocks of
25, read in one keyset page of at most min(200, 25·limit) findings per request."""

from __future__ import annotations

import math

from app.reports import blocks
from app.reports.context import PAGE, ComposeContext, FindingRow, SectionStats, count_findings, findings_page
from app.reports.schemas import Block, ReportSectionDoc

KEY = "findings_table"
TITLE = "Findings"
USES_FINDINGS = True
ROWS_PER_BLOCK = 25
ROWS_PER_PAGE = 38
NOTE_CHARS = 120
COLUMNS = {  # key -> (label, width_mm at the full set; sums to 174)
    "number": ("No.", 16.0),
    "type": ("Type", 30.0),
    "severity": ("Severity", 22.0),
    "status": ("Status", 18.0),
    "data_item": ("Data item", 32.0),
    "observed": ("Observed", 22.0),
    "note": ("Note", 34.0),
}


def excerpt(text: str, n: int = NOTE_CHARS) -> str:
    one = " ".join((text or "").split())
    return one if len(one) <= n else one[: n - 1].rstrip() + "…"


def cell(row: FindingRow, key: str) -> str:
    return {
        "number": lambda: row.label,
        "type": lambda: row.type_name,
        "severity": lambda: row.severity_name,
        "status": lambda: row.status.capitalize(),
        "data_item": lambda: row.data_label or "—",
        "observed": lambda: blocks.fmt_date(row.observed_on),
        "note": lambda: excerpt(row.note),
    }[key]()


def _keys(ctx: ComposeContext) -> list[str]:
    chosen = ctx.options(KEY).columns or list(COLUMNS)
    return [str(k) for k in chosen if str(k) in COLUMNS]


def _table(keys: list[str], rows: list[FindingRow]) -> Block:
    total = sum(COLUMNS[k][1] for k in keys)
    cols = [blocks.column(k, COLUMNS[k][0], COLUMNS[k][1] * blocks.CONTENT_WIDTH_MM / total) for k in keys]
    return blocks.table(cols, [[cell(r, k) for k in keys] for r in rows])


def page(ctx: ComposeContext, cursor: str | None, limit: int) -> tuple[list[Block], str | None]:
    keys = _keys(ctx)
    rows, nxt = findings_page(
        ctx, str(ctx.options(KEY).sort), cursor, min(PAGE, max(1, limit) * ROWS_PER_BLOCK)
    )
    if not rows and cursor is None:
        return [blocks.para(blocks.EMPTY, style="note")], None
    return [_table(keys, rows[i : i + ROWS_PER_BLOCK]) for i in range(0, len(rows), ROWS_PER_BLOCK)], nxt


def compose(ctx: ComposeContext) -> ReportSectionDoc:
    out: list[Block] = []
    cursor: str | None = None
    while True:
        chunk, cursor = page(ctx, cursor, PAGE // ROWS_PER_BLOCK)
        out.extend(chunk)
        if cursor is None:
            return ReportSectionDoc(key=KEY, title=TITLE, blocks=out)


def outline(ctx: ComposeContext) -> SectionStats:
    n = count_findings(ctx)
    return SectionStats(
        block_count=max(1, math.ceil(n / ROWS_PER_BLOCK)),
        estimated_pages=max(1, math.ceil(n / ROWS_PER_PAGE)),
    )
