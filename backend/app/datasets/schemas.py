"""Pydantic models for sources, images and boxes, matching contract/openapi.yaml exactly."""

from datetime import date, datetime
from pathlib import Path
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator

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
    "worst_severity",
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


SourceKind = Literal["images", "map"]


class SourceOut(BaseModel):
    id: str
    kind: SourceKind
    label: str | None
    captured_on: date | None
    map_id: str | None
    folder: str
    site: str
    settings: ImportSettings
    image_count: int
    duplicate_count: int
    job_id: str | None
    imported_at: datetime | None
    created_at: datetime

    @classmethod
    def from_row(cls, row: Source, map_id: str | None = None) -> "SourceOut":
        """`map_id` is the map a `map` source owns (`GeoMap.source_id` points back at the source)."""
        return cls(
            id=row.id,
            kind=row.kind or "images",
            label=row.label,
            captured_on=row.captured_on,
            map_id=map_id,
            folder=row.folder,
            site=row.site,
            settings=ImportSettings(**(row.settings or {})),
            image_count=row.image_count,
            duplicate_count=row.duplicate_count,
            job_id=row.job_id,
            imported_at=row.imported_at,
            created_at=row.created_at,
        )


class SourcePatch(BaseModel):
    """Rename a source or correct its survey date; a field left out is left alone, null clears it."""

    model_config = ConfigDict(extra="forbid")
    label: str | None = Field(None, max_length=200)
    captured_on: date | None = None


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
    marked_empty: bool
    created_at: datetime
    finding_count: int
    worst_severity: int | None
    reviewed: bool

    @classmethod
    def from_row(
        cls,
        image: Image,
        box_count: int,
        pending_count: int,
        max_pending_confidence: float | None,
        finding_count: int = 0,
        worst_severity: int | None = None,
    ) -> "ImageOut":
        labeled = box_count > 0 or image.marked_empty
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
            labeled=labeled,
            marked_empty=image.marked_empty,
            created_at=image.created_at,
            finding_count=finding_count,
            worst_severity=worst_severity,
            reviewed=pending_count == 0 and labeled,
        )


class ImagePage(BaseModel):
    items: list[ImageOut]
    next_cursor: str | None = None
    total: int


class ImageUpdate(BaseModel):
    marked_empty: bool


class BulkMarkEmpty(BaseModel):
    image_ids: list[str] = Field(min_length=1)
    marked_empty: bool


class BulkMarkEmptyResult(BaseModel):
    updated: int
    skipped: int


class BulkDelete(BaseModel):
    image_ids: list[str] = Field(min_length=1)


class BulkDeleteResult(BaseModel):
    deleted: int
