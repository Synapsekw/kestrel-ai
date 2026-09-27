"""The `assist_acquire` library job (spec 2026-09-26-image-inspection §10 Weights; I-C0 Ruling 8).

Params `{key}` download the weights through `training/starter_download.download_weights` (the same
release as the YOLO starters); `{key, path}` copy a local file for air-gapped machines. Either way the
bytes land in a private staging folder, are checked against the pinned size and sha256, and only then
replace the published file, so a bad download or a wrong file never damages the existing one.
"""

import os
import shutil
import threading
from pathlib import Path

from sqlalchemy import select

from app.assist import catalogue
from app.db.models import Job
from app.jobs.cancellation import JobFailure
from app.jobs.registry import register_job_type
from app.jobs.runner import JobContext
from app.training import starter_download

JOB_TYPE = "assist_acquire"
LIVE_STATES = ("queued", "running")
_acquire_lock = threading.Lock()


def live_acquire_id(lib, key: str) -> str | None:
    """The queued or running `assist_acquire` for this key, if any (few rows; params matched here)."""
    with lib.session() as s:
        rows = s.execute(
            select(Job.id, Job.params).where(Job.type == JOB_TYPE, Job.state.in_(LIVE_STATES))
        ).all()
    return next((r.id for r in rows if (r.params or {}).get("key") == key), None)


def _copy(ctx: JobContext, source: Path, target: Path) -> None:
    if not source.is_file():
        raise JobFailure(f"{source} no longer exists.")
    total = source.stat().st_size or 1
    copied = 0
    with source.open("rb") as src, target.open("wb") as out:
        while chunk := src.read(catalogue.CHUNK_BYTES):
            ctx.check_cancelled()
            out.write(chunk)
            copied += len(chunk)
            ctx.progress(
                min(0.85, copied / total * 0.85), f"Copying {source.name}: {copied / 1_048_576:.1f} MB"
            )


@register_job_type(JOB_TYPE)
def run_assist_acquire(ctx: JobContext) -> dict:
    """`ctx.project` is the library handle. Params: {key} or {key, path}."""
    p = ctx.params
    spec = catalogue.ASSIST_MODELS.get(p.get("key", ""))
    if spec is None:
        raise JobFailure(f"{p.get('key')} is not a smart polygon model this app knows.")
    target = catalogue.weights_path(ctx.project.folder, spec)
    ctx.progress(0, f"Preparing {spec.name}")
    while not _acquire_lock.acquire(timeout=0.25):
        ctx.check_cancelled()
        ctx.progress(0, "Waiting for the other smart polygon download")
    try:
        if target.is_file() and catalogue.file_ok(target, spec):
            ctx.progress(1, f"{spec.name} is ready")
            return {"key": spec.key}
        staging = target.parent / f".staging-{ctx.job_id}"
        staging.mkdir(parents=True, exist_ok=True)
        staged = staging / spec.file_name
        try:
            if p.get("path"):
                _copy(ctx, Path(p["path"]), staged)
            else:
                starter_download.download_weights(ctx, staged)
            ctx.check_cancelled()
            ctx.progress(0.9, f"Checking {spec.name}")
            if staged.stat().st_size != spec.size_bytes or catalogue.sha256_file(staged) != spec.sha256:
                raise JobFailure(
                    f"The file does not match the {spec.name} checksum; it is damaged or a different model."
                )
            os.replace(staged, target)
            catalogue.forget_verified()
        finally:
            shutil.rmtree(staging, ignore_errors=True)
        ctx.progress(1, f"{spec.name} is ready")
        ctx.log.info("assist model %s published at %s", spec.key, target)
        return {"key": spec.key}
    finally:
        _acquire_lock.release()
