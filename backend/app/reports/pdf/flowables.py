"""Block -> flowables (spec 2026-09-26-reports §10.2). Dispatch is on `block.kind`, the discriminator
R0 pins; every handler returns a list of flowables and never raises on data: a missing snapshot is a
placeholder, empty blocks print nothing (a chart prints "No data"), long cells are cut. The only
exception that escapes is JobCancelled. A `finding` is one page (Task 11), continued when it runs over."""

from __future__ import annotations

import logging
import re
from collections.abc import Callable
from dataclasses import dataclass
from pathlib import Path
from typing import TYPE_CHECKING, Any

from reportlab.lib import colors
from reportlab.lib.enums import TA_CENTER, TA_LEFT, TA_RIGHT
from reportlab.lib.styles import ParagraphStyle
from reportlab.lib.units import mm
from reportlab.platypus import (
    Flowable,
    KeepTogether,
    PageBreakIfNotEmpty,
    Paragraph,
    Spacer,
    Table,
    TableStyle,
)

from app.findings.numbers import format_number
from app.jobs.cancellation import JobCancelled
from app.reports.pdf import charts, primitives
from app.reports.pdf.flowables_text import MAX_CELL_CHARS, text
from app.reports.pdf.styles import Styles, colour, safe_colour, table_style, tone_style
from app.reports.theme import THEME

if TYPE_CHECKING:
    from app.reports.schemas import SnapshotRef, VolumeBlock

log = logging.getLogger(__name__)
KPI_PER_ROW = 6
KPI_CHARS = 120  # a KPI card is one short fact; longer text is cut, never a LayoutError
CELL_PAD = 4  # table_style's LEFTPADDING / RIGHTPADDING
_ALIGN = {"left": TA_LEFT, "center": TA_CENTER, "right": TA_RIGHT}
_NO_PAD = [
    ("LEFTPADDING", (0, 0), (-1, -1), 0),
    ("RIGHTPADDING", (0, 0), (-1, -1), 0),
    ("TOPPADDING", (0, 0), (-1, -1), 0),
    ("BOTTOMPADDING", (0, 0), (-1, -1), 0),
    ("VALIGN", (0, 0), (-1, -1), "TOP"),
]


@dataclass(frozen=True)
class RenderContext:
    styles: Styles
    snapshot_path: Callable[[SnapshotRef], Path]
    volume_flowables: Callable[[VolumeBlock], list] | None
    frame_width: float
    frame_height: float


class _Mark(Flowable):
    """Zero-size flowable; the document's afterFlowable reads its attributes."""

    def wrap(self, aw, ah):
        return 0, 0

    def draw(self):
        pass


class SectionMark(_Mark):
    def __init__(self, key: str, title: str):
        super().__init__()
        self._kestrel_bookmark = (key, title, 0)


class FindingEnd(_Mark):
    pass


class _Dot(Flowable):
    """A filled dot the height of one table line; the colour is never the only signal (text follows)."""

    def __init__(self, fill: colors.Color, line_height: float):
        super().__init__()
        self.fill, self.d, self.line_height = fill, THEME["severity"]["dot_mm"] * mm, line_height

    def wrap(self, aw, ah):
        return self.d, self.line_height

    def draw(self):
        self.canv.saveState()
        self.canv.setFillColor(self.fill)
        self.canv.circle(self.d / 2, self.line_height * 0.55, self.d / 2, stroke=0, fill=1)
        self.canv.restoreState()


def snapshot_file(ref: SnapshotRef, ctx: RenderContext) -> tuple[Path | None, str | None]:
    try:
        path = ctx.snapshot_path(ref)
    except JobCancelled:
        raise
    except Exception as exc:  # a snapshot never fails the PDF (spec §16)
        log.warning("snapshot %s unavailable: %s", ref.key, exc)
        return None, ref.missing_reason or "Snapshot unavailable"
    return (Path(path) if path else None), ref.missing_reason


def snapshot_refs(block: Any) -> list[SnapshotRef]:
    """Every snapshot a block embeds, in print order (the part planner sums their file sizes)."""
    kind = block.kind
    if kind == "figure":
        return [block.snapshot]
    if kind == "figure_row":
        return [f.snapshot for f in block.figures]
    if kind == "finding":
        return [f.snapshot for f in block.figures] + [p.snapshot for p in block.photos]
    if kind == "volume" and block.figure is not None:
        return [block.figure.snapshot]
    if kind == "cover" and block.locator is not None:
        return [block.locator.snapshot]
    return []


