"""The `drawing_raster` site-tile source (spec §6; M-B1's `register_site_tile_source`).

M-B1 renders every raster kind the same way: one WarpedVRT read of the source at a matching
overview, by the source's own geotransform and CRS. For a raster drawing that source is plan.tif,
whose geotransform IS the placement (written at build, rewritten on every georef save/clear). This
module supplies the fields; plan task 16 wraps them into B1's SiteTileSource and registers it.
"""

from __future__ import annotations

import math

import numpy as np

from app.db.models import Drawing
from app.drawings import georef as fitting
from app.drawings import site, store
from app.drawings.placement import VECTOR
from app.errors import AppError, not_found


def drawing_raster_fields(handle, layer_id: str, frame, preview=None) -> dict:
    """`preview` (a drawing -> site affine, B1's TileStyle.preview from `t`) replaces the stored
    placement: the destination is then the site frame itself, and an unplaced drawing can be shown."""
    with handle.session() as s:
        d = s.get(Drawing, layer_id)
        if d is None or d.status == "failed" or d.format in VECTOR:
            raise not_found("raster drawing", layer_id)
        if d.status != "ready":
            raise AppError("not_ready", "the drawing is still importing", 409)
        if preview is None and d.georef is None:
            raise AppError("no_coordinates", "the drawing is not placed yet", 422)
        if preview is not None:
            t, crs_wkt, version = tuple(preview), frame.crs_wkt, f"preview-{d.georef_version or 0}"
        else:
            t = tuple(d.georef["transform"])
            crs_wkt, version = d.georef.get("dst_crs_wkt"), d.georef_version or 0
        width, height = d.width, d.height
    try:
        site.Conversion(crs_wkt, frame)
    except site.NotInFrame:
        raise AppError("no_coordinates", "the drawing is not in this site frame", 422) from None
    xs, ys = fitting.apply(t, *site.ring((0.0, float(-height), float(width), 0.0), n=2))
    xs, ys = np.asarray(xs), np.asarray(ys)
    return {
        "layer_id": layer_id,
        "version": str(version),
        "path": store.plan_path(handle, layer_id),
        "crs_wkt": crs_wkt,
        "bounds_native": (float(xs.min()), float(ys.min()), float(xs.max()), float(ys.max())),
        "native_res_m": math.sqrt(abs(t[0] * t[4] - t[1] * t[3])) * site.crs_unit_m(crs_wkt),
        # (col, -row) -> (E, N) = [a, b, c, d, e, f] is the pixel geotransform (a, -b, c, d, -e, f)
        "preview_transform": None if preview is None else (t[0], -t[1], t[2], t[3], -t[4], t[5]),
    }
