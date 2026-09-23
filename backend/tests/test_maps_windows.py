import numpy as np
import pytest

from app.maps.windows import (
    MapWindow,
    StripMerger,
    drop_cut_boxes,
    gsd_scale,
    masked_fraction,
    plan_windows,
    strips,
    to_map,
)
from app.providers.base import Detection


def det(x, y, w=50, h=40, conf=0.9, label="excavator"):
    return Detection(label=label, x=x, y=y, w=w, h=h, confidence=conf)


def test_gsd_scale():
    assert gsd_scale(None, 2.0) == 1.0
    assert gsd_scale(3.0, None) == 1.0
    assert gsd_scale(3.0, 2.9) == 1.0  # within 15 %
    assert gsd_scale(3.0, 2.0) == pytest.approx(1.5)  # map coarser than training: upsample
    assert gsd_scale(1.0, 2.0) == pytest.approx(0.5)


def test_unscaled_windows_cover_the_map_exactly():
    wins = plan_windows(3000, 2000, 1280, 0.2, 1.0)
    assert wins[0] == MapWindow(0, 0, 0, 1280, 1280, 1280, 1280)
    assert max(w.x + w.w for w in wins) == 3000 and max(w.y + w.h for w in wins) == 2000
    assert all(w.out_w == w.w and w.out_h == w.h for w in wins)
    assert [w.index for w in wins] == list(range(len(wins)))


def test_scaled_windows_read_more_map_pixels_per_model_pixel():
    wins = plan_windows(4000, 2000, 1280, 0.2, 0.5)
    first = wins[0]
    assert (first.out_w, first.out_h) == (1280, 1000)  # virtual map is 2000 x 1000
    assert (first.w, first.h) == (2560, 2000)
    assert max(w.x + w.w for w in wins) == 4000


def test_strips_group_by_row():
    wins = plan_windows(3000, 2000, 1280, 0.2, 1.0)
    rows = strips(wins)
    assert len(rows) == 2 and all(len({w.y for w in r}) == 1 for r in rows)


def test_to_map_scales_and_offsets():
    win = MapWindow(3, 1000, 500, 2560, 2560, 1280, 1280)
    d = to_map(det(10, 20, 30, 40), win)
    assert (d.x, d.y, d.w, d.h) == (1020, 540, 60, 80)


def test_masked_fraction():
    mask = np.ones((100, 200), dtype=bool)
    mask[:, :100] = False  # left half nodata
    scale = 0.1  # mask px per map px: the map is 2000 x 1000
    assert masked_fraction(mask, scale, MapWindow(0, 0, 0, 500, 500, 500, 500)) == 1.0
    assert masked_fraction(mask, scale, MapWindow(0, 1000, 0, 500, 500, 500, 500)) == 0.0
    assert masked_fraction(mask, scale, MapWindow(0, 750, 0, 500, 500, 500, 500)) == pytest.approx(0.5)


def test_merger_joins_a_box_split_by_a_horizontal_seam():
    m = StripMerger(0.5)
    out = m.add_strip(0, [det(1000, 100, conf=0.9), det(1005, 102, conf=0.8)])
    assert out == []
    assert len(m.finish()) == 1


def test_merger_joins_a_box_split_by_a_strip_boundary():
    m = StripMerger(0.5)
    m.add_strip(0, [det(100, 1010)])
    m.add_strip(1024, [det(102, 1012, conf=0.7)])
    kept = m.finish()
    assert len(kept) == 1 and kept[0].confidence == 0.9


def test_merger_releases_boxes_that_later_strips_cannot_touch():
    m = StripMerger(0.5)
    m.add_strip(0, [det(100, 100), det(100, 1000)])
    released = m.add_strip(1024, [det(500, 1100)])
    assert [d.y for d in released] == [100]  # ends at 140 < 1024: final
    assert sorted(d.y for d in m.finish()) == [1000, 1100]


def test_drop_cut_boxes_only_on_interior_edges_and_only_small_slivers():
    win = MapWindow(1, 1024, 0, 1280, 1280, 1280, 1280)  # a middle window of a 4000 x 1280 map
    cut_left = det(1024, 100, w=30)  # touches the interior left edge, 30 px < 256 overlap: dropped
    cut_right_big = det(1900, 100, w=404)  # touches the right edge (2304) but is 404 px: kept
    inside = det(1500, 100)
    at_map_top = det(1500, 0)  # y = 0 is the map's own edge, not a seam: kept
    kept = drop_cut_boxes([cut_left, cut_right_big, inside, at_map_top], win, 4000, 1280, 256)
    assert kept == [cut_right_big, inside, at_map_top]


def test_merger_keeps_different_classes_apart():
    m = StripMerger(0.5)
    m.add_strip(0, [det(100, 100, label="excavator"), det(100, 100, label="dump_truck", conf=0.8)])
    assert len(m.finish()) == 2
