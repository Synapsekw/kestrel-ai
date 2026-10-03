"""The columnar index (image inspection spec I-D1, §7.1, §14, §17 "Index")."""

import pytest
from sqlalchemy import event
from test_image_filters import world  # noqa: F401 - the shared five-image fixture

from app.asset_review.review_status import set_status
from app.imagery import index as image_index

API = "/api/v1"


def _index(client, pid, **params):
    r = client.get(f"{API}/projects/{pid}/images/index", params=params)
    assert r.status_code == 200, r.text
    return r.json()


def test_arrays_are_parallel_with_flags(client, world):  # noqa: F811
    body = _index(client, world["pid"])
    assert body["total"] == 5 and "lon" not in body and "lat" not in body
    n = body["total"]
    assert all(len(body[k]) == n for k in ("ids", "sev", "count", "flags"))
    row = {
        i: (s, c, fl)
        for i, s, c, fl in zip(body["ids"], body["sev"], body["count"], body["flags"], strict=True)
    }
    ids = world["ids"]
    assert row[ids["b"]] == (1, 1, image_index.FLAG_REVIEWED)  # the closed sev-4 finding is not counted
    assert row[ids["c"]] == (0, 0, image_index.FLAG_PENDING)
    assert row[ids["d"]] == (0, 0, image_index.FLAG_REVIEWED | image_index.FLAG_EMPTY)
    assert row[ids["e"]] == (0, 0, 0)


def test_geo_fields_and_the_gps_flag(client, project, handle):
    from image_summary_helpers import new_image

    with_gps = new_image(handle, lat=25.26412, lon=55.29218)
    without = new_image(handle)
    body = _index(client, project["id"], fields="geo", sort="path")
    at = {i: k for k, i in enumerate(body["ids"])}
    assert body["lon"][at[with_gps]] == pytest.approx(55.29218)
    assert body["lat"][at[without]] is None
    assert body["flags"][at[with_gps]] & image_index.FLAG_GPS
    assert not body["flags"][at[without]] & image_index.FLAG_GPS


@pytest.mark.parametrize(
    "params",
    [
        {},
        {"has_findings": "true"},
        {"severity": "1,2"},
        {"severity": "4", "finding_status": "closed"},
        {"has_suggestions": "true"},
        {"reviewed": "false"},
        {"unlabeled": "true"},
        {"sort": "worst_severity", "order": "desc"},
        {"sort": "max_pending_confidence", "order": "desc"},
        {"sort": "capture_time", "order": "asc"},
    ],
)
def test_index_matches_list_order_and_filters(client, world, params):  # noqa: F811
    listed = client.get(f"{API}/projects/{world['pid']}/images", params={"limit": 1000, **params}).json()
    body = _index(client, world["pid"], **params)
    assert body["ids"] == [i["id"] for i in listed["items"]]
    assert body["total"] == listed["total"]
    assert body["count"] == [i["finding_count"] for i in listed["items"]]
    assert body["sev"] == [i["worst_severity"] or 0 for i in listed["items"]]


def test_severity_and_status_must_hold_on_the_same_finding(client, world):  # noqa: F811
    """Review Focus 4: b has an open sev-1 and a closed sev-4 finding."""
    assert _index(client, world["pid"], severity="4")["ids"] == []  # closed is not counted without a status
    assert _index(client, world["pid"], severity="4", finding_status="open")["ids"] == []
    assert _index(client, world["pid"], severity="4", finding_status="closed")["ids"] == [world["ids"]["b"]]


def test_over_the_cap_is_422(client, world, monkeypatch):  # noqa: F811
    monkeypatch.setattr(image_index, "INDEX_CAP", 4)
    r = client.get(f"{API}/projects/{world['pid']}/images/index")
    assert r.status_code == 422
    err = r.json()["error"]
    assert err["code"] == "too_many_images" and err["details"] == {"total": 5, "cap": 4}
    assert _index(client, world["pid"], has_findings="true")["total"] == 2  # a filter gets under it


def test_bad_fields_value_is_422(client, world):  # noqa: F811
    r = client.get(f"{API}/projects/{world['pid']}/images/index", params={"fields": "everything"})
    assert r.status_code == 422


def test_the_index_is_two_statements(client, world, handle):  # noqa: F811
    """Bounded read: one COUNT and one SELECT, whatever the row count."""
    seen: list[str] = []

    def record(conn, cursor, statement, *args):
        if statement.lstrip().upper().startswith("SELECT"):
            seen.append(statement)

    event.listen(handle.engine, "before_cursor_execute", record)
    try:
        _index(client, world["pid"], severity="1,2", type_ids=world["crack"], fields="geo")
    finally:
        event.remove(handle.engine, "before_cursor_execute", record)
    project_selects = [s for s in seen if "image" in s.lower()]
    assert len(project_selects) == 2, project_selects


def test_twenty_thousand_images_answer_in_one_response(client, project, handle):
    """Scale smoke (the 500 ms budget itself is I-E's e2e): 20k rows, one response, every id once."""
    from sqlalchemy import insert

    from app.db.models import Image, Source

    with handle.session() as s:
        src = Source(folder="C:/flights/big", site="A")
        s.add(src)
        s.flush()
        s.execute(
            insert(Image),
            [
                {
                    "id": f"img-{n:05d}",
                    "path": f"images/big/{n:05d}.jpg",
                    "width": 4000,
                    "height": 3000,
                    "source_id": src.id,
                    "group_key": "",
                }
                for n in range(20_000)
            ],
        )
    body = _index(client, project["id"], source_id=src.id, sort="path")
    assert body["total"] == 20_000 and len(set(body["ids"])) == 20_000
    assert body["ids"][15_000] == "img-15000"


def test_review_status_filter(client, world, handle):  # noqa: F811
    """Asset findings spec §5.4: the filter matches the effective status, the one the GET answers.
    a, b and c have a row. d (marked empty) and e have none: no row matches `not_assessed`, and
    marked empty with no row matches `none` (coordinator ruling for D1)."""
    ids = world["ids"]
    with handle.session() as s:
        set_status(s, ids["a"], "uncertain")
        set_status(s, ids["b"], "finding")  # b has accepted boxes, so `none` would be refused
        set_status(s, ids["c"], "not_assessed")
    back = {v: k for k, v in ids.items()}

    def names(value: str) -> list[str]:
        return sorted(back[i] for i in _index(client, world["pid"], review_status=value)["ids"])

    assert names("uncertain") == ["a"]
    assert names("none") == ["d"]  # marked empty, no row
    assert names("none,finding") == ["b", "d"]
    assert names("not_assessed") == ["c", "e"]  # e: no row, not marked
    assert names("finding,none,uncertain,not_assessed") == ["a", "b", "c", "d", "e"]
    for name in "de":
        got = client.get(f"{API}/projects/{world['pid']}/images/{ids[name]}/review").json()["status"]
        assert names(got).count(name) == 1  # the GET and the filter agree
    assert sorted(back[i] for i in _index(client, world["pid"])["ids"]) == ["a", "b", "c", "d", "e"]


def test_review_status_rejects_unknown_values(client, world):  # noqa: F811
    r = client.get(f"{API}/projects/{world['pid']}/images/index", params={"review_status": "maybe"})
    assert r.status_code == 422
