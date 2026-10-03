# backend/app/asset_review/derive.py
"""Height, bearing, side and zone of a placed point (spec 2026-10-02-asset-findings §7).

A port of the kit's `records.build` bearing block, `side_of` and `zone_of`, with two changes:
- an unplaced point has no height, bearing, side or zone (spec §7, plan R7), never the camera's
  target height;
- a sector boundary rounds half up (`floor(x + 0.5)`), where the kit used Python's half-to-even
  `round`; the two differ only on an exact boundary such as 22.5 degrees.
"""

from __future__ import annotations

import math
import re
from collections.abc import Sequence
from dataclasses import dataclass

from app.asset_review.frame import Frame, norm_deg, plant_bearing, true_bearing
from app.asset_review.profiles import ComponentRule, ReviewConfig

#: With `sides.basis = "normal"`, the normal gives the bearing when its horizontal part exceeds this.
NORMAL_MIN_HORIZONTAL = 0.3

Vec3 = tuple[float, float, float]


@dataclass(frozen=True)
class Derived:
    height_m: float | None
    bearing_deg: float | None
    side: str | None
    zone: str | None


NOT_PLACED = Derived(None, None, None, None)


def bearing_of(center: Vec3, normal: Vec3 | None, review: ReviewConfig) -> float:
    """Plant bearing of the centre; of the normal instead with `basis: normal` and a normal that is
    more than 0.3 horizontal."""
    if (
        review.sides.basis == "normal"
        and normal is not None
        and math.hypot(normal[0], normal[2]) > NORMAL_MIN_HORIZONTAL
    ):
        return plant_bearing(normal[0], normal[2])
    return plant_bearing(center[0], center[2])


def side_of(bearing_deg: float, review: ReviewConfig, frame: Frame) -> str:
    """The side label for a plant bearing. Compass sides use the true bearing; faces use the true
    bearing relative to `frame.line_azimuth_deg` (0 when unset)."""
    rel = true_bearing(bearing_deg, frame)
    if review.sides.type == "faces":
        rel = norm_deg(rel - (frame.line_azimuth_deg or 0.0))
    labels = review.sides.labels
    k = len(labels)
    return labels[math.floor(rel / (360.0 / k) + 0.5) % k]


def zone_of(height_m: float, review: ReviewConfig) -> str | None:
    """The first zone (top first) with min <= h < max; else the top zone when h is at or above its
    minimum, else the bottom zone (kit `zone_of`). None when the review has no zones."""
    zones = review.zones
    if not zones:
        return None
    for z in zones:
        lo = -math.inf if z.min_m is None else z.min_m
        hi = math.inf if z.max_m is None else z.max_m
        if lo <= height_m < hi:
            return z.id
    top_lo = -math.inf if zones[0].min_m is None else zones[0].min_m
    return zones[0].id if height_m >= top_lo else zones[-1].id


def derive(center: Vec3 | None, normal: Vec3 | None, review: ReviewConfig, frame: Frame) -> Derived:
    if center is None:
        return NOT_PLACED
    bearing = bearing_of(center, normal, review)
    return Derived(
        height_m=float(center[1]),
        bearing_deg=bearing,
        side=side_of(bearing, review, frame),
        zone=zone_of(float(center[1]), review),
    )


def component_name(node: str | None, component_map: Sequence[ComponentRule]) -> str | None:
    """Kit `project.component_name`: the first `component_map` rule whose regex matches the node name
    (case-insensitive), else the node name with separators as spaces, a trailing number dropped and
    the first letter capitalised."""
    if not node:
        return None
    for rule in component_map:
        if re.search(rule.match, node, re.IGNORECASE):
            return rule.label
    name = re.sub(r"[_\-.]+", " ", node).strip()
    name = re.sub(r"\s*\d+$", "", name)
    return name[:1].upper() + name[1:] if name else None
