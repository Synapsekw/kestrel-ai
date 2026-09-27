"""Request and response bodies of the detection runs API (contract: RunSummary, RunCreate, ...)."""

from __future__ import annotations

from datetime import datetime
from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field

from app.inference.schemas import Tiling
from app.jobs.schemas import JobOut
from app.providers.schemas import ProviderName

RunKind = Literal["images", "map"]
JobState = Literal["queued", "running", "succeeded", "failed", "cancelled"]


class ReviewProgress(BaseModel):
    total: int
    reviewed: int


class RunSummary(BaseModel):
    id: str
    kind: RunKind
    source_id: str | None
    source_label: str | None
    model_id: str | None
    model_name: str | None
    conf: float
    job_state: JobState | None
    pinned: bool
    counts: dict[str, int]
    verified_counts: dict[str, int]
    review: ReviewProgress
    created_at: datetime


class RunSummaryPage(BaseModel):
    items: list[RunSummary]
    next_cursor: str | None = None


SitePoint = Annotated[list[float], Field(min_length=2, max_length=2)]


class RunRegion(BaseModel):
    """A map run over part of one map (map-workspace spec §9.3); answers 501 until M-B5."""

    map_id: str
    polygon_site: list[SitePoint] = Field(min_length=3, max_length=5000)


class RunCreate(BaseModel):
    source_ids: list[str] = Field(min_length=1)
    model_id: str | None = None
    provider: ProviderName | None = None
    query: str | None = Field(default=None, min_length=1)
    conf: float = Field(default=0.25, ge=0, le=1)
    tiling: Tiling | None = None
    target_gsd_cm: float | None = Field(default=None, gt=0)
    region: RunRegion | None = None


class RunCreatedItem(BaseModel):
    run_id: str
    source_id: str
    kind: RunKind
    job: JobOut


class RunCreated(BaseModel):
    runs: list[RunCreatedItem]
    #: Catalogue types this run added to the project's type list (F §7.4); empty when none.
    added_type_ids: list[str] = Field(default_factory=list)


class RunPatch(BaseModel):
    model_config = ConfigDict(extra="forbid")
    pinned: bool


class ModelClassMapOut(BaseModel):
    model_id: str
    model_classes: list[str]
    mapping: dict[str, str | None]
    unmapped: list[str]


class ModelClassMapPut(BaseModel):
    mapping: dict[str, str | None]
    new_classes: list[str] = Field(default_factory=list)
