"""Audited detection starter catalogue, listed without importing the model engine."""

import logging
import sys
from dataclasses import dataclass
from pathlib import Path

from app.config import Settings
from app.errors import AppError
from app.jobs.cancellation import JobFailure
from app.library import service as library
from app.library.db import LibraryModel
from app.library.handle import LibraryHandle

log = logging.getLogger(__name__)


@dataclass(frozen=True)
class StarterSpec:
    key: str
    name: str
    description: str
    family: str


# Fixed, audited COCO detection checkpoints supported by Ultralytics 8.4.154.
# Older v3/v5 checkpoints must use the compatible anchor-free "u" variants.
SCALES = {
    "n": "nano",
    "s": "small",
    "m": "medium",
    "l": "large",
    "x": "extra large",
    "t": "tiny",
    "c": "compact",
    "e": "extended",
    "b": "balanced",
}
CATALOGUE = [
    StarterSpec(
        f"{prefix}{scale}{suffix}",
        f"{family} {SCALES[scale]}{extra}",
        "COCO object detection weights. Larger sizes need more memory and take longer."
        + (
            " YOLO12 attention models can be slower on CPU and less stable during training."
            if prefix == "yolo12"
            else ""
        ),
        family,
    )
    for prefix, family, scales, suffix, extra in (
        ("yolo11", "YOLO11", "nsmlx", "", ""),
        ("yolo26", "YOLO26", "nsmlx", "", ""),
        ("yolo12", "YOLO12", "nsmlx", "", ""),
        ("yolov10", "YOLOv10", "nsmblx", "", ""),
        ("yolov9", "YOLOv9", "tsmce", "", ""),
        ("yolov8", "YOLOv8", "nsmlx", "", ""),
        ("yolov5", "YOLOv5u", "nsmlx", "u", ""),
        ("yolov5", "YOLOv5u", "nsmlx", "6u", " P6"),
    )
    for scale in scales
] + [
    StarterSpec(key, name, "COCO object detection with the Ultralytics anchor-free head.", "YOLOv3u")
    for key, name in (
        ("yolov3-tinyu", "YOLOv3u tiny"),
        ("yolov3u", "YOLOv3u standard"),
        ("yolov3-sppu", "YOLOv3u SPP"),
    )
]
STARTER_KEYS = {spec.key for spec in CATALOGUE}

# COCO has no construction classes; its `truck` is the closest to a dump truck.
DEFAULT_ALIASES = {"truck": "dump_truck"}


def weights_dir(settings: Settings) -> Path:
    if settings.starter_weights_dir is not None:
        return settings.starter_weights_dir
    checkout = Path(__file__).resolve().parents[2] / "starter_weights"
    if getattr(sys, "frozen", False):
        # PyInstaller always sets _MEIPASS on a real frozen run; the getattr only guards against
        # a process that reports itself frozen without one, which falls back to the checkout path
        # rather than a meaningless sys.executable-relative guess.
        meipass = getattr(sys, "_MEIPASS", None)
        return Path(meipass) / "starter_weights" if meipass else checkout
    return checkout


def list_starters(folder: Path, cache: Path | None = None) -> list[dict]:
    items = []
    for spec in CATALOGUE:
        f = folder / f"{spec.key}.pt"
        if not f.is_file() and cache is not None:
            f = cache / f"{spec.key}.pt"
        ok = f.is_file()
        items.append(
            {
                "key": spec.key,
                "name": spec.name,
                "description": spec.description,
                "family": spec.family,
                "task": "detect",
                "size_mb": round(f.stat().st_size / 1_048_576, 1) if ok else 0,
                "available": ok,
            }
        )
    return items


def import_starter(lib: LibraryHandle, folder: Path, key: str, name: str | None) -> LibraryModel:
    """Add a starter's weights to the library (`origin: starter`); the bundled file stays.

    The same weights are one library model: acquiring a starter that is already in the library
    returns that model instead of a second copy. Library models are standalone, so the COCO aliases
    are not filtered by any project's classes; the project mapping happens when a run starts.
    """
    f = folder / f"{key}.pt"
    if key not in STARTER_KEYS or not f.is_file():
        # The operator reads the message; the fix is a developer's (scripts/fetch_starter_weights.ps1).
        log.warning("starter weights %s missing under %s; run scripts/fetch_starter_weights.ps1", key, folder)
        raise AppError("not_found", f"The starter model {key} is not included in this copy of the app.", 404)
    digest = library.sha256_file(f)
    existing = library.find_by_sha(lib, digest)
    if existing is not None:
        return existing
    try:
        task, class_names = library.read_checkpoint(f)
    except Exception as e:
        raise JobFailure(f"{f.name} is not a loadable YOLO checkpoint: {e}") from e
    if task != "detect":
        raise JobFailure(f"This starter requires a detect checkpoint; found {task!r}.")
    aliases = {src: dst for src, dst in DEFAULT_ALIASES.items() if src in class_names}
    return library.add_model(
        lib,
        source_weights=f.resolve(),
        name=name or f"{key}-coco",
        origin="starter",
        task=task,
        class_names=class_names,
        class_aliases=aliases,
        sha256=digest,
    )
