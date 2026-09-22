# Final review findings — fix all of these (one wave)

Base for this wave: 6d99143. Every fix gets a failing test first where testable.

## Important

1. **Hard kill mid-reply breaks the conversation forever.** Tauri kills the sidecar (`sidecar.rs` `c.kill()`), so `AgentRunner.stop()` never records unstarted calls. After restart, `store.sweep_interrupted` (store.py ~151) only marks existing `running` items `error`; `build_history`'s `any_skipped` (store.py ~311-318) compares against existing rows only, so the raw `provider_payload` (naming tool_use/function_call ids with no result) is replayed → Anthropic 400 / OpenAI "No tool output found" on every later turn.
   Fix: in `sweep_interrupted`, set `provider_payload=None` on the assistant items of the swept turns, and set the turn's `finished_at`. Additionally make `build_history` robust on its own: if a stored provider payload names more tool calls than the group has tool items, drop the payload (neutral replay). Test both (payload with 3 calls, only 1 tool item stored).
2. **Model-chosen `..` id reaches `DELETE /projects/{id}` (forget project).** `tools.py` `_seg` (~126) uses `quote(x, safe="")`; `".."` survives and httpx normalises the dot segment: `/api/v1/projects/P/boxes/..` → `/api/v1/projects/P`. `delete_boxes` (~1330-1349) with `box_ids: [".."]` approved → forget_project.
   Fix: `_seg` raises ToolError for `""`, `"."`, `".."`, and any id containing `/` or `\`; also constrain every id field in the Args models with a pattern `^[A-Za-z0-9_-]{1,64}$` (ids are UUIDs). Test `..` on delete_boxes, update_box, get_image, get_job, delete_dataset.
3. **Approval card dead end.** `runner.py` ~104-105: Deny (and Approve) return 409 `provider_key_missing` when the key is gone; `ProjectAgent.tsx` ~206 shows Stop only while `running`; Clear is disabled while `awaiting`; Send locked → agent unusable until a key is re-added.
   Fix: Deny never needs the key — record the denial; if no key, end the turn (`failed` with the key-missing message) instead of restarting the loop. Approve without a key → still 409 is acceptable. Show Stop while the turn is `awaiting_approval` too (backend cancel handles it). Tests on both sides.
4. **Model timeout ruling not applied.** `llm.py:18` `MODEL_TIMEOUT_S = 120` → set 300 (ledger ruling). Update the timeout test so it no longer depends on the `+ 5` (e.g. module constant `_DEADLINE_S = MODEL_TIMEOUT_S + 5` patched directly). Update the spec's Budget line "120 s per model call" to "300 s per model call".

## Fix-now minors

5. `llm.py` ~117: drop empty text blocks (`{"type":"text","text":""}`) from the stored Anthropic payload (only thinking blocks must round-trip byte-exact). Test.
6. `tools.py` find_images (~529/548): the count is capped by `limit`. Return the true total: first request the page with the filters and `limit=1` to read `ImagePage.total` (check the contract for the field), report `{total, returned, images:[≤50]}`; describe `total` in the tool description. Test with a project of more images than the limit.
7. `llm.clean_schema` is dead code (tool_specs uses `tools._clean_schema`, which is more complete). Delete `llm.clean_schema` and its tests.
8. Contract: add `example: { items: [], turn: null }` to `AgentConversation` in `contract/openapi.yaml`, run `pnpm -C contract check`-equivalent (`pnpm -C contract lint`, `pnpm -C contract generate`) and commit the regenerated `contract/client/schema.d.ts` in the same commit. Then remove the now-unneeded GET /agent route override in `frontend/e2e/project-agent.spec.ts` if it only existed to fake an idle conversation (keep it if it asserts something else).
9. `frontend/src/agent/project/useProjectAgent.ts` ~47: `encodeURIComponent(nav.image_id)` for the editor route.
10. `llm.py` replay check: replay a stored raw payload only when both the provider AND the model name match (store the model name alongside the payload — e.g. in the assistant item's `provider_payload` wrapper or compare with the turn's model_name; choose the least invasive way, keep the neutral fallback). Test.
11. UI: when a succeeded turn's last assistant item has empty text, show "Finished." in its place.
12. `get_project` tool result: include which cloud providers have a key (`GET /api/v1/providers` → `has_key`, never the key) so the model can pick a labeler without a failing prepare. Add one prompt line: prefer a registered local model whose classes match; otherwise a cloud provider that has a key.
13. `tools.py` ~910: `summary.capitalize()` lower-cases class names → upper-case only the first character.
14. `tools.py` ~1701: replace `assert isinstance(...)` with an error outcome.
15. Labeler schema: emit `anyOf` instead of `oneOf` for the discriminated union in the cleaned schema (safer for OpenAI function parameters).

## Gate after the wave (run all, report output)

From the worktree:
- `pnpm -C contract lint` and `pnpm -C contract generate` then `git diff --exit-code -- contract/client/schema.d.ts` after committing
- backend: `E:\Dev\Yolo\app\backend\.venv\Scripts\python.exe -m ruff check .`, `-m ruff format --check .`, `-m pytest -q`
- `pnpm -C frontend lint`, `pnpm -C frontend test`, `pnpm -C frontend build`
- `pnpm -C frontend e2e` (check ports 1420/4010 free first; never kill another process — report instead)
