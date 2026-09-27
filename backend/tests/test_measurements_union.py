"""`GET /measurements`: the keyset merge across the cloud, volume and map providers, with its
cursor and `kind` filter (plan maps-b4 Task 7; spec §15; Review Focus 4)."""

import pytest
from data_rows import add_cloud, add_surface, at
from mapmeasure_rows import add_cloud_measurement, add_map_measurement, add_volume
from sqlalchemy import event

BASE = "/api/v1/projects"


def _page(client, pid, **params) -> dict:
    r = client.get(f"{BASE}/{pid}/measurements", params=params)
    assert r.status_code == 200, r.text
    return r.json()


def _all(client, pid, **params) -> list[dict]:
    items, cursor = [], None
    while True:
        page = _page(client, pid, **params, **({"cursor": cursor} if cursor else {}))
        items += page["items"]
        cursor = page["next_cursor"]
        if cursor is None:
            return items


@pytest.fixture
def mixed(handle) -> dict[str, str]:
    """Seven rows over three providers, with a created_at tie across all three at at(5)."""
    cloud = add_cloud(handle)
    top = add_surface(handle)
    return {
        "c1": add_cloud_measurement(handle, cloud, created_at=at(1), results={"distance_3d": 1.0}),
        "v2": add_volume(handle, top, created_at=at(2), net=2.0),
        "m3": add_map_measurement(handle, kind="area", created_at=at(3), results={"area_m2": 3.0}),
        "c5": add_cloud_measurement(
            handle, cloud, created_at=at(5), kind="height", results={"height_difference": 5.0}
        ),
        "m5": add_map_measurement(handle, kind="distance", created_at=at(5), results={"length_m": 5.0}),
        "v5": add_volume(handle, top, created_at=at(5), net=5.0),
        "m9": add_map_measurement(handle, kind="profile", created_at=at(9), results={"length_m": 9.0}),
    }


ORDER = ("m9", "c5", "m5", "v5", "m3", "v2", "c1")  # created_at desc, then cloud < map < volume


def test_an_empty_project_has_no_measurements(client, project_id):
    assert _page(client, project_id) == {"items": [], "next_cursor": None}


def test_an_unknown_project_is_404(client):
    assert client.get(f"{BASE}/nope/measurements").status_code == 404


def test_three_providers_merge_in_one_order(client, project_id, mixed):
    items = _page(client, project_id)["items"]
    assert [i["id"] for i in items] == [mixed[k] for k in ORDER]
    assert [(i["kind"], i["sub_kind"], i["headline"], i["unit"]) for i in items][:4] == [
        ("map", "profile", 9.0, "m"),
        ("cloud", "height", 5.0, "m"),
        ("map", "distance", 5.0, "m"),
        ("volume", "volume", 5.0, "m3"),
    ]
    assert all(i["created_at"] and i["updated_at"] for i in items)


def test_ties_across_providers_page_without_repeats(client, project_id, mixed):
    for limit in (1, 2, 3):
        assert [i["id"] for i in _all(client, project_id, limit=limit)] == [mixed[k] for k in ORDER], limit


def test_an_edit_does_not_move_a_row(client, handle, project_id):
    cloud = add_cloud(handle)
    old = add_cloud_measurement(handle, cloud, created_at=at(1), updated_at=at(50))
    new = add_map_measurement(handle, kind="distance", created_at=at(2))
    first = _page(client, project_id, limit=1)
    rest = _page(client, project_id, limit=1, cursor=first["next_cursor"])
    assert [i["id"] for i in first["items"] + rest["items"]] == [new, old]


def test_a_same_provider_tie_breaks_by_id_ascending(client, project_id, handle):
    """Two rows of the *same* provider (map) sharing a `created_at` settle by `id` ascending, the
    union order's last tiebreak key (`kind` alone does not separate them), walked one at a time so
    the id-asc branch of `_after` and the per-provider `order_by` both fire."""
    a = add_map_measurement(handle, kind="area", created_at=at(1))
    b = add_map_measurement(handle, kind="distance", created_at=at(1))
    want = sorted([a, b])
    assert [i["id"] for i in _all(client, project_id, limit=1)] == want


def test_kind_filter(client, project_id, mixed):
    assert [i["id"] for i in _all(client, project_id, kind="volume")] == [mixed["v5"], mixed["v2"]]
    both = _all(client, project_id, kind=["cloud", "map"], limit=2)
    assert {i["kind"] for i in both} == {"cloud", "map"} and len(both) == 5


def test_sub_kind_filter_spans_providers(client, project_id, mixed):
    items = _all(client, project_id, sub_kind="distance")
    assert [(i["kind"], i["id"]) for i in items] == [("map", mixed["m5"]), ("cloud", mixed["c1"])]


def test_a_cursor_survives_a_kind_filter(client, project_id, mixed):
    first = _page(client, project_id, kind="map", limit=1)
    rest = _page(client, project_id, kind="map", limit=5, cursor=first["next_cursor"])
    assert [i["id"] for i in first["items"] + rest["items"]] == [mixed["m9"], mixed["m5"], mixed["m3"]]


def test_a_malformed_cursor_is_422(client, project_id):
    r = client.get(f"{BASE}/{project_id}/measurements", params={"cursor": "not-a-cursor"})
    assert (r.status_code, r.json()["error"]["code"]) == (422, "validation_error")


def test_a_page_is_one_bounded_statement_per_provider(client, handle, project_id, mixed):
    statements: list[str] = []

    def record(conn, cursor, statement, *args):
        statements.append(statement)

    event.listen(handle.engine, "before_cursor_execute", record)
    try:
        _page(client, project_id, limit=2)
        full = [s for s in statements if "measurement" in s]
        statements.clear()
        _page(client, project_id, limit=2, kind="volume")
        one = [s for s in statements if "measurement" in s]
    finally:
        event.remove(handle.engine, "before_cursor_execute", record)
    assert (len(full), len(one)) == (3, 1)
    assert all("LIMIT" in s for s in full + one)


def test_the_python_service_is_the_route(handle, mixed):
    from app.measurements.union import list_page

    page = list_page(handle, kinds=["map"], limit=2)
    assert [i.id for i in page.items] == [mixed["m9"], mixed["m5"]] and page.next_cursor
