"""The only writer of `finding_count` and `finding_daily` (spec 2026-09-26-foundation section 8.4,
ADR 2026-09-23-counts-live-on-run-rows): one place holds the numbers, and a recount repairs them.

`change(s, old, new)` is called by every finding write inside its transaction. The buckets are
bumped at once with an upsert. The day's row is settled once per transaction by a `before_commit`
listener, so a bulk write of 1000 findings aggregates once, and a caller outside this package (M's
map review through `service.create_in_session`) cannot forget it.

"Open" on dashboards means not closed: `open` and `reviewed` (a reviewed finding is a confirmed
defect still waiting for its fix).
"""

from __future__ import annotations

import logging
from collections import Counter
from datetime import UTC, date, datetime, time, timedelta

from sqlalchemy import delete, event, func, select
from sqlalchemy.dialects.sqlite import insert as sqlite_insert
from sqlalchemy.orm import Session

from app.db.models import Finding, FindingCount, FindingDaily

NO_SEVERITY = -1
OPEN_STATES = ("open", "reviewed")
Key = tuple[str, int | None, str]  # (status, severity, type_id)
_PENDING = "finding_daily_pending"
log = logging.getLogger(__name__)


def today() -> date:
    """The operator's local day (the backend runs on the operator's machine). Tests patch this."""
    return datetime.now().date()


def key_of(f: Finding) -> Key:
    return (f.status, f.severity, f.type_id)


def _sev(value: int | None) -> int:
    return NO_SEVERITY if value is None else int(value)


def _label(sev: int) -> str:
    return "none" if sev == NO_SEVERITY else str(sev)


def _bump(s: Session, key: Key, delta: int) -> None:
    status, severity, type_id = key
    stmt = sqlite_insert(FindingCount).values(
        status=status, severity=_sev(severity), type_id=type_id, n=max(delta, 0)
    )
    stmt = stmt.on_conflict_do_update(
        index_elements=["status", "severity", "type_id"],
        set_={"n": func.max(FindingCount.n + delta, 0)},
    )
    s.execute(stmt)


def change(s: Session, old: Key | None, new: Key | None) -> None:
    """One finding moved from `old` to `new` (None = it did not exist / no longer exists)."""
    if old == new:
        return
    if old is not None:
        _bump(s, old, -1)
    if new is not None:
        _bump(s, new, +1)
    pending: Counter = s.info.setdefault(_PENDING, Counter())
    if new is not None and new[0] == "closed" and (old is None or old[0] != "closed"):
        pending[_label(_sev(new[1]))] += 1


def open_now(s: Session) -> tuple[int, dict[str, int]]:
    """Not-closed findings now: the total and {level: n} for graded ones (the small counts table)."""
    rows = s.execute(
        select(FindingCount.severity, func.sum(FindingCount.n))
        .where(FindingCount.status.in_(OPEN_STATES))
        .group_by(FindingCount.severity)
    ).all()
    total = sum(int(n or 0) for _, n in rows)
    by = {str(sev): int(n) for sev, n in rows if sev != NO_SEVERITY and n}
    return total, by


def _day_row(s: Session, day: date) -> FindingDaily:
    row = s.get(FindingDaily, day)
    if row is None:
        row = FindingDaily(day=day, open=0, open_by_severity={}, closed=0, closed_by_severity={})
        s.add(row)
    return row


def settle_day(s: Session, day: date | None = None) -> None:
    """Write the day's row: the open numbers as they stand, plus this transaction's closures."""
    pending: Counter | None = s.info.pop(_PENDING, None)
    if pending is None:
        return
    row = _day_row(s, day or today())
    row.open, row.open_by_severity = open_now(s)
    closed = dict(row.closed_by_severity or {})
    for label, n in pending.items():
        closed[label] = closed.get(label, 0) + n
    row.closed_by_severity = closed  # a new dict: plain JSON does not track in-place changes
    row.closed = (row.closed or 0) + sum(pending.values())


@event.listens_for(Session, "before_commit")
def _settle(s: Session) -> None:
    if _PENDING in s.info:
        settle_day(s)


@event.listens_for(Session, "after_rollback")
def _forget(s: Session) -> None:
    s.info.pop(_PENDING, None)


def recount(s: Session, day: date | None = None) -> dict:
    """Rebuild `finding_count` from `finding`, and today's `finding_daily` row (its open numbers,
    and its closures from `closed_at`). Earlier days are history that cannot be rebuilt; they stay."""
    s.execute(delete(FindingCount))
    rows = s.execute(
        select(
            Finding.status, func.coalesce(Finding.severity, NO_SEVERITY), Finding.type_id, func.count()
        ).group_by(Finding.status, func.coalesce(Finding.severity, NO_SEVERITY), Finding.type_id)
    ).all()
    s.add_all(FindingCount(status=st, severity=sev, type_id=t, n=n) for st, sev, t, n in rows)
    s.flush()
    day = day or today()
    start = datetime.combine(day, time.min).astimezone(UTC)  # local midnight, as UTC
    closed_rows = s.execute(
        select(func.coalesce(Finding.severity, NO_SEVERITY), func.count())
        .where(
            Finding.status == "closed",
            Finding.closed_at >= start,
            Finding.closed_at < start + timedelta(days=1),
        )
        .group_by(func.coalesce(Finding.severity, NO_SEVERITY))
    ).all()
    row = _day_row(s, day)
    row.open, row.open_by_severity = open_now(s)
    row.closed_by_severity = {_label(sev): n for sev, n in closed_rows}
    row.closed = sum(n for _, n in closed_rows)
    s.info.pop(_PENDING, None)
    return {"findings": sum(n for *_, n in rows), "buckets": len(rows)}
