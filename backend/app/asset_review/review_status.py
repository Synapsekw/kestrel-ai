"""Photo review status (asset findings spec §5.4, decision A5): `finding`, `none`, `uncertain` or
`not_assessed`, at most one row per photo.

`image.marked_empty` stays the training-data truth, and the two never disagree:
- `set_status` writes `none` by marking the photo empty and any other status by clearing the mark,
  in the caller's transaction and by the Data Manager's own rules
  (`app.datasets.empties.apply_mark`): refused with 409 `conflict` while the photo has accepted
  boxes, and its pending proposals rejected.
- The other way round, a mark set or cleared in the Data Manager moves an existing row
  (`app.datasets.empties.follow_review`).
- A photo with no row reads as `none` when it is marked empty, else `not_assessed`
  (`app.asset_review.effective.effective_status`, the same expression the image index filters on).
  Reading writes nothing.

`coverage` and `uncertain_coverage` are computed by the placement and kit import jobs; nothing here
writes them.
"""

from __future__ import annotations

from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.asset_review.effective import effective_status
from app.datasets.empties import apply_mark
from app.db.base import utcnow
from app.db.models import IMAGE_REVIEW_STATUSES, Image, ImageReview
from app.errors import AppError, not_found

ReviewStatus = Literal["finding", "none", "uncertain", "not_assessed"]


class ImageReviewOut(BaseModel):
    image_id: str
    status: ReviewStatus
    note: str
    coverage: float | None
    uncertain_coverage: float | None
    updated_at: datetime | None


class ImageReviewIn(BaseModel):
    model_config = ConfigDict(extra="forbid")  # the contract's ImageReviewPut: additionalProperties false

    status: ReviewStatus
    note: str = Field("", max_length=4000)


def _image(s: Session, image_id: str) -> Image:
    image = s.get(Image, image_id)
    if image is None:
        raise not_found("image", image_id)
    return image


def get_review(s: Session, image_id: str) -> ImageReviewOut:
    """The photo's row, or what its mark implies when it has none (404 for an unknown photo)."""
    _image(s, image_id)
    row = s.get(ImageReview, image_id)
    if row is None:
        return ImageReviewOut(
            image_id=image_id,
            status=s.execute(select(effective_status()).where(Image.id == image_id)).scalar_one(),
            note="",
            coverage=None,
            uncertain_coverage=None,
            updated_at=None,
        )
    return ImageReviewOut.model_validate(row, from_attributes=True)


def set_status(s: Session, image_id: str, status: str, note: str = "") -> ImageReview:
    """Write the photo's status and note, and its mark in step, in the caller's session."""
    if status not in IMAGE_REVIEW_STATUSES:
        raise AppError("validation_error", f"unknown review status {status!r}", 422)
    image = _image(s, image_id)
    now = utcnow()
    apply_mark(s, image, status == "none", now)  # may raise 409 before anything is written
    row = s.get(ImageReview, image_id)
    if row is None:
        row = ImageReview(image_id=image_id, status=status, note=note, updated_at=now)
        s.add(row)
    else:
        row.status, row.note, row.updated_at = status, note, now
    s.flush()
    return row
