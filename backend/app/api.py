import logging

from fastapi import APIRouter, Depends

from app.agent.router import router as agent_router
from app.auth import require_token
from app.datasets.router import router as datasets_router
from app.exports.router import router as exports_router
from app.health import router as health_router
from app.inference.router import router as inference_router
from app.jobs.router import router as jobs_router
from app.project_agent.router import router as project_agent_router
from app.projects.router import router as projects_router
from app.providers.router import router as providers_router
from app.training.router import router as training_router
from app.training.starter_router import project_router as starter_project_router
from app.training.starter_router import router as starter_router

log = logging.getLogger(__name__)

api_router = APIRouter(prefix="/api/v1", dependencies=[Depends(require_token)])
for r in (
    agent_router,
    health_router,
    projects_router,
    jobs_router,
    datasets_router,
    training_router,
    starter_router,
    starter_project_router,
    providers_router,
    inference_router,
    exports_router,
    project_agent_router,
):
    api_router.include_router(r)

# The maps router's import chain pulls in `rasterio` at module scope (router -> service/tiles ->
# raster, the job modules). A broken GDAL in the frozen bundle must not stop the whole backend from
# starting (AGENTS.md: "the app must start even when startup work fails") - so this import is
# guarded the same way the other heavy native deps are kept out of module scope elsewhere
# (`providers/local_yolo.py`, `training/registry.py`). On failure the map endpoints simply 404
# instead of existing, and the rest of the app works normally.
try:
    from app.maps.router import router as maps_router

    api_router.include_router(maps_router)
except Exception:
    log.exception("maps router failed to load; map endpoints will be unavailable")
