"""Pydantic models for GeoTIFF maps, matching contract/openapi.yaml exactly."""

from __future__ import annotations

from datetime import date, datetime
from typing import Literal

from pydantic import BaseModel, Field

from app.db.models import GeoMap, MapDetection, MapLabel, MapRun, MapZone
from app.inference.schemas import QueryRunKind
from app.jobs.schemas import JobOut
from app.maps.tiles import TILE, max_zoom
from app.providers.schemas import ProviderName


class TileGrid(BaseModel):
    tile_size: Literal[256] = TILE
    max_zoom: int


class GeoMapOut(BaseModel):
    id: str
    name: str
    status: Literal["importing", "ready", "failed"]
    error: str | None
    source_path: str
    source_size: int
    width: int
    height: int
    band_count: int
    dtype: str
    crs_wkt: str | None
    epsg: int | None
    proj4: str | None
    geotransform: list[float] | None
    bounds_native: list[float] | None
    bounds_wgs84: list[float] | None
    gsd_cm: float | None
    captured_on: date | None
    tile_grid: TileGrid
    labels_version: int
    job_id: str | None
    created_at: datetime

    @classmethod
    def from_row(cls, row: GeoMap) -> GeoMapOut:
        return cls(
            id=row.id,
            name=row.name,
            status=row.status,
            error=row.error,
            source_path=row.source_path,
            source_size=row.source_size,
            width=row.width,
            height=row.height,
            band_count=row.band_count,
            dtype=row.dtype,
            crs_wkt=row.crs_wkt,
            epsg=row.epsg,
            proj4=row.proj4,
            geotransform=row.geotransform,
            bounds_native=row.bounds_native,
            bounds_wgs84=row.bounds_wgs84,
            gsd_cm=row.gsd_cm,
            captured_on=row.captured_on,
            tile_grid=TileGrid(max_zoom=max_zoom(row.width, row.height)),
            labels_version=row.labels_version,
            job_id=row.job_id,
            created_at=row.created_at,
        )


class GeoMapCreate(BaseModel):
    path: str = Field(min_length=1)
    name: str | None = Field(default=None, min_length=1, max_length=200)


class SurveyBasisOut(BaseModel):
    model_id: str | None
    model_name: str | None
    conf: float


class SurveyClassOut(BaseModel):
    id: str
    name: str
    colour: str


class SurveyOut(BaseModel):
    map_id: str
    map_name: str
    captured_on: date | None
    date_is_import_date: bool
    run_id: str | None
    model_name: str | None
    conf: float | None
    counts: dict[str, int]
    deltas: dict[str, int]
    state: Literal["ok", "not_comparable", "not_counted"]
    reason: str | None


class SurveyTimelineOut(BaseModel):
    """Every survey of this project, oldest first (spec 2026-09-23-survey-timeline section 6)."""

    basis: SurveyBasisOut | None
    classes: list[SurveyClassOut]
    surveys: list[SurveyOut]


class GeoMapPatch(BaseModel):
    """Only the survey date is editable; the operator corrects it by hand."""

    captured_on: date | None = None


class GeoMapWithJob(BaseModel):
    map: GeoMapOut
    job: JobOut


class GeoMapList(BaseModel):
    items: list[GeoMapOut]


class MapRunCreate(BaseModel):
    map_id: str
    kind: QueryRunKind
    model_id: str | None = None
    provider: ProviderName | None = None
    query: str | None = Field(default=None, min_length=1)
    tile_size: int = Field(default=1280, ge=256, le=4096)
    overlap: float = Field(default=0.2, ge=0, le=0.5)
    nms_iou: float = Field(default=0.5, ge=0, le=1)
    conf: float = Field(default=0.25, ge=0, le=1)
    target_gsd_cm: float | None = Field(default=None, gt=0)


class MapRunOut(BaseModel):
    id: str
    map_id: str
    kind: QueryRunKind
    model_id: str | None
    provider: str | None
    model_name: str | None
    query: str
    tile_size: int
    overlap: float
    nms_iou: float
    conf: float
    target_gsd_cm: float | None
    job_id: str | None
    state: Literal["queued", "running", "succeeded", "failed", "cancelled"] | None
    counts: dict[str, int]
    detection_count: int
    created_at: datetime

    @classmethod
    def from_row(cls, row: MapRun, state: str | None, detection_count: int) -> MapRunOut:
        return cls(
            id=row.id,
            map_id=row.map_id,
            kind=row.kind,
            model_id=row.model_id,
            provider=row.provider,
            model_name=row.model_name,
            query=row.query or "",
            tile_size=row.tile_size,
            overlap=row.overlap,
            nms_iou=row.nms_iou,
            conf=row.conf,
            target_gsd_cm=row.target_gsd_cm,
            job_id=row.job_id,
            state=state,
            counts=row.counts or {},
            detection_count=detection_count,
            created_at=row.created_at,
        )


