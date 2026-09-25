"""The PotreeConverter seam (spec 2026-09-23-point-clouds sections 2 and 6.7).

Foundation F0 fixes the signature so the test fixture can replace it from day one
(`tests/conftest.py::app` installs `tests/pointclouds.py::fake_run_converter`, per the ADR
2026-09-21-gotcha-contract-jobs-need-offline-seams). Unit I1 builds the real runner: subprocess,
Windows Job Object, progress parsing, the one-at-a-time lock and cancel.

Callers resolve it at call time through the module (`converter.run_converter(...)`), never with a
module-scope `from app.pointclouds.converter import run_converter` or a default argument bound at
import: either would keep the real runner after the fixture patched the module attribute.
"""

from __future__ import annotations

from collections.abc import Callable
from dataclasses import dataclass
from pathlib import Path


@dataclass(frozen=True)
class ConverterResult:
    """What a finished conversion reports."""

    octree_dir: Path  # holds metadata.json, hierarchy.bin and octree.bin
    log_tail: list[str]  # the converter's last output lines, at most 200
    command: list[str]  # the command line, for source.json
    seconds: float
    encoding: str = "BROTLI"  # what metadata.json must say; the offline fake reports "DEFAULT"
    version: str = "2.1.5"  # the PotreeConverter version, for source.json


def run_converter(
    input_path: Path,
    out_dir: Path,
    *,
    progress: Callable[[float, str], None],
    check_cancelled: Callable[[], None],
) -> ConverterResult:
    """Convert the LAS/LAZ at `input_path` into a Potree 2.0 octree in `out_dir`."""
    raise NotImplementedError("the PotreeConverter runner is built in unit I1")
