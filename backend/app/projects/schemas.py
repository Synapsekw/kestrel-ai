"""Pydantic models for the projects resource, matching contract/openapi.yaml exactly."""

from datetime import UTC, datetime
from pathlib import Path
from typing import Literal

from pydantic import BaseModel, Field, field_validator

from app.db.models import Project


class ImportSettings(BaseModel):
    max_side: int = Field(4000, ge=512, le=12000)
    quality: int = Field(95, ge=50, le=100)
    dedupe_threshold: int = Field(4, ge=0, le=32)
    group_regex: str = r"^(?P<camera>[A-Za-z0-9-]+)_(?P<flight>\d+)_(?P<frame>\d+)"


class ImportSettingsPatch(BaseModel):
    max_side: int | None = Field(None, ge=512, le=12000)
    quality: int | None = Field(None, ge=50, le=100)
    dedupe_threshold: int | None = Field(None, ge=0, le=32)
    group_regex: str | None = None


class ClassDefInput(BaseModel):
    id: str | None = None
    name: str = Field(min_length=1, max_length=64)
    colour: str = Field(pattern=r"^#[0-9a-fA-F]{6}$")
    hotkey: str | None = Field(None, max_length=1)


class ClassDef(BaseModel):
    id: str
    name: str
    colour: str
    hotkey: str | None
    order: int


def _absolute(v: str) -> str:
    if not Path(v).is_absolute():
        raise ValueError("folder must be an absolute path")
    return v


class ProjectCreate(BaseModel):
    """`type_ids` are the catalogue types the project starts with (spec 2026-09-26-foundation
    section 9.2). It defaults to empty so a client from before the catalogue is not refused."""

    name: str = Field(min_length=1)
    folder: str
    type_ids: list[str] = []

    _folder_abs = field_validator("folder")(_absolute)


class ProjectOpen(BaseModel):
    folder: str

    _folder_abs = field_validator("folder")(_absolute)


class ProjectUpdate(BaseModel):
    name: str | None = Field(None, min_length=1)
    preannotation_model_id: str | None = None
    import_defaults: ImportSettingsPatch | None = None


MigrationStateName = Literal["ok", "pending", "running", "failed"]


class MigrationStateOut(BaseModel):
    """`MigrationState` (foundation spec §9.2, §11.3): where a project's upgrade stands."""

    state: MigrationStateName = "ok"
    job_id: str | None = None
    error: str | None = None
    code: str | None = None
    step: str | None = None
    backup_path: str | None = None
    report_path: str | None = None


class ProjectOut(BaseModel):
    id: str
    name: str
    folder: str
    classes: list[ClassDef]
    preannotation_model_id: str | None
    import_defaults: ImportSettings
    schema_version: int
    created_at: datetime
    last_opened_at: datetime | None
    migration: MigrationStateOut = Field(default_factory=MigrationStateOut)
    availability: Literal["ok", "missing"] = "ok"

    @classmethod
    def from_row(cls, row: Project, folder: Path, last_opened_at: datetime | None) -> "ProjectOut":
        """`last_opened_at` comes from the recent-projects list (`AppData`), not the project's own
        row: it is per-user app data, not part of the project file (see `app/appdata.py`)."""
        return cls(
            id=row.id,
            name=row.name,
            folder=str(folder),
            classes=[ClassDef(**c) for c in row.classes],
            preannotation_model_id=row.preannotation_model_id,
            import_defaults=ImportSettings(**(row.import_defaults or {})),
            schema_version=row.schema_version,
            created_at=row.created_at,
            last_opened_at=last_opened_at,
        )

    @classmethod
    def unavailable(
        cls,
        recent: dict,
        migration: MigrationStateOut,
        last_opened_at: datetime | None,
        availability: Literal["ok", "missing"] = "ok",
    ) -> "ProjectOut":
        """A recent project that could not be opened, is upgrading, or whose folder is gone
        (`availability="missing"`): listed with what the recent list knows, so one folder never
        fails the whole list (foundation spec §9.2; operator decision 2026-09-26). `created_at` is
        its `last_opened_at`, as the contract's `Project` says."""
        return cls(
            id=recent["id"],
            name=recent["name"],
            folder=recent["folder"],
            classes=[],
            preannotation_model_id=None,
            import_defaults=ImportSettings(),
            schema_version=0,
            created_at=last_opened_at or datetime(1970, 1, 1, tzinfo=UTC),
            last_opened_at=last_opened_at,
            migration=migration,
            availability=availability,
        )


class ProjectPage(BaseModel):
    items: list[ProjectOut]
    next_cursor: str | None = None


class CountByClass(BaseModel):
    class_id: str
    class_name: str
    count: int


class SourceCount(BaseModel):
    source_id: str
    site: str
    image_count: int


class GroupCount(BaseModel):
    group_key: str
    image_count: int


class ResolutionBucket(BaseModel):
    width: int
    height: int
    count: int


class TimeRange(BaseModel):
    min: datetime
    max: datetime


class GpsBounds(BaseModel):
    min_lat: float
    min_lon: float
    max_lat: float
    max_lon: float


class Stats(BaseModel):
    image_count: int = 0
    labeled_count: int = 0
    unlabeled_count: int = 0
    box_count: int = 0
    pending_review_count: int = 0
    duplicate_count: int = 0
    boxes_per_class: list[CountByClass] = []
    sources: list[SourceCount] = []
    groups: list[GroupCount] = []
    resolution_histogram: list[ResolutionBucket] = []
    capture_time_range: TimeRange | None = None
    gps_bounds: GpsBounds | None = None
