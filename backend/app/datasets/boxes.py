"""Box create, update, delete and bulk review (spec sections 4 and 6).

Accepted and edited boxes are ground truth; unreviewed proposals are not. Editing a proposal is
itself a review decision, so it becomes `edited` rather than staying pending.
"""

from __future__ import annotations

from datetime import UTC, datetime

from sqlalchemy import select

from app.db.models import Box, Image
from app.errors import AppError, not_found
from app.projects.service import ProjectHandle

GROUND_TRUTH = ("accepted", "edited")


def _image(s, image_id: str) -> Image:
    image = s.get(Image, image_id)
    if image is None:
        raise not_found("image", image_id)
    return image


def _check_class(handle: ProjectHandle, s, class_id: str) -> None:
    if class_id not in {c["id"] for c in handle.row(s).classes or []}:
        raise AppError("validation_error", f"unknown class {class_id!r}", 422)


def _check_bounds(image: Image, x: float, y: float, w: float, h: float) -> None:
    if x < 0 or y < 0 or w <= 0 or h <= 0 or x + w > image.width or y + h > image.height:
        raise AppError(
            "validation_error",
            f"box ({x}, {y}, {w}, {h}) does not lie inside the {image.width}x{image.height} image",
            422,
        )


def list_boxes(handle: ProjectHandle, image_id: str) -> list[Box]:
    with handle.session() as s:
        _image(s, image_id)
        rows = list(
            s.execute(select(Box).where(Box.image_id == image_id).order_by(Box.created_at, Box.id)).scalars()
        )
        for r in rows:
            s.expunge(r)
    return rows


def create_box(
    handle: ProjectHandle, image_id: str, class_id: str, x: float, y: float, w: float, h: float
) -> Box:
    with handle.session() as s:
        image = _image(s, image_id)
        _check_class(handle, s, class_id)
        _check_bounds(image, x, y, w, h)
        row = Box(
            image_id=image_id,
            class_id=class_id,
            x=x,
            y=y,
            w=w,
            h=h,
            provenance_kind="person",
            review_state="accepted",
            reviewed_at=datetime.now(UTC),
        )
        s.add(row)
        s.flush()
        s.expunge(row)
    return row


def update_box(handle: ProjectHandle, box_id: str, **fields) -> Box:
    with handle.session() as s:
        row = s.get(Box, box_id)
        if row is None:
            raise not_found("box", box_id)
        if "class_id" in fields:
            _check_class(handle, s, fields["class_id"])
        moved = {k: fields.get(k, getattr(row, k)) for k in ("x", "y", "w", "h")}
        _check_bounds(_image(s, row.image_id), **moved)
        for k, v in fields.items():
            setattr(row, k, v)
        if row.review_state not in GROUND_TRUTH:  # editing a proposal is a review decision
            row.review_state = "edited"
            row.reviewed_at = datetime.now(UTC)
        s.flush()
        s.expunge(row)
    return row


def delete_box(handle: ProjectHandle, box_id: str) -> None:
    with handle.session() as s:
        row = s.get(Box, box_id)
        if row is None:
            raise not_found("box", box_id)
        s.delete(row)


def review_boxes(handle: ProjectHandle, box_ids: list[str], action: str) -> int:
    """Accept or reject in bulk. Unknown ids are ignored; the count is the boxes that changed state.

    Accepting an already edited box leaves it `edited`: it is ground truth either way, and the
    state records that a person changed its geometry.
    """
    accept = action == "accept"
    target = "accepted" if accept else "rejected"
    now = datetime.now(UTC)
    changed = 0
    with handle.session() as s:
        for row in s.execute(select(Box).where(Box.id.in_(box_ids))).scalars():
            if row.review_state == target or (accept and row.review_state in GROUND_TRUTH):
                continue
            row.review_state = target
            row.reviewed_at = now
            changed += 1
    return changed
