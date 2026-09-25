"""Checks on the converter's output before it becomes the cloud's display copy (spec §6.8)."""

from __future__ import annotations

import json
from pathlib import Path

from app.jobs.cancellation import JobFailure

TOLERANCE = 1e-6


def _is_number(v: object) -> bool:
    return isinstance(v, (int, float)) and not isinstance(v, bool)


def _bounds_contain(lo: object, hi: object, bounds: list[float]) -> bool:
    """True iff `lo`/`hi` are well-formed 3-vectors of numbers containing `bounds`."""
    if not (isinstance(lo, list) and isinstance(hi, list) and len(lo) >= 3 and len(hi) >= 3):
        return False
    if not all(_is_number(v) for v in (*lo[:3], *hi[:3])):
        return False
    return all(lo[i] <= bounds[i] + TOLERANCE for i in range(3)) and all(
        hi[i] >= bounds[i + 3] - TOLERANCE for i in range(3)
    )


def _first_chunk_size(hierarchy_meta: object) -> int | None:
    """The declared first-chunk size, or None if it is missing, non-numeric or not positive."""
    if not isinstance(hierarchy_meta, dict):
        return None
    v = hierarchy_meta.get("firstChunkSize")
    if isinstance(v, bool):
        return None
    if isinstance(v, int):
        n = v
    elif isinstance(v, float) and v.is_integer():
        n = int(v)
    else:
        return None
    return n if n > 0 else None


def validate_octree(octree: Path, *, points: int, bounds: list[float], encoding: str) -> dict:
    try:
        # utf-8-sig: PotreeConverter 2.1.5 writes metadata.json with a UTF-8 BOM.
        meta = json.loads((octree / "metadata.json").read_text("utf-8-sig"))
    except (OSError, ValueError) as e:
        raise JobFailure(
            f"the 3D view copy failed its checks: metadata.json could not be read ({e})"
        ) from None
    if not isinstance(meta, dict):
        raise JobFailure("the 3D view copy failed its checks: metadata.json is not a JSON object")
    problems: list[str] = []
    if meta.get("version") != "2.0":
        problems.append(f"version {meta.get('version')!r}, expected '2.0'")
    if meta.get("encoding") != encoding:
        problems.append(f"encoding {meta.get('encoding')!r}, expected {encoding!r}")
    if meta.get("points") != points:
        problems.append(f"{meta.get('points')} points, expected {points}")
    box = meta.get("boundingBox")
    box = box if isinstance(box, dict) else {}
    if not _bounds_contain(box.get("min"), box.get("max"), bounds):
        problems.append("its bounding box does not contain the cloud")
    spacing = meta.get("spacing")
    if not isinstance(spacing, (int, float)) or isinstance(spacing, bool) or spacing <= 0:
        problems.append(f"spacing {spacing}")
    hierarchy, data = octree / "hierarchy.bin", octree / "octree.bin"
    if not hierarchy.is_file():
        problems.append("hierarchy.bin is missing")
    else:
        hierarchy_meta = meta.get("hierarchy")
        hierarchy_meta = hierarchy_meta if isinstance(hierarchy_meta, dict) else {}
        first = _first_chunk_size(hierarchy_meta)
        if first is None:
            raw = hierarchy_meta.get("firstChunkSize")
            problems.append(
                f"hierarchy metadata's firstChunkSize is missing or not a positive number ({raw!r})"
            )
        else:
            size = hierarchy.stat().st_size
            if size < first:
                problems.append(f"hierarchy.bin is {size} bytes, shorter than its first chunk ({first})")
    if not data.is_file() or data.stat().st_size == 0:
        problems.append("octree.bin is missing or empty")
    if problems:
        raise JobFailure("the 3D view copy failed its checks: " + "; ".join(problems))
    return meta
