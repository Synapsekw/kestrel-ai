"""Health endpoint and the CUDA probe that fills its `gpu` block (spec section 10).

Asking torch whether CUDA is available costs seconds on a cold process — importing the CUDA
runtime DLLs in the packaged build is the expensive part — so the answer is never computed on
the request thread: the first health request starts a background probe and every request reports
whatever the probe has produced so far.
"""

import logging
import os
import threading
import time
from collections.abc import Callable

from fastapi import APIRouter, Request

router = APIRouter()
log = logging.getLogger(__name__)

PROBE_TIMEOUT_S = 10.0
NO_GPU: dict = {"available": False, "name": None}


def probe_cuda() -> dict:
    """Import torch and ask CUDA for the first device's name."""
    import torch

    if not torch.cuda.is_available():
        return dict(NO_GPU)
    return {"available": True, "name": torch.cuda.get_device_name(0)}


class GpuProbe:
    """Runs `probe` once in a background thread, started by the first `snapshot()`.

    `snapshot()` never blocks. It returns `None` while the probe is still running (the contract
    leaves `gpu` absent then) and falls back to "no GPU" once the probe has taken longer than
    `timeout_s`: a machine whose CUDA stack is that slow is not one the UI should wait for. A late
    answer still replaces the fallback, so the field becomes correct as soon as the probe returns.
    """

    def __init__(
        self,
        probe: Callable[[], dict] = probe_cuda,
        timeout_s: float = PROBE_TIMEOUT_S,
        clock: Callable[[], float] = time.monotonic,
    ):
        self._probe = probe
        self._timeout_s = timeout_s
        self._clock = clock
        self._lock = threading.Lock()
        self._started_at: float | None = None
        self._result: dict | None = None

    def snapshot(self) -> dict | None:
        with self._lock:
            if self._result is not None:
                return self._result
            if self._started_at is None:
                self._started_at = self._clock()
                threading.Thread(target=self._run, name="gpu-probe", daemon=True).start()
                return None
            expired = self._clock() - self._started_at >= self._timeout_s
        return dict(NO_GPU) if expired else None

    def _run(self) -> None:
        try:
            value = self._probe()
        except Exception as e:
            log.warning("gpu probe failed: %s: %s", type(e).__name__, e)
            value = dict(NO_GPU)
        with self._lock:
            self._result = value


@router.get("/health")
def health(request: Request) -> dict:
    s = request.app.state.settings
    body = {
        "status": "ok",
        "version": s.version,
        "pid": os.getpid(),
        "started_at": request.app.state.started_at,
    }
    gpu = request.app.state.gpu_probe.snapshot()
    if gpu is not None:
        body["gpu"] = gpu
    return body
