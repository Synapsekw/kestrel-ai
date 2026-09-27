"""Pydantic models for annotations (boxes) and image measurements, matching contract/openapi.yaml."""

from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field

from app.db.models import Box


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

    @classmethod
    def from_row(cls, row: Box) -> "BoxOut":
        return cls(
            id=row.id,
            image_id=row.image_id,
            class_id=row.class_id,
            x=row.x,
            y=row.y,
            w=row.w,
            h=row.h,
            angle=row.angle,
            confidence=row.confidence,
            provenance=Provenance(
                kind=row.provenance_kind,
                model_id=row.model_id,
                provider=row.provider,
                model_name=row.model_name,
                query_run_id=row.query_run_id,
            ),
            review_state=row.review_state,
            reviewed_at=row.reviewed_at,
            created_at=row.created_at,
        )


class BoxList(BaseModel):
    items: list[BoxOut]


class BoxCreate(BaseModel):
    """`x`/`y` carry no lower bound: a rotated box may legitimately start outside the frame.

    `x, y` describe the *unrotated* box, so a box rotated near the left or top edge has a negative
    one while its centre is still comfortably inside. Bounds are `boxes._check_bounds`' single
    decision (spec 3.3) — it still rejects a negative x at angle 0, and with a message that says
    what is wrong. `w`/`h` keep `gt=0`: a non-positive side is invalid at any angle.
    """

    class_id: str
    x: float
    y: float
    w: float = Field(gt=0)
    h: float = Field(gt=0)
    angle: float = Field(default=0.0)


class BoxUpdate(BaseModel):
    """Every field is optional, but none of them is nullable: the contract has no null in BoxUpdate.

    The types therefore stay non-optional and `None` is only the "not sent" default (pydantic does
    not validate defaults), so an explicit `null` fails validation with 422 instead of reaching the
    model. `model_dump(exclude_unset=True)` yields exactly the fields the caller sent.

    `x`/`y` have no lower bound here either, for the reason given on `BoxCreate`.
    """

    class_id: str = Field(default=None)
    x: float = Field(default=None)
    y: float = Field(default=None)
    w: float = Field(default=None, gt=0)
    h: float = Field(default=None, gt=0)
    angle: float = Field(default=None)


class BoxReview(BaseModel):
    box_ids: list[str] = Field(min_length=1)
    action: Literal["accept", "reject", "unreview"]


class BoxReviewResult(BaseModel):
    updated: int
