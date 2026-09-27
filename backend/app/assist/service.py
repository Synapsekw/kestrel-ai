"""The smart-polygon service (spec 2026-09-26-image-inspection §10; rulings BS6, BS7, BS11, BS12).

One backend (its own slot, not the YOLO `_MODEL` cache), an LRU of two embeddings (CPU-resident, so
they survive a device switch), the device chosen per call (CUDA when `hold_gpu` answers within
0.2 s, else the CPU), and an unload after ten idle minutes. The real backend module is imported
through `importlib` on first use, so a build without the SAM modules still starts and only this tool
reports itself unavailable (spec §16).

`unavailable_reason` is not sticky (ruling F2): every call that needs a backend attempts to get one
when none is loaded, so a factory/import failure or a CPU `AssistUnavailable` sets the reason, and a
later successful call clears it again. A CUDA-side `AssistUnavailable` is different: it is transient
GPU trouble (e.g. VRAM pressure from another process), not "SAM cannot run" (BS7), so it does not set
`unavailable_reason` — it only backs the cuda branch off for `CUDA_RETRY_S`, so repeated clicks don't
each pay a cuda-load-then-fail-then-cpu-reload round trip.
"""

from __future__ import annotations

import importlib
import logging
import threading
import time
from collections import OrderedDict
from collections.abc import Callable
from dataclasses import dataclass
from pathlib import Path
from typing import TypeVar

import numpy as np
from PIL import Image as PILImage
from PIL import UnidentifiedImageError

from app.assist import geometry
from app.assist.errors import AssistUnavailable
from app.assist.geometry import Crop
from app.assist.sam import BackendFactory, Device, SegmentBackend
from app.errors import not_found
from app.jobs.gpu import GpuBusy, hold_gpu

log = logging.getLogger(__name__)

GPU_WAIT_S = 0.2
IDLE_UNLOAD_S = 600.0
EMBEDDINGS = 2
BACKEND_MODULE = "app.assist.ultralytics_backend"
#: After a CUDA-side AssistUnavailable (e.g. OOM under persistent VRAM pressure from another
#: process), skip the cuda branch for this long and go straight to the CPU, rather than paying a
#: cuda-load-then-fail-then-cpu-reload round trip (~1 s) on every click.
CUDA_RETRY_S = 60.0

T = TypeVar("T")


@dataclass(frozen=True)
class Prepared:
    crop: Crop
    device: Device
    encode_ms: int
    cached: bool


@dataclass(frozen=True)
class Segmented:
    crop: Crop
    polygon: list[list[float]] | None
    score: float
    device: Device
    encode_ms: int
    decode_ms: int


def default_backend_factory(weights: Path) -> SegmentBackend:
    module = importlib.import_module(BACKEND_MODULE)
    return module.UltralyticsSam2Backend(weights)


def default_cuda_available() -> bool:
    try:
        import torch

        return bool(torch.cuda.is_available())
    except Exception:
        log.exception("torch could not report CUDA; smart polygon runs on the CPU")
        return False


def read_crop(image_path: Path, crop: Crop) -> np.ndarray:
    """The crop of the stored frame as RGB uint8, resized so its long side is 1024 (spec I-D6).

    A frame that cannot be opened (missing, truncated, not an image) answers 404 `not_found`
    (ruling F15), not a 500 — the file went missing or was corrupted after the image was indexed.
    """
    try:
        with PILImage.open(image_path) as im:
            region = im.convert("RGB").crop((crop.x, crop.y, crop.x + crop.w, crop.y + crop.h))
            pixels = np.asarray(region.resize(crop.model_size(), PILImage.BILINEAR))
    except (OSError, UnidentifiedImageError) as e:
        raise not_found("image file", str(image_path)) from e
    return pixels


def _ms(started: float) -> int:
    return round((time.perf_counter() - started) * 1000)


