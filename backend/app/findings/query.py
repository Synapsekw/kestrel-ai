"""Reading findings (spec 2026-09-26-foundation sections 8.3, 10.3): the filtered, keyset-paged list
behind the Findings tab, bulk edits, the pre-aggregated summary and in-project search.

Every sort has a total order (ties broken by `number`), and the cursor carries the sort's key of the
last row, so a page boundary holds while findings are created or change: a row that newly sorts
before the cursor is not shown in later pages, and none is shown twice.
"""

from __future__ import annotations

from collections import Counter
from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from datetime import date, datetime, timedelta
from typing import Any

from sqlalchemy import and_, func, or_, select
from sqlalchemy.orm import Session

from app.catalogue.names import like_pattern
from app.db.models import Finding, FindingCount, FindingDaily, ProjectType
from app.errors import AppError
from app.findings import counts, numbers, service
from app.pagination import clamp_limit, decode_cursor, encode_cursor

SORTS = ("-severity", "number", "-updated_at", "type")
SORT_KEYS = {"-severity": ("s",), "number": (), "-updated_at": ("u",), "type": ("t",)}
MAX_PAGE = 500
MAX_BULK = 1000
TREND_DAYS = 60
TOP_TYPES = 10


@dataclass
class FindingFilters:
    status: list[str] | None = None
    severity: list[str] | None = None  # "1".."9" or "none"
    type_id: list[str] | None = None
    anchor_kind: list[str] | None = None
    data_id: str | None = None
    image_id: str | None = None  # I's agreed addition (spec section 13)
    created_by: str | None = None  # human | model
    q: str | None = None
    updated_from: datetime | None = None
    updated_to: datetime | None = None
    has_location: bool | None = None


def _where(q, f: FindingFilters):
    if f.status:
        q = q.where(Finding.status.in_(f.status))
    if f.severity:
        levels = [int(v) for v in f.severity if v != "none"]
        conds = []
        if levels:
            conds.append(Finding.severity.in_(levels))
        if "none" in f.severity:
            conds.append(Finding.severity.is_(None))
        q = q.where(or_(*conds))
    if f.type_id:
        q = q.where(Finding.type_id.in_(f.type_id))
    if f.anchor_kind:
        q = q.where(Finding.anchor_kind.in_(f.anchor_kind))
    if f.data_id:
        q = q.where(Finding.data_id == f.data_id)
    if f.image_id:
        q = q.where(Finding.anchor_kind == "image", Finding.image_id == f.image_id)
    if f.created_by == "human":
        q = q.where(Finding.created_by == "human")
    elif f.created_by == "model":
        q = q.where(Finding.created_by.like("model:%"))
    if f.updated_from is not None:
        q = q.where(Finding.updated_at >= f.updated_from)
    if f.updated_to is not None:
        q = q.where(Finding.updated_at <= f.updated_to)
    if f.has_location is True:
        q = q.where(Finding.lon.is_not(None), Finding.lat.is_not(None))
    elif f.has_location is False:
        q = q.where(or_(Finding.lon.is_(None), Finding.lat.is_(None)))
    text = (f.q or "").strip()
    if text:
        pattern = like_pattern(text)
        names = select(ProjectType.type_id).where(ProjectType.name.ilike(pattern, escape="\\"))
        conds = [Finding.note.ilike(pattern, escape="\\"), Finding.type_id.in_(names)]
        n = numbers.parse_number(text)
        if n is not None:
            conds.append(Finding.number == n)
        q = q.where(or_(*conds))
    return q


def _type_name():
    name = (
        select(ProjectType.name)
        .where(ProjectType.type_id == Finding.type_id)
        .correlate(Finding)
        .scalar_subquery()
    )
    return func.coalesce(name, "")


def _cursor_key(sort: str, row: Finding, names: Mapping[str, str]) -> dict[str, Any]:
    if sort == "-severity":
        return {"s": counts.NO_SEVERITY if row.severity is None else row.severity}
    if sort == "-updated_at":
        return {"u": row.updated_at.isoformat()}
    if sort == "type":
        return {"t": names.get(row.type_id, "")}
    return {}


