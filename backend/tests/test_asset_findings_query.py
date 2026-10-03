"""The register's asset filters and sorts (spec 2026-10-02-asset-findings section 8 `GET /findings`): keyset
paging holds for the new sorts, and no-height or no-zone findings sort last."""

import pytest
from asset_findings_helpers import API, make_model, make_photos, post_asset, set_finding
from findings_helpers import insert_cloud

from app.findings import service
from app.findings.anchors import AnchorIn

SHAPE = {
    "F1": ("m1", 25.0, "antenna", "N", "mast", "point"),
    "F2": ("m1", 12.0, "body", "E", "leg", "patch"),
    "F3": ("m1", None, None, None, None, "none"),
    "F4": ("m1", 3.0, "base", "E", "leg", "point"),
    "F5": ("m2", 40.0, "body", "W", "flue", "patch"),
}


@pytest.fixture
def five(client, handle, project, crack, import_source, tmp_path, make_jpeg) -> dict:
    photos = make_photos(client, project, import_source, tmp_path, make_jpeg, n=1)
    models = {"m1": make_model(handle, name="Tower"), "m2": make_model(handle, name="Stack")}
    ids = {}
    for key, (m, height, zone, side, component, placement) in SHAPE.items():
        f = post_asset(client, project["id"], crack["id"], models[m], photos)
        set_finding(
            handle, f["id"], height_m=height, zone=zone, side=side, component=component, placement=placement
        )
        ids[key] = f["id"]
    cloud = AnchorIn(kind="cloud", cloud_id=insert_cloud(handle), x=1.0, y=2.0, z=3.0)
    ids["C"] = service.create_finding(handle, type_id=crack["id"], anchor=cloud).id
    return {"base": f"{API}/projects/{project['id']}", "ids": ids, **models}


def _names(five, items) -> list[str]:
    back = {v: k for k, v in five["ids"].items()}
    return [back[f["id"]] for f in items]


def _list(client, five, **params) -> list[str]:
    r = client.get(f"{five['base']}/findings", params={"sort": "number", **params})
    assert r.status_code == 200, r.text
    return _names(five, r.json()["items"])


def _walk(client, five, sort: str, **params) -> list[str]:
    out, cursor = [], None
    while True:
        q = {"sort": sort, "limit": 2, **params}
        if cursor:
            q["cursor"] = cursor
        r = client.get(f"{five['base']}/findings", params=q)
        assert r.status_code == 200, r.text
        page = r.json()
        out += _names(five, page["items"])
        cursor = page["next_cursor"]
        if not cursor:
            return out


def test_filters_by_model_zone_side_and_component(client, five):
    assert _list(client, five, asset_model_id=five["m1"]) == ["F1", "F2", "F3", "F4"]
    assert _list(client, five, zone="body") == ["F2", "F5"]
    assert _list(client, five, zone=["body", "base"], asset_model_id=five["m1"]) == ["F2", "F4"]
    assert _list(client, five, side="E") == ["F2", "F4"]
    assert _list(client, five, component="leg") == ["F2", "F4"]


def test_placed_filter(client, five):
    assert _list(client, five, placed="true") == ["F1", "F2", "F4", "F5"]
    assert _list(client, five, placed="false") == ["F3"]  # the cloud finding is not an unplaced asset one


def test_placed_false_matches_a_pending_asset_finding(client, handle, five):
    set_finding(handle, five["ids"]["F3"], placement=None)  # R1: null while the representative is pending
    assert _list(client, five, placed="false") == ["F3"]


def test_source_asset(client, five):
    assert _list(client, five, anchor_kind="asset") == ["F1", "F2", "F3", "F4", "F5"]
    assert _list(client, five, anchor_kind="cloud") == ["C"]


def test_sort_by_height_pages_highest_first_and_no_height_last(client, five):
    assert _walk(client, five, "-height", anchor_kind="asset") == ["F5", "F1", "F2", "F4", "F3"]


def test_sort_by_zone_pages_with_no_zone_last(client, five):
    # contract: zone ascending, no zone last, ties highest first (F5 40 m before F2 12 m)
    assert _walk(client, five, "zone", anchor_kind="asset") == ["F1", "F4", "F5", "F2", "F3"]


def test_a_cursor_from_another_sort_is_refused(client, five):
    r = client.get(f"{five['base']}/findings", params={"sort": "-height", "limit": 2})
    cursor = r.json()["next_cursor"]
    r = client.get(f"{five['base']}/findings", params={"sort": "zone", "cursor": cursor})
    assert r.status_code == 422


def test_global_search_answers_the_asset_representative(client, five):
    r = client.get(f"{five['base']}/search", params={"q": "F-0001"})
    assert r.status_code == 200, r.text
    hit = next(f for f in r.json()["findings"] if f["id"] == five["ids"]["F1"])
    assert hit["representative"]["image_id"]
