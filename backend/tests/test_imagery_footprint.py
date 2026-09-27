"""Footprint on flat ground at take-off height (spec 2026-09-26-image-inspection §7.4, §17 "Footprint")."""

import math

import pytest

from app.imagery.footprint import M_PER_DEG, FootprintInput, compute, effective_yaw, to_geojson

LAT0, LON0 = 25.26412, 55.29218
F, W = 12.29, 17.3  # M3E wide
H = W * 3956 / 5280


def _inp(**kw) -> FootprintInput:
    base = dict(
        lat=LAT0,
        lon=LON0,
        rel_alt=40.0,
        pitch=-90.0,
        gimbal_yaw=0.0,
        flight_yaw=None,
        focal_mm=F,
        sensor_w_mm=W,
        focal_px=None,
        orig_w=5280,
        orig_h=3956,
    )
    base.update(kw)
    return FootprintInput(**base)


def _enu(coords, lat0=LAT0, lon0=LON0):
    return [
        ((lon - lon0) * M_PER_DEG * math.cos(math.radians(lat0)), (lat - lat0) * M_PER_DEG)
        for lon, lat in coords
    ]


def test_nadir_at_yaw_0_is_an_axis_aligned_rectangle():
    fp = compute(_inp())
    assert fp.kind == "trapezoid"
    (tl, tr, br, bl) = _enu(fp.coords)
    hw, hh = W / 2 * 40 / F, H / 2 * 40 / F
    for got, want in zip((tl, tr, br, bl), ((-hw, hh), (hw, hh), (hw, -hh), (-hw, -hh)), strict=True):
        assert got == pytest.approx(want, abs=1e-6)


def test_yaw_90_rotates_it_image_top_east():
    fp = compute(_inp(gimbal_yaw=90.0))
    pts = _enu(fp.coords)
    es, ns = [p[0] for p in pts], [p[1] for p in pts]
    assert max(es) - min(es) == pytest.approx(H * 40 / F, abs=1e-6)
    assert max(ns) - min(ns) == pytest.approx(W * 40 / F, abs=1e-6)
    tl, tr = pts[0], pts[1]
    assert tl[0] > 0 and tr[0] > 0  # the image top edge lies east of the camera


def test_pitch_minus_45_is_a_trapezoid_wider_at_the_far_edge():
    fp = compute(_inp(pitch=-45.0))
    assert fp.kind == "trapezoid"
    tl, tr, br, bl = _enu(fp.coords)
    assert math.dist(tl, tr) > math.dist(bl, br)
    assert min(p[1] for p in (tl, tr, br, bl)) > 0  # all ahead (north) of the camera


def test_pitch_minus_5_is_a_wedge_with_top_rays_clamped_to_3h():
    fp = compute(_inp(pitch=-5.0))
    assert fp.kind == "wedge"
    tl, tr, br, bl = _enu(fp.coords)
    assert math.hypot(*tl) == pytest.approx(120.0, abs=1e-6)
    assert math.hypot(*tr) == pytest.approx(120.0, abs=1e-6)
    assert math.hypot(*bl) < 120.0


def test_looking_up_is_a_point():
    fp = compute(_inp(pitch=30.0))
    assert fp.kind == "point" and fp.coords == [[LON0, LAT0]]


@pytest.mark.parametrize(
    "kw",
    [
        {"rel_alt": None},
        {"rel_alt": 0.0},
        {"pitch": None},
        {"gimbal_yaw": None},
        {"focal_mm": None, "focal_px": None},
    ],
)
def test_missing_inputs_give_a_point(kw):
    assert compute(_inp(**kw)).kind == "point"


def test_no_gps_is_none():
    assert compute(_inp(lat=None)).kind == "none" and compute(_inp(lat=None)).coords is None


def test_focal_px_is_the_lens_fallback():
    by_mm = compute(_inp())
    by_px = compute(_inp(focal_mm=None, sensor_w_mm=None, focal_px=F / W * 5280))
    assert by_px.kind == "trapezoid"
    for a, b in zip(by_mm.coords, by_px.coords, strict=True):
        assert a == pytest.approx(b, abs=1e-9)


def test_yaw_sanity_rule():
    assert effective_yaw(-89.0, 170.0, 10.0) == 10.0  # near nadir, 160 deg apart: body-relative gimbal yaw
    assert effective_yaw(-45.0, 170.0, 10.0) == 170.0  # oblique: trust the gimbal
    assert effective_yaw(-89.0, 170.0, None) == 170.0
    assert effective_yaw(None, None, 33.0) == 33.0
    assert effective_yaw(-89.0, None, None) is None


def test_yaw_sanity_uses_the_short_way_round():
    assert effective_yaw(-89.0, -170.0, 175.0) == -170.0  # 15 deg apart across the wrap, not 345


def test_lat_lon_within_0_1_m_at_50_degrees():
    pyproj = pytest.importorskip("pyproj")
    geod = pyproj.Geod(ellps="WGS84")
    fp = compute(_inp(lat=50.0, lon=8.0))
    hw, hh = W / 2 * 40 / F, H / 2 * 40 / F
    for (lon, lat), (e, n) in zip(fp.coords, ((-hw, hh), (hw, hh), (hw, -hh), (-hw, -hh)), strict=True):
        _, _, dist = geod.inv(8.0, 50.0, lon, lat)
        assert abs(dist - math.hypot(e, n)) < 0.1


def test_geojson_shapes():
    ring = [[1.0, 2.0], [3.0, 2.0], [3.0, 1.0], [1.0, 1.0]]
    assert to_geojson(ring, "trapezoid") == {"type": "Polygon", "coordinates": [ring + [[1.0, 2.0]]]}
    assert to_geojson(ring, "wedge")["type"] == "Polygon"
    assert to_geojson([[1.0, 2.0]], "point") == {"type": "Point", "coordinates": [1.0, 2.0]}
    assert to_geojson(None, "none") is None and to_geojson(None, "trapezoid") is None
