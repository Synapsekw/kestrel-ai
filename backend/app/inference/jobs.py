"""The `infer` job: tile by tile, rate limited, retrying and resumable (spec section 8).

Every tile result is written to `runs/query-runs/<query_run_id>/tiles/<image_id>/<index>.json` as
soon as it comes back. The folder belongs to the **run**, not to the job, so `POST .../resume`
starts a second job that reuses what the first one paid for and only asks the provider for the
tiles that are still missing. Boxes are written per image, so a cancelled run still leaves finished
images labelled, and a resume replaces only this run's unreviewed boxes: review decisions survive.
"""

from __future__ import annotations

import json
import os
import shutil
from dataclasses import asdict
from pathlib import Path
from uuid import uuid4

from PIL import Image as PILImage
from sqlalchemy import delete, func, select

from app.db.models import Box, Image, QueryRun
from app.errors import not_found
from app.inference.ratelimit import bucket_for
from app.inference.service import class_ids_by_name, class_names, tiles_dir
from app.jobs.registry import register_job_type
from app.jobs.runner import JobContext
from app.providers.base import Detection, ProviderError, Tile, TileResult, TilingSpec
from app.providers.factory import get_provider
from app.providers.tiling import make_tiles, nms_per_class, not_covered_by
from app.training import registry

RETRY_DELAYS_S = (1, 2, 4, 8, 16)
MAX_ATTEMPTS = len(RETRY_DELAYS_S)
MAX_RETRY_WAIT_S = 60  # a provider may ask for an hour; the user should not wait that long for a tile


def _tile_path(ctx: JobContext, run: QueryRun, image_id: str, index: int) -> Path:
    return tiles_dir(ctx.project, run.id) / image_id / f"{index}.json"


