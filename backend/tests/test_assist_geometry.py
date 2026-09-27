"""Smart-polygon geometry (spec §10 input and flow step 4; rulings BS4, BS5)."""

import math

import cv2
import numpy as np
import pytest

from app.assist import geometry
from app.assist.geometry import Crop, mask_to_polygon, quantise_crop, to_image_px, to_model_px


def test_small_viewports_grow_to_512_and_snap_to_64():
    crop = quantise_crop(1000, 800, 100, 100, 4000, 3000)
    assert crop.w >= 512 and crop.h >= 512
    assert crop.x % 64 == 0 and crop.y % 64 == 0 and (crop.x + crop.w) % 64 == 0
    assert crop.contains(1050, 850)


def test_pans_inside_one_cell_give_the_same_crop():
    assert quantise_crop(70, 500, 600, 600, 4000, 3000) == quantise_crop(100, 500, 600, 600, 4000, 3000)
    assert quantise_crop(70, 500, 600, 600, 4000, 3000) == Crop(64, 448, 640, 704)


def test_edges_shift_inside_the_image():
    crop = quantise_crop(3900, 2900, 600, 600, 4000, 3000)
    assert crop.x + crop.w == 4000 and crop.y + crop.h == 3000
    assert crop.w >= 512 and crop.h >= 512 and crop.x >= 0 and crop.y >= 0
    left = quantise_crop(-300, -300, 400, 400, 4000, 3000)
    assert (left.x, left.y) == (0, 0) and left.w >= 512 and left.h >= 512


def test_small_images_use_the_whole_axis():
    assert quantise_crop(10, 10, 50, 50, 300, 200) == Crop(0, 0, 300, 200)


def test_a_viewport_outside_the_image_still_gives_a_crop():
    crop = quantise_crop(9000, 9000, 500, 500, 4000, 3000)
    assert 0 <= crop.x and crop.x + crop.w == 4000 and crop.y + crop.h == 3000 and crop.w >= 512


def test_the_whole_frame_zoomed_out_is_the_whole_image():
    assert quantise_crop(0, 0, 4000, 3000, 4000, 3000) == Crop(0, 0, 4000, 3000)


def test_model_size_puts_the_long_side_at_1024():
    assert Crop(0, 0, 2048, 1024).model_size() == (1024, 512)
    assert Crop(0, 0, 512, 704).model_size() == (745, 1024)
    assert Crop(0, 0, 512, 512).scale == 2.0


def test_points_map_to_model_px_and_back():
    crop = Crop(640, 448, 704, 704)
    (mx, my), (nx, ny) = to_model_px(crop, [(1000.0, 800.0), (700.0, 500.0)])
    assert (mx, my) == pytest.approx(((1000 - 640) * 1024 / 704, (800 - 448) * 1024 / 704))
    back = to_image_px(crop, [[mx, my], [600.0, 500.0], [500.0, 700.0]])
    assert back[0] == [1000.0, 800.0]


def _disc(r: int, size=(1024, 1024), centre=(500, 400)) -> np.ndarray:
    mask = np.zeros(size, np.uint8)
    cv2.circle(mask, centre, r, 1, -1)
    return mask.astype(bool)


def test_a_disc_becomes_one_polygon_with_the_right_area():
    poly = mask_to_polygon(_disc(100))
    assert poly is not None and 3 <= len(poly) <= 256
    area = abs(cv2.contourArea(np.array(poly, np.float32)))
    assert area == pytest.approx(math.pi * 100**2, rel=0.03)


def test_the_largest_blob_wins():
    mask = _disc(120, centre=(300, 300)) | _disc(40, centre=(800, 800))
    xs, ys = zip(*mask_to_polygon(mask), strict=True)
    assert abs(np.mean(xs) - 300) < 10 and abs(np.mean(ys) - 300) < 10


def test_an_empty_or_tiny_mask_gives_none():
    assert mask_to_polygon(np.zeros((1024, 1024), bool)) is None
    one = np.zeros((1024, 1024), bool)
    one[10, 10] = True
    assert mask_to_polygon(one) is None


def test_the_eps_doubles_until_256_vertices(monkeypatch):
    # A saw-toothed ring has far more than 256 corners at a tiny epsilon.
    angles = np.linspace(0, 2 * np.pi, 3000, endpoint=False)
    radii = np.where(np.arange(3000) % 2 == 0, 400, 380)
    ring = np.stack([512 + radii * np.cos(angles), 512 + radii * np.sin(angles)], axis=1).astype(np.int32)
    mask = np.zeros((1024, 1024), np.uint8)
    cv2.fillPoly(mask, [ring], 1)
    monkeypatch.setattr(geometry, "MIN_EPS", 0.01)
    monkeypatch.setattr(geometry, "EPS_FRACTION", 0.0)
    poly = mask_to_polygon(mask.astype(bool))
    assert poly is not None and 3 <= len(poly) <= 256


def test_to_image_px_drops_slivers_under_4_px2():
    crop = Crop(0, 0, 4096, 4096)  # scale 0.25: 1 model px = 4 image px
    assert to_image_px(crop, [[0.0, 0.0], [0.4, 0.0], [0.0, 0.4]]) is None
    assert to_image_px(crop, [[0.0, 0.0], [1.0, 0.0]]) is None
