# S4: Inference and Providers Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the S0 501 stubs for `providers`, `query-runs` and `preannotate` with the real inference subsystem: a provider interface with a local YOLO implementation and two cloud vision implementations (OpenAI, Anthropic), shared tiling with NMS, API keys in Windows Credential Manager, a rate-limited, retrying, resumable query-run job that writes proposal boxes, cost estimates, promotion, and synchronous pre-annotation for the editor.

**Architecture:** `backend/app/providers/` holds the provider interface, tiling, key store and the three providers; `backend/app/inference/` holds the query-run service, the `infer` job and the routes. Cloud providers are called through the official SDKs (`anthropic`, `openai`) with JSON-schema structured output; every provider returns full-image pixel detections labelled with project class names. The `infer` job runs through the S0 job runner, persists each image-tile result as it arrives, and writes `Box` rows with provider provenance and `review_state = unreviewed`. A process-wide GPU lock serialises local inference with S3's training/export jobs.

**Tech Stack:** Python 3.11, FastAPI, SQLAlchemy 2, ultralytics 8.4.154 (pinned), Pillow, numpy, `anthropic` 1.x SDK, `openai` 1.109.1, `keyring` 25, pytest.

**Spec:** `docs/superpowers/specs/2026-09-17-machinery-detection-app-design.md` section 8 (owned) and the pre-annotation paragraph of section 7, plus sections 4, 9, 10 (secrets), 11, 12, 15. Contract: `contract/openapi.yaml` (source of truth; do not edit).

## Global Constraints

- Contract paths carry `/api/v1`; shapes must match `openapi.yaml` (`Provider`, `ProviderList`, `ProviderUpdate`, `ProviderKey`, `ProviderTestResult`, `QueryRun`, `QueryRunCreate`, `QueryRunWithJob`, `QueryRunPage`, `CostEstimate`, `PromoteRequest`, `PromoteResult`, `PreannotateRequest`, `PreannotateResult`, `Box`). Do not edit the contract; report gaps.
- Secrets (spec 2, 10): API keys go into Windows Credential Manager through the `keyring` library (service `machinery-app`, username = provider name). Keys never appear in project folders, app-data files, logs, job logs, test fixtures, error messages or commits. Tests use an in-memory key store; live provider tests read `ANTHROPIC_API_KEY` / `OPENAI_API_KEY` from the environment at runtime and `pytest.skip` when absent (`@pytest.mark.live`, excluded by default).
- Anthropic provider (spec 8): Anthropic Python SDK, Messages API, base64 image input, structured output through `output_config.format` with a JSON schema for the box list, default model `claude-opus-5` (configurable), thinking left at its default (do not send a `thinking` parameter), `max_tokens` 16000, no streaming, no assistant prefill. `stop_reason == "refusal"` -> empty result, and the job log records the refusal category from `response.stop_details` (`category`, `explanation`). Retry on `anthropic.RateLimitError`, `anthropic.APIStatusError` with status >= 500 and `anthropic.APIConnectionError`; never on 4xx.
- OpenAI provider (spec 8): OpenAI Responses API (`client.responses.create`) with an `input_image` data URL and `text={"format": {"type": "json_schema", "name": "boxes", "schema": ..., "strict": True}}`; model name configurable, default `gpt-5` (spec 15: verify the current model name at implementation time with `client.models.list()` when a key is available and note the result in the report). Retry on `openai.RateLimitError`, `openai.APIStatusError` >= 500, `openai.APIConnectionError`.
- Tiling (spec 8) shared by all providers: tile size default 1280, overlap 0.2, provider boxes mapped back to full-image pixels, merged with per-class NMS at IoU 0.5. Local YOLO goes through the same path.
- Query-run job (spec 8): rate limited per provider (requests per minute from provider config), retries with backoff on 429 and 5xx, resumable (each image-tile result persisted as it arrives; finished tiles are skipped), cost estimate = images x tiles x per-provider cost.
- Pre-annotation (spec 7): the project's selected model (`Project.preannotation_model_id`, or the request's `model_id`) runs on an image synchronously at image size 2560 on the GPU with tiling disabled, only if the image has no boxes from that model yet, and writes proposal boxes (`provenance.kind = local_model`, `model_id`, `model_name`, `review_state = unreviewed`).
- Class mapping (spec 8): local model class names map to project classes by exact name and then through the model's `class_aliases`; unmapped classes are dropped. Cloud providers are constrained to the project's class names by the JSON schema (`label` enum) and drop anything else.
- Shared files S4 may touch: `app/providers/**`, `app/inference/**` (owned), `app/jobs/gpu.py` (new), `app/training/jobs.py` (only to acquire the GPU lock around `trainer.train`/`trainer.export`), `app/main.py` (only to create `app.state.keys` and `app.state.provider_config` in `create_app`), `tests/test_contract.py` (`EXPECTED_STUBS` only), `tests/conftest.py` (fixtures only). Nothing else.
- Never write outside the project folder or the app-data folder. Tile crops for cloud calls are built in memory (JPEG quality 90) and are not written to disk; raw provider responses are persisted under `runs/<job_id>/tiles/` with the key-free request metadata.
- Never import `torch`/`ultralytics` at module import time in `app/` (lazy imports inside functions).
- Use the shared interpreter from your worktree's `backend` directory: `E:\Dev\Yolo\app\backend\.venv\Scripts\python.exe -m pytest -q`, `E:\Dev\Yolo\app\backend\.venv\Scripts\ruff.exe check .`. Never install packages; never run `git clean`. TDD in every task; ruff clean; the full suite (about 250 tests, ~70 s) green before each commit.

