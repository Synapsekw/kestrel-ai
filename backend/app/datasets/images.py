"""Image queries and file serving for the Data Manager (spec sections 5 and 6).

Listing is keyset-paginated on (sort expression, id) so a virtualised grid can scroll a project
of thousands of frames without OFFSET scans.
"""

from __future__ import annotations

import os
from datetime import datetime
from pathlib import Path
from typing import NamedTuple
from uuid import uuid4

from PIL import Image as PILImage
from sqlalchemy import delete, func, select, tuple_
from sqlalchemy.orm import Session

from app.db.models import Box, DatasetImage, Image, QueryRun, Source
from app.detect.counts import recount_query_run
from app.errors import AppError, not_found
from app.findings import annotations, trash
from app.imagery import filters as image_filters
from app.imagery.filters import ImageFilters
from app.pagination import clamp_limit, decode_cursor, encode_cursor
from app.projects.service import ProjectHandle

THUMB_SIDE = 256
DERIVED_QUALITY = 85


class ImageRow(NamedTuple):
    image: Image
    box_count: int
    pending_count: int
    max_pending_confidence: float | None
    finding_count: int = 0
    worst_severity: int | None = None


def _parse_cursor_value(name: str, value):
    try:
        if name in ("created_at", "capture_time"):
            return datetime.fromisoformat(str(value))
        if name in ("labeled", "box_count", "pending_count", "worst_severity"):
            return int(value)
        if name == "max_pending_confidence":
            return float(value)
        return str(value)
    except (TypeError, ValueError):
        raise AppError("validation_error", "invalid cursor", 422) from None


def list_images(
    handle: ProjectHandle,
    *,
    filters: ImageFilters | None = None,
    ids: list[str] | None = None,
    sort: str = "path",
    order: str = "asc",
    limit: int | None = None,
    cursor: str | None = None,
) -> tuple[list[ImageRow], str | None, int]:
    n = clamp_limit(limit)
    f = filters or ImageFilters()
    st = image_filters.stats(f)
    expr = image_filters.sort_expression(sort, st)
    base = image_filters.join_stats(select(Image), st)
    # An explicit selection overrides every other filter (contract: `ids`).
    base = base.where(Image.id.in_(ids)) if ids is not None else image_filters.where(base, f, st)
    q = base.add_columns(
        st.annotation_count,
        st.pending_count,
        st.max_pending_conf,
        st.finding_count,
        st.worst_severity,
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
        next_cursor = encode_cursor(k=_cursor_value(last[6]), id=last[0].id)
    rows = [ImageRow(r[0], int(r[1]), int(r[2]), r[3], int(r[4]), r[5]) for r in found]
    return rows, next_cursor, total


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
    """Write through a private temp name and rename: a concurrent reader sees all of it or none."""
    dest.parent.mkdir(parents=True, exist_ok=True)
    tmp = dest.with_name(f"{dest.name}.{uuid4().hex}.tmp")
    try:
        with PILImage.open(src) as im:
            im = im.convert("RGB")
            im.thumbnail((max_side, max_side), PILImage.LANCZOS)
            im.save(tmp, "JPEG", quality=DERIVED_QUALITY, optimize=True)
        os.replace(tmp, dest)
    finally:
        tmp.unlink(missing_ok=True)
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
        source_ids = {r.source_id for r in rows}
        run_ids = set(
            s.execute(
                select(Box.query_run_id)
                .where(Box.image_id.in_([r.id for r in rows]), Box.query_run_id.is_not(None))
                .distinct()
            ).scalars()
        )
        # The findings go first: a finding's annotation_id foreign key refuses an orphaning DELETE.
        trashed = annotations.on_images_deleting(s, handle.id, [r.id for r in rows])
        s.execute(delete(Box).where(Box.image_id.in_([r.id for r in rows])))
        s.execute(delete(Image).where(Image.id.in_([r.id for r in rows])))
        s.flush()
        # The photo runs that lost boxes keep their counts true in the same transaction.
        for run_id in sorted(run_ids):
            run = s.get(QueryRun, run_id)
            if run is not None:
                recount_query_run(s, run)
        for source in s.execute(select(Source).where(Source.id.in_(source_ids))).scalars():
            source.image_count = s.execute(
                select(func.count()).select_from(Image).where(Image.source_id == source.id)
            ).scalar_one()
    trash.move(handle, trashed)
    for p in paths + derived:
        p.unlink(missing_ok=True)
    return len(rows)
