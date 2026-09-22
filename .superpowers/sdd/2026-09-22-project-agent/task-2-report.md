# Task 2 report: store, tables, API schemas

## What was implemented

- `backend/app/db/models.py`: appended `AgentTurn` (`agent_turn`) and `AgentItem` (`agent_item`)
  ORM classes exactly as specified in the brief, with `ix_agent_item_seq` (unique) and
  `ix_agent_item_turn` indexes, and `turn_id` FK `ON DELETE CASCADE`.
- `backend/app/db/migrations/versions/0004_agent.py`: revision `0004`, down_revision `0003`;
  creates both tables and their two indexes; downgrade drops the indexes then both tables (new
  tables, so no cascade-preserving `ALTER` trick is needed the way `0002`/`0003` needed one).
- `backend/app/project_agent/schemas.py`: `AgentTurnCreate`, `AgentApprovalDecision` (both
  `extra="forbid"`), `AgentApprovalOut`, `AgentNavigateOut`, `AgentTurnOut`, `AgentItemOut`,
  `AgentConversationOut` — field sets match `contract/openapi.yaml`'s `AgentTurn`/`AgentItem`
  exactly (verified by a field-set test). Datetimes are plain `datetime` fields, same convention
  as `app/jobs/schemas.py::JobOut`; confirmed pydantic v2 serialises a UTC-aware `datetime` as
  `...Z` (RFC 3339) with no custom encoder needed — matches the contract's
  `"2026-09-22T10:00:00Z"` example.
- `backend/app/project_agent/store.py`: `create_turn`, `get_turn`, `active_turn`, `update_turn`,
  `add_item`, `update_item`, `get_item`, `pending_approval_item`, `conversation`, `clear`,
  `user_texts`, `sweep_interrupted`, `last_result_image_ids`, `build_history` — all as named and
  signed in the brief, every function taking the `ProjectHandle` first.

## Design notes / decisions

- `get_item`/`pending_approval_item` return plain dicts (`{column: value}` over
  `AgentItem.__table__.columns`) so internal columns (`tool_result`, `provider_payload`,
  `result_image_id`, `tool_call_id`) stay reachable for the runner (Task 5) without ever
  going through `AgentItemOut`.
- `add_item`'s `seq` is `max(seq) + 1` across the whole `agent_item` table (project-wide
  monotonic, per spec "seq (int, monotonic per project)"), not per-turn. Verified with a
  cross-turn test.
