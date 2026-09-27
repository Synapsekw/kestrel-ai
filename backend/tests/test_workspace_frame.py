"""The site frame conversions (spec 2026-09-26-map-workspace sections 3 M3-M5 and 15)."""

import math

import numpy as np
import pytest
from affine import Affine
from pyproj import CRS, Transformer

from app.errors import AppError
from app.maps.georef import box_corners
from app.workspace import frame as fr

UTM33 = CRS.from_epsg(32633).to_wkt()
UTM38 = CRS.from_epsg(32638).to_wkt()
UTM39 = CRS.from_epsg(32639).to_wkt()
GT = (500000.0, 0.03, 0.0, 4983000.0, 0.0, -0.03)
ROTATED_GT = (Affine.translation(500000, 4983000) * Affine.rotation(30) * Affine.scale(0.03, -0.03)).to_gdal()
O38 = Transformer.from_crs("EPSG:4326", "EPSG:32638", always_xy=True).transform(47.99, 29.5)
GT38 = (round(O38[0], 1), 0.05, 0.0, round(O38[1], 1), 0.0, -0.05)

CASES = {
    "utm": (UTM33, GT, 32633),
    "rotated": (UTM33, ROTATED_GT, 32633),
    "utm38_to_39": (UTM38, GT38, 32639),
}
PIXELS = [(0.0, 0.0), (100.5, 200.25), (3999.0, 12.0), (2000.0, 2000.0)]


def _ref(src_epsg: int, dst_epsg: int, x: float, y: float) -> tuple[float, float]:
    return Transformer.from_crs(f"EPSG:{src_epsg}", f"EPSG:{dst_epsg}", always_xy=True).transform(x, y)


@pytest.mark.parametrize("name", CASES)
def test_pixels_to_site_matches_pyproj_and_round_trips(name):
    crs, gt, epsg = CASES[name]
    frame = fr.frame_for_epsg(epsg)
    site = fr.map_pixels_to_site(frame, crs, gt, PIXELS)
    a = Affine.from_gdal(*gt)
    src_epsg = CRS.from_wkt(crs).to_epsg()
    for (px, py), (sx, sy) in zip(PIXELS, site, strict=True):
        nx, ny = a * (px, py)
        assert (sx, sy) == pytest.approx(_ref(src_epsg, epsg, nx, ny), abs=1e-6)
    back = fr.site_to_map_pixels(frame, crs, gt, site)
    assert np.allclose(back, PIXELS, atol=1e-6)


@pytest.mark.parametrize("name", CASES)
def test_site_wgs84_round_trip(name):
    crs, gt, epsg = CASES[name]
    frame = fr.frame_for_epsg(epsg)
    pts = fr.map_pixels_to_site(frame, crs, gt, PIXELS)
    lonlat = fr.site_to_wgs84(frame, pts)
    for (sx, sy), (lon, lat) in zip(pts, lonlat, strict=True):
        assert (lon, lat) == pytest.approx(_ref(epsg, 4326, sx, sy), abs=1e-9)
    assert np.allclose(fr.wgs84_to_site(frame, lonlat), pts, atol=1e-6)


def test_a_box_becomes_a_quadrilateral_across_crss():
    crs, gt, epsg = CASES["utm38_to_39"]
    frame = fr.frame_for_epsg(epsg)
    corners = fr.map_pixels_to_site(frame, crs, gt, box_corners(100, 100, 400, 200))
    (x0, y0), (x1, y1), (x2, y2), (x3, y3) = corners
    assert abs(y1 - y0) > 1e-2  # the top edge is no longer horizontal: grid convergence between zones
    assert abs(x3 - x0) > 1e-2
    assert math.hypot(x1 - x0, y1 - y0) == pytest.approx(400 * 0.05, rel=2e-3)  # still ~20 m long


def test_same_crs_is_an_exact_identity():
    frame = fr.frame_for_epsg(32633)
    pts = [[500001.123456789, 4983000.987654321]]
    assert fr.points_to_site(frame, UTM33, pts) == pts
    assert fr.points_from_site(frame, CRS.from_epsg(32633).to_wkt(), pts) == pts


def test_local_frame_holds_only_crs_less_items_and_is_identity():
    assert fr.LOCAL.holds(None) and not fr.LOCAL.holds(UTM33)
    frame = fr.frame_for_epsg(32633)
    assert frame.holds(UTM33) and not frame.holds(None)
    assert fr.points_to_site(fr.LOCAL, None, [[-12.5, 40.25]]) == [[-12.5, 40.25]]
    with pytest.raises(AppError) as e:
        fr.points_to_site(fr.LOCAL, UTM33, [[1.0, 2.0]])
    assert (e.value.status, e.value.code) == (422, "no_coordinates")
    with pytest.raises(AppError):
        fr.points_to_site(frame, None, [[1.0, 2.0]])
    with pytest.raises(AppError):
        fr.site_to_wgs84(fr.LOCAL, [[1.0, 2.0]])


