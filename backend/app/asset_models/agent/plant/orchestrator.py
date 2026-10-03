# backend/app/asset_models/agent/plant/orchestrator.py
"""The plant run (spec §8): survey -> parallel package sub-runs -> merge -> cloud check -> review ->
environment -> build check + self-check -> finish, inside the `asset_model_run` job.

The orchestrator is one append-only conversation across its stages. App code runs trace, merge, the
cloud check and the build check. Logs carry tool names, states, durations and counts only."""

from __future__ import annotations

import logging
from collections import Counter, deque
from concurrent.futures import FIRST_COMPLETED, ThreadPoolExecutor, wait
from datetime import UTC, datetime

from app.asset_models import service
from app.asset_models import store as mstore
from app.asset_models.agent.plant import packages as pk
from app.asset_models.agent.plant import prompt_plant as P
from app.asset_models.agent.plant.cloud import _note, cloud_stage
from app.asset_models.agent.plant.context import PlantRunContext, Scope, build_context
from app.asset_models.agent.plant.merge import merge_items, with_flag
from app.asset_models.agent.plant.model import call_model
from app.asset_models.agent.plant.state import STAGE_ORDER, env_of, load_package_items, save_package_items
from app.asset_models.agent.plant.subrun import PackageResult, run_package
from app.asset_models.agent.plant.tools_plant import execute, specs_for
from app.asset_models.agent.runner import INTERNAL
from app.asset_models.look import LookError
from app.asset_models.look.cloud import CloudSample, sample_cloud, source_of
from app.asset_models.spec import AssetSpec
from app.asset_models.validate import FALLBACK_CODES, validate
from app.db.models import AssetModel, AssetModelRun
from app.errors import AppError
from app.jobs.cancellation import JobCancelled
from app.project_agent.history import HistoryEntry, LlmError, ToolResult

log = logging.getLogger(__name__)
ORCH_CALLS = {"survey": 120, "review": 60, "environment": 60, "build": 40}
NOT_RUN_STAGE = "Not run: this stage already ended."
NO_REVIEW = "The review stage was skipped: no cloud check ran and there were no candidates."


class BudgetOut(Exception):
    def __init__(self, why: str):
        super().__init__(why)
        self.why = why


class _Stop(Exception):
    def __init__(self, state: str, reason: str | None, summary: str):
        super().__init__(summary)
        self.state, self.reason, self.summary = state, reason, summary


def _before(stage: str, other: str) -> bool:
    return STAGE_ORDER.index(stage) < STAGE_ORDER.index(other)


def _advance(rc: PlantRunContext, stage: str) -> None:
    rc.state.stage = stage
    rc.save()
    rc.recorder.enter(stage)


# ------------------------------------------------------------------ the orchestrator conversation
class Conversation:
    def __init__(self, rc: PlantRunContext, opening: str):
        self.rc, self.opening = rc, opening
        self.history: list[HistoryEntry] = []
        self.scope = Scope(name="orchestrator", stage="survey", items=rc.store)
        self.specs = specs_for("orchestrator")

    def run_stage(self, stage: str, message: str) -> None:
        rc, scope = self.rc, self.scope
        scope.stage, scope.next_stage, scope.rendered = stage, None, False
        rc.recorder.enter(stage)
        text = message if self.history else f"{self.opening}\n\n{message}"
        self.history.append(HistoryEntry(role="user", text=text))
        calls = idle = 0
        while True:
            rc.check_cancelled()
            why = rc.budget.exhausted()
            if why:
                raise BudgetOut(why)
            if calls >= ORCH_CALLS[stage]:
                _note(rc, f"The {stage} stage reached its limit of {ORCH_CALLS[stage]} tool calls.")
                return
            reply = call_model(rc, system=P.ORCH_SYSTEM, history=self.history, tools=self.specs)
            if reply.usage:
                rc.budget.charge(reply.usage, stage)
                rc.recorder.usage(rc.budget)
            self.history.append(
                HistoryEntry(
                    role="assistant",
                    text=reply.text or "",
                    tool_calls=list(reply.tool_calls),
                    provider=rc.provider,
                    model=rc.model_name,
                    provider_payload=reply.provider_payload,
                )
            )
            if not reply.tool_calls:
                idle += 1
                if idle >= 2:
                    if stage == "build" and rc.finished is None:
                        rc.finished = {"summary": (reply.text or "")[:4000], "open_questions": []}
                    return
                self.history.append(HistoryEntry(role="user", text=P.NUDGE))
                continue
            idle = 0
            results = []
            for call in reply.tool_calls:
                if scope.next_stage is not None or rc.finished is not None:
                    results.append(ToolResult(call.id, call.name, NOT_RUN_STAGE, is_error=True))
                    continue
                calls += 1
                rc.budget.charge_call(stage)
                results.append(execute(rc, scope, call))
            self.history.append(HistoryEntry(role="tool_results", results=results))
            if scope.next_stage is not None or rc.finished is not None:
                return


