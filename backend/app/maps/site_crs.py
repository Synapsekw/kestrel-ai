"""Site-frame coordinates into an item's own CRS (map workspace spec §6, decisions M4 and M5).

The workspace draws in one site frame (the `map_workspace` row); every write stores geometry in the
item's own CRS. This is the pyproj conversion M-B5 needs, built while M-B1's
`app/workspace/frame.py` is built in parallel: the same maths, reading the same row. A later change
may point callers at frame.py; the behaviour does not change.
"""

from __future__ import annotations

import math
from collections.abc import Sequence

from pyproj import CRS, Transformer
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.db.models import MapWorkspace
from app.errors import AppError


def _invalid(message: str) -> AppError:
    return AppError("invalid_geometry", message, 422)


def site_frame(s: Session) -> tuple[str, str | None]:
    """`(frame_kind, crs_wkt)` of the workspace; 422 before Maps has ever opened (no row yet)."""
    row = s.execute(select(MapWorkspace).limit(1)).scalar_one_or_none()
    if row is None:
        raise _invalid("The map workspace has no site frame yet: open Maps once, then draw again.")
    return row.frame_kind, row.crs_wkt


def site_to_crs(s: Session, points: Sequence[Sequence[float]], target_wkt: str | None) -> list[list[float]]:
    """`points` (site frame) in the CRS `target_wkt`; None means the item has local coordinates. A
    local item takes points from the local frame unchanged; mixing local and georeferenced is 422."""
    kind, site_wkt = site_frame(s)
    if kind == "local" or not site_wkt:
        if target_wkt:
            raise _invalid("This item is georeferenced but the workspace is in local metres.")
        return [[float(p[0]), float(p[1])] for p in points]
    if not target_wkt:
        raise _invalid("This item has local coordinates; switch the workspace to local metres to draw on it.")
    t = Transformer.from_crs(CRS.from_user_input(site_wkt), CRS.from_user_input(target_wkt), always_xy=True)
    xs, ys = t.transform([float(p[0]) for p in points], [float(p[1]) for p in points])
    out = [[float(x), float(y)] for x, y in zip(xs, ys, strict=True)]
    if not all(math.isfinite(v) for p in out for v in p):
        raise _invalid("The polygon falls outside the item's coordinate system.")
    return out
