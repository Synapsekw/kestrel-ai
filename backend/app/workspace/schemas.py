"""Workspace request and response bodies (contract/openapi.yaml, M-C0's schemas, is the source of truth)."""

from __future__ import annotations

from datetime import date, datetime
from typing import Any, Literal

from pydantic import BaseModel, Field

from app.projects.service import ProjectHandle
from app.workspace import service
from app.workspace.frame import SiteFrame
from app.workspace.service import Workspace


class SiteFrameOut(BaseModel):
    kind: Literal["crs", "local"]
    crs_wkt: str | None
    epsg: int | None
    proj4: str | None
    name: str


class PlannedSurvey(BaseModel):
    date: date
    note: str | None = Field(default=None, max_length=200)


class FrameItems(BaseModel):
    crs: int
    local: int


class MapWorkspaceOut(BaseModel):
    frame: SiteFrameOut
    state: dict[str, Any]
    planned_surveys: list[PlannedSurvey]
    frame_items: FrameItems
    updated_at: datetime


class MapWorkspacePut(BaseModel):
    state: dict[str, Any]
    planned_surveys: list[PlannedSurvey] | None = Field(default=None, max_length=100)


class SiteFrameSet(BaseModel):
    kind: Literal["crs", "local"]
    epsg: int | None = Field(default=None, ge=1024, le=999999)


def frame_out(f: SiteFrame) -> SiteFrameOut:
    return SiteFrameOut(kind=f.kind, crs_wkt=f.crs_wkt, epsg=f.epsg, proj4=f.proj4, name=f.name)


def workspace_out(handle: ProjectHandle, ws: Workspace) -> MapWorkspaceOut:
    with handle.session() as s:
        items = service.frame_items(s)
    return MapWorkspaceOut(
        frame=frame_out(ws.frame),
        state=ws.state,
        planned_surveys=[PlannedSurvey(**p) for p in ws.planned_surveys],
        frame_items=FrameItems(**items),
        updated_at=ws.updated_at,
    )


class WorkspaceLayerOut(BaseModel):
    kind: Literal["map", "surface", "drawing"]
    id: str
    name: str
    group: Literal["base", "elevation", "drawing"]
    status: Literal["importing", "ready", "failed"]
    in_frame: bool
    tile_kind: Literal["map", "surface", "volume_diff", "drawing_raster"] | None
    vector: bool
    version: str
    date: date | None
    date_is_import_date: bool
    footprint_site: list[float] | None
    max_zoom: int | None
    meta: str
    surface_kind: str | None
    elevation_role: Literal["dsm", "dtm"] | None
    drawing_format: Literal["dxf", "pdf", "png", "jpg", "tif", "landxml"] | None
    placed: bool | None


class WorkspaceLayerList(BaseModel):
    frame: SiteFrameOut
    items: list[WorkspaceLayerOut]


class WorkspaceSurveyMapOut(BaseModel):
    id: str
    name: str
    gsd_cm: float | None
    basis_run_id: str | None


class WorkspaceSurveySurfaceOut(BaseModel):
    id: str
    name: str
    kind: str
    elevation_role: Literal["dsm", "dtm"] | None


class WorkspaceSurveyOut(BaseModel):
    date: date
    date_is_import_date: bool
    planned: bool
    note: str | None
    maps: list[WorkspaceSurveyMapOut]
    surfaces: list[WorkspaceSurveySurfaceOut]


class WorkspaceSurveyList(BaseModel):
    items: list[WorkspaceSurveyOut]
