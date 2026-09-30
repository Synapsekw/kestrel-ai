"""R9-M pure geometry (spec §9.3: item CRS, 4:3 frames, pair intersections)."""

import math

import pytest
from reports_m_rows import UTM33, add_geomap

from app.reports.figures import map_geo
from app.workspace.frame import WGS84


def test_same_crs_is_unchanged_and_local_to_local_passes():
    pts = [[500010.0, 4982990.0], [500020.0, 4982980.0]]
    assert map_geo.to_crs(pts, UTM33, UTM33) == pts
    assert map_geo.to_crs([[1, 2]], None, None) == [[1.0, 2.0]]


def test_local_and_crs_do_not_mix():
    assert map_geo.to_crs([[1, 2]], None, UTM33) is None
    assert map_geo.to_crs([[1, 2]], UTM33, None) is None
    assert map_geo.to_crs([], UTM33, UTM33) is None


def test_utm_to_wgs84_round_trips():
    lonlat = map_geo.to_crs([[500000.0, 4983000.0]], UTM33, WGS84)
    back = map_geo.to_crs(lonlat, WGS84, UTM33)
    assert back[0] == pytest.approx([500000.0, 4983000.0], abs=1e-6)
    assert lonlat[0][0] == pytest.approx(15.0, abs=1e-6)  # UTM 33N central meridian


def test_polygon_closes_its_ring_and_line_is_a_linestring():
    assert map_geo.polygon([[0, 0], [1, 0], [1, 1]])["coordinates"][0][-1] == [0, 0]
    assert map_geo.polygon([[0, 0], [1, 0], [1, 1], [0, 0]])["coordinates"][0].count([0, 0]) == 2
    assert map_geo.line([[0, 0], [1, 0]]) in (
        {"type": "LineString", "coordinates": [[0, 0], [1, 0]]},
        {"type": "Polygon", "coordinates": [[[0, 0], [1, 0], [0, 0]]]},  # Ruling 6 fallback
    )
    assert map_geo.point(1, 2) == {"type": "Point", "coordinates": [1.0, 2.0]}


def test_intersect_and_contains():
    assert map_geo.intersect((0, 0, 2, 2), (1, 1, 3, 3)) == (1, 1, 2, 2)
    assert map_geo.intersect((0, 0, 1, 1), (1, 0, 2, 1)) is None  # touching is not overlapping
    assert map_geo.contains((0, 0, 2, 2), 1, 1) and not map_geo.contains((0, 0, 2, 2), 3, 1)


def test_aspect_4_3_is_four_by_three_in_metres_and_stays_inside():
    box = (14.0, 45.0, 14.1, 45.01)
    lo_x, lo_y, hi_x, hi_y = map_geo.aspect_4_3(box)
    k = math.cos(math.radians((lo_y + hi_y) / 2))
    assert ((hi_x - lo_x) * k) / (hi_y - lo_y) == pytest.approx(4 / 3, rel=1e-9)
    assert lo_x >= box[0] and hi_x <= box[2] and lo_y >= box[1] and hi_y <= box[3]


def test_aspect_4_3_centres_on_a_point_but_clamps_inside():
    box = (14.0, 45.0, 14.1, 45.01)
    lo_x, _, hi_x, _ = map_geo.aspect_4_3(box, centre=(14.0, 45.005))  # the left edge
    assert lo_x == pytest.approx(14.0) and hi_x < 14.1


def test_covering_map_is_the_newest_ready_map_holding_the_point(handle):
    from datetime import date

    old = add_geomap(handle, name="Aug", captured_on=date(2026, 8, 1))
    new = add_geomap(handle, name="Sep", captured_on=date(2026, 9, 1))
    add_geomap(handle, name="Oct", captured_on=date(2026, 10, 1), status="failed")
    lon, lat = map_geo.to_crs([[500050.0, 4982950.0]], UTM33, WGS84)[0]
    with handle.session() as s:
        assert map_geo.covering_map(s, lon, lat).id == new
        assert map_geo.covering_map(s, lon + 1.0, lat) is None
    assert old != new
