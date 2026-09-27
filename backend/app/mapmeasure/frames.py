"""The site frame as map measurements see it (spec 2026-09-26-map-workspace §6, M4, M5).

A local stand-in for M-B1's `app/workspace/frame.py`, which is built in parallel (plan maps-b4
ruling 3): it reads the one `map_workspace` row, which M-B1's `GET /map-workspace` creates lazily,
and converts coordinates with pyproj directly. A Transformer is built per call: pyproj
Transformers are not shared across the request threads.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Literal

import numpy as np
from pyproj import CRS, Transformer
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.db.models import MapWorkspace
from app.errors import AppError

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
    if a.kind == "local":
        return True
    return a.crs_wkt == b.crs_wkt or CRS.from_user_input(a.crs_wkt).equals(CRS.from_user_input(b.crs_wkt))


def convert_xy(xs, ys, src: SiteFrame, dst: SiteFrame) -> tuple[np.ndarray, np.ndarray]:
    xs, ys = np.asarray(xs, dtype=np.float64), np.asarray(ys, dtype=np.float64)
    if src.kind != dst.kind:
        raise FrameMismatch(f"a {src.kind} geometry cannot be shown in a {dst.kind} frame")
    if same_frame(src, dst):
        return xs, ys
    t = Transformer.from_crs(
        CRS.from_user_input(src.crs_wkt), CRS.from_user_input(dst.crs_wkt), always_xy=True
    )
    gx, gy = t.transform(xs, ys)
    return np.asarray(gx, dtype=np.float64), np.asarray(gy, dtype=np.float64)


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
    t = Transformer.from_crs(CRS.from_user_input(frame.crs_wkt), CRS.from_epsg(4326), always_xy=True)
    lon, lat = t.transform(np.asarray(xs, dtype=np.float64), np.asarray(ys, dtype=np.float64))
    return np.asarray(lon, dtype=np.float64), np.asarray(lat, dtype=np.float64)


def unit_factor(frame: SiteFrame) -> float:
    """Metres per frame unit along the first axis (1 for local metres). The site frame is projected
    (M3 replaces a geographic CRS by its UTM zone), so this is a linear unit."""
    if frame.kind == "local":
        return 1.0
    axes = CRS.from_user_input(frame.crs_wkt).axis_info
    return float(axes[0].unit_conversion_factor) if axes else 1.0
