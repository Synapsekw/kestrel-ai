"""Pydantic models for the surface operations, matching contract/openapi.yaml (spec §11.2).

Request properties carry no defaults in the contract; the defaults are resolved by the service
(`service.resolve_params`) so that "absent" and "null" can mean different things (despike_m)."""

from __future__ import annotations

from datetime import date, datetime
from typing import Literal

from pydantic import BaseModel, Field

from app.jobs.schemas import JobOut
from app.maps.schemas import TileGrid

SurfaceKind = Literal["cloud_dsm", "design"]
SurfaceStatus = Literal["building", "ready", "failed"]
SurfaceMethod = Literal["median", "mean", "max", "min", "tin", "delaunay", "dem_resample", "dem_copy"]
SurfaceBuildMethod = Literal["median", "mean", "max", "min"]


class SurfaceBuildRequest(BaseModel):
    point_cloud_id: str
    name: str | None = Field(default=None, min_length=1)
    method: SurfaceBuildMethod | None = None
    cell_size_m: float | None = Field(default=None, ge=0.01, le=5.0)
    hole_fill_max_gap_m: float | None = Field(default=None, ge=0, le=10)
    despike_m: float | None = Field(default=None, ge=0.1, le=100)
    z_clip: list[float] | None = Field(default=None, min_length=2, max_length=2)
    drop_noise_classes: bool | None = None
    assume_metres: bool | None = None


class SurfaceBuildParams(BaseModel):
    point_cloud_id: str
    name: str
    method: SurfaceBuildMethod
    cell_size_m: float | None  # null while an auto cell is being chosen
    auto_cell: bool
    hole_fill_max_gap_m: float
    despike_m: float | None
    z_clip: list[float] | None
    drop_noise_classes: bool
    assume_metres: bool


class PointsDropped(BaseModel):
    noise_class: int
    withheld: int
    z_clip: int


class SurfaceBuildStats(BaseModel):
    points_read: int
    points_used: int
    points_dropped: PointsDropped
    density_per_m2: float | None
    spacing_m: float | None
    auto_cell: bool
    cells_valid: int
    cells_despiked: int
    cells_filled: int
    z_p02: float | None
    z_p98: float | None
    reprojected_from_epsg: int | None
    build_s: float


class SurfaceOut(BaseModel):
    id: str
    name: str
    kind: SurfaceKind
    status: SurfaceStatus
    error: str | None
    point_cloud_id: str | None
    design_source: dict | None
    crs_wkt: str | None
    epsg: int | None
    proj4: str | None
    cell_size_m: float | None
    width: int | None
    height: int | None
    geotransform: list[float] | None
    bounds_native: list[float] | None
    z_min: float | None
    z_max: float | None
    coverage_fraction: float | None
    method: SurfaceMethod | None
    build_params: SurfaceBuildParams | None
    stats: SurfaceBuildStats | None
    captured_on: date | None
    map_id: str | None
    tile_grid: TileGrid | None
    measurement_count: int
    job_id: str | None
    created_at: datetime


class SurfaceList(BaseModel):
    items: list[SurfaceOut]


class SurfacePatch(BaseModel):
    name: str | None = Field(default=None, min_length=1)


class SurfaceWithJob(BaseModel):
    surface: SurfaceOut
    job: JobOut


class SurfaceSample(BaseModel):
    x: float
    y: float
    z: float | None
