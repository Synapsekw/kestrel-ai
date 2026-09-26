"""The `pointcloud_import` job (spec §6): the pure pipeline, then the row."""

from __future__ import annotations

import shutil
from pathlib import Path

from app.db.models import PointCloud
from app.jobs.cancellation import JobCancelled, JobFailure
from app.jobs.registry import register_job_type
from app.jobs.runner import JobContext
from app.pointclouds.crs import bounds_wgs84
from app.pointclouds.importer import import_cloud
from app.pointclouds.rows import cloud_dir


def _fail(ctx: JobContext, cloud_id: str, message: str) -> None:
    with ctx.project.session() as s:
        row = s.get(PointCloud, cloud_id)
        if row is not None:
            row.status, row.error = "failed", message
    shutil.rmtree(cloud_dir(ctx.project, cloud_id), ignore_errors=True)
    ctx.publish("pointclouds.changed", {"cloud_ids": [cloud_id]})


@register_job_type("pointcloud_import")
def run_pointcloud_import(ctx: JobContext) -> dict:
    cloud_id = ctx.params["cloud_id"]
    with ctx.project.session() as s:
        source = Path(s.get(PointCloud, cloud_id).source_path)
    try:
        r = import_cloud(
            source,
            cloud_dir(ctx.project, cloud_id),
            progress=ctx.progress,
            check_cancelled=ctx.check_cancelled,
        )
    except JobCancelled:
        _fail(ctx, cloud_id, "import cancelled")
        raise
    except JobFailure as e:
        for line in getattr(e, "log_tail", []):  # ConverterStopped carries the converter's last lines
            ctx.log.error("converter: %s", line)
        _fail(ctx, cloud_id, str(e))
        raise
    except Exception as e:
        _fail(ctx, cloud_id, f"import failed: {type(e).__name__}: {e}")
        raise
    with ctx.project.session() as s:
        row = s.get(PointCloud, cloud_id)
        row.point_count, row.las_version, row.point_format = r.point_count, r.las_version, r.point_format
        row.has_rgb, row.scale = r.has_rgb, r.scale
        if r.crs.crs_wkt:
            row.crs_wkt, row.epsg, row.proj4, row.vertical_crs = (
                r.crs.crs_wkt,
                r.crs.epsg,
                r.crs.proj4,
                r.crs.vertical_crs,
            )
            row.crs_source, row.bounds_wgs84 = "file", r.bounds_wgs84
        elif row.crs_source == "assigned" and row.crs_wkt:
            row.bounds_wgs84 = bounds_wgs84(r.bounds_native, row.crs_wkt)
        row.bounds_native, row.bounds_repaired = r.bounds_native, r.bounds_repaired
        row.octree_spacing_m, row.octree_bytes = r.octree_spacing_m, r.octree_bytes
        row.z_stats, row.class_counts = r.z_stats, r.class_counts
        row.source_sha256, row.source_size, row.source_mtime = r.source_sha256, r.source_size, r.source_mtime
        if row.captured_on is None:  # never overwrite a date set by hand
            row.captured_on = r.captured_on
        row.status, row.error = "ready", None
    for line in r.log_tail:
        ctx.log.info("converter: %s", line)
    ctx.publish("pointclouds.changed", {"cloud_ids": [cloud_id]})
    ctx.progress(1.0, f"{r.point_count / 1e6:.1f} M points ready")
    return {
        "cloud_id": cloud_id,
        "point_count": r.point_count,
        "epsg": r.crs.epsg,
        "octree_bytes": r.octree_bytes,
        "seconds": r.seconds,
    }
