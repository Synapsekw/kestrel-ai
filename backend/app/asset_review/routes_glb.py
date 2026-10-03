"""`POST /asset-models/{assetModelId}/versions/import-glb` (spec §8). The route checks the file
cheaply and queues `asset_glb_import`; it never copies or loads the GLB itself."""

from __future__ import annotations

from pathlib import Path

from fastapi import APIRouter, Depends, Request

from app.asset_models import store
from app.asset_models.schemas import AssetModelVersionOut, AssetModelVersionWithJob
from app.asset_review import glb_import
from app.asset_review.glb_schemas import GlbImportRequest
from app.errors import AppError
from app.events_util import publish_asset_models_changed
from app.jobs.schemas import JobOut
from app.projects.service import ProjectHandle, get_project

router = APIRouter(prefix="/projects/{projectId}", tags=["assetmodels"])


@router.post(
    "/asset-models/{assetModelId}/versions/import-glb",
    response_model=AssetModelVersionWithJob,
    status_code=202,
)
def import_asset_model_glb(
    assetModelId: str,  # noqa: N803
    body: GlbImportRequest,
    request: Request,
    handle: ProjectHandle = Depends(get_project),
) -> AssetModelVersionWithJob:
    with handle.session() as s:
        if store.get_model(s, assetModelId).live_run_id:
            raise AppError("job_running", "An agent run is building this model; wait for it to finish.", 409)
    source = Path(body.path)
    glb_import.check_source(source)
    row, job = glb_import.start_import(
        handle,
        request.app.state.jobs,
        assetModelId,
        path=source,
        conversion=body.frame_conversion,
        origin=body.origin.model_dump(mode="json") if body.origin else None,
        note=body.note,
    )
    publish_asset_models_changed(request, handle, [assetModelId])
    return AssetModelVersionWithJob(version=AssetModelVersionOut.of(row), job=JobOut.from_row(job, handle.id))
