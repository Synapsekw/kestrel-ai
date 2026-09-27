"""Cross-section profiles (spec 2026-09-26-point-cloud-workspace sections 8.2, 8.4, 12 rows 8-10).

The service side of the `pointcloud_profile` job: the create seam `createCloudMeasurement` calls for
kind `profile`, retry, the stored file and the row settlement. The cut itself is `profile_cut.py`,
the job `jobs_profile.py`. Plan 2026-09-27-clouds-b2.
"""

from __future__ import annotations

import json
import math
import os
import re
from datetime import UTC, datetime
from pathlib import Path

import numpy as np
from pyproj import CRS
from sqlalchemy import func, select

from app.db.models import CloudMeasurement, Job, PointCloud
from app.errors import AppError
from app.jobs.runner import JobRunner
from app.jobs.schemas import JobOut
from app.pointclouds import measurements, rows
from app.pointclouds.profile_cut import ProfileCut
from app.pointclouds.schemas import CloudMeasurementCreate, CloudMeasurementOut, CloudMeasurementWithJob
from app.projects.service import ProjectHandle

LABEL = "Cross-section"
DEFAULT_THICKNESS_M = 0.20
DEFAULT_MAX_POINTS = 200_000
MIN_LENGTH_M, MAX_LENGTH_M = 0.1, 2000.0
JOB_TYPE = "pointcloud_profile"
INTERRUPTED = "interrupted by application restart; save the profile again"
CANCELLED = "profile cancelled; retry to cut it again"
DELETED = "the cross-section was deleted before its profile was ready"
CLOUD_DELETED = "the point cloud was deleted"
FILE_VERSION = 1


def profiles_dir(handle: ProjectHandle, cloud_id: str) -> Path:
    return rows.cloud_dir(handle, cloud_id) / "profiles"


def profile_path(handle: ProjectHandle, cloud_id: str, measurement_id: str) -> Path:
    return profiles_dir(handle, cloud_id) / f"{measurement_id}.json"


def partial_path(handle: ProjectHandle, cloud_id: str, measurement_id: str) -> Path:
    return profiles_dir(handle, cloud_id) / f"{measurement_id}.partial"


def _check_line(cloud, a: dict, b: dict, thickness: float) -> float:
    length = math.hypot(b["x"] - a["x"], b["y"] - a["y"])
    if not MIN_LENGTH_M <= length <= MAX_LENGTH_M:
        raise AppError(
            "profile_out_of_range",
            f"a cross-section line must be 0.1 to 2 000 m long; this one is {length:.2f} m",
            422,
        )
    if cloud.bounds_native:
        minx, miny, _, maxx, maxy, _ = cloud.bounds_native
        half = thickness / 2
        if (
            max(a["x"], b["x"]) < minx - half
            or min(a["x"], b["x"]) > maxx + half
            or max(a["y"], b["y"]) < miny - half
            or min(a["y"], b["y"]) > maxy + half
        ):
            raise AppError("profile_out_of_range", "the cross-section line is outside the point cloud", 422)
    return length


def _next_name(s, cloud_id: str) -> str:
    pattern = re.compile(rf"^{re.escape(LABEL)} (\d+)$")
    names = s.execute(
        select(CloudMeasurement.name).where(
            CloudMeasurement.point_cloud_id == cloud_id, CloudMeasurement.kind == "profile"
        )
    ).scalars()
    numbers = [int(m.group(1)) for n in names if (m := pattern.match(n))]
    return f"{LABEL} {max(numbers, default=0) + 1}"


def _write_job_id(handle: ProjectHandle, measurement_id: str, job_id: str) -> None:
    with handle.session() as s:
        row = s.get(CloudMeasurement, measurement_id)
        if row is not None and row.job_id is None:
            row.job_id = job_id


def create_profile_measurement(
    handle: ProjectHandle,
    runner: JobRunner,
    cloud_id: str,
    body: CloudMeasurementCreate,
    *,
    finding_id: str | None = None,
) -> CloudMeasurementWithJob:
    """Validate a `profile` create, insert the row at `status: computing`, submit its job.

    Raises AppError: 404 not_found (cloud), 409 not_ready, 422 wrong_point_count,
    needs_projected_crs, profile_out_of_range, measurement_limit. Never publishes and never
    validates `finding_id` (the caller does both; plan Ruling 1)."""
    cloud = rows.require_ready(handle, cloud_id)
    if len(body.points) != 2:
        raise AppError("wrong_point_count", "a cross-section needs 2 points (the line A, B)", 422)
    if cloud.crs_wkt and CRS.from_wkt(cloud.crs_wkt).is_geographic:
        raise AppError(
            "needs_projected_crs",
            "distances need a projected coordinate system; this cloud is in degrees",
            422,
        )
    a, b = (p.model_dump() for p in body.points)
    b["z"] = a["z"]  # the section line is horizontal (section 8.3, plan Ruling 3)
    given = body.params.model_dump(exclude_none=True) if body.params else {}
    params = {
        "thickness_m": given.get("thickness_m", DEFAULT_THICKNESS_M),
        "max_points": given.get("max_points", DEFAULT_MAX_POINTS),
    }
    _check_line(cloud, a, b, params["thickness_m"])
    with handle.session() as s:
        count = s.execute(
            select(func.count())
            .select_from(CloudMeasurement)
            .where(CloudMeasurement.point_cloud_id == cloud_id)
        ).scalar_one()
        if count >= measurements.MAX_PER_CLOUD:
            raise AppError(
                "measurement_limit", "this cloud already has 1 000 measurements; delete some first", 422
            )
        row = CloudMeasurement(
            point_cloud_id=cloud_id,
            kind="profile",
            name=body.name or _next_name(s, cloud_id),
            note=body.note,
            points=[a, b],
            results={},
            params=params,
            status="computing",
            error=None,
            job_id=None,
            finding_id=finding_id,
        )
        s.add(row)
        s.flush()
        s.expunge(row)
    job = runner.submit(handle, JOB_TYPE, {"cloud_id": cloud_id, "measurement_id": row.id})
    _write_job_id(handle, row.id, job.id)
    row.job_id = job.id  # the answer shows the row as created: computing, with its job
    return CloudMeasurementWithJob(
        measurement=CloudMeasurementOut.from_row(row), job=JobOut.from_row(job, handle.id)
    )


