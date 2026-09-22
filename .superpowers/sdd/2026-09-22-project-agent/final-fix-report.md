# Final fix wave: report

Base 6d99143 → HEAD c80b20d on `task/project-agent`. Status: **DONE**. All 15 findings fixed, each with a covering test written first and seen failing (RED) before the fix. The full gate is green.

## Commits

| SHA | Subject |
| --- | --- |
| c5277b5 | fix(agent): a hard kill no longer breaks the conversation |
| 82dafab | fix(agent): tool ids cannot walk to another route, and tool result fixes |
| 5d64b76 | fix(agent): 300 s model calls, model-bound payload replay, no empty text blocks |
| 2c09f63 | fix(agent): denying an approval never needs the provider key |
| 27c5089 | fix(agent): Stop while a card waits, Finished. on an empty answer, encoded editor route |
| c80b20d | fix(contract): AgentConversation example is an idle conversation |

## Per finding

### 1. A hard kill mid-reply breaks the conversation (Important)
- `backend/app/project_agent/store.py:152` `sweep_interrupted` now stamps `finished_at` on each swept turn and sets `provider_payload = None` on the swept turns' assistant items (`:178`).
- `store.py:377` `_payload_matches` checks the payload on its own: the set of call ids a list payload names (Anthropic `tool_use.id`, OpenAI `function_call.call_id`) must equal the resulted tool items' ids. If they differ, `build_history` drops the payload and replays neutrally. A payload that is not a list is never replayed by an adapter, so it passes.
- Tests in `tests/test_project_agent_store.py`:
  - `test_sweep_interrupted_drops_raw_payloads_and_finishes_the_turn`: payload with 3 calls, 1 running tool item.
  - `test_build_history_drops_payload_naming_more_calls_than_stored`: Anthropic, 3 calls, 1 stored result, no sweep.
  - `test_build_history_drops_openai_payload_naming_more_calls_than_stored`.
- RED: 3 failed. GREEN: passing.

