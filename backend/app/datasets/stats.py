"""Statistics for a project, a source and a frozen dataset (spec section 5)."""

from __future__ import annotations

from sqlalchemy import select

from app.datasets.schemas import DatasetClassCount, DatasetGroupCount, DatasetStats
from app.db.models import Dataset, DatasetImage, Image
from app.errors import not_found
from app.projects.service import ProjectHandle


def dataset_stats(handle: ProjectHandle, dataset_id: str) -> DatasetStats:
    with handle.session() as s:
        dataset = s.get(Dataset, dataset_id)
        if dataset is None:
            raise not_found("dataset", dataset_id)
        classes = list(dataset.classes or [])
        rows = s.execute(
            select(DatasetImage.split, DatasetImage.boxes, Image.group_key)
            .join(Image, Image.id == DatasetImage.image_id)
            .where(DatasetImage.dataset_id == dataset_id)
        ).all()

    counts = {"train": 0, "val": 0}
    per_class: dict[tuple[str, str], int] = {}
    per_group: dict[tuple[str, str], int] = {}
    for split, boxes, group_key in rows:
        counts[split] = counts.get(split, 0) + 1
        per_group[(group_key, split)] = per_group.get((group_key, split), 0) + 1
        for b in boxes or []:
            key = (b["class_id"], split)
            per_class[key] = per_class.get(key, 0) + 1
    return DatasetStats(
        image_count=len(rows),
        train_count=counts["train"],
        val_count=counts["val"],
        boxes_per_class=[
            DatasetClassCount(
                class_id=c["id"],
                class_name=c["name"],
                train=per_class.get((c["id"], "train"), 0),
                val=per_class.get((c["id"], "val"), 0),
            )
            for c in classes
        ],
        groups=[
            DatasetGroupCount(group_key=key, split=split, image_count=n)
            for (key, split), n in sorted(per_group.items())
        ],
    )
