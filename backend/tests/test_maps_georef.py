import math

import pytest
from pyproj import CRS, Transformer
from rasterio.transform import Affine

from app.maps.georef import Georef, box_corners

UTM33 = CRS.from_epsg(32633).to_wkt()
GT = (500000.0, 0.03, 0.0, 4983000.0, 0.0, -0.03)


def test_pixel_to_native_uses_the_affine():
    g = Georef(GT, UTM33)
    assert g.pixel_to_native(0, 0) == pytest.approx((500000.0, 4983000.0))
    assert g.pixel_to_native(100, 200) == pytest.approx((500003.0, 4982994.0))


def test_wgs84_matches_an_independent_transformer():
    g = Georef(GT, UTM33)
    ref = Transformer.from_crs("EPSG:32633", "EPSG:4326", always_xy=True)
    lon, lat = g.pixel_to_wgs84(1000, 2000)
    assert (lon, lat) == pytest.approx(ref.transform(500030.0, 4982940.0), abs=1e-9)
    assert lon == pytest.approx(15.000384, abs=1e-5)  # just east of the 15° central meridian


def test_rotated_geotransform():
    t = Affine.translation(500000, 4983000) * Affine.rotation(30) * Affine.scale(0.03, -0.03)
    g = Georef(t.to_gdal(), UTM33)
    x, y = g.pixel_to_native(100, 0)
    assert x == pytest.approx(500000 + 3 * math.cos(math.radians(30)))
    assert y == pytest.approx(4983000 + 3 * math.sin(math.radians(30)))
    assert g.gsd_cm(1000, 1000) == pytest.approx(3.0)


def test_gsd_projected_and_geographic():
    assert Georef(GT, UTM33).gsd_cm(100, 100) == pytest.approx(3.0)
    geo = Georef((15.0, 1e-6, 0.0, 45.0, 0.0, -1e-6), CRS.from_epsg(4326).to_wkt())
    assert geo.gsd_cm(100, 100) == pytest.approx(9.33, abs=0.05)


def test_bounds():
    g = Georef(GT, UTM33)
    assert g.bounds_native(1000, 500) == pytest.approx([500000, 4982985, 500030, 4983000])
    west, south, east, north = g.bounds_wgs84(1000, 500)
    assert west < east and south < north and 14.99 < west < 15.01


def test_box_corners_axis_aligned_and_rotated():
    assert box_corners(10, 20, 4, 2) == [(10, 20), (14, 20), (14, 22), (10, 22)]
    rotated = box_corners(0, 0, 2, 2, angle=90)
    assert [tuple(round(v, 9) for v in p) for p in rotated] == [(2, 0), (2, 2), (0, 2), (0, 0)]


ROTATED_GT = (Affine.translation(500000, 4983000) * Affine.rotation(30) * Affine.scale(0.03, -0.03)).to_gdal()


@pytest.mark.parametrize("gt", [GT, ROTATED_GT], ids=["utm", "rotated"])
def test_wgs84_to_pixel_inverts_pixel_to_wgs84(gt):
    g = Georef(gt, UTM33)
    for px, py in [(0, 0), (1000, 2000), (12345.5, 678.25), (-50, 3000)]:
        lon, lat = g.pixel_to_wgs84(px, py)
        assert g.wgs84_to_pixel(lon, lat) == pytest.approx((px, py), abs=1e-6)


def test_wgs84_to_pixel_takes_sequences():
    g = Georef(ROTATED_GT, UTM33)
    pts = [(0.0, 0.0), (100.0, 50.0), (400.0, 900.0)]
    lons, lats = zip(*(g.pixel_to_wgs84(*p) for p in pts), strict=True)
    xs, ys = g.wgs84_to_pixel(list(lons), list(lats))
    assert list(zip(xs, ys, strict=True)) == [pytest.approx(p, abs=1e-6) for p in pts]


def test_wgs84_to_pixel_takes_numpy_arrays_and_raises_no_affine_warning():
    import warnings

    import numpy as np

    g = Georef(ROTATED_GT, UTM33)
    pts = [(0.0, 0.0), (100.0, 50.0), (400.0, 900.0)]
    lons, lats = zip(*(g.pixel_to_wgs84(*p) for p in pts), strict=True)
    with warnings.catch_warnings():
        warnings.simplefilter("error")
        xs, ys = g.wgs84_to_pixel(np.array(lons), np.array(lats))
        assert g.pixel_to_native(1, 1)
    assert list(zip(xs, ys, strict=True)) == [pytest.approx(p, abs=1e-6) for p in pts]
