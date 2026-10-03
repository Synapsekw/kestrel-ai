"""`asset_glb_import` (spec 2026-10-02-asset-findings §6.1): an existing GLB becomes an `imported`
asset model version, in the canonical frame, with its parts, height and silhouette.

Steps: parse the JSON chunk; stream the stored copy (normalised JSON, the conversion baked in as a
root node matrix, the BIN chunk copied byte for byte) while hashing; check trimesh loads it;
compute the silhouette and height; mark the version ready and update the model's frame. The stored
`v<n>.glb` is written once here and never rewritten. A pending version whose job dies is failed by
`app.asset_models.startup.sweep_interrupted`, like a built one.
"""

from __future__ import annotations

import os
from pathlib import Path

from pydantic import ValidationError
from sqlalchemy import select

from app.asset_models import store
from app.asset_models.service import refresh_status
from app.asset_review import frame_io, glb, meshes
from app.asset_review.frame import Origin
from app.db.models import AssetModelVersion
from app.errors import AppError
from app.jobs.cancellation import JobCancelled, JobFailure
from app.jobs.registry import register_job_type

GLB_IMPORT_JOB = "asset_glb_import"
MAX_GLB_BYTES = 2 * 1024**3
MAX_ERROR_DETAIL = 300


def _invalid(reason: str) -> AppError:
    return AppError("glb_invalid", reason, 422, {"reason": reason})


def check_source(path: Path) -> None:
    """The route's cheap check: an existing file of at most 2 GB that starts like a GLB 2.0."""
    try:
        if not path.is_file():
            raise _invalid("The GLB file was not found.")
        if path.stat().st_size > MAX_GLB_BYTES:
            raise _invalid("The GLB is larger than 2 GB.")
        with open(path, "rb") as f:
            glb.read_header(f)
    except glb.GlbError as e:
        raise _invalid(str(e)) from None
    except (OSError, ValueError):
        raise _invalid("The GLB file could not be opened.") from None


def start_import(
    handle,
    runner,
    model_id: str,
    *,
    path: Path,
    conversion: str,
    origin: dict | None,
    note: str | None = None,
    source_name: str | None = None,
    provenance: dict | None = None,
):
    """Insert a pending `imported` version, point the model at it, and queue the job."""
    with handle.session() as s:
        model = store.get_model(s, model_id)
        n = store.next_version_number(s, model_id)
        row = AssetModelVersion(
            model_id=model_id,
            version=n,
            spec={},
            kind="imported",
            glb_status="pending",
            source_ids=[],
            note=note,
            part_count=0,
            meta={
                "source_name": source_name or path.name,
                "frame_conversion": (provenance or {}).get("frame_conversion") or conversion,
            },
        )
        s.add(row)
        model.current_version = n
        refresh_status(model)
        s.flush()
        s.expunge(row)
    params = {
        "asset_model_id": model_id,
        "version": n,
        "path": str(path),
        "frame_conversion": conversion,
        "origin": origin,
    }
    if provenance:
        params["provenance"] = provenance  # recorded in meta only; the file is not converted again
    try:
        job = runner.submit(handle, GLB_IMPORT_JOB, params)
    except Exception:
        with handle.session() as s:
            store.get_version(s, model_id, n).glb_status = "failed"
        raise
    with handle.session() as s:
        store.get_version(s, model_id, n).glb_job_id = job.id
    return row, job


def _mark_failed(ctx, message: str) -> None:
    mid, n = ctx.params["asset_model_id"], int(ctx.params["version"])
    with ctx.project.session() as s:
        v = store.get_version(s, mid, n)
        v.glb_status = "failed"
        v.meta = {**(v.meta or {}), "error": message}
    ctx.publish("asset_models.changed", {"asset_model_ids": [mid]})


def _cancelled_before_start(ctx) -> None:
    _mark_failed(ctx, "Cancelled before it started.")


def _previous_import_meta(s, model_id: str, version: int) -> dict | None:
    prev = s.scalar(
        select(AssetModelVersion)
        .where(
            AssetModelVersion.model_id == model_id,
            AssetModelVersion.kind == "imported",
            AssetModelVersion.glb_status == "ready",
            AssetModelVersion.version < version,
        )
        .order_by(AssetModelVersion.version.desc())
        .limit(1)
    )
    return prev.meta if prev is not None else None


@register_job_type(GLB_IMPORT_JOB, on_cancelled_before_start=_cancelled_before_start)
def run_glb_import(ctx) -> dict:
    out = store.version_glb_path(ctx.project, ctx.params["asset_model_id"], int(ctx.params["version"]))
    tmp = out.with_name(out.name + ".tmp")
    try:
        return _run(ctx, out, tmp)
    except JobCancelled:
        tmp.unlink(missing_ok=True)
        out.unlink(missing_ok=True)
        _mark_failed(ctx, "Cancelled.")
        raise
    except JobFailure:
        raise
    except Exception as e:  # noqa: BLE001 - anything unexpected must not leave the version pending
        tmp.unlink(missing_ok=True)
        out.unlink(missing_ok=True)
        raise _fail(ctx, f"The import failed: {type(e).__name__}.") from None


