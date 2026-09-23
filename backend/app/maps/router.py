"""GeoTIFF maps: import, tiles, runs, zones, labels, scoring, export (spec 2026-09-22-geotiff-maps)."""

import rasterio
from fastapi import APIRouter, Depends, Query, Request, Response
from fastapi import Path as PathParam

from app.events_util import publish_map_labels_changed_event
from app.jobs.schemas import JobOut
from app.maps import move, service, timeline
from app.maps.jobs_detect import run_map_detect  # noqa: F401 - registers map_detect
from app.maps.jobs_export import run_map_export  # noqa: F401 - registers `map_export`
from app.maps.jobs_import import run_map_import  # noqa: F401 - registers `map_import`
from app.maps.schemas import (
    GeoMapCreate,
    GeoMapList,
    GeoMapOut,
    GeoMapPatch,
    GeoMapWithJob,
    MapDensity,
    MapDensityCell,
    MapDetectionOut,
    MapDetectionPage,
    MapExportRequest,
    MapLabelCreate,
    MapLabelList,
    MapLabelOut,
    MapLabelSeed,
    MapLabelSeedResult,
    MapLabelUpdate,
    MapMoveRequest,
    MapRunCreate,
    MapRunEstimate,
    MapRunList,
    MapRunOut,
    MapRunWithJob,
    MapScoreOut,
    MapZoneCreate,
    MapZoneList,
    MapZoneOut,
    MapZoneUpdate,
    SurveyBasisOut,
    SurveyClassOut,
    SurveyOut,
    SurveyTimelineOut,
)
from app.maps.startup import map_dir, map_raster_path
from app.maps.tiles import TILE_CACHE, render_tile
from app.projects.kinds import ANY_KIND, require_kind
from app.projects.service import ProjectHandle, get_project
from app.training.schemas import JobRef

router = APIRouter(prefix="/projects/{projectId}", tags=["maps"])
# Maps are detection work; a training project keeps the maps it had before the split readable.
# Declared per route, not per router: `/maps/{mapId}/move` is the one training-only route here.
DETECT_WRITE = [Depends(require_kind(("detect",), ANY_KIND))]
IMMUTABLE = {"Cache-Control": "private, max-age=31536000, immutable"}


@router.get("/maps", response_model=GeoMapList, dependencies=DETECT_WRITE)
def list_maps(handle: ProjectHandle = Depends(get_project)) -> GeoMapList:
    return GeoMapList(items=[GeoMapOut.from_row(r) for r in service.list_maps(handle)])


@router.post("/maps", response_model=GeoMapWithJob, status_code=202, dependencies=DETECT_WRITE)
def create_map(
    body: GeoMapCreate, request: Request, handle: ProjectHandle = Depends(get_project)
) -> GeoMapWithJob:
    row = service.create_map(handle, body)
    job = request.app.state.jobs.submit(handle, "map_import", {"map_id": row.id, "name": row.name})
    row = service.set_map_job(handle, row.id, job.id)
    return GeoMapWithJob(map=GeoMapOut.from_row(row), job=JobOut.from_row(job, handle.id))


@router.get("/survey-timeline", response_model=SurveyTimelineOut, dependencies=DETECT_WRITE)
def get_survey_timeline(
    model_id: str | None = None,
    conf: float | None = None,
    verified_only: bool = False,
    handle: ProjectHandle = Depends(get_project),
) -> SurveyTimelineOut:
    """Counts per class for every survey, with the change since the previous comparable one.
    A pinned run speaks for its survey; `verified_only` counts only verified detections."""
    maps, runs_by_map = service.timeline_rows(handle)
    all_runs = [r for rs in runs_by_map.values() for r in rs]
    basis = timeline.choose_basis(all_runs)
    if basis and (model_id is not None or conf is not None):
        wanted_id = model_id if model_id is not None else basis.model_id
        named = next((r for r in all_runs if r.model_id == wanted_id), None)
        basis = timeline.Basis(
            model_id=wanted_id,
            model_name=named.model_name if named else basis.model_name,
            conf=conf if conf is not None else basis.conf,
        )
    with handle.session() as s:
        classes = [
            SurveyClassOut(id=c["id"], name=c["name"], colour=c["colour"]) for c in handle.row(s).classes
        ]
    surveys = timeline.build_timeline(maps, runs_by_map, basis, verified_only=verified_only)
    return SurveyTimelineOut(
        basis=SurveyBasisOut(**vars(basis)) if basis else None,
        classes=classes,
        surveys=[SurveyOut(**vars(survey)) for survey in surveys],
    )


