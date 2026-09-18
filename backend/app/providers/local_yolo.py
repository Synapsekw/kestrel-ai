"""Any registry model as a provider, through the shared tiling path (spec section 8).

Model class names are mapped onto project classes by exact name first and then through the model's
alias table; whatever is left over is dropped, so COCO weights only propose what the project asked
for. `ultralytics` is imported inside `_load` so the API process never pays for torch at startup.
"""

from __future__ import annotations

import logging
import threading
from pathlib import Path

from app.jobs.gpu import hold_gpu
from app.providers.base import Detection, Tile, TileResult
from app.providers.tiling import TiledProvider, crop_tile

_MODEL: tuple[str, object] | None = None  # (resolved weights path, YOLO); one at a time
_MODEL_LOCK = threading.Lock()


def _new_yolo(key: str):
    from ultralytics import YOLO

    return YOLO(key)


def _load(weights: Path, device: str):
    """The loaded YOLO for these weights, cached so a tiled run does not reload per tile.

    Exactly one model is kept: holding every model a user has ever run keeps its weights on the
    card, and training wants that memory back. Switching weights drops the old one first.
    """
    global _MODEL
    key = str(Path(weights).resolve())
    with _MODEL_LOCK:
        if _MODEL is None or _MODEL[0] != key:
            _MODEL = None  # drop the previous model before loading, so its VRAM is free
            _MODEL = (key, _new_yolo(key))
        return _MODEL[1]


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


class LocalYoloProvider(TiledProvider):
    name = "local"

    def __init__(
        self,
        weights: Path,
        class_map: dict[str, str],
        imgsz: int = 1280,
        device: str = "0",
        *,
        gpu_timeout: float | None = None,
        cancelled: threading.Event | None = None,
    ):
        self.weights, self.class_map, self.imgsz, self.device = weights, class_map, imgsz, device
        # How this caller waits for the card: a job passes its cancellation event, a request passes
        # a short timeout and turns `GpuBusy` into an answer.
        self.gpu_timeout, self.cancelled = gpu_timeout, cancelled

    def detect_tile(
        self,
        image,
        tile: Tile,
        query: str,
        classes: list[str],
        *,
        conf: float,
        log: logging.Logger,
        raw_ref: str = "",
    ) -> TileResult:
        """One tile on the GPU. `imgsz` is the tile's own size, or the configured size for a
        whole-image tile, which is how pre-annotation reaches 2560 without tiling."""
        crop = crop_tile(image, tile)
        imgsz = self.imgsz if (tile.w, tile.h) == image.size else max(tile.w, tile.h)
        dets: list[Detection] = []
        with hold_gpu(log, "infer", cancelled=self.cancelled, timeout=self.gpu_timeout):
            model = _load(self.weights, self.device)
            for result in model.predict(crop, imgsz=imgsz, conf=conf, device=self.device, verbose=False):
                dets.extend(self._from_result(result, model.names, tile, raw_ref))
        return TileResult(tile=tile, detections=dets)

    def _from_result(self, result, names, tile: Tile, raw_ref: str) -> list[Detection]:
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
                    raw_ref=raw_ref,
                )
            )
        return out
