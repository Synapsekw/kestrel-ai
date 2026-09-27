"""The smart-polygon model seam (image inspection spec §10, §17).

`SegmentBackend` is one SAM 2.1 model instance: it encodes an RGB crop into an opaque embedding and
decodes point prompts against an embedding into the best mask. Unit I-BS implements it on
`ultralytics.models.sam.SAM2Predictor` (imported inside functions, never at module scope) and owns
the service around it: crop quantising, the embedding LRU, the GPU lock, contours. Tests use a fake
that draws a disc, so no weights are needed offline
(`vault/decisions/2026-09-21-gotcha-contract-jobs-need-offline-seams.md`).
"""

from __future__ import annotations

from collections.abc import Callable, Sequence
from pathlib import Path
from typing import TYPE_CHECKING, Any, Literal, Protocol, runtime_checkable

if TYPE_CHECKING:
    import numpy as np

Device = Literal["cuda", "cpu"]


@runtime_checkable
class SegmentBackend(Protocol):
    def encode(self, rgb: np.ndarray, device: Device) -> Any:
        """Embed an HxWx3 uint8 RGB crop (long side 1024) on `device`; the result is opaque."""
        ...

    def decode(
        self,
        embedding: Any,
        points: Sequence[tuple[float, float]],
        labels: Sequence[int],
        device: Device,
    ) -> tuple[np.ndarray, float]:
        """Point prompts in the crop's pixels (label 1 = object, 0 = background); the best of the
        multimask outputs as an HxW bool array, and its score."""
        ...

    def close(self) -> None:
        """Free the model (the idle unload after 10 minutes)."""
        ...


BackendFactory = Callable[[Path], SegmentBackend]  # weights path -> a loaded backend
