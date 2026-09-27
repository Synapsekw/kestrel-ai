"""Distance, σ and GSD (spec 2026-09-26-image-inspection §9.3, decision I-D4, §17 "Distance and GSD")."""

import math

import pytest
from imagery_camera_helpers import fake_image

from app.imagery.camera import (
    Distance,
    Scale,
    area_sigma_m2,
    distance,
    focal_px_stored,
    gsd_mm,
    length_sigma_mm,
    scale,
)
from app.library.gsd import Intrinsics, image_gsd_cm

NADIR = dict(rel_alt=38.4, gimbal_pitch=-89.9)
M3E_MM = dict(focal_mm=12.29, sensor_w_mm=17.3, orig_w=5280, orig_h=3956)


def test_rule_order_manual_then_lrf_then_rel_alt_then_none():
    img = fake_image(subject_distance_m=12.5, lrf_distance_m=40.0, **NADIR)
    assert distance(img) == Distance(12.5, 0.0, "manual")
    img.subject_distance_m = None
    d = distance(img)
    assert d.source == "lrf" and d.d_m == 40.0 and d.sigma_m == pytest.approx(0.2 + 0.002 * 40.0)
    img.lrf_distance_m = None
    d = distance(img)
    assert d.source == "rel_alt" and d.sigma_m == 1.0
    assert d.d_m == pytest.approx(38.4 / math.cos(math.radians(0.1)))
    img.rel_alt = None
    assert distance(img) is None


def test_distance_unpacks_as_the_spec_tuple():
    d_m, sigma, source = distance(fake_image(subject_distance_m=5.0))
    assert (d_m, sigma, source) == (5.0, 0.0, "manual")


@pytest.mark.parametrize("pitch,ok", [(-76.0, True), (-104.0, True), (-74.0, False), (-30.0, False)])
def test_rel_alt_only_within_15_degrees_of_nadir(pitch, ok):
    d = distance(fake_image(rel_alt=30.0, gimbal_pitch=pitch))
    assert (d is not None) is ok
    if ok:
        assert d.d_m == pytest.approx(30.0 / math.cos(math.radians(abs(pitch + 90))))


def test_non_positive_values_are_ignored():
    assert (
        distance(fake_image(subject_distance_m=0.0, lrf_distance_m=-1.0, rel_alt=0.0, gimbal_pitch=-90.0))
        is None
    )


def test_gsd_scales_calibrated_focal_px_to_the_stored_frame():
    img = fake_image(focal_px=3666.666504, **M3E_MM, **NADIR)
    f = 3666.666504 * 800 / 5280
    assert focal_px_stored(img) == pytest.approx(f)
    assert gsd_mm(img) == pytest.approx(distance(img).d_m * 1000 / f)


def test_gsd_without_focal_px_agrees_with_library_gsd():
    img = fake_image(**M3E_MM, **NADIR)
    d = distance(img).d_m
    want_mm = image_gsd_cm(d, Intrinsics(12.29, 17.3, "focal_plane"), 800) * 10
    assert gsd_mm(img) == pytest.approx(want_mm, rel=1e-9)
    assert focal_px_stored(img) == pytest.approx(12.29 * 800 / 17.3)


def test_portrait_stored_frame_has_the_same_gsd():
    landscape = fake_image(focal_px=3666.666504, **M3E_MM, **NADIR)
    portrait = fake_image(width=600, height=800, focal_px=3666.666504, **M3E_MM, **NADIR)
    assert gsd_mm(portrait) == pytest.approx(gsd_mm(landscape))


def test_no_intrinsics_or_no_distance_gives_no_gsd():
    assert gsd_mm(fake_image(**NADIR)) is None and scale(fake_image(**NADIR)) is None
    assert gsd_mm(fake_image(**M3E_MM)) is None


def test_scale_is_c0s_dataclass():
    img = fake_image(lrf_distance_m=40.0, **M3E_MM)
    s = scale(img)
    assert isinstance(s, Scale)
    assert (s.distance_m, s.distance_source) == (40.0, "lrf")
    assert s.distance_sigma_m == pytest.approx(0.28)
    assert s.gsd_mm == pytest.approx(gsd_mm(img))


def test_sigma_formulas():
    s = scale(fake_image(**M3E_MM, **NADIR))
    assert s is not None and s.distance_source == "rel_alt"
    d = s.distance_m
    assert length_sigma_mm(100.0, s) == pytest.approx(100.0 * 1.0 / d + math.sqrt(2) * s.gsd_mm)
    assert area_sigma_m2(2.0, s) == pytest.approx(2 * 2.0 * 1.0 / d)
    manual = scale(fake_image(subject_distance_m=10.0, **M3E_MM))
    assert length_sigma_mm(100.0, manual) == pytest.approx(math.sqrt(2) * manual.gsd_mm)
