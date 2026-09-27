"""A drawing's footprint in the site frame: bounds_site (stored keyed by frame, M-C0's column), the
API value, and the layer version (for M-B1's layer list and the tile `v`)."""

from __future__ import annotations

import numpy as np

from app.drawings import georef as fitting
from app.drawings.site import Conversion, NotInFrame, current_frame, ring
from app.errors import AppError


def frame_or_none(handle):
    try:
        return current_frame(handle)
    except AppError:
        return None


def bbox_site(transform, conv: Conversion, extent) -> list[float]:
    e, n = conv.to_site(*fitting.apply(transform, *ring(extent)))
    e, n = np.asarray(e), np.asarray(n)
    return [float(e.min()), float(n.min()), float(e.max()), float(n.max())]


def footprint_site(drawing, frame) -> list[float] | None:
    g = drawing.georef
    if g is None or not drawing.extent_src or frame is None:
        return None
    try:
        conv = Conversion(g.get("dst_crs_wkt"), frame)
    except NotInFrame:
        return None
    return bbox_site(tuple(g["transform"]), conv, drawing.extent_src)


def bounds_site_value(drawing, frame) -> dict | None:
    """What the `bounds_site` column stores: {"frame": key, "bbox": [4]} (plan Ruling 7)."""
    bbox = footprint_site(drawing, frame)
    return None if bbox is None else {"frame": frame.key, "bbox": bbox}


def bounds_out(drawing, frame) -> list[float] | None:
    """The API's bounds_site: the cached bbox when it was made for this frame, else recomputed."""
    stored = drawing.bounds_site
    if frame is not None and isinstance(stored, dict) and stored.get("frame") == frame.key:
        return stored["bbox"]
    return footprint_site(drawing, frame)


def layer_version(drawing) -> str:
    """The tile `v`: bumped on every georef save and clear (spec §6 cache key)."""
    return str(drawing.georef_version or 0)
