"""Photo review status (asset findings spec §5.4 and §8): GET and PUT /images/{imageId}/review, and
`image.marked_empty` kept in step with it both ways."""

import pytest
from findings_helpers import insert_box

from app.asset_review.review_status import set_status
from app.db.models import Box, Image, ImageReview, Source
from app.errors import AppError

API = "/api/v1"


def _photo(handle, *, name: str = "p.jpg", pending: bool = False) -> str:
    """A photo in its own image set; `pending` adds one unreviewed model proposal."""
    with handle.session() as s:
        src = Source(folder=f"C:/flights/{name}", site="A")
        s.add(src)
        s.flush()
        image = Image(path=f"images/{name}", width=100, height=100, source_id=src.id)
        s.add(image)
        s.flush()
        if pending:
            s.add(
                Box(
                    image_id=image.id,
                    class_id="c1",
                    x=0.5,
                    y=0.5,
                    w=0.1,
                    h=0.1,
                    provenance_kind="local_model",
                    review_state="unreviewed",
                )
            )
        return image.id


def _url(project_id: str, image_id: str) -> str:
    return f"{API}/projects/{project_id}/images/{image_id}/review"


def _marked(handle, image_id: str) -> bool:
    with handle.session() as s:
        return s.get(Image, image_id).marked_empty


def test_a_photo_with_no_row_reads_from_its_mark(client, project_id, handle):
    plain, empty = _photo(handle, name="a.jpg"), _photo(handle, name="b.jpg")
    with handle.session() as s:
        s.get(Image, empty).marked_empty = True
    assert client.get(_url(project_id, plain)).json() == {
        "image_id": plain,
        "status": "not_assessed",
        "note": "",
        "coverage": None,
        "uncertain_coverage": None,
        "updated_at": None,
    }
    assert client.get(_url(project_id, empty)).json()["status"] == "none"
    with handle.session() as s:
        assert s.query(ImageReview).count() == 0  # reading writes nothing


def test_put_none_marks_the_photo_empty_and_any_other_status_clears_it(client, project_id, handle):
    image_id = _photo(handle)
    r = client.put(_url(project_id, image_id), json={"status": "none", "note": "clean shaft"})
    assert r.status_code == 200, r.text
    assert (r.json()["status"], r.json()["note"]) == ("none", "clean shaft")
    assert r.json()["updated_at"] is not None
    assert _marked(handle, image_id) is True
    for status in ("uncertain", "finding", "not_assessed"):
        r = client.put(_url(project_id, image_id), json={"status": status})
        assert r.status_code == 200, r.text
        assert (r.json()["status"], r.json()["note"]) == (status, "")
        assert _marked(handle, image_id) is False
    assert client.get(_url(project_id, image_id)).json()["status"] == "not_assessed"


def test_put_none_is_refused_while_the_photo_has_accepted_boxes(client, project_id, handle, crack):
    image_id, _ = insert_box(handle, crack["id"])
    r = client.put(_url(project_id, image_id), json={"status": "none"})
    assert r.status_code == 409, r.text
    assert r.json()["error"]["code"] == "conflict"
    assert "1 accepted box" in r.json()["error"]["message"]
    assert _marked(handle, image_id) is False
    with handle.session() as s:
        assert s.get(ImageReview, image_id) is None  # nothing half written


def test_put_none_rejects_pending_proposals(client, project_id, handle):
    image_id = _photo(handle, pending=True)
    assert client.put(_url(project_id, image_id), json={"status": "none"}).status_code == 200
    with handle.session() as s:
        states = {b.review_state for b in s.query(Box).filter(Box.image_id == image_id)}
    assert states == {"rejected"}


def test_a_mark_set_elsewhere_moves_an_existing_review(client, project_id, handle):
    image_id = _photo(handle)
    assert client.put(_url(project_id, image_id), json={"status": "uncertain"}).status_code == 200
    image_url = f"{API}/projects/{project_id}/images/{image_id}"
    assert client.patch(image_url, json={"marked_empty": True}).status_code == 200
    assert client.get(_url(project_id, image_id)).json()["status"] == "none"
    assert client.patch(image_url, json={"marked_empty": False}).status_code == 200
    assert client.get(_url(project_id, image_id)).json()["status"] == "not_assessed"
    r = client.post(
        f"{API}/projects/{project_id}/images/bulk-mark-empty",
        json={"image_ids": [image_id], "marked_empty": True},
    )
    assert r.status_code == 200, r.text
    assert client.get(_url(project_id, image_id)).json()["status"] == "none"


def test_an_unknown_photo_is_404_and_an_unknown_status_422(client, project_id, handle):
    assert client.get(_url(project_id, "nope")).status_code == 404
    assert client.put(_url(project_id, "nope"), json={"status": "none"}).status_code == 404
    image_id = _photo(handle)
    assert client.put(_url(project_id, image_id), json={"status": "maybe"}).status_code == 422


def test_an_unknown_key_in_the_put_body_is_422(client, project_id, handle):
    image_id = _photo(handle)
    r = client.put(_url(project_id, image_id), json={"status": "none", "notes": "x"})
    assert r.status_code == 422


def test_set_status_writes_in_the_callers_session(handle):
    image_id = _photo(handle)
    with handle.session() as s:
        row = set_status(s, image_id, "none", "from the kit")
        assert (row.status, row.note, s.get(Image, image_id).marked_empty) == ("none", "from the kit", True)
    with handle.session() as s, pytest.raises(AppError) as raised:
        set_status(s, image_id, "maybe")
    assert raised.value.status == 422
