"""The `import` job: prepare a source folder into `images/<site>/` (spec section 5).

Preparation runs in a process pool; this thread batches the DB writes, reports progress and
publishes `images.changed` so the Data Manager can grow while the import is still running.
"""

from __future__ import annotations

import json
import os
import threading
from concurrent.futures import ProcessPoolExecutor, as_completed
from contextlib import contextmanager
from datetime import UTC, datetime
from pathlib import Path

from sqlalchemy import func, select

from app.datasets.grouping import find_duplicates, group_key
from app.datasets.prepare import Prepared, list_images, process_one, unique_dest
from app.db.base import new_id
from app.db.models import Image, Source
from app.imagery import metadata as image_metadata
from app.jobs.cancellation import JobCancelled
from app.jobs.registry import register_job_type
from app.jobs.runner import JobContext
from app.projects.schemas import ImportSettings
from app.projects.service import ProjectHandle

CHUNK = 50  # images submitted to the pool (and written to the DB) at a time
DUPLICATES_FILE = ".duplicates.json"


def _relative(handle: ProjectHandle, path: Path) -> str:
    return path.relative_to(handle.folder).as_posix()


def _reserved_names(site: str, foreign_paths: set[str], foreign_duplicates: set[str]) -> set[str]:
    """Lower-cased file names inside `images/<site>/` that another source already owns."""
    prefix = f"images/{site}/"
    names = {p.rsplit("/", 1)[-1].lower() for p in foreign_paths if p.startswith(prefix)}
    return names | {n.lower() for n in foreign_duplicates}


def _read_duplicates(dest_dir: Path) -> dict[str, dict]:
    path = dest_dir / DUPLICATES_FILE
    if not path.exists():
        return {}
    try:
        value = json.loads(path.read_text("utf-8"))
        return value if isinstance(value, dict) else {}
    except (OSError, ValueError):
        return {}


_import_locks: dict[str, threading.Lock] = {}
_import_locks_guard = threading.Lock()
IMPORT_LOCK_POLL_S = 0.25


@contextmanager
def hold_import_lock(project_id: str, cancelled: threading.Event, log=None):
    """Imports into one project run one at a time.

    Two imports of the same site used to collide on the dedupe snapshot each took at its start.
    The wait is polled so a queued import can still be cancelled while it waits for the previous one.
    """
    with _import_locks_guard:
        lock = _import_locks.setdefault(project_id, threading.Lock())
    waited = False
    while not lock.acquire(timeout=IMPORT_LOCK_POLL_S):
        if cancelled.is_set():
            raise JobCancelled()
        if not waited and log is not None:
            log.info("waiting for the previous import into this project to finish")
        waited = True
    try:
        yield
    finally:
        lock.release()


@register_job_type("import")
def run_import(ctx: JobContext) -> dict:
    with hold_import_lock(ctx.project.id, ctx.cancelled, ctx.log):
        return _run_import(ctx)


