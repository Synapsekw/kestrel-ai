"""The plumbing under every finding write (spec 2026-09-26-foundation sections 8.1, 8.3, 8.4): the
number allocator, the counts module, the activity feed and the findings.changed event."""

from datetime import UTC, date, datetime, time, timedelta

import pytest
from sqlalchemy import select

from app.db.models import Activity, Finding, FindingCount, FindingDaily
from app.errors import AppError
from app.findings import activity, counts, events, numbers

DAY = date(2026, 9, 26)


@pytest.fixture(autouse=True)
def fixed_day(monkeypatch):
    monkeypatch.setattr(counts, "today", lambda: DAY)


class _Bus:
    def __init__(self):
        self.seen: list[dict] = []

    def publish(self, event: dict) -> None:
        self.seen.append(event)


@pytest.fixture
def bus(monkeypatch) -> _Bus:
    b = _Bus()
    monkeypatch.setattr(events, "_bus", b)
    return b


def _finding(number: int, status: str = "open", severity: int | None = None, type_id: str = "t1") -> Finding:
    return Finding(
        number=number,
        type_id=type_id,
        severity=severity,
        status=status,
        note="",
        created_by="human",
        anchor_kind="cloud",
        cloud_id="c1",
        x=0.0,
        y=0.0,
        z=0.0,
        data_type="point_cloud",
        data_id="c1",
    )


def _counts(s) -> dict:
    return {(r.status, r.severity, r.type_id): r.n for r in s.execute(select(FindingCount)).scalars() if r.n}


def _add(s, f: Finding) -> Finding:
    s.add(f)
    s.flush()
    counts.change(s, None, counts.key_of(f))
    return f


def test_format_and_parse_numbers():
    assert numbers.format_number(7) == "F-0007"
    assert numbers.format_number(12345) == "F-12345"
    for text, n in [("F-0217", 217), ("f217", 217), (" 217 ", 217), ("F-12", 12)]:
        assert numbers.parse_number(text) == n
    for text in ["crack", "F-", "", "F-12a"]:
        assert numbers.parse_number(text) is None


def test_allocate_follows_the_high_water_mark(handle):
    with handle.session() as s:
        assert numbers.allocate(s) == 1
        assert numbers.allocate(s, count=3) == 2
    with handle.session() as s:
        assert numbers.allocate(s) == 5
    with handle.session() as s:
        s.add(_finding(40))  # a number written directly (MG's migration) moves the mark
        s.flush()
        assert numbers.allocate(s) == 41


def test_change_moves_one_finding_between_buckets(handle):
    with handle.session() as s:
        f = _add(s, _finding(1, severity=2))
        f.status = "closed"
        counts.change(s, ("open", 2, "t1"), counts.key_of(f))
    with handle.session() as s:
        assert _counts(s) == {("closed", 2, "t1"): 1}
        day = s.get(FindingDaily, DAY)
        assert (day.open, day.open_by_severity, day.closed, day.closed_by_severity) == (0, {}, 1, {"2": 1})


def test_the_day_counts_open_and_reviewed_as_open(handle):
    with handle.session() as s:
        for n, (status, sev) in enumerate(
            [("open", 1), ("reviewed", 1), ("reviewed", None), ("closed", 4)], start=1
        ):
            _add(s, _finding(n, status=status, severity=sev))
    with handle.session() as s:
        day = s.get(FindingDaily, DAY)
        assert (day.open, day.open_by_severity, day.closed, day.closed_by_severity) == (
            3,
            {"1": 2},
            1,
            {"4": 1},
        )


def test_a_rolled_back_write_leaves_no_numbers(handle):
    with pytest.raises(RuntimeError), handle.session() as s:
        _add(s, _finding(1))
        raise RuntimeError("boom")
    with handle.session() as s:
        assert _counts(s) == {}
        assert s.get(FindingDaily, DAY) is None


def test_recount_rebuilds_the_numbers_and_todays_closures(handle):
    noon = datetime.combine(DAY, time(12)).astimezone(UTC)
    with handle.session() as s:
        s.add(_finding(1, severity=3))
        closed = _finding(2, status="closed", severity=4)
        closed.closed_at = noon
        s.add(closed)
        old = _finding(3, status="closed")
        old.closed_at = noon - timedelta(days=3)
        s.add(old)
        s.add(FindingCount(status="open", severity=9, type_id="ghost", n=7))
    with handle.session() as s:
        result = counts.recount(s)
    assert result == {"findings": 3, "buckets": 3}
    with handle.session() as s:
        assert _counts(s) == {("open", 3, "t1"): 1, ("closed", 4, "t1"): 1, ("closed", -1, "t1"): 1}
        day = s.get(FindingDaily, DAY)
        assert (day.open, day.closed, day.closed_by_severity) == (1, 1, {"4": 1})


def test_marked_ids_publish_once_after_commit(handle, bus):
    with handle.session() as s:
        s.execute(select(FindingCount)).all()  # a transaction to commit, as every real write has
        events.mark_changed(s, "p1", ["b", "a"])
        events.mark_changed(s, "p1", ["a"])
        assert bus.seen == []
    assert bus.seen == [
        {
            "type": "findings.changed",
            "project_id": "p1",
            "job_id": None,
            "progress": None,
            "message": "",
            "payload": {"ids": ["a", "b"]},
        }
    ]


def test_more_than_100_ids_publish_all(handle, bus):
    with handle.session() as s:
        s.execute(select(FindingCount)).all()
        events.mark_changed(s, "p1", [f"id{i}" for i in range(101)])
    assert bus.seen[0]["payload"] == {"all": True}


def test_a_rollback_publishes_nothing(handle, bus):
    with pytest.raises(RuntimeError), handle.session() as s:
        events.mark_changed(s, "p1", ["a"])
        raise RuntimeError("boom")
    assert bus.seen == []


def test_activity_pages_newest_first_and_filters_by_subject(handle):
    base = datetime(2026, 9, 26, 8, tzinfo=UTC)
    with handle.session() as s:
        for i in range(5):
            s.add(
                Activity(
                    at=base + timedelta(minutes=i),
                    kind="finding.comment",
                    subject_id="f1" if i % 2 == 0 else "f2",
                    summary=f"c{i}",
                    payload={},
                )
            )
    with handle.session() as s:
        first, cursor = activity.page(s, limit=2)
        second, _ = activity.page(s, limit=2, cursor=cursor)
        only, end = activity.page(s, subject_id="f2")
        assert [a.summary for a in first + second] == ["c4", "c3", "c2", "c1"]
        assert ([a.summary for a in only], end) == (["c3", "c1"], None)


def test_activity_kinds_are_the_spec_list(handle):
    with handle.session() as s:
        activity.record(s, "finding.created", "f1", "F-0001 crack created")
        with pytest.raises(AppError):
            activity.record(s, "finding.exploded", "f1", "no")
