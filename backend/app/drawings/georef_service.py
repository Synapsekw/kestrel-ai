"""Control-point georeferencing of one drawing (spec 2026-09-26-map-workspace §8.3). Shared by
PUT /drawings/{id}/georef and the plant run's auto-georef (spec 2026-10-03 §15). It answers the same
404/409/422 as the route did."""

from __future__ import annotations

from app.db.base import utcnow
from app.drawings import footprint, service, site, store
from app.drawings import georef as fitting
from app.drawings.placement import VECTOR
from app.drawings.schemas import DrawingOut
from app.errors import AppError
from app.surfaces.design.units import unit_to_m


def apply_control_points(handle, drawing_id: str, model: str, points: list[dict]) -> DrawingOut:
    """Fit `model` to `points` ({id?, src, dst}; dst in the site frame), store it, write it into the
    raster's plan.tif and drop the drawing's cached tiles."""
    with handle.session() as s:
        service.require(s, drawing_id)
    frame = site.current_frame(handle)
    with handle.session() as s:
        row = service.require(s, drawing_id)
        if row.status != "ready":
            raise AppError("not_ready", "the drawing is still importing or failed", 409)
        units_scale = unit_to_m(row.units) if row.format in VECTOR and row.units else None
        try:
            f = fitting.fit(
                model,
                [p["src"] for p in points],
                [p["dst"] for p in points],
                dst_unit_m=site.frame_unit_m(frame),
                units_scale=units_scale,
            )
        except fitting.GeorefRefused as e:
            raise AppError(e.code, e.message, 422) from None
        fit_json = f.to_json()
        row.georef = {
            "method": "control_points",
            "crs_wkt": None,
            "epsg": None,
            "model": model,
            "points": [
                {"id": p.get("id") or f"p{i + 1}", "src": list(p["src"]), "dst": list(p["dst"])}
                for i, p in enumerate(points)
            ],
            "dst_crs_wkt": frame.crs_wkt,
            "transform": fit_json["transform"],
            "rmse_m": fit_json["rmse_m"],
            "residuals_m": fit_json["residuals_m"],
            "warnings": fit_json["warnings"],
        }
        row.georef_version = (row.georef_version or 0) + 1
        row.bounds_site = footprint.bounds_site_value(row, frame)
        row.updated_at = utcnow()
        if row.format not in VECTOR:
            from app.drawings import raster_io

            raster_io.write_plan_georef(store.plan_path(handle, drawing_id), f.transform, frame.crs_wkt)
        out = service.to_out(row, frame)
    service.drop_caches(drawing_id)
    return out
