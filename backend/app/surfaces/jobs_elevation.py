"""The `elevation_import` job (map workspace spec §7 steps 1-4, M8): a plain DSM/DTM GeoTIFF becomes
a `dem` surface through S3's DEM path -- copied when it already is a surface on the chosen lattice,
else re-gridded window by window (tolerance 1e-9, coverage-mask erosion). No preview gate.

Cancel deletes the row and its folder, like `surface_build` (nothing half-imported is left to
explain); a failure keeps the row `failed` with a readable error and removes the folder; `.build/`
(the inspection scratch) is removed in every outcome.
"""

from __future__ import annotations

import gc
import json
import shutil
from pathlib import Path

from app.db.models import Surface
from app.jobs.cancellation import JobCancelled, JobFailure
from app.jobs.registry import register_job_type
from app.surfaces import grid
from app.surfaces.design import dem, dem_build
from app.surfaces.elevation import ElevationRefused, plan, read_header
from app.surfaces.paths import build_dir, surface_dir, surface_path

READING = "Reading elevation file"
IMPORTING = "Importing elevation"
EMPTY = "the elevation file has no valid heights"
TARGET_GONE = "the surface to align to is no longer ready; import the file again"
INSPECT_SHARE = 0.05


def _publish(ctx, sid: str) -> None:
    ctx.publish("surfaces.changed", {"surface_ids": [sid]})


def _delete(ctx, sid: str) -> None:
    with ctx.project.session() as s:
        row = s.get(Surface, sid)
        if row is not None:
            s.delete(row)
    gc.collect()  # a dataset still referenced by a traceback holds files on Windows
    shutil.rmtree(surface_dir(ctx.project, sid), ignore_errors=True)
    _publish(ctx, sid)


def _fail(ctx, sid: str, message: str) -> None:
    with ctx.project.session() as s:
        row = s.get(Surface, sid)
        if row is not None:
            row.status, row.error = "failed", message
    gc.collect()
    shutil.rmtree(surface_dir(ctx.project, sid), ignore_errors=True)
    _publish(ctx, sid)


def cancelled_before_start(ctx) -> None:
    """The runner's hook for an import cancelled while queued: `run` never ran."""
    _delete(ctx, ctx.params["surface_id"])


def _target(ctx, surface_id: str | None) -> grid.GridSpec | None:
    if not surface_id:
        return None
    with ctx.project.session() as s:
        row = s.get(Surface, surface_id)
        usable = row is not None and row.status == "ready" and row.crs_wkt is not None
    path = surface_path(ctx.project, surface_id)
    if not usable or not path.is_file():
        raise JobFailure(TARGET_GONE)
    with grid.open_surface(path) as reader:
        return reader.spec


def _import(ctx, sid: str) -> dict:
    handle, params = ctx.project, ctx.params
    with handle.session() as s:
        if s.get(Surface, sid) is None:
            raise JobFailure("the elevation was deleted before its import started")
    src = Path(params["path"])
    target = _target(ctx, params.get("align_to_surface_id"))
    work = build_dir(handle, sid)
    work.mkdir(parents=True, exist_ok=True)
    try:
        read_header(src)  # the request's refusals, word for word, if the file changed since
        inspected = dem.inspect_file(
            src,
            work,
            progress=lambda f, _m=None: ctx.progress(INSPECT_SHARE * f, READING),
            check_cancelled=ctx.check_cancelled,
        )
        chosen = plan(
            src, params.get("cell_size_m"), target, vertical_unit=inspected.detected.vertical_unit or "metre"
        )
    except ElevationRefused as e:
        raise JobFailure(e.message) from None
    internal, p = inspected.internal, chosen.placement
    out_path = surface_path(handle, sid)

    def progress(f: float, _m: str | None = None) -> None:
        ctx.progress(INSPECT_SHARE + (0.95 - INSPECT_SHARE) * f, IMPORTING)

    if dem_build.can_copy(src, p, target, internal):
        dem_build.copy_file(src, out_path, progress=progress, check_cancelled=ctx.check_cancelled)
        stats = grid.compute_stats(out_path, check_cancelled=ctx.check_cancelled)
        with grid.open_surface(out_path) as reader:
            spec = reader.spec
        method = "dem_copy"
    else:
        with grid.SurfaceWriter(out_path, chosen.out, check_cancelled=ctx.check_cancelled) as w:
            dem_build.regrid(
                src, chosen.out, w, p, internal, progress=progress, check_cancelled=ctx.check_cancelled
            )
            stats = w.finish()
        spec, method = chosen.out, "dem_resample"
    if stats.valid_cells == 0:
        raise JobFailure(EMPTY)
    ctx.check_cancelled()
    with handle.session() as s:
        current = s.get(Surface, sid)
        role = current.elevation_role if current is not None else None
    # Every file first, the row last: a crash never leaves a `ready` row without its source.json.
    (surface_dir(handle, sid) / "source.json").write_text(
        json.dumps(
            {
                "path": str(src),
                "size": src.stat().st_size,
                "role": role,
                "method": method,
                "source_crs_wkt": chosen.header.crs_wkt,
                "aligned_to_surface_id": params.get("align_to_surface_id"),
            },
            indent=2,
        ),
        encoding="utf-8",
    )
    with handle.session() as s:
        row = s.get(Surface, sid)
        if row is None:
            raise JobFailure("the elevation was deleted while it was being imported")
        row.status, row.error, row.method = "ready", None, method
        row.crs_wkt, row.epsg, row.cell_size_m = spec.crs_wkt, spec.epsg, spec.cell_size
        row.width, row.height = spec.width, spec.height
        row.geotransform, row.bounds_native = list(spec.geotransform), list(spec.bounds)
        row.z_min, row.z_max, row.coverage_fraction = stats.z_min, stats.z_max, stats.coverage_fraction
    return {
        "surface_id": sid,
        "method": method,
        "cell_size_m": spec.cell_size,
        "coverage_fraction": stats.coverage_fraction,
        "aligned_to_surface_id": params.get("align_to_surface_id"),
    }


@register_job_type("elevation_import", on_cancelled_before_start=cancelled_before_start)
def run_elevation_import(ctx) -> dict:
    sid = ctx.params["surface_id"]
    ctx.progress(0.0, READING)
    try:
        result = _import(ctx, sid)
    except JobCancelled:
        _delete(ctx, sid)
        raise
    except JobFailure as e:
        _fail(ctx, sid, str(e))
        raise
    except Exception as e:
        if ctx.cancelled.is_set():
            _delete(ctx, sid)
            raise JobCancelled() from e
        _fail(ctx, sid, f"the import failed: {type(e).__name__}: {e}")
        raise
    finally:
        shutil.rmtree(build_dir(ctx.project, sid), ignore_errors=True)
    _publish(ctx, sid)
    ctx.progress(1.0, "Elevation ready")
    return result
