"""`image_metadata`: re-read camera metadata for images imported before migration 0011 (spec
2026-09-26-image-inspection §7.3 "Backfill", §15).

Bounded: one directory listing per source, keyset batches of 100 rows, one original per image
(header only). Rows whose original is missing or ambiguous keep their XMP columns and get EXIF
from the prepared copy. Every processed row is stamped with METADATA_VERSION, so the on-open
check never loops (plan ruling 1).
"""

from __future__ import annotations

import logging
from pathlib import Path

from PIL import Image as PILImage
from sqlalchemy import func, select, true, update

from app.datasets.prepare import (
    THUMB_SIDE,
    XMP_FIELDS,
    CameraMeta,
    list_images,
    read_camera,
    write_thumbnail,
)
from app.db.models import Image, Job, Source
from app.errors import AppError
from app.imagery.metadata import METADATA_VERSION, camera_columns
from app.jobs.registry import register_job_type
from app.jobs.runner import JobContext

JOB_TYPE = "image_metadata"
BATCH = 100
LIVE_STATES = ("queued", "running")
XMP_COLUMNS = (*XMP_FIELDS.values(), "lrf_distance_m")
log = logging.getLogger(__name__)


def _pending(force: bool):
    if force:
        return true()
    return Image.metadata_version < METADATA_VERSION  # C0: non-null, default 0


def _stem_index(folder: Path) -> dict[str, list[Path]]:
    """One listing per source: lower-cased stem -> originals with that stem."""
    index: dict[str, list[Path]] = {}
    if not folder.is_dir():
        return index
    for path in list_images(folder):
        index.setdefault(path.stem.lower(), []).append(path)
    return index


def _find_original(folder: Path, image: Image, stems: dict[str, list[Path]]) -> Path | None:
    if image.original_name:
        named = folder / image.original_name
        if named.is_file():
            return named
    candidates = stems.get(Path(image.path).stem.lower(), [])
    return candidates[0] if len(candidates) == 1 else None


def _read(path: Path, *, original: bool) -> CameraMeta | None:
    try:
        with PILImage.open(path) as opened:
            return read_camera(opened, original=original)
    except Exception as e:
        log.warning("could not read camera metadata from %s: %s", path, e)
        return None


def _ensure_thumbnail(handle, image: Image) -> None:
    dest = handle.thumbs_dir / f"{image.id}.jpg"
    if dest.exists():
        return
    try:
        with PILImage.open(handle.folder / image.path) as im:
            im.draft("RGB", (THUMB_SIDE, THUMB_SIDE))  # DCT-scaled decode: cheap
            write_thumbnail(im, dest)
    except Exception as e:
        log.warning("could not write the thumbnail of %s: %s", image.path, e)


def _columns(handle, folder: Path, image: Image, stems) -> tuple[dict, bool]:
    """The new column values and whether the original was found."""
    original = _find_original(folder, image, stems)
    meta = _read(original, original=True) if original is not None else None
    if meta is not None:
        cols = camera_columns(meta, image.lat, image.lon)
        cols["original_name"] = original.relative_to(folder).as_posix()
        return cols, True
    meta = _read(handle.folder / image.path, original=False) or CameraMeta()
    for name in XMP_COLUMNS:  # ruling 2: what only the original can say is kept
        setattr(meta, name, getattr(image, name))
    return camera_columns(meta, image.lat, image.lon), False


@register_job_type(JOB_TYPE)
def run_image_metadata(ctx: JobContext) -> dict:
    handle = ctx.project
    force = bool(ctx.params.get("force", False))
    with handle.session() as s:
        sources = list(s.execute(select(Source.id, Source.folder).order_by(Source.id)).all())
        total = s.execute(select(func.count()).select_from(Image).where(_pending(force))).scalar_one()
    done = updated = skipped = 0
    ctx.progress(0, f"0 / {total} images")
    for source_id, folder_text in sources:
        folder = Path(folder_text)
        stems: dict[str, list[Path]] | None = None
        last = ""
        while True:
            ctx.check_cancelled()
            with handle.session() as s:
                batch = list(
                    s.execute(
                        select(Image)
                        .where(Image.source_id == source_id, _pending(force), Image.id > last)
                        .order_by(Image.id)
                        .limit(BATCH)
                    ).scalars()
                )
                for row in batch:
                    s.expunge(row)
            if not batch:
                break
            if stems is None:
                stems = _stem_index(folder)
            updates = []
            for image in batch:
                cols, found = _columns(handle, folder, image, stems)
                updated, skipped = updated + found, skipped + (not found)
                _ensure_thumbnail(handle, image)
                updates.append((image.id, cols))
            with handle.session() as s:
                for image_id, cols in updates:
                    s.execute(update(Image).where(Image.id == image_id).values(**cols))
            last = batch[-1].id
            done += len(batch)
            ctx.progress(done / max(total, 1), f"{done} / {total} images")
            ctx.publish("images.changed", {"image_ids": [i.id for i in batch]})
    ctx.log.info("camera metadata: %d images, %d from originals, %d EXIF only", done, updated, skipped)
    return {"images": done, "updated": updated, "skipped": skipped}


def _live(handle) -> Job | None:
    with handle.session() as s:
        job = s.execute(
            select(Job).where(Job.type == JOB_TYPE, Job.state.in_(LIVE_STATES)).limit(1)
        ).scalar_one_or_none()
        if job is not None:
            s.expunge(job)
        return job


def submit(handle, runner, *, force: bool) -> Job:
    """Queue a refresh, or 409 `job_running` with the live one's id: one refresh at a time
    (plan ruling 8; the contract's `refreshImageMetadata` 409)."""
    live = _live(handle)
    if live is not None:
        raise AppError("job_running", "Camera metadata is already being refreshed.", 409, {"job_id": live.id})
    return runner.submit(handle, JOB_TYPE, {"force": force})


def submit_if_pending(handle, runner) -> Job | None:
    """On project open: one LIMIT 1 read; queue the backfill only when rows predate this version
    and no refresh is live. Never raises for a live job."""
    with handle.session() as s:
        pending = s.execute(select(Image.id).where(_pending(False)).limit(1)).scalar_one_or_none()
    if pending is None or _live(handle) is not None:
        return None
    return submit(handle, runner, force=False)
