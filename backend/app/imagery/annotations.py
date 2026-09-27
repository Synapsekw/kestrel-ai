"""The annotation (box) service: shapes, validation, review (spec 2026-09-26-image-inspection
section 8), and the annotation <-> finding invariant (spec 2026-09-26-foundation section 8.5).

Accepted and edited boxes are ground truth; unreviewed proposals are not. Editing a proposal is
itself a review decision, so it becomes `edited` rather than staying pending. A ground-truth box on
a defect type is a finding's geometry: every write below calls `app.findings.annotations` inside its
own transaction, then `app.imagery.summary.touch` for the image, then moves the photos of findings
it deleted to the trash after the commit.

Geometry (`shape`, `x, y, w, h, angle`, `points`, `area_px`) is always `imagery.shapes`' answer, on
every write that changes it, so `area_px` and box/rbox never go stale.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import UTC, datetime

from sqlalchemy import func, select

from app.catalogue import service as catalogue_service
from app.datasets.empties import clear_mark_for_ground_truth
from app.db.models import (
    Activity,
    Box,
    Finding,
    FindingAttachment,
    FindingComment,
    Image,
    ProjectType,
    QueryRun,
)
from app.detect.counts import Entry, apply_transition
from app.errors import AppError, not_found
from app.findings import annotations as hooks
from app.findings import trash
from app.findings.annotations import GROUND_TRUTH
from app.imagery import shapes, summary
from app.projects.service import ProjectHandle

PER_IMAGE_CAP = 5000
CONTENT_MESSAGE = "This finding has a note or photos; delete it from the inspector."


@dataclass(frozen=True)
class Written:
    box: Box
    finding_id: str | None
    repaired: bool


@dataclass(frozen=True)
class ReviewOutcome:
    changed: int
    finding_ids_created: list[str]
    finding_ids_deleted: list[str]


def _entry(row: Box) -> Entry:
    return (row.class_id, row.review_state)


def _count_transition(
    s, runs: dict[str, QueryRun | None], run_id: str | None, old: Entry, new: Entry
) -> None:
    """Apply one box's change to its photo run's counts (spec 2026-09-23 section 9.1), in the caller's
    session so the review write and the increment share one transaction. A box outside any run, or
    in a run since deleted, changes nothing."""
    if not run_id or old == new:
        return
    if run_id not in runs:
        runs[run_id] = s.get(QueryRun, run_id)
    run = runs[run_id]
    if run is None:
        return
    counts, verified = dict(run.counts or {}), dict(run.verified_counts or {})
    apply_transition(counts, verified, old, new)
    run.counts, run.verified_counts = counts, verified  # new dicts: plain JSON does not track in place


def _image(s, image_id: str) -> Image:
    image = s.get(Image, image_id)
    if image is None:
        raise not_found("image", image_id)
    return image


def _check_type(handle: ProjectHandle, s, class_id: str, shape: str) -> None:
    """In the project list and not archived (spec 8.2; R-BA6), and a defect type for a point."""
    details = {"type_ids": [class_id]}
    if class_id not in {c["id"] for c in handle.row(s).classes or []}:
        raise AppError("unknown_type", f"unknown type {class_id!r}", 422, details)
    if handle.catalogue is not None:
        ref = catalogue_service.resolve_types(handle.catalogue, [class_id]).get(class_id)
        if ref is not None and ref.archived:
            raise AppError("unknown_type", f"type {ref.name!r} is archived", 422, details)
    if shape == "point":
        pt = s.get(ProjectType, class_id)
        if pt is None or pt.kind != "defect":
            raise AppError("point_needs_defect_type", "A point marker needs a defect type.", 422)


def check_cap(s, image_id: str, adding: int = 1) -> None:
    n = s.scalar(select(func.count()).select_from(Box).where(Box.image_id == image_id)) or 0
    if n + adding > PER_IMAGE_CAP:
        raise AppError(
            "too_many_annotations",
            f"An image holds at most {PER_IMAGE_CAP} annotations; this one has {n}.",
            422,
            {"limit": PER_IMAGE_CAP, "count": n},
        )


def _finding_id(s, box_id: str) -> str | None:
    f = hooks.finding_of(s, box_id)
    return f.id if f is not None else None


def list_boxes(handle: ProjectHandle, image_id: str) -> list[Box]:
    with handle.session() as s:
        _image(s, image_id)
        rows = list(
            s.execute(select(Box).where(Box.image_id == image_id).order_by(Box.created_at, Box.id)).scalars()
        )
        for r in rows:
            s.expunge(r)
    return rows


def create_shape_in_session(
    s,
    handle: ProjectHandle,
    image_id: str,
    class_id: str,
    *,
    shape: str = "box",
    x: float | None = None,
    y: float | None = None,
    w: float | None = None,
    h: float | None = None,
    angle: float = 0.0,
    points: list[list[float]] | None = None,
    assist: str | None = None,
    query_run_id: str | None = None,
) -> tuple[Box, bool]:
    """A person-drawn shape in the caller's transaction, without the finding hook (`POST /findings`
    draws through here and creates the finding itself). Returns the row and `repaired`.

    The caller runs its hooks and then `summary.touch(s, image_id)`: the summary is touched after
    the row change and the hooks (controller ruling), so it is not touched here.
    """
    image = _image(s, image_id)
    _check_type(handle, s, class_id, shape)
    fields = shapes.shape_fields(
        image.width, image.height, shape=shape, x=x, y=y, w=w, h=h, angle=angle, points=points
    )
    check_cap(s, image_id)
    now = datetime.now(UTC)
    row = Box(
        image_id=image_id,
        class_id=class_id,
        **fields.columns(),
        assist=assist,
        provenance_kind="person",
        review_state="accepted",
        reviewed_at=now,
        updated_at=now,
        query_run_id=query_run_id,
    )
    s.add(row)
    _count_transition(s, {}, query_run_id, None, _entry(row))
    clear_mark_for_ground_truth(s, [image_id])
    s.flush()
    return row, fields.repaired


def create_box_in_session(
    s,
    handle: ProjectHandle,
    image_id: str,
    class_id: str,
    x: float,
    y: float,
    w: float,
    h: float,
    angle: float = 0.0,
    query_run_id: str | None = None,
) -> Box:
    """F's `POST /findings` entry (signature unchanged): a rectangle, with its shape and area from
    `shapes`. F runs no box hook on this path (it creates the finding itself), so the summary is
    touched here, after the row change."""
    row, _ = create_shape_in_session(
        s, handle, image_id, class_id, x=x, y=y, w=w, h=h, angle=angle, query_run_id=query_run_id
    )
    summary.touch(s, image_id)
    return row


def create_box(
    handle: ProjectHandle,
    image_id: str,
    class_id: str,
    x: float | None = None,
    y: float | None = None,
    w: float | None = None,
    h: float | None = None,
    angle: float = 0.0,
    query_run_id: str | None = None,
    *,
    shape: str = "box",
    points: list[list[float]] | None = None,
    assist: str | None = None,
) -> Written:
    """A person-drawn shape; with `query_run_id` a missed object added to that photo run (counted as
    verified). On a defect type it is also an open finding, whose id is returned."""
    with handle.session() as s:
        row, repaired = create_shape_in_session(
            s,
            handle,
            image_id,
            class_id,
            shape=shape,
            x=x,
            y=y,
            w=w,
            h=h,
            angle=angle,
            points=points,
            assist=assist,
            query_run_id=query_run_id,
        )
        hooks.on_box_created(s, handle.id, handle.catalogue, row)
        s.flush()
        summary.touch(s, image_id)
        fid = _finding_id(s, row.id)
        s.expunge(row)
    return Written(row, fid, repaired)


_RECT_KEYS = ("x", "y", "w", "h", "angle")


def _new_geometry(image: Image, row: Box, fields: dict) -> shapes.ShapeFields | None:
    """The row's new geometry from a PATCH (R-BA4), or None when the geometry is not touched.
    Pops the geometry keys from `fields`; the shape itself never changes (box <-> rbox follows the
    angle)."""
    if row.shape == "polygon":
        if any(k in fields for k in _RECT_KEYS):
            raise shapes.invalid_shape("a polygon moves by its points")
        if "points" not in fields:
            return None
        return shapes.polygon_fields(image.width, image.height, fields.pop("points"))
    if "points" in fields:
        raise shapes.invalid_shape(f"a {row.shape} takes no points")
    if row.shape == "point":
        if any(k in fields for k in ("w", "h", "angle")):
            raise shapes.invalid_shape("a point takes x and y only")
        if "x" not in fields and "y" not in fields:
            return None
        return shapes.point_fields(image.width, image.height, fields.pop("x", row.x), fields.pop("y", row.y))
    moved = {k: fields.pop(k, getattr(row, k)) for k in _RECT_KEYS}
    return shapes.rect_fields(image.width, image.height, **moved)  # always re-checked (today's rule)


def update_box(
    handle: ProjectHandle, box_id: str, *, confirm_finding_delete: bool = False, **fields
) -> Written:
    with handle.session() as s:
        row = s.get(Box, box_id)
        if row is None:
            raise not_found("box", box_id)
        # Only a real retype is judged: a box on a since-archived type must stay movable.
        if "class_id" in fields and fields["class_id"] != row.class_id:
            _check_type(handle, s, fields["class_id"], row.shape)
        geometry = _new_geometry(_image(s, row.image_id), row, fields)
        old = _entry(row)
        old_class_id = row.class_id
        for k, v in fields.items():  # only class_id is left
            setattr(row, k, v)
        if geometry is not None:
            for k, v in geometry.columns().items():
                setattr(row, k, v)
        row.updated_at = datetime.now(UTC)
        if row.review_state not in GROUND_TRUTH:  # editing a proposal is a review decision
            row.review_state = "edited"
            row.reviewed_at = row.updated_at
            clear_mark_for_ground_truth(s, [row.image_id])
        _count_transition(s, {}, row.query_run_id, old, _entry(row))
        trashed = hooks.on_box_changed(
            s,
            handle.id,
            handle.catalogue,
            row,
            confirm_finding_delete=confirm_finding_delete,
            previous_class_id=old_class_id,
        )
        s.flush()
        summary.touch(s, row.image_id)
        fid = _finding_id(s, row.id)
        s.expunge(row)
    trash.move(handle, trashed)
    return Written(row, fid, bool(geometry and geometry.repaired))


def reclass_in_session(s, box_id: str, class_id: str) -> None:
    """A finding's type change moves its box (an annotation's type is its finding's type), with the
    photo run's counts. No finding hook runs: the finding already follows."""
    row = s.get(Box, box_id)
    if row is None or row.class_id == class_id:
        return
    old = _entry(row)
    row.class_id = class_id
    row.updated_at = datetime.now(UTC)
    _count_transition(s, {}, row.query_run_id, old, _entry(row))
    summary.touch(s, row.image_id)


