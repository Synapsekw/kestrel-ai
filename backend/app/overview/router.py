"""`GET /projects/{projectId}/overview` (spec 2026-09-26-foundation section 9.1)."""

from fastapi import APIRouter, Depends

from app.overview import service
from app.overview.schemas import ProjectOverview
from app.projects.service import ProjectHandle, get_project

router = APIRouter(prefix="/projects/{projectId}", tags=["projects"])


@router.get("/overview", response_model=ProjectOverview)
def get_project_overview(handle: ProjectHandle = Depends(get_project)) -> ProjectOverview:
    return ProjectOverview(**service.build(handle))
