"""Pydantic models for sources, images, boxes and datasets, matching contract/openapi.yaml exactly."""

from datetime import datetime
from pathlib import Path
from typing import Literal

from pydantic import BaseModel, Field, field_validator

from app.db.models import Image, Source
from app.jobs.schemas import JobOut
from app.projects.schemas import ImportSettings

ImageSort = Literal[
    "path",
    "source_id",
    "group_key",
    "labeled",
    "box_count",
    "pending_count",
    "max_pending_confidence",
    "capture_time",
    "created_at",
]
SortOrder = Literal["asc", "desc"]


def _absolute(v: str) -> str:
    if not Path(v).is_absolute():
        raise ValueError("folder must be an absolute path")
    return v


class SourceCreate(BaseModel):
    folder: str
    site: str | None = None
    settings: ImportSettings | None = None

    _folder_abs = field_validator("folder")(_absolute)


class SourceOut(BaseModel):
    id: str
    folder: str
    site: str
    settings: ImportSettings
    image_count: int
    duplicate_count: int
    job_id: str | None
    imported_at: datetime | None
    created_at: datetime

    @classmethod
    def from_row(cls, row: Source) -> "SourceOut":
        return cls(
            id=row.id,
            folder=row.folder,
            site=row.site,
            settings=ImportSettings(**(row.settings or {})),
            image_count=row.image_count,
            duplicate_count=row.duplicate_count,
            job_id=row.job_id,
            imported_at=row.imported_at,
            created_at=row.created_at,
        )


class SourceWithJob(BaseModel):
    source: SourceOut
    job: JobOut


class SourcePage(BaseModel):
    items: list[SourceOut]
    next_cursor: str | None = None


class ImageOut(BaseModel):
    id: str
    path: str
    file_name: str
    width: int
    height: int
    source_id: str
    group_key: str
    capture_time: datetime | None
    lat: float | None
    lon: float | None
    alt: float | None
    phash: str | None
    box_count: int
    pending_count: int
    max_pending_confidence: float | None
    labeled: bool
    created_at: datetime

    @classmethod
    def from_row(
        cls, image: Image, box_count: int, pending_count: int, max_pending_confidence: float | None
    ) -> "ImageOut":
        return cls(
            id=image.id,
            path=image.path,
            file_name=image.path.rsplit("/", 1)[-1],
            width=image.width,
            height=image.height,
            source_id=image.source_id,
            group_key=image.group_key,
            capture_time=image.capture_time,
            lat=image.lat,
            lon=image.lon,
            alt=image.alt,
            phash=image.phash,
            box_count=box_count,
            pending_count=pending_count,
            max_pending_confidence=max_pending_confidence,
            labeled=box_count > 0,
            created_at=image.created_at,
        )


class ImagePage(BaseModel):
    items: list[ImageOut]
    next_cursor: str | None = None
    total: int


class BulkDelete(BaseModel):
    image_ids: list[str] = Field(min_length=1)


class BulkDeleteResult(BaseModel):
    deleted: int
