"""API shapes for the plant model operations (contract: AssetModelCatalogue, AssetItemPage,
SiteModelPackageList, SiteScene; spec 2026-10-03-plant-model-generator §10; plan pm-f0 Task 10).

F0 routes only the catalogue. A1 (items), R1 (packages) and S1 (site scene) return these models
from their routes, so the shapes match the contract from the first commit.
"""

from __future__ import annotations

from datetime import datetime
from typing import Any, Literal

from pydantic import BaseModel

from app.asset_models.spec import ItemFlag


class AssetBuilderTypeOut(BaseModel):
    type: str
    family: Literal["structure", "equipment", "building", "civil", "environment", "fallback"]
    doc: str
    default_height_m: float
    params_schema: dict[str, Any]


class AssetModelCatalogueOut(BaseModel):
    types: list[AssetBuilderTypeOut]


class AssetItemRowOut(BaseModel):
    node: str
    tag: str | None
    name: str
    type: str
    area: str | None
    plant_e: float | None
    plant_n: float | None
    site_x: float | None
    site_y: float | None
    lon: float | None
    lat: float | None
    base_el: float | None
    top_el: float | None
    height_source: Literal["drawing", "cloud", "indicative"]
    confidence: Literal["high", "medium", "low"]
    flags: list[ItemFlag]
    source_sheet: str | None
    has_geometry: bool

    @classmethod
    def of(cls, row) -> AssetItemRowOut:
        return cls.model_validate(row, from_attributes=True)


class AssetItemPageOut(BaseModel):
    items: list[AssetItemRowOut]
    next_cursor: str | None


class SiteModelPackageOut(BaseModel):
    id: str
    run_id: str
    n: int
    label: str
    drawing_id: str | None
    region: list[float] | None
    area: str | None
    expected: list[str]
    state: Literal["queued", "running", "done", "failed", "skipped"]
    attempts: int
    usage: dict[str, int]
    item_count: int
    summary: str | None
    started_at: datetime | None
    ended_at: datetime | None

    @classmethod
    def of(cls, row) -> SiteModelPackageOut:
        return cls.model_validate(row, from_attributes=True)


class SiteModelPackageListOut(BaseModel):
    items: list[SiteModelPackageOut]


class SiteSceneCrsOut(BaseModel):
    epsg: int | None
    wkt: str | None


class SiteSceneDatumOut(BaseModel):
    label: str
    el_m: float


class SiteSceneFrameOut(BaseModel):
    crs: SiteSceneCrsOut
    origin_crs: tuple[float, float]
    plant_north_deg: float
    datum: SiteSceneDatumOut


class SiteSceneModelOut(BaseModel):
    id: str
    version: int
    glb_url: str
    csv_url: str
    kind: Literal["asset", "plant"]


class SiteSceneOrthoOut(BaseModel):
    id: str
    name: str
    tile_url_template: str
    bounds_site: tuple[float, float, float, float]
    min_z: int
    max_z: int


class SiteSceneCloudOut(BaseModel):
    id: str
    name: str
    octree_url: str
    crs_epsg: int | None
    same_crs: bool
    z_offset_m: float


class SiteSceneDrawingOut(BaseModel):
    id: str
    name: str
    tile_url_template: str
    bounds_site: tuple[float, float, float, float]


class SiteSceneCountOut(BaseModel):
    count: int
    url: str


class SiteSceneOut(BaseModel):
    frame: SiteSceneFrameOut | None
    model: SiteSceneModelOut | None
    orthos: list[SiteSceneOrthoOut]
    clouds: list[SiteSceneCloudOut]
    drawings: list[SiteSceneDrawingOut]
    photos: SiteSceneCountOut
    findings: SiteSceneCountOut
