"""The site frame as map measurements read it (plan maps-b4 Task 1; spec §6, M4, M5)."""

import numpy as np
import pytest
from mapmeasure_rows import set_site_frame
from pyproj import CRS, Transformer

from app.errors import AppError
from app.mapmeasure import frames
from app.mapmeasure.frames import SiteFrame

UTM39 = SiteFrame("crs", CRS.from_epsg(32639).to_wkt(), 32639)
UTM38 = SiteFrame("crs", CRS.from_epsg(32638).to_wkt(), 32638)
LOCAL = SiteFrame.local()


def test_no_workspace_row_means_no_frame(handle):
    with handle.session() as s:
        assert frames.current_site_frame(s) is None
        with pytest.raises(AppError) as e:
            frames.require_site_frame(s)
    assert (e.value.code, e.value.status) == ("no_site_frame", 409)


def test_the_workspace_row_gives_the_frame(handle):
    set_site_frame(handle, 32639)
    with handle.session() as s:
        assert frames.current_site_frame(s) == UTM39
    set_site_frame(handle, None)
    with handle.session() as s:
        assert frames.current_site_frame(s) == LOCAL


def test_same_frame_compares_crs_not_strings():
    wkt1 = CRS.from_epsg(32639).to_wkt(version="WKT1_GDAL")
    assert frames.same_frame(UTM39, SiteFrame("crs", wkt1, 32639))
    assert not frames.same_frame(UTM39, UTM38)
    assert frames.same_frame(LOCAL, SiteFrame.local())
    assert not frames.same_frame(LOCAL, UTM39)


def test_convert_xy_matches_pyproj_and_is_identity_in_one_frame():
    xs, ys = np.array([500_000.0, 500_100.0]), np.array([3_300_000.0, 3_300_050.0])
    gx, gy = frames.convert_xy(xs, ys, UTM39, UTM38)
    want = Transformer.from_crs(32639, 32638, always_xy=True).transform(xs, ys)
    assert np.allclose(gx, want[0], atol=1e-6) and np.allclose(gy, want[1], atol=1e-6)
    same = frames.convert_xy(xs, ys, UTM39, UTM39)
    assert np.array_equal(same[0], xs) and np.array_equal(same[1], ys)
    with pytest.raises(frames.FrameMismatch):
        frames.convert_xy(xs, ys, LOCAL, UTM39)


def test_convert_vertices_keeps_the_count():
    ring = [[500_000.0, 3_300_000.0], [500_010.0, 3_300_000.0], [500_010.0, 3_300_010.0]]
    out = frames.convert_vertices(ring, UTM39, UTM38)
    want = Transformer.from_crs(32639, 32638, always_xy=True).transform(500_010.0, 3_300_010.0)
    assert len(out) == 3 and out[2] == pytest.approx(list(want), abs=1e-6)
    assert frames.convert_vertices(ring, UTM39, UTM39) == ring


def test_unit_factor_reads_the_axis_unit():
    assert frames.unit_factor(LOCAL) == 1.0
    assert frames.unit_factor(UTM39) == 1.0
    ft = SiteFrame("crs", CRS.from_epsg(2278).to_wkt(), 2278)  # Texas South Central, US survey feet
    assert frames.unit_factor(ft) == pytest.approx(1200 / 3937, abs=1e-12)


def test_to_lonlat_is_wgs84():
    utm31 = SiteFrame("crs", CRS.from_epsg(32631).to_wkt(), 32631)
    lon, lat = frames.to_lonlat(np.array([500_000.0]), np.array([0.0]), utm31)
    assert lon[0] == pytest.approx(3.0, abs=1e-9) and lat[0] == pytest.approx(0.0, abs=1e-9)