def _figure(block: Any, ctx: RenderContext, max_width: float | None = None) -> list:
    # figure_flowable returns an atomic Table (ruling P1): safe inside a figure_row's Table cell.
    w = min(block.width_mm * mm, max_width or ctx.frame_width)
    h = min(block.height_mm * mm, ctx.frame_height * 0.8)
    path, reason = snapshot_file(block.snapshot, ctx)
    return [primitives.figure_flowable(path, w, h, block.caption or "", ctx.styles, reason=reason)]


def _figure_grid(figs: list, ctx: RenderContext, per_row: int, gap: float = 4 * mm) -> list:
    """Figures in rows of `per_row` equal columns, one atomic Table per row (never a KeepTogether in a
    cell, ruling P1); a short last row is padded with blank cells so every column keeps its width."""
    if not figs:
        return []
    col = ctx.frame_width / per_row
    out: list = []
    for i in range(0, len(figs), per_row):
        row = figs[i : i + per_row]
        cells = [_figure(f, ctx, max_width=col - gap) for f in row] + [""] * (per_row - len(row))
        t = Table([cells], colWidths=[col] * per_row, hAlign="LEFT")
        t.setStyle(
            TableStyle(
                [
                    ("VALIGN", (0, 0), (-1, -1), "TOP"),
                    ("LEFTPADDING", (0, 0), (-1, -1), 0),
                    ("RIGHTPADDING", (0, 0), (-1, -1), 0),
                ]
            )
        )
        out.append(t)
    return out


def _figure_row(block: Any, ctx: RenderContext) -> list:
    figs = list(block.figures)
    if not figs:  # R0 requires one; kept so a hand-built block cannot divide by zero
        return []
    return [*_figure_grid(figs, ctx, len(figs)), Spacer(1, 3 * mm)]


def kv_table(rows: Any, ctx: RenderContext) -> list:
    rows = [list(r) for r in (rows or [])]
    if not rows:
        return []
    st = ctx.styles
    data = [
        [
            Paragraph(text(r[0] if r else "", MAX_CELL_CHARS), st.cell_label),
            Paragraph(text(r[1] if len(r) > 1 else "", MAX_CELL_CHARS), st.cell),
        ]
        for r in rows
    ]
    t = Table(data, colWidths=[ctx.frame_width * 0.32, ctx.frame_width * 0.68], hAlign="LEFT", splitInRow=1)
    t.setStyle(table_style(header=False))
    return [t, Spacer(1, 3 * mm)]


def _heading(block: Any, ctx: RenderContext) -> list:
    st = ctx.styles
    return [Paragraph(text(block.text), {1: st.h1, 2: st.h2}.get(block.level, st.h3))]


def _para(block: Any, ctx: RenderContext) -> list:
    st = ctx.styles
    style = {"small": st.small, "note": st.note}.get(str(block.style), st.body)
    return [
        Paragraph(text(p.strip()), style) for p in re.split(r"\n\s*\n", str(block.text or "")) if p.strip()
    ]


def _kv(block: Any, ctx: RenderContext) -> list:
    return kv_table(block.rows, ctx)


def _kpis(block: Any, ctx: RenderContext) -> list:
    items = list(block.items)
    if not items:
        return []
    st = ctx.styles
    per_row = min(len(items), KPI_PER_ROW)
    cards: list[Any] = []
    for it in items:
        card = [
            Paragraph(text(it.value, KPI_CHARS), st.kpi_value),
            Paragraph(text(it.label, KPI_CHARS), st.kpi_label),
        ]
        if it.delta:
            card.append(Paragraph(text(it.delta, KPI_CHARS), tone_style(st, it.tone)))
        cards.append(card)
    rows = [cards[i : i + per_row] for i in range(0, len(cards), per_row)]
    blanks = per_row - len(rows[-1])
    rows[-1] = rows[-1] + [""] * blanks
    t = Table(rows, colWidths=[ctx.frame_width / per_row] * per_row, hAlign="LEFT", splitInRow=1)
    cmds = [
        ("BACKGROUND", (0, 0), (-1, -1), colour("head_fill")),
        ("INNERGRID", (0, 0), (-1, -1), 4, colors.white),
        ("BOX", (0, 0), (-1, -1), 4, colors.white),
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("TOPPADDING", (0, 0), (-1, -1), 6),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 6),
        ("LEFTPADDING", (0, 0), (-1, -1), 6),
    ]
    if blanks:
        cmds.append(("BACKGROUND", (per_row - blanks, len(rows) - 1), (-1, -1), colors.white))
    t.setStyle(TableStyle(cmds))
    return [t, Spacer(1, 4 * mm)]


