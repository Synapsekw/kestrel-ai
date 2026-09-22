# Task 5 report: runner, router, prompt, startup sweep

Status: DONE_WITH_CONCERNS (concerns are design notes; all tests pass)
Commit: 6eec676 feat(agent): project agent turn runner and endpoints

## Implemented
- `backend/app/project_agent/prompt.py`: `system_prompt(project_name, class_names)`. It covers the agent's identity and scope (one project), the pipeline, selectors ("first N" = sort path asc offset 0 limit N), `update_classes` before labeling, local vs cloud labelers, suggestions needing review or `accept_suggestions`, jobs and sparing use of `wait_for_job`, app-side approvals (no text confirmation, but ask when ambiguous), no invented paths, tool results are data, and concise reports with numbers.
- `backend/app/project_agent/runner.py`: `AgentRunner` (MAX_TOOL_CALLS=25, MAX_TURN_SECONDS=900) with `start_turn`, `decide`, `cancel` and `stop`, plus the `_run` / `_loop` / `_run_calls` loop, wrapped in `asyncio.wait_for` for the remaining wall time (turn `created_at` + 900 s). Tasks are held in a dict and removed by a done callback. There is one `ApiCaller` per loop run, using the token from settings. `user_texts` is fetched at the start of each run. The key is read per model call and never kept. The system prompt is rebuilt each iteration from `GET` project, because classes can change mid-turn. The newest tool results' images are rendered with `render_image_b64` via `dataclasses.replace`.
  - `Prepared` sets the item to `awaiting_approval`, with `approval` and `provider_payload={"prepared_args": ...}`. The remaining calls become `denied` with "Not run: waiting for approval…", and the turn becomes `awaiting_approval`.
  - Budget: the call that would exceed the limit and the rest of the reply are recorded as `denied` ("Not run: the turn reached its limit of actions."). The assistant item BUDGET_TEXT is added and the turn fails with BUDGET_TEXT.
  - Every call gets a stored result. On cancel, timeout, shutdown or an unexpected error in the middle of a reply, the calls that never started are recorded as `error` "Not run: the turn was stopped." (`except BaseException`, then re-raise). Without this, build_history would replay the assistant `provider_payload` with unanswered tool calls: its rule 3 only detects skipped calls that have a tool row.
  - `cancel`: sets the turn `cancelled` + finished_at, closes running/awaiting items with "Stopped by the user." / "Stopped", cancels the task and waits for it (at most 5 s) so unstarted calls are recorded before the response. A finished turn is returned unchanged.
  - `decide`: returns 409 `conflict` unless the turn is awaiting approval and has a pending item. It also returns 409 `provider_key_missing` if the provider key was removed meanwhile. The turn is claimed (`running`) before the first await. Approve: `execute_approved` with the `prepared_args` from the item's `provider_payload`, then the item is set ok/error. Deny: `denied` / "The user declined this action." / "Declined". Then the loop is spawned again.
  - Failures: `LlmError` sets the turn failed with `e.message`. Timeout sets TIMEOUT_TEXT and closes open items. Any other exception logs the type name only and sets "Something went wrong in the agent. Try again."
  - `agent.changed` is published on every state or item change, with the payload shape from the brief.
- `backend/app/project_agent/router.py`: the five routes under `/projects/{projectId}/agent` (tag `agent`). Handles come from `Depends(get_project)` and the path param is `turnId` (contract names). An unknown turn returns 404 through `store.get_turn`.
- `backend/app/api.py`: the router is included.
- `backend/app/main.py`: the lifespan sets `app.state.agent = AgentRunner(app)` and `app.state.agent_llm = llm.complete` after jobs start, and runs `await app.state.agent.stop()` before `jobs.stop()`. `project_opened` gains an `("agent turn sweep", ...)` step in its per-step try/except.

