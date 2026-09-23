"""Pydantic models for sources, images, boxes and datasets, matching contract/openapi.yaml exactly."""

from datetime import date, datetime
from pathlib import Path
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator

from app.db.models import Box, Dataset, Image, Source
from app.jobs.schemas import JobOut
from app.projects.schemas import ClassDef, ImportSettings

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
            labeled=box_count > 0 or image.marked_empty,
            marked_empty=image.marked_empty,
            created_at=image.created_at,
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


class Provenance(BaseModel):
    kind: Literal["person", "local_model", "cloud_provider"]
    model_id: str | None
    provider: str | None
    model_name: str | None
    query_run_id: str | None


class BoxOut(BaseModel):
    id: str
    image_id: str
    class_id: str
    x: float
    y: float
    w: float
    h: float
    angle: float
    confidence: float | None
    provenance: Provenance
    review_state: Literal["unreviewed", "accepted", "rejected", "edited"]
    reviewed_at: datetime | None
    created_at: datetime

    @classmethod
    def from_row(cls, row: Box) -> "BoxOut":
        return cls(
            id=row.id,
            image_id=row.image_id,
            class_id=row.class_id,
            x=row.x,
            y=row.y,
            w=row.w,
            h=row.h,
            angle=row.angle,
            confidence=row.confidence,
            provenance=Provenance(
                kind=row.provenance_kind,
                model_id=row.model_id,
                provider=row.provider,
                model_name=row.model_name,
                query_run_id=row.query_run_id,
            ),
            review_state=row.review_state,
            reviewed_at=row.reviewed_at,
            created_at=row.created_at,
        )


class BoxList(BaseModel):
    items: list[BoxOut]


class BoxCreate(BaseModel):
    """`x`/`y` carry no lower bound: a rotated box may legitimately start outside the frame.

    `x, y` describe the *unrotated* box, so a box rotated near the left or top edge has a negative
    one while its centre is still comfortably inside. Bounds are `boxes._check_bounds`' single
    decision (spec 3.3) — it still rejects a negative x at angle 0, and with a message that says
    what is wrong. `w`/`h` keep `gt=0`: a non-positive side is invalid at any angle.
    """

    class_id: str
    x: float
    y: float
    w: float = Field(gt=0)
    h: float = Field(gt=0)
    angle: float = Field(default=0.0)


class BoxUpdate(BaseModel):
    """Every field is optional, but none of them is nullable: the contract has no null in BoxUpdate.

    The types therefore stay non-optional and `None` is only the "not sent" default (pydantic does
    not validate defaults), so an explicit `null` fails validation with 422 instead of reaching the
    model. `model_dump(exclude_unset=True)` yields exactly the fields the caller sent.

    `x`/`y` have no lower bound here either, for the reason given on `BoxCreate`.
    """

    class_id: str = Field(default=None)
    x: float = Field(default=None)
    y: float = Field(default=None)
    w: float = Field(default=None, gt=0)
    h: float = Field(default=None, gt=0)
    angle: float = Field(default=None)


class BoxReview(BaseModel):
    box_ids: list[str] = Field(min_length=1)
    action: Literal["accept", "reject", "unreview"]


class BoxReviewResult(BaseModel):
    updated: int


SplitMethod = Literal["by_group", "by_tile", "random"]


class SplitParams(BaseModel):
    val_fraction: float
    seed: int


class DatasetCreate(BaseModel):
    name: str = Field(min_length=1, pattern=r"^[A-Za-z0-9._-]+$")
    split_method: SplitMethod = "by_group"
    val_fraction: float = Field(default=0.2, ge=0.05, le=0.5)
    seed: int = 42
    image_ids: list[str] | None = None


class DatasetOut(BaseModel):
    id: str
    name: str
    classes: list[ClassDef]
    split_method: SplitMethod
    split_params: SplitParams
    path: str
    image_count: int
    train_count: int
    val_count: int
    job_id: str | None
    created_at: datetime

    @classmethod
    def from_row(cls, row: Dataset, train_count: int, val_count: int) -> "DatasetOut":
        return cls(
            id=row.id,
            name=row.name,
            classes=[ClassDef(**c) for c in row.classes or []],
            split_method=row.split_method,
            split_params=SplitParams(**row.split_params),
            path=row.path,
            image_count=train_count + val_count,
            train_count=train_count,
            val_count=val_count,
            job_id=row.job_id,
            created_at=row.created_at,
        )


class DatasetWithJob(BaseModel):
    dataset: DatasetOut
    job: JobOut


class DatasetPage(BaseModel):
    items: list[DatasetOut]
    next_cursor: str | None = None


class DatasetClassCount(BaseModel):
    class_id: str
    class_name: str
    train: int
    val: int


class DatasetGroupCount(BaseModel):
    group_key: str
    split: Literal["train", "val"]
    image_count: int


class DatasetStats(BaseModel):
    image_count: int
    train_count: int
    val_count: int
    boxes_per_class: list[DatasetClassCount]
    groups: list[DatasetGroupCount]
