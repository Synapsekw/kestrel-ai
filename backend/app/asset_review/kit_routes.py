"""`POST /projects/{projectId}/review-imports` (spec 2026-10-02-asset-findings §8): checks the
request and queues `review_kit_import`. A dry run's preview is the job's result."""

from __future__ import annotations

from fastapi import APIRouter, Depends, Request
from pydantic import BaseModel, ConfigDict, Field

from app.asset_review import kit_import
from app.jobs.schemas import JobOut
from app.projects.service import ProjectHandle, get_project
from app.training.schemas import JobRef

router = APIRouter(prefix="/projects/{projectId}", tags=["assetreview"])


class ReviewImportIn(BaseModel):
    model_config = ConfigDict(extra="forbid")
    folder: str = Field(min_length=1, max_length=1024)
    image_source_id: str
    asset_model_id: str | None = None
    new_model_name: str | None = Field(None, min_length=1, max_length=120)
    class_map: dict[str, str] = Field(default_factory=dict)
    dry_run: bool = False


@router.post("/review-imports", response_model=JobRef, status_code=202)
def start_review_import(
    body: ReviewImportIn, request: Request, handle: ProjectHandle = Depends(get_project)
) -> JobRef:
    params = kit_import.check_request(handle, body.model_dump())
    job = request.app.state.jobs.submit(handle, kit_import.JOB, params)
    return JobRef(job=JobOut.from_row(job, handle.id))
