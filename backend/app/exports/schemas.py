"""Pydantic models for the exports resource, matching contract/openapi.yaml exactly."""

from typing import Literal

from pydantic import BaseModel, Field, field_validator

from app.jobs.schemas import JobOut

ResultsExportFormat = Literal["csv", "yolo", "coco", "html"]


class ResultsExportRequest(BaseModel):
    formats: list[ResultsExportFormat] = Field(min_length=1)
    include_unreviewed: bool = False
    image_ids: list[str] | None = None

    @field_validator("formats")
    @classmethod
    def _unique(cls, v: list[str]) -> list[str]:
        if len(set(v)) != len(v):
            raise ValueError("formats must not repeat")
        return v


class RevealRequest(BaseModel):
    path: str = Field(min_length=1)


class JobRef(BaseModel):
    job: JobOut
