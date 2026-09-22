# Global constraints (verbatim from the plan/spec)

- Contract is final: `contract/openapi.yaml` paths getAgentConversation, clearAgentConversation, startAgentTurn, cancelAgentTurn, decideAgentApproval; schemas AgentTurn, AgentItem, AgentApproval, AgentNavigate, AgentConversation, AgentTurnCreate, AgentApprovalDecision, AgentTurnState, AgentToolStatus; event `agent.changed` payload `{turn_id, state}`. `contract/client/schema.d.ts` is never hand-edited.
- Keys: read only via `app.state.keys.get(provider)`; never store, log, return or put a key in tool input/results/errors.
- Bounds: one active turn per project; ≤ 25 tool calls and 15 minutes wall time per turn; 120 s per model call; history ≤ 40 items / ~60k chars; each tool result ≤ 8,000 chars; `find_images` ≤ 50 rows; selectors ≤ 5,000 ids resolved in 200-row pages; one image per `view_image` at ≤ 1024 px JPEG; `wait_for_job` ≤ 60 s per call; the conversation endpoint returns ≤ 200 items.
- Logs record tool names, states and durations only — never prompts, model output, tool payloads or SDK exception text.
- Hot-path reads bounded; never a full image set in memory. Long work stays a background job.
- A failed startup step (e.g. the agent turn sweep) logs and continues; the app must still open.
- Tools reach the app only through the existing HTTP routes in-process (httpx ASGITransport); project_agent writes only its own two tables.
- Approval gates: cloud labeling (with cost estimate), train_model, delete_images, delete_boxes, delete_dataset, delete_model. Everything else runs immediately. `import_folder` only accepts a folder the user typed in the conversation.
- UI: only `frontend/src/ui` primitives and tokens (check-tokens.mjs); copy says "suggestions" (not proposals) and "accept as labels" (not promote). Setup agent unchanged outside a project.
- No test calls a paid provider.
- Other tasks were built in parallel in the same worktree; judge only this task's files.
