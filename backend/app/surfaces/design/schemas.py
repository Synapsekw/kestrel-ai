"""Pydantic models for the design-surface schemas (spec §12), field for field with the contract.

Request properties carry no contract default; the Python defaults below are the documented
"when absent" values (ADR 2026-09-20 openapi default makes a field required in TypeScript).
"""

from __future__ import annotations

from datetime import datetime
from typing import Annotated, Any, Literal

from pydantic import BaseModel, Field

from app.jobs.schemas import JobOut

LinearUnitT = Literal["millimetre", "centimetre", "metre", "international_foot", "us_survey_foot"]
DesignFormatT = Literal["geotiff", "landxml", "dxf"]
LevelT = Literal["info", "warn", "block"]
CandidateId = Annotated[str, Field(pattern=r"^c[0-9]{1,6}$")]


class DesignInspectionCreate(BaseModel):
    path: str = Field(min_length=1)


class DesignWarningOut(BaseModel):
    code: str
    level: LevelT
    message: str


class DesignRasterInfoOut(BaseModel):
    width: int
    height: int
    cell_x: float
    cell_y: float
    dtype: str
    nodata: float | None
    band_count: int


class DesignCandidateOut(BaseModel):
    id: CandidateId
    kind: Literal["dem", "tin_surface", "dxf_layer"]
    name: str
    geometry: Literal["faces", "points", "raster", "none"]
    bounds_file: list[float] = Field(min_length=4, max_length=4)
    z_min: float | None
    z_max: float | None
    point_count: int
    face_count: int
    entity_counts: dict[str, int]
    default_selected: bool
    notes: list[DesignWarningOut]
    raster: DesignRasterInfoOut | None


class DesignDetectedOut(BaseModel):
    horizontal_unit: LinearUnitT | None
    vertical_unit: LinearUnitT | None
    unit_source: str
    crs_wkt: str | None
    epsg: int | None
    crs_source: str | None
    crs_hint: str | None


class DesignInspectionOut(BaseModel):
    id: str
    state: Literal["inspecting", "ready", "failed"]
    error: str | None
    job_id: str
    path: str
    format: DesignFormatT
    file_size: int
    sha256: str | None
    detected: DesignDetectedOut | None
    candidates: list[DesignCandidateOut]
    default_target_surface_id: str | None
    created_at: datetime


class DesignInspectionWithJob(BaseModel):
    inspection: DesignInspectionOut
    job: JobOut


class DesignImportOptions(BaseModel):
    candidate_ids: list[CandidateId] = Field(min_length=1)
    source_crs: str = Field(min_length=1)
    horizontal_unit: LinearUnitT
    vertical_unit: LinearUnitT
    swap_xy: bool = False
    target_surface_id: str | None = None
    cell_size_m: float | None = Field(None, gt=0)
    max_edge_m: float | None = Field(None, ge=0)


class DesignSuggestionOut(BaseModel):
    code: Literal["swap_xy", "horizontal_unit"]
    message: str
    overlap_fraction: float
    options_patch: dict[str, Any]


class DesignPreviewOutputOut(BaseModel):
    crs_wkt: str
    epsg: int | None
    cell_size_m: float
    width: int
    height: int
    bounds_native: list[float] = Field(min_length=4, max_length=4)
    preview_cell_size_m: float


class DesignZCheckOut(BaseModel):
    median_dz_m: float
    p05_dz_m: float
    p95_dz_m: float
    n_samples: int
    design_z_min_m: float
    design_z_max_m: float


class DesignPreviewOut(BaseModel):
    id: str
    inspection_id: str
    state: Literal["running", "ready", "failed"]
    error: str | None
    job_id: str
    options: DesignImportOptions
    output: DesignPreviewOutputOut | None
    triangle_count: int | None
    overlap_fraction: float | None
    target_covered_fraction: float | None
    design_area_m2: float | None
    z_check: DesignZCheckOut | None
    warnings: list[DesignWarningOut]
    suggestions: list[DesignSuggestionOut]
    created_at: datetime


class DesignPreviewWithJob(BaseModel):
    preview: DesignPreviewOut
    job: JobOut


class DesignSurfaceCreate(BaseModel):
    inspection_id: str
    preview_id: str
    name: str | None = Field(None, min_length=1, max_length=200)
    accept_warnings: bool = False
