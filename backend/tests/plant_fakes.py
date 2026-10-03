# backend/tests/plant_fakes.py
"""Scripted fake model and job context for the plant run. Extends M1's FakeLlm/Ctx pattern
(test_asset_model_run_job.py) to several conversations running at once: each call is routed to the
orchestrator's script or to one package's script."""

from __future__ import annotations

import itertools
import re
import threading
from dataclasses import asdict

from app.asset_models import store
from app.asset_models.agent.plant.budget import PlantLimits
from app.asset_models.agent.plant.state import PlantState, save_state
from app.db.models import AssetModel, AssetModelRun, Drawing
from app.jobs.cancellation import JobCancelled
from app.project_agent.history import ModelReply, ToolCall

KEY = "SECRET-KEY-123"
KIPIC = {
    "epsg": 32639,
    "origin_crs": [244338.089, 3179515.690],
    "plant_north_deg": 17.9991,
    "datum_label": "HPFS",
    "datum_el_m": 100.0,
}
_ids = itertools.count()


def reply(*calls, text="", usage=(100, 50)):
    return ModelReply(
        text=text,
        tool_calls=[ToolCall(f"c{next(_ids)}", name, args) for name, args in calls],
        provider_payload=None,
        usage={"input_tokens": usage[0], "output_tokens": usage[1]},
    )


class PlantCtx:
    """A job context whose cancel flag is a threading.Event, like the real JobContext."""

    def __init__(self, handle, runner, params):
        self.project, self.runner, self.params, self.job_id = handle, runner, params, "job-run"
        self.cancelled = threading.Event()
        self.published, self.messages = [], []
        self._lock = threading.Lock()

    def progress(self, fraction, message=""):
        with self._lock:
            self.messages.append(message)

    def publish(self, type_, payload):
        with self._lock:
            self.published.append((type_, payload))

    def check_cancelled(self):
        if self.cancelled.is_set():
            raise JobCancelled()


class FakePlantLlm:
    """A script step is a ModelReply, an exception to raise, or a callable returning either. The
    callable runs in the calling (sub-run) thread, so a threading.Barrier in it proves parallelism."""

    def __init__(self, orchestrator=(), packages=None):
        self.scripts = {"orchestrator": list(orchestrator)}
        for name, steps in (packages or {}).items():
            self.scripts[name] = list(steps)
        self.calls: list[dict] = []
        self.lock = threading.Lock()

    def of(self, conv: str) -> list[dict]:
        return [c for c in self.calls if c["conv"] == conv]

    async def __call__(self, provider, *, api_key, model, system, history, tools, effort=None, cache=False):
        from app.asset_models.agent.plant.prompt_plant import ORCH_SYSTEM

        if system == ORCH_SYSTEM:
            conv = "orchestrator"
        else:
            m = re.match(r"Package (P\d+):", history[0].text or "")
            conv = m.group(1) if m else "?"
        with self.lock:
            self.calls.append(
                {
                    "conv": conv,
                    "history_len": len(history),
                    "api_key": api_key,
                    "cache": cache,
                    "effort": effort,
                    "tools": [t.name for t in tools],
                    "user_texts": [h.text for h in history if h.role == "user"],
                }
            )
            script = self.scripts.setdefault(conv, [])
            step = script.pop(0) if script else reply(text="Nothing more to do.")
        if callable(step):
            step = step()
        if isinstance(step, BaseException):
            raise step
        return step


def seed_plant(handle, app, *, mode="plant", pages=2, limits=None, clouds=()):
    """A plant model, its running run, `pages` ready PDF pages of one file and the run's state file."""
    app.state.keys.set("anthropic", KEY)
    with handle.session() as s:
        drawings = [
            Drawing(
                name=f"Plot plan — p{k + 1}",
                format="pdf",
                status="ready",
                source_path="C:/plans/plot.pdf",
                source_size=1,
                source_sha256="sha-plot",
                page=k + 1,
                width=4000,
                height=2800,
                dpi=150,
            )
            for k in range(pages)
        ]
        s.add_all(drawings)
        m = AssetModel(name="Plant", status="building")
        s.add(m)
        s.flush()
        sources = [{"type": "drawing", "id": d.id} for d in drawings]
        sources += [{"type": "point_cloud", "id": c} for c in clouds]
        run = AssetModelRun(
            model_id=m.id,
            job_id="job-run",
            provider="anthropic",
            model_name="claude-opus-5-5",
            mode=mode,
            sources=sources,
        )
        s.add(run)
        s.flush()
        m.live_run_id = run.id
        ids = {"model": m.id, "run": run.id, "drawings": [d.id for d in drawings]}
    save_state(
        store.run_dir(handle, ids["model"], ids["run"]), PlantState(limits=asdict(limits or PlantLimits()))
    )
    return ids


def make_ctx(handle, app, ids) -> PlantCtx:
    return PlantCtx(handle, app.state.jobs, {"model_id": ids["model"], "run_id": ids["run"]})


def make_rc(handle, app, ids, ctx=None):
    from app.asset_models.agent.plant.context import build_context

    return build_context(ctx or make_ctx(handle, app, ids))


def item(i, *, tag=None, type="other", e=0.0, n=0.0, size=(10.0, 6.0), did=None, conf="medium", **extra):  # noqa: A002
    src = extra.pop("source", None) or ({"kind": "drawing", "id": did} if did else {"kind": "assumed"})
    return {
        "id": i,
        "tag": tag,
        "name": extra.pop("name", i),
        "type": type,
        "footprint": {"kind": "rect", "center": [e, n], "size": list(size), "rot_deg": 0},
        "base_el": 100.0,
        "top_el": 106.0,
        "height_source": "drawing",
        "source": src,
        "confidence": conf,
        **extra,
    }
