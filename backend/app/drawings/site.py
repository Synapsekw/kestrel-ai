"""The site frame and the site tile grid, as the drawings package sees them (spec §6).

M-B1 owns both (app/workspace/frame.py + service.get_frame, app/workspace/grid.py). Until M-B1 is on
main this module carries a local copy of exactly what drawings need, pinned by M-C0's
contract/fixtures/site-grid-vectors.json; the three bodies marked `B1-SWAP` become B1 delegations in
plan task 16. Nothing else in app.drawings imports app.workspace.
"""

from __future__ import annotations

import hashlib
from dataclasses import dataclass
from typing import Literal

import numpy as np
from pyproj import CRS, Transformer
from sqlalchemy import select

from app.errors import AppError
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


def res(z: int) -> float:  # B1-SWAP: app.workspace.grid.res
    if not 0 <= z <= Z_MAX:
        raise ValueError(f"zoom {z} is outside 0..{Z_MAX}")
    return 1024.0 / 2**z


def tile_bounds(z: int, x: int, y: int) -> tuple[float, float, float, float]:  # B1-SWAP: grid.tile_bounds
    span = TILE * res(z)
    return (x * span, -(y + 1) * span, (x + 1) * span, -y * span)


def ring(bbox, n: int = 16) -> tuple[np.ndarray, np.ndarray]:
    """The rectangle's outline with n points per edge (a CRS change bends straight edges)."""
    x0, y0, x1, y1 = bbox
    t = np.linspace(0.0, 1.0, n, endpoint=False)
    xs = np.concatenate([x0 + (x1 - x0) * t, np.full(n, x1), x1 - (x1 - x0) * t, np.full(n, x0)])
    ys = np.concatenate([np.full(n, y0), y0 + (y1 - y0) * t, np.full(n, y1), y1 - (y1 - y0) * t])
    return xs, ys


def current_frame(handle):  # B1-SWAP: app.workspace.service.get_frame (creates the frame, rule M3)
    from app.db.models import MapWorkspace

    with handle.session() as s:
        row = s.execute(select(MapWorkspace)).scalars().first()
        if row is None:
            raise AppError(
                "no_site_frame", "Open the map workspace once so the project has a site frame.", 409
            )
        return Frame("local" if row.frame_kind == "local" else "crs", row.crs_wkt, row.epsg)


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
