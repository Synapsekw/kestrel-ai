"""Datasets across projects (foundation F §12): preview, create, read, delete. The jobs live in
`build.py` (`dataset_build`) and `export.py` (`dataset`)."""

from __future__ import annotations

import logging
import shutil
from pathlib import Path

from sqlalchemy import delete, func, select, tuple_

from app.db.models import Job
from app.errors import AppError, not_found
from app.library.catalogue_port import CataloguePort
from app.library.datasets import selection
from app.library.datasets.schemas import (
    DatasetCounts,
    DatasetFilter,
    DatasetItemOut,
    DatasetPreview,
    DatasetPreviewProject,
    DatasetSourceOut,
    LibraryDatasetCreate,
    LibraryDatasetOut,
)
from app.library.db import LibraryDataset, LibraryDatasetItem, LibraryDatasetSource
from app.library.handle import LibraryHandle
from app.library.service import slug
from app.pagination import clamp_limit, decode_cursor, encode_cursor, newest_first_page

log = logging.getLogger(__name__)

LIVE = ("queued", "running")
TERMINAL = ("succeeded", "failed", "cancelled")
SEGMENT_NOT_SUPPORTED = (
    "YOLO segmentation datasets arrive with the Images workspace; this dataset cannot be exported "
    "or trained yet."
)


def preview(registry, body: DatasetFilter) -> DatasetPreview:
    """COUNTs only, per project, each under `selection.PREVIEW_TIMEOUT_S`. A project that is
    missing, will not open, or is too slow is reported and never fails the request (decision 14)."""
    f = selection.Filter.from_json(body.model_dump(mode="json"))
    projects: list[DatasetPreviewProject] = []
    per_type: dict[str, int] = {}
    total = 0
    for project_id in f.project_ids:
        entry = DatasetPreviewProject(project_id=project_id, project_name=None, images=0, boxes=0, state="ok")
        try:
            handle = registry.get(project_id)
        except AppError as e:
            projects.append(
                entry.model_copy(update={"state": "missing" if e.status == 404 else "unavailable"})
            )
            continue
        except Exception:
            log.exception("could not open project %s for a dataset preview", project_id)
            projects.append(entry.model_copy(update={"state": "unavailable"}))
            continue
        name = None
        try:
            with handle.session() as s:
                name = handle.row(s).name
                with selection.interrupt_after(s, selection.PREVIEW_TIMEOUT_S):
                    images, boxes = selection.count(s, f)
        except selection.PreviewTimeout:
            projects.append(entry.model_copy(update={"project_name": name, "state": "timed_out"}))
            continue
        except Exception:
            log.exception("could not count project %s for a dataset preview", project_id)
            projects.append(entry.model_copy(update={"project_name": name, "state": "unavailable"}))
            continue
        total += images
        for type_id, n in boxes.items():
            per_type[type_id] = per_type.get(type_id, 0) + n
        projects.append(
            entry.model_copy(update={"project_name": name, "images": images, "boxes": sum(boxes.values())})
        )
    return DatasetPreview(images=total, boxes_per_type=per_type, projects=projects)


# ---------------------------------------------------------------- folders and states


def folder_name(row: LibraryDataset) -> str:
    """The export folder's name: file-safe whatever the dataset is called, unique by the id."""
    return f"{slug(row.name)}-{row.id[:8]}"


def own_export_folder(lib: LibraryHandle, row: LibraryDataset) -> Path | None:
    """The row's export folder when it is exactly `<library>/datasets/<folder_name>`, else None.
    A legacy dataset never has one: its folder belongs to its project."""
    if row.origin != "built" or not row.export_path:
        return None
    folder = lib.folder / row.export_path
    if folder.is_symlink():
        return None
    resolved = folder.resolve()
    if resolved.parent != lib.datasets_dir.resolve() or resolved.name != folder_name(row):
        return None
    return resolved


def job_states(s, ids) -> dict[str, str]:
    wanted = [i for i in ids if i]
    if not wanted:
        return {}
    return dict(s.execute(select(Job.id, Job.state).where(Job.id.in_(wanted))).all())


def effective_state(row: LibraryDataset, jobs: dict[str, str]) -> str:
    """`resolving` only while its build job is alive: a restart's orphan sweep ends the job without
    running its code, and the dataset must then read `failed` (plan BM decision 5)."""
    if row.state == "resolving" and row.job_id and jobs.get(row.job_id) not in LIVE:
        return "failed"
    return row.state


