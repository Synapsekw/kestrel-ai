"""The drone photos near a point cloud (spec 2026-09-26-point-cloud-workspace section 10.1).

One column-only query over `image` (never an image file) finds the photos inside the cloud's WGS84
bounds plus a buffer. One pyproj call reprojects them into the cloud's CRS, and the meridian
convergence turns their true yaw into grid yaw. Each gets a field of view. The payload is parallel
arrays (`CloudCameraSet`) of at most CAP cameras.

I's pose columns (image-inspection spec section 7.3, migration 0011) are named in POSE_COLUMNS and
read only by `_pose_columns`, which also applies I's yaw fallback rule, so a rename touches one line.
"""

from __future__ import annotations

import math
from collections.abc import Mapping
from dataclasses import dataclass
from typing import Any

import numpy as np
from pyproj import CRS, Proj

from app.db.models import Image

CAP = 20_000
SIGMA_M = 3.0  # I records no RTK flag yet; an array so a flag can tighten it later (spec 10.1 step 5)
ASSUMED_DIAGONAL_FOV_DEG = 84.0  # DJI's common wide lens
MIN_BUFFER_M = 100.0
M_PER_DEG_LAT = 111_320.0
MIN_COS_LAT = 0.01
YAW_SANITY_PITCH = -80.0  # I spec section 7.4
YAW_SANITY_DIFF = 90.0

# canonical name -> the `image` column I-C0 created (I spec section 7.3). The only place C names them.
POSE_COLUMNS: dict[str, str] = {
    "gimbal_yaw": "gimbal_yaw",
    "gimbal_pitch": "gimbal_pitch",
    "gimbal_roll": "gimbal_roll",
    "flight_yaw": "flight_yaw",
    "focal_px": "focal_px",
    "focal_mm": "focal_mm",
    "sensor_w_mm": "sensor_w_mm",
    "orig_w": "orig_w",
    "orig_h": "orig_h",
}


@dataclass(frozen=True)
class Pose:
    yaw: float | None  # TRUE yaw, clockwise from north, after I's fallback rule
    pitch: float | None  # -90 = nadir
    roll: float | None
    focal_px: float | None  # pixels of the original frame
    focal_mm: float | None
    sensor_w_mm: float | None  # the sensor's long axis
    orig_w: int | None
    orig_h: int | None

    @property
    def posed(self) -> bool:
        return self.yaw is not None and self.pitch is not None


def _num(value: Any) -> float | None:
    """A finite float, else None (a junk XMP value must never reach the JSON as NaN)."""
    if value is None:
        return None
    try:
        f = float(value)
    except (TypeError, ValueError):
        return None
    return f if math.isfinite(f) else None


def _positive_int(value: Any) -> int | None:
    f = _num(value)
    return int(f) if f is not None and f > 0 else None


def _angle_diff(a: float, b: float) -> float:
    d = abs(a - b) % 360.0
    return min(d, 360.0 - d)


def effective_yaw(pitch: float | None, gimbal_yaw: float | None, flight_yaw: float | None) -> float | None:
    """Gimbal yaw, falling back to flight yaw. Near nadir, a gimbal yaw more than 90 deg off the flight
    yaw is body-relative on some airframes, so flight yaw is used (I spec section 7.4)."""
    if gimbal_yaw is None:
        return flight_yaw
    if (
        pitch is not None
        and pitch < YAW_SANITY_PITCH
        and flight_yaw is not None
        and _angle_diff(gimbal_yaw, flight_yaw) > YAW_SANITY_DIFF
    ):
        return flight_yaw
    return gimbal_yaw


def pose_select() -> list:
    """The pose columns to SELECT, labelled with their canonical names. A column the `image` table
    lacks is skipped, so the payload degrades to position-only instead of failing (spec section 14)."""
    return [
        getattr(Image, column).label(name) for name, column in POSE_COLUMNS.items() if hasattr(Image, column)
    ]


