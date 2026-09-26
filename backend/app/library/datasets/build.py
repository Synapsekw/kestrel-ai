"""The `dataset_build` library job (foundation F §12.2 step 2): resolve a dataset's filter across
its projects and freeze the result. No image is copied: `dataset_item` rows reference images by
(project_id, image_id) and carry frozen labels; `dataset_source` records the provenance.

Bounded: each project is paged `PAGE` images at a time, twice. The first pass collects one
(item key, group key) pair of ids per image - never an image row - because a split has to see
every group before it assigns any; the second pass freezes labels page by page.
"""

from __future__ import annotations

from collections.abc import Iterator

from sqlalchemy import delete

from app.datasets.grouping import tile_key
from app.datasets.splits import assign_splits
from app.db.models import Image
from app.jobs.cancellation import JobFailure
from app.jobs.registry import register_job_type
from app.jobs.runner import JobContext
from app.library.datasets.selection import Filter, labels_of, matching_images
from app.library.db import LibraryDataset, LibraryDatasetItem, LibraryDatasetSource

PAGE = 500
NOTHING_TO_TRAIN_ON = (
    "Nothing to train on: the filter selects no ground-truth box of the chosen types. A dataset "
    "needs at least one labelled image; images marked empty only join as negatives."
)


def group_of(project_id: str, method: str, group_key: str, lat: float | None, lon: float | None) -> str:
    """The split group of an image. A group key only means something inside its own project: two
    projects' "flight 0031" are different flights and may land in different splits."""
    key = (
        tile_key(lat, lon) if method == "by_tile" and lat is not None and lon is not None else group_key or ""
    )
    return f"{project_id}:{key}"


def _item_key(project_id: str, image_id: str) -> str:
    return f"{project_id}:{image_id}"


def _key_pages(handle, f: Filter) -> Iterator[list]:
    after = ""
    while True:
        with handle.session() as s:
            rows = s.execute(
                matching_images(f)
                .add_columns(Image.group_key, Image.lat, Image.lon)
                .where(Image.id > after)
                .order_by(Image.id)
                .limit(PAGE)
            ).all()
        if not rows:
            return
        yield rows
        after = rows[-1].id


def _label_pages(handle, f: Filter) -> Iterator[tuple[list[str], dict[str, list[dict]]]]:
    after = ""
    while True:
        with handle.session() as s:
            ids = list(
                s.execute(matching_images(f).where(Image.id > after).order_by(Image.id).limit(PAGE)).scalars()
            )
            if not ids:
                return
            labels = labels_of(s, ids, f)
        yield ids, labels
        after = ids[-1]


def _mark_failed(lib, dataset_id: str) -> None:
    with lib.session() as s:
        s.execute(delete(LibraryDatasetItem).where(LibraryDatasetItem.dataset_id == dataset_id))
        s.execute(delete(LibraryDatasetSource).where(LibraryDatasetSource.dataset_id == dataset_id))
        row = s.get(LibraryDataset, dataset_id)
        if row is not None:
            row.state = "failed"


def _cancelled_before_start(ctx: JobContext) -> None:
    _mark_failed(ctx.project, ctx.params["dataset_id"])


@register_job_type("dataset_build", on_cancelled_before_start=_cancelled_before_start)
def run_build(ctx: JobContext) -> dict:
    """A build that does not finish leaves no items behind and a `failed` dataset."""
    try:
        return _build(ctx)
    except BaseException:
        # A failing cleanup is logged, never raised over the error that ended the build (as
        # `app.training.jobs._settle` does).
        try:
            _mark_failed(ctx.project, ctx.params["dataset_id"])
        except Exception:
            ctx.log.exception("could not mark dataset %s failed", ctx.params["dataset_id"])
        raise


def _build(ctx: JobContext) -> dict:
    lib, registry, dataset_id = ctx.project, ctx.runner.projects, ctx.params["dataset_id"]
    with lib.session() as s:
        row = s.get(LibraryDataset, dataset_id)
        if row is None:
            raise JobFailure("This dataset was deleted before it was built.")
        f = Filter.from_json(row.filter or {})
        method, params = row.split_method, dict(row.split_params or {})
    handles, missing = [], []
    for project_id in f.project_ids:
        try:
            handles.append(registry.get(project_id))
        except Exception:
            missing.append(project_id)
    if missing:
        raise JobFailure("These projects are missing or cannot be opened: " + ", ".join(missing))

    ctx.progress(0, "Finding matching images")
    keyed: list[tuple[str, str]] = []
    for handle in handles:
        for rows in _key_pages(handle, f):
            ctx.check_cancelled()
            keyed += [
                (_item_key(handle.id, r.id), group_of(handle.id, method, r.group_key, r.lat, r.lon))
                for r in rows
            ]
    if not keyed:
        raise JobFailure(NOTHING_TO_TRAIN_ON)
    splits = assign_splits(keyed, method, float(params.get("val_fraction", 0.2)), int(params.get("seed", 42)))
    del keyed

    counts: dict = {"images": 0, "train": 0, "val": 0, "per_class": {}}
    sources: list[LibraryDatasetSource] = []
    total = len(splits)
    for handle in handles:
        with handle.session() as s:
            project_name = handle.row(s).name
        taken = 0
        for ids, labels in _label_pages(handle, f):
            ctx.check_cancelled()
            items = []
            for image_id in ids:
                split = splits.get(_item_key(handle.id, image_id))
                if split is None:  # labelled after the first pass: it joins the next dataset
                    continue
                frozen = labels.get(image_id, [])
                items.append(
                    LibraryDatasetItem(
                        dataset_id=dataset_id,
                        project_id=handle.id,
                        image_id=image_id,
                        split=split,
                        labels=frozen,
                    )
                )
                counts[split] += 1
                for label in frozen:
                    counts["per_class"][label["type_id"]] = counts["per_class"].get(label["type_id"], 0) + 1
            with lib.session() as s:
                s.add_all(items)
            taken += len(items)
            counts["images"] += len(items)
            ctx.progress(counts["images"] / total, f"{counts['images']} / {total} images")
        sources.append(
            LibraryDatasetSource(
                dataset_id=dataset_id,
                project_id=handle.id,
                project_folder=str(handle.folder),
                project_name=project_name,
                image_count=taken,
            )
        )
    if not counts["per_class"]:
        raise JobFailure(NOTHING_TO_TRAIN_ON)
    with lib.session() as s:
        row = s.get(LibraryDataset, dataset_id)
        if row is None:
            raise JobFailure("This dataset was deleted while it was being built.")
        s.add_all(sources)
        row.counts, row.state = counts, "ready"
    ctx.log.info("built dataset %s: %s", dataset_id, counts)
    return {
        "dataset_id": dataset_id,
        "images": counts["images"],
        "train": counts["train"],
        "val": counts["val"],
    }
