"""Maps, runs, zones and labels: rows and bounded queries (spec 2026-09-22-geotiff-maps)."""

from __future__ import annotations

import shutil
import threading
from collections import OrderedDict
from collections.abc import Callable
from datetime import date
from pathlib import Path

import rasterio
from sqlalchemy import Integer, cast, delete, func, select
from sqlalchemy.orm import Session

from app.datasets.grouping import slugify
from app.db.models import GeoMap, Job, MapDetection, MapLabel, MapRun, MapZone, Source
from app.errors import AppError, not_found

# Reused rather than duplicated: `_validate`/`_cost_per_request` are duck-typed on `kind`,
# `model_id`, `provider`, `query` and `conf`, which `MapRunCreate` carries under the same names.
from app.inference.service import _cost_per_request, _validate, class_ids_by_name
from app.library.handle import LibraryHandle
from app.maps import raster, scoring
from app.maps.schemas import (
    GeoMapCreate,
    MapLabelCreate,
    MapLabelSeed,
    MapLabelUpdate,
    MapRunCreate,
    MapZoneCreate,
    MapZoneUpdate,
)
from app.maps.startup import map_dir, map_raster_path
from app.maps.tiles import TILE_CACHE
from app.maps.windows import SKIP_MASKED, gsd_scale, masked_fraction, plan_windows
from app.projects.service import ProjectHandle

MAP_SUFFIXES = {".tif", ".tiff"}


def create_map(handle: ProjectHandle, body: GeoMapCreate) -> GeoMap:
    path = Path(body.path)
    if path.suffix.lower() not in MAP_SUFFIXES or not path.is_file():
        # 404, not 422: a well-formed path that is not a usable .tif/.tiff on disk is a missing
        # resource, and the contract's positive-data-acceptance check forbids rejecting schema-valid
        # bodies with 422 (same rule as app/datasets/router.py::create_source for a missing folder).
        raise not_found("map file", str(path))
    name = body.name or path.stem
    with handle.session() as s:
        # A map is a detection source of its own (spec 2026-09-23 section 7.1): the source carries the
        # label and mirrors the map's survey date, and the map points back at it.
        source = Source(
            kind="map",
            label=name,
            folder=str(path.resolve()),
            site=slugify(path.stem) or "map",
            settings={},
        )
        s.add(source)
        s.flush()
        row = GeoMap(
            name=name,
            status="importing",
            source_path=str(path.resolve()),
            source_size=path.stat().st_size,
            source_id=source.id,
        )
        s.add(row)
        s.flush()
        s.expunge(row)
    return row


def list_maps(handle: ProjectHandle) -> list[GeoMap]:
    with handle.session() as s:
        rows = list(s.execute(select(GeoMap).order_by(GeoMap.created_at.desc())).scalars())
        for r in rows:
            s.expunge(r)
    return rows


def _get(s: Session, map_id: str) -> GeoMap:
    row = s.get(GeoMap, map_id)
    if row is None:
        raise not_found("map", map_id)
    return row


def get_map(handle: ProjectHandle, map_id: str) -> GeoMap:
    with handle.session() as s:
        row = _get(s, map_id)
        s.expunge(row)
    return row


def timeline_rows(handle: ProjectHandle) -> tuple[list[GeoMap], dict[str, list[MapRun]]]:
    """Every map of the project with its runs. Bounded: tens of rows, and never a detection."""
    with handle.session() as s:
        maps = list(s.execute(select(GeoMap)).scalars())
        runs = list(s.execute(select(MapRun)).scalars())
        for row in (*maps, *runs):
            s.expunge(row)
    by_map: dict[str, list[MapRun]] = {}
    for r in runs:
        by_map.setdefault(r.map_id, []).append(r)
    return maps, by_map


def set_captured_on(handle: ProjectHandle, map_id: str, captured_on: date | None) -> GeoMap:
    with handle.session() as s:
        row = _get(s, map_id)
        row.captured_on = captured_on
        sync_source_date(s, row)
        s.flush()
        s.expunge(row)
    return row


