"""Measurements (reports spec §7.2; plan R9-M Rulings 8-9): one table per report kind from M's
union (`app.measurements.union`), in the order length, area, height, lean, profile, volume, each
followed by its figures when `options.snapshots` is true; a volume prints the `volume` block
(`volume_block.py`) instead of a plain figure. Paged: one union page of rows at a time
(`measure_rows.iter_group_pages`) - never the whole union in memory."""

from __future__ import annotations

from app.reports import blocks
from app.reports.context import ComposeContext
from app.reports.schemas import ReportSectionDoc
from app.reports.sections import m_etag, measure_figures, measure_rows, volume_block

KEY = "measurements"
TITLE = "Measurements"
USES_FINDINGS = False
EMPTY = "No measurements match."


def compose(ctx: ComposeContext) -> ReportSectionDoc:
    opts = ctx.options(KEY)
    kinds = set(opts.kinds)
    snapshots = opts.snapshots
    ids = set(opts.measurement_ids) if opts.measurement_ids else None
    out: list = []
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
    if not out:
        out.append(blocks.para(EMPTY, style="note"))
    if stale:
        ctx.warn("volume_stale", "{n} volume measurements are stale", count=stale)
    return ReportSectionDoc(key=KEY, title=TITLE, blocks=out)


def fingerprint(ctx: ComposeContext) -> str:
    """R2's etag hook: aggregates over the measurement tables plus what the volume blocks and the
    figure targets read (surfaces, the runs volumes mask with, map footprints)."""
    return m_etag.measurements(ctx)
