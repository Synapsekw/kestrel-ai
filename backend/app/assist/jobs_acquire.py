"""The `assist_acquire` library job (image inspection spec §10): download or import the
smart-polygon weights.

I-C0 registers the type so the contract's JobType and the runner agree from day one; it fails with
"not implemented" until unit I-BS fills in the body.
"""

from app.jobs.cancellation import JobFailure
from app.jobs.registry import register_job_type
from app.jobs.runner import JobContext


@register_job_type("assist_acquire")
def run_assist_acquire(ctx: JobContext) -> dict:
    raise JobFailure("not implemented")
