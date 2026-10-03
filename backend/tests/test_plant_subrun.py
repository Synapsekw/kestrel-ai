# backend/tests/test_plant_subrun.py
"""A package sub-run (spec §8.2.2): its own append-only, cached conversation; per-package limits;
wrap-up when the run's budget is spent; rate-limit backoff; a failure stays in the package."""

import time

import pytest
from plant_fakes import KEY, FakePlantLlm, item, make_rc, reply, seed_plant

from app.asset_models.agent.plant import model as M
from app.asset_models.agent.plant import prompt_plant as P
from app.asset_models.agent.plant.budget import PlantLimits
from app.asset_models.agent.plant.packages import PackageWork
from app.asset_models.agent.plant.subrun import WRAP_UP_CALLS, run_package
from app.db.models import AssetModelRun
from app.jobs.cancellation import JobCancelled
from app.project_agent.history import LlmError
from app.project_agent.llm import _RATE_LIMITED


def setup(handle, app, script, **limits):
    ids = seed_plant(handle, app, limits=PlantLimits(**limits) if limits else None)
    fake = FakePlantLlm(packages={"P1": script})
    app.state.jobs.agent_llm = fake
    rc = make_rc(handle, app, ids)
    w = PackageWork(
        id="pk1",
        n=1,
        label="Tanks",
        drawing_id=ids["drawings"][0],
        region=(0, 0, 0.5, 1),
        area="20",
        brief="Tanks",
        expected_tags=("20-T-0001",),
    )
    return rc, w, fake


def test_a_package_traces_and_finishes(handle, app):
    rc, w, fake = setup(
        handle,
        app,
        [
            reply(("upsert_items", {"items": [item("t1", tag="20-T-0001")]})),
            reply(("finish_package", {"summary": "Traced 1.", "open_questions": ["Tank 2?"]})),
        ],
    )
    res = run_package(rc, w)
    assert (res.state, res.summary, res.questions, res.calls) == ("done", "Traced 1.", ["Tank 2?"], 2)
    assert [i.id for i in res.items] == ["t1"] and res.usage == {"input_tokens": 200, "output_tokens": 100}
    calls = fake.of("P1")
    assert all(c["cache"] for c in calls) and calls[0]["effort"] == "high" and calls[0]["api_key"] == KEY
    assert calls[1]["history_len"] - calls[0]["history_len"] == 2  # append-only: + assistant, + tool_results
    assert "plan_packages" not in calls[0]["tools"] and "finish_package" in calls[0]["tools"]
    assert rc.budget.snapshot("trace")["by_stage"]["trace"]["calls"] == 2
    assert "pk1" in rc.inflight
    with handle.session() as s:
        steps = s.get(AssetModelRun, rc.run_id).steps
    assert [st["summary"].split(" · ")[0] for st in steps] == ["P1", "P1"]


def test_the_package_call_limit(handle, app):
    rc, w, fake = setup(
        handle,
        app,
        [reply(("items_query", {}), ("items_query", {})), reply(("items_query", {}))],
        sub_calls=1,
    )
    res = run_package(rc, w)
    assert res.state == "done" and res.calls == 1 and "package limit of 1 tool calls" in res.summary
    assert len(fake.of("P1")) == 1


def test_wrap_up_when_the_run_budget_is_spent(handle, app):
    script = [reply(("upsert_items", {"items": [item("t1")]}), usage=(90, 20))] + [
        reply(("items_query", {}))
    ] * 5
    rc, w, fake = setup(handle, app, script, max_tokens=100)
    res = run_package(rc, w)
    calls = fake.of("P1")
    assert len(calls) == 1 + WRAP_UP_CALLS and P.WRAP_UP in calls[1]["user_texts"]
    assert res.state == "done" and "budget ran out" in res.summary and [i.id for i in res.items] == ["t1"]


