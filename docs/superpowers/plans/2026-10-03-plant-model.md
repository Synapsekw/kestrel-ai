# Plant model generator and Site 3D view (G1) Implementation Plan: index

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Each unit has its own plan file (below), is built in its own worktree `.claude/worktrees/pm-<unit>` on `task/pm-<unit>`, and is merged by the coordinator.

**Goal:** One unattended AI run turns a project's drawings and point cloud into a plant model:
- a typed item register, built into a GLB plus a register CSV by app-code builders;
- shown in a new Site 3D view over the draped ortho, the cloud and the drawings, with water and sky.

**Architecture:**
- The M1 package `backend/app/asset_models/` widens:
  - `AssetSpec` gains `site`, `items` and `environment`;
  - a **builder catalogue** (`builders/`) makes item meshes;
  - an **assembler** writes the GLB, the CSV and the `asset_item` index;
  - a **plant run** (`agent/plant/`) runs an orchestrator plus up to 4 parallel sub-run conversations inside the existing `asset_model_run` job;
  - a **cloud check** module fits heights and flags.
- The frontend adds `frontend/src/site3d/`, a new three.js + potree-core engine with layer modules and Aero glass panels. It does not touch `frontend/src/assetmodels/viewer/engine.ts`, which artifact-port P1 builds on.

**Tech Stack:**
- Backend: FastAPI, SQLAlchemy/Alembic (per-project SQLite), pytest, trimesh, numpy, scipy, Pillow, pypdfium2, laspy, rasterio, pyproj. **No new Python packages.**
- Frontend: React 18 + TS, three 0.180.0 (`GLTFLoader`, `Water`, `Sky`, `OrbitControls`), potree-core 2.0.15, proj4, Vitest, Playwright.

**Spec:** `docs/superpowers/specs/2026-10-03-plant-model-generator-design.md`. Read it with this index.

## Unit plans

| Unit | File | Builds | Cut after | Batch |
| --- | --- | --- | --- | --- |
| F0 | `2026-10-03-plant-model-f0.md` | Contract (all of spec §10), migration 0017, ORM, spec models, `siteframe`, builder registry/interfaces + `other`/`composite`, palette, 501 stubs | `main` with P1's 0016 | 1 |
| B1 | `2026-10-03-plant-model-b1.md` | Structure builders (11) | F0 | 2 |
| B2 | `2026-10-03-plant-model-b2.md` | Equipment builders (19) | F0 | 2 |
| B3 | `2026-10-03-plant-model-b3.md` | Building + civil builders (15) + environment meshes | F0 | 2 |
| A1 | `2026-10-03-plant-model-a1.md` | Assembler: GLB hierarchy, extras, instancing, CSV, `asset_item` index, items/csv routes, async validate, P1 frame fill | F0 | 2 |
| I1 | `2026-10-03-plant-model-i1.md` | Intake: all-pages PDF import, unimported-drawings scan, source grouping | F0 | 2 |
| C1 | `2026-10-03-plant-model-c1k1.md` (part C) | Cloud check: plant sample, datum fit, per-item heights/flags, candidates | F0 | 2 |
| K1 | `2026-10-03-plant-model-c1k1.md` (part K) | Scorer + KIPIC fixtures + live acceptance test skeleton | F0 | 2 |
| S1 | `2026-10-03-plant-model-s1.md` | Site 3D core: route, engine, `siteTransform`, model/ortho/drawing layers, site-scene manifest route, presets, selection | F0 | 2 |
| R1 | `2026-10-03-plant-model-r1.md` | Plant run: orchestrator, sub-runs, packages, plant tools, prompts, budget/stop/resume, runs API extensions, drawing auto-georef | F0, I1, C1 (tool wraps C1) | 3 |
| S2 | `2026-10-03-plant-model-s2s3.md` (part S2) | Site 3D layers: cloud, water, sky, photos, findings | S1 | 3 |
| S3 | `2026-10-03-plant-model-s2s3.md` (part S3) | Site 3D panels: layers, register, item + editor, run bar, entry points, M1 UI fixes | S1, A1 | 3 |
| L1 | coordinator (no plan file) | Live Al-Zour acceptance loop, prompt tuning, installer, evidence | all | 4 |

