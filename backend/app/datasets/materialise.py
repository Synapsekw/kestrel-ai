"""Freezing a dataset and the `dataset` job that writes it to disk in YOLO format (spec section 5).

A dataset is immutable: `freeze` copies the ground truth of the selected images into
`dataset_image` rows, and the job materialises those rows. Images are hard-linked when the
dataset folder is on the project's volume and copied otherwise, so a dataset normally costs no
extra disk space.
"""

from __future__ import annotations

import logging
import os
import shutil
from pathlib import Path

from sqlalchemy import delete, or_, select

from app.datasets.grouping import tile_key
from app.datasets.schemas import DatasetCreate
from app.datasets.splits import assign_splits
from app.db.models import Box, Dataset, DatasetImage, Image, Job
from app.errors import AppError, not_found
from app.jobs.registry import register_job_type
from app.jobs.runner import JobContext
from app.projects.service import ProjectHandle

ACTIVE_JOB_STATES = ("queued", "running")

GROUND_TRUTH = ("accepted", "edited")

SPLITS = ("train", "val")
PROGRESS_EVERY = 50


def _quote(value: str) -> str:
    """Single-quoted YAML scalar: only `'` needs escaping, so Windows paths stay intact."""
    return "'" + str(value).replace("'", "''") + "'"


def data_yaml(root: Path, names: list[str]) -> str:
    lines = [f"path: {_quote(root)}", "train: images/train", "val: images/val", "names:"]
    lines += [f"  {i}: {_quote(name)}" for i, name in enumerate(names)]
    return "\n".join(lines) + "\n"


def materialised_name(path: str) -> str:
    """`images/<site>/<file>` -> `<site>__<file>`.

    A dataset folder is flat, but two sites may hold the same file name, so the site has to stay
    part of the name. Sites are slugified, so they never contain `__` and the mapping is injective.
    """
    parts = path.split("/")
    return "__".join(parts[1:]) if len(parts) > 2 and parts[0] == "images" else parts[-1]


def _place(src: Path, dest: Path) -> str:
    """Hard link when possible; report which of the two happened for the job log."""
    if dest.exists():
        # Names are unique per dataset and a failed job clears its folder, so this can only mean
        # two images mapped to one name: never silently drop one of them.
        raise FileExistsError(f"{dest} already exists; refusing to overwrite a materialised image")
    try:
        os.link(src, dest)
        return "linked"
    except OSError:
        shutil.copy2(src, dest)
        return "copied"


def _label_text(boxes: list[dict], class_index: dict[str, int], width: int, height: int) -> str:
    lines = []
    for b in boxes:
        index = class_index.get(b["class_id"])
        if index is None:  # the class was removed from the project after the freeze
            continue
        cx = (b["x"] + b["w"] / 2) / width
        cy = (b["y"] + b["h"] / 2) / height
        lines.append(f"{index} {cx:.6f} {cy:.6f} {b['w'] / width:.6f} {b['h'] / height:.6f}")
    return "\n".join(lines) + ("\n" if lines else "")


def discard(handle: ProjectHandle, dataset_id: str) -> None:
    """Drop a dataset that was never fully written, so its name is free again."""
    with handle.session() as s:
        dataset = s.get(Dataset, dataset_id)
        if dataset is None:
            return
        root = handle.folder / dataset.path
        s.execute(delete(DatasetImage).where(DatasetImage.dataset_id == dataset_id))
        s.delete(dataset)
    shutil.rmtree(root, ignore_errors=True)


log = logging.getLogger(__name__)

TOMBSTONE_PREFIX = ".deleting-"
# Windows device names: a folder called CON or NUL cannot be created or removed normally.
_RESERVED = {"con", "prn", "aux", "nul"} | {f"{port}{i}" for port in ("com", "lpt") for i in range(1, 10)}


def unusable_name(name: str) -> str | None:
    """Why `name` cannot be a dataset folder on Windows, or None. Deleting relies on these rules."""
    if name.startswith("."):
        return "a dataset name cannot start with a dot"
    if name.endswith((".", " ")):
        return "a dataset name cannot end with a dot or a space"
    if "/" in name or "\\" in name:
        return "a dataset name cannot contain a slash"
    if name.split(".")[0].casefold() in _RESERVED:
        return f"{name} is a reserved name on Windows"
    return None


