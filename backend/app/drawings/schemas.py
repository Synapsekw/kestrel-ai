"""Pydantic mirror of M-C0's drawing schemas (spec 2026-09-26-map-workspace §8, §12).

Field for field with contract/openapi.yaml (plan task 0 checked it; the contract wins, R1). Request
properties carry no contract default; the Python defaults are the documented "when absent" values.
"""

from __future__ import annotations

from datetime import date, datetime
from typing import Annotated, Literal

from pydantic import BaseModel, Field

from app.jobs.schemas import JobOut
from app.surfaces.design.schemas import LinearUnitT

DrawingFormatT = Literal["dxf", "pdf", "png", "jpg", "tif", "landxml"]
ModelT = Literal["similarity", "affine"]
Pair = Annotated[list[float], Field(min_length=2, max_length=2)]
Six = Annotated[list[float], Field(min_length=6, max_length=6)]
Four = Annotated[list[float], Field(min_length=4, max_length=4)]


class DrawingInspectionCreate(BaseModel):
    path: str = Field(min_length=1)


class DrawingLayerOut(BaseModel):
    name: str
    colour: str = Field(pattern=r"^#[0-9a-fA-F]{6}$")
    entity_count: int = Field(ge=0)
    visible_default: bool


class DrawingPageOut(BaseModel):
    page: int = Field(ge=1)
    width_pt: float
    height_pt: float


class DrawingWarningOut(BaseModel):
    code: str
    message: str


class DrawingEmbeddedOut(BaseModel):
    source: Literal["world_file", "geotiff"]
    crs_wkt: str | None
    epsg: int | None
    transform: Six
    needs_crs: bool


class DrawingInspectionOut(BaseModel):
    id: str
    state: Literal["inspecting", "ready", "failed"]
    error: str | None
    job_id: str
    path: str
    format: DrawingFormatT
    file_size: int
    sha256: str | None
    units: LinearUnitT | None = None
    units_source: str | None = None
    crs_hint: str | None = None
    extent_src: Four | None = None
    layers: list[DrawingLayerOut] = Field(default_factory=list)
    page_count: int | None = None
    pages: list[DrawingPageOut] = Field(default_factory=list, max_length=50)
    width: int | None = None
    height: int | None = None
    embedded: DrawingEmbeddedOut | None = None
    warnings: list[DrawingWarningOut] = Field(default_factory=list)
    created_at: datetime


class DrawingInspectionWithJob(BaseModel):
    inspection: DrawingInspectionOut
    job: JobOut


class DrawingPlacementInput(BaseModel):
    method: Literal["crs", "embedded", "none"]
    crs: str | None = Field(default=None, min_length=1)
    units: LinearUnitT | None = None


class DrawingCreate(BaseModel):
    inspection_id: str
    name: str = Field(min_length=1, max_length=200)
    page: int | None = Field(default=None, ge=1)
    dpi: Literal[100, 150, 200, 300] | None = None
    layers: list[str] | None = None
    placement: DrawingPlacementInput
    captured_on: date | None = None


class GeorefPointOut(BaseModel):
    id: str
    src: Pair
    dst: Pair


class GeorefPointInput(BaseModel):
    id: str | None = None
    src: Pair
    dst: Pair


class GeorefWarningOut(BaseModel):
    code: Literal["rmse_high", "scale_mismatch", "shear"]
    message: str


class DrawingGeorefOut(BaseModel):
    method: Literal["crs", "control_points", "embedded"]
    crs_wkt: str | None
    epsg: int | None
    model: ModelT | None
    points: list[GeorefPointOut] = Field(max_length=12)
    dst_crs_wkt: str | None
    transform: Six
    rmse_m: float | None
    residuals_m: list[float]
    warnings: list[GeorefWarningOut]


class DrawingLayerState(BaseModel):
    hidden_layers: list[str]
    knockout_white: bool


class DrawingOut(BaseModel):
    id: str
    name: str
    format: DrawingFormatT
    kind: Literal["vector", "raster"]
    status: Literal["importing", "ready", "failed"]
    error: str | None
    job_id: str | None
    source_path: str
    source_size: int
    page: int | None
    units: LinearUnitT | None
    width: int | None
    height: int | None
    dpi: int | None
    extent_src: Four | None
    layers: list[DrawingLayerOut]
    georef: DrawingGeorefOut | None
    georef_version: int = Field(ge=0)
    bounds_site: Four | None
    layer_state: DrawingLayerState
    captured_on: date | None
    created_at: datetime
    updated_at: datetime


class DrawingList(BaseModel):
    items: list[DrawingOut]


class DrawingWithJob(BaseModel):
    drawing: DrawingOut
    job: JobOut


class DrawingPatch(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=200)
    layer_state: DrawingLayerState | None = None
    captured_on: date | None = None


class DrawingGeorefPut(BaseModel):
    model: ModelT
    points: list[GeorefPointInput] = Field(min_length=2, max_length=12)
    dst_frame: Literal["site"]


class GeorefFitRequest(BaseModel):
    model: ModelT
    points: list[GeorefPointInput] = Field(min_length=2, max_length=12)
    units: LinearUnitT | None = None


class GeorefFitOut(BaseModel):
    model: ModelT
    transform: Six
    rmse_m: float
    residuals_m: list[float]
    warnings: list[GeorefWarningOut]
    scale: float
    rotation_deg: float


class DrawingPagesCreate(BaseModel):
    """createDrawingPages (plant-model spec §8.1): every chosen page of a PDF, one job."""

    inspection_id: str
    name: str = Field(min_length=1, max_length=200)
    pages: Literal["all"] | Annotated[list[Annotated[int, Field(ge=1)]], Field(min_length=1, max_length=500)]
    dpi: Literal[100, 150, 200, 300] | None = None
    placement: DrawingPlacementInput
    captured_on: date | None = None


class DrawingPagesWithJob(BaseModel):
    drawings: list[DrawingOut]
    job: JobOut


class UnimportedDrawingOut(BaseModel):
    path: str
    name: str
    format: DrawingFormatT
    size: int = Field(ge=0)
    pages: int | None


class UnimportedDrawingList(BaseModel):
    files: list[UnimportedDrawingOut] = Field(max_length=500)
