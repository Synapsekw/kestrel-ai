"""Executive summary (spec §7.2, §8.3; plan R2 Task 6): the KPI row, the severity × status matrix,
the top-8 type bars, the delta strip and the narrative. Every number is a SQL aggregate."""

from __future__ import annotations

import re

from sqlalchemy import func, select

from app.db.models import Finding
from app.reports import blocks
from app.reports.baseline import delta_sentence, deltas
from app.reports.context import ComposeContext
from app.reports.schemas import Block, ReportSectionDoc

KEY = "summary"
TITLE = "Summary"
USES_FINDINGS = True
TOP_TYPES = 8
STATUSES = ("open", "reviewed", "closed")


def kpi_counts(ctx: ComposeContext) -> dict[tuple[int | None, str], int]:
    with ctx.session() as s:
        rows = s.execute(
            select(Finding.severity, Finding.status, func.count())
            .where(ctx.where)
            .group_by(Finding.severity, Finding.status)
        ).all()
    return {(sev, st): n for sev, st, n in rows}


def type_counts(ctx: ComposeContext) -> list[tuple[str, int]]:
    n = func.count().label("n")
    with ctx.session() as s:
        rows = s.execute(
            select(Finding.type_id, n)
            .where(ctx.where)
            .group_by(Finding.type_id)
            .order_by(n.desc(), Finding.type_id.asc())
            .limit(TOP_TYPES)
        ).all()
    return [(t, c) for t, c in rows]


def _levels(ctx: ComposeContext, counts) -> list[int]:
    return sorted(
        {lv.level for lv in ctx.scale} | {sev for sev, _ in counts if sev is not None}, reverse=True
    )


def _kpis(ctx, counts) -> Block:
    by_sev: dict = {}
    by_st: dict = {}
    for (sev, st), n in counts.items():
        by_sev[sev] = by_sev.get(sev, 0) + n
        by_st[st] = by_st.get(st, 0) + n
    items = [blocks.kpi("Findings", str(sum(counts.values())))]
    items += [blocks.kpi(ctx.level(lv).name, str(by_sev.get(lv, 0))) for lv in _levels(ctx, counts)]
    items.append(blocks.kpi("Ungraded", str(by_sev.get(None, 0))))
    items += [blocks.kpi(st.capitalize(), str(by_st.get(st, 0))) for st in STATUSES]
    return blocks.kpis(items)


def _matrix(ctx, counts) -> Block:
    cols = [blocks.column("severity", "Severity", 54)] + [
        blocks.column(k, k.capitalize() if k != "total" else "Total", 30, "right")
        for k in (*STATUSES, "total")
    ]
    rows = []
    for sev in [*_levels(ctx, counts), None]:
        cells = [counts.get((sev, st), 0) for st in STATUSES]
        rows.append([ctx.level(sev).name, *map(str, cells), str(sum(cells))])
    totals = [sum(n for (_, s), n in counts.items() if s == st) for st in STATUSES]
    rows.append(["Total", *map(str, totals), str(sum(totals))])
    return blocks.table(cols, rows)


def _strip(ctx: ComposeContext) -> list[Block]:
    if ctx.baseline is None:
        return [blocks.para("First report", style="note")]
    with ctx.session() as s:
        d = deltas(s, ctx.where, ctx.baseline)

    def tone(n, bad):
        return ("bad" if bad else "good") if n else "neutral"

    items = [
        blocks.kpi("New", str(d.new), tone=tone(d.new, True)),
        blocks.kpi("Closed", str(d.closed), tone=tone(d.closed, False)),
        blocks.kpi("Escalated", str(d.escalated), tone=tone(d.escalated, True)),
        blocks.kpi("De-escalated", str(d.deescalated), tone=tone(d.deescalated, False)),
        blocks.kpi("Reopened", str(d.reopened), tone=tone(d.reopened, True)),
        blocks.kpi("Left the report", str(d.left)),
    ]
    return [blocks.kpis(items), blocks.para(delta_sentence(d, ctx.baseline), style="small")]


def paragraphs(text: str | None) -> list[str]:
    return [p.strip() for p in re.split(r"\n\s*\n", (text or "").strip()) if p.strip()]


def compose(ctx: ComposeContext) -> ReportSectionDoc:
    opts = ctx.options(KEY)
    counts = kpi_counts(ctx)
    out: list[Block] = []
    if not counts:
        out.append(blocks.para(blocks.EMPTY, style="note"))
    out += [_kpis(ctx, counts), _matrix(ctx, counts)]
    types = type_counts(ctx)
    if types:
        out.append(
            blocks.chart(
                "bar",
                [{"name": "Findings", "values": [n for _, n in types]}],
                [ctx.type_info(t).name for t, _ in types],
                unit="findings",
            )
        )
    if opts.show_deltas:
        out += _strip(ctx)
    out += [blocks.para(p) for p in paragraphs(opts.narrative)]
    return ReportSectionDoc(key=KEY, title=TITLE, blocks=out)
