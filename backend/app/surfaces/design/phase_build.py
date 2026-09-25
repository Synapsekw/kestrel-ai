"""The commit gate and the `build` phase (spec §2 Commit gate, §3, §4.1 build, §4.2, §6 Build).

The build re-runs the preview's pipeline on the output grid the preview stored (internal.json), with
the preview's resolved maximum edge, and writes block by block through S2's SurfaceWriter.
"""

from __future__ import annotations

import gc
import shutil
from collections.abc import Callable
from pathlib import Path

from app.db.models import Surface
from app.errors import AppError, not_found
from app.jobs.cancellation import JobCancelled, JobFailure
from app.surfaces import grid, service
from app.surfaces.design import dem_build, pipeline, rasterise, store
from app.surfaces.design import placement as placing
from app.surfaces.design.targets import target_ready
from app.surfaces.paths import surface_dir, surface_path
from app.surfaces.schemas import SurfaceOut

MESSAGE = "Importing design surface"
CANCELLED = "import cancelled"


def _conflict(message: str) -> AppError:
    return AppError("conflict", message, 409)


def _not_ready(message: str) -> AppError:
    return AppError("not_ready", message, 409)


def check_commit(handle, idir: Path, preview_id: str, accept: bool, runner) -> tuple[dict, dict]:
    """Look before you commit (spec §2): a ready, newest preview; no block; warn needs accept.

    `not_ready` when the preview or the target is not ready; `conflict` for everything else."""
    inspection = store.read_json(idir / "inspection.json")
    preview = store.read_json(store.require_preview(idir, preview_id) / "preview.json")
    req = store.read_json(idir / "request.json")
    if store.build_live(req, runner):
        raise _conflict("this design is already being imported")
    if preview["state"] != "ready":
        raise _not_ready("the preview is not ready: wait for it, or preview again")
    # Before the newest/block/warn checks: a vanished target must not be answered "accept the warnings".
    target = preview["options"].get("target_surface_id")
    if target and not target_ready(handle, target):
        raise _not_ready(f"the target surface {target} is no longer ready; preview again")
    if req.get("latest_preview_id") != preview_id:
        raise _conflict("a newer preview exists: import from the newest one")
    blocks = [w for w in preview["warnings"] if w["level"] == "block"]
    if blocks:
        raise _conflict(f"this design can't be imported: {blocks[0]['message']}")
    if any(w["level"] == "warn" for w in preview["warnings"]) and not accept:
        raise _conflict("this preview has warnings: accept them to import")
    return inspection, preview


def design_source(inspection: dict, preview: dict, pinternal: dict, accept: bool) -> dict:
    o, fmt = preview["options"], inspection["format"]
    src = placing.parse_crs(o["source_crs"])
    return {
        "path": inspection["path"],
        "format": fmt,
        "units": None if fmt == "geotiff" else o["horizontal_unit"],
        "vertical_units": o["vertical_unit"],
        "sha256": inspection["sha256"],
        "candidates": [c["name"] for c in inspection["candidates"] if c["id"] in o["candidate_ids"]],
        "source_crs_wkt": src.to_wkt(),
        "source_epsg": src.to_epsg(),
        "swap_xy": bool(o.get("swap_xy")) and fmt != "geotiff",
        "max_edge_m": pinternal.get("max_edge_m"),
        "aligned_to_surface_id": o.get("target_surface_id"),
        "accepted_warnings": sorted({w["code"] for w in preview["warnings"] if w["level"] == "warn"})
        if accept
        else [],
    }


def _default_name(inspection: dict, source: dict) -> str:
    stem = Path(inspection["path"]).stem
    name = stem if inspection["format"] == "geotiff" else f"{stem} — {', '.join(source['candidates'])}"
    return name[:200]


