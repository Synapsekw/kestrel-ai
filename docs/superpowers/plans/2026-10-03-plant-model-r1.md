# Plant model generator, unit R1: the plant run. Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** One unattended `asset_model_run` job in `mode = plant` reads a project's drawings, plans packages, traces them in up to 4 parallel sub-run conversations, merges, checks against the cloud, traces the environment, self-checks the build and writes an `agent` version whose GLB job then starts. The unit also covers budget, stop, resume and `plant_package` re-runs.

**Architecture:**
- A new package, `backend/app/asset_models/agent/plant/`, sits next to M1's agent. M1's `run_asset_model` dispatches `mode in ("plant", "plant_package")` to `orchestrator.run_plant(ctx)`.
- **The orchestrator** is one append-only conversation that spans the model-driven stages (survey, review, environment, build). App code runs the other stages: trace, merge, cloud check and the in-process build check.
- **Trace** runs package sub-runs on a `ThreadPoolExecutor` (≤ `limits.parallel`, default 4). Each sub-run is its own append-only conversation through `project_agent.llm.complete` with `cache=True`. A thread-safe `RunBudget` is charged by every conversation.
- **Persistence:** run state lives in `<run_dir>/plant/` (`state.json`, `packages/<n>.json`, `merged.json`) and in `site_model_package` rows, so a restart resumes after the last finished package.
- **Tools** follow M1's `ToolOut` pattern in `tools_plant.py`. Their heavy lifting sits in `views.py` (drawing zoom, ortho mosaic, plan/iso renders) and `sitefit.py` (plant grid fit and drawing auto-georef).

**Tech Stack:** Python 3.11, FastAPI, SQLAlchemy, pydantic v2, numpy, Pillow, pypdfium2, rasterio (through the existing tile code), shapely, pyproj, trimesh, pytest. **No new packages.**

