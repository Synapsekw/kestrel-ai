# backend/tests/test_plant_tools_items.py
"""The register tools of the plant run (spec §8.3): per-item validation, stage rules, bounds."""

import pytest
from plant_fakes import item, make_rc, seed_plant

from app.asset_models.agent.plant import packages as pk
from app.asset_models.agent.plant import record
from app.asset_models.agent.plant import tools_plant as T
from app.asset_models.agent.plant.context import Scope
from app.asset_models.agent.plant.packages import PackageWork
from app.asset_models.agent.plant.state import load_merged
from app.asset_models.agent.tools import ToolOut
from app.asset_models.builders.base import PLANNED_TYPES, REGISTRY, load_all
from app.db.models import AssetModelRun


@pytest.fixture
def rc(handle, app):
    ids = seed_plant(handle, app)
    r = make_rc(handle, app, ids)
    r.test_ids = ids
    return r


def pkg(rc, n=1, expected=("20-T-0001", "20-T-0002")):
    w = PackageWork(
        id=f"p{n}",
        n=n,
        label="Tanks",
        drawing_id=rc.test_ids["drawings"][0],
        region=None,
        area="20",
        brief="b",
        expected_tags=tuple(expected),
    )
    return Scope(name=f"P{n}", stage="trace", items={}, package=w)


def orch(rc, stage):
    return Scope(name="orchestrator", stage=stage, items=rc.store)


def test_upsert_items_partial_accept(rc):
    sc = pkg(rc)
    bad_type = item("b1", type="no_such_type")
    crossing = item("b2")
    crossing["footprint"] = {"kind": "polygon", "pts": [[0, 0], [10, 10], [10, 0], [0, 10]]}
    upside = item("b3", base_el=110.0, top_el=100.0)
    goods = [item(f"g{k}", tag=f"20-T-{k:04d}", e=k * 20.0) for k in range(147)]
    out = T.run_plant_tool(
        rc, sc, "upsert_items", {"items": [*goods[:70], bad_type, crossing, upside, *goods[70:]]}
    )
    assert out.ok and len(sc.items) == 147 and set(sc.items) == {f"g{k}" for k in range(147)}
    assert "Rejected 3" in out.text and "- b1:" in out.text and "unknown type" in out.text
    assert "- b2:" in out.text and "- b3:" in out.text
    assert out.summary == "Saved 147 items, rejected 3"


def test_more_than_150_items_is_a_bad_arguments_error(rc):
    out = T.run_plant_tool(rc, pkg(rc), "upsert_items", {"items": [item(f"g{k}") for k in range(151)]})
    assert not out.ok and out.text.startswith("Bad arguments for upsert_items")


def test_orchestrator_cannot_write_items_during_the_survey(rc):
    out = T.run_plant_tool(rc, orch(rc, "survey"), "upsert_items", {"items": [item("a")]})
    assert not out.ok and "plan_packages" in out.text and rc.store == {}


def test_review_marks_new_cloud_items_unregistered_and_saves_the_store(rc):
    sc = orch(rc, "review")
    cloud_item = item("c1", source={"kind": "cloud", "id": "cloud-1"})
    out = T.run_plant_tool(rc, sc, "upsert_items", {"items": [cloud_item, item("d1")]})
    assert out.ok
    assert [f.code for f in rc.store["c1"].flags] == ["unregistered"] and rc.store["d1"].flags == []
    assert {i.id for i in load_merged(rc.run_dir)} == {"c1", "d1"}


def test_two_fix_rounds_then_finish(rc):
    sc = orch(rc, "build")
    for k in range(2):
        sc.rendered = True
        assert T.run_plant_tool(rc, sc, "upsert_items", {"items": [item(f"f{k}")]}).ok
    assert T.run_plant_tool(rc, sc, "upsert_items", {"items": [item("f9")]}).ok  # no render since: same round
    sc.rendered = True
    out = T.run_plant_tool(rc, sc, "upsert_items", {"items": [item("f3")]})
    assert not out.ok and "call finish" in out.text and rc.state.fix_rounds == 2


