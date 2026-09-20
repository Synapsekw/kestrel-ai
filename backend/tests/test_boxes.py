import pytest

from app.db.models import Box


@pytest.fixture
def labelled(client, project, import_source, tmp_path, make_jpeg):
    """One 320x240 image and the project's class ids."""
    folder = tmp_path / "frames"
    make_jpeg(folder / "S_0001_0001.jpg", 320, 240, seed=1)
    import_source(project["id"], folder)
    pid = project["id"]
    image_id = client.get(f"/api/v1/projects/{pid}/images").json()["items"][0]["id"]
    return {"pid": pid, "image_id": image_id, "classes": [c["id"] for c in project["classes"]]}


def _create(client, ctx, **body):
    payload = {"class_id": ctx["classes"][0], "x": 10, "y": 20, "w": 30, "h": 40, **body}
    return client.post(f"/api/v1/projects/{ctx['pid']}/images/{ctx['image_id']}/boxes", json=payload)


def _proposal(client, ctx, **fields):
    """A pending model proposal, inserted straight through the model (S4 owns the API for these)."""
    handle = client.app.state.projects.get(ctx["pid"])
    with handle.session() as s:
        row = Box(
            image_id=ctx["image_id"],
            class_id=ctx["classes"][1],
            x=1,
            y=2,
            w=3,
            h=4,
            confidence=0.7,
            provenance_kind="local_model",
            model_name="yolo11m",
            review_state="unreviewed",
            **fields,
        )
        s.add(row)
        s.flush()
        s.expunge(row)
    return row.id


def test_create_box_is_person_drawn_and_accepted(client, labelled):
    r = _create(client, labelled)
    assert r.status_code == 201, r.text
    box = r.json()
    assert box["image_id"] == labelled["image_id"] and box["class_id"] == labelled["classes"][0]
    assert (box["x"], box["y"], box["w"], box["h"]) == (10, 20, 30, 40)
    assert box["review_state"] == "accepted" and box["reviewed_at"]
    assert box["confidence"] is None
    assert box["provenance"] == {
        "kind": "person",
        "model_id": None,
        "provider": None,
        "model_name": None,
        "query_run_id": None,
    }


def test_create_box_rejects_out_of_bounds_and_unknown_class(client, labelled):
    outside = _create(client, labelled, x=300, y=10, w=40, h=10)  # 300 + 40 > 320
    assert outside.status_code == 422 and outside.json()["error"]["code"] == "validation_error"
    assert _create(client, labelled, y=200, h=100).status_code == 422  # 200 + 100 > 240
    assert _create(client, labelled, class_id="no-such-class").status_code == 422
    assert _create(client, labelled, x=-1).status_code == 422  # contract minimum
    assert _create(client, labelled, w=0).status_code == 422  # contract exclusive minimum


def test_create_box_on_an_unknown_image_is_not_found(client, labelled):
    r = client.post(
        f"/api/v1/projects/{labelled['pid']}/images/nope/boxes",
        json={"class_id": labelled["classes"][0], "x": 1, "y": 1, "w": 2, "h": 2},
    )
    assert r.status_code == 404


def test_list_boxes_is_ordered_by_creation(client, labelled):
    ids = [_create(client, labelled, x=i).json()["id"] for i in range(3)]
    r = client.get(f"/api/v1/projects/{labelled['pid']}/images/{labelled['image_id']}/boxes")
    assert r.status_code == 200
    assert [b["id"] for b in r.json()["items"]] == ids
    assert client.get(f"/api/v1/projects/{labelled['pid']}/images/nope/boxes").status_code == 404


def test_patch_moves_and_reclassifies_without_losing_acceptance(client, labelled):
    box = _create(client, labelled).json()
    r = client.patch(
        f"/api/v1/projects/{labelled['pid']}/boxes/{box['id']}",
        json={"x": 50, "y": 60, "class_id": labelled["classes"][2]},
    )
    assert r.status_code == 200
    updated = r.json()
    assert (updated["x"], updated["y"], updated["w"], updated["h"]) == (50, 60, 30, 40)
    assert updated["class_id"] == labelled["classes"][2]
    assert updated["review_state"] == "accepted"  # a person box stays accepted


def test_patch_of_a_proposal_makes_it_edited(client, labelled):
    box_id = _proposal(client, labelled)
    r = client.patch(f"/api/v1/projects/{labelled['pid']}/boxes/{box_id}", json={"x": 9})
    assert r.status_code == 200
    box = r.json()
    assert box["review_state"] == "edited" and box["reviewed_at"]
    assert box["provenance"]["kind"] == "local_model" and box["provenance"]["model_name"] == "yolo11m"
    assert box["confidence"] == 0.7  # editing keeps the model's score for the audit trail


def test_patch_validates_bounds_and_unknown_box(client, labelled):
    box = _create(client, labelled).json()
    pid = labelled["pid"]
    assert client.patch(f"/api/v1/projects/{pid}/boxes/{box['id']}", json={"w": 400}).status_code == 422
    assert client.patch(f"/api/v1/projects/{pid}/boxes/nope", json={"x": 1}).status_code == 404


