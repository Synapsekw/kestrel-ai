"""Marking images empty: `marked_empty`, `labeled` semantics, the marking service and routes,
and how ground truth clears the mark (spec section 6, walk-through item E4).
"""

from __future__ import annotations

import sqlite3

import pytest
from alembic import command
from alembic.config import Config

from app.db.models import Box, Image
from app.db.session import MIGRATIONS

BASE = "/api/v1/projects"
FLIGHTS = ("0001", "0002")


@pytest.fixture
def image_ids(client, project, import_source, tmp_path, make_jpeg) -> list[str]:
    """20 imported frames, ids ordered by path (mirrors `test_images.py`'s `imported` fixture)."""
    folder = tmp_path / "frames"
    for i in range(20):
        flight, frame = FLIGHTS[i // 10], i % 10 + 1
        make_jpeg(folder / f"S_{flight}_{frame:04d}.jpg", 320, 240, seed=i)
    import_source(project["id"], folder)
    page = client.get(f"{BASE}/{project['id']}/images", params={"limit": 100, "sort": "path"}).json()
    return [i["id"] for i in page["items"]]


def _mark(handle, image_id, value=True):
    with handle.session() as s:
        s.get(Image, image_id).marked_empty = value


@pytest.fixture
def add_proposal(handle, project_id):
    """A pending model proposal on an image, returning its id."""

    def _add(image_id, confidence=0.4) -> str:
        with handle.session() as s:
            box = Box(
                image_id=image_id,
                class_id="whatever",
                x=1,
                y=2,
                w=3,
                h=4,
                confidence=confidence,
                provenance_kind="local_model",
                review_state="unreviewed",
            )
            s.add(box)
            s.flush()
            box_id = box.id
        return box_id

    return _add


@pytest.fixture
def add_person_box(client, project_id, project):
    """A person-drawn (accepted) box on an image through the real endpoint."""

    def _add(image_id) -> str:
        class_id = project["classes"][0]["id"]
        r = client.post(
            f"{BASE}/{project_id}/images/{image_id}/boxes",
            json={"class_id": class_id, "x": 1, "y": 2, "w": 3, "h": 4},
        )
        assert r.status_code == 201, r.text
        return r.json()["id"]

    return _add


def state_of(handle, box_id) -> str:
    with handle.session() as s:
        return s.get(Box, box_id).review_state


def test_a_marked_image_counts_as_labeled_everywhere(client, project_id, handle, image_ids):
    _mark(handle, image_ids[0])
    row = client.get(f"{BASE}/{project_id}/images/{image_ids[0]}").json()
    assert row["marked_empty"] is True and row["labeled"] is True and row["box_count"] == 0
    other = client.get(f"{BASE}/{project_id}/images/{image_ids[1]}").json()
    assert other["marked_empty"] is False and other["labeled"] is False

    labeled = client.get(f"{BASE}/{project_id}/images", params={"labeled": "true"}).json()
    assert [i["id"] for i in labeled["items"]] == [image_ids[0]]
    unlabeled = client.get(f"{BASE}/{project_id}/images", params={"labeled": "false"}).json()
    assert image_ids[0] not in [i["id"] for i in unlabeled["items"]]

    stats = client.get(f"{BASE}/{project_id}/stats").json()
    assert stats["labeled_count"] == 1
    assert stats["unlabeled_count"] == len(image_ids) - 1


def test_an_existing_database_gains_the_column_with_false(tmp_path):
    """Open a project created at revision 0001, upgrade, and read `marked_empty` = 0 for old rows."""
    db_path = tmp_path / "project.db"
    url = f"sqlite:///{db_path.as_posix()}"
    cfg = Config(str(MIGRATIONS / "alembic.ini"))
    cfg.set_main_option("script_location", str(MIGRATIONS))
    cfg.set_main_option("sqlalchemy.url", url)
    command.upgrade(cfg, "0001")

    conn = sqlite3.connect(db_path)
    try:
        conn.execute(
            "INSERT INTO source (id, folder, site, settings, image_count, duplicate_count, "
            "job_id, imported_at, created_at) VALUES "
            "('s1', 'f', 'site', '{}', 0, 0, NULL, NULL, '2024-01-01 00:00:00')"
        )
        conn.execute(
            "INSERT INTO image (id, path, width, height, source_id, capture_time, lat, lon, "
            "alt, phash, group_key, created_at) VALUES "
            "('i1', 'images/a.jpg', 10, 10, 's1', NULL, NULL, NULL, NULL, NULL, '', "
            "'2024-01-01 00:00:00')"
        )
        conn.commit()
    finally:
        conn.close()

    command.upgrade(cfg, "head")

    conn = sqlite3.connect(db_path)
    try:
        value = conn.execute("SELECT marked_empty FROM image WHERE id = 'i1'").fetchone()[0]
    finally:
        conn.close()
    assert value == 0


def test_marking_rejects_the_pending_proposals_and_unmarking_keeps_them_rejected(
    client, project_id, handle, image_ids, add_proposal
):
    box_id = add_proposal(image_ids[0], confidence=0.4)
    r = client.patch(f"{BASE}/{project_id}/images/{image_ids[0]}", json={"marked_empty": True})
    assert r.status_code == 200, r.text
    assert r.json()["marked_empty"] is True and r.json()["pending_count"] == 0
    assert state_of(handle, box_id) == "rejected"
    r = client.patch(f"{BASE}/{project_id}/images/{image_ids[0]}", json={"marked_empty": False})
    assert r.json()["marked_empty"] is False and r.json()["labeled"] is False
    assert state_of(handle, box_id) == "rejected"


def test_an_image_with_ground_truth_cannot_be_marked_empty(client, project_id, image_ids, add_person_box):
    add_person_box(image_ids[0])
    r = client.patch(f"{BASE}/{project_id}/images/{image_ids[0]}", json={"marked_empty": True})
    assert r.status_code == 409 and r.json()["error"]["code"] == "conflict"
    assert "accepted box" in r.json()["error"]["message"]
    assert client.patch(f"{BASE}/{project_id}/images/nope", json={"marked_empty": True}).status_code == 404


def test_bulk_marks_the_empty_ones_and_skips_images_with_ground_truth(
    client, project_id, image_ids, add_person_box
):
    add_person_box(image_ids[1])
    r = client.post(
        f"{BASE}/{project_id}/images/bulk-mark-empty",
        json={"image_ids": [image_ids[0], image_ids[1], "unknown"], "marked_empty": True},
    )
    assert r.status_code == 200, r.text
    assert r.json() == {"updated": 1, "skipped": 1}
    r = client.post(
        f"{BASE}/{project_id}/images/bulk-mark-empty",
        json={"image_ids": [image_ids[0]], "marked_empty": True},
    )
    assert r.json() == {"updated": 0, "skipped": 0}  # already marked: nothing changed


def test_marking_empty_publishes_images_changed_and_boxes_changed(
    client, app, project_id, image_ids, add_proposal
):
    add_proposal(image_ids[0])
    seen = []
    app.state.events.publish = lambda event: seen.append(event)
    r = client.patch(f"{BASE}/{project_id}/images/{image_ids[0]}", json={"marked_empty": True})
    assert r.status_code == 200, r.text
    images_changed = [e for e in seen if e["type"] == "images.changed"]
    boxes_changed = [e for e in seen if e["type"] == "boxes.changed"]
    assert [e["payload"]["image_ids"] for e in images_changed] == [[image_ids[0]]]
    assert [e["payload"]["image_ids"] for e in boxes_changed] == [[image_ids[0]]]


def test_bulk_marking_empty_publishes_events_for_the_whole_request(
    client, app, project_id, image_ids, add_proposal
):
    add_proposal(image_ids[0])
    seen = []
    app.state.events.publish = lambda event: seen.append(event)
    r = client.post(
        f"{BASE}/{project_id}/images/bulk-mark-empty",
        json={"image_ids": [image_ids[0], image_ids[1]], "marked_empty": True},
    )
    assert r.status_code == 200, r.text
    images_changed = [e for e in seen if e["type"] == "images.changed"]
    boxes_changed = [e for e in seen if e["type"] == "boxes.changed"]
    assert images_changed and set(images_changed[0]["payload"]["image_ids"]) == {image_ids[0], image_ids[1]}
    assert boxes_changed and boxes_changed[0]["payload"]["image_ids"] == [image_ids[0]]
