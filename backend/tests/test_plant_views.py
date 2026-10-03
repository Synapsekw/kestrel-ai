# backend/tests/test_plant_views.py
"""ortho_view and render_site (spec §8.3): bounded mosaics, plant north up, <= 1 600 px, <= 4 views."""

import io

import pytest
from drawings_helpers import seed_frame
from PIL import Image
from plant_fakes import KIPIC, item, make_rc, seed_plant

from app.asset_models.agent.plant import tools_plant as T
from app.asset_models.agent.plant import views
from app.asset_models.agent.plant.context import Scope
from app.asset_models.spec import Item, SiteFrame

FRAME = SiteFrame.model_validate(
    {
        "crs": {"epsg": 32639},
        "origin_crs": KIPIC["origin_crs"],
        "plant_north_deg": KIPIC["plant_north_deg"],
        "datum": {"label": "HPFS", "el_m": 100.0},
        "source": {"kind": "assumed"},
    }
)


def red_tile():
    buf = io.BytesIO()
    Image.new("RGBA", (256, 256), (255, 0, 0, 255)).save(buf, "PNG")
    return buf.getvalue()


@pytest.fixture
def rc(handle, app):
    seed_frame(handle, 32639)
    r = make_rc(handle, app, seed_plant(handle, app))
    r.state.site = FRAME.model_dump(mode="json")
    return r


def orch(rc, stage="build"):
    return Scope(name="orchestrator", stage=stage, items=rc.store)


def _store(rc, *raws):
    for raw in raws:
        i = Item.model_validate(raw)
        rc.store[i.id] = i


def test_ortho_view_is_bounded_and_plant_north_up(rc, monkeypatch):
    from app.workspace import tiles

    calls = []
    monkeypatch.setattr(tiles, "serve_site_tile", lambda *a, **k: calls.append(a) or red_tile())
    monkeypatch.setattr(views, "pick_map", lambda handle: "map-1")
    _store(rc, item("t1", e=100, n=50))
    out = T.run_plant_tool(rc, orch(rc, "environment"), "ortho_view", {"bbox": [0, 0, 400, 200]})
    assert out.ok and out.image and "plant north up" in out.text
    img = Image.open(io.BytesIO(out.image)).convert("RGB")
    assert max(img.size) <= 1600 and img.size[0] > img.size[1]
    r, g, _ = img.getpixel((img.size[0] // 4, img.size[1] // 4))
    assert r > 150 and g < 100
    assert 0 < len(calls) <= views.MAX_TILES


def test_ortho_view_refusals(rc, monkeypatch):
    sc = orch(rc, "environment")
    assert "at most 5 000 m" in T.run_plant_tool(rc, sc, "ortho_view", {"bbox": [0, 0, 9000, 10]}).text
    monkeypatch.setattr(views, "pick_map", lambda handle: None)
    assert "no ortho" in T.run_plant_tool(rc, sc, "ortho_view", {"bbox": [0, 0, 100, 100]}).text
    rc.state.site = None
    assert "set_site" in T.run_plant_tool(rc, sc, "ortho_view", {"bbox": [0, 0, 100, 100]}).text


def test_pick_map_without_maps(rc):
    assert views.pick_map(rc.handle) is None


def test_render_site_plan_and_iso(rc):
    _store(rc, item("t1", e=0, n=0), item("t2", e=40, n=10, area="20"), item("t3", e=80, n=-20, area="20"))
    rc.state.environment = [
        {
            "id": "sea",
            "kind": "sea",
            "pts": [[-50, -50], [150, -50], [150, -30]],
            "el": 100.0,
            "source": {"kind": "assumed"},
            "confidence": "medium",
        }
    ]
    sc = orch(rc)
    out = T.run_plant_tool(rc, sc, "render_site", {"views": ["plan", "iso"], "overlay": "none"})
    assert out.ok and out.image and out.text.startswith("Rendered plan, iso")
    assert max(Image.open(io.BytesIO(out.image)).size) <= 1600
    assert sc.rendered is True
    area = T.run_plant_tool(rc, sc, "render_site", {"views": ["area:20"], "overlay": "none"})
    assert area.ok
    missing = T.run_plant_tool(rc, sc, "render_site", {"views": ["area:99"], "overlay": "none"})
    assert not missing.ok and "Areas: 20" in missing.text


def test_render_site_with_nothing_and_with_too_many_views(rc):
    sc = orch(rc)
    assert not T.run_plant_tool(rc, sc, "render_site", {"views": ["plan"]}).ok
    assert not T.run_plant_tool(rc, sc, "render_site", {"views": ["plan"] * 5}).ok


def test_render_site_notes_a_missing_ortho(rc, monkeypatch):
    monkeypatch.setattr(views, "pick_map", lambda handle: None)
    _store(rc, item("t1"))
    out = T.run_plant_tool(rc, orch(rc), "render_site", {"views": ["plan"]})
    assert out.ok and "No ortho in this project" in out.text


def test_iso_stops_at_the_triangle_cap(rc, monkeypatch):
    monkeypatch.setattr(views, "TRI_CAP", 1)
    _store(rc, item("t1"), item("t2", e=30), item("t3", e=60))
    out = T.run_plant_tool(rc, orch(rc), "render_site", {"views": ["iso"], "overlay": "none"})
    assert out.ok and "2 items not drawn" in out.text


def test_bbox_and_sheet_helpers(rc):
    i = Item.model_validate(item("t1", size=(2.0, 2.0)))
    e0, n0, e1, n1 = views.bbox_of([i], [])
    assert e1 - e0 >= 20 and n1 - n0 >= 20
    wide = [Image.new("RGB", (3000, 500)) for _ in range(4)]
    out = views.sheet(wide, ["a", "b", "c", "d"])
    assert max(out.size) <= 1600


def test_render_and_ortho_tool_roles():
    assert "render_site" in T.ORCH_NAMES and "render_site" not in T.SUB_NAMES
    assert "ortho_view" in T.ORCH_NAMES and "ortho_view" in T.SUB_NAMES
