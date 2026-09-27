"""ImageDetail and the image PATCH body (spec 2026-09-26-image-inspection §14)."""

from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel, Field, model_validator

from app.datasets.schemas import ImageOut
from app.imagery import camera, footprint

ImageFootprintKind = Literal["trapezoid", "wedge", "point", "none"]


class ImageCamera(BaseModel):
    rel_alt: float | None
    gimbal_pitch: float | None
    gimbal_yaw: float | None
    focal_mm: float | None
    focal_px: float | None
    sensor_w_mm: float | None
    lrf_distance_m: float | None
    subject_distance_m: float | None
    distance_m: float | None
    distance_sigma_m: float | None
    distance_source: Literal["manual", "lrf", "rel_alt", "none"]  # C0: a string, never null
    gsd_mm: float | None
    camera_model: str | None

    @classmethod
    def from_image(cls, image) -> ImageCamera:
        d = camera.distance(image)
        return cls(
            rel_alt=image.rel_alt,
            gimbal_pitch=image.gimbal_pitch,
            gimbal_yaw=image.gimbal_yaw,
            focal_mm=image.focal_mm,
            focal_px=image.focal_px,
            sensor_w_mm=image.sensor_w_mm,
            lrf_distance_m=image.lrf_distance_m,
            subject_distance_m=image.subject_distance_m,
            distance_m=d.d_m if d else None,
            distance_sigma_m=d.sigma_m if d else None,
            distance_source=d.source if d else "none",
            gsd_mm=camera.gsd_mm(image, d) if d else None,
            camera_model=image.camera_model,
        )


class ImageDetail(ImageOut):
    camera: ImageCamera
    footprint: dict[str, Any] | None  # GeoJsonPolygon | GeoJsonPoint | null
    footprint_kind: ImageFootprintKind

    @classmethod
    def from_row(cls, *row) -> ImageDetail:  # the same ImageRow tuple ImageOut.from_row takes
        image = row[0]
        base = ImageOut.from_row(*row)
        kind = image.footprint_kind or "none"
        return cls(
            **base.model_dump(),
            camera=ImageCamera.from_image(image),
            footprint=footprint.to_geojson(image.footprint, kind),
            footprint_kind=kind,
        )


class ImageUpdate(BaseModel):
    """C0's `ImageUpdate`: `minProperties: 1`, `marked_empty` a non-null boolean,
    `subject_distance_m` null (clear) or in (0, 10000]. Only the fields sent are applied."""

    marked_empty: bool | None = None
    subject_distance_m: float | None = Field(None, gt=0, le=10000)

    @model_validator(mode="after")
    def _one_field_and_no_null_flag(self) -> ImageUpdate:
        if not self.model_fields_set:
            raise ValueError("send at least one field")
        if "marked_empty" in self.model_fields_set and self.marked_empty is None:
            raise ValueError("marked_empty cannot be null")
        return self
