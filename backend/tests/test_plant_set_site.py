# backend/tests/test_plant_set_site.py
"""set_site (spec §8.2.1, §15; rulings R1, R2): the plant grid from grid points on placed pages or an
explicit frame; unplaced pages are georeferenced from the grid through the drawings georef service."""

import pytest
from drawings_helpers import build_drawing, inspect_ready, seed_frame, write_png
from plant_fakes import KIPIC, make_rc, seed_plant
from pyproj import CRS

from app.asset_models.agent.plant import tools_plant as T
from app.asset_models.agent.plant.context import Scope
from app.asset_models.siteframe import PlantGrid
from app.asset_models.spec import SiteFrame
from app.db.models import Drawing

UTM39 = CRS.from_epsg(32639).to_wkt()
GEOREF = {
    "method": "control_points",
    "crs_wkt": None,
    "epsg": None,
    "model": "similarity",
    "points": [],
    "dst_crs_wkt": UTM39,
    "transform": [0.5, 0.0, 244000.0, 0.0, 0.5, 3180000.0],
    "rmse_m": 0.0,
    "residuals_m": [],
    "warnings": [],
}
TRUE = SiteFrame.model_validate(
    {
        "crs": {"epsg": 32639},
        "origin_crs": [244500.0, 3179300.0],
        "plant_north_deg": 18.0,
        "source": {"kind": "assumed"},
    }
)


def orch(rc):
    return Scope(name="orchestrator", stage="survey", items=rc.store)


@pytest.fixture
def rc(handle, app):
    seed_frame(handle, 32639)
    ids = seed_plant(handle, app)
    r = make_rc(handle, app, ids)
    r.test_ids = ids
    return r


def _georef(handle, did):
    with handle.session() as s:
        s.get(Drawing, did).georef = dict(GEOREF)


def _page_xy(e, n):
    """Where plant (e, n) of TRUE sits on the seeded 4000 x 2800 px page placed by GEOREF."""
    X, Y = PlantGrid(TRUE).plant_to_site(e, n)
    col, row = (float(X) - 244000.0) / 0.5, -(float(Y) - 3180000.0) / 0.5
    return [col / 4000.0, row / 2800.0]


def test_an_explicit_frame_from_a_coordinate_note(rc):
    d0 = rc.test_ids["drawings"][0]
    out = T.run_plant_tool(
        rc, orch(rc), "set_site", {**KIPIC, "source_drawing_id": d0, "note": "coordinate note"}
    )
    assert out.ok and "17.9991" in out.text
    site = rc.site()
    assert site.crs.epsg == 32639 and site.datum.label == "HPFS" and site.datum.el_m == 100.0
    assert site.source.kind == "drawing" and site.source.id == d0
    X, Y = rc.grid().plant_to_site(0.0, 0.0)
    assert abs(float(X) - 244338.089) < 1e-6 and abs(float(Y) - 3179515.690) < 1e-6


def test_grid_points_on_a_placed_page_fit_the_frame(rc, handle):
    d0 = rc.test_ids["drawings"][0]
    _georef(handle, d0)
    gps = [
        {"drawing_id": d0, "page_xy": _page_xy(e, n), "plant_E": e, "plant_N": n}
        for e, n in ((0, 0), (400, 0), (0, 300), (400, 300))
    ]
    out = T.run_plant_tool(rc, orch(rc), "set_site", {"grid_points": gps, "datum_label": "EL"})
    assert out.ok, out.text
    site = rc.site()
    assert abs(site.origin_crs[0] - 244500.0) < 0.01 and abs(site.origin_crs[1] - 3179300.0) < 0.01
    assert abs(site.plant_north_deg - 18.0) < 1e-4
    assert "residual" in out.text.lower() and rc.state.questions == []


def test_a_large_residual_raises_an_open_question(rc, handle):
    d0 = rc.test_ids["drawings"][0]
    _georef(handle, d0)
    gps = [
        {"drawing_id": d0, "page_xy": _page_xy(e, n), "plant_E": e, "plant_N": n}
        for e, n in ((0, 0), (400, 0), (0, 300), (400, 300))
    ]
    gps[3]["page_xy"][0] += 0.003  # 12 px = 6 m off
    out = T.run_plant_tool(rc, orch(rc), "set_site", {"grid_points": gps})
    assert out.ok and "over 1 m" in out.text
    assert any("residual" in q for q in rc.state.questions)


def test_no_frame_without_a_placed_page_or_explicit_numbers(rc):
    d1 = rc.test_ids["drawings"][1]
    gps = [
        {"drawing_id": d1, "page_xy": [0.1, 0.1], "plant_E": 0, "plant_N": 0},
        {"drawing_id": d1, "page_xy": [0.9, 0.1], "plant_E": 100, "plant_N": 0},
    ]
    out = T.run_plant_tool(rc, orch(rc), "set_site", {"grid_points": gps})
    assert not out.ok and "origin_crs" in out.text and rc.site() is None


def test_coincident_grid_points_are_refused_with_the_reason(rc, handle):
    d0 = rc.test_ids["drawings"][0]
    _georef(handle, d0)
    gp = {"drawing_id": d0, "page_xy": [0.5, 0.5], "plant_E": 10, "plant_N": 10}
    out = T.run_plant_tool(rc, orch(rc), "set_site", {"grid_points": [gp, dict(gp)]})
    assert not out.ok and "plant points coincide" in out.text and rc.site() is None


