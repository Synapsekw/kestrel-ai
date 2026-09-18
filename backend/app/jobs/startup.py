"""Orphan job sweep, run when a project becomes live in this process (spec section 10).

A crash, a killed sidecar or a plain quit leaves `queued` and `running` rows in the project DB.
Nothing will ever finish them, so without this sweep the Jobs panel shows work that is frozen
forever. Projects open lazily, so the sweep runs per project on open rather than once at startup.
"""

import logging
from datetime import UTC, datetime

from sqlalchemy import select

from app.db.models import Job
from app.jobs.runner import JobRunner
from app.projects.service import ProjectHandle

RESTART_ERROR = "interrupted by application restart"
ORPHAN_STATES = {"running": "failed", "queued": "cancelled"}
log = logging.getLogger(__name__)


def sweep_orphans(project: ProjectHandle, runner: JobRunner) -> list[dict]:
    """Close out unfinished jobs this process does not own; returns `[{id, type, state}]`.

    A `running` row becomes `failed` with a plain explanation an operator can act on, a `queued`
    one was never started so it becomes `cancelled`. Jobs the runner is holding right now belong
    to this process and are left alone: a project can be reopened while its own jobs run.
    """
    with project.session() as s:
        rows = [
            (j.id, j.type, j.state)
            for j in s.execute(select(Job).where(Job.state.in_(ORPHAN_STATES))).scalars()
        ]
    swept = []
    for job_id, job_type, state in rows:
        if runner.is_live(job_id):
            continue
        new_state = ORPHAN_STATES[state]
        fields = {"state": new_state, "finished_at": datetime.now(UTC)}
        if new_state == "failed":
            fields["error"] = RESTART_ERROR
        runner.update(project, job_id, **fields)
        swept.append({"id": job_id, "type": job_type, "state": new_state})
    if swept:
        log.info("swept %d orphaned job(s) in project %s: %s", len(swept), project.id, swept)
    return swept
