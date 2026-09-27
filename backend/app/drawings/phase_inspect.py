"""The `inspect` phase (spec §8.2): hash the file, run the format's reader, write inspection.json."""

from __future__ import annotations

import importlib
from pathlib import Path

from app.drawings import store
from app.jobs.cancellation import JobCancelled, JobFailure

# Format -> reader module. Tasks 4, 10 and 11 add pdf, dxf and landxml.
READERS: dict[str, str] = {
    "png": "app.drawings.raster_io",
    "jpg": "app.drawings.raster_io",
    "tif": "app.drawings.raster_io",
    "dxf": "app.drawings.dxf_flatten",
    "landxml": "app.drawings.landxml_lines",
    "pdf": "app.drawings.pdf",
}
MESSAGE = "Reading drawing"
HASH_SHARE = 0.2
CANCELLED = "reading the drawing was cancelled"


def _fail(idir: Path, message: str) -> None:
    """The inspection is `failed`, and its partial output (page thumbnails) is gone: a thumbnail of a
    failed read is never served."""
    for thumb in (idir / "thumbs").glob("*"):
        thumb.unlink(missing_ok=True)
    store.patch_json(idir / "inspection.json", state="failed", error=message)


def cancelled_before_start(ctx) -> None:
    """A queued inspect job cancelled before it ran: the runner never calls `run`, so settle it here."""
    _fail(store.inspection_dir(ctx.project, ctx.params["inspection_id"]), CANCELLED)


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
        ctx.check_cancelled()
    except JobCancelled:
        _fail(idir, CANCELLED)
        raise
    except JobFailure as e:
        if ctx.cancelled.is_set():
            _fail(idir, CANCELLED)
            raise JobCancelled() from e
        _fail(idir, str(e))
        raise
    except Exception as e:
        if ctx.cancelled.is_set():
            _fail(idir, CANCELLED)
            raise JobCancelled() from e
        _fail(idir, f"reading the drawing failed: {type(e).__name__}: {e}")
        raise
    stat = path.stat()
    store.patch_json(idir / "request.json", file_size=stat.st_size, mtime_ns=stat.st_mtime_ns)
    store.patch_json(idir / "inspection.json", state="ready", error=None, sha256=sha, **result.to_json())
    ctx.progress(1.0, "Drawing read")
    return {"inspection_id": iid}
