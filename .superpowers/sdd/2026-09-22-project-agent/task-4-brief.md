### Task 4: Dispatch, selectors and the tool registry

**Files:**
- Create: `backend/app/project_agent/dispatch.py`, `backend/app/project_agent/tools.py`
- Test: `backend/tests/test_project_agent_tools.py`

**Interfaces:**
- Consumes: `ToolSpec` from history; `clean_schema` from `llm.py` (if T3 has not landed yet, implement `clean_schema` in `tools.py` as a private helper named `_clean_schema` and T5 will reconcile — do NOT create llm.py).
- Produces:

```python
# dispatch.py
class ApiCallError(Exception):
    status: int; code: str; message: str      # from the Error envelope
class ApiCaller:
    def __init__(self, app, token: str, project_id: str): ...
    async def call(self, method: str, path: str, *, json=None, params: dict | None = None) -> Any
        # path is relative to /api/v1/projects/{project_id} when it starts with "/" and is not "/api/...";
        # absolute when it starts with "/api/". Returns parsed JSON (None for 204). Raises ApiCallError for >= 400.
    async def fetch_bytes(self, path: str, params: dict | None = None) -> bytes
class ImageSelector(BaseModel):  # extra="forbid"
    image_ids: list[str] | None = Field(None, max_length=200)
    source_id: str | None = None; labeled: bool | None = None; has_pending: bool | None = None
    search: str | None = None
    sort: Literal["path", "capture_time", "created_at", "box_count", "pending_count"] = "path"
    order: Literal["asc", "desc"] = "asc"
    offset: int = Field(0, ge=0); limit: int = Field(100, ge=1, le=5000)
async def resolve_selection(api: ApiCaller, sel: ImageSelector) -> list[str]
    # image_ids given → verify via listImages?ids=... and return the found ids in given order.
    # else page GET /images with the filters, limit=200, following next_cursor, skipping `offset`, stopping at `limit`.
```

The in-process client: `httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://agent.local", headers={"Authorization": f"Bearer {token}"}, timeout=60)`. Create one per `ApiCaller` lazily and close it in `aclose()`; `ApiCaller` is an async context manager.

```python
# tools.py
@dataclass
class ToolContext:
    api: ApiCaller
    project_id: str
    user_texts: list[str]
@dataclass
class ToolOutcome:
    result: str                 # sent to the model; truncated to 8,000 chars by `run_tool`
    summary: str                # one line for the UI, e.g. "Started labeling 500 images"
    is_error: bool = False
    job_ids: list[str] = field(default_factory=list)
    image_id: str | None = None             # view_image: the runner renders it for the model
    navigate: dict | None = None            # {"screen": ..., "image_id": ...}
@dataclass
class Prepared:
    title: str; detail: str; estimated_cost: float | None
    args: dict                  # normalised args to execute on approval (e.g. resolved image_ids)
class Tool:
    name: str; description: str; Args: type[BaseModel]; risk: Literal["read", "write", "approval"]
    label: str                  # human verb phrase, e.g. "Label images"
    async def prepare(self, ctx, args: BaseModel) -> Prepared | None  # default: None for read/write; approval tools must return Prepared
    async def run(self, ctx, args: dict) -> ToolOutcome              # args = Prepared.args when approved, else validated model_dump()
REGISTRY: dict[str, Tool]
def tool_specs() -> list[ToolSpec]
async def run_tool(ctx, name: str, raw_args: dict) -> ToolOutcome | Prepared
    # unknown name / validation error / ApiCallError → ToolOutcome(is_error=True, result=<clear message>, summary=...)
    # risk == "approval" or prepare() returns Prepared → return the Prepared (the runner pauses)
    # else run() and truncate result to 8,000 chars
async def execute_approved(ctx, name: str, prepared_args: dict) -> ToolOutcome
def render_image_b64(api: ApiCaller, image_id: str) -> awaitable[str | None]   # GET /images/{id}/file?max_side=1024 → base64
```

Tools (names exact; descriptions written for the model, saying what the tool does and its limits). Read the contract for each wrapped route's body/response shape. Results are compact JSON strings or short text, never whole objects when a summary suffices:

