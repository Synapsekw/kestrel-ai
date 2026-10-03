"""Restart sweep for asset models (spec §7.2 step 5; Review Focus 4). Called on project open."""

from __future__ import annotations

import logging
from datetime import UTC, datetime

from sqlalchemy import select

from app.asset_models import store
from app.asset_models.service import add_version, refresh_status
from app.asset_models.spec import AssetSpec
from app.db.models import AssetModel, AssetModelRun, AssetModelVersion

log = logging.getLogger(__name__)
INTERRUPTED = "interrupted by application restart"


def sweep_interrupted(handle, runner) -> None:
    with handle.session() as s:
        touched = set()
        for v in s.scalars(select(AssetModelVersion).where(AssetModelVersion.glb_status == "pending")):
            if not (v.glb_job_id and runner.is_live(v.glb_job_id)):
                v.glb_status = "failed"
                touched.add(v.model_id)
        for m in s.scalars(select(AssetModel).where(AssetModel.id.in_(touched))):
            refresh_status(m)
    _sweep_runs(handle, runner)


def _sweep_runs(handle, runner) -> None:
    """A run still `running` whose job is gone was cut off: fail it, unstick its model, and keep what
    the agent had built as a draft. Nothing here may stop the app from opening."""
    interrupted = []
    with handle.session() as s:
        for run in s.scalars(select(AssetModelRun).where(AssetModelRun.state == "running")):
            if runner.is_live(run.job_id):
                continue
            run.state, run.stop_reason, run.summary, run.phase = "failed", "interrupted", INTERRUPTED, "done"
            run.ended_at = datetime.now(UTC)
            model = s.get(AssetModel, run.model_id)
            if model is not None and model.live_run_id == run.id:
                model.live_run_id = None
                refresh_status(model)
            interrupted.append((run.model_id, run.id))
    for model_id, run_id in interrupted:
        try:
            working = store.run_dir(handle, model_id, run_id) / "working.json"
            if not working.exists():
                continue
            spec = AssetSpec.model_validate_json(working.read_text(encoding="utf-8"))
            if not spec.parts:
                continue
            row, _job = add_version(
                handle, runner, model_id, spec, kind="draft", note=INTERRUPTED, run_id=run_id
            )
            with handle.session() as s:
                s.get(AssetModelRun, run_id).version = row.version
        except Exception as e:  # noqa: BLE001 - a bad draft must never stop the app opening
            log.error("asset model run draft could not be restored (%s)", type(e).__name__)
