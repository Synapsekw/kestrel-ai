"""App-wide report templates (spec 2026-09-26-reports §6.2, §14; unit R1).

No prefix: the paths are `/report-templates...`, outside any project (R0's stub docstring, kept).
"""

from typing import Any

from fastapi import APIRouter, Body, Query, Request, Response
from pydantic import ValidationError

from app.errors import AppError
from app.pagination import MAX_LIMIT
from app.reports.config_write import invalid, parse_config, parse_title, validation_errors
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
    """The template fields of `body`, or one 422 listing every invalid field (plan R1 Ruling P2).

    `body` is validated against R0's `ReportTemplateCreate`/`ReportTemplatePatch` (extra keys
    forbidden, name and description bounds, config shape); that plus the semantic checks the
    schema cannot state - a blank name after stripping, and `config_problems` (plan R1 Ruling 3),
    surfaced here through `parse_config` - land in the same 422. Duplicate `(path, message)`
    entries (the same config field flagged by both the whole-body check and `parse_config`'s own
    re-validation) collapse to one.
    """
    model_cls = ReportTemplatePatch if partial else ReportTemplateCreate
    errors: list[dict] = []
    try:
        model_cls.model_validate(body)
    except ValidationError as e:
        errors += validation_errors(e)

    out: dict[str, Any] = {}
    if not partial or "name" in body:
        out["name"], errs = parse_title(body.get("name"), path="name", max_len=NAME_MAX)
        errors += errs
    if "description" in body:
        out["description"] = body["description"]
    if not partial or "config" in body:
        try:
            out["config"] = parse_config(body.get("config"), code=CODE)
        except AppError as e:  # its errors already cover the config schema and config_problems
            errors += e.details.get("errors", [])

    if errors:
        seen: set[tuple[str, str]] = set()
        deduped: list[dict] = []
        for er in errors:
            key = (er["path"], er["message"])
            if key not in seen:
                seen.add(key)
                deduped.append(er)
        raise invalid(CODE, "The template is not valid.", deduped)
    return out


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
    if templateId in service.BUILTIN_IDS:
        raise service.builtin_template(templateId)
    f = _parse(body, partial=True)
    return service.update_template(_catalogue(request), templateId, **f)


@router.delete("/report-templates/{templateId}", status_code=204)
def delete_report_template(templateId: str, request: Request) -> Response:  # noqa: N803
    service.delete_template(_catalogue(request), templateId)
    return Response(status_code=204)
