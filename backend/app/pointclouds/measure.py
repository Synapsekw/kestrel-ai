"""Measurement formulas (spec §9.3), identical to frontend/src/clouds/measure.ts.

Both are pinned by contract/fixtures/cloud-measure-vectors.json to 1e-9. For picks A and B:
d = B - A, u = sqrt(uA^2 + uB^2). A vertical check sorts its picks by Z (A lower, B upper).
"""

from __future__ import annotations

import math

FIELDS = [
    "lon",
    "lat",
    "dx",
    "dy",
    "dz",
    "distance_3d",
    "distance_horizontal",
    "distance_vertical",
    "height_difference",
    "lean_offset_m",
    "lean_angle_deg",
    "lean_azimuth_deg",
    "lean_mm_per_m",
    "uncertainty_m",
    "angle_uncertainty_deg",
]
MIN_VERTICAL_SPAN_M = 0.5


def ordered(kind: str, points: list[dict]) -> list[dict]:
    if kind == "vertical" and len(points) == 2 and points[1]["z"] < points[0]["z"]:
        return [points[1], points[0]]
    return list(points)


def results(kind: str, points: list[dict]) -> dict[str, float | None]:
    out: dict[str, float | None] = dict.fromkeys(FIELDS)
    if kind == "point":
        out["uncertainty_m"] = float(points[0]["uncertainty_m"])
        return out
    a, b = ordered(kind, points)
    dx, dy, dz = b["x"] - a["x"], b["y"] - a["y"], b["z"] - a["z"]
    u = math.sqrt(a["uncertainty_m"] ** 2 + b["uncertainty_m"] ** 2)
    h = math.hypot(dx, dy)
    out.update(
        dx=dx,
        dy=dy,
        dz=dz,
        distance_3d=math.sqrt(dx * dx + dy * dy + dz * dz),
        distance_horizontal=h,
        distance_vertical=abs(dz),
        height_difference=dz,
        uncertainty_m=u,
    )
    if kind == "vertical":
        span = abs(dz)
        out.update(
            lean_offset_m=h,
            lean_angle_deg=math.degrees(math.atan2(h, span)),
            lean_azimuth_deg=(math.atan2(dx, dy) * 180 / math.pi + 360) % 360,
            lean_mm_per_m=1000 * h / span,
            angle_uncertainty_deg=math.degrees(math.atan(u / span)),
        )
    return out
