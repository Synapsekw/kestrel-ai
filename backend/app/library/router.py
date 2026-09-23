"""The app-wide model library (`/library/*`) and training into it (`/projects/{id}/train`)."""

from pathlib import Path
from typing import Literal

from fastapi import APIRouter, Body, Depends, Query, Request, Response
from fastapi.responses import FileResponse

from app.errors import AppError, not_found
from app.jobs import router as jobs_router
from app.jobs.schemas import JobLog, JobOut, JobPage
from app.library import jobs as library_jobs  # noqa: F401 - the import registers the library job types
from app.library import service
from app.library.handle import LibraryHandle, get_library
from app.library.paths import library_root
from app.library.schemas import (
    LibraryModelImport,
    LibraryModelOut,
    LibraryModelPage,
    LibraryModelPatch,
    LibraryStatus,
    ModelUsage,
    StarterAcquire,
)
from app.projects.service import ProjectHandle, get_project
from app.training import (
    starter,
    starter_download,  # noqa: F401 - the import registers the library_starter job type
)
from app.training.jobs import check_materialised, get_dataset  # the import registers the train job type
from app.training.schemas import ExportRequest, JobRef, TrainRequest

router = APIRouter(prefix="/library", tags=["library"])
project_router = APIRouter(prefix="/projects/{projectId}", tags=["library"])

ARTIFACT_MEDIA = {"results_csv": "text/csv", "confusion_matrix": "image/png", "pr_curve": "image/png"}


def _out(lib: LibraryHandle, row) -> LibraryModelOut:
    return LibraryModelOut.from_row(row, service.state_of(lib, row))


@router.get("/status", response_model=LibraryStatus)
def library_status(request: Request) -> LibraryStatus:
    lib = getattr(request.app.state, "library", None)
    root = lib.folder if lib is not None else library_root(request.app.state.settings.data_dir)
    error = None if lib is not None else getattr(request.app.state, "library_error", None) or "not opened"
    return LibraryStatus(available=lib is not None, root=str(root), error=error)


@router.get("/models", response_model=LibraryModelPage)
def list_models(
    lib: LibraryHandle = Depends(get_library),
    task: Literal["detect", "obb"] | None = None,
    limit: int | None = Query(None, ge=1, le=1000),
    cursor: str | None = None,
) -> LibraryModelPage:
    rows, next_cursor = service.list_models(lib, limit, cursor, task)
    return LibraryModelPage(items=[_out(lib, r) for r in rows], next_cursor=next_cursor)


@router.post("/models/import", response_model=JobRef, status_code=202)
def import_model(
    body: LibraryModelImport, request: Request, lib: LibraryHandle = Depends(get_library)
) -> JobRef:
    source = Path(body.weights_path)
    # An empty weights_path is a 422 from the schema (`minLength: 1`). Anything else that is
    # schema-valid but unusable answers 404: the contract's conformance gate (schemathesis
    # positive_data_acceptance) rejects a 422 on a schema-compliant body, and no schema can express
    # "this file exists".
    if not source.is_absolute() or source.suffix.lower() != ".pt" or not source.is_file():
        raise AppError(
            "not_found",
            f"no usable weights at {body.weights_path}: an absolute path to an existing .pt file is required",
            404,
        )
    job = request.app.state.jobs.submit(lib, "library_import", body.model_dump())
    return JobRef(job=JobOut.from_row(job, lib.id))


@router.get("/models/{modelId}", response_model=LibraryModelOut)
def get_model(modelId: str, lib: LibraryHandle = Depends(get_library)) -> LibraryModelOut:  # noqa: N803
    return _out(lib, service.get_model(lib, modelId))


@router.patch("/models/{modelId}", response_model=LibraryModelOut)
def update_model(
    modelId: str,  # noqa: N803
    body: LibraryModelPatch,
    lib: LibraryHandle = Depends(get_library),
) -> LibraryModelOut:
    fields = {k: getattr(body, k) for k in body.model_fields_set}
    if fields.get("name", "") is None:  # `name` is not nullable in the contract: null means "leave it"
        del fields["name"]
    if fields.get("notes", "") is None:
        fields["notes"] = ""
    if fields.get("class_aliases", {}) is None:
        fields["class_aliases"] = {}
    return _out(lib, service.update_model(lib, modelId, **fields))


