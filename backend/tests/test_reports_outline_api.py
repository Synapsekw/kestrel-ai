"""GET …/outline and GET …/sections/{key}/blocks (spec §14; plan R2 Rulings 10-11)."""

from datetime import UTC, datetime

import pytest
from reports_rows import add_cloud, add_findings, add_report, add_type, add_version, config
from sqlalchemy import update

from app.db.models import Finding
from app.reports.models import Report

API = "/api/v1"
ALL = ("cover", "summary", "findings_table", "finding_pages", "measurements", "appendix")


def _url(pid, rid, tail):
    return f"{API}/projects/{pid}/reports/{rid}/{tail}"


@pytest.fixture
def seeded(handle):
    t, c = add_type(handle, "crack"), add_cloud(handle)
    ids = add_findings(
        handle, [{"type_id": t, "severity": s, "anchor": "cloud", "target": c} for s in (None, 2, 3)]
    )
    cfg = config(sections=ALL, options={"cover": {"show_locator": False}, "summary": {"show_deltas": True}})
    return {"rid": add_report(handle, cfg), "ids": ids, "cloud": c, "type": t}


def _etags(client, pid, rid):
    body = client.get(_url(pid, rid, "outline")).json()
    return {s["key"]: s["etag"] for s in body["sections"]}


def test_outline_counts_etags_and_warnings(client, project_id, seeded):
    r = client.get(_url(project_id, seeded["rid"], "outline"))
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["report_id"] == seeded["rid"]
    assert [s["key"] for s in body["sections"]] == list(ALL)
    by = {s["key"]: s for s in body["sections"]}
    assert by["finding_pages"]["block_count"] == 3 and by["finding_pages"]["estimated_pages"] == 3
    assert by["measurements"]["block_count"] == 1 and by["findings_table"]["block_count"] == 1
    assert body["finding_count"] == 3 and body["deltas"]["baseline"] is None
    assert any(w["code"] == "ungraded" and w["count"] == 1 for w in body["warnings"])
    assert _etags(client, project_id, seeded["rid"]) == {k: v["etag"] for k, v in by.items()}  # stable


def test_outline_deltas_carry_an_issued_baseline(client, project_id, handle, seeded):
    add_version(
        handle,
        seeded["rid"],
        number=1,
        issued_at=datetime(2026, 9, 20, 9, 0, tzinfo=UTC),
        rows=[(seeded["ids"][0], seeded["type"], None, "open")],
    )
    r = client.get(_url(project_id, seeded["rid"], "outline"))
    assert r.status_code == 200, r.text
    deltas = r.json()["deltas"]
    assert deltas["baseline"]["number"] == 1
    assert deltas["new"] > 0 or deltas["closed"] > 0 or deltas["escalated"] > 0 or deltas["deescalated"] > 0


def test_a_finding_edit_moves_only_finding_sections(client, project_id, handle, seeded):
    before = _etags(client, project_id, seeded["rid"])
    with handle.session() as s:
        s.execute(
            update(Finding)
            .where(Finding.id == seeded["ids"][1])
            .values(severity=4, updated_at=datetime(2026, 9, 29, tzinfo=UTC))
        )
    after = _etags(client, project_id, seeded["rid"])
    changed = {k for k in before if before[k] != after[k]}
    assert {"summary", "findings_table", "finding_pages"} <= changed
    assert "measurements" not in changed


def test_a_cover_edit_moves_only_the_cover(client, project_id, handle, seeded):
    before = _etags(client, project_id, seeded["rid"])
    with handle.session() as s:
        row = s.get(Report, seeded["rid"])
        cfg = dict(row.config)
        cfg["cover"] = {**cfg["cover"], "title": "Renamed"}
        row.config = cfg
    after = _etags(client, project_id, seeded["rid"])
    assert {k for k in before if before[k] != after[k]} == {"cover"}


def test_blocks_page_finding_pages_with_a_keyset_cursor(client, project_id, handle, seeded):
    add_findings(
        handle,
        [{"type_id": seeded["type"], "anchor": "cloud", "target": seeded["cloud"]} for _ in range(198)],
    )
    seen, cursor, pages = [], None, 0
    while True:
        params = {"limit": 50} | ({"cursor": cursor} if cursor else {})
        r = client.get(_url(project_id, seeded["rid"], "sections/finding_pages/blocks"), params=params)
        assert r.status_code == 200, r.text
        body = r.json()
        seen += [b["number"] for b in body["items"]]
        pages += 1
        cursor = body["next_cursor"]
        if not cursor:
            break
    assert pages == 5 and seen == list(range(1, 202))
    etag = _etags(client, project_id, seeded["rid"])["finding_pages"]
    assert r.headers["etag"] == f'"{etag}"'


def test_small_sections_page_by_offset(client, project_id, seeded):
    r = client.get(_url(project_id, seeded["rid"], "sections/summary/blocks"), params={"limit": 1}).json()
    assert len(r["items"]) == 1 and r["items"][0]["kind"] == "kpis" and r["next_cursor"]


@pytest.mark.parametrize(
    ("tail", "params", "status"),
    [
        ("sections/finding_pages/blocks", {"limit": 51}, 422),
        ("sections/finding_pages/blocks", {"limit": 0}, 422),
        ("sections/finding_pages/blocks", {"cursor": "zzz"}, 422),
        ("sections/nonsense/blocks", {}, 422),
        ("sections/comparison/blocks", {}, 404),  # not in this report's config
    ],
)
def test_block_errors(client, project_id, seeded, tail, params, status):
    assert client.get(_url(project_id, seeded["rid"], tail), params=params).status_code == status


def test_a_garbage_offset_cursor_is_422_not_500(client, project_id, seeded):
    # summary uses the default offset pager; an {"i": ...} cursor with a non-int "i" must not crash.
    import base64
    import json

    bad = base64.urlsafe_b64encode(json.dumps({"i": "not-an-int"}).encode()).decode()
    r = client.get(_url(project_id, seeded["rid"], "sections/summary/blocks"), params={"cursor": bad})
    assert r.status_code == 422, r.text


def test_unknown_report_is_404(client, project_id):
    assert client.get(_url(project_id, "nope", "outline")).status_code == 404
    assert client.get(_url(project_id, "nope", "sections/summary/blocks")).status_code == 404
