"""Distance and area against known geodesics and the UTM scale factor (plan maps-b4 Task 2;
spec §9.1, §15 "Geod length and area against known geodesics; grid versus ground scale factor").

Contract ruling C4: MapDistanceResults requires `dsm_surface_id` ([string, null]) — the DSM used
for `length_3d_m`, null without one. `distance_results()` returns it as None; the service sets it
later (out of scope here)."""

import math

import pytest
from pyproj import CRS, Transformer

from app.mapmeasure.frames import SiteFrame
from app.mapmeasure.geodesy import area_results, distance_results

K0 = 0.9996  # the UTM scale on the central meridian


def utm(epsg: int) -> SiteFrame:
    return SiteFrame("crs", CRS.from_epsg(epsg).to_wkt(), epsg)


def test_one_degree_along_the_equator_is_the_known_geodesic():
    t = Transformer.from_crs(4326, 32631, always_xy=True)
    a, b = t.transform(2.5, 0.0), t.transform(3.5, 0.0)
    out = distance_results([list(a), list(b)], utm(32631))
    assert out["length_m"] == pytest.approx(6378137 * math.pi / 180, abs=1e-3)  # 111 319.491 m


def test_on_the_central_meridian_the_scale_factor_is_k0():
    out = distance_results([[500_000.0, 3_300_000.0], [500_000.0, 3_301_000.0]], utm(32639))
    assert out["grid_length_m"] == pytest.approx(1000.0, abs=1e-9)
    assert out["length_m"] == pytest.approx(1000.0 / K0, abs=1e-4)
    assert out["scale_factor"] == pytest.approx(K0, abs=1e-7)
    assert out["length_3d_m"] is None and out["nodata_fraction"] is None
    assert out["dsm_surface_id"] is None  # C4: the service sets it, not this pure function


def test_a_polyline_sums_its_segments():
    line = [[500_000.0, 3_300_000.0], [500_300.0, 3_300_000.0], [500_300.0, 3_300_400.0]]
    out = distance_results(line, utm(32639))
    assert out["grid_length_m"] == pytest.approx(700.0, abs=1e-9)
    assert out["length_m"] == pytest.approx(700.0 / K0, rel=2e-6)


def test_area_on_the_central_meridian_scales_by_k0_squared():
    ring = [
        [499_950.0, 3_300_000.0],
        [500_050.0, 3_300_000.0],
        [500_050.0, 3_300_100.0],
        [499_950.0, 3_300_100.0],
    ]
    out = area_results(ring, utm(32639))
    assert out["grid_area_m2"] == pytest.approx(10_000.0, abs=1e-6)
    assert out["grid_perimeter_m"] == pytest.approx(400.0, abs=1e-9)
    assert out["area_m2"] == pytest.approx(10_000.0 / K0**2, rel=1e-6)
    assert out["perimeter_m"] == pytest.approx(400.0 / K0, rel=1e-6)
    assert out["areal_scale_factor"] == pytest.approx(K0**2, abs=1e-7)


def test_a_closed_ring_and_its_winding_do_not_matter():
    ring = [[499_950.0, 3_300_000.0], [500_050.0, 3_300_000.0], [500_050.0, 3_300_100.0]]
    a = area_results(ring, utm(32639))
    b = area_results([*ring[::-1], ring[-1]], utm(32639))  # reversed and closed
    assert a["area_m2"] == pytest.approx(b["area_m2"], rel=1e-12) and a["area_m2"] > 0


def test_a_feet_crs_reports_metres():
    ft = SiteFrame("crs", CRS.from_epsg(2278).to_wkt(), 2278)
    out = distance_results([[3_000_000.0, 13_800_000.0], [3_001_000.0, 13_800_000.0]], ft)
    assert out["grid_length_m"] == pytest.approx(1000 * 1200 / 3937, abs=1e-6)
    assert abs(out["length_m"] - out["grid_length_m"]) / out["grid_length_m"] < 1e-3


def test_a_local_frame_gives_grid_values_only():
    d = distance_results([[0.0, 0.0], [3.0, 4.0]], SiteFrame.local())
    assert d == {
        "length_m": None,
        "grid_length_m": 5.0,
        "scale_factor": None,
        "length_3d_m": None,
        "nodata_fraction": None,
        "dsm_surface_id": None,
    }
    a = area_results([[0.0, 0.0], [2.0, 0.0], [2.0, 3.0], [0.0, 3.0]], SiteFrame.local())
    assert a == {
        "area_m2": None,
        "perimeter_m": None,
        "grid_area_m2": 6.0,
        "grid_perimeter_m": 10.0,
        "areal_scale_factor": None,
    }
