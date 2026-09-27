"""The drawing fit maths (spec 2026-09-26-map-workspace §8.3), pinned by the shared vectors that
frontend/src/mapws/georef/fit.ts (unit M-W5) also reads."""

import json
import math
from pathlib import Path

import numpy as np
import pytest

from app.drawings import georef

VECTORS = json.loads(
    (Path(__file__).resolve().parents[2] / "contract" / "fixtures" / "georef-fit-vectors.json").read_text(
        "utf-8"
    )
)
REL, METRES = VECTORS["tolerance"]["coef_rel"], VECTORS["tolerance"]["metres"]


def rel(got, want) -> bool:
    return abs(got - want) <= REL * max(1.0, abs(want))


def _pairs(case):
    return [p["src"] for p in case["points"]], [p["dst"] for p in case["points"]]


@pytest.mark.parametrize("case", VECTORS["cases"], ids=lambda c: c["name"])
def test_the_shared_vectors(case):
    src, dst = _pairs(case)
    want = case["expect"]
    if not want["ok"]:
        with pytest.raises(georef.GeorefRefused) as e:
            georef.fit(case["model"], src, dst, units_scale=case["units_scale"])
        assert e.value.code == want["error"]
        return
    got = georef.fit(case["model"], src, dst, units_scale=case["units_scale"])
    assert all(rel(g, w) for g, w in zip(got.transform, want["transform"], strict=True)), got.transform
    assert rel(got.scale, want["scale"]) and rel(got.rotation_deg, want["rotation_deg"])
    assert abs(got.rmse_m - want["rmse_m"]) <= METRES
    assert all(abs(g - w) <= METRES for g, w in zip(got.residuals_m, want["residuals_m"], strict=True))
    assert [w.code for w in got.warnings] == want["warnings"]


@pytest.mark.parametrize("case", [c for c in VECTORS["cases"] if c["expect"]["ok"]], ids=lambda c: c["name"])
def test_the_vectors_agree_with_a_centred_lstsq(case):
    """An independent solver, so the fixture is not the implementation agreeing with itself. Centred,
    because lstsq on raw UTM coordinates is off by ~1e-7 relative (measured)."""
    s = np.array([p["src"] for p in case["points"]], float)
    d = np.array([p["dst"] for p in case["points"]], float)
    sm, dm = s.mean(0), d.mean(0)
    s, d, n = s - sm, d - dm, len(s)
    if case["model"] == "affine":
        m = np.c_[s, np.ones(n)]
        ref = [*np.linalg.lstsq(m, d[:, 0], rcond=None)[0], *np.linalg.lstsq(m, d[:, 1], rcond=None)[0]]
    else:
        m = np.zeros((2 * n, 4))
        rhs = np.zeros(2 * n)
        m[0::2] = np.c_[s[:, 0], -s[:, 1], np.ones(n), np.zeros(n)]
        m[1::2] = np.c_[s[:, 1], s[:, 0], np.zeros(n), np.ones(n)]
        rhs[0::2], rhs[1::2] = d[:, 0], d[:, 1]
        a, b, c, f = np.linalg.lstsq(m, rhs, rcond=None)[0]
        ref = [a, -b, c, b, a, f]
    ref[2] += dm[0] - ref[0] * sm[0] - ref[1] * sm[1]
    ref[5] += dm[1] - ref[3] * sm[0] - ref[4] * sm[1]
    assert all(rel(g, w) for g, w in zip(case["expect"]["transform"], ref, strict=True))


def test_residuals_scale_with_the_destination_unit():
    src = [(0, 0), (100, 0), (100, 100), (0, 100)]
    dst = [(1000.1, 2000), (1099.9, 2000), (1100, 2100.1), (1000, 2099.9)]
    ft = georef.fit("similarity", src, dst, dst_unit_m=1200 / 3937)
    m = georef.fit("similarity", src, dst)
    assert math.isclose(ft.rmse_m, m.rmse_m * 1200 / 3937) and math.isclose(ft.scale, m.scale * 1200 / 3937)


def test_non_finite_and_overflow_are_degenerate():
    for src, dst in (
        ([(0, 0), (float("inf"), 0)], [(0, 0), (1, 0)]),
        ([(0, 0), (1e308, 0), (0, 1e308)], [(0, 0), (1e308, 0), (0, 1e308)]),
    ):
        with pytest.raises(georef.GeorefRefused) as e:
            georef.fit("similarity", src, dst)
        assert e.value.code == "degenerate"


def test_invert_and_compose_round_trip():
    t = (0.9, -0.3, 10.0, 0.3, 0.9, -5.0)
    for got, want in zip(georef.compose(georef.invert(t), t), (1, 0, 0, 0, 1, 0), strict=True):
        assert abs(got - want) < 1e-12
    x, y = georef.apply(georef.invert(t), *georef.apply(t, 3.0, 4.0))
    assert abs(x - 3.0) < 1e-12 and abs(y - 4.0) < 1e-12
    assert math.isclose(georef.scale_of(t), math.hypot(0.9, 0.3)) and math.isclose(
        georef.rotation_of(t), math.degrees(math.atan2(0.3, 0.9))
    )


def test_parse_preview():
    assert georef.parse_preview("1,0,5,0,1,-2.5") == (1.0, 0.0, 5.0, 0.0, 1.0, -2.5)
    for bad in ("1,0,5,0,1", "a,b,c,d,e,f", "1,0,0,0,0,0", "nan,0,0,0,1,0", "-1,0,0,0,1,0"):
        with pytest.raises(georef.GeorefRefused) as e:
            georef.parse_preview(bad)
        assert e.value.code == "invalid_preview"