def sync_source_date(s: Session, gmap: GeoMap) -> None:
    """Keep the map source's survey date equal to the map's: the map is the one truth."""
    if gmap.source_id is None:
        return
    source = s.get(Source, gmap.source_id)
    if source is not None:
        source.captured_on = gmap.captured_on


def require_ready(handle: ProjectHandle, map_id: str) -> GeoMap:
    row = get_map(handle, map_id)
    if row.status != "ready":
        raise AppError("conflict", f"map {row.name} is {row.status}, not ready", 409)
    return row


def set_map_job(handle: ProjectHandle, map_id: str, job_id: str) -> GeoMap:
    with handle.session() as s:
        row = _get(s, map_id)
        row.job_id = job_id
        s.flush()
        s.expunge(row)
    return row


def bump_labels_version(s: Session, map_id: str) -> None:
    _get(s, map_id).labels_version += 1


def delete_map(handle: ProjectHandle, map_id: str, is_live: Callable[[str], bool]) -> None:
    with handle.session() as s:
        row = _get(s, map_id)
        run_job_ids = s.execute(select(MapRun.job_id).where(MapRun.map_id == map_id)).scalars()
        job_ids = [row.job_id, *run_job_ids]
        if any(j and is_live(j) for j in job_ids):
            raise AppError("conflict", "the map has a job queued or running; cancel it first", 409)
        source = s.get(Source, row.source_id) if row.source_id else None
        s.delete(row)  # runs, detections, zones and labels go with it (ON DELETE CASCADE)
        if source is not None and source.kind == "map":
            s.delete(source)  # the map source only ever stood for this map
    TILE_CACHE.drop_map(map_id)
    shutil.rmtree(map_dir(handle, map_id), ignore_errors=True)


MAX_DETECTIONS = 5000
BUSY = ("queued", "running")
_RESUME_LOCK = threading.Lock()


def create_run(
    handle: ProjectHandle, keys, config, body: MapRunCreate, *, lib: LibraryHandle | None
) -> MapRun:
    require_ready(handle, body.map_id)
    model_name = _validate(handle, config, body, check_key=True, keys=keys, lib=lib)
    with handle.session() as s:
        row = MapRun(
            map_id=body.map_id,
            kind=body.kind,
            model_id=body.model_id if body.kind == "local_model" else None,
            provider=body.provider if body.kind == "cloud_provider" else None,
            model_name=model_name,
            query=(body.query or "").strip(),
            tile_size=body.tile_size,
            overlap=body.overlap,
            nms_iou=body.nms_iou,
            conf=body.conf,
            target_gsd_cm=body.target_gsd_cm,
        )
        s.add(row)
        s.flush()
        s.expunge(row)
    return row


def estimate_run(handle: ProjectHandle, config, body: MapRunCreate, *, lib: LibraryHandle | None) -> dict:
    gmap = require_ready(handle, body.map_id)
    _validate(handle, config, body, check_key=False, keys=None, lib=lib)
    scale = gsd_scale(gmap.gsd_cm, body.target_gsd_cm)
    wins = plan_windows(gmap.width, gmap.height, body.tile_size, body.overlap, scale)
    with rasterio.open(map_raster_path(handle, gmap.id)) as src:
        mask, mscale = raster.low_res_mask(src)
    skipped = sum(1 for w in wins if masked_fraction(mask, mscale, w) >= SKIP_MASKED)
    per_request = _cost_per_request(config, body)
    requests = len(wins) - skipped
    return {
        "windows": len(wins),
        "skipped_windows": skipped,
        "requests": requests,
        "scale": scale,
        "cost_per_request": per_request,
        "estimated_cost": round(requests * per_request, 6),
    }


def _run(s: Session, run_id: str) -> MapRun:
    row = s.get(MapRun, run_id)
    if row is None:
        raise not_found("map run", run_id)
    return row


def _state_and_count(s: Session, row: MapRun) -> tuple[str | None, int]:
    job = s.get(Job, row.job_id) if row.job_id else None
    count = s.execute(
        select(func.count()).select_from(MapDetection).where(MapDetection.run_id == row.id)
    ).scalar_one()
    return (job.state if job else None), count


