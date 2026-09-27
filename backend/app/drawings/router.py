"""Drawings (spec 2026-09-26-map-workspace §8, §12): inspections, drawings, georef, vector tiles.

Imports stay light (pyproj, pydantic): rasterio, ezdxf, pypdfium2, shapely and scipy load inside
jobs and tile functions, so a broken native stack costs only its own feature (spec §14). The module
loads inside M-C0's maps-guarded block in app/api.py.
"""

from __future__ import annotations

import json
import shutil
import threading
from pathlib import Path

from fastapi import APIRouter, Depends, Query, Request, Response
from fastapi import Path as PathParam
from sqlalchemy import select

from app.db.base import utcnow
from app.db.models import Drawing
from app.drawings import detect, footprint, service, site, store, vtiles
from app.drawings import georef as fitting
from app.drawings import jobs as _jobs  # noqa: F401 - registers `drawing_import`
from app.drawings import placement as placing
from app.drawings.placement import VECTOR
from app.drawings.schemas import (
    DrawingCreate,
    DrawingGeorefPut,
    DrawingInspectionCreate,
    DrawingInspectionOut,
    DrawingInspectionWithJob,
    DrawingList,
    DrawingOut,
    DrawingPatch,
    DrawingWithJob,
    GeorefFitOut,
    GeorefFitRequest,
)
from app.errors import AppError, not_found
from app.events_util import publish_drawings_changed
from app.jobs.schemas import JobOut
from app.projects.service import ProjectHandle, get_project
from app.surfaces.design.units import unit_to_m

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


_BUILD_LOCK = threading.Lock()  # no second build of an inspection between the live check and the submit


@router.get("/drawings", response_model=DrawingList)
def list_drawings(handle: ProjectHandle = Depends(get_project)) -> DrawingList:
    frame = footprint.frame_or_none(handle)
    with handle.session() as s:
        rows = s.execute(select(Drawing).order_by(Drawing.created_at.desc(), Drawing.id)).scalars().all()
        return DrawingList(items=[service.to_out(r, frame) for r in rows])


@router.post("/drawings", response_model=DrawingWithJob, status_code=202)
def create_drawing(
    body: DrawingCreate, request: Request, handle: ProjectHandle = Depends(get_project)
) -> DrawingWithJob:
    idir = store.require_inspection(handle, body.inspection_id)
    insp = _read_or_404(idir / "inspection.json", "drawing inspection", body.inspection_id)
    if insp["state"] != "ready":
        message = (
            "the file is still being read"
            if insp["state"] == "inspecting"
            else "reading the file failed; choose it again"
        )
        raise AppError("not_ready", message, 409)
    params = placing.check(insp, body, idir)
    chosen = params["layers"]
    runner = request.app.state.jobs
    with _BUILD_LOCK:
        req = _read_or_404(idir / "request.json", "drawing inspection", body.inspection_id)
        live = next((j for j in req.get("build_job_ids", []) if runner.is_live(j)), None)
        if live is not None:
            raise AppError("job_running", "a drawing is being imported from this file", 409, {"job_id": live})
        with handle.session() as s:
            row = Drawing(
                name=body.name.strip() or Path(insp["path"]).stem,
                format=insp["format"],
                source_path=insp["path"],
                source_size=insp["file_size"],
                source_sha256=insp["sha256"],
                page=params["page"],
                status="importing",
                units=params["placement"]["units"] or insp.get("units"),
                dpi=params["dpi"],
                extent_src=insp.get("extent_src"),
                layers=[la for la in insp.get("layers", []) if chosen is None or la["name"] in chosen],
                georef=None,
                georef_version=0,
                bounds_site=None,
                layer_state={"hidden_layers": [], "knockout_white": False},
                captured_on=body.captured_on,
            )
            s.add(row)
            s.flush()
            did = row.id
        job = runner.submit(
            handle,
            "drawing_import",
            {"phase": "build", "drawing_id": did, "inspection_id": body.inspection_id, **params},
        )
        store.patch_json(idir / "request.json", build_job_ids=[*req.get("build_job_ids", []), job.id])
    with handle.session() as s:
        row = service.require(s, did)
        row.job_id = job.id
        out = service.to_out(row, None)
    publish_drawings_changed(request, handle, [did])
    return DrawingWithJob(drawing=out, job=JobOut.from_row(job, handle.id))


