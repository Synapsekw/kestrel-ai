"""Near-duplicate detection and group keys (spec section 5).

The group key is what dataset splits respect, so images that are near each other in space or
time must share one: flight number from the file name, else a 250 m tile, else the source site.
"""

from __future__ import annotations

import logging
import re
from math import cos, floor, radians

TILE_SIZE_M = 250.0
M_PER_DEG_LAT = 110540.0
M_PER_DEG_LON = 111320.0

log = logging.getLogger(__name__)
_warned_regexes: set[str] = set()


def slugify(name: str) -> str:
    return re.sub(r"[^a-z0-9]+", "_", name.lower()).strip("_")


def find_duplicates(items: list[tuple[str, str]], threshold: int) -> dict[str, tuple[str, int]]:
    """`items` are (key, phash hex) in filename order, so the earliest frame is the one kept.

    Returns {duplicate key: (kept key, Hamming distance)} for every item within `threshold` bits
    of an earlier kept item.
    """
    kept: list[tuple[int, str]] = []
    dups: dict[str, tuple[str, int]] = {}
    for key, phash in items:
        if not phash:
            continue
        h = int(phash, 16)
        best_d: int | None = None
        best_key = ""
        for kh, kkey in kept:
            d = (h ^ kh).bit_count()
            if d <= threshold and (best_d is None or d < best_d):
                best_d, best_key = d, kkey
        if best_d is None:
            kept.append((h, key))
        else:
            dups[key] = (best_key, best_d)
    return dups


def tile_key(lat: float, lon: float, size_m: float = TILE_SIZE_M) -> str:
    """Equirectangular tile of `size_m` metres; good enough at the scale of one construction site."""
    x = floor(lon * M_PER_DEG_LON * cos(radians(lat)) / size_m)
    y = floor(lat * M_PER_DEG_LAT / size_m)
    return f"tile_{x}_{y}"


def group_key(file_name: str, regex: str, lat: float | None, lon: float | None, site: str) -> str:
    try:
        m = re.match(regex, file_name)
    except re.error:
        if regex not in _warned_regexes:
            _warned_regexes.add(regex)
            log.warning("invalid group_regex %r; falling back to tile then site", regex)
        m = None
    if m is not None:
        if "flight" in (m.groupdict() or {}) and m.group("flight"):
            return m.group("flight")
        if m.group(0):
            return m.group(0)
    if lat is not None and lon is not None:
        return tile_key(lat, lon)
    return site
