"""Review routes for detection runs (spec 2026-09-23 section 8, plan 2 unit V).

Included in `app/api.py` with `require_kind(("detect",), ANY_KIND)`: every write is detection-only,
and the one read (`next-unreviewed`) also works on a training project's past detections.
"""

from __future__ import annotations

from typing import Literal

from fastapi import APIRouter, Depends, Request
from pydantic import BaseModel, Field, field_validator

from app.detect import review
from app.events_util import publish_volumes_changed
from app.jobs.schemas import JobOut
from app.maps.schemas import MapDetectionOut
from app.projects.service import ProjectHandle, get_project
from app.training.schemas import JobRef
from app.volumes.service import refresh_mask_users

router = APIRouter(prefix="/projects/{projectId}", tags=["detect"])


class MapDetectionReview(BaseModel):
    detection_ids: list[str] = Field(min_length=1)
    action: Literal["accept", "reject", "unreview", "reclass"]
    class_id: str | None = None

    @field_validator("detection_ids")
    @classmethod
    def _unique(cls, v: list[str]) -> list[str]:
        if len(set(v)) != len(v):
            raise ValueError("detection_ids must not repeat")
        return v


class MapDetectionReviewResult(BaseModel):
    updated: int


class MapDetectionCreate(BaseModel):
    class_id: str
    x: float
    y: float
    w: float = Field(gt=0)
    h: float = Field(gt=0)
    angle: float | None = None


class NextUnreviewed(BaseModel):
    detection: MapDetectionOut | None
    remaining: int


class AcceptAbove(BaseModel):
    min_confidence: float = Field(ge=0, le=1)


def _masks_changed(request: Request, handle: ProjectHandle, run_id: str) -> None:
    """A volume measurement masking with this run may no longer match its numbers (volumes spec
    §6.10): turn it stale now and tell the Volumes screen."""
    publish_volumes_changed(request, handle, refresh_mask_users(handle, [run_id]))


@router.post("/map-runs/{runId}/review", response_model=MapDetectionReviewResult)
def review_map_detections(
    runId: str,  # noqa: N803
    body: MapDetectionReview,
    request: Request,
    handle: ProjectHandle = Depends(get_project),
) -> MapDetectionReviewResult:
    updated = review.review_map_detections(handle, runId, body.detection_ids, body.action, body.class_id)
    if updated:
        _masks_changed(request, handle, runId)
    return MapDetectionReviewResult(updated=updated)


@router.post("/map-runs/{runId}/detections", response_model=MapDetectionOut, status_code=201)
def add_map_detection(
    runId: str,  # noqa: N803
    body: MapDetectionCreate,
    request: Request,
    handle: ProjectHandle = Depends(get_project),
) -> MapDetectionOut:
    row = review.add_map_detection(handle, runId, body.class_id, body.x, body.y, body.w, body.h, body.angle)
    _masks_changed(request, handle, runId)
    return MapDetectionOut.from_row(row)


@router.get("/map-runs/{runId}/next-unreviewed", response_model=NextUnreviewed)
def next_unreviewed(
    runId: str,  # noqa: N803
    after_id: str | None = None,
    handle: ProjectHandle = Depends(get_project),
) -> NextUnreviewed:
    row, remaining = review.next_unreviewed(handle, runId, after_id)
    return NextUnreviewed(detection=MapDetectionOut.from_row(row) if row else None, remaining=remaining)


@router.post("/runs/{runId}/accept-above", response_model=JobRef, status_code=202)
def accept_run_above(
    runId: str,  # noqa: N803
    body: AcceptAbove,
    request: Request,
    handle: ProjectHandle = Depends(get_project),
) -> JobRef:
    review.run_kind(handle, runId)  # 404 before a job is queued
    job = request.app.state.jobs.submit(
        handle, "accept_above", {"run_id": runId, "min_confidence": body.min_confidence}
    )
    return JobRef(job=JobOut.from_row(job, handle.id))
