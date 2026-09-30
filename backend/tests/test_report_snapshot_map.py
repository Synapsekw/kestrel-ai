"""R3: map snapshots (spec 2026-09-26-reports §9.3, §17): a UTM and a rotated-geotransform fixture
(tests/geotiffs.py), the floor extent, the nodata edge and geometry compaction."""

import math

import pytest
from report_snapshot_helpers import add_map_file, map_spec, near

from app.maps.georef import Georef
from app.reports.snapshots import SnapshotUnavailable
from app.reports.snapshots.map_view import (
    compact_geometry,
    map_item,
    map_source_version,
    north_angle,
    pixel_window,
    plan_window,
    render_map_spec,
)

AMBER = (229, 175, 100)


def test_plan_window_pads_floors_and_widens_to_4_3():
    b = plan_window((966.67, 716.67, 1033.33, 783.33), pad=0.25, floor=40 / 0.03, aspect=4 / 3)
    assert pixel_window(b) == (111, 83, 1778, 1334)


def test_a_utm_map_snapshot_frames_the_polygon_with_the_floor_extent(handle):
    map_id = add_map_file(handle)
    x, y = 500000.0 + 30.0, 4983000.0 - 22.5  # the centre of a 60 x 45 m map at 3 cm
    square = [[x - 1, y - 1], [x + 1, y - 1], [x + 1, y + 1], [x - 1, y + 1], [x - 1, y - 1]]
    img = render_map_spec(handle, map_spec(map_id, {"type": "Polygon", "coordinates": [square]}))
    assert img.size == (1200, 900)
    # the window is the 40 m floor widened to 4:3 (1778 x 1334 px) -> 22.5 output px per metre
    assert near(img, (600 - 22.5, 450), AMBER) and near(img, (600 + 22.5, 450), AMBER)
    item = map_item(handle, map_id)
    assert north_angle(Georef(item.geotransform, item.crs_wkt), 1000, 750) == pytest.approx(0.0, abs=1e-6)


def test_a_rotated_geotransform_prints_in_pixel_orientation_with_a_turned_north_arrow(handle):
    map_id = add_map_file(handle, rotation=30.0)
    item = map_item(handle, map_id)
    g = Georef(item.geotransform, item.crs_wkt)
    assert north_angle(g, 1000, 750) == pytest.approx(30.0, abs=0.5)
    x, y = g.pixel_to_native(1000, 750)
    img = render_map_spec(handle, map_spec(map_id, {"type": "Point", "coordinates": [x, y]}))
    assert img.size == (1200, 900)
    assert img.getpixel((600, 450)) == AMBER  # the pin sits at the window's centre


def test_a_line_is_drawn_3_px_on_a_white_halo(handle):
    map_id = add_map_file(handle)
    x, y = 500000.0 + 30.0, 4983000.0 - 22.5
    line = {"type": "LineString", "coordinates": [[x - 5, y], [x + 5, y]]}
    img = render_map_spec(handle, map_spec(map_id, line, label=None))
    assert img.getpixel((600, 450)) == AMBER
    assert near(img, (600, 446), (255, 255, 255), r=1)  # the white halo just above the 3 px stroke


def test_a_pin_near_the_map_edge_paints_the_outside_grey(handle):
    map_id = add_map_file(handle)
    item = map_item(handle, map_id)
    x, y = Georef(item.geotransform, item.crs_wkt).pixel_to_native(10, 10)
    img = render_map_spec(handle, map_spec(map_id, {"type": "Point", "coordinates": [x, y]}, label=None))
    assert img.getpixel((2, 2)) == (128, 128, 128)


def test_the_source_version_follows_the_file_and_misses_cleanly(handle):
    map_id = add_map_file(handle)
    spec = map_spec(map_id, None)
    assert ":April:2026-09-14" in map_source_version(handle, spec)
    assert map_source_version(handle, map_spec("nope", None)) == "missing:The map was deleted"
    map_item(handle, map_id).path.unlink()
    assert map_source_version(handle, spec) == "missing:The map file is missing"
    with pytest.raises(SnapshotUnavailable):
        render_map_spec(handle, spec)


def test_a_map_without_geometry_shows_the_whole_map(handle):
    img = render_map_spec(handle, map_spec(add_map_file(handle), None, label=None, inset=True))
    assert img.size == (1200, 900)


def test_a_dense_map_polygon_is_compacted():
    cx, cy = 500030.0, 4982977.5
    ring = [
        [cx + 20 * math.cos(2 * math.pi * i / 2000), cy + 20 * math.sin(2 * math.pi * i / 2000)]
        for i in range(2000)
    ]
    g = compact_geometry({"type": "Polygon", "coordinates": [ring + [ring[0]]]})
    out = g["coordinates"][0]
    assert g["type"] == "Polygon" and 4 <= len(out) <= 121 and out[0] == out[-1]
    assert all(len(str(v)) <= 12 for p in out for v in p)  # millimetres, not 17 digits
    assert compact_geometry({"type": "Point", "coordinates": [cx + 0.12345, cy]}) == {
        "type": "Point",
        "coordinates": [500030.123, 4982977.5],
    }
