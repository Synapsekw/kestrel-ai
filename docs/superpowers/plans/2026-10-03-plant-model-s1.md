# Plant model G1, unit S1: Site 3D core Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A new per-project Site 3D view (`/p/:projectId/site[/:modelId]`) that opens a plant model GLB over the draped site ortho and the georeferenced drawings, from one bounded scene-manifest route, with orbit/pan/fly, presets, picking and a minimal screen that S2/S3 extend.

**Architecture:**
- Backend: one new module `backend/app/asset_models/site_scene.py` routes `getSiteScene` (`GET /api/v1/projects/{projectId}/site-scene?modelId=`). It reads the chosen plant model's ready version (`spec.site` gives the frame), else the map workspace frame; the workspace's ready maps and placed raster drawings through `app.workspace.layers.list_layers`; ≤ 200 ready clouds; two counts. URLs are server-relative and token-free.
- Frontend: a new folder `frontend/src/site3d/`:
  - `engine/` (`SiteEngine`, `siteTransform`, `camera`, `pick`, `tiles`, `create`);
  - `layers/` (`types`, `model.layer`, `tileDrape`, `ortho.layer`, `drawing.layer`);
  - a lazily loaded `SiteScreen` with placeholder panels that S3 replaces.
- The engine is separate from `assetmodels/viewer/engine.ts`, which this unit does not touch.

**Tech Stack:** FastAPI, SQLAlchemy, pyproj, pytest (backend); React 18 + TS, three 0.180.0 (`GLTFLoader`, `MeshoptDecoder`, `OrbitControls`), Vitest, Playwright (frontend). No new packages.

**Spec:** `docs/superpowers/specs/2026-10-03-plant-model-generator-design.md` (§10 `site-scene`, §11 Site 3D view, §12 budget, §13 S1 tests, §15 amendments). Index: `docs/superpowers/plans/2026-10-03-plant-model.md` (Global Constraints and Binding interfaces are law).

**Unit:** S1. Worktree `.claude/worktrees/pm-s1`, branch `task/pm-s1`. Cut after F0 is merged to `main`. Batch 2; merge position: any order within batch 2, and before S2 and S3, which are cut after S1.

---

## Global Constraints

Copied from the index; every task's requirements include them.

- `contract/openapi.yaml` is the source of truth. `contract/client/schema.d.ts` is regenerated with `pnpm -C contract generate` and committed in the same commit, never hand-edited.
- `oas3-unused-component` is an error. Nullable types use `type: [X, "null"]`.
- Path parameter names match the contract literally: `projectId`, `assetModelId`, `version`, `runId`, `itemId`.
- **F0 owns the contract.** No other unit edits `openapi.yaml` except to fix a defect, which is then logged as a ruling and handed off.
- Every contract operation is routed (`backend/tests/test_contract.py`). Until the owning unit lands, new operations are 501 stubs in `app/asset_models/stubs_plant.py`; the owning unit deletes its stub line.
- Logs carry tool names, states, durations and counts only.
- No route blocks on mesh generation, validation over 200 items, cloud sampling or a model call.
- **Bounded reads (Site 3D):** ortho/drawing textures ≤ 64 MB and ≤ 256 live tiles; cloud point budget 3 M (setting, S2); photo glyphs ≤ 2 000 (S2). Every list in `SiteScene` is ≤ 200 entries.
- Scene/GLB frame: metres, `x = plant_N`, `y = EL - datum.el_m`, `z = plant_E` (Y up, X plant north, Z plant east).
- Site CRS from plant: `[X, Y] = origin_crs + R(plant_north_deg) · [E, N]`, `R(θ) = [[cos θ, sin θ], [-sin θ, cos θ]]`. Pinned by `contract/fixtures/plant-grid-vectors.json` (F0 writes it), to 0.05 m.
- Copy is sentence case. No raw colours in TSX/CSS (`frontend/scripts/check-tokens.mjs`).
- Motion via tokens only; respect reduced motion. Panels use `GlassPanel` and the `frontend/src/ui/` primitives.
- The Site 3D screen is lazy-loaded (`src/app/lazyScreens.tsx`). `three` stays pinned at 0.180.0.
- e2e navigation uses `getByRole("navigation", { name: "Main navigation" }).getByRole("link", { name: /^Asset models/ })` (S1 adds no entry point; see Ruling R12).
- Stage files by path; never `git add -A`. Never `git stash`. Commits end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Commit identity is "Danijel Jovanovic" / info@synapse-solutions.ai.
- Backend interpreter: `E:\Dev\Yolo\app\backend\.venv\Scripts\python.exe`, run from `<worktree>\backend`. Never install anything into the shared venv. No new frontend packages.
- e2e ports for S1: `E2E_WEB_PORT=5390`, `E2E_MOCK_PORT=5391` (coordinator table).

## Budget

- **Background jobs:** none. S1 reads the GLB that A1's `asset_model_glb` job writes; it starts no job.
- **Bounded reads:**
  - `getSiteScene`: one model row and one version row; at most 200 plant models scanned for the default (by an indexed `created_at` order); the workspace layer rows (tens, the same read as `listWorkspaceLayers`); ≤ 200 cloud rows; two `COUNT(*)` queries. No file is opened, and no list goes over 200 entries.
  - Site 3D drape: one shared `TileCache` of ≤ 256 live tiles (256 × 256 × 4 bytes each, no mipmaps, so ≤ 64 MiB), ≤ 6 tile fetches in flight. Each drape layer asks for at most `256 / visible drapes` tiles per frame (screen-space-error quadtree, ≤ 16 roots).
  - One model GLB at a time.
- Rendering is on demand: frames run only during a tween, fly movement, tile loads, or for 1 s after input.

## Execution DAG

| Task | Depends on | Batch |
| --- | --- | --- |
| T1 Align with merged F0 | — | 0 |
| T2 Backend `getSiteScene` | T1 | 1 |
| T3 `siteTransform.ts` + golden vectors | T1 | 1 |
| T4 `api/siteScene.ts` + scene fixtures | T1 | 1 |
| T5 `engine/tiles.ts` (quadtree, quads, cache) | T3 | 2 |
| T6 `SiteEngine` + camera + pick + layer types | T5 | 3 |
| T7 Drape layers (`tileDrape`, `ortho.layer`, `drawing.layer`) | T6 | 4 |
| T8 `model.layer` + fixture GLB | T6 | 4 |
| T9 Route, lazy `SiteScreen`, view and placeholder panels | T4, T7, T8 | 5 |
| T10 e2e `site.spec.ts` | T2, T9 | 6 |
| T11 Full gate + walkthrough | all | 7 |

- **Parallel batches:** {T2, T3, T4} after T1; {T7, T8} after T6. T2 runs alongside the whole frontend chain.
- **Critical path:** T1 → T3 → T5 → T6 → T7 → T9 → T10 → T11.

## Interfaces provided (exact)

Backend (`backend/app/asset_models/site_scene.py`):
```python
MAX_LIST = 200
def choose_model(s: Session, model_id: str | None) -> tuple[AssetModel, AssetModelVersion | None] | None
def frame_from_site(site: object) -> SceneFrame | None
def min_zoom_for(bounds: tuple[float, float, float, float], max_z: int) -> int
def build_scene(handle: ProjectHandle, model_id: str | None) -> SiteSceneOut
router  # GET /projects/{projectId}/site-scene  (operationId getSiteScene)
```

Frontend:
```ts
// src/site3d/engine/siteTransform.ts  (binding)
export interface SiteFrameT { crs: { epsg: number | null; wkt: string | null }; origin_crs: [number, number]; plant_north_deg: number; datum: { label: string; el_m: number } }
export function plantToSite(f: SiteFrameT, e: number, n: number): [number, number]
export function siteToPlant(f: SiteFrameT, x: number, y: number): [number, number]
export function plantToScene(f: SiteFrameT, e: number, n: number, el: number): [number, number, number]
export function siteToScene(f: SiteFrameT, x: number, y: number, z: number): [number, number, number]
export function sceneToSite(f: SiteFrameT, sx: number, sy: number, sz: number): [number, number, number]

// src/api/siteScene.ts  (binding names)
export type SiteScene = Schemas["SiteScene"];
export function useSiteScene(projectId: string, modelId?: string | null): { scene: SiteScene | null; error: string | null; loading: boolean; reload(): void }
export function useAssetItems(projectId: string, modelId: string | null, version: number | null, filters?: ItemFilters): { items: AssetItemRow[] | null; error: string | null; hasMore: boolean; loadMore(): void; reload(): void }
export async function getAssetItem(api: ApiClient, projectId: string, assetModelId: string, version: number, itemId: string): Promise<AssetItem>
export async function getSiteScene(api: ApiClient, projectId: string, modelId?: string | null): Promise<SiteScene>
export async function listAssetItems(api: ApiClient, projectId: string, assetModelId: string, version: number, filters?: ItemFilters, cursor?: string | null): Promise<AssetItemPage>
export function absUrl(info: { baseUrl: string; token: string }, rel: string): string
export function toFrameT(f: SiteScene["frame"]): SiteFrameT | null

// src/site3d/layers/types.ts  (binding SiteLayer, plus PickHit/Pickable)
export interface SiteLayer { id: string; label: string; attach(e: SiteEngine): Promise<void> | void; detach(): void; setVisible(v: boolean): void; setOpacity?(o: number): void; update?(dt: number, camera: THREE.Camera): void }
export interface PickHit { layerId: string; itemId: string; point: [number, number, number]; extras: Record<string, unknown> }
export interface Pickable { layerId: string; root: THREE.Object3D; resolve(object: THREE.Object3D): { itemId: string; extras: Record<string, unknown> } | null; accepts?(point: THREE.Vector3): boolean }

// src/site3d/engine/SiteEngine.ts  (binding members first)
export type NavMode = "orbit" | "pan" | "fly";
export class SiteEngine {
  constructor(canvas: HTMLCanvasElement, frame: SiteFrameT | null);       // throws NoWebGlError
  addLayer(l: SiteLayer): void; removeLayer(id: string): void; flyTo(box: THREE.Box3): void;
  setPreset(id: string, opts?: { instant?: boolean }): void;              // "fit" | "plan" | `area:<label>`
  pick(x: number, y: number): PickHit | null; onSelect(cb: (hit: PickHit | null) => void): () => void; dispose(): void;
  // for layers and S2/S3:
  readonly frame: SiteFrameT | null; readonly scene: THREE.Scene; readonly camera: THREE.PerspectiveCamera; readonly renderer: THREE.WebGLRenderer; readonly tiles: TileCache;
  select(hit: PickHit | null): void; setNav(mode: NavMode): void; readonly navMode: NavMode; requestRender(): void; viewportHeight(): number; drapeCount(): number;
  layer(id: string): SiteLayer | undefined; addPickable(p: Pickable): void; removePickable(layerId: string): void;
  setContentBox(owner: string, box: THREE.Box3 | null): void; contentBox(): THREE.Box3 | null;
  setPresetBox(owner: string, id: string, box: THREE.Box3 | null): void; clearPresets(owner: string): void; presets(): string[];
}
// src/site3d/engine/create.ts
export function createSiteEngine(canvas: HTMLCanvasElement, frame: SiteFrameT | null): SiteEngine

// src/site3d/layers/model.layer.ts
export type ColourBy = "material" | "type" | "area" | "height_source" | "flag";
export interface ModelLoadInfo { items: number; areas: string[]; types: string[] }
export class ModelLayer implements SiteLayer { readonly id: "model"; setColourBy(m: ColourBy): void; setOpacity(o: number): void; setWireframe(on: boolean): void; setCut(y: number | null): void; itemBox(id: string): THREE.Box3 | null; itemIds(): string[]; adopt(scene: THREE.Object3D): ModelLoadInfo }
export function createModelLayer(opts: ModelLayerOptions): ModelLayer
// src/site3d/layers/ortho.layer.ts, drawing.layer.ts
export function createOrthoLayer(o: SceneOrtho, url: (rel: string) => string, onGone?: () => void): TileDrapeLayer   // id `ortho:<id>`
export function createDrawingLayer(d: SceneDrawing, url: (rel: string) => string, onGone?: () => void): TileDrapeLayer // id `drawing:<id>`
// src/site3d/SiteScreen.tsx
export function SiteScreen(): JSX.Element
```

## Interfaces consumed

| From | Name | Where |
| --- | --- | --- |
| F0 | operation `getSiteScene`, schema `SiteScene` (fields as in the index table), `AssetItemPage`, `AssetItemRow`, `AssetItem`, `listAssetModelItems` query params `q,type,area,flag,bbox,cursor,limit` | `contract/openapi.yaml`, `contract/client/schema.d.ts` |
| F0 | the `getSiteScene` 501 stub line | `backend/app/asset_models/stubs_plant.py` |
| F0 | `AssetModel.kind` (`asset` \| `plant`) | `backend/app/db/models.py` (migration 0017) |
| F0 | `contract/fixtures/plant-grid-vectors.json` (50 rows `{plant_E, plant_N, site_X, site_Y}` + frame) | contract fixtures |
| main | `app.workspace.layers.list_layers(handle) -> (SiteFrame, list[WorkspaceLayerOut])`, `app.workspace.frame.same_crs`, `app.workspace.grid` (`TILE`, `RES0`) | backend |
| main | `AssetModel`, `AssetModelVersion`, `PointCloud`, `Image`, `Finding`, `Source` ORM; `app.errors.not_found`; `get_project` | backend |
| main | `siteRes`, `tileBounds`, `SiteTile`, `SiteExtent` | `frontend/src/mapws/view/siteGrid.ts` |
| main | `NoWebGlError` (`@/clouds/viewer/engine`), `tokenColor`/`tokenRgb` (`@/clouds/viewer/overlay`), `disposeChildren` (`@/clouds/viewer/dispose`), `startTween`/`tweenAt` (`@/clouds/viewer/tween`), `View` (`@/clouds/viewer/camera`) | frontend |
| main | `isReducedMotion`, `isTypingTarget`, `GlassPanel`, `EmptyState`, `Alert`, `Button`, `buttonClass`, `IconButton`, `Pill`, `Switch`, `Skeleton`, `FloatingToolbar`, `ToolButton`, `ToolSeparator`, `MenuButton`, `cx` | `frontend/src/ui` |
| main | `useApi`, `useBackend`, `unwrap`, `useOnJobsFinished` | `frontend/src/api`, `frontend/src/jobs` |

## Shared-file touches

| File | Anchor | Additive change |
| --- | --- | --- |
| `backend/app/api.py` | the maps-guarded `for _module in (` tuple, line `"app.workspace.router",` | insert `"app.asset_models.site_scene",` on the line above it |
| `backend/app/asset_models/stubs_plant.py` (F0) | the tuple naming `getSiteScene` | delete that one tuple |
| `frontend/src/app/lazyScreens.tsx` | after `AssetModelsScreen` | add `SiteScreen` lazy export |
| `frontend/src/routes/projectRoutes.tsx` | after the `models/:modelId` entry | add `site` and `site/:modelId` entries |
| `frontend/src/app/routeModel.ts` | `layoutOf`, `routeInfo` | `site` is full-bleed; breadcrumb page "Site 3D" |
| `frontend/src/app/routeModel.test.ts`, `frontend/src/routes/routes.test.tsx`, `frontend/src/app/lazyScreens.test.tsx` | existing `describe` blocks | new cases only |
| `contract/openapi.yaml` + `schema.d.ts` | `getSiteScene` responses | only if T1 finds a missing `404` (a logged defect fix) |

## Tests (added or changed)

- Backend: `backend/tests/test_site_scene.py` (new).
- Frontend unit:
  - `src/site3d/engine/siteTransform.test.ts`, `src/site3d/engine/tiles.test.ts`, `src/site3d/engine/camera.test.ts`, `src/site3d/engine/pick.test.ts`, `src/site3d/engine/SiteEngine.test.ts`;
  - `src/site3d/layers/tileDrape.test.ts`, `src/site3d/layers/model.layer.test.ts`, `src/site3d/layerRows.test.ts`, `src/site3d/SiteScreen.test.tsx`;
  - `src/api/siteScene.test.ts`;
  - changed: `src/app/routeModel.test.ts`, `src/routes/routes.test.tsx`, `src/app/lazyScreens.test.tsx`.
- e2e: `frontend/e2e/site.spec.ts` with fixtures `frontend/e2e/fixtures/site-plant.glb` (generated by `frontend/e2e/fixtures/make-site-plant-glb.mjs`) and `frontend/e2e/fixtures/siteScene.ts`.

## Review Focus