def delete_box_in_session(s, row: Box) -> None:
    """The box and its run count, without the finding hook: a finding delete calls this after it has
    removed itself."""
    image_id = row.image_id
    _count_transition(s, {}, row.query_run_id, _entry(row), None)
    s.delete(row)
    s.flush()
    summary.touch(s, image_id)


def delete_box(handle: ProjectHandle, box_id: str) -> None:
    with handle.session() as s:
        row = s.get(Box, box_id)
        if row is None:
            raise not_found("box", box_id)
        trashed = hooks.on_box_deleting(s, handle.id, row)
        delete_box_in_session(s, row)
    trash.move(handle, trashed)


def _has_content(s, f: Finding) -> bool:
    """Untouched = no note, no photo, no comment, still `reviewed`, severity never set by a person
    (R-BA2: a `finding.severity` activity row is the record of a person's change)."""
    if (f.note or "").strip() or f.status != "reviewed":
        return True
    for model, column in (
        (FindingAttachment, FindingAttachment.finding_id),
        (FindingComment, FindingComment.finding_id),
    ):
        if s.scalar(select(model.id).where(column == f.id).limit(1)) is not None:
            return True
    return (
        s.scalar(
            select(Activity.id)
            .where(Activity.subject_id == f.id, Activity.kind == "finding.severity")
            .limit(1)
        )
        is not None
    )


