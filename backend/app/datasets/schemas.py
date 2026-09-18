"""Pydantic models for sources, images, boxes and datasets, matching contract/openapi.yaml exactly."""

from datetime import datetime
from pathlib import Path

from pydantic import BaseModel, field_validator

from app.db.models import Source
from app.jobs.schemas import JobOut
from app.projects.schemas import ImportSettings


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
