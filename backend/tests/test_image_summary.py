"""image_summary (image inspection spec §7.1, I-D2): a per-image recompute from `box`, never an
increment."""

import re
import sqlite3
from pathlib import Path

import pytest
from image_summary_helpers import add_box, expected_summary, new_image, stored_summary
from sqlalchemy import delete, event, insert, select, update

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
    conn_level = re.compile(
        r"(conn|connection|engine)\w*\.execute\(\s*(insert|update|delete)\(\s*Box(\.__table__)?\b"
    )
    offenders = [
        str(p.relative_to(root))
        for p in root.rglob("*.py")
        if "migrations" not in p.parts
        and (raw.search(p.read_text("utf-8")) or conn_level.search(p.read_text("utf-8")))
    ]
    assert offenders == [], offenders


def _box_row(image_id: str, class_id: str, **cols) -> dict:
    row = dict(image_id=image_id, class_id=class_id, x=1, y=1, w=5, h=5, provenance_kind="person")
    return {**row, "review_state": "accepted", **cols}


def test_recompute_is_one_insert_select_statement(handle, cls):
    """Final review Important-1: the aggregate and the upsert are one statement, so no box write can
    commit between reading the aggregate and writing it back (the rebuild runs outside the lock)."""
    image_id = new_image(handle)
    add_box(handle, image_id, cls[1], state="unreviewed", conf=0.4)
    seen: list[str] = []

    def spy(_conn, _cursor, statement, *_):
        seen.append(" ".join(statement.split()).upper())

    with handle.session() as s:
        s.flush()
        conn = s.connection()
        event.listen(conn, "before_cursor_execute", spy)
        try:
            summary.touch_many(conn, [image_id, "no-such-image"])
        finally:
            event.remove(conn, "before_cursor_execute", spy)
    assert len(seen) == 2, seen  # the upsert, and the delete of ids without an image
    assert seen[0].startswith("INSERT INTO IMAGE_SUMMARY") and "LEFT OUTER JOIN BOX" in seen[0]
    assert "ON CONFLICT" in seen[0]
    assert seen[1].startswith("DELETE FROM IMAGE_SUMMARY")
    assert not any(q.startswith("SELECT") for q in seen)
    assert stored_summary(handle, image_id) == (0, 1, 0.4)


def test_moving_a_box_to_another_image_recomputes_both(handle, cls):
    """Final review Minor-1: the ORM attribute change recomputes the old image too."""
    a, b = new_image(handle), new_image(handle)
    box_id = add_box(handle, a, cls[1], state="unreviewed", conf=0.7)
    with handle.session() as s:
        s.get(Box, box_id).image_id = b
    assert stored_summary(handle, a) == expected_summary(handle, a) == (0, 0, None)
    assert stored_summary(handle, b) == expected_summary(handle, b) == (0, 1, 0.7)


def test_bulk_update_moving_boxes_recomputes_both(handle, cls):
    a, b = new_image(handle), new_image(handle)
    add_box(handle, a, cls[0])
    add_box(handle, a, cls[1], state="unreviewed", conf=0.2)
    with handle.session() as s:
        s.execute(update(Box).where(Box.image_id == a).values(image_id=b))
    assert stored_summary(handle, a) == expected_summary(handle, a) == (0, 0, None)
    assert stored_summary(handle, b) == expected_summary(handle, b) == (1, 1, 0.2)


def test_table_level_bulk_delete_recomputes(handle, cls):
    """Final review Minor-2: `delete(Box.__table__)` has no bind mapper but is still a box write."""
    image_id = new_image(handle)
    add_box(handle, image_id, cls[1], state="unreviewed", conf=0.8)
    with handle.session() as s:
        s.execute(delete(Box.__table__).where(Box.__table__.c.image_id == image_id))
    assert stored_summary(handle, image_id) == (0, 0, None)


def test_orm_bulk_insert_recomputes(handle, cls):
    """Final review Minor-2 (the I-BP hand-off): an ORM bulk INSERT of boxes recomputes their images."""
    a, b = new_image(handle), new_image(handle)
    with handle.session() as s:
        s.execute(
            insert(Box),
            [
                _box_row(a, cls[0]),
                _box_row(a, cls[1], review_state="unreviewed", confidence=0.3),
                _box_row(b, cls[1], review_state="unreviewed", confidence=0.6),
            ],
        )
    assert stored_summary(handle, a) == expected_summary(handle, a) == (1, 1, 0.3)
    assert stored_summary(handle, b) == expected_summary(handle, b) == (0, 1, 0.6)


def test_bulk_update_by_primary_key_recomputes_only_its_images(handle, cls, monkeypatch):
    """Final review Minor-2: an executemany UPDATE by id has no WHERE; it recomputes the images of the
    listed boxes, not every image in the project."""
    a, other = new_image(handle), new_image(handle)
    box_id = add_box(handle, a, cls[1], state="unreviewed", conf=0.5)
    add_box(handle, other, cls[0])
    touched: list[set[str]] = []
    real = summary.touch_many
    monkeypatch.setattr(summary, "touch_many", lambda c, ids: touched.append(set(ids)) or real(c, ids))
    with handle.session() as s:
        s.execute(update(Box), [{"id": box_id, "review_state": "accepted"}])
    assert touched == [{a}]
    assert stored_summary(handle, a) == expected_summary(handle, a) == (1, 0, None)


def test_bulk_probe_runs_under_the_write_lock(handle, cls, monkeypatch):
    """Final review Minor-3: between the probe of matched images and the write, no other connection
    can commit a box write (the probe already holds SQLite's write lock)."""
    image_id = new_image(handle)
    add_box(handle, image_id, cls[1], state="unreviewed", conf=0.8)
    db = handle.engine.url.database
    blocked: list[bool] = []
    real = summary._matched

    def probe_then_try_a_write(c, stmt, params):
        out = real(c, stmt, params)
        other = sqlite3.connect(db, timeout=0, isolation_level=None)
        try:
            other.execute("BEGIN IMMEDIATE")
            blocked.append(False)
            other.rollback()
        except sqlite3.OperationalError as e:
            blocked.append("locked" in str(e))
        finally:
            other.close()
        return out

    monkeypatch.setattr(summary, "_matched", probe_then_try_a_write)
    with handle.session() as s:
        s.execute(delete(Box).where(Box.image_id == image_id))
    assert blocked == [True]
    assert stored_summary(handle, image_id) == (0, 0, None)
