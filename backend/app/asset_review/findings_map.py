# backend/app/asset_review/findings_map.py
"""The asset findings map geometry (spec 2026-10-02-asset-findings §9, §10).

x is the side (compass bearing 0 to 360, or the faces relative to the line), y is the height. The
layout is the kit's `report/gen.py findings_map` (viewBox 760 x 400). The frontend twin
`frontend/src/assetmodels/findingsMap/geometry.ts` computes the same numbers; both are pinned by
`contract/fixtures/asset-findings-map.json`. Every coordinate is rounded half up to 0.01 with the
same arithmetic in both languages, so the two outputs compare exactly.
"""

from __future__ import annotations

import math
from collections.abc import Callable, Sequence
from dataclasses import dataclass
from typing import Any

from app.asset_review.frame import Frame, norm_deg
from app.asset_review.profiles import ReviewConfig

WIDTH, HEIGHT = 760, 400
SIL_W, LEFT, RIGHT, TOP, BOTTOM = 64, 110, 138, 10, 38
PLOT_W, PLOT_H = WIDTH - LEFT - RIGHT, HEIGHT - TOP - BOTTOM
SIL_CX = SIL_W / 2 + 4
DOT_R = 5.5
COMPASS_TICKS: tuple[tuple[str, float], ...] = (
    ("N", 0.0),
    ("E", 90.0),
    ("S", 180.0),
    ("W", 270.0),
    ("N", 360.0),
)


@dataclass(frozen=True)
class MapDot:
    id: str
    height_m: float | None
    bearing_deg: float | None  # plant bearing
    severity: int | None


def r2(v: float) -> float:
    """Half up to 0.01: `Math.floor(v * 100 + 0.5) / 100` in the TS twin."""
    return math.floor(v * 100 + 0.5) / 100


def nice_step(height_m: float) -> float:
    """Kit `nice_step` (H / 8 snapped to 1, 2, 5 or 10 times a power of ten), without log10 so the
    TS twin gets the same float."""
    raw = height_m / 8
    p = 1.0
    while p * 10 <= raw:
        p *= 10
    while p > raw:
        p /= 10
    m = raw / p
    return (1 if m < 1.5 else 2 if m < 3.5 else 5 if m < 7.5 else 10) * p


def geometry(review: ReviewConfig, frame: Frame, dots: Sequence[MapDot]) -> dict[str, Any]:
    step = nice_step(frame.height_m)
    top = math.ceil(frame.height_m / step) * step

    def y_of(v: float) -> float:
        return TOP + (1 - max(0.0, min(top, v)) / top) * PLOT_H

    sil = [(float(y), float(r)) for y, r in frame.silhouette] or [(0.0, 1.0)]
    rmax = max(r for _, r in sil) or 1.0
    k = min(7.0, (SIL_W / 2 - 2) / rmax)

    def r_at(h: float) -> float:
        r = 0.0
        for y, rr in sil:
            if y <= h:
                r = rr
        return r or sil[0][1]

    silhouette = None
    if frame.silhouette:
        left = [[r2(SIL_CX - r * k), r2(y_of(y))] for y, r in sil]
        right = [[r2(SIL_CX + r * k), r2(y_of(y))] for y, r in reversed(sil)]
        silhouette = left + right
    levels = [
        {
            "value": lv,
            "y": r2(y_of(lv)),
            "x1": r2(SIL_CX - r_at(lv) * k - 3),
            "x2": r2(SIL_CX + r_at(lv) * k + 3),
        }
        for lv in frame.levels
    ]
    zones = []
    for i, z in enumerate(review.zones):
        a = 0.0 if z.min_m is None else max(0.0, z.min_m)
        b = top if z.max_m is None else min(top, z.max_m)
        zones.append(
            {
                "id": z.id,
                "label": z.label,
                "y": r2(y_of(b)),
                "h": r2(max(0.0, y_of(a) - y_of(b))),
                "label_y": r2(y_of((a + b) / 2) + 4),
                "shade": i % 2 == 0,
            }
        )
    y_ticks = []
    n = 0
    while n * step <= top + 1e-6:
        y_ticks.append({"value": r2(n * step), "y": r2(y_of(n * step))})
        n += 1

    off = frame.north_offset_deg
    rel: Callable[[float], float]
    if review.sides.type == "faces":
        labels = review.sides.labels
        az = frame.line_azimuth_deg or 0.0
        ticks = [(lab, i * 360 / len(labels)) for i, lab in enumerate(labels)] + [(labels[0], 360.0)]

        def rel(b: float) -> float:
            return norm_deg(b + off - az)
    else:
        ticks = list(COMPASS_TICKS)

        def rel(b: float) -> float:
            return norm_deg(b + off)

    x_ticks = [{"label": lab, "x": r2(LEFT + b / 360 * PLOT_W)} for lab, b in ticks]
    placed = sorted(
        (d for d in dots if d.bearing_deg is not None and d.height_m is not None),
        key=lambda d: (d.severity or 0, d.id),
    )
    out_dots = [
        {
            "id": d.id,
            "x": r2(LEFT + rel(d.bearing_deg) / 360 * PLOT_W),  # type: ignore[arg-type]
            "y": r2(y_of(d.height_m)),  # type: ignore[arg-type]
            "severity": d.severity,
        }
        for d in placed
    ]
    return {
        "width": WIDTH,
        "height": HEIGHT,
        "plot": {"x": LEFT, "y": TOP, "w": PLOT_W, "h": PLOT_H},
        "sil_cx": SIL_CX,
        "zone_label_x": LEFT + PLOT_W + 10,
        "dot_r": DOT_R,
        "top_m": r2(top),
        "step_m": r2(step),
        "silhouette": silhouette,
        "levels": levels,
        "zones": zones,
        "y_ticks": y_ticks,
        "x_ticks": x_ticks,
        "axis_title": review.sides.title,
        "dots": out_dots,
        "unplaced": len(dots) - len(placed),
    }
