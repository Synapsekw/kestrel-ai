"""`POST /setup/inspect` (spec 2026-09-30-project-setup §7.1, index ruling S-R3).

No project exists yet, so the `setup_inspect` job runs on the library handle, where library jobs
run, and is read and cancelled through `/library/jobs/{jobId}`. The paths are not checked here: a
missing or unreadable path is the job's to report under Not recognised (spec §11), so the request
answers at once and never touches the file system.
"""

from fastapi import APIRouter, Depends, Request

from app.jobs.schemas import JobOut
from app.library.handle import LibraryHandle, get_library
from app.setup import inspect_job  # noqa: F401 - the import registers the `setup_inspect` job type
from app.setup.schemas import SetupInspectRequest
from app.training.schemas import JobRef

router = APIRouter(prefix="/setup", tags=["setup"])


@router.post("/inspect", response_model=JobRef, status_code=202)
def start_setup_inspect(
    body: SetupInspectRequest, request: Request, lib: LibraryHandle = Depends(get_library)
) -> JobRef:
    job = request.app.state.jobs.submit(lib, "setup_inspect", body.model_dump(mode="json"))
    return JobRef(job=JobOut.from_row(job, lib.id))