def effective_export_state(lib: LibraryHandle, row: LibraryDataset, jobs: dict[str, str]) -> str:
    """`building` only while the exporting job is alive; `ready` only while data.yaml is on disk,
    otherwise `stale` (plan BM decision 4). A legacy dataset is ready while its folder is."""
    if row.origin == "legacy":
        return "ready" if row.legacy_path and (Path(row.legacy_path) / "data.yaml").is_file() else "stale"
    if row.export_state == "building" and (not row.export_job_id or jobs.get(row.export_job_id) not in LIVE):
        return "failed"
    if row.export_state == "ready" and not (
        row.export_path and (lib.folder / row.export_path / "data.yaml").is_file()
    ):
        return "stale"
    return row.export_state


def _outs(lib: LibraryHandle, s, rows: list[LibraryDataset]) -> list[LibraryDatasetOut]:
    ids = [r.id for r in rows]
    sources: dict[str, list[LibraryDatasetSource]] = {}
    if ids:
        q = select(LibraryDatasetSource).where(LibraryDatasetSource.dataset_id.in_(ids))
        for src in s.execute(q.order_by(LibraryDatasetSource.project_name)).scalars():
            sources.setdefault(src.dataset_id, []).append(src)
    jobs = job_states(s, [r.job_id for r in rows] + [r.export_job_id for r in rows])
    return [
        LibraryDatasetOut(
            id=r.id,
            name=r.name,
            task=r.task,
            origin=r.origin,
            filter=r.filter,
            classes=list(r.classes or []),
            split_method=r.split_method,
            split_params=dict(r.split_params or {}),
            state=effective_state(r, jobs),
            counts=DatasetCounts(**(r.counts or {})),
            # Stored relative to the library root, served absolute (amendment A4).
            export_path=str(lib.folder / r.export_path) if r.export_path else None,
            export_state=effective_export_state(lib, r, jobs),
            legacy_path=r.legacy_path,
            job_id=r.export_job_id or r.job_id,  # the latest build or export job (amendment A5)
            sources=[
                DatasetSourceOut(
                    project_id=src.project_id,
                    project_folder=src.project_folder,
                    project_name=src.project_name,
                    image_count=src.image_count,
                )
                for src in sources.get(r.id, [])
            ],
            created_at=r.created_at,
        )
        for r in rows
    ]


# ---------------------------------------------------------------- create, read, delete


def create_dataset(lib: LibraryHandle, registry, catalogue: CataloguePort, body: LibraryDatasetCreate) -> str:
    """Check the request and write the `resolving` row; the caller queues `dataset_build`.

    Unknown types and projects answer 404 (a schema-valid body is never a 422); a name already
    taken, compared without regard to case, answers 409 `already_exists` (decision 15).
    """
    name = body.name.strip()
    if not name:
        raise AppError("conflict", "A dataset name cannot be blank.", 409)
    type_ids = list(dict.fromkeys(body.filter.type_ids))
    types = catalogue.resolve_types(type_ids)
    unknown = [t for t in type_ids if t not in types]
    if unknown:
        raise not_found("catalogue type", ", ".join(unknown))
    for project_id in dict.fromkeys(body.filter.project_ids):
        registry.get(project_id)  # 404 when it is not a project this app knows
    with lib.session() as s:
        taken = s.execute(
            select(LibraryDataset.id).where(func.lower(LibraryDataset.name) == name.lower())
        ).first()
        if taken is not None:
            raise AppError("already_exists", f"A dataset called {name} already exists.", 409)
        row = LibraryDataset(
            name=name,
            task=body.task,
            origin="built",
            filter=body.filter.model_dump(mode="json"),
            classes=[{"type_id": t, "name": types[t].name} for t in type_ids],
            split_method=body.split_method,
            split_params={"val_fraction": body.val_fraction, "seed": body.seed},
            state="resolving",
            counts={},
            export_state="none",
        )
        s.add(row)
        s.flush()
        return row.id


def set_job(lib: LibraryHandle, dataset_id: str, job_id: str) -> None:
    with lib.session() as s:
        row = s.get(LibraryDataset, dataset_id)
        if row is not None:
            row.job_id = job_id


def discard(lib: LibraryHandle, dataset_id: str) -> None:
    """Drop a row whose job could not be queued, so no dataset stays `resolving` for ever."""
    with lib.session() as s:
        s.execute(delete(LibraryDataset).where(LibraryDataset.id == dataset_id))


def get_dataset(lib: LibraryHandle, dataset_id: str) -> LibraryDatasetOut:
    with lib.session() as s:
        row = s.get(LibraryDataset, dataset_id)
        if row is None:
            raise not_found("dataset", dataset_id)
        return _outs(lib, s, [row])[0]


