"""Reviewing detection runs (spec 2026-09-23 section 8, plan 2 unit V).

Every write here changes a detection's `review_state` (or class) and the run's `counts`,
`verified_counts` and `area_counts` in **one** session transaction, through the counting rules in
`app/detect/counts.py`. A crash can therefore never leave a review without its increment; the
`recount` job stays the repair tool for anything older.

Photo runs are reviewed box by box through `app/datasets/boxes.py`, which applies the same rules to
the box's `QueryRun`; `accept_above` on a photo run goes through `boxes.review_boxes`.
"""

from __future__ import annotations

import copy
from collections.abc import Callable

from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session

from app.datasets import boxes
from app.db.models import Box, GeoMap, MapDetection, MapRun, QueryRun
from app.detect.areas import ProjectedArea, area_ids_for_point, areas_for_map
from app.detect.counts import VERIFIED_STATES, Entry, apply_area_transition, apply_transition
from app.errors import AppError, not_found
from app.jobs.registry import register_job_type
from app.jobs.runner import JobContext
from app.projects.service import ProjectHandle

ACCEPT_BATCH = 1000
UNREVIEWED = "unreviewed"
PERSON_CONFIDENCE = 1.0  # a person-drawn detection is certain; the column has no null


def _map_run(s: Session, run_id: str) -> MapRun:
    run = s.get(MapRun, run_id)
    if run is None:
        raise not_found("map run", run_id)
    return run


def _check_class(handle: ProjectHandle, s: Session, class_id: str | None) -> str:
    if not class_id or class_id not in {c["id"] for c in handle.row(s).classes or []}:
        raise AppError("validation_error", f"unknown class {class_id!r}", 422)
    return class_id


class _RunCounts:
    """Copies of one map run's count dicts, changed per detection and written back once."""

    def __init__(self, s: Session, run: MapRun):
        self.run = run
        gmap = s.get(GeoMap, run.map_id)
        self.areas: list[ProjectedArea] = areas_for_map(s, gmap) if gmap is not None else []
        self.counts = dict(run.counts or {})
        self.verified = dict(run.verified_counts or {})
        self.area_counts = copy.deepcopy(run.area_counts or {})

    def apply(self, d: MapDetection, old: Entry, new: Entry) -> None:
        apply_transition(self.counts, self.verified, old, new)
        if self.areas:
            ids = area_ids_for_point(self.areas, d.x + d.w / 2, d.y + d.h / 2)
            if ids:
                apply_area_transition(self.area_counts, ids, old, new)

    def save(self) -> None:
        # New objects: the JSON columns do not track changes made in place.
        self.run.counts, self.run.verified_counts = self.counts, self.verified
        self.run.area_counts = self.area_counts


Decision = Callable[[MapDetection], tuple[str, str] | None]


def _decide(action: str, class_id: str | None) -> Decision:
    """The new (class_id, state) for a detection, or None when the action changes nothing."""

    def decide(d: MapDetection) -> tuple[str, str] | None:
        state = d.review_state
        if action == "accept":
            # An edited detection is verified already, and keeps the record that a person changed it.
            return None if state in VERIFIED_STATES else (d.class_id, "accepted")
        if action == "reject":
            return None if state == "rejected" else (d.class_id, "rejected")
        if action == "unreview":
            return None if state == UNREVIEWED else (d.class_id, UNREVIEWED)
        # reclass
        return None if (d.class_id, state) == (class_id, "edited") else (class_id, "edited")

    return decide


def _apply(s: Session, run: MapRun, detection_ids: list[str], decide: Decision) -> int:
    tally = _RunCounts(s, run)
    changed = 0
    rows = s.execute(
        select(MapDetection).where(MapDetection.run_id == run.id, MapDetection.id.in_(detection_ids))
    ).scalars()
    for d in rows:
        new = decide(d)
        if new is None:
            continue
        old = (d.class_id, d.review_state)
        d.class_id, d.review_state = new
        tally.apply(d, old, new)
        changed += 1
    if changed:
        tally.save()
    return changed


def review_map_detections(
    handle: ProjectHandle, run_id: str, detection_ids: list[str], action: str, class_id: str | None = None
) -> int:
    """Accept, reject, unreview or reclass detections of one map run; returns how many changed.

    Ids of another run, or unknown ids, are ignored. Reclass sets the class and the state `edited`."""
    with handle.session() as s:
        run = _map_run(s, run_id)
        if action == "reclass":
            _check_class(handle, s, class_id)
        return _apply(s, run, detection_ids, _decide(action, class_id))


