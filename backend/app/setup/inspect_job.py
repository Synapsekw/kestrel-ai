"""The `setup_inspect` job (spec 2026-09-30-project-setup §7, §10): sort dropped paths into buckets.

It runs on the library handle (index ruling S-R3: no project exists yet). Two bounded phases:

1. **walk**: list the dropped folders depth first in name order, never following a symbolic link
   or a junction, and stop at MAX_FILES files or MAX_FOLDERS folders (`truncated`). A file is a
   (path, size) pair; nothing is opened. Memory is at most MAX_FILES small entries.
2. **sort**: `classify` every listed file. Per folder at most HEADER_SAMPLE_PER_FOLDER JPEG headers
   are read; the other photos follow the DJI `_T`/`_V` file name, or the folder's sampled majority.

The result keeps at most MAX_SAMPLES names (and file paths) per bucket and MAX_NOT_RECOGNISED
not-recognised samples; counts and bytes are totals. A missing, vanished or unreadable path or
folder is a not-recognised row, never a failed job.
"""

from __future__ import annotations

import itertools
import os
import stat
import time
from collections.abc import Callable, Sequence
from dataclasses import dataclass, field
from pathlib import Path

from app.setup.schemas import InspectNotRecognised, InspectSkipped

MAX_FILES = 50_000
MAX_FOLDERS = 10_000
HEADER_SAMPLE_PER_FOLDER = 20
MAX_SAMPLES = 200
MAX_NOT_RECOGNISED = 50
#: Every ctx.progress call is a websocket event; a 50,000-file walk must not send 50,000 of them.
PROGRESS_INTERVAL_S = 0.2
WALK_SHARE = 0.3  # of the progress bar; the header reads take the rest

#: A USB stick's root carries these; they are never delivery data and are often unreadable.
SKIP_FOLDERS = frozenset({"$recycle.bin", "system volume information"})
LINK_TAGS = frozenset({stat.IO_REPARSE_TAG_SYMLINK, stat.IO_REPARSE_TAG_MOUNT_POINT})

NOT_FOUND = "not found"
NOT_ABSOLUTE = "not an absolute path"
FOLDER_UNREADABLE = "could not open this folder (disconnected, or no permission)"
FILE_UNREADABLE = "could not read this file (disconnected, or no permission)"
LINK_SKIPPED = "a linked folder (symbolic link or junction), not followed"

#: Seam: tests make a folder vanish mid-walk, or list a synthetic 50,001-file folder.
_scandir = os.scandir

Progress = Callable[..., None]


@dataclass(frozen=True)
class FileEntry:
    path: Path
    size: int


@dataclass
class Walked:
    folders: dict[Path, list[FileEntry]] = field(default_factory=dict)  # in walk order
    files: int = 0
    folders_listed: int = 0
    truncated: bool = False


class Skipped:
    """Not recognised: the total, and the first MAX_NOT_RECOGNISED (name, reason) samples."""

    def __init__(self) -> None:
        self.count = 0
        self.samples: list[InspectSkipped] = []

    def add(self, name: str, reason: str) -> None:
        self.count += 1
        if len(self.samples) < MAX_NOT_RECOGNISED:
            self.samples.append(InspectSkipped(name=name, reason=reason))

    def out(self) -> InspectNotRecognised:
        return InspectNotRecognised(count=self.count, samples=list(self.samples))


class ThrottledProgress:
    """Reports at most every PROGRESS_INTERVAL_S and never backwards; `force` always reports."""

    def __init__(self, report: Progress) -> None:
        self.report, self.value, self.last = report, 0.0, float("-inf")

    def __call__(self, fraction: float, message: str, *, force: bool = False) -> None:
        self.value = max(self.value, min(1.0, fraction))
        now = time.monotonic()
        if force or now - self.last >= PROGRESS_INTERVAL_S:
            self.last = now
            self.report(self.value, message)


def _identity(folder: Path):
    """What makes two paths the same folder: (device, file id), or the normalised path where the
    file system reports no file id (some network shares answer 0)."""
    try:
        st = os.stat(folder)
    except OSError:
        return None
    return (st.st_dev, st.st_ino) if st.st_ino else os.path.normcase(os.path.abspath(folder))


def _is_link(entry) -> bool:
    """A symbolic link, or a Windows junction / mount point (which `is_symlink` does not report)."""
    if entry.is_symlink():
        return True
    try:
        return getattr(entry.stat(follow_symlinks=False), "st_reparse_tag", 0) in LINK_TAGS
    except OSError:
        return False


def _take(out: Walked, path: Path, size: int, seen: set[str]) -> bool:
    """Record one file (once per normalised path); False once the cap is reached."""
    key = os.path.normcase(str(path))
    if key in seen:
        return True
    if out.files >= MAX_FILES:
        out.truncated = True
        return False
    seen.add(key)
    out.files += 1
    out.folders.setdefault(path.parent, []).append(FileEntry(path, size))
    return True


def _list(folder: Path, budget: int) -> tuple[list, bool]:
    """At most `budget` entries in name order, and whether the folder held more."""
    with _scandir(folder) as it:
        entries = list(itertools.islice(it, budget))
        more = next(it, None) is not None
    entries.sort(key=lambda e: e.name.casefold())
    return entries, more


def _walk_tree(
    root: Path, out: Walked, skipped: Skipped, seen_dirs: set, seen_files: set[str], check_cancelled, progress
) -> None:
    stack = [root]
    while stack and not out.truncated:
        folder = stack.pop()
        check_cancelled()
        ident = _identity(folder)
        if ident is not None:
            if ident in seen_dirs:
                continue
            seen_dirs.add(ident)
        if out.folders_listed >= MAX_FOLDERS:
            out.truncated = True
            return
        out.folders_listed += 1
        try:
            entries, more = _list(folder, MAX_FILES - out.files + MAX_FOLDERS + 1)
        except OSError:
            skipped.add(str(folder), FOLDER_UNREADABLE)
            continue
        subfolders: list[Path] = []
        for entry in entries:
            try:
                # `is_dir()` follows links on purpose: a symlink to a folder is not a dir without
                # following, and would otherwise vanish silently instead of being reported.
                if entry.is_dir():
                    if entry.name.casefold() in SKIP_FOLDERS:
                        continue
                    if _is_link(entry):
                        skipped.add(entry.name, LINK_SKIPPED)
                        continue
                    subfolders.append(Path(entry.path))
                elif entry.is_file():
                    if not _take(out, Path(entry.path), entry.stat().st_size, seen_files):
                        return
            except OSError:
                skipped.add(entry.name, FILE_UNREADABLE)
        if more:
            out.truncated = True
            return
        stack.extend(reversed(subfolders))
        progress(WALK_SHARE * min(1.0, out.files / MAX_FILES), f"Listing folders: {out.files:,} files")


def walk(
    paths: Sequence[str], skipped: Skipped, *, check_cancelled: Callable[[], None], progress: Progress
) -> Walked:
    """List `paths` (files or folders, in order) within the caps. Never raises for a path."""
    out = Walked()
    seen_dirs: set = set()
    seen_files: set[str] = set()
    for text in paths:
        if out.truncated:
            break
        path = Path(text)
        if not path.is_absolute():
            skipped.add(text, NOT_ABSOLUTE)
            continue
        try:
            if path.is_dir():
                _walk_tree(path, out, skipped, seen_dirs, seen_files, check_cancelled, progress)
            elif path.is_file():
                _take(out, path, path.stat().st_size, seen_files)
            else:
                skipped.add(text, NOT_FOUND)
        except OSError:
            skipped.add(text, FILE_UNREADABLE)
    return out
