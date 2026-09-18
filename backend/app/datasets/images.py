"""Image queries and file serving for the Data Manager (spec sections 5 and 6).

Listing is keyset-paginated on (sort expression, id) so a virtualised grid can scroll a project
of thousands of frames without OFFSET scans.
"""

from __future__ import annotations

from datetime import UTC, datetime
from pathlib import Path

from PIL import Image as PILImage
from sqlalchemy import case, delete, func, select, tuple_
from sqlalchemy.orm import Session

from app.db.models import Box, DatasetImage, Image
from app.errors import AppError, not_found
from app.pagination import clamp_limit, decode_cursor, encode_cursor
from app.projects.service import ProjectHandle

ImageRow = tuple[Image, int, int, float | None]

GROUND_TRUTH = ("accepted", "edited")
THUMB_SIDE = 256
DERIVED_QUALITY = 85
EPOCH = datetime(1970, 1, 1, tzinfo=UTC)


def _box_stats():
    accepted = case((Box.review_state.in_(GROUND_TRUTH), 1), else_=0)
    pending = case((Box.review_state == "unreviewed", 1), else_=0)
    pending_conf = case((Box.review_state == "unreviewed", Box.confidence), else_=None)
    return (
        select(
            Box.image_id.label("image_id"),
            func.sum(accepted).label("box_count"),
            func.sum(pending).label("pending_count"),
            func.max(pending_conf).label("max_pending_confidence"),
        )
        .group_by(Box.image_id)
        .subquery()
    )


def _sort_expression(name: str, stats):
    box_count = func.coalesce(stats.c.box_count, 0)
    return {
        "path": Image.path,
        "source_id": Image.source_id,
        "group_key": Image.group_key,
        "created_at": Image.created_at,
        "capture_time": func.coalesce(Image.capture_time, EPOCH),
        "labeled": case((box_count > 0, 1), else_=0),
        "box_count": box_count,
        "pending_count": func.coalesce(stats.c.pending_count, 0),
        "max_pending_confidence": func.coalesce(stats.c.max_pending_confidence, -1.0),
    }[name]


def _parse_cursor_value(name: str, value):
    try:
        if name in ("created_at", "capture_time"):
            return datetime.fromisoformat(str(value))
        if name in ("labeled", "box_count", "pending_count"):
            return int(value)
        if name == "max_pending_confidence":
            return float(value)
        return str(value)
    except (TypeError, ValueError):
        raise AppError("validation_error", "invalid cursor", 422) from None


def _filtered(stats, *, source_id, group_key, labeled, has_pending, search, ids):
    q = select(Image).outerjoin(stats, stats.c.image_id == Image.id)
    if ids is not None:  # an explicit selection overrides every other filter
        return q.where(Image.id.in_(ids))
    if source_id:
        q = q.where(Image.source_id == source_id)
    if group_key:
        q = q.where(Image.group_key == group_key)
    if search:
        q = q.where(Image.path.icontains(search, autoescape=True))
    if labeled is not None:
        has_gt = func.coalesce(stats.c.box_count, 0) > 0
        q = q.where(has_gt if labeled else ~has_gt)
    if has_pending is not None:
        pending = func.coalesce(stats.c.pending_count, 0) > 0
        q = q.where(pending if has_pending else ~pending)
    return q


