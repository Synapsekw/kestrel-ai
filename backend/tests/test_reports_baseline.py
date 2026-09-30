"""Baseline selection order (spec §4) and the six delta kinds (spec §8.3; plan R2 Rulings 7-9)."""

from datetime import UTC, datetime

import pytest
from reports_rows import add_cloud, add_findings, add_report, add_type, add_version, config, ctx_for
from sqlalchemy import update

from app.db.models import Finding
from app.reports.baseline import delta_sentence, deltas, resolve_baseline


def at(day: int) -> datetime:
    return datetime(2026, 9, day, 10, tzinfo=UTC)


def test_no_versions_no_baseline(handle):
    assert resolve_baseline(handle, add_report(handle, config())) is None


def test_selection_order(handle):
    mine, other = add_report(handle, config()), add_report(handle, config(), title="Other")
    add_version(handle, mine, number=1)  # never issued
    add_version(handle, mine, number=2, issued_at=at(20), state="failed")  # not ready
    o = add_version(handle, other, number=1, issued_at=at(22))
    fallback = resolve_baseline(handle, mine)
    assert fallback.version_id == o  # any report's, as a fallback
    assert fallback.report_title == "Other"
    old = add_version(handle, mine, number=3, issued_at=at(10))
    assert resolve_baseline(handle, mine).version_id == old  # this report's wins, even older
    new = add_version(handle, mine, number=4, issued_at=at(15))
    b = resolve_baseline(handle, mine)
    assert (b.version_id, b.number, b.report_id, b.issued_at) == (new, 4, mine, at(15))
    assert b.report_title == "Site report"


@pytest.fixture
def scene(handle):
    t, c = add_type(handle, "crack"), add_cloud(handle)
    ids = add_findings(
        handle,
        [
            {"type_id": t, "severity": 2, "anchor": "cloud", "target": c},  # f1 unchanged
            {
                "type_id": t,
                "severity": 2,
                "anchor": "cloud",
                "target": c,
                "status": "closed",
            },  # f2 closed now
            {"type_id": t, "severity": 4, "anchor": "cloud", "target": c},  # f3 3 -> 4
            {"type_id": t, "severity": 1, "anchor": "cloud", "target": c},  # f4 3 -> 1
            {"type_id": t, "severity": 1, "anchor": "cloud", "target": c},  # f5 closed -> open
            {"type_id": t, "severity": 1, "anchor": "cloud", "target": c},  # f6 new
        ],
    )
    f1, f2, f3, f4, f5, _ = ids
    rid = add_report(handle, config())
    add_version(
        handle,
        rid,
        number=1,
        issued_at=at(20),
        rows=[
            (f1, t, 2, "open"),
            (f2, t, 2, "open"),
            (f3, t, 3, "open"),
            (f4, t, 3, "reviewed"),
            (f5, t, 1, "closed"),
            ("gone-finding", t, 2, "open"),
        ],
    )
    return {"rid": rid, "ids": ids, "type": t}


def _d(handle, rid, cfg=None):
    b = resolve_baseline(handle, rid)
    ctx = ctx_for(handle, cfg or config(), baseline=b, report_id=rid)
    with handle.session() as s:
        return deltas(s, ctx.where, b), b


def test_each_delta_kind(handle, scene):
    d, b = _d(handle, scene["rid"])
    assert (d.new, d.closed, d.escalated, d.deescalated, d.reopened, d.left) == (1, 1, 1, 1, 1, 1)
    assert d.baseline.number == 1
    assert d.baseline.report_title == "Site report"
    assert (
        delta_sentence(d, b)
        == "1 new · 1 closed · 1 escalated · 1 de-escalated · 1 reopened · 1 left the report since v1"
    )


def test_a_filter_change_shows_as_left(handle, scene):
    d, _ = _d(handle, scene["rid"], config(filters={"statuses": ["open", "reviewed"]}))
    assert d.left == 2 and d.closed == 0  # f2 is closed now, so it left the filtered set


def test_first_grading_counts_as_escalated(handle, scene):
    with handle.session() as s:
        s.execute(update(Finding).where(Finding.id == scene["ids"][0]).values(severity=None))
    d, _ = _d(handle, scene["rid"])
    assert d.deescalated == 2  # f1 2 -> ungraded (level 0) plus f4


def test_no_baseline_is_all_zero(handle, scene):
    ctx = ctx_for(handle, config())
    with handle.session() as s:
        d = deltas(s, ctx.where, None)
    assert (d.new, d.closed, d.escalated, d.deescalated, d.reopened, d.left) == (0, 0, 0, 0, 0, 0)
    assert d.baseline is None


def test_sentence_wording(handle, scene):
    from app.reports.schemas import DeltaSummary

    b = resolve_baseline(handle, scene["rid"])
    two = DeltaSummary.model_validate(
        {
            "baseline": {
                "version_id": b.version_id,
                "report_id": b.report_id,
                "report_title": b.report_title,
                "number": 1,
                "issued_at": at(20),
            },
            "new": 0,
            "closed": 1,
            "escalated": 1,
            "deescalated": 0,
            "reopened": 0,
            "left": 0,
        }
    )
    assert delta_sentence(two, b) == "1 closed · 1 escalated since v1"
    none = two.model_copy(update={"closed": 0, "escalated": 0})
    assert delta_sentence(none, b) == "No changes since v1"