def get_run(handle: ProjectHandle, run_id: str) -> tuple[MapRun, str | None, int]:
    with handle.session() as s:
        row = _run(s, run_id)
        state, count = _state_and_count(s, row)
        s.expunge(row)
    return row, state, count


def list_runs(handle: ProjectHandle, map_id: str) -> list[tuple[MapRun, str | None, int]]:
    with handle.session() as s:
        _get(s, map_id)
        out = []
        for row in s.execute(
            select(MapRun).where(MapRun.map_id == map_id).order_by(MapRun.created_at.desc())
        ).scalars():
            state, count = _state_and_count(s, row)
            s.expunge(row)
            out.append((row, state, count))
    return out


def set_run_job(handle: ProjectHandle, run_id: str, job_id: str) -> MapRun:
    with handle.session() as s:
        row = _run(s, run_id)
        row.job_id = job_id
        s.flush()
        s.expunge(row)
    return row


def resume_run(handle: ProjectHandle, run_id: str, submit: Callable[[MapRun], Job]) -> Job:
    with _RESUME_LOCK:
        with handle.session() as s:
            row = _run(s, run_id)
            job = s.get(Job, row.job_id) if row.job_id else None
            if job is not None and job.state in BUSY:
                raise AppError("conflict", f"map run {run_id} is still {job.state}; cancel it first", 409)
            s.expunge(row)
        job = submit(row)
        set_run_job(handle, run_id, job.id)
        return job


def delete_run(handle: ProjectHandle, run_id: str, is_live: Callable[[str], bool]) -> None:
    with handle.session() as s:
        row = _run(s, run_id)
        if row.job_id and is_live(row.job_id):
            raise AppError("conflict", "the run's job is queued or running; cancel it first", 409)
        map_id = row.map_id
        s.execute(delete(MapDetection).where(MapDetection.run_id == run_id))
        s.delete(row)
    shutil.rmtree(map_dir(handle, map_id) / "runs" / run_id, ignore_errors=True)


def _parse_bbox(bbox: str | None) -> tuple[float, float, float, float] | None:
    """`x0,y0,x1,y1`, matching the contract's pattern exactly (four signed decimals): a filter a
    caller cannot parse is rejected rather than silently ignored, which would answer with boxes
    from the whole map while the caller believes it asked for one viewport."""
    if not bbox:
        return None
    parts = bbox.split(",")
    if len(parts) != 4:
        raise AppError("validation_error", "bbox must be x0,y0,x1,y1", 422)
    try:
        x0, y0, x1, y1 = (float(v) for v in parts)
    except ValueError:
        raise AppError("validation_error", "bbox must be x0,y0,x1,y1", 422) from None
    return x0, y0, x1, y1


def detections_in(
    handle: ProjectHandle, run_id: str, bbox: str | None, min_conf: float | None, class_id: str | None
) -> tuple[list[MapDetection], bool]:
    box = _parse_bbox(bbox)
    q = select(MapDetection).where(MapDetection.run_id == run_id)
    if box:
        x0, y0, x1, y1 = box
        q = q.where(
            MapDetection.x < x1,
            MapDetection.x + MapDetection.w > x0,
            MapDetection.y < y1,
            MapDetection.y + MapDetection.h > y0,
        )
    if min_conf is not None:
        q = q.where(MapDetection.confidence >= min_conf)
    if class_id:
        q = q.where(MapDetection.class_id == class_id)
    with handle.session() as s:
        _run(s, run_id)
        rows = list(s.execute(q.limit(MAX_DETECTIONS + 1)).scalars())
        for r in rows:
            s.expunge(r)
    return rows[:MAX_DETECTIONS], len(rows) > MAX_DETECTIONS


