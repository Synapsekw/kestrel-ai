"""The drone photos near a cloud and their height offsets (spec 2026-09-26-point-cloud-workspace
section 12 rows 11-12). The logic is in `cameras.py`."""

from __future__ import annotations

from fastapi import APIRouter, Depends

from app.pointclouds import cameras
from app.pointclouds.schemas import CloudCameraSet
from app.projects.service import ProjectHandle, get_project

sub = APIRouter()


@sub.get("/pointclouds/{cloudId}/cameras", response_model=CloudCameraSet)
def get_cloud_cameras(cloudId: str, handle: ProjectHandle = Depends(get_project)) -> CloudCameraSet:  # noqa: N803
    return cameras.camera_set(handle, cloudId)
