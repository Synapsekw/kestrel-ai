"""The inspection folder (spec §3 Storage): request, inspection and preview JSON, and the cache.

<project>/cache/design-inspections/<inspection_id>/
  request.json       path, job ids, created_at (written by the router only)
  inspection.json    the DesignInspection body; internal.json next to it
  cand/<cid>/        points.f64 (N x 3), faces.i32 (M x 3) or runs.i64 (K + 1), meta.json
  thumbs/<cid>.png
  previews/<pid>/    preview.json (the DesignPreview body), internal.json, preview.png

Every JSON write is atomic and goes through one lock, so the router and a job can patch disjoint
keys of the same file. A write into a folder that no longer exists is a no-op: a job that is still
running when the dialog deleted its inspection must not recreate the folder.
"""

from __future__ import annotations

import hashlib
import json
import os
import re
import threading
import uuid
from collections.abc import Callable, Iterable
from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path

import numpy as np

from app.errors import not_found

ID_RE = re.compile(r"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$")
HASH_CHUNK = 64 * 2**20
_LOCK = threading.RLock()


def inspections_root(handle) -> Path:
    return Path(handle.folder) / "cache" / "design-inspections"


def new_id() -> str:
    return str(uuid.uuid4())


def inspection_dir(handle, inspection_id: str) -> Path:
    """The folder of one inspection. Ids are UUIDs only, so a crafted id cannot leave the cache.

    `fullmatch`, not `match`: with `match`, `$` also matches just before a trailing newline, so
    a UUID followed by "\\n" would otherwise be accepted."""
    if not ID_RE.fullmatch(inspection_id or ""):
        raise not_found("design inspection", inspection_id)
    return inspections_root(handle) / inspection_id


def require_inspection(handle, inspection_id: str) -> Path:
    d = inspection_dir(handle, inspection_id)
    if not (d / "inspection.json").is_file():
        raise not_found("design inspection", inspection_id)
    return d


def preview_dir(idir: Path, preview_id: str) -> Path:
    if not ID_RE.fullmatch(preview_id or ""):
        raise not_found("design preview", preview_id)
    return idir / "previews" / preview_id


def require_preview(idir: Path, preview_id: str) -> Path:
    d = preview_dir(idir, preview_id)
    if not (d / "preview.json").is_file():
        raise not_found("design preview", preview_id)
    return d


def candidate_dir(idir: Path, cid: str) -> Path:
    return idir / "cand" / cid


def thumb_path(idir: Path, cid: str) -> Path:
    return idir / "thumbs" / f"{cid}.png"


def read_json(path: Path) -> dict:
    """Under the lock: unsynchronized with write_json/patch_json, a plain read can catch
    os.replace() mid-rename (or vice versa) and raise a transient Windows PermissionError - the
    lock (an RLock, so patch_json's own read_json call re-enters it harmlessly) closes that."""
    with _LOCK:
        return json.loads(Path(path).read_text("utf-8"))


def write_json(path: Path, data: dict) -> bool:
    """Atomic write; False (and nothing written) when the parent folder is gone."""
    path = Path(path)
    with _LOCK:
        if not path.parent.is_dir():
            return False
        tmp = path.with_name(path.name + ".tmp")
        tmp.write_text(json.dumps(data, indent=2), "utf-8")
        os.replace(tmp, path)
        return True


def patch_json(path: Path, **fields) -> dict | None:
    """Merge `fields` into a JSON file under the lock; None when the file is gone."""
    path = Path(path)
    with _LOCK:
        if not path.is_file():
            return None
        data = read_json(path)
        data.update(fields)
        write_json(path, data)
        return data


def update_json(path: Path, fn: Callable[[dict], dict]) -> dict | None:
    """Read, apply `fn(data) -> data` and write, all under the lock, so a read-modify-write (such as
    appending to a list) cannot lose a concurrent update; None when the file is gone."""
    path = Path(path)
    with _LOCK:
        if not path.is_file():
            return None
        data = fn(read_json(path))
        write_json(path, data)
        return data


def create_inspection(handle, inspection_id: str, source: Path, fmt: str) -> Path:
    d = inspection_dir(handle, inspection_id)
    d.mkdir(parents=True)
    now = datetime.now(UTC).isoformat()
    write_json(
        d / "request.json",
        {
            "path": str(source),
            "created_at": now,
            "inspect_job_id": None,
            "preview_job_ids": [],
            "latest_preview_id": None,
            "latest_preview_job_id": None,
            "build_job_id": None,
            "surface_id": None,
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
            "detected": None,
            "candidates": [],
            "default_target_surface_id": None,
            "created_at": now,
        },
    )
    return d


def job_ids(request: dict) -> list[str]:
    ids = [request.get("inspect_job_id"), *request.get("preview_job_ids", []), request.get("build_job_id")]
    return [i for i in ids if i]


