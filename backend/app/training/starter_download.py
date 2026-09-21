"""On-demand, cancellable starter acquisition. No network work occurs on catalogue reads."""

import threading
import uuid
from pathlib import Path
from urllib.request import urlopen

from app.jobs.cancellation import JobFailure
from app.jobs.runner import JobContext
from app.training import starter

ASSET_BASE = "https://github.com/ultralytics/assets/releases/download/v8.4.0"
CHUNK_BYTES = 1024 * 1024
MAX_BYTES = 1024 * 1024 * 1024
_download_lock = threading.Lock()


def download_weights(ctx: JobContext, target: Path) -> None:
    """Stream one official asset to an isolated partial file; publish only complete downloads."""
    temporary = target.with_suffix(f".{uuid.uuid4().hex}.part")
    try:
        ctx.check_cancelled()
        with urlopen(f"{ASSET_BASE}/{target.name}", timeout=15) as response:
            total = int(response.headers.get("Content-Length", 0))
            if total > MAX_BYTES:
                raise JobFailure("This model download exceeds the 1 GB limit.")
            received = 0
            with temporary.open("wb") as output:
                while True:
                    ctx.check_cancelled()
                    chunk = response.read(CHUNK_BYTES)
                    if not chunk:
                        break
                    received += len(chunk)
                    if received > MAX_BYTES:
                        raise JobFailure("This model download exceeds the 1 GB limit.")
                    output.write(chunk)
                    fraction = min(0.85, received / total * 0.85) if total else 0.1
                    ctx.progress(fraction, f"Downloading {target.stem}: {received / 1_048_576:.1f} MB")
            if received == 0 or (total and received != total):
                raise JobFailure("The model download was incomplete. Check your connection and try again.")
        ctx.check_cancelled()
        temporary.replace(target)
    finally:
        temporary.unlink(missing_ok=True)


def run_acquire_starter(ctx: JobContext) -> dict:
    key = ctx.params["key"]
    if key not in starter.STARTER_KEYS:
        raise JobFailure("Choose a supported detection starter model.")
    bundle, cache = Path(ctx.params["bundle_dir"]), Path(ctx.params["cache_dir"])
    ctx.progress(0, f"Preparing {key}")
    # At most one model is downloaded/loaded at once, bounding RAM and avoiding cache races.
    while not _download_lock.acquire(timeout=0.25):
        ctx.check_cancelled()
        ctx.progress(0, "Waiting for the other model download")
    downloaded = False
    try:
        ctx.check_cancelled()
        folder = bundle if (bundle / f"{key}.pt").is_file() else cache
        target = folder / f"{key}.pt"
        if not target.is_file():
            cache.mkdir(parents=True, exist_ok=True)
            download_weights(ctx, target)
            downloaded = True
        ctx.check_cancelled()
        ctx.progress(0.9, f"Checking and adding {key}")
        try:
            row = starter.import_starter(ctx.project, folder, key, ctx.params.get("name"))
        except Exception:
            if downloaded:
                target.unlink(missing_ok=True)
            raise
        ctx.progress(1, f"{key} is ready")
        return {"model_id": row.id}
    finally:
        _download_lock.release()
