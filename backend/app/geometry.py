"""Oriented-box maths shared by validation, exports and (in wave 2) label materialisation.

`x, y, w, h` always describe the *unrotated* box; `angle` rotates it about its own centre,
in degrees, clockwise in image coordinates (y grows downward). This module is the single
definition of that convention on the Python side — `frontend/src/editor/geometry.ts` is its
TypeScript twin, and the two are pinned to the same fixtures so they cannot drift.
"""

from __future__ import annotations

import math


def normalise_angle(deg: float) -> float:
    """Degrees into [0, 180). A rectangle has 180 degree symmetry, so 190 and 10 are one shape."""
    return float(deg) % 180.0


def centre_of(x: float, y: float, w: float, h: float) -> tuple[float, float]:
    return (x + w / 2, y + h / 2)


def corners_of(x: float, y: float, w: float, h: float, angle: float) -> list[tuple[float, float]]:
    """The four corners in image pixels, clockwise from the rotated top-left."""
    cx, cy = centre_of(x, y, w, h)
    rad = math.radians(angle)
    cos, sin = math.cos(rad), math.sin(rad)
    out = []
    for dx, dy in ((-w / 2, -h / 2), (w / 2, -h / 2), (w / 2, h / 2), (-w / 2, h / 2)):
        out.append((cx + dx * cos - dy * sin, cy + dx * sin + dy * cos))
    return out


def aabb_of(x: float, y: float, w: float, h: float, angle: float) -> tuple[float, float, float, float]:
    """The axis-aligned envelope of the rotated box, as `(x, y, w, h)`."""
    if angle == 0:
        return (float(x), float(y), float(w), float(h))
    pts = corners_of(x, y, w, h, angle)
    xs = [p[0] for p in pts]
    ys = [p[1] for p in pts]
    return (min(xs), min(ys), max(xs) - min(xs), max(ys) - min(ys))