def build_live(request: dict, runner) -> bool:
    """True while a design surface is being imported from this inspection (its build job is live)."""
    job_id = request.get("build_job_id")
    return bool(job_id) and runner.is_live(job_id)


def sha256_file(path: Path, *, progress: Callable[[float], None], check_cancelled: Callable[[], None]) -> str:
    digest, size, done = hashlib.sha256(), max(Path(path).stat().st_size, 1), 0
    with Path(path).open("rb") as f:
        while chunk := f.read(HASH_CHUNK):
            check_cancelled()
            digest.update(chunk)
            done += len(chunk)
            progress(min(1.0, done / size))
    progress(1.0)
    return digest.hexdigest()


class CandidateWriter:
    """Appends one candidate's geometry to cand/<cid>/ in file units, x = easting (spec §3)."""

    def __init__(self, cdir: Path, geometry: str):
        # Each level below the inspection dir is created with parents=False: if a reader is still
        # running after the inspection was deleted, the missing grandparent raises FileNotFoundError
        # instead of silently recreating the folder the delete just removed.
        cdir.parent.mkdir(parents=False, exist_ok=True)
        cdir.mkdir(parents=False, exist_ok=True)
        self.cdir, self.geometry = cdir, geometry
        self._points = (cdir / "points.f64").open("wb")
        self._faces = (cdir / "faces.i32").open("wb") if geometry == "faces" else None
        self._runs = (cdir / "runs.i64").open("wb") if geometry == "points" else None
        if self._runs is not None:
            self._runs.write(np.zeros(1, np.int64).tobytes())
        self.point_count = self.face_count = self.run_count = 0
        self._lo = np.full(3, np.inf)
        self._hi = np.full(3, -np.inf)

    def add_points(self, xyz) -> int:
        """Append vertices; returns the index of the first one."""
        a = np.ascontiguousarray(xyz, dtype=np.float64).reshape(-1, 3)
        base = self.point_count
        if len(a):
            self._points.write(a.tobytes())
            self.point_count += len(a)
            self._lo = np.minimum(self._lo, a.min(0))
            self._hi = np.maximum(self._hi, a.max(0))
        return base

    def add_faces(self, tri) -> None:
        a = np.ascontiguousarray(tri, dtype=np.int32).reshape(-1, 3)
        self._faces.write(a.tobytes())
        self.face_count += len(a)

    def add_runs(self, xyz, lengths: Iterable[int]) -> None:
        """Append vertex runs (a polyline, a LINE, a POINT) whose sizes are `lengths`."""
        lengths = np.asarray(list(lengths) if not isinstance(lengths, np.ndarray) else lengths, np.int64)
        base = self.point_count
        self.add_points(xyz)
        if len(lengths):
            self._runs.write((base + np.cumsum(lengths)).astype(np.int64).tobytes())
            self.run_count += len(lengths)

    def abort(self) -> None:
        """Close every open file without writing meta.json (a reader that failed mid-surface must
        not leave a meta.json that looks like a complete candidate, and must not risk a second,
        masking failure from that write)."""
        for f in (self._points, self._faces, self._runs):
            if f is not None and not f.closed:
                f.close()

    def close(self, **extra) -> dict:
        for f in (self._points, self._faces, self._runs):
            if f is not None:
                f.close()
        has = self.point_count > 0
        meta = {
            "geometry": self.geometry,
            "point_count": self.point_count,
            "face_count": self.face_count,
            "run_count": self.run_count,
            "bbox": [float(self._lo[0]), float(self._lo[1]), float(self._hi[0]), float(self._hi[1])]
            if has
            else None,
            "z_min": float(self._lo[2]) if has else None,
            "z_max": float(self._hi[2]) if has else None,
            **extra,
        }
        write_json(self.cdir / "meta.json", meta)
        return meta


@dataclass
class CandidateArrays:
    points: np.ndarray  # (N, 3) float64, memory-mapped
    faces: np.ndarray | None  # (M, 3) int32
    runs: np.ndarray | None  # (K + 1,) int64
    meta: dict


def _map(path: Path, dtype, cols: int) -> np.ndarray:
    itemsize = np.dtype(dtype).itemsize * cols
    n = path.stat().st_size // itemsize
    shape = (n, cols) if cols > 1 else (n,)
    if n == 0:
        return np.zeros(shape, dtype)
    return np.memmap(path, dtype=dtype, mode="r", shape=shape)


def read_candidate(cdir: Path) -> CandidateArrays:
    """Memory-map a cached candidate. On Windows a live memmap keeps the file open: drop the arrays
    (and `gc.collect()`) before deleting the inspection folder."""
    faces, runs = cdir / "faces.i32", cdir / "runs.i64"
    return CandidateArrays(
        points=_map(cdir / "points.f64", np.float64, 3),
        faces=_map(faces, np.int32, 3) if faces.is_file() else None,
        runs=_map(runs, np.int64, 1) if runs.is_file() else None,
        meta=read_json(cdir / "meta.json"),
    )
