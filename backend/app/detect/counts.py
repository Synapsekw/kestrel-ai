"""The counting rules for runs (spec 2026-09-23 section 9.1, plan 2 deviation 1).

One rule, used by every review write (an increment) and by the recount job (a rebuild):

- a rejected or absent detection counts nowhere;
- any other detection adds 1 to `counts[class_id]`, the *total*;
- an accepted or edited one also adds 1 to `verified_counts[class_id]`.

Shapes: `counts` and `verified_counts` are `{class_id: n}`; `MapRun.area_counts` is
`{area_id: {class_id: {"total": n, "verified": n}}}`. A key whose number drops to 0 is removed,
so an incremental count and a recount of the same rows are equal dicts.

The `apply_*` functions change the dicts in place. The run columns are plain JSON, which does not
track in-place changes, so a caller works on copies and assigns them back (or calls
`flag_modified`) inside the same session transaction as the review write.
"""

from __future__ import annotations

import logging
from typing import TYPE_CHECKING

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.db.models import Box, MapDetection, MapRun, QueryRun

if TYPE_CHECKING:
    from app.detect.areas import ProjectedArea

log = logging.getLogger(__name__)

VERIFIED_STATES = ("accepted", "edited")
REJECTED = "rejected"
AREA_STREAM_BATCH = 5000

Entry = tuple[str, str] | None  # (class_id, review_state); None = the detection does not exist


def _bump(counts: dict, key: str, delta: int) -> None:
    value = counts.get(key, 0) + delta
    if value < 0:  # the old entry was never counted: a caller bug; a recount repairs it
        log.warning("count for %s went below zero (%d); clamped to 0", key, value)
        value = 0
    if value:
        counts[key] = value
    else:
        counts.pop(key, None)


def _weights(entry: Entry) -> tuple[int, int]:
    """(total, verified) that one entry contributes to its class."""
    if entry is None or entry[1] == REJECTED:
        return 0, 0
    return 1, int(entry[1] in VERIFIED_STATES)


def apply_transition(counts: dict, verified: dict, old: Entry, new: Entry) -> None:
    """In place. A rejected or absent entry counts nowhere; any other state adds 1 to counts[class];
    VERIFIED_STATES also add 1 to verified[class]. Keys whose value drops to 0 are removed."""
    for entry, sign in ((old, -1), (new, 1)):
        total, ver = _weights(entry)
        if total:
            _bump(counts, entry[0], sign * total)
        if ver:
            _bump(verified, entry[0], sign * ver)


def apply_area_transition(area_counts: dict, area_ids: list[str], old: Entry, new: Entry) -> None:
    """Same rule into area_counts[area_id][class_id] = {"total": n, "verified": n}.

    `area_ids` are the areas holding the detection's box centre; a detection that moves between
    areas is two calls (old areas, old -> None) and (new areas, None -> new)."""
    for area_id in area_ids:
        per_class = area_counts.setdefault(area_id, {})
        for entry, sign in ((old, -1), (new, 1)):
            total, ver = _weights(entry)
            if not total:
                continue
            cell = per_class.setdefault(entry[0], {"total": 0, "verified": 0})
            cell["total"] += sign * total
            cell["verified"] += sign * ver
            if cell["total"] < 0 or cell["verified"] < 0:  # the old entry was never counted
                log.warning("area %s count for %s went below zero; clamped to 0", area_id, entry[0])
                cell["total"], cell["verified"] = max(cell["total"], 0), max(cell["verified"], 0)
            if cell["total"] == 0:
                per_class.pop(entry[0])
        if not per_class:
            area_counts.pop(area_id)


def _grouped(s: Session, class_col, state_col, *where) -> tuple[dict, dict]:
    """counts and verified from one grouped COUNT; no row is materialised."""
    counts: dict = {}
    verified: dict = {}
    rows = s.execute(
        select(class_col, state_col, func.count())
        .where(*where, state_col != REJECTED)
        .group_by(class_col, state_col)
    )
    for class_id, state, n in rows:
        counts[class_id] = counts.get(class_id, 0) + n
        if state in VERIFIED_STATES:
            verified[class_id] = verified.get(class_id, 0) + n
    return counts, verified


def recount_query_run(s: Session, run: QueryRun) -> None:
    """Rebuild a photo run's counts from its boxes (grouped COUNT over Box where query_run_id)."""
    run.counts, run.verified_counts = _grouped(s, Box.class_id, Box.review_state, Box.query_run_id == run.id)


def recount_map_run(s: Session, run: MapRun, areas: list[ProjectedArea]) -> None:
    """counts and verified_counts by grouped COUNT; area_counts by streaming (x, y, w, h, class_id,
    review_state) with yield_per(5000) and area_ids_for_point on the box centre."""
    from app.detect.areas import area_ids_for_point

    run.counts, run.verified_counts = _grouped(
        s, MapDetection.class_id, MapDetection.review_state, MapDetection.run_id == run.id
    )
    area_counts: dict = {}
    if areas:
        stmt = (
            select(
                MapDetection.x,
                MapDetection.y,
                MapDetection.w,
                MapDetection.h,
                MapDetection.class_id,
                MapDetection.review_state,
            )
            .where(MapDetection.run_id == run.id, MapDetection.review_state != REJECTED)
            .execution_options(yield_per=AREA_STREAM_BATCH)
        )
        for x, y, w, h, class_id, state in s.execute(stmt):
            ids = area_ids_for_point(areas, x + w / 2, y + h / 2)
            if ids:
                apply_area_transition(area_counts, ids, None, (class_id, state))
    run.area_counts = area_counts
