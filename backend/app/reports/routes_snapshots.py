"""Report snapshots (spec 2026-09-26-reports section 9): 501 until unit R3 rewrites this module."""

from fastapi import APIRouter

from app.stubs import add_stubs

router = APIRouter(prefix="/projects/{projectId}")

STUBS: list[tuple[str, str, str]] = [("GET", "/report-snapshots/{snapshotKey}", "getReportSnapshot")]

add_stubs(router, STUBS)
