"""Deleting the box behind a sighting, or the image (spec 2026-10-02-asset-findings §5.6; index
Review Focus 4): the sighting goes; a finding left with none is closed, not deleted. A sighting box is
never an image finding."""

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
)
from findings_helpers import add_type, use_types

from app.db.models import Box
from app.findings import annotations, sightings
from app.findings.backfill import findings_from_annotations


@pytest.fixture
def ctx(client, project, crack, handle, import_source, tmp_path, make_jpeg) -> dict:
    return {
        "base": f"{API}/projects/{project['id']}",
        "pid": project["id"],
        "photos": make_photos(client, project, import_source, tmp_path, make_jpeg, n=3),
        "model": make_model(handle),
        "crack": crack["id"],
    }


def _box_of(handle, finding_id: str, photo_id: str) -> str:
    return by_photo(handle, finding_id)[photo_id].annotation_id


def _comments(client, ctx, finding_id: str) -> list[str]:
    return [c["text"] for c in client.get(f"{ctx['base']}/findings/{finding_id}/comments").json()["items"]]


def _all_findings(client, ctx) -> list[dict]:
    return client.get(f"{ctx['base']}/findings", params={"sort": "number"}).json()["items"]


def test_box_delete_closes_empty_finding(client, handle, ctx):
    p0, p1 = ctx["photos"][:2]
    alone = post_asset(client, ctx["pid"], ctx["crack"], ctx["model"], [p0])
    pair = post_asset(client, ctx["pid"], ctx["crack"], ctx["model"], [p0, p1])

    assert client.delete(f"{ctx['base']}/boxes/{_box_of(handle, alone['id'], p0)}").status_code == 204
    closed = client.get(f"{ctx['base']}/findings/{alone['id']}").json()
    assert (closed["status"], closed["sighting_count"]) == ("closed", 0)
    assert _comments(client, ctx, alone["id"]) == [sightings.BOX_GONE]
    kinds = {
        a["kind"]
        for a in client.get(f"{ctx['base']}/activity", params={"subject_id": alone["id"]}).json()["items"]
    }
    assert "finding.status" in kinds

    assert client.delete(f"{ctx['base']}/boxes/{_box_of(handle, pair['id'], p0)}").status_code == 204
    still = client.get(f"{ctx['base']}/findings/{pair['id']}").json()
    assert (still["status"], still["sighting_count"]) == ("open", 1)
    assert still["representative"]["image_id"] == p1
    assert [f["id"] for f in _all_findings(client, ctx)] == [alone["id"], pair["id"]]  # nothing deleted
    assert_counts_true(handle)


def test_image_delete_closes_empty_findings(client, handle, ctx):
    p0, p1 = ctx["photos"][:2]
    alone = post_asset(client, ctx["pid"], ctx["crack"], ctx["model"], [p0])
    pair = post_asset(client, ctx["pid"], ctx["crack"], ctx["model"], [p0, p1])
    r = client.post(f"{ctx['base']}/images/bulk-delete", json={"image_ids": [p0]})
    assert r.status_code == 200, r.text
    a = client.get(f"{ctx['base']}/findings/{alone['id']}").json()
    b = client.get(f"{ctx['base']}/findings/{pair['id']}").json()
    assert (a["status"], a["sighting_count"]) == ("closed", 0)
    assert (b["status"], b["sighting_count"]) == ("open", 1)
    assert _comments(client, ctx, alone["id"]) == [sightings.PHOTOS_GONE]
    assert [r.image_id for r in sightings_of(handle, pair["id"])] == [p1]
    assert len(_all_findings(client, ctx)) == 2  # closed, never deleted
    assert_counts_true(handle)


