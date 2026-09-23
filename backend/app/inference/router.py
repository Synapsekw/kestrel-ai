"""Query runs and synchronous pre-annotation (spec sections 7 and 8)."""

from fastapi import APIRouter, Body, Depends, Query, Request

from app.datasets.schemas import BoxOut
from app.events_util import publish_image_ids_event
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
    UnpromoteResult,
)
from app.jobs.schemas import JobOut
from app.projects.kinds import ANY_KIND, require_kind
from app.projects.service import ProjectHandle, get_project
from app.training.schemas import JobRef

router = APIRouter(prefix="/projects/{projectId}", tags=["query-runs"])
# Query runs serve both kinds. The plan's table makes them detection-only, but the project agent's
# labelling tools and the setup flow label a training project's images through query runs and
# their promotion; refusing them would leave training projects without assisted labelling.
QUERY_RUN_KINDS = [Depends(require_kind(ANY_KIND))]
TRAIN_ONLY = [Depends(require_kind(("train",)))]


def _boxes_changed(request: Request, handle: ProjectHandle, image_ids: list[str]) -> None:
    publish_image_ids_event(request, handle, "boxes.changed", image_ids)


def _config(request: Request):
    return request.app.state.provider_config


@router.post("/query-runs/estimate", response_model=CostEstimate, dependencies=QUERY_RUN_KINDS)
def estimate_query_run(
    body: QueryRunCreate, request: Request, handle: ProjectHandle = Depends(get_project)
) -> CostEstimate:
    return CostEstimate(**service.estimate(handle, _config(request), body))


@router.get("/query-runs", response_model=QueryRunPage, dependencies=QUERY_RUN_KINDS)
def list_query_runs(
    handle: ProjectHandle = Depends(get_project),
    limit: int | None = Query(None, ge=1, le=1000),
    cursor: str | None = None,
) -> QueryRunPage:
    rows, next_cursor = service.list_query_runs(handle, limit, cursor)
    return QueryRunPage(
        items=[QueryRunOut.from_row(row, count) for row, count in rows], next_cursor=next_cursor
    )


@router.post("/query-runs", response_model=QueryRunWithJob, status_code=202, dependencies=QUERY_RUN_KINDS)
def create_query_run(
    body: QueryRunCreate, request: Request, handle: ProjectHandle = Depends(get_project)
) -> QueryRunWithJob:
    run = service.create_query_run(handle, request.app.state.keys, _config(request), body)
    job = request.app.state.jobs.submit(handle, "infer", {"query_run_id": run.id})
    run = service.set_job(handle, run.id, job.id)
    return QueryRunWithJob(query_run=QueryRunOut.from_row(run, 0), job=JobOut.from_row(job, handle.id))


@router.get("/query-runs/{runId}", response_model=QueryRunOut, dependencies=QUERY_RUN_KINDS)
def get_query_run(runId: str, handle: ProjectHandle = Depends(get_project)) -> QueryRunOut:  # noqa: N803
    row, count = service.get_query_run(handle, runId)
    return QueryRunOut.from_row(row, count)


@router.post(
    "/query-runs/{runId}/resume", response_model=JobRef, status_code=202, dependencies=QUERY_RUN_KINDS
)
def resume_query_run(
    runId: str,  # noqa: N803
    request: Request,
    handle: ProjectHandle = Depends(get_project),
) -> JobRef:
    """Run the same query run again. Its persisted tiles are reused, so only the gaps are paid for."""
    job = service.resume(
        handle, runId, lambda run: request.app.state.jobs.submit(handle, "infer", {"query_run_id": run.id})
    )
    return JobRef(job=JobOut.from_row(job, handle.id))


@router.post("/query-runs/{runId}/promote", response_model=PromoteResult, dependencies=QUERY_RUN_KINDS)
def promote_query_run(
    runId: str,  # noqa: N803
    request: Request,
    handle: ProjectHandle = Depends(get_project),
    body: PromoteRequest | None = Body(None),
) -> PromoteResult:
    req = body or PromoteRequest()
    row, count, accepted, image_ids = service.promote(handle, runId, req.min_confidence, req.dry_run)
    _boxes_changed(request, handle, image_ids)
    return PromoteResult(query_run=QueryRunOut.from_row(row, count), accepted=accepted)


@router.post("/query-runs/{runId}/unpromote", response_model=UnpromoteResult, dependencies=QUERY_RUN_KINDS)
def unpromote_query_run(
    runId: str,  # noqa: N803
    request: Request,
    handle: ProjectHandle = Depends(get_project),
) -> UnpromoteResult:
    row, count, reverted, image_ids = service.unpromote(handle, runId)
    _boxes_changed(request, handle, image_ids)
    return UnpromoteResult(query_run=QueryRunOut.from_row(row, count), reverted=reverted)


@router.post("/images/{imageId}/preannotate", response_model=PreannotateResult, dependencies=TRAIN_ONLY)
def preannotate_image(
    imageId: str,  # noqa: N803
    handle: ProjectHandle = Depends(get_project),
    body: PreannotateRequest | None = Body(None),
) -> PreannotateResult:
    """Synchronous by design: the editor opens an image and wants its proposals in that response."""
    skipped, model_id, rows = service.preannotate(handle, imageId, body or PreannotateRequest())
    return PreannotateResult(skipped=skipped, model_id=model_id, items=[BoxOut.from_row(r) for r in rows])
