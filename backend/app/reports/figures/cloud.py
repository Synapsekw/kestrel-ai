"""3D views for cloud findings and cloud measurements (reports spec §9.4; unit R9-C).

Compose hooks only: per subject a few primary-key reads through C's `views.stored_view` (never the
`cloud_view` table), at most one LIMIT-1 surface query, and figures that only reference their
snapshot (spec + key); R3's cache renders them later. Fallbacks when no view is saved: a hillshade
plan of a ready cloud DSM of the same cloud covering the anchor, else a placeholder.

A figure module may also define `warnings(ctx) -> None`; `finding_pages.outline(ctx)` calls it (plan
R2 Ruling 11) so the builder chip sees 3D warnings even on finding pages compose() never visits on
this call. It may also define `fingerprint(ctx) -> str`; `finding_pages.fingerprint(ctx)` appends it
to the section etag, so a capture/re-capture (which changes no finding row) still moves the preview."""

from __future__ import annotations

import hashlib

from sqlalchemy import func, select

from app.db.models import Finding, Surface
from app.measurements.schemas import MeasurementItem
from app.pointclouds import views
from app.reports import blocks
from app.reports.blocks import Figure
from app.reports.context import PAGE, ComposeContext, FindingRow
from app.reports.schemas import ElevationSpec, View3dSpec
from app.reports.snapshots import view3d

STALE = "view3d_stale"
MISSING_CODE = "view3d_missing"
VIEW_MM = (170, 106)  # the stored 1600 x 1000 view at its own 1.6 aspect
PLAN_MM = (140, 105)
PLAN_OUT = (1200, 900)
STALE_SUFFIX = " (out of date: the anchor moved after capture)"

_PLURAL = {
    STALE: "{n} 3D views are out of date",
    MISSING_CODE: "{n} 3D views are missing",
}
_SINGULAR = {
    STALE: "1 3D view is out of date",
    MISSING_CODE: "1 3D view is missing",
}


def deep_link(project_id: str, cloud_id: str, finding_id: str | None = None) -> str:
    """Where "Capture missing views" / Refresh view repairs it (spec §9.4, F §8.7)."""
    base = f"/p/{project_id}/clouds/{cloud_id}"
    return f"{base}?finding={finding_id}" if finding_id else base


def covering_surface(handle, cloud_id: str, x: float, y: float) -> tuple[str, str] | None:
    """(id, name) of the newest ready cloud DSM built from `cloud_id` whose bounds hold (x, y).
    Same cloud, so same CRS; one LIMIT-1 query (Ruling 3)."""
    b = Surface.bounds_native
    q = (
        select(Surface.id, Surface.name)
        .where(
            Surface.kind == "cloud_dsm",
            Surface.status == "ready",
            Surface.point_cloud_id == cloud_id,
            b.is_not(None),
            func.json_extract(b, "$[0]") <= x,
            func.json_extract(b, "$[1]") <= y,
            func.json_extract(b, "$[2]") >= x,
            func.json_extract(b, "$[3]") >= y,
        )
        .order_by(Surface.created_at.desc(), Surface.id.desc())
        .limit(1)
    )
    with handle.session() as s:
        row = s.execute(q).first()
    return (row[0], row[1]) if row else None


def warn(ctx: ComposeContext, code: str, link: str) -> None:
    """One aggregated warning per code, built on R2's `ctx.warn` (Ruling A4): it aggregates the
    count and keeps the first link, formatting later calls from the plural template it stores. The
    first call is rewritten to the singular wording here; never re-parse the message's integer."""
    ctx.warn(code, _PLURAL[code], link=link)
    for i, w in enumerate(ctx.warnings):
        if w.code == code:
            if w.count == 1:
                ctx.warnings[i] = w.model_copy(update={"message": _SINGULAR[code]})
            return


def _warn_view(ctx: ComposeContext, cloud_id: str, finding_id: str, view) -> None:
    """The one classification `finding_figures` and the `warnings(ctx)` hook share (Ruling A5):
    MISSING when there is no stored view, STALE when there is one but it is out of date."""
    link = deep_link(ctx.handle.id, cloud_id, finding_id)
    if view is None:
        warn(ctx, MISSING_CODE, link)
    elif view.meta.stale:
        warn(ctx, STALE, link)


