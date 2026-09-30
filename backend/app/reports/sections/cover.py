"""The cover (spec §7.2; plan R2 Rulings 1, 2, 15): one `cover` block. It carries the title, the
display rows, the resolved logo (project-relative path, R4 draws it) and a map locator figure."""

from __future__ import annotations

from datetime import date

from sqlalchemy import func, select

from app.db.models import GeoMap
from app.reports import blocks
from app.reports.context import ComposeContext
from app.reports.models import ReportAsset
from app.reports.observed import observed_on
from app.reports.schemas import Block, ReportSectionDoc

KEY = "cover"
TITLE = "Cover"
USES_FINDINGS = True  # the period row
LOCATOR_MM = (80, 60)
LOCATOR_PX = (1200, 900)
BRAND = "#8F7BFF"  # violet darkened for print (spec §10.1)


def period(ctx: ComposeContext) -> str:
    obs = observed_on()
    with ctx.session() as s:
        lo, hi = s.execute(select(func.min(obs), func.max(obs)).where(ctx.where)).one()
    if lo is None:
        return "—"
    a, b = date.fromisoformat(lo), date.fromisoformat(hi)
    return blocks.fmt_date(a) if a == b else f"{blocks.fmt_date(a)} – {blocks.fmt_date(b)}"


def locator_map(ctx: ComposeContext) -> GeoMap | None:
    q = select(GeoMap).where(GeoMap.status == "ready")
    ids = ctx.config.filters.data_item_ids
    if ids is not None:
        q = q.where(GeoMap.id.in_(list(ids)))
    q = q.order_by(
        GeoMap.captured_on.is_(None), GeoMap.captured_on.desc(), GeoMap.created_at.desc(), GeoMap.id.asc()
    )
    with ctx.session() as s:
        for m in s.execute(q).scalars():  # bounded by the number of maps
            if isinstance(m.bounds_native, list) and len(m.bounds_native) == 4:
                s.expunge(m)
                return m
    return None


def _locator(ctx: ComposeContext, m: GeoMap) -> Block:
    x0, y0, x1, y1 = m.bounds_native
    ring = [[x0, y0], [x1, y0], [x1, y1], [x0, y1], [x0, y0]]
    spec = {
        "kind": "map",
        "item_id": m.id,
        "geometry": {"type": "Polygon", "coordinates": [ring]},
        "colour": BRAND,
        "label": m.name,
        "min_extent_m": 40,
        "out": list(LOCATOR_PX),
        "scale_bar": True,
        "north": True,
        "inset": False,
    }
    ref = ctx.ref(spec, width_px=LOCATOR_PX[0], height_px=LOCATOR_PX[1])
    caption = m.name + (f" · {blocks.fmt_date(m.captured_on)}" if m.captured_on else "")
    return blocks.figure(ref, caption, *LOCATOR_MM)


def logo(ctx: ComposeContext) -> dict | None:
    aid = ctx.config.cover.logo_asset_id
    if not aid:
        return None
    with ctx.session() as s:
        row = s.get(ReportAsset, aid)
        found = row is not None and (ctx.handle.folder / row.path).is_file()
        out = (
            {
                "asset_id": row.id,
                "path": row.path.replace("\\", "/"),
                "width_px": row.width,
                "height_px": row.height,
            }
            if found
            else None
        )
    if out is None:
        ctx.warn("logo_missing", "The cover logo could not be found; the cover prints without it.")
    return out


def compose(ctx: ComposeContext) -> ReportSectionDoc:
    c = ctx.config.cover
    rows = [("Project", ctx.project_name)]
    rows += [
        (label, value)
        for label, value in (("Site", c.site), ("Client", c.client), ("Author", c.author))
        if value
    ]
    rows += [
        ("Report date", blocks.fmt_date(c.report_date or ctx.today)),
        ("Period", period(ctx)),
        ("Version", f"v{ctx.version:03d}" if ctx.version else "Preview"),
        ("Status", "Issued" if ctx.issued else "Draft"),
    ]
    m = locator_map(ctx) if ctx.options(KEY).show_locator else None
    block = blocks.cover(
        c.title,
        subtitle=c.subtitle or None,
        rows=rows,
        logo=logo(ctx),
        locator=_locator(ctx, m) if m is not None else None,
    )
    return ReportSectionDoc(key=KEY, title=TITLE, blocks=[block])
