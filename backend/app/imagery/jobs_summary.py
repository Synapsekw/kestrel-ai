"""`summary_rebuild` (image inspection spec §7.1, §15): the repair tool for `image_summary`, and the
guard on project open that keeps it correct (plan I-BX Ruling 1).

Migration 0011 seeds the table for every image (I-C0 ruling 4), so on a healthy project the guard's
"box without a summary row" probe normally finds nothing. But I-C0 shipped `summary.touch` as a
no-op, so a project written between 0011's seed and this unit landing can hold *stale* seeded rows
that probe can't see (the row exists; it's just wrong). A one-time marker row in `migration_step`
(name `REBUILD_MARKER`) closes that window: on the first open after this unit ships, a project with
the marker missing and at least one box gets one rebuild (which also writes the marker); a project
with no boxes just gets the marker, since nothing can be stale. Once the marker exists, the guard
falls back to the missing-rows probe alone.
"""

from __future__ import annotations

import logging

from sqlalchemy import exists, func, select

from app.db.models import Box, Image, ImageSummary, Job, MigrationStep
from app.errors import AppError
from app.imagery import summary
from app.jobs.registry import register_job_type
from app.jobs.runner import JobContext

REBUILD_JOB = "summary_rebuild"
REBUILD_MARKER = "image_summary_rebuild_v1"
BATCH = 1000
LIVE_STATES = ("queued", "running")
log = logging.getLogger(__name__)


@register_job_type(REBUILD_JOB)
def run_summary_rebuild(ctx: JobContext) -> dict:
    with ctx.project.session() as s:
        total = s.execute(select(func.count()).select_from(Image)).scalar_one()
    ctx.progress(0, f"Rebuilding the image summary of {total} images")
    done, after = 0, ""
    while True:
        ctx.check_cancelled()
        with ctx.project.session() as s:  # one transaction per batch
            ids = list(
                s.execute(select(Image.id).where(Image.id > after).order_by(Image.id).limit(BATCH)).scalars()
            )
            if not ids:
                break
            summary.touch_many(s, ids)
        done, after = done + len(ids), ids[-1]
        ctx.progress(done / max(total, 1), f"{done} of {total} images")
    with ctx.project.session() as s:
        # Closes the marker window (Ruling 1): every successful rebuild leaves the marker behind,
        # so a later open never queues another one just because it's missing.
        s.merge(MigrationStep(name=REBUILD_MARKER, detail={"images": done}))
    # No orphan sweep: image_summary.image_id cascades with its image (I-C0's FK).
    ctx.publish("images.changed", {})
    ctx.progress(1, f"Rebuilt the summary of {done} images")
    return {"images": done}


def live_rebuild_id(handle) -> str | None:
    with handle.session() as s:
        return s.execute(
            select(Job.id).where(Job.type == REBUILD_JOB, Job.state.in_(LIVE_STATES)).limit(1)
        ).scalar_one_or_none()


def submit_rebuild(handle, runner) -> Job:
    """Queue a rebuild, or 409 `job_running` with the live one's id: one repair at a time."""
    live = live_rebuild_id(handle)
    if live is not None:
        raise AppError("job_running", "The image summary is already being rebuilt.", 409, {"job_id": live})
    return runner.submit(handle, REBUILD_JOB, {})


def check_on_open(handle, runner) -> Job | None:
    """Two guards, run in order. If a rebuild is already live, do nothing - it will leave the
    project healthy on its own. Otherwise, without the `REBUILD_MARKER` row (Ruling 1: closes the
    C0 no-op window), queue one rebuild when the project has any box at all - the 0011-seeded rows
    may be stale - or, with no boxes, just write the marker (nothing can be stale). With the marker
    present, fall back to the one `LIMIT 1` probe for a box whose image has no summary row at all
    (a crash between releases, a hand-edited DB; normally impossible, since 0011 seeds every row)."""
    if live_rebuild_id(handle) is not None:
        return None
    with handle.session() as s:
        if s.get(MigrationStep, REBUILD_MARKER) is None:
            has_box = s.execute(select(Box.image_id).limit(1)).scalar_one_or_none() is not None
            if not has_box:
                s.merge(MigrationStep(name=REBUILD_MARKER, detail={"images": 0}))
                return None
            log.warning("project %s: no image_summary rebuild marker; rebuilding", handle.id)
            return runner.submit(handle, REBUILD_JOB, {})
        missing = s.execute(
            select(Box.image_id).where(~exists().where(ImageSummary.image_id == Box.image_id)).limit(1)
        ).scalar_one_or_none()
    if missing is None:
        return None
    log.warning("project %s: image_summary is missing rows; rebuilding", handle.id)
    return runner.submit(handle, REBUILD_JOB, {})
