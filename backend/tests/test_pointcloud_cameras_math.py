"""Cameras payload math (spec 2026-09-26-point-cloud-workspace section 10.1 steps 2-4, section 4.2).

The yaw-rule cases are I-BK's (plan 2026-09-27-images-bk, test_yaw_sanity_rule) so the two copies
of I's rule agree (C-B3 Ruling 4).
"""

import math

import numpy as np
import pytest
from pyproj import CRS, Transformer

from app.pointclouds import cameras
from app.pointclouds.cameras import Pose, effective_yaw, fov_deg, grid_yaw, search_box

UTM39 = CRS.from_epsg(32639)


def pose(**kw) -> Pose:
    base = dict(
        yaw=None,
        pitch=None,
        roll=None,
        focal_px=None,
        focal_mm=None,
        sensor_w_mm=None,
        orig_w=None,
        orig_h=None,
    )
    return Pose(**{**base, **kw})


def full_angle(half_tan: float) -> float:
    return 2 * math.degrees(math.atan(half_tan))


def half_tan(full_deg: float) -> float:
    return math.tan(math.radians(full_deg / 2))


# ------------------------------------------------------------------------------------------- FOV


def test_fov_from_the_calibrated_focal_length_in_pixels():
    h, v, assumed = fov_deg(5280, 3956, pose(focal_px=3713.3, orig_w=5280, orig_h=3956))
    assert h == pytest.approx(full_angle(5280 / (2 * 3713.3)), abs=1e-9)
    assert half_tan(v) / half_tan(h) == pytest.approx(3956 / 5280, abs=1e-12)
    assert assumed is False


def test_fov_from_f35_through_the_sensor_width():
    # I stores sensor_w_mm = 36 * focal_mm / f35 (library/gsd.py crop-factor rule): a 24 mm-equivalent lens.
    h, v, assumed = fov_deg(5472, 3648, pose(focal_mm=8.8, sensor_w_mm=36 * 8.8 / 24))
    assert h == pytest.approx(full_angle(36 / 48), abs=1e-9)  # 73.74 deg
    assert v == pytest.approx(full_angle(0.75 * 3648 / 5472), abs=1e-9)
    assert assumed is False


def test_focal_px_wins_over_focal_mm():
    by_px = fov_deg(
        5280, 3956, pose(focal_px=3713.3, orig_w=5280, orig_h=3956, focal_mm=1.0, sensor_w_mm=50.0)
    )
    assert by_px[0] == pytest.approx(full_angle(5280 / (2 * 3713.3)), abs=1e-9)


def test_the_assumed_fov_is_an_84_degree_diagonal():
    h, v, assumed = fov_deg(4000, 3000, pose())
    t = math.tan(math.radians(42))
    assert assumed is True
    assert h == pytest.approx(full_angle(t * 0.8), abs=1e-9)
    assert v == pytest.approx(full_angle(t * 0.6), abs=1e-9)
    assert full_angle(math.hypot(half_tan(h), half_tan(v))) == pytest.approx(84.0, abs=1e-9)


def test_the_fov_ignores_the_import_downscale():
    lens = pose(focal_mm=8.8, sensor_w_mm=13.2)
    full, small = fov_deg(5472, 3648, lens), fov_deg(4000, 2667, lens)
    assert small[0] == pytest.approx(full[0], abs=1e-9)
    assert small[1] == pytest.approx(full[1], abs=0.02)  # 2667 vs 2666.67: rounding only


def test_a_portrait_stored_frame_puts_the_long_fov_on_the_vertical():
    lens = pose(focal_mm=8.8, sensor_w_mm=13.2)
    land, port = fov_deg(5472, 3648, lens), fov_deg(3648, 5472, lens)
    assert port[0] == pytest.approx(land[1], abs=1e-9)
    assert port[1] == pytest.approx(land[0], abs=1e-9)
    by_px = fov_deg(3956, 5280, pose(focal_px=3713.3, orig_w=5280, orig_h=3956))
    assert by_px[1] == pytest.approx(full_angle(5280 / (2 * 3713.3)), abs=1e-9)


def test_zero_or_negative_lens_values_fall_through_to_the_assumed_fov():
    lens = pose(focal_px=0.0, orig_w=4000, orig_h=3000, focal_mm=-1.0, sensor_w_mm=13.2)
    assert fov_deg(4000, 3000, lens)[2] is True
    assert fov_deg(4000, 3000, pose(focal_px=3000.0, orig_w=None, orig_h=3000))[2] is True


# ------------------------------------------------------------------------------ yaw rule and pose


def test_yaw_sanity_rule():
    assert effective_yaw(-89.0, 170.0, 10.0) == 10.0  # near nadir, 160 deg apart: body-relative gimbal yaw
    assert effective_yaw(-45.0, 170.0, 10.0) == 170.0  # oblique: trust the gimbal
    assert effective_yaw(-89.0, 170.0, None) == 170.0
    assert effective_yaw(None, None, 33.0) == 33.0
    assert effective_yaw(-89.0, None, None) is None


def test_yaw_sanity_uses_the_short_way_round():
    assert effective_yaw(-89.0, -170.0, 175.0) == -170.0  # 15 deg apart across the wrap, not 345


def test_pose_columns_reads_i_columns_and_applies_the_yaw_rule():
    p = cameras._pose_columns(
        {
            "gimbal_yaw": 170.0,
            "gimbal_pitch": -89.0,
            "gimbal_roll": 0.5,
            "flight_yaw": 10.0,
            "focal_px": None,
            "focal_mm": 8.8,
            "sensor_w_mm": 13.2,
            "orig_w": 5472,
            "orig_h": 3648,
        }
    )
    assert (p.yaw, p.pitch, p.roll, p.focal_mm, p.sensor_w_mm, p.orig_w, p.orig_h) == (
        10.0,
        -89.0,
        0.5,
        8.8,
        13.2,
        5472,
        3648,
    )
    assert p.posed is True


