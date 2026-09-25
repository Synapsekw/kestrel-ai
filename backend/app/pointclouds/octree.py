"""HTTP Range serving of a cloud's octree files (spec §7): one file handle, 1 MiB chunks."""

from __future__ import annotations

import re
from collections.abc import Iterator
from pathlib import Path

MAX_RANGE = 64 * 1024 * 1024
STREAM_CHUNK = 1024 * 1024
_RANGE = re.compile(r"^bytes=(\d*)-(\d*)$")


class RangeNotSatisfiable(Exception):
    pass


def parse_range(header: str | None, size: int) -> tuple[int, int] | None:
    """`(start, end)` inclusive for exactly one satisfiable range; `None` for "the whole file",
    allowed only up to 64 MiB. Anything else raises RangeNotSatisfiable (416)."""
    if header is None:
        if size > MAX_RANGE:
            raise RangeNotSatisfiable
        return None
    m = _RANGE.match(header.strip())
    if not m:
        raise RangeNotSatisfiable  # malformed, another unit, or several ranges
    first, last = m.groups()
    if first == "" and last == "":
        raise RangeNotSatisfiable
    if first == "":
        n = int(last)
        if n == 0:
            raise RangeNotSatisfiable
        start, end = max(0, size - n), size - 1
    else:
        start = int(first)
        end = size - 1 if last == "" else int(last)
        if end < start:
            raise RangeNotSatisfiable
        end = min(end, size - 1)
    if start >= size or end - start + 1 > MAX_RANGE:
        raise RangeNotSatisfiable
    return start, end


def _open(path: Path):
    return open(path, "rb")


def stream(path: Path, start: int, length: int) -> Iterator[bytes]:
    with _open(path) as f:
        f.seek(start)
        left = length
        while left > 0:
            block = f.read(min(STREAM_CHUNK, left))
            if not block:
                break
            left -= len(block)
            yield block
