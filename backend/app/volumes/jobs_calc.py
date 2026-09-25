"""The `volume_calc` job (spec 2026-09-23-volumes section 6.8).

Foundation F0 registers the type so the contract's JobType and the runner agree from day one; it
fails with "not implemented" until S2 unit V5 fills in the body.
"""

from app.jobs.cancellation import JobFailure
from app.jobs.registry import register_job_type
from app.jobs.runner import JobContext


@register_job_type("volume_calc")
def run_volume_calc(ctx: JobContext) -> dict:
    raise JobFailure("not implemented")
