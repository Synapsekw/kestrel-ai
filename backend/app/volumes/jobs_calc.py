"""The `volume_calc` job (spec 2026-09-23-volumes §6.8): the only place volume numbers come from.

Load and snapshot the inputs, build the footprints, run the engine (which writes the diff grid),
then store `results` and rename the diff into place. A cancel or failure removes the partial diff
and puts the status back: `stale` when earlier results exist, `failed` otherwise.
"""

from __future__ import annotations

import os
import time
from datetime import UTC, datetime

from app.db.models import PointCloud, Surface, VolumeMeasurement
from app.jobs.cancellation import JobCancelled, JobFailure
from app.jobs.registry import register_job_type
from app.jobs.runner import JobContext
from app.surfaces.grid import open_surface
from app.surfaces.paths import surface_path
from app.surfaces.tiles import DIFF_TILES
from app.volumes import service
from app.volumes.engine import ENGINE_VERSION, EngineFailure, EngineInputs, measure, ring_polygon
from app.volumes.footprints import FootprintError, footprints_for, usable_runs
from app.volumes.paths import diff_path, measurement_dir


def _flight_map_ids(s, *surfaces: Surface | None) -> set[str]:
    ids = set()
    for surface in surfaces:
        cloud = s.get(PointCloud, surface.point_cloud_id) if surface and surface.point_cloud_id else None
        if cloud and cloud.map_id:
            ids.add(cloud.map_id)
    return ids


REPLACE_ATTEMPTS = 10
REPLACE_WAIT_S = 0.1


def _replace(src, dst) -> None:
    """os.replace with a short bounded retry: on Windows a tile request reading the old diff.tif
    holds it open for a moment, and the rename fails with PermissionError meanwhile."""
    for attempt in range(REPLACE_ATTEMPTS):
        try:
            os.replace(src, dst)
            return
        except PermissionError:
            if attempt == REPLACE_ATTEMPTS - 1:
                raise
            time.sleep(REPLACE_WAIT_S)


def _restore(ctx: JobContext, measurement_id: str, message: str | None) -> None:
    with ctx.project.session() as s:
        row = s.get(VolumeMeasurement, measurement_id)
        if row is None:
            return
        if row.results:
            row.status = "stale"
        else:
            row.status, row.error = "failed", message or "the calculation was cancelled"


@register_job_type("volume_calc")
def run_volume_calc(ctx: JobContext) -> dict:
    measurement_id = ctx.params["measurement_id"]
    started = time.perf_counter()
    staging = measurement_dir(ctx.project, measurement_id) / f"diff-{ctx.job_id}.tif"
    try:
        with ctx.project.session() as s:
            row = s.get(VolumeMeasurement, measurement_id)
            if row is None:
                raise JobFailure("the measurement was deleted")
            top = s.get(Surface, row.top_surface_id)
            base_surface = s.get(Surface, row.base["surface_id"]) if row.base.get("surface_id") else None
            for surface, role in ((top, "top"), (base_surface, "base")):
                if row.base["kind"] != "surface" and role == "base":
                    continue
                if surface is None or surface.status != "ready":
                    raise JobFailure(f"the {role} surface is missing or not ready")
            inputs = service.inputs_snapshot(s, row)
            refs = (
                service.surface_ref(s, top),
                service.surface_ref(s, base_surface) if base_surface else None,
            )
            flight_maps = _flight_map_ids(s, top, base_surface)
            polygon, base, masks = row.polygon_native, dict(row.base), dict(row.masks)
            alignment = dict(row.alignment or {})
            top_crs = top.crs_wkt
        runs = usable_runs(ctx.project, masks.get("detection_run_ids", []))
        footprints, truncated = footprints_for(
            ctx.project,
            runs,
            class_ids=masks.get("class_ids"),
            buffer_m=float(masks.get("buffer_m", 1.0)),
            bbox=ring_polygon(polygon).bounds,
            surface_crs_wkt=top_crs,
        )
        if truncated:
            raise JobFailure(
                "more than 20 000 detections fall in the measurement area; untick some runs or classes"
            )
        extra = []
        other = sorted({gmap.name for _, gmap, _ in runs if gmap.id not in flight_maps})
        if other:
            extra.append(
                {
                    "code": "mask_other_flight",
                    "severity": "warn",
                    "message": f"detections from another flight ({', '.join(other)}): "
                    "machines move between flights",
                }
            )
        staging.parent.mkdir(parents=True, exist_ok=True)
        base_reader = open_surface(surface_path(ctx.project, base_surface.id)) if base_surface else None
        try:
            with open_surface(surface_path(ctx.project, refs[0]["id"])) as top_reader:
                numbers = measure(
                    EngineInputs(
                        polygon=polygon,
                        top=top_reader,
                        base_kind=base["kind"],
                        base_z=base.get("z"),
                        base=base_reader,
                        footprints=[f.polygon for f in footprints],
                        exclusions=[(e["ring"], e["mode"]) for e in masks.get("exclusion_polygons", [])],
                        stable_polygon=alignment.get("stable_polygon"),
                        apply_shift=bool(alignment.get("apply_shift")),
                        extra_warnings=extra,
                        diff_path=staging,
                        progress=ctx.progress,
                        check_cancelled=ctx.check_cancelled,
                    )
                )
        finally:
            if base_reader:
                base_reader.close()
    except (EngineFailure, FootprintError) as e:
        staging.unlink(missing_ok=True)
        staging.with_name(staging.name + ".partial").unlink(missing_ok=True)
        _restore(ctx, measurement_id, str(e))
        ctx.publish("volumes.changed", {"measurement_ids": [measurement_id]})
        raise JobFailure(str(e)) from e
    except BaseException as e:
        staging.unlink(missing_ok=True)
        staging.with_name(staging.name + ".partial").unlink(missing_ok=True)
        _restore(ctx, measurement_id, None if isinstance(e, JobCancelled) else str(e))
        ctx.publish("volumes.changed", {"measurement_ids": [measurement_id]})
        raise
    results = {
        **numbers,
        "top_surface": refs[0],
        "base_surface": refs[1],
        "inputs": inputs,
        "inputs_fingerprint": service.fingerprint(inputs),
        "engine_version": ENGINE_VERSION,
        "computed_at": datetime.now(UTC).isoformat(),
        "duration_s": round(time.perf_counter() - started, 2),
    }
    # the diff lands before the numbers: if it cannot, the old results and the old diff still agree
    try:
        _replace(staging, diff_path(ctx.project, measurement_id))
    except BaseException as e:
        staging.unlink(missing_ok=True)
        _restore(ctx, measurement_id, f"the cut/fill grid could not be saved: {e}")
        ctx.publish("volumes.changed", {"measurement_ids": [measurement_id]})
        raise JobFailure(f"the cut/fill grid could not be saved: {e}") from e
    with ctx.project.session() as s:
        row = s.get(VolumeMeasurement, measurement_id)
        if row is None:  # deleted while calculating is refused, but never leave a stray diff behind
            diff_path(ctx.project, measurement_id).unlink(missing_ok=True)
            raise JobFailure("the measurement was deleted")
        row.results, row.status, row.error = results, "ready", None
        row.alignment = {**(row.alignment or {}), "measured": numbers["alignment"]}
    DIFF_TILES.drop_map(measurement_id)
    ctx.publish("volumes.changed", {"measurement_ids": [measurement_id]})
    return {"measurement_id": measurement_id, "net_m3": numbers["net_m3"]}
