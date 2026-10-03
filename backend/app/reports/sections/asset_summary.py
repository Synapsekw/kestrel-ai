"""Asset summary (spec 2026-10-02-asset-findings §10): for one asset model (the options' choice, else
the first with asset findings in the filter), the tiles, the findings map and the zone and side
breakdowns. Every number is a SQL aggregate; the map reads placed findings in pages of 2,000 (§11), as
small tuples."""

from __future__ import annotations

from sqlalchemy import and_, case, func, select

from app.db.models import AssetModel, Finding, ImagePose, ImageReview
from app.findings.numbers import format_number
from app.reports import blocks
from app.reports.asset_drawing import map_drawing
from app.reports.asset_info import ASSET, NOT_PLACED, PLACED
from app.reports.context import ComposeContext, SectionStats
from app.reports.schemas import Block, ReportSectionDoc

KEY = "asset_summary"
TITLE = "Asset summary"
USES_FINDINGS = True
EMPTY = "No asset findings match the filters"
NO_FRAME = "This asset model has no frame or review profile yet, so its findings map is not drawn."
MAP_CAPTION = (
    "Each dot is one finding at its height and side of the asset. Findings not placed on the model are"
    " left off the map."
)
MAP_MM = (174.0, 92.0)
KEY_COL_MM = 54.0
DOT_PAGE = 2000


def chosen_model(ctx: ComposeContext) -> str | None:
    """The options' asset model, else the first (by name, then id) with asset findings in the filter."""
    wanted = ctx.options(KEY).asset_model_id
    if wanted:
        return wanted
    with ctx.session() as s:
        found = [
            m
            for m in s.execute(
                select(Finding.asset_model_id).where(ctx.where, ASSET).group_by(Finding.asset_model_id)
            ).scalars()
            if m is not None
        ]
    infos = ctx.asset_models
    return min(found, key=lambda m: (infos[m].name if m in infos else "", m), default=None)


def _where(ctx: ComposeContext, model_id: str):
    return and_(ctx.where, ASSET, Finding.asset_model_id == model_id)


def severity_counts(ctx: ComposeContext, model_id: str) -> dict[int | None, int]:
    with ctx.session() as s:
        rows = s.execute(
            select(Finding.severity, func.count()).where(_where(ctx, model_id)).group_by(Finding.severity)
        ).all()
    return {sev: n for sev, n in rows}


def sightings_total(ctx: ComposeContext, model_id: str) -> int:
    with ctx.session() as s:
        return int(
            s.execute(
                select(func.coalesce(func.sum(Finding.sighting_count), 0)).where(_where(ctx, model_id))
            ).scalar_one()
        )


def uncertain_photos(ctx: ComposeContext, model_id: str) -> int:
    """Photos posed on this asset model whose review status is `uncertain` (spec §5.4)."""
    posed = select(ImagePose.image_id).where(ImagePose.asset_model_id == model_id)
    with ctx.session() as s:
        return s.execute(
            select(func.count())
            .select_from(ImageReview)
            .where(ImageReview.status == "uncertain", ImageReview.image_id.in_(posed))
        ).scalar_one()


def _levels(ctx: ComposeContext, sevs) -> list[int]:
    return sorted(
        {lv.level for lv in ctx.scale if lv.level is not None} | {s for s in sevs if s is not None},
        reverse=True,
    )


def _tiles(ctx: ComposeContext, counts: dict, sightings: int, uncertain: int) -> Block:
    items = [blocks.kpi("Findings", str(sum(counts.values())))]
    for lv in _levels(ctx, counts):
        level = ctx.level(lv)
        items.append(blocks.kpi(level.name, str(counts.get(lv, 0)), colour=level.colour))
    if counts.get(None):
        items.append(blocks.kpi("Ungraded", str(counts[None])))
    items += [blocks.kpi("Sightings", str(sightings)), blocks.kpi("Uncertain photos", str(uncertain))]
    return blocks.kpis(items)


def map_rows(ctx: ComposeContext, model_id: str) -> list[tuple]:
    """(id, number, height_m, bearing_deg, severity) of the placed findings, keyset pages of 2,000."""
    out: list[tuple] = []
    after = 0
    while True:
        with ctx.session() as s:
            rows = s.execute(
                select(Finding.id, Finding.number, Finding.height_m, Finding.bearing_deg, Finding.severity)
                .where(
                    _where(ctx, model_id),
                    Finding.height_m.is_not(None),
                    Finding.bearing_deg.is_not(None),
                    Finding.number > after,
                )
                .order_by(Finding.number)
                .limit(DOT_PAGE)
            ).all()
        out.extend(tuple(r) for r in rows)
        if len(rows) < DOT_PAGE:
            return out
        after = rows[-1][1]


