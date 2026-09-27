"""Annotation shapes (spec 2026-09-26-image-inspection sections 8.1 and 8.2): pure functions.

The server is the only judge of geometry. `x, y, w, h` stay meaningful for every shape so every
rectangle reader (NMS, counts, the finding thumbnail crop, COCO bbox, accept_above) keeps working:
a polygon keeps its axis-aligned envelope with `angle = 0`, a point is `x, y` with `w = h = 0`.
Polygon points are stored-image pixels, one ring, CCW in Shapely's sense in these coordinates
(y grows down, so it looks clockwise on screen), rounded to 0.1 px, without a closing vertex.
Error codes are the contract's (plan 2026-09-27-images-c0 ruling 2): invalid_shape, out_of_bounds,
empty_polygon.
"""

from __future__ import annotations

import math
from collections.abc import Iterator
from dataclasses import dataclass
from typing import Literal

import shapely
from shapely.geometry import Polygon
from shapely.geometry.base import BaseGeometry
from shapely.geometry.polygon import orient

from app.errors import AppError
from app.geometry import centre_of, corners_of, normalise_angle

Shape = Literal["box", "rbox", "polygon", "point"]
SHAPES: tuple[str, ...] = ("box", "rbox", "polygon", "point")
RECTS: tuple[str, ...] = ("box", "rbox")
MAX_VERTICES = 2000
MIN_AREA_PX = 4.0


@dataclass(frozen=True)
class ShapeFields:
    shape: Shape
    x: float
    y: float
    w: float
    h: float
    angle: float
    points: list[list[float]] | None
    area_px: float
    repaired: bool = False

    def columns(self) -> dict[str, object]:
        return {
            "shape": self.shape,
            "x": self.x,
            "y": self.y,
            "w": self.w,
            "h": self.h,
            "angle": self.angle,
            "points": self.points,
            "area_px": self.area_px,
        }


def invalid_shape(message: str) -> AppError:
    return AppError("invalid_shape", message, 422)


def _require_finite(**values: float | None) -> None:
    """Refuse a NaN/Inf coordinate before it ever reaches Shapely (which raises a raw
    GEOSException on a non-finite ring, and would silently accept NaN in a rectangle)."""
    for name, v in values.items():
        if v is not None and not math.isfinite(v):
            raise invalid_shape(f"{name} must be a finite number, got {v!r}")


def _outside(message: str) -> AppError:
    return AppError("out_of_bounds", message, 422)


def _empty() -> AppError:
    return AppError("empty_polygon", "Nothing of this polygon is left inside the image.", 422)


def check_rect_bounds(width: int, height: int, x: float, y: float, w: float, h: float, angle: float) -> None:
    """Angle 0 must lie fully inside the image; a rotated box only needs its centre inside (the
    asymmetry is deliberate: spec 2026-09-20 rotated boxes 3.3)."""
    if w <= 0 or h <= 0:
        raise invalid_shape(f"box ({x}, {y}, {w}, {h}) has a non-positive side")
    if angle:
        cx, cy = centre_of(x, y, w, h)
        if not (0 <= cx <= width and 0 <= cy <= height):
            raise _outside(f"rotated box centre ({cx}, {cy}) is outside the {width}x{height} image")
        return
    if x < 0 or y < 0 or x + w > width or y + h > height:
        raise _outside(f"box ({x}, {y}, {w}, {h}) does not lie inside the {width}x{height} image")


def rect_fields(
    width: int, height: int, x: float, y: float, w: float, h: float, angle: float = 0.0
) -> ShapeFields:
    _require_finite(x=x, y=y, w=w, h=h, angle=angle)
    angle = normalise_angle(angle)
    check_rect_bounds(width, height, x, y, w, h, angle)
    shape: Shape = "rbox" if angle else "box"
    return ShapeFields(shape, float(x), float(y), float(w), float(h), angle, None, float(w * h))


def point_fields(width: int, height: int, x: float, y: float) -> ShapeFields:
    _require_finite(x=x, y=y)
    if not (0 <= x <= width and 0 <= y <= height):
        raise _outside(f"point ({x}, {y}) is outside the {width}x{height} image")
    return ShapeFields("point", float(x), float(y), 0.0, 0.0, 0.0, None, 0.0)


def _polygons(geom: BaseGeometry) -> Iterator[Polygon]:
    if isinstance(geom, Polygon):
        if not geom.is_empty:
            yield geom
    elif hasattr(geom, "geoms"):
        for part in geom.geoms:
            yield from _polygons(part)


