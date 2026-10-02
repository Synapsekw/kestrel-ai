"""`GET /basemap/{source}/{z}/{x}/{y}` (spec 2026-10-02-site-basemap)."""

from fastapi import APIRouter, Request, Response
from fastapi import Path as PathParam

from app.basemap.service import BasemapCache, BasemapUnavailable
from app.basemap.sources import MAX_ZOOM, SourceName
from app.errors import AppError

router = APIRouter(tags=["basemap"])
# A cached tile never changes; the browser may keep it for a week.
CACHED = {"Cache-Control": "max-age=604800"}


def _cache(request: Request) -> BasemapCache:
    state = request.app.state
    if not hasattr(state, "basemap"):
        state.basemap = BasemapCache(state.settings.data_dir, state.settings.version)
    return state.basemap


@router.get("/basemap/{source}/{z}/{x}/{y}", response_class=Response)
def get_basemap_tile(
    request: Request,
    source: SourceName,
    z: int = PathParam(ge=0, le=MAX_ZOOM),
    x: int = PathParam(ge=0),
    y: int = PathParam(ge=0),
) -> Response:
    if x >= 2**z or y >= 2**z:
        raise AppError("tile_outside_grid", f"tile {x}/{y} is outside zoom {z}'s grid", 422)
    try:
        body, media = _cache(request).tile(source, z, x, y)
    except BasemapUnavailable as e:
        raise AppError("basemap_unavailable", "The basemap server could not be reached.", 503) from e
    return Response(body, media_type=media, headers=CACHED)
