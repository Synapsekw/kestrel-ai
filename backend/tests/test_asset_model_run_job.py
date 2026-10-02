# backend/tests/test_asset_model_run_job.py
"""The asset_model_run job with a scripted fake model (spec §7.2; Review Focus 3, 4)."""

import pytest

from app.asset_models import startup, store
from app.asset_models.agent import runner as R
from app.db.models import AssetModel, AssetModelRun
from app.jobs.cancellation import JobCancelled
from app.project_agent.history import ModelReply, ToolCall

SHELL = {
    "id": "shell",
    "name": "Shell",
    "group": "Shell",
    "shape": "cylinder",
    "params": {"id": 4000, "thickness": 8, "height": 8000},
    "source": {"kind": "assumed"},
}


def reply(*calls, text="", usage=(100, 50)):
    return ModelReply(
        text=text,
        tool_calls=[ToolCall(f"c{i}", n, a) for i, (n, a) in enumerate(calls)],
        provider_payload=None,
        usage={"input_tokens": usage[0], "output_tokens": usage[1]},
    )


class FakeLlm:
    def __init__(self, script):
        self.script, self.calls = list(script), []

    async def __call__(self, provider, *, api_key, model, system, history, tools, effort=None, cache=False):
        self.calls.append({"history_len": len(history), "api_key": api_key, "effort": effort, "cache": cache})
        step = self.script.pop(0)
        if isinstance(step, BaseException):
            raise step
        return step


class Ctx:
    def __init__(self, handle, runner, params, cancel_at=None):
        self.project, self.runner, self.params, self.job_id = handle, runner, params, "job-run"
        self.published, self.n, self.cancel_at = [], 0, cancel_at

    def progress(self, *_a):
        pass

    def publish(self, t, p):
        self.published.append((t, p))

    def check_cancelled(self):
        self.n += 1
        if self.cancel_at and self.n >= self.cancel_at:
            raise JobCancelled()


@pytest.fixture
def seeded(handle, app):
    app.state.keys.set("anthropic", "SECRET-KEY-123")
    with handle.session() as s:
        m = AssetModel(name="m", status="building")
        s.add(m)
        s.flush()
        run = AssetModelRun(
            model_id=m.id,
            job_id="job-run",
            provider="anthropic",
            model_name="claude-opus-5-5",
            mode="build",
            sources=[],
        )
        s.add(run)
        s.flush()
        m.live_run_id = run.id
        return m.id, run.id


def go(handle, app, ids, script, **kw):
    fake = FakeLlm(script)
    app.state.jobs.agent_llm = fake
    ctx = Ctx(handle, app.state.jobs, {"model_id": ids[0], "run_id": ids[1]}, **kw)
    try:
        result = R.run_asset_model(ctx)
    except JobCancelled:
        result = None
    with handle.session() as s:
        run = s.get(AssetModelRun, ids[1])
        model = s.get(AssetModel, ids[0])
        s.expunge_all()
    return fake, result, run, model


def test_finish_writes_an_agent_version(handle, app, seeded, wait_job, project_id):
    fake, result, run, model = go(
        handle,
        app,
        seeded,
        [
            reply(("upsert_parts", {"parts": [SHELL]})),
            reply(("finish", {"summary": "Shell only.", "open_questions": ["Roof type?"]})),
        ],
    )
    assert run.state == "finished" and run.summary == "Shell only." and run.open_questions == ["Roof type?"]
    assert run.version == 1 and result == {"run_id": seeded[1], "version": 1}
    assert [s["tool"] for s in run.steps] == ["upsert_parts", "finish"]
    assert run.usage == {"input_tokens": 200, "output_tokens": 100}
    assert model.live_run_id is None and model.current_version == 1 and model.status == "ready"
    with handle.session() as s:
        assert store.get_version(s, seeded[0], 1).kind == "agent"
    assert fake.calls[0]["effort"] == "high" and fake.calls[0]["cache"] is True


def test_invalid_upsert_is_a_tool_error_and_loop_continues(handle, app, seeded):
    _, _, run, _ = go(
        handle,
        app,
        seeded,
        [
            reply(("upsert_parts", {"parts": [{"id": "x", "shape": "torus"}]})),
            reply(("upsert_parts", {"parts": [SHELL]})),
            reply(("finish", {"summary": "ok"})),
        ],
    )
    assert [s["ok"] for s in run.steps] == [False, True, True]
    assert run.state == "finished"


