"""The `results_export` job: writes the requested formats into `exports/<stamp>/` (spec G2).

Written atomically from the caller's point of view: work happens in a `.partial-<stamp>` folder,
promoted to its final name only once every requested format has been written; a cancellation or a
failure removes the partial folder instead of leaving a half-written one behind.
"""

from __future__ import annotations

import logging
import os
import shutil
import time
from datetime import datetime
from pathlib import Path

from sqlalchemy import select

from app.db.models import Job
from app.exports import coco_out, csv_out, html_out, rows, yolo_out
from app.exports.rows import ExportImage
from app.jobs.registry import register_job_type
from app.jobs.runner import JobContext

CARD_PROGRESS_EVERY = 50
PARTIAL_PREFIX = ".partial-"
RENAME_RETRIES = 5
RENAME_RETRY_DELAY_S = 0.1
ACTIVE_JOB_STATES = ("queued", "running")

FORMAT_LABEL = {
    "csv": "Tables",
    "yolo": "YOLO labels",
    "coco": "COCO file",
    "html": "Report",
}

log = logging.getLogger(__name__)


def _now_local() -> datetime:
    """The export folder's stamp and the HTML report's "Exported ..." line read from this one call,
    so both name the same instant, in local time with its offset."""
    return datetime.now().astimezone()


def _name_for(stamp: str, n: int) -> str:
    return stamp if n == 1 else f"{stamp}_{n}"


def _reserve_partial_folder(base: Path, now: datetime) -> tuple[Path, str, int]:
    """Atomically creates `<base>/.partial-<stamp>[_n]`; returns it with the `(stamp, n)` its final
    name will start from.

    A candidate name is free only when *neither* its final folder *nor* its partial folder exists
    yet: checking only the partial name (an earlier version of this function did just that) can
    hand out a final name an already-promoted export already owns, and the eventual rename onto
    that existing directory fails on Windows ("Access is denied"). `mkdir()` on the partial folder
    is still the atomic reservation step for the partial name itself, so two exports racing on the
    same instant still cannot both win the same candidate.
    """
    stamp = now.strftime("%Y-%m-%d_%H%M%S")
    n = 1
    while True:
        name = _name_for(stamp, n)
        if (base / name).exists():
            n += 1
            continue
        partial = base / f"{PARTIAL_PREFIX}{name}"
        try:
            partial.mkdir(parents=True)
        except FileExistsError:
            n += 1
            continue
        return partial, stamp, n


def _promote(base: Path, partial: Path, stamp: str, n: int) -> Path:
    """Renames `partial` to its final name, resolving the two different reasons `os.replace` can
    refuse it on Windows.

    A `PermissionError` there means one of two things: the destination folder already exists
    (Windows refuses to replace a non-empty directory with one, so this is a real name collision —
    another export finished into it after we reserved ours) or something merely has the source or
    destination briefly open (a virus scanner, a search indexer). Only a plain `exists()` check
    tells the two apart. A collision moves on to the next candidate name with a fresh retry
    budget; anything else is answered with a short, bounded retry of the very same rename.
    """
    while True:
        name = _name_for(stamp, n)
        final = base / name
        attempt = 0
        while True:
            try:
                os.replace(partial, final)
                return final
            except PermissionError:
                if final.exists():
                    break  # a real collision: someone else finished into this name meanwhile
                attempt += 1
                if attempt >= RENAME_RETRIES:
                    raise
                time.sleep(RENAME_RETRY_DELAY_S)
        n += 1


def _has_active_results_export(handle) -> bool:
    with handle.session() as s:
        row = s.execute(
            select(Job.id).where(Job.type == "results_export", Job.state.in_(ACTIVE_JOB_STATES))
        ).first()
    return row is not None


def sweep_partial_exports(handle) -> None:
    """Removes `exports/.partial-<stamp>` folders a crash left behind (spec G2, N2).

    Only ever removes an entry that is directly named `.partial-*`, is not a symlink, and really
    resolves to a direct child of this project's `exports` folder (never a link pointing somewhere
    else). Never runs while a `results_export` job for this project is queued or running — there
    should be none at project-open time, when this is called, but the check costs nothing and
    removes any doubt if that ever changes.
    """
    exports_dir = handle.exports_dir
    if not exports_dir.is_dir():
        return
    if _has_active_results_export(handle):
        return
    root = exports_dir.resolve()
    for entry in exports_dir.glob(f"{PARTIAL_PREFIX}*"):
        if entry.is_symlink():
            continue
        try:
            resolved = entry.resolve()
        except OSError:
            continue
        if resolved.parent != root or not resolved.is_dir():
            continue
        shutil.rmtree(resolved, ignore_errors=True)


def _box_count(images: list[ExportImage]) -> int:
    return sum(len(i.boxes) for i in images)


def _project_name(handle) -> str:
    with handle.session() as s:
        return handle.row(s).name


def _write_formats(
    ctx: JobContext,
    images: list[ExportImage],
    classes: list[dict],
    folder: Path,
    handle,
    formats: list[str],
    include_unreviewed: bool,
    export_time: datetime,
) -> list[str]:
    files: list[str] = []
    total = len(formats)
    for done, fmt in enumerate(formats):
        ctx.check_cancelled()
        if fmt == "csv":
            files += csv_out.write(images, classes, folder)
        elif fmt == "yolo":
            files += yolo_out.write(images, classes, folder)
        elif fmt == "coco":
            files += coco_out.write(images, classes, folder)
        elif fmt == "html":

            def on_card(card_done: int, card_total: int, _format_index: int = done) -> None:
                if card_done % CARD_PROGRESS_EVERY == 0 or card_done == card_total:
                    ctx.check_cancelled()
                fraction = (_format_index + card_done / max(card_total, 1)) / total
                ctx.progress(fraction, f"report: {card_done}/{card_total} images")

            files += html_out.write(
                images,
                classes,
                folder,
                project_name=_project_name(handle),
                export_time=export_time,
                settings={"formats": formats, "include_unreviewed": include_unreviewed},
                image_root=handle.folder,
                on_card=on_card,
            )
        ctx.progress((done + 1) / total, f"{FORMAT_LABEL[fmt]} written ({done + 1} of {total})")
    return files


@register_job_type("results_export")
def run_export(ctx: JobContext) -> dict:
    handle = ctx.project
    formats: list[str] = list(ctx.params["formats"])
    include_unreviewed = bool(ctx.params.get("include_unreviewed", False))
    image_ids = ctx.params.get("image_ids")

    ctx.check_cancelled()
    images, classes = rows.load(handle, include_unreviewed, image_ids)

    handle.exports_dir.mkdir(parents=True, exist_ok=True)
    now_local = _now_local()
    partial, stamp, n = _reserve_partial_folder(handle.exports_dir, now_local)
    try:
        files = _write_formats(
            ctx, images, classes, partial, handle, formats, include_unreviewed, now_local
        )
        final = _promote(handle.exports_dir, partial, stamp, n)
    except Exception:
        shutil.rmtree(partial, ignore_errors=True)
        raise

    rel_folder = "/".join(final.relative_to(handle.folder).parts)
    ctx.log.info(
        "exported %s images / %s boxes to %s: %s", len(images), _box_count(images), rel_folder, files
    )
    return {
        "folder": rel_folder,
        "files": files,
        "image_count": len(images),
        "box_count": _box_count(images),
    }
