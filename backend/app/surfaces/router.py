"""Surfaces: build from a cloud, tiles, ortho underlay, sampling (spec 2026-09-23-volumes section 11.1, 1-8).

Foundation F0 routes every operation as a 501 stub; each S2 unit that lands one removes it from
STUBS (and from `tests/test_contract.py::EXPECTED_STUBS`). Design-surface imports (S3) have their
own router in `app/surfaces/design/router.py`.
"""

from fastapi import APIRouter

from app.stubs import add_stubs
from app.surfaces.jobs_build import run_surface_build  # noqa: F401 - registers `surface_build`

router = APIRouter(prefix="/projects/{projectId}", tags=["surfaces"])

STUBS: list[tuple[str, str, str]] = [
    ("GET", "/surfaces", "listSurfaces"),
    ("POST", "/surfaces", "createSurface"),
    ("GET", "/surfaces/{surfaceId}", "getSurface"),
    ("PATCH", "/surfaces/{surfaceId}", "patchSurface"),
    ("DELETE", "/surfaces/{surfaceId}", "deleteSurface"),
    ("GET", "/surfaces/{surfaceId}/tiles/{z}/{x}/{y}", "getSurfaceTile"),
    ("GET", "/surfaces/{surfaceId}/ortho-tiles/{z}/{x}/{y}", "getSurfaceOrthoTile"),
    ("GET", "/surfaces/{surfaceId}/sample", "getSurfaceSample"),
]

add_stubs(router, STUBS)