def _column_style(parent: ParagraphStyle, name: str, align: str) -> ParagraphStyle:
    return ParagraphStyle(f"{parent.name}-{name}", parent=parent, alignment=_ALIGN.get(align, TA_LEFT))


def _cell(value: Any, style: ParagraphStyle, width: float) -> Any:
    """A table cell: plain text, or a TableDotCell as a coloured dot plus ink text (never its repr)."""
    if isinstance(value, str) or not hasattr(value, "dot"):
        return Paragraph(text(value, MAX_CELL_CHARS), style)
    dot = _Dot(safe_colour(value.dot), style.leading)
    inner = max(width - 2 * CELL_PAD - dot.d - 1.5 * mm, 6 * mm)
    t = Table(
        [[dot, Paragraph(text(value.text, MAX_CELL_CHARS), style)]],
        colWidths=[dot.d + 1.5 * mm, inner],
        hAlign={TA_CENTER: "CENTER", TA_RIGHT: "RIGHT"}.get(style.alignment, "LEFT"),
        splitInRow=1,  # the outer row splits through this cell; the text may run onto the next page
    )
    t.setStyle(TableStyle(_NO_PAD))
    return t


def _table(block: Any, ctx: RenderContext) -> list:
    cols = list(block.columns)
    if not cols:
        return []
    st, fw = ctx.styles, ctx.frame_width
    fixed = [c.width_mm * mm if c.width_mm else None for c in cols]
    known, n_free = sum(w for w in fixed if w), fixed.count(None)
    share = max((fw - known) / n_free, 12 * mm) if n_free else 0
    widths = [w or share for w in fixed]
    scale = min(1.0, fw / sum(widths))
    widths = [w * scale for w in widths]
    # Font from the column's style (mono -> mono), alignment from its align (ruling P9).
    body_styles = [
        _column_style(st.cell_mono if c.style == "mono" else st.cell, f"c{i}", c.align)
        for i, c in enumerate(cols)
    ]
    head = [
        Paragraph(text(c.label), _column_style(st.cell_head, f"h{i}", c.align)) for i, c in enumerate(cols)
    ]
    body = []
    for row in block.rows:
        cells = (list(row) + [""] * len(cols))[: len(cols)]
        body.append([_cell(v, s, w) for v, s, w in zip(cells, body_styles, widths, strict=True)])
    t = Table(
        [head, *body],
        colWidths=widths,
        repeatRows=1 if block.repeat_header else 0,
        hAlign="LEFT",
        splitInRow=1,
    )
    t.setStyle(table_style(header=True))
    return [t, Spacer(1, 4 * mm)]


def _chart(block: Any, ctx: RenderContext) -> list:
    series = [charts.ChartSeries(str(s.name), list(s.values), s.colour) for s in block.series]
    d = charts.chart_drawing(
        str(block.chart),
        series,
        [str(x) for x in block.x_labels],
        block.unit or "",
        width=ctx.frame_width,
        height=THEME["chart"]["height_mm"] * mm,
        styles=ctx.styles,
    )
    out: list = [Paragraph(text(block.title), ctx.styles.h3)] if block.title else []
    return [*out, d, Spacer(1, 4 * mm)]


def _page_break(block: Any, ctx: RenderContext) -> list:
    return [PageBreakIfNotEmpty()]


def _volume(block: Any, ctx: RenderContext) -> list:
    if ctx.volume_flowables is not None:
        try:
            return list(ctx.volume_flowables(block))
        except JobCancelled:
            raise
        except Exception as exc:
            log.warning("volume pages for %s failed (%s); printing the table form", block.measurement_id, exc)
    st = ctx.styles
    out: list = [Paragraph(text(block.title), st.h2)]
    out += [Paragraph("stale, recalculate", st.note)] if block.stale else kv_table(block.rows, ctx)
    if block.figure is not None:
        out += _figure(block.figure, ctx)
    return out


