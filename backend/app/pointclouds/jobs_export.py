"""The `pointcloud_export` job (spec §11): a LAZ plus cloud.json and measurements.csv, written into
exports/.partial-<stamp> and promoted; a cancel or a failure deletes the partial folder."""

from __future__ import annotations

import shutil
from importlib.metadata import PackageNotFoundError, version

from sqlalchemy import select

from app.db.models import CloudMeasurement
from app.exports.job import _now_local, _promote, _reserve_partial_folder
from app.jobs.registry import register_job_type
from app.jobs.runner import JobContext
from app.pointclouds import export, rows


def _app_version() -> str:
    try:
        return version("kestrel-backend")
    except PackageNotFoundError:
        return "0.1.0"


@register_job_type("pointcloud_export")
def run_pointcloud_export(ctx: JobContext) -> dict:
    p = ctx.params
    cloud = rows.require_ready(ctx.project, p["cloud_id"])
    src = export.check_source(cloud)
    base = ctx.project.exports_dir
    base.mkdir(parents=True, exist_ok=True)
    partial, stamp, n = _reserve_partial_folder(base, _now_local())
    stem = f"cloud-{export.slug(cloud.name)}"
    try:
        laz = partial / f"{stem}.laz"
        count = export.write_laz(
            src,
            laz,
            bounds=cloud.bounds_native,
            scale=cloud.scale,
            assign_epsg=cloud.epsg if cloud.crs_source == "assigned" else None,
            progress=lambda d, t: ctx.progress(
                0.95 * d / max(t, 1), f"writing {d / 1e6:.1f} / {t / 1e6:.1f} M points"
            ),
            check_cancelled=ctx.check_cancelled,
        )
        ctx.progress(0.96, "checking the LAZ")
        export.verify_laz(laz, point_count=cloud.point_count, epsg=cloud.epsg)
        files = [laz.name]
        export.write_cloud_json(partial / f"{stem}.json", cloud, _app_version())
        files.append(f"{stem}.json")
        if p.get("include_measurements", True):
            with ctx.project.session() as s:
                ms = list(
                    s.execute(
                        select(CloudMeasurement)
                        .where(CloudMeasurement.point_cloud_id == cloud.id)
                        .order_by(CloudMeasurement.created_at)
                    ).scalars()
                )
                for m in ms:
                    s.expunge(m)
            if ms:
                export.write_measurements_csv(partial / f"{stem}-measurements.csv", ms)
                files.append(f"{stem}-measurements.csv")
        ctx.check_cancelled()
        final = _promote(base, partial, stamp, n)
    except BaseException:
        shutil.rmtree(partial, ignore_errors=True)
        raise
    folder = "/".join(final.relative_to(ctx.project.folder).parts)
    ctx.progress(1.0, f"{count / 1e6:.1f} M points exported")
    return {"cloud_id": cloud.id, "folder": folder, "laz": laz.name, "files": files, "point_count": count}
