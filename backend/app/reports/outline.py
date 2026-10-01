"""The report outline and paged section blocks (spec §14; plan R2 Rulings 10-11). The outline is
aggregates plus the small sections; a blocks page is one keyset read at most. Each section's etag
hashes exactly the inputs its content depends on, so the preview refetches only what changed."""

from __future__ import annotations

import hashlib
import json
from datetime import datetime

from sqlalchemy import func, select

from app.db.models import Finding, GeoMap, PointCloud, Source, Surface
from app.errors import AppError, not_found
from app.reports.baseline import deltas as compute_deltas
from app.reports.baseline import resolve_baseline
from app.reports.compose import (
    SECTION_MODULES,
    ComposeContext,
    count_findings,
    section_page,
    section_stats,
    section_title,
)
from app.reports.schemas import BlockPage, ReportConfig, ReportOutline

DEFAULT_BLOCKS = 50
MAX_BLOCKS = 50
FINDING_SECTIONS = ("summary", "findings_table", "finding_pages")


def _context(handle, report_id: str, config: ReportConfig, generated_at: datetime, key_for) -> ComposeContext:
    return ComposeContext(
        handle=handle,
        config=config,
        report_id=report_id,
        baseline=resolve_baseline(handle, report_id),
        generated_at=generated_at,
        key_for=key_for,
    )


def _finding_fp(ctx: ComposeContext) -> list:
    with ctx.session() as s:
        row = s.execute(
            select(
                func.count(),
                func.max(Finding.updated_at),
                func.total(Finding.number),
                func.total(func.coalesce(Finding.severity, 0)),
            ).where(ctx.where)
        ).one()
    return [row[0], str(row[1]), row[2], row[3]]


# Per data item, every column a section prints or orders by: labels (finding cells, appendix), dates
# (observed, period, appendix order), status and bounds (cover locator), sizes and EPSG (appendix).
# These tables carry no updated_at, so the rows themselves are hashed.
_DATA_COLUMNS = (
    (
        Source,
        (Source.label, Source.site, Source.kind, Source.captured_on, Source.created_at, Source.image_count),
    ),
    (
        GeoMap,
        (
            GeoMap.name,
            GeoMap.status,
            GeoMap.captured_on,
            GeoMap.created_at,
            GeoMap.width,
            GeoMap.height,
            GeoMap.gsd_cm,
            GeoMap.epsg,
            GeoMap.bounds_native,
            GeoMap.bounds_wgs84,
            GeoMap.crs_wkt,
        ),
    ),
    (
        Surface,
        (
            Surface.name,
            Surface.kind,
            Surface.status,
            Surface.captured_on,
            Surface.created_at,
            Surface.cell_size_m,
            Surface.point_cloud_id,
        ),
    ),
    (
        PointCloud,
        (
            PointCloud.name,
            PointCloud.status,
            PointCloud.captured_on,
            PointCloud.created_at,
            PointCloud.point_count,
            PointCloud.epsg,
        ),
    ),
)


def _data_fp(ctx: ComposeContext) -> str:
    """A digest of the data items' printed columns; one column select per table, ordered by id,
    streamed into the hash (bounded by the number of data items, as the appendix is)."""
    h = hashlib.sha256()
    with ctx.session() as s:
        for model, cols in _DATA_COLUMNS:
            h.update(model.__tablename__.encode())
            for row in s.execute(select(model.id, *cols).order_by(model.id)):
                h.update(json.dumps(list(row), default=str).encode())
    return h.hexdigest()


def common_fingerprint(ctx: ComposeContext) -> dict:
    return {
        "filters": ctx.config.filters.model_dump(mode="json"),
        "today": ctx.today.isoformat(),
        "baseline": ctx.baseline.version_id if ctx.baseline else None,
        "project": ctx.project_name,
        "types": sorted((k, v.name, v.colour, v.kind) for k, v in ctx.types.items()),
        "scale": [(lv.level, lv.name, lv.colour) for lv in ctx.scale],
        "data": _data_fp(ctx),
        "marks": [ctx.version, ctx.issued],
        "findings": _finding_fp(ctx),
    }


def section_etag(ctx: ComposeContext, section, common: dict) -> str:
    mod = SECTION_MODULES[section.key]
    extra = getattr(mod, "fingerprint", None)
    payload = {
        "key": section.key,
        "options": section.options.model_dump(mode="json"),
        "common": {k: v for k, v in common.items() if k != "findings"},
        "findings": common["findings"] if getattr(mod, "USES_FINDINGS", True) else None,
        "cover": ctx.config.cover.model_dump(mode="json") if section.key == "cover" else None,
        "extra": extra(ctx) if extra is not None else None,
    }
    return hashlib.sha256(json.dumps(payload, sort_keys=True, default=str).encode()).hexdigest()[:16]


def _warn_common(ctx: ComposeContext, n: int) -> None:
    enabled = {s.key for s in ctx.config.sections if s.enabled}
    if n == 0 and enabled & set(FINDING_SECTIONS):
        ctx.warn("no_findings", "No findings match the filters")
    with ctx.session() as s:
        k = s.execute(
            select(func.count()).select_from(Finding).where(ctx.where, Finding.severity.is_(None))
        ).scalar_one()
    if k:
        ctx.warn("ungraded", f"{k} finding{'s are' if k != 1 else ' is'} ungraded", count=k)


def build_outline(
    handle, report_id: str, config: ReportConfig, *, generated_at: datetime, key_for=None
) -> ReportOutline:
    ctx = _context(handle, report_id, config, generated_at, key_for)
    n = count_findings(ctx)
    _warn_common(ctx, n)
    common = common_fingerprint(ctx)
    sections = []
    for sec in config.sections:
        if not sec.enabled:
            continue
        stats = section_stats(ctx, sec.key)
        sections.append(
            {
                "key": sec.key,
                "title": section_title(sec.key),
                "block_count": stats.block_count,
                "etag": section_etag(ctx, sec, common),
                "estimated_pages": stats.estimated_pages,
            }
        )
    with ctx.session() as s:
        d = compute_deltas(s, ctx.where, ctx.baseline)
    return ReportOutline.model_validate(
        {
            "report_id": report_id,
            "sections": sections,
            "finding_count": n,
            "warnings": ctx.warnings,
            "deltas": d,
        }
    )


def section_blocks(
    handle,
    report_id: str,
    config: ReportConfig,
    key: str,
    *,
    cursor: str | None,
    limit: int,
    generated_at: datetime,
    key_for=None,
) -> tuple[BlockPage, str]:
    sec = next((s for s in config.sections if s.key == key and s.enabled), None)
    if sec is None:
        raise not_found("section", key)
    if not 1 <= limit <= MAX_BLOCKS:
        raise AppError("validation_error", f"limit is 1 to {MAX_BLOCKS}", 422)
    ctx = _context(handle, report_id, config, generated_at, key_for)
    etag = section_etag(ctx, sec, common_fingerprint(ctx))
    items, nxt = section_page(ctx, key, cursor, limit)
    return BlockPage.model_validate({"items": items, "next_cursor": nxt}), etag
