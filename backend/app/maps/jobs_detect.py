"""The `map_detect` job (spec section 6): window by window, resumable, strip-bounded merge.

Each window's result is checkpointed to `maps/<map>/runs/<run>/windows/<index>.json` in map pixels,
so a resume (a new job for the same run) calls the provider only for windows still missing or
failed. Detections are rebuilt from the checkpoints on every job, so a resume never doubles them.
"""

from __future__ import annotations

import json
import shutil
from dataclasses import asdict
from pathlib import Path

import rasterio
from PIL import Image as PILImage
from sqlalchemy import delete

from app.db.models import GeoMap, MapDetection, MapRun
from app.detect.areas import areas_for_map
from app.detect.counts import recount_map_run
from app.errors import not_found

# Reused rather than duplicated: these helpers are duck-typed on `kind`, `model_id`, `provider`,
# `query` and `conf`, which `MapRun` carries under the same names as `QueryRun`.
from app.inference.jobs import (
    _call_with_retries,
    _rate_limiter,
    _wiring,
    _write_atomic,
    fill_snapshot,
    run_label_map,
)
from app.inference.service import class_ids_by_name, class_names
from app.jobs.registry import register_job_type
from app.jobs.runner import JobContext
from app.library import service as library
from app.maps import raster
from app.maps.startup import map_dir, map_raster_path
from app.maps.windows import (
    SKIP_MASKED,
    MapWindow,
    StripMerger,
    drop_cut_boxes,
    gsd_scale,
    masked_fraction,
    plan_windows,
    strips,
    to_map,
)
from app.providers.base import Detection, Tile
from app.providers.factory import get_provider
from app.volumes.service import refresh_mask_users


def windows_dir(handle, run: MapRun) -> Path:
    return map_dir(handle, run.map_id) / "runs" / run.id / "windows"


def _load(ctx: JobContext) -> tuple[MapRun, GeoMap, list[str], dict[str, str]]:
    run_id = ctx.params["map_run_id"]
    with ctx.project.session() as s:
        run = s.get(MapRun, run_id)
        if run is None:
            raise not_found("map run", run_id)
        gmap = s.get(GeoMap, run.map_id)
        names, by_name = class_names(ctx.project, s), class_ids_by_name(ctx.project, s)
        s.expunge(run)
        s.expunge(gmap)
    return run, gmap, names, by_name


def _provider(ctx: JobContext, run: MapRun, names: list[str]):
    if run.kind == "cloud_provider":
        return get_provider(
            "cloud_provider",
            keys=_wiring(ctx, "keys"),
            config=_wiring(ctx, "provider_config").get(run.provider),
            provider_name=run.provider,
            project_class_names=names,
            imgsz=run.tile_size,
        )
    lib, model = library.model_for_job(ctx.runner.library, run.model_id)
    return get_provider(
        "local_model",
        weights=library.weights_file(lib, model),
        keys=None,
        config=None,
        model_row=model,
        project_class_names=names,
        imgsz=run.tile_size,
        cancelled=ctx.cancelled,
        class_map=run_label_map(ctx, run),
    )


def _skip_map(mask, mscale, wins: list[MapWindow]) -> dict[int, bool]:
    """Which windows are ≥99 % nodata, computed once so neighbours can be judged before they run."""
    return {w.index: masked_fraction(mask, mscale, w) >= SKIP_MASKED for w in wins}


def _open_sides(
    strip_list: list[list[MapWindow]], i: int, j: int, skipped: dict[int, bool]
) -> frozenset[str]:
    """Edges of window `(i, j)` whose neighbour exists and was not skipped for nodata.

    `plan_windows` lays windows out row-major with the same column origins in every row (they only
    depend on width, not height), so a window's neighbours are its left/right in `strip_list[i]` and
    the same column index in the strips above and below.
    """
    row = strip_list[i]
    sides = set()
    if j > 0 and not skipped[row[j - 1].index]:
        sides.add("left")
    if j < len(row) - 1 and not skipped[row[j + 1].index]:
        sides.add("right")
    if i > 0 and j < len(strip_list[i - 1]) and not skipped[strip_list[i - 1][j].index]:
        sides.add("top")
    if i < len(strip_list) - 1 and j < len(strip_list[i + 1]) and not skipped[strip_list[i + 1][j].index]:
        sides.add("bottom")
    return frozenset(sides)


