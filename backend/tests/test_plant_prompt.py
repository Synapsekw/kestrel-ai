# backend/tests/test_plant_prompt.py
"""Plant prompts (spec §8.5): frame, authority, scanned plot plans, catalogue, honesty, no invented
tags; never a key or a file-system path."""

import re
from types import SimpleNamespace

from app.asset_models.agent.plant import prompt_plant as P
from app.asset_models.agent.plant.budget import PlantLimits
from app.asset_models.agent.plant.packages import PackageWork
from app.asset_models.agent.plant.state import PlantState

# Stand-ins until Task 5 (PlantRunContext / plant_fakes) and the tools module land.
KEY = "sk-ant-test-0123456789"
ORCH_NAMES = (
    "set_site",
    "plan_packages",
    "next_stage",
    "finish",
    "render_site",
    "upsert_environment",
    "drawing_zoom",
)
SUB_NAMES = ("finish_package", "upsert_items", "drawing_zoom", "items_query")


def seed_plant():
    return {"drawings": ["drw-0001"]}


def make_rc(ids):
    return SimpleNamespace(
        sources=[{"type": "drawing", "id": ids["drawings"][0], "label": "Plot plan", "facts": "A0, 3 pages"}],
        limits=PlantLimits(),
        notes="",
        state=PlantState(),
        store={},
        site=lambda: None,
    )


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


def test_messages_carry_no_key_or_path():
    ids = seed_plant()
    rc = make_rc(ids)
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
