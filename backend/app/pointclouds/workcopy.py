"""The transient local work copy of a source cloud (spec §6.3) and its header repair (spec §6.6).

The source, often on a NAS, is read exactly once, in 64 MiB chunks, hashed on the way. The copy is
the only file ever modified; the source never is.
"""

from __future__ import annotations

import errno
import hashlib
from collections.abc import Callable, Sequence
from pathlib import Path

import laspy
import numpy as np

from app.jobs.cancellation import JobFailure
from app.pointclouds.lasbounds import contains, read_header_bounds, widen, write_header_bounds

COPY_CHUNK = 64 * 1024 * 1024
DISK_FULL = "the project drive is full; free some space and import again"
_DISK_FULL_WINERRORS = {39, 112}  # ERROR_HANDLE_DISK_FULL, ERROR_DISK_FULL


def _open_source(path: Path):
    return open(path, "rb")


def _open_dest(path: Path):
    return open(path, "wb")


def os_reason(e: OSError) -> str:
    return e.strerror or str(e) or type(e).__name__


def _is_disk_full(e: OSError) -> bool:
    return e.errno == errno.ENOSPC or getattr(e, "winerror", None) in _DISK_FULL_WINERRORS


def copy_and_hash(
    source: Path,
    dest: Path,
    *,
    progress: Callable[[int, int], None],
    check_cancelled: Callable[[], None],
    chunk: int = COPY_CHUNK,
) -> str:
    """Copies `source` to `dest` and returns its sha256; `dest` is removed on any failure."""
    dest.parent.mkdir(parents=True, exist_ok=True)
    try:
        total = source.stat().st_size
        src = _open_source(source)
    except OSError as e:
        raise JobFailure(f"could not read the source file: {source} ({os_reason(e)})") from None
    digest, done = hashlib.sha256(), 0
    try:
        with src, _open_dest(dest) as out:
            while True:
                check_cancelled()
                try:
                    block = src.read(chunk)
                except OSError as e:
                    raise JobFailure(f"could not read the source file: {source} ({os_reason(e)})") from None
                if not block:
                    break
                digest.update(block)
                try:
                    out.write(block)
                except OSError as e:
                    if _is_disk_full(e):
                        raise JobFailure(DISK_FULL) from None
                    raise JobFailure(f"could not write the work copy: {os_reason(e)}") from None
                done += len(block)
                progress(done, total)
        if done != total:
            raise JobFailure(f"the source file changed while it was being copied: {source}")
    except BaseException:
        dest.unlink(missing_ok=True)
        raise
    return digest.hexdigest()


def repair_header(path: Path, bounds: Sequence[float], scale: Sequence[float]) -> bool:
    """Writes the scanned bounds, widened one scale step, into the copy's header; True if they were
    not already inside the header (the Pix4D defect). A laspy reopen then proves the result."""
    repaired = not contains(read_header_bounds(path), bounds)
    write_header_bounds(path, widen(bounds, scale))
    with laspy.open(path) as r:
        mins, maxs = np.asarray(r.header.mins), np.asarray(r.header.maxs)
    if not (np.all(mins <= np.asarray(bounds[:3])) and np.all(maxs >= np.asarray(bounds[3:]))):
        raise JobFailure("could not repair the header bounds of the work copy")
    return repaired
