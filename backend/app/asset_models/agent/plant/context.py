# backend/app/asset_models/agent/plant/context.py
"""The plant run's shared context and one conversation's scope (spec §8.2)."""

from __future__ import annotations

import threading
from dataclasses import dataclass, field
from typing import Any

from app.asset_models.agent.plant.budget import PlantLimits, RunBudget, limits_from
from app.asset_models.agent.plant.packages import PackageWork
from app.asset_models.agent.plant.record import Recorder
from app.asset_models.agent.plant.state import (
    PlantState,
    load_merged,
    load_state,
    save_merged,
    save_state,
    site_of,
)
from app.asset_models.agent.tools import RunContext
from app.asset_models.siteframe import PlantGrid
from app.asset_models.spec import AssetSpec, Item, SiteFrame
from app.db.models import AssetModelRun


@dataclass
class Scope:
    """One conversation: the orchestrator's (`package` None, `items` is the merged store) or one package's."""

    name: str
    stage: str
    items: dict[str, Item]
    package: PackageWork | None = None
    calls: int = 0
    images: int = 0
    finished: dict | None = None
    next_stage: str | None = None
    wrap_up: bool = False
    rendered: bool = False


@dataclass
class PlantRunContext:
    job: Any
    model_id: str
    run_id: str
    provider: str
    model_name: str
    mode: str
    sources: list[dict]
    limits: PlantLimits
    budget: RunBudget
    state: PlantState
    m1: RunContext
    recorder: Recorder
    notes: str | None = None
    store: dict[str, Item] = field(default_factory=dict)
    lock: threading.RLock = field(default_factory=threading.RLock)
    inflight: dict[str, Scope] = field(default_factory=dict)
    cloud: Any = None
    check: Any = None
    finished: dict | None = None

    @property
    def handle(self):
        return self.job.project

    @property
    def run_dir(self):
        return self.m1.run_dir

    def check_cancelled(self) -> None:
        self.job.check_cancelled()

    def site(self) -> SiteFrame | None:
        return site_of(self.state)

    def grid(self) -> PlantGrid | None:
        site = self.site()
        return PlantGrid(site) if site is not None else None

    def drawing_ids(self) -> set[str]:
        return {x["id"] for x in self.sources if x["type"] == "drawing"}

    def save(self) -> None:
        with self.lock:
            self.state.elapsed_s = self.budget.elapsed_s()
            save_state(self.run_dir, self.state)

    def save_store(self) -> None:
        with self.lock:
            save_merged(self.run_dir, list(self.store.values()))


def build_context(job) -> PlantRunContext:
    from app.asset_models.agent.runner import _describe_sources

    model_id, run_id = job.params["model_id"], job.params["run_id"]
    with job.project.session() as s:
        run = s.get(AssetModelRun, run_id)
        provider, model_name, mode, notes = run.provider, run.model_name, run.mode, run.notes
        sources, used = list(run.sources or []), dict(run.usage or {})
    m1 = RunContext(
        handle=job.project,
        model_id=model_id,
        run_id=run_id,
        sources=_describe_sources(job, sources),
        spec=AssetSpec(),
        samples={},
    )
    state = load_state(m1.run_dir)
    limits = limits_from(state.limits)
    rc = PlantRunContext(
        job=job,
        model_id=model_id,
        run_id=run_id,
        provider=provider,
        model_name=model_name,
        mode=mode,
        sources=m1.sources,
        limits=limits,
        budget=RunBudget(limits, used=used, elapsed_s=state.elapsed_s),
        state=state,
        m1=m1,
        recorder=Recorder(job, model_id, run_id, model_name=model_name),
        notes=notes,
    )
    merged = load_merged(m1.run_dir)
    if merged:
        rc.store.update({i.id: i for i in merged})
    return rc
