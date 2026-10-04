"""Sightings from a kit (spec 2026-10-02-asset-findings §6.5 step 5).

Each becomes a `box` row (a polygon or a rectangle, rescaled from the kit's preview grid to the
stored image's pixels) and a `finding_sighting` with no finding yet: grouping makes the findings.
Writes go through J4's `add_sighting`, at most CHUNK per commit. `undo_records` removes what this
job wrote when it is cancelled or fails before the records are complete.
"""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path

import numpy as np
from sqlalchemy import delete

from app.asset_review.kit_format import UNCLASSIFIED, Kit
from app.asset_review.kit_masks import MIN_REGION_PX, load_mask, vectorise
from app.asset_review.kit_match import Match
from app.db.models import Box, FindingSighting, ImagePose
from app.errors import AppError
from app.findings import sightings
from app.imagery import summary

CHUNK = 200
DELETE_CHUNK = 500
PART_MAX = 200
REGION_MIN_SHARE = 0.0002  # a mask region counts from 0.02% of the photo (coordinator ruling on N7)
MAX_REGIONS = 50  # per photo, largest first


@dataclass(frozen=True)
class Planned:
    kit_key: str  # the kit finding id (region unit) or the kit photo id (photo unit)
    kit_photo: str
    image_id: str
    type_id: str
    severity: int
    group_tag: str | None
    part: str | None
    note: str
    order: int
    polygon: list[list[float]] | None  # stored-image px
    rect: tuple[float, float, float, float] | None  # x, y, w, h in stored-image px
    coverage: float | None
    mask_path: Path | None = None  # photo unit: the source mask, kept as a finding attachment
    primary: bool = True  # photo unit: the photo's largest region (it takes the replayed patch)


@dataclass(frozen=True)
class Written:
    sighting_id: str
    box_id: str
    image_id: str
    kit_key: str
    kit_photo: str
    severity: int
    note: str
    order: int
    mask_path: Path | None
    primary: bool = True


def shoelace(points: list[list[float]]) -> float:
    n = len(points)
    return (
        abs(
            sum(
                points[i][0] * points[(i + 1) % n][1] - points[(i + 1) % n][0] * points[i][1]
                for i in range(n)
            )
        )
        / 2
    )


def scale_points(points: list[list[float]], sx: float, sy: float) -> list[list[float]]:
    return [[x * sx, y * sy] for x, y in points]


def rect_in_image(
    bbox, sx: float, sy: float, width: int, height: int
) -> tuple[float, float, float, float] | None:
    """A preview-px box (x0, y0, x1, y1) as a stored-image rectangle clamped to the image; None
    when less than a pixel is left."""
    x0, y0, x1, y1 = bbox
    x0, x1 = max(0.0, min(width, x0 * sx)), max(0.0, min(width, x1 * sx))
    y0, y1 = max(0.0, min(height, y0 * sy)), max(0.0, min(height, y1 * sy))
    if x1 - x0 < 1 or y1 - y0 < 1:
        return None
    return (x0, y0, x1 - x0, y1 - y0)


def plan_region(
    kit: Kit,
    matches: dict[str, Match],
    previews: dict[str, tuple[int, int]],
    class_map: dict[str, str],
    skipped: list,
) -> list[Planned]:
    classes = {c.key: c for c in kit.classes}
    planned: list[Planned] = []
    for f in kit.findings:
        m = matches.get(f.photo)
        if m is None:
            skipped.append({"kit_key": f.key, "reason": "photo_unmatched"})
            continue
        key = f.cls or UNCLASSIFIED
        pw, ph = previews[f.photo]
        sx, sy = m.width / pw, m.height / ph
        polygon = scale_points(f.polygon, sx, sy) if f.polygon else None
        rect = rect_in_image(f.bbox, sx, sy, m.width, m.height) if f.bbox else None
        if polygon is None and rect is None:
            skipped.append({"kit_key": f.key, "reason": "no_geometry"})
            continue
        if f.polygon:
            area = shoelace(f.polygon)
        else:
            x0, y0, x1, y1 = f.bbox
            area = (x1 - x0) * (y1 - y0)
        cdef = classes.get(key)
        severity = f.severity or (cdef.severity if cdef else None) or kit.status_of(f.photo)["severity"] or 1
        planned.append(
            Planned(
                kit_key=f.key,
                kit_photo=f.photo,
                image_id=m.image_id,
                type_id=class_map[key],
                severity=int(severity),
                group_tag=f.group,
                part=f.component,
                note=f.note,
                order=f.order,
                polygon=polygon,
                rect=rect,
                coverage=round(area / (pw * ph), 6),
            )
        )
    return planned


