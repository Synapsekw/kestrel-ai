"""The project agent's turn loop: an asyncio task per active turn on the app's own event loop.

A turn replays the stored conversation, asks the model for the next step, runs its tool calls
through the app's own routes and stores every step, until the model answers without tool calls, a
tool needs the user's approval, the user stops it, or a budget runs out. The loop always resumes
from the database, so an approval survives a restart.

Every tool call the model makes ends with a stored result (ok, error or denied) before the next
model call: a provider rejects a history with an unanswered tool call.

Logs carry tool names, states and durations only: never prompts, model output, tool payloads, keys
or exception text.
"""

from __future__ import annotations

import asyncio
import dataclasses
import logging
import time
from datetime import UTC, datetime

from sqlalchemy import select

from app.db.models import AgentItem
from app.errors import AppError
from app.project_agent import store
from app.project_agent.dispatch import ApiCaller
from app.project_agent.history import LlmError, ModelReply, ToolCall
from app.project_agent.prompt import system_prompt
from app.project_agent.schemas import AgentTurnOut
from app.project_agent.tools import (
    REGISTRY,
    Prepared,
    ToolContext,
    ToolOutcome,
    execute_approved,
    render_image_b64,
    run_tool,
    tool_specs,
)

log = logging.getLogger(__name__)

BUSY = "The agent is already working in this project."
KEY_MISSING = "Add this provider's API key in App settings."
NOT_WAITING = "The agent is not waiting for an approval in this turn."
BUDGET_TEXT = "I stopped after 25 actions in one turn. Send another message to continue."
BUDGET_NOT_RUN = "Not run: the turn reached its limit of actions."
TIMEOUT_TEXT = "This turn ran for 15 minutes and was stopped. Background jobs keep running."
FAILED_TEXT = "Something went wrong in the agent. Try again."
WAITING_NOT_RUN = "Not run: waiting for approval of an earlier action. Ask again if still needed."
DECLINED = "The user declined this action."
STOPPED = "Stopped by the user."
NOT_RUN_STOPPED = "Not run: the turn was stopped."
APPROVED_FAILED = "The approved action could not run."
CANCEL_WAIT_S = 5.0


def _now() -> datetime:
    return datetime.now(UTC)


def _log_name(name: str | None) -> str:
    """A tool name the model sent is model output: log it only when it is one of ours."""
    return name if name in REGISTRY else "unknown"


class _TurnEnded(Exception):
    """The turn is no longer running (cancelled from outside); the loop just stops."""


