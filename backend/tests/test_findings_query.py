"""Reading findings (spec 2026-09-26-foundation sections 8.3, 8.4, 16): filters, sorts, a keyset
cursor that holds while findings arrive, bulk with skips, the pre-aggregated summary, and the
seeded random property test that the counts always equal a recount."""

import random
from datetime import UTC, date, datetime, timedelta

import pytest
from findings_helpers import add_type, insert_cloud, insert_map, use_types
from sqlalchemy import select

from app.db.models import Finding, FindingCount, FindingDaily
from app.errors import AppError
from app.findings import counts, query, service
from app.findings.anchors import AnchorIn


@pytest.fixture
def cloud(handle) -> str:
    return insert_cloud(handle)


def _make(handle, type_id: str, cloud_id: str, **kw) -> Finding:
    return service.create_finding(
        handle, type_id=type_id, anchor=AnchorIn(kind="cloud", cloud_id=cloud_id, x=0.0, y=0.0, z=0.0), **kw
    )


def _list(handle, sort: str = "-severity", limit: int | None = None, cursor: str | None = None, **filters):
    with handle.session() as s:
        rows, nxt = query.list_findings(
            s, query.FindingFilters(**filters), sort=sort, cursor=cursor, limit=limit
        )
        return [r.number for r in rows], nxt


def _counts(s) -> dict:
    return {(r.status, r.severity, r.type_id): r.n for r in s.execute(select(FindingCount)).scalars() if r.n}


def test_the_default_sort_is_severity_high_first_then_newest(handle, crack, cloud):
    for sev in [None, 1, 4, 4, 2]:
        _make(handle, crack["id"], cloud, severity=sev)
    assert _list(handle)[0] == [4, 3, 5, 2, 1]


def test_the_other_sorts(client, handle, crack, cloud):
    rust = add_type(client, "rust")
    a = _make(handle, crack["id"], cloud)
    _make(handle, rust["id"], cloud)
    _make(handle, crack["id"], cloud)
    assert _list(handle, sort="number")[0] == [1, 2, 3]
    with handle.session() as s:
        s.get(Finding, a.id).updated_at = datetime.now(UTC) + timedelta(minutes=1)
    assert _list(handle, sort="-updated_at")[0][0] == 1
    assert _list(handle, sort="type")[0] == [1, 3, 2]  # crack before rust


def test_filters(client, handle, crack, cloud):
    rust = add_type(client, "rust")
    _make(handle, crack["id"], cloud, severity=None, note="hairline near joint")
    f2 = _make(handle, rust["id"], cloud, severity=3)
    _make(handle, crack["id"], cloud, severity=1, created_by="model:m1", confidence=0.8)
    service.patch_finding(handle, f2.id, {"status": "closed"})
    mid = insert_map(handle)
    point = {"type": "Point", "coordinates": [1.0, 2.0]}
    service.create_finding(
        handle,
        type_id=crack["id"],
        anchor=AnchorIn(kind="map", map_id=mid, geometry=point),
        lon=15.0,
        lat=45.0,
    )
    assert _list(handle, status=["closed"])[0] == [2]
    assert _list(handle, severity=["none"])[0] == [1]
    assert sorted(_list(handle, severity=["1", "none"])[0]) == [1, 3]
    assert _list(handle, type_id=[rust["id"]])[0] == [2]
    assert _list(handle, anchor_kind=["map"])[0] == [4]
    assert _list(handle, data_id=mid)[0] == [4]
    assert _list(handle, created_by="model")[0] == [3]
    assert sorted(_list(handle, created_by="human")[0]) == [1, 2, 4]
    assert _list(handle, has_location=True)[0] == [4]
    assert _list(handle, q="hairline")[0] == [1]
    assert _list(handle, q="RUST")[0] == [2]
    assert _list(handle, q="F-0003")[0] == [3]
    assert _list(handle, updated_from=datetime.now(UTC) + timedelta(days=1))[0] == []


def test_like_wildcards_match_literally(handle, crack, cloud):
    for note in ["100% corroded", "1000 mm", "ZG_04 joint", "ZGX04 joint"]:
        _make(handle, crack["id"], cloud, note=note)
    assert _list(handle, q="100%")[0] == [1]
    assert _list(handle, q="ZG_04")[0] == [3]