## Interfaces from S0, S1 and S3 you build on (read these first)

- `app/projects/service.py`: `ProjectHandle` (`folder`, `runs_dir`, `models_dir`, `session()`, `row(s)`), `get_project`.
- `app/db/models.py`: `Image`, `Box`, `Model`, `QueryRun`, `Job`, `Project`.
- `app/jobs/registry.py` / `runner.py`: `register_job_type`, `JobContext` (`params`, `log`, `progress`, `check_cancelled`, `cancelled`, `publish`), `submit`.
- `app/jobs/schemas.py`: `JobOut.from_row`.
- `app/datasets/boxes.py`: box helpers (`BoxOut.from_row` in `app/datasets/schemas.py`); the `Box` row fields for proposals: `provenance_kind`, `model_id`, `provider`, `model_name`, `query_run_id`, `confidence`, `review_state`.
- `app/datasets/images.py`: `get_image(handle, image_id)` and how image files are located (`handle.folder / image.path`).
- `app/training/registry.py`: `get_model(handle, model_id)` -> `Model` (weights at `handle.folder / model.weights_path`, `class_names`, `class_aliases`).
- `app/appdata.py`: `AppData.read_settings()` / `write_settings()` (provider configuration lives under the `"providers"` key of `settings.json`; never keys).
- `app/pagination.py`.

## File structure

```
backend/app/providers/
  __init__.py
  base.py             Detection dataclass, Tiling dataclass, Provider protocol, ProviderError, refusal marker
  tiling.py           make_tiles, crop_tile (PIL), to_full_image, nms_per_class
  schema.py           BOX_LIST_SCHEMA(class_names) for cloud providers, parse_boxes(payload, tile) -> list[Detection]
  keys.py             KeyStore protocol; KeyringKeyStore (service "machinery-app"); MemoryKeyStore (tests)
  config.py           ProviderConfig (name, model_name, requests_per_minute, cost_per_request) with defaults, load/save via AppData
  local_yolo.py       LocalYoloProvider (weights path, class map, imgsz, conf), model cache
  openai_provider.py  OpenAIProvider
  anthropic_provider.py AnthropicProvider
  factory.py          get_provider(kind, handle, model_row | provider_name, keys, config) -> Provider
  router.py           /providers routes (replaces the stub)
backend/app/inference/
  __init__.py
  schemas.py          QueryRunOut, QueryRunCreate, CostEstimate, PromoteRequest/Result, PreannotateRequest/Result
  service.py          estimate, create_query_run, get/list, promote, preannotate
  jobs.py             job "infer": per image/tile loop, rate limit, retries, persistence, Box writes, events
  ratelimit.py        TokenBucket(requests_per_minute)
  router.py           /query-runs and /images/{id}/preannotate routes (replaces the stub)
backend/app/jobs/gpu.py  gpu_lock: threading.Lock shared by local inference, training and export
backend/tests/
  test_tiling.py test_keys_config.py test_providers_router.py test_local_yolo.py test_cloud_providers.py
  test_query_runs.py test_preannotate.py test_providers_live.py fixtures/providers/*.json
```

