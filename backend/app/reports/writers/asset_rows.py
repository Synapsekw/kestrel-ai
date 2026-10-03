"""Rows for the asset_sightings CSV (spec 2026-10-02-asset-findings §10): every sighting of the
filtered asset findings, highest first (the kit's order: height down, severity down, photo), then the
posed photos of those asset models with no sighting in the report, with empty ids. Read 500 rows per
query; nothing holds every sighting at once."""

from __future__ import annotations

from collections.abc import Iterator
from datetime import UTC
from pathlib import PurePosixPath

from sqlalchemy import and_, case, func, select

from app.db.models import Finding, FindingSighting, Image, ImagePose, ImageReview, ProjectType
from app.findings.numbers import format_number
from app.reports.asset_info import ASSET, NOT_PLACED, PLACED, load_asset_models
from app.reports.context import UNGRADED

PAGE = 500
REVIEW_LABEL = {
    "finding": "Finding",
    "none": "No finding",
    "uncertain": "Uncertain",
    "not_assessed": "Not assessed",
}


def _name(img: Image) -> str:
    return img.original_name or PurePosixPath(img.path).name


def _captured(img: Image) -> str:
    t = img.capture_time
    if t is None:
        return ""
    t = t if t.tzinfo is not None else t.replace(tzinfo=UTC)
    return t.astimezone(UTC).strftime("%Y-%m-%d %H:%M:%S")


def _level_name(scale: dict, sev: int | None) -> str:
    if sev is None:
        return UNGRADED
    level = scale.get(sev)
    return level.name if level is not None else f"Level {sev}"


def _sighting_values(sg, f, img, pose, info, types: dict, scale: dict) -> list:
    from app.asset_review.derive import derive  # P1

    sev = sg.severity if sg.severity is not None else f.severity
    # A box edit sets placement to pending and leaves cx..nz stale: only a placed sighting has a centre.
    placed = sg.placement in PLACED
    center = (sg.cx, sg.cy, sg.cz) if placed and None not in (sg.cx, sg.cy, sg.cz) else None
    normal = (sg.nx, sg.ny, sg.nz) if placed and None not in (sg.nx, sg.ny, sg.nz) else None
    d = (
        derive(center, normal, info.review, info.frame)
        if center and info and info.review and info.frame
        else None
    )
    height = d.height_m if d is not None else (center[1] if center else None)
    return [
        "",
        format_number(f.number),
        img.id,
        _name(img),
        sev,
        _level_name(scale, sev),
        types.get(f.type_id, f.type_id),
        sg.part or f.component or "",
        (info.zone_label(d.zone) or "") if d is not None and d.zone and info is not None else "",
        f"{height:.2f}" if height is not None else "",
        d.side if d is not None and d.side else NOT_PLACED,
        f"{d.bearing_deg:.0f}" if d is not None and d.bearing_deg is not None else "",
        "yes" if placed else "no",
        f"{(sg.coverage or 0.0) * 100:.4f}",
        f.note or None,
        None,
        pose.sequence if pose is not None else None,
        _captured(img),
        img.lat,
        img.lon,
        img.alt,
    ]


def sighting_rows(handle, where, *, scale: dict) -> Iterator[list]:
    infos = load_asset_models(handle)
    with handle.session() as s:
        types = {t.type_id: t.name for t in s.execute(select(ProjectType)).scalars()}
        total = s.execute(
            select(func.count())
            .select_from(FindingSighting)
            .join(Finding, Finding.id == FindingSighting.finding_id)
            .where(where, ASSET)
        ).scalar_one()
    width = max(2, len(str(total)))
    sev = func.coalesce(FindingSighting.severity, Finding.severity)
    placed_y = case((FindingSighting.placement.in_(PLACED), FindingSighting.cy), else_=None)
    q = (
        select(FindingSighting, Finding, Image, ImagePose)
        .join(Finding, Finding.id == FindingSighting.finding_id)
        .join(Image, Image.id == FindingSighting.image_id)
        .outerjoin(
            ImagePose,
            and_(
                ImagePose.image_id == FindingSighting.image_id,
                ImagePose.asset_model_id == Finding.asset_model_id,
            ),
        )
        .where(where, ASSET)
        .order_by(
            placed_y.is_(None),
            placed_y.desc(),
            sev.is_(None),
            sev.desc(),
            func.coalesce(Image.original_name, Image.path),
            FindingSighting.id,
        )
    )
    n, offset = 0, 0
    while True:
        with handle.session() as s:
            page = s.execute(q.offset(offset).limit(PAGE)).all()
            rows = [
                _sighting_values(sg, f, img, pose, infos.get(f.asset_model_id), types, scale)
                for sg, f, img, pose in page
            ]
        for row in rows:
            n += 1
            row[0] = "F" + str(n).zfill(width)
            yield row
        if len(page) < PAGE:
            return
        offset += PAGE


def photo_rows(handle, where) -> Iterator[list]:
    """Posed photos of the report's asset models with no sighting of a reported finding (kit: the
    photos without findings, for completeness). An image posed on two models prints once."""
    reported = select(Finding.id).where(where, ASSET)
    models = select(Finding.asset_model_id).where(where, ASSET)
    seen = select(FindingSighting.image_id).where(FindingSighting.finding_id.in_(reported))
    q = (
        select(Image, ImagePose, ImageReview)
        .join(ImagePose, ImagePose.image_id == Image.id)
        .outerjoin(ImageReview, ImageReview.image_id == Image.id)
        .where(ImagePose.asset_model_id.in_(models), Image.id.not_in(seen))
        .order_by(func.coalesce(Image.original_name, Image.path), Image.id, ImagePose.asset_model_id)
    )
    last, offset = None, 0
    while True:
        with handle.session() as s:
            page = s.execute(q.offset(offset).limit(PAGE)).all()
            rows = []
            for img, pose, review in page:
                if img.id == last:
                    continue
                last = img.id
                # Kit parity: a photo without findings keeps the pose-target height. The "never the camera
                # target" rule is for sightings.
                target = pose.target if isinstance(pose.target, list) and len(pose.target) == 3 else None
                rows.append(
                    [
                        "",
                        "",
                        img.id,
                        _name(img),
                        "",
                        REVIEW_LABEL.get(review.status, "Not assessed")
                        if review is not None
                        else "Not assessed",
                        "",
                        "",
                        "",
                        f"{float(target[1]):.2f}" if target is not None else "",
                        "",
                        "",
                        "no",
                        f"{((review.coverage if review is not None else None) or 0.0) * 100:.4f}",
                        (review.note or None) if review is not None else None,
                        None,
                        pose.sequence,
                        _captured(img),
                        img.lat,
                        img.lon,
                        img.alt,
                    ]
                )
        yield from rows
        if len(page) < PAGE:
            return
        offset += PAGE


def csv_rows(handle, where, *, scale: dict) -> Iterator[list]:
    yield from sighting_rows(handle, where, scale=scale)
    yield from photo_rows(handle, where)
