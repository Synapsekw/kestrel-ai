"""The scale a model was trained at (spec 2026-09-23-model-training-gsd-design section 2-3).

The numbers are the real senseFly Aeria X frames behind ICVD_V3: focal 18.5 mm, a 23.456 mm
sensor read off FocalPlaneXResolution, flown at a median 191.02 m, letterboxed to imgsz 1280.
"""

import pytest

from app.training.gsd import (
    PLAUSIBLE_M,
    Intrinsics,
    image_gsd_cm,
    intrinsics_from_exif,
    model_gsd_cm,
    plausible,
)

AERIA_X = Intrinsics(focal_mm=18.5, sensor_width_mm=23.4558, source="focal_plane")


class FakeExif:
    """Pillow's Exif exposes the EXIF IFD through get_ifd(0x8769); that is all we read."""

    def __init__(self, ifd: dict):
        self._ifd = ifd

    def get_ifd(self, tag: int) -> dict:
        return self._ifd


def test_sensor_width_from_focal_plane_resolution_in_cm():
    # 6000 px across a sensor sampled at 2558 px/cm is 2.3456 cm.
    intr = intrinsics_from_exif(FakeExif({0x920A: 18.5, 0xA002: 6000, 0xA20E: 2558.0, 0xA210: 3}))
    assert intr is not None
    assert intr.source == "focal_plane"
    assert intr.sensor_width_mm == pytest.approx(23.456, abs=0.01)
    assert intr.focal_mm == pytest.approx(18.5)


def test_sensor_width_from_focal_plane_resolution_in_inches():
    # Same sensor, expressed as 6497.3 px/inch.
    intr = intrinsics_from_exif(FakeExif({0x920A: 18.5, 0xA002: 6000, 0xA20E: 6497.32, 0xA210: 2}))
    assert intr is not None
    assert intr.sensor_width_mm == pytest.approx(23.456, abs=0.05)


def test_sensor_width_falls_back_to_the_35mm_crop_factor():
    intr = intrinsics_from_exif(FakeExif({0x920A: 18.5, 0xA405: 28}))
    assert intr is not None
    assert intr.source == "crop_factor"
    # 36 mm / (28/18.5) = 23.79 mm, within 1.5 % of the focal-plane answer.
    assert intr.sensor_width_mm == pytest.approx(23.79, abs=0.05)


def test_no_focal_length_yields_no_estimate():
    assert intrinsics_from_exif(FakeExif({0xA002: 6000, 0xA20E: 2558.0, 0xA210: 3})) is None


def test_focal_length_alone_is_not_enough():
    assert intrinsics_from_exif(FakeExif({0x920A: 18.5})) is None


def test_the_real_icvd_v3_numbers():
    img = image_gsd_cm(191.02175, AERIA_X, 4000)
    assert img == pytest.approx(6.055, abs=0.01)
    assert model_gsd_cm(img, 4000, 2667, 1280) == pytest.approx(18.92, abs=0.02)


def test_the_letterbox_scales_by_the_long_side():
    img = 6.055
    # Landscape: the width is the long side.
    assert model_gsd_cm(img, 4000, 2667, 1280) == pytest.approx(img * 4000 / 1280)
    # Portrait: the height is, and the long side is still what maps to imgsz.
    assert model_gsd_cm(img, 2667, 4000, 1280) == pytest.approx(img * 4000 / 1280)


def test_plausibility_accepts_real_machinery():
    # ICVD_V3's own classes at 6.055 cm/px: roller 5.07 m ... crane 17.94 m, median 8.51 m.
    assert plausible(8.51) is True
    assert plausible(PLAUSIBLE_M[0] + 0.1) is True
    assert plausible(PLAUSIBLE_M[1] - 0.1) is True


def test_plausibility_rejects_an_order_of_magnitude_error():
    # What the band is for. A 4x altitude error claims 34 m dump trucks; a 10x-too-fine scale
    # claims 0.85 m ones. Both are caught.
    assert plausible(8.51 * 4) is False
    assert plausible(0.85) is False


def test_plausibility_does_not_catch_a_subtle_error():
    # Deliberate, and the reason section 4 asks the operator to confirm: an altitude wrong by 2x
    # still lands on 17 m machines, which is inside the band. The band is a smoke alarm, not a
    # proof. If this test ever fails, the band was narrowed and section 3.3 needs revisiting.
    assert plausible(8.51 * 2) is True
