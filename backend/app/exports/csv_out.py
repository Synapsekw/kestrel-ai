"""CSV tables of a results export: detections and two count tables (spec G2).

Excel-friendly: UTF-8 with a BOM, comma-separated, `\\r\\n` line endings (the `excel` dialect
gives us both), a header row, ISO timestamps, `.` as the decimal separator.
"""

from __future__ import annotations

import csv
from pathlib import Path

from app.exports.rows import ExportImage

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
                        image.path,
                        image.source_site,
                        image.group,
                        _iso(image.capture_time),
                        _num(image.lat),
                        _num(image.lon),
                        box.class_name,
                        _num(box.x),
                        _num(box.y),
                        _num(box.w),
                        _num(box.h),
                        _num(box.confidence),
                        box.origin,
                        box.origin_name,
                        box.review_state,
                        box.id,
                    ]
                )
    return name


def _class_counts(boxes, class_names: list[str]) -> dict[str, int]:
    counts = dict.fromkeys(class_names, 0)
    for b in boxes:
        if b.class_name in counts:
            counts[b.class_name] += 1
    return counts


def _write_counts_by_group(images: list[ExportImage], class_names: list[str], folder: Path) -> str:
    name = "counts_by_group.csv"
    per_group: dict[str, dict[str, int]] = {}
    images_per_group: dict[str, int] = {}
    for image in images:
        images_per_group[image.group] = images_per_group.get(image.group, 0) + 1
        counts = per_group.setdefault(image.group, dict.fromkeys(class_names, 0))
        for cls, n in _class_counts(image.boxes, class_names).items():
            counts[cls] += n
    with _open(folder / name) as f:
        w = csv.writer(f)
        w.writerow(["group", "images", *class_names, "total"])
        for group in sorted(per_group):
            counts = per_group[group]
            total = sum(counts.values())
            w.writerow([group, images_per_group[group], *(counts[c] for c in class_names), total])
    return name


def _write_counts_by_image(images: list[ExportImage], class_names: list[str], folder: Path) -> str:
    name = "counts_by_image.csv"
    with _open(folder / name) as f:
        w = csv.writer(f)
        header = ["image", "group", "capture_time", "image_lat", "image_lon", "marked_empty"]
        w.writerow([*header, *class_names, "total"])
        for image in images:
            counts = _class_counts(image.boxes, class_names)
            total = sum(counts.values())
            w.writerow(
                [
                    image.path,
                    image.group,
                    _iso(image.capture_time),
                    _num(image.lat),
                    _num(image.lon),
                    "true" if image.marked_empty else "false",
                    *(counts[c] for c in class_names),
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