@router.get("/maps/{mapId}", response_model=GeoMapOut, dependencies=DETECT_WRITE)
def get_map(mapId: str, handle: ProjectHandle = Depends(get_project)) -> GeoMapOut:  # noqa: N803
    return GeoMapOut.from_row(service.get_map(handle, mapId))


@router.patch("/maps/{mapId}", response_model=GeoMapOut, dependencies=DETECT_WRITE)
def patch_map(  # noqa: N803
    mapId: str,
    body: GeoMapPatch,
    handle: ProjectHandle = Depends(get_project),
) -> GeoMapOut:
    return GeoMapOut.from_row(service.set_captured_on(handle, mapId, body.captured_on))


@router.delete("/maps/{mapId}", status_code=204, dependencies=DETECT_WRITE)
def delete_map(mapId: str, request: Request, handle: ProjectHandle = Depends(get_project)) -> Response:  # noqa: N803
    service.delete_map(handle, mapId, request.app.state.jobs.is_live)
    return Response(status_code=204)


@router.post(
    "/maps/{mapId}/move",
    response_model=JobRef,
    status_code=202,
    dependencies=[Depends(require_kind(("train",)))],
)
def move_map(
    mapId: str,  # noqa: N803
    body: MapMoveRequest,
    request: Request,
    handle: ProjectHandle = Depends(get_project),
) -> JobRef:
    """Copy a past map into a detection project; the `map_move` job lives in the target project."""
    target, job = move.submit_move(
        request.app.state.projects, request.app.state.jobs, handle, mapId, body.target_project_id
    )
    return JobRef(job=JobOut.from_row(job, target.id))


@router.get("/maps/{mapId}/preview", response_class=Response, dependencies=DETECT_WRITE)
def get_map_preview(mapId: str, handle: ProjectHandle = Depends(get_project)) -> Response:  # noqa: N803
    service.require_ready(handle, mapId)
    body = (map_dir(handle, mapId) / "preview.jpg").read_bytes()
    return Response(body, media_type="image/jpeg", headers=IMMUTABLE)


@router.get("/maps/{mapId}/tiles/{z}/{x}/{y}", response_class=Response, dependencies=DETECT_WRITE)
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


def _submit_detect(request: Request, handle: ProjectHandle, run_id: str):
    return request.app.state.jobs.submit(handle, "map_detect", {"map_run_id": run_id})


@router.get("/maps/{mapId}/runs", response_model=MapRunList, dependencies=DETECT_WRITE)
def list_map_runs(mapId: str, handle: ProjectHandle = Depends(get_project)) -> MapRunList:  # noqa: N803
    return MapRunList(items=[MapRunOut.from_row(r, st, n) for r, st, n in service.list_runs(handle, mapId)])


@router.post("/map-runs/estimate", response_model=MapRunEstimate, dependencies=DETECT_WRITE)
def estimate_map_run(
    body: MapRunCreate, request: Request, handle: ProjectHandle = Depends(get_project)
) -> MapRunEstimate:
    lib = getattr(request.app.state, "library", None)
    return MapRunEstimate(**service.estimate_run(handle, request.app.state.provider_config, body, lib=lib))