def density(
    handle: ProjectHandle, run_id: str, cells: int, min_conf: float | None
) -> tuple[float, list[dict]]:
    with handle.session() as s:
        run = _run(s, run_id)
        gmap = _get(s, run.map_id)
        cell = max(gmap.width, gmap.height) / cells
        gx = cast((MapDetection.x + MapDetection.w / 2) / cell, Integer).label("gx")
        gy = cast((MapDetection.y + MapDetection.h / 2) / cell, Integer).label("gy")
        q = select(gx, gy, MapDetection.class_id, func.count()).where(MapDetection.run_id == run_id)
        if min_conf is not None:
            q = q.where(MapDetection.confidence >= min_conf)
        rows = s.execute(q.group_by(gx, gy, MapDetection.class_id)).all()
    return cell, [{"gx": a, "gy": b, "class_id": c, "count": n} for a, b, c, n in rows]


MAX_LABELS = 20000
_SCORE_CACHE: OrderedDict[tuple, dict] = OrderedDict()
_SCORE_CACHE_ITEMS = 8
_SCORE_LOCK = threading.Lock()


def _check_polygon(polygon: list[list[float]]) -> list[list[float]]:
    if any(len(p) != 2 for p in polygon):
        raise AppError("validation_error", "each polygon point is [x, y]", 422)
    return [[float(x), float(y)] for x, y in polygon]


def _zone(s: Session, map_id: str, zone_id: str) -> MapZone:
    row = s.get(MapZone, zone_id)
    if row is None or row.map_id != map_id:
        raise not_found("zone", zone_id)
    return row


def list_zones(handle: ProjectHandle, map_id: str) -> list[MapZone]:
    with handle.session() as s:
        _get(s, map_id)
        rows = list(
            s.execute(select(MapZone).where(MapZone.map_id == map_id).order_by(MapZone.created_at)).scalars()
        )
        for r in rows:
            s.expunge(r)
    return rows


def create_zone(handle: ProjectHandle, map_id: str, body: MapZoneCreate) -> MapZone:
    with handle.session() as s:
        _get(s, map_id)
        row = MapZone(map_id=map_id, name=body.name, polygon=_check_polygon(body.polygon))
        s.add(row)
        bump_labels_version(s, map_id)
        s.flush()
        s.expunge(row)
    return row


def update_zone(handle: ProjectHandle, map_id: str, zone_id: str, body: MapZoneUpdate) -> MapZone:
    with handle.session() as s:
        row = _zone(s, map_id, zone_id)
        if body.name is not None:
            row.name = body.name
        if body.polygon is not None:
            row.polygon = _check_polygon(body.polygon)
        bump_labels_version(s, map_id)
        s.flush()
        s.expunge(row)
    return row


def delete_zone(handle: ProjectHandle, map_id: str, zone_id: str) -> None:
    with handle.session() as s:
        s.delete(_zone(s, map_id, zone_id))
        bump_labels_version(s, map_id)


def _label(s: Session, map_id: str, label_id: str) -> MapLabel:
    row = s.get(MapLabel, label_id)
    if row is None or row.map_id != map_id:
        raise not_found("label", label_id)
    return row


def _check_box(s: Session, handle: ProjectHandle, gmap: GeoMap, class_id: str, x, y, w, h) -> None:
    if class_id not in set(class_ids_by_name(handle, s).values()):
        raise AppError("validation_error", f"unknown class {class_id}", 422)
    if x + w > gmap.width or y + h > gmap.height:
        raise AppError("validation_error", "the box leaves the map", 422)


def list_labels(handle: ProjectHandle, map_id: str) -> list[MapLabel]:
    """Every label of the map. Raises rather than silently truncating past `MAX_LABELS`: this feeds
    both the labels API and `jobs_export._boxes`, and a truncated ground-truth export would be a
    silently wrong file, not just an incomplete UI list (the export job can afford a loud failure;
    the UI list can afford telling the operator to split the map into smaller zones)."""
    with handle.session() as s:
        _get(s, map_id)
        rows = list(
            s.execute(select(MapLabel).where(MapLabel.map_id == map_id).limit(MAX_LABELS + 1)).scalars()
        )
        if len(rows) > MAX_LABELS:
            raise AppError(
                "conflict", "this map has too many labels to list at once; use zone-scoped views", 409
            )
        for r in rows:
            s.expunge(r)
    return rows


