# backend/app/asset_models/agent/runner.py
"""`asset_model_run` (spec 2026-10-02 §7.2): sample clouds, then loop model call -> tools until finish,
a budget, the clock, a stop or a provider error. History is append-only. Logs carry tool names, states
and durations only."""

from __future__ import annotations

import asyncio
import base64
import io
import logging
import time
from datetime import UTC, datetime

from PIL import Image

from app.asset_models import service, store
from app.asset_models.agent.prompt import SYSTEM, first_message
from app.asset_models.agent.tools import TOOLS, RunContext, run_tool, tool_specs
from app.asset_models.look import LookError
from app.asset_models.look.cloud import CloudSample, sample_cloud, source_of
from app.asset_models.spec import AssetSpec
from app.db.models import AssetModel, AssetModelRun, Drawing, PointCloud
from app.db.models import Image as ImageRow
from app.jobs.cancellation import JobCancelled
from app.jobs.registry import register_job_type
from app.project_agent.history import HistoryEntry, LlmError, ToolResult

log = logging.getLogger(__name__)
RUN_JOB = "asset_model_run"
MAX_CALLS = 80
MAX_TOKENS = 3_000_000
MAX_SECONDS = 1200
EFFORT = "high"
KEY_MISSING = "Add this provider's API key in App settings."
INTERNAL = "The run stopped because of an internal error."
NUDGE = "Continue with the tools, or call finish with a summary and open questions."


class _Stop(Exception):
    def __init__(self, state: str, reason: str | None, summary: str | None = None):
        self.state, self.reason, self.summary = state, reason, summary


def _now():
    return datetime.now(UTC)


def _update(ctx, run_id, **fields):
    with ctx.project.session() as s:
        run = s.get(AssetModelRun, run_id)
        for k, v in fields.items():
            setattr(run, k, v)


def _append_step(ctx, run_id, step):
    with ctx.project.session() as s:
        run = s.get(AssetModelRun, run_id)
        run.steps = [*run.steps, step]
        run.phase = step.get("phase", run.phase)


def _call_model(ctx, llm, **kwargs):
    """Run the async model call, polling the job's cancel flag so Stop doesn't wait for a slow answer."""

    async def inner():
        task = asyncio.ensure_future(llm(**kwargs))
        while not task.done():
            try:
                ctx.check_cancelled()
            except JobCancelled:
                task.cancel()
                raise
            await asyncio.sleep(0.25)
        return task.result()

    return asyncio.run(inner())


_DRAWING_FACTS = {
    "png": "view: yes, text: no",
    "jpg": "view: yes, text: no",
    "tif": "view: yes, text: no",
    "pdf": "view: yes, text: yes (empty if scanned)",
    "dxf": "view: no, text: yes",
    "landxml": "view: no, text: no (cannot be read)",
}


def _describe_sources(ctx, sources):
    """Give each source a label and a short facts string for list_sources (names only, no paths)."""
    models = {"drawing": Drawing, "point_cloud": PointCloud, "image": ImageRow}
    out = []
    with ctx.project.session() as s:
        for src in sources:
            row = s.get(models[src["type"]], src["id"])
            if row is None:
                out.append({**src, "label": src["id"], "facts": "missing"})
            elif src["type"] == "drawing":
                out.append({**src, "label": row.name, "facts": _DRAWING_FACTS.get(row.format, "")})
            elif src["type"] == "point_cloud":
                facts = f"{row.point_count} points" if row.point_count else ""
                out.append({**src, "label": row.name, "facts": facts})
            else:
                out.append({**src, "label": str(row.path).replace("\\", "/").rsplit("/", 1)[-1], "facts": ""})
    return out


def _thumb(ctx, run_id, model_id, n, jpeg):
    path = store.run_dir(ctx.project, model_id, run_id) / f"step_{n}.png"
    path.parent.mkdir(parents=True, exist_ok=True)
    img = Image.open(io.BytesIO(jpeg))
    img.thumbnail((320, 320))
    img.save(path, "PNG")


def _cancelled_before_start(ctx) -> None:
    """Stop pressed while the job was still queued: nothing ran, so end the run with no version."""
    model_id, run_id = ctx.params["model_id"], ctx.params["run_id"]
    with ctx.project.session() as s:
        run = s.get(AssetModelRun, run_id)
        if run is not None and run.state == "running":
            run.state, run.stop_reason, run.summary = "stopped", "user", "Stopped by the operator."
            run.phase, run.ended_at = "done", _now()
        model = s.get(AssetModel, model_id)
        if model is not None:
            if model.live_run_id == run_id:
                model.live_run_id = None
            service.refresh_status(model)
    ctx.publish("asset_models.changed", {"asset_model_ids": [model_id], "run_id": run_id})


