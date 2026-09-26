"""`/projects/{id}/adoption`: how far a project's old models are into the library (spec 2026-09-23
section 6)."""

from fastapi import APIRouter, Depends, Request
from pydantic import BaseModel

from app.jobs.schemas import JobOut
from app.library import adoption
from app.library.handle import get_library
from app.projects.service import ProjectHandle, get_project
from app.training.schemas import JobRef


class AdoptionMissing(BaseModel):
    old_model_id: str
    name: str
    error: str


class AdoptionStatus(BaseModel):
    pending: int
    adopted: int
    missing: list[AdoptionMissing]
    job_id: str | None


router = APIRouter(prefix="/projects/{projectId}", tags=["projects"])


@router.get("/adoption", response_model=AdoptionStatus)
def get_adoption(handle: ProjectHandle = Depends(get_project)) -> AdoptionStatus:
    return AdoptionStatus(**adoption.adoption_status(handle))


@router.post("/adoption/retry", response_model=JobRef, status_code=202, dependencies=[Depends(get_library)])
def retry_adoption(request: Request, handle: ProjectHandle = Depends(get_project)) -> JobRef:
    job = adoption.retry(handle, request.app.state.jobs)
    return JobRef(job=JobOut.from_row(job, handle.id))
