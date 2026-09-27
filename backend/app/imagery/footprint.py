"""An image's ground footprint on flat ground at take-off height (spec 2026-09-26-image-inspection
§7.4, decision I-D3). A visual aid only: it is never used to measure.

ENU frame with the camera at the origin; roll is ignored. Computed once, at import or backfill.
"""

from __future__ import annotations

import math
from dataclasses import dataclass
from typing import Literal

FootprintKind = Literal["trapezoid", "wedge", "point", "none"]
M_PER_DEG = 111_320.0
MIN_DOWN = 1e-3  # a ray must point at least this far below the horizon (r.z < -1e-3)
MAX_RANGE = 10.0  # a valid ground hit lies within 10 * h horizontally
WEDGE_RANGE = 3.0  # wedge top rays are clamped to 3 * h
YAW_SANITY_PITCH, YAW_SANITY_DIFF = -80.0, 90.0
DEFAULT_ASPECT = 0.75


@dataclass(frozen=True)
class FootprintInput:
    lat: float | None
    lon: float | None
    rel_alt: float | None
    pitch: float | None
    gimbal_yaw: float | None
    flight_yaw: float | None
    focal_mm: float | None
    sensor_w_mm: float | None
    focal_px: float | None = None
    orig_w: int | None = None
    orig_h: int | None = None


@dataclass(frozen=True)
class Footprint:
    kind: FootprintKind
    coords: list[list[float]] | None  # [[lon, lat]] x4 TL,TR,BR,BL | [[lon, lat]] | None


def _angle_diff(a: float, b: float) -> float:
    d = abs(a - b) % 360.0
    return min(d, 360.0 - d)


def effective_yaw(pitch: float | None, gimbal_yaw: float | None, flight_yaw: float | None) -> float | None:
    """Gimbal yaw, falling back to flight yaw; near nadir a gimbal yaw more than 90 deg off the
    flight yaw is body-relative on some airframes, so flight yaw is used."""
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


def _lens(inp: FootprintInput) -> tuple[float, float, float] | None:
    """(f, W, H) in one unit: millimetres from EXIF, else original-frame pixels from focal_px."""
    aspect = inp.orig_h / inp.orig_w if inp.orig_w and inp.orig_h else DEFAULT_ASPECT
    if inp.focal_mm and inp.sensor_w_mm and inp.focal_mm > 0 and inp.sensor_w_mm > 0:
        return inp.focal_mm, inp.sensor_w_mm, inp.sensor_w_mm * aspect
    if inp.focal_px and inp.focal_px > 0 and inp.orig_w and inp.orig_h:
        return inp.focal_px, float(inp.orig_w), float(inp.orig_h)
    return None


def _hit(r: tuple[float, float, float], h: float) -> tuple[float, float] | None:
    if r[2] >= -MIN_DOWN:
        return None
    t = -h / r[2]
    e, n = t * r[0], t * r[1]
    return (e, n) if math.hypot(e, n) <= MAX_RANGE * h else None


def _clamped(r: tuple[float, float, float], h: float) -> tuple[float, float] | None:
    norm = math.hypot(r[0], r[1])
    if norm < 1e-12:
        return None
    s = WEDGE_RANGE * h / norm
    return (r[0] * s, r[1] * s)


def _to_lonlat(lat0: float, lon0: float, e: float, n: float) -> list[float]:
    return [lon0 + e / (M_PER_DEG * math.cos(math.radians(lat0))), lat0 + n / M_PER_DEG]


def compute(inp: FootprintInput) -> Footprint:
    if inp.lat is None or inp.lon is None:
        return Footprint("none", None)
    point = Footprint("point", [[inp.lon, inp.lat]])
    h, pitch = inp.rel_alt, inp.pitch
    yaw = effective_yaw(pitch, inp.gimbal_yaw, inp.flight_yaw)
    lens = _lens(inp)
    if h is None or h <= 0 or pitch is None or yaw is None or lens is None:
        return point
    f, w, hh = lens
    th, ps = math.radians(pitch), math.radians(yaw)
    fwd = (math.sin(ps), math.cos(ps), 0.0)
    right = (math.cos(ps), -math.sin(ps), 0.0)
    up = (0.0, 0.0, 1.0)
    axis = tuple(math.cos(th) * a + math.sin(th) * b for a, b in zip(fwd, up, strict=True))
    down = tuple(math.sin(th) * a - math.cos(th) * b for a, b in zip(fwd, up, strict=True))
    corners = ((-w / 2, -hh / 2), (w / 2, -hh / 2), (w / 2, hh / 2), (-w / 2, hh / 2))  # TL TR BR BL
    rays = [
        tuple(u * rc + v * dc + f * ac for rc, dc, ac in zip(right, down, axis, strict=True))
        for u, v in corners
    ]
    ground = [_hit(r, h) for r in rays]
    if all(g is not None for g in ground):
        kind: FootprintKind = "trapezoid"
    elif ground[2] is not None and ground[3] is not None:
        kind = "wedge"
        ground[0], ground[1] = _clamped(rays[0], h), _clamped(rays[1], h)
        if ground[0] is None or ground[1] is None:
            return point
    else:
        return point
    return Footprint(kind, [_to_lonlat(inp.lat, inp.lon, e, n) for e, n in ground])


def to_geojson(coords: list[list[float]] | None, kind: str | None) -> dict | None:
    """ImageDetail.footprint: a GeoJSON Polygon (closed ring, image top first), a Point, or None."""
    if not coords:
        return None
    if kind in ("trapezoid", "wedge") and len(coords) >= 3:
        ring = [list(p) for p in coords]
        return {"type": "Polygon", "coordinates": [ring + [list(coords[0])]]}
    if kind == "point":
        return {"type": "Point", "coordinates": list(coords[0])}
    return None