# ------------------------------------------------------------------ app stages
def _sample_m1_clouds(rc: PlantRunContext) -> None:
    """M1's <= 2 M point samples, for the look tools cloud_slice / cloud_fit. A cloud that can't be read
    becomes a run note, not a failure."""
    for cid in [x["id"] for x in rc.sources if x["type"] == "point_cloud"]:
        path = rc.run_dir / f"cloud_{cid}.npz"
        try:
            if path.exists():
                rc.m1.samples[cid] = CloudSample.load(path)
                continue
            sample = sample_cloud(source_of(rc.handle, cid), check_cancelled=rc.check_cancelled)
        except LookError as e:
            _note(rc, f"Point cloud {cid}: {e.message}")
            continue
        rc.run_dir.mkdir(parents=True, exist_ok=True)
        sample.save(path)
        rc.m1.samples[cid] = sample


def _persist(rc: PlantRunContext, w, res: PackageResult) -> None:
    save_package_items(rc.run_dir, w.n, res.items)  # the file first: a crash after it still counts as done
    with rc.lock, rc.handle.session() as s:
        pk.set_state(s, w.id, res.state, usage=res.usage, item_count=len(res.items), summary=res.summary)
    rc.inflight.pop(w.id, None)
    with rc.lock:
        rc.state.questions.extend(f"P{w.n}: {q}" for q in res.questions)
    rc.save()
    log.info("plant package P%d %s items=%d calls=%d", w.n, res.state, len(res.items), res.calls)


def _trace(rc: PlantRunContext) -> None:
    with rc.handle.session() as s:
        rows = pk.rows(s, rc.run_id)
        works = [pk.work_of(r, rc.state.packages_meta.get(r.id, {})) for r in rows if r.state == "queued"]
        total, done = len(rows), sum(1 for r in rows if r.state in pk.TERMINAL)
    rc.recorder.enter("trace", done, total)
    pending, running = deque(works), {}
    pool = ThreadPoolExecutor(max_workers=rc.limits.parallel, thread_name_prefix="plant-package")
    try:
        while pending or running:
            while pending and len(running) < rc.limits.parallel and rc.budget.exhausted() is None:
                rc.check_cancelled()
                w = pending.popleft()
                with rc.lock, rc.handle.session() as s:
                    pk.set_state(s, w.id, "running")
                running[pool.submit(run_package, rc, w)] = w
            if not running:
                break
            finished, _ = wait(list(running), timeout=0.5, return_when=FIRST_COMPLETED)
            for f in finished:
                w = running.pop(f)
                _persist(rc, w, f.result())  # JobCancelled from a sub-run propagates
                done += 1
                rc.recorder.enter("trace", done, total)
            rc.check_cancelled()
    finally:
        pool.shutdown(wait=True, cancel_futures=True)
    if pending:
        with rc.lock, rc.handle.session() as s:
            for w in pending:
                pk.set_state(s, w.id, "skipped", summary="Not started: the run's budget ran out.")


def _base_spec(rc: PlantRunContext) -> AssetSpec:
    with rc.handle.session() as s:
        return AssetSpec.model_validate(mstore.get_version(s, rc.model_id, rc.state.base_version).spec)


