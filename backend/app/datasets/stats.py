"""Statistics for a project, a source and a frozen dataset (spec section 5)."""

from __future__ import annotations

from sqlalchemy import func, or_, select

from app.datasets.schemas import DatasetClassCount, DatasetGroupCount, DatasetStats
from app.db.models import Box, Dataset, DatasetImage, Image, Source
from app.errors import not_found
from app.projects.schemas import (
    CountByClass,
    GpsBounds,
    GroupCount,
    ResolutionBucket,
    SourceCount,
    Stats,
    TimeRange,
)
from app.projects.service import ProjectHandle

GROUND_TRUTH = ("accepted", "edited")


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


def compute_stats(handle: ProjectHandle, source_id: str | None = None) -> Stats:
    """Project statistics, or the same figures restricted to one source."""
    scope = [Image.source_id == source_id] if source_id else []
    ground_truth = Box.review_state.in_(GROUND_TRUTH)
    with handle.session() as s:
        classes = list(handle.row(s).classes or [])
        image_count = s.execute(select(func.count()).select_from(Image).where(*scope)).scalar_one()
        labeled_count = s.execute(
            select(func.count(func.distinct(Image.id)))
            .select_from(Image)
            .outerjoin(Box, (Box.image_id == Image.id) & ground_truth)
            .where(or_(Image.marked_empty, Box.id.is_not(None)), *scope)
        ).scalar_one()
        box_counts = dict(
            s.execute(
                select(Box.class_id, func.count())
                .join(Image, Image.id == Box.image_id)
                .where(ground_truth, *scope)
                .group_by(Box.class_id)
            ).all()
        )
        pending = s.execute(
            select(func.count())
            .select_from(Box)
            .join(Image, Image.id == Box.image_id)
            .where(Box.review_state == "unreviewed", *scope)
        ).scalar_one()
        source_rows = s.execute(
            select(Source.id, Source.site, Source.duplicate_count, func.count(Image.id))
            .outerjoin(Image, Image.source_id == Source.id)
            .where(*([Source.id == source_id] if source_id else []))
            .group_by(Source.id)
            .order_by(Source.created_at)
        ).all()
        groups = s.execute(
            select(Image.group_key, func.count())
            .where(*scope)
            .group_by(Image.group_key)
            .order_by(Image.group_key)
        ).all()
        resolutions = s.execute(
            select(Image.width, Image.height, func.count())
            .where(*scope)
            .group_by(Image.width, Image.height)
            .order_by(func.count().desc())
        ).all()
        times = s.execute(
            select(func.min(Image.capture_time), func.max(Image.capture_time)).where(
                Image.capture_time.is_not(None), *scope
            )
        ).one()
        bounds = s.execute(
            select(func.min(Image.lat), func.min(Image.lon), func.max(Image.lat), func.max(Image.lon)).where(
                Image.lat.is_not(None), Image.lon.is_not(None), *scope
            )
        ).one()

    return Stats(
        image_count=image_count,
        labeled_count=labeled_count,
        unlabeled_count=image_count - labeled_count,
        box_count=sum(box_counts.values()),
        pending_review_count=pending,
        duplicate_count=sum(r[2] for r in source_rows),
        boxes_per_class=[
            CountByClass(class_id=c["id"], class_name=c["name"], count=box_counts.get(c["id"], 0))
            for c in classes
        ],
        sources=[SourceCount(source_id=r[0], site=r[1], image_count=r[3]) for r in source_rows],
        groups=[GroupCount(group_key=k, image_count=n) for k, n in groups],
        resolution_histogram=[ResolutionBucket(width=w, height=h, count=n) for w, h, n in resolutions],
        capture_time_range=TimeRange(min=times[0], max=times[1]) if times[0] else None,
        gps_bounds=(
            GpsBounds(min_lat=bounds[0], min_lon=bounds[1], max_lat=bounds[2], max_lon=bounds[3])
            if bounds[0] is not None
            else None
        ),
    )
