"""Smart-polygon geometry (spec 2026-09-26-image-inspection §10; rulings BS4, BS5). Pure functions.

Image px are the stored frame's pixels (the `box` table's space). Model px are the resized crop the
SAM encoder sees: the crop scaled so its long side is 1024.
"""

from __future__ import annotations

import math
from collections.abc import Sequence
from dataclasses import dataclass

import numpy as np

GRID = 64
MIN_SIDE = 512
MODEL_SIDE = 1024
MAX_VERTICES = 256
MIN_EPS = 0.75
EPS_FRACTION = 0.002
MIN_AREA_PX = 4.0


@dataclass(frozen=True)
class Crop:
    x: int
    y: int
    w: int
    h: int

    @property
    def scale(self) -> float:
        """Model px per image px."""
        return MODEL_SIDE / max(self.w, self.h)

    def model_size(self) -> tuple[int, int]:
        """(width, height) of the resized crop."""
        s = self.scale
        return max(1, round(self.w * s)), max(1, round(self.h * s))

    def contains(self, px: float, py: float) -> bool:
        return self.x <= px <= self.x + self.w and self.y <= py <= self.y + self.h

    def as_dict(self) -> dict:
        return {"x": self.x, "y": self.y, "w": self.w, "h": self.h}


def _clip(v: float, size: int) -> float:
    return min(max(v, 0.0), float(size))


def _fit(lo: float, hi: float, size: int) -> tuple[int, int]:
    """One axis: at least MIN_SIDE long (or the whole axis), snapped outward to GRID, inside [0, size]."""
    length = min(max(hi - lo, MIN_SIDE), size)
    centre = (lo + hi) / 2
    a = math.floor((centre - length / 2) / GRID) * GRID
    b = math.ceil((centre + length / 2) / GRID) * GRID
    if a < 0:
        a, b = 0, b - a
    if b > size:
        a, b = max(0, a - (b - size)), size
    return int(a), int(b)


def quantise_crop(x: float, y: float, w: float, h: float, img_w: int, img_h: int) -> Crop:
    """The viewport (source px, may overhang the image) as a crop the embedding cache can key on."""
    x0, x1 = _fit(_clip(x, img_w), _clip(x + w, img_w), img_w)
    y0, y1 = _fit(_clip(y, img_h), _clip(y + h, img_h), img_h)
    return Crop(x0, y0, x1 - x0, y1 - y0)


def to_model_px(crop: Crop, points: Sequence[tuple[float, float]]) -> list[tuple[float, float]]:
    s = crop.scale
    return [((px - crop.x) * s, (py - crop.y) * s) for px, py in points]


def mask_to_polygon(mask: np.ndarray) -> list[list[float]] | None:
    """The largest outer contour of a boolean mask, simplified to at most MAX_VERTICES (model px)."""
    import cv2  # native; kept out of module scope like the other heavy imports

    m = np.ascontiguousarray(mask, dtype=np.uint8)
    if not m.any():
        return None
    contours, _ = cv2.findContours(m, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_NONE)
    if not contours:
        return None
    contour = max(contours, key=cv2.contourArea)
    eps = max(MIN_EPS, EPS_FRACTION * cv2.arcLength(contour, True))
    approx = cv2.approxPolyDP(contour, eps, True)
    while len(approx) > MAX_VERTICES:
        eps *= 2
        approx = cv2.approxPolyDP(contour, eps, True)
    if len(approx) < 3:
        return None
    return approx.reshape(-1, 2).astype(float).tolist()


def _area(polygon: list[list[float]]) -> float:
    n = len(polygon)
    return (
        abs(
            sum(
                polygon[i][0] * polygon[(i + 1) % n][1] - polygon[(i + 1) % n][0] * polygon[i][1]
                for i in range(n)
            )
        )
        / 2
    )


def to_image_px(crop: Crop, polygon: list[list[float]]) -> list[list[float]] | None:
    """Model px back to image px, rounded to 0.1 px; None when nothing drawable is left (ruling BS2)."""
    if len(polygon) < 3:
        return None
    s = crop.scale
    out = [[round(crop.x + x / s, 1), round(crop.y + y / s, 1)] for x, y in polygon]
    return out if _area(out) >= MIN_AREA_PX else None
