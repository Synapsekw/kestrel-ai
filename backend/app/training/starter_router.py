"""Detection starter catalogue, legacy local import, and background acquisition."""

from fastapi import APIRouter, Depends, Request

from app.jobs.schemas import JobOut
from app.projects.service import ProjectHandle, get_project
from app.training import starter
from app.training.schemas import JobRef, ModelOut, StarterModelImport, StarterModelOut, StarterModelPage

router = APIRouter(tags=["models"])


@router.get("/starter-models", response_model=StarterModelPage)
def list_starter_models(request: Request) -> StarterModelPage:
    folder = starter.weights_dir(request.app.state.settings)
    items = [
        StarterModelOut(**item)
        for item in starter.list_starters(folder, request.app.state.settings.data_dir / "starter_weights")
    ]
    return StarterModelPage(items=items, next_cursor=None)


project_router = APIRouter(prefix="/projects/{projectId}/models", tags=["models"])


@project_router.post("/import-starter", response_model=ModelOut, status_code=201)
def import_starter_model(
    body: StarterModelImport, request: Request, handle: ProjectHandle = Depends(get_project)
) -> ModelOut:
    folder = starter.weights_dir(request.app.state.settings)
    row = starter.import_starter(handle, folder, body.key, body.name)
    return ModelOut.from_row(row)


@project_router.post("/acquire-starter", response_model=JobRef, status_code=202)
def acquire_starter_model(
    body: StarterModelImport, request: Request, handle: ProjectHandle = Depends(get_project)
) -> JobRef:
    settings = request.app.state.settings
    params = {
        **body.model_dump(),
        "purpose": "starter_model",
        "bundle_dir": str(starter.weights_dir(settings)),
        "cache_dir": str(settings.data_dir / "starter_weights"),
    }
    job = request.app.state.jobs.submit(handle, "import", params)
    return JobRef(job=JobOut.from_row(job, handle.id))