def test_a_box_edit_marks_its_sighting_pending_and_makes_no_image_finding(client, handle, ctx):
    p0 = ctx["photos"][0]
    f = post_asset(client, ctx["pid"], ctx["crack"], ctx["model"], [p0])
    sighting = by_photo(handle, f["id"])[p0]
    place(handle, sighting.id, (0.0, 12.0, 5.0))
    r = client.patch(f"{ctx['base']}/boxes/{sighting.annotation_id}", json={"x": 12.0})
    assert r.status_code == 200, r.text
    assert by_photo(handle, f["id"])[p0].placement == "pending"
    assert finding_row(handle, f["id"]).placement is None  # ruling R1: the representative is pending
    assert [g["id"] for g in _all_findings(client, ctx)] == [f["id"]]


def test_reclassing_one_of_several_sighting_boxes_splits_it_out(client, handle, project, ctx):
    rust = add_type(client, "rust")
    use_types(client, project, rust)
    p0, p1 = ctx["photos"][:2]
    f = post_asset(client, ctx["pid"], ctx["crack"], ctx["model"], [p0, p1])
    r = client.patch(f"{ctx['base']}/boxes/{_box_of(handle, f['id'], p1)}", json={"class_id": rust["id"]})
    assert r.status_code == 200, r.text
    [old, new] = _all_findings(client, ctx)
    assert (old["id"], old["type_id"], old["sighting_count"]) == (f["id"], ctx["crack"], 1)
    assert (new["type_id"], new["sighting_count"], new["number"]) == (rust["id"], 1, 2)
    assert_counts_true(handle)


def test_reclassing_the_only_sighting_box_moves_the_finding_type(client, handle, project, ctx):
    rust = add_type(client, "rust")
    use_types(client, project, rust)
    p0 = ctx["photos"][0]
    f = post_asset(client, ctx["pid"], ctx["crack"], ctx["model"], [p0])
    r = client.patch(f"{ctx['base']}/boxes/{_box_of(handle, f['id'], p0)}", json={"class_id": rust["id"]})
    assert r.status_code == 200, r.text
    [only] = _all_findings(client, ctx)
    assert (only["id"], only["type_id"], only["sighting_count"]) == (f["id"], rust["id"], 1)
    assert_counts_true(handle)


def test_a_sighting_box_reclassed_to_an_object_type_leaves_its_finding(client, handle, project, ctx):
    truck = project["classes"][3]["id"]
    p0 = ctx["photos"][0]
    f = post_asset(client, ctx["pid"], ctx["crack"], ctx["model"], [p0])
    r = client.patch(f"{ctx['base']}/boxes/{_box_of(handle, f['id'], p0)}", json={"class_id": truck})
    assert r.status_code == 200, r.text
    got = client.get(f"{ctx['base']}/findings/{f['id']}").json()
    assert (got["status"], got["sighting_count"]) == ("closed", 0)
    assert _comments(client, ctx, f["id"]) == [sightings.NOT_A_SIGHTING]
    assert_counts_true(handle)


def test_a_rejected_sighting_box_leaves_its_finding(client, handle, ctx):
    p0 = ctx["photos"][0]
    f = post_asset(client, ctx["pid"], ctx["crack"], ctx["model"], [p0])
    with handle.session() as s:
        box = s.get(Box, _box_of(handle, f["id"], p0))
        box.review_state = "rejected"
        assert annotations.on_box_changed(s, handle.id, handle.catalogue, box) == []
    assert finding_row(handle, f["id"]).status == "closed"
    assert sightings_of(handle, f["id"]) == []
    assert_counts_true(handle)


def test_the_backfill_skips_sighting_boxes(client, handle, ctx):
    post_asset(client, ctx["pid"], ctx["crack"], ctx["model"], ctx["photos"][:2])
    assert findings_from_annotations(handle) == 0
    assert len(_all_findings(client, ctx)) == 1


def test_a_sighting_box_cannot_be_adopted_as_an_image_finding(client, handle, ctx):
    p0 = ctx["photos"][0]
    f = post_asset(client, ctx["pid"], ctx["crack"], ctx["model"], [p0])
    anchor = {"kind": "image", "image_id": p0, "annotation_id": _box_of(handle, f["id"], p0)}
    r = client.post(f"{ctx['base']}/findings", json={"type_id": ctx["crack"], "anchor": anchor})
    assert r.status_code == 409 and r.json()["error"]["code"] == "conflict"


