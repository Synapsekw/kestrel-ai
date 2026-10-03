"""API shapes for asset models (contract: AssetModel*, SpecIssue, AssetSourceRef)."""

from __future__ import annotations

from datetime import date, datetime
from typing import Annotated, Any, Literal

from pydantic import BaseModel, ConfigDict, Field, ValidationError, field_validator, model_validator

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
    kind: Literal["asset", "plant"] = "asset"  # plant model spec §9 (migration 0017)

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
    kind: Literal["asset", "plant"] = "asset"


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


class AssetModelRunPackagesOut(BaseModel):
    total: int
    done: int
    failed: int
    running: int


class AssetModelRunStageUsageOut(BaseModel):
    input_tokens: int = 0
    output_tokens: int = 0
    images: int = 0
    calls: int = 0


class AssetModelRunUsageByStageOut(BaseModel):
    current: str
    stages: dict[str, AssetModelRunStageUsageOut]
    cost_estimate_usd: float | None
    cost_label: str


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
    mode: Literal["build", "refine", "plant", "plant_package"]
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
    # Plant runs (spec 2026-10-03-plant-model-generator §8). 0017 adds no run columns: R1 keeps the
    # stage usage in the run's `usage` JSON under "by_stage" and passes the package counts in.
    packages: AssetModelRunPackagesOut | None = None
    usage_by_stage: AssetModelRunUsageByStageOut | None = None

    @classmethod
    def of(cls, row, packages: AssetModelRunPackagesOut | None = None) -> AssetModelRunOut:
        out = cls.model_validate(row, from_attributes=True)
        usage = row.usage if isinstance(row.usage, dict) else {}
        try:
            by_stage = AssetModelRunUsageByStageOut.model_validate(usage.get("by_stage"))
        except ValidationError:  # absent (build and refine runs) or not R1's shape
            by_stage = None
        counts = {k: int(usage.get(k) or 0) for k in ("input_tokens", "output_tokens")}
        return out.model_copy(update={"usage": counts, "usage_by_stage": by_stage, "packages": packages})


class AssetModelRunList(BaseModel):
    items: list[AssetModelRunOut]


class AssetModelRunLimits(BaseModel):
    model_config = ConfigDict(extra="forbid")
    max_tokens: int | None = Field(None, ge=100_000, le=200_000_000)
    max_images: int | None = Field(None, ge=1, le=5000)
    max_seconds: int | None = Field(None, ge=60, le=86_400)
    parallel: int | None = Field(None, ge=1, le=8)


class AssetModelRunStart(BaseModel):
    model_config = ConfigDict(extra="forbid")
    mode: Literal["build", "refine", "plant", "plant_package"]
    sources: list[AssetSourceRef] = Field(min_length=1, max_length=200)  # a plant run takes every page
    provider: Literal["openai", "anthropic", "gemini"]
    model_name: str | None = Field(None, max_length=120)
    notes: str | None = Field(None, max_length=4000)
    package_ids: list[Annotated[str, Field(max_length=64)]] = Field(default_factory=list, max_length=64)
    limits: AssetModelRunLimits | None = None

    @model_validator(mode="after")
    def _plant_fields(self):
        if len(set(self.package_ids)) != len(self.package_ids):
            raise ValueError("package_ids must be unique.")
        return self


class AssetModelRunWithJob(BaseModel):
    run: AssetModelRunOut
    job: JobOut
