# backend/app/asset_models/agent/plant/resume.py
"""Resume plant runs cut off by an application restart (spec §8.4; index Review Focus #3). Called by
`app.asset_models.startup._sweep_runs` on project open. Nothing here may stop the app opening.

- A resumed run is a new `asset_model_run` job on the same run row; the model keeps its `live_run_id`.
- A package row still `running` was cut off: with its items file it finished before its row was
  written (-> `done`); cut off for the first time it goes back to `queued`; for the second time it is
  `failed` with INTERRUPTED_TWICE. `done` packages are never re-run, so never re-billed.
- A run interrupted more than MAX_RUN_INTERRUPTS times fails with a draft of its finished packages
  (ruling R17)."""

from __future__ import annotations

import logging
from datetime import UTC, datetime

from sqlalchemy import select

from app.asset_models import service, store
from app.asset_models.agent.plant import PLANT_MODES
from app.asset_models.agent.plant import packages as pk
from app.asset_models.agent.plant.merge import merge_items
from app.asset_models.agent.plant.state import (
    PlantState,
    env_of,
    load_merged,
    load_package_items,
    load_state,
    save_state,
    site_of,
)
from app.asset_models.spec import AssetSpec
from app.db.models import AssetModel, AssetModelRun

log = logging.getLogger(__name__)
INTERRUPTED_TWICE = "Interrupted twice while running, so it was not run again."
MAX_RUN_INTERRUPTS = 3
GAVE_UP = (
    "The run was interrupted by application restarts too many times;"
    " its finished packages were kept as a draft."
)
CUT_OFF = "interrupted by application restart"


def sweep_plant_runs(handle, runner) -> list[str]:
    """Resume every plant run still `running` whose job is gone. Returns the run ids resumed."""
    with handle.session() as s:
        cut = [
            (r.model_id, r.id)
            for r in s.scalars(
                select(AssetModelRun).where(
                    AssetModelRun.state == "running", AssetModelRun.mode.in_(PLANT_MODES)
                )
            )
            if not runner.is_live(r.job_id)
        ]
    resumed = []
    for model_id, run_id in cut:
        try:
            if _resume(handle, runner, model_id, run_id):
                resumed.append(run_id)
        except Exception as e:  # noqa: BLE001 - a bad run must never stop the app opening
            log.error("plant run could not resume (%s)", type(e).__name__)
            try:
                _give_up(handle, runner, model_id, run_id, CUT_OFF)
            except Exception as e2:  # noqa: BLE001
                log.error("plant run could not be closed (%s)", type(e2).__name__)
    return resumed


def _resume(handle, runner, model_id: str, run_id: str) -> bool:
    from app.asset_models.agent.runner import RUN_JOB

    rd = store.run_dir(handle, model_id, run_id)
    st = load_state(rd)
    st.run_interrupts += 1
    with handle.session() as s:
        for row in pk.rows(s, run_id):
            if row.state != "running":
                continue
            saved = load_package_items(rd, row.n)
            if saved is not None:  # saved, but the row was never updated
                pk.set_state(s, row.id, "done", item_count=len(saved))
                continue
            # The state file's count and the row's `attempts` (one per start) agree in a normal run; the
            # larger wins, so a package on its second start when the app closed is always "twice".
            k = max(st.interrupts.get(row.id, 0) + 1, row.attempts or 0)
            st.interrupts[row.id] = k
            if k >= 2:
                pk.set_state(s, row.id, "failed", summary=INTERRUPTED_TWICE)
            else:
                pk.set_state(s, row.id, "queued")
    save_state(rd, st)
    if st.run_interrupts > MAX_RUN_INTERRUPTS:
        _give_up(handle, runner, model_id, run_id, GAVE_UP, st)
        return False
    job = runner.submit(handle, RUN_JOB, {"model_id": model_id, "run_id": run_id, "resume": True})
    with handle.session() as s:
        s.get(AssetModelRun, run_id).job_id = job.id
    log.info("plant run resumed (interrupt %d)", st.run_interrupts)
    return True


def _give_up(handle, runner, model_id: str, run_id: str, summary: str, st: PlantState | None = None) -> None:
    """Fail the run (interrupted) and keep its finished packages as a draft. A run already ended is
    left alone, so the sweep's fallback never overwrites a give-up that only lost its draft."""
    rd = store.run_dir(handle, model_id, run_id)
    if st is None:
        try:
            st = load_state(rd)
        except Exception:  # noqa: BLE001 - a corrupt state file: close the run without a draft
            st = None
    with handle.session() as s:
        run = s.get(AssetModelRun, run_id)
        if run is None or run.state != "running":
            return
        finished = [r.n for r in pk.rows(s, run_id) if r.state in ("done", "failed")]
        pk.mark_unfinished(s, run_id, "skipped", "Not finished: the run was interrupted.")
        run.state, run.stop_reason, run.summary = "failed", "interrupted", summary
        run.phase, run.ended_at = "done", datetime.now(UTC)
        model = s.get(AssetModel, model_id)
        if model is not None and model.live_run_id == run_id:
            model.live_run_id = None
            service.refresh_status(model)
    if st is None:
        return
    try:
        _write_draft(handle, runner, model_id, run_id, rd, st, finished, summary)
    except Exception as e:  # noqa: BLE001 - the run is already closed; only its draft is lost
        log.error("plant run could not keep its draft (%s)", type(e).__name__)


def _write_draft(handle, runner, model_id, run_id, rd, st: PlantState, finished, summary: str) -> None:
    from app.asset_models.agent.plant.orchestrator import _drop_blocking

    items = load_merged(rd)
    if items is None:
        pairs = [(f"P{n}", x) for n in finished if (x := load_package_items(rd, n))]
        items = merge_items([x for _, x in pairs], [label for label, _ in pairs])
    if not items:
        return
    spec = _drop_blocking(AssetSpec(site=site_of(st), items=items, environment=env_of(st)))  # R20
    row, _job = service.add_version(handle, runner, model_id, spec, kind="draft", note=summary, run_id=run_id)
    with handle.session() as s:
        s.get(AssetModelRun, run_id).version = row.version
