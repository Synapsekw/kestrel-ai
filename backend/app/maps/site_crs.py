"""Site-frame coordinates into an item's own CRS (map workspace spec §6, decisions M4 and M5).

The workspace draws in one site frame (the `map_workspace` row); every write stores geometry in the
item's own CRS. The conversion itself is M-B1's `app.workspace.frame.points_from_site`; this module
only reads the frame inside the caller's session and words the refusals as the volume and region
writes answer them: 422 `invalid_geometry` (not frame.py's `no_coordinates`).

Unlike `app.workspace.service.get_frame`, a write never creates the workspace row: before Maps has
opened once there is no site frame the operator could have drawn in, so the write is refused.
"""

from __future__ import annotations

from collections.abc import Sequence

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.db.models import MapWorkspace
from app.errors import AppError
from app.workspace.frame import LOCAL, SiteFrame, points_from_site


def _invalid(message: str) -> AppError:
    return AppError("invalid_geometry", message, 422)


def site_frame(s: Session) -> SiteFrame:
    """The workspace's site frame; 422 before Maps has ever opened (no row yet)."""
    row = s.execute(select(MapWorkspace).limit(1)).scalar_one_or_none()
    if row is None:
        raise _invalid("The map workspace has no site frame yet: open Maps once, then draw again.")
    if row.frame_kind == "local" or not row.crs_wkt:
        return LOCAL
    return SiteFrame("crs", row.crs_wkt, row.epsg)


def site_to_crs(s: Session, points: Sequence[Sequence[float]], target_wkt: str | None) -> list[list[float]]:
    """`points` (site frame) in the CRS `target_wkt`; None means the item has local coordinates. A
    local item takes points from the local frame unchanged; mixing local and georeferenced is 422."""
    frame = site_frame(s)
    if not frame.holds(target_wkt):
        if target_wkt:
            raise _invalid("This item is georeferenced but the workspace is in local metres.")
        raise _invalid("This item has local coordinates; switch the workspace to local metres to draw on it.")
    try:
        return points_from_site(frame, target_wkt, points)
    except AppError as e:
        if e.code != "no_coordinates":
            raise
        raise _invalid("The polygon falls outside the item's coordinate system.") from None
