"""Project-folder drawings that were never imported (plant-model spec §8.1; plan
2026-10-03-plant-model-i1 Rulings 6 to 10).

GET /drawings/unimported walks the project folder to depth 3 for drawing files, skipping the folders
Kestrel writes, and leaves out every file whose bytes match an imported drawing. Bounded: at most
MAX_ENTRIES directory entries are read and MAX_FILES files answered; a file is hashed only when its
size equals an imported drawing's size. Hashes, LandXML sniffs and PDF page counts are cached in
<project>/cache/unimported.json, keyed by path and checked against (size, mtime_ns).
"""

from __future__ import annotations

import logging
import os
from pathlib import Path

from sqlalchemy import select

from app.db.models import Drawing
from app.drawings import store
from app.drawings.detect import FORMATS
from app.surfaces.design.store import ID_RE

EXTS = frozenset({".pdf", ".dxf", ".tif", ".tiff", ".png", ".jpg", ".jpeg", ".landxml", ".xml"})
IMAGE_EXTS = frozenset({".png", ".jpg", ".jpeg"})
MANAGED = frozenset(
    {
        "asset_models",
        "backups",
        "cache",
        "datasets",
        "exports",
        "findings",
        "images",
        "labels",
        "maps",
        "models",
        "pointclouds",
        "reports",
        "runs",
        "surfaces",
        "volumes",
    }
)
MAX_DEPTH = 3
MAX_FILES = 500
MAX_ENTRIES = 20_000
PHOTO_FOLDER = 20
SNIFF_BYTES = 4096
CACHE_VERSION = 1
log = logging.getLogger(__name__)


def cache_path(handle) -> Path:
    return Path(handle.folder) / "cache" / "unimported.json"


def _sha256(path: Path) -> str | None:
    try:
        return store.sha256_file(path, progress=lambda _f: None, check_cancelled=lambda: None)
    except OSError:
        return None


def _pdf_pages(path: Path) -> int | None:
    from app.drawings import pdf

    if pdf.unavailable_reason() is not None:
        return None
    try:
        with pdf.open_pdf(path) as doc:
            return len(doc)
    except Exception:  # an unreadable or locked PDF is still listed, without a page count
        return None


def _is_landxml(path: Path) -> bool:
    try:
        with path.open("rb") as f:
            return b"landxml" in f.read(SNIFF_BYTES).lower()
    except OSError:
        return False


def _imported(handle) -> tuple[set[str], set[int], set[tuple[str, int]]]:
    with handle.session() as s:
        rows = s.execute(
            select(Drawing.source_sha256, Drawing.source_size, Drawing.source_path).where(
                Drawing.status.in_(("ready", "importing"))
            )
        ).all()
    shas = {sha for sha, _, _ in rows if sha}
    sizes = {size for _, size, _ in rows}
    paths = {(os.path.normcase(path), size) for _, size, path in rows}
    return shas, sizes, paths


def _scannable(name: str, depth: int) -> bool:
    if name.startswith(".") or ID_RE.fullmatch(name):
        return False
    return not (depth == 0 and name.casefold() in MANAGED)


def _candidates(root: Path) -> list[Path]:
    """Drawing-like files, depth-first, at most MAX_ENTRIES directory entries read."""
    out: list[Path] = []
    stack: list[tuple[Path, int]] = [(root, 0)]
    read = 0
    while stack and read < MAX_ENTRIES:
        folder, depth = stack.pop()
        try:
            with os.scandir(folder) as it:
                entries = sorted(it, key=lambda e: e.name.casefold())
        except OSError:
            continue
        read += len(entries)
        files, dirs = [], []
        for e in entries:
            try:
                if e.is_file() and Path(e.name).suffix.lower() in EXTS:
                    files.append(e)
                elif depth < MAX_DEPTH and e.is_dir() and _scannable(e.name, depth):
                    dirs.append(e)
            except OSError:
                continue
        photos = sum(1 for e in files if Path(e.name).suffix.lower() in IMAGE_EXTS) > PHOTO_FOLDER
        out.extend(Path(e.path) for e in files if not (photos and Path(e.name).suffix.lower() in IMAGE_EXTS))
        stack.extend((Path(e.path), depth + 1) for e in reversed(dirs))
    return sorted(out, key=lambda p: str(p).casefold())


def _read_cache(handle) -> dict:
    try:
        data = store.read_json(cache_path(handle))
    except (OSError, ValueError):
        return {}
    if not isinstance(data, dict) or data.get("version") != CACHE_VERSION:
        return {}
    entries = data.get("entries")
    return entries if isinstance(entries, dict) else {}


def _write_cache(handle, entries: dict) -> None:
    path = cache_path(handle)
    try:
        path.parent.mkdir(parents=True, exist_ok=True)
        store.write_json(path, {"version": CACHE_VERSION, "entries": entries})
    except OSError:
        log.warning("could not write the unimported-drawings cache in project %s", handle.id)


def scan_unimported(handle) -> list[dict]:
    shas, sizes, paths = _imported(handle)
    old = _read_cache(handle)
    new: dict[str, dict] = {}
    out: list[dict] = []
    for path in _candidates(Path(handle.folder)):
        if len(out) >= MAX_FILES:
            break
        try:
            st = path.stat()
        except OSError:
            continue
        key, ext = str(path), path.suffix.lower()
        if (os.path.normcase(key), st.st_size) in paths:
            continue
        entry = old.get(key)
        if not isinstance(entry, dict) or (entry.get("size"), entry.get("mtime_ns")) != (
            st.st_size,
            st.st_mtime_ns,
        ):
            entry = {"size": st.st_size, "mtime_ns": st.st_mtime_ns}
        new[key] = entry
        if ext == ".xml":
            if "landxml" not in entry:
                entry["landxml"] = _is_landxml(path)
            if not entry["landxml"]:
                continue
        if st.st_size in sizes:
            if entry.get("sha256") is None:
                entry["sha256"] = _sha256(path)
            if entry["sha256"] in shas:
                continue
        if ext == ".pdf" and "pages" not in entry:
            entry["pages"] = _pdf_pages(path)
        out.append(
            {
                "path": key,
                "name": path.name,
                "format": FORMATS[ext],
                "size": st.st_size,
                "pages": entry.get("pages") if ext == ".pdf" else None,
            }
        )
    _write_cache(handle, new)
    return out
