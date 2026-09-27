"""Interactive detection on one image (image inspection spec §11.2, §15, §16; decision I-D13).

`POST /images/{id}/detect` runs synchronously and is bounded by one image: at most `MAX_TILES`
tiles, a `GPU_WAIT_S` wait for the card and then the CPU, so a training run that holds the GPU for
hours never turns **D** into a hang or an error. The answer says which device ran.
"""

from __future__ import annotations

import logging
import math
import time
from dataclasses import dataclass
from pathlib import Path

from sqlalchemy import delete, select

from app.db.models import Box, Image
from app.errors import not_found
from app.imagery import detections, summary
from app.imagery.detect_models import resolve_model
from app.inference.service import class_ids_by_name
from app.jobs.gpu import GpuBusy
from app.library import service as library
from app.library.catalogue_port import CataloguePort
from app.library.db import LibraryModel
from app.library.handle import LibraryHandle
from app.projects.service import ProjectHandle
from app.providers import local_yolo
from app.providers.base import Detection, TilingSpec
from app.providers.tiling import make_tiles

log = logging.getLogger(__name__)

GPU_WAIT_S = 2.0
MAX_TILES = 64
DEFAULT_IMGSZ = 1280
TILE_OVERLAP = 0.2
NMS_IOU = 0.5
TILE_GROWTH = 1.25


@dataclass(frozen=True)
class DetectOutcome:
    suggestions: list[Box]
    new: int
    already_covered: int
    device: str  # ComputeDevice: "cuda" | "cpu"
    elapsed_ms: int
    tiles: int
    model: LibraryModel
    added_type_ids: list[str]


def default_imgsz(model: LibraryModel) -> int:
    return int((model.hyperparameters or {}).get("imgsz") or DEFAULT_IMGSZ)


def tiling_for(width: int, height: int, imgsz: int) -> TilingSpec:
    """Whole frame when the long side is at most 2 x imgsz; otherwise tiles of imgsz, grown until
    the frame needs at most `MAX_TILES` (ruling R-BP4)."""
    if max(width, height) <= 2 * imgsz:
        return TilingSpec(enabled=False, nms_iou=NMS_IOU)
    size = imgsz
    while True:
        spec = TilingSpec(enabled=True, tile_size=size, overlap=TILE_OVERLAP, nms_iou=NMS_IOU)
        if len(make_tiles(width, height, spec)) <= MAX_TILES:
            return spec
        size = math.ceil(size * TILE_GROWTH)


def _provider_imgsz(width: int, height: int, spec: TilingSpec) -> int:
    """An untiled frame predicts at its own long side rounded up to 32 (at most 2 x imgsz), so a
    hairline is not downscaled away; a tiled one predicts each tile at its own size."""
    if spec.enabled:
        return spec.tile_size
    return 32 * math.ceil(max(width, height) / 32)


def _predict(
    weights: Path, labels: dict[str, str], imgsz: int, spec: TilingSpec, path: Path, conf: float
) -> tuple[list[Detection], str]:
    """The frame's detections and the device that produced them (ruling R-BP3)."""
    if local_yolo.cuda_available():
        gpu = local_yolo.LocalYoloProvider(weights, labels, imgsz=imgsz, device="0", gpu_timeout=GPU_WAIT_S)
        try:
            return gpu.detect(path, "", [], spec, conf=conf, log=log), "cuda"
        except GpuBusy:
            log.info("detect: the GPU stayed busy for %.1f s; running this frame on the CPU", GPU_WAIT_S)
    cpu = local_yolo.LocalYoloProvider(weights, labels, imgsz=imgsz, device="cpu")
    return cpu.detect(path, "", [], spec, conf=conf, log=log), "cpu"


def _interactive(image_id: str, model_id: str):
    """This model's interactive suggestions on the image (a run's are the job's business)."""
    return (
        Box.image_id == image_id,
        Box.model_id == model_id,
        Box.provenance_kind == "local_model",
        Box.query_run_id.is_(None),
        Box.review_state == "unreviewed",
    )


def _write(
    handle: ProjectHandle, image_id: str, model: LibraryModel, dets: list[Detection], width: int, height: int
) -> tuple[int, int]:
    """Replace this model's earlier suggestions on the image, in one transaction: `(new, covered)`.

    The delete comes first on purpose: SQLite takes the write lock at the first write, so of two
    racing requests the second waits here and then replaces the first one's rows instead of adding
    a second copy. Only `unreviewed` rows go, so a review decision is never undone.
    """
    with handle.session() as s:
        s.execute(delete(Box).where(*_interactive(image_id, model.id)))
        by_name = class_ids_by_name(handle, s)
        decided = list(
            s.execute(select(Box).where(Box.image_id == image_id, Box.review_state != "unreviewed")).scalars()
        )
        rows: list[Box] = []
        covered = 0
        for d in dets:
            class_id = by_name.get(d.label)
            if class_id is None:
                continue
            if detections.covered(d.envelope(), class_id, decided):
                covered += 1
                continue
            fields = detections.to_fields(d, width, height)
            if fields is None:
                continue
            rows.append(
                detections.suggestion(
                    fields,
                    image_id=image_id,
                    class_id=class_id,
                    confidence=d.confidence,
                    provenance_kind="local_model",
                    model_id=model.id,
                    provider=None,
                    model_name=model.name,
                    query_run_id=None,
                )
            )
        rows = detections.within_cap(s, image_id, rows)
        s.add_all(rows)
        s.flush()
        summary.touch(s, image_id)
        return len(rows), covered


def _suggestions(handle: ProjectHandle, image_id: str, model_id: str) -> list[Box]:
    with handle.session() as s:
        rows = list(
            s.execute(
                select(Box).where(*_interactive(image_id, model_id)).order_by(Box.confidence.desc(), Box.id)
            ).scalars()
        )
        for r in rows:
            s.expunge(r)
    return rows


def detect_one(
    handle: ProjectHandle,
    lib: LibraryHandle | None,
    catalogue: CataloguePort,
    image_id: str,
    *,
    model_id: str,
    conf: float,
    imgsz: int | None = None,
) -> DetectOutcome:
    started = time.monotonic()
    with handle.session() as s:
        image = s.get(Image, image_id)
        if image is None:
            raise not_found("image", image_id)
        path, width, height = handle.folder / image.path, image.width, image.height
    resolved = resolve_model(handle, lib, catalogue, model_id)  # every refusal before any work
    size = imgsz or default_imgsz(resolved.model)
    spec = tiling_for(width, height, size)
    tiles = len(make_tiles(width, height, spec))
    weights = library.weights_file(lib, resolved.model)
    dets, device = _predict(weights, resolved.labels, _provider_imgsz(width, height, spec), spec, path, conf)
    new, covered = _write(handle, image_id, resolved.model, dets, width, height)
    return DetectOutcome(
        suggestions=_suggestions(handle, image_id, resolved.model.id),
        new=new,
        already_covered=covered,
        device=device,
        elapsed_ms=int((time.monotonic() - started) * 1000),
        tiles=tiles,
        model=resolved.model,
        added_type_ids=resolved.added,
    )
