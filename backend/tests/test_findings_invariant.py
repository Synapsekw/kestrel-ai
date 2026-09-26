"""An annotation on a defect type IS a finding's geometry (spec 2026-09-26-foundation section 8.5;
umbrella section 3). Every row of the section 8.5 table, through the real box routes."""

from io import BytesIO

import pytest
from PIL import Image as PILImage
from sqlalchemy import delete, select
from sqlalchemy.exc import IntegrityError

from app.db.models import Activity, Box, FindingCount, QueryRun

API = "/api/v1"


@pytest.fixture
def ctx(client, project, crack, import_source, tmp_path, make_jpeg) -> dict:
    """One 320x240 image with a GPS fix, the defect type `crack` and the object type `dump_truck`."""
    folder = tmp_path / "frames"
    make_jpeg(folder / "S_0001_0001.jpg", 320, 240, seed=1, exif={"lat": 45.1, "lon": 15.2})
    import_source(project["id"], folder)
    base = f"{API}/projects/{project['id']}"
    image_id = client.get(f"{base}/images").json()["items"][0]["id"]
    return {"base": base, "image_id": image_id, "crack": crack["id"], "truck": project["classes"][3]["id"]}


def _box(client, ctx, class_id: str, **kw) -> dict:
    body = {"class_id": class_id, "x": 10, "y": 20, "w": 30, "h": 40, **kw}
    r = client.post(f"{ctx['base']}/images/{ctx['image_id']}/boxes", json=body)
    assert r.status_code == 201, r.text
    return r.json()


def _proposal(handle, ctx, class_id: str, model_id: str = "m1") -> str:
    with handle.session() as s:
        row = Box(
            image_id=ctx["image_id"],
            class_id=class_id,
            x=5,
            y=5,
            w=20,
            h=20,
            confidence=0.7,
            provenance_kind="local_model",
            model_id=model_id,
            model_name="yolo11m",
            review_state="unreviewed",
        )
        s.add(row)
        s.flush()
        return row.id


def _findings(client, ctx) -> list[dict]:
    return client.get(f"{ctx['base']}/findings", params={"sort": "number"}).json()["items"]


def _review(client, ctx, ids: list[str], action: str) -> None:
    r = client.post(f"{ctx['base']}/boxes/review", json={"box_ids": ids, "action": action})
    assert r.status_code == 200, r.text


def test_a_person_box_on_a_defect_type_is_an_open_finding(client, ctx):
    box = _box(client, ctx, ctx["crack"])
    [f] = _findings(client, ctx)
    assert (f["status"], f["created_by"], f["severity"], f["confidence"]) == ("open", "human", 2, None)
    assert f["anchor"] == {"kind": "image", "image_id": ctx["image_id"], "annotation_id": box["id"]}
    assert (round(f["lon"], 3), round(f["lat"], 3)) == (15.2, 45.1)


def test_a_box_on_an_object_type_and_a_pending_proposal_are_no_findings(client, handle, ctx):
    _box(client, ctx, ctx["truck"])
    _proposal(handle, ctx, ctx["crack"])
    assert _findings(client, ctx) == []


def test_accepting_defect_proposals_makes_reviewed_findings_and_one_activity_row(client, handle, ctx):
    ids = [_proposal(handle, ctx, ctx["crack"]), _proposal(handle, ctx, ctx["crack"], model_id="m2")]
    _review(client, ctx, ids, "accept")
    found = _findings(client, ctx)
    assert sorted((f["status"], f["created_by"], f["confidence"]) for f in found) == [
        ("reviewed", "model:m1", 0.7),
        ("reviewed", "model:m2", 0.7),
    ]
    with handle.session() as s:
        rows = s.execute(select(Activity).where(Activity.kind == "detections.accepted")).scalars().all()
    assert len(rows) == 1 and rows[0].payload["count"] == 2


