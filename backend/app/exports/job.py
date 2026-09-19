"""The `results_export` job: writes the requested formats into `exports/<stamp>/` (spec G2)."""

from __future__ import annotations

from datetime import UTC, datetime
from pathlib import Path

from app.exports import coco_out, csv_out, html_out, rows, yolo_out
from app.exports.rows import ExportImage
from app.jobs.registry import register_job_type
from app.jobs.runner import JobContext

CARD_PROGRESS_EVERY = 50


def _stamp_folder(base: Path, now: datetime) -> Path:
    """`<base>/<YYYY-MM-DD_HHMMSS>`, or `_2`, `_3`, ... on the rare second-collision."""
    stamp = now.strftime("%Y-%m-%d_%H%M%S")
    folder = base / stamp
    n = 2
    while folder.exists():
        folder = base / f"{stamp}_{n}"
        n += 1
    return folder


def _box_count(images: list[ExportImage]) -> int:
    return sum(len(i.boxes) for i in images)


def _project_name(handle) -> str:
    with handle.session() as s:
        return handle.row(s).name


@register_job_type("results_export")
def run_export(ctx: JobContext) -> dict:
    handle = ctx.project
    formats: list[str] = list(ctx.params["formats"])
    include_unreviewed = bool(ctx.params.get("include_unreviewed", False))
    image_ids = ctx.params.get("image_ids")

    ctx.check_cancelled()
    images, classes = rows.load(handle, include_unreviewed, image_ids)

    handle.exports_dir.mkdir(parents=True, exist_ok=True)
    folder = _stamp_folder(handle.exports_dir, datetime.now(UTC))
    folder.mkdir(parents=True)

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

            def on_card(card_done: int, card_total: int) -> None:
                if card_done % CARD_PROGRESS_EVERY == 0 or card_done == card_total:
                    ctx.check_cancelled()

            files += html_out.write(
                images,
                classes,
                folder,
                project_name=_project_name(handle),
                export_time=datetime.now(UTC),
                settings={"formats": formats, "include_unreviewed": include_unreviewed},
                image_root=handle.folder,
                on_card=on_card,
            )
        ctx.progress((done + 1) / total, f"{fmt} written")

    rel_folder = "/".join(folder.relative_to(handle.folder).parts)
    ctx.log.info(
        "exported %s images / %s boxes to %s: %s", len(images), _box_count(images), rel_folder, files
    )
    return {
        "folder": rel_folder,
        "files": files,
        "image_count": len(images),
        "box_count": _box_count(images),
    }
