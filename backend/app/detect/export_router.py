"""`POST /detect-exports` (plan 2 unit E): starts a `detect_export` job.

Detection projects only: a training project answers `409 wrong_project_kind` (the guard is on the
router, where `api.py` includes it).
"""

from __future__ import annotations

from typing import Literal

from fastapi import APIRouter, Depends, Request
from pydantic import BaseModel

from app.db.models import Source
from app.detect.export_job import run_detect_export  # noqa: F401 - registers `detect_export`
from app.errors import not_found
from app.exports.schemas import JobRef
from app.jobs.schemas import JobOut
from app.projects.service import ProjectHandle, get_project

router = APIRouter(prefix="/projects/{projectId}", tags=["detect"])


class DetectExportRequest(BaseModel):
    format: Literal["csv", "pdf"]
    source_id: str | None = None


@router.post("/detect-exports", response_model=JobRef, status_code=202)
def create_detect_export(
    body: DetectExportRequest, request: Request, handle: ProjectHandle = Depends(get_project)
) -> JobRef:
    if body.source_id is not None:
        with handle.session() as s:
            if s.get(Source, body.source_id) is None:
                raise not_found("source", body.source_id)
    job = request.app.state.jobs.submit(handle, "detect_export", body.model_dump())
    return JobRef(job=JobOut.from_row(job, handle.id))
