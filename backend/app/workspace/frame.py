"""The site frame (spec 2026-09-26-map-workspace section 3, M1-M5): the one module that converts
between the workspace's display CRS and every stored CRS, so pyproj lives on one side only.

A frame is either a projected CRS in metres (`kind == "crs"`) or local metres (`kind == "local"`).
A CRS frame holds items with a CRS; a local frame holds CRS-less items, and converting between a
local frame and a local item is the identity. Stored geometries never depend on the frame (M5): the
callers convert on the way in and out.
"""

from __future__ import annotations

import hashlib
import math
import threading
import warnings
from collections import OrderedDict
from collections.abc import Sequence
from dataclasses import dataclass
from functools import lru_cache
from typing import Literal

import numpy as np
from affine import Affine
from pyproj import CRS, Transformer

from app.errors import AppError
from app.surfaces.grid import crs_problem

EDGE_SAMPLES = 21  # points per edge when projecting a box: edges curve across CRSs
WGS84 = CRS.from_epsg(4326).to_wkt()
_CACHE_ITEMS = 32

Points = Sequence[Sequence[float]]
BBox = tuple[float, float, float, float]


@dataclass(frozen=True)
class SiteFrame:
    kind: Literal["crs", "local"]
    crs_wkt: str | None = None
    epsg: int | None = None

    @property
    def key(self) -> str:
        """Part of every site tile's cache key: a frame change never serves an old tile."""
        if self.kind == "local":
            return "local"
        if self.epsg:
            return f"epsg:{self.epsg}"
        return "wkt:" + hashlib.sha1(str(self.crs_wkt).encode("utf-8")).hexdigest()[:12]

    @property
    def name(self) -> str:
        return "Local metres" if self.kind == "local" else CRS.from_user_input(self.crs_wkt).name

    @property
    def proj4(self) -> str | None:
        if self.kind == "local":
            return None
        with warnings.catch_warnings():
            warnings.filterwarnings("ignore", message="You will likely lose important projection information")
            return CRS.from_user_input(self.crs_wkt).to_proj4()

    def holds(self, crs_wkt: str | None) -> bool:
        return crs_wkt is None if self.kind == "local" else crs_wkt is not None


LOCAL = SiteFrame("local")


def not_in_frame(what: str) -> AppError:
    """The contract's code for an item that is not in the site frame (getSiteTile, convertAnchor)."""
    return AppError("no_coordinates", f"{what} is not in the site frame", 422)


def frame_for_epsg(epsg: int) -> SiteFrame:
    """A site frame for an EPSG code: 422 `invalid_epsg` when pyproj does not know it,
    `needs_projected_crs` unless it is a projected CRS in metres."""
    try:
        crs = CRS.from_epsg(int(epsg))
    except Exception:
        raise AppError("invalid_epsg", f"EPSG:{epsg} is not a known coordinate system", 422) from None
    wkt = crs.to_wkt()
    problem = crs_problem(wkt)
    if problem:
        raise AppError("needs_projected_crs", f"EPSG:{epsg} cannot be the site frame: {problem}", 422)
    return SiteFrame("crs", wkt, int(epsg))


def utm_frame(lon: float, lat: float) -> SiteFrame:
    """The WGS 84 UTM zone of a point (plan deviation 2: by formula, deterministic on a boundary)."""
    zone = min(60, max(1, math.floor((lon + 180.0) / 6.0) + 1))
    return frame_for_epsg((32600 if lat >= 0 else 32700) + zone)


def frame_for_crs(crs_wkt: str, centre_lonlat: tuple[float, float] | None) -> SiteFrame:
    """Rule M3: a projected CRS in metres is the frame as it is; a geographic (or non-metre) CRS is
    replaced by the UTM zone of the item's centre (plan deviation 3)."""
    if crs_problem(crs_wkt) is None:
        return SiteFrame("crs", crs_wkt, CRS.from_user_input(crs_wkt).to_epsg())
    if centre_lonlat is None:
        raise AppError("needs_projected_crs", "the item's coordinate system cannot be the site frame", 422)
    return utm_frame(*centre_lonlat)


@lru_cache(maxsize=256)
def same_crs(a: str, b: str) -> bool:
    return a == b or CRS.from_user_input(a).equals(CRS.from_user_input(b))


_local = threading.local()  # pyproj Transformers are not shared across threads


