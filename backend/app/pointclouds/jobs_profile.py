"""The `pointcloud_profile` job (spec 2026-09-26-point-cloud-workspace section 8.4).

Unit C-C0 registers the type so the contract's JobType and the runner agree from the start; it fails
with "not implemented" until unit C-B2 fills in the body (params `{cloud_id, measurement_id}`,
result `{measurement_id, count}`).
"""

from app.jobs.cancellation import JobFailure
from app.jobs.registry import register_job_type
from app.jobs.runner import JobContext


@register_job_type("pointcloud_profile")
def run_pointcloud_profile(ctx: JobContext) -> dict:
    raise JobFailure("not implemented")