def _scrub(text: str, *paths: Path) -> str:
    """Drop local paths from an error message that is shown to the operator."""
    for p in paths:
        for form in (str(p), p.as_posix(), str(p.parent), p.parent.as_posix()):
            text = text.replace(form, "<file>")
    return text


def _fail(ctx, message: str, *paths: Path) -> JobFailure:
    for p in paths:
        p.unlink(missing_ok=True)
    _mark_failed(ctx, message)
    return JobFailure(message)


def _run(ctx, out: Path, tmp: Path) -> dict:
    p = ctx.params
    mid, n = p["asset_model_id"], int(p["version"])
    src = Path(p["path"])
    conversion = p.get("frame_conversion") or "none"
    if conversion not in frame_io.CONVERSIONS:
        raise _fail(ctx, f"Unknown frame conversion {conversion!r}.")
    origin = p.get("origin")
    if origin:
        try:
            Origin.model_validate(origin)
        except ValidationError:
            raise _fail(ctx, "The origin is not a valid latitude, longitude and ground altitude.") from None
    ctx.progress(0, f"Reading {src.name}")
    try:
        info = glb.parse(src)
        out.parent.mkdir(parents=True, exist_ok=True)

        def on_chunk(done: int, total: int) -> None:
            ctx.check_cancelled()
            ctx.progress(0.6 * done / max(total, 1), f"Copying {src.name}")

        src_sha, sha, size = glb.write_normalised(
            src, tmp, info, frame_io.matrix_of(conversion), on_chunk=on_chunk
        )
        os.replace(tmp, out)
    except glb.GlbError as e:
        raise _fail(ctx, str(e), tmp) from None
    except OSError as e:
        raise _fail(ctx, f"The GLB could not be copied: {type(e).__name__}.", tmp) from None
    ctx.check_cancelled()
    ctx.progress(0.65, "Checking the model loads")
    try:
        mesh, _face_node = meshes.load_glb_mesh(out)
    except Exception as e:  # noqa: BLE001 - trimesh raises many types; the message is the point
        detail = _scrub(str(e).strip() or type(e).__name__, out, tmp, src)[:MAX_ERROR_DETAIL]
        raise _fail(ctx, f"The GLB could not be loaded: {detail}", out) from None
    ctx.check_cancelled()
    ctx.progress(0.85, "Measuring the height and silhouette")
    lo, hi = mesh.bounds
    height = round(float(hi[1]), 3)
    if height <= 0:
        raise _fail(
            ctx,
            f"The model lies below its ground datum (top at {height:g} m); check the frame conversion.",
            out,
        )
    silhouette = frame_io.silhouette_from_mesh(mesh)
    parts = [
        {"node": x.node, "id": x.name, "name": x.name, "group": x.group, "extras": x.extras}
        for x in info.parts
    ]
    meta = {
        "source_name": (p.get("source_name") or src.name),
        "source_sha256": (p.get("provenance") or {}).get("source_sha256") or src_sha,
        "sha256": sha,
        "bytes": size,
        "node_count": len(info.doc.get("nodes", [])),
        "frame_conversion": (p.get("provenance") or {}).get("frame_conversion") or conversion,
        "parts": parts,
        "source_bounds_m": list(info.bounds) if info.bounds else None,
        "bounds_m": [[round(float(v), 4) for v in lo], [round(float(v), 4) for v in hi]],
        "top_m": height,
        "base_m": round(float(lo[1]), 3),
        "height_m": height,
        "silhouette": [list(pair) for pair in silhouette],
        "triangles": int(len(mesh.faces)),
    }
    with ctx.project.session() as s:
        v = store.get_version(s, mid, n)
        meta["source_name"] = (v.meta or {}).get("source_name") or meta["source_name"]
        prev_meta = _previous_import_meta(s, mid, n)
        model = store.get_model(s, mid)
        old_h = float(model.frame["height_m"]) if model.frame else None
        model.frame = frame_io.frame_after_import(model.frame, prev_meta, height, silhouette, origin)
        new_h = float(model.frame["height_m"])
        if model.review and old_h and new_h != old_h:
            model.review = frame_io.rescale_review(model.review, old_h, new_h)
        v.glb_status, v.meta, v.part_count = "ready", meta, len(parts)
        refresh_status(model)
    ctx.publish("asset_models.changed", {"asset_model_ids": [mid]})
    ctx.progress(1, f"Imported version {n}: {len(parts):,} parts, {height:g} m tall")
    return {"asset_model_id": mid, "version": n, "height_m": height, "parts": len(parts)}
