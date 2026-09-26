"""Measurement routes (spec §4.1 ops 8-11). Each change publishes pointclouds.changed."""

from __future__ import annotations

from fastapi import APIRouter, Depends, Request, Response

from app.events_util import publish_pointclouds_changed
from app.pointclouds import measurements
from app.pointclouds.schemas import (
    CloudMeasurementCreate,
    CloudMeasurementList,
    CloudMeasurementOut,
    CloudMeasurementUpdate,
)
from app.projects.service import ProjectHandle, get_project

sub = APIRouter()


@sub.get("/pointclouds/{cloudId}/measurements", response_model=CloudMeasurementList)
def list_cloud_measurements(
    cloudId: str, handle: ProjectHandle = Depends(get_project)
) -> CloudMeasurementList:  # noqa: N803
    return CloudMeasurementList(
        items=[CloudMeasurementOut.from_row(m) for m in measurements.list_for(handle, cloudId)]
    )


@sub.post("/pointclouds/{cloudId}/measurements", response_model=CloudMeasurementOut, status_code=201)
def create_cloud_measurement(
    cloudId: str,  # noqa: N803
    body: CloudMeasurementCreate,
    request: Request,
    handle: ProjectHandle = Depends(get_project),
) -> CloudMeasurementOut:
    row = measurements.create(handle, cloudId, body)
    publish_pointclouds_changed(request, handle, [cloudId])
    return CloudMeasurementOut.from_row(row)


@sub.patch("/pointclouds/{cloudId}/measurements/{cloudMeasurementId}", response_model=CloudMeasurementOut)
def update_cloud_measurement(
    cloudId: str,  # noqa: N803
    cloudMeasurementId: str,  # noqa: N803
    body: CloudMeasurementUpdate,
    request: Request,
    handle: ProjectHandle = Depends(get_project),
) -> CloudMeasurementOut:
    row = measurements.update(handle, cloudId, cloudMeasurementId, body)
    publish_pointclouds_changed(request, handle, [cloudId])
    return CloudMeasurementOut.from_row(row)


@sub.delete("/pointclouds/{cloudId}/measurements/{cloudMeasurementId}", status_code=204)
def delete_cloud_measurement(
    cloudId: str,  # noqa: N803
    cloudMeasurementId: str,  # noqa: N803
    request: Request,
    handle: ProjectHandle = Depends(get_project),
) -> Response:
    measurements.delete(handle, cloudId, cloudMeasurementId)
    publish_pointclouds_changed(request, handle, [cloudId])
    return Response(status_code=204)
