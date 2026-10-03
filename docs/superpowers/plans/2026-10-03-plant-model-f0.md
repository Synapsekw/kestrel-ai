# Plant model F0 (foundation) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Land everything the eight batch-2 units build on: the whole G1 contract, migration 0017 and its ORM, the plant spec models, the plant grid (`siteframe`), the builder registry with its `other` and `composite` fallbacks, Cowork's palette, a proven way to write `EXT_mesh_gpu_instancing`, plant spec validation (off the request path above 200 items), the live builder catalogue route and 501 stubs for every other new operation.

**Architecture:** F0 widens M1's `backend/app/asset_models/` package and adds no behaviour a user can see. `spec.py` gains the plant models; `siteframe.py` holds the plant ↔ site ↔ scene conversions, pinned by golden vectors built from Cowork's KIPIC register; `builders/` holds the registry (`base.py`), shared geometry (`geom.py`), the palette and the fallback family; `gltf_instancing.py` is a `buffer_postprocessor` for trimesh's GLB exporter. The contract is complete in one commit; unbuilt operations answer 501 from `stubs_plant.py` until their unit lands.

**Tech Stack:** FastAPI, Pydantic 2, SQLAlchemy 2 + Alembic (per-project SQLite), trimesh 4.12, shapely 2.1, numpy, pyproj 3.7, pytest + schemathesis; openapi-typescript 7, Spectral; React/TS (type touches only). No new packages.

**Spec:** `docs/superpowers/specs/2026-10-03-plant-model-generator-design.md` (with §15 amendments). **Index (binding):** `docs/superpowers/plans/2026-10-03-plant-model.md`. Read both.

**Unit:** F0. **Worktree:** `.claude/worktrees/pm-f0`, branch `task/pm-f0`. **Cut after:** `main` containing artifact-port P1's migration `0016_asset_findings`. This plan was written against `task/af-int`'s 0016 (`E:\Dev\Yolo\app\.claude\worktrees\af-int\backend\app\db\migrations\versions\0016_asset_findings.py`, read-only). **Merge position:** first (batch 1); every other G1 unit is cut after F0 merges.

### Interfaces provided (exact)

Backend, `app/asset_models/spec.py` (index "Backend: spec", verbatim names):
```python
MAX_ITEMS = 20_000; MAX_ENV = 2_000
ItemId; HeightSource = Literal["drawing", "cloud", "indicative"]; EnvKind; FlagCode
class SiteCrs, Datum, CloudDatum, SiteFrame, RectFootprint, CircleFootprint, PolygonFootprint, LineFootprint
Footprint  # Annotated union, discriminator "kind"
class ItemFlag, Item, EnvFeature
class AssetSpec: ... site: SiteFrame | None = None; items: list[Item] = []; environment: list[EnvFeature] = []
class Source: kind gains "operator" (needs no id); gains page: int | None (1..10000)
```
`app/asset_models/siteframe.py`:
```python
class GridError(Exception)
class PlantGrid:
    frame: SiteFrame                                   # the frame it was built from
    def __init__(self, frame: SiteFrame)
    def plant_to_site(self, e, n) -> tuple[np.ndarray, np.ndarray]
    def site_to_plant(self, x, y) -> tuple[np.ndarray, np.ndarray]
    def plant_to_scene(self, e, n, el) -> np.ndarray   # (..., 3): x = N, y = EL - datum, z = E
    def scene_to_plant(self, xyz) -> tuple[np.ndarray, np.ndarray, np.ndarray]
    def site_to_lonlat(self, x, y) -> tuple[np.ndarray, np.ndarray]   # GridError without a usable CRS
    def convergence_deg(self) -> float  # true bearing of grid north; plant north true bearing = plant_north_deg + this
def fit_plant_grid(pairs) -> tuple[tuple[float, float], float, float]   # (origin_crs, plant_north_deg, rms_m)
def footprint_ref(fp: Footprint) -> tuple[float, float]
def footprint_polygon(fp: Footprint) -> np.ndarray  # (k, 2) plant [E, N], CCW, not closed; ValueError for a line of no length
CIRCLE_SEGMENTS = 64
```
`contract/fixtures/plant-grid-vectors.json`: top-level `frame` `{crs: {epsg: 32639, wkt: null}, origin_crs, plant_north_deg, datum: {label, el_m}}`, `rows` (50 × `{node, plant_E, plant_N, site_X, site_Y}`), `scene` (5 × `{plant_E, plant_N, el, x, y, z}`), `tolerance_m: 0.05`.

`app/asset_models/builders/` (`__init__.py`, `base.py`, `geom.py`, `palette.py`, `fallback.py`):
```python
# base.py
Family; FAMILY_ORDER = ("structure", "equipment", "building", "civil", "environment", "fallback")
FAMILY_MODULES = ("structure", "equipment", "building", "civil", "environment")  # module OR package
PLANNED_TYPES: dict[str, str]          # the 47 G1 types (45 + other + composite) -> family
class Params(BaseModel)                # extra="forbid", allow_inf_nan=False; every field needs a default
@dataclass(frozen=True) class Instanced: mesh: trimesh.Trimesh; transforms: np.ndarray  # (N, 4, 4)
@dataclass class MeshNode: name: str; material: str; geometry: trimesh.Trimesh | Instanced; extras: dict = {}
@dataclass(frozen=True) class BuildCtx:
    grid: PlantGrid | None; lod: float = 1.0
    def local(self, item, e, n) -> np.ndarray          # (..., 2) item-local [x north, z east]
    def height(self, item, default_m) -> tuple[float, float, bool]   # (base_el, top_el, defaulted)
@dataclass(frozen=True) class BuilderDef: type; family; params; fn; doc; default_height_m
REGISTRY: dict[str, BuilderDef]
def builder(type, *, family, params, doc, default_height_m) -> Callable
def build_item(item, ctx) -> tuple[list[MeshNode], list[ItemFlag]]   # never raises
def typed_params(item) -> BaseModel; def defaulted_params(item) -> list[str]
def catalogue() -> list[dict]; def load_all() -> None
# geom.py
segments_for(r, chord_err=0.02) -> int; yaw(deg) -> 4x4; place(x, y, z, yaw_deg=0.0) -> 4x4
box(w, l, h); cyl(r, h, segments=None); extrude(poly2d, h); beam(p0, p1, section=(w, h))
ring_polyline(pts2d, y, r, closed=True, segments=6); instanced_cyl(r, h, xforms) -> Instanced
# palette.py
PALETTE: dict[str, tuple[RGBA, float, float]]  # Cowork's 34, verbatim; BLEND; DOUBLE_SIDED
DEFAULT_MATERIAL = "Equipment_Grey"; M1_MATERIAL: dict[str, str]; material(name) -> PBRMaterial
# fallback.py
footprint_body(item, ctx, *, material=..., default_height_m=3.0) -> list[MeshNode]
last_resort(item, ctx) -> list[MeshNode]; OtherParams; CompositeParams; build_other; build_composite
```
`app/asset_models/gltf_instancing.py` (the instancing ruling, for A1):
```python
INSTANCING = "EXT_mesh_gpu_instancing"
def decompose(transforms) -> tuple[np.ndarray, np.ndarray, np.ndarray]   # t (N,3), q xyzw (N,4), s (N,3) float32
def instancing_postprocessor(instances: dict[str, np.ndarray]) -> Callable[[dict, dict], None]
def export_glb_instanced(scene: trimesh.Scene, instances: dict[str, np.ndarray]) -> bytes
```
`app/asset_models/validate.py`: `ASYNC_VALIDATE_ITEMS = 200`, `FALLBACK_CODES = {"invalid_params", "bad_footprint"}`, `MAX_LISTED = 500`, `Report.blocking`, `Report.ok` (no blocking errors), `is_large(spec)`, `as_dicts(issues)`, `validation_meta(report) -> {errors, error_count, warnings, warning_count}`. Issue codes: blocking `duplicate_item_id`, `unknown_type`, `bad_heights`, `duplicate_env_id` (+ M1 part codes, item parts as `"<item>/<part>"`); non-blocking errors `invalid_params`, `bad_footprint`; warnings `builder_missing`, `overlap`, `assumed_high_confidence`, `item_flags`.
`app/asset_models/service.py`: `version_warnings(row, spec) -> list[dict]`. `app/asset_models/jobs_glb.py`: large specs validated in the job, report in `meta["validation"]`.
`app/asset_models/schemas.py`: `AssetModelOut.kind`, `AssetModelCreate.kind` (default `"asset"`), `AssetModelRunPackagesOut {total, done, failed, running}`, `AssetModelRunStageUsageOut {input_tokens, output_tokens, images, calls}`, `AssetModelRunUsageByStageOut {current: str, stages: dict[str, AssetModelRunStageUsageOut], cost_estimate_usd: float | None, cost_label: str}`, `AssetModelRunOut.{packages, usage_by_stage}` and `AssetModelRunOut.of(row, packages=None)` (reads `row.usage["by_stage"]`), `AssetModelRunLimits {max_tokens, max_images, max_seconds, parallel}`, `AssetModelRunStart.{mode (4 values), sources (1..200), package_ids, limits}`.
`app/asset_models/schemas_plant.py`: `AssetBuilderTypeOut`, `AssetModelCatalogueOut`, `AssetItemRowOut(.of)`, `AssetItemPageOut`, `SiteModelPackageOut(.of)`, `SiteModelPackageListOut`, `SiteScene*Out`, `SiteSceneOut`.
`app/asset_models/stubs_plant.py`: `A1_STUBS`, `R1_STUBS`, `S1_STUBS`, `I1_STUBS`, `STUBS`, `router`, `drawings_router`, `stub_operation_ids()`. `app/asset_models/catalogue_router.py`: `router` (`GET /asset-models/catalogue`, live).
`app/db/models.py`: `AssetModel.kind`, `AssetItem`, `SiteModelPackage`, `SITE_MODEL_PACKAGE_STATE_CHECK`. Migration `0017` (`down_revision = "0016"`).
Contract: every operation and schema in "Contract additions" (index) — names in Task 9.

### Interfaces consumed (all on `main` after P1's 0016)
- M1: `app.asset_models.spec._Strict, Pt2, Pos, Part, Source, Confidence, MAX_PARTS, Material`; `app.asset_models.build.build_meshes(spec) -> dict[str, Trimesh]`, `build_glb`, `inject_node_extras`; `app.asset_models.placement.part_transform`; `app.asset_models.shapes.build_shape`; `app.asset_models.service.parse_spec, add_version, issues`; `app.asset_models.store.get_model, get_version`.
- Shared: `app.stubs.add_stubs(router, stubs, project_scoped=True)`; `app.errors.AppError`; `app.projects.service.get_project`; `app.jobs.cancellation.JobFailure`; `app.jobs.registry.register_job_type`.
- P1: migration `0016` (revision id `"0016"`), `AssetModel.frame`/`review` columns (never written by F0).
- trimesh: `trimesh.exchange.gltf.export_glb(scene, buffer_postprocessor=fn)` — `fn(buffer_items: OrderedDict, tree: dict)` runs after meshes are written and before buffer views are laid out (trimesh 4.12.2, verified).

### Budget
- **Background jobs:** `asset_model_glb` (existing) now also validates a spec of more than 200 items + environment features before building. No new job type.
- **Bounded reads:** no new read touches images, clouds or drawings. `validate()` is O(n log n) over footprints (shapely `STRtree` per type; 2 000 items in about 0.1 s). The version detail route parses the stored spec (≤ 20 000 items by schema) but never validates a large one; it reads the job's stored report (≤ 500 issues listed). The catalogue route returns the registered builders (tens).
- **No route blocks** on validation over 200 items (spec §5 "Size", index "Jobs").

### Shared-file touches (outside `app/asset_models/`)
| File | Anchor | Additive change |
| --- | --- | --- |
| `contract/openapi.yaml` | before `  /api/v1/brands:`; after the `assetModelRunId` parameter; before `    # ----- asset findings (spec 2026-10-02-asset-findings §5, §8; ...` | new paths, `assetItemId` parameter, new schemas; plus field additions to `AssetModel`, `AssetModelCreate`, `AssetPartSource`, `AssetSpec`, `AssetModelVersion.meta` (description), `AssetModelRun`, `AssetModelRunStart` |
| `contract/client/schema.d.ts` | generated | `pnpm -C contract generate` |
| `contract/client/index.ts` | after `export type AssetModelRunStart = Schemas["AssetModelRunStart"];` | type aliases for the new schemas |
| `contract/fixtures/plant-grid-vectors.json` | new | golden vectors |
| `backend/app/api.py` | after `"app.asset_models.runs",`; the maps-group loop's first entry and body | two module lines; `module:attr` entries; the drawings stub line |
| `backend/app/db/models.py` | `AssetModel` after `review`; before `class MapMeasurement(Base):` | `kind`; `AssetItem`, `SiteModelPackage` |
| `backend/app/db/migrations/versions/0017_plant_model.py` | new | migration |
| `backend/tests/test_contract.py` | imports; after `EXPECTED_STUBS |= brands_stub_operation_ids()` | `EXPECTED_STUBS |= plant_stub_operation_ids()` |
| `backend/scripts/plant_grid_vectors.py` | new | golden vector writer |
| `backend/tests/data/plant/` | new | `kipic_register.csv`, `kipic_landmask.json`, `README.md` |
| `.gitignore` | after `backend/tests/data/asset_models/*.pdf` | `backend/tests/data/plant/*.glb` (exactly this pattern) |
| `frontend/src/assetmodels/run/RunTab.tsx` | `const MODE: Record<RunMode, string>` | labels for the two plant modes |
| `frontend/src/test/*Fixtures.ts`, `frontend/e2e/fixtures/assetModels.ts` | every `AssetModel` object literal | `kind: "asset"` |

M1 files changed inside the package: `spec.py`, `validate.py`, `service.py`, `jobs_glb.py`, `router.py`, `runs.py`, `schemas.py`.

### Tests
Added: `backend/tests/test_plant_fixtures.py`, `test_plant_spec.py`, `test_plant_siteframe.py`, `test_migration_0017.py`, `test_builders_geom.py`, `test_builders_base.py`, `test_gltf_instancing.py`, `test_plant_validate.py`, `test_plant_contract.py`, `test_plant_api.py`. Changed: `backend/tests/test_contract.py` (one `EXPECTED_STUBS` line). Frontend: fixtures only.

### Gate (Task 11)
```
pnpm -C contract check
cd backend; E:\Dev\Yolo\app\backend\.venv\Scripts\python.exe -m ruff check .; E:\Dev\Yolo\app\backend\.venv\Scripts\python.exe -m ruff format --check .; E:\Dev\Yolo\app\backend\.venv\Scripts\python.exe -m pytest
pnpm -C frontend lint
pnpm -C frontend test
pnpm -C frontend build
pnpm -C frontend e2e   # on F0's port range
cargo test --manifest-path frontend/src-tauri/Cargo.toml   # only if frontend/src-tauri/binaries/kestrel-backend-*.exe exists
```

## Global Constraints

The index's Global Constraints are law; these are the lines F0's tasks touch, verbatim in substance:
- `contract/openapi.yaml` is the source of truth. `contract/client/schema.d.ts` is regenerated with `pnpm -C contract generate` and committed in the same commit, never hand-edited. `oas3-unused-component` is an error. Nullable types use `type: [X, "null"]`. Path parameter names match the contract literally: `projectId`, `assetModelId`, `version`, `runId`, `itemId`.
- **F0 owns the contract.** Every contract operation is routed (`backend/tests/test_contract.py`). New operations are 501 stubs in `app/asset_models/stubs_plant.py` until the owning unit lands.
- **Migration 0017 is additive only:** new tables `asset_item` and `site_model_package`; `ALTER TABLE asset_model ADD COLUMN kind`. No batch rebuild of `asset_model`, `asset_model_version` or `finding`; P1's `0016` owns those. Never drop P1's columns. F0 never writes `asset_model.frame`.
- Spec item coordinates are plant metres; M1 part params stay millimetres. Scene/GLB frame: metres, `x = plant_N`, `y = EL - datum.el_m`, `z = plant_E`. Site CRS: `[X, Y] = origin_crs + R(plant_north_deg)·[E, N]`, `R(θ) = [[cos θ, sin θ], [-sin θ, cos θ]]`; all 878 KIPIC rows within 0.05 m (verified 0.01 m); F0's golden test is the arbiter.
- A builder never raises to the assembler: `build_item` catches and falls back to `other` with a `builder_fallback` flag. Builders are pure: no DB, no I/O, deterministic.
- No route blocks on validation over 200 items. Logs carry tool names, states, durations and counts only; issue messages never echo input values.
- No new Python or frontend packages. Never install into the shared venv. Backend interpreter `E:\Dev\Yolo\app\backend\.venv\Scripts\python.exe`, run from `<worktree>\backend`.
- UI copy is sentence case (the two RunTab labels).
- Stage files by path; never `git add -A`; never `git stash`. Commits end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Identity "Danijel Jovanovic" / info@synapse-solutions.ai.

## Review Focus

The index names no Review Focus line for F0. These five inputs are the ones most likely to bite the operator through F0's code; each has its test in the named task.
1. **An M1 spec saved before G1** (no `site`, `items` or `environment` keys) must load, validate and build exactly as before, and its version detail must show the same warnings. Task 2 `test_an_m1_spec_round_trips_unchanged`; Task 8 `test_an_m1_spec_reports_as_before`.
2. **A plant spec of more than 200 items with one blocking error** must not stall the request: the version is created (201), its GLB job fails, and the version shows the error. Task 8 `test_a_large_spec_is_validated_in_its_glb_job`.
3. **A crossing, flat or zero-length footprint** must never crash the fallback: `other` builds something finite. Task 6 `test_other_builds_something_for_any_footprint`.
4. **`GET /drawings/unimported`** must reach its own handler, not `GET /drawings/{drawingId}` (which would answer 404 for "unimported"). Task 10 `test_unimported_is_not_taken_for_a_drawing_id`.
5. **Upgrading to 0017, or downgrading from it,** on a project with asset models must keep every version and run (a rebuild of `asset_model` would cascade them away). Task 4 `test_0017_downgrades_to_0016_and_keeps_every_version_and_run`, `test_a_project_at_0016_upgrades_keeps_its_rows_and_defaults_kind`.

## Rulings

1. **Contract names.** The contract already has `SiteFrame` (the map workspace frame) and `Source`. The plant grid's contract schemas are `PlantFrame`, `PlantCrs`, `PlantDatum`, `PlantCloudDatum`, `PlantPoint`; the Python model stays `spec.SiteFrame` (index name). The Site 3D manifest's frame is `SiteSceneFrame`. Item and site sources reuse `AssetPartSource`.
2. **`Source` widens** (Python and `AssetPartSource`): `kind` gains `operator` (no id needed; the index's `SiteFrame.source` kinds are drawing | assumed | operator), and `page: int | null` (1..10000) is added. Additive: every M1 source stays valid.
3. **Planned vs unknown types.** `base.PLANNED_TYPES` lists the 47 G1 types. A planned type without a registered builder is a *warning* (`builder_missing`) and builds as `other` with a `builder_fallback` flag; a type in neither `PLANNED_TYPES` nor `REGISTRY` is a blocking error (`unknown_type`). This lets the builder units merge in any order (index DAG) while unknown types still fail.
4. **Item problems the GLB survives** (`invalid_params`, `bad_footprint`) are reported in `Report.errors` but are not blocking (`FALLBACK_CODES`); `Report.ok` means "no blocking errors". Spec §5 lists them as errors and §6 says one bad item never fails the GLB; this satisfies both and index Review Focus 4 (A1). M1 part errors stay blocking, so M1 behaviour is unchanged. The version detail shows the non-blocking errors under `warnings`.
5. **Blocking errors:** `duplicate_item_id`, `unknown_type`, `bad_heights` (`top_el < base_el`), `duplicate_env_id`, and M1 part errors inside an item's `parts` (ids `"<item>/<part>"`). An environment feature whose outline crosses itself is `bad_footprint` (non-blocking; B3's env builder skips it).
6. **"Over 20 000 items" is a schema error** (`AssetSpec.items` `max_length=MAX_ITEMS`, contract `maxItems: 20000`), answered 422 `invalid_spec` by `parse_spec`. `environment` is capped at 2 000, an env outline at 5 000 points.
7. **Large spec = `len(items) + len(environment) > 200`.** Its request path is schema-only; the GLB job validates, stores `meta["validation"] = {errors, error_count, warnings, warning_count}` (≤ 500 listed each), and fails the version on blocking errors. A1, when it swaps `build_glb` for `assemble_glb`, keeps this block and the `meta["validation"]` merge.
8. **Run fields without run columns.** 0017 adds no `asset_model_run` columns (index: 0017 is exactly two tables and `kind`). R1 keeps `usage_by_stage` (R1's binding shape: `{current, stages: {<stage>: {input_tokens, output_tokens, images, calls}}, cost_estimate_usd, cost_label}`, contract `AssetModelRunUsageByStage`) in `run.usage["by_stage"]`; `AssetModelRunOut.of` validates it into the response and answers null when it is absent or malformed. `packages` counts come from `site_model_package` rows, passed in by R1 (`AssetModelRunOut.of(row, packages=...)`). R1 may keep the run's `limits` in `run.usage["limits"]`. The current stage is `usage_by_stage.current` (no separate field). `AssetModelRunStart.sources` rises from 50 to 200 (R1's binding: a plant run takes every page).
9. **`site_model_package` carries R1's resume state:** `expected` (tags), `attempts` (a package interrupted twice is failed — index Review Focus 3), `items` (the done package's draft item dumps), plus the spec's columns. Unique `(run_id, n)`.
10. **An item's GLB node name equals its item id** (coordinator ruling; S1/S3 pick on it). `asset_item.node` and `AssetItemRow.node` are that id; `getAssetModelItem`'s `itemId` is the item id.
11. **Palette factors are Cowork's glTF `baseColorFactor` verbatim** (no sRGB→linear step, unlike M1's `_lin`). trimesh stores colour factors as 8-bit, so the written factor is within 1/255.
12. **Instancing:** A1 writes `EXT_mesh_gpu_instancing` with `gltf_instancing.export_glb_instanced(scene, {node_name: transforms})`, a trimesh `buffer_postprocessor` (verified with trimesh 4.12.2: accessors land in the BIN chunk, `inject_node_extras` keeps the extension, trimesh reloads the file, 1 000 instances are under a fifth of the merged size). Mirrored, flat or sheared instance transforms are refused (`ValueError`); `build_item` refuses mirrored ones too.
13. **Catalogue order** is `FAMILY_ORDER` then type; it lists registered builders only (the live list, spec §15).
14. **Plant run modes are refused until R1:** `startAssetModelRun` with `plant`/`plant_package` answers 422 `plant_run_unavailable` (already an allowed refusal in `REFUSES_VALID_DATA`). R1 deletes the refusal. The code is not named in the contract.
15. **Drawing stubs mount before `app.drawings.router`** through a `module:attr` entry in the maps-group loop of `app/api.py`. I1 keeps `/drawings/unimported` and `/drawings/pages` ahead of `/drawings/{drawingId}` when it routes them.
16. **`AssetModelCreate` gains `kind`** (optional, default `asset`), so S3/R1 can create a plant model; `AssetModel.kind` is required in responses. `kind` is not patchable.
17. **`BuildCtx.height`:** a missing `base_el` is the datum (grade), or 0 without a grid; a missing `top_el`, or one not above the base, is `base + default_m`; `defaulted` is true when either was filled. `BuildCtx.local` returns `[x north, z east]` relative to `footprint_ref`.
18. **Footprint rings** are counter-clockwise in plant [E, N]; a rect's `along` axis points `rot_deg` clockwise from plant north; a circle is a 64-gon; a line is buffered with flat ends and mitred corners.
19. **`convergence_deg()`** is the true bearing of grid north at the origin (clockwise from true north): −1.2583° at KIPIC, so plant north's true bearing is 17.9991 − 1.2583 = 16.7408° (spec §9's `plant_north_deg + convergence`).
20. **Golden vectors** add `node`, `scene`, `formula`, `tolerance_m` keys beyond the index's `{plant_E, plant_N, site_X, site_Y}` + `frame` (S1's binding keys are present and unchanged).
21. **`geom.py` adds `yaw` and `place`** to the index's helper list (both are needed by every family to rotate by `rot_deg` and to build instance transforms). `ring_polyline(pts2d, y, r, closed=True, segments=6)` is a round bar along a plan polyline (handrails, rings). Family modules may be packages (B2's `builders/equipment/`); F0 creates no family module.
22. **Builder params** must subclass `base.Params` and have a default for every field (checked at registration), matching spec §6 "each param schema has defaults".

## Deviations (code or index over spec)
- Spec §6 says `BuildCtx` carries the palette and a triangle budget; the index's `BuildCtx` (grid, lod) is followed. Builders import the palette.
- Spec §7 meshopt lines are replaced by §15 (no meshopt in G1).
- Spec §5 shows `Item.type` as "one of the builder catalogue"; §15 and the index make it a free string checked by `validate()`.
- Spec §8.1 scans `Drawings/`; the index's broader scan (depth 3) is what the contract describes (I1 implements).

## Execution DAG

Units of work inside F0 and their dependencies:
```
T1 fixtures ─┬─ T2 spec ─┬─ T3 siteframe ─┬─ T5 geom+palette ─┬─ T6 registry+fallback ─┬─ T8 validate ──┐
             │           │                │                   └─ T7 instancing         │               │
             │           └─ T9 contract ──┼─────────────────────────────────────────────┴─ T10 routes ─┴─ T11 gate
             └─ T4 migration (needs 0016 on main) ────────────────────────────────────────┘
```
- **Parallel batches** (if several implementers share the worktree in turn): {T2, T4}; {T3, T9}; {T5}; {T6, T7}; {T8}; {T10}; {T11}.
- **Critical path:** T1 → T2 → T3 → T5 → T6 → T8 → T10 → T11.
- Between T9 and T10, `tests/test_contract.py` is red (the contract is ahead of the routes). T9 runs only its own tests; T10 turns it green.

## File structure

```
backend/app/asset_models/
  spec.py              (modify) plant models after AssetInfo; AssetSpec gains site/items/environment
  siteframe.py         (create) PlantGrid, fit_plant_grid, footprint_ref, footprint_polygon, GridError
  builders/__init__.py (create) docstring only
  builders/base.py     (create) registry, Params, MeshNode, Instanced, BuildCtx, build_item, catalogue, load_all
  builders/geom.py     (create) shared mesh helpers
  builders/palette.py  (create) Cowork's 34 materials
  builders/fallback.py (create) other, composite, footprint_body, last_resort
  gltf_instancing.py   (create) EXT_mesh_gpu_instancing post-processor
  validate.py          (modify) Report.blocking, plant checks, is_large, validation_meta
  service.py           (modify) schema-only request path for large specs; version_warnings
  jobs_glb.py          (modify) validate large specs in the job
  router.py            (modify) create kind; detail warnings via version_warnings
  runs.py              (modify) refuse plant modes until R1
  schemas.py           (modify) kind, run modes/limits/stage/packages/usage_by_stage
  schemas_plant.py     (create) response models for catalogue, items, packages, site scene
  catalogue_router.py  (create) GET /asset-models/catalogue (live)
  stubs_plant.py       (create) 501 stubs per unit
backend/app/db/models.py, backend/app/db/migrations/versions/0017_plant_model.py
backend/app/api.py, backend/scripts/plant_grid_vectors.py, backend/tests/data/plant/*
contract/openapi.yaml, contract/client/{schema.d.ts,index.ts}, contract/fixtures/plant-grid-vectors.json
frontend/src/assetmodels/run/RunTab.tsx, frontend/src/test/*Fixtures.ts, frontend/e2e/fixtures/assetModels.ts
```

All commands below run in PowerShell from the worktree root `E:\Dev\Yolo\app\.claude\worktrees\pm-f0` unless a step says `backend`. `$py` means `E:\Dev\Yolo\app\backend\.venv\Scripts\python.exe`; run backend commands as `cd backend; & $py -m pytest ...` after `$py = "E:\Dev\Yolo\app\backend\.venv\Scripts\python.exe"`.

---

### Task 1: Base, worktree check and the KIPIC fixtures

**Files:**
- Create: `backend/tests/data/plant/kipic_register.csv` (copy), `backend/tests/data/plant/kipic_landmask.json` (copy), `backend/tests/data/plant/README.md`
- Modify: `.gitignore` (after `backend/tests/data/asset_models/*.pdf`)
- Test: `backend/tests/test_plant_fixtures.py`

**Interfaces:**
- Consumes: the reference data in `E:\Dev\Yolo\app\.superpowers\sdd\pm-common\kipic\` (read-only, git-ignored).
- Produces: `backend/tests/data/plant/kipic_register.csv` (885 rows, Cowork's 17 columns) and `kipic_landmask.json` for Tasks 3 and K1/C1; the git-ignored `backend/tests/data/plant/KIPIC_AlZour_LNG_Plant.glb` for Task 5's palette test and the builder units.

- [ ] **Step 1: Confirm the worktree, the branch and P1's 0016 on main**

```powershell
git rev-parse --show-toplevel          # E:/Dev/Yolo/app/.claude/worktrees/pm-f0
git rev-parse --abbrev-ref HEAD        # task/pm-f0
git ls-tree --name-only main backend/app/db/migrations/versions/ | Select-String 0016
```
Expected: the first two lines as shown; the third prints `backend/app/db/migrations/versions/0016_asset_findings.py`.
If 0016 is **not** on main yet: this plan was written against `task/af-int`'s 0016. Tasks 2, 3, 5, 6, 7 and 9 do not touch the migration chain and may proceed; report `WAITING: 0016` for Tasks 4, 8, 10 and 11. Once the coordinator says 0016 landed, commit any work in progress (never stash), then **rebase onto main once 0016 lands**: `git rebase main`, and continue with Task 4.
Also confirm `git log --oneline -1 main -- contract/openapi.yaml` includes P1's contract (it has `AssetFrame`): `Select-String -Path contract/openapi.yaml -Pattern "^    AssetFrame:"` prints one line.

- [ ] **Step 2: Make sure the worktree's node packages exist (not the venv)**

```powershell
if (-not (Test-Path frontend/node_modules)) { pnpm -C frontend install --frozen-lockfile }
if (-not (Test-Path contract/node_modules)) { pnpm -C contract install --frozen-lockfile }
```
Expected: nothing, or pnpm's "Done". Never install anything into `E:\Dev\Yolo\app\backend\.venv`.

- [ ] **Step 3: Write the failing fixture test**

Create `backend/tests/test_plant_fixtures.py`:
```python
"""The KIPIC reference fixtures (spec 2026-10-03-plant-model-generator §13; plan pm-f0 Task 1)."""

