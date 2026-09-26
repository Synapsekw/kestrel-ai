"""Volume measurement rows (spec 2026-09-23-volumes §3, §6.2, §6.10).

Numbers come only from a `volume_calc` job. Each result stores the `inputs` it was computed from
and their fingerprint; GET and list recompute the fingerprint (a few indexed lookups) and turn a
ready measurement `stale` when anything it depends on changed, naming what.
"""

from __future__ import annotations

import hashlib
import json
import logging
import shutil
from collections.abc import Callable
from pathlib import PureWindowsPath

from sqlalchemy import Integer, cast, func, select, update
from sqlalchemy.orm import Session

from app.db.models import Job, MapDetection, MapRun, PointCloud, Surface, VolumeMeasurement
from app.errors import AppError, not_found
from app.projects.service import ProjectHandle
from app.surfaces.grid import MAX_CELLS, _same_crs
from app.surfaces.tiles import DIFF_TILES
from app.volumes.engine import ENGINE_VERSION, MIN_POLYGON_CELLS, EngineFailure, ring_polygon
from app.volumes.paths import measurement_dir
from app.volumes.schemas import (
    VolumeMeasurementCreate,
    VolumeMeasurementOut,
    VolumeMeasurementPatch,
)

log = logging.getLogger(__name__)
DEFAULT_MASKS = {"detection_run_ids": [], "class_ids": None, "buffer_m": 1.0, "exclusion_polygons": []}
REASONS = {
    "polygon_native": "polygon changed",
    "top_surface_id": "top surface changed",
    "top_surface_job_id": "top surface rebuilt",
    "base": "base changed",
    "base_surface_job_id": "base surface rebuilt",
    "masks": "masks changed",
    "mask_runs": "masks: detection run changed",
    "alignment": "alignment changed",
    "engine_version": "the volume engine was updated",
}
INPUT_FIELDS = ("polygon_native", "top_surface_id", "base", "masks", "alignment")
TERMINAL_JOB_STATES = ("cancelled", "failed", "succeeded")
ENDED_BEFORE_START = "the calculation ended before it started; calculate it again"


def _invalid(message: str, code: str = "invalid_geometry") -> AppError:
    """A schema-valid request the rules refuse: 422 with its own code, never `validation_error`
    (that one is FastAPI's malformed-request answer, and the contract test treats them apart)."""
    return AppError(code, message, 422)


def _job_running(message: str) -> AppError:
    """A refusal because the measurement's `volume_calc` job is live (the coordinator's rule)."""
    return AppError("job_running", message, 409)


def _settle(s: Session, row: VolumeMeasurement) -> VolumeMeasurement | None:
    """A `calculating` row whose job has ended without the job settling the row (a queued job
    cancelled before it ran) goes back to `stale` or `failed`, as the job itself would have done;
    otherwise it would refuse every change until the next startup sweep.

    The job thread (or a new calculation) may write the row after `row` was read, so the change is
    a compare-and-set on `status == "calculating"` and the same `job_id`, and the row is re-read
    after it: whatever the job itself wrote wins over the generic settle."""
    if row.status == "calculating" and row.job_id:
        job = s.get(Job, row.job_id)
        if job is not None and job.state in TERMINAL_JOB_STATES:
            values = {"status": "stale"} if row.results else {"status": "failed", "error": ENDED_BEFORE_START}
            s.execute(
                update(VolumeMeasurement)
                .where(
                    VolumeMeasurement.id == row.id,
                    VolumeMeasurement.status == "calculating",
                    VolumeMeasurement.job_id == row.job_id,
                )
                .values(**values)
                .execution_options(synchronize_session=False)
            )
            return s.get(VolumeMeasurement, row.id, populate_existing=True)
    return row


def _get(s: Session, measurement_id: str) -> VolumeMeasurement:
    row = s.get(VolumeMeasurement, measurement_id)
    row = _settle(s, row) if row is not None else None
    if row is None:
        raise not_found("volume measurement", measurement_id)
    return row


