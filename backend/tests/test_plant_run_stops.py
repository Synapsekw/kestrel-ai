"""How a plant run ends when it does not finish normally (spec §8.4; rulings R8, R10)."""

from dataclasses import asdict

from plant_fakes import KIPIC, FakePlantLlm, item, reply, seed_plant
from test_plant_run import finish_pkg, run_job

from app.asset_models import service, store
from app.asset_models.agent.plant import orchestrator as O
from app.asset_models.agent.plant import packages as pk
from app.asset_models.agent.plant.budget import PlantLimits
from app.asset_models.agent.plant.state import PlantState, save_state
from app.asset_models.agent.runner import INTERNAL
from app.asset_models.spec import AssetSpec
from app.project_agent.history import LlmError


def two_packages(ids):
    d0 = ids["drawings"][0]
    return {
        "packages": [
            {"label": "A", "drawing_id": d0, "area": "20"},
            {"label": "B", "drawing_id": d0, "area": "30"},
        ]
    }


def survey(ids):
    return [
        reply(("set_site", KIPIC)),
        reply(("plan_packages", two_packages(ids))),
        reply(("next_stage", {"summary": "2"})),
    ]


def test_budget_out_still_builds(handle, app):
    ids = seed_plant(handle, app, limits=PlantLimits(max_tokens=1000, parallel=1))
    d0 = ids["drawings"][0]
    fake = FakePlantLlm(
        survey(ids),  # 3 x 150 = 450 tokens
        {
            "P1": [
                reply(("upsert_items", {"items": [item("t1", tag="T1", did=d0)]}), usage=(600, 0)),
                finish_pkg(),
            ],
            "P2": [finish_pkg()],
        },
    )
    _, result, run, _ = run_job(handle, app, ids, fake)
    assert run.state == "stopped" and run.stop_reason == "budget"
    assert "Not traced: P2 B" in run.summary
    assert (
        len(fake.of("orchestrator")) == 3 and fake.of("P2") == []
    )  # no environment/build calls, P2 never started
    with handle.session() as s:
        assert [r.state for r in pk.rows(s, ids["run"])] == ["done", "skipped"]
        v = store.get_version(s, ids["model"], result["version"])
        assert v.kind == "agent" and [i["id"] for i in v.spec["items"]] == ["t1"]


def test_the_clock_ends_the_run_as_a_timeout(handle, app):
    ids = seed_plant(handle, app, limits=PlantLimits(max_seconds=0))
    fake = FakePlantLlm(survey(ids))
    _, result, run, _ = run_job(handle, app, ids, fake)
    assert run.state == "stopped" and run.stop_reason == "timeout" and "during the survey" in run.summary
    assert result["version"] is None and fake.calls == []


def test_user_stop_writes_a_draft_with_in_flight_items(handle, app):
    ids = seed_plant(handle, app, limits=PlantLimits(parallel=1))
    holder = {}

    def stop_now():
        holder["ctx"].cancelled.set()
        return reply(("upsert_items", {"items": [item("t1", did=ids["drawings"][0])]}))

    fake = FakePlantLlm(survey(ids), {"P1": [stop_now]})
    app.state.jobs.agent_llm = fake
    from plant_fakes import make_ctx

    from app.asset_models.agent import runner as R
    from app.db.models import AssetModelRun

    ctx = make_ctx(handle, app, ids)
    holder["ctx"] = ctx
    try:
        R.run_asset_model(ctx)
        raise AssertionError("the cancel must propagate")
    except Exception as e:
        assert type(e).__name__ == "JobCancelled"
    with handle.session() as s:
        run = s.get(AssetModelRun, ids["run"])
        assert (run.state, run.stop_reason, run.summary) == ("stopped", "user", "Stopped by the operator.")
        v = store.get_version(s, ids["model"], run.version)
        assert v.kind == "draft" and [i["id"] for i in v.spec["items"]] == ["t1"]
        assert [r.state for r in pk.rows(s, ids["run"])] == ["skipped", "skipped"]


def test_a_provider_error_in_the_orchestrator_fails_with_a_draft(handle, app):
    ids = seed_plant(handle, app, limits=PlantLimits(parallel=1))
    d0 = ids["drawings"][0]
    fake = FakePlantLlm(
        [*survey(ids), LlmError("The provider could not complete this step. Try again.")],
        {
            "P1": [reply(("upsert_items", {"items": [item("t1", did=d0)]})), finish_pkg()],
            "P2": [finish_pkg()],
        },
    )
    _, result, run, _ = run_job(handle, app, ids, fake)
    assert (
        run.state == "failed" and run.stop_reason == "provider_error" and "could not complete" in run.summary
    )
    with handle.session() as s:
        assert store.get_version(s, ids["model"], result["version"]).kind == "draft"


