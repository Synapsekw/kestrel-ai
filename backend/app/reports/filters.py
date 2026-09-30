"""Report filters → one SQL WHERE over `finding` (spec §7.1, §8.2 step 1; plan R2 Rulings 5-6).
Compose never refuses a stored config: R1 validates on write; here an empty range simply matches
nothing and a severity_min that left the scale still compares numerically."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import date, timedelta

from sqlalchemy import and_, or_, true

from app.db.models import Finding
from app.reports.observed import observed_on


@dataclass(frozen=True)
class DateWindow:
    start: date | None  # inclusive
    end: date | None  # inclusive


def date_window(rule, *, today: date, since: date | None) -> DateWindow:
    kind = rule.rule
    if kind == "range":
        return DateWindow(rule.from_, rule.to)
    if kind == "last_days":
        days = rule.days if rule.days is not None else 1
        return (
            DateWindow(today - timedelta(days=days - 1), None)
            if days >= 1
            else DateWindow(today, today - timedelta(days=1))
        )
    if kind == "since_last_issued":
        return DateWindow(since, None)
    return DateWindow(None, None)


def include_ungraded(f) -> bool:
    return f.severity_min is None if f.include_ungraded is None else bool(f.include_ungraded)


def finding_where(f, *, today: date, since: date | None):
    conds = []
    if f.statuses is not None:
        conds.append(Finding.status.in_([str(s) for s in f.statuses]))
    ungraded = include_ungraded(f)
    if f.severity_min is not None:
        at_least = Finding.severity >= f.severity_min
        conds.append(or_(at_least, Finding.severity.is_(None)) if ungraded else at_least)
    elif not ungraded:
        conds.append(Finding.severity.is_not(None))
    if f.type_ids is not None:
        conds.append(Finding.type_id.in_(list(f.type_ids)))
    if f.data_item_ids is not None:
        conds.append(Finding.data_id.in_(list(f.data_item_ids)))
    w = date_window(f.date, today=today, since=since)
    obs = observed_on()
    if w.start is not None:
        conds.append(obs >= w.start.isoformat())
    if w.end is not None:
        conds.append(obs <= w.end.isoformat())
    return and_(true(), *conds)
