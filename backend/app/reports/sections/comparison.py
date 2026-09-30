"""The survey comparison section (reports spec §7.2 row `comparison`, §9.3, §16; plan R9-M
Rulings 10-13): per pair of surveys a swipe and/or side-by-side figure with date captions (side by
side over each footprint when they do not overlap), then the counts-over-time chart."""

from __future__ import annotations

from app.reports import blocks
from app.reports.context import ComposeContext
from app.reports.schemas import ReportSectionDoc
from app.reports.sections import m_etag, survey_counts, survey_pairs

KEY = "comparison"
TITLE = "Survey comparison"
USES_FINDINGS = False
ONE_SURVEY = "One survey so far: nothing to compare."
NO_PAIR = "No comparison pair could be drawn."


def compose(ctx: ComposeContext) -> ReportSectionDoc:
    opts = ctx.options(KEY)
    out: list = []

    maps = survey_pairs.survey_maps(ctx.handle)
    if opts.pairs == "auto":
        pairs = [(a, b, None) for a, b in survey_pairs.auto_pairs(maps)]
    else:
        pairs, missing = survey_pairs.explicit_pairs(maps, [p.model_dump() for p in opts.pairs])
        if missing:
            ctx.warn("pair_missing", "{n} comparison pair(s) name a map that is not ready.", count=missing)

    if not pairs:
        out.append(blocks.para(ONE_SURVEY if len(maps) < 2 else NO_PAIR, style="note"))
    for a, b, given in pairs:
        # One AVG per pair; also used when an explicit bbox misses the common area (M6 fallback).
        centre = survey_pairs.finding_centre(ctx.handle, a.id, b.id)
        bbox = survey_pairs.frame(a, b, given, centre)
        out.append(blocks.heading(f"{a.name} → {b.name}", level=2))
        out += survey_pairs.pair_blocks(ctx, a, b, bbox, opts.mode)

    if opts.counts_chart:
        out += _chart(ctx)

    return ReportSectionDoc(key=KEY, title=TITLE, blocks=out)


def fingerprint(ctx: ComposeContext) -> str:
    """R2's etag hook: runs, site areas, the survey maps' footprints, and the findings' mean position
    on survey maps (the pair frame's centre; USES_FINDINGS is False, so the finding aggregate does
    not join this etag by itself)."""
    return m_etag.comparison(ctx)


def _chart(ctx: ComposeContext) -> list:
    data = survey_counts.load(ctx.handle)
    classes = survey_counts.chosen_classes(data, None)
    if not classes:
        return []
    labels, series = survey_counts.chart_series(data, classes, verified_only=False)
    out: list = [
        blocks.heading("Objects counted per survey", level=2),
        blocks.chart(
            "line",
            [{"name": name, "values": values, "colour": colour} for name, colour, values in series],
            labels,
            unit=survey_counts.OBJECTS,
        ),
    ]
    out += [blocks.para(n, style="small") for n in survey_counts.not_comparable_notes(data)]
    return out