class MapRunWithJob(BaseModel):
    run: MapRunOut
    job: JobOut


class MapRunList(BaseModel):
    items: list[MapRunOut]


class MapRunEstimate(BaseModel):
    windows: int
    skipped_windows: int
    requests: int
    scale: float
    cost_per_request: float
    estimated_cost: float


class MapDetectionOut(BaseModel):
    id: str
    class_id: str
    confidence: float
    x: float
    y: float
    w: float
    h: float
    angle: float | None

    @classmethod
    def from_row(cls, r: MapDetection) -> MapDetectionOut:
        return cls(
            id=r.id, class_id=r.class_id, confidence=r.confidence, x=r.x, y=r.y, w=r.w, h=r.h, angle=r.angle
        )


class MapDetectionPage(BaseModel):
    items: list[MapDetectionOut]
    truncated: bool


class MapDensityCell(BaseModel):
    gx: int
    gy: int
    class_id: str
    count: int


class MapDensity(BaseModel):
    cell_size: float
    cells: list[MapDensityCell]


Point = list[float]


class MapZoneOut(BaseModel):
    id: str
    map_id: str
    name: str
    polygon: list[Point]

    @classmethod
    def from_row(cls, r: MapZone) -> MapZoneOut:
        return cls(id=r.id, map_id=r.map_id, name=r.name, polygon=r.polygon)


class MapZoneCreate(BaseModel):
    name: str = Field(min_length=1, max_length=100)
    polygon: list[Point] = Field(min_length=3, max_length=1000)


class MapZoneUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=100)
    polygon: list[Point] | None = Field(default=None, min_length=3, max_length=1000)


class MapZoneList(BaseModel):
    items: list[MapZoneOut]


class MapLabelOut(BaseModel):
    id: str
    map_id: str
    class_id: str
    x: float
    y: float
    w: float
    h: float
    angle: float | None
    source: str
    created_at: datetime
    updated_at: datetime

    @classmethod
    def from_row(cls, r: MapLabel) -> MapLabelOut:
        return cls(
            id=r.id,
            map_id=r.map_id,
            class_id=r.class_id,
            x=r.x,
            y=r.y,
            w=r.w,
            h=r.h,
            angle=r.angle,
            source=r.source,
            created_at=r.created_at,
            updated_at=r.updated_at,
        )


class MapLabelCreate(BaseModel):
    class_id: str
    x: float = Field(ge=0)
    y: float = Field(ge=0)
    w: float = Field(gt=0)
    h: float = Field(gt=0)


class MapLabelUpdate(BaseModel):
    class_id: str | None = None
    x: float | None = Field(default=None, ge=0)
    y: float | None = Field(default=None, ge=0)
    w: float | None = Field(default=None, gt=0)
    h: float | None = Field(default=None, gt=0)


class MapLabelList(BaseModel):
    items: list[MapLabelOut]


class MapLabelSeed(BaseModel):
    run_id: str
    zone_id: str
    min_conf: float = Field(default=0.25, ge=0, le=1)


class MapLabelSeedResult(BaseModel):
    created: int


class MapScoreRow(BaseModel):
    class_id: str | None
    tp: int
    fp: int
    fn: int
    precision: float | None
    recall: float | None
    f1: float | None
    predicted: int
    actual: int
    count_error: int
    count_error_pct: float | None


class MapScoreZoneRow(MapScoreRow):
    zone_id: str


class MapScoreMatch(BaseModel):
    kind: Literal["detection", "label"]
    id: str
    match: Literal["tp", "fp", "fn"]
    zone_id: str
    class_id: str
    x: float
    y: float
    w: float
    h: float


class MapScoreOut(BaseModel):
    run_id: str
    iou: float
    labels_version: int
    has_zones: bool
    overall: MapScoreRow
    per_class: list[MapScoreRow]
    per_zone: list[MapScoreZoneRow]
    matches: list[MapScoreMatch]


class MapExportRequest(BaseModel):
    map_id: str
    content: Literal["run", "labels", "run_score"]
    run_id: str | None = None
    formats: list[Literal["geojson", "gpkg", "csv"]] = Field(min_length=1)
