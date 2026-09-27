"""Drawing rows as API bodies, and the vector-tile cache."""

from __future__ import annotations

from app.db.models import Drawing
from app.drawings.footprint import bounds_out
from app.drawings.placement import VECTOR
from app.drawings.schemas import DrawingOut
from app.errors import not_found
from app.maps.tiles import TileCache

VTILES = TileCache(1024)  # keys: (project_id, drawing_id, georef_version, frame_key, z, x, y)
EMPTY_LAYER_STATE = {"hidden_layers": [], "knockout_white": False}


def to_out(d: Drawing, frame) -> DrawingOut:
    return DrawingOut(
        id=d.id,
        name=d.name,
        format=d.format,
        kind="vector" if d.format in VECTOR else "raster",
        status=d.status,
        error=d.error,
        job_id=d.job_id,
        source_path=d.source_path,
        source_size=d.source_size,
        page=d.page,
        units=d.units,
        width=d.width,
        height=d.height,
        dpi=d.dpi,
        extent_src=d.extent_src,
        layers=d.layers or [],
        georef=d.georef,
        georef_version=d.georef_version or 0,
        bounds_site=bounds_out(d, frame),
        layer_state={**EMPTY_LAYER_STATE, **(d.layer_state or {})},
        captured_on=d.captured_on,
        created_at=d.created_at,
        updated_at=d.updated_at,
    )


def require(s, drawing_id: str) -> Drawing:
    row = s.get(Drawing, drawing_id)
    if row is None:
        raise not_found("drawing", drawing_id)
    return row


def drop_caches(drawing_id: str) -> None:
    VTILES.drop_map(drawing_id)
