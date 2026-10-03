# backend/app/asset_review/poses.py
"""Photo poses in the asset frame from EXIF and XMP (spec 2026-10-02-asset-findings §6.2).

`pose_from_exif` is the kit's `cameras.py` `pose()` reading Kestrel's `image` pose columns
(migration 0011) instead of the file; no file is opened. The differences are forced by what Kestrel
stores, and are listed in plan 2026-10-03-asset-findings-j2 ("What Kestrel stores"):
- altitude: `image.alt` (EXIF GPS); none -> the datum (y = 0), as the kit.
- yaw: gimbal yaw, then flight yaw (GPSImgDirection is not stored); none -> aim at the axis.
- field of view: `focal_mm` + `sensor_w_mm` (equal to the kit's 35 mm rule when import derived the
  sensor from it), then `focal_px` over the original long side, then 70 degrees; across the long side.
- plant north: positions and yaw are turned by `frame.north_offset_deg`, the true bearing of plant
  north. At 0 every number is the kit's (pinned by a parity test).
"""

from __future__ import annotations

import math
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field

from app.asset_review.frame import Frame, true_to_plant

R_EARTH_M = 6378137.0
DEFAULT_LONG_FOV_DEG = 70.0
MIN_FOV_DEG = 1.0
MAX_FOV_DEG = 170.0
MIN_ROLL_DEG = 0.5
MIN_HORIZONTAL = 1e-6
EXIF_ACCURACY_M = 3.0  # uncorrected GNSS, as app/pointclouds/cameras.py SIGMA_M

PoseSource = Literal["kit", "exif_gimbal", "exif_axis_aim", "manual"]
Vec3 = tuple[float, float, float]


class PoseIn(BaseModel):
    """One photo's pose in the asset frame (spec §5.3); what the job writes and J3/J5 read."""

    model_config = ConfigDict(frozen=True)
    position: Vec3
    target: Vec3
    up: Vec3
    hfov_deg: float = Field(gt=0, lt=180)
    vfov_deg: float = Field(gt=0, lt=180)
    source: PoseSource
    accuracy_m: float | None = None


def _num(value) -> float | None:
    """A finite float, else None (a junk column must never become a NaN pose)."""
    if value is None:
        return None
    try:
        f = float(value)
    except (TypeError, ValueError):
        return None
    return f if math.isfinite(f) else None


def _pos(value) -> float | None:
    f = _num(value)
    return f if f is not None and f > 0 else None


def _gps(image) -> tuple[float, float] | None:
    """(lat, lon) when both are finite and on the globe, else None (junk EXIF DMS is not range-checked)."""
    lat, lon = _num(image.lat), _num(image.lon)
    if lat is None or lon is None or not (-90.0 <= lat <= 90.0 and -180.0 <= lon <= 180.0):
        return None
    return lat, lon


def has_gps(image) -> bool:
    return _gps(image) is not None


def has_alt(image) -> bool:
    return _num(image.alt) is not None


def _sane(long_fov: float) -> bool:
    return MIN_FOV_DEG < long_fov < MAX_FOV_DEG


def fov_deg(image) -> tuple[float, float]:
    """(hfov, vfov), rounded to 4 decimals, strictly inside (0, 180). The lens angle spans the long
    side of the photo. A lens rule whose angle is not sane (junk EXIF) falls through to the next."""
    focal_mm, sensor_w = _pos(image.focal_mm), _pos(image.sensor_w_mm)
    focal_px, ow, oh = _pos(image.focal_px), _pos(image.orig_w), _pos(image.orig_h)
    long_fov = None
    if focal_mm and sensor_w:
        cand = 2 * math.degrees(math.atan(sensor_w / (2 * focal_mm)))
        long_fov = cand if _sane(cand) else None
    if long_fov is None and focal_px and ow and oh:
        cand = 2 * math.degrees(math.atan(max(ow, oh) / (2 * focal_px)))
        long_fov = cand if _sane(cand) else None
    if long_fov is None:
        long_fov = DEFAULT_LONG_FOV_DEG
    w, h = _num(image.width) or 0.0, _num(image.height) or 0.0
    half = math.tan(math.radians(long_fov / 2))
    if w <= 0 or h <= 0:  # unknown shape: the lens angle on both axes
        hf = vf = long_fov
    elif w >= h:
        hf, vf = long_fov, 2 * math.degrees(math.atan(half * h / w))
    else:
        vf, hf = long_fov, 2 * math.degrees(math.atan(half * w / h))
    return _clamp_fov(hf), _clamp_fov(vf)


def _clamp_fov(v: float) -> float:
    return min(max(round(v, 4), 0.0001), 179.9999)


def pose_from_exif(image, frame: Frame) -> PoseIn | None:
    """The kit's `pose()` on `image`'s columns, in `frame`. None without an origin or GPS, or with
    no yaw while the camera stands on the asset axis (no direction to aim)."""
    origin = frame.origin
    gps = _gps(image)
    if origin is None or gps is None:
        return None
    lat, lon = gps
    lat0, lon0, alt0 = origin.lat, origin.lon, origin.ground_alt_m
    north = math.radians(lat - lat0) * R_EARTH_M
    east = math.radians(lon - lon0) * R_EARTH_M * math.cos(math.radians(lat0))
    x, z = true_to_plant(north, east, frame.north_offset_deg)
    alt = _num(image.alt)
    y = (alt if alt is not None else alt0) - alt0
    hf, vf = fov_deg(image)
    yaw = _num(image.gimbal_yaw)
    if yaw is None:
        yaw = _num(image.flight_yaw)
    pitch = _num(image.gimbal_pitch)
    if yaw is None:  # aim at the asset axis at the camera height, clamped to the asset
        ty = min(max(y, 0.0), frame.height_m or y)
        d = [-x, ty - y, -z]
        source = "exif_axis_aim"
    else:
        pr = math.radians(pitch if pitch is not None else 0.0)
        yr = math.radians(yaw - frame.north_offset_deg)
        d = [math.cos(pr) * math.cos(yr), math.sin(pr), math.cos(pr) * math.sin(yr)]
        source = "exif_gimbal"
    n = math.sqrt(sum(v * v for v in d))
    if n < 1e-9:
        return None
    d = [v / n for v in d]
    hz = d[0] ** 2 + d[2] ** 2
    t = -(x * d[0] + z * d[2]) / hz if hz > MIN_HORIZONTAL else (math.hypot(x, z) or 10.0)
    if t <= 0:  # the target is the point on the view ray nearest the vertical axis, never behind
        t = math.sqrt(x * x + z * z) or 10.0
    p = [x, y, z]
    target = [p[i] + d[i] * t for i in range(3)]
    up = [0.0, 1.0, 0.0]
    roll = _num(image.gimbal_roll)
    if roll and abs(roll) > MIN_ROLL_DEG:  # rotate world up about the view direction (Rodrigues)
        r = math.radians(roll)
        c, s = math.cos(r), math.sin(r)
        kv = sum(d[i] * up[i] for i in range(3))
        cr = [d[1] * up[2] - d[2] * up[1], d[2] * up[0] - d[0] * up[2], d[0] * up[1] - d[1] * up[0]]
        up = [up[i] * c + cr[i] * s + d[i] * kv * (1 - c) for i in range(3)]
    return PoseIn(
        position=tuple(round(v, 4) for v in p),
        target=tuple(round(v, 4) for v in target),
        up=tuple(round(v, 5) for v in up),
        hfov_deg=hf,
        vfov_deg=vf,
        source=source,
        accuracy_m=EXIF_ACCURACY_M,
    )