def _write_atomic(path: Path, payload: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_name(f"{path.name}.{uuid4().hex[:8]}.tmp")
    tmp.write_text(json.dumps(payload, indent=2), "utf-8")
    os.replace(tmp, path)


def _detections_from_file(payload: dict) -> list[Detection]:
    return [Detection(**d) for d in payload.get("detections") or []]


def _wiring(ctx: JobContext, name: str):
    """A dependency `create_app` wires onto the runner. Missing means a broken build, not a default.

    Keys cannot travel in `Job.params` (those are persisted in the project DB), so the job reads
    them from the runner. Quietly falling back to a fresh keyring or a guessed rate limit would
    turn a wiring mistake into a mystery 401 or a stream of 429s.
    """
    value = getattr(ctx.runner, name, None)
    if value is None:
        raise RuntimeError(f"the job runner has no {name}; create_app must wire it before jobs run")
    return value


def _call_with_retries(
    ctx: JobContext, provider, image, tile: Tile, run: QueryRun, classes: list[str], raw_ref: str
) -> tuple[TileResult | None, str | None]:
    """Up to five attempts on retryable failures. A permanent failure gives up straight away."""
    last: str | None = None
    for attempt in range(MAX_ATTEMPTS):
        try:
            return provider.detect_tile(
                image, tile, run.query or "", classes, conf=run.conf, log=ctx.log, raw_ref=raw_ref
            ), None
        except ProviderError as e:
            last = str(e)
            if not e.retryable or attempt == MAX_ATTEMPTS - 1:
                ctx.log.warning("tile %s failed permanently: %s", tile.index, last)
                return None, last
            delay = min(e.retry_after or RETRY_DELAYS_S[attempt], MAX_RETRY_WAIT_S)
            ctx.log.info("tile %s failed (%s); retrying in %s s", tile.index, last, delay)
            ctx.cancelled.wait(delay)  # wait on the event, so cancelling ends the wait at once
            ctx.check_cancelled()
    return None, last


def _reviewed(s, run: QueryRun, image_id: str, names: dict[str, str]) -> list[Detection]:
    """This run's already-reviewed boxes on the image, as detections to keep away from."""
    rows = s.execute(
        select(Box).where(
            Box.query_run_id == run.id,
            Box.image_id == image_id,
            Box.review_state != "unreviewed",
        )
    ).scalars()
    return [
        Detection(
            label=names[r.class_id],
            x=r.x,
            y=r.y,
            w=r.w,
            h=r.h,
            confidence=r.confidence or 0.0,
        )
        for r in rows
        if r.class_id in names
    ]


def _write_boxes(ctx: JobContext, run: QueryRun, image_id: str, dets: list[Detection], nms_iou: float) -> int:
    """Replace this image's *unreviewed* boxes for the run, without re-proposing reviewed ones.

    Replacing rather than appending keeps a re-run from doubling proposals, and leaving reviewed
    boxes alone keeps a resume from throwing away work the user has already done. Those two rules
    collide on a resume: the detections come from the whole tile cache, so an object the user has
    already accepted, edited or rejected would come back as a fresh proposal next to their decision.
    Anything a surviving reviewed box already covers is therefore dropped.
    """
    with ctx.project.session() as s:
        by_name = class_ids_by_name(ctx.project, s)
        by_id = {v: k for k, v in by_name.items()}
        keepers = _reviewed(s, run, image_id, by_id)
        if keepers:
            before = len(dets)
            dets = not_covered_by(keepers, dets, nms_iou)
            ctx.log.info(
                "image %s: %s of %s detections are already reviewed boxes of this run",
                image_id,
                before - len(dets),
                before,
            )
        s.execute(
            delete(Box).where(
                Box.query_run_id == run.id,
                Box.image_id == image_id,
                Box.review_state == "unreviewed",
            )
        )
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
    tile_size = (run.tiling or {}).get("tile_size", 1280)
    if run.kind == "cloud_provider":
        config = _wiring(ctx, "provider_config").get(run.provider)
        return get_provider(
            "cloud_provider",
            handle=ctx.project,
            keys=_wiring(ctx, "keys"),
            config=config,
            provider_name=run.provider,
            project_class_names=names,
            imgsz=tile_size,
        )
    return get_provider(
        "local_model",
        handle=ctx.project,
        keys=None,
        config=None,
        model_row=registry.get_model(ctx.project, run.model_id),
        project_class_names=names,
        imgsz=tile_size,
        cancelled=ctx.cancelled,  # a cancelled run stops waiting for a training run to free the GPU
    )


@register_job_type("infer")
def run_infer(ctx: JobContext) -> dict:
    run, names = _load_run(ctx)
    spec = TilingSpec(**(run.tiling or {}))
    provider = _build_provider(ctx, run, names)

    totals = {"tiles": 0, "boxes": 0, "cached_images": 0, "failed_tiles": 0, "refusals": 0}
    image_ids = list(run.image_ids or [])
    for done, image_id in enumerate(image_ids, start=1):
        dets, all_cached = _run_image(ctx, run, provider, spec, names, image_id, totals)
        # A complete tile cache only means the boxes are right if they are actually there: tiles are
        # written per tile and boxes per image, so a killed process can leave the cache full and the
        # image empty. Rewriting from the cache costs nothing and closes that window.
        if all_cached and _count_boxes(ctx, run, image_id) > 0:
            totals["cached_images"] += 1
            ctx.log.info("image %s served entirely from the run's tile cache", image_id)
        else:
            totals["boxes"] += _write_boxes(ctx, run, image_id, dets, spec.nms_iou)
            ctx.publish("boxes.changed", {"image_ids": [image_id]})
        ctx.progress(done / len(image_ids), f"{done} / {len(image_ids)} images, {totals['boxes']} boxes")
    ctx.log.info("run %s finished: %s", run.id, totals)
    _drop_local_tile_cache(ctx, run, totals)
    return {"query_run_id": run.id, "images": len(image_ids), **totals}


def _drop_local_tile_cache(ctx: JobContext, run: QueryRun, totals: dict) -> None:
    """A complete local run needs no resume and can be repeated for free, so its cache goes.

    Cloud caches stay: those tiles were paid for and hold the provider's raw answers. A run with
    failed tiles keeps its cache too, because a resume only repeats what is missing.
    """
    if run.kind != "local_model" or totals["failed_tiles"]:
        return
    run_dir = tiles_dir(ctx.project, run.id).parent
    if run_dir.parent == ctx.project.runs_dir / "query-runs":
        shutil.rmtree(run_dir, ignore_errors=True)


def _count_boxes(ctx: JobContext, run: QueryRun, image_id: str) -> int:
    with ctx.project.session() as s:
        return s.execute(
            select(func.count()).select_from(Box).where(Box.query_run_id == run.id, Box.image_id == image_id)
        ).scalar_one()


def _rate_limiter(ctx: JobContext, run: QueryRun):
    """One bucket per provider, at the rate configured right now. Local runs are not limited."""
    if run.kind != "cloud_provider":
        return None
    rpm = _wiring(ctx, "provider_config").get(run.provider).requests_per_minute
    return bucket_for(run.provider, rpm)


def _run_image(ctx, run, provider, spec, names, image_id, totals) -> tuple[list[Detection], bool]:
    with ctx.project.session() as s:
        image_row = s.get(Image, image_id)
        if image_row is None:
            raise not_found("image", image_id)
        path, width, height = ctx.project.folder / image_row.path, image_row.width, image_row.height

    with PILImage.open(path) as opened:
        image = opened.convert("RGB")
    dets: list[Detection] = []
    all_cached = True
    for tile in make_tiles(width, height, spec):
        ctx.check_cancelled()
        totals["tiles"] += 1
        payload, cached = _tile_result(ctx, run, provider, names, image_id, image, tile)
        all_cached = all_cached and cached
        if payload["failed"]:
            totals["failed_tiles"] += 1
        if payload["refusal"]:
            totals["refusals"] += 1
        dets.extend(d for d in _detections_from_file(payload) if d.confidence >= run.conf)
    return nms_per_class(dets, spec.nms_iou), all_cached


def _tile_result(ctx, run, provider, names, image_id, image, tile: Tile) -> tuple[dict, bool]:
    """One tile: the run's persisted result when there is one, otherwise a call that persists."""
    path = _tile_path(ctx, run, image_id, tile.index)
    if path.exists():
        payload = json.loads(path.read_text("utf-8"))
        if not payload.get("failed"):
            return payload, True  # already done; a failed tile is worth another try on a resume
    limiter = _rate_limiter(ctx, run)
    if limiter is not None:
        limiter.acquire()
    raw_ref = str(path.relative_to(ctx.project.folder).as_posix())
    result, error = _call_with_retries(ctx, provider, image, tile, run, names, raw_ref)
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
    return payload, False