---

### Task 1: Tiling and NMS (`providers/base.py`, `providers/tiling.py`)

**Interfaces:**
- `@dataclass(frozen=True) Detection: label: str; x: float; y: float; w: float; h: float; confidence: float; raw_ref: str = ""` (full-image pixels).
- `@dataclass(frozen=True) TilingSpec: enabled: bool = True; tile_size: int = 1280; overlap: float = 0.2; nms_iou: float = 0.5`.
- `@dataclass(frozen=True) Tile: index: int; x: int; y: int; w: int; h: int` (pixel window in the full image).
- `make_tiles(width, height, spec) -> list[Tile]`: when `not spec.enabled` or the image fits in one tile, a single tile covering the image; otherwise a grid with stride `tile_size * (1 - overlap)`, last row/column shifted so tiles never exceed the image (tiles at the edge overlap more, never less), deterministic order (row-major).
- `crop_tile(image: PIL.Image, tile) -> PIL.Image`.
- `to_full_image(det_in_tile: Detection, tile) -> Detection` (offsets by the tile origin; clamps to the tile).
- `nms_per_class(dets: list[Detection], iou: float) -> list[Detection]` (greedy, highest confidence first, per label).
- `iou(a, b) -> float`.
- `class Provider(Protocol): name: str; def detect(self, image_path: Path, query: str, classes: list[str], tiling: TilingSpec, *, conf: float, log: logging.Logger) -> list[Detection]` and `class ProviderError(Exception)` with `retryable: bool`.

- [ ] Failing tests: 4000x2667 with 1280/0.2 gives a 4x3 grid (compute the expected origins: stride 1024; x origins 0, 1024, 2048, 2720; y origins 0, 1024, 1387), every tile inside the image and exactly `tile_size` wide/high; 800x600 gives one tile; disabled gives one tile; `to_full_image` offsets; `nms_per_class` keeps the highest of two overlapping same-class boxes (IoU 0.7) and keeps both when classes differ or IoU 0.3; `iou` of identical boxes is 1, disjoint 0. Implement; commit `feat(providers): tiling and nms`.

---

### Task 2: Keys and provider configuration

