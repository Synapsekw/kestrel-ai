"""Asset findings: create with sightings, the representative sighting, the sightings list, type
changes, delete, thumbnail (spec 2026-10-02-asset-findings §5.5, §5.6, §6.4, §8; A1, A2, A4)."""

import pytest
from asset_findings_helpers import (
    API,
    RECT,
    assert_counts_true,
    by_photo,
    finding_row,
    make_model,
    make_photos,
    place,
    post_asset,
    refresh_finding,
    sightings_of,
    update_sighting,
)
from findings_helpers import add_type, insert_cloud, use_types

from app.db.models import AssetModel
from app.findings import service
from app.findings.anchors import AnchorIn


@pytest.fixture
def ctx(client, project, crack, handle, import_source, tmp_path, make_jpeg) -> dict:
    return {
        "base": f"{API}/projects/{project['id']}",
        "pid": project["id"],
        "photos": make_photos(client, project, import_source, tmp_path, make_jpeg, n=3),
        "model": make_model(handle),
        "crack": crack["id"],
    }


def _boxes(client, ctx, photo_id: str) -> list[dict]:
    return client.get(f"{ctx['base']}/images/{photo_id}/boxes").json()["items"]


def test_post_asset_finding_draws_one_box_per_sighting(client, handle, ctx):
    poly = [[50.0, 50.0], [120.0, 50.0], [120.0, 110.0], [50.0, 110.0]]
    anchor = {
        "kind": "asset",
        "asset_model_id": ctx["model"],
        "sightings": [
            {"image_id": ctx["photos"][0], "box": RECT},
            {"image_id": ctx["photos"][1], "box": RECT, "points": poly},
        ],
    }
    r = client.post(f"{ctx['base']}/findings", json={"type_id": ctx["crack"], "anchor": anchor})
    assert r.status_code == 201, r.text
    f = r.json()
    assert (f["anchor"]["kind"], f["data_type"], f["data_id"]) == ("asset", "asset_model", ctx["model"])
    # All pending: the finding has no placement yet (controller ruling R1).
    assert (f["number"], f["severity"], f["sighting_count"], f["placement"]) == (1, 2, 2, None)
    assert (f["lon"], f["lat"]) == (55.0, 25.0)  # from the frame origin, so Overview pins keep working
    assert f["representative"]["image_id"] in ctx["photos"][:2]
    assert [b["shape"] for b in _boxes(client, ctx, ctx["photos"][0])] == ["box"]
    assert [b["shape"] for b in _boxes(client, ctx, ctx["photos"][1])] == ["polygon"]
    rows = sightings_of(handle, f["id"])
    assert sorted(r.placement for r in rows) == ["pending", "pending"]
    assert {r.asset_model_id for r in rows} == {ctx["model"]}
    assert {r.severity for r in rows} == {2}
    # The boxes are sightings of this finding, not image findings of their own.
    assert [g["id"] for g in client.get(f"{ctx['base']}/findings").json()["items"]] == [f["id"]]
    assert_counts_true(handle)


def test_an_unknown_asset_model_is_404_and_draws_nothing(client, ctx):
    anchor = {
        "kind": "asset",
        "asset_model_id": "nope",
        "sightings": [{"image_id": ctx["photos"][0], "box": RECT}],
    }
    r = client.post(f"{ctx['base']}/findings", json={"type_id": ctx["crack"], "anchor": anchor})
    assert r.status_code == 404, r.text
    assert _boxes(client, ctx, ctx["photos"][0]) == []


def test_an_object_type_is_refused_before_a_box_is_drawn(client, project, ctx):
    truck = project["classes"][3]["id"]
    anchor = {
        "kind": "asset",
        "asset_model_id": ctx["model"],
        "sightings": [{"image_id": ctx["photos"][0], "box": RECT}],
    }
    r = client.post(f"{ctx['base']}/findings", json={"type_id": truck, "anchor": anchor})
    assert r.status_code == 422 and r.json()["error"]["code"] == "not_a_defect"
    assert _boxes(client, ctx, ctx["photos"][0]) == []


def test_an_asset_anchor_needs_a_sighting(client, ctx):
    anchor = {"kind": "asset", "asset_model_id": ctx["model"], "sightings": []}
    r = client.post(f"{ctx['base']}/findings", json={"type_id": ctx["crack"], "anchor": anchor})
    assert r.status_code == 422


