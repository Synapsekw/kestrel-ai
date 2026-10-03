import importlib
import logging

from fastapi import APIRouter, Depends

from app.agent.router import router as agent_router
from app.auth import require_token
from app.basemap.router import router as basemap_router
from app.catalogue.project_router import router as project_types_router
from app.catalogue.router import router as catalogue_router
from app.data_items.router import router as data_router
from app.data_items.search import router as search_router
from app.datasets.router import router as datasets_router
from app.exports.router import router as exports_router
from app.findings.operator_router import router as operator_router
from app.findings.router import router as findings_router
from app.health import router as health_router
from app.inference.router import router as inference_router
from app.jobs.app_router import router as app_jobs_router
from app.jobs.router import router as jobs_router
from app.library.adoption_router import router as adoption_router
from app.library.router import router as library_router
from app.migration.router import router as migration_router
from app.overview.router import router as overview_router
from app.project_agent.router import router as project_agent_router
from app.projects.router import router as projects_router
from app.providers.router import router as providers_router
from app.training.starter_router import router as starter_router

log = logging.getLogger(__name__)

api_router = APIRouter(prefix="/api/v1", dependencies=[Depends(require_token)])

# Images and smart polygon (plan 2026-09-27-images-c0). Included before `datasets_router`, so
# `/images/index` and `/images/metadata-refresh` never reach `/images/{imageId}`. Guarded: a module
# that fails to import (SAM's native stack, say) costs its own endpoints, never the app.
for _module in ("app.imagery.router", "app.assist.router"):
    try:
        api_router.include_router(importlib.import_module(_module).router)
    except Exception:
        log.exception("%s failed to load; its endpoints will be unavailable", _module)

# A project has no kind (spec 2026-09-26-foundation section 6.1): every project may do everything,
# so every router is included plainly.
for r in (
    agent_router,
    basemap_router,
    catalogue_router,
    health_router,
    # Before projects_router: `/projects/migrations/...` must not reach `/projects/{projectId}`.
    # This import also registers the `project_migrate` job type in the running app.
    migration_router,
    projects_router,
    project_types_router,
    data_router,
    search_router,
    findings_router,
    operator_router,
    overview_router,
    library_router,
    datasets_router,
    starter_router,
    providers_router,
    inference_router,
    project_agent_router,
    jobs_router,
    app_jobs_router,
    exports_router,
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

# Reports (spec 2026-09-26-reports section 14, unit R0). Guarded like the detect-export router: a
# broken import (reportlab, fonts, a renderer) costs the report endpoints, never the app. reportlab
# and openpyxl are imported only inside the render job.
try:
    from app.reports.router import router as reports_router

    api_router.include_router(reports_router)
except Exception:
    log.exception("reports router failed to load; report endpoints will be unavailable")

# Project setup (spec 2026-09-30-project-setup section 9, unit S1-U1): project templates and the
# drop-folder inspect job. Guarded like Reports: the inspect job reads headers with rasterio and
# laspy (U3), and a broken import costs the setup endpoints, never the app; the new-project page
# then offers Blank only and still creates the project.
try:
    from app.setup.router import router as setup_router

    api_router.include_router(setup_router)
except Exception:
    log.exception("setup router failed to load; setup endpoints will be unavailable")

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
    "app.asset_models.router",  # asset models (spec 2026-10-02); trimesh is native
    "app.asset_models.runs",  # asset models (spec 2026-10-02); trimesh is native
    # Plant model (spec 2026-10-03-plant-model-generator §10, plan pm-f0): the live catalogue, then the
    # 501 stubs until A1 and R1 land. A unit deletes its tuples in app/asset_models/stubs_plant.py.
    "app.asset_models.catalogue_router",
    "app.asset_models.items",  # plant model A1: items list, item, register CSV
    "app.asset_models.stubs_plant",
    # Asset findings (spec 2026-10-02-asset-findings §8, plan af-c0): 501 stubs until each unit lands.
    # A unit inserts its own router module above its stubs module and deletes its tuples there.
    "app.asset_review.review_router",
    "app.asset_review.stubs",
    "app.brands.stubs",
):
    try:
        api_router.include_router(importlib.import_module(_module).router)
    except Exception:
        log.exception("%s failed to load; its endpoints will be unavailable", _module)

# The map workspace (spec 2026-09-26-map-workspace §12, unit M-C0). It shares the maps stack
# (rasterio, pyproj), so it loads only when the maps router did, like the review router above: a
# broken GDAL costs these endpoints, never the app, and no "map" path is left half-served
# (tests/test_api_maps_guard.py). Each M unit inserts one line, its router module, before
# "app.workspace.stubs" and deletes its tuples from app/workspace/stubs.py.
for _module in (
    # Plant model I1's 501 stubs, before app.drawings.router so that GET /drawings/unimported never
    # reaches /drawings/{drawingId}. I1 deletes this line when it routes the real operations.
    "app.asset_models.stubs_plant:drawings_router",
    # each M unit inserts its router module on its own line above this one
    "app.drawings.router",
    "app.mapmeasure.router",
    "app.measurements.union",
    "app.asset_models.site_scene",  # plant model S1: the Site 3D manifest (needs the workspace frame)
    "app.workspace.router",
    "app.workspace.stubs",
):
    try:
        if "maps_router" not in globals():
            raise ImportError("the maps router did not load")
        _path, _, _attr = _module.partition(":")
        api_router.include_router(getattr(importlib.import_module(_path), _attr or "router"))
    except Exception:
        log.exception("%s failed to load; its endpoints will be unavailable", _module)
