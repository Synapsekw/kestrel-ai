"""The `infer` job: tile by tile, rate limited, retrying and resumable (spec section 8).

Every tile result is written to `runs/<job_id>/tiles/<image_id>/<index>.json` as soon as it comes
back, and that file is the source of truth on a restart: a job pointed at the same folder skips the
tiles it already has and only calls the provider for the rest. Boxes are written per image, so a
cancelled run still leaves finished images labelled.
"""

from __future__ import annotations

import json
import logging
import os
from dataclasses import asdict
from pathlib import Path
from time import sleep
from uuid import uuid4

from PIL import Image as PILImage
from sqlalchemy import delete

from app.db.models import Box, Image, QueryRun
from app.errors import not_found
from app.inference.ratelimit import TokenBucket
from app.inference.service import class_ids_by_name, class_names
from app.jobs.registry import register_job_type
from app.jobs.runner import JobContext
from app.providers.base import Detection, ProviderError, Tile, TileResult, TilingSpec
from app.providers.factory import get_provider
from app.providers.keys import KeyringKeyStore
from app.providers.tiling import make_tiles, nms_per_class

RETRY_DELAYS_S = (1, 2, 4, 8, 16)
MAX_ATTEMPTS = len(RETRY_DELAYS_S)


def _tile_path(ctx: JobContext, image_id: str, index: int) -> Path:
    return ctx.project.runs_dir / ctx.job_id / "tiles" / image_id / f"{index}.json"


def _write_atomic(path: Path, payload: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_name(f"{path.name}.{uuid4().hex[:8]}.tmp")
    tmp.write_text(json.dumps(payload, indent=2), "utf-8")
    os.replace(tmp, path)


def _detections_from_file(payload: dict) -> list[Detection]:
    return [Detection(**d) for d in payload.get("detections") or []]


def _call_with_retries(
    provider, image, tile: Tile, run: QueryRun, classes: list[str], raw_ref: str, log: logging.Logger
) -> tuple[TileResult | None, str | None]:
    """Up to five attempts on retryable failures. A permanent failure gives up straight away."""
    last: str | None = None
    for attempt in range(MAX_ATTEMPTS):
        try:
            return provider.detect_tile(
                image, tile, run.query or "", classes, conf=run.conf, log=log, raw_ref=raw_ref
            ), None
        except ProviderError as e:
            last = str(e)
            if not e.retryable or attempt == MAX_ATTEMPTS - 1:
                log.warning("tile %s failed permanently: %s", tile.index, last)
                return None, last
            delay = e.retry_after or RETRY_DELAYS_S[attempt]
            log.info("tile %s failed (%s); retrying in %s s", tile.index, last, delay)
            sleep(delay)
    return None, last


def _write_boxes(ctx: JobContext, run: QueryRun, image_id: str, dets: list[Detection]) -> int:
    """Replace this image's boxes for the run, so re-running a tile never doubles its proposals."""
    with ctx.project.session() as s:
        by_name = class_ids_by_name(ctx.project, s)
        s.execute(delete(Box).where(Box.query_run_id == run.id, Box.image_id == image_id))
        rows = [
            Box(
                image_id=image_id,
                class_id=by_name[d.label],
                x=d.x,
                y=d.y,
                w=d.w,
                h=d.h,
                confidence=d.confidence,
                provenance_kind=run.kind,
                model_id=run.model_id,
                provider=run.provider,
                model_name=run.model_name,
                query_run_id=run.id,
                review_state="unreviewed",
            )
            for d in dets
            if d.label in by_name
        ]
        s.add_all(rows)
    return len(rows)


def _load_run(ctx: JobContext) -> tuple[QueryRun, list[str]]:
    run_id = ctx.params["query_run_id"]
    with ctx.project.session() as s:
        run = s.get(QueryRun, run_id)
        if run is None:
            raise not_found("query run", run_id)
        names = class_names(ctx.project, s)
        s.expunge(run)
    return run, names


def _build_provider(ctx: JobContext, run: QueryRun, names: list[str]):
    from app.training import registry

    runner = ctx.runner
    keys = getattr(runner, "keys", None) or KeyringKeyStore()
    config = getattr(runner, "provider_config", None)
    model_row = registry.get_model(ctx.project, run.model_id) if run.kind == "local_model" else None
    tile_size = (run.tiling or {}).get("tile_size", 1280)
    return get_provider(
        run.kind,
        handle=ctx.project,
        keys=keys,
        config=config.get(run.provider) if (config and run.provider) else None,
        model_row=model_row,
        provider_name=run.provider,
        project_class_names=names,
        imgsz=tile_size,
    )


@register_job_type("infer")
def run_infer(ctx: JobContext) -> dict:
    run, names = _load_run(ctx)
    spec = TilingSpec(**(run.tiling or {}))
    provider = _build_provider(ctx, run, names)
    bucket = TokenBucket(_rpm(ctx, run)) if run.kind == "cloud_provider" else None

    totals = {"tiles": 0, "boxes": 0, "failed_tiles": 0, "refusals": 0}
    image_ids = list(run.image_ids or [])
    for done, image_id in enumerate(image_ids, start=1):
        dets = _run_image(ctx, run, provider, spec, names, bucket, image_id, totals)
        totals["boxes"] += _write_boxes(ctx, run, image_id, dets)
        ctx.publish("boxes.changed", {"image_ids": [image_id]})
        ctx.progress(done / len(image_ids), f"{done} / {len(image_ids)} images, {totals['boxes']} boxes")
    ctx.log.info("run %s finished: %s", run.id, totals)
    return {"query_run_id": run.id, "images": len(image_ids), **totals}


def _rpm(ctx: JobContext, run: QueryRun) -> int:
    config = getattr(ctx.runner, "provider_config", None)
    return config.get(run.provider).requests_per_minute if config and run.provider else 30


def _run_image(ctx, run, provider, spec, names, bucket, image_id, totals) -> list[Detection]:
    with ctx.project.session() as s:
        image_row = s.get(Image, image_id)
        if image_row is None:
            raise not_found("image", image_id)
        path, width, height = ctx.project.folder / image_row.path, image_row.width, image_row.height

    with PILImage.open(path) as opened:
        image = opened.convert("RGB")
    dets: list[Detection] = []
    for tile in make_tiles(width, height, spec):
        ctx.check_cancelled()
        totals["tiles"] += 1
        payload = _tile_result(ctx, run, provider, names, bucket, image_id, image, tile)
        if payload["failed"]:
            totals["failed_tiles"] += 1
        if payload["refusal"]:
            totals["refusals"] += 1
        dets.extend(d for d in _detections_from_file(payload) if d.confidence >= run.conf)
    return nms_per_class(dets, spec.nms_iou)


def _tile_result(ctx, run, provider, names, bucket, image_id, image, tile: Tile) -> dict:
    """One tile: the persisted result when there is one, otherwise a provider call that persists."""
    path = _tile_path(ctx, image_id, tile.index)
    if path.exists():
        payload = json.loads(path.read_text("utf-8"))
        if not payload.get("failed"):
            return payload  # already done; a failed tile is worth another try on a restart
    if bucket is not None:
        bucket.acquire()
    raw_ref = str(path.relative_to(ctx.project.folder).as_posix())
    result, error = _call_with_retries(provider, image, tile, run, names, raw_ref, ctx.log)
    payload = {
        "tile": asdict(tile),
        "detections": [asdict(d) for d in (result.detections if result else [])],
        "refusal": result.refusal if result else None,
        "failed": result is None,
        "error": error,
        "raw_ref": raw_ref,
        "raw": result.raw if result else None,
    }
    _write_atomic(path, payload)
    return payload
