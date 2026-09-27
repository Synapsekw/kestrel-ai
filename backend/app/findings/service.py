"""Findings: create, change, delete (spec 2026-09-26-foundation sections 8.1-8.3, 8.5).

`create_in_session` is the public entry for every write path that creates findings inside its own
transaction: the box hooks (findings/annotations.py), the backfill, and M's map review (M section
9.3). Every write calls `counts.change` and `events.mark_changed` in the caller's transaction.
Everything a write checks is checked before anything changes, so `bulk` can skip a refusal cleanly.
"""

from __future__ import annotations

from collections.abc import Mapping
from dataclasses import replace
from datetime import datetime
from typing import Any

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.catalogue import project_types
from app.catalogue import service as catalogue_service
from app.db.base import utcnow
from app.db.models import Box, Finding, FindingAttachment, FindingComment, ProjectType
from app.errors import AppError, not_found
from app.findings import activity, anchors, counts, events, numbers, trash
from app.findings.anchors import AnchorIn

STATUSES = ("open", "reviewed", "closed")
TRANSITIONS = {
    ("open", "reviewed"),
    ("open", "closed"),
    ("reviewed", "closed"),
    ("reviewed", "open"),
    ("closed", "open"),
}
UNSET: Any = object()
SCALE_BOUND = range(1, 10)  # the severity scale holds levels 1-9 (spec section 5.6)


def get_or_404(s: Session, finding_id: str) -> Finding:
    """The finding, or 404 `not_found`."""
    row = s.get(Finding, finding_id)
    if row is None:
        raise not_found("finding", finding_id)
    return row


def _sev_text(level: int | None) -> str:
    return "none" if level is None else str(level)


def defect_type(s: Session, catalogue, type_id: str) -> ProjectType:
    """The project's snapshot of a defect type. A catalogue defect type not in the list yet is added
    (like a run's mapped types, spec section 7.4); an object type is refused before anything is
    written (D7)."""

    def not_a_defect(name: str) -> AppError:
        return AppError(
            "not_a_defect", f"{name} is an object type; findings are defects only.", 422, {"type_id": type_id}
        )

    row = s.get(ProjectType, type_id)
    if row is None:
        ref = project_types.lookup_types(catalogue, [type_id])[type_id]
        if ref.kind != "defect":
            raise not_a_defect(ref.name)
        project_types.add_types(s, catalogue, [type_id])
        row = s.get(ProjectType, type_id)
    if row.kind != "defect":
        raise not_a_defect(row.name)
    return row


def check_severity(catalogue, level: int | None) -> None:
    """A level on the catalogue's scale, or 422 `severity_unknown`. Without a catalogue any of 1-9
    (the scale's bound) is taken: decision F2, writes keep working when the catalogue is down."""
    if level is None:
        return
    levels = (
        [lv.level for lv in catalogue_service.get_scale(catalogue)] if catalogue is not None else SCALE_BOUND
    )
    if level not in levels:
        raise AppError("severity_unknown", f"There is no severity level {level}.", 422, {"level": level})


