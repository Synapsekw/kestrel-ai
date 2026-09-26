"""The findings endpoints (spec 2026-09-26-foundation section 8.3). Comments, attachments and
thumbnails join in plan BC Task 10."""

from datetime import datetime
from typing import Literal

from fastapi import APIRouter, Depends, Query, Request, Response

from app.catalogue import service as catalogue_service
from app.data_items import search
from app.errors import AppError
from app.findings import activity, jobs, query, service
from app.findings.anchors import AnchorIn
from app.findings.schemas import (
    ActivityOut,
    ActivityPage,
    FindingBulk,
    FindingBulkResult,
    FindingCreate,
    FindingDetail,
    FindingOut,
    FindingPage,
    FindingPatch,
    FindingSummary,
)
from app.jobs.schemas import JobOut
from app.projects.service import ProjectHandle, get_project
from app.training.schemas import JobRef

router = APIRouter(prefix="/projects/{projectId}", tags=["findings"])
SEVERITY_VALUES = {str(n) for n in range(1, 10)} | {"none"}

# BK's search (spec section 10.3) gets its findings group from here (plan BK hand-off).
search.register_finding_search(
    lambda s, q, limit: [
        FindingOut.from_row(r).model_dump(mode="json") for r in query.search_findings(s, q, limit)
    ]
)


def _detail(handle: ProjectHandle, finding_id: str) -> FindingDetail:
    row, n_att, n_com = service.get_finding(handle, finding_id)
    return FindingDetail(**FindingOut.from_row(row).model_dump(), attachment_count=n_att, comment_count=n_com)


@router.get("/findings", response_model=FindingPage)
def list_findings(
    handle: ProjectHandle = Depends(get_project),
    status: list[Literal["open", "reviewed", "closed"]] | None = Query(None),
    severity: list[str] | None = Query(None),
    type_id: list[str] | None = Query(None),
    anchor_kind: list[Literal["image", "map", "cloud"]] | None = Query(None),
    data_id: str | None = None,
    image_id: str | None = None,
    created_by: Literal["human", "model"] | None = None,
    q: str | None = Query(None, max_length=200),
    updated_from: datetime | None = None,
    updated_to: datetime | None = None,
    has_location: bool | None = None,
    sort: Literal["-severity", "number", "-updated_at", "type"] = "-severity",
    cursor: str | None = None,
    limit: int | None = Query(None, ge=1),
) -> FindingPage:
    if severity and not set(severity) <= SEVERITY_VALUES:
        raise AppError("validation_error", "severity takes 1-9 or none", 422)
    filters = query.FindingFilters(
        status=status,
        severity=severity,
        type_id=type_id,
        anchor_kind=anchor_kind,
        data_id=data_id,
        image_id=image_id,
        created_by=created_by,
        q=q,
        updated_from=updated_from,
        updated_to=updated_to,
        has_location=has_location,
    )
    with handle.session() as s:
        rows, nxt = query.list_findings(s, filters, sort=sort, cursor=cursor, limit=limit)
        items = [FindingOut.from_row(r) for r in rows]
    return FindingPage(items=items, next_cursor=nxt)


@router.post("/findings", response_model=FindingDetail, status_code=201)
def create_finding(body: FindingCreate, handle: ProjectHandle = Depends(get_project)) -> FindingDetail:
    kw = {
        "type_id": body.type_id,
        "anchor": AnchorIn(**body.anchor.model_dump()),
        "note": body.note,
        "status": body.status,
        "lon": body.lon,
        "lat": body.lat,
    }
    if "severity" in body.model_fields_set:
        kw["severity"] = body.severity
    row = service.create_finding(handle, **kw)
    return FindingDetail(**FindingOut.from_row(row).model_dump(), attachment_count=0, comment_count=0)


@router.get("/findings/summary", response_model=FindingSummary)
def findings_summary(handle: ProjectHandle = Depends(get_project)) -> FindingSummary:
    levels = catalogue_service.scale_levels(handle.catalogue)
    with handle.session() as s:
        return FindingSummary(**query.summary(s, levels=levels))


@router.post("/findings/bulk", response_model=FindingBulkResult)
def bulk_update_findings(
    body: FindingBulk, handle: ProjectHandle = Depends(get_project)
) -> FindingBulkResult:
    with handle.session() as s:
        result = query.bulk(
            s,
            project_id=handle.id,
            catalogue=handle.catalogue,
            ids=body.ids,
            set_fields=body.set.model_dump(exclude_unset=True),
        )
    return FindingBulkResult(**result)


@router.post("/findings/recount", response_model=JobRef, status_code=202)
def recount_findings(request: Request, handle: ProjectHandle = Depends(get_project)) -> JobRef:
    job = jobs.submit_recount(handle, request.app.state.jobs)
    return JobRef(job=JobOut.from_row(job, handle.id))


@router.get("/findings/{findingId}", response_model=FindingDetail)
def get_finding(findingId: str, handle: ProjectHandle = Depends(get_project)) -> FindingDetail:  # noqa: N803
    return _detail(handle, findingId)


@router.patch("/findings/{findingId}", response_model=FindingDetail)
def patch_finding(
    findingId: str,  # noqa: N803
    body: FindingPatch,
    handle: ProjectHandle = Depends(get_project),
) -> FindingDetail:
    fields = body.model_dump(exclude_unset=True)
    if "anchor" in fields:
        fields["anchor"] = body.anchor.model_dump(exclude_unset=True)
    service.patch_finding(handle, findingId, fields)
    return _detail(handle, findingId)


@router.delete("/findings/{findingId}", status_code=204)
def delete_finding(findingId: str, handle: ProjectHandle = Depends(get_project)) -> Response:  # noqa: N803
    service.delete_finding(handle, findingId)
    return Response(status_code=204)


@router.get("/activity", response_model=ActivityPage)
def list_activity(
    handle: ProjectHandle = Depends(get_project),
    subject_id: str | None = None,
    cursor: str | None = None,
    limit: int | None = Query(None, ge=1),
) -> ActivityPage:
    with handle.session() as s:
        rows, nxt = activity.page(s, subject_id=subject_id, cursor=cursor, limit=limit)
        items = [ActivityOut.from_row(a) for a in rows]
    return ActivityPage(items=items, next_cursor=nxt)
