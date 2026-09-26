"""A project's materialised dataset, registered in the library as a read-only legacy dataset
(foundation F §6.1 and §11.4 step 5). The migration unit calls `register_legacy_dataset` once per
project dataset; the models backend owns it so the library's dataset rules live in one place.

A legacy dataset has no `dataset_item` rows: it trains from the folder the old materialise job
wrote, whose `data.yaml` class names are frozen (§11.4 step 2 leaves them unchanged). It cannot be
exported again, and deleting it removes only the library row, never the project's folder.
"""

from __future__ import annotations

from sqlalchemy import func, select

from app.db.models import Dataset, DatasetImage
from app.errors import not_found
from app.library.db import LibraryDataset, LibraryDatasetSource
from app.library.handle import LibraryHandle
from app.projects.service import ProjectHandle


def _free_name(s, wanted: str) -> str:
    """`wanted`, or `wanted 2`, `wanted 3` ... on a collision (amendment A12)."""
    taken = {
        n.casefold()
        for n in s.execute(
            select(LibraryDataset.name).where(func.lower(LibraryDataset.name).like(wanted.lower() + "%"))
        ).scalars()
    }
    name, n = wanted, 1
    while name.casefold() in taken:
        n += 1
        name = f"{wanted} {n}"
    return name


def register_legacy_dataset(lib: LibraryHandle, handle: ProjectHandle, project_dataset_id: str) -> str | None:
    """The library id of the legacy dataset for this project dataset, registering it when needed.

    Idempotent: keyed on the dataset's absolute folder. None when that folder has no data.yaml,
    because there is nothing to train on; the caller (MG) lists it in its report.
    """
    with handle.session() as s:
        dataset = s.get(Dataset, project_dataset_id)
        if dataset is None:
            raise not_found("dataset", project_dataset_id)
        project_name = handle.row(s).name
        splits = dict(
            s.execute(
                select(DatasetImage.split, func.count())
                .where(DatasetImage.dataset_id == dataset.id)
                .group_by(DatasetImage.split)
            ).all()
        )
        classes = [{"type_id": str(c.get("id")), "name": str(c.get("name"))} for c in dataset.classes or []]
        folder = (handle.folder / dataset.path).resolve()
        name, method, params = dataset.name, dataset.split_method, dict(dataset.split_params or {})
    if not (folder / "data.yaml").is_file():
        return None
    legacy_path = str(folder)
    images = int(sum(splits.values()))
    with lib.session() as s:
        existing = s.execute(
            select(LibraryDataset.id).where(LibraryDataset.legacy_path == legacy_path)
        ).scalar()
        if existing is not None:
            return existing
        row = LibraryDataset(
            # C0's contract example ("v1 (Ahmadia)") and MG's plan (amendment A12).
            name=_free_name(s, f"{name} ({project_name})"),
            task="detect",  # every pre-foundation dataset is axis-aligned boxes
            origin="legacy",
            filter=None,
            classes=classes,
            split_method=method,
            split_params=params,
            state="ready",
            counts={
                "images": images,
                "train": int(splits.get("train", 0)),
                "val": int(splits.get("val", 0)),
                "per_class": {},
            },
            export_state="ready",
            legacy_path=legacy_path,
            legacy_dataset_id=project_dataset_id,
        )
        s.add(row)
        s.flush()
        s.add(
            LibraryDatasetSource(
                dataset_id=row.id,
                project_id=handle.id,
                project_folder=str(handle.folder),
                project_name=project_name,
                image_count=images,
            )
        )
        return row.id
