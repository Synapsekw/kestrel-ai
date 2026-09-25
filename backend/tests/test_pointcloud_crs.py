"""CRS from the header (spec §6.5): GeoKeys, WKT, compound, none, unreadable; WGS84 bounds."""

import laspy
import numpy as np
import pytest
from pointclouds import make_las
from pyproj import CRS, Transformer

from app.pointclouds import crs as cloud_crs


def _header(path):
    with laspy.open(path) as r:
        return r.header


def test_epsg_from_geokeys_in_las_12(tmp_path):
    info = cloud_crs.crs_from_header(_header(make_las(tmp_path / "a.las", 10, epsg=32639)))
    assert info.epsg == 32639 and "+proj=utm" in info.proj4 and "+zone=39" in info.proj4
    assert info.vertical_crs is None and info.warning is None and not info.is_geographic


def test_epsg_from_wkt_in_las_14(tmp_path):
    path = make_las(tmp_path / "b.las", 10, epsg=32639, version="1.4", point_format=6, rgb=False)
    assert cloud_crs.crs_from_header(_header(path)).epsg == 32639


def test_compound_crs_splits_horizontal_and_vertical(tmp_path):
    h = laspy.LasHeader(point_format=6, version="1.4")
    h.scales, h.offsets = [0.001] * 3, [243000, 3177000, 0]
    h.add_crs(CRS("EPSG:32639+5773"))
    las = laspy.LasData(h)
    las.x, las.y, las.z = np.array([243500.0]), np.array([3178000.0]), np.array([1.0])
    las.write(tmp_path / "c.las")
    info = cloud_crs.crs_from_header(_header(tmp_path / "c.las"))
    assert info.epsg == 32639 and info.vertical_crs == "EGM96 height"
    assert CRS.from_wkt(info.crs_wkt).to_epsg() == 32639


def test_no_crs_means_no_coordinates(tmp_path):
    info = cloud_crs.crs_from_header(_header(make_las(tmp_path / "d.las", 10, epsg=None)))
    assert info == cloud_crs.CrsInfo()


class _Unreadable:
    def parse_crs(self):
        raise ValueError("GeoKeyDirectory is truncated")


def test_unreadable_crs_is_nulls_plus_a_warning():
    info = cloud_crs.crs_from_header(_Unreadable())
    assert info.crs_wkt is None and info.epsg is None
    assert (
        info.warning
        == "the coordinate system in the file could not be read: ValueError: GeoKeyDirectory is truncated"
    )


def test_geographic_crs_is_flagged():
    assert cloud_crs.crs_from_epsg(4326).is_geographic


def test_unknown_epsg_raises_value_error():
    with pytest.raises(ValueError):
        cloud_crs.crs_from_epsg(999_999)


def test_bounds_wgs84_matches_an_independent_pyproj_result():
    wkt = CRS.from_epsg(32639).to_wkt()
    got = cloud_crs.bounds_wgs84([243500, 3178000, -45, 243700, 3178300, 175], wkt)
    want = Transformer.from_crs(32639, 4326, always_xy=True).transform_bounds(
        243500, 3178000, 243700, 3178300, densify_pts=21
    )
    assert got == pytest.approx(list(want), abs=1e-9)
