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
