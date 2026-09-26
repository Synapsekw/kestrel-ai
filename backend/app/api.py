import importlib
import logging

from fastapi import APIRouter, Depends

from app.agent.router import router as agent_router
from app.auth import require_token
from app.data_items.router import router as data_router
from app.datasets.router import router as datasets_router
from app.exports.router import router as exports_router
from app.foundation_stubs import app_router as foundation_app_stubs
from app.foundation_stubs import project_router as foundation_project_stubs
from app.health import router as health_router
from app.inference.router import router as inference_router
from app.jobs.router import router as jobs_router
from app.library.adoption_router import router as adoption_router
from app.library.router import project_router as train_router
from app.library.router import router as library_router
from app.project_agent.router import router as project_agent_router
from app.projects.router import router as projects_router
from app.providers.router import router as providers_router
from app.training.starter_router import router as starter_router

log = logging.getLogger(__name__)

api_router = APIRouter(prefix="/api/v1", dependencies=[Depends(require_token)])
# A project has no kind (spec 2026-09-26-foundation section 6.1): every project may do everything,
# so every router is included plainly.
for r in (
    agent_router,
    health_router,
    projects_router,
    data_router,
    library_router,
    datasets_router,
    starter_router,
    providers_router,
    inference_router,
    project_agent_router,
    jobs_router,
    exports_router,
    train_router,
    adoption_router,
):
    api_router.include_router(r)

# Detection runs and class mapping (plan 2 unit R). Its jobs (`infer`, `map_detect`) import
# rasterio, so it is guarded like the maps router below.
try:
    from app.detect.router import router as detect_router

    api_router.include_router(detect_router)
except Exception:
    log.exception("detect router failed to load; run endpoints will be unavailable")

# The maps router's import chain pulls in `rasterio` at module scope (router -> service/tiles ->
# raster, the job modules). A broken GDAL in the frozen bundle must not stop the whole backend from
# starting (AGENTS.md: "the app must start even when startup work fails") - so this import is
# guarded the same way the other heavy native deps are kept out of module scope elsewhere
# (`providers/local_yolo.py`, `library/service.py`). On failure the map endpoints simply 404
# instead of existing, and the rest of the app works normally.
try:
    from app.maps.router import router as maps_router

    api_router.include_router(maps_router)
except Exception:
    log.exception("maps router failed to load; map endpoints will be unavailable")

# Site areas and analytics (plan 2 unit A). Guarded like the maps router: the site-area geometry
# needs pyproj, and a broken native dependency must not stop the backend.
try:
    from app.detect.analytics_router import router as detect_analytics_router

    api_router.include_router(detect_analytics_router)
except Exception:
    log.exception("site-area and analytics router failed to load; those endpoints will be unavailable")

# Detection exports, CSV and PDF (plan 2 unit E). Guarded like analytics, which it reads; reportlab
# itself is imported only inside the job, when a PDF is asked for.
try:
    from app.detect.export_router import router as detect_export_router

    api_router.include_router(detect_export_router)
except Exception:
    log.exception("detection export router failed to load; detection exports will be unavailable")

# Reviewing detection runs (plan 2 unit V). It serves map runs and imports the map schemas, so it
# goes with the maps router: a broken native stack costs the review endpoints, never the app.
try:
    if "maps_router" not in globals():
        raise ImportError("the maps router did not load")
    from app.detect.review_router import router as review_router

    api_router.include_router(review_router)
except Exception:
    log.exception("review router failed to load; review endpoints will be unavailable")

# Point clouds, surfaces, volumes and design surfaces (foundation F0 of the 2026-09-23 point-cloud,
# volumes and design-surface specs). Guarded like the maps router: laspy, scipy and rasterio are
# native stacks, and a broken one must cost only its own endpoints, never the app.
for _module in (
    "app.pointclouds.router",
    "app.surfaces.router",
    "app.surfaces.design.router",
    "app.volumes.router",
):
    try:
        api_router.include_router(importlib.import_module(_module).router)
    except Exception:
        log.exception("%s failed to load; its endpoints will be unavailable", _module)

# The foundation's new operations (spec 2026-09-26-foundation-design section 13) answer 501 until
# their unit lands; each unit deletes its tuples from app/foundation_stubs.py. Any kind of project
# reaches them: unit BK removes the kind guard from every router, these included.
api_router.include_router(foundation_project_stubs)
api_router.include_router(foundation_app_stubs)
