"""The `surface_build` job (spec 2026-09-23-volumes section 5).

Foundation F0 registers the type so the contract's JobType and the runner agree from day one; it
fails with "not implemented" until S2 unit V2 fills in the body.
"""

from app.jobs.cancellation import JobFailure
from app.jobs.registry import register_job_type
from app.jobs.runner import JobContext


@register_job_type("surface_build")
def run_surface_build(ctx: JobContext) -> dict:
    raise JobFailure("not implemented")
