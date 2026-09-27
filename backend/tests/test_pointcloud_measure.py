"""Measurement formulas (spec §9.3), pinned by the vectors vitest reads too."""

import json
import math
from pathlib import Path

import pytest

from app.pointclouds import measure

VECTORS = json.loads(
    (Path(__file__).resolve().parents[2] / "contract" / "fixtures" / "cloud-measure-vectors.json").read_text(
        "utf-8"
    )
)


@pytest.mark.parametrize("case", VECTORS["cases"], ids=lambda c: c["name"])
def test_shared_vectors(case):
    got = measure.results(case["kind"], case["points"])
    assert list(got) == VECTORS["fields"]
    for field in VECTORS["fields"]:
        want = case["results"].get(field)
        if want is None:
            assert got[field] is None, field  # lon/lat are filled by the service, never by the formulas
        else:
            assert got[field] == pytest.approx(want, abs=VECTORS["tolerance"]), field


def test_a_pole_leaning_one_degree_to_grid_east():
    top = {"x": 100 * math.tan(math.radians(1)), "y": 0.0, "z": 100.0, "uncertainty_m": 0.01}
    r = measure.results("vertical", [{"x": 0.0, "y": 0.0, "z": 0.0, "uncertainty_m": 0.01}, top])
    assert r["lean_angle_deg"] == pytest.approx(1.00, abs=0.02)
    assert r["lean_azimuth_deg"] == pytest.approx(90, abs=1)
    assert r["lean_mm_per_m"] == pytest.approx(17.5, abs=0.4)


def test_vertical_points_are_ordered_lower_first():
    hi = {"x": 1, "y": 1, "z": 10, "uncertainty_m": 0}
    lo = {"x": 0, "y": 0, "z": 0, "uncertainty_m": 0}
    assert measure.ordered("vertical", [hi, lo]) == [lo, hi]
    assert measure.ordered("distance", [hi, lo]) == [hi, lo]


# ------------------------------------------------ area (workspace spec 2026-09-26 §8.2, C-B1)


@pytest.mark.parametrize("case", VECTORS["area_cases"], ids=lambda c: c["name"])
def test_area_vectors(case):
    got = measure.area_results(case["points"], case["params"])
    assert list(got) == VECTORS["area_fields"] == measure.AREA_FIELDS
    for field in VECTORS["area_fields"]:
        want = case["results"].get(field)
        if want is None:
            assert got[field] is None, field
        else:
            assert got[field] == pytest.approx(want, abs=VECTORS["tolerance"]), field


@pytest.mark.parametrize(
    "case", [c for c in VECTORS["refusal_cases"] if c["kind"] == "area"], ids=lambda c: c["name"]
)
def test_area_refusal_vectors(case):
    with pytest.raises(measure.Refusal) as e:
        measure.area_results(case["points"], case["params"])
    assert e.value.code == case["code"] and e.value.message


def _p(x, y, z, u=0.01, group=None):
    p = {"x": x, "y": y, "z": z, "uncertainty_m": u}
    if group is not None:
        p["group"] = group
    return p


def test_success_criterion_3_a_tilted_patch_at_any_bearing():
    """Spec §16 item 3: a 2 m x 1.5 m patch tilted 60 deg: surface 3.000 m², plan 1.500 m² (± 0.5 %)."""
    b = math.radians(30)  # the patch's strike bearing
    s = (math.sin(b), math.cos(b), 0.0)
    d = (math.cos(b), -math.sin(b), 0.0)  # it rises this way
    w = [
        1.5 * (math.cos(math.radians(60)) * d[i] + math.sin(math.radians(60)) * (0, 0, 1)[i])
        for i in range(3)
    ]
    o = (243500.3, 3178000.7, 12.0)
    pts = [
        _p(*o),
        _p(*(o[i] + 2 * s[i] for i in range(3))),
        _p(*(o[i] + 2 * s[i] + w[i] for i in range(3))),
        _p(*(o[i] + w[i] for i in range(3))),
    ]
    r = measure.area_results(pts, None)
    assert r["area_surface_m2"] == pytest.approx(3.0, abs=1e-6)
    assert r["area_plan_m2"] == pytest.approx(1.5, abs=1e-6)
    assert r["area_m2"] == r["area_surface_m2"]
    assert r["plane_tilt_deg"] == pytest.approx(60.0, abs=1e-6)
    assert r["plane_azimuth_deg"] == pytest.approx(300.0, abs=1e-6)  # faces downhill, away from the rise
    assert measure.area_results(pts, {"mode": "plan"})["area_m2"] == r["area_plan_m2"]