### 2. A `..` id reached `DELETE /projects/{id}` (Important)
- `tools.py:133` `_seg` raises `ToolError` for `""`, `"."`, `".."`, non-strings, and any id containing `/` or `\`.
- `dispatch.py:23` adds `ID_PATTERN = ^[A-Za-z0-9_-]{1,64}$` and an `Id` annotated type.
- The pattern is applied to every id field:
  - `ImageSelector.image_ids` / `source_id`
  - `LocalLabeler.model_id`, `ImageIdArgs`, `DatasetIdArgs`, `JobIdArgs`, `AcceptArgs` / `RunIdArgs.query_run_id`
  - `ReviewArgs.box_ids`, `CreateBoxArgs.image_id`, `UpdateBoxArgs.box_id`, `ExportModelArgs.model_id`
  - `UpdateProjectArgs.preannotation_model_id`, `WaitArgs.job_id`, `OpenScreenArgs.image_id`
  - `TrainArgs.dataset_id` / `base_model_id`, `DeleteBoxesArgs.box_ids`, `ModelIdArgs`
- `delete_boxes.run` (`tools.py:1377`) validates every id before it deletes any, which covers approved args that bypass `Args`.
- Tests in `tests/test_project_agent_tools.py`:
  - `test_seg_refuses_dot_segments_and_separators` (6 cases) and `test_seg_keeps_a_uuid`.
  - `test_a_dot_segment_id_is_rejected_before_any_request`: delete_boxes, update_box, get_image, get_job, delete_dataset, view_image, find_images with `a,b`, and a label_images local model. Each case also asserts the project still exists.
  - `test_an_approved_delete_boxes_with_a_dot_segment_never_reaches_the_project`.
- RED confirmed the bug was real: before the fix, update_box `..` PATCHed the project itself and delete_dataset `..` GET-ed the project (KeyError on `path`).

### 3. The approval card could become a dead end (Important)
- Backend, `runner.py:105` / `:121`: `decide(approve=False)` goes to the new `_deny`. It records the denial with no await, so a second decision still gets 409. With a key, it restarts the loop as before. Without a key, it ends the turn `failed` with `KEY_MISSING` and `finished_at`, and publishes. Approve without a key is still 409 `provider_key_missing`.
- Frontend:
  - `useProjectAgent.ts:245`: `stop()` is allowed while `busy || awaiting`.
  - `ProjectAgent.tsx:207`: Stop is shown while `a.busy || a.awaiting`.
- Tests:
  - `test_denying_without_a_key_records_the_denial_and_ends_the_turn` checks: 200 with `failed`, the error text, `finished_at`, the card `denied`, the model not called again, and Clear then works.
  - `test_approving_without_a_key_is_still_refused`.
  - `ProjectAgent.test.tsx` "offers Stop while a card waits…" (posts `/cancel`).

### 4. The model timeout ruling was not applied (Important)
- `llm.py:17` sets `MODEL_TIMEOUT_S = 300`, and `:19` adds `_DEADLINE_S = MODEL_TIMEOUT_S + 5`, which `complete` uses.
- `test_wall_clock_deadline` now patches `_DEADLINE_S` directly. `test_anthropic_request_shape` asserts 300 and `_DEADLINE_S > MODEL_TIMEOUT_S`.
- The spec (`docs/superpowers/specs/2026-09-22-project-agent-design.md` lines 66 and 182) now says 300 s.

### 5. Empty Anthropic text blocks in the stored payload
- `llm.py:118` filters `{"type":"text","text":""}` out of the stored payload. All other blocks, including thinking, are kept byte-exact.
- Test: `test_anthropic_payload_drops_empty_text_blocks`.

### 6. `find_images` reported a count capped by `limit`
- `tools.py:~370-395`:
  - For a filter selection, one extra `GET /images` with the same filters and `limit=1` reads `ImagePage.total`.
  - For an explicit id list, the total is the number of resolved ids.
  - The result is `{total, selected, returned, images[≤50]}`. `selected` is the selection's size after offset/limit, which is what the old `count` meant.
- The tool description explains `total`. The summary says "Found N images[, selected M]".
- Test: `test_find_images_reports_the_true_total_beyond_the_limit` (12 images, limit 3). The four existing tests that used `count` now use `selected`.

### 7. Dead `llm.clean_schema`
- Deleted `clean_schema`, `_clean`, `_LITERAL_KEYS` and the `copy` import from `llm.py`, along with their 4 tests. `tools._clean_schema` is still covered by `test_tool_specs_are_self_contained_json_schemas`.

### 8. Contract example and the e2e override
- `contract/openapi.yaml:2300` adds `example: { items: [], turn: null }` on `AgentConversation`. `contract/client/schema.d.ts` was regenerated and committed in the same commit (c80b20d).
- `frontend/e2e/project-agent.spec.ts`: removed the `page.route` override. It only faked an idle conversation. The e2e test passes without it.

### 9. The editor route did not encode the image id
- `useProjectAgent.ts:48` now uses `encodeURIComponent(nav.image_id)`.
- Test: `ProjectAgent.test.tsx` `screenRoute` › "encodes the image id of an editor route".

### 10. Replay was not bound to the model
- Least invasive route chosen:
  - `history.py:48` adds `HistoryEntry.model: str | None = None`. The default keeps it backward compatible.
  - `store.build_history` fills `model` from each assistant item's turn `model_name` (`store.py:345`, one bounded `IN` query).
  - `llm.py:78` `_replayable` requires the provider **and** the model to match before replaying a raw payload. Otherwise the neutral fallback is used.
- Tests:
  - `test_a_payload_from_another_model_is_not_replayed[anthropic|openai]`.
  - `test_build_history_names_the_model_that_wrote_each_assistant_item`.
  - The existing replay tests now carry `model="the-model"`.

### 11. An empty final answer showed nothing
- `Transcript.tsx`: now takes a `turn` prop. If that turn `succeeded` and its last assistant item has empty text, it renders "Finished." (`:37`).
- Tests: "says Finished. when a succeeded turn ends on an empty answer" and "does not say Finished. while the turn is still running".

### 12. `get_project` gave no provider info; prompt line added
- `tools.py:~296-325`: `GET /api/v1/providers` → `cloud_providers: [{name, has_key}]`, with booleans only and never a key. The description was updated.
- `prompt.py:29` adds: prefer a registered local model whose classes match; otherwise use a cloud provider that has a key.
- Tests:
  - `test_get_project_lists_the_cloud_providers_with_a_key`, which also asserts the key string is not in the result.
  - `test_the_system_prompt_says_how_to_pick_a_labeler`.

### 13. `capitalize()` lower-cased class names
- `tools.py:781` now upper-cases only the first character.
- Test: `test_update_classes_summary_keeps_the_case_of_class_names`. It adds and renames `Crawler_Crane`, because `Dump_Truck` already existed case-insensitively in the fixture project.

### 14. An `assert` in `execute_approved`
- `tools.py:1575`: a non-`ToolOutcome` result now logs the tool name only and returns an error outcome.
- Test: `test_execute_approved_turns_a_non_outcome_into_an_error`.

### 15. `oneOf` → `anyOf`
- `tools.py:1512`: `_clean_schema` emits `oneOf` as `anyOf`, and still drops `discriminator`.
- Test: `test_the_labeler_union_is_any_of_not_one_of` (label_images and estimate_labeling).

## Gate (from the worktree, after the last commit)

| Command | Result |
| --- | --- |
| `pnpm -C contract lint` | No results with a severity of 'error' found |
| `pnpm -C contract generate` then `git diff --exit-code -- contract/client/schema.d.ts` | clean (exit 0) |
| `python -m ruff check .` (backend) | All checks passed |
| `python -m ruff format --check .` (backend) | 164 files already formatted |
| `python -m pytest -q` (backend) | 854 passed, 9 deselected in 232.9 s |
| `pnpm -C frontend lint` | eslint clean, Prettier clean, tokens ok |
| `pnpm -C frontend test` | 126 files, 564 tests passed |
| `pnpm -C frontend build` | built (only the existing chunk-size warning) |
| `pnpm -C frontend e2e` | 62 passed (21.1 s). Ports 1420 and 4010 were checked free first |
| `cargo test` | skipped: `frontend/src-tauri/binaries/` is absent in the worktree (no frozen sidecar) |

## Notes and concerns
- Finding 6 names: the finding asked for `{total, returned, images}`. I added `selected` (the selection's size after offset/limit) and kept `returned` as the number of rows shown. Without `selected`, the model would lose the "how many will this act on" number that `count` used to carry.
- Finding 10 changes the shared `history.py` type by adding one optional field with a default. Nothing else in the type changed.
- Finding 3: a Deny without a key returns 200 with state `failed`, and the drawer shows the key-missing error through the existing failed-turn alert. No new assistant item is added.
