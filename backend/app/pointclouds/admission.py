"""RAM and disk admission for a point-cloud import (spec §6.2).

Pure arithmetic around two seams, `available_ram()` and `free_disk()`, so a test can pretend the
machine has 4 GB free. Checked at inspect, at submit, and in the job right before the converter.
"""

from __future__ import annotations

import shutil
from dataclasses import asdict, dataclass
from pathlib import Path

import psutil

from app.jobs.cancellation import JobFailure

MB = 1_000_000
GIB = 1 << 30
RAM_PER_MPOINT = 45 * MB  # spike: 8.7 GB peak for 195 M points
# The converter's peak flattens once its chunks hit their cap: 842 M points peaked at 10.3 GB
# (measured 2026-10-02, 24 threads), not the 39 GB the linear rate gives. Past ~212 M points the
# need is a 9 GB base plus 2.5 MB/Mpt (the measured slope between 195 M and 842 M is 2.4).
RAM_PLATEAU_BASE = 9_000 * MB
RAM_PLATEAU_PER_MPOINT = 2.5 * MB
CHUNK_BYTES_PER_POINT = 40  # the converter's temporary chunks
OCTREE_FRACTION = 0.25  # measured 0.186 x the LAS size


def available_ram() -> int:
    return int(psutil.virtual_memory().available)


def free_disk(folder: Path) -> int:
    p = Path(folder)
    while not p.exists() and p != p.parent:
        p = p.parent
    return int(shutil.disk_usage(p).free)


def gb(n: int) -> str:
    return f"{n / 1e9:.1f} GB"


def ram_needed(point_count: int) -> int:
    mpts = point_count / 1e6
    return int(min(RAM_PER_MPOINT * mpts, RAM_PLATEAU_BASE + RAM_PLATEAU_PER_MPOINT * mpts)) + GIB


def disk_needed(point_count: int, source_size: int, record_len: int) -> int:
    return (
        int(source_size + CHUNK_BYTES_PER_POINT * point_count + OCTREE_FRACTION * point_count * record_len)
        + GIB
    )


@dataclass(frozen=True)
class Admission:
    ok: bool
    ram_needed_bytes: int
    ram_available_bytes: int
    disk_needed_bytes: int
    disk_available_bytes: int
    reason: str | None

    @property
    def code(self) -> str | None:
        if self.ok:
            return None
        return (
            "insufficient_memory" if self.ram_needed_bytes > self.ram_available_bytes else "insufficient_disk"
        )

    def as_dict(self) -> dict:
        return asdict(self)


def assess(point_count: int, source_size: int, record_len: int, folder: Path) -> Admission:
    ram_need, ram_have = ram_needed(point_count), available_ram()
    disk_need, disk_have = disk_needed(point_count, source_size, record_len), free_disk(folder)
    reason = None
    if ram_need > ram_have:
        reason = (
            f"This cloud needs about {gb(ram_need)} of free memory; {gb(ram_have)} is free. "
            "Close other programs and try again."
        )
    elif disk_need > disk_have:
        reason = (
            f"This import needs about {gb(disk_need)} of free disk space on the project drive; "
            f"{gb(disk_have)} is free. Free some space and try again."
        )
    return Admission(reason is None, ram_need, ram_have, disk_need, disk_have, reason)


def require(adm: Admission) -> None:
    if not adm.ok:
        raise JobFailure(adm.reason)
