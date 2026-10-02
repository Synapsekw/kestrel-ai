# Asset model builder (M1) Implementation Plan — index

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Each unit has its own plan file (below); a unit is built in its own worktree (`scripts\start-task.ps1 -Name am-u<n>`) and merged to `main` before a unit that needs it starts.

**Goal:** Operators build, review, edit and download a part-by-part 3D model (GLB) of an asset from the project's drawings, point clouds and photos, with an AI agent (Claude, OpenAI or Gemini) doing the build as a background job.

**Architecture:**
- New backend package `backend/app/asset_models/`. A pydantic **model spec** (parts in millimetres, in the asset frame) is the single source of truth. A pure builder turns a spec into a GLB with `trimesh`.
- Three new project tables (`asset_model`, `asset_model_version`, `asset_model_run`) with migration `0015`. A new data item type, `asset_model`.
- An agent run is a background job (`asset_model_run`). It drives the existing provider-neutral `project_agent/llm.complete` (with a Gemini branch added) over its own tool set: look tools on drawings, a sampled cloud and photos; build tools on the working spec; check tools (a numpy rasterizer and cloud comparison).
- A new full-bleed frontend workspace at `/p/:projectId/models[/:modelId]`, built the way the clouds workspace is (`GlassPanel`s over a three.js canvas), with a GLB viewer engine.

**Tech Stack:**
- Backend: FastAPI, SQLAlchemy and Alembic (per-project SQLite), pytest; `trimesh` + `mapbox-earcut` (new), `google-genai` (new), `pypdfium2`, `rasterio`, `laspy`, `scipy`, `numpy` and `Pillow` (existing).
- Frontend: React 18 and TypeScript, three 0.180 (`GLTFLoader`, `OrbitControls`), Vitest and Testing Library, Playwright against the Prism mock.

**Spec:** `docs/superpowers/specs/2026-10-02-asset-model-builder-design.md`

## Unit plans

| Unit | File | Builds |
| --- | --- | --- |
| U1 | `2026-10-02-asset-model-u1.md` | Spec models, shape builders, validation, GLB builder |
| U2 | `2026-10-02-asset-model-u2.md` | Rasterizer, cloud comparison |
| U3 | `2026-10-02-asset-model-u3.md` | Full contract (all M1 operations), migration, tables, data item, models/versions API, GLB job, run-route stubs |
| U4 | `2026-10-02-asset-model-u4.md` | Look functions: drawing view/text, cloud sample/slice/fit, photo view |
| U5 | `2026-10-02-asset-model-u5.md` | Agent run job, run tools, prompt, Gemini adapter, usage and effort in `llm.complete`, runs API |
| U6 | `2026-10-02-asset-model-u6.md` | Workspace route, GLB viewer engine, panels, Parts/Part/Versions tabs, manual edit |
| U7 | `2026-10-02-asset-model-u7.md` | Build dialog, run progress, Run tab, Gemini key in App settings, e2e |

## Global Constraints

These apply to every task in every unit.

- `contract/openapi.yaml` is the source of truth. `contract/client/schema.d.ts` is regenerated with `pnpm -C contract generate` and committed in the same commit, never hand-edited. `oas3-unused-component` is an error: every new schema must be referenced.
- Nullable contract types use `type: [X, "null"]`. Paths are `/api/v1/projects/{projectId}/...`; path parameter names in FastAPI must match the contract literally (`projectId`, `assetModelId`, `version`, `runId`, `step`, `cloudId`).
- Every new route appears in the contract and every contract operation is routed (`backend/tests/test_contract.py`). Until U5 lands, the run operations are 501 stubs in `app/asset_models/stubs.py` (`app.stubs.add_stubs`).
- API keys only ever come from `KeyStore.get(provider)` at the moment of a model call, and are deleted right after. Never in a log, a job message, a step summary, an error, a file or a commit. Logs carry tool names, states and durations only — never prompts, model output, tool payloads or SDK exception text.
- Long work is a background job: `asset_model_glb` and `asset_model_run`. No route blocks on mesh generation, cloud sampling or a model call.
- Bounded reads (spec §7.3, amended): drawing views ≤ 1 600 px longest side; `drawing_text` ≤ 4 000 spans; cloud sample ≤ 2 000 000 points per cloud per run, built by one streamed laspy pass (2 M-point chunks); `cloud_slice` returns ≤ 5 000 points and a ≤ 1 024 px image; `cloud_fit` and `compare_to_cloud` use ≤ 200 000 points; renders ≤ 1 024 px, ≤ 4 views per call; photos ≤ 1 600 px. Nothing loads a whole cloud, a whole image set or an unscaled page into memory.
- Run limits:
  - 80 tool calls;
  - 3 000 000 tokens (input + output, summed over calls) by default;
  - 40 images sent to the model per run;
  - 20 minutes wall clock;
  - one live run per asset model (409 `job_running`), and at most the job pool's two workers app-wide.
