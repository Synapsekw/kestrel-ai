"""ImageDetail and the camera-metadata refresh (spec 2026-09-26-image-inspection §14; unit I-BK).
`getImage`/`updateImage` moved here from `datasets/router.py`."""

from fastapi import APIRouter, Depends, Request

from app.datasets import empties, images
from app.db.models import Image
from app.errors import not_found
from app.events_util import publish_image_ids_event
from app.imagery import jobs_metadata  # also registers the image_metadata job type
from app.imagery.camera_schemas import ImageDetail, ImageUpdate
from app.jobs.schemas import JobOut
from app.projects.service import ProjectHandle, get_project
from app.training.schemas import JobRef

router = APIRouter(prefix="/projects/{projectId}", tags=["images"])


def _detail(handle: ProjectHandle, image_id: str) -> ImageDetail:
    return ImageDetail.from_row(*images.get_image(handle, image_id))


@router.post("/images/metadata-refresh", response_model=JobRef, status_code=202)
def refresh_image_metadata(request: Request, handle: ProjectHandle = Depends(get_project)) -> JobRef:
    job = jobs_metadata.submit(handle, request.app.state.jobs, force=True)  # 409 job_running while live
    return JobRef(job=JobOut.from_row(job, handle.id))


@router.get("/images/{imageId}", response_model=ImageDetail)
def get_image(imageId: str, handle: ProjectHandle = Depends(get_project)) -> ImageDetail:  # noqa: N803
    return _detail(handle, imageId)


@router.patch("/images/{imageId}", response_model=ImageDetail)
def update_image(
    imageId: str,  # noqa: N803
    body: ImageUpdate,
    request: Request,
    handle: ProjectHandle = Depends(get_project),
) -> ImageDetail:
    sent = body.model_fields_set
    rejected_ids: list[str] = []
    # marked_empty first (it can 409 on ground truth), so a failed request saves nothing.
    if "marked_empty" in sent:
        _, rejected_ids = empties.set_marked_empty(handle, imageId, body.marked_empty)
    if "subject_distance_m" in sent:
        with handle.session() as s:
            image = s.get(Image, imageId)
            if image is None:
                raise not_found("image", imageId)
            image.subject_distance_m = body.subject_distance_m
    detail = _detail(handle, imageId)
    publish_image_ids_event(request, handle, "images.changed", [imageId])
    publish_image_ids_event(request, handle, "boxes.changed", rejected_ids)
    return detail
