"""YOLO label writers for detect, obb and segment, and the inclusion rule (image spec §11.1, I-D10)."""

import pytest

from app.geometry import aabb_of, corners_of
from app.imagery import labels
from app.imagery.labels import detect_boxes, expressible, label_text, unexpressible_shapes, write_labels

IDX = {"t-crack": 0, "t-exc": 1}
W, H = 200, 100


def lab(**over) -> dict:
    base = {"type_id": "t-exc", "shape": "box", "x": 50.0, "y": 20.0, "w": 60.0, "h": 30.0, "angle": 0.0}
    base.update(over)
    return base


def poly(points, type_id="t-crack") -> dict:
    xs, ys = [p[0] for p in points], [p[1] for p in points]
    return {
        "type_id": type_id,
        "shape": "polygon",
        "x": min(xs),
        "y": min(ys),
        "w": max(xs) - min(xs),
        "h": max(ys) - min(ys),
        "angle": 0.0,
        "points": [list(p) for p in points],
    }


def rows(text: str) -> list[list[float]]:
    return [[float(v) for v in line.split()] for line in text.splitlines()]


# ------------------------------------------------------------------ detect (parity with today)


def test_detect_is_todays_label_text_verbatim():
    boxes = [{"class_id": "t-exc", "x": 1000, "y": 600, "w": 400, "h": 300}]
    assert label_text(boxes, IDX, 4000, 3000) == "1 0.300000 0.250000 0.100000 0.100000\n"
    assert write_labels("detect", [lab(x=1000, y=600, w=400, h=300)], IDX, 4000, 3000) == (
        "1 0.300000 0.250000 0.100000 0.100000\n"
    )


def test_detect_clips_per_edge_like_today():
    # An envelope running off the right edge: the emitted box is a sub-rectangle of the frame.
    text = write_labels("detect", [lab(x=180, y=10, w=60, h=30, angle=30.0, shape="rbox")], IDX, W, H)
    x, y, w, h = aabb_of(180, 10, 60, 30, 30.0)
    left, right = max(x, 0) / W, min(x + w, W) / W
    top, bottom = max(y, 0) / H, min(y + h, H) / H
    assert rows(text)[0][1:] == pytest.approx(
        [(left + right) / 2, (top + bottom) / 2, right - left, bottom - top], abs=1e-6
    )
    assert all(0.0 <= v <= 1.0 for v in rows(text)[0][1:])


def test_detect_writes_a_polygon_as_its_envelope():
    p = poly([(10, 10), (60, 20), (40, 70)])
    assert rows(write_labels("detect", [p], IDX, W, H))[0] == pytest.approx(
        [0, 35 / W, 40 / H, 50 / W, 60 / H], abs=1e-6
    )


def test_detect_boxes_is_the_envelope_flattening_moved_from_materialise():
    out = detect_boxes([{"class_id": "c", "x": 50, "y": 20, "w": 60, "h": 30, "angle": 30.0}])
    assert out == [{"class_id": "c", **dict(zip("xywh", aabb_of(50, 20, 60, 30, 30.0), strict=True))}]


def test_unknown_types_and_points_are_left_out():
    text = write_labels("detect", [lab(type_id="gone"), lab(shape="point", w=0, h=0), lab()], IDX, W, H)
    assert [r[0] for r in rows(text)] == [1]
    assert write_labels("detect", [], IDX, W, H) == ""


# ------------------------------------------------------------------ obb


def test_obb_writes_the_rotated_corners_of_an_rbox():
    text = write_labels("obb", [lab(shape="rbox", angle=30.0)], IDX, W, H)
    expected = [v for px, py in corners_of(50, 20, 60, 30, 30.0) for v in (px / W, py / H)]
    assert rows(text)[0] == pytest.approx([1, *[min(max(v, 0.0), 1.0) for v in expected]], abs=1e-6)


