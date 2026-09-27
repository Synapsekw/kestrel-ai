"""The `dataset` library job: write a built dataset as a YOLO folder (foundation F §12.2 step 3).

Today's materialise, generalised to items across projects. It writes `images/`, `labels/` and
`data.yaml` under `<library>/datasets/<slug>-<id8>/`, hard-linking each image when the library and
the project share a volume and copying otherwise (`materialise._place`). It builds into a
`.partial` folder and swaps that in only when complete, so a failed or cancelled export never
leaves a half-written folder where training would read it. Bounded: 500 items per page, per project.
"""

from __future__ import annotations

import logging
import os
import re
import shutil
import time
from collections.abc import Callable, Iterator
from pathlib import Path

from sqlalchemy import select

from app.datasets.materialise import (
    PROGRESS_EVERY,
    _place,
    data_yaml,
    materialised_name,
)
from app.db.models import Image, Job
from app.geometry import corners_of
from app.imagery.labels import clip01 as _clip01
from app.imagery.labels import detect_boxes
from app.imagery.labels import label_text as _label_text
from app.jobs.cancellation import JobFailure
from app.jobs.registry import register_job_type
from app.jobs.runner import JobContext
from app.library.datasets.service import LIVE, SEGMENT_NOT_SUPPORTED, folder_name
from app.library.datasets.sources import open_source
from app.library.db import LibraryDataset, LibraryDatasetItem, LibraryDatasetSource

log = logging.getLogger(__name__)

PAGE = 500
SPLITS = ("train", "val")
# The names this module writes under `<library>/datasets/`: `<slug>-<id8>` and, while it is being
# written, `.<slug>-<id8>.partial-<job8>`. The startup sweep touches nothing else.
EXPORT_NAME_RE = re.compile(r"^[a-z0-9-]+-[0-9a-f]{8}$")
PARTIAL_NAME_RE = re.compile(r"^\.[a-z0-9-]+-[0-9a-f]{8}\.partial-[0-9a-f]{8}$")
# Library jobs that write or read an export folder: while one is live the sweep leaves every folder.
SWEEP_BLOCKING_JOBS = ("dataset", "train")
# Recorded when this module first loads (effectively "when this process started"), as
# `app.exports.job` does: the sweep never touches a folder younger than that, since it could belong
# to an export this very process is writing.
_PROCESS_STARTED_AT = time.time()


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
        _settle_failed(ctx, dataset_id, staging)
        raise
    _set_export_state(lib, dataset_id, "ready", export_path=f"datasets/{name}")
    ctx.log.info(
        "exported %s to %s: %s, files %s, skipped %s", dataset_id, final, counts, placements, skipped
    )
    return {"dataset_id": dataset_id, **counts, "skipped": skipped, "files": placements}


def _state_after_failure(lib, dataset_id: str) -> str:
    """`ready` when the previous export is still whole on disk where the row points, else `failed`:
    a failed or cancelled re-export must not throw away a good export."""
    with lib.session() as s:
        row = s.get(LibraryDataset, dataset_id)
        if row is None or not row.export_path:
            return "failed"
        return "ready" if (lib.folder / row.export_path / "data.yaml").is_file() else "failed"


def _settle_failed(ctx: JobContext, dataset_id: str, staging: Path) -> None:
    """Clean up after a failed export without masking the error that ended it (as
    `app.training.jobs._settle` does): a failing cleanup is logged, and the caller re-raises."""
    try:
        shutil.rmtree(staging, ignore_errors=True)
        _set_export_state(ctx.project, dataset_id, _state_after_failure(ctx.project, dataset_id))
    except Exception:
        ctx.log.exception("could not record the failed export of dataset %s", dataset_id)


def _cancelled_before_start(ctx: JobContext) -> None:
    lib, dataset_id = ctx.project, ctx.params["dataset_id"]
    _set_export_state(lib, dataset_id, _state_after_failure(lib, dataset_id))


def _sweep_candidate(root: Path, entry: Path) -> bool:
    """A real folder directly under `root`, older than this process (never a symlink or junction)."""
    try:
        if entry.is_symlink() or not entry.is_dir() or entry.resolve().parent != root:
            return False
        return entry.stat().st_mtime < _PROCESS_STARTED_AT
    except OSError:
        return False


def sweep_export_folders(lib) -> list[str]:
    """Remove what a crash or a held file left in `<library>/datasets/`; returns the names removed.

    Two kinds, both only when older than this process: `.partial-` folders an export never swapped
    in, and `<slug>-<id8>` folders no dataset row claims (a delete whose folder removal failed).
    Skipped entirely while a library `dataset` or `train` job is queued or running. Reads the
    dataset rows, never their items; nothing outside the datasets folder is touched.
    """
    root = lib.datasets_dir
    if not root.is_dir():
        return []
    with lib.session() as s:
        live = select(Job.id).where(Job.state.in_(LIVE), Job.type.in_(SWEEP_BLOCKING_JOBS)).limit(1)
        if s.execute(live).first() is not None:
            return []
        claimed = set()
        for row in s.execute(select(LibraryDataset).where(LibraryDataset.origin == "built")).scalars():
            claimed.add(folder_name(row))
            if row.export_path:
                claimed.add(Path(row.export_path).name)
    root = root.resolve()
    removed = []
    for entry in root.iterdir():
        name = entry.name
        stale = PARTIAL_NAME_RE.match(name) or (EXPORT_NAME_RE.match(name) and name not in claimed)
        if stale and _sweep_candidate(root, entry):
            shutil.rmtree(entry, ignore_errors=True)
            removed.append(name)
    if removed:
        log.info("removed %d leftover dataset export folder(s): %s", len(removed), removed)
    return removed


@register_job_type("dataset", on_cancelled_before_start=_cancelled_before_start)
def run_export(ctx: JobContext) -> dict:
    return export_dataset(ctx, ctx.params["dataset_id"], ctx.progress)