def create_in_session(
    s: Session,
    *,
    project_id: str,
    catalogue,
    type_id: str,
    anchor: AnchorIn,
    severity: int | None = UNSET,
    note: str = "",
    status: str = "open",
    created_by: str = "human",
    confidence: float | None = None,
    lon: float | None = None,
    lat: float | None = None,
    created_at: datetime | None = None,
    number: int | None = None,
    record_activity: bool = True,
) -> Finding:
    """Create one finding in the caller's transaction. `severity` defaults to the type's default
    severity; pass None for "no severity". `number` is for callers that reserved a range with
    `numbers.allocate(s, count=n)` (the backfill)."""
    if status not in STATUSES:
        raise AppError("validation_error", f"unknown status {status!r}", 422)
    if severity is not UNSET:
        check_severity(catalogue, severity)
    columns = anchors.resolve(s, anchor, lon=lon, lat=lat)
    pt = defect_type(s, catalogue, type_id)  # the last check: it may append the type to the list
    if severity is UNSET:
        severity = pt.default_severity
        # A snapshot that missed a scale shrink may name a level the live scale no longer has.
        if severity is not None and catalogue is not None:
            if severity not in {lv.level for lv in catalogue_service.get_scale(catalogue)}:
                severity = None
    now = utcnow()
    row = Finding(
        number=number if number is not None else numbers.allocate(s),
        type_id=type_id,
        severity=severity,
        status=status,
        note=note,
        created_by=created_by,
        confidence=confidence,
        created_at=created_at or now,
        updated_at=now,
        reviewed_at=now if status == "reviewed" else None,
        closed_at=now if status == "closed" else None,
        **columns,
    )
    s.add(row)
    s.flush()
    counts.change(s, None, counts.key_of(row))
    if record_activity:
        activity.record(
            s,
            "finding.created",
            row.id,
            f"{numbers.format_number(row.number)} {pt.name} created",
            {"number": row.number, "type_id": type_id},
        )
    events.mark_changed(s, project_id, [row.id])
    return row


def patch_in_session(
    s: Session, *, project_id: str, catalogue, finding_id: str, fields: Mapping[str, Any]
) -> Finding:
    """Apply `fields` (`status`, `severity`, `type_id`, `note`, `anchor`) under spec section 8.2."""
    row = get_or_404(s, finding_id)
    old = counts.key_of(row)
    label = numbers.format_number(row.number)
    status = fields.get("status") or row.status
    if status not in STATUSES:
        raise AppError("validation_error", f"unknown status {status!r}", 422)
    if status != row.status and (row.status, status) not in TRANSITIONS:
        raise AppError(
            "invalid_transition",
            f"{label} is {row.status}; it cannot become {status} directly. Reopen it first.",
            409,
            {"from": row.status, "to": status},
        )
    if "severity" in fields:
        check_severity(catalogue, fields["severity"])
    moved = anchors.repatch(s, row, fields["anchor"]) if fields.get("anchor") is not None else {}
    new_type = fields.get("type_id")
    pt = defect_type(s, catalogue, new_type) if new_type and new_type != row.type_id else None

    now = utcnow()
    if status != row.status:
        activity.record(
            s,
            "finding.status",
            row.id,
            f"{label} {row.status} → {status}",
            {"from": row.status, "to": status},
        )
        if status == "reviewed":
            row.reviewed_at = now
        elif status == "closed":
            row.closed_at = now
        elif row.status == "reviewed":  # reviewed -> open
            row.reviewed_at = None
        else:  # closed -> open (reopen)
            row.closed_at = None
        row.status = status
    if "severity" in fields and fields["severity"] != row.severity:
        activity.record(
            s,
            "finding.severity",
            row.id,
            f"{label} severity {_sev_text(row.severity)} → {_sev_text(fields['severity'])}",
            {"from": row.severity, "to": fields["severity"]},
        )
        row.severity = fields["severity"]
    if pt is not None:
        row.type_id = pt.type_id
        if row.anchor_kind == "image" and row.annotation_id:
            from app.imagery import annotations as boxes

            boxes.reclass_in_session(s, row.annotation_id, pt.type_id)
    if "note" in fields and fields["note"] is not None:
        row.note = fields["note"]
    for key, value in moved.items():
        setattr(row, key, value)
    row.updated_at = now
    s.flush()
    counts.change(s, old, counts.key_of(row))
    events.mark_changed(s, project_id, [row.id])
    return row