def _largest(geom: BaseGeometry) -> Polygon | None:
    return max(_polygons(geom), key=lambda p: p.area, default=None)


def _ring(poly: Polygon) -> list[list[float]]:
    out: list[list[float]] = []
    for px, py in list(poly.exterior.coords)[:-1]:
        v = [round(px, 1), round(py, 1)]
        if not out or out[-1] != v:
            out.append(v)
    if len(out) > 1 and out[0] == out[-1]:
        out.pop()
    return out


def polygon_fields(width: int, height: int, points: list[list[float]]) -> ShapeFields:
    if len(points) > MAX_VERTICES:
        raise invalid_shape(f"a polygon has at most {MAX_VERTICES} vertices, got {len(points)}")
    pts = [(float(p[0]), float(p[1])) for p in points]
    for px, py in pts:
        _require_finite(x=px, y=py)
    if len(set(pts)) < 3:
        raise _empty()
    raw = Polygon(pts)
    part = _largest(raw if raw.is_valid else shapely.make_valid(raw))
    if part is not None:
        part = _largest(shapely.clip_by_rect(Polygon(part.exterior), 0, 0, width, height))
    if part is None or part.area < MIN_AREA_PX:
        raise _empty()
    ring = _ring(orient(part, sign=1.0))
    if len(ring) > MAX_VERTICES:
        raise invalid_shape(f"the repaired polygon has more than {MAX_VERTICES} vertices")
    out = Polygon(ring) if len(ring) >= 3 else None
    rounding_pinched = out is None or not out.is_valid or out.area < MIN_AREA_PX
    if rounding_pinched:
        # A valid ring can still pinch invalid once independently rounded to 0.1 px (two
        # vertices that were merely close collapse onto the same point). Snap the whole
        # geometry to the 0.1 px grid instead of rounding coordinates one at a time, then
        # take its largest part again.
        snapped = shapely.set_precision(part, 0.1)
        snapped_part = _largest(snapped if snapped.is_valid else shapely.make_valid(snapped))
        if snapped_part is None or snapped_part.area < MIN_AREA_PX:
            raise _empty()
        ring = _ring(orient(snapped_part, sign=1.0))
        if len(ring) > MAX_VERTICES:
            raise invalid_shape(f"the repaired polygon has more than {MAX_VERTICES} vertices")
        out = Polygon(ring) if len(ring) >= 3 else None
        if out is None or not out.is_valid or out.area < MIN_AREA_PX:
            raise _empty()
    rounded_in = Polygon([(round(px, 1), round(py, 1)) for px, py in pts])
    repaired = rounding_pinched or not raw.is_valid or not rounded_in.is_valid or not out.equals(rounded_in)
    minx, miny, maxx, maxy = out.bounds
    return ShapeFields(
        "polygon", minx, miny, maxx - minx, maxy - miny, 0.0, ring, round(out.area, 1), repaired
    )


def shape_fields(
    width: int,
    height: int,
    *,
    shape: Shape = "box",
    x: float | None = None,
    y: float | None = None,
    w: float | None = None,
    h: float | None = None,
    angle: float = 0.0,
    points: list[list[float]] | None = None,
) -> ShapeFields:
    """The stored columns for one new shape. Fields the shape does not take are ignored (the
    contract's BoxCreate), except `points` on a rectangle or point, which is invalid_shape."""
    if shape not in SHAPES:
        raise invalid_shape(f"unknown shape {shape!r}")
    if shape == "polygon":
        if points is None:
            raise invalid_shape("a polygon needs points")
        return polygon_fields(width, height, points)
    if points is not None:
        raise invalid_shape(f"a {shape} takes no points")
    if x is None or y is None:
        raise invalid_shape(f"a {shape} needs x and y")
    if shape == "point":
        return point_fields(width, height, x, y)
    if w is None or h is None:
        raise invalid_shape(f"a {shape} needs w and h")
    return rect_fields(width, height, x, y, w, h, angle or 0.0)


def outline(row) -> list[tuple[float, float]] | None:
    """The shape's ring in image px, for writers and crops; None for a point (it has no extent)."""
    shape = getattr(row, "shape", None) or ("rbox" if row.angle else "box")
    if shape == "point":
        return None
    if shape == "polygon":
        return [(float(p[0]), float(p[1])) for p in row.points or []]
    if not row.angle:
        return [
            (row.x, row.y),
            (row.x + row.w, row.y),
            (row.x + row.w, row.y + row.h),
            (row.x, row.y + row.h),
        ]
    return corners_of(row.x, row.y, row.w, row.h, row.angle)