@register_job_type(RUN_JOB, on_cancelled_before_start=_cancelled_before_start)
def run_asset_model(ctx) -> dict:
    model_id, run_id = ctx.params["model_id"], ctx.params["run_id"]
    rc = RunContext(
        handle=ctx.project, model_id=model_id, run_id=run_id, sources=[], spec=AssetSpec(), samples={}
    )
    base = rc.spec.model_dump_json()  # the spec the run started with; a version is written only if it changed
    usage = {"input_tokens": 0, "output_tokens": 0}
    calls = 0
    started = time.monotonic()
    try:
        with ctx.project.session() as s:
            run = s.get(AssetModelRun, run_id)
            model = s.get(AssetModel, model_id)
            provider, model_name, mode, notes, sources = (
                run.provider,
                run.model_name,
                run.mode,
                run.notes,
                list(run.sources),
            )
            if mode == "refine" and model.current_version:
                rc.spec = AssetSpec.model_validate(store.get_version(s, model_id, model.current_version).spec)
        spec = rc.spec
        base = spec.model_dump_json()
        rc.sources = _describe_sources(ctx, sources)
        # ---- sampling (one streamed pass per cloud, bounded)
        clouds = [x["id"] for x in sources if x["type"] == "point_cloud"]
        for k, cid in enumerate(clouds):
            ctx.progress(0.15 * k / max(len(clouds), 1), "Sampling point cloud")
            path = rc.run_dir / f"cloud_{cid}.npz"
            if path.exists():
                rc.samples[cid] = CloudSample.load(path)
                continue
            sample = sample_cloud(
                source_of(ctx.project, cid),
                check_cancelled=ctx.check_cancelled,
                progress=lambda d, t, k=k: ctx.progress(
                    0.15 * (k + d / max(t, 1)) / len(clouds), "Sampling point cloud"
                ),
            )
            rc.run_dir.mkdir(parents=True, exist_ok=True)
            sample.save(path)
            rc.samples[cid] = sample
        _update(ctx, run_id, phase="reading")
        history = [HistoryEntry(role="user", text=first_message(mode, notes, rc.sources, len(spec.parts)))]
        specs = tool_specs()
        idle = 0
        llm = ctx.runner.agent_llm
        if llm is None:
            raise _Stop("failed", "provider_error", "The model is not available.")
        while True:
            ctx.check_cancelled()
            if time.monotonic() - started > MAX_SECONDS:
                raise _Stop("stopped", "timeout", "The run reached its 20-minute limit.")
            if calls >= MAX_CALLS:  # no further paid call once the tool-call budget is spent
                raise _Stop("stopped", "budget", "The run reached its limit of tool calls.")
            key = ctx.runner.keys.get(provider)
            if not key:
                raise _Stop("failed", "provider_error", KEY_MISSING)
            try:
                reply = _call_model(
                    ctx,
                    llm,
                    provider=provider,
                    api_key=key,
                    model=model_name,
                    system=SYSTEM,
                    history=history,
                    tools=specs,
                    effort=EFFORT,
                    cache=True,
                )
            finally:
                del key
            if reply.usage:
                usage = {k: usage[k] + int(reply.usage.get(k, 0)) for k in usage}
                _update(ctx, run_id, usage=usage)
            history.append(
                HistoryEntry(
                    role="assistant",
                    text=reply.text or "",
                    tool_calls=list(reply.tool_calls),
                    provider=provider,
                    model=model_name,
                    provider_payload=reply.provider_payload,
                )
            )
            if usage["input_tokens"] + usage["output_tokens"] > MAX_TOKENS:
                if reply.tool_calls:
                    history.append(
                        HistoryEntry(
                            role="tool_results",
                            results=[
                                ToolResult(
                                    c.id, c.name, "Not run: the token budget is used up.", is_error=True
                                )
                                for c in reply.tool_calls
                            ],
                        )
                    )
                raise _Stop("stopped", "budget", "The run used its token budget.")
            if not reply.tool_calls:
                idle += 1
                if idle >= 2:
                    rc.finished = {"summary": (reply.text or "")[:4000], "open_questions": []}
                    break
                history.append(HistoryEntry(role="user", text=NUDGE))
                continue
            idle = 0
            results = []
            stop = None
            for call in reply.tool_calls:
                if rc.finished:
                    results.append(
                        ToolResult(call.id, call.name, "Not run: the run already finished.", is_error=True)
                    )
                    continue
                if calls >= MAX_CALLS:
                    results.append(
                        ToolResult(
                            call.id,
                            call.name,
                            "Not run: the run reached its limit of tool calls.",
                            is_error=True,
                        )
                    )
                    stop = _Stop("stopped", "budget", "The run reached its limit of tool calls.")
                    continue
                calls += 1
                t0 = time.monotonic()
                # model output: never log an unknown name verbatim
                tool_name = call.name if call.name in TOOLS else "unknown"
                out = run_tool(rc, call.name, call.input)
                log.info("asset model tool %s ok=%s %.2fs", tool_name, out.ok, time.monotonic() - t0)
                if out.image:
                    _thumb(ctx, run_id, model_id, calls, out.image)
                _append_step(
                    ctx,
                    run_id,
                    {
                        "n": calls,
                        "tool": tool_name,
                        "ok": out.ok,
                        "summary": out.summary,
                        "has_thumb": bool(out.image),
                        "phase": out.phase,
                    },
                )
                if rc.comparison is not None:
                    _update(ctx, run_id, comparison=rc.comparison)
                results.append(
                    ToolResult(
                        call.id,
                        call.name,
                        out.text,
                        is_error=not out.ok,
                        image_jpeg_b64=base64.b64encode(out.image).decode() if out.image else None,
                    )
                )
                ctx.progress(
                    0.15 + 0.8 * min(calls / MAX_CALLS, 1), f"{out.phase.capitalize()} - step {calls}"
                )
                ctx.publish("asset_models.changed", {"asset_model_ids": [model_id], "run_id": run_id})
            history.append(HistoryEntry(role="tool_results", results=results))
            if stop:
                raise stop
            if rc.finished:
                break
        return _end(
            ctx,
            rc,
            "finished",
            None,
            rc.finished["summary"],
            rc.finished["open_questions"],
            base,
            kind="agent",
        )
    except _Stop as e:
        return _end(ctx, rc, e.state, e.reason, e.summary, [], base, kind="draft")
    except JobCancelled:
        try:
            _end(ctx, rc, "stopped", "user", "Stopped by the operator.", [], base, kind="draft")
        except Exception as e:  # noqa: BLE001 - the cancel must still propagate
            log.error("asset model run could not record its stop (%s)", type(e).__name__)
        raise
    except LlmError as e:
        return _end(ctx, rc, "failed", "provider_error", e.message, [], base, kind="draft")
    except Exception as e:  # noqa: BLE001 - never leave a run stuck "running"; fixed text, type name only
        log.error("asset model run failed (%s)", type(e).__name__)
        text = e.message if isinstance(e, LookError) else INTERNAL
        return _end(ctx, rc, "failed", None, text, [], base, kind="draft")


