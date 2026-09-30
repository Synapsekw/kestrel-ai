"""Report templates (spec 2026-09-26-reports §6.2): app-wide rows in F's `catalogue.db`.

When the catalogue is unavailable (`app.state.catalogue is None`) the four built-ins are served
from `builtins.py` - the same data R0's migration seeds - and every custom template answers 503
`catalogue_unavailable`. Built-ins can be duplicated (the client POSTs their config under a new
name), never edited or deleted: 409 `builtin_template`, checked before the catalogue (Ruling 9).
"""

from __future__ import annotations

from sqlalchemy import case, select, tuple_

from app.catalogue.db import ReportTemplate as TemplateRow
from app.catalogue.handle import CatalogueHandle, catalogue_unavailable
from app.db.base import new_id, utcnow
from app.errors import AppError, not_found
from app.pagination import decode_cursor, encode_cursor
from app.reports.config_write import dump, portable_config
from app.reports.schemas import ReportConfig, ReportTemplate
from app.reports.templates.builtins import BUILTIN_IDS as _CODE_BUILTIN_IDS
from app.reports.templates.builtins import BUILTIN_TEMPLATES
from app.reports.templates.builtins import builtin_template as _code_builtin

TEMPLATE_LIMIT_DEFAULT = 100
TEMPLATE_LIMIT_MAX = 200
BUILTIN_IDS = frozenset(_CODE_BUILTIN_IDS)
_RANK = case((TemplateRow.builtin.is_(True), 0), else_=1)


def builtin_template(template_id: str) -> AppError:
    """The 409 a built-in's PATCH/DELETE answers (plan R1 Ruling 9). Named to match R0's lookup
    function in `builtins.py`, imported here as `_code_builtin` to avoid the clash (Ruling P6)."""
    return AppError(
        "builtin_template",
        "Built-in templates cannot be changed. Save a copy under a new name instead.",
        409,
        {"template_id": template_id},
    )


def _limit(limit: int | None) -> int:
    return max(1, min(TEMPLATE_LIMIT_MAX, limit or TEMPLATE_LIMIT_DEFAULT))


def _out(row: TemplateRow) -> ReportTemplate:
    return ReportTemplate.model_validate(row, from_attributes=True)


def _code_builtins() -> list[ReportTemplate]:
    return sorted(BUILTIN_TEMPLATES, key=lambda t: (t.name, t.id))


def list_templates(
    cat: CatalogueHandle | None, *, cursor: str | None = None, limit: int | None = None
) -> tuple[list[ReportTemplate], str | None]:
    """Built-ins first, then custom, each by name and id; keyset on (rank, name, id) (Ruling 7)."""
    if cat is None:
        return ([] if cursor else _code_builtins()), None
    n = _limit(limit)
    q = select(TemplateRow).order_by(_RANK, TemplateRow.name, TemplateRow.id)
    c = decode_cursor(cursor, "r", "n", "id")
    if c:
        q = q.where(
            tuple_(_RANK, TemplateRow.name, TemplateRow.id) > tuple_(int(c["r"]), str(c["n"]), str(c["id"]))
        )
    with cat.session() as s:
        rows = list(s.execute(q.limit(n + 1)).scalars())
        items = [_out(r) for r in rows[:n]]
        nxt = None
        if len(rows) > n:
            last = rows[n - 1]
            nxt = encode_cursor(r=0 if last.builtin else 1, n=last.name, id=last.id)
    return items, nxt


def get_template(cat: CatalogueHandle | None, template_id: str) -> ReportTemplate:
    if cat is None:
        code = _code_builtin(template_id)
        if code is not None:
            return code
        raise catalogue_unavailable()
    with cat.session() as s:
        row = s.get(TemplateRow, template_id)
        if row is not None:
            return _out(row)
    code = _code_builtin(template_id)  # the seed row is missing: serve the code copy
    if code is not None:
        return code
    raise not_found("report template", template_id)


def create_template(
    cat: CatalogueHandle | None, *, name: str, description: str | None, config: ReportConfig
) -> ReportTemplate:
    if cat is None:
        raise catalogue_unavailable()
    now = utcnow()
    with cat.session() as s:
        row = TemplateRow(
            id=new_id(),
            name=name,
            description=description or "",
            builtin=False,
            config=dump(portable_config(config)),
            created_at=now,
            updated_at=now,
        )
        s.add(row)
        s.flush()
        return _out(row)


def _custom_row(s, template_id: str) -> TemplateRow:
    row = s.get(TemplateRow, template_id)
    if row is None:
        raise not_found("report template", template_id)
    if row.builtin:
        raise builtin_template(template_id)
    return row


def update_template(
    cat: CatalogueHandle | None,
    template_id: str,
    *,
    name: str | None = None,
    description: str | None = None,
    config: ReportConfig | None = None,
) -> ReportTemplate:
    if template_id in BUILTIN_IDS:
        raise builtin_template(template_id)
    if cat is None:
        raise catalogue_unavailable()
    with cat.session() as s:
        row = _custom_row(s, template_id)
        if name is not None:
            row.name = name
        if description is not None:
            row.description = description
        if config is not None:
            row.config = dump(portable_config(config))
        row.updated_at = utcnow()
        s.flush()
        return _out(row)


def delete_template(cat: CatalogueHandle | None, template_id: str) -> None:
    if template_id in BUILTIN_IDS:
        raise builtin_template(template_id)
    if cat is None:
        raise catalogue_unavailable()
    with cat.session() as s:
        s.delete(_custom_row(s, template_id))
