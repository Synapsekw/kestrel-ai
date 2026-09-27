"""The `image_metadata` job (image inspection spec §7.3): re-read camera metadata from originals.

I-C0 registers the type so the contract's JobType and the runner agree from day one; it fails with
"not implemented" until unit I-BK fills in the body.
"""

from app.jobs.cancellation import JobFailure
from app.jobs.registry import register_job_type
from app.jobs.runner import JobContext


@register_job_type("image_metadata")
def run_image_metadata(ctx: JobContext) -> dict:
    raise JobFailure("not implemented")