def test_call_budget_stops_with_a_draft(handle, app, seeded, monkeypatch):
    monkeypatch.setattr(R, "MAX_CALLS", 2)
    _, _, run, _ = go(
        handle,
        app,
        seeded,
        [
            reply(("upsert_parts", {"parts": [SHELL]}), ("validate", {}), ("validate", {})),
        ],
    )
    assert run.state == "stopped" and run.stop_reason == "budget"
    assert [s["tool"] for s in run.steps] == ["upsert_parts", "validate"]
    with handle.session() as s:
        assert store.get_version(s, seeded[0], 1).kind == "draft"


def test_token_budget_stops(handle, app, seeded, monkeypatch):
    monkeypatch.setattr(R, "MAX_TOKENS", 100)
    _, _, run, _ = go(handle, app, seeded, [reply(("validate", {}), usage=(90, 20)), reply(("validate", {}))])
    assert run.stop_reason == "budget"


def test_user_stop_writes_a_draft(handle, app, seeded):
    _, _, run, _ = go(
        handle,
        app,
        seeded,
        [
            reply(("upsert_parts", {"parts": [SHELL]})),
            reply(("validate", {})),
        ],
        cancel_at=3,
    )
    assert run.state == "stopped" and run.stop_reason == "user" and run.version == 1


def test_stop_before_any_part_writes_no_version(handle, app, seeded):
    _, _, run, model = go(handle, app, seeded, [reply(("validate", {}))], cancel_at=2)
    assert run.version is None and model.current_version is None and model.status == "empty"


def test_missing_key_fails_with_fixed_text(handle, app, seeded):
    app.state.keys.delete("anthropic")
    _, _, run, _ = go(handle, app, seeded, [])
    assert run.state == "failed" and run.stop_reason == "provider_error"
    assert "API key" in run.summary


def test_provider_error_fails_and_never_logs_the_key(handle, app, seeded, caplog):
    from app.project_agent.history import LlmError

    caplog.set_level("DEBUG")
    ctx_holder = {}
    orig = Ctx.publish

    def spy(self, t, p):
        ctx_holder.setdefault("pub", []).append((t, p))
        orig(self, t, p)

    Ctx.publish = spy
    try:
        _, _, run, _ = go(handle, app, seeded, [LlmError("The provider is rate limiting requests.")])
    finally:
        Ctx.publish = orig
    assert run.state == "failed" and "rate limiting" in run.summary
    assert "SECRET-KEY-123" not in caplog.text
    assert "SECRET-KEY-123" not in f"{run.summary} {run.steps} {run.usage} {run.open_questions}"
    assert "SECRET-KEY-123" not in str(ctx_holder.get("pub", []))


def test_no_tool_calls_twice_ends_as_finished_with_text(handle, app, seeded):
    _, _, run, _ = go(
        handle,
        app,
        seeded,
        [
            reply(("upsert_parts", {"parts": [SHELL]})),
            reply(text="I think I'm done."),
            reply(text="Done."),
        ],
    )
    assert run.state == "finished" and run.summary == "Done."


def test_history_is_append_only(handle, app, seeded):
    fake, _, _, _ = go(
        handle,
        app,
        seeded,
        [
            reply(("validate", {})),
            reply(("validate", {})),
            reply(("finish", {"summary": "s"})),
        ],
    )
    lens = [c["history_len"] for c in fake.calls]
    assert lens == sorted(lens) and lens[1] - lens[0] == 2  # +assistant, +tool_results


def test_sweep_marks_interrupted_run_and_unsticks_model(handle, app, seeded):
    mid, rid = seeded
    rd = store.run_dir(handle, mid, rid)
    rd.mkdir(parents=True)
    from app.asset_models.spec import AssetSpec

    (rd / "working.json").write_text(AssetSpec.model_validate({"parts": [SHELL]}).model_dump_json())
    startup.sweep_interrupted(handle, app.state.jobs)
    with handle.session() as s:
        run = s.get(AssetModelRun, rid)
        model = s.get(AssetModel, mid)
        assert run.state == "failed" and run.stop_reason == "interrupted"
        assert run.summary == "interrupted by application restart"
        assert model.live_run_id is None and model.current_version == 1
        assert store.get_version(s, mid, 1).kind == "draft"