@router.delete("/models/{modelId}", status_code=204)
def delete_model(modelId: str, lib: LibraryHandle = Depends(get_library)) -> Response:  # noqa: N803
    service.delete_model(lib, modelId)
    return Response(status_code=204)


@router.get("/models/{modelId}/usage", response_model=ModelUsage)
def model_usage(modelId: str, request: Request, lib: LibraryHandle = Depends(get_library)) -> ModelUsage:  # noqa: N803
    return ModelUsage(projects=service.usage(lib, request.app.state.projects, modelId))


@router.get("/models/{modelId}/artifacts/{artifact}")
def get_model_artifact(
    modelId: str,  # noqa: N803
    artifact: Literal["results_csv", "confusion_matrix", "pr_curve"],
    lib: LibraryHandle = Depends(get_library),
) -> FileResponse:
    model = service.get_model(lib, modelId)
    rel = (model.artifacts or {}).get(artifact)
    path = service.model_dir(lib, model) / rel if rel else None
    if path is None or not path.is_file():
        raise not_found("artifact", f"{artifact} of model {modelId}")
    return FileResponse(path, media_type=ARTIFACT_MEDIA[artifact])


@router.post("/models/{modelId}/export", response_model=JobRef, status_code=202)
def export_model(
    modelId: str,  # noqa: N803
    body: ExportRequest,
    request: Request,
    lib: LibraryHandle = Depends(get_library),
) -> JobRef:
    model = service.get_model(lib, modelId)
    job = request.app.state.jobs.submit(lib, "library_export", {"model_id": model.id, **body.model_dump()})
    return JobRef(job=JobOut.from_row(job, lib.id))


@router.post("/starters/{key}/acquire", response_model=JobRef, status_code=202)
def acquire_starter(
    key: str,
    request: Request,
    lib: LibraryHandle = Depends(get_library),
    body: StarterAcquire | None = Body(None),
) -> JobRef:
    """Bundled or cached weights are reused; otherwise the job downloads them, then adds them."""
    if key not in starter.STARTER_KEYS:
        raise not_found("starter model", key)
    settings = request.app.state.settings
    params = {
        "key": key,
        "name": body.name if body is not None else None,
        "bundle_dir": str(starter.weights_dir(settings)),
        "cache_dir": str(settings.data_dir / "starter_weights"),
    }
    job = request.app.state.jobs.submit(lib, "library_starter", params)
    return JobRef(job=JobOut.from_row(job, lib.id))


# ---------------------------------------------------------------- library jobs
# The project job endpoints, pointed at the library handle: same rows, same pagination, same log.


@router.get("/jobs", response_model=JobPage)
def list_library_jobs(
    request: Request,
    lib: LibraryHandle = Depends(get_library),
    state: str | None = None,
    type: str | None = None,
    limit: int | None = Query(None, ge=1, le=1000),
    cursor: str | None = None,
) -> JobPage:
    return jobs_router.list_jobs(request, lib, state, type, limit, cursor)


@router.get("/jobs/{jobId}", response_model=JobOut)
def get_library_job(jobId: str, request: Request, lib: LibraryHandle = Depends(get_library)) -> JobOut:  # noqa: N803
    return jobs_router.get_job(jobId, request, lib)


@router.post("/jobs/{jobId}/cancel", response_model=JobOut)
def cancel_library_job(jobId: str, request: Request, lib: LibraryHandle = Depends(get_library)) -> JobOut:  # noqa: N803
    return jobs_router.cancel_job(jobId, request, lib)


@router.get("/jobs/{jobId}/log", response_model=JobLog)
def library_job_log(
    jobId: str,  # noqa: N803
    request: Request,
    lib: LibraryHandle = Depends(get_library),
    tail: int = Query(200, ge=1, le=10000),
) -> JobLog:
    return jobs_router.job_log(jobId, request, lib, tail)


# ------------------------------------------------------------------- training


@project_router.post("/train", response_model=JobRef, status_code=202)
def train_model(
    body: TrainRequest,
    request: Request,
    handle: ProjectHandle = Depends(get_project),
    lib: LibraryHandle = Depends(get_library),
) -> JobRef:
    """Train in this project; the finished weights are registered in the library."""
    service.require_ready(lib, body.base_model_id)  # 404 unknown, 409 unavailable, before queueing
    check_materialised(handle, get_dataset(handle, body.dataset_id))
    job = request.app.state.jobs.submit(handle, "train", body.model_dump())
    return JobRef(job=JobOut.from_row(job, handle.id))
