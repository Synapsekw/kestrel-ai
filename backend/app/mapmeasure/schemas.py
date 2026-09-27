"""Map measurement request and response shapes (contract MapMeasurement*; spec
2026-09-26-map-workspace §9.1, §9.2; M-C0 Ruling 18: `vertices`, an area ring open).

Contract rulings (`.superpowers/sdd/2026-09-27-maps-b4/contract-rulings.md`, binding over the
plan):
- C1: `vertices` is always the stored-frame vertices. `vertices_site` is a separate, optional
  field: the same geometry converted to the current site frame, present only on a `?frame=site`
  read whose frame kind matches (never on create or patch). The contract types it as a
  non-nullable array ("only with frame=site"), so `MapMeasurementOut` drops the key entirely
  (never serializes it as `null`) via a wrap serializer rather than a route-level
  `exclude_none`, which would also strip the genuinely-nullable `results` keys.
- C4: distance results carry `dsm_surface_id` (the DSM used for `length_3d_m`, or null).
- C5: profile results have no `step_m` (computed internally, not serialized).
- C6: `ProfileSeries` has no per-series `nodata_fraction` (only the overall `MapMeasurementResults`
  value is serialized).
"""

from __future__ import annotations

from datetime import date, datetime
from typing import Annotated, Literal

from pydantic import BaseModel, Field, SerializerFunctionWrapHandler, model_serializer, model_validator

MapMeasurementKind = Literal["distance", "area", "profile"]
Coord = Annotated[list[Annotated[float, Field(allow_inf_nan=False)]], Field(min_length=2, max_length=2)]
Vertices = Annotated[list[Coord], Field(min_length=2, max_length=5000)]


class MapMeasurementCreate(BaseModel):
    kind: MapMeasurementKind
    vertices: Vertices  # site-frame coordinates (ruling 1)
    surface_ids: list[str] = Field(default_factory=list, max_length=3)
    map_id: str | None = None
    name: str | None = Field(default=None, min_length=1, max_length=200)
    note: str | None = Field(default=None, max_length=2000)

    @model_validator(mode="before")
    @classmethod
    def _note_has_no_null_branch(cls, data):
        """Contract: `MapMeasurementCreate.note` is `type: string` (no `null` branch) - omit it to
        leave it unset, but an explicit `null` is a schema violation, not a no-op."""
        if isinstance(data, dict) and "note" in data and data["note"] is None:
            raise ValueError("note cannot be null; omit it to leave it unset")
        return data


class MapMeasurementPatch(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=200)
    note: str | None = Field(default=None, max_length=2000)
    vertices: Vertices | None = None
    surface_ids: list[str] | None = Field(default=None, max_length=3)

    @model_validator(mode="before")
    @classmethod
    def _reject_empty_body_and_null_fields(cls, data):
        """Contract: `minProperties: 1`, and only `note` carries a `null` branch ("null clears
        it"); `name`, `vertices` and `surface_ids` do not, so an explicit `null` for them is a
        schema violation, not a 200 no-op."""
        if not isinstance(data, dict):
            return data
        if not data:
            raise ValueError("at least one field is required")
        nulled = [f for f in ("name", "vertices", "surface_ids") if f in data and data[f] is None]
        if nulled:
            raise ValueError(f"{', '.join(nulled)} cannot be null")
        return data


class ProfileSeries(BaseModel):
    surface_id: str
    label: str
    date: date | None
    z: list[float | None]


class MapMeasurementResults(BaseModel):
    length_m: float | None = None
    grid_length_m: float | None = None
    scale_factor: float | None = None
    length_3d_m: float | None = None
    nodata_fraction: float | None = None
    dsm_surface_id: str | None = None
    area_m2: float | None = None
    perimeter_m: float | None = None
    grid_area_m2: float | None = None
    grid_perimeter_m: float | None = None
    areal_scale_factor: float | None = None
    stations_m: list[float] | None = None  # listed profile rows carry [] placeholders
    series: list[ProfileSeries] | None = None  # listed profile rows carry [] placeholders
    z_min: float | None = None
    z_max: float | None = None
    cut_area_m2: float | None = None
    fill_area_m2: float | None = None


class MapMeasurementOut(BaseModel):
    id: str
    name: str
    note: str | None
    kind: MapMeasurementKind
    crs_wkt: str | None
    epsg: int | None
    vertices: list[list[float]]
    vertices_site: list[list[float]] | None = None
    surface_ids: list[str]
    map_id: str | None
    results: MapMeasurementResults
    created_at: datetime
    updated_at: datetime

    @model_serializer(mode="wrap")
    def _drop_absent_vertices_site(self, handler: SerializerFunctionWrapHandler) -> dict:
        """`vertices_site` is present only with `?frame=site`; when it does not apply the key is
        absent, not `null` (contract: a non-nullable array). Applies to `model_dump`/
        `model_dump_json` and FastAPI's response serialization alike."""
        data = handler(self)
        if self.vertices_site is None:
            data.pop("vertices_site", None)
        return data


class MapMeasurementPage(BaseModel):
    items: list[MapMeasurementOut]
    next_cursor: str | None