def test_sweep_survives_a_corrupt_working_file(handle, app, seeded):
    mid, rid = seeded
    rd = store.run_dir(handle, mid, rid)
    rd.mkdir(parents=True)
    (rd / "working.json").write_text("{not json")
    startup.sweep_interrupted(handle, app.state.jobs)
    with handle.session() as s:
        run = s.get(AssetModelRun, rid)
        model = s.get(AssetModel, mid)
        assert run.state == "failed" and run.ended_at is not None and run.version is None
        assert model.live_run_id is None and model.status == "empty"


def test_unwired_model_seam_fails_the_run_with_fixed_text(handle, app, seeded):
    app.state.jobs.agent_llm = None
    ctx = Ctx(handle, app.state.jobs, {"model_id": seeded[0], "run_id": seeded[1]})
    R.run_asset_model(ctx)
    with handle.session() as s:
        run = s.get(AssetModelRun, seeded[1])
        assert run.state == "failed" and run.stop_reason == "provider_error"


def test_sources_get_labels_and_facts(handle, app, seeded):
    from app.db.models import Drawing, PointCloud

    with handle.session() as s:
        d = Drawing(name="GA.dxf", format="dxf", source_path="C:/x/GA.dxf", source_size=1)
        c = PointCloud(name="Scan", source_path="C:/x/s.las", source_size=1, point_count=1234)
        s.add_all([d, c])
        s.flush()
        ids = (d.id, c.id)
    ctx = Ctx(handle, app.state.jobs, {})
    out = R._describe_sources(
        ctx,
        [
            {"type": "drawing", "id": ids[0]},
            {"type": "point_cloud", "id": ids[1]},
            {"type": "drawing", "id": "gone"},
        ],
    )
    assert out[0]["label"] == "GA.dxf" and out[0]["facts"] == "view: no, text: yes"
    assert out[1]["label"] == "Scan" and "1234" in out[1]["facts"]
    assert out[2]["label"] == "gone" and out[2]["facts"] == "missing"


def _set_sources(handle, run_id, sources):
    with handle.session() as s:
        s.get(AssetModelRun, run_id).sources = sources


def test_missing_cloud_source_fails_the_run_and_unsticks_the_model(handle, app, seeded):
    _set_sources(handle, seeded[1], [{"type": "point_cloud", "id": "gone"}])
    fake, result, run, model = go(handle, app, seeded, [])
    assert run.state == "failed" and run.summary and run.ended_at is not None
    assert result == {"run_id": seeded[1], "version": None} and fake.calls == []
    assert model.live_run_id is None and model.status != "building"


def test_unknown_source_type_fails_the_run_with_fixed_text(handle, app, seeded):
    _set_sources(handle, seeded[1], [{"type": "mystery", "id": "x"}])
    _, _, run, model = go(handle, app, seeded, [])
    assert run.state == "failed" and run.summary == R.INTERNAL and run.stop_reason is None
    assert model.live_run_id is None


def test_thumbnail_failure_fails_the_run_and_keeps_a_draft(handle, app, seeded, monkeypatch):
    from app.asset_models.agent.tools import ToolOut

    def boom(*_a):
        raise OSError("disk full C:/secret/path")

    monkeypatch.setattr(R, "_thumb", boom)
    monkeypatch.setattr(
        R,
        "run_tool",
        lambda rc, name, args: ToolOut("t", "s", image=b"x") if name == "validate" else _real(rc, name, args),
    )
    _, _, run, model = go(
        handle,
        app,
        seeded,
        [reply(("upsert_parts", {"parts": [SHELL]})), reply(("validate", {}))],
    )
    assert run.state == "failed" and run.summary == R.INTERNAL and "secret" not in run.summary
    assert model.live_run_id is None and run.version == 1


_real = R.run_tool


