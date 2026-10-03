"""Fill P1's `asset_model.frame` from a plant version's site (spec 2026-10-03-plant-model-generator §9).

Only when the frame is null, only through P1's `Frame` (so it validates), and never `silhouette`,
`levels` or `presets` (J1 derives those). A failure here is logged and never fails the GLB build.
"""

from __future__ import annotations

import logging

import numpy as np

from app.asset_models import store
from app.asset_models.siteframe import GridError, PlantGrid
from app.asset_models.spec import AssetSpec

log = logging.getLogger(__name__)
MIN_HEIGHT_M = 0.1


def plant_frame(spec: AssetSpec, meta: dict) -> dict | None:
    """A `Frame` dump for this plant, or None without a site or without P1's frame module."""
    try:
        from app.asset_review.frame import Frame, Origin
    except ImportError:
        return None
    site = spec.site
    if site is None:
        return None
    grid = PlantGrid(site)
    if site.cloud_z_to_el is not None:
        alt, note = site.datum.el_m - site.cloud_z_to_el.offset_m, "Ground altitude from the cloud datum fit."
    else:
        alt, note = 0.0, "Ground altitude not fitted (no cloud datum)."
    try:
        lon, lat = grid.site_to_lonlat(np.array([site.origin_crs[0]]), np.array([site.origin_crs[1]]))
        origin = Origin(lat=float(lat[0]), lon=float(lon[0]), ground_alt_m=float(alt))
        offset = site.plant_north_deg + grid.convergence_deg()  # true bearing of plant north
    except GridError:
        origin, offset = None, site.plant_north_deg
    top = float(meta["bounds_m"][1][1])
    frame = Frame(
        origin=origin,
        north_offset_deg=offset,
        height_m=max(top, MIN_HEIGHT_M),
        datum_label=site.datum.label,
        datum_note=note,
    )
    return frame.model_dump(mode="json")


def fill_frame(s, model_id: str, spec: AssetSpec, meta: dict) -> bool:
    """Write the frame when the model has P1's column and it is null. Never raises."""
    try:
        model = store.get_model(s, model_id)
        if getattr(model, "frame", "absent") is not None:  # set already, or no P1 column
            return False
        frame = plant_frame(spec, meta)
        if frame is None:
            return False
        model.frame = frame
        return True
    except Exception:
        log.warning("plant frame fill skipped for an asset model (%s)", "error")
        return False