def _cloud_rows(ctx: ComposeContext):
    """(finding_id, cloud_id, x, y) for cloud findings in `ctx.where`, one bounded page (`PAGE`) at
    a time in number order (Ruling A5/A6): no session or ORM row is held across pages."""
    last = -1
    while True:
        with ctx.session() as s:
            page = s.execute(
                select(Finding.number, Finding.id, Finding.cloud_id, Finding.x, Finding.y)
                .where(ctx.where, Finding.anchor_kind == "cloud", Finding.number > last)
                .order_by(Finding.number.asc())
                .limit(PAGE)
            ).all()
        if not page:
            return
        for _number, finding_id, cloud_id, x, y in page:
            yield finding_id, cloud_id, x, y
        last = page[-1][0]
        if len(page) < PAGE:
            return


def finding_figures(ctx: ComposeContext, finding: FindingRow) -> list[Figure]:
    """[] unless a cloud finding; else its one main figure: the stored view, the hillshade plan of a
    covering cloud DSM, or a placeholder with the capture reason (spec §9.4)."""
    if finding.anchor_kind != "cloud" or finding.cloud_id is None:
        return []
    cloud_id, x, y = finding.cloud_id, finding.x, finding.y
    spec = View3dSpec(kind="view3d", subject_kind="finding", subject_id=finding.id, cloud_id=cloud_id)
    view = views.stored_view(ctx.handle, "finding", finding.id)
    _warn_view(ctx, cloud_id, finding.id, view)
    if view is not None:
        return [_view_figure(ctx, spec, view, prefix="")]
    surface = covering_surface(ctx.handle, cloud_id, x, y)
    if surface is not None:
        return [_plan_figure(ctx, surface, {"type": "Point", "coordinates": [x, y]}, prefix="")]
    return [_placeholder_figure(ctx, spec, view3d.NO_VIEW["finding"], prefix="")]


def _view_figure(ctx: ComposeContext, spec, view, *, prefix: str) -> Figure:
    caption = f"{prefix}3D view, captured {_captured(view.meta.captured_at)}"
    if view.meta.stale:
        caption += STALE_SUFFIX
    ref = ctx.ref(spec, width_px=view3d.OUT[0], height_px=view3d.OUT[1])
    return blocks.figure(ref, caption, VIEW_MM[0], VIEW_MM[1])


def _plan_figure(ctx: ComposeContext, surface: tuple[str, str], geometry: dict, *, prefix: str) -> Figure:
    surface_id, name = surface
    spec = ElevationSpec(
        kind="elevation", item_id=surface_id, geometry=geometry, overlay="none", out=list(PLAN_OUT)
    )
    ref = ctx.ref(spec, width_px=PLAN_OUT[0], height_px=PLAN_OUT[1])
    caption = f"{prefix}Plan view of {name}: no 3D view saved"
    return blocks.figure(ref, caption, PLAN_MM[0], PLAN_MM[1])


def _placeholder_figure(ctx: ComposeContext, spec, reason: str, *, prefix: str) -> Figure:
    """A view3d ref whose source_version carries `MISSING` + `reason`: capturing a view changes the
    key, and rendering it now raises `SnapshotUnavailable(reason)`, which R3 prints as its
    placeholder (Ruling 6)."""
    ref = ctx.ref(spec, width_px=view3d.OUT[0], height_px=view3d.OUT[1], missing_reason=reason)
    return blocks.figure(ref, f"{prefix}No 3D view", VIEW_MM[0], VIEW_MM[1])


def _captured(when) -> str:
    return f"{when:%d %b %Y}"


def warnings(ctx: ComposeContext) -> None:
    """Every 3D warning the builder chip should see, even from finding pages this compose call never
    visits (Ruling A5): one `stored_view` read per cloud finding in `ctx.where`."""
    for finding_id, cloud_id, _x, _y in _cloud_rows(ctx):
        view = views.stored_view(ctx.handle, "finding", finding_id)
        _warn_view(ctx, cloud_id, finding_id, view)


def fingerprint(ctx: ComposeContext) -> str:
    """sha256 over, per cloud finding in `ctx.where`: finding_id + the stored view's sha256 (or "-")
    + its stale flag (Ruling A6) — a capture/re-capture changes no finding row, so this is what
    moves the finding_pages section etag."""
    h = hashlib.sha256()
    for finding_id, _cloud_id, _x, _y in _cloud_rows(ctx):
        view = views.stored_view(ctx.handle, "finding", finding_id)
        sha = view.meta.sha256 if view is not None else "-"
        stale = bool(view.meta.stale) if view is not None else False
        h.update(f"{finding_id}:{sha}:{stale}".encode())
    return h.hexdigest()


def measurement_figure(ctx: ComposeContext, row: MeasurementItem) -> Figure | None:
    return None
