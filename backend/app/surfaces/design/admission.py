"""RAM admission before the heavy step of a phase (spec §4.3)."""

from __future__ import annotations

from collections.abc import Callable

import psutil

from app.jobs.cancellation import JobFailure

RAM_SHARE = 0.6
RASTERISE_BYTES = 100 * 2**20  # one 2048² float32 block, the written-mask and <= 64 MB batch buffers


def available_bytes() -> int:
    return int(psutil.virtual_memory().available)


def _fmt(n: int) -> str:
    return f"{n / 2**30:.1f} GB" if n >= 2**30 else f"{max(1, round(n / 2**20))} MB"


def admit(need: int, what: str, fix: str, *, available: Callable[[], int] | None = None) -> None:
    """Refuse with a JobFailure that states the need and the fix when `need` exceeds 60 % of free RAM."""
    limit = int(RAM_SHARE * (available or available_bytes)())
    if need > limit:
        raise JobFailure(
            f"{what} needs about {_fmt(need)} of memory, but only {_fmt(limit)} is safely free. {fix}"
        )


def tin_bytes(points: int, faces: int) -> int:
    return 32 * points + 12 * faces