def test_the_representative_gives_the_anchor_and_the_derived_fields(client, handle, ctx):
    f = post_asset(client, ctx["pid"], ctx["crack"], ctx["model"], ctx["photos"])
    s = by_photo(handle, f["id"])
    first, second, third = (s[p] for p in ctx["photos"])
    place(handle, first.id, (3.0, 5.0, 0.0), severity=1, coverage=0.5)
    update_sighting(handle, second.id, severity=3)  # the highest grade, but not placed
    place(handle, third.id, (0.0, 12.0, 5.0), normal=(0.0, 0.0, 1.0), severity=3, coverage=0.1)
    refresh_finding(handle, f["id"])
    row = finding_row(handle, f["id"])
    assert (row.ax, row.ay, row.az) == (0.0, 12.0, 5.0)
    assert (row.an_x, row.an_y, row.an_z) == (0.0, 0.0, 1.0)
    assert row.placement == "point"
    assert row.height_m == pytest.approx(12.0)
    assert row.bearing_deg == pytest.approx(90.0)  # atan2(z, x): plant east
    assert row.side == "E"
    assert row.zone is not None
    assert row.severity == 2  # a refresh never touches the operator's severity
    got = client.get(f"{ctx['base']}/findings/{f['id']}").json()
    assert got["representative"] == {"image_id": ctx["photos"][2], "annotation_id": third.annotation_id}
    # Equal severity, both placed: the larger coverage wins.
    place(handle, second.id, (1.0, 20.0, 0.0), severity=3, coverage=0.9)
    refresh_finding(handle, f["id"])
    assert finding_row(handle, f["id"]).ay == 20.0


def test_an_unplaced_finding_has_no_height_zone_or_side(client, handle, ctx):
    f = post_asset(client, ctx["pid"], ctx["crack"], ctx["model"], ctx["photos"][:1])
    row = finding_row(handle, f["id"])
    assert row.placement is None  # its one sighting is pending (controller ruling R1)
    assert (row.ax, row.height_m, row.zone, row.side) == (None, None, None, None)


def test_sightings_route_lists_the_representative_first(client, handle, ctx):
    f = post_asset(client, ctx["pid"], ctx["crack"], ctx["model"], ctx["photos"][:2])
    s = by_photo(handle, f["id"])
    update_sighting(handle, s[ctx["photos"][1]].id, severity=3)
    refresh_finding(handle, f["id"])
    r = client.get(f"{ctx['base']}/findings/{f['id']}/sightings")
    assert r.status_code == 200, r.text
    items = r.json()["items"]
    assert [i["id"] for i in items] == [s[ctx["photos"][1]].id, s[ctx["photos"][0]].id]
    rep = client.get(f"{ctx['base']}/findings/{f['id']}").json()["representative"]
    assert items[0]["annotation_id"] == rep["annotation_id"]
    assert items[0]["placement"] == "pending" and items[0]["center"] is None
    assert [items[0][k] for k in ("height_m", "side", "zone", "stale")] == [None, None, None, False]
    assert {i["asset_model_id"] for i in items} == {ctx["model"]}
    names = {i["id"]: i["file_name"] for i in client.get(f"{ctx['base']}/images").json()["items"]}
    assert [i["image_name"] for i in items] == [names[ctx["photos"][1]], names[ctx["photos"][0]]]


def test_a_placed_sighting_derives_its_fields_on_read(client, handle, ctx):
    f = post_asset(client, ctx["pid"], ctx["crack"], ctx["model"], ctx["photos"][:2])
    s = by_photo(handle, f["id"])
    place(handle, s[ctx["photos"][0]].id, (0.0, 12.0, 5.0), normal=(0.0, 0.0, 1.0), severity=3)
    refresh_finding(handle, f["id"])
    items = client.get(f"{ctx['base']}/findings/{f['id']}/sightings").json()["items"]
    first = items[0]
    assert first["id"] == s[ctx["photos"][0]].id
    assert (first["center"], first["normal"]) == ([0.0, 12.0, 5.0], [0.0, 0.0, 1.0])
    assert first["height_m"] == pytest.approx(12.0) and first["bearing_deg"] == pytest.approx(90.0)
    assert first["side"] == "E" and first["zone"] is not None and first["stale"] is False
    with handle.session() as sess:
        sess.get(AssetModel, ctx["model"]).current_version = 2
    assert client.get(f"{ctx['base']}/findings/{f['id']}/sightings").json()["items"][0]["stale"] is True


