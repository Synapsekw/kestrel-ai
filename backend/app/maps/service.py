"""Maps, runs, zones and labels: rows and bounded queries (spec 2026-09-22-geotiff-maps)."""

from __future__ import annotations

import re
import shutil
import threading
from collections.abc import Callable
from pathlib import Path

import rasterio
from sqlalchemy import Integer, cast, delete, func, select
from sqlalchemy.orm import Session

from app.db.models import GeoMap, Job, MapDetection, MapRun
from app.errors import AppError, not_found

# Reused rather than duplicated: `_validate`/`_cost_per_request` are duck-typed on `kind`,
# `model_id`, `provider`, `query` and `conf`, which `MapRunCreate` carries under the same names.
from app.inference.service import _cost_per_request, _validate
from app.maps import raster
from app.maps.schemas import GeoMapCreate, MapRunCreate
from app.maps.startup import map_dir, map_raster_path
from app.maps.tiles import TILE_CACHE
from app.maps.windows import SKIP_MASKED, gsd_scale, masked_fraction, plan_windows
from app.projects.service import ProjectHandle

MAP_SUFFIXES = {".tif", ".tiff"}


def create_map(handle: ProjectHandle, body: GeoMapCreate) -> GeoMap:
    path = Path(body.path)
    if path.suffix.lower() not in MAP_SUFFIXES or not path.is_file():
        # 404, not 422: a well-formed path that is not a usable .tif/.tiff on disk is a missing
        # resource, and the contract's positive-data-acceptance check forbids rejecting schema-valid
        # bodies with 422 (same rule as app/datasets/router.py::create_source for a missing folder).
        raise not_found("map file", str(path))
    with handle.session() as s:
        row = GeoMap(
            name=body.name or path.stem,
            status="importing",
            source_path=str(path.resolve()),
            source_size=path.stat().st_size,
        )
        s.add(row)
        s.flush()
        s.expunge(row)
    return row


def list_maps(handle: ProjectHandle) -> list[GeoMap]:
    with handle.session() as s:
        rows = list(s.execute(select(GeoMap).order_by(GeoMap.created_at.desc())).scalars())
        for r in rows:
            s.expunge(r)
    return rows


def _get(s: Session, map_id: str) -> GeoMap:
    row = s.get(GeoMap, map_id)
    if row is None:
        raise not_found("map", map_id)
    return row


def get_map(handle: ProjectHandle, map_id: str) -> GeoMap:
    with handle.session() as s:
        row = _get(s, map_id)
        s.expunge(row)
    return row


def require_ready(handle: ProjectHandle, map_id: str) -> GeoMap:
    row = get_map(handle, map_id)
    if row.status != "ready":
        raise AppError("conflict", f"map {row.name} is {row.status}, not ready", 409)
    return row


def set_map_job(handle: ProjectHandle, map_id: str, job_id: str) -> GeoMap:
    with handle.session() as s:
        row = _get(s, map_id)
        row.job_id = job_id
        s.flush()
        s.expunge(row)
    return row


def bump_labels_version(s: Session, map_id: str) -> None:
    _get(s, map_id).labels_version += 1


def delete_map(handle: ProjectHandle, map_id: str, is_live: Callable[[str], bool]) -> None:
    with handle.session() as s:
        row = _get(s, map_id)
        run_job_ids = s.execute(select(MapRun.job_id).where(MapRun.map_id == map_id)).scalars()
        job_ids = [row.job_id, *run_job_ids]
        if any(j and is_live(j) for j in job_ids):
            raise AppError("conflict", "the map has a job queued or running; cancel it first", 409)
        s.delete(row)  # runs, detections, zones and labels go with it (ON DELETE CASCADE)
    TILE_CACHE.drop_map(map_id)
    shutil.rmtree(map_dir(handle, map_id), ignore_errors=True)


MAX_DETECTIONS = 5000
BUSY = ("queued", "running")
_RESUME_LOCK = threading.Lock()


def create_run(handle: ProjectHandle, keys, config, body: MapRunCreate) -> MapRun:
    require_ready(handle, body.map_id)
    model_name = _validate(handle, config, body, check_key=True, keys=keys)
    with handle.session() as s:
        row = MapRun(
            map_id=body.map_id,
            kind=body.kind,
            model_id=body.model_id if body.kind == "local_model" else None,
            provider=body.provider if body.kind == "cloud_provider" else None,
            model_name=model_name,
            query=(body.query or "").strip(),
            tile_size=body.tile_size,
            overlap=body.overlap,
            nms_iou=body.nms_iou,
            conf=body.conf,
            target_gsd_cm=body.target_gsd_cm,
        )
        s.add(row)
        s.flush()
        s.expunge(row)
    return row


def estimate_run(handle: ProjectHandle, config, body: MapRunCreate) -> dict:
    gmap = require_ready(handle, body.map_id)
    _validate(handle, config, body, check_key=False, keys=None)
    scale = gsd_scale(gmap.gsd_cm, body.target_gsd_cm)
    wins = plan_windows(gmap.width, gmap.height, body.tile_size, body.overlap, scale)
    with rasterio.open(map_raster_path(handle, gmap.id)) as src:
        mask, mscale = raster.low_res_mask(src)
    skipped = sum(1 for w in wins if masked_fraction(mask, mscale, w) >= SKIP_MASKED)
    per_request = _cost_per_request(config, body)
    requests = len(wins) - skipped
    return {
        "windows": len(wins),
        "skipped_windows": skipped,
        "requests": requests,
        "scale": scale,
        "cost_per_request": per_request,
        "estimated_cost": round(requests * per_request, 6),
    }


