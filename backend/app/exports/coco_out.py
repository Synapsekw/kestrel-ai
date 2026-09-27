"""COCO label writer: `labels_coco.json` (spec G2)."""

from __future__ import annotations

import json
from pathlib import Path

from shapely.geometry import Polygon

from app.exports.rows import ExportImage
from app.geometry import aabb_of, corners_of

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
            if cat_id is None or box.shape == "point":
                continue  # a point has no extent; a zero-area annotation breaks COCO readers (R-BT9)
            if box.shape == "polygon" and box.points:
                bbox = [box.x, box.y, box.w, box.h]  # a polygon's stored x/y/w/h is its envelope
                area = box.area_px or Polygon(box.points).area
                segmentation = [[c for pt in box.points for c in pt]]
            else:
                bbox = list(aabb_of(box.x, box.y, box.w, box.h, box.angle))
                # Rotation does not change area, so this stays the true box area, not the envelope's.
                area = box.w * box.h
                segmentation = (
                    [[c for pt in corners_of(box.x, box.y, box.w, box.h, box.angle) for c in pt]]
                    if box.angle
                    else None
                )
            ann = {
                "id": ann_id,
                "image_id": image_id,
                "category_id": cat_id,
                # `bbox` is always the axis-aligned envelope so every reader keeps working;
                # `segmentation` carries the exact rotated quad or polygon for readers that use it.
                "bbox": bbox,
                "area": area,
                "iscrowd": 0,
                # Present on every annotation (not only unreviewed ones): a reader must be able to
                # tell an accepted/edited box from an unreviewed proposal without cross-referencing
                # the CSV, especially once include_unreviewed mixes both into this one file.
                "review_state": box.review_state,
            }
            if box.confidence is not None:
                ann["score"] = box.confidence
            if segmentation is not None:
                ann["segmentation"] = segmentation
            annotations.append(ann)
            ann_id += 1

    payload = {"images": coco_images, "categories": categories, "annotations": annotations}
    (folder / FILE_NAME).write_text(json.dumps(payload, indent=2), "utf-8")
    return [FILE_NAME]
