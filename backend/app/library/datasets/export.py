"""The `dataset` library job: write a built dataset as a YOLO folder (foundation F §12.2 step 3).

Today's materialise, generalised to items across projects. It writes `images/`, `labels/` and
`data.yaml` under `<library>/datasets/<slug>-<id8>/`, hard-linking each image when the library and
the project share a volume and copying otherwise (`materialise._place`). It builds into a
`.partial` folder and swaps that in only when complete, so a failed or cancelled export never
leaves a half-written folder where training would read it. Bounded: 500 items per page, per project.
"""

from __future__ import annotations

import os
import shutil
from collections.abc import Callable, Iterator
from pathlib import Path

from sqlalchemy import select

from app.datasets.materialise import (
    PROGRESS_EVERY,
    _clip01,
    _label_text,
    _place,
    data_yaml,
    detect_boxes,
    materialised_name,
)
from app.db.models import Image
from app.geometry import corners_of
from app.jobs.cancellation import JobFailure
from app.jobs.registry import register_job_type
from app.jobs.runner import JobContext
from app.library.datasets.service import SEGMENT_NOT_SUPPORTED, folder_name
from app.library.datasets.sources import open_source
from app.library.db import LibraryDataset, LibraryDatasetItem, LibraryDatasetSource

PAGE = 500
SPLITS = ("train", "val")


def obb_label_text(labels: list[dict], class_index: dict[str, int], width: int, height: int) -> str:
    """YOLO-OBB lines: `index x1 y1 x2 y2 x3 y3 x4 y4`, each corner normalised and clipped to the
    frame (Ultralytics refuses a whole label file when one value is outside 0..1)."""
    lines = []
    for b in labels:
        index = class_index.get(b["type_id"])
        if index is None:
            continue
        corners = corners_of(b["x"], b["y"], b["w"], b["h"], b.get("angle", 0.0))
        coords = " ".join(f"{_clip01(px / width):.6f} {_clip01(py / height):.6f}" for px, py in corners)
        lines.append(f"{index} {coords}")
    return "\n".join(lines) + ("\n" if lines else "")


def _label_text_for(
    task: str, labels: list[dict], class_index: dict[str, int], width: int, height: int
) -> str:
    if task == "obb":
        return obb_label_text(labels, class_index, width, height)
    boxes = [
        {
            "class_id": b["type_id"],
            "x": b["x"],
            "y": b["y"],
            "w": b["w"],
            "h": b["h"],
            "angle": b.get("angle", 0.0),
        }
        for b in labels
    ]
    return _label_text(detect_boxes(boxes), class_index, width, height)


def _item_pages(lib, dataset_id: str, project_id: str) -> Iterator[list[LibraryDatasetItem]]:
    after = ""
    while True:
        with lib.session() as s:
            page = list(
                s.execute(
                    select(LibraryDatasetItem)
                    .where(
                        LibraryDatasetItem.dataset_id == dataset_id,
                        LibraryDatasetItem.project_id == project_id,
                        LibraryDatasetItem.image_id > after,
                    )
                    .order_by(LibraryDatasetItem.image_id)
                    .limit(PAGE)
                ).scalars()
            )
            for item in page:
                s.expunge(item)
        if not page:
            return
        yield page
        after = page[-1].image_id


def _set_export_state(lib, dataset_id: str, state: str, export_path: str | None = None) -> None:
    with lib.session() as s:
        row = s.get(LibraryDataset, dataset_id)
        if row is not None:
            row.export_state = state
            if export_path is not None:
                row.export_path = export_path


