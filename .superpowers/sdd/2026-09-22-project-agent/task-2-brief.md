### Task 2: Store, tables, API schemas

**Files:**
- Modify: `backend/app/db/models.py` (append two classes)
- Create: `backend/app/db/migrations/versions/0004_agent.py`
- Create: `backend/app/project_agent/schemas.py`, `backend/app/project_agent/store.py`
- Test: `backend/tests/test_project_agent_store.py`

**Interfaces:**
- Consumes: `app.project_agent.history` types; `ProjectHandle.session()` (context manager yielding a SQLAlchemy `Session`, commits on exit — see `app/projects/service.py`).
- Produces (exact):

```python
# db/models.py
class AgentTurn(Base):
    __tablename__ = "agent_turn"
    id: str (uuid pk, default new_id); state: str; provider: str; model_name: str
    error: str | None; tool_calls: int = 0; created_at: datetime (utcnow); finished_at: datetime | None
class AgentItem(Base):
    __tablename__ = "agent_item"
    id: str pk; seq: int (unique index); turn_id: str (FK agent_turn.id ON DELETE CASCADE, indexed)
    kind: str  # user | assistant | tool
    text: str = ""; tool_name: str | None; tool_call_id: str | None; tool_input: dict | None (JSON)
    tool_status: str | None; tool_summary: str | None; tool_result: str | None
    result_image_id: str | None; job_ids: list (JSON, default []); approval: dict | None (JSON)
    navigate: dict | None (JSON); provider: str | None; provider_payload: Any (JSON, nullable)
    created_at: datetime
```

```python
# project_agent/schemas.py  (pydantic, extra="forbid" on request models)
class AgentTurnCreate: provider: ProviderName; message: str (1..4000)
class AgentApprovalDecision: approve: bool
class AgentApprovalOut: title: str; detail: str; estimated_cost: float | None
class AgentNavigateOut: screen: Literal[home, images, label, review, datasets, models, train, detect, export, settings, editor]; image_id: str | None
class AgentTurnOut: id, state, provider, model_name, error, tool_calls, created_at, finished_at
class AgentItemOut: id, seq, turn_id, kind, text, tool_name, tool_input, tool_status, tool_summary, job_ids, approval, navigate, created_at
class AgentConversationOut: items: list[AgentItemOut]; turn: AgentTurnOut | None
```

```python
# project_agent/store.py — every function takes the ProjectHandle first
ACTIVE_STATES = {"running", "awaiting_approval"}
def create_turn(handle, provider: str, model_name: str) -> AgentTurnOut
def get_turn(handle, turn_id: str) -> AgentTurnOut            # raises app.errors.not_found("agent turn", id)
def active_turn(handle) -> AgentTurnOut | None                # newest turn in ACTIVE_STATES
def update_turn(handle, turn_id: str, **fields) -> AgentTurnOut
def add_item(handle, turn_id: str, kind: str, **fields) -> AgentItemOut   # assigns seq = max+1
def update_item(handle, item_id: str, **fields) -> AgentItemOut
def get_item(handle, item_id: str) -> AgentItemRow-like dict incl. internal fields (tool_result, provider_payload, result_image_id, tool_call_id)
def pending_approval_item(handle, turn_id: str) -> dict | None   # the tool item with tool_status == "awaiting_approval"
def conversation(handle, limit: int = 200) -> AgentConversationOut   # last `limit` items oldest-first, newest turn
def clear(handle) -> None                                      # raises AppError("conflict", ..., 409) if active_turn
def user_texts(handle) -> list[str]                            # all user item texts (import_folder path check)
def sweep_interrupted(handle) -> int                           # running -> failed "Interrupted when the app closed."; running tool items -> error
def build_history(handle, *, max_items: int = 40, max_chars: int = 60_000,
                  load_image: Callable[[str], str | None] | None = None) -> list[HistoryEntry]
def last_result_image_ids(handle) -> dict[str, str]            # {tool_call_id: result_image_id} for the tool items of the newest tool_results entry
```

`build_history` rules (test each):
1. Take the newest `max_items` items (by seq); drop leading items until the first is a `user` item.
2. `user` → `HistoryEntry("user", text)`. `assistant` → `HistoryEntry("assistant", text, tool_calls=[ToolCall(tool_call_id, tool_name, tool_input) for the tool items that follow it up to the next user/assistant item], provider=item.provider, provider_payload=item.provider_payload)`. The following tool items with status `ok | error | denied` become one `HistoryEntry("tool_results", results=[ToolResult(call_id, name, tool_result or "", is_error=status in {error, denied})])`.
3. Tool items with status `running` or `awaiting_approval` are skipped, and the assistant entry keeps only calls that have a result (a model API rejects a tool call without a result).
4. Only the **last** `tool_results` entry gets `image_jpeg_b64 = load_image(result_image_id)`; older ones append `"\n[The image was shown to you earlier.]"` to the content instead.
5. If total chars (texts + tool results) exceed `max_chars`, replace the oldest tool result contents with `"[Earlier result omitted to save space.]"` until under.

- [ ] **Step 1: Write failing tests** in `backend/tests/test_project_agent_store.py` using the `client`, `project_dir` fixtures to create a project (`POST /api/v1/projects` with `{"name": "A", "folder": str(project_dir), "classes": [{"name": "excavator", "colour": "#ff0000"}]}`) and `app.state.projects.get(project_id)` to obtain the handle (check the exact registry accessor in `app/projects/service.py`). Tests: migration creates tables (and `alembic downgrade` to 0003 drops them); `add_item` seq monotonic; `conversation` limit 200 oldest-first; `clear` 409 while active; `sweep_interrupted`; each `build_history` rule above; `AgentItemOut` never exposes `tool_result`/`provider_payload`.
- [ ] **Step 2: Run** `..\..\..\..\backend\.venv\Scripts\python.exe -m pytest tests/test_project_agent_store.py -q` from the worktree's `backend/` (use the absolute path `E:\Dev\Yolo\app\backend\.venv\Scripts\python.exe`). Expected: FAIL (import errors).
- [ ] **Step 3: Implement** models, migration `0004` (revision "0004", down_revision "0003"; `op.create_table` for both, indexes `ix_agent_item_seq` unique, `ix_agent_item_turn`; downgrade drops both), schemas, store.
- [ ] **Step 4: Run** the new tests and `tests/test_db.py`; PASS. Run `ruff check` and `ruff format` on the new files.
- [ ] **Step 5: Commit** `feat(agent): project agent tables, store and history builder`.

