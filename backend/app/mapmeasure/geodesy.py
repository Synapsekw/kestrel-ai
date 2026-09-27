"""Distance and area results (spec 2026-09-26-map-workspace §9.1, M13): ellipsoidal on WGS84 via
`pyproj.Geod`, with the grid figures and their scale factor (grid / ground, the convention of
`volumes.engine.areal_scale`). Pure: vertices in, a results dict out.

Contract ruling C4: `distance_results()` also carries `dsm_surface_id` (always None here) — the
DSM used for `length_3d_m`, which the service layer sets once it resolves one, not this pure
function."""

from __future__ import annotations

import numpy as np
from pyproj import Geod
from shapely.geometry import Polygon

from app.mapmeasure.frames import SiteFrame, to_lonlat, unit_factor

GEOD = Geod(ellps="WGS84")


def _xy(vertices) -> np.ndarray:
    return np.asarray(vertices, dtype=np.float64).reshape(-1, 2)


def _open_ring(ring) -> np.ndarray:
    a = _xy(ring)
    return a[:-1] if len(a) > 3 and np.array_equal(a[0], a[-1]) else a


def grid_length_m(vertices, frame: SiteFrame) -> float:
    a = _xy(vertices)
    return float(np.hypot(*np.diff(a, axis=0).T).sum()) * unit_factor(frame)


def distance_results(vertices, frame: SiteFrame) -> dict:
    grid = grid_length_m(vertices, frame)
    out = {
        "length_m": None,
        "grid_length_m": grid,
        "scale_factor": None,
        "length_3d_m": None,
        "nodata_fraction": None,
        "dsm_surface_id": None,
    }
    if frame.kind == "local":
        return out
    a = _xy(vertices)
    lon, lat = to_lonlat(a[:, 0], a[:, 1], frame)
    length = float(GEOD.line_length(lon, lat))
    out["length_m"] = length
    out["scale_factor"] = grid / length if length > 0 else None
    return out


def area_results(ring, frame: SiteFrame) -> dict:
    a = _open_ring(ring)
    k = unit_factor(frame)
    poly = Polygon(a)
    grid_area = abs(float(poly.area)) * k * k
    grid_perimeter = float(poly.exterior.length) * k
    out = {
        "area_m2": None,
        "perimeter_m": None,
        "grid_area_m2": grid_area,
        "grid_perimeter_m": grid_perimeter,
        "areal_scale_factor": None,
    }
    if frame.kind == "local":
        return out
    lon, lat = to_lonlat(a[:, 0], a[:, 1], frame)
    area, perimeter = GEOD.polygon_area_perimeter(lon, lat)
    area = abs(float(area))
    out["area_m2"] = area
    out["perimeter_m"] = float(perimeter)
    out["areal_scale_factor"] = grid_area / area if area > 0 else None
    return out
