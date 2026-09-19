"""Marking images empty: no machinery here (spec section 6, walk-through item E4).

Marking an image empty rejects its unreviewed proposals in the same transaction (there is nothing
left for a person to review) and is refused while the image has ground-truth boxes. Unmarking only
flips the flag back: it never resurrects the proposals a mark rejected.
"""

from __future__ import annotations

from collections.abc import Iterable
from datetime import UTC, datetime

from sqlalchemy import func, select, update
from sqlalchemy.orm import Session

from app.datasets.images import ImageRow, get_image
from app.db.models import Box, Image
from app.errors import AppError, not_found
from app.projects.service import ProjectHandle

GROUND_TRUTH = ("accepted", "edited")

# SQLite's own limit on bound parameters (`SQLITE_MAX_VARIABLE_NUMBER`) is comfortably above this,
# but a page of ids from the Data Manager can be large; chunking keeps every `IN (...)` bounded.
CHUNK_SIZE = 500


def _chunks(ids: list[str], size: int = CHUNK_SIZE) -> Iterable[list[str]]:
    for i in range(0, len(ids), size):
        yield ids[i : i + size]


def ground_truth_message(n: int) -> str:
    """The one wording used everywhere a mark is refused because of existing ground truth."""
    box_word = "box" if n == 1 else "boxes"
    return f"This image has {n} accepted {box_word}. Delete or reject them first."


def _ground_truth_count(s: Session, image_id: str) -> int:
    return s.execute(
        select(func.count())
        .select_from(Box)
        .where(Box.image_id == image_id, Box.review_state.in_(GROUND_TRUTH))
    ).scalar_one()


def _reject_pending(s: Session, image_id: str, now: datetime) -> bool:
    """Reject the image's unreviewed proposals; return whether any were rejected."""
    pending = list(
        s.execute(select(Box).where(Box.image_id == image_id, Box.review_state == "unreviewed")).scalars()
    )
    for box in pending:
        box.review_state, box.reviewed_at = "rejected", now
    return bool(pending)


def count_marked_empty(s: Session, image_ids: Iterable[str]) -> int:
    """How many of `image_ids` are currently marked empty (for a caller that wants to log it)."""
    ids = list(image_ids)
    if not ids:
        return 0
    return s.execute(
        select(func.count()).select_from(Image).where(Image.id.in_(ids), Image.marked_empty.is_(True))
    ).scalar_one()


def clear_mark_for_ground_truth(s: Session, image_ids: Iterable[str]) -> None:
    """New ground truth on an image contradicts `marked_empty`; clear it in the same session."""
    ids = list(image_ids)
    if not ids:
        return
    s.execute(
        Image.__table__.update()
        .where(Image.id.in_(ids), Image.marked_empty.is_(True))
        .values(marked_empty=False)
    )


def set_marked_empty(handle: ProjectHandle, image_id: str, value: bool) -> tuple[ImageRow, list[str]]:
    with handle.session() as s:
        image = s.get(Image, image_id)
        if image is None:
            raise not_found("image", image_id)
        rejected_ids: list[str] = []
        if value:
            gt = _ground_truth_count(s, image_id)
            if gt:
                raise AppError("conflict", ground_truth_message(gt), 409)
            if _reject_pending(s, image_id, datetime.now(UTC)):
                rejected_ids.append(image_id)
        image.marked_empty = value
        s.flush()
    return get_image(handle, image_id), rejected_ids


def _distinct_image_ids(s: Session, ids: list[str], *, review_state) -> set[str]:
    found: set[str] = set()
    for chunk in _chunks(ids):
        found.update(
            s.execute(
                select(Box.image_id).where(Box.image_id.in_(chunk), review_state).distinct()
            )
            .scalars()
            .all()
        )
    return found


def bulk_mark_empty(handle: ProjectHandle, image_ids: list[str], value: bool) -> tuple[int, int, list[str]]:
    """Updated, skipped (ground truth), and the ids whose pending proposals were rejected.

    Set-based throughout: a handful of bulk queries and bulk updates over the whole id list
    (chunked), never a per-image round trip.
    """
    now = datetime.now(UTC)
    with handle.session() as s:
        existing: dict[str, bool] = {}
        for chunk in _chunks(image_ids):
            existing.update(s.execute(select(Image.id, Image.marked_empty).where(Image.id.in_(chunk))).all())
        known_ids = [i for i in image_ids if i in existing]  # unknown ids are ignored

        if not value:
            to_unmark = [i for i in known_ids if existing[i]]
            for chunk in _chunks(to_unmark):
                s.execute(update(Image).where(Image.id.in_(chunk)).values(marked_empty=False))
            return len(to_unmark), 0, []

        candidates = [i for i in known_ids if not existing[i]]  # already marked: nothing changed
        has_ground_truth = _distinct_image_ids(s, candidates, review_state=Box.review_state.in_(GROUND_TRUTH))
        to_mark = [i for i in candidates if i not in has_ground_truth]
        rejected_ids = sorted(_distinct_image_ids(s, to_mark, review_state=Box.review_state == "unreviewed"))
        for chunk in _chunks(to_mark):
            s.execute(
                update(Box)
                .where(Box.image_id.in_(chunk), Box.review_state == "unreviewed")
                .values(review_state="rejected", reviewed_at=now)
            )
        for chunk in _chunks(to_mark):
            s.execute(update(Image).where(Image.id.in_(chunk)).values(marked_empty=True))
        return len(to_mark), len(has_ground_truth), rejected_ids