def test_remove_items(rc):
    sc = pkg(rc)
    T.run_plant_tool(rc, sc, "upsert_items", {"items": [item("a"), item("b")]})
    out = T.run_plant_tool(rc, sc, "remove_items", {"ids": ["a", "zz"]})
    assert out.ok and set(sc.items) == {"b"} and "zz" in out.text


def test_items_query_filters_pages_and_lists_missing_expected_tags(rc):
    sc = pkg(rc)
    batch = [item(f"g{k}", tag=f"20-T-{k:04d}", e=float(k)) for k in range(150)]
    T.run_plant_tool(rc, sc, "upsert_items", {"items": batch})
    T.run_plant_tool(
        rc, sc, "upsert_items", {"items": [item(f"h{k}", e=float(k), area="30") for k in range(150)]}
    )
    T.run_plant_tool(rc, sc, "upsert_items", {"items": [item(f"j{k}", e=float(k)) for k in range(100)]})
    out = T.run_plant_tool(rc, sc, "items_query", {})
    assert out.text.startswith("400 items match") and "(more: call again with start=" in out.text
    assert out.text.count("\n") <= 300 + 4 and len(out.text) <= T.MAX_TEXT
    one = T.run_plant_tool(rc, sc, "items_query", {"tag": "t-0002"})
    assert one.text.startswith("1 items match") and "g2 | 20-T-0002" in one.text
    assert T.run_plant_tool(rc, sc, "items_query", {"area": "30"}).text.startswith("150 items match")
    assert T.run_plant_tool(rc, sc, "items_query", {"bbox": [0, -1, 9.5, 1]}).text.startswith(
        "30 items match"
    )
    T.run_plant_tool(rc, sc, "remove_items", {"ids": ["g1"]})
    assert "Expected but not traced yet: 20-T-0001" in T.run_plant_tool(rc, sc, "items_query", {}).text


def test_plan_packages_writes_rows_only_in_the_survey(rc, handle):
    sc = orch(rc, "survey")
    d0 = rc.test_ids["drawings"][0]
    body = {
        "packages": [
            {
                "label": "Tanks",
                "drawing_id": d0,
                "region": [0, 0, 0.5, 1],
                "area": "20",
                "brief": "8 LNG tanks",
                "expected_tags": ["20-T-0001"],
            },
            {"label": "Jetty", "drawing_id": d0, "region": [0.5, 0, 1, 1]},
        ]
    }
    out = T.run_plant_tool(rc, sc, "plan_packages", body)
    assert out.ok and "P1 Tanks" in out.text and "P2 Jetty" in out.text
    with handle.session() as s:
        rows = pk.rows(s, rc.run_id)
        assert [r.label for r in rows] == ["Tanks", "Jetty"]
        assert rc.state.packages_meta[rows[0].id] == {"brief": "8 LNG tanks", "expected_tags": ["20-T-0001"]}
    foreign = T.run_plant_tool(rc, sc, "plan_packages", {"packages": [{"label": "X", "drawing_id": "nope"}]})
    assert not foreign.ok and "not one of this run's drawings" in foreign.text
    late = T.run_plant_tool(rc, orch(rc, "review"), "plan_packages", body)
    assert not late.ok and "survey" in late.text
    assert not T.run_plant_tool(rc, pkg(rc), "plan_packages", body).ok  # not a package tool


