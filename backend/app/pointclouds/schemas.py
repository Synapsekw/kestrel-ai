"""Pydantic models for point clouds, matching contract/openapi.yaml exactly (spec §4.2)."""

from __future__ import annotations

from datetime import date, datetime
from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field

from app.db.models import CloudMeasurement, PointCloud
from app.jobs.schemas import JobOut

CloudMeasurementKind = Literal["point", "distance", "height", "vertical", "area", "profile"]
# The kinds `createCloudMeasurement` builds today. C-B1 adds "area" (and `params.method = "rings"`),
# C-B2 added "profile"; until C-B1 lands too, `tests/test_contract.py::BACKEND_PENDING` names the create.
CreatableCloudMeasurementKind = Literal["point", "distance", "height", "vertical", "profile"]
CloudMeasurementStatus = Literal["ready", "computing", "failed"]
CloudViewSubjectKind = Literal["finding", "cloud_measurement"]
Vec3 = Annotated[list[float], Field(min_length=3, max_length=3)]


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
    group: int | None = Field(default=None, ge=0, le=1)  # a rings vertical check: 0 lower, 1 upper


class CloudMeasurementParams(BaseModel):
    model_config = ConfigDict(extra="forbid")

    mode: Literal["surface", "plan"] | None = None
    method: Literal["points", "rings"] | None = None
    thickness_m: float | None = Field(default=None, ge=0.01, le=5)
    max_points: int | None = Field(default=None, ge=1000, le=500_000)
    view_dir: Vec3 | None = None


class CloudMeasurementCreate(BaseModel):
    kind: CreatableCloudMeasurementKind
    points: list[CloudMeasurementPoint] = Field(min_length=1, max_length=2)
    name: str | None = Field(default=None, min_length=1, max_length=200)
    note: str | None = Field(default=None, max_length=2000)
    params: CloudMeasurementParams | None = None


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
    # Point cloud workspace (spec 2026-09-26-point-cloud-workspace section 12 row 6): area and rings
    # (C-B1), profile (C-B2). Null until those units compute them, and for every other kind.
    area_m2: float | None = None
    area_surface_m2: float | None = None
    area_plan_m2: float | None = None
    perimeter_m: float | None = None
    plane_rms_m: float | None = None
    plane_tilt_deg: float | None = None
    plane_azimuth_deg: float | None = None
    uncertainty_m2: float | None = None
    ring_radius_lower_m: float | None = None
    ring_radius_upper_m: float | None = None
    ring_rms_lower_m: float | None = None
    ring_rms_upper_m: float | None = None
    profile_length_m: float | None = None
    profile_z_min: float | None = None
    profile_z_max: float | None = None
    profile_width_max_m: float | None = None
    profile_point_count: int | None = None


class CloudViewPose(BaseModel):
    model_config = ConfigDict(extra="forbid")

    position: Vec3
    target: Vec3
    up: Vec3
    fov_deg: float = Field(gt=0, lt=180)


class CloudClipBox(BaseModel):
    model_config = ConfigDict(extra="forbid")

    centre: Vec3
    size: Annotated[list[Annotated[float, Field(gt=0)]], Field(min_length=3, max_length=3)]
    yaw_deg: float
    mode: Literal["show_inside", "highlight_inside"]


class CloudViewRender(BaseModel):
    model_config = ConfigDict(extra="forbid")

    colour_mode: Literal["rgb", "elevation", "intensity", "classification"]
    point_budget: int = Field(ge=1_000_000, le=8_000_000)
    point_size: float = Field(gt=0, le=10)
    edl: bool
    clip_box: CloudClipBox | None
    complete: bool


class CloudViewOut(BaseModel):
    subject_kind: CloudViewSubjectKind
    subject_id: str
    pose: CloudViewPose
    render: CloudViewRender
    anchor_normal: Vec3 | None
    sha256: str
    bytes: int
    width: int
    height: int
    captured_at: datetime
    stale: bool


class CloudViewMeta(BaseModel):
    """The `meta` part of a view upload (C-B4 parses it from the multipart form)."""

    model_config = ConfigDict(extra="forbid")

    pose: CloudViewPose
    render: CloudViewRender
    anchor_normal: Vec3 | None = None


class CloudViewList(BaseModel):
    items: list[CloudViewOut] = Field(max_length=1500)


class CloudMeasurementOut(BaseModel):
    id: str
    point_cloud_id: str
    kind: CloudMeasurementKind
    name: str
    note: str | None
    points: list[CloudMeasurementPoint]
    results: CloudMeasurementResults
    params: CloudMeasurementParams | None
    status: CloudMeasurementStatus
    error: str | None
    job_id: str | None
    finding_id: str | None
    view: CloudViewOut | None = None
    created_at: datetime
    updated_at: datetime

    @classmethod
    def from_row(cls, row: CloudMeasurement, view: CloudViewOut | None = None) -> CloudMeasurementOut:
        """`view` is the measurement's stored report view: C-B4 passes it, null until then."""
        fields = {name: getattr(row, name) for name in cls.model_fields if name != "view"}
        return cls(**fields, view=view)


class CloudMeasurementList(BaseModel):
    items: list[CloudMeasurementOut]


class CloudMeasurementWithJob(BaseModel):
    measurement: CloudMeasurementOut
    job: JobOut


class PointCloudExportRequest(BaseModel):
    format: Literal["laz"]
    include_measurements: bool = True


class CloudProfile(BaseModel):
    s: list[float]
    z: list[float]
    rgb: list[int] | None  # r, g, b per point (3 x count)
    count: int
    thickness_m: float
    length_m: float


class CloudCameraSource(BaseModel):
    id: str
    label: str
    count: int
    height_offset_m: float
    posed_count: int


class CloudCameraOffsetPut(BaseModel):
    model_config = ConfigDict(extra="forbid")

    height_offset_m: float = Field(ge=-500, le=500)


class CloudCameraSet(BaseModel):
    """Parallel arrays, index i is one camera (spec section 10.1 step 5)."""

    image_id: list[str]
    source_idx: list[int]
    x: list[float]
    y: list[float]
    z: list[float | None]
    yaw: list[float | None]
    pitch: list[float | None]
    roll: list[float | None]
    hfov: list[float]
    vfov: list[float]
    fov_assumed: list[bool]
    width: list[int]
    height: list[int]
    sigma_m: list[float]
    sources: list[CloudCameraSource]
    truncated: bool
    z_p1: float | None
    z_p99: float | None
    without_gps: int = Field(ge=0)
