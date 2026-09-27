"""DJI XMP and EXIF camera reading (spec 2026-09-26-image-inspection §7.3, §17 "XMP")."""

import pytest
from imagery_camera_helpers import M3E_XMP, MINI_XMP, dji_jpeg, h20t_xmp
from PIL import Image

from app.datasets.prepare import CAMERA_FIELDS, CameraMeta, parse_xmp, read_camera, read_xmp


def test_attribute_form_m3e():
    got = parse_xmp(M3E_XMP)
    assert got == {
        "rel_alt": 38.40,
        "gimbal_roll": 0.0,
        "gimbal_yaw": -12.30,
        "gimbal_pitch": -89.90,
        "flight_yaw": -11.60,
        "focal_px": pytest.approx(3666.666504),
    }


def test_element_form_and_signs_mini():
    got = parse_xmp(MINI_XMP)
    assert got["rel_alt"] == 25.10 and got["gimbal_pitch"] == -45.0
    assert got["gimbal_yaw"] == -170.50 and got["flight_yaw"] == 178.20
    assert "focal_px" not in got and "lrf_distance_m" not in got


def test_lrf_only_when_status_normal():
    assert parse_xmp(h20t_xmp())["lrf_distance_m"] == pytest.approx(87.512)
    assert "lrf_distance_m" not in parse_xmp(h20t_xmp(status="TooFar"))
    assert "lrf_distance_m" not in parse_xmp(h20t_xmp(distance="0.000"))
    assert "lrf_distance_m" not in parse_xmp(h20t_xmp(distance="5000"))


def test_absent_or_empty_xmp():
    assert parse_xmp(None) == {} and parse_xmp(b"") == {} and parse_xmp("<x/>") == {}


def test_junk_values_are_skipped():
    packet = (
        b'drone-dji:RelativeAltitude="N/A" drone-dji:GimbalPitchDegree=" -45.5 " '
        b'drone-dji:GimbalYawDegree="nan" drone-dji:FlightYawDegree="+1'
    )
    assert parse_xmp(packet) == {"gimbal_pitch": -45.5}


def test_attribute_wins_over_element():
    packet = (
        b'<drone-dji:RelativeAltitude>10</drone-dji:RelativeAltitude><d drone-dji:RelativeAltitude="+20.5"/>'
    )
    assert parse_xmp(packet) == {"rel_alt": 20.5}


def test_read_xmp_from_a_saved_jpeg(tmp_path):
    path = dji_jpeg(tmp_path / "a.jpg")
    with Image.open(path) as im:
        assert read_xmp(im)["rel_alt"] == 38.40


def test_read_camera_original_combines_xmp_and_exif(tmp_path):
    path = dji_jpeg(tmp_path / "a.jpg")
    with Image.open(path) as im:
        cam = read_camera(im, original=True)
    assert cam.has_xmp and cam.rel_alt == 38.40 and cam.gimbal_pitch == -89.90
    assert cam.focal_mm == pytest.approx(12.29) and cam.sensor_w_mm == pytest.approx(17.3, abs=1e-3)
    assert (cam.orig_w, cam.orig_h) == (5280, 3956) and cam.camera_model == "M3E"


def test_read_camera_non_dji_falls_back_to_pixel_size_only_for_originals(tmp_path):
    path = dji_jpeg(tmp_path / "b.jpg", xmp=None, orig=None, sensor_w_mm=None, model=None)
    with Image.open(path) as im:
        original = read_camera(im, original=True)
        prepared = read_camera(im, original=False)
    assert not original.has_xmp and original.rel_alt is None
    assert (original.orig_w, original.orig_h) == (800, 600)
    assert (prepared.orig_w, prepared.orig_h) == (None, None)


def test_camera_fields_are_the_frozen_column_names():
    assert CAMERA_FIELDS == (
        "rel_alt",
        "gimbal_pitch",
        "gimbal_yaw",
        "gimbal_roll",
        "flight_yaw",
        "lrf_distance_m",
        "focal_px",
        "focal_mm",
        "sensor_w_mm",
        "orig_w",
        "orig_h",
        "camera_model",
    )
    assert set(CAMERA_FIELDS) <= set(vars(CameraMeta()))