def _refine_seed(handle, app, seeded):
    from app.asset_models import service
    from app.asset_models.spec import AssetSpec

    mid, rid = seeded
    spec = AssetSpec.model_validate({"parts": [SHELL]})
    service.add_version(handle, app.state.jobs, mid, spec, kind="agent")
    with handle.session() as s:
        s.get(AssetModelRun, rid).mode = "refine"
        s.get(AssetModel, mid).live_run_id = rid


def test_refine_that_changes_nothing_writes_no_version(handle, app, seeded):
    _refine_seed(handle, app, seeded)
    app.state.keys.delete("anthropic")
    _, _, run, model = go(handle, app, seeded, [])
    assert run.state == "failed" and run.version is None and model.current_version == 1


def test_refine_finish_without_changes_writes_no_version(handle, app, seeded):
    _refine_seed(handle, app, seeded)
    _, result, run, model = go(handle, app, seeded, [reply(("finish", {"summary": "nothing to change"}))])
    assert run.state == "finished" and run.version is None and result["version"] is None
    assert model.current_version == 1


def test_no_model_call_after_the_tool_budget_is_spent(handle, app, seeded, monkeypatch):
    monkeypatch.setattr(R, "MAX_CALLS", 1)
    fake, _, run, _ = go(
        handle, app, seeded, [reply(("upsert_parts", {"parts": [SHELL]})), reply(("validate", {}))]
    )
    assert run.stop_reason == "budget" and len(fake.calls) == 1 and run.version == 1


def test_calls_after_finish_in_the_same_reply_are_not_run(handle, app, seeded):
    _, _, run, _ = go(
        handle,
        app,
        seeded,
        [reply(("upsert_parts", {"parts": [SHELL]})), reply(("finish", {"summary": "s"}), ("validate", {}))],
    )
    assert run.state == "finished" and [s["tool"] for s in run.steps] == ["upsert_parts", "finish"]


def test_cancel_before_start_stops_the_run_and_unsticks_the_model(handle, app, seeded):
    from app.jobs.registry import cancelled_before_start_hook

    ctx = Ctx(handle, app.state.jobs, {"model_id": seeded[0], "run_id": seeded[1]})
    cancelled_before_start_hook(R.RUN_JOB)(ctx)
    with handle.session() as s:
        run, model = s.get(AssetModelRun, seeded[1]), s.get(AssetModel, seeded[0])
        assert (run.state, run.stop_reason, run.summary) == ("stopped", "user", "Stopped by the operator.")
        assert run.ended_at is not None and run.version is None and run.phase == "done"
        assert model.live_run_id is None and model.status == "empty"
    assert ("asset_models.changed", {"asset_model_ids": [seeded[0]], "run_id": seeded[1]}) in ctx.published


def test_cancel_before_start_leaves_another_runs_lock(handle, app, seeded):
    from app.jobs.registry import cancelled_before_start_hook

    with handle.session() as s:
        s.get(AssetModel, seeded[0]).live_run_id = "other-run"
    ctx = Ctx(handle, app.state.jobs, {"model_id": seeded[0], "run_id": seeded[1]})
    cancelled_before_start_hook(R.RUN_JOB)(ctx)
    with handle.session() as s:
        assert s.get(AssetModel, seeded[0]).live_run_id == "other-run"
        assert s.get(AssetModelRun, seeded[1]).state == "stopped"


def test_end_does_not_release_another_runs_lock(handle, app, seeded):
    with handle.session() as s:
        s.get(AssetModel, seeded[0]).live_run_id = "other-run"
    _fake, _res, run, model = go(handle, app, seeded, [reply(("finish", {"summary": "x", "open_questions": []}))])
    assert run.state == "finished" and model.live_run_id == "other-run" and model.status == "building"


def test_unknown_tool_name_is_not_logged_or_recorded_verbatim(handle, app, seeded, caplog):
    import logging

    caplog.set_level(logging.DEBUG)
    _fake, _res, run, _model = go(
        handle,
        app,
        seeded,
        [
            reply(("ignore_previous_SECRETNAME", {})),
            reply(("finish", {"summary": "x", "open_questions": []})),
        ],
    )
    assert [s["tool"] for s in run.steps] == ["unknown", "finish"]
    assert "SECRETNAME" not in caplog.text and "asset model tool unknown ok=False" in caplog.text
