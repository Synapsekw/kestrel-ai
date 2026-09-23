"""Map pixels to the map's CRS and to WGS84 (spec sections 9 and 3).

Pixel (px, py) has its origin at the top-left corner of the top-left pixel, y down, exactly as the
GDAL geotransform expects, so a box stored in map pixels converts through the full affine,
rotation terms included.
"""

from __future__ import annotations

import math
from collections.abc import Sequence

from affine import Affine
from pyproj import CRS, Transformer

M_PER_DEG_LAT = 110_574.0
M_PER_DEG_LON_EQUATOR = 111_320.0
EDGE_SAMPLES = 21  # points per edge when projecting the bounds: edges curve in WGS84


class Georef:
    def __init__(self, geotransform: Sequence[float], crs_wkt: str):
        self.affine = Affine.from_gdal(*geotransform)
        self.crs = CRS.from_wkt(crs_wkt)
        self._to_wgs84 = Transformer.from_crs(self.crs, CRS.from_epsg(4326), always_xy=True)

    def pixel_to_native(self, px: float, py: float) -> tuple[float, float]:
        x, y = self.affine * (px, py)
        return float(x), float(y)

    def native_to_wgs84(self, xs, ys):
        return self._to_wgs84.transform(xs, ys)

    def pixel_to_wgs84(self, px: float, py: float) -> tuple[float, float]:
        lon, lat = self.native_to_wgs84(*self.pixel_to_native(px, py))
        return float(lon), float(lat)

    def _edge_pixels(self, width: int, height: int) -> list[tuple[float, float]]:
        pts: list[tuple[float, float]] = []
        for i in range(EDGE_SAMPLES):
            t = i / (EDGE_SAMPLES - 1)
            pts += [(t * width, 0), (t * width, height), (0, t * height), (width, t * height)]
        return pts

    def bounds_native(self, width: int, height: int) -> list[float]:
        native = (self.pixel_to_native(px, py) for px, py in self._edge_pixels(width, height))
        xs, ys = zip(*native, strict=True)
        return [min(xs), min(ys), max(xs), max(ys)]

    def bounds_wgs84(self, width: int, height: int) -> list[float]:
        native = [self.pixel_to_native(px, py) for px, py in self._edge_pixels(width, height)]
        lons, lats = self.native_to_wgs84([p[0] for p in native], [p[1] for p in native])
        return [float(min(lons)), float(min(lats)), float(max(lons)), float(max(lats))]

    def metres_per_pixel(self, width: int, height: int) -> float:
        a = self.affine
        area = abs(a.a * a.e - a.b * a.d)  # one pixel's area in CRS units squared
        if self.crs.is_geographic:
            _, lat = self.pixel_to_native(width / 2, height / 2)
            m_lon = M_PER_DEG_LON_EQUATOR * math.cos(math.radians(lat))
            return math.sqrt(area * m_lon * M_PER_DEG_LAT)
        factor = self.crs.axis_info[0].unit_conversion_factor if self.crs.axis_info else 1.0
        return math.sqrt(area) * factor

    def gsd_cm(self, width: int, height: int) -> float:
        return self.metres_per_pixel(width, height) * 100.0


def box_corners(
    x: float, y: float, w: float, h: float, angle: float | None = None
) -> list[tuple[float, float]]:
    """The box's corners in map pixels: top-left first, clockwise; rotated about the centre."""
    corners = [(x, y), (x + w, y), (x + w, y + h), (x, y + h)]
    if not angle:
        return corners
    cx, cy = x + w / 2, y + h / 2
    c, s = math.cos(math.radians(angle)), math.sin(math.radians(angle))
    return [(cx + (px - cx) * c - (py - cy) * s, cy + (px - cx) * s + (py - cy) * c) for px, py in corners]