def _end(ctx, rc: RunContext, state, reason, summary, questions, base, *, kind) -> dict:
    version = None
    if rc.spec.parts and rc.spec.model_dump_json() != base:
        try:
            row, _job = service.add_version(
                ctx.project,
                ctx.runner,
                rc.model_id,
                rc.spec,
                kind=kind,
                note=summary,
                source_ids=[{"type": s["type"], "id": s["id"]} for s in rc.sources],
                run_id=rc.run_id,
            )
            version = row.version
        except Exception as e:  # noqa: BLE001 - an invalid working spec cannot happen (tools validate), but never lose the run
            # Never the traceback or message: they can carry spec payloads.
            log.error("asset model run could not write its version (%s)", type(e).__name__)
    with ctx.project.session() as s:
        run = s.get(AssetModelRun, rc.run_id)
        run.state, run.stop_reason, run.summary, run.open_questions = state, reason, summary, list(questions)
        run.version, run.phase, run.ended_at = version, "done", _now()
        model = s.get(AssetModel, rc.model_id)
        if model.live_run_id == rc.run_id:
            model.live_run_id = None
        service.refresh_status(model)
    ctx.publish("asset_models.changed", {"asset_model_ids": [rc.model_id], "run_id": rc.run_id})
    return {"run_id": rc.run_id, "version": version}
