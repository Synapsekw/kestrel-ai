"""Model registry and training endpoints (spec section 7)."""

from fastapi import APIRouter, Depends, Query, Response

from app.projects.service import ProjectHandle, get_project
from app.stubs import add_stubs
from app.training import registry
from app.training.schemas import ModelImport, ModelOut, ModelPage

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


@router.get("/{modelId}", response_model=ModelOut)
def get_model(modelId: str, handle: ProjectHandle = Depends(get_project)) -> ModelOut:  # noqa: N803
    return ModelOut.from_row(registry.get_model(handle, modelId))


@router.delete("/{modelId}", status_code=204)
def delete_model(modelId: str, handle: ProjectHandle = Depends(get_project)) -> Response:  # noqa: N803
    registry.delete_model(handle, modelId)
    return Response(status_code=204)


add_stubs(router, [("POST", "/train", "models train"), ("POST", "/{modelId}/export", "models export")])
