"""Detection runs and class mapping (spec 2026-09-23 sections 7.2-7.4; plan 2 unit R).

Any project may create and read runs (spec 2026-09-26-foundation section 6.1).
"""

from fastapi import APIRouter, Depends, Query, Request

from app.detect import class_maps, runs
from app.detect.schemas import (
    ModelClassMapOut,
    ModelClassMapPut,
    RunCreate,
    RunCreated,
    RunCreatedItem,
    RunPatch,
    RunSummary,
    RunSummaryPage,
)
from app.errors import AppError
from app.inference.jobs import run_infer  # noqa: F401 - registers `infer`
from app.jobs.schemas import JobOut
from app.library import service as library
from app.library.catalogue_port import NO_CATALOGUE, catalogue_of
from app.library.db import LibraryModel
from app.library.handle import library_unavailable
from app.maps.jobs_detect import run_map_detect  # noqa: F401 - registers `map_detect`
from app.projects.service import ProjectHandle, get_project
from app.training.schemas import JobRef

router = APIRouter(prefix="/projects/{projectId}", tags=["detect"])


def _model(request: Request, model_id: str) -> LibraryModel:
    lib = getattr(request.app.state, "library", None)
    if lib is None:
        raise library_unavailable()
    return library.get_model(lib, model_id)


def _class_map_out(request: Request, model: LibraryModel) -> ModelClassMapOut:
    mapping, unmapped = class_maps.resolve_for_model(catalogue_of(request.app.state), model)
    return ModelClassMapOut(
        model_id=model.id, model_classes=list(model.class_names or []), mapping=mapping, unmapped=unmapped
    )


@router.get("/model-class-maps/{modelId}", response_model=ModelClassMapOut)
def get_model_class_map(
    modelId: str,  # noqa: N803
    request: Request,
    handle: ProjectHandle = Depends(get_project),
) -> ModelClassMapOut:
    """The app-wide map (F10), read through a project; the project only proves it exists."""
    return _class_map_out(request, _model(request, modelId))


@router.put("/model-class-maps/{modelId}", response_model=ModelClassMapOut)
def put_model_class_map(
    modelId: str,  # noqa: N803
    body: ModelClassMapPut,
    request: Request,
    handle: ProjectHandle = Depends(get_project),
) -> ModelClassMapOut:
    model = _model(request, modelId)
    catalogue = catalogue_of(request.app.state)
    try:
        saved = class_maps.put_map(
            request.app.state.library, catalogue, model.id, body.mapping, body.new_classes
        )
    except AppError as exc:
        if exc.code == "unknown_type":
            # This route's contract keeps 422 validation_error for a bad type id (A3).
            raise AppError("validation_error", exc.message, exc.status, exc.details) from exc
        raise
    return _class_map_out(request, saved)


@router.get("/runs", response_model=RunSummaryPage)
def list_runs(
    handle: ProjectHandle = Depends(get_project),
    source_id: str | None = None,
    limit: int | None = Query(None, ge=1, le=1000),
    cursor: str | None = None,
) -> RunSummaryPage:
    items, next_cursor = runs.list_runs(handle, source_id, limit, cursor)
    return RunSummaryPage(items=items, next_cursor=next_cursor)


@router.post("/runs", response_model=RunCreated, status_code=202)
def create_runs(
    body: RunCreate, request: Request, handle: ProjectHandle = Depends(get_project)
) -> RunCreated:
    state = request.app.state
    # A cloud-provider run never touches the catalogue: resolve it only when a local library model
    # needs mapping, so a cloud run never fails on an unavailable catalogue (foundation plan BM A11).
    catalogue = catalogue_of(state) if body.model_id else NO_CATALOGUE
    created, added = runs.create_runs(
        handle,
        getattr(state, "library", None),
        catalogue,
        state.keys,
        state.provider_config,
        body,
        lambda job_type, params: state.jobs.submit(handle, job_type, params),
    )
    return RunCreated(
        runs=[
            RunCreatedItem(
                run_id=run_id, source_id=t.source_id, kind=t.kind, job=JobOut.from_row(job, handle.id)
            )
            for t, run_id, job in created
        ],
        added_type_ids=added,
    )


@router.patch("/runs/{runId}", response_model=RunSummary)
def update_run(runId: str, body: RunPatch, handle: ProjectHandle = Depends(get_project)) -> RunSummary:  # noqa: N803
    return runs.set_pinned(handle, runId, body.pinned)


@router.post("/runs/{runId}/recount", response_model=JobRef, status_code=202)
def recount_run(runId: str, request: Request, handle: ProjectHandle = Depends(get_project)) -> JobRef:  # noqa: N803
    runs.run_kind(handle, runId)  # 404 before a job is queued
    job = request.app.state.jobs.submit(handle, "recount", {"run_id": runId})
    return JobRef(job=JobOut.from_row(job, handle.id))
