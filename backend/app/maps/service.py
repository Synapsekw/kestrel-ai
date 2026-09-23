"""Maps, runs, zones and labels: rows and bounded queries (spec 2026-09-22-geotiff-maps)."""

from __future__ import annotations

import shutil
from collections.abc import Callable
from pathlib import Path

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.db.models import GeoMap, MapRun
from app.errors import AppError, not_found
from app.maps.schemas import GeoMapCreate
from app.maps.startup import map_dir
from app.maps.tiles import TILE_CACHE
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
