"""Request and response models for `/library/datasets` (contract: DatasetFilter, LibraryDataset...)."""

from datetime import date, datetime
from typing import Literal

from pydantic import BaseModel, Field

from app.jobs.schemas import JobOut

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


class LibraryDatasetCreate(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    task: DatasetTask = "detect"
    filter: DatasetFilter
    split_method: SplitMethod = "by_group"
    val_fraction: float = Field(0.2, ge=0.05, le=0.5)
    seed: int = 42


class DatasetClass(BaseModel):
    type_id: str
    name: str


class DatasetSourceOut(BaseModel):
    project_id: str
    project_folder: str
    project_name: str
    image_count: int


class DatasetCounts(BaseModel):
    images: int = 0
    train: int = 0
    val: int = 0
    per_class: dict[str, int] = Field(default_factory=dict)


class LibraryDatasetOut(BaseModel):
    id: str
    name: str
    task: DatasetTask
    origin: Literal["built", "legacy"]
    filter: DatasetFilter | None
    classes: list[DatasetClass]
    split_method: str
    split_params: dict[str, float | int]
    state: Literal["resolving", "ready", "failed"]
    counts: DatasetCounts
    export_path: str | None  # absolute; stored relative to the library root (amendment A4)
    export_state: Literal["none", "building", "ready", "stale", "failed"]
    legacy_path: str | None
    job_id: str | None  # the latest build or export job (amendment A5)
    sources: list[DatasetSourceOut]
    created_at: datetime


class LibraryDatasetPage(BaseModel):
    items: list[LibraryDatasetOut]
    next_cursor: str | None


class LibraryDatasetWithJob(BaseModel):
    dataset: LibraryDatasetOut
    job: JobOut


class DatasetItemOut(BaseModel):
    project_id: str
    image_id: str
    split: Literal["train", "val"]
    label_count: int


class DatasetItemPage(BaseModel):
    items: list[DatasetItemOut]
    next_cursor: str | None