def test_obb_writes_the_minimum_rotated_rectangle_of_a_polygon():
    # A thin diagonal crack: its minimum rotated rectangle is the 4 corners of the quad itself.
    quad = [(20, 20), (30, 10), (90, 70), (80, 80)]
    line = rows(write_labels("obb", [poly(quad)], IDX, W, H))[0]
    assert line[0] == 0 and len(line) == 9
    got = sorted((round(line[i] * W, 3), round(line[i + 1] * H, 3)) for i in range(1, 9, 2))
    assert got == pytest.approx(sorted(quad), abs=1e-3)


def test_obb_keeps_legacy_labels_without_a_shape():
    legacy = {"type_id": "t-exc", "x": 50, "y": 20, "w": 60, "h": 30, "angle": 30.0}
    assert write_labels("obb", [legacy], IDX, W, H) == write_labels(
        "obb", [lab(shape="rbox", angle=30.0)], IDX, W, H
    )


# ------------------------------------------------------------------ segment


def test_segment_writes_polygon_vertices_normalised():
    p = poly([(10, 10), (60, 20), (40, 70)])
    line = rows(write_labels("segment", [p], IDX, W, H))[0]
    assert line[0] == 0 and len(line) == 1 + 2 * 3
    pts = sorted((round(line[i] * W, 3), round(line[i + 1] * H, 3)) for i in range(1, len(line), 2))
    assert pts == pytest.approx(sorted([(10, 10), (60, 20), (40, 70)]), abs=1e-3)


def test_segment_multipart_clip_writes_one_line_per_part():
    # A "C" opening left whose back lies outside the frame: clipping at x = 200 leaves two arms.
    c = poly([(160, 10), (240, 10), (240, 90), (160, 90), (160, 70), (220, 70), (220, 30), (160, 30)])
    lines = rows(write_labels("segment", [c], IDX, W, H))
    assert len(lines) == 2
    for line in lines:
        assert line[0] == 0 and len(line) >= 7
        assert all(0.0 <= v <= 1.0 for v in line[1:])


def test_segment_drops_a_polygon_left_entirely_outside():
    outside = poly([(210, 10), (260, 10), (230, 60)])
    assert write_labels("segment", [outside], IDX, W, H) == ""


def test_segment_leaves_boxes_out_unless_boxes_as_polygons():
    assert write_labels("segment", [lab()], IDX, W, H) == ""
    line = rows(write_labels("segment", [lab()], IDX, W, H, boxes_as_polygons=True))[0]
    pts = sorted((round(line[i] * W, 3), round(line[i + 1] * H, 3)) for i in range(1, 9, 2))
    assert pts == pytest.approx(sorted([(50, 20), (110, 20), (110, 50), (50, 50)]), abs=1e-3)


def test_segment_writes_an_rbox_as_its_rotated_outline_with_boxes_as_polygons():
    text = write_labels("segment", [lab(shape="rbox", angle=30.0)], IDX, W, H, boxes_as_polygons=True)
    assert len(rows(text)[0]) == 9


# ------------------------------------------------------------------ inclusion (I-D10)


@pytest.mark.parametrize(
    ("task", "bap", "expected"),
    [
        ("detect", False, ("point",)),
        ("obb", False, ("point",)),
        ("segment", False, ("point", "box", "rbox")),
        ("segment", True, ("point",)),
    ],
)
def test_unexpressible_shapes(task, bap, expected):
    assert unexpressible_shapes(task, boxes_as_polygons=bap) == expected


def test_expressible_needs_every_label_of_the_chosen_types():
    p = poly([(10, 10), (60, 20), (40, 70)])
    types = set(IDX)
    assert expressible("segment", [p], types)
    assert not expressible("segment", [p, lab()], types)
    assert expressible("segment", [p, lab()], types, boxes_as_polygons=True)
    assert not expressible("detect", [lab(), lab(shape="point", w=0, h=0)], types)
    assert expressible("detect", [], types)  # a marked-empty image enters as a negative
    assert expressible("segment", [p, lab()], {"t-crack"})  # the box's type is not chosen


def test_shape_of_reads_legacy_labels():
    assert labels.shape_of({"x": 0, "y": 0, "w": 1, "h": 1}) == "box"
    assert labels.shape_of({"x": 0, "y": 0, "w": 1, "h": 1, "angle": 12.0}) == "rbox"
    assert labels.shape_of({"shape": "polygon"}) == "polygon"
