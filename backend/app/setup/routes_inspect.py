"""Drop-folder sorting (spec 2026-09-30-project-setup section 7): 501 until unit U3 rewrites this
module. U3 submits `setup_inspect` on the library handle (index ruling S-R3) and imports its job
module here, which registers the job type."""

from fastapi import APIRouter

from app.stubs import add_stubs

router = APIRouter()

STUBS: list[tuple[str, str, str]] = [("POST", "/setup/inspect", "startSetupInspect")]

add_stubs(router, STUBS, project_scoped=False)
