"""Open a project file with its default application (spec 2026-09-26-reports section 14): 501 until
unit R1 rewrites this module (its launch goes through a seam the test `app` fixture replaces)."""

from fastapi import APIRouter

from app.stubs import add_stubs

router = APIRouter(prefix="/projects/{projectId}")

STUBS: list[tuple[str, str, str]] = [("POST", "/open", "openProjectFile")]

add_stubs(router, STUBS)