- `clear()` checks `AgentTurn.state IN ACTIVE_STATES` and raises `AppError("conflict", ..., 409)`
  before deleting; deletes `agent_item` then `agent_turn` explicitly (does not rely solely on the
  DB's `ON DELETE CASCADE`, though that is also on and tested transitively via the migration).
- `sweep_interrupted` only touches turns in state `running` (not `awaiting_approval`, which the
  spec says "stays resumable"); it fails the turn with the fixed message
  `"Interrupted when the app closed."` and marks that turn's `running` tool items `error` with the
  same message/summary. Returns the number of turns swept.
- `last_result_image_ids` scopes to the newest `assistant` item's own `turn_id` and every tool
  item after it by `seq` (there is nothing newer than "the newest assistant item", so an unbounded
  `seq >` is safe and simpler than re-deriving the "next user/assistant" boundary used in
  `build_history`).
- `build_history`: groups items into `(user)` / `(assistant, tool_rows)` chunks, keyed off the
  newest `max_items` items with the window trimmed to start at the first `user` item. Per group,
  only tool items with status in `{ok, error, denied}` become `ToolCall`/`ToolResult` pairs
  (`running`/`awaiting_approval` are dropped from both the assistant's `tool_calls` and the
  `tool_results` entry, per rule 3). Only the *last* group with any resolved tool item gets
  `load_image(result_image_id)` called for entries with a `result_image_id`; earlier ones get
  `"\n[The image was shown to you earlier.]"` appended to their content instead. The char budget
  (rule 5) walks tool results oldest-first and replaces content with
  `store.OMITTED_PLACEHOLDER` until under `max_chars` — `HistoryEntry`/list mutation in place since
  `HistoryEntry` isn't frozen (only `ToolCall`/`ToolResult`/`ToolSpec` are), so results are
  rebuilt via `dataclasses`-style reconstruction (`ToolResult(...)`) rather than mutated in place
  (which frozen dataclasses forbid).
- Used the existing `handle`/`project_id`/`project` fixtures in `tests/conftest.py` (which already
  do `POST /api/v1/projects` + `app.state.projects.get(project_id)`) instead of duplicating that
  setup — same mechanism the brief asked for, already established in the codebase.

## TDD evidence

Implementation and the 33-test suite (31 in the new file + 2 regression) were written together,
then run. First full run was green (no RED-for-the-right-reason step against a broken
implementation, since research and implementation happened before the first test run in this
session). To get genuine falsification evidence instead, I mutated `build_history`'s rule-4 branch
(`is_last_group = idx == last_tool_group_idx` → `is_last_group = False`) and reran the rule-4 test:

```
$ python -m pytest tests/test_project_agent_store.py -k rule4 -q
...
>       assert new_entry.results[0].image_jpeg_b64 == "b64:img-new"
E       AssertionError: assert None == 'b64:img-new'
FAILED tests/test_project_agent_store.py::test_build_history_rule4_only_last_tool_results_gets_image
1 failed, 30 deselected in 10.23s
```

Reverted the mutation, reran:

```
$ python -m pytest tests/test_project_agent_store.py -q
...............................                                          [100%]
31 passed in 3.72s
```

Full suite (new file + regression `test_db.py`):

```
$ python -m pytest tests/test_project_agent_store.py tests/test_db.py -q
.................................                                        [100%]
33 passed in 3.33s
```

`ruff check` / `ruff format --check` on the five files I own:

```
$ python -m ruff check app/db/models.py app/db/migrations/versions/0004_agent.py \
    app/project_agent/schemas.py app/project_agent/store.py tests/test_project_agent_store.py
All checks passed!

$ python -m ruff format --check app/db/models.py app/db/migrations/versions/0004_agent.py \
    app/project_agent/schemas.py app/project_agent/store.py tests/test_project_agent_store.py
5 files already formatted
```

## Files changed

- `backend/app/db/models.py` (modified — appended `AgentTurn`, `AgentItem`)
- `backend/app/db/migrations/versions/0004_agent.py` (new)
- `backend/app/project_agent/schemas.py` (new)
- `backend/app/project_agent/store.py` (new)
- `backend/tests/test_project_agent_store.py` (new, 31 tests)

Committed as `e2e33a8` on `task/project-agent`:
`feat(agent): project agent tables, store and history builder`.

## Self-review findings

- Re-read the full diff before committing (`git diff --stat -- backend/app/db/models.py` showed a
  clean 46-line additive diff; no accidental edits to lines belonging to other tables).
- Confirmed `git branch --show-current` was `task/project-agent` before committing, and staged by
  explicit path (`git add backend/app/db/models.py backend/app/db/migrations/versions/0004_agent.py
  backend/app/project_agent/schemas.py backend/app/project_agent/store.py
  backend/tests/test_project_agent_store.py`) — never `-A`/`.`. Other implementers' untracked files
  in the same worktree (`app/project_agent/dispatch.py`, `app/project_agent/tools.py`,
  `tests/test_project_agent_tools.py`) were left untouched and unstaged, confirmed by `git status`
  before and after the commit.
- Double-checked the "internal fields never leak" requirement two ways: a static check
  (`"tool_result"`/`"provider_payload"` not in `AgentItemOut.model_fields`) and a runtime check
  (`AgentItemOut` instance built from an item with secret `tool_result`/`provider_payload` has no
  such attributes via `hasattr`).
- Verified the RFC 3339 `Z` datetime convention empirically against a bare pydantic `BaseModel`
  with a `datetime` field before committing to "no custom serializer needed" (see TDD evidence
  section notes above; output matched the contract's `"2026-09-22T10:00:00Z"` example exactly).

## Concerns

- None blocking. One thing worth flagging to whoever builds Task 5 (`runner.py`): `add_item`'s
  `seq` assignment does a read-then-write (`max(seq) + 1`) inside one DB session/transaction with
  no explicit row lock; this is safe under the spec's model (one asyncio task drives a project's
  turn sequentially, so there is no concurrent writer for the same project's `agent_item` table),
  but would not be safe if two turns for the same project ever ran concurrently. Nothing in this
  task's scope makes that possible; flagging only so the runner doesn't introduce it later.
- `active_turn`/`conversation`'s "newest turn" query orders by `created_at DESC` with no
  tie-breaker. `created_at` has datetime (not just date) precision from `utcnow()`, so a collision
  is practically impossible in this workload, but there's no secondary sort key (e.g. `id`) if two
  turns were ever created in the same tick. Not observed in testing; noting for completeness.

## Fix round 1 (review findings)

Three findings from the Task 2 review, addressed with TDD (failing test first, then fix).

### 1. Spec deviation — `last_result_image_ids` used the literal newest assistant item

The old implementation picked the newest `kind == "assistant"` item, full stop, and returned `{}`
whenever that item had no tool items after it — which is the *normal* case for the last turn of a
conversation (the model answers in plain text with no more tool calls). `build_history`, however,
picks its last `tool_results` entry by "the newest group that actually resolved a tool call," so
the two disagreed whenever the very last assistant reply was plain text following an earlier
`view_image` call. Fixed `last_result_image_ids` to walk assistant items newest-first and use the
first one whose tool-item group (bounded the same way `build_history` bounds a group: up to the
next `user`/`assistant` item) has at least one item with status `ok`/`error`/`denied`.

**Failing test first:**

```
$ python -m pytest tests/test_project_agent_store.py -k last_result_image_ids_uses_newest_group -q
...
>       assert store.last_result_image_ids(handle) == {"tc1": "img-1"}
E       AssertionError: assert {} == {'tc1': 'img-1'}
1 failed in ...
```

**After the fix:** passes (see full run below).

### 2. Important — `build_history` replayed a stale `provider_payload` for a group with a skipped call

`llm.py`'s adapters (`_anthropic_messages` ~117-118, `_openai_input` ~213-215) replay
`entry.provider_payload` verbatim when it's a list from the same provider, instead of rebuilding
from `entry.tool_calls`. `build_history` already drops a skipped tool call (still
`running`/`awaiting_approval`) from `tool_calls` (rule 3), but was still passing the raw
`row.provider_payload` through unchanged — so the replayed message still named the skipped call's
`tool_use`/`function_call` block with no matching `tool_result`/`function_call_output`, which the
provider's API rejects with a 400. Fixed: `build_history` now sets `provider_payload=None` for the
assistant entry whenever `len(resulted) != len(tool_rows)` (i.e., any tool item in that group was
skipped), which makes the adapters rebuild the message from `text`/`tool_calls` instead — those
only ever list calls that got a result.

**Failing test first (the "keeps payload when nothing skipped" counterpart already passed, since
it's a no-op on old and new code — kept as a regression guard):**

```
$ python -m pytest tests/test_project_agent_store.py -k rule3_drops_provider_payload -q
...
>       assert assistant_entry.provider_payload is None
E       AssertionError: assert [{'type': 'tool_use', 'id': 'tc1'}, {'type': 'tool_use', 'id': 'tc2'}] is None
1 failed in ...
```

**After the fix:** passes (see full run below).

### 3. Important — `build_history`'s window collapsed to `[]` for an oversized turn

A single turn can hold 1 user item + up to 25 × (assistant + tool) = 51 items, more than the
default `max_items` (40). When the newest-40 window held no `user` item at all (all 40 items
belonging to the tail of one oversized turn), the old "drop leading items until the first is
`user`" loop popped every item and returned `[]` — silently erasing the turn's own user message
and desyncing every tool call already sent to the model from its result. Fixed: if the
`max_items`-windowed slice contains no `user` item, `build_history` now re-fetches the whole
conversation from the newest `user` item forward (uncapped by `max_items`), so the current turn is
always kept whole from its user message; the existing char budget (rule 5) still trims tool result
*contents* down to `max_chars`.

**Failing test first:**

```
$ python -m pytest tests/test_project_agent_store.py -k rule1_keeps_whole_turn -q
...
>       assert history[0].role == "user"
E       IndexError: list index out of range
1 failed in ...
```

**After the fix:** passes (see full run below).

### Full verification run after all three fixes

```
$ python -m pytest tests/test_project_agent_store.py -q
...................................                                      [100%]
35 passed in 3.54s

$ python -m pytest tests/test_project_agent_store.py tests/test_db.py -q
.....................................                                    [100%]
37 passed in 3.44s

$ python -m ruff check app/db/models.py app/db/migrations/versions/0004_agent.py \
    app/project_agent/schemas.py app/project_agent/store.py tests/test_project_agent_store.py
All checks passed!

$ python -m ruff format --check app/db/models.py app/db/migrations/versions/0004_agent.py \
    app/project_agent/schemas.py app/project_agent/store.py tests/test_project_agent_store.py
5 files already formatted
```

### Changes

- `backend/app/project_agent/store.py`: rewrote `last_result_image_ids` (finding 1); `build_history`
  gained the no-user-in-window fallback (finding 3) and the `provider_payload` drop-on-skip (finding
  2), plus an expanded docstring covering both.
- `backend/tests/test_project_agent_store.py`: added
  `test_last_result_image_ids_uses_newest_group_with_results`,
  `test_build_history_rule3_drops_provider_payload_when_any_call_skipped`,
  `test_build_history_rule3_keeps_provider_payload_when_all_calls_resulted`, and
  `test_build_history_rule1_keeps_whole_turn_when_it_exceeds_max_items` (35 tests total in the file,
  up from 31).

Committed as `3616be3` on `task/project-agent`:
`fix(agent): correct last_result_image_ids, drop stale provider_payload, keep oversized turns whole`.
Staged by explicit path (`backend/app/project_agent/store.py`, `backend/tests/test_project_agent_store.py`)
only — `backend/app/project_agent/tools.py` was modified concurrently by another implementer in this
same worktree and was left untouched/unstaged, confirmed via `git status` before and after the commit.

### Self-review for this round

- Re-read the full `git diff` for `store.py` before committing; confirmed the diff touches only
  `last_result_image_ids` and `build_history` (plus their docstrings), nothing else.
- Confirmed `git branch --show-current` was `task/project-agent` before committing.
- For each of the three findings, ran the new test in isolation against the pre-fix code to see it
  fail for the stated reason (not a mismatched assertion or a setup error) before writing the fix.
