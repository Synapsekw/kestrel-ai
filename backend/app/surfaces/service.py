"""Surface rows (spec 2026-09-23-volumes §3, §5.1): create with admission, list, get, patch, delete.

Nothing here filters on `kind`: S3's design surfaces are served, renamed and deleted the same way.
Every id lookup (404) and state check (409) runs before any business-rule 422, so a schema-valid
request with an unknown id never reaches a 422 (plan deviation 14).
"""

from __future__ import annotations

import shutil
import warnings
from collections.abc import Callable
from pathlib import Path

from pyproj import CRS
from sqlalchemy import func, or_, select, update
from sqlalchemy.orm import Session

from app.db.models import Job, PointCloud, Surface, VolumeMeasurement
from app.errors import AppError, not_found
from app.maps.schemas import TileGrid
from app.maps.tiles import max_zoom
from app.projects.service import ProjectHandle
from app.surfaces import build
from app.surfaces.build import BuildParams, BuildRejected, CloudSource
from app.surfaces.grid import MAX_CELLS, GridSpec
from app.surfaces.paths import surface_dir
from app.surfaces.schemas import SurfaceBuildRequest, SurfaceOut
from app.surfaces.tiles import SURFACE_TILES

SPILL_BYTES_PER_POINT = 8 * 1.25
GRID_BYTES_PER_CELL = 12  # raw.tif's two float32 bands + the final float32 grid (plan deviation 10)
CANCELLED_BEFORE_START = "The build was cancelled before it started."
STOPPED_BEFORE_FINISH = "The build stopped before it finished."
TERMINAL_JOB_STATES = ("cancelled", "failed", "succeeded")


def _disk_free(path: Path) -> int:
    path.mkdir(parents=True, exist_ok=True)
    return shutil.disk_usage(path).free


def _users(s: Session, surface_id: str):
    return select(VolumeMeasurement).where(
        or_(
            VolumeMeasurement.top_surface_id == surface_id,
            func.json_extract(VolumeMeasurement.base, "$.surface_id") == surface_id,
        )
    )


def measurement_count(s: Session, surface_id: str) -> int:
    return len(s.execute(_users(s, surface_id)).scalars().all())


def _proj4(crs_wkt: str | None) -> str | None:
    """The PROJ string the viewer's proj4js needs; pyproj's "lossy conversion" warning is expected."""
    if not crs_wkt:
        return None
    with warnings.catch_warnings():
        warnings.filterwarnings("ignore", message="You will likely lose important projection information")
        return CRS.from_user_input(crs_wkt).to_proj4()


def to_out(s: Session, row: Surface) -> SurfaceOut:
    cloud = s.get(PointCloud, row.point_cloud_id) if row.point_cloud_id else None
    proj4 = _proj4(row.crs_wkt)
    ready = row.status == "ready" and row.width and row.height
    return SurfaceOut(
        id=row.id,
        name=row.name,
        kind=row.kind,
        status=row.status,
        error=row.error,
        point_cloud_id=row.point_cloud_id,
        design_source=row.design_source,
        crs_wkt=row.crs_wkt,
        epsg=row.epsg,
        proj4=proj4,
        cell_size_m=row.cell_size_m,
        width=row.width,
        height=row.height,
        geotransform=row.geotransform,
        bounds_native=row.bounds_native,
        z_min=row.z_min,
        z_max=row.z_max,
        coverage_fraction=row.coverage_fraction,
        method=row.method,
        build_params=row.build_params,
        stats=row.stats,
        captured_on=cloud.captured_on if cloud else None,
        map_id=cloud.map_id if cloud else None,
        tile_grid=TileGrid(max_zoom=max_zoom(row.width, row.height)) if ready else None,
        measurement_count=measurement_count(s, row.id),
        job_id=row.job_id,
        created_at=row.created_at,
    )