def list_datasets(
    lib: LibraryHandle,
    limit: int | None,
    cursor: str | None,
    task: str | None = None,
    origin: str | None = None,
) -> tuple[list[LibraryDatasetOut], str | None]:
    q = select(LibraryDataset)
    if task:
        q = q.where(LibraryDataset.task == task)
    if origin:
        q = q.where(LibraryDataset.origin == origin)
    with lib.session() as s:
        rows, next_cursor = newest_first_page(
            s, q, LibraryDataset.created_at, LibraryDataset.id, limit, cursor
        )
        return _outs(lib, s, rows), next_cursor


def delete_dataset(lib: LibraryHandle, dataset_id: str) -> None:
    """Drop the rows and the export folder; never a project image, never a legacy folder.

    Refused with 409 `job_running` while a queued or running `dataset_build`, `dataset` or `train`
    job names the dataset (decision 16, amendment A3). Job rows in that state are few; they are
    read, not the dataset's items.
    """
    with lib.session() as s:
        row = s.get(LibraryDataset, dataset_id)
        if row is None:
            raise not_found("dataset", dataset_id)
        for job in s.execute(select(Job).where(Job.state.in_(LIVE))).scalars():
            if (job.params or {}).get("dataset_id") == dataset_id:
                raise AppError("job_running", f"Dataset {row.name} is in use by a running job.", 409)
        folder = own_export_folder(lib, row)
        s.execute(delete(LibraryDatasetItem).where(LibraryDatasetItem.dataset_id == dataset_id))
        s.execute(delete(LibraryDatasetSource).where(LibraryDatasetSource.dataset_id == dataset_id))
        s.delete(row)
    if folder is not None and folder.is_dir():
        shutil.rmtree(folder, ignore_errors=True)


def list_items(
    lib: LibraryHandle,
    dataset_id: str,
    split: str | None,
    limit: int | None,
    cursor: str | None,
    project_id: str | None = None,
) -> tuple[list[DatasetItemOut], str | None]:
    """A keyset page of items for the detail screen's sample grid; labels are counted in SQL."""
    n = clamp_limit(limit)
    item = LibraryDatasetItem
    q = (
        select(item.project_id, item.image_id, item.split, func.json_array_length(item.labels))
        .where(item.dataset_id == dataset_id)
        .order_by(item.project_id, item.image_id)
    )
    if split:
        q = q.where(item.split == split)
    if project_id:
        q = q.where(item.project_id == project_id)
    c = decode_cursor(cursor, "project_id", "image_id")
    if c:
        q = q.where(tuple_(item.project_id, item.image_id) > (str(c["project_id"]), str(c["image_id"])))
    with lib.session() as s:
        if s.get(LibraryDataset, dataset_id) is None:
            raise not_found("dataset", dataset_id)
        rows = s.execute(q.limit(n + 1)).all()
    next_cursor = None
    if len(rows) > n:
        rows = rows[:n]
        next_cursor = encode_cursor(project_id=rows[-1][0], image_id=rows[-1][1])
    return [
        DatasetItemOut(project_id=p, image_id=i, split=sp, label_count=int(k or 0)) for p, i, sp, k in rows
    ], next_cursor


# ---------------------------------------------------------------- export


def check_exportable(lib: LibraryHandle, dataset_id: str) -> None:
    """404 unknown; 422 `task_not_supported` for segment; 409 `conflict` for a legacy dataset,
    `not_ready` for one not built, `job_running` while its export is being written (amendment A3)."""
    with lib.session() as s:
        row = s.get(LibraryDataset, dataset_id)
        if row is None:
            raise not_found("dataset", dataset_id)
        jobs = job_states(s, [row.job_id, row.export_job_id])
        state, export_state = effective_state(row, jobs), effective_export_state(lib, row, jobs)
        task, origin, name = row.task, row.origin, row.name
    if task == "segment":
        raise AppError("task_not_supported", SEGMENT_NOT_SUPPORTED, 422)
    if origin == "legacy":
        raise AppError("conflict", f"{name} is a legacy dataset; it trains from its own folder.", 409)
    if state != "ready":
        raise AppError("not_ready", f"Dataset {name} is {state}; export it once it is built.", 409)
    if export_state == "building":
        raise AppError("job_running", f"The export of {name} is already being written.", 409)


def mark_export_queued(lib: LibraryHandle, dataset_id: str, job_id: str) -> None:
    """Record the queued export. The job may already have started (it records itself) or even
    finished by now; its own writes win, so a quick export never reads `building` again."""
    with lib.session() as s:
        row = s.get(LibraryDataset, dataset_id)
        if row is not None and row.export_job_id != job_id:
            row.export_state, row.export_job_id = "building", job_id
