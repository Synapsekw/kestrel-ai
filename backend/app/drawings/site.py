"""The site frame and the site tile grid, as the drawings package sees them (spec §6).

M-B1 owns both (app/workspace/frame.py + service.get_frame, app/workspace/grid.py): `res`,
`tile_bounds` and `current_frame` are delegations to M-B1 since plan task 16 (imported inside the
functions, so this module stays light). `Frame` stays for tests and the local-frame literal; B1's
SiteFrame has the same `kind`, `crs_wkt`, `epsg` and `key`, and `frame_unit_m` and `Conversion` take
either. Nothing else in app.drawings imports app.workspace, except raster_source's registration.
"""

from __future__ import annotations

import hashlib
from dataclasses import dataclass
from typing import Literal

import numpy as np
from pyproj import CRS, Transformer

from app.surfaces.design.units import UnsupportedCrsUnit, crs_axis_unit, unit_to_m

TILE = 256
Z_MAX = 20


@dataclass(frozen=True)
class Frame:
    """The same three facts as M-B1's SiteFrame (which Task 16 returns instead)."""

    kind: Literal["crs", "local"]
    crs_wkt: str | None
    epsg: int | None

    @property
    def key(self) -> str:
        if self.kind == "local":
            return "local"
        if self.epsg is not None:
            return f"epsg:{self.epsg}"
        return "wkt:" + hashlib.sha1((self.crs_wkt or "").encode()).hexdigest()[:12]


def crs_unit_m(crs_wkt: str | None) -> float:
    """Metres per CRS axis unit (1.0 for None/local, or an unknown unit; ruling F15)."""
    if crs_wkt is None:
        return 1.0
    try:
        return unit_to_m(crs_axis_unit(CRS.from_wkt(crs_wkt)))
    except UnsupportedCrsUnit:
        return 1.0


def frame_unit_m(frame) -> float:
    """Metres per frame unit (1.0 for a local frame or an unknown unit)."""
    if frame.kind == "local":
        return 1.0
    return crs_unit_m(frame.crs_wkt)


class NotInFrame(Exception):
    """A drawing placed in a CRS shown in a local frame, or the reverse (spec §6)."""


def res(z: int) -> float:  # M-B1: app.workspace.grid
    from app.workspace import grid

    return grid.res(z)


def tile_bounds(z: int, x: int, y: int) -> tuple[float, float, float, float]:  # M-B1: app.workspace.grid
    from app.workspace import grid

    return tuple(grid.tile_bounds(z, x, y))


def ring(bbox, n: int = 16) -> tuple[np.ndarray, np.ndarray]:
    """The rectangle's outline with n points per edge (a CRS change bends straight edges)."""
    x0, y0, x1, y1 = bbox
    t = np.linspace(0.0, 1.0, n, endpoint=False)
    xs = np.concatenate([x0 + (x1 - x0) * t, np.full(n, x1), x1 - (x1 - x0) * t, np.full(n, x0)])
    ys = np.concatenate([np.full(n, y0), y0 + (y1 - y0) * t, np.full(n, y1), y1 - (y1 - y0) * t])
    return xs, ys


def current_frame(handle):  # M-B1: the project's SiteFrame, created lazily (rule M3)
    from app.workspace.service import get_frame

    return get_frame(handle)


class Conversion:
    """Between one drawing's destination CRS and the site frame (a Frame or B1's SiteFrame)."""

    def __init__(self, dst_crs_wkt: str | None, frame):
        if frame.kind == "local" or dst_crs_wkt is None:
            if frame.kind != "local" or dst_crs_wkt is not None:
                raise NotInFrame()
            self.identity, self._fwd, self._inv = True, None, None
            return
        src, dst = CRS.from_wkt(dst_crs_wkt), CRS.from_wkt(frame.crs_wkt)
        self.identity = src.equals(dst)
        self._fwd = None if self.identity else Transformer.from_crs(src, dst, always_xy=True)
        self._inv = None if self.identity else Transformer.from_crs(dst, src, always_xy=True)

    def to_site(self, x, y):
        return (x, y) if self.identity else self._fwd.transform(x, y)

    def from_site(self, e, n):
        return (e, n) if self.identity else self._inv.transform(e, n)
