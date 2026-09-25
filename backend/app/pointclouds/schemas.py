"""Pydantic models for point clouds, matching contract/openapi.yaml exactly (spec §4.2)."""

from __future__ import annotations

from datetime import date, datetime
from typing import Literal

from pydantic import BaseModel, Field

from app.db.models import CloudMeasurement, PointCloud
from app.jobs.schemas import JobOut

CloudMeasurementKind = Literal["point", "distance", "height", "vertical"]


class PointCloudZStats(BaseModel):
    min: float
    max: float
    mean: float
    p01: float
    p1: float
    p5: float
    p50: float
    p95: float
    p99: float
    p999: float
    sample_count: int


class PointCloudOut(BaseModel):
    id: str
    name: str
    status: Literal["importing", "ready", "failed"]
    error: str | None
    source_path: str
    source_size: int
    source_sha256: str | None
    las_version: str | None
    point_format: int | None
    point_count: int | None
    has_rgb: bool | None
    scale: list[float] | None
    crs_wkt: str | None
    epsg: int | None
    proj4: str | None
    vertical_crs: str | None
    crs_source: Literal["file", "assigned"] | None
    bounds_native: list[float] | None
    bounds_repaired: bool | None
    bounds_wgs84: list[float] | None
    octree_spacing_m: float | None
    z_stats: PointCloudZStats | None
    class_counts: dict[str, int] | None
    octree_bytes: int | None
    captured_on: date | None
    map_id: str | None
    job_id: str | None
    created_at: datetime

    @classmethod
    def from_row(cls, row: PointCloud) -> PointCloudOut:
        values = {name: getattr(row, name) for name in cls.model_fields}
        values["source_sha256"] = values["source_sha256"] or None  # "" until the import hashed it
        return cls(**values)


class PointCloudList(BaseModel):
    items: list[PointCloudOut]


class PointCloudCreate(BaseModel):
    path: str = Field(min_length=1)
    name: str | None = Field(default=None, min_length=1, max_length=200)
    map_id: str | None = None


class PointCloudWithJob(BaseModel):
    cloud: PointCloudOut
    job: JobOut


class PointCloudPatch(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=200)
    captured_on: date | None = None
    map_id: str | None = None
    assign_epsg: int | None = None


class PointCloudInspectRequest(BaseModel):
    path: str = Field(min_length=1)


class PointCloudAdmission(BaseModel):
    ok: bool
    ram_needed_bytes: int
    ram_available_bytes: int
    disk_needed_bytes: int
    disk_available_bytes: int
    reason: str | None


class PointCloudFileInfo(BaseModel):
    path: str
    size: int
    compressed: bool
    las_version: str
    point_format: int
    point_count: int
    has_rgb: bool
    header_bounds: list[float]
    crs_wkt: str | None
    epsg: int | None
    captured_on: date | None
    admission: PointCloudAdmission


class CloudMeasurementPoint(BaseModel):
    x: float
    y: float
    z: float
    uncertainty_m: float = Field(ge=0)


class CloudMeasurementCreate(BaseModel):
    kind: CloudMeasurementKind
    points: list[CloudMeasurementPoint] = Field(min_length=1, max_length=2)
    name: str | None = Field(default=None, min_length=1, max_length=200)
    note: str | None = Field(default=None, max_length=2000)


class CloudMeasurementUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=200)
    note: str | None = Field(default=None, max_length=2000)


class CloudMeasurementResults(BaseModel):
    lon: float | None = None
    lat: float | None = None
    dx: float | None = None
    dy: float | None = None
    dz: float | None = None
    distance_3d: float | None = None
    distance_horizontal: float | None = None
    distance_vertical: float | None = None
    height_difference: float | None = None
    lean_offset_m: float | None = None
    lean_angle_deg: float | None = None
    lean_azimuth_deg: float | None = None
    lean_mm_per_m: float | None = None
    uncertainty_m: float | None = None
    angle_uncertainty_deg: float | None = None


class CloudMeasurementOut(BaseModel):
    id: str
    point_cloud_id: str
    kind: CloudMeasurementKind
    name: str
    note: str | None
    points: list[CloudMeasurementPoint]
    results: CloudMeasurementResults
    created_at: datetime
    updated_at: datetime

    @classmethod
    def from_row(cls, row: CloudMeasurement) -> CloudMeasurementOut:
        return cls(**{name: getattr(row, name) for name in cls.model_fields})


class CloudMeasurementList(BaseModel):
    items: list[CloudMeasurementOut]


class PointCloudExportRequest(BaseModel):
    format: Literal["laz"]
    include_measurements: bool = True
