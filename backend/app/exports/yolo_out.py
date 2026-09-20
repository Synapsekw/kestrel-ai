"""YOLO label writer: one `.txt` per image plus `classes.txt` (spec G2).

The label tree mirrors the image tree under `images/`, so two sites that both happen to import a
file called `DJI_0001.jpg` still get two label files rather than one silently overwriting the
other: `images/<site>/<stem>.jpg` -> `labels_yolo/<site>/<stem>.txt`.
"""

from __future__ import annotations

from pathlib import Path

from app.datasets.materialise import _label_text, detect_boxes
from app.exports.rows import ExportImage
from app.jobs.cancellation import JobFailure

FOLDER = "labels_yolo"


def _label_path(image_path: str) -> Path:
    """`images/<site>/<file>.jpg` -> `<site>/<file>.txt`; a path with no `images/` prefix is kept as-is."""
    parts = Path(image_path).parts
    rel = Path(*parts[1:]) if parts and parts[0] == "images" else Path(*parts)
    return rel.with_suffix(".txt")


def _as_box_dicts(image: ExportImage) -> list[dict]:
    """Rotated boxes export as their axis-aligned envelope.

    Wave 1 keeps the 5-number detect format, and the envelope is the honest value for it: it is a
    loose label, but it still contains the object. Writing the *unrotated* x/y/w/h instead would
    write a rectangle that does not — a wrong label, not merely a loose one. Wave 2 replaces this
    with the 8-corner OBB format and the looseness goes away.

    `datasets.materialise.detect_boxes` does the flattening, so an exported label and a frozen
    dataset's label are the same decision made once rather than twice.
    """
    return detect_boxes(
        [
            {"class_id": b.class_id, "x": b.x, "y": b.y, "w": b.w, "h": b.h, "angle": b.angle}
            for b in image.boxes
        ]
    )


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


def write(images: list[ExportImage], classes: list[dict], folder: Path) -> list[str]:
    """Writes the mirrored label tree and `classes.txt`; returns [`labels_yolo`, `labels_yolo/classes.txt`]
    (not one entry per image: the job result should name the folder, not enumerate every file in it).
    """
    check_no_stem_collisions(images)
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
