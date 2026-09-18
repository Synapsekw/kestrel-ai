"""One process-wide GPU lock, shared by local inference, training and export.

Ultralytics happily runs two models at once and then runs the card out of memory; serialising the
GPU work is cheaper than tuning batch sizes against whatever else the user started.

Waiting for the card can take as long as a training run, so no caller waits blindly: a job passes
its cancellation event and gets `JobCancelled` instead of a dead thread, and a request passes a
short timeout and gets `GpuBusy` so it can answer the user rather than hang.
"""

import logging
import threading
import time
from collections.abc import Iterator
from contextlib import contextmanager

WAIT_LOG_THRESHOLD_S = 1.0
CANCEL_POLL_S = 1.0

gpu_lock = threading.Lock()


class GpuBusy(Exception):
    """The GPU was still held when the caller's timeout ran out."""


def _cancelled_error() -> Exception:
    """The runner's `JobCancelled`, imported late.

    This module is a primitive that training, inference and the request thread all sit on top of;
    importing the job runner here at module scope would point the dependency the wrong way. Sharing
    the class matters more than the import style, because the runner recognises a cancelled job by
    catching exactly this type.
    """
    from app.jobs.runner import JobCancelled

    return JobCancelled()


def _acquire(cancelled: threading.Event | None, timeout: float | None) -> bool:
    if timeout is not None:
        return gpu_lock.acquire(timeout=timeout)
    if cancelled is None:
        gpu_lock.acquire()
        return True
    while not cancelled.is_set():  # poll so a cancelled job stops waiting for a training run
        if gpu_lock.acquire(timeout=CANCEL_POLL_S):
            return True
    raise _cancelled_error()


@contextmanager
def hold_gpu(
    log: logging.Logger,
    what: str,
    *,
    cancelled: threading.Event | None = None,
    timeout: float | None = None,
) -> Iterator[None]:
    started = time.monotonic()
    if not _acquire(cancelled, timeout):
        raise GpuBusy(f"{what} did not get the GPU within {timeout} s")
    try:
        waited = time.monotonic() - started
        if waited >= WAIT_LOG_THRESHOLD_S:
            log.info("%s waited %.1f s for the GPU", what, waited)
        yield
    finally:
        gpu_lock.release()
