"""Which images of one project a dataset filter selects, and what they count (foundation F §12.2).

Everything here is one SQL statement against one project's session: the preview counts with it,
and the build pages through it 500 images at a time. Nothing loads an image set into memory.

- Labels are always ground truth: accepted or edited boxes, or person-drawn ones not rejected.
  Unreviewed model proposals never become labels.
- An image is selected when it has a ground-truth box of a selected type, or is marked empty (a
  negative example, as today's datasets include them).
- `reviewed_only` also drops images that still carry an unreviewed proposal of a selected type:
  such an image may hide an unlabelled object and would teach a false negative (plan BM decision 2).
- The date range compares the image's capture time as a UTC day and falls back to its source's
  survey date; with a bound set, an image with neither is left out (plan BM decision 3).
- An image with a label of a selected type the dataset's task cannot express (a point; a box in a
  segment dataset without `boxes_as_polygons`) is skipped and counted (image spec I-D10).
"""

from __future__ import annotations

import threading
from collections.abc import Iterator
from contextlib import contextmanager
from dataclasses import dataclass
from datetime import UTC, date, datetime, time, timedelta

from sqlalchemy import Select, and_, exists, func, or_, select
from sqlalchemy.exc import OperationalError
from sqlalchemy.orm import Session

from app.db.models import Box, Image, Source
from app.imagery import labels as label_rules

GROUND_TRUTH_STATES = ("accepted", "edited")
#: Per project, per preview (F §12.2 step 1).
PREVIEW_TIMEOUT_S = 2.0


@dataclass(frozen=True)
class Filter:
    project_ids: tuple[str, ...]
    type_ids: tuple[str, ...]
    captured_from: date | None = None
    captured_to: date | None = None
    reviewed_only: bool = False
    boxes_as_polygons: bool = False

    @classmethod
    def from_json(cls, value: dict) -> Filter:
        def day(v):
            return date.fromisoformat(v) if isinstance(v, str) else v

        return cls(
            project_ids=tuple(dict.fromkeys(value.get("project_ids") or [])),
            type_ids=tuple(dict.fromkeys(value.get("type_ids") or [])),
            captured_from=day(value.get("captured_from")),
            captured_to=day(value.get("captured_to")),
            reviewed_only=bool(value.get("reviewed_only")),
            boxes_as_polygons=bool(value.get("boxes_as_polygons")),
        )


def ground_truth():
    """Boxes that are labels: accepted or edited, or drawn by a person and not rejected."""
    return or_(
        Box.review_state.in_(GROUND_TRUTH_STATES),
        and_(Box.provenance_kind == "person", Box.review_state != "rejected"),
    )


def _in_date_range(f: Filter):
    if f.captured_from is None and f.captured_to is None:
        return None
    by_time = [Image.capture_time.is_not(None)]
    by_survey = [Image.capture_time.is_(None), Source.captured_on.is_not(None)]
    if f.captured_from is not None:
        by_time.append(Image.capture_time >= datetime.combine(f.captured_from, time.min, UTC))
        by_survey.append(Source.captured_on >= f.captured_from)
    if f.captured_to is not None:
        end = datetime.combine(f.captured_to + timedelta(days=1), time.min, UTC)
        by_time.append(Image.capture_time < end)
        by_survey.append(Source.captured_on <= f.captured_to)
    return or_(and_(*by_time), and_(*by_survey))


def matching_images(f: Filter) -> Select:
    """`SELECT image.id` for the images `f` selects in one project; add columns as needed."""
    labelled = exists().where(Box.image_id == Image.id, Box.class_id.in_(f.type_ids), ground_truth())
    q = select(Image.id).join(Source, Source.id == Image.source_id).where(or_(labelled, Image.marked_empty))
    if f.reviewed_only:
        pending = exists().where(
            Box.image_id == Image.id,
            Box.class_id.in_(f.type_ids),
            Box.review_state == "unreviewed",
            Box.provenance_kind != "person",
        )
        q = q.where(~pending)
    in_range = _in_date_range(f)
    if in_range is not None:
        q = q.where(in_range)
    return q


def labels_of(s: Session, image_ids: list[str], f: Filter) -> dict[str, list[dict]]:
    """The frozen labels of one page of images:
    `{image_id: [{type_id, shape, x, y, w, h, angle[, points]}]}`."""
    out: dict[str, list[dict]] = {}
    rows = s.execute(
        select(Box)
        .where(Box.image_id.in_(image_ids), Box.class_id.in_(f.type_ids), ground_truth())
        .order_by(Box.created_at, Box.id)
    ).scalars()
    for b in rows:
        shape = b.shape or ("rbox" if b.angle else "box")
        entry = {
            "type_id": b.class_id,
            "shape": shape,
            "x": b.x,
            "y": b.y,
            "w": b.w,
            "h": b.h,
            "angle": b.angle or 0.0,
        }
        if shape == "polygon":
            entry["points"] = b.points
        out.setdefault(b.image_id, []).append(entry)
    return out


def count(s: Session, f: Filter) -> tuple[int, dict[str, int]]:
    """`(images, {type_id: ground-truth boxes})` for one project: two COUNT statements."""
    ids = matching_images(f).subquery()
    images = s.execute(select(func.count()).select_from(ids)).scalar_one()
    per_type = s.execute(
        select(Box.class_id, func.count())
        .where(Box.image_id.in_(select(ids.c.id)), Box.class_id.in_(f.type_ids), ground_truth())
        .group_by(Box.class_id)
    ).all()
    return int(images), {str(t): int(n) for t, n in per_type}


def unexpressible(f: Filter, task: str):
    """`EXISTS` a ground-truth label of a selected type the task cannot write (image spec I-D10):
    the SQL twin of `imagery.labels.expressible`, so the preview and the build agree with it."""
    shapes = label_rules.unexpressible_shapes(task, boxes_as_polygons=f.boxes_as_polygons)
    return exists().where(
        Box.image_id == Image.id, Box.class_id.in_(f.type_ids), ground_truth(), Box.shape.in_(shapes)
    )


def skipped(s: Session, f: Filter, task: str) -> int:
    """Matching images `task` would skip: one COUNT statement."""
    q = matching_images(f).where(unexpressible(f, task)).subquery()
    return int(s.execute(select(func.count()).select_from(q)).scalar_one())


class PreviewTimeout(Exception):
    """A project's counts took longer than `PREVIEW_TIMEOUT_S`."""


@contextmanager
def interrupt_after(s: Session, seconds: float) -> Iterator[None]:
    """Abort the SQLite statement `s` is running once `seconds` have passed.

    `sqlite3.Connection.interrupt()` is the thread-safe way to stop a running query; the statement
    then raises `OperationalError: interrupted`, which becomes `PreviewTimeout` here.
    """
    raw = s.connection().connection.dbapi_connection
    timer = threading.Timer(seconds, raw.interrupt)
    timer.start()
    try:
        yield
    except OperationalError as e:
        if "interrupted" in str(e).lower():
            raise PreviewTimeout() from e
        raise
    finally:
        timer.cancel()
