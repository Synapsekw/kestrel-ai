"""Reports: the project's saved report configurations (spec 2026-09-26-reports §6.1, §14; unit R1).

A report owns a whole `ReportConfig` (stored as JSON, validated on every write) and a list of
immutable versions that R5 writes. This module never reads findings: the list's `last_version` is
one windowed query over the page's `report_version` rows (plan R1 Budget).
"""

from __future__ import annotations

import copy
from collections.abc import Sequence

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.catalogue.handle import CatalogueHandle
from app.db.base import new_id, utcnow
from app.errors import not_found
from app.pagination import newest_first_page
from app.projects.service import ProjectHandle
from app.reports.config_write import TITLE_MAX, config_for_project, dump, invalid
from app.reports.models import Report as ReportRow
from app.reports.models import ReportAsset as AssetRow
from app.reports.models import ReportVersion
from app.reports.schemas import Report, ReportConfig, ReportListItem
from app.reports.templates import service as templates

DEFAULT_TEMPLATE_ID = "builtin-full"
PAGE_COUNT_KEY = "page_count"
CODE = "invalid_report"


def reports_folder(handle: ProjectHandle, report_id: str):
    return handle.folder / "reports" / report_id


def last_versions(s: Session, report_ids: Sequence[str]) -> dict[str, dict]:
    """report id -> its newest version `{number, state, issued_at, pages}` (Ruling 4), one query."""
    if not report_ids:
        return {}
    rn = (
        func.row_number()
        .over(
            partition_by=ReportVersion.report_id,
            order_by=(ReportVersion.created_at.desc(), ReportVersion.id.desc()),
        )
        .label("rn")
    )
    sub = (
        select(
            ReportVersion.report_id,
            ReportVersion.number,
            ReportVersion.state,
            ReportVersion.issued_at,
            ReportVersion.stats,
            rn,
        )
        .where(ReportVersion.report_id.in_(list(report_ids)))
        .subquery()
    )
    out: dict[str, dict] = {}
    for row in s.execute(select(sub).where(sub.c.rn == 1)):
        stats = row.stats or {}
        out[row.report_id] = {
            "number": row.number,
            "state": row.state,
            "issued_at": row.issued_at,
            "pages": stats.get(PAGE_COUNT_KEY),
        }
    return out


def _fields(row: ReportRow, last: dict | None) -> dict:
    return {
        "id": row.id,
        "title": row.title,
        "template_id": row.template_id,
        "archived": bool(row.archived),
        "created_at": row.created_at,
        "updated_at": row.updated_at,
        "last_version": last,
    }


def _report(s: Session, row: ReportRow) -> Report:
    last = last_versions(s, [row.id]).get(row.id)
    return Report.model_validate({**_fields(row, last), "config": row.config})


def _row(s: Session, report_id: str) -> ReportRow:
    row = s.get(ReportRow, report_id)
    if row is None:
        raise not_found("report", report_id)
    return row


def logo_problems(s: Session, config: ReportConfig, *, prefix: str = "config") -> list[dict]:
    asset_id = config.cover.logo_asset_id
    if asset_id is None or s.get(AssetRow, asset_id) is not None:
        return []
    return [{"path": f"{prefix}.cover.logo_asset_id", "message": "That logo is not in this project."}]


def create_report(
    handle: ProjectHandle, cat: CatalogueHandle | None, *, title: str, template_id: str | None = None
) -> Report:
    title = title.strip()
    template = templates.get_template(cat, template_id or DEFAULT_TEMPLATE_ID)
    config = config_for_project(template.config, title=title)
    now = utcnow()
    with handle.session() as s:
        row = ReportRow(
            id=new_id(),
            title=title,
            config=dump(config),
            template_id=template_id,
            archived=False,
            created_at=now,
            updated_at=now,
        )
        s.add(row)
        s.flush()
        return _report(s, row)


def get_report(handle: ProjectHandle, report_id: str) -> Report:
    with handle.session() as s:
        return _report(s, _row(s, report_id))


def get_report_config(handle: ProjectHandle, report_id: str) -> ReportConfig:
    with handle.session() as s:
        return ReportConfig.model_validate(_row(s, report_id).config)


def list_reports(
    handle: ProjectHandle,
    *,
    include_archived: bool = False,
    cursor: str | None = None,
    limit: int | None = None,
) -> tuple[list[ReportListItem], str | None]:
    q = select(ReportRow)
    if not include_archived:
        q = q.where(ReportRow.archived.is_(False))
    with handle.session() as s:
        rows, nxt = newest_first_page(s, q, ReportRow.updated_at, ReportRow.id, limit, cursor)
        lasts = last_versions(s, [r.id for r in rows])
        items = [ReportListItem.model_validate(_fields(r, lasts.get(r.id))) for r in rows]
    return items, nxt


def patch_report(
    handle: ProjectHandle, report_id: str, *, title: str | None = None, config: ReportConfig | None = None
) -> Report:
    with handle.session() as s:
        row = _row(s, report_id)
        if config is not None:
            problems = logo_problems(s, config)
            if problems:
                raise invalid(CODE, "The report settings are not valid.", problems)
            row.config = dump(config)
        if title is not None:
            row.title = title
        row.updated_at = utcnow()
        s.flush()
        return _report(s, row)


def delete_report(handle: ProjectHandle, report_id: str) -> str:
    """Archive when anything was rendered (a version row, or files on disk from a render in flight),
    else delete (Ruling 5)."""
    with handle.session() as s:
        row = _row(s, report_id)
        has_version = s.execute(
            select(ReportVersion.id).where(ReportVersion.report_id == report_id).limit(1)
        ).first()
        if has_version is not None or reports_folder(handle, report_id).exists():
            if not row.archived:
                row.archived = True
                row.updated_at = utcnow()
            return "archived"
        s.delete(row)
        return "deleted"


def _copy_title(title: str) -> str:
    """`"<title> (copy)"` when it fits in TITLE_MAX, else the title itself (Ruling 6)."""
    copy = f"{title} (copy)"
    return copy if len(copy) <= TITLE_MAX else title[:TITLE_MAX]


def duplicate_report(handle: ProjectHandle, report_id: str) -> Report:
    now = utcnow()
    with handle.session() as s:
        src = _row(s, report_id)
        row = ReportRow(
            id=new_id(),
            title=_copy_title(src.title),
            config=copy.deepcopy(src.config),
            template_id=src.template_id,
            archived=False,
            created_at=now,
            updated_at=now,
        )
        s.add(row)
        s.flush()
        return _report(s, row)
