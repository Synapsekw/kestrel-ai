"""The plant run sees drawing pages grouped by source file (I1; spec §8.1)."""

from plant_fakes import make_rc, seed_plant

from app.asset_models.agent.plant import prompt_plant as P
from app.asset_models.agent.plant import tools_plant as T
from app.asset_models.agent.plant.context import Scope


def test_list_sources_groups_pages_by_file(handle, app):
    ids = seed_plant(handle, app, pages=3)
    rc = make_rc(handle, app, ids)
    out = T.run_plant_tool(rc, Scope(name="orchestrator", stage="survey", items=rc.store), "list_sources", {})
    assert out.ok and all(d in out.text for d in ids["drawings"])
    assert out.text.count("plot.pdf") == 1


def test_the_opening_lists_files_not_pages(handle, app):
    ids = seed_plant(handle, app, pages=3)
    rc = make_rc(handle, app, ids)
    first = P.first_message(rc)
    assert first.count("plot.pdf") == 1 and all(d in first for d in ids["drawings"])
    assert "C:/plans" not in first  # file name only, never the path


def test_many_pages_stay_one_line_and_nothing_is_dropped_silently(handle, app):
    ids = seed_plant(handle, app, pages=80)
    rc = make_rc(handle, app, ids)
    first = P.first_message(rc)
    assert first.count("plot.pdf") == 1 and all(d in first for d in ids["drawings"])
    assert "more" not in first


def test_truncated_opening_says_how_many_and_points_to_list_sources(handle, app):
    ids = seed_plant(handle, app, pages=2, clouds=[f"c{k}" for k in range(70)])
    rc = make_rc(handle, app, ids)
    first = P.first_message(rc)
    assert "11 more" in first and "list_sources" in first.split("more")[1]


def test_the_resume_brief_carries_the_whole_grouped_source_list(handle, app):
    ids = seed_plant(handle, app, pages=80, clouds=[f"cloud-{k}" for k in range(70)])
    rc = make_rc(handle, app, ids)
    msg = P.resume_message(rc)
    assert msg.count("plot.pdf") == 1 and all(d in msg for d in ids["drawings"])
    assert all(f"cloud-{k}" in msg for k in range(70)) and "C:/plans" not in msg
