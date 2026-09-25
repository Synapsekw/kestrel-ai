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