def test_editing_a_defect_proposal_makes_a_reviewed_finding(client, handle, ctx):
    bid = _proposal(handle, ctx, ctx["crack"])
    assert client.patch(f"{ctx['base']}/boxes/{bid}", json={"w": 25}).status_code == 200
    [f] = _findings(client, ctx)
    assert (f["status"], f["created_by"]) == ("reviewed", "model:m1")


def test_a_reclass_to_another_defect_type_moves_the_finding(client, ctx):
    from findings_helpers import add_type

    rust = add_type(client, "rust")
    box = _box(client, ctx, ctx["crack"])
    client.put(
        f"{ctx['base']}/types",
        json={"type_ids": [c["id"] for c in client.get(ctx["base"]).json()["classes"]] + [rust["id"]]},
    )
    assert client.patch(f"{ctx['base']}/boxes/{box['id']}", json={"class_id": rust["id"]}).status_code == 200
    [f] = _findings(client, ctx)
    assert (f["type_id"], f["number"]) == (rust["id"], 1)


def test_a_reclass_to_an_object_type_needs_confirmation(client, ctx):
    box = _box(client, ctx, ctx["crack"])
    r = client.patch(f"{ctx['base']}/boxes/{box['id']}", json={"class_id": ctx["truck"]})
    assert (r.status_code, r.json()["error"]["code"]) == (409, "finding_would_be_deleted")
    assert len(_findings(client, ctx)) == 1
    r = client.patch(
        f"{ctx['base']}/boxes/{box['id']}",
        params={"confirm_finding_delete": "true"},
        json={"class_id": ctx["truck"]},
    )
    assert r.status_code == 200 and r.json()["class_id"] == ctx["truck"]
    assert _findings(client, ctx) == []


def test_a_reclass_of_a_ground_truth_box_to_a_defect_type_makes_a_finding(client, ctx):
    box = _box(client, ctx, ctx["truck"])
    client.patch(f"{ctx['base']}/boxes/{box['id']}", json={"class_id": ctx["crack"]})
    [f] = _findings(client, ctx)
    assert (f["status"], f["anchor"]["annotation_id"]) == ("open", box["id"])


def test_moving_a_box_leaves_its_finding_alone(client, ctx):
    box = _box(client, ctx, ctx["crack"])
    before = _findings(client, ctx)
    client.patch(f"{ctx['base']}/boxes/{box['id']}", json={"x": 50, "y": 60})
    after = _findings(client, ctx)
    assert [(f["id"], f["number"]) for f in after] == [(f["id"], f["number"]) for f in before]


def test_a_type_flipped_to_object_keeps_its_findings_through_a_geometry_edit(client, ctx):
    """Spec section 7.2 (defect -> object keeps existing findings) and section 8.5 (geometry edited
    -> nothing): only a class change of the box itself can delete its finding."""
    box = _box(client, ctx, ctx["crack"])
    [before] = _findings(client, ctx)
    r = client.patch(f"{API}/catalogue/types/{ctx['crack']}", json={"kind": "object"})
    assert r.status_code == 200, r.text
    r = client.patch(f"{ctx['base']}/boxes/{box['id']}", json={"x": 50, "y": 60, "angle": 10})
    assert r.status_code == 200, r.text
    assert [f["id"] for f in _findings(client, ctx)] == [before["id"]]


def test_deleting_the_box_deletes_its_finding_and_bins_its_photos(client, handle, ctx, tmp_path, make_jpeg):
    box = _box(client, ctx, ctx["crack"])
    [f] = _findings(client, ctx)
    client.post(
        f"{ctx['base']}/findings/{f['id']}/attachments",
        json={"path": str(make_jpeg(tmp_path / "p.jpg", 64, 48))},
    )
    assert client.delete(f"{ctx['base']}/boxes/{box['id']}").status_code == 204
    assert _findings(client, ctx) == []
    assert list((handle.folder / "findings" / "_trash").glob(f"{f['id']}-*"))


