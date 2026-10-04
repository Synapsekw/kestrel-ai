"""Class-index masks: vectorising (spec §6.5 step 5, Douglas-Peucker 1.5 px, holes dropped) and the
lossless palette PNG kept as the finding attachment (spec §13)."""

import numpy as np
import pytest
from kit_fixtures import draw_mask
from PIL import Image

from app.asset_review.kit_format import KIT_CLASSES
from app.asset_review.kit_masks import load_mask, mask_coverage, vectorise, write_palette_png
from app.asset_review.kit_sightings import shoelace


def test_outer_rings_largest_first_holes_and_uncertain_dropped():
    rings = vectorise(draw_mask(), {1, 2, 3})
    assert len(rings) == 2
    assert sorted(map(tuple, rings[0])) == sorted(
        [(100.5, 100.5), (100.5, 199.5), (299.5, 199.5), (299.5, 100.5)]
    )
    assert sorted(map(tuple, rings[1])) == sorted(
        [(600.5, 400.5), (600.5, 419.5), (619.5, 419.5), (619.5, 400.5)]
    )


def test_a_disc_is_simplified_but_keeps_its_area():
    yy, xx = np.mgrid[0:200, 0:200]
    mask = (((xx - 100) ** 2 + (yy - 100) ** 2) <= 60**2).astype(np.uint8) * 3
    (ring,) = vectorise(mask, {3})
    assert 8 < len(ring) < 60
    assert shoelace(ring) == pytest.approx(int((mask > 0).sum()), rel=0.05)


def test_specks_below_the_minimum_area_are_dropped():
    mask = np.zeros((50, 50), np.uint8)
    mask[10:13, 10:13] = 1
    assert vectorise(mask, {1}) == []


def test_at_most_max_regions_largest_first():
    mask = np.zeros((200, 400), np.uint8)
    for k in range(60):
        r, c = divmod(k, 15)
        size = 5 + k % 7
        mask[10 + r * 40 : 10 + r * 40 + size, 10 + c * 25 : 10 + c * 25 + size] = 1
    rings = vectorise(mask, {1}, max_regions=50)
    areas = [shoelace(r) for r in rings]
    assert len(rings) == 50 and areas == sorted(areas, reverse=True)


def test_mask_coverage_counts_graded_pixels_only():
    assert mask_coverage(draw_mask(), {1, 2, 3}) == pytest.approx((200 * 100 - 40 * 20 + 400) / (1000 * 750))


def test_palette_png_keeps_the_class_indices(tmp_path):
    mask = draw_mask()
    out = write_palette_png(mask, KIT_CLASSES["stack"], tmp_path / "m.png")
    with Image.open(out) as im:
        assert im.mode == "P" and im.info.get("transparency") == 0
        assert im.getpalette()[6:9] == [255, 122, 45]  # class 2, the kit's "moderate" colour
    assert np.array_equal(load_mask(out), mask)
