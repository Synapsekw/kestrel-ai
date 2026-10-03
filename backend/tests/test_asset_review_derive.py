# backend/tests/test_asset_review_derive.py
"""Height, bearing, side and zone (spec 2026-10-02-asset-findings §7)."""

import pytest

from app.asset_review.derive import NOT_PLACED, Derived, component_name, derive, side_of, zone_of
from app.asset_review.frame import Frame
from app.asset_review.profiles import ComponentRule, resolve

TOWER = resolve("telecom_tower", 42.0)  # antenna >= 33.6, body 4.2 to 33.6, base < 4.2
FACADE = resolve("building_facade", 60.0)
OHTL = resolve("ohtl_tower", 50.0)
PLAIN = Frame(height_m=42.0)


def test_an_unplaced_point_has_no_height_side_or_zone():
    """Spec §7 and plan R7: never the camera target's height (the kit's 88.98 m on a 74.4 m building)."""
    assert derive(None, None, TOWER, PLAIN) == NOT_PLACED == Derived(None, None, None, None)
    assert derive(None, (1.0, 0.0, 0.0), FACADE, PLAIN) == NOT_PLACED


def test_height_is_the_centre_y_and_bearing_is_atan2_z_x():
    d = derive((0.5, 30.35, -0.375), None, TOWER, PLAIN)
    assert d.height_m == 30.35
    assert d.bearing_deg == pytest.approx(323.13010235415595, abs=1e-9)
    assert (d.side, d.zone) == ("NW", "body")


@pytest.mark.parametrize(
    ("bearing", "side"),
    [
        (0.0, "N"),
        (22.4, "N"),
        (22.5, "NE"),  # half up; the kit's round() gave N here
        (67.5, "E"),
        (112.4, "E"),
        (180.0, "S"),
        (202.5, "SW"),
        (270.0, "W"),
        (337.4, "NW"),
        (337.5, "N"),
        (359.9, "N"),
    ],
)
def test_compass_sides_are_eight_45_degree_sectors(bearing, side):
    assert side_of(bearing, TOWER, PLAIN) == side


def test_compass_sides_use_the_true_bearing_but_store_the_plant_bearing():
    rotated = Frame(height_m=42.0, north_offset_deg=90.0)
    d = derive((5.0, 10.0, 0.0), None, TOWER, rotated)
    assert d.bearing_deg == 0.0 and d.side == "E"


@pytest.mark.parametrize(
    ("bearing", "face"),
    [
        (30.0, "Line ahead"),
        (74.9, "Line ahead"),
        (75.0, "Right face"),
        (120.0, "Right face"),
        (210.0, "Line back"),
        (300.0, "Left face"),
        (345.0, "Line ahead"),
    ],
)
def test_faces_are_relative_to_the_line_azimuth(bearing, face):
    assert side_of(bearing, OHTL, Frame(height_m=50.0, line_azimuth_deg=30.0)) == face


def test_faces_without_a_line_azimuth_are_relative_to_north():
    assert side_of(90.0, OHTL, Frame(height_m=50.0)) == "Right face"


def test_facade_side_comes_from_the_normal_when_it_is_horizontal_enough():
    frame = Frame(height_m=60.0, line_azimuth_deg=340.0)
    centre = (10.0, 5.0, 0.0)  # plant bearing 0: relative to the line 20 deg, the north elevation
    assert derive(centre, None, FACADE, frame).side == "North elevation"
    facing_east = derive(centre, (0.0, 0.0, 1.0), FACADE, frame)
    assert facing_east.bearing_deg == 90.0 and facing_east.side == "East elevation"  # 110 deg off the line
    assert derive(centre, (0.0, 0.0, -1.0), FACADE, frame).side == "West elevation"  # 270 - 340 = 290
    # horizontal part 0.2828 and exactly 0.3: not more than 0.3, so the position decides
    assert derive(centre, (0.2, 0.95, 0.2), FACADE, frame).bearing_deg == 0.0
    assert derive(centre, (0.0, 0.9, 0.3), FACADE, frame).bearing_deg == 0.0
    assert derive(centre, (0.0, 0.9, 0.3000001), FACADE, frame).bearing_deg == 90.0


def test_basis_position_ignores_the_normal():
    assert derive((1.0, 5.0, 0.0), (0.0, 0.0, 1.0), TOWER, PLAIN).bearing_deg == 0.0


@pytest.mark.parametrize(
    ("h", "zone"),
    [(100.0, "antenna"), (33.6, "antenna"), (33.59, "body"), (4.2, "body"), (4.19, "base"), (-5.0, "base")],
)
def test_zones_are_min_inclusive_and_top_first(h, zone):
    assert zone_of(h, TOWER) == zone


def test_a_height_in_a_gap_between_zones_falls_back_like_the_kit():
    gappy = resolve(
        "tank",
        40.0,
        {
            "zones": [
                {"id": "upper", "label": "Upper", "min": 20, "max": 30},
                {"id": "lower", "label": "Lower", "min": 0, "max": 10},
            ]
        },
    )
    assert zone_of(25.0, gappy) == "upper"
    assert zone_of(15.0, gappy) == "lower"  # below the top zone's minimum: the bottom zone
    assert zone_of(35.0, gappy) == "upper"  # at or above the top zone's minimum: the top zone
    assert zone_of(-1.0, gappy) == "lower"


def test_no_zones_means_no_zone():
    bare = resolve("tank", 40.0, {"zones": []})
    assert zone_of(10.0, bare) is None
    assert derive((1.0, 10.0, 0.0), None, bare, PLAIN).zone is None


@pytest.mark.parametrize(
    ("node", "want"),
    [
        ("Leg_000", "Leg"),
        ("Antenna mount_012", "Antenna mount"),
        ("flare-tip.003", "Flare tip"),
        ("Shell", "Shell"),
        ("___", None),
        ("", None),
        (None, None),
    ],
)
def test_component_name_cleans_the_node_name(node, want):
    assert component_name(node, []) == want


def test_component_map_rules_win_in_order_and_ignore_case():
    rules = [ComponentRule(match=r"^leg", label="Tower leg"), ComponentRule(match="LEG|brac", label="Steel")]
    assert component_name("Leg_000", rules) == "Tower leg"
    assert component_name("Bracing_004", rules) == "Steel"
    assert component_name("Platform_200", rules) == "Platform"
