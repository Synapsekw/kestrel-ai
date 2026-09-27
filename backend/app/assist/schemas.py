"""Assist request/response bodies: I-C0's contract schemas (`assist` tag, spec §14), field for field."""

from typing import Literal

from pydantic import BaseModel, Field

ComputeDevice = Literal["cuda", "cpu"]
AssistModelKey = Literal["sam2.1_t"]


class SegmentCrop(BaseModel):
    x: int = Field(ge=0)
    y: int = Field(ge=0)
    w: int = Field(ge=1)
    h: int = Field(ge=1)


class SegmentPoint(BaseModel):
    x: float
    y: float
    positive: bool


class SegmentPrepareRequest(BaseModel):
    crop: SegmentCrop


class SegmentPrepared(BaseModel):
    crop: SegmentCrop
    device: ComputeDevice
    encode_ms: int = Field(ge=0)
    cached: bool


class SegmentRequest(BaseModel):
    crop: SegmentCrop
    points: list[SegmentPoint] = Field(min_length=1, max_length=64)


class SegmentResult(BaseModel):
    polygon: list[list[float]] | None
    score: float
    device: ComputeDevice
    encode_ms: int = Field(ge=0)
    decode_ms: int = Field(ge=0)
    crop: SegmentCrop


class AssistModel(BaseModel):
    key: AssistModelKey
    name: str
    description: str
    size_mb: float = Field(ge=0)
    sha256: str
    state: Literal["missing", "ready", "invalid", "unavailable"]
    reason: str | None
    job_id: str | None


class AssistModelPage(BaseModel):
    items: list[AssistModel]
    next_cursor: str | None


class AssistModelImport(BaseModel):
    path: str = Field(min_length=1)