def _refuse_unreview_with_content(s, rows: list[Box]) -> None:
    """An unreview is an undo: it never takes a note, comment or photo with it (spec 8.3, R-BA2).
    Any touched finding refuses the whole request before anything changes."""
    touched = []
    for row in rows:
        if row.provenance_kind == "person" or row.review_state not in GROUND_TRUTH:
            continue
        f = hooks.finding_of(s, row.id)
        if f is not None and _has_content(s, f):
            touched.append(f.id)
    if touched:
        raise AppError(
            "finding_has_content", CONTENT_MESSAGE, 409, {"finding_id": touched[0], "finding_ids": touched}
        )


def review_boxes(handle: ProjectHandle, box_ids: list[str], action: str) -> ReviewOutcome:
    """Accept, reject or unreview proposals in bulk (spec 8.3).

    Unknown ids and person-drawn boxes are ignored. Accepting an edited box leaves it `edited`. An
    accepted defect proposal becomes a `reviewed` finding (F's hook); reject removes it; unreview
    removes it only while untouched, otherwise the whole request is 409 `finding_has_content` and
    nothing changes. Each affected image's summary is recomputed once.
    """
    now = datetime.now(UTC)
    changed = 0
    accepted_image_ids: set[str] = set()
    touched_images: dict[str, None] = {}
    runs: dict[str, QueryRun | None] = {}
    created: list[str] = []
    deleted: list[str] = []
    with handle.session() as s:
        # Materialised first: the hooks below query and flush on this session mid-loop.
        rows = s.execute(select(Box).where(Box.id.in_(box_ids))).scalars().all()
        if action == "unreview":
            _refuse_unreview_with_content(s, rows)
        for row in rows:
            if row.provenance_kind == "person":
                continue
            old = _entry(row)
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
            row.updated_at = now
            _count_transition(s, runs, row.query_run_id, old, _entry(row))
            deleted += hooks.on_box_changed(s, handle.id, handle.catalogue, row, accepted=created)
            touched_images[row.image_id] = None
            changed += 1
        clear_mark_for_ground_truth(s, accepted_image_ids)
        hooks.record_accepted(s, created)
        s.flush()
        for image_id in touched_images:
            summary.touch(s, image_id)
    trash.move(handle, deleted)
    return ReviewOutcome(changed, list(created), deleted)