def _dataset_folder_to_remove(handle: ProjectHandle, s, dataset: Dataset) -> Path:
    """The folder a dataset row names, proven safe to remove; 409 for anything else.

    Safe means: a direct child of `<project>/datasets` spelled as the row spells it (so no `..`,
    no `datasets` itself, no absolute path), not a link, and not the folder of another dataset
    (`V1` and `v1` are one folder on Windows). The row is data, and a wrong row must never cost
    the operator a folder.
    """
    relative_path = dataset.path or ""
    datasets_root = handle.datasets_dir.resolve()
    root = handle.folder / relative_path
    resolved = root.resolve()
    is_child = bool(relative_path.strip()) and resolved.parent == datasets_root
    same_spelling = is_child and resolved.name.casefold() == Path(relative_path).name.casefold()
    is_link = root.is_symlink() or (root.exists() and Path(os.path.abspath(root)) != resolved)
    others = s.execute(select(Dataset.path).where(Dataset.id != dataset.id)).scalars()
    shared = any((handle.folder / (o or "")).resolve() == resolved for o in others)
    if not same_spelling or is_link or shared or resolved.name.startswith(TOMBSTONE_PREFIX):
        raise AppError(
            "conflict",
            f"The folder of dataset {dataset.name} ({relative_path or 'empty path'}) is not its own folder "
            "inside this project's datasets folder, so nothing was deleted.",
            409,
        )
    return resolved


def _sweep_tombstones(handle: ProjectHandle, log) -> None:
    """Remove what earlier deletions could not (a file was open); never raises."""
    if not handle.datasets_dir.is_dir():
        return
    for leftover in handle.datasets_dir.glob(f"{TOMBSTONE_PREFIX}*"):
        try:
            shutil.rmtree(leftover)  # unlinks hard links and nested junctions; never follows them
        except OSError as e:
            log.warning("could not remove %s yet: %s", leftover, e)


def delete_dataset(handle: ProjectHandle, dataset_id: str) -> None:
    """Remove a dataset's row and frozen folder. Images, labels and trained models are kept.

    Refused while a job that depends on the dataset -- its own materialise job or a `train` job
    reading it -- is queued or running. Order: prove the folder safe, move it aside (atomic, so a
    folder in use refuses the delete with nothing changed), delete the rows, then remove the
    moved folder; if that last step fails the name is free anyway and a later delete sweeps it.
    """
    with handle.session() as s:
        dataset = s.get(Dataset, dataset_id)
        if dataset is None:
            raise not_found("dataset", dataset_id)
        for job in s.execute(select(Job).where(Job.state.in_(ACTIVE_JOB_STATES))).scalars():
            uses_it = job.type in ("train", "dataset") and (job.params or {}).get("dataset_id") == dataset_id
            if job.id == dataset.job_id or uses_it:
                raise AppError("conflict", f"Dataset {dataset.name} is in use by a running job.", 409)
        folder = _dataset_folder_to_remove(handle, s, dataset)
        tombstone = folder.with_name(f"{TOMBSTONE_PREFIX}{dataset_id}")
        moved = False
        if folder.is_dir():
            try:
                os.replace(folder, tombstone)
                moved = True
            except OSError as e:
                raise AppError(
                    "conflict",
                    f"The folder of dataset {dataset.name} is in use ({e.strerror or e}). "
                    "Close programs that have it open and try again.",
                    409,
                ) from e
        try:
            s.execute(delete(DatasetImage).where(DatasetImage.dataset_id == dataset_id))
            s.delete(dataset)
            s.flush()
        except Exception:
            if moved:
                os.replace(tombstone, folder)  # the rows stay, so the folder comes back
            raise
    _sweep_tombstones(handle, log)


@register_job_type("dataset")
def materialise(ctx: JobContext) -> dict:
    """A dataset is immutable, so anything short of a complete write is rolled back."""
    try:
        return _materialise(ctx)
    except Exception:
        discard(ctx.project, ctx.params["dataset_id"])
        ctx.log.warning("discarded the incomplete dataset %s", ctx.params["dataset_id"])
        raise


def _materialise(ctx: JobContext) -> dict:
    handle = ctx.project
    dataset_id = ctx.params["dataset_id"]
    ctx.check_cancelled()
    with handle.session() as s:
        dataset = s.get(Dataset, dataset_id)
        if dataset is None:
            raise ValueError(f"dataset {dataset_id} no longer exists")
        classes, rel_path = list(dataset.classes or []), dataset.path
        rows = [
            (di.split, di.boxes or [], image)
            for di, image in s.execute(
                select(DatasetImage, Image)
                .join(Image, Image.id == DatasetImage.image_id)
                .where(DatasetImage.dataset_id == dataset_id)
                .order_by(Image.path)
            ).all()
        ]
        for _, _, image in rows:
            s.expunge(image)

    root = handle.folder / rel_path
    for split in SPLITS:
        (root / "images" / split).mkdir(parents=True, exist_ok=True)
        (root / "labels" / split).mkdir(parents=True, exist_ok=True)
    class_index = {c["id"]: i for i, c in enumerate(classes)}

    counts = {"train": 0, "val": 0}
    placements: dict[str, int] = {}
    for done, (split, boxes, image) in enumerate(rows, 1):
        ctx.check_cancelled()
        name = materialised_name(image.path)
        how = _place(handle.folder / image.path, root / "images" / split / name)
        placements[how] = placements.get(how, 0) + 1
        label = root / "labels" / split / f"{Path(name).stem}.txt"
        label.write_text(_label_text(boxes, class_index, image.width, image.height), "utf-8")
        counts[split] += 1
        if done % PROGRESS_EVERY == 0 or done == len(rows):
            ctx.progress(done / len(rows), f"{done} / {len(rows)} images")

    (root / "data.yaml").write_text(data_yaml(root, [c["name"] for c in classes]), "utf-8")
    ctx.log.info("materialised %s: %s, files %s", rel_path, counts, placements)
    return {"dataset_id": dataset_id, **counts}


