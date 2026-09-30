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
from collections.abc import Callable, Mapping, Sequence
from dataclasses import dataclass, field
from pathlib import Path

from pydantic import ValidationError

from app.setup.builtins import BUILTIN_TEMPLATES
from app.setup.classify import HEADER_IMAGE_EXTS, UNKNOWN, Classified, HeaderReader, classify, lens_of
from app.setup.schemas import (
    InspectBucket,
    InspectNotRecognised,
    InspectResult,
    InspectSkipped,
    SlotMatch,
    TemplateConfig,
)

MAX_FILES = 50_000
MAX_FOLDERS = 10_000
HEADER_SAMPLE_PER_FOLDER = 20
MAX_SAMPLES = 200
MAX_NOT_RECOGNISED = 50
MAX_BUCKETS = 500  # U1 InspectResult.buckets max_length; more would fail validation
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


# ------------------------------------------------------------------------------------------ sort


@dataclass
class _Bucket:
    route: str
    match: dict
    folder: str
    count: int = 0
    bytes: int = 0
    samples: list[str] = field(default_factory=list)
    files: list[str] = field(default_factory=list)
    crs: str | None = None

    def add(self, entry: FileEntry, crs: str | None) -> None:
        self.count += 1
        self.bytes += entry.size
        if len(self.samples) < MAX_SAMPLES:
            self.samples.append(entry.path.name)
        if self.route != "images" and len(self.files) < MAX_SAMPLES:  # images import by folder
            self.files.append(str(entry.path))
        if self.crs is None:
            self.crs = crs

    def out(self) -> InspectBucket:
        return InspectBucket(
            route=self.route,
            match=SlotMatch(**self.match),
            slot_key=None,
            folder=self.folder,
            files=list(self.files),
            count=self.count,
            bytes=self.bytes,
            samples=list(self.samples),
            crs=self.crs,
        )


def _record(buckets: dict[tuple, _Bucket], skipped: Skipped, entry: FileEntry, c: Classified) -> None:
    if c.route is None:
        skipped.add(entry.path.name, c.reason or UNKNOWN)
        return
    folder = str(entry.path.parent)
    key = (c.route, tuple(sorted(c.match.items())), folder)
    bucket = buckets.get(key)
    if bucket is None:
        bucket = buckets[key] = _Bucket(c.route, dict(c.match), folder)
    bucket.add(entry, c.crs)


def sort_walked(
    walked: Walked,
    reader: HeaderReader,
    skipped: Skipped,
    *,
    check_cancelled: Callable[[], None],
    progress: Progress,
) -> list[InspectBucket]:
    """Classify every listed file into buckets keyed by (route, match, folder), in walk order.

    Per folder the first HEADER_SAMPLE_PER_FOLDER JPEGs (name order) have their header read; the
    rest are classified afterwards by name, with the thermal majority of the sampled photos that
    carry no DJI lens suffix as the default for renamed files."""
    buckets: dict[tuple, _Bucket] = {}
    total, done = max(walked.files, 1), 0

    def step(entry: FileEntry, c: Classified) -> None:
        nonlocal done
        _record(buckets, skipped, entry, c)
        done += 1
        progress(
            WALK_SHARE + (1 - WALK_SHARE) * done / total,
            f"Reading headers: {done:,} of {walked.files:,} files",
        )

    for entries in walked.folders.values():
        sampled, deferred = 0, []
        votes = [0, 0]  # sampled photos without a DJI lens suffix: [visual, thermal]
        for entry in entries:
            check_cancelled()
            if entry.path.suffix.lower() in HEADER_IMAGE_EXTS:
                if sampled >= HEADER_SAMPLE_PER_FOLDER:
                    deferred.append(entry)
                    continue
                sampled += 1
                c = classify(entry.path, reader)
                if c.route == "images" and lens_of(entry.path) is None:
                    votes[int(bool(c.match.get("thermal")))] += 1
            else:
                c = classify(entry.path, reader)
            step(entry, c)
        thermal_default = votes[1] > votes[0]
        for entry in deferred:
            check_cancelled()
            step(entry, classify(entry.path, reader, read_header=False, thermal_default=thermal_default))
    return [b.out() for b in buckets.values()]


