"""Volume measurements (spec 2026-09-23-volumes §8, §11.1 paths 9-17).

Paths 9-16 are built here (Task 11); `createVolumeExport` stays a 501 stub until Task 13.
"""

from fastapi import APIRouter, Depends, Request, Response
from fastapi import Path as PathParam

from app.errors import AppError
from app.events_util import publish_volumes_changed
from app.jobs.schemas import JobOut
from app.projects.service import ProjectHandle, get_project
from app.stubs import add_stubs
from app.surfaces import service as surfaces
from app.surfaces.grid import open_surface
from app.surfaces.tiles import DIFF_TILES, render_diff_tile
from app.volumes import service
from app.volumes.engine import ring_polygon
from app.volumes.footprints import DISPLAY_LIMIT, FootprintError, footprints_for, usable_runs
from app.volumes.jobs_calc import run_volume_calc  # noqa: F401 - registers `volume_calc`
from app.volumes.jobs_export import run_volume_export  # noqa: F401 - registers `volume_export`
from app.volumes.paths import diff_path
from app.volumes.schemas import (
    VolumeFootprint,
    VolumeFootprints,
    VolumeMeasurementCreate,
    VolumeMeasurementList,
    VolumeMeasurementOut,
    VolumeMeasurementPatch,
    VolumeMeasurementWithJob,
)

router = APIRouter(prefix="/projects/{projectId}", tags=["volumes"])
IMMUTABLE = {"Cache-Control": "private, max-age=31536000, immutable"}


def _submit(request: Request, handle: ProjectHandle, measurement_id: str):
    return request.app.state.jobs.submit(handle, "volume_calc", {"measurement_id": measurement_id})


@router.get("/volumes", response_model=VolumeMeasurementList)
def list_volume_measurements(
    request: Request, handle: ProjectHandle = Depends(get_project)
) -> VolumeMeasurementList:
    items, changed = service.list_measurements(handle)
    if changed:
        publish_volumes_changed(request, handle, changed)
    return VolumeMeasurementList(items=items)


@router.post("/volumes", response_model=VolumeMeasurementWithJob, status_code=202)
def create_volume_measurement(
    body: VolumeMeasurementCreate, request: Request, handle: ProjectHandle = Depends(get_project)
) -> VolumeMeasurementWithJob:
    row = service.create(handle, body)
    try:
        job = _submit(request, handle, row.id)
    except Exception as e:
        service.submit_failed(handle, row.id, e)
        publish_volumes_changed(request, handle, [row.id])
        raise
    out = service.set_job(handle, row.id, job.id)
    publish_volumes_changed(request, handle, [row.id])
    return VolumeMeasurementWithJob(measurement=out, job=JobOut.from_row(job, handle.id))


@router.get("/volumes/{measurementId}", response_model=VolumeMeasurementOut)
def get_volume_measurement(
    measurementId: str,  # noqa: N803
    request: Request,
    handle: ProjectHandle = Depends(get_project),
) -> VolumeMeasurementOut:
    out, turned = service.get_measurement(handle, measurementId)
    if turned:
        publish_volumes_changed(request, handle, [measurementId])
    return out


@router.patch("/volumes/{measurementId}", response_model=VolumeMeasurementOut)
def patch_volume_measurement(
    measurementId: str,  # noqa: N803
    body: VolumeMeasurementPatch,
    request: Request,
    handle: ProjectHandle = Depends(get_project),
) -> VolumeMeasurementOut:
    out = service.patch(handle, measurementId, body)
    publish_volumes_changed(request, handle, [measurementId])
    return out


@router.delete("/volumes/{measurementId}", status_code=204)
def delete_volume_measurement(
    measurementId: str,  # noqa: N803
    request: Request,
    handle: ProjectHandle = Depends(get_project),
) -> Response:
    service.delete(handle, measurementId)
    publish_volumes_changed(request, handle, [measurementId])
    return Response(status_code=204)


@router.post("/volumes/{measurementId}/calculate", response_model=VolumeMeasurementWithJob, status_code=202)
def calculate_volume_measurement(
    measurementId: str,  # noqa: N803
    request: Request,
    handle: ProjectHandle = Depends(get_project),
) -> VolumeMeasurementWithJob:
    out, job = service.start_calculation(
        handle, measurementId, lambda: _submit(request, handle, measurementId)
    )
    publish_volumes_changed(request, handle, [measurementId])
    return VolumeMeasurementWithJob(measurement=out, job=JobOut.from_row(job, handle.id))


@router.get("/volumes/{measurementId}/diff-tiles/{z}/{x}/{y}", response_class=Response)
def get_volume_diff_tile(
    measurementId: str,  # noqa: N803
    z: int = PathParam(ge=0, le=30),
    x: int = PathParam(ge=0),
    y: int = PathParam(ge=0),
    v: str | None = None,
    handle: ProjectHandle = Depends(get_project),
) -> Response:
    out = service.peek(handle, measurementId)
    path = diff_path(handle, measurementId)
    if out.results is None or not path.is_file():
        raise AppError("not_ready", f"{out.name} has no results yet; calculate it first", 409)
    key = (handle.id, measurementId, out.results.computed_at.isoformat(), z, x, y)
    hit = DIFF_TILES.get(key)
    if hit is None:
        # the diff is a crop of the lattice of the top it was computed on, which a later PATCH
        # of top_surface_id does not change
        top = surfaces.grid_spec(surfaces.require_ready(handle, out.results.top_surface.id))
        with open_surface(path) as diff:
            hit = (render_diff_tile(diff, top, out.results.diff_scale_m, z, x, y),)
        DIFF_TILES.put(key, hit)
    if hit[0] is None:
        return Response(status_code=204, headers=IMMUTABLE)
    return Response(hit[0], media_type="image/png", headers=IMMUTABLE)


@router.get("/volumes/{measurementId}/footprints", response_model=VolumeFootprints)
def get_volume_footprints(
    measurementId: str,  # noqa: N803
    handle: ProjectHandle = Depends(get_project),
) -> VolumeFootprints:
    """The same footprints the job masks, for display; runs that cannot be used are skipped here
    (the calculation names them)."""
    out = service.peek(handle, measurementId)
    top = surfaces.require_ready(handle, out.top_surface_id)
    runs = []
    for run_id in out.masks.detection_run_ids:
        try:
            runs += usable_runs(handle, [run_id])
        except FootprintError:
            continue
    if not runs or top.crs_wkt is None:
        return VolumeFootprints(items=[], truncated=False)
    found, truncated = footprints_for(
        handle,
        runs,
        class_ids=out.masks.class_ids,
        buffer_m=out.masks.buffer_m,
        bbox=ring_polygon(out.polygon_native).bounds,
        surface_crs_wkt=top.crs_wkt,
        limit=DISPLAY_LIMIT,
    )
    items = [
        VolumeFootprint(
            run_id=f.run_id,
            detection_id=f.detection_id,
            class_id=f.class_id,
            ring=[list(p) for p in f.polygon.exterior.coords[:-1]],
        )
        for f in found
    ]
    return VolumeFootprints(items=items, truncated=truncated)


STUBS: list[tuple[str, str, str]] = [("POST", "/volume-exports", "createVolumeExport")]  # Task 13

add_stubs(router, STUBS)
