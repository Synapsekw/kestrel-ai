"""Reports CRUD (spec 2026-09-26-reports section 14): 501 until unit R1 rewrites this module.

R1 keeps `router` and its prefix, replaces the stubs with its handlers and deletes `STUBS`
(plan 2026-09-30-reports-r0 Ruling 1; ADR 2026-09-26-foundation-contract-lands-before-its-backend).
"""

from fastapi import APIRouter

from app.stubs import add_stubs

router = APIRouter(prefix="/projects/{projectId}")

# (method, path under the prefix, operationId)
STUBS: list[tuple[str, str, str]] = [
    ("GET", "/reports", "listReports"),
    ("POST", "/reports", "createReport"),
    ("GET", "/reports/{reportId}", "getReport"),
    ("PATCH", "/reports/{reportId}", "patchReport"),
    ("DELETE", "/reports/{reportId}", "deleteReport"),
    ("POST", "/reports/{reportId}/duplicate", "duplicateReport"),
]

add_stubs(router, STUBS)
