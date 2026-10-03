"""Asset models and versions (spec §9). Runs live in `runs.py`."""

from __future__ import annotations

import shutil

from fastapi import APIRouter, Depends, Path, Request, Response
from fastapi.responses import FileResponse
from sqlalchemy import func, select

from app.asset_models import jobs_glb as _jobs  # noqa: F401 - registers `asset_model_glb`
from app.asset_models import service, store
from app.asset_models.schemas import (
    AssetModelCreate,
    AssetModelList,
    AssetModelOut,
    AssetModelPatch,
    AssetModelVersionCreate,
    AssetModelVersionDetailOut,
    AssetModelVersionList,
    AssetModelVersionOut,
    AssetModelVersionWithJob,
    SpecIssueOut,
)
from app.asset_models.spec import AssetSpec
from app.asset_models.store import INT32_MAX
from app.asset_models.validate import validate
from app.asset_review import frame_io, glb_import
from app.db.models import AssetModel, AssetModelVersion, Finding, FindingSighting
from app.errors import AppError
from app.events_util import publish_asset_models_changed
from app.jobs.schemas import JobOut
from app.projects.service import ProjectHandle, get_project

router = APIRouter(prefix="/projects/{projectId}", tags=["assetmodels"])
P = "/asset-models"


@router.get(P, response_model=AssetModelList)
def list_asset_models(handle: ProjectHandle = Depends(get_project)):
    with handle.session() as s:
        rows = s.scalars(select(AssetModel).order_by(AssetModel.created_at.desc(), AssetModel.id)).all()
        return AssetModelList(items=[AssetModelOut.of(r) for r in rows])


@router.post(P, response_model=AssetModelOut, status_code=201)
def create_asset_model(
    body: AssetModelCreate, request: Request, handle: ProjectHandle = Depends(get_project)
):
    with handle.session() as s:
        row = AssetModel(name=body.name, asset_type=body.asset_type, tag=body.tag, status="empty")
        s.add(row)
        s.flush()
        out = AssetModelOut.of(row)
    publish_asset_models_changed(request, handle, [out.id])
    return out


@router.get(P + "/{assetModelId}", response_model=AssetModelOut)
def get_asset_model(assetModelId: str, handle: ProjectHandle = Depends(get_project)):  # noqa: N803
    with handle.session() as s:
        return AssetModelOut.of(store.get_model(s, assetModelId))


@router.patch(P + "/{assetModelId}", response_model=AssetModelOut)
def patch_asset_model(
    assetModelId: str,
    body: AssetModelPatch,
    request: Request,  # noqa: N803
    handle: ProjectHandle = Depends(get_project),
):
    fields = body.model_dump(exclude_unset=True)
    framing = {k: fields.pop(k) for k in ("frame", "review") if k in fields}
    with handle.session() as s:
        row = store.get_model(s, assetModelId)
        for k, v in fields.items():
            setattr(row, k, v)
        frame_io.apply_patch(row, framing)
        s.flush()
        out = AssetModelOut.of(row)
    publish_asset_models_changed(request, handle, [assetModelId])
    return out


def _placed_on(findings: int, loose: int) -> str:
    """What holds the model, as the subject of the refusal: for example `1 finding is`."""
    parts = []
    if findings:
        parts.append("1 finding" if findings == 1 else f"{findings} findings")
    if loose:
        parts.append("1 ungrouped sighting" if loose == 1 else f"{loose} ungrouped sightings")
    return f"{' and '.join(parts)} {'is' if findings + loose == 1 else 'are'}"


@router.delete(P + "/{assetModelId}", status_code=204)
def delete_asset_model(assetModelId: str, request: Request, handle: ProjectHandle = Depends(get_project)):  # noqa: N803
    jobs = request.app.state.jobs
    with handle.session() as s:
        row = store.get_model(s, assetModelId)
        # Any finding, closed ones too, and any sighting not yet grouped: their pins, heights and
        # zones were computed on this model (asset findings plan, Review Focus 4). A grouped
        # sighting belongs to a finding on this same model, so the findings count covers it. The
        # foreign keys would refuse the delete as well, as a 500.
        held = s.scalar(
            select(func.count()).select_from(Finding).where(Finding.asset_model_id == assetModelId)
        )
        loose = s.scalar(
            select(func.count())
            .select_from(FindingSighting)
            .where(FindingSighting.asset_model_id == assetModelId, FindingSighting.finding_id.is_(None))
        )
        if held or loose:
            raise AppError(
                "has_findings",
                f"{_placed_on(held, loose)} placed on this model. Delete them or move them to another"
                " model first.",
                409,
                {"count": held + loose},
            )
        pairs = s.execute(
            select(AssetModelVersion.glb_job_id, AssetModelVersion.glb_status).where(
                AssetModelVersion.model_id == assetModelId
            )
        ).all()
        live = [j for j, _ in pairs if j and jobs.is_live(j)]
        # A pending version with no job id yet is in the window between submit and recording the id.
        submitting = any(j is None and st == "pending" for j, st in pairs)
        if row.live_run_id or live or submitting:
            raise AppError(
                "job_running",
                "A run or GLB build is in progress for this model.",
                409,
                {"job_id": live[0] if live else None},
            )
        s.delete(row)
    shutil.rmtree(store.model_dir(handle, assetModelId), ignore_errors=True)
    publish_asset_models_changed(request, handle, [assetModelId])
    return Response(status_code=204)


