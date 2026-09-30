"""The snapshot cache (spec §6.3, §9.5): `<project>/reports/.cache/snapshots/<key>.jpg`, JPEG q85
4:2:0 with no EXIF and no timestamp, written atomically, pruned least-recently-used to 1 GB. A hit
touches the file's mtime, which is the LRU clock. Placeholders live in the same folder as
`ph-<hash>.jpg`, never under a snapshot key (plan ruling 4)."""

from __future__ import annotations

import hashlib
import io
import os
import re
from pathlib import Path
from uuid import uuid4

from PIL import Image as PILImage

from app.reports.snapshots import RENDERER_VERSION

CACHE_CAP_BYTES = 1 << 30
JPEG_QUALITY = 85
KEY_RE = re.compile(r"[0-9a-f]{32}")


def cache_dir(handle) -> Path:
    return Path(handle.folder) / "reports" / ".cache" / "snapshots"


def cached_path(handle, key: str) -> Path:
    if not KEY_RE.fullmatch(key):
        raise ValueError(f"not a snapshot key: {key!r}")
    return cache_dir(handle) / f"{key}.jpg"


def encode_jpeg(img: PILImage.Image, quality: int = JPEG_QUALITY) -> bytes:
    buf = io.BytesIO()
    img.convert("RGB").save(buf, "JPEG", quality=quality, subsampling=2, optimize=False, progressive=False)
    return buf.getvalue()


def write_jpeg(img: PILImage.Image, path: Path, quality: int = JPEG_QUALITY) -> Path:
    """Through a private temp name and a rename: a concurrent reader sees all of it or none."""
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_name(f"{path.name}.{uuid4().hex}.tmp")
    try:
        tmp.write_bytes(encode_jpeg(img, quality))
        os.replace(tmp, path)
    finally:
        tmp.unlink(missing_ok=True)
    return path


def touch(path: Path) -> None:
    try:
        os.utime(path)
    except OSError:
        pass  # best-effort LRU clock


def prune_dir(folder: Path, cap_bytes: int = CACHE_CAP_BYTES) -> int:
    """Delete the least recently used `*.jpg` until the folder holds at most `cap_bytes`. A file
    that cannot be deleted (open elsewhere on Windows, already gone) is skipped. Returns the bytes
    removed."""
    entries: list[tuple[int, int, str]] = []
    try:
        with os.scandir(folder) as it:
            for e in it:
                if not (e.name.endswith(".jpg") and e.is_file()):
                    continue
                try:
                    st = e.stat()
                except OSError:
                    continue
                entries.append((st.st_mtime_ns, st.st_size, e.path))
    except FileNotFoundError:
        return 0
    total = sum(size for _, size, _ in entries)
    removed = 0
    for _, size, path in sorted(entries):
        if total <= cap_bytes:
            break
        try:
            Path(path).unlink()
        except OSError:
            continue
        total -= size
        removed += size
    return removed


def prune(handle, cap_bytes: int = CACHE_CAP_BYTES) -> int:
    return prune_dir(cache_dir(handle), cap_bytes)


def placeholder_path(handle, reason: str, size: tuple[int, int]) -> Path:
    """The placeholder JPEG for `reason` at `size`, rendered on first use and shared by every
    snapshot with the same reason. A write that fails (OSError: a full or locked cache disk) is
    retried once to a private unique name, so a render failure still returns a viewable placeholder
    (A13); the retry's own OSError propagates, since nothing more can be written."""
    from app.reports.snapshots.placeholder import render_placeholder

    w, h = int(size[0]), int(size[1])
    digest = hashlib.sha256(f"{reason}\n{w}x{h}\n{RENDERER_VERSION}".encode()).hexdigest()[:32]
    path = cache_dir(handle) / f"ph-{digest}.jpg"
    if path.is_file():
        return path
    img = render_placeholder(reason, (w, h))
    try:
        write_jpeg(img, path)
    except OSError:
        if path.is_file():
            return path
        retry = cache_dir(handle) / f"ph-{digest}-{uuid4().hex}.jpg"
        write_jpeg(img, retry)
        return retry
    return path