@router.post("/map-runs", response_model=MapRunWithJob, status_code=202, dependencies=DETECT_WRITE)
def create_map_run(
    body: MapRunCreate, request: Request, handle: ProjectHandle = Depends(get_project)
) -> MapRunWithJob:
    lib = getattr(request.app.state, "library", None)
    run = service.create_run(handle, request.app.state.keys, request.app.state.provider_config, body, lib=lib)
    job = _submit_detect(request, handle, run.id)
    run = service.set_run_job(handle, run.id, job.id)
    return MapRunWithJob(run=MapRunOut.from_row(run, job.state, 0), job=JobOut.from_row(job, handle.id))


@router.get("/map-runs/{runId}", response_model=MapRunOut, dependencies=DETECT_WRITE)
def get_map_run(runId: str, handle: ProjectHandle = Depends(get_project)) -> MapRunOut:  # noqa: N803
    return MapRunOut.from_row(*service.get_run(handle, runId))


@router.delete("/map-runs/{runId}", status_code=204, dependencies=DETECT_WRITE)
def delete_map_run(runId: str, request: Request, handle: ProjectHandle = Depends(get_project)) -> Response:  # noqa: N803
    service.delete_run(handle, runId, request.app.state.jobs.is_live)
    return Response(status_code=204)


@router.post("/map-runs/{runId}/resume", response_model=JobRef, status_code=202, dependencies=DETECT_WRITE)
def resume_map_run(runId: str, request: Request, handle: ProjectHandle = Depends(get_project)) -> JobRef:  # noqa: N803
    job = service.resume_run(handle, runId, lambda run: _submit_detect(request, handle, run.id))
    return JobRef(job=JobOut.from_row(job, handle.id))


@router.get("/map-runs/{runId}/detections", response_model=MapDetectionPage, dependencies=DETECT_WRITE)
def list_map_detections(
    runId: str,  # noqa: N803
    bbox: str | None = Query(None, pattern=r"^-?\d+(\.\d+)?,-?\d+(\.\d+)?,-?\d+(\.\d+)?,-?\d+(\.\d+)?$"),
    min_conf: float | None = Query(None, ge=0, le=1),
    class_id: str | None = None,
    handle: ProjectHandle = Depends(get_project),
) -> MapDetectionPage:
    rows, truncated = service.detections_in(handle, runId, bbox, min_conf, class_id)
    return MapDetectionPage(items=[MapDetectionOut.from_row(r) for r in rows], truncated=truncated)


@router.get("/map-runs/{runId}/density", response_model=MapDensity, dependencies=DETECT_WRITE)
def get_map_density(
    runId: str,  # noqa: N803
    cells: int = Query(128, ge=1, le=256),
    min_conf: float | None = Query(None, ge=0, le=1),
    handle: ProjectHandle = Depends(get_project),
) -> MapDensity:
    cell, rows = service.density(handle, runId, cells, min_conf)
    return MapDensity(cell_size=cell, cells=[MapDensityCell(**r) for r in rows])


@router.get("/map-runs/{runId}/score", response_model=MapScoreOut, dependencies=DETECT_WRITE)
def get_map_run_score(
    runId: str,  # noqa: N803
    iou: float = Query(0.5, ge=0.05, le=0.95),
    handle: ProjectHandle = Depends(get_project),
) -> MapScoreOut:
    return MapScoreOut(**service.score_run(handle, runId, iou))


@router.get("/maps/{mapId}/zones", response_model=MapZoneList, dependencies=DETECT_WRITE)
def list_map_zones(mapId: str, handle: ProjectHandle = Depends(get_project)) -> MapZoneList:  # noqa: N803
    return MapZoneList(items=[MapZoneOut.from_row(z) for z in service.list_zones(handle, mapId)])