def _merge(rc: PlantRunContext, extra: list | None = None) -> None:
    lists, labels = [], []
    if rc.mode == "plant_package" and rc.state.base_version:
        lists.append(list(_base_spec(rc).items))
        labels.append(f"version {rc.state.base_version}")
    with rc.handle.session() as s:
        rows = [(r.n, r.state) for r in pk.rows(s, rc.run_id)]
    for n, state in rows:
        items = load_package_items(rc.run_dir, n) if state in ("done", "failed") else None
        if items:
            lists.append(items)
            labels.append(f"P{n}")
    for label, items in extra or []:
        lists.append(items)
        labels.append(label)
    merged = merge_items(lists, labels)
    with rc.lock:
        rc.store.clear()
        rc.store.update({i.id: i for i in merged})
    rc.save_store()


def _merge_and_check(rc: PlantRunContext, then: str = "review") -> None:
    """The app stages after tracing: merge -> cloud check -> `then`, each skipped when a resume is
    past it. The one place the cloud stage is called (Task 12 amendment)."""
    if rc.state.stage == "merge":
        _merge(rc)
        _advance(rc, "cloud_check")
    if rc.state.stage == "cloud_check":
        cloud_stage(rc)
        _advance(rc, then)


def build_check(rc: PlantRunContext) -> list[str]:
    """Build every item in process with the GLB's own builders (ruling R4); flag the fallbacks."""
    from app.asset_models.builders.base import BuildCtx, build_item, load_all

    load_all()
    ctx = BuildCtx(grid=rc.grid(), lod=0.25)
    fallen = []
    with rc.lock:
        items = list(rc.store.values())
    for it in items:
        rc.check_cancelled()
        _nodes, flags = build_item(it, ctx)
        fb = next((f for f in flags if f.code == "builder_fallback"), None)
        if fb is not None:
            with rc.lock:
                rc.store[it.id] = with_flag(rc.store[it.id], fb)
            fallen.append(it.id)
    rc.save_store()
    return fallen


# ------------------------------------------------------------------ flows
def _full(rc: PlantRunContext) -> dict:
    st = rc.state
    _sample_m1_clouds(rc)
    if st.stage == "survey":
        conv = Conversation(rc, P.first_message(rc))
        conv.run_stage("survey", P.survey_message())
        with rc.handle.session() as s:
            if not pk.rows(s, rc.run_id):
                raise _Stop("failed", None, "The survey planned no packages, so nothing was traced.")
        _advance(rc, "trace")
    else:
        conv = Conversation(rc, P.resume_message(rc))
    if st.stage == "trace":
        _trace(rc)
        _advance(rc, "merge")
    why = rc.budget.exhausted()
    if why:
        raise BudgetOut(why)
    _merge_and_check(rc)
    if st.stage == "review":
        if rc.check is not None or st.candidates:
            conv.run_stage("review", P.review_message(rc))
        else:
            _note(rc, NO_REVIEW)  # ruling R14
        _advance(rc, "environment")
    if st.stage == "environment":
        conv.run_stage("environment", P.environment_message(rc))
        _advance(rc, "build")
    fallen = build_check(rc)
    conv.run_stage("build", P.build_message(rc, fallen))
    fin = rc.finished or {"summary": "The run ended without a summary.", "open_questions": []}
    return _end(rc, "finished", None, fin["summary"], fin["open_questions"], kind="agent")


def _app_only_finish(rc: PlantRunContext, why: str) -> dict:
    """Ruling R8: the budget or the clock ran out. Merge, check and build what was traced."""
    reason = "budget" if why == "tokens" else "timeout"
    head = "The run used its token budget" if reason == "budget" else "The run reached its time limit"
    st = rc.state
    if st.stage == "survey":
        return _end(rc, "stopped", reason, f"{head} during the survey; nothing was traced.", [], kind="draft")
    if st.stage == "trace":
        with rc.lock, rc.handle.session() as s:
            pk.mark_unfinished(s, rc.run_id, "skipped", "Not started: the run's budget ran out.")
        _advance(rc, "merge")
    _merge_and_check(rc)
    build_check(rc)
    with rc.handle.session() as s:
        skipped = [f"P{r.n} {r.label}" for r in pk.rows(s, rc.run_id) if r.state == "skipped"]
    not_traced = ", ".join(skipped) or "none"
    summary = f"{head}; it merged, checked and built what was traced. Not traced: {not_traced}."
    return _end(rc, "stopped", reason, summary, [], kind="agent")


