"""Point-cloud routes (spec §4.1 ops 1-6)."""

from __future__ import annotations

from fastapi import APIRouter, Depends, Request, Response

from app.events_util import publish_pointclouds_changed
from app.jobs.schemas import JobOut
from app.pointclouds import rows, service
from app.pointclouds.jobs_import import run_pointcloud_import  # noqa: F401 - registers pointcloud_import
from app.pointclouds.schemas import (
    PointCloudCreate,
    PointCloudFileInfo,
    PointCloudInspectRequest,
    PointCloudList,
    PointCloudOut,
    PointCloudPatch,
    PointCloudWithJob,
)
from app.projects.service import ProjectHandle, get_project

sub = APIRouter()


@sub.get("/pointclouds", response_model=PointCloudList)
def list_point_clouds(handle: ProjectHandle = Depends(get_project)) -> PointCloudList:
    return PointCloudList(items=[PointCloudOut.from_row(c) for c in service.list_clouds(handle)])


@sub.post("/pointclouds", response_model=PointCloudWithJob, status_code=202)
def create_point_cloud(
    body: PointCloudCreate, request: Request, handle: ProjectHandle = Depends(get_project)
) -> PointCloudWithJob:
    row = service.create_cloud(handle, body)
    job = request.app.state.jobs.submit(handle, "pointcloud_import", {"cloud_id": row.id, "name": row.name})
    row = service.set_job(handle, row.id, job.id)
    publish_pointclouds_changed(request, handle, [row.id])
    return PointCloudWithJob(cloud=PointCloudOut.from_row(row), job=JobOut.from_row(job, handle.id))


@sub.post("/pointclouds/inspect", response_model=PointCloudFileInfo)
def inspect_point_cloud_file(
    body: PointCloudInspectRequest, handle: ProjectHandle = Depends(get_project)
) -> PointCloudFileInfo:
    return service.inspect(handle, body.path)


@sub.get("/pointclouds/{cloudId}", response_model=PointCloudOut)
def get_point_cloud(cloudId: str, handle: ProjectHandle = Depends(get_project)) -> PointCloudOut:  # noqa: N803
    return PointCloudOut.from_row(rows.get_cloud(handle, cloudId))


@sub.patch("/pointclouds/{cloudId}", response_model=PointCloudOut)
def patch_point_cloud(
    cloudId: str,  # noqa: N803
    body: PointCloudPatch,
    request: Request,
    handle: ProjectHandle = Depends(get_project),
) -> PointCloudOut:
    row = service.patch_cloud(handle, cloudId, body)
    publish_pointclouds_changed(request, handle, [cloudId])
    return PointCloudOut.from_row(row)


@sub.delete("/pointclouds/{cloudId}", status_code=204)
def delete_point_cloud(
    cloudId: str, request: Request, handle: ProjectHandle = Depends(get_project)
) -> Response:  # noqa: N803
    service.delete_cloud(handle, cloudId, request.app.state.jobs.is_live)
    publish_pointclouds_changed(request, handle, [cloudId])
    return Response(status_code=204)
