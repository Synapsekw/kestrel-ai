# backend/tests/test_plant_run.py
"""The plant run end to end with a scripted fake model (spec §13 R1):
survey -> 3 packages (2 in parallel) -> merge -> cloud check (none) -> environment -> build ->
self-check -> finish. Also: append-only cached conversations, per-stage usage, and no prompt,
payload, model text or key in the logs."""

import logging
import threading

from plant_fakes import KEY, KIPIC, FakePlantLlm, item, make_ctx, make_rc, reply, seed_plant

from app.asset_models import store
from app.asset_models.agent import runner as R
from app.asset_models.agent.plant import packages as pk
from app.asset_models.agent.plant.budget import PlantLimits
from app.asset_models.spec import Item
from app.db.models import AssetModel, AssetModelRun
from app.jobs.cancellation import JobCancelled

SECRET = "SECRET-PAYLOAD-NAME"


def finish_pkg(summary="Traced."):
    return reply(("finish_package", {"summary": summary}))


def run_job(handle, app, ids, fake):
    app.state.jobs.agent_llm = fake
    ctx = make_ctx(handle, app, ids)
    try:
        result = R.run_asset_model(ctx)
    except JobCancelled:
        result = None
    with handle.session() as s:
        run = s.get(AssetModelRun, ids["run"])
        model = s.get(AssetModel, ids["model"])
        s.expunge_all()
    return ctx, result, run, model


def plan3(ids):
    d0, d1 = ids["drawings"]
    return {
        "packages": [
            {
                "label": "Tank area",
                "drawing_id": d0,
                "region": [0, 0, 0.5, 1],
                "area": "20",
                "brief": "Two tanks",
                "expected_tags": ["20-T-0001", "20-T-0002"],
            },
            {"label": "Jetty", "drawing_id": d1, "region": [0, 0, 1, 1], "area": "10", "brief": "Jetty head"},
            {
                "label": "Utilities",
                "drawing_id": d0,
                "region": [0.5, 0, 1, 1],
                "area": "30",
                "brief": "Pumps",
            },
        ]
    }


def test_full_pipeline_with_parallel_packages(handle, app, caplog):
    caplog.set_level(logging.DEBUG)
    ids = seed_plant(handle, app, limits=PlantLimits(parallel=2))
    d0, d1 = ids["drawings"]
    both = threading.Barrier(2, timeout=10)  # passes only if P1 and P2 call the model at the same time

    def together(r):
        return lambda: (both.wait(), r)[1]

    orchestrator = [
        reply(("list_sources", {}), ("set_site", {**KIPIC, "source_drawing_id": d0})),
        reply(("plan_packages", plan3(ids))),
        reply(("next_stage", {"summary": "Three packages."})),
        reply(
            (
                "upsert_environment",
                {
                    "features": [
                        {
                            "id": "sea",
                            "kind": "sea",
                            "pts": [[-100, -100], [300, -100], [300, -60]],
                            "el": 100.0,
                            "source": {"kind": "drawing", "id": d0},
                        }
                    ]
                },
            )
        ),
        reply(("next_stage", {"summary": "Sea traced."})),
        reply(("render_site", {"views": ["plan", "iso"], "overlay": "none"})),
        reply(
            (
                "upsert_items",
                {"items": [item("pump-30-1", e=150, n=40, did=d0, area="30", name=f"Pump skid {SECRET}")]},
            )
        ),
        reply(
            ("finish", {"summary": "Built 4 items.", "open_questions": ["Is the jetty head EL right?"]}),
            text="SECRET-MODEL-TEXT",
        ),
    ]
    packages = {
        "P1": [
            together(
                reply(
                    (
                        "upsert_items",
                        {
                            "items": [
                                item("20-t-0001", tag="20-T-0001", did=d0, area="20"),
                                item("20-t-0002", tag="20-T-0002", e=60, did=d0, area="20"),
                            ]
                        },
                    )
                )
            ),
            finish_pkg("Two tanks traced."),
        ],
        "P2": [
            together(
                reply(
                    (
                        "upsert_items",
                        {
                            "items": [
                                item("10-j-1", tag="10-J-0001", n=200, did=d1, area="10"),
                                item("20-t-0002-dup", tag="20-T-0002", e=63, did=d1, area="20"),
                            ]
                        },
                    )
                )
            ),
            finish_pkg("Jetty traced."),
        ],
        "P3": [
            reply(("upsert_items", {"items": [item("pump-30-1", e=150, n=40, did=d0, area="30")]})),
            finish_pkg("One pump."),
        ],
    }
    fake = FakePlantLlm(orchestrator, packages)
    ctx, result, run, model = run_job(handle, app, ids, fake)

    assert run.state == "finished" and run.stop_reason is None and run.summary == "Built 4 items."
    assert "Is the jetty head EL right?" in run.open_questions
    assert any("No cloud check" in q for q in run.open_questions)
    assert result == {"run_id": ids["run"], "version": 1}
    with handle.session() as s:
        v = store.get_version(s, ids["model"], 1)
        assert v.kind == "agent" and v.glb_job_id
        spec = v.spec
        rows = [(r.label, r.state, r.item_count) for r in pk.rows(s, ids["run"])]
    assert rows == [("Tank area", "done", 2), ("Jetty", "done", 2), ("Utilities", "done", 1)]
    got = {i["id"]: i for i in spec["items"]}
    assert set(got) == {"20-t-0001", "20-t-0002-dup", "10-j-1", "pump-30-1"}  # 20-T-0002 merged once
    assert got["20-t-0002-dup"]["flags"][0]["code"] == "straddles_package"
    assert got["pump-30-1"]["name"] == "Pump skid SECRET-PAYLOAD-NAME"  # the build-stage fix round
    assert spec["site"]["plant_north_deg"] == 17.9991 and spec["environment"][0]["id"] == "sea"

    assert [len(fake.of(p)) for p in ("P1", "P2", "P3")] == [2, 2, 2]
    for conv in ("orchestrator", "P1", "P2", "P3"):
        lens = [c["history_len"] for c in fake.of(conv)]
        assert lens == sorted(lens) and all(c["cache"] for c in fake.of(conv))
    assert "plan_packages" in fake.of("orchestrator")[0]["tools"]
    assert "plan_packages" not in fake.of("P1")[0]["tools"]

    usage = run.usage["by_stage"]  # F0's shape (amendment PR-3): {current, stages, cost estimate}
    assert {"survey", "trace", "environment", "build"} <= set(usage["stages"]) and usage["current"] == "done"
    assert usage["stages"]["trace"]["calls"] == 6
    assert any(st["summary"].startswith("P1 · ") for st in run.steps)
    assert model.live_run_id is None and model.current_version == 1 and model.status == "ready"

    for secret in (KEY, "SECRET-PAYLOAD-NAME", "SECRET-MODEL-TEXT", "Two tanks"):
        assert secret not in caplog.text
    assert "plant tool P1 upsert_items ok=True" in caplog.text