def _ready_surface(s: Session, surface_id: str, role: str) -> Surface:
    row = s.get(Surface, surface_id)
    if row is None:
        raise not_found(f"{role} surface", surface_id)
    if row.status != "ready":
        raise AppError("not_ready", f"{role} surface {row.name} is {row.status}, not ready", 409)
    return row


def normalise_base(base: dict) -> dict:
    """The canonical base: `z` only for a flat base, `surface_id` only for a surface base, so a
    stray field neither changes the fingerprint nor pins a surface against deletion."""
    kind = base["kind"]
    return {
        "kind": kind,
        "z": base.get("z") if kind == "flat" else None,
        "surface_id": base.get("surface_id") if kind == "surface" else None,
    }


def _check_inputs(
    s: Session, polygon: list, top_id: str, base: dict, masks: dict, alignment: dict
) -> Surface:
    """Lookups (404) and states (409) first, then the business rules (422). Returns the top."""
    top = _ready_surface(s, top_id, "top")
    base_surface = None
    if base["kind"] == "surface" and base.get("surface_id"):
        base_surface = _ready_surface(s, base["surface_id"], "base")
    if base_surface is not None and (base_surface.crs_wkt is None) != (top.crs_wkt is None):
        # any two CRSs reproject (spec §6.2, §6.4); a local grid has no place on a georeferenced one
        local, georef = (base_surface, top) if base_surface.crs_wkt is None else (top, base_surface)
        raise _invalid(
            f"{local.name} has local coordinates and {georef.name} is georeferenced; "
            "choose a base and a top that are both local or both georeferenced",
            "invalid_base",
        )
    if base["kind"] == "surface" and not base.get("surface_id"):
        raise _invalid("a surface base needs surface_id", "invalid_base")
    if base["kind"] == "flat" and base.get("z") is None:
        raise _invalid("a flat base needs z, the level in metres", "invalid_base")
    try:
        poly = ring_polygon(polygon)
        for exclusion in masks["exclusion_polygons"]:
            ring_polygon(exclusion["ring"])
        if alignment.get("stable_polygon"):
            ring_polygon(alignment["stable_polygon"])
    except EngineFailure as e:
        raise _invalid(str(e)) from e
    cell = top.cell_size_m
    if poly.area / (cell * cell) < MIN_POLYGON_CELLS:
        raise _invalid(f"the polygon covers fewer than {MIN_POLYGON_CELLS} cells of {top.name}")
    minx, miny, maxx, maxy = poly.bounds
    if (maxx - minx) * (maxy - miny) / (cell * cell) > MAX_CELLS:
        raise _invalid("the polygon is too large for this surface's cell size")
    gx0, gy0, gx1, gy1 = top.bounds_native
    if maxx <= gx0 or minx >= gx1 or maxy <= gy0 or miny >= gy1:
        raise _invalid(f"the polygon does not overlap {top.name}")
    return top


def _masks(stored: dict | None, sent: dict | None) -> dict:
    out = {**DEFAULT_MASKS, **(stored or {})}
    for k, v in (sent or {}).items():
        if v is not None or k == "class_ids":
            out[k] = v
    return out


def _alignment(stored: dict | None, sent: dict | None) -> dict:
    out = {"stable_polygon": None, "apply_shift": False, "measured": None, **(stored or {})}
    for k, v in (sent or {}).items():
        if k == "stable_polygon" or v is not None:
            out[k] = v
    return out


def create(handle: ProjectHandle, body: VolumeMeasurementCreate) -> VolumeMeasurement:
    masks = _masks(None, body.masks.model_dump(exclude_unset=True) if body.masks else None)
    alignment = _alignment(None, body.alignment.model_dump(exclude_unset=True) if body.alignment else None)
    base = normalise_base(body.base.model_dump())
    with handle.session() as s:
        _check_inputs(s, body.polygon_native, body.top_surface_id, base, masks, alignment)
        row = VolumeMeasurement(
            name=body.name,
            polygon_native=body.polygon_native,
            top_surface_id=body.top_surface_id,
            base=base,
            masks=masks,
            alignment=alignment,
            status="calculating",
        )
        s.add(row)
        s.flush()
        s.expunge(row)
    return row


