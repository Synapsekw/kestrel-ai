"""Request and response models for `/library/datasets` (contract: DatasetFilter, LibraryDataset...)."""

from datetime import date
from typing import Literal

from pydantic import BaseModel, Field

DatasetTask = Literal["detect", "obb", "segment"]
SplitMethod = Literal["by_group", "by_tile", "random"]


class DatasetFilter(BaseModel):
    project_ids: list[str] = Field(min_length=1, max_length=50)
    type_ids: list[str] = Field(min_length=1, max_length=200)
    captured_from: date | None = None
    captured_to: date | None = None
    reviewed_only: bool = False


class DatasetPreviewProject(BaseModel):
    project_id: str
    project_name: str | None
    images: int
    boxes: int
    state: Literal["ok", "missing", "unavailable", "timed_out"]


class DatasetPreview(BaseModel):
    images: int
    boxes_per_type: dict[str, int]
    projects: list[DatasetPreviewProject]
