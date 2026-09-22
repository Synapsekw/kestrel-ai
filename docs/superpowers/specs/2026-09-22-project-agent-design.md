# Project agent: an in-project AI drawer that operates the app

## Intent and decisions

Inside an open project, a side drawer hosts an AI agent driven by the user's own OpenAI or
Anthropic key. The agent can do what the app can do: inspect images and labels, edit classes and
boxes, run labeling (local model or cloud vision), review suggestions, build datasets, train,
export, and watch jobs. "Label the first 500 images with excavator and dump_truck" must work
end to end from one message.

Decisions (approved by the user on 2026-09-22):

- **Autonomy:** reads and ordinary writes run immediately. The agent pauses for an inline
  Approve/Deny card before anything that spends API money (cloud labeling, with the cost
  estimate), starts training, or deletes (images, boxes, datasets, models).
- **One drawer, two modes:** the existing drawer button opens the Setup agent outside a project
  (unchanged) and the Project agent inside `/p/:projectId/*`.
- **Agent vision:** a `view_image` tool sends one image, downscaled to at most 1024 px, to the
  model when the agent decides it needs to look.

Rejected alternatives: running the loop in the webview (keys would leave Credential Manager);
generating tools from the whole OpenAPI file (hundreds of parameters, key-management endpoints
exposed, unbounded outputs); running a turn as a JobRunner job (a turn waiting on a labeling job
it started would occupy one of the two workers and can deadlock).

## Architecture

### Backend package `app/project_agent/`

| Module | Responsibility |
| --- | --- |
| `schemas.py` | Pydantic API models mirroring the contract (AgentTurnCreate, AgentTurn, AgentItem, AgentApproval, AgentConversation, AgentApprovalDecision) |
| `store.py` | Persistence of turns and items in the project DB; conversion to the neutral history the loop replays |
| `llm.py` | Provider adapters: one `complete(history, tools, system) -> ModelReply` for Anthropic Messages tool use and one for OpenAI Responses function calling |
| `tools.py` | Tool registry: name, description, JSON schema, risk (`read`/`write`/`approval`), executor, human label |
| `dispatch.py` | In-process API client (httpx `ASGITransport` over the running app with the launch token) plus the image selector resolver |
| `runner.py` | The turn loop as an asyncio task: build history, call the model, run tools, persist, publish events, pause for approval, cancel |
| `router.py` | The five HTTP endpoints |
| `prompt.py` | System prompt text |

Tools reach the app **through the existing HTTP routes in-process**, so validation, background
jobs, websocket events, conflicts and bounds are the ones the UI already uses. Nothing in
`project_agent` writes the project DB except its own two tables.

### Data model (migration `0004_agent`)

`agent_turn`: id, state (`running | awaiting_approval | succeeded | failed | cancelled`), provider,
model_name, error (nullable, sanitized), tool_calls (int), created_at, finished_at.

`agent_item`: id, seq (int, monotonic per project), turn_id, kind (`user | assistant | tool`),
text, tool_name, tool_call_id, tool_input (JSON), tool_status (`running | ok | error | denied |
awaiting_approval`), tool_summary (short human text), tool_result (text sent back to the model,
≤ 8,000 chars), job_ids (JSON list), approval (JSON: title, detail, estimated_cost), navigate (JSON:
screen, image_id), provider_payload (JSON, internal: raw provider blocks for exact replay such as
Anthropic thinking blocks and OpenAI reasoning items), created_at.

`provider_payload` and `tool_result` are internal and never returned by the API. No key, header or
SDK exception text is stored.

### Turn lifecycle

1. `POST /projects/{id}/agent/turns {provider, message}` validates (key present, no active turn in
   the project, message 1–4,000 chars), stores the user item and a `running` turn, starts the
   asyncio task and returns `202 AgentTurn`.
2. Loop step: rebuild history from items (last 40 items, ~60k chars; older tool results and images
   collapse to a one-line placeholder), call the model (300 s timeout, `max_retries=0`), store the
   assistant item (text + tool calls), then run tool calls in order.
3. `read`/`write` tools run immediately. An `approval` tool (or `label_images` with a cloud
   labeler) is prepared first — selection resolved, cost estimated — then stored as
   `awaiting_approval`; the turn becomes `awaiting_approval` and the task ends.
