"""The seams I-C0 fixes for the batch-2/3 units (plan 2026-09-27-images-c0, "Seams"). These pin the
signatures only, so they stay green when I-BX, I-BK, I-BT and I-BS replace the bodies: a unit that
must change a signature changes this test and tells its consumers."""

import dataclasses
import inspect

import numpy as np


def _params(fn) -> list[tuple[str, str]]:
    return [(p.name, p.kind.name) for p in inspect.signature(fn).parameters.values()]


def test_summary_touch_takes_the_session_and_an_image_id():
    from app.imagery.summary import touch

    assert _params(touch) == [("s", "POSITIONAL_OR_KEYWORD"), ("image_id", "POSITIONAL_OR_KEYWORD")]


def test_camera_scale_answers_a_scale_or_none():
    from app.imagery.camera import Scale, scale

    assert _params(scale) == [("image", "POSITIONAL_OR_KEYWORD")]
    assert [f.name for f in dataclasses.fields(Scale)] == [
        "distance_m",
        "distance_sigma_m",
        "distance_source",
        "gsd_mm",
    ]


def test_label_writer_and_inclusion_rule_signatures():
    from app.imagery.labels import expressible, write_labels

    positional = "POSITIONAL_OR_KEYWORD"
    assert _params(write_labels) == [
        ("task", positional),
        ("labels", positional),
        ("class_index", positional),
        ("width", positional),
        ("height", positional),
        ("boxes_as_polygons", "KEYWORD_ONLY"),
    ]
    assert _params(expressible) == [
        ("task", positional),
        ("labels", positional),
        ("type_ids", positional),
        ("boxes_as_polygons", "KEYWORD_ONLY"),
    ]


class _FakeDisc:
    """The offline seam spec §17 asks for: a disc around the first positive point."""

    def encode(self, rgb, device):
        return rgb.shape[:2]

    def decode(self, embedding, points, labels, device):
        h, w = embedding
        yy, xx = np.mgrid[:h, :w]
        x, y = points[0]
        return (xx - x) ** 2 + (yy - y) ** 2 <= 20**2, 0.9

    def close(self):
        pass


def test_segment_backend_is_a_protocol_a_fake_satisfies():
    from app.assist.sam import SegmentBackend

    fake = _FakeDisc()
    assert isinstance(fake, SegmentBackend)
    mask, score = fake.decode(fake.encode(np.zeros((64, 64, 3), np.uint8), "cpu"), [(32.0, 32.0)], [1], "cpu")
    assert mask.shape == (64, 64) and mask[32, 32] and score == 0.9
    assert [n for n, _ in _params(SegmentBackend.encode)] == ["self", "rgb", "device"]
    assert [n for n, _ in _params(SegmentBackend.decode)] == [
        "self",
        "embedding",
        "points",
        "labels",
        "device",
    ]