def test_delete_box(client, labelled):
    box = _create(client, labelled).json()
    pid = labelled["pid"]
    assert client.delete(f"/api/v1/projects/{pid}/boxes/{box['id']}").status_code == 204
    assert client.delete(f"/api/v1/projects/{pid}/boxes/{box['id']}").status_code == 404
    assert client.get(f"/api/v1/projects/{pid}/images/{labelled['image_id']}/boxes").json()["items"] == []


def test_review_accepts_rejects_and_ignores_unknown_ids(client, labelled):
    pid = labelled["pid"]
    first, second = _proposal(client, labelled), _proposal(client, labelled)
    r = client.post(
        f"/api/v1/projects/{pid}/boxes/review", json={"box_ids": [first, "nope"], "action": "accept"}
    )
    assert r.status_code == 200 and r.json() == {"updated": 1}
    # accepting again changes nothing
    again = client.post(f"/api/v1/projects/{pid}/boxes/review", json={"box_ids": [first], "action": "accept"})
    assert again.json() == {"updated": 0}
    r = client.post(f"/api/v1/projects/{pid}/boxes/review", json={"box_ids": [second], "action": "reject"})
    assert r.json() == {"updated": 1}
    states = {
        b["id"]: b
        for b in client.get(f"/api/v1/projects/{pid}/images/{labelled['image_id']}/boxes").json()["items"]
    }
    assert states[first]["review_state"] == "accepted" and states[first]["reviewed_at"]
    assert states[second]["review_state"] == "rejected" and states[second]["reviewed_at"]


def test_image_counts_follow_box_changes(client, labelled):
    pid, image_id = labelled["pid"], labelled["image_id"]

    def counts():
        i = client.get(f"/api/v1/projects/{pid}/images/{image_id}").json()
        return i["labeled"], i["box_count"], i["pending_count"], i["max_pending_confidence"]

    assert counts() == (False, 0, 0, None)
    proposal = _proposal(client, labelled)
    assert counts() == (False, 0, 1, 0.7)
    client.post(f"/api/v1/projects/{pid}/boxes/review", json={"box_ids": [proposal], "action": "accept"})
    assert counts() == (True, 1, 0, None)
    _create(client, labelled)
    assert counts() == (True, 2, 0, None)


def test_accepting_an_edited_box_keeps_it_edited(client, labelled):
    pid = labelled["pid"]
    box_id = _proposal(client, labelled)
    client.patch(f"/api/v1/projects/{pid}/boxes/{box_id}", json={"x": 9})
    r = client.post(f"/api/v1/projects/{pid}/boxes/review", json={"box_ids": [box_id], "action": "accept"})
    assert r.json() == {"updated": 0}  # already ground truth
    boxes = client.get(f"/api/v1/projects/{pid}/images/{labelled['image_id']}/boxes").json()["items"]
    assert boxes[0]["review_state"] == "edited"
    # rejecting it is still possible
    client.post(f"/api/v1/projects/{pid}/boxes/review", json={"box_ids": [box_id], "action": "reject"})
    boxes = client.get(f"/api/v1/projects/{pid}/images/{labelled['image_id']}/boxes").json()["items"]
    assert boxes[0]["review_state"] == "rejected"


def test_unreview_returns_a_proposal_to_the_queue(client, labelled):
    pid = labelled["pid"]
    box_id = _proposal(client, labelled)
    client.patch(f"/api/v1/projects/{pid}/boxes/{box_id}", json={"x": 9})  # -> edited
    r = client.post(f"/api/v1/projects/{pid}/boxes/review", json={"box_ids": [box_id], "action": "unreview"})
    assert r.status_code == 200 and r.json() == {"updated": 1}
    box = client.get(f"/api/v1/projects/{pid}/images/{labelled['image_id']}/boxes").json()["items"][0]
    assert box["review_state"] == "unreviewed" and box["reviewed_at"] is None
    assert box["x"] == 9  # the edit itself is kept, only the decision is undone
    # undoing again changes nothing
    again = client.post(
        f"/api/v1/projects/{pid}/boxes/review", json={"box_ids": [box_id], "action": "unreview"}
    )
    assert again.json() == {"updated": 0}


def test_review_ignores_person_drawn_boxes(client, labelled):
    pid = labelled["pid"]
    box = _create(client, labelled).json()
    for action in ("reject", "unreview", "accept"):
        r = client.post(
            f"/api/v1/projects/{pid}/boxes/review", json={"box_ids": [box["id"]], "action": action}
        )
        assert r.json() == {"updated": 0}, action
    still = client.get(f"/api/v1/projects/{pid}/images/{labelled['image_id']}/boxes").json()["items"][0]
    assert still["review_state"] == "accepted" and still["reviewed_at"]