def _map(ctx: ComposeContext, info) -> Block:
    from app.asset_review.findings_map import MapDot, geometry  # P1; lazy like the other P1 reads

    rows = map_rows(ctx, info.id)
    dots = [MapDot(id=i, height_m=h, bearing_deg=b, severity=sev) for i, _, h, b, sev in rows]
    labels = {i: format_number(n) for i, n, *_ in rows}
    drawing = map_drawing(
        geometry(info.review, info.frame, dots),
        colour_of=lambda sev: ctx.level(sev).colour,
        label_of=labels.get,
    )
    return blocks.asset_map(drawing, title="", caption=MAP_CAPTION, width_mm=MAP_MM[0], height_mm=MAP_MM[1])


PLACED_NO_VALUE = ""  # the breakdown key of a placed finding with no zone (or side)


def placed_key(column):
    """`column` for a placed finding (PLACED_NO_VALUE when it is null), None for an unplaced one:
    "Not placed" is keyed on the placement, not on a null zone (a profile may have no zones)."""
    return case((Finding.placement.in_(PLACED), func.coalesce(column, PLACED_NO_VALUE)), else_=None)


def _label(info, k) -> str:
    if k is None:
        return NOT_PLACED
    if k == PLACED_NO_VALUE:
        return blocks.NONE
    return (info.zone_label(k) if info is not None else k) or blocks.NONE


def breakdown(ctx: ComposeContext, model_id: str, column) -> dict[tuple, int]:
    with ctx.session() as s:
        rows = s.execute(
            select(column, Finding.severity, func.count())
            .where(_where(ctx, model_id))
            .group_by(column, Finding.severity)
        ).all()
    return {(k, sev): n for k, sev, n in rows}


def _breakdown_table(ctx: ComposeContext, head: str, keys: list, label_of, counts: dict) -> Block:
    sevs = {sev for _, sev in counts}
    names = [(lv, ctx.level(lv).name) for lv in _levels(ctx, sevs)]
    if None in sevs:
        names.append((None, "Ungraded"))
    share = (blocks.CONTENT_WIDTH_MM - KEY_COL_MM) / (len(names) + 1)
    cols = [blocks.column("key", head, KEY_COL_MM)]
    cols += [blocks.column(f"s{lv}", name, share, "right") for lv, name in names]
    cols.append(blocks.column("total", "Total", share, "right"))
    rows = []
    for k in keys:
        cells = [counts.get((k, lv), 0) for lv, _ in names]
        rows.append([label_of(k), *map(str, cells), str(sum(cells))])
    return blocks.table(cols, rows)


def _zone_keys(info, counts: dict) -> list:
    listed = [z.id for z in info.review.zones] if info is not None and info.review is not None else []
    seen = {k for k, _ in counts}
    keys = listed + sorted(k for k in seen if k not in (None, PLACED_NO_VALUE) and k not in listed)
    return keys + [k for k in (PLACED_NO_VALUE, None) if k in seen]


def _side_keys(counts: dict) -> list:
    totals: dict = {}
    for (k, _), n in counts.items():
        totals[k] = totals.get(k, 0) + n
    keys = sorted((k for k in totals if k not in (None, PLACED_NO_VALUE)), key=lambda k: (-totals[k], k))
    return keys + [k for k in (PLACED_NO_VALUE, None) if k in totals]


def compose(ctx: ComposeContext) -> ReportSectionDoc:
    opts = ctx.options(KEY)
    mid = chosen_model(ctx)
    counts = severity_counts(ctx, mid) if mid else {}
    if not counts:
        return ReportSectionDoc(key=KEY, title=TITLE, blocks=[blocks.para(EMPTY, style="note")])
    info = ctx.asset_models.get(mid)
    out: list[Block] = [
        blocks.heading(info.name if info is not None else "Asset model", 2),
        _tiles(ctx, counts, sightings_total(ctx, mid), uncertain_photos(ctx, mid)),
    ]
    if opts.show_map:
        ready = info is not None and info.frame is not None and info.review is not None
        out.append(_map(ctx, info) if ready else blocks.para(NO_FRAME, style="note"))
    if opts.show_tables:
        zones = breakdown(ctx, mid, placed_key(Finding.zone))
        out.append(blocks.heading("Findings by zone", 3))
        out.append(_breakdown_table(ctx, "Zone", _zone_keys(info, zones), lambda k: _label(info, k), zones))
        sides = breakdown(ctx, mid, placed_key(Finding.side))
        out.append(blocks.heading("Findings by side", 3))
        out.append(_breakdown_table(ctx, "Side", _side_keys(sides), lambda k: _label(None, k), sides))
    return ReportSectionDoc(key=KEY, title=TITLE, blocks=out)


def outline(ctx: ComposeContext) -> SectionStats:
    return SectionStats(block_count=len(compose(ctx).blocks), estimated_pages=1)


def fingerprint(ctx: ComposeContext) -> str:
    """Frames, reviews and photo statuses change no finding row, so they join the etag here."""
    with ctx.session() as s:
        models = s.execute(
            select(func.max(AssetModel.updated_at), func.count()).select_from(AssetModel)
        ).one()
        reviews = s.execute(
            select(func.max(ImageReview.updated_at), func.count()).select_from(ImageReview)
        ).one()
    return f"{tuple(models)}|{tuple(reviews)}"
