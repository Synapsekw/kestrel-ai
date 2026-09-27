"""Review extras (spec 2026-09-26-image-inspection section 8.3)."""

import pytest
from sqlalchemy import select

from app.db.models import Box, Image

API = "/api/v1"


@pytest.fixture
def ctx(client, project, crack, import_source, tmp_path, make_jpeg) -> dict:
    folder = tmp_path / "frames"
    make_jpeg(folder / "S_0001_0001.jpg", 320, 240, seed=1)
    import_source(project["id"], folder)
    base = f"{API}/projects/{project['id']}"
    image_id = client.get(f"{base}/images").json()["items"][0]["id"]
    return {"base": base, "image_id": image_id, "crack": crack["id"], "truck": project["classes"][3]["id"]}


def _proposal(handle, ctx, class_id: str) -> str:
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
            model_id="m1",
            model_name="yolo11m",
            review_state="unreviewed",
        )
        s.add(row)
        s.flush()
        return row.id


def _review(client, ctx, ids, action):
    return client.post(f"{ctx['base']}/boxes/review", json={"box_ids": ids, "action": action})


def _findings(client, ctx):
    return client.get(f"{ctx['base']}/findings").json()["items"]


def _states(handle) -> dict:
    with handle.session() as s:
        return dict(s.execute(select(Box.id, Box.review_state)).all())


def test_accept_returns_created_finding_ids_and_objects_make_none(client, handle, ctx):
    d, o = _proposal(handle, ctx, ctx["crack"]), _proposal(handle, ctx, ctx["truck"])
    r = _review(client, ctx, [d, o], "accept")
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["updated"] == 2
    assert body["finding_ids_created"] == [f["id"] for f in _findings(client, ctx)]
    assert len(body["finding_ids_created"]) == 1 and body["finding_ids_deleted"] == []


def test_reject_returns_deleted_finding_ids(client, handle, ctx):
    d = _proposal(handle, ctx, ctx["crack"])
    [fid] = _review(client, ctx, [d], "accept").json()["finding_ids_created"]
    body = _review(client, ctx, [d], "reject").json()
    assert body["finding_ids_deleted"] == [fid] and _findings(client, ctx) == []


def test_unreview_deletes_an_untouched_finding(client, handle, ctx):
    d = _proposal(handle, ctx, ctx["crack"])
    [fid] = _review(client, ctx, [d], "accept").json()["finding_ids_created"]
    body = _review(client, ctx, [d], "unreview").json()
    assert body == {"updated": 1, "finding_ids_created": [], "finding_ids_deleted": [fid]}
    assert _states(handle)[d] == "unreviewed"


@pytest.mark.parametrize("touch", ["note", "comment", "photo", "severity", "status"])
def test_unreview_refuses_a_finding_with_content(client, handle, ctx, tmp_path, make_jpeg, touch):
    d = _proposal(handle, ctx, ctx["crack"])
    [fid] = _review(client, ctx, [d], "accept").json()["finding_ids_created"]
    f = f"{ctx['base']}/findings/{fid}"
    if touch == "note":
        assert client.patch(f, json={"note": "seen on site"}).status_code == 200
    elif touch == "comment":
        assert client.post(f"{f}/comments", json={"text": "check"}).status_code == 201
    elif touch == "photo":
        photo = make_jpeg(tmp_path / "site.jpg", 64, 48)
        assert client.post(f"{f}/attachments", json={"path": str(photo)}).status_code == 201
    elif touch == "severity":
        assert client.patch(f, json={"severity": 3}).status_code == 200
    else:
        assert client.patch(f, json={"status": "closed"}).status_code == 200
    r = _review(client, ctx, [d], "unreview")
    err = r.json()["error"]
    assert r.status_code == 409 and err["code"] == "finding_has_content"
    assert err["message"] == "This finding has a note or photos; delete it from the inspector."
    assert err["details"]["finding_id"] == fid and err["details"]["finding_ids"] == [fid]
    assert _states(handle)[d] == "accepted" and [x["id"] for x in _findings(client, ctx)] == [fid]


def test_unreview_batch_with_one_touched_finding_changes_nothing(client, handle, ctx):
    a, b = _proposal(handle, ctx, ctx["crack"]), _proposal(handle, ctx, ctx["crack"])
    created = _review(client, ctx, [a, b], "accept").json()["finding_ids_created"]
    client.patch(f"{ctx['base']}/findings/{created[1]}", json={"note": "keep"})
    r = _review(client, ctx, [a, b], "unreview")
    assert r.status_code == 409
    assert _states(handle) == {a: "accepted", b: "accepted"}
    assert len(_findings(client, ctx)) == 2


def test_accept_on_a_marked_empty_image_clears_the_mark(client, handle, ctx):
    d = _proposal(handle, ctx, ctx["truck"])
    with handle.session() as s:
        s.get(Image, ctx["image_id"]).marked_empty = True
    _review(client, ctx, [d], "accept")
    with handle.session() as s:
        assert s.get(Image, ctx["image_id"]).marked_empty is False


def test_review_touches_each_image_once(client, handle, ctx, monkeypatch):
    from app.imagery import summary

    calls = []
    monkeypatch.setattr(summary, "touch", lambda s, image_id: calls.append(image_id))
    ids = [_proposal(handle, ctx, ctx["truck"]) for _ in range(3)]
    _review(client, ctx, ids, "accept")
    assert calls == [ctx["image_id"]]
