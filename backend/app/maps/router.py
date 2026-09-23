"""GeoTIFF maps: import, tiles, runs, zones, labels, scoring, export (spec 2026-09-22-geotiff-maps).

Operations not built yet are 501 stubs; each task that lands one removes it from STUBS.
"""

import rasterio
from fastapi import APIRouter, Depends, Request, Response
from fastapi import Path as PathParam

from app.jobs.schemas import JobOut
from app.maps import service
from app.maps.jobs_import import run_map_import  # noqa: F401 - registers `map_import`
from app.maps.schemas import GeoMapCreate, GeoMapList, GeoMapOut, GeoMapWithJob
from app.maps.startup import map_dir, map_raster_path
from app.maps.tiles import TILE_CACHE, render_tile
from app.projects.service import ProjectHandle, get_project
from app.stubs import add_stubs

router = APIRouter(prefix="/projects/{projectId}", tags=["maps"])
IMMUTABLE = {"Cache-Control": "private, max-age=31536000, immutable"}


@router.get("/maps", response_model=GeoMapList)
def list_maps(handle: ProjectHandle = Depends(get_project)) -> GeoMapList:
    return GeoMapList(items=[GeoMapOut.from_row(r) for r in service.list_maps(handle)])


@router.post("/maps", response_model=GeoMapWithJob, status_code=202)
def create_map(
    body: GeoMapCreate, request: Request, handle: ProjectHandle = Depends(get_project)
) -> GeoMapWithJob:
    row = service.create_map(handle, body)
    job = request.app.state.jobs.submit(handle, "map_import", {"map_id": row.id, "name": row.name})
    row = service.set_map_job(handle, row.id, job.id)
    return GeoMapWithJob(map=GeoMapOut.from_row(row), job=JobOut.from_row(job, handle.id))


@router.get("/maps/{mapId}", response_model=GeoMapOut)
def get_map(mapId: str, handle: ProjectHandle = Depends(get_project)) -> GeoMapOut:  # noqa: N803
    return GeoMapOut.from_row(service.get_map(handle, mapId))


@router.delete("/maps/{mapId}", status_code=204)
def delete_map(mapId: str, request: Request, handle: ProjectHandle = Depends(get_project)) -> Response:  # noqa: N803
    service.delete_map(handle, mapId, request.app.state.jobs.is_live)
    return Response(status_code=204)


@router.get("/maps/{mapId}/preview", response_class=Response)
def get_map_preview(mapId: str, handle: ProjectHandle = Depends(get_project)) -> Response:  # noqa: N803
    service.require_ready(handle, mapId)
    body = (map_dir(handle, mapId) / "preview.jpg").read_bytes()
    return Response(body, media_type="image/jpeg", headers=IMMUTABLE)


@router.get("/maps/{mapId}/tiles/{z}/{x}/{y}", response_class=Response)
def get_map_tile(
    mapId: str,  # noqa: N803
    z: int = PathParam(ge=0, le=30),
    x: int = PathParam(ge=0),
    y: int = PathParam(ge=0),
    handle: ProjectHandle = Depends(get_project),
) -> Response:
    key = (handle.id, mapId, z, x, y)
    hit = TILE_CACHE.get(key)
    if hit is None:
        row = service.require_ready(handle, mapId)
        with rasterio.open(map_raster_path(handle, mapId)) as src:
            hit = render_tile(src, row.width, row.height, z, x, y)
        if hit is None:
            return Response(status_code=204, headers=IMMUTABLE)
        TILE_CACHE.put(key, hit)
    body, media = hit
    return Response(body, media_type=media, headers=IMMUTABLE)


STUBS: list[tuple[str, str, str]] = [
    ("GET", "/maps/{mapId}/runs", "listMapRuns"),
    ("POST", "/map-runs/estimate", "estimateMapRun"),
    ("POST", "/map-runs", "createMapRun"),
    ("GET", "/map-runs/{runId}", "getMapRun"),
    ("DELETE", "/map-runs/{runId}", "deleteMapRun"),
    ("POST", "/map-runs/{runId}/resume", "resumeMapRun"),
    ("GET", "/map-runs/{runId}/detections", "listMapDetections"),
    ("GET", "/map-runs/{runId}/density", "getMapDensity"),
    ("GET", "/map-runs/{runId}/score", "getMapRunScore"),
    ("GET", "/maps/{mapId}/zones", "listMapZones"),
    ("POST", "/maps/{mapId}/zones", "createMapZone"),
    ("PATCH", "/maps/{mapId}/zones/{zoneId}", "updateMapZone"),
    ("DELETE", "/maps/{mapId}/zones/{zoneId}", "deleteMapZone"),
    ("GET", "/maps/{mapId}/labels", "listMapLabels"),
    ("POST", "/maps/{mapId}/labels", "createMapLabel"),
    ("POST", "/maps/{mapId}/labels/seed", "seedMapLabels"),
    ("PATCH", "/maps/{mapId}/labels/{labelId}", "updateMapLabel"),
    ("DELETE", "/maps/{mapId}/labels/{labelId}", "deleteMapLabel"),
    ("POST", "/map-exports", "createMapExport"),
]

add_stubs(router, STUBS)
