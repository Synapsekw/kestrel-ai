"""YOLO label writer: one `.txt` per image plus `classes.txt` (spec G2)."""

from __future__ import annotations

from pathlib import Path

from app.exports.rows import ExportImage

FOLDER = "labels_yolo"


def _label_text(image: ExportImage, class_index: dict[str, int]) -> str:
    lines = []
    for box in image.boxes:
        index = class_index.get(box.class_id)
        if index is None:
            continue
        cx = (box.x + box.w / 2) / image.width
        cy = (box.y + box.h / 2) / image.height
        w = box.w / image.width
        h = box.h / image.height
        lines.append(f"{index} {cx:.6f} {cy:.6f} {w:.6f} {h:.6f}")
    return "\n".join(lines) + ("\n" if lines else "")


def write(images: list[ExportImage], classes: list[dict], folder: Path) -> list[str]:
    """Writes `labels_yolo/<stem>.txt` for every image (empty when it has no boxes) and `classes.txt`."""
    out = folder / FOLDER
    out.mkdir(parents=True, exist_ok=True)
    class_index = {c["id"]: i for i, c in enumerate(classes)}
    files = []
    for image in images:
        stem = Path(image.path).stem
        (out / f"{stem}.txt").write_text(_label_text(image, class_index), "utf-8")
        files.append(f"{FOLDER}/{stem}.txt")
    (out / "classes.txt").write_text("".join(f"{c['name']}\n" for c in classes), "utf-8")
    files.append(f"{FOLDER}/classes.txt")
    return files