def test_paging_is_stable_while_findings_arrive(handle, crack, cloud):
    for sev in [1, 2, 3, 4, 1, 2]:
        _make(handle, crack["id"], cloud, severity=sev)
    first, cursor = _list(handle, limit=2)
    assert first == [4, 3]
    _make(handle, crack["id"], cloud, severity=4)  # F-0007 sorts before the cursor
    _make(handle, crack["id"], cloud, severity=1)  # F-0008 sorts after it
    rest: list[int] = []
    while cursor:
        page, cursor = _list(handle, limit=2, cursor=cursor)
        rest += page
    assert rest == [6, 2, 8, 5, 1]


@pytest.mark.parametrize("sort", query.SORTS)
def test_every_sort_pages_through_every_finding_once(client, handle, crack, cloud, sort):
    rust = add_type(client, "rust")
    for i in range(7):
        _make(handle, (crack if i % 2 else rust)["id"], cloud, severity=[None, 1, 2][i % 3])
    whole, _ = _list(handle, sort=sort)
    paged, cursor = _list(handle, sort=sort, limit=2)
    while cursor:
        page, cursor = _list(handle, sort=sort, limit=2, cursor=cursor)
        paged += page
    assert paged == whole
    assert sorted(paged) == list(range(1, 8))


def test_a_cursor_from_another_sort_is_refused(handle, crack, cloud):
    for _ in range(3):
        _make(handle, crack["id"], cloud)
    _, cursor = _list(handle, limit=1)
    with pytest.raises(AppError) as e:
        _list(handle, sort="number", cursor=cursor)
    assert e.value.status == 422


def test_bulk_updates_and_reports_skips(client, handle, project, crack, cloud):
    a = _make(handle, crack["id"], cloud)
    b = _make(handle, crack["id"], cloud)
    c = _make(handle, crack["id"], cloud)
    service.patch_finding(handle, c.id, {"status": "closed"})
    with handle.session() as s:
        result = query.bulk(
            s,
            project_id=handle.id,
            catalogue=handle.catalogue,
            ids=[a.id, b.id, c.id, "nope"],
            set_fields={"status": "reviewed", "severity": 3},
        )
    assert result == {
        "updated": 2,
        "skipped": [{"id": c.id, "code": "invalid_transition"}, {"id": "nope", "code": "not_found"}],
    }
    with handle.session() as s:
        assert _counts(s) == {("reviewed", 3, crack["id"]): 2, ("closed", 2, crack["id"]): 1}
    pole = add_type(client, "pole", kind="object")
    use_types(client, project, pole)
    with handle.session() as s:
        result = query.bulk(
            s,
            project_id=handle.id,
            catalogue=handle.catalogue,
            ids=[a.id],
            set_fields={"type_id": pole["id"]},
        )
    assert result == {"updated": 0, "skipped": [{"id": a.id, "code": "not_a_defect"}]}


def test_summary_reads_the_counts(handle, crack, cloud, monkeypatch):
    monkeypatch.setattr(counts, "today", lambda: date(2026, 9, 26))
    _make(handle, crack["id"], cloud, severity=None)
    _make(handle, crack["id"], cloud, severity=4)
    r = _make(handle, crack["id"], cloud, severity=4)
    c = _make(handle, crack["id"], cloud, severity=2)
    service.patch_finding(handle, r.id, {"status": "reviewed"})
    service.patch_finding(handle, c.id, {"status": "closed"})
    with handle.session() as s:
        out = query.summary(s, levels=[1, 2, 3, 4])
    assert out["by_status"] == {"open": 2, "reviewed": 1, "closed": 1}
    assert out["open_by_severity"] == {"1": 0, "2": 0, "3": 0, "4": 2}
    assert out["open_no_severity"] == 1
    assert out["by_type"] == [{"type_id": crack["id"], "n": 3}]
    trend = out["trend"]
    assert len(trend) == 60 and trend[-1]["day"] == date(2026, 9, 26)
    assert (trend[-1]["open"], trend[-1]["closed"]) == (3, 1)
    assert trend[0]["open"] == 0


