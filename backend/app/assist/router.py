"""Smart polygon (SAM 2.1 tiny): the segment prompts and the assist model catalogue (image
inspection spec §10). I-C0 routes every operation as a 501 stub; unit I-BS replaces them. SAM's
heavy imports (torch, ultralytics) stay inside functions, and `app/api.py` includes this router
under a guard, so a broken stack costs only these endpoints."""

from fastapi import APIRouter

from app.stubs import add_stubs

_project = APIRouter(prefix="/projects/{projectId}", tags=["assist"])
_library = APIRouter(prefix="/library", tags=["assist"])

STUBS: list[tuple[str, str, str]] = [
    ("POST", "/images/{imageId}/segment/prepare", "prepareImageSegment"),
    ("POST", "/images/{imageId}/segment", "segmentImage"),
]
LIBRARY_STUBS: list[tuple[str, str, str]] = [
    ("GET", "/assist-models", "listAssistModels"),
    ("POST", "/assist-models/{key}/acquire", "acquireAssistModel"),
    ("POST", "/assist-models/{key}/import", "importAssistModel"),
]

add_stubs(_project, STUBS)
add_stubs(_library, LIBRARY_STUBS, project_scoped=False)

router = APIRouter()
router.include_router(_project)
router.include_router(_library)
