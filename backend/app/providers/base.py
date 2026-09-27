"""The provider interface every detector implements (spec section 8, Provider interface).

A `Detection` is always in full-image pixels with a project class name, whichever provider
produced it, so the query-run job and the editor treat local and cloud results identically.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass
from pathlib import Path
from typing import Protocol

from PIL import Image as PILImage

from app.geometry import aabb_of


@dataclass(frozen=True)
class Detection:
    """One detection in full-image pixels, labelled with a project class name.

    `x, y, w, h` follow the `Box` convention (`app/geometry.py`): a box's rectangle, an rbox's
    *unrotated* rectangle turned by `angle` degrees about its centre, a polygon's axis-aligned
    envelope. NMS and IoU compare `envelope()`s (image inspection spec §11.3).
    """

    label: str
    x: float
    y: float
    w: float
    h: float
    confidence: float
    raw_ref: str = ""  # where the provider's raw response for this box was persisted
    angle: float = 0.0  # degrees in [0, 180); non-zero only for an rbox
    polygon: tuple[tuple[float, float], ...] | None = None  # full-image px; polygon only

    def __post_init__(self) -> None:
        # A tile cache round-trips through JSON, which turns tuples into lists: keep one type so a
        # cached detection equals a fresh one.
        if self.polygon is not None:
            object.__setattr__(self, "polygon", tuple((float(px), float(py)) for px, py in self.polygon))

    @property
    def shape(self) -> str:
        if self.polygon is not None:
            return "polygon"
        return "rbox" if self.angle else "box"

    def envelope(self) -> tuple[float, float, float, float]:
        """The axis-aligned `(x, y, w, h)` that holds the shape."""
        if self.polygon is not None or not self.angle:
            return (self.x, self.y, self.w, self.h)
        return aabb_of(self.x, self.y, self.w, self.h, self.angle)

    @classmethod
    def from_polygon(cls, label: str, ring, confidence: float, raw_ref: str = "") -> Detection:
        xs = [float(p[0]) for p in ring]
        ys = [float(p[1]) for p in ring]
        x0, y0 = min(xs), min(ys)
        return cls(label, x0, y0, max(xs) - x0, max(ys) - y0, confidence, raw_ref, polygon=tuple(ring))


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
    """One tile's outcome: detections, the refusal metadata the job log records, and the raw
    response the job persists next to it (never the request's credentials)."""

    tile: Tile
    detections: list[Detection]
    refusal: dict | None = None
    raw: dict | None = None


class Provider(Protocol):
    """Every provider answers per tile; `detect` is the whole-image convenience on top of it."""

    name: str

    def detect_tile(
        self,
        image: PILImage.Image,
        tile: Tile,
        query: str,
        classes: list[str],
        *,
        conf: float,
        log: logging.Logger,
        raw_ref: str = "",
    ) -> TileResult: ...

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
