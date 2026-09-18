"""Tiling geometry and per-class NMS (spec section 8, Tiling)."""

import pytest
from PIL import Image

from app.providers.base import Detection, Tile, TilingSpec
from app.providers.tiling import crop_tile, iou, make_tiles, nms_per_class, to_full_image


def det(label, x, y, w, h, c=0.9):
    return Detection(label=label, x=x, y=y, w=w, h=h, confidence=c)


def test_large_frame_tiles_into_a_four_by_three_grid():
    tiles = make_tiles(4000, 2667, TilingSpec())
    assert [t.x for t in tiles[:4]] == [0, 1024, 2048, 2720]
    assert sorted({t.y for t in tiles}) == [0, 1024, 1387]
    assert len(tiles) == 12
    assert [t.index for t in tiles] == list(range(12))


def test_every_tile_is_full_size_and_inside_the_image():
    for t in make_tiles(4000, 2667, TilingSpec()):
        assert (t.w, t.h) == (1280, 1280)
        assert 0 <= t.x and t.x + t.w <= 4000
        assert 0 <= t.y and t.y + t.h <= 2667


@pytest.mark.parametrize(
    "width,height",
    [
        (4000, 2667),  # both sides larger than the tile
        (1920, 1080),  # only the height fits in one tile
        (4000, 800),   # a wide strip: the height is far below the tile size
        (900, 3000),   # a tall strip: the width is far below the tile size
        (1280, 1280),  # exactly one tile
    ],
)
def test_no_tile_ever_leaves_the_image(width, height):
    tiles = make_tiles(width, height, TilingSpec())
    assert tiles
    for t in tiles:
        assert 0 <= t.x and t.x + t.w <= width, t
        assert 0 <= t.y and t.y + t.h <= height, t
        assert t.w > 0 and t.h > 0


def test_a_short_image_is_one_row_of_tiles_as_tall_as_the_image():
    tiles = make_tiles(4000, 800, TilingSpec())
    assert {t.h for t in tiles} == {800}
    assert {t.y for t in tiles} == {0}
    assert [t.x for t in tiles] == [0, 1024, 2048, 2720]


def test_tiles_are_row_major():
    tiles = make_tiles(4000, 2667, TilingSpec())
    assert [(t.y, t.x) for t in tiles] == sorted((t.y, t.x) for t in tiles)


def test_small_image_is_one_tile_covering_it():
    assert make_tiles(800, 600, TilingSpec()) == [Tile(index=0, x=0, y=0, w=800, h=600)]


def test_disabled_tiling_is_one_tile_covering_the_whole_image():
    assert make_tiles(4000, 2667, TilingSpec(enabled=False)) == [Tile(index=0, x=0, y=0, w=4000, h=2667)]


def test_crop_tile_returns_the_tile_window():
    image = Image.new("RGB", (4000, 2667))
    crop = crop_tile(image, Tile(index=1, x=1024, y=0, w=1280, h=1280))
    assert crop.size == (1280, 1280)


def test_to_full_image_offsets_by_the_tile_origin():
    moved = to_full_image(det("a", 10, 20, 30, 40), Tile(index=1, x=1024, y=512, w=1280, h=1280))
    assert (moved.x, moved.y, moved.w, moved.h) == (1034, 532, 30, 40)


def test_to_full_image_clamps_to_the_tile():
    moved = to_full_image(det("a", -5, -5, 2000, 2000), Tile(index=0, x=100, y=100, w=1280, h=1280))
    assert (moved.x, moved.y, moved.w, moved.h) == (100, 100, 1280, 1280)


def test_iou_of_identical_boxes_is_one_and_disjoint_is_zero():
    a = det("a", 0, 0, 100, 100)
    assert iou(a, a) == pytest.approx(1.0)
    assert iou(a, det("a", 500, 500, 100, 100)) == pytest.approx(0.0)


def test_nms_keeps_the_highest_of_two_overlapping_same_class_boxes():
    # 100x100 boxes offset by 18 px overlap with IoU ~0.7.
    low = det("truck", 0, 0, 100, 100, 0.6)
    high = det("truck", 18, 0, 100, 100, 0.8)
    assert iou(low, high) > 0.5
    assert nms_per_class([low, high], 0.5) == [high]


def test_nms_keeps_both_when_the_classes_differ():
    a = det("truck", 0, 0, 100, 100, 0.6)
    b = det("car", 18, 0, 100, 100, 0.8)
    assert sorted(d.label for d in nms_per_class([a, b], 0.5)) == ["car", "truck"]


def test_nms_keeps_both_when_the_overlap_is_small():
    # 100x100 boxes offset by 55 px overlap with IoU ~0.3.
    a = det("truck", 0, 0, 100, 100, 0.6)
    b = det("truck", 55, 0, 100, 100, 0.8)
    assert 0.2 < iou(a, b) < 0.4
    assert len(nms_per_class([a, b], 0.5)) == 2