class SegmentService:
    def __init__(
        self,
        backend_factory: BackendFactory = default_backend_factory,
        cuda_available: Callable[[], bool] = default_cuda_available,
        idle_unload_s: float = IDLE_UNLOAD_S,
    ):
        self._factory, self._cuda_probe, self._idle_s = backend_factory, cuda_available, idle_unload_s
        self._cuda: bool | None = None
        self._lock = threading.Lock()
        self._backend: SegmentBackend | None = None
        self._weights: Path | None = None
        self._cache: OrderedDict[tuple, object] = OrderedDict()
        self._timer: threading.Timer | None = None
        self._last_used = 0.0
        self._cuda_retry_at = 0.0
        self.unavailable_reason: str | None = None

    # ------------------------------------------------------------------ public

    def prepare(self, key: tuple[str, str], image_path: Path, crop: Crop, weights: Path) -> Prepared:
        with self._lock:
            try:
                device, (_, encode_ms, cached) = self._run(
                    weights, lambda b, d: self._embedding(b, d, key, image_path, crop)
                )
            finally:
                self._touch()
        return Prepared(crop, device, encode_ms, cached)

    def segment(
        self,
        key: tuple[str, str],
        image_path: Path,
        crop: Crop,
        weights: Path,
        points: list[tuple[float, float]],
        labels: list[int],
    ) -> Segmented:
        model_points = geometry.to_model_px(crop, points)

        def work(backend: SegmentBackend, device: Device):
            embedding, encode_ms, _ = self._embedding(backend, device, key, image_path, crop)
            started = time.perf_counter()
            mask, score = backend.decode(embedding, model_points, list(labels), device)
            return mask, float(score), encode_ms, _ms(started)

        with self._lock:
            try:
                device, (mask, score, encode_ms, decode_ms) = self._run(weights, work)
            finally:
                self._touch()
        model_polygon = geometry.mask_to_polygon(mask)
        polygon = geometry.to_image_px(crop, model_polygon) if model_polygon else None
        return Segmented(crop, polygon, score if polygon else 0.0, device, encode_ms, decode_ms)

    def clear_embeddings(self) -> None:
        with self._lock:
            self._cache.clear()

    def unload(self) -> None:
        with self._lock:
            if self._timer is not None:
                self._timer.cancel()
            self._drop_backend()
            self._cache.clear()

    # ----------------------------------------------------------------- private

    def _cuda_ok(self) -> bool:
        if self._cuda is None:
            self._cuda = bool(self._cuda_probe())
        return self._cuda

    def _run(self, weights: Path, work: Callable[[SegmentBackend, Device], T]) -> tuple[Device, T]:
        backend = self._get_backend(weights)
        if self._cuda_ok() and time.monotonic() >= self._cuda_retry_at:
            try:
                with hold_gpu(log, "smart polygon", timeout=GPU_WAIT_S):
                    result = work(backend, "cuda")
                self.unavailable_reason = None
                return "cuda", result
            except GpuBusy:
                log.info("the GPU is busy; smart polygon runs on the CPU")
            except AssistUnavailable:
                log.warning("smart polygon could not use the GPU; trying the CPU", exc_info=True)
                self._cuda_retry_at = time.monotonic() + CUDA_RETRY_S
        try:
            result = work(backend, "cpu")
        except AssistUnavailable as e:
            self.unavailable_reason = str(e)
            raise
        self.unavailable_reason = None
        return "cpu", result

    def _get_backend(self, weights: Path) -> SegmentBackend:
        if self._backend is not None and self._weights != weights:
            self._drop_backend()
            self._cache.clear()
        if self._backend is None:
            try:
                self._backend = self._factory(weights)
            except Exception as e:
                log.exception("smart polygon could not be loaded")
                self.unavailable_reason = f"{type(e).__name__}: {e}"
                raise AssistUnavailable(self.unavailable_reason) from e
            self._weights = weights
        return self._backend

    def _drop_backend(self) -> None:
        if self._backend is None:
            return
        try:
            self._backend.close()
        except Exception:
            log.exception("closing the smart polygon model failed")
        self._backend, self._weights = None, None

    def _embedding(
        self, backend: SegmentBackend, device: Device, key: tuple[str, str], image_path: Path, crop: Crop
    ):
        full = (*key, crop)
        if full in self._cache:
            self._cache.move_to_end(full)
            return self._cache[full], 0, True
        started = time.perf_counter()
        embedding = backend.encode(read_crop(image_path, crop), device)
        encode_ms = _ms(started)
        self._cache[full] = embedding
        while len(self._cache) > EMBEDDINGS:
            self._cache.popitem(last=False)
        return embedding, encode_ms, False

    def _touch(self) -> None:
        self._last_used = time.monotonic()
        if self._timer is not None:
            self._timer.cancel()
        self._timer = threading.Timer(self._idle_s, self._unload_if_idle)
        self._timer.daemon = True
        self._timer.start()

    def _unload_if_idle(self) -> None:
        with self._lock:
            remaining = self._idle_s - (time.monotonic() - self._last_used)
            if remaining > 0:
                # The timer woke a little early (Windows timer granularity); reschedule for what
                # is left rather than dropping the check, or a fast wake-up never unloads at all.
                self._timer = threading.Timer(remaining, self._unload_if_idle)
                self._timer.daemon = True
                self._timer.start()
                return
            self._drop_backend()
            self._cache.clear()
            log.info("smart polygon unloaded after %.0f s idle", self._idle_s)
