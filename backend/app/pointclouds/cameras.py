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
from pathlib import PureWindowsPath
from typing import Any

import numpy as np
from pyproj import CRS, Proj, Transformer
from sqlalchemy import func, select

from app.db.models import CloudCameraOffset, Image, PointCloud, Source
from app.errors import AppError, not_found
from app.imagery.footprint import effective_yaw
from app.pointclouds import rows
from app.pointclouds.schemas import CloudCameraSet, CloudCameraSource
from app.projects.service import ProjectHandle

CAP = 20_000
SIGMA_M = 3.0  # I records no RTK flag yet; an array so a flag can tighten it later (spec 10.1 step 5)
ASSUMED_DIAGONAL_FOV_DEG = 84.0  # DJI's common wide lens
MIN_BUFFER_M = 100.0
M_PER_DEG_LAT = 111_320.0
MIN_COS_LAT = 0.01

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


def _wrap_deg(value):
    """Round to 4 decimals, then wrap into [0, 360). Rounding a value like 359.99997 can tip it up to
    360.0, which is out of range, so the wrap runs again after rounding (C-B3 final-review fix 1)."""
    return np.round(value, 4) % 360.0


def grid_yaw(crs: CRS, lons: np.ndarray, lats: np.ndarray, yaws: np.ndarray) -> np.ndarray:
    """True yaw -> grid yaw in [0, 360), rounded to 4 decimals."""
    wrapped = np.mod(np.asarray(yaws, dtype=float) - convergence(crs, lons, lats), 360.0)
    return _wrap_deg(wrapped)


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


NO_CRS = "Assign a coordinate system to this point cloud to place the drone photos."
NOT_PROJECTED = (
    "This point cloud's coordinate system is not projected (its units are degrees); assign a "
    "projected coordinate system to place the drone photos."
)


def _target_crs(cloud) -> CRS:
    """The cloud's projected CRS, or 409 needs_coordinates (C-B3 Ruling 8)."""
    if not cloud.crs_wkt or not cloud.bounds_wgs84:
        raise AppError("needs_coordinates", NO_CRS, 409)
    crs = CRS.from_wkt(cloud.crs_wkt)
    if not crs.is_projected:
        raise AppError("needs_coordinates", NOT_PROJECTED, 409)
    return crs


def _label(folder: str | None, site: str | None, label: str | None, source_id: str) -> str:
    """The set's label, else its site, else its folder's last component, else its id (never null)."""
    return label or site or (PureWindowsPath(folder).name if folder else "") or source_id


def _select(s, cloud, crs: CRS) -> tuple[list, bool]:
    """ONE column-only query: the photos with GPS in the buffered box, at most CAP, by capture time."""
    minlon, minlat, maxlon, maxlat = search_box(cloud.bounds_wgs84, cloud.bounds_native, crs)
    query = (
        select(
            Image.id,
            Image.source_id,
            Image.width,
            Image.height,
            Image.lat,
            Image.lon,
            Image.alt,
            *pose_select(),
        )
        .join(Source, Source.id == Image.source_id)
        .where(
            func.coalesce(Source.kind, "images") == "images",
            Image.lat.is_not(None),
            Image.lon.is_not(None),
            Image.lat.between(minlat, maxlat),
            Image.lon.between(minlon, maxlon),
        )
        .order_by(Image.capture_time.is_(None), Image.capture_time, Image.id)
        .limit(CAP + 1)
    )
    found = list(s.execute(query).mappings())
    return found[:CAP], len(found) > CAP


def _round(value: float | None, digits: int) -> float | None:
    return None if value is None else round(float(value), digits)


