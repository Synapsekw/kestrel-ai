"""The cloud's coordinate system (spec §6.5): parsed from the header, never reprojected.

PotreeConverter drops the CRS, so it is stored here. A compound CRS gives its horizontal part as
`epsg`/`proj4`/`crs_wkt` and its vertical part's name as `vertical_crs`.
"""

from __future__ import annotations

import warnings
from dataclasses import dataclass
from typing import Any

from pyproj import CRS, Transformer
from pyproj.exceptions import CRSError

EDGE_SAMPLES = 21  # points per bbox edge when projecting to WGS84: edges curve


@dataclass(frozen=True)
class CrsInfo:
    crs_wkt: str | None = None
    epsg: int | None = None
    proj4: str | None = None
    vertical_crs: str | None = None
    warning: str | None = None

    @property
    def is_geographic(self) -> bool:
        return bool(self.crs_wkt) and CRS.from_wkt(self.crs_wkt).is_geographic


def crs_info(crs: CRS) -> CrsInfo:
    horizontal, vertical = crs, None
    if crs.is_compound:
        subs = crs.sub_crs_list
        horizontal = next((c for c in subs if c.is_projected or c.is_geographic), subs[0])
        vertical = next((c for c in subs if c.is_vertical), None)
    with warnings.catch_warnings():
        warnings.simplefilter("ignore", UserWarning)  # "you will likely lose ... information"
        proj4 = horizontal.to_proj4()
    return CrsInfo(
        crs_wkt=horizontal.to_wkt(),
        epsg=horizontal.to_epsg(),
        proj4=proj4,
        vertical_crs=vertical.name if vertical is not None else None,
    )


def crs_from_header(header: Any) -> CrsInfo:
    try:
        crs = header.parse_crs()
    except Exception as e:  # a corrupt VLR must not fail the import
        return CrsInfo(
            warning=f"the coordinate system in the file could not be read: {type(e).__name__}: {e}"
        )
    return crs_info(crs) if crs is not None else CrsInfo()


def crs_from_epsg(code: int) -> CrsInfo:
    try:
        return crs_info(CRS.from_epsg(code))
    except CRSError as e:
        raise ValueError(f"EPSG:{code} is not a known coordinate system") from e


def bounds_wgs84(bounds: list[float], crs_wkt: str) -> list[float]:
    minx, miny, _, maxx, maxy, _ = bounds
    xs: list[float] = []
    ys: list[float] = []
    for i in range(EDGE_SAMPLES):
        t = i / (EDGE_SAMPLES - 1)
        x, y = minx + t * (maxx - minx), miny + t * (maxy - miny)
        xs += [x, x, minx, maxx]
        ys += [miny, maxy, y, y]
    to_wgs84 = Transformer.from_crs(CRS.from_wkt(crs_wkt), CRS.from_epsg(4326), always_xy=True)
    lons, lats = to_wgs84.transform(xs, ys)
    return [float(min(lons)), float(min(lats)), float(max(lons)), float(max(lats))]
