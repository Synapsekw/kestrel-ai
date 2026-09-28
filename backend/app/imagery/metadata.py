"""Camera metadata -> `image` column values, shared by the import and the `image_metadata`
backfill (spec 2026-09-26-image-inspection §7.3, §7.4)."""

from __future__ import annotations

from app.datasets.prepare import CAMERA_FIELDS, CameraMeta
from app.imagery import footprint

#: Bumped when the reading rules change; rows below it are re-read by the backfill.
METADATA_VERSION = 1


def camera_columns(meta: CameraMeta, lat: float | None, lon: float | None) -> dict:
    """The `image` column values derived from camera metadata: the raw camera fields plus the
    computed ground footprint and the metadata version they were read at."""
    cols = {name: getattr(meta, name) for name in CAMERA_FIELDS}
    fp = footprint.compute(
        footprint.FootprintInput(
            lat=lat,
            lon=lon,
            rel_alt=meta.rel_alt,
            pitch=meta.gimbal_pitch,
            gimbal_yaw=meta.gimbal_yaw,
            flight_yaw=meta.flight_yaw,
            focal_mm=meta.focal_mm,
            sensor_w_mm=meta.sensor_w_mm,
            focal_px=meta.focal_px,
            orig_w=meta.orig_w,
            orig_h=meta.orig_h,
        )
    )
    cols["footprint"] = fp.coords
    cols["footprint_kind"] = fp.kind
    cols["metadata_version"] = METADATA_VERSION
    return cols
