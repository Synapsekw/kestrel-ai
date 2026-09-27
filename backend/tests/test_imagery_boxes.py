"""Shapes through the kept box routes (spec 2026-09-26-image-inspection sections 8.1, 8.2, 14)."""

import pytest
from sqlalchemy import func, select

from app.db.models import Box, Finding

API = "/api/v1"
SQUARE = [[10, 10], [60, 10], [60, 40], [10, 40]]


@pytest.fixture
def ctx(client, project, crack, import_source, tmp_path, make_jpeg) -> dict:
    """One 320x240 image, the defect type `crack` and the object type `dump_truck`."""
    folder = tmp_path / "frames"
    make_jpeg(folder / "S_0001_0001.jpg", 320, 240, seed=1)
    import_source(project["id"], folder)
    base = f"{API}/projects/{project['id']}"
    image_id = client.get(f"{base}/images").json()["items"][0]["id"]
    return {"base": base, "image_id": image_id, "crack": crack["id"], "truck": project["classes"][3]["id"]}


@pytest.fixture
def touched(monkeypatch) -> list[str]:
    """Every summary.touch call, with a check that it ran inside the write's transaction."""
    from app.imagery import summary

    calls: list[str] = []

    def spy(s, image_id):
        assert s.in_transaction()
        calls.append(image_id)

    monkeypatch.setattr(summary, "touch", spy)
    return calls


def _post(client, ctx, **body):
    return client.post(
        f"{ctx['base']}/images/{ctx['image_id']}/boxes", json={"class_id": ctx["truck"], **body}
    )


def _patch(client, ctx, box_id, params=None, **body):
    return client.patch(f"{ctx['base']}/boxes/{box_id}", params=params or {}, json=body)


def _code(r) -> str:
    return r.json()["error"]["code"]


def test_create_box_returns_a_write_result(client, ctx, touched):
    r = _post(client, ctx, x=10, y=20, w=30, h=40)
    assert r.status_code == 201, r.text
    b = r.json()
    assert (b["shape"], b["points"], b["assist"], b["area_px"], b["repaired"], b["finding_id"]) == (
        "box",
        None,
        None,
        1200,
        False,
        None,
    )
    assert b["updated_at"] is not None
    assert touched == [ctx["image_id"]]


def test_old_style_rotated_create_is_an_rbox(client, ctx):
    assert _post(client, ctx, x=10, y=20, w=30, h=40, angle=30).json()["shape"] == "rbox"


def test_missing_field_is_invalid_shape(client, ctx):
    assert _code(_post(client, ctx, x=10, y=20)) == "invalid_shape"
    assert _code(_post(client, ctx, shape="polygon")) == "invalid_shape"


def test_create_polygon_stores_points_and_envelope(client, ctx):
    b = _post(client, ctx, shape="polygon", points=SQUARE, assist="sam").json()
    assert (b["shape"], b["x"], b["y"], b["w"], b["h"], b["angle"], b["assist"]) == (
        "polygon",
        10,
        10,
        50,
        30,
        0,
        "sam",
    )
    assert b["area_px"] == 1500 and b["repaired"] is False and len(b["points"]) == 4


def test_create_polygon_repairs_and_says_so(client, ctx):
    b = _post(client, ctx, shape="polygon", points=[[0, 0], [100, 100], [100, 0], [0, 60]]).json()
    assert b["repaired"] is True
    xs, ys = [p[0] for p in b["points"]], [p[1] for p in b["points"]]
    assert (b["x"], b["y"], b["x"] + b["w"], b["y"] + b["h"]) == pytest.approx(
        (min(xs), min(ys), max(xs), max(ys))
    )


def test_polygon_entirely_outside_is_empty_polygon(client, ctx, handle, touched):
    r = _post(client, ctx, shape="polygon", points=[[400, 400], [500, 400], [500, 500]])
    assert r.status_code == 422 and _code(r) == "empty_polygon"
    with handle.session() as s:
        assert s.scalar(select(func.count()).select_from(Box)) == 0
    assert touched == []


def test_point_on_a_defect_type_is_a_finding(client, ctx):
    b = _post(client, ctx, class_id=ctx["crack"], shape="point", x=5, y=6).json()
    assert (b["shape"], b["w"], b["h"], b["area_px"]) == ("point", 0, 0, 0)
    assert b["finding_id"] is not None
    items = client.get(f"{ctx['base']}/findings").json()["items"]
    assert [f["id"] for f in items] == [b["finding_id"]]


