"""The height locator (a port of the kit's gen.py locator) and the adapter from P1's findings-map
geometry to AssetDrawing primitives (spec 2026-10-02-asset-findings §10)."""

import json
from pathlib import Path

import pytest
from reports_asset_rows import frame_of

from app.asset_review.findings_map import MapDot, geometry
from app.asset_review.profiles import resolve
from app.reports.asset_drawing import LOC_CX, height_locator, map_drawing, nice_step
from app.reports.schemas import AssetDrawing

SIL = [(0.0, 6.0), (30.0, 5.0), (60.0, 4.0)]
MAP_FIXTURE = Path(__file__).resolve().parents[2] / "contract" / "fixtures" / "asset-findings-map.json"
COLOURS = {None: "#9A98B0", 1: "#FAD34B", 2: "#FF7A2D", 3: "#EE3F4B"}


@pytest.mark.parametrize(
    ("total", "step"), [(60.0, 10.0), (74.4, 10.0), (100.0, 10.0), (8.0, 1.0), (300.0, 50.0)]
)
def test_nice_step_matches_the_kit(total, step):
    assert nice_step(total) == pytest.approx(step)


def test_the_height_locator_marks_the_height_on_the_silhouette():
    d = AssetDrawing.model_validate(height_locator(60.0, SIL, [20.0, 40.0], 30.0, "#FF7A2D"))
    assert (d.width, d.height, d.font_size) == (64.0, 200.0, 6.0)
    assert d.marker.y == pytest.approx(97.0) and d.marker.colour == "#FF7A2D"
    [dot] = d.dots
    assert (dot.x, dot.y, dot.label) == (LOC_CX, pytest.approx(97.0), "30.0 m")
    assert [t.label for t in d.y_ticks] == ["0", "20", "40", "60"]
    assert d.y_ticks[0].at == pytest.approx(186.0) and d.y_ticks[-1].at == pytest.approx(8.0)
    assert len(d.silhouette) == 2 * len(SIL)
    assert d.levels[0].x0 == pytest.approx(16.0)  # 39 - 6 * (20 / 6) - 3
    assert d.x_title == "30.0 m"


def test_a_height_above_the_asset_is_clamped_to_the_top():
    d = AssetDrawing.model_validate(height_locator(60.0, SIL, [], 80.0, "#FF7A2D"))
    assert d.marker.y == pytest.approx(8.0)
    assert d.dots[0].label == "80.0 m"


def test_no_silhouette_draws_the_axis_and_the_marker_only():
    d = AssetDrawing.model_validate(height_locator(60.0, [], [], 10.0, "#FF7A2D"))
    assert d.silhouette == [] and d.levels == [] and len(d.dots) == 1


def test_the_map_adapter_reads_the_shared_fixture():
    case = json.loads(MAP_FIXTURE.read_text("utf-8"))["cases"][0]
    geom = case["expected"]
    d = AssetDrawing.model_validate(
        map_drawing(geom, colour_of=lambda s: COLOURS[s], label_of=lambda i: f"label {i}")
    )
    p = geom["plot"]
    assert (d.plot.x0, d.plot.y0, d.plot.x1, d.plot.y1) == (p["x"], p["y"], p["x"] + p["w"], p["y"] + p["h"])
    assert [b.label for b in d.bands] == [z["label"] for z in geom["zones"]]
    assert [b.shaded for b in d.bands] == [z["shade"] for z in geom["zones"]]
    assert [t.at for t in d.x_ticks] == [t["x"] for t in geom["x_ticks"]]
    assert d.y_ticks[0].label == f"{geom['y_ticks'][0]['value']:g} m"
    assert [x.label for x in d.dots] == [f"label {x['id']}" for x in geom["dots"]]  # P1's order, worst last
    assert all(x.r == geom["dot_r"] for x in d.dots)
    assert d.x_title == geom["axis_title"]
    assert len(d.levels) == len(geom["levels"])


def test_the_map_adapter_on_a_live_geometry():
    review = resolve("stack", 60.0)
    dots = [
        MapDot(id="f1", height_m=50.0, bearing_deg=90.0, severity=2),
        MapDot(id="f2", height_m=10.0, bearing_deg=200.0, severity=1),
    ]
    labels = {"f1": "F-0001", "f2": "F-0002"}
    d = AssetDrawing.model_validate(
        map_drawing(
            geometry(review, frame_of(60.0), dots), colour_of=lambda s: COLOURS[s], label_of=labels.get
        )
    )
    assert [x.label for x in d.dots] == ["F-0002", "F-0001"]
    hi, lo = d.dots[1], d.dots[0]
    assert hi.y < lo.y  # higher on the asset is higher on the page
    assert all(d.plot.x0 <= x.x <= d.plot.x1 for x in d.dots)
