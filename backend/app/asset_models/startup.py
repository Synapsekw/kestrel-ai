"""Restart sweep for asset models (spec §7.2 step 5; Review Focus 4). Called on project open."""

from __future__ import annotations

from sqlalchemy import select

from app.asset_models.service import refresh_status
from app.db.models import AssetModel, AssetModelVersion


def sweep_interrupted(handle, runner) -> None:
    with handle.session() as s:
        touched = set()
        for v in s.scalars(select(AssetModelVersion).where(AssetModelVersion.glb_status == "pending")):
            if not (v.glb_job_id and runner.is_live(v.glb_job_id)):
                v.glb_status = "failed"
                touched.add(v.model_id)
        for m in s.scalars(select(AssetModel).where(AssetModel.id.in_(touched))):
            refresh_status(m)
