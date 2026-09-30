"""R3: image crop snapshots (spec 2026-09-26-reports §9.2, §17): rotated box, polygon near the edge
shifted not clipped, JPEG draft choice, a point pin, the bomb guard, and a 60 MP memory bound."""

import math
import os

import pytest
from PIL import Image as PILImage
from report_snapshot_helpers import add_box, add_image, image_crop_spec, near, write_grey

from app.geometry import corners_of
from app.reports.snapshots import SnapshotUnavailable
from app.reports.snapshots.image_crop import (
    compact_ring,
    crop_box,
    decode_crop,
    pick_reduction,
    render,
    render_crop,
    ring_of,
    source_version,
)
from app.reports.snapshots.keys import MAX_SPEC_CHARS, encode_spec

RED = (255, 0, 0)
ASPECT = 1200 / 900


def test_ring_of_every_annotation_shape():
    assert ring_of("point", 50.0, 60.0, 0.0, 0.0) == [[50.0, 60.0]]
    assert ring_of("box", 10, 20, 30, 40) == [[10.0, 20.0], [40.0, 20.0], [40.0, 60.0], [10.0, 60.0]]
    rbox = ring_of("rbox", 900, 700, 200, 100, 30.0)
    assert rbox == [[round(x, 1), round(y, 1)] for x, y in corners_of(900, 700, 200, 100, 30.0)]
    assert ring_of("polygon", 0, 0, 10, 10, 0.0, [[0, 0], [10, 0], [10, 10]]) == [
        [0.0, 0.0],
        [10.0, 0.0],
        [10.0, 10.0],
    ]


def test_a_dense_polygon_is_compacted_under_the_url_budget():
    ring = [
        [1000 + 300 * math.cos(2 * math.pi * i / 2000), 800 + 300 * math.sin(2 * math.pi * i / 2000)]
        for i in range(2000)
    ]
    small = compact_ring(ring)
    assert 3 <= len(small) <= 200
    spec = {
        "kind": "image_crop",
        "image_id": "i" * 36,
        "annotation_id": "b" * 36,
        "ring": small,
        "colour": "#ff5a4f",
        "label": "F-0042 · Crack",
        "context": 3.0,
        "out": [1200, 900],
        "inset": True,
    }
    assert len(encode_spec(spec)) < MAX_SPEC_CHARS


def test_a_polygon_near_the_edge_shifts_the_crop_inside_the_image():
    ring = [[1950.0, 700.0], [1995.0, 700.0], [1995.0, 760.0], [1950.0, 760.0]]
    x0, y0, x1, y1 = crop_box(ring, 2000, 1500, context=3.0, aspect=ASPECT)
    assert x1 == 2000 and x0 >= 0 and y0 >= 0 and y1 <= 1500
    assert abs((x1 - x0) / (y1 - y0) - ASPECT) < 0.01  # 4:3 kept at full size, not clipped
    assert x1 - x0 >= 512
    assert all(x0 <= x <= x1 and y0 <= y <= y1 for x, y in ring)


def test_a_crop_never_exceeds_a_small_image():
    assert crop_box([[50.0, 50.0]], 400, 300, context=3.0, aspect=ASPECT) == (0, 0, 400, 300)


def test_pick_reduction_takes_the_largest_that_keeps_out():
    assert pick_reduction(4000, 3000, 1200, 900) == 2
    assert pick_reduction(9600, 7200, 1200, 900) == 8
    assert pick_reduction(8934, 6700, 1200, 900) == 4
    assert pick_reduction(1000, 750, 1200, 900) == 1


def test_a_jpeg_decodes_draft_reduced_and_a_png_at_full_size(tmp_path):
    ring = [[1200.0, 900.0], [2800.0, 900.0], [2800.0, 2100.0], [1200.0, 2100.0]]
    jpeg = decode_crop(write_grey(tmp_path / "a.jpg", (4000, 3000)), ring, context=3.0, out=(1200, 900))
    assert jpeg.box == (0, 0, 4000, 3000) and jpeg.reduction == 2 and jpeg.decoded_size == (2000, 1500)
    png = decode_crop(write_grey(tmp_path / "a.png", (4000, 3000), "PNG"), ring, context=3.0, out=(1200, 900))
    assert png.reduction == 2 and png.decoded_size == (4000, 3000)


