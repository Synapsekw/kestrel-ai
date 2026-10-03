"""`GET` and `PUT /images/{imageId}/review`: a photo's review status (asset findings spec §8)."""

from fastapi import APIRouter, Depends, Request

from app.asset_review import review_status
from app.asset_review.review_status import ImageReviewIn, ImageReviewOut
from app.events_util import publish_image_ids_event
from app.projects.service import ProjectHandle, get_project

router = APIRouter(prefix="/projects/{projectId}", tags=["assetreview"])


@router.get("/images/{imageId}/review", response_model=ImageReviewOut)
def get_image_review(imageId: str, handle: ProjectHandle = Depends(get_project)) -> ImageReviewOut:  # noqa: N803
    with handle.session() as s:
        return review_status.get_review(s, imageId)


@router.put("/images/{imageId}/review", response_model=ImageReviewOut)
def put_image_review(
    imageId: str,  # noqa: N803
    body: ImageReviewIn,
    request: Request,
    handle: ProjectHandle = Depends(get_project),
) -> ImageReviewOut:
    with handle.session() as s:
        row = review_status.set_status(s, imageId, body.status, body.note)
        out = ImageReviewOut.model_validate(row, from_attributes=True)
    publish_image_ids_event(request, handle, "images.changed", [imageId])
    if body.status == "none":  # marking empty may have rejected pending proposals
        publish_image_ids_event(request, handle, "boxes.changed", [imageId])
    return out
