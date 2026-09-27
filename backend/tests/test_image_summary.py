"""image_summary (image inspection spec §7.1, I-D2): a per-image recompute from `box`, never an
increment."""

import re
from pathlib import Path

import pytest
from image_summary_helpers import add_box, expected_summary, new_image, stored_summary
from sqlalchemy import delete, select, update

import app as app_pkg
from app.db.models import Box, ImageSummary
from app.imagery import summary


@pytest.fixture
def cls(project):
    return [c["id"] for c in project["classes"]]


def test_touch_writes_the_recomputed_row(handle, cls):
    image_id = new_image(handle)
    add_box(handle, image_id, cls[0])
    add_box(handle, image_id, cls[0], state="edited")
    add_box(handle, image_id, cls[1], state="unreviewed", conf=0.4)
    add_box(handle, image_id, cls[1], state="unreviewed", conf=0.9)
    add_box(handle, image_id, cls[1], state="rejected", conf=0.99)
    with handle.session() as s:
        summary.touch(s, image_id)
    assert stored_summary(handle, image_id) == (2, 2, 0.9)


def test_points_are_not_annotations(handle, cls):
    image_id = new_image(handle)
    add_box(handle, image_id, cls[0], shape="point")
    with handle.session() as s:
        summary.touch(s, image_id)
    assert stored_summary(handle, image_id) == (0, 0, None)


def test_touch_replaces_instead_of_adding(handle, cls):
    image_id = new_image(handle)
    add_box(handle, image_id, cls[0])
    with handle.session() as s:
        summary.touch(s, image_id)
        summary.touch(s, image_id)
    assert stored_summary(handle, image_id) == (1, 0, None)
    with handle.session() as s:
        s.query(Box).filter(Box.image_id == image_id).delete()
        summary.touch(s, image_id)
    assert stored_summary(handle, image_id) == (0, 0, None)


def test_touch_sees_unflushed_changes_in_the_same_session(handle, cls):
    image_id = new_image(handle)
    with handle.session() as s:
        s.add(
            Box(
                image_id=image_id,
                class_id=cls[0],
                x=1,
                y=1,
                w=2,
                h=2,
                provenance_kind="person",
                review_state="accepted",
            )
        )
        summary.touch(s, image_id)  # flushes first
        row = s.execute(
            select(ImageSummary.annotation_count).where(ImageSummary.image_id == image_id)
        ).scalar_one()
    assert row == 1


def test_touch_many_handles_more_than_one_chunk(handle, cls, monkeypatch):
    monkeypatch.setattr(summary, "CHUNK", 2)
    ids = [new_image(handle) for _ in range(5)]
    for i in ids:
        add_box(handle, i, cls[0], state="unreviewed", conf=0.5)
    with handle.session() as s:
        assert summary.touch_many(s, ids + ids[:2]) == 5
    assert all(stored_summary(handle, i) == expected_summary(handle, i) == (0, 1, 0.5) for i in ids)


def test_a_wrong_row_is_overwritten(handle, cls):
    """A stale or hand-edited row (or 0011's seed) is replaced by the recompute, never added to."""
    image_id = new_image(handle)
    add_box(handle, image_id, cls[0])
    with handle.session() as s:
        s.merge(ImageSummary(image_id=image_id, annotation_count=99, pending_count=7, max_pending_conf=0.5))
    with handle.session() as s:
        summary.touch(s, image_id)
    assert stored_summary(handle, image_id) == (1, 0, None)


def test_orm_insert_update_delete_recompute_without_touch(handle, cls):
    image_id = new_image(handle)
    box_id = add_box(handle, image_id, cls[1], state="unreviewed", conf=0.6)
    assert stored_summary(handle, image_id) == (0, 1, 0.6)
    with handle.session() as s:
        s.get(Box, box_id).review_state = "accepted"
    assert stored_summary(handle, image_id) == (1, 0, None)
    with handle.session() as s:
        s.delete(s.get(Box, box_id))
    assert stored_summary(handle, image_id) == (0, 0, None)


def test_core_bulk_delete_through_the_session_recomputes(handle, cls):
    """Review Focus 1: the `infer` write deletes old suggestions with an ORM bulk DELETE."""
    image_id = new_image(handle)
    add_box(handle, image_id, cls[1], state="unreviewed", conf=0.8)
    add_box(handle, image_id, cls[0])
    with handle.session() as s:
        s.execute(delete(Box).where(Box.image_id == image_id, Box.review_state == "unreviewed"))
    assert stored_summary(handle, image_id) == expected_summary(handle, image_id) == (1, 0, None)


def test_core_bulk_update_through_the_session_recomputes(handle, cls):
    """`bulk_mark_empty` rejects pending proposals with an ORM bulk UPDATE."""
    a, b = new_image(handle), new_image(handle)
    add_box(handle, a, cls[1], state="unreviewed", conf=0.3)
    add_box(handle, b, cls[1], state="unreviewed", conf=0.7)
    with handle.session() as s:
        s.execute(update(Box).where(Box.image_id.in_([a, b])).values(review_state="rejected"))
    assert stored_summary(handle, a) == stored_summary(handle, b) == (0, 0, None)


def test_bulk_mark_empty_rejects_and_the_summary_follows(client, project, handle, cls):
    image_id = new_image(handle)
    add_box(handle, image_id, cls[1], state="unreviewed", conf=0.5)
    r = client.post(
        f"/api/v1/projects/{project['id']}/images/bulk-mark-empty",
        json={"image_ids": [image_id], "marked_empty": True},
    )
    assert r.status_code == 200, r.text
    assert stored_summary(handle, image_id) == (0, 0, None)


def test_no_box_write_bypasses_the_session():
    """Review Focus 2: raw SQL or connection-level writes to `box` skip the session events."""
    root = Path(app_pkg.__file__).parent
    raw = re.compile(r"(INSERT\s+INTO|UPDATE|DELETE\s+FROM)\s+box\b", re.IGNORECASE)
    conn_level = re.compile(r"(conn|connection|engine)\w*\.execute\(\s*(insert|update|delete)\(\s*Box\b")
    offenders = [
        str(p.relative_to(root))
        for p in root.rglob("*.py")
        if "migrations" not in p.parts
        and (raw.search(p.read_text("utf-8")) or conn_level.search(p.read_text("utf-8")))
    ]
    assert offenders == [], offenders
