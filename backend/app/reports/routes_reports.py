"""Reports CRUD and duplicate (spec 2026-09-26-reports §14; unit R1). The config is parsed by hand
so every invalid field comes back as `details.errors[{path, message}]` (plan R1 Ruling 3), on top
of R0's `ReportCreate`/`ReportPatch` body shape (plan R1 Ruling P2).

Keeps R0's `router = APIRouter(prefix="/projects/{projectId}")` line; decorator paths below are
relative to that prefix.
"""

from typing import Any

from fastapi import APIRouter, Body, Depends, Query, Request, Response
from pydantic import ValidationError

from app.errors import AppError
from app.pagination import MAX_LIMIT
from app.projects.service import ProjectHandle, get_project
from app.reports import service
from app.reports.config_write import invalid, parse_config, parse_title, validation_errors
from app.reports.schemas import Report, ReportCreate, ReportPage, ReportPatch

router = APIRouter(prefix="/projects/{projectId}")
CODE = service.CODE


def _catalogue(request: Request):
    return getattr(request.app.state, "catalogue", None)


def _dedup(errors: list[dict]) -> list[dict]:
    """Keep the first message for a path; drop any later one for the same path (improves on the
    templates route, which can list the same path twice with two messages)."""
    seen: set[str] = set()
    out: list[dict] = []
    for e in errors:
        if e["path"] not in seen:
            seen.add(e["path"])
            out.append(e)
    return out


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
    errors: list[dict] = []
    try:
        ReportCreate.model_validate(body)
    except ValidationError as e:
        errors += validation_errors(e)

    title, errs = parse_title(body.get("title"))
    errors += errs
    template_id = body.get("template_id")
    if template_id is not None and not isinstance(template_id, str):
        errors.append({"path": "template_id", "message": "Give a template id."})

    errors = _dedup(errors)
    if errors:
        raise invalid(CODE, "The report is not valid.", errors)
    return service.create_report(handle, _catalogue(request), title=title, template_id=template_id)


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

    errors: list[dict] = []
    try:
        ReportPatch.model_validate(body)
    except ValidationError as e:
        errors += validation_errors(e)

    fields: dict[str, Any] = {}
    if "title" in body:
        fields["title"], errs = parse_title(body["title"])
        errors += errs
    if "config" in body:
        try:
            fields["config"] = parse_config(body["config"], code=CODE)
        except AppError as e:  # its errors already cover the config schema and config_problems
            errors += e.details.get("errors", [])

    errors = _dedup(errors)
    if errors:
        raise invalid(CODE, "The report settings are not valid.", errors)
    return service.patch_report(handle, reportId, **fields)


@router.delete("/reports/{reportId}", status_code=204)
def delete_report(reportId: str, handle: ProjectHandle = Depends(get_project)) -> Response:  # noqa: N803
    service.delete_report(handle, reportId)
    return Response(status_code=204)


@router.post("/reports/{reportId}/duplicate", response_model=Report, status_code=201)
def duplicate_report(reportId: str, handle: ProjectHandle = Depends(get_project)) -> Report:  # noqa: N803
    return service.duplicate_report(handle, reportId)