def _transformer(src_wkt: str, dst_wkt: str) -> Transformer:
    cache: OrderedDict | None = getattr(_local, "cache", None)
    if cache is None:
        cache = _local.cache = OrderedDict()
    key = (src_wkt, dst_wkt)
    t = cache.get(key)
    if t is None:
        t = Transformer.from_crs(CRS.from_user_input(src_wkt), CRS.from_user_input(dst_wkt), always_xy=True)
        cache[key] = t
        while len(cache) > _CACHE_ITEMS:
            cache.popitem(last=False)
    else:
        cache.move_to_end(key)
    return t


def transform_xy(src_wkt: str, dst_wkt: str, xs, ys, *, strict: bool = True) -> tuple[np.ndarray, np.ndarray]:
    """Arrays of x and y from one CRS into another; the same CRS is an exact copy. With `strict`, a
    coordinate pyproj cannot project (inf) is 422 `no_coordinates`."""
    xs = np.asarray(xs, dtype=np.float64)
    ys = np.asarray(ys, dtype=np.float64)
    if same_crs(src_wkt, dst_wkt):
        return xs.copy(), ys.copy()
    ox, oy = _transformer(src_wkt, dst_wkt).transform(xs, ys)
    ox, oy = np.asarray(ox, dtype=np.float64), np.asarray(oy, dtype=np.float64)
    if strict and not (np.isfinite(ox).all() and np.isfinite(oy).all()):
        raise not_in_frame("a coordinate that cannot be projected")
    return ox, oy


def to_site(frame: SiteFrame, src_crs_wkt: str | None, xs, ys) -> tuple[np.ndarray, np.ndarray]:
    if not frame.holds(src_crs_wkt):
        raise not_in_frame("this item")
    if frame.kind == "local":
        return np.array(xs, dtype=np.float64), np.array(ys, dtype=np.float64)
    return transform_xy(src_crs_wkt, frame.crs_wkt, xs, ys)


def from_site(frame: SiteFrame, dst_crs_wkt: str | None, xs, ys) -> tuple[np.ndarray, np.ndarray]:
    if not frame.holds(dst_crs_wkt):
        raise not_in_frame("this item")
    if frame.kind == "local":
        return np.array(xs, dtype=np.float64), np.array(ys, dtype=np.float64)
    return transform_xy(frame.crs_wkt, dst_crs_wkt, xs, ys)


def _xy(points: Points) -> tuple[np.ndarray, np.ndarray]:
    arr = np.asarray(points, dtype=np.float64).reshape(-1, 2)
    return arr[:, 0], arr[:, 1]


def _pts(xs: np.ndarray, ys: np.ndarray) -> list[list[float]]:
    return np.column_stack([xs, ys]).tolist()


def points_to_site(frame: SiteFrame, src_crs_wkt: str | None, points: Points) -> list[list[float]]:
    if len(points) == 0:
        return []
    return _pts(*to_site(frame, src_crs_wkt, *_xy(points)))


def points_from_site(frame: SiteFrame, dst_crs_wkt: str | None, points: Points) -> list[list[float]]:
    if len(points) == 0:
        return []
    return _pts(*from_site(frame, dst_crs_wkt, *_xy(points)))


def site_to_wgs84(frame: SiteFrame, points: Points) -> list[list[float]]:
    if frame.kind == "local":
        raise not_in_frame("a local-metres site")
    return _pts(*transform_xy(frame.crs_wkt, WGS84, *_xy(points)))


def wgs84_to_site(frame: SiteFrame, points: Points) -> list[list[float]]:
    if frame.kind == "local":
        raise not_in_frame("a WGS84 position")
    return _pts(*transform_xy(WGS84, frame.crs_wkt, *_xy(points)))


def crs_to_wgs84(crs_wkt: str, points: Points) -> list[list[float]]:
    return _pts(*transform_xy(crs_wkt, WGS84, *_xy(points)))


def _map_affine(crs_wkt: str | None, geotransform: Sequence[float] | None) -> Affine:
    if crs_wkt is None or geotransform is None:
        raise not_in_frame("a map without coordinates")
    return Affine.from_gdal(*geotransform)


def map_pixels_to_site(
    frame: SiteFrame, crs_wkt: str | None, geotransform: Sequence[float], points: Points
) -> list[list[float]]:
    """Map pixels (origin at the top-left corner, y down, GDAL convention) to site coordinates,
    rotation terms included."""
    a = _map_affine(crs_wkt, geotransform)
    px, py = _xy(points)
    return _pts(*to_site(frame, crs_wkt, a.a * px + a.b * py + a.c, a.d * px + a.e * py + a.f))


