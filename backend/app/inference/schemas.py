"""Pydantic models for query runs and pre-annotation, matching contract/openapi.yaml exactly."""

from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field

from app.datasets.schemas import BoxOut
from app.db.models import QueryRun
from app.jobs.schemas import JobOut
from app.providers.base import TilingSpec
from app.providers.schemas import ProviderName

QueryRunKind = Literal["local_model", "cloud_provider"]


class Tiling(BaseModel):
    enabled: bool = True
    tile_size: int = Field(default=1280, ge=256, le=4096)
    overlap: float = Field(default=0.2, ge=0, le=0.5)
    nms_iou: float = Field(default=0.5, ge=0, le=1)

    def to_spec(self) -> TilingSpec:
        return TilingSpec(self.enabled, self.tile_size, self.overlap, self.nms_iou)


class QueryRunCreate(BaseModel):
    kind: QueryRunKind
    model_id: str = Field(default=None)
    provider: ProviderName = Field(default=None)
    query: str = Field(default=None)
    image_ids: list[str] = Field(min_length=1)
    tiling: Tiling = Tiling()
    conf: float = Field(default=0.25, ge=0, le=1)


class QueryRunOut(BaseModel):
    id: str
    kind: QueryRunKind
    model_id: str | None
    provider: str | None
    model_name: str | None
    query: str
    image_ids: list[str]
    tiling: Tiling
    conf: float
    job_id: str | None
    box_count: int
    promoted_at: datetime | None
    created_at: datetime

    @classmethod
    def from_row(cls, row: QueryRun, box_count: int) -> "QueryRunOut":
        return cls(
            id=row.id,
            kind=row.kind,
            model_id=row.model_id,
            provider=row.provider,
            model_name=row.model_name,
            query=row.query or "",
            image_ids=list(row.image_ids or []),
            tiling=Tiling(**(row.tiling or {})),
            conf=row.conf,
            job_id=row.job_id,
            box_count=box_count,
            promoted_at=row.promoted_at,
            created_at=row.created_at,
        )


class QueryRunWithJob(BaseModel):
    query_run: QueryRunOut
    job: JobOut


class QueryRunPage(BaseModel):
    items: list[QueryRunOut]
    next_cursor: str | None = None


class CostEstimate(BaseModel):
    images: int
    tiles: int
    requests: int
    cost_per_request: float
    estimated_cost: float


class PromoteRequest(BaseModel):
    min_confidence: float = Field(default=0, ge=0, le=1)


class PromoteResult(BaseModel):
    query_run: QueryRunOut
    accepted: int


class PreannotateRequest(BaseModel):
    model_id: str = Field(default=None)
    imgsz: int = Field(default=2560, ge=320, le=6400)
    conf: float = Field(default=0.25, ge=0, le=1)


class PreannotateResult(BaseModel):
    skipped: bool
    model_id: str
    items: list[BoxOut]