**Spec:** `docs/superpowers/specs/2026-10-03-plant-model-generator-design.md` (§8 is this unit's; §15 amendments apply). **Index:** `docs/superpowers/plans/2026-10-03-plant-model.md`. Read both alongside this plan.

## Unit facts

| | |
| --- | --- |
| Unit | **R1**, "Backend: plant run" |
| Worktree / branch | `.claude/worktrees/pm-r1` on `task/pm-r1` |
| Cut after | **F0** merged on `main` |
| Consumes later | **I1** (`list_sources` grouping, Task 15) and **C1** (`app.asset_models.cloudcheck`, Task 16). Tasks 1–14 need only F0, so the unit can run until `WAITING: I1` / `WAITING: C1`. Before Tasks 15/16, merge `main` into `task/pm-r1` once I1 and C1 have landed. |
| Merge position | Batch 3, after F0, I1 and C1, and before L1. S3 reads the run fields this unit fills (`packages`, `usage_by_stage`, `listAssetModelRunPackages`). |
| Python | `$PY` = `E:\Dev\Yolo\app\backend\.venv\Scripts\python.exe`, always run from `E:\Dev\Yolo\app\.claude\worktrees\pm-r1\backend`. Never install anything. |

## Interfaces provided (exact)

```python
# app/asset_models/agent/plant/__init__.py
PLANT_MODES: tuple[str, ...] = ("plant", "plant_package")

# orchestrator.py
def run_plant(ctx) -> dict                                   # {"run_id", "version"}; called by runner.run_asset_model

# subrun.py
@dataclass
class PackageResult: package_id: str; n: int; state: str; items: list[Item]; usage: dict; calls: int; images: int; summary: str; questions: list[str]
def run_package(rc: PlantRunContext, package: PackageWork) -> PackageResult

# packages.py
@dataclass(frozen=True)
class PackageWork: id: str; n: int; label: str; drawing_id: str | None; region: tuple[float, ...] | None; area: str | None; brief: str; expected_tags: tuple[str, ...] = ()
def rows(s, run_id: str) -> list[SiteModelPackage]
def replace_queued(s, run_id: str, specs: list[dict]) -> list[SiteModelPackage]
def set_state(s, package_id: str, state: str, *, usage: dict | None = None, item_count: int | None = None, summary: str | None = None) -> None
def summary(s, run_id: str) -> dict                           # {total, done, failed, running}
def mark_unfinished(s, run_id: str, state: str = "skipped", note: str | None = None) -> list[str]
def work_of(row, meta: dict) -> PackageWork
def find_for_model(s, model_id: str, ids) -> list[SiteModelPackage]
def copy_for_rerun(s, run_id: str, old: list[SiteModelPackage]) -> list[SiteModelPackage]

# budget.py
@dataclass(frozen=True)
class PlantLimits: max_tokens=40_000_000; max_images=400; max_seconds=14_400; parallel=4; sub_calls=150; sub_tokens=4_000_000; sub_images=60
class RunBudget:  # thread-safe
    def __init__(self, limits: PlantLimits, *, used: dict | None = None, elapsed_s: float = 0.0, clock=time.monotonic)
    def charge(self, usage: dict, stage: str) -> None
    def charge_call(self, stage: str) -> None
    def charge_image(self, stage: str) -> bool                 # False once the run's image budget is spent
    def tokens(self) -> int
    def elapsed_s(self) -> float
    def exhausted(self) -> str | None                          # "tokens" | "time" | None
    def snapshot(self, current: str) -> dict                   # {input_tokens, output_tokens, current, by_stage{stage: {input_tokens, output_tokens, calls, images}}}
def load_default_limits(appdata) -> PlantLimits               # settings.json key "plant_run_limits"
def resolve_limits(appdata, override: dict | None) -> PlantLimits
def limits_from(d: dict) -> PlantLimits
PRICE_TABLE: dict[str, Price]; COST_LABEL: str
def estimate_cost_usd(model_name: str, usage: dict) -> float | None

# merge.py
def merge_items(lists: list[list[Item]], labels: list[str] | None = None) -> list[Item]
def with_flag(item: Item, flag: ItemFlag) -> Item

# resume.py
def sweep_plant_runs(handle, runner) -> list[str]             # called first by asset_models.startup._sweep_runs

# app/drawings/georef_service.py (new; the "drawings georef service" the index names)
def apply_control_points(handle, drawing_id: str, model: str, points: list[dict]) -> DrawingOut
```

**Run API fields filled for S3 (binding shape of the free-form `usage_by_stage` object):**

```json
{"current": "trace",
 "stages": {"survey": {"input_tokens": 0, "output_tokens": 0, "calls": 0, "images": 0}, "trace": {"...": 0}},
 "cost_estimate_usd": 12.34,
 "cost_label": "Estimate from list prices, not a bill. Cached input is priced as fresh input."}
```

The other fields:
- `packages` is `{total, done, failed, running}`, null for M1 runs.
- `listAssetModelRunPackages` returns `{items: SiteModelPackage[]}`, ordered by `n`.

## Interfaces consumed (exact; cite owner)

- **F0, `app.asset_models.spec`:** `Item`, `ItemFlag`, `EnvFeature`, `SiteFrame`, `SiteCrs`, `Datum`, `AssetSpec(site=, items=, environment=)`, `Source`.
- **F0, `app.asset_models.siteframe`:**
  - `PlantGrid(frame)` with `.plant_to_site`, `.site_to_plant` and `.plant_to_scene`;
  - `fit_plant_grid(pairs) -> (origin_crs, plant_north_deg, rms_residual_m)`;
  - `footprint_ref(fp)`, `footprint_polygon(fp)`, `GridError`.
- **F0, `app.asset_models.builders`:** `REGISTRY`, `BuildCtx(grid, lod)`, `MeshNode`, `Instanced`, `build_item(item, ctx) -> (nodes, flags)`, `catalogue()`, `load_all()`.
- **F0, `app.db.models`:**
  - `SiteModelPackage`, with columns `id, run_id, n, label, drawing_id, region, area, state, usage, item_count, summary, started_at, ended_at`;
  - `AssetModel.kind`.
- **F0, contract (already generated):**
  - `AssetModelRunStart.mode` includes `plant` and `plant_package`, plus `package_ids` and `limits {max_tokens, max_images, max_seconds, parallel}`;
  - `AssetModelRun.packages` and `AssetModelRun.usage_by_stage`;
  - `SiteModelPackage`, `SiteModelPackageList`, `listAssetModelRunPackages`;
  - the 501 stub line in `app/asset_models/stubs_plant.py`.
- **M1 (on `main`):**
  - `agent.runner`: `_call_model`, `_describe_sources`, `_thumb`, `EFFORT`, `KEY_MISSING`, `INTERNAL`, `RUN_JOB`;
  - `agent.tools`: `ToolOut`, `RunContext`, `_A`, `_short`, `Region`, `FinishArgs`, `TOOLS`, `run_tool`;
  - `look`: `LookError`, `LookImage`, `clamp_region`, `to_jpeg`;
  - `look.drawing._drawing`, `look.drawing.drawing_view`;
  - `look.cloud`: `CloudSample`, `sample_cloud`, `source_of`;
  - `raster`: `View`, `render`;
  - `service.add_version`, `service.refresh_status`, `store.run_dir`, `store.get_version`.
- **Existing:**
  - `app.drawings.pdf.open_pdf`, `app.drawings.pdf.page_rgb`, `app.drawings.georef.apply`, `app.drawings.georef.fit`;
  - `app.workspace.service.get_frame`, `app.workspace.frame.transform_xy`;
  - `app.workspace.tiles.serve_site_tile` and `TileStyle`; `app.workspace.grid`.
- **I1 (Task 15):** `app.asset_models.agent.tools.group_drawing_sources(sources) -> [{file, facts, pages: [{id, page, label}]}]`, and the `file`/`sha256`/`page` keys on `_describe_sources` drawing entries (I1 plan, Task 6).
- **C1 (Task 16):** `app.asset_models.cloudcheck` (names bound by the coordinator, 2026-10-03):
  - `cloud_in_frame(handle, cloud_id, grid) -> (ok, note)`, called before sampling;
  - `plant_bbox_site(grid, items, margin)`;
  - `sample_plant_cloud(handle, cloud_id, bbox_site, *, max_points, cancel, progress) -> PlantSample` (`cancel` returning true raises `JobCancelled`);
  - `PlantSample.save/load` (cached per run);
  - `fit_datum(sample, grid, items)`, `check_items(sample, grid, items, datum) -> CheckResult` (with `.note`), `apply_check(items, result)`, `summarise(result) -> str`;
  - `Candidate(id, pts, top_el, size_m)`.

## Budget

- **Background jobs:**
  - `asset_model_run` in plant mode: ≤ 4 h wall clock by default (`max_seconds`), cancellable, resumable.
  - `asset_model_glb`: queued by `service.add_version` at the end of a run. A1 owns its body.
  - The C1 cloud sample runs inside the run.
  - No route waits on any of these.
- **Bounded reads:**
  - `drawing_zoom` output ≤ 1 600 px on the long side, ≤ 600 dpi source resolution. It caps with a note and never errors.
  - `ortho_view` and the `render_site` plan view are mosaics of ≤ 100 site tiles of 256 px, with output ≤ 1 600 px.
  - The `render_site` iso view stops meshing at 1 500 000 triangles, with ≤ 500 instances expanded per node; output ≤ 1 600 px, ≤ 4 views.
  - M1 look-tool cloud samples are ≤ 2 000 000 points per cloud (M1's `sample_cloud`).
  - The C1 plant sample is ≤ 20 000 000 points (C1).
  - Call limits: `items_query` ≤ 300 rows; `upsert_items` ≤ 150 items per call; `upsert_environment` ≤ 50 features per call; `plan_packages` ≤ 64 packages.
  - The model holds ≤ 20 000 items. `run.steps` keeps the last 400 steps.
- **Run limits** (defaults; overridable per run and in `settings.json`):
  - whole run: 40 M tokens, 400 images, 4 h, parallel 4;
  - per sub-run: 150 calls, 4 M tokens, 60 images;
  - per orchestrator stage: survey 120, review 60, environment 60, build 40 calls.

## Shared-file touches (outside `agent/plant/`)

| File | Anchor | Additive change |
| --- | --- | --- |
| `backend/app/asset_models/agent/runner.py` | top of `run_asset_model`; `_cancelled_before_start` | Dispatch plant modes to `run_plant`. On cancel-before-start, mark plant packages `skipped`. |
| `backend/app/asset_models/startup.py` | `_sweep_runs` | Call `resume.sweep_plant_runs` first. The M1 loop skips plant modes. |
| `backend/app/asset_models/runs.py` | `start_asset_model_run`; every `AssetModelRunOut.of(` call | Plant-mode checks, state file, `kind = "plant"`. Pass the session into `of`. New `GET …/runs/{runId}/packages`. |
| `backend/app/asset_models/schemas.py` | `AssetModelRunOut`, `AssetModelRunStart` | Plant modes, `package_ids`, `limits`, `packages`, `usage_by_stage`, package schemas (skip any F0 already added). |
| `backend/app/asset_models/stubs_plant.py` | the `listAssetModelRunPackages` stub line | Delete that one line. |
| `backend/app/drawings/georef_service.py` | new file | `apply_control_points`, moved out of the router's `put_drawing_georef`. |
| `backend/app/drawings/router.py` | `put_drawing_georef` body | Delegate to `georef_service.apply_control_points`. Same responses and events. |

No contract change: F0 owns `openapi.yaml`.

## Tests (added)

- Unit tests for each module:
  - `backend/tests/test_plant_run_f0_interfaces.py`, `test_plant_budget.py`, `test_plant_packages.py`, `test_plant_merge.py`;
  - `test_plant_tools_items.py`, `test_plant_drawing_zoom.py`, `test_plant_set_site.py`, `test_plant_views.py`;
  - `test_plant_prompt.py`, `test_plant_subrun.py`.
- Run-level tests:
  - `test_plant_run.py` (full pipeline, parallelism, logs);
  - `test_plant_run_stops.py` (budget, stop, errors, `plant_package`);
  - `test_plant_resume.py`;
  - `test_plant_runs_api.py`.
- Consumed units: `test_plant_sources_i1.py` and `test_plant_cloud_c1.py`.
- `backend/tests/plant_fakes.py` is the scripted fake model harness. It extends M1's `FakeLlm`/`Ctx` pattern from `test_asset_model_run_job.py` and routes each call to the orchestrator or to a package script.
- Changed: `backend/tests/test_asset_model_run_job.py` gets one test that the M1 sweep leaves plant runs alone.

## Execution DAG

```
T1 (align F0) ─┬─ T2 budget ─┐
               ├─ T3 state+packages ─┤
               ├─ T4 merge ──────────┤
               └─ T9 prompts ────────┤
                                     T5 context/record/model/item tools
                                     ├─ T6 drawing_zoom
                                     ├─ T7 set_site + georef service
                                     └─ T8 ortho_view + render_site
                                     T10 subrun (T5, T9)
                                     T11 orchestrator + dispatch (T6–T10)
                                     ├─ T12 budget/stop/errors/plant_package
                                     ├─ T13 resume
                                     └─ T14 runs API
                                     T15 align I1 (WAITING: I1)   T16 align C1 (WAITING: C1)
                                     T17 gate + walkthrough
```

- **Independent units:** T2, T3, T4 and T9 after T1. T6, T7 and T8 are logically parallel but all edit `tools_plant.py`, so one worker runs them in sequence.
- **Parallel batches:** {T2, T3, T4, T9} → T5 → {T6, T7, T8} → T10 → T11 → {T12, T13, T14} → {T15, T16} → T17.
- **Critical path:** T1 → T3 → T5 → T10 → T11 → T13 → T16 → T17.

## Gate (final task)

```
pnpm -C contract check
cd backend; $PY -m ruff check .; $PY -m ruff format --check .; $PY -m pytest
pnpm -C frontend lint
pnpm -C frontend test
pnpm -C frontend build
pnpm -C frontend e2e        # on the unit's port range (scripts\finish-task.ps1 picks free ports)
cargo test --manifest-path frontend/src-tauri/Cargo.toml   # only if frontend/src-tauri/binaries/kestrel-backend-*.exe exists
```

## Global Constraints

Copied from the index; every task's requirements include these.

- **Contract:** `contract/openapi.yaml` is the source of truth. `contract/client/schema.d.ts` is regenerated with `pnpm -C contract generate` and committed in the same commit, never hand-edited. **F0 owns the contract.** No other unit edits `openapi.yaml` except to fix a defect, which is then logged as a ruling and handed off. Every contract operation is routed. Until the owning unit lands, new operations are 501 stubs in `app/asset_models/stubs_plant.py`; the owning unit deletes its stub line.
- **Versions are never overwritten or deleted except with their asset model.**
- **Keys:** API keys only ever come from `KeyStore.get(provider)` at the moment of a model call, and are deleted right after. Never in a log, job message, step summary, error, file or commit.
- **Logs** carry tool names, states, durations and counts only. Never prompts, model output, tool payloads or SDK exception text.
- **Background jobs:** `asset_model_run` (plant mode ≤ 4 h, cancellable, resumable); `asset_model_glb`; the cloud sample (inside the run). No route blocks on mesh generation, validation over 200 items, cloud sampling or a model call.
- **Bounded reads:** drawing images to the model ≤ 1 600 px longest side; `drawing_zoom` ≤ 600 dpi source resolution; per-item cloud work ≤ 200 000 points; `items_query` ≤ 300 rows; renders ≤ 1 600 px and ≤ 4 views per call.
- **Plant run limits** (defaults, configurable in App settings next to M1's): 40 000 000 tokens (input + output, summed over the orchestrator and all sub-runs); 400 images; 4 h wall clock; up to 4 parallel sub-runs; per sub-run 150 calls, 4 000 000 tokens, 60 images. M1 limits (80 calls / 3 M / 40 images / 20 min) stay for `build` and `refine`.
- **Each conversation's history is append-only** (preserved thinking). Anthropic prompt caching is on.
- **Frames:** spec item coordinates are plant metres `[E, N]` in the drawing's plant grid, with elevations as plant EL in metres. Scene/GLB frame: metres, `x = plant_N`, `y = EL - datum.el_m`, `z = plant_E`. Site CRS from plant: `[X, Y] = origin_crs + R(plant_north_deg) · [E, N]`.
- **Builders** never raise to the caller: `build_item` catches and falls back to `other` with a `builder_fallback` flag.
- **Git:** stage files by path; never `git add -A`; never `git stash`. Commits end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Identity "Danijel Jovanovic" / info@synapse-solutions.ai.
- **Never install anything into the shared venv.**
- Full suites run only in the unit's final gate.

## Review Focus

1. **A scanned plot plan at 1:3000 with tiny tags** (index #1). `drawing_zoom` refuses a region whose output would exceed 1 600 px at the requested dpi. It returns the largest dpi that fits plus a note, and it never errors the run. Test: `test_drawing_zoom_caps_dpi_with_note` (Task 6).
2. **The app closes mid plant-run, hours in** (index #3). The run resumes from the last finished package. It does not re-bill done packages or duplicate items. A package interrupted twice is marked `failed` and the run continues. Tests: `test_resume_skips_done_packages`, `test_double_interrupt_fails_package` (Task 13).
3. **Four parallel sub-runs hit the provider's rate limit.** The sub-run backs off (20/40/80 s, cancel-aware). If the limit persists, only that package fails, with the fixed message, and the run continues. Test: `test_rate_limit_retries_then_fails_package_only` (Task 10).
4. **The model sends a batch of 150 items where a few have an unknown type, a crossing polygon or `top_el < base_el`.** The valid items are saved; each bad one is reported by id with its reason; nothing raises. Test: `test_upsert_items_partial_accept` (Task 5).
5. **The token budget runs out mid-trace.** In-flight packages wrap up in ≤ 3 calls, and no new package starts. The run still merges and builds an `agent` version, lists the unreached packages and ends `stopped/budget`. Test: `test_budget_out_still_builds` (Task 12).

## Rulings

- **R1.** `set_site` grid points carry `page_xy: [x, y]` page fractions, not the spec's `page_px`. Fractions are what every drawing tool speaks (regions, `drawing_view`), and `drawing_zoom` draws page-fraction ticks so the model can read them. The page pixels are derived in app code (`x · width`, `y · height` of the drawing's plan raster).
- **R2.** `set_site` computes the frame by one of two routes:
  - (a) from ≥ 2 grid points on pages that already have a georeference: `fit_plant_grid`, with the residual reported;
  - (b) from explicit `origin_crs` + `plant_north_deg` read off the drawing (a coordinate note), with `source.kind = "drawing"` when a `source_drawing_id` is given, else `assumed`.

  With neither, it refuses with a message that says what to supply. A residual over 1 m adds an open question.
- **R3.** Sub-runs get M1's *look* tools only: `list_sources`, `drawing_view`, `drawing_text`, `cloud_slice`, `cloud_fit`, `photo_view`. M1's `upsert_parts`, `render`, `compare_to_cloud`, `get_spec`, `set_asset` and `validate` act on top-level M1 parts, which a plant spec does not use. Item-level detail parts go through `upsert_items` (`Item.parts`). Logged under Deviations.
- **R4.** The in-process "build" and the `render_site` iso view use F0's `build_item`, the same builders A1's assembler calls. R1 is not cut after A1. The GLB itself is built by the `asset_model_glb` job that `service.add_version` queues (A1 dispatches to `assemble_glb`).
- **R5.** `run.phase` stays inside M1's contract enum. The stage maps to it: survey → `reading`; trace, merge, environment → `building`; cloud check, review, build → `checking`. The plant stage itself is `usage_by_stage.current`, shaped as above.
- **R6.** "App settings" limits are read from the app-data `settings.json` key `plant_run_limits` and clamped. A run's `limits` body overrides them. No settings route is added (F0 owns the contract). Handoff to S3/L1: if a UI for the defaults is wanted, F0 adds the operation.
- **R7.** The orchestrator conversation is not written to disk: model output stays in memory. A resumed run starts a fresh orchestrator conversation with a resume brief: the frame is set, packages are done, the stage is X.
- **R8.** When the budget runs out:
  - in-flight sub-runs get a wrap-up message and at most 3 more calls;
  - no package starts;
  - orchestrator stages are skipped;
  - the run merges, cloud-checks and build-checks in app code, then writes an `agent` version;
  - the run ends `state = stopped`, `stop_reason = budget | timeout`.

  Stop by the operator writes a `draft` (spec §8.4).
- **R9.** Merge:
  - **Same tag:** tags normalised by removing spaces and underscores and upper-casing. One item survives: highest confidence, then the latest list (newer package or re-run). If a loser has a different type or a reference point more than 2 m away, the survivor gets `straddles_package` with the distance and the other package's label.
  - **Untagged items of the same type** whose footprints overlap more than 60 % of the smaller one merge, same winner rule, no flag.
  - **Ids** are made unique with a `-k` suffix.
  - **Failed packages** keep the items they saved before failing.
- **R10.** `plant_package` runs have no orchestrator conversation. They:
  - take site, environment and items from the current version;
  - re-trace the copied packages;
  - merge, with the version's items as the oldest list;
  - cloud-check and build-check, then write an `agent` version with an app-written summary.

  A re-run adds and updates items; it never deletes.
- **R11.** `run.steps` keeps the newest 400 steps. Step numbers keep counting. Sub-run step summaries are prefixed `P<n> · `.
- **R12.** Rate-limit backoff lives in R1's `model.call_model` (20/40/80 s), not in `llm.complete`, which the chat agent shares.
- **R13.** The price table holds list prices from the claude-api skill (cached 2026-09-25): Opus 5.5 $4 / $20 per Mtok. `llm.complete` folds cache reads into `input_tokens`, so cached input is priced as fresh input. The estimate is an upper bound and is labelled so. `llm.py` is not changed: its usage dict is pinned by `test_usage_is_reported`.
- **R14.** The review stage runs only when a cloud check ran or candidates exist. Otherwise the run notes why and moves on.
- **R15.** A **fix round** is the first item or environment write after a `render_site` call in the build stage. Two rounds are allowed. The third such write is refused with "call finish".
- **R16.** With several cloud sources, the cloud check uses the one with the largest `point_count`.
- **R17.** A run that is interrupted more than 3 times fails at the next startup with a draft built from its finished packages. This stops a crash loop.
- **R18.** The contract caps `sources` at 50. Al-Zour's five PDFs may come close. If L1 needs more, F0 widens the cap (handoff, not an R1 edit).
- **R19.** In the review stage, a new item whose `source.kind == "cloud"` gets an `unregistered` flag: "Found in the point cloud, not on the drawings."
- **R20.** If `service.add_version` rejects the final spec, the items named in the error (`part_id`) are dropped and the write is retried once. The rejection code is logged, never the payload.

## Deviations (code or spec differences, followed as ruled)

- Spec §8.3 `set_site.grid_points[].page_px` becomes `page_xy` (R1).
- Spec §8.3 says all M1 tools stay available to sub-runs. Only M1's look tools are offered (R3).
- Spec §8.2.6 "build the GLB in process": R1 builds meshes in process with `build_item`, and the GLB comes from the queued job (R4).
- Spec §8.4 "configurable in App settings as M1's are": M1's limits are module constants on `main`, with no App-settings UI. Plant defaults live in `settings.json` (R6).

---

### Task 1: Align with merged F0

**Files:**
- Create: `backend/tests/test_plant_run_f0_interfaces.py`
- Create: `backend/app/asset_models/agent/plant/__init__.py`
- Read (do not edit):
  - `backend/app/asset_models/spec.py`, `siteframe.py`, `builders/__init__.py`, `builders/base.py`;
  - `backend/app/db/models.py` (`SiteModelPackage`, `AssetModel.kind`);
  - `backend/app/asset_models/stubs_plant.py`, `backend/app/asset_models/schemas.py`;
  - `contract/openapi.yaml` (`AssetModelRunStart`, `AssetModelRun`, `SiteModelPackage*`).

**Interfaces:**
- Consumes: everything listed under "Interfaces consumed: F0".
- Produces: `PLANT_MODES`, and a ledger note mapping any F0 name that differs from this plan.

- [ ] **Step 1: Read F0's real code.** For every name in "Interfaces consumed: F0", find it on `main`. If F0 named something differently, write the mapping in `.superpowers/sdd/pm-r1/ledger.md` ("plan name → F0 name"). Then use F0's name everywhere this plan uses the old one, with a search-and-replace over the remaining tasks as you reach them. Keep every assertion.

Also note which of these F0 already put in `app/asset_models/schemas.py`: `AssetModelRunStart.mode` plant values, `package_ids`, `limits`, `AssetModelRunOut.packages`, `usage_by_stage`, `SiteModelPackageOut`, `SiteModelPackageList`. Task 14 adds only the missing ones.

- [ ] **Step 2: Write the interface test**

```python
# backend/tests/test_plant_run_f0_interfaces.py
"""R1 builds on these F0 names (plan 2026-10-03-plant-model-r1, Task 1). A rename in F0 fails here first."""

import inspect


def test_spec_models_exist():
    from app.asset_models.spec import AssetSpec, EnvFeature, Item, ItemFlag, SiteFrame

    assert {"site", "items", "environment"} <= set(AssetSpec.model_fields)
    assert {"id", "tag", "type", "footprint", "base_el", "top_el", "height_source", "source", "flags", "parts"} <= set(
        Item.model_fields
    )
    assert {"code", "value", "note"} <= set(ItemFlag.model_fields)
    assert {"id", "kind", "pts", "el", "source"} <= set(EnvFeature.model_fields)
    assert {"crs", "origin_crs", "plant_north_deg", "datum", "cloud_z_to_el", "source"} <= set(SiteFrame.model_fields)


def test_siteframe_functions_exist():
    from app.asset_models import siteframe

    for name in ("PlantGrid", "fit_plant_grid", "footprint_ref", "footprint_polygon", "GridError"):
        assert hasattr(siteframe, name), name
    assert list(inspect.signature(siteframe.fit_plant_grid).parameters) == ["pairs"]


def test_builders_registry_exists():
    from app.asset_models import builders

    for name in ("REGISTRY", "BuildCtx", "MeshNode", "Instanced", "build_item", "catalogue", "load_all"):
        assert hasattr(builders, name), name
    builders.load_all()
    assert "other" in builders.REGISTRY and "composite" in builders.REGISTRY


def test_package_table_and_model_kind_exist():
    from app.db.models import AssetModel, SiteModelPackage

    cols = set(SiteModelPackage.__table__.columns.keys())
    assert {
        "id", "run_id", "n", "label", "drawing_id", "region", "area", "state",
        "usage", "item_count", "summary", "started_at", "ended_at",
    } <= cols
    assert "kind" in AssetModel.__table__.columns.keys()


def test_plant_modes():
    from app.asset_models.agent.plant import PLANT_MODES

    assert PLANT_MODES == ("plant", "plant_package")
```

- [ ] **Step 3: Run it to verify it fails**

Run: `$PY -m pytest tests/test_plant_run_f0_interfaces.py -v`

Expected: `test_plant_modes` FAILS with `ModuleNotFoundError: No module named 'app.asset_models.agent.plant'`. The other four PASS. If any of the four fails, Step 1's mapping is incomplete: fix the test to F0's real name and record it in the ledger.

- [ ] **Step 4: Create the package**

```python
# backend/app/asset_models/agent/plant/__init__.py
"""The plant run (spec 2026-10-03-plant-model-generator §8). Kept import-light: the runner imports
`PLANT_MODES` on every asset-model run."""

PLANT_MODES: tuple[str, ...] = ("plant", "plant_package")
```

- [ ] **Step 5: Run it to verify it passes**

Run: `$PY -m pytest tests/test_plant_run_f0_interfaces.py -v`
Expected: 5 passed.

- [ ] **Step 6: Commit**

```bash
git add backend/app/asset_models/agent/plant/__init__.py backend/tests/test_plant_run_f0_interfaces.py
git commit -m "test(plant-run): pin the F0 interfaces R1 builds on" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Run limits, the shared budget and the cost estimate

**Files:**
- Create: `backend/app/asset_models/agent/plant/budget.py`
- Test: `backend/tests/test_plant_budget.py`

**Interfaces:**
- Consumes: nothing beyond the stdlib. `appdata` is any object with `read_settings() -> dict` (`app.appdata.AppData`; jobs reach it as `ctx.runner.provider_config.appdata`).
- Produces: `PlantLimits`, `RunBudget`, `load_default_limits`, `resolve_limits`, `limits_from`, `PRICE_TABLE`, `COST_LABEL`, `estimate_cost_usd`, `STAGES`, `SETTINGS_KEY`, as in "Interfaces provided".

- [ ] **Step 1: Write the failing tests**

```python
# backend/tests/test_plant_budget.py
"""RunBudget is shared by the orchestrator and up to 8 sub-run threads (spec §8.4)."""

import threading

from app.asset_models.agent.plant.budget import (
    COST_LABEL,
    PlantLimits,
    RunBudget,
    estimate_cost_usd,
    limits_from,
    load_default_limits,
    resolve_limits,
)


class Clock:
    def __init__(self):
        self.t = 1000.0

    def __call__(self):
        return self.t


def test_charges_sum_over_threads():
    b = RunBudget(PlantLimits(max_tokens=10**9))

    def work():
        for _ in range(1000):
            b.charge({"input_tokens": 3, "output_tokens": 1}, "trace")
            b.charge_call("trace")

    threads = [threading.Thread(target=work) for _ in range(8)]
    for t in threads:
        t.start()
    for t in threads:
        t.join()
    snap = b.snapshot("trace")
    assert snap["input_tokens"] == 24000 and snap["output_tokens"] == 8000
    assert snap["by_stage"]["trace"] == {"input_tokens": 24000, "output_tokens": 8000, "calls": 8000, "images": 0}
    assert snap["current"] == "trace" and b.tokens() == 32000


def test_token_limit_exhausts():
    b = RunBudget(PlantLimits(max_tokens=100))
    b.charge({"input_tokens": 60, "output_tokens": 39}, "survey")
    assert b.exhausted() is None
    b.charge({"input_tokens": 1, "output_tokens": 0}, "survey")
    assert b.exhausted() == "tokens"


def test_clock_limit_counts_time_from_before_a_restart():
    clock = Clock()
    b = RunBudget(PlantLimits(max_seconds=100), elapsed_s=90, clock=clock)
    assert b.exhausted() is None
    clock.t += 11
    assert b.exhausted() == "time" and round(b.elapsed_s()) == 101


def test_images_stop_at_the_run_limit_without_ending_the_run():
    b = RunBudget(PlantLimits(max_images=2))
    assert [b.charge_image("trace") for _ in range(3)] == [True, True, False]
    assert b.exhausted() is None and b.snapshot("trace")["by_stage"]["trace"]["images"] == 2


def test_a_resumed_budget_keeps_earlier_usage():
    b = RunBudget(PlantLimits())
    b.charge({"input_tokens": 5, "output_tokens": 5}, "survey")
    b.charge_call("survey")
    again = RunBudget(PlantLimits(), used=b.snapshot("trace"))
    assert again.tokens() == 10 and again.snapshot("trace")["by_stage"]["survey"]["calls"] == 1


def test_unknown_usage_keys_and_bad_values_are_ignored():
    b = RunBudget(PlantLimits())
    b.charge({"input_tokens": "x", "output_tokens": None, "other": 5}, "trace")
    b.charge(None, "trace")
    assert b.tokens() == 0


def test_cost_estimate_is_labelled_and_known_models_only():
    assert estimate_cost_usd("claude-opus-5-5", {"input_tokens": 1_000_000, "output_tokens": 100_000}) == 6.0
    assert estimate_cost_usd("some-other-model", {"input_tokens": 1}) is None
    assert "estimate" in COST_LABEL.lower()


class FakeAppData:
    def __init__(self, values=None, boom=False):
        self.values, self.boom = values or {}, boom

    def read_settings(self):
        if self.boom:
            raise OSError("C:/secret/settings.json")
        return self.values


def test_settings_defaults_are_clamped_and_overridable(caplog):
    data = FakeAppData({"plant_run_limits": {"max_tokens": 5, "parallel": 99, "max_images": "x"}})
    lim = load_default_limits(data)
    assert lim.max_tokens == 100_000 and lim.parallel == 8 and lim.max_images == 400
    assert resolve_limits(data, {"parallel": 2}).parallel == 2
    assert resolve_limits(None, None) == PlantLimits()
    assert load_default_limits(FakeAppData(boom=True)) == PlantLimits()
    assert "secret" not in caplog.text


def test_limits_from_round_trips_without_clamping():
    lim = PlantLimits(max_tokens=1000, parallel=2)
    from dataclasses import asdict

    assert limits_from(asdict(lim)) == lim
    assert limits_from({"junk": 1}) == PlantLimits()
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `$PY -m pytest tests/test_plant_budget.py -v`
Expected: FAIL with `ModuleNotFoundError: No module named 'app.asset_models.agent.plant.budget'`.

- [ ] **Step 3: Implement**

```python
# backend/app/asset_models/agent/plant/budget.py
"""Plant run limits, the run budget shared by every conversation, and the cost estimate (spec §8.4).

`RunBudget` is charged from the orchestrator thread and from up to `parallel` sub-run threads, so
every read and write holds one lock. Usage keeps a per-stage split for the Run tab
(`usage_by_stage`)."""

from __future__ import annotations

import logging
import math
import threading
import time
from dataclasses import dataclass, fields, replace

log = logging.getLogger(__name__)

SETTINGS_KEY = "plant_run_limits"
STAGES = ("survey", "trace", "merge", "cloud_check", "review", "environment", "build")
_COUNTERS = ("input_tokens", "output_tokens", "calls", "images")


@dataclass(frozen=True)
class PlantLimits:
    max_tokens: int = 40_000_000
    max_images: int = 400
    max_seconds: int = 14_400
    parallel: int = 4
    sub_calls: int = 150
    sub_tokens: int = 4_000_000
    sub_images: int = 60


BOUNDS = {
    "max_tokens": (100_000, 200_000_000),
    "max_images": (0, 2_000),
    "max_seconds": (60, 43_200),
    "parallel": (1, 8),
    "sub_calls": (5, 1_000),
    "sub_tokens": (50_000, 40_000_000),
    "sub_images": (0, 400),
}


def _clean(values: dict, base: PlantLimits) -> PlantLimits:
    out = {}
    for key, (lo, hi) in BOUNDS.items():
        v = values.get(key)
        if isinstance(v, bool) or not isinstance(v, (int, float)) or not math.isfinite(v):
            continue
        out[key] = int(min(max(v, lo), hi))
    return replace(base, **out)


def load_default_limits(appdata) -> PlantLimits:
    """settings.json `plant_run_limits`, clamped; defaults when missing or unreadable (logged, no text)."""
    try:
        values = appdata.read_settings().get(SETTINGS_KEY) or {}
    except Exception as e:  # noqa: BLE001 - an unreadable settings file never blocks a run
        log.warning("plant run limits could not be read (%s); using defaults", type(e).__name__)
        return PlantLimits()
    return _clean(values, PlantLimits()) if isinstance(values, dict) else PlantLimits()


def resolve_limits(appdata, override: dict | None) -> PlantLimits:
    base = load_default_limits(appdata) if appdata is not None else PlantLimits()
    return _clean(override or {}, base)


def limits_from(d: dict | None) -> PlantLimits:
    """The limits a run stored at start (already clamped by the route; tests store small ones)."""
    known = {f.name for f in fields(PlantLimits)}
    return PlantLimits(**{k: int(v) for k, v in (d or {}).items() if k in known})


@dataclass(frozen=True)
class Price:
    input_usd_mtok: float
    output_usd_mtok: float


# List prices per million tokens (claude-api skill, cached 2026-09-25). An estimate, not a bill:
# llm.complete folds cache reads into input_tokens, so cached input is priced as fresh input.
PRICE_TABLE: dict[str, Price] = {
    "claude-opus-5-5": Price(4.00, 20.00),
    "claude-opus-5": Price(5.00, 25.00),
    "claude-sonnet-5-5": Price(2.00, 10.00),
    "claude-fable-5-1": Price(10.00, 50.00),
}
COST_LABEL = "Estimate from list prices, not a bill. Cached input is priced as fresh input."


def estimate_cost_usd(model_name: str, usage: dict) -> float | None:
    price = PRICE_TABLE.get(model_name)
    if price is None:
        return None
    tin = int(usage.get("input_tokens", 0) or 0)
    tout = int(usage.get("output_tokens", 0) or 0)
    return round((tin * price.input_usd_mtok + tout * price.output_usd_mtok) / 1_000_000, 2)


def _int(v) -> int:
    return int(v) if isinstance(v, (int, float)) and not isinstance(v, bool) and math.isfinite(v) else 0


class RunBudget:
    def __init__(self, limits: PlantLimits, *, used: dict | None = None, elapsed_s: float = 0.0, clock=time.monotonic):
        self.limits = limits
        self._clock = clock
        self._lock = threading.Lock()
        self._t0 = clock() - float(elapsed_s or 0.0)
        earlier = (used or {}).get("by_stage") or {}
        self._stages: dict[str, dict[str, int]] = {}
        for stage, row in earlier.items():
            if isinstance(row, dict):
                self._stages[str(stage)] = {k: _int(row.get(k)) for k in _COUNTERS}

    def _row(self, stage: str) -> dict[str, int]:
        return self._stages.setdefault(stage, dict.fromkeys(_COUNTERS, 0))

    def charge(self, usage: dict | None, stage: str) -> None:
        if not isinstance(usage, dict):
            return
        with self._lock:
            row = self._row(stage)
            row["input_tokens"] += _int(usage.get("input_tokens"))
            row["output_tokens"] += _int(usage.get("output_tokens"))

    def charge_call(self, stage: str) -> None:
        with self._lock:
            self._row(stage)["calls"] += 1

    def charge_image(self, stage: str) -> bool:
        with self._lock:
            if sum(r["images"] for r in self._stages.values()) >= self.limits.max_images:
                return False
            self._row(stage)["images"] += 1
            return True

    def tokens(self) -> int:
        with self._lock:
            return sum(r["input_tokens"] + r["output_tokens"] for r in self._stages.values())

    def elapsed_s(self) -> float:
        return self._clock() - self._t0

    def exhausted(self) -> str | None:
        if self.tokens() >= self.limits.max_tokens:
            return "tokens"
        if self.elapsed_s() >= self.limits.max_seconds:
            return "time"
        return None

    def snapshot(self, current: str) -> dict:
        with self._lock:
            by_stage = {s: dict(r) for s, r in self._stages.items()}
        return {
            "input_tokens": sum(r["input_tokens"] for r in by_stage.values()),
            "output_tokens": sum(r["output_tokens"] for r in by_stage.values()),
            "current": current,
            "by_stage": by_stage,
        }
```

Note on the token limit: it is `>=` (spent means stop). `test_token_limit_exhausts` charges 99 of 100, then 100.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `$PY -m pytest tests/test_plant_budget.py -v`
Expected: 9 passed.

- [ ] **Step 5: Commit**

```bash
git add backend/app/asset_models/agent/plant/budget.py backend/tests/test_plant_budget.py
git commit -m "feat(plant-run): limits, thread-safe run budget and cost estimate" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Run state on disk and `site_model_package` helpers

**Files:**
- Create: `backend/app/asset_models/agent/plant/state.py`
- Create: `backend/app/asset_models/agent/plant/packages.py`
- Test: `backend/tests/test_plant_packages.py`

**Interfaces:**
- Consumes: F0 `SiteModelPackage`, `Item`, `EnvFeature`, `SiteFrame`; M1 `AssetModelRun`.
- Produces:
  - `state.py`: `PlantState` (fields below), `STAGE_ORDER`, `plant_dir`, `load_state`, `save_state`, `save_package_items`, `load_package_items`, `save_merged`, `load_merged`, `site_of`, `env_of`.
  - `packages.py`: everything listed under "Interfaces provided".

- [ ] **Step 1: Write the failing tests**

```python
# backend/tests/test_plant_packages.py
"""Plant run state files and package rows (spec §8.2.2, §8.4, §9)."""

import json

import pytest

from app.asset_models.agent.plant import packages as pk
from app.asset_models.agent.plant.state import (
    PlantState,
    env_of,
    load_merged,
    load_package_items,
    load_state,
    save_merged,
    save_package_items,
    save_state,
    site_of,
)
from app.asset_models.spec import Item
from app.db.models import AssetModel, AssetModelRun


def _item(i, tag=None):
    return Item.model_validate(
        {
            "id": i,
            "tag": tag,
            "name": i,
            "type": "other",
            "footprint": {"kind": "rect", "center": [0, 0], "size": [4, 2], "rot_deg": 0},
            "source": {"kind": "assumed"},
        }
    )


@pytest.fixture
def run_ids(handle):
    with handle.session() as s:
        m = AssetModel(name="Plant")
        s.add(m)
        s.flush()
        r = AssetModelRun(model_id=m.id, job_id="j", provider="anthropic", model_name="x", mode="plant", sources=[])
        s.add(r)
        s.flush()
        return m.id, r.id


def test_state_round_trips_and_ignores_unknown_keys(tmp_path):
    st = PlantState(stage="trace", interrupts={"p": 1}, notes=["n"], limits={"parallel": 2})
    save_state(tmp_path, st)
    raw = json.loads((tmp_path / "plant" / "state.json").read_text("utf-8"))
    raw["from_the_future"] = 1
    (tmp_path / "plant" / "state.json").write_text(json.dumps(raw), "utf-8")
    again = load_state(tmp_path)
    assert again.stage == "trace" and again.interrupts == {"p": 1} and again.limits == {"parallel": 2}
    assert load_state(tmp_path / "nothing") == PlantState()


def test_package_items_and_merged_files(tmp_path):
    assert load_package_items(tmp_path, 3) is None and load_merged(tmp_path) is None
    save_package_items(tmp_path, 3, [_item("a"), _item("b", "T-1")])
    save_merged(tmp_path, [_item("a")])
    assert [i.id for i in load_package_items(tmp_path, 3)] == ["a", "b"]
    assert [i.id for i in load_merged(tmp_path)] == ["a"]
    assert not list((tmp_path / "plant").rglob("*.tmp"))


def test_site_and_env_of_an_empty_state():
    assert site_of(PlantState()) is None and env_of(PlantState()) == []


def test_replace_queued_keeps_started_packages(handle, run_ids):
    _, run_id = run_ids
    with handle.session() as s:
        first = pk.replace_queued(s, run_id, [{"label": "A", "drawing_id": "d", "region": [0, 0, 0.5, 1]}, {"label": "B"}])
        pk.set_state(s, first[0].id, "running")
        again = pk.replace_queued(s, run_id, [{"label": "C", "area": "20"}])
        rows = pk.rows(s, run_id)
        assert [(r.n, r.label, r.state) for r in rows] == [(1, "A", "running"), (2, "C", "queued")]
        assert again[0].area == "20" and rows[0].started_at is not None


def test_states_summary_and_mark_unfinished(handle, run_ids):
    _, run_id = run_ids
    with handle.session() as s:
        a, b, c = pk.replace_queued(s, run_id, [{"label": "A"}, {"label": "B"}, {"label": "C"}])
        pk.set_state(s, a.id, "done", usage={"input_tokens": 5}, item_count=7, summary="ok")
        pk.set_state(s, b.id, "running")
        assert pk.summary(s, run_id) == {"total": 3, "done": 1, "failed": 0, "running": 1}
        assert pk.mark_unfinished(s, run_id, "skipped", "Not started.") == ["B", "C"]
        assert [r.state for r in pk.rows(s, run_id)] == ["done", "skipped", "skipped"]
        assert a.item_count == 7 and a.usage == {"input_tokens": 5} and a.ended_at is not None


def test_work_of_and_rerun_copies(handle, run_ids):
    model_id, run_id = run_ids
    with handle.session() as s:
        (a,) = pk.replace_queued(s, run_id, [{"label": "A", "drawing_id": "d1", "region": [0, 0, 1, 1], "area": "20"}])
        w = pk.work_of(a, {"brief": "Tanks", "expected_tags": ["20-T-0001"]})
        assert (w.n, w.label, w.region, w.brief, w.expected_tags) == (1, "A", (0, 0, 1, 1), "Tanks", ("20-T-0001",))
        assert pk.work_of(a, {}).brief == "A"
        run2 = AssetModelRun(model_id=model_id, job_id="j2", provider="anthropic", model_name="x", mode="plant_package", sources=[])
        s.add(run2)
        s.flush()
        found = pk.find_for_model(s, model_id, [a.id, "nope"])
        copies = pk.copy_for_rerun(s, run2.id, found)
        assert [(c.label, c.drawing_id, c.area, c.state, c.run_id) for c in copies] == [("A", "d1", "20", "queued", run2.id)]
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `$PY -m pytest tests/test_plant_packages.py -v`
Expected: FAIL with `ModuleNotFoundError` for `...plant.packages`.

- [ ] **Step 3: Implement `state.py`**

```python
# backend/app/asset_models/agent/plant/state.py
"""What a plant run keeps on disk so it can resume (spec §8.4), under `<run_dir>/plant/`:
- `state.json`: stage, frame, environment, package briefs, interrupt counts, limits, notes;
- `packages/<n>.json`: a finished package's items;
- `merged.json`: the merged item list once merge has run.

The spec data only; never prompts, model text, keys or paths."""

from __future__ import annotations

import json
from dataclasses import asdict, dataclass, field, fields
from pathlib import Path

from app.asset_models.spec import EnvFeature, Item, SiteFrame

STAGE_ORDER = ("survey", "trace", "merge", "cloud_check", "review", "environment", "build", "done")


@dataclass
class PlantState:
    stage: str = "survey"
    site: dict | None = None
    environment: list[dict] = field(default_factory=list)
    packages_meta: dict[str, dict] = field(default_factory=dict)  # package id -> {brief, expected_tags}
    interrupts: dict[str, int] = field(default_factory=dict)  # package id -> times cut off while running
    run_interrupts: int = 0
    elapsed_s: float = 0.0
    limits: dict = field(default_factory=dict)
    package_ids: list[str] = field(default_factory=list)  # plant_package: the packages being redone
    base_version: int | None = None
    questions: list[str] = field(default_factory=list)  # open questions raised by tools (app text)
    notes: list[str] = field(default_factory=list)  # app-written run notes (cloud check skipped, ...)
    fix_rounds: int = 0
    candidates: list[dict] = field(default_factory=list)


def plant_dir(run_dir: Path) -> Path:
    return Path(run_dir) / "plant"


def _atomic(path: Path, text: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_name(path.name + ".tmp")
    tmp.write_text(text, encoding="utf-8")
    tmp.replace(path)


def load_state(run_dir: Path) -> PlantState:
    path = plant_dir(run_dir) / "state.json"
    if not path.exists():
        return PlantState()
    raw = json.loads(path.read_text("utf-8"))
    known = {f.name for f in fields(PlantState)}
    return PlantState(**{k: v for k, v in raw.items() if k in known})


def save_state(run_dir: Path, st: PlantState) -> None:
    _atomic(plant_dir(run_dir) / "state.json", json.dumps(asdict(st), separators=(",", ":")))


def _dump(items: list[Item]) -> str:
    return json.dumps([i.model_dump(mode="json") for i in items], separators=(",", ":"))


def _load(path: Path) -> list[Item] | None:
    if not path.exists():
        return None
    return [Item.model_validate(x) for x in json.loads(path.read_text("utf-8"))]


def save_package_items(run_dir: Path, n: int, items: list[Item]) -> None:
    _atomic(plant_dir(run_dir) / "packages" / f"{int(n)}.json", _dump(items))


def load_package_items(run_dir: Path, n: int) -> list[Item] | None:
    return _load(plant_dir(run_dir) / "packages" / f"{int(n)}.json")


def save_merged(run_dir: Path, items: list[Item]) -> None:
    _atomic(plant_dir(run_dir) / "merged.json", _dump(items))


def load_merged(run_dir: Path) -> list[Item] | None:
    return _load(plant_dir(run_dir) / "merged.json")


def site_of(st: PlantState) -> SiteFrame | None:
    return SiteFrame.model_validate(st.site) if st.site else None


def env_of(st: PlantState) -> list[EnvFeature]:
    return [EnvFeature.model_validate(x) for x in st.environment]
```

- [ ] **Step 4: Implement `packages.py`**

```python
# backend/app/asset_models/agent/plant/packages.py
"""`site_model_package` rows (spec §9): one per package of a plant run, plus the work a sub-run gets."""

from __future__ import annotations

from dataclasses import dataclass

from sqlalchemy import select

from app.db.base import utcnow
from app.db.models import AssetModelRun, SiteModelPackage

TERMINAL = ("done", "failed", "skipped")


@dataclass(frozen=True)
class PackageWork:
    id: str
    n: int
    label: str
    drawing_id: str | None
    region: tuple[float, ...] | None
    area: str | None
    brief: str
    expected_tags: tuple[str, ...] = ()


def rows(s, run_id: str) -> list[SiteModelPackage]:
    return list(
        s.scalars(select(SiteModelPackage).where(SiteModelPackage.run_id == run_id).order_by(SiteModelPackage.n))
    )


def replace_queued(s, run_id: str, specs: list[dict]) -> list[SiteModelPackage]:
    """Drop the run's still-queued packages and add `specs` after the highest kept n (the survey may
    re-plan; started packages are kept)."""
    kept = []
    for r in rows(s, run_id):
        if r.state == "queued":
            s.delete(r)
        else:
            kept.append(r)
    s.flush()
    n0 = max((r.n for r in kept), default=0)
    out = []
    for k, spec in enumerate(specs, start=1):
        region = spec.get("region")
        row = SiteModelPackage(
            run_id=run_id,
            n=n0 + k,
            label=str(spec["label"])[:80],
            drawing_id=spec.get("drawing_id"),
            region=[float(v) for v in region] if region else None,
            area=spec.get("area"),
            state="queued",
            usage={},
            item_count=0,
            summary=None,
        )
        s.add(row)
        out.append(row)
    s.flush()
    return out


def set_state(s, package_id: str, state: str, *, usage=None, item_count=None, summary=None) -> None:
    row = s.get(SiteModelPackage, package_id)
    row.state = state
    if state == "running":
        row.started_at, row.ended_at = utcnow(), None
    elif state == "queued":
        row.started_at, row.ended_at = None, None
    if state in TERMINAL:
        row.ended_at = utcnow()
    if usage is not None:
        row.usage = dict(usage)
    if item_count is not None:
        row.item_count = int(item_count)
    if summary is not None:
        row.summary = summary[:2000]


def summary(s, run_id: str) -> dict:
    out = {"total": 0, "done": 0, "failed": 0, "running": 0}
    for r in rows(s, run_id):
        out["total"] += 1
        if r.state in ("done", "failed", "running"):
            out[r.state] += 1
    return out


def mark_unfinished(s, run_id: str, state: str = "skipped", note: str | None = None) -> list[str]:
    changed = []
    for r in rows(s, run_id):
        if r.state in ("queued", "running"):
            set_state(s, r.id, state, summary=note)
            changed.append(r.label)
    return changed


def work_of(row, meta: dict) -> PackageWork:
    return PackageWork(
        id=row.id,
        n=row.n,
        label=row.label,
        drawing_id=row.drawing_id,
        region=tuple(row.region) if row.region else None,
        area=row.area,
        brief=str(meta.get("brief") or row.label),
        expected_tags=tuple(meta.get("expected_tags") or ()),
    )


def find_for_model(s, model_id: str, ids) -> list[SiteModelPackage]:
    return list(
        s.scalars(
            select(SiteModelPackage)
            .join(AssetModelRun, AssetModelRun.id == SiteModelPackage.run_id)
            .where(AssetModelRun.model_id == model_id, SiteModelPackage.id.in_(list(ids)))
            .order_by(SiteModelPackage.n)
        )
    )


def copy_for_rerun(s, run_id: str, old: list[SiteModelPackage]) -> list[SiteModelPackage]:
    specs = [{"label": r.label, "drawing_id": r.drawing_id, "region": r.region, "area": r.area} for r in old]
    return replace_queued(s, run_id, specs)
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `$PY -m pytest tests/test_plant_packages.py -v`
Expected: 6 passed.

- [ ] **Step 6: Commit**

```bash
git add backend/app/asset_models/agent/plant/state.py backend/app/asset_models/agent/plant/packages.py backend/tests/test_plant_packages.py
git commit -m "feat(plant-run): run state files and site_model_package helpers" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Merge items across packages

**Files:**
- Create: `backend/app/asset_models/agent/plant/merge.py`
- Test: `backend/tests/test_plant_merge.py`

**Interfaces:**
- Consumes: F0 `Item`, `ItemFlag`, `footprint_ref`, `footprint_polygon`; shapely.
- Produces: `merge_items(lists, labels=None) -> list[Item]`, `with_flag(item, flag) -> Item`, `norm_tag(tag) -> str | None`.

- [ ] **Step 1: Write the failing tests**

```python
# backend/tests/test_plant_merge.py
"""Merge (spec §8.2.3, ruling R9): same tag merges; untagged same-type items overlapping > 60 % merge;
conflicts get straddles_package; ids end unique."""

from app.asset_models.agent.plant.merge import merge_items, norm_tag, with_flag
from app.asset_models.spec import Item, ItemFlag


def it(i, *, tag=None, type="other", e=0.0, n=0.0, size=(10.0, 6.0), conf="medium"):
    return Item.model_validate(
        {
            "id": i,
            "tag": tag,
            "name": i,
            "type": type,
            "footprint": {"kind": "rect", "center": [e, n], "size": list(size), "rot_deg": 0},
            "source": {"kind": "assumed"},
            "confidence": conf,
        }
    )


def test_norm_tag():
    assert norm_tag(" 20-t_0001 ") == "20-T0001" and norm_tag(None) is None and norm_tag("") is None


def test_same_tag_keeps_one_item_and_prefers_confidence_then_newer():
    out = merge_items([[it("a", tag="20-T-0001", conf="high")], [it("b", tag="20-T-0001")]], ["P1", "P2"])
    assert [i.id for i in out] == ["a"]
    out = merge_items([[it("a", tag="20-T-0001")], [it("b", tag="20-t-0001 ")]], ["P1", "P2"])
    assert [i.id for i in out] == ["b"] and out[0].flags == []


def test_same_tag_far_apart_or_other_type_is_flagged():
    out = merge_items([[it("a", tag="T1", e=0)], [it("b", tag="T1", e=30)]], ["P1", "P2"])
    (only,) = out
    flag = only.flags[0]
    assert flag.code == "straddles_package" and flag.value == 30.0 and "P1" in flag.note
    out = merge_items([[it("a", tag="T1")], [it("b", tag="T1", type="composite")]], ["P1", "P2"])
    assert out[0].flags[0].code == "straddles_package"


def test_untagged_overlap_merges_only_same_type_over_sixty_percent():
    a, b = it("a", e=0), it("b", e=2)  # 10x6 boxes shifted 2 m: overlap 8/10 = 80 %
    assert len(merge_items([[a], [b]])) == 1
    far = it("c", e=7)  # overlap 3/10 = 30 %
    assert len(merge_items([[a], [far]])) == 2
    other_type = it("d", e=2, type="composite")
    assert len(merge_items([[a], [other_type]])) == 2


def test_ids_end_unique():
    out = merge_items([[it("x", tag="T1")], [it("x", tag="T2", e=100)]])
    assert sorted(i.id for i in out) == ["x", "x-2"]


def test_with_flag_replaces_the_same_code():
    a = with_flag(it("a"), ItemFlag(code="builder_fallback", note="one"))
    a = with_flag(a, ItemFlag(code="builder_fallback", note="two"))
    assert [(f.code, f.note) for f in a.flags] == [("builder_fallback", "two")]


def test_many_untagged_items_merge_quickly():
    import time

    items = [it(f"u{k}", e=(k % 50) * 20.0, n=(k // 50) * 20.0) for k in range(2000)]
    t0 = time.monotonic()
    out = merge_items([items, items])
    assert len(out) == 2000 and time.monotonic() - t0 < 10
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `$PY -m pytest tests/test_plant_merge.py -v`
Expected: FAIL with `ModuleNotFoundError` for `...plant.merge`.

- [ ] **Step 3: Implement**

```python
# backend/app/asset_models/agent/plant/merge.py
"""Merge the packages' item lists into one register (spec §8.2.3; ruling R9). Pure: no I/O.

Later lists are newer (a later package, or a re-run over a version). Same normalised tag: one item
survives (highest confidence, then newest); a loser of another type or more than 2 m away flags the
survivor `straddles_package`. Untagged items of one type whose footprints overlap more than 60 % of
the smaller one merge the same way, unflagged. Ids are made unique."""

from __future__ import annotations

import math
import re

from shapely import STRtree
from shapely.geometry import Polygon

from app.asset_models.siteframe import footprint_polygon, footprint_ref
from app.asset_models.spec import Item, ItemFlag

CONF = {"high": 2, "medium": 1, "low": 0}
OVERLAP = 0.6
STRADDLE_M = 2.0
_SEP = re.compile(r"[\s_]+")


def norm_tag(tag: str | None) -> str | None:
    if not tag:
        return None
    return _SEP.sub("", tag).upper() or None


def with_flag(item: Item, flag: ItemFlag) -> Item:
    flags = [f for f in item.flags if f.code != flag.code] + [flag]
    return item.model_copy(update={"flags": flags})


def _rank(entry) -> tuple[int, int]:
    k, item = entry
    return CONF.get(item.confidence, 0), k


def _poly(item: Item) -> Polygon:
    p = Polygon(footprint_polygon(item.footprint))
    return p if p.is_valid else p.buffer(0)


def merge_items(lists: list[list[Item]], labels: list[str] | None = None) -> list[Item]:
    labels = labels or [f"list {k + 1}" for k in range(len(lists))]
    entries = [(k, item) for k, items in enumerate(lists) for item in items]
    by_tag: dict[str, list] = {}
    untagged = []
    for e in entries:
        t = norm_tag(e[1].tag)
        (by_tag.setdefault(t, []) if t else untagged).append(e)
    out: list[Item] = []
    for group in by_tag.values():
        win_k, win = max(group, key=_rank)
        wx, wy = footprint_ref(win.footprint)
        worst, worst_label = None, None
        for k, other in group:
            if other is win:
                continue
            ox, oy = footprint_ref(other.footprint)
            d = math.hypot(ox - wx, oy - wy)
            if other.type != win.type or d > STRADDLE_M:
                if worst is None or d > worst:
                    worst, worst_label = d, labels[k]
        if worst is not None:
            win = with_flag(
                win,
                ItemFlag(
                    code="straddles_package",
                    value=round(worst, 2),
                    note=f"Also traced in {worst_label}, {worst:.1f} m away.",
                ),
            )
        out.append(win)
    out.extend(_merge_untagged(untagged))
    return _unique_ids(out)


def _merge_untagged(entries) -> list[Item]:
    by_type: dict[str, list] = {}
    for e in entries:
        by_type.setdefault(e[1].type, []).append(e)
    kept: list[Item] = []
    for group in by_type.values():
        polys = [_poly(item) for _, item in group]
        tree = STRtree(polys)
        alive = [True] * len(group)
        order = sorted(range(len(group)), key=lambda i: _rank(group[i]), reverse=True)
        for i in order:  # strongest first: it absorbs the weaker items it overlaps
            if not alive[i]:
                continue
            for j in tree.query(polys[i]):
                j = int(j)
                if j == i or not alive[j]:
                    continue
                smaller = min(polys[i].area, polys[j].area)
                if smaller > 0 and polys[i].intersection(polys[j]).area / smaller > OVERLAP:
                    alive[j] = False
        kept.extend(group[i][1] for i in range(len(group)) if alive[i])
    return kept


def _unique_ids(items: list[Item]) -> list[Item]:
    seen: set[str] = set()
    out = []
    for item in items:
        new, k = item.id, 1
        while new in seen:
            k += 1
            suffix = f"-{k}"
            new = item.id[: 64 - len(suffix)] + suffix
        seen.add(new)
        out.append(item if new == item.id else item.model_copy(update={"id": new}))
    return out
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `$PY -m pytest tests/test_plant_merge.py -v`
Expected: 7 passed.

- [ ] **Step 5: Commit**

```bash
git add backend/app/asset_models/agent/plant/merge.py backend/tests/test_plant_merge.py
git commit -m "feat(plant-run): merge package item lists by tag and overlap" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Run context, recorder, model call, and the register tools

**Files:**
- Create: `backend/app/asset_models/agent/plant/context.py`
- Create: `backend/app/asset_models/agent/plant/record.py`
- Create: `backend/app/asset_models/agent/plant/model.py`
- Create: `backend/app/asset_models/agent/plant/tools_plant.py`
- Create: `backend/tests/plant_fakes.py`
- Test: `backend/tests/test_plant_tools_items.py`

**Interfaces:**
- Consumes:
  - Task 2: `RunBudget`, `PlantLimits`, `limits_from`.
  - Task 3: `PlantState`, `load_state`, `save_state`, `save_merged`, `load_merged`, `site_of`, `env_of`, `packages.*`.
  - Task 4: `with_flag`.
  - M1: `RunContext`, `ToolOut`, `_A`, `_short`, `Region`, `FinishArgs`, `TOOLS`, `run_tool`, `_describe_sources`, `_thumb`, `_call_model`, `EFFORT`, `KEY_MISSING`.
  - F0: `Item`, `EnvFeature`, `ItemFlag`, `REGISTRY`, `catalogue`, `load_all`, `PlantGrid`, `footprint_ref`.
- Produces:
  - `context.Scope(name, stage, items, package=None, calls=0, images=0, finished=None, next_stage=None, wrap_up=False, rendered=False)`.
  - `context.PlantRunContext`, with the fields below and the methods `handle`, `run_dir`, `check_cancelled()`, `site()`, `grid()`, `drawing_ids()`, `save()`, `save_store()`.
  - `context.build_context(job) -> PlantRunContext`.
  - `record.Recorder(job, model_id, run_id)`, with `.enter(stage, done=None, total=None)`, `.step(scope_name, tool, out) -> int`, `.usage(budget)`, and the constants `PHASE`, `MAX_STEPS`.
  - `model.call_model(rc, *, system, history, tools) -> ModelReply` and `model.RATE_RETRIES_S`.
  - `tools_plant`: `PLANT_TOOLS`, `ORCH_NAMES`, `SUB_NAMES`, `LOOK`, `specs_for(role)`, `run_plant_tool(rc, scope, name, raw) -> ToolOut`, `execute(rc, scope, call) -> ToolResult`, `admit_image(rc, scope, out)`, `check_item(raw) -> (Item | None, list[str])`, `catalogue_text() -> str`.
  - `tests/plant_fakes.py`: `reply`, `PlantCtx`, `FakePlantLlm`, `seed_plant`, `make_ctx`, `make_rc`, `item`, `KIPIC`, `KEY`.

- [ ] **Step 1: Write the fake harness**

```python
# backend/tests/plant_fakes.py
"""Scripted fake model and job context for the plant run. Extends M1's FakeLlm/Ctx pattern
(test_asset_model_run_job.py) to several conversations running at once: each call is routed to the
orchestrator's script or to one package's script."""

from __future__ import annotations

import itertools
import re
import threading
from dataclasses import asdict

from app.asset_models import store
from app.asset_models.agent.plant.budget import PlantLimits
from app.asset_models.agent.plant.state import PlantState, save_state
from app.db.models import AssetModel, AssetModelRun, Drawing
from app.jobs.cancellation import JobCancelled
from app.project_agent.history import ModelReply, ToolCall

KEY = "SECRET-KEY-123"
KIPIC = {
    "epsg": 32639,
    "origin_crs": [244338.089, 3179515.690],
    "plant_north_deg": 17.9991,
    "datum_label": "HPFS",
    "datum_el_m": 100.0,
}
_ids = itertools.count()


def reply(*calls, text="", usage=(100, 50)):
    return ModelReply(
        text=text,
        tool_calls=[ToolCall(f"c{next(_ids)}", name, args) for name, args in calls],
        provider_payload=None,
        usage={"input_tokens": usage[0], "output_tokens": usage[1]},
    )


class PlantCtx:
    """A job context whose cancel flag is a threading.Event, like the real JobContext."""

    def __init__(self, handle, runner, params):
        self.project, self.runner, self.params, self.job_id = handle, runner, params, "job-run"
        self.cancelled = threading.Event()
        self.published, self.messages = [], []
        self._lock = threading.Lock()

    def progress(self, fraction, message=""):
        with self._lock:
            self.messages.append(message)

    def publish(self, type_, payload):
        with self._lock:
            self.published.append((type_, payload))

    def check_cancelled(self):
        if self.cancelled.is_set():
            raise JobCancelled()


class FakePlantLlm:
    """A script step is a ModelReply, an exception to raise, or a callable returning either. The
    callable runs in the calling (sub-run) thread, so a threading.Barrier in it proves parallelism."""

    def __init__(self, orchestrator=(), packages=None):
        self.scripts = {"orchestrator": list(orchestrator)}
        for name, steps in (packages or {}).items():
            self.scripts[name] = list(steps)
        self.calls: list[dict] = []
        self.lock = threading.Lock()

    def of(self, conv: str) -> list[dict]:
        return [c for c in self.calls if c["conv"] == conv]

    async def __call__(self, provider, *, api_key, model, system, history, tools, effort=None, cache=False):
        from app.asset_models.agent.plant.prompt_plant import ORCH_SYSTEM

        if system == ORCH_SYSTEM:
            conv = "orchestrator"
        else:
            m = re.match(r"Package (P\d+):", history[0].text or "")
            conv = m.group(1) if m else "?"
        with self.lock:
            self.calls.append(
                {
                    "conv": conv,
                    "history_len": len(history),
                    "api_key": api_key,
                    "cache": cache,
                    "effort": effort,
                    "tools": [t.name for t in tools],
                    "user_texts": [h.text for h in history if h.role == "user"],
                }
            )
            script = self.scripts.setdefault(conv, [])
            step = script.pop(0) if script else reply(text="Nothing more to do.")
        if callable(step):
            step = step()
        if isinstance(step, BaseException):
            raise step
        return step


def seed_plant(handle, app, *, mode="plant", pages=2, limits=None, clouds=()):
    """A plant model, its running run, `pages` ready PDF pages of one file and the run's state file."""
    app.state.keys.set("anthropic", KEY)
    with handle.session() as s:
        drawings = [
            Drawing(
                name=f"Plot plan — p{k + 1}",
                format="pdf",
                status="ready",
                source_path="C:/plans/plot.pdf",
                source_size=1,
                source_sha256="sha-plot",
                page=k + 1,
                width=4000,
                height=2800,
                dpi=150,
            )
            for k in range(pages)
        ]
        s.add_all(drawings)
        m = AssetModel(name="Plant", status="building")
        s.add(m)
        s.flush()
        sources = [{"type": "drawing", "id": d.id} for d in drawings]
        sources += [{"type": "point_cloud", "id": c} for c in clouds]
        run = AssetModelRun(
            model_id=m.id,
            job_id="job-run",
            provider="anthropic",
            model_name="claude-opus-5-5",
            mode=mode,
            sources=sources,
        )
        s.add(run)
        s.flush()
        m.live_run_id = run.id
        ids = {"model": m.id, "run": run.id, "drawings": [d.id for d in drawings]}
    save_state(store.run_dir(handle, ids["model"], ids["run"]), PlantState(limits=asdict(limits or PlantLimits())))
    return ids


def make_ctx(handle, app, ids) -> PlantCtx:
    return PlantCtx(handle, app.state.jobs, {"model_id": ids["model"], "run_id": ids["run"]})


def make_rc(handle, app, ids, ctx=None):
    from app.asset_models.agent.plant.context import build_context

    return build_context(ctx or make_ctx(handle, app, ids))


def item(i, *, tag=None, type="other", e=0.0, n=0.0, size=(10.0, 6.0), did=None, conf="medium", **extra):
    src = extra.pop("source", None) or ({"kind": "drawing", "id": did} if did else {"kind": "assumed"})
    return {
        "id": i,
        "tag": tag,
        "name": extra.pop("name", i),
        "type": type,
        "footprint": {"kind": "rect", "center": [e, n], "size": list(size), "rot_deg": 0},
        "base_el": 100.0,
        "top_el": 106.0,
        "height_source": "drawing",
        "source": src,
        "confidence": conf,
        **extra,
    }
```

- [ ] **Step 2: Write the failing tests**

```python
# backend/tests/test_plant_tools_items.py
"""The register tools of the plant run (spec §8.3): per-item validation, stage rules, bounds."""

import pytest
from plant_fakes import item, make_rc, seed_plant

from app.asset_models.agent.plant import packages as pk
from app.asset_models.agent.plant import record
from app.asset_models.agent.plant import tools_plant as T
from app.asset_models.agent.plant.context import Scope
from app.asset_models.agent.plant.packages import PackageWork
from app.asset_models.agent.plant.state import load_merged
from app.asset_models.agent.tools import ToolOut
from app.db.models import AssetModelRun


@pytest.fixture
def rc(handle, app):
    ids = seed_plant(handle, app)
    r = make_rc(handle, app, ids)
    r.test_ids = ids
    return r


def pkg(rc, n=1, expected=("20-T-0001", "20-T-0002")):
    w = PackageWork(
        id=f"p{n}", n=n, label="Tanks", drawing_id=rc.test_ids["drawings"][0], region=None, area="20",
        brief="b", expected_tags=tuple(expected),
    )
    return Scope(name=f"P{n}", stage="trace", items={}, package=w)


def orch(rc, stage):
    return Scope(name="orchestrator", stage=stage, items=rc.store)


def test_upsert_items_partial_accept(rc):
    sc = pkg(rc)
    bad_type = item("b1", type="no_such_type")
    crossing = item("b2")
    crossing["footprint"] = {"kind": "polygon", "pts": [[0, 0], [10, 10], [10, 0], [0, 10]]}
    upside = item("b3", base_el=110.0, top_el=100.0)
    goods = [item(f"g{k}", tag=f"20-T-{k:04d}", e=k * 20.0) for k in range(147)]
    out = T.run_plant_tool(rc, sc, "upsert_items", {"items": [*goods[:70], bad_type, crossing, upside, *goods[70:]]})
    assert out.ok and len(sc.items) == 147 and set(sc.items) == {f"g{k}" for k in range(147)}
    assert "Rejected 3" in out.text and "- b1:" in out.text and "unknown type" in out.text
    assert "- b2:" in out.text and "- b3:" in out.text
    assert out.summary == "Saved 147 items, rejected 3"


def test_more_than_150_items_is_a_bad_arguments_error(rc):
    out = T.run_plant_tool(rc, pkg(rc), "upsert_items", {"items": [item(f"g{k}") for k in range(151)]})
    assert not out.ok and out.text.startswith("Bad arguments for upsert_items")


def test_orchestrator_cannot_write_items_during_the_survey(rc):
    out = T.run_plant_tool(rc, orch(rc, "survey"), "upsert_items", {"items": [item("a")]})
    assert not out.ok and "plan_packages" in out.text and rc.store == {}


def test_review_marks_new_cloud_items_unregistered_and_saves_the_store(rc):
    sc = orch(rc, "review")
    cloud_item = item("c1", source={"kind": "cloud", "id": "cloud-1"})
    out = T.run_plant_tool(rc, sc, "upsert_items", {"items": [cloud_item, item("d1")]})
    assert out.ok
    assert [f.code for f in rc.store["c1"].flags] == ["unregistered"] and rc.store["d1"].flags == []
    assert {i.id for i in load_merged(rc.run_dir)} == {"c1", "d1"}


def test_two_fix_rounds_then_finish(rc):
    sc = orch(rc, "build")
    for k in range(2):
        sc.rendered = True
        assert T.run_plant_tool(rc, sc, "upsert_items", {"items": [item(f"f{k}")]}).ok
    assert T.run_plant_tool(rc, sc, "upsert_items", {"items": [item("f9")]}).ok  # no render since: same round
    sc.rendered = True
    out = T.run_plant_tool(rc, sc, "upsert_items", {"items": [item("f3")]})
    assert not out.ok and "call finish" in out.text and rc.state.fix_rounds == 2


def test_remove_items(rc):
    sc = pkg(rc)
    T.run_plant_tool(rc, sc, "upsert_items", {"items": [item("a"), item("b")]})
    out = T.run_plant_tool(rc, sc, "remove_items", {"ids": ["a", "zz"]})
    assert out.ok and set(sc.items) == {"b"} and "zz" in out.text


def test_items_query_filters_pages_and_lists_missing_expected_tags(rc):
    sc = pkg(rc)
    batch = [item(f"g{k}", tag=f"20-T-{k:04d}", e=float(k)) for k in range(150)]
    T.run_plant_tool(rc, sc, "upsert_items", {"items": batch})
    T.run_plant_tool(rc, sc, "upsert_items", {"items": [item(f"h{k}", e=float(k), area="30") for k in range(150)]})
    T.run_plant_tool(rc, sc, "upsert_items", {"items": [item(f"j{k}", e=float(k)) for k in range(100)]})
    out = T.run_plant_tool(rc, sc, "items_query", {})
    assert out.text.startswith("400 items match") and "(more: call again with start=" in out.text
    assert out.text.count("\n") <= 300 + 4 and len(out.text) <= T.MAX_TEXT
    one = T.run_plant_tool(rc, sc, "items_query", {"tag": "t-0002"})
    assert one.text.startswith("1 items match") and "g2 | 20-T-0002" in one.text
    assert T.run_plant_tool(rc, sc, "items_query", {"area": "30"}).text.startswith("150 items match")
    assert T.run_plant_tool(rc, sc, "items_query", {"bbox": [0, -1, 9.5, 1]}).text.startswith("30 items match")
    T.run_plant_tool(rc, sc, "remove_items", {"ids": ["g1"]})
    assert "Expected but not traced yet: 20-T-0001" in T.run_plant_tool(rc, sc, "items_query", {}).text


def test_plan_packages_writes_rows_only_in_the_survey(rc, handle):
    sc = orch(rc, "survey")
    d0 = rc.test_ids["drawings"][0]
    body = {"packages": [
        {"label": "Tanks", "drawing_id": d0, "region": [0, 0, 0.5, 1], "area": "20", "brief": "8 LNG tanks", "expected_tags": ["20-T-0001"]},
        {"label": "Jetty", "drawing_id": d0, "region": [0.5, 0, 1, 1]},
    ]}
    out = T.run_plant_tool(rc, sc, "plan_packages", body)
    assert out.ok and "P1 Tanks" in out.text and "P2 Jetty" in out.text
    with handle.session() as s:
        rows = pk.rows(s, rc.run_id)
        assert [r.label for r in rows] == ["Tanks", "Jetty"]
        assert rc.state.packages_meta[rows[0].id] == {"brief": "8 LNG tanks", "expected_tags": ["20-T-0001"]}
    foreign = T.run_plant_tool(rc, sc, "plan_packages", {"packages": [{"label": "X", "drawing_id": "nope"}]})
    assert not foreign.ok and "not one of this run's drawings" in foreign.text
    late = T.run_plant_tool(rc, orch(rc, "review"), "plan_packages", body)
    assert not late.ok and "survey" in late.text
    assert not T.run_plant_tool(rc, pkg(rc), "plan_packages", body).ok  # not a package tool


def test_next_stage_needs_a_package_and_finish_needs_the_build_stage(rc):
    sc = orch(rc, "survey")
    assert not T.run_plant_tool(rc, sc, "next_stage", {"summary": "done"}).ok
    T.run_plant_tool(rc, sc, "plan_packages", {"packages": [{"label": "A", "drawing_id": rc.test_ids["drawings"][0]}]})
    assert T.run_plant_tool(rc, sc, "next_stage", {"summary": "1 package"}).ok and sc.next_stage == "1 package"
    assert not T.run_plant_tool(rc, orch(rc, "environment"), "finish", {"summary": "x"}).ok
    b = orch(rc, "build")
    assert not T.run_plant_tool(rc, b, "next_stage", {"summary": "x"}).ok
    assert T.run_plant_tool(rc, b, "finish", {"summary": "Built.", "open_questions": ["Q?"]}).ok
    assert rc.finished == {"summary": "Built.", "open_questions": ["Q?"]}


def test_finish_package(rc):
    sc = pkg(rc)
    assert T.run_plant_tool(rc, sc, "finish_package", {"summary": "Traced 4.", "open_questions": ["Tag?"]}).ok
    assert sc.finished == {"summary": "Traced 4.", "open_questions": ["Tag?"]}


def test_catalogue(rc):
    sc = pkg(rc)
    listing = T.run_plant_tool(rc, sc, "catalogue", {})
    assert listing.ok and "other (fallback" in listing.text
    one = T.run_plant_tool(rc, sc, "catalogue", {"type": "other"})
    assert one.ok and '"params_schema"' in one.text
    assert not T.run_plant_tool(rc, sc, "catalogue", {"type": "warp_drive"}).ok
    assert "other (fallback" in T.catalogue_text()


def test_upsert_environment(rc):
    sea = {"id": "sea", "kind": "sea", "pts": [[0, 0], [100, 0], [100, 50]], "el": 100.0, "source": {"kind": "assumed"}}
    bow = {"id": "bad", "kind": "land", "pts": [[0, 0], [10, 10], [10, 0], [0, 10]], "el": 100.0, "source": {"kind": "assumed"}}
    assert not T.run_plant_tool(rc, orch(rc, "survey"), "upsert_environment", {"features": [sea]}).ok
    out = T.run_plant_tool(rc, orch(rc, "environment"), "upsert_environment", {"features": [sea, bow]})
    assert out.ok and [f["id"] for f in rc.state.environment] == ["sea"] and "- bad:" in out.text


def test_tool_sets_by_role():
    orch_names = [s.name for s in T.specs_for("orchestrator")]
    sub_names = [s.name for s in T.specs_for("package")]
    assert "plan_packages" in orch_names and "finish" in orch_names and "finish_package" not in orch_names
    assert "plan_packages" not in sub_names and "finish" not in sub_names and "finish_package" in sub_names
    assert {"drawing_view", "drawing_text", "list_sources"} <= set(sub_names)
    assert all(s.input_schema.get("type") == "object" for s in T.specs_for("package"))


def test_m1_look_tools_run_for_packages(rc):
    out = T.run_plant_tool(rc, pkg(rc), "list_sources", {})
    assert out.ok and "Plot plan" in out.text


def test_a_tool_bug_is_a_tool_error_with_the_type_name_only(rc, monkeypatch):
    def boom(*_a):
        raise ValueError("C:/secret/path and payload")

    monkeypatch.setattr(T.PLANT_TOOLS["items_query"], "run", boom)
    out = T.run_plant_tool(rc, pkg(rc), "items_query", {})
    assert not out.ok and "ValueError" in out.text and "secret" not in out.text


def test_images_are_capped_per_package_and_per_run(rc):
    from dataclasses import replace

    rc.limits = replace(rc.limits, sub_images=1)
    sc = pkg(rc)
    first, second = ToolOut("a", "s", image=b"jpg"), ToolOut("b", "s", image=b"jpg")
    T.admit_image(rc, sc, first)
    T.admit_image(rc, sc, second)
    assert first.image == b"jpg" and second.image is None and "image budget" in second.text


def test_recorder_prefixes_package_steps_and_keeps_the_newest(rc, handle, monkeypatch):
    monkeypatch.setattr(record, "MAX_STEPS", 3)
    for k in range(5):
        rc.recorder.step("P2" if k % 2 else "orchestrator", "items_query", ToolOut("t", f"step {k}"))
    with handle.session() as s:
        steps = s.get(AssetModelRun, rc.run_id).steps
    assert [st["n"] for st in steps] == [3, 4, 5]
    assert steps[1]["summary"] == "P2 · step 3" and steps[2]["summary"] == "step 4"
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `$PY -m pytest tests/test_plant_tools_items.py -v`
Expected: FAIL with `ModuleNotFoundError: No module named 'app.asset_models.agent.plant.context'`.

- [ ] **Step 4: Implement `record.py`**

```python
# backend/app/asset_models/agent/plant/record.py
"""Writes to the run row, shared by the orchestrator and the sub-run threads. One lock serialises the
read-modify-write of `run.steps` and `run.usage`. Steps hold tool names and app-written summaries only."""

from __future__ import annotations

import threading
import time

from app.db.models import AssetModelRun

PHASE = {
    "survey": "reading",
    "trace": "building",
    "merge": "building",
    "cloud_check": "checking",
    "review": "checking",
    "environment": "building",
    "build": "checking",
    "done": "done",
}
PROGRESS = {"survey": 0.02, "trace": 0.10, "merge": 0.80, "cloud_check": 0.83, "review": 0.88, "environment": 0.91, "build": 0.95}
LABEL = {
    "survey": "Reading the drawings",
    "trace": "Tracing packages",
    "merge": "Merging packages",
    "cloud_check": "Checking against the point cloud",
    "review": "Reviewing the cloud check",
    "environment": "Tracing land, sea and roads",
    "build": "Building and checking the model",
}
MAX_STEPS = 400
PUBLISH_EVERY_S = 1.0


class Recorder:
    def __init__(self, job, model_id: str, run_id: str):
        self.job, self.model_id, self.run_id = job, model_id, run_id
        self.lock = threading.Lock()
        self.stage = "survey"
        with job.project.session() as s:
            steps = s.get(AssetModelRun, run_id).steps or []
        self.n = max((int(st.get("n", 0)) for st in steps), default=0)
        self._published = 0.0

    def _publish(self, force: bool = False) -> None:
        now = time.monotonic()
        if force or now - self._published >= PUBLISH_EVERY_S:
            self._published = now
            self.job.publish("asset_models.changed", {"asset_model_ids": [self.model_id], "run_id": self.run_id})

    def enter(self, stage: str, done: int | None = None, total: int | None = None) -> None:
        with self.lock:
            self.stage = stage
            with self.job.project.session() as s:
                s.get(AssetModelRun, self.run_id).phase = PHASE.get(stage, "building")
        fraction, message = PROGRESS.get(stage, 0.0), LABEL.get(stage, stage)
        if stage == "trace" and total:
            fraction = 0.10 + 0.70 * (done or 0) / total
            message = f"{message} ({done or 0}/{total})"
        self.job.progress(fraction, message)
        self._publish(force=True)

    def step(self, scope_name: str, tool: str, out) -> int:
        from app.asset_models.agent.runner import _thumb

        with self.lock:
            self.n += 1
            n = self.n
            if out.image:
                _thumb(self.job, self.run_id, self.model_id, n, out.image)
            prefix = "" if scope_name == "orchestrator" else f"{scope_name} · "
            entry = {
                "n": n,
                "tool": tool,
                "ok": out.ok,
                "summary": (prefix + out.summary)[:300],
                "has_thumb": bool(out.image),
                "phase": PHASE.get(self.stage, "building"),
            }
            with self.job.project.session() as s:
                run = s.get(AssetModelRun, self.run_id)
                keep = (run.steps or [])[-(MAX_STEPS - 1) :] if MAX_STEPS > 1 else []
                run.steps = [*keep, entry]
        self._publish()
        return n

    def usage(self, budget) -> None:
        with self.lock:
            snap = budget.snapshot(self.stage)
            with self.job.project.session() as s:
                s.get(AssetModelRun, self.run_id).usage = snap
```

- [ ] **Step 5: Implement `model.py`**

```python
# backend/app/asset_models/agent/plant/model.py
"""One model call for any plant conversation (ruling R12):
- the key comes from the KeyStore at call time and is dropped right after;
- the call stops when the job is cancelled;
- a rate limit is retried after 20, 40 and 80 s, and the wait is cancel-aware.

Every other LlmError is raised to the caller."""

from __future__ import annotations

import time

from app.asset_models.agent.runner import EFFORT, KEY_MISSING, _call_model
from app.project_agent.history import LlmError
from app.project_agent.llm import _RATE_LIMITED

RATE_RETRIES_S: tuple[float, ...] = (20.0, 40.0, 80.0)


def call_model(rc, *, system: str, history: list, tools: list):
    llm = rc.job.runner.agent_llm
    if llm is None:
        raise LlmError("The model is not available.")
    attempt = 0
    while True:
        key = rc.job.runner.keys.get(rc.provider)
        if not key:
            raise LlmError(KEY_MISSING)
        try:
            return _call_model(
                rc.job,
                llm,
                provider=rc.provider,
                api_key=key,
                model=rc.model_name,
                system=system,
                history=history,
                tools=tools,
                effort=EFFORT,
                cache=True,
            )
        except LlmError as e:
            if e.message != _RATE_LIMITED or attempt >= len(RATE_RETRIES_S):
                raise
            wait = RATE_RETRIES_S[attempt]
            attempt += 1
        finally:
            del key
        _sleep(rc, wait)


def _sleep(rc, seconds: float) -> None:
    end = time.monotonic() + seconds
    while True:
        rc.check_cancelled()
        left = end - time.monotonic()
        if left <= 0:
            return
        time.sleep(min(0.25, left))
```

- [ ] **Step 6: Implement `context.py`**

```python
# backend/app/asset_models/agent/plant/context.py
"""The plant run's shared context and one conversation's scope (spec §8.2)."""

from __future__ import annotations

import threading
from dataclasses import dataclass, field
from typing import Any

from app.asset_models.agent.plant.budget import PlantLimits, RunBudget, limits_from
from app.asset_models.agent.plant.packages import PackageWork
from app.asset_models.agent.plant.record import Recorder
from app.asset_models.agent.plant.state import PlantState, load_merged, load_state, save_merged, save_state, site_of
from app.asset_models.agent.tools import RunContext
from app.asset_models.siteframe import PlantGrid
from app.asset_models.spec import AssetSpec, Item, SiteFrame
from app.db.models import AssetModelRun


@dataclass
class Scope:
    """One conversation: the orchestrator's (`package` None, `items` is the merged store) or one package's."""

    name: str
    stage: str
    items: dict[str, Item]
    package: PackageWork | None = None
    calls: int = 0
    images: int = 0
    finished: dict | None = None
    next_stage: str | None = None
    wrap_up: bool = False
    rendered: bool = False


@dataclass
class PlantRunContext:
    job: Any
    model_id: str
    run_id: str
    provider: str
    model_name: str
    mode: str
    sources: list[dict]
    limits: PlantLimits
    budget: RunBudget
    state: PlantState
    m1: RunContext
    recorder: Recorder
    notes: str | None = None
    store: dict[str, Item] = field(default_factory=dict)
    lock: threading.RLock = field(default_factory=threading.RLock)
    inflight: dict[str, Scope] = field(default_factory=dict)
    cloud: Any = None
    check: Any = None
    finished: dict | None = None

    @property
    def handle(self):
        return self.job.project

    @property
    def run_dir(self):
        return self.m1.run_dir

    def check_cancelled(self) -> None:
        self.job.check_cancelled()

    def site(self) -> SiteFrame | None:
        return site_of(self.state)

    def grid(self) -> PlantGrid | None:
        site = self.site()
        return PlantGrid(site) if site is not None else None

    def drawing_ids(self) -> set[str]:
        return {x["id"] for x in self.sources if x["type"] == "drawing"}

    def save(self) -> None:
        with self.lock:
            self.state.elapsed_s = self.budget.elapsed_s()
            save_state(self.run_dir, self.state)

    def save_store(self) -> None:
        with self.lock:
            save_merged(self.run_dir, list(self.store.values()))


def build_context(job) -> PlantRunContext:
    from app.asset_models.agent.runner import _describe_sources

    model_id, run_id = job.params["model_id"], job.params["run_id"]
    with job.project.session() as s:
        run = s.get(AssetModelRun, run_id)
        provider, model_name, mode, notes = run.provider, run.model_name, run.mode, run.notes
        sources, used = list(run.sources or []), dict(run.usage or {})
    m1 = RunContext(
        handle=job.project,
        model_id=model_id,
        run_id=run_id,
        sources=_describe_sources(job, sources),
        spec=AssetSpec(),
        samples={},
    )
    state = load_state(m1.run_dir)
    limits = limits_from(state.limits)
    rc = PlantRunContext(
        job=job,
        model_id=model_id,
        run_id=run_id,
        provider=provider,
        model_name=model_name,
        mode=mode,
        sources=m1.sources,
        limits=limits,
        budget=RunBudget(limits, used=used, elapsed_s=state.elapsed_s),
        state=state,
        m1=m1,
        recorder=Recorder(job, model_id, run_id),
        notes=notes,
    )
    merged = load_merged(m1.run_dir)
    if merged:
        rc.store.update({i.id: i for i in merged})
    return rc
```

- [ ] **Step 7: Implement `tools_plant.py` (register tools, dispatcher)**

```python
# backend/app/asset_models/agent/plant/tools_plant.py
"""The plant run's tools (spec §8.3), in M1's ToolOut style. They are app code only, their reads are
bounded, and they never raise to the caller. Tools act on a Scope:
- in a package, on its own item buffer;
- in the orchestrator, on the merged store (`rc.store`)."""

from __future__ import annotations

import base64
import json
import logging
import time
from typing import Annotated

from pydantic import Field, ValidationError
from shapely.geometry import LineString, Polygon

from app.asset_models.agent.plant import packages as pk
from app.asset_models.agent.plant.merge import with_flag
from app.asset_models.agent.tools import TOOLS as M1_TOOLS
from app.asset_models.agent.tools import FinishArgs, Region, ToolOut, _A, _short
from app.asset_models.agent.tools import run_tool as run_m1_tool
from app.asset_models.builders import REGISTRY, catalogue, load_all
from app.asset_models.look import LookError
from app.asset_models.siteframe import footprint_ref
from app.asset_models.spec import EnvFeature, Item, ItemFlag
from app.project_agent.history import ToolResult, ToolSpec
from app.project_agent.tools import clean_schema

log = logging.getLogger(__name__)
MAX_TEXT = 8000
MAX_ITEMS = 20_000
QUERY_ROWS = 300
ROW_BUDGET = 7000  # characters of rows per items_query answer, under MAX_TEXT
MAX_FIX_ROUNDS = 2
LOOK = ("list_sources", "drawing_view", "drawing_text", "cloud_slice", "cloud_fit", "photo_view")
ENV_STAGES = ("review", "environment", "build")
NO_IMAGE = "\n(The image budget is used up, so no image was attached.)"


# ------------------------------------------------------------------ item checks
def check_item(raw) -> tuple[Item | None, list[str]]:
    """One item, or the reasons it can't be saved (schema, registry type, its params, footprint, heights)."""
    try:
        item = Item.model_validate(raw)
    except ValidationError as e:
        return None, [_short(e).replace("\n", "; ")]
    errors = []
    load_all()
    d = REGISTRY.get(item.type)
    if d is None:
        errors.append(f"unknown type {item.type[:40]!r} (call catalogue for the types)")
    else:
        try:
            d.params.model_validate(item.params)
        except ValidationError as e:
            errors.append("params: " + _short(e).replace("\n", "; "))
    if item.base_el is not None and item.top_el is not None and item.top_el < item.base_el:
        errors.append("top_el is below base_el")
    fp = item.footprint
    if fp.kind == "polygon" and not Polygon([tuple(p) for p in fp.pts]).is_valid:
        errors.append("the footprint polygon crosses itself")
    if fp.kind == "line" and LineString([tuple(p) for p in fp.pts]).length <= 0:
        errors.append("the footprint line has no length")
    return (None, errors) if errors else (item, [])


def _num(v) -> str:
    return "?" if v is None else f"{v:g}"


def _row(i: Item) -> str:
    e, n = footprint_ref(i.footprint)
    flags = ",".join(f.code for f in i.flags) or "-"
    return (
        f"{i.id} | {i.tag or '-'} | {i.type} | {i.area or '-'} | {e:.1f},{n:.1f} | "
        f"{_num(i.base_el)}-{_num(i.top_el)} {i.height_source} | {flags}"
    )


def _begin_write(rc, scope, what: str) -> str | None:
    """A refusal text, or None. In the build stage the first write after a render opens a fix round."""
    if scope.package is not None:
        return None
    if scope.stage == "survey":
        return f"{what} are written once tracing has run: plan_packages, then next_stage."
    if scope.stage == "build" and scope.rendered:
        if rc.state.fix_rounds >= MAX_FIX_ROUNDS:
            return "Both fix rounds are used: call finish."
        rc.state.fix_rounds += 1
        scope.rendered = False
    return None


# ------------------------------------------------------------------ register tools
class UpsertItemsArgs(_A):
    items: Annotated[list[dict], Field(min_length=1, max_length=150)]


class UpsertItems:
    name, Args = "upsert_items", UpsertItemsArgs
    description = (
        "Add items to the register, or replace items with the same id. Up to 150 per call. Plant metres "
        "[E, N] on the drawing's grid, elevations plant EL in metres. Each item is checked on its own: "
        "valid ones are saved, invalid ones are listed with the reason. Fields: id (slug), tag (only "
        "if legible; else null), name, type (see catalogue), area, footprint {kind: rect, center, size: "
        "[along, across], rot_deg} | {kind: circle, center, d} | {kind: polygon, pts} | {kind: line, "
        "pts, width}, base_el, top_el, levels, params (per type), height_source drawing|cloud|indicative, "
        "source {kind, id, page, region}, confidence, notes, parts (M1 parts, item-local mm)."
    )

    def run(self, rc, scope, a):
        refusal = _begin_write(rc, scope, "Items")
        if refusal:
            return ToolOut(refusal, "Items not saved", ok=False, phase="building")
        saved, rejected = [], []
        with rc.lock:
            for k, raw in enumerate(a.items):
                label = raw.get("id") if isinstance(raw.get("id"), str) else f"#{k + 1}"
                item, errors = check_item(raw)
                if errors:
                    rejected.append(f"- {label[:64]}: {'; '.join(errors)}")
                    continue
                if item.id not in scope.items and len(scope.items) >= MAX_ITEMS:
                    rejected.append(f"- {item.id}: the model already holds {MAX_ITEMS} items")
                    continue
                new_from_cloud = (
                    scope.package is None and scope.stage == "review" and item.id not in scope.items
                    and item.source.kind == "cloud"
                )
                if new_from_cloud:
                    item = with_flag(
                        item, ItemFlag(code="unregistered", note="Found in the point cloud, not on the drawings.")
                    )
                scope.items[item.id] = item
                saved.append(item.id)
            total = len(scope.items)
        if scope.package is None:
            rc.save_store()
            rc.save()
        where = "this package" if scope.package is not None else "the model"
        text = f"Saved {len(saved)} item(s); {where} has {total}."
        if rejected:
            text += f"\nRejected {len(rejected)} (fix them and send again):\n" + "\n".join(rejected[:60])
        return ToolOut(
            text,
            f"Saved {len(saved)} items, rejected {len(rejected)}",
            ok=bool(saved) or not rejected,
            phase="building",
        )


class RemoveItemsArgs(_A):
    ids: Annotated[list[Annotated[str, Field(max_length=64)]], Field(min_length=1, max_length=500)]


class RemoveItems:
    name, Args = "remove_items", RemoveItemsArgs
    description = "Remove items from the register by id."

    def run(self, rc, scope, a):
        refusal = _begin_write(rc, scope, "Items")
        if refusal:
            return ToolOut(refusal, "Items not removed", ok=False, phase="building")
        with rc.lock:
            missing = [i for i in a.ids if i not in scope.items]
            for i in a.ids:
                scope.items.pop(i, None)
            total = len(scope.items)
        if scope.package is None:
            rc.save_store()
            rc.save()
        note = f" Not found: {', '.join(missing[:30])}." if missing else ""
        return ToolOut(f"Removed {len(a.ids) - len(missing)}; {total} left.{note}", f"Removed {len(a.ids) - len(missing)} items", phase="building")


class ItemsQueryArgs(_A):
    area: str | None = Field(None, max_length=60)
    type: str | None = Field(None, max_length=60)
    tag: str | None = Field(None, max_length=64, description="case-insensitive part of the tag")
    flag: str | None = Field(None, max_length=40)
    bbox: Annotated[list[float], Field(min_length=4, max_length=4)] | None = Field(
        None, description="[E0, N0, E1, N1] plant metres; matches by footprint reference point"
    )
    start: int = Field(0, ge=0)


class ItemsQuery:
    name, Args = "items_query", ItemsQueryArgs
    description = (
        "List register items as compact rows (id | tag | type | area | E,N | base-top height_source | "
        "flags), filtered by area, type, tag, flag or bbox. At most 300 rows per call; page with start."
    )

    def run(self, rc, scope, a):
        with rc.lock:
            items = list(scope.items.values())
        out = []
        for i in items:
            if a.area and i.area != a.area:
                continue
            if a.type and i.type != a.type:
                continue
            if a.tag and a.tag.lower() not in (i.tag or "").lower():
                continue
            if a.flag and a.flag not in {f.code for f in i.flags}:
                continue
            if a.bbox:
                e, n = footprint_ref(i.footprint)
                if not (a.bbox[0] <= e <= a.bbox[2] and a.bbox[1] <= n <= a.bbox[3]):
                    continue
            out.append(i)
        page, used = [], 0
        for i in out[a.start : a.start + QUERY_ROWS]:  # <= 300 rows and <= ROW_BUDGET characters
            line = _row(i)
            if used + len(line) + 1 > ROW_BUDGET:
                break
            page.append(line)
            used += len(line) + 1
        nxt = a.start + len(page)
        lines = [f"{len(out)} items match; rows {a.start}..{nxt}.", *page]
        if nxt < len(out):
            lines.append(f"(more: call again with start={nxt})")
        if scope.package is not None and scope.package.expected_tags:
            have = {(i.tag or "").upper() for i in items}
            missing = [t for t in scope.package.expected_tags if t.upper() not in have]
            if missing:
                lines.append("Expected but not traced yet: " + ", ".join(missing[:100]))
        return ToolOut("\n".join(lines), f"Queried items: {len(out)} match")


class CatalogueArgs(_A):
    type: str | None = Field(None, max_length=60)


def catalogue_text() -> str:
    load_all()
    return "\n".join(
        f"{x['type']} ({x['family']}, default height {x['default_height_m']:g} m): {x['doc']}" for x in catalogue()
    )


class Catalogue:
    name, Args = "catalogue", CatalogueArgs
    description = "The builder types: without type, one line each; with type, its parameter schema and defaults."

    def run(self, rc, scope, a):
        if not a.type:
            return ToolOut(catalogue_text(), "Read the catalogue")
        load_all()
        entry = next((x for x in catalogue() if x["type"] == a.type), None)
        if entry is None:
            return ToolOut(f"There is no type {a.type!r}. Call catalogue without a type for the list.", "Unknown type", ok=False)
        return ToolOut(json.dumps(entry, separators=(",", ":")), f"Read the {a.type} schema")


class EnvArgs(_A):
    features: Annotated[list[dict], Field(min_length=1, max_length=50)]


class UpsertEnvironment:
    name, Args = "upsert_environment", EnvArgs
    description = (
        "Add or replace environment polygons (land, sea, road, paved, laydown, slope, revetment): "
        "{id, kind, pts: [[E, N], ...] (>= 3, plant m), el (plant EL m), source, confidence}. Up to 50 per call."
    )

    def run(self, rc, scope, a):
        if scope.package is not None or scope.stage not in ENV_STAGES:
            return ToolOut("The environment is traced in the environment stage.", "Environment not saved", ok=False, phase="building")
        refusal = _begin_write(rc, scope, "Environment features")
        if refusal:
            return ToolOut(refusal, "Environment not saved", ok=False, phase="building")
        saved, rejected = [], []
        with rc.lock:
            by_id = {f["id"]: f for f in rc.state.environment}
            for k, raw in enumerate(a.features):
                label = raw.get("id") if isinstance(raw.get("id"), str) else f"#{k + 1}"
                try:
                    feat = EnvFeature.model_validate(raw)
                except ValidationError as e:
                    rejected.append(f"- {label[:64]}: {_short(e).replace(chr(10), '; ')}")
                    continue
                if len(feat.pts) < 3 or not Polygon([tuple(p) for p in feat.pts]).is_valid:
                    rejected.append(f"- {feat.id}: the polygon needs 3+ points and must not cross itself")
                    continue
                by_id[feat.id] = feat.model_dump(mode="json")
                saved.append(feat.id)
            rc.state.environment = list(by_id.values())
        rc.save()
        text = f"Saved {len(saved)} feature(s); the environment has {len(rc.state.environment)}."
        if rejected:
            text += f"\nRejected {len(rejected)}:\n" + "\n".join(rejected)
        return ToolOut(text, f"Saved {len(saved)} environment features", ok=bool(saved) or not rejected, phase="building")


# ------------------------------------------------------------------ stage tools
class PackageSpec(_A):
    label: str = Field(min_length=1, max_length=80)
    drawing_id: str
    region: Region | None = Field(None, description="[x0, y0, x1, y1] page fractions; null = the whole page")
    area: str | None = Field(None, max_length=60)
    brief: str = Field("", max_length=2000)
    expected_tags: Annotated[list[Annotated[str, Field(max_length=64)]], Field(max_length=300)] = Field(default_factory=list)


class PlanArgs(_A):
    packages: Annotated[list[PackageSpec], Field(min_length=1, max_length=64)]


class PlanPackages:
    name, Args = "plan_packages", PlanArgs
    description = (
        "Split the tracing into packages (survey stage only; calling again replaces the packages not yet "
        "started). Each package: one region of one drawing page, an area label, a brief (what is there, the "
        "scale) and the tags expected from the equipment list. Size each for one sub-run: about 20-60 items."
    )

    def run(self, rc, scope, a):
        if scope.package is not None or scope.stage != "survey":
            return ToolOut("Packages are planned during the survey.", "Packages not planned", ok=False)
        bad = sorted({p.drawing_id for p in a.packages if p.drawing_id not in rc.drawing_ids()})
        if bad:
            return ToolOut(f"Not one of this run's drawings: {', '.join(bad)}.", "Packages not planned", ok=False)
        for p in a.packages:
            if p.region and (p.region[2] <= p.region[0] or p.region[3] <= p.region[1]):
                return ToolOut(f"Package {p.label!r}: region needs x1 > x0 and y1 > y0.", "Packages not planned", ok=False)
        with rc.lock, rc.handle.session() as s:
            rows = pk.replace_queued(s, rc.run_id, [p.model_dump() for p in a.packages])
            live = {r.id for r in pk.rows(s, rc.run_id)}
            meta = {k: v for k, v in rc.state.packages_meta.items() if k in live}
            for row, p in zip(rows, a.packages, strict=True):
                meta[row.id] = {"brief": p.brief, "expected_tags": list(p.expected_tags)}
            listing = [f"P{r.n} {r.label} (drawing {r.drawing_id}, area {r.area or '-'})" for r in rows]
            rc.state.packages_meta = meta
        rc.save()
        return ToolOut(
            f"Planned {len(rows)} packages:\n" + "\n".join(listing) + "\nCall next_stage when the survey is done.",
            f"Planned {len(rows)} packages",
        )


class NextStageArgs(_A):
    summary: str = Field(max_length=2000)


class NextStage:
    name, Args = "next_stage", NextStageArgs
    description = "Close the current stage with a short summary; the app starts the next one."

    def run(self, rc, scope, a):
        if scope.stage == "build":
            return ToolOut("This is the last stage: call finish.", "Stage not closed", ok=False)
        if scope.stage == "survey":
            with rc.handle.session() as s:
                if not pk.rows(s, rc.run_id):
                    return ToolOut("Plan at least one package with plan_packages first.", "Stage not closed", ok=False)
        scope.next_stage = a.summary
        return ToolOut("Stage closed.", f"Closed the {scope.stage} stage")


class PlantFinish:
    name, Args = "finish", FinishArgs
    description = "End the run after the build stage's self-check: a short summary and honest open questions."

    def run(self, rc, scope, a):
        if scope.stage != "build":
            return ToolOut("finish ends the run in the build stage; use next_stage to move on.", "Not finished", ok=False)
        rc.finished = {"summary": a.summary, "open_questions": list(a.open_questions)}
        return ToolOut("Finished.", "Finished", phase="done")


class FinishPackageArgs(_A):
    summary: str = Field(max_length=2000)
    open_questions: Annotated[list[Annotated[str, Field(max_length=500)]], Field(max_length=10)] = Field(default_factory=list)


class FinishPackage:
    name, Args = "finish_package", FinishPackageArgs
    description = "End this package: what was traced, and what could not be read."

    def run(self, rc, scope, a):
        scope.finished = {"summary": a.summary, "open_questions": list(a.open_questions)}
        return ToolOut("Package finished.", "Finished the package", phase="done")


# ------------------------------------------------------------------ registry and dispatch
_TOOLS = [UpsertItems(), RemoveItems(), ItemsQuery(), Catalogue(), UpsertEnvironment(), PlanPackages(), NextStage(), PlantFinish(), FinishPackage()]
PLANT_TOOLS = {t.name: t for t in _TOOLS}
ORCH_NAMES = (
    "list_sources", "drawing_view", "drawing_text", "catalogue", "plan_packages", "items_query",
    "upsert_items", "remove_items", "upsert_environment", "next_stage", "finish",
)
SUB_NAMES = (*LOOK, "catalogue", "items_query", "upsert_items", "remove_items", "finish_package")


def _names(scope) -> tuple[str, ...]:
    return ORCH_NAMES if scope.package is None else SUB_NAMES


def specs_for(role: str) -> list[ToolSpec]:
    names = ORCH_NAMES if role == "orchestrator" else SUB_NAMES
    out = []
    for n in names:
        t = PLANT_TOOLS.get(n) or M1_TOOLS[n]
        out.append(ToolSpec(t.name, t.description, clean_schema(t.Args.model_json_schema())))
    return out


def run_plant_tool(rc, scope, name: str, raw) -> ToolOut:
    if name not in _names(scope):
        return ToolOut(f"Unknown tool {name!r}.", "Called an unknown tool", ok=False)
    if name in LOOK:
        rc.m1.images_sent = 0  # image budgets are the plant run's (admit_image), not M1's 40
        return run_m1_tool(rc.m1, name, raw if isinstance(raw, dict) else {})
    tool = PLANT_TOOLS[name]
    try:
        args = tool.Args.model_validate(raw if isinstance(raw, dict) else {})
    except ValidationError as e:
        return ToolOut(f"Bad arguments for {name}:\n{_short(e)}", f"Bad arguments for {name}", ok=False)
    try:
        out = tool.run(rc, scope, args)
    except LookError as e:
        return ToolOut(e.message, f"{name} could not run", ok=False)
    except Exception as e:  # noqa: BLE001 - a tool bug must not end the run; the type name only
        return ToolOut(f"{name} failed ({type(e).__name__}). Try different arguments.", f"{name} failed", ok=False)
    if len(out.text) > MAX_TEXT:
        out.text = out.text[:MAX_TEXT] + "\n(cut off)"
    return out


def admit_image(rc, scope, out: ToolOut) -> None:
    """Keep the image only while the package's and the run's image budgets allow it."""
    if not out.image:
        return
    over_package = scope.package is not None and scope.images >= rc.limits.sub_images
    if over_package or not rc.budget.charge_image(scope.stage):
        out.image = None
        out.text += NO_IMAGE
        return
    scope.images += 1


def execute(rc, scope, call) -> ToolResult:
    """Run one tool call: dispatch, image budget, a log line (names and timings only), a step."""
    t0 = time.monotonic()
    tool_name = call.name if call.name in _names(scope) else "unknown"  # never log model output verbatim
    out = run_plant_tool(rc, scope, call.name, call.input)
    admit_image(rc, scope, out)
    log.info("plant tool %s %s ok=%s %.2fs", scope.name, tool_name, out.ok, time.monotonic() - t0)
    rc.recorder.step(scope.name, tool_name, out)
    return ToolResult(
        call.id,
        call.name,
        out.text,
        is_error=not out.ok,
        image_jpeg_b64=base64.b64encode(out.image).decode() if out.image else None,
    )
```

If `Region` or `_A` are not importable under those names from `app.asset_models.agent.tools` on `main`, they are module-level names there (see M1 `tools.py` lines 37 and 77). Import them exactly as shown.

- [ ] **Step 8: Run the tests to verify they pass**

Run: `$PY -m pytest tests/test_plant_tools_items.py -v`
Expected: 17 passed.

If `test_upsert_items_partial_accept` reports `b2` or `b3` rejected by F0's own schema validator instead of `check_item`, that is fine: the assertions check ids and counts only. `check_item` keeps its own checks for specs where F0's schema does not catch them.

- [ ] **Step 9: Commit**

```bash
git add backend/app/asset_models/agent/plant/context.py backend/app/asset_models/agent/plant/record.py backend/app/asset_models/agent/plant/model.py backend/app/asset_models/agent/plant/tools_plant.py backend/tests/plant_fakes.py backend/tests/test_plant_tools_items.py
git commit -m "feat(plant-run): run context, recorder, model call and the register tools" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: `drawing_zoom` (Review Focus #1)

**Files:**
- Create: `backend/app/asset_models/agent/plant/views.py` (zoom part)
- Modify: `backend/app/asset_models/agent/plant/tools_plant.py` (add `DrawingZoom`, register it)
- Test: `backend/tests/test_plant_drawing_zoom.py`

**Interfaces:**
- Consumes:
  - M1 `look.drawing._drawing(handle, id)` and `drawing_view(handle, id, region, max_side=1600)`;
  - `look.clamp_region` and `look.to_jpeg`;
  - `app.drawings.pdf.open_pdf` and `page_rgb`.
- Produces:
  - `views.Zoom(jpeg, width, height, dpi, note, grid_step_m)`;
  - `views.drawing_zoom(handle, drawing_id, region, dpi=300, *, grid=True, page_to_plant=None) -> Zoom`;
  - `views.zoom_dpi(w_in, h_in, requested) -> (int, str)`;
  - `views.draw_overlay(img, region, page_to_plant) -> float | None`;
  - `views._nice(x)`, `views._segment(a, b, c, value, W, H)`;
  - the `drawing_zoom` tool in `ORCH_NAMES` and `SUB_NAMES`;
  - `views.MAX_PX = 1600`, `views.MAX_DPI = 600`.

- [ ] **Step 1: Write the failing tests**

```python
# backend/tests/test_plant_drawing_zoom.py
"""drawing_zoom (spec §8.3; index Review Focus #1): a page region at up to 600 dpi, never over
1 600 px, capped with a note rather than an error."""

import io

import pytest
from drawings_helpers import build_drawing, inspect_ready, write_pdf, write_png
from PIL import Image
from plant_fakes import make_rc, seed_plant

from app.asset_models.agent.plant import tools_plant as T
from app.asset_models.agent.plant import views
from app.asset_models.agent.plant.context import Scope
from app.asset_models.look import LookError
from app.db.models import Drawing


@pytest.fixture
def a0_drawing(client, project_id, wait_job, tmp_path):
    pdf = write_pdf(tmp_path / "plot.pdf", [(3370.0, 2384.0)])  # an A0 sheet, as Al-Zour's 1:3000 plot plans
    inspection = inspect_ready(client, project_id, wait_job, pdf)
    return build_drawing(client, project_id, wait_job, inspection["id"], dpi=100)["id"]


def test_drawing_zoom_caps_dpi_with_note(handle, a0_drawing):
    whole = views.drawing_zoom(handle, a0_drawing, [0.0, 0.0, 1.0, 1.0], 600)
    assert max(whole.width, whole.height) <= 1600
    assert whole.dpi == 34  # floor(1600 / (3370 / 72))
    assert "Rendered at 34 dpi, not 600" in whole.note and "smaller region" in whole.note
    small = views.drawing_zoom(handle, a0_drawing, [0.40, 0.40, 0.45, 0.45], 600)
    assert small.dpi == 600 and small.note == "" and abs(small.width - 1404) <= 2
    capped = views.drawing_zoom(handle, a0_drawing, [0.40, 0.40, 0.45, 0.45], 1200)
    assert capped.dpi == 600 and "600 dpi is the most" in capped.note


def test_the_tool_never_errors_the_run(handle, app, a0_drawing, monkeypatch):
    rc = make_rc(handle, app, seed_plant(handle, app))
    rc.sources.append({"type": "drawing", "id": a0_drawing, "label": "Plot", "facts": ""})
    sc = Scope(name="orchestrator", stage="survey", items=rc.store)
    out = T.run_plant_tool(rc, sc, "drawing_zoom", {"drawing_id": a0_drawing, "region": [0, 0, 1, 1], "dpi": 1200})
    assert out.ok and out.image and "34 dpi" in out.text and "600 dpi is the most" in out.text
    assert max(Image.open(io.BytesIO(out.image)).size) <= 1600

    def boom(*_a, **_k):
        raise RuntimeError("C:/secret/plot.pdf")

    monkeypatch.setattr(views, "drawing_zoom", boom)
    out = T.run_plant_tool(rc, sc, "drawing_zoom", {"drawing_id": a0_drawing, "region": [0, 0, 1, 1]})
    assert not out.ok and "RuntimeError" in out.text and "secret" not in out.text
    foreign = T.run_plant_tool(rc, sc, "drawing_zoom", {"drawing_id": "nope", "region": [0, 0, 1, 1]})
    assert not foreign.ok and "not one of this run's sources" in foreign.text


def test_a_scan_is_shown_at_a_stated_share_of_its_resolution(client, project_id, wait_job, handle, tmp_path):
    png = write_png(tmp_path / "scan.png", 3200, 2000)
    did = build_drawing(client, project_id, wait_job, inspect_ready(client, project_id, wait_job, png)["id"])["id"]
    z = views.drawing_zoom(handle, did, [0, 0, 1, 1], 300)
    assert z.dpi is None and "Shown at 50% of the scan's resolution" in z.note and z.width == 1600
    assert views.drawing_zoom(handle, did, [0, 0, 0.25, 0.25], 300).note == ""


def test_vector_drawings_have_no_page_image(handle):
    with handle.session() as s:
        d = Drawing(name="GA.dxf", format="dxf", status="ready", source_path="C:/x/GA.dxf", source_size=1)
        s.add(d)
        s.flush()
        did = d.id
    with pytest.raises(LookError, match="drawing_text"):
        views.drawing_zoom(handle, did, [0, 0, 1, 1], 300)


def test_overlay_draws_plant_grid_lines(handle, a0_drawing):
    z = views.drawing_zoom(
        handle, a0_drawing, [0, 0, 1, 1], 30, page_to_plant=lambda fx, fy: (fx * 1000.0, (1 - fy) * 700.0)
    )
    assert z.grid_step_m == 200.0
    assert views.drawing_zoom(handle, a0_drawing, [0, 0, 1, 1], 30).grid_step_m is None


def test_nice_steps_and_segments():
    assert views._nice(166.7) == 200.0 and views._nice(0.013) == 0.02 and views._nice(3) == 5.0
    assert views._segment(1.0, 0.0, 0.0, 50.0, 100, 80) == ((50.0, 0.0), (50.0, 80.0))
    assert views._segment(1.0, 0.0, 0.0, 500.0, 100, 80) is None
    assert views.zoom_dpi(1.0, 1.0, 300) == (300, "")
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `$PY -m pytest tests/test_plant_drawing_zoom.py -v`
Expected: FAIL with `ModuleNotFoundError: No module named 'app.asset_models.agent.plant.views'`.

- [ ] **Step 3: Implement the zoom part of `views.py`**

```python
# backend/app/asset_models/agent/plant/views.py
"""What the plant run renders for the model; every image is <= 1 600 px on its long side.
- drawing_zoom: a page region at up to 600 dpi, with page-fraction ticks and plant grid lines.
- mosaics: the ortho or a placed drawing as site tiles, warped plant-north-up.
- render_site: plan and iso views of the register."""

from __future__ import annotations

import io
import math
from dataclasses import dataclass
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFont

from app.asset_models.look import LookError, clamp_region, to_jpeg
from app.asset_models.look.drawing import _drawing, drawing_view

MAX_PX = 1600
MAX_DPI = 600
RASTER = ("png", "jpg", "tif")
NICE = (1.0, 2.0, 2.5, 5.0)
TICK = (200, 0, 120)
GRID = (0, 120, 255)


@dataclass(frozen=True)
class Zoom:
    jpeg: bytes
    width: int
    height: int
    dpi: int | None
    note: str
    grid_step_m: float | None


def zoom_dpi(w_in: float, h_in: float, requested: int) -> tuple[int, str]:
    """The dpi to render a region of w_in x h_in inches at, and a note when it is below the request."""
    notes = []
    want = int(requested)
    if want > MAX_DPI:
        notes.append(f"{MAX_DPI} dpi is the most a zoom renders.")
        want = MAX_DPI
    fit = int(math.floor(MAX_PX / max(w_in, h_in, 1e-9)))
    if want > fit:
        px = math.ceil(max(w_in, h_in) * want)
        eff = max(fit, 1)
        notes.append(
            f"Rendered at {eff} dpi, not {want}: at {want} dpi this region would be {px} px on its long "
            "side, over the 1 600 px limit. Zoom into a smaller region to read finer detail."
        )
        want = eff
    return want, " ".join(notes)


def _pdf_region(src: Path, page_n: int, region, dpi: int) -> tuple[Image.Image, int, str]:
    import pypdfium2

    from app.drawings.pdf import open_pdf, page_rgb
    from app.jobs.cancellation import JobFailure

    try:
        with open_pdf(src) as doc:
            if not 1 <= page_n <= len(doc):
                raise LookError("That page is no longer in the drawing's source PDF.")
            page = doc[page_n - 1]
            try:
                w_pt, h_pt = page.get_size()
                x0, y0, x1, y1 = region
                eff, note = zoom_dpi((x1 - x0) * w_pt / 72, (y1 - y0) * h_pt / 72, dpi)
                # crop = points trimmed from (left, bottom, right, top)
                crop = (x0 * w_pt, (1 - y1) * h_pt, (1 - x1) * w_pt, y0 * h_pt)
                bitmap = page.render(scale=eff / 72, crop=crop, rev_byteorder=True)
                try:
                    rgb = np.array(page_rgb(bitmap), dtype=np.uint8, copy=True)
                finally:
                    bitmap.close()
            finally:
                page.close()
    except (OSError, JobFailure, pypdfium2.PdfiumError):
        raise LookError("The drawing's source PDF can't be read - read the page with drawing_view.") from None
    return Image.fromarray(rgb, "RGB"), eff, note


def _plan_region(handle, d, region) -> tuple[Image.Image, str]:
    li = drawing_view(handle, d.id, region, max_side=MAX_PX)
    img = Image.open(io.BytesIO(li.jpeg)).convert("RGB")
    note = ""
    if d.width and d.height:
        x0, y0, x1, y1 = region
        native = max((x1 - x0) * d.width, (y1 - y0) * d.height)
        if native > MAX_PX:
            note = (
                f"Shown at {100 * MAX_PX / native:.0f}% of the scan's resolution: zoom into a smaller "
                "region to read finer detail."
            )
    return img, note


def drawing_zoom(handle, drawing_id: str, region, dpi: int = 300, *, grid: bool = True, page_to_plant=None) -> Zoom:
    d = _drawing(handle, drawing_id)
    region, rnote = clamp_region(region if region is not None else [0.0, 0.0, 1.0, 1.0])
    src = Path(d.source_path)
    eff: int | None = None
    if d.format == "pdf" and src.exists():
        img, eff, note = _pdf_region(src, d.page or 1, region, dpi)
    elif d.format == "pdf" or d.format in RASTER:
        img, note = _plan_region(handle, d, region)
        if d.format == "pdf":
            note = f"The source PDF is not reachable, so this is the imported page image. {note}".strip()
    else:
        raise LookError("That drawing has no page image (DXF or LandXML): read it with drawing_text.")
    step = draw_overlay(img, region, page_to_plant) if grid else None
    note = " ".join(x for x in (rnote, note) if x)
    li = to_jpeg(img, MAX_PX, note)
    return Zoom(li.jpeg, li.width, li.height, eff, note, step)


# ------------------------------------------------------------------ overlay
def _nice(x: float) -> float:
    if not (x > 0 and math.isfinite(x)):
        return 1.0
    k = 10 ** math.floor(math.log10(x))
    for m in NICE:
        if m * k >= x:
            return m * k
    return 10 * k


def _segment(a: float, b: float, c: float, value: float, W: int, H: int):
    """The image segment where a*u + b*v + c == value, clipped to the image rectangle, or None."""
    pts = []
    if abs(b) > 1e-12:
        for u in (0.0, float(W)):
            v = (value - c - a * u) / b
            if 0 <= v <= H:
                pts.append((u, v))
    if abs(a) > 1e-12:
        for v in (0.0, float(H)):
            u = (value - c - b * v) / a
            if 0 <= u <= W:
                pts.append((u, v))
    uniq = []
    for p in pts:
        if all(math.dist(p, q) > 0.5 for q in uniq):
            uniq.append(p)
    return (uniq[0], uniq[1]) if len(uniq) >= 2 else None


def _affine_px_to(fn, region, W: int, H: int):
    """(a, b, c, d, e, f): E = a u + b v + c, N = d u + e v + f for image pixel (u, v); exact for the
    similarity transforms in use (page -> drawing georef -> site -> plant)."""
    x0, y0, x1, y1 = region

    def page(u, v):
        return x0 + (x1 - x0) * u / W, y0 + (y1 - y0) * v / H

    vals = []
    for u, v in ((0.0, 0.0), (float(W), 0.0), (0.0, float(H))):
        e, n = fn(*page(u, v))
        vals.append((float(np.asarray(e)), float(np.asarray(n))))
    (e0, n0), (e1, n1), (e2, n2) = vals
    return (e1 - e0) / W, (e2 - e0) / H, e0, (n1 - n0) / W, (n2 - n0) / H, n0


def draw_overlay(img: Image.Image, region, page_to_plant) -> float | None:
    """Page-fraction ticks on the top and left edges; plant E/N grid lines when `page_to_plant` maps
    (fx, fy) page fractions to plant (E, N). Returns the grid step in metres, or None."""
    draw = ImageDraw.Draw(img)
    font = ImageFont.load_default()
    W, H = img.size
    x0, y0, x1, y1 = region
    step = _nice((x1 - x0) / 8)
    v = math.ceil(x0 / step) * step
    while v <= x1 + 1e-9:
        u = (v - x0) / (x1 - x0) * W
        draw.line([(u, 0), (u, 10)], fill=TICK, width=1)
        draw.text((u + 2, 11), f"{v:.3f}", fill=TICK, font=font)
        v += step
    step = _nice((y1 - y0) / 8)
    v = math.ceil(y0 / step) * step
    while v <= y1 + 1e-9:
        w = (v - y0) / (y1 - y0) * H
        draw.line([(0, w), (10, w)], fill=TICK, width=1)
        draw.text((12, w + 1), f"{v:.3f}", fill=TICK, font=font)
        v += step
    if page_to_plant is None:
        return None
    try:
        a, b, c, d, e, f = _affine_px_to(page_to_plant, region, W, H)
    except Exception:  # noqa: BLE001 - a frame that can't map this page draws no grid
        return None
    corners = [(0, 0), (W, 0), (0, H), (W, H)]
    es = [a * u + b * w + c for u, w in corners]
    ns = [d * u + e * w + f for u, w in corners]
    gstep = _nice(max(max(es) - min(es), max(ns) - min(ns)) / 6)
    for (p, q, r), lo, hi, axis in (((a, b, c), min(es), max(es), "E"), ((d, e, f), min(ns), max(ns), "N")):
        val = math.ceil(lo / gstep) * gstep
        while val <= hi:
            seg = _segment(p, q, r, val, W, H)
            if seg:
                draw.line(seg, fill=GRID, width=1)
                draw.text((seg[0][0] + 3, seg[0][1] + 3), f"{axis} {val:g}", fill=GRID, font=font)
            val += gstep
    return gstep
```

- [ ] **Step 4: Add the tool to `tools_plant.py`**

Add the import `from app.asset_models.agent.plant import views` under the other plant imports. Then add the class and register it.

```python
class ZoomArgs(_A):
    drawing_id: str
    region: Region = Field(description="[x0, y0, x1, y1] page fractions, (0,0) top-left")
    dpi: int = Field(300, ge=36, le=1200, description="source resolution; at most 600 dpi is rendered")
    grid: bool = Field(True, description="page-fraction ticks, and plant E/N grid lines once the page is placed and set_site is done")


class DrawingZoom:
    name, Args = "drawing_zoom", ZoomArgs
    description = (
        "Zoom into a region of a drawing page at a chosen resolution (up to 600 dpi; the image is at "
        "most 1 600 px, and a region too large for the dpi is rendered at the largest dpi that fits, "
        "with a note). Use it to read small tags, leaders and grid labels on scanned plot plans. The "
        "image carries page-fraction ticks on its top and left edges (use them for set_site grid "
        "points) and plant E/N grid lines once the frame is known."
    )

    def run(self, rc, scope, a):
        if a.drawing_id not in rc.drawing_ids():
            raise LookError("That drawing is not one of this run's sources.")
        mapper = _page_to_plant(rc, a.drawing_id) if a.grid else None
        z = views.drawing_zoom(rc.handle, a.drawing_id, a.region, a.dpi, grid=a.grid, page_to_plant=mapper)
        at = f" at {z.dpi} dpi" if z.dpi else ""
        grid = f" Plant grid lines every {z.grid_step_m:g} m." if z.grid_step_m else ""
        text = f"Drawing zoom {z.width}x{z.height}{at}.{grid} {z.note}".strip()
        return ToolOut(text, f"Zoomed into a drawing{at}", image=z.jpeg, phase="reading")


def _page_to_plant(rc, drawing_id):
    return None  # Task 7 replaces this with sitefit.page_to_plant_fn
```

Then make these edits:
- `_TOOLS`: append `DrawingZoom()`.
- `ORCH_NAMES`: insert `"drawing_zoom"` after `"drawing_text"`.
- `SUB_NAMES`: change to `(*LOOK, "drawing_zoom", "catalogue", "items_query", "upsert_items", "remove_items", "finish_package")`.

- [ ] **Step 5: Run the tests to verify they pass**

Run: `$PY -m pytest tests/test_plant_drawing_zoom.py tests/test_plant_tools_items.py -v`
Expected: all pass (6 + 17).

- [ ] **Step 6: Commit**

```bash
git add backend/app/asset_models/agent/plant/views.py backend/app/asset_models/agent/plant/tools_plant.py backend/tests/test_plant_drawing_zoom.py
git commit -m "feat(plant-run): drawing_zoom capped at 600 dpi and 1600 px, with grid overlay" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: `set_site`, the drawings georef service and drawing auto-georef

**Files:**
- Create: `backend/app/drawings/georef_service.py`
- Modify: `backend/app/drawings/router.py` (`put_drawing_georef` body only)
- Create: `backend/app/asset_models/agent/plant/sitefit.py`
- Modify: `backend/app/asset_models/agent/plant/tools_plant.py` (add `SetSite`; `_page_to_plant` delegates to sitefit)
- Test: `backend/tests/test_plant_set_site.py`

**Interfaces:**
- Consumes:
  - F0 `PlantGrid`, `fit_plant_grid`, `SiteFrame`, `SiteCrs`, `Datum`, `Source`;
  - `app.drawings.georef.apply`, `app.drawings.georef.fit`;
  - `app.workspace.service.get_frame`, `app.workspace.frame.transform_xy`.
- Produces:
  - `georef_service.apply_control_points(handle, drawing_id, model, points) -> DrawingOut`;
  - `sitefit.crs_wkt_of(site) -> str | None`;
  - `sitefit.page_to_site(row, fx, fy, site_wkt) -> (X, Y) | None`;
  - `sitefit.page_to_plant_fn(rc, drawing_id) -> Callable | None`;
  - `sitefit.georef_from_grid(rc, row, grid_points) -> str`;
  - the `set_site` tool (orchestrator only).

- [ ] **Step 1: Write the failing tests**

```python
# backend/tests/test_plant_set_site.py
"""set_site (spec §8.2.1, §15; rulings R1, R2): the plant grid from grid points on placed pages or an
explicit frame; unplaced pages are georeferenced from the grid through the drawings georef service."""

import pytest
from drawings_helpers import build_drawing, inspect_ready, seed_frame, write_png
from plant_fakes import KIPIC, make_rc, seed_plant
from pyproj import CRS

from app.asset_models.agent.plant import tools_plant as T
from app.asset_models.agent.plant.context import Scope
from app.asset_models.siteframe import PlantGrid
from app.asset_models.spec import SiteFrame
from app.db.models import Drawing

UTM39 = CRS.from_epsg(32639).to_wkt()
GEOREF = {
    "method": "control_points", "crs_wkt": None, "epsg": None, "model": "similarity", "points": [],
    "dst_crs_wkt": UTM39, "transform": [0.5, 0.0, 244000.0, 0.0, 0.5, 3180000.0],
    "rmse_m": 0.0, "residuals_m": [], "warnings": [],
}
TRUE = SiteFrame.model_validate(
    {"crs": {"epsg": 32639}, "origin_crs": [244500.0, 3179300.0], "plant_north_deg": 18.0, "source": {"kind": "assumed"}}
)


def orch(rc):
    return Scope(name="orchestrator", stage="survey", items=rc.store)


@pytest.fixture
def rc(handle, app):
    seed_frame(handle, 32639)
    ids = seed_plant(handle, app)
    r = make_rc(handle, app, ids)
    r.test_ids = ids
    return r


def _georef(handle, did):
    with handle.session() as s:
        s.get(Drawing, did).georef = dict(GEOREF)


def _page_xy(e, n):
    """Where plant (e, n) of TRUE sits on the seeded 4000 x 2800 px page placed by GEOREF."""
    X, Y = PlantGrid(TRUE).plant_to_site(e, n)
    col, row = (float(X) - 244000.0) / 0.5, -(float(Y) - 3180000.0) / 0.5
    return [col / 4000.0, row / 2800.0]


def test_an_explicit_frame_from_a_coordinate_note(rc):
    d0 = rc.test_ids["drawings"][0]
    out = T.run_plant_tool(rc, orch(rc), "set_site", {**KIPIC, "source_drawing_id": d0, "note": "coordinate note"})
    assert out.ok and "17.9991" in out.text
    site = rc.site()
    assert site.crs.epsg == 32639 and site.datum.label == "HPFS" and site.datum.el_m == 100.0
    assert site.source.kind == "drawing" and site.source.id == d0
    X, Y = rc.grid().plant_to_site(0.0, 0.0)
    assert abs(float(X) - 244338.089) < 1e-6 and abs(float(Y) - 3179515.690) < 1e-6


def test_grid_points_on_a_placed_page_fit_the_frame(rc, handle):
    d0 = rc.test_ids["drawings"][0]
    _georef(handle, d0)
    gps = [{"drawing_id": d0, "page_xy": _page_xy(e, n), "plant_E": e, "plant_N": n} for e, n in ((0, 0), (400, 0), (0, 300), (400, 300))]
    out = T.run_plant_tool(rc, orch(rc), "set_site", {"grid_points": gps, "datum_label": "EL"})
    assert out.ok, out.text
    site = rc.site()
    assert abs(site.origin_crs[0] - 244500.0) < 0.01 and abs(site.origin_crs[1] - 3179300.0) < 0.01
    assert abs(site.plant_north_deg - 18.0) < 1e-4
    assert "residual" in out.text.lower() and rc.state.questions == []


def test_a_large_residual_raises_an_open_question(rc, handle):
    d0 = rc.test_ids["drawings"][0]
    _georef(handle, d0)
    gps = [{"drawing_id": d0, "page_xy": _page_xy(e, n), "plant_E": e, "plant_N": n} for e, n in ((0, 0), (400, 0), (0, 300), (400, 300))]
    gps[3]["page_xy"][0] += 0.003  # 12 px = 6 m off
    out = T.run_plant_tool(rc, orch(rc), "set_site", {"grid_points": gps})
    assert out.ok and "over 1 m" in out.text
    assert any("residual" in q for q in rc.state.questions)


def test_no_frame_without_a_placed_page_or_explicit_numbers(rc):
    d1 = rc.test_ids["drawings"][1]
    gps = [{"drawing_id": d1, "page_xy": [0.1, 0.1], "plant_E": 0, "plant_N": 0}, {"drawing_id": d1, "page_xy": [0.9, 0.1], "plant_E": 100, "plant_N": 0}]
    out = T.run_plant_tool(rc, orch(rc), "set_site", {"grid_points": gps})
    assert not out.ok and "origin_crs" in out.text and rc.site() is None


def test_an_unplaced_page_is_georeferenced_from_the_grid(client, project_id, wait_job, tmp_path, handle, rc):
    png = write_png(tmp_path / "area.png", 3000, 2000)
    insp = inspect_ready(client, project_id, wait_job, png)
    did = build_drawing(client, project_id, wait_job, insp["id"], name="Area plan")["id"]
    rc.sources.append({"type": "drawing", "id": did, "label": "Area plan", "facts": ""})
    # 1 px = 0.5 m, plant north up the page: (u, v) -> E = 0.5 u, N = 0.5 (2000 - v)
    gps = [
        {"drawing_id": did, "page_xy": [u / 3000, v / 2000], "plant_E": 0.5 * u, "plant_N": 0.5 * (2000 - v)}
        for u, v in ((300, 1800), (2700, 1800), (300, 200))
    ]
    out = T.run_plant_tool(rc, orch(rc), "set_site", {**KIPIC, "grid_points": gps})
    assert out.ok and "Placed Area plan on the map from 3 grid points" in out.text
    got = client.get(f"/api/v1/projects/{project_id}/drawings/{did}").json()
    assert got["georef"]["method"] == "control_points" and got["georef"]["rmse_m"] < 0.01
    assert ("drawings.changed", {"drawing_ids": [did]}) in rc.job.published


def test_an_existing_georef_is_never_overwritten(rc, handle):
    d0 = rc.test_ids["drawings"][0]
    _georef(handle, d0)
    with handle.session() as s:
        before = s.get(Drawing, d0).georef_version
    gps = [{"drawing_id": d0, "page_xy": _page_xy(e, n), "plant_E": e, "plant_N": n} for e, n in ((0, 0), (400, 0))]
    assert T.run_plant_tool(rc, orch(rc), "set_site", {"grid_points": gps}).ok
    with handle.session() as s:
        assert s.get(Drawing, d0).georef_version == before


def test_a_local_map_frame_places_no_page(handle, app):
    seed_frame(handle, None)
    ids = seed_plant(handle, app)
    rc = make_rc(handle, app, ids)
    d1 = ids["drawings"][1]
    gps = [{"drawing_id": d1, "page_xy": [0.1, 0.9], "plant_E": 0, "plant_N": 0}, {"drawing_id": d1, "page_xy": [0.9, 0.9], "plant_E": 400, "plant_N": 0}]
    out = T.run_plant_tool(rc, orch(rc), "set_site", {**KIPIC, "grid_points": gps})
    assert out.ok and "no coordinate system" in out.text
    with handle.session() as s:
        assert s.get(Drawing, d1).georef is None


def test_set_site_is_an_orchestrator_tool():
    assert "set_site" in T.ORCH_NAMES and "set_site" not in T.SUB_NAMES
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `$PY -m pytest tests/test_plant_set_site.py -v`
Expected: FAIL. `test_set_site_is_an_orchestrator_tool` fails on the assertion; the others fail with "Unknown tool 'set_site'".

- [ ] **Step 3: Extract the georef service**

```python
# backend/app/drawings/georef_service.py
"""Control-point georeferencing of one drawing (spec 2026-09-26-map-workspace §8.3). Shared by
PUT /drawings/{id}/georef and the plant run's auto-georef (spec 2026-10-03 §15). It answers the same
404/409/422 as the route did."""

from __future__ import annotations

from app.db.base import utcnow
from app.drawings import footprint, service, site, store
from app.drawings import georef as fitting
from app.drawings.placement import VECTOR
from app.drawings.schemas import DrawingOut
from app.errors import AppError
from app.surfaces.design.units import unit_to_m


def apply_control_points(handle, drawing_id: str, model: str, points: list[dict]) -> DrawingOut:
    """Fit `model` to `points` ({id?, src, dst}; dst in the site frame), store it, write it into the
    raster's plan.tif and drop the drawing's cached tiles."""
    with handle.session() as s:
        service.require(s, drawing_id)
    frame = site.current_frame(handle)
    with handle.session() as s:
        row = service.require(s, drawing_id)
        if row.status != "ready":
            raise AppError("not_ready", "the drawing is still importing or failed", 409)
        units_scale = unit_to_m(row.units) if row.format in VECTOR and row.units else None
        try:
            f = fitting.fit(
                model,
                [p["src"] for p in points],
                [p["dst"] for p in points],
                dst_unit_m=site.frame_unit_m(frame),
                units_scale=units_scale,
            )
        except fitting.GeorefRefused as e:
            raise AppError(e.code, e.message, 422) from None
        fit_json = f.to_json()
        row.georef = {
            "method": "control_points",
            "crs_wkt": None,
            "epsg": None,
            "model": model,
            "points": [
                {"id": p.get("id") or f"p{i + 1}", "src": list(p["src"]), "dst": list(p["dst"])}
                for i, p in enumerate(points)
            ],
            "dst_crs_wkt": frame.crs_wkt,
            "transform": fit_json["transform"],
            "rmse_m": fit_json["rmse_m"],
            "residuals_m": fit_json["residuals_m"],
            "warnings": fit_json["warnings"],
        }
        row.georef_version = (row.georef_version or 0) + 1
        row.bounds_site = footprint.bounds_site_value(row, frame)
        row.updated_at = utcnow()
        if row.format not in VECTOR:
            from app.drawings import raster_io

            raster_io.write_plan_georef(store.plan_path(handle, drawing_id), f.transform, frame.crs_wkt)
        out = service.to_out(row, frame)
    service.drop_caches(drawing_id)
    return out
```

In `backend/app/drawings/router.py`, replace the body of `put_drawing_georef`, keeping its decorator and signature:

```python
@router.put("/drawings/{drawingId}/georef", response_model=DrawingOut)
def put_drawing_georef(
    drawingId: str,  # noqa: N803
    body: DrawingGeorefPut,
    request: Request,
    handle: ProjectHandle = Depends(get_project),
) -> DrawingOut:
    out = georef_service.apply_control_points(
        handle, drawingId, body.model, [p.model_dump() for p in body.points]
    )
    publish_drawings_changed(request, handle, [drawingId])
    return out
```

Add `from app.drawings import georef_service` next to the other `app.drawings` imports. Then run `$PY -m ruff check app/drawings/router.py` and remove any import ruff now reports unused. `_fit`, `fitting` and `unit_to_m` stay in use by `fit_drawing_georef`.

- [ ] **Step 4: Run the drawings georef tests to verify the route is unchanged**

Run: `$PY -m pytest tests -k "georef" -q`
Expected: all pass, the same count as on `main` before this step.

- [ ] **Step 5: Implement `sitefit.py`**

```python
# backend/app/asset_models/agent/plant/sitefit.py
"""The plant grid from what the drawings show (spec §8.2.1, §15), and drawing placement from it."""

from __future__ import annotations

import numpy as np
from pyproj import CRS

from app.asset_models.siteframe import PlantGrid
from app.db.models import Drawing
from app.drawings.georef import apply as apply_affine
from app.errors import AppError
from app.workspace.frame import transform_xy


def crs_wkt_of(site) -> str | None:
    if site.crs.epsg:
        return CRS.from_epsg(site.crs.epsg).to_wkt()
    return site.crs.wkt


def drawing_row(handle, drawing_id: str) -> Drawing | None:
    with handle.session() as s:
        row = s.get(Drawing, drawing_id)
        if row is not None:
            s.expunge(row)
        return row


def page_to_site(row: Drawing, fx, fy, site_wkt: str | None):
    """Page fractions -> site CRS through the drawing's georef (src = (col, -row) plan pixels), or None."""
    g = row.georef
    if not g or not row.width or not row.height:
        return None
    X, Y = apply_affine(g["transform"], np.asarray(fx, float) * row.width, -np.asarray(fy, float) * row.height)
    dst = g.get("dst_crs_wkt")
    if dst and site_wkt:
        X, Y = transform_xy(dst, site_wkt, X, Y)
    elif bool(dst) != bool(site_wkt):
        return None  # one side is local metres: the two can't be related
    return np.asarray(X, float), np.asarray(Y, float)


def page_to_plant_fn(rc, drawing_id: str):
    site = rc.site()
    if site is None:
        return None
    row = drawing_row(rc.handle, drawing_id)
    if row is None or row.georef is None:
        return None
    wkt = crs_wkt_of(site)
    if page_to_site(row, 0.5, 0.5, wkt) is None:
        return None
    grid = PlantGrid(site)

    def fn(fx, fy):
        X, Y = page_to_site(row, fx, fy, wkt)
        return grid.site_to_plant(X, Y)

    return fn


def georef_from_grid(rc, row: Drawing, grid_points) -> str:
    """Place an unplaced page from its grid points (similarity) through the drawings georef service."""
    from app.drawings.georef_service import apply_control_points
    from app.workspace.service import get_frame

    ws = get_frame(rc.handle)
    if ws.kind == "local":
        return f"{row.name} was not placed on the map: the project's map has no coordinate system."
    if not row.width or not row.height:
        return f"{row.name} was not placed on the map: it has no page image."
    site = rc.site()
    site_wkt = crs_wkt_of(site)
    if site_wkt is None:
        return f"{row.name} was not placed on the map: the site frame has no coordinate system."
    grid = PlantGrid(site)
    points = []
    for gp in grid_points[:12]:
        X, Y = grid.plant_to_site(gp.plant_E, gp.plant_N)
        X, Y = transform_xy(site_wkt, ws.crs_wkt, X, Y)
        points.append(
            {
                "id": None,
                "src": [gp.page_xy[0] * row.width, -gp.page_xy[1] * row.height],
                "dst": [float(np.asarray(X)), float(np.asarray(Y))],
            }
        )
    try:
        apply_control_points(rc.handle, row.id, "similarity", points)
    except AppError as e:  # app-written text (GeorefRefused messages, not_ready)
        return f"{row.name} was not placed on the map: {e.message}"
    rc.job.publish("drawings.changed", {"drawing_ids": [row.id]})
    rmse = (drawing_row(rc.handle, row.id).georef or {}).get("rmse_m") or 0.0
    return f"Placed {row.name} on the map from {len(points)} grid points (RMSE {rmse:.2f} m)."
```

- [ ] **Step 6: Add `set_site` to `tools_plant.py`**

Add these imports: `import math`; `from pyproj.exceptions import CRSError`; `from app.asset_models.agent.plant import sitefit`; and `Datum`, `SiteCrs`, `SiteFrame`, `Source` added to the `app.asset_models.spec` import. Replace `_page_to_plant` with:

```python
def _page_to_plant(rc, drawing_id):
    return sitefit.page_to_plant_fn(rc, drawing_id)
```

Add:

```python
NEED_FRAME = (
    "The site frame can't be fixed yet. Give either at least two grid points on a page that is already "
    "placed on the map, or origin_crs and plant_north_deg read off a drawing (a coordinate note or the "
    "key plan) with the epsg of their coordinate system. Pages without a georeference are placed from "
    "their grid points once the frame is known."
)
Frac = Annotated[float, Field(ge=0, le=1)]


class GridPoint(_A):
    drawing_id: str
    page_xy: Annotated[list[Frac], Field(min_length=2, max_length=2)] = Field(
        description="[x, y] page fractions of the grid intersection, (0,0) top-left (read the zoom's ticks)"
    )
    plant_E: float
    plant_N: float


class SetSiteArgs(_A):
    epsg: int | None = Field(None, ge=1, le=999_999)
    origin_crs: Annotated[list[float], Field(min_length=2, max_length=2)] | None = Field(
        None, description="plant (E 0, N 0) in the site CRS, metres"
    )
    plant_north_deg: float | None = Field(None, ge=-360, le=360, description="plant north, clockwise from grid north")
    datum_label: str = Field("EL", min_length=1, max_length=20)
    datum_el_m: float = Field(0.0, ge=-1000, le=10_000, description="plant EL at the model's base level")
    grid_points: Annotated[list[GridPoint], Field(max_length=12)] = Field(default_factory=list)
    source_drawing_id: str | None = None
    note: str | None = Field(None, max_length=300)


def _site_crs(handle, epsg):
    from app.workspace.service import get_frame

    if epsg is not None:
        try:
            return CRS.from_epsg(epsg).to_wkt(), SiteCrs(epsg=epsg)
        except CRSError:
            raise LookError(f"EPSG:{epsg} is not a coordinate system this app knows.") from None
    ws = get_frame(handle)
    if ws.kind == "local":
        return None, SiteCrs()
    return ws.crs_wkt, SiteCrs(epsg=ws.epsg) if ws.epsg else SiteCrs(wkt=ws.crs_wkt)


class SetSite:
    name, Args = "set_site", SetSiteArgs
    description = (
        "Fix the site frame: where plant (E 0, N 0) sits in the site CRS, plant north's angle clockwise "
        "from grid north, and the vertical datum. Either give grid_points (grid intersections read off "
        "pages: page_xy fractions + the plant E/N labels; >= 2 on a page already placed on the map, "
        "spread wide) or origin_crs + plant_north_deg (+ epsg) read off a drawing. Unplaced pages with 2+ "
        "grid points are then placed on the map from the grid."
    )

    def run(self, rc, scope, a):
        ids = rc.drawing_ids()
        for did in {gp.drawing_id for gp in a.grid_points} | ({a.source_drawing_id} if a.source_drawing_id else set()):
            if did not in ids:
                raise LookError("That drawing is not one of this run's sources.")
        site_wkt, crs = _site_crs(rc.handle, a.epsg)
        rows = {did: sitefit.drawing_row(rc.handle, did) for did in {gp.drawing_id for gp in a.grid_points}}
        pairs, placed_from = [], None
        for gp in a.grid_points:
            row = rows.get(gp.drawing_id)
            xy = sitefit.page_to_site(row, gp.page_xy[0], gp.page_xy[1], site_wkt) if row is not None else None
            if xy is not None:
                pairs.append(((gp.plant_E, gp.plant_N), (float(xy[0]), float(xy[1]))))
                placed_from = placed_from or gp.drawing_id
        lines, rms = [], None
        if len(pairs) >= 2:
            origin, theta, rms = fit_plant_grid(pairs)
            source = Source(kind="drawing", id=placed_from, note=a.note)
            if a.origin_crs is not None and a.plant_north_deg is not None:
                d = math.dist(origin, a.origin_crs)
                lines.append(f"The frame you stated differs from the grid fit by {d:.2f} m and "
                             f"{abs(theta - a.plant_north_deg):.4f} deg; the fit is used.")
        elif a.origin_crs is not None and a.plant_north_deg is not None:
            origin, theta = (a.origin_crs[0], a.origin_crs[1]), a.plant_north_deg
            source = (
                Source(kind="drawing", id=a.source_drawing_id, note=a.note)
                if a.source_drawing_id
                else Source(kind="assumed", note=a.note or "Frame given without a drawing reference.")
            )
        else:
            return ToolOut(NEED_FRAME, "Site frame not set", ok=False)
        frame = SiteFrame(
            crs=crs,
            origin_crs=(float(origin[0]), float(origin[1])),
            plant_north_deg=float(theta),
            datum=Datum(label=a.datum_label, el_m=a.datum_el_m),
            source=source,
        )
        with rc.lock:
            rc.state.site = frame.model_dump(mode="json")
            if rms is not None and rms > 1.0:
                q = (f"The plant grid fit has a residual of {rms:.2f} m over {len(pairs)} grid points: "
                     "check the grid points read off the drawings.")
                rc.state.questions = [x for x in rc.state.questions if "plant grid fit" not in x] + [q]
                lines.append("The residual is over 1 m: check the grid points (an open question was added).")
        rc.save()
        for did, row in rows.items():
            gps = [gp for gp in a.grid_points if gp.drawing_id == did]
            if row is not None and row.georef is None and len(gps) >= 2:
                lines.append(sitefit.georef_from_grid(rc, row, gps))
        crs_label = f"EPSG:{crs.epsg}" if crs.epsg else ("the map's CRS" if crs.wkt else "local metres (no CRS)")
        text = (
            f"Site frame set: plant (0, 0) at ({frame.origin_crs[0]:.3f}, {frame.origin_crs[1]:.3f}) in "
            f"{crs_label}; plant north {frame.plant_north_deg:.4f} deg clockwise from grid north; datum "
            f"{a.datum_label} = {a.datum_el_m:g} m."
        )
        if rms is not None:
            text += f" Grid fit residual {rms:.2f} m over {len(pairs)} points."
        return ToolOut("\n".join([text, *lines]), "Set the site frame")
```

Also add `from pyproj import CRS` and `from app.asset_models.siteframe import fit_plant_grid` to the imports. Then:
- `_TOOLS`: append `SetSite()`.
- `ORCH_NAMES`: insert `"set_site"` after `"drawing_zoom"`.

- [ ] **Step 7: Run the tests to verify they pass**

Run: `$PY -m pytest tests/test_plant_set_site.py tests/test_plant_drawing_zoom.py tests/test_plant_tools_items.py -v`
Expected: all pass.

- [ ] **Step 8: Commit**

```bash
git add backend/app/drawings/georef_service.py backend/app/drawings/router.py backend/app/asset_models/agent/plant/sitefit.py backend/app/asset_models/agent/plant/tools_plant.py backend/tests/test_plant_set_site.py
git commit -m "feat(plant-run): set_site from grid points or a coordinate note; auto-georef unplaced pages" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 8: `ortho_view` and `render_site`

**Files:**
- Modify: `backend/app/asset_models/agent/plant/views.py` (append the mosaic, plan and iso parts)
- Modify: `backend/app/asset_models/agent/plant/tools_plant.py` (add `OrthoView`, `RenderSite`)
- Test: `backend/tests/test_plant_views.py`

**Interfaces:**
- Consumes:
  - `app.workspace.tiles.serve_site_tile(handle, frame, kind, layer_id, z, x, y, TileStyle())`;
  - `app.workspace.grid` (`RES0`, `Z_MAX`, `TILE`, `tile_of`, `tile_bounds`, `res`);
  - `app.workspace.frame.transform_xy`;
  - F0 `build_item`, `BuildCtx`, `Instanced`, `REGISTRY`, `footprint_polygon`, `footprint_ref`;
  - M1 `raster.View`, `raster.render`;
  - `sitefit.crs_wkt_of`.
- Produces:
  - `views.MAX_TILES = 100`, `views.TRI_CAP = 1_500_000`, `views.MAX_INSTANCES = 500`;
  - `views.ws_frame(handle)`, `views.mosaic(handle, ws, kind, layer_id, bbox)`;
  - `views.Canvas`, `views.canvas_for(bbox)`, `views.background(rc, cv, kind, layer_id)`;
  - `views.pick_map(handle)`, `views.bbox_of(items, env)`;
  - `views.plan_image(rc, items, env, bbox, *, bg=None, highlight=frozenset())`;
  - `views.scene_meshes(rc, items, *, lod=0.25)`, `views.iso_image(rc, items)`;
  - `views.sheet(images, titles)`, `views.jpeg(img)`;
  - the `ortho_view` tool (both roles) and the `render_site` tool (orchestrator only).

- [ ] **Step 1: Write the failing tests**

```python
# backend/tests/test_plant_views.py
"""ortho_view and render_site (spec §8.3): bounded mosaics, plant north up, <= 1 600 px, <= 4 views."""

import io

import pytest
from drawings_helpers import seed_frame
from PIL import Image
from plant_fakes import KIPIC, item, make_rc, seed_plant

from app.asset_models.agent.plant import tools_plant as T
from app.asset_models.agent.plant import views
from app.asset_models.agent.plant.context import Scope
from app.asset_models.spec import Item, SiteFrame

FRAME = SiteFrame.model_validate(
    {"crs": {"epsg": 32639}, "origin_crs": KIPIC["origin_crs"], "plant_north_deg": KIPIC["plant_north_deg"],
     "datum": {"label": "HPFS", "el_m": 100.0}, "source": {"kind": "assumed"}}
)


def red_tile():
    buf = io.BytesIO()
    Image.new("RGBA", (256, 256), (255, 0, 0, 255)).save(buf, "PNG")
    return buf.getvalue()


@pytest.fixture
def rc(handle, app):
    seed_frame(handle, 32639)
    r = make_rc(handle, app, seed_plant(handle, app))
    r.state.site = FRAME.model_dump(mode="json")
    return r


def orch(rc, stage="build"):
    return Scope(name="orchestrator", stage=stage, items=rc.store)


def _store(rc, *raws):
    for raw in raws:
        i = Item.model_validate(raw)
        rc.store[i.id] = i


def test_ortho_view_is_bounded_and_plant_north_up(rc, monkeypatch):
    from app.workspace import tiles

    calls = []
    monkeypatch.setattr(tiles, "serve_site_tile", lambda *a, **k: calls.append(a) or red_tile())
    monkeypatch.setattr(views, "pick_map", lambda handle: "map-1")
    _store(rc, item("t1", e=100, n=50))
    out = T.run_plant_tool(rc, orch(rc, "environment"), "ortho_view", {"bbox": [0, 0, 400, 200]})
    assert out.ok and out.image and "plant north up" in out.text
    img = Image.open(io.BytesIO(out.image)).convert("RGB")
    assert max(img.size) <= 1600 and img.size[0] > img.size[1]
    r, g, _ = img.getpixel((img.size[0] // 4, img.size[1] // 4))
    assert r > 150 and g < 100
    assert 0 < len(calls) <= views.MAX_TILES


def test_ortho_view_refusals(rc, monkeypatch):
    sc = orch(rc, "environment")
    assert "at most 5 000 m" in T.run_plant_tool(rc, sc, "ortho_view", {"bbox": [0, 0, 9000, 10]}).text
    monkeypatch.setattr(views, "pick_map", lambda handle: None)
    assert "no ortho" in T.run_plant_tool(rc, sc, "ortho_view", {"bbox": [0, 0, 100, 100]}).text
    rc.state.site = None
    assert "set_site" in T.run_plant_tool(rc, sc, "ortho_view", {"bbox": [0, 0, 100, 100]}).text


def test_pick_map_without_maps(rc):
    assert views.pick_map(rc.handle) is None


def test_render_site_plan_and_iso(rc):
    _store(rc, item("t1", e=0, n=0), item("t2", e=40, n=10, area="20"), item("t3", e=80, n=-20, area="20"))
    rc.state.environment = [{"id": "sea", "kind": "sea", "pts": [[-50, -50], [150, -50], [150, -30]], "el": 100.0, "source": {"kind": "assumed"}, "confidence": "medium"}]
    sc = orch(rc)
    out = T.run_plant_tool(rc, sc, "render_site", {"views": ["plan", "iso"], "overlay": "none"})
    assert out.ok and out.image and out.text.startswith("Rendered plan, iso")
    assert max(Image.open(io.BytesIO(out.image)).size) <= 1600
    assert sc.rendered is True
    area = T.run_plant_tool(rc, sc, "render_site", {"views": ["area:20"], "overlay": "none"})
    assert area.ok
    missing = T.run_plant_tool(rc, sc, "render_site", {"views": ["area:99"], "overlay": "none"})
    assert not missing.ok and "Areas: 20" in missing.text


def test_render_site_with_nothing_and_with_too_many_views(rc):
    sc = orch(rc)
    assert not T.run_plant_tool(rc, sc, "render_site", {"views": ["plan"]}).ok
    assert not T.run_plant_tool(rc, sc, "render_site", {"views": ["plan"] * 5}).ok


def test_render_site_notes_a_missing_ortho(rc, monkeypatch):
    monkeypatch.setattr(views, "pick_map", lambda handle: None)
    _store(rc, item("t1"))
    out = T.run_plant_tool(rc, orch(rc), "render_site", {"views": ["plan"]})
    assert out.ok and "No ortho in this project" in out.text


def test_iso_stops_at_the_triangle_cap(rc, monkeypatch):
    monkeypatch.setattr(views, "TRI_CAP", 1)
    _store(rc, item("t1"), item("t2", e=30), item("t3", e=60))
    out = T.run_plant_tool(rc, orch(rc), "render_site", {"views": ["iso"], "overlay": "none"})
    assert out.ok and "2 items not drawn" in out.text


def test_bbox_and_sheet_helpers(rc):
    i = Item.model_validate(item("t1", size=(2.0, 2.0)))
    e0, n0, e1, n1 = views.bbox_of([i], [])
    assert e1 - e0 >= 20 and n1 - n0 >= 20
    wide = [Image.new("RGB", (3000, 500)) for _ in range(4)]
    out = views.sheet(wide, ["a", "b", "c", "d"])
    assert max(out.size) <= 1600


def test_render_and_ortho_tool_roles():
    assert "render_site" in T.ORCH_NAMES and "render_site" not in T.SUB_NAMES
    assert "ortho_view" in T.ORCH_NAMES and "ortho_view" in T.SUB_NAMES
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `$PY -m pytest tests/test_plant_views.py -v`
Expected: FAIL. The tool tests fail with "Unknown tool 'ortho_view'"; the helper tests fail with `AttributeError: module ... has no attribute 'bbox_of'`.

- [ ] **Step 3: Append the mosaic, plan and iso parts to `views.py`**

```python
# ------------------------------------------------------------------ site mosaics
MAX_TILES = 100
TRI_CAP = 1_500_000
MAX_INSTANCES = 500
BG = (20, 26, 36)
OUTLINE = (0, 220, 255)
FLAGGED = (255, 80, 80)
HILITE = (255, 210, 0)
FILL = {
    "sea": (40, 90, 160, 110),
    "land": (170, 160, 120, 70),
    "road": (90, 90, 90, 120),
    "paved": (130, 130, 130, 90),
    "laydown": (150, 130, 90, 80),
    "slope": (120, 140, 90, 80),
    "revetment": (110, 100, 90, 110),
}
FAMILY_GROUP = {"structure": "Support", "equipment": "Shell", "building": "Head", "civil": "Bottom", "environment": "Lining", "fallback": "Other"}


def ws_frame(handle):
    from app.workspace.service import get_frame

    return get_frame(handle)


def mosaic(handle, ws, kind: str, layer_id: str, bbox, max_px: int = MAX_PX):
    """Site tiles of one layer over `bbox` (the map frame's CRS) as one RGBA image, at the zoom whose
    pixel fits the box in `max_px`, never more than MAX_TILES tiles. (img, (left, top, res)) or None."""
    from app.workspace import grid as sgrid
    from app.workspace import tiles

    x0, y0, x1, y1 = bbox
    span = max(x1 - x0, y1 - y0, 1e-6)
    z = int(min(max(math.floor(math.log2(sgrid.RES0 * max_px / span)), 0), sgrid.Z_MAX))
    while True:
        tx0, ty0 = sgrid.tile_of(x0, y1, z)
        tx1, ty1 = sgrid.tile_of(x1, y0, z)
        if (tx1 - tx0 + 1) * (ty1 - ty0 + 1) <= MAX_TILES or z == 0:
            break
        z -= 1
    out = Image.new("RGBA", ((tx1 - tx0 + 1) * sgrid.TILE, (ty1 - ty0 + 1) * sgrid.TILE), (0, 0, 0, 0))
    drawn = False
    for tx in range(tx0, tx1 + 1):
        for ty in range(ty0, ty1 + 1):
            body = tiles.serve_site_tile(handle, ws, kind, layer_id, z, tx, ty, tiles.TileStyle())
            if body:
                out.paste(Image.open(io.BytesIO(body)).convert("RGBA"), ((tx - tx0) * sgrid.TILE, (ty - ty0) * sgrid.TILE))
                drawn = True
    if not drawn:
        return None
    left, _, _, top = sgrid.tile_bounds(z, tx0, ty0)
    return out, (left, top, sgrid.res(z))


@dataclass(frozen=True)
class Canvas:
    e0: float
    n1: float
    res: float
    width: int
    height: int

    def px(self, e, n):
        return (np.asarray(e, float) - self.e0) / self.res, (self.n1 - np.asarray(n, float)) / self.res

    def plant(self, u, v):
        return self.e0 + np.asarray(u, float) * self.res, self.n1 - np.asarray(v, float) * self.res


def canvas_for(bbox, max_px: int = MAX_PX) -> Canvas:
    e0, n0, e1, n1 = bbox
    res = max(e1 - e0, n1 - n0, 1e-6) / max_px
    return Canvas(e0, n1, res, max(1, math.ceil((e1 - e0) / res)), max(1, math.ceil((n1 - n0) / res)))


def background(rc, cv: Canvas, kind: str, layer_id: str) -> Image.Image | None:
    """The layer warped onto the plant canvas (plant north up), or None when it can't be placed."""
    from app.asset_models.agent.plant.sitefit import crs_wkt_of
    from app.workspace.frame import transform_xy

    site = rc.site()
    if site is None:
        return None
    ws = ws_frame(rc.handle)
    site_wkt = crs_wkt_of(site)
    if ws.kind == "local" or site_wkt is None:
        return None
    grid = rc.grid()
    us = np.array([0.0, cv.width, 0.0, cv.width])
    vs = np.array([0.0, 0.0, cv.height, cv.height])
    e, n = cv.plant(us, vs)
    X, Y = grid.plant_to_site(e, n)
    X, Y = transform_xy(site_wkt, ws.crs_wkt, X, Y)
    got = mosaic(rc.handle, ws, kind, layer_id, (float(X.min()), float(Y.min()), float(X.max()), float(Y.max())))
    if got is None:
        return None
    img, (left, top, res) = got
    p = (X[:3] - left) / res
    q = (top - Y[:3]) / res
    coeffs = (
        (p[1] - p[0]) / cv.width, (p[2] - p[0]) / cv.height, p[0],
        (q[1] - q[0]) / cv.width, (q[2] - q[0]) / cv.height, q[0],
    )
    return img.transform(
        (cv.width, cv.height),
        Image.Transform.AFFINE,
        tuple(float(c) for c in coeffs),
        resample=Image.Resampling.BILINEAR,
        fillcolor=(0, 0, 0, 0),
    )


def pick_map(handle) -> str | None:
    from sqlalchemy import select

    from app.db.models import GeoMap

    with handle.session() as s:
        return s.scalar(
            select(GeoMap.id)
            .where(GeoMap.status == "ready", GeoMap.crs_wkt.is_not(None), GeoMap.geotransform.is_not(None))
            .order_by(GeoMap.created_at.desc())
            .limit(1)
        )


def bbox_of(items, env, margin: float = 0.05, min_span: float = 20.0):
    from app.asset_models.siteframe import footprint_polygon

    pts = [footprint_polygon(i.footprint) for i in items] + [np.asarray(f.pts, float) for f in env]
    allp = np.concatenate(pts) if pts else np.zeros((1, 2))
    e0, n0 = allp.min(axis=0)
    e1, n1 = allp.max(axis=0)
    ce, cn = (e0 + e1) / 2, (n0 + n1) / 2
    he = max(e1 - e0, min_span) * (1 + 2 * margin) / 2  # each axis at least min_span, plus the margin
    hn = max(n1 - n0, min_span) * (1 + 2 * margin) / 2
    return (float(ce - he), float(cn - hn), float(ce + he), float(cn + hn))


def plan_image(rc, items, env, bbox, *, bg: Image.Image | None = None, highlight=frozenset()) -> Image.Image:
    from app.asset_models.siteframe import footprint_polygon, footprint_ref

    cv = canvas_for(bbox)
    base = Image.new("RGBA", (cv.width, cv.height), (*BG, 255))
    if bg is not None:
        base.alpha_composite(bg)
    layer = Image.new("RGBA", base.size, (0, 0, 0, 0))
    draw = ImageDraw.Draw(layer)
    for f in env:
        u, v = cv.px([p[0] for p in f.pts], [p[1] for p in f.pts])
        draw.polygon(list(zip(u.tolist(), v.tolist(), strict=True)), fill=FILL.get(f.kind, (128, 128, 128, 80)))
    font = ImageFont.load_default()
    for it in items:
        ring = footprint_polygon(it.footprint)
        u, v = cv.px(ring[:, 0], ring[:, 1])
        colour = HILITE if it.id in highlight else FLAGGED if it.flags else OUTLINE
        draw.polygon(list(zip(u.tolist(), v.tolist(), strict=True)), outline=(*colour, 255))
    if len(items) <= 300:
        for it in items:
            if it.tag:
                e, n = footprint_ref(it.footprint)
                u, v = cv.px(e, n)
                draw.text((float(u) + 2, float(v) + 2), it.tag, fill=(255, 255, 255, 255), font=font)
    base.alpha_composite(layer)
    return base.convert("RGB")


def scene_meshes(rc, items, *, lod: float = 0.25):
    """Item meshes in the scene frame (x = N, y = EL - datum, z = E) via the same builders as the GLB.
    Stops at TRI_CAP triangles; expands at most MAX_INSTANCES instances per node."""
    import trimesh

    from app.asset_models.builders import BuildCtx, Instanced, build_item, load_all
    from app.asset_models.siteframe import footprint_ref

    load_all()
    ctx = BuildCtx(grid=rc.grid(), lod=lod)
    site = rc.site()
    datum = site.datum.el_m if site is not None else 0.0
    out, tris, skipped, fallbacks = {}, 0, 0, []
    for it in items:
        rc.check_cancelled()
        if tris >= TRI_CAP:
            skipped += 1
            continue
        nodes, flags = build_item(it, ctx)
        if any(f.code == "builder_fallback" for f in flags):
            fallbacks.append(it.id)
        parts = []
        for node in nodes:
            g = node.geometry
            if isinstance(g, Instanced):
                for xf in g.transforms[:MAX_INSTANCES]:
                    m = g.mesh.copy()
                    m.apply_transform(xf)
                    parts.append(m)
            else:
                parts.append(g)
        if not parts:
            continue
        mesh = trimesh.util.concatenate(parts) if len(parts) > 1 else parts[0].copy()
        e, n = footprint_ref(it.footprint)
        base = it.base_el if it.base_el is not None else datum
        mesh.apply_translation([n, base - datum, e])
        out[it.id] = mesh
        tris += len(mesh.faces)
    return out, skipped, fallbacks


def iso_image(rc, items) -> tuple[Image.Image, str]:
    from app.asset_models.builders import REGISTRY
    from app.asset_models.raster import View, render

    meshes, skipped, fallbacks = scene_meshes(rc, items)
    notes = []
    if skipped:
        notes.append(f"{skipped} items not drawn: the preview stops at {TRI_CAP:,} triangles.")
    if fallbacks:
        notes.append(f"{len(fallbacks)} items fell back to `other`: {', '.join(fallbacks[:20])}.")
    if not meshes:
        return Image.new("RGB", (1024, 1024), BG), " ".join([*notes, "No item could be meshed."])
    groups = {i.id: FAMILY_GROUP.get(getattr(REGISTRY.get(i.type), "family", "fallback"), "Other") for i in items}
    return render(meshes, View("iso"), size=1024, groups=groups), " ".join(notes)


def sheet(images, titles) -> Image.Image:
    """Views side by side (2 columns), aspect kept, the whole sheet <= MAX_PX."""
    if len(images) == 1:
        out = images[0].copy()
        out.thumbnail((MAX_PX, MAX_PX))
        return out
    cols, cell = 2, MAX_PX // 2
    rows = math.ceil(len(images) / cols)
    out = Image.new("RGB", (cols * cell, rows * (cell + 20)), BG)
    draw = ImageDraw.Draw(out)
    font = ImageFont.load_default()
    for k, (img, title) in enumerate(zip(images, titles, strict=True)):
        r, c = divmod(k, cols)
        t = img.copy()
        t.thumbnail((cell, cell))
        out.paste(t, (c * cell + (cell - t.width) // 2, r * (cell + 20) + 20 + (cell - t.height) // 2))
        draw.text((c * cell + 6, r * (cell + 20) + 4), title, fill=(230, 230, 230), font=font)
    out.thumbnail((MAX_PX, MAX_PX))
    return out


def jpeg(img: Image.Image) -> bytes:
    buf = io.BytesIO()
    img.convert("RGB").save(buf, "JPEG", quality=85)
    return buf.getvalue()
```

- [ ] **Step 4: Add the tools to `tools_plant.py`**

Add the imports `from typing import Literal`, `from app.errors import AppError`, `from app.asset_models.agent.plant.state import env_of` and `from app.db.models import Drawing`. Then add:

```python
class OrthoArgs(_A):
    bbox: Annotated[list[float], Field(min_length=4, max_length=4)] = Field(description="[E0, N0, E1, N1] plant metres")
    map_id: str | None = None
    items: bool = Field(True, description="draw the register's footprints on top")


class OrthoView:
    name, Args = "ortho_view", OrthoArgs
    description = (
        "The project's ortho photo over a plant-metre box (at most 5 000 m across), plant north up, "
        "<= 1 600 px, with the register's footprints drawn on top. Use it to check positions and to "
        "trace the environment."
    )

    def run(self, rc, scope, a):
        e0, n0, e1, n1 = a.bbox
        if not (e1 > e0 and n1 > n0) or max(e1 - e0, n1 - n0) > 5000:
            return ToolOut("bbox must be [E0, N0, E1, N1] with E1 > E0, N1 > N0 and at most 5 000 m across.", "Bad box", ok=False)
        if rc.site() is None:
            return ToolOut("Set the site frame first (set_site): the ortho is placed through it.", "No site frame", ok=False)
        map_id = a.map_id or views.pick_map(rc.handle)
        if map_id is None:
            return ToolOut("This project has no ortho map.", "No ortho", ok=False)
        cv = views.canvas_for(a.bbox)
        try:
            bg = views.background(rc, cv, "map", map_id)
        except AppError as e:
            return ToolOut(f"The ortho can't be read: {e.message}", "Ortho unreadable", ok=False)
        if bg is None:
            return ToolOut("The ortho does not cover that box, or the map has no coordinate system.", "Ortho does not cover the box", ok=False)
        with rc.lock:
            items = list(scope.items.values()) if a.items else []
        img = views.plan_image(rc, items, [], a.bbox, bg=bg)
        text = (f"Ortho {img.width}x{img.height}, plant north up, {cv.res:.2f} m per pixel, "
                f"E {e0:g}..{e1:g}, N {n0:g}..{n1:g}.")
        return ToolOut(text, "Looked at the ortho", image=views.jpeg(img), phase="checking")


SiteView = Annotated[str, Field(pattern=r"^(plan|iso|area:[A-Za-z0-9_.\- ]{1,40})$")]


class RenderSiteArgs(_A):
    views: Annotated[list[SiteView], Field(min_length=1, max_length=4)]
    overlay: Literal["ortho", "drawing", "none"] = "ortho"
    drawing_id: str | None = None
    highlight: Annotated[list[Annotated[str, Field(max_length=64)]], Field(max_length=50)] = Field(default_factory=list)


def _overlay(rc, a, notes: list[str]):
    if a.overlay == "none":
        return None
    if rc.site() is None:
        notes.append("No overlay: the site frame is not set.")
        return None
    if a.overlay == "ortho":
        mid = views.pick_map(rc.handle)
        if mid is None:
            notes.append("No ortho in this project.")
            return None
        return "map", mid
    did = a.drawing_id
    if did is None:
        with rc.handle.session() as s:
            did = next((x["id"] for x in rc.sources if x["type"] == "drawing"
                        and getattr(s.get(Drawing, x["id"]), "georef", None)), None)
    if did is None or did not in rc.drawing_ids():
        notes.append("No placed drawing to overlay.")
        return None
    return "drawing_raster", did


class RenderSite:
    name, Args = "render_site", RenderSiteArgs
    description = (
        "Render the model for a self-check: 'plan' (the whole site, plant north up, footprints over the "
        "ortho or a placed drawing, flagged items red), 'area:<label>' (one area), 'iso' (the built 3D "
        "model from the south-west). Up to 4 views, <= 1 600 px."
    )

    def run(self, rc, scope, a):
        with rc.lock:
            items = list(scope.items.values())
        env = env_of(rc.state)
        if not items and not env:
            return ToolOut("Nothing to render yet.", "Nothing to render", ok=False, phase="checking")
        notes: list[str] = []
        layer = _overlay(rc, a, notes)
        imgs, titles = [], []
        for v in a.views:
            if v == "iso":
                img, note = views.iso_image(rc, items)
                if note:
                    notes.append(note)
            else:
                sel = items if v == "plan" else [i for i in items if i.area == v[5:]]
                if not sel:
                    areas = sorted({i.area for i in items if i.area})
                    return ToolOut(f"No items in area {v[5:]!r}. Areas: {', '.join(areas[:40]) or 'none'}.", "Unknown area", ok=False, phase="checking")
                shown_env = env if v == "plan" else []
                bbox = views.bbox_of(sel, shown_env)
                cv = views.canvas_for(bbox)
                bg = None
                if layer is not None:
                    try:
                        bg = views.background(rc, cv, *layer)
                    except AppError as e:
                        notes.append(f"Overlay not drawn: {e.message}")
                img = views.plan_image(rc, sel, shown_env, bbox, bg=bg, highlight=frozenset(a.highlight))
            imgs.append(img)
            titles.append(v)
        out = views.sheet(imgs, titles)
        if scope.package is None:
            scope.rendered = True
        text = f"Rendered {', '.join(titles)}." + ("" if not notes else " " + " ".join(notes))
        return ToolOut(text, f"Rendered {len(titles)} site views", image=views.jpeg(out), phase="checking")
```

Then:
- `_TOOLS`: append `OrthoView()` and `RenderSite()`.
- `ORCH_NAMES`: insert `"ortho_view"` and `"render_site"` before `"next_stage"`.
- `SUB_NAMES`: insert `"ortho_view"` after `"drawing_zoom"`.

- [ ] **Step 5: Run the tests to verify they pass**

Run: `$PY -m pytest tests/test_plant_views.py tests/test_plant_tools_items.py -v`
Expected: all pass.

- [ ] **Step 6: Commit**

```bash
git add backend/app/asset_models/agent/plant/views.py backend/app/asset_models/agent/plant/tools_plant.py backend/tests/test_plant_views.py
git commit -m "feat(plant-run): ortho_view and render_site (plan over ortho or drawing, iso via the builders)" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 9: Prompts

**Files:**
- Create: `backend/app/asset_models/agent/plant/prompt_plant.py`
- Test: `backend/tests/test_plant_prompt.py`

**Interfaces:**
- Consumes: `PlantRunContext` attributes `sources`, `limits`, `notes`, `state`, `store`, `site()`; `PackageWork`.
- Produces:
  - constants: `ORCH_SYSTEM`, `SUB_SYSTEM`, `SUB_NUDGE`, `WRAP_UP`, `NUDGE`;
  - `sub_system(catalogue: str) -> str`;
  - `first_message(rc)`, `survey_message()`, `review_message(rc)`, `environment_message(rc)`, `build_message(rc, fallen)`, `resume_message(rc)`, all `-> str`;
  - `package_brief(w, rc) -> str`, whose first line is always `Package P<n>: <label>`.

- [ ] **Step 1: Write the failing tests**

```python
# backend/tests/test_plant_prompt.py
"""Plant prompts (spec §8.5): frame, authority, scanned plot plans, catalogue, honesty, no invented
tags; never a key or a file-system path."""

import re

from plant_fakes import KEY, make_rc, seed_plant

from app.asset_models.agent.plant import prompt_plant as P
from app.asset_models.agent.plant.packages import PackageWork
from app.asset_models.agent.plant.tools_plant import ORCH_NAMES, SUB_NAMES

PATH = re.compile(r"[A-Za-z]:[\\/]|\\\\|/Users/|/home/")


def test_orchestrator_prompt_covers_the_rules():
    s = P.ORCH_SYSTEM
    assert "The drawing decides plan position; the cloud decides height" in s  # D5
    assert "x = plant north" in s and "z = plant east" in s  # D9
    assert "title block" in s and "key plan" in s and "equipment list" in s and "leader" in s
    assert "Never invent a tag" in s and "indicative" in s and "other" in s and "composite" in s
    for name in ("set_site", "plan_packages", "next_stage", "finish", "render_site", "upsert_environment", "drawing_zoom"):
        assert name in s and name in ORCH_NAMES


def test_sub_run_prompt_covers_the_rules_and_the_catalogue():
    s = P.sub_system("pipe_rack (structure, default height 8 m): racks")
    assert s.startswith(P.SUB_SYSTEM) and s.endswith("pipe_rack (structure, default height 8 m): racks")
    for phrase in ("plant metres", "Never invent a tag", "finish_package", "drawing_zoom", "upsert_items", "height_source"):
        assert phrase in s
    for name in ("finish_package", "upsert_items", "drawing_zoom", "items_query"):
        assert name in SUB_NAMES


def test_messages_carry_no_key_or_path(handle, app):
    ids = seed_plant(handle, app)
    rc = make_rc(handle, app, ids)
    rc.notes = "Focus on the jetty."
    w = PackageWork(id="p", n=3, label="Jetty head", drawing_id=ids["drawings"][0], region=(0.1, 0.2, 0.5, 0.6), area="10", brief="Jetty at 1:500", expected_tags=("10-L-0001",))
    texts = [
        P.ORCH_SYSTEM, P.sub_system("x"), P.first_message(rc), P.survey_message(), P.review_message(rc),
        P.environment_message(rc), P.build_message(rc, ["a", "b"]), P.resume_message(rc), P.package_brief(w, rc),
    ]
    for t in texts:
        assert KEY not in t and not PATH.search(t), t[:200]
    brief = P.package_brief(w, rc)
    assert brief.startswith("Package P3: Jetty head\n") and "10-L-0001" in brief and ids["drawings"][0] in brief
    assert "[0.1, 0.2, 0.5, 0.6]" in brief
    first = P.first_message(rc)
    assert "Focus on the jetty." in first and "40,000,000 tokens" in first and "list_sources" in first
    assert "2 items fell back" in P.build_message(rc, ["a", "b"])
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `$PY -m pytest tests/test_plant_prompt.py -v`
Expected: FAIL with `ModuleNotFoundError` for `...plant.prompt_plant`.

- [ ] **Step 3: Implement**

```python
# backend/app/asset_models/agent/plant/prompt_plant.py
"""Plant run prompts (spec §8.5). The orchestrator and sub-run system prompts are constants, so they
are stable cached prefixes. The catalogue is appended to the sub-run prompt once per build. No keys,
no file-system paths: sources are named by their labels."""

from __future__ import annotations

from collections import Counter

ORCH_SYSTEM = """You run a plant model build. From a project's engineering drawings (and later its point cloud and ortho photo) you produce a typed register of every asset the drawings show. App code turns the register into a 3D model; you never write geometry or code.

The run has stages. The app tells you when each one starts:
1. survey - read the drawings, fix the site frame with set_site, split the tracing into packages with plan_packages, then call next_stage.
2. trace - sub-runs trace the packages in parallel. You wait.
3. review - the cloud check has run: name or leave the unregistered candidates, resolve the flags you can, then next_stage.
4. environment - trace land, sea, roads, paving and laydown areas from the overall plot plan with upsert_environment, checked against the ortho with ortho_view, then next_stage.
5. build - the app builds the model. Check it with render_site (plan, area:<label>, iso). You have up to two rounds of fixes, then call finish with a summary and honest open questions.

Frame. Item coordinates are plant metres [E, N] on the drawing's own plant grid; elevations are plant EL in metres. The 3D model frame is x = plant north, y = EL minus the datum, z = plant east. Bearings and rot_deg are clockwise from plant north.

Authority. The drawing decides plan position; the cloud decides height. Never move an item to match the cloud: a disagreement becomes a flag for the operator.

Reading scanned plot plans. They have no text layer, so read them with drawing_zoom. On each page find the title block (drawing number, title, scale, revision), the key plan (which part of the site the sheet shows), the grid labels (E and N values at the grid lines), the north arrow, and the equipment list or legend. Tags are small: zoom at 300 to 600 dpi into small regions, and zoom smaller when the note says the dpi was capped. A leader line joins a tag to its outline.

The site frame. Call set_site once. Either give grid points (at least two, better three or four far apart: each a grid intersection's page position read from drawing_zoom's page-fraction ticks plus its plant E/N labels) on a page that is already placed on the map, or give origin_crs and plant_north_deg read off a coordinate note or key plan, with their EPSG. A residual over 1 m means a misread point. Pages with grid points but no georeference are placed on the map from the grid.

Packages. A package is one region of one sheet, small enough for one sub-run: about 20 to 60 items. Trace from the area plot plans; use the overall plot plan for layout, for the environment, and for areas no area plan covers. Give each package a brief (what the region holds, the scale, anything hard to read) and the tags the equipment list says it holds (expected_tags). Avoid overlapping regions; items on a boundary are merged later.

Catalogue. Every item has a type from the builder catalogue (the catalogue tool). Use the most specific type. Use other (an extruded footprint) when nothing fits, and composite only for an item modelled from detailed M1 parts.

Honesty. Give heights only when a drawing states them (height_source drawing); otherwise give an indicative height (height_source indicative) or leave base_el and top_el empty. Confidence high only for what you read clearly. Never invent a tag: an item without a legible tag has tag null. Put what you could not read, and where sources disagree, in finish's open questions."""

SUB_SYSTEM = """You trace one package of a plant model build: one region of one drawing page. Write every asset you can see there to the register with upsert_items. App code builds the 3D geometry from the register.

Coordinates. Items are in plant metres [E, N] on the drawing's own plant grid, read from the grid labels; elevations are plant EL in metres. rot_deg and bearings are clockwise from plant north. Once the page is placed and the frame is set, drawing_zoom draws the plant E/N grid lines for you.

How to work:
1. drawing_zoom over the package region at a low dpi to see the layout, then zoom into smaller regions at 300 to 600 dpi to read tags, leaders, dimensions and grid labels.
2. For each asset: a footprint (rect for tanks' platforms, buildings and skids; circle for tanks and vessels seen from above; polygon for irregular outlines; line with a width for racks, roads, trestles, fences and pipes), its type from the catalogue below, its tag only if you can read it, and its area.
3. upsert_items in batches of up to 150. Each item is checked on its own; fix the rejected ones and send them again.
4. items_query to review what you saved and which expected tags are still missing.
5. finish_package with a short summary and the questions you could not answer.

Item fields: id (a slug unique in the plant: the tag in lower case such as 20-t-0001, else type-area-number), tag, name, type, area, footprint, base_el, top_el, levels, params (see catalogue type=<name> for the schema; leave out what the drawing does not give), height_source (drawing only when a drawing states the height, else indicative), source {kind: drawing, id: the drawing id, page, region: page fractions where you read it}, confidence (high only for what you read clearly), notes.

The drawing decides plan position; the cloud decides height. Never invent a tag: an item without a legible tag has tag null. Stay inside your package's region; items on its edge are merged with the neighbouring package later."""

SUB_NUDGE = "Continue with the tools, or call finish_package with a short summary."
WRAP_UP = (
    "The run's budget is used up. Save what you have traced with upsert_items now, then call finish_package. "
    "You have at most three more turns."
)
NUDGE = "Continue with the tools, or call next_stage (finish in the build stage)."


def sub_system(catalogue: str) -> str:
    return f"{SUB_SYSTEM}\n\nThe builder catalogue, type (family, default height): what it builds:\n{catalogue}"


def _budget_line(rc) -> str:
    lim = rc.limits
    return (
        f"Budget: {lim.max_tokens:,} tokens and {lim.max_images} images over the whole run, "
        f"{lim.max_seconds / 3600:g} h; up to {lim.parallel} packages run at once, each with up to "
        f"{lim.sub_calls} tool calls."
    )


def first_message(rc) -> str:
    lines = ["Task: build a plant model of this project from its drawings.", "Sources (call list_sources to see the drawing pages grouped by file):"]
    lines += [f"- {s['type']} {s['id']}: {s.get('label', '')} ({s.get('facts', '')})" for s in rc.sources[:60]]
    if len(rc.sources) > 60:
        lines.append(f"- and {len(rc.sources) - 60} more")
    lines.append(_budget_line(rc))
    if rc.notes:
        lines.append("The operator's notes:\n" + rc.notes)
    return "\n".join(lines)


def survey_message() -> str:
    return (
        "Stage: survey. Read every page's title block, key plan, grid labels and equipment list. Fix the site "
        "frame with set_site, plan the packages with plan_packages, then call next_stage."
    )


def _frame_line(rc) -> str:
    site = rc.site()
    if site is None:
        return "The site frame is not set."
    return (
        f"The site frame is set: plant north {site.plant_north_deg:.4f} deg clockwise from grid north, "
        f"datum {site.datum.label} = {site.datum.el_m:g} m."
    )


def review_message(rc) -> str:
    counts = Counter(f.code for i in rc.store.values() for f in i.flags)
    lines = [
        "Stage: review. The cloud check has run. The drawing decides plan position and the cloud decides "
        "height: never move an item to match the cloud.",
        f"The register has {len(rc.store)} items. Flags: "
        + (", ".join(f"{k} {v}" for k, v in sorted(counts.items())) or "none")
        + ".",
    ]
    if rc.state.candidates:
        lines.append(
            "Unregistered candidates (clusters in the cloud with no item), largest first. Name each real one "
            "as a new item with upsert_items (source kind cloud), or leave it:"
        )
        for c in rc.state.candidates[:100]:
            lines.append(
                f"- {c['id']}: centre E {c['e']:.1f} N {c['n']:.1f}, {c['size_m'][0]:.1f} x {c['size_m'][1]:.1f} m, "
                f"top EL {c['top_el']:.1f}"
            )
    lines += [f"Note: {n}" for n in rc.state.notes]
    lines.append("Use items_query (flag=...), drawing_zoom and ortho_view to resolve what you can, then next_stage.")
    return "\n".join(lines)


def environment_message(rc) -> str:
    return (
        "Stage: environment. Trace land, sea, roads, paved and laydown areas from the overall plot plan with "
        "upsert_environment (polygons in plant metres, el in plant EL), check them against the ortho with "
        f"ortho_view where there is one, then next_stage. {_frame_line(rc)}"
    )


def build_message(rc, fallen: list[str]) -> str:
    lines = [f"Stage: build. The app built {len(rc.store)} items."]
    if fallen:
        lines.append(
            f"{len(fallen)} items fell back to `other` (their params did not fit their type's builder): "
            + ", ".join(fallen[:40])
            + ". Fix their params or type, or leave them."
        )
    lines.append(
        "Check the model with render_site (plan, area:<label>, iso) against the drawings and the ortho. You "
        "have up to two rounds of fixes, then call finish with a summary and honest open questions."
    )
    return "\n".join(lines)


def resume_message(rc) -> str:
    return "\n".join(
        [
            "This run was interrupted (the app closed) and has resumed. Earlier conversation is not available.",
            f"Stage reached: {rc.state.stage}. {_frame_line(rc)} The register has {len(rc.store)} items.",
            _budget_line(rc),
        ]
    )


def package_brief(w, rc) -> str:
    region = list(w.region) if w.region else "the whole page"
    lines = [
        f"Package P{w.n}: {w.label}",
        f"Drawing: {w.drawing_id}; region {region} (page fractions [x0, y0, x1, y1], (0,0) top-left).",
        f"Area: {w.area or 'not given'}.",
        f"Brief: {w.brief}",
    ]
    if w.expected_tags:
        lines.append("Expected tags (from the equipment list): " + ", ".join(w.expected_tags))
    lines.append(_frame_line(rc))
    return "\n".join(lines)
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `$PY -m pytest tests/test_plant_prompt.py -v`
Expected: 3 passed.

- [ ] **Step 5: Commit**

```bash
git add backend/app/asset_models/agent/plant/prompt_plant.py backend/tests/test_plant_prompt.py
git commit -m "feat(plant-run): orchestrator and sub-run prompts" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 10: The package sub-run

**Files:**
- Create: `backend/app/asset_models/agent/plant/subrun.py`
- Test: `backend/tests/test_plant_subrun.py`

**Interfaces:**
- Consumes:
  - Task 5: `Scope`, `call_model`, `execute`, `specs_for`, `catalogue_text`.
  - Task 9: `prompt_plant.sub_system`, `package_brief`, `SUB_NUDGE`, `WRAP_UP`.
  - M1 `INTERNAL`.
- Produces: `PackageResult`, `run_package(rc, w) -> PackageResult`, `WRAP_UP_CALLS = 3`.
- Side effect: `run_package` registers its scope in `rc.inflight[w.id]` and leaves it there. The orchestrator removes it once the result is persisted (Task 11), so a stop can still collect in-flight items.

- [ ] **Step 1: Write the failing tests**

```python
# backend/tests/test_plant_subrun.py
"""A package sub-run (spec §8.2.2): its own append-only, cached conversation; per-package limits;
wrap-up when the run's budget is spent; rate-limit backoff; a failure stays in the package."""

import pytest
from plant_fakes import KEY, FakePlantLlm, item, make_rc, reply, seed_plant

from app.asset_models.agent.plant import model as M
from app.asset_models.agent.plant import prompt_plant as P
from app.asset_models.agent.plant.budget import PlantLimits
from app.asset_models.agent.plant.packages import PackageWork
from app.asset_models.agent.plant.subrun import WRAP_UP_CALLS, run_package
from app.db.models import AssetModelRun
from app.jobs.cancellation import JobCancelled
from app.project_agent.history import LlmError
from app.project_agent.llm import _RATE_LIMITED


def setup(handle, app, script, **limits):
    ids = seed_plant(handle, app, limits=PlantLimits(**limits) if limits else None)
    fake = FakePlantLlm(packages={"P1": script})
    app.state.jobs.agent_llm = fake
    rc = make_rc(handle, app, ids)
    w = PackageWork(id="pk1", n=1, label="Tanks", drawing_id=ids["drawings"][0], region=(0, 0, 0.5, 1), area="20", brief="Tanks", expected_tags=("20-T-0001",))
    return rc, w, fake


def test_a_package_traces_and_finishes(handle, app):
    rc, w, fake = setup(
        handle, app,
        [
            reply(("upsert_items", {"items": [item("t1", tag="20-T-0001")]})),
            reply(("finish_package", {"summary": "Traced 1.", "open_questions": ["Tank 2?"]})),
        ],
    )
    res = run_package(rc, w)
    assert (res.state, res.summary, res.questions, res.calls) == ("done", "Traced 1.", ["Tank 2?"], 2)
    assert [i.id for i in res.items] == ["t1"] and res.usage == {"input_tokens": 200, "output_tokens": 100}
    calls = fake.of("P1")
    assert all(c["cache"] for c in calls) and calls[0]["effort"] == "high" and calls[0]["api_key"] == KEY
    assert calls[1]["history_len"] - calls[0]["history_len"] == 2  # append-only: + assistant, + tool_results
    assert "plan_packages" not in calls[0]["tools"] and "finish_package" in calls[0]["tools"]
    assert rc.budget.snapshot("trace")["by_stage"]["trace"]["calls"] == 2
    assert "pk1" in rc.inflight
    with handle.session() as s:
        steps = s.get(AssetModelRun, rc.run_id).steps
    assert [st["summary"].split(" · ")[0] for st in steps] == ["P1", "P1"]


def test_the_package_call_limit(handle, app):
    rc, w, fake = setup(handle, app, [reply(("items_query", {}), ("items_query", {})), reply(("items_query", {}))], sub_calls=1)
    res = run_package(rc, w)
    assert res.state == "done" and res.calls == 1 and "package limit of 1 tool calls" in res.summary
    assert len(fake.of("P1")) == 1


def test_wrap_up_when_the_run_budget_is_spent(handle, app):
    script = [reply(("upsert_items", {"items": [item("t1")]}), usage=(90, 20))] + [reply(("items_query", {}))] * 5
    rc, w, fake = setup(handle, app, script, max_tokens=100)
    res = run_package(rc, w)
    calls = fake.of("P1")
    assert len(calls) == 1 + WRAP_UP_CALLS and P.WRAP_UP in calls[1]["user_texts"]
    assert res.state == "done" and "budget ran out" in res.summary and [i.id for i in res.items] == ["t1"]


def test_rate_limit_retries_then_fails_package_only(handle, app, monkeypatch):
    monkeypatch.setattr(M, "RATE_RETRIES_S", (0.0, 0.0))
    rc, w, fake = setup(handle, app, [LlmError(_RATE_LIMITED), reply(("finish_package", {"summary": "ok"}))])
    assert run_package(rc, w).state == "done" and len(fake.of("P1")) == 2
    rc2, w2, fake2 = setup(handle, app, [LlmError(_RATE_LIMITED)] * 3)
    res = run_package(rc2, w2)  # no exception: the package fails, the run goes on
    assert res.state == "failed" and res.summary == _RATE_LIMITED and len(fake2.of("P1")) == 3


def test_other_provider_errors_fail_at_once(handle, app):
    rc, w, fake = setup(handle, app, [LlmError("The provider could not complete this step. Try again.")])
    assert run_package(rc, w).state == "failed" and len(fake.of("P1")) == 1


def test_a_missing_key_fails_the_package(handle, app):
    rc, w, fake = setup(handle, app, [])
    app.state.keys.delete("anthropic")
    res = run_package(rc, w)
    assert res.state == "failed" and "API key" in res.summary and fake.calls == []


def test_two_quiet_replies_end_the_package(handle, app):
    rc, w, _ = setup(handle, app, [reply(text="Looking."), reply(text="Done.")])
    res = run_package(rc, w)
    assert res.state == "done" and res.summary == "Ended without finish_package."


def test_calls_after_finish_package_are_not_run(handle, app):
    rc, w, _ = setup(handle, app, [reply(("finish_package", {"summary": "s"}), ("upsert_items", {"items": [item("late")]}))])
    res = run_package(rc, w)
    assert res.items == [] and res.calls == 1


def test_stop_propagates_and_keeps_the_items_reachable(handle, app):
    holder = {}

    def stop_now():
        holder["rc"].job.cancelled.set()
        return reply(("upsert_items", {"items": [item("t1")]}))

    rc, w, _ = setup(handle, app, [stop_now])
    holder["rc"] = rc
    with pytest.raises(JobCancelled):
        run_package(rc, w)
    assert list(rc.inflight["pk1"].items) == ["t1"]
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `$PY -m pytest tests/test_plant_subrun.py -v`
Expected: FAIL with `ModuleNotFoundError` for `...plant.subrun`.

- [ ] **Step 3: Implement**

```python
# backend/app/asset_models/agent/plant/subrun.py
"""One package's sub-run (spec §8.2.2). It is a fresh append-only conversation over the package brief,
the catalogue (cached in the system prompt) and the package tools. It runs until one of these:
- finish_package;
- its call or token limit;
- the run's budget wrap-up (ruling R8: at most WRAP_UP_CALLS more calls);
- two replies without a tool call.

A provider error fails only this package."""

from __future__ import annotations

import logging
from dataclasses import dataclass, field

from app.asset_models.agent.plant import prompt_plant as P
from app.asset_models.agent.plant.context import Scope
from app.asset_models.agent.plant.model import call_model
from app.asset_models.agent.plant.packages import PackageWork
from app.asset_models.agent.plant.tools_plant import catalogue_text, execute, specs_for
from app.asset_models.agent.runner import INTERNAL
from app.asset_models.spec import Item
from app.jobs.cancellation import JobCancelled
from app.project_agent.history import HistoryEntry, LlmError, ToolResult

log = logging.getLogger(__name__)
WRAP_UP_CALLS = 3


@dataclass
class PackageResult:
    package_id: str
    n: int
    state: str
    items: list[Item]
    usage: dict
    calls: int
    images: int
    summary: str
    questions: list[str] = field(default_factory=list)


def _result(w: PackageWork, scope: Scope, usage: dict, state: str, summary: str, questions=()) -> PackageResult:
    return PackageResult(
        package_id=w.id,
        n=w.n,
        state=state,
        items=list(scope.items.values()),
        usage=dict(usage),
        calls=scope.calls,
        images=scope.images,
        summary=summary[:2000],
        questions=list(questions)[:10],
    )


def run_package(rc, w: PackageWork) -> PackageResult:
    scope = Scope(name=f"P{w.n}", stage="trace", items={}, package=w)
    rc.inflight[w.id] = scope
    system = P.sub_system(catalogue_text())
    tools = specs_for("package")
    history = [HistoryEntry(role="user", text=P.package_brief(w, rc))]
    usage = {"input_tokens": 0, "output_tokens": 0}
    idle = wrap_calls = 0
    note = None
    try:
        while True:
            rc.check_cancelled()
            if not scope.wrap_up and rc.budget.exhausted():
                scope.wrap_up = True
                history.append(HistoryEntry(role="user", text=P.WRAP_UP))
            if scope.wrap_up:
                wrap_calls += 1
                if wrap_calls > WRAP_UP_CALLS:
                    note = "Closed when the run's budget ran out."
                    break
            if scope.calls >= rc.limits.sub_calls:
                note = f"Stopped at the package limit of {rc.limits.sub_calls} tool calls."
                break
            if usage["input_tokens"] + usage["output_tokens"] >= rc.limits.sub_tokens:
                note = "Stopped at the package token limit."
                break
            reply = call_model(rc, system=system, history=history, tools=tools)
            if reply.usage:
                for k in usage:
                    usage[k] += int(reply.usage.get(k, 0) or 0)
                rc.budget.charge(reply.usage, "trace")
                rc.recorder.usage(rc.budget)
            history.append(
                HistoryEntry(
                    role="assistant",
                    text=reply.text or "",
                    tool_calls=list(reply.tool_calls),
                    provider=rc.provider,
                    model=rc.model_name,
                    provider_payload=reply.provider_payload,
                )
            )
            if not reply.tool_calls:
                idle += 1
                if idle >= 2:
                    note = "Ended without finish_package."
                    break
                history.append(HistoryEntry(role="user", text=P.SUB_NUDGE))
                continue
            idle = 0
            results = []
            for call in reply.tool_calls:
                if scope.finished is not None:
                    results.append(ToolResult(call.id, call.name, "Not run: the package already finished.", is_error=True))
                    continue
                if scope.calls >= rc.limits.sub_calls:
                    results.append(ToolResult(call.id, call.name, "Not run: the package reached its tool-call limit.", is_error=True))
                    continue
                scope.calls += 1
                rc.budget.charge_call("trace")
                results.append(execute(rc, scope, call))
            history.append(HistoryEntry(role="tool_results", results=results))
            if scope.finished is not None:
                break
    except JobCancelled:
        raise
    except LlmError as e:  # fixed, user-safe text
        log.info("plant package %s failed on a provider error", scope.name)
        return _result(w, scope, usage, "failed", e.message)
    except Exception as e:  # noqa: BLE001 - one package's bug must not end the run; type name only
        log.error("plant package %s failed (%s)", scope.name, type(e).__name__)
        return _result(w, scope, usage, "failed", INTERNAL)
    fin = scope.finished or {}
    return _result(w, scope, usage, "done", fin.get("summary") or note or "Finished.", fin.get("open_questions", []))
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `$PY -m pytest tests/test_plant_subrun.py -v`
Expected: 9 passed.

- [ ] **Step 5: Commit**

```bash
git add backend/app/asset_models/agent/plant/subrun.py backend/tests/test_plant_subrun.py
git commit -m "feat(plant-run): package sub-run with limits, wrap-up and rate-limit backoff" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 11: The orchestrator and the runner dispatch (full pipeline)

**Files:**
- Create: `backend/app/asset_models/agent/plant/orchestrator.py`
- Create: `backend/app/asset_models/agent/plant/cloud.py` (Task 11 version: records why no check ran. Task 16 fills it with C1.)
- Modify: `backend/app/asset_models/agent/runner.py` (dispatch at the top of `run_asset_model`; plant packages in `_cancelled_before_start`)
- Test: `backend/tests/test_plant_run.py`

**Interfaces:**
- Consumes: Tasks 2–10; M1 `service.add_version`, `service.refresh_status`, `look.cloud.sample_cloud`, `source_of`, `CloudSample`; F0 `build_item`, `BuildCtx`, `load_all`.
- Produces:
  - `orchestrator.run_plant(ctx) -> dict`, `orchestrator.build_check(rc) -> list[str]`, `orchestrator.Conversation`, `orchestrator.ORCH_CALLS`;
  - `cloud.cloud_stage(rc) -> None`;
  - the runner dispatch for `PLANT_MODES`.

- [ ] **Step 1: Write the failing pipeline test**

```python
# backend/tests/test_plant_run.py
"""The plant run end to end with a scripted fake model (spec §13 R1):
survey -> 3 packages (2 in parallel) -> merge -> cloud check (none) -> environment -> build ->
self-check -> finish. Also: append-only cached conversations, per-stage usage, and no prompt,
payload, model text or key in the logs."""

import logging
import threading

from plant_fakes import KEY, KIPIC, FakePlantLlm, item, make_ctx, reply, seed_plant

from app.asset_models import store
from app.asset_models.agent import runner as R
from app.asset_models.agent.plant import packages as pk
from app.asset_models.agent.plant.budget import PlantLimits
from app.db.models import AssetModel, AssetModelRun
from app.jobs.cancellation import JobCancelled


def finish_pkg(summary="Traced."):
    return reply(("finish_package", {"summary": summary}))


def run_job(handle, app, ids, fake):
    app.state.jobs.agent_llm = fake
    ctx = make_ctx(handle, app, ids)
    try:
        result = R.run_asset_model(ctx)
    except JobCancelled:
        result = None
    with handle.session() as s:
        run = s.get(AssetModelRun, ids["run"])
        model = s.get(AssetModel, ids["model"])
        s.expunge_all()
    return ctx, result, run, model


def plan3(ids):
    d0, d1 = ids["drawings"]
    return {"packages": [
        {"label": "Tank area", "drawing_id": d0, "region": [0, 0, 0.5, 1], "area": "20", "brief": "Two tanks", "expected_tags": ["20-T-0001", "20-T-0002"]},
        {"label": "Jetty", "drawing_id": d1, "region": [0, 0, 1, 1], "area": "10", "brief": "Jetty head"},
        {"label": "Utilities", "drawing_id": d0, "region": [0.5, 0, 1, 1], "area": "30", "brief": "Pumps"},
    ]}


def test_full_pipeline_with_parallel_packages(handle, app, caplog):
    caplog.set_level(logging.DEBUG)
    ids = seed_plant(handle, app, limits=PlantLimits(parallel=2))
    d0, d1 = ids["drawings"]
    both = threading.Barrier(2, timeout=10)  # passes only if P1 and P2 call the model at the same time

    def together(r):
        return lambda: (both.wait(), r)[1]

    orchestrator = [
        reply(("list_sources", {}), ("set_site", {**KIPIC, "source_drawing_id": d0})),
        reply(("plan_packages", plan3(ids))),
        reply(("next_stage", {"summary": "Three packages."})),
        reply(("upsert_environment", {"features": [{"id": "sea", "kind": "sea", "pts": [[-100, -100], [300, -100], [300, -60]], "el": 100.0, "source": {"kind": "drawing", "id": d0}}]})),
        reply(("next_stage", {"summary": "Sea traced."})),
        reply(("render_site", {"views": ["plan", "iso"], "overlay": "none"})),
        reply(("upsert_items", {"items": [item("pump-30-1", e=150, n=40, did=d0, area="30", name="Pump skid SECRET-PAYLOAD-NAME")]})),
        reply(("finish", {"summary": "Built 4 items.", "open_questions": ["Is the jetty head EL right?"]}), text="SECRET-MODEL-TEXT"),
    ]
    packages = {
        "P1": [together(reply(("upsert_items", {"items": [
            item("20-t-0001", tag="20-T-0001", did=d0, area="20"),
            item("20-t-0002", tag="20-T-0002", e=60, did=d0, area="20"),
        ]}))), finish_pkg("Two tanks traced.")],
        "P2": [together(reply(("upsert_items", {"items": [
            item("10-j-1", tag="10-J-0001", n=200, did=d1, area="10"),
            item("20-t-0002-dup", tag="20-T-0002", e=63, did=d1, area="20"),
        ]}))), finish_pkg("Jetty traced.")],
        "P3": [reply(("upsert_items", {"items": [item("pump-30-1", e=150, n=40, did=d0, area="30")]})), finish_pkg("One pump.")],
    }
    fake = FakePlantLlm(orchestrator, packages)
    ctx, result, run, model = run_job(handle, app, ids, fake)

    assert run.state == "finished" and run.stop_reason is None and run.summary == "Built 4 items."
    assert "Is the jetty head EL right?" in run.open_questions
    assert any("No cloud check" in q for q in run.open_questions)
    assert result == {"run_id": ids["run"], "version": 1}
    with handle.session() as s:
        v = store.get_version(s, ids["model"], 1)
        assert v.kind == "agent" and v.glb_job_id
        spec = v.spec
        rows = [(r.label, r.state, r.item_count) for r in pk.rows(s, ids["run"])]
    assert rows == [("Tank area", "done", 2), ("Jetty", "done", 2), ("Utilities", "done", 1)]
    got = {i["id"]: i for i in spec["items"]}
    assert set(got) == {"20-t-0001", "20-t-0002-dup", "10-j-1", "pump-30-1"}  # 20-T-0002 merged once
    assert got["20-t-0002-dup"]["flags"][0]["code"] == "straddles_package"
    assert got["pump-30-1"]["name"] == "Pump skid SECRET-PAYLOAD-NAME"  # the build-stage fix round
    assert spec["site"]["plant_north_deg"] == 17.9991 and spec["environment"][0]["id"] == "sea"

    assert [len(fake.of(p)) for p in ("P1", "P2", "P3")] == [2, 2, 2]
    for conv in ("orchestrator", "P1", "P2", "P3"):
        lens = [c["history_len"] for c in fake.of(conv)]
        assert lens == sorted(lens) and all(c["cache"] for c in fake.of(conv))
    assert "plan_packages" in fake.of("orchestrator")[0]["tools"]
    assert "plan_packages" not in fake.of("P1")[0]["tools"]

    usage = run.usage
    assert {"survey", "trace", "environment", "build"} <= set(usage["by_stage"]) and usage["current"] == "done"
    assert usage["by_stage"]["trace"]["calls"] == 6
    assert any(st["summary"].startswith("P1 · ") for st in run.steps)
    assert model.live_run_id is None and model.current_version == 1 and model.status == "ready"

    for secret in (KEY, "SECRET-PAYLOAD-NAME", "SECRET-MODEL-TEXT", "Two tanks"):
        assert secret not in caplog.text
    assert "plant tool P1 upsert_items ok=True" in caplog.text


def test_m1_runs_are_not_dispatched(handle, app):
    ids = seed_plant(handle, app, mode="build")
    fake = FakePlantLlm()
    _, _, run, _ = run_job(handle, app, ids, fake)
    assert fake.of("orchestrator") == []  # the M1 loop ran (its own SYSTEM prompt)


def test_cancel_before_start_skips_plant_packages(handle, app):
    from app.jobs.registry import cancelled_before_start_hook

    ids = seed_plant(handle, app)
    with handle.session() as s:
        pk.replace_queued(s, ids["run"], [{"label": "A"}, {"label": "B"}])
    cancelled_before_start_hook(R.RUN_JOB)(make_ctx(handle, app, ids))
    with handle.session() as s:
        assert [r.state for r in pk.rows(s, ids["run"])] == ["skipped", "skipped"]
        assert s.get(AssetModelRun, ids["run"]).state == "stopped"
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `$PY -m pytest tests/test_plant_run.py -v`
Expected: `test_full_pipeline_with_parallel_packages` FAILS. The M1 loop runs the plant run and its SYSTEM is not `ORCH_SYSTEM`, so the fake routes the call to `"?"` and the plant run never ends `finished` with version 1. `test_cancel_before_start_skips_plant_packages` FAILS with `['queued', 'queued']`.

- [ ] **Step 3: Implement `cloud.py` (pre-C1 version)**

```python
# backend/app/asset_models/agent/plant/cloud.py
"""The cloud check stage (spec §8.2.4). Until C1's module is consumed (Task 16) it only records, as a
run note, why no check ran."""

from __future__ import annotations


def _note(rc, text: str) -> None:
    with rc.lock:
        if text not in rc.state.notes:
            rc.state.notes.append(text)
    rc.save()


def cloud_stage(rc) -> None:
    if not any(x["type"] == "point_cloud" for x in rc.sources):
        _note(rc, "No cloud check: no point cloud among the run's sources.")
        return
    _note(rc, "No cloud check: the cloud check is not part of this build yet.")
```

- [ ] **Step 4: Implement `orchestrator.py`**

```python
# backend/app/asset_models/agent/plant/orchestrator.py
"""The plant run (spec §8): survey -> parallel package sub-runs -> merge -> cloud check -> review ->
environment -> build check + self-check -> finish, inside the `asset_model_run` job.

The orchestrator is one append-only conversation across its stages. App code runs trace, merge, the
cloud check and the build check. Logs carry tool names, states, durations and counts only."""

from __future__ import annotations

import logging
from collections import deque
from concurrent.futures import FIRST_COMPLETED, ThreadPoolExecutor, wait
from datetime import UTC, datetime

from app.asset_models import service
from app.asset_models import store as mstore
from app.asset_models.agent.plant import packages as pk
from app.asset_models.agent.plant import prompt_plant as P
from app.asset_models.agent.plant.cloud import cloud_stage
from app.asset_models.agent.plant.context import PlantRunContext, Scope, build_context
from app.asset_models.agent.plant.merge import merge_items, with_flag
from app.asset_models.agent.plant.model import call_model
from app.asset_models.agent.plant.state import STAGE_ORDER, env_of, load_package_items, save_package_items
from app.asset_models.agent.plant.subrun import PackageResult, run_package
from app.asset_models.agent.plant.tools_plant import execute, specs_for
from app.asset_models.agent.runner import INTERNAL
from app.asset_models.look import LookError
from app.asset_models.look.cloud import CloudSample, sample_cloud, source_of
from app.asset_models.spec import AssetSpec
from app.db.models import AssetModel, AssetModelRun
from app.errors import AppError
from app.jobs.cancellation import JobCancelled
from app.project_agent.history import HistoryEntry, LlmError, ToolResult

log = logging.getLogger(__name__)
ORCH_CALLS = {"survey": 120, "review": 60, "environment": 60, "build": 40}
NOT_RUN_STAGE = "Not run: this stage already ended."


class BudgetOut(Exception):
    def __init__(self, why: str):
        super().__init__(why)
        self.why = why


class _Stop(Exception):
    def __init__(self, state: str, reason: str | None, summary: str):
        super().__init__(summary)
        self.state, self.reason, self.summary = state, reason, summary


def _before(stage: str, other: str) -> bool:
    return STAGE_ORDER.index(stage) < STAGE_ORDER.index(other)


def _advance(rc: PlantRunContext, stage: str) -> None:
    rc.state.stage = stage
    rc.save()
    rc.recorder.enter(stage)


# ------------------------------------------------------------------ the orchestrator conversation
class Conversation:
    def __init__(self, rc: PlantRunContext, opening: str):
        self.rc, self.opening = rc, opening
        self.history: list[HistoryEntry] = []
        self.scope = Scope(name="orchestrator", stage="survey", items=rc.store)
        self.specs = specs_for("orchestrator")

    def run_stage(self, stage: str, message: str) -> None:
        rc, scope = self.rc, self.scope
        scope.stage, scope.next_stage, scope.rendered = stage, None, False
        rc.recorder.enter(stage)
        self.history.append(HistoryEntry(role="user", text=f"{self.opening}\n\n{message}" if not self.history else message))
        calls = idle = 0
        while True:
            rc.check_cancelled()
            why = rc.budget.exhausted()
            if why:
                raise BudgetOut(why)
            if calls >= ORCH_CALLS[stage]:
                rc.state.notes.append(f"The {stage} stage reached its limit of {ORCH_CALLS[stage]} tool calls.")
                rc.save()
                return
            reply = call_model(rc, system=P.ORCH_SYSTEM, history=self.history, tools=self.specs)
            if reply.usage:
                rc.budget.charge(reply.usage, stage)
                rc.recorder.usage(rc.budget)
            self.history.append(
                HistoryEntry(
                    role="assistant",
                    text=reply.text or "",
                    tool_calls=list(reply.tool_calls),
                    provider=rc.provider,
                    model=rc.model_name,
                    provider_payload=reply.provider_payload,
                )
            )
            if not reply.tool_calls:
                idle += 1
                if idle >= 2:
                    if stage == "build" and rc.finished is None:
                        rc.finished = {"summary": (reply.text or "")[:4000], "open_questions": []}
                    return
                self.history.append(HistoryEntry(role="user", text=P.NUDGE))
                continue
            idle = 0
            results = []
            for call in reply.tool_calls:
                if scope.next_stage is not None or rc.finished is not None:
                    results.append(ToolResult(call.id, call.name, NOT_RUN_STAGE, is_error=True))
                    continue
                calls += 1
                rc.budget.charge_call(stage)
                results.append(execute(rc, scope, call))
            self.history.append(HistoryEntry(role="tool_results", results=results))
            if scope.next_stage is not None or rc.finished is not None:
                return


# ------------------------------------------------------------------ app stages
def _sample_m1_clouds(rc: PlantRunContext) -> None:
    """M1's <= 2 M point samples, for the look tools cloud_slice / cloud_fit. A cloud that can't be read
    becomes a run note, not a failure."""
    for cid in [x["id"] for x in rc.sources if x["type"] == "point_cloud"]:
        path = rc.run_dir / f"cloud_{cid}.npz"
        try:
            if path.exists():
                rc.m1.samples[cid] = CloudSample.load(path)
                continue
            sample = sample_cloud(source_of(rc.handle, cid), check_cancelled=rc.check_cancelled)
        except LookError as e:
            rc.state.notes.append(f"Point cloud {cid}: {e.message}")
            continue
        rc.run_dir.mkdir(parents=True, exist_ok=True)
        sample.save(path)
        rc.m1.samples[cid] = sample


def _persist(rc: PlantRunContext, w, res: PackageResult) -> None:
    save_package_items(rc.run_dir, w.n, res.items)  # the file first: a crash after it still counts as done
    with rc.lock, rc.handle.session() as s:
        pk.set_state(s, w.id, res.state, usage=res.usage, item_count=len(res.items), summary=res.summary)
    rc.inflight.pop(w.id, None)
    with rc.lock:
        rc.state.questions.extend(f"P{w.n}: {q}" for q in res.questions)
    rc.save()
    log.info("plant package P%d %s items=%d calls=%d", w.n, res.state, len(res.items), res.calls)


def _trace(rc: PlantRunContext) -> None:
    with rc.handle.session() as s:
        rows = pk.rows(s, rc.run_id)
        works = [pk.work_of(r, rc.state.packages_meta.get(r.id, {})) for r in rows if r.state == "queued"]
        total, done = len(rows), sum(1 for r in rows if r.state in pk.TERMINAL)
    rc.recorder.enter("trace", done, total)
    pending, running = deque(works), {}
    pool = ThreadPoolExecutor(max_workers=rc.limits.parallel, thread_name_prefix="plant-package")
    try:
        while pending or running:
            while pending and len(running) < rc.limits.parallel and rc.budget.exhausted() is None:
                rc.check_cancelled()
                w = pending.popleft()
                with rc.lock, rc.handle.session() as s:
                    pk.set_state(s, w.id, "running")
                running[pool.submit(run_package, rc, w)] = w
            if not running:
                break
            finished, _ = wait(list(running), timeout=0.5, return_when=FIRST_COMPLETED)
            for f in finished:
                w = running.pop(f)
                _persist(rc, w, f.result())  # JobCancelled from a sub-run propagates
                done += 1
                rc.recorder.enter("trace", done, total)
            rc.check_cancelled()
    finally:
        pool.shutdown(wait=True, cancel_futures=True)
    if pending:
        with rc.lock, rc.handle.session() as s:
            for w in pending:
                pk.set_state(s, w.id, "skipped", summary="Not started: the run's budget ran out.")


def _base_spec(rc: PlantRunContext) -> AssetSpec:
    with rc.handle.session() as s:
        return AssetSpec.model_validate(mstore.get_version(s, rc.model_id, rc.state.base_version).spec)


def _merge(rc: PlantRunContext, extra: list | None = None) -> None:
    lists, labels = [], []
    if rc.mode == "plant_package" and rc.state.base_version:
        lists.append(list(_base_spec(rc).items))
        labels.append(f"version {rc.state.base_version}")
    with rc.handle.session() as s:
        rows = [(r.n, r.state) for r in pk.rows(s, rc.run_id)]
    for n, state in rows:
        items = load_package_items(rc.run_dir, n) if state in ("done", "failed") else None
        if items:
            lists.append(items)
            labels.append(f"P{n}")
    for label, items in extra or []:
        lists.append(items)
        labels.append(label)
    merged = merge_items(lists, labels)
    with rc.lock:
        rc.store.clear()
        rc.store.update({i.id: i for i in merged})
    rc.save_store()


def build_check(rc: PlantRunContext) -> list[str]:
    """Build every item in process with the GLB's own builders (ruling R4); flag the fallbacks."""
    from app.asset_models.builders import BuildCtx, build_item, load_all

    load_all()
    ctx = BuildCtx(grid=rc.grid(), lod=0.25)
    fallen = []
    with rc.lock:
        items = list(rc.store.values())
    for it in items:
        rc.check_cancelled()
        _nodes, flags = build_item(it, ctx)
        fb = next((f for f in flags if f.code == "builder_fallback"), None)
        if fb is not None:
            with rc.lock:
                rc.store[it.id] = with_flag(rc.store[it.id], fb)
            fallen.append(it.id)
    rc.save_store()
    return fallen


# ------------------------------------------------------------------ flows
def _full(rc: PlantRunContext) -> dict:
    st = rc.state
    _sample_m1_clouds(rc)
    if st.stage == "survey":
        conv = Conversation(rc, P.first_message(rc))
        conv.run_stage("survey", P.survey_message())
        with rc.handle.session() as s:
            if not pk.rows(s, rc.run_id):
                raise _Stop("failed", None, "The survey planned no packages, so nothing was traced.")
        _advance(rc, "trace")
    else:
        conv = Conversation(rc, P.resume_message(rc))
    if st.stage == "trace":
        _trace(rc)
        _advance(rc, "merge")
    why = rc.budget.exhausted()
    if why:
        raise BudgetOut(why)
    if st.stage == "merge":
        _merge(rc)
        _advance(rc, "cloud_check")
    if st.stage == "cloud_check":
        cloud_stage(rc)
        _advance(rc, "review")
    if st.stage == "review":
        if rc.check is not None or st.candidates:
            conv.run_stage("review", P.review_message(rc))
        _advance(rc, "environment")
    if st.stage == "environment":
        conv.run_stage("environment", P.environment_message(rc))
        _advance(rc, "build")
    fallen = build_check(rc)
    conv.run_stage("build", P.build_message(rc, fallen))
    fin = rc.finished or {"summary": "The run ended without a summary.", "open_questions": []}
    return _end(rc, "finished", None, fin["summary"], fin["open_questions"], kind="agent")


def _app_only_finish(rc: PlantRunContext, why: str) -> dict:
    """Ruling R8: the budget or the clock ran out. Merge, check and build what was traced."""
    reason = "budget" if why == "tokens" else "timeout"
    head = "The run used its token budget" if reason == "budget" else "The run reached its time limit"
    st = rc.state
    if st.stage == "survey":
        return _end(rc, "stopped", reason, f"{head} during the survey; nothing was traced.", [], kind="draft")
    if st.stage == "trace":
        with rc.lock, rc.handle.session() as s:
            pk.mark_unfinished(s, rc.run_id, "skipped", "Not started: the run's budget ran out.")
        _advance(rc, "merge")
    if st.stage == "merge":
        _merge(rc)
        _advance(rc, "cloud_check")
    if st.stage == "cloud_check":
        cloud_stage(rc)
        _advance(rc, "review")
    build_check(rc)
    with rc.handle.session() as s:
        skipped = [f"P{r.n} {r.label}" for r in pk.rows(s, rc.run_id) if r.state == "skipped"]
    summary = f"{head}; it merged, checked and built what was traced. Not traced: {', '.join(skipped) or 'none'}."
    return _end(rc, "stopped", reason, summary, [], kind="agent")


def _collect_for_stop(rc: PlantRunContext) -> None:
    """Before merge, the register is the finished packages plus what in-flight sub-runs had saved."""
    if _before(rc.state.stage, "cloud_check"):
        extra = [(f"P{s.package.n}", list(s.items.values())) for s in list(rc.inflight.values()) if s.items]
        _merge(rc, extra)


def _quiet(fn, rc) -> None:
    try:
        fn(rc)
    except Exception as e:  # noqa: BLE001 - recording a failure must not raise again
        log.error("plant run could not collect its items (%s)", type(e).__name__)


def run_plant(ctx) -> dict:
    rc = build_context(ctx)
    try:
        if rc.mode == "plant_package":
            return _package_rerun(rc)
        return _full(rc)
    except BudgetOut as e:
        return _app_only_finish(rc, e.why)
    except _Stop as e:
        return _end(rc, e.state, e.reason, e.summary, [], kind="draft")
    except JobCancelled:
        try:
            _collect_for_stop(rc)
            _end(rc, "stopped", "user", "Stopped by the operator.", [], kind="draft")
        except Exception as e:  # noqa: BLE001 - the cancel must still propagate
            log.error("plant run could not record its stop (%s)", type(e).__name__)
        raise
    except LlmError as e:
        _quiet(_collect_for_stop, rc)
        return _end(rc, "failed", "provider_error", e.message, [], kind="draft")
    except Exception as e:  # noqa: BLE001 - never leave a run stuck "running"; fixed text, type name only
        log.error("plant run failed (%s)", type(e).__name__)
        _quiet(_collect_for_stop, rc)
        return _end(rc, "failed", None, e.message if isinstance(e, LookError) else INTERNAL, [], kind="draft")


def _package_rerun(rc: PlantRunContext) -> dict:
    raise NotImplementedError  # Task 12


# ------------------------------------------------------------------ the end
def _write_version(rc: PlantRunContext, items, env, kind: str, summary: str) -> int | None:
    spec = AssetSpec(site=rc.site(), items=items, environment=env)
    src = [{"type": x["type"], "id": x["id"]} for x in rc.sources]
    for attempt in (1, 2):
        try:
            row, _job = service.add_version(
                rc.handle, rc.job.runner, rc.model_id, spec, kind=kind, note=summary, source_ids=src, run_id=rc.run_id
            )
            return row.version
        except AppError as e:  # R20: drop the items the validator names, once
            bad = {x.get("part_id") for x in (e.details or {}).get("errors", []) if x.get("part_id")}
            if attempt == 2 or not bad:
                log.error("plant run could not write its version (%s)", e.code)
                return None
            spec = spec.model_copy(update={"items": [i for i in spec.items if i.id not in bad]})
        except Exception as e:  # noqa: BLE001 - never lose the run's end; type name only
            log.error("plant run could not write its version (%s)", type(e).__name__)
            return None
    return None


def _end(rc: PlantRunContext, state: str, reason: str | None, summary: str, questions, *, kind: str) -> dict:
    with rc.lock:
        items = list(rc.store.values())
    env = env_of(rc.state)
    version = _write_version(rc, items, env, kind, summary) if (items or env) else None
    with rc.lock, rc.handle.session() as s:
        pk.mark_unfinished(s, rc.run_id, "skipped", "Not finished: the run ended.")
        run = s.get(AssetModelRun, rc.run_id)
        qs = [*questions, *rc.state.questions, *rc.state.notes][:30]
        run.state, run.stop_reason, run.summary = state, reason, summary
        run.open_questions = [q[:500] for q in qs]
        run.version, run.phase, run.ended_at = version, "done", datetime.now(UTC)
        run.usage = rc.budget.snapshot("done")
        model = s.get(AssetModel, rc.model_id)
        if model.live_run_id == rc.run_id:
            model.live_run_id = None
        service.refresh_status(model)
    rc.state.stage = "done"
    rc.save()
    rc.job.publish("asset_models.changed", {"asset_model_ids": [rc.model_id], "run_id": rc.run_id})
    log.info("plant run ended %s reason=%s items=%d version=%s", state, reason, len(items), version)
    return {"run_id": rc.run_id, "version": version}
```

- [ ] **Step 5: Dispatch from the M1 runner**

In `backend/app/asset_models/agent/runner.py`:
- add `from app.asset_models.agent.plant import PLANT_MODES` to the imports (the package `__init__` is import-light);
- make the first lines of `run_asset_model` dispatch;
- add `_mode_of`.

```python
@register_job_type(RUN_JOB, on_cancelled_before_start=_cancelled_before_start)
def run_asset_model(ctx) -> dict:
    if _mode_of(ctx) in PLANT_MODES:  # spec 2026-10-03 §8: plant runs have their own orchestrator
        from app.asset_models.agent.plant.orchestrator import run_plant

        return run_plant(ctx)
    model_id, run_id = ctx.params["model_id"], ctx.params["run_id"]
    # ... the M1 body continues unchanged ...


def _mode_of(ctx) -> str | None:
    run_id = ctx.params.get("run_id")
    if not run_id:
        return None
    with ctx.project.session() as s:
        run = s.get(AssetModelRun, run_id)
        return run.mode if run is not None else None
```

In `_cancelled_before_start`, inside `if run is not None and run.state == "running":` and after the existing assignments, add:

```python
            if run.mode in PLANT_MODES:
                from app.asset_models.agent.plant import packages as plant_packages

                plant_packages.mark_unfinished(s, run_id, "skipped", "Not started: the run was stopped.")
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `$PY -m pytest tests/test_plant_run.py tests/test_asset_model_run_job.py -v`
Expected: all pass. The M1 run-job tests are unchanged.

- [ ] **Step 7: Commit**

```bash
git add backend/app/asset_models/agent/plant/orchestrator.py backend/app/asset_models/agent/plant/cloud.py backend/app/asset_models/agent/runner.py backend/tests/test_plant_run.py
git commit -m "feat(plant-run): orchestrator, parallel trace, merge, build check; runner dispatch" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 12: Budget-out, stop, errors and `plant_package` re-runs (Review Focus #5)

**Files:**
- Modify: `backend/app/asset_models/agent/plant/orchestrator.py` (replace `_package_rerun`)
- Test: `backend/tests/test_plant_run_stops.py`

**Interfaces:**
- Consumes: Task 11 (`_trace`, `_merge`, `_advance`, `build_check`, `_end`, `_base_spec`, `cloud_stage`).
- Produces: `orchestrator._package_rerun(rc) -> dict` (ruling R10).

- [ ] **Step 1: Write the failing tests**

```python
# backend/tests/test_plant_run_stops.py
"""How a plant run ends when it does not finish normally (spec §8.4; rulings R8, R10)."""

from dataclasses import asdict

from plant_fakes import KIPIC, FakePlantLlm, item, reply, seed_plant
from test_plant_run import finish_pkg, run_job

from app.asset_models import service, store
from app.asset_models.agent.plant import orchestrator as O
from app.asset_models.agent.plant import packages as pk
from app.asset_models.agent.plant.budget import PlantLimits
from app.asset_models.agent.plant.state import PlantState, save_state
from app.asset_models.agent.runner import INTERNAL
from app.asset_models.spec import AssetSpec
from app.project_agent.history import LlmError


def two_packages(ids):
    d0 = ids["drawings"][0]
    return {"packages": [{"label": "A", "drawing_id": d0, "area": "20"}, {"label": "B", "drawing_id": d0, "area": "30"}]}


def survey(ids):
    return [reply(("set_site", KIPIC)), reply(("plan_packages", two_packages(ids))), reply(("next_stage", {"summary": "2"}))]


def test_budget_out_still_builds(handle, app):
    ids = seed_plant(handle, app, limits=PlantLimits(max_tokens=1000, parallel=1))
    d0 = ids["drawings"][0]
    fake = FakePlantLlm(
        survey(ids),  # 3 x 150 = 450 tokens
        {"P1": [reply(("upsert_items", {"items": [item("t1", tag="T1", did=d0)]}), usage=(600, 0)), finish_pkg()], "P2": [finish_pkg()]},
    )
    _, result, run, _ = run_job(handle, app, ids, fake)
    assert run.state == "stopped" and run.stop_reason == "budget"
    assert "Not traced: P2 B" in run.summary
    assert len(fake.of("orchestrator")) == 3 and fake.of("P2") == []  # no environment/build calls, P2 never started
    with handle.session() as s:
        assert [r.state for r in pk.rows(s, ids["run"])] == ["done", "skipped"]
        v = store.get_version(s, ids["model"], result["version"])
        assert v.kind == "agent" and [i["id"] for i in v.spec["items"]] == ["t1"]


def test_the_clock_ends_the_run_as_a_timeout(handle, app):
    ids = seed_plant(handle, app, limits=PlantLimits(max_seconds=0))
    fake = FakePlantLlm(survey(ids))
    _, result, run, _ = run_job(handle, app, ids, fake)
    assert run.state == "stopped" and run.stop_reason == "timeout" and "during the survey" in run.summary
    assert result["version"] is None and fake.calls == []


def test_user_stop_writes_a_draft_with_in_flight_items(handle, app):
    ids = seed_plant(handle, app, limits=PlantLimits(parallel=1))
    holder = {}

    def stop_now():
        holder["ctx"].cancelled.set()
        return reply(("upsert_items", {"items": [item("t1", did=ids["drawings"][0])]}))

    fake = FakePlantLlm(survey(ids), {"P1": [stop_now]})
    app.state.jobs.agent_llm = fake
    from plant_fakes import make_ctx

    from app.asset_models.agent import runner as R
    from app.db.models import AssetModelRun

    ctx = make_ctx(handle, app, ids)
    holder["ctx"] = ctx
    try:
        R.run_asset_model(ctx)
        raise AssertionError("the cancel must propagate")
    except Exception as e:
        assert type(e).__name__ == "JobCancelled"
    with handle.session() as s:
        run = s.get(AssetModelRun, ids["run"])
        assert (run.state, run.stop_reason, run.summary) == ("stopped", "user", "Stopped by the operator.")
        v = store.get_version(s, ids["model"], run.version)
        assert v.kind == "draft" and [i["id"] for i in v.spec["items"]] == ["t1"]
        assert [r.state for r in pk.rows(s, ids["run"])] == ["skipped", "skipped"]


def test_a_provider_error_in_the_orchestrator_fails_with_a_draft(handle, app):
    ids = seed_plant(handle, app, limits=PlantLimits(parallel=1))
    d0 = ids["drawings"][0]
    fake = FakePlantLlm(
        [*survey(ids), LlmError("The provider could not complete this step. Try again.")],
        {"P1": [reply(("upsert_items", {"items": [item("t1", did=d0)]})), finish_pkg()], "P2": [finish_pkg()]},
    )
    _, result, run, _ = run_job(handle, app, ids, fake)
    assert run.state == "failed" and run.stop_reason == "provider_error" and "could not complete" in run.summary
    with handle.session() as s:
        assert store.get_version(s, ids["model"], result["version"]).kind == "draft"


def test_a_survey_without_packages_fails_without_a_version(handle, app):
    ids = seed_plant(handle, app)
    _, result, run, model = run_job(handle, app, ids, FakePlantLlm([reply(text="Hmm."), reply(text="Done.")]))
    assert run.state == "failed" and "planned no packages" in run.summary and result["version"] is None
    assert model.live_run_id is None


def test_an_internal_error_fails_with_fixed_text(handle, app, monkeypatch, caplog):
    ids = seed_plant(handle, app, limits=PlantLimits(parallel=1))

    def boom(*_a, **_k):
        raise ValueError("C:/secret/path")

    monkeypatch.setattr(O, "build_check", boom)
    fake = FakePlantLlm([*survey(ids), reply(("next_stage", {"summary": "env"}))], {"P1": [finish_pkg()], "P2": [finish_pkg()]})
    _, _, run, _ = run_job(handle, app, ids, fake)
    assert run.state == "failed" and run.summary == INTERNAL and "secret" not in caplog.text


def test_plant_package_reruns_chosen_packages_on_the_current_version(handle, app):
    ids = seed_plant(handle, app, mode="plant_package", limits=PlantLimits(parallel=1))
    d0 = ids["drawings"][0]
    base = AssetSpec.model_validate({
        "site": {"crs": {"epsg": 32639}, "origin_crs": KIPIC["origin_crs"], "plant_north_deg": KIPIC["plant_north_deg"], "datum": {"label": "HPFS", "el_m": 100.0}, "source": {"kind": "assumed"}},
        "items": [item("t1", tag="T1", did=d0), item("keep", e=500, did=d0)],
        "environment": [{"id": "sea", "kind": "sea", "pts": [[0, 0], [10, 0], [10, 10]], "el": 100.0, "source": {"kind": "assumed"}}],
    })
    service.add_version(handle, app.state.jobs, ids["model"], base, kind="agent")
    rd = store.run_dir(handle, ids["model"], ids["run"])
    with handle.session() as s:
        (row,) = pk.replace_queued(s, ids["run"], [{"label": "Tank area", "drawing_id": d0, "area": "20"}])
        row_id = row.id
    save_state(rd, PlantState(limits=asdict(PlantLimits(parallel=1)), base_version=1, package_ids=["old"],
                              packages_meta={row_id: {"brief": "Tanks", "expected_tags": ["T1"]}}))
    fake = FakePlantLlm(packages={"P1": [
        reply(("upsert_items", {"items": [item("t1-new", tag="T1", e=0.5, did=d0, conf="high"), item("new", e=200, did=d0)]})),
        finish_pkg(),
    ]})
    _, result, run, _ = run_job(handle, app, ids, fake)
    assert run.state == "finished" and result["version"] == 2 and fake.of("orchestrator") == []
    assert run.summary.startswith("Re-ran 1 package(s) on version 1")
    with handle.session() as s:
        v2 = store.get_version(s, ids["model"], 2)
    assert v2.kind == "agent" and {i["id"] for i in v2.spec["items"]} == {"t1-new", "keep", "new"}
    assert v2.spec["site"]["plant_north_deg"] == KIPIC["plant_north_deg"] and v2.spec["environment"][0]["id"] == "sea"
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `$PY -m pytest tests/test_plant_run_stops.py -v`
Expected: `test_plant_package_reruns_chosen_packages_on_the_current_version` FAILS: `NotImplementedError` makes the run fail with `INTERNAL`. The others should already PASS against Task 11's code. If any of them fails, fix the Task 11 flow until it passes; the test is the specification.

- [ ] **Step 3: Implement `_package_rerun`**

Replace the Task 11 placeholder body:

```python
def _package_rerun(rc: PlantRunContext) -> dict:
    """Ruling R10: re-trace the copied packages over the current version, with no orchestrator
    conversation. A re-run adds and updates items; it never deletes."""
    st = rc.state
    if st.stage == "survey":
        base = _base_spec(rc)
        st.site = base.site.model_dump(mode="json") if base.site is not None else None
        st.environment = [e.model_dump(mode="json") for e in base.environment]
        _advance(rc, "trace")
    _sample_m1_clouds(rc)
    if st.stage == "trace":
        _trace(rc)
        _advance(rc, "merge")
    if st.stage == "merge":
        _merge(rc)
        _advance(rc, "cloud_check")
    if st.stage == "cloud_check":
        cloud_stage(rc)
        _advance(rc, "build")
    build_check(rc)
    with rc.handle.session() as s:
        labels = [f"P{r.n} {r.label} ({r.state})" for r in pk.rows(s, rc.run_id)]
    summary = f"Re-ran {len(labels)} package(s) on version {st.base_version}: " + "; ".join(labels) + "."
    why = rc.budget.exhausted()
    if why:
        return _end(rc, "stopped", "budget" if why == "tokens" else "timeout", summary, [], kind="agent")
    return _end(rc, "finished", None, summary, [], kind="agent")
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `$PY -m pytest tests/test_plant_run_stops.py tests/test_plant_run.py -v`
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add backend/app/asset_models/agent/plant/orchestrator.py backend/tests/test_plant_run_stops.py
git commit -m "feat(plant-run): budget-out still builds; stop drafts; plant_package re-runs" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 13: Resume after a restart (Review Focus #2)

**Files:**
- Create: `backend/app/asset_models/agent/plant/resume.py`
- Modify: `backend/app/asset_models/startup.py` (`_sweep_runs`)
- Test: `backend/tests/test_plant_resume.py`

**Interfaces:**
- Consumes: Task 3 state and packages; Task 4 `merge_items`; M1 `RUN_JOB`, `service.add_version`, `service.refresh_status`; the job runner's `is_live` and `submit`.
- Produces:
  - `resume.sweep_plant_runs(handle, runner) -> list[str]` (the run ids resumed);
  - `resume.INTERRUPTED_TWICE`, `resume.MAX_RUN_INTERRUPTS = 3`;
  - M1's sweep skips plant modes.

The rules:
- **A resumed run is a new `asset_model_run` job on the same run row.** `run.job_id` is updated, and the model keeps its `live_run_id`.
- **Package rows still `running` were cut off:**
  - a row whose items file already exists finished before its row was written, so it becomes `done`;
  - a row cut off for the first time goes back to `queued`;
  - a row cut off for the second time becomes `failed` with `INTERRUPTED_TWICE`.
- **`done` packages are never re-run,** so they are never re-billed.
- **More than 3 run interrupts:** the run fails with a draft built from its finished packages (ruling R17).

- [ ] **Step 1: Write the failing tests**

```python
# backend/tests/test_plant_resume.py
"""A plant run cut off by an application restart resumes after its last finished package (spec §8.4;
index Review Focus #3)."""

from dataclasses import asdict

import pytest
from plant_fakes import KIPIC, FakePlantLlm, item, reply, seed_plant

from app.asset_models import startup, store
from app.asset_models.agent.plant import packages as pk
from app.asset_models.agent.plant import resume
from app.asset_models.agent.plant.budget import PlantLimits
from app.asset_models.agent.plant.state import PlantState, load_state, save_package_items, save_state
from app.asset_models.spec import Item, SiteFrame
from app.db.models import AssetModel, AssetModelRun

FRAME = SiteFrame.model_validate(
    {"crs": {"epsg": 32639}, "origin_crs": KIPIC["origin_crs"], "plant_north_deg": KIPIC["plant_north_deg"], "source": {"kind": "assumed"}}
)


@pytest.fixture
def cut_off(handle, app):
    """A run that finished P1, was cut off while P2 ran, and never started P3."""
    ids = seed_plant(handle, app, limits=PlantLimits(parallel=1))
    d0 = ids["drawings"][0]
    rd = store.run_dir(handle, ids["model"], ids["run"])
    with handle.session() as s:
        rows = pk.replace_queued(s, ids["run"], [{"label": n, "drawing_id": d0} for n in ("A", "B", "C")])
        pk.set_state(s, rows[0].id, "done", usage={"input_tokens": 10, "output_tokens": 5}, item_count=1, summary="ok")
        pk.set_state(s, rows[1].id, "running")
        pids = [r.id for r in rows]
    save_package_items(rd, 1, [Item.model_validate(item("t1", tag="T1", did=d0))])
    save_state(rd, PlantState(stage="trace", site=FRAME.model_dump(mode="json"), limits=asdict(PlantLimits(parallel=1)),
                              packages_meta={p: {"brief": "b", "expected_tags": []} for p in pids}))
    return ids, pids, rd


def after_trace_script():
    return [reply(("next_stage", {"summary": "No environment."})), reply(("finish", {"summary": "Resumed and built."}))]


def wait_run(client, project_id, wait_job, handle, run_id):
    with handle.session() as s:
        job_id = s.get(AssetModelRun, run_id).job_id
    assert job_id != "job-run"
    assert wait_job(project_id, job_id)["state"] == "succeeded"
    with handle.session() as s:
        run = s.get(AssetModelRun, run_id)
        s.expunge(run)
        return run


def test_resume_skips_done_packages(client, project_id, wait_job, handle, app, cut_off):
    ids, pids, _ = cut_off
    d0 = ids["drawings"][0]
    fake = FakePlantLlm(after_trace_script(), {
        "P2": [reply(("upsert_items", {"items": [item("b1", e=100, did=d0)]})), reply(("finish_package", {"summary": "B"}))],
        "P3": [reply(("upsert_items", {"items": [item("c1", e=200, did=d0)]})), reply(("finish_package", {"summary": "C"}))],
    })
    app.state.jobs.agent_llm = fake
    assert resume.sweep_plant_runs(handle, app.state.jobs) == [ids["run"]]
    with handle.session() as s:
        assert [r.state for r in pk.rows(s, ids["run"])] == ["done", "queued", "queued"]
    run = wait_run(client, project_id, wait_job, handle, ids["run"])
    assert run.state == "finished" and run.summary == "Resumed and built."
    assert fake.of("P1") == []  # the done package is never re-billed
    assert "This run was interrupted" in fake.of("orchestrator")[0]["user_texts"][0]
    with handle.session() as s:
        v = store.get_version(s, ids["model"], run.version)
        assert sorted(i["id"] for i in v.spec["items"]) == ["b1", "c1", "t1"]  # t1 once, no duplicates
        assert [r.state for r in pk.rows(s, ids["run"])] == ["done", "done", "done"]
        assert s.get(AssetModel, ids["model"]).live_run_id is None


def test_double_interrupt_fails_package(client, project_id, wait_job, handle, app, cut_off):
    ids, pids, rd = cut_off
    st = load_state(rd)
    st.interrupts = {pids[1]: 1}  # P2 was already cut off once before
    save_state(rd, st)
    fake = FakePlantLlm(after_trace_script(), {"P3": [reply(("finish_package", {"summary": "C"}))]})
    app.state.jobs.agent_llm = fake
    assert resume.sweep_plant_runs(handle, app.state.jobs) == [ids["run"]]
    with handle.session() as s:
        b = pk.rows(s, ids["run"])[1]
        assert b.state == "failed" and b.summary == resume.INTERRUPTED_TWICE
    run = wait_run(client, project_id, wait_job, handle, ids["run"])
    assert run.state == "finished" and fake.of("P2") == []
    assert load_state(rd).interrupts[pids[1]] == 2


def test_a_package_saved_before_its_row_counts_as_done(client, project_id, wait_job, handle, app, cut_off):
    ids, _, rd = cut_off
    save_package_items(rd, 2, [Item.model_validate(item("b1", e=100))])
    fake = FakePlantLlm(after_trace_script(), {"P3": [reply(("finish_package", {"summary": "C"}))]})
    app.state.jobs.agent_llm = fake
    resume.sweep_plant_runs(handle, app.state.jobs)
    with handle.session() as s:
        assert [r.state for r in pk.rows(s, ids["run"])] == ["done", "done", "queued"]
    wait_run(client, project_id, wait_job, handle, ids["run"])
    assert fake.of("P2") == []


def test_too_many_interrupts_fail_the_run_with_a_draft(handle, app, cut_off):
    ids, _, rd = cut_off
    st = load_state(rd)
    st.run_interrupts = resume.MAX_RUN_INTERRUPTS
    save_state(rd, st)
    assert resume.sweep_plant_runs(handle, app.state.jobs) == []
    with handle.session() as s:
        run = s.get(AssetModelRun, ids["run"])
        assert run.state == "failed" and run.stop_reason == "interrupted" and run.job_id == "job-run"
        v = store.get_version(s, ids["model"], run.version)
        assert v.kind == "draft" and [i["id"] for i in v.spec["items"]] == ["t1"]
        assert s.get(AssetModel, ids["model"]).live_run_id is None


def test_a_corrupt_state_file_fails_the_run_without_stopping_the_app(handle, app, cut_off):
    ids, _, rd = cut_off
    (rd / "plant" / "state.json").write_text("{not json", "utf-8")
    assert resume.sweep_plant_runs(handle, app.state.jobs) == []
    with handle.session() as s:
        assert s.get(AssetModelRun, ids["run"]).state == "failed"


def test_the_startup_sweep_resumes_plant_runs_and_fails_m1_runs(client, project_id, wait_job, handle, app, cut_off):
    ids, _, _ = cut_off
    app.state.jobs.agent_llm = FakePlantLlm(after_trace_script(), {"P2": [reply(("finish_package", {"summary": "B"}))], "P3": [reply(("finish_package", {"summary": "C"}))]})
    startup.sweep_interrupted(handle, app.state.jobs)
    run = wait_run(client, project_id, wait_job, handle, ids["run"])
    assert run.state == "finished" and run.stop_reason is None
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `$PY -m pytest tests/test_plant_resume.py -v`
Expected: FAIL with `ModuleNotFoundError` for `...plant.resume`.

- [ ] **Step 3: Implement `resume.py`**

```python
# backend/app/asset_models/agent/plant/resume.py
"""Resume plant runs cut off by an application restart (spec §8.4; index Review Focus #3). Called by
`app.asset_models.startup._sweep_runs` on project open. Nothing here may stop the app opening."""

from __future__ import annotations

import logging
from datetime import UTC, datetime

from sqlalchemy import select

from app.asset_models import service, store
from app.asset_models.agent.plant import PLANT_MODES
from app.asset_models.agent.plant import packages as pk
from app.asset_models.agent.plant.merge import merge_items
from app.asset_models.agent.plant.state import (
    PlantState,
    env_of,
    load_merged,
    load_package_items,
    load_state,
    save_state,
    site_of,
)
from app.asset_models.spec import AssetSpec
from app.db.models import AssetModel, AssetModelRun

log = logging.getLogger(__name__)
INTERRUPTED_TWICE = "Interrupted twice while running, so it was not run again."
MAX_RUN_INTERRUPTS = 3
GAVE_UP = "The run was interrupted by application restarts too many times; its finished packages were kept as a draft."
CUT_OFF = "interrupted by application restart"


def sweep_plant_runs(handle, runner) -> list[str]:
    with handle.session() as s:
        cut = [
            (r.model_id, r.id)
            for r in s.scalars(
                select(AssetModelRun).where(AssetModelRun.state == "running", AssetModelRun.mode.in_(PLANT_MODES))
            )
            if not runner.is_live(r.job_id)
        ]
    resumed = []
    for model_id, run_id in cut:
        try:
            if _resume(handle, runner, model_id, run_id):
                resumed.append(run_id)
        except Exception as e:  # noqa: BLE001 - a bad run must never stop the app opening
            log.error("plant run could not resume (%s)", type(e).__name__)
            try:
                _give_up(handle, runner, model_id, run_id, CUT_OFF)
            except Exception as e2:  # noqa: BLE001
                log.error("plant run could not be closed (%s)", type(e2).__name__)
    return resumed


def _resume(handle, runner, model_id: str, run_id: str) -> bool:
    from app.asset_models.agent.runner import RUN_JOB

    rd = store.run_dir(handle, model_id, run_id)
    st = load_state(rd)
    st.run_interrupts += 1
    with handle.session() as s:
        for row in pk.rows(s, run_id):
            if row.state != "running":
                continue
            if load_package_items(rd, row.n) is not None:  # saved, but the row was never updated
                pk.set_state(s, row.id, "done")
                continue
            k = st.interrupts.get(row.id, 0) + 1
            st.interrupts[row.id] = k
            if k >= 2:
                pk.set_state(s, row.id, "failed", summary=INTERRUPTED_TWICE)
            else:
                pk.set_state(s, row.id, "queued")
    save_state(rd, st)
    if st.run_interrupts > MAX_RUN_INTERRUPTS:
        _give_up(handle, runner, model_id, run_id, GAVE_UP, st)
        return False
    job = runner.submit(handle, RUN_JOB, {"model_id": model_id, "run_id": run_id, "resume": True})
    with handle.session() as s:
        s.get(AssetModelRun, run_id).job_id = job.id
    log.info("plant run resumed (interrupt %d)", st.run_interrupts)
    return True


def _give_up(handle, runner, model_id: str, run_id: str, summary: str, st: PlantState | None = None) -> None:
    rd = store.run_dir(handle, model_id, run_id)
    if st is None:
        try:
            st = load_state(rd)
        except Exception:  # noqa: BLE001 - a corrupt state file: close the run without a draft
            st = None
    with handle.session() as s:
        finished = [r.n for r in pk.rows(s, run_id) if r.state in ("done", "failed")]
        pk.mark_unfinished(s, run_id, "skipped", "Not finished: the run was interrupted.")
        run = s.get(AssetModelRun, run_id)
        run.state, run.stop_reason, run.summary = "failed", "interrupted", summary
        run.phase, run.ended_at = "done", datetime.now(UTC)
        model = s.get(AssetModel, model_id)
        if model is not None and model.live_run_id == run_id:
            model.live_run_id = None
            service.refresh_status(model)
    if st is None:
        return
    items = load_merged(rd)
    if items is None:
        lists = [x for x in (load_package_items(rd, n) for n in finished) if x]
        items = merge_items(lists, [f"P{n}" for n in finished][: len(lists)])
    if not items:
        return
    spec = AssetSpec(site=site_of(st), items=items, environment=env_of(st))
    row, _job = service.add_version(handle, runner, model_id, spec, kind="draft", note=summary, run_id=run_id)
    with handle.session() as s:
        s.get(AssetModelRun, run_id).version = row.version
```

- [ ] **Step 4: Hook it into the startup sweep**

In `backend/app/asset_models/startup.py`, add the import `from app.asset_models.agent.plant import PLANT_MODES`. Change `_sweep_runs` so its first lines are:

```python
def _sweep_runs(handle, runner) -> None:
    """A run still `running` whose job is gone was cut off. Plant runs resume (spec 2026-10-03 §8.4);
    M1 runs fail, unstick their model, and keep what the agent had built as a draft. Nothing here may
    stop the app from opening."""
    try:
        from app.asset_models.agent.plant.resume import sweep_plant_runs

        sweep_plant_runs(handle, runner)
    except Exception as e:  # noqa: BLE001
        log.error("plant run resume sweep failed (%s)", type(e).__name__)
    interrupted = []
    with handle.session() as s:
        for run in s.scalars(select(AssetModelRun).where(AssetModelRun.state == "running")):
            if run.mode in PLANT_MODES or runner.is_live(run.job_id):
                continue
            # ... the M1 body continues unchanged ...
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `$PY -m pytest tests/test_plant_resume.py tests/test_asset_model_run_job.py -v`
Expected: all pass.

- [ ] **Step 6: Commit**

```bash
git add backend/app/asset_models/agent/plant/resume.py backend/app/asset_models/startup.py backend/tests/test_plant_resume.py
git commit -m "feat(plant-run): resume after restart; done packages never re-run; second interrupt fails a package" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 14: Runs API extensions

**Files:**
- Modify: `backend/app/asset_models/schemas.py`
- Modify: `backend/app/asset_models/runs.py`
- Modify: `backend/app/asset_models/stubs_plant.py` (delete the `listAssetModelRunPackages` stub line)
- Test: `backend/tests/test_plant_runs_api.py`

**Interfaces:**
- Consumes:
  - F0 contract: `AssetModelRunStart.mode/package_ids/limits`, `AssetModelRun.packages/usage_by_stage`, `SiteModelPackage`, `SiteModelPackageList`, `listAssetModelRunPackages`;
  - Task 2 `resolve_limits`, `estimate_cost_usd`, `COST_LABEL`;
  - Task 3 `PlantState`, `save_state`, `load_state`, `packages.*`.
- Produces:
  - `POST …/runs` accepts `mode: plant | plant_package`, `package_ids`, `limits`;
  - `GET …/runs[/{runId}]` returns `packages` and `usage_by_stage` for plant runs (null otherwise) and a `usage` of exactly `{input_tokens, output_tokens}`;
  - `GET …/runs/{runId}/packages` (`listAssetModelRunPackages`).
- Error codes:
  - `validation_error` (422): package fields on M1 modes; no packages chosen; unknown package;
  - `no_sources` (422): a plant run without a drawing;
  - `nothing_to_refine` (422): `plant_package` without a version.

- [ ] **Step 1: Write the failing tests**

```python
# backend/tests/test_plant_runs_api.py
"""Plant runs over HTTP (spec §10; index contract additions)."""

import pytest
from plant_fakes import KIPIC, FakePlantLlm, item, reply

from app.asset_models import store
from app.asset_models.agent.plant.state import load_state


@pytest.fixture
def model_url(client, project_id):
    m = client.post(f"/api/v1/projects/{project_id}/asset-models", json={"name": "Plant"}).json()
    return f"/api/v1/projects/{project_id}/asset-models/{m['id']}"


@pytest.fixture
def drawing_id(client, project_id, wait_job, tmp_path):
    from drawings_helpers import build_drawing, inspect_ready
    from look_helpers import vector_pdf

    inspection = inspect_ready(client, project_id, wait_job, vector_pdf(tmp_path / "v.pdf"))
    return build_drawing(client, project_id, wait_job, inspection["id"])["id"]


def plant_script(did):
    orchestrator = [
        reply(("set_site", KIPIC)),
        reply(("plan_packages", {"packages": [{"label": "Tanks", "drawing_id": did, "area": "20", "brief": "b"}]})),
        reply(("next_stage", {"summary": "1"})),
        reply(("next_stage", {"summary": "no environment"})),
        reply(("finish", {"summary": "done"})),
    ]
    return FakePlantLlm(orchestrator, {"P1": [reply(("upsert_items", {"items": [item("t1", tag="T1", did=did)]})), reply(("finish_package", {"summary": "ok"}))]})


def start(client, model_url, did, **body):
    body = {"mode": "plant", "provider": "anthropic", "model_name": "claude-opus-5-5", "sources": [{"type": "drawing", "id": did}], **body}
    return client.post(f"{model_url}/runs", json=body)


def test_a_plant_run_over_http(client, app, project_id, model_url, drawing_id, wait_job, handle):
    app.state.keys.set("anthropic", "k")
    app.state.jobs.agent_llm = plant_script(drawing_id)
    r = start(client, model_url, drawing_id, limits={"parallel": 2})
    assert r.status_code == 202, r.text
    run = r.json()["run"]
    assert run["mode"] == "plant"
    wait_job(project_id, r.json()["job"]["id"])
    done = client.get(f"{model_url}/runs/{run['id']}").json()
    assert done["state"] == "finished" and done["version"] == 1
    assert done["packages"] == {"total": 1, "done": 1, "failed": 0, "running": 0}
    assert set(done["usage"]) == {"input_tokens", "output_tokens"}
    ubs = done["usage_by_stage"]
    assert ubs["current"] == "done" and "survey" in ubs["stages"] and "estimate" in ubs["cost_label"].lower()
    assert isinstance(ubs["cost_estimate_usd"], float)
    pkgs = client.get(f"{model_url}/runs/{run['id']}/packages").json()["items"]
    assert [(p["n"], p["label"], p["state"], p["item_count"]) for p in pkgs] == [(1, "Tanks", "done", 1)]
    model_id = model_url.rsplit("/", 1)[1]
    assert load_state(store.run_dir(handle, model_id, run["id"])).limits["parallel"] == 2
    from app.db.models import AssetModel

    with handle.session() as s:
        assert s.get(AssetModel, model_id).kind == "plant"


def test_refusals(client, app, model_url, drawing_id):
    app.state.keys.set("anthropic", "k")
    r = client.post(f"{model_url}/runs", json={"mode": "build", "provider": "anthropic", "sources": [{"type": "drawing", "id": drawing_id}], "limits": {"parallel": 2}})
    assert r.status_code == 422 and r.json()["error"]["code"] == "validation_error"
    r = start(client, model_url, drawing_id, mode="plant_package", package_ids=["x"])
    assert r.status_code == 422 and r.json()["error"]["code"] == "nothing_to_refine"


def test_plant_package_reruns_a_package(client, app, project_id, model_url, drawing_id, wait_job):
    app.state.keys.set("anthropic", "k")
    app.state.jobs.agent_llm = plant_script(drawing_id)
    first = start(client, model_url, drawing_id)
    wait_job(project_id, first.json()["job"]["id"])
    run_id = first.json()["run"]["id"]
    pid = client.get(f"{model_url}/runs/{run_id}/packages").json()["items"][0]["id"]
    bad = start(client, model_url, drawing_id, mode="plant_package", package_ids=["nope"])
    assert bad.status_code == 422 and bad.json()["error"]["code"] == "validation_error"
    app.state.jobs.agent_llm = FakePlantLlm(packages={"P1": [reply(("upsert_items", {"items": [item("t2", tag="T2", e=40, did=drawing_id)]})), reply(("finish_package", {"summary": "ok"}))]})
    again = start(client, model_url, drawing_id, mode="plant_package", package_ids=[pid])
    assert again.status_code == 202, again.text
    wait_job(project_id, again.json()["job"]["id"])
    out = client.get(f"{model_url}/runs/{again.json()['run']['id']}").json()
    assert out["state"] == "finished" and out["version"] == 2
    pk2 = client.get(f"{model_url}/runs/{out['id']}/packages").json()["items"]
    assert [(p["label"], p["state"]) for p in pk2] == [("Tanks", "done")]


def test_packages_of_another_models_run_are_404(client, model_url, project_id):
    other = client.post(f"/api/v1/projects/{project_id}/asset-models", json={"name": "Other"}).json()
    r = client.get(f"/api/v1/projects/{project_id}/asset-models/{other['id']}/runs/nope/packages")
    assert r.status_code == 404


def test_m1_runs_have_no_plant_fields(client, app, project_id, model_url, drawing_id, wait_job):
    app.state.keys.set("anthropic", "k")

    async def llm(provider, **kw):
        from app.project_agent.history import ModelReply

        return ModelReply("Done.", [], usage={"input_tokens": 1, "output_tokens": 1})

    app.state.jobs.agent_llm = llm
    r = client.post(f"{model_url}/runs", json={"mode": "build", "provider": "anthropic", "sources": [{"type": "drawing", "id": drawing_id}]})
    wait_job(project_id, r.json()["job"]["id"])
    out = client.get(f"{model_url}/runs/{r.json()['run']['id']}").json()
    assert out["packages"] is None and out["usage_by_stage"] is None
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `$PY -m pytest tests/test_plant_runs_api.py -v`
Expected: FAIL. `mode: "plant"` is a 422 from `AssetModelRunStart`, unless F0 already widened it; the packages route answers 501 from the stub.

- [ ] **Step 3: Schemas**

In `backend/app/asset_models/schemas.py`, add only what F0 did not (Task 1 Step 1 recorded which). Field names and bounds must match F0's `openapi.yaml`; where they differ, F0's contract wins.

```python
RunMode = Literal["build", "refine", "plant", "plant_package"]


class PlantLimitsIn(BaseModel):
    model_config = ConfigDict(extra="forbid")
    max_tokens: int | None = Field(None, ge=100_000, le=200_000_000)
    max_images: int | None = Field(None, ge=0, le=2_000)
    max_seconds: int | None = Field(None, ge=60, le=43_200)
    parallel: int | None = Field(None, ge=1, le=8)


class RunPackagesOut(BaseModel):
    total: int
    done: int
    failed: int
    running: int


class SiteModelPackageOut(BaseModel):
    id: str
    run_id: str
    n: int
    label: str
    drawing_id: str | None
    region: list[float] | None
    area: str | None
    state: Literal["queued", "running", "done", "failed", "skipped"]
    usage: dict
    item_count: int
    summary: str | None
    started_at: datetime | None
    ended_at: datetime | None

    @classmethod
    def of(cls, row) -> SiteModelPackageOut:
        return cls.model_validate(row, from_attributes=True)


class SiteModelPackageList(BaseModel):
    items: list[SiteModelPackageOut]
```

In `AssetModelRunOut`:
- change `mode` to `mode: RunMode`;
- add `packages: RunPackagesOut | None = None` and `usage_by_stage: dict | None = None`;
- replace `of`:

```python
    @classmethod
    def of(cls, row, s=None) -> AssetModelRunOut:
        out = cls.model_validate(row, from_attributes=True)
        u = dict(row.usage or {})
        out.usage = {"input_tokens": int(u.get("input_tokens", 0)), "output_tokens": int(u.get("output_tokens", 0))}
        if row.mode in ("plant", "plant_package"):
            from app.asset_models.agent.plant import packages as plant_packages
            from app.asset_models.agent.plant.budget import COST_LABEL, estimate_cost_usd

            if s is not None:
                out.packages = RunPackagesOut(**plant_packages.summary(s, row.id))
            if u.get("by_stage"):
                out.usage_by_stage = {
                    "current": u.get("current"),
                    "stages": u["by_stage"],
                    "cost_estimate_usd": estimate_cost_usd(row.model_name, u),
                    "cost_label": COST_LABEL,
                }
        return out
```

In `AssetModelRunStart`:
- change `mode` to `mode: RunMode`;
- add `package_ids: list[Annotated[str, Field(max_length=36)]] | None = Field(None, min_length=1, max_length=64)` and `limits: PlantLimitsIn | None = None`.

Add `from typing import Annotated` if it is missing.

- [ ] **Step 4: Routes**

In `backend/app/asset_models/runs.py`, add these imports:

```python
from dataclasses import asdict

from app.asset_models.agent.plant import PLANT_MODES
from app.asset_models.agent.plant import packages as plant_packages
from app.asset_models.agent.plant.budget import resolve_limits
from app.asset_models.agent.plant.state import PlantState, load_state, save_state
from app.asset_models.schemas import SiteModelPackageList, SiteModelPackageOut
```

In `start_asset_model_run`, after the existing `nothing_to_refine` check, add:

```python
        if body.mode not in PLANT_MODES and (body.package_ids or body.limits):
            raise AppError("validation_error", "package_ids and limits are for plant runs.", 422)
        if body.mode == "plant" and not any(x.type == "drawing" for x in body.sources):
            raise AppError("no_sources", "A plant run needs at least one drawing.", 422)
        old_packages = []
        if body.mode == "plant_package":
            if not model.current_version:
                raise AppError("nothing_to_refine", "This model has no version to re-run packages on yet.", 422)
            if not body.package_ids:
                raise AppError("validation_error", "Choose the packages to re-run.", 422)
            old_packages = plant_packages.find_for_model(s, assetModelId, body.package_ids)
            if len(old_packages) != len(set(body.package_ids)):
                raise AppError("validation_error", "A chosen package is not part of this model's runs.", 422)
```

After `run_id = run.id` and `model.live_run_id = run_id`, add:

```python
        if body.mode in PLANT_MODES:
            model.kind = "plant"
            _plant_setup(request, handle, s, model, run_id, body, old_packages)
```

Add the helper and the packages route:

```python
def _plant_setup(request, handle, s, model, run_id: str, body, old) -> None:
    """The run's limits (settings.json defaults, then the body's) and, for a re-run, the copied packages
    and their briefs, written to the run's state file before the job starts."""
    appdata = getattr(getattr(request.app.state, "provider_config", None), "appdata", None)
    limits = resolve_limits(appdata, body.limits.model_dump(exclude_none=True) if body.limits else None)
    st = PlantState(
        limits=asdict(limits),
        package_ids=list(body.package_ids or []),
        base_version=model.current_version if body.mode == "plant_package" else None,
    )
    if old:
        rows = plant_packages.copy_for_rerun(s, run_id, old)
        for new, prev in zip(rows, old, strict=True):
            try:
                meta = load_state(store.run_dir(handle, model.id, prev.run_id)).packages_meta.get(prev.id, {})
            except Exception:  # noqa: BLE001 - an unreadable old state file only loses the brief
                meta = {}
            st.packages_meta[new.id] = {
                "brief": meta.get("brief") or prev.label,
                "expected_tags": list(meta.get("expected_tags") or []),
            }
    save_state(store.run_dir(handle, model.id, run_id), st)


@router.get(R + "/{runId}/packages", response_model=SiteModelPackageList)
def list_asset_model_run_packages(
    assetModelId: str,  # noqa: N803
    runId: str,  # noqa: N803
    handle: ProjectHandle = Depends(get_project),
):
    with handle.session() as s:
        _run_row(s, assetModelId, runId)
        return SiteModelPackageList(items=[SiteModelPackageOut.of(r) for r in plant_packages.rows(s, runId)])
```

Pass the session to every `AssetModelRunOut.of(...)` in `runs.py`:
- `AssetModelRunOut.of(run, s)` in start and stop;
- `[AssetModelRunOut.of(r, s) for r in rows]` in list;
- `AssetModelRunOut.of(_run_row(s, assetModelId, runId), s)` in get.

Delete the `listAssetModelRunPackages` line from `backend/app/asset_models/stubs_plant.py`.

- [ ] **Step 5: Run the tests to verify they pass**

Run: `$PY -m pytest tests/test_plant_runs_api.py tests/test_asset_model_runs_api.py tests/test_contract.py -v`
Expected: all pass. `test_contract.py` now reaches the real packages route instead of the stub.

- [ ] **Step 6: Commit**

```bash
git add backend/app/asset_models/schemas.py backend/app/asset_models/runs.py backend/app/asset_models/stubs_plant.py backend/tests/test_plant_runs_api.py
git commit -m "feat(plant-run): runs API: plant modes, limits, package re-runs, packages route, usage by stage" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 15: Align with merged I1 (`list_sources` grouping)

`WAITING: I1` until I1 is on `main`. Then: `git fetch` (local), `git merge main` into `task/pm-r1`, and run `$PY -m pytest tests/test_plant_*.py -q` before continuing.

**Files:**
- Read: I1's change to `backend/app/asset_models/agent/tools.py` (`ListSources`) and `agent/runner.py` (`_describe_sources`), and any grouping helper I1 added.
- Modify: `backend/app/asset_models/agent/plant/prompt_plant.py` (`first_message`)
- Test: `backend/tests/test_plant_sources_i1.py`

**Interfaces:**
- Consumes: I1's `group_drawing_sources(sources)` in `app/asset_models/agent/tools.py`, plus the `file`/`sha256`/`page` keys on `_describe_sources` drawing entries. `list_sources` prints one `drawing file {...}` line per source file.
- Produces: `first_message` lists drawing **files** with their page ids (one line per file) instead of one line per page. Al-Zour's five PDFs are about 30 pages, so the orchestrator's opening stays short.

- [ ] **Step 1: Write the test**

Keep the intent of each assertion: each file named once, every page id listed. Adapt only the literal file text to I1's real format.

```python
# backend/tests/test_plant_sources_i1.py
"""The plant run sees drawing pages grouped by source file (I1; spec §8.1)."""

from plant_fakes import make_rc, seed_plant

from app.asset_models.agent.plant import prompt_plant as P
from app.asset_models.agent.plant import tools_plant as T
from app.asset_models.agent.plant.context import Scope


def test_list_sources_groups_pages_by_file(handle, app):
    ids = seed_plant(handle, app, pages=3)
    rc = make_rc(handle, app, ids)
    out = T.run_plant_tool(rc, Scope(name="orchestrator", stage="survey", items=rc.store), "list_sources", {})
    assert out.ok and all(d in out.text for d in ids["drawings"])
    assert out.text.count("plot.pdf") == 1


def test_the_opening_lists_files_not_pages(handle, app):
    ids = seed_plant(handle, app, pages=3)
    rc = make_rc(handle, app, ids)
    first = P.first_message(rc)
    assert first.count("plot.pdf") == 1 and all(d in first for d in ids["drawings"])
    assert "C:/plans" not in first  # file name only, never the path
```

- [ ] **Step 2: Run it**

Run: `$PY -m pytest tests/test_plant_sources_i1.py -v`
Expected: `test_list_sources_groups_pages_by_file` PASSES (I1's change). `test_the_opening_lists_files_not_pages` FAILS: `first_message` still prints one line per page and no file name.

- [ ] **Step 3: Use I1's grouping in `first_message`**

I1's plan (`2026-10-03-plant-model-i1.md`, Task 6) adds two things:
- `group_drawing_sources(sources) -> [{file, facts, pages: [{id, page, label}]}]` in `app/asset_models/agent/tools.py`;
- the `file`, `sha256` and `page` keys on `_describe_sources` drawing entries.

`rc.sources` are those described sources. In `prompt_plant.py`, add:

```python
def _source_lines(rc) -> list[str]:
    from app.asset_models.agent.tools import group_drawing_sources  # I1

    lines = [
        f"- drawing file {g['file']}: " + ", ".join(f"p{p['page'] or 1} {p['id']}" for p in g["pages"])
        for g in group_drawing_sources(rc.sources)
    ]
    lines += [
        f"- {s['type']} {s['id']}: {s.get('label', '')} ({s.get('facts', '')})"
        for s in rc.sources
        if s["type"] != "drawing"
    ]
    return lines
```

In `first_message`, replace the per-source list comprehension and the "and N more" lines with:

```python
    src = _source_lines(rc)
    lines += src[:60] + ([f"- and {len(src) - 60} more"] if len(src) > 60 else [])
```

If I1 merged under another name, use I1's real one and record it in the ledger.

- [ ] **Step 4: Run the plant tests**

Run: `$PY -m pytest tests/test_plant_sources_i1.py tests/test_plant_prompt.py tests/test_plant_run.py -v`
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add backend/app/asset_models/agent/plant/prompt_plant.py backend/tests/test_plant_sources_i1.py
git commit -m "feat(plant-run): the orchestrator sees drawing pages grouped by file (I1)" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 16: Align with merged C1 (cloud check stage, `cloud_check` tool, review)

`WAITING: C1` until C1 is on `main`. Then `git merge main` into `task/pm-r1`.

**C1's binding names** (from the coordinator, 2026-10-03), in `app/asset_models/cloudcheck.py`:
- `sample_plant_cloud(handle, cloud_id, bbox_site, *, max_points, cancel, progress) -> PlantSample`. `cancel` returning true raises `JobCancelled`.
- `fit_datum(sample, grid, items)`, `check_items(sample, grid, items, datum) -> CheckResult`, `apply_check(items, result)`.
- `cloud_in_frame(handle, cloud_id, grid) -> (ok, note)`. Call it **before** sampling and skip with the note when it is not ok.
- `plant_bbox_site(grid, items, margin)`; `summarise(result) -> str`.
- `PlantSample` stores x/y relative to an `origin` field and has save/load. Cache the sample per run under the run's folder.
- `CheckResult.note` carries the skip text (another CRS, no CRS, no datum). Show it as a run note.

**Files:**
- Read: `backend/app/asset_models/cloudcheck.py` (C1): the exact `PlantSample.save/load` signatures; the `ItemCheck`, `Candidate` and `CheckResult` fields; and whether `Candidate.pts` are plant `[E, N]` or site `X/Y`.
- Modify: `backend/app/asset_models/agent/plant/cloud.py` (replace the Task 11 body)
- Modify: `backend/app/asset_models/agent/plant/state.py` (add `check_summary: str | None = None` to `PlantState`)
- Modify: `backend/app/asset_models/agent/plant/prompt_plant.py` (`review_message` shows `check_summary`)
- Modify: `backend/app/asset_models/agent/plant/tools_plant.py` (add `CloudCheck`)
- Test: `backend/tests/test_plant_cloud_c1.py`

**Interfaces:**
- Consumes: C1 `cloud_in_frame`, `plant_bbox_site`, `sample_plant_cloud`, `PlantSample.save/load`, `fit_datum`, `check_items`, `apply_check`, `summarise`, `CheckResult.note`.
- Produces:
  - `cloud.cloud_stage(rc)`. It sets:
    - `rc.cloud` and `rc.check`;
    - `rc.state.candidates`: a list of `{id, e, n, size_m, top_el}` in plant metres, largest first, ≤ 200;
    - `rc.state.check_summary` (C1's `summarise`);
    - `site.cloud_z_to_el`.

    When C1 skips the cloud it adds a run note instead.
  - the `cloud_check` tool (orchestrator only; used in the review and build stages).

- [ ] **Step 1: Write the failing tests**

The C1 functions are replaced by fakes, so this tests R1's wiring. C1's own tests own its maths, including `test_check_skips_cloud_in_other_crs`. The fakes return plain namespaces with C1's field names, so the test does not depend on C1's constructors.

```python
# backend/tests/test_plant_cloud_c1.py
"""The cloud check stage and tool (spec §8.2.4, §8.3; D5) wired to C1's module."""

from types import SimpleNamespace as NS

from plant_fakes import KIPIC, FakePlantLlm, item, make_rc, reply, seed_plant
from test_plant_run import finish_pkg, run_job

from app.asset_models import cloudcheck as cc
from app.asset_models import store
from app.asset_models.agent.plant import tools_plant as T
from app.asset_models.agent.plant.budget import PlantLimits
from app.asset_models.agent.plant.context import Scope
from app.asset_models.spec import CloudDatum

OTHER_CRS = "The point cloud is in another coordinate system, so it was not used."


def fake_c1(monkeypatch, *, in_frame=(True, ""), note=None):
    seen = {"sampled": 0, "saved": []}

    def sample(handle, cloud_id, bbox_site, *, max_points=20_000_000, cancel=None, progress=None):
        assert cancel() is False  # the recipe: cancel=lambda: rc.check_cancelled() or False
        seen["sampled"] += 1
        seen["bbox"] = bbox_site
        return NS(save=lambda path: seen["saved"].append(path))

    def check(sample_, grid, items, datum):
        return NS(
            datum=datum,
            note=note,
            items={i.id: NS(item_id=i.id, ground_el=100.0, top_el=112.0, coverage=0.9, offset_m=0.2, flags=[]) for i in items},
            candidates=[NS(id="cand-1", pts=[(200.0, 0.0), (210.0, 0.0), (210.0, 8.0), (200.0, 8.0)], top_el=112.0, size_m=(10.0, 8.0))],
        )

    monkeypatch.setattr(cc, "cloud_in_frame", lambda handle, cloud_id, grid: in_frame)
    monkeypatch.setattr(cc, "plant_bbox_site", lambda grid, items, margin: (244000.0, 3179000.0, 245000.0, 3180000.0))
    monkeypatch.setattr(cc, "sample_plant_cloud", sample)
    monkeypatch.setattr(cc, "fit_datum", lambda sample_, grid, items: CloudDatum(cloud_id="cloud-1", offset_m=120.45))
    monkeypatch.setattr(cc, "check_items", check)
    monkeypatch.setattr(cc, "apply_check", lambda items, result: [i.model_copy(update={"top_el": 112.0}) for i in items])
    monkeypatch.setattr(cc, "summarise", lambda result: "1 item checked, 1 candidate.")
    return seen


def script(ids, review):
    d0 = ids["drawings"][0]
    orchestrator = [
        reply(("set_site", KIPIC)),
        reply(("plan_packages", {"packages": [{"label": "A", "drawing_id": d0}]})),
        reply(("next_stage", {"summary": "1"})),
        *review,
        reply(("next_stage", {"summary": "env"})),
        reply(("finish", {"summary": "done"})),
    ]
    p1 = [reply(("upsert_items", {"items": [item("t1", tag="T1", did=d0, height_source="indicative")]})), finish_pkg()]
    return FakePlantLlm(orchestrator, {"P1": p1})


def test_the_cloud_check_feeds_the_review(handle, app, monkeypatch):
    seen = fake_c1(monkeypatch)
    ids = seed_plant(handle, app, clouds=["cloud-1"], limits=PlantLimits(parallel=1))
    review = [
        reply(("cloud_check", {"item_ids": ["t1"]})),
        reply(("upsert_items", {"items": [item("cand-1-tank", e=205, n=4, source={"kind": "cloud", "id": "cloud-1"})]})),
        reply(("next_stage", {"summary": "named cand-1"})),
    ]
    fake = script(ids, review)
    _, result, run, _ = run_job(handle, app, ids, fake)
    assert run.state == "finished"
    review_text = fake.of("orchestrator")[3]["user_texts"][-1]
    assert "Stage: review" in review_text and "cand-1" in review_text and "1 item checked, 1 candidate." in review_text
    assert seen["sampled"] == 1 and len(seen["saved"]) == 1  # sampled once, cached in the run folder
    with handle.session() as s:
        spec = store.get_version(s, ids["model"], result["version"]).spec
    got = {i["id"]: i for i in spec["items"]}
    assert [f["code"] for f in got["cand-1-tank"]["flags"]] == ["unregistered"]
    assert got["t1"]["top_el"] == 112.0
    assert spec["site"]["cloud_z_to_el"]["offset_m"] == 120.45
    assert not any("No cloud check" in q for q in run.open_questions)


def test_a_cloud_outside_the_frame_is_skipped_with_its_note(handle, app, monkeypatch):
    seen = fake_c1(monkeypatch, in_frame=(False, OTHER_CRS))
    ids = seed_plant(handle, app, clouds=["cloud-1"], limits=PlantLimits(parallel=1))
    _, _, run, _ = run_job(handle, app, ids, script(ids, []))
    assert run.state == "finished" and seen["sampled"] == 0
    assert f"No cloud check: {OTHER_CRS}" in run.open_questions


def test_a_check_result_note_becomes_a_run_note(handle, app, monkeypatch):
    fake_c1(monkeypatch, note="No datum could be fitted: fewer than 3 items with drawing elevations.")
    ids = seed_plant(handle, app, clouds=["cloud-1"], limits=PlantLimits(parallel=1))
    review = [reply(("next_stage", {"summary": "ok"}))]
    _, _, run, _ = run_job(handle, app, ids, script(ids, review))
    assert any("No datum could be fitted" in q for q in run.open_questions)


def test_cloud_check_tool_without_a_check(handle, app):
    rc = make_rc(handle, app, seed_plant(handle, app))
    out = T.run_plant_tool(rc, Scope(name="orchestrator", stage="review", items=rc.store), "cloud_check", {})
    assert not out.ok and "No cloud check ran" in out.text
    assert "cloud_check" in T.ORCH_NAMES and "cloud_check" not in T.SUB_NAMES
```

`seed_plant(..., clouds=["cloud-1"])` adds a point-cloud source with no row. M1's look-tool sampling then becomes a run note (Task 11 `_sample_m1_clouds`), and `_pick_cloud` falls back to the id.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `$PY -m pytest tests/test_plant_cloud_c1.py -v`
Expected: FAIL. `cloud_check` is an unknown tool, and the Task 11 `cloud_stage` records "not part of this build yet".

- [ ] **Step 3: Add `check_summary` to `PlantState`** (`state.py`), after `candidates`:

```python
    check_summary: str | None = None  # C1's summarise(result), shown in the review stage
```

In `prompt_plant.review_message`, after the "Flags:" line, add:

```python
    if rc.state.check_summary:
        lines.append("Cloud check: " + rc.state.check_summary)
```

- [ ] **Step 4: Implement `cloud.py`**

```python
# backend/app/asset_models/agent/plant/cloud.py
"""The cloud check stage (spec §8.2.4; D5): C1's module over the merged register, in app code; the
orchestrator only reviews the outcome. Positions never move; heights fill in only where indicative.
C1's call recipe: cloud_in_frame first (skip with its note), cancel=lambda: check_cancelled() or
False, and CheckResult.note becomes a run note. The sample is cached in the run folder for a resume."""

from __future__ import annotations

import logging

import numpy as np

log = logging.getLogger(__name__)
MARGIN_M = 50.0
MAX_CANDIDATES = 200


def _note(rc, text: str) -> None:
    with rc.lock:
        if text not in rc.state.notes:
            rc.state.notes.append(text)
    rc.save()


def _pick_cloud(rc, ids: list[str]) -> str:
    """Ruling R16: the largest cloud among the sources."""
    from app.db.models import PointCloud

    with rc.handle.session() as s:
        sized = [((getattr(s.get(PointCloud, i), "point_count", None) or 0), i) for i in ids]
    return max(sized)[1]


def _candidate(c) -> dict:
    pts = np.asarray(c.pts, float)  # plant [E, N] per C1; if C1 gives site X/Y, convert with grid.site_to_plant
    return {
        "id": c.id,
        "e": float(pts[:, 0].mean()),
        "n": float(pts[:, 1].mean()),
        "size_m": [float(v) for v in c.size_m],
        "top_el": float(c.top_el),
    }


def _sample(rc, cc, cid: str, grid, items):
    path = rc.run_dir / f"plant_sample_{cid}.npz"
    if path.exists():
        return cc.PlantSample.load(path)
    sample = cc.sample_plant_cloud(
        rc.handle,
        cid,
        cc.plant_bbox_site(grid, items, MARGIN_M),
        cancel=lambda: rc.check_cancelled() or False,
        progress=None,
    )
    rc.run_dir.mkdir(parents=True, exist_ok=True)
    sample.save(path)
    return sample


def cloud_stage(rc) -> None:
    from app.asset_models import cloudcheck as cc
    from app.asset_models.look import LookError

    ids = [x["id"] for x in rc.sources if x["type"] == "point_cloud"]
    if not ids:
        _note(rc, "No cloud check: no point cloud among the run's sources.")
        return
    grid = rc.grid()
    if grid is None:
        _note(rc, "No cloud check: the site frame is not set, so the cloud can't be related to the plant grid.")
        return
    with rc.lock:
        items = list(rc.store.values())
    if not items:
        _note(rc, "No cloud check: the register is empty.")
        return
    cid = _pick_cloud(rc, ids)
    ok, why = cc.cloud_in_frame(rc.handle, cid, grid)
    if not ok:
        _note(rc, f"No cloud check: {why}")
        return
    try:
        sample = _sample(rc, cc, cid, grid, items)
    except LookError as e:
        _note(rc, f"No cloud check: {e.message}")
        return
    rc.check_cancelled()
    datum = cc.fit_datum(sample, grid, items)
    result = cc.check_items(sample, grid, items, datum)
    if getattr(result, "note", None):
        _note(rc, result.note)
    checked = cc.apply_check(items, result)
    with rc.lock:
        rc.store.clear()
        rc.store.update({i.id: i for i in checked})
        if datum is not None and rc.state.site:
            rc.state.site = {**rc.state.site, "cloud_z_to_el": datum.model_dump(mode="json")}
        biggest = sorted(result.candidates, key=lambda c: -(c.size_m[0] * c.size_m[1]))[:MAX_CANDIDATES]
        rc.state.candidates = [_candidate(c) for c in biggest]
        rc.state.check_summary = cc.summarise(result)[:2000]
    rc.cloud, rc.check = sample, result
    rc.save_store()
    rc.save()
    log.info("plant cloud check items=%d candidates=%d datum=%s", len(result.items), len(result.candidates), datum is not None)
```

The tool re-checks on the in-memory `rc.cloud`. After a resume past the cloud stage `rc.cloud` is None, and the tool says so. That is acceptable: the stage's results are already in the register.

- [ ] **Step 5: Add the `cloud_check` tool to `tools_plant.py`**

```python
class CloudCheckArgs(_A):
    item_ids: Annotated[list[Annotated[str, Field(max_length=64)]], Field(min_length=1, max_length=300)] | None = None


class CloudCheck:
    name, Args = "cloud_check", CloudCheckArgs
    description = (
        "Re-run the cloud check on chosen items (or all) after edits: per item, ground and top EL from the "
        "cloud, scan coverage, the plan offset, and flags. Positions never move; heights fill in only where "
        "the height is indicative."
    )

    def run(self, rc, scope, a):
        from app.asset_models import cloudcheck as cc

        if rc.cloud is None:
            return ToolOut("No cloud check ran in this run. " + " ".join(rc.state.notes), "No cloud check", ok=False, phase="checking")
        wanted = set(a.item_ids) if a.item_ids else None
        with rc.lock:
            items = [i for i in rc.store.values() if wanted is None or i.id in wanted]
        if not items:
            return ToolOut("None of those items are in the register.", "Nothing to check", ok=False, phase="checking")
        site = rc.site()
        result = cc.check_items(rc.cloud, rc.grid(), items, site.cloud_z_to_el if site else None)
        checked = cc.apply_check(items, result)
        with rc.lock:
            for i in checked:
                rc.store[i.id] = i
        rc.save_store()
        rows = [
            f"{c.item_id}: ground EL {_num(c.ground_el)}, top EL {_num(c.top_el)}, coverage {c.coverage:.0%}, "
            f"offset {_num(c.offset_m)} m, flags {','.join(f.code for f in c.flags) or '-'}"
            for c in list(result.items.values())[:QUERY_ROWS]
        ]
        head = f"Checked {len(result.items)} items." + (f" {result.note}" if getattr(result, "note", None) else "")
        return ToolOut(head + "\n" + "\n".join(rows), f"Checked {len(result.items)} items against the cloud", phase="checking")
```

Then:
- `_TOOLS`: append `CloudCheck()`.
- `ORCH_NAMES`: insert `"cloud_check"` before `"next_stage"`.

- [ ] **Step 6: Run the tests to verify they pass**

Run: `$PY -m pytest tests/test_plant_cloud_c1.py tests/test_plant_run.py tests/test_plant_run_stops.py tests/test_plant_prompt.py -v`
Expected: all pass. The `test_plant_run` pipeline has no cloud source, so it still records "No cloud check: no point cloud among the run's sources."

- [ ] **Step 7: Commit**

```bash
git add backend/app/asset_models/agent/plant/cloud.py backend/app/asset_models/agent/plant/state.py backend/app/asset_models/agent/plant/prompt_plant.py backend/app/asset_models/agent/plant/tools_plant.py backend/tests/test_plant_cloud_c1.py
git commit -m "feat(plant-run): cloud check stage and tool on C1; candidates reviewed by the orchestrator" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 17: Full gate and the operator walkthrough

**Files:**
- Create: `.superpowers/sdd/pm-common/walkthroughs/r1.md` (git-ignored SDD workspace, not committed; the coordinator relays it)

- [ ] **Step 1: Run the whole gate from the worktree root** (`E:\Dev\Yolo\app\.claude\worktrees\pm-r1`)

```
pnpm -C contract check
cd backend; $PY -m ruff check .; $PY -m ruff format --check .; $PY -m pytest; cd ..
pnpm -C frontend lint
pnpm -C frontend test
pnpm -C frontend build
pnpm -C frontend e2e
```

Run `cargo test --manifest-path frontend/src-tauri/Cargo.toml` only if `frontend/src-tauri/binaries/kestrel-backend-*.exe` exists. Otherwise write "skipped: no frozen sidecar" in the ledger.

Expected: every command exits 0. The backend suite includes every `test_plant_*.py`. R1 touches no frontend file, so lint, test, build and e2e must match `main`.

- [ ] **Step 2: Fix any failure at its cause** (superpowers:systematic-debugging). Re-run only the failing command until it passes, then re-run the whole gate once.

- [ ] **Step 3: Check the invariants by reading the diff once**
  - `git diff main --stat` shows only the files listed under "Shared-file touches" plus `agent/plant/*` and `tests/test_plant_*`, `tests/plant_fakes.py`.
  - `git grep -n "log\.\(info\|warning\|error\)" backend/app/asset_models/agent/plant` shows only names, states, counts, durations and type names. No `.text`, `summary`, `brief` or `args` is passed to a log call.
  - `git grep -n "api_key\|keys.get" backend/app/asset_models/agent/plant` shows only `model.py`, which deletes the key in `finally`.

- [ ] **Step 4: Write the operator walkthrough** to `.superpowers/sdd/pm-common/walkthroughs/r1.md`:

```markdown
# R1 plant run: how to test this

The plant run has no screen of its own yet; S3 adds the build dialog's plant mode and the Run bar.
These steps use the API docs page.

1. Start the app (`pnpm -C frontend tauri dev`), open the LNG Terminal project and import the
   Al-Zour plot plans (all pages).
2. In App settings, check that an Anthropic API key is set.
3. Open `http://127.0.0.1:<backend port>/docs` and find `POST /api/v1/projects/{projectId}/asset-models`.
   Create a model named "Al-Zour plant".
4. Call `POST …/asset-models/{id}/runs` with `{"mode": "plant", "provider": "anthropic", "sources": [the
   drawing pages and the point cloud], "limits": {"max_tokens": 2000000, "parallel": 2}}`.
   A small budget keeps the test cheap.
5. Watch `GET …/runs/{runId}`:
   - `phase` moves from reading to building to checking;
   - `usage_by_stage.current` shows the stage (survey, trace, merge, cloud_check, review, environment, build);
   - `packages` counts up;
   - `cost_estimate_usd` grows and is labelled an estimate.
6. `GET …/runs/{runId}/packages` lists the packages with their state and item counts.
7. When the budget runs out, the run ends `stopped` with `stop_reason: budget`. The summary names the
   packages not traced, and a version still appears under `GET …/versions`.
8. Close the app while a run is tracing, then open it again. The same run continues: `job_id`
   changes, finished packages stay `done`, and the one that was running starts again.
9. Start a run and press Stop (`POST …/runs/{runId}/stop`). The run ends `stopped/user` with a
   `draft` version of what had been traced.
10. Re-run one package: `POST …/runs` with `{"mode": "plant_package", "package_ids": ["<a package
    id>"], …}`. A new `agent` version keeps every other item.
11. On the Map, a plot plan page that had no georeference before the run now sits in place. The run
    placed it from the plant grid.
```

- [ ] **Step 5: Report READY_TO_MERGE** to the coordinator with the ledger. Do not merge, push, build an installer or run `/wrapup`.

---

## Self-review (planner's checklist, done)

- **Spec coverage:**

  | Spec section | Task |
  | --- | --- |
  | §8.2 survey | T9, T11 |
  | §8.2 trace | T10, T11 |
  | §8.2 merge | T4 |
  | §8.2 cloud check | T16 |
  | §8.2 environment | T5 tool, T11 stage |
  | §8.2 build and self-check | T8, T11 |
  | §8.3 tools | T5–T8, T16 |
  | §8.4 budget | T2, T10, T12 |
  | §8.4 stop | T12 |
  | §8.4 resume | T13 |
  | §8.4 `plant_package` | T12, T14 |
  | §8.4 cost estimate | T2, T14 |
  | §8.5 prompts | T9 |
  | §15 drawing auto-georef | T7 |
  | §10 runs extensions and packages route | T14 |
  | §13 R1 gate tests | T11–T13 |

- **Review Focus lines** each have a test in their owning task:
  - #1 `test_drawing_zoom_caps_dpi_with_note` (T6);
  - #2 `test_resume_skips_done_packages` and `test_double_interrupt_fails_package` (T13);
  - #3 `test_rate_limit_retries_then_fails_package_only` (T10);
  - #4 `test_upsert_items_partial_accept` (T5);
  - #5 `test_budget_out_still_builds` (T12).
- **Type consistency:** `Scope`, `PlantRunContext`, `PackageWork`, `PackageResult`, `RunBudget.snapshot` and the `usage_by_stage` shape are each defined once and used with the same names in later tasks.