@router.get(P + "/{assetModelId}/versions", response_model=AssetModelVersionList)
def list_asset_model_versions(assetModelId: str, handle: ProjectHandle = Depends(get_project)):  # noqa: N803
    with handle.session() as s:
        store.get_model(s, assetModelId)
        rows = s.scalars(
            select(AssetModelVersion)
            .where(AssetModelVersion.model_id == assetModelId)
            .order_by(AssetModelVersion.version.desc())
        ).all()
        return AssetModelVersionList(items=[AssetModelVersionOut.of(r) for r in rows])


@router.post(P + "/{assetModelId}/versions", response_model=AssetModelVersionWithJob, status_code=201)
def create_asset_model_version(
    assetModelId: str,
    body: AssetModelVersionCreate,
    request: Request,  # noqa: N803
    handle: ProjectHandle = Depends(get_project),
):
    with handle.session() as s:
        store.get_model(s, assetModelId)  # 404 before the body's spec is judged
    spec = service.parse_spec(body.spec)
    row, job = service.add_version(
        handle,
        request.app.state.jobs,
        assetModelId,
        spec,
        kind="manual",
        note=body.note,
    )
    publish_asset_models_changed(request, handle, [assetModelId])
    return AssetModelVersionWithJob(version=AssetModelVersionOut.of(row), job=JobOut.from_row(job, handle.id))


@router.get(P + "/{assetModelId}/versions/{version}", response_model=AssetModelVersionDetailOut)
def get_asset_model_version(
    assetModelId: str,  # noqa: N803
    version: int = Path(ge=1, le=INT32_MAX),
    handle: ProjectHandle = Depends(get_project),
):
    with handle.session() as s:
        row = store.get_version(s, assetModelId, version)
        spec = AssetSpec.model_validate(row.spec)
        warnings = [SpecIssueOut(**i) for i in service.issues(validate(spec).warnings)]
        base = AssetModelVersionOut.of(row).model_dump()
        return AssetModelVersionDetailOut(**base, spec=spec, warnings=warnings)


@router.post(
    P + "/{assetModelId}/versions/{version}/restore", response_model=AssetModelVersionWithJob, status_code=201
)
def restore_asset_model_version(
    assetModelId: str,
    request: Request,  # noqa: N803
    version: int = Path(ge=1, le=INT32_MAX),
    handle: ProjectHandle = Depends(get_project),
):
    with handle.session() as s:
        old = store.get_version(s, assetModelId, version)
        kind, meta, sources = old.kind, dict(old.meta or {}), list(old.source_ids)
        spec = None if kind == "imported" else AssetSpec.model_validate(old.spec)
    if kind == "imported":
        # An imported version has no spec to rebuild from: re-import its stored GLB as it is.
        stored = store.version_glb_path(handle, assetModelId, version)
        if not stored.is_file():
            raise AppError("not_ready", "The 3D model for this version is not available.", 409)
        row, job = glb_import.start_import(
            handle,
            request.app.state.jobs,
            assetModelId,
            path=stored,
            conversion="none",
            origin=None,
            note=f"Restored from version {version}",
            source_name=meta.get("source_name"),
        )
    else:
        row, job = service.add_version(
            handle,
            request.app.state.jobs,
            assetModelId,
            spec,
            kind="manual",
            note=f"Restored from version {version}",
            source_ids=sources,
        )
    publish_asset_models_changed(request, handle, [assetModelId])
    return AssetModelVersionWithJob(version=AssetModelVersionOut.of(row), job=JobOut.from_row(job, handle.id))


@router.get(P + "/{assetModelId}/versions/{version}/glb", response_class=FileResponse)
def get_asset_model_glb(
    assetModelId: str,  # noqa: N803
    version: int = Path(ge=1, le=INT32_MAX),
    handle: ProjectHandle = Depends(get_project),
):
    with handle.session() as s:
        row = store.get_version(s, assetModelId, version)
        ready = row.glb_status == "ready"
    path = store.version_glb_path(handle, assetModelId, version)
    if not ready or not path.exists():
        raise AppError("not_ready", "The 3D model for this version is not built yet.", 409)
    return FileResponse(
        path, media_type="model/gltf-binary", headers={"Cache-Control": "private, max-age=3600"}
    )
