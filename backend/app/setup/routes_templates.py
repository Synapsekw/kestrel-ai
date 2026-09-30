"""Project templates (spec 2026-09-30-project-setup sections 5 and 9): 501 until unit U2 rewrites
this module. No prefix: the paths are `/project-templates...`, outside any project.

U2 keeps `router`, replaces the stubs with its handlers and deletes `STUBS` (plan
2026-09-30-setup-u1; ADR 2026-09-26-foundation-contract-lands-before-its-backend).
"""

from fastapi import APIRouter

from app.stubs import add_stubs

router = APIRouter()

# (method, path under the prefix, operationId)
STUBS: list[tuple[str, str, str]] = [
    ("GET", "/project-templates", "listProjectTemplates"),
    ("POST", "/project-templates", "createProjectTemplate"),
    ("PATCH", "/project-templates/{templateId}", "patchProjectTemplate"),
    ("DELETE", "/project-templates/{templateId}", "deleteProjectTemplate"),
]

add_stubs(router, STUBS, project_scoped=False)
