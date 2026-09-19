"""Routes for results exports and revealing a project path in Explorer (spec G2)."""

from fastapi import APIRouter, Depends, Request, Response

from app.exports import reveal as reveal_service
from app.exports.job import run_export  # noqa: F401 - importing it registers the results_export job type
from app.exports.schemas import JobRef, ResultsExportRequest, RevealRequest
from app.jobs.schemas import JobOut
from app.projects.service import ProjectHandle, get_project

router = APIRouter(prefix="/projects/{projectId}", tags=["exports"])


@router.post("/exports", response_model=JobRef, status_code=202)
def create_results_export(
    body: ResultsExportRequest, request: Request, handle: ProjectHandle = Depends(get_project)
) -> JobRef:
    job = request.app.state.jobs.submit(handle, "results_export", body.model_dump())
    return JobRef(job=JobOut.from_row(job, handle.id))


@router.post("/reveal", status_code=204)
def reveal_in_explorer(body: RevealRequest, handle: ProjectHandle = Depends(get_project)) -> Response:
    reveal_service.reveal(handle, body.path)
    return Response(status_code=204)
