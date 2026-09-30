"""App-wide report templates (spec 2026-09-26-reports §6.2, §14; unit R1).

No prefix: the paths are `/report-templates...`, outside any project (R0's stub docstring, kept).
"""

from typing import Any

from fastapi import APIRouter, Body, Query, Request, Response

from app.pagination import MAX_LIMIT
from app.reports.config_write import parse_body
from app.reports.schemas import (
    ReportTemplate,
    ReportTemplateCreate,
    ReportTemplatePage,
    ReportTemplatePatch,
)
from app.reports.templates import service

router = APIRouter()
NAME_MAX = 120
CODE = "invalid_template"


def _catalogue(request: Request):
    return getattr(request.app.state, "catalogue", None)


def _parse(body: dict[str, Any], *, partial: bool) -> dict[str, Any]:
    """The template fields of `body`, or one 422 with one entry per invalid path (plan R1 Ruling
    P2, final review #1): the shared `parse_body` over R0's `ReportTemplateCreate`/`Patch`."""
    return parse_body(
        ReportTemplatePatch if partial else ReportTemplateCreate,
        body,
        code=CODE,
        message="The template is not valid.",
        text_field="name",
        text_max=NAME_MAX,
        partial=partial,
    )


@router.get("/report-templates", response_model=ReportTemplatePage)
def list_report_templates(
    request: Request,
    limit: int | None = Query(None, ge=1, le=MAX_LIMIT),
    cursor: str | None = None,
) -> ReportTemplatePage:
    items, nxt = service.list_templates(_catalogue(request), cursor=cursor, limit=limit)
    return ReportTemplatePage(items=items, next_cursor=nxt)


@router.post("/report-templates", response_model=ReportTemplate, status_code=201)
def create_report_template(request: Request, body: dict = Body(...)) -> ReportTemplate:
    f = _parse(body, partial=False)
    return service.create_template(
        _catalogue(request), name=f["name"], description=f.get("description"), config=f["config"]
    )


@router.get("/report-templates/{templateId}", response_model=ReportTemplate)
def get_report_template(templateId: str, request: Request) -> ReportTemplate:  # noqa: N803
    return service.get_template(_catalogue(request), templateId)


@router.patch("/report-templates/{templateId}", response_model=ReportTemplate)
def patch_report_template(templateId: str, request: Request, body: dict = Body(...)) -> ReportTemplate:  # noqa: N803
    # 409 built-in, then 503 catalogue down, then 404 unknown id, THEN 422 (final review #2)
    service.require_custom(_catalogue(request), templateId)
    f = _parse(body, partial=True)
    return service.update_template(_catalogue(request), templateId, **f)


@router.delete("/report-templates/{templateId}", status_code=204)
def delete_report_template(templateId: str, request: Request) -> Response:  # noqa: N803
    service.delete_template(_catalogue(request), templateId)
    return Response(status_code=204)
