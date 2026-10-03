"""Marking images empty: no machinery here (spec section 6, walk-through item E4).

Marking an image empty rejects its unreviewed proposals in the same transaction (there is nothing
left for a person to review) and is refused while the image has ground-truth boxes. Unmarking only
flips the flag back: it never resurrects the proposals a mark rejected.

A photo's review status (`image_review`, asset findings spec §5.4) follows the mark: every path here
that sets or clears it moves an existing review row with `follow_review`, and
`app.asset_review.review_status.set_status` sets the mark through `apply_mark`.
"""

from __future__ import annotations

from collections.abc import Iterable
from datetime import UTC, datetime

from sqlalchemy import func, select, update
from sqlalchemy.orm import Session

from app.datasets.images import ImageRow, get_image
from app.db.base import utcnow
from app.db.models import Box, Image, ImageReview, QueryRun
from app.errors import AppError, not_found
from app.imagery import summary
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


def recount_runs_of(s: Session, image_ids: Iterable[str]) -> None:
    """Rebuild the counts of every photo run with boxes on these images (spec 2026-09-23 section
    9.1), after their pending boxes were rejected, in the same transaction. Grouped counts only."""
    from app.detect.counts import recount_query_run

    ids = list(image_ids)
    run_ids: set[str] = set()
    for chunk in _chunks(ids):
        run_ids.update(
            s.execute(
                select(Box.query_run_id)
                .where(Box.image_id.in_(chunk), Box.query_run_id.is_not(None))
                .distinct()
            ).scalars()
        )
    s.flush()
    for run_id in sorted(run_ids):
        run = s.get(QueryRun, run_id)
        if run is not None:
            recount_query_run(s, run)


def count_marked_empty(s: Session, image_ids: Iterable[str]) -> int:
    """How many of `image_ids` are currently marked empty (for a caller that wants to log it)."""
    ids = list(image_ids)
    if not ids:
        return 0
    return s.execute(
        select(func.count()).select_from(Image).where(Image.id.in_(ids), Image.marked_empty.is_(True))
    ).scalar_one()


def follow_review(s: Session, image_ids: Iterable[str], value: bool) -> None:
    """Move the existing review rows of photos whose mark was just set (`value` True: they read
    `none`) or cleared (a `none` row becomes `not_assessed`). A photo with no row keeps none: its
    status is read from the mark. Chunked, set-based."""
    ids = list(image_ids)
    now = utcnow()
    for chunk in _chunks(ids):
        if value:
            where = (ImageReview.image_id.in_(chunk), ImageReview.status != "none")
            s.execute(update(ImageReview).where(*where).values(status="none", updated_at=now))
        else:
            where = (ImageReview.image_id.in_(chunk), ImageReview.status == "none")
            s.execute(update(ImageReview).where(*where).values(status="not_assessed", updated_at=now))


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
    follow_review(s, ids, False)


def apply_mark(s: Session, image: Image, value: bool, now: datetime) -> bool:
    """Set or clear `image.marked_empty` in the caller's session by this module's rules: marking is
    refused with 409 `conflict` while the image has ground truth, and rejects its pending proposals.
    Returns whether any proposal was rejected (the caller publishes `boxes.changed`)."""
    rejected = False
    if value:
        gt = _ground_truth_count(s, image.id)
        if gt:
            raise AppError("conflict", ground_truth_message(gt), 409)
        if _reject_pending(s, image.id, now):
            rejected = True
            recount_runs_of(s, [image.id])
            summary.touch(s, image.id)
    image.marked_empty = value
    return rejected


def set_marked_empty(handle: ProjectHandle, image_id: str, value: bool) -> tuple[ImageRow, list[str]]:
    with handle.session() as s:
        image = s.get(Image, image_id)
        if image is None:
            raise not_found("image", image_id)
        rejected = apply_mark(s, image, value, datetime.now(UTC))
        follow_review(s, [image_id], value)
        s.flush()
    return get_image(handle, image_id), [image_id] if rejected else []


def _distinct_image_ids(s: Session, ids: list[str], *, review_state) -> set[str]:
    found: set[str] = set()
    for chunk in _chunks(ids):
        found.update(
            s.execute(select(Box.image_id).where(Box.image_id.in_(chunk), review_state).distinct())
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
        # Unknown ids are ignored and an id named twice is one image (order kept).
        known_ids = list(dict.fromkeys(i for i in image_ids if i in existing))

        if not value:
            to_unmark = [i for i in known_ids if existing[i]]
            for chunk in _chunks(to_unmark):
                s.execute(update(Image).where(Image.id.in_(chunk)).values(marked_empty=False))
            follow_review(s, to_unmark, False)
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
        follow_review(s, to_mark, True)
        recount_runs_of(s, rejected_ids)
        for image_id in rejected_ids:  # bounded: the ids named in the request
            summary.touch(s, image_id)
        return len(to_mark), len(has_ground_truth), rejected_ids
