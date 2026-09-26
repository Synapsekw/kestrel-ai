"""The annotation <-> finding invariant for image anchors (spec 2026-09-26-foundation section 8.5;
umbrella section 3: an annotation on a defect type IS a finding's geometry).

The box service (app/datasets/boxes.py) calls these hooks inside its own transaction, after it has
changed the box row. Each hook that deletes findings returns their ids, so the caller moves their
photos to the trash after the commit.
"""

from __future__ import annotations

from collections.abc import Iterable

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.db.models import Box, Finding, ProjectType
from app.errors import AppError
from app.findings import activity, numbers, service
from app.findings.anchors import AnchorIn

GROUND_TRUTH = ("accepted", "edited")


def created_by(box: Box) -> str:
    """`human` for a person-drawn box, else `model:<library model id>`. A cloud provider's box has
    no library model, so its provider name stands in."""
    if box.provenance_kind == "person":
        return "human"
    return f"model:{box.model_id or box.provider or 'unknown'}"


def _is_defect(s: Session, class_id: str) -> bool:
    row = s.get(ProjectType, class_id)
    return row is not None and row.kind == "defect"


def finding_of(s: Session, box_id: str) -> Finding | None:
    return s.execute(select(Finding).where(Finding.annotation_id == box_id)).scalar_one_or_none()


def _create(s: Session, project_id: str, catalogue, box: Box, *, record_activity: bool = True) -> Finding:
    """A person's box starts `open`; an accepted or edited detection is `reviewed`, with its model
    and confidence (the cross-host rule of spec section 8.5)."""
    return service.create_in_session(
        s,
        project_id=project_id,
        catalogue=catalogue,
        type_id=box.class_id,
        anchor=AnchorIn(kind="image", image_id=box.image_id, annotation_id=box.id),
        status="open" if box.provenance_kind == "person" else "reviewed",
        created_by=created_by(box),
        confidence=box.confidence,
        record_activity=record_activity,
    )


def on_box_created(s: Session, project_id: str, catalogue, box: Box) -> None:
    if box.review_state in GROUND_TRUTH and _is_defect(s, box.class_id):
        _create(s, project_id, catalogue, box)


def on_box_changed(
    s: Session,
    project_id: str,
    catalogue,
    box: Box,
    *,
    confirm_finding_delete: bool = False,
    accepted: list[str] | None = None,
) -> list[str]:
    """After a box's class or review state changed (the row carries the new values):

    - ground truth on a defect type, no finding yet -> a finding
    - no longer ground truth (rejected, or unreviewed again) -> its finding is deleted
    - reclassed to an object type -> its finding is deleted, but only with
      `confirm_finding_delete` (409 `finding_would_be_deleted` otherwise)
    - reclassed to another defect type -> the finding's type follows

    `accepted` collects a review batch's new findings for one `detections.accepted` row."""
    f = finding_of(s, box.id)
    ground_truth = box.review_state in GROUND_TRUTH
    defect = _is_defect(s, box.class_id)
    if f is None:
        if ground_truth and defect:
            new = _create(s, project_id, catalogue, box, record_activity=accepted is None)
            if accepted is not None:
                accepted.append(new.id)
        return []
    if not (ground_truth and defect):
        if ground_truth and not confirm_finding_delete:
            raise AppError(
                "finding_would_be_deleted",
                f"{numbers.format_number(f.number)} would be deleted: its new type is not a defect type.",
                409,
                {"finding_id": f.id, "number": f.number},
            )
        return [service.delete_in_session(s, project_id=project_id, finding_id=f.id, delete_annotation=False)]
    if f.type_id != box.class_id:
        service.patch_in_session(
            s, project_id=project_id, catalogue=catalogue, finding_id=f.id, fields={"type_id": box.class_id}
        )
    return []


def on_box_deleting(s: Session, project_id: str, box: Box) -> list[str]:
    f = finding_of(s, box.id)
    if f is None:
        return []
    return [service.delete_in_session(s, project_id=project_id, finding_id=f.id, delete_annotation=False)]


def on_images_deleting(s: Session, project_id: str, image_ids: Iterable[str]) -> list[str]:
    """Before `images.bulk_delete` removes boxes with one SQL DELETE."""
    ids = list(
        s.execute(
            select(Finding.id).where(Finding.anchor_kind == "image", Finding.image_id.in_(list(image_ids)))
        ).scalars()
    )
    for fid in ids:
        service.delete_in_session(s, project_id=project_id, finding_id=fid, delete_annotation=False)
    return ids


def record_accepted(s: Session, finding_ids: list[str]) -> None:
    """One `detections.accepted` activity row per review request (spec section 8.5)."""
    if not finding_ids:
        return
    n = len(finding_ids)
    activity.record(
        s,
        "detections.accepted",
        None,
        f"{n} detection{'s' if n != 1 else ''} accepted as findings",
        {"finding_ids": finding_ids[:100], "count": n},
    )
