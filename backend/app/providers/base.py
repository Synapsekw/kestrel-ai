"""The provider interface every detector implements (spec section 8, Provider interface).

A `Detection` is always in full-image pixels with a project class name, whichever provider
produced it, so the query-run job and the editor treat local and cloud results identically.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass
from pathlib import Path
from typing import Protocol


@dataclass(frozen=True)
class Detection:
    label: str
    x: float
    y: float
    w: float
    h: float
    confidence: float
    raw_ref: str = ""  # where the provider's raw response for this box was persisted


@dataclass(frozen=True)
class TilingSpec:
    enabled: bool = True
    tile_size: int = 1280
    overlap: float = 0.2
    nms_iou: float = 0.5


@dataclass(frozen=True)
class Tile:
    """A pixel window in the full image."""

    index: int
    x: int
    y: int
    w: int
    h: int


class ProviderError(Exception):
    """A provider call failed. `retryable` decides whether the job backs off or gives up."""

    def __init__(self, message: str, *, retryable: bool = False, retry_after: int | None = None):
        super().__init__(message)
        self.message, self.retryable, self.retry_after = message, retryable, retry_after


@dataclass(frozen=True)
class TileResult:
    """One tile's outcome: detections, plus the refusal metadata the job log records."""

    tile: Tile
    detections: list[Detection]
    refusal: dict | None = None


class Provider(Protocol):
    name: str

    def detect(
        self,
        image_path: Path,
        query: str,
        classes: list[str],
        tiling: TilingSpec,
        *,
        conf: float,
        log: logging.Logger,
    ) -> list[Detection]: ...