def test_patch_rejects_an_explicit_null(client, labelled):
    """`null` is outside the contract's BoxUpdate schema, so it is a 422, never a 500."""
    box = _create(client, labelled).json()
    pid = labelled["pid"]
    for field in ("x", "y", "w", "h", "class_id"):
        r = client.patch(f"/api/v1/projects/{pid}/boxes/{box['id']}", json={field: None})
        assert r.status_code == 422, (field, r.status_code, r.text)
        assert r.json()["error"]["code"] == "validation_error"
    unchanged = client.get(f"/api/v1/projects/{pid}/images/{labelled['image_id']}/boxes").json()["items"][0]
    assert (unchanged["x"], unchanged["w"]) == (10, 30)


def test_create_box_defaults_to_zero_angle(client, labelled):
    r = _create(client, labelled)
    assert r.status_code == 201, r.text
    assert r.json()["angle"] == 0.0


def test_create_box_accepts_an_angle(client, labelled):
    r = _create(client, labelled, angle=30.0)
    assert r.status_code == 201, r.text
    assert r.json()["angle"] == 30.0


def test_patch_box_sets_the_angle(client, labelled):
    box_id = _create(client, labelled).json()["id"]
    r = client.patch(f"/api/v1/projects/{labelled['pid']}/boxes/{box_id}", json={"angle": 45.0})
    assert r.status_code == 200, r.text
    assert r.json()["angle"] == 45.0


def test_angle_is_normalised_into_zero_to_one_eighty_on_write(client, labelled):
    """A rectangle has 180 degree symmetry, so 190 and 10 are the same shape (spec 3.1)."""
    box_id = _create(client, labelled, angle=190.0).json()["id"]
    assert client.get(f"/api/v1/projects/{labelled['pid']}/images/{labelled['image_id']}/boxes").json()[
        "items"
    ][0]["angle"] == 10.0
    r = client.patch(f"/api/v1/projects/{labelled['pid']}/boxes/{box_id}", json={"angle": -10.0})
    assert r.json()["angle"] == 170.0


def test_existing_boxes_read_back_as_zero_angle(client, labelled):
    """Migration 0003 gives every pre-existing row angle 0 through the column default."""
    proposal_id = _proposal(client, labelled)
    rows = client.get(
        f"/api/v1/projects/{labelled['pid']}/images/{labelled['image_id']}/boxes"
    ).json()["items"]
    assert [b["angle"] for b in rows if b["id"] == proposal_id] == [0.0]


def test_rotated_box_may_hang_over_the_image_edge(client, labelled):
    """A truck half out of frame at 30 degrees is a real annotation (spec 3.3).

    320x240 image: this box's right edge is at 340, twenty pixels past it, but its centre (310)
    is comfortably inside.
    """
    r = _create(client, labelled, x=280, y=10, w=60, h=20, angle=30.0)
    assert r.status_code == 201, r.text


def test_rotated_box_centre_must_stay_inside_the_image(client, labelled):
    """Centre at 430 on a 320-wide image: the box is not merely truncated, it is off the frame."""
    r = _create(client, labelled, x=400, y=10, w=60, h=20, angle=30.0)
    assert r.status_code == 422, r.text
    assert "centre" in r.json()["error"]["message"]


def test_unrotated_box_still_must_lie_fully_inside(client, labelled):
    """The same box at angle 0 is still rejected: today's rule is untouched (spec 3.3)."""
    r = _create(client, labelled, x=280, y=10, w=60, h=20, angle=0.0)
    assert r.status_code == 422, r.text
    assert "does not lie inside" in r.json()["error"]["message"]


def test_patch_may_rotate_a_box_that_then_overhangs_the_edge(client, labelled):
    """The main flow: draw upright, then rotate. The rotate is a PATCH, not a create."""
    rejected = _create(client, labelled, x=280, y=10, w=60, h=20, angle=0.0)
    assert rejected.status_code == 422, "a 60-wide box at x=280 must not fit upright on a 320px image"
    box_id = _create(client, labelled, x=200, y=10, w=60, h=20).json()["id"]
    r = client.patch(
        f"/api/v1/projects/{labelled['pid']}/boxes/{box_id}", json={"x": 280, "angle": 30.0}
    )
    assert r.status_code == 200, r.text
    assert (r.json()["x"], r.json()["angle"]) == (280, 30.0)


def test_patch_rechecks_bounds_against_the_rows_existing_angle(client, labelled):
    """An x-only PATCH on an already-rotated row must validate against the stored angle,
    not against angle 0 — otherwise moving a rotated box would hit the upright rule."""
    box_id = _create(client, labelled, x=200, y=10, w=60, h=20, angle=30.0).json()["id"]
    r = client.patch(f"/api/v1/projects/{labelled['pid']}/boxes/{box_id}", json={"x": 280})
    assert r.status_code == 200, r.text


def test_patch_still_rejects_a_move_that_puts_the_centre_outside(client, labelled):
    box_id = _create(client, labelled, x=200, y=10, w=60, h=20, angle=30.0).json()["id"]
    r = client.patch(f"/api/v1/projects/{labelled['pid']}/boxes/{box_id}", json={"x": 400})
    assert r.status_code == 422, r.text
    assert "centre" in r.json()["error"]["message"]