def delete_in_session(s: Session, *, project_id: str, finding_id: str, delete_annotation: bool = True) -> str:
    """Delete one finding; its attachment and comment rows go by ON DELETE CASCADE. The caller moves
    its files to the trash after commit (`trash.move`). With `delete_annotation` an image finding's
    box goes too (an annotation on a defect type IS the finding's geometry, section 8.5); the box
    hooks pass False, since they are deleting or changing that box themselves."""
    row = get_or_404(s, finding_id)
    annotation_id = row.annotation_id
    counts.change(s, counts.key_of(row), None)
    s.delete(row)
    s.flush()  # the finding goes before the box it references
    if delete_annotation and annotation_id:
        from app.imagery import annotations as boxes  # boxes imports this package's hooks

        box = s.get(Box, annotation_id)
        if box is not None:
            boxes.delete_box_in_session(s, box)
    events.mark_changed(s, project_id, [finding_id])
    return finding_id


def delete_for_anchor(s: Session, *, project_id: str, anchor_kind: str, target_id: str) -> list[str]:
    """Every finding anchored on one image, map or cloud; for M and C when they delete a map or a
    cloud (their deletes are theirs). The caller moves the returned ids' files after commit."""
    column = {"image": Finding.image_id, "map": Finding.map_id, "cloud": Finding.cloud_id}[anchor_kind]
    ids = list(
        s.execute(select(Finding.id).where(Finding.anchor_kind == anchor_kind, column == target_id)).scalars()
    )
    for fid in ids:
        delete_in_session(s, project_id=project_id, finding_id=fid, delete_annotation=False)
    return ids


def _image_annotation(s: Session, handle, anchor: AnchorIn, type_id: str) -> AnchorIn:
    """`POST /findings` on an image: draw its box (`box`), or adopt a ground-truth box
    (`annotation_id`), whose type becomes the finding's type."""
    from app.findings.annotations import GROUND_TRUTH  # annotations imports this module
    from app.imagery import annotations as boxes

    defect_type(s, handle.catalogue, type_id)  # refuse an object type before a box is drawn
    if anchor.box is not None:
        box = boxes.create_box_in_session(s, handle, anchor.image_id, type_id, **anchor.box)
        return replace(anchor, annotation_id=box.id, box=None)
    box = s.get(Box, anchor.annotation_id) if anchor.annotation_id else None
    if box is not None and box.review_state not in GROUND_TRUTH:
        raise AppError(
            "annotation_not_reviewed",
            "Accept or edit that detection first; a pending one is not a finding yet.",
            409,
            {"annotation_id": box.id},
        )
    if box is not None and box.class_id != type_id:
        boxes.reclass_in_session(s, box.id, type_id)
    return anchor


def create_finding(handle, **kw) -> Finding:
    """`create_in_session` in its own transaction (the HTTP route); an image anchor may draw or adopt
    its box first (spec section 8.3)."""
    with handle.session() as s:
        if kw["anchor"].kind == "image":
            kw["anchor"] = _image_annotation(s, handle, kw["anchor"], kw["type_id"])
        row = create_in_session(s, project_id=handle.id, catalogue=handle.catalogue, **kw)
        s.flush()
        s.expunge(row)
    return row


def get_finding(handle, finding_id: str) -> tuple[Finding, int, int]:
    """The finding with its attachment and comment counts."""
    with handle.session() as s:
        row = get_or_404(s, finding_id)
        n_att = s.execute(
            select(func.count())
            .select_from(FindingAttachment)
            .where(FindingAttachment.finding_id == finding_id)
        ).scalar_one()
        n_com = s.execute(
            select(func.count()).select_from(FindingComment).where(FindingComment.finding_id == finding_id)
        ).scalar_one()
        s.expunge(row)
    return row, n_att, n_com


def patch_finding(handle, finding_id: str, fields: Mapping[str, Any]) -> Finding:
    with handle.session() as s:
        row = patch_in_session(
            s, project_id=handle.id, catalogue=handle.catalogue, finding_id=finding_id, fields=fields
        )
        s.flush()
        s.expunge(row)
    return row


def delete_finding(handle, finding_id: str) -> None:
    with handle.session() as s:
        delete_in_session(s, project_id=handle.id, finding_id=finding_id)
    trash.move(handle, [finding_id])