def _run_import(ctx: JobContext) -> dict:
    handle = ctx.project
    source_id = ctx.params["source_id"]
    ctx.check_cancelled()
    with handle.session() as s:
        source = s.get(Source, source_id)
        if source is None:
            raise ValueError(f"source {source_id} no longer exists")
        folder, site = Path(source.folder), source.site
        settings = ImportSettings(**(source.settings or {}))
        all_paths = set(s.execute(select(Image.path)).scalars().all())
        own_paths = set(s.execute(select(Image.path).where(Image.source_id == source_id)).scalars().all())
        known_hashes = list(
            s.execute(
                select(Image.path, Image.phash)
                .where(Image.source_id == source_id, Image.phash.is_not(None))
                .order_by(Image.path)
            ).all()
        )

    dest_dir = handle.images_dir / site
    dest_dir.mkdir(parents=True, exist_ok=True)
    recorded = _read_duplicates(dest_dir)
    own_duplicates = {n for n, v in recorded.items() if v.get("source_id") == source_id}
    sources = list_images(folder)
    ctx.log.info("%d files in %s", len(sources), folder)

    # Two sources may share a site, so names another source already owns (including the names its
    # duplicates used up) are off limits; this source's own names stay free so a re-import lands on
    # its existing rows instead of importing everything again.
    taken = _reserved_names(site, all_paths - own_paths, set(recorded) - own_duplicates)
    planned = [(p, unique_dest(dest_dir, p.stem, taken)) for p in sources]
    todo = []
    for src, dest in planned:
        if dest.name not in own_duplicates and _relative(handle, dest) not in all_paths:
            todo.append((src, dest))
    skipped = len(planned) - len(todo)
    ctx.check_cancelled()

    # Ids are assigned here so the worker can write each frame's thumbnail under its final name.
    ids = {str(dest): new_id() for _, dest in todo}
    thumbs = {dest: str(handle.thumbs_dir / f"{image_id}.jpg") for dest, image_id in ids.items()}
    results = _prepare_all(ctx, todo, settings, thumbs)
    prepared = [r for r in results if r.action != "failed"]
    failed = len(results) - len(prepared)
    prepared.sort(key=lambda r: r.dest)

    # Previously imported images come first, so a new frame near an old one is the duplicate.
    items = [(Path(p).name, h) for p, h in known_hashes]
    items += [(Path(r.dest).name, r.phash) for r in prepared]
    new_names = {Path(r.dest).name for r in prepared}
    found = find_duplicates(items, settings.dedupe_threshold)
    duplicates = {name: kept for name, kept in found.items() if name in new_names}

    for name in duplicates:
        dest = dest_dir / name
        dest.unlink(missing_ok=True)  # our own copy, never the original
        if str(dest) in thumbs:
            Path(thumbs[str(dest)]).unlink(missing_ok=True)
    recorded.update(
        {
            name: {"duplicate_of": kept, "hamming": d, "source_id": source_id}
            for name, (kept, d) in duplicates.items()
        }
    )
    (dest_dir / DUPLICATES_FILE).write_text(json.dumps(recorded, indent=2), "utf-8")

    keep = [r for r in prepared if Path(r.dest).name not in duplicates]
    imported = _write_rows(ctx, source_id, site, keep, settings.group_regex, folder=folder, ids=ids)

    with handle.session() as s:
        source = s.get(Source, source_id)
        source.image_count = s.execute(
            select(func.count()).select_from(Image).where(Image.source_id == source_id)
        ).scalar_one()
        source.duplicate_count = len(recorded)
        source.imported_at = datetime.now(UTC)
        # The survey date is the earliest EXIF capture in the import; one the operator set is kept.
        if source.captured_on is None:
            first = s.execute(
                select(func.min(Image.capture_time)).where(Image.source_id == source_id)
            ).scalar_one()
            if first is not None:
                source.captured_on = first.date()
    ctx.log.info(
        "imported %d, duplicates %d, failed %d, skipped %d", imported, len(duplicates), failed, skipped
    )
    return {
        "source_id": source_id,
        "imported": imported,
        "duplicates": len(duplicates),
        "failed": failed,
        "skipped": skipped,
    }


def _prepare_all(
    ctx: JobContext, todo: list[tuple[Path, Path]], settings: ImportSettings, thumbs: dict[str, str]
) -> list[Prepared]:
    """Convert every planned file in a process pool, checking cancellation as results arrive."""
    if not todo:
        return []
    workers = max(1, min(os.cpu_count() or 1, len(todo)))
    results: list[Prepared] = []
    ex = ProcessPoolExecutor(max_workers=workers)
    try:
        for start in range(0, len(todo), CHUNK):
            chunk = todo[start : start + CHUNK]
            ctx.check_cancelled()
            futures = [
                ex.submit(
                    process_one,
                    str(src),
                    str(dest),
                    settings.max_side,
                    settings.quality,
                    thumbs.get(str(dest), ""),
                )
                for src, dest in chunk
            ]
            for future in as_completed(futures):
                ctx.check_cancelled()
                result = future.result()
                results.append(result)
                if result.action == "failed":
                    ctx.log.warning("failed %s: %s", result.dest, result.error)
            ctx.progress(len(results) / (2 * len(todo)), f"prepared {len(results)} / {len(todo)} images")
    finally:
        ex.shutdown(wait=True, cancel_futures=True)
    return results


def _write_rows(
    ctx: JobContext,
    source_id: str,
    site: str,
    keep: list[Prepared],
    regex: str,
    *,
    folder: Path,
    ids: dict[str, str],
) -> int:
    """Insert Image rows in batches so the UI sees the import grow."""
    handle = ctx.project
    if not keep:
        return 0
    imported = 0
    for start in range(0, len(keep), CHUNK):
        ctx.check_cancelled()
        batch = keep[start : start + CHUNK]
        with handle.session() as s:
            for r in batch:
                name = Path(r.dest).name
                s.add(
                    Image(
                        id=ids.get(r.dest) or new_id(),
                        path=_relative(handle, Path(r.dest)),
                        width=r.width,
                        height=r.height,
                        source_id=source_id,
                        capture_time=r.capture_time,
                        lat=r.lat,
                        lon=r.lon,
                        alt=r.alt,
                        phash=r.phash,
                        group_key=group_key(name, regex, r.lat, r.lon, site),
                        original_name=_original_name(folder, r.src),
                        **image_metadata.camera_columns(r.camera, r.lat, r.lon),
                    )
                )
        imported += len(batch)
        ctx.progress(0.5 + imported / (2 * len(keep)), f"{imported} / {len(keep)} images")
        ctx.publish("images.changed", {"source_id": source_id, "count": len(batch)})
    return imported


def _original_name(folder: Path, src: str) -> str | None:
    """The original's path relative to `Source.folder`, which the backfill uses to find it again."""
    if not src:
        return None
    try:
        return Path(src).relative_to(folder).as_posix()
    except ValueError:
        return Path(src).name
