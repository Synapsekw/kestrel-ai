# S4 — Inference and providers: implementation report

Branch `s4-inference-providers` in `E:\Dev\Yolo\app\.worktrees\s4-inference-providers`, from main `9b4941f`.
Plan: `docs/superpowers/plans/2026-09-18-s4-inference-providers.md`. All ten tasks done, one commit each.

## Commits

| # | Commit | Message |
|---|--------|---------|
| 1 | `a601a81` | feat(providers): tiling and nms |
| 2 | `ee9e4c0` | feat(providers): key store, configuration and providers api |
| 3 | `9fe24f4` | feat(providers): box schema and parsing |
| 4 | `f069eac` | feat(providers): local yolo provider and gpu lock |
| 5 | `e2e5d18` | feat(providers): anthropic vision provider |
| 6 | `f4dcf34` | feat(providers): openai vision provider |
| 7 | `3c46d88` | feat(providers): factory and provider test |
| 8 | `f39c60d` | feat(inference): query runs, infer job, promote |
| 9 | `e77b602` | feat(inference): synchronous pre-annotation |
| 10 | `9552ce4` | test(inference): retire stubs, contract on real endpoints, live tests |

## Final verification

```
$ .venv/Scripts/ruff.exe check .            -> All checks passed!
$ python -m pytest -q   (x3)                -> 356 passed, 9 deselected in 69.48s / 71.43s / 69.82s
$ python -m pytest -m gpu -q                -> 4 passed, 361 deselected in 23.18s
$ python -m pytest -m live -q -rs           -> 5 skipped, 360 deselected in 2.44s
    SKIPPED [2] tests\test_providers_live.py:28: ANTHROPIC_API_KEY is not set
    SKIPPED [3] tests\test_providers_live.py:28: OPENAI_API_KEY is not set
```

Baseline before any S4 work was `252 passed, 1 deselected`; S4 adds 104 default tests, 3 GPU tests and
5 live tests.

**Live tests: not run.** Neither `ANTHROPIC_API_KEY` nor `OPENAI_API_KEY` is set in this environment
(checked with `bool(os.environ.get(...))`, never printed), so both provider live tests and the OpenAI
model-name check skipped. Consequently the default OpenAI model name stays **`gpt-5`** and was *not*
verified against `client.models.list()` — `tests/test_providers_live.py::test_the_default_openai_model_name_exists`
does exactly that check and will fail loudly with the list of served `gpt*` models the first time it is
run with a key. The default lives only in `app/providers/config.py` (`DEFAULTS["openai"]`), so changing it
is a one-line edit, and it is user-editable through `PATCH /api/v1/providers/openai`.

## Per-task notes with RED/GREEN evidence

### Task 1 — tiling and NMS (`providers/base.py`, `providers/tiling.py`)

RED: `pytest tests/test_tiling.py -q` -> `ModuleNotFoundError: No module named 'app.providers.base'`.
GREEN: `12 passed in 0.05s`.

`make_tiles(4000, 2667, TilingSpec())` gives the planned 4x3 grid: x origins `0, 1024, 2048, 2720`,
y origins `0, 1024, 1387`, row-major, every tile exactly `tile_size` and fully inside the image
(the last row/column is shifted back, so edge tiles overlap *more*, never less). `to_full_image`
clamps to the tile before offsetting; `nms_per_class` is greedy per label, highest confidence first.

### Task 2 — key store, provider configuration, `/providers` (`keys.py`, `config.py`, `schemas.py`, `router.py`)

RED: `ModuleNotFoundError: No module named 'app.providers.config'`. GREEN: `10 passed in 1.36s`.

- `KeyringKeyStore` (service `machinery-app`, username = provider) imports `keyring` inside its
  methods; `delete` swallows `PasswordDeleteError`. `MemoryKeyStore` is the test double.
- `ProviderConfigStore` persists under `settings.json["providers"][name]`; defaults
  `openai/gpt-5` and `anthropic/claude-opus-5`, 30 rpm, $0.02 per request.
- The leak test asserts the key is absent from the PUT response, from `GET /providers`, from
  `settings.json` (after forcing a settings write) and from `logs/backend.log`.

### Task 3 — box schema and parsing (`providers/schema.py`)

RED: `ModuleNotFoundError: No module named 'app.providers.schema'`. GREEN: `13 passed in 0.04s`.

`box_list_schema` is a closed object with a `label` enum of the project class names.
`parse_boxes` clamps to `[0, 1]`, drops unknown labels and zero/negative-area boxes, maps to pixels
(`{x:0.5,y:0.5,w:0.1,h:0.2}` in a tile at (1024, 0) size 1280 -> `(1664, 640, 128, 256)`), and turns
any malformed payload into `ProviderError(retryable=False)`. `parse_text` adds the JSON decode step
both cloud providers share.

### Task 4 — local YOLO provider and the GPU lock (`jobs/gpu.py`, `providers/local_yolo.py`)

