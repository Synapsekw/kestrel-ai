"""Measurements (reports spec §7.2; plan R9-M Rulings 8-9): one table per report kind from M's
union (`app.measurements.union`), in the order length, area, height, lean, profile, volume, each
followed by its figures when `options.snapshots` is true; a volume prints the `volume` block
(`volume_block.py`) instead of a plain figure. Paged: one union page of rows at a time
(`measure_rows.iter_group_pages`) - never the whole union in memory."""

from __future__ import annotations

from app.reports import blocks
from app.reports.context import ComposeContext
from app.reports.figures import map_specs
from app.reports.schemas import ReportSectionDoc
from app.reports.sections import measure_figures, measure_rows, volume_block

KEY = "measurements"
TITLE = "Measurements"
USES_FINDINGS = False
EMPTY = "No measurements match."


def compose(ctx: ComposeContext) -> ReportSectionDoc:
    opts = map_specs.options_of(ctx, KEY)
    kinds = set(opts.get("kinds") or measure_rows.ORDER)
    snapshots = opts.get("snapshots", True) is not False
    ids = set(opts["measurement_ids"]) if opts.get("measurement_ids") else None
    out = [blocks.heading(TITLE, level=1)]
    stale = 0
    for group in measure_rows.ORDER:
        if group not in kinds:
            continue
        rows: list[list[str]] = []
        after: list = []
        for page in measure_rows.iter_group_pages(ctx.handle, group, ids):
            labels = measure_rows.data_labels(ctx.handle, page)
            for item in page:
                if group == "volume":
                    vb = volume_block.volume_block(ctx, item.id, with_figure=snapshots)
                    stale += vb.stale
                    rows.append(measure_rows.table_row(item, labels, stale=vb.stale))
                    after.append(vb)
                else:
                    rows.append(measure_rows.table_row(item, labels))
                    if snapshots:
                        after.extend(measure_figures.figures_for(ctx, item))
        if rows:
            out.append(blocks.heading(measure_rows.TITLES[group], level=2))
            out.append(measure_rows.table(rows))
            out.extend(after)
    if len(out) == 1:
        out.append(blocks.para(EMPTY, style="body"))
    if stale:
        ctx.warn("volume_stale", "{n} volume measurements are stale", count=stale)
    return ReportSectionDoc(key=KEY, title=TITLE, blocks=out)