@router.get("/drawings/{drawingId}", response_model=DrawingOut)
def get_drawing(drawingId: str, handle: ProjectHandle = Depends(get_project)) -> DrawingOut:  # noqa: N803
    frame = footprint.frame_or_none(handle)
    with handle.session() as s:
        return service.to_out(service.require(s, drawingId), frame)


@router.patch("/drawings/{drawingId}", response_model=DrawingOut)
def patch_drawing(
    drawingId: str,  # noqa: N803
    body: DrawingPatch,
    request: Request,
    handle: ProjectHandle = Depends(get_project),
) -> DrawingOut:
    changes = body.model_dump(exclude_unset=True)
    frame = footprint.frame_or_none(handle)
    with handle.session() as s:
        row = service.require(s, drawingId)
        if changes.get("name") is not None:
            row.name = changes["name"].strip() or row.name
        if changes.get("layer_state") is not None:
            row.layer_state = changes["layer_state"]
        if "captured_on" in changes:
            row.captured_on = changes["captured_on"]
        row.updated_at = utcnow()
        out = service.to_out(row, frame)
    publish_drawings_changed(request, handle, [drawingId])
    return out


@router.delete("/drawings/{drawingId}", status_code=204)
def delete_drawing(
    drawingId: str, request: Request, handle: ProjectHandle = Depends(get_project)
) -> Response:  # noqa: N803
    folder = store.drawing_dir(handle, drawingId)
    with handle.session() as s:
        row = service.require(s, drawingId)
        if row.job_id and request.app.state.jobs.is_live(row.job_id):
            raise AppError(
                "job_running",
                "the drawing is still importing; cancel its job first",
                409,
                {"job_id": row.job_id},
            )
        s.delete(row)
    shutil.rmtree(folder, ignore_errors=True)
    service.drop_caches(drawingId)
    publish_drawings_changed(request, handle, [drawingId])
    return Response(status_code=204)


@router.get("/drawings/{drawingId}/thumbnail", response_class=Response)
def get_drawing_thumbnail(drawingId: str, handle: ProjectHandle = Depends(get_project)) -> Response:  # noqa: N803
    with handle.session() as s:
        service.require(s, drawingId)
    thumb = store.thumb_path(handle, drawingId)
    if not thumb.is_file():
        return Response(status_code=204)
    return Response(
        thumb.read_bytes(), media_type="image/png", headers={"Cache-Control": "private, max-age=3600"}
    )


def _fit(model: str, points, *, dst_unit_m: float, units_scale: float | None) -> fitting.Fit:
    try:
        return fitting.fit(
            model,
            [p.src for p in points],
            [p.dst for p in points],
            dst_unit_m=dst_unit_m,
            units_scale=units_scale,
        )
    except fitting.GeorefRefused as e:
        raise AppError(e.code, e.message, 422) from None


@router.post("/drawings/georef-fit", response_model=GeorefFitOut)
def fit_drawing_georef(body: GeorefFitRequest, handle: ProjectHandle = Depends(get_project)) -> GeorefFitOut:
    """The same maths, nothing stored; dst is "any metric plane" (M-C0), so residuals are its units."""
    units_scale = unit_to_m(body.units) if body.units else None
    return GeorefFitOut(**_fit(body.model, body.points, dst_unit_m=1.0, units_scale=units_scale).to_json())


@router.put("/drawings/{drawingId}/georef", response_model=DrawingOut)
def put_drawing_georef(
    drawingId: str,  # noqa: N803
    body: DrawingGeorefPut,
    request: Request,
    handle: ProjectHandle = Depends(get_project),
) -> DrawingOut:
    with handle.session() as s:
        service.require(s, drawingId)
    frame = site.current_frame(handle)
    with handle.session() as s:
        row = service.require(s, drawingId)
        if row.status != "ready":
            raise AppError("not_ready", "the drawing is still importing or failed", 409)
        units_scale = unit_to_m(row.units) if row.format in VECTOR and row.units else None
        f = _fit(body.model, body.points, dst_unit_m=site.frame_unit_m(frame), units_scale=units_scale)
        fit_json = f.to_json()
        row.georef = {
            "method": "control_points",
            "crs_wkt": None,
            "epsg": None,
            "model": body.model,
            "points": [
                {"id": p.id or f"p{i + 1}", "src": p.src, "dst": p.dst} for i, p in enumerate(body.points)
            ],
            "dst_crs_wkt": frame.crs_wkt,
            "transform": fit_json["transform"],
            "rmse_m": fit_json["rmse_m"],
            "residuals_m": fit_json["residuals_m"],
            "warnings": fit_json["warnings"],
        }
        row.georef_version = (row.georef_version or 0) + 1
        row.bounds_site = footprint.bounds_site_value(row, frame)
        row.updated_at = utcnow()
        if row.format not in VECTOR:
            from app.drawings import raster_io

            raster_io.write_plan_georef(store.plan_path(handle, drawingId), f.transform, frame.crs_wkt)
        out = service.to_out(row, frame)
    service.drop_caches(drawingId)
    publish_drawings_changed(request, handle, [drawingId])
    return out


