import logging

from fastapi import APIRouter, Depends

from app.agent.router import router as agent_router
from app.auth import require_token
from app.datasets.router import router as datasets_router
from app.exports.router import router as exports_router
from app.health import router as health_router
from app.inference.router import router as inference_router
from app.jobs.router import router as jobs_router
from app.library.adoption_router import router as adoption_router
from app.library.router import project_router as train_router
from app.library.router import router as library_router
from app.project_agent.router import router as project_agent_router
from app.projects.kinds import ANY_KIND, require_kind
from app.projects.router import router as projects_router
from app.providers.router import router as providers_router
from app.stubs import add_stubs
from app.training.starter_router import router as starter_router

log = logging.getLogger(__name__)

api_router = APIRouter(prefix="/api/v1", dependencies=[Depends(require_token)])
for r in (
    agent_router,
    health_router,
    projects_router,
    library_router,
    datasets_router,
    starter_router,
    providers_router,
    inference_router,
    project_agent_router,
):
    api_router.include_router(r)

# Project routers that serve both kinds of project and declare no kind in their own module.
# Every route under /projects/{projectId} must declare its kinds (spec 2026-09-23 section 5.2);
# tests/test_project_kinds.py walks the routes and fails on one that does not.
for r in (jobs_router, exports_router):
    api_router.include_router(r, dependencies=[Depends(require_kind(ANY_KIND))])

# Training writes into a train project's dataset and weights: a detect project has none.
api_router.include_router(train_router, dependencies=[Depends(require_kind(("train",)))])

# Moving a training project's old models into the library: training projects only.
api_router.include_router(adoption_router, dependencies=[Depends(require_kind(("train",)))])

# The maps router's import chain pulls in `rasterio` at module scope (router -> service/tiles ->
# raster, the job modules). A broken GDAL in the frozen bundle must not stop the whole backend from
# starting (AGENTS.md: "the app must start even when startup work fails") - so this import is
# guarded the same way the other heavy native deps are kept out of module scope elsewhere
# (`providers/local_yolo.py`, `library/service.py`). On failure the map endpoints simply 404
# instead of existing, and the rest of the app works normally.
try:
    from app.maps.router import router as maps_router

    api_router.include_router(maps_router)
    # A map endpoint like the rest: it is dropped with them when the maps router cannot load.
    _move_stub = APIRouter(prefix="/projects/{projectId}", tags=["maps"])
    add_stubs(_move_stub, [("POST", "/maps/{mapId}/move", "moveMapToProject")])
    api_router.include_router(_move_stub, dependencies=[Depends(require_kind(("train",)))])
except Exception:
    log.exception("maps router failed to load; map endpoints will be unavailable")