def test_a_survey_without_packages_fails_without_a_version(handle, app):
    ids = seed_plant(handle, app)
    _, result, run, model = run_job(handle, app, ids, FakePlantLlm([reply(text="Hmm."), reply(text="Done.")]))
    assert run.state == "failed" and "planned no packages" in run.summary and result["version"] is None
    assert model.live_run_id is None


def test_an_internal_error_fails_with_fixed_text(handle, app, monkeypatch, caplog):
    ids = seed_plant(handle, app, limits=PlantLimits(parallel=1))

    def boom(*_a, **_k):
        raise ValueError("C:/secret/path")

    monkeypatch.setattr(O, "build_check", boom)
    fake = FakePlantLlm(
        [*survey(ids), reply(("next_stage", {"summary": "env"}))],
        {"P1": [finish_pkg()], "P2": [finish_pkg()]},
    )
    _, _, run, _ = run_job(handle, app, ids, fake)
    assert run.state == "failed" and run.summary == INTERNAL and "secret" not in caplog.text


def test_plant_package_reruns_chosen_packages_on_the_current_version(handle, app):
    ids = seed_plant(handle, app, mode="plant_package", limits=PlantLimits(parallel=1))
    d0 = ids["drawings"][0]
    base = AssetSpec.model_validate(
        {
            "site": {
                "crs": {"epsg": 32639},
                "origin_crs": KIPIC["origin_crs"],
                "plant_north_deg": KIPIC["plant_north_deg"],
                "datum": {"label": "HPFS", "el_m": 100.0},
                "source": {"kind": "assumed"},
            },
            "items": [item("t1", tag="T1", did=d0), item("keep", e=500, did=d0)],
            "environment": [
                {
                    "id": "sea",
                    "kind": "sea",
                    "pts": [[0, 0], [10, 0], [10, 10]],
                    "el": 100.0,
                    "source": {"kind": "assumed"},
                }
            ],
        }
    )
    service.add_version(handle, app.state.jobs, ids["model"], base, kind="agent")
    rd = store.run_dir(handle, ids["model"], ids["run"])
    with handle.session() as s:
        (row,) = pk.replace_queued(s, ids["run"], [{"label": "Tank area", "drawing_id": d0, "area": "20"}])
        row_id = row.id
    save_state(
        rd,
        PlantState(
            limits=asdict(PlantLimits(parallel=1)),
            base_version=1,
            package_ids=["old"],
            packages_meta={row_id: {"brief": "Tanks", "expected_tags": ["T1"]}},
        ),
    )
    fake = FakePlantLlm(
        packages={
            "P1": [
                reply(
                    (
                        "upsert_items",
                        {
                            "items": [
                                item("t1-new", tag="T1", e=0.5, did=d0, conf="high"),
                                item("new", e=200, did=d0),
                            ]
                        },
                    )
                ),
                finish_pkg(),
            ]
        }
    )
    _, result, run, _ = run_job(handle, app, ids, fake)
    assert run.state == "finished" and result["version"] == 2 and fake.of("orchestrator") == []
    assert run.summary.startswith("Re-ran 1 package(s) on version 1")
    with handle.session() as s:
        v2 = store.get_version(s, ids["model"], 2)
    assert v2.kind == "agent" and {i["id"] for i in v2.spec["items"]} == {"t1-new", "keep", "new"}
    assert (
        v2.spec["site"]["plant_north_deg"] == KIPIC["plant_north_deg"]
        and v2.spec["environment"][0]["id"] == "sea"
    )


def test_a_resumed_plant_package_run_traces_only_its_queued_packages(handle, app):
    """Controller addition: the startup sweep re-submits plant_package runs too; a `done` package is
    never re-traced (so never re-billed) and its saved items still reach the version."""
    from app.asset_models.agent.plant.state import save_package_items
    from app.asset_models.spec import Item

    ids = seed_plant(handle, app, mode="plant_package", limits=PlantLimits(parallel=1))
    d0 = ids["drawings"][0]
    base = AssetSpec.model_validate(
        {
            "site": {
                "crs": {"epsg": 32639},
                "origin_crs": KIPIC["origin_crs"],
                "plant_north_deg": KIPIC["plant_north_deg"],
                "datum": {"label": "HPFS", "el_m": 100.0},
                "source": {"kind": "assumed"},
            },
            "items": [item("keep", e=500, did=d0)],
        }
    )
    service.add_version(handle, app.state.jobs, ids["model"], base, kind="agent")
    rd = store.run_dir(handle, ids["model"], ids["run"])
    with handle.session() as s:
        rows = pk.replace_queued(
            s,
            ids["run"],
            [{"label": "A", "drawing_id": d0, "area": "20"}, {"label": "B", "drawing_id": d0, "area": "30"}],
        )
        pk.set_state(s, rows[0].id, "done", item_count=1, summary="Traced.")
    save_package_items(rd, 1, [Item.model_validate(item("from-p1", e=100, did=d0))])
    save_state(
        rd,
        PlantState(
            stage="trace",
            site=base.site.model_dump(mode="json"),
            limits=asdict(PlantLimits(parallel=1)),
            base_version=1,
            package_ids=["old1", "old2"],
        ),
    )
    fake = FakePlantLlm(
        packages={"P2": [reply(("upsert_items", {"items": [item("from-p2", e=200, did=d0)]})), finish_pkg()]}
    )
    _, result, run, _ = run_job(handle, app, ids, fake)
    assert run.state == "finished" and result["version"] == 2
    assert fake.of("P1") == [] and len(fake.of("P2")) == 2 and fake.of("orchestrator") == []
    with handle.session() as s:
        assert [r.state for r in pk.rows(s, ids["run"])] == ["done", "done"]
        v2 = store.get_version(s, ids["model"], 2)
    assert {i["id"] for i in v2.spec["items"]} == {"keep", "from-p1", "from-p2"}


