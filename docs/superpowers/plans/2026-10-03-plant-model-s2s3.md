# Plant model generator, Site 3D layers (S2) and panels (S3) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. This file holds two units. **Part S2** and **Part S3** are built by different controllers in different worktrees; a controller runs only its own part.

**Goal:** S2 puts the point cloud, water, sky, posed photos and existing findings into the Site 3D view; S3 gives the view its Aero glass panels (layers, register, item, item editor, run bar), its entry points from the rest of the app, and four deferred M1 UI fixes.

**Architecture:**
- S2 adds one module per layer under `frontend/src/site3d/layers/` (`cloud.layer.ts`, `water.layer.ts`, `sky.layer.ts`, `photos.layer.ts`, `findings.layer.ts`). Each implements S1's `SiteLayer` plus a `StatusCell` so the UI can say why a layer is off. Layers reach S1's renderer, scene and camera through one adapter (`layers/s1Bridge.ts`), so a rename in S1 is a one-file change. A React hook (`useSiteExtraLayers`) creates, attaches and detaches them for `SiteScreen`.
- S3 adds the panels under `frontend/src/site3d/panels/`, a composition component (`SitePanels.tsx`) that replaces S1's placeholders, plant-item API wrappers (`frontend/src/api/plantItems.ts`), entry links (`frontend/src/site3d/entry/`), and small additive changes to the M1 workspace, the Map and Cloud workspaces and the Run tab.
- Neither unit touches `frontend/src/assetmodels/viewer/engine.ts` (P1 builds on it).

**Tech Stack:** React 18 + TS, three 0.180.0 (`Water`, `Sky` from `three/examples/jsm/objects/`), potree-core 2.0.15, react-router-dom 6.30 (data router: `useBlocker`), zustand, Vitest + Testing Library (jsdom), Playwright on the Prism mock. Fixture GLBs are written with the backend venv (trimesh; A1's `assemble_glb` for S3). No new packages.

**Spec:** `docs/superpowers/specs/2026-10-03-plant-model-generator-design.md` (§11 Site 3D view, §12 budget, §13 testing, §15 amendments). **Index (binding):** `docs/superpowers/plans/2026-10-03-plant-model.md`.

## Units, worktrees, merge position

| Unit | Worktree / branch | Cut after | Merge position | e2e ports (WEB / MOCK) |
| --- | --- | --- | --- | --- |
| S2 | `.claude/worktrees/pm-s2` / `task/pm-s2` | S1 merged on `main` | batch 3, **before S3** | 5410 / 5411 |
| S3 | `.claude/worktrees/pm-s3` / `task/pm-s3` | S1 and A1 merged on `main` | batch 3, **after S2** (Tasks S3-9 and S3-11 wait for S2: `WAITING: S2`) | 5420 / 5421 |

S3's Tasks 1–8 and 10 do not need S2. Task S3-9 (wiring) and Task S3-11 (e2e) start with `git merge main` once S2 is on `main`; until then the controller runs Task S3-10 and logs `WAITING: S2`.

## Interfaces provided

**S2** (`frontend/src/site3d/layers/`):

```ts
// status.ts
export type LayerStatus =
  | { kind: "loading" }
  | { kind: "ready"; note?: string }
  | { kind: "unavailable"; reason: string }
  | { kind: "error"; message: string };
export class StatusCell { constructor(initial?: LayerStatus); get(): LayerStatus; set(s: LayerStatus): void; subscribe(cb: (s: LayerStatus) => void): () => void }
export interface StatusLayer extends SiteLayer { readonly status: StatusCell }
export function statusText(s: LayerStatus, visible: boolean): string

// s1Bridge.ts
export interface EngineParts { renderer: THREE.WebGLRenderer; scene: THREE.Scene; camera: THREE.PerspectiveCamera; canvas: HTMLCanvasElement; requestRender(): void }
export function partsOf(e: SiteEngine): EngineParts

// sceneTypes.ts
export type SiteScene = components["schemas"]["SiteScene"];
export type SiteCloud = SiteScene["clouds"][number];

// sceneMatrix.ts
export function siteToSceneMatrix(f: SiteFrameT, zOffsetM: number): THREE.Matrix4   // site CRS (x, y, cloud z) → scene

// effects.ts, sun.ts, screenPick.ts
export function isReducedEffects(): boolean
export function onEffectsChange(cb: () => void): () => void
export const SUN_ELEVATION_DEG = 52; export const SUN_AZIMUTH_DEG = 200;
export function sunDirection(elevDeg?: number, azDeg?: number): THREE.Vector3
export function screenNearest(points: Float32Array, camera: THREE.Camera, rect: { left: number; top: number; width: number; height: number }, clientX: number, clientY: number, maxPx?: number): number | null

// cloudHost.ts
export interface CloudHost { load(url: string, rm: OctreeRequestManager): Promise<PointCloudOctree>; add(p: PointCloudOctree): void; remove(p: PointCloudOctree): void; budget(): number; setBudget(n: number): void; update(camera: THREE.Camera, renderer: THREE.WebGLRenderer, frame: number): boolean }
export function createCloudHost(make?: () => Promise<PotreeLike>, budget?: number): CloudHost

// cloud.layer.ts
export const CANT_PLACE: string;   // "Can't place this cloud: it is in a different coordinate system from the site."
export const NO_FRAME: string;
export type CloudColour = "rgb" | "elevation" | "intensity";
export function yUpElevation(src: string): string
export interface CloudLayer extends StatusLayer { readonly cloudId: string; setColour(c: CloudColour): void; box(): THREE.Box3 | null }
export function createCloudLayer(o: { cloud: SiteCloud; frame: SiteFrameT | null; baseUrl: string; token: string; host: CloudHost }): CloudLayer

// shoreField.ts
export interface Box2 { minX: number; minZ: number; maxX: number; maxZ: number }
export const SHORE_GRID = 512; export const SHORE_MAX_M = 64;
export function rasterTriangles(tris: ArrayLike<number>, box: Box2, size: number): Uint8Array
export function chamferDistance(source: Uint8Array, size: number, cellM: number): Float32Array
export function shoreField(land: ArrayLike<number>, box: Box2, size?: number): Uint8Array | null

// water.layer.ts
export const NO_SEA: string; export const NO_MODEL: string; export const WATER_NORMALS_URL: string;
export function collectTriangles(root: THREE.Object3D, match: (o: THREE.Object3D) => boolean): { tris: number[]; maxY: number; box: Box2 | null; meshes: THREE.Mesh[] }
export function flatGeometry(tris: ArrayLike<number>): THREE.BufferGeometry
export interface WaterLayer extends StatusLayer { setModel(root: THREE.Object3D | null): void }
export function createWaterLayer(o?: { normals?: () => THREE.Texture; reduced?: () => boolean; sun?: () => THREE.Vector3 }): WaterLayer

// sky.layer.ts
export interface SkyLayer extends StatusLayer { sun(): THREE.Vector3 }
export function createSkyLayer(o?: { background?: () => THREE.Color }): SkyLayer

// photos.layer.ts
export const PHOTO_GLYPH_CAP = 2000;
export function photosCloudId(url: string | null | undefined): string | null
export function capIndices(idx: readonly number[], cap: number): number[]
export function viewDirSite(yawDeg: number | null, pitchDeg: number | null): THREE.Vector3
export interface PhotosLayer extends StatusLayer { hit(clientX: number, clientY: number): { imageId: string } | null }
export function createPhotosLayer(o: { api: ApiClient; projectId: string; frame: SiteFrameT | null; scene: SiteScene }): PhotosLayer

// findings.layer.ts
export const MAP_PIN_CAP = 5000;
export function geometryPoint(g: { type: string; coordinates: unknown }): [number, number] | null
export function siteExtent(scene: SiteScene, frame: SiteFrameT): [number, number, number, number]
export interface FindingsLayer extends StatusLayer { hit(clientX: number, clientY: number): { findingId: string } | null }
export function createFindingsLayer(o: { api: ApiClient; projectId: string; frame: SiteFrameT | null; scene: SiteScene; scale?: readonly SeverityLevel[] }): FindingsLayer

// useSiteExtraLayers.ts
export type ExtraGroup = "Point clouds" | "Environment" | "Data";
export interface ExtraLayerRow { id: string; label: string; group: ExtraGroup; layer: StatusLayer; visible: boolean }
export interface ExtraLayers { rows: ExtraLayerRow[]; setVisible(id: string, v: boolean): void; setCloudColour(c: CloudColour): void; cloudColour: CloudColour; budget: number; setBudget(n: number): void; photos: PhotosLayer | null; findings: FindingsLayer | null }
export function useSiteExtraLayers(o: { engine: SiteEngine | null; scene: SiteScene | null; frame: SiteFrameT | null; projectId: string; modelRoot: THREE.Object3D | null }): ExtraLayers
export function useExtraLayerClicks(engine: SiteEngine | null, extra: ExtraLayers, on: { photo(imageId: string): void; finding(findingId: string): void }): void
export function useModelRoot(layer: ModelRootSource | null): THREE.Object3D | null
export function ExtraLayerStatus(props: { rows: readonly ExtraLayerRow[] }): JSX.Element   // sr-only; S3 replaces it
```

**S3:**

```ts
// frontend/src/api/plantItems.ts
export type AssetItemRow = S["AssetItemRow"]; export type AssetItemPage = S["AssetItemPage"]; export type AssetItem = S["AssetItem"];
export type CatalogueEntry = S["AssetModelCatalogue"]["items"][number]; export type SiteModelPackage = S["SiteModelPackageList"]["items"][number];
export const ITEMS_PAGE = 200;
export interface ItemQuery { q?: string; type?: string; area?: string; flag?: string }
export function listAssetItems(api: ApiClient, projectId: string, assetModelId: string, version: number, query: ItemQuery, cursor: string | null, signal?: AbortSignal): Promise<AssetItemPage>
export function getCatalogue(api: ApiClient): Promise<CatalogueEntry[]>
export function listRunPackages(api: ApiClient, projectId: string, assetModelId: string, runId: string): Promise<SiteModelPackage[]>

// frontend/src/site3d/entry/links.ts
export interface SiteAt { x: number; y: number; epsg: number | null }
export const MODEL_VIEW = "view=model";
export function siteHref(projectId: string, modelId?: string | null, at?: SiteAt | null): string
export function readSiteAt(search: string): SiteAt | null
export function modelDetailsHref(projectId: string, modelId: string): string
// frontend/src/site3d/entry/useOpenSiteAction.ts
export function useOpenSiteAction(projectId: string, where: () => SiteAt | null): void

// frontend/src/site3d/panels/
export function controlsOf(engine: SiteEngine, model: ModelLayer): SiteControls            // engineBridge.ts
export function LayersPanel(p: LayersPanelProps): JSX.Element
export function useRegister(projectId: string, modelId: string, version: number, query: ItemQuery): RegisterState
export function RegisterPanel(p: RegisterPanelProps): JSX.Element
export function ItemPanel(p: ItemPanelProps): JSX.Element
export function fieldsFromSchema(schema: unknown): FieldSpec[]                               // itemEdit.ts
export function ItemEditor(p: ItemEditorProps): JSX.Element
export function useDiscardGuard(dirty: boolean, name: string): { guard(action: () => void): void; dialog: ReactNode }
export function RunBar(p: { projectId: string; model: AssetModel }): JSX.Element | null
export function SitePanels(p: SitePanelsProps): JSX.Element

// frontend/src/assetmodels/run/runView.ts (M1 fix)
export const DEFAULT_MAX_STEPS = 80;
export function maxSteps(run: Pick<AssetModelRun, "mode"> & { limits?: { max_calls?: number | null } | null }): number | null
```

## Interfaces consumed

From **F0** (contract; Task 1 of each part confirms the generated names): `components["schemas"]["SiteScene"]` with `frame`, `model {id, version, glb_url, csv_url, kind}`, `orthos[]`, `clouds[] {id, name, octree_url, crs_epsg, same_crs, z_offset_m}`, `drawings[]`, `photos {count, url}`, `findings {count, url}`; `AssetItemRow`, `AssetItemPage {items, next_cursor}`, `AssetItem` (the spec item), `ItemFlag`, `ItemFootprint`, `AssetModelCatalogue {items: [{type, family, doc, default_height_m, params_schema}]}`, `SiteModelPackageList {items}`, `AssetModel.kind`, `AssetModelRun.packages?`, `AssetModelRunStart.limits?`; operations `listAssetModelItems`, `getAssetModelItem`, `getAssetModelCatalogue`, `listAssetModelRunPackages`, `getSiteScene`.

From **S1** (`frontend/src/site3d/`), binding names from the index plus the accessors S2/S3 need. Task 1 of each part reads S1's real code and adapts **only** `s1Bridge.ts` / `engineBridge.ts` and test plumbing:
- `engine/siteTransform.ts`: `SiteFrameT`, `plantToSite`, `siteToPlant`, `plantToScene(f, e, n, el)`, `siteToScene(f, x, y, z)` where `z` is a plant EL in metres (scene `y = z - datum.el_m`).
- `engine/SiteEngine.ts`: `SiteEngine` with `addLayer`, `removeLayer`, `flyTo(box)`, `setPreset`, `pick`, `onSelect(cb)`, `dispose`; and the live objects (`three: {renderer, scene, camera, canvas}` or S1's equivalent) and `requestRender()`. Layers' `update(dt, camera)` is called once per rendered frame with `dt` in seconds.
- `layers/types.ts`: `SiteLayer`.
- `layers/model.layer.ts`: the model layer with `root()`, `onLoaded(cb)`, `load(url, {keepCamera})`, `select(node)`, `boxOf(node)`, `setColourBy(mode)`, `setOpacity(o)` (or S1's equivalents).
- `api/siteScene.ts`: `useSiteScene(projectId, modelId?)`, `getAssetItem(...)`.
- `SiteScreen.tsx`: the screen with its placeholders.

From **A1** (S3): `assemble_glb(spec)` (fixture GLBs), the items/csv routes behind `listAssetModelItems` / `getAssetModelItem`.

From **existing code** (verified on `main` at e7c53097): `clouds/viewer/requestManager.ts` (`makeRequestManager`, `metadataUrl`), `clouds/viewer/budget.ts` (`BUDGETS`, `readBudget`, `writeBudget`), `clouds/viewer/materialOptions.ts` (`usesNewFormat`), `clouds/viewer/overlay.ts` (`tokenRgb`, `tokenColor`), `clouds/viewer/dispose.ts` (`disposePointsGeometries`), `api/cloudCameras.ts` (`getCloudCameras`), `api/mapFindings.ts` (`listMapFindingsInView`), `api/cloudFindings.ts` (`listCloudPins`, `pinCapNote`), `findings/links.ts` (`findingPath`), `api/assetModels.ts` (`getVersion`, `createVersion`), `assetmodels/run/useLiveRun.ts`, `assetmodels/run/runText.ts` (`tokensText`), `assetmodels/useAssetModels.ts` (`useAssetModelList`), `app/routeActions.ts` (`useProvideRouteActions`), `store/jobs.ts` (`useJobsStore`, `isActiveJob`), `@contract/client` (`assetModelGlbUrl`, `drawingThumbnailUrl`), `ui/*` primitives, `ui/motion.ts` (`isReducedMotion`, `useReducedMotion`), `ui/severityScale.ts` (`DEFAULT_SEVERITY_SCALE`, `severityOf`), `three/examples/jsm/objects/Water.js`, `three/examples/jsm/objects/Sky.js`.

## Budget

- **Background jobs:** none new. S3's item editor saves through the existing `createVersion`, which starts the existing `asset_model_glb` job; the panel follows it through `useJobsStore` and never blocks.
- **Bounded reads (S2):** one `Potree` for all clouds, point budget from the clouds setting (`kestrel.clouds.pointBudget`, default 3 000 000, choices 1/2/3/5/8 M); camera glyphs ≤ 2 000 instanced (one `getCloudCameras` read, ≤ 20 000 rows, evenly sampled); map findings ≤ 5 000 (one `listMapFindingsInView` read over the site extent) plus ≤ 500 pins per same-CRS cloud (`listCloudPins`); shore distance field 512 × 512 computed once per model load on the main thread (≤ 1 MB transient, a 256 KB texture); water mirror target 512 × 512 at full effects only; one 249 KB normals texture.
- **Bounded reads (S3):** register pages of 200 rows (contract cap 500) by cursor; search debounced 120 ms and superseded requests aborted; run packages ≤ 64 rows polled every 2 s only while a run is `running`; the base version's spec read once per save; the catalogue read once per screen.

## Shared-file touches

| File | Owner | Unit | Anchor | Additive change |
| --- | --- | --- | --- | --- |
| `frontend/src/site3d/SiteScreen.tsx` | S1 | S2 | after the engine, scene, frame and model layer exist | `useSiteExtraLayers`, `useExtraLayerClicks`, `useModelRoot`, `<ExtraLayerStatus>` |
| `frontend/src/site3d/SiteScreen.tsx` | S1 | S3 | S1's placeholder elements | replaced by `<SitePanels …/>`; S2's `<ExtraLayerStatus>` removed (its rows go to the Layers panel) |
| `frontend/src/site3d/engine/SiteEngine.ts` | S1 | S2 (only if missing) | class body | a `three` getter and `requestRender()` |
| `frontend/src/site3d/layers/model.layer.ts` | S1 | S2/S3 (only if missing) | the returned layer object | `root()`, `onLoaded(cb)`, `select(node)`, `boxOf(node)`, `load(url, {keepCamera})`, `setColourBy(mode)` |
| `frontend/public/textures/waternormals.jpg` + `LICENSE-three.txt` | new | S2 | — | three r180 example texture (MIT), source and sha256 recorded |
| `frontend/src/assetmodels/run/runView.ts` | M1 | S3 | `MAX_STEPS` | `maxSteps(run)`; `stepText`/`stepShare` use it |
| `frontend/src/assetmodels/viewer/ModelViewer.tsx` | M1 | S3 | the load rejection and `notice` | stale label on a failed swap |
| `frontend/src/assetmodels/workspace/ViewTools.tsx` | M1 | S3 | the Orbit `ToolButton` | an honest mode indicator |
| `frontend/src/assetmodels/workspace/AssetModelWorkspace.tsx` | M1 | S3 | top of `AssetModelWorkspace()`; the Download glass group; the root `div` | plant redirect, "Open in site" button, `<ListReloadNotice>` |
| `frontend/src/assetmodels/run/RunTab.tsx` | M1 | S3 | after `run.summary` | "Open in site" link for a finished plant run |
| `frontend/src/mapws/MapWorkspace.tsx` | M | S3 | `WorkspaceBody`, after `useWorkspaceStores()` | `useOpenSiteAction(...)` |
| `frontend/src/clouds/workspace/CloudWorkspace.tsx` | C | S3 | `ReadyWorkspace`, after `const viewer = useRef…` | `useOpenSiteAction(...)` |
| `frontend/e2e/site3d-env.spec.ts` | S2 | S3 | the "Layer status" locator | points at the Layers panel; assertions kept |

The P1 coordinator (app-e5) is pinged before S3 merges (it touches `frontend/src/assetmodels/`).

## Tests

- **S2 (added):** `src/site3d/layers/s1Bridge.test.ts`, `status.test.ts`, `sceneMatrix.test.ts`, `sun.test.ts`, `screenPick.test.ts`, `cloudHost.test.ts`, `cloud.layer.test.ts` (incl. **"other crs"**, index Review Focus 2), `sky.layer.test.ts`, `shoreField.test.ts`, `water.layer.test.ts`, `photos.layer.test.ts`, `findings.layer.test.ts`, `useSiteExtraLayers.test.tsx`; `src/test/fakeSiteEngine.ts`, `src/test/siteSceneFixtures.ts`; `e2e/site3d-env.spec.ts`, `e2e/fixtures/siteEnv.ts`, `e2e/fixtures/make_site_env.py`, `e2e/fixtures/site-env.glb`.
- **S3 (added):** `src/api/plantItems.test.ts`, `src/assetmodels/run/runView.test.ts`, `src/assetmodels/workspace/ListReloadNotice.test.tsx`, `src/assetmodels/useAssetModels.test.tsx`, `src/site3d/entry/links.test.ts`, `src/site3d/entry/useOpenSiteAction.test.tsx`, `src/site3d/panels/engineBridge.test.ts`, `layerRows.test.ts`, `LayersPanel.test.tsx`, `useRegister.test.tsx`, `RegisterPanel.test.tsx`, `ItemPanel.test.tsx`, `itemEdit.test.ts`, `ItemEditor.test.tsx`, `useDiscardGuard.test.tsx`, `RunBar.test.tsx`, `SitePanels.test.tsx`; `e2e/site3d-panels.spec.ts`, `e2e/fixtures/plantSite.ts`, `e2e/fixtures/make_plant_site.py`, `e2e/fixtures/plant-site-v1.glb`, `plant-site-v2.glb`, `plant-site-spec-v1.json`.
- **S3 (changed):** `src/assetmodels/viewer/ModelViewer.test.tsx` (stale swap), `src/assetmodels/workspace/AssetModelWorkspace.test.tsx` (plant redirect, Open in site, Orbit), `src/assetmodels/run/RunTab.test.tsx` (site link), `e2e/site3d-env.spec.ts` (locator only).

## Global Constraints

Copied from the index; every task's requirements include them.

- `contract/openapi.yaml` is the source of truth. `contract/client/schema.d.ts` is regenerated with `pnpm -C contract generate` and committed in the same commit, never hand-edited.
- **F0 owns the contract.** No other unit edits `openapi.yaml` except to fix a defect, which is then logged as a ruling and handed off.
- Path parameter names match the contract literally: `projectId`, `assetModelId`, `version`, `runId`, `itemId`.
- Versions are never overwritten or deleted except with their asset model.
- API keys only ever come from `KeyStore.get(provider)` at the moment of a model call, and are deleted right after. Never in a log, job message, step summary, error, file or commit.
- No route blocks on mesh generation, validation over 200 items, cloud sampling or a model call.
- Bounded reads: items list ≤ 500 rows per page; Site 3D: ortho/drawing textures ≤ 64 MB and ≤ 256 live tiles; cloud point budget 3 M (setting); photo glyphs ≤ 2 000, instanced.
- Scene/GLB frame: metres, `x = plant_N`, `y = EL - datum.el_m`, `z = plant_E` (Y up, X plant north, Z plant east).
- Site CRS from plant: `[X, Y] = origin_crs + R(plant_north_deg) · [E, N]`, `R(θ) = [[cos θ, sin θ], [-sin θ, cos θ]]`.
- Copy is sentence case. No raw colours in TSX/CSS (`frontend/scripts/check-tokens.mjs`).
- Motion via tokens only; respect reduced motion. Panels use `GlassPanel` and the `frontend/src/ui/` primitives.
- UI units load the design skills (`impeccable`, `emil-design-eng`) and `DESIGN.md` first.
- The Site 3D screen is lazy-loaded (`src/app/lazyScreens.tsx`). `three` stays pinned at 0.180.0.
- e2e navigation uses `getByRole("navigation", { name: "Main navigation" }).getByRole("link", { name: /^Asset models/ })`. The sidebar redesign removed the tablist.
- Stage files by path; never `git add -A`. Never `git stash`. Commits end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Commit identity is "Danijel Jovanovic" / info@synapse-solutions.ai.
- Backend interpreter: `E:\Dev\Yolo\app\backend\.venv\Scripts\python.exe`, run from `<worktree>\backend`.
- **Never install anything into the shared venv.** No unit adds Python packages. Frontend packages: none planned. A unit that needs one stops and reports.
- Gate before READY_TO_MERGE: `pnpm -C contract check`, `ruff check .`, `ruff format --check .`, `pytest`, `pnpm -C frontend lint`, `pnpm -C frontend test`, `pnpm -C frontend build`, `pnpm -C frontend e2e` on the unit's ports; `cargo test` only when the frozen sidecar exists. Full suites run only in the unit's final gate.

Design rules this unit leans on (`DESIGN.md`): blur only in `GlassPanel variant="float"`; never blur a scrolling list (the register panel is opaque `bg-glass-solid`); loops only while real work runs; `reduce-motion:` variant (never `motion-reduce:`); reduced effects = `<html data-effects="reduced">`; figures in JetBrains Mono with `tabular-nums`; key caps only via `KeyChord`; no em dashes in UI copy.

## Review Focus

Five inputs the spec implies and no happy-path test reaches, most likely first. Each has its test in the owning task.

1. **A cloud in a different CRS, or a local-frame cloud** (index Review Focus 2). The layer never projects it; the view says "Can't place this cloud". Test: `cloud.layer.test.ts` "other crs" (Task S2-3), and the e2e `site3d-env.spec.ts` asserts the text on screen (Task S2-8, kept by S3).
2. **A model with no sea, or sea but no land, or no model yet.** Water is "unavailable" with a reason, no foam texture is built from nothing, and nothing throws. Tests: `water.layer.test.ts` "no sea", "sea without land", "no model yet" (Task S2-5).
3. **More than 2 000 posed photos, some with no altitude or no gimbal angles.** At most 2 000 glyphs, evenly sampled, a note says how many are shown; null `z` is skipped and counted; null yaw/pitch draws nadir. Tests: `photos.layer.test.ts` "caps at 2 000", "skips photos with no altitude", "nadir without a pose" (Task S2-6).
4. **Typing fast in the register search over a 2 000-row register while pages are still arriving.** Only the last query's rows show (superseded requests aborted), scrolling to the end fetches the next page exactly once. Tests: `useRegister.test.tsx` "drops a superseded query", "loads the next page once" (Task S3-5).
5. **An edit whose GLB fails to build or load, and an edit abandoned half-way.** The old model stays, labelled stale, with the error; selecting another item or leaving the screen with unsaved edits asks first. Tests: `SitePanels.test.tsx` "failed swap keeps the old model, labelled stale" (Task S3-9), `ModelViewer.test.tsx` "a failed swap labels the old model stale" (Task S3-3), `useDiscardGuard.test.tsx` "asks before dropping edits" (Task S3-7).

## Rulings

1. **Water technique.** three's `Water` (mirror reflection, normals texture) on a flat mesh made from the GLB's sea triangles; the sea nodes are hidden while water shows and shown again when it is off. Shoreline foam is a 512² chamfer distance field from land triangles, computed once per model load on the main thread (≈ 30 ms; a worker buys nothing at this size), injected into `Water`'s fragment shader as `shoreSampler`. The Cowork viewer's custom water shader is reference only.
2. **Water does not animate on its own.** DESIGN.md allows loops only while real work runs, so water time advances only on frames the engine renders anyway (camera moves, tiles or nodes loading). Under reduced motion it never advances. Reduced effects draw flat water (`MeshStandardMaterial`, no mirror pass).
3. **Sea and land detection.** A node is sea when `userData.env === "sea"` (GLB extras) or its name is `Sea` (Cowork's GLB); land when `userData.env` is one of `land, paved, road, laydown, slope, revetment`. Ancestors count: a group with the extras marks its meshes.
4. **Cloud placement.** A cloud is placed with one affine matrix on a parent group, built by sampling S1's `siteToScene` (so S2 never re-derives the rotation). `z_offset_m` is read as "plant EL = cloud z + z_offset_m". `same_crs=false` → never loaded, status `CANT_PLACE`; no frame → `NO_FRAME`.
5. **Cloud elevation colour.** potree-core colours height by `world.z`; the scene is Y-up. The layer wraps the material's `updateShaderSource` to rewrite `world.z - heightMin` to `world.y - heightMin` after every regeneration (`yUpElevation`). The range is the loaded cloud's world box in scene Y.
6. **Clouds have no opacity slider in G1** (potree's transparent points need sorting the budget cannot afford); rows show `opacity: null`.
7. **Photos come from the scene's `photos.url`** when it names a cloud's cameras route (`/pointclouds/{id}/cameras`); the layer reads it with `getCloudCameras` (token handled by the client). Any other URL shape → "unavailable". Photos are off by default (clutter), findings on. Clicking a glyph opens `/p/:projectId/images/:imageId`.
8. **Findings read the existing APIs,** not `findings.url`: map findings over the site extent (`listMapFindingsInView`, ≤ 5 000) at scene `y = 0` (the datum, where the ortho drapes), and cloud findings per same-CRS cloud (`listCloudPins`, ≤ 500). `findings.count === 0` skips both reads. Clicking a pin opens `findingPath`.
9. **Screen-space picking for glyphs and pins** (`screenNearest`, 12 px): ray-casting screen-sized points and 3 m glyphs at 3 km is unreliable.
10. **"Source opens drawing crop"** opens a popover with the drawing's thumbnail (`drawingThumbnailUrl`, 160 px), the source region outlined, the page, and a link to the drawing in the Maps workspace (`?sel=drawing:<id>`, M1's link). No crop endpoint exists and F0 owns the contract; a zoomed crop is handed off to L1/G2.
11. **"The Orbit button works" (M1).** `engine.ts` is frozen for P1 and has one navigation mode, so the inert, focusable Orbit button becomes an honest mode indicator (not focusable, `role="img"`, tooltip "Orbit: drag to turn, right-drag to pan, scroll to zoom"). A real orbit/pan switch belongs to the Site 3D view tools.
12. **`MAX_STEPS` from the run's budget.** `maxSteps(run)` = `run.limits.max_calls` when the run carries it, else 80 for `build`/`refine` (runner.py `MAX_CALLS`), else `null` for plant runs (counted in packages; the bar shows "step N" and an indeterminate bar).
13. **Plant models open in the site view by default.** `/p/:pid/models/:id` for a model with `kind === "plant"` redirects to `/p/:pid/site/:id` unless `?view=model`; the site view links back with "Model details".
14. **"Open in 3D" in Map and Cloud workspaces is labelled "Open site in 3D"** (a top-bar route action), because the map context menu already has "Open in 3D" (the cloud jump). It passes `?at=x,y&epsg=n` in the source's CRS; the site view uses it only when the EPSG matches its frame, else it opens framed.
15. **Item editor fields.** Type (catalogue), base/top EL, height source, footprint numbers (rect centre/size/rotation, circle centre/diameter, line width; polygon and line vertices are shown, not edited, in G1), params from `params_schema` (number, integer, boolean, enum, string; arrays and objects as JSON text). Changing the type resets params to `{}` (builder defaults apply). The save note is `Edited <tag or id> from v<base>: <changes>`.
16. **Register filters.** Type options come from the catalogue; area options from the rows loaded so far plus the current choice; flag options are the six flag codes.
17. **Layer defaults:** model, orthos, drawings, clouds, water, sky and findings on; photos off.

## Deviations (code differs from spec or index)

1. **Contract name clash:** `components["schemas"]["SiteFrame"]` already exists (the map workspace display frame: `kind, crs_wkt, epsg, proj4, name`). F0's plant frame schema cannot reuse the name; S2/S3 use only S1's `SiteFrameT` and the `SiteScene.frame` field, never `S["SiteFrame"]`. Flagged to the coordinator.
2. **M1 limits are constants, not App settings** (`runner.py MAX_CALLS = 80`); `AssetModelRun` has no `limits` field on `main`. Ruling 12 reads `limits` only if F0 adds it.
3. **No drawing crop endpoint** (Ruling 10).
4. **M1 deferred items 5 and 6** ("editor shows the base version", "unsaved edits prompt") are built into the Site 3D item editor, which is where §11 says they are reused; M1's Part tab is unchanged.

## Execution DAG

**S2:** `1 → 2 → {3, 4, 5, 6, 7} (parallel) → 8 → 9`. Critical path 1 → 2 → 5 (water) → 8 → 9.

**S3:** `1 → {2, 3, 10} (parallel) → {4, 5, 6, 7, 8} (parallel; 5, 6, 7 need 2) → 9 (WAITING: S2) → 11 → 12`. Critical path 1 → 2 → 7 (editor) → 9 → 11 → 12.

---

# Part S2: Site 3D layers (cloud, water, sky, photos, findings)

Worktree `E:\Dev\Yolo\app\.claude\worktrees\pm-s2`, branch `task/pm-s2`, cut from `main` after S1 merged. All paths below are relative to the worktree. Frontend commands run from the worktree root with `pnpm -C frontend …`.

UI rule for every task: load `impeccable` and `emil-design-eng` and read `DESIGN.md` before writing UI; S2's only DOM is a screen-reader status list, the rest is WebGL.

### Task S2-1: Align with merged F0 and S1

**Files:**
- Create: `frontend/src/site3d/layers/s1Bridge.ts`, `frontend/src/site3d/layers/sceneTypes.ts`, `frontend/src/test/fakeSiteEngine.ts`, `frontend/src/test/siteSceneFixtures.ts`
- Test: `frontend/src/site3d/layers/s1Bridge.test.ts`
- Modify (only if S1 lacks them): `frontend/src/site3d/engine/SiteEngine.ts` (a `three` getter, `requestRender()`), `frontend/src/site3d/layers/model.layer.ts` (`root()`, `onLoaded(cb)`)

**Interfaces:**
- Consumes: S1's `SiteEngine`, `SiteLayer`, `SiteFrameT`, `siteToScene`, model layer, `SiteScreen.tsx`; F0's generated `components["schemas"]["SiteScene"]`.
- Produces: `partsOf(e: SiteEngine): EngineParts`; `SiteScene`, `SiteCloud` types; `fakeSiteEngine()`; `FRAME`, `sceneWith(overrides)`, `cloudRow(overrides)`.

- [ ] **Step 1: Read S1 and F0 and record the real names**

Read, in the worktree: `frontend/src/site3d/engine/SiteEngine.ts`, `frontend/src/site3d/engine/siteTransform.ts`, `frontend/src/site3d/layers/types.ts`, `frontend/src/site3d/layers/model.layer.ts`, `frontend/src/site3d/SiteScreen.tsx`, `frontend/src/api/siteScene.ts`, and run `grep -n "SiteScene\|AssetItemRow\|SiteCloud" contract/client/schema.d.ts`. Write into the ledger (`.superpowers/sdd/pm-common/ledgers/s2.md`) a `Ruling:` line for each of:
1. how S2 reaches the WebGL renderer, scene, camera, canvas and a frame request (expected `engine.three.{renderer, scene, camera, canvas}` and `engine.requestRender()`);
2. whether `addLayer` calls `attach` and `removeLayer` calls `detach` (expected yes), and whether `update(dt, camera)` gets `dt` in seconds;
3. the camera's `far` (Sky is scaled to 450 000 m; if `far` is smaller the sky still draws because its shader pins depth to the far plane);
4. the `SiteScene` schema name and the fields `clouds[].{id, name, octree_url, crs_epsg, same_crs, z_offset_m}`, `photos.{count, url}`, `findings.{count, url}`, `orthos[].bounds_site`, `drawings[].bounds_site` (expected `[minX, minY, maxX, maxY]` in the site CRS);
5. the model layer's way to hand out the loaded GLB root and a "loaded" event (expected `root()` and `onLoaded(cb) => unsubscribe`);
6. in `SiteScreen.tsx`, the variable names of the engine, the manifest, the `SiteFrameT` and the model layer, and whether the frame object is memoised (it must be: S2 keys its layers on it).

If item 1 or 5 is missing in S1, add the smallest accessor to S1's file (shared-file touch, listed in the header) with a one-line doc comment, e.g. in `SiteEngine.ts`:

```ts
  /** S2/S3: the live objects. Read them; do not replace them. */
  get three(): { renderer: THREE.WebGLRenderer; scene: THREE.Scene; camera: THREE.PerspectiveCamera; canvas: HTMLCanvasElement } {
    return { renderer: this.renderer, scene: this.scene, camera: this.camera, canvas: this.canvas };
  }
```

- [ ] **Step 2: Write the failing test**

`frontend/src/site3d/layers/s1Bridge.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { siteToScene } from "@/site3d/engine/siteTransform";
import { fakeSiteEngine } from "@/test/fakeSiteEngine";
import { FRAME } from "@/test/siteSceneFixtures";
import { partsOf } from "./s1Bridge";

describe("partsOf", () => {
  it("reaches S1's renderer, scene, camera and canvas and asks S1 for a frame", () => {
    const f = fakeSiteEngine();
    const p = partsOf(f.engine);
    expect(p.renderer).toBe(f.renderer);
    expect(p.scene).toBe(f.scene);
    expect(p.camera).toBe(f.camera);
    expect(p.canvas).toBe(f.canvas);
    p.requestRender();
    expect(f.requestRender).toHaveBeenCalledTimes(1);
  });
});

describe("siteToScene (S1), as S2 reads it", () => {
  it("takes a plant EL: the plant origin at the datum is the scene origin", () => {
    const [x, y, z] = siteToScene(FRAME, FRAME.origin_crs[0], FRAME.origin_crs[1], FRAME.datum.el_m);
    expect(Math.abs(x)).toBeLessThan(1e-6);
    expect(Math.abs(y)).toBeLessThan(1e-6);
    expect(Math.abs(z)).toBeLessThan(1e-6);
  });

  it("puts plant north on scene +x: a point 10 m along plant north lands at x = 10", () => {
    const t = (FRAME.plant_north_deg * Math.PI) / 180;
    // plant [E, N] = [0, 10] → site = origin + R(θ)·[0, 10] = origin + [10 sin θ, 10 cos θ]
    const [x, y, z] = siteToScene(FRAME, FRAME.origin_crs[0] + 10 * Math.sin(t), FRAME.origin_crs[1] + 10 * Math.cos(t), 100);
    expect(x).toBeCloseTo(10, 6);
    expect(y).toBeCloseTo(0, 6);
    expect(z).toBeCloseTo(0, 6);
  });
});
```

- [ ] **Step 3: Run it to verify it fails**

Run: `pnpm -C frontend exec vitest run src/site3d/layers/s1Bridge.test.ts`
Expected: FAIL, `Failed to resolve import "./s1Bridge"` (and the fixtures).

- [ ] **Step 4: Implement the bridge, the types and the test helpers**

`frontend/src/site3d/layers/s1Bridge.ts` (rewrite the body against the names recorded in Step 1; keep the exported shape):

```ts
import type * as THREE from "three";
import type { SiteEngine } from "@/site3d/engine/SiteEngine";

/** What S2's layers need from S1's engine. The only module that knows S1's accessor names. */
export interface EngineParts {
  renderer: THREE.WebGLRenderer;
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  canvas: HTMLCanvasElement;
  requestRender(): void;
}

export function partsOf(e: SiteEngine): EngineParts {
  const t = e.three;
  return {
    renderer: t.renderer,
    scene: t.scene,
    camera: t.camera,
    canvas: t.canvas,
    requestRender: () => e.requestRender(),
  };
}
```

`frontend/src/site3d/layers/sceneTypes.ts`:

```ts
import type { components } from "@contract/client";

/** F0's scene manifest (`getSiteScene`). Never `components["schemas"]["SiteFrame"]`: that is the map workspace frame. */
export type SiteScene = components["schemas"]["SiteScene"];
export type SiteCloud = SiteScene["clouds"][number];
```

`frontend/src/test/fakeSiteEngine.ts` (mirror whatever accessor `partsOf` reads):

```ts
import * as THREE from "three";
import { vi } from "vitest";
import type { SiteEngine } from "@/site3d/engine/SiteEngine";
import type { SiteLayer } from "@/site3d/layers/types";

/** A SiteEngine stand-in for layer tests: real three objects, no WebGL. */
export function fakeSiteEngine() {
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(50, 1, 0.1, 1e6);
  const canvas = document.createElement("canvas");
  canvas.getBoundingClientRect = () =>
    ({ left: 0, top: 0, right: 200, bottom: 200, width: 200, height: 200, x: 0, y: 0, toJSON: () => ({}) }) as DOMRect;
  const renderer = { info: { render: { frame: 0 } } } as unknown as THREE.WebGLRenderer;
  const requestRender = vi.fn();
  const layers = new Map<string, SiteLayer>();
  const engine = {
    three: { renderer, scene, camera, canvas },
    requestRender,
    addLayer: vi.fn((l: SiteLayer) => {
      layers.set(l.id, l);
      void l.attach(engine as unknown as SiteEngine);
    }),
    removeLayer: vi.fn((id: string) => {
      layers.get(id)?.detach();
      layers.delete(id);
    }),
  };
  return { engine: engine as unknown as SiteEngine, scene, camera, canvas, renderer, requestRender, layers, raw: engine };
}
```

`frontend/src/test/siteSceneFixtures.ts`:

```ts
import type { SiteFrameT } from "@/site3d/engine/siteTransform";
import type { SiteCloud, SiteScene } from "@/site3d/layers/sceneTypes";

/** Al-Zour's plant grid (index Global Constraints): UTM 39N, θ 17.9991°, datum HPFS 100. */
export const FRAME: SiteFrameT = {
  crs: { epsg: 32639, wkt: null },
  origin_crs: [244338.089, 3179515.69],
  plant_north_deg: 17.9991,
  datum: { label: "HPFS", el_m: 100 },
};

export const cloudRow = (o: Partial<SiteCloud> = {}): SiteCloud => ({
  id: "c1",
  name: "May survey",
  octree_url: "/api/v1/projects/p/pointclouds/c1/octree/metadata.json",
  crs_epsg: 32639,
  same_crs: true,
  // plant EL = cloud z + 120.45 (Al-Zour's cloud ground is z ≈ -20.45 at EL 100)
  z_offset_m: 120.45,
  ...o,
});

export const sceneWith = (o: Partial<SiteScene> = {}): SiteScene =>
  ({
    frame: { ...FRAME },
    model: null,
    orthos: [],
    clouds: [],
    drawings: [],
    photos: { count: 0, url: null },
    findings: { count: 0, url: null },
    ...o,
  }) as SiteScene;
```

- [ ] **Step 5: Run the test and the type check**

Run: `pnpm -C frontend exec vitest run src/site3d/layers/s1Bridge.test.ts` → Expected: 3 passed.
Run: `pnpm -C frontend exec tsc -b` → Expected: no errors. A type error in `siteSceneFixtures.ts` means F0 named a field differently: rename it here (the fixture), never in the contract.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/site3d/layers/s1Bridge.ts frontend/src/site3d/layers/s1Bridge.test.ts frontend/src/site3d/layers/sceneTypes.ts frontend/src/test/fakeSiteEngine.ts frontend/src/test/siteSceneFixtures.ts
# plus frontend/src/site3d/engine/SiteEngine.ts and/or frontend/src/site3d/layers/model.layer.ts only if Step 1 changed them
git commit -m "feat(site3d): S2 bridge to the S1 engine, scene types and layer test fakes

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task S2-2: Layer status, the site→scene matrix, effects, sun and screen picking

**Files:**
- Create: `frontend/src/site3d/layers/status.ts`, `sceneMatrix.ts`, `effects.ts`, `sun.ts`, `screenPick.ts`
- Test: `frontend/src/site3d/layers/status.test.ts`, `sceneMatrix.test.ts`, `sun.test.ts`, `screenPick.test.ts`

**Interfaces:**
- Consumes: `SiteLayer`, `siteToScene`, `SiteFrameT` (S1).
- Produces: `LayerStatus`, `StatusCell`, `StatusLayer`, `statusText`, `siteToSceneMatrix`, `isReducedEffects`, `onEffectsChange`, `SUN_ELEVATION_DEG`, `SUN_AZIMUTH_DEG`, `sunDirection`, `screenNearest` (signatures in the header).

- [ ] **Step 1: Write the failing tests**

`frontend/src/site3d/layers/status.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";
import { StatusCell, statusText, type LayerStatus } from "./status";

describe("StatusCell", () => {
  it("starts loading, tells subscribers, and stops telling them after unsubscribe", () => {
    const cell = new StatusCell();
    expect(cell.get()).toEqual({ kind: "loading" });
    const cb = vi.fn();
    const off = cell.subscribe(cb);
    cell.set({ kind: "ready" });
    expect(cb).toHaveBeenCalledWith({ kind: "ready" });
    off();
    cell.set({ kind: "error", message: "x" });
    expect(cb).toHaveBeenCalledTimes(1);
    expect(cell.get()).toEqual({ kind: "error", message: "x" });
  });
});

describe("statusText", () => {
  const cases: [LayerStatus, boolean, string][] = [
    [{ kind: "loading" }, true, "loading"],
    [{ kind: "ready" }, true, "shown"],
    [{ kind: "ready" }, false, "hidden"],
    [{ kind: "ready", note: "Flat water (reduced effects)" }, true, "shown, Flat water (reduced effects)"],
    [{ kind: "unavailable", reason: "No posed photos in this project." }, true, "No posed photos in this project."],
    [{ kind: "error", message: "The cloud could not load: HTTP 404" }, false, "The cloud could not load: HTTP 404"],
  ];
  it.each(cases)("%o (visible %s) reads %s", (s, visible, text) => {
    expect(statusText(s, visible)).toBe(text);
  });
});
```

`frontend/src/site3d/layers/sceneMatrix.test.ts`:

```ts
import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { siteToScene } from "@/site3d/engine/siteTransform";
import { FRAME } from "@/test/siteSceneFixtures";
import { siteToSceneMatrix } from "./sceneMatrix";

describe("siteToSceneMatrix", () => {
  it("maps site points exactly like siteToScene, with the cloud's z offset", () => {
    const m = siteToSceneMatrix(FRAME, 120.45);
    const pts: [number, number, number][] = [
      [244338.089, 3179515.69, -20.45],
      [244900.5, 3180120.25, 3.2],
      [243800, 3179000, -45],
    ];
    for (const [x, y, z] of pts) {
      const v = new THREE.Vector3(x, y, z).applyMatrix4(m);
      const [ex, ey, ez] = siteToScene(FRAME, x, y, z + 120.45);
      expect(v.x).toBeCloseTo(ex, 5);
      expect(v.y).toBeCloseTo(ey, 5);
      expect(v.z).toBeCloseTo(ez, 5);
    }
  });

  it("puts the plant origin at the cloud's datum height at the scene origin", () => {
    const v = new THREE.Vector3(244338.089, 3179515.69, -20.45).applyMatrix4(siteToSceneMatrix(FRAME, 120.45));
    expect(v.length()).toBeLessThan(1e-5);
  });

  it("is a rotation (no scale, no mirror)", () => {
    expect(siteToSceneMatrix(FRAME, 0).determinant()).toBeCloseTo(1, 9);
  });
});
```

`frontend/src/site3d/layers/sun.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { sunDirection } from "./sun";

describe("sunDirection (scene: x plant north, y up, z plant east)", () => {
  it("azimuth 0 on the horizon is plant north", () => {
    const d = sunDirection(0, 0);
    expect([d.x, d.y, d.z].map((v) => +v.toFixed(9))).toEqual([1, 0, 0]);
  });
  it("azimuth 90 is plant east", () => {
    const d = sunDirection(0, 90);
    expect([d.x, d.y, d.z].map((v) => +v.toFixed(9))).toEqual([0, 0, 1]);
  });
  it("elevation 90 is straight up, and the default is a unit vector above the horizon", () => {
    expect(sunDirection(90, 123).y).toBeCloseTo(1, 9);
    const d = sunDirection();
    expect(d.length()).toBeCloseTo(1, 9);
    expect(d.y).toBeGreaterThan(0.5);
  });
});
```

`frontend/src/site3d/layers/screenPick.test.ts`:

```ts
import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { screenNearest } from "./screenPick";

const camera = new THREE.PerspectiveCamera(60, 1, 0.1, 1000);
camera.position.set(0, 0, 10);
camera.lookAt(0, 0, 0);
camera.updateMatrixWorld();
camera.updateProjectionMatrix();
const rect = { left: 0, top: 0, width: 200, height: 200 };

describe("screenNearest", () => {
  it("returns the point under the pointer", () => {
    expect(screenNearest(new Float32Array([5, 5, 0, 0, 0, 0]), camera, rect, 100, 100)).toBe(1);
  });
  it("returns null when nothing is within 12 px", () => {
    expect(screenNearest(new Float32Array([5, 5, 0]), camera, rect, 100, 100)).toBeNull();
  });
  it("ignores points behind the camera", () => {
    expect(screenNearest(new Float32Array([0, 0, 20]), camera, rect, 100, 100)).toBeNull();
  });
  it("picks the nearer of two points on screen", () => {
    // (0.3, 0, 0) projects ~5 px right of centre; (0, 0, 0) is at the centre
    expect(screenNearest(new Float32Array([0.3, 0, 0, 0, 0, 0]), camera, rect, 101, 100)).toBe(1);
  });
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `pnpm -C frontend exec vitest run src/site3d/layers/status.test.ts src/site3d/layers/sceneMatrix.test.ts src/site3d/layers/sun.test.ts src/site3d/layers/screenPick.test.ts`
Expected: FAIL, modules not found.

- [ ] **Step 3: Implement**

`frontend/src/site3d/layers/status.ts`:

```ts
import type { SiteLayer } from "./types";

/** Why a layer shows, or why it can't: the Layers panel prints it (S3). */
export type LayerStatus =
  | { kind: "loading" }
  | { kind: "ready"; note?: string }
  | { kind: "unavailable"; reason: string }
  | { kind: "error"; message: string };

export class StatusCell {
  private value: LayerStatus;
  private readonly listeners = new Set<(s: LayerStatus) => void>();

  constructor(initial: LayerStatus = { kind: "loading" }) {
    this.value = initial;
  }

  get(): LayerStatus {
    return this.value;
  }

  set(next: LayerStatus): void {
    this.value = next;
    for (const cb of [...this.listeners]) cb(next);
  }

  subscribe(cb: (s: LayerStatus) => void): () => void {
    this.listeners.add(cb);
    return () => {
      this.listeners.delete(cb);
    };
  }
}

export interface StatusLayer extends SiteLayer {
  readonly status: StatusCell;
}

/** One line for a layer: "shown", "hidden", a reason or an error. */
export function statusText(s: LayerStatus, visible: boolean): string {
  switch (s.kind) {
    case "loading":
      return "loading";
    case "ready":
      return [visible ? "shown" : "hidden", s.note].filter(Boolean).join(", ");
    case "unavailable":
      return s.reason;
    case "error":
      return s.message;
  }
}
```

`frontend/src/site3d/layers/sceneMatrix.ts`:

```ts
import * as THREE from "three";
import { siteToScene, type SiteFrameT } from "@/site3d/engine/siteTransform";

/**
 * The affine map from site CRS (x, y, cloud z) to the scene, with `plant EL = z + zOffsetM`, sampled
 * from S1's `siteToScene` around the plant origin (so the rotation is never derived twice). Float64
 * throughout: three's Matrix4 keeps plain numbers, and potree offsets each node, so the UTM-sized
 * translation never reaches a float32 vertex.
 */
export function siteToSceneMatrix(f: SiteFrameT, zOffsetM: number): THREE.Matrix4 {
  const [ox, oy] = f.origin_crs;
  const o = siteToScene(f, ox, oy, zOffsetM);
  const ex = siteToScene(f, ox + 1, oy, zOffsetM);
  const ey = siteToScene(f, ox, oy + 1, zOffsetM);
  const ez = siteToScene(f, ox, oy, zOffsetM + 1);
  const a = [ex[0] - o[0], ex[1] - o[1], ex[2] - o[2]];
  const b = [ey[0] - o[0], ey[1] - o[1], ey[2] - o[2]];
  const c = [ez[0] - o[0], ez[1] - o[1], ez[2] - o[2]];
  // Matrix4.set takes rows; a, b, c are the columns (the images of the site x, y, z unit vectors).
  const m = new THREE.Matrix4().set(a[0], b[0], c[0], 0, a[1], b[1], c[1], 0, a[2], b[2], c[2], 0, 0, 0, 0, 1);
  const t = new THREE.Vector3(ox, oy, 0).applyMatrix4(m);
  m.setPosition(o[0] - t.x, o[1] - t.y, o[2] - t.z);
  return m;
}
```

`frontend/src/site3d/layers/effects.ts`:

```ts
/** DESIGN.md "Reduced effects": `<html data-effects="reduced">`, set by app/effects.ts. */
export function isReducedEffects(): boolean {
  return document.documentElement.dataset.effects === "reduced";
}

/** Calls `cb` whenever Settings or the auto probe switches the effects mode. */
export function onEffectsChange(cb: () => void): () => void {
  if (typeof MutationObserver === "undefined") return () => {};
  const mo = new MutationObserver(() => cb());
  mo.observe(document.documentElement, { attributes: true, attributeFilter: ["data-effects"] });
  return () => mo.disconnect();
}
```

`frontend/src/site3d/layers/sun.ts`:

```ts
import * as THREE from "three";

/** A Gulf mid-morning sun; one place, so the sky, its light and the water agree. */
export const SUN_ELEVATION_DEG = 52;
/** Clockwise from plant north. */
export const SUN_AZIMUTH_DEG = 200;

/** Unit vector towards the sun in the scene frame (x plant north, y up, z plant east). */
export function sunDirection(elevDeg = SUN_ELEVATION_DEG, azDeg = SUN_AZIMUTH_DEG): THREE.Vector3 {
  const e = THREE.MathUtils.degToRad(elevDeg);
  const a = THREE.MathUtils.degToRad(azDeg);
  return new THREE.Vector3(Math.cos(e) * Math.cos(a), Math.sin(e), Math.cos(e) * Math.sin(a)).normalize();
}
```

`frontend/src/site3d/layers/screenPick.ts`:

```ts
import * as THREE from "three";

export const PICK_PX = 12;

/**
 * The index of the point (xyz triples, scene metres) drawn nearest the pointer within `maxPx`, or
 * null. Points behind the camera are skipped. Screen-space, because glyphs and pins are a few
 * pixels across at site scale and a ray would miss them.
 */
export function screenNearest(
  points: Float32Array,
  camera: THREE.Camera,
  rect: { left: number; top: number; width: number; height: number },
  clientX: number,
  clientY: number,
  maxPx = PICK_PX,
): number | null {
  const v = new THREE.Vector3();
  let best = -1;
  let bestD = maxPx * maxPx;
  for (let i = 0; i * 3 + 2 < points.length; i++) {
    v.set(points[i * 3], points[i * 3 + 1], points[i * 3 + 2]).applyMatrix4(camera.matrixWorldInverse);
    if (v.z >= 0) continue; // behind or at the camera: the camera looks down its own -z
    v.applyMatrix4(camera.projectionMatrix);
    const sx = rect.left + ((v.x + 1) / 2) * rect.width;
    const sy = rect.top + ((1 - v.y) / 2) * rect.height;
    const d = (sx - clientX) ** 2 + (sy - clientY) ** 2;
    if (d <= bestD) {
      bestD = d;
      best = i;
    }
  }
  return best < 0 ? null : best;
}
```

- [ ] **Step 4: Run the tests**

Run: the Step 2 command. Expected: all pass (status 7, sceneMatrix 3, sun 3, screenPick 4).

- [ ] **Step 5: Commit**

```bash
git add frontend/src/site3d/layers/status.ts frontend/src/site3d/layers/status.test.ts frontend/src/site3d/layers/sceneMatrix.ts frontend/src/site3d/layers/sceneMatrix.test.ts frontend/src/site3d/layers/effects.ts frontend/src/site3d/layers/sun.ts frontend/src/site3d/layers/sun.test.ts frontend/src/site3d/layers/screenPick.ts frontend/src/site3d/layers/screenPick.test.ts
git commit -m "feat(site3d): layer status, site-to-scene matrix, sun and screen picking

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task S2-3: Point cloud layer (potree-core in the site renderer)

**Files:**
- Create: `frontend/src/site3d/layers/cloudHost.ts`, `frontend/src/site3d/layers/cloud.layer.ts`
- Test: `frontend/src/site3d/layers/cloudHost.test.ts`, `frontend/src/site3d/layers/cloud.layer.test.ts`

**Interfaces:**
- Consumes: `partsOf`, `siteToSceneMatrix`, `StatusCell` (Tasks 1–2); `makeRequestManager`, `metadataUrl`, `readBudget`, `usesNewFormat`, `disposePointsGeometries` (clouds workspace).
- Produces: `createCloudHost`, `CloudHost`, `createCloudLayer`, `CloudLayer`, `CloudColour`, `CANT_PLACE`, `NO_FRAME`, `yUpElevation`.

Background for the implementer: `frontend/src/clouds/viewer/engine.ts` (lines 225–260, 490–520, 730–760) is the reference for loading and updating a potree-core 2.0.15 octree with three 0.180. potree-core is imported only as a **type** here and dynamically at runtime (`await import("potree-core")`), so tests never load its WebGL code. A potree node's `matrixWorld` is `parent.matrixWorld · node.matrix`, and potree-core frustum-culls with the octree's `matrixWorld`, so putting the octree under a group whose matrix is the site→scene affine places and culls it correctly; potree-core's material also reads `renderer.capabilities.logarithmicDepthBuffer`, so S1's log depth works.

- [ ] **Step 1: Write the failing tests**

`frontend/src/site3d/layers/cloudHost.test.ts`:

```ts
import * as THREE from "three";
import { describe, expect, it, vi } from "vitest";
import { makeRequestManager } from "@/clouds/viewer/requestManager";
import { createCloudHost } from "./cloudHost";

function fakePotree() {
  return {
    pointBudget: 0,
    loadPointCloud: vi.fn(async () => new THREE.Object3D()),
    updatePointClouds: vi.fn(() => ({ nodeLoadPromises: [Promise.resolve()], exceededMaxLoadsToGPU: false })),
  };
}
const rm = makeRequestManager("t");
const camera = new THREE.PerspectiveCamera();
const renderer = {} as THREE.WebGLRenderer;

describe("cloud host", () => {
  it("makes one Potree lazily, with the budget, and setBudget reaches it", async () => {
    const p = fakePotree();
    const make = vi.fn(async () => p as never);
    const host = createCloudHost(make, 2_000_000);
    expect(make).not.toHaveBeenCalled();
    host.setBudget(5_000_000);
    await host.load("http://x/metadata.json", rm);
    await host.load("http://y/metadata.json", rm);
    expect(make).toHaveBeenCalledTimes(1);
    expect(p.pointBudget).toBe(5_000_000);
    host.setBudget(1_000_000);
    expect(p.pointBudget).toBe(1_000_000);
    expect(host.budget()).toBe(1_000_000);
  });

  it("updates the visible clouds once per frame and says while nodes load", async () => {
    const p = fakePotree();
    const host = createCloudHost(async () => p as never, 3_000_000);
    const a = await host.load("http://x/metadata.json", rm);
    host.add(a);
    expect(host.update(camera, renderer, 1)).toBe(true);
    expect(host.update(camera, renderer, 1)).toBe(true); // same frame: no second update
    expect(p.updatePointClouds).toHaveBeenCalledTimes(1);
    host.update(camera, renderer, 2);
    expect(p.updatePointClouds).toHaveBeenCalledTimes(2);
  });

  it("skips hidden clouds and removed ones", async () => {
    const p = fakePotree();
    const host = createCloudHost(async () => p as never, 3_000_000);
    const a = await host.load("http://x/metadata.json", rm);
    host.add(a);
    a.visible = false;
    expect(host.update(camera, renderer, 1)).toBe(false);
    a.visible = true;
    host.remove(a);
    expect(host.update(camera, renderer, 2)).toBe(false);
    expect(p.updatePointClouds).not.toHaveBeenCalled();
  });
});
```

`frontend/src/site3d/layers/cloud.layer.test.ts` (the **"other crs"** test is index Review Focus 2):

```ts
import * as THREE from "three";
import type { PointCloudOctree } from "potree-core";
import { describe, expect, it, vi } from "vitest";
import { fakeSiteEngine } from "@/test/fakeSiteEngine";
import { FRAME, cloudRow } from "@/test/siteSceneFixtures";
import type { CloudHost } from "./cloudHost";
import { CANT_PLACE, NO_FRAME, createCloudLayer, yUpElevation } from "./cloud.layer";
import { siteToSceneMatrix } from "./sceneMatrix";

const SHADER = "float w = (world.z - heightMin) / (heightMax - heightMin);";

function fakePco() {
  const o = new THREE.Object3D();
  const material = {
    newFormat: true,
    vertexShader: SHADER,
    needsUpdate: false,
    pointColorType: 0,
    elevationRange: [0, 1] as [number, number],
    inputColorEncoding: 0,
    outputColorEncoding: 0,
    pointSizeType: 0,
    // potree-core regenerates the source from its template on every shader-affecting change
    updateShaderSource() {
      this.vertexShader = SHADER;
    },
  };
  Object.assign(o, {
    material,
    pcoGeometry: {},
    dispose: vi.fn(),
    getBoundingBoxWorld: () => new THREE.Box3(new THREE.Vector3(0, -5, 0), new THREE.Vector3(10, 40, 10)),
  });
  return o as unknown as PointCloudOctree & { material: typeof material; dispose: ReturnType<typeof vi.fn> };
}

function fakeHost(load: CloudHost["load"] = vi.fn(async () => fakePco())) {
  return {
    load: vi.fn(load),
    add: vi.fn(),
    remove: vi.fn(),
    budget: () => 3_000_000,
    setBudget: vi.fn(),
    update: vi.fn(() => false),
  };
}
const BASE = "http://127.0.0.1:4010";

describe("cloud layer", () => {
  it("other crs: never loads or projects the cloud, and says it can't place it", async () => {
    const host = fakeHost();
    const { engine, scene } = fakeSiteEngine();
    const layer = createCloudLayer({ cloud: cloudRow({ same_crs: false }), frame: FRAME, baseUrl: BASE, token: "t", host });
    await layer.attach(engine);
    expect(host.load).not.toHaveBeenCalled();
    expect(layer.status.get()).toEqual({ kind: "unavailable", reason: CANT_PLACE });
    expect(CANT_PLACE).toMatch(/^Can't place this cloud/);
    expect(scene.getObjectByName("cloud:c1")).toBeUndefined();
    expect(layer.box()).toBeNull();
  });

  it("without the site's plant grid it can't place the cloud either", async () => {
    const host = fakeHost();
    const { engine } = fakeSiteEngine();
    const layer = createCloudLayer({ cloud: cloudRow(), frame: null, baseUrl: BASE, token: "t", host });
    await layer.attach(engine);
    expect(host.load).not.toHaveBeenCalled();
    expect(layer.status.get()).toEqual({ kind: "unavailable", reason: NO_FRAME });
  });

  it("loads a same-CRS cloud under the site→scene matrix, with its z offset", async () => {
    const host = fakeHost();
    const { engine, scene } = fakeSiteEngine();
    const layer = createCloudLayer({ cloud: cloudRow(), frame: FRAME, baseUrl: BASE, token: "t", host });
    await layer.attach(engine);
    expect(host.load).toHaveBeenCalledWith(`${BASE}/api/v1/projects/p/pointclouds/c1/octree/metadata.json`, expect.anything());
    const group = scene.getObjectByName("cloud:c1")!;
    expect(group.matrix.equals(siteToSceneMatrix(FRAME, 120.45))).toBe(true);
    expect(group.children).toHaveLength(1);
    expect(host.add).toHaveBeenCalledWith(group.children[0]);
    expect(layer.status.get()).toEqual({ kind: "ready" });
  });

  it("keeps height colouring on scene Y after every shader regeneration", async () => {
    const pco = fakePco();
    const host = fakeHost(async () => pco);
    const { engine } = fakeSiteEngine();
    const layer = createCloudLayer({ cloud: cloudRow(), frame: FRAME, baseUrl: BASE, token: "t", host });
    await layer.attach(engine);
    expect(pco.material.vertexShader).toContain("world.y - heightMin");
    pco.material.updateShaderSource();
    expect(pco.material.vertexShader).toContain("world.y - heightMin");
    layer.setColour("elevation");
    expect(pco.material.pointColorType).toBe(3);
    expect(pco.material.elevationRange).toEqual([-5, 40]);
    expect(pco.material.newFormat).toBe(false); // a v2 octree reads rgba only in RGB mode
    layer.setColour("rgb");
    expect(pco.material.newFormat).toBe(true);
  });

  it("a failed load is an error status, never an exception", async () => {
    const host = fakeHost(async () => {
      throw new Error("HTTP 404");
    });
    const { engine } = fakeSiteEngine();
    const layer = createCloudLayer({ cloud: cloudRow(), frame: FRAME, baseUrl: BASE, token: "t", host });
    await layer.attach(engine);
    expect(layer.status.get()).toEqual({ kind: "error", message: "The cloud could not load: HTTP 404" });
  });

  it("hides with the toggle and asks for frames only while nodes load", async () => {
    const host = fakeHost();
    host.update.mockReturnValueOnce(true);
    const { engine, scene, camera, requestRender } = fakeSiteEngine();
    const layer = createCloudLayer({ cloud: cloudRow(), frame: FRAME, baseUrl: BASE, token: "t", host });
    await layer.attach(engine);
    requestRender.mockClear();
    layer.update?.(0.016, camera);
    expect(requestRender).toHaveBeenCalledTimes(1);
    layer.update?.(0.016, camera);
    expect(requestRender).toHaveBeenCalledTimes(1);
    layer.setVisible(false);
    expect(scene.getObjectByName("cloud:c1")!.visible).toBe(false);
  });

  it("detach releases the cloud and leaves the scene", async () => {
    const pco = fakePco();
    const host = fakeHost(async () => pco);
    const { engine, scene } = fakeSiteEngine();
    const layer = createCloudLayer({ cloud: cloudRow(), frame: FRAME, baseUrl: BASE, token: "t", host });
    await layer.attach(engine);
    layer.detach();
    expect(host.remove).toHaveBeenCalledWith(pco);
    expect(pco.dispose).toHaveBeenCalled();
    expect(scene.getObjectByName("cloud:c1")).toBeUndefined();
  });

  it("yUpElevation rewrites every height read from world z to world y", () => {
    expect(yUpElevation(SHADER + "\n" + SHADER)).not.toContain("world.z");
  });
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `pnpm -C frontend exec vitest run src/site3d/layers/cloudHost.test.ts src/site3d/layers/cloud.layer.test.ts`
Expected: FAIL, modules not found.

- [ ] **Step 3: Implement the host**

`frontend/src/site3d/layers/cloudHost.ts`:

```ts
import type * as THREE from "three";
import type { PointCloudOctree, Potree } from "potree-core";
import { readBudget } from "@/clouds/viewer/budget";
import type { OctreeRequestManager } from "@/clouds/viewer/requestManager";

export type PotreeLike = Pick<Potree, "pointBudget" | "loadPointCloud" | "updatePointClouds">;

/** One Potree for every cloud in the site view: one point budget, one LRU (spec §11: 3 M, a setting). */
export interface CloudHost {
  load(url: string, rm: OctreeRequestManager): Promise<PointCloudOctree>;
  add(p: PointCloudOctree): void;
  remove(p: PointCloudOctree): void;
  budget(): number;
  setBudget(n: number): void;
  /** Once per rendered frame (`frame` = renderer.info.render.frame); true while nodes still load. */
  update(camera: THREE.Camera, renderer: THREE.WebGLRenderer, frame: number): boolean;
}

// potree-core is loaded only when a cloud is placed: tests and cloud-less sites never load it.
const loadPotree = async (): Promise<PotreeLike> => new (await import("potree-core")).Potree();

export function createCloudHost(make: () => Promise<PotreeLike> = loadPotree, budget = readBudget()): CloudHost {
  let potree: Promise<PotreeLike> | null = null;
  let current: PotreeLike | null = null;
  let points = budget;
  const live = new Set<PointCloudOctree>();
  let lastFrame = -1;
  let loading = false;
  const get = () => {
    potree ??= make().then((p) => {
      p.pointBudget = points;
      current = p;
      return p;
    });
    return potree;
  };
  return {
    load: async (url, rm) => (await get()).loadPointCloud(url, rm),
    add: (p) => void live.add(p),
    remove: (p) => void live.delete(p),
    budget: () => points,
    setBudget(n) {
      points = n;
      if (current) current.pointBudget = n;
    },
    update(camera, renderer, frame) {
      if (frame === lastFrame) return loading;
      lastFrame = frame;
      const shown = [...live].filter((p) => p.visible && (p.parent?.visible ?? true));
      if (!current || shown.length === 0) {
        loading = false;
        return false;
      }
      const r = current.updatePointClouds(shown, camera, renderer);
      // a failed node is the octree's own business; allSettled because potree-core also lists undefined
      void Promise.allSettled(r.nodeLoadPromises);
      loading = r.nodeLoadPromises.length > 0 || r.exceededMaxLoadsToGPU;
      return loading;
    },
  };
}
```

- [ ] **Step 4: Implement the layer**

`frontend/src/site3d/layers/cloud.layer.ts`:

```ts
import * as THREE from "three";
import type { PointCloudMaterial, PointCloudOctree } from "potree-core";
import { disposePointsGeometries } from "@/clouds/viewer/dispose";
import { usesNewFormat } from "@/clouds/viewer/materialOptions";
import { makeRequestManager, metadataUrl } from "@/clouds/viewer/requestManager";
import type { SiteEngine } from "@/site3d/engine/SiteEngine";
import type { SiteFrameT } from "@/site3d/engine/siteTransform";
import type { CloudHost } from "./cloudHost";
import { partsOf, type EngineParts } from "./s1Bridge";
import { siteToSceneMatrix } from "./sceneMatrix";
import type { SiteCloud } from "./sceneTypes";
import { StatusCell, type StatusLayer } from "./status";

export const CANT_PLACE = "Can't place this cloud: it is in a different coordinate system from the site.";
export const NO_FRAME = "Can't place this cloud: the site has no plant grid yet.";

export type CloudColour = "rgb" | "elevation" | "intensity";
/** potree-core's PointColorType: RGB 0, HEIGHT 3, INTENSITY 4 (clouds/viewer/materialOptions.ts). */
const COLOR_TYPE: Record<CloudColour, 0 | 3 | 4> = { rgb: 0, elevation: 3, intensity: 4 };
type M = PointCloudMaterial;

/** potree-core colours height by `world.z`; the site scene is Y-up (Ruling 5). */
export function yUpElevation(src: string): string {
  return src.replace(/world\.z - heightMin/g, "world.y - heightMin");
}

export interface CloudLayer extends StatusLayer {
  readonly cloudId: string;
  setColour(c: CloudColour): void;
  /** The loaded cloud's box in scene metres, for "fly to"; null until loaded. */
  box(): THREE.Box3 | null;
}

export function createCloudLayer(o: {
  cloud: SiteCloud;
  frame: SiteFrameT | null;
  baseUrl: string;
  token: string;
  host: CloudHost;
}): CloudLayer {
  const status = new StatusCell();
  const group = new THREE.Group();
  group.name = `cloud:${o.cloud.id}`;
  group.matrixAutoUpdate = false;
  let parts: EngineParts | null = null;
  let pco: PointCloudOctree | null = null;
  let octreeV2 = false;
  let colour: CloudColour = "rgb";
  let disposed = false;

  function keepYUp(p: PointCloudOctree): void {
    const m = p.material as unknown as { updateShaderSource(): void; vertexShader: string; needsUpdate: boolean };
    const regenerate = m.updateShaderSource.bind(m);
    // An own property shadows the prototype method, so potree-core's internal calls land here too.
    m.updateShaderSource = () => {
      regenerate();
      m.vertexShader = yUpElevation(m.vertexShader);
      m.needsUpdate = true;
    };
    m.updateShaderSource();
  }

  function applyColour(): void {
    if (!pco) return;
    const m = pco.material;
    const newFormat = usesNewFormat(colour, octreeV2);
    if (m.newFormat !== newFormat) {
      m.newFormat = newFormat;
      m.updateShaderSource();
    }
    m.pointColorType = COLOR_TYPE[colour] as M["pointColorType"];
    if (colour === "elevation") {
      const b = pco.getBoundingBoxWorld();
      m.elevationRange = [b.min.y, b.max.y];
    }
    parts?.requestRender();
  }

  return {
    id: `cloud:${o.cloud.id}`,
    label: o.cloud.name,
    cloudId: o.cloud.id,
    status,
    attach(e: SiteEngine) {
      parts = partsOf(e);
      if (!o.cloud.same_crs) {
        status.set({ kind: "unavailable", reason: CANT_PLACE });
        return;
      }
      if (!o.frame) {
        status.set({ kind: "unavailable", reason: NO_FRAME });
        return;
      }
      group.matrix.copy(siteToSceneMatrix(o.frame, o.cloud.z_offset_m));
      group.matrixWorldNeedsUpdate = true;
      parts.scene.add(group);
      status.set({ kind: "loading" });
      const url = new URL(o.cloud.octree_url, o.baseUrl).toString();
      return o.host.load(metadataUrl(url), makeRequestManager(o.token)).then(
        (loaded) => {
          if (disposed) {
            disposePointsGeometries(loaded);
            loaded.dispose();
            return;
          }
          octreeV2 = loaded.material.newFormat;
          keepYUp(loaded);
          // sRGB in and out, adaptive size: as the clouds workspace (materialOptions.ts)
          loaded.material.inputColorEncoding = 1 as M["inputColorEncoding"];
          loaded.material.outputColorEncoding = 1 as M["outputColorEncoding"];
          loaded.material.pointSizeType = 2 as M["pointSizeType"];
          group.add(loaded);
          pco = loaded;
          o.host.add(loaded);
          applyColour();
          status.set({ kind: "ready" });
        },
        (err: unknown) => {
          if (disposed) return;
          const why = err instanceof Error ? err.message : String(err);
          status.set({ kind: "error", message: `The cloud could not load: ${why}` });
        },
      );
    },
    detach() {
      disposed = true;
      if (pco) {
        o.host.remove(pco);
        group.remove(pco);
        disposePointsGeometries(pco);
        pco.dispose();
        pco = null;
      }
      parts?.scene.remove(group);
      parts = null;
    },
    setVisible(v) {
      group.visible = v;
      parts?.requestRender();
    },
    update(_dt, camera) {
      if (!pco || !parts) return;
      if (o.host.update(camera, parts.renderer, parts.renderer.info.render.frame)) parts.requestRender();
    },
    setColour(c) {
      colour = c;
      applyColour();
    },
    box: () => (pco ? pco.getBoundingBoxWorld() : null),
  };
}
```

- [ ] **Step 5: Run the tests**

Run: the Step 2 command. Expected: cloudHost 3 passed, cloud.layer 8 passed.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/site3d/layers/cloudHost.ts frontend/src/site3d/layers/cloudHost.test.ts frontend/src/site3d/layers/cloud.layer.ts frontend/src/site3d/layers/cloud.layer.test.ts
git commit -m "feat(site3d): point cloud layer placed by the plant grid, other-CRS clouds refused

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task S2-4: Sky layer

**Files:**
- Create: `frontend/src/site3d/layers/sky.layer.ts`
- Test: `frontend/src/site3d/layers/sky.layer.test.ts`

**Interfaces:**
- Consumes: `partsOf`, `StatusCell`, `sunDirection` (Tasks 1–2); `tokenRgb`, `tokenColor` (`clouds/viewer/overlay.ts`); `Sky` (`three/examples/jsm/objects/Sky.js`).
- Produces: `createSkyLayer(o?: { background?: () => THREE.Color }): SkyLayer`, `SkyLayer.sun(): THREE.Vector3`, `SKY_SCALE`.

- [ ] **Step 1: Write the failing test**

`frontend/src/site3d/layers/sky.layer.test.ts`:

```ts
import * as THREE from "three";
import { Sky } from "three/examples/jsm/objects/Sky.js";
import { describe, expect, it } from "vitest";
import { fakeSiteEngine } from "@/test/fakeSiteEngine";
import { createSkyLayer } from "./sky.layer";

const BG = new THREE.Color(0.05, 0.06, 0.1);

describe("sky layer", () => {
  it("adds the sky, the sun and the hemisphere light, with no background behind the sky", () => {
    const { engine, scene } = fakeSiteEngine();
    const layer = createSkyLayer({ background: () => BG });
    layer.attach(engine);
    expect(scene.getObjectByName("site-sky")).toBeInstanceOf(Sky);
    expect(scene.getObjectByName("site-sun")).toBeInstanceOf(THREE.DirectionalLight);
    expect(scene.getObjectByName("site-hemisphere")).toBeInstanceOf(THREE.HemisphereLight);
    expect(scene.background).toBeNull();
    expect(layer.status.get()).toEqual({ kind: "ready" });
  });

  it("the sky's sun and the light point the same way", () => {
    const { engine, scene } = fakeSiteEngine();
    const layer = createSkyLayer({ background: () => BG });
    layer.attach(engine);
    const sky = scene.getObjectByName("site-sky") as Sky;
    const u = (sky.material as THREE.ShaderMaterial).uniforms.sunPosition.value as THREE.Vector3;
    expect(u.clone().normalize().distanceTo(layer.sun())).toBeLessThan(1e-9);
    const light = scene.getObjectByName("site-sun") as THREE.DirectionalLight;
    expect(light.position.clone().normalize().distanceTo(layer.sun())).toBeLessThan(1e-9);
  });

  it("off: the sky hides and the background is the token colour; the lights stay", () => {
    const { engine, scene, requestRender } = fakeSiteEngine();
    const layer = createSkyLayer({ background: () => BG });
    layer.attach(engine);
    requestRender.mockClear();
    layer.setVisible(false);
    expect(scene.getObjectByName("site-sky")!.visible).toBe(false);
    expect((scene.background as THREE.Color).equals(BG)).toBe(true);
    expect(scene.getObjectByName("site-sun")).toBeDefined();
    expect(requestRender).toHaveBeenCalled();
    layer.setVisible(true);
    expect(scene.background).toBeNull();
  });

  it("detach removes the sky and the lights and leaves the token background", () => {
    const { engine, scene } = fakeSiteEngine();
    const layer = createSkyLayer({ background: () => BG });
    layer.attach(engine);
    layer.detach();
    expect(scene.getObjectByName("site-sky")).toBeUndefined();
    expect(scene.getObjectByName("site-sun")).toBeUndefined();
    expect(scene.getObjectByName("site-hemisphere")).toBeUndefined();
    expect((scene.background as THREE.Color).equals(BG)).toBe(true);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm -C frontend exec vitest run src/site3d/layers/sky.layer.test.ts` → Expected: FAIL, module not found.

- [ ] **Step 3: Implement**

`frontend/src/site3d/layers/sky.layer.ts`:

```ts
import * as THREE from "three";
import { Sky } from "three/examples/jsm/objects/Sky.js";
import { tokenColor, tokenRgb } from "@/clouds/viewer/overlay";
import type { SiteEngine } from "@/site3d/engine/SiteEngine";
import { partsOf, type EngineParts } from "./s1Bridge";
import { StatusCell, type StatusLayer } from "./status";
import { sunDirection } from "./sun";

/** The Sky box's half-size in metres; its shader pins depth to the far plane, so it never clips the site. */
export const SKY_SCALE = 450_000;

export interface SkyLayer extends StatusLayer {
  /** Unit vector towards the sun (scene frame); the water uses it for glitter. */
  sun(): THREE.Vector3;
}

/**
 * three's Sky with a sun and a matching hemisphere light (spec §11). Off, the sky hides and the
 * scene background is the `bg` token; the lights stay so the model stays lit. Colours and light
 * intensities here are physical scene values, not UI colours (DESIGN.md: colours from data).
 */
export function createSkyLayer(o: { background?: () => THREE.Color } = {}): SkyLayer {
  const status = new StatusCell({ kind: "ready" });
  const dir = sunDirection();
  const sky = new Sky();
  sky.name = "site-sky";
  sky.scale.setScalar(SKY_SCALE);
  sky.renderOrder = -10;
  const u = (sky.material as THREE.ShaderMaterial).uniforms;
  u.turbidity.value = 6;
  u.rayleigh.value = 1.4;
  u.mieCoefficient.value = 0.004;
  u.mieDirectionalG.value = 0.8;
  (u.sunPosition.value as THREE.Vector3).copy(dir);
  const sun = new THREE.DirectionalLight(0xfff1dc, 2.2);
  sun.name = "site-sun";
  sun.position.copy(dir).multiplyScalar(1000);
  const hemi = new THREE.HemisphereLight(0xe8f0ff, 0x6b5f4a, 0.45);
  hemi.name = "site-hemisphere";
  const background = o.background ?? (() => tokenColor(tokenRgb("bg")));
  let parts: EngineParts | null = null;
  let visible = true;

  const apply = () => {
    if (!parts) return;
    sky.visible = visible;
    parts.scene.background = visible ? null : background();
    parts.requestRender();
  };

  return {
    id: "sky",
    label: "Sky",
    status,
    sun: () => dir.clone(),
    attach(e: SiteEngine) {
      parts = partsOf(e);
      parts.scene.add(sky, sun, sun.target, hemi);
      apply();
    },
    detach() {
      if (parts) {
        parts.scene.remove(sky, sun, sun.target, hemi);
        parts.scene.background = background();
      }
      sky.geometry.dispose();
      (sky.material as THREE.Material).dispose();
      parts = null;
    },
    setVisible(v) {
      visible = v;
      apply();
    },
  };
}
```

- [ ] **Step 4: Run the test**

Run: the Step 2 command → Expected: 4 passed.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/site3d/layers/sky.layer.ts frontend/src/site3d/layers/sky.layer.test.ts
git commit -m "feat(site3d): sky layer with sun and hemisphere light; off shows the token background

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task S2-5: Water layer with shoreline foam, and the normals texture

**Files:**
- Create: `frontend/src/site3d/layers/shoreField.ts`, `frontend/src/site3d/layers/water.layer.ts`, `frontend/public/textures/waternormals.jpg`, `frontend/public/textures/LICENSE-three.txt`
- Test: `frontend/src/site3d/layers/shoreField.test.ts`, `frontend/src/site3d/layers/water.layer.test.ts`

**Interfaces:**
- Consumes: `partsOf`, `StatusCell`, `isReducedEffects`, `onEffectsChange`, `sunDirection` (Tasks 1–2); `isReducedMotion` (`@/ui`); `Water` (`three/examples/jsm/objects/Water.js`).
- Produces: `Box2`, `SHORE_GRID`, `SHORE_MAX_M`, `rasterTriangles`, `chamferDistance`, `shoreField`, `collectTriangles`, `flatGeometry`, `addFoam`, `createWaterLayer`, `WaterLayer.setModel(root)`, `NO_SEA`, `NO_MODEL`, `WATER_NORMALS_URL`.

Realism target (from the Cowork GLB, `kipic/KIPIC_AlZour_LNG_Plant.glb`): the `Sea` node is one mesh with `extras.type = "terrain"` at the sea level (EL ≈ 93.6 in Cowork's viewer, scene y ≈ −6.4); `Land_Platform` and `Mainland` are the land. The water must sit on the sea mesh's top (`maxY + 0.02 m`), show foam where land meets sea within ~3 m and bands to ~8 m, and keep the sun glitter of three's `Water`.

- [ ] **Step 1: Ship the normals texture with its licence**

Run from the worktree root (Git Bash):

```bash
mkdir -p frontend/public/textures
curl -sL -o frontend/public/textures/waternormals.jpg https://raw.githubusercontent.com/mrdoob/three.js/r180/examples/textures/waternormals.jpg
sha256sum frontend/public/textures/waternormals.jpg
```

Expected: `add9912b158a4fe9c12421745babe68c44c8af75631ac4837236cb2a03bc373f  frontend/public/textures/waternormals.jpg` (248 813 bytes). A different hash: stop and report.

Write `frontend/public/textures/LICENSE-three.txt`:

```text
waternormals.jpg
Source: https://raw.githubusercontent.com/mrdoob/three.js/r180/examples/textures/waternormals.jpg
sha256: add9912b158a4fe9c12421745babe68c44c8af75631ac4837236cb2a03bc373f
Fetched 2026-10-03 for the Site 3D water layer (frontend/src/site3d/layers/water.layer.ts).

The MIT License

Copyright © 2010-2025 three.js authors

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in
all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
THE SOFTWARE.
```

Vite copies `frontend/public/` into the bundle root; the packaged CSP (`img-src 'self'`) allows it.

- [ ] **Step 2: Write the failing tests**

`frontend/src/site3d/layers/shoreField.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { chamferDistance, rasterTriangles, shoreField, type Box2 } from "./shoreField";

const BOX: Box2 = { minX: 0, minZ: 0, maxX: 8, maxZ: 8 };
// the left half (x 0..4) as two triangles, flat [x, z, x, z, x, z] pairs
const LEFT = [0, 0, 4, 0, 4, 8, 0, 0, 4, 8, 0, 8];

describe("rasterTriangles", () => {
  it("marks the cells whose centres fall in a triangle", () => {
    const m = rasterTriangles(LEFT, BOX, 8);
    expect(Array.from(m.slice(0, 8))).toEqual([1, 1, 1, 1, 0, 0, 0, 0]);
    expect(m.reduce((a, b) => a + b, 0)).toBe(32);
  });
  it("ignores degenerate (zero-area) triangles: vertical walls projected flat", () => {
    expect(rasterTriangles([0, 0, 4, 0, 8, 0], BOX, 8).reduce((a, b) => a + b, 0)).toBe(0);
  });
});

describe("chamferDistance", () => {
  it("is 0 on the source and grows one cell per step away from it", () => {
    const d = chamferDistance(rasterTriangles(LEFT, BOX, 8), 8, 1);
    const row = Array.from(d.slice(8 * 3, 8 * 3 + 8));
    expect(row).toEqual([0, 0, 0, 0, 1, 2, 3, 4]);
  });
});

describe("shoreField", () => {
  it("encodes metres to land as 0..255 over 0..64 m", () => {
    const f = shoreField(LEFT, BOX, 8)!;
    expect(f[8 * 3 + 3]).toBe(0); // land
    expect(f[8 * 3 + 4]).toBe(Math.round((255 * 1) / 64)); // 1 m from land
  });
  it("is null without land, or with land outside the sea's box: no shoreline, no foam", () => {
    expect(shoreField([], BOX, 8)).toBeNull();
    expect(shoreField([20, 20, 30, 20, 30, 30], BOX, 8)).toBeNull();
  });
});
```

`frontend/src/site3d/layers/water.layer.test.ts` (Review Focus 2):

```ts
import * as THREE from "three";
import { Water } from "three/examples/jsm/objects/Water.js";
import { describe, expect, it } from "vitest";
import { fakeSiteEngine } from "@/test/fakeSiteEngine";
import { NO_MODEL, NO_SEA, collectTriangles, createWaterLayer, flatGeometry } from "./water.layer";

/** A GLB root like A1's: environment nodes carry `extras.env` (GLTFLoader puts extras in userData). */
function plantRoot({ sea = true, land = true } = {}) {
  const root = new THREE.Group();
  if (sea) {
    const s = new THREE.Mesh(new THREE.PlaneGeometry(400, 400).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial());
    s.name = "environment/sea-1";
    s.userData.env = "sea";
    s.position.set(0, -6, 250); // z 50..450: runs 50 m under the land's edge, like Cowork's Sea
    root.add(s);
  }
  if (land) {
    const g = new THREE.Group();
    g.userData.env = "land"; // the extras sit on the parent node, the mesh is its child
    g.add(new THREE.Mesh(new THREE.BoxGeometry(400, 6, 200), new THREE.MeshBasicMaterial()));
    g.position.set(0, -3, 0);
    root.add(g);
  }
  return root;
}
const opts = { normals: () => new THREE.Texture(), reduced: () => false };

describe("water layer", () => {
  it("no model yet: unavailable with a reason, nothing drawn", () => {
    const { engine, scene } = fakeSiteEngine();
    const layer = createWaterLayer(opts);
    layer.attach(engine);
    expect(layer.status.get()).toEqual({ kind: "unavailable", reason: NO_MODEL });
    expect(scene.getObjectByName("site-water")).toBeUndefined();
  });

  it("no sea: unavailable, never throws", () => {
    const { engine, scene } = fakeSiteEngine();
    const layer = createWaterLayer(opts);
    layer.attach(engine);
    layer.setModel(plantRoot({ sea: false }));
    expect(layer.status.get()).toEqual({ kind: "unavailable", reason: NO_SEA });
    expect(scene.getObjectByName("site-water")).toBeUndefined();
  });

  it("sea and land: three Water on the sea's top, foam from the shoreline, the sea node hidden", () => {
    const { engine, scene } = fakeSiteEngine();
    const root = plantRoot();
    const layer = createWaterLayer(opts);
    layer.attach(engine);
    layer.setModel(root);
    const water = scene.getObjectByName("site-water") as Water;
    expect(water).toBeInstanceOf(Water);
    expect(water.position.y).toBeCloseTo(-5.98, 6);
    const mat = water.material as THREE.ShaderMaterial;
    expect(mat.fragmentShader).toContain("uniform sampler2D shoreSampler;");
    expect(mat.fragmentShader).toContain("mix( outgoingLight, foamColor");
    expect(mat.uniforms.shoreSampler.value).toBeInstanceOf(THREE.DataTexture);
    expect(root.getObjectByName("environment/sea-1")!.visible).toBe(false);
    expect(layer.status.get()).toEqual({ kind: "ready" });
  });

  it("sea without land: water without foam", () => {
    const { engine, scene } = fakeSiteEngine();
    const layer = createWaterLayer(opts);
    layer.attach(engine);
    layer.setModel(plantRoot({ land: false }));
    const mat = (scene.getObjectByName("site-water") as THREE.Mesh).material as THREE.ShaderMaterial;
    expect(mat.fragmentShader).not.toContain("shoreSampler");
  });

  it("reduced effects: flat water, no mirror pass", () => {
    const { engine, scene } = fakeSiteEngine();
    const layer = createWaterLayer({ ...opts, reduced: () => true });
    layer.attach(engine);
    layer.setModel(plantRoot());
    const mesh = scene.getObjectByName("site-water") as THREE.Mesh;
    expect(mesh).not.toBeInstanceOf(Water);
    expect(mesh.material).toBeInstanceOf(THREE.MeshStandardMaterial);
    expect(layer.status.get()).toEqual({ kind: "ready", note: "Flat water (reduced effects)" });
  });

  it("off: the water hides and the model's own sea shows again; detach restores it too", () => {
    const { engine, scene } = fakeSiteEngine();
    const root = plantRoot();
    const layer = createWaterLayer(opts);
    layer.attach(engine);
    layer.setModel(root);
    layer.setVisible(false);
    expect(scene.getObjectByName("site-water")!.visible).toBe(false);
    expect(root.getObjectByName("environment/sea-1")!.visible).toBe(true);
    layer.setVisible(true);
    layer.detach();
    expect(scene.getObjectByName("site-water")).toBeUndefined();
    expect(root.getObjectByName("environment/sea-1")!.visible).toBe(true);
  });

  it("collects a Cowork-style 'Sea' node by name and the land by an ancestor's extras", () => {
    const root = plantRoot({ sea: false });
    const s = new THREE.Mesh(new THREE.PlaneGeometry(10, 10).rotateX(-Math.PI / 2));
    s.name = "Sea";
    root.add(s);
    expect(collectTriangles(root, (n) => n.name === "Sea" || n.userData.env === "sea").tris.length).toBe(12);
    expect(collectTriangles(root, (n) => n.userData.env === "land").meshes).toHaveLength(1);
  });

  it("flatGeometry faces up once laid flat, whatever the source winding", () => {
    const g = flatGeometry([0, 0, 0, 10, 10, 0]); // clockwise seen from above
    const m = new THREE.Mesh(g);
    m.rotation.x = -Math.PI / 2;
    m.updateMatrixWorld();
    g.computeVertexNormals();
    const n = new THREE.Vector3().fromBufferAttribute(g.getAttribute("normal"), 0).transformDirection(m.matrixWorld);
    expect(n.y).toBeCloseTo(1, 6);
  });
});
```

- [ ] **Step 3: Run them to verify they fail**

Run: `pnpm -C frontend exec vitest run src/site3d/layers/shoreField.test.ts src/site3d/layers/water.layer.test.ts` → Expected: FAIL, modules not found.

- [ ] **Step 4: Implement the shore field**

`frontend/src/site3d/layers/shoreField.ts`:

```ts
/** A horizontal box in scene metres (x plant north, z plant east). */
export interface Box2 {
  minX: number;
  minZ: number;
  maxX: number;
  maxZ: number;
}

/** The foam texture's size: 512² cells, computed once per model load (Ruling 1). */
export const SHORE_GRID = 512;
/** The distance the texture encodes (0..255 ↔ 0..64 m from land). */
export const SHORE_MAX_M = 64;

/** Cells (row-major, row = z) whose centres fall inside any triangle of `tris` ([x, z] × 3 per triangle). */
export function rasterTriangles(tris: ArrayLike<number>, box: Box2, size: number): Uint8Array {
  const out = new Uint8Array(size * size);
  const sx = (box.maxX - box.minX) / size;
  const sz = (box.maxZ - box.minZ) / size;
  for (let t = 0; t + 5 < tris.length; t += 6) {
    const ax = tris[t], az = tris[t + 1], bx = tris[t + 2], bz = tris[t + 3], cx = tris[t + 4], cz = tris[t + 5];
    const d = (bz - cz) * (ax - cx) + (cx - bx) * (az - cz);
    if (Math.abs(d) < 1e-9) continue;
    const i0 = Math.max(0, Math.floor((Math.min(ax, bx, cx) - box.minX) / sx));
    const i1 = Math.min(size - 1, Math.floor((Math.max(ax, bx, cx) - box.minX) / sx));
    const j0 = Math.max(0, Math.floor((Math.min(az, bz, cz) - box.minZ) / sz));
    const j1 = Math.min(size - 1, Math.floor((Math.max(az, bz, cz) - box.minZ) / sz));
    for (let j = j0; j <= j1; j++) {
      const pz = box.minZ + (j + 0.5) * sz;
      for (let i = i0; i <= i1; i++) {
        const px = box.minX + (i + 0.5) * sx;
        const l1 = ((bz - cz) * (px - cx) + (cx - bx) * (pz - cz)) / d;
        const l2 = ((cz - az) * (px - cx) + (ax - cx) * (pz - cz)) / d;
        if (l1 >= 0 && l2 >= 0 && l1 + l2 <= 1) out[j * size + i] = 1;
      }
    }
  }
  return out;
}

/** Two-pass 3-4 chamfer distance (metres) to the nearest source cell; exact along rows and columns. */
export function chamferDistance(source: Uint8Array, size: number, cellM: number): Float32Array {
  const d = new Float32Array(size * size);
  for (let k = 0; k < d.length; k++) d[k] = source[k] ? 0 : 1e9;
  const a = cellM;
  const b = cellM * Math.SQRT2;
  for (let j = 0; j < size; j++)
    for (let i = 0; i < size; i++) {
      const k = j * size + i;
      let v = d[k];
      if (i > 0) v = Math.min(v, d[k - 1] + a);
      if (j > 0) {
        v = Math.min(v, d[k - size] + a);
        if (i > 0) v = Math.min(v, d[k - size - 1] + b);
        if (i < size - 1) v = Math.min(v, d[k - size + 1] + b);
      }
      d[k] = v;
    }
  for (let j = size - 1; j >= 0; j--)
    for (let i = size - 1; i >= 0; i--) {
      const k = j * size + i;
      let v = d[k];
      if (i < size - 1) v = Math.min(v, d[k + 1] + a);
      if (j < size - 1) {
        v = Math.min(v, d[k + size] + a);
        if (i < size - 1) v = Math.min(v, d[k + size + 1] + b);
        if (i > 0) v = Math.min(v, d[k + size - 1] + b);
      }
      d[k] = v;
    }
  return d;
}

/**
 * Metres to land over `box` (the sea's box), as bytes 0..255 for 0..SHORE_MAX_M; null when no land
 * falls in the box. Land wins where both cover a cell: a sea mesh often runs under the quay and the
 * land platform (Cowork's `Sea` does), and the shoreline is where the land ends, not where the sea does.
 */
export function shoreField(land: ArrayLike<number>, box: Box2, size = SHORE_GRID): Uint8Array | null {
  if (land.length === 0) return null;
  const landMask = rasterTriangles(land, box, size);
  if (!landMask.some((v) => v === 1)) return null;
  const cell = Math.max((box.maxX - box.minX) / size, (box.maxZ - box.minZ) / size);
  const dist = chamferDistance(landMask, size, cell);
  const out = new Uint8Array(size * size);
  for (let k = 0; k < out.length; k++) out[k] = Math.round(255 * Math.min(1, dist[k] / SHORE_MAX_M));
  return out;
}
```

Note: in the `shoreField` test the land row value at column 3 is `0` and column 4 is `1 m`.

- [ ] **Step 5: Implement the water layer**

`frontend/src/site3d/layers/water.layer.ts`:

```ts
import * as THREE from "three";
import { Water } from "three/examples/jsm/objects/Water.js";
import type { SiteEngine } from "@/site3d/engine/SiteEngine";
import { isReducedMotion } from "@/ui";
import { isReducedEffects, onEffectsChange } from "./effects";
import { partsOf, type EngineParts } from "./s1Bridge";
import { SHORE_GRID, SHORE_MAX_M, shoreField, type Box2 } from "./shoreField";
import { StatusCell, type StatusLayer } from "./status";
import { sunDirection } from "./sun";

export const NO_MODEL = "Water shows once the plant model has loaded.";
export const NO_SEA = "This model has no sea.";
export const WATER_NORMALS_URL = `${import.meta.env.BASE_URL}textures/waternormals.jpg`;
/** Physical scene colours (a Gulf shallow sea), not UI colours. */
const WATER_COLOUR = 0x0b3d4a;
const FLAT_COLOUR = 0x1d5560;
const FOAM = new THREE.Color(0.86, 0.9, 0.92);
const LAND_ENVS = new Set(["land", "paved", "road", "laydown", "slope", "revetment"]);
const isSea = (n: THREE.Object3D) => n.userData?.env === "sea" || /^sea$/i.test(n.name);
const isLand = (n: THREE.Object3D) => LAND_ENVS.has(String(n.userData?.env));

/** The world triangles ([x, z] × 3 each) of the meshes `match` marks, itself or through an ancestor up to `root`. */
export function collectTriangles(
  root: THREE.Object3D,
  match: (o: THREE.Object3D) => boolean,
): { tris: number[]; maxY: number; box: Box2 | null; meshes: THREE.Mesh[] } {
  root.updateMatrixWorld(true);
  const tris: number[] = [];
  const meshes: THREE.Mesh[] = [];
  let maxY = -Infinity;
  let minX = Infinity, minZ = Infinity, maxX = -Infinity, maxZ = -Infinity;
  const v = new THREE.Vector3();
  const marked = (o: THREE.Object3D): boolean => {
    for (let n: THREE.Object3D | null = o; n; n = n === root ? null : n.parent) if (match(n)) return true;
    return false;
  };
  root.traverse((obj) => {
    const mesh = obj as THREE.Mesh;
    if (!mesh.isMesh || (mesh as unknown as THREE.InstancedMesh).isInstancedMesh || !marked(obj)) return;
    const pos = mesh.geometry.getAttribute("position");
    if (!pos) return;
    meshes.push(mesh);
    const index = mesh.geometry.getIndex();
    const count = index ? index.count : pos.count;
    for (let k = 0; k + 2 < count; k += 3)
      for (let c = 0; c < 3; c++) {
        v.fromBufferAttribute(pos, index ? index.getX(k + c) : k + c).applyMatrix4(mesh.matrixWorld);
        tris.push(v.x, v.z);
        maxY = Math.max(maxY, v.y);
        minX = Math.min(minX, v.x);
        maxX = Math.max(maxX, v.x);
        minZ = Math.min(minZ, v.z);
        maxZ = Math.max(maxZ, v.z);
      }
  });
  return { tris, maxY, box: tris.length ? { minX, minZ, maxX, maxZ } : null, meshes };
}

/**
 * The triangles laid in a local XY plane as (x, −z, 0), counter-clockwise, degenerate ones dropped.
 * The mesh is rotated −90° about X, so local (u, v) lands on world (u, 0, −v) and faces +Y, which is
 * what three's Water assumes for its mirror plane.
 */
export function flatGeometry(tris: ArrayLike<number>): THREE.BufferGeometry {
  const out: number[] = [];
  for (let t = 0; t + 5 < tris.length; t += 6) {
    const ax = tris[t], ay = -tris[t + 1];
    let bx = tris[t + 2], by = -tris[t + 3], cx = tris[t + 4], cy = -tris[t + 5];
    const cross = (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
    if (Math.abs(cross) < 1e-9) continue;
    if (cross < 0) [bx, by, cx, cy] = [cx, cy, bx, by];
    out.push(ax, ay, 0, bx, by, 0, cx, cy, 0);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.BufferAttribute(new Float32Array(out), 3));
  g.computeVertexNormals();
  return g;
}

const FOAM_UNIFORMS = "uniform sampler2D shoreSampler;\nuniform vec4 shoreBox;\nuniform vec3 foamColor;";
const FOAM_GLSL = /* glsl */ `
  vec2 shoreUv = clamp( ( worldPosition.xz - shoreBox.xy ) / ( shoreBox.zw - shoreBox.xy ), 0.0, 1.0 );
  float shoreM = texture2D( shoreSampler, shoreUv ).r * ${SHORE_MAX_M.toFixed(1)};
  float foamNoise = getNoise( worldPosition.xz * 4.0 ).x * 0.5 + 0.5;
  float foam = 1.0 - smoothstep( 0.0, 2.5 + foamNoise * 2.0, shoreM );
  foam += smoothstep( 0.72, 1.0, sin( shoreM * 1.5 - time * 1.6 ) * 0.5 + 0.5 ) * ( 1.0 - smoothstep( 1.5, 8.0, shoreM ) ) * 0.55;
  outgoingLight = mix( outgoingLight, foamColor, clamp( foam, 0.0, 1.0 ) );
  gl_FragColor = vec4( outgoingLight, alpha );`;

/** Shoreline foam (Ruling 1) spliced into three 0.180's Water fragment shader. */
export function addFoam(material: THREE.ShaderMaterial, field: THREE.DataTexture, box: Box2): void {
  const src = material.fragmentShader;
  if (!src.includes("uniform vec3 waterColor;") || !src.includes("gl_FragColor = vec4( outgoingLight, alpha );"))
    throw new Error("three's Water shader changed: re-check addFoam against three 0.180.0");
  material.uniforms.shoreSampler = { value: field };
  material.uniforms.shoreBox = { value: new THREE.Vector4(box.minX, box.minZ, box.maxX, box.maxZ) };
  material.uniforms.foamColor = { value: FOAM };
  material.fragmentShader = src
    .replace("uniform vec3 waterColor;", `uniform vec3 waterColor;\n${FOAM_UNIFORMS}`)
    .replace("gl_FragColor = vec4( outgoingLight, alpha );", FOAM_GLSL);
  material.needsUpdate = true;
}

export interface WaterLayer extends StatusLayer {
  /** The loaded plant GLB (S1's model layer), or null; rebuilds the water. */
  setModel(root: THREE.Object3D | null): void;
}

export function createWaterLayer(
  o: { normals?: () => THREE.Texture; reduced?: () => boolean; sun?: () => THREE.Vector3 } = {},
): WaterLayer {
  const status = new StatusCell({ kind: "unavailable", reason: NO_MODEL });
  const reduced = o.reduced ?? isReducedEffects;
  const sun = o.sun ?? (() => sunDirection());
  const loadNormals =
    o.normals ??
    (() => {
      const t = new THREE.TextureLoader().load(WATER_NORMALS_URL, () => parts?.requestRender());
      t.wrapS = t.wrapT = THREE.RepeatWrapping;
      return t;
    });
  let parts: EngineParts | null = null;
  let root: THREE.Object3D | null = null;
  let mesh: THREE.Mesh | null = null;
  let seaMeshes: THREE.Mesh[] = [];
  let shoreTex: THREE.DataTexture | null = null;
  let normals: THREE.Texture | null = null;
  let visible = true;
  let stopEffects = () => {};

  const clear = () => {
    if (mesh) {
      parts?.scene.remove(mesh);
      mesh.geometry.dispose();
      const m = mesh.material as THREE.ShaderMaterial;
      (m.uniforms?.mirrorSampler?.value as THREE.Texture | undefined)?.dispose();
      m.dispose();
      mesh = null;
    }
    shoreTex?.dispose();
    shoreTex = null;
    for (const s of seaMeshes) s.visible = true;
    seaMeshes = [];
  };

  const build = () => {
    clear();
    if (!parts) return;
    if (!root) {
      status.set({ kind: "unavailable", reason: NO_MODEL });
      return;
    }
    const sea = collectTriangles(root, isSea);
    if (!sea.box || sea.tris.length === 0) {
      status.set({ kind: "unavailable", reason: NO_SEA });
      return;
    }
    seaMeshes = sea.meshes;
    const geometry = flatGeometry(sea.tris);
    const flat = reduced();
    if (flat) {
      mesh = new THREE.Mesh(geometry, new THREE.MeshStandardMaterial({ color: FLAT_COLOUR, roughness: 0.35, metalness: 0 }));
    } else {
      normals ??= loadNormals();
      const water = new Water(geometry, {
        textureWidth: 512,
        textureHeight: 512,
        waterNormals: normals,
        sunDirection: sun(),
        sunColor: 0xfff1dc,
        waterColor: WATER_COLOUR,
        distortionScale: 3.7,
        fog: false,
      });
      const land = collectTriangles(root, isLand);
      const field = shoreField(land.tris, sea.box, SHORE_GRID);
      if (field) {
        shoreTex = new THREE.DataTexture(field, SHORE_GRID, SHORE_GRID, THREE.RedFormat, THREE.UnsignedByteType);
        shoreTex.minFilter = shoreTex.magFilter = THREE.LinearFilter;
        shoreTex.needsUpdate = true;
        addFoam(water.material as THREE.ShaderMaterial, shoreTex, sea.box);
      }
      mesh = water;
    }
    mesh.name = "site-water";
    mesh.rotation.x = -Math.PI / 2;
    mesh.position.y = sea.maxY + 0.02;
    mesh.renderOrder = -5;
    mesh.visible = visible;
    for (const s of seaMeshes) s.visible = !visible;
    parts.scene.add(mesh);
    status.set(flat ? { kind: "ready", note: "Flat water (reduced effects)" } : { kind: "ready" });
    parts.requestRender();
  };

  return {
    id: "water",
    label: "Water",
    status,
    attach(e: SiteEngine) {
      parts = partsOf(e);
      stopEffects = onEffectsChange(build);
      build();
    },
    detach() {
      stopEffects();
      clear();
      normals?.dispose();
      normals = null;
      parts = null;
    },
    setVisible(v) {
      visible = v;
      if (mesh) mesh.visible = v;
      for (const s of seaMeshes) s.visible = !v;
      parts?.requestRender();
    },
    setModel(r) {
      root = r;
      build();
    },
    update(dt) {
      // Ruling 2: time moves only on frames the engine draws anyway, never under reduced motion.
      if (!(mesh instanceof Water) || isReducedMotion()) return;
      const u = (mesh.material as THREE.ShaderMaterial).uniforms;
      u.time.value = (u.time.value as number) + dt;
    },
  };
}
```

- [ ] **Step 6: Run the tests**

Run: the Step 3 command → Expected: shoreField 5 passed, water.layer 8 passed. If "sea and land" fails on `position.y`, the plane's top is at `-6`: the expectation `-5.98` is `maxY + 0.02`.

- [ ] **Step 7: Commit**

```bash
git add frontend/public/textures/waternormals.jpg frontend/public/textures/LICENSE-three.txt frontend/src/site3d/layers/shoreField.ts frontend/src/site3d/layers/shoreField.test.ts frontend/src/site3d/layers/water.layer.ts frontend/src/site3d/layers/water.layer.test.ts
git commit -m "feat(site3d): water on the model's sea with shoreline foam; flat under reduced effects

Ships three r180's waternormals.jpg (MIT), source and sha256 in LICENSE-three.txt.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task S2-6: Photos layer (camera glyphs, instanced, ≤ 2 000)

**Files:**
- Create: `frontend/src/site3d/layers/photos.layer.ts`
- Test: `frontend/src/site3d/layers/photos.layer.test.ts`

**Interfaces:**
- Consumes: `partsOf`, `StatusCell`, `siteToSceneMatrix`, `screenNearest` (Tasks 1–2); `getCloudCameras` (`@/api/cloudCameras`), `messageOf` (`@/api/errors`), `tokenRgb`/`tokenColor`.
- Produces: `PHOTO_GLYPH_CAP`, `photosCloudId`, `capIndices`, `viewDirSite`, `createPhotosLayer`, `PhotosLayer.hit(clientX, clientY)`, `NO_PHOTOS`, `PHOTOS_NO_FRAME`, `PHOTOS_OTHER_CRS`.

The camera arrays (`CloudCameraSet`, contract line ~10775) are in the cloud's native CRS: `x, y` site, `z` = EXIF altitude plus the set's height offset in the cloud's vertical frame, `yaw` clockwise from grid north, `pitch` −90 = nadir. So the glyph position uses the same matrix as the cloud (`siteToSceneMatrix(frame, cloud.z_offset_m)`).

- [ ] **Step 1: Write the failing test** (Review Focus 3)

`frontend/src/site3d/layers/photos.layer.test.ts`:

```ts
import * as THREE from "three";
import { waitFor } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { fakeClient } from "@/test/fixtures";
import { fakeSiteEngine } from "@/test/fakeSiteEngine";
import { FRAME, cloudRow, sceneWith } from "@/test/siteSceneFixtures";
import {
  NO_PHOTOS,
  PHOTOS_OTHER_CRS,
  PHOTO_GLYPH_CAP,
  capIndices,
  createPhotosLayer,
  photosCloudId,
  viewDirSite,
} from "./photos.layer";

const URL_ = "/api/v1/projects/p/pointclouds/c1/cameras";
function cameras(n: number, o: { noZ?: number; unposed?: number } = {}) {
  const fill = <T,>(v: T) => Array.from({ length: n }, () => v);
  return {
    image_id: Array.from({ length: n }, (_, i) => `img-${i}`),
    source_idx: fill(0),
    x: Array.from({ length: n }, (_, i) => FRAME.origin_crs[0] + i),
    y: fill(FRAME.origin_crs[1]),
    z: Array.from({ length: n }, (_, i) => (i < (o.noZ ?? 0) ? null : 40)),
    yaw: Array.from({ length: n }, (_, i) => (i < (o.unposed ?? 0) ? null : 90)),
    pitch: Array.from({ length: n }, (_, i) => (i < (o.unposed ?? 0) ? null : -45)),
    roll: fill(0),
    hfov: fill(73.7),
    vfov: fill(53.1),
    fov_assumed: fill(false),
    width: fill(2048),
    height: fill(1536),
    sigma_m: fill(3),
    sources: [{ id: "s1", label: "Flight", count: n, height_offset_m: 0, posed_count: n }],
    truncated: false,
    z_p1: 0,
    z_p99: 50,
    without_gps: 0,
  };
}
function setup(body: object, scene = sceneWith({ clouds: [cloudRow()], photos: { count: 3, url: URL_ } })) {
  const { api, requests } = fakeClient([{ method: "GET", path: /\/pointclouds\/c1\/cameras$/, body }] as never);
  const f = fakeSiteEngine();
  const layer = createPhotosLayer({ api, projectId: "p", frame: FRAME, scene });
  layer.attach(f.engine);
  return { ...f, layer, requests };
}
const glyphs = (scene: THREE.Scene) => scene.getObjectByName("site-photos") as THREE.InstancedMesh;

describe("photos layer helpers", () => {
  it("reads the cloud id out of the scene's photos URL", () => {
    expect(photosCloudId(URL_)).toBe("c1");
    expect(photosCloudId(`${URL_}?token=t`)).toBe("c1");
    expect(photosCloudId("/api/v1/projects/p/images")).toBeNull();
    expect(photosCloudId(null)).toBeNull();
  });
  it("samples evenly down to the cap and keeps order", () => {
    const idx = Array.from({ length: 5000 }, (_, i) => i);
    const out = capIndices(idx, PHOTO_GLYPH_CAP);
    expect(out).toHaveLength(2000);
    expect(out[0]).toBe(0);
    expect(out.every((v, i) => i === 0 || v > out[i - 1])).toBe(true);
    expect(capIndices([1, 2, 3], 2000)).toEqual([1, 2, 3]);
  });
  it("turns yaw/pitch into a site view direction; no pose looks straight down", () => {
    const north = viewDirSite(0, 0);
    expect([north.x, north.y, north.z].map((v) => +v.toFixed(9))).toEqual([0, 1, 0]);
    expect(viewDirSite(90, -90).z).toBeCloseTo(-1, 9);
    expect(viewDirSite(null, null).toArray()).toEqual([0, 0, -1]);
  });
});

describe("photos layer", () => {
  it("draws one glyph per photo with an altitude and counts the ones without", async () => {
    const { layer, scene } = setup(cameras(3, { noZ: 1 }));
    await waitFor(() => expect(layer.status.get().kind).toBe("ready"));
    expect(glyphs(scene).count).toBe(2);
    expect(layer.status.get()).toEqual({ kind: "ready", note: "1 without an altitude" });
  });

  it("caps at 2 000 glyphs and says so", async () => {
    const { layer, scene } = setup(cameras(2500));
    await waitFor(() => expect(layer.status.get().kind).toBe("ready"));
    expect(glyphs(scene).count).toBe(2000);
    expect(layer.status.get()).toEqual({ kind: "ready", note: "Showing 2,000 of 2,500 photos" });
  });

  it("a photo with no gimbal angles points its glyph straight down", async () => {
    const { layer, scene } = setup(cameras(1, { unposed: 1 }));
    await waitFor(() => expect(layer.status.get().kind).toBe("ready"));
    const m = new THREE.Matrix4();
    glyphs(scene).getMatrixAt(0, m);
    const q = new THREE.Quaternion();
    m.decompose(new THREE.Vector3(), q, new THREE.Vector3());
    const look = new THREE.Vector3(0, -1, 0).applyQuaternion(q);
    expect(look.y).toBeCloseTo(-1, 6);
  });

  it("a scene without posed photos never asks for cameras", () => {
    const { layer, requests } = setup(cameras(1), sceneWith({ clouds: [cloudRow()] }));
    expect(layer.status.get()).toEqual({ kind: "unavailable", reason: NO_PHOTOS });
    expect(requests).toHaveLength(0);
  });

  it("photos of a cloud in another CRS are not placed", () => {
    const { layer, requests } = setup(
      cameras(1),
      sceneWith({ clouds: [cloudRow({ same_crs: false })], photos: { count: 1, url: URL_ } }),
    );
    expect(layer.status.get()).toEqual({ kind: "unavailable", reason: PHOTOS_OTHER_CRS });
    expect(requests).toHaveLength(0);
  });

  it("a click on a glyph names its photo; hidden glyphs are never hit", async () => {
    const { layer, camera } = setup(cameras(1));
    await waitFor(() => expect(layer.status.get().kind).toBe("ready"));
    // glyph 0 is at the plant origin, cloud z 40 → EL 160.45 → scene y 60.45
    camera.position.set(0, 160, 0);
    camera.lookAt(0, 60.45, 0);
    camera.updateMatrixWorld();
    camera.updateProjectionMatrix();
    expect(layer.hit(100, 100)).toEqual({ imageId: "img-0" });
    layer.setVisible(false);
    expect(layer.hit(100, 100)).toBeNull();
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm -C frontend exec vitest run src/site3d/layers/photos.layer.test.ts` → Expected: FAIL, module not found.

- [ ] **Step 3: Implement**

`frontend/src/site3d/layers/photos.layer.ts`:

```ts
import * as THREE from "three";
import type { ApiClient, CloudCameraSet } from "@contract/client";
import { getCloudCameras } from "@/api/cloudCameras";
import { messageOf } from "@/api/errors";
import { tokenColor, tokenRgb } from "@/clouds/viewer/overlay";
import type { SiteEngine } from "@/site3d/engine/SiteEngine";
import type { SiteFrameT } from "@/site3d/engine/siteTransform";
import { partsOf, type EngineParts } from "./s1Bridge";
import { siteToSceneMatrix } from "./sceneMatrix";
import type { SiteScene } from "./sceneTypes";
import { screenNearest } from "./screenPick";
import { StatusCell, type StatusLayer } from "./status";

/** Spec §11 / index: ≤ 2 000 glyphs, instanced. */
export const PHOTO_GLYPH_CAP = 2000;
/** A glyph's length along the view direction, metres (the clouds workspace's GLYPH_DEPTH_M). */
const GLYPH_M = 3;
export const NO_PHOTOS = "No posed photos in this project.";
export const PHOTOS_NO_FRAME = "Photos need the site's plant grid.";
export const PHOTOS_OTHER_CRS = "The photos' point cloud is in a different coordinate system from the site.";
const fmt = new Intl.NumberFormat("en-GB");

/** The cloud whose cameras the scene's `photos.url` names (`…/pointclouds/{id}/cameras`), else null (Ruling 7). */
export function photosCloudId(url: string | null | undefined): string | null {
  const m = /\/pointclouds\/([^/?#]+)\/cameras(?:[?#]|$)/.exec(url ?? "");
  return m ? decodeURIComponent(m[1]) : null;
}

/** At most `cap` of `idx`, evenly spread, in order. */
export function capIndices(idx: readonly number[], cap: number): number[] {
  if (idx.length <= cap) return [...idx];
  const step = idx.length / cap;
  return Array.from({ length: cap }, (_, k) => idx[Math.floor(k * step)]);
}

/** Site-frame view direction (x east, y north, z up) from yaw (clockwise from grid north) and pitch; nadir without a pose. */
export function viewDirSite(yawDeg: number | null, pitchDeg: number | null): THREE.Vector3 {
  if (yawDeg == null || pitchDeg == null) return new THREE.Vector3(0, 0, -1);
  const y = THREE.MathUtils.degToRad(yawDeg);
  const p = THREE.MathUtils.degToRad(pitchDeg);
  return new THREE.Vector3(Math.sin(y) * Math.cos(p), Math.cos(y) * Math.cos(p), Math.sin(p));
}

export interface PhotosLayer extends StatusLayer {
  hit(clientX: number, clientY: number): { imageId: string } | null;
}

export function createPhotosLayer(o: {
  api: ApiClient;
  projectId: string;
  frame: SiteFrameT | null;
  scene: SiteScene;
}): PhotosLayer {
  const status = new StatusCell();
  // apex at the camera, base GLYPH_M ahead along local −Y; rotated so −Y is the view direction
  const geometry = new THREE.ConeGeometry(GLYPH_M * 0.4, GLYPH_M, 4).translate(0, -GLYPH_M / 2, 0);
  const DOWN = new THREE.Vector3(0, -1, 0);
  let parts: EngineParts | null = null;
  let mesh: THREE.InstancedMesh | null = null;
  let positions = new Float32Array(0);
  let ids: string[] = [];
  let visible = true;
  let alive = false;

  function place(set: CloudCameraSet, m: THREE.Matrix4): void {
    if (!parts) return;
    const withZ = set.image_id.map((_, i) => i).filter((i) => set.z[i] != null);
    const shown = capIndices(withZ, PHOTO_GLYPH_CAP);
    const linear = new THREE.Matrix3().setFromMatrix4(m);
    const material = new THREE.MeshBasicMaterial({ color: tokenColor(tokenRgb("info")), transparent: true, opacity: 0.85 });
    mesh = new THREE.InstancedMesh(geometry, material, Math.max(1, shown.length));
    mesh.count = shown.length;
    mesh.name = "site-photos";
    mesh.frustumCulled = false;
    mesh.visible = visible;
    positions = new Float32Array(shown.length * 3);
    ids = [];
    const p = new THREE.Vector3();
    const d = new THREE.Vector3();
    const q = new THREE.Quaternion();
    const one = new THREE.Vector3(1, 1, 1);
    const mat = new THREE.Matrix4();
    shown.forEach((i, k) => {
      p.set(set.x[i], set.y[i], set.z[i] as number).applyMatrix4(m);
      d.copy(viewDirSite(set.yaw[i], set.pitch[i])).applyMatrix3(linear).normalize();
      q.setFromUnitVectors(DOWN, d);
      mesh!.setMatrixAt(k, mat.compose(p, q, one));
      positions.set([p.x, p.y, p.z], k * 3);
      ids.push(set.image_id[i]);
    });
    mesh.instanceMatrix.needsUpdate = true;
    parts.scene.add(mesh);
    const notes: string[] = [];
    if (shown.length < withZ.length) notes.push(`Showing ${fmt.format(shown.length)} of ${fmt.format(withZ.length)} photos`);
    const noZ = set.image_id.length - withZ.length;
    if (noZ > 0) notes.push(`${fmt.format(noZ)} without an altitude`);
    status.set(notes.length ? { kind: "ready", note: notes.join("; ") } : { kind: "ready" });
    parts.requestRender();
  }

  function load(): void {
    const cloudId = photosCloudId(o.scene.photos.url);
    if (!o.frame) return status.set({ kind: "unavailable", reason: PHOTOS_NO_FRAME });
    if (o.scene.photos.count === 0 || !cloudId) return status.set({ kind: "unavailable", reason: NO_PHOTOS });
    const cloud = o.scene.clouds.find((c) => c.id === cloudId);
    if (!cloud || !cloud.same_crs) return status.set({ kind: "unavailable", reason: PHOTOS_OTHER_CRS });
    const m = siteToSceneMatrix(o.frame, cloud.z_offset_m);
    status.set({ kind: "loading" });
    getCloudCameras(o.api, o.projectId, cloudId).then(
      (set) => {
        if (alive) place(set, m);
      },
      (e: unknown) => {
        if (alive) status.set({ kind: "error", message: messageOf(e, "The photo positions could not be loaded.") });
      },
    );
  }

  return {
    id: "photos",
    label: "Photos",
    status,
    attach(e: SiteEngine) {
      parts = partsOf(e);
      alive = true;
      load();
    },
    detach() {
      alive = false;
      if (mesh) {
        parts?.scene.remove(mesh);
        (mesh.material as THREE.Material).dispose();
        mesh.dispose();
        mesh = null;
      }
      geometry.dispose();
      parts = null;
    },
    setVisible(v) {
      visible = v;
      if (mesh) mesh.visible = v;
      parts?.requestRender();
    },
    hit(clientX, clientY) {
      if (!mesh || !visible || !parts) return null;
      const i = screenNearest(positions, parts.camera, parts.canvas.getBoundingClientRect(), clientX, clientY);
      return i === null ? null : { imageId: ids[i] };
    },
  };
}
```

- [ ] **Step 4: Run the test**

Run: the Step 2 command → Expected: 9 passed.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/site3d/layers/photos.layer.ts frontend/src/site3d/layers/photos.layer.test.ts
git commit -m "feat(site3d): posed photo glyphs, instanced and capped at 2 000

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task S2-7: Findings layer (map and cloud findings as pins)

**Files:**
- Create: `frontend/src/site3d/layers/findings.layer.ts`
- Test: `frontend/src/site3d/layers/findings.layer.test.ts`

**Interfaces:**
- Consumes: `partsOf`, `StatusCell`, `siteToSceneMatrix`, `screenNearest` (Tasks 1–2); `siteToScene` (S1); `listMapFindingsInView` (`@/api/mapFindings`), `listCloudPins`, `pinCapNote` (`@/api/cloudFindings`); `DEFAULT_SEVERITY_SCALE`, `severityOf`, `SeverityLevel` (`@/ui`); `tokenRgb`, `tokenColor`.
- Produces: `MAP_PIN_CAP`, `geometryPoint`, `siteExtent`, `circleSprite`, `createFindingsLayer`, `FindingsLayer.hit(clientX, clientY)`, `NO_FINDINGS`, `FINDINGS_NO_FRAME`.

- [ ] **Step 1: Write the failing test**

`frontend/src/site3d/layers/findings.layer.test.ts`:

```ts
import * as THREE from "three";
import { waitFor } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { fakeClient } from "@/test/fixtures";
import { fakeSiteEngine } from "@/test/fakeSiteEngine";
import { FRAME, cloudRow, sceneWith } from "@/test/siteSceneFixtures";
import { NO_FINDINGS, createFindingsLayer, geometryPoint, siteExtent } from "./findings.layer";

const [OX, OY] = FRAME.origin_crs;
const mapPin = (id: string, severity: number | null, x = OX, y = OY) => ({
  id,
  number: 1,
  type_id: "t",
  severity,
  status: "open",
  created_by: "human",
  map_id: "m1",
  geometry_site: { type: "Point", coordinates: [x, y] },
});
const cloudFinding = (id: string) => ({
  id,
  severity: 2,
  anchor: { kind: "cloud", cloud_id: "c1", x: OX + 10, y: OY, z: -20.45, uncertainty_m: null },
});
const scene = sceneWith({ clouds: [cloudRow()], findings: { count: 2, url: null } });

function setup(routes: unknown[], s = scene) {
  const { api, requests } = fakeClient(routes as never);
  const f = fakeSiteEngine();
  const layer = createFindingsLayer({ api, projectId: "p", frame: FRAME, scene: s });
  layer.attach(f.engine);
  return { ...f, layer, requests };
}
const MAP = (items: unknown[], truncated = false) => ({ method: "GET", path: /\/map-workspace\/findings$/, body: { items, truncated } });
const CLOUD = (items: unknown[]) => ({ method: "GET", path: /\/findings$/, body: { items, next_cursor: null } });
const pins = (s: THREE.Scene) => s.getObjectByName("site-findings") as THREE.Points;

describe("findings layer helpers", () => {
  it("takes a point's coordinates and a polygon's ring centroid", () => {
    expect(geometryPoint({ type: "Point", coordinates: [1, 2] })).toEqual([1, 2]);
    expect(geometryPoint({ type: "Polygon", coordinates: [[[0, 0], [4, 0], [4, 2], [0, 2], [0, 0]]] })).toEqual([2, 1]);
    expect(geometryPoint({ type: "LineString", coordinates: [] })).toBeNull();
  });
  it("the site extent is the union of the orthos and drawings, else 1.5 km around the origin", () => {
    const s = sceneWith({
      orthos: [{ bounds_site: [0, 0, 10, 10] }] as never,
      drawings: [{ bounds_site: [-5, 2, 4, 20] }] as never,
    });
    expect(siteExtent(s, FRAME)).toEqual([-5, 0, 10, 20]);
    expect(siteExtent(sceneWith(), FRAME)).toEqual([OX - 1500, OY - 1500, OX + 1500, OY + 1500]);
  });
});

describe("findings layer", () => {
  it("a project without findings never reads them", () => {
    const { layer, requests } = setup([], sceneWith({ findings: { count: 0, url: null } }));
    expect(layer.status.get()).toEqual({ kind: "ready", note: NO_FINDINGS });
    expect(requests).toHaveLength(0);
  });

  it("pins map findings at the datum and cloud findings at their 3D spot, coloured by severity", async () => {
    const { layer, scene: s3 } = setup([MAP([mapPin("f1", 4)]), CLOUD([cloudFinding("f2")])]);
    await waitFor(() => expect(layer.status.get().kind).toBe("ready"));
    const p = pins(s3);
    const pos = p.geometry.getAttribute("position");
    expect(pos.count).toBe(2);
    expect([pos.getX(0), pos.getY(0), pos.getZ(0)].map((v) => +v.toFixed(4))).toEqual([0, 0, 0]);
    const col = p.geometry.getAttribute("color");
    const critical = new THREE.Color("#ff5a4f");
    expect(col.getX(0)).toBeCloseTo(critical.r, 5);
    expect(pos.getY(1)).toBeCloseTo(0, 4); // cloud z -20.45 + 120.45 = EL 100 = the datum
  });

  it("says when the map findings were cut at 5 000", async () => {
    const { layer } = setup([MAP([mapPin("f1", 1)], true), CLOUD([])]);
    await waitFor(() => expect(layer.status.get().kind).toBe("ready"));
    expect(layer.status.get()).toEqual({ kind: "ready", note: "Showing the first 5,000 map findings" });
  });

  it("every read failing is an error status, never an exception", async () => {
    const { layer } = setup([
      { method: "GET", path: /\/map-workspace\/findings$/, status: 500, body: { error: { code: "x", message: "boom", details: {} } } },
      { method: "GET", path: /\/findings$/, status: 500, body: { error: { code: "x", message: "boom", details: {} } } },
    ]);
    await waitFor(() => expect(layer.status.get().kind).toBe("error"));
    expect(layer.status.get()).toEqual({ kind: "error", message: "The findings could not be loaded." });
  });

  it("a click on a pin names its finding", async () => {
    const { layer, camera } = setup([MAP([mapPin("f1", 3)]), CLOUD([])]);
    await waitFor(() => expect(layer.status.get().kind).toBe("ready"));
    camera.position.set(0, 50, 0);
    camera.lookAt(0, 0, 0);
    camera.updateMatrixWorld();
    camera.updateProjectionMatrix();
    expect(layer.hit(100, 100)).toEqual({ findingId: "f1" });
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm -C frontend exec vitest run src/site3d/layers/findings.layer.test.ts` → Expected: FAIL, module not found.

- [ ] **Step 3: Implement**

`frontend/src/site3d/layers/findings.layer.ts`:

```ts
import * as THREE from "three";
import type { ApiClient } from "@contract/client";
import { listCloudPins, pinCapNote } from "@/api/cloudFindings";
import { listMapFindingsInView } from "@/api/mapFindings";
import { tokenColor, tokenRgb } from "@/clouds/viewer/overlay";
import type { SiteEngine } from "@/site3d/engine/SiteEngine";
import { siteToScene, type SiteFrameT } from "@/site3d/engine/siteTransform";
import { DEFAULT_SEVERITY_SCALE, severityOf, type SeverityLevel } from "@/ui";
import { partsOf, type EngineParts } from "./s1Bridge";
import { siteToSceneMatrix } from "./sceneMatrix";
import type { SiteScene } from "./sceneTypes";
import { screenNearest } from "./screenPick";
import { StatusCell, type StatusLayer } from "./status";

/** `listMapFindingsInView`'s own cap. */
export const MAP_PIN_CAP = 5000;
const PIN_PX = 14;
export const NO_FINDINGS = "No findings with a map or cloud spot.";
export const FINDINGS_NO_FRAME = "Findings need the site's plant grid.";
const fmt = new Intl.NumberFormat("en-GB");

/** A GeoJSON point's coordinates or a polygon's outer-ring centroid (vertex mean), in the site frame. */
export function geometryPoint(g: { type: string; coordinates: unknown }): [number, number] | null {
  if (g.type === "Point" && Array.isArray(g.coordinates)) {
    const [x, y] = g.coordinates as number[];
    return Number.isFinite(x) && Number.isFinite(y) ? [x, y] : null;
  }
  if (g.type === "Polygon" && Array.isArray(g.coordinates)) {
    const ring = ((g.coordinates as number[][][])[0] ?? []).filter((p) => p.length >= 2);
    const closed = ring.length > 1 && ring[0][0] === ring[ring.length - 1][0] && ring[0][1] === ring[ring.length - 1][1];
    const pts = closed ? ring.slice(0, -1) : ring;
    if (pts.length === 0) return null;
    return [pts.reduce((a, p) => a + p[0], 0) / pts.length, pts.reduce((a, p) => a + p[1], 0) / pts.length];
  }
  return null;
}

/** Where map findings are read: the orthos' and drawings' union, else 1.5 km around the plant origin. */
export function siteExtent(scene: SiteScene, frame: SiteFrameT): [number, number, number, number] {
  const boxes = [...scene.orthos.map((o) => o.bounds_site), ...scene.drawings.map((d) => d.bounds_site)].filter(
    (b): b is number[] => Array.isArray(b) && b.length === 4,
  );
  if (boxes.length === 0) {
    const [x, y] = frame.origin_crs;
    return [x - 1500, y - 1500, x + 1500, y + 1500];
  }
  return [
    Math.min(...boxes.map((b) => b[0])),
    Math.min(...boxes.map((b) => b[1])),
    Math.max(...boxes.map((b) => b[2])),
    Math.max(...boxes.map((b) => b[3])),
  ];
}

/** A round pin with a dark rim, as RGBA bytes (no 2D canvas: jsdom and the worker-free path both work). */
export function circleSprite(size = 32): THREE.DataTexture {
  const data = new Uint8Array(size * size * 4);
  const r = size / 2 - 1;
  for (let j = 0; j < size; j++)
    for (let i = 0; i < size; i++) {
      const d = Math.hypot(i + 0.5 - size / 2, j + 0.5 - size / 2);
      const k = (j * size + i) * 4;
      const rim = d > r - 3 && d <= r;
      data[k] = data[k + 1] = data[k + 2] = rim ? 24 : 255;
      data[k + 3] = d <= r ? 255 : 0;
    }
  const t = new THREE.DataTexture(data, size, size);
  t.needsUpdate = true;
  return t;
}

export interface FindingsLayer extends StatusLayer {
  hit(clientX: number, clientY: number): { findingId: string } | null;
}

interface Pin {
  id: string;
  severity: number | null;
  at: THREE.Vector3;
}

export function createFindingsLayer(o: {
  api: ApiClient;
  projectId: string;
  frame: SiteFrameT | null;
  scene: SiteScene;
  scale?: readonly SeverityLevel[];
}): FindingsLayer {
  const status = new StatusCell();
  const scale = o.scale ?? DEFAULT_SEVERITY_SCALE;
  let parts: EngineParts | null = null;
  let points: THREE.Points | null = null;
  let positions = new Float32Array(0);
  let ids: string[] = [];
  let visible = true;
  let alive = false;

  function draw(pins: Pin[]): void {
    if (!parts || pins.length === 0) return;
    positions = new Float32Array(pins.length * 3);
    const colours = new Float32Array(pins.length * 3);
    const fallback = tokenColor(tokenRgb("accent"));
    pins.forEach((p, k) => {
      positions.set([p.at.x, p.at.y, p.at.z], k * 3);
      const level = severityOf(scale, p.severity);
      const c = level ? new THREE.Color(level.colour) : fallback;
      colours.set([c.r, c.g, c.b], k * 3);
    });
    ids = pins.map((p) => p.id);
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    g.setAttribute("color", new THREE.BufferAttribute(colours, 3));
    const m = new THREE.PointsMaterial({ size: PIN_PX, sizeAttenuation: false, vertexColors: true, map: circleSprite(), alphaTest: 0.5 });
    points = new THREE.Points(g, m);
    points.name = "site-findings";
    points.renderOrder = 5;
    points.frustumCulled = false;
    points.visible = visible;
    parts.scene.add(points);
    parts.requestRender();
  }

  async function load(): Promise<void> {
    const frame = o.frame;
    if (!frame) return status.set({ kind: "unavailable", reason: FINDINGS_NO_FRAME });
    if (o.scene.findings.count === 0) return status.set({ kind: "ready", note: NO_FINDINGS });
    status.set({ kind: "loading" });
    const [minx, miny, maxx, maxy] = siteExtent(o.scene, frame);
    const clouds = o.scene.clouds.filter((c) => c.same_crs);
    const [map, ...perCloud] = await Promise.allSettled([
      listMapFindingsInView(o.api, o.projectId, { bbox: `${minx},${miny},${maxx},${maxy}` }),
      ...clouds.map((c) => listCloudPins(o.api, o.projectId, c.id)),
    ]);
    if (!alive) return;
    const pins: Pin[] = [];
    const notes: string[] = [];
    let failed = 0;
    if (map.status === "fulfilled") {
      for (const f of map.value.items.slice(0, MAP_PIN_CAP)) {
        const pt = geometryPoint(f.geometry_site);
        if (!pt) continue;
        const [x, y, z] = siteToScene(frame, pt[0], pt[1], frame.datum.el_m); // Ruling 8: at the datum
        pins.push({ id: f.id, severity: f.severity, at: new THREE.Vector3(x, y, z) });
      }
      if (map.value.truncated) notes.push(`Showing the first ${fmt.format(MAP_PIN_CAP)} map findings`);
    } else failed += 1;
    perCloud.forEach((r, k) => {
      if (r.status !== "fulfilled") {
        failed += 1;
        return;
      }
      const m = siteToSceneMatrix(frame, clouds[k].z_offset_m);
      for (const f of r.value.items) {
        const a = f.anchor;
        if (a.kind !== "cloud") continue;
        pins.push({ id: f.id, severity: f.severity, at: new THREE.Vector3(a.x, a.y, a.z).applyMatrix4(m) });
      }
      const note = pinCapNote(r.value);
      if (note) notes.push(`${clouds[k].name}: ${note}`);
    });
    if (failed === 1 + clouds.length) return status.set({ kind: "error", message: "The findings could not be loaded." });
    if (failed > 0) notes.push("Some findings could not be loaded");
    draw(pins);
    if (pins.length === 0) notes.unshift(NO_FINDINGS);
    status.set(notes.length ? { kind: "ready", note: notes.join("; ") } : { kind: "ready" });
  }

  return {
    id: "findings",
    label: "Findings",
    status,
    attach(e: SiteEngine) {
      parts = partsOf(e);
      alive = true;
      void load();
    },
    detach() {
      alive = false;
      if (points) {
        parts?.scene.remove(points);
        points.geometry.dispose();
        const m = points.material as THREE.PointsMaterial;
        m.map?.dispose();
        m.dispose();
        points = null;
      }
      parts = null;
    },
    setVisible(v) {
      visible = v;
      if (points) points.visible = v;
      parts?.requestRender();
    },
    hit(clientX, clientY) {
      if (!points || !visible || !parts) return null;
      const i = screenNearest(positions, parts.camera, parts.canvas.getBoundingClientRect(), clientX, clientY);
      return i === null ? null : { findingId: ids[i] };
    },
  };
}
```

If `listCloudPins`'s `Finding` type makes `a.x` optional (the contract's anchor union), narrow with `a.kind === "cloud"` as above; the generated `FindingCloudAnchor` has `x, y, z` required.

- [ ] **Step 4: Run the test**

Run: the Step 2 command → Expected: 7 passed.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/site3d/layers/findings.layer.ts frontend/src/site3d/layers/findings.layer.test.ts
git commit -m "feat(site3d): existing map and cloud findings as pins coloured by severity

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task S2-8: Wire the layers into the Site 3D screen, clicks, and an e2e check

**Files:**
- Create: `frontend/src/site3d/layers/useSiteExtraLayers.ts`, `frontend/src/site3d/layers/ExtraLayerStatus.tsx`, `frontend/e2e/fixtures/make_site_env.py`, `frontend/e2e/fixtures/site-env.glb` (generated), `frontend/e2e/fixtures/siteEnv.ts`, `frontend/e2e/site3d-env.spec.ts`
- Modify: `frontend/src/site3d/SiteScreen.tsx` (S1's; shared-file touch)
- Test: `frontend/src/site3d/layers/useSiteExtraLayers.test.tsx`

**Interfaces:**
- Consumes: every S2 layer (Tasks 3–7); `useApi`, `useBackend` (`@/api/client`); `writeBudget` (`@/clouds/viewer/budget`); `useSeverityScale` (`@/ui`); `findingPath` (`@/findings/links`); S1's `SiteScreen` variables recorded in Task 1.
- Produces: `useSiteExtraLayers`, `ExtraLayers`, `ExtraLayerRow`, `ExtraGroup`, `DEFAULT_ON`, `useExtraLayerClicks`, `useModelRoot`, `ModelRootSource`, `ExtraLayerStatus` (signatures in the header). S3 consumes `ExtraLayers` and `ExtraLayerRow`.

React rules here: `eslint-plugin-react-hooks` 7 is on (`set-state-in-effect`, `refs`). Layers are built in `useMemo` (constructors have no side effects outside their own objects); effects only attach, detach and push visibility into three objects; state changes come from event handlers or layer callbacks.

- [ ] **Step 1: Write the failing hook test**

`frontend/src/site3d/layers/useSiteExtraLayers.test.tsx`:

```tsx
import type { ReactNode } from "react";
import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { TestApiProvider } from "@/test/render";
import { fakeClient } from "@/test/fixtures";
import { fakeSiteEngine } from "@/test/fakeSiteEngine";
import { FRAME, cloudRow, sceneWith } from "@/test/siteSceneFixtures";
import { CANT_PLACE } from "./cloud.layer";
import { useExtraLayerClicks, useSiteExtraLayers } from "./useSiteExtraLayers";

const scene = sceneWith({ clouds: [cloudRow({ same_crs: false })] });
function setup() {
  const { api } = fakeClient([]);
  const f = fakeSiteEngine();
  const wrapper = ({ children }: { children: ReactNode }) => <TestApiProvider api={api}>{children}</TestApiProvider>;
  const hook = renderHook(
    () => useSiteExtraLayers({ engine: f.engine, scene, frame: FRAME, projectId: "p", modelRoot: null }),
    { wrapper },
  );
  return { ...f, hook, wrapper };
}

describe("useSiteExtraLayers", () => {
  it("adds the cloud, water, sky, photos and findings layers, photos off by default", () => {
    const { hook, raw } = setup();
    const rows = hook.result.current.rows;
    expect(rows.map((r) => [r.id, r.group, r.visible])).toEqual([
      ["cloud:c1", "Point clouds", true],
      ["water", "Environment", true],
      ["sky", "Environment", true],
      ["photos", "Data", false],
      ["findings", "Data", true],
    ]);
    expect(raw.addLayer).toHaveBeenCalledTimes(5);
    expect(rows[0].layer.status.get()).toEqual({ kind: "unavailable", reason: CANT_PLACE });
  });

  it("toggles a layer's visibility into the scene", () => {
    const { hook, scene: s3 } = setup();
    act(() => hook.result.current.setVisible("sky", false));
    expect(hook.result.current.rows.find((r) => r.id === "sky")!.visible).toBe(false);
    expect(s3.getObjectByName("site-sky")!.visible).toBe(false);
  });

  it("removes every layer when the screen goes", () => {
    const { hook, raw } = setup();
    hook.unmount();
    expect(raw.removeLayer).toHaveBeenCalledTimes(5);
  });

  it("the point budget is remembered and reaches the cloud host", () => {
    const { hook } = setup();
    act(() => hook.result.current.setBudget(5_000_000));
    expect(hook.result.current.budget).toBe(5_000_000);
    expect(localStorage.getItem("kestrel.clouds.pointBudget")).toBe("5000000");
  });
});

describe("useExtraLayerClicks", () => {
  it("a click (not a drag) on a pin opens its finding; a drag does nothing", () => {
    const { hook, engine, canvas, wrapper } = setup();
    const findings = hook.result.current.findings!;
    vi.spyOn(findings, "hit").mockReturnValue({ findingId: "f1" });
    const on = { photo: vi.fn(), finding: vi.fn() };
    renderHook(() => useExtraLayerClicks(engine, hook.result.current, on), { wrapper });
    canvas.dispatchEvent(new PointerEvent("pointerdown", { clientX: 10, clientY: 10, button: 0 }));
    canvas.dispatchEvent(new PointerEvent("pointerup", { clientX: 11, clientY: 10, button: 0 }));
    expect(on.finding).toHaveBeenCalledWith("f1");
    canvas.dispatchEvent(new PointerEvent("pointerdown", { clientX: 10, clientY: 10, button: 0 }));
    canvas.dispatchEvent(new PointerEvent("pointerup", { clientX: 60, clientY: 10, button: 0 }));
    expect(on.finding).toHaveBeenCalledTimes(1);
  });
});
```

jsdom has no `PointerEvent` before jsdom 22; this repo uses jsdom 30, which has it. If it is missing, use `new MouseEvent("pointerdown", …)`.

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm -C frontend exec vitest run src/site3d/layers/useSiteExtraLayers.test.tsx` → Expected: FAIL, module not found.

- [ ] **Step 3: Implement the hook and the status list**

`frontend/src/site3d/layers/useSiteExtraLayers.ts`:

```ts
import { useEffect, useMemo, useReducer, useRef, useState } from "react";
import type * as THREE from "three";
import { useApi, useBackend } from "@/api/client";
import { writeBudget } from "@/clouds/viewer/budget";
import type { SiteEngine } from "@/site3d/engine/SiteEngine";
import type { SiteFrameT } from "@/site3d/engine/siteTransform";
import { useSeverityScale } from "@/ui";
import { createCloudHost } from "./cloudHost";
import { createCloudLayer, type CloudColour, type CloudLayer } from "./cloud.layer";
import { createFindingsLayer, type FindingsLayer } from "./findings.layer";
import { createPhotosLayer, type PhotosLayer } from "./photos.layer";
import { partsOf } from "./s1Bridge";
import type { SiteScene } from "./sceneTypes";
import { createSkyLayer } from "./sky.layer";
import type { StatusLayer } from "./status";
import { createWaterLayer, type WaterLayer } from "./water.layer";

export type ExtraGroup = "Point clouds" | "Environment" | "Data";
export interface ExtraLayerRow {
  id: string;
  label: string;
  group: ExtraGroup;
  layer: StatusLayer;
  visible: boolean;
}
export interface ExtraLayers {
  rows: ExtraLayerRow[];
  setVisible(id: string, v: boolean): void;
  cloudColour: CloudColour;
  setCloudColour(c: CloudColour): void;
  budget: number;
  setBudget(n: number): void;
  photos: PhotosLayer | null;
  findings: FindingsLayer | null;
}
/** Ruling 17: photos start off (clutter); everything else on. Clouds are `cloud:<id>` and default on. */
export const DEFAULT_ON: Readonly<Record<string, boolean>> = { water: true, sky: true, photos: false, findings: true };
const CLICK_SLOP_PX = 4;
const NO_OVERRIDES: Readonly<Record<string, boolean>> = {};

interface LayerSet {
  rows: Omit<ExtraLayerRow, "visible">[];
  clouds: CloudLayer[];
  water: WaterLayer;
  photos: PhotosLayer;
  findings: FindingsLayer;
}

const shownOf = (vis: Readonly<Record<string, boolean>>, id: string) => vis[id] ?? DEFAULT_ON[id] ?? true;

export function useSiteExtraLayers(o: {
  engine: SiteEngine | null;
  scene: SiteScene | null;
  frame: SiteFrameT | null;
  projectId: string;
  modelRoot: THREE.Object3D | null;
}): ExtraLayers {
  const api = useApi();
  const { baseUrl, token } = useBackend();
  const scale = useSeverityScale();
  const { engine, scene, frame, projectId, modelRoot } = o;
  const host = useMemo(() => createCloudHost(), []);
  const set = useMemo<LayerSet | null>(() => {
    if (!scene) return null;
    const clouds = scene.clouds.map((cloud) => createCloudLayer({ cloud, frame, baseUrl, token, host }));
    const water = createWaterLayer();
    const sky = createSkyLayer();
    const photos = createPhotosLayer({ api, projectId, frame, scene });
    const findings = createFindingsLayer({ api, projectId, frame, scene, scale });
    return {
      clouds,
      water,
      photos,
      findings,
      rows: [
        ...clouds.map((l) => ({ id: l.id, label: l.label, group: "Point clouds" as const, layer: l })),
        { id: water.id, label: water.label, group: "Environment", layer: water },
        { id: sky.id, label: sky.label, group: "Environment", layer: sky },
        { id: photos.id, label: photos.label, group: "Data", layer: photos },
        { id: findings.id, label: findings.label, group: "Data", layer: findings },
      ],
    };
  }, [scene, frame, api, projectId, baseUrl, token, host, scale]);

  const [overrides, setOverrides] = useState<{ key: LayerSet | null; vis: Record<string, boolean> }>({ key: null, vis: {} });
  const vis = overrides.key === set ? overrides.vis : NO_OVERRIDES;
  const [, bump] = useReducer((n: number) => n + 1, 0);
  const [cloudColour, setCloudColourState] = useState<CloudColour>("rgb");
  const [budget, setBudgetState] = useState(() => host.budget());

  useEffect(() => {
    if (!engine || !set) return;
    const offs = set.rows.map((r) => r.layer.status.subscribe(() => bump()));
    for (const r of set.rows) engine.addLayer(r.layer); // S1's addLayer calls attach (Task 1)
    return () => {
      offs.forEach((off) => off());
      for (const r of set.rows) engine.removeLayer(r.id); // and removeLayer calls detach
    };
  }, [engine, set]);
  useEffect(() => {
    if (!set) return;
    for (const r of set.rows) r.layer.setVisible(shownOf(vis, r.id));
  }, [set, vis]);
  useEffect(() => {
    set?.water.setModel(modelRoot);
  }, [set, modelRoot]);
  useEffect(() => {
    set?.clouds.forEach((l) => l.setColour(cloudColour));
  }, [set, cloudColour]);

  return {
    rows: set ? set.rows.map((r) => ({ ...r, visible: shownOf(vis, r.id) })) : [],
    setVisible: (id, v) => setOverrides((prev) => ({ key: set, vis: { ...(prev.key === set ? prev.vis : {}), [id]: v } })),
    cloudColour,
    setCloudColour: setCloudColourState,
    budget,
    setBudget(n) {
      host.setBudget(n);
      writeBudget(n);
      setBudgetState(n);
      if (engine) partsOf(engine).requestRender();
    },
    photos: set?.photos ?? null,
    findings: set?.findings ?? null,
  };
}

/** A click (≤ 4 px of travel) on a pin opens its finding, else on a glyph opens its photo. */
export function useExtraLayerClicks(
  engine: SiteEngine | null,
  extra: Pick<ExtraLayers, "photos" | "findings">,
  on: { photo(imageId: string): void; finding(findingId: string): void },
): void {
  const onRef = useRef(on);
  useEffect(() => {
    onRef.current = on;
  });
  const { photos, findings } = extra;
  useEffect(() => {
    if (!engine) return;
    const canvas = partsOf(engine).canvas;
    let down: { x: number; y: number } | null = null;
    const pd = (e: PointerEvent) => {
      down = e.button === 0 ? { x: e.clientX, y: e.clientY } : null;
    };
    const pu = (e: PointerEvent) => {
      const d = down;
      down = null;
      if (!d || Math.hypot(e.clientX - d.x, e.clientY - d.y) > CLICK_SLOP_PX) return;
      const f = findings?.hit(e.clientX, e.clientY);
      if (f) return onRef.current.finding(f.findingId);
      const p = photos?.hit(e.clientX, e.clientY);
      if (p) onRef.current.photo(p.imageId);
    };
    canvas.addEventListener("pointerdown", pd);
    canvas.addEventListener("pointerup", pu);
    return () => {
      canvas.removeEventListener("pointerdown", pd);
      canvas.removeEventListener("pointerup", pu);
    };
  }, [engine, photos, findings]);
}

/** What S1's model layer offers for the water (Task 1 maps S1's real names onto this). */
export interface ModelRootSource {
  root(): THREE.Object3D | null;
  onLoaded(cb: (root: THREE.Object3D) => void): () => void;
}

/** The loaded GLB root of S1's model layer, updated on every (re)load. */
export function useModelRoot(layer: ModelRootSource | null): THREE.Object3D | null {
  const [loaded, setLoaded] = useState<{ layer: ModelRootSource; root: THREE.Object3D } | null>(null);
  useEffect(() => {
    if (!layer) return;
    return layer.onLoaded((root) => setLoaded({ layer, root }));
  }, [layer]);
  if (!layer) return null;
  return loaded?.layer === layer ? loaded.root : layer.root();
}
```

`frontend/src/site3d/layers/ExtraLayerStatus.tsx`:

```tsx
import type { ExtraLayerRow } from "./useSiteExtraLayers";
import { statusText } from "./status";

/** For screen readers until S3's Layers panel shows the same lines on screen (S3 removes this). */
export function ExtraLayerStatus({ rows }: { rows: readonly ExtraLayerRow[] }) {
  return (
    <ul aria-label="Layer status" className="sr-only">
      {rows.map((r) => (
        <li key={r.id}>{`${r.label}: ${statusText(r.layer.status.get(), r.visible)}`}</li>
      ))}
    </ul>
  );
}
```

- [ ] **Step 4: Run the hook test**

Run: `pnpm -C frontend exec vitest run src/site3d/layers/useSiteExtraLayers.test.tsx` → Expected: 5 passed.

- [ ] **Step 5: Wire into S1's `SiteScreen.tsx`**

Using the variable names recorded in Task 1 (shown here as `engine`, `scene`, `frame`, `modelLayer`, `projectId`), add the imports and, right after those variables exist and before the first early return that depends on them (hooks must run on every render):

```tsx
import { useNavigate } from "react-router-dom";
import { findingPath } from "@/findings/links";
import { ExtraLayerStatus } from "@/site3d/layers/ExtraLayerStatus";
import { useExtraLayerClicks, useModelRoot, useSiteExtraLayers } from "@/site3d/layers/useSiteExtraLayers";

// …inside SiteScreen, with S1's names:
const navigate = useNavigate(); // reuse S1's if it already has one
const modelRoot = useModelRoot(modelLayer);
const extra = useSiteExtraLayers({ engine, scene, frame, projectId, modelRoot });
useExtraLayerClicks(engine, extra, {
  photo: (imageId) => navigate(`/p/${projectId}/images/${encodeURIComponent(imageId)}`),
  finding: (findingId) => navigate(findingPath(projectId, findingId)),
});
```

and render `<ExtraLayerStatus rows={extra.rows} />` once inside the screen's root element. If S1's model layer object does not match `ModelRootSource`, pass an adapter object built with `useMemo` in `SiteScreen` (e.g. `{ root: () => modelLayer.gltfRoot, onLoaded: (cb) => modelLayer.on("loaded", cb) }`) rather than changing the hook.

Run S1's screen tests: `pnpm -C frontend exec vitest run src/site3d` → Expected: all pass (S1's `SiteScreen.test.tsx` "no model", "no frame" stay green: with no engine the hook adds nothing; with no scene it returns no rows).

- [ ] **Step 6: Write the fixture GLB generator and generate it**

`frontend/e2e/fixtures/make_site_env.py`:

```python
"""Writes site-env.glb for the S2 e2e: a sea slab, a land block and one tank, with A1-style extras.

Run from the worktree root with the backend venv:
    E:\\Dev\\Yolo\\app\\backend\\.venv\\Scripts\\python.exe frontend/e2e/fixtures/make_site_env.py
Scene frame (index): metres, x plant north, y up (EL - datum), z plant east.
"""

import sys
from pathlib import Path

import numpy as np
import trimesh

ROOT = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(ROOT / "backend"))
from app.asset_models.build import inject_node_extras  # noqa: E402

sea = trimesh.creation.box(extents=(400.0, 0.2, 400.0))
sea.apply_translation((0.0, -6.1, 250.0))  # top at y = -6.0; z 50..450 runs under the land's edge (z ≤ 100)
land = trimesh.creation.box(extents=(400.0, 6.0, 200.0))
land.apply_translation((0.0, -3.0, 0.0))
tank = trimesh.creation.cylinder(radius=20.0, height=30.0, sections=48)
tank.apply_transform(trimesh.transformations.rotation_matrix(-np.pi / 2, (1.0, 0.0, 0.0)))  # axis z -> y
tank.apply_translation((0.0, 15.0, 0.0))

scene = trimesh.Scene()
scene.add_geometry(sea, node_name="environment/sea-1", geom_name="sea")
scene.add_geometry(land, node_name="environment/land-1", geom_name="land")
scene.add_geometry(tank, node_name="20-T-0001", geom_name="tank")
glb = trimesh.exchange.gltf.export_glb(scene)
glb = inject_node_extras(
    glb,
    {
        "environment/sea-1": {"env": "sea"},
        "environment/land-1": {"env": "land"},
        "20-T-0001": {"tag": "20-T-0001", "type": "tank_lng", "name": "LNG tank 1"},
    },
)
out = Path(__file__).with_name("site-env.glb")
out.write_bytes(glb)
print(out.name, len(glb))
```

Run: `E:\Dev\Yolo\app\backend\.venv\Scripts\python.exe frontend/e2e/fixtures/make_site_env.py`
Expected: `site-env.glb <n>` with n between 10 000 and 60 000 bytes.

- [ ] **Step 7: Write the e2e fixture and spec**

`frontend/e2e/fixtures/siteEnv.ts`:

```ts
import { readFileSync } from "node:fs";
import type { Page, Route } from "@playwright/test";
import { P } from "./assetModels";

export const SITE_MODEL = "a0000000-9999-4000-8000-0000000000e1";
const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};
const GLB = readFileSync(new URL("./site-env.glb", import.meta.url));
const VERSION_PATH = `/api/v1/projects/${P}/asset-models/${SITE_MODEL}/versions/1`;

/** F0's SiteScene for one plant with a sea, and one cloud the site can't place. */
export const sceneJson = () => ({
  frame: {
    crs: { epsg: 32639, wkt: null },
    origin_crs: [244338.089, 3179515.69],
    plant_north_deg: 17.9991,
    datum: { label: "HPFS", el_m: 100 },
  },
  model: { id: SITE_MODEL, version: 1, glb_url: `${VERSION_PATH}/glb`, csv_url: `${VERSION_PATH}/csv`, kind: "plant" },
  orthos: [],
  clouds: [
    {
      id: "c-local",
      name: "Local scan",
      octree_url: `/api/v1/projects/${P}/pointclouds/c-local/octree/metadata.json`,
      crs_epsg: null,
      same_crs: false,
      z_offset_m: 0,
    },
  ],
  drawings: [],
  photos: { count: 0, url: null },
  findings: { count: 0, url: null },
});

export async function routeSiteEnv(page: Page): Promise<void> {
  const json = (route: Route, body: unknown) =>
    route.fulfill({ status: 200, contentType: "application/json", headers: CORS, body: JSON.stringify(body) });
  await page.route(
    (u) => u.pathname === `/api/v1/projects/${P}/site-scene`,
    (route) => (route.request().method() === "OPTIONS" ? route.fulfill({ status: 204, headers: CORS }) : json(route, sceneJson())),
  );
  await page.route(
    (u) => u.pathname === `${VERSION_PATH}/glb`,
    (route) => route.fulfill({ status: 200, contentType: "model/gltf-binary", headers: CORS, body: GLB }),
  );
}
```

If S1's screen reads more endpoints than Prism answers usefully (e.g. the asset model itself), add those routes here with the contract's shapes; Task 1's notes list them.

`frontend/e2e/site3d-env.spec.ts`:

```ts
import { expect, test } from "@playwright/test";
import { P } from "./fixtures/assetModels";
import { SWIFTSHADER } from "./fixtures/cloudWorkspace";
import { SITE_MODEL, routeSiteEnv } from "./fixtures/siteEnv";

test.use(SWIFTSHADER);

test("the site view puts water and sky over the plant and refuses a cloud in another CRS", async ({ page }) => {
  const pageErrors: string[] = [];
  page.on("pageerror", (e) => pageErrors.push(e.message));
  await routeSiteEnv(page);
  await page.goto(`/p/${P}/site/${SITE_MODEL}`);
  const status = page.getByRole("list", { name: "Layer status" });
  // Index Review Focus 2: a cloud in another CRS is never projected; the view says so.
  await expect(status).toContainText("Local scan: Can't place this cloud", { timeout: 20_000 });
  await expect(status).toContainText("Water: shown", { timeout: 20_000 });
  await expect(status).toContainText("Sky: shown");
  await expect(status).toContainText("Photos: No posed photos in this project.");
  await expect(status).toContainText("Findings: shown, No findings with a map or cloud spot.");
  expect(pageErrors).toEqual([]);
});
```

Under SwiftShader the app resolves effects to **reduced**, so the water line reads `Water: shown, Flat water (reduced effects)`; `toContainText("Water: shown")` holds either way.

- [ ] **Step 8: Run the e2e on S2's ports**

Run (PowerShell, worktree root): `$env:E2E_WEB_PORT="5410"; $env:E2E_MOCK_PORT="5411"; pnpm -C frontend exec playwright test e2e/site3d-env.spec.ts; Remove-Item Env:E2E_WEB_PORT, Env:E2E_MOCK_PORT`
Expected: 1 passed.

- [ ] **Step 9: Commit**

```bash
git add frontend/src/site3d/layers/useSiteExtraLayers.ts frontend/src/site3d/layers/useSiteExtraLayers.test.tsx frontend/src/site3d/layers/ExtraLayerStatus.tsx frontend/src/site3d/SiteScreen.tsx frontend/e2e/fixtures/make_site_env.py frontend/e2e/fixtures/site-env.glb frontend/e2e/fixtures/siteEnv.ts frontend/e2e/site3d-env.spec.ts
git commit -m "feat(site3d): cloud, water, sky, photos and findings layers in the site view

Clicks on a pin open the finding, on a glyph the photo. e2e: water and sky over a
fixture plant, and a cloud in another CRS refused on screen.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task S2-9: Gate and operator walkthrough

**Files:** none new (fixes only, if the gate finds any).

- [ ] **Step 1: Run the full gate from the worktree root**

```powershell
pnpm -C contract check
cd backend; E:\Dev\Yolo\app\backend\.venv\Scripts\python.exe -m ruff check .; E:\Dev\Yolo\app\backend\.venv\Scripts\python.exe -m ruff format --check .; E:\Dev\Yolo\app\backend\.venv\Scripts\python.exe -m pytest; cd ..
pnpm -C frontend lint
pnpm -C frontend test
pnpm -C frontend build
$env:E2E_WEB_PORT="5410"; $env:E2E_MOCK_PORT="5411"; pnpm -C frontend e2e; Remove-Item Env:E2E_WEB_PORT, Env:E2E_MOCK_PORT
if (Test-Path frontend/src-tauri/binaries/kestrel-backend-*.exe) { cargo test --manifest-path frontend/src-tauri/Cargo.toml }
```

Expected: every command exits 0; `check-tokens` reports no violations; pytest unchanged by S2. Fix any failure in the task that owns it, re-run, and commit the fix with a message naming the failing check.

- [ ] **Step 2: Write the operator walkthrough into the ledger**

Append to `.superpowers/sdd/pm-common/ledgers/s2.md` (and hand to the coordinator):

```text
How to test S2 (Site 3D layers)
1. Open the LNG Terminal project, then Asset models, then a plant model, then open its site view (/p/<project>/site/<model>).
2. The sky is a soft Gulf blue with a sun; the model is lit from the south-west.
3. Where the model has sea, the water moves when you orbit and shows white foam along the quay and the shore; with Settings → Appearance → Visual effects → Reduced it turns into flat blue water.
4. The project point cloud appears in place over the model; in another coordinate system it is not drawn and a screen reader reads "Can't place this cloud" (S3 shows it in the Layers panel).
5. Turn Settings → Reduce motion on: the water stops moving.
6. Findings from the map and the point cloud show as round pins coloured by severity; clicking one opens it in Findings.
7. (Photos are off by default; S3's Layers panel turns them on. Clicking a camera glyph opens the photo.)
8. Check that the sky is not blown out and the water colour reads as sea; note any tuning for L1.
```

- [ ] **Step 3: Commit (only if Step 1 needed fixes)**

```bash
git add <the fixed files, by path>
git commit -m "fix(site3d): <what the gate found>

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

# Part S3: Site 3D panels, entry points and M1 UI fixes

Worktree `E:\Dev\Yolo\app\.claude\worktrees\pm-s3`, branch `task/pm-s3`, cut from `main` after S1 and A1 merged. Paths are relative to the worktree.

UI rule for every task: invoke `impeccable` and `emil-design-eng` (Skill tool) and read `DESIGN.md` before writing any TSX. Concretely for these panels: `GlassPanel variant="float"` for the Layers panel and the Run bar (controls over imagery); the right-hand register panel is opaque `bg-glass-solid` because it scrolls a long list (never blur a scrolling list); entrances use `animate-reveal reduce-motion:animate-none` (fill `backwards`, no lasting transform); figures `font-mono tabular-nums`; sentence case; no em dashes in copy; every interactive element keeps `focusRing` from the primitives.

### Task S3-1: Align with merged F0, S1 and A1

**Files:**
- Create: `frontend/src/site3d/panels/engineBridge.ts`, `frontend/src/test/fakeSiteControls.ts`, `frontend/src/test/plantFixtures.ts`; and, only if S2 has not merged yet, `frontend/src/site3d/layers/sceneTypes.ts` and `frontend/src/test/siteSceneFixtures.ts` **byte-identical** to S2 Task 1's (copy them from Part S2 above; an add/add of identical files merges cleanly)
- Test: `frontend/src/site3d/panels/engineBridge.test.ts`
- Modify (only if S1 lacks them): `frontend/src/site3d/layers/model.layer.ts` (`select(node)`, `boxOf(node)`, `load(url, {keepCamera})`, `setColourBy(mode)`, `setOpacity(o)`) with a test in S1's `model.layer.test.ts`

**Interfaces:**
- Consumes: S1's `SiteEngine` (`flyTo`, `onSelect`), model layer, `SiteScreen.tsx`, `api/siteScene.ts` (`getAssetItem`); F0's generated schemas.
- Produces: `ColourBy`, `COLOUR_BY`, `SiteControls`, `ModelLayerLike`, `controlsOf(engine, model)`; `fakeSiteControls()`; `itemRow()`, `ITEM`, `CATALOGUE`, `PACKAGES`, `plantModel()`, `plantSpec()`.

- [ ] **Step 1: Read and record the real names**

Read `frontend/src/site3d/engine/SiteEngine.ts` (`flyTo`, `onSelect` callback argument shape, `pick`), `frontend/src/site3d/layers/model.layer.ts`, `frontend/src/site3d/SiteScreen.tsx` (its placeholders and variable names; where S1's own view palette sits), `frontend/src/api/siteScene.ts` (`getAssetItem` signature), and `grep -n "AssetItemRow\|AssetItemPage\|AssetModelCatalogue\|SiteModelPackage\|ItemFootprint\|\"kind\"" contract/client/schema.d.ts`. In the ledger (`.superpowers/sdd/pm-common/ledgers/s3.md`) record as `Ruling:` lines:
1. the item row's id field (expected `id`) and node field (expected `node`), and whether an item's GLB node name equals its item id (A1; expected yes, which makes `nodeToItemId` the identity);
2. `AssetItemRow` fields (expected `id, node, tag, name, type, area, plant_e, plant_n, site_x, site_y, lon, lat, base_el, top_el, height_source, confidence, flags, source_sheet, has_geometry`), `AssetItemPage {items, next_cursor}`, `AssetModelCatalogue {items}`, `SiteModelPackageList {items}`, the package fields (expected `id, n, label, area, state, item_count, usage, summary, started_at, ended_at`), `AssetModelRun.packages` (expected optional `{total, done, failed, running}`), and `AssetModelRun.usage_by_stage` (expected `{current, stages, cost_estimate_usd, cost_label}`, coordinator note in Task 8);
3. what `engine.onSelect(cb)` passes (expected a hit with the item's node, or null);
4. the model layer's names for select, box, load-keeping-camera, colour-by and opacity, and the model layer row's label (expected "Plant model");
5. S1's placeholder elements in `SiteScreen.tsx` that S3 replaces, and the left offset of S1's view palette (the Layers panel goes beside or under it, top left).

Add any missing model-layer method to S1's file with a test (shared-file touch), e.g. `boxOf(node)` returning the node's world `Box3` via `new THREE.Box3().setFromObject(root.getObjectByName(node))`, or null.

- [ ] **Step 2: Write the failing test**

`frontend/src/site3d/panels/engineBridge.test.ts`:

```ts
import * as THREE from "three";
import { describe, expect, it, vi } from "vitest";
import type { SiteEngine } from "@/site3d/engine/SiteEngine";
import { controlsOf, type ModelLayerLike } from "./engineBridge";

function fakes() {
  let selectCb: ((hit: { node?: string | null } | null) => void) | null = null;
  const engine = {
    flyTo: vi.fn(),
    onSelect: vi.fn((cb: typeof selectCb) => {
      selectCb = cb;
      return () => {};
    }),
  } as unknown as SiteEngine;
  const box = new THREE.Box3(new THREE.Vector3(0, 0, 0), new THREE.Vector3(1, 1, 1));
  const model: ModelLayerLike = {
    select: vi.fn(),
    boxOf: vi.fn(() => box),
    load: vi.fn(async () => undefined),
    setColourBy: vi.fn(),
    setOpacity: vi.fn(),
  };
  return { engine, model, box, emit: (hit: { node?: string | null } | null) => selectCb?.(hit) };
}

describe("controlsOf", () => {
  it("flies with the engine, selects and boxes through the model layer", () => {
    const { engine, model, box } = fakes();
    const c = controlsOf(engine, model);
    c.flyTo(box);
    expect(engine.flyTo).toHaveBeenCalledWith(box);
    c.select("20-T-0001");
    expect(model.select).toHaveBeenCalledWith("20-T-0001");
    expect(c.boxOf("20-T-0001")).toBe(box);
  });

  it("swaps the GLB keeping the camera", async () => {
    const { engine, model } = fakes();
    await controlsOf(engine, model).loadModel("v4.glb");
    expect(model.load).toHaveBeenCalledWith("v4.glb", { keepCamera: true });
  });

  it("reports 3D selection as a node name, or null", () => {
    const { engine, model, emit } = fakes();
    const cb = vi.fn();
    controlsOf(engine, model).onSelect(cb);
    emit({ node: "30-P-0001" });
    emit(null);
    expect(cb.mock.calls).toEqual([["30-P-0001"], [null]]);
  });

  it("passes colour-by and opacity to the model layer", () => {
    const { engine, model } = fakes();
    const c = controlsOf(engine, model);
    c.setColourBy("height_source");
    c.setModelOpacity(0.4);
    expect(model.setColourBy).toHaveBeenCalledWith("height_source");
    expect(model.setOpacity).toHaveBeenCalledWith(0.4);
  });
});
```

- [ ] **Step 3: Run it to verify it fails**

Run: `pnpm -C frontend exec vitest run src/site3d/panels/engineBridge.test.ts` → Expected: FAIL, module not found.

- [ ] **Step 4: Implement the bridge and the test helpers**

`frontend/src/site3d/panels/engineBridge.ts` (rewrite lines against S1's real names from Step 1; keep the exported shape):

```ts
import type * as THREE from "three";
import type { SiteEngine } from "@/site3d/engine/SiteEngine";

export type ColourBy = "material" | "type" | "area" | "height_source" | "flag";
export const COLOUR_BY: readonly { value: ColourBy; label: string }[] = [
  { value: "material", label: "Material" },
  { value: "type", label: "Type" },
  { value: "area", label: "Area" },
  { value: "height_source", label: "Height source" },
  { value: "flag", label: "Flags" },
];

/** What S3's panels drive in the 3D view. The only module that knows S1's names. */
export interface SiteControls {
  flyTo(box: THREE.Box3): void;
  select(node: string | null): void;
  onSelect(cb: (node: string | null) => void): () => void;
  boxOf(node: string): THREE.Box3 | null;
  /** Loads another version's GLB into the same scene, keeping the camera (spec §11 Edit). */
  loadModel(url: string): Promise<void>;
  setColourBy(mode: ColourBy): void;
  setModelOpacity(o: number): void;
}

/** S1's model layer as S3 uses it. */
export interface ModelLayerLike {
  select(node: string | null): void;
  boxOf(node: string): THREE.Box3 | null;
  load(url: string, o: { keepCamera: boolean }): Promise<unknown>;
  setColourBy(mode: ColourBy): void;
  setOpacity?(o: number): void;
}

export function controlsOf(engine: SiteEngine, model: ModelLayerLike): SiteControls {
  return {
    flyTo: (box) => engine.flyTo(box),
    select: (node) => model.select(node),
    onSelect: (cb) => engine.onSelect((hit: { node?: string | null } | null) => cb(hit?.node ?? null)),
    boxOf: (node) => model.boxOf(node),
    loadModel: async (url) => {
      await model.load(url, { keepCamera: true });
    },
    setColourBy: (mode) => model.setColourBy(mode),
    setModelOpacity: (o) => model.setOpacity?.(o),
  };
}
```

`frontend/src/test/fakeSiteControls.ts`:

```ts
import { vi } from "vitest";
import type { SiteControls } from "@/site3d/panels/engineBridge";

/** SiteControls with spies; `emitSelect` plays a click in the 3D view. */
export function fakeSiteControls(over: Partial<SiteControls> = {}) {
  const listeners = new Set<(node: string | null) => void>();
  const raw = {
    flyTo: vi.fn(),
    select: vi.fn(),
    onSelect: vi.fn((cb: (node: string | null) => void) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    }),
    boxOf: vi.fn(() => null),
    loadModel: vi.fn(async () => {}),
    setColourBy: vi.fn(),
    setModelOpacity: vi.fn(),
    ...over,
  };
  return {
    controls: raw as unknown as SiteControls,
    raw,
    emitSelect: (node: string | null) => listeners.forEach((cb) => cb(node)),
  };
}
```

`frontend/src/test/plantFixtures.ts` (types come from Task 2's `@/api/plantItems`; until Task 2 exists, write the file in Task 2's commit; adapt field names to Step 1's record, keep values):

```ts
import type { AssetModel, AssetSpec } from "@contract/client";
import type { AssetItem, AssetItemRow, CatalogueEntry, SiteModelPackage } from "@/api/plantItems";
import { MODEL } from "./assetModelFixtures";

export const PLANT_ID = "m1";

export const itemRow = (o: Partial<AssetItemRow> = {}): AssetItemRow =>
  ({
    id: "20-T-0001",
    node: "20-T-0001",
    tag: "20-T-0001",
    name: "LNG tank 1",
    type: "tank_lng",
    area: "20",
    plant_e: 100,
    plant_n: 200,
    site_x: null,
    site_y: null,
    lon: null,
    lat: null,
    base_el: 100,
    top_el: 135,
    height_source: "drawing",
    confidence: "high",
    flags: [],
    source_sheet: "T0006",
    has_geometry: true,
    ...o,
  }) as AssetItemRow;

export const ITEM = {
  id: "20-T-0001",
  tag: "20-T-0001",
  name: "LNG tank 1",
  type: "tank_lng",
  area: "20",
  footprint: { kind: "circle", center: [100, 200], d: 80 },
  base_el: 100,
  top_el: 135,
  levels: [],
  params: { d_m: 80, roof: "dome", platforms: true },
  height_source: "drawing",
  source: { kind: "drawing", id: "dr-1", page: 2, region: [0.1, 0.2, 0.3, 0.4] },
  confidence: "high",
  flags: [{ code: "height_mismatch", value: 1.2, note: "Scan top at EL 136.2" }],
  parts: [],
  notes: null,
} as unknown as AssetItem;

export const PUMP = {
  ...ITEM,
  id: "30-P-0001",
  tag: "30-P-0001",
  name: "Send-out pump 1",
  type: "other",
  area: "30",
  footprint: { kind: "rect", center: [260, 180], size: [6, 3], rot_deg: 0 },
  top_el: 103,
  params: {},
  flags: [],
} as unknown as AssetItem;

/** pydantic model_json_schema shapes: a number with an exclusive minimum, an enum, a boolean, an integer, a nullable array. */
export const CATALOGUE = [
  {
    type: "tank_lng",
    family: "equipment",
    doc: "Full-containment LNG tank: wall, dome, roof platforms",
    default_height_m: 40,
    params_schema: {
      type: "object",
      properties: {
        d_m: { type: "number", exclusiveMinimum: 0, default: 80, title: "D M" },
        roof: { type: "string", enum: ["dome", "flat"], default: "dome", title: "Roof" },
        platforms: { type: "boolean", default: true, title: "Platforms" },
        risers: { type: "integer", minimum: 0, default: 4, title: "Risers" },
        nozzles: { anyOf: [{ type: "array", items: { type: "number" } }, { type: "null" }], default: null, title: "Nozzles" },
      },
    },
  },
  {
    type: "other",
    family: "fallback",
    doc: "Extrudes the footprint from base to top",
    default_height_m: 3,
    params_schema: { type: "object", properties: {} },
  },
] as unknown as CatalogueEntry[];

export const PACKAGES = [
  { id: "k1", n: 1, label: "Jetty head 1", area: "10", state: "done", item_count: 42, usage: {}, summary: null, started_at: "2026-10-03T09:00:00Z", ended_at: "2026-10-03T09:20:00Z" },
  { id: "k2", n: 2, label: "Tank row north", area: "20", state: "running", item_count: 0, usage: {}, summary: null, started_at: "2026-10-03T09:20:00Z", ended_at: null },
  { id: "k3", n: 3, label: "Process area", area: "30", state: "queued", item_count: 0, usage: {}, summary: null, started_at: null, ended_at: null },
] as unknown as SiteModelPackage[];

export const plantModel = (o: Partial<AssetModel> = {}): AssetModel =>
  ({ ...MODEL, id: PLANT_ID, name: "Al-Zour LNG plant", kind: "plant", current_version: 3, ...o }) as AssetModel;

export const plantSpec = (items: AssetItem[] = [ITEM, PUMP]): AssetSpec =>
  ({ asset: {}, parts: [], items, environment: [], site: null }) as unknown as AssetSpec;
```

- [ ] **Step 5: Run the test and the type check**

Run: `pnpm -C frontend exec vitest run src/site3d/panels/engineBridge.test.ts` → Expected: 4 passed.
Run: `pnpm -C frontend exec tsc -b` → Expected: no errors (once Task 2's types exist; if run before Task 2, `plantFixtures.ts` is created in Task 2 instead).

- [ ] **Step 6: Commit**

```bash
git add frontend/src/site3d/panels/engineBridge.ts frontend/src/site3d/panels/engineBridge.test.ts frontend/src/test/fakeSiteControls.ts
# plus sceneTypes.ts / siteSceneFixtures.ts (if created here) and model.layer.ts + its test (if Step 1 changed them)
git commit -m "feat(site3d): S3 bridge to the S1 engine and model layer, panel test fakes

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task S3-2: Plant item API wrappers

**Files:**
- Create: `frontend/src/api/plantItems.ts`, `frontend/src/test/plantFixtures.ts` (from Task 1 Step 4)
- Test: `frontend/src/api/plantItems.test.ts`

**Interfaces:**
- Consumes: the generated client (`listAssetModelItems`, `getAssetModelCatalogue`, `listAssetModelRunPackages`), `unwrap` (`@/api/errors`).
- Produces: `AssetItemRow`, `AssetItemPage`, `AssetItem`, `CatalogueEntry`, `SiteModelPackage`, `ITEMS_PAGE`, `ItemQuery`, `listAssetItems`, `getCatalogue`, `listRunPackages`.

- [ ] **Step 1: Write the failing test**

`frontend/src/api/plantItems.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { fakeClient } from "@/test/fixtures";
import { CATALOGUE, PACKAGES, itemRow } from "@/test/plantFixtures";
import { getCatalogue, listAssetItems, listRunPackages } from "./plantItems";

describe("plant item API", () => {
  it("reads one page of items with the trimmed query, the cursor and a 200-row limit", async () => {
    const { api, requests } = fakeClient([
      { method: "GET", path: /\/asset-models\/m1\/versions\/3\/items$/, body: { items: [itemRow()], next_cursor: "c2" } },
    ] as never);
    const page = await listAssetItems(api, "p", "m1", 3, { q: " 20-T ", type: "", area: "20", flag: "height_mismatch" }, "c1");
    expect(page.items).toHaveLength(1);
    expect(page.next_cursor).toBe("c2");
    const q = new URL(requests[0].url, "http://x").searchParams;
    expect(q.get("q")).toBe("20-T");
    expect(q.has("type")).toBe(false);
    expect(q.get("area")).toBe("20");
    expect(q.get("flag")).toBe("height_mismatch");
    expect(q.get("cursor")).toBe("c1");
    expect(q.get("limit")).toBe("200");
  });

  it("the first page has no cursor", async () => {
    const { api, requests } = fakeClient([
      { method: "GET", path: /\/items$/, body: { items: [], next_cursor: null } },
    ] as never);
    await listAssetItems(api, "p", "m1", 3, {}, null);
    expect(new URL(requests[0].url, "http://x").searchParams.has("cursor")).toBe(false);
  });

  it("reads the builder catalogue, which is not project-scoped", async () => {
    const { api, requests } = fakeClient([
      { method: "GET", path: /^\/api\/v1\/asset-models\/catalogue$/, body: { items: CATALOGUE } },
    ] as never);
    expect((await getCatalogue(api)).map((c) => c.type)).toEqual(["tank_lng", "other"]);
    expect(requests[0].url).toBe("/api/v1/asset-models/catalogue");
  });

  it("reads a run's packages", async () => {
    const { api } = fakeClient([
      { method: "GET", path: /\/asset-models\/m1\/runs\/r1\/packages$/, body: { items: PACKAGES } },
    ] as never);
    expect((await listRunPackages(api, "p", "m1", "r1")).map((k) => k.label)).toEqual([
      "Jetty head 1",
      "Tank row north",
      "Process area",
    ]);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm -C frontend exec vitest run src/api/plantItems.test.ts` → Expected: FAIL, module not found.

- [ ] **Step 3: Implement**

`frontend/src/api/plantItems.ts`:

```ts
import type { ApiClient, components } from "@contract/client";
import { unwrap } from "./errors";

type S = components["schemas"];
export type AssetItemRow = S["AssetItemRow"];
export type AssetItemPage = S["AssetItemPage"];
/** The full spec item (`getAssetModelItem`), the item editor's input and output. */
export type AssetItem = S["AssetItem"];
export type CatalogueEntry = S["AssetModelCatalogue"]["items"][number];
export type SiteModelPackage = S["SiteModelPackageList"]["items"][number];

/** Register page size: well under the contract's 500-row cap, a few screens of 44 px rows. */
export const ITEMS_PAGE = 200;

export interface ItemQuery {
  q?: string;
  type?: string;
  area?: string;
  flag?: string;
}

const V = "/api/v1/projects/{projectId}/asset-models/{assetModelId}/versions/{version}" as const;

/** One cursor page of a version's register (`listAssetModelItems`); empty filters are left out. */
export function listAssetItems(
  api: ApiClient,
  projectId: string,
  assetModelId: string,
  version: number,
  query: ItemQuery,
  cursor: string | null,
  signal?: AbortSignal,
): Promise<AssetItemPage> {
  return unwrap(
    api.GET(`${V}/items`, {
      params: {
        path: { projectId, assetModelId, version },
        query: {
          q: query.q?.trim() || undefined,
          type: query.type || undefined,
          area: query.area || undefined,
          flag: query.flag || undefined,
          cursor: cursor ?? undefined,
          limit: ITEMS_PAGE,
        },
      },
      signal,
    }),
  );
}

/** The live builder catalogue (`getAssetModelCatalogue`): types, families, docs and param schemas. */
export async function getCatalogue(api: ApiClient): Promise<CatalogueEntry[]> {
  return (await unwrap(api.GET("/api/v1/asset-models/catalogue"))).items;
}

/** A plant run's work packages (`listAssetModelRunPackages`, ≤ 64). */
export async function listRunPackages(
  api: ApiClient,
  projectId: string,
  assetModelId: string,
  runId: string,
): Promise<SiteModelPackage[]> {
  return (
    await unwrap(
      api.GET("/api/v1/projects/{projectId}/asset-models/{assetModelId}/runs/{runId}/packages", {
        params: { path: { projectId, assetModelId, runId } },
      }),
    )
  ).items;
}
```

Also create `frontend/src/test/plantFixtures.ts` exactly as in Task 1 Step 4.

- [ ] **Step 4: Run the test and the type check**

Run: `pnpm -C frontend exec vitest run src/api/plantItems.test.ts` → Expected: 4 passed.
Run: `pnpm -C frontend exec tsc -b` → Expected: no errors. A query-key type error means F0 named a parameter differently: follow the contract.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/api/plantItems.ts frontend/src/api/plantItems.test.ts frontend/src/test/plantFixtures.ts
git commit -m "feat(api): plant register pages, builder catalogue and run packages

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task S3-3: M1 deferred UI fixes (step budget, list reload errors, failed GLB swap, Orbit)

**Files:**
- Modify: `frontend/src/assetmodels/run/runView.ts`, `frontend/src/assetmodels/viewer/ModelViewer.tsx`, `frontend/src/assetmodels/workspace/ViewTools.tsx`, `frontend/src/assetmodels/workspace/AssetModelWorkspace.tsx` (one line in the root `div`)
- Create: `frontend/src/assetmodels/workspace/ListReloadNotice.tsx`
- Test: `frontend/src/assetmodels/run/runView.test.ts` (new), `frontend/src/assetmodels/viewer/ModelViewer.test.tsx` (one case), `frontend/src/assetmodels/workspace/ViewTools.test.tsx` (new), `frontend/src/assetmodels/workspace/ListReloadNotice.test.tsx` (new), `frontend/src/assetmodels/useAssetModels.test.tsx` (new)

**Interfaces:**
- Consumes: `AssetModelRun` (contract), `Alert`, `Button`, `Pill`, `Tooltip`, `Icon` (`@/ui`).
- Produces: `DEFAULT_MAX_STEPS`, `maxSteps(run)`, `stepText(run)`, `stepShare(run): number | undefined` (replaces `MAX_STEPS`); `ListReloadNotice({error, onRetry})`.

`engine.ts` is not touched (P1). Ping the P1 coordinator (app-e5) before this task's commit lands on `main` (it is in `frontend/src/assetmodels/`).

- [ ] **Step 1: Write the failing tests**

`frontend/src/assetmodels/run/runView.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import type { AssetModelRun } from "@contract/client";
import { DEFAULT_MAX_STEPS, maxSteps, stepShare, stepText } from "./runView";

const steps = (n: number) =>
  Array.from({ length: n }, (_, i) => ({ n: i + 1, tool: "t", ok: true, summary: "", has_thumb: false }));

describe("the run's step budget (spec §11: MAX_STEPS from the run's budget)", () => {
  it("a build or refine run without its own budget counts against M1's 80", () => {
    expect(maxSteps({ mode: "build" })).toBe(DEFAULT_MAX_STEPS);
    expect(stepText({ mode: "refine", steps: steps(12) })).toBe("step 12 of 80");
    expect(stepShare({ mode: "build", steps: steps(40) })).toBe(0.5);
    expect(stepText({ mode: "build", steps: steps(95) })).toBe("step 80 of 80");
  });

  it("a run that carries its own budget counts against it", () => {
    const run = { mode: "build" as const, steps: steps(30), limits: { max_calls: 150 } };
    expect(stepText(run)).toBe("step 30 of 150");
    expect(stepShare(run)).toBe(0.2);
  });

  it("a plant run has no step budget: a plain count and an indeterminate bar", () => {
    const run = { mode: "plant" as AssetModelRun["mode"], steps: steps(7) };
    expect(maxSteps(run)).toBeNull();
    expect(stepText(run)).toBe("step 7");
    expect(stepShare(run)).toBeUndefined();
  });
});
```

Add to `frontend/src/assetmodels/viewer/ModelViewer.test.tsx` (inside the `describe`, using the file's `create` mock and `stub` helper):

```tsx
  it("a failed swap labels the old model stale and offers a reload", async () => {
    create.mockReset();
    const load = vi
      .fn<() => Promise<unknown>>()
      .mockResolvedValueOnce([{ id: "s", name: "S", group: "Shell" }])
      .mockRejectedValueOnce(new Error("bad v3"));
    create.mockImplementation(() => stub(load));
    const onParts = vi.fn();
    const onState = vi.fn();
    const { rerender } = render(<ModelViewer glbUrl="v2.glb" onParts={onParts} onSelect={() => {}} onState={onState} />);
    await waitFor(() => expect(onParts).toHaveBeenCalledTimes(1));
    rerender(<ModelViewer glbUrl="v3.glb" onParts={onParts} onSelect={() => {}} onState={onState} />);
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(/the new version's 3D model could not load/i);
    expect(alert).toHaveTextContent(/stale/i);
    expect(alert).toHaveTextContent(/the model shown is the previous version/i);
    expect(screen.getByRole("button", { name: /reload view/i })).toBeInTheDocument();
    expect(onState).toHaveBeenLastCalledWith("load-error");
  });
```

`frontend/src/assetmodels/workspace/ViewTools.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ViewTools } from "./ViewTools";

describe("ViewTools", () => {
  it("shows Orbit as the active mode with its help, never as a dead button", () => {
    render(
      <ViewTools state={{ cut: false, levels: false, headOff: false }} disabled={false} onToggle={() => {}} onView={() => {}} />,
    );
    expect(screen.getByRole("img", { name: "Orbit: drag to turn, right-drag to pan, scroll to zoom" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^orbit$/i })).toBeNull();
    expect(screen.getByRole("button", { name: "Cut" })).toBeInTheDocument();
  });
});
```

`frontend/src/assetmodels/workspace/ListReloadNotice.test.tsx`:

```tsx
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ListReloadNotice } from "./ListReloadNotice";

describe("ListReloadNotice", () => {
  it("says the list could not be refreshed, why, and retries", () => {
    const onRetry = vi.fn();
    render(<ListReloadNotice error="The server did not answer." onRetry={onRetry} />);
    const alert = screen.getByRole("alert");
    expect(alert).toHaveTextContent("The model list could not be refreshed.");
    expect(alert).toHaveTextContent("The server did not answer.");
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });
});
```

`frontend/src/assetmodels/useAssetModels.test.tsx`:

```tsx
import type { ReactNode } from "react";
import { act, renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { TestApiProvider } from "@/test/render";
import { errorBody, fakeClient, PROJECT_ID } from "@/test/fixtures";
import { MODEL } from "@/test/assetModelFixtures";
import { useAssetModelList } from "./useAssetModels";

describe("useAssetModelList", () => {
  it("a failed reload keeps the shown list and sets the error (M1 deferred M7)", async () => {
    let calls = 0;
    const { api } = fakeClient([
      {
        method: "GET",
        path: /\/asset-models$/,
        status: () => (++calls === 1 ? 200 : 500),
        body: () => (calls === 1 ? { items: [MODEL] } : errorBody("internal", "The server did not answer.")),
      },
    ] as never);
    const wrapper = ({ children }: { children: ReactNode }) => <TestApiProvider api={api}>{children}</TestApiProvider>;
    const { result } = renderHook(() => useAssetModelList(PROJECT_ID), { wrapper });
    await waitFor(() => expect(result.current.models).toHaveLength(1));
    act(() => result.current.reload());
    await waitFor(() => expect(result.current.error).not.toBeNull());
    expect(result.current.models).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `pnpm -C frontend exec vitest run src/assetmodels/run/runView.test.ts src/assetmodels/viewer/ModelViewer.test.tsx src/assetmodels/workspace/ViewTools.test.tsx src/assetmodels/workspace/ListReloadNotice.test.tsx src/assetmodels/useAssetModels.test.tsx`
Expected: runView (no `maxSteps`), the new ModelViewer case (old text), ViewTools (a button named Orbit) and ListReloadNotice (no module) FAIL; `useAssetModels.test.tsx` passes already (the hook keeps the list; the bug was that nothing showed the error).

- [ ] **Step 3: Implement the step budget**

In `frontend/src/assetmodels/run/runView.ts`, replace the `MAX_STEPS`, `stepText` and `stepShare` block with:

```ts
/** M1's tool-call budget (backend runner.py MAX_CALLS) for build and refine runs that carry none. */
export const DEFAULT_MAX_STEPS = 80;

type Budgeted = Pick<AssetModelRun, "mode"> & { limits?: { max_calls?: number | null } | null };

/**
 * The run's step budget (spec §11): its own `limits.max_calls` when it has one, else M1's 80 for
 * build and refine; null for plant runs, which are counted in packages (Ruling 12).
 */
export function maxSteps(run: Budgeted): number | null {
  const own = run.limits?.max_calls;
  if (typeof own === "number" && own > 0) return own;
  return run.mode === "build" || run.mode === "refine" ? DEFAULT_MAX_STEPS : null;
}

/** "step 12 of 80", or "step 12" without a budget. */
export function stepText(run: Budgeted & Pick<AssetModelRun, "steps">): string {
  const max = maxSteps(run);
  const n = run.steps.length;
  return max === null ? `step ${n}` : `step ${Math.min(n, max)} of ${max}`;
}

/** The run's share of its step budget, 0 to 1; undefined (an indeterminate bar) without a budget. */
export function stepShare(run: Budgeted & Pick<AssetModelRun, "steps">): number | undefined {
  const max = maxSteps(run);
  return max === null ? undefined : Math.min(run.steps.length, max) / max;
}
```

`BuildBar.tsx` and `RunProgressCard.tsx` keep calling `stepText(run)` / `stepShare(run)`; `Progress` already treats `value={undefined}` as indeterminate. `grep -rn "MAX_STEPS" frontend/src` must print nothing afterwards.

- [ ] **Step 4: Implement the stale swap notice**

In `frontend/src/assetmodels/viewer/ModelViewer.tsx`:

1. Import `Pill` with the other `@/ui` names.
2. Widen the status state and read `stale`:

```tsx
  const [status, setStatus] = useState<{ key: string; state: ModelViewState; stale?: boolean }>({
    key: "",
    state: "loading",
  });
  const state: ModelViewState = status.key === sceneKey ? status.state : "loading";
  /** A load failed after an earlier GLB loaded into this engine: that earlier model is still drawn. */
  const stale = status.key === sceneKey && status.stale === true;
```

3. In the load rejection handler, record whether an earlier model is still shown:

```tsx
      () => {
        if (!cancelled) setStatus({ key: sceneKey, state: "load-error", stale: framed.current });
      },
```

4. In `notice`, before the existing `load-error` branch, and add `stale` to the `useMemo` deps:

```tsx
    if (state === "load-error" && stale)
      return (
        <Alert
          tone="warn"
          role="alert"
          title="The new version's 3D model could not load."
          actions={
            <Button size="sm" icon="refresh" onClick={() => setGeneration((g) => g + 1)}>
              Reload view
            </Button>
          }
        >
          <p className="flex items-center gap-1.5 text-xs text-muted">
            <Pill size="sm" tone="warn">
              Stale
            </Pill>
            The model shown is the previous version.
          </p>
        </Alert>
      );
```

- [ ] **Step 5: Implement the Orbit indicator (Ruling 11)**

In `frontend/src/assetmodels/workspace/ViewTools.tsx`, import `Icon` and `Tooltip` from `@/ui`, add

```tsx
/** M1's engine has one navigation mode; the palette shows it with its gestures instead of a dead button. */
const ORBIT_HELP = "Orbit: drag to turn, right-drag to pan, scroll to zoom";
```

and replace `<ToolButton icon="orbit" label="Orbit" active disabled={disabled} onClick={() => {}} />` with:

```tsx
      <Tooltip label={ORBIT_HELP} side="right" delay={250}>
        <span
          role="img"
          aria-label={ORBIT_HELP}
          className="grid h-9 w-[38px] place-items-center rounded-control bg-grad-primary text-accent-fg shadow-glow reduce-effects:shadow-none"
        >
          <Icon name="orbit" size={18} />
        </span>
      </Tooltip>
```

- [ ] **Step 6: Implement the list reload notice**

`frontend/src/assetmodels/workspace/ListReloadNotice.tsx`:

```tsx
import { Alert, Button } from "@/ui";

/**
 * A reload of the model list failed while a list is shown (M1 deferred M7): say so, keep the list,
 * offer a retry. Sits above the build bar so it never covers the version notices at the top.
 */
export function ListReloadNotice({ error, onRetry }: { error: string; onRetry(): void }) {
  return (
    <div
      data-testid="model-list-error"
      className="pointer-events-none absolute inset-x-0 bottom-24 z-20 flex justify-center px-4"
    >
      <div className="pointer-events-auto w-full max-w-md rounded-control bg-glass-solid shadow-elev-2">
        <Alert
          tone="danger"
          role="alert"
          title="The model list could not be refreshed."
          actions={
            <Button size="sm" icon="refresh" onClick={onRetry}>
              Retry
            </Button>
          }
        >
          <p className="text-xs text-muted">{error}</p>
        </Alert>
      </div>
    </div>
  );
}
```

In `AssetModelWorkspace.tsx`, import it and render it inside the root `<div data-testid="model-workspace" …>`, after `{details}`:

```tsx
      {error && <ListReloadNotice error={error} onRetry={reload} />}
```

(`error` and `reload` come from the existing `useAssetModelList(projectId)`; this branch only renders once a list is shown.)

- [ ] **Step 7: Run the tests**

Run: the Step 2 command, then `pnpm -C frontend exec vitest run src/assetmodels` → Expected: all pass (the existing "step 2 of 80" assertions in `AssetModelWorkspace.test.tsx` still hold: those runs are `build` mode).

- [ ] **Step 8: Commit**

```bash
git add frontend/src/assetmodels/run/runView.ts frontend/src/assetmodels/run/runView.test.ts frontend/src/assetmodels/viewer/ModelViewer.tsx frontend/src/assetmodels/viewer/ModelViewer.test.tsx frontend/src/assetmodels/workspace/ViewTools.tsx frontend/src/assetmodels/workspace/ViewTools.test.tsx frontend/src/assetmodels/workspace/ListReloadNotice.tsx frontend/src/assetmodels/workspace/ListReloadNotice.test.tsx frontend/src/assetmodels/workspace/AssetModelWorkspace.tsx frontend/src/assetmodels/useAssetModels.test.tsx
git commit -m "fix(assetmodels): step budget from the run, stale label on a failed swap, list reload errors, honest Orbit

M1's deferred UI fixes listed in the plant model spec §11.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task S3-4: Layers panel

**Files:**
- Create: `frontend/src/site3d/panels/layerRows.ts`, `frontend/src/site3d/panels/LayersPanel.tsx`
- Test: `frontend/src/site3d/panels/layerRows.test.ts`, `frontend/src/site3d/panels/LayersPanel.test.tsx`

**Interfaces:**
- Consumes: `SiteLayer` (S1); `ColourBy`, `COLOUR_BY` (Task 1); `BUDGETS` (`@/clouds/viewer/budget`); `GlassPanel`, `Switch`, `Slider`, `Select`, `Field`, `Segmented`, `Button`, `cx` (`@/ui`). S2's rows are consumed **structurally** (no import of S2 here), so this task does not wait for S2.
- Produces: `RowStatus`, `LayerGroup`, `GROUP_ORDER`, `LayerRow`, `LayerUi`, `s1Rows(layers, ui)`, `extraRows(rows)`, `groupRows(rows)`, `statusLine(s)`; `LayersPanel(props: LayersPanelProps)`, `CloudColourChoice`.

- [ ] **Step 1: Write the failing tests**

`frontend/src/site3d/panels/layerRows.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import type { SiteLayer } from "@/site3d/layers/types";
import { extraRows, groupRows, s1Rows, statusLine } from "./layerRows";

const layer = (id: string, label: string, opacity = false) =>
  ({ id, label, attach() {}, detach() {}, setVisible() {}, ...(opacity ? { setOpacity() {} } : {}) }) as SiteLayer;

describe("layer rows", () => {
  it("puts S1's model first and its orthos and drawings under Imagery, with opacity where the layer has it", () => {
    const rows = s1Rows([layer("model", "Plant model", true), layer("ortho:o1", "May ortho", true), layer("drawing:d1", "T0006")], {
      visible: { "ortho:o1": false },
      opacity: { model: 0.6 },
    });
    expect(rows.map((r) => [r.id, r.group, r.visible, r.opacity])).toEqual([
      ["model", "Model", true, 0.6],
      ["ortho:o1", "Imagery", false, 1],
      ["drawing:d1", "Imagery", true, null],
    ]);
  });

  it("reads S2's rows with their live status and no opacity", () => {
    const rows = extraRows([
      { id: "water", label: "Water", group: "Environment", visible: true, layer: { status: { get: () => ({ kind: "ready" as const }) } } },
    ]);
    expect(rows).toEqual([{ id: "water", label: "Water", group: "Environment", visible: true, opacity: null, status: { kind: "ready" } }]);
  });

  it("groups in the panel's order and drops empty groups", () => {
    const rows = [...extraRows([]), ...s1Rows([layer("model", "Plant model")], { visible: {}, opacity: {} })];
    expect(groupRows(rows).map(([g]) => g)).toEqual(["Model"]);
  });

  it("turns a status into one line of copy", () => {
    expect(statusLine({ kind: "ready" })).toBeNull();
    expect(statusLine({ kind: "ready", note: "Flat water (reduced effects)" })).toEqual({ text: "Flat water (reduced effects)", tone: "muted" });
    expect(statusLine({ kind: "unavailable", reason: "This model has no sea." })).toEqual({ text: "This model has no sea.", tone: "muted" });
    expect(statusLine({ kind: "error", message: "The cloud could not load: HTTP 404" })).toEqual({ text: "The cloud could not load: HTTP 404", tone: "danger" });
    expect(statusLine({ kind: "loading" })).toEqual({ text: "Loading…", tone: "muted" });
  });
});
```

`frontend/src/site3d/panels/LayersPanel.test.tsx`:

```tsx
import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { LayersPanel, type LayersPanelProps } from "./LayersPanel";
import type { LayerRow } from "./layerRows";

const ROWS: LayerRow[] = [
  { id: "model", label: "Plant model", group: "Model", visible: true, opacity: 1, status: { kind: "ready" } },
  { id: "ortho:o1", label: "May ortho", group: "Imagery", visible: true, opacity: 0.5, status: { kind: "ready" } },
  {
    id: "cloud:c1",
    label: "Local scan",
    group: "Point clouds",
    visible: true,
    opacity: null,
    status: { kind: "unavailable", reason: "Can't place this cloud: it is in a different coordinate system from the site." },
  },
  { id: "cloud:c2", label: "May survey", group: "Point clouds", visible: true, opacity: null, status: { kind: "error", message: "The cloud could not load: HTTP 404" } },
  { id: "water", label: "Water", group: "Environment", visible: true, opacity: null, status: { kind: "ready" } },
  { id: "sky", label: "Sky", group: "Environment", visible: true, opacity: null, status: { kind: "ready" } },
  { id: "photos", label: "Photos", group: "Data", visible: false, opacity: null, status: { kind: "ready" } },
];
function setup(over: Partial<LayersPanelProps> = {}) {
  const props: LayersPanelProps = {
    rows: ROWS,
    onVisible: vi.fn(),
    onOpacity: vi.fn(),
    colourBy: "material",
    onColourBy: vi.fn(),
    cloudColour: "rgb",
    onCloudColour: vi.fn(),
    budget: 3_000_000,
    onBudget: vi.fn(),
    ...over,
  };
  render(<LayersPanel {...props} />);
  return props;
}

describe("LayersPanel", () => {
  it("lists the layers by group, each with a switch", () => {
    setup();
    const panel = screen.getByRole("region", { name: "Layers" });
    expect(within(panel).getAllByRole("heading", { level: 3 }).map((h) => h.textContent)).toEqual([
      "Model",
      "Imagery",
      "Point clouds",
      "Environment",
      "Data",
    ]);
    expect(within(panel).getByRole("switch", { name: "Sky" })).toHaveAttribute("aria-checked", "true");
    expect(within(panel).getByRole("switch", { name: "Photos" })).toHaveAttribute("aria-checked", "false");
  });

  it("a switch toggles its layer", () => {
    const p = setup();
    fireEvent.click(screen.getByRole("switch", { name: "Sky" }));
    expect(p.onVisible).toHaveBeenCalledWith("sky", false);
  });

  it("a layer that can't show is off, disabled and says why; an error reads as an error", () => {
    setup();
    const local = screen.getByRole("switch", { name: "Local scan" });
    expect(local).toBeDisabled();
    expect(local).toHaveAttribute("aria-checked", "false");
    expect(screen.getByText(/^Can't place this cloud/)).toBeInTheDocument();
    expect(screen.getByText("The cloud could not load: HTTP 404")).toHaveClass("text-danger");
  });

  it("opacity sliders show for shown layers that have opacity, and move in 5 % steps", () => {
    const p = setup();
    const slider = screen.getByRole("slider", { name: "May ortho opacity" });
    fireEvent.keyDown(slider, { key: "ArrowRight" });
    expect(p.onOpacity).toHaveBeenCalledWith("ortho:o1", 0.55);
    expect(screen.queryByRole("slider", { name: "Photos opacity" })).toBeNull();
  });

  it("colours the model by a register field, the clouds by colour or height, and sets the point budget", () => {
    const p = setup();
    fireEvent.change(screen.getByLabelText("Colour the model by"), { target: { value: "height_source" } });
    expect(p.onColourBy).toHaveBeenCalledWith("height_source");
    fireEvent.click(screen.getByRole("radio", { name: "Height" }));
    expect(p.onCloudColour).toHaveBeenCalledWith("elevation");
    fireEvent.change(screen.getByLabelText("Point budget"), { target: { value: "5000000" } });
    expect(p.onBudget).toHaveBeenCalledWith(5_000_000);
  });

  it("folds away", () => {
    setup();
    fireEvent.click(screen.getByRole("button", { name: "Hide layers" }));
    expect(screen.queryByRole("switch", { name: "Sky" })).toBeNull();
    expect(screen.getByRole("button", { name: "Show layers" })).toHaveAttribute("aria-expanded", "false");
  });
});
```

`Segmented` renders its options as radios (check `ui/Segmented.tsx`; if it uses `role="tab"` or buttons, change the query, not the assertion).

- [ ] **Step 2: Run them to verify they fail**

Run: `pnpm -C frontend exec vitest run src/site3d/panels/layerRows.test.ts src/site3d/panels/LayersPanel.test.tsx` → Expected: FAIL, modules not found.

- [ ] **Step 3: Implement the rows**

`frontend/src/site3d/panels/layerRows.ts`:

```ts
import type { SiteLayer } from "@/site3d/layers/types";

/** Structurally S2's LayerStatus (`site3d/layers/status.ts`); declared here so S3 builds without S2. */
export type RowStatus =
  | { kind: "loading" }
  | { kind: "ready"; note?: string }
  | { kind: "unavailable"; reason: string }
  | { kind: "error"; message: string };

export type LayerGroup = "Model" | "Imagery" | "Point clouds" | "Environment" | "Data";
export const GROUP_ORDER: readonly LayerGroup[] = ["Model", "Imagery", "Point clouds", "Environment", "Data"];

export interface LayerRow {
  id: string;
  label: string;
  group: LayerGroup;
  visible: boolean;
  /** 0..1, or null when the layer has no opacity control. */
  opacity: number | null;
  status: RowStatus;
}

/** The screen's choices for S1's layers (S2 keeps its own). */
export interface LayerUi {
  visible: Record<string, boolean>;
  opacity: Record<string, number>;
}

export function s1Rows(layers: readonly SiteLayer[], ui: LayerUi): LayerRow[] {
  return layers.map((l) => ({
    id: l.id,
    label: l.label,
    group: l.id === "model" || l.id.startsWith("model:") ? "Model" : "Imagery",
    visible: ui.visible[l.id] ?? true,
    opacity: l.setOpacity ? (ui.opacity[l.id] ?? 1) : null,
    status: { kind: "ready" },
  }));
}

interface ExtraRowLike {
  id: string;
  label: string;
  group: "Point clouds" | "Environment" | "Data";
  visible: boolean;
  layer: { status: { get(): RowStatus } };
}

/** S2's `ExtraLayerRow`s, read structurally. */
export function extraRows(rows: readonly ExtraRowLike[]): LayerRow[] {
  return rows.map((r) => ({ id: r.id, label: r.label, group: r.group, visible: r.visible, opacity: null, status: r.layer.status.get() }));
}

export function groupRows(rows: readonly LayerRow[]): [LayerGroup, LayerRow[]][] {
  return GROUP_ORDER.map((g) => [g, rows.filter((r) => r.group === g)] as [LayerGroup, LayerRow[]]).filter(
    ([, rs]) => rs.length > 0,
  );
}

export function statusLine(s: RowStatus): { text: string; tone: "muted" | "danger" } | null {
  switch (s.kind) {
    case "loading":
      return { text: "Loading…", tone: "muted" };
    case "ready":
      return s.note ? { text: s.note, tone: "muted" } : null;
    case "unavailable":
      return { text: s.reason, tone: "muted" };
    case "error":
      return { text: s.message, tone: "danger" };
  }
}
```

- [ ] **Step 4: Implement the panel**

`frontend/src/site3d/panels/LayersPanel.tsx`:

```tsx
import { useId, useState } from "react";
import { BUDGETS } from "@/clouds/viewer/budget";
import { Button, Field, GlassPanel, Segmented, Select, Slider, Switch, cx } from "@/ui";
import { COLOUR_BY, type ColourBy } from "./engineBridge";
import { groupRows, statusLine, type LayerRow } from "./layerRows";

export type CloudColourChoice = "rgb" | "elevation" | "intensity";
const CLOUD_COLOURS: { value: CloudColourChoice; label: string }[] = [
  { value: "rgb", label: "Colour" },
  { value: "elevation", label: "Height" },
  { value: "intensity", label: "Intensity" },
];
const points = (n: number) => `${n / 1_000_000} M points`;

export interface LayersPanelProps {
  rows: readonly LayerRow[];
  onVisible(id: string, visible: boolean): void;
  onOpacity(id: string, opacity: number): void;
  colourBy: ColourBy;
  onColourBy(c: ColourBy): void;
  /** null hides the cloud controls (no placeable cloud). */
  cloudColour: CloudColourChoice | null;
  onCloudColour(c: CloudColourChoice): void;
  budget: number | null;
  onBudget(n: number): void;
}

function Row({ row, onVisible, onOpacity }: { row: LayerRow } & Pick<LayersPanelProps, "onVisible" | "onOpacity">) {
  const blocked = row.status.kind === "unavailable";
  const line = statusLine(row.status);
  return (
    <li className="flex flex-col gap-1 py-1">
      <Switch checked={row.visible && !blocked} disabled={blocked} onChange={(v) => onVisible(row.id, v)} label={row.label} />
      {line && <p className={cx("pl-10 text-2xs leading-snug", line.tone === "danger" ? "text-danger" : "text-muted")}>{line.text}</p>}
      {row.opacity !== null && row.visible && !blocked && (
        <Slider
          className="pl-10"
          label={`${row.label} opacity`}
          min={0}
          max={100}
          step={5}
          value={Math.round(row.opacity * 100)}
          onChange={(v) => onOpacity(row.id, v / 100)}
          format={(v) => `${v}%`}
        />
      )}
    </li>
  );
}

/** Spec §11 Layers (top left): toggles, opacity, colour-by, cloud height colouring, water and sky. */
export function LayersPanel(p: LayersPanelProps) {
  const [open, setOpen] = useState(true);
  const colourId = useId();
  const budgetId = useId();
  const groups = groupRows(p.rows);
  return (
    <GlassPanel
      as="section"
      variant="float"
      radius="panel"
      aria-label="Layers"
      className="pointer-events-auto flex w-[280px] flex-col gap-2 p-3 animate-reveal reduce-motion:animate-none"
    >
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-sm font-semibold text-ink">Layers</h2>
        <Button variant="ghost" size="sm" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
          {open ? "Hide layers" : "Show layers"}
        </Button>
      </div>
      {open && (
        <div className="flex max-h-[calc(100vh-220px)] flex-col gap-3 overflow-y-auto pr-1">
          {groups.map(([group, rows]) => (
            <section key={group} className="flex flex-col gap-1 border-t border-glass-line pt-2 first:border-t-0 first:pt-0">
              <h3 className="text-xs font-medium text-muted">{group}</h3>
              <ul className="flex flex-col">
                {rows.map((r) => (
                  <Row key={r.id} row={r} onVisible={p.onVisible} onOpacity={p.onOpacity} />
                ))}
              </ul>
              {group === "Model" && (
                <Field label="Colour the model by" htmlFor={colourId}>
                  <Select id={colourId} dense value={p.colourBy} onChange={(e) => p.onColourBy(e.target.value as ColourBy)}>
                    {COLOUR_BY.map((c) => (
                      <option key={c.value} value={c.value}>
                        {c.label}
                      </option>
                    ))}
                  </Select>
                </Field>
              )}
              {group === "Point clouds" && p.cloudColour !== null && (
                <div className="flex flex-col gap-2">
                  <Segmented label="Cloud colour" size="sm" options={CLOUD_COLOURS} value={p.cloudColour} onChange={p.onCloudColour} />
                  {p.budget !== null && (
                    <Field label="Point budget" htmlFor={budgetId}>
                      <Select id={budgetId} dense value={String(p.budget)} onChange={(e) => p.onBudget(Number(e.target.value))}>
                        {BUDGETS.map((b) => (
                          <option key={b} value={String(b)}>
                            {points(b)}
                          </option>
                        ))}
                      </Select>
                    </Field>
                  )}
                </div>
              )}
            </section>
          ))}
        </div>
      )}
    </GlassPanel>
  );
}
```

- [ ] **Step 5: Run the tests and the token check**

Run: the Step 2 command → Expected: 4 + 6 passed.
Run: `node frontend/scripts/check-tokens.mjs frontend/src` → Expected: no violations.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/site3d/panels/layerRows.ts frontend/src/site3d/panels/layerRows.test.ts frontend/src/site3d/panels/LayersPanel.tsx frontend/src/site3d/panels/LayersPanel.test.tsx
git commit -m "feat(site3d): Layers panel with toggles, opacity, colour-by, cloud colour and point budget

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task S3-5: Register panel (search, filters, virtualised cursor-paged list)

**Files:**
- Create: `frontend/src/site3d/panels/useRegister.ts`, `frontend/src/site3d/panels/RegisterPanel.tsx`, `frontend/src/site3d/panels/itemFormat.ts`
- Test: `frontend/src/site3d/panels/useRegister.test.tsx`, `frontend/src/site3d/panels/RegisterPanel.test.tsx`

**Interfaces:**
- Consumes: `listAssetItems`, `ItemQuery`, `AssetItemRow` (Task 2); `useApi`; `messageOf`; `useVirtualRows`, `computeWindow`, `SEARCH_DEBOUNCE_MS`, `Input`, `Select`, `Pill`, `Alert`, `Button`, `EmptyState`, `Skeleton`, `cx`, `focusRing` (`@/ui`).
- Produces: `RegisterState { rows; loading; error; done; loadMore(); retry() }`, `useRegister(projectId, modelId, version, query)`; `RegisterPanel(props: RegisterPanelProps)`; `FLAG_CODES`, `FLAG_TEXT`, `flagText(flag)`, `HEIGHT_SOURCE`, `metres(v)`, `footprintRef(fp)`.

- [ ] **Step 1: Write the failing tests** (Review Focus 4)

`frontend/src/site3d/panels/useRegister.test.tsx`:

```tsx
import type { ReactNode } from "react";
import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AssetItemPage, ItemQuery } from "@/api/plantItems";
import { TestApiProvider } from "@/test/render";
import { fakeClient } from "@/test/fixtures";
import { itemRow } from "@/test/plantFixtures";

interface Call {
  query: ItemQuery;
  cursor: string | null;
  signal?: AbortSignal;
  resolve(p: AssetItemPage): void;
  reject(e: unknown): void;
}
const calls: Call[] = [];
vi.mock("@/api/plantItems", async (orig) => ({
  ...(await orig<typeof import("@/api/plantItems")>()),
  listAssetItems: vi.fn(
    (_api: unknown, _p: string, _m: string, _v: number, query: ItemQuery, cursor: string | null, signal?: AbortSignal) =>
      new Promise<AssetItemPage>((resolve, reject) => calls.push({ query, cursor, signal, resolve, reject })),
  ),
}));
import { useRegister } from "./useRegister";

const page = (ids: string[], next: string | null) => ({ items: ids.map((id) => itemRow({ id, node: id, tag: id })), next_cursor: next }) as AssetItemPage;
function setup(initial: ItemQuery = {}) {
  const { api } = fakeClient([]);
  const wrapper = ({ children }: { children: ReactNode }) => <TestApiProvider api={api}>{children}</TestApiProvider>;
  return renderHook(({ q }: { q: ItemQuery }) => useRegister("p", "m1", 3, q), { wrapper, initialProps: { q: initial } });
}

describe("useRegister", () => {
  beforeEach(() => {
    calls.length = 0;
  });

  it("loads the first page for the query", async () => {
    const h = setup({ q: "20-T" });
    expect(h.result.current.loading).toBe(true);
    expect(calls[0].query.q).toBe("20-T");
    expect(calls[0].cursor).toBeNull();
    await act(async () => calls[0].resolve(page(["a", "b"], null)));
    expect(h.result.current.rows.map((r) => r.id)).toEqual(["a", "b"]);
    expect(h.result.current.done).toBe(true);
    expect(h.result.current.loading).toBe(false);
  });

  it("drops a superseded query: only the last query's rows show", async () => {
    const h = setup({ q: "20" });
    h.rerender({ q: { q: "30" } });
    expect(calls).toHaveLength(2);
    expect(calls[0].signal?.aborted).toBe(true);
    await act(async () => calls[1].resolve(page(["thirty"], null)));
    await act(async () => calls[0].resolve(page(["twenty"], null)));
    expect(h.result.current.rows.map((r) => r.id)).toEqual(["thirty"]);
  });

  it("loads the next page once, however often the end is reached", async () => {
    const h = setup();
    await act(async () => calls[0].resolve(page(["a"], "c2")));
    act(() => {
      h.result.current.loadMore();
      h.result.current.loadMore();
    });
    await waitFor(() => expect(calls).toHaveLength(2));
    expect(calls[1].cursor).toBe("c2");
    await act(async () => calls[1].resolve(page(["b"], null)));
    expect(h.result.current.rows.map((r) => r.id)).toEqual(["a", "b"]);
    act(() => h.result.current.loadMore());
    expect(calls).toHaveLength(2);
  });

  it("an error keeps the rows and retry asks again", async () => {
    const h = setup();
    await act(async () => calls[0].reject(new Error("The server did not answer.")));
    expect(h.result.current.error).toBe("The server did not answer.");
    act(() => h.result.current.retry());
    await waitFor(() => expect(calls).toHaveLength(2));
    await act(async () => calls[1].resolve(page(["a"], null)));
    expect(h.result.current.error).toBeNull();
  });
});
```

`frontend/src/site3d/panels/RegisterPanel.test.tsx`:

```tsx
import { fireEvent, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { renderWithProviders } from "@/test/render";
import { fakeClient } from "@/test/fixtures";
import { itemRow } from "@/test/plantFixtures";
import { RegisterPanel } from "./RegisterPanel";

const rows = [
  itemRow(),
  itemRow({ id: "30-P-0001", node: "30-P-0001", tag: "30-P-0001", name: "Send-out pump 1", type: "pump", area: "30", flags: [{ code: "height_mismatch", value: 1.2, note: null }] as never }),
  itemRow({ id: "untagged-1", node: "untagged-1", tag: null, name: "Pipe rack segment", type: "pipe_rack", area: "30" }),
];
function setup() {
  const client = fakeClient(
    [{ method: "GET", path: /\/versions\/3\/items$/, body: { items: rows, next_cursor: null } }] as never,
    { signalSafe: true },
  );
  const onPick = vi.fn();
  renderWithProviders(
    <RegisterPanel projectId="p" modelId="m1" version={3} catalogueTypes={["pump", "pipe_rack", "tank_lng"]} selectedId={null} onPick={onPick} />,
    { api: client.api },
  );
  return { ...client, onPick };
}
const lastQuery = (urls: { url: string }[]) => new URL(urls[urls.length - 1].url, "http://x").searchParams;

describe("RegisterPanel", () => {
  it("lists the items with tag, name, type and flags, and a row click picks it", async () => {
    const { onPick } = setup();
    const row = await screen.findByRole("button", { name: /30-P-0001/ });
    expect(row).toHaveTextContent("Send-out pump 1");
    expect(row).toHaveTextContent("1 flag");
    expect(screen.getByRole("button", { name: /untagged/i })).toHaveTextContent("Pipe rack segment");
    fireEvent.click(row);
    expect(onPick).toHaveBeenCalledWith(rows[1]);
    expect(screen.getByText("3 items")).toBeInTheDocument();
  });

  it("searches by tag or name after a short pause", async () => {
    const { requests } = setup();
    await screen.findByRole("button", { name: /30-P-0001/ });
    fireEvent.change(screen.getByRole("searchbox", { name: "Search the register" }), { target: { value: "pump" } });
    await waitFor(() => expect(lastQuery(requests).get("q")).toBe("pump"));
  });

  it("filters by type, area and flag", async () => {
    const { requests } = setup();
    await screen.findByRole("button", { name: /30-P-0001/ });
    fireEvent.change(screen.getByLabelText("Type"), { target: { value: "pump" } });
    fireEvent.change(screen.getByLabelText("Flag"), { target: { value: "height_mismatch" } });
    await waitFor(() => expect(lastQuery(requests).get("flag")).toBe("height_mismatch"));
    expect(lastQuery(requests).get("type")).toBe("pump");
    fireEvent.change(screen.getByLabelText("Area"), { target: { value: "30" } });
    await waitFor(() => expect(lastQuery(requests).get("area")).toBe("30"));
  });
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `pnpm -C frontend exec vitest run src/site3d/panels/useRegister.test.tsx src/site3d/panels/RegisterPanel.test.tsx` → Expected: FAIL, modules not found.

- [ ] **Step 3: Implement the formatting helpers**

`frontend/src/site3d/panels/itemFormat.ts`:

```ts
import type { AssetItem } from "@/api/plantItems";

export const FLAG_CODES = ["plan_offset", "height_mismatch", "missing_in_cloud", "unregistered", "builder_fallback", "straddles_package"] as const;
export type FlagCode = (typeof FLAG_CODES)[number];
/** Plain words for the cloud check's and builders' flags (PRODUCT.md: no jargon). */
export const FLAG_TEXT: Record<FlagCode, string> = {
  plan_offset: "Off its drawn spot in the scan",
  height_mismatch: "Height differs from the scan",
  missing_in_cloud: "Not found in the scan",
  unregistered: "In the scan, not in the register",
  builder_fallback: "Drawn as a simple block",
  straddles_package: "Traced in two work packages",
};
export const HEIGHT_SOURCE: Record<string, { label: string; tone: "ok" | "info" | "warn" }> = {
  drawing: { label: "From the drawing", tone: "ok" },
  cloud: { label: "From the scan", tone: "info" },
  indicative: { label: "Indicative", tone: "warn" },
};

export const metres = (v: number | null | undefined) => (v == null ? "not set" : `${v.toFixed(2)} m`);

export function flagText(f: { code: string; value?: number | null; note?: string | null }): string {
  const base = FLAG_TEXT[f.code as FlagCode] ?? f.code;
  const value = f.value != null ? ` (${f.value.toFixed(2)} m)` : "";
  return `${base}${value}${f.note ? `: ${f.note}` : ""}`;
}

/** The footprint's reference point in plant [E, N]: rect/circle centre, polygon/line vertex mean. */
export function footprintRef(fp: AssetItem["footprint"]): [number, number] {
  const f = fp as { kind: string; center?: number[]; pts?: number[][] };
  if (f.center) return [f.center[0], f.center[1]];
  const pts = f.pts ?? [];
  return pts.length ? [pts.reduce((a, p) => a + p[0], 0) / pts.length, pts.reduce((a, p) => a + p[1], 0) / pts.length] : [0, 0];
}
```

- [ ] **Step 4: Implement the hook**

`frontend/src/site3d/panels/useRegister.ts`:

```ts
import { useCallback, useEffect, useState } from "react";
import { useApi } from "@/api/client";
import { messageOf } from "@/api/errors";
import { listAssetItems, type AssetItemRow, type ItemQuery } from "@/api/plantItems";

export interface RegisterState {
  rows: AssetItemRow[];
  loading: boolean;
  error: string | null;
  /** The last page has arrived. */
  done: boolean;
  loadMore(): void;
  retry(): void;
}

interface Loaded {
  key: string;
  rows: AssetItemRow[];
  next: string | null;
  /** The cursor of the last page applied (null = the first page). */
  at: string | null | undefined;
  error: string | null;
}

/**
 * A version's register as cursor pages of 200 for one query. A new query starts over and aborts the
 * one in flight, whose late answer is dropped (Review Focus 4); `loadMore` asks for the next page at
 * most once.
 */
export function useRegister(projectId: string, modelId: string, version: number, query: ItemQuery): RegisterState {
  const api = useApi();
  const { q = "", type = "", area = "", flag = "" } = query;
  const key = [projectId, modelId, version, q, type, area, flag].join("\u0000");
  const [loaded, setLoaded] = useState<Loaded>({ key: "", rows: [], next: null, at: undefined, error: null });
  const [want, setWant] = useState<{ key: string; cursor: string | null; attempt: number }>({ key: "", cursor: null, attempt: 0 });
  const cursor = want.key === key ? want.cursor : null;
  const attempt = want.key === key ? want.attempt : 0;
  const current: Loaded = loaded.key === key ? loaded : { key, rows: [], next: null, at: undefined, error: null };

  useEffect(() => {
    const ctrl = new AbortController();
    listAssetItems(api, projectId, modelId, version, { q, type, area, flag }, cursor, ctrl.signal).then(
      (page) => {
        if (ctrl.signal.aborted) return;
        setLoaded((prev) => ({
          key,
          rows: [...(cursor !== null && prev.key === key ? prev.rows : []), ...page.items],
          next: page.next_cursor ?? null,
          at: cursor,
          error: null,
        }));
      },
      (e: unknown) => {
        if (ctrl.signal.aborted) return;
        setLoaded((prev) => ({ ...(prev.key === key ? prev : { rows: [], next: null, at: undefined }), key, error: messageOf(e, "The register could not be loaded.") }));
      },
    );
    return () => ctrl.abort();
  }, [api, projectId, modelId, version, q, type, area, flag, key, cursor, attempt]);

  const loading = current.error === null && current.at !== cursor;
  const done = current.at === cursor && current.next === null && current.error === null;
  const next = current.next;
  const loadMore = useCallback(() => {
    if (loading || !next || current.error) return;
    setWant((w) => ({ key, cursor: next, attempt: w.key === key ? w.attempt : 0 }));
  }, [loading, next, current.error, key]);
  const retry = useCallback(() => {
    setLoaded((prev) => (prev.key === key ? { ...prev, error: null } : prev));
    setWant((w) => ({ key, cursor: w.key === key ? w.cursor : null, attempt: (w.key === key ? w.attempt : 0) + 1 }));
  }, [key]);

  return { rows: current.rows, loading, error: current.error, done, loadMore, retry };
}
```

Note on `loading` after a first-page error then retry: `retry` clears the error and bumps `attempt`; `current.at` stays `undefined`, so `loading` is true until the answer.

- [ ] **Step 5: Implement the panel**

`frontend/src/site3d/panels/RegisterPanel.tsx`:

```tsx
import { useEffect, useId, useMemo, useState } from "react";
import type { AssetItemRow } from "@/api/plantItems";
import {
  Alert,
  Button,
  EmptyState,
  Input,
  Pill,
  SEARCH_DEBOUNCE_MS,
  Select,
  Skeleton,
  computeWindow,
  cx,
  focusRing,
  useVirtualRows,
} from "@/ui";
import { FLAG_CODES, FLAG_TEXT } from "./itemFormat";
import { useRegister } from "./useRegister";

const ROW_H = 44;
/** Rows from the end at which the next page is asked for. */
const AHEAD = 30;
const fmt = new Intl.NumberFormat("en-GB");

export interface RegisterPanelProps {
  projectId: string;
  modelId: string;
  version: number;
  /** Type filter options: the builder catalogue's types (Ruling 16). */
  catalogueTypes: readonly string[];
  selectedId: string | null;
  onPick(row: AssetItemRow): void;
}

/** Spec §11 Register (right): search by tag or name, filter by area, type and flag, fly to a row. */
export function RegisterPanel(p: RegisterPanelProps) {
  const [text, setText] = useState("");
  const [q, setQ] = useState("");
  const [type, setType] = useState("");
  const [area, setArea] = useState("");
  const [flag, setFlag] = useState("");
  useEffect(() => {
    const t = window.setTimeout(() => setQ(text), SEARCH_DEBOUNCE_MS);
    return () => window.clearTimeout(t);
  }, [text]);
  const reg = useRegister(p.projectId, p.modelId, p.version, { q, type, area, flag });
  const [seenAreas, setSeenAreas] = useState<readonly string[]>([]);
  const areas = useMemo(() => {
    const s = new Set([...seenAreas, ...reg.rows.map((r) => r.area).filter((a): a is string => !!a), ...(area ? [area] : [])]);
    return [...s].sort();
  }, [seenAreas, reg.rows, area]);
  const vp = useVirtualRows({ rowHeight: ROW_H });
  const win = computeWindow(vp.scrollTop, vp.height, ROW_H, reg.rows.length);
  const ids = { type: useId(), area: useId(), flag: useId() };
  const filtered = !!(q || type || area || flag);

  const onScroll = () => {
    vp.onScroll();
    const el = vp.containerRef.current;
    if (el && el.scrollTop + el.clientHeight >= (reg.rows.length - AHEAD) * ROW_H) reg.loadMore();
  };

  return (
    <section aria-label="Register" className="flex min-h-0 flex-1 flex-col gap-2">
      <Input
        type="search"
        aria-label="Search the register"
        placeholder="Search by tag or name"
        value={text}
        onChange={(e) => setText(e.target.value)}
      />
      <div className="grid grid-cols-3 gap-1.5">
        <label htmlFor={ids.type} className="sr-only">Type</label>
        <Select id={ids.type} dense value={type} onChange={(e) => setType(e.target.value)}>
          <option value="">All types</option>
          {p.catalogueTypes.map((t) => (
            <option key={t} value={t}>{t.replace(/_/g, " ")}</option>
          ))}
        </Select>
        <label htmlFor={ids.area} className="sr-only">Area</label>
        <Select
          id={ids.area}
          dense
          value={area}
          onChange={(e) => {
            setSeenAreas(areas);
            setArea(e.target.value);
          }}
        >
          <option value="">All areas</option>
          {areas.map((a) => (
            <option key={a} value={a}>{a}</option>
          ))}
        </Select>
        <label htmlFor={ids.flag} className="sr-only">Flag</label>
        <Select id={ids.flag} dense value={flag} onChange={(e) => setFlag(e.target.value)}>
          <option value="">Any flag</option>
          {FLAG_CODES.map((f) => (
            <option key={f} value={f}>{FLAG_TEXT[f]}</option>
          ))}
        </Select>
      </div>
      <p className="font-mono text-2xs tabular-nums text-muted">
        {`${fmt.format(reg.rows.length)}${reg.done ? "" : "+"} item${reg.rows.length === 1 ? "" : "s"}`}
      </p>
      {reg.error && (
        <Alert
          tone="danger"
          title="The register could not be loaded."
          actions={<Button size="sm" icon="refresh" onClick={reg.retry}>Retry</Button>}
        >
          <p className="text-xs text-muted">{reg.error}</p>
        </Alert>
      )}
      {reg.rows.length === 0 && reg.loading && (
        <div role="status" aria-label="Loading the register" className="flex flex-col gap-1.5">
          {Array.from({ length: 6 }, (_, i) => (
            <Skeleton key={i} className="h-9 w-full rounded-sm" />
          ))}
        </div>
      )}
      {reg.rows.length === 0 && reg.done && (
        <EmptyState icon="list" title={filtered ? "No items match" : "This version has no items yet"}>
          {filtered ? "Clear the search or a filter to see more." : "A plant run or an edit adds them."}
        </EmptyState>
      )}
      <div ref={vp.containerRef} onScroll={onScroll} className="relative min-h-0 flex-1 overflow-y-auto">
        <ul aria-label="Register items" style={{ height: win.totalHeight }} className="relative">
          {reg.rows.slice(win.start, win.end).map((r, i) => {
            const flags = (r.flags ?? []).length;
            const selected = r.id === p.selectedId;
            return (
              <li key={r.id} className="absolute inset-x-0" style={{ top: (win.start + i) * ROW_H, height: ROW_H }}>
                <button
                  type="button"
                  aria-pressed={selected}
                  onClick={() => p.onPick(r)}
                  className={cx(
                    "flex h-full w-full items-center gap-2 rounded-sm px-2 text-left hover:bg-hover",
                    selected && "bg-accent-soft",
                    focusRing,
                  )}
                >
                  <span className="flex min-w-0 flex-1 flex-col">
                    <span className={cx("font-mono text-xs", r.tag ? "text-ink" : "text-dim")}>{r.tag ?? "Untagged"}</span>
                    <span className="truncate text-xs text-muted">{r.name}</span>
                  </span>
                  <span className="shrink-0 text-2xs text-dim">{r.type.replace(/_/g, " ")}</span>
                  {flags > 0 && (
                    <Pill size="sm" tone="warn">{`${flags} flag${flags === 1 ? "" : "s"}`}</Pill>
                  )}
                </button>
              </li>
            );
          })}
        </ul>
      </div>
    </section>
  );
}
```

If `EmptyState`'s icon list lacks `list`, use `"grid"` (both exist in `ui/Icon.tsx`). The `RegisterPanel.test.tsx` "filters" case looks the selects up by their `sr-only` labels.

- [ ] **Step 6: Run the tests and the token check**

Run: the Step 2 command → Expected: useRegister 4 passed, RegisterPanel 3 passed. Then `node frontend/scripts/check-tokens.mjs frontend/src` → no violations.

- [ ] **Step 7: Commit**

```bash
git add frontend/src/site3d/panels/itemFormat.ts frontend/src/site3d/panels/useRegister.ts frontend/src/site3d/panels/useRegister.test.tsx frontend/src/site3d/panels/RegisterPanel.tsx frontend/src/site3d/panels/RegisterPanel.test.tsx
git commit -m "feat(site3d): register panel with search, filters and a virtualised cursor-paged list

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task S3-6: Item panel (row, flags, Source)

**Files:**
- Create: `frontend/src/site3d/panels/ItemPanel.tsx`, `frontend/src/site3d/panels/SourcePopover.tsx`
- Test: `frontend/src/site3d/panels/ItemPanel.test.tsx`

**Interfaces:**
- Consumes: `getAssetItem` (S1, `@/api/siteScene`; Task 1 recorded its signature, expected `(api, projectId, assetModelId, version, itemId) => Promise<AssetItem>`); `AssetItem` (Task 2); `itemFormat.ts` (Task 5); `drawingThumbnailUrl` (`@contract/client`); `useApi`, `useBackend`; `Popover`, `Pill`, `Button`, `Alert`, `Skeleton` (`@/ui`).
- Produces: `ItemPanel(props: { projectId: string; modelId: string; version: number; itemId: string; onBack(): void; onEdit(item: AssetItem): void })`, `SourcePopover`.

- [ ] **Step 1: Write the failing test**

`frontend/src/site3d/panels/ItemPanel.test.tsx`:

```tsx
import { fireEvent, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { renderWithProviders } from "@/test/render";
import { fakeClient } from "@/test/fixtures";
import { ITEM } from "@/test/plantFixtures";
import { ItemPanel } from "./ItemPanel";

function setup(item = ITEM) {
  const { api } = fakeClient([{ method: "GET", path: /\/versions\/3\/items\/20-T-0001$/, body: item }] as never);
  const onEdit = vi.fn();
  const onBack = vi.fn();
  renderWithProviders(
    <ItemPanel projectId="p" modelId="m1" version={3} itemId="20-T-0001" onBack={onBack} onEdit={onEdit} />,
    { api },
  );
  return { onEdit, onBack };
}

describe("ItemPanel", () => {
  it("shows the register row: tag, name, type, area, plant E/N and heights with their source", async () => {
    setup();
    expect(await screen.findByRole("heading", { name: "LNG tank 1" })).toBeInTheDocument();
    expect(screen.getByText("20-T-0001")).toHaveClass("font-mono");
    expect(screen.getByText("tank lng")).toBeInTheDocument();
    expect(screen.getByText("E 100.00 · N 200.00")).toBeInTheDocument();
    expect(screen.getByText("135.00 m")).toBeInTheDocument();
    expect(screen.getByText("From the drawing")).toBeInTheDocument();
  });

  it("lists the flags in plain words", async () => {
    setup();
    const flags = await screen.findByRole("list", { name: "Flags" });
    expect(flags).toHaveTextContent("Height differs from the scan (1.20 m): Scan top at EL 136.2");
  });

  it("Source shows the drawing with the traced region and a way to open it", async () => {
    setup();
    fireEvent.click(await screen.findByRole("button", { name: "Source" }));
    const pop = await screen.findByRole("dialog", { name: "Source" });
    expect(pop.querySelector("img")?.getAttribute("src")).toContain("/drawings/dr-1/thumbnail");
    const region = screen.getByTestId("source-region");
    expect(region.style.left).toBe("10%");
    expect(region.style.width).toBe("20%");
    expect(screen.getByText("Page 2")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Open the drawing in Maps" })).toHaveAttribute("href", "/p/p/maps?sel=drawing:dr-1");
  });

  it("Edit hands the full item over; Register goes back", async () => {
    const { onEdit, onBack } = setup();
    fireEvent.click(await screen.findByRole("button", { name: "Edit" }));
    expect(onEdit).toHaveBeenCalledWith(ITEM);
    fireEvent.click(screen.getByRole("button", { name: "Register" }));
    expect(onBack).toHaveBeenCalled();
  });

  it("an assumed source says so, with no popover", async () => {
    setup({ ...ITEM, source: { kind: "assumed" } } as never);
    expect(await screen.findByText("Assumed")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Source" })).toBeNull();
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm -C frontend exec vitest run src/site3d/panels/ItemPanel.test.tsx` → Expected: FAIL, module not found.

- [ ] **Step 3: Implement the source popover (Ruling 10)**

`frontend/src/site3d/panels/SourcePopover.tsx`:

```tsx
import { useRef, useState } from "react";
import { Link } from "react-router-dom";
import { drawingThumbnailUrl } from "@contract/client";
import { useBackend } from "@/api/client";
import { Button, Popover } from "@/ui";

/** "Source opens drawing crop" (spec §11): the drawing's thumbnail with the traced region outlined. */
export function SourcePopover({
  projectId,
  drawingId,
  page,
  region,
}: {
  projectId: string;
  drawingId: string;
  page: number | null;
  region: readonly number[] | null;
}) {
  const [open, setOpen] = useState(false);
  const anchor = useRef<HTMLSpanElement>(null);
  const { baseUrl, token } = useBackend();
  const [x0, y0, x1, y1] = region ?? [0, 0, 1, 1];
  return (
    <>
      <span ref={anchor} className="inline-grid">
        <Button size="sm" variant="secondary" icon="drawing" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
          Source
        </Button>
      </span>
      <Popover open={open} onClose={() => setOpen(false)} anchorRef={anchor} label="Source" side="left" align="start">
        <div className="flex w-64 flex-col gap-2 p-1">
          <div className="relative overflow-hidden rounded-sm bg-bg">
            <img
              src={drawingThumbnailUrl(baseUrl, token, projectId, drawingId)}
              alt={`Drawing ${drawingId}`}
              className="block w-full"
            />
            {region && (
              <span
                data-testid="source-region"
                aria-hidden="true"
                className="absolute rounded-sm border-2 border-accent"
                style={{
                  left: `${Math.round(x0 * 100)}%`,
                  top: `${Math.round(y0 * 100)}%`,
                  width: `${Math.round((x1 - x0) * 100)}%`,
                  height: `${Math.round((y1 - y0) * 100)}%`,
                }}
              />
            )}
          </div>
          {page != null && <p className="text-2xs text-muted">{`Page ${page}`}</p>}
          <Link className="text-xs text-accent-ink underline-offset-2 hover:underline" to={`/p/${projectId}/maps?sel=drawing:${drawingId}`}>
            Open the drawing in Maps
          </Link>
        </div>
      </Popover>
    </>
  );
}
```

- [ ] **Step 4: Implement the item panel**

`frontend/src/site3d/panels/ItemPanel.tsx`:

```tsx
import { useEffect, useState } from "react";
import { useApi } from "@/api/client";
import { messageOf } from "@/api/errors";
import type { AssetItem } from "@/api/plantItems";
import { getAssetItem } from "@/api/siteScene";
import { Alert, Button, Pill, Skeleton } from "@/ui";
import { HEIGHT_SOURCE, flagText, footprintRef, metres } from "./itemFormat";
import { SourcePopover } from "./SourcePopover";

const CONFIDENCE = { high: "ok", medium: "neutral", low: "warn" } as const;
const SOURCE_KIND: Record<string, string> = { drawing: "Drawing", cloud: "Point cloud", photo: "Photo", assumed: "Assumed" };

/** Spec §11 Item (right, on selection): the register row, its flags, its source, and Edit. */
export function ItemPanel(p: {
  projectId: string;
  modelId: string;
  version: number;
  itemId: string;
  onBack(): void;
  onEdit(item: AssetItem): void;
}) {
  const api = useApi();
  const key = `${p.modelId}/${p.version}/${p.itemId}`;
  const [loaded, setLoaded] = useState<{ key: string; item: AssetItem | null; error: string | null } | null>(null);
  useEffect(() => {
    let alive = true;
    getAssetItem(api, p.projectId, p.modelId, p.version, p.itemId).then(
      (item) => alive && setLoaded({ key, item, error: null }),
      (e: unknown) => alive && setLoaded({ key, item: null, error: messageOf(e, "The item could not be loaded.") }),
    );
    return () => {
      alive = false;
    };
  }, [api, p.projectId, p.modelId, p.version, p.itemId, key]);
  const current = loaded?.key === key ? loaded : null;
  const item = current?.item ?? null;

  return (
    <section aria-label="Item" className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto">
      <div>
        <Button variant="ghost" size="sm" icon="arrow-left" onClick={p.onBack}>
          Register
        </Button>
      </div>
      {current?.error && <Alert tone="danger" title="The item could not be loaded.">{current.error}</Alert>}
      {!current && (
        <div role="status" aria-label="Loading the item" className="flex flex-col gap-2">
          <Skeleton className="h-5 w-40" />
          <Skeleton className="h-24 w-full rounded-sm" />
        </div>
      )}
      {item && (
        <>
          <header className="flex flex-col gap-0.5">
            <p className={item.tag ? "font-mono text-xs text-muted" : "text-xs text-dim"}>{item.tag ?? "Untagged"}</p>
            <h2 className="text-lg font-semibold text-ink">{item.name}</h2>
          </header>
          <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1 text-xs">
            <dt className="text-muted">Type</dt>
            <dd className="text-ink">{item.type.replace(/_/g, " ")}</dd>
            <dt className="text-muted">Area</dt>
            <dd className="text-ink">{item.area ?? "not set"}</dd>
            <dt className="text-muted">Plant</dt>
            <dd className="font-mono tabular-nums text-ink">
              {(() => {
                const [e, n] = footprintRef(item.footprint);
                return `E ${e.toFixed(2)} · N ${n.toFixed(2)}`;
              })()}
            </dd>
            <dt className="text-muted">Base EL</dt>
            <dd className="font-mono tabular-nums text-ink">{metres(item.base_el)}</dd>
            <dt className="text-muted">Top EL</dt>
            <dd className="font-mono tabular-nums text-ink">{metres(item.top_el)}</dd>
            <dt className="text-muted">Height</dt>
            <dd>
              <Pill size="sm" tone={HEIGHT_SOURCE[item.height_source]?.tone ?? "neutral"}>
                {HEIGHT_SOURCE[item.height_source]?.label ?? item.height_source}
              </Pill>
            </dd>
            <dt className="text-muted">Confidence</dt>
            <dd>
              <Pill size="sm" tone={CONFIDENCE[item.confidence as keyof typeof CONFIDENCE] ?? "neutral"}>
                {item.confidence}
              </Pill>
            </dd>
          </dl>
          {item.flags.length > 0 && (
            <ul aria-label="Flags" className="flex flex-col gap-1">
              {item.flags.map((f, i) => (
                <li key={i} className="rounded-sm bg-warn-soft px-2 py-1 text-xs text-ink">
                  {flagText(f)}
                </li>
              ))}
            </ul>
          )}
          <div className="flex flex-wrap items-center gap-2">
            {item.source.kind === "drawing" && item.source.id ? (
              <SourcePopover
                projectId={p.projectId}
                drawingId={item.source.id}
                page={(item.source as { page?: number | null }).page ?? null}
                region={item.source.region ?? null}
              />
            ) : (
              <span className="text-xs text-muted">
                Source <span className="text-ink">{SOURCE_KIND[item.source.kind] ?? item.source.kind}</span>
              </span>
            )}
            <Button size="sm" variant="primary" icon="label" className="ml-auto" onClick={() => p.onEdit(item)}>
              Edit
            </Button>
          </div>
          {item.notes && <p className="text-xs leading-relaxed text-muted">{item.notes}</p>}
        </>
      )}
    </section>
  );
}
```

- [ ] **Step 5: Run the test and the token check**

Run: the Step 2 command → Expected: 5 passed. `node frontend/scripts/check-tokens.mjs frontend/src` → no violations.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/site3d/panels/ItemPanel.tsx frontend/src/site3d/panels/SourcePopover.tsx frontend/src/site3d/panels/ItemPanel.test.tsx
git commit -m "feat(site3d): item panel with the register row, flags in plain words and its drawing source

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task S3-7: Item editor (schema-driven form, base version, unsaved-edit prompt, saves a manual version)

**Files:**
- Create: `frontend/src/site3d/panels/itemEdit.ts`, `frontend/src/site3d/panels/ItemEditor.tsx`, `frontend/src/site3d/panels/useDiscardGuard.tsx`
- Test: `frontend/src/site3d/panels/itemEdit.test.ts`, `frontend/src/site3d/panels/ItemEditor.test.tsx`, `frontend/src/site3d/panels/useDiscardGuard.test.tsx`

**Interfaces:**
- Consumes: `AssetItem`, `CatalogueEntry` (Task 2); `getVersion`, `createVersion` (`@/api/assetModels`); `useJobsStore` (`@/store/jobs`); `messageOf`; `useBlocker` (react-router-dom 6.30, data router); `Dialog`, `Field`, `Input`, `Select`, `Switch`, `Textarea`, `Button`, `Alert`, `Disclosure`, `toast` (`@/ui`).
- Produces: `FieldSpec`, `fieldsFromSchema(schema)`, `ItemDraft`, `draftOf(item, fields)`, `validateDraft(draft, fields, kind)`, `applyDraft(item, draft, fields)`, `withItem(spec, item)`, `editNote(before, after, base)`, `sameDraft(a, b)`; `ItemEditor(props: ItemEditorProps)`; `useDiscardGuard(dirty, name)`.

- [ ] **Step 1: Write the failing tests**

`frontend/src/site3d/panels/itemEdit.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { CATALOGUE, ITEM, PUMP, plantSpec } from "@/test/plantFixtures";
import { applyDraft, draftOf, editNote, fieldsFromSchema, sameDraft, validateDraft, withItem } from "./itemEdit";

const tankFields = fieldsFromSchema(CATALOGUE[0].params_schema);

describe("fieldsFromSchema", () => {
  it("reads numbers, enums, booleans, integers and nullable arrays from a pydantic schema", () => {
    expect(tankFields.map((f) => [f.key, f.kind, f.label, f.unit ?? null])).toEqual([
      ["d_m", "number", "D", "m"],
      ["roof", "enum", "Roof", null],
      ["platforms", "boolean", "Platforms", null],
      ["risers", "integer", "Risers", null],
      ["nozzles", "json", "Nozzles", null],
    ]);
    const d = tankFields[0];
    expect([d.min, d.exclusiveMin, d.defaultValue]).toEqual([0, true, 80]);
    expect(tankFields[1].options).toEqual(["dome", "flat"]);
    expect(tankFields[4].nullable).toBe(true);
  });
  it("an empty schema has no fields", () => {
    expect(fieldsFromSchema({ type: "object", properties: {} })).toEqual([]);
    expect(fieldsFromSchema(null)).toEqual([]);
  });
});

describe("drafts", () => {
  it("round-trips an item unchanged", () => {
    const d = draftOf(ITEM, tankFields);
    expect(d.top_el).toBe("135");
    expect(d.fp).toEqual({ e: "100", n: "200", d: "80" });
    expect(applyDraft(ITEM, d, tankFields)).toEqual(ITEM);
  });
  it("applies new heights, footprint numbers and params", () => {
    const d = draftOf(ITEM, tankFields);
    const next = applyDraft(ITEM, { ...d, top_el: "140.5", fp: { ...d.fp, d: "82" }, params: { ...d.params, roof: "flat", platforms: false } }, tankFields);
    expect(next.top_el).toBe(140.5);
    expect(next.footprint).toEqual({ kind: "circle", center: [100, 200], d: 82 });
    expect(next.params).toEqual({ d_m: 80, roof: "flat", platforms: false });
  });
  it("a new type starts from that type's defaults (params cleared)", () => {
    const d = draftOf(ITEM, tankFields);
    expect(applyDraft(ITEM, { ...d, type: "other" }, []).params).toEqual({});
  });
  it("validates numbers, ordering and schema limits", () => {
    const d = draftOf(ITEM, tankFields);
    expect(validateDraft({ ...d, top_el: "90" }, tankFields, "circle")).toEqual({ top_el: "Top EL must be at or above base EL." });
    expect(validateDraft({ ...d, top_el: "abc" }, tankFields, "circle")).toEqual({ top_el: "Enter a number." });
    expect(validateDraft({ ...d, fp: { ...d.fp, d: "0" } }, tankFields, "circle")).toEqual({ "fp.d": "Must be more than 0." });
    expect(validateDraft({ ...d, params: { ...d.params, d_m: "0" } }, tankFields, "circle")).toEqual({ "params.d_m": "Must be more than 0." });
    expect(validateDraft({ ...d, params: { ...d.params, risers: "2.5" } }, tankFields, "circle")).toEqual({ "params.risers": "Enter a whole number." });
    expect(validateDraft({ ...d, params: { ...d.params, nozzles: "[1," } }, tankFields, "circle")).toEqual({ "params.nozzles": "Enter valid JSON." });
    expect(validateDraft(d, tankFields, "circle")).toEqual({});
  });
  it("knows an untouched draft", () => {
    expect(sameDraft(draftOf(ITEM, tankFields), draftOf(ITEM, tankFields))).toBe(true);
    expect(sameDraft(draftOf(ITEM, tankFields), { ...draftOf(ITEM, tankFields), base_el: "99" })).toBe(false);
  });
});

describe("saving", () => {
  it("replaces the item in the base spec and leaves the others alone", () => {
    const spec = withItem(plantSpec(), { ...ITEM, top_el: 140 } as never);
    const items = (spec as unknown as { items: { id: string; top_el: number }[] }).items;
    expect(items.map((i) => [i.id, i.top_el])).toEqual([["20-T-0001", 140], [PUMP.id, 103]]);
  });
  it("an item missing from the base spec is an error, never a silent add", () => {
    expect(() => withItem(plantSpec([PUMP]), ITEM)).toThrow(/20-T-0001 is not in this version/);
  });
  it("names the base version and every change in the note", () => {
    expect(editNote(ITEM, { ...ITEM, top_el: 140 } as never, 3)).toBe("Edited 20-T-0001 from v3: top EL 135 → 140 m");
    expect(editNote(ITEM, { ...ITEM, type: "other", params: {} } as never, 3)).toBe("Edited 20-T-0001 from v3: type tank_lng → other, params");
  });
});
```

`frontend/src/site3d/panels/ItemEditor.test.tsx`:

```tsx
import { fireEvent, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderWithProviders } from "@/test/render";
import { errorBody, fakeClient } from "@/test/fixtures";
import { VERSION_2 } from "@/test/assetModelFixtures";
import { CATALOGUE, ITEM, plantSpec } from "@/test/plantFixtures";
import { useJobsStore } from "@/store/jobs";
import { ItemEditor } from "./ItemEditor";

const JOB = { id: "j1", project_id: "p", type: "asset_model_glb", state: "queued", progress: 0, message: "", log_path: "", params: {}, result: null, error: null, created_at: "2026-10-03T09:00:00Z", started_at: null, finished_at: null };
function setup(post: { status?: number; body: unknown } = { status: 201, body: { version: { ...VERSION_2, version: 4 }, job: JOB } }) {
  const client = fakeClient([
    { method: "GET", path: /\/asset-models\/m1\/versions\/3$/, body: { ...VERSION_2, version: 3, spec: plantSpec(), warnings: [] } },
    { method: "POST", path: /\/asset-models\/m1\/versions$/, status: post.status, body: post.body },
  ] as never);
  const props = { onSaved: vi.fn(), onCancel: vi.fn(), onDirty: vi.fn() };
  renderWithProviders(
    <ItemEditor projectId="p" modelId="m1" baseVersion={3} item={ITEM} catalogue={CATALOGUE} {...props} />,
    { api: client.api },
  );
  return { ...client, ...props };
}

describe("ItemEditor", () => {
  beforeEach(() => useJobsStore.setState({ jobs: {} }));

  it("says which version it edits from", () => {
    setup();
    expect(screen.getByText(/editing from version/i)).toHaveTextContent("Editing from version 3");
  });

  it("saves an edited top EL as a new manual version and hands over the GLB job", async () => {
    const { requests, onSaved, onDirty } = setup();
    fireEvent.change(screen.getByLabelText(/^top el/i), { target: { value: "140" } });
    expect(onDirty).toHaveBeenLastCalledWith(true);
    fireEvent.click(screen.getByRole("button", { name: "Save as new version" }));
    await waitFor(() => expect(onSaved).toHaveBeenCalledWith(4, "j1"));
    const post = requests.find((r) => r.method === "POST")!.body as { spec: { items: { id: string; top_el: number }[] }; note: string };
    expect(post.spec.items.find((i) => i.id === "20-T-0001")!.top_el).toBe(140);
    expect(post.note).toBe("Edited 20-T-0001 from v3: top EL 135 → 140 m");
    expect(useJobsStore.getState().jobs.j1).toBeDefined();
  });

  it("blocks a save that breaks a rule and says why", () => {
    setup();
    fireEvent.change(screen.getByLabelText(/^top el/i), { target: { value: "90" } });
    expect(screen.getByText("Top EL must be at or above base EL.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Save as new version" })).toBeDisabled();
  });

  it("draws the type's params from its schema", () => {
    setup();
    expect(screen.getByLabelText(/^d m$/i)).toHaveValue(80); // "D" with its unit; the footprint's is "Diameter m"
    expect(screen.getByLabelText(/^roof/i)).toHaveValue("dome");
    expect(screen.getByRole("switch", { name: "Platforms" })).toHaveAttribute("aria-checked", "true");
  });

  it("a new type says the old params go", () => {
    setup();
    fireEvent.change(screen.getByLabelText(/^type/i), { target: { value: "other" } });
    expect(screen.getByText(/start from the new type's defaults/i)).toBeInTheDocument();
    expect(screen.queryByLabelText(/^roof/i)).toBeNull();
  });

  it("a failed save says why and keeps the edit", async () => {
    const { onSaved } = setup({ status: 422, body: errorBody("invalid_spec", "items[0].top_el: below base_el") });
    fireEvent.change(screen.getByLabelText(/^top el/i), { target: { value: "141" } });
    fireEvent.click(screen.getByRole("button", { name: "Save as new version" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("items[0].top_el: below base_el");
    expect(onSaved).not.toHaveBeenCalled();
    expect(screen.getByLabelText(/^top el/i)).toHaveValue(141);
  });

  it("Cancel hands back", () => {
    const { onCancel } = setup();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onCancel).toHaveBeenCalled();
  });
});
```

`frontend/src/site3d/panels/useDiscardGuard.test.tsx` (Review Focus 5; needs a data router):

```tsx
import { useState } from "react";
import { createMemoryRouter, RouterProvider, useNavigate } from "react-router-dom";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { useDiscardGuard } from "./useDiscardGuard";

function Harness({ dirty }: { dirty: boolean }) {
  const { guard, dialog } = useDiscardGuard(dirty, "LNG tank 1");
  const navigate = useNavigate();
  const [picked, setPicked] = useState("none");
  return (
    <>
      <button onClick={() => guard(() => setPicked("pump"))}>Pick another</button>
      <button onClick={() => navigate("/elsewhere")}>Leave</button>
      <output>{picked}</output>
      {dialog}
    </>
  );
}
const mount = (dirty: boolean) =>
  render(
    <RouterProvider
      router={createMemoryRouter([
        { path: "/", element: <Harness dirty={dirty} /> },
        { path: "/elsewhere", element: <p>Elsewhere</p> },
      ])}
    />,
  );

describe("useDiscardGuard", () => {
  it("asks before dropping edits, and keeps them on Keep editing", () => {
    mount(true);
    fireEvent.click(screen.getByRole("button", { name: "Pick another" }));
    expect(screen.getByRole("dialog", { name: "Discard your changes to LNG tank 1?" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Keep editing" }));
    expect(screen.getByText("none")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Pick another" }));
    fireEvent.click(screen.getByRole("button", { name: "Discard changes" }));
    expect(screen.getByText("pump")).toBeInTheDocument();
  });

  it("asks before leaving the screen with unsaved edits", async () => {
    mount(true);
    fireEvent.click(screen.getByRole("button", { name: "Leave" }));
    fireEvent.click(await screen.findByRole("button", { name: "Discard changes" }));
    expect(await screen.findByText("Elsewhere")).toBeInTheDocument();
  });

  it("without edits nothing asks", () => {
    mount(false);
    fireEvent.click(screen.getByRole("button", { name: "Pick another" }));
    expect(screen.getByText("pump")).toBeInTheDocument();
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `pnpm -C frontend exec vitest run src/site3d/panels/itemEdit.test.ts src/site3d/panels/ItemEditor.test.tsx src/site3d/panels/useDiscardGuard.test.tsx` → Expected: FAIL, modules not found.

- [ ] **Step 3: Implement the pure editing module**

`frontend/src/site3d/panels/itemEdit.ts`:

```ts
import type { AssetSpec } from "@contract/client";
import type { AssetItem } from "@/api/plantItems";

export type FieldKind = "number" | "integer" | "boolean" | "enum" | "string" | "json";
export interface FieldSpec {
  key: string;
  label: string;
  unit?: string;
  kind: FieldKind;
  options?: string[];
  min?: number;
  exclusiveMin?: boolean;
  max?: number;
  nullable: boolean;
  defaultValue?: unknown;
  help?: string;
}

interface Schema {
  type?: string;
  enum?: unknown[];
  anyOf?: Schema[];
  $ref?: string;
  minimum?: number;
  exclusiveMinimum?: number;
  maximum?: number;
  default?: unknown;
  description?: string;
  properties?: Record<string, Schema>;
  $defs?: Record<string, Schema>;
}

const sentence = (s: string) => {
  const t = s.replace(/_/g, " ").trim();
  return t.charAt(0).toUpperCase() + t.slice(1);
};

/** pydantic `model_json_schema()` → form fields (Ruling 15). Keys ending `_m` get a metre unit. */
export function fieldsFromSchema(schema: unknown): FieldSpec[] {
  const root = (schema ?? {}) as Schema;
  const defs = root.$defs ?? {};
  const deref = (s: Schema): Schema => (s.$ref ? (defs[s.$ref.split("/").pop() ?? ""] ?? {}) : s);
  return Object.entries(root.properties ?? {}).map(([key, raw]) => {
    let s = deref(raw);
    let nullable = false;
    if (s.anyOf) {
      const parts = s.anyOf.map(deref);
      nullable = parts.some((p) => p.type === "null");
      s = { ...(parts.find((p) => p.type !== "null") ?? {}), default: raw.default ?? s.default, description: raw.description ?? s.description };
    }
    const kind: FieldKind = s.enum
      ? "enum"
      : s.type === "number"
        ? "number"
        : s.type === "integer"
          ? "integer"
          : s.type === "boolean"
            ? "boolean"
            : s.type === "string"
              ? "string"
              : "json";
    const metric = key.endsWith("_m");
    return {
      key,
      label: sentence(metric ? key.slice(0, -2) : key),
      ...(metric ? { unit: "m" } : {}),
      kind,
      ...(s.enum ? { options: s.enum.map(String) } : {}),
      ...(s.exclusiveMinimum !== undefined
        ? { min: s.exclusiveMinimum, exclusiveMin: true }
        : s.minimum !== undefined
          ? { min: s.minimum, exclusiveMin: false }
          : {}),
      ...(s.maximum !== undefined ? { max: s.maximum } : {}),
      nullable,
      defaultValue: raw.default ?? s.default,
      ...(s.description ? { help: s.description } : {}),
    };
  });
}

export type HeightSource = AssetItem["height_source"];
export interface ItemDraft {
  type: string;
  base_el: string;
  top_el: string;
  height_source: HeightSource;
  /** rect: e, n, along, across, rot · circle: e, n, d · line: width · polygon: none. */
  fp: Record<string, string>;
  params: Record<string, string | boolean>;
}

const str = (v: unknown) => (v == null ? "" : typeof v === "object" ? JSON.stringify(v) : String(v));
type Fp = { kind: string; center?: number[]; size?: number[]; rot_deg?: number; d?: number; pts?: number[][]; width?: number };

export function draftOf(item: AssetItem, fields: readonly FieldSpec[]): ItemDraft {
  const fp = item.footprint as unknown as Fp;
  const fpd: Record<string, string> =
    fp.kind === "rect"
      ? { e: str(fp.center![0]), n: str(fp.center![1]), along: str(fp.size![0]), across: str(fp.size![1]), rot: str(fp.rot_deg ?? 0) }
      : fp.kind === "circle"
        ? { e: str(fp.center![0]), n: str(fp.center![1]), d: str(fp.d) }
        : fp.kind === "line"
          ? { width: str(fp.width) }
          : {};
  const params: Record<string, string | boolean> = {};
  for (const f of fields) {
    const v = (item.params as Record<string, unknown>)[f.key];
    params[f.key] = f.kind === "boolean" ? Boolean(v ?? f.defaultValue ?? false) : str(v);
  }
  return { type: item.type, base_el: str(item.base_el), top_el: str(item.top_el), height_source: item.height_source, fp: fpd, params };
}

const num = (s: string): number | null => (s.trim() === "" ? null : Number(s));

export function validateDraft(d: ItemDraft, fields: readonly FieldSpec[], footprintKind: string): Record<string, string> {
  const errors: Record<string, string> = {};
  const base = num(d.base_el);
  const top = num(d.top_el);
  if (base !== null && !Number.isFinite(base)) errors.base_el = "Enter a number.";
  if (top !== null && !Number.isFinite(top)) errors.top_el = "Enter a number.";
  else if (base !== null && top !== null && Number.isFinite(base) && top < base) errors.top_el = "Top EL must be at or above base EL.";
  const positive = footprintKind === "rect" ? ["along", "across"] : footprintKind === "circle" ? ["d"] : footprintKind === "line" ? ["width"] : [];
  for (const [k, v] of Object.entries(d.fp)) {
    const n = num(v);
    if (n === null || !Number.isFinite(n)) errors[`fp.${k}`] = "Enter a number.";
    else if (positive.includes(k) && n <= 0) errors[`fp.${k}`] = "Must be more than 0.";
  }
  for (const f of fields) {
    const v = d.params[f.key];
    const at = `params.${f.key}`;
    if (typeof v === "boolean" || f.kind === "enum" || f.kind === "string") continue;
    if (v.trim() === "") continue; // empty = the builder's default (recorded in the CSV notes)
    if (f.kind === "json") {
      try {
        JSON.parse(v);
      } catch {
        errors[at] = "Enter valid JSON.";
      }
      continue;
    }
    const n = Number(v);
    if (!Number.isFinite(n)) errors[at] = "Enter a number.";
    else if (f.kind === "integer" && !Number.isInteger(n)) errors[at] = "Enter a whole number.";
    else if (f.min !== undefined && (f.exclusiveMin ? n <= f.min : n < f.min))
      errors[at] = f.exclusiveMin ? `Must be more than ${f.min}.` : `Must be ${f.min} or more.`;
    else if (f.max !== undefined && n > f.max) errors[at] = `Must be ${f.max} or less.`;
  }
  return errors;
}

export function applyDraft(item: AssetItem, d: ItemDraft, fields: readonly FieldSpec[]): AssetItem {
  const fp = item.footprint as unknown as Fp;
  const n = (s: string) => Number(s);
  const footprint =
    fp.kind === "rect"
      ? { ...fp, center: [n(d.fp.e), n(d.fp.n)], size: [n(d.fp.along), n(d.fp.across)], rot_deg: n(d.fp.rot) }
      : fp.kind === "circle"
        ? { ...fp, center: [n(d.fp.e), n(d.fp.n)], d: n(d.fp.d) }
        : fp.kind === "line"
          ? { ...fp, width: n(d.fp.width) }
          : fp;
  let params: Record<string, unknown> = {};
  if (d.type === item.type) {
    params = { ...(item.params as Record<string, unknown>) };
    for (const f of fields) {
      const v = d.params[f.key];
      if (typeof v === "boolean") params[f.key] = v;
      else if (v.trim() === "") delete params[f.key];
      else if (f.kind === "number" || f.kind === "integer") params[f.key] = Number(v);
      else if (f.kind === "json") params[f.key] = JSON.parse(v);
      else params[f.key] = v;
    }
  }
  const el = (s: string) => (s.trim() === "" ? null : Number(s));
  return {
    ...item,
    type: d.type,
    base_el: el(d.base_el),
    top_el: el(d.top_el),
    height_source: d.height_source,
    footprint: footprint as AssetItem["footprint"],
    params,
  } as AssetItem;
}

export function sameDraft(a: ItemDraft, b: ItemDraft): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

/** The base spec with `item` replacing the item of the same id (never an add). */
export function withItem(spec: AssetSpec, item: AssetItem): AssetSpec {
  const items = ((spec as unknown as { items?: AssetItem[] }).items ?? []) as AssetItem[];
  const i = items.findIndex((x) => x.id === item.id);
  if (i < 0) throw new Error(`${item.tag ?? item.id} is not in this version.`);
  return { ...spec, items: items.map((x, k) => (k === i ? item : x)) } as AssetSpec;
}

const elText = (v: number | null | undefined) => (v == null ? "none" : `${v}`);

/** "Edited 20-T-0001 from v3: top EL 135 → 140 m" (≤ 5 changes named). */
export function editNote(before: AssetItem, after: AssetItem, base: number): string {
  const changes: string[] = [];
  if (before.type !== after.type) changes.push(`type ${before.type} → ${after.type}`);
  if (before.base_el !== after.base_el) changes.push(`base EL ${elText(before.base_el)} → ${elText(after.base_el)} m`);
  if (before.top_el !== after.top_el) changes.push(`top EL ${elText(before.top_el)} → ${elText(after.top_el)} m`);
  if (before.height_source !== after.height_source) changes.push(`height source ${before.height_source} → ${after.height_source}`);
  if (JSON.stringify(before.footprint) !== JSON.stringify(after.footprint)) changes.push("footprint");
  if (JSON.stringify(before.params) !== JSON.stringify(after.params)) changes.push("params");
  const shown = changes.length > 5 ? [...changes.slice(0, 5), `and ${changes.length - 5} more`] : changes;
  return `Edited ${before.tag ?? before.id} from v${base}: ${shown.join(", ") || "no changes"}`;
}
```

- [ ] **Step 4: Implement the discard guard**

`frontend/src/site3d/panels/useDiscardGuard.tsx`:

```tsx
import { useCallback, useState, type ReactNode } from "react";
import { useBlocker } from "react-router-dom";
import { Button, Dialog } from "@/ui";

/**
 * Spec §11 "unsaved edits prompt before they are dropped": `guard(action)` runs the action at once
 * when nothing is unsaved, else asks first; leaving the route asks too (react-router's blocker, so
 * this needs the app's data router).
 */
export function useDiscardGuard(dirty: boolean, name: string): { guard(action: () => void): void; dialog: ReactNode } {
  const [pending, setPending] = useState<(() => void) | null>(null);
  const blocker = useBlocker(({ currentLocation, nextLocation }) => dirty && currentLocation.pathname !== nextLocation.pathname);
  const guard = useCallback(
    (action: () => void) => {
      if (dirty) setPending(() => action);
      else action();
    },
    [dirty],
  );
  const asking = pending !== null || blocker.state === "blocked";
  const keep = () => {
    setPending(null);
    if (blocker.state === "blocked") blocker.reset();
  };
  const discard = () => {
    const action = pending;
    setPending(null);
    if (blocker.state === "blocked") blocker.proceed();
    else action?.();
  };
  const dialog = (
    <Dialog
      open={asking}
      title={`Discard your changes to ${name}?`}
      onClose={keep}
      footer={
        <>
          <Button variant="ghost" onClick={keep}>
            Keep editing
          </Button>
          <Button variant="danger" onClick={discard}>
            Discard changes
          </Button>
        </>
      }
    >
      <p className="text-sm text-muted">Your edits are not saved as a version yet.</p>
    </Dialog>
  );
  return { guard, dialog };
}
```

- [ ] **Step 5: Implement the editor**

`frontend/src/site3d/panels/ItemEditor.tsx`:

```tsx
import { useEffect, useId, useMemo, useRef, useState } from "react";
import { createVersion, getVersion } from "@/api/assetModels";
import { useApi } from "@/api/client";
import { messageOf } from "@/api/errors";
import type { AssetItem, CatalogueEntry } from "@/api/plantItems";
import { useJobsStore } from "@/store/jobs";
import { Alert, Button, Disclosure, Field, Input, Select, Switch, Textarea, toast } from "@/ui";
import { applyDraft, draftOf, editNote, fieldsFromSchema, sameDraft, validateDraft, withItem, type FieldSpec, type ItemDraft } from "./itemEdit";

export interface ItemEditorProps {
  projectId: string;
  modelId: string;
  /** The version the edit starts from (spec §11: the editor shows the base version). */
  baseVersion: number;
  item: AssetItem;
  catalogue: readonly CatalogueEntry[];
  onSaved(version: number, jobId: string): void;
  onCancel(): void;
  onDirty(dirty: boolean): void;
}

const HEIGHT_SOURCES = [
  { value: "drawing", label: "From the drawing" },
  { value: "cloud", label: "From the scan" },
  { value: "indicative", label: "Indicative" },
] as const;
const FP_LABELS: Record<string, string> = { e: "Centre E", n: "Centre N", along: "Length along", across: "Width across", rot: "Rotation", d: "Diameter", width: "Width" };
const FP_UNITS: Record<string, string> = { rot: "°" };

function NumberInput({ id, label, unit, value, error, onChange }: { id: string; label: string; unit?: string; value: string; error?: string; onChange(v: string): void }) {
  return (
    <Field htmlFor={id} label={<>{label}{unit && <span className="text-dim">{` ${unit}`}</span>}</>} error={error}>
      <Input id={id} type="number" step="any" dense invalid={!!error} value={value} onChange={(e) => onChange(e.target.value)} />
    </Field>
  );
}

function ParamInput({ f, value, error, onChange, idBase }: { f: FieldSpec; value: string | boolean; error?: string; onChange(v: string | boolean): void; idBase: string }) {
  const id = `${idBase}-${f.key}`;
  if (f.kind === "boolean") return <Switch checked={value === true} onChange={onChange} label={f.label} />;
  if (f.kind === "enum")
    return (
      <Field htmlFor={id} label={f.label}>
        <Select id={id} dense value={String(value)} onChange={(e) => onChange(e.target.value)}>
          {f.nullable && <option value="">Default</option>}
          {(f.options ?? []).map((o) => (
            <option key={o} value={o}>{o}</option>
          ))}
        </Select>
      </Field>
    );
  if (f.kind === "json")
    return (
      <Field htmlFor={id} label={f.label} hint="JSON" error={error}>
        <Textarea id={id} rows={2} invalid={!!error} value={String(value)} onChange={(e) => onChange(e.target.value)} className="font-mono text-xs" />
      </Field>
    );
  if (f.kind === "string")
    return (
      <Field htmlFor={id} label={f.label}>
        <Input id={id} dense value={String(value)} onChange={(e) => onChange(e.target.value)} />
      </Field>
    );
  return (
    <Field htmlFor={id} label={<>{f.label}{f.unit && <span className="text-dim">{` ${f.unit}`}</span>}</>} error={error} hint={f.defaultValue != null ? `Default ${String(f.defaultValue)}` : undefined}>
      <Input id={id} type="number" step={f.kind === "integer" ? 1 : "any"} dense invalid={!!error} value={String(value)} onChange={(e) => onChange(e.target.value)} />
    </Field>
  );
}

/** Spec §11 Edit: type, footprint numbers, heights and params; saves a manual version from the base. */
export function ItemEditor(p: ItemEditorProps) {
  const api = useApi();
  const ids = useId();
  const fieldsFor = (type: string) => fieldsFromSchema(p.catalogue.find((c) => c.type === type)?.params_schema);
  const initial = useMemo(() => draftOf(p.item, fieldsFromSchema(p.catalogue.find((c) => c.type === p.item.type)?.params_schema)), [p.item, p.catalogue]);
  const [draft, setDraft] = useState<ItemDraft>(initial);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fields = fieldsFor(draft.type);
  const kind = (p.item.footprint as unknown as { kind: string }).kind;
  const errors = validateDraft(draft, fields, kind);
  const dirty = !sameDraft(draft, initial);
  const typeChanged = draft.type !== p.item.type;
  const onDirty = useRef(p.onDirty);
  useEffect(() => {
    onDirty.current = p.onDirty;
  });
  useEffect(() => {
    onDirty.current(dirty);
  }, [dirty]);

  const set = (patch: Partial<ItemDraft>) => setDraft((d) => ({ ...d, ...patch }));
  const setType = (type: string) => {
    const blank = draftOf({ ...p.item, type, params: {} } as AssetItem, fieldsFor(type));
    setDraft((d) => ({ ...d, type, params: type === p.item.type ? initial.params : blank.params }));
  };

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      const base = await getVersion(api, p.projectId, p.modelId, p.baseVersion);
      const next = applyDraft(p.item, draft, fields);
      const { version, job } = await createVersion(api, p.projectId, p.modelId, withItem(base.spec, next), editNote(p.item, next, p.baseVersion));
      useJobsStore.getState().upsert(job);
      toast("ok", `Saved version ${version.version}`);
      p.onSaved(version.version, job.id);
    } catch (e) {
      setError(messageOf(e, "The edit could not be saved."));
    } finally {
      setSaving(false);
    }
  };

  return (
    <form
      aria-label={`Edit ${p.item.name}`}
      className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto"
      onSubmit={(e) => {
        e.preventDefault();
        void save();
      }}
    >
      <header className="flex flex-col gap-0.5">
        <h2 className="text-lg font-semibold text-ink">{`Edit ${p.item.tag ?? p.item.name}`}</h2>
        <p className="text-xs text-muted">
          Editing from version <span className="font-mono tabular-nums text-ink">{p.baseVersion}</span>. Saving adds a new version; this one stays.
        </p>
      </header>
      <Field htmlFor={`${ids}-type`} label="Type">
        <Select id={`${ids}-type`} dense value={draft.type} onChange={(e) => setType(e.target.value)}>
          {p.catalogue.map((c) => (
            <option key={c.type} value={c.type}>{c.type.replace(/_/g, " ")}</option>
          ))}
        </Select>
      </Field>
      {typeChanged && <p className="text-2xs text-warn">The params start from the new type's defaults; the old ones are dropped.</p>}
      <div className="grid grid-cols-2 gap-2">
        <NumberInput id={`${ids}-base`} label="Base EL" unit="m" value={draft.base_el} error={errors.base_el} onChange={(v) => set({ base_el: v })} />
        <NumberInput id={`${ids}-top`} label="Top EL" unit="m" value={draft.top_el} error={errors.top_el} onChange={(v) => set({ top_el: v })} />
      </div>
      <Field htmlFor={`${ids}-hs`} label="Height source">
        <Select id={`${ids}-hs`} dense value={draft.height_source} onChange={(e) => set({ height_source: e.target.value as ItemDraft["height_source"] })}>
          {HEIGHT_SOURCES.map((h) => (
            <option key={h.value} value={h.value}>{h.label}</option>
          ))}
        </Select>
      </Field>
      <section aria-label="Footprint" className="flex flex-col gap-2">
        <h3 className="text-xs font-medium text-muted">Footprint</h3>
        {Object.keys(draft.fp).length === 0 && (
          <p className="text-xs text-muted">
            {`${((p.item.footprint as unknown as { pts?: unknown[] }).pts ?? []).length} points. The outline is edited in a later release.`}
          </p>
        )}
        <div className="grid grid-cols-2 gap-2">
          {Object.entries(draft.fp).map(([k, v]) => (
            <NumberInput
              key={k}
              id={`${ids}-fp-${k}`}
              label={FP_LABELS[k] ?? k}
              unit={FP_UNITS[k] ?? "m"}
              value={v}
              error={errors[`fp.${k}`]}
              onChange={(nv) => set({ fp: { ...draft.fp, [k]: nv } })}
            />
          ))}
        </div>
      </section>
      {fields.length > 0 && (
        <Disclosure label="Parameters" defaultOpen>
          <div className="flex flex-col gap-2">
            {fields.map((f) => (
              <ParamInput
                key={f.key}
                f={f}
                idBase={`${ids}-p`}
                value={draft.params[f.key] ?? ""}
                error={errors[`params.${f.key}`]}
                onChange={(v) => set({ params: { ...draft.params, [f.key]: v } })}
              />
            ))}
          </div>
        </Disclosure>
      )}
      {error && <Alert tone="danger" title="The edit could not be saved.">{error}</Alert>}
      <div className="mt-auto flex justify-end gap-2 pt-1">
        <Button type="button" variant="ghost" onClick={p.onCancel}>
          Cancel
        </Button>
        <Button type="submit" variant="primary" disabled={!dirty || Object.keys(errors).length > 0 || saving}>
          {saving ? "Saving…" : "Save as new version"}
        </Button>
      </div>
    </form>
  );
}
```

If `Field`'s `error` prop does not render the text (check `ui/Field.tsx`), render `{error && <p className="text-2xs text-danger">{error}</p>}` under the input instead; the test asserts the text is on screen.

- [ ] **Step 6: Run the tests and the token check**

Run: the Step 2 command → Expected: itemEdit 10 passed, ItemEditor 7 passed, useDiscardGuard 3 passed. `node frontend/scripts/check-tokens.mjs frontend/src` → no violations.

- [ ] **Step 7: Commit**

```bash
git add frontend/src/site3d/panels/itemEdit.ts frontend/src/site3d/panels/itemEdit.test.ts frontend/src/site3d/panels/ItemEditor.tsx frontend/src/site3d/panels/ItemEditor.test.tsx frontend/src/site3d/panels/useDiscardGuard.tsx frontend/src/site3d/panels/useDiscardGuard.test.tsx
git commit -m "feat(site3d): item editor from the builder schema, saving a manual version from its base

Unsaved edits ask before they are dropped (selection change or leaving the screen).

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task S3-8: Run bar (stage, packages, tokens, Stop)

**Files:**
- Create: `frontend/src/site3d/panels/RunBar.tsx`
- Test: `frontend/src/site3d/panels/RunBar.test.tsx`

**Interfaces:**
- Consumes: `useLiveRun`, `RUN_POLL_MS` (`@/assetmodels/run/useLiveRun`); `tokensText` (`@/assetmodels/run/runText`); `listRunPackages`, `SiteModelPackage` (Task 2); `useApi`, `messageOf`; `GlassPanel`, `Pill`, `Progress`, `Button`, `Disclosure`, `toast` (`@/ui`).
- Produces: `RunBar({projectId, model}): JSX.Element | null`, `stageLabel(stage)`, `currentStage(run)`, `costText(run)`, `packageSummary(run, items)`, `packagesText(s)`.

Plant run fields (coordinator, 2026-10-03, from F0/R1): `run.usage_by_stage = { current: "survey" | "trace" | "merge" | "cloud_check" | "review" | "environment" | "build" | "finish", stages: { [stage]: { input_tokens, output_tokens, images, calls } }, cost_estimate_usd: number | null, cost_label: string }`; `run.packages = { total, done, failed, running }`; `listAssetModelRunPackages` rows carry `n, label, area, state, usage, item_count, summary`. The bar's stage is `usage_by_stage.current`, falling back to M1's `phase`; the cost shows as `cost_label` with the estimate (spec §8.4: "labelled an estimate").

- [ ] **Step 1: Write the failing test**

`frontend/src/site3d/panels/RunBar.test.tsx`:

```tsx
import { fireEvent, screen, waitFor } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { renderWithProviders } from "@/test/render";
import { fakeClient } from "@/test/fixtures";
import { RUN } from "@/test/assetModelFixtures";
import { PACKAGES, plantModel } from "@/test/plantFixtures";
import { RunBar, costText, currentStage, packagesText, stageLabel } from "./RunBar";

const running = {
  ...RUN,
  id: "r1",
  mode: "plant",
  state: "running",
  phase: "reading",
  usage: { input_tokens: 1_400_000, output_tokens: 100_000 },
  packages: { total: 3, done: 1, failed: 0, running: 1 },
  usage_by_stage: {
    current: "trace",
    stages: {
      survey: { input_tokens: 300_000, output_tokens: 20_000, images: 12, calls: 30 },
      trace: { input_tokens: 1_100_000, output_tokens: 80_000, images: 40, calls: 90 },
    },
    cost_estimate_usd: 7.25,
    cost_label: "Estimated cost",
  },
};
function setup(model = plantModel({ live_run_id: "r1" })) {
  const client = fakeClient([
    { method: "GET", path: /\/asset-models\/m1\/runs\/r1$/, body: running },
    { method: "GET", path: /\/asset-models\/m1\/runs\/r1\/packages$/, body: { items: PACKAGES } },
    { method: "POST", path: /\/asset-models\/m1\/runs\/r1\/stop$/, status: 202, body: { ...running, state: "stopped", stop_reason: "user" } },
  ] as never);
  renderWithProviders(<RunBar projectId="p" model={model} />, { api: client.api });
  return client;
}

describe("RunBar", () => {
  it("shows the stage, the package count, the tokens, the cost estimate and the packages", async () => {
    setup();
    const bar = await screen.findByRole("region", { name: "Run" });
    expect(bar).toHaveTextContent("Tracing packages");
    expect(bar).toHaveTextContent("1 of 3 packages · 1 running");
    expect(bar).toHaveTextContent("1.5 M tokens");
    expect(bar).toHaveTextContent("Estimated cost $7.25");
    fireEvent.click(screen.getByRole("button", { name: /packages/i }));
    expect(await screen.findByText("Tank row north")).toBeInTheDocument();
  });

  it("Stop stops the run and the bar goes", async () => {
    const { requests } = setup();
    fireEvent.click(await screen.findByRole("button", { name: "Stop" }));
    await waitFor(() => expect(requests.some((r) => r.method === "POST" && r.url.endsWith("/runs/r1/stop"))).toBe(true));
    await waitFor(() => expect(screen.queryByRole("region", { name: "Run" })).toBeNull());
  });

  it("no live run, no bar", () => {
    setup(plantModel({ live_run_id: null }));
    expect(screen.queryByRole("region", { name: "Run" })).toBeNull();
  });

  it("names every stage in plain words, unknown ones by their name", () => {
    expect(stageLabel("survey")).toBe("Reading the drawings");
    expect(stageLabel("cloud_check")).toBe("Checking against the scan");
    expect(stageLabel("review")).toBe("Reviewing the scan check");
    expect(stageLabel("finish")).toBe("Finishing");
    expect(stageLabel("something_new")).toBe("Something new");
    expect(packagesText({ total: 4, done: 2, failed: 1, running: 0 })).toBe("2 of 4 packages · 1 failed");
  });

  it("the stage comes from usage_by_stage, else M1's phase; no estimate, no cost", () => {
    expect(currentStage(running as never)).toBe("trace");
    expect(currentStage({ ...RUN, phase: "building" })).toBe("building");
    expect(costText(running as never)).toBe("Estimated cost $7.25");
    expect(costText({ ...running, usage_by_stage: { ...running.usage_by_stage, cost_estimate_usd: null } } as never)).toBeNull();
    expect(costText(RUN)).toBeNull();
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm -C frontend exec vitest run src/site3d/panels/RunBar.test.tsx` → Expected: FAIL, module not found.

- [ ] **Step 3: Implement**

`frontend/src/site3d/panels/RunBar.tsx`:

```tsx
import { useEffect, useState } from "react";
import type { AssetModel, AssetModelRun } from "@contract/client";
import { useApi } from "@/api/client";
import { messageOf } from "@/api/errors";
import { listRunPackages, type SiteModelPackage } from "@/api/plantItems";
import { tokensText } from "@/assetmodels/run/runText";
import { RUN_POLL_MS, useLiveRun } from "@/assetmodels/run/useLiveRun";
import { Button, Disclosure, GlassPanel, Pill, Progress, toast, type PillTone } from "@/ui";

/** Plain words for the plant run's stages (spec §8.2, `usage_by_stage.current`) and M1's phases; unknown ones by their name. */
const STAGES: Record<string, string> = {
  survey: "Reading the drawings",
  trace: "Tracing packages",
  merge: "Merging items",
  cloud_check: "Checking against the scan",
  review: "Reviewing the scan check",
  environment: "Tracing land and sea",
  build: "Building the model",
  finish: "Finishing",
  building: "Building the model",
  checking: "Checking the model",
  sampling: "Sampling the scan",
  reading: "Reading sources",
  done: "Done",
};
export function stageLabel(stage: string): string {
  if (STAGES[stage]) return STAGES[stage];
  const t = stage.replace(/_/g, " ");
  return t.charAt(0).toUpperCase() + t.slice(1);
}

/** F0/R1's per-stage usage (coordinator 2026-10-03); absent on M1 runs. */
interface UsageByStage {
  current?: string | null;
  stages?: Record<string, { input_tokens: number; output_tokens: number; images: number; calls: number }>;
  cost_estimate_usd?: number | null;
  cost_label?: string | null;
}
const usageOf = (run: AssetModelRun) => (run as { usage_by_stage?: UsageByStage | null }).usage_by_stage ?? null;

/** The plant run's current stage, else M1's phase. */
export function currentStage(run: AssetModelRun): string {
  return usageOf(run)?.current || run.phase;
}

/** "Estimated cost $7.25" (spec §8.4: an estimate, labelled so), or null without one. */
export function costText(run: AssetModelRun): string | null {
  const u = usageOf(run);
  if (u?.cost_estimate_usd == null) return null;
  return `${u.cost_label || "Estimated cost"} $${u.cost_estimate_usd.toFixed(2)}`;
}

export interface PackageSummary {
  total: number;
  done: number;
  failed: number;
  running: number;
}
/** The run's own summary (F0 `AssetModelRun.packages`) when present, else counted from the list. */
export function packageSummary(run: AssetModelRun, items: readonly SiteModelPackage[]): PackageSummary | null {
  const own = (run as { packages?: PackageSummary | null }).packages;
  if (own) return own;
  if (items.length === 0) return null;
  const n = (s: string) => items.filter((k) => k.state === s).length;
  return { total: items.length, done: n("done"), failed: n("failed"), running: n("running") };
}
export function packagesText(s: PackageSummary): string {
  return [`${s.done} of ${s.total} packages`, s.running ? `${s.running} running` : null, s.failed ? `${s.failed} failed` : null]
    .filter(Boolean)
    .join(" · ");
}
const STATE_TONE: Record<string, PillTone> = { done: "ok", running: "accent", failed: "danger", queued: "neutral", skipped: "neutral" };

/** Spec §11 Run (bottom, while a run is live): stage, package table, tokens, Stop. */
export function RunBar({ projectId, model }: { projectId: string; model: AssetModel }) {
  const api = useApi();
  const live = useLiveRun(projectId, model.id, model.live_run_id);
  const run = live.run;
  const runId = run?.id ?? null;
  const isRunning = run?.state === "running";
  const [pk, setPk] = useState<{ runId: string; items: SiteModelPackage[] } | null>(null);
  useEffect(() => {
    if (!runId || !isRunning) return;
    let alive = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const tick = () =>
      listRunPackages(api, projectId, model.id, runId).then(
        (items) => {
          if (!alive) return;
          setPk({ runId, items });
          timer = setTimeout(tick, RUN_POLL_MS);
        },
        () => {
          if (alive) timer = setTimeout(tick, RUN_POLL_MS * 2);
        },
      );
    void tick();
    return () => {
      alive = false;
      if (timer) clearTimeout(timer);
    };
  }, [api, projectId, model.id, runId, isRunning]);

  if (!run || !isRunning) return null;
  const items = pk?.runId === run.id ? pk.items : [];
  const summary = packageSummary(run, items);
  const share = summary && summary.total > 0 ? (summary.done + summary.failed) / summary.total : undefined;
  return (
    <GlassPanel
      as="section"
      variant="float"
      radius="panel"
      aria-label="Run"
      className="pointer-events-auto flex w-full max-w-3xl flex-col gap-2 p-3 animate-reveal reduce-motion:animate-none"
    >
      <div className="flex flex-wrap items-center gap-3">
        <Pill tone="accent" live>
          Running
        </Pill>
        <span className="text-sm font-semibold text-ink">{stageLabel(currentStage(run))}</span>
        {summary && <span className="font-mono text-xs tabular-nums text-muted">{packagesText(summary)}</span>}
        <span className="font-mono text-xs tabular-nums text-muted">{tokensText(run.usage)}</span>
        {costText(run) && <span className="font-mono text-xs tabular-nums text-muted">{costText(run)}</span>}
        <Button
          size="sm"
          variant="secondary"
          icon="x"
          className="ml-auto"
          disabled={live.stopping}
          onClick={() => live.stop().catch((e: unknown) => toast("danger", messageOf(e, "The run could not be stopped.")))}
        >
          {live.stopping ? "Stopping…" : "Stop"}
        </Button>
      </div>
      <Progress thin running value={share} label="Run progress" />
      {items.length > 0 && (
        <Disclosure label="Packages" summary={String(items.length)}>
          <ul aria-label="Packages" className="flex max-h-48 flex-col overflow-y-auto">
            {items.map((k) => (
              <li key={k.id} className="flex items-center gap-2 py-1 text-xs">
                <span className="w-6 shrink-0 text-right font-mono tabular-nums text-dim">{k.n}</span>
                <span className="min-w-0 flex-1 truncate text-ink">{k.label}</span>
                {k.area && <span className="shrink-0 text-dim">{k.area}</span>}
                <Pill size="sm" tone={STATE_TONE[k.state] ?? "neutral"}>
                  {k.state}
                </Pill>
                <span className="w-12 shrink-0 text-right font-mono tabular-nums text-muted">{k.item_count}</span>
              </li>
            ))}
          </ul>
        </Disclosure>
      )}
    </GlassPanel>
  );
}
```

- [ ] **Step 4: Run the test and the token check**

Run: the Step 2 command → Expected: 5 passed. `node frontend/scripts/check-tokens.mjs frontend/src` → no violations.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/site3d/panels/RunBar.tsx frontend/src/site3d/panels/RunBar.test.tsx
git commit -m "feat(site3d): run bar with stage, packages, tokens and Stop

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task S3-9: Compose the panels into the Site 3D screen (WAITING: S2)

**Precondition:** S2 is merged on `main`. Run `git merge main` in the worktree first (resolve `frontend/src/site3d/SiteScreen.tsx` by keeping S2's hook calls). If S2 is not on `main` yet, log `WAITING: S2` and run Task 10 meanwhile.

**Files:**
- Create: `frontend/src/site3d/panels/SitePanels.tsx`, `frontend/src/site3d/panels/useCatalogue.ts`
- Modify: `frontend/src/site3d/SiteScreen.tsx` (S1's placeholders → `<SitePanels>`; S2's `<ExtraLayerStatus>` removed), `frontend/e2e/site3d-env.spec.ts` (S2's; locator only)
- Test: `frontend/src/site3d/panels/SitePanels.test.tsx`

**Interfaces:**
- Consumes: Tasks 1–8; S2's `ExtraLayers` (`useSiteExtraLayers`), `SiteScene` (`site3d/layers/sceneTypes.ts`); S1's `SiteLayer`, `SiteFrameT`, `siteToScene`, `plantToScene`; `useAssetModelList`; `useJobsStore`, `isActiveJob`; `assetModelGlbUrl` (`@contract/client`); `readSiteAt`, `modelDetailsHref` (Task 10's `entry/links.ts`, created here if Task 10 has not run: same content).
- Produces: `SitePanels(props: SitePanelsProps)`, `rowBox(frame, row)`, `useCatalogue()`.

```ts
export interface SitePanelsProps {
  projectId: string;
  scene: SiteScene;
  frame: SiteFrameT | null;
  /** null until S1's engine runs (no WebGL: the panels still list the register). */
  controls: SiteControls | null;
  s1Layers: readonly SiteLayer[];
  extra: ExtraLayers;
}
```

- [ ] **Step 1: Write the failing test** (Review Focus 5)

`frontend/src/site3d/panels/SitePanels.test.tsx`:

```tsx
import * as THREE from "three";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { createMemoryRouter, RouterProvider } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ApiClient } from "@contract/client";
import { TestApiProvider } from "@/test/render";
import { fakeClient } from "@/test/fixtures";
import { VERSION_2 } from "@/test/assetModelFixtures";
import { fakeSiteControls } from "@/test/fakeSiteControls";
import { CATALOGUE, ITEM, PUMP, itemRow, plantModel, plantSpec } from "@/test/plantFixtures";
import { FRAME, sceneWith } from "@/test/siteSceneFixtures";
import { useJobsStore } from "@/store/jobs";
import type { ExtraLayers } from "@/site3d/layers/useSiteExtraLayers";
import type { SiteLayer } from "@/site3d/layers/types";
import { SitePanels } from "./SitePanels";

const JOB = { id: "j1", project_id: "p", type: "asset_model_glb", state: "queued", progress: 0, message: "", log_path: "", params: {}, result: null, error: null, created_at: "2026-10-03T09:00:00Z", started_at: null, finished_at: null };
const scene = sceneWith({ model: { id: "m1", version: 3, glb_url: "/g/3.glb", csv_url: "/g/3.csv", kind: "plant" } as never });
const extra = (): ExtraLayers => ({
  rows: [],
  setVisible: vi.fn(),
  cloudColour: "rgb",
  setCloudColour: vi.fn(),
  budget: 3_000_000,
  setBudget: vi.fn(),
  photos: null,
  findings: null,
});
const modelLayer = { id: "model", label: "Plant model", attach() {}, detach() {}, setVisible: vi.fn(), setOpacity: vi.fn() } as unknown as SiteLayer;

function routes(extraRoutes: unknown[] = []) {
  return [
    ...extraRoutes,
    { method: "GET", path: /\/asset-models$/, body: { items: [plantModel()] } },
    { method: "GET", path: /\/versions\/3\/items$/, body: { items: [itemRow(), itemRow({ id: PUMP.id, node: PUMP.id, tag: PUMP.tag, name: PUMP.name })], next_cursor: null } },
    { method: "GET", path: /\/versions\/3\/items\/20-T-0001$/, body: ITEM },
    { method: "GET", path: /\/versions\/3\/items\/30-P-0001$/, body: PUMP },
    { method: "GET", path: /^\/api\/v1\/asset-models\/catalogue$/, body: { items: CATALOGUE } },
    { method: "GET", path: /\/asset-models\/m1\/versions\/3$/, body: { ...VERSION_2, version: 3, spec: plantSpec(), warnings: [] } },
    { method: "POST", path: /\/asset-models\/m1\/versions$/, status: 201, body: { version: { ...VERSION_2, version: 4 }, job: JOB } },
  ];
}
function mount(o: { controls?: ReturnType<typeof fakeSiteControls>; url?: string; routes?: unknown[] } = {}) {
  const c = o.controls ?? fakeSiteControls();
  const client = fakeClient(routes(o.routes) as never, { signalSafe: true });
  const x = extra();
  const ui = (
    <TestApiProvider api={client.api as ApiClient}>
      <RouterProvider
        router={createMemoryRouter(
          [
            { path: "/p/:projectId/site/:modelId", element: <SitePanels projectId="p" scene={scene} frame={FRAME} controls={c.controls} s1Layers={[modelLayer]} extra={x} /> },
            { path: "/elsewhere", element: <p>Elsewhere</p> },
          ],
          { initialEntries: [o.url ?? "/p/p/site/m1"] },
        )}
      />
    </TestApiProvider>
  );
  render(ui);
  return { ...client, c, x };
}
const openTank = async () => fireEvent.click(await screen.findByRole("button", { name: /20-T-0001/ }));

describe("SitePanels", () => {
  beforeEach(() => useJobsStore.setState({ jobs: {} }));

  it("a register row flies to its item, selects it and opens it", async () => {
    const box = new THREE.Box3(new THREE.Vector3(1, 2, 3), new THREE.Vector3(4, 5, 6));
    const controls = fakeSiteControls({ boxOf: vi.fn(() => box) });
    mount({ controls });
    await openTank();
    expect(controls.raw.flyTo).toHaveBeenCalledWith(box);
    expect(controls.raw.select).toHaveBeenCalledWith("20-T-0001");
    expect(await screen.findByRole("heading", { name: "LNG tank 1" })).toBeInTheDocument();
  });

  it("a click on an item in 3D opens it", async () => {
    const { c } = mount();
    await screen.findByRole("button", { name: /20-T-0001/ });
    act(() => c.emitSelect("30-P-0001"));
    expect(await screen.findByRole("heading", { name: "Send-out pump 1" })).toBeInTheDocument();
  });

  it("edit → new version → the GLB swaps in, keeping the camera", async () => {
    const { c } = mount();
    await openTank();
    fireEvent.click(await screen.findByRole("button", { name: "Edit" }));
    fireEvent.change(screen.getByLabelText(/^top el/i), { target: { value: "140" } });
    fireEvent.click(screen.getByRole("button", { name: "Save as new version" }));
    expect(await screen.findByText(/building version 4/i)).toBeInTheDocument();
    act(() => useJobsStore.getState().upsert({ ...JOB, state: "succeeded", progress: 1 } as never));
    await waitFor(() => expect(c.raw.loadModel).toHaveBeenCalledWith(expect.stringContaining("/versions/4/glb")));
    expect(await screen.findByText("Version 4")).toBeInTheDocument();
  });

  it("a failed swap keeps the old model, labelled stale, and says why", async () => {
    const controls = fakeSiteControls({ loadModel: vi.fn(async () => { throw new Error("GLB parse failed"); }) });
    mount({ controls });
    await openTank();
    fireEvent.click(await screen.findByRole("button", { name: "Edit" }));
    fireEvent.change(screen.getByLabelText(/^top el/i), { target: { value: "140" } });
    fireEvent.click(screen.getByRole("button", { name: "Save as new version" }));
    await screen.findByText(/building version 4/i);
    act(() => useJobsStore.getState().upsert({ ...JOB, state: "succeeded", progress: 1 } as never));
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("Version 4's 3D model could not load.");
    expect(alert).toHaveTextContent("Stale");
    expect(alert).toHaveTextContent("You are seeing version 3.");
    expect(screen.getByText("Version 3")).toBeInTheDocument();
  });

  it("unsaved edits ask before another item opens", async () => {
    const { c } = mount();
    await openTank();
    fireEvent.click(await screen.findByRole("button", { name: "Edit" }));
    fireEvent.change(screen.getByLabelText(/^top el/i), { target: { value: "140" } });
    act(() => c.emitSelect("30-P-0001"));
    expect(await screen.findByRole("dialog", { name: /discard your changes/i })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Keep editing" }));
    expect(screen.getByLabelText(/^top el/i)).toHaveValue(140);
  });

  it("an ?at= arrival in the site's CRS flies there once; another CRS is ignored", async () => {
    const a = fakeSiteControls();
    mount({ controls: a, url: `/p/p/site/m1?at=${FRAME.origin_crs[0]},${FRAME.origin_crs[1]}&epsg=32639` });
    await waitFor(() => expect(a.raw.flyTo).toHaveBeenCalledTimes(1));
    const centre = (a.raw.flyTo.mock.calls[0][0] as THREE.Box3).getCenter(new THREE.Vector3());
    expect(centre.x).toBeCloseTo(0, 6);
    expect(centre.z).toBeCloseTo(0, 6);
  });

  it("an ?at= arrival in another CRS opens framed (no fly)", async () => {
    const b = fakeSiteControls();
    mount({ controls: b, url: "/p/p/site/m1?at=500000,4000000&epsg=32633" });
    await screen.findByRole("button", { name: /20-T-0001/ });
    expect(b.raw.flyTo).not.toHaveBeenCalled();
  });

  it("the layer switches reach S1's layers and S2's rows", async () => {
    const { x } = mount();
    fireEvent.click(await screen.findByRole("switch", { name: "Plant model" }));
    expect(modelLayer.setVisible).toHaveBeenCalledWith(false);
    expect(x.setVisible).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm -C frontend exec vitest run src/site3d/panels/SitePanels.test.tsx` → Expected: FAIL, module not found.

- [ ] **Step 3: Implement the catalogue hook**

`frontend/src/site3d/panels/useCatalogue.ts`:

```ts
import { useEffect, useState } from "react";
import { useApi } from "@/api/client";
import { getCatalogue, type CatalogueEntry } from "@/api/plantItems";

/** The builder catalogue, read once per screen; [] until it arrives or when it fails (the editor then offers the item's own type only). */
export function useCatalogue(): readonly CatalogueEntry[] {
  const api = useApi();
  const [entries, setEntries] = useState<readonly CatalogueEntry[]>([]);
  useEffect(() => {
    let alive = true;
    getCatalogue(api).then(
      (e) => alive && setEntries(e),
      () => {},
    );
    return () => {
      alive = false;
    };
  }, [api]);
  return entries;
}
```

- [ ] **Step 4: Implement the composition**

`frontend/src/site3d/panels/SitePanels.tsx`:

```tsx
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useLocation } from "react-router-dom";
import * as THREE from "three";
import { assetModelGlbUrl } from "@contract/client";
import { useBackend } from "@/api/client";
import { messageOf } from "@/api/errors";
import type { AssetItem, AssetItemRow } from "@/api/plantItems";
import { useAssetModelList } from "@/assetmodels/useAssetModels";
import { plantToScene, siteToScene, type SiteFrameT } from "@/site3d/engine/siteTransform";
import { modelDetailsHref, readSiteAt } from "@/site3d/entry/links";
import type { SiteScene } from "@/site3d/layers/sceneTypes";
import type { SiteLayer } from "@/site3d/layers/types";
import type { ExtraLayers } from "@/site3d/layers/useSiteExtraLayers";
import { isActiveJob, useJobsStore } from "@/store/jobs";
import { Alert, Button, Pill, Progress } from "@/ui";
import type { ColourBy, SiteControls } from "./engineBridge";
import { ItemEditor } from "./ItemEditor";
import { ItemPanel } from "./ItemPanel";
import { extraRows, s1Rows, type LayerUi } from "./layerRows";
import { LayersPanel } from "./LayersPanel";
import { RegisterPanel } from "./RegisterPanel";
import { RunBar } from "./RunBar";
import { useCatalogue } from "./useCatalogue";
import { useDiscardGuard } from "./useDiscardGuard";

export interface SitePanelsProps {
  projectId: string;
  scene: SiteScene;
  frame: SiteFrameT | null;
  controls: SiteControls | null;
  s1Layers: readonly SiteLayer[];
  extra: ExtraLayers;
}

/** A row's fly-to box when the model layer has no node box: 30 m around the footprint point, base to top. */
export function rowBox(frame: SiteFrameT, row: AssetItemRow): THREE.Box3 | null {
  if (row.plant_e == null || row.plant_n == null) return null;
  const base = row.base_el ?? frame.datum.el_m;
  const top = row.top_el ?? base + 10;
  const [x, y0, z] = plantToScene(frame, row.plant_e, row.plant_n, base);
  const y1 = y0 + Math.max(2, top - base);
  return new THREE.Box3(new THREE.Vector3(x - 15, y0, z - 15), new THREE.Vector3(x + 15, y1, z + 15));
}

/** A selected 3D node is its item (A1 names item nodes by item id; Task 1 ruling). */
const nodeToItemId = (node: string) => node;

type Swap = { kind: "building"; version: number; jobId: string } | { kind: "failed"; version: number; message: string } | null;

/** Spec §11 panels over S1's view: Layers (top left), Register / Item / Edit (right), Run (bottom). */
export function SitePanels(p: SitePanelsProps) {
  const { baseUrl, token } = useBackend();
  const location = useLocation();
  const catalogue = useCatalogue();
  const { models } = useAssetModelList(p.projectId);
  const sceneModel = p.scene.model;
  const model = sceneModel ? (models?.find((m) => m.id === sceneModel.id) ?? null) : null;

  // ---- layers
  const [ui, setUi] = useState<LayerUi>({ visible: {}, opacity: {} });
  const [colourBy, setColourBy] = useState<ColourBy>("material");
  const rows = [...s1Rows(p.s1Layers, ui), ...extraRows(p.extra.rows)];
  const s1 = useMemo(() => new Map(p.s1Layers.map((l) => [l.id, l])), [p.s1Layers]);
  const onVisible = (id: string, v: boolean) => {
    const l = s1.get(id);
    if (l) {
      l.setVisible(v);
      setUi((u) => ({ ...u, visible: { ...u.visible, [id]: v } }));
    } else p.extra.setVisible(id, v);
  };
  const onOpacity = (id: string, o: number) => {
    const l = s1.get(id);
    if (!l?.setOpacity) return;
    l.setOpacity(o);
    if (id === "model") p.controls?.setModelOpacity(o);
    setUi((u) => ({ ...u, opacity: { ...u.opacity, [id]: o } }));
  };
  const placeableCloud = p.extra.rows.some((r) => r.group === "Point clouds" && r.layer.status.get().kind !== "unavailable");

  // ---- version shown and the GLB swap
  const [shown, setShown] = useState<number | null>(sceneModel?.version ?? null);
  const [swap, setSwap] = useState<Swap>(null);
  const job = useJobsStore((s) => (swap?.kind === "building" ? (s.jobs[swap.jobId] ?? null) : null));
  useEffect(() => {
    if (swap?.kind !== "building" || !job || isActiveJob(job) || !p.controls || !sceneModel) return;
    let alive = true;
    const version = swap.version;
    const loaded =
      job.state === "succeeded"
        ? p.controls.loadModel(assetModelGlbUrl(baseUrl, token, p.projectId, sceneModel.id, version))
        : Promise.reject(new Error("The new version's 3D model could not be built."));
    loaded.then(
      () => {
        if (!alive) return;
        setShown(version);
        setSwap(null);
      },
      (e: unknown) => {
        if (alive) setSwap({ kind: "failed", version, message: messageOf(e, "The 3D model could not load.") });
      },
    );
    return () => {
      alive = false;
    };
  }, [swap, job, p.controls, sceneModel, baseUrl, token, p.projectId]);

  // ---- selection and editing
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [editing, setEditing] = useState<AssetItem | null>(null);
  const [dirty, setDirty] = useState(false);
  const { guard, dialog } = useDiscardGuard(dirty && editing !== null, editing?.name ?? "this item");
  const open = useCallback((id: string | null) => {
    setEditing(null);
    setDirty(false);
    setSelectedId(id);
  }, []);
  const guardRef = useRef(guard);
  useEffect(() => {
    guardRef.current = guard;
  });
  useEffect(() => {
    if (!p.controls) return;
    return p.controls.onSelect((node) => guardRef.current(() => open(node ? nodeToItemId(node) : null)));
  }, [p.controls, open]);
  const pick = (row: AssetItemRow) =>
    guard(() => {
      const box = p.controls?.boxOf(row.node) ?? (p.frame ? rowBox(p.frame, row) : null);
      if (box) p.controls?.flyTo(box);
      p.controls?.select(row.node);
      open(row.id);
    });

  // ---- ?at= arrival (Ruling 14), once
  const at = useMemo(() => readSiteAt(location.search), [location.search]);
  const arrived = useRef(false);
  useEffect(() => {
    if (arrived.current || !at || !p.controls || !p.frame) return;
    arrived.current = true;
    if (at.epsg !== null && at.epsg !== p.frame.crs.epsg) return;
    const [x, y, z] = siteToScene(p.frame, at.x, at.y, p.frame.datum.el_m);
    p.controls.flyTo(new THREE.Box3(new THREE.Vector3(x - 60, y - 5, z - 60), new THREE.Vector3(x + 60, y + 40, z + 60)));
  }, [at, p.controls, p.frame]);

  const notice =
    swap?.kind === "building" ? (
      <Alert tone="info" title={`Building version ${swap.version}…`}>
        <Progress thin running value={job?.progress ?? undefined} label="Building the 3D model" className="mt-2" />
      </Alert>
    ) : swap?.kind === "failed" ? (
      <Alert
        tone="danger"
        role="alert"
        title={`Version ${swap.version}'s 3D model could not load.`}
        onDismiss={() => setSwap(null)}
      >
        <p className="flex items-center gap-1.5 text-xs text-muted">
          <Pill size="sm" tone="warn">Stale</Pill>
          {`You are seeing version ${shown}. ${swap.message}`}
        </p>
      </Alert>
    ) : null;

  return (
    <div className="pointer-events-none absolute inset-0 z-10">
      <div className="absolute left-3.5 top-3.5">
        <LayersPanel
          rows={rows}
          onVisible={onVisible}
          onOpacity={onOpacity}
          colourBy={colourBy}
          onColourBy={(c) => {
            setColourBy(c);
            p.controls?.setColourBy(c);
          }}
          cloudColour={placeableCloud ? p.extra.cloudColour : null}
          onCloudColour={p.extra.setCloudColour}
          budget={placeableCloud ? p.extra.budget : null}
          onBudget={p.extra.setBudget}
        />
      </div>
      {sceneModel && shown !== null && (
        <aside
          aria-label="Plant register"
          className="pointer-events-auto absolute bottom-3.5 right-3.5 top-3.5 flex w-[340px] flex-col gap-3 rounded-panel border border-glass-line bg-glass-solid p-3 shadow-elev-2 animate-slide-in reduce-motion:animate-none"
        >
          <header className="flex items-center gap-2">
            <span className="text-sm font-semibold text-ink">{model?.name ?? "Plant model"}</span>
            <span className="font-mono text-xs tabular-nums text-muted">{`Version ${shown}`}</span>
            <Link className="ml-auto text-xs text-accent-ink underline-offset-2 hover:underline" to={modelDetailsHref(p.projectId, sceneModel.id)}>
              Model details
            </Link>
          </header>
          {editing ? (
            <ItemEditor
              projectId={p.projectId}
              modelId={sceneModel.id}
              baseVersion={shown}
              item={editing}
              catalogue={catalogue.length ? catalogue : []}
              onDirty={setDirty}
              onCancel={() => guard(() => open(selectedId))}
              onSaved={(version, jobId) => {
                setDirty(false);
                setEditing(null);
                setSwap({ kind: "building", version, jobId });
              }}
            />
          ) : selectedId ? (
            <ItemPanel
              projectId={p.projectId}
              modelId={sceneModel.id}
              version={shown}
              itemId={selectedId}
              onBack={() => {
                p.controls?.select(null);
                open(null);
              }}
              onEdit={setEditing}
            />
          ) : (
            <RegisterPanel
              projectId={p.projectId}
              modelId={sceneModel.id}
              version={shown}
              catalogueTypes={catalogue.map((c) => c.type)}
              selectedId={selectedId}
              onPick={pick}
            />
          )}
        </aside>
      )}
      {notice && <div className="pointer-events-auto absolute left-1/2 top-3.5 w-full max-w-md -translate-x-1/2">{notice}</div>}
      {model && (
        <div className="absolute bottom-3.5 left-3.5 right-[358px] flex justify-center">
          <RunBar projectId={p.projectId} model={model} />
        </div>
      )}
      {dialog}
    </div>
  );
}
```

The editor's catalogue may be empty if the catalogue read failed; `ItemEditor` then shows only fields for the item's own type (none) and the type select lists nothing but the current value: add `{p.catalogue.length === 0 && <option value={draft.type}>{draft.type}</option>}` in `ItemEditor`'s type `Select` if the test run shows an empty select.

`-translate-x-1/2` on the notice wrapper is a static transform, not an animation; it does not wrap glass, so DESIGN's backdrop-root rule is not involved (the notice is an opaque `Alert`).

- [ ] **Step 5: Run the test**

Run: `pnpm -C frontend exec vitest run src/site3d/panels/SitePanels.test.tsx` → Expected: 8 passed.

- [ ] **Step 6: Wire into `SiteScreen.tsx` and update S2's e2e locator**

In `frontend/src/site3d/SiteScreen.tsx` (names from Task 1): build the controls once both exist, and replace S1's placeholder elements with the panels; remove S2's `<ExtraLayerStatus …/>` and its import (its lines now show on screen in the Layers panel):

```tsx
import { controlsOf } from "@/site3d/panels/engineBridge";
import { SitePanels } from "@/site3d/panels/SitePanels";

// …with S1's engine, model layer, layer list, scene and frame, and S2's `extra`:
const controls = useMemo(() => (engine && modelLayer ? controlsOf(engine, modelLayer) : null), [engine, modelLayer]);
// …in the JSX, where S1's placeholders were:
{scene && <SitePanels projectId={projectId} scene={scene} frame={frame} controls={controls} s1Layers={s1Layers} extra={extra} />}
```

In `frontend/e2e/site3d-env.spec.ts` replace the `Layer status` list with the Layers panel and keep every assertion's meaning:

```ts
  const layers = page.getByRole("region", { name: "Layers" });
  // Index Review Focus 2: a cloud in another CRS is never projected; the view says so.
  await expect(layers.getByText(/^Can't place this cloud/)).toBeVisible({ timeout: 20_000 });
  await expect(layers.getByRole("switch", { name: "Local scan" })).toBeDisabled();
  await expect(layers.getByRole("switch", { name: "Water" })).toHaveAttribute("aria-checked", "true");
  await expect(layers.getByRole("switch", { name: "Sky" })).toHaveAttribute("aria-checked", "true");
  await expect(layers.getByRole("switch", { name: "Photos" })).toBeDisabled(); // "No posed photos in this project."
  await expect(layers.getByText("No posed photos in this project.")).toBeVisible();
```

Run: `pnpm -C frontend exec vitest run src/site3d` → Expected: all pass (S1's, S2's and S3's site tests).

- [ ] **Step 7: Commit**

```bash
git add frontend/src/site3d/panels/SitePanels.tsx frontend/src/site3d/panels/SitePanels.test.tsx frontend/src/site3d/panels/useCatalogue.ts frontend/src/site3d/SiteScreen.tsx frontend/e2e/site3d-env.spec.ts
git commit -m "feat(site3d): layers, register, item, editor and run panels over the site view

Edits swap the GLB keeping the camera; a failed swap keeps the old model labelled stale.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task S3-10: Entry points (Asset models, Map and Cloud workspaces, run summary)

**Files:**
- Create: `frontend/src/site3d/entry/links.ts`, `frontend/src/site3d/entry/useOpenSiteAction.ts`
- Modify: `frontend/src/assetmodels/workspace/AssetModelWorkspace.tsx`, `frontend/src/assetmodels/run/RunTab.tsx`, `frontend/src/mapws/MapWorkspace.tsx`, `frontend/src/clouds/workspace/CloudWorkspace.tsx`
- Test: `frontend/src/site3d/entry/links.test.ts`, `frontend/src/site3d/entry/useOpenSiteAction.test.tsx`, `frontend/src/assetmodels/workspace/AssetModelWorkspace.test.tsx` (3 cases), `frontend/src/assetmodels/run/RunTab.test.tsx` (1 case)

**Interfaces:**
- Consumes: `useProvideRouteActions`, `useProvidedRouteActions`, `RouteAction` (`@/app/routeActions`); the map workspace store (`useWorkspaceStores()`, `viewInfo.center`, `frame.epsg`); the cloud viewer handle (`currentPose()?.target`, `cloud.epsg`); `AssetModel.kind` (F0).
- Produces: `SiteAt`, `MODEL_VIEW`, `siteHref(projectId, modelId?, at?)`, `readSiteAt(search)`, `modelDetailsHref(projectId, modelId)`, `useOpenSiteAction(projectId, where)`.

Ping the P1 coordinator (app-e5) before this lands on `main` (touches `frontend/src/assetmodels/`).

- [ ] **Step 1: Write the failing tests**

`frontend/src/site3d/entry/links.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { modelDetailsHref, readSiteAt, siteHref } from "./links";

describe("site links", () => {
  it("opens the site view, optionally on a model and at a spot in the caller's CRS", () => {
    expect(siteHref("p1")).toBe("/p/p1/site");
    expect(siteHref("p1", "m1")).toBe("/p/p1/site/m1");
    expect(siteHref("p1", null, { x: 244400.5, y: 3179600.254, epsg: 32639 })).toBe("/p/p1/site?at=244400.50,3179600.25&epsg=32639");
    expect(siteHref("p1", "m1", { x: 1, y: 2, epsg: null })).toBe("/p/p1/site/m1?at=1.00,2.00");
    expect(siteHref("p1", "m1", { x: Number.NaN, y: 2, epsg: null })).toBe("/p/p1/site/m1");
  });
  it("reads ?at= and ?epsg= back, and nothing from junk", () => {
    expect(readSiteAt("?at=244400.50,3179600.25&epsg=32639")).toEqual({ x: 244400.5, y: 3179600.25, epsg: 32639 });
    expect(readSiteAt("?at=1,2")).toEqual({ x: 1, y: 2, epsg: null });
    expect(readSiteAt("?at=1")).toBeNull();
    expect(readSiteAt("")).toBeNull();
  });
  it("the model's own workspace stays reachable for a plant", () => {
    expect(modelDetailsHref("p1", "m1")).toBe("/p/p1/models/m1?view=model");
  });
});
```

`frontend/src/site3d/entry/useOpenSiteAction.test.tsx`:

```tsx
import { act, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { useProvidedRouteActions } from "@/app/routeActions";
import { LocationProbe, renderWithProviders } from "@/test/render";
import { fakeClient } from "@/test/fixtures";
import type { SiteAt } from "./links";
import { useOpenSiteAction } from "./useOpenSiteAction";

function Probe({ where }: { where: () => SiteAt | null }) {
  useOpenSiteAction("p1", where);
  return null;
}
const action = () => useProvidedRouteActions.getState().entries.flatMap((e) => e.actions).find((a) => a.id === "open-site-3d");

describe("useOpenSiteAction", () => {
  it("offers Open site in 3D in the top bar and opens the site view at the current spot", () => {
    const { api } = fakeClient([]);
    renderWithProviders(
      <>
        <Probe where={() => ({ x: 244400.5, y: 3179600.25, epsg: 32639 })} />
        <LocationProbe />
      </>,
      { api, route: "/p/p1/maps" },
    );
    expect(action()?.label).toBe("Open site in 3D");
    act(() => action()!.run!());
    expect(screen.getByTestId("location")).toHaveTextContent("/p/p1/site?at=244400.50,3179600.25&epsg=32639");
  });

  it("without a spot it opens the site view framed", () => {
    const { api } = fakeClient([]);
    renderWithProviders(
      <>
        <Probe where={() => null} />
        <LocationProbe />
      </>,
      { api, route: "/p/p1/clouds/c1" },
    );
    act(() => action()!.run!());
    expect(screen.getByTestId("location")).toHaveTextContent(/^\/p\/p1\/site$/);
  });
});
```

Add to `frontend/src/assetmodels/workspace/AssetModelWorkspace.test.tsx` (inside its `describe`, using the file's `routes`, `open` helpers):

```tsx
  it("a plant model opens in the site view (Ruling 13)", async () => {
    open([{ method: "GET", path: /\/asset-models$/, body: { items: [{ ...MODEL, kind: "plant" }] } }]);
    await waitFor(() => expect(screen.getByTestId("location")).toHaveTextContent(`/p/${PROJECT_ID}/site/m1`));
  });

  it("?view=model keeps a plant in this workspace", async () => {
    const client = fakeClient(routes([{ method: "GET", path: /\/asset-models$/, body: { items: [{ ...MODEL, kind: "plant" }] } }]) as never);
    renderWithProviders(
      <>
        <AssetModelWorkspace />
        <LocationProbe />
      </>,
      { api: client.api, route: `/p/${PROJECT_ID}/models/m1?view=model`, path: "/p/:projectId/models/:modelId?" },
    );
    expect(await screen.findByTestId("model-workspace")).toBeInTheDocument();
    expect(screen.getByTestId("location")).toHaveTextContent(`/p/${PROJECT_ID}/models/m1?view=model`);
  });

  it("Open in site opens this model in the site view", async () => {
    open();
    fireEvent.click(await screen.findByRole("button", { name: "Open in site" }));
    expect(screen.getByTestId("location")).toHaveTextContent(`/p/${PROJECT_ID}/site/m1`);
  });
```

Add to `frontend/src/assetmodels/run/RunTab.test.tsx`:

```tsx
  it("a finished plant run links to the site view; an asset run does not", () => {
    const { api } = fakeClient([]);
    const { unmount } = renderWithProviders(
      <RunTab projectId={PROJECT_ID} model={{ ...MODEL, kind: "plant" }} runs={[RUN_FINISHED]} onStarted={() => {}} />,
      { api },
    );
    expect(screen.getByRole("link", { name: "Open in site" })).toHaveAttribute("href", `/p/${PROJECT_ID}/site/${MODEL.id}`);
    unmount();
    renderWithProviders(<RunTab projectId={PROJECT_ID} model={{ ...MODEL, kind: "asset" }} runs={[RUN_FINISHED]} onStarted={() => {}} />, { api });
    expect(screen.queryByRole("link", { name: "Open in site" })).toBeNull();
  });
```

- [ ] **Step 2: Run them to verify they fail**

Run: `pnpm -C frontend exec vitest run src/site3d/entry src/assetmodels/workspace/AssetModelWorkspace.test.tsx src/assetmodels/run/RunTab.test.tsx` → Expected: the new cases FAIL.

- [ ] **Step 3: Implement the links and the route action**

`frontend/src/site3d/entry/links.ts`:

```ts
/** A spot in the caller's CRS (`epsg` null when the caller has none); the site view uses it only in its own CRS. */
export interface SiteAt {
  x: number;
  y: number;
  epsg: number | null;
}

/** The plant model's own workspace (versions, runs) for a plant, which otherwise opens in the site view. */
export const MODEL_VIEW = "view=model";

/** `/p/:projectId/site[/:modelId][?at=x,y[&epsg=n]]` (spec §11 route; `at` like the 3D jump contract). */
export function siteHref(projectId: string, modelId?: string | null, at?: SiteAt | null): string {
  const base = `/p/${projectId}/site${modelId ? `/${encodeURIComponent(modelId)}` : ""}`;
  if (!at || !Number.isFinite(at.x) || !Number.isFinite(at.y)) return base;
  return `${base}?at=${at.x.toFixed(2)},${at.y.toFixed(2)}${at.epsg != null ? `&epsg=${at.epsg}` : ""}`;
}

export function readSiteAt(search: string): SiteAt | null {
  const q = new URLSearchParams(search);
  const parts = (q.get("at") ?? "").split(",").map(Number);
  if (parts.length !== 2 || !parts.every(Number.isFinite)) return null;
  const epsg = q.get("epsg");
  return { x: parts[0], y: parts[1], epsg: epsg && Number.isFinite(Number(epsg)) ? Number(epsg) : null };
}

export function modelDetailsHref(projectId: string, modelId: string): string {
  return `/p/${projectId}/models/${encodeURIComponent(modelId)}?${MODEL_VIEW}`;
}
```

`frontend/src/site3d/entry/useOpenSiteAction.ts`:

```ts
import { useEffect, useMemo, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { useProvideRouteActions, type RouteAction } from "@/app/routeActions";
import { siteHref, type SiteAt } from "./links";

/**
 * The Map and Cloud workspaces' "Open site in 3D" (Ruling 14): a top-bar action that opens the site
 * view at the workspace's current spot. `where` is read at click time, so panning never re-registers.
 */
export function useOpenSiteAction(projectId: string, where: () => SiteAt | null): void {
  const navigate = useNavigate();
  const whereRef = useRef(where);
  useEffect(() => {
    whereRef.current = where;
  });
  const actions = useMemo<RouteAction[]>(
    () => [
      {
        id: "open-site-3d",
        label: "Open site in 3D",
        icon: "cube",
        variant: "secondary",
        tooltip: "The plant model with the ortho, the point cloud and the drawings",
        run: () => navigate(siteHref(projectId, null, whereRef.current())),
      },
    ],
    [navigate, projectId],
  );
  useProvideRouteActions(actions);
}
```

- [ ] **Step 4: Touch the workspaces**

`frontend/src/assetmodels/workspace/AssetModelWorkspace.tsx`:
1. Imports: `useSearchParams` from `react-router-dom` (beside `Navigate, useNavigate, useParams`), `siteHref` from `@/site3d/entry/links`.
2. In `AssetModelWorkspace()`, with the other hooks at the top: `const [search] = useSearchParams();`. After `const model = all.find(…) ?? null;` add:

```tsx
  // Ruling 13: a plant model opens in the site view unless asked for here (?view=model).
  if (model?.kind === "plant" && search.get("view") !== "model")
    return <Navigate replace to={siteHref(projectId, model.id)} />;
```

3. In `ModelWorkspace`, add `const navigate = useNavigate();` beside its other hooks, and inside the Download `GlassPanel`, before `<MenuButton …>`:

```tsx
        <Button variant="ghost" size="sm" icon="cube" onClick={() => navigate(siteHref(projectId, model.id))}>
          Open in site
        </Button>
```

and give that `GlassPanel` `className` a `flex items-center gap-0.5` (keep the rest).

`frontend/src/assetmodels/run/RunTab.tsx`: import `Link` from `react-router-dom` and `siteHref`; after `{run.summary && <p …>{run.summary}</p>}` add:

```tsx
        {run.state === "finished" && run.version != null && model.kind === "plant" && (
          <Link
            to={siteHref(projectId, model.id)}
            className="self-start text-sm text-accent-ink underline-offset-2 hover:underline"
          >
            Open in site
          </Link>
        )}
```

`frontend/src/mapws/MapWorkspace.tsx`, in `WorkspaceBody` right after `const { workspace, projectId, frame } = useWorkspaceStores();`:

```tsx
  useOpenSiteAction(projectId, () => {
    const v = workspace.getState().viewInfo;
    return v ? { x: v.center[0], y: v.center[1], epsg: frame.kind === "crs" ? frame.epsg : null } : null;
  });
```

(import `useOpenSiteAction` from `@/site3d/entry/useOpenSiteAction`).

`frontend/src/clouds/workspace/CloudWorkspace.tsx`, in `ReadyWorkspace` right after `const viewer = useRef<CloudViewerHandle>(null);`:

```tsx
  useOpenSiteAction(projectId, () => {
    const t = viewer.current?.currentPose()?.target;
    return t ? { x: t[0], y: t[1], epsg: cloud.epsg } : null;
  });
```

- [ ] **Step 5: Run the tests**

Run: the Step 2 command, then `pnpm -C frontend exec vitest run src/mapws src/clouds/workspace` → Expected: all pass.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/site3d/entry/links.ts frontend/src/site3d/entry/links.test.ts frontend/src/site3d/entry/useOpenSiteAction.ts frontend/src/site3d/entry/useOpenSiteAction.test.tsx frontend/src/assetmodels/workspace/AssetModelWorkspace.tsx frontend/src/assetmodels/workspace/AssetModelWorkspace.test.tsx frontend/src/assetmodels/run/RunTab.tsx frontend/src/assetmodels/run/RunTab.test.tsx frontend/src/mapws/MapWorkspace.tsx frontend/src/clouds/workspace/CloudWorkspace.tsx
git commit -m "feat(site3d): open the site view from Asset models, the Map and Cloud workspaces and a run

Plant models open in the site view by default; ?view=model keeps the model workspace.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task S3-11: e2e on the Prism mock (open site, toggle layers, search, select, edit, swap) (WAITING: S2)

**Files:**
- Create: `frontend/e2e/fixtures/make_plant_site.py`, `frontend/e2e/fixtures/plant-site-v1.glb`, `frontend/e2e/fixtures/plant-site-v2.glb`, `frontend/e2e/fixtures/plant-site-spec-v1.json` (generated), `frontend/e2e/fixtures/plantSite.ts`, `frontend/e2e/site3d-panels.spec.ts`

**Interfaces:**
- Consumes: A1's `assemble_glb(spec)`; F0's `AssetSpec` (`app.asset_models.spec`); every S3 panel; the Main navigation rail (`/^Asset models/`).
- Produces: `routePlantSite(page): Promise<{ versions: PostedVersion[] }>`, `PLANT`.

- [ ] **Step 1: Write and run the fixture generator**

`frontend/e2e/fixtures/make_plant_site.py`:

```python
"""Writes the S3 e2e plant: spec v1 (JSON) and the v1/v2 GLBs, built by A1's assembler.

Run from the worktree root with the backend venv:
    E:\\Dev\\Yolo\\app\\backend\\.venv\\Scripts\\python.exe frontend/e2e/fixtures/make_plant_site.py
v2 differs from v1 only in 20-T-0001's top EL (135 -> 140), the edit the e2e makes.
"""

import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(ROOT / "backend"))
from app.asset_models.assemble import assemble_glb  # noqa: E402
from app.asset_models.spec import AssetSpec  # noqa: E402

SITE = {
    "crs": {"epsg": 32639},
    "origin_crs": [244338.089, 3179515.69],
    "plant_north_deg": 17.9991,
    "datum": {"label": "HPFS", "el_m": 100.0},
    "source": {"kind": "assumed"},
}


def item(id_, tag, name, footprint, top, area):
    return {
        "id": id_,
        "tag": tag,
        "name": name,
        "type": "other",
        "area": area,
        "footprint": footprint,
        "base_el": 100.0,
        "top_el": top,
        "height_source": "drawing",
        "source": {"kind": "drawing", "id": "dr-1", "region": [0.1, 0.2, 0.3, 0.4]},
        "confidence": "high",
    }


def items(tank_top):
    return [
        item("20-T-0001", "20-T-0001", "LNG tank 1", {"kind": "circle", "center": [100.0, 200.0], "d": 80.0}, tank_top, "20"),
        item("30-P-0001", "30-P-0001", "Send-out pump 1", {"kind": "rect", "center": [260.0, 180.0], "size": [6.0, 3.0], "rot_deg": 0.0}, 103.0, "30"),
        item("untagged-1", None, "Pipe rack segment", {"kind": "line", "pts": [[150.0, 150.0], [250.0, 150.0]], "width": 8.0}, 108.0, "30"),
    ]


here = Path(__file__).parent
for version, top in ((1, 135.0), (2, 140.0)):
    spec = AssetSpec.model_validate({"site": SITE, "items": items(top)})
    glb, meta = assemble_glb(spec)
    (here / f"plant-site-v{version}.glb").write_bytes(glb)
    if version == 1:
        (here / "plant-site-spec-v1.json").write_text(json.dumps(spec.model_dump(mode="json"), indent=2) + "\n", encoding="utf-8")
    print(version, len(glb), meta.get("node_count"))
```

Run: `E:\Dev\Yolo\app\backend\.venv\Scripts\python.exe frontend/e2e/fixtures/make_plant_site.py`
Expected: two lines `1 <bytes> <nodes>` and `2 <bytes> <nodes>`, each GLB under 200 KB. If A1's `assemble_glb` signature differs, follow A1's code and log a ruling.

- [ ] **Step 2: Write the route fixture**

`frontend/e2e/fixtures/plantSite.ts`:

```ts
import { readFileSync } from "node:fs";
import type { Page, Route } from "@playwright/test";
import { P, modelJson, versionJson } from "./assetModels";

export const PLANT = "a0000000-9999-4000-8000-0000000000f1";
const CORS = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "*", "Access-Control-Allow-Methods": "GET, POST, OPTIONS" };
const GLB = { 1: readFileSync(new URL("./plant-site-v1.glb", import.meta.url)), 2: readFileSync(new URL("./plant-site-v2.glb", import.meta.url)) } as const;
const SPEC_V1 = JSON.parse(readFileSync(new URL("./plant-site-spec-v1.json", import.meta.url), "utf-8")) as { items: Item[] } & Record<string, unknown>;
const T = "2026-10-03T09:00:00Z";

interface Item {
  id: string;
  tag: string | null;
  name: string;
  type: string;
  area: string | null;
  footprint: { kind: string; center?: number[]; pts?: number[][] };
  base_el: number | null;
  top_el: number | null;
  height_source: string;
  confidence: string;
  flags: unknown[];
}
export interface PostedVersion {
  spec: { items: Item[] };
  note: string | null;
}

/** AssetItemRow from a spec item (field names as recorded in S3 Task 1). */
function row(i: Item) {
  const c = i.footprint.center ?? i.footprint.pts?.[0] ?? [0, 0];
  return {
    id: i.id, node: i.id, tag: i.tag, name: i.name, type: i.type, area: i.area,
    plant_e: c[0], plant_n: c[1], site_x: null, site_y: null, lon: null, lat: null,
    base_el: i.base_el, top_el: i.top_el, height_source: i.height_source, confidence: i.confidence,
    flags: i.flags ?? [], source_sheet: "T0006", has_geometry: true,
  };
}

/** A plant model with version 1 (the generated fixture), a catalogue, the register API and the site scene; a save adds version 2. */
export async function routePlantSite(page: Page): Promise<{ versions: PostedVersion[] }> {
  const posted: PostedVersion[] = [];
  const json = (route: Route, body: unknown, status = 200) =>
    route.fulfill({ status, contentType: "application/json", headers: CORS, body: JSON.stringify(body) });
  const current = () => (posted.length ? 2 : 1);
  const specOf = (v: number) => (v === 2 ? posted[0].spec : SPEC_V1);
  const model = () => ({ ...modelJson(current()), id: PLANT, name: "Al-Zour LNG plant", asset_type: "plant", tag: null, kind: "plant" });
  const versionRow = (v: number) => ({ ...versionJson(v as 1, v === 1 ? "agent" : "manual", v === 2 ? posted[0].note : null), id: `b0000000-9999-4000-8000-0000000000f${v}`, model_id: PLANT, part_count: 0 });
  const base = `/api/v1/projects/${P}/asset-models`;

  await page.route((u) => u.pathname === "/api/v1/asset-models/catalogue", (route) =>
    json(route, {
      items: [
        { type: "other", family: "fallback", doc: "Extrudes the footprint from base to top", default_height_m: 3, params_schema: { type: "object", properties: {} } },
        { type: "tank_lng", family: "equipment", doc: "LNG tank", default_height_m: 40, params_schema: { type: "object", properties: { d_m: { type: "number", exclusiveMinimum: 0, default: 80 } } } },
      ],
    }),
  );
  await page.route((u) => u.pathname === `/api/v1/projects/${P}/site-scene`, (route) =>
    json(route, {
      frame: { crs: { epsg: 32639, wkt: null }, origin_crs: [244338.089, 3179515.69], plant_north_deg: 17.9991, datum: { label: "HPFS", el_m: 100 } },
      model: { id: PLANT, version: current(), glb_url: `${base}/${PLANT}/versions/${current()}/glb`, csv_url: `${base}/${PLANT}/versions/${current()}/csv`, kind: "plant" },
      orthos: [], clouds: [], drawings: [], photos: { count: 0, url: null }, findings: { count: 0, url: null },
    }),
  );
  await page.route((u) => u.pathname.startsWith(base), async (route) => {
    const req = route.request();
    if (req.method() === "OPTIONS") return route.fulfill({ status: 204, headers: CORS });
    const url = new URL(req.url());
    const rest = url.pathname.slice(base.length);
    if (req.method() === "POST" && rest === `/${PLANT}/versions`) {
      posted.push(req.postDataJSON() as PostedVersion);
      const job = { id: "c0000000-9999-4000-8000-0000000000f9", project_id: P, type: "asset_model_glb", state: "succeeded", progress: 1, message: "", log_path: "", params: { model_id: PLANT, version: 2 }, result: { model_id: PLANT, version: 2 }, error: null, created_at: T, started_at: T, finished_at: T };
      return json(route, { version: versionRow(2), job }, 201);
    }
    if (req.method() !== "GET") return route.fallback();
    if (rest === "") return json(route, { items: [model()] });
    if (rest === `/${PLANT}`) return json(route, model());
    if (rest === `/${PLANT}/versions`) return json(route, { items: posted.length ? [versionRow(2), versionRow(1)] : [versionRow(1)] });
    if (rest === `/${PLANT}/runs`) return json(route, { items: [] });
    const glb = /^\/[^/]+\/versions\/(\d)\/glb$/.exec(rest);
    if (glb) return route.fulfill({ status: 200, contentType: "model/gltf-binary", headers: CORS, body: GLB[Number(glb[1]) as 1 | 2] });
    const items = /^\/[^/]+\/versions\/(\d)\/items$/.exec(rest);
    if (items) {
      const q = (url.searchParams.get("q") ?? "").toLowerCase();
      const rows = specOf(Number(items[1])).items.filter((i) => !q || `${i.tag ?? ""} ${i.name}`.toLowerCase().includes(q)).map(row);
      return json(route, { items: rows, next_cursor: null });
    }
    const one = /^\/[^/]+\/versions\/(\d)\/items\/(.+)$/.exec(rest);
    if (one) {
      const it = specOf(Number(one[1])).items.find((i) => i.id === decodeURIComponent(one[2]));
      return it ? json(route, it) : json(route, { error: { code: "not_found", message: "no such item", details: {} } }, 404);
    }
    const detail = /^\/[^/]+\/versions\/(\d)$/.exec(rest);
    if (detail) return json(route, { ...versionRow(Number(detail[1])), spec: specOf(Number(detail[1])), warnings: [] });
    return route.fallback();
  });
  return { versions: posted };
}
```

- [ ] **Step 3: Write the spec**

`frontend/e2e/site3d-panels.spec.ts`:

```ts
import { expect, test } from "@playwright/test";
import { P } from "./fixtures/assetModels";
import { SWIFTSHADER } from "./fixtures/cloudWorkspace";
import { PLANT, routePlantSite } from "./fixtures/plantSite";

test.use(SWIFTSHADER);

test("open a plant in the site view, toggle layers, find a tag, edit its height into a new version", async ({ page }) => {
  const pageErrors: string[] = [];
  page.on("pageerror", (e) => pageErrors.push(e.message));
  const posted = await routePlantSite(page);

  await page.goto(`/p/${P}/overview`);
  await page.getByRole("navigation", { name: "Main navigation" }).getByRole("link", { name: /^Asset models/ }).click();
  // Ruling 13: a plant model opens in the site view.
  await expect(page).toHaveURL(new RegExp(`/p/${P}/site/${PLANT}$`), { timeout: 20_000 });

  const layers = page.getByRole("region", { name: "Layers" });
  for (const name of ["Plant model", "Sky"]) {
    const sw = layers.getByRole("switch", { name });
    await expect(sw).toHaveAttribute("aria-checked", "true");
    await sw.click();
    await expect(sw).toHaveAttribute("aria-checked", "false");
    await sw.click();
    await expect(sw).toHaveAttribute("aria-checked", "true");
  }
  await expect(layers.getByText("This model has no sea.")).toBeVisible();

  const panel = page.getByRole("complementary", { name: "Plant register" });
  await panel.getByRole("searchbox", { name: "Search the register" }).fill("20-T-0001");
  await expect(panel.getByRole("button", { name: /30-P-0001/ })).toHaveCount(0);
  await panel.getByRole("button", { name: /20-T-0001/ }).click();
  await expect(panel.getByRole("heading", { name: "LNG tank 1" })).toBeVisible();

  await panel.getByRole("button", { name: "Edit" }).click();
  await expect(panel.getByText("Editing from version 1")).toBeVisible();
  await panel.getByLabel("Top EL").fill("140");
  const glbV2 = page.waitForRequest((r) => r.url().includes(`/asset-models/${PLANT}/versions/2/glb`));
  await panel.getByRole("button", { name: "Save as new version" }).click();
  await expect(page.getByText("Saved version 2")).toBeVisible();
  await glbV2;
  await expect(panel.getByText("Version 2")).toBeVisible();
  await expect(page.getByText(/could not load/i)).toHaveCount(0);

  const sent = posted.versions[0];
  expect(sent.spec.items.find((i) => i.id === "20-T-0001")?.top_el).toBe(140);
  expect(sent.note).toBe("Edited 20-T-0001 from v1: top EL 135 → 140 m");
  expect(pageErrors).toEqual([]);
});
```

The "Plant model" label is S1's model layer label (Task 1 record); "This model has no sea." is S2's water reason (the fixture has no sea).

- [ ] **Step 4: Run it on S3's ports**

Run (PowerShell, worktree root): `$env:E2E_WEB_PORT="5420"; $env:E2E_MOCK_PORT="5421"; pnpm -C frontend exec playwright test e2e/site3d-panels.spec.ts e2e/site3d-env.spec.ts; Remove-Item Env:E2E_WEB_PORT, Env:E2E_MOCK_PORT`
Expected: 2 passed.

- [ ] **Step 5: Commit**

```bash
git add frontend/e2e/fixtures/make_plant_site.py frontend/e2e/fixtures/plant-site-v1.glb frontend/e2e/fixtures/plant-site-v2.glb frontend/e2e/fixtures/plant-site-spec-v1.json frontend/e2e/fixtures/plantSite.ts frontend/e2e/site3d-panels.spec.ts
git commit -m "test(e2e): site view panels on the Prism mock with an A1-built plant fixture

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task S3-12: Gate and operator walkthrough

**Files:** none new (fixes only).

- [ ] **Step 1: Run the full gate from the worktree root**

```powershell
pnpm -C contract check
cd backend; E:\Dev\Yolo\app\backend\.venv\Scripts\python.exe -m ruff check .; E:\Dev\Yolo\app\backend\.venv\Scripts\python.exe -m ruff format --check .; E:\Dev\Yolo\app\backend\.venv\Scripts\python.exe -m pytest; cd ..
pnpm -C frontend lint
pnpm -C frontend test
pnpm -C frontend build
$env:E2E_WEB_PORT="5420"; $env:E2E_MOCK_PORT="5421"; pnpm -C frontend e2e; Remove-Item Env:E2E_WEB_PORT, Env:E2E_MOCK_PORT
if (Test-Path frontend/src-tauri/binaries/kestrel-backend-*.exe) { cargo test --manifest-path frontend/src-tauri/Cargo.toml }
```

Expected: every command exits 0; `check-tokens` clean; the existing `models-build.spec.ts` still sees "step N of 80" (build mode). Fix failures in the owning task's files and commit each fix by path.

- [ ] **Step 2: Write the operator walkthrough into the ledger**

Append to `.superpowers/sdd/pm-common/ledgers/s3.md` (and hand to the coordinator):

```text
How to test S3 (Site 3D panels and entry points)
1. Open the LNG Terminal project and click Asset models in the sidebar: a plant model opens straight in the site view; "Model details" (top of the right panel) goes back to its versions and runs.
2. Top left, Layers: turn the plant model, the ortho, the cloud, water and sky off and on; drag an ortho's opacity; colour the model by Type, Area, Height source and Flags; set the cloud to Height colouring and the point budget to 5 M.
3. A cloud in another coordinate system shows its switch greyed with "Can't place this cloud…".
4. Right, Register: type a tag (e.g. 20-T-0001); filter by area, type and a flag; scroll a long register: it keeps loading without stalling.
5. Click a row: the view flies to the item, highlights it and the Item panel shows its heights, flags in plain words and Source (the drawing with the traced box; "Open the drawing in Maps").
6. Click Edit: it says "Editing from version N". Change Top EL, then click another item in 3D: it asks "Discard your changes to …?". Keep editing, then Save as new version: "Saved version N+1", the model swaps without the camera moving.
7. While a plant run is live, the Run bar at the bottom shows the stage, "x of y packages", tokens and Stop.
8. In Maps and in Point clouds, the top bar has "Open site in 3D": it opens the site view at the same place.
9. In Asset models → Runs, a finished plant run has "Open in site".
10. M1 fixes: in an asset model, the Run progress reads "step N of 80" for builds; a failed GLB swap says "Stale"; the Orbit icon is a label with its gestures; a failed list refresh shows "The model list could not be refreshed." with Retry.
```

- [ ] **Step 3: Commit (only if Step 1 needed fixes)**

```bash
git add <the fixed files, by path>
git commit -m "fix(site3d): <what the gate found>

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```
