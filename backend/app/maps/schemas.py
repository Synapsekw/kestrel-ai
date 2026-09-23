"""Pydantic models for GeoTIFF maps, matching contract/openapi.yaml exactly."""

from __future__ import annotations

from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field

from app.db.models import GeoMap
from app.jobs.schemas import JobOut
from app.maps.tiles import TILE, max_zoom


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
            tile_grid=TileGrid(max_zoom=max_zoom(row.width, row.height)),
            labels_version=row.labels_version,
            job_id=row.job_id,
            created_at=row.created_at,
        )


class GeoMapCreate(BaseModel):
    path: str = Field(min_length=1)
    name: str | None = Field(default=None, min_length=1, max_length=200)


class GeoMapWithJob(BaseModel):
    map: GeoMapOut
    job: JobOut


class GeoMapList(BaseModel):
    items: list[GeoMapOut]
