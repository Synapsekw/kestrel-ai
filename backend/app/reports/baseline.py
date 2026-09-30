"""The change baseline (spec §4) and the deltas against it (spec §8.3; plan R2 Rulings 7-9).

Controller ruling P4 (merged R0 schema): `DeltaSummary` carries a `baseline: ReportBaseline | None`
field (version_id, report_id, report_title, number, issued_at) instead of the brief's
baseline_number/baseline_issued_at pair. `baseline_in` fills the `Baseline` dataclass's
`report_title` from the `Report` row via a join; the query stays LIMIT 1. A `ReportVersion.number`
is nullable (set on promote, index reconciliation item 5): a ready, issued version always has a
number in practice, but `baseline_in` filters `number IS NOT NULL` defensively so a mid-promote row
is never picked.
"""

from __future__ import annotations

from sqlalchemy import and_, case, func, select
from sqlalchemy.orm import Session

from app.db.models import Finding
from app.reports.context import Baseline
from app.reports.models import Report, ReportVersion, ReportVersionFinding
from app.reports.schemas import DeltaSummary

_ORDER = (ReportVersion.issued_at.desc(), ReportVersion.created_at.desc(), ReportVersion.number.desc())


def baseline_in(s: Session, report_id: str) -> Baseline | None:
    issued = (
        select(ReportVersion, Report.title)
        .join(Report, Report.id == ReportVersion.report_id)
        .where(
            ReportVersion.issued_at.is_not(None),
            ReportVersion.state == "ready",
            ReportVersion.number.is_not(None),
        )
    )
    row = s.execute(issued.where(ReportVersion.report_id == report_id).order_by(*_ORDER).limit(1)).first()
    if row is None:
        row = s.execute(issued.order_by(*_ORDER).limit(1)).first()
    if row is None:
        return None
    v, title = row
    return Baseline(
        version_id=v.id, report_id=v.report_id, number=v.number, issued_at=v.issued_at, report_title=title
    )


def resolve_baseline(handle, report_id: str) -> Baseline | None:
    with handle.session() as s:
        return baseline_in(s, report_id)


def _n(cond):
    return func.coalesce(func.sum(case((cond, 1), else_=0)), 0)


def deltas(s: Session, where, baseline: Baseline | None) -> DeltaSummary:
    if baseline is None:
        return DeltaSummary.model_validate(
            {
                "baseline": None,
                "new": 0,
                "closed": 0,
                "escalated": 0,
                "deescalated": 0,
                "reopened": 0,
                "left": 0,
            }
        )
    cur = (
        select(Finding.id.label("id"), Finding.severity.label("sev"), Finding.status.label("st"))
        .where(where)
        .subquery("cur")
    )
    base = (
        select(
            ReportVersionFinding.finding_id.label("id"),
            ReportVersionFinding.severity.label("sev"),
            ReportVersionFinding.status.label("st"),
        )
        .where(ReportVersionFinding.version_id == baseline.version_id)
        .subquery("base")
    )
    new = s.execute(
        select(func.count())
        .select_from(cur.outerjoin(base, base.c.id == cur.c.id))
        .where(base.c.id.is_(None))
    ).scalar_one()
    left = s.execute(
        select(func.count()).select_from(base.outerjoin(cur, cur.c.id == base.c.id)).where(cur.c.id.is_(None))
    ).scalar_one()
    cs, bs = func.coalesce(cur.c.sev, 0), func.coalesce(base.c.sev, 0)
    closed, reopened, up, down = s.execute(
        select(
            _n(and_(cur.c.st == "closed", base.c.st != "closed")),
            _n(and_(base.c.st == "closed", cur.c.st != "closed")),
            _n(cs > bs),
            _n(cs < bs),
        ).select_from(cur.join(base, base.c.id == cur.c.id))
    ).one()
    return DeltaSummary.model_validate(
        {
            "baseline": {
                "version_id": baseline.version_id,
                "report_id": baseline.report_id,
                "report_title": baseline.report_title,
                "number": baseline.number,
                "issued_at": baseline.issued_at,
            },
            "new": new,
            "closed": closed,
            "escalated": up,
            "deescalated": down,
            "reopened": reopened,
            "left": left,
        }
    )


_WORDS = (
    ("new", "new"),
    ("closed", "closed"),
    ("escalated", "escalated"),
    ("deescalated", "de-escalated"),
    ("reopened", "reopened"),
    ("left", "left the report"),
)


def delta_sentence(d: DeltaSummary, baseline: Baseline) -> str:
    parts = [f"{getattr(d, field)} {word}" for field, word in _WORDS if getattr(d, field)]
    if not parts:
        return f"No changes since v{baseline.number}"
    return " · ".join(parts) + f" since v{baseline.number}"
