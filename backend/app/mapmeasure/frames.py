"""The site frame as map measurements see it (spec 2026-09-26-map-workspace §6, M4, M5).

It reads the one `map_workspace` row, which M-B1's `GET /map-workspace` creates lazily, so the 409
`no_site_frame` and the frame-kind check (`FrameMismatch`, 409 `not_in_site_frame`) stay here.
The CRS-to-CRS work is M-B1's `app.workspace.frame`, whose Transformer cache is per thread
(pyproj Transformers are not thread-safe), so a site-frame list does not rebuild one per row.
"""

from __future__ import annotations

from dataclasses import dataclass
from functools import lru_cache
from typing import Literal

import numpy as np
from pyproj import CRS
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.db.models import MapWorkspace
from app.errors import AppError
from app.workspace import frame as b1

FrameKind = Literal["crs", "local"]


class FrameMismatch(ValueError):
    """A local-metres geometry cannot be placed in a CRS frame, nor the reverse."""


@dataclass(frozen=True)
class SiteFrame:
    kind: FrameKind
    crs_wkt: str | None
    epsg: int | None

    @classmethod
    def local(cls) -> SiteFrame:
        return cls("local", None, None)


def frame_of(crs_wkt: str | None, epsg: int | None) -> SiteFrame:
    return SiteFrame("crs", crs_wkt, epsg) if crs_wkt else SiteFrame.local()


def current_site_frame(s: Session) -> SiteFrame | None:
    row = s.execute(select(MapWorkspace)).scalars().first()
    if row is None:
        return None
    if row.frame_kind == "local" or not row.crs_wkt:
        return SiteFrame.local()
    return SiteFrame("crs", row.crs_wkt, row.epsg)


def require_site_frame(s: Session) -> SiteFrame:
    frame = current_site_frame(s)
    if frame is None:
        raise AppError("no_site_frame", "the Maps workspace has no site frame yet; open Maps first", 409)
    return frame


def same_frame(a: SiteFrame, b: SiteFrame) -> bool:
    if a.kind != b.kind:
        return False
    return a.kind == "local" or b1.same_crs(a.crs_wkt, b.crs_wkt)


def convert_xy(xs, ys, src: SiteFrame, dst: SiteFrame) -> tuple[np.ndarray, np.ndarray]:
    xs, ys = np.asarray(xs, dtype=np.float64), np.asarray(ys, dtype=np.float64)
    if src.kind != dst.kind:
        raise FrameMismatch(f"a {src.kind} geometry cannot be shown in a {dst.kind} frame")
    if same_frame(src, dst):
        return xs, ys
    # not strict: a coordinate pyproj cannot project becomes a NaN gap, never a 422
    return b1.transform_xy(src.crs_wkt, dst.crs_wkt, xs, ys, strict=False)


def convert_vertices(vertices: list, src: SiteFrame, dst: SiteFrame) -> list[list[float]]:
    """`[[x, y], ...]` from `src` to `dst` (FrameMismatch on differing kinds); the same list
    object when the frames are the same."""
    if src.kind == dst.kind and same_frame(src, dst):
        return vertices
    a = np.asarray(vertices, dtype=np.float64).reshape(-1, 2)
    gx, gy = convert_xy(a[:, 0], a[:, 1], src, dst)
    return [[float(x), float(y)] for x, y in zip(gx, gy, strict=True)]


def to_lonlat(xs, ys, frame: SiteFrame) -> tuple[np.ndarray, np.ndarray]:
    if frame.kind != "crs":
        raise FrameMismatch("a local-metres frame has no longitude and latitude")
    # transform_xy, not crs_to_wgs84: that one is strict (422 on inf) and returns lists
    return b1.transform_xy(frame.crs_wkt, b1.WGS84, xs, ys, strict=False)


def unit_factor(frame: SiteFrame) -> float:
    """Metres per frame unit along the first axis (1 for local metres). The site frame is projected
    (M3 replaces a geographic CRS by its UTM zone), so this is a linear unit."""
    if frame.kind == "local":
        return 1.0
    return _crs_unit_factor(frame.crs_wkt)


@lru_cache(maxsize=64)
def _crs_unit_factor(crs_wkt: str) -> float:
    # caches a float per WKT string (safe across threads), not a pyproj object
    axes = CRS.from_user_input(crs_wkt).axis_info
    return float(axes[0].unit_conversion_factor) if axes else 1.0