def _window_result(
    ctx, run, provider, names, src, win: MapWindow, gmap: GeoMap, *, skipped: bool, sides: frozenset[str]
) -> tuple[dict, bool]:
    path = windows_dir(ctx.project, run) / f"{win.index}.json"
    if path.exists():
        payload = json.loads(path.read_text("utf-8"))
        if not payload.get("failed"):
            return payload, True
    if skipped:
        payload = {"window": asdict(win), "skipped": True, "failed": False, "error": None, "detections": []}
        _write_atomic(path, payload)
        return payload, False
    limiter = _rate_limiter(ctx, run)
    if limiter is not None:
        limiter.acquire()
    rgb, _ = raster.read_rgb(src, win.x, win.y, win.w, win.h, win.out_w, win.out_h)
    image = PILImage.fromarray(rgb, "RGB")
    tile = Tile(index=win.index, x=0, y=0, w=win.out_w, h=win.out_h)
    raw_ref = path.relative_to(ctx.project.folder).as_posix()
    result, error = _call_with_retries(ctx, provider, image, tile, run, names, raw_ref)
    dets = [to_map(d, win) for d in (result.detections if result else [])]
    overlap_px = round(run.tile_size * run.overlap)
    dets = drop_cut_boxes(dets, win, gmap.width, gmap.height, overlap_px, sides)
    dets = [
        d for d in dets if d.w > 0 and d.h > 0
    ]  # a box clamped to nothing at a window edge is not a detection
    payload = {
        "window": asdict(win),
        "skipped": False,
        "failed": result is None,
        "error": error,
        "detections": [asdict(d) for d in dets],
        "raw": result.raw if result else None,
    }
    _write_atomic(path, payload)
    return payload, False


def _insert(ctx: JobContext, run_id: str, dets: list[Detection], by_name: dict[str, str]) -> int:
    rows = [
        MapDetection(
            run_id=run_id, class_id=by_name[d.label], confidence=d.confidence, x=d.x, y=d.y, w=d.w, h=d.h
        )
        for d in dets
        if d.label in by_name
        and d.w > 0
        and d.h > 0  # belt-and-braces: zero-area boxes are already dropped in _window_result
    ]
    if rows:
        with ctx.project.session() as s:
            s.add_all(rows)
    return len(rows)


def _masks_changed(ctx: JobContext, run_id: str) -> None:
    """The run's boxes were rewritten: a volume measurement masking with it turns stale now and the
    Volumes screen is told (volumes spec section 6.10)."""
    ids = refresh_mask_users(ctx.project, [run_id])
    if ids:
        ctx.publish("volumes.changed", {"measurement_ids": ids})


@register_job_type("map_detect")
def run_map_detect(ctx: JobContext) -> dict:
    run, gmap, names, by_name = _load(ctx)
    provider = _provider(ctx, run, names)
    fill_snapshot(ctx, MapRun, run)
    scale = gsd_scale(gmap.gsd_cm, run.target_gsd_cm)
    wins = plan_windows(gmap.width, gmap.height, run.tile_size, run.overlap, scale)
    with ctx.project.session() as s:
        s.execute(delete(MapDetection).where(MapDetection.run_id == run.id))
    _masks_changed(ctx, run.id)
    totals = {
        "windows": len(wins),
        "skipped_windows": 0,
        "cached_windows": 0,
        "failed_windows": 0,
        "detections": 0,
    }
    merger = StripMerger(run.nms_iou)
    done = 0
    with rasterio.open(map_raster_path(ctx.project, gmap.id)) as src:
        mask, mscale = raster.low_res_mask(src)
        strip_list = strips(wins)
        skipped_by_index = _skip_map(mask, mscale, wins)
        for i, strip in enumerate(strip_list):
            strip_dets: list[Detection] = []
            for j, win in enumerate(strip):
                ctx.check_cancelled()
                sides = _open_sides(strip_list, i, j, skipped_by_index)
                payload, cached = _window_result(
                    ctx,
                    run,
                    provider,
                    names,
                    src,
                    win,
                    gmap,
                    skipped=skipped_by_index[win.index],
                    sides=sides,
                )
                totals["cached_windows"] += cached
                totals["skipped_windows"] += payload.get("skipped", False)
                totals["failed_windows"] += payload.get("failed", False)
                strip_dets += [
                    Detection(**{k: v for k, v in d.items() if k in Detection.__dataclass_fields__})
                    for d in payload["detections"]
                    if d["confidence"] >= run.conf
                ]
                done += 1
                pending = totals["detections"] + len(merger.pending) + len(strip_dets)
                ctx.progress(done / len(wins), f"window {done} / {len(wins)} · {pending} detections")
            totals["detections"] += _insert(ctx, run.id, merger.add_strip(strip[0].y, strip_dets), by_name)
        totals["detections"] += _insert(ctx, run.id, merger.finish(), by_name)
    with ctx.project.session() as s:
        # counts, verified_counts and area_counts from the rows just written (app/detect/counts.py)
        recount_map_run(s, s.get(MapRun, run.id), areas_for_map(s, s.get(GeoMap, gmap.id)))
    ctx.publish("map_runs.changed", {"map_id": gmap.id, "run_ids": [run.id]})
    _masks_changed(ctx, run.id)
    if run.kind == "local_model" and not totals["failed_windows"]:
        shutil.rmtree(windows_dir(ctx.project, run).parent, ignore_errors=True)  # repeatable for free
    ctx.log.info("map run %s finished: %s", run.id, totals)
    return {"map_run_id": run.id, **totals}
