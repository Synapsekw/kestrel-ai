"""Design surfaces (spec 2026-09-23-design-surfaces): inspections, previews and the import."""

from __future__ import annotations

import shutil
import time
from datetime import UTC, datetime
from pathlib import Path

from fastapi import APIRouter, Depends, Request, Response
from fastapi import Path as PathParam
from pyproj import CRS
from pyproj.exceptions import CRSError

from app.errors import AppError, not_found
from app.events_util import publish_surfaces_changed
from app.jobs.schemas import JobOut
from app.projects.service import ProjectHandle, get_project
from app.surfaces.design import detect, store
from app.surfaces.design import jobs as _jobs  # noqa: F401 - registers `design_import`
from app.surfaces.design.schemas import (
    DesignImportOptions,
    DesignInspectionCreate,
    DesignInspectionOut,
    DesignInspectionWithJob,
    DesignPreviewOut,
    DesignPreviewWithJob,
    DesignSurfaceCreate,
)
from app.surfaces.design.targets import target_state
from app.surfaces.schemas import SurfaceWithJob

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
    if store.build_live(req, runner):
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


def _check_options(handle: ProjectHandle, inspection: dict, body: DesignImportOptions) -> dict:
    """The 422s and the target's 409 not_ready of createDesignPreview (spec §12); pyproj only, so
    importing the router stays light."""
    ids = {c["id"] for c in inspection["candidates"]}
    unknown = [c for c in body.candidate_ids if c not in ids]
    if unknown:
        raise AppError("validation_error", f"there is no part {unknown[0]} in this file", 422)
    if len(set(body.candidate_ids)) != len(body.candidate_ids):
        raise AppError("validation_error", "each part can be chosen once", 422)
    if inspection["format"] in ("landxml", "geotiff") and len(body.candidate_ids) != 1:
        raise AppError("validation_error", "choose exactly one surface of this file", 422)
    try:
        CRS.from_user_input(body.source_crs.strip())
    except CRSError as e:
        raise AppError("validation_error", f"the source CRS can't be read: {e}", 422) from None
    if body.target_surface_id:
        state = target_state(handle, body.target_surface_id)
        if state == "not_a_cloud":
            raise AppError(
                "validation_error", f"surface {body.target_surface_id} is not a ready cloud surface", 422
            )
        if state == "not_ready":
            raise AppError(
                "not_ready",
                f"surface {body.target_surface_id} is not ready yet; wait for it or pick another",
                409,
            )
    elif body.cell_size_m is None:
        raise AppError("validation_error", "choose a target cloud surface or a cell size", 422)
    return body.model_dump(mode="json")


def _record_preview_job(pid: str, job_id: str):
    def apply(req: dict) -> dict:
        return {
            **req,
            "latest_preview_id": pid,
            "latest_preview_job_id": job_id,
            "preview_job_ids": [*req.get("preview_job_ids", []), job_id],
        }

    return apply


@router.post(
    "/design-inspections/{inspectionId}/previews", response_model=DesignPreviewWithJob, status_code=202
)
def create_design_preview(
    inspectionId: str,  # noqa: N803
    body: DesignImportOptions,
    request: Request,
    handle: ProjectHandle = Depends(get_project),
) -> DesignPreviewWithJob:
    idir = store.require_inspection(handle, inspectionId)
    inspection = store.read_json(idir / "inspection.json")
    if inspection["state"] != "ready":
        raise AppError(
            "not_ready", "the file has not been read yet, or reading it failed: read it again", 409
        )
    options = _check_options(handle, inspection, body)
    runner = request.app.state.jobs
    req = store.read_json(idir / "request.json")
    if store.build_live(req, runner):
        raise AppError("conflict", "a design surface is being imported from this inspection", 409)
    pid = store.new_id()
    pdir = store.preview_dir(idir, pid)
    # parents=False below the inspection dir (as CandidateWriter): never recreate a deleted inspection.
    try:
        pdir.parent.mkdir(parents=False, exist_ok=True)
        pdir.mkdir(parents=False)
    except FileNotFoundError:
        raise not_found("design inspection", inspectionId) from None
    store.write_json(
        pdir / "preview.json",
        {
            "id": pid,
            "inspection_id": inspectionId,
            "state": "running",
            "error": None,
            "job_id": "",
            "options": options,
            "output": None,
            "triangle_count": None,
            "overlap_fraction": None,
            "target_covered_fraction": None,
            "design_area_m2": None,
            "z_check": None,
            "warnings": [],
            "suggestions": [],
            "created_at": datetime.now(UTC).isoformat(),
        },
    )
    job = runner.submit(
        handle,
        "design_import",
        {"phase": "preview", "inspection_id": inspectionId, "preview_id": pid, "options": options},
    )
    # A fresh read under the store lock, not the `req` read above: two previews posted together must
    # both land in preview_job_ids (so deleting the inspection cancels both).
    recorded = store.update_json(idir / "request.json", _record_preview_job(pid, job.id))
    # Only the newest preview is shown (spec §4.2): cancel every other live preview job, not just the
    # previous latest, so concurrent POSTs never leave an older one running.
    for other in (recorded or {}).get("preview_job_ids", []):
        if other != job.id and runner.is_live(other):
            runner.cancel(handle, other)
    preview = store.patch_json(pdir / "preview.json", job_id=job.id)
    if preview is None:  # the inspection was deleted meanwhile; its delete cancels the job
        raise not_found("design inspection", inspectionId)
    return DesignPreviewWithJob(preview=DesignPreviewOut(**preview), job=JobOut.from_row(job, handle.id))


@router.get("/design-inspections/{inspectionId}/previews/{previewId}", response_model=DesignPreviewOut)
def get_design_preview(
    inspectionId: str,  # noqa: N803
    previewId: str,  # noqa: N803
    handle: ProjectHandle = Depends(get_project),
) -> DesignPreviewOut:
    pdir = store.require_preview(store.require_inspection(handle, inspectionId), previewId)
    return DesignPreviewOut(**store.read_json(pdir / "preview.json"))


@router.get("/design-inspections/{inspectionId}/previews/{previewId}/image", response_class=Response)
def get_design_preview_image(
    inspectionId: str,  # noqa: N803
    previewId: str,  # noqa: N803
    handle: ProjectHandle = Depends(get_project),
) -> Response:
    pdir = store.require_preview(store.require_inspection(handle, inspectionId), previewId)
    png = pdir / "preview.png"
    if store.read_json(pdir / "preview.json")["state"] != "ready" or not png.is_file():
        return Response(status_code=204)
    return Response(
        png.read_bytes(), media_type="image/png", headers={"Cache-Control": "private, max-age=3600"}
    )


@router.post("/design-surfaces", response_model=SurfaceWithJob, status_code=202)
def create_design_surface(
    body: DesignSurfaceCreate, request: Request, handle: ProjectHandle = Depends(get_project)
) -> SurfaceWithJob:
    # Imported here: the build module pulls in rasterio and scipy, which the router must not need to load.
    from app.surfaces import service
    from app.surfaces.design import phase_build

    def changed(ids: list[str]) -> None:
        publish_surfaces_changed(request, handle, ids)

    surface_id, job = phase_build.create(handle, request.app.state.jobs, body, surfaces_changed=changed)
    out = service.set_job(handle, surface_id, job.id)
    changed([surface_id])  # the list shows the building row at once
    return SurfaceWithJob(surface=out, job=JobOut.from_row(job, handle.id))
