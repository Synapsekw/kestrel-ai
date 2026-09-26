"""POST /pointclouds/{cloudId}/exports (spec §4.1 op 12): 202 with the job."""

from __future__ import annotations

from fastapi import APIRouter, Depends, Request

from app.jobs.schemas import JobOut
from app.pointclouds import rows
from app.pointclouds.jobs_export import run_pointcloud_export  # noqa: F401 - registers pointcloud_export
from app.pointclouds.schemas import PointCloudExportRequest
from app.projects.service import ProjectHandle, get_project
from app.training.schemas import JobRef

sub = APIRouter()


@sub.post("/pointclouds/{cloudId}/exports", response_model=JobRef, status_code=202)
def create_point_cloud_export(
    cloudId: str,  # noqa: N803
    body: PointCloudExportRequest,
    request: Request,
    handle: ProjectHandle = Depends(get_project),
) -> JobRef:
    cloud = rows.require_ready(handle, cloudId)
    job = request.app.state.jobs.submit(
        handle,
        "pointcloud_export",
        {
            "cloud_id": cloud.id,
            "name": cloud.name,
            "format": body.format,
            "include_measurements": body.include_measurements,
        },
    )
    return JobRef(job=JobOut.from_row(job, handle.id))
