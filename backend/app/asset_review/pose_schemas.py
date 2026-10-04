"""API shapes for photo poses (contract: ImagePose, ImagePoseList, ImagePoseIn, PoseEstimateRequest)."""

from __future__ import annotations

from datetime import datetime
from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field

from app.jobs.schemas import JobOut

Finite = Annotated[float, Field(allow_inf_nan=False)]
Vec3 = tuple[Finite, Finite, Finite]
Outcome = Literal["finding", "none", "uncertain", "not_assessed"]  # contract ImageReviewStatus
Source = Literal["kit", "exif_gimbal", "exif_axis_aim", "manual"]  # contract ImagePoseSource


class ImagePoseOut(BaseModel):
    image_id: str
    position: list[float]
    target: list[float]
    up: list[float]
    hfov_deg: float
    vfov_deg: float
    source: Source
    accuracy_m: float | None
    sequence: str | None
    outcome: Outcome
    updated_at: datetime

    @classmethod
    def of(cls, row, outcome: str) -> ImagePoseOut:
        return cls(
            image_id=row.image_id,
            position=list(row.position),
            target=list(row.target),
            up=list(row.up),
            hfov_deg=row.hfov_deg,
            vfov_deg=row.vfov_deg,
            source=row.source,
            accuracy_m=row.accuracy_m,
            sequence=row.sequence,
            outcome=outcome,
            updated_at=row.updated_at,
        )


class ImagePoseList(BaseModel):
    items: list[ImagePoseOut]
    next: str | None


class ImagePoseIn(BaseModel):
    model_config = ConfigDict(extra="forbid")
    position: Vec3
    target: Vec3
    up: Vec3
    hfov_deg: float = Field(gt=0, le=180)  # the contract allows 180; `_check_pose` refuses it as a pose
    vfov_deg: float = Field(gt=0, le=180)
    accuracy_m: float | None = Field(None, ge=0)
    sequence: str | None = Field(None, max_length=120)


class PoseEstimateRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    image_ids: list[str] | None = Field(None, min_length=1, max_length=100_000)


class PoseJobRef(BaseModel):
    job: JobOut
