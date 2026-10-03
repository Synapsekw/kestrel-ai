# backend/tests/test_plant_resume.py
"""A plant run cut off by an application restart resumes after its last finished package (spec §8.4;
index Review Focus #3)."""

import threading
from dataclasses import asdict

import pytest
from plant_fakes import KIPIC, FakePlantLlm, item, reply, seed_plant

from app.asset_models import startup, store
from app.asset_models.agent.plant import packages as pk
from app.asset_models.agent.plant import resume
from app.asset_models.agent.plant.budget import PlantLimits
from app.asset_models.agent.plant.state import PlantState, load_state, save_package_items, save_state
from app.asset_models.spec import Item, SiteFrame
from app.db.models import AssetModel, AssetModelRun, SiteModelPackage

FRAME = SiteFrame.model_validate(
    {
        "crs": {"epsg": 32639},
        "origin_crs": KIPIC["origin_crs"],
        "plant_north_deg": KIPIC["plant_north_deg"],
        "source": {"kind": "assumed"},
    }
)


@pytest.fixture
def cut_off(handle, app):
    """A run that finished P1, was cut off while P2 ran, and never started P3."""
    ids = seed_plant(handle, app, limits=PlantLimits(parallel=1))
    d0 = ids["drawings"][0]
    rd = store.run_dir(handle, ids["model"], ids["run"])
    with handle.session() as s:
        rows = pk.replace_queued(s, ids["run"], [{"label": n, "drawing_id": d0} for n in ("A", "B", "C")])
        pk.set_state(
            s, rows[0].id, "done", usage={"input_tokens": 10, "output_tokens": 5}, item_count=1, summary="ok"
        )
        pk.set_state(s, rows[1].id, "running")
        pids = [r.id for r in rows]
    save_package_items(rd, 1, [Item.model_validate(item("t1", tag="T1", did=d0))])
    save_state(
        rd,
        PlantState(
            stage="trace",
            site=FRAME.model_dump(mode="json"),
            limits=asdict(PlantLimits(parallel=1)),
            packages_meta={p: {"brief": "b", "expected_tags": []} for p in pids},
        ),
    )
    return ids, pids, rd


@pytest.fixture
def held(monkeypatch):
    """Holds the resumed job before it reads the run, so the rows the sweep wrote can be asserted
    before the job moves them on. Set it to let the job go."""
    from app.asset_models.agent.plant import orchestrator

    gate, real = threading.Event(), orchestrator.build_context

    def build_context(ctx):
        assert gate.wait(60)
        return real(ctx)

    monkeypatch.setattr(orchestrator, "build_context", build_context)
    return gate


def after_trace_script():
    return [
        reply(("next_stage", {"summary": "No environment."})),
        reply(("finish", {"summary": "Resumed and built."})),
    ]


def wait_run(client, project_id, wait_job, handle, run_id):
    with handle.session() as s:
        job_id = s.get(AssetModelRun, run_id).job_id
    assert job_id != "job-run"
    assert wait_job(project_id, job_id)["state"] == "succeeded"
    with handle.session() as s:
        run = s.get(AssetModelRun, run_id)
        s.expunge(run)
        return run


def test_resume_skips_done_packages(client, project_id, wait_job, handle, app, cut_off, held):
    ids, pids, _ = cut_off
    d0 = ids["drawings"][0]
    fake = FakePlantLlm(
        after_trace_script(),
        {
            "P2": [
                reply(("upsert_items", {"items": [item("b1", e=100, did=d0)]})),
                reply(("finish_package", {"summary": "B"})),
            ],
            "P3": [
                reply(("upsert_items", {"items": [item("c1", e=200, did=d0)]})),
                reply(("finish_package", {"summary": "C"})),
            ],
        },
    )
    app.state.jobs.agent_llm = fake
    assert resume.sweep_plant_runs(handle, app.state.jobs) == [ids["run"]]
    with handle.session() as s:
        assert [r.state for r in pk.rows(s, ids["run"])] == ["done", "queued", "queued"]
    held.set()
    run = wait_run(client, project_id, wait_job, handle, ids["run"])
    assert run.state == "finished" and run.summary == "Resumed and built."
    assert fake.of("P1") == []  # the done package is never re-billed
    assert "This run was interrupted" in fake.of("orchestrator")[0]["user_texts"][0]
    with handle.session() as s:
        v = store.get_version(s, ids["model"], run.version)
        assert sorted(i["id"] for i in v.spec["items"]) == ["b1", "c1", "t1"]  # t1 once, no duplicates
        assert [r.state for r in pk.rows(s, ids["run"])] == ["done", "done", "done"]
        assert s.get(AssetModel, ids["model"]).live_run_id is None