import csv
import json
from pathlib import Path

DATA = Path(__file__).parent / "data" / "plant"
COWORK_COLUMNS = [
    "node", "tag", "name", "type", "area", "group", "plant_E", "plant_N", "utm39_E", "utm39_N",
    "base_EL", "height_m", "top_EL", "height_source", "has_geometry", "source_sheet", "notes",
]  # fmt: skip


def test_the_register_is_cowork_s_885_rows():
    with (DATA / "kipic_register.csv").open(encoding="utf-8", newline="") as f:
        reader = csv.DictReader(f)
        rows = list(reader)
    assert reader.fieldnames == COWORK_COLUMNS
    assert len(rows) == 885
    assert sum(1 for r in rows if r["plant_E"] and r["utm39_E"]) == 878
    assert sum(1 for r in rows if r["tag"]) == 404
    assert len({r["type"] for r in rows}) == 46


def test_the_landmask_holds_closed_outlines():
    mask = json.loads((DATA / "kipic_landmask.json").read_text("utf-8"))
    assert set(mask) == {"land", "main"}
    for rings in mask.values():
        assert rings and all(len(ring) >= 3 and all(len(p) == 2 for p in ring) for ring in rings)
```

- [ ] **Step 4: Run it to see it fail**

Run: `cd backend; & $py -m pytest tests/test_plant_fixtures.py -q`
Expected: 2 failed (`FileNotFoundError` for `kipic_register.csv` and `kipic_landmask.json`).

- [ ] **Step 5: Copy the fixtures and ignore the GLB**

```powershell
$k = "E:\Dev\Yolo\app\.superpowers\sdd\pm-common\kipic"
New-Item -ItemType Directory -Force backend\tests\data\plant | Out-Null
Copy-Item "$k\KIPIC_AlZour_Asset_Register.csv" backend\tests\data\plant\kipic_register.csv
Copy-Item "$k\landmask.json" backend\tests\data\plant\kipic_landmask.json
Copy-Item "$k\KIPIC_AlZour_LNG_Plant.glb" backend\tests\data\plant\KIPIC_AlZour_LNG_Plant.glb   # git-ignored, local only
```
In `.gitignore`, after the line `backend/tests/data/asset_models/*.pdf`, add exactly (the coordinator's ruling: never the whole folder; B1–B3 commit `cowork_nodes/` and `golden/` under it):
```
# The Cowork plant GLB (26 MB) for the plant model tests; fetched locally, never committed
backend/tests/data/plant/*.glb
```
Create `backend/tests/data/plant/README.md`:
```markdown
# KIPIC Al-Zour plant fixtures

Reference data for the plant model generator (spec 2026-10-03-plant-model-generator §13).

| File | Source | Tracked |
| --- | --- | --- |
| `kipic_register.csv` | Cowork's "Al-Zour LNG Plant Model" artifact, `KIPIC_AlZour_Asset_Register.csv` (885 rows, 878 with coordinates, 404 tags, 46 types) | yes |
| `kipic_landmask.json` | the same artifact's `landmask.json` (`land` and `main` outlines) | yes |
| `KIPIC_AlZour_LNG_Plant.glb` | the same artifact's GLB (26 MB, 34 materials) | no (`.gitignore`); copy it from `.superpowers/sdd/pm-common/kipic/` or set `KESTREL_KIPIC_DIR` |

`contract/fixtures/plant-grid-vectors.json` is written from `kipic_register.csv` by `backend/scripts/plant_grid_vectors.py`.
```

- [ ] **Step 6: Run the test to see it pass, and check the GLB is ignored**

Run: `cd backend; & $py -m pytest tests/test_plant_fixtures.py -q; cd ..; git check-ignore -v backend/tests/data/plant/KIPIC_AlZour_LNG_Plant.glb; git check-ignore backend/tests/data/plant/kipic_register.csv; $LASTEXITCODE`
Expected: `2 passed`; the GLB line names `.gitignore`; the CSV is not ignored (`1`).

- [ ] **Step 7: Commit**

```powershell
git add .gitignore backend/tests/data/plant/kipic_register.csv backend/tests/data/plant/kipic_landmask.json backend/tests/data/plant/README.md backend/tests/test_plant_fixtures.py
git commit -m "test(plant): KIPIC register and landmask fixtures" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: The plant spec models

**Files:**
- Modify: `backend/app/asset_models/spec.py` (`Source`; a new block between `class AssetInfo` and `class AssetSpec`; `AssetSpec`)
- Test: `backend/tests/test_plant_spec.py`

**Interfaces:**
- Consumes: M1's `_Strict`, `Pt2`, `Pos`, `Part`, `Source`, `Confidence`, `MAX_PARTS`.
- Produces: `MAX_ITEMS`, `MAX_ENV`, `ItemId`, `HeightSource`, `EnvKind`, `FlagCode`, `SiteCrs`, `Datum`, `CloudDatum`, `SiteFrame`, `RectFootprint`, `CircleFootprint`, `PolygonFootprint`, `LineFootprint`, `Footprint`, `ItemFlag`, `Item`, `EnvFeature`; `AssetSpec.site/items/environment`; `Source.kind` gains `"operator"`, `Source.page`.

- [ ] **Step 1: Write the failing tests**

Create `backend/tests/test_plant_spec.py`:
```python
"""The plant spec models (spec 2026-10-03-plant-model-generator §5; plan pm-f0 Task 2)."""

import math

import pytest
from pydantic import ValidationError

from app.asset_models.spec import MAX_ITEMS, AssetSpec, Item, SiteFrame

M1_SPEC = {
    "asset": {"tag": "710-D-130335"},
    "parts": [
        {
            "id": "shell",
            "name": "Shell",
            "group": "Shell",
            "shape": "cylinder",
            "params": {"id": 4000, "thickness": 8, "height": 8000},
            "source": {"kind": "drawing", "id": "d1", "region": [0.1, 0.1, 0.4, 0.3]},
        }
    ],
}
FRAME = {
    "crs": {"epsg": 32639},
    "origin_crs": [244338.089, 3179515.690],
    "plant_north_deg": 17.9991,
    "datum": {"label": "HPFS", "el_m": 100.0},
    "source": {"kind": "drawing", "id": "d-t0003", "page": 1},
}


def item(**over) -> dict:
    base = {
        "id": "20-T-0001",
        "tag": "20-T-0001",
        "name": "LNG storage tank",
        "type": "tank_lng",
        "area": "20",
        "footprint": {"kind": "circle", "center": [1326.0, 520.0], "d": 92.0},
        "base_el": 104.5,
        "top_el": 151.0,
        "height_source": "drawing",
        "source": {"kind": "drawing", "id": "d-t0006", "page": 1, "region": [0.2, 0.2, 0.5, 0.5]},
        "confidence": "high",
    }
    base.update(over)
    return base


def test_an_m1_spec_round_trips_unchanged():
    """Review Focus 1: a pre-G1 spec has no site, items or environment and still loads as before."""
    spec = AssetSpec.model_validate(M1_SPEC)
    assert spec.site is None and spec.items == [] and spec.environment == []
    again = AssetSpec.model_validate(spec.model_dump(mode="json"))
    assert again == spec
    assert again.parts[0].source.page is None


def test_a_plant_spec_round_trips():
    raw = {
        "site": FRAME,
        "items": [
            item(),
            item(
                id="rack-1",
                tag=None,
                type="pipe_rack",
                footprint={"kind": "line", "pts": [[1200, 400], [1400, 400]], "width": 8},
                params={"tiers": 2},
                flags=[{"code": "plan_offset", "value": 1.4}],
            ),
            item(id="b1", type="building", footprint={"kind": "rect", "center": [10, 20], "size": [30, 12]}),
            item(id="p1", type="paved", footprint={"kind": "polygon", "pts": [[0, 0], [10, 0], [10, 10]]}),
        ],
        "environment": [
            {
                "id": "sea",
                "kind": "sea",
                "pts": [[0, 0], [100, 0], [100, 100]],
                "el": 92.5,
                "source": {"kind": "assumed"},
            }
        ],
    }
    spec = AssetSpec.model_validate(raw)
    assert spec.site.datum.label == "HPFS" and spec.site.cloud_z_to_el is None
    assert [i.footprint.kind for i in spec.items] == ["circle", "line", "rect", "polygon"]
    assert spec.items[2].footprint.rot_deg == 0
    assert AssetSpec.model_validate(spec.model_dump(mode="json")) == spec


def test_an_operator_source_needs_no_id_and_other_sources_still_do():
    frame = SiteFrame.model_validate({**FRAME, "source": {"kind": "operator"}})
    assert frame.source.kind == "operator" and frame.datum.el_m == 100.0
    with pytest.raises(ValidationError, match="needs its id"):
        Item.model_validate(item(source={"kind": "drawing"}))


@pytest.mark.parametrize(
    "bad",
    [
        {"footprint": {"kind": "circle", "center": [math.nan, 0], "d": 5}},
        {"footprint": {"kind": "circle", "center": [0, 0], "d": 0}},
        {"footprint": {"kind": "rect", "center": [0, 0], "size": [5, -1]}},
        {"footprint": {"kind": "polygon", "pts": [[0, 0], [1, 1]]}},
        {"footprint": {"kind": "line", "pts": [[0, 0]], "width": 2}},
        {"footprint": {"kind": "hexagon", "center": [0, 0]}},
        {"id": "has space"},
        {"name": ""},
        {"type": ""},
        {"base_el": math.inf},
        {"flags": [{"code": "made_up"}]},
        {"height_source": "guess"},
        {"source": {"kind": "drawing", "id": "d1", "page": 0}},
        {"surprise": 1},
    ],
)
def test_bad_items_are_refused_by_the_schema(bad):
    with pytest.raises(ValidationError):
        Item.model_validate(item(**bad))


def test_item_type_is_a_free_string_in_the_schema():
    """Spec §15: the registry, not the schema, judges the type (validate() reports unknown ones)."""
    assert Item.model_validate(item(type="made_up_type")).type == "made_up_type"


def test_the_item_count_is_capped_by_the_schema():
    one = item(id="x")
    with pytest.raises(ValidationError, match="at most 20000"):
        AssetSpec.model_validate({"items": [one] * (MAX_ITEMS + 1)})
```

- [ ] **Step 2: Run them to see them fail**

Run: `cd backend; & $py -m pytest tests/test_plant_spec.py -q`
Expected: collection error, `ImportError: cannot import name 'MAX_ITEMS' from 'app.asset_models.spec'`.

- [ ] **Step 3: Widen `Source`**

In `backend/app/asset_models/spec.py`, find:
```python
class Source(_Strict):
    kind: Literal["drawing", "cloud", "photo", "assumed"]
    id: str | None = None
```
Replace with:
```python
class Source(_Strict):
    kind: Literal["drawing", "cloud", "photo", "assumed", "operator"]
    id: str | None = None
    page: int | None = Field(None, ge=1, le=10_000)
```
and find:
```python
        if self.kind != "assumed" and not self.id:
```
Replace with:
```python
        if self.kind not in ("assumed", "operator") and not self.id:
```

- [ ] **Step 4: Add the plant models**

Insert this block between the end of `class AssetInfo` (its `attributes:` line) and `class AssetSpec(_Strict):`, separated by two blank lines on each side:
```python
# ----- plant (spec 2026-10-03-plant-model-generator §5; plan 2026-10-03-plant-model-f0 Task 2) -----
# Plant metres: [E, N] in the drawing's plant grid, elevations as plant EL. M1 parts stay millimetres.

MAX_ITEMS = 20_000
MAX_ENV = 2_000

ItemId = Annotated[str, Field(pattern=r"^[A-Za-z0-9_.\-]{1,64}$")]
HeightSource = Literal["drawing", "cloud", "indicative"]
EnvKind = Literal["land", "sea", "road", "paved", "laydown", "slope", "revetment"]
FlagCode = Literal[
    "plan_offset",
    "height_mismatch",
    "missing_in_cloud",
    "unregistered",
    "builder_fallback",
    "straddles_package",
]


class SiteCrs(_Strict):
    epsg: int | None = Field(None, ge=1024, le=999_999)
    wkt: str | None = Field(None, max_length=20_000)


class Datum(_Strict):
    label: str = Field("EL", min_length=1, max_length=40)
    el_m: float = 0.0


class CloudDatum(_Strict):
    """plant EL = cloud z + offset_m (+ tilt · [dx, dy])."""

    cloud_id: str = Field(min_length=1, max_length=64)
    offset_m: float
    tilt: tuple[float, float] | None = None


class SiteFrame(_Strict):
    """The plant grid: [X, Y] = origin_crs + R(plant_north_deg)·[E, N], with R(θ) = [[cos θ, sin θ],
    [-sin θ, cos θ]] (siteframe.PlantGrid). Its contract schema is PlantFrame, because the map
    workspace's SiteFrame is another schema."""

    crs: SiteCrs
    origin_crs: tuple[float, float]
    plant_north_deg: float = Field(ge=-360, le=360)
    datum: Datum = Field(default_factory=Datum)
    cloud_z_to_el: CloudDatum | None = None
    source: Source


class RectFootprint(_Strict):
    """size = (along, across); the along axis points rot_deg clockwise from plant north."""

    kind: Literal["rect"]
    center: Pt2
    size: tuple[Pos, Pos]
    rot_deg: float = 0


class CircleFootprint(_Strict):
    kind: Literal["circle"]
    center: Pt2
    d: Pos


class PolygonFootprint(_Strict):
    kind: Literal["polygon"]
    pts: Annotated[list[Pt2], Field(min_length=3, max_length=500)]


class LineFootprint(_Strict):
    kind: Literal["line"]
    pts: Annotated[list[Pt2], Field(min_length=2, max_length=500)]
    width: Pos


Footprint = Annotated[
    RectFootprint | CircleFootprint | PolygonFootprint | LineFootprint, Field(discriminator="kind")
]


class ItemFlag(_Strict):
    code: FlagCode
    value: float | None = None
    note: str | None = Field(None, max_length=300)


class Item(_Strict):
    """One plant item. `type` is a builder type, checked by validate() against the registry, not by
    this schema (spec §15). `parts` are M1 parts in item-local millimetres: origin at the footprint's
    reference point (siteframe.footprint_ref) at base_el, Y up, X plant north, Z plant east."""

    id: ItemId
    tag: str | None = Field(None, max_length=80)
    name: Annotated[str, Field(min_length=1, max_length=200)]
    type: Annotated[str, Field(min_length=1, max_length=64)]
    area: str | None = Field(None, max_length=80)
    footprint: Footprint
    base_el: float | None = None
    top_el: float | None = None
    levels: Annotated[list[float], Field(max_length=50)] = Field(default_factory=list)
    params: dict[str, Any] = Field(default_factory=dict)
    height_source: HeightSource = "indicative"
    source: Source
    confidence: Confidence = "medium"
    flags: Annotated[list[ItemFlag], Field(max_length=20)] = Field(default_factory=list)
    parts: Annotated[list[Part], Field(max_length=MAX_PARTS)] = Field(default_factory=list)
    notes: str | None = Field(None, max_length=1000)


class EnvFeature(_Strict):
    id: ItemId
    kind: EnvKind
    pts: Annotated[list[Pt2], Field(min_length=3, max_length=5000)]
    el: float
    source: Source
    confidence: Confidence = "medium"
```

- [ ] **Step 5: Give `AssetSpec` its plant fields**

Find:
```python
class AssetSpec(_Strict):
    asset: AssetInfo = Field(default_factory=AssetInfo)
    parts: Annotated[list[Part], Field(max_length=MAX_PARTS)] = Field(default_factory=list)
```
Replace with:
```python
class AssetSpec(_Strict):
    asset: AssetInfo = Field(default_factory=AssetInfo)
    parts: Annotated[list[Part], Field(max_length=MAX_PARTS)] = Field(default_factory=list)
    site: SiteFrame | None = None
    items: Annotated[list[Item], Field(max_length=MAX_ITEMS)] = Field(default_factory=list)
    environment: Annotated[list[EnvFeature], Field(max_length=MAX_ENV)] = Field(default_factory=list)
```

- [ ] **Step 6: Run the new and the M1 spec tests**

Run: `cd backend; & $py -m pytest tests/test_plant_spec.py tests/test_asset_model_spec.py tests/test_asset_model_agent_tools.py tests/test_asset_models_api.py -q`
Expected: all pass (the M1 suites are unchanged: every new field is optional).

- [ ] **Step 7: Lint and commit**

```powershell
cd backend; & $py -m ruff check app/asset_models/spec.py tests/test_plant_spec.py; & $py -m ruff format --check app/asset_models/spec.py tests/test_plant_spec.py; cd ..
git add backend/app/asset_models/spec.py backend/tests/test_plant_spec.py
git commit -m "feat(plant): site, items and environment in the asset spec" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: The plant grid and its golden vectors

**Files:**
- Create: `backend/app/asset_models/siteframe.py`, `backend/scripts/plant_grid_vectors.py`, `contract/fixtures/plant-grid-vectors.json` (generated)
- Test: `backend/tests/test_plant_siteframe.py`

**Interfaces:**
- Consumes: Task 2's `SiteFrame`, `Footprint` and the footprint models; Task 1's `kipic_register.csv`.
- Produces: `PlantGrid` (with `.frame`), `fit_plant_grid`, `footprint_ref`, `footprint_polygon`, `GridError`, `CIRCLE_SEGMENTS`; the golden file S1's vitest pins.

- [ ] **Step 1: Write the failing tests**

Create `backend/tests/test_plant_siteframe.py`:
```python
"""The plant grid against the KIPIC register (spec 2026-10-03-plant-model-generator §5, §15; plan
pm-f0 Task 3). The golden file is contract/fixtures/plant-grid-vectors.json; S1's vitest reads it too."""

import csv
import json
import math
from pathlib import Path

import numpy as np
import pytest

from app.asset_models.siteframe import (
    CIRCLE_SEGMENTS,
    GridError,
    PlantGrid,
    fit_plant_grid,
    footprint_polygon,
    footprint_ref,
)
from app.asset_models.spec import (
    CircleFootprint,
    LineFootprint,
    PolygonFootprint,
    RectFootprint,
    SiteFrame,
)

ROOT = Path(__file__).resolve().parents[2]
REGISTER = Path(__file__).parent / "data" / "plant" / "kipic_register.csv"
VECTORS = ROOT / "contract" / "fixtures" / "plant-grid-vectors.json"
TOL_M = 0.05


def _frame(**over) -> SiteFrame:
    raw = {**json.loads(VECTORS.read_text("utf-8"))["frame"], "source": {"kind": "assumed"}, **over}
    return SiteFrame.model_validate(raw)


@pytest.fixture(scope="module")
def grid() -> PlantGrid:
    return PlantGrid(_frame())


@pytest.fixture(scope="module")
def register() -> list[dict]:
    with REGISTER.open(encoding="utf-8", newline="") as f:
        return [r for r in csv.DictReader(f) if r["plant_E"]]


def _cols(rows, *names):
    return [np.array([float(r[n]) for r in rows]) for n in names]


def test_every_register_row_maps_to_its_utm_columns(grid, register):
    assert len(register) == 878
    e, n, x, y = _cols(register, "plant_E", "plant_N", "utm39_E", "utm39_N")
    sx, sy = grid.plant_to_site(e, n)
    err = np.hypot(sx - x, sy - y)
    assert err.max() < TOL_M, (float(err.max()), register[int(err.argmax())]["node"])
    assert np.abs(sx - x).max() <= 0.011 and np.abs(sy - y).max() <= 0.011  # Cowork rounded to 1 cm


def test_the_golden_vectors_are_register_rows_and_hold(grid, register):
    doc = json.loads(VECTORS.read_text("utf-8"))
    assert (
        doc["frame"]["origin_crs"] == [244338.089, 3179515.69] and doc["frame"]["plant_north_deg"] == 17.9991
    )
    assert len(doc["rows"]) == 50
    by_node = {r["node"]: r for r in register}
    for v in doc["rows"]:
        r = by_node[v["node"]]
        assert (v["plant_E"], v["plant_N"]) == (float(r["plant_E"]), float(r["plant_N"]))
        assert (v["site_X"], v["site_Y"]) == (float(r["utm39_E"]), float(r["utm39_N"]))
        sx, sy = grid.plant_to_site(v["plant_E"], v["plant_N"])
        assert math.hypot(float(sx) - v["site_X"], float(sy) - v["site_Y"]) < TOL_M
    for v in doc["scene"]:
        assert grid.plant_to_scene(v["plant_E"], v["plant_N"], v["el"]).tolist() == pytest.approx(
            [v["x"], v["y"], v["z"]]
        )


def test_site_to_plant_inverts_plant_to_site(grid, register):
    e, n = _cols(register, "plant_E", "plant_N")
    back = grid.site_to_plant(*grid.plant_to_site(e, n))
    assert np.abs(back[0] - e).max() < 1e-6 and np.abs(back[1] - n).max() < 1e-6


def test_the_scene_frame_is_north_up_east(grid):
    xyz = grid.plant_to_scene([1300.0, 0.0], [450.0, 10.0], [104.5, 100.0])
    assert xyz.tolist() == [[450.0, 4.5, 1300.0], [10.0, 0.0, 0.0]]
    e, n, el = grid.scene_to_plant(xyz)
    assert (e.tolist(), n.tolist(), el.tolist()) == ([1300.0, 0.0], [450.0, 10.0], [104.5, 100.0])


def test_the_fit_recovers_the_frame_from_three_rows_and_from_all(register):
    e, n, x, y = _cols(register, "plant_E", "plant_N", "utm39_E", "utm39_N")
    pairs = [((e[i], n[i]), (x[i], y[i])) for i in range(len(e))]
    origin, deg, rms = fit_plant_grid([pairs[0], pairs[400], pairs[800]])
    assert math.hypot(origin[0] - 244338.089, origin[1] - 3179515.690) < TOL_M
    assert deg == pytest.approx(17.9991, abs=1e-3) and rms < 0.01
    origin, deg, rms = fit_plant_grid(pairs)
    assert math.hypot(origin[0] - 244338.089, origin[1] - 3179515.690) < 0.01
    assert deg == pytest.approx(17.9991, abs=1e-4) and rms < 0.01


def test_the_fit_needs_two_distinct_finite_points():
    with pytest.raises(GridError):
        fit_plant_grid([((0, 0), (1, 1))])
    with pytest.raises(GridError):
        fit_plant_grid([((5, 5), (1, 1)), ((5, 5), (2, 2))])
    with pytest.raises(GridError):
        fit_plant_grid([((0, 0), (1, 1)), ((1, math.nan), (2, 2))])


def test_lonlat_and_grid_convergence_at_the_kipic_origin(grid):
    lon, lat = grid.site_to_lonlat(244338.089, 3179515.690)
    assert (float(lon), float(lat)) == pytest.approx((48.382707, 28.717689), abs=1e-5)
    # West of UTM 39's central meridian grid north points west of true north, so plant north's true
    # bearing is 17.9991 - 1.2583 (spec §9: plant_north_deg + convergence).
    assert grid.convergence_deg() == pytest.approx(-1.2583, abs=1e-3)


def test_a_frame_without_a_crs_has_no_lonlat():
    grid = PlantGrid(_frame(crs={"epsg": None, "wkt": None}))
    assert grid.plant_to_site(0, 0)[0] == pytest.approx(244338.089)  # the grid itself still works
    with pytest.raises(GridError):
        grid.site_to_lonlat(0, 0)
    with pytest.raises(GridError):
        PlantGrid(_frame(crs={"wkt": "not a crs"})).convergence_deg()


def test_rect_outline_turns_clockwise_from_north():
    north = footprint_polygon(RectFootprint(kind="rect", center=[0, 0], size=[10, 4]))
    assert north.tolist() == [[-2, -5], [2, -5], [2, 5], [-2, 5]]  # along = 10 runs north
    east = footprint_polygon(RectFootprint(kind="rect", center=[0, 0], size=[10, 4], rot_deg=90))
    assert np.allclose(east, [[-5, 2], [-5, -2], [5, -2], [5, 2]])  # along turned to run east
    assert footprint_ref(RectFootprint(kind="rect", center=[3, 4], size=[1, 1])) == (3.0, 4.0)


def test_circle_polygon_and_line_outlines():
    ring = footprint_polygon(CircleFootprint(kind="circle", center=[10, 20], d=8))
    assert len(ring) == CIRCLE_SEGMENTS
    assert np.allclose(np.hypot(ring[:, 0] - 10, ring[:, 1] - 20), 4)
    cw_closed = PolygonFootprint(kind="polygon", pts=[[0, 0], [0, 4], [4, 4], [4, 0], [0, 0]])
    poly = footprint_polygon(cw_closed)
    assert len(poly) == 4 and poly.tolist() == [[4, 0], [4, 4], [0, 4], [0, 0]]  # CCW, not repeated
    line = LineFootprint(kind="line", pts=[[0, 0], [10, 0], [10, 10]], width=2)
    outline = footprint_polygon(line)
    x, y = outline[:, 0], outline[:, 1]
    area = 0.5 * float(np.dot(x, np.roll(y, -1)) - np.dot(np.roll(x, -1), y))
    assert area == pytest.approx(40.0)  # 20 m of 2 m wide line, mitred corner
    with pytest.raises(ValueError):
        footprint_polygon(LineFootprint(kind="line", pts=[[1, 1], [1, 1]], width=2))


def test_reference_points_weigh_area_and_length():
    l_shape = PolygonFootprint(kind="polygon", pts=[[0, 0], [4, 0], [4, 1], [1, 1], [1, 4], [0, 4]])
    assert footprint_ref(l_shape) == pytest.approx((19 / 14, 19 / 14))
    line = LineFootprint(kind="line", pts=[[0, 0], [10, 0], [10, 10]], width=2)
    assert footprint_ref(line) == pytest.approx((7.5, 2.5))
    flat = PolygonFootprint(kind="polygon", pts=[[0, 0], [1, 0], [2, 0]])
    assert footprint_ref(flat) == pytest.approx((1.0, 0.0))  # no area: the mean
```

- [ ] **Step 2: Run them to see them fail**

Run: `cd backend; & $py -m pytest tests/test_plant_siteframe.py -q`
Expected: collection error, `ModuleNotFoundError: No module named 'app.asset_models.siteframe'`.

- [ ] **Step 3: Write `siteframe.py`**

Create `backend/app/asset_models/siteframe.py`:
```python
"""The plant grid (spec 2026-10-03-plant-model-generator §5, D9; plan 2026-10-03-plant-model-f0 Task 3).

Three frames:
- plant: [E, N] metres in the drawing's own grid, elevations as plant EL;
- site: [X, Y] metres in the site CRS: [X, Y] = origin_crs + R(θ)·[E, N] with
  R(θ) = [[cos θ, sin θ], [-sin θ, cos θ]], θ = plant_north_deg (plant north, clockwise from grid north);
- scene (and GLB): metres, Y up: x = plant N, y = EL - datum.el_m, z = plant E.

Pinned by contract/fixtures/plant-grid-vectors.json (the KIPIC register) in pytest and, in S1, vitest.
"""

from __future__ import annotations

import math

import numpy as np
from numpy.typing import ArrayLike
from shapely.geometry import LineString

from app.asset_models.spec import Footprint, SiteFrame

CIRCLE_SEGMENTS = 64


class GridError(Exception):
    """The grid cannot answer: no usable CRS for a lon/lat, or too few or coincident fit points."""


class PlantGrid:
    def __init__(self, frame: SiteFrame):
        self.frame = frame
        self._ox, self._oy = float(frame.origin_crs[0]), float(frame.origin_crs[1])
        t = math.radians(frame.plant_north_deg)
        self._c, self._s = math.cos(t), math.sin(t)
        self._datum = float(frame.datum.el_m)
        self._to_wgs = None  # pyproj transformers, built on first use
        self._from_wgs = None

    def plant_to_site(self, e: ArrayLike, n: ArrayLike) -> tuple[np.ndarray, np.ndarray]:
        e, n = np.asarray(e, dtype=np.float64), np.asarray(n, dtype=np.float64)
        return self._ox + self._c * e + self._s * n, self._oy - self._s * e + self._c * n

    def site_to_plant(self, x: ArrayLike, y: ArrayLike) -> tuple[np.ndarray, np.ndarray]:
        dx = np.asarray(x, dtype=np.float64) - self._ox
        dy = np.asarray(y, dtype=np.float64) - self._oy
        return self._c * dx - self._s * dy, self._s * dx + self._c * dy

    def plant_to_scene(self, e: ArrayLike, n: ArrayLike, el: ArrayLike) -> np.ndarray:
        e, n, el = np.broadcast_arrays(*(np.asarray(v, dtype=np.float64) for v in (e, n, el)))
        return np.stack([n, el - self._datum, e], axis=-1)

    def scene_to_plant(self, xyz: np.ndarray) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
        xyz = np.asarray(xyz, dtype=np.float64)
        return xyz[..., 2], xyz[..., 0], xyz[..., 1] + self._datum

    def _transformers(self):
        if self._to_wgs is None:
            from pyproj import CRS, Transformer

            crs = self.frame.crs
            if crs.epsg is None and not crs.wkt:
                raise GridError("the site frame has no CRS")
            try:
                src = CRS.from_epsg(crs.epsg) if crs.epsg is not None else CRS.from_wkt(crs.wkt)
            except Exception:
                raise GridError("the site CRS is not one pyproj knows") from None
            wgs = CRS.from_epsg(4326)
            self._to_wgs = Transformer.from_crs(src, wgs, always_xy=True)
            self._from_wgs = Transformer.from_crs(wgs, src, always_xy=True)
        return self._to_wgs, self._from_wgs

    def site_to_lonlat(self, x: ArrayLike, y: ArrayLike) -> tuple[np.ndarray, np.ndarray]:
        to_wgs, _ = self._transformers()
        lon, lat = to_wgs.transform(np.asarray(x, dtype=np.float64), np.asarray(y, dtype=np.float64))
        return np.asarray(lon, dtype=np.float64), np.asarray(lat, dtype=np.float64)

    def convergence_deg(self) -> float:
        """The true bearing of grid north at the plant origin, clockwise from true north. The true
        bearing of plant north is then plant_north_deg + convergence_deg() (spec §9)."""
        to_wgs, from_wgs = self._transformers()
        lon, lat = to_wgs.transform(self._ox, self._oy)
        x2, y2 = from_wgs.transform(lon, lat + 1e-4)
        return -math.degrees(math.atan2(x2 - self._ox, y2 - self._oy))


def fit_plant_grid(
    pairs: list[tuple[tuple[float, float], tuple[float, float]]],
) -> tuple[tuple[float, float], float, float]:
    """[((E, N), (X, Y)), ...] (at least 2) -> (origin_crs, plant_north_deg, rms_residual_m).

    Least squares over a rotation and a translation, no scale: the drawing's grid is in metres."""
    if len(pairs) < 2:
        raise GridError("a plant grid needs at least two points")
    p = np.array([pe for pe, _ in pairs], dtype=np.float64).reshape(-1, 2)
    q = np.array([qx for _, qx in pairs], dtype=np.float64).reshape(-1, 2)
    if not (np.isfinite(p).all() and np.isfinite(q).all()):
        raise GridError("the grid points must be finite")
    pt, qt = p - p.mean(axis=0), q - q.mean(axis=0)
    if float(np.abs(pt).max()) < 1e-6:
        raise GridError("the plant points coincide")
    a = float(np.sum(qt[:, 0] * pt[:, 0] + qt[:, 1] * pt[:, 1]))
    b = float(np.sum(qt[:, 0] * pt[:, 1] - qt[:, 1] * pt[:, 0]))
    theta = math.atan2(b, a)
    c, s = math.cos(theta), math.sin(theta)
    r = np.array([[c, s], [-s, c]])
    origin = q.mean(axis=0) - r @ p.mean(axis=0)
    resid = q - (origin + p @ r.T)
    rms = float(np.sqrt(np.mean(np.sum(resid**2, axis=1))))
    return (float(origin[0]), float(origin[1])), math.degrees(theta), rms


def _signed_area(ring: np.ndarray) -> float:
    x, y = ring[:, 0], ring[:, 1]
    return 0.5 * float(np.dot(x, np.roll(y, -1)) - np.dot(np.roll(x, -1), y))


def _ccw(ring: np.ndarray) -> np.ndarray:
    return ring[::-1].copy() if _signed_area(ring) < 0 else ring


def _open_ring(pts) -> np.ndarray:
    ring = np.asarray(pts, dtype=np.float64).reshape(-1, 2)
    if len(ring) > 1 and np.allclose(ring[0], ring[-1]):
        ring = ring[:-1]
    return ring


def footprint_ref(fp: Footprint) -> tuple[float, float]:
    """The item's reference point, plant [E, N]: rect and circle centre; polygon area-weighted
    centroid; line length-weighted centroid. A degenerate polygon or line falls back to the mean."""
    if fp.kind in ("rect", "circle"):
        return float(fp.center[0]), float(fp.center[1])
    if fp.kind == "polygon":
        pts = _open_ring(fp.pts)
        x, y = pts[:, 0], pts[:, 1]
        xn, yn = np.roll(x, -1), np.roll(y, -1)
        cross = x * yn - xn * y
        area = 0.5 * float(cross.sum())
        if abs(area) > 1e-12:
            return float(((x + xn) * cross).sum() / (6 * area)), float(((y + yn) * cross).sum() / (6 * area))
    else:
        pts = np.asarray(fp.pts, dtype=np.float64)
        seg = np.diff(pts, axis=0)
        lengths = np.hypot(seg[:, 0], seg[:, 1])
        if lengths.sum() > 1e-12:
            c = (((pts[:-1] + pts[1:]) / 2) * lengths[:, None]).sum(axis=0) / lengths.sum()
            return float(c[0]), float(c[1])
    m = pts.mean(axis=0)
    return float(m[0]), float(m[1])


def footprint_polygon(fp: Footprint) -> np.ndarray:
    """The outline, (k, 2) plant [E, N], counter-clockwise, the closing point not repeated. A line
    is its outline at `width` (flat ends, mitred corners); a line with no length raises ValueError."""
    if fp.kind == "rect":
        t = math.radians(fp.rot_deg)
        u = np.array([math.sin(t), math.cos(t)])  # along: rot_deg clockwise from plant north, [dE, dN]
        v = np.array([math.cos(t), -math.sin(t)])  # across: `along` turned 90 degrees clockwise
        c = np.asarray(fp.center, dtype=np.float64)
        a, b = fp.size[0] / 2.0, fp.size[1] / 2.0
        return np.array([c - v * b - u * a, c + v * b - u * a, c + v * b + u * a, c - v * b + u * a])
    if fp.kind == "circle":
        k = np.arange(CIRCLE_SEGMENTS) * (2 * math.pi / CIRCLE_SEGMENTS)
        r = fp.d / 2.0
        return np.column_stack([fp.center[0] + r * np.cos(k), fp.center[1] + r * np.sin(k)])
    if fp.kind == "polygon":
        return _ccw(_open_ring(fp.pts))
    outline = LineString(fp.pts).buffer(fp.width / 2.0, cap_style="flat", join_style="mitre", mitre_limit=5.0)
    if outline.is_empty or outline.geom_type != "Polygon":
        raise ValueError("the line footprint has no length")
    return _ccw(_open_ring(np.asarray(outline.exterior.coords)))
```

- [ ] **Step 4: Write the golden-vector script and run it**

Create `backend/scripts/plant_grid_vectors.py`:
```python
"""Write contract/fixtures/plant-grid-vectors.json from the KIPIC register fixture.

The plant grid's golden vectors (plan 2026-10-03-plant-model-f0 Task 3): 50 register rows spread
evenly over the 878 that have coordinates, as Cowork wrote them (plant_E/N -> utm39_E/N), plus five
scene vectors. pytest (tests/test_plant_siteframe.py) and S1's vitest pin the grid to this file.

Run from backend/:  ..\\backend\\.venv\\Scripts\\python.exe scripts\\plant_grid_vectors.py
"""

from __future__ import annotations

import csv
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
REGISTER = ROOT / "backend" / "tests" / "data" / "plant" / "kipic_register.csv"
OUT = ROOT / "contract" / "fixtures" / "plant-grid-vectors.json"
FRAME = {
    "crs": {"epsg": 32639, "wkt": None},
    "origin_crs": [244338.089, 3179515.690],
    "plant_north_deg": 17.9991,
    "datum": {"label": "HPFS", "el_m": 100.0},
}
ROWS = 50
SCENE_ROWS = 5


def main() -> None:
    with REGISTER.open(encoding="utf-8", newline="") as f:
        rows = [r for r in csv.DictReader(f) if r["plant_E"] and r["utm39_E"]]
    n = len(rows)
    picks = [rows[round(i * (n - 1) / (ROWS - 1))] for i in range(ROWS)]
    vectors = [
        {
            "node": r["node"],
            "plant_E": float(r["plant_E"]),
            "plant_N": float(r["plant_N"]),
            "site_X": float(r["utm39_E"]),
            "site_Y": float(r["utm39_N"]),
        }
        for r in picks
    ]
    with_el = [r for r in picks if r["base_EL"]][:SCENE_ROWS]
    datum = FRAME["datum"]["el_m"]
    scene = [
        {
            "plant_E": float(r["plant_E"]),
            "plant_N": float(r["plant_N"]),
            "el": float(r["base_EL"]),
            "x": float(r["plant_N"]),
            "y": round(float(r["base_EL"]) - datum, 6),
            "z": float(r["plant_E"]),
        }
        for r in with_el
    ]
    doc = {
        "source": "KIPIC Al-Zour asset register (Cowork), backend/tests/data/plant/kipic_register.csv",
        "formula": "X = ox + cos(t)*E + sin(t)*N; Y = oy - sin(t)*E + cos(t)*N; t = plant_north_deg",
        "scene_formula": "x = N; y = EL - datum.el_m; z = E",
        "tolerance_m": 0.05,
        "frame": FRAME,
        "rows": vectors,
        "scene": scene,
    }
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(doc, indent=2) + "\n", encoding="utf-8")
    print(f"wrote {len(vectors)} rows and {len(scene)} scene vectors to {OUT}")


if __name__ == "__main__":
    main()
```
Run: `cd backend; & $py scripts/plant_grid_vectors.py`
Expected: `wrote 50 rows and 5 scene vectors to ...\contract\fixtures\plant-grid-vectors.json`. The file starts with `"source"`, `"formula"`, `"scene_formula"`, `"tolerance_m": 0.05`, then `"frame": {"crs": {"epsg": 32639, "wkt": null}, "origin_crs": [244338.089, 3179515.69], "plant_north_deg": 17.9991, "datum": {"label": "HPFS", "el_m": 100.0}}`, and its first row is `10-A-0003-G-01` (2256.34, 519.32 → 246644.48, 3179312.38).

- [ ] **Step 5: Run the tests to see them pass**

Run: `cd backend; & $py -m pytest tests/test_plant_siteframe.py -q`
Expected: `11 passed`. (The register's largest error is 0.0118 m; the fit over all 878 rows returns origin within 1 cm, 17.99910°, rms 0.0047 m; KIPIC's origin is lon 48.382707, lat 28.717689, convergence −1.2583°.)

- [ ] **Step 6: Lint and commit**

```powershell
cd backend; & $py -m ruff check app/asset_models/siteframe.py scripts/plant_grid_vectors.py tests/test_plant_siteframe.py; & $py -m ruff format --check app/asset_models/siteframe.py scripts/plant_grid_vectors.py tests/test_plant_siteframe.py; cd ..
git add backend/app/asset_models/siteframe.py backend/scripts/plant_grid_vectors.py contract/fixtures/plant-grid-vectors.json backend/tests/test_plant_siteframe.py
git commit -m "feat(plant): plant grid conversions pinned to the KIPIC register" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Migration 0017 and the ORM

**Files:**
- Create: `backend/app/db/migrations/versions/0017_plant_model.py`
- Modify: `backend/app/db/models.py` (`class AssetModel`: after `review`; before `class MapMeasurement(Base):`)
- Test: `backend/tests/test_migration_0017.py`

**Interfaces:**
- Consumes: P1's revision `"0016"`; `app.db.base.Base, UTCDateTime, new_id, utcnow`.
- Produces: `AssetModel.kind` (`"asset"` default, server default `'asset'`), `AssetItem` (table `asset_item`), `SiteModelPackage` (table `site_model_package`), `SITE_MODEL_PACKAGE_STATE_CHECK`.

- [ ] **Step 1: Write the failing tests**

Create `backend/tests/test_migration_0017.py`:
```python
"""Migration 0017 (plant model): additive only. One head, the ORM matches, the new tables cascade with
their parents, and an upgrade or a downgrade never touches an asset model's versions or runs (plan
2026-10-03-plant-model-f0 Task 4, Review Focus 5)."""

import sqlite3

import pytest
from alembic import command
from alembic.autogenerate import compare_metadata
from alembic.config import Config
from alembic.migration import MigrationContext
from alembic.script import ScriptDirectory
from sqlalchemy.orm import Session

from app.db.base import Base
from app.db.models import AssetItem, AssetModel, AssetModelRun, SiteModelPackage
from app.db.session import MIGRATIONS, open_project_db

REVISION = "0017"
DOWN = "0016"
TABLES = {"asset_item": AssetItem, "site_model_package": SiteModelPackage}
T = "2026-10-03 00:00:00.000000"


def _cfg(folder=None) -> Config:
    cfg = Config(str(MIGRATIONS / "alembic.ini"))
    cfg.set_main_option("script_location", str(MIGRATIONS))
    if folder is not None:
        cfg.set_main_option("sqlalchemy.url", f"sqlite:///{(folder / 'project.db').as_posix()}")
    return cfg


def _tables(con) -> set[str]:
    return {r[0] for r in con.execute("SELECT name FROM sqlite_master WHERE type = 'table'")}


def _columns(con, table) -> set[str]:
    return {r[1] for r in con.execute(f"PRAGMA table_info({table})")}


def _seed_at_0016(folder) -> None:
    """A model with one version and one run, written at revision 0016 (before `kind` existed)."""
    command.upgrade(_cfg(folder), DOWN)
    con = sqlite3.connect(folder / "project.db")
    con.execute(
        "INSERT INTO asset_model (id, name, status, created_at, updated_at)"
        " VALUES ('m1', 'Tank', 'ready', ?, ?)",
        (T, T),
    )
    con.execute(
        "INSERT INTO asset_model_version (id, model_id, version, spec, kind, glb_status, source_ids,"
        " part_count, created_at) VALUES ('v1', 'm1', 1, '{}', 'manual', 'ready', '[]', 0, ?)",
        (T,),
    )
    con.execute(
        "INSERT INTO asset_model_run (id, model_id, job_id, provider, model_name, mode, state, phase,"
        " steps, open_questions, usage, sources, started_at) VALUES ('r1', 'm1', 'j1', 'anthropic',"
        " 'claude-opus-5-5', 'build', 'finished', 'done', '[]', '[]', '{}', '[]', ?)",
        (T,),
    )
    con.commit()
    con.close()


@pytest.fixture
def engine(tmp_path):
    folder = tmp_path / "p"
    folder.mkdir()
    eng = open_project_db(folder)  # upgraded to head
    yield eng
    eng.dispose()


def test_the_chain_has_one_head_and_0017_is_on_it():
    script = ScriptDirectory.from_config(_cfg())
    heads = script.get_heads()
    assert len(heads) == 1, heads
    assert REVISION in {rev.revision for rev in script.walk_revisions(base="base", head=heads[0])}
    assert script.get_revision(REVISION).down_revision == DOWN


def test_the_orm_and_the_migration_describe_the_same_tables(engine):
    with engine.connect() as conn:
        diff = compare_metadata(MigrationContext.configure(conn), Base.metadata)
    # Scoped to our tables and column by name; every diff kind (types, nullability, indexes) counts.
    ours = [d for d in diff if any(n in repr(d) for n in (*TABLES, "'asset_model', 'kind'"))]
    assert ours == []


def test_a_project_at_0016_upgrades_keeps_its_rows_and_defaults_kind(tmp_path):
    folder = tmp_path / "old"
    folder.mkdir()
    _seed_at_0016(folder)
    command.upgrade(_cfg(folder), REVISION)
    con = sqlite3.connect(folder / "project.db")
    try:
        assert con.execute("SELECT id, kind FROM asset_model").fetchall() == [("m1", "asset")]
        assert con.execute("SELECT id FROM asset_model_version").fetchall() == [("v1",)]
        assert con.execute("SELECT id FROM asset_model_run").fetchall() == [("r1",)]
        assert set(TABLES) <= _tables(con)
    finally:
        con.close()


def test_an_upgrade_that_stopped_after_the_column_recovers(tmp_path):
    folder = tmp_path / "half"
    folder.mkdir()
    _seed_at_0016(folder)
    con = sqlite3.connect(folder / "project.db")
    con.execute("ALTER TABLE asset_model ADD COLUMN kind VARCHAR DEFAULT 'asset' NOT NULL")
    con.commit()
    con.close()
    command.upgrade(_cfg(folder), REVISION)  # must not fail on the column it meets again
    con = sqlite3.connect(folder / "project.db")
    try:
        assert set(TABLES) <= _tables(con)
    finally:
        con.close()


def test_0017_downgrades_to_0016_and_keeps_every_version_and_run(tmp_path):
    folder = tmp_path / "p"
    folder.mkdir()
    _seed_at_0016(folder)
    command.upgrade(_cfg(folder), REVISION)
    command.downgrade(_cfg(folder), DOWN)
    con = sqlite3.connect(folder / "project.db")
    try:
        assert not set(TABLES) & _tables(con)
        assert "kind" not in _columns(con, "asset_model")
        assert con.execute("SELECT id FROM asset_model").fetchall() == [("m1",)]
        assert con.execute("SELECT id FROM asset_model_version").fetchall() == [("v1",)]
        assert con.execute("SELECT id FROM asset_model_run").fetchall() == [("r1",)]
    finally:
        con.close()
    command.upgrade(_cfg(folder), REVISION)  # and back up again


def test_items_and_packages_go_with_their_model_and_run(engine):
    with Session(engine) as s:
        m = AssetModel(name="Plant", status="ready", kind="plant")
        s.add(m)
        s.flush()
        run = AssetModelRun(model_id=m.id, job_id="j", provider="anthropic", model_name="x", mode="plant")
        s.add(run)
        s.flush()
        s.add(
            AssetItem(
                model_id=m.id,
                version=1,
                node="20-T-0001",
                name="LNG tank",
                type="tank_lng",
                height_source="drawing",
                confidence="high",
                flags=[],
                has_geometry=True,
            )
        )
        s.add(SiteModelPackage(run_id=run.id, n=1, label="Tank area", expected=["20-T-0001"]))
        s.commit()
        pkg = s.query(SiteModelPackage).one()
        assert (pkg.state, pkg.attempts, pkg.item_count, pkg.usage) == (
            "queued",
            0,
            0,
            {"input_tokens": 0, "output_tokens": 0},
        )
        assert s.get(AssetModel, m.id).kind == "plant"
        s.delete(run)
        s.commit()
        assert s.query(SiteModelPackage).count() == 0
        s.delete(s.get(AssetModel, m.id))
        s.commit()
        assert s.query(AssetItem).count() == 0


def test_a_package_state_outside_the_list_is_refused(engine):
    with Session(engine) as s:
        m = AssetModel(name="Plant", status="ready")
        s.add(m)
        s.flush()
        run = AssetModelRun(model_id=m.id, job_id="j", provider="anthropic", model_name="x", mode="plant")
        s.add(run)
        s.flush()
        s.add(SiteModelPackage(run_id=run.id, n=1, label="A", expected=[], state="paused"))
        with pytest.raises(Exception, match="CHECK constraint failed"):
            s.commit()
```

- [ ] **Step 2: Run them to see them fail**

Run: `cd backend; & $py -m pytest tests/test_migration_0017.py -q`
Expected: collection error, `ImportError: cannot import name 'AssetItem' from 'app.db.models'`.

- [ ] **Step 3: Write the migration**

Create `backend/app/db/migrations/versions/0017_plant_model.py`:
```python
"""plant model: the register index, plant-run packages and the model kind

The one project schema change of the plant model generator (spec 2026-10-03-plant-model-generator
section 9; plan 2026-10-03-plant-model-f0 Task 4). Additive only:

- `asset_model` gains `kind` by plain `ALTER TABLE ... ADD COLUMN`. Never a batch rebuild: P1's
  0016 owns the rebuilds of `asset_model`, `asset_model_version` and `finding`, and dropping
  `asset_model` with foreign keys on would cascade every version, run, pose and sighting away.
- `asset_item` (the register index the GLB job writes) and `site_model_package` (a plant run's
  packages) are new tables.

Every step is safe to meet again, so an open interrupted half way recovers on the next open. No
row is rewritten, so no copy-first guard is needed (`app.migration.backup.REBUILD_GUARDS`).

Revision ID: 0017
Revises: 0016
Create Date: 2026-10-03 00:00:00.000000
"""

import sqlalchemy as sa
from alembic import op

revision = "0017"
down_revision = "0016"  # P1's asset findings revision; re-check `alembic heads` before merging
branch_labels = None
depends_on = None

PACKAGE_STATE_CHECK = "state IN ('queued', 'running', 'done', 'failed', 'skipped')"


def _columns(table: str) -> set[str]:
    return {c["name"] for c in sa.inspect(op.get_bind()).get_columns(table)}


def upgrade() -> None:
    if "kind" not in _columns("asset_model"):
        op.add_column("asset_model", sa.Column("kind", sa.String(), nullable=False, server_default="asset"))

    op.create_table(
        "asset_item",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column(
            "model_id", sa.String(36), sa.ForeignKey("asset_model.id", ondelete="CASCADE"), nullable=False
        ),
        sa.Column("version", sa.Integer(), nullable=False),
        sa.Column("node", sa.String(), nullable=False),
        sa.Column("tag", sa.String(), nullable=True),
        sa.Column("name", sa.String(), nullable=False),
        sa.Column("type", sa.String(), nullable=False),
        sa.Column("area", sa.String(), nullable=True),
        sa.Column("plant_e", sa.Float(), nullable=True),
        sa.Column("plant_n", sa.Float(), nullable=True),
        sa.Column("site_x", sa.Float(), nullable=True),
        sa.Column("site_y", sa.Float(), nullable=True),
        sa.Column("lon", sa.Float(), nullable=True),
        sa.Column("lat", sa.Float(), nullable=True),
        sa.Column("base_el", sa.Float(), nullable=True),
        sa.Column("top_el", sa.Float(), nullable=True),
        sa.Column("height_source", sa.String(), nullable=False),
        sa.Column("confidence", sa.String(), nullable=False),
        sa.Column("flags", sa.JSON(), nullable=False),
        sa.Column("source_sheet", sa.String(), nullable=True),
        sa.Column("has_geometry", sa.Boolean(), nullable=False),
        if_not_exists=True,
    )
    op.create_index("ix_asset_item_version", "asset_item", ["model_id", "version"], if_not_exists=True)
    op.create_index("ix_asset_item_tag", "asset_item", ["model_id", "version", "tag"], if_not_exists=True)
    op.create_index("ix_asset_item_type", "asset_item", ["model_id", "version", "type"], if_not_exists=True)

    op.create_table(
        "site_model_package",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column(
            "run_id", sa.String(36), sa.ForeignKey("asset_model_run.id", ondelete="CASCADE"), nullable=False
        ),
        sa.Column("n", sa.Integer(), nullable=False),
        sa.Column("label", sa.String(), nullable=False),
        sa.Column("drawing_id", sa.String(36), nullable=True),
        sa.Column("region", sa.JSON(), nullable=True),
        sa.Column("area", sa.String(), nullable=True),
        sa.Column("expected", sa.JSON(), nullable=False),
        sa.Column("state", sa.String(), nullable=False),
        sa.Column("attempts", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("usage", sa.JSON(), nullable=False),
        sa.Column("item_count", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("items", sa.JSON(), nullable=True),
        sa.Column("summary", sa.String(), nullable=True),
        sa.Column("started_at", sa.DateTime(), nullable=True),
        sa.Column("ended_at", sa.DateTime(), nullable=True),
        sa.CheckConstraint(PACKAGE_STATE_CHECK, name="ck_site_model_package_state"),
        if_not_exists=True,
    )
    op.create_index(
        "ux_site_model_package_run_n", "site_model_package", ["run_id", "n"], unique=True, if_not_exists=True
    )


def downgrade() -> None:
    op.drop_table("site_model_package")
    op.drop_table("asset_item")
    # A native DROP COLUMN, never a batch rebuild of asset_model (see the module docstring).
    op.drop_column("asset_model", "kind")
```
Check the head first (from `backend`, before creating the file):
```powershell
& $py -c "from alembic.config import Config; from alembic.script import ScriptDirectory; from app.db.session import MIGRATIONS; c = Config(str(MIGRATIONS / 'alembic.ini')); c.set_main_option('script_location', str(MIGRATIONS)); print(ScriptDirectory.from_config(c).get_heads())"
```
It must print `['0016']`. If another revision took `0017` or the head is not `0016`, stop and report `BLOCKED: migration head` to the coordinator (never renumber P1's revision).

- [ ] **Step 4: Add the ORM**

In `backend/app/db/models.py`, `class AssetModel`, find:
```python
    review: Mapped[dict | None] = mapped_column(JSON(none_as_null=True), nullable=True)
    __table_args__ = (Index("ix_asset_model_created", "created_at", "id"),)
```
Replace with:
```python
    review: Mapped[dict | None] = mapped_column(JSON(none_as_null=True), nullable=True)
    # Plant model (spec 2026-10-03-plant-model-generator §9, migration 0017): asset | plant, no CHECK.
    kind: Mapped[str] = mapped_column(String, default="asset", server_default="asset")
    __table_args__ = (Index("ix_asset_model_created", "created_at", "id"),)
```
Then insert, directly before `class MapMeasurement(Base):` (two blank lines either side):
```python
class AssetItem(Base):
    """One row of a plant version's register (spec 2026-10-03-plant-model-generator §9, migration
    0017). Written by the GLB job from the spec, so it is an index: the spec stays the source. `node`
    is the item id (the GLB node name)."""

    __tablename__ = "asset_item"
    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    model_id: Mapped[str] = mapped_column(String(36), ForeignKey("asset_model.id", ondelete="CASCADE"))
    version: Mapped[int] = mapped_column(Integer)
    node: Mapped[str] = mapped_column(String)
    tag: Mapped[str | None] = mapped_column(String, nullable=True)
    name: Mapped[str] = mapped_column(String)
    type: Mapped[str] = mapped_column(String)
    area: Mapped[str | None] = mapped_column(String, nullable=True)
    plant_e: Mapped[float | None] = mapped_column(Float, nullable=True)
    plant_n: Mapped[float | None] = mapped_column(Float, nullable=True)
    site_x: Mapped[float | None] = mapped_column(Float, nullable=True)
    site_y: Mapped[float | None] = mapped_column(Float, nullable=True)
    lon: Mapped[float | None] = mapped_column(Float, nullable=True)
    lat: Mapped[float | None] = mapped_column(Float, nullable=True)
    base_el: Mapped[float | None] = mapped_column(Float, nullable=True)
    top_el: Mapped[float | None] = mapped_column(Float, nullable=True)
    height_source: Mapped[str] = mapped_column(String)  # drawing | cloud | indicative
    confidence: Mapped[str] = mapped_column(String)  # high | medium | low
    flags: Mapped[list] = mapped_column(JSON, default=list)  # [{code, value, note}]
    source_sheet: Mapped[str | None] = mapped_column(String, nullable=True)
    has_geometry: Mapped[bool] = mapped_column(Boolean, default=True)
    __table_args__ = (
        Index("ix_asset_item_version", "model_id", "version"),
        Index("ix_asset_item_tag", "model_id", "version", "tag"),
        Index("ix_asset_item_type", "model_id", "version", "type"),
    )


SITE_MODEL_PACKAGE_STATE_CHECK = "state IN ('queued', 'running', 'done', 'failed', 'skipped')"


class SiteModelPackage(Base):
    """One package of a plant run: a page region traced by one sub-run (spec §8.2, migration 0017).
    `items` holds the package's draft items (Item dumps) once it is done, so a restarted run resumes
    after the last done package; `attempts` counts starts, so a package interrupted twice is failed."""

    __tablename__ = "site_model_package"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    run_id: Mapped[str] = mapped_column(String(36), ForeignKey("asset_model_run.id", ondelete="CASCADE"))
    n: Mapped[int] = mapped_column(Integer)
    label: Mapped[str] = mapped_column(String)
    drawing_id: Mapped[str | None] = mapped_column(String(36), nullable=True)  # no FK: drawings come and go
    region: Mapped[list | None] = mapped_column(JSON, nullable=True)  # [x0, y0, x1, y1] page fractions
    area: Mapped[str | None] = mapped_column(String, nullable=True)
    expected: Mapped[list] = mapped_column(JSON, default=list)  # tags from the equipment list
    state: Mapped[str] = mapped_column(String, default="queued")
    attempts: Mapped[int] = mapped_column(Integer, default=0, server_default="0")
    usage: Mapped[dict] = mapped_column(JSON, default=lambda: {"input_tokens": 0, "output_tokens": 0})
    item_count: Mapped[int] = mapped_column(Integer, default=0, server_default="0")
    items: Mapped[list | None] = mapped_column(JSON, nullable=True)
    summary: Mapped[str | None] = mapped_column(String, nullable=True)
    started_at: Mapped[datetime | None] = mapped_column(UTCDateTime, nullable=True)
    ended_at: Mapped[datetime | None] = mapped_column(UTCDateTime, nullable=True)
    __table_args__ = (
        CheckConstraint(SITE_MODEL_PACKAGE_STATE_CHECK, name="ck_site_model_package_state"),
        Index("ux_site_model_package_run_n", "run_id", "n", unique=True),
    )
```

- [ ] **Step 5: Run the migration tests and P1's**

Run: `cd backend; & $py -m pytest tests/test_migration_0017.py tests/test_migration_0016.py tests/test_migration_0015.py tests/test_migration_backup.py -q`
Expected: all pass (`test_migration_0017.py`: 7 passed).

- [ ] **Step 6: Lint and commit**

```powershell
cd backend; & $py -m ruff check app/db tests/test_migration_0017.py; & $py -m ruff format --check app/db tests/test_migration_0017.py; cd ..
git add backend/app/db/migrations/versions/0017_plant_model.py backend/app/db/models.py backend/tests/test_migration_0017.py
git commit -m "feat(plant): migration 0017 - asset_item, site_model_package, asset_model.kind" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Shared builder geometry and Cowork's palette

**Files:**
- Create: `backend/app/asset_models/builders/__init__.py`, `backend/app/asset_models/builders/geom.py`, `backend/app/asset_models/builders/palette.py`
- Test: `backend/tests/test_builders_geom.py`

**Interfaces:**
- Consumes: trimesh, shapely; M1's `spec.Material` (palette mapping).
- Produces: `segments_for`, `yaw`, `place`, `box`, `cyl`, `extrude`, `beam`, `ring_polyline`, `instanced_cyl` (its import of `base.Instanced` is lazy; Task 6 tests it), `Z_UP_TO_Y_UP`; `PALETTE`, `BLEND`, `DOUBLE_SIDED`, `DEFAULT_MATERIAL`, `M1_MATERIAL`, `material(name)`.

- [ ] **Step 1: Write the failing tests**

Create `backend/tests/test_builders_geom.py`:
```python
"""Shared builder geometry and the palette (plan 2026-10-03-plant-model-f0 Task 5)."""

import json
import os
import struct
from pathlib import Path

import numpy as np
import pytest

from app.asset_models.builders.geom import (
    beam,
    box,
    cyl,
    extrude,
    place,
    ring_polyline,
    segments_for,
    yaw,
)
from app.asset_models.builders.palette import BLEND, DOUBLE_SIDED, M1_MATERIAL, PALETTE, material
from app.asset_models.spec import Material

GLB_NAME = "KIPIC_AlZour_LNG_Plant.glb"


def test_box_stands_on_its_base_with_length_north():
    m = box(2, 10, 3)
    assert m.bounds.tolist() == [[-5, 0, -1], [5, 3, 1]] and m.is_watertight


def test_cylinder_stands_on_y_and_is_closed():
    m = cyl(1.0, 5.0)
    assert np.allclose(m.bounds, [[-1, 0, -1], [1, 5, 1]]) and m.is_watertight
    assert len(m.vertices) == 2 * segments_for(1.0) + 2


@pytest.mark.parametrize(("r", "n"), [(0.3, 9), (1.0, 16), (40.0, 100), (0.01, 8), (1e4, 128)])
def test_segments_keep_the_chord_error_within_bounds(r, n):
    assert segments_for(r) == n


def test_extrude_maps_plan_x_z_and_keeps_volume_either_way_round():
    ccw = extrude([[0, 0], [10, 0], [10, 2], [0, 2]], 3)
    cw = extrude([[0, 0], [0, 2], [10, 2], [10, 0]], 3)
    assert ccw.bounds.tolist() == [[0, 0, 0], [10, 3, 2]]
    for m in (ccw, cw):
        assert m.is_watertight and m.volume == pytest.approx(60.0)


@pytest.mark.parametrize(
    "outline",
    [
        [[0, 0], [1, 1], [1, 0], [0, 1]],
        [[0, 0], [1, 0], [2, 0]],
        [[0, 0], [1, 1]],
        [[0, 0], [np.nan, 1], [1, 0]],
    ],
)
def test_extrude_refuses_crossing_flat_short_or_non_finite_outlines(outline):
    with pytest.raises(ValueError):
        extrude(outline, 1)


def test_beams_keep_width_horizontal():
    flat = beam([0, 0, 0], [10, 0, 0], (0.2, 0.5))
    assert np.allclose(flat.bounds, [[0, -0.25, -0.1], [10, 0.25, 0.1]])
    post = beam([0, 0, 0], [0, 4, 0], (0.2, 0.5))
    assert np.allclose(post.bounds, [[-0.1, 0, -0.25], [0.1, 4, 0.25]])
    with pytest.raises(ValueError):
        beam([1, 1, 1], [1, 1, 1])


def test_yaw_turns_north_toward_east_and_place_moves():
    assert np.allclose(yaw(90) @ [1, 0, 0, 1], [0, 0, 1, 1])
    assert np.allclose(place(1, 2, 3, yaw_deg=180) @ [1, 0, 0, 1], [0, 2, 3, 1])


def test_ring_follows_the_polyline_at_its_height():
    ring = ring_polyline([[0, 0], [10, 0], [10, 5]], y=1.1, r=0.025)
    lo, hi = ring.bounds
    assert 1.07 < lo[1] < 1.1 < hi[1] < 1.13  # a 6-sided bar of radius 0.025 at y = 1.1
    assert hi[0] == pytest.approx(10.025, abs=1e-3) and hi[2] == pytest.approx(5.0, abs=0.03)


def test_the_palette_has_cowork_s_34_materials():
    assert len(PALETTE) == 34
    assert BLEND <= set(PALETTE) and DOUBLE_SIDED <= set(PALETTE)
    assert set(M1_MATERIAL) == set(Material.__args__) and set(M1_MATERIAL.values()) <= set(PALETTE)
    m = material("Fence")
    assert m.name == "Fence" and m.alphaMode == "BLEND" and m.doubleSided
    # trimesh keeps colour factors as 8-bit: within 1/255 of the palette
    assert np.allclose(np.asarray(m.baseColorFactor) / 255.0, PALETTE["Fence"][0], atol=1 / 255)
    with pytest.raises(KeyError):
        material("Chrome")


def _cowork_glb() -> Path | None:
    for folder in (Path(__file__).parent / "data" / "plant", Path(os.environ.get("KESTREL_KIPIC_DIR", "-"))):
        if (folder / GLB_NAME).is_file():
            return folder / GLB_NAME
    return None


@pytest.mark.skipif(
    _cowork_glb() is None, reason="the Cowork GLB is git-ignored; copy it to tests/data/plant"
)
def test_the_palette_is_the_cowork_glb_s():
    glb = _cowork_glb().read_bytes()
    (clen,) = struct.unpack_from("<I", glb, 12)
    mats = json.loads(glb[20 : 20 + clen])["materials"]
    assert [m["name"] for m in mats] == list(PALETTE)
    for m in mats:
        pbr = m["pbrMetallicRoughness"]
        rgba, metallic, roughness = PALETTE[m["name"]]
        assert pbr["baseColorFactor"] == pytest.approx(list(rgba)), m["name"]
        assert (pbr["metallicFactor"], pbr["roughnessFactor"]) == pytest.approx((metallic, roughness))
        assert (m.get("alphaMode") == "BLEND") == (m["name"] in BLEND)
        assert bool(m.get("doubleSided")) == (m["name"] in DOUBLE_SIDED)
```

- [ ] **Step 2: Run them to see them fail**

Run: `cd backend; & $py -m pytest tests/test_builders_geom.py -q`
Expected: collection error, `ModuleNotFoundError: No module named 'app.asset_models.builders'`.

- [ ] **Step 3: Create the package, the helpers and the palette**

Create `backend/app/asset_models/builders/__init__.py`:
```python
"""Plant item builders (spec 2026-10-03-plant-model-generator §6): the registry in `base`, shared
geometry in `geom`, Cowork's materials in `palette`, the fallback family in `fallback`, and one
module or package per family (structure, equipment, building, civil, environment) owned by B1 to B3.

Import nothing here: `base.load_all()` imports the families, and family modules import `base`.
"""
```
Create `backend/app/asset_models/builders/geom.py`:
```python
"""Shared mesh helpers for the plant builders (spec 2026-10-03-plant-model-generator §6; plan F0 Task 5).

Item-local frame: metres, Y up from the item's base_el, x = plant north, z = plant east, origin at
the footprint's reference point. A degenerate input (zero length, no area, a non-positive size)
raises ValueError; `build_item` turns that into a fallback, so a helper never has to guess.
"""

from __future__ import annotations

import math

import numpy as np
import trimesh
from shapely.geometry import Polygon
from shapely.geometry.polygon import orient

MIN_SEGMENTS, MAX_SEGMENTS = 8, 128
# trimesh builds prisms in its XY plane along +Z. (X, Y, Z) -> (X, Z, -Y) is a proper rotation
# (det +1, so face winding survives): height lands on +Y, and a plan point [x, z] is drawn at
# (X, Y) = (x, -z) so that it lands back on z.
Z_UP_TO_Y_UP = np.array([[1, 0, 0, 0], [0, 0, 1, 0], [0, -1, 0, 0], [0, 0, 0, 1]], dtype=np.float64)


def segments_for(r: float, chord_err: float = 0.02) -> int:
    """Segments for a circle of radius r (metres) whose chord sags at most chord_err, in [8, 128]."""
    if not r > 0:
        raise ValueError("the radius must be positive")
    if chord_err >= r:
        return MIN_SEGMENTS
    n = math.ceil(math.pi / math.acos(1.0 - chord_err / r))
    return int(min(MAX_SEGMENTS, max(MIN_SEGMENTS, n)))


def yaw(deg: float) -> np.ndarray:
    """4x4 rotation about +Y that turns plant north (+x) deg clockwise, seen from above, toward east (+z)."""
    t = math.radians(deg)
    c, s = math.cos(t), math.sin(t)
    return np.array([[c, 0, -s, 0], [0, 1, 0, 0], [s, 0, c, 0], [0, 0, 0, 1]], dtype=np.float64)


def place(x: float, y: float, z: float, yaw_deg: float = 0.0) -> np.ndarray:
    """4x4: turn by yaw_deg (see `yaw`), then move to (x, y, z)."""
    m = yaw(yaw_deg)
    m[:3, 3] = (x, y, z)
    return m


def box(w: float, l: float, h: float) -> trimesh.Trimesh:  # noqa: E741 - length along plant north
    """A box l along x (north), h up, w along z (east); base on y = 0, centred on x and z."""
    if min(w, l, h) <= 0:
        raise ValueError("a box needs positive sizes")
    m = trimesh.creation.box(extents=(l, h, w))
    m.apply_translation((0.0, h / 2.0, 0.0))
    return m


def cyl(r: float, h: float, segments: int | None = None) -> trimesh.Trimesh:
    """A closed cylinder on +Y: radius r, base on y = 0, top at y = h, centred on x and z."""
    if not (r > 0 and h > 0):
        raise ValueError("a cylinder needs a positive radius and height")
    m = trimesh.creation.cylinder(radius=r, height=h, sections=segments or segments_for(r))
    m.apply_translation((0.0, 0.0, h / 2.0))
    m.apply_transform(Z_UP_TO_Y_UP)
    return m


def extrude(poly2d, h: float) -> trimesh.Trimesh:
    """Extrude a plan outline [[x, z], ...] (item-local metres, either orientation, not closed) from
    y = 0 to y = h. A self-crossing or zero-area outline raises ValueError."""
    pts = np.asarray(poly2d, dtype=np.float64)
    if pts.ndim != 2 or pts.shape[1] != 2 or pts.shape[0] < 3 or not np.isfinite(pts).all():
        raise ValueError("an outline needs at least three finite [x, z] points")
    if not h > 0:
        raise ValueError("an extrusion needs a positive height")
    work = Polygon(np.column_stack([pts[:, 0], -pts[:, 1]]))
    if not work.is_valid or work.area <= 1e-9:
        raise ValueError("the outline crosses itself or has no area")
    m = trimesh.creation.extrude_polygon(orient(work, 1.0), h)
    m.apply_transform(Z_UP_TO_Y_UP)
    return m


def beam(p0, p1, section: tuple[float, float] = (0.3, 0.3)) -> trimesh.Trimesh:
    """A rectangular member from p0 to p1 (item-local metres). section = (w, h): w across, kept
    horizontal; h deep, in the vertical plane through the member. A vertical member's w lies along x."""
    a, b = np.asarray(p0, dtype=np.float64), np.asarray(p1, dtype=np.float64)
    d = b - a
    length = float(np.linalg.norm(d))
    w, hgt = section
    if length < 1e-6 or not (w > 0 and hgt > 0) or not np.isfinite(d).all():
        raise ValueError("a beam needs two distinct finite points and a positive section")
    axis = d / length
    side = np.cross((0.0, 1.0, 0.0), axis)
    if np.linalg.norm(side) < 1e-6:
        side = np.array([1.0, 0.0, 0.0])
    side /= np.linalg.norm(side)
    normal = np.cross(axis, side)
    m = trimesh.creation.box(extents=(w, hgt, length))
    xf = np.eye(4)
    xf[:3, 0], xf[:3, 1], xf[:3, 2] = side, normal, axis
    xf[:3, 3] = (a + b) / 2.0
    m.apply_transform(xf)
    return m


def ring_polyline(pts2d, y: float, r: float, closed: bool = True, segments: int = 6) -> trimesh.Trimesh:
    """A round bar of radius r along a plan polyline [[x, z], ...] at height y (handrails, rings).
    closed=True joins the last point back to the first."""
    pts = np.asarray(pts2d, dtype=np.float64)
    if pts.ndim != 2 or pts.shape[1] != 2 or pts.shape[0] < 2 or not r > 0:
        raise ValueError("a ring needs at least two [x, z] points and a positive radius")
    p3 = np.column_stack([pts[:, 0], np.full(len(pts), float(y)), pts[:, 1]])
    if closed:
        p3 = np.vstack([p3, p3[:1]])
    bars = [
        trimesh.creation.cylinder(radius=r, segment=[p3[i], p3[i + 1]], sections=segments)
        for i in range(len(p3) - 1)
        if np.linalg.norm(p3[i + 1] - p3[i]) > 1e-6
    ]
    if not bars:
        raise ValueError("a ring needs two distinct points")
    return trimesh.util.concatenate(bars)


def instanced_cyl(r: float, h: float, xforms):
    """One cylinder (see `cyl`) placed by each 4x4 of xforms, as an Instanced geometry."""
    from app.asset_models.builders.base import Instanced  # base never imports geom at module level

    t = np.asarray(xforms, dtype=np.float64).reshape(-1, 4, 4)
    if len(t) == 0:
        raise ValueError("instancing needs at least one transform")
    return Instanced(mesh=cyl(r, h), transforms=t)
```
Create `backend/app/asset_models/builders/palette.py` (the 34 entries are the Cowork GLB's materials in its order; the test checks them against the GLB when it is present):
```python
"""Cowork's 34 materials (spec 2026-10-03-plant-model-generator §7; plan F0 Task 5).

name -> (baseColorFactor RGBA, metallic, roughness), copied verbatim from the materials of
KIPIC_AlZour_LNG_Plant.glb. They are written into the GLB exactly as they are, with no sRGB to
linear step (they already are that GLB's factors), so a Kestrel plant looks like Cowork's in the
same viewer. Builders name a material by its key; `build_item` refuses any other name.
"""

from __future__ import annotations

from functools import cache

from trimesh.visual.material import PBRMaterial

RGBA = tuple[float, float, float, float]

PALETTE: dict[str, tuple[RGBA, float, float]] = {
    "Concrete_Tank": ((0.8, 0.79, 0.76, 1.0), 0.0, 0.85),
    "Concrete": ((0.66, 0.65, 0.62, 1.0), 0.0, 0.9),
    "Concrete_Dark": ((0.42, 0.42, 0.41, 1.0), 0.0, 0.9),
    "Steel_Structure": ((0.47, 0.5, 0.53, 1.0), 0.5, 0.55),
    "Steel_Dark": ((0.24, 0.26, 0.28, 1.0), 0.6, 0.5),
    "Grating": ((0.4, 0.42, 0.4, 1.0), 0.5, 0.6),
    "Handrail": ((0.89, 0.54, 0.01, 1.0), 0.2, 0.5),
    "Equipment_White": ((0.88, 0.88, 0.86, 1.0), 0.1, 0.5),
    "Equipment_Grey": ((0.7, 0.72, 0.73, 1.0), 0.3, 0.5),
    "Insulation_Clad": ((0.78, 0.8, 0.82, 1.0), 0.7, 0.35),
    "Pump_Blue": ((0.18, 0.33, 0.55, 1.0), 0.3, 0.5),
    "Machine_Green": ((0.28, 0.42, 0.33, 1.0), 0.3, 0.55),
    "Aluminium_Panel": ((0.82, 0.84, 0.86, 1.0), 0.8, 0.3),
    "Pipe": ((0.62, 0.64, 0.66, 1.0), 0.6, 0.45),
    "Pipe_Insulated": ((0.83, 0.84, 0.84, 1.0), 0.6, 0.4),
    "Building_Wall": ((0.86, 0.82, 0.74, 1.0), 0.0, 0.85),
    "Building_Roof": ((0.62, 0.62, 0.6, 1.0), 0.1, 0.8),
    "Shelter_Roof": ((0.55, 0.6, 0.64, 1.0), 0.4, 0.6),
    "Glass": ((0.25, 0.33, 0.4, 1.0), 0.6, 0.15),
    "Ground": ((0.74, 0.66, 0.52, 1.0), 0.0, 0.98),
    "Ground_Mainland": ((0.76, 0.68, 0.54, 1.0), 0.0, 0.98),
    "Asphalt": ((0.27, 0.28, 0.29, 1.0), 0.0, 0.9),
    "Paving": ((0.83, 0.83, 0.81, 1.0), 0.0, 0.9),
    "Laydown": ((0.64, 0.6, 0.53, 1.0), 0.0, 0.95),
    "Rock_Armour": ((0.47, 0.44, 0.4, 1.0), 0.0, 0.95),
    "Slope": ((0.72, 0.65, 0.52, 1.0), 0.0, 0.98),
    "Water_Pit": ((0.1, 0.16, 0.18, 1.0), 0.0, 0.3),
    "Sea": ((0.08, 0.3, 0.38, 1.0), 0.0, 0.25),
    "Fence": ((0.55, 0.58, 0.6, 0.45), 0.5, 0.5),
    "Safety_Red": ((0.7, 0.12, 0.1, 1.0), 0.2, 0.5),
    "Ship_Hull": ((0.16, 0.2, 0.26, 1.0), 0.3, 0.5),
    "Ship_Bottom": ((0.45, 0.12, 0.1, 1.0), 0.2, 0.6),
    "Ship_Deck": ((0.55, 0.55, 0.52, 1.0), 0.2, 0.7),
    "Zone_Line": ((0.85, 0.2, 0.15, 0.6), 0.0, 0.8),
}
BLEND = frozenset({"Fence", "Zone_Line"})  # alphaMode BLEND in the Cowork GLB
DOUBLE_SIDED = frozenset({"Rock_Armour", "Sea", "Fence", "Zone_Line"})
DEFAULT_MATERIAL = "Equipment_Grey"
# M1 part materials (spec.Material) for `composite` items and M1 parts under a plant.
M1_MATERIAL: dict[str, str] = {
    "paint": "Equipment_White",
    "steel": "Steel_Structure",
    "rubber": "Steel_Dark",
    "concrete": "Concrete",
    "grating": "Grating",
    "galvanised": "Aluminium_Panel",
    "glass": "Glass",
    "other": "Equipment_Grey",
}


@cache
def material(name: str) -> PBRMaterial:
    """The glTF material for a palette name; KeyError for any other name."""
    rgba, metallic, roughness = PALETTE[name]
    return PBRMaterial(
        name=name,
        baseColorFactor=list(rgba),
        metallicFactor=metallic,
        roughnessFactor=roughness,
        alphaMode="BLEND" if name in BLEND else None,
        doubleSided=name in DOUBLE_SIDED,
    )
```

- [ ] **Step 4: Run the tests to see them pass**

Run: `cd backend; & $py -m pytest tests/test_builders_geom.py -q`
Expected: `17 passed` with the Cowork GLB copied in Task 1 (`16 passed, 1 skipped` without it).

- [ ] **Step 5: Lint and commit**

```powershell
cd backend; & $py -m ruff check app/asset_models/builders tests/test_builders_geom.py; & $py -m ruff format --check app/asset_models/builders tests/test_builders_geom.py; cd ..
git add backend/app/asset_models/builders/__init__.py backend/app/asset_models/builders/geom.py backend/app/asset_models/builders/palette.py backend/tests/test_builders_geom.py
git commit -m "feat(plant): shared builder geometry and Cowork's 34-material palette" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: The builder registry and the fallback family

**Files:**
- Create: `backend/app/asset_models/builders/base.py`, `backend/app/asset_models/builders/fallback.py`
- Test: `backend/tests/test_builders_base.py`

**Interfaces:**
- Consumes: Task 3's `PlantGrid`, `footprint_ref`, `footprint_polygon`; Task 5's `box`, `extrude`, `PALETTE`, `DEFAULT_MATERIAL`, `M1_MATERIAL`; M1's `build.build_meshes` (lazy import in `build_composite`).
- Produces: every `base` name in the header; `fallback.footprint_body`, `fallback.last_resort`, the `other` and `composite` builders. Family modules (`structure`, `equipment`, `building`, `civil`, `environment`) are NOT created here: B1–B3 own them, and `load_all()` imports each tolerantly, as a module or a package.

- [ ] **Step 1: Write the failing tests**

Create `backend/tests/test_builders_base.py`:
```python
"""The builder registry, build_item's fallback and the fallback family (plan pm-f0 Task 6)."""

import json
import math

import numpy as np
import pytest

from app.asset_models.builders import base
from app.asset_models.builders.base import (
    PLANNED_TYPES,
    BuildCtx,
    Instanced,
    MeshNode,
    Params,
    build_item,
    builder,
    catalogue,
    defaulted_params,
    load_all,
)
from app.asset_models.builders.geom import box, cyl, instanced_cyl, place
from app.asset_models.siteframe import PlantGrid
from app.asset_models.spec import Item, SiteFrame

CTX = BuildCtx(grid=None)
PART = {
    "id": "shell",
    "name": "Shell",
    "group": "Shell",
    "shape": "cylinder",
    "params": {"id": 1000, "thickness": 10, "height": 2000},
    "source": {"kind": "assumed"},
}


def item(**over) -> Item:
    raw = {
        "id": "a",
        "name": "A",
        "type": "other",
        "footprint": {"kind": "rect", "center": [10, 20], "size": [8, 4], "rot_deg": 30},
        "source": {"kind": "assumed"},
    }
    raw.update(over)
    return Item.model_validate(raw)


@pytest.fixture
def registry(monkeypatch):
    """A scratch copy of the registry: test builders never leak into other tests."""
    load_all()
    scratch = dict(base.REGISTRY)
    monkeypatch.setattr(base, "REGISTRY", scratch)
    return scratch


class BoxParams(Params):
    h: float = 2.0


def test_the_catalogue_plan_has_every_g1_type():
    families = {}
    for t, f in PLANNED_TYPES.items():
        families.setdefault(f, set()).add(t)
    sizes = {f: len(ts) for f, ts in families.items()}
    assert sizes == {"structure": 11, "equipment": 19, "building": 5, "civil": 10, "fallback": 2}


def test_registered_builders_sit_in_their_planned_family():
    load_all()
    assert {"other", "composite"} <= set(base.REGISTRY)
    for t, d in base.REGISTRY.items():
        assert PLANNED_TYPES.get(t, d.family) == d.family, t


def test_builder_refuses_bad_registrations(registry):
    with pytest.raises(ValueError, match="twice"):
        builder("other", family="fallback", params=BoxParams, doc="x", default_height_m=1)(lambda i, c: [])
    with pytest.raises(ValueError, match="equipment family"):
        builder("tank_lng", family="civil", params=BoxParams, doc="x", default_height_m=1)(lambda i, c: [])
    with pytest.raises(ValueError, match="not a builder family"):
        builder("t_new", family="misc", params=BoxParams, doc="x", default_height_m=1)(lambda i, c: [])

    class NoDefault(Params):
        h: float

    with pytest.raises(TypeError, match="needs a default"):
        builder("t_new", family="equipment", params=NoDefault, doc="x", default_height_m=1)(lambda i, c: [])
    from pydantic import BaseModel

    class Loose(BaseModel):
        h: float = 1.0

    with pytest.raises(TypeError, match="subclass"):
        builder("t_new", family="equipment", params=Loose, doc="x", default_height_m=1)(lambda i, c: [])


def test_a_registered_builder_builds_its_items(registry):
    @builder("t_box", family="equipment", params=BoxParams, doc="A  test\n box.", default_height_m=2.0)
    def build(it, ctx):
        p = BoxParams.model_validate(it.params)
        return [MeshNode("body", "Steel_Structure", box(1, 1, p.h))]

    nodes, flags = build_item(item(type="t_box", params={"h": 4.0}), CTX)
    assert flags == [] and nodes[0].geometry.bounds[1][1] == pytest.approx(4.0)
    assert registry["t_box"].doc == "A test box."
    assert (
        defaulted_params(item(type="t_box")) == ["h"]
        and defaulted_params(item(type="t_box", params={"h": 1})) == []
    )


@pytest.mark.parametrize(
    "result",
    [
        "raise",
        [],
        [MeshNode("body", "Chrome", box(1, 1, 1))],
        [MeshNode("a", "Grating", box(1, 1, 1)), MeshNode("a", "Grating", box(1, 1, 1))],
        [MeshNode("piles", "Grating", Instanced(cyl(0.3, 2), np.stack([np.diag([-1.0, 1, 1, 1])])))],
    ],
)
def test_a_failing_builder_falls_back_to_other_with_a_flag(registry, result):
    @builder("t_bad", family="equipment", params=BoxParams, doc="x", default_height_m=6.0)
    def build(it, ctx):
        if result == "raise":
            raise ZeroDivisionError("boom")
        return result

    nodes, flags = build_item(item(type="t_bad"), CTX)
    assert [f.code for f in flags] == ["builder_fallback"]
    assert "t_bad" in flags[0].note and "boom" not in flags[0].note
    assert nodes[0].name == "body" and nodes[0].material == "Equipment_Grey"
    assert nodes[0].geometry.bounds[1][1] == pytest.approx(6.0)  # the type's default height


def test_params_that_fail_the_schema_fall_back(registry):
    builder("t_box2", family="equipment", params=BoxParams, doc="x", default_height_m=2)(
        lambda it, ctx: [MeshNode("body", "Grating", box(1, 1, 1))]
    )
    for params in ({"h": math.nan}, {"h": "tall"}, {"width": 3}):
        _, flags = build_item(item(type="t_box2", params=params), CTX)
        assert [f.code for f in flags] == ["builder_fallback"], params


def test_unbuilt_and_unknown_types_build_as_other(registry):
    registry.pop("tank_lng", None)  # as before B2 lands
    nodes, flags = build_item(item(type="tank_lng", base_el=104.5, top_el=150.0), CTX)
    assert flags[0].note == "no builder for 'tank_lng' yet"
    assert nodes[0].geometry.bounds[1][1] == pytest.approx(45.5)
    _, flags = build_item(item(type="made_up"), CTX)
    assert flags[0].note == "'made_up' is not a builder type"


@pytest.mark.parametrize(
    "footprint",
    [
        {"kind": "polygon", "pts": [[0, 0], [1, 1], [1, 0], [0, 1]]},
        {"kind": "polygon", "pts": [[0, 0], [5, 0], [10, 0]]},
        {"kind": "line", "pts": [[3, 3], [3, 3]], "width": 1},
    ],
)
def test_other_builds_something_for_any_footprint(footprint):
    """Review Focus 3: a crossing, flat or zero-length footprint never crashes the fallback."""
    nodes, _ = build_item(item(footprint=footprint), CTX)
    mesh = nodes[0].geometry
    assert len(mesh.faces) > 0 and np.isfinite(mesh.vertices).all()


def test_other_extrudes_the_footprint_around_its_reference_point():
    nodes, flags = build_item(item(base_el=100.0, top_el=103.0, params={"material": "Concrete"}), CTX)
    lo, hi = nodes[0].geometry.bounds
    # 8 x 4 m turned 30 degrees: half-extents 4.464 north and 3.732 east, 3 m tall
    assert flags == [] and nodes[0].material == "Concrete"
    assert np.allclose([lo, hi], [[-4.464, 0, -3.732], [4.464, 3, 3.732]], atol=1e-3)


def test_composite_builds_the_items_parts():
    nodes, flags = build_item(item(type="composite", parts=[PART]), CTX)
    assert flags == [] and [n.name for n in nodes] == ["shell"]
    assert nodes[0].material == "Steel_Structure" and nodes[0].extras == {
        "group": "Shell",
        "shape": "cylinder",
    }
    assert np.allclose(nodes[0].geometry.bounds, [[-0.51, 0, -0.51], [0.51, 2, 0.51]], atol=1e-3)
    _, flags = build_item(item(type="composite"), CTX)
    assert [f.code for f in flags] == ["builder_fallback"]


def test_build_item_is_deterministic():
    a, _ = build_item(item(type="composite", parts=[PART]), CTX)
    b, _ = build_item(item(type="composite", parts=[PART]), CTX)
    assert np.array_equal(a[0].geometry.vertices, b[0].geometry.vertices)


def test_ctx_maps_plant_points_and_fills_heights():
    frame = SiteFrame.model_validate(
        {
            "crs": {"epsg": 32639},
            "origin_crs": [0, 0],
            "plant_north_deg": 0,
            "datum": {"label": "HPFS", "el_m": 100.0},
            "source": {"kind": "assumed"},
        }
    )
    ctx = BuildCtx(grid=PlantGrid(frame))
    it = item(footprint={"kind": "circle", "center": [1000, 500], "d": 10})
    assert ctx.local(it, [1003, 1000], [500, 504]).tolist() == [[0, 3], [4, 0]]  # [x north, z east]
    assert ctx.height(it, 5.0) == (100.0, 105.0, True)
    assert ctx.height(item(base_el=104.5, top_el=110.0), 5.0) == (104.5, 110.0, False)
    assert ctx.height(item(base_el=104.5, top_el=104.0), 5.0) == (104.5, 109.5, True)
    assert CTX.height(item(top_el=7.0), 5.0) == (0.0, 7.0, True)


def test_load_all_skips_missing_and_broken_family_modules(monkeypatch, caplog):
    real = base.importlib.import_module

    def fake(name):
        if name.endswith(".structure"):
            raise RuntimeError("broken builder module")
        return real(name)

    monkeypatch.setattr(base, "_loaded", False)
    monkeypatch.setattr(base, "FAMILY_MODULES", ("structure", "not_built_yet"))
    monkeypatch.setattr(base.importlib, "import_module", fake)
    load_all()  # must not raise
    assert base._loaded and "structure failed to import" in caplog.text
    assert "not_built_yet" not in caplog.text


def test_the_catalogue_is_sorted_and_serialisable():
    types = catalogue()
    order = {f: i for i, f in enumerate(base.FAMILY_ORDER)}
    assert types == sorted(types, key=lambda t: (order[t["family"]], t["type"]))
    other = next(t for t in types if t["type"] == "other")
    assert other["params_schema"]["properties"]["material"]["default"] == "Equipment_Grey"
    json.dumps(types)


def test_placing_instances_keeps_them_proper_rotations():
    t = np.stack([place(i, 0, 0, yaw_deg=15 * i) for i in range(5)])
    assert (np.linalg.det(t[:, :3, :3]) > 0).all()


def test_instanced_cylinders_carry_their_transforms():
    inst = instanced_cyl(0.3, 2.0, [place(i * 5.0, 0, 0) for i in range(4)])
    assert isinstance(inst, Instanced) and inst.transforms.shape == (4, 4, 4) and inst.mesh.is_watertight
```

- [ ] **Step 2: Run them to see them fail**

Run: `cd backend; & $py -m pytest tests/test_builders_base.py -q`
Expected: collection error, `ModuleNotFoundError: No module named 'app.asset_models.builders.base'`.

- [ ] **Step 3: Write the registry**

Create `backend/app/asset_models/builders/base.py`:
```python
"""The builder registry (spec 2026-10-03-plant-model-generator §6; plan 2026-10-03-plant-model-f0 Task 6).

A builder turns one plant item into mesh nodes in the item-local frame: metres, Y up from base_el,
x = plant north, z = plant east, origin at the footprint's reference point (siteframe.footprint_ref).
Builders are pure (no DB, no I/O) and deterministic, and rotate by their footprint's rot_deg
themselves. `build_item` is the only way the assembler calls one: it validates the params, catches
any failure and builds the item as `other` instead, with a `builder_fallback` flag, so one bad item
never fails a GLB.
"""

from __future__ import annotations

import importlib
import inspect
import logging
import threading
from collections.abc import Callable
from dataclasses import dataclass, field
from typing import Literal

import numpy as np
import trimesh
from pydantic import BaseModel, ConfigDict, ValidationError

from app.asset_models.builders.palette import DEFAULT_MATERIAL, PALETTE
from app.asset_models.siteframe import PlantGrid, footprint_ref
from app.asset_models.spec import Item, ItemFlag

log = logging.getLogger(__name__)

Family = Literal["structure", "equipment", "building", "civil", "environment", "fallback"]
FAMILY_ORDER: tuple[str, ...] = ("structure", "equipment", "building", "civil", "environment", "fallback")
FAMILY_MODULES: tuple[str, ...] = ("structure", "equipment", "building", "civil", "environment")
FALLBACK_TYPE = "other"
FALLBACK_HEIGHT_M = 3.0

# The G1 catalogue (spec §6): every type a unit has promised to build, and its family. A type here
# without a registered builder is a validation warning (`builder_missing`) and builds as `other`; a
# type in neither this table nor REGISTRY is an error (`unknown_type`).
PLANNED_TYPES: dict[str, str] = {
    **dict.fromkeys(
        (
            "trestle",
            "jetty_platform",
            "dolphin",
            "pipe_rack",
            "pipe_sleeper",
            "catwalk",
            "walkway",
            "stair_tower",
            "overbridge",
            "platform",
            "gangway",
        ),
        "structure",
    ),
    **dict.fromkeys(
        (
            "tank_lng",
            "vessel_v",
            "vessel_h",
            "storage_tank_small",
            "pump",
            "pump_group",
            "compressor",
            "heater",
            "vaporizer_orv",
            "vaporizer_scv",
            "stack",
            "flare",
            "loading_arm",
            "crane",
            "monitor",
            "generator",
            "transformer",
            "package",
            "nav_aid",
        ),
        "equipment",
    ),
    **dict.fromkeys(("building", "substation", "analyzer_house", "shelter", "gate"), "building"),
    **dict.fromkeys(
        ("road", "paved", "laydown", "parking", "trench", "channel", "basin", "wall", "fence", "revetment"),
        "civil",
    ),
    "other": "fallback",
    "composite": "fallback",
}


class Params(BaseModel):
    """The base of every builder's params model: unknown keys and NaN or infinity are errors, and
    every field must have a default (the builder checks this when it registers)."""

    model_config = ConfigDict(extra="forbid", allow_inf_nan=False)


@dataclass(frozen=True)
class Instanced:
    """One mesh drawn at each of `transforms` ((N, 4, 4), item-local metres): EXT_mesh_gpu_instancing."""

    mesh: trimesh.Trimesh
    transforms: np.ndarray


@dataclass
class MeshNode:
    name: str
    material: str  # a palette.PALETTE name
    geometry: trimesh.Trimesh | Instanced
    extras: dict = field(default_factory=dict)


@dataclass(frozen=True)
class BuildCtx:
    grid: PlantGrid | None
    lod: float = 1.0  # 1 = full detail; builders scale segment counts and instance density by it

    def local(self, item: Item, e, n) -> np.ndarray:
        """Plant [E, N] -> item-local [x, z] metres (x north, z east), origin at footprint_ref."""
        re, rn = footprint_ref(item.footprint)
        e, n = np.asarray(e, dtype=np.float64), np.asarray(n, dtype=np.float64)
        return np.stack([n - rn, e - re], axis=-1)

    def height(self, item: Item, default_m: float) -> tuple[float, float, bool]:
        """(base_el, top_el, defaulted). A missing base_el is the datum (grade), 0 without a grid; a
        missing top_el, or one not above the base, is base + default_m. defaulted is True when either
        was filled in."""
        grade = float(self.grid.frame.datum.el_m) if self.grid is not None else 0.0
        base = float(item.base_el) if item.base_el is not None else grade
        if item.top_el is not None and item.top_el > base:
            return base, float(item.top_el), item.base_el is None
        return base, base + float(default_m), True


@dataclass(frozen=True)
class BuilderDef:
    type: str
    family: str
    params: type[BaseModel]
    fn: Callable[[Item, BuildCtx], list[MeshNode]]
    doc: str
    default_height_m: float


REGISTRY: dict[str, BuilderDef] = {}


def builder(
    type: str, *, family: str, params: type[BaseModel], doc: str, default_height_m: float
) -> Callable:  # noqa: A002
    """Register `fn` as the builder of `type`. Refuses a second builder for a type, a family that is
    not one of FAMILY_ORDER, a planned type in another family, and params that are not a `Params`
    with a default for every field."""

    def register(fn: Callable[[Item, BuildCtx], list[MeshNode]]):
        if type in REGISTRY:
            raise ValueError(f"the builder for {type!r} is registered twice")
        if family not in FAMILY_ORDER:
            raise ValueError(f"{family!r} is not a builder family")
        planned = PLANNED_TYPES.get(type)
        if planned is not None and planned != family:
            raise ValueError(f"{type!r} belongs to the {planned} family")
        if not (inspect.isclass(params) and issubclass(params, Params)):
            raise TypeError("builder params must subclass builders.base.Params")
        try:
            params()
        except ValidationError:
            raise TypeError(f"every param of {type!r} needs a default") from None
        if not default_height_m > 0:
            raise ValueError("default_height_m must be positive")
        REGISTRY[type] = BuilderDef(type, family, params, fn, " ".join(doc.split()), float(default_height_m))
        return fn

    return register


def typed_params(item: Item) -> BaseModel:
    """The item's params validated by its builder's model (KeyError for a type with no builder)."""
    return REGISTRY[item.type].params.model_validate(item.params)


def defaulted_params(item: Item) -> list[str]:
    """The params the item left to their defaults (the CSV `notes` records them, spec §6)."""
    d = REGISTRY.get(item.type)
    return [] if d is None else sorted(set(d.params.model_fields) - set(item.params))


def _check(nodes) -> None:
    if not isinstance(nodes, list) or not nodes:
        raise ValueError("a builder returned no nodes")
    names = set()
    for node in nodes:
        if not isinstance(node, MeshNode) or not node.name or node.name in names:
            raise ValueError("every node needs its own name")
        names.add(node.name)
        if node.material not in PALETTE:
            raise ValueError("a node names a material outside the palette")
        geom = node.geometry
        mesh = geom.mesh if isinstance(geom, Instanced) else geom
        if (
            not isinstance(mesh, trimesh.Trimesh)
            or len(mesh.faces) == 0
            or not np.isfinite(mesh.vertices).all()
        ):
            raise ValueError("a node has an empty or non-finite mesh")
        if isinstance(geom, Instanced):
            t = np.asarray(geom.transforms)
            if t.ndim != 3 or t.shape[1:] != (4, 4) or len(t) == 0 or not np.isfinite(t).all():
                raise ValueError("instancing needs (N, 4, 4) finite transforms")
            if (np.linalg.det(t[:, :3, :3]) <= 1e-12).any():
                raise ValueError("an instance transform is mirrored or flat")


def _fallback(item: Item, ctx: BuildCtx) -> list[MeshNode]:
    from app.asset_models.builders.fallback import footprint_body, last_resort

    d = REGISTRY.get(item.type)
    height = d.default_height_m if d is not None else FALLBACK_HEIGHT_M
    try:
        nodes = footprint_body(item, ctx, material=DEFAULT_MATERIAL, default_height_m=height)
        _check(nodes)
        return nodes
    except Exception:
        return last_resort(item, ctx)


def build_item(item: Item, ctx: BuildCtx) -> tuple[list[MeshNode], list[ItemFlag]]:
    """The item's nodes, and the flags building it raised: [] or one `builder_fallback`. Never raises."""
    load_all()
    d = REGISTRY.get(item.type)
    if d is None:
        reason = (
            f"no builder for {item.type!r} yet"
            if item.type in PLANNED_TYPES
            else f"{item.type!r} is not a builder type"
        )
    else:
        try:
            d.params.model_validate(item.params)
            nodes = d.fn(item, ctx)
            _check(nodes)
            return nodes, []
        except Exception as exc:  # one bad item never fails the GLB (spec §6)
            reason = f"the {item.type} builder failed ({type(exc).__name__})"
            log.info("builder %s fell back to %s (%s)", item.type, FALLBACK_TYPE, type(exc).__name__)
    return _fallback(item, ctx), [ItemFlag(code="builder_fallback", note=reason[:300])]


_load_lock = threading.Lock()
_loaded = False


def load_all() -> None:
    """Import the fallback builders and every family module that exists. A family module that is not
    there yet is skipped silently; one that fails to import is logged and skipped (the app must start)."""
    global _loaded
    if _loaded:
        return
    with _load_lock:
        if _loaded:
            return
        importlib.import_module("app.asset_models.builders.fallback")
        for name in FAMILY_MODULES:
            module = f"app.asset_models.builders.{name}"
            try:
                importlib.import_module(module)
            except ModuleNotFoundError as exc:
                if exc.name != module:
                    log.exception("builder module %s failed to import; its types build as other", name)
            except Exception:
                log.exception("builder module %s failed to import; its types build as other", name)
        _loaded = True


def catalogue() -> list[dict]:
    """[{type, family, doc, default_height_m, params_schema}] of every registered builder, by family
    (FAMILY_ORDER) then type. The item editor and the agent's tool descriptions read it."""
    load_all()
    order = {f: i for i, f in enumerate(FAMILY_ORDER)}
    return [
        {
            "type": d.type,
            "family": d.family,
            "doc": d.doc,
            "default_height_m": d.default_height_m,
            "params_schema": d.params.model_json_schema(),
        }
        for d in sorted(REGISTRY.values(), key=lambda d: (order[d.family], d.type))
    ]
```

- [ ] **Step 4: Write the fallback family**

Create `backend/app/asset_models/builders/fallback.py`:
```python
"""The fallback family (spec 2026-10-03-plant-model-generator §6; plan F0 Task 6).

- `other` extrudes the footprint from base_el to top_el. It is also what `build_item` builds when an
  item's own builder fails, so `footprint_body` must build something for any footprint: a crossing
  outline is mended, a flat one becomes its convex hull, and nothing at all becomes a 1 m box.
- `composite` is made only of the item's M1 parts (item-local millimetres, built by M1's code).
"""

from __future__ import annotations

import numpy as np
from pydantic import field_validator
from shapely.geometry import MultiPoint, Polygon

from app.asset_models.builders.base import BuildCtx, MeshNode, Params, builder
from app.asset_models.builders.geom import box, extrude
from app.asset_models.builders.palette import DEFAULT_MATERIAL, M1_MATERIAL, PALETTE
from app.asset_models.siteframe import footprint_polygon
from app.asset_models.spec import AssetSpec, Item

MIN_AREA_M2 = 1e-4
MIN_HEIGHT_M = 0.1
OTHER_HEIGHT_M = 3.0


def _solid_outline(ring: np.ndarray) -> np.ndarray | None:
    """A buildable [x, z] outline for `ring`, or None when there is no area to build."""
    if len(ring) < 3 or not np.isfinite(ring).all():
        return None
    poly = Polygon(ring)
    if not poly.is_valid:
        poly = poly.buffer(0)  # a crossing outline: its largest piece
        if poly.geom_type == "MultiPolygon":
            poly = max(poly.geoms, key=lambda g: g.area)
    if poly.is_empty or poly.geom_type != "Polygon" or poly.area < MIN_AREA_M2:
        poly = MultiPoint([tuple(p) for p in ring]).convex_hull
    if poly.geom_type != "Polygon" or poly.area < MIN_AREA_M2:
        return None
    return np.asarray(poly.exterior.coords)[:-1]


def footprint_body(
    item: Item, ctx: BuildCtx, *, material: str = DEFAULT_MATERIAL, default_height_m: float = OTHER_HEIGHT_M
) -> list[MeshNode]:
    """The footprint extruded from base_el to top_el (default_height_m when top_el is missing)."""
    base, top, _ = ctx.height(item, default_m=default_height_m)
    h = max(top - base, MIN_HEIGHT_M)
    try:
        ring = ctx.local(item, *footprint_polygon(item.footprint).T)
    except ValueError:
        ring = np.empty((0, 2))
    outline = _solid_outline(ring)
    mesh = extrude(outline, h) if outline is not None else box(1.0, 1.0, h)
    return [MeshNode(name="body", material=material, geometry=mesh)]


def last_resort(item: Item, ctx: BuildCtx) -> list[MeshNode]:
    """A 1 m box at the item's reference point: what an item becomes when even `other` fails."""
    try:
        base, top, _ = ctx.height(item, default_m=OTHER_HEIGHT_M)
        h = max(top - base, MIN_HEIGHT_M)
    except Exception:
        h = OTHER_HEIGHT_M
    return [MeshNode(name="body", material=DEFAULT_MATERIAL, geometry=box(1.0, 1.0, h))]


class OtherParams(Params):
    material: str = DEFAULT_MATERIAL

    @field_validator("material")
    @classmethod
    def _palette_name(cls, v: str) -> str:
        if v not in PALETTE:
            raise ValueError("material must be a palette name")
        return v


@builder(
    "other",
    family="fallback",
    params=OtherParams,
    doc="Anything without its own type: the footprint extruded from base_el to top_el, in one material.",
    default_height_m=OTHER_HEIGHT_M,
)
def build_other(item: Item, ctx: BuildCtx) -> list[MeshNode]:
    p = OtherParams.model_validate(item.params)
    return footprint_body(item, ctx, material=p.material, default_height_m=OTHER_HEIGHT_M)


class CompositeParams(Params):
    pass


@builder(
    "composite",
    family="fallback",
    params=CompositeParams,
    doc=(
        "An item made only of its M1 parts (millimetres; item-local: origin at the footprint's"
        " reference point at base_el, Y up, X plant north, Z plant east). Use it when a detailed"
        " drawing shows the item."
    ),
    default_height_m=1.0,
)
def build_composite(item: Item, ctx: BuildCtx) -> list[MeshNode]:
    from app.asset_models.build import build_meshes  # M1; raises SpecInvalid on a bad part

    if not item.parts:
        raise ValueError("a composite item needs parts")
    meshes = build_meshes(AssetSpec(parts=item.parts))
    return [
        MeshNode(
            name=p.id,
            material=M1_MATERIAL[p.material],
            geometry=meshes[p.id],
            extras={"group": p.group, "shape": p.shape},
        )
        for p in item.parts
    ]
```

- [ ] **Step 5: Run the tests to see them pass**

Run: `cd backend; & $py -m pytest tests/test_builders_base.py tests/test_builders_geom.py -q`
Expected: all pass (`test_builders_base.py`: 22 passed).

- [ ] **Step 6: Lint and commit**

```powershell
cd backend; & $py -m ruff check app/asset_models/builders tests/test_builders_base.py; & $py -m ruff format --check app/asset_models/builders tests/test_builders_base.py; cd ..
git add backend/app/asset_models/builders/base.py backend/app/asset_models/builders/fallback.py backend/tests/test_builders_base.py
git commit -m "feat(plant): builder registry, build_item fallback, other and composite" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: Writing EXT_mesh_gpu_instancing (the ruling A1 builds on)

**Files:**
- Create: `backend/app/asset_models/gltf_instancing.py`
- Test: `backend/tests/test_gltf_instancing.py`

**Interfaces:**
- Consumes: `trimesh.exchange.gltf.export_glb(scene, buffer_postprocessor=...)`; M1's `build.inject_node_extras`; Task 5's `cyl`, `place`.
- Produces: `INSTANCING`, `decompose`, `instancing_postprocessor`, `export_glb_instanced(scene, {node_name: (N, 4, 4)}) -> bytes`. A1 builds each `Instanced` node once in the scene (its prototype mesh, identity node transform within its parent) and passes its transforms here; then it runs `inject_node_extras` as M1 does.

- [ ] **Step 1: Write the failing tests**

Create `backend/tests/test_gltf_instancing.py`:
```python
"""EXT_mesh_gpu_instancing through trimesh's exporter: the ruling A1 builds on (plan pm-f0 Task 7)."""

import io
import json
import struct

import numpy as np
import pytest
import trimesh
from trimesh.transformations import quaternion_matrix

from app.asset_models.build import inject_node_extras
from app.asset_models.builders.geom import cyl, place
from app.asset_models.gltf_instancing import INSTANCING, decompose, export_glb_instanced


def parse(glb: bytes) -> tuple[dict, bytes]:
    (clen,) = struct.unpack_from("<I", glb, 12)
    doc = json.loads(glb[20 : 20 + clen])
    (blen,) = struct.unpack_from("<I", glb, 20 + clen)
    return doc, glb[28 + clen : 28 + clen + blen]


def accessor(doc: dict, binary: bytes, index: int, width: int) -> np.ndarray:
    a = doc["accessors"][index]
    view = doc["bufferViews"][a["bufferView"]]
    raw = binary[view["byteOffset"] : view["byteOffset"] + view["byteLength"]]
    return np.frombuffer(raw, dtype="<f4").reshape(-1, width)[: a["count"]]


def piles_scene() -> trimesh.Scene:
    scene = trimesh.Scene()
    scene.add_geometry(cyl(0.3, 2.0), node_name="piles", geom_name="piles")
    scene.add_geometry(trimesh.creation.box((1, 1, 1)), node_name="deck", geom_name="deck")
    return scene


def test_instanced_nodes_carry_translation_rotation_and_scale():
    xf = np.stack([place(i * 5.0, 0.0, 2.0, yaw_deg=30.0 * i) for i in range(10)])
    xf[3, :3, :3] *= 2.0
    doc, binary = parse(export_glb_instanced(piles_scene(), {"piles": xf}))
    assert INSTANCING in doc["extensionsUsed"]
    node = next(n for n in doc["nodes"] if n.get("name") == "piles")
    att = node["extensions"][INSTANCING]["attributes"]
    t = accessor(doc, binary, att["TRANSLATION"], 3)
    q = accessor(doc, binary, att["ROTATION"], 4)
    s = accessor(doc, binary, att["SCALE"], 3)
    assert np.allclose(t, xf[:, :3, 3]) and doc["accessors"][att["TRANSLATION"]]["max"] == [45.0, 0.0, 2.0]
    for i in range(10):
        x, y, z, w = q[i]
        assert np.allclose(quaternion_matrix([w, x, y, z])[:3, :3] * s[i][None, :], xf[i, :3, :3], atol=1e-5)
    assert "extensions" not in next(n for n in doc["nodes"] if n.get("name") == "deck")


def test_node_extras_and_trimesh_reload_survive_instancing():
    glb = export_glb_instanced(piles_scene(), {"piles": np.stack([place(0, 0, 0), place(5, 0, 0)])})
    glb = inject_node_extras(glb, {"piles": {"id": "p1"}})
    doc, _ = parse(glb)
    node = next(n for n in doc["nodes"] if n.get("name") == "piles")
    assert node["extras"] == {"id": "p1"} and INSTANCING in node["extensions"]
    assert set(trimesh.load(io.BytesIO(glb), file_type="glb").geometry) == {"piles", "deck"}


def test_instancing_is_the_size_lever():
    many = np.stack([place(i * 2.0, 0, 0) for i in range(1000)])
    scene = trimesh.Scene()
    scene.add_geometry(cyl(0.3, 2.0), node_name="p", geom_name="p")
    instanced = len(export_glb_instanced(scene, {"p": many}))
    merged = trimesh.util.concatenate([cyl(0.3, 2.0).apply_transform(m) for m in many])
    assert instanced < 0.2 * len(trimesh.Scene([merged]).export(file_type="glb"))


def test_without_instances_it_is_the_plain_export():
    assert "extensionsUsed" not in parse(export_glb_instanced(piles_scene(), {}))[0]


@pytest.mark.parametrize(
    "xf",
    [
        np.diag([-1.0, 1, 1, 1])[None],  # mirrored
        np.diag([0.0, 1, 1, 1])[None],  # flat
        np.array([[[1, 0.5, 0, 0], [0, 1, 0, 0], [0, 0, 1, 0], [0, 0, 0, 1]]], float),  # sheared
        np.full((1, 4, 4), np.nan),
        np.zeros((0, 4, 4)),
    ],
)
def test_transforms_that_are_not_trs_are_refused(xf):
    with pytest.raises(ValueError):
        decompose(xf)


def test_an_unknown_node_is_refused():
    with pytest.raises(ValueError, match="no node named 'nope'"):
        export_glb_instanced(piles_scene(), {"nope": np.stack([place(0, 0, 0)])})
```

- [ ] **Step 2: Run them to see them fail**

Run: `cd backend; & $py -m pytest tests/test_gltf_instancing.py -q`
Expected: collection error, `ModuleNotFoundError: No module named 'app.asset_models.gltf_instancing'`.

- [ ] **Step 3: Write the post-processor**

Create `backend/app/asset_models/gltf_instancing.py`:
```python
"""EXT_mesh_gpu_instancing for trimesh's GLB exporter (plan 2026-10-03-plant-model-f0 Task 7).

trimesh 4.12 writes no instancing extension. Its `export_glb(buffer_postprocessor=...)` hands over
the buffer items and the glTF tree after the meshes are written and before the buffer views are
laid out, so the post-processor here appends one TRANSLATION, ROTATION and SCALE accessor per
instanced node and marks the node with the extension. The node keeps its mesh: a loader without the
extension (trimesh itself) still draws the prototype once, at the node. M1's `inject_node_extras`
rewrites only the JSON chunk, so it can run on the result afterwards.
"""

from __future__ import annotations

from collections.abc import Callable

import numpy as np
import trimesh
from trimesh.transformations import quaternion_from_matrix

INSTANCING = "EXT_mesh_gpu_instancing"
_FLOAT = 5126  # glTF componentType FLOAT


def decompose(transforms) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    """(N, 4, 4) -> translation (N, 3), rotation quaternion xyzw (N, 4), scale (N, 3), float32.

    Raises ValueError for a non-finite, mirrored, flat or sheared transform: none of them can be
    written as translation, rotation and scale."""
    t = np.asarray(transforms, dtype=np.float64)
    if t.ndim != 3 or t.shape[1:] != (4, 4) or len(t) == 0 or not np.isfinite(t).all():
        raise ValueError("instancing needs (N, 4, 4) finite transforms")
    m = t[:, :3, :3]
    scale = np.linalg.norm(m, axis=1)  # column lengths
    if (scale <= 1e-12).any() or (np.linalg.det(m) <= 0).any():
        raise ValueError("an instance transform is mirrored or flat")
    rot = m / scale[:, None, :]
    if not np.allclose(np.einsum("nji,njk->nik", rot, rot), np.eye(3), atol=1e-5):
        raise ValueError("a sheared transform cannot be instanced")
    quats = np.empty((len(t), 4))
    for i, r in enumerate(rot):
        r4 = np.eye(4)
        r4[:3, :3] = r
        w, x, y, z = quaternion_from_matrix(r4)
        q = np.array([x, y, z, w])
        q /= np.linalg.norm(q)
        quats[i] = -q if q[3] < 0 else q
    return t[:, :3, 3].astype("<f4"), quats.astype("<f4"), scale.astype("<f4")


def instancing_postprocessor(instances: dict[str, np.ndarray]) -> Callable[[dict, dict], None]:
    """A `buffer_postprocessor` that instances each named node at its (N, 4, 4) transforms."""
    decomposed = {name: decompose(xf) for name, xf in instances.items()}

    def post(buffer_items, tree) -> None:
        nodes = {n.get("name"): n for n in tree.get("nodes", [])}
        missing = sorted(set(decomposed) - set(nodes))
        if missing:
            raise ValueError(f"no node named {missing[0]!r} to instance")
        accessors = tree["accessors"]  # an OrderedDict until trimesh flattens it after this hook
        for name, (trans, quat, scale) in decomposed.items():
            attributes = {}
            for key, arr in (("TRANSLATION", trans), ("ROTATION", quat), ("SCALE", scale)):
                data = np.ascontiguousarray(arr).tobytes()
                buffer_key = f"{INSTANCING}:{name}:{key}"
                buffer_items[buffer_key] = data + b"\0" * (-len(data) % 4)
                accessor = {
                    "bufferView": len(buffer_items) - 1,
                    "componentType": _FLOAT,
                    "count": int(len(arr)),
                    "type": "VEC4" if key == "ROTATION" else "VEC3",
                }
                if key == "TRANSLATION":
                    accessor["min"] = arr.min(axis=0).tolist()
                    accessor["max"] = arr.max(axis=0).tolist()
                accessors[buffer_key] = accessor
                attributes[key] = list(accessors.keys()).index(buffer_key)
            nodes[name].setdefault("extensions", {})[INSTANCING] = {"attributes": attributes}
        if decomposed:
            tree["extensionsUsed"] = sorted(set(tree.get("extensionsUsed", [])) | {INSTANCING})

    return post


def export_glb_instanced(scene: trimesh.Scene, instances: dict[str, np.ndarray]) -> bytes:
    """`scene` as GLB bytes, with each node named in `instances` drawn at its transforms."""
    from trimesh.exchange.gltf import export_glb

    return export_glb(scene, buffer_postprocessor=instancing_postprocessor(instances) if instances else None)
```

- [ ] **Step 4: Run the tests to see them pass**

Run: `cd backend; & $py -m pytest tests/test_gltf_instancing.py -q`
Expected: `10 passed` (1 000 instanced piles export in about 42 KB against about 670 KB merged).

- [ ] **Step 5: Lint and commit**

```powershell
cd backend; & $py -m ruff check app/asset_models/gltf_instancing.py tests/test_gltf_instancing.py; & $py -m ruff format --check app/asset_models/gltf_instancing.py tests/test_gltf_instancing.py; cd ..
git add backend/app/asset_models/gltf_instancing.py backend/tests/test_gltf_instancing.py
git commit -m "feat(plant): EXT_mesh_gpu_instancing through trimesh's GLB exporter" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 8: Plant validation, and large specs validated in the GLB job

**Files:**
- Modify: `backend/app/asset_models/validate.py` (whole file), `backend/app/asset_models/service.py`, `backend/app/asset_models/jobs_glb.py` (whole file), `backend/app/asset_models/router.py` (`get_asset_model_version`, imports)
- Test: `backend/tests/test_plant_validate.py`

**Interfaces:**
- Consumes: Task 6's `PLANNED_TYPES`, `REGISTRY`, `load_all` (imported lazily inside `_check_plant`, so `validate` → `builders.base` never cycles through `build.py`); Task 3's `footprint_polygon`.
- Produces: `validate.ASYNC_VALIDATE_ITEMS`, `FALLBACK_CODES`, `MAX_LISTED`, `Report.blocking`, `Report.ok`, `is_large`, `as_dicts`, `validation_meta`; `service.version_warnings(row, spec)`; `meta["validation"]` on large versions. Codes as in the header.

- [ ] **Step 1: Write the failing tests**

Create `backend/tests/test_plant_validate.py`:
```python
"""Plant spec validation (spec 2026-10-03-plant-model-generator §5; plan pm-f0 Task 8): errors that
block, item problems the GLB survives, warnings, and large specs validated in the GLB job."""

import math
import time

import pytest

from app.asset_models.builders import base
from app.asset_models.spec import AssetSpec
from app.asset_models.validate import ASYNC_VALIDATE_ITEMS, is_large, validate

PART = {
    "id": "shell",
    "name": "Shell",
    "group": "Shell",
    "shape": "cylinder",
    "params": {"id": 1000, "thickness": 10, "height": 2000},
    "source": {"kind": "assumed"},
}


def item(i, **over) -> dict:
    raw = {
        "id": f"i{i}",
        "name": f"Item {i}",
        "type": "other",
        "footprint": {"kind": "rect", "center": [i * 20.0, 0.0], "size": [8, 4]},
        "source": {"kind": "assumed"},
    }
    raw.update(over)
    return raw


def spec(*items, environment=()) -> AssetSpec:
    return AssetSpec.model_validate({"items": list(items), "environment": list(environment)})


def codes(issues) -> list[tuple[str, str]]:
    return [(i.code, i.part_id) for i in issues]


@pytest.fixture
def no_tank_builder(monkeypatch):
    base.load_all()
    scratch = dict(base.REGISTRY)
    scratch.pop("tank_lng", None)
    monkeypatch.setattr(base, "REGISTRY", scratch)


def test_an_m1_spec_reports_as_before():
    report = validate(AssetSpec.model_validate({"parts": [PART]}))
    assert report.ok and report.errors == [] and report.warnings == []


def test_a_clean_plant_spec_is_ok():
    report = validate(spec(item(1), item(2)))
    assert report.ok and report.errors == [] and report.warnings == []


def test_blocking_errors():
    report = validate(
        spec(
            item(1),
            item(1),
            item(2, type="made_up"),
            item(3, base_el=10.0, top_el=5.0),
            item(
                4, type="composite", parts=[{**PART, "params": {"id": 1000, "thickness": 600, "height": 10}}]
            ),
        )
    )
    assert not report.ok
    assert codes(report.blocking) == [
        ("duplicate_item_id", "i1"),
        ("unknown_type", "i2"),
        ("bad_heights", "i3"),
        ("bad_geometry", "i4/shell"),
    ]


def test_item_problems_the_glb_survives_are_errors_that_do_not_block():
    report = validate(
        spec(
            item(1, footprint={"kind": "polygon", "pts": [[0, 0], [1, 1], [1, 0], [0, 1]]}),
            item(2, footprint={"kind": "line", "pts": [[5, 5], [5, 5]], "width": 2}),
            item(3, params={"material": "Chrome"}),
            item(4, params={"material": math.nan}),
        )
    )
    assert report.ok and report.blocking == []
    assert codes(report.errors) == [
        ("bad_footprint", "i1"),
        ("bad_footprint", "i2"),
        ("invalid_params", "i3"),
        ("invalid_params", "i4"),
    ]
    assert "Chrome" not in report.errors[2].message  # never echoes the input


def test_warnings(no_tank_builder):
    report = validate(
        spec(
            item(1, type="tank_lng"),
            item(2, tag="T-2", confidence="high"),
            item(3, flags=[{"code": "plan_offset", "value": 1.5}, {"code": "height_mismatch"}]),
            item(4, footprint={"kind": "rect", "center": [80.5, 0.0], "size": [8, 4]}),
            item(
                5,
                type="composite",
                parts=[PART],
                footprint={"kind": "rect", "center": [80.0, 0.0], "size": [8, 4]},
            ),
        )
    )
    assert report.ok
    assert codes(report.warnings) == [
        ("builder_missing", "i1"),
        ("assumed_high_confidence", "i2"),
        ("item_flags", "i3"),
    ]  # i4 and i5 overlap but are different types
    overlapping = validate(
        spec(
            item(4, footprint={"kind": "rect", "center": [80.5, 0.0], "size": [8, 4]}),
            item(9, footprint={"kind": "rect", "center": [80.0, 0.0], "size": [8, 4]}),
        )
    )
    assert codes(overlapping.warnings) == [("overlap", "i4")]


def test_environment_outlines_and_ids_are_checked():
    sea = {
        "id": "sea",
        "kind": "sea",
        "pts": [[0, 0], [100, 0], [100, 100]],
        "el": 92.5,
        "source": {"kind": "assumed"},
    }
    bowtie = {**sea, "id": "land", "kind": "land", "pts": [[0, 0], [1, 1], [1, 0], [0, 1]]}
    report = validate(spec(environment=[sea, sea, bowtie]))
    assert codes(report.errors) == [("duplicate_env_id", "sea"), ("bad_footprint", "land")]
    assert not report.ok


def test_large_means_over_200_items_and_features():
    assert not is_large(spec(*[item(i) for i in range(ASYNC_VALIDATE_ITEMS)]))
    assert is_large(spec(*[item(i) for i in range(ASYNC_VALIDATE_ITEMS + 1)]))


def test_two_thousand_items_validate_quickly():
    big = spec(*[item(i) for i in range(2000)])
    t = time.perf_counter()
    assert validate(big).ok
    assert time.perf_counter() - t < 10.0


# ----- over HTTP: the request path stays schema-only for a large spec (Review Focus 2)


@pytest.fixture
def model_url(client, project_id):
    base_url = f"/api/v1/projects/{project_id}/asset-models"
    return f"{base_url}/{client.post(base_url, json={'name': 'Plant'}).json()['id']}"


def test_a_small_spec_with_a_blocking_error_is_refused_at_once(client, model_url):
    r = client.post(f"{model_url}/versions", json={"spec": {"items": [item(1, type="made_up")]}})
    assert r.status_code == 422, r.text
    assert r.json()["error"]["details"]["errors"][0]["code"] == "unknown_type"


def test_a_small_spec_shows_its_fallback_errors_as_warnings(client, model_url, project_id, wait_job):
    bowtie = item(2, footprint={"kind": "polygon", "pts": [[0, 0], [1, 1], [1, 0], [0, 1]]})
    r = client.post(f"{model_url}/versions", json={"spec": {"items": [item(1), bowtie]}})
    assert r.status_code == 201, r.text
    wait_job(project_id, r.json()["job"]["id"])
    detail = client.get(f"{model_url}/versions/1").json()
    assert [(w["code"], w["part_id"]) for w in detail["warnings"]] == [("bad_footprint", "i2")]


def test_a_large_spec_is_validated_in_its_glb_job(client, model_url, project_id, wait_job):
    items = [item(i) for i in range(ASYNC_VALIDATE_ITEMS + 1)]
    items[7] = item(7, base_el=10.0, top_el=5.0)
    r = client.post(f"{model_url}/versions", json={"spec": {"items": items}})
    assert r.status_code == 201, r.text  # not refused in the request
    job = wait_job(project_id, r.json()["job"]["id"])
    assert job["state"] == "failed"
    version = client.get(f"{model_url}/versions/1").json()
    assert version["glb_status"] == "failed"
    assert version["meta"]["validation"]["error_count"] == 1
    assert [(w["code"], w["part_id"]) for w in version["warnings"]] == [("bad_heights", "i7")]


def test_a_large_valid_spec_builds_and_keeps_its_report(client, model_url, project_id, wait_job):
    items = [item(i) for i in range(ASYNC_VALIDATE_ITEMS + 1)]
    items[3] = item(3, flags=[{"code": "plan_offset"}])
    r = client.post(f"{model_url}/versions", json={"spec": {"items": items}})
    assert wait_job(project_id, r.json()["job"]["id"])["state"] == "succeeded"
    version = client.get(f"{model_url}/versions/1").json()
    assert version["glb_status"] == "ready"
    assert version["meta"]["validation"]["warning_count"] == 1
    assert [(w["code"], w["part_id"]) for w in version["warnings"]] == [("item_flags", "i3")]
```

- [ ] **Step 2: Run them to see them fail**

Run: `cd backend; & $py -m pytest tests/test_plant_validate.py -q`
Expected: collection error, `ImportError: cannot import name 'ASYNC_VALIDATE_ITEMS' from 'app.asset_models.validate'`.

- [ ] **Step 3: Rewrite `validate.py`**

Replace the whole of `backend/app/asset_models/validate.py` with (M1's part checks move unchanged into `_check_parts`, which also checks an item's parts with ids `"<item>/<part>"`):
```python
"""Spec validation (spec 2026-10-02 §6.3; plant items: spec 2026-10-03-plant-model-generator §5).

Errors block the GLB, except the item problems the GLB survives (FALLBACK_CODES): such an item is
built as `other` with a `builder_fallback` flag (spec §6, "one bad item never fails the GLB"), so
they are reported and never blocking. Warnings are shown, not enforced. A spec with more than
ASYNC_VALIDATE_ITEMS items and environment features is validated in the GLB job, not the request.
"""

from __future__ import annotations

from collections import Counter, defaultdict
from dataclasses import dataclass, field

import numpy as np
from pydantic import ValidationError
from shapely import STRtree
from shapely.geometry import Polygon

from app.asset_models.placement import PlacementError, part_transform
from app.asset_models.shapes import build_shape
from app.asset_models.spec import AssetSpec

OVERLAP_SHARE = 0.5
RESERVED_ID = "world"  # trimesh names the GLB root node "world"
ASYNC_VALIDATE_ITEMS = 200
FALLBACK_CODES = frozenset({"invalid_params", "bad_footprint"})
MAX_LISTED = 500  # issues kept in a version's meta["validation"]


@dataclass(frozen=True)
class Issue:
    code: str
    part_id: str | None  # a part id, an item id, an environment id, or "<item id>/<part id>"
    message: str


@dataclass
class Report:
    errors: list[Issue] = field(default_factory=list)
    warnings: list[Issue] = field(default_factory=list)

    @property
    def blocking(self) -> list[Issue]:
        return [e for e in self.errors if e.code not in FALLBACK_CODES]

    @property
    def ok(self) -> bool:
        return not self.blocking


def is_large(spec: AssetSpec) -> bool:
    """True when the spec is validated in the GLB job instead of the request (spec §5 "Size")."""
    return len(spec.items) + len(spec.environment) > ASYNC_VALIDATE_ITEMS


def as_dicts(issues: list[Issue]) -> list[dict]:
    return [{"code": i.code, "part_id": i.part_id, "message": i.message} for i in issues]


def validation_meta(report: Report) -> dict:
    """What the GLB job stores in a large version's meta["validation"] (the detail route reads it)."""
    return {
        "errors": as_dicts(report.errors[:MAX_LISTED]),
        "error_count": len(report.errors),
        "warnings": as_dicts(report.warnings[:MAX_LISTED]),
        "warning_count": len(report.warnings),
    }


def _geometry_error(part) -> str | None:
    p = part.typed_params()
    if part.shape == "cylinder" and p.thickness >= p.id / 2:
        return "thickness must be less than the radius"
    if part.shape == "cone" and p.thickness >= p.d_bottom / 2:
        return "thickness must be less than the bottom radius"
    if part.shape == "nozzle" and (p.flange_t >= p.projection or p.flange_od <= p.od):
        return "the flange must be thinner than the projection and wider than the pipe"
    if part.shape == "head_torispherical" and not (p.knuckle_r < p.crown_r and p.knuckle_r < p.id / 2):
        return "the knuckle radius must be smaller than the crown radius and the shell radius"
    return None


def validate(spec: AssetSpec) -> Report:
    report = Report()
    _check_parts(spec.parts, report)
    if spec.items or spec.environment:
        _check_plant(spec, report)
    return report


def _check_parts(parts, report: Report, prefix: str | None = None) -> None:
    def pid(part_id: str) -> str:
        return f"{prefix}/{part_id}" if prefix else part_id

    counts = Counter(p.id for p in parts)
    for part_id, n in sorted(counts.items()):
        if n > 1:
            report.errors.append(Issue("duplicate_id", pid(part_id), f"{n} parts share the id {part_id!r}"))
    by_id = {p.id: p for p in parts}
    boxes: dict[str, tuple[np.ndarray, np.ndarray]] = {}
    for part in parts:
        if part.id == RESERVED_ID:
            report.errors.append(
                Issue("reserved_id", pid(part.id), f"{RESERVED_ID!r} is reserved; pick another id")
            )
            continue
        if part.placement.host == part.id:
            report.errors.append(Issue("host_self", pid(part.id), "a part cannot be its own host"))
            continue
        msg = _geometry_error(part)
        if msg:
            report.errors.append(Issue("bad_geometry", pid(part.id), msg))
            continue
        try:
            T = part_transform(part, by_id)
        except PlacementError as e:
            code = "host_missing" if "is not a part" in str(e) else "host_wrong_kind"
            report.errors.append(Issue(code, pid(part.id), str(e)))
            continue
        except Exception:
            report.errors.append(Issue("bad_geometry", pid(part.id), "could not build this part's geometry"))
            continue
        try:
            mesh = build_shape(part.shape, part.typed_params())
            mesh.apply_transform(T)
            lo, hi = np.asarray(mesh.bounds[0]), np.asarray(mesh.bounds[1])
            if len(mesh.faces) == 0 or not (np.isfinite(lo).all() and np.isfinite(hi).all()):
                raise ValueError("empty or non-finite mesh")
        except Exception:
            report.errors.append(Issue("bad_geometry", pid(part.id), "could not build this part's geometry"))
            continue
        if counts[part.id] == 1:
            boxes[part.id] = (lo, hi)
        if part.source.kind == "assumed" and part.confidence == "high":
            report.warnings.append(
                Issue("assumed_high_confidence", pid(part.id), "an assumed part is marked high confidence")
            )
    ids = sorted(boxes)
    for i, a in enumerate(ids):
        for b in ids[i + 1 :]:
            share = _overlap_share(boxes[a], boxes[b])
            if share > OVERLAP_SHARE:
                report.warnings.append(
                    Issue("overlap", pid(a), f"{a!r} and {b!r} overlap by {share:.0%} (a duplicate?)")
                )


def _overlap_share(a, b) -> float:
    lo = np.maximum(a[0], b[0])
    hi = np.minimum(a[1], b[1])
    if np.any(hi <= lo):
        return 0.0
    inter = float(np.prod(hi - lo))
    # against the LARGER box: near-identical boxes score ~1, a small part inside a big host scores low
    larger = max(float(np.prod(a[1] - a[0])), float(np.prod(b[1] - b[0])))
    return inter / larger if larger > 0 else 0.0


def _outline(fp) -> Polygon | None:
    """The footprint as a valid polygon with area, or None (a crossing outline, a line of no length)."""
    from app.asset_models.siteframe import footprint_polygon

    try:
        poly = Polygon(footprint_polygon(fp))
    except Exception:
        return None
    return poly if poly.is_valid and poly.area > 1e-6 else None


def _params_message(exc: ValidationError) -> str:
    parts = [
        f"{'.'.join(str(x) for x in e['loc']) or 'params'}: {e['msg']}"
        for e in exc.errors(include_input=False, include_url=False, include_context=False)
    ]
    return ("params " + "; ".join(parts))[:300]


def _check_plant(spec: AssetSpec, report: Report) -> None:
    from app.asset_models.builders.base import PLANNED_TYPES, REGISTRY, load_all

    load_all()
    counts = Counter(i.id for i in spec.items)
    for item_id, n in sorted(counts.items()):
        if n > 1:
            report.errors.append(Issue("duplicate_item_id", item_id, f"{n} items share the id {item_id!r}"))
    outlines: dict[str, list[tuple[str, Polygon]]] = defaultdict(list)
    for item in spec.items:
        d = REGISTRY.get(item.type)
        if d is None and item.type in PLANNED_TYPES:
            report.warnings.append(
                Issue("builder_missing", item.id, f"no builder for {item.type!r} yet; it builds as other")
            )
        elif d is None:
            report.errors.append(Issue("unknown_type", item.id, f"{item.type!r} is not a builder type"))
        else:
            try:
                d.params.model_validate(item.params)
            except ValidationError as exc:
                report.errors.append(Issue("invalid_params", item.id, _params_message(exc)))
        if item.base_el is not None and item.top_el is not None and item.top_el < item.base_el:
            report.errors.append(Issue("bad_heights", item.id, "top_el is below base_el"))
        poly = _outline(item.footprint)
        if poly is None:
            report.errors.append(
                Issue("bad_footprint", item.id, "the footprint crosses itself or has no area")
            )
        elif counts[item.id] == 1:
            outlines[item.type].append((item.id, poly))
        if item.parts:
            _check_parts(item.parts, report, prefix=item.id)
        if item.tag and item.confidence == "high" and item.source.kind == "assumed":
            report.warnings.append(
                Issue(
                    "assumed_high_confidence", item.id, "a tagged item from an assumed source is marked high"
                )
            )
        if item.flags:
            codes = ", ".join(sorted({f.code for f in item.flags}))
            report.warnings.append(Issue("item_flags", item.id, f"flagged: {codes}"))
    for type_ in sorted(outlines):
        _item_overlaps(outlines[type_], report)
    env_counts = Counter(f.id for f in spec.environment)
    for env_id, n in sorted(env_counts.items()):
        if n > 1:
            report.errors.append(
                Issue("duplicate_env_id", env_id, f"{n} environment features share the id {env_id!r}")
            )
    for feature in spec.environment:
        poly = Polygon(feature.pts)
        if not poly.is_valid or poly.area <= 1e-6:
            report.errors.append(
                Issue("bad_footprint", feature.id, "the outline crosses itself or has no area")
            )


def _item_overlaps(polys: list[tuple[str, Polygon]], report: Report) -> None:
    """Same-type items whose footprints overlap by more than OVERLAP_SHARE of the larger (a duplicate?)."""
    tree = STRtree([p for _, p in polys])
    for i, (a, pa) in enumerate(polys):
        for j in sorted(int(k) for k in tree.query(pa)):
            if j <= i:
                continue
            b, pb = polys[j]
            share = pa.intersection(pb).area / max(pa.area, pb.area)
            if share > OVERLAP_SHARE:
                report.warnings.append(
                    Issue("overlap", a, f"{a!r} and {b!r} overlap by {share:.0%} (a duplicate?)")
                )
```

- [ ] **Step 4: Keep the request path schema-only for large specs**

In `backend/app/asset_models/service.py`, find:
```python
from app.asset_models.validate import validate
```
Replace with:
```python
from app.asset_models.validate import FALLBACK_CODES, as_dicts, is_large, validate
```
Find:
```python
def issues(report_list) -> list[dict]:
    return [{"code": i.code, "part_id": i.part_id, "message": i.message} for i in report_list]
```
Replace with:
```python
def issues(report_list) -> list[dict]:
    return as_dicts(report_list)


def version_warnings(row, spec: AssetSpec) -> list[dict]:
    """A version detail's `warnings`: the warnings, plus the item problems the GLB survives
    (FALLBACK_CODES). A large spec's come from its GLB job (meta["validation"]), [] until it ran."""
    if is_large(spec):
        found = (row.meta or {}).get("validation") or {}
        return list(found.get("errors", [])) + list(found.get("warnings", []))
    report = validate(spec)
    return issues([e for e in report.errors if e.code in FALLBACK_CODES] + report.warnings)
```
Find (in `add_version`):
```python
    report = validate(spec)
    if not report.ok:
        raise AppError("invalid_spec", "The model spec has errors.", 422, {"errors": issues(report.errors)})
```
Replace with:
```python
    # A large spec is validated in its GLB job, not here: the request stays schema-only (spec §5).
    if not is_large(spec):
        report = validate(spec)
        if not report.ok:
            raise AppError("invalid_spec", "The model spec has errors.", 422, {"errors": issues(report.errors)})
```

- [ ] **Step 5: Validate large specs in the GLB job**

Replace the whole of `backend/app/asset_models/jobs_glb.py` with:
```python
"""`asset_model_glb` (spec §6.4): build the GLB of one stored version, atomically.

A spec of more than 200 items and environment features is validated here, not in the request
(spec 2026-10-03-plant-model-generator §5): its report goes to the version's meta["validation"],
and blocking errors fail the version without building it.
"""

from __future__ import annotations

import os

from app.asset_models import store
from app.asset_models.build import build_glb
from app.asset_models.spec import AssetSpec
from app.asset_models.validate import is_large, validate, validation_meta
from app.jobs.cancellation import JobFailure
from app.jobs.registry import register_job_type

GLB_JOB = "asset_model_glb"


class _SpecErrors(Exception):
    """The large spec has blocking errors (its report is already in hand)."""


def _mark_failed(ctx, meta: dict | None = None) -> None:
    with ctx.project.session() as s:
        v = store.get_version(s, ctx.params["model_id"], int(ctx.params["version"]))
        v.glb_status = "failed"
        if meta is not None:
            v.meta = meta
    ctx.publish("asset_models.changed", {"asset_model_ids": [ctx.params["model_id"]]})


def _cancelled_before_start(ctx) -> None:
    _mark_failed(ctx)


@register_job_type(GLB_JOB, on_cancelled_before_start=_cancelled_before_start)
def run_glb(ctx) -> dict:
    mid, n = ctx.params["model_id"], int(ctx.params["version"])
    ctx.progress(0, f"Building the 3D model for version {n}")
    out = store.version_glb_path(ctx.project, mid, n)
    tmp = out.with_name(out.name + ".tmp")
    checked = None
    try:
        with ctx.project.session() as s:
            spec = AssetSpec.model_validate(store.get_version(s, mid, n).spec)
        if is_large(spec):
            ctx.progress(0.02, f"Checking the model spec of version {n}")
            report = validate(spec)
            checked = validation_meta(report)
            if not report.ok:
                raise _SpecErrors()
        glb, meta = build_glb(spec)
        out.parent.mkdir(parents=True, exist_ok=True)
        tmp.write_bytes(glb)
        os.replace(tmp, out)
    except _SpecErrors:
        _mark_failed(ctx, meta={"validation": checked})
        raise JobFailure("The model spec has errors; open the version to see them.") from None
    except Exception as e:
        tmp.unlink(missing_ok=True)
        _mark_failed(ctx)
        raise JobFailure(f"The 3D model could not be built: {type(e).__name__}") from None
    with ctx.project.session() as s:
        v = store.get_version(s, mid, n)
        v.glb_status, v.meta = "ready", ({**meta, "validation": checked} if checked else meta)
    ctx.publish("asset_models.changed", {"asset_model_ids": [mid]})
    ctx.progress(1, f"Built version {n}: {meta['triangles']:,} triangles")
    return {"model_id": mid, "version": n}
```

- [ ] **Step 6: Read a version's warnings through `version_warnings`**

In `backend/app/asset_models/router.py`, `get_asset_model_version`, find:
```python
        warnings = [SpecIssueOut(**i) for i in service.issues(validate(spec).warnings)]
```
Replace with:
```python
        warnings = [SpecIssueOut(**i) for i in service.version_warnings(row, spec)]
```
and delete the now unused import line `from app.asset_models.validate import validate`.

- [ ] **Step 7: Run the new tests and every M1 asset-model suite**

Run: `cd backend; & $py -m pytest tests/test_plant_validate.py tests/test_asset_model_validate.py tests/test_asset_model_build.py tests/test_asset_models_glb_job.py tests/test_asset_models_api.py tests/test_asset_model_run_job.py tests/test_asset_model_agent_tools.py -q`
Expected: all pass (`test_plant_validate.py`: 12 passed; `test_spec_load_failure_marks_failed` still sees `JobFailure` naming `ValueError`, because the spec load stays inside the job's `try`).

- [ ] **Step 8: Lint and commit**

```powershell
cd backend; & $py -m ruff check app/asset_models tests/test_plant_validate.py; & $py -m ruff format --check app/asset_models tests/test_plant_validate.py; cd ..
git add backend/app/asset_models/validate.py backend/app/asset_models/service.py backend/app/asset_models/jobs_glb.py backend/app/asset_models/router.py backend/tests/test_plant_validate.py
git commit -m "feat(plant): plant spec validation, large specs validated in the GLB job" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 9: The G1 contract

**Files:**
- Modify: `contract/openapi.yaml`, `contract/client/schema.d.ts` (generated), `contract/client/index.ts`
- Modify: `frontend/src/assetmodels/run/RunTab.tsx`, every frontend `AssetModel` object literal (`frontend/src/test/assetModelFixtures.ts`, `frontend/src/test/assetFindingFixtures.ts` when present, `frontend/e2e/fixtures/assetModels.ts`)
- Test: `backend/tests/test_plant_contract.py`

**Interfaces:**
- Consumes: Task 2's models (the parity test reads them).
- Produces: operations `listAssetModelItems`, `getAssetModelItem`, `getAssetModelCsv`, `listAssetModelRunPackages`, `createDrawingPages`, `listUnimportedDrawings`, `getSiteScene`, `getAssetModelCatalogue`; parameter `assetItemId` (`itemId`); schemas `AssetModelKind`, `PlantCrs`, `PlantDatum`, `PlantCloudDatum`, `PlantFrame`, `PlantPoint`, `ItemFootprintRect/Circle/Polygon/Line`, `ItemFootprint`, `ItemFlagCode`, `ItemFlag`, `AssetItem`, `EnvFeature`, `AssetItemRow`, `AssetItemPage`, `AssetBuilderType`, `AssetModelCatalogue`, `SiteModelPackage`, `SiteModelPackageList`, `AssetModelRunPackages`, `AssetModelRunStageUsage`, `AssetModelRunUsageByStage`, `AssetModelRunLimits`, `DrawingPagesCreate`, `DrawingPagesWithJob`, `UnimportedDrawing`, `UnimportedDrawingList`, `SiteSceneFrame`, `SiteSceneModel`, `SiteSceneOrtho`, `SiteSceneCloud`, `SiteSceneDrawing`, `SiteSceneCount`, `SiteScene`; field additions listed in Steps 6–12.
- After this task `tests/test_contract.py` is red until Task 10 routes the operations; run only this task's tests here.

- [ ] **Step 1: Write the failing YAML test**

Create `backend/tests/test_plant_contract.py`:
```python
"""Plant model F0: contract/openapi.yaml carries every operation and schema of spec
2026-10-03-plant-model-generator §10, and its plant schemas match the backend's spec models field for
field (plan 2026-10-03-plant-model-f0 Task 9). These tests read only the YAML; test_contract.py checks
the routing and `pnpm -C contract check` lints it.
"""

import typing
from pathlib import Path

import pytest
import yaml

from app.asset_models import spec as S

ROOT = Path(__file__).resolve().parents[2]
SPEC = ROOT / "contract" / "openapi.yaml"
P = "/api/v1/projects/{projectId}"
AM = P + "/asset-models/{assetModelId}"

# operationId -> (method, path, the unit that replaces its 501 stub; F0 = live in F0)
PLANT_OPERATIONS: dict[str, tuple[str, str, str]] = {
    "listAssetModelItems": ("get", AM + "/versions/{version}/items", "A1"),
    "getAssetModelItem": ("get", AM + "/versions/{version}/items/{itemId}", "A1"),
    "getAssetModelCsv": ("get", AM + "/versions/{version}/csv", "A1"),
    "listAssetModelRunPackages": ("get", AM + "/runs/{runId}/packages", "R1"),
    "createDrawingPages": ("post", P + "/drawings/pages", "I1"),
    "listUnimportedDrawings": ("get", P + "/drawings/unimported", "I1"),
    "getSiteScene": ("get", P + "/site-scene", "S1"),
    "getAssetModelCatalogue": ("get", "/api/v1/asset-models/catalogue", "F0"),
}
# contract schema -> the backend spec model it mirrors
MIRRORS = {
    "PlantFrame": S.SiteFrame,
    "PlantCrs": S.SiteCrs,
    "PlantDatum": S.Datum,
    "PlantCloudDatum": S.CloudDatum,
    "ItemFootprintRect": S.RectFootprint,
    "ItemFootprintCircle": S.CircleFootprint,
    "ItemFootprintPolygon": S.PolygonFootprint,
    "ItemFootprintLine": S.LineFootprint,
    "ItemFlag": S.ItemFlag,
    "AssetItem": S.Item,
    "EnvFeature": S.EnvFeature,
    "AssetPartSource": S.Source,
    "AssetSpec": S.AssetSpec,
}


@pytest.fixture(scope="module")
def doc() -> dict:
    return yaml.safe_load(SPEC.read_text("utf-8"))


@pytest.fixture(scope="module")
def schemas(doc) -> dict:
    return doc["components"]["schemas"]


def test_every_plant_operation_is_in_the_contract(doc):
    found = {
        op["operationId"]: (method, path)
        for path, ops in doc["paths"].items()
        for method, op in ops.items()
        if isinstance(op, dict) and "operationId" in op
    }
    for op_id, (method, path, _unit) in PLANT_OPERATIONS.items():
        assert found.get(op_id) == (method, path), op_id


@pytest.mark.parametrize("name", sorted(MIRRORS))
def test_each_plant_schema_mirrors_its_spec_model(schemas, name):
    model = MIRRORS[name]
    schema = schemas[name]
    assert set(schema["properties"]) == set(model.model_fields), name
    required = {k for k, f in model.model_fields.items() if f.is_required()}
    assert set(schema.get("required", [])) == required, name
    assert schema.get("additionalProperties") is False, name


def test_enums_match_the_spec_literals(schemas):
    assert schemas["ItemFlagCode"]["enum"] == list(typing.get_args(S.FlagCode))
    assert schemas["EnvFeature"]["properties"]["kind"]["enum"] == list(typing.get_args(S.EnvKind))
    assert schemas["AssetItem"]["properties"]["height_source"]["enum"] == list(
        typing.get_args(S.HeightSource)
    )
    kinds = schemas["AssetPartSource"]["properties"]["kind"]["enum"]
    assert kinds == list(typing.get_args(S.Source.model_fields["kind"].annotation))


def test_spec_list_bounds_match(schemas):
    props = schemas["AssetSpec"]["properties"]
    assert props["items"]["maxItems"] == S.MAX_ITEMS
    assert props["environment"]["maxItems"] == S.MAX_ENV
    assert props["parts"]["maxItems"] == S.MAX_PARTS


def test_the_footprint_is_discriminated_by_kind(schemas):
    fp = schemas["ItemFootprint"]
    mapping = fp["discriminator"]["mapping"]
    assert fp["discriminator"]["propertyName"] == "kind"
    assert set(mapping) == {"rect", "circle", "polygon", "line"}
    for kind, ref in mapping.items():
        assert schemas[ref.rsplit("/", 1)[1]]["properties"]["kind"]["enum"] == [kind]


def test_the_map_site_frame_is_untouched(schemas):
    """The plant grid is `PlantFrame`: the map workspace's `SiteFrame` keeps its own shape."""
    assert schemas["SiteFrame"]["required"] == ["kind", "crs_wkt", "epsg", "proj4", "name"]


def test_models_and_runs_gain_their_plant_fields(schemas):
    assert "kind" in schemas["AssetModel"]["required"]
    assert schemas["AssetModelKind"]["enum"] == ["asset", "plant"]
    run = schemas["AssetModelRun"]
    assert run["properties"]["mode"]["enum"] == ["build", "refine", "plant", "plant_package"]
    for field in ("packages", "usage_by_stage"):
        assert field in run["properties"] and field not in run["required"], field
    start = schemas["AssetModelRunStart"]["properties"]
    assert start["mode"]["enum"] == ["build", "refine", "plant", "plant_package"]
    assert {"package_ids", "limits"} <= set(start)
    assert start["sources"]["maxItems"] == 200  # a plant run takes every page
    usage = schemas["AssetModelRunUsageByStage"]
    assert set(usage["required"]) == {"current", "stages", "cost_estimate_usd", "cost_label"}
    assert set(schemas["AssetModelRunStageUsage"]["required"]) == {
        "input_tokens",
        "output_tokens",
        "images",
        "calls",
    }


def test_drawing_intake_schemas_use_the_binding_names(schemas):
    pages = schemas["DrawingPagesCreate"]
    assert set(pages["required"]) == {"inspection_id", "name", "pages", "placement"}
    assert pages["properties"]["pages"]["oneOf"][0]["const"] == "all"
    assert pages["properties"]["pages"]["oneOf"][1]["maxItems"] == 500
    assert set(schemas["DrawingPagesWithJob"]["required"]) == {"drawings", "job"}
    assert set(schemas["UnimportedDrawing"]["required"]) == {"path", "name", "format", "size", "pages"}


def test_every_site_scene_list_is_bounded(schemas):
    props = schemas["SiteScene"]["properties"]
    for name in ("orthos", "clouds", "drawings"):
        assert props[name]["maxItems"] == 200, name
    assert schemas["AssetItemPage"]["properties"]["items"]["maxItems"] == 500
```

- [ ] **Step 2: Run it to see it fail**

Run: `cd backend; & $py -m pytest tests/test_plant_contract.py -q`
Expected: failures, first `KeyError: 'PlantFrame'` / `AssertionError` for `listAssetModelItems`.

- [ ] **Step 3: Add the new paths**

In `contract/openapi.yaml`, insert this block directly before the line `  /api/v1/brands:`:
```yaml
  # ----- plant model (spec 2026-10-03-plant-model-generator §10; plan 2026-10-03-plant-model-f0)
  /api/v1/projects/{projectId}/asset-models/{assetModelId}/versions/{version}/items:
    parameters:
      - $ref: "#/components/parameters/projectId"
      - $ref: "#/components/parameters/assetModelId"
      - $ref: "#/components/parameters/assetModelVersion"
    get:
      tags: [assetmodels]
      operationId: listAssetModelItems
      summary: >-
        The version's register, read from the index the GLB job writes (`asset_item`): at most 500 rows a
        page, ordered by node. Empty until the version's GLB is built.
      parameters:
        - name: q
          in: query
          required: false
          description: matches the tag or the name, case-insensitive
          schema: { type: string, maxLength: 120 }
        - name: type
          in: query
          required: false
          schema: { type: string, maxLength: 64 }
        - name: area
          in: query
          required: false
          schema: { type: string, maxLength: 80 }
        - name: flag
          in: query
          required: false
          description: only rows carrying this flag
          schema: { $ref: "#/components/schemas/ItemFlagCode" }
        - name: bbox
          in: query
          required: false
          description: "plant metres `e0,n0,e1,n1`: only rows whose plant point is inside"
          schema: { type: string, pattern: "^-?\\d+(\\.\\d+)?(,-?\\d+(\\.\\d+)?){3}$" }
        - name: cursor
          in: query
          required: false
          description: the previous page's `next_cursor`
          schema: { type: string, maxLength: 200 }
        - name: limit
          in: query
          required: false
          schema: { type: integer, minimum: 1, maximum: 500, default: 200 }
      responses:
        "200":
          description: one page of the register
          content:
            application/json:
              schema: { $ref: "#/components/schemas/AssetItemPage" }
        "404": { $ref: "#/components/responses/NotFound" }
        "422":
          description: "a malformed cursor (`code` is `invalid_cursor`) or a box with e1 < e0 or n1 < n0 (`invalid_bbox`)"
          content:
            application/json:
              schema: { $ref: "#/components/schemas/Error" }
        default: { $ref: "#/components/responses/Error" }
  /api/v1/projects/{projectId}/asset-models/{assetModelId}/versions/{version}/items/{itemId}:
    parameters:
      - $ref: "#/components/parameters/projectId"
      - $ref: "#/components/parameters/assetModelId"
      - $ref: "#/components/parameters/assetModelVersion"
      - $ref: "#/components/parameters/assetItemId"
    get:
      tags: [assetmodels]
      operationId: getAssetModelItem
      summary: One item of the version's spec, in full.
      responses:
        "200":
          description: the item
          content:
            application/json:
              schema: { $ref: "#/components/schemas/AssetItem" }
        "404": { $ref: "#/components/responses/NotFound" }
        default: { $ref: "#/components/responses/Error" }
  /api/v1/projects/{projectId}/asset-models/{assetModelId}/versions/{version}/csv:
    parameters:
      - $ref: "#/components/parameters/projectId"
      - $ref: "#/components/parameters/assetModelId"
      - $ref: "#/components/parameters/assetModelVersion"
    get:
      tags: [assetmodels]
      operationId: getAssetModelCsv
      summary: >-
        The version's register as CSV: Cowork's 17 columns in their order, then `flags` and `confidence`
        (`utm39_E`/`utm39_N` are `site_E`/`site_N` when the site CRS is not UTM 39).
      responses:
        "200":
          description: the CSV file
          content:
            text/csv:
              schema: { type: string }
        "404": { $ref: "#/components/responses/NotFound" }
        "409":
          description: "the version's GLB and CSV are still building or failed (`code` is `not_ready`)"
          content:
            application/json:
              schema: { $ref: "#/components/schemas/Error" }
        default: { $ref: "#/components/responses/Error" }
  /api/v1/projects/{projectId}/asset-models/{assetModelId}/runs/{runId}/packages:
    parameters:
      - $ref: "#/components/parameters/projectId"
      - $ref: "#/components/parameters/assetModelId"
      - $ref: "#/components/parameters/assetModelRunId"
    get:
      tags: [assetmodels]
      operationId: listAssetModelRunPackages
      summary: A plant run's packages, in order (at most 64). Empty for build and refine runs.
      responses:
        "200":
          description: the packages
          content:
            application/json:
              schema: { $ref: "#/components/schemas/SiteModelPackageList" }
        "404": { $ref: "#/components/responses/NotFound" }
        default: { $ref: "#/components/responses/Error" }
  /api/v1/projects/{projectId}/drawings/pages:
    parameters:
      - $ref: "#/components/parameters/projectId"
    post:
      tags: [workspace]
      operationId: createDrawingPages
      summary: >-
        Import several pages of one inspected PDF (or "all") as one Drawing each, named "<name> · p<k>",
        built in order by one `drawing_import` job.
      requestBody:
        required: true
        content:
          application/json:
            schema: { $ref: "#/components/schemas/DrawingPagesCreate" }
      responses:
        "202":
          description: the drawings, queued; the job builds them in page order
          content:
            application/json:
              schema: { $ref: "#/components/schemas/DrawingPagesWithJob" }
        "404": { $ref: "#/components/responses/NotFound" }
        "409":
          description: "a build from this inspection is already queued (`code` is `job_running`)"
          content:
            application/json:
              schema: { $ref: "#/components/schemas/Error" }
        "422":
          description: "a page the file does not have, a file that is not a PDF, or PDF support missing (`code` is `invalid_pages` or `pdf_unavailable`)"
          content:
            application/json:
              schema: { $ref: "#/components/schemas/Error" }
        default: { $ref: "#/components/responses/Error" }
  /api/v1/projects/{projectId}/drawings/unimported:
    parameters:
      - $ref: "#/components/parameters/projectId"
    get:
      tags: [workspace]
      operationId: listUnimportedDrawings
      summary: >-
        Drawing files in the project folder (three levels deep, Kestrel's own folders skipped) whose
        content matches no imported drawing (by sha256). At most 500.
      responses:
        "200":
          description: the files
          content:
            application/json:
              schema: { $ref: "#/components/schemas/UnimportedDrawingList" }
        "404": { $ref: "#/components/responses/NotFound" }
        default: { $ref: "#/components/responses/Error" }
  /api/v1/projects/{projectId}/site-scene:
    parameters:
      - $ref: "#/components/parameters/projectId"
    get:
      tags: [assetmodels]
      operationId: getSiteScene
      summary: >-
        The Site 3D view's manifest: the plant frame (from the chosen model, else the map workspace) and
        the layers there are to show, each list at most 200.
      parameters:
        - name: modelId
          in: query
          required: false
          description: the asset model to open; the newest plant model with a ready GLB when absent
          schema: { type: string, maxLength: 64 }
      responses:
        "200":
          description: the scene manifest
          content:
            application/json:
              schema: { $ref: "#/components/schemas/SiteScene" }
        "404":
          description: "the project, or the asset model named by `modelId`, does not exist (`code` is `not_found`)"
          content:
            application/json:
              schema: { $ref: "#/components/schemas/Error" }
        default: { $ref: "#/components/responses/Error" }
  /api/v1/asset-models/catalogue:
    get:
      tags: [assetmodels]
      operationId: getAssetModelCatalogue
      summary: The plant item builder types, by family, with their param schemas (for the item editor).
      responses:
        "200":
          description: the catalogue
          content:
            application/json:
              schema: { $ref: "#/components/schemas/AssetModelCatalogue" }
        default: { $ref: "#/components/responses/Error" }
```

- [ ] **Step 4: Add the `assetItemId` parameter**

Find (under `components: parameters:`):
```yaml
    assetModelRunId:
      name: runId
      in: path
      required: true
      schema: { type: string }
```
Replace with:
```yaml
    assetModelRunId:
      name: runId
      in: path
      required: true
      schema: { type: string }
    assetItemId:
      name: itemId
      in: path
      required: true
      schema: { type: string, pattern: "^[A-Za-z0-9_.\\-]{1,64}$" }
```

- [ ] **Step 5: Add the new schemas**

Insert this block directly before the line `    # ----- asset findings (spec 2026-10-02-asset-findings §5, §8; plan 2026-10-03-asset-findings-c0)`:
```yaml
    # ----- plant model (spec 2026-10-03-plant-model-generator §5, §10; plan 2026-10-03-plant-model-f0)
    AssetModelKind:
      type: string
      enum: [asset, plant]
      description: "`asset`: one asset made of parts (M1); `plant`: a site of typed items (the plant generator)"
    PlantCrs:
      type: object
      additionalProperties: false
      properties:
        epsg: { type: [integer, "null"], minimum: 1024, maximum: 999999 }
        wkt: { type: [string, "null"], maxLength: 20000 }
    PlantDatum:
      type: object
      additionalProperties: false
      description: the plant elevation at scene Y = 0 (for example HPFS, EL 100.0)
      properties:
        label: { type: string, minLength: 1, maxLength: 40, default: EL }
        el_m: { type: number, default: 0 }
    PlantCloudDatum:
      type: object
      additionalProperties: false
      description: "plant EL = cloud z + offset_m (+ tilt · [dx, dy])"
      required: [cloud_id, offset_m]
      properties:
        cloud_id: { type: string, minLength: 1, maxLength: 64 }
        offset_m: { type: number }
        tilt: { type: [array, "null"], items: { type: number }, minItems: 2, maxItems: 2 }
    PlantFrame:
      type: object
      additionalProperties: false
      description: >-
        A plant spec's grid (`AssetSpec.site`; `spec.SiteFrame` in the backend). Site CRS from plant:
        [X, Y] = origin_crs + R(plant_north_deg)·[E, N] with R(θ) = [[cos θ, sin θ], [-sin θ, cos θ]].
        Scene and GLB: x = plant N, y = EL - datum.el_m, z = plant E (metres, Y up).
      required: [crs, origin_crs, plant_north_deg, source]
      properties:
        crs: { $ref: "#/components/schemas/PlantCrs" }
        origin_crs: { type: array, items: { type: number }, minItems: 2, maxItems: 2 }
        plant_north_deg: { type: number, minimum: -360, maximum: 360, description: plant north, clockwise from grid north }
        datum: { $ref: "#/components/schemas/PlantDatum" }
        cloud_z_to_el:
          oneOf:
            - $ref: "#/components/schemas/PlantCloudDatum"
            - type: "null"
        source: { $ref: "#/components/schemas/AssetPartSource" }
    PlantPoint:
      type: array
      description: "[E, N], plant metres"
      items: { type: number }
      minItems: 2
      maxItems: 2
    ItemFootprintRect:
      type: object
      additionalProperties: false
      required: [kind, center, size]
      properties:
        kind: { type: string, enum: [rect] }
        center: { $ref: "#/components/schemas/PlantPoint" }
        size:
          type: array
          description: "[along, across] metres; `along` points rot_deg clockwise from plant north"
          items: { type: number, exclusiveMinimum: 0 }
          minItems: 2
          maxItems: 2
        rot_deg: { type: number, default: 0 }
    ItemFootprintCircle:
      type: object
      additionalProperties: false
      required: [kind, center, d]
      properties:
        kind: { type: string, enum: [circle] }
        center: { $ref: "#/components/schemas/PlantPoint" }
        d: { type: number, exclusiveMinimum: 0 }
    ItemFootprintPolygon:
      type: object
      additionalProperties: false
      required: [kind, pts]
      properties:
        kind: { type: string, enum: [polygon] }
        pts: { type: array, minItems: 3, maxItems: 500, items: { $ref: "#/components/schemas/PlantPoint" } }
    ItemFootprintLine:
      type: object
      additionalProperties: false
      required: [kind, pts, width]
      properties:
        kind: { type: string, enum: [line] }
        pts: { type: array, minItems: 2, maxItems: 500, items: { $ref: "#/components/schemas/PlantPoint" } }
        width: { type: number, exclusiveMinimum: 0 }
    ItemFootprint:
      description: an item's plan outline, plant metres
      oneOf:
        - $ref: "#/components/schemas/ItemFootprintRect"
        - $ref: "#/components/schemas/ItemFootprintCircle"
        - $ref: "#/components/schemas/ItemFootprintPolygon"
        - $ref: "#/components/schemas/ItemFootprintLine"
      discriminator:
        propertyName: kind
        mapping:
          rect: "#/components/schemas/ItemFootprintRect"
          circle: "#/components/schemas/ItemFootprintCircle"
          polygon: "#/components/schemas/ItemFootprintPolygon"
          line: "#/components/schemas/ItemFootprintLine"
    ItemFlagCode:
      type: string
      enum: [plan_offset, height_mismatch, missing_in_cloud, unregistered, builder_fallback, straddles_package]
    ItemFlag:
      type: object
      additionalProperties: false
      required: [code]
      properties:
        code: { $ref: "#/components/schemas/ItemFlagCode" }
        value: { type: [number, "null"] }
        note: { type: [string, "null"], maxLength: 300 }
    AssetItem:
      type: object
      additionalProperties: false
      description: >-
        One item of a plant spec. Plant metres; `parts` are M1 parts in item-local millimetres (origin at
        the footprint's reference point at base_el).
      required: [id, name, type, footprint, source]
      properties:
        id: { type: string, pattern: "^[A-Za-z0-9_.\\-]{1,64}$" }
        tag: { type: [string, "null"], maxLength: 80 }
        name: { type: string, minLength: 1, maxLength: 200 }
        type:
          type: string
          minLength: 1
          maxLength: 64
          description: a builder type (`getAssetModelCatalogue`), checked by the spec validation, not by this schema
        area: { type: [string, "null"], maxLength: 80 }
        footprint: { $ref: "#/components/schemas/ItemFootprint" }
        base_el: { type: [number, "null"] }
        top_el: { type: [number, "null"] }
        levels: { type: array, maxItems: 50, items: { type: number } }
        params:
          type: object
          additionalProperties: true
          description: the type's params, validated by its builder's schema
        height_source: { type: string, enum: [drawing, cloud, indicative], default: indicative }
        source: { $ref: "#/components/schemas/AssetPartSource" }
        confidence: { type: string, enum: [high, medium, low], default: medium }
        flags: { type: array, maxItems: 20, items: { $ref: "#/components/schemas/ItemFlag" } }
        parts: { type: array, maxItems: 2000, items: { $ref: "#/components/schemas/AssetPart" } }
        notes: { type: [string, "null"], maxLength: 1000 }
    EnvFeature:
      type: object
      additionalProperties: false
      description: a traced piece of the site's environment (land, sea, roads, paving), plant metres
      required: [id, kind, pts, el, source]
      properties:
        id: { type: string, pattern: "^[A-Za-z0-9_.\\-]{1,64}$" }
        kind: { type: string, enum: [land, sea, road, paved, laydown, slope, revetment] }
        pts: { type: array, minItems: 3, maxItems: 5000, items: { $ref: "#/components/schemas/PlantPoint" } }
        el: { type: number }
        source: { $ref: "#/components/schemas/AssetPartSource" }
        confidence: { type: string, enum: [high, medium, low], default: medium }
    AssetItemRow:
      type: object
      description: one row of a version's register index; `node` is the item id
      required: [node, tag, name, type, area, plant_e, plant_n, site_x, site_y, lon, lat, base_el, top_el,
                 height_source, confidence, flags, source_sheet, has_geometry]
      properties:
        node: { type: string }
        tag: { type: [string, "null"] }
        name: { type: string }
        type: { type: string }
        area: { type: [string, "null"] }
        plant_e: { type: [number, "null"] }
        plant_n: { type: [number, "null"] }
        site_x: { type: [number, "null"] }
        site_y: { type: [number, "null"] }
        lon: { type: [number, "null"] }
        lat: { type: [number, "null"] }
        base_el: { type: [number, "null"] }
        top_el: { type: [number, "null"] }
        height_source: { type: string, enum: [drawing, cloud, indicative] }
        confidence: { type: string, enum: [high, medium, low] }
        flags: { type: array, items: { $ref: "#/components/schemas/ItemFlag" } }
        source_sheet: { type: [string, "null"] }
        has_geometry: { type: boolean }
    AssetItemPage:
      type: object
      required: [items, next_cursor]
      properties:
        items: { type: array, maxItems: 500, items: { $ref: "#/components/schemas/AssetItemRow" } }
        next_cursor: { type: [string, "null"], description: null on the last page }
    AssetBuilderType:
      type: object
      required: [type, family, doc, default_height_m, params_schema]
      properties:
        type: { type: string }
        family: { type: string, enum: [structure, equipment, building, civil, environment, fallback] }
        doc: { type: string }
        default_height_m: { type: number }
        params_schema:
          type: object
          additionalProperties: true
          description: the JSON Schema of the type's params; every param has a default
    AssetModelCatalogue:
      type: object
      required: [types]
      properties:
        types: { type: array, items: { $ref: "#/components/schemas/AssetBuilderType" } }
    SiteModelPackage:
      type: object
      description: one package of a plant run, a page region traced by one sub-run
      required: [id, run_id, n, label, drawing_id, region, area, expected, state, attempts, usage, item_count,
                 summary, started_at, ended_at]
      properties:
        id: { type: string }
        run_id: { type: string }
        n: { type: integer, minimum: 1 }
        label: { type: string }
        drawing_id: { type: [string, "null"] }
        region:
          type: [array, "null"]
          description: "[x0, y0, x1, y1] page fractions"
          items: { type: number, minimum: 0, maximum: 1 }
          minItems: 4
          maxItems: 4
        area: { type: [string, "null"] }
        expected: { type: array, items: { type: string }, description: tags the equipment list promises here }
        state: { type: string, enum: [queued, running, done, failed, skipped] }
        attempts: { type: integer, minimum: 0 }
        usage:
          type: object
          required: [input_tokens, output_tokens]
          properties:
            input_tokens: { type: integer }
            output_tokens: { type: integer }
        item_count: { type: integer, minimum: 0 }
        summary: { type: [string, "null"] }
        started_at: { type: [string, "null"], format: date-time }
        ended_at: { type: [string, "null"], format: date-time }
    SiteModelPackageList:
      type: object
      required: [items]
      properties:
        items: { type: array, maxItems: 64, items: { $ref: "#/components/schemas/SiteModelPackage" } }
    AssetModelRunPackages:
      type: object
      description: a plant run's package counts
      required: [total, done, failed, running]
      properties:
        total: { type: integer, minimum: 0 }
        done: { type: integer, minimum: 0 }
        failed: { type: integer, minimum: 0 }
        running: { type: integer, minimum: 0 }
    AssetModelRunStageUsage:
      type: object
      required: [input_tokens, output_tokens, images, calls]
      properties:
        input_tokens: { type: integer, minimum: 0 }
        output_tokens: { type: integer, minimum: 0 }
        images: { type: integer, minimum: 0 }
        calls: { type: integer, minimum: 0 }
    AssetModelRunUsageByStage:
      type: object
      description: a plant run's stage and use per stage (spec §8.4), summed over the orchestrator and every sub-run
      required: [current, stages, cost_estimate_usd, cost_label]
      properties:
        current: { type: string, description: "the stage running now: survey, trace, merge, cloud_check, environment, build or finish" }
        stages:
          type: object
          additionalProperties: { $ref: "#/components/schemas/AssetModelRunStageUsage" }
        cost_estimate_usd: { type: [number, "null"], description: "from a price table in app code; null when the model has no price" }
        cost_label: { type: string, description: "says that the cost is an estimate" }
    AssetModelRunLimits:
      type: object
      additionalProperties: false
      description: a plant run's budget, overriding App settings for this run
      properties:
        max_tokens: { type: integer, minimum: 100000, maximum: 200000000 }
        max_images: { type: integer, minimum: 1, maximum: 5000 }
        max_seconds: { type: integer, minimum: 60, maximum: 86400 }
        parallel: { type: integer, minimum: 1, maximum: 8 }
    DrawingPagesCreate:
      type: object
      additionalProperties: false
      required: [inspection_id, name, pages, placement]
      properties:
        inspection_id: { type: string }
        name: { type: string, minLength: 1, maxLength: 200 }
        pages:
          description: '"all", or the 1-based page numbers to import'
          oneOf:
            - type: string
              const: all
            - type: array
              minItems: 1
              maxItems: 500
              uniqueItems: true
              items: { type: integer, minimum: 1 }
        dpi: { type: integer, enum: [100, 150, 200, 300], description: "150 when absent" }
        placement: { $ref: "#/components/schemas/DrawingPlacementInput" }
        captured_on: { type: [string, "null"], format: date, pattern: "^\\d{4}-\\d{2}-\\d{2}$" }
    DrawingPagesWithJob:
      type: object
      required: [drawings, job]
      properties:
        drawings: { type: array, items: { $ref: "#/components/schemas/Drawing" } }
        job: { $ref: "#/components/schemas/Job" }
    UnimportedDrawing:
      type: object
      required: [path, name, format, size, pages]
      properties:
        path: { type: string, description: absolute path }
        name: { type: string }
        format: { type: string, enum: [pdf, dxf, tif, png, jpg, landxml] }
        size: { type: integer, minimum: 0 }
        pages: { type: [integer, "null"], description: a PDF's page count; null for other formats }
    UnimportedDrawingList:
      type: object
      required: [files]
      properties:
        files: { type: array, maxItems: 500, items: { $ref: "#/components/schemas/UnimportedDrawing" } }
    SiteSceneFrame:
      type: object
      required: [crs, origin_crs, plant_north_deg, datum]
      properties:
        crs: { $ref: "#/components/schemas/PlantCrs" }
        origin_crs: { type: array, items: { type: number }, minItems: 2, maxItems: 2 }
        plant_north_deg: { type: number }
        datum: { $ref: "#/components/schemas/PlantDatum" }
    SiteSceneModel:
      type: object
      required: [id, version, glb_url, csv_url, kind]
      properties:
        id: { type: string }
        version: { type: integer }
        glb_url: { type: string }
        csv_url: { type: string }
        kind: { $ref: "#/components/schemas/AssetModelKind" }
    SiteSceneOrtho:
      type: object
      required: [id, name, tile_url_template, bounds_site, min_z, max_z]
      properties:
        id: { type: string }
        name: { type: string }
        tile_url_template: { type: string, description: "with {z}, {x} and {y}" }
        bounds_site: { type: array, items: { type: number }, minItems: 4, maxItems: 4 }
        min_z: { type: integer }
        max_z: { type: integer }
    SiteSceneCloud:
      type: object
      required: [id, name, octree_url, crs_epsg, same_crs, z_offset_m]
      properties:
        id: { type: string }
        name: { type: string }
        octree_url: { type: string }
        crs_epsg: { type: [integer, "null"] }
        same_crs: { type: boolean, description: false when the cloud cannot be placed in the plant frame }
        z_offset_m: { type: number, description: "plant EL - cloud z (the plant's cloud_z_to_el), 0 when unknown" }
    SiteSceneDrawing:
      type: object
      required: [id, name, tile_url_template, bounds_site]
      properties:
        id: { type: string }
        name: { type: string }
        tile_url_template: { type: string }
        bounds_site: { type: array, items: { type: number }, minItems: 4, maxItems: 4 }
    SiteSceneCount:
      type: object
      required: [count, url]
      properties:
        count: { type: integer, minimum: 0 }
        url: { type: string, description: the paged list to read them from }
    SiteScene:
      type: object
      required: [frame, model, orthos, clouds, drawings, photos, findings]
      properties:
        frame:
          oneOf:
            - $ref: "#/components/schemas/SiteSceneFrame"
            - type: "null"
        model:
          oneOf:
            - $ref: "#/components/schemas/SiteSceneModel"
            - type: "null"
        orthos: { type: array, maxItems: 200, items: { $ref: "#/components/schemas/SiteSceneOrtho" } }
        clouds: { type: array, maxItems: 200, items: { $ref: "#/components/schemas/SiteSceneCloud" } }
        drawings: { type: array, maxItems: 200, items: { $ref: "#/components/schemas/SiteSceneDrawing" } }
        photos: { $ref: "#/components/schemas/SiteSceneCount" }
        findings: { $ref: "#/components/schemas/SiteSceneCount" }
```

- [ ] **Step 6: `AssetModel` and `AssetModelCreate` gain `kind`**

In `AssetModel`, append `, kind` to the `required:` list (it ends `..., frame, review, kind]`), and after its `review:` property (the `oneOf` ending in `- $ref: "#/components/schemas/AssetReviewConfig"` / `- type: "null"`) add:
```yaml
        kind: { $ref: "#/components/schemas/AssetModelKind" }
```
In `AssetModelCreate`, after `tag: { type: [string, "null"], maxLength: 80 }` add:
```yaml
        kind:
          description: "`plant` for a plant model; `asset` when absent"
          allOf:
            - $ref: "#/components/schemas/AssetModelKind"
```

- [ ] **Step 7: `AssetPartSource` gains `operator` and `page`**

Find:
```yaml
        kind: { type: string, enum: [drawing, cloud, photo, assumed] }
        id: { type: [string, "null"] }
        region:
```
Replace with:
```yaml
        kind:
          type: string
          enum: [drawing, cloud, photo, assumed, operator]
          description: "`operator`: set by hand (a plant frame or an edited item); needs no id"
        id: { type: [string, "null"] }
        page: { type: [integer, "null"], minimum: 1, maximum: 10000, description: "the drawing's page, when it has several" }
        region:
```

- [ ] **Step 8: `AssetSpec` gains `site`, `items`, `environment`**

Find:
```yaml
        parts: { type: array, maxItems: 2000, items: { $ref: "#/components/schemas/AssetPart" } }
    SpecIssue:
```
Replace with:
```yaml
        parts: { type: array, maxItems: 2000, items: { $ref: "#/components/schemas/AssetPart" } }
        site:
          description: the plant grid; null for a single asset (M1)
          oneOf:
            - $ref: "#/components/schemas/PlantFrame"
            - type: "null"
        items: { type: array, maxItems: 20000, items: { $ref: "#/components/schemas/AssetItem" } }
        environment: { type: array, maxItems: 2000, items: { $ref: "#/components/schemas/EnvFeature" } }
    SpecIssue:
```
In `AssetModelVersion.meta`'s description, append before the closing quote: `; a spec of over 200 items and environment features adds `validation` {errors, error_count, warnings, warning_count} from the GLB job`.

- [ ] **Step 9: `AssetModelRun` gains the plant modes, `packages` and `usage_by_stage`**

In `AssetModelRun`, change `mode: { type: string, enum: [build, refine] }` to `mode: { type: string, enum: [build, refine, plant, plant_package] }`, and after `ended_at: { type: [string, "null"], format: date-time }` (the last property, just before `AssetModelRunList:`) add (not in `required`):
```yaml
        packages:
          description: a plant run's package counts; null for build and refine runs
          oneOf:
            - $ref: "#/components/schemas/AssetModelRunPackages"
            - type: "null"
        usage_by_stage:
          description: a plant run's current stage and its use per stage; null for build and refine runs
          oneOf:
            - $ref: "#/components/schemas/AssetModelRunUsageByStage"
            - type: "null"
```

- [ ] **Step 10: `AssetModelRunStart` gains the plant modes, 200 sources, `package_ids` and `limits`**

Find:
```yaml
        mode: { type: string, enum: [build, refine] }
        sources: { type: array, minItems: 1, maxItems: 50, items: { $ref: "#/components/schemas/AssetSourceRef" } }
```
Replace with:
```yaml
        mode: { type: string, enum: [build, refine, plant, plant_package] }
        sources:
          type: array
          description: "a plant run takes every page, so up to 200"
          minItems: 1
          maxItems: 200
          items: { $ref: "#/components/schemas/AssetSourceRef" }
        package_ids:
          type: array
          description: "`plant_package`: the packages of the model's last plant run to redo"
          maxItems: 64
          uniqueItems: true
          items: { type: string, maxLength: 64 }
        limits: { $ref: "#/components/schemas/AssetModelRunLimits" }
```

- [ ] **Step 11: Lint, regenerate and export the types**

```powershell
pnpm -C contract lint
pnpm -C contract generate
```
Expected: Spectral prints `No results with a severity of 'error' found!`; `client/schema.d.ts` gains the schemas (for example `ItemFootprint: components["schemas"]["ItemFootprintRect"] | ...` and `mode: "build" | "refine" | "plant" | "plant_package"`).
In `contract/client/index.ts`, after `export type AssetModelRunStart = Schemas["AssetModelRunStart"];` add:
```ts
export type AssetModelKind = Schemas["AssetModelKind"];
export type AssetModelRunLimits = Schemas["AssetModelRunLimits"];
export type AssetModelRunPackages = Schemas["AssetModelRunPackages"];
export type AssetModelRunUsageByStage = Schemas["AssetModelRunUsageByStage"];
export type AssetModelRunStageUsage = Schemas["AssetModelRunStageUsage"];
export type PlantFrame = Schemas["PlantFrame"];
export type PlantCrs = Schemas["PlantCrs"];
export type PlantDatum = Schemas["PlantDatum"];
export type PlantCloudDatum = Schemas["PlantCloudDatum"];
export type PlantPoint = Schemas["PlantPoint"];
export type ItemFootprint = Schemas["ItemFootprint"];
export type ItemFlag = Schemas["ItemFlag"];
export type ItemFlagCode = Schemas["ItemFlagCode"];
export type AssetItem = Schemas["AssetItem"];
export type EnvFeature = Schemas["EnvFeature"];
export type AssetItemRow = Schemas["AssetItemRow"];
export type AssetItemPage = Schemas["AssetItemPage"];
export type AssetBuilderType = Schemas["AssetBuilderType"];
export type AssetModelCatalogue = Schemas["AssetModelCatalogue"];
export type SiteModelPackage = Schemas["SiteModelPackage"];
export type SiteModelPackageList = Schemas["SiteModelPackageList"];
export type DrawingPagesCreate = Schemas["DrawingPagesCreate"];
export type DrawingPagesWithJob = Schemas["DrawingPagesWithJob"];
export type UnimportedDrawing = Schemas["UnimportedDrawing"];
export type UnimportedDrawingList = Schemas["UnimportedDrawingList"];
export type SiteScene = Schemas["SiteScene"];
export type SiteSceneFrame = Schemas["SiteSceneFrame"];
export type SiteSceneModel = Schemas["SiteSceneModel"];
export type SiteSceneOrtho = Schemas["SiteSceneOrtho"];
export type SiteSceneCloud = Schemas["SiteSceneCloud"];
export type SiteSceneDrawing = Schemas["SiteSceneDrawing"];
```

- [ ] **Step 12: Keep the frontend compiling against the widened types**

In `frontend/src/assetmodels/run/RunTab.tsx`, find:
```ts
const MODE: Record<RunMode, string> = { build: "Build", refine: "Refine" };
```
Replace with:
```ts
const MODE: Record<RunMode, string> = {
  build: "Build",
  refine: "Refine",
  plant: "Plant build",
  plant_package: "Package re-run",
};
```
Find every `AssetModel` object literal: `Select-String -Path frontend/src/test/*.ts, frontend/e2e/fixtures/*.ts -Pattern "^\s+review: null,"` — expected hits include `frontend/src/test/assetModelFixtures.ts` (`MODEL`), `frontend/e2e/fixtures/assetModels.ts` (`modelJson`) and, once P1's frontend is on main, `frontend/src/test/assetFindingFixtures.ts` (`exampleAssetModel`). In each `AssetModel` literal add `kind: "asset",` on the line after `review: null,` (or after its `review:` value). Then:
```powershell
pnpm -C frontend exec prettier --write src/assetmodels/run/RunTab.tsx src/test e2e/fixtures/assetModels.ts
pnpm -C frontend exec tsc -b
```
Expected: `tsc -b` exits 0. If it names another exhaustive `Record` or `switch` over `AssetModelRun["mode"]` or `AssetModelRunStart["mode"]`, give `plant` the label "Plant build" and `plant_package` "Package re-run" there too, and list the file in the commit message.

- [ ] **Step 13: Run the YAML test and the contract check**

```powershell
cd backend; & $py -m pytest tests/test_plant_contract.py -q; cd ..
git add contract/client/schema.d.ts
pnpm -C contract check
```
Expected: `test_plant_contract.py`: 21 passed; `pnpm -C contract check` exits 0 (lint clean, the regenerated `schema.d.ts` equals the staged one).

- [ ] **Step 14: Commit**

```powershell
git add contract/openapi.yaml contract/client/schema.d.ts contract/client/index.ts frontend/src/assetmodels/run/RunTab.tsx frontend/src/test/assetModelFixtures.ts frontend/e2e/fixtures/assetModels.ts backend/tests/test_plant_contract.py
# and frontend/src/test/assetFindingFixtures.ts if Step 12 changed it
git commit -m "feat(contract): plant model operations and schemas (G1 F0)" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 10: Route the contract: catalogue live, stubs, kind, run fields

**Files:**
- Create: `backend/app/asset_models/schemas_plant.py`, `backend/app/asset_models/catalogue_router.py`, `backend/app/asset_models/stubs_plant.py`
- Modify: `backend/app/asset_models/schemas.py`, `backend/app/asset_models/router.py` (`create_asset_model`), `backend/app/asset_models/runs.py` (`start_asset_model_run`), `backend/app/api.py`, `backend/tests/test_contract.py`
- Test: `backend/tests/test_plant_api.py`, `backend/tests/test_contract.py` (whole file)

**Interfaces:**
- Consumes: Task 4's `AssetModel.kind`; Task 6's `catalogue()`; Task 9's contract; `app.stubs.add_stubs`.
- Produces: the schemas in the header (`schemas.py`, `schemas_plant.py`); `stubs_plant.A1_STUBS / R1_STUBS / S1_STUBS / I1_STUBS / STUBS / router / drawings_router / stub_operation_ids`; `catalogue_router.router`. Each owner deletes its tuple when it routes the operation (A1: items, item, csv; R1: packages; S1: site-scene; I1: pages, unimported — and I1 deletes the `stubs_plant:drawings_router` line in `app/api.py`). The last owner deletes `stubs_plant.py`, its `app/api.py` lines and the `EXPECTED_STUBS |=` line.

- [ ] **Step 1: Write the failing API tests**

Create `backend/tests/test_plant_api.py`:
```python
"""Plant model F0 over HTTP: the 501 stubs per unit, the live catalogue, the model kind, the plant run
refusal and large specs validated in the GLB job (plan 2026-10-03-plant-model-f0 Tasks 8 and 10)."""

import re
from types import SimpleNamespace

import pytest
from test_contract import EXPECTED_STUBS
from test_plant_contract import PLANT_OPERATIONS

from app.asset_models import stubs_plant
from app.asset_models.schemas import AssetModelRunOut, AssetModelRunPackagesOut

PROJECT = "/api/v1/projects/{projectId}"
UNIT_LISTS = {
    "A1": stubs_plant.A1_STUBS,
    "R1": stubs_plant.R1_STUBS,
    "S1": stubs_plant.S1_STUBS,
    "I1": stubs_plant.I1_STUBS,
}


def _concrete(path: str) -> str:
    return re.sub(r"\{[^}]+\}", "1", path)


def _kwargs(method: str) -> dict:
    return {"json": {}} if method in ("POST", "PUT", "PATCH") else {}


def _all_stubs():
    return [s for listed in UNIT_LISTS.values() for s in listed]


def test_each_stub_sits_in_its_units_list_with_the_contract_path():
    for unit, listed in UNIT_LISTS.items():
        for method, path, op_id in listed:
            assert PLANT_OPERATIONS[op_id] == (method.lower(), PROJECT + path, unit), op_id
    assert stubs_plant.stub_operation_ids() <= EXPECTED_STUBS


def test_a_project_reaches_the_501_stubs(client, project_id):
    for method, path, op_id in _all_stubs():
        r = client.request(method, f"/api/v1/projects/{project_id}{_concrete(path)}", **_kwargs(method))
        assert r.status_code == 501, (op_id, r.text)
        assert r.json()["error"]["code"] == "not_implemented", op_id


def test_an_unknown_project_is_404_before_any_stub(client):
    for method, path, op_id in _all_stubs():
        r = client.request(method, f"/api/v1/projects/nope{_concrete(path)}", **_kwargs(method))
        assert r.status_code == 404, (op_id, r.text)


def test_unimported_is_not_taken_for_a_drawing_id(client, project_id):
    """Review Focus 4: GET /drawings/unimported is the stub, not GET /drawings/{drawingId} (a 404)."""
    r = client.get(f"/api/v1/projects/{project_id}/drawings/unimported")
    assert r.status_code == 501, r.text


def test_the_catalogue_lists_the_registered_builders(client):
    r = client.get("/api/v1/asset-models/catalogue")
    assert r.status_code == 200, r.text
    types = r.json()["types"]
    assert {"other", "composite"} <= {t["type"] for t in types}
    other = next(t for t in types if t["type"] == "other")
    assert other["family"] == "fallback" and other["default_height_m"] == 3.0
    assert other["params_schema"]["properties"]["material"]["default"] == "Equipment_Grey"


def test_the_catalogue_needs_the_token(anon):
    assert anon.get("/api/v1/asset-models/catalogue").status_code == 401


def test_a_model_is_an_asset_unless_created_as_a_plant(client, project_id):
    base = f"/api/v1/projects/{project_id}/asset-models"
    plain = client.post(base, json={"name": "Tank"}).json()
    plant = client.post(base, json={"name": "Al-Zour", "kind": "plant"}).json()
    assert (plain["kind"], plant["kind"]) == ("asset", "plant")
    kinds = {m["id"]: m["kind"] for m in client.get(base).json()["items"]}
    assert kinds == {plain["id"]: "asset", plant["id"]: "plant"}


@pytest.mark.parametrize("mode", ["plant", "plant_package"])
def test_a_plant_run_is_refused_until_r1(client, project_id, mode):
    base = f"/api/v1/projects/{project_id}/asset-models"
    model = client.post(base, json={"name": "Al-Zour", "kind": "plant"}).json()
    r = client.post(
        f"{base}/{model['id']}/runs",
        json={"mode": mode, "sources": [{"type": "drawing", "id": "d1"}], "provider": "anthropic"},
    )
    assert r.status_code == 422, r.text
    assert r.json()["error"]["code"] == "plant_run_unavailable"


def test_a_run_reads_its_stage_usage_from_its_usage():
    by_stage = {
        "current": "trace",
        "stages": {"survey": {"input_tokens": 10, "output_tokens": 2, "images": 3, "calls": 4}},
        "cost_estimate_usd": 0.12,
        "cost_label": "Estimate",
    }
    row = SimpleNamespace(
        id="r1",
        model_id="m1",
        job_id="j1",
        provider="anthropic",
        model_name="claude-opus-5-5",
        mode="plant",
        notes=None,
        state="running",
        stop_reason=None,
        phase="reading",
        steps=[],
        summary=None,
        open_questions=[],
        usage={"input_tokens": 10, "output_tokens": 2, "by_stage": by_stage},
        sources=[],
        version=None,
        comparison=None,
        started_at="2026-10-03T00:00:00Z",
        ended_at=None,
    )
    counts = AssetModelRunPackagesOut(total=3, done=1, failed=0, running=2)
    out = AssetModelRunOut.of(row, packages=counts)
    assert out.packages == counts
    assert out.usage_by_stage.model_dump() == by_stage
    row.usage = {"input_tokens": 0, "output_tokens": 0, "by_stage": {"current": "trace"}}  # not R1's shape
    assert AssetModelRunOut.of(row).usage_by_stage is None
    row.usage = {"input_tokens": 0, "output_tokens": 0}  # a build or refine run
    assert AssetModelRunOut.of(row).usage_by_stage is None and AssetModelRunOut.of(row).packages is None
```

- [ ] **Step 2: Run them to see them fail**

Run: `cd backend; & $py -m pytest tests/test_plant_api.py -q`
Expected: collection error, `ImportError: cannot import name 'stubs_plant' from 'app.asset_models'`.

- [ ] **Step 3: The API shapes**

In `backend/app/asset_models/schemas.py`:
- change `from typing import Any, Literal` to `from typing import Annotated, Any, Literal` and `from pydantic import BaseModel, ConfigDict, Field, field_validator` to `from pydantic import BaseModel, ConfigDict, Field, ValidationError, field_validator`;
- in `AssetModelOut`, after `review: dict[str, Any] | None = None` add `kind: Literal["asset", "plant"] = "asset"  # plant model spec §9 (migration 0017)`;
- in `AssetModelCreate`, after `tag: str | None = Field(None, max_length=80)` add `kind: Literal["asset", "plant"] = "asset"`;
- directly before `class AssetModelRunStepOut(BaseModel):` insert:
```python
class AssetModelRunPackagesOut(BaseModel):
    total: int
    done: int
    failed: int
    running: int


class AssetModelRunStageUsageOut(BaseModel):
    input_tokens: int = 0
    output_tokens: int = 0
    images: int = 0
    calls: int = 0


class AssetModelRunUsageByStageOut(BaseModel):
    current: str
    stages: dict[str, AssetModelRunStageUsageOut]
    cost_estimate_usd: float | None
    cost_label: str


```
- in `AssetModelRunOut`, change `mode: Literal["build", "refine"]` to `mode: Literal["build", "refine", "plant", "plant_package"]`, and replace
```python
    started_at: datetime
    ended_at: datetime | None

    @classmethod
    def of(cls, row) -> AssetModelRunOut:
        return cls.model_validate(row, from_attributes=True)
```
with
```python
    started_at: datetime
    ended_at: datetime | None
    # Plant runs (spec 2026-10-03-plant-model-generator §8). 0017 adds no run columns: R1 keeps the
    # stage usage in the run's `usage` JSON under "by_stage" and passes the package counts in.
    packages: AssetModelRunPackagesOut | None = None
    usage_by_stage: AssetModelRunUsageByStageOut | None = None

    @classmethod
    def of(cls, row, packages: AssetModelRunPackagesOut | None = None) -> AssetModelRunOut:
        out = cls.model_validate(row, from_attributes=True)
        usage = row.usage if isinstance(row.usage, dict) else {}
        try:
            by_stage = AssetModelRunUsageByStageOut.model_validate(usage.get("by_stage"))
        except ValidationError:  # absent (build and refine runs) or not R1's shape
            by_stage = None
        return out.model_copy(update={"usage_by_stage": by_stage, "packages": packages})
```
- replace `class AssetModelRunStart` with:
```python
class AssetModelRunLimits(BaseModel):
    model_config = ConfigDict(extra="forbid")
    max_tokens: int | None = Field(None, ge=100_000, le=200_000_000)
    max_images: int | None = Field(None, ge=1, le=5000)
    max_seconds: int | None = Field(None, ge=60, le=86_400)
    parallel: int | None = Field(None, ge=1, le=8)


class AssetModelRunStart(BaseModel):
    model_config = ConfigDict(extra="forbid")
    mode: Literal["build", "refine", "plant", "plant_package"]
    sources: list[AssetSourceRef] = Field(min_length=1, max_length=200)  # a plant run takes every page
    provider: Literal["openai", "anthropic", "gemini"]
    model_name: str | None = Field(None, max_length=120)
    notes: str | None = Field(None, max_length=4000)
    package_ids: list[Annotated[str, Field(max_length=64)]] = Field(default_factory=list, max_length=64)
    limits: AssetModelRunLimits | None = None
```

Create `backend/app/asset_models/schemas_plant.py`:
```python
"""API shapes for the plant model operations (contract: AssetModelCatalogue, AssetItemPage,
SiteModelPackageList, SiteScene; spec 2026-10-03-plant-model-generator §10; plan pm-f0 Task 10).

F0 routes only the catalogue. A1 (items), R1 (packages) and S1 (site scene) return these models
from their routes, so the shapes match the contract from the first commit.
"""

from __future__ import annotations

from datetime import datetime
from typing import Any, Literal

from pydantic import BaseModel

from app.asset_models.spec import ItemFlag


class AssetBuilderTypeOut(BaseModel):
    type: str
    family: Literal["structure", "equipment", "building", "civil", "environment", "fallback"]
    doc: str
    default_height_m: float
    params_schema: dict[str, Any]


class AssetModelCatalogueOut(BaseModel):
    types: list[AssetBuilderTypeOut]


class AssetItemRowOut(BaseModel):
    node: str
    tag: str | None
    name: str
    type: str
    area: str | None
    plant_e: float | None
    plant_n: float | None
    site_x: float | None
    site_y: float | None
    lon: float | None
    lat: float | None
    base_el: float | None
    top_el: float | None
    height_source: Literal["drawing", "cloud", "indicative"]
    confidence: Literal["high", "medium", "low"]
    flags: list[ItemFlag]
    source_sheet: str | None
    has_geometry: bool

    @classmethod
    def of(cls, row) -> AssetItemRowOut:
        return cls.model_validate(row, from_attributes=True)


class AssetItemPageOut(BaseModel):
    items: list[AssetItemRowOut]
    next_cursor: str | None


class SiteModelPackageOut(BaseModel):
    id: str
    run_id: str
    n: int
    label: str
    drawing_id: str | None
    region: list[float] | None
    area: str | None
    expected: list[str]
    state: Literal["queued", "running", "done", "failed", "skipped"]
    attempts: int
    usage: dict[str, int]
    item_count: int
    summary: str | None
    started_at: datetime | None
    ended_at: datetime | None

    @classmethod
    def of(cls, row) -> SiteModelPackageOut:
        return cls.model_validate(row, from_attributes=True)


class SiteModelPackageListOut(BaseModel):
    items: list[SiteModelPackageOut]


class SiteSceneCrsOut(BaseModel):
    epsg: int | None
    wkt: str | None


class SiteSceneDatumOut(BaseModel):
    label: str
    el_m: float


class SiteSceneFrameOut(BaseModel):
    crs: SiteSceneCrsOut
    origin_crs: tuple[float, float]
    plant_north_deg: float
    datum: SiteSceneDatumOut


class SiteSceneModelOut(BaseModel):
    id: str
    version: int
    glb_url: str
    csv_url: str
    kind: Literal["asset", "plant"]


class SiteSceneOrthoOut(BaseModel):
    id: str
    name: str
    tile_url_template: str
    bounds_site: tuple[float, float, float, float]
    min_z: int
    max_z: int


class SiteSceneCloudOut(BaseModel):
    id: str
    name: str
    octree_url: str
    crs_epsg: int | None
    same_crs: bool
    z_offset_m: float


class SiteSceneDrawingOut(BaseModel):
    id: str
    name: str
    tile_url_template: str
    bounds_site: tuple[float, float, float, float]


class SiteSceneCountOut(BaseModel):
    count: int
    url: str


class SiteSceneOut(BaseModel):
    frame: SiteSceneFrameOut | None
    model: SiteSceneModelOut | None
    orthos: list[SiteSceneOrthoOut]
    clouds: list[SiteSceneCloudOut]
    drawings: list[SiteSceneDrawingOut]
    photos: SiteSceneCountOut
    findings: SiteSceneCountOut
```

- [ ] **Step 4: The catalogue route and the stubs**

Create `backend/app/asset_models/catalogue_router.py`:
```python
"""The plant builder catalogue (spec 2026-10-03-plant-model-generator §10; plan pm-f0 Task 10).

Not project-scoped: the catalogue is the app's registered builders, whatever project is open. It
grows as the builder units (B1 to B3) land, with no contract change (spec §15).
"""

from fastapi import APIRouter

from app.asset_models.builders.base import catalogue
from app.asset_models.schemas_plant import AssetModelCatalogueOut

router = APIRouter(tags=["assetmodels"])


@router.get("/asset-models/catalogue", response_model=AssetModelCatalogueOut)
def get_asset_model_catalogue():
    return AssetModelCatalogueOut.model_validate({"types": catalogue()})
```
Create `backend/app/asset_models/stubs_plant.py`:
```python
"""501 placeholders for the plant model operations (spec 2026-10-03-plant-model-generator §10, plan
2026-10-03-plant-model-f0).

F0 lands the whole contract before any unit builds it, so every new operation is routed here and
answers 501 `not_implemented` until its unit lands. Each list belongs to one unit of the index's DAG.
A unit that builds an operation deletes its tuple here and routes the real handler in its own module;
`tests/test_contract.py::EXPECTED_STUBS` reads `stub_operation_ids()`, so nothing else changes. The
last owner deletes this module, its lines in `app/api.py` and the `EXPECTED_STUBS |=` line.

`drawings_router` is mounted before `app.drawings.router` (see `app/api.py`): FastAPI matches in
order, and `GET /drawings/unimported` must never reach `GET /drawings/{drawingId}`. I1 keeps that
order for its real routes.
"""

from fastapi import APIRouter

from app.stubs import add_stubs

Stub = tuple[str, str, str]  # (method, path under /projects/{projectId}, operationId)

M = "/asset-models/{assetModelId}"

# A1: the register (spec §7, §9).
A1_STUBS: list[Stub] = [
    ("GET", M + "/versions/{version}/items", "listAssetModelItems"),
    ("GET", M + "/versions/{version}/items/{itemId}", "getAssetModelItem"),
    ("GET", M + "/versions/{version}/csv", "getAssetModelCsv"),
]

# R1: plant run packages (spec §8.2).
R1_STUBS: list[Stub] = [
    ("GET", M + "/runs/{runId}/packages", "listAssetModelRunPackages"),
]

# S1: the Site 3D manifest (spec §10, §11).
S1_STUBS: list[Stub] = [
    ("GET", "/site-scene", "getSiteScene"),
]

# I1: intake (spec §8.1). Mounted with the drawings routes (the maps stack), before them.
I1_STUBS: list[Stub] = [
    ("POST", "/drawings/pages", "createDrawingPages"),
    ("GET", "/drawings/unimported", "listUnimportedDrawings"),
]

STUBS: list[Stub] = [*A1_STUBS, *R1_STUBS, *S1_STUBS]

router = APIRouter(prefix="/projects/{projectId}", tags=["assetmodels"])
add_stubs(router, STUBS)

drawings_router = APIRouter(prefix="/projects/{projectId}", tags=["workspace"])
add_stubs(drawings_router, I1_STUBS)


def stub_operation_ids() -> set[str]:
    """Every plant model operation still answered by a 501 stub."""
    return {op_id for _, _, op_id in [*STUBS, *I1_STUBS]}
```

- [ ] **Step 5: A model's kind, and the plant run refusal**

In `backend/app/asset_models/router.py`, `create_asset_model`, find:
```python
        row = AssetModel(name=body.name, asset_type=body.asset_type, tag=body.tag, status="empty")
```
Replace with:
```python
        row = AssetModel(
            name=body.name, asset_type=body.asset_type, tag=body.tag, kind=body.kind, status="empty"
        )
```
In `backend/app/asset_models/runs.py`, `start_asset_model_run`, find:
```python
    jobs, keys = request.app.state.jobs, request.app.state.keys
    with handle.session() as s:
        model = store.get_model(s, assetModelId)
```
Replace with:
```python
    jobs, keys = request.app.state.jobs, request.app.state.keys
    with handle.session() as s:
        model = store.get_model(s, assetModelId)
        if body.mode in ("plant", "plant_package"):
            # Plant model F0: the contract has the plant modes; R1 replaces this refusal with the run.
            raise AppError("plant_run_unavailable", "Plant runs are not available in this build yet.", 422)
```

- [ ] **Step 6: Mount the routers**

In `backend/app/api.py`, find:
```python
    "app.asset_models.runs",  # asset models (spec 2026-10-02); trimesh is native
```
Replace with:
```python
    "app.asset_models.runs",  # asset models (spec 2026-10-02); trimesh is native
    # Plant model (spec 2026-10-03-plant-model-generator §10, plan pm-f0): the live catalogue, then the
    # 501 stubs until A1, R1 and S1 land. A unit deletes its tuples in app/asset_models/stubs_plant.py.
    "app.asset_models.catalogue_router",
    "app.asset_models.stubs_plant",
```
In the map-workspace loop further down, find:
```python
for _module in (
    # each M unit inserts its router module on its own line above this one
    "app.drawings.router",
```
Replace with:
```python
for _module in (
    # Plant model I1's 501 stubs, before app.drawings.router so that GET /drawings/unimported never
    # reaches /drawings/{drawingId}. I1 deletes this line when it routes the real operations.
    "app.asset_models.stubs_plant:drawings_router",
    # each M unit inserts its router module on its own line above this one
    "app.drawings.router",
```
and in that same loop's body, find:
```python
        api_router.include_router(importlib.import_module(_module).router)
    except Exception:
        log.exception("%s failed to load; its endpoints will be unavailable", _module)
```
— the occurrence directly after `raise ImportError("the maps router did not load")` — and replace its first line with:
```python
        _path, _, _attr = _module.partition(":")
        api_router.include_router(getattr(importlib.import_module(_path), _attr or "router"))
```

- [ ] **Step 7: Tell the contract test about the stubs**

In `backend/tests/test_contract.py`, add the import (sorted, above the `app.asset_review.stubs` import):
```python
from app.asset_models.stubs_plant import stub_operation_ids as plant_stub_operation_ids
```
and after `EXPECTED_STUBS |= brands_stub_operation_ids()` add:
```python

# Plant model (plan 2026-10-03-plant-model-f0): the unit lists of app/asset_models/stubs_plant.py (A1,
# R1, S1, I1). An owner deletes its tuples; the last one deletes the module, its api.py lines and this.
EXPECTED_STUBS |= plant_stub_operation_ids()
```

- [ ] **Step 8: Run the API tests, the maps guard and the whole contract test**

Run: `cd backend; & $py -m pytest tests/test_plant_api.py tests/test_api_maps_guard.py tests/test_asset_models_api.py tests/test_asset_model_runs_api.py tests/test_asset_findings_stubs.py -q`
Expected: all pass (`test_plant_api.py`: 10 passed).
Run: `cd backend; & $py -m pytest tests/test_contract.py -q`
Expected: all pass (every path routed, no extra routes, every stub in `EXPECTED_STUBS`, generated plant specs answered 201 or 422 `invalid_spec`, plant run modes 422 `plant_run_unavailable`).

- [ ] **Step 9: Lint and commit**

```powershell
cd backend; & $py -m ruff check .; & $py -m ruff format --check .; cd ..
git add backend/app/asset_models/schemas.py backend/app/asset_models/schemas_plant.py backend/app/asset_models/catalogue_router.py backend/app/asset_models/stubs_plant.py backend/app/asset_models/router.py backend/app/asset_models/runs.py backend/app/api.py backend/tests/test_contract.py backend/tests/test_plant_api.py
git commit -m "feat(plant): live builder catalogue, model kind, plant run fields and 501 stubs" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 11: Full gate and the operator walkthrough

**Files:** none new.

- [ ] **Step 1: Run the whole gate**

```powershell
pnpm -C contract check
cd backend; & $py -m ruff check .; & $py -m ruff format --check .; & $py -m pytest; cd ..
pnpm -C frontend lint
pnpm -C frontend test
pnpm -C frontend build
pnpm -C frontend e2e        # on F0's port range (scripts\finish-task.ps1 picks free ports)
if (Test-Path frontend/src-tauri/binaries/kestrel-backend-*.exe) { cargo test --manifest-path frontend/src-tauri/Cargo.toml }
```
Expected: every command exits 0. `pytest` includes the 10 new test files and the whole `test_contract.py`. `cargo test` is skipped in a fresh worktree (the frozen sidecar is git-ignored), not failed.

- [ ] **Step 2: Re-check the golden vectors are current**

Run: `cd backend; & $py scripts/plant_grid_vectors.py; cd ..; git diff --exit-code -- contract/fixtures/plant-grid-vectors.json`
Expected: exit 0 (no drift).

- [ ] **Step 3: Check the hand-off facts the other units rely on**

```powershell
cd backend
& $py -c "from app.asset_models.builders.base import catalogue; print([t['type'] for t in catalogue()])"
& $py -c "from alembic.config import Config; from alembic.script import ScriptDirectory; from app.db.session import MIGRATIONS; c = Config(str(MIGRATIONS / 'alembic.ini')); c.set_main_option('script_location', str(MIGRATIONS)); print(ScriptDirectory.from_config(c).get_heads())"
cd ..
```
Expected: `['composite', 'other']`; `['0017']`.

- [ ] **Step 4: Write the walkthrough lines for the coordinator**

Put these in the READY_TO_MERGE report (F0 changes no screen):
1. Not user-observable: F0 adds the contract, the tables, the spec models, the builder registry and stubs; the app looks and behaves as before.
2. Optional check: open an existing project with an asset model; it opens (migration 0017 runs), the model and its versions are all there, and "Refine with AI" still offers Build/Refine only.

- [ ] **Step 5: Commit anything the gate changed**

If formatting or the vectors changed, stage those files by path and commit `chore(plant): F0 gate fixes` with the co-author line. Otherwise nothing to commit. Do not merge, push, build an installer or run `/wrapup`.

---

## Hand-off notes for the batch-2 units

- **A1:** keep `jobs_glb.run_glb`'s validation block and merge `meta["validation"]` into your meta when you dispatch to `assemble_glb`. Instance with `gltf_instancing.export_glb_instanced`, then `inject_node_extras`. Merge `build_item`'s flags into the item's flags by code. `AssetItemRowOut.of(row)` and `AssetItemPageOut` are ready; delete `A1_STUBS` tuples as you route; declare your `listAssetModelItems` 422s in `REFUSES_VALID_DATA` (`invalid_cursor`, `invalid_bbox` are declared in the contract).
- **B1/B2/B3:** register with `@builder(type, family=..., params=<Params subclass with defaults>, doc=..., default_height_m=...)`; `PLANNED_TYPES` already lists your types and families (a mismatch raises at import). Use palette names only (`build_item` refuses others). Family modules may be packages. Do not edit `base.py`; shared helpers go in your own module.
- **R1:** the plant run refusal is in `runs.start_asset_model_run` (delete it). Store stage usage in `run.usage["by_stage"]` in the `AssetModelRunUsageByStage` shape; pass `AssetModelRunPackagesOut` to `AssetModelRunOut.of`. `site_model_package` has `expected`, `attempts`, `items` for resume. Delete `R1_STUBS`.
- **I1:** route `createDrawingPages` and `listUnimportedDrawings` ahead of `/drawings/{drawingId}`, delete `I1_STUBS` and the `stubs_plant:drawings_router` line in `app/api.py`.
- **S1:** `SiteSceneOut` and friends are ready in `schemas_plant.py`; delete `S1_STUBS`. Pin `siteTransform.ts` to `contract/fixtures/plant-grid-vectors.json` (`frame`, `rows`).
- **C1/K1:** `PlantGrid(frame)` keeps `.frame`; fixtures are `backend/tests/data/plant/kipic_register.csv` and `kipic_landmask.json`.
