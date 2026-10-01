"""Measurements (reports spec §7.2; plan R9-M Rulings 8-9): one table per report kind from M's
union (`app.measurements.union`), in the order length, area, height, lean, profile, volume, each
followed by its figures when `options.snapshots` is true; a volume prints the `volume` block
(`volume_block.py`) instead of a plain figure. Paged: one union page of rows at a time
(`measure_rows.iter_group_pages`) - never the whole union in memory."""

from __future__ import annotations

import hashlib

from sqlalchemy import select

from app.db.models import CloudMeasurement
from app.pointclouds import views
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
    figure targets read (surfaces, the runs volumes mask with, map footprints), plus, when snapshots
    are on, each cloud measurement's stored 3D view (sha256 + stale flag): a capture/re-capture or a
    view turning stale touches no measurement row, so only this moves the etag."""
    base = m_etag.measurements(ctx)
    if not ctx.options(KEY).snapshots:
        return base
    with ctx.session() as s:
        ids = list(s.execute(select(CloudMeasurement.id).order_by(CloudMeasurement.id)).scalars())
    h = hashlib.sha256(base.encode())
    for mid in ids:
        view = views.stored_view(ctx.handle, "cloud_measurement", mid)
        sha = view.meta.sha256 if view is not None else "-"
        stale = bool(view.meta.stale) if view is not None else False
        h.update(f"{mid}:{sha}:{stale}".encode())
    return h.hexdigest()