**DAG:**

```
F0 ──┬─ B1 ─┐
     ├─ B2 ─┤
     ├─ B3 ─┤
     ├─ A1 ─┼──────────── S3 ─┐
     ├─ I1 ─┼─ R1 ────────────┼─ L1
     ├─ C1 ─┘                 │
     ├─ K1 ───────────────────┤
     └─ S1 ─┬─ S2 ────────────┤
            └─ S3 ────────────┘
```

- **Critical path:** F0 → I1/C1 → R1 → L1.
- R1 can start against F0 alone and wait (`WAITING: C1`) only for its `cloud_check` tool task.
- Builders merge in any order: A1's fallback (`other`) covers types not yet built.

## Global Constraints

These apply to every task in every unit.

**Contract**
- `contract/openapi.yaml` is the source of truth. `contract/client/schema.d.ts` is regenerated with `pnpm -C contract generate` and committed in the same commit, never hand-edited.
- `oas3-unused-component` is an error. Nullable types use `type: [X, "null"]`.
- Path parameter names match the contract literally: `projectId`, `assetModelId`, `version`, `runId`, `itemId`.
- **F0 owns the contract.** No other unit edits `openapi.yaml` except to fix a defect, which is then logged as a ruling and handed off.
- Every contract operation is routed (`backend/tests/test_contract.py`). Until the owning unit lands, new operations are 501 stubs in `app/asset_models/stubs_plant.py`; the owning unit deletes its stub line.