- The run's model history is **append-only**: nothing already sent is edited or dropped. Current Claude models reject edited history that carries thinking blocks (preserved thinking), and appending keeps the prompt cache warm.
- Spec units: millimetres and degrees in the spec; metres in the GLB and in cloud tools. Asset frame: Y up, X plant north, Z plant east, bearings clockwise from plant north, direction of bearing θ = `(cos θ, 0, sin θ)`.
- Versions are never overwritten or deleted except with their asset model.
- Copy is sentence case. No raw colours in TSX/CSS (`frontend/scripts/check-tokens.mjs`); motion via tokens only; panels use `GlassPanel`.
- The three.js screen is lazy-loaded (`src/app/lazyScreens.tsx`), like `CloudsScreen`. `three` stays pinned at 0.180.0.
- Stage files by path. Never `git add -A`. Commits end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Backend commands use the main checkout's interpreter: `$PY = E:\Dev\Yolo\app\backend\.venv\Scripts\python.exe`, run from `backend/`. U1 and U5 add Python packages: they follow the overlay-venv rule (`vault/decisions/2026-09-24-worktree-overlay-venv-for-new-dependencies.md`): develop in an overlay venv in the worktree, and at landing install only the new pins into the shared venv with `--no-deps`, diffing `uv pip list` before and after.
- Packaging: new packages are added to `backend/kestrel_backend.spec` (`collect_submodules` / `collect_data_files`, each with a comment), and the unit runs `backend\scripts\build.ps1` and `backend\scripts\smoke_frozen.ps1` before merge.
- Gate before every merge (`scripts\finish-task.ps1` runs it): `pnpm -C contract check`; `ruff check .`; `ruff format --check .`; `pytest`; `pnpm -C frontend lint`; `pnpm -C frontend test`; `pnpm -C frontend build`; `pnpm -C frontend e2e`.

## Review Focus

The five inputs most likely to bite the operator that no unit's happy-path tests reach. Each line names the test that pins it.

1. **A scanned (raster) PDF with no text layer.** `drawing_text` must return an empty list with a note "no text layer — read the image", never an error, so the agent falls back to `drawing_view`. Pinned in U4 Task 1 (`test_drawing_text_raster_pdf_is_empty_with_note`).
2. **A multi-GB cloud.** The run's first step (sampling) must stay at one streamed pass, hold ≤ 2 M points, report progress, and stop promptly on cancel. Pinned in U4 Task 2 (`test_sample_is_bounded_and_single_pass`, `test_sample_honours_cancel`).
3. **The agent sends a part that fails validation, or malformed tool arguments** (wrong types, unknown shape, a nozzle on a missing host). The tool returns an error result naming the problem, the working spec is unchanged, and the run continues. Pinned in U5 Task 3 (`test_invalid_upsert_is_a_tool_error_and_loop_continues`).
4. **The app is closed mid-run.** On the next project open the run is `failed` with "interrupted by application restart", the model is not stuck in `building`, and the last draft (if any) is still listed. Pinned in U5 Task 4 (`test_sweep_marks_interrupted_run_and_unsticks_model`).
5. **A machine without WebGL, or a GLB that fails to load.** The workspace shows a notice with the parts list still usable, never a blank canvas or an uncaught error. Pinned in U6 Task 2 (`ModelViewer.test.tsx` "no-webgl" and "load-error").

## Spec amendments made while planning