def test_point_needs_a_defect_type(client, ctx):
    r = _post(client, ctx, shape="point", x=5, y=6)
    assert r.status_code == 422 and _code(r) == "point_needs_defect_type"


def test_point_cannot_be_retyped_to_an_object_type(client, ctx):
    b = _post(client, ctx, class_id=ctx["crack"], shape="point", x=5, y=6).json()
    r = _patch(client, ctx, b["id"], class_id=ctx["truck"])
    assert r.status_code == 422 and _code(r) == "point_needs_defect_type"
    r = _patch(client, ctx, b["id"], params={"confirm_finding_delete": True}, class_id=ctx["truck"])
    assert r.status_code == 422 and _code(r) == "point_needs_defect_type"


def test_defect_box_create_returns_its_finding(client, ctx, handle):
    b = _post(client, ctx, class_id=ctx["crack"], x=10, y=20, w=30, h=40).json()
    with handle.session() as s:
        assert s.scalar(select(Finding.id).where(Finding.annotation_id == b["id"])) == b["finding_id"]


def test_patch_polygon_rejects_rect_fields_and_accepts_points(client, ctx):
    b = _post(client, ctx, shape="polygon", points=SQUARE).json()
    r = _patch(client, ctx, b["id"], x=20)
    assert r.status_code == 422 and _code(r) == "invalid_shape"
    r = _patch(client, ctx, b["id"], points=[[x + 5, y + 5] for x, y in SQUARE])
    assert r.status_code == 200, r.text
    assert (r.json()["x"], r.json()["y"], r.json()["area_px"], r.json()["repaired"]) == (15, 15, 1500, False)


def test_patch_rectangle_follows_its_angle_and_refuses_points(client, ctx):
    b = _post(client, ctx, x=10, y=20, w=30, h=40).json()
    assert _patch(client, ctx, b["id"], angle=45).json()["shape"] == "rbox"
    assert _patch(client, ctx, b["id"], angle=0).json()["shape"] == "box"
    r = _patch(client, ctx, b["id"], points=SQUARE)
    assert r.status_code == 422 and _code(r) == "invalid_shape"


def test_patch_point_takes_x_and_y_only(client, ctx):
    b = _post(client, ctx, class_id=ctx["crack"], shape="point", x=5, y=6).json()
    assert _patch(client, ctx, b["id"], x=7).json()["x"] == 7
    assert _code(_patch(client, ctx, b["id"], w=3)) == "invalid_shape"
    assert _code(_patch(client, ctx, b["id"], x=999)) == "out_of_bounds"


def test_patch_updates_updated_at_and_touches(client, ctx, touched):
    b = _post(client, ctx, x=10, y=20, w=30, h=40).json()
    after = _patch(client, ctx, b["id"], x=11).json()
    assert after["updated_at"] >= b["updated_at"]
    assert touched == [ctx["image_id"], ctx["image_id"]]


def test_delete_touches(client, ctx, touched):
    b = _post(client, ctx, x=10, y=20, w=30, h=40).json()
    assert client.delete(f"{ctx['base']}/boxes/{b['id']}").status_code == 204
    assert touched == [ctx["image_id"], ctx["image_id"]]


def test_list_answers_plain_boxes(client, ctx):
    _post(client, ctx, shape="polygon", points=SQUARE)
    [item] = client.get(f"{ctx['base']}/images/{ctx['image_id']}/boxes").json()["items"]
    assert item["shape"] == "polygon" and "repaired" not in item and "finding_id" not in item


def test_per_image_cap(client, ctx, monkeypatch):
    from app.imagery import annotations

    monkeypatch.setattr(annotations, "PER_IMAGE_CAP", 2)
    assert _post(client, ctx, x=1, y=1, w=5, h=5).status_code == 201
    assert _post(client, ctx, x=1, y=1, w=5, h=5).status_code == 201
    r = _post(client, ctx, x=1, y=1, w=5, h=5)
    assert r.status_code == 422 and _code(r) == "too_many_annotations"


def test_unknown_and_archived_types_are_unknown_type(client, ctx):
    assert _code(_post(client, ctx, class_id="no-such-type", x=1, y=1, w=5, h=5)) == "unknown_type"
    r = client.patch(f"{API}/catalogue/types/{ctx['crack']}", json={"archived": True})
    assert r.status_code == 200, r.text
    r = _post(client, ctx, class_id=ctx["crack"], x=1, y=1, w=5, h=5)
    assert r.status_code == 422 and _code(r) == "unknown_type"