**Data and migrations**
- **Migration 0017 is additive only:** new tables `asset_item` and `site_model_package`; `ALTER TABLE asset_model ADD COLUMN kind`.
- No batch rebuild of `asset_model`, `asset_model_version` or `finding`; P1's `0016` owns those. Never drop P1's columns.
- A catalogue migration, if one is ever needed, is `0005`.
- **`asset_model.frame` (P1's column)** is written only by A1, only when it is null, and only through P1's `app.asset_review.frame.Frame`. Never write `silhouette`, `levels` or `presets`.
- Versions are never overwritten or deleted except with their asset model.

**Keys and logging**
- API keys only ever come from `KeyStore.get(provider)` at the moment of a model call, and are deleted right after. Never in a log, job message, step summary, error, file or commit.
- Logs carry tool names, states, durations and counts only. Never prompts, model output, tool payloads or SDK exception text.

**Jobs, bounded reads and limits**
- **Background jobs:** `asset_model_run` (plant mode ≤ 4 h, cancellable, resumable); `asset_model_glb` (GLB + CSV + index); `drawing_import` (all pages, one job); and the cloud sample (inside the run).
- No route blocks on mesh generation, validation over 200 items, cloud sampling or a model call.
- **Bounded reads:**
  - drawing images to the model ≤ 1 600 px longest side;
  - `drawing_zoom` ≤ 600 dpi source resolution;
  - plant cloud sample ≤ 20 000 000 points, float32, built in one streamed laspy pass of ≤ 2 M-point chunks, cancellable;
  - per-item cloud work ≤ 200 000 points;
  - items list ≤ 500 rows per page;
  - `items_query` ≤ 300 rows;
  - renders ≤ 1 600 px and ≤ 4 views per call;
  - Site 3D: ortho/drawing textures ≤ 64 MB and ≤ 256 live tiles; cloud point budget 3 M (setting); photo glyphs ≤ 2 000, instanced.
- **Plant run limits (defaults, configurable in App settings next to M1's):**
  - 40 000 000 tokens (input + output, summed over the orchestrator and all sub-runs);
  - 400 images; 4 h wall clock;
  - up to 4 parallel sub-runs;
  - per sub-run: 150 calls, 4 000 000 tokens, 60 images.
  - M1 limits (80 calls / 3 M / 40 images / 20 min) stay for `build` and `refine` modes.
- Each conversation's history is **append-only** (preserved thinking). Anthropic prompt caching is on.

**Frames and units**
- Spec item coordinates are **plant metres**: `[E, N]` in the drawing's plant grid, elevations as plant EL in metres.
- M1 part params stay in millimetres.
- Scene/GLB frame: metres, `x = plant_N`, `y = EL - datum.el_m`, `z = plant_E` (Y up, X plant north, Z plant east).
- Site CRS from plant:
  ```
  [X, Y] = origin_crs + R(plant_north_deg) · [E, N]
  R(θ) = [[cos θ, sin θ], [-sin θ, cos θ]]
  ```
  This is a clockwise rotation of the plant grid by θ against grid north. It must reproduce Cowork's register `utm39_E/N` from `plant_E/N` with `origin_crs = (244338.089, 3179515.690)` and `θ = 17.9991`, all 878 rows with coordinates within 0.05 m (verified 0.01 m). F0's golden test is the arbiter. (Verified by the coordinator against the register before planning.)

**Builders**
- A builder never raises to the assembler: `build_item` catches and falls back to `other` with a `builder_fallback` flag.
- Builders are pure: no DB, no I/O, deterministic for the same item.

**UI**
- Copy is sentence case. No raw colours in TSX/CSS (`frontend/scripts/check-tokens.mjs`).
- Motion via tokens only; respect reduced motion. Panels use `GlassPanel` and the `frontend/src/ui/` primitives.
- UI units load the design skills (`impeccable`, `emil-design-eng`) and `DESIGN.md` first.
- The Site 3D screen is lazy-loaded (`src/app/lazyScreens.tsx`). `three` stays pinned at 0.180.0.
- e2e navigation uses `getByRole("navigation", { name: "Main navigation" }).getByRole("link", { name: /^Asset models/ })`. The sidebar redesign removed the tablist.

**Git and shared machine**
- Stage files by path; never `git add -A`. Never `git stash`. Commits end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Commit identity is "Danijel Jovanovic" / info@synapse-solutions.ai.
- Backend interpreter: `E:\Dev\Yolo\app\backend\.venv\Scripts\python.exe`, run from `<worktree>\backend`.
- **Never install anything into the shared venv.** No unit adds Python packages. Frontend packages: none planned. A unit that needs one stops and reports.

**Gate before READY_TO_MERGE** (AGENTS.md item 4):
```
pnpm -C contract check
ruff check .
ruff format --check .
pytest
pnpm -C frontend lint
pnpm -C frontend test
pnpm -C frontend build
pnpm -C frontend e2e        # on the unit's port range
```
`cargo test` runs only when the frozen sidecar exists. Full suites run only in the unit's final gate.

## Binding interfaces

Names here are binding for every unit plan. F0 creates every file marked *(F0)*. Other units fill the bodies they own.

### Backend: spec (`app/asset_models/spec.py`, F0)

```python
class SiteCrs(_Strict):            epsg: int | None = None; wkt: str | None = None
class Datum(_Strict):              label: str = "EL"; el_m: float = 0.0
class CloudDatum(_Strict):         cloud_id: str; offset_m: float; tilt: tuple[float, float] | None = None   # plant EL = cloud z + offset_m (+ tilt·[dx,dy])
class SiteFrame(_Strict):
    crs: SiteCrs
    origin_crs: tuple[float, float]
    plant_north_deg: float
    datum: Datum = Datum()
    cloud_z_to_el: CloudDatum | None = None
    source: Source

class RectFootprint(_Strict):      kind: Literal["rect"]; center: Pt2; size: tuple[Pos, Pos]; rot_deg: float = 0   # size = (along, across); along axis at rot_deg clockwise from plant north
class CircleFootprint(_Strict):    kind: Literal["circle"]; center: Pt2; d: Pos
class PolygonFootprint(_Strict):   kind: Literal["polygon"]; pts: list[Pt2]   # 3..500, plant [E, N]
class LineFootprint(_Strict):      kind: Literal["line"]; pts: list[Pt2]; width: Pos   # 2..500
Footprint = Annotated[RectFootprint | CircleFootprint | PolygonFootprint | LineFootprint, Field(discriminator="kind")]

FlagCode = Literal["plan_offset", "height_mismatch", "missing_in_cloud", "unregistered", "builder_fallback", "straddles_package"]
class ItemFlag(_Strict):           code: FlagCode; value: float | None = None; note: str | None = Field(None, max_length=300)

class Item(_Strict):
    id: ItemId                      # ^[A-Za-z0-9_.\-]{1,64}$
    tag: str | None = None
    name: str                       # 1..200
    type: str                       # a registry type; checked by validate(), not by the schema
    area: str | None = None
    footprint: Footprint
    base_el: float | None = None
    top_el: float | None = None
    levels: list[float] = []
    params: dict[str, Any] = {}
    height_source: Literal["drawing", "cloud", "indicative"] = "indicative"
    source: Source                  # M1 Source, plus optional `page: int`
    confidence: Confidence = "medium"
    flags: list[ItemFlag] = []
    parts: list[Part] = []          # M1 parts, item-local mm (origin = footprint ref point at base_el)
    notes: str | None = Field(None, max_length=1000)

EnvKind = Literal["land", "sea", "road", "paved", "laydown", "slope", "revetment"]
class EnvFeature(_Strict):         id: ItemId; kind: EnvKind; pts: list[Pt2]; el: float; source: Source; confidence: Confidence = "medium"

class AssetSpec(_Strict):          # M1 fields unchanged, plus:
    site: SiteFrame | None = None
    items: list[Item] = []
    environment: list[EnvFeature] = []
```

### Backend: plant grid (`app/asset_models/siteframe.py`, F0)

```python
class PlantGrid:
    def __init__(self, frame: SiteFrame): ...
    def plant_to_site(self, e: ArrayLike, n: ArrayLike) -> tuple[np.ndarray, np.ndarray]
    def site_to_plant(self, x: ArrayLike, y: ArrayLike) -> tuple[np.ndarray, np.ndarray]
    def plant_to_scene(self, e, n, el) -> np.ndarray          # (..., 3): x=N, y=EL-datum, z=E
    def scene_to_plant(self, xyz: np.ndarray) -> tuple[np.ndarray, np.ndarray, np.ndarray]
    def site_to_lonlat(self, x, y) -> tuple[np.ndarray, np.ndarray]   # pyproj; raises GridError without a CRS
    def convergence_deg(self) -> float                         # grid north vs true north at the origin
def fit_plant_grid(pairs: list[tuple[tuple[float, float], tuple[float, float]]]) -> tuple[tuple[float, float], float, float]
    # [((E, N), (X, Y)), ...] (≥ 2) → (origin_crs, plant_north_deg, rms_residual_m); similarity without scale
def footprint_ref(fp: Footprint) -> tuple[float, float]       # rect/circle centre; polygon/line area- or length-weighted centroid
def footprint_polygon(fp: Footprint) -> np.ndarray            # (k, 2) plant [E, N], closed ring not repeated
class GridError(Exception)
```

Golden vectors: `contract/fixtures/plant-grid-vectors.json` (F0 writes them from the KIPIC register: 50 rows `{plant_E, plant_N, site_X, site_Y}` + frame). Pinned by pytest and by vitest in S1.

### Backend: builders (`app/asset_models/builders/`, F0 creates `__init__.py`, `base.py`, `palette.py`, `fallback.py`)

```python
@dataclass(frozen=True)
class Instanced:  mesh: trimesh.Trimesh; transforms: np.ndarray          # (N, 4, 4), item-local metres
@dataclass
class MeshNode:   name: str; material: str; geometry: trimesh.Trimesh | Instanced; extras: dict = field(default_factory=dict)
@dataclass(frozen=True)
class BuildCtx:
    grid: PlantGrid | None
    lod: float = 1.0                       # 1 = full detail; builders scale segment counts / instance density
    def local(self, item: Item, e, n) -> np.ndarray   # plant [E,N] → item-local [x, z] metres (x north, z east), origin = footprint_ref
    def height(self, item: Item, default_m: float) -> tuple[float, float, bool]   # (base_el, top_el, defaulted)
@dataclass(frozen=True)
class BuilderDef: type: str; family: Literal["structure","equipment","building","civil","environment","fallback"]; params: type[BaseModel]; fn: Callable[[Item, BuildCtx], list[MeshNode]]; doc: str; default_height_m: float
REGISTRY: dict[str, BuilderDef]
def builder(type: str, *, family: str, params: type[BaseModel], doc: str, default_height_m: float) -> Callable   # decorator; registers
def build_item(item: Item, ctx: BuildCtx) -> tuple[list[MeshNode], list[ItemFlag]]   # validates params, catches, falls back to "other"
def catalogue() -> list[dict]          # [{type, family, doc, default_height_m, params_schema}] sorted by family, type
def load_all() -> None                 # imports builders.structure, .equipment, .building, .civil, .environment if present (ImportError-tolerant)
PALETTE: dict[str, tuple[tuple[float, float, float, float], float, float]]   # name → (srgba, metallic, roughness); Cowork's 34 names
```

- Item-local frame: metres, Y up from `base_el`, x = plant north, z = plant east, origin at `footprint_ref`. Builders rotate by `rot_deg` themselves.
- Family modules (owned by B1/B2/B3): `builders/structure.py`, `builders/equipment.py`, `builders/building.py`, `builders/civil.py`, `builders/environment.py` (B3; env meshes take `EnvFeature`: `build_env(feature: EnvFeature, ctx) -> list[MeshNode]`).
- Each family has a `tests/test_builders_<family>.py`.
- Shared geometry helpers go in `builders/geom.py`. F0 creates it with:
  - `extrude(poly2d, h)`
  - `box(w, l, h)`
  - `cyl(r, h, segments=None)`
  - `beam(p0, p1, section=(w, h))`
  - `ring_polyline(...)`
  - `instanced_cyl(r, h, xforms)`
  - `segments_for(r, chord_err=0.02)`
  Families may add helpers in their own module only.

### Backend: assembler (`app/asset_models/assemble.py`, A1)

```python
CSV_COLUMNS = ["node","tag","name","type","area","group","plant_E","plant_N","utm39_E","utm39_N","base_EL","height_m","top_EL","height_source","has_geometry","source_sheet","notes","flags","confidence"]
def assemble_glb(spec: AssetSpec, *, lod: float = 1.0, progress: Callable[[float], None] | None = None) -> tuple[bytes, dict]   # meta: bounds_m, triangles, node_count, items, fallbacks, instanced
def register_rows(spec: AssetSpec, sheet_names: dict[str, str] | None = None) -> list[dict]   # CSV_COLUMNS order, one per item
def write_csv(rows: list[dict], path: Path, *, site_label: str = "utm39") -> None
def index_items(s: Session, model_id: str, version: int, rows: list[dict]) -> int
```

The GLB job (`jobs_glb.run_glb`) dispatches to `assemble_glb` when `spec.items or spec.environment`, otherwise M1 `build_glb`. Files: `v<n>.glb`, `v<n>.csv`, `v<n>.meta.json`.

### Backend: cloud check (`app/asset_models/cloudcheck.py`, C1)

```python
@dataclass
class PlantSample: xyz: np.ndarray (float32, site CRS x,y + cloud z); cloud_id: str; crs_epsg: int | None; bbox: tuple[float,float,float,float]
def sample_plant_cloud(handle, cloud_id: str, bbox_site: tuple[float,float,float,float], *, max_points: int = 20_000_000, cancel: Callable[[], bool] | None = None, progress=None) -> PlantSample
def fit_datum(sample: PlantSample, grid: PlantGrid, items: list[Item]) -> CloudDatum | None   # from items with height_source=drawing base_el, else ground percentile vs datum; None if < 3 usable
@dataclass
class ItemCheck: item_id: str; ground_el: float | None; top_el: float | None; coverage: float; offset_m: float | None; flags: list[ItemFlag]
@dataclass
class Candidate: id: str; pts: list[tuple[float, float]]; top_el: float; size_m: tuple[float, float]
@dataclass
class CheckResult: datum: CloudDatum | None; items: dict[str, ItemCheck]; candidates: list[Candidate]
def check_items(sample: PlantSample, grid: PlantGrid, items: list[Item], datum: CloudDatum | None) -> CheckResult
def apply_check(items: list[Item], result: CheckResult) -> list[Item]   # heights where indicative → cloud; flags added; positions never moved
```

### Backend: scorer (`app/asset_models/score.py`, K1)

```python
@dataclass
class ScoreReport: tagged_ref: int; tagged_found: int; type_match: int; recall: float; type_accuracy: float; pos_err_p50_m: float; pos_err_p95_m: float; within_tol: float; by_area: dict[str, dict]; missing: list[str]; extra: list[str]; required_present: dict[str, bool]; landmask_hausdorff_m: float | None
def read_register(path: Path) -> list[dict]
def score(gen: list[dict], ref: list[dict], *, gen_land: list | None = None, ref_land: list | None = None) -> ScoreReport
# CLI: python -m app.asset_models.score <gen.csv> <ref.csv> [--gen-land x.json --ref-land y.json] [--json out.json]
```

### Backend: plant run (`app/asset_models/agent/plant/`, R1)

- `run_asset_model` (M1 runner) dispatches `mode in ("plant", "plant_package")` to `agent.plant.orchestrator.run_plant(ctx) -> dict`.
- Modules:
  - `orchestrator.py`
  - `subrun.py` (`run_package(rc, package) -> PackageResult`)
  - `packages.py` (DB helpers for `site_model_package`)
  - `tools_plant.py` (the §8.3 tools as `ToolSpec`s in M1's `ToolOut` style, registered in a `PLANT_TOOLS` dict; sub-runs also get M1's look tools)
  - `budget.py` (`RunBudget`, thread-safe: `charge(usage)`, `charge_image()`, `exhausted() -> str | None`)
  - `prompt_plant.py`
  - `merge.py` (`merge_items(lists) -> list[Item]`)
  - `resume.py` (called from `startup.py`)
- **Drawing auto-georef:** when `set_site` succeeds and a page used for grid points has no georeference, R1 writes one through the existing drawings georef service (control points = the grid points). That puts the drawing on the map and in the Site 3D view.

### Backend: intake (I1)

- `app/drawings/`: new operation `createDrawingPages`, `POST /api/v1/projects/{projectId}/drawings/pages`.
  - Body: `{inspection_id, name, pages: "all" | int[], dpi?, placement, captured_on?}`.
  - Returns 202 with `DrawingPagesWithJob {drawings: Drawing[], job: Job}`. One `drawing_import` job builds the pages in order.
  - Names are `"<name> — p<k>"`, matching the existing naming.
- `GET /api/v1/projects/{projectId}/drawings/unimported` (`listUnimportedDrawings`) returns `{files: [{path, name, format, size, pages: int | null}]}`.
  - It scans the project folder recursively to depth 3 for `.pdf .dxf .tif .tiff .png .jpg .landxml .xml`, skipping Kestrel-managed folders.
  - sha256 is checked against the `Drawing.source_sha256` set, with a cache keyed by (path, size, mtime) in `<project>/cache/unimported.json`.
  - ≤ 500 files.
- `list_sources` (M1 tool) groups drawing pages by `source_sha256` into `{file, pages: [{id, page}]}`.

### Contract additions (F0), operationIds

| operationId | Method + path (under `/api/v1/projects/{projectId}`) | Owner |
| --- | --- | --- |
| `listAssetModelItems` | GET `/asset-models/{assetModelId}/versions/{version}/items?q&type&area&flag&bbox&cursor&limit` → `AssetItemPage {items: AssetItemRow[], next_cursor}` | A1 |
| `getAssetModelItem` | GET `/asset-models/{assetModelId}/versions/{version}/items/{itemId}` → `AssetItem` | A1 |
| `getAssetModelCsv` | GET `/asset-models/{assetModelId}/versions/{version}/csv` → text/csv | A1 |
| `listAssetModelRunPackages` | GET `/asset-models/{assetModelId}/runs/{runId}/packages` → `SiteModelPackageList` | R1 |
| `createDrawingPages` | POST `/drawings/pages` | I1 |
| `listUnimportedDrawings` | GET `/drawings/unimported` | I1 |
| `getSiteScene` | GET `/site-scene?modelId=` → `SiteScene` | S1 |
| `getAssetModelCatalogue` | GET `/api/v1/asset-models/catalogue` (not project-scoped) → `AssetModelCatalogue` | F0 (live from `catalogue()`) |

Schema changes:
- `AssetSpec` gains `site`, `items`, `environment`. New schemas: `SiteFrame`, `AssetItem`, `ItemFootprint` (oneOf with a `kind` discriminator), `ItemFlag`, `EnvFeature`.
- `AssetModel` gains `kind: asset | plant`.
- `AssetModelRunStart.mode` gains `plant` and `plant_package`, plus `package_ids?: string[]`, `limits?: {max_tokens?, max_images?, max_seconds?, parallel?}`.
- `AssetModelRun` gains `packages?: {total, done, failed, running}` and `usage_by_stage?: object`.

**`SiteScene`** has these fields:

| Field | Value |
| --- | --- |
| `frame` | `{crs: {epsg, wkt}, origin_crs, plant_north_deg, datum}`, or null |
| `model` | `{id, version, glb_url, csv_url, kind}`, or null |
| `orthos` | `[{id, name, tile_url_template, bounds_site, min_z, max_z}]` |
| `clouds` | `[{id, name, octree_url, crs_epsg, same_crs: bool, z_offset_m}]` |
| `drawings` | `[{id, name, tile_url_template, bounds_site}]` |
| `photos` | `{count, url}` |
| `findings` | `{count, url}` |

Every list is ≤ 200 entries.

### Frontend (S1 creates, S2/S3 extend)

- Route `/p/:projectId/site` and `/p/:projectId/site/:modelId`, lazily loaded as `SiteScreen` in `src/app/lazyScreens.tsx`.
- `frontend/src/api/siteScene.ts`: `useSiteScene(projectId, modelId?)`, `useAssetItems(...)`, `getAssetItem(...)`. Uses the generated client.
- `frontend/src/site3d/engine/siteTransform.ts`:
  ```ts
  export interface SiteFrameT { crs: { epsg: number | null; wkt: string | null }; origin_crs: [number, number]; plant_north_deg: number; datum: { label: string; el_m: number } }
  export function plantToSite(f: SiteFrameT, e: number, n: number): [number, number]
  export function siteToPlant(f: SiteFrameT, x: number, y: number): [number, number]
  export function plantToScene(f: SiteFrameT, e: number, n: number, el: number): [number, number, number]
  export function siteToScene(f: SiteFrameT, x: number, y: number, z: number): [number, number, number]
  ```
  It is pinned to `contract/fixtures/plant-grid-vectors.json`.
- `frontend/src/site3d/engine/SiteEngine.ts`:
  ```ts
  class SiteEngine { constructor(canvas: HTMLCanvasElement, frame: SiteFrameT | null); addLayer(l: SiteLayer): void; removeLayer(id: string): void; flyTo(box: THREE.Box3): void; setPreset(id: string): void; pick(x: number, y: number): PickHit | null; onSelect(cb): () => void; dispose(): void }
  ```
- `frontend/src/site3d/layers/types.ts`:
  ```ts
  export interface SiteLayer { id: string; label: string; attach(e: SiteEngine): Promise<void> | void; detach(): void; setVisible(v: boolean): void; setOpacity?(o: number): void; update?(dt: number, camera: THREE.Camera): void }
  ```
- Layer modules, one per file: `model.layer.ts`, `ortho.layer.ts` and `drawing.layer.ts` (S1); `cloud.layer.ts`, `water.layer.ts`, `sky.layer.ts`, `photos.layer.ts` and `findings.layer.ts` (S2).
- Panels in `frontend/src/site3d/panels/` (S3):
  - `LayersPanel.tsx`
  - `RegisterPanel.tsx`
  - `ItemPanel.tsx`
  - `ItemEditor.tsx` (a form driven by the catalogue schema)
  - `RunBar.tsx`
  - S1 ships a minimal `SiteScreen.tsx` with placeholders that S3 replaces.

## Review Focus

Five inputs most likely to bite the operator that no unit's happy-path tests reach. Each line names the test pinning it and the unit that owns it.

1. **A scanned plot plan at 1:3000 with tiny tags.** The agent must zoom rather than guess. `drawing_zoom` must refuse a region whose output would exceed 1 600 px at the requested dpi: it returns the largest dpi that fits plus a note. It must never error the run.
   Owner R1: `test_drawing_zoom_caps_dpi_with_note`.
2. **A cloud in a different CRS, or a local-frame cloud.**
   - The cloud check must skip it with a run note (no heights; `same_crs=false` in the scene manifest). It must never project silently.
   - The Site 3D view shows "can't place this cloud".
   - Owners: C1 `test_check_skips_cloud_in_other_crs`; S2 `cloud.layer.test.ts` "other crs".
3. **The app closes mid plant-run (hours in).**
   - On the next open the run resumes from the last finished package.
   - It must not re-bill done packages or duplicate items.
   - A run interrupted twice in the same package marks that package `failed` and continues.
   - Owner R1: `test_resume_skips_done_packages`, `test_double_interrupt_fails_package`.
4. **A 2 000+ item register with one item whose params break its builder** (a NaN, a zero-length line, a self-intersecting polygon).
   - The GLB still builds; that item becomes `other` with a `builder_fallback` flag.
   - The validator reports the polygon.
   - The register CSV and the index still contain the item.
   - Owner A1: `test_assemble_survives_broken_item`.
5. **A project with no ortho, no cloud, or no model yet.**
   - The Site 3D view opens with whatever exists: frame from the map workspace, empty layers greyed, an empty state pointing at "Build a plant model".
   - It never shows a blank canvas or an uncaught error.
   - Owner S1: `SiteScreen.test.tsx` "no model", "no frame".

## Spec amendments made while planning

These are folded into the spec in the same commit as this index.
- **No meshopt compression in G1.** There is no Python encoder in the venv and no new packages are allowed. GLBs are uncompressed. Instancing is the main size lever. The scene still registers the meshopt decoder for imported GLBs.
- **All-pages import is a new operation** (`createDrawingPages`). The existing `createDrawing` refuses a second build from one inspection while one is queued (409 `job_running`).
- **Drawing auto-georef from the plant grid** (R1). Al-Zour's area plot plans have no georeference; the run's grid points give one, so the drawing layer can show them.
- **Item `type` is a free string in the contract**, checked against the registry by `validate()`. Adding a builder then needs no contract change. The catalogue route publishes the live list.