def create_label(handle: ProjectHandle, map_id: str, body: MapLabelCreate) -> MapLabel:
    with handle.session() as s:
        gmap = _get(s, map_id)
        _check_box(s, handle, gmap, body.class_id, body.x, body.y, body.w, body.h)
        row = MapLabel(
            map_id=map_id, class_id=body.class_id, x=body.x, y=body.y, w=body.w, h=body.h, source="manual"
        )
        s.add(row)
        bump_labels_version(s, map_id)
        s.flush()
        s.expunge(row)
    return row


def update_label(handle: ProjectHandle, map_id: str, label_id: str, body: MapLabelUpdate) -> MapLabel:
    with handle.session() as s:
        gmap = _get(s, map_id)
        row = _label(s, map_id, label_id)
        for field, value in body.model_dump(exclude_none=True).items():
            setattr(row, field, value)
        _check_box(s, handle, gmap, row.class_id, row.x, row.y, row.w, row.h)
        row.source = "manual"  # a person looked at it
        bump_labels_version(s, map_id)
        s.flush()
        s.expunge(row)
    return row


def delete_label(handle: ProjectHandle, map_id: str, label_id: str) -> None:
    with handle.session() as s:
        s.delete(_label(s, map_id, label_id))
        bump_labels_version(s, map_id)


DEDUPE_IOU = 0.5


def seed_labels(handle: ProjectHandle, map_id: str, body: MapLabelSeed) -> int:
    """Ground truth from a run's detections. Idempotent: a detection that already has a label of
    the same class overlapping it at or above `DEDUPE_IOU` is skipped, so seeding the same run and
    zone twice does not double up the ground truth (which would silently corrupt precision/recall,
    not just leave a duplicate row around).

    Both queries are narrowed to the named zone's bounding box (the same four intersection
    predicates `score_run` uses), with the same `MAX_DETECTIONS`/`MAX_LABELS` backstop: an
    unbounded read here on an 80k x 60k ortho would pull six figures of detections for a synchronous
    POST while the zone covers a sliver of the map."""
    with handle.session() as s:
        _get(s, map_id)
        zone = _zone(s, map_id, body.zone_id)
        run = _run(s, body.run_id)
        if run.map_id != map_id:
            raise AppError("validation_error", "the run belongs to another map", 422)
        area = [scoring.Zone(zone.id, [tuple(p) for p in zone.polygon])]
        x0, y0, x1, y1 = _zones_bbox([zone])
        existing_rows = list(
            s.execute(
                select(MapLabel)
                .where(
                    MapLabel.map_id == map_id,
                    MapLabel.x < x1,
                    MapLabel.x + MapLabel.w > x0,
                    MapLabel.y < y1,
                    MapLabel.y + MapLabel.h > y0,
                )
                .limit(MAX_LABELS + 1)
            ).scalars()
        )
        if len(existing_rows) > MAX_LABELS:
            raise AppError(
                "conflict", "the zone holds too many existing labels to seed; use a smaller zone", 409
            )
        existing = [
            scoring.ScoreBox(lab.id, lab.class_id, lab.x, lab.y, lab.w, lab.h) for lab in existing_rows
        ]
        det_rows = list(
            s.execute(
                select(MapDetection)
                .where(
                    MapDetection.run_id == run.id,
                    MapDetection.confidence >= body.min_conf,
                    MapDetection.x < x1,
                    MapDetection.x + MapDetection.w > x0,
                    MapDetection.y < y1,
                    MapDetection.y + MapDetection.h > y0,
                )
                .limit(MAX_DETECTIONS + 1)
            ).scalars()
        )
        if len(det_rows) > MAX_DETECTIONS:
            raise AppError("conflict", "the zone covers too many detections to seed; use a smaller zone", 409)
        rows = []
        for d in det_rows:
            box = scoring.ScoreBox(d.id, d.class_id, d.x, d.y, d.w, d.h)
            if not scoring.zone_of(box, area):
                continue
            if any(lab.class_id == d.class_id and scoring._iou(box, lab) >= DEDUPE_IOU for lab in existing):
                continue
            rows.append(
                MapLabel(
                    map_id=map_id,
                    class_id=d.class_id,
                    x=d.x,
                    y=d.y,
                    w=d.w,
                    h=d.h,
                    source=f"from_run:{run.id}",
                )
            )
            existing.append(scoring.ScoreBox("", d.class_id, d.x, d.y, d.w, d.h))
        s.add_all(rows)
        bump_labels_version(s, map_id)
    return len(rows)


