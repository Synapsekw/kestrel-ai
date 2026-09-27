"""SAM 2.1 through Ultralytics (spec 2026-09-26-image-inspection I-D5), implementing I-C0's
`app.assist.sam.SegmentBackend`.

The only `app.assist` module that imports torch and ultralytics. `service.default_backend_factory`
reaches it through `importlib`, so a frozen build without the SAM modules still starts (spec §16).
One predictor is loaded at a time, on the device the last call asked for; embeddings leave `encode`
on the CPU and are moved to the requested device in `decode` (ruling BS6).

A CUDA runtime failure (out of memory, a driver or kernel error) while loading, encoding or decoding
on `"cuda"` is logged, the predictor is dropped, and it is re-raised as `AssistUnavailable`, so the
service falls back to the CPU (ruling BS7, controller ruling F3).
"""

from __future__ import annotations

import logging
import os
from collections.abc import Callable, Sequence
from pathlib import Path
from typing import Any, TypeVar

import numpy as np
import torch
from ultralytics.models.sam import SAM2Predictor

from app.assist.errors import AssistUnavailable
from app.assist.geometry import MODEL_SIDE
from app.assist.sam import Device

log = logging.getLogger(__name__)

T = TypeVar("T")


def _limit_cpu_threads() -> None:
    """Half the cores (at least two), so the API stays responsive while SAM encodes (spec §10).

    Called after every CPU predictor load: Ultralytics' `select_device("cpu")` resets torch to
    `min(8, cores - 1)` threads inside `setup_model`, which would otherwise override this cap.
    """
    torch.set_num_threads(max(2, (os.cpu_count() or 4) // 2))


def _to(value, device):
    if isinstance(value, torch.Tensor):
        return value.to(device)
    if isinstance(value, dict):
        return {k: _to(v, device) for k, v in value.items()}
    if isinstance(value, list | tuple):
        return type(value)(_to(v, device) for v in value)
    return value


def _is_cuda_failure(e: BaseException) -> bool:
    """Out of memory, or a RuntimeError the CUDA runtime raised (torch reports those as
    `RuntimeError`/`AcceleratorError` with "CUDA" in the message)."""
    if isinstance(e, torch.cuda.OutOfMemoryError):
        return True
    return isinstance(e, RuntimeError) and "cuda" in str(e).lower()


def _new_predictor(weights: Path, device: Device) -> SAM2Predictor:
    predictor = SAM2Predictor(
        overrides={
            "model": str(weights),
            "imgsz": MODEL_SIDE,
            "device": "0" if device == "cuda" else "cpu",
            "conf": 0.0,
            "verbose": False,
            "save": False,
        }
    )
    predictor.setup_model(verbose=False)
    return predictor


class UltralyticsSam2Backend:
    def __init__(self, weights: Path, predictor_factory: Callable[[Path, Device], Any] = _new_predictor):
        self._weights = Path(weights)
        self._new_predictor = predictor_factory
        self._predictor: SAM2Predictor | None = None
        self._device: Device | None = None

    def _on(self, device: Device) -> SAM2Predictor:
        if self._predictor is not None and self._device == device:
            return self._predictor
        self._release()
        try:
            predictor = self._new_predictor(self._weights, device)
        except Exception as e:
            if device == "cuda":
                log.warning("SAM 2.1 could not load on cuda", exc_info=True)
                self._free_cuda()
            raise AssistUnavailable(f"SAM 2.1 could not load on {device}: {type(e).__name__}: {e}") from e
        if device == "cpu":
            _limit_cpu_threads()
        self._predictor, self._device = predictor, device
        return predictor

    def _guarded(self, device: Device, what: str, work: Callable[[], T]) -> T:
        """Run `work`; on `"cuda"` a CUDA runtime failure becomes `AssistUnavailable` (F3)."""
        if device != "cuda":
            return work()
        try:
            return work()
        except Exception as e:
            if not _is_cuda_failure(e):
                raise
            log.warning("SAM 2.1 %s failed on cuda; dropping the GPU predictor", what, exc_info=True)
            self._release()
            raise AssistUnavailable(f"SAM 2.1 {what} failed on cuda: {type(e).__name__}: {e}") from e

    def encode(self, rgb: np.ndarray, device: Device) -> Any:
        def work():
            predictor = self._on(device)
            # SAM2Predictor.preprocess expects BGR, as cv2 reads it, and converts to RGB itself.
            predictor.set_image(np.ascontiguousarray(rgb[..., ::-1]))
            features = predictor.features
            predictor.reset_image()
            return {"features": _to(features, "cpu"), "shape": tuple(rgb.shape[:2])}

        return self._guarded(device, "encode", work)

    def decode(
        self,
        embedding: Any,
        points: Sequence[tuple[float, float]],
        labels: Sequence[int],
        device: Device,
    ) -> tuple[np.ndarray, float]:
        def work():
            predictor = self._on(device)
            shape = embedding["shape"]
            masks, boxes = predictor.inference_features(
                _to(embedding["features"], predictor.device),
                src_shape=shape,
                points=[[list(p) for p in points]],  # one object, N points: (1, N, 2)
                labels=[list(labels)],
                multimask_output=True,
            )
            if masks is None or len(masks) == 0:
                return np.zeros(shape, bool), 0.0
            scores = boxes[:, 4].float()
            best = int(torch.argmax(scores))
            return masks[best].cpu().numpy().astype(bool), float(scores[best])

        return self._guarded(device, "decode", work)

    def close(self) -> None:
        self._release()

    def _release(self) -> None:
        if self._predictor is None:
            return
        was_cuda = self._device == "cuda"
        self._predictor, self._device = None, None
        if was_cuda:
            self._free_cuda()

    @staticmethod
    def _free_cuda() -> None:
        try:
            torch.cuda.empty_cache()
        except Exception:
            log.warning("freeing CUDA memory failed", exc_info=True)
