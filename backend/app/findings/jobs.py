"""`findings_recount` (spec 2026-09-26-foundation section 8.3), the repair tool, and the check on
project open (section 6.1) that queues it when the stored counts disagree with the findings."""

import logging

from sqlalchemy import func, select

from app.db.models import Finding, FindingCount, Job
from app.errors import AppError
from app.findings import counts
from app.jobs.registry import register_job_type

RECOUNT_JOB = "findings_recount"
LIVE_STATES = ("queued", "running")
log = logging.getLogger(__name__)


@register_job_type(RECOUNT_JOB)
def run_recount(ctx) -> dict:
    ctx.progress(0, "Recounting findings")
    with ctx.project.session() as s:
        result = counts.recount(s)
    ctx.publish("findings.changed", {"all": True})
    ctx.progress(1, f"Counted {result['findings']} findings")
    return result


def live_recount_id(handle) -> str | None:
    """The id of a recount already queued or running in this project, if any."""
    with handle.session() as s:
        return s.execute(
            select(Job.id).where(Job.type == RECOUNT_JOB, Job.state.in_(LIVE_STATES)).limit(1)
        ).scalar_one_or_none()


def submit_recount(handle, runner) -> Job:
    """Queue a recount, or 409 `job_running` with the live one's id: one repair at a time."""
    live = live_recount_id(handle)
    if live is not None:
        raise AppError("job_running", "The findings are already being recounted.", 409, {"job_id": live})
    return runner.submit(handle, RECOUNT_JOB, {})


def check_on_open(handle, runner):
    """Two reads once per project open: the stored total and the table's row count (an index
    count). When they differ, queue a recount; returns the job or None."""
    with handle.session() as s:
        stored = s.execute(select(func.coalesce(func.sum(FindingCount.n), 0))).scalar_one()
        actual = s.execute(select(func.count()).select_from(Finding)).scalar_one()
    if stored == actual:
        return None
    log.warning(
        "project %s: finding counts say %s, the table holds %s; recounting", handle.id, stored, actual
    )
    return runner.submit(handle, RECOUNT_JOB, {})