def test_the_trend_carries_the_last_known_day_forward(handle):
    with handle.session() as s:
        s.add(
            FindingDaily(
                day=date(2026, 9, 1), open=5, open_by_severity={"2": 5}, closed=0, closed_by_severity={}
            )
        )
        s.add(
            FindingDaily(
                day=date(2026, 9, 20),
                open=3,
                open_by_severity={"2": 3},
                closed=2,
                closed_by_severity={"2": 2},
            )
        )
    with handle.session() as s:
        by_day = {t["day"]: t for t in query.trend(s, date(2026, 9, 26))}
    assert by_day[date(2026, 8, 20)]["open"] == 0
    assert by_day[date(2026, 9, 10)]["open"] == 5
    assert (by_day[date(2026, 9, 20)]["open"], by_day[date(2026, 9, 20)]["closed"]) == (3, 2)
    assert (by_day[date(2026, 9, 26)]["open"], by_day[date(2026, 9, 26)]["closed"]) == (3, 0)
    assert by_day[date(2026, 9, 26)]["open_by_severity"] == {"2": 3}


def test_search_findings(handle, crack, cloud):
    _make(handle, crack["id"], cloud, note="spalling at pier 3")
    _make(handle, crack["id"], cloud)
    with handle.session() as s:
        assert [f.number for f in query.search_findings(s, "pier")] == [1]
        assert [f.number for f in query.search_findings(s, "crack")] == [2, 1]
        assert [f.number for f in query.search_findings(s, "F-0002")] == [2]
        assert query.search_findings(s, "   ") == []


@pytest.mark.parametrize("seed", range(10))
def test_counts_equal_a_recount_after_random_writes(client, handle, crack, cloud, seed):
    rust = add_type(client, "rust")
    rng = random.Random(seed)
    types = [crack["id"], rust["id"]]
    live: list[str] = []
    for _ in range(40):
        op = rng.choice(["create", "create", "patch", "bulk", "delete"])
        try:
            if op == "create" or not live:
                f = _make(
                    handle,
                    rng.choice(types),
                    cloud,
                    severity=rng.choice([None, 1, 2, 3, 4]),
                    status=rng.choice(service.STATUSES),
                )
                live.append(f.id)
            elif op == "patch":
                fields = rng.choice(
                    [
                        {"status": rng.choice(service.STATUSES)},
                        {"severity": rng.choice([None, 1, 4])},
                        {"type_id": rng.choice(types)},
                    ]
                )
                service.patch_finding(handle, rng.choice(live), fields)
            elif op == "bulk":
                with handle.session() as s:
                    query.bulk(
                        s,
                        project_id=handle.id,
                        catalogue=handle.catalogue,
                        ids=rng.sample(live, k=min(len(live), 3)),
                        set_fields={
                            "status": rng.choice(service.STATUSES),
                            "severity": rng.choice([None, 2]),
                        },
                    )
            else:
                service.delete_finding(handle, live.pop(rng.randrange(len(live))))
        except AppError as e:
            assert e.code == "invalid_transition", e.code
    with handle.session() as s:
        incremental = _counts(s)
        open_today = s.get(FindingDaily, counts.today()).open
        counts.recount(s)
        s.flush()
        assert incremental == _counts(s)
        assert open_today == s.get(FindingDaily, counts.today()).open
        s.rollback()


@pytest.mark.parametrize(
    "sort, cursor",
    [
        ("-severity", {"sort": "-severity", "n": 3}),
        ("-updated_at", {"sort": "-updated_at", "n": 3}),
        ("-updated_at", {"sort": "-updated_at", "n": 3, "u": "not a date"}),
        ("-updated_at", {"sort": "-updated_at", "n": 3, "u": 7}),
        ("type", {"sort": "type", "n": 3}),
    ],
)
def test_a_tampered_cursor_is_422_not_500(client, project, crack, cloud, handle, sort, cursor):
    from app.pagination import encode_cursor

    _make(handle, crack["id"], cloud)
    r = client.get(
        f"/api/v1/projects/{project['id']}/findings", params={"sort": sort, "cursor": encode_cursor(**cursor)}
    )
    assert (r.status_code, r.json()["error"]["code"]) == (422, "validation_error")
