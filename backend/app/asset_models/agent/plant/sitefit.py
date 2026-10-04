# backend/app/asset_models/agent/plant/sitefit.py
"""The plant grid from what the drawings show (spec §8.2.1, §15), and drawing placement from it."""

from __future__ import annotations

import numpy as np
from pyproj import CRS

from app.asset_models.siteframe import PlantGrid
from app.db.models import Drawing
from app.drawings.georef import apply as apply_affine
from app.errors import AppError
from app.workspace.frame import transform_xy


def crs_wkt_of(site) -> str | None:
    if site.crs.epsg:
        return CRS.from_epsg(site.crs.epsg).to_wkt()
    return site.crs.wkt


def drawing_row(handle, drawing_id: str) -> Drawing | None:
    with handle.session() as s:
        row = s.get(Drawing, drawing_id)
        if row is not None:
            s.expunge(row)
        return row


def page_to_site(row: Drawing, fx, fy, site_wkt: str | None):
    """Page fractions -> site CRS through the drawing's georef (src = (col, -row) plan pixels), or None."""
    g = row.georef
    if not g or not row.width or not row.height:
        return None
    X, Y = apply_affine(
        g["transform"], np.asarray(fx, float) * row.width, -np.asarray(fy, float) * row.height
    )
    dst = g.get("dst_crs_wkt")
    if dst and site_wkt:
        X, Y = transform_xy(dst, site_wkt, X, Y)
    elif bool(dst) != bool(site_wkt):
        return None  # one side is local metres: the two can't be related
    return np.asarray(X, float), np.asarray(Y, float)


def page_to_plant_fn(rc, drawing_id: str):
    site = rc.site()
    if site is None:
        return None
    row = drawing_row(rc.handle, drawing_id)
    if row is None or row.georef is None:
        return None
    wkt = crs_wkt_of(site)
    if page_to_site(row, 0.5, 0.5, wkt) is None:
        return None
    grid = PlantGrid(site)

    def fn(fx, fy):
        X, Y = page_to_site(row, fx, fy, wkt)
        return grid.site_to_plant(X, Y)

    return fn


def georef_from_grid(rc, row: Drawing, grid_points) -> str:
    """Place an unplaced page from its grid points (similarity) through the drawings georef service."""
    from app.drawings.georef_service import apply_control_points
    from app.workspace.service import get_frame

    ws = get_frame(rc.handle)
    if ws.kind == "local":
        return f"{row.name} was not placed on the map: the project's map has no coordinate system."
    if not row.width or not row.height:
        return f"{row.name} was not placed on the map: it has no page image."
    site = rc.site()
    site_wkt = crs_wkt_of(site)
    if site_wkt is None:
        return f"{row.name} was not placed on the map: the site frame has no coordinate system."
    grid = PlantGrid(site)
    points = []
    for gp in grid_points[:12]:
        X, Y = grid.plant_to_site(gp.plant_E, gp.plant_N)
        X, Y = transform_xy(site_wkt, ws.crs_wkt, X, Y)
        points.append(
            {
                "id": None,
                "src": [gp.page_xy[0] * row.width, -gp.page_xy[1] * row.height],
                "dst": [float(np.asarray(X)), float(np.asarray(Y))],
            }
        )
    try:
        apply_control_points(rc.handle, row.id, "similarity", points)
    except AppError as e:  # app-written text (GeorefRefused messages, not_ready)
        return f"{row.name} was not placed on the map: {e.message}"
    rc.job.publish("drawings.changed", {"drawing_ids": [row.id]})
    rmse = (drawing_row(rc.handle, row.id).georef or {}).get("rmse_m") or 0.0
    return f"Placed {row.name} on the map from {len(points)} grid points (RMSE {rmse:.2f} m)."
