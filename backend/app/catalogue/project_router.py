"""`PUT /projects/{projectId}/types` (spec 2026-09-26-foundation section 7.3); replaces
`PUT /projects/{projectId}/classes`."""

from fastapi import APIRouter, Depends, Request
from pydantic import BaseModel, Field

from app.catalogue import project_types
from app.projects.router import _out as project_out
from app.projects.schemas import ProjectOut
from app.projects.service import ProjectHandle, get_project

router = APIRouter(prefix="/projects/{projectId}", tags=["projects"])


class ProjectTypesPut(BaseModel):
    type_ids: list[str] = Field(max_length=500)
    hotkeys: dict[str, str | None] | None = None


@router.put("/types", response_model=ProjectOut)
def put_project_types(
    body: ProjectTypesPut, request: Request, handle: ProjectHandle = Depends(get_project)
) -> ProjectOut:
    with handle.session() as s:
        project_types.set_types(s, handle.catalogue, body.type_ids, body.hotkeys)
    return project_out(handle, request.app.state.projects.last_opened_at(handle.id))