def test_a_representative_the_ray_missed_makes_the_finding_none(client, handle, ctx):
    f = post_asset(client, ctx["pid"], ctx["crack"], ctx["model"], ctx["photos"][:2])
    s = by_photo(handle, f["id"])
    update_sighting(handle, s[ctx["photos"][0]].id, placement="none", severity=3)
    refresh_finding(handle, f["id"])
    row = finding_row(handle, f["id"])
    assert (row.placement, row.ax, row.height_m) == ("none", None, None)


def test_sighting_grades_and_tags_are_kept_and_the_highest_is_the_default(client, handle, ctx):
    anchor = {
        "kind": "asset",
        "asset_model_id": ctx["model"],
        "sightings": [
            {"image_id": ctx["photos"][0], "box": RECT, "severity": 1, "group_tag": "A"},
            {"image_id": ctx["photos"][1], "box": RECT, "severity": 3},
        ],
    }
    r = client.post(f"{ctx['base']}/findings", json={"type_id": ctx["crack"], "anchor": anchor})
    assert r.status_code == 201, r.text
    f = r.json()
    assert f["severity"] == 3  # the highest sighting grade (contract createFinding)
    got = by_photo(handle, f["id"])
    assert (got[ctx["photos"][0]].severity, got[ctx["photos"][0]].group_tag) == (1, "A")
    assert (got[ctx["photos"][1]].severity, got[ctx["photos"][1]].group_tag) == (3, None)
    assert f["representative"]["annotation_id"] == got[ctx["photos"][1]].annotation_id
    assert_counts_true(handle)


def test_an_image_finding_is_one_implicit_sighting(client, handle, ctx):
    r = client.post(
        f"{ctx['base']}/images/{ctx['photos'][0]}/boxes",
        json={"class_id": ctx["crack"], "x": 10, "y": 20, "w": 30, "h": 40},
    )
    assert r.status_code == 201, r.text
    box_id = r.json()["id"]
    [f] = client.get(f"{ctx['base']}/findings").json()["items"]
    [one] = client.get(f"{ctx['base']}/findings/{f['id']}/sightings").json()["items"]
    assert (one["image_id"], one["annotation_id"], one["id"]) == (ctx["photos"][0], box_id, box_id)
    assert one["asset_model_id"] == ""
    assert one["finding_id"] == f["id"] and one["placement"] == "none" and one["stale"] is False
    cloud = service.create_finding(
        handle,
        type_id=ctx["crack"],
        anchor=AnchorIn(kind="cloud", cloud_id=insert_cloud(handle), x=1.0, y=2.0, z=3.0),
    )
    assert client.get(f"{ctx['base']}/findings/{cloud.id}/sightings").json()["items"] == []


def test_changing_the_type_moves_every_sighting_box(client, project, ctx):
    rust = add_type(client, "rust")
    use_types(client, project, rust)
    f = post_asset(client, ctx["pid"], ctx["crack"], ctx["model"], ctx["photos"][:2])
    r = client.patch(f"{ctx['base']}/findings/{f['id']}", json={"type_id": rust["id"]})
    assert r.status_code == 200, r.text
    for p in ctx["photos"][:2]:
        assert [b["class_id"] for b in _boxes(client, ctx, p)] == [rust["id"]]


def test_an_asset_anchor_cannot_be_patched(client, ctx):
    f = post_asset(client, ctx["pid"], ctx["crack"], ctx["model"], ctx["photos"][:1])
    r = client.patch(f"{ctx['base']}/findings/{f['id']}", json={"anchor": {"x": 1.0}})
    assert r.status_code == 422 and r.json()["error"]["code"] == "anchor_immutable"


def test_deleting_an_asset_finding_deletes_its_boxes(client, handle, ctx):
    f = post_asset(client, ctx["pid"], ctx["crack"], ctx["model"], ctx["photos"][:2])
    assert client.delete(f"{ctx['base']}/findings/{f['id']}").status_code == 204
    for p in ctx["photos"][:2]:
        assert _boxes(client, ctx, p) == []
    assert sightings_of(handle, f["id"]) == []
    assert_counts_true(handle)


def test_an_asset_finding_thumbnail_crops_its_representative(client, ctx):
    f = post_asset(client, ctx["pid"], ctx["crack"], ctx["model"], ctx["photos"][:1])
    r = client.get(f"{ctx['base']}/findings/{f['id']}/thumbnail")
    assert r.status_code == 200 and r.headers["content-type"] == "image/jpeg"
