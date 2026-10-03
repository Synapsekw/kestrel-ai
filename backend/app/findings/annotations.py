"""The annotation <-> finding invariant for image anchors (spec 2026-09-26-foundation section 8.5;
umbrella section 3: an annotation on a defect type IS a finding's geometry).

The box service (app/datasets/boxes.py) calls these hooks inside its own transaction, after it has
changed the box row. Each hook that deletes findings returns their ids, so the caller can move their
photos to the trash after the commit.

A box that is a sighting of an asset finding (asset findings spec §5.6) is never an image finding.
Its hooks change or remove the sighting. An asset finding left with no sighting is closed, never
deleted.
"""

from __future__ import annotations

from collections.abc import Iterable

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.db.models import Box, Finding, FindingSighting, ProjectType
from app.errors import AppError
from app.findings import activity, events, numbers, service, sightings
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


def _sighting_box_changed(
    s: Session, project_id: str, catalogue, box: Box, sighting: FindingSighting, previous_class_id: str | None
) -> None:
    """A sighting's box changed:

    - no longer ground truth, or now an object type: the sighting goes (the finding is closed when
      it was the last one);
    - reclassed to another defect type: it splits out into a finding of that type, or, when it is
      the only sighting, the finding's type follows;
    - otherwise (a geometry edit): the sighting is `pending` until `asset_place` places it again."""
    if box.review_state not in GROUND_TRUTH or not _is_defect(s, box.class_id):
        sightings.remove(
            s, project_id=project_id, catalogue=catalogue, rows=[sighting], reason=sightings.NOT_A_SIGHTING
        )
        return
    f = s.get(Finding, sighting.finding_id) if sighting.finding_id else None
    reclassed = previous_class_id is not None and previous_class_id != box.class_id
    if reclassed and f is not None and f.type_id != box.class_id:
        if len(sightings.of_finding(s, f.id)) > 1:
            from app.asset_review import group  # group imports this package

            group.split_in_session(
                s,
                project_id=project_id,
                catalogue=catalogue,
                finding_id=f.id,
                sighting_ids=[sighting.id],
                type_id=box.class_id,
            )
        else:
            service.patch_in_session(
                s,
                project_id=project_id,
                catalogue=catalogue,
                finding_id=f.id,
                fields={"type_id": box.class_id},
            )
        return
    sighting.placement = "pending"
    sighting.placed_version = None
    if f is not None:
        s.flush()
        sightings.refresh(s, f)
        events.mark_changed(s, project_id, [f.id])


def on_box_changed(
    s: Session,
    project_id: str,
    catalogue,
    box: Box,
    *,
    confirm_finding_delete: bool = False,
    accepted: list[str] | None = None,
    previous_class_id: str | None = None,
) -> list[str]:
    """After a box's class, review state or geometry changed (the row carries the new values):

    - ground truth on a defect type, no finding yet -> a finding
    - no longer ground truth (rejected, or unreviewed again) -> its finding is deleted
    - reclassed to an object type -> its finding is deleted, but only with
      `confirm_finding_delete` (409 `finding_would_be_deleted` otherwise)
    - reclassed to another defect type -> the finding's type follows
    - class unchanged (a geometry edit) on a type the catalogue turned into an object type -> the
      finding is kept (spec section 7.2: defect -> object keeps existing findings)
    - a sighting's box -> its sighting changes or goes (asset findings spec §5.6); never an image finding

    `previous_class_id` is the box's class before the change; None means it did not change.
    `accepted` collects a review batch's new findings for one `detections.accepted` row."""
    sighting = sightings.of_box(s, box.id)
    if sighting is not None:
        _sighting_box_changed(s, project_id, catalogue, box, sighting, previous_class_id)
        return []
    f = finding_of(s, box.id)
    ground_truth = box.review_state in GROUND_TRUTH
    defect = _is_defect(s, box.class_id)
    if f is None:
        if ground_truth and defect:
            new = _create(s, project_id, catalogue, box, record_activity=accepted is None)
            if accepted is not None:
                accepted.append(new.id)
        return []
    reclassed = previous_class_id is not None and previous_class_id != box.class_id
    if not ground_truth or (reclassed and not defect):
        if ground_truth and not confirm_finding_delete:
            raise AppError(
                "finding_would_be_deleted",
                f"{numbers.format_number(f.number)} would be deleted: its new type is not a defect type.",
                409,
                {"finding_id": f.id, "number": f.number},
            )
        return [service.delete_in_session(s, project_id=project_id, finding_id=f.id, delete_annotation=False)]
    if defect and f.type_id != box.class_id:
        service.patch_in_session(
            s, project_id=project_id, catalogue=catalogue, finding_id=f.id, fields={"type_id": box.class_id}
        )
    return []


def on_box_deleting(s: Session, project_id: str, box: Box) -> list[str]:
    sighting = sightings.of_box(s, box.id)
    if sighting is not None:
        sightings.remove(s, project_id=project_id, catalogue=None, rows=[sighting], reason=sightings.BOX_GONE)
        return []
    f = finding_of(s, box.id)
    if f is None:
        return []
    return [service.delete_in_session(s, project_id=project_id, finding_id=f.id, delete_annotation=False)]


def on_images_deleting(s: Session, project_id: str, image_ids: Iterable[str]) -> list[str]:
    """Before `images.bulk_delete` removes boxes with one SQL DELETE.

    Asset sightings on these images go first; an asset finding left with none is closed, never
    deleted. Image findings on them are deleted, since their box is their geometry. Returns the
    deleted findings' ids for the trash."""
    image_ids = list(image_ids)
    gone = list(s.execute(select(FindingSighting).where(FindingSighting.image_id.in_(image_ids))).scalars())
    if gone:
        sightings.remove(s, project_id=project_id, catalogue=None, rows=gone, reason=sightings.PHOTOS_GONE)
    ids = list(
        s.execute(
            select(Finding.id).where(Finding.anchor_kind == "image", Finding.image_id.in_(image_ids))
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