NOTHING_TO_TRAIN_ON = (
    "Nothing to train on: the selection has no accepted boxes. A dataset needs at least one "
    "labeled image; images marked empty are added as negative examples."
)


def freeze(handle: ProjectHandle, body: DatasetCreate) -> str:
    """Snapshot the ground truth of the selected images into a new, immutable dataset row."""
    with handle.session() as s:
        project = handle.row(s)
        classes = list(project.classes or [])
        known = {c["id"] for c in classes}
        selected = _select_images(s, body.image_ids)
        frozen = _frozen_boxes(s, [i.id for i in selected], known)
        # The box count is resolved before the name is validated: a selection with nothing to
        # train on is the failure a caller will hit first, and it must not be masked by a name
        # complaint. A selection of only marked-empty images passes `selected` (they are valid
        # negatives) but still has zero boxes, so `not selected` alone is not the right check.
        if sum(len(boxes) for boxes in frozen.values()) == 0:
            # 409, not 422: `image_ids: []` (or an all-negative default selection) is schema-valid
            # data, and the contract's positive-data-acceptance check forbids rejecting a
            # schema-valid body with 422 (see router.create_source for the same rule).
            raise AppError("conflict", NOTHING_TO_TRAIN_ON, 409)
        if body.name in (".", ".."):
            raise AppError("validation_error", f"{body.name!r} is not a usable folder name", 422)
        problem = unusable_name(body.name)
        if problem:
            # 409 for the same reason as above: the name is schema-valid.
            raise AppError("conflict", f"{problem[0].upper()}{problem[1:]}.", 409)
        # `V1` and `v1` are one folder on Windows, so names are unique without regard to case.
        taken = s.execute(select(Dataset.name)).scalars()
        if any(n.casefold() == body.name.casefold() for n in taken):
            raise AppError("already_exists", f"dataset {body.name!r} already exists", 409)

        keys = {i.id: _split_key(i, body.split_method) for i in selected}
        splits = assign_splits(
            [(i.id, keys[i.id]) for i in selected], body.split_method, body.val_fraction, body.seed
        )
        dataset = Dataset(
            name=body.name,
            classes=classes,
            split_method=body.split_method,
            split_params={"val_fraction": body.val_fraction, "seed": body.seed},
            path=f"datasets/{body.name}",
        )
        s.add(dataset)
        s.flush()
        for image in selected:
            s.add(
                DatasetImage(
                    dataset_id=dataset.id,
                    image_id=image.id,
                    split=splits[image.id],
                    boxes=frozen.get(image.id, []),
                )
            )
        return dataset.id


def _select_images(s, image_ids: list[str] | None) -> list[Image]:
    q = select(Image).order_by(Image.path)
    if image_ids is not None:
        q = q.where(Image.id.in_(image_ids))
    else:
        has_ground_truth = Image.id.in_(
            select(Box.image_id).where(Box.review_state.in_(GROUND_TRUTH)).distinct()
        )
        q = q.where(or_(has_ground_truth, Image.marked_empty))
    return list(s.execute(q).scalars())


def _frozen_boxes(s, image_ids: list[str], known_classes: set[str]) -> dict[str, list[dict]]:
    frozen: dict[str, list[dict]] = {}
    rows = s.execute(
        select(Box)
        .where(Box.image_id.in_(image_ids), Box.review_state.in_(GROUND_TRUTH))
        .order_by(Box.created_at, Box.id)
    ).scalars()
    for b in rows:
        if b.class_id not in known_classes:  # the class was deleted; its boxes cannot be trained on
            continue
        frozen.setdefault(b.image_id, []).append(
            {"class_id": b.class_id, "x": b.x, "y": b.y, "w": b.w, "h": b.h}
        )
    return frozen


def _split_key(image: Image, method: str) -> str:
    if method == "by_tile" and image.lat is not None and image.lon is not None:
        return tile_key(image.lat, image.lon)
    return image.group_key