def test_deleting_the_finding_deletes_its_box(client, ctx):
    _box(client, ctx, ctx["crack"])
    [f] = _findings(client, ctx)
    assert client.delete(f"{ctx['base']}/findings/{f['id']}").status_code == 204
    assert client.get(f"{ctx['base']}/images/{ctx['image_id']}/boxes").json()["items"] == []


def test_unreviewing_an_accepted_defect_removes_its_finding(client, handle, ctx, tmp_path, make_jpeg):
    bid = _proposal(handle, ctx, ctx["crack"])
    _review(client, ctx, [bid], "accept")
    [f] = _findings(client, ctx)
    client.post(f"{ctx['base']}/findings/{f['id']}/comments", json={"text": "check on site"})
    photo = make_jpeg(tmp_path / "site.jpg", 64, 48)
    r = client.post(f"{ctx['base']}/findings/{f['id']}/attachments", json={"path": str(photo)})
    assert r.status_code == 201, r.text
    _review(client, ctx, [bid], "unreview")
    assert _findings(client, ctx) == []
    [binned] = (handle.folder / "findings" / "_trash").glob(f"{f['id']}-*")
    assert [p for p in binned.rglob("*") if p.is_file()]  # the photo is recoverable from the trash
    _review(client, ctx, [bid], "accept")
    assert [g["number"] for g in _findings(client, ctx)] == [2]


def test_rejecting_an_accepted_defect_removes_its_finding(client, handle, ctx):
    bid = _proposal(handle, ctx, ctx["crack"])
    _review(client, ctx, [bid], "accept")
    _review(client, ctx, [bid], "reject")
    assert _findings(client, ctx) == []


def test_bulk_image_delete_takes_the_findings_along(client, handle, ctx):
    _box(client, ctx, ctx["crack"])
    r = client.post(f"{ctx['base']}/images/bulk-delete", json={"image_ids": [ctx["image_id"]]})
    assert r.status_code == 200, r.text
    assert _findings(client, ctx) == []
    with handle.session() as s:
        assert [row for row in s.execute(select(FindingCount)).scalars() if row.n] == []


def test_an_unhooked_box_delete_fails_loudly(client, handle, ctx):
    box = _box(client, ctx, ctx["crack"])
    with pytest.raises(IntegrityError), handle.session() as s:
        s.execute(delete(Box).where(Box.id == box["id"]))


def test_post_findings_with_box_geometry_draws_the_box(client, ctx):
    body = {
        "type_id": ctx["crack"],
        "anchor": {"kind": "image", "image_id": ctx["image_id"], "box": {"x": 1, "y": 2, "w": 30, "h": 20}},
    }
    r = client.post(f"{ctx['base']}/findings", json=body)
    assert r.status_code == 201, r.text
    [box] = client.get(f"{ctx['base']}/images/{ctx['image_id']}/boxes").json()["items"]
    assert (box["id"], box["class_id"], box["review_state"]) == (
        r.json()["anchor"]["annotation_id"],
        ctx["crack"],
        "accepted",
    )
    assert len(_findings(client, ctx)) == 1


def test_post_findings_on_an_existing_annotation(client, handle, ctx):
    truck_box = _box(client, ctx, ctx["truck"])
    anchor = {"kind": "image", "image_id": ctx["image_id"], "annotation_id": truck_box["id"]}
    r = client.post(f"{ctx['base']}/findings", json={"type_id": ctx["crack"], "anchor": anchor})
    assert r.status_code == 201, r.text
    boxes = client.get(f"{ctx['base']}/images/{ctx['image_id']}/boxes").json()["items"]
    assert boxes[0]["class_id"] == ctx["crack"]
    again = client.post(f"{ctx['base']}/findings", json={"type_id": ctx["crack"], "anchor": anchor})
    assert (again.status_code, again.json()["error"]["code"]) == (409, "conflict")
    pending = {
        "kind": "image",
        "image_id": ctx["image_id"],
        "annotation_id": _proposal(handle, ctx, ctx["truck"]),
    }
    r = client.post(f"{ctx['base']}/findings", json={"type_id": ctx["crack"], "anchor": pending})
    assert (r.status_code, r.json()["error"]["code"]) == (409, "annotation_not_reviewed")


