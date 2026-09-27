"""Offline stand-ins for smart polygon (ADR 2026-09-21-gotcha-contract-jobs-need-offline-seams).

No test downloads the real 78 MB checkpoint or loads SAM: `fake_sam_spec` pins the catalogue to a
few fake bytes, and `FakeDiscBackend` (Task 4) answers every click with a disc mask.
"""

from __future__ import annotations

import hashlib
from dataclasses import replace
from pathlib import Path

from app.assist import catalogue


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
