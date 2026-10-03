# backend/app/asset_models/agent/plant/record.py
"""Writes to the run row, shared by the orchestrator and the sub-run threads. One lock serialises the
read-modify-write of `run.steps` and `run.usage`. Steps hold tool names and app-written summaries only."""

from __future__ import annotations

import threading
import time

from app.db.models import AssetModelRun

PHASE = {
    "survey": "reading",
    "trace": "building",
    "merge": "building",
    "cloud_check": "checking",
    "review": "checking",
    "environment": "building",
    "build": "checking",
    "done": "done",
}
PROGRESS = {
    "survey": 0.02,
    "trace": 0.10,
    "merge": 0.80,
    "cloud_check": 0.83,
    "review": 0.88,
    "environment": 0.91,
    "build": 0.95,
}
LABEL = {
    "survey": "Reading the drawings",
    "trace": "Tracing packages",
    "merge": "Merging packages",
    "cloud_check": "Checking against the point cloud",
    "review": "Reviewing the cloud check",
    "environment": "Tracing land, sea and roads",
    "build": "Building and checking the model",
}
MAX_STEPS = 400
PUBLISH_EVERY_S = 1.0


class Recorder:
    def __init__(self, job, model_id: str, run_id: str, model_name: str | None = None):
        self.job, self.model_id, self.run_id = job, model_id, run_id
        self.lock = threading.Lock()
        self.stage = "survey"
        with job.project.session() as s:
            run = s.get(AssetModelRun, run_id)
            steps = run.steps or []
            self.model_name = model_name if model_name is not None else run.model_name
        self.n = max((int(st.get("n", 0)) for st in steps), default=0)
        self._published = 0.0

    def _publish(self, force: bool = False) -> None:
        now = time.monotonic()
        if force or now - self._published >= PUBLISH_EVERY_S:
            self._published = now
            self.job.publish(
                "asset_models.changed", {"asset_model_ids": [self.model_id], "run_id": self.run_id}
            )

    def enter(self, stage: str, done: int | None = None, total: int | None = None) -> None:
        with self.lock:
            self.stage = stage
            with self.job.project.session() as s:
                s.get(AssetModelRun, self.run_id).phase = PHASE.get(stage, "building")
        fraction, message = PROGRESS.get(stage, 0.0), LABEL.get(stage, stage)
        if stage == "trace" and total:
            fraction = 0.10 + 0.70 * (done or 0) / total
            message = f"{message} ({done or 0}/{total})"
        self.job.progress(fraction, message)
        self._publish(force=True)

    def step(self, scope_name: str, tool: str, out) -> int:
        from app.asset_models.agent.runner import _thumb

        with self.lock:
            self.n += 1
            n = self.n
            if out.image:
                _thumb(self.job, self.run_id, self.model_id, n, out.image)
            prefix = "" if scope_name == "orchestrator" else f"{scope_name} · "
            entry = {
                "n": n,
                "tool": tool,
                "ok": out.ok,
                "summary": (prefix + out.summary)[:300],
                "has_thumb": bool(out.image),
                "phase": PHASE.get(self.stage, "building"),
            }
            with self.job.project.session() as s:
                run = s.get(AssetModelRun, self.run_id)
                keep = (run.steps or [])[-(MAX_STEPS - 1) :] if MAX_STEPS > 1 else []
                run.steps = [*keep, entry]
        self._publish()
        return n

    def usage(self, budget) -> None:
        """`run.usage` in F0's shape (totals + `by_stage` {current, stages, cost estimate})."""
        with self.lock:
            usage = budget.run_usage(self.stage, self.model_name or "")
            with self.job.project.session() as s:
                s.get(AssetModelRun, self.run_id).usage = usage
