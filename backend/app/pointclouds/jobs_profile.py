"""The `pointcloud_profile` job (spec 2026-09-26-point-cloud-workspace section 8.4), unit C-B2.

Pre-check the source exactly as S1's export does, stream the slab (`profile_cut.cut`), write
`profiles/<measurement_id>.json` through a `.partial`, fill the five `profile_*` results and set the
measurement `ready`. Every failure, a cancel included, sets it `failed` with a readable error,
removes the partial file and publishes `pointclouds.changed`. Params `{cloud_id, measurement_id}`,
result `{measurement_id, count}`.
"""

from __future__ import annotations

from app.errors import AppError
from app.jobs.cancellation import JobCancelled, JobFailure
from app.jobs.registry import register_job_type
from app.jobs.runner import JobContext
from app.pointclouds import export, profile, profile_cut, rows


def _changed(ctx: JobContext, cloud_id: str) -> None:
    ctx.publish("pointclouds.changed", {"cloud_ids": [cloud_id]})


def _settle_cancelled(ctx: JobContext) -> None:
    """A cancel that ended the job while it was still queued (`on_cancelled_before_start`)."""
    cloud_id, mid = ctx.params["cloud_id"], ctx.params["measurement_id"]
    if profile.mark_failed(ctx.project, mid, ctx.job_id, profile.CANCELLED):
        _changed(ctx, cloud_id)


def _cut(ctx: JobContext, cloud_id: str, mid: str) -> dict:
    try:
        cloud = rows.get_cloud(ctx.project, cloud_id)
    except AppError:
        raise JobFailure(profile.CLOUD_DELETED) from None
    row = profile.load_profile_row(ctx.project, cloud_id, mid)
    if row is None:
        raise JobFailure(profile.DELETED)
    src = export.check_source(cloud)  # S1's messages, verbatim (section 8.4 step 1)
    params = row.params or {}
    a, b = row.points
    cut = profile_cut.cut(
        src,
        a=(a["x"], a["y"]),
        b=(b["x"], b["y"]),
        thickness_m=params.get("thickness_m", profile.DEFAULT_THICKNESS_M),
        max_points=params.get("max_points", profile.DEFAULT_MAX_POINTS),
        scale=min(cloud.scale or [0.001]),
        progress=lambda d, t: ctx.progress(
            0.95 * d / max(t, 1), f"cutting {d / 1e6:.1f} / {t / 1e6:.1f} M points"
        ),
        check_cancelled=ctx.check_cancelled,
    )
    ctx.check_cancelled()
    ctx.progress(0.97, f"writing {cut.count} profile points")
    final = profile.write_profile_file(ctx.project, cloud, row, cut)
    results = {
        "profile_length_m": cut.length_m,
        "profile_z_min": cut.z_min,
        "profile_z_max": cut.z_max,
        "profile_width_max_m": cut.width_max_m,
        "profile_point_count": cut.count,
    }
    if not profile.mark_ready(ctx.project, mid, ctx.job_id, results):
        final.unlink(missing_ok=True)
        raise JobFailure(profile.DELETED)
    return {"measurement_id": mid, "count": cut.count}


@register_job_type("pointcloud_profile", on_cancelled_before_start=_settle_cancelled)
def run_pointcloud_profile(ctx: JobContext) -> dict:
    cloud_id, mid = ctx.params["cloud_id"], ctx.params["measurement_id"]
    partial = profile.partial_path(ctx.project, cloud_id, mid)
    try:
        result = _cut(ctx, cloud_id, mid)
    except JobCancelled:
        partial.unlink(missing_ok=True)
        profile.mark_failed(ctx.project, mid, ctx.job_id, profile.CANCELLED)
        _changed(ctx, cloud_id)
        raise
    except Exception as e:
        partial.unlink(missing_ok=True)
        message = str(e) if isinstance(e, JobFailure) else f"the profile failed: {type(e).__name__}: {e}"
        profile.mark_failed(ctx.project, mid, ctx.job_id, message)
        _changed(ctx, cloud_id)
        raise
    _changed(ctx, cloud_id)
    ctx.progress(1.0, f"{result['count']} profile points ready")
    return result