def test_double_interrupt_fails_package(client, project_id, wait_job, handle, app, cut_off):
    ids, pids, rd = cut_off
    st = load_state(rd)
    st.interrupts = {pids[1]: 1}  # P2 was already cut off once before
    save_state(rd, st)
    fake = FakePlantLlm(after_trace_script(), {"P3": [reply(("finish_package", {"summary": "C"}))]})
    app.state.jobs.agent_llm = fake
    assert resume.sweep_plant_runs(handle, app.state.jobs) == [ids["run"]]
    with handle.session() as s:
        b = pk.rows(s, ids["run"])[1]
        assert b.state == "failed" and b.summary == resume.INTERRUPTED_TWICE
    run = wait_run(client, project_id, wait_job, handle, ids["run"])
    assert run.state == "finished" and fake.of("P2") == []
    assert load_state(rd).interrupts[pids[1]] == 2


def test_a_second_attempt_cut_off_counts_as_interrupted_twice(handle, app, cut_off, monkeypatch):
    """The row's `attempts` and the state file's interrupt count never disagree: a package on its second
    run when the app closed is failed even if the state file lost its count."""
    ids, pids, rd = cut_off
    with handle.session() as s:
        s.get(SiteModelPackage, pids[1]).attempts = 2
    monkeypatch.setattr(app.state.jobs, "submit", lambda *a, **k: type("J", (), {"id": "job-2"})())
    assert resume.sweep_plant_runs(handle, app.state.jobs) == [ids["run"]]
    with handle.session() as s:
        b = s.get(SiteModelPackage, pids[1])
        assert b.state == "failed" and b.summary == resume.INTERRUPTED_TWICE
        assert s.get(AssetModelRun, ids["run"]).job_id == "job-2"
    assert load_state(rd).interrupts[pids[1]] == 2


def test_a_package_saved_before_its_row_counts_as_done(
    client, project_id, wait_job, handle, app, cut_off, held
):
    ids, pids, rd = cut_off
    save_package_items(rd, 2, [Item.model_validate(item("b1", e=100))])
    fake = FakePlantLlm(after_trace_script(), {"P3": [reply(("finish_package", {"summary": "C"}))]})
    app.state.jobs.agent_llm = fake
    resume.sweep_plant_runs(handle, app.state.jobs)
    with handle.session() as s:
        assert [r.state for r in pk.rows(s, ids["run"])] == ["done", "done", "queued"]
        assert s.get(SiteModelPackage, pids[1]).item_count == 1
    held.set()
    wait_run(client, project_id, wait_job, handle, ids["run"])
    assert fake.of("P2") == []


def test_too_many_interrupts_fail_the_run_with_a_draft(handle, app, cut_off):
    ids, _, rd = cut_off
    st = load_state(rd)
    st.run_interrupts = resume.MAX_RUN_INTERRUPTS
    save_state(rd, st)
    assert resume.sweep_plant_runs(handle, app.state.jobs) == []
    with handle.session() as s:
        run = s.get(AssetModelRun, ids["run"])
        assert run.state == "failed" and run.stop_reason == "interrupted" and run.job_id == "job-run"
        v = store.get_version(s, ids["model"], run.version)
        assert v.kind == "draft" and [i["id"] for i in v.spec["items"]] == ["t1"]
        assert s.get(AssetModel, ids["model"]).live_run_id is None


def test_a_corrupt_state_file_fails_the_run_without_stopping_the_app(handle, app, cut_off):
    ids, _, rd = cut_off
    (rd / "plant" / "state.json").write_text("{not json", "utf-8")
    assert resume.sweep_plant_runs(handle, app.state.jobs) == []
    with handle.session() as s:
        assert s.get(AssetModelRun, ids["run"]).state == "failed"


def test_the_startup_sweep_resumes_plant_runs_and_fails_m1_runs(
    client, project_id, wait_job, handle, app, cut_off
):
    ids, _, _ = cut_off
    app.state.jobs.agent_llm = FakePlantLlm(
        after_trace_script(),
        {
            "P2": [reply(("finish_package", {"summary": "B"}))],
            "P3": [reply(("finish_package", {"summary": "C"}))],
        },
    )
    startup.sweep_interrupted(handle, app.state.jobs)
    run = wait_run(client, project_id, wait_job, handle, ids["run"])
    assert run.state == "finished" and run.stop_reason is None
