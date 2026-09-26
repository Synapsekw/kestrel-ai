"""In-project search for the command palette (spec 2026-09-26-foundation sections 5.4 and 10.3)."""

import re

from data_rows import add_cloud, add_image_set, add_map, at
from sqlalchemy import event

from app.data_items import search

BASE = "/api/v1/projects"


def _search(client, pid, **params) -> dict:
    r = client.get(f"{BASE}/{pid}/search", params=params)
    assert r.status_code == 200, r.text
    return r.json()


def test_data_labels_match_case_insensitively_across_types(client, handle, project_id):
    s1 = add_image_set(handle, site="x", label="North pit flight", created_at=at(1))
    m1 = add_map(handle, name="north pit ortho", created_at=at(2))
    add_cloud(handle, name="South cloud", created_at=at(3))
    got = _search(client, project_id, q="NORTH PIT")
    assert {d["id"] for d in got["data"]} == {s1, m1}
    assert got["findings"] == []


def test_the_site_is_the_label_of_an_unlabelled_image_set(client, handle, project_id):
    sid = add_image_set(handle, site="zagreb-east", label=None)
    assert [d["id"] for d in _search(client, project_id, q="zagreb")["data"]] == [sid]


def test_like_wildcards_in_the_query_match_literally(client, handle, project_id):
    exact = add_map(handle, name="ZG_04 50% done", created_at=at(1))
    add_map(handle, name="ZGx04 500 done", created_at=at(2))
    add_map(handle, name="back\\slash", created_at=at(3))
    assert [d["id"] for d in _search(client, project_id, q="ZG_04")["data"]] == [exact]
    assert [d["id"] for d in _search(client, project_id, q="50%")["data"]] == [exact]
    assert [d["label"] for d in _search(client, project_id, q="k\\s")["data"]] == ["back\\slash"]


def test_a_query_under_two_characters_returns_nothing(client, handle, project_id):
    add_map(handle, name="a")
    assert _search(client, project_id, q="a") == {"findings": [], "data": []}
    assert _search(client, project_id, q="  a  ") == {"findings": [], "data": []}
    assert _search(client, project_id) == {"findings": [], "data": []}


def test_each_group_is_limited(client, handle, project_id):
    for n in range(10):
        add_map(handle, name=f"Flight {n}", created_at=at(n))
        add_image_set(handle, site=f"s{n}", label=f"Flight set {n}", created_at=at(n))
    assert len(_search(client, project_id, q="flight")["data"]) == 8
    assert len(_search(client, project_id, q="flight", limit=3)["data"]) == 3
    assert len(_search(client, project_id, q="flight", limit=500)["data"]) == search.MAX_LIMIT


def test_search_never_reads_images(client, handle, project_id):
    add_image_set(handle, site="north")
    statements: list[str] = []

    def record(conn, cursor, statement, *args):
        statements.append(statement)

    event.listen(handle.engine, "before_cursor_execute", record)
    try:
        _search(client, project_id, q="north")
    finally:
        event.remove(handle.engine, "before_cursor_execute", record)
    assert statements and not any(re.search(r"\b(FROM|JOIN)\s+image\b", st) for st in statements)


def test_findings_come_from_the_registered_search(client, handle, project_id, monkeypatch):
    monkeypatch.setattr(search, "_finding_search", None)
    seen = []

    def fake(session, q, limit):
        seen.append((q, limit))
        return [{"id": f"f{n}"} for n in range(limit + 5)]

    search.register_finding_search(fake)
    got = _search(client, project_id, q="  crack ", limit=4)
    assert seen == [("crack", 4)]
    assert [f["id"] for f in got["findings"]] == ["f0", "f1", "f2", "f3"]
