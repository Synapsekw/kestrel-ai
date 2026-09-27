"""Map measurement routes (spec 2026-09-26-map-workspace §12: listMapMeasurements,
createMapMeasurement, getMapMeasurement, patchMapMeasurement, deleteMapMeasurement). Each change
publishes `map_measurements.changed {measurement_ids}`.

Contract rulings (`.superpowers/sdd/2026-09-27-maps-b4/contract-rulings.md`, binding over the
plan):
- C2: `patchMapMeasurement` has no `frame` query parameter; `service.patch` takes no `site`
  keyword, and its response always carries the stored-frame vertices only.
- C3: `listMapMeasurements` takes a single, non-repeatable `kind` query parameter, an equality
  filter passed straight to `service.list_page`.
"""

from __future__ import annotations

from typing import Literal

from fastapi import APIRouter, Depends, Query, Request, Response

from app.events_util import publish_map_measurements_changed
from app.mapmeasure import service
from app.mapmeasure.schemas import (
    MapMeasurementCreate,
    MapMeasurementKind,
    MapMeasurementOut,
    MapMeasurementPage,
    MapMeasurementPatch,
)
from app.projects.service import ProjectHandle, get_project

router = APIRouter(prefix="/projects/{projectId}", tags=["workspace"])


@router.get("/map-measurements", response_model=MapMeasurementPage)
def list_map_measurements(
    handle: ProjectHandle = Depends(get_project),
    frame: Literal["site"] | None = None,
    kind: MapMeasurementKind | None = None,
    limit: int | None = Query(None, ge=1),
    cursor: str | None = None,
) -> MapMeasurementPage:
    return service.list_page(handle, site=frame == "site", limit=limit, cursor=cursor, kind=kind)


@router.post("/map-measurements", response_model=MapMeasurementOut, status_code=201)
def create_map_measurement(
    body: MapMeasurementCreate, request: Request, handle: ProjectHandle = Depends(get_project)
) -> MapMeasurementOut:
    out = service.create(handle, body)
    publish_map_measurements_changed(request, handle, [out.id])
    return out


@router.get("/map-measurements/{mapMeasurementId}", response_model=MapMeasurementOut)
def get_map_measurement(
    mapMeasurementId: str,  # noqa: N803 - the contract's path parameter
    handle: ProjectHandle = Depends(get_project),
    frame: Literal["site"] | None = None,
) -> MapMeasurementOut:
    return service.get(handle, mapMeasurementId, site=frame == "site")


@router.patch("/map-measurements/{mapMeasurementId}", response_model=MapMeasurementOut)
def patch_map_measurement(
    mapMeasurementId: str,  # noqa: N803
    body: MapMeasurementPatch,
    request: Request,
    handle: ProjectHandle = Depends(get_project),
) -> MapMeasurementOut:
    out = service.patch(handle, mapMeasurementId, body)
    publish_map_measurements_changed(request, handle, [out.id])
    return out


@router.delete("/map-measurements/{mapMeasurementId}", status_code=204)
def delete_map_measurement(
    mapMeasurementId: str,  # noqa: N803
    request: Request,
    handle: ProjectHandle = Depends(get_project),
) -> Response:
    service.delete(handle, mapMeasurementId)
    publish_map_measurements_changed(request, handle, [mapMeasurementId])
    return Response(status_code=204)
