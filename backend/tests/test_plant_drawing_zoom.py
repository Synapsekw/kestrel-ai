# backend/tests/test_plant_drawing_zoom.py
"""drawing_zoom (spec §8.3; index Review Focus #1): a page region at up to 600 dpi, never over
1 600 px, capped with a note rather than an error."""

import io

import pytest
from drawings_helpers import build_drawing, inspect_ready, write_pdf, write_png
from PIL import Image
from plant_fakes import make_rc, seed_plant

from app.asset_models.agent.plant import tools_plant as T
from app.asset_models.agent.plant import views
from app.asset_models.agent.plant.context import Scope
from app.asset_models.look import LookError
from app.db.models import Drawing


@pytest.fixture
def a0_drawing(client, project_id, wait_job, tmp_path):
    pdf = write_pdf(tmp_path / "plot.pdf", [(3370.0, 2384.0)])  # an A0 sheet, as Al-Zour's 1:3000 plot plans
    inspection = inspect_ready(client, project_id, wait_job, pdf)
    return build_drawing(client, project_id, wait_job, inspection["id"], dpi=100)["id"]


def test_drawing_zoom_caps_dpi_with_note(handle, a0_drawing):
    whole = views.drawing_zoom(handle, a0_drawing, [0.0, 0.0, 1.0, 1.0], 600)
    assert max(whole.width, whole.height) <= 1600
    assert whole.dpi == 34  # floor(1600 / (3370 / 72))
    assert "Rendered at 34 dpi, not 600" in whole.note and "smaller region" in whole.note
    small = views.drawing_zoom(handle, a0_drawing, [0.40, 0.40, 0.45, 0.45], 600)
    assert small.dpi == 600 and small.note == "" and abs(small.width - 1404) <= 2
    capped = views.drawing_zoom(handle, a0_drawing, [0.40, 0.40, 0.45, 0.45], 1200)
    assert capped.dpi == 600 and "600 dpi is the most" in capped.note


def test_the_tool_never_errors_the_run(handle, app, a0_drawing, monkeypatch):
    rc = make_rc(handle, app, seed_plant(handle, app))
    rc.sources.append({"type": "drawing", "id": a0_drawing, "label": "Plot", "facts": ""})
    sc = Scope(name="orchestrator", stage="survey", items=rc.store)
    out = T.run_plant_tool(
        rc, sc, "drawing_zoom", {"drawing_id": a0_drawing, "region": [0, 0, 1, 1], "dpi": 1200}
    )
    assert out.ok and out.image and "34 dpi" in out.text and "600 dpi is the most" in out.text
    assert max(Image.open(io.BytesIO(out.image)).size) <= 1600

    def boom(*_a, **_k):
        raise RuntimeError("C:/secret/plot.pdf")

    monkeypatch.setattr(views, "drawing_zoom", boom)
    out = T.run_plant_tool(rc, sc, "drawing_zoom", {"drawing_id": a0_drawing, "region": [0, 0, 1, 1]})
    assert not out.ok and "RuntimeError" in out.text and "secret" not in out.text
    foreign = T.run_plant_tool(rc, sc, "drawing_zoom", {"drawing_id": "nope", "region": [0, 0, 1, 1]})
    assert not foreign.ok and "not one of this run's sources" in foreign.text


def test_a_scan_is_shown_at_a_stated_share_of_its_resolution(client, project_id, wait_job, handle, tmp_path):
    png = write_png(tmp_path / "scan.png", 3200, 2000)
    did = build_drawing(client, project_id, wait_job, inspect_ready(client, project_id, wait_job, png)["id"])[
        "id"
    ]
    z = views.drawing_zoom(handle, did, [0, 0, 1, 1], 300)
    assert z.dpi is None and "Shown at 50% of the scan's resolution" in z.note and z.width == 1600
    assert views.drawing_zoom(handle, did, [0, 0, 0.25, 0.25], 300).note == ""


def test_vector_drawings_have_no_page_image(handle):
    with handle.session() as s:
        d = Drawing(name="GA.dxf", format="dxf", status="ready", source_path="C:/x/GA.dxf", source_size=1)
        s.add(d)
        s.flush()
        did = d.id
    with pytest.raises(LookError, match="drawing_text"):
        views.drawing_zoom(handle, did, [0, 0, 1, 1], 300)


def test_overlay_draws_plant_grid_lines(handle, a0_drawing):
    z = views.drawing_zoom(
        handle, a0_drawing, [0, 0, 1, 1], 30, page_to_plant=lambda fx, fy: (fx * 1000.0, (1 - fy) * 700.0)
    )
    assert z.grid_step_m == 200.0
    assert views.drawing_zoom(handle, a0_drawing, [0, 0, 1, 1], 30).grid_step_m is None


def test_overlay_degrades_to_ticks_when_the_mapper_returns_non_finite(handle, a0_drawing):
    for bad in (float("nan"), float("inf")):
        z = views.drawing_zoom(
            handle, a0_drawing, [0, 0, 1, 1], 30, page_to_plant=lambda fx, fy, b=bad: (b, b)
        )
        assert z.grid_step_m is None and z.jpeg


def test_nice_steps_and_segments():
    assert views._nice(166.7) == 200.0 and views._nice(0.013) == 0.02 and views._nice(3) == 5.0
    assert views._segment(1.0, 0.0, 0.0, 50.0, 100, 80) == ((50.0, 0.0), (50.0, 80.0))
    assert views._segment(1.0, 0.0, 0.0, 500.0, 100, 80) is None
    assert views.zoom_dpi(1.0, 1.0, 300) == (300, "")
