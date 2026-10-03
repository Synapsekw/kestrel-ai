"""Asset model runs (spec 2026-10-02 §9). Replaces U3's 501 stubs."""

from __future__ import annotations

from dataclasses import asdict

from fastapi import APIRouter, Depends, Path, Request, Response
from fastapi.responses import FileResponse
from sqlalchemy import select

from app.asset_models import store
from app.asset_models.agent import runner as _run  # noqa: F401 - registers `asset_model_run`
from app.asset_models.agent.plant import PLANT_MODES
from app.asset_models.agent.plant import packages as plant_packages
from app.asset_models.agent.plant.budget import resolve_limits
from app.asset_models.agent.plant.state import PlantState, load_state, save_state
from app.asset_models.schemas import (
    AssetModelRunList,
    AssetModelRunOut,
    AssetModelRunPackagesOut,
    AssetModelRunStart,
    AssetModelRunWithJob,
)
from app.asset_models.schemas_plant import SiteModelPackageListOut, SiteModelPackageOut
from app.asset_models.service import refresh_status
from app.asset_models.store import INT32_MAX
from app.db.base import utcnow
from app.db.models import AssetModel, AssetModelRun, Drawing, Image, PointCloud
from app.errors import AppError, not_found
from app.events_util import publish_asset_models_changed
from app.jobs.schemas import JobOut
from app.projects.service import ProjectHandle, get_project
from app.surfaces.design.store import ID_RE

router = APIRouter(prefix="/projects/{projectId}", tags=["assetmodels"])
R = "/asset-models/{assetModelId}/runs"
READY = {
    "drawing": (Drawing, lambda r: r.status == "ready"),
    "point_cloud": (PointCloud, lambda r: r.status == "ready"),
    "image": (Image, lambda r: True),
}


def _run_row(s, model_id, run_id) -> AssetModelRun:
    row = s.get(AssetModelRun, run_id)
    if row is None or row.model_id != model_id:
        raise not_found("asset model run", run_id)
    return row


def _out(s, row: AssetModelRun) -> AssetModelRunOut:
    counts = (
        AssetModelRunPackagesOut(**plant_packages.summary(s, row.id)) if row.mode in PLANT_MODES else None
    )
    return AssetModelRunOut.of(row, counts)


def _abandon(handle, model_id: str, run_id: str) -> None:
    """The job never started: fail the run and release the model so it is not stuck `building`."""
    with handle.session() as s:
        run = s.get(AssetModelRun, run_id)
        if run is not None:
            run.state, run.summary, run.ended_at = "failed", "The run could not be started.", utcnow()
        model = s.get(AssetModel, model_id)
        if model is not None and model.live_run_id == run_id:
            model.live_run_id = None
            refresh_status(model)


@router.post(R, response_model=AssetModelRunWithJob, status_code=202)
def start_asset_model_run(
    assetModelId: str,  # noqa: N803
    body: AssetModelRunStart,
    request: Request,
    handle: ProjectHandle = Depends(get_project),
):
    jobs, keys = request.app.state.jobs, request.app.state.keys
    with handle.session() as s:
        model = store.get_model(s, assetModelId)
        if model.live_run_id:
            live = s.get(AssetModelRun, model.live_run_id)
            if live is not None and jobs.is_live(live.job_id):
                raise AppError(
                    "job_running", "A run is already building this model.", 409, {"job_id": live.job_id}
                )
        if not keys.get(body.provider):
            raise AppError("provider_key_missing", "Add this provider's API key in App settings.", 409)
        for src in body.sources:
            cls, ok = READY[src.type]
            row = s.get(cls, src.id)
            if row is None or not ok(row):
                raise AppError(
                    "no_sources",
                    "A chosen source is missing or not ready.",
                    422,
                    {"source": src.model_dump()},
                )
        if body.mode == "refine" and not model.current_version:
            raise AppError("nothing_to_refine", "This model has no version to refine yet.", 422)
        if body.mode == "plant" and not any(x.type == "drawing" for x in body.sources):
            raise AppError("no_sources", "A plant run needs at least one drawing.", 422)
        old_packages = []
        if body.mode == "plant_package":
            if not model.current_version:
                raise AppError(
                    "nothing_to_refine", "This model has no version to re-run packages on yet.", 422
                )
            if not body.package_ids:
                raise AppError("validation_error", "Choose the packages to re-run.", 422)
            old_packages = plant_packages.find_for_model(s, assetModelId, body.package_ids)
            if len(old_packages) != len(set(body.package_ids)):
                raise AppError("validation_error", "A chosen package is not part of this model's runs.", 422)
        model_name = body.model_name or request.app.state.provider_config.get(body.provider).model_name
        run = AssetModelRun(
            model_id=assetModelId,
            job_id="pending",
            provider=body.provider,
            model_name=model_name,
            mode=body.mode,
            notes=body.notes,
            sources=[x.model_dump() for x in body.sources],
        )
        s.add(run)
        s.flush()
        run_id = run.id
        model.live_run_id = run_id
        if body.mode in PLANT_MODES:
            model.kind = "plant"
            _plant_setup(request, handle, s, model, run_id, body, old_packages)
        refresh_status(model)
    try:
        job = jobs.submit(handle, "asset_model_run", {"model_id": assetModelId, "run_id": run_id})
    except Exception:
        _abandon(handle, assetModelId, run_id)
        publish_asset_models_changed(request, handle, [assetModelId])
        raise
    with handle.session() as s:
        run = _run_row(s, assetModelId, run_id)
        run.job_id = job.id
        out = _out(s, run)
    publish_asset_models_changed(request, handle, [assetModelId])
    return AssetModelRunWithJob(run=out, job=JobOut.from_row(job, handle.id))