def camera_set(handle: ProjectHandle, cloud_id: str) -> CloudCameraSet:
    """The cameras payload (spec section 10.1). 404, then 409 not_ready, then 409 needs_coordinates."""
    cloud = rows.require_ready(handle, cloud_id)
    crs = _target_crs(cloud)
    with handle.session() as s:
        found, truncated = _select(s, cloud, crs)
        source_ids = list(dict.fromkeys(m["source_id"] for m in found))
        labels = {
            sid: _label(folder, site, label, sid)
            for sid, folder, site, label in (
                s.execute(
                    select(Source.id, Source.folder, Source.site, Source.label).where(
                        Source.id.in_(source_ids)
                    )
                )
                if source_ids
                else []
            )
        }
        offsets: dict[str, float] = dict(
            s.execute(
                select(CloudCameraOffset.source_id, CloudCameraOffset.height_offset_m).where(
                    CloudCameraOffset.point_cloud_id == cloud_id
                )
            ).all()
        )
        # Controller ruling 11 (index log 3): the panel's "n photos without GPS" (spec section 14).
        # Map-source rows are tiles, not photos: the same source filter as `_select`.
        without_gps = int(
            s.scalar(
                select(func.count())
                .select_from(Image)
                .join(Source, Source.id == Image.source_id)
                .where(
                    func.coalesce(Source.kind, "images") == "images",
                    Image.lat.is_(None) | Image.lon.is_(None),
                )
            )
            or 0
        )

    n = len(found)
    lons = np.fromiter((float(m["lon"]) for m in found), dtype=float, count=n)
    lats = np.fromiter((float(m["lat"]) for m in found), dtype=float, count=n)
    if n:
        xs, ys = Transformer.from_crs(CRS.from_epsg(4326), crs, always_xy=True).transform(lons, lats)
        xs, ys = np.asarray(xs, dtype=float).reshape(-1), np.asarray(ys, dtype=float).reshape(-1)
    else:
        xs = ys = np.zeros(0)
    gamma = convergence(crs, lons, lats)

    out: dict[str, list] = {
        k: []
        for k in (
            "image_id",
            "source_idx",
            "x",
            "y",
            "z",
            "yaw",
            "pitch",
            "roll",
            "hfov",
            "vfov",
            "fov_assumed",
            "width",
            "height",
            "sigma_m",
        )
    }
    # Assigned lazily, on a set's first surviving camera, so `sources` never lists a set with count 0
    # (C-B3 Ruling 9 / final-review fix 2).
    index: dict[str, int] = {}
    counts: dict[str, int] = {}
    posed_counts: dict[str, int] = {}
    for i, m in enumerate(found):
        width, height = m["width"], m["height"]
        if not (
            math.isfinite(xs[i])
            and math.isfinite(ys[i])
            and math.isfinite(gamma[i])
            and width is not None
            and height is not None
            and width > 0
            and height > 0
        ):
            # outside the CRS's domain, or a junk stored size that would divide by zero in fov_deg:
            # never a NaN or a 500 (final-review fixes 1 and 3)
            continue
        sid = m["source_id"]
        if sid not in index:
            index[sid] = len(index)
            counts[sid] = 0
            posed_counts[sid] = 0
        k = index[sid]
        pose = _pose_columns(m)
        alt = _num(m["alt"])
        hfov, vfov, assumed = fov_deg(int(width), int(height), pose)
        if pose.posed:
            yaw = float(_wrap_deg((pose.yaw - float(gamma[i])) % 360.0))
            pitch, roll = pose.pitch, pose.roll if pose.roll is not None else 0.0
            posed_counts[sid] += 1
        else:
            yaw = pitch = roll = None
        counts[sid] += 1
        out["image_id"].append(m["id"])
        out["source_idx"].append(k)
        out["x"].append(round(float(xs[i]), 3))
        out["y"].append(round(float(ys[i]), 3))
        out["z"].append(None if alt is None else round(alt + offsets.get(sid, 0.0), 3))
        out["yaw"].append(yaw)
        out["pitch"].append(_round(pitch, 4))
        out["roll"].append(_round(roll, 4))
        out["hfov"].append(round(hfov, 4))
        out["vfov"].append(round(vfov, 4))
        out["fov_assumed"].append(assumed)
        out["width"].append(int(width))
        out["height"].append(int(height))
        out["sigma_m"].append(SIGMA_M)

    z_stats = cloud.z_stats or {}
    return CloudCameraSet(
        **out,
        sources=[
            CloudCameraSource(
                id=sid,
                label=labels.get(sid, sid),
                count=counts[sid],
                height_offset_m=offsets.get(sid, 0.0),
                posed_count=posed_counts[sid],
            )
            for sid in index
        ],
        truncated=truncated,
        z_p1=_num(z_stats.get("p1")),
        z_p99=_num(z_stats.get("p99")),
        without_gps=without_gps,
    )


def set_offset(
    handle: ProjectHandle, cloud_id: str, source_id: str, height_offset_m: float
) -> CloudCameraSource:
    """Upsert one set's height offset for one cloud (spec section 10.1, C-B3 Ruling 10)."""
    with handle.session() as s:
        if s.get(PointCloud, cloud_id) is None:
            raise not_found("point cloud", cloud_id)
        src = s.get(Source, source_id)
        if src is None:
            raise not_found("image set", source_id)
        label = _label(src.folder, src.site, src.label, src.id)
        row = s.get(CloudCameraOffset, (cloud_id, source_id))
        if row is None:
            s.add(
                CloudCameraOffset(
                    point_cloud_id=cloud_id, source_id=source_id, height_offset_m=height_offset_m
                )
            )
        else:
            row.height_offset_m = height_offset_m
    try:
        entry = next((e for e in camera_set(handle, cloud_id).sources if e.id == source_id), None)
    except AppError:  # not ready, or no coordinates: the offset is stored, nothing is placed yet
        entry = None
    return CloudCameraSource(
        id=source_id,
        label=label,
        count=entry.count if entry else 0,
        height_offset_m=height_offset_m,
        posed_count=entry.posed_count if entry else 0,
    )
