"""CSV tables of a results export: detections and two count tables (spec G2).

Excel-friendly: UTF-8 with a BOM, comma-separated, `\\r\\n` line endings (the `excel` dialect
gives us both), a header row, ISO timestamps, `.` as the decimal separator. Every text value (never
a number) is guarded against formula injection: a value that would otherwise open as a formula is
prefixed with `'`. A CSV has no cell formatting of its own, so opening one in Excel shows that `'`
literally, right there in the cell (it is not a hidden "treat as text" marker the way it is when
typed directly into the grid) — a visible cost, but the value can never be evaluated as a formula.
"""

from __future__ import annotations

import csv
from pathlib import Path

from app.exports.rows import ExportImage, class_counts

DETECTIONS_COLUMNS = [
    "image",
    "source",
    "group",
    "capture_time",
    "image_lat",
    "image_lon",
    "class",
    "x",
    "y",
    "w",
    "h",
    "confidence",
    "origin",
    "origin_name",
    "review_state",
    "box_id",
]

_FORMULA_PREFIXES = ("=", "+", "@", "\t", "\r")


def _text(v: str) -> str:
    """A text-column value, guarded against formula injection (never applied to a number).

    A leading `=`, `+`, `@`, tab or carriage return always risks a formula. A leading `-` only
    does when it is not simply a negative number or a plain word that happens to start with a
    dash — `-flight` and `-0031` (site names, group keys) must round-trip unescaped, so the guard
    fires for `-` only when the character after it is neither a letter nor a digit (`-=x`, `-@x`, a
    bare `-`).
    """
    if not v:
        return v
    if v[0] in _FORMULA_PREFIXES:
        return f"'{v}"
    if v[0] == "-" and not (len(v) > 1 and v[1].isalnum()):
        return f"'{v}"
    return v


def _num(v: float | int | None) -> str:
    return "" if v is None else str(v)


def _iso(dt) -> str:
    if dt is None:
        return ""
    return dt.isoformat().replace("+00:00", "Z")


def _open(path: Path):
    return open(path, "w", newline="", encoding="utf-8-sig")


def _write_detections(images: list[ExportImage], folder: Path) -> str:
    name = "detections.csv"
    with _open(folder / name) as f:
        w = csv.writer(f)
        w.writerow(DETECTIONS_COLUMNS)
        for image in images:
            for box in image.boxes:
                w.writerow(
                    [
                        _text(image.path),
                        _text(image.source_site),
                        _text(image.group),
                        _iso(image.capture_time),
                        _num(image.lat),
                        _num(image.lon),
                        _text(box.class_name),
                        _num(box.x),
                        _num(box.y),
                        _num(box.w),
                        _num(box.h),
                        _num(box.confidence),
                        box.origin,
                        _text(box.origin_name),
                        box.review_state,
                        box.id,
                    ]
                )
    return name


def _unreviewed_count(boxes) -> int:
    return sum(1 for b in boxes if b.review_state == "unreviewed")


def _write_counts_by_group(images: list[ExportImage], class_names: list[str], folder: Path) -> str:
    name = "counts_by_group.csv"
    per_group: dict[str, dict[str, int]] = {}
    images_per_group: dict[str, int] = {}
    unreviewed_per_group: dict[str, int] = {}
    for image in images:
        images_per_group[image.group] = images_per_group.get(image.group, 0) + 1
        counts = per_group.setdefault(image.group, dict.fromkeys(class_names, 0))
        for cls, n in class_counts(image.boxes, class_names).items():
            counts[cls] += n
        unreviewed_per_group[image.group] = unreviewed_per_group.get(image.group, 0) + _unreviewed_count(
            image.boxes
        )
    with _open(folder / name) as f:
        w = csv.writer(f)
        w.writerow(["group", "images", *(_text(c) for c in class_names), "unreviewed", "total"])
        for group in sorted(per_group):
            counts = per_group[group]
            total = sum(counts.values())
            w.writerow(
                [
                    _text(group),
                    images_per_group[group],
                    *(counts[c] for c in class_names),
                    unreviewed_per_group[group],
                    total,
                ]
            )
    return name


def _write_counts_by_image(images: list[ExportImage], class_names: list[str], folder: Path) -> str:
    name = "counts_by_image.csv"
    with _open(folder / name) as f:
        w = csv.writer(f)
        header = ["image", "group", "capture_time", "image_lat", "image_lon", "marked_empty"]
        w.writerow([*header, *(_text(c) for c in class_names), "unreviewed", "total"])
        for image in images:
            counts = class_counts(image.boxes, class_names)
            total = sum(counts.values())
            w.writerow(
                [
                    _text(image.path),
                    _text(image.group),
                    _iso(image.capture_time),
                    _num(image.lat),
                    _num(image.lon),
                    "true" if image.marked_empty else "false",
                    *(counts[c] for c in class_names),
                    _unreviewed_count(image.boxes),
                    total,
                ]
            )
    return name


def write(images: list[ExportImage], classes: list[dict], folder: Path) -> list[str]:
    """Writes `detections.csv`, `counts_by_group.csv` and `counts_by_image.csv`; returns their names."""
    folder.mkdir(parents=True, exist_ok=True)
    class_names = [c["name"] for c in classes]
    return [
        _write_detections(images, folder),
        _write_counts_by_group(images, class_names, folder),
        _write_counts_by_image(images, class_names, folder),
    ]
