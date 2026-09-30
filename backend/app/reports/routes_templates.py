"""App-wide report templates (spec 2026-09-26-reports sections 6.2, 14): 501 until unit R1 rewrites
this module. No prefix: the paths are `/report-templates...`, outside any project."""

from fastapi import APIRouter

from app.stubs import add_stubs

router = APIRouter()

STUBS: list[tuple[str, str, str]] = [
    ("GET", "/report-templates", "listReportTemplates"),
    ("POST", "/report-templates", "createReportTemplate"),
    ("GET", "/report-templates/{templateId}", "getReportTemplate"),
    ("PATCH", "/report-templates/{templateId}", "patchReportTemplate"),
    ("DELETE", "/report-templates/{templateId}", "deleteReportTemplate"),
]

add_stubs(router, STUBS, project_scoped=False)
