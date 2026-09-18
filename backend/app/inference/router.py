"""Query runs and synchronous pre-annotation (spec sections 7 and 8)."""

from fastapi import APIRouter, Body, Depends, Query, Request

from app.datasets.schemas import BoxOut
from app.inference import service
from app.inference.jobs import run_infer  # noqa: F401 - the import registers the `infer` job type
from app.inference.schemas import (
    CostEstimate,
    PreannotateRequest,
    PreannotateResult,
    PromoteRequest,
    PromoteResult,
    QueryRunCreate,
    QueryRunOut,
    QueryRunPage,
    QueryRunWithJob,
)
from app.jobs.schemas import JobOut
from app.projects.service import ProjectHandle, get_project
from app.training.schemas import JobRef

router = APIRouter(prefix="/projects/{projectId}", tags=["query-runs"])


def _config(request: Request):
    return request.app.state.provider_config


@router.post("/query-runs/estimate", response_model=CostEstimate)
def estimate_query_run(
    body: QueryRunCreate, request: Request, handle: ProjectHandle = Depends(get_project)
) -> CostEstimate:
    return CostEstimate(**service.estimate(handle, _config(request), body))


@router.get("/query-runs", response_model=QueryRunPage)
def list_query_runs(
    handle: ProjectHandle = Depends(get_project),
    limit: int | None = Query(None, ge=1, le=1000),
    cursor: str | None = None,
) -> QueryRunPage:
    rows, next_cursor = service.list_query_runs(handle, limit, cursor)
    return QueryRunPage(
        items=[QueryRunOut.from_row(row, count) for row, count in rows], next_cursor=next_cursor
    )


@router.post("/query-runs", response_model=QueryRunWithJob, status_code=202)
def create_query_run(
    body: QueryRunCreate, request: Request, handle: ProjectHandle = Depends(get_project)
) -> QueryRunWithJob:
    run = service.create_query_run(handle, request.app.state.keys, _config(request), body)
    job = request.app.state.jobs.submit(handle, "infer", {"query_run_id": run.id})
    run = service.set_job(handle, run.id, job.id)
    return QueryRunWithJob(query_run=QueryRunOut.from_row(run, 0), job=JobOut.from_row(job, handle.id))


@router.get("/query-runs/{runId}", response_model=QueryRunOut)
def get_query_run(runId: str, handle: ProjectHandle = Depends(get_project)) -> QueryRunOut:  # noqa: N803
    row, count = service.get_query_run(handle, runId)
    return QueryRunOut.from_row(row, count)


@router.post("/query-runs/{runId}/resume", response_model=JobRef, status_code=202)
def resume_query_run(
    runId: str,  # noqa: N803
    request: Request,
    handle: ProjectHandle = Depends(get_project),
) -> JobRef:
    """Run the same query run again. Its persisted tiles are reused, so only the gaps are paid for."""
    run = service.check_resumable(handle, runId)
    job = request.app.state.jobs.submit(handle, "infer", {"query_run_id": run.id})
    service.set_job(handle, run.id, job.id)
    return JobRef(job=JobOut.from_row(job, handle.id))


@router.post("/query-runs/{runId}/promote", response_model=PromoteResult)
def promote_query_run(
    runId: str,  # noqa: N803
    request: Request,
    handle: ProjectHandle = Depends(get_project),
    body: PromoteRequest | None = Body(None),
) -> PromoteResult:
    threshold = (body or PromoteRequest()).min_confidence
    row, count, accepted, image_ids = service.promote(handle, runId, threshold)
    if image_ids:
        request.app.state.events.publish(
            {
                "type": "boxes.changed",
                "project_id": handle.id,
                "job_id": None,
                "progress": None,
                "message": "",
                "payload": {"image_ids": image_ids},
            }
        )
    return PromoteResult(query_run=QueryRunOut.from_row(row, count), accepted=accepted)


@router.post("/images/{imageId}/preannotate", response_model=PreannotateResult)
def preannotate_image(
    imageId: str,  # noqa: N803
    handle: ProjectHandle = Depends(get_project),
    body: PreannotateRequest | None = Body(None),
) -> PreannotateResult:
    """Synchronous by design: the editor opens an image and wants its proposals in that response."""
    skipped, model_id, rows = service.preannotate(handle, imageId, body or PreannotateRequest())
    return PreannotateResult(skipped=skipped, model_id=model_id, items=[BoxOut.from_row(r) for r in rows])