def test_drawing_on_a_photo_still_makes_an_image_finding(client, ctx):
    """The ordinary box path is unchanged: a person's defect box beside a sighting is an image finding."""
    post_asset(client, ctx["pid"], ctx["crack"], ctx["model"], ctx["photos"][:1])
    r = client.post(f"{ctx['base']}/images/{ctx['photos'][0]}/boxes", json={"class_id": ctx["crack"], **RECT})
    assert r.status_code == 201, r.text
    kinds = sorted(f["anchor"]["kind"] for f in _all_findings(client, ctx))
    assert kinds == ["asset", "image"]


def test_a_geometry_edit_on_a_type_turned_object_keeps_the_sighting(client, handle, ctx):
    """Ruling R11 (foundation spec section 7.2: defect -> object keeps existing findings): only a
    reclass of the box itself takes its sighting away, never a nudge."""
    p0 = ctx["photos"][0]
    f = post_asset(client, ctx["pid"], ctx["crack"], ctx["model"], [p0])
    sighting = by_photo(handle, f["id"])[p0]
    place(handle, sighting.id, (0.0, 12.0, 5.0))
    r = client.patch(f"{API}/catalogue/types/{ctx['crack']}", json={"kind": "object"})
    assert r.status_code == 200, r.text
    r = client.patch(f"{ctx['base']}/boxes/{sighting.annotation_id}", json={"x": 12.0})
    assert r.status_code == 200, r.text
    got = client.get(f"{ctx['base']}/findings/{f['id']}").json()
    assert (got["status"], got["sighting_count"]) == ("open", 1)
    after = by_photo(handle, f["id"])[p0]
    assert (after.id, after.placement, after.placed_version) == (sighting.id, "pending", None)
    assert _comments(client, ctx, f["id"]) == []
    assert_counts_true(handle)


def test_a_reclass_with_a_move_leaves_the_split_sighting_pending(client, handle, project, ctx):
    rust = add_type(client, "rust")
    use_types(client, project, rust)
    p0, p1 = ctx["photos"][:2]
    f = post_asset(client, ctx["pid"], ctx["crack"], ctx["model"], [p0, p1])
    for i, row in enumerate(by_photo(handle, f["id"]).values()):
        place(handle, row.id, (0.0, 10.0 + i, 5.0))
    refresh_finding(handle, f["id"])
    box_id = _box_of(handle, f["id"], p1)
    r = client.patch(f"{ctx['base']}/boxes/{box_id}", json={"class_id": rust["id"], "x": 12.0})
    assert r.status_code == 200, r.text
    [old, new] = _all_findings(client, ctx)
    assert (old["id"], new["type_id"]) == (f["id"], rust["id"])
    moved = by_photo(handle, new["id"])[p1]
    assert (moved.placement, moved.placed_version) == ("pending", None)
    assert finding_row(handle, new["id"]).placement is None  # ruling R1: its representative is pending
    assert finding_row(handle, f["id"]).placement == "point"  # the sighting left behind is still placed
    assert_counts_true(handle)


def test_a_reclass_with_a_move_leaves_the_only_sighting_pending(client, handle, project, ctx):
    rust = add_type(client, "rust")
    use_types(client, project, rust)
    p0 = ctx["photos"][0]
    f = post_asset(client, ctx["pid"], ctx["crack"], ctx["model"], [p0])
    place(handle, by_photo(handle, f["id"])[p0].id, (0.0, 12.0, 5.0))
    refresh_finding(handle, f["id"])
    assert finding_row(handle, f["id"]).placement == "point"
    box_id = _box_of(handle, f["id"], p0)
    r = client.patch(f"{ctx['base']}/boxes/{box_id}", json={"class_id": rust["id"], "x": 12.0})
    assert r.status_code == 200, r.text
    row = finding_row(handle, f["id"])
    assert (row.type_id, row.placement) == (rust["id"], None)
    assert by_photo(handle, f["id"])[p0].placement == "pending"
    assert_counts_true(handle)