def test_a_rotated_box_is_drawn_at_its_rotated_corners(tmp_path):
    path = write_grey(tmp_path / "a.jpg", (2000, 1500))
    ring = ring_of("rbox", 900, 700, 200, 100, 30.0)
    img = render_crop(path, ring, colour="#ff0000", label=None, context=3.0, out=(1200, 900))
    assert img.size == (1200, 900)
    x0, y0, x1, y1 = crop_box(ring, 2000, 1500, context=3.0, aspect=ASPECT)
    sx, sy = 1200 / (x1 - x0), 900 / (y1 - y0)
    for px, py in ring:
        assert near(img, ((px - x0) * sx, (py - y0) * sy), RED), (px, py)
    # the unrotated box's top-left corner lies well off the rotated outline
    assert not near(img, ((900 - x0) * sx, (700 - y0) * sy), RED)


def test_a_point_is_a_pin_with_its_label_above(tmp_path):
    path = write_grey(tmp_path / "p.jpg", (2000, 1500))
    ring = ring_of("point", 400, 300, 0, 0)
    img = render_crop(path, ring, colour="#ff0000", label="F-0003 · Leak", context=3.0, out=(1200, 900))
    x0, y0, x1, y1 = crop_box(ring, 2000, 1500, context=3.0, aspect=ASPECT)
    cx, cy = (400 - x0) * 1200 / (x1 - x0), (300 - y0) * 900 / (y1 - y0)
    assert img.getpixel((round(cx), round(cy))) == RED


def test_an_image_above_max_image_pixels_is_unavailable_not_an_error(tmp_path, monkeypatch):
    path = write_grey(tmp_path / "a.jpg", (400, 300))
    monkeypatch.setattr(PILImage, "MAX_IMAGE_PIXELS", 1000)
    with pytest.raises(SnapshotUnavailable, match="too large"):
        decode_crop(path, [[10.0, 10.0]], context=3.0, out=(1200, 900))


def test_a_60_mp_photo_decodes_draft_reduced_under_a_bound(tmp_path):
    """Amendment A14: tracemalloc cannot see Pillow's C decode buffers, so the bound that matters is
    the draft's reduction and decoded size, not a traced-allocation peak."""
    path = tmp_path / "big.jpg"
    PILImage.new("RGB", (9000, 6700), (90, 110, 130)).save(path, "JPEG", quality=80)
    ring = [[3000.0, 2225.0], [6000.0, 2225.0], [6000.0, 4475.0], [3000.0, 4475.0]]
    crop = decode_crop(path, ring, context=3.0, out=(1200, 900))
    img = render_crop(path, ring, colour="#ff0000", label="F-0001 · Spall", context=3.0, out=(1200, 900))
    assert crop.reduction == 4 and crop.decoded_size == (2250, 1675)
    assert img.size == (1200, 900)


def test_the_adapter_keys_on_the_file_and_annotation_and_misses_cleanly(handle):
    image_id = add_image(handle, "a.jpg", (2000, 1500))
    box_id = add_box(handle, image_id, shape="rbox", x=900, y=700, w=200, h=100, angle=30.0)
    spec = image_crop_spec(image_id, ring_of("rbox", 900, 700, 200, 100, 30.0), annotation_id=box_id)
    first = source_version(handle, spec)
    assert not first.startswith("missing:")
    assert render(handle, spec).size == (1200, 900)
    path = handle.folder / "images" / "a.jpg"
    st = path.stat()
    os.utime(path, ns=(st.st_atime_ns, st.st_mtime_ns + 1_000_000_000))
    assert source_version(handle, spec) != first
    path.unlink()
    assert source_version(handle, spec) == "missing:The image file is missing"
    with pytest.raises(SnapshotUnavailable, match="missing"):
        render(handle, spec)
    assert source_version(handle, image_crop_spec("nope", [[1.0, 1.0]])) == "missing:The image was deleted"


def test_the_locator_inset_uses_the_thumbnail(handle):
    image_id = add_image(handle, "b.jpg", (2000, 1500))
    img = render(handle, image_crop_spec(image_id, ring_of("point", 400, 300, 0, 0), inset=True))
    # the inset's white frame: 25 % of 1200 = 300 px wide, 8 px from the right edge
    assert img.getpixel((1200 - 300 - 8 - 2, 880)) == (255, 255, 255)
