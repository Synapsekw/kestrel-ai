"""Loads the rows a results export writes from: images and their qualifying boxes (spec G2).

A box qualifies when it is `accepted` or `edited` (ground truth), or `unreviewed` too when the
caller asked to include proposals nobody has reviewed yet. `rejected` boxes never qualify.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime

from sqlalchemy import select

from app.db.models import Box, Image, Source
from app.projects.service import ProjectHandle

GROUND_TRUTH = ("accepted", "edited")


@dataclass
class ExportBox:
    id: str
    class_id: str
    class_name: str
    x: float
    y: float
    w: float
    h: float
    confidence: float | None
    origin: str  # person | local_model | cloud_provider
    origin_name: str  # "" for a person-drawn box
    review_state: str


@dataclass
class ExportImage:
    id: str
    path: str
    source_site: str
    group: str
    capture_time: datetime | None
    lat: float | None
    lon: float | None
    width: int
    height: int
    marked_empty: bool
    boxes: list[ExportBox] = field(default_factory=list)


def class_counts(boxes: list[ExportBox], class_names: list[str]) -> dict[str, int]:
    """One image's or one group's per-class box counts, in `class_names` order; shared by every writer."""
    counts = dict.fromkeys(class_names, 0)
    for b in boxes:
        if b.class_name in counts:
            counts[b.class_name] += 1
    return counts


def _origin_name(provenance_kind: str, provider: str | None, model_name: str | None) -> str:
    if provenance_kind == "person":
        return ""
    if provenance_kind == "cloud_provider":
        if provider and model_name:
            return f"{provider}/{model_name}"
        return provider or model_name or ""
    return model_name or ""  # local_model


def load(
    handle: ProjectHandle, include_unreviewed: bool = False, image_ids: list[str] | None = None
) -> tuple[list[ExportImage], list[dict]]:
    """Every selected image (default: the whole project) with its qualifying boxes, path order."""
    states = (*GROUND_TRUTH, "unreviewed") if include_unreviewed else GROUND_TRUTH
    with handle.session() as s:
        classes = list(handle.row(s).classes or [])
        class_names = {c["id"]: c["name"] for c in classes}

        image_query = (
            select(Image, Source.site).join(Source, Source.id == Image.source_id).order_by(Image.path)
        )
        # Joined to Image rather than an `IN (<every image id>)`: with no explicit selection this
        # is the whole project, and SQLite has a hard limit on the number of bound parameters a
        # single IN(...) can hold, which a large project would blow straight through.
        box_query = (
            select(Box)
            .join(Image, Image.id == Box.image_id)
            .where(Box.review_state.in_(states))
            .order_by(Box.created_at, Box.id)
        )
        if image_ids is not None:
            image_query = image_query.where(Image.id.in_(image_ids))
            box_query = box_query.where(Image.id.in_(image_ids))

        image_rows = list(s.execute(image_query).all())
        boxes_by_image: dict[str, list[Box]] = {}
        for b in s.execute(box_query).scalars():
            boxes_by_image.setdefault(b.image_id, []).append(b)

        images: list[ExportImage] = []
        for image, site in image_rows:
            boxes = [
                ExportBox(
                    id=b.id,
                    class_id=b.class_id,
                    class_name=class_names[b.class_id],
                    x=b.x,
                    y=b.y,
                    w=b.w,
                    h=b.h,
                    confidence=b.confidence,
                    origin=b.provenance_kind,
                    origin_name=_origin_name(b.provenance_kind, b.provider, b.model_name),
                    review_state=b.review_state,
                )
                for b in boxes_by_image.get(image.id, [])
                if b.class_id in class_names  # the class may have been removed from the project since
            ]
            images.append(
                ExportImage(
                    id=image.id,
                    path=image.path,
                    source_site=site,
                    group=image.group_key,
                    capture_time=image.capture_time,
                    lat=image.lat,
                    lon=image.lon,
                    width=image.width,
                    height=image.height,
                    marked_empty=image.marked_empty,
                    boxes=boxes,
                )
            )
    return images, classes
