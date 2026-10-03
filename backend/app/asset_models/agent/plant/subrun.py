# backend/app/asset_models/agent/plant/subrun.py
"""One package's sub-run (spec §8.2.2). It is a fresh append-only conversation over the package brief,
the catalogue (cached in the system prompt) and the package tools. It runs until one of these:
- finish_package;
- its call or token limit;
- the run's budget wrap-up (ruling R8: at most WRAP_UP_CALLS more calls);
- two replies without a tool call.

A provider error fails only this package."""

from __future__ import annotations

import logging
from dataclasses import dataclass, field

from app.asset_models.agent.plant import prompt_plant as P
from app.asset_models.agent.plant.context import Scope
from app.asset_models.agent.plant.model import call_model
from app.asset_models.agent.plant.packages import PackageWork
from app.asset_models.agent.plant.tools_plant import catalogue_text, execute, specs_for
from app.asset_models.agent.runner import INTERNAL
from app.asset_models.spec import Item
from app.jobs.cancellation import JobCancelled
from app.project_agent.history import HistoryEntry, LlmError, ToolResult

log = logging.getLogger(__name__)
WRAP_UP_CALLS = 3


@dataclass
class PackageResult:
    package_id: str
    n: int
    state: str
    items: list[Item]
    usage: dict
    calls: int
    images: int
    summary: str
    questions: list[str] = field(default_factory=list)


def _result(
    w: PackageWork, scope: Scope, usage: dict, state: str, summary: str, questions=()
) -> PackageResult:
    return PackageResult(
        package_id=w.id,
        n=w.n,
        state=state,
        items=list(scope.items.values()),
        usage=dict(usage),
        calls=scope.calls,
        images=scope.images,
        summary=summary[:2000],
        questions=list(questions)[:10],
    )


def run_package(rc, w: PackageWork) -> PackageResult:
    scope = Scope(name=f"P{w.n}", stage="trace", items={}, package=w)
    rc.inflight[w.id] = scope
    system = P.sub_system(catalogue_text())
    tools = specs_for("package")
    history = [HistoryEntry(role="user", text=P.package_brief(w, rc))]
    usage = {"input_tokens": 0, "output_tokens": 0}
    idle = wrap_calls = 0
    note = None
    try:
        while True:
            rc.check_cancelled()
            if not scope.wrap_up and rc.budget.exhausted():
                scope.wrap_up = True
                history.append(HistoryEntry(role="user", text=P.WRAP_UP))
            if scope.wrap_up:
                wrap_calls += 1
                if wrap_calls > WRAP_UP_CALLS:
                    note = "Closed when the run's budget ran out."
                    break
            if scope.calls >= rc.limits.sub_calls:
                note = f"Stopped at the package limit of {rc.limits.sub_calls} tool calls."
                break
            if usage["input_tokens"] + usage["output_tokens"] >= rc.limits.sub_tokens:
                note = "Stopped at the package token limit."
                break
            reply = call_model(rc, system=system, history=history, tools=tools)
            if reply.usage:
                for k in usage:
                    usage[k] += int(reply.usage.get(k, 0) or 0)
                rc.budget.charge(reply.usage, "trace")
                rc.recorder.usage(rc.budget)
            history.append(
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
                    note = "Ended without finish_package."
                    break
                history.append(HistoryEntry(role="user", text=P.SUB_NUDGE))
                continue
            idle = 0
            results = []
            for call in reply.tool_calls:
                if scope.finished is not None:
                    results.append(
                        ToolResult(
                            call.id, call.name, "Not run: the package already finished.", is_error=True
                        )
                    )
                    continue
                if scope.calls >= rc.limits.sub_calls:
                    results.append(
                        ToolResult(
                            call.id,
                            call.name,
                            "Not run: the package reached its tool-call limit.",
                            is_error=True,
                        )
                    )
                    continue
                scope.calls += 1
                rc.budget.charge_call("trace")
                results.append(execute(rc, scope, call))
            history.append(HistoryEntry(role="tool_results", results=results))
            if scope.finished is not None:
                break
    except JobCancelled:
        raise
    except LlmError as e:  # fixed, user-safe text
        log.info("plant package %s failed on a provider error", scope.name)
        return _result(w, scope, usage, "failed", e.message)
    except Exception as e:  # noqa: BLE001 - one package's bug must not end the run; type name only
        log.error("plant package %s failed (%s)", scope.name, type(e).__name__)
        return _result(w, scope, usage, "failed", INTERNAL)
    fin = scope.finished or {}
    return _result(
        w, scope, usage, "done", fin.get("summary") or note or "Finished.", fin.get("open_questions", [])
    )
