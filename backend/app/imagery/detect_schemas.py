"""Request and response bodies of the image detection API (contract: DetectRequest, DetectResult,
ComputeDevice, DetectBatchRequest, DetectBatchScope, ImageFilter; image inspection spec §11.2-11.3,
§14)."""

from __future__ import annotations

from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator

from app.imagery.schemas import BoxOut
from app.inference.schemas import QueryRunKind, Tiling
from app.providers.schemas import ProviderName

ComputeDevice = Literal["cuda", "cpu"]
MAX_BATCH_IDS = 100_000
FindingStatus = Literal["open", "reviewed", "closed"]


class DetectRequest(BaseModel):
    model_id: str
    conf: float = Field(default=0.25, ge=0, le=1)
    imgsz: int | None = Field(default=None, ge=320, le=6400)


class DetectResult(BaseModel):
    model_id: str
    suggestions: list[BoxOut]
    new: int = Field(ge=0)
    already_covered: int = Field(ge=0)
    device: ComputeDevice
    elapsed_ms: int = Field(ge=0)

    @classmethod
    def from_outcome(cls, out) -> DetectResult:
        return cls(
            model_id=out.model.id,
            suggestions=[BoxOut.from_row(r) for r in out.suggestions],
            new=out.new,
            already_covered=out.already_covered,
            device=out.device,
            elapsed_ms=out.elapsed_ms,
        )


class ImageFilter(BaseModel):
    """The browser's filters as a body (C0: same meaning as `getImageIndex`'s query parameters)."""

    source_id: str | None = None
    has_findings: bool | None = None
    severity: list[Annotated[int, Field(ge=1, le=9)]] | None = None
    finding_status: list[FindingStatus] | None = None
    type_ids: list[str] | None = None
    has_suggestions: bool | None = None
    reviewed: bool | None = None
    unlabeled: bool | None = None
    search: str | None = None


class DetectBatchScope(BaseModel):
    """C0's `oneOf` of `{image_ids}`, `{source_id}`, `{filter}`, each with no other key."""

    model_config = ConfigDict(extra="forbid")

    image_ids: list[str] | None = Field(default=None, min_length=1, max_length=MAX_BATCH_IDS)
    source_id: str | None = None
    filter: ImageFilter | None = None

    @model_validator(mode="after")
    def exactly_one(self) -> DetectBatchScope:
        given = [k for k in ("image_ids", "source_id", "filter") if getattr(self, k) is not None]
        if len(given) != 1:
            raise ValueError("scope takes exactly one of image_ids, source_id or filter")
        return self


class DetectBatchRequest(BaseModel):
    kind: QueryRunKind
    model_id: str | None = None
    provider: ProviderName | None = None
    query: str | None = Field(default=None, min_length=1)
    conf: float = Field(default=0.25, ge=0, le=1)
    tiling: Tiling = Tiling()
    scope: DetectBatchScope
