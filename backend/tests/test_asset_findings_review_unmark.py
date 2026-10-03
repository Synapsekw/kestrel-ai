"""Clearing a photo's empty mark moves its `none` review row to `not_assessed` (asset findings spec
§5.4): through the bulk unmark route, and through `clear_mark_for_ground_truth` when a proposal on the
photo is accepted."""

from app.datasets.empties import clear_mark_for_ground_truth
from app.db.models import Box, Image, ImageReview, Source

API = "/api/v1"


def _photo(handle, name: str) -> str:
    with handle.session() as s:
        src = Source(folder=f"C:/flights/{name}", site="A")
        s.add(src)
        s.flush()
        image = Image(path=f"images/{name}", width=100, height=100, source_id=src.id)
        s.add(image)
        s.flush()
        return image.id


def _review_url(project_id: str, image_id: str) -> str:
    return f"{API}/projects/{project_id}/images/{image_id}/review"


def _seed_none(client, project_id: str, image_id: str) -> None:
    r = client.put(_review_url(project_id, image_id), json={"status": "none", "note": "clean"})
    assert r.status_code == 200, r.text
    assert r.json()["status"] == "none"


def _row(handle, image_id: str) -> tuple[str, bool]:
    with handle.session() as s:
        return s.get(ImageReview, image_id).status, s.get(Image, image_id).marked_empty


def test_bulk_unmark_moves_a_none_review_to_not_assessed(client, project_id, handle):
    image_id = _photo(handle, "a.jpg")
    _seed_none(client, project_id, image_id)
    r = client.post(
        f"{API}/projects/{project_id}/images/bulk-mark-empty",
        json={"image_ids": [image_id], "marked_empty": False},
    )
    assert r.status_code == 200, r.text
    assert r.json()["updated"] == 1
    assert _row(handle, image_id) == ("not_assessed", False)
    assert client.get(_review_url(project_id, image_id)).json()["status"] == "not_assessed"


def test_accepting_a_proposal_moves_a_none_review_to_not_assessed(client, project, project_id, handle):
    image_id = _photo(handle, "b.jpg")
    _seed_none(client, project_id, image_id)
    with handle.session() as s:  # a proposal arriving after the mark (a later photo run)
        box = Box(
            image_id=image_id,
            class_id=project["classes"][0]["id"],
            x=0.5,
            y=0.5,
            w=0.1,
            h=0.1,
            provenance_kind="local_model",
            review_state="unreviewed",
        )
        s.add(box)
        s.flush()
        box_id = box.id
    r = client.post(
        f"{API}/projects/{project_id}/boxes/review", json={"box_ids": [box_id], "action": "accept"}
    )
    assert r.status_code == 200, r.text
    assert _row(handle, image_id) == ("not_assessed", False)


def test_clear_mark_for_ground_truth_moves_only_none_rows(client, project_id, handle):
    empty, unsure = _photo(handle, "c.jpg"), _photo(handle, "d.jpg")
    _seed_none(client, project_id, empty)
    assert client.put(_review_url(project_id, unsure), json={"status": "uncertain"}).status_code == 200
    with handle.session() as s:
        clear_mark_for_ground_truth(s, [empty, unsure])
    assert _row(handle, empty) == ("not_assessed", False)
    assert _row(handle, unsure) == ("uncertain", False)
