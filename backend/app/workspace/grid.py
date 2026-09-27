"""The site tile grid (spec 2026-09-26-map-workspace section 6): fixed and independent of content,
so it never changes when data is added.

Origin (0, 0) in site CRS units (metres), res(z) = 1024 / 2^z m/px for z = 0..20, 256 px tiles,
column x = floor(E / (256 res)), row y = floor(-N / (256 res)); both may be negative. Every span is
a power of two, so the divisions are exact in binary floating point and
`frontend/src/mapws/view/siteGrid.ts` reproduces them bit for bit. Both are pinned by
`contract/fixtures/site-grid-vectors.json` (M-C0's).
"""

from __future__ import annotations

import math

from affine import Affine

TILE = 256
Z_MAX = 20
RES0 = 1024.0


def res(z: int) -> float:
    """Metres per pixel at zoom z."""
    if not 0 <= z <= Z_MAX:
        raise ValueError(f"zoom {z} is outside 0..{Z_MAX}")
    return RES0 / 2**z


def span(z: int) -> float:
    """Metres per tile side at zoom z."""
    return TILE * res(z)


def tile_of(e: float, n: float, z: int) -> tuple[int, int]:
    """The tile (x, y) holding the site point (e, n); the north-west corner belongs to its tile."""
    s = span(z)
    return math.floor(e / s), math.floor(-n / s)


def tile_bounds(z: int, x: int, y: int) -> tuple[float, float, float, float]:
    """(minx, miny, maxx, maxy) in site metres. `+ 0.0` turns a -0.0 into 0.0 for the JSON vectors."""
    s = span(z)
    return (x * s + 0.0, -(y + 1) * s + 0.0, (x + 1) * s + 0.0, -y * s + 0.0)


def tile_transform(z: int, x: int, y: int, *, halo: int = 0) -> Affine:
    """The tile's pixel -> site affine, grown by `halo` pixels on every side."""
    r = res(z)
    minx, _, _, maxy = tile_bounds(z, x, y)
    return Affine(r, 0.0, minx - halo * r, 0.0, -r, maxy + halo * r)


def max_zoom_for(native_m: float) -> int:
    """The smallest z whose pixel is at most half the layer's native ground pixel; the client
    overzooms beyond it."""
    if not (math.isfinite(native_m) and native_m > 0):
        raise ValueError(f"native resolution {native_m} must be a positive number of metres")
    for z in range(Z_MAX + 1):
        if res(z) <= native_m / 2:
            return z
    return Z_MAX
