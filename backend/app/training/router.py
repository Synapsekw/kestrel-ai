"""Model registry and training endpoints (spec section 7)."""

from typing import Literal

from fastapi import APIRouter, Depends, Query, Request, Response
from fastapi.responses import FileResponse

from app.errors import not_found
from app.jobs.schemas import JobOut
from app.projects.service import ProjectHandle, get_project
from app.training import registry
from app.training.jobs import check_materialised  # importing it registers the train and export job types
from app.training.schemas import (
    ExportRequest,
    JobRef,
    ModelImport,
    ModelOut,
    ModelPage,
    TrainRequest,
)

router = APIRouter(prefix="/projects/{projectId}/models", tags=["models"])


@router.get("", response_model=ModelPage)
def list_models(
    handle: ProjectHandle = Depends(get_project),
    limit: int | None = Query(None, ge=1, le=1000),
    cursor: str | None = None,
) -> ModelPage:
    rows, next_cursor = registry.list_models(handle, limit, cursor)
    return ModelPage(items=[ModelOut.from_row(r) for r in rows], next_cursor=next_cursor)


@router.post("/import", response_model=ModelOut, status_code=201)
def import_model(body: ModelImport, handle: ProjectHandle = Depends(get_project)) -> ModelOut:
    row = registry.import_model(handle, body.name, body.weights_path, body.class_aliases)
    return ModelOut.from_row(row)


@router.post("/train", response_model=JobRef, status_code=202)
def train_model(body: TrainRequest, request: Request, handle: ProjectHandle = Depends(get_project)) -> JobRef:
    registry.get_model(handle, body.base_model_id)  # 404 before the job is queued
    check_materialised(handle, registry.get_dataset(handle, body.dataset_id))
    job = request.app.state.jobs.submit(handle, "train", body.model_dump())
    return JobRef(job=JobOut.from_row(job, handle.id))


@router.get("/{modelId}", response_model=ModelOut)
def get_model(modelId: str, handle: ProjectHandle = Depends(get_project)) -> ModelOut:  # noqa: N803
    return ModelOut.from_row(registry.get_model(handle, modelId))


@router.delete("/{modelId}", status_code=204)
def delete_model(modelId: str, handle: ProjectHandle = Depends(get_project)) -> Response:  # noqa: N803
    registry.delete_model(handle, modelId)
    return Response(status_code=204)


@router.post("/{modelId}/export", response_model=JobRef, status_code=202)
def export_model(
    modelId: str,  # noqa: N803
    body: ExportRequest,
    request: Request,
    handle: ProjectHandle = Depends(get_project),
) -> JobRef:
    model = registry.get_model(handle, modelId)
    params = {"model_id": model.id, **body.model_dump()}
    job = request.app.state.jobs.submit(handle, "export", params)
    return JobRef(job=JobOut.from_row(job, handle.id))


ARTIFACT_MEDIA = {"results_csv": "text/csv", "confusion_matrix": "image/png", "pr_curve": "image/png"}


@router.get("/{modelId}/artifacts/{artifact}")
def get_model_artifact(
    modelId: str,  # noqa: N803
    artifact: Literal["results_csv", "confusion_matrix", "pr_curve"],
    handle: ProjectHandle = Depends(get_project),
) -> FileResponse:
    """Serve a training artifact recorded on the registry row (relative to the project folder)."""
    model = registry.get_model(handle, modelId)
    rel = (model.artifacts or {}).get(artifact)
    path = handle.folder / rel if rel else None
    if path is None or not path.is_file():
        raise not_found("artifact", f"{artifact} of model {modelId}")
    return FileResponse(path, media_type=ARTIFACT_MEDIA[artifact])
