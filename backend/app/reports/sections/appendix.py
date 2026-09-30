"""The appendix (spec §7.2): every data item in the filter, the method notes, and the model
provenance of model-created findings. Data items are paged per provider by 200 (bounded)."""

from __future__ import annotations

import math
from collections.abc import Iterator

from sqlalchemy import func, select

from app.data_items.providers import PROVIDERS, SortKey
from app.data_items.schemas import DataItem
from app.db.models import Finding
from app.reports import blocks
from app.reports.context import PAGE, ComposeContext, SectionStats
from app.reports.schemas import Block, ReportSectionDoc

KEY = "appendix"
TITLE = "Appendix"
USES_FINDINGS = True  # model provenance
# The four survey data-item types (spec §7.2); `drawing` (added later, PROVIDERS["drawing"]) is a
# reference overlay, not a survey data item, so it is not listed in the appendix.
TYPES = (
    ("image_set", "Image set"),
    ("map", "Map"),
    ("elevation", "Elevation"),
    ("point_cloud", "Point cloud"),
)
ROWS_PER_BLOCK = 40
COLS = (
    ("type", "Type", 26),
    ("label", "Label", 52),
    ("captured_on", "Captured on", 26),
    ("size", "Size", 44),
    ("crs", "CRS", 26),
)


def data_items(ctx: ComposeContext) -> Iterator[DataItem]:
    ids = ctx.config.filters.data_item_ids
    wanted = set(ids) if ids is not None else None
    with ctx.session() as s:
        for kind, _ in TYPES:
            provider, after = PROVIDERS[kind], None
            while True:
                page = provider.page(s, after, PAGE)
                yield from (it for it in page if wanted is None or it.id in wanted)
                if len(page) < PAGE:
                    break
                after = SortKey.of(page[-1])


def _size(item: DataItem) -> str:
    s = item.summary
    if item.type == "image_set":
        return f"{s.get('image_count') or 0} images"
    if item.type == "map":
        parts = [f"{s['width']}×{s['height']} px"] if s.get("width") else []
        if s.get("gsd_cm"):
            parts.append(f"GSD {s['gsd_cm']:.1f} cm")
        return " · ".join(parts) or "—"
    if item.type == "elevation":
        return f"cell {s['cell_size_m']:g} m" if s.get("cell_size_m") else "—"
    return f"{s['point_count']:,} points" if s.get("point_count") else "—"


def _row(item: DataItem) -> list[str]:
    label = dict(TYPES)[item.type]
    crs = f"EPSG:{item.summary['epsg']}" if item.summary.get("epsg") else "—"
    return [label, item.label, blocks.fmt_date(item.captured_on), _size(item), crs]


def _count(ctx: ComposeContext) -> int:
    """The number of data items the filter selects, per provider `count`/`count_query` (SQL
    aggregate, never a paginated walk — outline's binding constraint)."""
    ids = ctx.config.filters.data_item_ids
    wanted = set(ids) if ids is not None else None
    with ctx.session() as s:
        total = 0
        for kind, _ in TYPES:
            provider = PROVIDERS[kind]
            if wanted is None:
                total += provider.count(s)
            else:
                id_col = provider.columns()[2]
                total += s.execute(provider.count_query().where(id_col.in_(wanted))).scalar_one()
    return total


def _has_model_provenance(ctx: ComposeContext) -> bool:
    """Whether any model-created finding matches the filter (SQL aggregate, not `_provenance`'s
    group-by rows — outline only needs to know if the provenance table would be non-empty)."""
    with ctx.session() as s:
        n = s.execute(
            select(func.count()).select_from(Finding).where(ctx.where, Finding.created_by.like("model:%"))
        ).scalar_one()
    return n > 0


def _provenance(ctx: ComposeContext) -> list[list[str]]:
    with ctx.session() as s:
        rows = s.execute(
            select(Finding.created_by, func.count(), func.avg(Finding.confidence))
            .where(ctx.where, Finding.created_by.like("model:%"))
            .group_by(Finding.created_by)
            .order_by(Finding.created_by)
        ).all()
    return [[who, str(n), f"{conf:.2f}" if conf is not None else "—"] for who, n, conf in rows]


def _methods(ctx: ComposeContext) -> list[Block]:
    scale = ", ".join(f"{lv.level} {lv.name}" for lv in ctx.scale)
    out = [
        blocks.heading("Methods", level=2),
        blocks.para(
            "Observed date: the capture time of a finding's image, else the survey date of its data "
            "item, else the day the finding was recorded. Dates are UTC days."
        ),
        blocks.para(f"Severity scale: {scale}. Ungraded findings have no level."),
        blocks.para("Coordinates are the WGS84 latitude and longitude of each finding's anchor."),
    ]
    prov = _provenance(ctx)
    if prov:
        cols = [
            blocks.column("model", "Model", 94),
            blocks.column("n", "Findings", 40, "right"),
            blocks.column("conf", "Mean confidence", 40, "right"),
        ]
        out += [blocks.heading("Model provenance", level=3), blocks.table(cols, prov)]
    return out


def compose(ctx: ComposeContext) -> ReportSectionDoc:
    rows = [_row(it) for it in data_items(ctx)]
    cols = [blocks.column(k, label, w) for k, label, w in COLS]
    out: list[Block] = [
        blocks.table(cols, rows[i : i + ROWS_PER_BLOCK]) for i in range(0, len(rows), ROWS_PER_BLOCK)
    ]
    if not rows:
        out.append(blocks.para("No data items", style="note"))
    if ctx.options(KEY).include_methods:
        out += _methods(ctx)
    return ReportSectionDoc(key=KEY, title=TITLE, blocks=out)


def outline(ctx: ComposeContext) -> SectionStats:
    """Block count computed analytically (never by walking data items or calling `compose`), so it
    stays a SQL aggregate: `_count` mirrors `compose`'s per-40 table blocks (or the one "No data
    items" note), and `_has_model_provenance` mirrors whether `_methods` appends its provenance
    table. Must equal `len(compose(ctx).blocks)` for every option/filter combination."""
    n = _count(ctx)
    block_count = math.ceil(n / ROWS_PER_BLOCK) if n else 1
    if ctx.options(KEY).include_methods:
        block_count += 4  # Methods heading + 3 fixed paragraphs
        if _has_model_provenance(ctx):
            block_count += 2  # "Model provenance" heading + table
    return SectionStats(block_count=block_count, estimated_pages=1 + math.ceil(n / ROWS_PER_BLOCK))
