"""One process-wide GPU lock, shared by local inference, training and export.

Ultralytics happily runs two models at once and then runs the card out of memory; serialising the
GPU work is cheaper than tuning batch sizes against whatever else the user started.
"""

import logging
import threading
import time
from collections.abc import Iterator
from contextlib import contextmanager

WAIT_LOG_THRESHOLD_S = 1.0

gpu_lock = threading.Lock()


@contextmanager
def hold_gpu(log: logging.Logger, what: str) -> Iterator[None]:
    started = time.monotonic()
    with gpu_lock:
        waited = time.monotonic() - started
        if waited >= WAIT_LOG_THRESHOLD_S:
            log.info("%s waited %.1f s for the GPU", what, waited)
        yield
