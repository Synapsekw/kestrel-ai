"""Site areas and analytics routes (spec 2026-09-23 sections 9.3 and 9.4, plan 2 unit A).

Any project may use these routes (spec 2026-09-26-foundation section 6.1).
"""

from __future__ import annotations

from datetime import date, datetime
from typing import Annotated, Literal

from fastapi import APIRouter, Depends, Query, Request, Response
from pydantic import BaseModel, Field

from app.datasets.schemas import SourceOut
from app.db.models import SiteArea
from app.detect import analytics, site_areas
from app.errors import AppError
from app.projects.service import ProjectHandle, get_project

router = APIRouter(prefix="/projects/{projectId}", tags=["detect"])

LonLat = Annotated[list[float], Field(min_length=2, max_length=2)]
PixelPoint = Annotated[list[float], Field(min_length=2, max_length=2)]
Name = Annotated[str, Field(min_length=1, max_length=200)]


# --- schemas (contract/openapi.yaml is the source of truth) --------------------------------------


class SiteAreaOut(BaseModel):
    id: str
    name: str
    polygon_wgs84: list[list[float]]
    created_at: datetime

    @classmethod
    def from_row(cls, row: SiteArea) -> SiteAreaOut:
        return cls(id=row.id, name=row.name, polygon_wgs84=row.polygon_wgs84, created_at=row.created_at)


class SiteAreaCreate(BaseModel):
    name: Name
    polygon_wgs84: list[LonLat] | None = Field(default=None, min_length=3)
    map_id: str | None = None
    polygon_px: list[PixelPoint] | None = Field(default=None, min_length=3)


class SiteAreaPatch(BaseModel):
    name: Name | None = None
    polygon_wgs84: list[LonLat] | None = Field(default=None, min_length=3)
    map_id: str | None = None
    polygon_px: list[PixelPoint] | None = Field(default=None, min_length=3)


class SiteAreaList(BaseModel):
    items: list[SiteAreaOut]


class AnalyticsSourceOut(SourceOut):
    """`SourceOut` with the detection-workspace fields (spec 2026-09-23 section 7.1)."""

    kind: Literal["images", "map"]
    label: str | None
    captured_on: date | None
    map_id: str | None

    @classmethod
    def from_view(cls, view: analytics.SourceView) -> AnalyticsSourceOut:
        base = SourceOut.from_row(view.row).model_dump()
        base.update(
            kind="map" if view.row.kind == "map" else "images",
            label=view.row.label,
            captured_on=view.row.captured_on,
            map_id=view.map_id,
        )
        return cls(**base)


class ReviewProgressOut(BaseModel):
    total: int
    reviewed: int


class RunSummaryOut(BaseModel):
    id: str
    kind: Literal["images", "map"]
    source_id: str | None
    source_label: str | None
    model_id: str | None
    model_name: str | None
    conf: float
    job_state: str | None
    pinned: bool
    counts: dict[str, int]
    verified_counts: dict[str, int]
    review: ReviewProgressOut
    created_at: datetime

    @classmethod
    def from_summary(cls, r: analytics.RunSummary | None) -> RunSummaryOut | None:
        if r is None:
            return None
        fields = vars(r) | {"review": ReviewProgressOut(**vars(r.review))}
        return cls(**fields)


class ClassCountRowOut(BaseModel):
    class_id: str
    name: str
    colour: str
    total: int
    verified: int


class SourceAnalyticsOut(BaseModel):
    source: AnalyticsSourceOut
    unit: Literal["objects", "detections"]
    image_count: int | None
    run: RunSummaryOut | None
    classes: list[ClassCountRowOut]
    review: ReviewProgressOut


class CountPairOut(BaseModel):
    total: int
    verified: int


class AreaSurveyCellOut(BaseModel):
    partial: bool
    counts: dict[str, CountPairOut]


class AreaRefOut(BaseModel):
    id: str
    name: str


class AreaSurveyOut(BaseModel):
    map_id: str
    map_name: str
    captured_on: date | None
    state: Literal["ok", "not_comparable", "not_counted"]
    per_area: dict[str, AreaSurveyCellOut]


class AreaAnalyticsOut(BaseModel):
    areas: list[AreaRefOut]
    surveys: list[AreaSurveyOut]


class PhotoBatchOut(BaseModel):
    source: AnalyticsSourceOut
    run: RunSummaryOut | None
    classes: list[ClassCountRowOut]


