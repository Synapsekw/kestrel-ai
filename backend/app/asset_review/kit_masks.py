"""Class-index masks for the photo unit (spec 2026-10-02-asset-findings §6.5 step 5, §13).

The kit's masks are preview-sized PNGs whose pixel values are profile class ids (0 = unmarked).
Polygons are the stored truth (spec A4), so a mask is vectorised: outer rings only (holes
dropped), Douglas-Peucker at 1.5 px, specks under 16 px² dropped. That loses hairline detail, so
the source is kept, losslessly, as a palette PNG attachment. One mask is in memory at a time;
cv2 is already in the bundle.
"""

from __future__ import annotations

from pathlib import Path

import cv2
import numpy as np
from PIL import Image as PILImage

from app.asset_review.kit_format import KitClass

EPSILON_PX = 1.5
MIN_REGION_PX = 16.0  # preview px²: below this a region is noise, not a defect outline
UNMARKED_RGB = (32, 32, 32)
OTHER_RGB = (128, 128, 128)


def load_mask(path: Path) -> np.ndarray:
    """uint8 class indices; a "P" PNG's palette index is its class id (kit/masks.py `load`)."""
    with PILImage.open(path) as im:
        if im.mode not in ("L", "P"):
            im = im.convert("L")
        return np.array(im, dtype=np.uint8)


def vectorise(
    mask: np.ndarray,
    class_ids: set[int],
    *,
    epsilon: float = EPSILON_PX,
    min_area: float = MIN_REGION_PX,
    max_regions: int | None = None,
) -> list[list[list[float]]]:
    m = np.isin(mask, list(class_ids)).astype(np.uint8)
    if not m.any():
        return []
    contours, _ = cv2.findContours(m, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_NONE)
    rings: list[tuple[float, list[list[float]]]] = []
    for c in contours:
        area = float(cv2.contourArea(c))
        if area < min_area:
            continue
        pts = cv2.approxPolyDP(c, epsilon, True).reshape(-1, 2)
        if len(pts) < 3:
            continue
        rings.append((area, [[float(x) + 0.5, float(y) + 0.5] for x, y in pts]))
    rings.sort(key=lambda r: -r[0])
    return [ring for _, ring in rings[:max_regions]]


def mask_coverage(mask: np.ndarray, class_ids: set[int]) -> float:
    return float(np.isin(mask, list(class_ids)).sum()) / float(mask.size)


def _rgb(hex_colour: str) -> tuple[int, int, int]:
    h = hex_colour.lstrip("#")
    try:
        return int(h[0:2], 16), int(h[2:4], 16), int(h[4:6], 16)
    except (ValueError, IndexError):
        return OTHER_RGB


def write_palette_png(mask: np.ndarray, classes: tuple[KitClass, ...], dest: Path) -> Path:
    palette = list(UNMARKED_RGB) + list(OTHER_RGB) * 255
    for c in classes:
        if 0 < c.id < 256:
            palette[c.id * 3 : c.id * 3 + 3] = _rgb(c.color)
    h, w = mask.shape
    im = PILImage.frombytes("P", (w, h), np.ascontiguousarray(mask, dtype=np.uint8).tobytes())
    im.putpalette(palette)
    dest.parent.mkdir(parents=True, exist_ok=True)
    im.save(dest, "PNG", transparency=0)
    return dest
