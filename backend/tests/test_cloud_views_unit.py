"""Report views, the pure parts (spec 2026-09-26-point-cloud-workspace sections 11.1, 11.2, 13):
the staleness hashes, the Pillow check and the `meta` parse."""

import json
import math

import pytest
from cloud_views import META, gif, jpeg, meta_json, noise_png, png

from app.errors import AppError
from app.pointclouds import views


def _code(e: pytest.ExceptionInfo) -> tuple[int, str, dict]:
    return e.value.status, e.value.code, e.value.details


def test_the_finding_hash_is_millimetre_rounded():
    base = views.finding_hash(243540.2, 3178030.5, 12.4)
    assert views.finding_hash(243540.2004, 3178030.5, 12.4) == base
    assert views.finding_hash(243540.2016, 3178030.5, 12.4) != base
    assert len(base) == 64 and int(base, 16) >= 0


def test_the_measurement_hash_follows_points_and_groups_not_uncertainty():
    pts = [
        {"x": 1.0, "y": 2.0, "z": 3.0, "uncertainty_m": 0.01},
        {"x": 4.0, "y": 5.0, "z": 6.0, "uncertainty_m": 0.01},
    ]
    base = views.measurement_hash(pts)
    assert views.measurement_hash([{**p, "uncertainty_m": 0.5} for p in pts]) == base
    assert views.measurement_hash([pts[0], {**pts[1], "z": 6.002}]) != base
    assert views.measurement_hash([{**pts[0], "group": 0}, {**pts[1], "group": 1}]) != base


def test_a_png_and_a_jpeg_of_the_view_size_pass():
    assert views.check_image(png()) == "png"
    assert views.check_image(jpeg()) == "jpg"


@pytest.mark.parametrize(
    ("data", "reason"),
    [
        (png(1599, 1000), "wrong_size"),
        (png(1000, 1600), "wrong_size"),
        (gif(), "wrong_format"),
        (b"", "not_an_image"),
        (b"not an image at all", "not_an_image"),
        (b"\x89PNG\r\n\x1a\n" + b"\0" * views.MAX_BYTES, "too_large"),
    ],
    # explicit ids: pytest's auto-generated id for the 6 MiB "too_large" payload overflows
    # Windows' PYTEST_CURRENT_TEST env var (32767 chars) and crashes test setup.
    ids=["wrong_size_w", "wrong_size_h", "wrong_format", "empty", "garbage", "too_large"],
)
def test_bad_images_are_refused_with_their_reason(data, reason):
    with pytest.raises(AppError) as e:
        views.check_image(data)
    assert _code(e) == (422, "bad_view_image", {"reason": reason})


def test_a_truncated_png_is_not_an_image():
    data = noise_png()
    assert views.check_image(data) == "png"
    with pytest.raises(AppError) as e:
        views.check_image(data[: len(data) // 2])
    assert _code(e) == (422, "bad_view_image", {"reason": "not_an_image"})


def test_stored_view_rejects_an_unknown_subject_kind(handle):
    with pytest.raises(ValueError):
        views.stored_view(handle, "widget", "x")


def test_meta_parses_and_normalises_a_finding_normal():
    meta = views.parse_meta(meta_json(anchor_normal=[0, 0, 2]), "finding")
    assert meta.anchor_normal == [0.0, 0.0, 1.0]
    assert meta.pose.fov_deg == 50 and meta.render.colour_mode == "rgb"


def test_meta_accepts_bytes_and_a_missing_normal():
    assert views.parse_meta(meta_json().encode(), "finding").anchor_normal is None


def test_a_zero_normal_is_stored_as_unknown():
    assert views.parse_meta(meta_json(anchor_normal=[0, 0, 0]), "finding").anchor_normal is None


def test_a_measurement_never_keeps_a_normal():
    assert views.parse_meta(meta_json(anchor_normal=[0, 1, 0]), "cloud_measurement").anchor_normal is None


@pytest.mark.parametrize(
    "raw",
    [
        "{not json",
        json.dumps({"pose": META["pose"]}),  # no render
        meta_json(extra=1),  # additionalProperties: false
        json.dumps({**META, "render": {**META["render"], "colour_mode": "plasma"}}),
        "x" * (views.MAX_META_BYTES + 1),
    ],
    # explicit ids: same Windows env-var overflow as above, this time from the 64 KiB+1 string.
    ids=["not_json", "no_render", "extra_field", "bad_colour_mode", "too_large"],
)
def test_malformed_meta_is_a_validation_error(raw):
    with pytest.raises(AppError) as e:
        views.parse_meta(raw, "finding")
    assert _code(e)[:2] == (422, "validation_error")


@pytest.mark.parametrize(
    "raw",
    [
        json.dumps({**META, "pose": {**META["pose"], "position": [math.nan, 0, 0]}}),
        json.dumps({**META, "pose": {**META["pose"], "target": [0, math.inf, 0]}}),
        meta_json(anchor_normal=[0, 0, math.nan]),
        '{"pose": {"position": [1e400, 0, 0], "target": [0, 1, 0], "up": [0, 0, 1], "fov_deg": 50},'
        ' "render": {"colour_mode": "rgb", "point_budget": 3000000, "point_size": 1.4, "edl": true,'
        ' "clip_box": null, "complete": true}}',
    ],
)
def test_non_finite_numbers_are_refused(raw):
    with pytest.raises(AppError) as e:
        views.parse_meta(raw, "finding")
    assert _code(e)[:2] == (422, "validation_error")