class PhotoBatchAnalyticsOut(BaseModel):
    batches: list[PhotoBatchOut]


def _rows(classes: list[analytics.ClassCount]) -> list[ClassCountRowOut]:
    return [ClassCountRowOut(**vars(c)) for c in classes]


# --- site areas ----------------------------------------------------------------------------------


def _recount(request: Request, handle: ProjectHandle) -> None:
    request.app.state.jobs.submit(handle, site_areas.AREA_RECOUNT_JOB, {})


@router.get("/site-areas", response_model=SiteAreaList)
def list_site_areas(handle: ProjectHandle = Depends(get_project)) -> SiteAreaList:
    return SiteAreaList(items=[SiteAreaOut.from_row(r) for r in site_areas.list_areas(handle)])


@router.post("/site-areas", response_model=SiteAreaOut, status_code=201)
def create_site_area(
    body: SiteAreaCreate, request: Request, handle: ProjectHandle = Depends(get_project)
) -> SiteAreaOut:
    outline = site_areas.outline_wgs84(handle, body.polygon_wgs84, body.map_id, body.polygon_px)
    if outline is None:
        raise AppError(
            "validation_error", "a site area needs an outline: polygon_wgs84, or map_id and polygon_px", 422
        )
    row = site_areas.create_area(handle, body.name, outline)
    _recount(request, handle)
    return SiteAreaOut.from_row(row)


@router.patch("/site-areas/{areaId}", response_model=SiteAreaOut)
def update_site_area(
    areaId: str,  # noqa: N803
    body: SiteAreaPatch,
    request: Request,
    handle: ProjectHandle = Depends(get_project),
) -> SiteAreaOut:
    outline = site_areas.outline_wgs84(handle, body.polygon_wgs84, body.map_id, body.polygon_px)
    row = site_areas.update_area(handle, areaId, body.name, outline)
    if outline is not None:
        _recount(request, handle)
    return SiteAreaOut.from_row(row)


@router.delete("/site-areas/{areaId}", status_code=204)
def delete_site_area(areaId: str, request: Request, handle: ProjectHandle = Depends(get_project)) -> Response:  # noqa: N803
    site_areas.delete_area(handle, areaId)
    _recount(request, handle)
    return Response(status_code=204)


# --- analytics -----------------------------------------------------------------------------------


@router.get("/analytics/sources/{sourceId}", response_model=SourceAnalyticsOut)
def get_source_analytics(sourceId: str, handle: ProjectHandle = Depends(get_project)) -> SourceAnalyticsOut:  # noqa: N803
    a = analytics.source(handle, sourceId)
    return SourceAnalyticsOut(
        source=AnalyticsSourceOut.from_view(a.source),
        unit=a.unit,
        image_count=a.image_count,
        run=RunSummaryOut.from_summary(a.run),
        classes=_rows(a.classes),
        review=ReviewProgressOut(**vars(a.review)),
    )


@router.get("/analytics/areas", response_model=AreaAnalyticsOut)
def get_area_analytics(
    model_id: str | None = None,
    conf: float | None = Query(None, ge=0, le=1),
    verified_only: bool = False,
    handle: ProjectHandle = Depends(get_project),
) -> AreaAnalyticsOut:
    a = analytics.areas(handle, model_id, conf, verified_only)
    return AreaAnalyticsOut(
        areas=[AreaRefOut(id=i, name=n) for i, n in a.areas],
        surveys=[
            AreaSurveyOut(
                map_id=sv.map_id,
                map_name=sv.map_name,
                captured_on=sv.captured_on,
                state=sv.state,
                per_area={
                    aid: AreaSurveyCellOut(
                        partial=cell.partial, counts={c: CountPairOut(**v) for c, v in cell.counts.items()}
                    )
                    for aid, cell in sv.per_area.items()
                },
            )
            for sv in a.surveys
        ],
    )


@router.get("/analytics/photo-batches", response_model=PhotoBatchAnalyticsOut)
def get_photo_batch_analytics(handle: ProjectHandle = Depends(get_project)) -> PhotoBatchAnalyticsOut:
    return PhotoBatchAnalyticsOut(
        batches=[
            PhotoBatchOut(
                source=AnalyticsSourceOut.from_view(b.source),
                run=RunSummaryOut.from_summary(b.run),
                classes=_rows(b.classes),
            )
            for b in analytics.photo_batches(handle)
        ]
    )
