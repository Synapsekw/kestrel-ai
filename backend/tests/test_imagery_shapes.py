"""Shape validation and repair (spec 2026-09-26-image-inspection section 8.2), pure functions."""

import math
from types import SimpleNamespace

import pytest
from shapely.geometry import Polygon

from app.errors import AppError
from app.imagery.shapes import MAX_VERTICES, outline, polygon_fields, shape_fields

W, H = 320, 240


def _code(fn, *a, **kw) -> str:
    with pytest.raises(AppError) as e:
        fn(*a, **kw)
    return e.value.code


def test_box_at_angle_zero_is_a_box_and_must_lie_inside():
    f = shape_fields(W, H, x=10, y=20, w=30, h=40)
    assert (f.shape, f.x, f.y, f.w, f.h, f.angle, f.points, f.area_px) == (
        "box",
        10,
        20,
        30,
        40,
        0.0,
        None,
        1200,
    )
    assert _code(shape_fields, W, H, x=-1, y=0, w=10, h=10) == "out_of_bounds"


def test_rbox_follows_the_angle_whatever_the_client_said():
    assert shape_fields(W, H, shape="box", x=10, y=20, w=30, h=40, angle=190).shape == "rbox"
    rot = shape_fields(W, H, shape="rbox", x=10, y=20, w=30, h=40, angle=180)
    assert (rot.shape, rot.angle) == ("box", 0.0)


def test_rbox_may_overhang_but_its_centre_must_be_inside():
    assert shape_fields(W, H, x=-10, y=-5, w=40, h=20, angle=30).shape == "rbox"
    assert _code(shape_fields, W, H, x=400, y=10, w=10, h=10, angle=30) == "out_of_bounds"


def test_non_positive_side_or_missing_field_is_invalid_shape():
    assert _code(shape_fields, W, H, x=1, y=1, w=0, h=5) == "invalid_shape"
    assert _code(shape_fields, W, H, x=1, y=1, w=5) == "invalid_shape"
    assert _code(shape_fields, W, H, shape="point", x=1) == "invalid_shape"
    assert _code(shape_fields, W, H, shape="polygon") == "invalid_shape"


def test_point_is_inside_and_has_no_extent_and_ignores_rect_fields_on_create():
    f = shape_fields(W, H, shape="point", x=5, y=6, w=9, h=9, angle=30)
    assert (f.shape, f.x, f.y, f.w, f.h, f.angle, f.area_px) == ("point", 5, 6, 0, 0, 0.0, 0.0)
    assert _code(shape_fields, W, H, shape="point", x=W + 1, y=6) == "out_of_bounds"


def test_polygon_ignores_rect_fields_on_create_and_rects_refuse_points():
    f = shape_fields(W, H, shape="polygon", x=999, w=1, points=[[10, 10], [60, 10], [60, 40], [10, 40]])
    assert (f.x, f.w) == (10, 50)
    assert _code(shape_fields, W, H, shape="box", x=1, y=1, w=5, h=5, points=[[0, 0], [1, 0], [0, 1]]) == (
        "invalid_shape"
    )


def test_valid_polygon_keeps_its_vertices_and_gets_its_envelope():
    f = polygon_fields(W, H, [[10, 10], [60, 10], [60, 40], [10, 40]])
    assert f.shape == "polygon" and f.angle == 0.0 and not f.repaired
    assert (f.x, f.y, f.w, f.h) == (10, 10, 50, 30)
    assert f.area_px == 1500
    assert Polygon(f.points).exterior.is_ccw
    assert len(f.points) == 4  # no closing vertex


def test_orientation_and_start_vertex_alone_are_not_a_repair():
    assert not polygon_fields(W, H, [[60, 40], [60, 10], [10, 10], [10, 40]]).repaired


def test_bowtie_keeps_largest_part():
    f = polygon_fields(W, H, [[0, 0], [100, 100], [100, 0], [0, 60]])
    assert f.repaired
    poly = Polygon(f.points)
    assert poly.is_valid and poly.exterior.is_ccw
    assert (f.x, f.y, f.x + f.w, f.y + f.h) == pytest.approx(poly.bounds)
    # The bowtie self-intersects at (37.5, 37.5), splitting it into two triangular lobes:
    # (0,60)-(37.5,37.5)-(0,0) with area 1125, and (100,100)-(100,0)-(37.5,37.5) with area
    # 3125 (the larger one, kept). Assert the exact kept area rather than a loose bound.
    assert f.area_px == pytest.approx(3125.0, abs=0.5)


def test_polygon_is_clipped_to_the_image():
    f = polygon_fields(W, H, [[300, 200], [400, 200], [400, 300], [300, 300]])
    assert f.repaired
    assert (f.x, f.y, f.w, f.h) == (300, 200, 20, 40)


def test_polygon_entirely_outside_is_empty():
    assert _code(polygon_fields, W, H, [[400, 400], [500, 400], [500, 500]]) == "empty_polygon"


def test_degenerate_polygons_are_empty():
    assert _code(polygon_fields, W, H, [[0, 0], [10, 0], [0, 0]]) == "empty_polygon"  # 2 distinct
    assert _code(polygon_fields, W, H, [[0, 0], [10, 10], [20, 20]]) == "empty_polygon"  # collinear
    assert _code(polygon_fields, W, H, [[0, 0], [1, 0], [1, 1], [0, 1]]) == "empty_polygon"  # 1 px2 < 4


def test_more_than_max_vertices_is_invalid_shape():
    many = [[160 + 100 * math.cos(i / 400), 120 + 100 * math.sin(i / 400)] for i in range(MAX_VERTICES + 1)]
    assert _code(polygon_fields, W, H, many) == "invalid_shape"


def test_coordinates_are_rounded_to_a_tenth():
    f = polygon_fields(W, H, [[10.04, 10.06], [60.01, 10], [60, 40], [10, 40]])
    assert [10.0, 10.1] in f.points
    assert all(round(v, 1) == v for p in f.points for v in p)


def test_outline_of_each_shape():
    box = SimpleNamespace(shape="box", x=0, y=0, w=2, h=1, angle=0.0, points=None)
    assert outline(box) == [(0, 0), (2, 0), (2, 1), (0, 1)]
    poly = SimpleNamespace(shape="polygon", x=0, y=0, w=1, h=1, angle=0.0, points=[[0, 0], [1, 0], [1, 1]])
    assert outline(poly) == [(0, 0), (1, 0), (1, 1)]
    assert outline(SimpleNamespace(shape="point", x=1, y=1, w=0, h=0, angle=0.0, points=None)) is None
    rbox = SimpleNamespace(shape="rbox", x=0, y=0, w=2, h=2, angle=90.0, points=None)
    assert len(outline(rbox)) == 4