def _settle(s: Session, row: Surface) -> Surface | None:
    """A `building` row whose job has ended without the build finishing the row becomes `failed`,
    persisted in the caller's session. It happens when a queued job is cancelled: the runner never
    calls `run_surface_build`, so nothing else would move the row until the next startup sweep.

    The job thread may write or delete the row after `row` was read, so the change is a
    compare-and-set on `status == "building"` and the row is re-read after it: the job's own
    `failed` message wins over the generic one. None when a cancelled build deleted the row."""
    if row.status == "building" and row.job_id:
        job = s.get(Job, row.job_id)
        if job is not None and job.state in TERMINAL_JOB_STATES:
            error = CANCELLED_BEFORE_START if job.state == "cancelled" else STOPPED_BEFORE_FINISH
            s.execute(
                update(Surface)
                .where(Surface.id == row.id, Surface.status == "building")
                .values(status="failed", error=error)
                .execution_options(synchronize_session=False)
            )
            return s.get(Surface, row.id, populate_existing=True)
    return row


def _get(s: Session, surface_id: str) -> Surface:
    row = s.get(Surface, surface_id)
    row = _settle(s, row) if row is not None else None
    if row is None:
        raise not_found("surface", surface_id)
    return row


def list_surfaces(handle: ProjectHandle) -> list[SurfaceOut]:
    with handle.session() as s:
        rows = s.execute(select(Surface).order_by(Surface.created_at.desc())).scalars().all()
        settled = [_settle(s, r) for r in rows]
        return [to_out(s, r) for r in settled if r is not None]


def get_surface(handle: ProjectHandle, surface_id: str) -> SurfaceOut:
    with handle.session() as s:
        return to_out(s, _get(s, surface_id))


def require_ready(handle: ProjectHandle, surface_id: str) -> Surface:
    with handle.session() as s:
        row = _get(s, surface_id)
        if row.status != "ready":
            raise AppError("not_ready", f"surface {row.name} is {row.status}, not ready", 409)
        s.expunge(row)
        return row


def grid_spec(row: Surface) -> GridSpec:
    """The ready surface's grid, from its row (the tif says the same)."""
    gt = row.geotransform
    return GridSpec(row.crs_wkt, row.epsg, row.cell_size_m, gt[0], gt[3], row.width, row.height)


def cloud_source(cloud: PointCloud) -> CloudSource:
    return CloudSource(
        Path(cloud.source_path), int(cloud.point_count or 0), cloud.crs_wkt, tuple(cloud.bounds_native)
    )


def resolve_params(body: SurfaceBuildRequest, cloud: PointCloud) -> dict:
    """The request with its defaults resolved (spec §5.1); `cell_size_m` stays null for auto
    until the build has chosen it."""
    sent = body.model_fields_set
    return {
        "point_cloud_id": cloud.id,
        "name": body.name or f"{cloud.name} surface",
        "method": body.method or "median",
        "cell_size_m": body.cell_size_m,
        "auto_cell": body.cell_size_m is None,
        "hole_fill_max_gap_m": 1.0 if body.hole_fill_max_gap_m is None else body.hole_fill_max_gap_m,
        "despike_m": body.despike_m if "despike_m" in sent else 1.0,
        "z_clip": body.z_clip,
        "drop_noise_classes": True if body.drop_noise_classes is None else body.drop_noise_classes,
        "assume_metres": bool(body.assume_metres),
    }


def build_params(params: dict) -> BuildParams:
    return BuildParams(
        method=params["method"],
        cell_size_m=params["cell_size_m"],
        hole_fill_max_gap_m=params["hole_fill_max_gap_m"],
        despike_m=params["despike_m"],
        z_clip=tuple(params["z_clip"]) if params["z_clip"] else None,
        drop_noise_classes=params["drop_noise_classes"],
        assume_metres=params["assume_metres"],
    )


