"""Drawings (spec 2026-09-26-map-workspace §8, §12): inspections, drawings, georef, vector tiles.

Imports stay light (pyproj, pydantic): rasterio, ezdxf, pypdfium2, shapely and scipy load inside
jobs and tile functions, so a broken native stack costs only its own feature (spec §14). The module
loads inside M-C0's maps-guarded block in app/api.py.
"""

from __future__ import annotations

from pathlib import Path

from fastapi import APIRouter, Depends, Request, Response
from fastapi import Path as PathParam

from app.drawings import detect, store
from app.drawings import jobs as _jobs  # noqa: F401 - registers `drawing_import`
from app.drawings.schemas import DrawingInspectionCreate, DrawingInspectionOut, DrawingInspectionWithJob
from app.errors import not_found
from app.jobs.schemas import JobOut
from app.projects.service import ProjectHandle, get_project

router = APIRouter(prefix="/projects/{projectId}", tags=["workspace"])


def _read_or_404(path: Path, what: str, ident: str) -> dict:
    try:
        return store.read_json(path)
    except FileNotFoundError:
        raise not_found(what, ident) from None


@router.post("/drawing-inspections", response_model=DrawingInspectionWithJob, status_code=202)
def create_drawing_inspection(
    body: DrawingInspectionCreate, request: Request, handle: ProjectHandle = Depends(get_project)
) -> DrawingInspectionWithJob:
    source = Path(body.path)
    fmt = detect.classify(source)
    iid = store.new_id()
    idir = store.create_inspection(handle, iid, source, fmt)
    job = request.app.state.jobs.submit(
        handle, "drawing_import", {"phase": "inspect", "inspection_id": iid, "path": str(source)}
    )
    store.patch_json(idir / "request.json", inspect_job_id=job.id)
    inspection = store.patch_json(idir / "inspection.json", job_id=job.id)
    return DrawingInspectionWithJob(
        inspection=DrawingInspectionOut(**inspection), job=JobOut.from_row(job, handle.id)
    )


@router.get("/drawing-inspections/{inspectionId}", response_model=DrawingInspectionOut)
def get_drawing_inspection(
    inspectionId: str,  # noqa: N803
    handle: ProjectHandle = Depends(get_project),
) -> DrawingInspectionOut:
    idir = store.require_inspection(handle, inspectionId)
    return DrawingInspectionOut(**_read_or_404(idir / "inspection.json", "drawing inspection", inspectionId))


@router.get("/drawing-inspections/{inspectionId}/pages/{page}/thumbnail", response_class=Response)
def get_drawing_page_thumbnail(
    inspectionId: str,  # noqa: N803
    page: int = PathParam(ge=1, le=50),
    handle: ProjectHandle = Depends(get_project),
) -> Response:
    """200 PNG; 204 while not ready, after a failure, or past the file's last page (M-C0)."""
    idir = store.require_inspection(handle, inspectionId)
    if _read_or_404(idir / "inspection.json", "drawing inspection", inspectionId)["state"] != "ready":
        return Response(status_code=204)
    thumb = store.page_thumb(idir, page)
    if not thumb.is_file():
        return Response(status_code=204)
    return Response(
        thumb.read_bytes(), media_type="image/png", headers={"Cache-Control": "private, max-age=3600"}
    )