The index names S1 for one line (#5). The other four come from reading the spec with this unit in front of me.

1. **A project with no ortho, no cloud, or no model yet** (index #5). The view opens with whatever exists: the frame from the map workspace, empty layers greyed, and an empty state pointing at "Build a plant model". It never shows a blank canvas or an uncaught error. Test: T9 `SiteScreen.test.tsx` "no model" and "no frame"; backend T2 `test_empty_project_has_no_frame_and_no_model`.
2. **The map workspace frame is in another CRS than the plant frame** (the operator changed the frame chip). Site tiles are cut in the workspace frame, so draping them with the plant transform would misplace them by kilometres. They must be left out, never misplaced. Test: T2 `test_tiles_in_another_crs_are_left_out`.
3. **The plant model GLB fails to load** (a version whose build failed after its row said ready, a 409, a truncated file). Expected: a "could not load" notice with "Reload view", and the ortho stays. Test: T9 `SiteScreen.test.tsx` "a model that fails to load".
4. **A large ortho seen up close** (a 3 km site at 2 cm GSD). Without a cap, a naive quadtree asks for thousands of tiles. The drape must stay ≤ 256 live tiles and ≤ 64 MB. Test: T5 `tiles.test.ts` "never selects more than the cap" and "cache never holds more than its capacity".
5. **Item ids with dots or slashes** (`rack.1`, `20-T-0001/A`). GLTFLoader strips `.` and `/` from node names, so a pick keyed by name would miss or collide. Picks resolve the id from the node extras. Test: T8 `model.layer.test.ts` "ids come from extras, so dots survive", plus the fixture GLB's `rack.1`.

## Rulings

- **R1 URLs.** Every URL in `SiteScene` is a server-relative path (`/api/v1/projects/...`) without a token. The client makes it absolute with `absUrl(backend, rel)`, which appends `token`. `octree_url` is the exception: S2 passes it to potree-core without a token, because potree-core's RequestManager adds one (as `cloudOctreeUrl` does today).
- **R2 Model choice.**
  - With `modelId`: that model, or 404 `not_found` when it does not exist. It shows its `current_version` when that GLB is ready, else its newest ready version, else `model: null`.
  - Without `modelId`: the newest `kind == "plant"` model that has a ready version. An asset-kind (M1) model shows only when asked for by id.
- **R3 Frame.**
  - The shown version's `spec.site` gives the frame.
  - Otherwise the map workspace frame: its CRS, `plant_north_deg = 0`, datum `{label: "EL", el_m: 0}`, and an origin at the centre of everything placed (in-frame maps, placed raster drawings, same-CRS clouds), rounded to 100 m.
  - Nothing placed and no model gives `frame: null`. A model whose spec has no `site` and nothing placed gives the workspace CRS with origin `(0, 0)`.
- **R4 Tile layers.** Site tiles are cut in the workspace frame, so maps and drawings are listed only when the workspace CRS equals the scene CRS. Otherwise they are left out and the count is logged. Vector drawings (DXF, LandXML) are not draped in S1; only `drawing_raster` ones are.
- **R5 Clouds.** `same_crs` is true only when both the cloud and the scene have a CRS and pyproj says they are equal. A local-frame cloud is never "same". `z_offset_m` is `spec.site.cloud_z_to_el.offset_m` when `cloud_id` matches, else `0`. It means "plant EL = cloud z + z_offset_m" (S2 subtracts the datum).
- **R6 Counts.** `photos.count` is the images with `lat` and `lon`. `photos.url` is the cameras route of the first same-CRS cloud, else null. `findings.count` is the findings anchored on a map or a cloud. `findings.url` is `…/map-workspace/findings`.
- **R7 Zooms.** `max_z` is the layer's `max_zoom` from `list_layers`. `min_z` is the zoom where one tile spans the footprint's longer side: `floor(log2(262144 / side))`, clamped to `0..max_z`. Drawings carry no zooms in the contract: the client uses the same rule with `max_z = 19`.
- **R8 Pick and items.**
  - An item is the outermost node under the model root whose extras have a string `type` and a string `id` or `node`. Its id is `extras.id`, else `extras.node`.
  - Area presets come from `extras.area`.
  - These follow the A1 binding ("one node per item, with the register row in its extras"). S3 re-checks them against A1's merged code.
- **R9 Drape.**
  - The ortho sits at scene `y = 0` (plant EL = datum). Drawings sit at `y = 0.05` m and draw after the ortho (`renderOrder` +100).
  - Textures have no mipmaps. Tiles are fetched (not `<img>`) so a 204 is an empty tile and a 404/410 marks the layer gone, as `siteTileLoader.ts` does.
  - The cache is shared by every drape layer.
- **R10 Cut plane.** The S1 cut is horizontal: it keeps what is at or below a scene height. Picks ignore what is cut away.
- **R11 Selection outline.** The item's mesh edges (30° crease) in the accent token, drawn over everything. An item with instanced meshes or over 200 000 triangles gets its bounding box instead.
- **R12 No entry points in S1.** S3 owns them. The S1 e2e opens the deep link. The Main-navigation link selectors are used by S3's entry-point e2e. The route is full-bleed, and its breadcrumb page is "Site 3D".
- **R13 Shortcuts.** View tools have no keyboard shortcuts in S1, so there is no keymap scope edit (`FloatingToolbar shortcuts={false}`). Fly mode moves with W A S D (Q E down/up, Shift ×4) only while Fly is chosen and focus is not in a field. Escape clears the selection.
- **R14 S2 layers** (clouds, photos, findings) appear in the S1 Layers placeholder as counts that are not toggleable ("not in this view yet"). S2 makes them live.
- **R15 "Build a plant model"** links to the project's Asset models screen, where the run dialog lives in G1. S3 may deep-link it.

## Deviations

- Spec §11 says "three 0.180 + potree-core in one `WebGLRenderer`". S1 creates the one renderer; potree-core joins it in S2 (`cloud.layer.ts`).
- Spec §11 lists "View tools: … measure, cut, presets, screenshot". S1 ships orbit, pan, fly, fit, plan and area presets, plus the engine's horizontal cut (no UI). Measure, screenshot and the cut UI are S3's (the index gives panels to S3).
- Spec §10 says the manifest lists "ready clouds in the same CRS". The binding schema has `same_crs`, so S1 lists every ready cloud with the flag. S2 shows "can't place this cloud" for the others (index Review Focus #2).

---

### Task 1: Align with merged F0

**Files:** none changed unless step 3 finds a contract defect.

**Interfaces:**
- Consumes: everything in "Interfaces consumed" marked F0.
- Produces: an "Align with F0" note in the unit ledger listing every name this plan uses that F0 spelled differently. Later tasks use F0's spelling and keep their assertions.

- [ ] **Step 1: Confirm the worktree and that F0 is merged**

Run (PowerShell, from `E:\Dev\Yolo\app\.claude\worktrees\pm-s1`):
```
git rev-parse --show-toplevel; git branch --show-current; git log --oneline -8 main
```
Expected: the `pm-s1` path, `task/pm-s1`, and an F0 merge commit (message contains `pm-f0` or `plant model F0`) in the log. If F0 is not on `main`, stop and report `WAITING: F0`.

- [ ] **Step 2: Read F0's real code and compare**

Run each and compare with this plan:
```
Select-String -Path contract/openapi.yaml -Pattern "operationId: getSiteScene" -Context 4,30
Select-String -Path contract/openapi.yaml -Pattern "^    SiteScene:" -Context 0,80
Select-String -Path contract/client/schema.d.ts -Pattern "SiteScene|AssetItemPage|AssetItemRow|AssetItem:" | Select-Object -First 12
Select-String -Path backend/app/asset_models/stubs_plant.py -Pattern "getSiteScene"
Select-String -Path backend/app/db/models.py -Pattern "class AssetModel\b" -Context 0,16
Get-Content contract/fixtures/plant-grid-vectors.json -TotalCount 25
Select-String -Path backend/app/api.py -Pattern "stubs_plant|app.workspace.router"
```
Check and note:
1. `getSiteScene` path is `/api/v1/projects/{projectId}/site-scene` with an optional `modelId` query, and its declared responses include `200` and `404`.
2. `SiteScene` fields and nullability: `frame` (nullable; `crs.epsg`, `crs.wkt`, `origin_crs`, `plant_north_deg`, `datum.label`, `datum.el_m`); `model` (nullable; `id, version, glb_url, csv_url, kind`); `orthos[] {id, name, tile_url_template, bounds_site, min_z, max_z}`; `clouds[] {id, name, octree_url, crs_epsg, same_crs, z_offset_m}`; `drawings[] {id, name, tile_url_template, bounds_site}`; `photos {count, url}`; `findings {count, url}`. Note whether `photos.url` / `findings.url` are nullable. If `photos.url` is not nullable, T2 returns `""` when there is no same-CRS cloud and T9 treats `""` as none.
3. `AssetModel.kind` exists with values `asset | plant`.
4. The vectors file's top-level keys. This plan assumes `{"frame": {crs, origin_crs, plant_north_deg, datum}, "rows": [{plant_E, plant_N, site_X, site_Y}]}`. If F0 used other keys, adapt the `Vectors` interface in T3's test only.
5. The `stubs_plant` module's list structure, so T2 can delete exactly the `getSiteScene` tuple.

- [ ] **Step 3: Fix a contract defect only if step 2 found one**

If `getSiteScene` declares no `404`, add it next to the `200` response, copying how `getAssetModel` declares its 404 (same `$ref`), then:
```
pnpm -C contract generate; pnpm -C contract check
```
Expected: `check` passes and `schema.d.ts` changes. Write a ruling line in the unit ledger ("R-S1-1: getSiteScene declares 404 for an unknown modelId; handed to F0's owner").

- [ ] **Step 4: Baseline**

Run:
```
pnpm -C frontend exec vitest run src/mapws/view/siteGrid.test.ts
cd backend; E:\Dev\Yolo\app\backend\.venv\Scripts\python.exe -m pytest tests/test_contract.py -q -k "routed or stub_list"; cd ..
```
Expected: both PASS (the 501 stub keeps `getSiteScene` routed).

- [ ] **Step 5: Commit (only if step 3 changed the contract)**

```
git add contract/openapi.yaml contract/client/schema.d.ts
git commit -m "fix(contract): getSiteScene declares 404 for an unknown model" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```
Otherwise there is nothing to commit; the ledger note is the deliverable.

---

### Task 2: Backend `getSiteScene`

**Files:**
- Create: `backend/app/asset_models/site_scene.py`
- Modify: `backend/app/api.py` (maps-guarded tuple, above `"app.workspace.router",`)
- Modify: `backend/app/asset_models/stubs_plant.py` (delete the `getSiteScene` tuple)
- Test: `backend/tests/test_site_scene.py`

**Interfaces:**
- Consumes: `list_layers`, `same_crs`, `grid.TILE`, `grid.RES0`, ORM rows, `not_found`, `get_project`; F0's `AssetModel.kind`.
- Produces: `GET /api/v1/projects/{projectId}/site-scene?modelId=` returning `SiteScene` (see "Interfaces provided"). S2/S3 read it through `useSiteScene`.

- [ ] **Step 1: Write the failing tests**

`backend/tests/test_site_scene.py`:
```python
"""The Site 3D scene manifest (spec 2026-10-03-plant-model-generator §10-§11, plan S1 T2)."""

from __future__ import annotations

from datetime import UTC, datetime

import pytest
from pyproj import CRS
from workspace_rows import BASE, add_map, set_frame

from app.asset_models import site_scene
from app.db.models import AssetModel, AssetModelVersion, Drawing, Finding, Image, PointCloud, Source

UTM38 = CRS.from_epsg(32638).to_wkt()
UTM39 = CRS.from_epsg(32639).to_wkt()
GT39 = [500000.0, 0.03, 0.0, 3300000.0, 0.0, -0.03]
SITE = {
    "crs": {"epsg": 32639, "wkt": None},
    "origin_crs": [244338.089, 3179515.69],
    "plant_north_deg": 17.9991,
    "datum": {"label": "HPFS", "el_m": 100.0},
    "cloud_z_to_el": None,
    "source": {"kind": "drawing"},
}


def _scene(client, project_id, **query):
    r = client.get(f"{BASE}/{project_id}/site-scene", params=query)
    assert r.status_code == 200, r.text
    return r.json()


def add_model(handle, *, kind="plant", site=SITE, glb="ready", created=None, versions=1) -> str:
    with handle.session() as s:
        m = AssetModel(name="Al-Zour", status="ready", current_version=versions, kind=kind)
        if created is not None:
            m.created_at = created
        s.add(m)
        s.flush()
        for v in range(1, versions + 1):
            spec = {"parts": [], "items": [], "environment": []}
            if site is not None:
                spec["site"] = site
            s.add(AssetModelVersion(model_id=m.id, version=v, spec=spec, kind="agent", glb_status=glb))
        return m.id


def add_cloud(handle, *, name="Scan", crs_wkt=UTM39, epsg=32639, bounds=None, status="ready") -> str:
    with handle.session() as s:
        row = PointCloud(
            name=name,
            status=status,
            source_path="D:/scan.laz",
            source_size=1,
            crs_wkt=crs_wkt,
            epsg=epsg,
            bounds_native=bounds or [500000.0, 3299900.0, -5.0, 500200.0, 3300000.0, 30.0],
        )
        s.add(row)
        s.flush()
        return row.id


def add_raster_drawing(handle, *, name="Plot plan", placed=True) -> str:
    with handle.session() as s:
        row = Drawing(
            name=name,
            format="pdf",
            status="ready",
            source_path="D:/p.pdf",
            source_size=1,
            width=1000,
            height=500,
            extent_src=[0, -500, 1000, 0],
            georef_version=3 if placed else 0,
            georef=(
                {
                    "method": "control_points",
                    "crs_wkt": None,
                    "epsg": None,
                    "model": "similarity",
                    "points": [{}, {}, {}],
                    "dst_crs_wkt": UTM39,
                    "transform": [0.02, 0.0, 500000.0, 0.0, 0.02, 3300000.0],
                    "rmse_m": 0.05,
                    "residuals_m": [],
                    "warnings": [],
                }
                if placed
                else None
            ),
        )
        s.add(row)
        s.flush()
        return row.id


def test_empty_project_has_no_frame_and_no_model(client, project_id):
    got = _scene(client, project_id)
    assert got["frame"] is None and got["model"] is None
    assert got["orthos"] == [] and got["clouds"] == [] and got["drawings"] == []
    assert got["photos"] == {"count": 0, "url": None}
    assert got["findings"] == {"count": 0, "url": f"/api/v1/projects/{project_id}/map-workspace/findings"}


def test_a_map_gives_a_workspace_frame_and_an_ortho(client, project_id, handle):
    m = add_map(handle, crs_wkt=UTM39, geotransform=GT39, width=4000, height=2000, gsd_cm=3.0)
    set_frame(client, project_id, 32639)
    got = _scene(client, project_id)
    f = got["frame"]
    assert f["crs"]["epsg"] == 32639 and f["crs"]["wkt"]
    assert f["plant_north_deg"] == 0.0 and f["datum"] == {"label": "EL", "el_m": 0.0}
    # footprint 500000..500120 x 3299940..3300000: centre (500060, 3299970), rounded to 100 m
    assert f["origin_crs"] == [500100.0, 3300000.0]
    assert got["model"] is None
    (o,) = got["orthos"]
    assert o["id"] == m and o["name"] == "ortho"
    assert o["tile_url_template"] == (
        f"/api/v1/projects/{project_id}/site-tiles/map/{m}/{{z}}/{{x}}/{{y}}?v={m}&frame_key=epsg%3A32639"
    )
    assert o["bounds_site"] == pytest.approx([500000.0, 3299940.0, 500120.0, 3300000.0])
    assert o["max_z"] == 17 and o["min_z"] == 11  # 262144 / 120 m = 2184.5 -> log2 = 11.09
    assert "token" not in o["tile_url_template"]


def test_plant_model_frame_comes_from_its_site(client, project_id, handle):
    add_model(handle, kind="asset", site=None)  # an M1 model is never the default
    mid = add_model(handle)
    got = _scene(client, project_id)
    assert got["model"] == {
        "id": mid,
        "version": 1,
        "glb_url": f"/api/v1/projects/{project_id}/asset-models/{mid}/versions/1/glb",
        "csv_url": f"/api/v1/projects/{project_id}/asset-models/{mid}/versions/1/csv",
        "kind": "plant",
    }
    f = got["frame"]
    assert f["crs"] == {"epsg": 32639, "wkt": None}
    assert f["origin_crs"] == [244338.089, 3179515.69]
    assert f["plant_north_deg"] == 17.9991 and f["datum"] == {"label": "HPFS", "el_m": 100.0}


def test_the_newest_plant_with_a_ready_glb_is_the_default(client, project_id, handle):
    old = add_model(handle, created=datetime(2026, 10, 1, tzinfo=UTC))
    add_model(handle, glb="pending", created=datetime(2026, 10, 2, tzinfo=UTC))
    assert _scene(client, project_id)["model"]["id"] == old


def test_model_id_picks_that_model_and_unknown_is_404(client, project_id, handle):
    asset = add_model(handle, kind="asset", site=None)
    got = _scene(client, project_id, modelId=asset)
    assert got["model"]["id"] == asset and got["model"]["kind"] == "asset"
    assert got["frame"] is not None and got["frame"]["origin_crs"] == [0.0, 0.0]  # R3: no site, nothing placed
    r = client.get(f"{BASE}/{project_id}/site-scene", params={"modelId": "nope"})
    assert r.status_code == 404 and r.json()["error"]["code"] == "not_found"


def test_current_version_wins_else_newest_ready(client, project_id, handle):
    mid = add_model(handle, versions=3)
    with handle.session() as s:
        m = s.get(AssetModel, mid)
        m.current_version = 2
    assert _scene(client, project_id, modelId=mid)["model"]["version"] == 2
    with handle.session() as s:
        row = s.query(AssetModelVersion).filter_by(model_id=mid, version=2).one()
        row.glb_status = "failed"
    assert _scene(client, project_id, modelId=mid)["model"]["version"] == 3


def test_a_model_without_a_ready_glb_is_not_shown(client, project_id, handle):
    mid = add_model(handle, glb="pending")
    got = _scene(client, project_id, modelId=mid)
    assert got["model"] is None


def test_clouds_same_crs_and_z_offset(client, project_id, handle):
    same = add_cloud(handle, name="Same")
    other = add_cloud(handle, name="Other", crs_wkt=UTM38, epsg=32638)
    local = add_cloud(handle, name="Local", crs_wkt=None, epsg=None)
    add_cloud(handle, name="Importing", status="importing")
    add_model(handle, site={**SITE, "cloud_z_to_el": {"cloud_id": same, "offset_m": 120.45, "tilt": None}})
    got = {c["id"]: c for c in _scene(client, project_id)["clouds"]}
    assert set(got) == {same, other, local}
    assert got[same]["same_crs"] is True and got[same]["z_offset_m"] == 120.45
    assert got[same]["crs_epsg"] == 32639
    assert got[same]["octree_url"] == f"/api/v1/projects/{project_id}/pointclouds/{same}/octree/metadata.json"
    assert got[other]["same_crs"] is False and got[other]["z_offset_m"] == 0.0
    assert got[local]["same_crs"] is False and got[local]["crs_epsg"] is None


def test_tiles_in_another_crs_are_left_out(client, project_id, handle):
    add_map(handle, crs_wkt=UTM39, geotransform=GT39, width=400, height=400)
    add_raster_drawing(handle)
    set_frame(client, project_id, 32639)
    add_model(handle, site={**SITE, "crs": {"epsg": 32638, "wkt": None}})
    got = _scene(client, project_id)
    assert got["frame"]["crs"]["epsg"] == 32638
    assert got["orthos"] == [] and got["drawings"] == []  # Review Focus 2: never misplaced


def test_placed_raster_drawings_only(client, project_id, handle):
    set_frame(client, project_id, 32639)
    placed = add_raster_drawing(handle)
    add_raster_drawing(handle, name="Loose", placed=False)
    with handle.session() as s:
        s.add(
            Drawing(
                name="Setting out",
                format="dxf",
                status="ready",
                source_path="D:/s.dxf",
                source_size=1,
                extent_src=[0, 0, 50, 20],
                georef_version=1,
                georef={
                    "method": "crs",
                    "crs_wkt": UTM39,
                    "epsg": 32639,
                    "model": None,
                    "points": [],
                    "dst_crs_wkt": UTM39,
                    "transform": [1, 0, 500000.0, 0, 1, 3299900.0],
                    "rmse_m": None,
                    "residuals_m": [],
                    "warnings": [],
                },
            )
        )
    got = _scene(client, project_id)
    (d,) = got["drawings"]
    assert d["id"] == placed and d["name"] == "Plot plan"
    assert d["tile_url_template"] == (
        f"/api/v1/projects/{project_id}/site-tiles/drawing_raster/{placed}/{{z}}/{{x}}/{{y}}"
        "?v=3&frame_key=epsg%3A32639"
    )
    assert d["bounds_site"] == pytest.approx([500000.0, 3299990.0, 500020.0, 3300000.0])
    assert got["frame"]["origin_crs"] == [500000.0, 3300000.0]  # centre (500010, 3299995) rounded


def test_photo_and_finding_counts(client, project_id, handle):
    m = add_map(handle, crs_wkt=UTM39, geotransform=GT39, width=400, height=400)
    set_frame(client, project_id, 32639)
    cid = add_cloud(handle)
    with handle.session() as s:
        src = Source(folder="D:/photos", site="north")
        s.add(src)
        s.flush()
        s.add_all(
            [
                Image(path="a.jpg", width=10, height=10, source_id=src.id, lat=29.1, lon=48.1),
                Image(path="b.jpg", width=10, height=10, source_id=src.id, lat=29.2, lon=48.2),
                Image(path="c.jpg", width=10, height=10, source_id=src.id),
                Finding(
                    number=1,
                    type_id="t1",
                    anchor_kind="map",
                    map_id=m,
                    geometry={"type": "Point", "coordinates": [500010.0, 3299990.0]},
                    data_type="map",
                    data_id=m,
                ),
                Finding(
                    number=2,
                    type_id="t1",
                    anchor_kind="cloud",
                    cloud_id=cid,
                    x=1.0,
                    y=2.0,
                    z=3.0,
                    data_type="point_cloud",
                    data_id=cid,
                ),
            ]
        )
    got = _scene(client, project_id)
    assert got["photos"] == {"count": 2, "url": f"/api/v1/projects/{project_id}/pointclouds/{cid}/cameras"}
    assert got["findings"]["count"] == 2


def test_lists_are_capped(client, project_id, handle, monkeypatch):
    monkeypatch.setattr(site_scene, "MAX_LIST", 2)
    for i in range(3):
        add_cloud(handle, name=f"c{i}")
    assert len(_scene(client, project_id)["clouds"]) == 2


@pytest.mark.parametrize(
    ("bounds", "max_z", "want"),
    [((0, 0, 120, 60), 17, 11), ((0, 0, 3000, 1000), 18, 6), ((0, 0, 1e7, 1), 20, 0), ((0, 0, 0.01, 0.01), 12, 12)],
)
def test_min_zoom_for(bounds, max_z, want):
    assert site_scene.min_zoom_for(bounds, max_z) == want


def test_frame_from_site_tolerates_a_malformed_site():
    assert site_scene.frame_from_site(None) is None
    assert site_scene.frame_from_site({"crs": {}}) is None
    f = site_scene.frame_from_site(SITE)
    assert f is not None and f.origin_crs == (244338.089, 3179515.69)
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd backend; E:\Dev\Yolo\app\backend\.venv\Scripts\python.exe -m pytest tests/test_site_scene.py -q; cd ..`
Expected: FAIL at import: `ImportError: cannot import name 'site_scene' from 'app.asset_models'`.

- [ ] **Step 3: Write the module**

`backend/app/asset_models/site_scene.py`:
```python
"""The Site 3D scene manifest, `getSiteScene` (spec 2026-10-03-plant-model-generator §10-§11, plan S1).

One bounded read per call: the chosen model's ready version (its `spec.site` is the frame), else the
map workspace frame; the workspace's ready maps and placed raster drawings (the rows
`listWorkspaceLayers` reads, tens); at most MAX_LIST ready clouds; two counts. Every list is capped at
MAX_LIST. URLs are server-relative and carry no token: the client adds its base URL and token (plan
ruling R1). No file is opened here.
"""

from __future__ import annotations

import logging
import math
from typing import Literal
from urllib.parse import urlencode

from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel
from pyproj import CRS
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.db.models import AssetModel, AssetModelVersion, Finding, Image, PointCloud
from app.errors import not_found
from app.projects.service import ProjectHandle, get_project
from app.workspace import grid
from app.workspace.frame import SiteFrame as WorkspaceFrame
from app.workspace.frame import same_crs
from app.workspace.layers import list_layers

log = logging.getLogger(__name__)
router = APIRouter(prefix="/projects/{projectId}", tags=["assetmodels"])

MAX_LIST = 200
ORIGIN_STEP_M = 100.0
Z0_SPAN_M = grid.TILE * grid.RES0  # 262 144 m: one zoom-0 site tile
BBox = tuple[float, float, float, float]


class SceneCrs(BaseModel):
    epsg: int | None = None
    wkt: str | None = None


class SceneDatum(BaseModel):
    label: str = "EL"
    el_m: float = 0.0


class SceneFrame(BaseModel):
    crs: SceneCrs
    origin_crs: tuple[float, float]
    plant_north_deg: float
    datum: SceneDatum


class SceneModel(BaseModel):
    id: str
    version: int
    glb_url: str
    csv_url: str
    kind: Literal["asset", "plant"]


class SceneOrtho(BaseModel):
    id: str
    name: str
    tile_url_template: str
    bounds_site: BBox
    min_z: int
    max_z: int


class SceneCloud(BaseModel):
    id: str
    name: str
    octree_url: str
    crs_epsg: int | None
    same_crs: bool
    z_offset_m: float


class SceneDrawing(BaseModel):
    id: str
    name: str
    tile_url_template: str
    bounds_site: BBox


class SceneCount(BaseModel):
    count: int
    url: str | None


class SiteSceneOut(BaseModel):
    frame: SceneFrame | None
    model: SceneModel | None
    orthos: list[SceneOrtho]
    clouds: list[SceneCloud]
    drawings: list[SceneDrawing]
    photos: SceneCount
    findings: SceneCount


def _ready_version(s: Session, model: AssetModel) -> AssetModelVersion | None:
    q = select(AssetModelVersion).where(
        AssetModelVersion.model_id == model.id, AssetModelVersion.glb_status == "ready"
    )
    if model.current_version is not None:
        row = s.scalar(q.where(AssetModelVersion.version == model.current_version))
        if row is not None:
            return row
    return s.scalar(q.order_by(AssetModelVersion.version.desc()).limit(1))


def choose_model(s: Session, model_id: str | None) -> tuple[AssetModel, AssetModelVersion | None] | None:
    """Ruling R2: the asked-for model (404 when unknown), else the newest plant with a ready GLB."""
    if model_id is not None:
        row = s.get(AssetModel, model_id)
        if row is None:
            raise not_found("asset model", model_id)
        return row, _ready_version(s, row)
    plants = s.scalars(
        select(AssetModel)
        .where(AssetModel.kind == "plant")
        .order_by(AssetModel.created_at.desc(), AssetModel.id)
        .limit(MAX_LIST)
    )
    for row in plants:
        version = _ready_version(s, row)
        if version is not None:
            return row, version
    return None


def frame_from_site(site: object) -> SceneFrame | None:
    """A version's `spec.site` as the scene frame; None when absent or malformed (never a 500)."""
    if not isinstance(site, dict):
        return None
    try:
        crs = site.get("crs") or {}
        datum = site.get("datum") or {}
        ox, oy = site["origin_crs"]
        return SceneFrame(
            crs=SceneCrs(epsg=crs.get("epsg"), wkt=crs.get("wkt")),
            origin_crs=(float(ox), float(oy)),
            plant_north_deg=float(site["plant_north_deg"]),
            datum=SceneDatum(label=str(datum.get("label") or "EL"), el_m=float(datum.get("el_m") or 0.0)),
        )
    except (KeyError, TypeError, ValueError):
        log.warning("site scene: a model's site frame is malformed; using the map workspace frame")
        return None


def _frame_wkt(frame: SceneFrame) -> str | None:
    if frame.crs.wkt:
        return frame.crs.wkt
    if frame.crs.epsg:
        try:
            return CRS.from_epsg(int(frame.crs.epsg)).to_wkt()
        except Exception:
            return None
    return None


def _same(a: str | None, b: str | None) -> bool:
    """Ruling R5: equal only when both have a CRS and pyproj says they are the same."""
    if a is None or b is None:
        return False
    try:
        return same_crs(a, b)
    except Exception:
        return False


def _workspace_frame(ws: WorkspaceFrame, boxes: list[BBox], origin: tuple[float, float] | None) -> SceneFrame:
    if origin is None:
        minx = min(b[0] for b in boxes)
        miny = min(b[1] for b in boxes)
        maxx = max(b[2] for b in boxes)
        maxy = max(b[3] for b in boxes)
        step = ORIGIN_STEP_M
        origin = (
            float(round((minx + maxx) / 2 / step) * step) + 0.0,
            float(round((miny + maxy) / 2 / step) * step) + 0.0,
        )
    crs = SceneCrs(epsg=ws.epsg, wkt=ws.crs_wkt) if ws.kind == "crs" else SceneCrs()
    return SceneFrame(crs=crs, origin_crs=origin, plant_north_deg=0.0, datum=SceneDatum())


def min_zoom_for(bounds: BBox, max_z: int) -> int:
    """Ruling R7: the zoom where one site tile spans the footprint's longer side."""
    side = max(bounds[2] - bounds[0], bounds[3] - bounds[1], 1e-6)
    return max(0, min(int(math.floor(math.log2(Z0_SPAN_M / side))), max_z))


def _tiles(base: str, kind: str, layer_id: str, version: str, frame_key: str) -> str:
    query = urlencode({"v": version, "frame_key": frame_key})
    return f"{base}/site-tiles/{kind}/{layer_id}/{{z}}/{{x}}/{{y}}?{query}"


def build_scene(handle: ProjectHandle, model_id: str | None) -> SiteSceneOut:
    base = f"/api/v1/projects/{handle.id}"
    ws, rows = list_layers(handle)
    ws_wkt = ws.crs_wkt if ws.kind == "crs" else None
    model_out: SceneModel | None = None
    site: object = None
    with handle.session() as s:
        chosen = choose_model(s, model_id)
        if chosen is not None and chosen[1] is not None:
            row, version = chosen
            v = version.version
            model_out = SceneModel(
                id=row.id,
                version=v,
                glb_url=f"{base}/asset-models/{row.id}/versions/{v}/glb",
                csv_url=f"{base}/asset-models/{row.id}/versions/{v}/csv",
                kind="plant" if row.kind == "plant" else "asset",
            )
            site = (version.spec or {}).get("site")
        clouds = [
            (c.id, c.name, c.crs_wkt, c.epsg, list(c.bounds_native or []))
            for c in s.scalars(
                select(PointCloud)
                .where(PointCloud.status == "ready")
                .order_by(PointCloud.created_at.desc(), PointCloud.id)
                .limit(MAX_LIST)
            )
        ]
        photos = int(
            s.scalar(
                select(func.count()).select_from(Image).where(Image.lat.is_not(None), Image.lon.is_not(None))
            )
            or 0
        )
        findings = int(
            s.scalar(
                select(func.count()).select_from(Finding).where(Finding.anchor_kind.in_(("map", "cloud")))
            )
            or 0
        )

    maps = [r for r in rows if r.kind == "map" and r.in_frame and r.footprint_site and r.max_zoom is not None]
    drawings = [
        r
        for r in rows
        if r.kind == "drawing" and r.placed and r.in_frame and r.tile_kind == "drawing_raster" and r.footprint_site
    ]

    frame = frame_from_site(site)
    if frame is None:
        boxes: list[BBox] = [tuple(r.footprint_site) for r in maps + drawings]
        boxes += [(b[0], b[1], b[3], b[4]) for _, _, wkt, _, b in clouds if len(b) == 6 and _same(wkt, ws_wkt)]
        if boxes:
            frame = _workspace_frame(ws, boxes, None)
        elif model_out is not None:
            frame = _workspace_frame(ws, [], (0.0, 0.0))  # R3: a model with no site and nothing placed
    scene_wkt = _frame_wkt(frame) if frame is not None else None

    tiles_ok = frame is not None and (
        (ws.kind == "crs" and _same(ws_wkt, scene_wkt)) or (ws.kind == "local" and scene_wkt is None)
    )
    if not tiles_ok and (maps or drawings):
        log.info("site scene: %d tile layers left out (workspace frame differs)", len(maps) + len(drawings))
    orthos_out = (
        [
            SceneOrtho(
                id=r.id,
                name=r.name,
                tile_url_template=_tiles(base, "map", r.id, r.version, ws.key),
                bounds_site=tuple(r.footprint_site),
                min_z=min_zoom_for(tuple(r.footprint_site), r.max_zoom),
                max_z=r.max_zoom,
            )
            for r in maps
        ][:MAX_LIST]
        if tiles_ok
        else []
    )
    drawings_out = (
        [
            SceneDrawing(
                id=r.id,
                name=r.name,
                tile_url_template=_tiles(base, "drawing_raster", r.id, r.version, ws.key),
                bounds_site=tuple(r.footprint_site),
            )
            for r in drawings
        ][:MAX_LIST]
        if tiles_ok
        else []
    )

    cz = site.get("cloud_z_to_el") if isinstance(site, dict) else None
    clouds_out = [
        SceneCloud(
            id=cid,
            name=name,
            octree_url=f"{base}/pointclouds/{cid}/octree/metadata.json",
            crs_epsg=epsg,
            same_crs=_same(wkt, scene_wkt),
            z_offset_m=(
                float(cz["offset_m"])
                if isinstance(cz, dict) and cz.get("cloud_id") == cid and cz.get("offset_m") is not None
                else 0.0
            ),
        )
        for cid, name, wkt, epsg, _ in clouds
    ][:MAX_LIST]
    first_same = next((c for c in clouds_out if c.same_crs), None)
    return SiteSceneOut(
        frame=frame,
        model=model_out,
        orthos=orthos_out,
        clouds=clouds_out,
        drawings=drawings_out,
        photos=SceneCount(count=photos, url=f"{base}/pointclouds/{first_same.id}/cameras" if first_same else None),
        findings=SceneCount(count=findings, url=f"{base}/map-workspace/findings"),
    )


@router.get("/site-scene", response_model=SiteSceneOut)
def get_site_scene(
    modelId: str | None = Query(None, max_length=64),  # noqa: N803
    handle: ProjectHandle = Depends(get_project),
) -> SiteSceneOut:
    return build_scene(handle, modelId)
```

Notes for the implementer:
- `test_lists_are_capped` patches `site_scene.MAX_LIST`. The cloud query's `.limit(MAX_LIST)` reads the module global at call time, so the patch applies.
- If T1 found `photos.url` non-nullable, change `url: str | None` to `url: str` and the `None` to `""` (and the first test's expectation to `""`).

- [ ] **Step 4: Route it and delete the stub**

In `backend/app/api.py`, in the maps-guarded tuple (it already lists `"app.workspace.router",`), insert one line above `"app.workspace.router",`:
```python
    "app.asset_models.site_scene",  # plant model S1: the Site 3D manifest (needs the workspace frame)
```
In `backend/app/asset_models/stubs_plant.py`, delete the one tuple whose operationId is `"getSiteScene"`, and nothing else.

- [ ] **Step 5: Run the tests to verify they pass**

Run:
```
cd backend
E:\Dev\Yolo\app\backend\.venv\Scripts\python.exe -m pytest tests/test_site_scene.py -q
E:\Dev\Yolo\app\backend\.venv\Scripts\python.exe -m pytest tests/test_contract.py -q
E:\Dev\Yolo\app\backend\.venv\Scripts\python.exe -m ruff check app/asset_models/site_scene.py tests/test_site_scene.py app/api.py
E:\Dev\Yolo\app\backend\.venv\Scripts\python.exe -m ruff format app/asset_models/site_scene.py tests/test_site_scene.py
cd ..
```
Expected: all `test_site_scene.py` tests PASS; `test_contract.py` PASS. Contract conformance now validates the real `getSiteScene` against the schema. A schema mismatch means a field name or nullability differs from F0; align the pydantic model to the contract, never the contract to the code. Ruff is clean.

- [ ] **Step 6: Commit**

```
git add backend/app/asset_models/site_scene.py backend/tests/test_site_scene.py backend/app/api.py backend/app/asset_models/stubs_plant.py
git commit -m "feat(backend): site scene manifest for the Site 3D view" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: `siteTransform.ts` pinned to the golden vectors

**Files:**
- Create: `frontend/src/site3d/engine/siteTransform.ts`
- Test: `frontend/src/site3d/engine/siteTransform.test.ts`

**Interfaces:**
- Consumes: `contract/fixtures/plant-grid-vectors.json` (F0).
- Produces: `SiteFrameT`, `plantToSite`, `siteToPlant`, `plantToScene`, `siteToScene`, `sceneToSite` (binding names).

- [ ] **Step 1: Write the failing test**

`frontend/src/site3d/engine/siteTransform.test.ts`:
```ts
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  plantToScene,
  plantToSite,
  sceneToSite,
  siteToPlant,
  siteToScene,
  type SiteFrameT,
} from "./siteTransform";

/** F0's golden vectors (index "Golden vectors"); siteframe.py reads the same file. */
interface Vectors {
  frame: {
    crs: { epsg: number | null; wkt?: string | null };
    origin_crs: [number, number];
    plant_north_deg: number;
    datum?: { label: string; el_m: number };
  };
  rows: { plant_E: number; plant_N: number; site_X: number; site_Y: number }[];
}

const V = JSON.parse(
  readFileSync(resolve(__dirname, "../../../../contract/fixtures/plant-grid-vectors.json"), "utf8"),
) as Vectors;

const FRAME: SiteFrameT = {
  crs: { epsg: V.frame.crs.epsg ?? null, wkt: V.frame.crs.wkt ?? null },
  origin_crs: V.frame.origin_crs,
  plant_north_deg: V.frame.plant_north_deg,
  datum: V.frame.datum ?? { label: "HPFS", el_m: 100 },
};

describe("siteTransform (pinned to contract/fixtures/plant-grid-vectors.json)", () => {
  it("has at least 50 golden rows", () => {
    expect(V.rows.length).toBeGreaterThanOrEqual(50);
  });

  it("plant -> site reproduces the register within 0.05 m", () => {
    for (const r of V.rows) {
      const [x, y] = plantToSite(FRAME, r.plant_E, r.plant_N);
      expect(Math.abs(x - r.site_X)).toBeLessThan(0.05);
      expect(Math.abs(y - r.site_Y)).toBeLessThan(0.05);
    }
  });

  it("site -> plant inverts plant -> site", () => {
    for (const r of V.rows) {
      const [e, n] = siteToPlant(FRAME, ...plantToSite(FRAME, r.plant_E, r.plant_N));
      expect(e).toBeCloseTo(r.plant_E, 6);
      expect(n).toBeCloseTo(r.plant_N, 6);
    }
  });

  it("scene is x = N, y = EL - datum, z = E", () => {
    expect(plantToScene(FRAME, 1300, 450, 141)).toEqual([450, 141 - FRAME.datum.el_m, 1300]);
  });

  it("site -> scene -> site round-trips", () => {
    const r = V.rows[0];
    const s = siteToScene(FRAME, r.site_X, r.site_Y, 112.5);
    const [x, y, z] = sceneToSite(FRAME, ...s);
    expect(x).toBeCloseTo(r.site_X, 6);
    expect(y).toBeCloseTo(r.site_Y, 6);
    expect(z).toBeCloseTo(112.5, 9);
  });

  it("a frame rotated 90° puts plant north on site east", () => {
    const f: SiteFrameT = { ...FRAME, origin_crs: [1000, 2000], plant_north_deg: 90 };
    const [x, y] = plantToSite(f, 0, 10);
    expect(x).toBeCloseTo(1010, 9);
    expect(y).toBeCloseTo(2000, 9);
  });
});
```
If T1 found different top-level keys, change only the `Vectors` interface and the `FRAME`/`rows` reads.

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm -C frontend exec vitest run src/site3d/engine/siteTransform.test.ts`
Expected: FAIL, `Failed to resolve import "./siteTransform"`.

- [ ] **Step 3: Implement**

`frontend/src/site3d/engine/siteTransform.ts`:
```ts
/**
 * The plant grid <-> site CRS <-> scene transform, the TypeScript mirror of
 * backend/app/asset_models/siteframe.py (spec 2026-10-03 §5, §11; index Global Constraints):
 *   [X, Y] = origin_crs + R(θ)·[E, N],  R(θ) = [[cos θ, sin θ], [−sin θ, cos θ]]  (θ = plant_north_deg)
 *   scene: x = plant N, y = EL − datum.el_m, z = plant E  (Y up, X plant north, Z plant east)
 * Both sides are pinned on contract/fixtures/plant-grid-vectors.json.
 */
export interface SiteFrameT {
  crs: { epsg: number | null; wkt: string | null };
  origin_crs: [number, number];
  plant_north_deg: number;
  datum: { label: string; el_m: number };
}

function rot(f: SiteFrameT): [number, number] {
  const t = (f.plant_north_deg * Math.PI) / 180;
  return [Math.cos(t), Math.sin(t)];
}

export function plantToSite(f: SiteFrameT, e: number, n: number): [number, number] {
  const [c, s] = rot(f);
  return [f.origin_crs[0] + c * e + s * n, f.origin_crs[1] - s * e + c * n];
}

export function siteToPlant(f: SiteFrameT, x: number, y: number): [number, number] {
  const [c, s] = rot(f);
  const dx = x - f.origin_crs[0];
  const dy = y - f.origin_crs[1];
  return [c * dx - s * dy, s * dx + c * dy];
}

export function plantToScene(f: SiteFrameT, e: number, n: number, el: number): [number, number, number] {
  return [n, el - f.datum.el_m, e];
}

/** `z` is a plant elevation (EL), in metres. */
export function siteToScene(f: SiteFrameT, x: number, y: number, z: number): [number, number, number] {
  const [e, n] = siteToPlant(f, x, y);
  return plantToScene(f, e, n, z);
}

export function sceneToSite(f: SiteFrameT, sx: number, sy: number, sz: number): [number, number, number] {
  const [x, y] = plantToSite(f, sz, sx);
  return [x, y, sy + f.datum.el_m];
}
```

- [ ] **Step 4: Run it to verify it passes**

Run: `pnpm -C frontend exec vitest run src/site3d/engine/siteTransform.test.ts`
Expected: 6 tests PASS.

- [ ] **Step 5: Commit**

```
pnpm -C frontend exec prettier --write src/site3d/engine/siteTransform.ts src/site3d/engine/siteTransform.test.ts
git add frontend/src/site3d/engine/siteTransform.ts frontend/src/site3d/engine/siteTransform.test.ts
git commit -m "feat(site3d): plant grid transform pinned to the golden vectors" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: `api/siteScene.ts` and the scene fixtures

**Files:**
- Create: `frontend/src/api/siteScene.ts`
- Create: `frontend/src/test/siteSceneFixtures.ts`
- Test: `frontend/src/api/siteScene.test.ts`

**Interfaces:**
- Consumes: `Schemas["SiteScene"]`, `Schemas["AssetItemPage"]`, `Schemas["AssetItemRow"]`, `Schemas["AssetItem"]`, `paths` (F0); `useApi`, `unwrap`, `useOnJobsFinished`; `SiteFrameT` (T3).
- Produces: the binding `useSiteScene`, `useAssetItems`, `getAssetItem`, plus `getSiteScene`, `listAssetItems`, `absUrl`, `toFrameT`, and the types `SiteScene`, `SceneOrtho`, `SceneDrawing`, `SceneCloud`, `ItemFilters`. The fixtures `EMPTY_SCENE`, `FRAME_ONLY_SCENE`, `MODEL_SCENE`, `TILE_SCENE`, `TEST_FRAME` are for T9 and S2/S3 tests.

- [ ] **Step 1: Write the fixtures**

`frontend/src/test/siteSceneFixtures.ts`:
```ts
import type { SiteScene } from "@/api/siteScene";

export const SCENE_PROJECT = "p1";
export const SCENE_MODEL = "m1";

export const TEST_FRAME: NonNullable<SiteScene["frame"]> = {
  crs: { epsg: 32639, wkt: null },
  origin_crs: [244338.089, 3179515.69],
  plant_north_deg: 17.9991,
  datum: { label: "HPFS", el_m: 100 },
};

/** Nothing placed, no model: the view has no frame (Review Focus 1, "no frame"). */
export const EMPTY_SCENE: SiteScene = {
  frame: null,
  model: null,
  orthos: [],
  clouds: [],
  drawings: [],
  photos: { count: 0, url: null },
  findings: { count: 0, url: `/api/v1/projects/${SCENE_PROJECT}/map-workspace/findings` },
};

/** A frame (from the map workspace) but no plant model yet (Review Focus 1, "no model"). */
export const FRAME_ONLY_SCENE: SiteScene = { ...EMPTY_SCENE, frame: TEST_FRAME };

export const MODEL_SCENE: SiteScene = {
  ...FRAME_ONLY_SCENE,
  model: {
    id: SCENE_MODEL,
    version: 1,
    glb_url: `/api/v1/projects/${SCENE_PROJECT}/asset-models/${SCENE_MODEL}/versions/1/glb`,
    csv_url: `/api/v1/projects/${SCENE_PROJECT}/asset-models/${SCENE_MODEL}/versions/1/csv`,
    kind: "plant",
  },
  clouds: [
    {
      id: "c1",
      name: "Site scan",
      octree_url: `/api/v1/projects/${SCENE_PROJECT}/pointclouds/c1/octree/metadata.json`,
      crs_epsg: 32639,
      same_crs: true,
      z_offset_m: 120.45,
    },
  ],
  photos: { count: 36, url: `/api/v1/projects/${SCENE_PROJECT}/pointclouds/c1/cameras` },
  findings: { count: 3, url: `/api/v1/projects/${SCENE_PROJECT}/map-workspace/findings` },
};

export const TILE_SCENE: SiteScene = {
  ...MODEL_SCENE,
  orthos: [
    {
      id: "o1",
      name: "Site ortho",
      tile_url_template: `/api/v1/projects/${SCENE_PROJECT}/site-tiles/map/o1/{z}/{x}/{y}?v=o1&frame_key=epsg%3A32639`,
      bounds_site: [244000, 3179000, 246000, 3181000],
      min_z: 7,
      max_z: 17,
    },
  ],
  drawings: [
    {
      id: "d1",
      name: "Plot plan T0006",
      tile_url_template: `/api/v1/projects/${SCENE_PROJECT}/site-tiles/drawing_raster/d1/{z}/{x}/{y}?v=3&frame_key=epsg%3A32639`,
      bounds_site: [245000, 3179200, 246200, 3180400],
    },
  ],
};
```

- [ ] **Step 2: Write the failing test**

`frontend/src/api/siteScene.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { fakeClient } from "@/test/fixtures";
import { TestApiProvider } from "@/test/render";
import { EMPTY_SCENE, MODEL_SCENE, TEST_FRAME } from "@/test/siteSceneFixtures";
import { absUrl, getSiteScene, listAssetItems, toFrameT, useAssetItems, useSiteScene } from "./siteScene";

const row = (id: string) => ({ id, tag: null, name: id, type: "other", area: null });

describe("siteScene api", () => {
  it("asks for the scene with and without a model id", async () => {
    const { api, requests } = fakeClient([{ method: "GET", path: /\/site-scene/, body: MODEL_SCENE }]);
    expect(await getSiteScene(api, "p1")).toEqual(MODEL_SCENE);
    await getSiteScene(api, "p1", "m1");
    expect(requests[0].url).toBe("/api/v1/projects/p1/site-scene");
    expect(requests[1].url).toBe("/api/v1/projects/p1/site-scene?modelId=m1");
  });

  it("absUrl adds the base and the token to a server-relative path", () => {
    const info = { baseUrl: "http://127.0.0.1:8000/", token: "a b" };
    expect(absUrl(info, "/api/v1/x/glb")).toBe("http://127.0.0.1:8000/api/v1/x/glb?token=a%20b");
    expect(absUrl(info, "/api/v1/t/{z}/{x}/{y}?v=1")).toBe("http://127.0.0.1:8000/api/v1/t/{z}/{x}/{y}?v=1&token=a%20b");
  });

  it("toFrameT copies the frame and keeps null", () => {
    expect(toFrameT(null)).toBeNull();
    expect(toFrameT(TEST_FRAME)).toEqual({
      crs: { epsg: 32639, wkt: null },
      origin_crs: [244338.089, 3179515.69],
      plant_north_deg: 17.9991,
      datum: { label: "HPFS", el_m: 100 },
    });
  });

  it("useSiteScene loads, reports an error and keeps the last scene", async () => {
    let fail = false;
    const { api } = fakeClient([
      {
        method: "GET",
        path: /\/site-scene/,
        status: () => (fail ? 500 : 200),
        body: () => (fail ? { error: { code: "boom", message: "it broke", details: {} } } : EMPTY_SCENE),
      },
    ]);
    const wrapper = ({ children }: { children: ReactNode }) => <TestApiProvider api={api}>{children}</TestApiProvider>;
    const { result } = renderHook(() => useSiteScene("p1"), { wrapper });
    expect(result.current.loading).toBe(true);
    await waitFor(() => expect(result.current.scene).toEqual(EMPTY_SCENE));
    fail = true;
    act(() => result.current.reload());
    await waitFor(() => expect(result.current.error).toBe("it broke"));
    expect(result.current.scene).toEqual(EMPTY_SCENE);
  });

  it("useAssetItems pages with the cursor", async () => {
    const { api, requests } = fakeClient([
      {
        method: "GET",
        path: /\/items/,
        body: (req) =>
          req.url.includes("cursor=c2")
            ? { items: [row("b")], next_cursor: null }
            : { items: [row("a")], next_cursor: "c2" },
      },
    ]);
    const wrapper = ({ children }: { children: ReactNode }) => <TestApiProvider api={api}>{children}</TestApiProvider>;
    const { result } = renderHook(() => useAssetItems("p1", "m1", 2, { q: "tank" }), { wrapper });
    await waitFor(() => expect(result.current.items?.map((i) => i.id)).toEqual(["a"]));
    expect(result.current.hasMore).toBe(true);
    act(() => result.current.loadMore());
    await waitFor(() => expect(result.current.items?.map((i) => i.id)).toEqual(["a", "b"]));
    expect(result.current.hasMore).toBe(false);
    expect(requests[0].url).toBe("/api/v1/projects/p1/asset-models/m1/versions/2/items?q=tank");
  });

  it("listAssetItems sends the filters", async () => {
    const { api, requests } = fakeClient([{ method: "GET", path: /\/items/, body: { items: [], next_cursor: null } }]);
    await listAssetItems(api, "p1", "m1", 1, { type: "tank_lng", limit: 50 }, "x");
    expect(requests[0].url).toBe("/api/v1/projects/p1/asset-models/m1/versions/1/items?type=tank_lng&limit=50&cursor=x");
  });
});
```
The `row(...)` objects are partial `AssetItemRow`s. If the generated type demands more fields, the fake client does not check: keep them partial.

- [ ] **Step 3: Run it to verify it fails**

Run: `pnpm -C frontend exec vitest run src/api/siteScene.test.ts`
Expected: FAIL, `Failed to resolve import "./siteScene"`.

- [ ] **Step 4: Implement**

`frontend/src/api/siteScene.ts`:
```ts
import { useCallback, useEffect, useRef, useState } from "react";
import type { ApiClient, paths, Schemas } from "@contract/client";
import { useOnJobsFinished } from "@/jobs/useOnJobsFinished";
import type { SiteFrameT } from "@/site3d/engine/siteTransform";
import { useApi } from "./client";
import { unwrap } from "./errors";

export type SiteScene = Schemas["SiteScene"];
export type SceneOrtho = SiteScene["orthos"][number];
export type SceneDrawing = SiteScene["drawings"][number];
export type SceneCloud = SiteScene["clouds"][number];
export type AssetItemPage = Schemas["AssetItemPage"];
export type AssetItemRow = Schemas["AssetItemRow"];
export type AssetItem = Schemas["AssetItem"];

const SCENE = "/api/v1/projects/{projectId}/site-scene" as const;
const ITEMS = "/api/v1/projects/{projectId}/asset-models/{assetModelId}/versions/{version}/items" as const;
const ITEM = `${ITEMS}/{itemId}` as const;
type ItemsQuery = NonNullable<paths[typeof ITEMS]["get"]["parameters"]["query"]>;
export type ItemFilters = Omit<ItemsQuery, "cursor">;

const message = (e: unknown) => (e instanceof Error ? e.message : String(e));

/** Plan ruling R1: the manifest's URLs are server-relative and token-free; this makes one fetchable. */
export function absUrl(info: { baseUrl: string; token: string }, rel: string): string {
  const base = info.baseUrl.replace(/\/$/, "");
  const sep = rel.includes("?") ? "&" : "?";
  return `${base}${rel}${sep}token=${encodeURIComponent(info.token)}`;
}

export function toFrameT(f: SiteScene["frame"]): SiteFrameT | null {
  if (!f) return null;
  return {
    crs: { epsg: f.crs.epsg ?? null, wkt: f.crs.wkt ?? null },
    origin_crs: [f.origin_crs[0], f.origin_crs[1]],
    plant_north_deg: f.plant_north_deg,
    datum: { label: f.datum.label, el_m: f.datum.el_m },
  };
}

export async function getSiteScene(api: ApiClient, projectId: string, modelId?: string | null): Promise<SiteScene> {
  return unwrap(
    api.GET(SCENE, { params: { path: { projectId }, query: modelId ? { modelId } : undefined } }),
  );
}

export async function listAssetItems(
  api: ApiClient,
  projectId: string,
  assetModelId: string,
  version: number,
  filters: ItemFilters = {},
  cursor?: string | null,
): Promise<AssetItemPage> {
  const query: ItemsQuery = { ...filters, ...(cursor ? { cursor } : {}) };
  return unwrap(api.GET(ITEMS, { params: { path: { projectId, assetModelId, version }, query } }));
}

export async function getAssetItem(
  api: ApiClient,
  projectId: string,
  assetModelId: string,
  version: number,
  itemId: string,
): Promise<AssetItem> {
  return unwrap(api.GET(ITEM, { params: { path: { projectId, assetModelId, version, itemId } } }));
}

/** The Site 3D manifest; reloads when a GLB build finishes (a new version may be the one shown). */
export function useSiteScene(projectId: string, modelId?: string | null) {
  const api = useApi();
  const key = `${projectId}/${modelId ?? ""}`;
  const [loaded, setLoaded] = useState<{ key: string; scene: SiteScene | null; error: string | null } | null>(
    null,
  );
  const reload = useCallback(() => {
    void getSiteScene(api, projectId, modelId).then(
      (scene) => setLoaded({ key, scene, error: null }),
      (e: unknown) =>
        setLoaded((prev) => ({ key, scene: prev?.key === key ? prev.scene : null, error: message(e) })),
    );
  }, [api, projectId, modelId, key]);
  useEffect(reload, [reload]);
  useOnJobsFinished("asset_model_glb", reload);
  const current = loaded?.key === key ? loaded : null;
  return { scene: current?.scene ?? null, error: current?.error ?? null, loading: current === null, reload };
}

/** The register rows of one version, ≤ 500 per page (index Global Constraints), appended by cursor. */
export function useAssetItems(
  projectId: string,
  modelId: string | null,
  version: number | null,
  filters: ItemFilters = {},
) {
  const api = useApi();
  const key = JSON.stringify([projectId, modelId, version, filters]);
  const busy = useRef(false);
  const [state, setState] = useState<{
    key: string;
    items: AssetItemRow[];
    next: string | null;
    error: string | null;
  } | null>(null);
  const fetchPage = useCallback(
    (cursor: string | null) => {
      const [pid, mid, ver, f] = JSON.parse(key) as [string, string | null, number | null, ItemFilters];
      if (!mid || ver == null || busy.current) return;
      busy.current = true;
      void listAssetItems(api, pid, mid, ver, f, cursor)
        .then(
          (page) =>
            setState((prev) => ({
              key,
              items: cursor && prev?.key === key ? [...prev.items, ...page.items] : page.items,
              next: page.next_cursor ?? null,
              error: null,
            })),
          (e: unknown) =>
            setState((prev) => ({
              key,
              items: prev?.key === key ? prev.items : [],
              next: prev?.key === key ? prev.next : null,
              error: message(e),
            })),
        )
        .finally(() => {
          busy.current = false;
        });
    },
    [api, key],
  );
  useEffect(() => fetchPage(null), [fetchPage]);
  const current = state?.key === key ? state : null;
  return {
    items: current ? current.items : null,
    error: current?.error ?? null,
    hasMore: Boolean(current?.next),
    loadMore: () => {
      if (current?.next) fetchPage(current.next);
    },
    reload: () => fetchPage(null),
  };
}
```

- [ ] **Step 5: Run it to verify it passes**

Run: `pnpm -C frontend exec vitest run src/api/siteScene.test.ts`
Expected: 6 tests PASS. If TypeScript rejects a query key (for example, F0 typed `flag` as an enum), the test's literal still type-checks because `ItemFilters` is derived from the contract.

- [ ] **Step 6: Commit**

```
pnpm -C frontend exec prettier --write src/api/siteScene.ts src/api/siteScene.test.ts src/test/siteSceneFixtures.ts
git add frontend/src/api/siteScene.ts frontend/src/api/siteScene.test.ts frontend/src/test/siteSceneFixtures.ts
git commit -m "feat(frontend): site scene and asset item api hooks" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: `engine/tiles.ts`: quadtree, tile quads and the shared tile cache

**Files:**
- Create: `frontend/src/site3d/engine/tiles.ts`
- Test: `frontend/src/site3d/engine/tiles.test.ts`

**Interfaces:**
- Consumes: `siteRes`, `tileBounds`, `SiteTile`, `SiteExtent` (`@/mapws/view/siteGrid`); `siteToPlant`, `SiteFrameT` (T3).
- Produces (used by T6, T7):
  ```ts
  export const MAX_LIVE_TILES = 256, TILE_BYTES = 262144, MAX_TILE_BYTES = 67108864, MAX_IN_FLIGHT = 6, MAX_ROOTS = 16, REFINE_FACTOR = 1.5, Z0_SPAN_M = 262144;
  export interface TileView { pixelAngle: number; distanceTo(t: SiteTile): number }
  export function rootTiles(b: SiteExtent, z: number): SiteTile[]
  export function childTiles(t: SiteTile, b: SiteExtent): SiteTile[]
  export function parentTile(t: SiteTile): SiteTile | null
  export function tileKey(t: SiteTile): string
  export function fillTemplate(template: string, t: SiteTile): string
  export function minZoomFor(b: SiteExtent, maxZ: number): number
  export function selectTiles(b: SiteExtent, minZ: number, maxZ: number, view: TileView, cap?: number): SiteTile[]
  export function tileView(f: SiteFrameT, cam: { x: number; y: number; z: number }, fovDeg: number, viewportPx: number, sceneY: number): TileView
  export function tileQuad(f: SiteFrameT, t: SiteTile, sceneY: number): { positions: Float32Array; uvs: Float32Array }
  export interface TileImage { width: number; height: number; close?(): void }
  export type TileFetch = (url: string, signal: AbortSignal) => Promise<TileImage | null>;
  export class GoneError extends Error {}
  export function fetchSiteTile(url: string, signal: AbortSignal): Promise<TileImage | null>
  export function makeTexture(image: TileImage): THREE.Texture
  export class TileCache { constructor(fetchTile: TileFetch, onChange: () => void, capacity?: number, maxInFlight?: number); readonly capacity: number; beginFrame(): void; want(url: string, onGone?: () => void): THREE.Texture | null; peek(url: string): THREE.Texture | null; live(): number; bytes(): number; endFrame(): void; dispose(): void }
  ```

- [ ] **Step 1: Write the failing test**

`frontend/src/site3d/engine/tiles.test.ts`:
```ts
import { describe, expect, it, vi } from "vitest";
import { tileBounds, type SiteExtent } from "@/mapws/view/siteGrid";
import type { SiteFrameT } from "./siteTransform";
import {
  GoneError,
  MAX_TILE_BYTES,
  TILE_BYTES,
  TileCache,
  childTiles,
  fillTemplate,
  minZoomFor,
  parentTile,
  rootTiles,
  selectTiles,
  tileQuad,
  tileView,
  type TileImage,
} from "./tiles";

const FRAME: SiteFrameT = {
  crs: { epsg: 32639, wkt: null },
  origin_crs: [500000, 3300000],
  plant_north_deg: 0,
  datum: { label: "EL", el_m: 0 },
};
const B: SiteExtent = [499500, 3299500, 500500, 3300500]; // 1 km around the origin
const inside = (t: { z: number; x: number; y: number }) => {
  const [a, b, c, d] = tileBounds(t);
  return a < B[2] && c > B[0] && b < B[3] && d > B[1];
};
const flush = () => new Promise((r) => setTimeout(r, 0));

describe("tile quadtree", () => {
  it("root tiles cover the bounds at a zoom", () => {
    const roots = rootTiles(B, 8); // span 1024 m
    expect(roots.length).toBeGreaterThan(0);
    expect(roots.length).toBeLessThanOrEqual(4);
    roots.forEach((t) => expect(inside(t)).toBe(true));
  });

  it("children stay inside the bounds and the parent inverts them", () => {
    for (const k of childTiles({ z: 8, x: 488, y: -12891 }, B)) {
      expect(k.z).toBe(9);
      expect(inside(k)).toBe(true);
      expect(parentTile(k)).toEqual({ z: 8, x: 488, y: -12891 });
    }
    expect(parentTile({ z: 0, x: 1, y: -13 })).toBeNull();
  });

  it("minZoomFor mirrors the backend rule (R7)", () => {
    expect(minZoomFor([0, 0, 120, 60], 17)).toBe(11);
    expect(minZoomFor([0, 0, 3000, 1000], 18)).toBe(6);
    expect(minZoomFor([0, 0, 0.01, 0.01], 12)).toBe(12);
  });

  it("fills a template", () => {
    expect(fillTemplate("/t/{z}/{x}/{y}?v=1", { z: 3, x: -2, y: 7 })).toBe("/t/3/-2/7?v=1");
  });

  it("a far camera keeps the coarse tiles", () => {
    const view = tileView(FRAME, { x: 0, y: 100_000, z: 0 }, 45, 1000, 0);
    const tiles = selectTiles(B, 8, 18, view);
    expect(tiles.every((t) => t.z === 8)).toBe(true);
  });

  it("a near camera refines towards the max zoom, inside the bounds", () => {
    const view = tileView(FRAME, { x: 0, y: 30, z: 0 }, 45, 1000, 0);
    const tiles = selectTiles(B, 8, 18, view);
    expect(Math.max(...tiles.map((t) => t.z))).toBeGreaterThan(12);
    expect(tiles.every((t) => t.z <= 18 && inside(t))).toBe(true);
    expect(tiles.length).toBeLessThanOrEqual(256);
  });

  it("never selects more than the cap (Review Focus 4)", () => {
    const big: SiteExtent = [497000, 3297000, 503000, 3303000];
    const view = tileView(FRAME, { x: 0, y: 2, z: 0 }, 45, 2000, 0);
    expect(selectTiles(big, 6, 20, view, 256).length).toBeLessThanOrEqual(256);
    expect(selectTiles(big, 6, 20, view, 10).length).toBeLessThanOrEqual(10);
  });

  it("budget constants: 256 tiles of 256 KB are 64 MiB", () => {
    expect(TILE_BYTES * 256).toBe(MAX_TILE_BYTES);
    expect(MAX_TILE_BYTES).toBe(64 * 1024 * 1024);
  });
});

describe("tileQuad", () => {
  it("maps the north-west corner to uv (0, 0) in scene x = N, z = E", () => {
    // z 10: span 256 m; the tile holding the origin is x 1953, y -12891 (minx 499968, maxy 3300096)
    const q = tileQuad(FRAME, { z: 10, x: 1953, y: -12891 }, 0.5);
    expect(Array.from(q.positions.slice(0, 3))).toEqual([96, 0.5, -32]);
    expect(Array.from(q.uvs)).toEqual([0, 0, 1, 0, 1, 1, 0, 1]);
    // south-east corner: (500224, 3299840) -> E 224, N -160
    expect(Array.from(q.positions.slice(6, 9))).toEqual([-160, 0.5, 224]);
  });

  it("rotates with plant north", () => {
    const f = { ...FRAME, plant_north_deg: 90 };
    const q = tileQuad(f, { z: 10, x: 1953, y: -12891 }, 0);
    // NW corner (−32 E, 96 N in site terms): with θ = 90°, E = −dy = −96, N = dx = −32
    expect(q.positions[0]).toBeCloseTo(-32, 6);
    expect(q.positions[2]).toBeCloseTo(-96, 6);
  });
});

describe("TileCache", () => {
  const img = (): TileImage => ({ width: 256, height: 256, close: vi.fn() });

  it("loads a tile, then serves its texture", async () => {
    const onChange = vi.fn();
    const cache = new TileCache(async () => img(), onChange);
    cache.beginFrame();
    expect(cache.want("a")).toBeNull();
    cache.endFrame();
    await flush();
    cache.beginFrame();
    expect(cache.want("a")).not.toBeNull();
    expect(cache.peek("a")).not.toBeNull();
    expect(onChange).toHaveBeenCalled();
    expect(cache.bytes()).toBe(TILE_BYTES);
  });

  it("an empty (204) tile holds no texture and no capacity", async () => {
    const cache = new TileCache(async () => null, () => {}, 1);
    cache.beginFrame();
    cache.want("a");
    await flush();
    cache.want("b");
    expect(cache.live()).toBe(1);
    await flush();
    expect(cache.peek("a")).toBeNull();
  });

  it("cache never holds more than its capacity: it evicts what this frame did not want", async () => {
    const images: TileImage[] = [];
    const cache = new TileCache(
      async () => {
        const i = img();
        images.push(i);
        return i;
      },
      () => {},
      2,
    );
    cache.beginFrame();
    cache.want("a");
    cache.want("b");
    cache.endFrame();
    await flush();
    cache.beginFrame();
    cache.want("a");
    expect(cache.want("c")).toBeNull(); // b, unwanted this frame, is evicted for c
    expect(cache.live()).toBe(2);
    expect(cache.peek("b")).toBeNull();
    expect(images[1].close).toHaveBeenCalled();
    expect(cache.want("d")).toBeNull(); // full of wanted tiles: refused, nothing evicted
    expect(cache.live()).toBe(2);
  });

  it("limits fetches in flight", () => {
    const fetchTile = vi.fn(() => new Promise<TileImage | null>(() => {}));
    const cache = new TileCache(fetchTile, () => {}, 256, 6);
    cache.beginFrame();
    for (let i = 0; i < 10; i++) cache.want(`t${i}`);
    expect(fetchTile).toHaveBeenCalledTimes(6);
  });

  it("a gone layer (404/410) calls back once the fetch fails", async () => {
    const onGone = vi.fn();
    const cache = new TileCache(async (u) => Promise.reject(new GoneError(u)), () => {});
    cache.beginFrame();
    cache.want("a", onGone);
    await flush();
    expect(onGone).toHaveBeenCalledTimes(1);
  });

  it("dispose aborts what is in flight", () => {
    const signals: AbortSignal[] = []; // an array, so TypeScript does not narrow a `let` to null
    const cache = new TileCache(
      (_u, s) => {
        signals.push(s);
        return new Promise(() => {});
      },
      () => {},
    );
    cache.beginFrame();
    cache.want("a");
    cache.dispose();
    expect(signals[0].aborted).toBe(true);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm -C frontend exec vitest run src/site3d/engine/tiles.test.ts`
Expected: FAIL, `Failed to resolve import "./tiles"`.

- [ ] **Step 3: Implement**

`frontend/src/site3d/engine/tiles.ts`:
```ts
import * as THREE from "three";
import { siteRes, tileBounds, type SiteExtent, type SiteTile } from "@/mapws/view/siteGrid";
import { siteToPlant, type SiteFrameT } from "./siteTransform";

/**
 * Site tiles draped in 3D (spec 2026-10-03 §11; plan S1 rulings R7, R9). The site tile grid is
 * mapws/view/siteGrid.ts; this module picks which tiles a camera needs (a screen-space-error quadtree),
 * places each as a quad in the scene, and keeps their textures in one cache shared by every drape layer:
 * ≤ 256 live tiles of 256 × 256 RGBA without mipmaps, so ≤ 64 MiB (index Global Constraints).
 */
export const MAX_LIVE_TILES = 256;
export const TILE_BYTES = 256 * 256 * 4;
export const MAX_TILE_BYTES = MAX_LIVE_TILES * TILE_BYTES;
export const MAX_IN_FLIGHT = 6;
export const MAX_ROOTS = 16;
/** Refine while one texel covers more than this many screen pixels. */
export const REFINE_FACTOR = 1.5;
export const Z0_SPAN_M = 256 * 1024;

export interface TileView {
  /** Radians per screen pixel. */
  pixelAngle: number;
  /** Metres from the camera to the nearest part of the tile, in the scene. */
  distanceTo(t: SiteTile): number;
}

export function tileKey(t: SiteTile): string {
  return `${t.z}/${t.x}/${t.y}`;
}

export function fillTemplate(template: string, t: SiteTile): string {
  return template.replace("{z}", String(t.z)).replace("{x}", String(t.x)).replace("{y}", String(t.y));
}

const intersects = (a: SiteExtent, b: SiteExtent) => a[0] < b[2] && a[2] > b[0] && a[1] < b[3] && a[3] > b[1];

export function rootTiles(b: SiteExtent, z: number): SiteTile[] {
  const s = 256 * siteRes(z);
  const x0 = Math.floor(b[0] / s);
  const x1 = Math.max(x0, Math.ceil(b[2] / s) - 1);
  const y0 = Math.floor(-b[3] / s);
  const y1 = Math.max(y0, Math.ceil(-b[1] / s) - 1);
  const out: SiteTile[] = [];
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) out.push({ z, x: x + 0, y: y + 0 });
  return out;
}

export function childTiles(t: SiteTile, b: SiteExtent): SiteTile[] {
  const out: SiteTile[] = [];
  for (let dy = 0; dy < 2; dy++)
    for (let dx = 0; dx < 2; dx++) {
      const k = { z: t.z + 1, x: t.x * 2 + dx, y: t.y * 2 + dy };
      if (intersects(tileBounds(k), b)) out.push(k);
    }
  return out;
}

export function parentTile(t: SiteTile): SiteTile | null {
  return t.z === 0 ? null : { z: t.z - 1, x: Math.floor(t.x / 2), y: Math.floor(t.y / 2) };
}

/** Plan ruling R7 (mirrors site_scene.min_zoom_for): the zoom where one tile spans the longer side. */
export function minZoomFor(b: SiteExtent, maxZ: number): number {
  const side = Math.max(b[2] - b[0], b[3] - b[1], 1e-6);
  return Math.max(0, Math.min(Math.floor(Math.log2(Z0_SPAN_M / side)), maxZ));
}

/**
 * The leaves to draw: start from ≤ MAX_ROOTS tiles at `minZ` (coarser when the bounds need more), then
 * split the leaf with the largest screen-space error until every leaf is sharp enough, reaches `maxZ`,
 * or one more split would pass `cap`.
 */
export function selectTiles(
  b: SiteExtent,
  minZ: number,
  maxZ: number,
  view: TileView,
  cap = MAX_LIVE_TILES,
): SiteTile[] {
  let z0 = Math.max(0, Math.min(minZ, maxZ));
  let leaves = rootTiles(b, z0);
  while (leaves.length > MAX_ROOTS && z0 > 0) {
    z0 -= 1;
    leaves = rootTiles(b, z0);
  }
  if (leaves.length > cap) return leaves.slice(0, cap);
  const err = (t: SiteTile) => siteRes(t.z) / (view.distanceTo(t) * view.pixelAngle);
  let errs = leaves.map(err);
  for (;;) {
    let best = -1;
    let bestErr = REFINE_FACTOR;
    for (let i = 0; i < leaves.length; i++) {
      if (leaves[i].z >= maxZ) continue;
      if (errs[i] > bestErr) {
        bestErr = errs[i];
        best = i;
      }
    }
    if (best < 0) return leaves;
    const kids = childTiles(leaves[best], b);
    if (leaves.length - 1 + kids.length > cap) return leaves;
    leaves = [...leaves.slice(0, best), ...kids, ...leaves.slice(best + 1)];
    errs = [...errs.slice(0, best), ...kids.map(err), ...errs.slice(best + 1)];
  }
}

export function tileView(
  f: SiteFrameT,
  cam: { x: number; y: number; z: number },
  fovDeg: number,
  viewportPx: number,
  sceneY: number,
): TileView {
  return {
    pixelAngle: ((fovDeg * Math.PI) / 180) / Math.max(viewportPx, 1),
    distanceTo(t) {
      const [minx, miny, maxx, maxy] = tileBounds(t);
      const [e, n] = siteToPlant(f, (minx + maxx) / 2, (miny + maxy) / 2);
      const half = Math.hypot(maxx - minx, maxy - miny) / 2;
      const d = Math.hypot(cam.x - n, cam.y - sceneY, cam.z - e);
      return Math.max(d - half, Math.abs(cam.y - sceneY), 0.01);
    },
  };
}

/**
 * A tile as a quad at scene height `sceneY`: corners NW, NE, SE, SW with uvs (0,0) (1,0) (1,1) (0,1).
 * Textures are uploaded with flipY off, so v = 0 is the image's top row (north): ruling R9.
 */
export function tileQuad(f: SiteFrameT, t: SiteTile, sceneY: number): { positions: Float32Array; uvs: Float32Array } {
  const [minx, miny, maxx, maxy] = tileBounds(t);
  const corners: [number, number][] = [
    [minx, maxy],
    [maxx, maxy],
    [maxx, miny],
    [minx, miny],
  ];
  const positions = new Float32Array(12);
  corners.forEach(([x, y], i) => {
    const [e, n] = siteToPlant(f, x, y);
    positions.set([n, sceneY, e], i * 3);
  });
  return { positions, uvs: new Float32Array([0, 0, 1, 0, 1, 1, 0, 1]) };
}

export interface TileImage {
  width: number;
  height: number;
  close?(): void;
}
export type TileFetch = (url: string, signal: AbortSignal) => Promise<TileImage | null>;
/** A 404 or 410: the layer was deleted (siteTileLoader.ts's "gone"). */
export class GoneError extends Error {}

/** Fetch, not `<img>`, so a 204 reads as an empty tile and a 404/410 as a gone layer (ruling R9). */
export async function fetchSiteTile(url: string, signal: AbortSignal): Promise<TileImage | null> {
  const res = await fetch(url, { signal });
  if (res.status === 204) return null;
  if (res.status === 404 || res.status === 410) throw new GoneError(url);
  if (res.status !== 200) throw new Error(`tile answered ${res.status}`);
  return createImageBitmap(await res.blob());
}

export function makeTexture(image: TileImage): THREE.Texture {
  const t = new THREE.Texture(image as unknown as HTMLImageElement);
  t.flipY = false;
  t.generateMipmaps = false;
  t.minFilter = THREE.LinearFilter;
  t.magFilter = THREE.LinearFilter;
  t.colorSpace = THREE.SRGBColorSpace;
  t.needsUpdate = true;
  return t;
}

type State = "queued" | "loading" | "ready" | "empty" | "error";
interface Entry {
  url: string;
  state: State;
  texture: THREE.Texture | null;
  image: TileImage | null;
  wantedAt: number;
  abort: AbortController | null;
  onGone: (() => void) | null;
}

/**
 * The drape's texture cache, shared by every tile layer. Each frame: `beginFrame`, the layers' `want`
 * and `peek` calls, `endFrame`. Queued, loading and ready entries count toward `capacity`. A new tile
 * evicts the least recently wanted ready or queued tile that this frame did not want, or is refused
 * (the layer draws an ancestor instead). Empty (204) and failed tiles are remembered without counting.
 */
export class TileCache {
  private readonly entries = new Map<string, Entry>();
  private queue: string[] = [];
  private inFlight = 0;
  private frameNo = 0;
  private disposed = false;

  constructor(
    private readonly fetchTile: TileFetch,
    private readonly onChange: () => void,
    readonly capacity = MAX_LIVE_TILES,
    readonly maxInFlight = MAX_IN_FLIGHT,
  ) {}

  beginFrame(): void {
    this.frameNo += 1;
    this.queue = [];
  }

  want(url: string, onGone?: () => void): THREE.Texture | null {
    if (this.disposed) return null;
    let e = this.entries.get(url);
    if (!e) {
      if (!this.makeRoom()) return null;
      e = { url, state: "queued", texture: null, image: null, wantedAt: this.frameNo, abort: null, onGone: onGone ?? null };
      this.entries.set(url, e);
    }
    e.wantedAt = this.frameNo;
    if (e.state === "queued" && !this.queue.includes(url)) this.queue.push(url);
    this.pump();
    return e.texture;
  }

  /** A ready texture (an ancestor drawn while its children load), marked wanted; never fetches. */
  peek(url: string): THREE.Texture | null {
    const e = this.entries.get(url);
    if (!e || !e.texture) return null;
    e.wantedAt = this.frameNo;
    return e.texture;
  }

  live(): number {
    let n = 0;
    for (const e of this.entries.values()) if (e.state === "queued" || e.state === "loading" || e.state === "ready") n++;
    return n;
  }

  bytes(): number {
    let n = 0;
    for (const e of this.entries.values()) if (e.state === "ready") n++;
    return n * TILE_BYTES;
  }

  endFrame(): void {
    for (const e of [...this.entries.values()]) {
      if (e.state === "queued" && e.wantedAt < this.frameNo) this.entries.delete(e.url);
    }
    const quiet = [...this.entries.values()].filter((e) => e.state === "empty" || e.state === "error");
    if (quiet.length > this.capacity * 4) {
      quiet
        .sort((a, b) => a.wantedAt - b.wantedAt)
        .slice(0, quiet.length - this.capacity * 4)
        .forEach((e) => this.entries.delete(e.url));
    }
  }

  dispose(): void {
    this.disposed = true;
    for (const e of [...this.entries.values()]) this.drop(e);
    this.queue = [];
  }

  private makeRoom(): boolean {
    if (this.live() < this.capacity) return true;
    let victim: Entry | null = null;
    for (const e of this.entries.values()) {
      if ((e.state === "ready" || e.state === "queued") && e.wantedAt < this.frameNo) {
        if (!victim || e.wantedAt < victim.wantedAt) victim = e;
      }
    }
    if (!victim) return false;
    this.drop(victim);
    return true;
  }

  private drop(e: Entry): void {
    e.abort?.abort();
    e.texture?.dispose();
    e.image?.close?.();
    this.entries.delete(e.url);
  }

  private pump(): void {
    while (this.inFlight < this.maxInFlight && this.queue.length > 0) {
      const url = this.queue.shift()!;
      const e = this.entries.get(url);
      if (!e || e.state !== "queued") continue;
      e.state = "loading";
      e.abort = new AbortController();
      this.inFlight += 1;
      this.fetchTile(url, e.abort.signal)
        .then(
          (image) => {
            if (this.entries.get(url) !== e) {
              image?.close?.();
              return;
            }
            if (image) {
              e.image = image;
              e.texture = makeTexture(image);
              e.state = "ready";
            } else e.state = "empty";
          },
          (err: unknown) => {
            if (this.entries.get(url) !== e) return;
            e.state = "error";
            if (err instanceof GoneError) e.onGone?.();
          },
        )
        .finally(() => {
          this.inFlight -= 1;
          e.abort = null;
          if (this.disposed) return;
          this.pump();
          this.onChange();
        });
    }
  }
}
```

- [ ] **Step 4: Run it to verify it passes**

Run: `pnpm -C frontend exec vitest run src/site3d/engine/tiles.test.ts`
Expected: all tests PASS. If "a near camera refines" finds a max z ≤ 12, check `tileView`'s `pixelAngle` (degrees to radians) before touching the test.

- [ ] **Step 5: Commit**

```
pnpm -C frontend exec prettier --write src/site3d/engine/tiles.ts src/site3d/engine/tiles.test.ts
git add frontend/src/site3d/engine/tiles.ts frontend/src/site3d/engine/tiles.test.ts
git commit -m "feat(site3d): tile quadtree, quads and a 64 MB shared tile cache" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: `SiteEngine`, camera helpers, picking and the layer types

**Files:**
- Create: `frontend/src/site3d/layers/types.ts`
- Create: `frontend/src/site3d/engine/camera.ts`
- Create: `frontend/src/site3d/engine/pick.ts`
- Create: `frontend/src/site3d/engine/SiteEngine.ts`
- Create: `frontend/src/site3d/engine/create.ts`
- Test: `frontend/src/site3d/engine/camera.test.ts`, `frontend/src/site3d/engine/pick.test.ts`, `frontend/src/site3d/engine/SiteEngine.test.ts`

**Interfaces:**
- Consumes: T3 (`SiteFrameT`), T5 (`TileCache`, `fetchSiteTile`); `NoWebGlError`, `tokenColor`, `tokenRgb`, `startTween`, `tweenAt`, `View`, `isReducedMotion`, `isTypingTarget`.
- Produces: `SiteLayer`, `PickHit`, `Pickable` (types.ts); `PresetId`, `CamView`, `ISO_DIR`, `planDir`, `viewBox`, `FLY_KEYS`, `flySpeed`, `flyDelta` (camera.ts); `pickFirst` (pick.ts); `SiteEngine`, `NavMode` (SiteEngine.ts); `createSiteEngine` (create.ts). Exact signatures are in "Interfaces provided".

- [ ] **Step 1: Write the failing tests**

`frontend/src/site3d/engine/camera.test.ts`:
```ts
import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { ISO_DIR, flyDelta, flySpeed, planDir, viewBox } from "./camera";

describe("camera helpers", () => {
  it("viewBox frames a box from a direction at a distance that fits it", () => {
    const box = new THREE.Box3(new THREE.Vector3(-10, 0, -10), new THREE.Vector3(10, 20, 10));
    const v = viewBox(box, new THREE.Vector3(0, 1, 0), 45, 1.5);
    expect(v.target.toArray()).toEqual([0, 10, 0]);
    const radius = Math.sqrt(20 * 20 * 3) / 2;
    expect(v.position.y - 10).toBeCloseTo(radius / Math.sin(THREE.MathUtils.degToRad(22.5)), 6);
  });

  it("a narrow window backs the camera off further", () => {
    const box = new THREE.Box3(new THREE.Vector3(-10, 0, -10), new THREE.Vector3(10, 20, 10));
    const wide = viewBox(box, ISO_DIR, 45, 2).position.distanceTo(new THREE.Vector3(0, 10, 0));
    const narrow = viewBox(box, ISO_DIR, 45, 0.5).position.distanceTo(new THREE.Vector3(0, 10, 0));
    expect(narrow).toBeGreaterThan(wide);
  });

  it("plan view looks down with plant north up the screen", () => {
    const d = planDir();
    expect(d.y).toBeGreaterThan(0.99);
    expect(d.x).toBeLessThan(0); // the camera sits a hair south, so +X (north) is screen-up
  });

  it("fly: W moves along the view, D strafes east when facing north, E rises", () => {
    const north = new THREE.Vector3(1, 0, 0);
    expect(flyDelta(new Set(["KeyW"]), north, 2, 0.5).toArray()).toEqual([1, 0, 0]);
    const d = flyDelta(new Set(["KeyD"]), north, 1, 1);
    expect(d.z).toBeCloseTo(1, 9);
    expect(flyDelta(new Set(["KeyE"]), north, 1, 1).y).toBeCloseTo(1, 9);
    expect(flyDelta(new Set(), north, 1, 1).length()).toBe(0);
  });

  it("fly speed is a quarter of the distance, clamped, ×4 with Shift", () => {
    expect(flySpeed(40, 1000, false)).toBe(10);
    expect(flySpeed(0.1, 1000, false)).toBe(0.25);
    expect(flySpeed(5000, 1000, true)).toBe(1000);
  });
});
```

`frontend/src/site3d/engine/pick.test.ts`:
```ts
import * as THREE from "three";
import { describe, expect, it } from "vitest";
import type { Pickable } from "../layers/types";
import { pickFirst } from "./pick";

function box(id: string, x: number): THREE.Mesh {
  const m = new THREE.Mesh(new THREE.BoxGeometry(2, 2, 2), new THREE.MeshBasicMaterial());
  m.position.set(x, 0, 0);
  m.userData = { id };
  return m;
}

function pickable(root: THREE.Object3D, extra: Partial<Pickable> = {}): Pickable {
  return {
    layerId: "model",
    root,
    resolve: (o) => (typeof o.userData.id === "string" ? { itemId: o.userData.id, extras: { ...o.userData } } : null),
    ...extra,
  };
}

const ray = () => {
  const r = new THREE.Raycaster();
  r.set(new THREE.Vector3(0, 0, 0), new THREE.Vector3(1, 0, 0));
  return r;
};

describe("pickFirst", () => {
  it("returns the nearest resolvable hit", () => {
    const root = new THREE.Group();
    root.add(box("far", 20), box("near", 10));
    root.updateMatrixWorld(true);
    const hit = pickFirst(ray(), [pickable(root)]);
    expect(hit?.itemId).toBe("near");
    expect(hit?.layerId).toBe("model");
    expect(hit?.point[0]).toBeCloseTo(9, 6);
  });

  it("skips hidden objects and points the layer refuses (a cut)", () => {
    const root = new THREE.Group();
    const near = box("near", 10);
    root.add(box("far", 20), near);
    root.updateMatrixWorld(true);
    near.visible = false;
    expect(pickFirst(ray(), [pickable(root)])?.itemId).toBe("far");
    near.visible = true;
    expect(pickFirst(ray(), [pickable(root, { accepts: (p) => p.x > 15 })])?.itemId).toBe("far");
  });

  it("an unresolvable hit falls through to the next one; nothing is null", () => {
    const root = new THREE.Group();
    const bare = box("x", 10);
    bare.userData = {};
    root.add(bare, box("far", 20));
    root.updateMatrixWorld(true);
    expect(pickFirst(ray(), [pickable(root)])?.itemId).toBe("far");
    expect(pickFirst(ray(), [])).toBeNull();
  });
});
```

`frontend/src/site3d/engine/SiteEngine.test.ts`:
```ts
import { afterEach, describe, expect, it, vi } from "vitest";
import { NoWebGlError } from "@/clouds/viewer/engine";
import { createSiteEngine } from "./create";
import { SiteEngine } from "./SiteEngine";

describe("SiteEngine", () => {
  afterEach(() => vi.restoreAllMocks());

  it("no WebGL is a NoWebGlError, never a half-built engine", () => {
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null);
    const canvas = document.createElement("canvas");
    expect(() => new SiteEngine(canvas, null)).toThrow(NoWebGlError);
    expect(() => createSiteEngine(canvas, null)).toThrow(NoWebGlError);
  });
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `pnpm -C frontend exec vitest run src/site3d/engine/camera.test.ts src/site3d/engine/pick.test.ts src/site3d/engine/SiteEngine.test.ts`
Expected: FAIL, unresolved imports `./camera`, `./pick`, `./create`, `./SiteEngine`.

- [ ] **Step 3: Implement the layer types**

`frontend/src/site3d/layers/types.ts`:
```ts
import type * as THREE from "three";
import type { SiteEngine } from "../engine/SiteEngine";

/** One Site 3D layer module (index binding; S2 adds cloud, water, sky, photos, findings). */
export interface SiteLayer {
  id: string;
  label: string;
  attach(e: SiteEngine): Promise<void> | void;
  detach(): void;
  setVisible(v: boolean): void;
  setOpacity?(o: number): void;
  update?(dt: number, camera: THREE.Camera): void;
}

/** What a click found: the layer, the item id (from node extras, ruling R8) and the scene point. */
export interface PickHit {
  layerId: string;
  itemId: string;
  point: [number, number, number];
  extras: Record<string, unknown>;
}

/** A layer's pickable subtree; `accepts` lets a layer refuse a point (what its cut plane hides). */
export interface Pickable {
  layerId: string;
  root: THREE.Object3D;
  resolve(object: THREE.Object3D): { itemId: string; extras: Record<string, unknown> } | null;
  accepts?(point: THREE.Vector3): boolean;
}
```

- [ ] **Step 4: Implement camera.ts and pick.ts**

`frontend/src/site3d/engine/camera.ts`:
```ts
import * as THREE from "three";

/** "fit" (iso over everything), "plan" (top-down, plant north up), or an area preset from the model. */
export type PresetId = "fit" | "plan" | `area:${string}`;
export interface CamView {
  position: THREE.Vector3;
  target: THREE.Vector3;
}

/** From the target towards the camera: south-west of the site and above (north is +X, east +Z). */
export const ISO_DIR = new THREE.Vector3(-1, 0.9, -1).normalize();
export const PLAN_TILT = 0.002;

/** Straight down, tilted a hair so the camera's up (+Y) projects to plant north (+X) on screen. */
export function planDir(): THREE.Vector3 {
  return new THREE.Vector3(-Math.sin(PLAN_TILT), Math.cos(PLAN_TILT), 0);
}

/** Where to stand, along `dir` from the box centre, to see the whole box. */
export function viewBox(box: THREE.Box3, dir: THREE.Vector3, fovDeg: number, aspect: number): CamView {
  const target = box.getCenter(new THREE.Vector3());
  const radius = Math.max(box.getSize(new THREE.Vector3()).length() / 2, 1);
  const vFov = THREE.MathUtils.degToRad(fovDeg);
  const hFov = 2 * Math.atan(Math.tan(vFov / 2) * Math.max(aspect, 1e-3));
  const dist = radius / Math.sin(Math.min(vFov, hFov) / 2);
  return { position: target.clone().addScaledVector(dir.clone().normalize(), dist), target };
}

export const FLY_KEYS = new Set(["KeyW", "KeyA", "KeyS", "KeyD", "KeyQ", "KeyE"]);
export const FLY_SHIFT_FACTOR = 4;
const UP = new THREE.Vector3(0, 1, 0);

/** `clamp(distanceToTarget, 1, siteDiagonal) / 4` m/s, × 4 with Shift (as the cloud viewer). */
export function flySpeed(distanceToTarget: number, siteDiagonal: number, shift: boolean): number {
  const d = Math.min(Math.max(distanceToTarget, 1), Math.max(siteDiagonal, 1));
  return (d / 4) * (shift ? FLY_SHIFT_FACTOR : 1);
}

/** W/S along the view, A/D strafe level, E/Q up/down (world Y): the step for `dt` seconds. */
export function flyDelta(held: ReadonlySet<string>, forward: THREE.Vector3, speed: number, dt: number): THREE.Vector3 {
  const f = forward.clone().normalize();
  const r = new THREE.Vector3().crossVectors(f, UP).normalize();
  const v = new THREE.Vector3();
  if (held.has("KeyW")) v.add(f);
  if (held.has("KeyS")) v.sub(f);
  if (held.has("KeyD")) v.add(r);
  if (held.has("KeyA")) v.sub(r);
  if (held.has("KeyE")) v.add(UP);
  if (held.has("KeyQ")) v.sub(UP);
  if (v.lengthSq() === 0) return v;
  return v.normalize().multiplyScalar(speed * dt);
}
```

`frontend/src/site3d/engine/pick.ts`:
```ts
import type * as THREE from "three";
import type { PickHit, Pickable } from "../layers/types";

function visibleChain(o: THREE.Object3D | null): boolean {
  for (let n = o; n; n = n.parent) if (!n.visible) return false;
  return true;
}

/** The nearest hit over every pickable layer that is drawn, accepted by its layer, and resolves to an item. */
export function pickFirst(raycaster: THREE.Raycaster, pickables: readonly Pickable[]): PickHit | null {
  let best: PickHit | null = null;
  let bestD = Infinity;
  for (const p of pickables) {
    if (!p.root.visible) continue;
    for (const h of raycaster.intersectObject(p.root, true)) {
      if (h.distance >= bestD) break;
      if (!visibleChain(h.object)) continue;
      if (p.accepts && !p.accepts(h.point)) continue;
      const r = p.resolve(h.object);
      if (!r) continue;
      best = { layerId: p.layerId, itemId: r.itemId, extras: r.extras, point: [h.point.x, h.point.y, h.point.z] };
      bestD = h.distance;
      break;
    }
  }
  return best;
}
```

- [ ] **Step 5: Implement SiteEngine.ts and create.ts**

`frontend/src/site3d/engine/SiteEngine.ts`:
```ts
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import type { View } from "@/clouds/viewer/camera";
import { NoWebGlError } from "@/clouds/viewer/engine";
import { tokenColor, tokenRgb } from "@/clouds/viewer/overlay";
import { startTween, tweenAt, type Tween } from "@/clouds/viewer/tween";
import { isTypingTarget } from "@/ui/keymap";
import { isReducedMotion } from "@/ui/motion";
import type { PickHit, Pickable, SiteLayer } from "../layers/types";
import { FLY_KEYS, ISO_DIR, flyDelta, flySpeed, planDir, viewBox, type CamView } from "./camera";
import { pickFirst } from "./pick";
import type { SiteFrameT } from "./siteTransform";
import { TileCache, fetchSiteTile } from "./tiles";

export type NavMode = "orbit" | "pan" | "fly";
export type SelectListener = (hit: PickHit | null) => void;

const CLICK_SLOP_PX = 4;
const FLY_ENTER_AHEAD_M = 10;
const IDLE_MS = 1000;

const vec = (v: THREE.Vector3) => ({ x: v.x, y: v.y, z: v.z });

/**
 * The Site 3D engine (spec 2026-10-03 §11). One WebGLRenderer with a logarithmic depth buffer (the
 * scene spans kilometres and centimetres), a Y-up scene whose origin is the plant origin at the datum
 * (index frame rule), orbit/pan/fly, presets, picking, layers and the shared tile cache. It renders on
 * demand: while a tween, fly movement or tile load runs, and for 1 s after input; then it idles.
 */
export class SiteEngine {
  readonly frame: SiteFrameT | null;
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(45, 1, 0.1, 100_000);
  readonly renderer: THREE.WebGLRenderer;
  readonly tiles: TileCache;
  private readonly canvas: HTMLCanvasElement;
  private readonly host: HTMLElement;
  private readonly controls: OrbitControls;
  private readonly ro: ResizeObserver;
  private readonly layers = new Map<string, SiteLayer>();
  private readonly pickables = new Map<string, Pickable>();
  private readonly content = new Map<string, THREE.Box3>();
  private readonly presetBoxes = new Map<string, { owner: string; box: THREE.Box3 }>();
  private readonly listeners = new Set<SelectListener>();
  private readonly held = new Set<string>();
  private readonly unlisten: Array<() => void> = [];
  private readonly raycaster = new THREE.Raycaster();
  private nav: NavMode = "orbit";
  private shift = false;
  private tween: Tween | null = null;
  private raf = 0;
  private idleUntil = 0;
  private lastTick: number | null = null;
  private downAt: [number, number] | null = null;
  private framed = false;
  private disposed = false;

  constructor(canvas: HTMLCanvasElement, frame: SiteFrameT | null) {
    this.canvas = canvas;
    this.host = canvas.parentElement ?? canvas;
    this.frame = frame;
    try {
      this.renderer = new THREE.WebGLRenderer({
        canvas,
        antialias: true,
        logarithmicDepthBuffer: true,
        powerPreference: "high-performance",
      });
    } catch (err) {
      throw new NoWebGlError(err instanceof Error ? err.message : String(err));
    }
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.localClippingEnabled = true;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.setClearColor(tokenColor(tokenRgb("bg")));
    this.camera.up.set(0, 1, 0);
    this.camera.position.set(-400, 360, -400);
    this.scene.add(new THREE.HemisphereLight(0xdfe8ff, 0x2a2f3a, 0.9));
    const sun = new THREE.DirectionalLight(0xffffff, 1.4);
    sun.position.set(-300, 600, 200);
    this.scene.add(sun);
    this.tiles = new TileCache(fetchSiteTile, () => this.requestRender());
    this.controls = new OrbitControls(this.camera, canvas);
    this.controls.enableDamping = !isReducedMotion();
    this.controls.zoomToCursor = true;
    this.controls.screenSpacePanning = false; // pan along the ground
    this.controls.addEventListener("change", this.requestRender);
    this.ro = new ResizeObserver(this.resize);
    this.ro.observe(this.host);
    this.resize();
    this.listen(canvas, "pointerdown", (e) => {
      const p = e as PointerEvent;
      if (p.button === 0) this.downAt = [p.clientX, p.clientY];
    });
    this.listen(canvas, "pointerup", (e) => {
      const p = e as PointerEvent;
      const d = this.downAt;
      this.downAt = null;
      if (!d || Math.hypot(p.clientX - d[0], p.clientY - d[1]) > CLICK_SLOP_PX) return;
      this.select(this.pick(p.clientX, p.clientY));
    });
    this.listen(window, "keydown", (e) => this.onKey(e as KeyboardEvent, true));
    this.listen(window, "keyup", (e) => this.onKey(e as KeyboardEvent, false));
    this.listen(window, "blur", () => this.held.clear());
    this.requestRender();
  }

  readonly requestRender = (): void => {
    if (this.disposed) return;
    this.idleUntil = performance.now() + IDLE_MS;
    if (!this.raf) this.raf = requestAnimationFrame(this.loop);
  };

  get navMode(): NavMode {
    return this.nav;
  }

  viewportHeight(): number {
    return this.canvas.clientHeight || 1;
  }

  /** Visible tile drapes (ortho, drawings) sharing the tile budget; at least 1. */
  drapeCount(): number {
    let n = 0;
    for (const l of this.layers.values()) {
      const d = l as Partial<{ isTileDrape: boolean; shown: boolean }>;
      if (d.isTileDrape && d.shown) n += 1;
    }
    return Math.max(1, n);
  }

  addLayer(l: SiteLayer): void {
    if (this.disposed) return;
    if (this.layers.has(l.id)) this.removeLayer(l.id);
    this.layers.set(l.id, l);
    try {
      const pending = l.attach(this);
      if (pending) void pending.catch(() => {}); // a layer reports its own failure (onError)
    } catch {
      // as above: the layer's own callback says what failed
    }
    this.requestRender();
  }

  removeLayer(id: string): void {
    if (this.disposed) return;
    const l = this.layers.get(id);
    if (!l) return;
    this.layers.delete(id);
    l.detach();
    this.pickables.delete(id);
    this.content.delete(id);
    this.clearPresets(id);
    this.requestRender();
  }

  layer(id: string): SiteLayer | undefined {
    return this.layers.get(id);
  }

  addPickable(p: Pickable): void {
    this.pickables.set(p.layerId, p);
  }

  removePickable(layerId: string): void {
    this.pickables.delete(layerId);
  }

  /** A layer's extent; the first one frames the view (fit, no tween). */
  setContentBox(owner: string, box: THREE.Box3 | null): void {
    if (box && !box.isEmpty()) this.content.set(owner, box.clone());
    else this.content.delete(owner);
    if (!this.framed && this.content.size > 0) {
      this.framed = true;
      this.setPreset("fit", { instant: true });
    }
    this.requestRender();
  }

  contentBox(): THREE.Box3 | null {
    if (this.content.size === 0) return null;
    const all = new THREE.Box3();
    for (const b of this.content.values()) all.union(b);
    return all;
  }

  setPresetBox(owner: string, id: string, box: THREE.Box3 | null): void {
    if (box && !box.isEmpty()) this.presetBoxes.set(id, { owner, box: box.clone() });
    else this.presetBoxes.delete(id);
  }

  clearPresets(owner: string): void {
    for (const [id, p] of [...this.presetBoxes]) if (p.owner === owner) this.presetBoxes.delete(id);
  }

  presets(): string[] {
    return ["fit", "plan", ...[...this.presetBoxes.keys()].sort()];
  }

  setPreset(id: string, opts: { instant?: boolean } = {}): void {
    const all = this.contentBox();
    if (id === "fit") {
      if (all) this.goTo(viewBox(all, ISO_DIR, this.camera.fov, this.camera.aspect), opts.instant);
    } else if (id === "plan") {
      if (all) this.goTo(viewBox(all, planDir(), this.camera.fov, this.camera.aspect), opts.instant);
    } else {
      const p = this.presetBoxes.get(id);
      if (p) this.goTo(viewBox(p.box, ISO_DIR, this.camera.fov, this.camera.aspect), opts.instant);
    }
  }

  flyTo(box: THREE.Box3): void {
    const dir = this.camera.position.clone().sub(this.controls.target);
    if (dir.lengthSq() < 1e-9) dir.copy(ISO_DIR);
    this.goTo(viewBox(box, dir.normalize(), this.camera.fov, this.camera.aspect));
  }

  setNav(mode: NavMode): void {
    this.nav = mode;
    this.held.clear();
    this.controls.mouseButtons.LEFT = mode === "pan" ? THREE.MOUSE.PAN : THREE.MOUSE.ROTATE;
    if (mode === "fly") {
      const f = this.controls.target.clone().sub(this.camera.position);
      if (f.lengthSq() > 1e-9)
        this.controls.target.copy(this.camera.position).addScaledVector(f.normalize(), FLY_ENTER_AHEAD_M);
    }
    this.requestRender();
  }

  pick(x: number, y: number): PickHit | null {
    const rect = this.canvas.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return null;
    const ndc = new THREE.Vector2(((x - rect.left) / rect.width) * 2 - 1, -((y - rect.top) / rect.height) * 2 + 1);
    this.raycaster.setFromCamera(ndc, this.camera);
    return pickFirst(this.raycaster, [...this.pickables.values()]);
  }

  onSelect(cb: SelectListener): () => void {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }

  /** Tells every listener (the model layer's outline, the screen's panel); null clears. */
  select(hit: PickHit | null): void {
    for (const cb of [...this.listeners]) cb(hit);
    this.requestRender();
  }

  dispose(): void {
    if (this.disposed) return;
    for (const l of [...this.layers.values()]) l.detach();
    this.layers.clear();
    this.pickables.clear();
    this.content.clear();
    this.presetBoxes.clear();
    this.listeners.clear();
    this.disposed = true;
    cancelAnimationFrame(this.raf);
    this.raf = 0;
    this.ro.disconnect();
    this.unlisten.forEach((u) => u());
    this.unlisten.length = 0;
    this.controls.removeEventListener("change", this.requestRender);
    this.controls.dispose();
    this.tiles.dispose();
    this.renderer.dispose();
  }

  private readonly loop = (now: number): void => {
    this.raf = 0;
    if (this.disposed) return;
    const dt = this.lastTick === null ? 0 : Math.min((now - this.lastTick) / 1000, 0.1);
    this.lastTick = now;
    let busy = false;
    if (this.tween) {
      const { view, done } = tweenAt(this.tween, now);
      this.applyView(view);
      if (done) this.tween = null;
      else busy = true;
    }
    if (this.nav === "fly" && this.held.size > 0) {
      busy = true;
      if (dt > 0) {
        const forward = this.controls.target.clone().sub(this.camera.position);
        const diag = this.contentBox()?.getSize(new THREE.Vector3()).length() ?? 1000;
        const step = flyDelta(this.held, forward, flySpeed(forward.length(), diag, this.shift), dt);
        this.camera.position.add(step);
        this.controls.target.add(step);
      }
    }
    this.controls.update();
    this.tiles.beginFrame();
    for (const l of this.layers.values()) l.update?.(dt, this.camera);
    this.tiles.endFrame();
    this.renderer.render(this.scene, this.camera);
    if (busy || now < this.idleUntil) this.raf = requestAnimationFrame(this.loop);
    else this.lastTick = null;
  };

  private readonly resize = (): void => {
    if (this.disposed) return;
    const w = this.host.clientWidth || 1;
    const h = this.host.clientHeight || 1;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.requestRender();
  };

  private goTo(to: CamView, instant = false): void {
    const dist = to.position.distanceTo(to.target);
    this.camera.far = Math.max(100_000, dist * 20);
    this.camera.updateProjectionMatrix();
    const target: View = { position: vec(to.position), target: vec(to.target) };
    if (instant || isReducedMotion()) {
      this.tween = null;
      this.applyView(target);
    } else {
      const from: View = { position: vec(this.camera.position), target: vec(this.controls.target) };
      this.tween = startTween(from, target, performance.now(), false);
    }
    this.requestRender();
  }

  private applyView(v: View): void {
    this.camera.position.set(v.position.x, v.position.y, v.position.z);
    this.controls.target.set(v.target.x, v.target.y, v.target.z);
    this.camera.lookAt(this.controls.target);
  }

  private onKey(e: KeyboardEvent, down: boolean): void {
    this.shift = e.shiftKey;
    if (!FLY_KEYS.has(e.code)) return;
    if (!down) {
      this.held.delete(e.code);
      return;
    }
    if (this.nav !== "fly" || isTypingTarget(e.target)) return;
    e.preventDefault();
    this.held.add(e.code);
    this.requestRender();
  }

  private listen(target: EventTarget, type: string, fn: (e: Event) => void): void {
    target.addEventListener(type, fn);
    this.unlisten.push(() => target.removeEventListener(type, fn));
  }
}
```

`frontend/src/site3d/engine/create.ts`:
```ts
import { SiteEngine } from "./SiteEngine";
import type { SiteFrameT } from "./siteTransform";

/** The one place the screen makes an engine, so a test can swap it (vi.mock("@/site3d/engine/create")). */
export function createSiteEngine(canvas: HTMLCanvasElement, frame: SiteFrameT | null): SiteEngine {
  return new SiteEngine(canvas, frame);
}
```

- [ ] **Step 6: Run them to verify they pass**

Run: `pnpm -C frontend exec vitest run src/site3d/engine`
Expected: camera, pick, SiteEngine, siteTransform and tiles tests all PASS.

- [ ] **Step 7: Commit**

```
pnpm -C frontend exec prettier --write src/site3d/engine src/site3d/layers/types.ts
git add frontend/src/site3d/layers/types.ts frontend/src/site3d/engine/camera.ts frontend/src/site3d/engine/camera.test.ts frontend/src/site3d/engine/pick.ts frontend/src/site3d/engine/pick.test.ts frontend/src/site3d/engine/SiteEngine.ts frontend/src/site3d/engine/SiteEngine.test.ts frontend/src/site3d/engine/create.ts
git commit -m "feat(site3d): Site 3D engine with log depth, orbit/pan/fly, presets and picking" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: Drape layers: `tileDrape`, `ortho.layer`, `drawing.layer`

**Files:**
- Create: `frontend/src/site3d/layers/tileDrape.ts`
- Create: `frontend/src/site3d/layers/ortho.layer.ts`
- Create: `frontend/src/site3d/layers/drawing.layer.ts`
- Test: `frontend/src/site3d/layers/tileDrape.test.ts`

**Interfaces:**
- Consumes: `SiteEngine` members `frame`, `scene`, `tiles`, `requestRender`, `setContentBox`, `viewportHeight`, `drapeCount` (T6); `selectTiles`, `tileView`, `tileQuad`, `fillTemplate`, `parentTile`, `tileKey`, `minZoomFor` (T5); `SceneOrtho`, `SceneDrawing` (T4).
- Produces: `TileDrapeLayer` (`isTileDrape`, `shown`, `group`, `setOpacity`, `setVisible`, `update`); `createOrthoLayer` (id `ortho:<id>`, `ORTHO_Y = 0`); `createDrawingLayer` (id `drawing:<id>`, `DRAWING_Y = 0.05`, `DRAWING_MAX_Z = 19`, `DRAWING_OPACITY = 0.85`).

- [ ] **Step 1: Write the failing test**

`frontend/src/site3d/layers/tileDrape.test.ts`:
```ts
import * as THREE from "three";
import { describe, expect, it, vi } from "vitest";
import { TILE_SCENE } from "@/test/siteSceneFixtures";
import type { SiteEngine } from "../engine/SiteEngine";
import type { SiteFrameT } from "../engine/siteTransform";
import { GoneError, TileCache, type TileFetch } from "../engine/tiles";
import { createDrawingLayer, DRAWING_MAX_Z, DRAWING_Y } from "./drawing.layer";
import { createOrthoLayer, ORTHO_Y } from "./ortho.layer";

const FRAME: SiteFrameT = {
  crs: { epsg: 32639, wkt: null },
  origin_crs: [245000, 3180000],
  plant_north_deg: 17.9991,
  datum: { label: "HPFS", el_m: 100 },
};
const flush = () => new Promise((r) => setTimeout(r, 0));
const url = (rel: string) => `http://b${rel}&token=t`;

function engine(fetchTile: TileFetch = async () => ({ width: 256, height: 256 })) {
  const e = {
    frame: FRAME,
    scene: new THREE.Scene(),
    tiles: new TileCache(fetchTile, () => {}),
    requestRender: vi.fn(),
    setContentBox: vi.fn(),
    viewportHeight: () => 800,
    drapeCount: () => 1,
  };
  return e as unknown as SiteEngine & typeof e;
}

const far = () => {
  const c = new THREE.PerspectiveCamera(45, 1, 0.1, 1e6);
  c.position.set(0, 50_000, 0);
  return c;
};

async function settle(layer: ReturnType<typeof createOrthoLayer>, e: ReturnType<typeof engine>, cam: THREE.Camera) {
  e.tiles.beginFrame();
  layer.update(0, cam);
  e.tiles.endFrame();
  await flush();
  e.tiles.beginFrame();
  layer.update(0, cam);
  e.tiles.endFrame();
}

describe("tile drape layers", () => {
  it("the ortho drapes its tiles at the datum with the token-bearing template", async () => {
    const fetchTile = vi.fn(async () => ({ width: 256, height: 256 }));
    const e = engine(fetchTile);
    const layer = createOrthoLayer(TILE_SCENE.orthos[0], url);
    expect(layer.id).toBe("ortho:o1");
    layer.attach(e);
    expect(e.scene.children).toContain(layer.group);
    expect(e.setContentBox).toHaveBeenCalledWith("ortho:o1", expect.any(THREE.Box3));
    await settle(layer, e, far());
    const meshes = layer.group.children as THREE.Mesh[];
    expect(meshes.length).toBeGreaterThan(0);
    const firstUrl = fetchTile.mock.calls[0][0] as string;
    expect(firstUrl).toMatch(/^http:\/\/b\/api\/v1\/projects\/p1\/site-tiles\/map\/o1\/\d+\/-?\d+\/-?\d+\?v=o1&frame_key=epsg%3A32639&token=t$/);
    const pos = meshes[0].geometry.getAttribute("position");
    for (let i = 0; i < 4; i++) expect(pos.getY(i)).toBe(ORTHO_Y);
    expect(meshes[0].renderOrder).toBeLessThan(100);
  });

  it("drawings sit just above the ortho, draw after it, and choose their own zooms", async () => {
    const e = engine();
    const layer = createDrawingLayer(TILE_SCENE.drawings[0], url);
    expect(layer.id).toBe("drawing:d1");
    layer.attach(e);
    await settle(layer, e, far());
    const m = layer.group.children[0] as THREE.Mesh;
    expect(m.geometry.getAttribute("position").getY(0)).toBeCloseTo(DRAWING_Y, 6);
    expect(m.renderOrder).toBeGreaterThanOrEqual(100);
    expect((m.material as THREE.MeshBasicMaterial).opacity).toBeCloseTo(0.85, 6);
    expect(DRAWING_MAX_Z).toBe(19);
  });

  it("opacity and visibility apply; a hidden layer asks for no tiles", async () => {
    const fetchTile = vi.fn(async () => ({ width: 256, height: 256 }));
    const e = engine(fetchTile);
    const layer = createOrthoLayer(TILE_SCENE.orthos[0], url);
    layer.attach(e);
    await settle(layer, e, far());
    layer.setOpacity(0.4);
    for (const m of layer.group.children as THREE.Mesh[])
      expect((m.material as THREE.MeshBasicMaterial).opacity).toBeCloseTo(0.4, 6);
    layer.setVisible(false);
    expect(layer.group.visible).toBe(false);
    expect(layer.shown).toBe(false);
    const calls = fetchTile.mock.calls.length;
    const near = new THREE.PerspectiveCamera(45, 1, 0.1, 1e6);
    near.position.set(0, 20, 0);
    layer.update(0, near);
    expect(fetchTile.mock.calls.length).toBe(calls);
  });

  it("a gone layer (404/410) clears its tiles and says so", async () => {
    const onGone = vi.fn();
    const e = engine(async (u) => Promise.reject(new GoneError(u)));
    const layer = createOrthoLayer(TILE_SCENE.orthos[0], url, onGone);
    layer.attach(e);
    await settle(layer, e, far());
    expect(onGone).toHaveBeenCalled();
    expect(layer.shown).toBe(false);
    expect(layer.group.children).toHaveLength(0);
  });

  it("detach removes its meshes and its content box", async () => {
    const e = engine();
    const layer = createOrthoLayer(TILE_SCENE.orthos[0], url);
    layer.attach(e);
    await settle(layer, e, far());
    layer.detach();
    expect(e.scene.children).not.toContain(layer.group);
    expect(layer.group.children).toHaveLength(0);
    expect(e.setContentBox).toHaveBeenLastCalledWith("ortho:o1", null);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm -C frontend exec vitest run src/site3d/layers/tileDrape.test.ts`
Expected: FAIL, unresolved `./drawing.layer` / `./ortho.layer`.

- [ ] **Step 3: Implement**

`frontend/src/site3d/layers/tileDrape.ts`:
```ts
import * as THREE from "three";
import type { SiteExtent, SiteTile } from "@/mapws/view/siteGrid";
import type { SiteEngine } from "../engine/SiteEngine";
import { siteToPlant, type SiteFrameT } from "../engine/siteTransform";
import { fillTemplate, parentTile, selectTiles, tileKey, tileQuad, tileView } from "../engine/tiles";
import type { SiteLayer } from "./types";

export interface DrapeSpec {
  id: string;
  label: string;
  /** Absolute, token-bearing, with `{z}/{x}/{y}` left in. */
  template: string;
  bounds: SiteExtent;
  minZ: number;
  maxZ: number;
  /** Scene height of the drape plane (y = EL − datum). */
  sceneY: number;
  renderOrderBase: number;
  opacity: number;
}

const QUAD_INDEX = [0, 1, 2, 0, 2, 3];

export function extent(b: readonly number[]): SiteExtent {
  return [b[0], b[1], b[2], b[3]];
}

/**
 * Site tiles draped on a horizontal plane (spec §11 ortho and drawing layers, ruling R9). Each frame it
 * picks the tiles the camera needs (≤ the engine's tile budget shared among visible drapes), draws the
 * loaded ones, and stands in the nearest loaded ancestor for a tile still loading.
 */
export class TileDrapeLayer implements SiteLayer {
  readonly isTileDrape = true;
  readonly id: string;
  readonly label: string;
  readonly group = new THREE.Group();
  private engine: SiteEngine | null = null;
  private readonly meshes = new Map<string, THREE.Mesh>();
  private opacity: number;
  private visible = true;
  private gone = false;

  constructor(
    private readonly spec: DrapeSpec,
    private readonly onGone?: () => void,
  ) {
    this.id = spec.id;
    this.label = spec.label;
    this.opacity = spec.opacity;
    this.group.name = spec.id;
  }

  get shown(): boolean {
    return this.visible && !this.gone;
  }

  attach(e: SiteEngine): void {
    if (!e.frame) return;
    this.engine = e;
    this.group.visible = this.visible;
    e.scene.add(this.group);
    e.setContentBox(this.id, this.contentBox(e.frame));
    e.requestRender();
  }

  detach(): void {
    const e = this.engine;
    this.engine = null;
    this.clear();
    this.group.removeFromParent();
    e?.setContentBox(this.id, null);
  }

  setVisible(v: boolean): void {
    this.visible = v;
    this.group.visible = v;
    this.engine?.requestRender();
  }

  setOpacity(o: number): void {
    this.opacity = Math.min(1, Math.max(0, o));
    for (const m of this.meshes.values()) (m.material as THREE.MeshBasicMaterial).opacity = this.opacity;
    this.engine?.requestRender();
  }

  update(_dt: number, camera: THREE.Camera): void {
    const e = this.engine;
    const frame = e?.frame;
    if (!e || !frame || !this.shown) return;
    const cam = camera as THREE.PerspectiveCamera;
    const view = tileView(frame, cam.position, cam.fov, e.viewportHeight(), this.spec.sceneY);
    const cap = Math.max(1, Math.floor(e.tiles.capacity / e.drapeCount()));
    const wanted = selectTiles(this.spec.bounds, this.spec.minZ, this.spec.maxZ, view, cap);
    const draw = new Map<string, { tile: SiteTile; texture: THREE.Texture }>();
    for (const t of wanted) {
      const texture = e.tiles.want(fillTemplate(this.spec.template, t), this.markGone);
      if (texture) {
        draw.set(tileKey(t), { tile: t, texture });
        continue;
      }
      for (let p = parentTile(t); p; p = parentTile(p)) {
        const pt = e.tiles.peek(fillTemplate(this.spec.template, p));
        if (pt) {
          draw.set(tileKey(p), { tile: p, texture: pt });
          break;
        }
      }
    }
    this.sync(draw, frame);
  }

  private readonly markGone = (): void => {
    if (this.gone) return;
    this.gone = true;
    this.clear();
    this.onGone?.();
    this.engine?.requestRender();
  };

  private sync(draw: Map<string, { tile: SiteTile; texture: THREE.Texture }>, frame: SiteFrameT): void {
    for (const [k, mesh] of [...this.meshes]) {
      const want = draw.get(k);
      const mat = mesh.material as THREE.MeshBasicMaterial;
      if (!want || mat.map !== want.texture) this.removeMesh(k, mesh);
    }
    for (const [k, { tile, texture }] of draw) {
      if (this.meshes.has(k)) continue;
      const q = tileQuad(frame, tile, this.spec.sceneY);
      const geo = new THREE.BufferGeometry();
      geo.setAttribute("position", new THREE.BufferAttribute(q.positions, 3));
      geo.setAttribute("uv", new THREE.BufferAttribute(q.uvs, 2));
      geo.setIndex(QUAD_INDEX);
      const mat = new THREE.MeshBasicMaterial({
        map: texture,
        transparent: true,
        opacity: this.opacity,
        depthWrite: false,
        side: THREE.DoubleSide,
        toneMapped: false,
      });
      const mesh = new THREE.Mesh(geo, mat);
      mesh.renderOrder = this.spec.renderOrderBase + tile.z;
      mesh.userData.tile = k;
      this.meshes.set(k, mesh);
      this.group.add(mesh);
    }
  }

  private removeMesh(k: string, mesh: THREE.Mesh): void {
    this.group.remove(mesh);
    mesh.geometry.dispose();
    (mesh.material as THREE.Material).dispose(); // the texture is the cache's
    this.meshes.delete(k);
  }

  private clear(): void {
    for (const [k, m] of [...this.meshes]) this.removeMesh(k, m);
  }

  private contentBox(frame: SiteFrameT): THREE.Box3 {
    const [minx, miny, maxx, maxy] = this.spec.bounds;
    const pts = [
      [minx, miny],
      [maxx, miny],
      [maxx, maxy],
      [minx, maxy],
    ].map(([x, y]) => {
      const [e, n] = siteToPlant(frame, x, y);
      return new THREE.Vector3(n, this.spec.sceneY, e);
    });
    return new THREE.Box3().setFromPoints(pts);
  }
}
```

`frontend/src/site3d/layers/ortho.layer.ts`:
```ts
import type { SceneOrtho } from "@/api/siteScene";
import { TileDrapeLayer, extent } from "./tileDrape";

/** The site ortho at the datum (scene y = 0): ruling R9. */
export const ORTHO_Y = 0;

export function createOrthoLayer(
  o: SceneOrtho,
  url: (rel: string) => string,
  onGone?: () => void,
): TileDrapeLayer {
  return new TileDrapeLayer(
    {
      id: `ortho:${o.id}`,
      label: o.name,
      template: url(o.tile_url_template),
      bounds: extent(o.bounds_site),
      minZ: o.min_z,
      maxZ: o.max_z,
      sceneY: ORTHO_Y,
      renderOrderBase: 0,
      opacity: 1,
    },
    onGone,
  );
}
```

`frontend/src/site3d/layers/drawing.layer.ts`:
```ts
import type { SceneDrawing } from "@/api/siteScene";
import { minZoomFor } from "../engine/tiles";
import { TileDrapeLayer, extent } from "./tileDrape";

/** Drawings at grade, just above the ortho and drawn after it (ruling R9); zooms by ruling R7. */
export const DRAWING_Y = 0.05;
export const DRAWING_MAX_Z = 19;
export const DRAWING_OPACITY = 0.85;

export function createDrawingLayer(
  d: SceneDrawing,
  url: (rel: string) => string,
  onGone?: () => void,
): TileDrapeLayer {
  const bounds = extent(d.bounds_site);
  return new TileDrapeLayer(
    {
      id: `drawing:${d.id}`,
      label: d.name,
      template: url(d.tile_url_template),
      bounds,
      minZ: minZoomFor(bounds, DRAWING_MAX_Z),
      maxZ: DRAWING_MAX_Z,
      sceneY: DRAWING_Y,
      renderOrderBase: 100,
      opacity: DRAWING_OPACITY,
    },
    onGone,
  );
}
```

- [ ] **Step 4: Run it to verify it passes**

Run: `pnpm -C frontend exec vitest run src/site3d/layers/tileDrape.test.ts`
Expected: 5 tests PASS.

- [ ] **Step 5: Commit**

```
pnpm -C frontend exec prettier --write src/site3d/layers/tileDrape.ts src/site3d/layers/ortho.layer.ts src/site3d/layers/drawing.layer.ts src/site3d/layers/tileDrape.test.ts
git add frontend/src/site3d/layers/tileDrape.ts frontend/src/site3d/layers/ortho.layer.ts frontend/src/site3d/layers/drawing.layer.ts frontend/src/site3d/layers/tileDrape.test.ts
git commit -m "feat(site3d): ortho and drawing drapes on the site tile grid" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 8: `model.layer` and the fixture plant GLB

**Files:**
- Create: `frontend/e2e/fixtures/make-site-plant-glb.mjs`
- Create (generated, committed): `frontend/e2e/fixtures/site-plant.glb`
- Create: `frontend/src/site3d/layers/model.layer.ts`
- Test: `frontend/src/site3d/layers/model.layer.test.ts`

**Interfaces:**
- Consumes: `SiteEngine` members `scene`, `requestRender`, `addPickable`, `removePickable`, `setContentBox`, `setPresetBox`, `clearPresets`, `onSelect` (T6); `disposeChildren`, `tokenColor`, `tokenRgb`.
- Produces: `ModelLayer`, `createModelLayer`, `ModelLayerOptions { url; label?; onLoad?(info); onError?(err); loader?(url) }`, `ModelLoadInfo`, `ColourBy`, `MODEL_LAYER_ID = "model"`, `itemIdOf`, `itemNodeOf`, `collectItems`, `colourKey`, `isFlagged`, `glbLoader`, `loadGlb`. The fixture GLB is used by T10.

- [ ] **Step 1: Write the fixture generator and generate the GLB**

`frontend/e2e/fixtures/make-site-plant-glb.mjs`:
```js
// Writes site-plant.glb: a two-item plant in the Site 3D frame (x north, y up, z east; metres; origin =
// plant origin at the datum) whose item nodes carry register-row extras in the shape A1 writes (plan S1,
// ruling R8). "rack.1" has a dot on purpose: GLTFLoader strips it from node names, extras keep it.
// Run from frontend/: node e2e/fixtures/make-site-plant-glb.mjs
import { writeFileSync } from "node:fs";

function boxMesh([cx, cy, cz], [sx, sy, sz]) {
  const pos = [];
  const nrm = [];
  const idx = [];
  const half = [sx / 2, sy / 2, sz / 2];
  const c = [cx, cy, cz];
  const quad = [
    [-1, -1],
    [1, -1],
    [1, 1],
    [-1, 1],
  ];
  for (let a = 0; a < 3; a++) {
    for (const s of [1, -1]) {
      const u = (a + 1) % 3;
      const v = (a + 2) % 3;
      const order = s > 0 ? quad : [...quad].reverse();
      const base = pos.length / 3;
      for (const [qu, qv] of order) {
        const p = [0, 0, 0];
        p[a] = s;
        p[u] = qu;
        p[v] = qv;
        pos.push(c[0] + p[0] * half[0], c[1] + p[1] * half[1], c[2] + p[2] * half[2]);
        const n = [0, 0, 0];
        n[a] = s;
        nrm.push(...n);
      }
      idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
    }
  }
  return { pos: new Float32Array(pos), nrm: new Float32Array(nrm), idx: new Uint16Array(idx) };
}

const parts = [];
const bufferViews = [];
const accessors = [];
let offset = 0;
function addView(typed, target) {
  const bytes = Buffer.from(typed.buffer, typed.byteOffset, typed.byteLength);
  const pad = (4 - (bytes.length % 4)) % 4;
  bufferViews.push({ buffer: 0, byteOffset: offset, byteLength: bytes.length, target });
  parts.push(bytes, Buffer.alloc(pad));
  offset += bytes.length + pad;
  return bufferViews.length - 1;
}
function minmax(pos) {
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < pos.length; i += 3)
    for (let k = 0; k < 3; k++) {
      min[k] = Math.min(min[k], pos[i + k]);
      max[k] = Math.max(max[k], pos[i + k]);
    }
  return [min, max];
}

const meshes = [];
for (const [name, geo, material] of [
  ["tank shell", boxMesh([0, 15, 0], [40, 30, 40]), 0],
  ["rack frame", boxMesh([33, 4, 0], [6, 8, 30]), 1],
]) {
  const pv = addView(geo.pos, 34962);
  const nv = addView(geo.nrm, 34962);
  const iv = addView(geo.idx, 34963);
  const [min, max] = minmax(geo.pos);
  accessors.push({ bufferView: pv, componentType: 5126, count: geo.pos.length / 3, type: "VEC3", min, max });
  accessors.push({ bufferView: nv, componentType: 5126, count: geo.nrm.length / 3, type: "VEC3" });
  accessors.push({ bufferView: iv, componentType: 5123, count: geo.idx.length, type: "SCALAR" });
  const a = accessors.length - 3;
  meshes.push({ name, primitives: [{ attributes: { POSITION: a, NORMAL: a + 1 }, indices: a + 2, material }] });
}

const row = (extra) => ({ area: "20", source_sheet: "P0058LNG-00-40-0-T0006", notes: "", ...extra });
const json = {
  asset: { version: "2.0", generator: "kestrel e2e fixture (plan S1)" },
  scene: 0,
  scenes: [{ name: "site-plant", nodes: [0] }],
  nodes: [
    { name: "site-plant", children: [1], extras: { frame: "x = plant N, y = EL - datum, z = plant E; metres" } },
    { name: "Area 20", children: [2, 4], extras: { group: "area", area: "20" } },
    {
      name: "20-t-0001",
      children: [3],
      extras: row({
        node: "20-t-0001",
        id: "20-t-0001",
        tag: "20-T-0001",
        name: "LNG tank",
        type: "tank_lng",
        height_source: "drawing",
        flags: "",
        confidence: "high",
      }),
    },
    { name: "20-t-0001/shell", mesh: 0 },
    {
      name: "rack.1",
      children: [5],
      extras: row({
        node: "rack.1",
        id: "rack.1",
        tag: null,
        name: "Pipe rack",
        type: "pipe_rack",
        height_source: "indicative",
        flags: "height_mismatch",
        confidence: "medium",
      }),
    },
    { name: "rack.1/frame", mesh: 1 },
  ],
  meshes,
  materials: [
    { name: "Concrete", pbrMetallicRoughness: { baseColorFactor: [0.75, 0.74, 0.7, 1], metallicFactor: 0, roughnessFactor: 0.9 } },
    { name: "Steel", pbrMetallicRoughness: { baseColorFactor: [0.55, 0.57, 0.6, 1], metallicFactor: 0.6, roughnessFactor: 0.5 } },
  ],
  accessors,
  bufferViews,
  buffers: [{ byteLength: offset }],
};

const bin = Buffer.concat(parts);
let jsonBuf = Buffer.from(JSON.stringify(json), "utf8");
jsonBuf = Buffer.concat([jsonBuf, Buffer.alloc((4 - (jsonBuf.length % 4)) % 4, 0x20)]);
const header = Buffer.alloc(12);
header.writeUInt32LE(0x46546c67, 0);
header.writeUInt32LE(2, 4);
header.writeUInt32LE(12 + 8 + jsonBuf.length + 8 + bin.length, 8);
const chunk = (len, type) => {
  const b = Buffer.alloc(8);
  b.writeUInt32LE(len, 0);
  b.writeUInt32LE(type, 4);
  return b;
};
const out = Buffer.concat([header, chunk(jsonBuf.length, 0x4e4f534a), jsonBuf, chunk(bin.length, 0x004e4942), bin]);
writeFileSync(new URL("./site-plant.glb", import.meta.url), out);
console.log(`site-plant.glb: ${out.length} bytes`);
```

Run (from `frontend/`): `node e2e/fixtures/make-site-plant-glb.mjs`
Expected: prints `site-plant.glb: <n> bytes` (a few kB), and the file exists.

- [ ] **Step 2: Write the failing test**

`frontend/src/site3d/layers/model.layer.test.ts`:
```ts
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import * as THREE from "three";
import { MeshoptDecoder } from "three/examples/jsm/libs/meshopt_decoder.module.js";
import { describe, expect, it, vi } from "vitest";
import type { SiteEngine } from "../engine/SiteEngine";
import {
  collectItems,
  colourKey,
  createModelLayer,
  glbLoader,
  isFlagged,
  itemIdOf,
  type ModelLayer,
} from "./model.layer";
import type { PickHit, Pickable } from "./types";

function item(id: string, type: string, extra: Record<string, unknown>, x: number): THREE.Group {
  const node = new THREE.Group();
  node.userData = { id, node: id, type, area: "20", ...extra };
  const part = new THREE.Group();
  part.userData = { id: `${id}/shell`, type: "part_shell" }; // a part with extras: the item is the outermost
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(2, 2, 2), new THREE.MeshStandardMaterial());
  mesh.position.set(x, 1, 0);
  part.add(mesh);
  node.add(part);
  return node;
}

function plant(): THREE.Group {
  const root = new THREE.Group();
  const area = new THREE.Group();
  area.userData = { group: "area", area: "20" };
  area.add(
    item("20-t-0001", "tank_lng", { height_source: "drawing", flags: "", name: "LNG tank" }, 0),
    item("rack.1", "pipe_rack", { height_source: "indicative", flags: "height_mismatch" }, 10),
  );
  const other = item("b-1", "building", { area: "30", height_source: "cloud", flags: [] }, 30);
  root.add(area, other);
  return root;
}

function engine() {
  let listener: ((h: PickHit | null) => void) | null = null;
  let pickable: Pickable | null = null;
  const e = {
    scene: new THREE.Scene(),
    requestRender: vi.fn(),
    addPickable: vi.fn((p: Pickable) => (pickable = p)),
    removePickable: vi.fn(),
    setContentBox: vi.fn(),
    setPresetBox: vi.fn(),
    clearPresets: vi.fn(),
    onSelect: vi.fn((cb: (h: PickHit | null) => void) => {
      listener = cb;
      return () => (listener = null);
    }),
    emit: (h: PickHit | null) => listener?.(h),
    pickable: () => pickable!,
  };
  return e as unknown as SiteEngine & typeof e;
}

async function loaded(scene = plant()) {
  const e = engine();
  const onLoad = vi.fn();
  const layer = createModelLayer({ url: "x.glb", onLoad, loader: async () => scene });
  await layer.attach(e);
  return { e, layer, onLoad, scene };
}

const meshes = (l: ModelLayer) => {
  const out: THREE.Mesh[] = [];
  l.root.traverse((c) => {
    if ((c as THREE.Mesh).isMesh) out.push(c as THREE.Mesh);
  });
  return out;
};

describe("model layer helpers", () => {
  it("ids come from extras, so dots survive (Review Focus 5)", () => {
    const items = collectItems(plant());
    expect(items.map((i) => i.id)).toEqual(["20-t-0001", "rack.1", "b-1"]);
    const n = new THREE.Object3D();
    n.userData = { type: "x", node: "only.node" };
    expect(itemIdOf(n)).toBe("only.node");
    n.userData = { node: "no-type" };
    expect(itemIdOf(n)).toBeNull();
  });

  it("colour keys per mode", () => {
    const x = { type: "pump", area: "20", height_source: "cloud", flags: "plan_offset" };
    expect(colourKey("material", x)).toBeNull();
    expect(colourKey("type", x)).toBe("pump");
    expect(colourKey("area", {})).toBe("none");
    expect(colourKey("height_source", { h_src: "drawing" })).toBe("drawing");
    expect(colourKey("flag", x)).toBe("flagged");
    expect(isFlagged({ flags: "[]" })).toBe(false);
    expect(isFlagged({ flags: ["builder_fallback"] })).toBe(true);
  });

  it("registers the meshopt decoder for imported GLBs (spec §15)", () => {
    expect((glbLoader() as unknown as { meshoptDecoder: unknown }).meshoptDecoder).toBe(MeshoptDecoder);
  });

  it("parses the e2e fixture GLB into its two items", async () => {
    const buf = readFileSync(resolve(__dirname, "../../../e2e/fixtures/site-plant.glb"));
    const gltf = await glbLoader().parseAsync(new Uint8Array(buf).buffer, "");
    const items = collectItems(gltf.scene);
    expect(items.map((i) => i.id)).toEqual(["20-t-0001", "rack.1"]);
    expect(items[0].extras.name).toBe("LNG tank");
  });
});

describe("ModelLayer", () => {
  it("loads: counts items, frames the content and makes one preset per area", async () => {
    const { e, onLoad } = await loaded();
    expect(onLoad).toHaveBeenCalledWith({ items: 3, areas: ["20", "30"], types: ["building", "pipe_rack", "tank_lng"] });
    expect(e.setContentBox).toHaveBeenCalledWith("model", expect.any(THREE.Box3));
    expect(e.setPresetBox).toHaveBeenCalledWith("model", "area:20", expect.any(THREE.Box3));
    expect(e.setPresetBox).toHaveBeenCalledWith("model", "area:30", expect.any(THREE.Box3));
  });

  it("resolves a pick on a part's mesh to its item", async () => {
    const { e, layer } = await loaded();
    const mesh = meshes(layer)[1];
    expect(e.pickable().resolve(mesh)).toEqual({
      itemId: "rack.1",
      extras: expect.objectContaining({ type: "pipe_rack", flags: "height_mismatch" }),
    });
    expect(e.pickable().resolve(layer.root)).toBeNull();
  });

  it("colour by type shares a material per type; back to material restores the originals", async () => {
    const { layer } = await loaded();
    const before = meshes(layer).map((m) => m.material);
    layer.setColourBy("type");
    const after = meshes(layer).map((m) => m.material);
    expect(after[0]).not.toBe(before[0]);
    expect(new Set(after).size).toBe(3);
    layer.setColourBy("flag");
    const flagged = meshes(layer).map((m) => m.material);
    expect(flagged[0]).toBe(flagged[2]); // clean, clean
    expect(flagged[1]).not.toBe(flagged[0]); // flagged
    layer.setColourBy("material");
    expect(meshes(layer).map((m) => m.material)).toEqual(before);
  });

  it("see-through, wireframe and the cut apply to every material", async () => {
    const { e, layer } = await loaded();
    layer.setOpacity(0.4);
    layer.setWireframe(true);
    layer.setCut(1.5);
    for (const m of meshes(layer)) {
      const mat = m.material as THREE.MeshStandardMaterial;
      expect(mat.transparent).toBe(true);
      expect(mat.opacity).toBeCloseTo(0.4, 6);
      expect(mat.depthWrite).toBe(false);
      expect(mat.wireframe).toBe(true);
      expect(mat.clippingPlanes?.[0].constant).toBe(1.5);
    }
    expect(e.pickable().accepts!(new THREE.Vector3(0, 2, 0))).toBe(false);
    expect(e.pickable().accepts!(new THREE.Vector3(0, 1, 0))).toBe(true);
    layer.setCut(null);
    expect((meshes(layer)[0].material as THREE.Material).clippingPlanes).toBeNull();
  });

  it("outlines the selected item and clears on null", async () => {
    const { e, layer } = await loaded();
    e.emit({ layerId: "model", itemId: "rack.1", point: [0, 0, 0], extras: {} });
    expect(layer.helpers.children.length).toBeGreaterThan(0);
    e.emit({ layerId: "other", itemId: "rack.1", point: [0, 0, 0], extras: {} });
    expect(layer.helpers.children).toHaveLength(0);
  });

  it("itemBox and itemIds", async () => {
    const { layer } = await loaded();
    expect(layer.itemIds()).toEqual(["20-t-0001", "rack.1", "b-1"]);
    expect(layer.itemBox("rack.1")?.getCenter(new THREE.Vector3()).x).toBeCloseTo(10, 6);
    expect(layer.itemBox("nope")).toBeNull();
  });

  it("a failed load calls onError; a detach before the load ends drops it", async () => {
    const onError = vi.fn();
    const failing = createModelLayer({ url: "x", onError, loader: async () => Promise.reject(new Error("409")) });
    await failing.attach(engine());
    expect(onError).toHaveBeenCalled();

    let finish: (o: THREE.Object3D) => void = () => {};
    const onLoad = vi.fn();
    const slow = createModelLayer({ url: "x", onLoad, loader: () => new Promise((r) => (finish = r)) });
    const e = engine();
    const pending = slow.attach(e);
    slow.detach();
    finish(plant());
    await pending;
    expect(onLoad).not.toHaveBeenCalled();
    expect(slow.root.children).toHaveLength(0);
    expect(e.removePickable).toHaveBeenCalledWith("model");
  });

  it("visibility hides the model and its outline", async () => {
    const { layer } = await loaded();
    layer.setVisible(false);
    expect(layer.root.visible).toBe(false);
    expect(layer.helpers.visible).toBe(false);
  });
});
```

- [ ] **Step 3: Run it to verify it fails**

Run: `pnpm -C frontend exec vitest run src/site3d/layers/model.layer.test.ts`
Expected: FAIL, `Failed to resolve import "./model.layer"`.

- [ ] **Step 4: Implement**

`frontend/src/site3d/layers/model.layer.ts`:
```ts
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { MeshoptDecoder } from "three/examples/jsm/libs/meshopt_decoder.module.js";
import { disposeChildren } from "@/clouds/viewer/dispose";
import { tokenColor, tokenRgb } from "@/clouds/viewer/overlay";
import type { SiteEngine } from "../engine/SiteEngine";
import type { PickHit, SiteLayer } from "./types";

export type ColourBy = "material" | "type" | "area" | "height_source" | "flag";
export const MODEL_LAYER_ID = "model";
export const OUTLINE_MAX_TRIANGLES = 200_000;
const GOLDEN = 0.618033988749895;
type Extras = Record<string, unknown>;

export interface ModelItem {
  id: string;
  node: THREE.Object3D;
  extras: Extras;
}
export interface ModelLoadInfo {
  items: number;
  areas: string[];
  types: string[];
}
export interface ModelLayerOptions {
  url: string;
  label?: string;
  onLoad?(info: ModelLoadInfo): void;
  onError?(err: unknown): void;
  /** Tests pass a scene; the app loads the GLB. */
  loader?(url: string): Promise<THREE.Object3D>;
}

const str = (v: unknown): string | null => (typeof v === "string" && v.length > 0 ? v : null);

/** Ruling R8: an item node has a string `type` and an `id` (else `node`) in its extras. */
export function itemIdOf(o: THREE.Object3D): string | null {
  const ud = (o.userData ?? {}) as Extras;
  if (typeof ud.type !== "string") return null;
  return str(ud.id) ?? str(ud.node);
}

/** The outermost item node above `o` (a part may carry extras of its own), stopping at `stop`. */
export function itemNodeOf(o: THREE.Object3D | null, stop: THREE.Object3D | null = null): THREE.Object3D | null {
  let found: THREE.Object3D | null = null;
  for (let n = o; n && n !== stop; n = n.parent) if (itemIdOf(n)) found = n;
  return found;
}

export function collectItems(root: THREE.Object3D): ModelItem[] {
  const out: ModelItem[] = [];
  const visit = (o: THREE.Object3D) => {
    const id = itemIdOf(o);
    if (id) {
      out.push({ id, node: o, extras: { ...(o.userData as Extras) } });
      return;
    }
    o.children.forEach(visit);
  };
  visit(root);
  return out;
}

export function isFlagged(extras: Extras): boolean {
  const f = extras.flags;
  if (Array.isArray(f)) return f.length > 0;
  if (typeof f === "string") {
    const t = f.trim();
    return t !== "" && t !== "[]";
  }
  return false;
}

export function colourKey(mode: ColourBy, extras: Extras): string | null {
  switch (mode) {
    case "material":
      return null;
    case "type":
      return str(extras.type) ?? "other";
    case "area":
      return str(extras.area) ?? "none";
    case "height_source":
      return str(extras.height_source) ?? str(extras.h_src) ?? "indicative";
    case "flag":
      return isFlagged(extras) ? "flagged" : "clean";
  }
}

/** Status colours come from tokens; categories walk the hue circle by the golden ratio. */
export function modeColour(mode: ColourBy, key: string, index: number): THREE.Color {
  if (mode === "height_source")
    return tokenColor(tokenRgb(key === "drawing" ? "ok" : key === "cloud" ? "info" : "warn"));
  if (mode === "flag") return tokenColor(tokenRgb(key === "flagged" ? "danger" : "muted"));
  return new THREE.Color().setHSL((index * GOLDEN) % 1, 0.55, 0.6, THREE.SRGBColorSpace);
}

let loader: GLTFLoader | null = null;
/** One GLTFLoader with the meshopt decoder registered (spec §15: G1 writes none, imports may). */
export function glbLoader(): GLTFLoader {
  if (!loader) {
    loader = new GLTFLoader();
    loader.setMeshoptDecoder(MeshoptDecoder);
  }
  return loader;
}

export async function loadGlb(url: string): Promise<THREE.Object3D> {
  return (await glbLoader().loadAsync(url)).scene;
}

function meshesOf(node: THREE.Object3D): THREE.Mesh[] {
  const out: THREE.Mesh[] = [];
  node.traverse((c) => {
    if ((c as THREE.Mesh).isMesh) out.push(c as THREE.Mesh);
  });
  return out;
}

const materialsOf = (m: THREE.Mesh): THREE.Material[] => (Array.isArray(m.material) ? m.material : [m.material]);

function triangles(mesh: THREE.Mesh): number {
  const g = mesh.geometry;
  const n = g.index ? g.index.count / 3 : (g.getAttribute("position")?.count ?? 0) / 3;
  const inst = mesh as THREE.InstancedMesh;
  return n * (inst.isInstancedMesh ? inst.count : 1);
}

/**
 * The plant model layer (spec §11 "model"): one GLB at a time; colour by material, type, area, height
 * source or flag; see-through; wireframe; a horizontal cut (ruling R10); a selection outline (ruling R11).
 */
export class ModelLayer implements SiteLayer {
  readonly id = MODEL_LAYER_ID;
  readonly label: string;
  readonly root = new THREE.Group();
  readonly helpers = new THREE.Group();
  private engine: SiteEngine | null = null;
  private items: ModelItem[] = [];
  private readonly byId = new Map<string, ModelItem>();
  private readonly originals = new Map<THREE.Mesh, THREE.Material | THREE.Material[]>();
  private readonly colourMats = new Map<string, THREE.MeshStandardMaterial>();
  private readonly cutPlane = new THREE.Plane(new THREE.Vector3(0, -1, 0), 0);
  private colourBy: ColourBy = "material";
  private opacity = 1;
  private wireframe = false;
  private cutY: number | null = null;
  private seq = 0;
  private offSelect: (() => void) | null = null;

  constructor(private readonly opts: ModelLayerOptions) {
    this.label = opts.label ?? "Plant model";
    this.root.name = "model";
    this.helpers.name = "model-selection";
  }

  async attach(e: SiteEngine): Promise<void> {
    this.engine = e;
    e.scene.add(this.root, this.helpers);
    e.addPickable({
      layerId: this.id,
      root: this.root,
      resolve: (o) => this.resolve(o),
      accepts: (p) => this.cutY === null || p.y <= this.cutY + 1e-6,
    });
    this.offSelect = e.onSelect((hit: PickHit | null) =>
      this.highlight(hit && hit.layerId === this.id ? hit.itemId : null),
    );
    const seq = ++this.seq;
    try {
      const scene = await (this.opts.loader ?? loadGlb)(this.opts.url);
      if (seq !== this.seq || this.engine !== e) {
        const orphan = new THREE.Group();
        orphan.add(scene);
        disposeChildren(orphan);
        return;
      }
      this.opts.onLoad?.(this.adopt(scene));
    } catch (err) {
      if (seq === this.seq) this.opts.onError?.(err);
    }
  }

  /** Takes a parsed scene as the model (the load path, and tests). */
  adopt(scene: THREE.Object3D): ModelLoadInfo {
    this.clearModel();
    this.root.add(scene);
    this.root.updateMatrixWorld(true);
    this.items = collectItems(scene);
    for (const it of this.items) if (!this.byId.has(it.id)) this.byId.set(it.id, it);
    scene.traverse((c) => {
      const m = c as THREE.Mesh;
      if (!m.isMesh) return;
      this.originals.set(m, m.material);
      for (const mat of materialsOf(m)) mat.side = THREE.DoubleSide;
    });
    this.applyColour();
    const areas = new Map<string, THREE.Box3>();
    for (const it of this.items) {
      const a = str(it.extras.area);
      if (!a) continue;
      const b = new THREE.Box3().setFromObject(it.node);
      if (b.isEmpty()) continue;
      areas.set(a, (areas.get(a) ?? new THREE.Box3()).union(b));
    }
    const e = this.engine;
    if (e) {
      e.clearPresets(this.id);
      for (const [a, b] of areas) e.setPresetBox(this.id, `area:${a}`, b);
      e.setContentBox(this.id, new THREE.Box3().setFromObject(this.root));
      e.requestRender();
    }
    return {
      items: this.byId.size,
      areas: [...areas.keys()].sort(),
      types: [...new Set(this.items.map((i) => str(i.extras.type) ?? "other"))].sort(),
    };
  }

  detach(): void {
    this.seq += 1;
    this.offSelect?.();
    this.offSelect = null;
    const e = this.engine;
    this.engine = null;
    this.clearModel();
    this.root.removeFromParent();
    this.helpers.removeFromParent();
    if (e) {
      e.removePickable(this.id);
      e.setContentBox(this.id, null);
      e.clearPresets(this.id);
    }
  }

  setVisible(v: boolean): void {
    this.root.visible = v;
    this.helpers.visible = v;
    this.engine?.requestRender();
  }

  /** See-through: below 1 the model is transparent and stops writing depth. */
  setOpacity(o: number): void {
    this.opacity = Math.min(1, Math.max(0, o));
    this.applyMaterialState();
  }

  setWireframe(on: boolean): void {
    this.wireframe = on;
    this.applyMaterialState();
  }

  /** Keeps what is at or below scene height `y`; null removes the cut. */
  setCut(y: number | null): void {
    this.cutY = y;
    if (y !== null) this.cutPlane.constant = y;
    this.applyMaterialState();
  }

  setColourBy(mode: ColourBy): void {
    this.colourBy = mode;
    this.applyColour();
  }

  itemIds(): string[] {
    return [...this.byId.keys()];
  }

  itemBox(id: string): THREE.Box3 | null {
    const it = this.byId.get(id);
    return it ? new THREE.Box3().setFromObject(it.node) : null;
  }

  private resolve(o: THREE.Object3D): { itemId: string; extras: Extras } | null {
    const n = itemNodeOf(o, this.root);
    const id = n ? itemIdOf(n) : null;
    return n && id ? { itemId: id, extras: { ...(n.userData as Extras) } } : null;
  }

  private applyColour(): void {
    const keys = [
      ...new Set(this.items.map((it) => colourKey(this.colourBy, it.extras)).filter((k): k is string => k !== null)),
    ].sort();
    for (const it of this.items) {
      const key = colourKey(this.colourBy, it.extras);
      for (const mesh of meshesOf(it.node)) {
        const original = this.originals.get(mesh);
        if (!original) continue;
        mesh.material = key === null ? original : this.colourMaterial(key, keys.indexOf(key));
      }
    }
    this.applyMaterialState();
  }

  private colourMaterial(key: string, index: number): THREE.MeshStandardMaterial {
    const ck = `${this.colourBy}:${key}`;
    let m = this.colourMats.get(ck);
    if (!m) {
      m = new THREE.MeshStandardMaterial({
        color: modeColour(this.colourBy, key, index),
        roughness: 0.85,
        metalness: 0,
        side: THREE.DoubleSide,
      });
      this.colourMats.set(ck, m);
    }
    return m;
  }

  private applyMaterialState(): void {
    const seen = new Set<THREE.Material>();
    this.root.traverse((c) => {
      const m = c as THREE.Mesh;
      if (m.isMesh) materialsOf(m).forEach((mat) => seen.add(mat));
    });
    const transparent = this.opacity < 1;
    for (const mat of seen) {
      if (mat.transparent !== transparent) mat.needsUpdate = true;
      mat.transparent = transparent;
      mat.opacity = this.opacity;
      mat.depthWrite = !transparent;
      if ("wireframe" in mat) (mat as THREE.MeshStandardMaterial).wireframe = this.wireframe;
      mat.clippingPlanes = this.cutY === null ? null : [this.cutPlane];
    }
    this.engine?.requestRender();
  }

  private highlight(id: string | null): void {
    disposeChildren(this.helpers);
    const it = id ? this.byId.get(id) : undefined;
    if (it) {
      this.root.updateMatrixWorld(true);
      const colour = tokenColor(tokenRgb("accent"));
      const ms = meshesOf(it.node);
      const heavy =
        ms.some((m) => (m as THREE.InstancedMesh).isInstancedMesh) ||
        ms.reduce((n, m) => n + triangles(m), 0) > OUTLINE_MAX_TRIANGLES;
      if (heavy) {
        this.addHelper(new THREE.Box3Helper(new THREE.Box3().setFromObject(it.node), colour));
      } else {
        for (const m of ms) {
          const line = new THREE.LineSegments(
            new THREE.EdgesGeometry(m.geometry, 30),
            new THREE.LineBasicMaterial({ color: colour, depthTest: false, transparent: true }),
          );
          line.matrixAutoUpdate = false;
          line.matrix.copy(m.matrixWorld);
          this.addHelper(line);
        }
      }
    }
    this.engine?.requestRender();
  }

  private addHelper(o: THREE.Object3D): void {
    o.renderOrder = 999;
    o.userData.kind = "selection";
    this.helpers.add(o);
  }

  private clearModel(): void {
    for (const [mesh, original] of this.originals) mesh.material = original; // dispose the real ones
    disposeChildren(this.helpers);
    disposeChildren(this.root);
    for (const m of this.colourMats.values()) m.dispose();
    this.colourMats.clear();
    this.items = [];
    this.byId.clear();
    this.originals.clear();
  }
}

export function createModelLayer(opts: ModelLayerOptions): ModelLayer {
  return new ModelLayer(opts);
}
```

- [ ] **Step 5: Run it to verify it passes**

Run: `pnpm -C frontend exec vitest run src/site3d/layers/model.layer.test.ts`
Expected: all tests PASS. If "parses the e2e fixture GLB" fails with an ArrayBuffer realm error, keep `new Uint8Array(buf).buffer` (it allocates in the test realm); do not switch to `buf.buffer`.

- [ ] **Step 6: Commit**

```
pnpm -C frontend exec prettier --write src/site3d/layers/model.layer.ts src/site3d/layers/model.layer.test.ts
git add frontend/e2e/fixtures/make-site-plant-glb.mjs frontend/e2e/fixtures/site-plant.glb frontend/src/site3d/layers/model.layer.ts frontend/src/site3d/layers/model.layer.test.ts
git commit -m "feat(site3d): plant model layer with colour-by, see-through, cut and selection outline" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 9: Route, lazy `SiteScreen`, the view and the placeholder panels

Load the design skills first (`impeccable`, `emil-design-eng`) and read `DESIGN.md`, plus `frontend/src/ui/GlassPanel.tsx`, `EmptyState.tsx`, `FloatingToolbar.tsx` and `Switch.tsx`. Design intent:
- The canvas sits on `bg`, and every control over it floats as glass (`GlassPanel variant="float"`, the only blur).
- View tools are top left, the Layers panel sits right of them, the selection card is top right, the "no plant model yet" card is centred, and status sits bottom centre.
- No hero numbers. Counts are mono `text-2xs`, and unavailable rows are `text-dim` with `aria-disabled`.
- Motion comes only from the primitives (`animate-reveal reduce-motion:animate-none`). The loading pill's live dot runs only while the GLB loads.

**Files:**
- Create: `frontend/src/site3d/layerRows.ts`, `frontend/src/site3d/layerRows.test.ts`
- Create: `frontend/src/site3d/panels/ViewTools.tsx`
- Create: `frontend/src/site3d/panels/LayersPlaceholder.tsx`
- Create: `frontend/src/site3d/panels/SelectionPlaceholder.tsx`
- Create: `frontend/src/site3d/SiteView.tsx`
- Create: `frontend/src/site3d/SiteScreen.tsx`
- Test: `frontend/src/site3d/SiteScreen.test.tsx`
- Modify: `frontend/src/app/lazyScreens.tsx` (after `AssetModelsScreen`)
- Modify: `frontend/src/routes/projectRoutes.tsx` (after the `models/:modelId` entry)
- Modify: `frontend/src/app/routeModel.ts` (`layoutOf`, `routeInfo`)
- Modify tests: `frontend/src/app/routeModel.test.ts`, `frontend/src/routes/routes.test.tsx`, `frontend/src/app/lazyScreens.test.tsx`

**Interfaces:**
- Consumes: T4 (`useSiteScene`, `absUrl`, `toFrameT`, `SiteScene`), T6 (`createSiteEngine`, `SiteEngine`, `NavMode`, `PresetId`), T7 (`createOrthoLayer`, `createDrawingLayer`), T8 (`createModelLayer`, `ModelLoadInfo`), `NoWebGlError`, ui primitives.
- Produces:
  - `SiteScreen` (route body);
  - `SiteView` (forwardRef, handle `{ clearSelection(): void; reload(): void }`; props `{ scene, frame, hidden, onSelect, onModel, onFailure? }`);
  - `LayerGroup = "model" | "ortho" | "drawing"`; `ModelStatus { url; state: "ready" | "error"; info }`;
  - `sceneLayerRows(scene, model, items)`, `LayerRow`, `ModelState`;
  - the placeholder panels S3 replaces: `LayersPlaceholder` → `LayersPanel`, `SelectionPlaceholder` → `ItemPanel`.

- [ ] **Step 1: Write the failing tests**

`frontend/src/site3d/layerRows.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { FRAME_ONLY_SCENE, MODEL_SCENE, TILE_SCENE } from "@/test/siteSceneFixtures";
import { sceneLayerRows } from "./layerRows";

describe("sceneLayerRows", () => {
  it("greys what the project does not have (Review Focus 1)", () => {
    const rows = sceneLayerRows(FRAME_ONLY_SCENE, "none", 0);
    expect(rows.map((r) => [r.id, r.available, r.detail])).toEqual([
      ["model", false, "None yet"],
      ["ortho", false, "None placed"],
      ["drawing", false, "None placed"],
      ["cloud", false, "None"],
      ["photos", false, "None"],
      ["findings", false, "None"],
    ]);
  });

  it("counts what is there; S2 layers are not toggleable yet (R14)", () => {
    const rows = Object.fromEntries(sceneLayerRows(TILE_SCENE, "ready", 2).map((r) => [r.id, r]));
    expect(rows.model.detail).toBe("2 items");
    expect(rows.model.toggleable).toBe(true);
    expect(rows.ortho.detail).toBe("1 map");
    expect(rows.drawing.detail).toBe("1 drawing");
    expect(rows.cloud.detail).toBe("1 cloud · not in this view yet");
    expect(rows.cloud.toggleable).toBe(false);
    expect(rows.photos.detail).toBe("36 photos · not in this view yet");
  });

  it("says when the model is loading or failed", () => {
    expect(sceneLayerRows(MODEL_SCENE, "loading", 0)[0].detail).toBe("Loading");
    expect(sceneLayerRows(MODEL_SCENE, "error", 0)[0].detail).toBe("Could not load");
    expect(sceneLayerRows(MODEL_SCENE, "ready", 1)[0].detail).toBe("1 item");
  });
});
```

`frontend/src/site3d/SiteScreen.test.tsx`:
```tsx
import { act, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NoWebGlError } from "@/clouds/viewer/engine";
import { fakeClient } from "@/test/fixtures";
import { renderWithProviders } from "@/test/render";
import { EMPTY_SCENE, FRAME_ONLY_SCENE, MODEL_SCENE, TILE_SCENE } from "@/test/siteSceneFixtures";
import type { SiteScene } from "@/api/siteScene";
import type { PickHit, SiteLayer } from "./layers/types";

const h = vi.hoisted(() => ({
  engines: [] as Array<{
    layers: Map<string, SiteLayer>;
    addLayer: (l: SiteLayer) => void;
    removeLayer: (id: string) => void;
    select: (hit: PickHit | null) => void;
    setPreset: (id: string) => void;
    setNav: (m: string) => void;
    onSelect: (cb: (hit: PickHit | null) => void) => () => void;
    dispose: () => void;
  }>,
  models: [] as Array<{ id: string; opts: { url: string; onLoad?: (i: unknown) => void; onError?: (e: unknown) => void }; setVisible: (v: boolean) => void }>,
  fail: null as Error | null,
}));

vi.mock("@/site3d/engine/create", () => ({
  createSiteEngine: () => {
    if (h.fail) throw h.fail;
    let cb: ((hit: PickHit | null) => void) | null = null;
    const layers = new Map<string, SiteLayer>();
    const e = {
      layers,
      addLayer: vi.fn((l: SiteLayer) => layers.set(l.id, l)),
      removeLayer: vi.fn((id: string) => layers.delete(id)),
      select: vi.fn((hit: PickHit | null) => cb?.(hit)),
      setPreset: vi.fn(),
      setNav: vi.fn(),
      onSelect: (f: (hit: PickHit | null) => void) => {
        cb = f;
        return () => (cb = null);
      },
      dispose: vi.fn(),
    };
    h.engines.push(e);
    return e;
  },
}));

vi.mock("@/site3d/layers/model.layer", () => ({
  createModelLayer: (opts: { url: string }) => {
    const l = { id: "model", label: "Plant model", opts, attach: vi.fn(), detach: vi.fn(), setVisible: vi.fn() };
    h.models.push(l);
    return l;
  },
}));

import { SiteScreen } from "./SiteScreen";

function open(scene: SiteScene | { status: number }, route = "/p/p1/site") {
  const { api } = fakeClient([
    "status" in scene
      ? { method: "GET", path: /\/site-scene/, status: scene.status, body: { error: { code: "boom", message: "The server failed", details: {} } } }
      : { method: "GET", path: /\/site-scene/, body: scene },
  ]);
  return renderWithProviders(<SiteScreen />, { api, route, path: "/p/:projectId/site/:modelId?" });
}

const TANK: PickHit = {
  layerId: "model",
  itemId: "20-t-0001",
  point: [0, 30, 0],
  extras: { name: "LNG tank", tag: "20-T-0001", type: "tank_lng", area: "20", height_source: "drawing", flags: "height_mismatch" },
};

describe("SiteScreen", () => {
  beforeEach(() => {
    h.engines.length = 0;
    h.models.length = 0;
    h.fail = null;
  });

  it("no frame: says nothing is placed, points at a plant model, makes no canvas (Review Focus 1)", async () => {
    open(EMPTY_SCENE);
    expect(await screen.findByText("Nothing to place yet")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Build a plant model" })).toHaveAttribute("href", "/p/p1/models");
    expect(screen.queryByTestId("site-canvas")).toBeNull();
    expect(h.engines).toHaveLength(0);
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("no model: opens the frame with layers greyed and the build empty state (Review Focus 1)", async () => {
    open(FRAME_ONLY_SCENE);
    expect(await screen.findByText("No plant model yet")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Build a plant model" })).toBeInTheDocument();
    expect(screen.getByTestId("site-canvas")).toBeInTheDocument();
    expect(h.engines).toHaveLength(1);
    const layers = screen.getByTestId("site-layers");
    const modelRow = within(layers).getByText("Plant model").closest("li")!;
    expect(modelRow).toHaveAttribute("aria-disabled", "true");
    expect(modelRow).toHaveTextContent("None yet");
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.queryByText(/loading the plant model/i)).toBeNull();
    expect(h.models).toHaveLength(0);
  });

  it("a model loads with the token-bearing URL, counts its items, and a pick shows the item", async () => {
    open(MODEL_SCENE, "/p/p1/site/m1");
    await screen.findByTestId("site-canvas");
    expect(h.models[0].opts.url).toBe("http://fake/api/v1/projects/p1/asset-models/m1/versions/1/glb?token=t");
    expect(screen.getByText(/loading the plant model/i)).toBeInTheDocument();
    act(() => h.models[0].opts.onLoad?.({ items: 2, areas: ["20"], types: ["pipe_rack", "tank_lng"] }));
    expect(await screen.findByText("2 items")).toBeInTheDocument();
    expect(screen.queryByText(/loading the plant model/i)).toBeNull();
    act(() => h.engines[0].select(TANK));
    const card = await screen.findByTestId("site-selection");
    expect(card).toHaveTextContent("LNG tank");
    expect(card).toHaveTextContent("20-T-0001");
    expect(card).toHaveTextContent("Height mismatch");
    await userEvent.click(within(card).getByRole("button", { name: "Clear selection" }));
    expect(screen.queryByTestId("site-selection")).toBeNull();
  });

  it("a model that fails to load says so and offers a reload (Review Focus 3)", async () => {
    open(MODEL_SCENE);
    await screen.findByTestId("site-canvas");
    act(() => h.models[0].opts.onError?.(new Error("409")));
    expect(await screen.findByText("The plant model could not load.")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Reload view" }));
    expect(h.engines.length).toBe(2);
    expect(h.engines[0].dispose).toHaveBeenCalled();
  });

  it("no WebGL: a notice, the layers list stays, no loading pill", async () => {
    h.fail = new NoWebGlError("no");
    open(MODEL_SCENE);
    expect(await screen.findByRole("alert")).toHaveTextContent(/3D view is off/i);
    expect(screen.getByTestId("site-layers")).toBeInTheDocument();
    expect(screen.queryByText(/loading the plant model/i)).toBeNull();
  });

  it("a failed manifest says what happened and offers to try again", async () => {
    open({ status: 500 });
    expect(await screen.findByText("The site could not load.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Try again" })).toBeInTheDocument();
  });

  it("maps and drawings become drape layers; switching Maps off hides them", async () => {
    open(TILE_SCENE);
    await screen.findByTestId("site-canvas");
    const e = h.engines[0];
    expect([...e.layers.keys()].sort()).toEqual(["drawing:d1", "model", "ortho:o1"]);
    await userEvent.click(screen.getByRole("switch", { name: "Maps" }));
    expect((e.layers.get("ortho:o1") as unknown as { shown: boolean }).shown).toBe(false);
    expect((e.layers.get("drawing:d1") as unknown as { shown: boolean }).shown).toBe(true);
  });

  it("view tools drive the engine", async () => {
    open(MODEL_SCENE);
    await screen.findByTestId("site-canvas");
    await userEvent.click(screen.getByRole("button", { name: "Plan view" }));
    expect(h.engines[0].setPreset).toHaveBeenCalledWith("plan");
    await userEvent.click(screen.getByRole("button", { name: "Pan" }));
    expect(h.engines[0].setNav).toHaveBeenCalledWith("pan");
    expect(screen.getByRole("button", { name: "Pan" })).toHaveAttribute("aria-pressed", "true");
  });
});
```

Add to `frontend/src/app/routeModel.test.ts`, inside `describe("routeInfo", ...)`:
```ts
  it("the Site 3D view is full-bleed and names itself in the breadcrumb", () => {
    expect(layoutOf("site", false)).toBe("fullbleed");
    expect(layoutOf("site", true)).toBe("fullbleed");
    const info = routeInfo("/p/p1/site/m1");
    expect(info.page).toBe("Site 3D");
    expect(info.tab).toBeNull();
    expect(info.layout).toBe("fullbleed");
  });
```
(If `routeInfo` is not imported there yet, add it to the existing import from `./routeModel`.)

In `frontend/src/routes/routes.test.tsx`, add two entries to the `it.each([...])("routes %s", ...)` list, after `` `/p/${P}/models/m1`, ``:
```ts
    `/p/${P}/site`,
    `/p/${P}/site/m1`,
```

In `frontend/src/app/lazyScreens.test.tsx`, add `SiteScreen` to the import from `./lazyScreens`, add `import { EMPTY_SCENE } from "@/test/siteSceneFixtures";`, and add a case to the `it.each([...])` array:
```tsx
    [
      "Site 3D",
      <TestApiProvider
        key="s"
        api={fakeClient([{ method: "GET", path: /\/site-scene/, body: EMPTY_SCENE }]).api}
      >
        <MemoryRouter initialEntries={["/p/p1/site"]}>
          <Routes>
            <Route path="/p/:projectId/site" element={<SiteScreen />} />
          </Routes>
        </MemoryRouter>
      </TestApiProvider>,
    ],
```

- [ ] **Step 2: Run them to verify they fail**

Run: `pnpm -C frontend exec vitest run src/site3d src/app/routeModel.test.ts src/routes/routes.test.tsx src/app/lazyScreens.test.tsx`
Expected: FAIL. `./layerRows` and `./SiteScreen` do not resolve; `layoutOf("site")` is `"page"`; `/p/P/site` matches `*`; `SiteScreen` is not exported from `lazyScreens`.

- [ ] **Step 3: Implement the rows and the panels**

`frontend/src/site3d/layerRows.ts`:
```ts
import type { SiteScene } from "@/api/siteScene";

export type ModelState = "none" | "loading" | "ready" | "error";
export type LayerRowId = "model" | "ortho" | "drawing" | "cloud" | "photos" | "findings";
export interface LayerRow {
  id: LayerRowId;
  label: string;
  available: boolean;
  toggleable: boolean;
  detail: string;
}

const count = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
const later = (n: number, one: string, many: string) =>
  n === 0 ? "None" : `${count(n, one, many)} · not in this view yet`;

/** The Layers placeholder's rows (S3's LayersPanel replaces the panel; S2 makes the last three live). */
export function sceneLayerRows(scene: SiteScene, model: ModelState, items: number): LayerRow[] {
  const modelDetail =
    model === "none"
      ? "None yet"
      : model === "loading"
        ? "Loading"
        : model === "error"
          ? "Could not load"
          : count(items, "item", "items");
  return [
    { id: "model", label: "Plant model", available: model !== "none", toggleable: model === "ready", detail: modelDetail },
    {
      id: "ortho",
      label: "Maps",
      available: scene.orthos.length > 0,
      toggleable: true,
      detail: scene.orthos.length === 0 ? "None placed" : count(scene.orthos.length, "map", "maps"),
    },
    {
      id: "drawing",
      label: "Drawings",
      available: scene.drawings.length > 0,
      toggleable: true,
      detail: scene.drawings.length === 0 ? "None placed" : count(scene.drawings.length, "drawing", "drawings"),
    },
    {
      id: "cloud",
      label: "Point clouds",
      available: scene.clouds.length > 0,
      toggleable: false,
      detail: later(scene.clouds.length, "cloud", "clouds"),
    },
    {
      id: "photos",
      label: "Photos",
      available: scene.photos.count > 0,
      toggleable: false,
      detail: later(scene.photos.count, "photo", "photos"),
    },
    {
      id: "findings",
      label: "Findings",
      available: scene.findings.count > 0,
      toggleable: false,
      detail: later(scene.findings.count, "finding", "findings"),
    },
  ];
}
```

`frontend/src/site3d/panels/ViewTools.tsx`:
```tsx
import { FloatingToolbar, MenuButton, ToolButton, ToolSeparator, type ToolDef } from "@/ui";
import type { PresetId } from "../engine/camera";
import type { NavMode } from "../engine/SiteEngine";

export interface ViewToolsProps {
  nav: NavMode;
  onNav(mode: NavMode): void;
  onPreset(id: PresetId): void;
  areas: readonly string[];
  disabled: boolean;
}

/** Orbit, pan, fly; fit, plan and one preset per area (spec §11 view tools; ruling R13: no shortcuts). */
export function ViewTools({ nav, onNav, onPreset, areas, disabled }: ViewToolsProps) {
  const tools: ToolDef[] = [
    { id: "orbit", icon: "orbit", label: "Orbit", active: nav === "orbit", disabled, onClick: () => onNav("orbit") },
    { id: "pan", icon: "pan", label: "Pan", active: nav === "pan", disabled, onClick: () => onNav("pan") },
    {
      id: "fly",
      icon: "fly",
      label: "Fly (W A S D, Q E)",
      active: nav === "fly",
      disabled,
      onClick: () => onNav("fly"),
    },
  ];
  return (
    <FloatingToolbar label="View tools" tools={tools} shortcuts={false}>
      <ToolSeparator />
      <ToolButton icon="fit" label="Fit to site" disabled={disabled} onClick={() => onPreset("fit")} />
      <ToolButton icon="north" label="Plan view" disabled={disabled} onClick={() => onPreset("plan")} />
      {areas.length > 0 && (
        <MenuButton
          iconOnly
          icon="area"
          label="Go to an area"
          menuLabel="Areas"
          variant="ghost"
          side="right"
          disabled={disabled}
          items={areas.map((a) => ({ id: a, label: `Area ${a}`, onSelect: () => onPreset(`area:${a}`) }))}
        />
      )}
    </FloatingToolbar>
  );
}
```

`frontend/src/site3d/panels/LayersPlaceholder.tsx`:
```tsx
import { GlassPanel, Switch, cx } from "@/ui";
import type { LayerRow } from "../layerRows";

export interface LayersPlaceholderProps {
  rows: readonly LayerRow[];
  hidden: ReadonlySet<string>;
  onToggle(id: string, visible: boolean): void;
}

/** S1's minimal Layers list; S3's LayersPanel replaces it (opacity, colour-by, water and sky). */
export function LayersPlaceholder({ rows, hidden, onToggle }: LayersPlaceholderProps) {
  return (
    <GlassPanel variant="float" as="section" aria-label="Layers" data-testid="site-layers" className="w-64 p-2">
      <h2 className="px-1.5 pb-1 text-xs text-muted">Layers</h2>
      <ul className="flex flex-col">
        {rows.map((r) => (
          <li
            key={r.id}
            aria-disabled={!r.available || undefined}
            className={cx("flex h-8 items-center justify-between gap-3 rounded-sm px-1.5", !r.available && "text-dim")}
          >
            {r.available && r.toggleable ? (
              <Switch checked={!hidden.has(r.id)} onChange={(v) => onToggle(r.id, v)} label={r.label} />
            ) : (
              <span className={cx("text-sm", r.available ? "text-ink" : "text-dim")}>{r.label}</span>
            )}
            <span className="truncate font-mono text-2xs tabular-nums text-muted">{r.detail}</span>
          </li>
        ))}
      </ul>
    </GlassPanel>
  );
}
```

`frontend/src/site3d/panels/SelectionPlaceholder.tsx`:
```tsx
import { GlassPanel, IconButton, Pill } from "@/ui";
import type { PickHit } from "../layers/types";

const HEIGHT_FROM: Record<string, string> = { drawing: "Drawing", cloud: "Point cloud", indicative: "Indicative" };

function flagList(v: unknown): string[] {
  if (Array.isArray(v)) return v.map(String).filter(Boolean);
  if (typeof v === "string") return v.split(/[;,\s]+/).filter((s) => s && s !== "[]");
  return [];
}

const human = (code: string) => (code.charAt(0).toUpperCase() + code.slice(1)).replace(/_/g, " ");

/** S1's selected-item card from the node extras; S3's ItemPanel (register row, source, Edit) replaces it. */
export function SelectionPlaceholder({ hit, onClear }: { hit: PickHit; onClear(): void }) {
  const x = hit.extras;
  const s = (k: string) => (typeof x[k] === "string" && x[k] !== "" ? (x[k] as string) : null);
  const heightFrom = s("height_source") ?? s("h_src");
  const flags = flagList(x.flags);
  return (
    <GlassPanel variant="float" as="aside" aria-label="Selected item" data-testid="site-selection" className="w-72 p-3">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate text-lg text-ink">{s("name") ?? hit.itemId}</p>
          {s("tag") && <p className="font-mono text-xs text-muted">{s("tag")}</p>}
        </div>
        <IconButton icon="x" label="Clear selection" size="sm" onClick={onClear} />
      </div>
      <dl className="mt-3 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-sm">
        <dt className="text-muted">Type</dt>
        <dd className="truncate text-ink">{s("type") ?? "Not set"}</dd>
        <dt className="text-muted">Area</dt>
        <dd className="text-ink">{s("area") ?? "Not set"}</dd>
        <dt className="text-muted">Height from</dt>
        <dd className="text-ink">{heightFrom ? (HEIGHT_FROM[heightFrom] ?? heightFrom) : "Not set"}</dd>
      </dl>
      {flags.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-1.5">
          {flags.map((f) => (
            <Pill key={f} tone="warn" size="sm">
              {human(f)}
            </Pill>
          ))}
        </div>
      )}
      <p className="mt-3 font-mono text-2xs text-dim">Item {hit.itemId}</p>
    </GlassPanel>
  );
}
```

- [ ] **Step 4: Implement SiteView and SiteScreen**

`frontend/src/site3d/SiteView.tsx`:
```tsx
import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from "react";
import { useBackend } from "@/api/client";
import { absUrl, type SiteScene } from "@/api/siteScene";
import { NoWebGlError } from "@/clouds/viewer/engine";
import { Alert, Button, isTypingTarget } from "@/ui";
import type { PresetId } from "./engine/camera";
import { createSiteEngine } from "./engine/create";
import type { NavMode, SiteEngine } from "./engine/SiteEngine";
import type { SiteFrameT } from "./engine/siteTransform";
import { createDrawingLayer } from "./layers/drawing.layer";
import { createModelLayer, type ModelLoadInfo } from "./layers/model.layer";
import { createOrthoLayer } from "./layers/ortho.layer";
import type { PickHit, SiteLayer } from "./layers/types";
import { ViewTools } from "./panels/ViewTools";

export type LayerGroup = "model" | "ortho" | "drawing";
export interface ModelStatus {
  url: string;
  state: "ready" | "error";
  info: ModelLoadInfo | null;
}
export interface SiteViewHandle {
  clearSelection(): void;
  reload(): void;
}
export interface SiteViewProps {
  scene: SiteScene;
  frame: SiteFrameT;
  hidden: ReadonlySet<LayerGroup>;
  onSelect(hit: PickHit | null): void;
  onModel(s: ModelStatus): void;
  /** The 3D view could not start (null once a reload starts it). */
  onFailure?(kind: "no-webgl" | "failed" | null): void;
}

/** The canvas, the engine's lifecycle, the layers from the manifest, and the view tools. */
export const SiteView = forwardRef<SiteViewHandle, SiteViewProps>(function SiteView(props, ref) {
  const { scene, frame, hidden } = props;
  const backend = useBackend();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const engine = useRef<SiteEngine | null>(null);
  const layers = useRef(new Map<string, { group: LayerGroup; layer: SiteLayer }>());
  const cbs = useRef(props);
  useEffect(() => {
    cbs.current = props;
  });
  const [generation, setGeneration] = useState(0);
  const frameKey = JSON.stringify(frame);
  const engineKey = `${frameKey}#${generation}`;
  const [failure, setFailure] = useState<{ key: string; kind: "no-webgl" | "failed" } | null>(null);
  const failed = failure?.key === engineKey ? failure.kind : null;
  const [nav, setNav] = useState<NavMode>("orbit");
  const modelUrl = scene.model ? absUrl(backend, scene.model.glb_url) : null;
  const [areas, setAreas] = useState<{ url: string; list: string[] } | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    let eng: SiteEngine;
    try {
      eng = createSiteEngine(canvas, JSON.parse(frameKey) as SiteFrameT);
    } catch (err) {
      const kind = err instanceof NoWebGlError ? "no-webgl" : "failed";
      setFailure({ key: engineKey, kind });
      cbs.current.onFailure?.(kind);
      return;
    }
    cbs.current.onFailure?.(null);
    engine.current = eng;
    const off = eng.onSelect((hit) => cbs.current.onSelect(hit));
    const map = layers.current;
    return () => {
      off();
      eng.dispose();
      if (engine.current === eng) engine.current = null;
      map.clear();
    };
  }, [frameKey, engineKey]);

  useEffect(() => {
    const eng = engine.current;
    if (!eng || !modelUrl) return;
    const layer = createModelLayer({
      url: modelUrl,
      onLoad: (info) => {
        setAreas({ url: modelUrl, list: info.areas });
        cbs.current.onModel({ url: modelUrl, state: "ready", info });
      },
      onError: () => cbs.current.onModel({ url: modelUrl, state: "error", info: null }),
    });
    layer.setVisible(!cbs.current.hidden.has("model"));
    layers.current.set(layer.id, { group: "model", layer });
    eng.addLayer(layer);
    const map = layers.current;
    return () => {
      eng.removeLayer(layer.id);
      map.delete(layer.id);
    };
  }, [modelUrl, engineKey]);

  const tileKey = JSON.stringify([
    scene.orthos.map((o) => [o.id, o.tile_url_template]),
    scene.drawings.map((d) => [d.id, d.tile_url_template]),
  ]);
  useEffect(() => {
    const eng = engine.current;
    if (!eng) return;
    const url = (rel: string) => absUrl(backend, rel);
    const { orthos, drawings } = cbs.current.scene;
    const made: Array<{ group: LayerGroup; layer: SiteLayer }> = [
      ...orthos.map((o) => ({ group: "ortho" as const, layer: createOrthoLayer(o, url) })),
      ...drawings.map((d) => ({ group: "drawing" as const, layer: createDrawingLayer(d, url) })),
    ];
    for (const m of made) {
      m.layer.setVisible(!cbs.current.hidden.has(m.group));
      layers.current.set(m.layer.id, m);
      eng.addLayer(m.layer);
    }
    const map = layers.current;
    return () => {
      for (const m of made) {
        eng.removeLayer(m.layer.id);
        map.delete(m.layer.id);
      }
    };
  }, [tileKey, engineKey, backend]);

  const hiddenKey = [...hidden].sort().join(",");
  useEffect(() => {
    for (const { group, layer } of layers.current.values()) layer.setVisible(!cbs.current.hidden.has(group));
  }, [hiddenKey]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !isTypingTarget(e.target)) engine.current?.select(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  useImperativeHandle(
    ref,
    (): SiteViewHandle => ({
      clearSelection: () => engine.current?.select(null),
      reload: () => setGeneration((g) => g + 1),
    }),
    [],
  );

  const doNav = (m: NavMode) => {
    setNav(m);
    engine.current?.setNav(m);
  };
  const doPreset = (id: PresetId) => engine.current?.setPreset(id);

  return (
    <div className="absolute inset-0" data-testid="site-view">
      <canvas key={generation} ref={canvasRef} data-testid="site-canvas" className="absolute inset-0 h-full w-full bg-bg" />
      <div className="absolute left-3 top-3 z-10">
        <ViewTools
          nav={nav}
          onNav={doNav}
          onPreset={doPreset}
          areas={areas && areas.url === modelUrl ? areas.list : []}
          disabled={failed !== null}
        />
      </div>
      {failed && (
        <div className="absolute inset-x-0 bottom-6 z-10 mx-auto w-fit max-w-md px-4">
          {failed === "no-webgl" ? (
            <Alert tone="warn" role="alert">
              This computer can&apos;t start WebGL, so the 3D view is off. The layers list still works.
            </Alert>
          ) : (
            <Alert
              tone="danger"
              actions={
                <Button size="sm" icon="refresh" onClick={() => setGeneration((g) => g + 1)}>
                  Reload view
                </Button>
              }
            >
              The 3D view could not start.
            </Alert>
          )}
        </div>
      )}
    </div>
  );
});
```

`frontend/src/site3d/SiteScreen.tsx`:
```tsx
import { useMemo, useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { useBackend } from "@/api/client";
import { absUrl, toFrameT, useSiteScene } from "@/api/siteScene";
import { Alert, Button, EmptyState, GlassPanel, Pill, Skeleton, buttonClass } from "@/ui";
import { sceneLayerRows, type ModelState } from "./layerRows";
import type { PickHit } from "./layers/types";
import { LayersPlaceholder } from "./panels/LayersPlaceholder";
import { SelectionPlaceholder } from "./panels/SelectionPlaceholder";
import { SiteView, type LayerGroup, type ModelStatus, type SiteViewHandle } from "./SiteView";

function BuildLink({ projectId }: { projectId: string }) {
  return (
    <Link to={`/p/${projectId}/models`} className={buttonClass("primary", "md")}>
      Build a plant model
    </Link>
  );
}

/** The Site 3D view, `/p/:projectId/site[/:modelId]` (spec 2026-10-03 §11; S3 replaces the placeholders). */
export function SiteScreen() {
  const { projectId = "", modelId } = useParams();
  const backend = useBackend();
  const { scene, error, loading, reload } = useSiteScene(projectId, modelId ?? null);
  const view = useRef<SiteViewHandle>(null);
  const [hidden, setHidden] = useState<ReadonlySet<LayerGroup>>(() => new Set());
  const [selected, setSelected] = useState<PickHit | null>(null);
  const [model, setModel] = useState<ModelStatus | null>(null);
  const [viewFailed, setViewFailed] = useState(false);
  const frame = useMemo(() => (scene ? toFrameT(scene.frame) : null), [scene]);
  const modelUrl = scene?.model ? absUrl(backend, scene.model.glb_url) : null;
  const modelState: ModelState = !modelUrl ? "none" : model?.url === modelUrl ? model.state : "loading";
  const items = model?.url === modelUrl ? (model?.info?.items ?? 0) : 0;

  const toggle = (id: string, visible: boolean) =>
    setHidden((prev) => {
      const next = new Set(prev);
      if (visible) next.delete(id as LayerGroup);
      else next.add(id as LayerGroup);
      return next;
    });

  let body;
  if (loading) {
    body = (
      <div role="status" aria-label="Loading site" className="grid h-full place-items-center">
        <Skeleton className="h-40 w-40 rounded-card" />
      </div>
    );
  } else if (!scene) {
    body = (
      <div className="grid h-full place-items-center p-6">
        <Alert
          tone="danger"
          title="The site could not load."
          actions={
            <Button size="sm" icon="refresh" onClick={reload}>
              Try again
            </Button>
          }
        >
          {error}
        </Alert>
      </div>
    );
  } else if (!frame) {
    body = (
      <EmptyState icon="cube" title="Nothing to place yet" action={<BuildLink projectId={projectId} />} className="h-full">
        Import a map, a point cloud or a drawing with coordinates, or build a plant model. They show here in 3D.
      </EmptyState>
    );
  } else {
    body = (
      <>
        <SiteView
          ref={view}
          scene={scene}
          frame={frame}
          hidden={hidden}
          onSelect={setSelected}
          onModel={setModel}
          onFailure={(kind) => setViewFailed(kind !== null)}
        />
        <div className="absolute left-[64px] top-3 z-10">
          <LayersPlaceholder rows={sceneLayerRows(scene, modelState, items)} hidden={hidden} onToggle={toggle} />
        </div>
        {selected && (
          <div className="absolute right-3 top-3 z-10">
            <SelectionPlaceholder hit={selected} onClear={() => view.current?.clearSelection()} />
          </div>
        )}
        {modelState === "none" && (
          <div className="pointer-events-none absolute inset-0 z-[5] grid place-items-center p-6">
            <GlassPanel variant="float" className="pointer-events-auto max-w-sm px-6">
              <EmptyState icon="cube" title="No plant model yet" action={<BuildLink projectId={projectId} />} className="py-8">
                One run reads the drawings and the point cloud and builds every item of the plant. It shows here over
                the maps and drawings.
              </EmptyState>
            </GlassPanel>
          </div>
        )}
        {modelState === "loading" && !viewFailed && (
          <div role="status" className="absolute inset-x-0 bottom-6 z-10 mx-auto w-fit">
            <Pill tone="accent" live>
              Loading the plant model
            </Pill>
          </div>
        )}
        {modelState === "error" && !viewFailed && (
          <div className="absolute inset-x-0 bottom-6 z-10 mx-auto w-fit max-w-md px-4">
            <Alert
              tone="danger"
              actions={
                <Button size="sm" icon="refresh" onClick={() => view.current?.reload()}>
                  Reload view
                </Button>
              }
            >
              The plant model could not load.
            </Alert>
          </div>
        )}
      </>
    );
  }

  return (
    <div className="relative h-full w-full overflow-hidden" data-testid="site-screen">
      <h1 className="sr-only">Site 3D</h1>
      {body}
    </div>
  );
}
```

Notes for the implementer:
- `isTypingTarget` is exported from `@/ui` (`ui/index.ts` re-exports it from `keymap`).
- `MenuButton` passes `variant`/`disabled` through to `IconButton`. If `IconButton` rejects `variant`, drop that prop.
- After "Reload view", the model state is keyed by URL, so it shows "Loading" until the new layer reports.

- [ ] **Step 5: Wire the route**

`frontend/src/app/lazyScreens.tsx`, add after the `AssetModelsScreen` export:
```tsx
// The Site 3D view (spec 2026-10-03 §11): three, GLTFLoader and the drape; lazy like the other 3D screens.
export const SiteScreen = lazy(() => import("@/site3d/SiteScreen").then((m) => ({ default: m.SiteScreen })));
```

`frontend/src/routes/projectRoutes.tsx`: add `SiteScreen` to the import from `@/app/lazyScreens`, and add after the `models/:modelId` entry:
```tsx
  // The Site 3D view (plant model S1): the plant model over the draped ortho and drawings. No tab and
  // no nav entry in G1; S3 adds "Open in site" / "Open in 3D" entry points.
  {
    path: "site",
    element: (
      <Later>
        <SiteScreen />
      </Later>
    ),
  },
  {
    path: "site/:modelId",
    element: (
      <Later>
        <SiteScreen />
      </Later>
    ),
  },
```

`frontend/src/app/routeModel.ts`:
- In `layoutOf`, add as its first line: `if (tab === "site") return "fullbleed"; // plant model S1: the Site 3D view`.
- Above `export interface RouteInfo`, add:
  ```ts
  /** Project pages with neither a tab nor a More-menu entry, named for the breadcrumb. */
  const PROJECT_PAGES: Record<string, string> = { site: "Site 3D" };
  ```
- In `routeInfo`'s project branch, change `page: tab?.label ?? secondary?.label ?? null,` to:
  ```ts
      page: tab?.label ?? secondary?.label ?? PROJECT_PAGES[seg] ?? null,
  ```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `pnpm -C frontend exec vitest run src/site3d src/api/siteScene.test.ts src/app/routeModel.test.ts src/routes/routes.test.tsx src/app/lazyScreens.test.tsx`
Expected: all PASS. Then run `pnpm -C frontend lint` and expect no errors. `check-tokens` stays green: the only arbitrary values are spacing (`left-[64px]`, `z-[5]`, `grid-cols-[auto_1fr]`), none of which the rules cover.

- [ ] **Step 7: Commit**

```
pnpm -C frontend exec prettier --write src/site3d src/app/lazyScreens.tsx src/app/lazyScreens.test.tsx src/routes/projectRoutes.tsx src/routes/routes.test.tsx src/app/routeModel.ts src/app/routeModel.test.ts
git add frontend/src/site3d/layerRows.ts frontend/src/site3d/layerRows.test.ts frontend/src/site3d/panels/ViewTools.tsx frontend/src/site3d/panels/LayersPlaceholder.tsx frontend/src/site3d/panels/SelectionPlaceholder.tsx frontend/src/site3d/SiteView.tsx frontend/src/site3d/SiteScreen.tsx frontend/src/site3d/SiteScreen.test.tsx frontend/src/app/lazyScreens.tsx frontend/src/app/lazyScreens.test.tsx frontend/src/routes/projectRoutes.tsx frontend/src/routes/routes.test.tsx frontend/src/app/routeModel.ts frontend/src/app/routeModel.test.ts
git commit -m "feat(site3d): Site 3D screen with layers, selection and empty states" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 10: e2e: open the Site 3D view on the Prism mock with the fixture GLB

**Files:**
- Create: `frontend/e2e/fixtures/siteScene.ts`
- Create: `frontend/e2e/site.spec.ts`

**Interfaces:**
- Consumes: `site-plant.glb` (T8); `P`, `MODEL` (`e2e/fixtures/assetModels.ts`); `SWIFTSHADER` (`e2e/fixtures/cloudWorkspace.ts`); the route and screen (T9).
- Produces: the e2e coverage S3's entry-point tests build on.

- [ ] **Step 1: Write the fixture routes**

`frontend/e2e/fixtures/siteScene.ts`:
```ts
import { readFileSync } from "node:fs";
import type { Page } from "@playwright/test";
import { MODEL, P } from "./assetModels";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
};
const GLB = readFileSync(new URL("./site-plant.glb", import.meta.url));

export const SITE_URL = `/p/${P}/site/${MODEL}`;

/** A manifest with the Al-Zour frame and, optionally, the two-item fixture plant (plan S1 T10). */
export function sceneJson(withModel: boolean) {
  return {
    frame: {
      crs: { epsg: 32639, wkt: null },
      origin_crs: [244338.089, 3179515.69],
      plant_north_deg: 17.9991,
      datum: { label: "HPFS", el_m: 100 },
    },
    model: withModel
      ? {
          id: MODEL,
          version: 1,
          glb_url: `/api/v1/projects/${P}/asset-models/${MODEL}/versions/1/glb`,
          csv_url: `/api/v1/projects/${P}/asset-models/${MODEL}/versions/1/csv`,
          kind: "plant",
        }
      : null,
    orthos: [],
    clouds: [],
    drawings: [],
    photos: { count: 0, url: null },
    findings: { count: 0, url: `/api/v1/projects/${P}/map-workspace/findings` },
  };
}

/** Serves the manifest and the GLB; everything else falls through to the Prism mock. */
export async function routeSiteScene(page: Page, { withModel }: { withModel: boolean }): Promise<void> {
  await page.route(
    (u) => u.pathname === `/api/v1/projects/${P}/site-scene`,
    (route) =>
      route.request().method() === "OPTIONS"
        ? route.fulfill({ status: 204, headers: CORS })
        : route.fulfill({
            status: 200,
            contentType: "application/json",
            headers: CORS,
            body: JSON.stringify(sceneJson(withModel)),
          }),
  );
  await page.route(
    (u) => u.pathname === `/api/v1/projects/${P}/asset-models/${MODEL}/versions/1/glb`,
    (route) => route.fulfill({ status: 200, contentType: "model/gltf-binary", headers: CORS, body: GLB }),
  );
}
```

- [ ] **Step 2: Write the spec**

`frontend/e2e/site.spec.ts`:
```ts
import { expect, test } from "@playwright/test";
import { SWIFTSHADER } from "./fixtures/cloudWorkspace";
import { routeSiteScene, SITE_URL } from "./fixtures/siteScene";

test.use(SWIFTSHADER);

// S1 adds no entry point (plan ruling R12): these open the deep link. S3's entry-point tests reach it
// through the Main-navigation "Asset models" link.

test("open the site view: the plant model loads and a click selects an item", async ({ page }) => {
  const pageErrors: string[] = [];
  page.on("pageerror", (e) => pageErrors.push(e.message));
  await page.emulateMedia({ reducedMotion: "reduce" }); // presets jump, so the click lands on the tank
  await routeSiteScene(page, { withModel: true });
  await page.goto(SITE_URL);
  await expect(page.getByTestId("site-screen")).toBeVisible();
  const layers = page.getByTestId("site-layers");
  await expect(layers).toContainText("2 items", { timeout: 20_000 });
  await page.getByRole("button", { name: "Plan view" }).click();
  await page.getByTestId("site-canvas").click();
  const card = page.getByTestId("site-selection");
  await expect(card).toContainText("LNG tank");
  await expect(card).toContainText("20-T-0001");
  await page.keyboard.press("Escape");
  await expect(card).toHaveCount(0);
  expect(pageErrors).toEqual([]);
});

test("no plant model yet: the site opens with an empty state that leads to Asset models", async ({ page }) => {
  const pageErrors: string[] = [];
  page.on("pageerror", (e) => pageErrors.push(e.message));
  await routeSiteScene(page, { withModel: false });
  await page.goto(SITE_URL);
  await expect(page.getByText("No plant model yet")).toBeVisible();
  await expect(page.getByTestId("site-layers")).toContainText("None yet");
  await page.getByRole("link", { name: "Build a plant model" }).click();
  await expect(page).toHaveURL(/\/models$/);
  expect(pageErrors).toEqual([]);
});

test("no WebGL: a notice and the layers list, never an uncaught error", async ({ browser }) => {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  const pageErrors: string[] = [];
  page.on("pageerror", (e) => pageErrors.push(e.message));
  await page.addInitScript(() => {
    HTMLCanvasElement.prototype.getContext = () => null;
  });
  await routeSiteScene(page, { withModel: true });
  await page.goto(SITE_URL);
  await expect(page.getByRole("alert")).toContainText(/3D view is off/i);
  await expect(page.getByTestId("site-layers")).toBeVisible();
  expect(pageErrors).toEqual([]);
  await ctx.close();
});
```

- [ ] **Step 3: Run it**

Run (PowerShell, from the worktree root):
```
$env:E2E_WEB_PORT=5390; $env:E2E_MOCK_PORT=5391; pnpm -C frontend exec playwright test e2e/site.spec.ts
```
Expected: 3 passed. If the click misses (no `site-selection`), check that the plan preset ran before the click: `reducedMotion: "reduce"` makes `goTo` instant through `isReducedMotion()`. Do not add a sleep.

- [ ] **Step 4: Commit**

```
git add frontend/e2e/fixtures/siteScene.ts frontend/e2e/site.spec.ts
git commit -m "test(e2e): open the Site 3D view, select an item, empty and no-WebGL states" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 11: Full gate and walkthrough

**Files:** none new. This task fixes only what the gate finds, in the files of earlier tasks.

- [ ] **Step 1: Run the full gate** (PowerShell, from `E:\Dev\Yolo\app\.claude\worktrees\pm-s1`)

```
pnpm -C contract check
cd backend; E:\Dev\Yolo\app\backend\.venv\Scripts\python.exe -m ruff check .; E:\Dev\Yolo\app\backend\.venv\Scripts\python.exe -m ruff format --check .; E:\Dev\Yolo\app\backend\.venv\Scripts\python.exe -m pytest; cd ..
pnpm -C frontend lint
pnpm -C frontend test
pnpm -C frontend build
$env:E2E_WEB_PORT=5390; $env:E2E_MOCK_PORT=5391; pnpm -C frontend e2e
if (Test-Path frontend/src-tauri/binaries/kestrel-backend-*.exe) { cargo test --manifest-path frontend/src-tauri/Cargo.toml }
```
Expected:
- every command exits 0;
- `pytest` includes `tests/test_site_scene.py` and `tests/test_contract.py` passing;
- `vite build` emits a separate chunk for `SiteScreen` (check the build output for a `SiteScreen-*.js` asset), so the 3D code stays lazy;
- `cargo test` runs only when the frozen sidecar is present.

- [ ] **Step 2: Check the budgets by reading the code once more**

Confirm by grep, and record the results in the unit ledger:
```
Select-String -Path frontend/src/site3d/engine/tiles.ts -Pattern "MAX_LIVE_TILES = 256|MAX_IN_FLIGHT = 6|generateMipmaps = false"
Select-String -Path backend/app/asset_models/site_scene.py -Pattern "MAX_LIST = 200|limit\(MAX_LIST\)|\[:MAX_LIST\]"
```
Expected: all patterns found.

- [ ] **Step 3: Write the operator walkthrough** (`.superpowers/sdd/pm-common/walkthroughs/s1.md` in the worktree; the coordinator collects it)

```
S1, Site 3D core. Not reachable from the installed app's navigation until S3 adds "Open in site" and "Open in 3D".
To try it now, in the browser dev build:
1. pnpm -C frontend dev, with the backend running; open a project that has a map (ortho) in UTM.
2. Go to http://127.0.0.1:1420/p/<projectId>/site. The Layers panel lists Maps (1 map), and the ortho appears draped flat, framed from the south-west. Expect "No plant model yet" with "Build a plant model".
3. Zoom in on the ortho. It sharpens as you go (tiles load nearer and finer). Drag to orbit; choose Pan and drag to move along the ground.
4. Choose Fly, then hold W, A, S, D (Q and E for down and up, Shift for faster).
5. Plan view looks straight down with plant north up. Fit to site returns to the overview.
6. Switch Maps off in the Layers panel, and the ortho hides; switch it on again.
7. With a plant model built (after A1 and R1 land): /p/<projectId>/site opens it over the ortho. Click an item: its name, tag, type, area, height source and flags show top right. Escape clears it.
8. A project with nothing placed shows "Nothing to place yet". A computer without WebGL shows "This computer can't start WebGL, so the 3D view is off".
```

- [ ] **Step 4: Commit the walkthrough** (only if the gate changed files, commit those first with their own message)

```
git add .superpowers/sdd/pm-common/walkthroughs/s1.md
git commit -m "docs: S1 Site 3D walkthrough" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```
If `.superpowers/` is git-ignored in the worktree, skip the commit and hand the walkthrough text to the coordinator in the unit report instead. Do not merge, push, build an installer or run `/wrapup`.

---

## Self-review (done while writing)

- **Spec coverage:**

  | Requirement | Task |
  | --- | --- |
  | §10 `site-scene` (frame, models with ready GLBs, orthos, clouds in CRS, georeferenced drawings, photos, findings, URL templates, bounded lists) | T2 |
  | §11 route, lazy | T9 |
  | §11 engine with log depth, plant origin, `SiteTransform` on golden vectors | T3, T6 |
  | §11 model layer: GLTFLoader + meshopt, colour-by (5 modes), see-through, wireframe, cut, outline | T8 |
  | §11 ortho layer: tile grid drape, quadtree LOD, ≤ 64 MB, ≤ 256 tiles | T5, T7 |
  | §11 drawing layer: at grade, opacity | T7 |
  | §11 view tools: orbit, pan, fly, presets fit/plan/area | T6, T9 |
  | Picking and selection | T6, T8, T9 |
  | §13 S1 tests: vitest transform, layer modules and panels; Playwright with a fixture plant | T3–T10 |
  | Review Focus #5 | T9 |

  Panels, entry points, measure and screenshot are S3's; cloud, water, sky, photos and findings are S2's.
- **Placeholders:** none; every code step has its code.
- **Names:**
  - Layer ids: `model`, `ortho:<id>`, `drawing:<id>`, used the same in T7, T8, T9 and the T9 tests.
  - `SiteEngine` members used by layers (`tiles`, `drapeCount`, `viewportHeight`, `setContentBox`, `setPresetBox`, `clearPresets`, `addPickable`, `removePickable`, `onSelect`, `requestRender`) are all defined in T6.
  - `absUrl`, `toFrameT`, `SceneOrtho` and `SceneDrawing` come from T4.
