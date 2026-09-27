"""Any library model as a provider, through the shared tiling path (spec section 8).

Model class names are mapped onto project classes by exact name first and then through the model's
alias table; whatever is left over is dropped, so COCO weights only propose what the project asked
for. `ultralytics` is imported inside `_load` so the API process never pays for torch at startup.
"""

from __future__ import annotations

import logging
import os
import threading
from functools import cache
from math import degrees
from pathlib import Path

from app.geometry import normalise_angle
from app.jobs.gpu import hold_gpu
from app.providers.base import Detection, Tile, TileResult
from app.providers.polygons import simplify_ring
from app.providers.tiling import TiledProvider, crop_tile, to_full_image

_MODEL: tuple[str, object] | None = None  # (resolved weights path, YOLO) on the GPU; one at a time
_CPU_MODEL: tuple[str, object] | None = None  # the CPU fallback's own slot (image inspection I-D13)
_MODEL_LOCK = threading.Lock()
_CPU_LOCK = threading.Lock()  # one CPU prediction at a time: an Ultralytics predictor is not thread-safe


def _new_yolo(key: str):
    from ultralytics import YOLO

    return YOLO(key)


def _load(weights: Path, device: str):
    """The loaded YOLO for these weights, cached so a tiled run does not reload per tile.

    One model is kept on the GPU: holding every model a user has ever run keeps its weights on the
    card, and training wants that memory back. The CPU fallback has its own single slot, so a
    request that runs on the CPU while a job holds the card never evicts the job's model.
    """
    global _MODEL, _CPU_MODEL
    key = str(Path(weights).resolve())
    with _MODEL_LOCK:
        if device == "cpu":
            if _CPU_MODEL is None or _CPU_MODEL[0] != key:
                _CPU_MODEL = None
                _set_cpu_threads()
                _CPU_MODEL = (key, _new_yolo(key))
            return _CPU_MODEL[1]
        if _MODEL is None or _MODEL[0] != key:
            _MODEL = None  # drop the previous model before loading, so its VRAM is free
            _MODEL = (key, _new_yolo(key))
        return _MODEL[1]


def _set_cpu_threads() -> None:
    """Leave half the cores to the API, so a CPU detection does not freeze every other request."""
    import torch

    torch.set_num_threads(max(2, (os.cpu_count() or 4) // 2))


@cache
def cuda_available() -> bool:
    """Whether a CUDA device exists at all; without one, detection goes straight to the CPU."""
    try:
        import torch

        return bool(torch.cuda.is_available())
    except Exception:  # a broken torch install is "no GPU", never a failed request
        return False


def _rows(values) -> list:
    return values.tolist() if hasattr(values, "tolist") else list(values)


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
        """One tile. `imgsz` is the tile's own size, or the configured size for a whole-image tile.

        On the GPU the shared lock serialises it with training and export; on the CPU it takes only
        the CPU lock, so a training run holding the card can never block it (decision I-D13).
        """
        crop = crop_tile(image, tile)
        imgsz = self.imgsz if (tile.w, tile.h) == image.size else max(tile.w, tile.h)
        guard = (
            _CPU_LOCK
            if self.device == "cpu"
            else hold_gpu(log, "infer", cancelled=self.cancelled, timeout=self.gpu_timeout)
        )
        dets: list[Detection] = []
        with guard:
            model = _load(self.weights, self.device)
            for result in model.predict(crop, imgsz=imgsz, conf=conf, device=self.device, verbose=False):
                dets.extend(self._from_result(result, model.names, tile, raw_ref))
        return TileResult(tile=tile, detections=dets)

    def _label(self, names, cls) -> str | None:
        return self.class_map.get(str(names[int(cls)]))

    def _from_result(self, result, names, tile: Tile, raw_ref: str) -> list[Detection]:
        """Full-image detections from one tile's result: oriented boxes, else masks, else boxes.

        An OBB model fills `result.obb` and leaves `result.boxes` empty; a segmentation model fills
        `masks` and `boxes`, and the mask outline is the detection (image inspection spec §11.3).
        """
        local: list[Detection] = []
        obb = getattr(result, "obb", None)
        masks = getattr(result, "masks", None)
        if obb is not None:
            for xywhr, cls, conf in zip(_rows(obb.xywhr), _rows(obb.cls), _rows(obb.conf), strict=False):
                label = self._label(names, cls)
                if label is None:
                    continue
                cx, cy, w, h, r = (float(v) for v in xywhr)
                local.append(
                    Detection(
                        label,
                        cx - w / 2,
                        cy - h / 2,
                        w,
                        h,
                        float(conf),
                        raw_ref,
                        angle=normalise_angle(degrees(r)),
                    )
                )
        elif masks is not None and result.boxes is not None:
            boxes = result.boxes
            for ring, cls, conf in zip(masks.xy, _rows(boxes.cls), _rows(boxes.conf), strict=False):
                label = self._label(names, cls)
                if label is None:
                    continue
                simple = simplify_ring(ring)
                if simple is not None:
                    local.append(Detection.from_polygon(label, simple, float(conf), raw_ref))
        else:
            for row in result.boxes or []:
                label = self._label(names, row.cls[0])
                if label is None:
                    continue
                x1, y1, x2, y2 = (float(v) for v in row.xyxy[0])
                local.append(Detection(label, x1, y1, x2 - x1, y2 - y1, float(row.conf[0]), raw_ref))
        return [to_full_image(d, tile) for d in local]
