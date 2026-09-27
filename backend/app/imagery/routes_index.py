"""The browser's columnar index and the image-summary repair job (image inspection spec §7.1).

I-C0 routes both operations as 501 stubs; unit I-BX replaces them, deleting each tuple from STUBS
and its EXPECTED_STUBS entry.
"""

from fastapi import APIRouter

from app.imagery.jobs_summary import run_summary_rebuild  # noqa: F401 - registers `summary_rebuild`
from app.stubs import add_stubs

router = APIRouter(prefix="/projects/{projectId}", tags=["images"])

STUBS: list[tuple[str, str, str]] = [
    ("GET", "/images/index", "getImageIndex"),
    ("POST", "/image-summary/rebuild", "rebuildImageSummary"),
]

add_stubs(router, STUBS)
