"""Surfaces (spec 2026-09-23-volumes §8, §11.1 paths 1-8).

Design-surface imports (S3) have their own router in `app/surfaces/design/router.py`.
"""

import numpy as np
from fastapi import APIRouter, Depends, Query, Request, Response
from fastapi import Path as PathParam

from app.db.models import GeoMap
from app.errors import AppError, not_found
from app.events_util import publish_surfaces_changed
from app.jobs.schemas import JobOut
from app.maps.startup import map_raster_path
from app.projects.service import ProjectHandle, get_project
from app.surfaces import service
from app.surfaces.grid import open_surface
from app.surfaces.jobs_build import run_surface_build  # noqa: F401 - registers `surface_build`
from app.surfaces.paths import surface_path
from app.surfaces.schemas import (
    SurfaceBuildRequest,
    SurfaceList,
    SurfaceOut,
    SurfacePatch,
    SurfaceSample,
    SurfaceWithJob,
)
from app.surfaces.tiles import SURFACE_TILES, render_hillshade_tile, render_ortho_tile

router = APIRouter(prefix="/projects/{projectId}", tags=["surfaces"])
IMMUTABLE = {"Cache-Control": "private, max-age=31536000, immutable"}


@router.get("/surfaces", response_model=SurfaceList)
def list_surfaces(handle: ProjectHandle = Depends(get_project)) -> SurfaceList:
    return SurfaceList(items=service.list_surfaces(handle))


@router.post("/surfaces", response_model=SurfaceWithJob, status_code=202)
def create_surface(
    body: SurfaceBuildRequest, request: Request, handle: ProjectHandle = Depends(get_project)
) -> SurfaceWithJob:
    row = service.create_surface(handle, body)
    job = request.app.state.jobs.submit(handle, "surface_build", {"surface_id": row.id})
    out = service.set_job(handle, row.id, job.id, created=row)
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


@router.get("/surfaces/{surfaceId}/tiles/{z}/{x}/{y}", response_class=Response)
def get_surface_tile(
    surfaceId: str,  # noqa: N803
    z: int = PathParam(ge=0, le=30),
    x: int = PathParam(ge=0),
    y: int = PathParam(ge=0),
    tint: bool = False,
    handle: ProjectHandle = Depends(get_project),
) -> Response:
    key = (handle.id, surfaceId, "hs", tint, z, x, y)
    hit = SURFACE_TILES.get(key)
    if hit is None:
        row = service.require_ready(handle, surfaceId)
        stats = row.stats or {}
        lo, hi = (stats.get("z_p02"), stats.get("z_p98")) if row.stats else (row.z_min, row.z_max)
        with open_surface(surface_path(handle, surfaceId)) as reader:
            body = render_hillshade_tile(
                reader, z, x, y, tint_range=(lo, hi) if tint and lo is not None else None
            )
        hit = (body, "image/png") if body else (None, None)
        SURFACE_TILES.put(key, hit)
    body, media = hit
    if body is None:
        return Response(status_code=204, headers=IMMUTABLE)
    return Response(body, media_type=media, headers=IMMUTABLE)


@router.get("/surfaces/{surfaceId}/ortho-tiles/{z}/{x}/{y}", response_class=Response)
def get_surface_ortho_tile(
    surfaceId: str,  # noqa: N803
    map_id: str,
    z: int = PathParam(ge=0, le=30),
    x: int = PathParam(ge=0),
    y: int = PathParam(ge=0),
    handle: ProjectHandle = Depends(get_project),
) -> Response:
    key = (handle.id, surfaceId, "ortho", map_id, z, x, y)
    hit = SURFACE_TILES.get(key)
    if hit is None:
        row = service.require_ready(handle, surfaceId)
        with handle.session() as s:
            gmap = s.get(GeoMap, map_id)
            if gmap is None:
                raise not_found("map", map_id)
            if gmap.status != "ready":
                raise AppError("not_ready", f"map {gmap.name} is {gmap.status}, not ready", 409)
            gsd_m = gmap.gsd_cm / 100 if gmap.gsd_cm else None
            map_crs = gmap.crs_wkt
        if not row.crs_wkt or not map_crs:
            raise AppError("no_coordinates", "the map or the surface has no coordinates", 422)
        spec = service.grid_spec(row)
        hit = render_ortho_tile(map_raster_path(handle, map_id), spec, gsd_m, z, x, y) or (None, None)
        SURFACE_TILES.put(key, hit)
    body, media = hit
    if body is None:
        return Response(status_code=204, headers=IMMUTABLE)
    return Response(body, media_type=media, headers=IMMUTABLE)


@router.get("/surfaces/{surfaceId}/sample", response_model=SurfaceSample)
def get_surface_sample(
    surfaceId: str,  # noqa: N803
    x: float = Query(allow_inf_nan=False),
    y: float = Query(allow_inf_nan=False),
    handle: ProjectHandle = Depends(get_project),
) -> SurfaceSample:
    service.require_ready(handle, surfaceId)
    with open_surface(surface_path(handle, surfaceId)) as reader:
        z = float(reader.sample_bilinear(np.array([x]), np.array([y]))[0])
    return SurfaceSample(x=x, y=y, z=z if np.isfinite(z) else None)