def list_images(
    handle: ProjectHandle,
    *,
    source_id: str | None = None,
    group_key: str | None = None,
    labeled: bool | None = None,
    has_pending: bool | None = None,
    search: str | None = None,
    ids: list[str] | None = None,
    sort: str = "path",
    order: str = "asc",
    limit: int | None = None,
    cursor: str | None = None,
) -> tuple[list[ImageRow], str | None, int]:
    n = clamp_limit(limit)
    stats = _box_stats()
    expr = _sort_expression(sort, stats)
    base = _filtered(
        stats,
        source_id=source_id,
        group_key=group_key,
        labeled=labeled,
        has_pending=has_pending,
        search=search,
        ids=ids,
    )
    q = base.add_columns(
        func.coalesce(stats.c.box_count, 0),
        func.coalesce(stats.c.pending_count, 0),
        stats.c.max_pending_confidence,
        expr.label("sort_value"),
    )
    ascending = order != "desc"
    q = q.order_by(expr.asc() if ascending else expr.desc(), Image.id.asc() if ascending else Image.id.desc())
    c = decode_cursor(cursor, "k", "id")
    if c:
        value = _parse_cursor_value(sort, c["k"])
        pair = tuple_(expr, Image.id)
        q = q.where(pair > (value, str(c["id"])) if ascending else pair < (value, str(c["id"])))

    with handle.session() as s:
        total = s.execute(select(func.count()).select_from(base.subquery())).scalar_one()
        found = list(s.execute(q.limit(n + 1)).all())
        for row in found:
            s.expunge(row[0])
    next_cursor = None
    if len(found) > n:
        found = found[:n]
        last = found[-1]
        next_cursor = encode_cursor(k=_cursor_value(last[4]), id=last[0].id)
    return [(r[0], int(r[1]), int(r[2]), r[3]) for r in found], next_cursor, total


def _cursor_value(value):
    return value.isoformat() if isinstance(value, datetime) else value


def get_image(handle: ProjectHandle, image_id: str) -> ImageRow:
    rows, _, _ = list_images(handle, ids=[image_id])
    if not rows:
        raise not_found("image", image_id)
    return rows[0]


def _resized_dir(handle: ProjectHandle) -> Path:
    return handle.folder / "cache" / "resized"


def _source_file(handle: ProjectHandle, image: Image) -> Path:
    path = handle.folder / image.path
    if not path.exists():
        raise not_found("image file", image.path)
    return path


def _write_derived(src: Path, dest: Path, max_side: int) -> Path:
    dest.parent.mkdir(parents=True, exist_ok=True)
    with PILImage.open(src) as im:
        im = im.convert("RGB")
        im.thumbnail((max_side, max_side), PILImage.LANCZOS)
        im.save(dest, "JPEG", quality=DERIVED_QUALITY, optimize=True)
    return dest


def image_file(handle: ProjectHandle, image_id: str, max_side: int | None) -> Path:
    image = get_image(handle, image_id)[0]
    src = _source_file(handle, image)
    if max_side is None or max_side >= max(image.width, image.height):
        return src
    dest = _resized_dir(handle) / f"{image.id}_{max_side}.jpg"
    return dest if dest.exists() else _write_derived(src, dest, max_side)


def thumbnail(handle: ProjectHandle, image_id: str) -> Path:
    image = get_image(handle, image_id)[0]
    src = _source_file(handle, image)
    dest = handle.thumbs_dir / f"{image.id}.jpg"
    return dest if dest.exists() else _write_derived(src, dest, THUMB_SIDE)


def _derived_files(handle: ProjectHandle, image_id: str) -> list[Path]:
    return [handle.thumbs_dir / f"{image_id}.jpg", *_resized_dir(handle).glob(f"{image_id}_*.jpg")]


def _frozen_into_datasets(s: Session, image_ids: list[str]) -> list[str]:
    return list(
        s.execute(select(DatasetImage.image_id).where(DatasetImage.image_id.in_(image_ids)).distinct())
        .scalars()
        .all()
    )


def bulk_delete(handle: ProjectHandle, image_ids: list[str]) -> int:
    """Remove images, their boxes and every derived file. The source folder is never touched."""
    with handle.session() as s:
        rows = list(s.execute(select(Image).where(Image.id.in_(image_ids))).scalars())
        if not rows:
            return 0
        frozen = _frozen_into_datasets(s, [r.id for r in rows])
        if frozen:
            raise AppError(
                "conflict",
                f"{len(frozen)} of the selected images are frozen into a dataset and cannot be deleted",
                409,
                {"image_ids": frozen},
            )
        paths = [handle.folder / r.path for r in rows]
        derived = [p for r in rows for p in _derived_files(handle, r.id)]
        s.execute(delete(Box).where(Box.image_id.in_([r.id for r in rows])))
        s.execute(delete(Image).where(Image.id.in_([r.id for r in rows])))
    for p in paths + derived:
        p.unlink(missing_ok=True)
    return len(rows)
