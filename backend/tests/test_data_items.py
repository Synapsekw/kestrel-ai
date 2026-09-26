"""The Data list (spec 2026-09-26-foundation sections 6.3, 14 and 16): the union of image sets,
maps, elevation and point clouds in one keyset-paged order."""

from datetime import date

import pytest
from data_rows import T0, add_cloud, add_image_set, add_map, add_surface, at
from sqlalchemy import event

from app.data_items.providers import PROVIDERS

BASE = "/api/v1/projects"


def _page(client, pid, **params) -> dict:
    r = client.get(f"{BASE}/{pid}/data", params=params)
    assert r.status_code == 200, r.text
    return r.json()


def _all(client, pid, cursor: str | None = None, **params) -> list[dict]:
    """Every item from `cursor` (the start when None) to the end, page by page."""
    items = []
    while True:
        page = _page(client, pid, **params, **({"cursor": cursor} if cursor else {}))
        items += page["items"]
        cursor = page["next_cursor"]
        if cursor is None:
            return items


def test_an_empty_project_has_no_data(client, project_id):
    assert _page(client, project_id) == {"items": [], "next_cursor": None}


def test_an_unknown_project_is_404(client):
    assert client.get(f"{BASE}/nope/data").status_code == 404


def test_items_from_every_type_merge_in_one_order(client, handle, project_id):
    newest_set = add_image_set(handle, site="a", captured_on=date(2026, 9, 20), created_at=at(1))
    cloud = add_cloud(handle, captured_on=date(2026, 9, 20), created_at=at(5))
    ortho = add_map(handle, captured_on=date(2026, 9, 10), created_at=at(9))
    dsm = add_surface(handle, kind="cloud_dsm", cloud_id=cloud, created_at=at(2))  # the cloud's date
    design = add_surface(handle, name="design", kind="design", created_at=at(8))  # never dated
    undated_set = add_image_set(handle, site="b", captured_on=None, created_at=at(3))

    items = _page(client, project_id)["items"]

    assert [(i["type"], i["id"]) for i in items] == [
        ("point_cloud", cloud),  # 2026-09-20, created at(5)
        ("elevation", dsm),  # 2026-09-20 from its cloud, at(2)
        ("image_set", newest_set),  # 2026-09-20, at(1)
        ("map", ortho),  # 2026-09-10
        ("elevation", design),  # undated, at(8)
        ("image_set", undated_set),  # undated, at(3)
    ]
    assert items[1]["captured_on"] == "2026-09-20" and items[4]["captured_on"] is None


def test_paging_walks_every_item_once(client, handle, project_id):
    for n in range(4):
        add_map(handle, name=f"m{n}", captured_on=date(2026, 9, n + 1), created_at=at(n))
        add_image_set(handle, site=f"s{n}", captured_on=None, created_at=at(n))
    whole = [i["id"] for i in _page(client, project_id)["items"]]
    paged = [i["id"] for i in _all(client, project_id, limit=3)]
    assert paged == whole and len(set(paged)) == 8


def test_ties_break_by_id_across_a_page_boundary(client, handle, project_id):
    ids = sorted(add_map(handle, name=f"m{n}", captured_on=date(2026, 9, 1), created_at=T0) for n in range(3))
    ids += sorted(add_image_set(handle, site=f"u{n}", created_at=T0) for n in range(2))  # undated: after
    assert [i["id"] for i in _all(client, project_id, limit=1)] == ids


def test_an_item_added_between_pages_neither_repeats_nor_skips(client, handle, project_id):
    for n in range(4):
        add_map(handle, name=f"m{n}", captured_on=date(2026, 9, n + 1), created_at=at(n))
    before = [i["id"] for i in _page(client, project_id)["items"]]
    first = _page(client, project_id, limit=2)
    newest = add_cloud(handle, captured_on=date(2026, 9, 30), created_at=at(20))
    rest = _all(client, project_id, limit=2, cursor=first["next_cursor"])
    assert [i["id"] for i in first["items"]] + [i["id"] for i in rest] == before
    assert _page(client, project_id, limit=1)["items"][0]["id"] == newest