def retry_profile(handle: ProjectHandle, runner: JobRunner, cloud_id: str, measurement_id: str) -> Job:
    """Run the job again for a `failed` profile (section 12 row 9); 409 `not_retryable` otherwise."""
    rows.require_ready(handle, cloud_id)
    with handle.session() as s:
        row = measurements._get(s, cloud_id, measurement_id)
        if row.kind != "profile" or row.status != "failed":
            raise AppError("not_retryable", "only a failed cross-section profile can be retried", 409)
        row.status, row.error, row.job_id = "computing", None, None
        row.updated_at = datetime.now(UTC)
    job = runner.submit(handle, JOB_TYPE, {"cloud_id": cloud_id, "measurement_id": measurement_id})
    _write_job_id(handle, measurement_id, job.id)
    return job


def _settleable(row: CloudMeasurement | None, job_id: str) -> bool:
    """A stale job never writes over a newer run (plan Ruling 11); a null job_id is the create's own
    job before `_write_job_id` ran (Review Focus 1)."""
    return row is not None and row.kind == "profile" and row.job_id in (None, job_id)


def load_profile_row(handle: ProjectHandle, cloud_id: str, measurement_id: str) -> CloudMeasurement | None:
    with handle.session() as s:
        row = s.get(CloudMeasurement, measurement_id)
        if row is None or row.point_cloud_id != cloud_id:
            return None
        s.expunge(row)
    return row


def write_profile_file(
    handle: ProjectHandle, cloud: PointCloud, row: CloudMeasurement, cut: ProfileCut
) -> Path:
    """`profiles/<id>.partial`, then renamed to `<id>.json` (section 8.4 step 4)."""
    params = row.params or {}
    final = profile_path(handle, cloud.id, row.id)
    partial = partial_path(handle, cloud.id, row.id)
    final.parent.mkdir(parents=True, exist_ok=True)
    body = {
        "s": np.round(cut.s.astype(np.float64), 3).tolist(),
        "z": np.round(cut.z.astype(np.float64), 3).tolist(),
        "rgb": None if cut.rgb is None else cut.rgb.reshape(-1).tolist(),
        "count": cut.count,
        "thickness_m": params.get("thickness_m", DEFAULT_THICKNESS_M),
        "length_m": cut.length_m,
    }
    header = {
        "version": FILE_VERSION,
        "cloud_id": cloud.id,
        "measurement_id": row.id,
        "line": row.points,
        "thickness_m": body["thickness_m"],
        "max_points": params.get("max_points", DEFAULT_MAX_POINTS),
        "length_m": cut.length_m,
        "cell_m": cut.cell_m,
        "scanned": cut.scanned,
        "source_path": cloud.source_path,
        "source_sha256": cloud.source_sha256,
        "cut_at": datetime.now(UTC).isoformat(),
    }
    with partial.open("w", encoding="utf-8") as f:
        json.dump({"header": header, "profile": body}, f, separators=(",", ":"))
    os.replace(partial, final)
    return final


def mark_ready(handle: ProjectHandle, measurement_id: str, job_id: str, results: dict) -> bool:
    with handle.session() as s:
        row = s.get(CloudMeasurement, measurement_id)
        if not _settleable(row, job_id):
            return False
        row.results = {**(row.results or {}), **results}
        row.status, row.error = "ready", None
        row.updated_at = datetime.now(UTC)
    return True


def mark_failed(handle: ProjectHandle, measurement_id: str, job_id: str, message: str) -> bool:
    with handle.session() as s:
        row = s.get(CloudMeasurement, measurement_id)
        if not _settleable(row, job_id):
            return False
        row.status, row.error = "failed", message
        row.updated_at = datetime.now(UTC)
    return True


def read_profile_body(handle: ProjectHandle, cloud_id: str, measurement_id: str) -> bytes:
    """The stored `CloudProfile` JSON (section 12 row 10): 404 for another kind or a missing file,
    409 `not_ready` while computing or after a failure (plan Ruling 16)."""
    rows.get_cloud(handle, cloud_id)
    with handle.session() as s:
        row = measurements._get(s, cloud_id, measurement_id)
        s.expunge(row)
    if row.kind != "profile":
        raise AppError("not_found", f"measurement {measurement_id} has no profile", 404)
    if row.status == "computing":
        raise AppError("not_ready", "the profile is still being cut", 409)
    if row.status == "failed":
        raise AppError("not_ready", f"the profile failed: {row.error}", 409)
    try:
        data = json.loads(profile_path(handle, cloud_id, measurement_id).read_text("utf-8"))
        body = data["profile"]
    except (OSError, ValueError, KeyError):
        raise AppError("not_found", f"profile file {measurement_id} not found", 404) from None
    return json.dumps(body, separators=(",", ":")).encode("utf-8")