def _job_time(s: Session, job_id: str | None) -> str | None:
    job = s.get(Job, job_id) if job_id else None
    return job.finished_at.isoformat() if job and job.finished_at else None


def _milli_sum(col):
    """The column's sum in integer thousandths of a pixel: exact and independent of row order, so
    the same set of boxes always sums the same."""
    return func.sum(cast(func.round(func.coalesce(col, 0.0) * 1000), Integer))


def _kept_by_class(s: Session, run: MapRun) -> dict[str, dict[str, int]]:
    """The set of boxes the masking uses (as `footprints.footprints_for`: not rejected, at or above
    the run's confidence), per class: the count and the sums of x, y, w, h and angle. One aggregate
    over the run's rows in the database, nothing loaded into memory. The sums matter: rejecting one
    box and restoring another of its class keeps the count but moves what is masked, and a redrawn
    box keeps it too - either way the measurement must turn stale (spec §6.10)."""
    rows = s.execute(
        select(
            MapDetection.class_id,
            func.count(),
            _milli_sum(MapDetection.x),
            _milli_sum(MapDetection.y),
            _milli_sum(MapDetection.w),
            _milli_sum(MapDetection.h),
            _milli_sum(MapDetection.angle),
        )
        .where(
            MapDetection.run_id == run.id,
            MapDetection.review_state != "rejected",
            MapDetection.confidence >= run.conf,
        )
        .group_by(MapDetection.class_id)
    ).all()
    keys = ("n", "x", "y", "w", "h", "angle")
    return {
        class_id: dict(zip(keys, (int(v or 0) for v in values), strict=True)) for class_id, *values in rows
    }


def inputs_snapshot(s: Session, row: VolumeMeasurement) -> dict:
    """Everything the numbers depend on, as a canonical dict (spec §6.10). The first five keys are
    the PATCH fields themselves, so "Revert to last calculated inputs" can send them back."""
    top = s.get(Surface, row.top_surface_id)
    base_surface = s.get(Surface, row.base.get("surface_id")) if row.base.get("surface_id") else None
    runs = []
    for run_id in row.masks.get("detection_run_ids", []):
        run = s.get(MapRun, run_id)
        if run is None:
            runs.append({"id": run_id, "missing": True})
            continue
        runs.append({"id": run_id, "finished_at": _job_time(s, run.job_id), "kept": _kept_by_class(s, run)})
    alignment = row.alignment or {}
    return {
        "polygon_native": row.polygon_native,
        "top_surface_id": row.top_surface_id,
        "base": row.base,
        "masks": row.masks,
        "alignment": {
            "stable_polygon": alignment.get("stable_polygon"),
            "apply_shift": bool(alignment.get("apply_shift")),
        },
        "top_surface_job_id": top.job_id if top else None,
        "base_surface_job_id": base_surface.job_id if base_surface else None,
        "mask_runs": runs,
        "engine_version": ENGINE_VERSION,
    }


def fingerprint(inputs: dict) -> str:
    canonical = json.dumps(inputs, sort_keys=True, separators=(",", ":"), default=str)
    return hashlib.sha256(canonical.encode("utf-8")).hexdigest()


def stale_reasons(stored: dict, current: dict) -> list[str]:
    reasons = []
    for key, text in REASONS.items():
        if stored.get(key) == current.get(key):
            continue
        if key == "mask_runs" and any(r.get("missing") for r in current.get("mask_runs", [])):
            text = "masks: detection run deleted"
        reasons.append(text)
    return reasons


def _refresh(s: Session, row: VolumeMeasurement) -> tuple[list[str], bool]:
    """(stale reasons, whether this call turned the row stale)."""
    if not row.results or row.status == "calculating":
        return [], False
    current = inputs_snapshot(s, row)
    if fingerprint(current) == row.results.get("inputs_fingerprint"):
        return [], False
    reasons = stale_reasons(row.results.get("inputs", {}), current)
    if row.status == "ready":
        row.status = "stale"
        return reasons, True
    return reasons, False