def test_rate_limit_retries_then_fails_package_only(handle, app, monkeypatch):
    monkeypatch.setattr(M, "RATE_RETRIES_S", (0.0, 0.0))
    rc, w, fake = setup(handle, app, [LlmError(_RATE_LIMITED), reply(("finish_package", {"summary": "ok"}))])
    assert run_package(rc, w).state == "done" and len(fake.of("P1")) == 2
    rc2, w2, fake2 = setup(handle, app, [LlmError(_RATE_LIMITED)] * 3)
    res = run_package(rc2, w2)  # no exception: the package fails, the run goes on
    assert res.state == "failed" and res.summary == _RATE_LIMITED and len(fake2.of("P1")) == 3


def test_rate_limit_backs_off_20_40_80_and_reads_the_key_on_each_attempt(handle, app, monkeypatch):
    """Review Focus #3: the default waits are 20/40/80 s, and each retry reads the key from the
    KeyStore again (a key changed during the wait is the one the retry sends)."""
    waits = []
    monkeypatch.setattr(M, "_sleep", lambda rc, seconds: waits.append(seconds))
    keys = ["KEY-A", "KEY-B", "KEY-C", "KEY-D"]

    def limited_then_rotate():
        app.state.keys.set("anthropic", keys.pop(0))
        return LlmError(_RATE_LIMITED)

    rc, w, fake = setup(handle, app, [limited_then_rotate] * 4)
    res = run_package(rc, w)
    assert waits == [20.0, 40.0, 80.0]
    assert res.state == "failed" and res.summary == _RATE_LIMITED
    assert [c["api_key"] for c in fake.of("P1")] == [KEY, "KEY-A", "KEY-B", "KEY-C"]
    assert all(KEY not in st["summary"] for st in _steps(handle, rc))


def test_rate_limit_wait_stops_on_cancel(handle, app):
    """The backoff wait is cancel-aware: a stop during a 20 s wait ends the package at once."""
    holder = {}

    def stop_and_limit():
        holder["rc"].job.cancelled.set()
        return LlmError(_RATE_LIMITED)

    rc, w, fake = setup(handle, app, [stop_and_limit, reply(text="never")])
    holder["rc"] = rc
    t0 = time.monotonic()
    with pytest.raises(JobCancelled):
        run_package(rc, w)
    assert time.monotonic() - t0 < 5 and len(fake.of("P1")) == 1


def test_other_provider_errors_fail_at_once(handle, app):
    rc, w, fake = setup(handle, app, [LlmError("The provider could not complete this step. Try again.")])
    assert run_package(rc, w).state == "failed" and len(fake.of("P1")) == 1


def test_a_missing_key_fails_the_package(handle, app):
    rc, w, fake = setup(handle, app, [])
    app.state.keys.delete("anthropic")
    res = run_package(rc, w)
    assert res.state == "failed" and "API key" in res.summary and fake.calls == []


def test_two_quiet_replies_end_the_package(handle, app):
    rc, w, _ = setup(handle, app, [reply(text="Looking."), reply(text="Done.")])
    res = run_package(rc, w)
    assert res.state == "done" and res.summary == "Ended without finish_package."


def test_calls_after_finish_package_are_not_run(handle, app):
    rc, w, _ = setup(
        handle,
        app,
        [reply(("finish_package", {"summary": "s"}), ("upsert_items", {"items": [item("late")]}))],
    )
    res = run_package(rc, w)
    assert res.items == [] and res.calls == 1


def test_stop_propagates_and_keeps_the_items_reachable(handle, app):
    holder = {}

    def stop_now():
        holder["rc"].job.cancelled.set()
        return reply(("upsert_items", {"items": [item("t1")]}))

    rc, w, _ = setup(handle, app, [stop_now])
    holder["rc"] = rc
    with pytest.raises(JobCancelled):
        run_package(rc, w)
    assert list(rc.inflight["pk1"].items) == ["t1"]


def _steps(handle, rc):
    with handle.session() as s:
        return s.get(AssetModelRun, rc.run_id).steps or []