def test_changing_an_image_findings_type_moves_its_box(client, ctx):
    from findings_helpers import add_type

    rust = add_type(client, "rust")
    box = _box(client, ctx, ctx["crack"])
    [f] = _findings(client, ctx)
    assert client.patch(f"{ctx['base']}/findings/{f['id']}", json={"type_id": rust["id"]}).status_code == 200
    [moved] = client.get(f"{ctx['base']}/images/{ctx['image_id']}/boxes").json()["items"]
    assert (moved["id"], moved["class_id"]) == (box["id"], rust["id"])


def test_an_image_finding_has_a_crop_thumbnail(client, ctx):
    _box(client, ctx, ctx["crack"])
    [f] = _findings(client, ctx)
    r = client.get(f"{ctx['base']}/findings/{f['id']}/thumbnail")
    assert r.status_code == 200
    assert PILImage.open(BytesIO(r.content)).size == (160, 120)


def _run_with_proposals(handle, ctx, n: int = 2) -> tuple[str, list[str]]:
    """A photo run over the image with `n` pending crack detections of 0.9."""
    with handle.session() as s:
        run = QueryRun(
            kind="cloud_provider",
            provider="anthropic",
            model_name="claude-opus-5",
            query="cracks",
            image_ids=[ctx["image_id"]],
            tiling={"enabled": False, "tile_size": 1280, "overlap": 0.2, "nms_iou": 0.5},
            conf=0.25,
        )
        s.add(run)
        s.flush()
        rows = [
            Box(
                image_id=ctx["image_id"],
                class_id=ctx["crack"],
                x=5 + 30 * i,
                y=5,
                w=20,
                h=20,
                confidence=0.9,
                provenance_kind="cloud_provider",
                provider="anthropic",
                review_state="unreviewed",
                query_run_id=run.id,
            )
            for i in range(n)
        ]
        s.add_all(rows)
        s.flush()
        return run.id, [r.id for r in rows]


def _open_count(handle) -> int:
    with handle.session() as s:
        return sum(row.n for row in s.execute(select(FindingCount)).scalars())


def test_promoting_a_run_makes_its_defect_detections_findings(client, handle, ctx):
    run_id, box_ids = _run_with_proposals(handle, ctx)
    r = client.post(f"{ctx['base']}/query-runs/{run_id}/promote", json={"min_confidence": 0.5})
    assert r.status_code == 200 and r.json()["accepted"] == 2, r.text
    found = _findings(client, ctx)
    assert sorted(f["anchor"]["annotation_id"] for f in found) == sorted(box_ids)
    assert {(f["status"], f["created_by"]) for f in found} == {("reviewed", "model:anthropic")}
    assert _open_count(handle) == 2
    with handle.session() as s:
        rows = s.execute(select(Activity).where(Activity.kind == "detections.accepted")).scalars().all()
    assert len(rows) == 1 and rows[0].payload["count"] == 2


def test_unpromoting_a_run_removes_its_findings_and_bins_their_photos(
    client, handle, ctx, tmp_path, make_jpeg
):
    run_id, _ = _run_with_proposals(handle, ctx)
    client.post(f"{ctx['base']}/query-runs/{run_id}/promote", json={})
    f = _findings(client, ctx)[0]
    photo = make_jpeg(tmp_path / "p.jpg", 64, 48)
    assert (
        client.post(f"{ctx['base']}/findings/{f['id']}/attachments", json={"path": str(photo)}).status_code
        == 201
    )
    r = client.post(f"{ctx['base']}/query-runs/{run_id}/unpromote")
    assert r.status_code == 200 and r.json()["reverted"] == 2, r.text
    assert _findings(client, ctx) == []
    assert _open_count(handle) == 0
    assert list((handle.folder / "findings" / "_trash").glob(f"{f['id']}-*"))
