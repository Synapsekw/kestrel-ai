"""Image length measurements (spec 2026-09-26-image-inspection sections 8.1 and 9.3): two endpoints
in stored-image px. Lengths are computed on read, so they follow later distance changes:
`length_mm = length_px * gsd_mm`, `sigma_mm = length_mm * sigma_D / D + sqrt(2) * gsd_mm` (spec §9.3),
from `camera.scale(image)` — None (both null) until a distance rule applies (plan I-BA R-BA3)."""

from __future__ import annotations

import math

from sqlalchemy import func, select

from app.db.models import Image, ImageMeasurement
from app.errors import AppError, not_found
from app.imagery import camera
from app.projects.service import ProjectHandle

PER_IMAGE_MEASUREMENTS = 500


def length_px(m) -> float:
    return math.hypot(m.x2 - m.x1, m.y2 - m.y1)


def headline(length: float, scale: camera.Scale | None) -> tuple[float | None, float | None]:
    """(length_mm, sigma_mm) for a pixel length, or (None, None) without a scale."""
    if scale is None or scale.distance_m <= 0:
        return None, None
    mm = length * scale.gsd_mm
    sigma = mm * scale.distance_sigma_m / scale.distance_m + math.sqrt(2) * scale.gsd_mm
    return round(mm, 2), round(sigma, 2)


def _image(s, image_id: str) -> Image:
    image = s.get(Image, image_id)
    if image is None:
        raise not_found("image", image_id)
    return image


def list_measurements(
    handle: ProjectHandle, image_id: str
) -> tuple[list[ImageMeasurement], camera.Scale | None]:
    with handle.session() as s:
        image = _image(s, image_id)
        scale = camera.scale(image)
        rows = list(
            s.execute(
                select(ImageMeasurement)
                .where(ImageMeasurement.image_id == image_id)
                .order_by(ImageMeasurement.created_at, ImageMeasurement.id)
                .limit(PER_IMAGE_MEASUREMENTS)
            ).scalars()
        )
        for r in rows:
            s.expunge(r)
    return rows, scale


def create_measurement(
    handle: ProjectHandle, image_id: str, x1: float, y1: float, x2: float, y2: float, label: str = ""
) -> tuple[ImageMeasurement, camera.Scale | None]:
    with handle.session() as s:
        image = _image(s, image_id)
        for x, y in ((x1, y1), (x2, y2)):
            if not (0 <= x <= image.width and 0 <= y <= image.height):
                msg = f"({x}, {y}) is outside the {image.width}x{image.height} image"
                raise AppError("out_of_bounds", msg, 422)
        n = s.scalar(
            select(func.count()).select_from(ImageMeasurement).where(ImageMeasurement.image_id == image_id)
        )
        if (n or 0) >= PER_IMAGE_MEASUREMENTS:
            raise AppError(
                "too_many_measurements",
                f"An image holds at most {PER_IMAGE_MEASUREMENTS} lengths.",
                422,
                {"limit": PER_IMAGE_MEASUREMENTS},
            )
        row = ImageMeasurement(image_id=image_id, x1=x1, y1=y1, x2=x2, y2=y2, label=label or "")
        s.add(row)
        s.flush()
        s.refresh(row)
        scale = camera.scale(image)
        s.expunge(row)
    return row, scale


def delete_measurement(handle: ProjectHandle, measurement_id: str) -> None:
    with handle.session() as s:
        row = s.get(ImageMeasurement, measurement_id)
        if row is None:
            raise not_found("image measurement", measurement_id)
        s.delete(row)
