"""YOLO label writers: one `.txt` per image plus `classes.txt` in `labels_yolo/` (boxes) or
`labels_yolo_seg/` (polygons) (spec G2; image spec §11.1).

The label tree mirrors the image tree under `images/`, so two sites that both happen to import a
file called `DJI_0001.jpg` still get two label files rather than one silently overwriting the
other: `images/<site>/<stem>.jpg` -> `labels_yolo/<site>/<stem>.txt`.
"""

from __future__ import annotations

from pathlib import Path
from typing import Literal

from app.exports.rows import ExportImage
from app.imagery.labels import write_labels
from app.jobs.cancellation import JobFailure

FOLDER = "labels_yolo"
SEG_FOLDER = "labels_yolo_seg"


def _label_path(image_path: str) -> Path:
    """`images/<site>/<file>.jpg` -> `<site>/<file>.txt`; a path with no `images/` prefix is kept as-is."""
    parts = Path(image_path).parts
    rel = Path(*parts[1:]) if parts and parts[0] == "images" else Path(*parts)
    return rel.with_suffix(".txt")


def _as_labels(image: ExportImage) -> list[dict]:
    """The image's boxes as label dicts for `imagery.labels.write_labels` (one decision, made once
    for datasets and exports: a rotated box is its envelope in detect, its outline in segment)."""
    return [
        {
            "type_id": b.class_id,
            "shape": b.shape,
            "x": b.x,
            "y": b.y,
            "w": b.w,
            "h": b.h,
            "angle": b.angle,
            "points": b.points,
        }
        for b in image.boxes
    ]


def check_no_stem_collisions(images: list[ExportImage]) -> None:
    """YOLO tools pair an image and its label by file stem alone, so two images that map to the
    same label path (e.g. one site's `x.jpg` and `x.jpeg`) cannot both be exported: one would
    silently overwrite the other's label file. Caught here, before anything is written, with a
    plain message naming both images and offering the two ways out; the caller (job.py) runs this
    before reserving an export folder at all when "yolo" is requested, so a doomed export never
    touches the filesystem (m4). A `ValueError` is a job's own way of raising a message meant to be
    read as-is (see `app.jobs.runner`), so it carries no other prefix.
    """
    seen: dict[Path, str] = {}
    for image in images:
        label_path = _label_path(image.path)
        earlier = seen.get(label_path)
        if earlier is not None:
            site = label_path.parent.as_posix()
            where = f"in {site}" if site != "." else "in the project"
            raise JobFailure(
                f"{Path(earlier).name} and {Path(image.path).name} {where} would get the same "
                "YOLO label file. Export without YOLO labels, or delete one of the two images "
                "from the project."
            )
        seen[label_path] = image.path


def write(
    images: list[ExportImage],
    classes: list[dict],
    folder: Path,
    task: Literal["detect", "segment"] = "detect",
) -> list[str]:
    """Writes the mirrored label tree and `classes.txt` into `labels_yolo/` (detect) or
    `labels_yolo_seg/` (segment); returns the folder and `classes.txt`, not one entry per image.

    A results export hands the annotations over rather than training on them, so `yolo_seg` writes
    boxes as their 4-point outline instead of skipping them (R-BT8); points are left out (R-BT9).
    """
    check_no_stem_collisions(images)
    name = SEG_FOLDER if task == "segment" else FOLDER
    out = folder / name
    out.mkdir(parents=True, exist_ok=True)
    class_index = {c["id"]: i for i, c in enumerate(classes)}
    for image in images:
        label_path = out / _label_path(image.path)
        label_path.parent.mkdir(parents=True, exist_ok=True)
        text = write_labels(
            task, _as_labels(image), class_index, image.width, image.height, boxes_as_polygons=True
        )
        label_path.write_text(text, "utf-8")
    (out / "classes.txt").write_text("".join(f"{c['name']}\n" for c in classes), "utf-8")
    return [name, f"{name}/classes.txt"]
