"""`asset_group` (spec 2026-10-02-asset-findings §6.4): group an asset model's sightings into findings.

It runs at import, on Regroup, and after `asset_place` (J3 and J5 call `submit_group`). One
transaction writes the result, so a cancel or a crash leaves the findings as they were. The generic
orphan sweep (`app/jobs/startup.py`) closes an interrupted row, and nothing else needs settling.
"""

from __future__ import annotations

from dataclasses import asdict

from sqlalchemy import select

from app.asset_review import group
from app.db.models import AssetModel, Job
from app.errors import AppError
from app.jobs.cancellation import JobFailure
from app.jobs.registry import register_job_type

GROUP_JOB = "asset_group"
LIVE_STATES = ("queued", "running")


@register_job_type(GROUP_JOB)
def run_group(ctx) -> dict:
    mid = ctx.params["asset_model_id"]
    ctx.progress(0, "Reading the sightings")
    with ctx.project.session() as s:
        model = s.get(AssetModel, mid)
        if model is None:
            raise JobFailure("The asset model was deleted before its findings could be grouped.")
        items = group.load_items(s, mid)
        s.expunge(model)
    ctx.check_cancelled()
    ctx.progress(0.3, f"Grouping {len(items):,} sightings")
    groups = group.groups_for_model(model, items)
    ctx.check_cancelled()
    ctx.progress(0.6, f"Writing {len(groups):,} findings")
    with ctx.project.session() as s:
        result = group.apply_groups(s, ctx.project, mid, groups)
    ctx.progress(1, f"{result.created} new, {result.kept} kept, {result.merged} merged, {result.split} split")
    return {**asdict(result), "asset_model_id": mid, "sightings": len(items), "groups": len(groups)}


def live_group_job(handle, asset_model_id: str) -> str | None:
    with handle.session() as s:
        rows = s.execute(select(Job.id, Job.params).where(Job.type == GROUP_JOB, Job.state.in_(LIVE_STATES)))
        for job_id, params in rows.all():
            if (params or {}).get("asset_model_id") == asset_model_id:
                return job_id
    return None


def submit_group(handle, runner, asset_model_id: str) -> Job:
    """Queue `asset_group` for one model, or 409 `job_running` with the live one's id."""
    live = live_group_job(handle, asset_model_id)
    if live is not None:
        raise AppError(
            "job_running",
            "The findings on this asset model are already being grouped.",
            409,
            {"job_id": live},
        )
    return runner.submit(handle, GROUP_JOB, {"asset_model_id": asset_model_id})
