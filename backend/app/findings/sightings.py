"""Sightings of asset findings (spec 2026-10-02-asset-findings §5.5, §5.6, §6.4; decisions A1, A2, A4).

A sighting is one box (box, rbox, polygon or point) on one photo. The box row stays the geometry,
and `image_summary` still counts it.

This module is the one place that adds and removes sightings. It is also the one place that writes
a finding's derived asset columns from its representative sighting. A finding left with no sighting
is closed with a comment, never deleted.
"""

from __future__ import annotations

from collections.abc import Iterable, Sequence

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.db.base import utcnow
from app.db.models import AssetModel, Finding, FindingSighting, Image
from app.findings import comments, events, service

PLACED = ("point", "patch")
SYSTEM_AUTHOR = "Kestrel"
BOX_GONE = "Closed by Kestrel: the last photo box behind this finding was deleted."
NOT_A_SIGHTING = "Closed by Kestrel: its last photo box is no longer a defect sighting."
PHOTOS_GONE = "Closed by Kestrel: the photos behind this finding were deleted."


def is_placed(row: FindingSighting) -> bool:
    return row.placement in PLACED and row.cx is not None


def sort_key(row: FindingSighting) -> tuple:
    """Sorts the representative first (spec §6.4): the highest severity, then placed, then the
    largest coverage. Ties go to the older sighting, then the id, so the choice is stable."""
    return (
        -(row.severity if row.severity is not None else 0),
        0 if is_placed(row) else 1,
        -(row.coverage or 0.0),
        row.created_at,
        row.id,
    )


def pick_representative(rows: Sequence[FindingSighting]) -> FindingSighting | None:
    return min(rows, key=sort_key) if rows else None


def of_finding(s: Session, finding_id: str) -> list[FindingSighting]:
    q = (
        select(FindingSighting)
        .where(FindingSighting.finding_id == finding_id)
        .order_by(FindingSighting.created_at, FindingSighting.id)
    )
    return list(s.execute(q).scalars())


def of_box(s: Session, box_id: str) -> FindingSighting | None:
    return s.execute(
        select(FindingSighting).where(FindingSighting.annotation_id == box_id)
    ).scalar_one_or_none()


def box_ids(s: Session, finding_id: str) -> list[str]:
    return list(
        s.execute(
            select(FindingSighting.annotation_id).where(FindingSighting.finding_id == finding_id)
        ).scalars()
    )


def representatives(s: Session, finding_ids: Iterable[str]) -> dict[str, dict]:
    """`{finding_id: {image_id, annotation_id}}` for the asset findings among `finding_ids` (one
    register page, at most 500). One read of their sightings."""
    ids = list(dict.fromkeys(finding_ids))
    if not ids:
        return {}
    by: dict[str, list[FindingSighting]] = {}
    for row in s.execute(select(FindingSighting).where(FindingSighting.finding_id.in_(ids))).scalars():
        by.setdefault(row.finding_id, []).append(row)
    out = {}
    for fid, rows in by.items():
        rep = pick_representative(rows)
        out[fid] = {"image_id": rep.image_id, "annotation_id": rep.annotation_id}
    return out


def add_sighting(
    s: Session,
    handle,
    *,
    asset_model_id: str,
    finding_id: str | None,
    image_id: str,
    type_id: str,
    box: dict | None = None,
    points: list[list[float]] | None = None,
    severity: int | None = None,
    group_tag: str | None = None,
) -> FindingSighting:
    """Draw the sighting's box through the annotation service (its shape rules, cap and area), with
    no finding hook, then add the sighting row as `pending` (not placed yet). With `points` it is a
    polygon; otherwise `box` is the rectangle `{x, y, w, h, angle}` in image pixels. J5's import
    passes `finding_id=None`: grouping assigns it."""
    from app.imagery import annotations as boxes  # imagery imports this package's hooks
    from app.imagery import summary

    if points is not None:
        row, _ = boxes.create_shape_in_session(s, handle, image_id, type_id, shape="polygon", points=points)
    else:
        row, _ = boxes.create_shape_in_session(s, handle, image_id, type_id, shape="box", **(box or {}))
    summary.touch(s, image_id)
    sighting = FindingSighting(
        asset_model_id=asset_model_id,
        finding_id=finding_id,
        image_id=image_id,
        annotation_id=row.id,
        severity=severity,
        group_tag=group_tag,
        placement="pending",
    )
    s.add(sighting)
    s.flush()
    return sighting


def _derived(model: AssetModel | None, center, normal) -> dict:
    out = {"height_m": None, "bearing_deg": None, "side": None, "zone": None}
    if center is None:
        return out  # unplaced: no height, zone or side, never the camera target (plan R7)
    if model is None or model.review is None or model.frame is None:
        out["height_m"] = float(center[1])
        return out
    from app.asset_review.derive import derive
    from app.asset_review.frame import Frame
    from app.asset_review.profiles import ReviewConfig

    d = derive(center, normal, ReviewConfig.model_validate(model.review), Frame.model_validate(model.frame))
    return {"height_m": d.height_m, "bearing_deg": d.bearing_deg, "side": d.side, "zone": d.zone}