def plan_photo(
    ctx, kit: Kit, matches: dict[str, Match], class_map: dict[str, str], skipped: list
) -> list[Planned]:
    """One sighting per mask region of each matched finding photo (spec §6.5 step 5, photo unit,
    with the coordinator's ruling on N7). The largest region is the photo's primary sighting: it
    takes the replayed patch and the mask attachment, and its note is the finding's."""
    graded = kit.finding_class_ids()
    grade_of = {c.id: c.severity for c in kit.classes if not c.uncertain and c.severity}
    todo = [k for k in matches if kit.status_of(k)["status"] == "finding"]
    planned: list[Planned] = []
    for i, kit_id in enumerate(todo):
        ctx.check_cancelled()
        ctx.progress(0.15 + 0.01 * i / max(1, len(todo)), f"Reading masks {i:,} / {len(todo):,}")
        path = kit.mask_path(kit_id)
        if path is None:
            skipped.append({"kit_key": kit_id, "reason": "no_mask"})
            continue
        m, st = matches[kit_id], kit.status_of(kit_id)
        mask = load_mask(path)
        ph, pw = mask.shape
        sx, sy = m.width / pw, m.height / ph
        min_area = max(MIN_REGION_PX, REGION_MIN_SHARE * pw * ph)
        rings = vectorise(mask, graded, min_area=min_area, max_regions=MAX_REGIONS)
        if not rings:
            skipped.append({"kit_key": kit_id, "reason": "empty_mask"})
            continue
        present = {int(v) for v in np.unique(mask)}
        mask_grade = max((grade_of[c] for c in present if c in grade_of), default=None)
        severity = int(st["severity"] or mask_grade or 1)
        type_id = class_map[kit.photo_unit_key(st["severity"])]
        for n, ring in enumerate(rings):
            xs, ys = [p[0] for p in ring], [p[1] for p in ring]
            planned.append(
                Planned(
                    kit_key=kit_id if n == 0 else f"{kit_id}#{n}",
                    kit_photo=kit_id,
                    image_id=m.image_id,
                    type_id=type_id,
                    severity=severity,
                    group_tag=None,
                    part=None,
                    note=st["note"],
                    order=i * 100 + n,
                    polygon=scale_points(ring, sx, sy),
                    rect=rect_in_image((min(xs), min(ys), max(xs), max(ys)), sx, sy, m.width, m.height),
                    coverage=shoelace(ring) / (pw * ph),
                    mask_path=path if n == 0 else None,
                    primary=n == 0,
                )
            )
    return planned


def plan_sightings(ctx, kit: Kit, matches, previews, class_map, skipped) -> list[Planned]:
    if kit.unit == "photo":
        return plan_photo(ctx, kit, matches, class_map, skipped)
    return plan_region(kit, matches, previews, class_map, skipped)


def _add(s, handle, asset_model_id: str, p: Planned) -> FindingSighting | None:
    kw = {
        "asset_model_id": asset_model_id,
        "finding_id": None,
        "image_id": p.image_id,
        "type_id": p.type_id,
        "severity": p.severity,
        "group_tag": p.group_tag,
    }
    if p.polygon is not None:
        try:
            return sightings.add_sighting(s, handle, points=p.polygon, **kw)
        except AppError:
            pass  # a polygon the shape rules reject (empty after clipping): its box stands in
    if p.rect is not None:
        x, y, w, h = p.rect
        try:
            return sightings.add_sighting(s, handle, box={"x": x, "y": y, "w": w, "h": h, "angle": 0.0}, **kw)
        except AppError:
            return None
    return None


def write_sightings(
    handle, ctx, asset_model_id: str, planned: list[Planned], written: list[Written], skipped: list
) -> None:
    """At most CHUNK sightings per commit; `written` grows as each commits, for the undo."""
    chunk = CHUNK
    total = len(planned)
    for start in range(0, total, chunk):
        ctx.check_cancelled()
        batch: list[Written] = []
        images: set[str] = set()
        with handle.session() as s:
            for p in planned[start : start + chunk]:
                row = _add(s, handle, asset_model_id, p)
                if row is None:
                    skipped.append({"kit_key": p.kit_key, "reason": "invalid_geometry"})
                    continue
                row.part = p.part[:PART_MAX] if p.part else None
                row.coverage = p.coverage
                batch.append(
                    Written(
                        row.id,
                        row.annotation_id,
                        p.image_id,
                        p.kit_key,
                        p.kit_photo,
                        p.severity,
                        p.note,
                        p.order,
                        p.mask_path,
                        p.primary,
                    )
                )
                images.add(p.image_id)
        written.extend(batch)
        ctx.publish("boxes.changed", {"image_ids": sorted(images)})
        done = min(start + chunk, total)
        ctx.progress(0.16 + 0.29 * done / max(1, total), f"Writing sightings {done:,} / {total:,}")


def undo_records(handle, asset_model_id: str, written: list[Written], pose_ids: list[str]) -> None:
    """Delete this job's sightings, their boxes and its kit poses again."""
    sids = [w.sighting_id for w in written]
    bids = [w.box_id for w in written]
    with handle.session() as s:
        for i in range(0, len(sids), DELETE_CHUNK):
            s.execute(delete(FindingSighting).where(FindingSighting.id.in_(sids[i : i + DELETE_CHUNK])))
        for i in range(0, len(bids), DELETE_CHUNK):
            s.execute(delete(Box).where(Box.id.in_(bids[i : i + DELETE_CHUNK])))
        summary.touch_many(s, {w.image_id for w in written})
        for i in range(0, len(pose_ids), DELETE_CHUNK):
            s.execute(
                delete(ImagePose).where(
                    ImagePose.asset_model_id == asset_model_id,
                    ImagePose.source == "kit",
                    ImagePose.image_id.in_(pose_ids[i : i + DELETE_CHUNK]),
                )
            )