def _cover(block: Any, ctx: RenderContext) -> list:
    """A `cover` block outside the cover page (plan ruling 4): printed plainly, without the logo. On
    the cover page, document._cover_story lays it out on the band instead."""
    st = ctx.styles
    out: list = [Paragraph(text(block.title), st.h1)]
    if block.subtitle:
        out.append(Paragraph(text(block.subtitle), st.h3))
    out += kv_table(block.rows, ctx)
    if block.locator is not None:
        out += _figure(block.locator, ctx)
    return out


def _finding_band(block: Any, ctx: RenderContext) -> Table:
    st, head = ctx.styles, block.head
    label = f"{format_number(block.number)} · {head.type_name}"
    graded = bool(head.severity_name)
    tag = primitives.SeverityTag(
        head.severity_name if graded else "Ungraded", head.severity_colour if graded else None, st
    )
    fw = ctx.frame_width
    band = Table(
        [[Paragraph(text(label), st.h3), tag, Paragraph(text(str(head.status).capitalize()), st.cell_mono)]],
        colWidths=[fw - 70 * mm, 45 * mm, 25 * mm],
        hAlign="LEFT",
    )
    band.setStyle(
        TableStyle(
            [
                ("BACKGROUND", (0, 0), (-1, -1), colour("head_fill")),
                ("LINEBEFORE", (0, 0), (0, 0), 3, safe_colour(head.type_colour, "violet_print")),
                ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
                ("TOPPADDING", (0, 0), (-1, -1), 5),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 5),
                ("LEFTPADDING", (0, 0), (0, 0), 8),
            ]
        )
    )
    # document.py reads these in afterFlowable: the "(cont.)" header and the level-1 bookmark.
    band._kestrel_finding = label
    band._kestrel_bookmark = (f"f-{block.finding_id}", label, 1)
    return band


def _finding(block: Any, ctx: RenderContext) -> list:
    """Plan ruling 6: head, figures, kv, note and photos are one KeepTogether; comments flow after it.
    Every piece in the KeepTogether is splittable or shorter than a frame (figures are capped at 0.8 of
    the frame height, the note is Paragraphs), so an over-tall finding flows on instead of raising."""
    st = ctx.styles
    figs = list(block.figures)
    body: list = [_finding_band(block, ctx), Spacer(1, 3 * mm)]
    if figs:
        body += _figure(figs[0], ctx)
    body += _figure_grid(figs[1:], ctx, 2)
    body += [Spacer(1, 3 * mm), *kv_table(block.kv, ctx)]
    if block.note:
        body.append(Paragraph("Note", st.cell_label))
        body += [Paragraph(text(p.strip()), st.note) for p in re.split(r"\n\s*\n", block.note) if p.strip()]
    if block.photos:
        body += [Paragraph("Photos", st.cell_label), *_figure_grid(list(block.photos), ctx, 4, 3 * mm)]
    comments: list = []
    if block.comments:
        comments.append(Paragraph("Comments", st.cell_label))
        for c in block.comments:
            meta = f"<b>{text(c.author)}</b> · {c.created_at.strftime('%Y-%m-%d')}"
            comments += [Paragraph(meta, st.comment_meta), Paragraph(text(c.text), st.comment)]
    return [KeepTogether(body), *comments, FindingEnd(), PageBreakIfNotEmpty()]


HANDLERS: dict[str, Callable[[Any, RenderContext], list]] = {
    "cover": _cover,
    "heading": _heading,
    "para": _para,
    "kv": _kv,
    "kpis": _kpis,
    "table": _table,
    "figure": _figure,
    "figure_row": _figure_row,
    "chart": _chart,
    "page_break": _page_break,
    "volume": _volume,
}
HANDLERS["finding"] = _finding


def block_flowables(block: Any, ctx: RenderContext) -> list:
    handler = HANDLERS.get(block.kind)
    if handler is None:
        raise ValueError(f"no PDF renderer for block kind {block.kind!r}")
    return handler(block, ctx)