def list_findings(
    s: Session,
    filters: FindingFilters,
    *,
    sort: str = "-severity",
    cursor: str | None = None,
    limit: int | None = None,
) -> tuple[list[Finding], str | None]:
    if sort not in SORTS:
        raise AppError("validation_error", f"sort is one of {', '.join(SORTS)}", 422)
    n = min(clamp_limit(limit), MAX_PAGE)
    q = _where(select(Finding), filters)
    c = decode_cursor(cursor, "sort", "n")
    if c and c["sort"] != sort:
        raise AppError("validation_error", "the cursor belongs to another sort order", 422)
    c = decode_cursor(cursor, "sort", "n", *SORT_KEYS[sort])
    names: dict[str, str] = {}
    if sort == "-severity":
        sev = func.coalesce(Finding.severity, counts.NO_SEVERITY)  # "no severity" sorts last
        if c:
            q = q.where(or_(sev < c["s"], and_(sev == c["s"], Finding.number < c["n"])))
        q = q.order_by(sev.desc(), Finding.number.desc())
    elif sort == "number":
        if c:
            q = q.where(Finding.number > c["n"])
        q = q.order_by(Finding.number.asc())
    elif sort == "-updated_at":
        if c:
            try:
                at = datetime.fromisoformat(c["u"])
            except (TypeError, ValueError):
                raise AppError("validation_error", "invalid cursor", 422) from None
            q = q.where(or_(Finding.updated_at < at, and_(Finding.updated_at == at, Finding.number < c["n"])))
        q = q.order_by(Finding.updated_at.desc(), Finding.number.desc())
    else:
        tname = _type_name()
        if c:
            q = q.where(or_(tname > c["t"], and_(tname == c["t"], Finding.number > c["n"])))
        q = q.order_by(tname.asc(), Finding.number.asc())
        names = dict(s.execute(select(ProjectType.type_id, ProjectType.name)).all())
    rows = s.execute(q.limit(n + 1)).scalars().all()
    nxt = None
    if len(rows) > n:
        last = rows[n - 1]
        nxt = encode_cursor(sort=sort, n=last.number, **_cursor_key(sort, last, names))
    return list(rows[:n]), nxt


def bulk(
    s: Session, *, project_id: str, catalogue, ids: Sequence[str], set_fields: Mapping[str, Any]
) -> dict:
    """One transaction; a finding the change cannot apply to is skipped with its error code
    (spec section 8.3). `patch_in_session` checks before it writes, so a skip leaves nothing behind."""
    if len(ids) > MAX_BULK:
        raise AppError("validation_error", f"at most {MAX_BULK} findings at a time", 422)
    updated, skipped = 0, []
    for fid in dict.fromkeys(ids):
        try:
            service.patch_in_session(
                s, project_id=project_id, catalogue=catalogue, finding_id=fid, fields=dict(set_fields)
            )
            updated += 1
        except AppError as e:
            if e.status >= 500:  # the catalogue is down: nothing in the batch can be trusted
                raise
            skipped.append({"id": fid, "code": e.code})
    return {"updated": updated, "skipped": skipped}


def trend(s: Session, day: date) -> list[dict]:
    """The last 60 days, oldest first. A day without a row carries the last known open numbers
    forward (nothing changed that day) and has no closures."""
    since = day - timedelta(days=TREND_DAYS - 1)
    rows = {
        r.day: r
        for r in s.execute(
            select(FindingDaily).where(FindingDaily.day >= since, FindingDaily.day <= day)
        ).scalars()
    }
    prior = s.execute(
        select(FindingDaily).where(FindingDaily.day < since).order_by(FindingDaily.day.desc()).limit(1)
    ).scalar_one_or_none()
    open_, by = (prior.open, dict(prior.open_by_severity or {})) if prior is not None else (0, {})
    out = []
    for i in range(TREND_DAYS):
        d = since + timedelta(days=i)
        r = rows.get(d)
        if r is not None:
            open_, by = r.open, dict(r.open_by_severity or {})
        out.append(
            {
                "day": d,
                "open": open_,
                "closed": r.closed if r is not None else 0,
                "open_by_severity": dict(sorted(by.items(), key=lambda kv: int(kv[0]))),
            }
        )
    return out


def summary(s: Session, *, day: date | None = None, levels: Sequence[int] = ()) -> dict:
    """`finding_count` and `finding_daily` only: three small reads, whatever the number of findings
    (spec section 8.3). "Open" means not closed. `levels` are the scale's levels, so an empty level
    still gets its (zero) bar. Type names and colours come from the project's type list client-side."""
    rows = s.execute(
        select(FindingCount.status, FindingCount.severity, FindingCount.type_id, FindingCount.n).where(
            FindingCount.n > 0
        )
    ).all()
    by_status = dict.fromkeys(service.STATUSES, 0)
    open_sev: Counter = Counter()
    open_none = 0
    by_type: Counter = Counter()
    for status, sev, type_id, n in rows:
        by_status[status] = by_status.get(status, 0) + n
        if status in counts.OPEN_STATES:
            if sev == counts.NO_SEVERITY:
                open_none += n
            else:
                open_sev[sev] += n
            by_type[type_id] += n
    return {
        "by_status": by_status,
        "open_by_severity": {str(lv): open_sev.get(lv, 0) for lv in sorted(set(levels) | set(open_sev))},
        "open_no_severity": open_none,
        "by_type": [{"type_id": t, "n": n} for t, n in by_type.most_common(TOP_TYPES)],
        "trend": trend(s, day or counts.today()),
    }


def search_findings(s: Session, q: str, limit: int = 8) -> list[Finding]:
    """For BK's `GET /projects/{id}/search` (spec section 10.3): the number, then note and type name,
    newest first, `LIMIT limit`."""
    text = (q or "").strip()
    if not text:
        return []
    stmt = _where(select(Finding), FindingFilters(q=text)).order_by(Finding.number.desc()).limit(limit)
    return list(s.execute(stmt).scalars())