def test_an_unplaced_page_is_georeferenced_from_the_grid(client, project_id, wait_job, tmp_path, handle, rc):
    png = write_png(tmp_path / "area.png", 3000, 2000)
    insp = inspect_ready(client, project_id, wait_job, png)
    did = build_drawing(client, project_id, wait_job, insp["id"], name="Area plan")["id"]
    rc.sources.append({"type": "drawing", "id": did, "label": "Area plan", "facts": ""})
    # 1 px = 0.5 m, plant north up the page: (u, v) -> E = 0.5 u, N = 0.5 (2000 - v)
    gps = [
        {"drawing_id": did, "page_xy": [u / 3000, v / 2000], "plant_E": 0.5 * u, "plant_N": 0.5 * (2000 - v)}
        for u, v in ((300, 1800), (2700, 1800), (300, 200))
    ]
    out = T.run_plant_tool(rc, orch(rc), "set_site", {**KIPIC, "grid_points": gps})
    assert out.ok and "Placed Area plan on the map from 3 grid points" in out.text
    got = client.get(f"/api/v1/projects/{project_id}/drawings/{did}").json()
    assert got["georef"]["method"] == "control_points" and got["georef"]["rmse_m"] < 0.01
    assert ("drawings.changed", {"drawing_ids": [did]}) in rc.job.published


def test_an_existing_georef_is_never_overwritten(rc, handle):
    d0 = rc.test_ids["drawings"][0]
    _georef(handle, d0)
    with handle.session() as s:
        before = s.get(Drawing, d0).georef_version
    gps = [
        {"drawing_id": d0, "page_xy": _page_xy(e, n), "plant_E": e, "plant_N": n}
        for e, n in ((0, 0), (400, 0))
    ]
    assert T.run_plant_tool(rc, orch(rc), "set_site", {"grid_points": gps}).ok
    with handle.session() as s:
        assert s.get(Drawing, d0).georef_version == before


def test_a_local_map_frame_places_no_page(handle, app):
    seed_frame(handle, None)
    ids = seed_plant(handle, app)
    rc = make_rc(handle, app, ids)
    d1 = ids["drawings"][1]
    gps = [
        {"drawing_id": d1, "page_xy": [0.1, 0.9], "plant_E": 0, "plant_N": 0},
        {"drawing_id": d1, "page_xy": [0.9, 0.9], "plant_E": 400, "plant_N": 0},
    ]
    out = T.run_plant_tool(rc, orch(rc), "set_site", {**KIPIC, "grid_points": gps})
    assert out.ok and "no coordinate system" in out.text
    with handle.session() as s:
        assert s.get(Drawing, d1).georef is None


def test_set_site_is_an_orchestrator_tool():
    assert "set_site" in T.ORCH_NAMES and "set_site" not in T.SUB_NAMES


def test_a_good_refit_removes_the_stale_grid_fit_question(rc, handle):
    d0 = rc.test_ids["drawings"][0]
    _georef(handle, d0)
    gps = [
        {"drawing_id": d0, "page_xy": _page_xy(e, n), "plant_E": e, "plant_N": n}
        for e, n in ((0, 0), (400, 0), (0, 300), (400, 300))
    ]
    bad = [dict(g, page_xy=list(g["page_xy"])) for g in gps]
    bad[3]["page_xy"][0] += 0.003
    assert T.run_plant_tool(rc, orch(rc), "set_site", {"grid_points": bad}).ok
    assert any("plant grid fit" in q for q in rc.state.questions)
    out = T.run_plant_tool(rc, orch(rc), "set_site", {"grid_points": gps})
    assert out.ok and "over 1 m" not in out.text
    assert not any("plant grid fit" in q for q in rc.state.questions)


def test_a_stated_frame_wins_over_a_grid_fit_from_a_misplaced_page(rc, handle):
    """Al-Zour live run 1: the overall plan was placed on the map ~26 m off, and the grid fit through it
    overrode the frame General Note 2 states. The drawing's statement is authoritative; the fit is a
    cross-check whose disagreement becomes an open question."""
    d0 = rc.test_ids["drawings"][0]
    _georef(handle, d0)  # places the page so the grid fits TRUE: 244500 / 3179300 / 18.0 deg
    gps = [
        {"drawing_id": d0, "page_xy": _page_xy(e, n), "plant_E": e, "plant_N": n}
        for e, n in ((0, 0), (400, 0), (0, 300), (400, 300))
    ]
    stated = {"epsg": 32639, "origin_crs": [244520.0, 3179290.0], "plant_north_deg": 18.2}
    out = T.run_plant_tool(
        rc, orch(rc), "set_site", {**stated, "grid_points": gps, "source_drawing_id": d0, "note": "note 2"}
    )
    assert out.ok, out.text
    site = rc.site()
    assert site.origin_crs == (244520.0, 3179290.0) and site.plant_north_deg == 18.2
    assert site.source.kind == "drawing" and site.source.id == d0
    assert "stated frame is used" in out.text
    assert any("stated" in q and "grid" in q for q in rc.state.questions)
