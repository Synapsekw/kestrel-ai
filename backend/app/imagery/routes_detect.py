"""Interactive and batch detection (image inspection spec §11.2, §11.3)."""

from fastapi import APIRouter, Depends, Request

from app.events_util import publish_image_ids_event
from app.imagery import detect, detect_batch
from app.imagery.detect_schemas import DetectBatchRequest, DetectRequest, DetectResult
from app.inference.jobs import run_infer  # noqa: F401 - the import registers the `infer` job type
from app.inference.schemas import QueryRunOut, QueryRunWithJob
from app.jobs.schemas import JobOut
from app.library.catalogue_port import catalogue_of
from app.projects.service import ProjectHandle, get_project

router = APIRouter(prefix="/projects/{projectId}", tags=["image-detect"])


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


@router.post("/images/detect-batch", response_model=QueryRunWithJob, status_code=202)
def detect_images_batch(
    body: DetectBatchRequest, request: Request, handle: ProjectHandle = Depends(get_project)
) -> QueryRunWithJob:
    """A `QueryRun` over the scope and its queued `infer` job (spec §11.3): resume, cancel and
    progress are the existing run's."""
    state = request.app.state
    run, job = detect_batch.create_batch(
        handle,
        getattr(state, "library", None),
        lambda: catalogue_of(state),
        state.keys,
        state.provider_config,
        body,
        lambda job_type, params: state.jobs.submit(handle, job_type, params),
    )
    return QueryRunWithJob(query_run=QueryRunOut.from_row(run, 0), job=JobOut.from_row(job, handle.id))