**Interfaces:**
- `keys.py`: `class KeyStore(Protocol): get(provider) -> str | None; set(provider, key); delete(provider)`; `KeyringKeyStore(service="machinery-app")` using `keyring.get_password/set_password/delete_password` (import keyring lazily; `delete` of a missing key is a no-op); `MemoryKeyStore` (dict).
- `config.py`: `@dataclass ProviderConfig: name: str; model_name: str; requests_per_minute: int = 30; cost_per_request: float = 0.02`; `DEFAULTS = {"openai": ProviderConfig("openai", "gpt-5"), "anthropic": ProviderConfig("anthropic", "claude-opus-5")}`; `ProviderConfigStore(appdata)` with `get(name)`, `update(name, **fields)`, `all()`; persisted under `settings.json["providers"][name]`.
- `app/main.py`: in `create_app`, `app.state.keys = KeyringKeyStore()` and `app.state.provider_config = ProviderConfigStore(AppData(settings.data_dir))`; tests override `app.state.keys = MemoryKeyStore()` in a fixture (`conftest.py`: autouse fixture `memory_keys(app)`).
- `providers/router.py`: `GET /providers` (`{items: [Provider]}` with `has_key`), `PATCH /providers/{provider}`, `PUT /providers/{provider}/key` (204; `api_key` min length 1; never logged), `DELETE /providers/{provider}/key` (204), `POST /providers/{provider}/test` (`{ok, message, model_name}`; without a key `ok=false, message="no API key stored"`; with a key: one cheap call through the provider's `ping()` (Task 5/6), exceptions -> `ok=false` with the exception class and message, never a 500).
- Unknown provider name -> 404 (the contract enum only allows `openai|anthropic`; FastAPI returns 422 for other values, which is fine).

- [ ] Failing tests: list shows both providers with defaults and `has_key false`; PUT key -> 204, list shows `has_key true`, the key never appears in the response, in `settings.json`, or in the app log (`backend.log` under the test data dir); DELETE -> `has_key false`; PATCH model_name and rpm persists across `create_app` on the same data dir; `test` without a key -> `ok false`. Implement; commit `feat(providers): key store, configuration and providers api`.

---

### Task 3: Cloud box schema and parsing (`providers/schema.py`)

**Interfaces:**
- `box_list_schema(class_names: list[str]) -> dict`: `{"type": "object", "properties": {"boxes": {"type": "array", "items": {"type": "object", "properties": {"label": {"type": "string", "enum": class_names}, "x": {"type": "number"}, "y": {"type": "number"}, "w": {"type": "number"}, "h": {"type": "number"}, "confidence": {"type": "number"}}, "required": ["label", "x", "y", "w", "h", "confidence"], "additionalProperties": False}}}, "required": ["boxes"], "additionalProperties": False}` where `x, y, w, h` are normalised to the tile in [0, 1] (top-left origin) and `confidence` in [0, 1].
- `parse_boxes(payload: dict, tile: Tile, class_names: list[str], raw_ref: str) -> list[Detection]`: validates shape, clamps coordinates to [0, 1], drops zero-area boxes and labels outside `class_names`, converts to full-image pixels with `to_full_image`.
- `prompt_for(query: str, class_names: list[str]) -> str`: the instruction text: aerial nadir imagery, find every object matching the query, label each with exactly one of the class names, coordinates normalised to this image tile, return `{"boxes": []}` when nothing matches.

- [ ] Failing tests: schema has the enum and `additionalProperties: false`; `parse_boxes` maps `{x:0.5,y:0.5,w:0.1,h:0.2}` in a tile at (1024, 0) size 1280 to pixels (1664, 640, 128, 256); out-of-range values clamped; unknown label dropped; malformed payload -> `ProviderError(retryable=False)`. Implement; commit `feat(providers): box schema and parsing`.

---

### Task 4: Local YOLO provider and the GPU lock

**Interfaces:**
- `app/jobs/gpu.py`: `gpu_lock = threading.Lock()`; `@contextmanager def hold_gpu(log, what: str)` that logs when it waits more than 1 s.
- `app/training/jobs.py`: wrap `trainer.train(...)` and `trainer.export(...)` in `with hold_gpu(ctx.log, "train")` (only change to that file).
- `local_yolo.py`: `LocalYoloProvider(weights: Path, class_map: dict[str, str], imgsz: int = 1280, device: str = "0")`; `class_map` built by `build_class_map(model_class_names, project_class_names, aliases) -> dict[str, str]` (exact name first, then alias, others dropped); `detect(...)` loads the model once per weights path (module-level cache), and for each tile runs `model.predict(crop, imgsz=tile_size, conf=conf, device=device, verbose=False)` on the PIL crop, maps `names[int(cls)]` through the class map, converts `xyxy` to `x, y, w, h`, offsets to the full image, then `nms_per_class`. Under `hold_gpu`. When `tiling.enabled` is false it predicts the whole image at `imgsz`.
- `ping()` is not needed for local models.

- [ ] Failing tests (no GPU needed for the mapping; `@pytest.mark.gpu` for the real run): `build_class_map({"truck", "car", "person"}, [...8 classes], {"truck": "dump_truck"})` == `{"truck": "dump_truck"}` and an exact-name class maps to itself; a fake `YOLO` (monkeypatched loader) returning two boxes across two tiles yields merged full-image detections; GPU test: `yolo11m.pt` imported into a project, run on one 4000x2667 sample frame with tiling 1280/0.2, `conf=0.1`: returns a list (possibly empty; the COCO model rarely fires on nadir frames), every detection inside the image bounds, and the run takes under 60 s. Implement; commit `feat(providers): local yolo provider and gpu lock`.

---

### Task 5: Anthropic provider

**Interfaces:**
- `AnthropicProvider(api_key: str, model_name: str)` with `client = anthropic.Anthropic(api_key=api_key)` created lazily; `detect(...)`: for each tile, encode the crop as JPEG (quality 90, long side <= tile size) base64, call

```python
response = self.client.messages.create(
    model=self.model_name,
    max_tokens=16000,
    messages=[{
        "role": "user",
        "content": [
            {"type": "image", "source": {"type": "base64", "media_type": "image/jpeg", "data": data}},
            {"type": "text", "text": prompt_for(query, classes)},
        ],
    }],
    output_config={"format": {"type": "json_schema", "schema": box_list_schema(classes)}},
)
if response.stop_reason == "refusal":
    details = response.stop_details
    log.warning("anthropic refused tile %s: category=%s explanation=%s", tile.index, getattr(details, "category", None), getattr(details, "explanation", None))
    return []  # recorded as an empty tile result with refusal metadata
text = next(b.text for b in response.content if b.type == "text")
payload = json.loads(text)
```

  and `parse_boxes(...)`. `stop_reason == "max_tokens"` -> `ProviderError(retryable=False, "output truncated")`. Errors: `anthropic.RateLimitError` -> `ProviderError(retryable=True, retry_after=int(e.response.headers.get("retry-after", "0")) or None)`; `anthropic.APIStatusError` with `status_code >= 500` -> retryable; `anthropic.APIConnectionError` -> retryable; other `anthropic.APIStatusError` (4xx incl. `AuthenticationError`) -> non-retryable with the message (never the key). Refusals are returned as a `TileResult` with `refusal={"category", "explanation"}` so the job log has the category (spec 8).
- `ping() -> str`: `client.messages.create(model=model_name, max_tokens=16, messages=[{"role": "user", "content": "Reply with OK"}])`, returns the model name from the response.
- Adaptive thinking is the model default; do not send a `thinking` parameter. Do not enable server-side fallbacks (spec 8 wants refusals recorded, not rerouted); note it as a possible provider setting in the report.

- [ ] Failing tests with a fake client injected via a `client_factory` parameter (fixtures in `tests/fixtures/providers/anthropic_*.json` recorded by hand from the documented response shape: `content=[{"type": "text", "text": "{\"boxes\": [...]}"}]`, `stop_reason="end_turn"`, plus a refusal fixture with `stop_reason="refusal"` and `stop_details={"category": "...", "explanation": "..."}`): two boxes parsed and mapped; refusal -> empty with the category logged (assert on the captured log); `RateLimitError` -> `ProviderError.retryable`; 401 -> non-retryable and the message does not contain the key. Live test (`@pytest.mark.live`, skipped without `ANTHROPIC_API_KEY`): one 1280 px tile from a sample frame with query "vehicles" returns a list and a valid response shape. Implement; commit `feat(providers): anthropic vision provider`.

---

### Task 6: OpenAI provider

**Interfaces:**
- `OpenAIProvider(api_key, model_name)` with `openai.OpenAI(api_key=...)`; per tile:

```python
response = self.client.responses.create(
    model=self.model_name,
    input=[{"role": "user", "content": [
        {"type": "input_image", "image_url": f"data:image/jpeg;base64,{data}", "detail": "high"},
        {"type": "input_text", "text": prompt_for(query, classes)},
    ]}],
    text={"format": {"type": "json_schema", "name": "boxes", "schema": box_list_schema(classes), "strict": True}},
)
payload = json.loads(response.output_text)
```

  A refusal in the Responses API appears as an output item of type `refusal` (check `response.output` for `item.type == "refusal"` before reading `output_text`) -> empty tile result with `{"category": "openai_refusal", "explanation": item.refusal}`. Error mapping mirrors Task 5 with the `openai` exception classes.
- `ping()`: `client.responses.create(model=model_name, input="Reply with OK")` -> `response.model`.
- Verify the default model name (`gpt-5`) with `client.models.list()` in the live test and record the finding in the report; if it does not exist, pick the current general vision-capable model and report it (the default lives in `providers/config.py` only).

- [ ] Failing tests with a fake client (fixtures `openai_*.json`): boxes parsed; refusal item -> empty; 429 -> retryable; 401 -> non-retryable. Live test skipped without `OPENAI_API_KEY`. Implement; commit `feat(providers): openai vision provider`.

---

### Task 7: Provider factory and provider test endpoint wiring

- `factory.py`: `get_provider(kind, *, handle, keys, config, model_row=None, provider_name=None, project_class_names, imgsz=1280, device="0") -> Provider`; `local_model` builds `LocalYoloProvider` from the registry row; `cloud_provider` requires a key (`ProviderError(retryable=False, "no API key stored for <name>")`) and builds the provider with `config.model_name`.
- Wire `POST /providers/{provider}/test` to `get_provider(...).ping()` with the fake-client hook so the router test can run without network.

- [ ] Failing tests: local factory with aliases; cloud factory without key raises; `test` endpoint with a fake ping returns `ok true` and `model_name`. Implement; commit `feat(providers): factory and provider test`.

---

### Task 8: Query runs: service, job, routes

**Interfaces:**
- `POST /query-runs/estimate` (`QueryRunCreate`): counts tiles per image with `make_tiles(image.width, image.height, tiling)`; `requests = tiles`; `cost_per_request` from the provider config (0 for local); `estimated_cost = requests * cost_per_request`; unknown image ids -> 404.
- `POST /query-runs` (`QueryRunCreate`): validation: `kind=local_model` needs `model_id` (404 unknown); `kind=cloud_provider` needs `provider` and non-empty `query` (422) and a stored key (409 `conflict` "no API key stored"); creates the `QueryRun` row (`model_name` = registry model name or provider config model name, `tiling` from the request or defaults, `conf`), submits job `infer` with `{"query_run_id"}`, responds 202 `QueryRunWithJob`.
- Job `infer` (`run_infer(ctx)`): loads the run; builds the provider through the factory; `TokenBucket(rpm)` for cloud providers; for each image (in the run's order) and each tile: skip if `runs/<job_id>/tiles/<image_id>/<index>.json` exists (resume) or if Box rows for `(query_run_id, image_id)` already cover that tile index (stored in the tile file only, so the file is the source of truth); otherwise call the provider for that single tile (the provider's `detect` accepts a tiling spec; call it with a one-tile spec built from the tile window so the loop controls persistence and rate limiting), with retries: on `ProviderError(retryable=True)` sleep `retry_after or 1, 2, 4, 8, 16` s (max 5 attempts), then record the tile as failed and continue; persist `{"tile": {...}, "detections": [...], "refusal": {...} | null, "failed": bool, "error": str | null, "raw_ref": str}` atomically; after all tiles of an image: NMS over the image's detections, delete any earlier Box rows for `(query_run_id, image_id)` (idempotent re-run), insert Box rows with `provenance_kind` (`local_model` or `cloud_provider`), `model_id`/`provider`/`model_name`/`query_run_id`, `confidence`, `review_state="unreviewed"`; `ctx.publish("boxes.changed", {"image_ids": [image_id]})`; `ctx.progress(done_images / total, f"{done_images} / {total} images, {boxes} boxes")`; `ctx.check_cancelled()` between tiles; local models hold `gpu_lock` per tile (inside the provider). Result `{"query_run_id", "images", "tiles", "boxes", "failed_tiles", "refusals"}`.
- `GET /query-runs` (paginated newest first), `GET /query-runs/{runId}` (`box_count` = count of Box rows with that `query_run_id`), `POST /query-runs/{runId}/promote` (`min_confidence` default 0): sets `accepted` + `reviewed_at` on the run's `unreviewed` boxes with `confidence >= min_confidence`, sets `promoted_at`, returns `{query_run, accepted}`; publishes `boxes.changed` with the affected image ids.
- Resumability note for the report: with no re-run endpoint in the contract, "restart" means a new `POST /query-runs` with the same parameters; document that finished tiles are reused only within the same job folder, and propose a `resume` endpoint as a contract gap if the goal owner wants cross-run reuse.

- [ ] Failing tests using a `FakeProvider` registered through a monkeypatched factory (returns deterministic detections per tile, can raise retryable errors N times, can refuse): estimate counts tiles for the 20-frame sample (4000x2667 -> 12 tiles each -> 240 requests, cost 4.8 at 0.02); create validates (missing key -> 409, missing query -> 422, unknown model -> 404); the job writes proposal boxes with cloud provenance and `unreviewed`, publishes `boxes.changed`, and `GET /images?has_pending=true` lists them; a retryable failure twice then success yields the boxes (assert the sleeps are patched to zero); a permanent failure on one tile marks `failed_tiles == 1` and the job still succeeds; refusals counted; cancellation mid-run leaves persisted tiles and the job `cancelled`; a second job on the same run folder (call `run_infer` again with a context pointing at the same job id) skips persisted tiles (assert the provider is called only for the missing ones); promote with `min_confidence 0.5` accepts only the confident boxes and sets `promoted_at`; rate limiter: `TokenBucket(60)` allows 60 immediately and blocks the 61st for about a second (patch `time`). Implement; commit `feat(inference): query runs, infer job, promote`.

---

### Task 9: Pre-annotation endpoint

**Interfaces:**
- `POST /images/{imageId}/preannotate` (`PreannotateRequest` optional: `model_id`, `imgsz` default 2560, `conf` default 0.25): resolves the model (`model_id` or `Project.preannotation_model_id`; 422 `validation_error` "no pre-annotation model selected" when neither); 404 unknown image/model; if Box rows exist with `provenance_kind="local_model"` and that `model_id` on the image -> `skipped: true` with those boxes; otherwise runs `LocalYoloProvider` with `TilingSpec(enabled=False)` at `imgsz`, under `gpu_lock`, in the request thread (synchronous; FastAPI runs sync endpoints in the threadpool), writes proposals (`model_id`, `model_name`, `query_run_id=None`), returns `{skipped: false, model_id, items}`.

- [ ] Failing tests with the fake YOLO loader: first call writes two proposals and returns them; second call `skipped: true` with the same boxes; no model selected -> 422; explicit `model_id` overrides the project setting; GPU test: yolo11m on one sample frame at 2560 completes under 30 s and returns a list. Implement; commit `feat(inference): synchronous pre-annotation`.

---

### Task 10: Retire the stubs, contract conformance, live tests, smoke script

- `app/providers/router.py` and `app/inference/router.py` contain no `add_stubs`; `tests/test_contract.py` `EXPECTED_STUBS` becomes empty (delete the 501 branch's stub set or leave an empty set with a comment). Schemathesis now hits every endpoint: any 500 fails, so unknown ids -> 404, invalid bodies -> 422, missing keys -> 409.
- `tests/test_providers_live.py`: `@pytest.mark.live` tests for both providers (skip without the env keys); run them once if the keys are present in your environment and paste the output in the report; if absent, say so.
- `backend/scripts/smoke_query.py`: CLI against a dev backend: set a key from an environment variable (never from an argument), run a cloud query on N images, print progress and promote. No tests.
- Run the full suite three times, ruff, and the GPU tests (`-m gpu`); commit `test(inference): retire stubs, contract on real endpoints, live tests`.

---

## Self-review checklist

- Spec 8 coverage: provider interface (T1), LocalYolo with alias mapping (T4), OpenAI (T6), Anthropic with refusal handling (T5), shared tiling + NMS (T1), rate limit/retry/resumable job (T8), cost estimate (T8), promotion (T8). Spec 7 pre-annotation (T9). Spec 10 secrets via keyring (T2). Contract endpoints all routed (T10).
- Signatures identical across tasks: `Detection`, `TilingSpec`, `Tile`, `Provider.detect(image_path, query, classes, tiling, *, conf, log)`, `ProviderError(retryable, retry_after)`, `get_provider(...)`, `box_list_schema`, `parse_boxes`, `hold_gpu`.
- No task imports torch/ultralytics/anthropic/openai at module import time in `app/`.
