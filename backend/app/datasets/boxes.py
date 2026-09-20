"""Box create, update, delete and bulk review (spec sections 4 and 6).

Accepted and edited boxes are ground truth; unreviewed proposals are not. Editing a proposal is
itself a review decision, so it becomes `edited` rather than staying pending.
"""

from __future__ import annotations

from datetime import UTC, datetime

from sqlalchemy import select

from app.datasets.empties import clear_mark_for_ground_truth
from app.db.models import Box, Image
from app.errors import AppError, not_found
from app.geometry import centre_of, normalise_angle
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


def _check_bounds(image: Image, x: float, y: float, w: float, h: float, angle: float = 0.0) -> None:
    """Angle 0 must lie fully inside the image; a rotated box only needs its centre inside.

    The asymmetry is deliberate (spec 3.3). Forcing a rotated box's corners inside the image would
    shrink or shove it every time the annotator rotated near an edge, and an object half out of
    frame is exactly the case aerial frames are full of. Angle 0 keeps today's rule untouched so
    no box that already exists changes meaning.
    """
    if w <= 0 or h <= 0:
        raise AppError("validation_error", f"box ({x}, {y}, {w}, {h}) has a non-positive side", 422)
    if angle:
        cx, cy = centre_of(x, y, w, h)
        if not (0 <= cx <= image.width and 0 <= cy <= image.height):
            raise AppError(
                "validation_error",
                f"rotated box centre ({cx}, {cy}) is outside the "
                f"{image.width}x{image.height} image",
                422,
            )
        return
    if x < 0 or y < 0 or x + w > image.width or y + h > image.height:
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
    handle: ProjectHandle,
    image_id: str,
    class_id: str,
    x: float,
    y: float,
    w: float,
    h: float,
    angle: float = 0.0,
) -> Box:
    with handle.session() as s:
        image = _image(s, image_id)
        _check_class(handle, s, class_id)
        angle = normalise_angle(angle)
        _check_bounds(image, x, y, w, h, angle)
        row = Box(
            image_id=image_id,
            class_id=class_id,
            x=x,
            y=y,
            w=w,
            h=h,
            angle=angle,
            provenance_kind="person",
            review_state="accepted",
            reviewed_at=datetime.now(UTC),
        )
        s.add(row)
        clear_mark_for_ground_truth(s, [image_id])
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
        if "angle" in fields:
            fields["angle"] = normalise_angle(fields["angle"])
        moved = {k: fields.get(k, getattr(row, k)) for k in ("x", "y", "w", "h", "angle")}
        _check_bounds(_image(s, row.image_id), **moved)
        for k, v in fields.items():
            setattr(row, k, v)
        if row.review_state not in GROUND_TRUTH:  # editing a proposal is a review decision
            row.review_state = "edited"
            row.reviewed_at = datetime.now(UTC)
            clear_mark_for_ground_truth(s, [row.image_id])
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
    """Accept, reject or unreview proposals in bulk; the count is the boxes that changed state.

    Unknown ids and person-drawn boxes are ignored: only a model proposal has a decision to make
    or undo. Accepting an already edited box leaves it `edited` — it is ground truth either way,
    and the state records that a person changed its geometry.
    """
    now = datetime.now(UTC)
    changed = 0
    accepted_image_ids: set[str] = set()
    with handle.session() as s:
        for row in s.execute(select(Box).where(Box.id.in_(box_ids))).scalars():
            if row.provenance_kind == "person":
                continue
            if action == "unreview":
                if row.review_state == "unreviewed":
                    continue
                row.review_state, row.reviewed_at = "unreviewed", None
            else:
                target = "accepted" if action == "accept" else "rejected"
                if row.review_state == target or (action == "accept" and row.review_state in GROUND_TRUTH):
                    continue
                row.review_state, row.reviewed_at = target, now
                if action == "accept":
                    accepted_image_ids.add(row.image_id)
            changed += 1
        clear_mark_for_ground_truth(s, accepted_image_ids)
    return changed