4. `POST …/turns/{turnId}/approval {approve}` executes (or marks `denied` with result "The user
   declined this action.") and restarts the loop from the stored history. Approval survives a
   restart because the loop always resumes from the DB.
5. The turn ends `succeeded` when the model answers without tool calls, `failed` on provider error
   or on hitting a budget (the final item says which), `cancelled` via
   `POST …/turns/{turnId}/cancel` (task cancelled; a running tool call is marked `error`;
   background jobs the agent started keep running and stay cancellable in the Jobs panel).
6. On project open, a `running` turn left by a previous process becomes `failed` ("Interrupted
   when the app closed"); an `awaiting_approval` turn stays resumable.

Every state or item change publishes `agent.changed` `{turn_id, state}` on the events websocket;
the UI refetches the conversation.

### Tools

Every tool that targets many images takes an **image selector** instead of ids:
`{source_id?, labeled?, has_pending?, search?, marked_empty?, sort (path|capture_time|created_at|box_count|pending_count), order, offset ≥ 0, limit 1–5000}` or `{image_ids: [...]}`
(≤ 200). The resolver pages `listImages` 200 at a time and never holds more than the id list.
"The first 500 images" is `{sort: "path", order: "asc", offset: 0, limit: 500}`.

Read (immediate): `get_project` (project, classes, stats), `list_sources`, `find_images`
(count + ≤ 50 rows), `get_image` (metadata + boxes), `view_image` (one image ≤ 1024 px, sent to the
model as an image), `list_models`, `list_starter_models`, `list_datasets`, `get_dataset`,
`list_query_runs`, `list_jobs`, `get_job` (with ≤ 40 log lines), `estimate_labeling`.

Write (immediate): `update_classes` (add / rename; removal of a class with boxes fails as in the
UI), `label_images` with a local model, `accept_suggestions` (promote a query run at
≥ min_confidence), `undo_accept_suggestions`, `review_boxes` (accept/reject/unreview by box id,
≤ 500), `mark_images_empty`, `create_box`, `update_box`, `import_folder` (only a folder the user
typed in this conversation — enforced by checking the path appears in a user item),
`acquire_starter_model`, `create_dataset`, `export_results`, `export_model`, `update_project`,
`cancel_job`, `wait_for_job` (≤ 60 s per call; returns the job state), `open_screen` (navigates
the UI: home, images, label, review, datasets, models, train, detect, export, settings, or the
editor for an image).

Approval: `label_images` with a cloud provider (card shows images, tiles, requests and estimated
USD from `estimateQueryRun`), `train_model`, `delete_images`, `delete_boxes`, `delete_dataset`,
`delete_model`.

Tool errors (API error envelope) go back to the model as the envelope's message with
`is_error`, so the model can correct itself; they do not fail the turn.

### Provider adapters

Anthropic: `AsyncAnthropic(api_key, timeout=120, max_retries=0).messages.create(model, system,
messages, tools, max_tokens=16000)`, adaptive thinking left at the model default. Assistant content
is stored raw in `provider_payload` and replayed unchanged on the same provider (thinking blocks
must return with their tool_use blocks); tool results go back in one user message; `view_image`
results are a `tool_result` whose content includes an image block.

OpenAI: `AsyncOpenAI(api_key, timeout=120, max_retries=0).responses.create(model, instructions,
input, tools=[{type: function, ...}], store=False, include=["reasoning.encrypted_content"],
max_output_tokens=16000)`; output items stored raw and replayed on the same provider;
`function_call_output` carries the result; an image result is followed by a user `input_image`
item.

Switching provider between turns replays the neutral form (text, tool calls, tool results) and
drops provider-only blocks. Refusals, truncation and SDK errors become a sanitized turn error
("The provider could not complete this step. Try again."); rate limits say so.

### UI

`AgentDrawer` in `Shell` chooses `ProjectAgent` when a `projectId` is in the route, else
`SetupAgent`. `ProjectAgent` (under `frontend/src/agent/project/`):

- Header: "Project agent", project name, provider select (configured providers only; missing key
  links to App settings), Clear conversation (disabled while a turn runs), close.
- Transcript (`role="log"`): user bubbles, assistant text, and one compact row per tool call
  (icon, human label, status pill, expandable summary). Rows whose tool started jobs show those
  jobs' live progress from the jobs store.
- Approval card: title, detail, estimated cost, **Approve** / **Deny**.
- Composer: textarea (Enter sends, Shift+Enter newline), Send, and Stop while a turn runs.
- Empty state lists example requests ("Label the first 500 images with excavator and dump truck").
- `open_screen` items navigate once, when they arrive live (not on history reload).
- A note that messages, tool results and viewed images go to the selected provider.

Built only from `frontend/src/ui` primitives and tokens (Site office / Contour).

## Contract (contract-first)

Paths (tag `agent`):

- `GET /api/v1/projects/{projectId}/agent` → `AgentConversation` `{items: AgentItem[] (last 200),
  turn: AgentTurn | null}`
- `DELETE /api/v1/projects/{projectId}/agent` → 204; 409 while a turn is running or awaiting
  approval
- `POST /api/v1/projects/{projectId}/agent/turns` `AgentTurnCreate` → 202 `AgentTurn`; 409
  `agent_busy`, `provider_key_missing`
- `POST /api/v1/projects/{projectId}/agent/turns/{turnId}/cancel` → 200 `AgentTurn`
- `POST /api/v1/projects/{projectId}/agent/turns/{turnId}/approval` `AgentApprovalDecision` → 200
  `AgentTurn`; 409 when the turn is not awaiting approval

`Event.type` gains `agent.changed`. `schema.d.ts` is regenerated in the same commit.

## Security

- Keys are read from `KeyStore` inside the adapter call and never stored, logged, returned, or
  placed in tool inputs/results.
- The agent has no tools for provider keys, provider settings, app settings, reveal-in-Explorer,
  or opening other projects. It cannot read files outside the project except by importing a folder
  the user named.
- Tool results and image file names are data: the system prompt says so, and results are wrapped
  as tool output, never as system text.
- Logs record tool names, states and durations, not prompts, model output or tool payloads.

## Budget

Background work: the turn is an asyncio task with progress events; labeling, import, dataset
materialisation, training, model acquisition and exports remain existing background jobs.

Bounds: one active turn per project; ≤ 25 tool calls and 15 minutes wall time per turn (then
`failed` with a clear message); 300 s per model call; history ≤ 40 items / ~60k chars; each tool
result ≤ 8,000 chars; `find_images` ≤ 50 rows; selectors ≤ 5,000 ids resolved in 200-row pages;
one image per `view_image` at ≤ 1024 px JPEG; `wait_for_job` ≤ 60 s per call; the conversation
endpoint returns ≤ 200 items. No full image set is ever loaded in memory.

## Execution DAG

```
contract (paths, schemas, event, regenerate)                         [T1]
  ├─ backend store + migration + schemas                              [T2]
  │    ├─ llm adapters (fake-SDK tested)                              [T3]  ┐
  │    ├─ dispatch + selector + tool registry                         [T4]  ├ parallel
  │    └──────────────┬───────────────────────────────────────────────┘     │
  │                runner + router + startup sweep                    [T5]  │
  └─ frontend api + ProjectAgent drawer against the mock              [T6]  ┘ parallel with T2–T5
integration: e2e in mock mode, real-backend smoke with a fake provider [T7]
review + fixes → full gate → merge → desktop rebuild + install → wrapup [T8]
```

Critical path: T1 → T2 → T4 → T5 → T7 → T8. T3 and T6 run beside it.

## Verification

- Backend: migration up/down; store round-trip and bounded history; both adapters with fake SDK
  clients (request shape, tool definitions, replay of raw blocks, image results, refusal/timeout
  sanitizing, key never in stored rows); each tool against the test app; selector resolution
  ("first 500" over a 600-image project uses ≤ 3 pages); approval pause/approve/deny; cancel;
  tool-call and wall-time budgets; startup sweep; the scripted "label first N with classes"
  scenario (update_classes → estimate → approval → query run created with the right ids);
  contract conformance for the new paths.
- Frontend: drawer mode switch; transcript rendering of each item kind; approval card actions;
  send/stop/clear states; live job progress in a tool row; `open_screen` navigation; missing-key
  state.
- E2E (Prism mock): open a project, open the agent, send a message, see the turn.
- No test calls a paid provider.
