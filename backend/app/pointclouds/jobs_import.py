"""The `pointcloud_import` job (spec 2026-09-23-point-clouds section 6).

Foundation F0 registers the type so the contract's JobType and the runner agree from day one; it
fails with "not implemented" until unit I2 fills in the body.
"""

from app.jobs.cancellation import JobFailure
from app.jobs.registry import register_job_type
from app.jobs.runner import JobContext


@register_job_type("pointcloud_import")
def run_pointcloud_import(ctx: JobContext) -> dict:
    raise JobFailure("not implemented")
