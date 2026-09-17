from fastapi import APIRouter, Depends

from app.auth import require_token
from app.datasets.router import router as datasets_router
from app.health import router as health_router
from app.inference.router import router as inference_router
from app.jobs.router import router as jobs_router
from app.projects.router import router as projects_router
from app.providers.router import router as providers_router
from app.training.router import router as training_router

api_router = APIRouter(prefix="/api/v1", dependencies=[Depends(require_token)])
for r in (
    health_router,
    projects_router,
    jobs_router,
    datasets_router,
    training_router,
    providers_router,
    inference_router,
):
    api_router.include_router(r)
