"""Annotations and image length measurements (image inspection spec §8, §9.3). Unit I-BA moves the
kept box routes here from `app/datasets/router.py` and replaces the measurement stubs below."""

from fastapi import APIRouter, Depends, Query

from app.imagery import annotations, measurements
from app.imagery.schemas import (
    BoxCreate,
    BoxList,
    BoxOut,
    BoxReview,
    BoxReviewResult,
    BoxUpdate,
    BoxWriteResult,
    ImageMeasurementCreate,
    ImageMeasurementList,
    ImageMeasurementOut,
)
from app.projects.service import ProjectHandle, get_project

router = APIRouter(prefix="/projects/{projectId}", tags=["images"])


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
    out = annotations.review_boxes(handle, body.box_ids, body.action)
    return BoxReviewResult(
        updated=out.changed,
        finding_ids_created=out.finding_ids_created,
        finding_ids_deleted=out.finding_ids_deleted,
    )


@router.get("/images/{imageId}/measurements", response_model=ImageMeasurementList)
def list_image_measurements(  # noqa: N803
    imageId: str, handle: ProjectHandle = Depends(get_project)
) -> ImageMeasurementList:
    rows, scale = measurements.list_measurements(handle, imageId)
    return ImageMeasurementList(items=[ImageMeasurementOut.from_row(m, scale) for m in rows])


@router.post("/images/{imageId}/measurements", response_model=ImageMeasurementOut, status_code=201)
def create_image_measurement(
    imageId: str,  # noqa: N803
    body: ImageMeasurementCreate,
    handle: ProjectHandle = Depends(get_project),
) -> ImageMeasurementOut:
    row, scale = measurements.create_measurement(
        handle, imageId, body.x1, body.y1, body.x2, body.y2, body.label
    )
    return ImageMeasurementOut.from_row(row, scale)


@router.delete("/image-measurements/{imageMeasurementId}", status_code=204)
def delete_image_measurement(imageMeasurementId: str, handle: ProjectHandle = Depends(get_project)) -> None:  # noqa: N803
    measurements.delete_measurement(handle, imageMeasurementId)
