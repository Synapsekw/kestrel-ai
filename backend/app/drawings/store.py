"""Folders of drawing inspections and drawings (spec §8.1 storage; plan Ruling 2).

<project>/cache/drawing-inspections/<iid>/
  request.json      path, inspect/build job ids, file_size + mtime_ns at inspect (the build's check)
  inspection.json   the DrawingInspection body
  thumbs/page-<n>.png
  lines/            vector drawings: flattened runs + labels.json (runs.py format)
<project>/drawings/<id>/   (ProjectHandle.drawings_dir, M-C0)
  plan.tif | lines.f64 runs.i64 runlayer.i32 runbbox.f64 buckets.i64 meta.json labels.json
  thumb.png, source.json

JSON writes reuse S3's atomic, locked helpers: a write into a folder that is gone is a no-op.
"""

from __future__ import annotations

from datetime import UTC, datetime
from pathlib import Path

from app.errors import not_found
from app.surfaces.design.store import ID_RE, new_id, patch_json, read_json, sha256_file, write_json

__all__ = [
    "create_inspection",
    "drawing_dir",
    "inspection_dir",
    "inspections_root",
    "lines_dir",
    "new_id",
    "page_thumb",
    "patch_json",
    "plan_path",
    "read_json",
    "require_inspection",
    "sha256_file",
    "thumb_path",
    "write_json",
]


def inspections_root(handle) -> Path:
    return Path(handle.folder) / "cache" / "drawing-inspections"


def inspection_dir(handle, inspection_id: str) -> Path:
    if not ID_RE.fullmatch(inspection_id or ""):
        raise not_found("drawing inspection", inspection_id)
    return inspections_root(handle) / inspection_id


def require_inspection(handle, inspection_id: str) -> Path:
    d = inspection_dir(handle, inspection_id)
    if not (d / "inspection.json").is_file():
        raise not_found("drawing inspection", inspection_id)
    return d


def page_thumb(idir: Path, n: int) -> Path:
    return idir / "thumbs" / f"page-{n}.png"


def lines_dir(idir: Path) -> Path:
    return idir / "lines"


def drawing_dir(handle, drawing_id: str) -> Path:
    """Drawing ids are M-C0's `new_id()` UUIDs; anything else cannot name a folder."""
    if not ID_RE.fullmatch(drawing_id or ""):
        raise not_found("drawing", drawing_id)
    return Path(handle.drawings_dir) / drawing_id


def plan_path(handle, drawing_id: str) -> Path:
    return drawing_dir(handle, drawing_id) / "plan.tif"


def thumb_path(handle, drawing_id: str) -> Path:
    return drawing_dir(handle, drawing_id) / "thumb.png"


def create_inspection(handle, inspection_id: str, source: Path, fmt: str) -> Path:
    d = inspection_dir(handle, inspection_id)
    d.mkdir(parents=True)
    (d / "thumbs").mkdir()
    now = datetime.now(UTC).isoformat()
    write_json(
        d / "request.json",
        {
            "path": str(source),
            "created_at": now,
            "inspect_job_id": None,
            "build_job_ids": [],
            "file_size": None,
            "mtime_ns": None,
        },
    )
    write_json(
        d / "inspection.json",
        {
            "id": inspection_id,
            "state": "inspecting",
            "error": None,
            "job_id": "",
            "path": str(source),
            "format": fmt,
            "file_size": source.stat().st_size,
            "sha256": None,
            "units": None,
            "units_source": None,
            "crs_hint": None,
            "extent_src": None,
            "layers": [],
            "page_count": None,
            "pages": [],
            "width": None,
            "height": None,
            "embedded": None,
            "warnings": [],
            "created_at": now,
        },
    )
    return d
