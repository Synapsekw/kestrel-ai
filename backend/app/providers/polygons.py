"""Mask outlines as bounded polygons (image inspection spec §10 step 4, §11.3).

The same rule as the smart polygon: `approxPolyDP` with ε = max(0.75 px, 0.002 · perimeter),
doubling ε until the ring has at most `MAX_VERTICES` vertices. `cv2` is imported inside the
function, like the other heavy imports, so the API process does not pay for it at startup.
"""

from __future__ import annotations

import numpy as np

MAX_VERTICES = 256
MIN_EPS = 0.75
EPS_FRACTION = 0.002
MIN_AREA_PX = 4.0


def simplify_ring(points, max_vertices: int = MAX_VERTICES) -> list[tuple[float, float]] | None:
    """The ring simplified to at most `max_vertices`, or None when nothing drawable is left."""
    import cv2

    arr = np.asarray(points, dtype=np.float32).reshape(-1, 1, 2)
    if len(arr) < 3:
        return None
    eps = max(MIN_EPS, EPS_FRACTION * cv2.arcLength(arr, True))
    approx = cv2.approxPolyDP(arr, eps, True)
    while len(approx) > max_vertices:
        eps *= 2
        approx = cv2.approxPolyDP(arr, eps, True)
    if len(approx) < 3 or abs(cv2.contourArea(approx)) < MIN_AREA_PX:
        return None
    return [(float(px), float(py)) for px, py in approx.reshape(-1, 2)]
