"""Request and response bodies of the image detection API (contract: DetectRequest, DetectResult,
ComputeDevice, DetectBatchRequest, DetectBatchScope, ImageFilter; image inspection spec §11.2-11.3,
§14)."""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field

from app.imagery.schemas import BoxOut

ComputeDevice = Literal["cuda", "cpu"]


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