RED: `ModuleNotFoundError: No module named 'app.jobs.gpu'`. GREEN: `8 passed in 1.53s`;
GPU: `pytest -m gpu -q tests/test_inference_gpu.py` -> `2 passed in 5.14s`.

`build_class_map` prefers exact names, then the model's aliases, and drops the rest (COCO weights in
a machinery project map to exactly `{"truck": "dump_truck"}`, asserted in the GPU test).
`_load` caches one `YOLO` per resolved weights path behind a lock. `app/training/jobs.py` now wraps
`trainer.train(...)` and `trainer.export(...)` in `hold_gpu(ctx.log, ...)` — the only change to that file.
The lock test asserts real serialisation between two threads and the "waited N s" log line.

### Task 5 — Anthropic provider

RED: `11 failed` in `tests/test_cloud_providers.py`. GREEN: `11 passed in 1.06s`.

Request shape asserted against the SDK installed here (`anthropic` 1.6.0, checked in
`.venv/Lib/site-packages/anthropic` rather than from memory): `messages.create(model=..., max_tokens=16000,
messages=[{role: user, content:[image, text]}], output_config={"format": {"type": "json_schema", "schema": ...}})`.
No `thinking` parameter, no `stream`, no assistant prefill — asserted in
`test_anthropic_sends_the_documented_request`. `stop_reason == "refusal"` returns an empty tile with
`stop_details.category` / `.explanation` in the result and in the job log; `max_tokens` is a permanent
error. Retryable: `RateLimitError` (with the `retry-after` header), `APIStatusError >= 500`,
`APIConnectionError`. Permanent: every other 4xx including `AuthenticationError`, and the test asserts the
key never appears in the message.

Fixtures (`tests/fixtures/providers/anthropic_*.json`) are replayed through `anthropic.types.Message.model_validate`,
so an SDK shape change fails here rather than in production.

Server-side fallbacks are deliberately not enabled: spec 8 wants refusals recorded, not rerouted. If the
owner later wants automatic rerouting on a refusal or overload it belongs in `ProviderConfig` as a new
per-provider setting (see "Concerns / suggestions").

### Task 6 — OpenAI provider

RED: `8 failed`. GREEN: `19 passed in 1.14s` (both providers).

Responses API with `input_image` data URL (`detail: high`) and
`text={"format": {"type": "json_schema", "name": "boxes", "schema": ..., "strict": True}}`.

**Deviation from the plan (verified against `openai` 1.109.1):** the plan said a refusal appears as an
*output item* of type `refusal`. In the installed SDK a refusal is a **content part** of type `refusal`
inside the `message` output item (`response.output[0].content[0].refusal`), and `response.output_text` is
then `""`. `_refusal()` checks both shapes, so it is correct either way. An `incomplete` response with
`incomplete_details.reason == "max_output_tokens"` is a permanent "truncated" error, mirroring Anthropic.

### Task 7 — factory and the provider test endpoint

RED: `ModuleNotFoundError: No module named 'app.providers.factory'` (the `get_provider` symbol).
GREEN: `7 passed in 0.60s`.

`get_provider(kind, *, handle, keys, config, model_row, provider_name, project_class_names, imgsz, device)`.
`POST /providers/{provider}/test` answers `ok=false` with `"no API key stored"` when there is no key and
turns any exception into `{"ok": false, "message": "<ExcClass>: <message>"}` — never a 500.

### Task 8 — query runs: service, job, routes

RED: collection error on `app.inference.ratelimit`. GREEN: `27 passed in 5.76s`.

