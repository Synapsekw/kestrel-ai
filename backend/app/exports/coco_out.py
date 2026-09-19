"""COCO label writer: `labels_coco.json` (spec G2)."""

from __future__ import annotations

import json
from pathlib import Path

from app.exports.rows import ExportImage

FILE_NAME = "labels_coco.json"


def write(images: list[ExportImage], classes: list[dict], folder: Path) -> list[str]:
    """Writes one COCO-format JSON file; category ids are 1..n in the project's class order."""
    folder.mkdir(parents=True, exist_ok=True)
    category_id = {c["id"]: i + 1 for i, c in enumerate(classes)}
    categories = [{"id": category_id[c["id"]], "name": c["name"]} for c in classes]

    coco_images = []
    annotations = []
    ann_id = 1
    for image_id, image in enumerate(images, start=1):
        coco_images.append(
            {
                "id": image_id,
                "file_name": image.path,
                "width": image.width,
                "height": image.height,
            }
        )
        for box in image.boxes:
            cat_id = category_id.get(box.class_id)
            if cat_id is None:
                continue
            ann = {
                "id": ann_id,
                "image_id": image_id,
                "category_id": cat_id,
                "bbox": [box.x, box.y, box.w, box.h],
                "area": box.w * box.h,
                "iscrowd": 0,
            }
            if box.confidence is not None:
                ann["score"] = box.confidence
            annotations.append(ann)
            ann_id += 1

    payload = {"images": coco_images, "categories": categories, "annotations": annotations}
    (folder / FILE_NAME).write_text(json.dumps(payload, indent=2), "utf-8")
    return [FILE_NAME]
