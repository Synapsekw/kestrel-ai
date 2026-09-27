"""The drone photos near a cloud and their height offsets (spec 2026-09-26-point-cloud-workspace
section 12 rows 11-12). The logic is in `cameras.py`."""

from __future__ import annotations

from fastapi import APIRouter, Depends, Request

from app.events_util import publish_pointclouds_changed
from app.pointclouds import cameras
from app.pointclouds.schemas import CloudCameraOffsetPut, CloudCameraSet, CloudCameraSource
from app.projects.service import ProjectHandle, get_project

sub = APIRouter()


@sub.get("/pointclouds/{cloudId}/cameras", response_model=CloudCameraSet)
def get_cloud_cameras(cloudId: str, handle: ProjectHandle = Depends(get_project)) -> CloudCameraSet:  # noqa: N803
    return cameras.camera_set(handle, cloudId)


@sub.put("/pointclouds/{cloudId}/cameras/offsets/{sourceId}", response_model=CloudCameraSource)
def set_cloud_camera_offset(
    cloudId: str,  # noqa: N803
    sourceId: str,  # noqa: N803
    body: CloudCameraOffsetPut,
    request: Request,
    handle: ProjectHandle = Depends(get_project),
) -> CloudCameraSource:
    out = cameras.set_offset(handle, cloudId, sourceId, body.height_offset_m)
    publish_pointclouds_changed(request, handle, [cloudId])
    return out
