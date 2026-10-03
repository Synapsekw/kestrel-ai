# backend/tests/test_plant_cloudcheck.py
"""The plant cloud check (spec 2026-10-03 §8.2.4, §13 C1; index Review Focus 2)."""

import numpy as np
import plant_cloud as pc
import pytest

from app.asset_models.siteframe import footprint_polygon

# ---------------------------------------------------------------- F0 alignment


def test_f0_grid_matches_the_kipic_register():
    g = pc.grid()
    assert g.frame.crs.epsg == 32639
    x, y = g.plant_to_site(np.array([1301.1]), np.array([555.4]))  # 20-T-0001 in Cowork's register
    assert (float(x[0]), float(y[0])) == pytest.approx((245747.13, 3179641.87), abs=0.05)
    e, n = g.site_to_plant(x, y)
    assert (float(e[0]), float(n[0])) == pytest.approx((1301.1, 555.4), abs=1e-6)


def test_f0_footprints_match_the_scene_assumptions():
    _, items = pc.standard_scene()
    by = {it.id: it for it in items}
    ring = footprint_polygon(by["pkg-offset"].footprint)  # rect: along = plant north at rot 0
    assert ring.min(axis=0) == pytest.approx([1356, 574], abs=1e-6)
    assert ring.max(axis=0) == pytest.approx([1364, 586], abs=1e-6)
    ring = footprint_polygon(by["tank-a"].footprint)
    assert ring.min(axis=0) == pytest.approx([1310, 530], abs=0.1)
    assert ring.max(axis=0) == pytest.approx([1330, 550], abs=0.1)
