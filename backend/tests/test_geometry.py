import math

import pytest
from hypothesis import given
from hypothesis import strategies as st

from app.geometry import aabb_of, centre_of, corners_of, normalise_angle


def test_normalise_angle_wraps_at_one_eighty():
    assert normalise_angle(0.0) == 0.0
    assert normalise_angle(190.0) == 10.0
    assert normalise_angle(-10.0) == 170.0
    assert normalise_angle(180.0) == 0.0
    assert normalise_angle(360.0) == 0.0


def test_centre_of_is_the_middle_of_the_unrotated_box():
    assert centre_of(10, 20, 30, 40) == (25.0, 40.0)


def test_corners_at_zero_angle_are_the_plain_rectangle():
    assert corners_of(10, 20, 30, 40, 0.0) == [
        (10.0, 20.0),
        (40.0, 20.0),
        (40.0, 60.0),
        (10.0, 60.0),
    ]


def test_corners_at_ninety_degrees_swap_the_sides():
    """A 30x40 box rotated 90 degrees about its centre occupies a 40x30 footprint."""
    x, y, w, h = aabb_of(10, 20, 30, 40, 90.0)
    assert (round(x, 6), round(y, 6), round(w, 6), round(h, 6)) == (5.0, 25.0, 40.0, 30.0)


def test_aabb_at_zero_angle_is_the_box_itself():
    assert aabb_of(10, 20, 30, 40, 0.0) == (10.0, 20.0, 30.0, 40.0)


@given(
    x=st.floats(-500, 500),
    y=st.floats(-500, 500),
    w=st.floats(0.1, 500),
    h=st.floats(0.1, 500),
    angle=st.floats(0, 179.999),
)
def test_corners_always_keep_the_centre_and_the_side_lengths(x, y, w, h, angle):
    """Rotation is rigid: the centre does not move and no side changes length."""
    cx, cy = centre_of(x, y, w, h)
    c = corners_of(x, y, w, h, angle)
    mx = sum(p[0] for p in c) / 4
    my = sum(p[1] for p in c) / 4
    assert mx == pytest.approx(cx, abs=1e-6)
    assert my == pytest.approx(cy, abs=1e-6)
    top = math.dist(c[0], c[1])
    right = math.dist(c[1], c[2])
    assert top == pytest.approx(w, rel=1e-6)
    assert right == pytest.approx(h, rel=1e-6)


@given(
    w=st.floats(0.1, 500),
    h=st.floats(0.1, 500),
    angle=st.floats(0, 179.999),
)
def test_aabb_always_contains_every_corner(w, h, angle):
    ax, ay, aw, ah = aabb_of(0, 0, w, h, angle)
    for px, py in corners_of(0, 0, w, h, angle):
        assert ax - 1e-6 <= px <= ax + aw + 1e-6
        assert ay - 1e-6 <= py <= ay + ah + 1e-6