class AgentRunner:
    MAX_TOOL_CALLS = 25
    MAX_TURN_SECONDS = 900

    def __init__(self, app):
        self.app = app
        # Strong references: an asyncio task only weakly referenced by the loop can be collected.
        self._tasks: dict[str, asyncio.Task] = {}

    # ----------------------------------------------------------------- public

    async def start_turn(self, handle, provider: str, message: str) -> AgentTurnOut:
        # No await between the busy check and creating the turn: two requests cannot both pass.
        if store.active_turn(handle) is not None:
            raise AppError("agent_busy", BUSY, 409)
        if not self._has_key(provider):
            raise AppError("provider_key_missing", KEY_MISSING, 409)
        model_name = self.app.state.provider_config.get(provider).model_name
        turn = store.create_turn(handle, provider, model_name)
        store.add_item(handle, turn.id, "user", text=message)
        self._publish(handle, turn)
        self._spawn(handle, turn.id)
        return turn

    async def decide(self, handle, turn_id: str, approve: bool) -> AgentTurnOut:
        turn = store.get_turn(handle, turn_id)
        if turn.state != "awaiting_approval":
            raise AppError("conflict", NOT_WAITING, 409)
        item = store.pending_approval_item(handle, turn_id)
        if item is None:
            raise AppError("conflict", NOT_WAITING, 409)
        if not self._has_key(turn.provider):
            raise AppError("provider_key_missing", KEY_MISSING, 409)
        # Claim the turn before the first await, so a second decision gets the 409 above. From here
        # on the loop is always spawned again (the `finally`), even when the approved call breaks or
        # this request is cancelled: a claimed turn with no task would answer agent_busy forever.
        turn = store.update_turn(handle, turn_id, state="running")
        try:
            if approve:
                await self._execute_approved(handle, item)
            else:
                store.update_item(
                    handle, item["id"], tool_status="denied", tool_result=DECLINED, tool_summary="Declined"
                )
                log.info("agent tool %s declined", _log_name(item["tool_name"]))
        finally:
            turn = store.get_turn(handle, turn_id)
            if turn.state == "running":  # not cancelled while the approved call ran
                self._publish(handle, turn)
                self._spawn(handle, turn_id)
        return turn

    async def _execute_approved(self, handle, item: dict) -> None:
        name = _log_name(item["tool_name"])
        store.update_item(handle, item["id"], tool_status="running")
        self._publish(handle, store.get_turn(handle, item["turn_id"]))
        prepared_args = (item.get("provider_payload") or {}).get("prepared_args") or {}
        started = time.monotonic()
        try:
            async with ApiCaller(self.app, self.app.state.settings.token, handle.id) as api:
                ctx = ToolContext(api=api, project_id=handle.id, user_texts=store.user_texts(handle))
                outcome = await execute_approved(ctx, item["tool_name"], prepared_args)
            self._store_outcome(handle, item["id"], outcome)
        except BaseException as e:  # the type only: the message can carry payloads
            log.error("agent approved tool %s could not run: %s", name, type(e).__name__)
            store.update_item(
                handle,
                item["id"],
                tool_status="error",
                tool_result=APPROVED_FAILED,
                tool_summary=APPROVED_FAILED,
            )
            if not isinstance(e, Exception):
                raise
            return
        log.info(
            "agent tool %s approved: %s in %.1fs",
            name,
            "error" if outcome.is_error else "ok",
            time.monotonic() - started,
        )

    async def cancel(self, handle, turn_id: str) -> AgentTurnOut:
        turn = store.get_turn(handle, turn_id)
        if turn.state not in store.ACTIVE_STATES:
            return turn
        turn = store.update_turn(handle, turn_id, state="cancelled", finished_at=_now())
        _close_open_items(handle, turn_id, STOPPED, "Stopped")
        task = self._tasks.get(turn_id)
        if task is not None and not task.done():
            task.cancel()
            # Let the task record its unstarted calls before answering, so the next turn replays a
            # complete history. A route running in a worker thread can delay this; do not hang on it.
            await asyncio.wait({task}, timeout=CANCEL_WAIT_S)
        log.info("agent turn cancelled")
        self._publish(handle, turn)
        return turn

    async def stop(self) -> None:
        """Cancel every running loop at shutdown. Their turns stay `running` in the database; the
        next project open marks them failed ("Interrupted when the app closed")."""
        tasks = [t for t in self._tasks.values() if not t.done()]
        for t in tasks:
            t.cancel()
        if tasks:
            await asyncio.gather(*tasks, return_exceptions=True)
        self._tasks.clear()

    # ---------------------------------------------------------------- helpers

    def _has_key(self, provider: str) -> bool:
        return bool(self.app.state.keys.get(provider))

    def _publish(self, handle, turn: AgentTurnOut) -> None:
        self.app.state.events.publish(
            {
                "type": "agent.changed",
                "project_id": handle.id,
                "job_id": None,
                "progress": None,
                "message": "",
                "payload": {"turn_id": turn.id, "state": turn.state},
            }
        )

    def _spawn(self, handle, turn_id: str) -> None:
        task = asyncio.create_task(self._run(handle, turn_id), name=f"agent-turn-{turn_id}")
        self._tasks[turn_id] = task

        def done(t: asyncio.Task) -> None:
            if self._tasks.get(turn_id) is t:
                del self._tasks[turn_id]

        task.add_done_callback(done)

    def _fail(
        self,
        handle,
        turn_id: str,
        error: str,
        open_items_text: str | None = None,
        final_item: bool = False,
    ) -> None:
        """Fail a running turn. `final_item` adds an assistant item saying why (spec: a budget
        failure ends with an item that says which budget)."""
        if open_items_text is not None:
            _close_open_items(handle, turn_id, open_items_text, "Stopped")
        turn = store.get_turn(handle, turn_id)
        if turn.state != "running":  # already cancelled: leave it be
            return
        if final_item:
            store.add_item(handle, turn_id, "assistant", text=error)
        turn = store.update_turn(handle, turn_id, state="failed", error=error, finished_at=_now())
        self._publish(handle, turn)

    def _store_outcome(self, handle, item_id: str, outcome: ToolOutcome) -> None:
        store.update_item(
            handle,
            item_id,
            tool_status="error" if outcome.is_error else "ok",
            tool_summary=outcome.summary,
            tool_result=outcome.result,
            job_ids=list(outcome.job_ids),
            result_image_id=outcome.image_id,
            navigate=outcome.navigate,
        )

    # ------------------------------------------------------------------- loop

    async def _run(self, handle, turn_id: str) -> None:
        try:
            # Each loop run (the turn's start, or the restart after an approval decision) gets the
            # full wall time: time the turn spent waiting for the user does not count.
            await asyncio.wait_for(self._loop(handle, turn_id), self.MAX_TURN_SECONDS)
        except asyncio.CancelledError:
            raise  # cancel() or shutdown already decided the turn's state
        except _TurnEnded:
            pass
        except LlmError as e:
            log.info("agent turn failed: provider error")
            self._fail(handle, turn_id, e.message)
        except TimeoutError:
            log.info("agent turn failed: wall time")
            self._fail(handle, turn_id, TIMEOUT_TEXT, open_items_text=TIMEOUT_TEXT, final_item=True)
        except Exception as e:  # never the message: it can carry payloads
            log.error("agent turn failed: %s", type(e).__name__)
            try:
                self._fail(handle, turn_id, FAILED_TEXT, open_items_text=FAILED_TEXT)
            except Exception as inner:
                log.error("agent turn could not be marked failed: %s", type(inner).__name__)

    async def _loop(self, handle, turn_id: str) -> None:
        async with ApiCaller(self.app, self.app.state.settings.token, handle.id) as api:
            ctx = ToolContext(api=api, project_id=handle.id, user_texts=store.user_texts(handle))
            specs = tool_specs()
            while True:
                turn = self._running_turn(handle, turn_id)
                history = store.build_history(handle)
                await self._attach_images(api, handle, history)
                project = await api.call("GET", "")
                system = system_prompt(project["name"], [c["name"] for c in project["classes"]])
                api_key = self.app.state.keys.get(turn.provider)  # read per call, never kept
                if not api_key:
                    raise LlmError(KEY_MISSING)
                reply: ModelReply = await self.app.state.agent_llm(
                    turn.provider,
                    api_key=api_key,
                    model=turn.model_name,
                    system=system,
                    history=history,
                    tools=specs,
                )
                del api_key
                turn = self._running_turn(handle, turn_id)
                store.add_item(
                    handle,
                    turn_id,
                    "assistant",
                    text=reply.text or "",
                    provider=turn.provider,
                    provider_payload=reply.provider_payload,
                )
                if not reply.tool_calls:
                    turn = store.update_turn(handle, turn_id, state="succeeded", finished_at=_now())
                    log.info("agent turn succeeded after %d tool calls", turn.tool_calls)
                    self._publish(handle, turn)
                    return
                self._publish(handle, turn)
                if await self._run_calls(ctx, handle, turn, list(reply.tool_calls)):
                    return

    def _running_turn(self, handle, turn_id: str) -> AgentTurnOut:
        turn = store.get_turn(handle, turn_id)
        if turn.state != "running":
            raise _TurnEnded
        return turn

    async def _attach_images(self, api: ApiCaller, handle, history) -> None:
        """Render the images of the newest tool results (view_image) for the model."""
        ids = store.last_result_image_ids(handle)
        if not ids:
            return
        last = next((e for e in reversed(history) if e.role == "tool_results"), None)
        if last is None:
            return
        for i, result in enumerate(last.results):
            if result.call_id in ids:
                image = await render_image_b64(api, ids[result.call_id])
                last.results[i] = dataclasses.replace(result, image_jpeg_b64=image)

    async def _run_calls(self, ctx: ToolContext, handle, turn: AgentTurnOut, calls: list[ToolCall]) -> bool:
        """Run one reply's tool calls in order. True when the turn stopped (approval or budget)."""
        turn_id = turn.id
        count = turn.tool_calls
        recorded = 0  # calls[:recorded] have a stored item
        try:
            for index, call in enumerate(calls):
                if count >= self.MAX_TOOL_CALLS:
                    _record_unrun(handle, turn_id, calls[index:], "denied", BUDGET_NOT_RUN, "Not run")
                    recorded = len(calls)
                    store.add_item(handle, turn_id, "assistant", text=BUDGET_TEXT)
                    log.info("agent turn failed: tool call budget")
                    self._fail(handle, turn_id, BUDGET_TEXT)
                    return True
                item = store.add_item(
                    handle,
                    turn_id,
                    "tool",
                    tool_name=call.name,
                    tool_call_id=call.id,
                    tool_input=call.input,
                    tool_status="running",
                )
                recorded = index + 1
                count += 1
                turn = store.update_turn(handle, turn_id, tool_calls=count)
                self._publish(handle, turn)

                started = time.monotonic()
                outcome = await run_tool(ctx, call.name, call.input)
                elapsed = time.monotonic() - started
                if self._running_turn_or_none(handle, turn_id) is None:
                    # Cancelled as the tool finished: keep its real result, close the rest.
                    if isinstance(outcome, ToolOutcome):
                        self._store_outcome(handle, item.id, outcome)
                    _record_unrun(handle, turn_id, calls[index + 1 :], "error", NOT_RUN_STOPPED, "Not run")
                    recorded = len(calls)
                    return True

                if isinstance(outcome, Prepared):
                    store.update_item(
                        handle,
                        item.id,
                        tool_status="awaiting_approval",
                        approval={
                            "title": outcome.title,
                            "detail": outcome.detail,
                            "estimated_cost": outcome.estimated_cost,
                        },
                        provider_payload={"prepared_args": outcome.args},
                    )
                    _record_unrun(handle, turn_id, calls[index + 1 :], "denied", WAITING_NOT_RUN, "Not run")
                    recorded = len(calls)
                    turn = store.update_turn(handle, turn_id, state="awaiting_approval")
                    log.info("agent tool %s awaiting approval (%.1fs)", _log_name(call.name), elapsed)
                    self._publish(handle, turn)
                    return True

                self._store_outcome(handle, item.id, outcome)
                log.info(
                    "agent tool %s: %s in %.1fs",
                    _log_name(call.name),
                    "error" if outcome.is_error else "ok",
                    elapsed,
                )
                self._publish(handle, turn)
            return False
        except BaseException:
            # Stopped (cancel, timeout, shutdown) or broken mid-reply: the calls that never started
            # still need a result, or the next model call would replay an unanswered tool call.
            try:
                _record_unrun(handle, turn_id, calls[recorded:], "error", NOT_RUN_STOPPED, "Not run")
            except Exception as e:
                log.error("agent could not record unrun tool calls: %s", type(e).__name__)
            raise

    def _running_turn_or_none(self, handle, turn_id: str) -> AgentTurnOut | None:
        turn = store.get_turn(handle, turn_id)
        return turn if turn.state == "running" else None


def _record_unrun(
    handle, turn_id: str, calls: list[ToolCall], status: str, result: str, summary: str
) -> None:
    for call in calls:
        store.add_item(
            handle,
            turn_id,
            "tool",
            tool_name=call.name,
            tool_call_id=call.id,
            tool_input=call.input,
            tool_status=status,
            tool_result=result,
            tool_summary=summary,
        )


def _close_open_items(handle, turn_id: str, result: str, summary: str) -> None:
    """Mark the turn's running and awaiting-approval tool items as `error` with `result`."""
    with handle.session() as s:
        rows = (
            s.execute(
                select(AgentItem).where(
                    AgentItem.turn_id == turn_id,
                    AgentItem.kind == "tool",
                    AgentItem.tool_status.in_(("running", "awaiting_approval")),
                )
            )
            .scalars()
            .all()
        )
        for row in rows:
            row.tool_status = "error"
            row.tool_result = result
            row.tool_summary = summary