def refresh(s: Session, finding: Finding) -> FindingSighting | None:
    """Recompute `sighting_count` and the anchor point, normal, placement, component and derived
    fields from the representative sighting. Severity, status and note are the operator's and are
    never touched here. Returns the representative."""
    rows = of_finding(s, finding.id)
    rep = pick_representative(rows)
    placed = rep is not None and is_placed(rep)
    center = (rep.cx, rep.cy, rep.cz) if placed else None
    normal = (rep.nx, rep.ny, rep.nz) if placed and None not in (rep.nx, rep.ny, rep.nz) else None
    model = s.get(AssetModel, finding.asset_model_id) if finding.asset_model_id else None
    finding.sighting_count = len(rows)
    finding.ax, finding.ay, finding.az = center if center else (None, None, None)
    finding.an_x, finding.an_y, finding.an_z = normal if normal else (None, None, None)
    # The contract: null while the representative is pending (or there is none), `none` when its
    # ray missed the model (controller ruling R1).
    finding.placement = rep.placement if rep is not None and rep.placement != "pending" else None
    finding.component = rep.part if rep is not None else None
    if placed and rep.placed_version is not None:
        finding.asset_version = rep.placed_version
    for key, value in _derived(model, center, normal).items():
        setattr(finding, key, value)
    finding.updated_at = utcnow()
    return rep


def _file_name(image: Image | None) -> str:
    return image.path.rsplit("/", 1)[-1] if image is not None else ""


def listing(s: Session, finding: Finding) -> list[dict]:
    """`GET /findings/{findingId}/sightings` as contract `FindingSighting` dicts: the representative
    first, then by the photo's capture time (none last), then created_at and id. An image finding is
    its one implicit sighting (decision A2); a map or cloud finding has none. One read of the
    finding's sightings, one of their photos and one of their models (bounded by one finding)."""
    if finding.anchor_kind == "image":
        if not finding.annotation_id:
            return []
        image = s.get(Image, finding.image_id)
        return [
            {
                "id": finding.annotation_id,
                "asset_model_id": "",
                "finding_id": finding.id,
                "image_id": finding.image_id,
                "annotation_id": finding.annotation_id,
                "image_name": _file_name(image),
                "captured_at": image.capture_time if image is not None else None,
                "severity": finding.severity,
                "group_tag": None,
                "placement": "none",
                "center": None,
                "normal": None,
                "part": None,
                "coverage": None,
                "placed_version": None,
                "stale": False,
                **dict.fromkeys(("height_m", "bearing_deg", "side", "zone")),
                "created_at": finding.created_at,
            }
        ]
    if finding.anchor_kind != "asset":
        return []
    rows = of_finding(s, finding.id)
    if not rows:
        return []
    image_ids = {r.image_id for r in rows}
    images = {i.id: i for i in s.execute(select(Image).where(Image.id.in_(image_ids))).scalars()}
    model_ids = {r.asset_model_id for r in rows}
    models = {m.id: m for m in s.execute(select(AssetModel).where(AssetModel.id.in_(model_ids))).scalars()}
    rep = pick_representative(rows)

    def by_capture(r: FindingSighting) -> tuple:
        taken = images[r.image_id].capture_time if r.image_id in images else None
        return (taken is None, taken.timestamp() if taken else 0.0, r.created_at, r.id)

    ordered = [rep, *sorted((r for r in rows if r is not rep), key=by_capture)]
    out = []
    for r in ordered:
        image, model = images.get(r.image_id), models.get(r.asset_model_id)
        placed = is_placed(r)
        center = [r.cx, r.cy, r.cz] if placed else None
        normal = [r.nx, r.ny, r.nz] if placed and None not in (r.nx, r.ny, r.nz) else None
        current = model.current_version if model is not None else None
        out.append(
            {
                "id": r.id,
                "asset_model_id": r.asset_model_id,
                "finding_id": r.finding_id,
                "image_id": r.image_id,
                "annotation_id": r.annotation_id,
                "image_name": _file_name(image),
                "captured_at": image.capture_time if image is not None else None,
                "severity": r.severity,
                "group_tag": r.group_tag,
                "placement": r.placement,
                "center": center,
                "normal": normal,
                "part": r.part,
                "coverage": r.coverage,
                "placed_version": r.placed_version,
                "stale": r.placed_version is not None and current is not None and r.placed_version < current,
                **_derived(model, center, normal),
                "created_at": r.created_at,
            }
        )
    return out


def close_with_comment(
    s: Session, *, project_id: str, catalogue, finding: Finding, text: str, author: str = SYSTEM_AUTHOR
) -> None:
    """Close `finding` through the service (counts and the `finding.status` activity) and say why in
    its thread. Its note, comments and photos stay; nothing is deleted."""
    if finding.status != "closed":
        service.patch_in_session(
            s, project_id=project_id, catalogue=catalogue, finding_id=finding.id, fields={"status": "closed"}
        )
    comments.add(s, project_id=project_id, finding_id=finding.id, text=text, author=author)


def remove(
    s: Session, *, project_id: str, catalogue, rows: Sequence[FindingSighting], reason: str
) -> list[str]:
    """Delete these sighting rows and refresh each finding they belonged to. The caller deletes
    their boxes after this. A finding left with none is closed, with `reason` as a comment.
    Returns the ids of the findings that changed."""
    touched = sorted({r.finding_id for r in rows if r.finding_id})
    for r in rows:
        s.delete(r)
    s.flush()
    for fid in touched:
        f = s.get(Finding, fid)
        if f is None:
            continue
        refresh(s, f)
        if f.sighting_count == 0:
            close_with_comment(s, project_id=project_id, catalogue=catalogue, finding=f, text=reason)
    events.mark_changed(s, project_id, touched)
    return touched
