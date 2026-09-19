"""The `results_export` job: writes the requested formats into `exports/<stamp>/` (spec G2).

Written atomically from the caller's point of view: work happens in a `.partial-<stamp>` folder,
renamed to its final name only once every requested format has been written; a cancellation or a
failure removes the partial folder instead of leaving a half-written one behind.
"""

from __future__ import annotations

import os
import shutil
from datetime import UTC, datetime
from pathlib import Path

from app.exports import coco_out, csv_out, html_out, rows, yolo_out
from app.exports.rows import ExportImage
from app.jobs.registry import register_job_type
from app.jobs.runner import JobContext

CARD_PROGRESS_EVERY = 50
PARTIAL_PREFIX = ".partial-"

FORMAT_LABEL = {
    "csv": "Tables",
    "yolo": "YOLO labels",
    "coco": "COCO file",
    "html": "Report",
}


def _reserve_partial_folder(base: Path, now: datetime) -> tuple[Path, str]:
    """Atomically creates `<base>/.partial-<stamp>[_n]`; returns it with the final name it will take.

    `mkdir()` itself is the reservation (`FileExistsError` on a same-second collision just tries the
    next suffix), so two exports started in the same second can never race onto the same folder.
    """
    stamp = now.strftime("%Y-%m-%d_%H%M%S")
    n = 1
    while True:
        name = stamp if n == 1 else f"{stamp}_{n}"
        partial = base / f"{PARTIAL_PREFIX}{name}"
        try:
            partial.mkdir(parents=True)
        except FileExistsError:
            n += 1
            continue
        return partial, name


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
                export_time=datetime.now().astimezone(),
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
    partial, name = _reserve_partial_folder(handle.exports_dir, datetime.now(UTC))
    try:
        files = _write_formats(ctx, images, classes, partial, handle, formats, include_unreviewed)
    except Exception:
        shutil.rmtree(partial, ignore_errors=True)
        raise

    final = handle.exports_dir / name
    os.replace(partial, final)

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