def _settled(handle, ids):
    from app.db.models import AssetModel, AssetModelRun

    with handle.session() as s:
        run, model = s.get(AssetModelRun, ids["run"]), s.get(AssetModel, ids["model"])
        return run.state, run.summary, run.phase, run.ended_at is not None, model.live_run_id


def test_a_failing_run_setup_settles_the_run(handle, app, monkeypatch, caplog):
    import pytest
    from plant_fakes import make_ctx

    from app.asset_models.agent import runner as R
    from app.jobs.cancellation import JobFailure

    ids = seed_plant(handle, app)

    def boom(_ctx):
        raise ValueError("C:/secret/path")

    monkeypatch.setattr(O, "build_context", boom)
    ctx = make_ctx(handle, app, ids)
    with pytest.raises(JobFailure) as e:
        R.run_asset_model(ctx)
    assert str(e.value) == INTERNAL
    assert _settled(handle, ids) == ("failed", INTERNAL, "done", True, None)
    assert ctx.published and ctx.published[-1][0] == "asset_models.changed"
    assert "ValueError" in caplog.text and "secret" not in caplog.text


def test_a_failing_mode_lookup_settles_the_run(handle, app, monkeypatch, caplog):
    import pytest
    from plant_fakes import make_ctx

    from app.asset_models.agent import runner as R
    from app.jobs.cancellation import JobFailure

    ids = seed_plant(handle, app)
    ctx = make_ctx(handle, app, ids)
    real = handle.session
    calls = []

    def flaky():
        calls.append(1)
        if len(calls) == 1:  # _mode_of's read
            raise RuntimeError("C:/secret/db")
        return real()

    monkeypatch.setattr(handle, "session", flaky)
    with pytest.raises(JobFailure):
        R.run_asset_model(ctx)
    monkeypatch.setattr(handle, "session", real)
    assert _settled(handle, ids) == ("failed", INTERNAL, "done", True, None)
    assert "RuntimeError" in caplog.text and "secret" not in caplog.text


def test_safe_end_settles_the_row_when_end_raises(handle, app, monkeypatch):
    from plant_fakes import make_ctx, make_rc

    ids = seed_plant(handle, app)
    ctx = make_ctx(handle, app, ids)
    rc = make_rc(handle, app, ids, ctx)

    def boom(*_a, **_k):
        raise RuntimeError("no")

    monkeypatch.setattr(O, "_end", boom)
    assert O._safe_end(rc, "stopped", "user", "Stopped.", kind="draft") == {
        "run_id": ids["run"],
        "version": None,
    }
    assert _settled(handle, ids) == ("failed", INTERNAL, "done", True, None)
    assert ctx.published[-1] == (
        "asset_models.changed",
        {"asset_model_ids": [ids["model"]], "run_id": ids["run"]},
    )


def test_a_main_thread_failure_in_trace_aborts_the_other_sub_runs(handle, app, monkeypatch):
    """_persist raising on the first finished package must stop the in-flight one at once, not let it
    bill on to its limits while the pool shuts down."""
    import time

    ids = seed_plant(handle, app, limits=PlantLimits(parallel=2))
    seen = {}

    def bad_persist(rc, w, res):
        seen["rc"] = rc
        raise RuntimeError("disk full")

    def p2_first():
        end = time.monotonic() + 5
        while time.monotonic() < end:  # still mid-call when the main thread fails
            rc = seen.get("rc")
            if rc is not None and getattr(rc, "abort", None) is not None and rc.abort.is_set():
                break
            time.sleep(0.02)
        return reply(("items_query", {}))

    monkeypatch.setattr(O, "_persist", bad_persist)
    fake = FakePlantLlm(
        survey(ids),
        {"P1": [finish_pkg()], "P2": [p2_first] + [reply(("items_query", {}))] * 5},
    )
    _, _, run, model = run_job(handle, app, ids, fake)
    assert run.state == "failed" and run.summary == INTERNAL and model.live_run_id is None
    assert len(fake.of("P2")) == 1  # no model call after the abort