# ------------------------------------------------------------------ slots and the suggestion (pure)


def _config(config) -> TemplateConfig | None:
    if isinstance(config, TemplateConfig):
        return config
    try:
        return TemplateConfig.model_validate(config)
    except ValidationError:
        return None


def _fit(slot, have: dict) -> int | None:
    """How specifically `slot` takes a bucket whose match is `have`: the number of match keys the
    slot names, or None when it does not take it. An absent bucket `thermal` is false; a key the
    slot does not name is a wildcard. U5's `remap.ts` implements the same rule."""
    want = slot.match.model_dump(exclude_none=True) if slot.match is not None else {}
    for key, value in want.items():
        if have.get(key, False if key == "thermal" else None) != value:
            return None
    return len(want)


def assign_slots(buckets: Sequence[InspectBucket], config) -> list[InspectBucket]:
    """Each bucket's `slot_key` in `config` (a TemplateConfig or its dict): same route, the most
    specific fitting slot, the earlier slot on a tie; None when no slot fits or the config is
    invalid. One slot may take several buckets."""
    cfg = _config(config)
    slots = cfg.slots if cfg is not None else []
    placed = []
    for bucket in buckets:
        have = bucket.match.model_dump(exclude_none=True)
        best, best_score = None, -1
        for slot in slots:
            if slot.route != bucket.route:
                continue
            score = _fit(slot, have)
            if score is not None and score > best_score:
                best, best_score = slot.key, score
        placed.append(bucket.model_copy(update={"slot_key": best}))
    return placed


def suggest_template(buckets: Sequence[InspectBucket], templates: Sequence[Mapping]) -> str | None:
    """The template (`{"id", "config"}`) whose required slots the buckets fill most, then whose
    slots they fill most; the earlier one on a tie; None when none has a required slot filled."""
    best, best_score = None, (0, 0)
    for template in templates:
        cfg = _config(template["config"])
        if cfg is None:
            continue
        filled = {b.slot_key for b in assign_slots(buckets, cfg) if b.slot_key}
        required = sum(1 for s in cfg.slots if s.required and s.key in filled)
        score = (required, len(filled))
        if required > 0 and score > best_score:
            best, best_score = template["id"], score
    return best


# ----------------------------------------------------------------------------------- whole run


def _summary(files: int, groups: int, walk_truncated: bool, capped: bool) -> str:
    text = f"Sorted {files:,} files into {groups} group(s)"
    if walk_truncated:
        text += f"; stopped at {MAX_FILES:,} files"
    if capped:
        text += f"; kept the first {MAX_BUCKETS} groups"
    return text


def inspect_paths(
    paths: Sequence[str],
    reader: HeaderReader,
    *,
    check_cancelled: Callable[[], None],
    progress: Progress,
    template_config=None,
) -> InspectResult:
    """Walk, sort, assign slots (when a template config is given) and suggest a built-in."""
    report = ThrottledProgress(progress)
    skipped = Skipped()
    walked = walk(paths, skipped, check_cancelled=check_cancelled, progress=report)
    buckets = sort_walked(walked, reader, skipped, check_cancelled=check_cancelled, progress=report)
    capped = len(buckets) > MAX_BUCKETS
    buckets = buckets[:MAX_BUCKETS]
    if template_config is not None:
        buckets = assign_slots(buckets, template_config)
    result = InspectResult(
        buckets=buckets,
        not_recognised=skipped.out(),
        suggested_template_id=suggest_template(buckets, BUILTIN_TEMPLATES),
        truncated=walked.truncated or capped,
    )
    report(1.0, _summary(walked.files, len(buckets), walked.truncated, capped), force=True)
    return result


def dump_result(result: InspectResult) -> dict:
    """`Job.result`: JSON-safe, and a bucket's `match` names only the keys it sets (SlotMatch has
    no nullable property, so `{"raster": null}` would contradict the generated client's types)."""
    data = result.model_dump(mode="json")
    for bucket in data["buckets"]:
        bucket["match"] = {k: v for k, v in bucket["match"].items() if v is not None}
    return data