def test_marking_empty_touches_images_whose_proposals_were_rejected(client, ctx, handle, touched):
    with handle.session() as s:
        s.add(
            Box(
                image_id=ctx["image_id"],
                class_id=ctx["truck"],
                x=1,
                y=1,
                w=5,
                h=5,
                provenance_kind="local_model",
                review_state="unreviewed",
            )
        )
    r = client.post(
        f"{ctx['base']}/images/bulk-mark-empty", json={"image_ids": [ctx["image_id"]], "marked_empty": True}
    )
    assert r.status_code == 200, r.text
    assert ctx["image_id"] in touched


def test_polygon_on_a_defect_type_is_an_open_finding_and_leaves_with_its_box(client, ctx):
    b = _post(client, ctx, class_id=ctx["crack"], shape="polygon", points=SQUARE).json()
    [f] = client.get(f"{ctx['base']}/findings").json()["items"]
    assert (f["id"], f["status"]) == (b["finding_id"], "open")
    assert client.delete(f"{ctx['base']}/boxes/{b['id']}").status_code == 204
    assert client.get(f"{ctx['base']}/findings").json()["items"] == []


def test_polygon_retyped_to_an_object_needs_confirmation(client, ctx):
    b = _post(client, ctx, class_id=ctx["crack"], shape="polygon", points=SQUARE).json()
    r = _patch(client, ctx, b["id"], class_id=ctx["truck"])
    assert r.status_code == 409 and _code(r) == "finding_would_be_deleted"
    r = _patch(client, ctx, b["id"], params={"confirm_finding_delete": True}, class_id=ctx["truck"])
    assert r.status_code == 200 and r.json()["finding_id"] is None


def test_deleting_a_point_finding_deletes_the_point(client, ctx):
    b = _post(client, ctx, class_id=ctx["crack"], shape="point", x=5, y=6).json()
    assert client.delete(f"{ctx['base']}/findings/{b['finding_id']}").status_code == 204
    assert client.get(f"{ctx['base']}/images/{ctx['image_id']}/boxes").json()["items"] == []


def test_a_point_finding_has_a_thumbnail(client, ctx):
    b = _post(client, ctx, class_id=ctx["crack"], shape="point", x=5, y=6).json()
    r = client.get(f"{ctx['base']}/findings/{b['finding_id']}/thumbnail")
    assert r.status_code == 200 and r.headers["content-type"] == "image/jpeg"


def test_finding_create_with_a_rotated_box_anchor_recomputes_shape_and_area(client, ctx, handle):
    r = client.post(
        f"{ctx['base']}/findings",
        json={
            "type_id": ctx["crack"],
            "anchor": {
                "kind": "image",
                "image_id": ctx["image_id"],
                "box": {"x": 10, "y": 20, "w": 30, "h": 40, "angle": 30},
            },
        },
    )
    assert r.status_code == 201, r.text
    annotation_id = r.json()["anchor"]["annotation_id"]
    with handle.session() as s:
        box = s.get(Box, annotation_id)
        assert (box.shape, box.area_px) == ("rbox", 30 * 40)


def test_single_image_mark_empty_touches_only_when_a_proposal_was_rejected(client, ctx, handle, touched):
    r = client.patch(f"{ctx['base']}/images/{ctx['image_id']}", json={"marked_empty": True})
    assert r.status_code == 200, r.text
    assert touched == []

    with handle.session() as s:
        s.add(
            Box(
                image_id=ctx["image_id"],
                class_id=ctx["truck"],
                x=1,
                y=1,
                w=5,
                h=5,
                provenance_kind="local_model",
                review_state="unreviewed",
            )
        )
    r = client.patch(f"{ctx['base']}/images/{ctx['image_id']}", json={"marked_empty": False})
    assert r.status_code == 200, r.text
    touched.clear()

    r = client.patch(f"{ctx['base']}/images/{ctx['image_id']}", json={"marked_empty": True})
    assert r.status_code == 200, r.text
    assert touched == [ctx["image_id"]]


def test_unknown_type_details_name_the_bad_class_id(client, ctx):
    r = _post(client, ctx, class_id="no-such-type", x=1, y=1, w=5, h=5)
    assert r.status_code == 422
    assert r.json()["error"]["details"] == {"type_ids": ["no-such-type"]}


def test_patch_same_class_id_on_an_archived_type_is_still_allowed(client, ctx):
    b = _post(client, ctx, x=10, y=20, w=30, h=40).json()
    r = client.patch(f"{API}/catalogue/types/{ctx['truck']}", json={"archived": True})
    assert r.status_code == 200, r.text
    r = _patch(client, ctx, b["id"], x=11, class_id=ctx["truck"])
    assert r.status_code == 200, r.text
