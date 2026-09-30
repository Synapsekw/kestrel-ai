"""Object counts (spec §7.2; plan R9-M Rulings 13-15): per class per survey (objects), per site
area for the newest counted survey, and the photo-batch table, which counts detections, never
objects (ADR 2026-09-23-counts-live-on-run-rows)."""

from __future__ import annotations

from app.reports import blocks
from app.reports.context import ComposeContext
from app.reports.schemas import ReportSectionDoc
from app.reports.sections import survey_counts

KEY = "object_counts"
TITLE = "Object counts"
USES_FINDINGS = False
EMPTY = "No counts yet: run detection on a map or a photo batch."
WIDTH_MM = 174.0
TEXT_COL_MM = 45.0


def _options(ctx: ComposeContext):
    return ctx.options(KEY)


def _table(head: list[str], rows: list[list[str]], *, text_cols: int) -> blocks.Figure:
    numeric_n = max(1, len(head) - text_cols)
    numeric_width = max(20.0, (WIDTH_MM - TEXT_COL_MM * text_cols) / numeric_n)
    cols = []
    for i, label in enumerate(head):
        if i < text_cols:
            cols.append(blocks.column(f"c{i}", label, TEXT_COL_MM, align="left"))
        else:
            cols.append({**blocks.column(f"c{i}", label, numeric_width, align="right"), "style": "mono"})
    return blocks.table(cols, rows)


def compose(ctx: ComposeContext) -> ReportSectionDoc:
    opts = _options(ctx)
    type_ids = opts.type_ids
    verified_only = opts.verified_only
    out = [blocks.heading(TITLE, level=1)]

    data = survey_counts.load(ctx.handle)
    classes = survey_counts.chosen_classes(data, type_ids)
    if data.surveys and classes:
        unit = "verified objects" if verified_only else "objects, total (verified)"
        head, rows = survey_counts.class_table(data, classes, verified_only)
        out.append(blocks.heading(f"Per survey — {unit}", level=2))
        out.append(_table(head, rows, text_cols=1))
        out += [blocks.para(n, style="small") for n in survey_counts.not_comparable_notes(data)]
        if opts.per_area:
            label, ahead, arows = survey_counts.area_table(ctx.handle, classes, verified_only)
            if label and arows:
                out.append(blocks.heading(f"Per site area — {label}", level=2))
                out.append(_table(ahead, arows, text_cols=2))

    phead, prows = survey_counts.photo_table(ctx.handle, type_ids, verified_only)
    if prows:
        out.append(blocks.heading("Photo batches — detections", level=2))
        out.append(blocks.para(survey_counts.PHOTO_NOTE, style="note"))
        out.append(_table(phead, prows, text_cols=3))

    if len(out) == 1:
        out.append(blocks.para(EMPTY, style="body"))

    return ReportSectionDoc(key=KEY, title=TITLE, blocks=out)
