"""YOLO label writer: one `.txt` per image plus `classes.txt` (spec G2).

The label tree mirrors the image tree under `images/`, so two sites that both happen to import a
file called `DJI_0001.jpg` still get two label files rather than one silently overwriting the
other: `images/<site>/<stem>.jpg` -> `labels_yolo/<site>/<stem>.txt`.
"""

from __future__ import annotations

from pathlib import Path

from app.datasets.materialise import _label_text
from app.exports.rows import ExportImage

FOLDER = "labels_yolo"


def _label_path(image_path: str) -> Path:
    """`images/<site>/<file>.jpg` -> `<site>/<file>.txt`; a path with no `images/` prefix is kept as-is."""
    parts = Path(image_path).parts
    rel = Path(*parts[1:]) if parts and parts[0] == "images" else Path(*parts)
    return rel.with_suffix(".txt")


def _as_box_dicts(image: ExportImage) -> list[dict]:
    return [{"class_id": b.class_id, "x": b.x, "y": b.y, "w": b.w, "h": b.h} for b in image.boxes]


def write(images: list[ExportImage], classes: list[dict], folder: Path) -> list[str]:
    """Writes the mirrored label tree and `classes.txt`; returns [`labels_yolo`, `labels_yolo/classes.txt`]
    (not one entry per image: the job result should name the folder, not enumerate every file in it).
    """
    out = folder / FOLDER
    out.mkdir(parents=True, exist_ok=True)
    class_index = {c["id"]: i for i, c in enumerate(classes)}
    for image in images:
        label_path = out / _label_path(image.path)
        label_path.parent.mkdir(parents=True, exist_ok=True)
        text = _label_text(_as_box_dicts(image), class_index, image.width, image.height)
        label_path.write_text(text, "utf-8")
    (out / "classes.txt").write_text("".join(f"{c['name']}\n" for c in classes), "utf-8")
    return [FOLDER, f"{FOLDER}/classes.txt"]
