"""C-B1: the headline of C's new cloud measurement kinds in M's project-wide list (workspace spec
2026-09-26 section 12 row 19; M spec section 4 item 8)."""

import pytest

from app.pointclouds.headline import headline_for

A = {"x": 243500.0, "y": 3178000.0, "z": 5.0, "uncertainty_m": 0.01}
B = {"x": 243503.0, "y": 3178004.0, "z": 5.0, "uncertainty_m": 0.01}


def test_an_area_headlines_its_primary_area():
    # Units are M-C0's MeasurementUnit values (m2, not m²): the union validates them.
    assert headline_for("area", {"mode": "plan"}, {"area_m2": 1.5, "area_surface_m2": 3.0}, [A, B]) == (
        1.5,
        "m2",
    )


def test_a_profile_headlines_its_length_and_is_null_while_computing():
    assert headline_for("profile", None, {"profile_length_m": 12.5}, [A, B]) == (12.5, "m")
    # M-C0's MeasurementItem.headline: "null while computing, failed, or not mapped yet".
    assert headline_for("profile", None, {}, [A, B]) == (None, "m")
    assert headline_for("profile", None, None, None) == (None, "m")


@pytest.mark.parametrize("kind", ["point", "distance", "height", "vertical"])
def test_the_s1_kinds_keep_the_generic_headline(kind):
    assert headline_for(kind, None, {"distance_3d": 5.0}, [A, B]) is None
