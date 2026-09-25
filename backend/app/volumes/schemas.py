"""Pydantic models for the volume operations, matching contract/openapi.yaml (spec §11.2).

`VolumeResults` and its parts forbid extra keys, so drift between the job's dict and the contract
fails loudly (spec §11.2); `inputs` stays free-form."""

from __future__ import annotations

from datetime import date, datetime
from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field

from app.jobs.schemas import JobOut
from app.surfaces.schemas import SurfaceKind, SurfaceMethod

VolumeStatus = Literal["calculating", "ready", "failed", "stale"]
VolumeBaseKind = Literal["toe_plane", "toe_surface", "flat", "surface"]
ExclusionMode = Literal["patch", "exclude"]
Point = Annotated[list[float], Field(min_length=2, max_length=2)]
VolumeRing = Annotated[list[Point], Field(min_length=3, max_length=5000)]
WarningCode = Literal[
    "nodata_high",
    "patch_too_large",
    "patch_failed",
    "edge_coverage_low",
    "base_fit_poor",
    "stable_area_small",
    "no_stable_area",
    "alignment_offset",
    "alignment_datum",
    "alignment_noisy",
    "alignment_tilt",
    "mask_other_flight",
]


class Strict(BaseModel):
    model_config = ConfigDict(extra="forbid")


class VolumeBase(BaseModel):
    kind: VolumeBaseKind
    z: float | None = None
    surface_id: str | None = None


class ExclusionPolygon(BaseModel):
    id: str
    ring: VolumeRing
    mode: ExclusionMode


class VolumeMasks(BaseModel):
    detection_run_ids: list[str]
    class_ids: list[str] | None
    buffer_m: float = Field(ge=0, le=5)
    exclusion_polygons: list[ExclusionPolygon]


class VolumeMasksInput(BaseModel):
    detection_run_ids: list[str] | None = None
    class_ids: list[str] | None = None
    buffer_m: float | None = Field(default=None, ge=0, le=5)
    exclusion_polygons: list[ExclusionPolygon] | None = None


class AlignmentMeasured(Strict):
    n_cells: int
    median_dz: float
    mad: float
    sigma: float
    tilt_mm_per_m: float
    span_m: float


class VolumeAlignment(BaseModel):
    stable_polygon: VolumeRing | None
    apply_shift: bool
    measured: AlignmentMeasured | None


class VolumeAlignmentInput(BaseModel):
    stable_polygon: VolumeRing | None = None
    apply_shift: bool | None = None


class VolumeWarning(Strict):
    code: WarningCode
    severity: Literal["warn", "danger"]
    message: str


class VolumeTotals(Strict):
    fill_m3: float
    cut_m3: float
    net_m3: float


class BaseFit(Strict):
    kind: VolumeBaseKind
    samples: int
    rejected: int
    usable_edge_fraction: float
    rms_m: float
    plane: list[float] | None


class VolumeUncertainty(Strict):
    total_m3: float | None
    base_m3: float | None
    alignment_m3: float | None
    cell_size_m3: float | None
    nodata_m3: float | None
    patch_m3: float | None
    complete: bool


class SurfaceRef(Strict):
    id: str
    name: str
    kind: SurfaceKind
    method: SurfaceMethod | None
    cell_size_m: float
    captured_on: date | None
    cloud_file: str | None
    cloud_sha256: str | None


class VolumeResults(Strict):
    fill_m3: float
    cut_m3: float
    net_m3: float
    unshifted: VolumeTotals | None
    area_m2: float
    polygon_area_m2: float
    measured_area_m2: float
    masked_area_m2: float
    excluded_area_m2: float
    nodata_area_m2: float
    cell_size_m: float
    areal_scale_factor: float
    shift_applied_m: float
    alignment: AlignmentMeasured | None
    base_fit: BaseFit | None
    uncertainty: VolumeUncertainty
    warnings: list[VolumeWarning]
    footprints_used: int
    patch_regions: int
    diff_scale_m: float
    top_surface: SurfaceRef
    base_surface: SurfaceRef | None
    inputs: dict
    inputs_fingerprint: str
    engine_version: int
    computed_at: datetime
    duration_s: float


class VolumeMeasurementOut(BaseModel):
    id: str
    name: str
    status: VolumeStatus
    error: str | None
    polygon_native: VolumeRing
    top_surface_id: str
    base: VolumeBase
    masks: VolumeMasks
    alignment: VolumeAlignment
    results: VolumeResults | None
    stale_reasons: list[str]
    job_id: str | None
    created_at: datetime
    updated_at: datetime


class VolumeMeasurementList(BaseModel):
    items: list[VolumeMeasurementOut]


class VolumeMeasurementCreate(BaseModel):
    name: str = Field(min_length=1)
    polygon_native: VolumeRing
    top_surface_id: str
    base: VolumeBase
    masks: VolumeMasksInput | None = None
    alignment: VolumeAlignmentInput | None = None


class VolumeMeasurementPatch(BaseModel):
    name: str | None = Field(default=None, min_length=1)
    polygon_native: VolumeRing | None = None
    top_surface_id: str | None = None
    base: VolumeBase | None = None
    masks: VolumeMasksInput | None = None
    alignment: VolumeAlignmentInput | None = None


class VolumeMeasurementWithJob(BaseModel):
    measurement: VolumeMeasurementOut
    job: JobOut


class VolumeFootprint(BaseModel):
    run_id: str
    detection_id: str
    class_id: str
    ring: VolumeRing


class VolumeFootprints(BaseModel):
    items: list[VolumeFootprint]
    truncated: bool


class VolumeExportRequest(BaseModel):
    measurement_ids: list[str] = Field(min_length=1)
    formats: list[Literal["pdf", "gpkg", "csv", "xlsx"]] = Field(min_length=1)
    title: str | None = Field(default=None, max_length=200)
