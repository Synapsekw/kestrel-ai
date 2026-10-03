# backend/tests/test_asset_review_findings_map.py
"""Findings map geometry against the shared fixture (spec 2026-10-02-asset-findings §9). The TS twin
`frontend/src/assetmodels/findingsMap/geometry.test.ts` reads the same file."""

import json
from pathlib import Path

import pytest

from app.asset_review.findings_map import MapDot, geometry, nice_step, r2
from app.asset_review.frame import Frame
from app.asset_review.profiles import resolve

FIXTURE = Path(__file__).resolve().parents[2] / "contract" / "fixtures" / "asset-findings-map.json"
CASES = json.loads(FIXTURE.read_text("utf-8"))["cases"]


def test_the_fixture_has_the_three_cases():
    assert [c["name"] for c in CASES] == [
        "stack_compass_fraction_zones",
        "facade_faces_metre_zones",
        "tower_compass_north_offset",
    ]


@pytest.mark.parametrize("case", CASES, ids=[c["name"] for c in CASES])
def test_geometry_equals_the_fixture(case):
    review = resolve(case["profile_id"], case["frame"]["height_m"], case["overrides"])
    pinned = {
        "sides": review.sides.model_dump(mode="json"),
        "zones": [z.model_dump(mode="json") for z in review.zones],
    }
    assert pinned == case["review"]  # the TS side reads `review` straight from the fixture
    got = geometry(review, Frame.model_validate(case["frame"]), [MapDot(**d) for d in case["dots"]])
    assert json.loads(json.dumps(got)) == case["expected"]


def test_r2_rounds_half_up():
    assert (r2(0.125), r2(-0.004), r2(-0.006), r2(27.315)) == (0.13, 0.0, -0.01, 27.32)


@pytest.mark.parametrize(("h", "step"), [(80.0, 10.0), (42.0, 5.0), (74.4, 10.0), (12.0, 2.0), (3.0, 0.5)])
def test_nice_step(h, step):
    assert nice_step(h) == pytest.approx(step, abs=1e-12)


def test_dots_without_height_or_bearing_are_counted_not_drawn():
    review = resolve("tank", 10.0)
    g = geometry(
        review,
        Frame(height_m=10.0),
        [
            MapDot("a", 5.0, None, 1),
            MapDot("b", None, 90.0, 1),
            MapDot("c", 5.0, 90.0, 1),
        ],
    )
    assert [d["id"] for d in g["dots"]] == ["c"] and g["unplaced"] == 2


def test_dots_draw_lowest_severity_first_then_by_id():
    g = geometry(
        resolve("tank", 10.0),
        Frame(height_m=10.0),
        [
            MapDot("z", 1.0, 0.0, 3),
            MapDot("b", 1.0, 0.0, 1),
            MapDot("a", 1.0, 0.0, 1),
            MapDot("n", 1.0, 0.0, None),
        ],
    )
    assert [d["id"] for d in g["dots"]] == ["n", "a", "b", "z"]
