"""The asset frame model and bearing helpers (spec 2026-10-02-asset-findings §5.1, A7)."""

import json
import math

import pytest
from pydantic import ValidationError

from app.asset_review.frame import Frame, Origin, Preset, norm_deg, plant_bearing, true_bearing, true_to_plant


def test_a_frame_needs_only_a_height():
    f = Frame(height_m=42.0)
    assert f.origin is None
    assert (f.north_offset_deg, f.datum_label, f.datum_note, f.line_azimuth_deg) == (0.0, "Ground", "", None)
    assert (f.silhouette, f.levels, f.presets) == ([], [], [])


def test_angles_are_wrapped_into_0_360():
    f = Frame(height_m=10.0, north_offset_deg=-10.0, line_azimuth_deg=370.0)
    assert (f.north_offset_deg, f.line_azimuth_deg) == (350.0, 10.0)


def test_silhouette_and_levels_are_sorted_by_height():
    f = Frame(height_m=10.0, silhouette=[(8.0, 1.0), (0.0, 2.0)], levels=[6.0, 1.5, 3.0])
    assert f.silhouette == [(0.0, 2.0), (8.0, 1.0)]
    assert f.levels == [1.5, 3.0, 6.0]


@pytest.mark.parametrize(
    "bad",
    [
        {"height_m": 0.0},
        {"height_m": -1.0},
        {"height_m": 5.0, "silhouette": [(1.0, -0.1)]},
        {"height_m": 5.0, "origin": {"lat": 91.0, "lon": 0.0, "ground_alt_m": 0.0}},
        {"height_m": 5.0, "presets": [{"id": "", "label": "x", "target": [0, 0, 0], "camera": [1, 1, 1]}]},
        {"height_m": 5.0, "unknown": 1},
    ],
)
def test_invalid_frames_are_rejected(bad):
    with pytest.raises(ValidationError):
        Frame.model_validate(bad)


def test_a_frame_round_trips_through_json():
    f = Frame(
        origin=Origin(lat=24.4539, lon=54.3773, ground_alt_m=5.0),
        north_offset_deg=12.5,
        height_m=42.0,
        datum_label="Slab",
        datum_note="Top of the foundation slab",
        line_azimuth_deg=340.0,
        silhouette=[(0.0, 4.243), (36.0, 1.273)],
        levels=[30.0, 36.0],
        presets=[Preset(id="top", label="Top", target=(0.0, 39.2, 0.0), camera=(8.0, 42.0, 8.0))],
    )
    raw = json.loads(json.dumps(f.model_dump(mode="json")))
    assert raw["silhouette"] == [[0.0, 4.243], [36.0, 1.273]]
    assert raw["presets"][0]["target"] == [0.0, 39.2, 0.0]
    assert Frame.model_validate(raw) == f


@pytest.mark.parametrize(
    ("deg", "want"),
    [(0.0, 0.0), (-10.0, 350.0), (360.0, 0.0), (725.0, 5.0), (-360.0, 0.0), (359.5, 359.5), (-1e-14, 0.0)],
)
def test_norm_deg(deg, want):
    got = norm_deg(deg)
    assert got == pytest.approx(want, abs=1e-9) and 0.0 <= got < 360.0
    assert math.copysign(1.0, got) == 1.0  # never -0.0


@pytest.mark.parametrize(
    ("x", "z", "want"),
    [
        (1.0, 0.0, 0.0),
        (0.0, 1.0, 90.0),
        (-1.0, 0.0, 180.0),
        (0.0, -1.0, 270.0),
        (1.0, 1.0, 45.0),
        (1.0, -0.0, 0.0),
    ],
)
def test_plant_bearing_is_clockwise_from_plant_north(x, z, want):
    assert plant_bearing(x, z) == pytest.approx(want, abs=1e-12)


def test_true_bearing_adds_the_north_offset():
    assert true_bearing(350.0, Frame(height_m=1.0, north_offset_deg=20.0)) == pytest.approx(10.0)
    assert true_bearing(45.0, Frame(height_m=1.0)) == 45.0


def test_true_to_plant_rotates_by_the_north_offset():
    assert true_to_plant(3.0, 4.0, 0.0) == pytest.approx((3.0, 4.0))
    # plant +X points true east: a true-north offset is plant -Z, a true-east offset is plant +X
    assert true_to_plant(1.0, 0.0, 90.0) == pytest.approx((0.0, -1.0), abs=1e-12)
    assert true_to_plant(0.0, 1.0, 90.0) == pytest.approx((1.0, 0.0), abs=1e-12)
    x, z = true_to_plant(10.0, 0.0, 30.0)
    assert plant_bearing(x, z) == pytest.approx(330.0)  # true 0 is plant -30