def test_frame_for_epsg_codes():
    for epsg in (4326, 2227):  # degrees; US survey feet
        with pytest.raises(AppError) as e:
            fr.frame_for_epsg(epsg)
        assert (e.value.status, e.value.code) == (422, "needs_projected_crs")
    with pytest.raises(AppError) as e:
        fr.frame_for_epsg(999999)
    assert (e.value.status, e.value.code) == (422, "invalid_epsg")


def test_frame_for_crs_keeps_a_metre_crs_and_replaces_geographic_or_feet_by_utm():
    assert fr.frame_for_crs(UTM38, None) == fr.SiteFrame("crs", UTM38, 32638)
    wgs = CRS.from_epsg(4326).to_wkt()
    assert fr.frame_for_crs(wgs, (47.99, 29.5)).epsg == 32638
    assert fr.frame_for_crs(wgs, (48.01, 29.5)).epsg == 32639
    assert fr.frame_for_crs(wgs, (-70.6, -33.4)).epsg == 32719  # southern hemisphere
    assert fr.frame_for_crs(CRS.from_epsg(2227).to_wkt(), (-122.3, 37.8)).epsg == 32610


def test_frame_key_name_proj4():
    f = fr.frame_for_epsg(32639)
    assert f.key == "epsg:32639" and "UTM zone 39N" in f.name and "+zone=39" in (f.proj4 or "")
    assert fr.LOCAL.key == "local" and fr.LOCAL.name == "Local metres" and fr.LOCAL.proj4 is None
    custom = fr.SiteFrame("crs", UTM39, None)
    assert custom.key.startswith("wkt:") and len(custom.key) == 16


def test_bbox_from_site_densifies_edges():
    frame = fr.frame_for_epsg(32639)
    x, y = _ref(32638, 32639, GT38[0], GT38[3])
    bbox = (x, y - 500, x + 500, y)
    got = fr.bbox_from_site(frame, UTM38, bbox)
    ring = fr.densify_bbox(bbox)
    t = Transformer.from_crs("EPSG:32639", "EPSG:32638", always_xy=True)
    xs, ys = t.transform(ring[:, 0], ring[:, 1])
    assert got == pytest.approx((min(xs), min(ys), max(xs), max(ys)), abs=1e-6)
    assert fr.densify_bbox((0, 0, 1, 1), n=3).shape == (8, 2)


def test_bbox_far_outside_the_zone_is_none_when_not_strict():
    frame = fr.frame_for_epsg(32639)
    far = (-9e7, -9e7, -8.9e7, -8.9e7)
    assert fr.bbox_from_site(frame, UTM38, far, strict=False) is None
    with pytest.raises(AppError):
        fr.bbox_from_site(frame, UTM38, far)


def test_geometry_round_trip_keeps_rings_closed():
    frame = fr.frame_for_epsg(32639)
    x, y = _ref(32638, 32639, GT38[0], GT38[3])
    ring = [[x, y], [x + 10, y], [x + 10, y - 10], [x, y - 10], [x, y]]
    native = fr.geometry_from_site(frame, UTM38, {"type": "Polygon", "coordinates": [ring]})
    assert native["coordinates"][0][0] == native["coordinates"][0][-1]
    back = fr.geometry_to_site(frame, UTM38, native)
    assert np.allclose(back["coordinates"][0], ring, atol=1e-6)
    pt = fr.geometry_from_site(frame, UTM38, {"type": "Point", "coordinates": [x, y]})
    assert pt["type"] == "Point" and len(pt["coordinates"]) == 2
    line = fr.geometry_to_site(frame, UTM39, {"type": "LineString", "coordinates": [[x, y], [x + 1, y]]})
    assert line["coordinates"] == [[x, y], [x + 1, y]]


def test_affine_helpers_compose_the_fit_with_the_crs_change():
    frame = fr.frame_for_epsg(32639)
    x0, y0 = O38
    t6 = (0.01, 0.0, x0, 0.0, 0.01, y0)  # a drawing in cm units, placed in UTM 38
    src = [[0.0, 0.0], [1000.0, 500.0]]
    site = fr.affine_points_to_site(frame, t6, UTM38, src)
    assert site[1] == pytest.approx(list(_ref(32638, 32639, x0 + 10.0, y0 + 5.0)), abs=1e-6)
    assert np.allclose(fr.site_points_to_affine_src(frame, t6, UTM38, site), src, atol=1e-6)


def test_crs_to_wgs84():
    got = fr.crs_to_wgs84(UTM33, [[500030.0, 4982940.0]])
    assert got[0] == pytest.approx(list(_ref(32633, 4326, 500030.0, 4982940.0)), abs=1e-9)


def test_a_map_without_coordinates_is_never_in_a_frame():
    with pytest.raises(AppError):
        fr.map_pixels_to_site(fr.LOCAL, None, (0, 1, 0, 0, 0, -1), [[1.0, 1.0]])