def site_to_map_pixels(
    frame: SiteFrame, crs_wkt: str | None, geotransform: Sequence[float], points: Points
) -> list[list[float]]:
    inv = ~_map_affine(crs_wkt, geotransform)
    xs, ys = from_site(frame, crs_wkt, *_xy(points))
    return _pts(inv.a * xs + inv.b * ys + inv.c, inv.d * xs + inv.e * ys + inv.f)


def densify_bbox(bbox: BBox, n: int = EDGE_SAMPLES) -> np.ndarray:
    """The box's outline as 4 (n - 1) points, counter-clockwise from (minx, miny), not closed."""
    minx, miny, maxx, maxy = bbox
    t = np.linspace(0.0, 1.0, n)[:-1]
    bottom = np.column_stack([minx + t * (maxx - minx), np.full_like(t, miny)])
    right = np.column_stack([np.full_like(t, maxx), miny + t * (maxy - miny)])
    top = np.column_stack([maxx - t * (maxx - minx), np.full_like(t, maxy)])
    left = np.column_stack([np.full_like(t, minx), maxy - t * (maxy - miny)])
    return np.vstack([bottom, right, top, left])


def _bounds(xs: np.ndarray, ys: np.ndarray) -> BBox:
    return float(xs.min()), float(ys.min()), float(xs.max()), float(ys.max())


def bbox_from_site(
    frame: SiteFrame, dst_crs_wkt: str | None, bbox: BBox, *, strict: bool = True
) -> BBox | None:
    """A site box as the bounding box of its densified outline in `dst_crs_wkt`. Not strict: points
    pyproj cannot project are dropped, and None when none can (the tile renderer's 204)."""
    if not frame.holds(dst_crs_wkt):
        raise not_in_frame("this item")
    if frame.kind == "local":
        return tuple(float(v) for v in bbox)
    ring = densify_bbox(bbox)
    xs, ys = transform_xy(frame.crs_wkt, dst_crs_wkt, ring[:, 0], ring[:, 1], strict=False)
    ok = np.isfinite(xs) & np.isfinite(ys)
    if not ok.all():
        if strict:
            raise not_in_frame("a box that cannot be projected")
        if not ok.any():
            return None
    return _bounds(xs[ok], ys[ok])


def bbox_to_site(frame: SiteFrame, src_crs_wkt: str | None, bbox: BBox) -> BBox:
    ring = densify_bbox(bbox)
    return _bounds(*to_site(frame, src_crs_wkt, ring[:, 0], ring[:, 1]))


def site_bbox_to_map_pixels(
    frame: SiteFrame, crs_wkt: str | None, geotransform: Sequence[float], bbox: BBox
) -> BBox:
    px = np.asarray(site_to_map_pixels(frame, crs_wkt, geotransform, densify_bbox(bbox)))
    return _bounds(px[:, 0], px[:, 1])


def _map_geometry(geometry: dict, convert) -> dict:
    kind = geometry["type"]
    coords = geometry["coordinates"]
    if kind == "Point":
        return {"type": "Point", "coordinates": convert([coords])[0]}
    if kind == "LineString":
        return {"type": "LineString", "coordinates": convert(coords)}
    if kind == "Polygon":
        return {"type": "Polygon", "coordinates": [convert(ring) for ring in coords]}
    raise AppError("invalid_geometry", f"a {kind} cannot be placed in the site frame", 422)


def geometry_to_site(frame: SiteFrame, src_crs_wkt: str | None, geometry: dict) -> dict:
    return _map_geometry(geometry, lambda pts: points_to_site(frame, src_crs_wkt, pts))


def geometry_from_site(frame: SiteFrame, dst_crs_wkt: str | None, geometry: dict) -> dict:
    return _map_geometry(geometry, lambda pts: points_from_site(frame, dst_crs_wkt, pts))


def affine_points_to_site(
    frame: SiteFrame, transform6: Sequence[float], dst_crs_wkt: str | None, points: Points
) -> list[list[float]]:
    """Drawing coordinates through a fitted `Affine(a, b, c, d, e, f)` into `dst_crs_wkt`, then the
    site frame (spec section 8.3, "A change of site CRS")."""
    a = Affine(*transform6)
    x, y = _xy(points)
    return _pts(*to_site(frame, dst_crs_wkt, a.a * x + a.b * y + a.c, a.d * x + a.e * y + a.f))


def site_points_to_affine_src(
    frame: SiteFrame, transform6: Sequence[float], dst_crs_wkt: str | None, points: Points
) -> list[list[float]]:
    inv = ~Affine(*transform6)
    xs, ys = from_site(frame, dst_crs_wkt, *_xy(points))
    return _pts(inv.a * xs + inv.b * ys + inv.c, inv.d * xs + inv.e * ys + inv.f)
