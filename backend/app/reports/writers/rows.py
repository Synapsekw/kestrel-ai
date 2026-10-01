"""One row per finding for findings.csv / findings.xlsx (spec 2026-09-26-reports §11.1).

Rows are built from pages of 200 ids with one query per table, never from every finding's ORM row
at once. The severity scale, `observed_on`, `data_item` and `area_m2` reuse R2's
`app.reports.context` / `app.reports.observed` helpers rather than a local duplicate
(Ruling P4, index reconciliation item 4)."""

from __future__ import annotations

from collections.abc import Iterator
from pathlib import PurePosixPath

from sqlalchemy import func, select

from app.db.models import Box, Finding, FindingAttachment, FindingComment, GeoMap, Image, ProjectType
from app.findings.anchors import centroid
from app.findings.numbers import format_number
from app.geometry import centre_of
from app.reports.context import UNGRADED, Level
from app.reports.observed import area_m2 as _area_m2
from app.reports.observed import host_label, observed_day

PAGE = 200
COLUMNS = [
    "number",
    "type",
    "type_kind",
    "severity_level",
    "severity_name",
    "status",
    "observed_on",
    "data_item",
    "data_item_type",
    "anchor_kind",
    "image_file",
    "px_x",
    "px_y",
    "map_x",
    "map_y",
    "map_crs",
    "lon",
    "lat",
    "cloud_x",
    "cloud_y",
    "cloud_z",
    "uncertainty_m",
    "area_m2",
    "note",
    "created_by",
    "confidence",
    "photos",
    "comments",
    "created_at",
    "updated_at",
    "report_version",
]
MEASUREMENT_COLUMNS = [
    "kind",
    "sub_kind",
    "name",
    "headline",
    "unit",
    "status",
    "data_type",
    "data_id",
    "created_at",
    "updated_at",
]


def _box_centre(box: Box) -> tuple[float, float]:
    if box.shape == "polygon" and box.points:
        n = len(box.points)
        return sum(p[0] for p in box.points) / n, sum(p[1] for p in box.points) / n
    return centre_of(box.x, box.y, box.w, box.h)


def _iso(value) -> str | None:
    return value.isoformat() if value is not None else None


def _page(s, ids: list[str], scale: dict[int, Level], types: dict, version_number: int) -> list[dict]:
    found = {f.id: f for f in s.execute(select(Finding).where(Finding.id.in_(ids))).scalars()}
    fs = list(found.values())
    image_ids = {f.image_id for f in fs if f.image_id}
    images = {i.id: i for i in s.execute(select(Image).where(Image.id.in_(image_ids))).scalars()}
    boxes = {
        b.id: b
        for b in s.execute(
            select(Box).where(Box.id.in_({f.annotation_id for f in fs if f.annotation_id}))
        ).scalars()
    }
    maps = {
        m.id: m
        for m in s.execute(select(GeoMap).where(GeoMap.id.in_({f.map_id for f in fs if f.map_id}))).scalars()
    }
    photos = dict(
        s.execute(
            select(FindingAttachment.finding_id, func.count())
            .where(FindingAttachment.finding_id.in_(ids))
            .group_by(FindingAttachment.finding_id)
        ).all()
    )
    comments = dict(
        s.execute(
            select(FindingComment.finding_id, func.count())
            .where(FindingComment.finding_id.in_(ids))
            .group_by(FindingComment.finding_id)
        ).all()
    )
    out = []
    for fid in ids:
        f = found.get(fid)
        if f is None:
            continue  # deleted since the id list was read
        type_name, type_kind = types.get(f.type_id, (f.type_id, ""))
        level = scale.get(f.severity) if f.severity is not None else None
        row = {c: None for c in COLUMNS}
        row.update(
            number=format_number(f.number),
            type=type_name,
            type_kind=type_kind,
            severity_level=f.severity,
            severity_name=UNGRADED if f.severity is None else (level.name if level else str(f.severity)),
            status=f.status,
            observed_on=observed_day(s, f).isoformat(),
            data_item=host_label(s, f) or None,
            data_item_type=f.data_type,
            anchor_kind=f.anchor_kind,
            lon=f.lon,
            lat=f.lat,
            area_m2=_area_m2(s, f),
            note=f.note,
            created_by=f.created_by,
            confidence=f.confidence,
            photos=photos.get(f.id, 0),
            comments=comments.get(f.id, 0),
            created_at=_iso(f.created_at),
            updated_at=_iso(f.updated_at),
            report_version=version_number,
        )
        if f.anchor_kind == "image":
            image = images.get(f.image_id)
            box = boxes.get(f.annotation_id)
            if image is not None:
                row["image_file"] = PurePosixPath(image.path).name
            if box is not None:
                px, py = _box_centre(box)
                row["px_x"], row["px_y"] = round(px, 1), round(py, 1)
        elif f.anchor_kind == "map":
            m = maps.get(f.map_id)
            if f.geometry:
                row["map_x"], row["map_y"] = centroid(f.geometry)
            if m is not None:
                row["map_crs"] = f"EPSG:{m.epsg}" if m.epsg else ("custom" if m.crs_wkt else "")
        elif f.anchor_kind == "cloud":
            row["cloud_x"], row["cloud_y"], row["cloud_z"] = f.x, f.y, f.z
            row["uncertainty_m"] = f.uncertainty_m
        out.append(row)
    return out


def export_rows(
    handle, finding_ids: list[str], *, scale: dict[int, Level], version_number: int
) -> Iterator[dict]:
    """Rows in `finding_ids` order, read 200 ids at a time; an id deleted meanwhile is skipped."""
    with handle.session() as s:
        types = {t.type_id: (t.name, t.kind) for t in s.execute(select(ProjectType)).scalars()}
    for start in range(0, len(finding_ids), PAGE):
        chunk = finding_ids[start : start + PAGE]
        with handle.session() as s:
            page = _page(s, chunk, scale, types, version_number)
        yield from page  # the session is closed while the caller writes


def measurement_rows(handle) -> Iterator[dict]:
    """Every measurement of the project through M's union, 200 at a time (ruling 9)."""
    from app.measurements.union import list_page

    cursor = None
    while True:
        page = list_page(handle, limit=PAGE, cursor=cursor)
        for m in page.items:
            yield {
                "kind": m.kind,
                "sub_kind": m.sub_kind,
                "name": m.name,
                "headline": m.headline,
                "unit": m.unit,
                "status": m.status,
                "data_type": m.data_type,
                "data_id": m.data_id,
                "created_at": _iso(m.created_at),
                "updated_at": _iso(m.updated_at),
            }
        if page.next_cursor is None:
            return
        cursor = page.next_cursor
