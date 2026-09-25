"""Design surfaces: inspect, preview and import a DEM, LandXML or DXF (spec 2026-09-23-design-surfaces s12).

Foundation F0 routes every operation as a 501 stub; each S3 unit that lands one removes it from
STUBS (and from `tests/test_contract.py::EXPECTED_STUBS`).
"""

from fastapi import APIRouter

from app.stubs import add_stubs
from app.surfaces.design.jobs import run_design_import  # noqa: F401 - registers `design_import`

router = APIRouter(prefix="/projects/{projectId}", tags=["surfaces"])

STUBS: list[tuple[str, str, str]] = [
    ("POST", "/design-inspections", "createDesignInspection"),
    ("GET", "/design-inspections/{inspectionId}", "getDesignInspection"),
    ("DELETE", "/design-inspections/{inspectionId}", "deleteDesignInspection"),
    (
        "GET",
        "/design-inspections/{inspectionId}/candidates/{candidateId}/thumbnail",
        "getDesignCandidateThumbnail",
    ),
    ("POST", "/design-inspections/{inspectionId}/previews", "createDesignPreview"),
    ("GET", "/design-inspections/{inspectionId}/previews/{previewId}", "getDesignPreview"),
    ("GET", "/design-inspections/{inspectionId}/previews/{previewId}/image", "getDesignPreviewImage"),
    ("POST", "/design-surfaces", "createDesignSurface"),
]

add_stubs(router, STUBS)
