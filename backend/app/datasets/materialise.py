"""YOLO label writing shared by the library export and the detection exports, and the sweep that
settles dataset folders a pre-foundation delete left half-moved (foundation F §6.1, §12.2).

Per-project datasets are read-only since the foundation: the library's `dataset` job
(`app.library.datasets.export`) writes exports now, and each project's materialised folders are
kept and registered as legacy datasets (`app.library.datasets.legacy`). `reconcile_tombstones`
still runs on project open, so a folder a crashed delete moved aside is put back.
"""

from __future__ import annotations

import logging
import os
import shutil
import threading
import uuid
from pathlib import Path

from sqlalchemy import select

from app.db.models import Dataset
from app.geometry import aabb_of
from app.projects.service import ProjectHandle

PROGRESS_EVERY = 50


def _quote(value: str) -> str:
    """Single-quoted YAML scalar: only `'` needs escaping, so Windows paths stay intact."""
    return "'" + str(value).replace("'", "''") + "'"


def data_yaml(root: Path, names: list[str]) -> str:
    lines = [f"path: {_quote(root)}", "train: images/train", "val: images/val", "names:"]
    lines += [f"  {i}: {_quote(name)}" for i, name in enumerate(names)]
    return "\n".join(lines) + "\n"


def materialised_name(path: str) -> str:
    """`images/<site>/<file>` -> `<site>__<file>`.

    A dataset folder is flat, but two sites may hold the same file name, so the site has to stay
    part of the name. Sites are slugified, so they never contain `__` and the mapping is injective.
    """
    parts = path.split("/")
    return "__".join(parts[1:]) if len(parts) > 2 and parts[0] == "images" else parts[-1]


def _place(src: Path, dest: Path) -> str:
    """Hard link when possible; report which of the two happened for the job log."""
    if dest.exists():
        # Names are unique per dataset and a failed job clears its folder, so this can only mean
        # two images mapped to one name: never silently drop one of them.
        raise FileExistsError(f"{dest} already exists; refusing to overwrite a materialised image")
    try:
        os.link(src, dest)
        return "linked"
    except OSError:
        shutil.copy2(src, dest)
        return "copied"


def detect_boxes(boxes: list[dict]) -> list[dict]:
    """Flatten each box to its axis-aligned envelope, which is what a 5-number label can say.

    A frozen row keeps the annotator's `angle` — it is the record of what was drawn, and wave 2
    materialises real oriented labels from it — but the wave 1 detect line has no field for it.
    The envelope is the honest projection: a loose label that still contains the object. Writing
    the *unrotated* x/y/w/h instead would write a rectangle that does not — a wrong label, not
    merely a loose one. `exports/yolo_out` makes the same call for the same reason, through here.
    """
    out = []
    for b in boxes:
        x, y, w, h = aabb_of(b["x"], b["y"], b["w"], b["h"], b.get("angle", 0.0))
        out.append({"class_id": b["class_id"], "x": x, "y": y, "w": w, "h": h})
    return out


def _label_text(boxes: list[dict], class_index: dict[str, int], width: int, height: int) -> str:
    """One `index cx cy w h` line per box, normalised and clipped to the frame.

    The clip is per *edge*, not per number (spec 3.3). A large envelope can reach past the image
    (`w·|cos| + h·|sin|` grows with rotation), and ultralytics' label verifier asserts every
    normalised value is <= 1: one value over calls the pair corrupt and discards the whole file,
    so a single box would silently delete every label for that image. Clipping the edges first and
    deriving the centre and the sides from them keeps the emitted box a sub-rectangle of the image;
    clipping the centre and the width independently would still leave an edge outside.
    """
    lines = []
    for b in boxes:
        index = class_index.get(b["class_id"])
        if index is None:  # the class was removed from the project after the freeze
            continue
        left, right = _clip01(b["x"] / width), _clip01((b["x"] + b["w"]) / width)
        top, bottom = _clip01(b["y"] / height), _clip01((b["y"] + b["h"]) / height)
        cx, cy = (left + right) / 2, (top + bottom) / 2
        lines.append(f"{index} {cx:.6f} {cy:.6f} {right - left:.6f} {bottom - top:.6f}")
    return "\n".join(lines) + ("\n" if lines else "")


