"""Offline stand-ins for smart polygon (ADR 2026-09-21-gotcha-contract-jobs-need-offline-seams).

No test downloads the real 78 MB checkpoint or loads SAM: `fake_sam_spec` pins the catalogue to a
few fake bytes, and `FakeDiscBackend` (Task 4) answers every click with a disc mask.
"""

from __future__ import annotations

import hashlib
from dataclasses import replace
from pathlib import Path

import numpy as np

from app.assist import catalogue
from app.assist.errors import AssistUnavailable


def fake_sam_spec(monkeypatch, content: bytes) -> catalogue.AssistSpec:
    """Pin the SAM catalogue entry to `content`'s size and sha256 for this test."""
    spec = replace(
        catalogue.get_spec(catalogue.SAM_KEY),
        size_bytes=len(content),
        sha256=hashlib.sha256(content).hexdigest(),
    )
    monkeypatch.setitem(catalogue.ASSIST_MODELS, catalogue.SAM_KEY, spec)
    catalogue.forget_verified()
    return spec


def install_weights(library_folder: Path, monkeypatch, content: bytes = b"fake sam 2.1 tiny weights") -> Path:
    """Fake weights at the real location under `library_folder`, matching the pinned (fake) spec."""
    spec = fake_sam_spec(monkeypatch, content)
    path = catalogue.weights_path(library_folder, spec)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(content)
    return path


class FakeDiscBackend:
    """C0's `SegmentBackend` with no model: `decode` answers a disc centred on the first positive
    point, in the encoded image's px, score 0.9. `radius=0` answers an empty mask. A device in
    `fail_on` raises `AssistUnavailable`, like a model that will not load there."""

    def __init__(self, radius: int = 60, fail_on: set[str] | None = None):
        self.radius = radius
        self.fail_on = fail_on if fail_on is not None else set()
        self.encodes = 0
        self.closed = False
        self.calls: list[tuple[str, str]] = []  # (operation, device)
        self.decoded: list[tuple[list, list]] = []

    def _check(self, device: str) -> None:
        if device in self.fail_on:
            raise AssistUnavailable(f"cannot load SAM on {device}")

    def encode(self, rgb: np.ndarray, device: str):
        self._check(device)
        assert rgb.dtype == np.uint8 and rgb.ndim == 3 and max(rgb.shape[:2]) == 1024
        self.encodes += 1
        self.calls.append(("encode", device))
        return {"shape": rgb.shape[:2]}

    def decode(self, embedding, points, labels, device: str):
        self._check(device)
        self.calls.append(("decode", device))
        self.decoded.append((list(points), list(labels)))
        h, w = embedding["shape"]
        if self.radius <= 0:
            return np.zeros((h, w), bool), 0.9
        positive = [p for p, label in zip(points, labels, strict=True) if label == 1]
        cx, cy = positive[0] if positive else (w / 2, h / 2)
        yy, xx = np.mgrid[0:h, 0:w]
        return (xx - cx) ** 2 + (yy - cy) ** 2 <= self.radius**2, 0.9

    def close(self) -> None:
        self.closed = True


class FakeFactory:
    """C0's `BackendFactory` (weights path -> backend) that records what it built. `fail_on` is shared
    with every backend it makes, so a test can clear it later; `broken` fails the factory itself,
    like a build whose SAM module will not import."""

    def __init__(self, radius: int = 60, fail_on: set[str] | None = None, broken: bool = False):
        self.radius, self.fail_on, self.broken = radius, set(fail_on or ()), broken
        self.made: list[FakeDiscBackend] = []

    def __call__(self, weights) -> FakeDiscBackend:
        if self.broken:
            raise ModuleNotFoundError("No module named 'ultralytics.models.sam'")
        backend = FakeDiscBackend(self.radius, self.fail_on)
        self.made.append(backend)
        return backend
