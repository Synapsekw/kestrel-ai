"""The `build` phase (spec §8.2): write drawings/<id>/, place it, and finish the row."""

from __future__ import annotations

import shutil
from collections.abc import Callable
from pathlib import Path

import numpy as np

from app.db.base import utcnow
from app.db.models import Drawing
from app.drawings import footprint, raster_io, store
from app.drawings import placement as placing
from app.jobs.cancellation import JobCancelled, JobFailure

MESSAGE = "Importing drawing"
CANCELLED = "import cancelled"


def _fail(ctx, did: str, message: str) -> None:
    with ctx.project.session() as s:
        row = s.get(Drawing, did)
        if row is not None:
            row.status, row.error, row.updated_at = "failed", message, utcnow()
    shutil.rmtree(store.drawing_dir(ctx.project, did), ignore_errors=True)
    ctx.publish("drawings.changed", {"drawing_ids": [did]})


def cancelled_before_start(ctx) -> None:
    _fail(ctx, ctx.params["drawing_id"], CANCELLED)


def _source(ctx) -> tuple[dict, Path, Path]:
    idir = store.inspection_dir(ctx.project, ctx.params["inspection_id"])
    try:
        insp = store.read_json(idir / "inspection.json")
        req = store.read_json(idir / "request.json")
    except FileNotFoundError:
        raise JobFailure("the file's inspection is gone; import the drawing again") from None
    src = Path(insp["path"])
    try:
        st = src.stat()
    except OSError:
        raise JobFailure(f"{src.name} is no longer there; import it again") from None
    if st.st_size != req.get("file_size") or st.st_mtime_ns != req.get("mtime_ns"):
        raise JobFailure(f"{src.name} changed since it was read; import it again")
    return insp, idir, src


def _progress(ctx, lo: float, hi: float):
    return lambda f, m=MESSAGE: ctx.progress(lo + (hi - lo) * f, m)


def _build_raster(ctx, insp: dict, idir: Path, src: Path, folder: Path) -> dict:
    plan = folder / "plan.tif"
    width, height = raster_io.copy_to_plan(
        src, plan, progress=_progress(ctx, 0.02, 0.95), check_cancelled=ctx.check_cancelled
    )
    raster_io.write_plan_thumbnail(plan, folder / "thumb.png")
    return {
        "width": width,
        "height": height,
        "dpi": None,
        "extent_src": [0.0, float(-height), float(width), 0.0],
        "layers": [],
        "units": None,
    }


def _build_pdf(ctx, insp: dict, idir: Path, src: Path, folder: Path) -> dict:
    from app.drawings import pdf

    plan, dpi = folder / "plan.tif", ctx.params["dpi"]
    width, height = pdf.render_page_to_plan(
        src,
        ctx.params["page"],
        dpi,
        plan,
        progress=_progress(ctx, 0.02, 0.95),
        check_cancelled=ctx.check_cancelled,
    )
    raster_io.write_plan_thumbnail(plan, folder / "thumb.png")
    return {
        "width": width,
        "height": height,
        "dpi": dpi,
        "extent_src": [0.0, float(-height), float(width), 0.0],
        "layers": [],
        "units": None,
    }


def _build_vector(ctx, insp: dict, idir: Path, src: Path, folder: Path) -> dict:
    from app.drawings import runs

    names = [layer["name"] for layer in insp["layers"]]
    chosen = ctx.params.get("layers")
    keep = names if chosen is None else [n for n in names if n in set(chosen)]
    remap = np.full(len(names), -1, np.int32)
    for new, n in enumerate(keep):
        remap[names.index(n)] = new
    source = store.lines_dir(idir)
    meta = runs.copy_runs(source, folder, remap, check_cancelled=ctx.check_cancelled, layers=keep)
    ctx.progress(0.5, MESSAGE)
    labels = [label for label in store.read_json(source / "labels.json") if label["layer"] in set(keep)]
    store.write_json(folder / "labels.json", labels)
    if meta["runs"] == 0 and not labels:
        raise JobFailure("the chosen layers have no lines or text")
    runs.build_index(folder, check_cancelled=ctx.check_cancelled)
    ctx.progress(0.85, MESSAGE)
    if meta["runs"]:
        runs.runs_thumbnail(folder, folder / "thumb.png")
    by_name = {layer["name"]: layer for layer in insp["layers"]}
    return {
        "width": None,
        "height": None,
        "dpi": None,
        "extent_src": runs.extent_with_labels(meta["extent"], labels),
        "layers": [by_name[n] for n in keep],
        "units": ctx.params["placement"].get("units") or insp.get("units"),
    }


# Format -> builder.
BUILDERS: dict[str, Callable] = {
    "png": _build_raster,
    "jpg": _build_raster,
    "tif": _build_raster,
    "pdf": _build_pdf,
    "dxf": _build_vector,
    "landxml": _build_vector,
}


def run(ctx) -> dict:
    did = ctx.params["drawing_id"]
    folder = store.drawing_dir(ctx.project, did)
    try:
        insp, idir, src = _source(ctx)
        builder = BUILDERS.get(insp["format"])
        if builder is None:
            raise JobFailure(f"{insp['format']} drawings can't be imported yet")
        folder.mkdir(parents=True, exist_ok=True)
        fields = builder(ctx, insp, idir, src, folder)
        georef = placing.georef_for(ctx.params["placement"], insp)
        if georef is not None and (folder / "plan.tif").is_file():
            raster_io.write_plan_georef(folder / "plan.tif", georef["transform"], georef["dst_crs_wkt"])
        store.write_json(
            folder / "source.json",
            {
                "path": str(src),
                "size": src.stat().st_size,
                "sha256": insp["sha256"],
                "format": insp["format"],
                "page": ctx.params.get("page"),
                "dpi": fields.get("dpi"),
            },
        )
        ctx.check_cancelled()
    except JobCancelled:
        _fail(ctx, did, CANCELLED)
        raise
    except JobFailure as e:
        if ctx.cancelled.is_set():
            _fail(ctx, did, CANCELLED)
            raise JobCancelled() from e
        _fail(ctx, did, str(e))
        raise
    except Exception as e:
        if ctx.cancelled.is_set():
            _fail(ctx, did, CANCELLED)
            raise JobCancelled() from e
        _fail(ctx, did, f"import failed: {type(e).__name__}: {e}")
        raise
    frame = footprint.frame_or_none(ctx.project)
    with ctx.project.session() as s:
        row = s.get(Drawing, did)
        if row is None:  # deleted after a cancel raced the finish
            shutil.rmtree(folder, ignore_errors=True)
            return {"drawing_id": did}
        for key, value in fields.items():
            setattr(row, key, value)
        row.georef, row.georef_version = georef, (1 if georef is not None else 0)
        row.layer_state = {
            "hidden_layers": [layer["name"] for layer in fields["layers"] if not layer["visible_default"]],
            "knockout_white": False,
        }
        row.bounds_site = footprint.bounds_site_value(row, frame)
        row.status, row.error, row.updated_at = "ready", None, utcnow()
    ctx.publish("drawings.changed", {"drawing_ids": [did]})
    ctx.progress(1.0, "Drawing ready")
    return {"drawing_id": did}
