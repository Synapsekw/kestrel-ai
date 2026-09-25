"""Checks on the converter's output before it becomes the cloud's display copy (spec §6.8)."""

from __future__ import annotations

import json
from pathlib import Path

from app.jobs.cancellation import JobFailure

TOLERANCE = 1e-6


def validate_octree(octree: Path, *, points: int, bounds: list[float], encoding: str) -> dict:
    try:
        meta = json.loads((octree / "metadata.json").read_text("utf-8"))
    except (OSError, ValueError) as e:
        raise JobFailure(
            f"the 3D view copy failed its checks: metadata.json could not be read ({e})"
        ) from None
    problems: list[str] = []
    if meta.get("version") != "2.0":
        problems.append(f"version {meta.get('version')!r}, expected '2.0'")
    if meta.get("encoding") != encoding:
        problems.append(f"encoding {meta.get('encoding')!r}, expected {encoding!r}")
    if meta.get("points") != points:
        problems.append(f"{meta.get('points')} points, expected {points}")
    box = meta.get("boundingBox") or {}
    lo, hi = box.get("min"), box.get("max")
    inside = (
        isinstance(lo, list)
        and isinstance(hi, list)
        and all(lo[i] <= bounds[i] + TOLERANCE for i in range(3))
        and all(hi[i] >= bounds[i + 3] - TOLERANCE for i in range(3))
    )
    if not inside:
        problems.append("its bounding box does not contain the cloud")
    spacing = meta.get("spacing")
    if not isinstance(spacing, (int, float)) or spacing <= 0:
        problems.append(f"spacing {spacing}")
    hierarchy, data = octree / "hierarchy.bin", octree / "octree.bin"
    if not hierarchy.is_file():
        problems.append("hierarchy.bin is missing")
    else:
        first = int((meta.get("hierarchy") or {}).get("firstChunkSize", 0))
        size = hierarchy.stat().st_size
        if size < first or first <= 0:
            problems.append(f"hierarchy.bin is {size} bytes, shorter than its first chunk ({first})")
    if not data.is_file() or data.stat().st_size == 0:
        problems.append("octree.bin is missing or empty")
    if problems:
        raise JobFailure("the 3D view copy failed its checks: " + "; ".join(problems))
    return meta
