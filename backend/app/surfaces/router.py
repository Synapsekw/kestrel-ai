"""Surfaces (spec 2026-09-23-volumes §8, §11.1 paths 1-8).

Paths 1-5 are built here (Task 9); the tile, ortho-tile and sample routes stay 501 stubs until
Task 10 replaces them. Design-surface imports (S3) have their own router in
`app/surfaces/design/router.py`.
"""

from fastapi import APIRouter, Depends, Request, Response

from app.events_util import publish_surfaces_changed
from app.jobs.schemas import JobOut
from app.projects.service import ProjectHandle, get_project
from app.stubs import add_stubs
from app.surfaces import service
from app.surfaces.jobs_build import run_surface_build  # noqa: F401 - registers `surface_build`
from app.surfaces.schemas import SurfaceBuildRequest, SurfaceList, SurfaceOut, SurfacePatch, SurfaceWithJob

router = APIRouter(prefix="/projects/{projectId}", tags=["surfaces"])


@router.get("/surfaces", response_model=SurfaceList)
def list_surfaces(handle: ProjectHandle = Depends(get_project)) -> SurfaceList:
    return SurfaceList(items=service.list_surfaces(handle))


@router.post("/surfaces", response_model=SurfaceWithJob, status_code=202)
def create_surface(
    body: SurfaceBuildRequest, request: Request, handle: ProjectHandle = Depends(get_project)
) -> SurfaceWithJob:
    row = service.create_surface(handle, body)
    job = request.app.state.jobs.submit(handle, "surface_build", {"surface_id": row.id})
    out = service.set_job(handle, row.id, job.id)
    publish_surfaces_changed(request, handle, [row.id])
    return SurfaceWithJob(surface=out, job=JobOut.from_row(job, handle.id))


@router.get("/surfaces/{surfaceId}", response_model=SurfaceOut)
def get_surface(surfaceId: str, handle: ProjectHandle = Depends(get_project)) -> SurfaceOut:  # noqa: N803
    return service.get_surface(handle, surfaceId)


@router.patch("/surfaces/{surfaceId}", response_model=SurfaceOut)
def patch_surface(
    surfaceId: str,  # noqa: N803
    body: SurfacePatch,
    request: Request,
    handle: ProjectHandle = Depends(get_project),
) -> SurfaceOut:
    out = service.rename(handle, surfaceId, body.name)
    publish_surfaces_changed(request, handle, [surfaceId])
    return out


@router.delete("/surfaces/{surfaceId}", status_code=204)
def delete_surface(
    surfaceId: str,  # noqa: N803
    request: Request,
    handle: ProjectHandle = Depends(get_project),
) -> Response:
    service.delete_surface(handle, surfaceId, request.app.state.jobs.is_live)
    publish_surfaces_changed(request, handle, [surfaceId])
    return Response(status_code=204)


STUBS: list[tuple[str, str, str]] = [
    ("GET", "/surfaces/{surfaceId}/tiles/{z}/{x}/{y}", "getSurfaceTile"),
    ("GET", "/surfaces/{surfaceId}/ortho-tiles/{z}/{x}/{y}", "getSurfaceOrthoTile"),
    ("GET", "/surfaces/{surfaceId}/sample", "getSurfaceSample"),
]

add_stubs(router, STUBS)