def test_next_stage_needs_a_package_and_finish_needs_the_build_stage(rc):
    sc = orch(rc, "survey")
    assert not T.run_plant_tool(rc, sc, "next_stage", {"summary": "done"}).ok
    T.run_plant_tool(
        rc, sc, "plan_packages", {"packages": [{"label": "A", "drawing_id": rc.test_ids["drawings"][0]}]}
    )
    assert (
        T.run_plant_tool(rc, sc, "next_stage", {"summary": "1 package"}).ok and sc.next_stage == "1 package"
    )
    assert not T.run_plant_tool(rc, orch(rc, "environment"), "finish", {"summary": "x"}).ok
    b = orch(rc, "build")
    assert not T.run_plant_tool(rc, b, "next_stage", {"summary": "x"}).ok
    assert T.run_plant_tool(rc, b, "finish", {"summary": "Built.", "open_questions": ["Q?"]}).ok
    assert rc.finished == {"summary": "Built.", "open_questions": ["Q?"]}


def test_finish_package(rc):
    sc = pkg(rc)
    assert T.run_plant_tool(rc, sc, "finish_package", {"summary": "Traced 4.", "open_questions": ["Tag?"]}).ok
    assert sc.finished == {"summary": "Traced 4.", "open_questions": ["Tag?"]}


def test_catalogue(rc):
    sc = pkg(rc)
    listing = T.run_plant_tool(rc, sc, "catalogue", {})
    assert listing.ok and "other (fallback" in listing.text
    one = T.run_plant_tool(rc, sc, "catalogue", {"type": "other"})
    assert one.ok and '"params_schema"' in one.text
    assert not T.run_plant_tool(rc, sc, "catalogue", {"type": "warp_drive"}).ok
    assert "other (fallback" in T.catalogue_text()


def test_catalogue_listing_names_every_type_within_the_reply_cap(rc):
    """With every builder family registered the listing must not be cut off (coordinator fix)."""
    from app.asset_models.builders.base import REGISTRY, load_all

    load_all()
    listing = T.run_plant_tool(rc, pkg(rc), "catalogue", {})
    assert listing.ok and "(cut off)" not in listing.text
    assert len(listing.text) <= T.MAX_TEXT
    for t in REGISTRY:
        assert f"\n{t} (" in "\n" + listing.text, t


def test_upsert_environment(rc):
    sea = {
        "id": "sea",
        "kind": "sea",
        "pts": [[0, 0], [100, 0], [100, 50]],
        "el": 100.0,
        "source": {"kind": "assumed"},
    }
    bow = {
        "id": "bad",
        "kind": "land",
        "pts": [[0, 0], [10, 10], [10, 0], [0, 10]],
        "el": 100.0,
        "source": {"kind": "assumed"},
    }
    assert not T.run_plant_tool(rc, orch(rc, "survey"), "upsert_environment", {"features": [sea]}).ok
    out = T.run_plant_tool(rc, orch(rc, "environment"), "upsert_environment", {"features": [sea, bow]})
    assert out.ok and [f["id"] for f in rc.state.environment] == ["sea"] and "- bad:" in out.text


def test_tool_sets_by_role():
    orch_names = [s.name for s in T.specs_for("orchestrator")]
    sub_names = [s.name for s in T.specs_for("package")]
    assert "plan_packages" in orch_names and "finish" in orch_names and "finish_package" not in orch_names
    assert "plan_packages" not in sub_names and "finish" not in sub_names and "finish_package" in sub_names
    assert {"drawing_view", "drawing_text", "list_sources"} <= set(sub_names)
    assert all(s.input_schema.get("type") == "object" for s in T.specs_for("package"))


def test_m1_look_tools_run_for_packages(rc):
    out = T.run_plant_tool(rc, pkg(rc), "list_sources", {})
    assert out.ok and "Plot plan" in out.text


def test_a_tool_bug_is_a_tool_error_with_the_type_name_only(rc, monkeypatch):
    def boom(*_a):
        raise ValueError("C:/secret/path and payload")

    monkeypatch.setattr(T.PLANT_TOOLS["items_query"], "run", boom)
    out = T.run_plant_tool(rc, pkg(rc), "items_query", {})
    assert not out.ok and "ValueError" in out.text and "secret" not in out.text