def _admit(handle: ProjectHandle, cloud: PointCloud, params: dict, disk_free: Callable[[Path], int]) -> None:
    """The §5.1 admission checks, each a 422 with a code and an operator message."""
    src = cloud_source(cloud)
    if params["z_clip"] and params["z_clip"][0] >= params["z_clip"][1]:
        raise AppError("invalid_build_request", "the Z clip's low value must be below its high value", 422)
    try:
        plan = build.plan_crs(src, params["assume_metres"])
    except BuildRejected as e:
        raise AppError(e.code, e.message, 422) from e
    if not src.path.is_file() or src.path.stat().st_size != cloud.source_size:
        raise AppError(
            "source_missing",
            f"source file not found at {src.path} — reconnect the drive or re-import",
            422,
        )
    bounds = build.grid_bounds(src, plan)
    if params["cell_size_m"] is not None:
        cells = build.grid_cells(bounds, params["cell_size_m"], plan)
        if cells > MAX_CELLS:
            raise AppError(
                "grid_too_large", build.grid_too_large_message(bounds, params["cell_size_m"], plan), 422
            )
    else:
        cells = max(1, src.point_count // 4)
    need = int(SPILL_BYTES_PER_POINT * src.point_count + GRID_BYTES_PER_CELL * cells)
    free = disk_free(handle.surfaces_dir)
    if free < need:
        raise AppError(
            "insufficient_disk",
            f"building this surface needs {need / 1e9:.1f} GB free on the project's drive; "
            f"{free / 1e9:.1f} GB is free",
            422,
        )


def create_surface(
    handle: ProjectHandle, body: SurfaceBuildRequest, *, disk_free: Callable[[Path], int] | None = None
) -> Surface:
    with handle.session() as s:
        cloud = s.get(PointCloud, body.point_cloud_id)
        if cloud is None:
            raise not_found("point cloud", body.point_cloud_id)
        if cloud.status != "ready":
            raise AppError("not_ready", f"point cloud {cloud.name} is {cloud.status}, not ready", 409)
        s.expunge(cloud)
    params = resolve_params(body, cloud)
    _admit(handle, cloud, params, disk_free or _disk_free)
    with handle.session() as s:
        row = Surface(
            name=params["name"],
            kind="cloud_dsm",
            status="building",
            point_cloud_id=cloud.id,
            method=None,
            build_params=params,
        )
        s.add(row)
        s.flush()
        s.expunge(row)
    return row


def set_job(
    handle: ProjectHandle, surface_id: str, job_id: str, *, created: Surface | None = None
) -> SurfaceOut:
    """Record the build's job on the row. If a cancel already ran the job and deleted the row,
    `created` (the row as `create_surface` returned it) is reported instead of a 404: the job was
    queued, and its own state says what became of it."""
    with handle.session() as s:
        # A statement, not a read-then-flush: the job may delete the row in between (StaleDataError).
        s.execute(
            update(Surface)
            .where(Surface.id == surface_id)
            .values(job_id=job_id)
            .execution_options(synchronize_session=False)
        )
        row = s.get(Surface, surface_id)
        row = _settle(s, row) if row is not None else None
        if row is None:
            if created is None:
                raise not_found("surface", surface_id)
            created.job_id = job_id
            return to_out(s, created)
        return to_out(s, row)


def rename(handle: ProjectHandle, surface_id: str, name: str | None) -> SurfaceOut:
    with handle.session() as s:
        row = _get(s, surface_id)
        if name:
            row.name = name
        s.flush()
        return to_out(s, row)


def delete_surface(handle: ProjectHandle, surface_id: str, is_live: Callable[[str], bool]) -> None:
    with handle.session() as s:
        row = _get(s, surface_id)
        if row.job_id and is_live(row.job_id):
            raise AppError("conflict", f"surface {row.name} is still building; cancel the job first", 409)
        users = [m.name for m in s.execute(_users(s, surface_id)).scalars()]
        if users:
            raise AppError(
                "conflict",
                f"surface {row.name} is used by {', '.join(sorted(users))}; delete those first",
                409,
            )
        s.delete(row)
    shutil.rmtree(surface_dir(handle, surface_id), ignore_errors=True)
    SURFACE_TILES.drop_map(surface_id)
