"""The browser's columnar index and the image-summary repair job (image inspection spec §7.1).

I-C0 routes both operations as 501 stubs; unit I-BX replaces them, deleting each tuple from STUBS
and its EXPECTED_STUBS entry. The index (`getImageIndex`) stays a stub until Task 5.
"""

from fastapi import APIRouter, Depends, Request

from app.imagery import jobs_summary
from app.imagery.jobs_summary import run_summary_rebuild  # noqa: F401 - registers `summary_rebuild`
from app.jobs.schemas import JobOut
from app.projects.service import ProjectHandle, get_project
from app.stubs import add_stubs
from app.training.schemas import JobRef

router = APIRouter(prefix="/projects/{projectId}", tags=["images"])

STUBS: list[tuple[str, str, str]] = [
    ("GET", "/images/index", "getImageIndex"),
]

add_stubs(router, STUBS)


@router.post("/image-summary/rebuild", response_model=JobRef, status_code=202)
def rebuild_image_summary(request: Request, handle: ProjectHandle = Depends(get_project)) -> JobRef:
    job = jobs_summary.submit_rebuild(handle, request.app.state.jobs)
    return JobRef(job=JobOut.from_row(job, handle.id))