def test_the_closing_vertex_is_dropped_however_often_it_repeats():
    a, b, c = _p(0, 0, 0), _p(1, 0, 0), _p(1, 1, 0)
    assert measure.area_vertices([a, b, c, a, a]) == [a, b, c]
    assert measure.area_vertices([a, b, c]) == [a, b, c]


def test_a_zero_view_direction_falls_back_to_the_upward_normal():
    pts = [_p(0, 0, 0), _p(0, 1, 0), _p(1, 1, 0.5), _p(1, 0, 0.5)]  # clockwise: Newell points down
    up = measure.area_results(pts, None)["plane_azimuth_deg"]
    assert measure.area_results(pts, {"view_dir": [0.0, 0.0, 0.0]})["plane_azimuth_deg"] == up
    assert up == pytest.approx(270.0)  # rises to the east, so the upward normal leans west


@pytest.mark.parametrize("big", [1e200, 1e308])
def test_huge_coordinates_are_refused(big):
    """Review Focus 2: overflowing products are a refusal, never inf/NaN in a response."""
    pts = [_p(big, big, 0), _p(-big, big, 0), _p(-big, -big, 0), _p(big, -big, 1)]
    with pytest.raises(measure.Refusal) as e:
        measure.area_results(pts, None)
    assert e.value.code == "degenerate_polygon"


# ------------------------------------------------ rings (workspace spec 2026-09-26 §8.2, C-B1)


@pytest.mark.parametrize("case", VECTORS["ring_cases"], ids=lambda c: c["name"])
def test_ring_vectors(case):
    got = measure.rings_results(case["points"])
    fields = VECTORS["fields"] + VECTORS["ring_fields"]
    assert list(got) == fields and VECTORS["ring_fields"] == measure.RING_FIELDS
    for field in fields:
        want = case["results"].get(field)
        if want is None:
            assert got[field] is None, field
        else:
            assert got[field] == pytest.approx(want, abs=VECTORS["tolerance"]), field


@pytest.mark.parametrize(
    "case", [c for c in VECTORS["refusal_cases"] if c["kind"] == "vertical"], ids=lambda c: c["name"]
)
def test_ring_refusal_vectors(case):
    assert measure.method_of(case["params"]) == "rings"
    with pytest.raises(measure.Refusal) as e:
        measure.rings_results(case["points"])
    assert e.value.code == case["code"] and e.value.message


def _noisy_ring(cx, cy, z, radius, k, group):
    """k picks round a circle with a deterministic ±5 mm radial and ±1 cm vertical scatter."""
    out = []
    for i in range(k):
        a = 2 * math.pi * i / k
        r = radius + 0.005 * math.sin(7 * i + group)
        out.append(_p(cx + r * math.cos(a), cy + r * math.sin(a), z + 0.01 * math.cos(3 * i), 0.01, group))
    return out


def test_success_criterion_4_a_noisy_cylinder_leaning_one_degree_east():
    """Spec §16 item 4: the ring method reports 1.00 ± 0.01 deg towards 90 ± 0.5 deg."""
    top = 50 * math.tan(math.radians(1.0))
    r = measure.rings_results(
        _noisy_ring(0.0, 0.0, 0.0, 3.0, 16, 0) + _noisy_ring(top, 0.0, 50.0, 2.5, 16, 1)
    )
    assert r["lean_angle_deg"] == pytest.approx(1.0, abs=0.01)
    assert r["lean_azimuth_deg"] == pytest.approx(90.0, abs=0.5)
    assert r["ring_radius_lower_m"] == pytest.approx(3.0, abs=0.002)
    assert r["ring_radius_upper_m"] == pytest.approx(2.5, abs=0.002)
    assert 0.001 < r["ring_rms_lower_m"] < 0.005 and 0.001 < r["ring_rms_upper_m"] < 0.005


