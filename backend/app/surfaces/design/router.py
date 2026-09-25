"""Design surfaces (spec 2026-09-23-design-surfaces): inspections, previews and the import.

Operations not built yet are 501 stubs; the task that lands one removes it from STUBS here and
from EXPECTED_STUBS in tests/test_contract.py.
"""

from __future__ import annotations

import shutil
import time
from pathlib import Path

from fastapi import APIRouter, Depends, Request, Response
from fastapi import Path as PathParam

from app.errors import AppError, not_found
from app.jobs.schemas import JobOut
from app.projects.service import ProjectHandle, get_project
from app.stubs import add_stubs
from app.surfaces.design import detect, store
from app.surfaces.design import jobs as _jobs  # noqa: F401 - registers `design_import`
from app.surfaces.design.schemas import DesignInspectionCreate, DesignInspectionOut, DesignInspectionWithJob

router = APIRouter(prefix="/projects/{projectId}", tags=["surfaces"])
CANDIDATE = r"^c[0-9]{1,6}$"
CANCEL_WAIT_S = 5.0
CANCEL_POLL_S = 0.02


def _wait_until_not_live(runner, job_id: str, timeout: float = CANCEL_WAIT_S) -> None:
    """Block (this is a sync path op, run in FastAPI's thread pool) until the job's own thread has
    fully exited, or `timeout` passes. Root cause (fix round 2): cancelling only sets a flag; the
    job thread keeps running for a little while after, reading/writing files under the inspection
    dir it is about to lose. Deleting that dir with `rmtree(ignore_errors=True)` while the job
    thread still has one of those files open raises a Windows sharing violation on that file,
    which `ignore_errors` swallows, leaving the (non-empty) folder behind. Waiting for
    `runner.is_live` to go False - true only once the job thread's `finally` block has run - closes
    that window; a job stuck past the timeout is swept up later (leftover files are exactly what
    `startup.sweep_interrupted` exists for)."""
    deadline = time.monotonic() + timeout
    while runner.is_live(job_id) and time.monotonic() < deadline:
        time.sleep(CANCEL_POLL_S)


@router.post("/design-inspections", response_model=DesignInspectionWithJob, status_code=202)
def create_design_inspection(
    body: DesignInspectionCreate, request: Request, handle: ProjectHandle = Depends(get_project)
) -> DesignInspectionWithJob:
    source = Path(body.path)
    fmt = detect.classify(source)
    iid = store.new_id()
    idir = store.create_inspection(handle, iid, source, fmt)
    job = request.app.state.jobs.submit(
        handle, "design_import", {"phase": "inspect", "inspection_id": iid, "path": str(source)}
    )
    store.patch_json(idir / "request.json", inspect_job_id=job.id)
    inspection = store.patch_json(idir / "inspection.json", job_id=job.id)
    return DesignInspectionWithJob(
        inspection=DesignInspectionOut(**inspection), job=JobOut.from_row(job, handle.id)
    )


@router.get("/design-inspections/{inspectionId}", response_model=DesignInspectionOut)
def get_design_inspection(
    inspectionId: str, handle: ProjectHandle = Depends(get_project)
) -> DesignInspectionOut:  # noqa: N803
    idir = store.require_inspection(handle, inspectionId)
    return DesignInspectionOut(**store.read_json(idir / "inspection.json"))


@router.delete("/design-inspections/{inspectionId}", status_code=204)
def delete_design_inspection(
    inspectionId: str,  # noqa: N803
    request: Request,
    handle: ProjectHandle = Depends(get_project),
) -> Response:
    idir = store.require_inspection(handle, inspectionId)
    runner = request.app.state.jobs
    req = store.read_json(idir / "request.json")
    if req.get("build_job_id") and runner.is_live(req["build_job_id"]):
        raise AppError("conflict", "a design surface is being imported from this inspection", 409)
    for job_id in store.job_ids(req):
        if runner.is_live(job_id):
            runner.cancel(handle, job_id)
            _wait_until_not_live(runner, job_id)
    shutil.rmtree(idir, ignore_errors=True)  # still live past the wait: best-effort; the sweep ends it
    return Response(status_code=204)


@router.get("/design-inspections/{inspectionId}/candidates/{candidateId}/thumbnail", response_class=Response)
def get_design_candidate_thumbnail(
    inspectionId: str,  # noqa: N803
    candidateId: str = PathParam(pattern=CANDIDATE),  # noqa: N803
    handle: ProjectHandle = Depends(get_project),
) -> Response:
    idir = store.require_inspection(handle, inspectionId)
    insp = store.read_json(idir / "inspection.json")
    if insp["state"] == "failed":
        raise not_found("design candidate", candidateId)
    if insp["state"] == "ready" and candidateId not in {c["id"] for c in insp["candidates"]}:
        raise not_found("design candidate", candidateId)
    thumb = store.thumb_path(idir, candidateId)
    if not thumb.is_file():
        return Response(status_code=204)
    return Response(
        thumb.read_bytes(), media_type="image/png", headers={"Cache-Control": "private, max-age=3600"}
    )


STUBS = [
    ("POST", "/design-inspections/{inspectionId}/previews", "createDesignPreview"),
    ("GET", "/design-inspections/{inspectionId}/previews/{previewId}", "getDesignPreview"),
    ("GET", "/design-inspections/{inspectionId}/previews/{previewId}/image", "getDesignPreviewImage"),
    ("POST", "/design-surfaces", "createDesignSurface"),
]
add_stubs(router, STUBS)