def create(
    handle, runner, body, *, surfaces_changed: Callable[[list[str]], None] | None = None
) -> tuple[SurfaceOut, object]:
    """Insert the `building` row, queue the build and record it; returns the row as the contract's
    `Surface` and the job. If the job cannot be queued the row is marked failed (S2's
    `submit_failed`) and `surfaces_changed` is told before the error propagates.

    Everything from the gate to recording `build_job_id` runs under `store.commit_lock`, so two
    concurrent commits (a double-click) cannot both pass the gate: the second sees the first's
    live build and gets 409 `conflict`.

    The inspection lookup is under the lock too (a delete takes it), and a folder that still vanishes
    between the lookup and a read (removed by something not holding the lock) is a 404, not a 500."""
    with store.commit_lock:
        idir = store.require_inspection(handle, body.inspection_id)
        try:
            inspection, preview = check_commit(handle, idir, body.preview_id, body.accept_warnings, runner)
            pinternal = store.read_json(store.preview_dir(idir, body.preview_id) / "internal.json")
        except FileNotFoundError:
            raise not_found("design inspection", body.inspection_id) from None
        source = design_source(inspection, preview, pinternal, body.accept_warnings)
        with handle.session() as s:
            created = Surface(
                name=body.name or _default_name(inspection, source),
                kind="design",
                status="building",
                point_cloud_id=None,
                design_source=source,
            )
            s.add(created)
            s.flush()
            s.expunge(created)  # S2's `set_job(created=)` reports it if a delete removes the row
        sid = created.id
        try:
            job = runner.submit(
                handle,
                "design_import",
                {
                    "phase": "build",
                    "surface_id": sid,
                    "inspection_id": body.inspection_id,
                    "preview_id": body.preview_id,
                },
            )
        except Exception as e:
            service.submit_failed(handle, sid, e)
            if surfaces_changed is not None:
                surfaces_changed([sid])
            raise
        try:
            # None, or an OSError, when the job already succeeded and removed the inspection folder:
            # the job ran, so that is not an error for the caller.
            store.patch_json(idir / "request.json", build_job_id=job.id, surface_id=sid)
        except OSError:
            pass
    # A delete may have removed the row before its job id was recorded: S2 then reports `created`,
    # and the job fails readably ("deleted before its import started").
    return service.set_job(handle, sid, job.id, created=created), job


def _rasterise(tin: pipeline.Tin, spec: grid.GridSpec, path: Path, progress, check) -> grid.SurfaceStats:
    r = rasterise.TinRasteriser(tin.vertices, tin.triangles, spec, side=grid.MAX_READ, check_cancelled=check)
    windows = list(grid.read_windows(spec))
    with grid.SurfaceWriter(path, spec, check_cancelled=check) as w:
        for i, win in enumerate(windows):
            block = r.rasterise_window(win)
            if block is not None:
                w.write_block(win, block)
            progress((i + 1) / len(windows), MESSAGE)
        return w.finish()


def _source(handle, sid: str, when: str) -> dict:
    with handle.session() as s:
        row = s.get(Surface, sid)
        if row is None:
            raise JobFailure(f"the design surface was deleted {when}")
        return dict(row.design_source)


