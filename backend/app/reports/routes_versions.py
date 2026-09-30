"""Renders and versions (spec 2026-09-26-reports sections 6.1, 14): 501 until unit R5 rewrites this
module (and imports its render job there, which registers `report_render`)."""

from fastapi import APIRouter

from app.stubs import add_stubs

router = APIRouter(prefix="/projects/{projectId}")

STUBS: list[tuple[str, str, str]] = [
    ("POST", "/reports/{reportId}/renders", "createReportRender"),
    ("GET", "/reports/{reportId}/versions", "listReportVersions"),
    ("GET", "/reports/{reportId}/versions/{versionNumber}", "getReportVersion"),
    ("PATCH", "/reports/{reportId}/versions/{versionNumber}", "patchReportVersion"),
    ("DELETE", "/reports/{reportId}/versions/{versionNumber}", "deleteReportVersion"),
    ("GET", "/reports/{reportId}/versions/{versionNumber}/document", "getReportVersionDocument"),
]

add_stubs(router, STUBS)
