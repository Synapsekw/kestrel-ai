"""Annotations and image length measurements (image inspection spec §8, §9.3). Unit I-BA moves the
kept box routes here from `app/datasets/router.py` and replaces the measurement stubs below."""

from fastapi import APIRouter, Depends, Query

from app.imagery import annotations
from app.imagery.schemas import (
    BoxCreate,
    BoxList,
    BoxOut,
    BoxReview,
    BoxReviewResult,
    BoxUpdate,
    BoxWriteResult,
)
from app.projects.service import ProjectHandle, get_project
from app.stubs import add_stubs

router = APIRouter(prefix="/projects/{projectId}", tags=["images"])

STUBS: list[tuple[str, str, str]] = [
    ("GET", "/images/{imageId}/measurements", "listImageMeasurements"),
    ("POST", "/images/{imageId}/measurements", "createImageMeasurement"),
    ("DELETE", "/image-measurements/{imageMeasurementId}", "deleteImageMeasurement"),
]

add_stubs(router, STUBS)


@router.get("/images/{imageId}/boxes", response_model=BoxList)
def list_boxes(imageId: str, handle: ProjectHandle = Depends(get_project)) -> BoxList:  # noqa: N803
    return BoxList(items=[BoxOut.from_row(b) for b in annotations.list_boxes(handle, imageId)])


@router.post("/images/{imageId}/boxes", response_model=BoxWriteResult, status_code=201)
def create_box(
    imageId: str,  # noqa: N803
    body: BoxCreate,
    handle: ProjectHandle = Depends(get_project),
) -> BoxWriteResult:
    w = annotations.create_box(
        handle,
        imageId,
        body.class_id,
        body.x,
        body.y,
        body.w,
        body.h,
        body.angle,
        shape=body.shape,
        points=body.points,
        assist=body.assist,
    )
    return BoxWriteResult.from_written(w)


@router.patch("/boxes/{boxId}", response_model=BoxWriteResult)
def update_box(
    boxId: str,  # noqa: N803
    body: BoxUpdate,
    confirm_finding_delete: bool = Query(False),
    handle: ProjectHandle = Depends(get_project),
) -> BoxWriteResult:
    w = annotations.update_box(
        handle, boxId, confirm_finding_delete=confirm_finding_delete, **body.model_dump(exclude_unset=True)
    )
    return BoxWriteResult.from_written(w)


@router.delete("/boxes/{boxId}", status_code=204)
def delete_box(boxId: str, handle: ProjectHandle = Depends(get_project)) -> None:  # noqa: N803
    annotations.delete_box(handle, boxId)


@router.post("/boxes/review", response_model=BoxReviewResult)
def review_boxes(body: BoxReview, handle: ProjectHandle = Depends(get_project)) -> BoxReviewResult:
    return BoxReviewResult(updated=annotations.review_boxes(handle, body.box_ids, body.action))
