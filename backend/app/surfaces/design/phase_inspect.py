"""The `inspect` phase (spec §4.1): hash the file, parse every candidate into the cache, thumbnails."""

from __future__ import annotations

import importlib
from pathlib import Path

from sqlalchemy import select

from app.db.models import Surface
from app.jobs.cancellation import JobCancelled, JobFailure
from app.surfaces.design import store

READERS = {
    "landxml": "app.surfaces.design.landxml",
    "dxf": "app.surfaces.design.dxf",
    "geotiff": "app.surfaces.design.dem",
}
MESSAGE = "Reading design file"
HASH_SHARE = 0.2


def default_target(handle) -> str | None:
    """The newest ready cloud surface (spec §5 defaults table)."""
    with handle.session() as s:
        row = s.execute(
            select(Surface.id)
            .where(Surface.kind == "cloud_dsm", Surface.status == "ready")
            .order_by(Surface.created_at.desc())
            .limit(1)
        ).first()
    return row[0] if row else None


def _fail(idir: Path, message: str) -> None:
    store.patch_json(idir / "inspection.json", state="failed", error=message)


def run(ctx) -> dict:
    iid, path = ctx.params["inspection_id"], Path(ctx.params["path"])
    idir = store.inspection_dir(ctx.project, iid)
    try:
        fmt = store.read_json(idir / "inspection.json")["format"]
        if not path.is_file():
            raise JobFailure(f"{path.name} is no longer there; choose the file again")
        sha = store.sha256_file(
            path,
            progress=lambda f: ctx.progress(HASH_SHARE * f, MESSAGE),
            check_cancelled=ctx.check_cancelled,
        )
        reader = importlib.import_module(READERS[fmt])
        result = reader.inspect_file(
            path,
            idir,
            progress=lambda f, m=MESSAGE: ctx.progress(HASH_SHARE + (0.98 - HASH_SHARE) * f, m),
            check_cancelled=ctx.check_cancelled,
        )
        # The reader can return an instant after delete_design_inspection cancelled the job: check
        # once more before treating this as a success and writing to a folder that may be gone.
        ctx.check_cancelled()
    except JobCancelled:
        _fail(idir, "reading the file was cancelled")
        raise
    except JobFailure as e:
        if ctx.cancelled.is_set():
            # A write the reader made after its last check_cancelled() hit the folder
            # delete_design_inspection already removed: that FileNotFoundError (or whatever the
            # reader wraps into a JobFailure) is the cancellation, not a real failure.
            _fail(idir, "reading the file was cancelled")
            raise JobCancelled() from e
        _fail(idir, str(e))
        raise
    except Exception as e:
        if ctx.cancelled.is_set():
            _fail(idir, "reading the file was cancelled")
            raise JobCancelled() from e
        _fail(idir, f"reading the file failed: {type(e).__name__}: {e}")
        raise
    stat = path.stat()
    store.write_json(
        idir / "internal.json", {**result.internal, "file_size": stat.st_size, "mtime_ns": stat.st_mtime_ns}
    )
    store.patch_json(
        idir / "inspection.json",
        state="ready",
        error=None,
        sha256=sha,
        detected=result.detected.to_json(),
        candidates=[c.to_json() for c in result.candidates],
        default_target_surface_id=default_target(ctx.project),
    )
    ctx.progress(1.0, f"{len(result.candidates)} part(s) found")
    return {"inspection_id": iid, "candidate_count": len(result.candidates)}