def _build(ctx, sid: str, idir: Path, pid: str) -> dict:
    handle = ctx.project
    _source(handle, sid, "before its import started")
    inspection = store.read_json(idir / "inspection.json")
    iinternal = store.read_json(idir / "internal.json")
    pdir = store.preview_dir(idir, pid)
    preview, pinternal = store.read_json(pdir / "preview.json"), store.read_json(pdir / "internal.json")
    options, fmt = preview["options"], inspection["format"]
    out = grid.GridSpec.from_json(pinternal["output_spec"])
    target = None
    if options.get("target_surface_id"):
        tpath = surface_path(handle, options["target_surface_id"])
        if not target_ready(handle, options["target_surface_id"]):
            raise JobFailure("the target surface is no longer ready; preview again")
        with grid.open_surface(tpath) as reader:
            target = reader.spec
        if not grid.same_lattice(out, target):
            raise JobFailure("the target surface changed since the preview; preview again")
    p = placing.resolve(options, fmt, target)
    surface_dir(handle, sid).mkdir(parents=True, exist_ok=True)
    path = surface_path(handle, sid)

    def progress(f: float, m: str = MESSAGE) -> None:
        ctx.progress(0.05 + 0.9 * f, m)

    if fmt == "geotiff":
        import rasterio

        src = Path(inspection["path"])
        dem_build.check_unchanged(src, iinternal)
        if dem_build.can_copy(src, p, target, iinternal):
            dem_build.copy_file(src, path, progress=progress, check_cancelled=ctx.check_cancelled)
            stats = grid.compute_stats(path, check_cancelled=ctx.check_cancelled)
            with rasterio.open(path) as ds:
                spec = grid.GridSpec.from_dataset(ds)
            method = "dem_copy"
        else:
            with grid.SurfaceWriter(path, out, check_cancelled=ctx.check_cancelled) as w:
                dem_build.regrid(
                    src, out, w, p, iinternal, progress=progress, check_cancelled=ctx.check_cancelled
                )
                stats = w.finish()
            spec, method = out, "dem_resample"
    else:
        sel = pipeline.select(inspection, options["candidate_ids"])
        v, t, runs = pipeline.load_geometry(idir, sel, p, check_cancelled=ctx.check_cancelled)
        if sel.geometry == "points":
            tin = pipeline.triangulate_points(
                v,
                runs,
                grid_cell=out.cell_size,
                out_cell=out.cell_size,
                max_edge_m=pinternal.get("max_edge_m"),
                check_cancelled=ctx.check_cancelled,
            )
        else:
            tin = pipeline.Tin(v, t, {}, "tin")
        del v, t, runs
        stats = _rasterise(tin, out, path, progress, ctx.check_cancelled)
        spec, method = out, tin.method
        del tin
    if stats.valid_cells == 0:
        raise JobFailure("the design covers no cell of the output grid")
    ctx.check_cancelled()
    # Every file first, the row last: a crash never leaves a `ready` row without its source.json.
    source = _source(handle, sid, "while it was being imported")
    keys = (
        "overlap_fraction",
        "target_covered_fraction",
        "design_area_m2",
        "z_check",
        "triangle_count",
        "warnings",
    )
    if not store.write_json(
        surface_dir(handle, sid) / "source.json", {**source, "preview": {k: preview[k] for k in keys}}
    ):
        raise JobFailure("the design surface's folder was removed while it was being imported")
    gc.collect()  # memory maps of the cache must be gone before Windows lets the folder go
    shutil.rmtree(idir, ignore_errors=True)
    with handle.session() as s:
        row = s.get(Surface, sid)
        if row is None:
            raise JobFailure("the design surface was deleted while it was being imported")
        row.status, row.error, row.method = "ready", None, method
        row.crs_wkt, row.epsg, row.cell_size_m = spec.crs_wkt, spec.epsg, spec.cell_size
        row.width, row.height = spec.width, spec.height
        row.geotransform, row.bounds_native = list(spec.geotransform), list(spec.bounds)
        row.z_min, row.z_max, row.coverage_fraction = stats.z_min, stats.z_max, stats.coverage_fraction
    return {
        "surface_id": sid,
        "width": spec.width,
        "height": spec.height,
        "coverage_fraction": stats.coverage_fraction,
    }


def _fail(ctx, sid: str, message: str) -> None:
    with ctx.project.session() as s:
        row = s.get(Surface, sid)
        if row is not None:
            row.status, row.error = "failed", message
    gc.collect()  # a memory map or a dataset still referenced by the traceback holds files on Windows
    shutil.rmtree(surface_dir(ctx.project, sid), ignore_errors=True)
    ctx.publish("surfaces.changed", {"surface_ids": [sid]})


def run(ctx) -> dict:
    sid, iid, pid = ctx.params["surface_id"], ctx.params["inspection_id"], ctx.params["preview_id"]
    idir = store.inspection_dir(ctx.project, iid)
    try:
        result = _build(ctx, sid, idir, pid)
    except JobCancelled:
        _fail(ctx, sid, CANCELLED)
        raise
    except JobFailure as e:
        _fail(ctx, sid, str(e))
        raise
    except Exception as e:
        if ctx.cancelled.is_set():
            _fail(ctx, sid, CANCELLED)
            raise JobCancelled() from e
        _fail(ctx, sid, f"import failed: {type(e).__name__}: {e}")
        raise
    ctx.publish("surfaces.changed", {"surface_ids": [sid]})
    ctx.progress(1.0, "Design surface ready")
    return result