@router.get(R, response_model=AssetModelRunList)
def list_asset_model_runs(assetModelId: str, handle: ProjectHandle = Depends(get_project)):  # noqa: N803
    with handle.session() as s:
        store.get_model(s, assetModelId)
        rows = s.scalars(
            select(AssetModelRun)
            .where(AssetModelRun.model_id == assetModelId)
            .order_by(AssetModelRun.started_at.desc(), AssetModelRun.id)
        ).all()
        return AssetModelRunList(items=[_out(s, r) for r in rows])


@router.get(R + "/{runId}", response_model=AssetModelRunOut)
def get_asset_model_run(assetModelId: str, runId: str, handle: ProjectHandle = Depends(get_project)):  # noqa: N803
    with handle.session() as s:
        return _out(s, _run_row(s, assetModelId, runId))


@router.post(R + "/{runId}/stop", response_model=AssetModelRunOut, status_code=202)
def stop_asset_model_run(
    assetModelId: str,  # noqa: N803
    runId: str,  # noqa: N803
    request: Request,
    handle: ProjectHandle = Depends(get_project),
):
    with handle.session() as s:
        run = _run_row(s, assetModelId, runId)
        if run.state == "running":
            request.app.state.jobs.cancel(handle, run.job_id)
        return _out(s, run)


@router.get(R + "/{runId}/steps/{step}/thumb")
def get_asset_model_run_thumb(
    assetModelId: str,  # noqa: N803
    runId: str,  # noqa: N803
    step: int = Path(ge=1, le=INT32_MAX),
    handle: ProjectHandle = Depends(get_project),
):
    with handle.session() as s:
        _run_row(s, assetModelId, runId)
    path = store.run_dir(handle, assetModelId, runId) / f"step_{int(step)}.png"
    if not path.exists():
        return Response(status_code=204)
    return Response(
        path.read_bytes(), media_type="image/png", headers={"Cache-Control": "private, max-age=3600"}
    )


@router.get(R + "/{runId}/overlay/{cloudId}")
def get_asset_model_run_overlay(
    assetModelId: str,  # noqa: N803
    runId: str,  # noqa: N803
    cloudId: str,  # noqa: N803
    handle: ProjectHandle = Depends(get_project),
):
    if not ID_RE.fullmatch(cloudId or ""):
        raise not_found("point cloud", cloudId)
    with handle.session() as s:
        _run_row(s, assetModelId, runId)
    path = store.run_dir(handle, assetModelId, runId) / f"overlay_{cloudId}.bin"
    if not path.exists():
        return Response(status_code=204)
    return FileResponse(path, media_type="application/octet-stream")


def _plant_setup(request, handle, s, model, run_id: str, body, old) -> None:
    """The run's limits (settings.json defaults, then the body's) and, for a re-run, the copied packages
    and their briefs, written to the run's state file before the job starts."""
    appdata = getattr(getattr(request.app.state, "provider_config", None), "appdata", None)
    limits = resolve_limits(appdata, body.limits.model_dump(exclude_none=True) if body.limits else None)
    st = PlantState(
        limits=asdict(limits),
        package_ids=list(body.package_ids or []),
        base_version=model.current_version if body.mode == "plant_package" else None,
    )
    if old:
        rows = plant_packages.copy_for_rerun(s, run_id, old)
        for new, prev in zip(rows, old, strict=True):
            try:
                meta = load_state(store.run_dir(handle, model.id, prev.run_id)).packages_meta.get(prev.id, {})
            except Exception:  # noqa: BLE001 - an unreadable old state file only loses the brief
                meta = {}
            st.packages_meta[new.id] = {
                "brief": meta.get("brief") or prev.label,
                "expected_tags": list(meta.get("expected_tags") or []),
            }
    save_state(store.run_dir(handle, model.id, run_id), st)


@router.get(R + "/{runId}/packages", response_model=SiteModelPackageListOut)
def list_asset_model_run_packages(
    assetModelId: str,  # noqa: N803
    runId: str,  # noqa: N803
    handle: ProjectHandle = Depends(get_project),
):
    with handle.session() as s:
        _run_row(s, assetModelId, runId)
        return SiteModelPackageListOut(
            items=[SiteModelPackageOut.of(r) for r in plant_packages.rows(s, runId)]
        )
