"""Pydantic models for annotations (boxes) and image measurements, matching contract/openapi.yaml."""

from datetime import datetime
from typing import Annotated, Literal

from pydantic import BaseModel, Field

from app.db.models import Box

BoxShape = Literal["box", "rbox", "polygon", "point"]
Vertex = Annotated[list[float], Field(min_length=2, max_length=2)]


class Provenance(BaseModel):
    kind: Literal["person", "local_model", "cloud_provider"]
    model_id: str | None
    provider: str | None
    model_name: str | None
    query_run_id: str | None


class BoxOut(BaseModel):
    id: str
    image_id: str
    class_id: str
    x: float
    y: float
    w: float
    h: float
    angle: float
    confidence: float | None
    provenance: Provenance
    review_state: Literal["unreviewed", "accepted", "rejected", "edited"]
    reviewed_at: datetime | None
    created_at: datetime
    shape: BoxShape
    points: list[list[float]] | None
    assist: Literal["sam"] | None
    area_px: float
    updated_at: datetime

    @classmethod
    def fields_of(cls, row: Box) -> dict:
        return {
            "id": row.id,
            "image_id": row.image_id,
            "class_id": row.class_id,
            "x": row.x,
            "y": row.y,
            "w": row.w,
            "h": row.h,
            "angle": row.angle,
            "confidence": row.confidence,
            "provenance": Provenance(
                kind=row.provenance_kind,
                model_id=row.model_id,
                provider=row.provider,
                model_name=row.model_name,
                query_run_id=row.query_run_id,
            ),
            "review_state": row.review_state,
            "reviewed_at": row.reviewed_at,
            "created_at": row.created_at,
            "shape": row.shape,
            "points": row.points,
            "assist": row.assist,
            "area_px": row.area_px,
            "updated_at": row.updated_at or row.created_at,
        }

    @classmethod
    def from_row(cls, row: Box) -> "BoxOut":
        return cls(**cls.fields_of(row))


class BoxWriteResult(BoxOut):
    repaired: bool
    finding_id: str | None

    @classmethod
    def from_written(cls, w) -> "BoxWriteResult":
        return cls(**BoxOut.fields_of(w.box), repaired=w.repaired, finding_id=w.finding_id)


class BoxList(BaseModel):
    items: list[BoxOut]


class BoxCreate(BaseModel):
    """Only `class_id` is required (C0 ruling 2); the service judges which fields a shape needs and
    answers 422 `invalid_shape` for a missing one.

    `x`/`y` carry no lower bound: `x, y` describe the *unrotated* box, so a box rotated near the
    left or top edge has a negative one while its centre is still inside. Bounds are
    `imagery.shapes`' single decision (spec 3.3).
    """

    class_id: str
    shape: BoxShape = "box"
    x: float = Field(default=None)
    y: float = Field(default=None)
    w: float = Field(default=None, gt=0)
    h: float = Field(default=None, gt=0)
    angle: float = Field(default=0.0)
    points: list[Vertex] = Field(default=None, min_length=3, max_length=2000)
    assist: Literal["sam"] = Field(default=None)


class BoxUpdate(BaseModel):
    """Optional, not nullable (an explicit null is a 422), as before. No `shape`: it never changes.

    The types stay non-optional and `None` is only the "not sent" default (pydantic does not
    validate defaults), so `model_dump(exclude_unset=True)` yields exactly the fields sent.
    """

    class_id: str = Field(default=None)
    x: float = Field(default=None)
    y: float = Field(default=None)
    w: float = Field(default=None, gt=0)
    h: float = Field(default=None, gt=0)
    angle: float = Field(default=None)
    points: list[Vertex] = Field(default=None, min_length=3, max_length=2000)


class BoxReview(BaseModel):
    box_ids: list[str] = Field(min_length=1)
    action: Literal["accept", "reject", "unreview"]


class BoxReviewResult(BaseModel):
    updated: int
    finding_ids_created: list[str]
    finding_ids_deleted: list[str]


class ImageMeasurementOut(BaseModel):
    id: str
    image_id: str
    x1: float
    y1: float
    x2: float
    y2: float
    label: str
    created_at: datetime
    length_px: float
    length_mm: float | None
    sigma_mm: float | None

    @classmethod
    def from_row(cls, row, scale) -> "ImageMeasurementOut":
        from app.imagery.measurements import headline, length_px

        px = length_px(row)
        mm, sigma = headline(px, scale)
        return cls(
            id=row.id,
            image_id=row.image_id,
            x1=row.x1,
            y1=row.y1,
            x2=row.x2,
            y2=row.y2,
            label=row.label,
            created_at=row.created_at,
            length_px=round(px, 3),
            length_mm=mm,
            sigma_mm=sigma,
        )


class ImageMeasurementList(BaseModel):
    items: list[ImageMeasurementOut]


class ImageMeasurementCreate(BaseModel):
    x1: float = Field(allow_inf_nan=False)
    y1: float = Field(allow_inf_nan=False)
    x2: float = Field(allow_inf_nan=False)
    y2: float = Field(allow_inf_nan=False)
    label: str = Field(default="", max_length=200)
