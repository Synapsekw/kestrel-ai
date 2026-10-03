"""Regroup (spec 2026-10-02-asset-findings §8): `POST /asset-models/{assetModelId}/findings/regroup`
starts `asset_group`. Merge and split live on the findings router."""

from fastapi import APIRouter, Depends, Request

from app.asset_models import store
from app.asset_review import jobs_group
from app.jobs.schemas import JobOut
from app.projects.service import ProjectHandle, get_project
from app.training.schemas import JobRef

router = APIRouter(prefix="/projects/{projectId}", tags=["assetreview"])


@router.post("/asset-models/{assetModelId}/findings/regroup", response_model=JobRef, status_code=202)
def regroup_asset_findings(
    assetModelId: str,  # noqa: N803
    request: Request,
    handle: ProjectHandle = Depends(get_project),
) -> JobRef:
    with handle.session() as s:
        store.get_model(s, assetModelId)  # 404 for an unknown model
    job = jobs_group.submit_group(handle, request.app.state.jobs, assetModelId)
    return JobRef(job=JobOut.from_row(job, handle.id))
