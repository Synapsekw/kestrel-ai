"""API shapes for asset models (contract: AssetModel*, SpecIssue, AssetSourceRef)."""

from __future__ import annotations

from datetime import date, datetime
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator

from app.asset_models.spec import AssetSpec
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
    kind: Literal["agent", "manual", "draft"]
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