def _pose_columns(m: Mapping[str, Any]) -> Pose:
    """One selected row's pose, with I's yaw fallback rule applied. Missing keys are None."""
    pitch = _num(m.get("gimbal_pitch"))
    return Pose(
        yaw=effective_yaw(pitch, _num(m.get("gimbal_yaw")), _num(m.get("flight_yaw"))),
        pitch=pitch,
        roll=_num(m.get("gimbal_roll")),
        focal_px=_num(m.get("focal_px")),
        focal_mm=_num(m.get("focal_mm")),
        sensor_w_mm=_num(m.get("sensor_w_mm")),
        orig_w=_positive_int(m.get("orig_w")),
        orig_h=_positive_int(m.get("orig_h")),
    )


def _full_deg(half_tan: float) -> float:
    return 2.0 * math.degrees(math.atan(half_tan))


def fov_deg(width: int, height: int, pose: Pose) -> tuple[float, float, bool]:
    """(hfov, vfov, assumed) in degrees for the STORED frame `width` x `height` (C-B3 Rulings 1-2).

    The lens gives the sensor's long-side FOV; the stored aspect gives the other side, so a
    portrait-stored photo gets its long FOV on the vertical and the import downscale changes nothing.
    """
    tan_long: float | None = None
    if pose.focal_px and pose.focal_px > 0 and pose.orig_w and pose.orig_h:
        tan_long = max(pose.orig_w, pose.orig_h) / (2.0 * pose.focal_px)
    elif pose.focal_mm and pose.sensor_w_mm and pose.focal_mm > 0 and pose.sensor_w_mm > 0:
        tan_long = pose.sensor_w_mm / (2.0 * pose.focal_mm)
    if tan_long is None:
        t = math.tan(math.radians(ASSUMED_DIAGONAL_FOV_DEG / 2.0)) / math.hypot(width, height)
        return _full_deg(t * width), _full_deg(t * height), True
    long_side, short_side = max(width, height), min(width, height)
    tan_short = tan_long * short_side / long_side
    th, tv = (tan_long, tan_short) if width >= height else (tan_short, tan_long)
    return _full_deg(th), _full_deg(tv), False


def convergence(crs: CRS, lons: np.ndarray, lats: np.ndarray) -> np.ndarray:
    """The meridian convergence (degrees) at each camera; grid yaw = true yaw - this (spec 10.1 step 3)."""
    if len(lons) == 0:
        return np.zeros(0)
    factors = Proj(crs).get_factors(lons, lats)
    return np.asarray(factors.meridian_convergence, dtype=float).reshape(-1)


def grid_yaw(crs: CRS, lons: np.ndarray, lats: np.ndarray, yaws: np.ndarray) -> np.ndarray:
    """True yaw -> grid yaw in [0, 360)."""
    return np.mod(np.asarray(yaws, dtype=float) - convergence(crs, lons, lats), 360.0)


def search_box(
    bounds_wgs84: list[float], bounds_native: list[float] | None, crs: CRS
) -> tuple[float, float, float, float]:
    """The cloud's [minlon, minlat, maxlon, maxlat] grown by max(100 m, half the horizontal diagonal)."""
    minlon, minlat, maxlon, maxlat = (float(v) for v in bounds_wgs84)
    buffer_m = MIN_BUFFER_M
    if bounds_native:
        minx, miny, _, maxx, maxy, _ = (float(v) for v in bounds_native)
        unit_m = crs.axis_info[0].unit_conversion_factor if crs.axis_info else 1.0
        buffer_m = max(MIN_BUFFER_M, 0.5 * math.hypot(maxx - minx, maxy - miny) * unit_m)
    dlat = buffer_m / M_PER_DEG_LAT
    cos_lat = max(math.cos(math.radians(max(abs(minlat), abs(maxlat)))), MIN_COS_LAT)
    dlon = buffer_m / (M_PER_DEG_LAT * cos_lat)
    return minlon - dlon, minlat - dlat, maxlon + dlon, maxlat + dlat