def test_m1_runs_are_not_dispatched(handle, app):
    ids = seed_plant(handle, app, mode="build")
    fake = FakePlantLlm()
    _, _, run, _ = run_job(handle, app, ids, fake)
    assert fake.of("orchestrator") == []  # the M1 loop ran (its own SYSTEM prompt)
    assert run.state == "finished" and run.mode == "build"


def test_cancel_before_start_skips_plant_packages(handle, app):
    from app.jobs.registry import cancelled_before_start_hook

    ids = seed_plant(handle, app)
    with handle.session() as s:
        pk.replace_queued(s, ids["run"], [{"label": "A"}, {"label": "B"}])
    cancelled_before_start_hook(R.RUN_JOB)(make_ctx(handle, app, ids))
    with handle.session() as s:
        assert [r.state for r in pk.rows(s, ids["run"])] == ["skipped", "skipped"]
        assert s.get(AssetModelRun, ids["run"]).state == "stopped"


def test_large_spec_drops_the_blocking_item_before_writing(handle, app, caplog):
    """Amendment I-6: add_version validates only <= 200 items, so the run validates a large spec
    itself and drops the items its blocking errors name."""
    caplog.set_level(logging.DEBUG)
    ids = seed_plant(handle, app)
    rc = make_rc(handle, app, ids)
    items = [Item.model_validate(item(f"box-{k}", e=20.0 * k, n=0.0)) for k in range(210)]
    bad = Item.model_validate({**item("bad-heights", e=-500.0, name="SECRET-PAYLOAD-NAME"), "top_el": 90.0})
    from app.asset_models.agent.plant import orchestrator as O

    version = O._write_version(rc, [*items, bad], [], "agent", "Large.")
    assert version == 1
    with handle.session() as s:
        spec = store.get_version(s, ids["model"], 1).spec
    got = {i["id"] for i in spec["items"]}
    assert "bad-heights" not in got and len(got) == 210
    assert "SECRET-PAYLOAD-NAME" not in caplog.text and "bad-heights" not in caplog.text


def test_cancel_during_the_budget_out_finish_still_ends_the_run(handle, app, monkeypatch):
    """Review fix 1: the app-only finish after a budget-out is itself protected. A Stop pressed while
    it build-checks ends the run `stopped` (operator stop: a draft) and clears the live run."""
    from app.asset_models.agent.plant.state import load_state, save_merged, save_state
    from app.asset_models.builders import base

    ids = seed_plant(handle, app, limits=PlantLimits(max_tokens=100_000))
    run_dir = store.run_dir(handle, ids["model"], ids["run"])
    st = load_state(run_dir)
    st.stage = "cloud_check"  # resumed after merge, with the budget already spent
    save_state(run_dir, st)
    save_merged(run_dir, [Item.model_validate(item(f"box-{k}", e=20.0 * k)) for k in range(3)])
    with handle.session() as s:
        s.get(AssetModelRun, ids["run"]).usage = {
            "by_stage": {"trace": {"input_tokens": 100_000, "output_tokens": 0, "calls": 1, "images": 0}}
        }
    app.state.jobs.agent_llm = FakePlantLlm()
    ctx = make_ctx(handle, app, ids)
    built = []

    def cancel_while_building(it, bctx):
        built.append(it.id)
        ctx.cancelled.set()
        return [], []

    monkeypatch.setattr(base, "build_item", cancel_while_building)
    try:
        R.run_asset_model(ctx)
        raised = False
    except JobCancelled:
        raised = True
    assert raised and built == ["box-0"]
    with handle.session() as s:
        run = s.get(AssetModelRun, ids["run"])
        model = s.get(AssetModel, ids["model"])
        assert (run.state, run.stop_reason, run.phase) == ("stopped", "user", "done")
        assert model.live_run_id is None
        assert store.get_version(s, ids["model"], run.version).kind == "draft"