def _compass(cx, cy, z, radius, group):
    return [
        _p(cx, cy + radius, z, 0.01, group),
        _p(cx + radius, cy, z, 0.01, group),
        _p(cx, cy - radius, z, 0.01, group),
        _p(cx - radius, cy, z, 0.01, group),
    ]


def test_lower_and_upper_follow_height_not_group_numbers():
    """Review Focus 3: group 0 here is the upper ring."""
    r = measure.rings_results(_compass(10.0, 20.0, 50.0, 2.0, 0) + _compass(10.5, 20.0, 0.0, 3.0, 1))
    assert (r["ring_radius_lower_m"], r["ring_radius_upper_m"]) == (pytest.approx(3.0), pytest.approx(2.0))
    assert r["dz"] == pytest.approx(50.0) and r["lean_azimuth_deg"] == pytest.approx(270.0)


def test_a_ring_centre_carries_its_fit_and_pick_uncertainty():
    ring = measure.fit_ring(_compass(10.0, 20.0, 0.0, 3.0, 0))
    assert (ring["x"], ring["y"], ring["z"], ring["radius_m"]) == (10.0, 20.0, 0.0, 3.0)
    assert ring["rms_m"] == pytest.approx(0.0, abs=1e-12)
    assert ring["uncertainty_m"] == pytest.approx(0.01 / 2)  # sqrt(0 + 0.01^2 / 4)


def test_method_of():
    assert measure.method_of(None) == "points"
    assert measure.method_of({"method": None}) == "points"
    assert measure.method_of({"method": "rings"}) == "rings"


@pytest.mark.parametrize("big", [1e200, 1e308])
def test_huge_ring_coordinates_are_refused(big):
    """Review Focus 2."""
    pts = [_p(big, 0, 0, 0, 0), _p(0, big, 0, 0, 0), _p(-big, 0, 0, 0, 0)]
    pts += [_p(big, 0, big, 0, 1), _p(0, big, big, 0, 1), _p(-big, 0, big, 0, 1)]
    with pytest.raises(measure.Refusal) as e:
        measure.rings_results(pts)
    assert e.value.code == "collinear_ring"


# ------------------------------------------------ Review Focus 2: absurd magnitudes (final review)

TOO_LARGE = "these coordinates are too large to measure"


def _big_square(side):
    h = side / 2
    return [_p(-h, -h, 0), _p(h, -h, 0), _p(h, h, 0), _p(-h, h, 0)]


@pytest.mark.parametrize(
    "pts",
    [
        _big_square(1e100),  # the Newell norm overflows to inf
        [_p(0, 0, 0), _p(1, 0, 0), _p(1, 1, 1e200), _p(0, 1, 0)],  # z alone overflows the products
        [_p(0, 0, 0), _p(1, 0, 0), _p(1, 1, 0, 1e200), _p(0, 1, 0)],  # uncertainty_m overflows
    ],
    ids=["side-1e100", "z-1e200", "uncertainty-1e200"],
)
def test_absurd_areas_are_refused_as_too_large(pts):
    with pytest.raises(measure.Refusal) as e:
        measure.area_results(pts, None)
    assert (e.value.code, e.value.message) == ("degenerate_polygon", TOO_LARGE)


def test_an_absurd_ring_uncertainty_is_refused_as_too_large():
    pts = _compass(10.0, 20.0, 0.0, 3.0, 0) + _compass(10.0, 20.0, 50.0, 2.0, 1)
    pts[0] = {**pts[0], "uncertainty_m": 1e200}
    with pytest.raises(measure.Refusal) as e:
        measure.rings_results(pts)
    assert (e.value.code, e.value.message) == ("collinear_ring", TOO_LARGE)


@pytest.mark.parametrize("big", [1e77, 1e103, 1e200, 1e308])
def test_huge_ring_offsets_say_too_large(big):
    """Minor 2: not "the picks lie in a line"."""
    pts = [_p(big, 0, 0, 0, 0), _p(0, big, 0, 0, 0), _p(-big, 0, 0, 0, 0)]
    pts += [_p(big, 0, big, 0, 1), _p(0, big, big, 0, 1), _p(-big, 0, big, 0, 1)]
    with pytest.raises(measure.Refusal) as e:
        measure.rings_results(pts)
    assert (e.value.code, e.value.message) == ("collinear_ring", TOO_LARGE)