def _zones_bbox(zones: list[MapZone]) -> tuple[float, float, float, float]:
    xs = [p[0] for z in zones for p in z.polygon]
    ys = [p[1] for z in zones for p in z.polygon]
    return min(xs), min(ys), max(xs), max(ys)


def score_run(handle: ProjectHandle, run_id: str, iou: float) -> dict:
    with handle.session() as s:
        run = _run(s, run_id)
        gmap = _get(s, run.map_id)
        key = (handle.id, run_id, gmap.labels_version, round(iou, 4), run.job_id)
        with _SCORE_LOCK:
            if key in _SCORE_CACHE:
                return _SCORE_CACHE[key]
        version = gmap.labels_version
        zone_rows = list(s.execute(select(MapZone).where(MapZone.map_id == gmap.id)).scalars())
        if not zone_rows:
            # Nothing outside a zone can score: loading detections or labels to score zero of them
            # is pure waste, and a freshly imported (zone-less) map is the common case.
            result = {"run_id": run_id, "labels_version": version, **scoring.score([], [], [], iou)}
        else:
            zones = [scoring.Zone(z.id, [tuple(p) for p in z.polygon]) for z in zone_rows]
            bbox = _zones_bbox(zone_rows)
            x0, y0, x1, y1 = bbox
            det_rows = list(
                s.execute(
                    select(MapDetection)
                    .where(
                        MapDetection.run_id == run_id,
                        MapDetection.confidence >= run.conf,
                        MapDetection.x < x1,
                        MapDetection.x + MapDetection.w > x0,
                        MapDetection.y < y1,
                        MapDetection.y + MapDetection.h > y0,
                    )
                    .limit(MAX_DETECTIONS + 1)
                ).scalars()
            )
            if len(det_rows) > MAX_DETECTIONS:
                raise AppError(
                    "conflict",
                    "the evaluation zones cover too much of the map to score; use smaller zones",
                    409,
                )
            lab_rows = list(
                s.execute(
                    select(MapLabel)
                    .where(
                        MapLabel.map_id == gmap.id,
                        MapLabel.x < x1,
                        MapLabel.x + MapLabel.w > x0,
                        MapLabel.y < y1,
                        MapLabel.y + MapLabel.h > y0,
                    )
                    .limit(MAX_LABELS + 1)
                ).scalars()
            )
            if len(lab_rows) > MAX_LABELS:
                raise AppError(
                    "conflict",
                    "the evaluation zones cover too much of the map to score; use smaller zones",
                    409,
                )
            dets = [scoring.ScoreBox(d.id, d.class_id, d.x, d.y, d.w, d.h, d.confidence) for d in det_rows]
            labels = [scoring.ScoreBox(lab.id, lab.class_id, lab.x, lab.y, lab.w, lab.h) for lab in lab_rows]
            result = {"run_id": run_id, "labels_version": version, **scoring.score(dets, labels, zones, iou)}
    with _SCORE_LOCK:
        _SCORE_CACHE[key] = result
        while len(_SCORE_CACHE) > _SCORE_CACHE_ITEMS:
            _SCORE_CACHE.popitem(last=False)
    return result


def validate_export(handle: ProjectHandle, body) -> GeoMap:
    gmap = require_ready(handle, body.map_id)
    if len(set(body.formats)) != len(body.formats):
        raise AppError("validation_error", "each format may be listed once", 422)
    if body.content in ("run", "run_score"):
        if not body.run_id:
            raise AppError("validation_error", "a run export needs run_id", 422)
        run, _, _ = get_run(handle, body.run_id)
        if run.map_id != gmap.id:
            raise AppError("validation_error", "the run belongs to another map", 422)
    if gmap.crs_wkt is None and set(body.formats) - {"csv"}:
        raise AppError(
            "validation_error", "this map has no coordinates: only the pixel CSV can be exported", 422
        )
    return gmap