def _collect_for_stop(rc: PlantRunContext) -> None:
    """Before merge, the register is the finished packages plus what in-flight sub-runs had saved."""
    if _before(rc.state.stage, "cloud_check"):
        extra = [(f"P{s.package.n}", list(s.items.values())) for s in list(rc.inflight.values()) if s.items]
        _merge(rc, extra)


def _quiet(fn, rc) -> None:
    try:
        fn(rc)
    except Exception as e:  # noqa: BLE001 - recording a failure must not raise again
        log.error("plant run could not collect its items (%s)", type(e).__name__)


def run_plant(ctx) -> dict:
    rc = build_context(ctx)
    return _guarded(rc, lambda: _package_rerun(rc) if rc.mode == "plant_package" else _full(rc))


def _guarded(rc: PlantRunContext, flow) -> dict:
    """Run `flow` so the run always ends: a budget-out runs the app-only finish under the same guard
    (review fix: a Stop or an error during it must not leave the run "running")."""
    try:
        return flow()
    except BudgetOut as e:
        why = e.why
        return _guarded(rc, lambda: _app_only_finish(rc, why))
    except _Stop as e:
        return _safe_end(rc, e.state, e.reason, e.summary, kind="draft")
    except JobCancelled:
        _quiet(_collect_for_stop, rc)
        _safe_end(rc, "stopped", "user", "Stopped by the operator.", kind="draft")
        raise
    except LlmError as e:
        _quiet(_collect_for_stop, rc)
        return _safe_end(rc, "failed", "provider_error", e.message, kind="draft")
    except Exception as e:  # noqa: BLE001 - never leave a run stuck "running"; fixed text, type name only
        log.error("plant run failed (%s)", type(e).__name__)
        _quiet(_collect_for_stop, rc)
        return _safe_end(
            rc, "failed", None, e.message if isinstance(e, LookError) else INTERNAL, kind="draft"
        )


def _safe_end(rc: PlantRunContext, state: str, reason: str | None, summary: str, *, kind: str) -> dict:
    """`_end`, and if even that raises, settle the run row without a version."""
    try:
        return _end(rc, state, reason, summary, [], kind=kind)
    except Exception as e:  # noqa: BLE001 - the run must still end; type name only
        log.error("plant run could not record its end (%s)", type(e).__name__)
    try:
        with rc.handle.session() as s:
            run = s.get(AssetModelRun, rc.run_id)
            if run.state == "running":
                run.state, run.stop_reason, run.summary = "failed", None, INTERNAL
                run.phase, run.ended_at = "done", datetime.now(UTC)
            model = s.get(AssetModel, rc.model_id)
            if model.live_run_id == rc.run_id:
                model.live_run_id = None
            service.refresh_status(model)
        rc.job.publish("asset_models.changed", {"asset_model_ids": [rc.model_id], "run_id": rc.run_id})
    except Exception as e:  # noqa: BLE001 - nothing more can be done; the startup sweep settles it
        log.error("plant run could not settle its row (%s)", type(e).__name__)
    return {"run_id": rc.run_id, "version": None}


def _package_rerun(rc: PlantRunContext) -> dict:
    """Ruling R10: re-trace the copied packages over the current version, with no orchestrator
    conversation. A re-run adds and updates items; it never deletes."""
    st = rc.state
    if st.stage == "survey":
        base = _base_spec(rc)
        st.site = base.site.model_dump(mode="json") if base.site is not None else None
        st.environment = [e.model_dump(mode="json") for e in base.environment]
        _advance(rc, "trace")
    _sample_m1_clouds(rc)
    if st.stage == "trace":
        _trace(rc)  # a budget-out starts no new package; in-flight ones wrap up (R8)
        _advance(rc, "merge")
    _merge_and_check(rc, then="build")
    build_check(rc)
    with rc.handle.session() as s:
        labels = [f"P{r.n} {r.label} ({r.state})" for r in pk.rows(s, rc.run_id)]
    summary = f"Re-ran {len(labels)} package(s) on version {st.base_version}: " + "; ".join(labels) + "."
    why = rc.budget.exhausted()
    if why:
        return _end(rc, "stopped", "budget" if why == "tokens" else "timeout", summary, [], kind="agent")
    return _end(rc, "finished", None, summary, [], kind="agent")