def test_pose_columns_treats_junk_as_missing():
    p = cameras._pose_columns({"gimbal_yaw": float("nan"), "gimbal_pitch": float("inf"), "orig_w": 0})
    assert (p.yaw, p.pitch, p.orig_w) == (None, None, None)
    assert p.posed is False


def test_pose_columns_without_i_columns_is_position_only():
    p = cameras._pose_columns({})
    assert p == pose() and p.posed is False


def test_a_yaw_without_a_pitch_is_not_posed():
    assert cameras._pose_columns({"gimbal_yaw": 12.0}).posed is False


def test_every_pose_column_exists_on_image():
    from app.db.models import Image

    assert set(cameras.POSE_COLUMNS) == {
        "gimbal_yaw",
        "gimbal_pitch",
        "gimbal_roll",
        "flight_yaw",
        "focal_px",
        "focal_mm",
        "sensor_w_mm",
        "orig_w",
        "orig_h",
    }
    assert all(hasattr(Image, column) for column in cameras.POSE_COLUMNS.values())
    assert len(cameras.pose_select()) == len(cameras.POSE_COLUMNS)


def test_pose_select_skips_a_column_the_table_lacks(monkeypatch):
    monkeypatch.setitem(cameras.POSE_COLUMNS, "gimbal_yaw", "no_such_column")
    assert len(cameras.pose_select()) == len(cameras.POSE_COLUMNS) - 1


# ---------------------------------------------------------------------- grid yaw (convergence)


def _true_north_bearing(lon: float, lat: float) -> float:
    """The grid bearing of a short walk north along a true meridian: independent of get_factors."""
    t = Transformer.from_crs(4326, 32639, always_xy=True)
    x0, y0 = t.transform(lon, lat)
    x1, y1 = t.transform(lon, lat + 1e-3)
    return math.degrees(math.atan2(x1 - x0, y1 - y0))


@pytest.mark.parametrize("lon", [48.375, 53.0])  # west and east of UTM 39N's central meridian (51 E)
def test_grid_yaw_follows_a_true_meridian(lon):
    lat = 28.704
    bearing = _true_north_bearing(lon, lat)
    assert abs(bearing) > 0.9  # the place really has a convergence, so the sign is pinned
    got = grid_yaw(UTM39, np.array([lon, lon]), np.array([lat, lat]), np.array([0.0, 90.0]))
    assert got[0] == pytest.approx(bearing % 360.0, abs=1e-4)
    assert got[1] == pytest.approx((90.0 + bearing) % 360.0, abs=1e-4)


def test_grid_yaw_wraps_into_0_360():
    lon, lat = 48.375, 28.704
    bearing = _true_north_bearing(lon, lat)  # about +1.26
    got = grid_yaw(UTM39, np.array([lon]), np.array([lat]), np.array([359.5]))
    assert 0.0 <= got[0] < 360.0
    assert got[0] == pytest.approx(359.5 + bearing - 360.0, abs=1e-4)


# ---------------------------------------------------------------------------------- search box

BOX_WGS84 = [48.3744, 28.7038, 48.3755, 28.7048]


def test_the_buffer_is_at_least_100_m():
    native = [243500.0, 3178000.0, -45.0, 243600.0, 3178100.0, 175.0]  # 141 m diagonal -> 70.7 < 100
    minlon, minlat, maxlon, maxlat = search_box(BOX_WGS84, native, UTM39)
    assert BOX_WGS84[1] - minlat == pytest.approx(100.0 / cameras.M_PER_DEG_LAT, rel=1e-9)
    assert maxlat - BOX_WGS84[3] == pytest.approx(100.0 / cameras.M_PER_DEG_LAT, rel=1e-9)
    per_deg_lon = cameras.M_PER_DEG_LAT * math.cos(math.radians(28.7048))
    assert BOX_WGS84[0] - minlon == pytest.approx(100.0 / per_deg_lon, rel=1e-9)
    assert maxlon - BOX_WGS84[2] == pytest.approx(100.0 / per_deg_lon, rel=1e-9)


def test_the_buffer_is_half_the_diagonal_of_a_large_cloud():
    native = [243500.0, 3178000.0, -45.0, 244500.0, 3179000.0, 175.0]  # 1414 m diagonal
    _, minlat, _, _ = search_box(BOX_WGS84, native, UTM39)
    assert BOX_WGS84[1] - minlat == pytest.approx(
        0.5 * math.hypot(1000, 1000) / cameras.M_PER_DEG_LAT, rel=1e-9
    )


def test_a_feet_crs_converts_the_diagonal_to_metres():
    feet = CRS.from_epsg(2229)  # NAD83 / California zone 5 (ftUS)
    side_ft = 1000.0 / feet.axis_info[0].unit_conversion_factor  # 1000 m in US survey feet
    native = [0.0, 0.0, 0.0, side_ft, side_ft, 10.0]
    _, minlat, _, _ = search_box(BOX_WGS84, native, feet)
    assert BOX_WGS84[1] - minlat == pytest.approx(
        0.5 * math.hypot(1000, 1000) / cameras.M_PER_DEG_LAT, rel=1e-6
    )


def test_without_native_bounds_the_buffer_is_100_m():
    _, minlat, _, _ = search_box(BOX_WGS84, None, UTM39)
    assert BOX_WGS84[1] - minlat == pytest.approx(100.0 / cameras.M_PER_DEG_LAT, rel=1e-9)