def add_map_detection(
    handle: ProjectHandle,
    run_id: str,
    class_id: str,
    x: float,
    y: float,
    w: float,
    h: float,
    angle: float | None,
) -> MapDetection:
    """A missed object drawn by a person: accepted, `provenance_kind` person, counted as verified."""
    with handle.session() as s:
        run = _map_run(s, run_id)
        _check_class(handle, s, class_id)
        gmap = s.get(GeoMap, run.map_id)
        cx, cy = x + w / 2, y + h / 2
        if w <= 0 or h <= 0:
            raise AppError("validation_error", "a box needs a positive width and height", 422)
        if gmap is not None and not (0 <= cx <= (gmap.width or 0) and 0 <= cy <= (gmap.height or 0)):
            raise AppError("validation_error", f"box centre ({cx}, {cy}) is outside the map", 422)
        row = MapDetection(
            run_id=run.id,
            class_id=class_id,
            confidence=PERSON_CONFIDENCE,
            x=x,
            y=y,
            w=w,
            h=h,
            angle=angle,
            review_state="accepted",
            provenance_kind="person",
        )
        s.add(row)
        tally = _RunCounts(s, run)
        tally.apply(row, None, (class_id, "accepted"))
        tally.save()
        s.flush()
        s.expunge(row)
    return row


def next_unreviewed(
    handle: ProjectHandle, run_id: str, after_id: str | None
) -> tuple[MapDetection | None, int]:
    """The next unreviewed detection in reading order (y, then x, then id) after `after_id`, and how
    many unreviewed detections the run still has. An unknown `after_id` starts from the top."""
    with handle.session() as s:
        _map_run(s, run_id)
        pending = (MapDetection.run_id == run_id, MapDetection.review_state == UNREVIEWED)
        remaining = s.execute(select(func.count()).select_from(MapDetection).where(*pending)).scalar_one()
        q = select(MapDetection).where(*pending)
        after = s.get(MapDetection, after_id) if after_id else None
        if after is not None and after.run_id == run_id:
            q = q.where(
                or_(
                    MapDetection.y > after.y,
                    (MapDetection.y == after.y) & (MapDetection.x > after.x),
                    (MapDetection.y == after.y) & (MapDetection.x == after.x) & (MapDetection.id > after.id),
                )
            )
        row = s.execute(
            q.order_by(MapDetection.y, MapDetection.x, MapDetection.id).limit(1)
        ).scalar_one_or_none()
        if row is not None:
            s.expunge(row)
    return row, remaining


# --- accept above --------------------------------------------------------------------------------


def run_kind(handle: ProjectHandle, run_id: str) -> str:
    """`map` or `images` for a run id of either table; 404 when it is neither."""
    with handle.session() as s:
        if s.get(MapRun, run_id) is not None:
            return "map"
        if s.get(QueryRun, run_id) is not None:
            return "images"
    raise not_found("run", run_id)


def _pending_ids(s: Session, kind: str, run_id: str, min_conf: float, after: str, limit: int) -> list[str]:
    if kind == "map":
        col = MapDetection.id
        where = (
            MapDetection.run_id == run_id,
            MapDetection.review_state == UNREVIEWED,
            MapDetection.confidence >= min_conf,
        )
    else:
        col = Box.id
        where = (
            Box.query_run_id == run_id,
            Box.review_state == UNREVIEWED,
            Box.provenance_kind != "person",
            Box.confidence >= min_conf,
        )
    return list(s.execute(select(col).where(*where, col > after).order_by(col).limit(limit)).scalars())


def _count(s: Session, kind: str, run_id: str, min_conf: float) -> int:
    if kind == "map":
        where = (
            MapDetection.run_id == run_id,
            MapDetection.review_state == UNREVIEWED,
            MapDetection.confidence >= min_conf,
        )
        return s.execute(select(func.count()).select_from(MapDetection).where(*where)).scalar_one()
    where = (
        Box.query_run_id == run_id,
        Box.review_state == UNREVIEWED,
        Box.provenance_kind != "person",
        Box.confidence >= min_conf,
    )
    return s.execute(select(func.count()).select_from(Box).where(*where)).scalar_one()


@register_job_type("accept_above")
def run_accept_above(ctx: JobContext) -> dict:
    """Accept every unreviewed detection of a run at or above `min_confidence`, 1000 ids per
    transaction, each batch with its count increments. Photo runs go through `boxes.review_boxes`."""
    run_id, min_conf = ctx.params["run_id"], float(ctx.params["min_confidence"])
    kind = run_kind(ctx.project, run_id)
    with ctx.project.session() as s:
        total = _count(s, kind, run_id, min_conf)
    accepted = 0
    after = ""
    ctx.progress(0.0, f"Accepting {total} detections")
    while True:
        ctx.check_cancelled()
        with ctx.project.session() as s:
            ids = _pending_ids(s, kind, run_id, min_conf, after, ACCEPT_BATCH)
        if not ids:
            break
        after = ids[-1]
        if kind == "map":
            with ctx.project.session() as s:
                accepted += _apply(s, _map_run(s, run_id), ids, _decide("accept", None))
        else:
            accepted += boxes.review_boxes(ctx.project, ids, "accept")
        ctx.progress(accepted / total if total else 1.0, f"Accepted {accepted} of {total}")
    ctx.log.info("accept_above run %s at %.2f: %d accepted", run_id, min_conf, accepted)
    return {"run_id": run_id, "accepted": accepted}
