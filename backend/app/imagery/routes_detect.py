"""Interactive and batch detection (image inspection spec §11.2, §11.3). Unit I-BP replaces the
stubs below (and may delete the deprecated preannotate route in `app/inference/router.py`)."""

from fastapi import APIRouter, Depends, Request

from app.events_util import publish_image_ids_event
from app.imagery import detect
from app.imagery.detect_schemas import DetectRequest, DetectResult
from app.library.catalogue_port import catalogue_of
from app.projects.service import ProjectHandle, get_project
from app.stubs import add_stubs

router = APIRouter(prefix="/projects/{projectId}", tags=["image-detect"])

STUBS: list[tuple[str, str, str]] = [
    ("POST", "/images/detect-batch", "detectImageBatch"),
]

add_stubs(router, STUBS)


@router.post("/images/{imageId}/detect", response_model=DetectResult)
def detect_image(
    imageId: str,  # noqa: N803
    body: DetectRequest,
    request: Request,
    handle: ProjectHandle = Depends(get_project),
) -> DetectResult:
    """Synchronous by design (spec §11.2): one frame, at most 64 tiles, a 2 s GPU wait then CPU.

    A sync endpoint runs in FastAPI's threadpool, so it blocks one worker and no more.
    """
    state = request.app.state
    out = detect.detect_one(
        handle,
        getattr(state, "library", None),
        catalogue_of(state),
        imageId,
        model_id=body.model_id,
        conf=body.conf,
        imgsz=body.imgsz,
    )
    publish_image_ids_event(request, handle, "boxes.changed", [imageId])
    return DetectResult.from_outcome(out)