def export_dataset(ctx: JobContext, dataset_id: str, progress: Callable[[float, str], None]) -> dict:
    """Write the export of `dataset_id` inside the running job `ctx` (an export job or a train job)."""
    lib, registry = ctx.project, ctx.runner.projects
    with lib.session() as s:
        row = s.get(LibraryDataset, dataset_id)
        if row is None:
            raise JobFailure("This dataset no longer exists.")
        if row.origin != "built":
            raise JobFailure("A legacy dataset trains from its own folder; it cannot be exported.")
        if row.task == "segment":
            raise JobFailure(SEGMENT_NOT_SUPPORTED)
        if row.state != "ready":
            raise JobFailure(f"Dataset {row.name} is not built yet.")
        row.export_state, row.export_job_id = "building", ctx.job_id
        task, classes, name = row.task, list(row.classes or []), folder_name(row)
        total = int((row.counts or {}).get("images") or 0)
        sources = [
            (src.project_id, src.project_name, src.project_folder)
            for src in s.execute(
                select(LibraryDatasetSource).where(LibraryDatasetSource.dataset_id == dataset_id)
            ).scalars()
        ]
    final = lib.datasets_dir / name
    staging = lib.datasets_dir / f".{name}.partial-{ctx.job_id[:8]}"
    try:
        handles, missing = {}, []
        for project_id, project_name, folder in sources:
            handle = open_source(registry, project_id, folder)
            if handle is None:
                missing.append(project_name)
            else:
                handles[project_id] = handle
        if missing:
            raise JobFailure(
                "These projects are missing or cannot be opened: "
                + ", ".join(missing)
                + ". The dataset is kept; export it again once they are back."
            )
        shutil.rmtree(staging, ignore_errors=True)
        for split in SPLITS:
            (staging / "images" / split).mkdir(parents=True, exist_ok=True)
            (staging / "labels" / split).mkdir(parents=True, exist_ok=True)
        class_index = {c["type_id"]: i for i, c in enumerate(classes)}
        placements: dict[str, int] = {}
        counts = {"train": 0, "val": 0}
        skipped = done = 0
        for project_id, _, _ in sources:
            handle = handles[project_id]
            for page in _item_pages(lib, dataset_id, project_id):
                ctx.check_cancelled()
                with handle.session() as s:
                    images = {
                        r.id: r
                        for r in s.execute(
                            select(Image.id, Image.path, Image.width, Image.height).where(
                                Image.id.in_([i.image_id for i in page])
                            )
                        ).all()
                    }
                for item in page:
                    done += 1
                    image = images.get(item.image_id)
                    source = handle.folder / image.path if image is not None else None
                    if source is None or not source.is_file():
                        skipped += 1  # deleted from its project after the build (decision 17)
                        continue
                    file_name = f"{project_id[:8]}__{materialised_name(image.path)}"
                    how = _place(source, staging / "images" / item.split / file_name)
                    placements[how] = placements.get(how, 0) + 1
                    label = _label_text_for(task, item.labels or [], class_index, image.width, image.height)
                    (staging / "labels" / item.split / f"{Path(file_name).stem}.txt").write_text(
                        label, "utf-8"
                    )
                    counts[item.split] += 1
                    if done % PROGRESS_EVERY == 0 or done == total:
                        progress(done / max(total, 1), f"{done} / {total} images")
        (staging / "data.yaml").write_text(data_yaml(final, [c["name"] for c in classes]), "utf-8")
        if final.is_dir() and not final.is_symlink():
            shutil.rmtree(final)
        os.replace(staging, final)
    except BaseException:
        shutil.rmtree(staging, ignore_errors=True)
        _set_export_state(lib, dataset_id, "failed")
        raise
    _set_export_state(lib, dataset_id, "ready", export_path=f"datasets/{name}")
    ctx.log.info(
        "exported %s to %s: %s, files %s, skipped %s", dataset_id, final, counts, placements, skipped
    )
    return {"dataset_id": dataset_id, **counts, "skipped": skipped, "files": placements}


def _cancelled_before_start(ctx: JobContext) -> None:
    _set_export_state(ctx.project, ctx.params["dataset_id"], "failed")


@register_job_type("dataset", on_cancelled_before_start=_cancelled_before_start)
def run_export(ctx: JobContext) -> dict:
    return export_dataset(ctx, ctx.params["dataset_id"], ctx.progress)