- `POST /query-runs/estimate`: tiles per image from `make_tiles`, `requests = tiles`, cost from the
  provider config (0 for local). 2 frames of 2000x1280 -> 4 tiles, $0.08; the same frames resized to
  4000x2667 -> 24 tiles, $0.48 (i.e. 12 tiles/frame, matching the plan's 20-frame figure of 240/$4.80).
- `POST /query-runs`: 404 unknown model/image, 422 missing `model_id` / `provider` / empty `query`,
  409 `conflict` without a stored key, 202 `QueryRunWithJob`.
- Job `infer`: per image and tile, persists `runs/<job_id>/tiles/<image_id>/<index>.json` atomically with
  `{tile, detections, refusal, failed, error, raw_ref, raw}`; retries `1, 2, 4, 8, 16 s` (or the provider's
  `retry_after`) up to 5 attempts on retryable errors only; per-image NMS, delete-then-insert of the run's
  boxes for that image, `boxes.changed`, progress, `check_cancelled()` between tiles. Cloud runs go through
  `TokenBucket(requests_per_minute)`.
- Tested: cloud provenance + `unreviewed` + `has_pending=true` listing; two retryable failures then success
  (6 provider calls for 4 tiles); one permanently failing tile -> `failed_tiles == 2`, job still `succeeded`;
  refusals counted; cancellation mid-run keeps the two finished tile files and raises `JobCancelled`;
  a second `run_infer` in the same job folder calls only the two previously failed tiles and does not double
  the boxes; promotion at `min_confidence 0.5`; `TokenBucket(60)` passes 60 immediately and sleeps ~1 s for
  the 61st (injected clock, no real waiting).

**Resumability (as the plan asked me to record).** The contract has no re-run or resume endpoint, so
"restart" today means a new `POST /query-runs` with the same parameters, which gets a **new job folder** and
therefore repeats every tile. Finished tiles are reused only when a job runs again against the *same*
`runs/<job_id>/` folder — which is what happens if the process is restarted and the same job is re-driven,
and which the resume test exercises directly. Cross-run reuse would need either a `POST /query-runs/{runId}/resume`
(re-submitting `infer` with the run's original `job_id`) or keying the tile folder on `query_run_id` instead of
`job_id`. The second is a one-line change in `_tile_path` and needs no contract change; I did not make it
because the plan specified the job-folder layout. Flagged as a contract gap below.

### Task 9 — synchronous pre-annotation

RED: `8 failed`. GREEN: `8 passed in 2.32s`; GPU: `4 passed in 23.18s` (whole `-m gpu` suite).

`POST /images/{imageId}/preannotate` resolves `model_id` or `Project.preannotation_model_id`
(422 `validation_error` "no pre-annotation model selected" when neither), 404 for unknown image/model,
returns `skipped: true` with the existing boxes when the image already has `local_model` boxes from that
model, otherwise runs `LocalYoloProvider` with `TilingSpec(enabled=False)` at `imgsz` (default 2560) under
the GPU lock in the request thread and writes `unreviewed` proposals with `model_id` / `model_name` and
`query_run_id = None`. The GPU test runs yolo11m on a real 4000x2667 frame through the API in well under 30 s.

### Task 10 — stubs retired, contract, live tests, smoke script

- `app/providers/router.py` and `app/inference/router.py` contain no `add_stubs`; `grep` for
  `add_stubs|not_implemented` across both packages returns nothing.
- `tests/test_contract.py`: `EXPECTED_STUBS: set[str] = set()`. Schemathesis now exercises all eleven
  previously stubbed operations for real; no 500s.
- `backend/scripts/smoke_query.py`: stores the key from `ANTHROPIC_API_KEY`/`OPENAI_API_KEY` (never from an
  argument), runs the provider test, prints the cost estimate, asks for confirmation, follows `job.progress`
  on the websocket and optionally promotes. `--help` verified; no tests, as planned.
- Dev backend smoke: started with `APP_PORT=8765` (ports 8080/9090 untouched), `GET /api/v1/providers`
  returned both providers with defaults and `has_key: false`, `POST /providers/anthropic/test` returned 200,
  then the process was stopped by PID and port 8765 confirmed free.

## Files changed (39 files, +3589 / -55 against `9b4941f`)

New: `app/providers/{base,tiling,schema,schemas,keys,config,local_yolo,anthropic_provider,openai_provider,factory}.py`,
`app/inference/{schemas,service,jobs,ratelimit}.py`, `app/jobs/gpu.py`, `backend/scripts/smoke_query.py`,
`tests/{test_tiling,test_keys_config,test_box_schema,test_local_yolo,test_cloud_providers,test_providers_router,test_query_runs,test_preannotate,test_inference_gpu,test_providers_live}.py`,
`tests/fixtures/providers/{anthropic,openai}_{boxes,refusal,truncated,ping}.json`.

Rewritten: `app/providers/router.py`, `app/inference/router.py` (the S0 stubs).

Shared files, all within the plan's allowance:
- `app/main.py` — state wiring only: `app.state.keys`, `app.state.provider_config`, and in the lifespan
  `app.state.jobs.keys` / `.provider_config`.
- `app/training/jobs.py` — `hold_gpu` around `trainer.train` and `trainer.export`, nothing else.
- `tests/conftest.py` — the `app` fixture installs a `MemoryKeyStore` (see deviations).
- `tests/test_contract.py` — `EXPECTED_STUBS` only.

## Deviations from the plan, with reasons

1. **Per-tile provider interface.** The plan had the job call `Provider.detect` with a synthetic one-tile
   spec. I added `detect_tile(image, tile, query, classes, *, conf, log, raw_ref)` to the protocol and made
   `detect(image_path, query, classes, tiling, *, conf, log)` the shared loop on top of it (`TiledProvider`
   in `tiling.py`). The job then drives tiles directly, opens each image once instead of once per tile, and
   gets the `TileResult` (with `refusal` and `raw`) it has to persist. `Provider.detect` keeps the exact
   signature the plan specified, so nothing downstream changed.
2. **`TileResult.raw`** was added so the job can persist the raw provider response (id, model,
   stop_reason/status, text) as the Global Constraints require. It never contains request credentials.
3. **`MemoryKeyStore` installed by the `app` fixture, not by an autouse `memory_keys(app)` fixture.**
   An autouse fixture depending on `app` would build a FastAPI app for every test in the suite, including
   the pure-unit ones. The `app` fixture does the same job in one line with no overhead. Every test app in
   the suite therefore uses the in-memory store; no test can reach Credential Manager.
4. **Jobs reach the key store through the runner.** `JobContext` has no route to `app.state`, and a key must
   never go into `Job.params` (those are persisted in the project DB). `create_app`'s lifespan sets
   `app.state.jobs.keys` and `.provider_config`; `run_infer` reads them with `getattr` and falls back to a
   real `KeyringKeyStore`. This keeps `app/jobs/runner.py` untouched, as required. If S0's owner would
   rather have first-class fields on `JobRunner`, that is a two-line change in `runner.py`.
5. **`get_provider` takes `handle` and `config` as optional.** The provider test endpoint and pre-annotation
   have no project or no cloud config; `cloud_provider(name, keys, config)` is factored out for the endpoint.
6. **`encode_tile` lives in `providers/tiling.py`**, not in the Anthropic module — both cloud providers need it
   and it is tiling work (JPEG q90, long side <= tile size, in memory, never written to disk).
7. **OpenAI refusal shape** — see Task 6.
8. **Validation order in `estimate` / `create_query_run`**: images are resolved (404) before the
   kind-specific checks. Forced by the contract; see the next section.
9. **`hold_gpu` is per tile** for the local provider (the plan's wording), so a long tiled run does not lock
   the GPU out from a training job for minutes at a time.

## Contract gaps (contract not edited)

1. **`QueryRunCreate` cannot express its own requirements.** Only `kind` and `image_ids` are `required`;
   `model_id`, `provider` and a non-empty `query` are required in prose only, and `query` has no `minLength`.
   Schemathesis's `positive_data_acceptance` check therefore fails any 422 on a schema-compliant body — I hit
   exactly this with `{"kind": "cloud_provider", "provider": "anthropic", "query": "", ...}`.
   Resolution taken: resolve the images first, so a body naming no real image is answered 404 (accepted by the
   gate) whatever else is wrong with it, and keep the plan's 422s for real callers. Suggested contract fix:
   `query: {type: string, minLength: 1}` plus a `oneOf`/`allOf`-`if`-`then` on `kind` making `model_id` required
   for `local_model` and `provider`+`query` required for `cloud_provider`. This is the same trade-off S3
   recorded for `weights_path` on model import.
2. **No resume or re-run endpoint for a query run.** See the resumability note in Task 8. Proposal:
   `POST /api/v1/projects/{projectId}/query-runs/{runId}/resume -> 202 JobRef`, re-submitting `infer` for the
   run and reusing its tile folder. Without it, "restart" costs the full run again.
3. **`Provider` has no `enabled`/fallback settings.** `ProviderUpdate` only carries `model_name`,
   `requests_per_minute` and `cost_per_request`. If the owner wants Anthropic's server-side fallbacks, or a
   per-provider tile size, they need new fields.
4. **`ProviderTestResult.model_name`** is required, so the no-key answer reports the *configured* model name
   rather than one that answered. That is the only sensible reading; noting it because the field name suggests
   otherwise.
5. **`QueryRun.box_count` at creation** is always 0 in the 202 response even though the job may already have
   written boxes by the time the client reads it. The contract describes it as "boxes written so far", which
   this satisfies; `GET /query-runs/{runId}` is the live number.

## Concerns

- **The OpenAI default model name is unverified** (no key). See the top of this report — the live test will
  name the currently served models when it first runs with a key.
- **Cloud cost is a per-request estimate, not measured.** `cost_per_request` is a user-editable number
  (contract) and token usage is not read back from the responses, so the estimate is as good as the number
  the user puts in. `TileResult.raw` already carries the response id; adding real usage accounting would need
  a `usage` field on the raw payload and somewhere in the contract to report it.
- **Both cloud providers downscale a tile to `max_side` (1280 by default).** With tiling disabled on a
  4000 px frame that is a heavy downscale; the normalised coordinates still map back correctly, but small
  machinery will be missed. Tiling is on by default, which is the intended path.
- **No live cloud call has ever been made by this code.** The request shapes are asserted against the
  installed SDKs' own types, which is strong, but the first real call is still the first real call.
- **The provider test endpoint's `except Exception` returns the SDK's message verbatim.** The tests assert an
  API key never reaches it (the SDKs redact credentials in their own messages), but that is an assumption about
  the SDKs, not something this code can enforce.
- `test_trainer_launch.py::test_train_reports_progress_and_returns_artifacts` failed once, mid-task-9, and
  passed on its own immediately after and in all six subsequent full runs. It is a pre-existing subprocess
  timing flake in S3's code, not caused by the GPU lock (that test uses `FakeTrainer` via a subprocess worker
  and never touches `hold_gpu`); recording it in case it resurfaces.


---

# Fix round 1

Commit `a6aea52` on `s4-inference-providers`. Every finding from the review is addressed; nothing else
was touched. The contract edits the goal owner made on main were mirrored into the worktree's
`contract/openapi.yaml` verbatim (no client regeneration).

## Verification after the round

```
$ .venv/Scripts/ruff.exe check .            -> All checks passed!
$ python -m pytest -q   (x3)                -> 380 passed, 9 deselected in 76.55s / 81.77s / 75.18s
$ python -m pytest -m gpu -q                -> 4 passed, 385 deselected in 23.30s
$ python -m pytest -m live -q               -> 5 skipped, 384 deselected in 2.50s (still no keys in the env)
```

380 default tests, up from 356: 24 new tests, all of them covering a finding below.
Schemathesis picked the new operation up automatically —
`test_responses_conform[POST /api/v1/projects/{projectId}/query-runs/{runId}/resume]` is collected and
passes, and `EXPECTED_STUBS` stays empty (any 501 would now fail that test).

## Contract edits mirrored from main

- `QueryRunCreate.query` -> `{ type: string, minLength: 1, ... }` (main 2d54e9f).
- New `POST /api/v1/projects/{projectId}/query-runs/{runId}/resume` -> 202 `JobRef` / 409 / 404
  (main 2e8592a), inserted immediately before the `/promote` path, text exactly as given.

## IMPORTANT 1 — tiles could leave the image

`make_tiles` took the single-tile shortcut only when **both** sides fitted, then emitted
`w = h = tile_size` unconditionally, so a 1920x1080 frame produced two 1280x1280 tiles ending 200 px
below the image and a 4000x800 strip produced tiles hanging 480 px below it. `crop_tile` silently
padded, and every detection in that dead band was mapped to coordinates outside the image.

Fix (`providers/tiling.py`): the tile is clamped per axis, `w = min(tile_size, width)`,
`h = min(tile_size, height)`. An axis shorter than the tile already yields a single origin at 0, so a
4000x800 strip is now one row of four 1280x800 tiles. `local_yolo.detect_tile` already handled
non-square tiles (`imgsz` comes from `max(tile.w, tile.h)`), so nothing else changed.

RED:
```
FAILED tests/test_tiling.py::test_no_tile_ever_leaves_the_image[1920-1080]
FAILED tests/test_tiling.py::test_no_tile_ever_leaves_the_image[4000-800]
FAILED tests/test_tiling.py::test_no_tile_ever_leaves_the_image[900-3000]
FAILED tests/test_tiling.py::test_a_short_image_is_one_row_of_tiles_as_tall_as_the_image
4 failed, 14 passed
```
GREEN: `18 passed in 0.06s`.

Covering tests: `test_no_tile_ever_leaves_the_image` parametrised over 4000x2667, 1920x1080, 4000x800,
900x3000 and 1280x1280 (asserts every tile is inside the image and has positive area), and
`test_a_short_image_is_one_row_of_tiles_as_tall_as_the_image`.

## IMPORTANT 2 — waits inside a tile were not cancellation-aware

Three separate unbounded waits, all fixed:

1. **Retry backoff** (`inference/jobs.py`): `sleep(delay)` with an uncapped `retry_after` — a provider
   asking for an hour parked the job thread for an hour, deaf to cancel. Now the delay is capped at
   `MAX_RETRY_WAIT_S = 60` and the wait is `ctx.cancelled.wait(delay)` followed by
   `ctx.check_cancelled()`, so a cancel ends the wait on the spot.
2. **The GPU lock** (`jobs/gpu.py`): `with gpu_lock` blocked a cancelled local run behind a whole
   training run. `hold_gpu` now takes `cancelled: threading.Event | None` and acquires in a
   `gpu_lock.acquire(timeout=CANCEL_POLL_S)` loop that raises `JobCancelled` once the event is set.
   `run_infer` passes `ctx.cancelled` into the local provider (`factory.get_provider(..., cancelled=...)`
   -> `LocalYoloProvider(cancelled=...)`). I extended the same one-keyword change to
   `app/training/jobs.py` (`hold_gpu(ctx.log, "train"/"export", cancelled=ctx.cancelled)`): a cancelled
   training job waiting behind an inference run had exactly the same problem, and that file is in S4's
   allowance for precisely this call.
3. **Synchronous pre-annotation** (`inference/service.py`): the request thread waited on the same lock.
   It now builds the provider with `gpu_timeout=PREANNOTATE_GPU_TIMEOUT_S` (2 s); `hold_gpu` raises the
   new `GpuBusy` and the service answers
   `409 conflict "GPU busy (training in progress); try again later"`, so the editor can open the image
   without proposals instead of hanging on a request that never returns.

RED for the pre-annotation case is the bug itself: with the lock held by another thread the test run
**hung** and had to be killed at the 300 s timeout (`tests/test_preannotate.py::test_the_gpu_being_busy_is_a_conflict_not_a_hang`).
RED for the retry case: `test_a_retry_wait_ends_as_soon_as_the_job_is_cancelled` errored on the missing
`reset_buckets`, then failed until the wait became event-based.

Covering tests: `test_a_retry_wait_ends_as_soon_as_the_job_is_cancelled` (a provider asking for
`retry_after=3600`, cancelled after 0.2 s, must raise `JobCancelled` in under 5 s);
`test_hold_gpu_raises_job_cancelled_instead_of_waiting_forever`;
`test_hold_gpu_gives_up_when_the_caller_passes_a_timeout`;
`test_hold_gpu_releases_the_lock_when_the_body_raises` (the contextmanager now releases in a `finally`,
which the old `with gpu_lock` did for free and the new explicit acquire had to be given);
`test_the_gpu_being_busy_is_a_conflict_not_a_hang`.

## IMPORTANT 3 — pre-annotation was not idempotent under concurrency

The existing-boxes check runs outside any lock and `_write_proposals` appended, so two editor tabs
opening the same image both saw nothing, both ran the model and left two copies of every proposal.

Fix: `_write_proposals` is now delete-then-insert in one transaction, scoped to
`(image_id, model_id, provenance_kind="local_model", query_run_id IS NULL, review_state="unreviewed")`.
The second writer replaces the first instead of appending, and the `unreviewed` clause means a review
decision is never undone by it. It returns the rows it wrote by reading them back inside the same
session, so the first call and a skipped call list the boxes in the same order.

I took this option rather than re-checking under the GPU lock because the lock is taken inside the
provider (`detect_tile`), so holding it across the check would need a re-entrant lock or a second one;
delete-then-insert is correct without either. The cost is that a genuine race runs the model twice.

Covering tests: `test_two_racing_requests_leave_exactly_one_set_of_proposals` (two threads through a
`threading.Barrier`, both get 200, the DB holds exactly 2 boxes, not 4) and
`test_reviewed_proposals_are_never_replaced`.

## IMPORTANT 4 — resume

`POST /api/v1/projects/{projectId}/query-runs/{runId}/resume` (`resume_query_run` in
`inference/router.py`, `service.check_resumable`): 404 for an unknown run, 409 `conflict` when the run's
current job is `queued` or `running` (with `job_id` and `state` in `details`), otherwise it submits a new
`infer` job for the same run and points `QueryRun.job_id` at it. 202 `JobRef`.

Tile results moved from `runs/<job_id>/tiles/...` to **`runs/query-runs/<query_run_id>/tiles/<image_id>/<index>.json`**
(`service.tiles_dir`), so the second job reuses what the first one paid for. Failed tiles are not reused
and are retried. `_run_image` now reports whether every tile of an image came from the cache; when it did,
`run_infer` skips `_write_boxes` entirely and counts the existing rows, so an untouched image keeps its
boxes and their ids. When it does write, `_write_boxes` deletes only this run's **unreviewed** boxes for
that image, so `accepted` / `edited` / `rejected` survive a resume.

RED: all four resume tests errored (`AttributeError` on the missing `reset_buckets`, then 404/405 on the
unrouted path). GREEN: `46 passed` for `test_query_runs.py` + `test_preannotate.py`.

Covering tests:
- `test_resume_reuses_the_finished_tiles_and_keeps_reviewed_boxes` — a run with one permanently failing
  tile per image (`calls == [0, 0, 1, 1]`), the user accepts one proposal, resume asks the provider for
  `[1, 1]` only, `failed_tiles == 0`, the accepted box is still there and still `accepted`, and the run's
  `job_id` now names the new job.
- `test_resume_of_a_finished_run_calls_the_provider_for_nothing` — every tile cached, `calls == []`,
  box ids and review states byte-identical before and after.
- `test_resume_while_the_job_is_still_running_is_a_conflict` — 409 with `code: conflict`.
- `test_resume_of_an_unknown_run_is_a_404`.
- `test_cancellation_keeps_the_finished_tiles` was updated to look in the run's folder.

## Minors

**A — `QueryRunCreate`**: `query: str | None = Field(default=None, min_length=1)` (mirrors the contract's
new `minLength: 1`), `model_id: str | None = None`, `provider: ProviderName | None = None`, and
`PreannotateRequest.model_id: str | None = None`. The service keeps its 422 for a whitespace-only query,
which the schema cannot express.

**B — rate limit per provider, not per job**: `inference/ratelimit.py` gained a module-level
`{provider: TokenBucket}` registry guarded by a lock (`bucket_for(provider, rpm)`), plus
`TokenBucket.set_rate` so the rate configured in settings is applied on every acquire without a restart,
and an internal `threading.Lock` on `acquire` so several job threads can share one bucket safely.
`reset_buckets()` exists for tests and an autouse fixture in `test_query_runs.py` calls it, so no test
inherits another's tokens. Covering tests: `test_the_bucket_is_shared_per_provider_and_follows_the_configured_rate`,
`test_the_job_rate_limits_cloud_calls`, `test_a_local_run_is_not_rate_limited`.

**C — no silent fallbacks**: `jobs._wiring(ctx, name)` raises
`RuntimeError("the job runner has no <name>; create_app must wire it before jobs run")`. The keyring
fallback and the hard-coded 30 rpm are gone: the rate now comes from `provider_config`, and both are only
required for cloud runs. Covering test: `test_a_cloud_job_without_the_runner_wiring_fails_loudly`.

**D — single-entry model cache**: `local_yolo._MODEL` is one `(resolved path, YOLO)` pair instead of a
dict. Switching weights drops the old model before loading the new one, so its VRAM goes back to
training. Covering test: `test_the_model_cache_holds_one_model_at_a_time` (patches the new `_new_yolo`
seam, asserts the same weights are not reloaded, a different path replaces the entry, and only one model
is held).

**E — `ping()` timeout**: both providers call `self.client.with_options(timeout=PING_TIMEOUT_S)` (30 s)
for `ping` only, so the settings screen cannot hang on the SDK default. Covering tests: the two
`..._ping_returns_the_model_that_answered` tests assert `options == [{"timeout": 30}]`, and
`test_a_detection_call_does_not_shorten_the_timeout` asserts a detection call is left alone.

**keyring backend pinned (for S6)**: `KeyringKeyStore._keyring()` now calls
`keyring.set_keyring(WinVaultKeyring())` once per store on `sys.platform == "win32"`, still inside the
lazy import. keyring discovers its backend through setuptools entry points, which a PyInstaller
one-folder build does not ship; without the explicit backend the packaged sidecar falls back to the fail
backend and every key read silently returns nothing. Doing it in application code means **S6 does not
need a packaging change for this** — the hidden-import / collect-all work for `keyring.backends.Windows`
is still theirs, but the runtime selection is no longer entry-point dependent. Covering test:
`test_the_windows_credential_manager_backend_is_pinned_explicitly`.

## Notes and residual concerns

- A local query run holds the GPU per tile, so a pre-annotation request arriving mid-run can get the new
  409 even though nothing is "training". The message says "training in progress", which is the common
  case but not the only one; the UI should treat 409 as "busy, try again", not as an error.
- `_write_boxes` keeping reviewed boxes means an image that has both reviewed boxes and newly returned
  tiles ends up with the reviewed ones plus fresh proposals for the same objects. That is the goal
  owner's stated rule (reviewed work survives a resume) and NMS does not span the two sets; images whose
  tiles are fully cached skip the write entirely, so the duplicate case only arises for an image that was
  genuinely re-inferred after being partly reviewed.
- The bucket registry is process-global and keyed by provider name only. Two projects open in one backend
  share the rate limit, which is correct (one account) but means a big run in one project paces a small
  one in the other.
- Live tests still skip: no `ANTHROPIC_API_KEY` / `OPENAI_API_KEY` in this environment, so the OpenAI
  default `gpt-5` remains unverified against `client.models.list()`.


---

# Fix round 2

Commit `a8110f1` on `s4-inference-providers`. Both Important defects the re-review found in the resume
flow are fixed, plus M1-M5. Nothing else was touched; `contract/openapi.yaml` is byte-identical to main
(`git diff main -- contract/openapi.yaml` is empty).

## Verification after the round

```
$ .venv/Scripts/ruff.exe check .            -> All checks passed!
$ python -m pytest -q   (x3)                -> 382 passed, 9 deselected in 75.53s / 75.74s / 77.03s
$ python -m pytest -m gpu -q                -> 4 passed, 387 deselected in 23.31s
$ python -m pytest -m live -q               -> 5 skipped, 386 deselected in 2.45s (still no keys in the env)
```

382 default tests, up from 380: two new tests, plus three existing ones tightened.

## C1 — a resume could report success and leave an image permanently empty

Tile files are written one per tile; boxes are written once per image after the tile loop. Anything that
interrupts that gap — a process kill, or an exception in `_write_boxes`, `publish` or `progress` — leaves
a complete tile cache and no boxes. `run_infer` then treated `all_cached` as "this image is already
done", skipped the write and reported `succeeded`, so the image stayed empty through every later resume.

Fix (`inference/jobs.py`): the skip is now `all_cached and _count_boxes(ctx, run, image_id) > 0`. A
complete cache with no boxes falls through to `_write_boxes`, which rebuilds them from the cache without
calling the provider.

RED:
```
FAILED tests/test_query_runs.py::test_a_resume_rewrites_boxes_a_hard_interruption_never_stored
```
GREEN: `37 passed` for `test_query_runs.py`.

Covering test: `test_a_resume_rewrites_boxes_a_hard_interruption_never_stored` — run to completion, delete
every `Box` of the run to stand in for the kill, resume, then assert the provider was never called
(`second.calls == []`), `result["boxes"] == 4`, and four rows are back in the DB.

## C2 — a resume duplicated every reviewed proposal

`_write_boxes` deletes only the run's `unreviewed` boxes, but `dets` is built from **all** tiles of the
image, cached ones included. So an object the user had accepted survived the delete and was then
re-inserted as a fresh `unreviewed` box: two boxes on the same object, one of them undoing the review.

Fix: new `providers/tiling.not_covered_by(keepers, candidates, iou_threshold)` — per-class NMS with the
keepers fixed, rather than `nms_per_class`'s "highest confidence wins". `_write_boxes` loads this run's
non-`unreviewed` boxes for the image (`_reviewed`), converts them to `Detection`s through the project's
class-id-to-name map, and drops every fresh detection a keeper covers at the run's own `nms_iou`
(`spec.nms_iou` is now passed in). `rejected` counts as reviewed too, so a resume cannot resurrect a box
the user threw away.

RED — the defect reproduced exactly as described, the accepted box at (10, 10) plus a fresh copy of it:
```
E       AssertionError: [(10.0, 10.0, 'accepted'), (10.0, 10.0, 'unreviewed'), (730.0, 10.0, 'unreviewed')]
E       assert 3 == 2
```
GREEN: `37 passed`.

Covering test: `test_resume_reuses_the_finished_tiles_and_keeps_reviewed_boxes` now counts rows exactly.
It accepts the proposal on `frames[0]` deterministically (rather than "the first row the DB returns"),
then after the resume asserts that image has exactly 2 boxes, that the accepted geometry appears exactly
once, that the states are exactly `["accepted", "unreviewed"]`, and that the run holds 4 rows in total.

## Minors

**M1** — `TokenBucket.set_rate` now does its work under `self._lock`, the same lock `acquire` holds, so
capacity, rate and tokens cannot move underneath a waiting caller. Lock order is registry lock then
bucket lock (`bucket_for` -> `set_rate`); `acquire` takes only the bucket lock, so there is no cycle.

**M2** — resume is check-and-set in one step: `service.resume(handle, run_id, submit)` holds a
module-level `_RESUME_LOCK` across `check_resumable`, the caller's `submit` and `set_job`. The router
passes the job-runner call as a lambda. A second resume arriving in that window now waits, then sees the
queued job and gets 409.

Covering test: `test_two_resumes_at_once_start_one_job` — one tile file is deleted so the resumed job has
to call a blocking provider, `app.state.jobs.submit` is wrapped to sleep 0.3 s (widening the window so
the unguarded version reliably double-submits), and two threads meet at a barrier. Asserts
`sorted(statuses) == [202, 409]` and that the project holds exactly two `infer` jobs: the original run
and one resume. Before the fix this returned `[202, 202]`.

**M3** — the job result now separates work from reuse. `boxes` counts only rows this job inserted (it
used to add the existing count for cached images, so a resume that did nothing still reported the full
number), and the new `cached_images` reports how many images came from the tile cache. Result shape:
`{query_run_id, images, tiles, boxes, cached_images, failed_tiles, refusals}`.
`test_the_job_writes_unreviewed_proposals_with_cloud_provenance` asserts the exact dict, and
`test_resume_of_a_finished_run_calls_the_provider_for_nothing` now asserts `boxes == 0` and
`cached_images == 2`.

**M4 — partially done, and here is why.** The module-level `from app.jobs.runner import JobCancelled` is
gone from `app/jobs/gpu.py`; it is now a late import inside `_cancelled_error()`. I did **not** take the
suggested "tiny module both can import" route: that only works if `app/jobs/runner.py` also imports
`JobCancelled` from the new module, and `runner.py` is outside S4's allowed file set. Defining a second
class without changing `runner.py` would give two distinct exception types and the runner's
`except JobCancelled` would stop recognising a cancelled job — a worse bug than the import direction.
The callback variant has the same problem one layer up: `hold_gpu` is called from inside the provider,
so `app/training/jobs.py` would need a translating `try/except` too, which is more than its "acquire the
GPU lock" allowance. **Suggested follow-up for whoever owns `app/jobs/`:** move `JobCancelled` into
`app/jobs/cancellation.py` and re-export it from `runner.py` (`from app.jobs.cancellation import
JobCancelled`), then `gpu.py` can import it at module scope and `_cancelled_error` disappears. That is a
one-line change in `runner.py` plus a new three-line module.

**M5** — the `preannotate` docstring no longer claims the call "waits for any training run". It now says
what the code does: it blocks one threadpool worker, waits up to `PREANNOTATE_GPU_TIMEOUT_S` for the GPU
and then answers 409.

## Residual concerns

- C2's suppression is geometric: a detection is dropped when a reviewed box of the same class overlaps it
  at or above `nms_iou`. If the user *edited* a proposal by dragging it far from where the model put it,
  the resume will propose the original position again as a new box. Keeping the detection would be worse
  (the edit would be duplicated wherever the model still sees the object), and there is no identity to
  match on across runs, so this is the best available rule.
- `_reviewed` maps `class_id` back to a name through the project's current class list. A class renamed
  between the run and the resume falls out of that map and its reviewed boxes stop suppressing, so the
  object could be re-proposed. Renaming a class mid-run is rare and the failure is a duplicate proposal,
  not lost work.
- `test_two_resumes_at_once_start_one_job` widens the race window with a 0.3 s sleep inside a patched
  `submit`. It is deterministic with the lock in place and fails reliably without it, but it is the one
  test in the suite whose value depends on timing.
- Live tests still skip: no `ANTHROPIC_API_KEY` / `OPENAI_API_KEY` in this environment, so the OpenAI
  default `gpt-5` remains unverified against `client.models.list()`.