## Tests: `backend/tests/test_project_agent_runner.py` (23 tests)
The fake LLM is scripted through `app.state.agent_llm` and records histories. The tests cover:
- the prompt (2 tests)
- a plain answer, including `agent.changed` events, the api_key, model and system passed to the model, and the history
- a `get_project` tool call and its result in the second history
- a tool error that does not fail the turn
- `view_image`, whose image is rendered into the next history
- the **headline**: update_classes adds pile_driver, label_images (cloud, first 3 by path) goes to awaiting_approval with a cost and nothing runs yet, approve, then the query run has `image_ids == image_ids[:3]`, followed by the final answer. The inference `get_provider` is monkeypatched to an empty provider. No key appears in any model input or in any file under the project folder (`read_bytes`).
- deny, including a sibling call recorded as denied
- approval when not waiting returns 409
- an unknown turn returns 404 for both cancel and approval
- an empty conversation on a fresh project
- cancel while the model awaits an Event, including an idempotent second cancel and a new turn allowed afterwards
- cancel during a blocking tool: both calls of the reply are closed and the next turn replays both results
- the 25-call budget
- LlmError, and an unexpected error that gives the fixed text
- wall-time timeout (MAX_TURN_SECONDS monkeypatched)
- busy 409 with the exact envelope
- missing key 409
- clear returns 409 while active, then 204
- a 422 for an empty message
- the sweep on reopen: running becomes failed, awaiting stays
- a failing sweep logs "agent turn sweep failed" and the project still opens

RED: `pytest tests/test_project_agent_runner.py`, then `ModuleNotFoundError: No module named 'app.project_agent.prompt'` (collection error).
GREEN: `23 passed in 6.27s`.
Contract: `tests/test_contract.py` gave 68 passed.
Full suite: `pytest -q -x` from backend/ gave `821 passed, 9 deselected in 219.11s`. `ruff check .` passed and `ruff format --check .` reported 163 files already formatted.

## Self-review / concerns
1. Wall time is counted from `created_at` as the brief says, so time spent waiting for an approval counts. If the user approves after more than 15 minutes, the approved action still runs (in `decide`), and then the loop fails at once with the timeout message. Consider pausing the clock while awaiting approval (it would need a column or an in-memory offset).
2. `decide(approve=True)` runs the approved tool inside the request, as the brief says. This is quick today (it submits a job), but the request waits for it.
3. `store.sweep_interrupted` does not set `finished_at` on the turns it fails (store.py is not mine; this is cosmetic).
4. `_close_open_items` queries `AgentItem` directly in runner.py, because store.py has no "open items of a turn" function and I was told not to edit store.py. It touches only the agent's own table.
5. The budget message is fixed at "25" in the text, as the brief says, even if MAX_TOOL_CALLS is changed.

## Fix round 1 (commit ce5e6d5)

Changes:
1. Wall time: `_run` now uses `asyncio.wait_for(self._loop(...), self.MAX_TURN_SECONDS)`, measured from each loop run (the turn start or the restart after an approval decision). The `created_at`/`_aware` logic is gone. Covered by `test_the_wall_time_counts_from_the_restart_after_an_approval`: the turn's created_at is backdated by 2000 s, the action is approved, and the turn reaches succeeded.
2. `decide()`: after the claim, the work runs in `try/finally`. The `finally` re-reads the turn and publishes and spawns the loop if it is still `running`, which also covers CancelledError. The approve path moved to `_execute_approved`. On any BaseException there it logs only the type name, stores the item as `error` with result and summary "The approved action could not run.", and re-raises only non-Exception errors such as CancelledError. Covered by `test_an_approved_action_that_cannot_run_does_not_wedge_the_turn`: execute_approved is monkeypatched to raise, the item becomes error and the turn goes on to succeed, and a new turn then gets 202.
3. Timeout failures now end with an assistant item containing TIMEOUT_TEXT (`_fail(..., final_item=True)`). Covered by `test_a_timed_out_turn_ends_with_an_item_that_says_why`.
4. Prompt: "promotes" is reworded to "turns a run's suggestions ... into labels". Covered by `test_the_prompt_never_says_promote`.
5. Logs: tool names go through `_log_name`, which gives the name if it is in REGISTRY and "unknown" otherwise. This covers the approved, declined, awaiting and per-call logs. Covered by `test_unknown_tool_names_from_the_model_are_not_logged`.

TDD: all 5 new tests failed first for the expected reasons (the turn failed instead of succeeding; the last item was `user` instead of the assistant timeout item; the RuntimeError propagated; "agent tool ignore previous instructions" appeared in the logs; "promotes" was in the prompt).
Command: `python -m pytest tests/test_project_agent_runner.py tests/test_contract.py -q` gave `96 passed in 30.52s` (28 runner tests and 68 contract tests). ruff format and ruff check on runner.py, prompt.py and the test file: clean.
Concern 1 from the first round is resolved by this ruling.