Folded into the spec in the same commit as this plan:
- **No server-side octree reader exists** (the octree only serves byte ranges to the frontend). The cloud tools read a **per-run sample** of ≤ 2 M points built in one streamed laspy pass at run start (`<project>/asset_models/<id>/runs/<runId>/cloud_<cloudId>.npz`), not "through the octree".
- **A `Drawing` row is one page** (`Drawing.page`), and every drawing has a rendered `plan.tif`. `drawing_view`/`drawing_text` take no `page`; views read `plan.tif`; text comes from the source PDF via `pypdfium2` text pages, or from DXF `TEXT`/`MTEXT` via `ezdxf`.
- **glTF extras** are written by post-processing the GLB's JSON chunk (`inject_node_extras`), because trimesh's exporter does not set per-node extras.
- **`pipe_run`** has no `bend_r`: joints get a sphere of the pipe's radius. Bends can be added as a shape later.
- **The spec download** is the version detail's `spec` field saved by the frontend, not a separate endpoint.
- **`asset_model.status`** is `empty | building | ready`; as a data item it maps to `importing` (building), `ready` (ready or empty — the summary carries `versions: 0`).
- **Point-cloud overlay** in the viewer uses a ≤ 300 000-point overlay written by `compare_to_cloud` in the asset frame (`GET …/runs/{runId}/overlay/{cloudId}`), not the Potree octree.
- **Provider names:** detection keeps `ProviderName = [openai, anthropic]`. A new `KeyedProviderName = [openai, anthropic, gemini]` types the `/providers` endpoints and asset model runs, so Gemini doesn't leak into detection requests.
- **Default Anthropic model** in `providers/config.py` becomes `claude-opus-5-5` (saved settings still win).
- **Run token budget** is 3 M tokens (input + output, summed over calls), not 400 k. An agent loop resends its history every call, so 400 k would stop a typical build after about ten steps. The Anthropic call turns on automatic prompt caching, so most resent input is billed as cache reads. Images are capped at 40 per run.
- **Crash safety:** the run writes its working spec to `runs/<runId>/working.json` after each build tool. The restart sweep turns a non-empty one into a `draft` version.
- **`AssetModelRun.comparison`** (new column and contract field) holds the last `compare_to_cloud` result. The Part tab reads deviation from it.
- **`get_spec`** is an extra read tool returning the working spec (compact JSON, ≤ 8 000 characters per call, paged by part index).

## Execution DAG

```
U1 spec+builder ──┬──> U2 raster+compare ─────────────┐
                  │                                   │
U3 contract+API ──┼──> U6 workspace ──────────┐       │
                  │                           ├──> U7 dialog+progress+e2e
U4 look tools ────┴──> U5 run job+Gemini ─────┘
                       (needs U1, U3, U4; U2's tools plug in when U2 lands)
```

- **Batch 1 (parallel):** U1, U3, U4. Separate packages: U1 `app/asset_models/{spec,shapes,placement,validate,build}.py`; U3 contract, migration, `models.py` additions, `app/asset_models/{schemas,store,router,jobs_glb,startup,stubs}.py`; U4 `app/asset_models/look/`.
- **Batch 2 (parallel):** U2 (after U1), U5 (after U1, U3, U4), U6 (after U3).
- **Batch 3:** U7 (after U5 and U6).
- **Critical path:** U1 → U5 → U7.
- **Contract ownership:** U3 writes every M1 operation and schema up front (runs as 501 stubs), so U6/U7 build against the Prism mock without waiting for U5. U3 defines `KeyedProviderName` and uses it only in the run schemas. U5 removes the stubs, adds no new operations, and switches the existing `/providers` operations from `ProviderName` to `KeyedProviderName`. That switch updates the frontend's provider labels in the same commit, so the frontend build stays green.
- **Riskiest unit:** U5 (provider behaviour, budgets, stop). Its tests use a scripted fake model; the live run is outside the gate.

## Interfaces between units (summary — each unit file has the exact signatures)

| Producer | Name | Used by |
| --- | --- | --- |
| U1 | `app.asset_models.spec.AssetSpec`, `Part`, `SHAPE_PARAMS` | U2, U3, U5 |
| U1 | `app.asset_models.build.build_meshes(spec) -> dict[str, trimesh.Trimesh]` (metres, asset frame) | U2, U5 |
| U1 | `app.asset_models.build.build_glb(spec) -> tuple[bytes, dict]` | U3 |
| U1 | `app.asset_models.validate.validate(spec) -> Report` (`errors`, `warnings`: `list[Issue]`) | U3, U5 |
| U2 | `app.asset_models.raster.render(meshes, view, *, size, labels) -> PIL.Image.Image` | U5 |
| U2 | `app.asset_models.compare.compare(meshes, points_asset) -> Comparison` | U5 |
| U3 | `app.asset_models.store` (`create_version`, `get_version`, `version_dir`, `model_dir`, `run_dir`) | U5 |
| U3 | `ProjectHandle.asset_models_dir` | U4, U5 |
| U4 | `app.asset_models.look` (`drawing_view`, `drawing_text`, `sample_cloud`, `CloudSample`, `cloud_slice`, `cloud_fit`, `photo_view`) | U5 |
| U5 | job `asset_model_run`, runs API | U7 |
| U3/U6 | `src/api/assetModels.ts`, `src/assetmodels/viewer/engine.ts` (`createModelEngine`) | U7 |
