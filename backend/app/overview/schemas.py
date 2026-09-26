"""Pydantic shapes of ProjectOverview and ProjectSummary in contract/openapi.yaml."""

from typing import Literal

from pydantic import BaseModel

from app.findings.schemas import FindingSummary


class DataCounts(BaseModel):
    image_sets: int
    images: int
    maps: int
    elevations: int
    point_clouds: int
    drawings: int


class LatestVolume(BaseModel):
    measurement_id: str
    name: str
    net_m3: float | None
    previous_net_m3: float | None  # the previous ready measurement over the same polygon


class Banner(BaseModel):
    kind: str
    tone: Literal["info", "warn", "danger"]
    message: str
    action: str | None = None


class ProjectOverview(BaseModel):
    findings: FindingSummary
    data: DataCounts
    latest_volume: LatestVolume | None
    hero_map_id: str | None
    banners: list[Banner]


class Cover(BaseModel):
    kind: Literal["map", "image"]
    id: str


class ProjectSummary(BaseModel):
    image_count: int
    maps: int
    point_clouds: int
    elevations: int
    open_findings: int
    open_top_severity: int
    cover: Cover | None