def refresh_mask_users(handle: ProjectHandle, run_ids: list[str]) -> list[str]:
    """After a write that may change what a detection run masks (a review, a drawn box, the run or
    its map deleted): every measurement masking with one of `run_ids` is refreshed now, so a ready
    one whose inputs changed is `stale` in the database at once. Returns their ids, to publish as
    `volumes.changed` so the Volumes screen reloads (spec §6.10).

    Measurements are a project's handful of rows; only their `masks` are read to find the users.
    Called after the write it follows has committed, so a failure here is logged and not raised:
    the write happened, and every read of a measurement refreshes it anyway."""
    try:
        return _refresh_mask_users(handle, set(run_ids))
    except Exception:
        log.exception("could not refresh the measurements masking with runs %s", run_ids)
        return []


def _refresh_mask_users(handle: ProjectHandle, wanted: set[str]) -> list[str]:
    with handle.session() as s:
        users = [
            mid
            for mid, masks in s.execute(select(VolumeMeasurement.id, VolumeMeasurement.masks)).all()
            if wanted.intersection((masks or {}).get("detection_run_ids") or [])
        ]
        out = []
        for mid in users:
            row = s.get(VolumeMeasurement, mid)
            row = _settle(s, row) if row is not None else None
            if row is None:
                continue
            _refresh(s, row)
            out.append(mid)
        return out


def to_out(row: VolumeMeasurement, reasons: list[str]) -> VolumeMeasurementOut:
    return VolumeMeasurementOut(
        id=row.id,
        name=row.name,
        status=row.status,
        error=row.error,
        polygon_native=row.polygon_native,
        top_surface_id=row.top_surface_id,
        base=row.base,
        masks=_masks(row.masks, None),
        alignment=_alignment(row.alignment, None),
        results=row.results,
        stale_reasons=reasons,
        job_id=row.job_id,
        created_at=row.created_at,
        updated_at=row.updated_at,
    )


def list_measurements(handle: ProjectHandle) -> tuple[list[VolumeMeasurementOut], list[str]]:
    """The measurements, newest first, and the ids that just turned stale (to publish)."""
    with handle.session() as s:
        out, changed = [], []
        rows = s.execute(select(VolumeMeasurement).order_by(VolumeMeasurement.created_at.desc())).scalars()
        for listed in rows.all():
            row = _settle(s, listed)
            if row is None:  # deleted since it was listed
                continue
            reasons, turned = _refresh(s, row)
            if turned:
                changed.append(row.id)
            out.append(to_out(row, reasons))
        return out, changed


def get_measurement(handle: ProjectHandle, measurement_id: str) -> tuple[VolumeMeasurementOut, bool]:
    with handle.session() as s:
        row = _get(s, measurement_id)
        reasons, turned = _refresh(s, row)
        s.flush()
        return to_out(row, reasons), turned


def patch(handle: ProjectHandle, measurement_id: str, body: VolumeMeasurementPatch) -> VolumeMeasurementOut:
    sent = body.model_dump(exclude_unset=True)
    with handle.session() as s:
        row = _get(s, measurement_id)
        if sent.get("name"):
            row.name = sent["name"]
        changes = {k: v for k, v in sent.items() if k in INPUT_FIELDS}  # the schema refuses nulls
        if changes:
            if row.status == "calculating":
                raise _job_running(f"{row.name} is being calculated; wait for it or cancel the job")
            polygon = changes.get("polygon_native", row.polygon_native)
            top_id = changes.get("top_surface_id", row.top_surface_id)
            base = normalise_base(changes["base"]) if "base" in changes else row.base
            masks = _masks(row.masks, changes.get("masks"))
            alignment = _alignment(row.alignment, changes.get("alignment"))
            new = _check_inputs(s, polygon, top_id, base, masks, alignment)
            if top_id != row.top_surface_id:
                old = s.get(Surface, row.top_surface_id)
                if old is not None and not _same_crs(old.crs_wkt, new.crs_wkt):
                    raise _invalid(
                        f"{new.name} is in another coordinate system than the polygon", "invalid_base"
                    )
            row.polygon_native, row.top_surface_id, row.base = polygon, top_id, base
            row.masks, row.alignment = masks, alignment
            if row.results:
                # back on the inputs the results were computed from ("revert"): they hold again
                current = fingerprint(inputs_snapshot(s, row))
                row.status = "ready" if current == row.results.get("inputs_fingerprint") else "stale"
        s.flush()
        reasons, _ = _refresh(s, row)
        return to_out(row, reasons)


