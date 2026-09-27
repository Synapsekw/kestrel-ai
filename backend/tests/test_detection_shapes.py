"""Detection shapes through the shared tiling path (image inspection spec §11.3, §10 step 4)."""

import json
import math
from dataclasses import asdict

import pytest

from app.providers.base import Detection, Tile
from app.providers.polygons import MAX_VERTICES, simplify_ring
from app.providers.tiling import iou, nms_per_class, not_covered_by, to_full_image

TILE = Tile(index=1, x=1000, y=500, w=1280, h=1280)


def _area(ring) -> float:
    n = len(ring)
    return (
        abs(sum(ring[i][0] * ring[(i + 1) % n][1] - ring[(i + 1) % n][0] * ring[i][1] for i in range(n))) / 2
    )


def test_a_plain_detection_is_a_box_and_its_envelope_is_itself():
    d = Detection("crack", 10, 20, 30, 40, 0.9)
    assert d.shape == "box" and d.angle == 0.0 and d.polygon is None
    assert d.envelope() == (10, 20, 30, 40)


def test_an_angled_detection_is_an_rbox_whose_envelope_holds_its_corners():
    d = Detection("crack", 0, 0, 100, 20, 0.9, angle=90.0)
    assert d.shape == "rbox"
    assert tuple(round(v, 6) for v in d.envelope()) == (40.0, -40.0, 20.0, 100.0)


def test_from_polygon_takes_the_axis_aligned_envelope():
    d = Detection.from_polygon("spall", [(10, 10), (60, 15), (40, 50)], 0.8)
    assert d.shape == "polygon"
    assert (d.x, d.y, d.w, d.h) == (10, 10, 50, 40)
    assert d.envelope() == (10, 10, 50, 40)


def test_a_polygon_survives_the_tile_cache_json_round_trip():
    d = Detection.from_polygon("spall", [(10.5, 10), (60, 15), (40, 50)], 0.8, raw_ref="r")
    back = Detection(**json.loads(json.dumps(asdict(d))))
    assert back == d
    assert isinstance(back.polygon, tuple) and isinstance(back.polygon[0], tuple)


def test_a_tile_cache_entry_written_before_shapes_still_loads():
    back = Detection(**{"label": "a", "x": 1, "y": 2, "w": 3, "h": 4, "confidence": 0.5, "raw_ref": ""})
    assert back.shape == "box" and back.polygon is None and back.angle == 0.0


def test_to_full_image_clamps_a_polygon_to_its_tile_and_offsets_it():
    d = Detection.from_polygon("spall", [(-5, 10), (100, 10), (100, 1300)], 0.7)
    moved = to_full_image(d, TILE)
    assert moved.polygon == ((1000.0, 510.0), (1100.0, 510.0), (1100.0, 1780.0))
    assert (moved.x, moved.y, moved.w, moved.h) == (1000.0, 510.0, 100.0, 1270.0)
    assert moved.confidence == 0.7


def test_to_full_image_offsets_an_rbox_without_touching_its_size_or_angle():
    moved = to_full_image(Detection("c", 10, 20, 300, 40, 0.9, angle=30.0), TILE)
    assert (moved.x, moved.y, moved.w, moved.h, moved.angle) == (1010, 520, 300, 40, 30.0)


def test_to_full_image_still_clamps_a_plain_box():
    moved = to_full_image(Detection("a", -5, -5, 2000, 2000, 0.5), TILE)
    assert (moved.x, moved.y, moved.w, moved.h) == (1000, 500, 1280, 1280)


def test_iou_compares_envelopes_so_a_quarter_turn_rbox_matches_its_upright_twin():
    rbox = Detection("c", 0, 0, 100, 20, 0.9, angle=90.0)
    upright = Detection("c", 40, -40, 20, 100, 0.8)
    assert iou(rbox, upright) == pytest.approx(1.0)
    assert nms_per_class([rbox, upright], 0.5) == [rbox]
    assert not_covered_by([upright], [rbox], 0.5) == []


def test_simplify_ring_bounds_a_dense_outline_and_keeps_its_area():
    circle = [
        (500 + 200 * math.cos(2 * math.pi * t / 2000), 500 + 200 * math.sin(2 * math.pi * t / 2000))
        for t in range(2000)
    ]
    ring = simplify_ring(circle)
    assert 3 <= len(ring) <= MAX_VERTICES
    assert _area(ring) == pytest.approx(math.pi * 200**2, rel=0.03)
    assert len(simplify_ring(circle, max_vertices=8)) <= 8


def test_simplify_ring_keeps_a_square_and_drops_slivers():
    assert len(simplify_ring([(0, 0), (50, 0), (50, 50), (0, 50)])) == 4
    assert simplify_ring([(0, 0), (1, 0), (0, 1)]) is None  # 0.5 px², under the 4 px² floor
    assert simplify_ring([(0, 0), (10, 10)]) is None
