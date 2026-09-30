"""Reports CRUD and duplicate (spec 2026-09-26-reports §14; unit R1). The config is parsed by hand
so every invalid field comes back as `details.errors[{path, message}]` (plan R1 Ruling 3), on top
of R0's `ReportCreate`/`ReportPatch` body shape (plan R1 Ruling P2).

Keeps R0's `router = APIRouter(prefix="/projects/{projectId}")` line; decorator paths below are
relative to that prefix.
"""

from fastapi import APIRouter, Body, Depends, Query, Request, Response

from app.pagination import MAX_LIMIT
from app.projects.service import ProjectHandle, get_project
from app.reports import service
from app.reports.config_write import TITLE_MAX, parse_body
from app.reports.schemas import Report, ReportCreate, ReportPage, ReportPatch

router = APIRouter(prefix="/projects/{projectId}")
CODE = service.CODE


def _catalogue(request: Request):
    return getattr(request.app.state, "catalogue", None)


@router.get("/reports", response_model=ReportPage)
def list_reports(
    include_archived: bool = False,
    limit: int | None = Query(None, ge=1, le=MAX_LIMIT),
    cursor: str | None = None,
    handle: ProjectHandle = Depends(get_project),
) -> ReportPage:
    items, nxt = service.list_reports(handle, include_archived=include_archived, cursor=cursor, limit=limit)
    return ReportPage(items=items, next_cursor=nxt)


@router.post("/reports", response_model=Report, status_code=201)
def create_report(
    request: Request, body: dict = Body(...), handle: ProjectHandle = Depends(get_project)
) -> Report:
    f = parse_body(
        ReportCreate,
        body,
        code=CODE,
        message="The report is not valid.",
        text_field="title",
        text_max=TITLE_MAX,
        partial=False,
    )
    return service.create_report(
        handle, _catalogue(request), title=f["title"], template_id=f.get("template_id")
    )


@router.get("/reports/{reportId}", response_model=Report)
def get_report(reportId: str, handle: ProjectHandle = Depends(get_project)) -> Report:  # noqa: N803
    return service.get_report(handle, reportId)


@router.patch("/reports/{reportId}", response_model=Report)
def patch_report(
    reportId: str,  # noqa: N803
    body: dict = Body(...),
    handle: ProjectHandle = Depends(get_project),
) -> Report:
    service.get_report(handle, reportId)  # 404 before 422 for an unknown report

    fields = parse_body(
        ReportPatch,
        body,
        code=CODE,
        message="The report settings are not valid.",
        text_field="title",
        text_max=TITLE_MAX,
        partial=True,
    )
    return service.patch_report(handle, reportId, **fields)


@router.delete("/reports/{reportId}", status_code=204)
def delete_report(reportId: str, handle: ProjectHandle = Depends(get_project)) -> Response:  # noqa: N803
    service.delete_report(handle, reportId)
    return Response(status_code=204)


@router.post("/reports/{reportId}/duplicate", response_model=Report, status_code=201)
def duplicate_report(reportId: str, handle: ProjectHandle = Depends(get_project)) -> Report:  # noqa: N803
    return service.duplicate_report(handle, reportId)