def start_calculation(handle: ProjectHandle, measurement_id: str, submit: Callable[[], Job]) -> tuple:
    """Mark the row `calculating` and submit its job. The previous (ended) job_id is cleared first:
    left in place, a read before the new id is written would `_settle` the row back while the new
    job runs. A submit that raises puts the row back as it was."""
    with handle.session() as s:
        row = _get(s, measurement_id)
        if row.status == "calculating":
            raise _job_running(f"{row.name} is already being calculated")
        before = row.status, row.error, row.job_id
        row.status, row.error, row.job_id = "calculating", None, None
    try:
        job = submit()
    except BaseException:
        with handle.session() as s:
            row = s.get(VolumeMeasurement, measurement_id)
            if row is not None:
                row.status, row.error, row.job_id = before
        raise
    with handle.session() as s:
        row = s.get(VolumeMeasurement, measurement_id)
        if row is None:
            raise not_found("volume measurement", measurement_id)
        row.job_id = job.id
        s.flush()
        return to_out(row, []), job


def set_job(handle: ProjectHandle, measurement_id: str, job_id: str) -> VolumeMeasurementOut:
    with handle.session() as s:
        row = s.get(VolumeMeasurement, measurement_id)
        if row is None:
            raise not_found("volume measurement", measurement_id)
        row.job_id = job_id
        s.flush()
        return to_out(row, [])


def submit_failed(handle: ProjectHandle, measurement_id: str, error: BaseException) -> None:
    """A just-created row whose job could not be queued: `failed` with a readable error, never
    `calculating` with no job (nothing would ever settle it)."""
    with handle.session() as s:
        row = s.get(VolumeMeasurement, measurement_id)
        if row is not None and row.status == "calculating" and row.job_id is None:
            row.status, row.error = "failed", f"the calculation could not be queued: {error}"


def peek(handle: ProjectHandle, measurement_id: str) -> VolumeMeasurementOut:
    """The row as stored, without the fingerprint refresh: for the tile and footprint hot paths."""
    with handle.session() as s:
        row = s.get(VolumeMeasurement, measurement_id)
        if row is None:
            raise not_found("volume measurement", measurement_id)
        return to_out(row, [])


def delete(handle: ProjectHandle, measurement_id: str) -> None:
    with handle.session() as s:
        row = _get(s, measurement_id)
        if row.status == "calculating":
            raise _job_running(f"{row.name} is being calculated; wait for it or cancel the job")
        s.delete(row)
    shutil.rmtree(measurement_dir(handle, measurement_id), ignore_errors=True)
    DIFF_TILES.drop_map(measurement_id)


def surface_ref(s: Session, surface: Surface) -> dict:
    cloud = s.get(PointCloud, surface.point_cloud_id) if surface.point_cloud_id else None
    return {
        "id": surface.id,
        "name": surface.name,
        "kind": surface.kind,
        "method": surface.method,
        "cell_size_m": surface.cell_size_m,
        "captured_on": cloud.captured_on.isoformat() if cloud and cloud.captured_on else None,
        "cloud_file": PureWindowsPath(cloud.source_path).name if cloud else None,
        "cloud_sha256": cloud.source_sha256 if cloud else None,
    }


def validate_export(handle: ProjectHandle, measurement_ids: list[str]) -> None:
    """Every measurement must exist (404) and be ready with current inputs (409): an exported
    number always matches its inputs (spec §6.10)."""
    with handle.session() as s:
        for measurement_id in dict.fromkeys(measurement_ids):
            row = _get(s, measurement_id)
            _refresh(s, row)
            if row.status == "calculating":
                raise _job_running(f"{row.name} is being calculated; wait for it before exporting")
            if row.status != "ready":
                raise AppError(
                    "not_ready", f"{row.name} is {row.status}; recalculate it before exporting", 409
                )