def test_type_filter_restricts_the_providers(client, handle, project_id):
    ortho = add_map(handle)
    dsm = add_surface(handle)
    add_image_set(handle, site="a")
    add_cloud(handle)
    assert [i["id"] for i in _page(client, project_id, type="map")["items"]] == [ortho]
    got = {i["id"] for i in _page(client, project_id, type=["map", "elevation"])["items"]}
    assert got == {ortho, dsm}
    assert _page(client, project_id, type="drawing") == {"items": [], "next_cursor": None}


def test_map_sources_are_not_listed_their_map_is(client, handle, project_id):
    add_image_set(handle, site="ortho-source", kind="map")
    ortho = add_map(handle)
    assert [(i["type"], i["id"]) for i in _page(client, project_id)["items"]] == [("map", ortho)]


@pytest.mark.parametrize(
    ("job_state", "imported", "status"),
    [
        ("running", False, "importing"),
        ("queued", False, "importing"),
        ("running", True, "importing"),  # a re-import in progress
        ("succeeded", True, "ready"),
        ("failed", False, "failed"),
        ("cancelled", False, "failed"),
        ("failed", True, "ready"),  # a failed re-import keeps the images it had
        (None, True, "ready"),
    ],
)
def test_image_set_status_follows_its_import(client, handle, project_id, job_state, imported, status):
    add_image_set(handle, site="a", job_state=job_state, imported=imported)
    assert _page(client, project_id)["items"][0]["status"] == status


def test_a_building_surface_is_importing(client, handle, project_id):
    add_surface(handle, status="building")
    add_map(handle, status="failed")
    add_cloud(handle, status="importing")
    statuses = {i["type"]: i["status"] for i in _page(client, project_id)["items"]}
    assert statuses == {"elevation": "importing", "map": "failed", "point_cloud": "importing"}


def test_labels_and_summaries(client, handle, project_id):
    add_image_set(handle, site="zagreb-north", label=None, created_at=at(1))
    add_image_set(handle, site="x", label="Flight 14 Sep", created_at=at(2))
    add_map(handle, name="Ortho May", created_at=at(3))
    add_surface(handle, name="Design v2", created_at=at(4))
    add_cloud(handle, name="Cloud May", created_at=at(5))
    items = {i["label"]: i for i in _page(client, project_id)["items"]}
    assert set(items) == {"zagreb-north", "Flight 14 Sep", "Ortho May", "Design v2", "Cloud May"}
    assert items["zagreb-north"]["summary"] == {"image_count": 12, "duplicate_count": 1}
    assert items["Ortho May"]["summary"] == {"gsd_cm": 2.5, "epsg": 32633, "width": 100, "height": 80}
    assert items["Design v2"]["summary"] == {"kind": "design", "cell_size_m": 0.1, "z_min": 1.0, "z_max": 5.0}
    assert items["Cloud May"]["summary"] == {"point_count": 1000, "has_rgb": True, "epsg": 32633}


def test_a_malformed_cursor_is_422(client, project_id):
    r = client.get(f"{BASE}/{project_id}/data", params={"cursor": "not-a-cursor"})
    assert r.status_code == 422 and r.json()["error"]["code"] == "validation_error"


def test_count_per_provider(handle):
    add_image_set(handle, site="a")
    add_image_set(handle, site="b", kind="map")
    add_map(handle)
    with handle.session() as s:
        counts = {t: p.count(s) for t, p in PROVIDERS.items()}
    assert counts == {"image_set": 1, "map": 1, "elevation": 0, "point_cloud": 0}


@pytest.mark.parametrize("rows", [1, 25])
def test_a_page_costs_one_statement_per_provider(client, handle, project_id, rows):
    """Spec 14: <= 5 x (limit + 1) indexed rows, one query per provider, whatever the project holds."""
    for n in range(rows):
        add_map(handle, name=f"m{n}", created_at=at(n))
        add_image_set(handle, site=f"s{n}", created_at=at(n))
        add_surface(handle, name=f"d{n}", created_at=at(n))
        add_cloud(handle, name=f"c{n}", created_at=at(n))
    statements: list[str] = []

    def record(conn, cursor, statement, *args):
        statements.append(statement)

    event.listen(handle.engine, "before_cursor_execute", record)
    try:
        _page(client, project_id, limit=10)
        full = len(statements)
        statements.clear()
        _page(client, project_id, limit=10, type="map")
        one = len(statements)
    finally:
        event.remove(handle.engine, "before_cursor_execute", record)
    assert (full, one) == (4, 1)