def _clip01(value: float) -> float:
    return min(max(value, 0.0), 1.0)


log = logging.getLogger(__name__)

TOMBSTONE_PREFIX = ".deleting-"
# One tombstone sweep at a time per process: two sweeps must never settle the same tombstone.
_FOLDER_LOCK = threading.Lock()


def _own_folder(handle: ProjectHandle, relative_path: str) -> Path | None:
    """The folder a row names if it is a direct child of `<project>/datasets` spelled as the row
    spells it, else None. Both sides are resolved, so a project or datasets folder reached through a
    junction, a mapped drive or an 8.3 name is fine, while a link AT the dataset folder cannot pass:
    it would resolve to a different parent or a different name.
    """
    if not relative_path.strip():
        return None
    root = handle.folder / relative_path
    resolved = root.resolve()
    datasets_root = handle.datasets_dir.resolve()
    if resolved.parent != datasets_root or resolved.name.casefold() != Path(relative_path).name.casefold():
        return None
    if root.is_symlink() or resolved.name.startswith(TOMBSTONE_PREFIX):
        return None
    return resolved


def _remove_quietly(folder: Path) -> None:
    """Remove a committed tombstone outside the lock; a failure is left for the next sweep."""
    try:
        shutil.rmtree(folder)  # unlinks hard links and nested junctions; never follows them
    except FileNotFoundError:
        pass  # a concurrent sweep got there first
    except OSError as e:
        log.warning("could not remove %s yet: %s", folder, e)


def _leftovers(handle: ProjectHandle) -> list[Path]:
    """Folders named like a tombstone of a real delete: `.deleting-<uuid>`, and not a symlink."""
    if not handle.datasets_dir.is_dir():
        return []
    found = []
    root = handle.datasets_dir.resolve()
    for p in handle.datasets_dir.glob(f"{TOMBSTONE_PREFIX}*"):
        suffix = p.name[len(TOMBSTONE_PREFIX) :]
        try:
            # Only the exact form the pre-foundation delete and discard wrote (str(uuid4())); anything
            # else was made by someone else (a dataset from before the name rules, a person).
            if str(uuid.UUID(suffix)) != suffix:
                continue
            if p.is_dir() and not p.is_symlink() and p.resolve().parent == root:
                found.append(p)
        except (ValueError, OSError) as e:
            if not isinstance(e, ValueError):
                log.warning("could not look at %s: %s", p, e)
    return found


def reconcile_tombstones(handle: ProjectHandle) -> None:
    """Settle folders that deletions moved aside; never raises. Runs on project open.

    A tombstone whose dataset row still exists is the trace of a delete that never committed (the
    process was killed, the commit failed): the folder goes back to its dataset. Only a tombstone
    without a row is removed, and that happens outside the lock.
    """
    try:
        with _FOLDER_LOCK:
            garbage = _restore_tombstones(handle)
        for leftover in garbage:
            _remove_quietly(leftover)
    except Exception as e:  # a leftover must never break a delete or the opening of a project
        log.warning("could not settle the tombstones of %s: %s", handle.folder, e)


def _restore_tombstones(handle: ProjectHandle) -> list[Path]:
    """Give folders back to rows that still exist; return the tombstones that have no row."""
    garbage = []
    with handle.session() as s:
        owned = {(handle.folder / (p or "")).resolve() for p in s.execute(select(Dataset.path)).scalars()}
    for leftover in _leftovers(handle):
        if leftover.resolve() in owned:
            continue  # a dataset really lives there
        dataset_id = leftover.name[len(TOMBSTONE_PREFIX) :]
        try:
            with handle.session() as s:
                row = s.get(Dataset, dataset_id)
                path = row.path if row is not None else None
            if row is None:
                garbage.append(leftover)
                continue
            target = _own_folder(handle, path or "")
            if target is not None and not target.exists():
                os.replace(leftover, target)
                log.warning("restored the folder of dataset %s from %s", dataset_id, leftover)
            else:
                log.warning("dataset %s still exists; %s is left for a person", dataset_id, leftover)
        except Exception as e:
            log.warning("could not settle %s yet: %s", leftover, e)
    return garbage
