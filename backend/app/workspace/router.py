"""The map workspace (spec 2026-09-26-map-workspace sections 6, 9.4 and 12): the site frame, the
persisted view state, surveys, layers, site tiles, anchors, the readout sample and findings in view.
It loads in M-C0's maps-guarded loop at the end of app/api.py."""

from typing import Literal

from fastapi import APIRouter, Depends, Query, Request, Response
from fastapi import Path as PathParam

from app.events_util import publish_map_workspace_changed
from app.projects.service import ProjectHandle, get_project
from app.workspace import service, tiles
from app.workspace.schemas import MapWorkspaceOut, MapWorkspacePut, SiteFrameSet, workspace_out

router = APIRouter(prefix="/projects/{projectId}", tags=["workspace"])
IMMUTABLE = {"Cache-Control": "private, max-age=31536000, immutable"}
NO_STORE = {"Cache-Control": "no-store"}


@router.get("/map-workspace", response_model=MapWorkspaceOut)
def get_map_workspace(handle: ProjectHandle = Depends(get_project)) -> MapWorkspaceOut:
    return workspace_out(handle, service.load(handle))


@router.put("/map-workspace", response_model=MapWorkspaceOut)
def put_map_workspace(
    body: MapWorkspacePut, request: Request, handle: ProjectHandle = Depends(get_project)
) -> MapWorkspaceOut:
    planned = None
    if body.planned_surveys is not None:
        planned = [{"date": p.date.isoformat(), "note": p.note} for p in body.planned_surveys]
    ws = service.put_state(handle, state=body.state, planned_surveys=planned)
    publish_map_workspace_changed(
        request, handle, ["state"] + (["planned_surveys"] if planned is not None else [])
    )
    return workspace_out(handle, ws)


@router.put("/map-workspace/frame", response_model=MapWorkspaceOut)
def set_site_frame(
    body: SiteFrameSet, request: Request, handle: ProjectHandle = Depends(get_project)
) -> MapWorkspaceOut:
    ws = service.set_frame(handle, kind=body.kind, epsg=body.epsg)
    publish_map_workspace_changed(request, handle, ["frame"])
    return workspace_out(handle, ws)


@router.get("/site-tiles/{kind}/{layerId}/{z}/{x}/{y}", response_class=Response)
def get_site_tile(
    kind: Literal["map", "surface", "volume_diff", "drawing_raster"],
    layerId: str,  # noqa: N803
    x: int,
    y: int,
    z: int = PathParam(ge=0, le=20),
    v: str | None = None,
    style: Literal["hillshade", "tint", "contours"] | None = None,
    interval: float | None = Query(None, gt=0, le=1000),
    knockout: bool = False,
    t: str | None = Query(None, max_length=400),  # no pattern: a malformed `t` is invalid_preview
    frame_key: str | None = Query(None, max_length=200),  # a client-side cache-buster, ignored here
    handle: ProjectHandle = Depends(get_project),
) -> Response:
    style = tiles.TileStyle(style, interval, knockout, tiles.parse_preview(t))  # 422 invalid_preview first
    body = tiles.serve_site_tile(handle, service.get_frame(handle), kind, layerId, z, x, y, style)
    headers = NO_STORE if tiles.is_preview(kind, style) else IMMUTABLE
    if body is None:
        return Response(status_code=204, headers=headers)
    return Response(body, media_type="image/png", headers=headers)
