# backend/tests/test_plant_prompt.py
"""Plant prompts (spec §8.5): frame, authority, scanned plot plans, catalogue, honesty, no invented
tags; never a key or a file-system path."""

import re

from plant_fakes import KEY, KIPIC, item, make_rc, seed_plant

from app.asset_models.agent.plant import prompt_plant as P
from app.asset_models.agent.plant.packages import PackageWork
from app.asset_models.agent.plant.tools_plant import ORCH_NAMES, SUB_NAMES
from app.asset_models.spec import Item, SiteFrame

PATH = re.compile(r"[A-Za-z]:[\\/]|\\\\|/Users/|/home/")


def test_orchestrator_prompt_covers_the_rules():
    s = P.ORCH_SYSTEM
    assert "The drawing decides plan position; the cloud decides height" in s  # D5
    assert "x = plant north" in s and "z = plant east" in s  # D9
    assert "title block" in s and "key plan" in s and "equipment list" in s and "leader" in s
    assert "Never invent a tag" in s and "indicative" in s and "other" in s and "composite" in s
    for name in (
        "set_site",
        "plan_packages",
        "next_stage",
        "finish",
        "render_site",
        "upsert_environment",
        "drawing_zoom",
    ):
        assert name in s and name in ORCH_NAMES


def test_sub_run_prompt_covers_the_rules_and_the_catalogue():
    s = P.sub_system("pipe_rack (structure, default height 8 m): racks")
    assert s.startswith(P.SUB_SYSTEM) and s.endswith("pipe_rack (structure, default height 8 m): racks")
    for phrase in (
        "plant metres",
        "Never invent a tag",
        "finish_package",
        "drawing_zoom",
        "upsert_items",
        "height_source",
    ):
        assert phrase in s
    for name in ("finish_package", "upsert_items", "drawing_zoom", "items_query"):
        assert name in SUB_NAMES


def test_messages_carry_no_key_or_path(handle, app):
    ids = seed_plant(handle, app)
    rc = make_rc(handle, app, ids)
    rc.notes = "Focus on the jetty."
    w = PackageWork(
        id="p",
        n=3,
        label="Jetty head",
        drawing_id=ids["drawings"][0],
        region=(0.1, 0.2, 0.5, 0.6),
        area="10",
        brief="Jetty at 1:500",
        expected_tags=("10-L-0001",),
    )
    texts = [
        P.ORCH_SYSTEM,
        P.sub_system("x"),
        P.first_message(rc),
        P.survey_message(),
        P.review_message(rc),
        P.environment_message(rc),
        P.build_message(rc, ["a", "b"]),
        P.resume_message(rc),
        P.package_brief(w, rc),
    ]
    for t in texts:
        assert KEY not in t and not PATH.search(t), t[:200]
    brief = P.package_brief(w, rc)
    assert (
        brief.startswith("Package P3: Jetty head\n") and "10-L-0001" in brief and ids["drawings"][0] in brief
    )
    assert "[0.1, 0.2, 0.5, 0.6]" in brief
    first = P.first_message(rc)
    assert "Focus on the jetty." in first and "40,000,000 tokens" in first and "list_sources" in first
    assert "2 items fell back" in P.build_message(rc, ["a", "b"])


def test_review_message_and_frame_line_with_a_site_flags_and_candidates(handle, app):
    rc = make_rc(handle, app, seed_plant(handle, app))
    rc.state.site = SiteFrame.model_validate(
        {
            "crs": {"epsg": KIPIC["epsg"]},
            "origin_crs": KIPIC["origin_crs"],
            "plant_north_deg": KIPIC["plant_north_deg"],
            "datum": {"label": "HPFS", "el_m": 100.0},
            "source": {"kind": "assumed"},
        }
    ).model_dump(mode="json")
    flagged = Item.model_validate(
        item("t1", flags=[{"code": "straddles_package", "value": 3.0, "note": "x"}])
    )
    rc.store[flagged.id] = flagged
    rc.state.candidates = [
        {"id": "cand-1", "e": 10.0, "n": 20.0, "size_m": [4.0, 3.0], "top_el": 108.0},
        {"id": "cand-2", "e": 50.0, "n": 60.0, "size_m": [2.0, 2.0], "top_el": 104.0},
    ]
    msg = P.review_message(rc)
    assert "cand-1" in msg and "cand-2" in msg and "straddles_package 1" in msg
    assert "1 items" in msg
    frame = P._frame_line(rc)
    assert "The site frame is set" in frame and "datum HPFS = 100 m" in frame and "17.9991" in frame


def test_the_frame_a_drawing_states_is_authoritative():
    """Al-Zour live run 1 fitted the frame through a roughly placed page instead of General Note 2."""
    from app.asset_models.agent.plant import prompt_plant as P

    assert "authoritative" in P.ORCH_SYSTEM and "note wins" in P.ORCH_SYSTEM


def test_shorelines_come_from_the_largest_scale_plan_and_the_ortho():
    """Live run 1 traced the shore from the 1:3000 overall plan and missed Cowork's by up to 181 m."""
    from app.asset_models.agent.plant import prompt_plant as P

    assert "largest-scale" in P.ORCH_SYSTEM and "every 20 m" in P.ORCH_SYSTEM
    assert "use that type, not package" in P.ORCH_SYSTEM
