"""Statistics for a project and a source (spec section 5)."""

from __future__ import annotations

from sqlalchemy import func, or_, select

from app.db.models import Box, Image, Source
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
            # Photo sources only: a map source holds no images (spec section 7.1).
            .where(Source.kind == "images", *([Source.id == source_id] if source_id else []))
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
