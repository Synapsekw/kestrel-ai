"""Shared builder geometry and the palette (plan 2026-10-03-plant-model-f0 Task 5)."""

import json
import os
import struct
from pathlib import Path

import numpy as np
import pytest

from app.asset_models.builders.geom import (
    beam,
    box,
    cyl,
    extrude,
    place,
    ring_polyline,
    segments_for,
    yaw,
)
from app.asset_models.builders.palette import BLEND, DOUBLE_SIDED, M1_MATERIAL, PALETTE, material
from app.asset_models.spec import Material

GLB_NAME = "KIPIC_AlZour_LNG_Plant.glb"


def test_box_stands_on_its_base_with_length_north():
    m = box(2, 10, 3)
    assert m.bounds.tolist() == [[-5, 0, -1], [5, 3, 1]] and m.is_watertight


def test_cylinder_stands_on_y_and_is_closed():
    m = cyl(1.0, 5.0)
    assert np.allclose(m.bounds, [[-1, 0, -1], [1, 5, 1]]) and m.is_watertight
    assert len(m.vertices) == 2 * segments_for(1.0) + 2


@pytest.mark.parametrize(("r", "n"), [(0.3, 9), (1.0, 16), (40.0, 100), (0.01, 8), (1e4, 128)])
def test_segments_keep_the_chord_error_within_bounds(r, n):
    assert segments_for(r) == n


def test_extrude_maps_plan_x_z_and_keeps_volume_either_way_round():
    ccw = extrude([[0, 0], [10, 0], [10, 2], [0, 2]], 3)
    cw = extrude([[0, 0], [0, 2], [10, 2], [10, 0]], 3)
    assert ccw.bounds.tolist() == [[0, 0, 0], [10, 3, 2]]
    for m in (ccw, cw):
        assert m.is_watertight and m.volume == pytest.approx(60.0)


@pytest.mark.parametrize(
    "outline",
    [
        [[0, 0], [1, 1], [1, 0], [0, 1]],
        [[0, 0], [1, 0], [2, 0]],
        [[0, 0], [1, 1]],
        [[0, 0], [np.nan, 1], [1, 0]],
    ],
)
def test_extrude_refuses_crossing_flat_short_or_non_finite_outlines(outline):
    with pytest.raises(ValueError):
        extrude(outline, 1)


def test_beams_keep_width_horizontal():
    flat = beam([0, 0, 0], [10, 0, 0], (0.2, 0.5))
    assert np.allclose(flat.bounds, [[0, -0.25, -0.1], [10, 0.25, 0.1]])
    post = beam([0, 0, 0], [0, 4, 0], (0.2, 0.5))
    assert np.allclose(post.bounds, [[-0.1, 0, -0.25], [0.1, 4, 0.25]])
    with pytest.raises(ValueError):
        beam([1, 1, 1], [1, 1, 1])


def test_yaw_turns_north_toward_east_and_place_moves():
    assert np.allclose(yaw(90) @ [1, 0, 0, 1], [0, 0, 1, 1])
    assert np.allclose(place(1, 2, 3, yaw_deg=180) @ [1, 0, 0, 1], [0, 2, 3, 1])


def test_ring_follows_the_polyline_at_its_height():
    ring = ring_polyline([[0, 0], [10, 0], [10, 5]], y=1.1, r=0.025)
    lo, hi = ring.bounds
    assert 1.07 < lo[1] < 1.1 < hi[1] < 1.13  # a 6-sided bar of radius 0.025 at y = 1.1
    assert hi[0] == pytest.approx(10.025, abs=1e-3) and hi[2] == pytest.approx(5.0, abs=0.03)


def test_the_palette_has_cowork_s_34_materials():
    assert len(PALETTE) == 34
    assert BLEND <= set(PALETTE) and DOUBLE_SIDED <= set(PALETTE)
    assert set(M1_MATERIAL) == set(Material.__args__) and set(M1_MATERIAL.values()) <= set(PALETTE)
    m = material("Fence")
    assert m.name == "Fence" and m.alphaMode == "BLEND" and m.doubleSided
    # trimesh keeps colour factors as 8-bit: within 1/255 of the palette
    assert np.allclose(np.asarray(m.baseColorFactor) / 255.0, PALETTE["Fence"][0], atol=1 / 255)
    with pytest.raises(KeyError):
        material("Chrome")


def _cowork_glb() -> Path | None:
    for folder in (Path(__file__).parent / "data" / "plant", Path(os.environ.get("KESTREL_KIPIC_DIR", "-"))):
        if (folder / GLB_NAME).is_file():
            return folder / GLB_NAME
    return None


@pytest.mark.skipif(
    _cowork_glb() is None, reason="the Cowork GLB is git-ignored; copy it to tests/data/plant"
)
def test_the_palette_is_the_cowork_glb_s():
    glb = _cowork_glb().read_bytes()
    (clen,) = struct.unpack_from("<I", glb, 12)
    mats = json.loads(glb[20 : 20 + clen])["materials"]
    assert [m["name"] for m in mats] == list(PALETTE)
    for m in mats:
        pbr = m["pbrMetallicRoughness"]
        rgba, metallic, roughness = PALETTE[m["name"]]
        assert pbr["baseColorFactor"] == pytest.approx(list(rgba)), m["name"]
        assert (pbr["metallicFactor"], pbr["roughnessFactor"]) == pytest.approx((metallic, roughness))
        assert (m.get("alphaMode") == "BLEND") == (m["name"] in BLEND)
        assert bool(m.get("doubleSided")) == (m["name"] in DOUBLE_SIDED)