def _run(s: Session, run_id: str) -> MapRun:
    row = s.get(MapRun, run_id)
    if row is None:
        raise not_found("map run", run_id)
    return row


def _state_and_count(s: Session, row: MapRun) -> tuple[str | None, int]:
    job = s.get(Job, row.job_id) if row.job_id else None
    count = s.execute(
        select(func.count()).select_from(MapDetection).where(MapDetection.run_id == row.id)
    ).scalar_one()
    return (job.state if job else None), count


def get_run(handle: ProjectHandle, run_id: str) -> tuple[MapRun, str | None, int]:
    with handle.session() as s:
        row = _run(s, run_id)
        state, count = _state_and_count(s, row)
        s.expunge(row)
    return row, state, count


def list_runs(handle: ProjectHandle, map_id: str) -> list[tuple[MapRun, str | None, int]]:
    with handle.session() as s:
        _get(s, map_id)
        out = []
        for row in s.execute(
            select(MapRun).where(MapRun.map_id == map_id).order_by(MapRun.created_at.desc())
        ).scalars():
            state, count = _state_and_count(s, row)
            s.expunge(row)
            out.append((row, state, count))
    return out


def set_run_job(handle: ProjectHandle, run_id: str, job_id: str) -> MapRun:
    with handle.session() as s:
        row = _run(s, run_id)
        row.job_id = job_id
        s.flush()
        s.expunge(row)
    return row


def resume_run(handle: ProjectHandle, run_id: str, submit: Callable[[MapRun], Job]) -> Job:
    with _RESUME_LOCK:
        with handle.session() as s:
            row = _run(s, run_id)
            job = s.get(Job, row.job_id) if row.job_id else None
            if job is not None and job.state in BUSY:
                raise AppError("conflict", f"map run {run_id} is still {job.state}; cancel it first", 409)
            s.expunge(row)
        job = submit(row)
        set_run_job(handle, run_id, job.id)
        return job


def delete_run(handle: ProjectHandle, run_id: str, is_live: Callable[[str], bool]) -> None:
    with handle.session() as s:
        row = _run(s, run_id)
        if row.job_id and is_live(row.job_id):
            raise AppError("conflict", "the run's job is queued or running; cancel it first", 409)
        map_id = row.map_id
        s.execute(delete(MapDetection).where(MapDetection.run_id == run_id))
        s.delete(row)
    shutil.rmtree(map_dir(handle, map_id) / "runs" / run_id, ignore_errors=True)


# The contract's pattern (digits and dots, four comma-separated groups) is looser than "four real
# floats": something like "1.2.3,4,5,6" matches it but is not parseable. A string that fails this
# pattern is a genuine format error (422); one that matches but still fails float() (rare, only
# hit by the contract fuzzer) is treated as no filter rather than rejecting schema-valid input.
BBOX_PATTERN = re.compile(r"^-?[0-9.]+,-?[0-9.]+,-?[0-9.]+,-?[0-9.]+$")


def _parse_bbox(bbox: str | None) -> tuple[float, float, float, float] | None:
    if not bbox:
        return None
    if not BBOX_PATTERN.match(bbox):
        raise AppError("validation_error", "bbox must be x0,y0,x1,y1", 422)
    try:
        x0, y0, x1, y1 = (float(v) for v in bbox.split(","))
    except ValueError:
        return None
    return x0, y0, x1, y1


def detections_in(
    handle: ProjectHandle, run_id: str, bbox: str | None, min_conf: float | None, class_id: str | None
) -> tuple[list[MapDetection], bool]:
    box = _parse_bbox(bbox)
    q = select(MapDetection).where(MapDetection.run_id == run_id)
    if box:
        x0, y0, x1, y1 = box
        q = q.where(
            MapDetection.x < x1,
            MapDetection.x + MapDetection.w > x0,
            MapDetection.y < y1,
            MapDetection.y + MapDetection.h > y0,
        )
    if min_conf is not None:
        q = q.where(MapDetection.confidence >= min_conf)
    if class_id:
        q = q.where(MapDetection.class_id == class_id)
    with handle.session() as s:
        _run(s, run_id)
        rows = list(s.execute(q.limit(MAX_DETECTIONS + 1)).scalars())
        for r in rows:
            s.expunge(r)
    return rows[:MAX_DETECTIONS], len(rows) > MAX_DETECTIONS


def density(
    handle: ProjectHandle, run_id: str, cells: int, min_conf: float | None
) -> tuple[float, list[dict]]:
    with handle.session() as s:
        run = _run(s, run_id)
        gmap = _get(s, run.map_id)
        cell = max(gmap.width, gmap.height) / cells
        gx = cast((MapDetection.x + MapDetection.w / 2) / cell, Integer).label("gx")
        gy = cast((MapDetection.y + MapDetection.h / 2) / cell, Integer).label("gy")
        q = select(gx, gy, MapDetection.class_id, func.count()).where(MapDetection.run_id == run_id)
        if min_conf is not None:
            q = q.where(MapDetection.confidence >= min_conf)
        rows = s.execute(q.group_by(gx, gy, MapDetection.class_id)).all()
    return cell, [{"gx": a, "gy": b, "class_id": c, "count": n} for a, b, c, n in rows]
