"""The six header bounds of a LAS/LAZ file, read and written in place (spec §2 "Bounds repair").

At byte 179 of the public header block, identical in LAS 1.0-1.4 and in LAZ (whose header is not
compressed): max X, min X, max Y, min Y, max Z, min Z as little-endian doubles.
"""

from __future__ import annotations

import struct
from collections.abc import Sequence
from pathlib import Path

HEADER_BOUNDS_OFFSET = 179
_FORMAT = "<6d"
_SIZE = struct.calcsize(_FORMAT)


def _check_signature(f) -> None:
    f.seek(0)
    if f.read(4) != b"LASF":
        raise ValueError("not a LAS or LAZ file (no LASF signature)")


def read_header_bounds(path: Path) -> list[float]:
    """`[minx, miny, minz, maxx, maxy, maxz]` exactly as the header stores them."""
    with open(path, "rb") as f:
        _check_signature(f)
        f.seek(HEADER_BOUNDS_OFFSET)
        maxx, minx, maxy, miny, maxz, minz = struct.unpack(_FORMAT, f.read(_SIZE))
    return [minx, miny, minz, maxx, maxy, maxz]


def write_header_bounds(path: Path, bounds: Sequence[float]) -> None:
    minx, miny, minz, maxx, maxy, maxz = (float(v) for v in bounds)
    with open(path, "r+b") as f:
        _check_signature(f)
        f.seek(HEADER_BOUNDS_OFFSET)
        f.write(struct.pack(_FORMAT, maxx, minx, maxy, miny, maxz, minz))


def widen(bounds: Sequence[float], scale: Sequence[float]) -> list[float]:
    """One scale step outwards on every side: margin against the converter's own quantisation."""
    return [
        bounds[0] - scale[0],
        bounds[1] - scale[1],
        bounds[2] - scale[2],
        bounds[3] + scale[0],
        bounds[4] + scale[1],
        bounds[5] + scale[2],
    ]


def contains(outer: Sequence[float], inner: Sequence[float]) -> bool:
    return all(outer[i] <= inner[i] for i in range(3)) and all(outer[i] >= inner[i] for i in range(3, 6))
