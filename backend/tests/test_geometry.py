import json
import math
from pathlib import Path

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


def test_corners_at_ninety_degrees_pin_the_rotation_direction():
    """Clockwise in a y-down image: the unrotated top-left lands at the top-RIGHT.

    A sign-flipped (anticlockwise) implementation produces the same AABB at 90 degrees and the
    same centroid and side lengths at every angle, so the ordered corners are the only thing
    that pins the direction.
    """
    assert corners_of(10, 20, 30, 40, 90.0) == [
        pytest.approx((45.0, 25.0)),
        pytest.approx((45.0, 55.0)),
        pytest.approx((5.0, 55.0)),
        pytest.approx((5.0, 25.0)),
    ]


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
def test_aabb_matches_the_closed_form_for_a_rotated_rectangle(w, h, angle):
    """W = w|cos a| + h|sin a|, H = w|sin a| + h|cos a| — derived independently of corners_of,
    so unlike a min/max-over-corners check this can actually fail."""
    rad = math.radians(angle)
    cos, sin = abs(math.cos(rad)), abs(math.sin(rad))
    _, _, aw, ah = aabb_of(0, 0, w, h, angle)
    assert aw == pytest.approx(w * cos + h * sin, rel=1e-9)
    assert ah == pytest.approx(w * sin + h * cos, rel=1e-9)


@given(
    w=st.floats(1.0, 500),
    h=st.floats(1.0, 500),
    angle=st.floats(0.5, 179.5),
)
def test_the_top_edge_tilts_downward_to_the_right(w, h, angle):
    """The top edge vector is (w cos a, w sin a); in [0, 180) its y component is positive.

    y grows downward, so a positive dy means the edge tilts down to the right — clockwise.
    This is the property a mirrored implementation fails.
    """
    c = corners_of(0, 0, w, h, angle)
    assert c[1][1] > c[0][1]


FIXTURES = Path(__file__).resolve().parents[2] / "contract" / "fixtures" / "oriented-boxes.json"


@pytest.mark.parametrize("case", json.loads(FIXTURES.read_text("utf-8"))["cases"], ids=lambda c: c["name"])
def test_agrees_with_the_typescript_implementation(case):
    b = case["box"]
    got = corners_of(b["x"], b["y"], b["w"], b["h"], b["angle"])
    for (gx, gy), (ex, ey) in zip(got, case["corners"], strict=True):
        assert gx == pytest.approx(ex, abs=1e-9)
        assert gy == pytest.approx(ey, abs=1e-9)
    a = case["aabb"]
    assert aabb_of(b["x"], b["y"], b["w"], b["h"], b["angle"]) == pytest.approx(
        (a["x"], a["y"], a["w"], a["h"]), abs=1e-9
    )
