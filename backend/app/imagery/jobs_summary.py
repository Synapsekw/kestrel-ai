"""The `summary_rebuild` job (image inspection spec §7.1): recompute every image's summary.

I-C0 registers the type so the contract's JobType and the runner agree from day one; it fails with
"not implemented" until unit I-BX fills in the body.
"""

from app.jobs.cancellation import JobFailure
from app.jobs.registry import register_job_type
from app.jobs.runner import JobContext


@register_job_type("summary_rebuild")
def run_summary_rebuild(ctx: JobContext) -> dict:
    raise JobFailure("not implemented")
