"""`POST /projects/{projectId}/open` (spec 2026-09-26-reports §14; unit R1)."""

from fastapi import APIRouter, Depends, Response

from app.exports.schemas import RevealRequest
from app.projects.service import ProjectHandle, get_project
from app.reports import open_file

router = APIRouter(prefix="/projects/{projectId}")


@router.post("/open", status_code=204)
def open_project_file(body: RevealRequest, handle: ProjectHandle = Depends(get_project)) -> Response:
    open_file.open_in_default_app(handle, body.path)
    return Response(status_code=204)
