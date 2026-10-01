"""Renders a crash or a quit cut short (spec 2026-09-26-reports §16 "App closed during a render").

The runner's orphan sweep fails the *job*; this marks its *version row* failed so the history does
not show "rendering" forever. The partial folder goes in `exports.job.sweep_partial_exports`."""

from __future__ import annotations

import logging

from sqlalchemy import select

from app.reports import versions
from app.reports.models import ReportVersion as ReportVersionRow

log = logging.getLogger(__name__)


def sweep_interrupted(handle, runner) -> list[str]:
    swept: list[str] = []
    with versions.render_lock:  # never between POST /renders' insert and its submit
        with handle.session() as s:
            rows = s.execute(
                select(ReportVersionRow.id, ReportVersionRow.job_id).where(
                    ReportVersionRow.state == "rendering"
                )
            ).all()
        for version_id, job_id in rows:
            if job_id is not None and runner.is_live(job_id):
                continue
            versions.mark_failed(handle, version_id, versions.INTERRUPTED)
            swept.append(version_id)
    if swept:
        log.info("marked %d interrupted report render(s) failed in project %s", len(swept), handle.id)
    return swept