@router.delete("/drawings/{drawingId}/georef", response_model=DrawingOut)
def clear_drawing_georef(
    drawingId: str,  # noqa: N803
    request: Request,
    handle: ProjectHandle = Depends(get_project),
) -> DrawingOut:
    frame = footprint.frame_or_none(handle)
    with handle.session() as s:
        row = service.require(s, drawingId)
        if row.status == "ready" and row.georef is not None and row.format not in VECTOR:
            from app.drawings import raster_io

            raster_io.clear_plan_georef(store.plan_path(handle, drawingId))
        row.georef, row.bounds_site = None, None
        row.georef_version = (row.georef_version or 0) + 1
        row.updated_at = utcnow()
        out = service.to_out(row, frame)
    service.drop_caches(drawingId)
    publish_drawings_changed(request, handle, [drawingId])
    return out


@router.get("/drawings/{drawingId}/vtiles/{z}/{x}/{y}", response_class=Response)
def get_drawing_vector_tile(
    drawingId: str,  # noqa: N803
    x: int,
    y: int,
    z: int = PathParam(ge=0, le=site.Z_MAX),
    v: str | None = Query(default=None),
    t: str | None = Query(default=None),
    handle: ProjectHandle = Depends(get_project),
) -> Response:
    """M-C0's statuses: 200 JSON (also when truncated with nothing left), 204 nothing in the tile,
    404 unknown/failed/deleted while serving, 409 not_ready/not_placed,
    422 not_vector / no_coordinates (not in this frame) / invalid_preview. `t` (plan Ruling 6) is a
    drawing -> site affine used instead of the stored georef; its responses are never cached."""
    with handle.session() as s:
        d = service.require(s, drawingId)
        if d.status == "failed":
            raise not_found("drawing", drawingId)
        if d.status != "ready":
            raise AppError("not_ready", "the drawing is still importing", 409)
        if d.format not in VECTOR:
            raise AppError("not_vector", "a raster drawing is served as drawing_raster site tiles", 422)
        layers, georef_json, version = list(d.layers or []), d.georef, d.georef_version or 0
    frame = site.current_frame(handle)
    try:
        if t is not None:
            transform = fitting.parse_preview(t)
            dst_wkt = frame.crs_wkt if frame.kind == "crs" else None
        elif georef_json is None:
            raise AppError("not_placed", "the drawing is not placed yet", 409)
        else:
            transform = tuple(georef_json["transform"])
            dst_wkt = georef_json.get("dst_crs_wkt")
        conv = site.Conversion(dst_wkt, frame)
    except fitting.GeorefRefused as e:
        raise AppError(e.code, e.message, 422) from None
    except site.NotInFrame:
        raise AppError("no_coordinates", "the drawing is not in this site frame", 422) from None
    key = (handle.id, drawingId, version, frame.key, z, x, y)
    body = None if t is not None else service.VTILES.get(key)
    if body is None:
        try:
            tile = vtiles.vector_tile(
                store.drawing_dir(handle, drawingId),
                layers,
                transform,
                conv,
                site.frame_unit_m(frame),
                z,
                x,
                y,
                dst_unit_m=site.crs_unit_m(dst_wkt),
            )
        except FileNotFoundError:
            raise not_found("drawing", drawingId) from None  # deleted while this request ran
        empty = not tile["layers"] and not tile["labels"] and not tile["truncated"]
        body = b"" if empty else json.dumps(tile, separators=(",", ":")).encode()
        if t is None:
            service.VTILES.put(key, body)
    if t is not None:
        cache = "no-store"
    elif v == str(version):
        cache = "public, max-age=31536000, immutable"
    else:
        cache = "no-cache"
    if not body:
        return Response(status_code=204, headers={"Cache-Control": cache})
    return Response(body, media_type="application/json", headers={"Cache-Control": cache})
