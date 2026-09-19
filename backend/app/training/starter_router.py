"""Starter weights endpoints (usability gap G1): the fixed catalogue and importing one of them."""

from fastapi import APIRouter, Depends, Request

from app.projects.service import ProjectHandle, get_project
from app.training import starter
from app.training.schemas import ModelOut, StarterModelImport, StarterModelOut, StarterModelPage

router = APIRouter(tags=["models"])


@router.get("/starter-models", response_model=StarterModelPage)
def list_starter_models(request: Request) -> StarterModelPage:
    folder = starter.weights_dir(request.app.state.settings)
    items = [StarterModelOut(**item) for item in starter.list_starters(folder)]
    return StarterModelPage(items=items, next_cursor=None)


project_router = APIRouter(prefix="/projects/{projectId}/models", tags=["models"])


@project_router.post("/import-starter", response_model=ModelOut, status_code=201)
def import_starter_model(
    body: StarterModelImport, request: Request, handle: ProjectHandle = Depends(get_project)
) -> ModelOut:
    folder = starter.weights_dir(request.app.state.settings)
    row = starter.import_starter(handle, folder, body.key, body.name)
    return ModelOut.from_row(row)
