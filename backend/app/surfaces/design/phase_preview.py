"""The `preview` phase (spec §4.1, §10): the whole pipeline on the coarse preview grid, validation
against the target, preview.png and preview.json. The automatic maximum edge is resolved here once
and stored, so the build's finer densification cannot change the trimming the operator saw."""

from __future__ import annotations

from pathlib import Path

from rasterio.windows import Window

from app.jobs.cancellation import JobCancelled, JobFailure
from app.surfaces import grid
from app.surfaces.design import dem_build, pipeline, preview_image, rasterise, store, validate
from app.surfaces.design import placement as placing
from app.surfaces.design.codes import DesignNote

MESSAGE = "Previewing design"
CANCELLED = "preview cancelled"


def open_target(handle, surface_id: str | None):
    if not surface_id:
        return None
    from app.surfaces.paths import surface_path

    return grid.open_surface(surface_path(handle, surface_id))


def _unique(notes: list[DesignNote]) -> list[DesignNote]:
    seen, out = set(), []
    for n in notes:
        if (n.code, n.message) not in seen:
            seen.add((n.code, n.message))
            out.append(n)
    return out


def compute(handle, idir: Path, pdir: Path, options: dict, *, progress, check_cancelled) -> tuple[dict, dict]:
    inspection = store.read_json(idir / "inspection.json")
    iinternal = store.read_json(idir / "internal.json")
    fmt = inspection["format"]
    body = {
        "output": None,
        "triangle_count": None,
        "overlap_fraction": None,
        "target_covered_fraction": None,
        "design_area_m2": None,
        "z_check": None,
        "suggestions": [],
    }
    internal: dict = {}
    warnings: list[DesignNote] = []
    reader = open_target(handle, options.get("target_surface_id"))
    try:
        target_spec = reader.spec if reader is not None else None
        sel = pipeline.select(inspection, options["candidate_ids"])
        warnings += [
            DesignNote.from_json(n) for c in sel.candidates for n in c["notes"] if n["level"] == "warn"
        ]
        p = placing.resolve(options, fmt, target_spec)
        progress(0.1, MESSAGE)
        if fmt == "geotiff":
            src = Path(inspection["path"])
            dem_build.check_unchanged(src, iinternal)
            bounds = dem_build.footprint(src, p)
        else:
            v, t, runs = pipeline.load_geometry(idir, sel, p, check_cancelled=check_cancelled)
            bounds = placing.xy_bounds(v)
        out, grid_notes = placing.output_grid(bounds, p)
        warnings += grid_notes
        pspec, _k = placing.preview_grid(bounds, out)
        check_cancelled()
        progress(0.3, MESSAGE)
        tin_counts: dict = {}
        if fmt == "geotiff":
            design = dem_build.read_preview(src, pspec, p, iinternal)
        else:
            if sel.geometry == "points":
                tin = pipeline.triangulate_points(
                    v,
                    runs,
                    grid_cell=pspec.cell_size,
                    out_cell=out.cell_size,
                    max_edge_m=options.get("max_edge_m"),
                    check_cancelled=check_cancelled,
                )
            else:
                tin = pipeline.Tin(v, t, {}, "tin")
            design, stats = rasterise.rasterise_to_array(
                tin.vertices, tin.triangles, pspec, check_cancelled=check_cancelled
            )
            tin_counts = {
                **tin.counts,
                "degenerate_triangles": int(stats.degenerate_triangles),
                "overlapping_triangles": int(stats.overlapping_triangles),
            }
            body["triangle_count"] = int(len(tin.triangles))
            internal["max_edge_m"] = tin.counts.get("max_edge_m")
        check_cancelled()
        progress(0.7, MESSAGE)
        overview = validate.read_target_overview(reader) if reader is not None else None
        full = Window(0, 0, pspec.width, pspec.height)
        result = validate.validate(
            validate.ValidationInput(
                fmt=fmt,
                options=options,
                detected=inspection.get("detected") or {},
                internal=iinternal,
                file_bounds=pipeline.file_bounds(sel),
                placement=p,
                design=design,
                pspec=pspec,
                target_spec=target_spec,
                target_on_preview=grid.resample_onto(reader, pspec, full) if reader is not None else None,
                overview=overview,
                samples=pipeline.file_samples(idir, sel),
                tin=tin_counts,
            )
        )
        warnings += result.warnings
        target_layer = (
            preview_image.Layer(overview.z, overview.x0, overview.y0, overview.cell_x, overview.cell_y)
            if overview
            else None
        )
        check_cancelled()
        if not pdir.is_dir():
            # preview_image.render creates missing parents: never recreate a deleted inspection.
            raise JobFailure("the design inspection was deleted")
        preview_image.render(
            preview_image.Layer(design, pspec.x0, pspec.y0, pspec.cell_size, pspec.cell_size),
            target_layer,
            pdir / "preview.png",
        )
        body.update(
            output={
                "crs_wkt": out.crs_wkt or "",
                "epsg": out.epsg,
                "cell_size_m": out.cell_size,
                "width": out.width,
                "height": out.height,
                "bounds_native": [float(b) for b in out.bounds],
                "preview_cell_size_m": pspec.cell_size,
            },
            overlap_fraction=result.overlap_fraction,
            target_covered_fraction=result.target_covered_fraction,
            design_area_m2=result.design_area_m2,
            z_check=result.z_check,
            suggestions=result.suggestions,
        )
        internal.update(output_spec=out.to_json(), bounds=[float(b) for b in bounds], tin=tin_counts)
    except pipeline.Blocked as b:
        warnings += b.notes
    except placing.PlacementBlocked as b:
        warnings.append(b.note)
    finally:
        if reader is not None:
            reader.close()
    body["warnings"] = [w.to_json() for w in _unique(warnings)]
    return body, internal


def run(ctx) -> dict:
    iid, pid, options = ctx.params["inspection_id"], ctx.params["preview_id"], ctx.params["options"]
    idir = store.inspection_dir(ctx.project, iid)
    pdir = store.preview_dir(idir, pid)
    try:
        body, internal = compute(
            ctx.project, idir, pdir, options, progress=ctx.progress, check_cancelled=ctx.check_cancelled
        )
        # A newer preview (or a delete) may have cancelled this one just as compute returned: only
        # the newest preview is shown, so a cancelled one never turns ready.
        ctx.check_cancelled()
    except JobCancelled:
        store.patch_json(pdir / "preview.json", state="failed", error=CANCELLED)
        raise
    except Exception as e:
        if ctx.cancelled.is_set():
            # A file the cancelled job touched was removed by delete_design_inspection: that error
            # is the cancellation, not a real failure (as in phase_inspect).
            store.patch_json(pdir / "preview.json", state="failed", error=CANCELLED)
            raise JobCancelled() from e
        message = str(e) if isinstance(e, JobFailure) else f"preview failed: {type(e).__name__}: {e}"
        store.patch_json(pdir / "preview.json", state="failed", error=message)
        raise
    store.write_json(pdir / "internal.json", internal)
    store.patch_json(pdir / "preview.json", state="ready", error=None, **body)
    ctx.progress(1.0, "Preview ready")
    return {"preview_id": pid, "overlap_fraction": body["overlap_fraction"]}