| name | risk | wraps |
| --- | --- | --- |
| `get_project` | read | GET project + GET stats → name, classes (id, name), counts |
| `list_sources` | read | GET sources (≤ 50) |
| `find_images` | read | selector → `{count, images: [≤50 × {id, file_name, labeled, box_count, pending_count, marked_empty}]}`; `count` is the resolved count (≤ 5000) |
| `get_image` | read | GET image + GET boxes (class names resolved) |
| `view_image` | read | returns `ToolOutcome(image_id=...)`; result text gives size and file name |
| `list_models` | read | GET models |
| `list_starter_models` | read | GET /api/v1/starter-models |
| `list_datasets`, `get_dataset` | read | GET datasets / dataset + stats |
| `list_query_runs` | read | GET query-runs (≤ 20) |
| `list_jobs`, `get_job` | read | GET jobs (≤ 20) / job + log tail 40 |
| `estimate_labeling` | read | selector + labeler → POST query-runs/estimate |
| `update_classes` | write | `add: list[str]`, `rename: list[{from, to}]` → GET project, build the full list keeping ids, PUT classes (colours for new classes from a fixed 8-colour palette cycling) |
| `label_images` | approval only for cloud | selector + `labeler: {kind: local_model, model_id} | {kind: cloud_provider, provider, query}` + `conf` → POST query-runs; `prepare` resolves ids, and for cloud calls estimate and returns Prepared; for local returns None (runs immediately). Result includes query_run_id and job_id; `job_ids=[job_id]` |
| `accept_suggestions` | write | POST query-runs/{id}/promote `{min_confidence}` |
| `undo_accept_suggestions` | write | POST query-runs/{id}/unpromote |
| `review_boxes` | write | POST boxes/review (≤ 500 box ids, action accept/reject/unreview — check the enum in the contract) |
| `mark_images_empty` | write | selector + `empty: bool` → POST images/bulk-mark-empty |
| `create_box`, `update_box` | write | class by name → class_id; POST/PATCH boxes |
| `import_folder` | write | `folder`, `site?` → POST sources; refuse with an error unless `folder` (case-insensitive, slashes normalised) appears in one of `ctx.user_texts` |
| `acquire_starter_model` | write | POST models/acquire-starter |
| `create_dataset` | write | POST datasets |
| `export_results` | write | POST exports |
| `export_model` | write | POST models/{id}/export |
| `update_project` | write | PATCH project (name, preannotation_model_id) |
| `cancel_job` | write | POST jobs/{id}/cancel |
| `wait_for_job` | write | poll GET job every 2 s up to `seconds` (1–60) until not queued/running; returns state, progress, message, result/error |
| `open_screen` | write | no API call; returns `navigate` |
| `train_model` | approval | POST models/train |
| `delete_images` | approval | selector → POST images/bulk-delete |
| `delete_boxes` | approval | box ids (≤ 500) → DELETE each |
| `delete_dataset` | approval | DELETE dataset |
| `delete_model` | approval | DELETE model |

Approval `Prepared.title`/`detail` examples: "Label 500 images with anthropic" / "500 images · 4,000 requests · about $80.00. Suggestions stay unreviewed until you accept them."; "Train yolo-v2 for 50 epochs" / "Dataset v1 · base yolo11n · imgsz 1280"; "Delete 12 images" / "Removes the images and their boxes from the project; originals on disk are not touched."

- [ ] **Step 1: Failing tests** against the real test app (`client`, `app` fixtures; build an `ApiCaller(app, "test-token", project_id)` inside an `anyio`/`asyncio.run` helper — note the TestClient runs the app; for direct ASGITransport calls outside TestClient use `asyncio.run` with the app's lifespan started by entering `TestClient(app)` first so `app.state` is populated). Import images with the `make_jpeg` fixture + `POST sources` and wait for the import job (see `tests/test_import.py` for the helper that waits). Cover: selector paging (create 450 small images? too slow — instead monkeypatch the page size constant `SELECT_PAGE = 200` to 5 and use 12 images), offset/limit, ids; every read tool's output shape; `update_classes` add+rename; `label_images` local model returns ToolOutcome with a job (use a registered model — or assert the 4xx error path when no model exists, and test cloud → `Prepared` with estimate using a key in `MemoryKeyStore`); `import_folder` refusal/acceptance; approval tools return `Prepared`; `execute_approved` for `delete_images`; unknown tool and bad args → error outcomes; truncation to 8,000; `render_image_b64` returns a JPEG ≤ 1024 px.
- [ ] **Step 2: Run** → FAIL. **Step 3: Implement.** **Step 4: Run** → PASS; ruff.
- [ ] **Step 5: Commit** `feat(agent): in-process API dispatch, image selectors and agent tools`.