@router.post("/maps/{mapId}/zones", response_model=MapZoneOut, status_code=201, dependencies=DETECT_WRITE)
def create_map_zone(
    mapId: str, body: MapZoneCreate, request: Request, handle: ProjectHandle = Depends(get_project)
) -> MapZoneOut:  # noqa: N803
    row = service.create_zone(handle, mapId, body)
    publish_map_labels_changed_event(request, handle, mapId)
    return MapZoneOut.from_row(row)


@router.patch("/maps/{mapId}/zones/{zoneId}", response_model=MapZoneOut, dependencies=DETECT_WRITE)
def update_map_zone(
    mapId: str,
    zoneId: str,
    body: MapZoneUpdate,
    request: Request,
    handle: ProjectHandle = Depends(get_project),
) -> MapZoneOut:  # noqa: N803
    row = service.update_zone(handle, mapId, zoneId, body)
    publish_map_labels_changed_event(request, handle, mapId)
    return MapZoneOut.from_row(row)


@router.delete("/maps/{mapId}/zones/{zoneId}", status_code=204, dependencies=DETECT_WRITE)
def delete_map_zone(
    mapId: str, zoneId: str, request: Request, handle: ProjectHandle = Depends(get_project)
) -> Response:  # noqa: N803
    service.delete_zone(handle, mapId, zoneId)
    publish_map_labels_changed_event(request, handle, mapId)
    return Response(status_code=204)


@router.get("/maps/{mapId}/labels", response_model=MapLabelList, dependencies=DETECT_WRITE)
def list_map_labels(mapId: str, handle: ProjectHandle = Depends(get_project)) -> MapLabelList:  # noqa: N803
    return MapLabelList(items=[MapLabelOut.from_row(r) for r in service.list_labels(handle, mapId)])


@router.post("/maps/{mapId}/labels", response_model=MapLabelOut, status_code=201, dependencies=DETECT_WRITE)
def create_map_label(
    mapId: str, body: MapLabelCreate, request: Request, handle: ProjectHandle = Depends(get_project)
) -> MapLabelOut:  # noqa: N803
    row = service.create_label(handle, mapId, body)
    publish_map_labels_changed_event(request, handle, mapId)
    return MapLabelOut.from_row(row)


@router.post("/maps/{mapId}/labels/seed", response_model=MapLabelSeedResult, dependencies=DETECT_WRITE)
def seed_map_labels(
    mapId: str, body: MapLabelSeed, request: Request, handle: ProjectHandle = Depends(get_project)
) -> MapLabelSeedResult:  # noqa: N803
    created = service.seed_labels(handle, mapId, body)
    publish_map_labels_changed_event(request, handle, mapId)
    return MapLabelSeedResult(created=created)


@router.patch("/maps/{mapId}/labels/{labelId}", response_model=MapLabelOut, dependencies=DETECT_WRITE)
def update_map_label(
    mapId: str,
    labelId: str,
    body: MapLabelUpdate,
    request: Request,
    handle: ProjectHandle = Depends(get_project),
) -> MapLabelOut:  # noqa: N803
    row = service.update_label(handle, mapId, labelId, body)
    publish_map_labels_changed_event(request, handle, mapId)
    return MapLabelOut.from_row(row)


@router.delete("/maps/{mapId}/labels/{labelId}", status_code=204, dependencies=DETECT_WRITE)
def delete_map_label(
    mapId: str, labelId: str, request: Request, handle: ProjectHandle = Depends(get_project)
) -> Response:  # noqa: N803
    service.delete_label(handle, mapId, labelId)
    publish_map_labels_changed_event(request, handle, mapId)
    return Response(status_code=204)


@router.post("/map-exports", response_model=JobRef, status_code=202, dependencies=DETECT_WRITE)
def create_map_export(
    body: MapExportRequest, request: Request, handle: ProjectHandle = Depends(get_project)
) -> JobRef:
    gmap = service.validate_export(handle, body)
    job = request.app.state.jobs.submit(handle, "map_export", {**body.model_dump(), "name": gmap.name})
    return JobRef(job=JobOut.from_row(job, handle.id))
