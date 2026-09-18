"""Any registry model as a provider, through the shared tiling path (spec section 8).

Model class names are mapped onto project classes by exact name first and then through the model's
alias table; whatever is left over is dropped, so COCO weights only propose what the project asked
for. `ultralytics` is imported inside `_load` so the API process never pays for torch at startup.
"""

from __future__ import annotations

import logging
import threading
from pathlib import Path

from PIL import Image as PILImage

from app.jobs.gpu import hold_gpu
from app.providers.base import Detection, TilingSpec
from app.providers.tiling import crop_tile, make_tiles, nms_per_class

_MODELS: dict[str, object] = {}
_MODELS_LOCK = threading.Lock()


def _load(weights: Path, device: str):
    """One YOLO instance per weights path; loading a checkpoint twice costs seconds each time."""
    key = str(Path(weights).resolve())
    with _MODELS_LOCK:
        if key not in _MODELS:
            from ultralytics import YOLO

            _MODELS[key] = YOLO(key)
        return _MODELS[key]


def build_class_map(
    model_class_names: list[str], project_class_names: list[str], aliases: dict[str, str]
) -> dict[str, str]:
    """model class name -> project class name. Exact names win; unmapped classes are dropped."""
    project = set(project_class_names)
    mapping: dict[str, str] = {}
    for name in model_class_names:
        if name in project:
            mapping[name] = name
        elif (target := (aliases or {}).get(name)) in project:
            mapping[name] = target
    return mapping


class LocalYoloProvider:
    name = "local"

    def __init__(
        self, weights: Path, class_map: dict[str, str], imgsz: int = 1280, device: str = "0"
    ):
        self.weights, self.class_map, self.imgsz, self.device = weights, class_map, imgsz, device

    def detect(
        self,
        image_path: Path,
        query: str,
        classes: list[str],
        tiling: TilingSpec,
        *,
        conf: float,
        log: logging.Logger,
    ) -> list[Detection]:
        with PILImage.open(image_path) as im:
            image = im.convert("RGB")
        tiles = make_tiles(image.width, image.height, tiling)
        imgsz = tiling.tile_size if tiling.enabled else self.imgsz
        dets: list[Detection] = []
        with hold_gpu(log, f"infer {Path(image_path).name}"):
            model = _load(self.weights, self.device)
            for tile in tiles:
                crop = crop_tile(image, tile)
                for result in model.predict(
                    crop, imgsz=imgsz, conf=conf, device=self.device, verbose=False
                ):
                    dets.extend(self._from_result(result, model.names, tile))
        return nms_per_class(dets, tiling.nms_iou)

    def _from_result(self, result, names, tile) -> list[Detection]:
        out: list[Detection] = []
        for row in result.boxes or []:
            label = self.class_map.get(str(names[int(row.cls[0])]))
            if label is None:
                continue
            x1, y1, x2, y2 = (float(v) for v in row.xyxy[0])
            out.append(
                Detection(
                    label=label,
                    x=x1 + tile.x,
                    y=y1 + tile.y,
                    w=x2 - x1,
                    h=y2 - y1,
                    confidence=float(row.conf[0]),
                )
            )
        return out