def test_images_are_capped_per_package_and_per_run(rc):
    from dataclasses import replace

    rc.limits = replace(rc.limits, sub_images=1)
    sc = pkg(rc)
    first, second = ToolOut("a", "s", image=b"jpg"), ToolOut("b", "s", image=b"jpg")
    T.admit_image(rc, sc, first)
    T.admit_image(rc, sc, second)
    assert first.image == b"jpg" and second.image is None and "image budget" in second.text


def test_recorder_prefixes_package_steps_and_keeps_the_newest(rc, handle, monkeypatch):
    monkeypatch.setattr(record, "MAX_STEPS", 3)
    for k in range(5):
        rc.recorder.step("P2" if k % 2 else "orchestrator", "items_query", ToolOut("t", f"step {k}"))
    with handle.session() as s:
        steps = s.get(AssetModelRun, rc.run_id).steps
    assert [st["n"] for st in steps] == [3, 4, 5]
    assert steps[1]["summary"] == "P2 · step 3" and steps[2]["summary"] == "step 4"


# ------------------------------------------------------------------ amendments PR-10 and PR-3
def test_a_planned_type_without_a_builder_is_accepted(rc):
    load_all()
    planned = next((t for t in PLANNED_TYPES if t not in REGISTRY), None)
    if planned is None:
        pytest.skip("every planned type has a builder now")
    sc = pkg(rc)
    out = T.run_plant_tool(
        rc, sc, "upsert_items", {"items": [item("t1", type=planned, params={"anything": 1})]}
    )
    assert out.ok and set(sc.items) == {"t1"} and sc.items["t1"].type == planned


def test_world_is_a_reserved_id_for_items_and_environment(rc):
    sc = pkg(rc)
    out = T.run_plant_tool(rc, sc, "upsert_items", {"items": [item("world"), item("w2")]})
    assert set(sc.items) == {"w2"} and "- world: 'world' is reserved; pick another id" in out.text
    world = {
        "id": "world",
        "kind": "sea",
        "pts": [[0, 0], [9, 0], [9, 9]],
        "el": 100.0,
        "source": {"kind": "assumed"},
    }
    env = T.run_plant_tool(rc, orch(rc, "environment"), "upsert_environment", {"features": [world]})
    assert not env.ok and "'world' is reserved" in env.text and rc.state.environment == []


def test_recorder_usage_writes_f0_run_usage_shape(rc, handle):
    rc.budget.charge({"input_tokens": 1000, "output_tokens": 200}, "trace")
    rc.budget.charge_call("trace")
    rc.recorder.enter("trace", done=1, total=4)
    rc.recorder.usage(rc.budget)
    with handle.session() as s:
        run = s.get(AssetModelRun, rc.run_id)
        usage, phase = run.usage, run.phase
    assert usage["input_tokens"] == 1000 and usage["output_tokens"] == 200
    assert usage["by_stage"]["current"] == "trace" and usage["by_stage"]["stages"]["trace"]["calls"] == 1
    assert usage["by_stage"]["cost_estimate_usd"] is not None and phase == "building"
    assert rc.job.messages[-1] == "Tracing packages (1/4)"


def test_a_build_write_that_saves_nothing_does_not_use_a_fix_round(rc):
    sc = orch(rc, "build")
    sc.rendered = True
    out = T.run_plant_tool(rc, sc, "upsert_items", {"items": [item("x", type="no_such_type")]})
    assert not out.ok and rc.state.fix_rounds == 0 and sc.rendered  # the round is still open
    out = T.run_plant_tool(rc, sc, "remove_items", {"ids": ["nope"]})
    assert rc.state.fix_rounds == 0 and sc.rendered
    assert T.run_plant_tool(rc, sc, "upsert_items", {"items": [item("ok")]}).ok
    assert rc.state.fix_rounds == 1 and not sc.rendered