# ------------------------------------------------------------------ the end
def _owner(part_id: str | None) -> str | None:
    """The item or environment feature an issue names (`<item id>/<part id>` for an item's parts)."""
    return part_id.split("/", 1)[0] if part_id else None


def _drop(spec: AssetSpec, bad: set[str]) -> AssetSpec:
    return spec.model_copy(
        update={
            "items": [i for i in spec.items if i.id not in bad],
            "environment": [f for f in spec.environment if f.id not in bad],
        }
    )


def _drop_blocking(spec: AssetSpec) -> AssetSpec:
    """Amendment I-6: add_version validates only small specs, so validate here whatever the size and
    drop what the blocking errors name (ruling R20). Logs codes and counts only."""
    blocking = validate(spec).blocking
    bad = {o for o in (_owner(e.part_id) for e in blocking) if o}
    if not bad:
        return spec
    codes = Counter(e.code for e in blocking)
    log.warning(
        "plant run dropped %d items or features with blocking errors (%s)",
        len(bad),
        ", ".join(f"{c} {n}" for c, n in sorted(codes.items())),
    )
    return _drop(spec, bad)


def _write_version(rc: PlantRunContext, items, env, kind: str, summary: str) -> int | None:
    src = [{"type": x["type"], "id": x["id"]} for x in rc.sources]
    try:
        spec = _drop_blocking(AssetSpec(site=rc.site(), items=items, environment=env))
    except Exception as e:  # noqa: BLE001 - never lose the run's end; type name only
        log.error("plant run could not check its version (%s)", type(e).__name__)
        return None
    for attempt in (1, 2):
        try:
            row, _job = service.add_version(
                rc.handle,
                rc.job.runner,
                rc.model_id,
                spec,
                kind=kind,
                note=summary,
                source_ids=src,
                run_id=rc.run_id,
            )
            return row.version
        except AppError as e:  # R20: drop the items the validator names, once
            errors = (e.details or {}).get("errors", [])
            bad = {_owner(x.get("part_id")) for x in errors if x.get("code") not in FALLBACK_CODES}
            bad.discard(None)
            if attempt == 2 or not bad:
                log.error("plant run could not write its version (%s)", e.code)
                return None
            log.warning("plant run version rejected (%s); retrying without %d items", e.code, len(bad))
            spec = _drop(spec, bad)
        except Exception as e:  # noqa: BLE001 - never lose the run's end; type name only
            log.error("plant run could not write its version (%s)", type(e).__name__)
            return None
    return None


def _end(rc: PlantRunContext, state: str, reason: str | None, summary: str, questions, *, kind: str) -> dict:
    with rc.lock:
        items = list(rc.store.values())
    env = env_of(rc.state)
    version = _write_version(rc, items, env, kind, summary) if (items or env) else None
    with rc.lock, rc.handle.session() as s:
        pk.mark_unfinished(s, rc.run_id, "skipped", "Not finished: the run ended.")
        run = s.get(AssetModelRun, rc.run_id)
        qs = [*questions, *rc.state.questions, *rc.state.notes][:30]
        run.state, run.stop_reason, run.summary = state, reason, summary
        run.open_questions = [q[:500] for q in qs]
        run.version, run.phase, run.ended_at = version, "done", datetime.now(UTC)
        run.usage = rc.budget.run_usage("done", rc.model_name or "")  # F0's shape (amendment PR-3)
        model = s.get(AssetModel, rc.model_id)
        if model.live_run_id == rc.run_id:
            model.live_run_id = None
        service.refresh_status(model)
    rc.state.stage = "done"
    rc.save()
    rc.job.publish("asset_models.changed", {"asset_model_ids": [rc.model_id], "run_id": rc.run_id})
    log.info("plant run ended %s reason=%s items=%d version=%s", state, reason, len(items), version)
    return {"run_id": rc.run_id, "version": version}
