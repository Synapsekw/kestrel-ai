"""The `surface_build` job (spec 2026-09-23-volumes §5): wraps `build.build_surface` with the row.

Cancel deletes the row and its folder (nothing half-built is left to explain); a failure keeps the
row as `failed` with a readable error; `.build/` is removed in every outcome.
"""

from __future__ import annotations

import shutil

from app.db.models import PointCloud, Surface
from app.jobs.cancellation import JobCancelled, JobFailure
from app.jobs.registry import register_job_type
from app.jobs.runner import JobContext
from app.surfaces import build, service
from app.surfaces.build import BuildRejected
from app.surfaces.paths import build_dir, surface_dir, surface_path

CLOUD_GONE = "the point cloud was deleted before the build started"


def _fail(ctx: JobContext, surface_id: str, message: str) -> None:
    with ctx.project.session() as s:
        row = s.get(Surface, surface_id)
        if row is not None:
            row.status, row.error = "failed", message


@register_job_type("surface_build")
def run_surface_build(ctx: JobContext) -> dict:
    surface_id = ctx.params["surface_id"]
    with ctx.project.session() as s:
        row = s.get(Surface, surface_id)
        if row is None:
            raise JobFailure("the surface was deleted before its build started")
        cloud = s.get(PointCloud, row.point_cloud_id) if row.point_cloud_id else None
        params = dict(row.build_params)
        src = service.cloud_source(cloud) if cloud is not None else None
    if src is None:  # the row must not stay `building` until the next restart's sweep
        _fail(ctx, surface_id, CLOUD_GONE)
        ctx.publish("surfaces.changed", {"surface_ids": [surface_id]})
        raise JobFailure(CLOUD_GONE)
    work = build_dir(ctx.project, surface_id)
    try:
        result = build.build_surface(
            src,
            service.build_params(params),
            surface_path(ctx.project, surface_id),
            work,
            progress=ctx.progress,
            check_cancelled=ctx.check_cancelled,
        )
    except JobCancelled:
        with ctx.project.session() as s:
            row = s.get(Surface, surface_id)
            if row is not None:
                s.delete(row)
        shutil.rmtree(surface_dir(ctx.project, surface_id), ignore_errors=True)
        ctx.publish("surfaces.changed", {"surface_ids": [surface_id]})
        raise
    except BuildRejected as e:
        _fail(ctx, surface_id, e.message)
        ctx.publish("surfaces.changed", {"surface_ids": [surface_id]})
        raise JobFailure(e.message) from e
    except Exception as e:
        _fail(ctx, surface_id, f"the build failed: {e}")
        ctx.publish("surfaces.changed", {"surface_ids": [surface_id]})
        raise
    finally:
        shutil.rmtree(work, ignore_errors=True)
    spec, stats = result.spec, result.stats
    with ctx.project.session() as s:
        row = s.get(Surface, surface_id)
        row.status, row.error = "ready", None
        row.crs_wkt, row.epsg = spec.crs_wkt, spec.epsg
        row.cell_size_m, row.width, row.height = spec.cell_size, spec.width, spec.height
        row.geotransform = list(spec.geotransform)
        row.bounds_native = list(spec.bounds)
        row.z_min, row.z_max, row.coverage_fraction = stats.z_min, stats.z_max, stats.coverage_fraction
        row.method = params["method"]
        row.build_params = {**params, "cell_size_m": result.cell_size_m, "auto_cell": result.auto_cell}
        row.stats = result.build_stats
    ctx.publish("surfaces.changed", {"surface_ids": [surface_id]})
    return {
        "surface_id": surface_id,
        "cell_size_m": spec.cell_size,
        "coverage_fraction": stats.coverage_fraction,
    }
