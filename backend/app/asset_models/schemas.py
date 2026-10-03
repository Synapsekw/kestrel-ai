"""API shapes for asset models (contract: AssetModel*, SpecIssue, AssetSourceRef)."""

from __future__ import annotations

from datetime import date, datetime
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator

from app.asset_models.spec import AssetSpec
from app.asset_review.frame import Frame
from app.jobs.schemas import JobOut


class AssetSourceRef(BaseModel):
    model_config = ConfigDict(extra="forbid")
    type: Literal["drawing", "point_cloud", "image"]
    id: str


class AssetModelOut(BaseModel):
    id: str
    name: str
    asset_type: str | None
    tag: str | None
    status: Literal["empty", "building", "ready"]
    current_version: int | None
    live_run_id: str | None
    captured_on: date | None
    frame: dict | None = None  # app.asset_review.frame.Frame, as stored (spec 2026-10-02-asset-findings §5.1)
    review: dict | None = None  # the resolved review profile (§7)
    created_at: datetime
    updated_at: datetime

    @classmethod
    def of(cls, row) -> AssetModelOut:
        return cls.model_validate(row, from_attributes=True)


class AssetModelList(BaseModel):
    items: list[AssetModelOut]


class AssetModelCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")
    name: str = Field(min_length=1, max_length=120)
    asset_type: str | None = Field(None, max_length=80)
    tag: str | None = Field(None, max_length=80)


class AssetModelPatch(BaseModel):
    model_config = ConfigDict(extra="forbid")
    name: str | None = Field(None, min_length=1, max_length=120)
    asset_type: str | None = Field(None, max_length=80)
    tag: str | None = Field(None, max_length=80)
    captured_on: date | None = None
    frame: Frame | None = None
    # A profile id ({"profile_id": "stack"}) or an edited copy naming its profile; resolved by
    # app.asset_review.frame_io.resolve_review, which answers the 422s.
    review: dict[str, Any] | None = None

    @field_validator("name")
    @classmethod
    def _name_not_null(cls, v):
        if v is None:
            raise ValueError("name cannot be null")
        return v


class SpecIssueOut(BaseModel):
    code: str
    part_id: str | None
    message: str


class AssetModelVersionOut(BaseModel):
    id: str
    model_id: str
    version: int
    kind: Literal["agent", "manual", "draft", "imported"]
    glb_status: Literal["pending", "ready", "failed"]
    source_ids: list[AssetSourceRef]
    run_id: str | None
    note: str | None
    part_count: int
    meta: dict | None
    created_at: datetime

    @classmethod
    def of(cls, row) -> AssetModelVersionOut:
        return cls.model_validate(row, from_attributes=True)


class AssetModelVersionList(BaseModel):
    items: list[AssetModelVersionOut]


class AssetModelVersionDetailOut(AssetModelVersionOut):
    spec: AssetSpec
    warnings: list[SpecIssueOut]


class AssetModelVersionCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")
    # Validated by `service.parse_spec`, not here: the contract cannot express every spec rule (a
    # non-zero axis, a non-empty region), and a schema-valid body must answer `invalid_spec`.
    spec: dict[str, Any]
    note: str | None = Field(None, max_length=500)


class AssetModelVersionWithJob(BaseModel):
    version: AssetModelVersionOut
    job: JobOut


class AssetModelRunStepOut(BaseModel):
    n: int
    tool: str
    ok: bool
    summary: str
    has_thumb: bool


class AssetModelRunOut(BaseModel):
    id: str
    model_id: str
    job_id: str
    provider: Literal["openai", "anthropic", "gemini"]
    model_name: str
    mode: Literal["build", "refine"]
    notes: str | None
    state: Literal["running", "finished", "stopped", "failed"]
    stop_reason: Literal["budget", "timeout", "user", "provider_error", "interrupted"] | None
    phase: Literal["sampling", "reading", "building", "checking", "done"]
    steps: list[AssetModelRunStepOut]
    summary: str | None
    open_questions: list[str]
    usage: dict
    sources: list[AssetSourceRef]
    version: int | None
    comparison: dict | None
    started_at: datetime
    ended_at: datetime | None

    @classmethod
    def of(cls, row) -> AssetModelRunOut:
        return cls.model_validate(row, from_attributes=True)


class AssetModelRunList(BaseModel):
    items: list[AssetModelRunOut]


class AssetModelRunStart(BaseModel):
    model_config = ConfigDict(extra="forbid")
    mode: Literal["build", "refine"]
    sources: list[AssetSourceRef] = Field(min_length=1, max_length=50)
    provider: Literal["openai", "anthropic", "gemini"]
    model_name: str | None = Field(None, max_length=120)
    notes: str | None = Field(None, max_length=4000)


class AssetModelRunWithJob(BaseModel):
    run: AssetModelRunOut
    job: JobOut
