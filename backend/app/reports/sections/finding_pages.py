"""Per-finding pages (spec §7.3; plan R2 Task 4): one `finding` block per finding, in number order.
The figures, photos and comments come from the hooks in app/reports/figures (R9-I/M/C fill them);
this module decides which hooks run from the section options and builds the head and kv rows."""

from __future__ import annotations

from sqlalchemy import func, select

from app.db.models import Finding, FindingAttachment, FindingComment
from app.reports import blocks
from app.reports.context import PAGE, ComposeContext, FindingRow, SectionStats, count_findings, findings_page
from app.reports.figures import cloud, image
from app.reports.figures import map as map_figures
from app.reports.schemas import Block, ReportSectionDoc

KEY = "finding_pages"
TITLE = "Finding details"
USES_FINDINGS = True
FIGURE_MODULES = {"image": image, "map": map_figures, "cloud": cloud}


def finding_kv(row: FindingRow) -> list[tuple[str, str]]:
    created = "Person" if row.created_by == "human" else row.created_by
    if row.created_by != "human" and row.confidence is not None:
        created += f" ({row.confidence:.2f})"
    rows = [
        ("Data item", row.data_label or blocks.NONE),
        ("Observed", blocks.fmt_date(row.observed_on)),
        ("Coordinates (WGS84)", blocks.fmt_lat_lon(row.lat, row.lon)),
        ("Created by", created),
    ]
    if row.reviewed_at is not None:
        rows.append(("Reviewed", blocks.fmt_date(row.reviewed_at)))
    if row.closed_at is not None:
        rows.append(("Closed", blocks.fmt_date(row.closed_at)))
    return rows


def finding_block(ctx: ComposeContext, row: FindingRow) -> Block:
    opts = ctx.options(KEY)
    figures = []
    for kind in opts.snapshots:
        figures.extend(FIGURE_MODULES[str(kind)].finding_figures(ctx, row))
    photos = image.photos(ctx, row, opts.photos_max) if opts.photos_max > 0 else []
    comments = image.comments(ctx, row, str(opts.comments)) if str(opts.comments) != "none" else []
    return blocks.finding(row, figures=figures, kv_rows=finding_kv(row), photos=photos, comments=comments)


def page(ctx: ComposeContext, cursor: str | None, limit: int) -> tuple[list[Block], str | None]:
    rows, nxt = findings_page(ctx, "number", cursor, limit)
    if not rows and cursor is None:
        return [blocks.para(blocks.EMPTY, style="note")], None
    return [finding_block(ctx, r) for r in rows], nxt


def compose(ctx: ComposeContext) -> ReportSectionDoc:
    out: list[Block] = []
    cursor: str | None = None
    while True:
        chunk, cursor = page(ctx, cursor, PAGE)
        out.extend(chunk)
        if cursor is None:
            return ReportSectionDoc(key=KEY, title=TITLE, blocks=out)


def outline(ctx: ComposeContext) -> SectionStats:
    for kind in ctx.options(KEY).snapshots:
        hook = getattr(FIGURE_MODULES[str(kind)], "warnings", None)
        if hook is not None:
            hook(ctx)
    n = count_findings(ctx)
    return SectionStats(block_count=max(n, 1), estimated_pages=max(n, 1))


def fingerprint(ctx: ComposeContext) -> str:
    ids = select(Finding.id).where(ctx.where)
    with ctx.session() as s:
        com = s.execute(
            select(
                func.count(), func.max(FindingComment.created_at), func.max(FindingComment.edited_at)
            ).where(FindingComment.finding_id.in_(ids))
        ).one()
        att = s.execute(
            select(func.count(), func.max(FindingAttachment.created_at)).where(
                FindingAttachment.finding_id.in_(ids)
            )
        ).one()
    opts = ctx.options(KEY)
    hooks = [str(k) for k in opts.snapshots]
    if (opts.photos_max > 0 or str(opts.comments) != "none") and "image" not in hooks:
        hooks.append("image")
    extra = []
    for kind in hooks:  # a figure module's optional `fingerprint(ctx) -> str` joins the etag
        fp = getattr(FIGURE_MODULES[kind], "fingerprint", None)
        extra.append(f"{kind}:{fp(ctx)}" if fp is not None else kind)
    return f"{tuple(com)}|{tuple(att)}|{'|'.join(extra)}"
