"""Model detections as annotation rows (image inspection spec §11.2-11.3; plan I-BP).

Both writers of model suggestions — the interactive `detect` request and the `infer` job — turn a
`Detection` into `Box` columns here, through I-BA's `shapes.shape_fields`, so a suggestion obeys
the same rules as a person's annotation and is never stored in a shape the canvas cannot draw.
"""

from __future__ import annotations

import logging

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.db.models import Box
from app.errors import AppError
from app.geometry import aabb_of
from app.imagery import annotations
from app.imagery.shapes import ShapeFields, shape_fields
from app.providers.base import Detection
from app.providers.tiling import Envelope, envelope_iou

log = logging.getLogger(__name__)

COVER_IOU = 0.5  # spec §11.2 step 4


def to_fields(det: Detection, width: int, height: int) -> ShapeFields | None:
    """The stored columns for one detection, or None when nothing drawable is left (R-BP11).

    An axis-aligned box is clamped to the frame first: a model's box can overhang by a fraction of
    a pixel, and I-BA's bounds rule would refuse it. A polygon is clipped by I-BA's repair; an rbox
    keeps I-BA's "centre inside" rule.
    """
    try:
        if det.polygon is not None:
            return shape_fields(width, height, shape="polygon", points=[list(p) for p in det.polygon])
        if det.angle:
            return shape_fields(
                width, height, shape="rbox", x=det.x, y=det.y, w=det.w, h=det.h, angle=det.angle
            )
        x0, y0 = max(det.x, 0.0), max(det.y, 0.0)
        x1, y1 = min(det.x + det.w, float(width)), min(det.y + det.h, float(height))
        return shape_fields(width, height, shape="box", x=x0, y=y0, w=x1 - x0, h=y1 - y0)
    except AppError as e:
        log.debug("dropping a %s detection of %s: %s", det.shape, det.label, e.message)
        return None


def row_envelope(row: Box) -> Envelope | None:
    """A stored annotation's envelope; None for a point (it has no extent). A polygon's x/y/w/h
    already are its envelope and its angle is 0."""
    if (row.shape or "box") == "point":
        return None
    return aabb_of(row.x, row.y, row.w, row.h, row.angle or 0.0)


def covered(envelope: Envelope, class_id: str, rows: list[Box]) -> bool:
    """Whether a decided annotation of the same type already covers this envelope (R-BP2)."""
    for r in rows:
        if r.class_id != class_id:
            continue
        env = row_envelope(r)
        if env is not None and envelope_iou(envelope, env) >= COVER_IOU:
            return True
    return False


def within_cap(s: Session, image_id: str, rows: list[Box]) -> list[Box]:
    """The rows that fit under the per-image cap, most confident first (R-BP5).

    Call it after deleting the rows being replaced. The cap is never an error for model output: a
    batch job would otherwise fail on one crowded frame.
    """
    existing = s.scalar(select(func.count()).select_from(Box).where(Box.image_id == image_id)) or 0
    room = max(0, annotations.PER_IMAGE_CAP - existing)
    if len(rows) > room:
        log.warning(
            "image %s: keeping %d of %d suggestions under the %d-annotation cap",
            image_id,
            room,
            len(rows),
            annotations.PER_IMAGE_CAP,
        )
        rows = sorted(rows, key=lambda r: -(r.confidence or 0.0))[:room]
    annotations.check_cap(s, image_id, len(rows))
    return rows


def suggestion(
    fields: ShapeFields,
    *,
    image_id: str,
    class_id: str,
    confidence: float,
    provenance_kind: str,
    model_id: str | None,
    provider: str | None,
    model_name: str | None,
    query_run_id: str | None,
) -> Box:
    """An `unreviewed` suggestion row. No finding: F's invariant creates one only on accept."""
    return Box(
        **fields.columns(),
        image_id=image_id,
        class_id=class_id,
        confidence=confidence,
        provenance_kind=provenance_kind,
        model_id=model_id,
        provider=provider,
        model_name=model_name,
        query_run_id=query_run_id,
        review_state="unreviewed",
    )
