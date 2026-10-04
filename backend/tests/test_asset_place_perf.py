# backend/tests/test_asset_place_perf.py
"""Timing budgets for asset_place (spec 2026-10-02-asset-findings §11: DAMAC's 1,441 sightings in
under 5 minutes). Run on an idle machine: `pytest -m perf tests/test_asset_place_perf.py`."""

import time

import numpy as np
import pytest
import trimesh
from asset_place_helpers import add_photo, add_sighting, diamond, project_truth, seed_model
from fixtures.synthetic_tower import make_tower
from test_asset_place_job import Ctx

from app.asset_review import jobs_place, raycast
from app.asset_review.meshes import load_glb_mesh
from app.asset_review.profiles import resolve

pytestmark = pytest.mark.perf


def test_200_tower_sightings_place_in_under_30_seconds(handle, tmp_path, crack):
    """Half polygons (patches, grid 14, textures over the photo), half boxes (pins): 0.15 s a
    sighting at most, under the 0.2 s a sighting that DAMAC's 5 minutes allow."""
    tower = make_tower(tmp_path / "tower", photos=False)
    mesh, _ = load_glb_mesh(tower.glb_path)
    truth = project_truth(tower, mesh)
    mid = seed_model(handle, tower.glb_path, tower.frame, resolve("building_facade", tower.frame.height_m))
    photos = {}
    for k in range(200):
        ts = truth[k % len(truth)]
        if ts.pose_index not in photos:
            photos[ts.pose_index] = add_photo(
                handle, mid, f"p{ts.pose_index:03d}.jpg", tower.poses[ts.pose_index]
            )
        add_sighting(
            handle, mid, crack["id"], photos[ts.pose_index], diamond(ts.shape) if k % 2 == 0 else ts.shape
        )
    started = time.perf_counter()
    result = jobs_place.run_place(Ctx(handle, {"asset_model_id": mid}))
    elapsed = time.perf_counter() - started
    assert result["patch"] + result["point"] + result["none"] == 200
    assert elapsed < 30.0, f"{elapsed:.1f} s for 200 sightings"


def test_ebsm_scale_mesh_casts_78_patch_grids_in_under_60_seconds():
    """EBSM's GLB has 711k vertices; this sphere has 655k vertices and 1.31M faces. Its 78 sightings
    are stack patches with grid 48 (48 x 96 rays): about 0.35 s each while planning."""
    sphere = trimesh.creation.icosphere(subdivisions=8, radius=10.0)
    o = np.array([40.0, 0.0, 0.0])
    a, b = np.meshgrid(np.linspace(-0.1, 0.1, 48), np.linspace(-0.15, 0.15, 96))
    started = time.perf_counter()
    for k in range(78):
        tilt = (k % 13 - 6) * 0.005
        d = np.stack([-np.ones(a.size), b.ravel() + tilt, a.ravel()], axis=1)
        t, face = raycast.first_hits(sphere.vertices, sphere.faces, np.repeat(o[None], len(d), 0), d)
        assert (face >= 0).all()
    elapsed = time.perf_counter() - started
    assert elapsed < 60.0, f"{elapsed:.1f} s for 78 EBSM-sized casts"
