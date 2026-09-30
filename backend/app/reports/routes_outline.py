"""The live outline and the section block pages (spec 2026-09-26-reports sections 8, 14): 501 until
unit R2 rewrites this module."""

from fastapi import APIRouter

from app.stubs import add_stubs

router = APIRouter(prefix="/projects/{projectId}")

STUBS: list[tuple[str, str, str]] = [
    ("GET", "/reports/{reportId}/outline", "getReportOutline"),
    ("GET", "/reports/{reportId}/sections/{sectionKey}/blocks", "listReportSectionBlocks"),
]

add_stubs(router, STUBS)
