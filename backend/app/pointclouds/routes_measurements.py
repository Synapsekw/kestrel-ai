"""Measurement routes (spec §4.1 ops 8-11). Each change publishes pointclouds.changed."""

from __future__ import annotations

from fastapi import APIRouter, Depends, Request, Response
from fastapi.responses import JSONResponse

from app.events_util import publish_pointclouds_changed
from app.pointclouds import measurements, profile, views
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
    by_id = views.measurement_views(handle, cloudId)
    return CloudMeasurementList(
        items=[
            CloudMeasurementOut.from_row(m, by_id.get(m.id)) for m in measurements.list_for(handle, cloudId)
        ]
    )


@sub.post("/pointclouds/{cloudId}/measurements", response_model=CloudMeasurementOut, status_code=201)
def create_cloud_measurement(
    cloudId: str,  # noqa: N803
    body: CloudMeasurementCreate,
    request: Request,
    handle: ProjectHandle = Depends(get_project),
) -> CloudMeasurementOut | JSONResponse:
    # C-B1: `finding_id` is checked for every kind first; C-B2's profile branch follows this line.
    measurements.require_finding(handle, cloudId, body.finding_id)
    if body.kind == "profile":
        created = profile.create_profile_measurement(
            handle, request.app.state.jobs, cloudId, body, finding_id=body.finding_id
        )
        publish_pointclouds_changed(request, handle, [cloudId])
        return JSONResponse(created.model_dump(mode="json"), status_code=202)
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
    return CloudMeasurementOut.from_row(row, views.measurement_view(handle, row.id))


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
