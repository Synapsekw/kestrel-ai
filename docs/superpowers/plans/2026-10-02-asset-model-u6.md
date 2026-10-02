# Asset model U6 — the asset model workspace (viewer, parts, versions, manual edit)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The operator opens **Asset models** in a project, sees the current version's GLB in a full-bleed 3D view with glass panels, browses and edits parts (each edit saves a new version), restores or compares versions, and downloads the GLB and the spec.

**Architecture:**
- A lazy-loaded screen at `/p/:projectId/models[/:modelId]`, built the way `CloudWorkspace` is: a full-bleed canvas plus absolutely positioned `GlassPanel`s.
- The engine is a factory (`createModelEngine`) plus a thin React shell (`ModelViewer`), like `clouds/viewer/engine.ts` + `CloudViewer.tsx`: on-demand rendering, `ResizeObserver`, full disposal, and a `NoWebGlError` path.
- Parts, Part and Versions are tabs of an `Inspector`, with `Tabs`.
- Pure logic lives in tested modules: `specDiff.ts`, `partEdit.ts`, `groups.ts`.
- U7 adds the Build bar, the build dialog and the Run tab into the slots this unit leaves.

**Tech Stack:** React 18, TypeScript, three 0.180 (`GLTFLoader`, `OrbitControls`), the design-system primitives in `src/ui/`, Vitest and Testing Library, Playwright against the Prism mock.

**Spec:** §8. Index and Global Constraints: `docs/superpowers/plans/2026-10-02-asset-model-builder.md`.

**Needs:** U3 merged (contract and client). U6 works entirely against the Prism mock and fixtures. **Worktree:** `scripts\start-task.ps1 -Name am-u6`.

**Before any UI code:** load the design skills (`impeccable`, `emil-design-eng`), read `DESIGN.md` ("Aero glass") and the primitives in `src/ui/`, and look at `/gallery.html` under `pnpm -C frontend dev` (AGENTS.md rule 3). The layout below follows the clouds workspace's geometry (`src/clouds/workspace/layout.ts`), so the two workspaces feel the same.

---

### Task 1: API wrappers, hooks, route, tab, icon

**Files:**
- Create: `frontend/src/api/assetModels.ts`, `frontend/src/api/assetModels.test.ts`
- Create: `frontend/src/assetmodels/useAssetModels.ts`
- Create: `frontend/src/screens/AssetModelsScreen.tsx` (thin wrapper)
- Modify: `frontend/src/app/lazyScreens.tsx` (`AssetModelsScreen` lazy export)
- Modify: `frontend/src/routes/projectRoutes.tsx` (`models` and `models/:modelId`, wrapped in `<Later>`)
- Modify: `frontend/src/app/routeModel.ts` (`ProjectTabId` += `"models"`, a `PROJECT_TABS` entry `{ id: "models", label: "Asset models", icon: "cube" }` after `clouds`, `layoutOf`: `if (tab === "models") return "fullbleed";`, `WORKSPACE_TABS` += `"models"`)
- Modify: `frontend/src/ui/Icon.tsx` (a `cube` icon, stroked like the others)
- Modify: `frontend/src/app/paletteCommands.ts`, `frontend/src/reports/ReportFilters.tsx`, `frontend/src/jobs/JobCard.tsx` (swap U3's `"layers"` for `"cube"`)
- Test: `frontend/src/api/assetModels.test.ts`, `frontend/src/app/routeModel.test.ts` (extend), `frontend/src/routes/routes.test.tsx` (extend)

**Interfaces:**
- Consumes: `@contract/client` types and `assetModelGlbUrl`, `assetModelOverlayUrl` (U3); `unwrap` from `src/api/errors.ts`.
- Produces:

```ts
// src/api/assetModels.ts
export async function listAssetModels(api: ApiClient, projectId: string): Promise<AssetModel[]>;
export async function createAssetModel(api: ApiClient, projectId: string, body: { name: string; asset_type?: string | null; tag?: string | null }): Promise<AssetModel>;
export async function patchAssetModel(api: ApiClient, projectId: string, id: string, body: Partial<Pick<AssetModel, "name" | "asset_type" | "tag">>): Promise<AssetModel>;
export async function deleteAssetModel(api: ApiClient, projectId: string, id: string): Promise<void>;
export async function listVersions(api: ApiClient, projectId: string, id: string): Promise<AssetModelVersion[]>;
export async function getVersion(api: ApiClient, projectId: string, id: string, version: number): Promise<AssetModelVersionDetail>;
export async function createVersion(api: ApiClient, projectId: string, id: string, spec: AssetSpec, note?: string): Promise<{ version: AssetModelVersion; job: Job }>;
export async function restoreVersion(api: ApiClient, projectId: string, id: string, version: number): Promise<{ version: AssetModelVersion; job: Job }>;
export async function listRuns(api: ApiClient, projectId: string, id: string): Promise<AssetModelRun[]>;
export async function getRun(api: ApiClient, projectId: string, id: string, runId: string): Promise<AssetModelRun>;
export async function startRun(api: ApiClient, projectId: string, id: string, body: AssetModelRunStart): Promise<{ run: AssetModelRun; job: Job }>;
export async function stopRun(api: ApiClient, projectId: string, id: string, runId: string): Promise<AssetModelRun>;

// src/assetmodels/useAssetModels.ts
export function useAssetModelList(projectId: string): { models: AssetModel[] | null; error: string | null; reload(): void };
export function useVersions(projectId: string, modelId: string | null): { versions: AssetModelVersion[] | null; reload(): void };
export function useVersionDetail(projectId: string, modelId: string | null, version: number | null): { detail: AssetModelVersionDetail | null; error: string | null; reload(): void };
```

The hooks reload on `useOnJobsFinished("asset_model_glb", …)` and `useOnJobsFinished("asset_model_run", …)`, following `src/clouds/workspace/useCloudList.ts`.

- [ ] **Step 1: Write the failing tests**

```ts
// src/api/assetModels.test.ts
import { describe, expect, it } from "vitest";
import { fakeClient, PROJECT_ID } from "@/test/fixtures";
import { createVersion, listAssetModels, restoreVersion, startRun } from "./assetModels";

const model = { id: "m1", name: "Tank", asset_type: null, tag: null, status: "empty", current_version: null,
  live_run_id: null, captured_on: null, created_at: "2026-10-02T00:00:00Z", updated_at: "2026-10-02T00:00:00Z" };

describe("asset model api", () => {
  it("lists models", async () => {
    const { api } = fakeClient([{ method: "GET", path: /\/asset-models$/, body: { items: [model] } }]);
    expect(await listAssetModels(api, PROJECT_ID)).toEqual([model]);
  });

  it("posts a spec as a new version", async () => {
    const { api, requests } = fakeClient([{ method: "POST", path: /\/asset-models\/m1\/versions$/, status: 201,
      body: { version: { version: 2 }, job: { id: "j" } } }]);
    const out = await createVersion(api, PROJECT_ID, "m1", { parts: [] }, "edit");
    expect(out.version.version).toBe(2);
    expect(JSON.parse(String(requests[0].body))).toEqual({ spec: { parts: [] }, note: "edit" });
  });

  it("restores and starts runs on the right paths", async () => {
    const { api, requests } = fakeClient([
      { method: "POST", path: /\/versions\/1\/restore$/, status: 201, body: { version: { version: 3 }, job: { id: "j" } } },
      { method: "POST", path: /\/asset-models\/m1\/runs$/, status: 202, body: { run: { id: "r" }, job: { id: "j" } } },
    ]);
    await restoreVersion(api, PROJECT_ID, "m1", 1);
    await startRun(api, PROJECT_ID, "m1", { mode: "build", provider: "anthropic", sources: [{ type: "drawing", id: "d" }] });
    expect(requests.map((r) => r.url)).toEqual([
      expect.stringMatching(/versions\/1\/restore$/), expect.stringMatching(/asset-models\/m1\/runs$/),
    ]);
  });
});
```

(Use `fakeClient`'s actual request-record shape from `src/test/fixtures.ts`. If it records `init.body`, read that instead.)

`routeModel.test.ts`: `expect(layoutOf("models", null, null)).toBe("fullbleed")` and `expect(PROJECT_TABS.map((t) => t.id)).toContain("models")`.

`routes.test.tsx`: rendering `/p/<id>/models` shows the lazy screen's placeholder, then `data-testid="model-workspace"`. Mock the screen module as the clouds route test does.

- [ ] **Step 2: Run them to verify they fail**

Run: `pnpm -C frontend test -- src/api/assetModels.test.ts src/app/routeModel.test.ts src/routes/routes.test.tsx`
Expected: FAIL (the module doesn't exist; there's no `models` tab)

- [ ] **Step 3: Implement**

`src/api/assetModels.ts`, in the style of `src/api/clouds.ts`:

```ts
import type { ApiClient, AssetModel, AssetModelRun, AssetModelRunStart, AssetModelVersion,
  AssetModelVersionDetail, AssetSpec, Job } from "@contract/client";
import { unwrap } from "./errors";

const P = "/api/v1/projects/{projectId}/asset-models";
const path = (projectId: string, assetModelId?: string) => ({ params: { path: { projectId, ...(assetModelId ? { assetModelId } : {}) } } });

export async function listAssetModels(api: ApiClient, projectId: string): Promise<AssetModel[]> {
  return (await unwrap(api.GET(P, path(projectId)))).items;
}
export async function createAssetModel(api: ApiClient, projectId: string, body: { name: string; asset_type?: string | null; tag?: string | null }) {
  return unwrap(api.POST(P, { ...path(projectId), body }));
}
export async function patchAssetModel(api: ApiClient, projectId: string, id: string, body: Partial<Pick<AssetModel, "name" | "asset_type" | "tag">>) {
  return unwrap(api.PATCH(`${P}/{assetModelId}`, { ...path(projectId, id), body }));
}
export async function deleteAssetModel(api: ApiClient, projectId: string, id: string): Promise<void> {
  await unwrap(api.DELETE(`${P}/{assetModelId}`, path(projectId, id)));
}
export async function listVersions(api: ApiClient, projectId: string, id: string): Promise<AssetModelVersion[]> {
  return (await unwrap(api.GET(`${P}/{assetModelId}/versions`, path(projectId, id)))).items;
}
export async function getVersion(api: ApiClient, projectId: string, id: string, version: number): Promise<AssetModelVersionDetail> {
  return unwrap(api.GET(`${P}/{assetModelId}/versions/{version}`, { params: { path: { projectId, assetModelId: id, version } } }));
}
export async function createVersion(api: ApiClient, projectId: string, id: string, spec: AssetSpec, note?: string): Promise<{ version: AssetModelVersion; job: Job }> {
  return unwrap(api.POST(`${P}/{assetModelId}/versions`, { ...path(projectId, id), body: { spec, note: note ?? null } }));
}
export async function restoreVersion(api: ApiClient, projectId: string, id: string, version: number) {
  return unwrap(api.POST(`${P}/{assetModelId}/versions/{version}/restore`, { params: { path: { projectId, assetModelId: id, version } } }));
}
export async function listRuns(api: ApiClient, projectId: string, id: string): Promise<AssetModelRun[]> {
  return (await unwrap(api.GET(`${P}/{assetModelId}/runs`, path(projectId, id)))).items;
}
export async function getRun(api: ApiClient, projectId: string, id: string, runId: string): Promise<AssetModelRun> {
  return unwrap(api.GET(`${P}/{assetModelId}/runs/{runId}`, { params: { path: { projectId, assetModelId: id, runId } } }));
}
export async function startRun(api: ApiClient, projectId: string, id: string, body: AssetModelRunStart) {
  return unwrap(api.POST(`${P}/{assetModelId}/runs`, { ...path(projectId, id), body }));
}
export async function stopRun(api: ApiClient, projectId: string, id: string, runId: string): Promise<AssetModelRun> {
  return unwrap(api.POST(`${P}/{assetModelId}/runs/{runId}/stop`, { params: { path: { projectId, assetModelId: id, runId } } }));
}
```

`src/assetmodels/useAssetModels.ts` follows `useCloudList.ts` (`useState` + `useEffect` + a `reload` counter + `useOnJobsFinished`). The screen wrapper is `export function AssetModelsScreen() { return <AssetModelWorkspace />; }`, and the lazy export copies `CloudsScreen`'s exactly.

Routes, the tab and `layoutOf` as listed under **Files**. For the `cube` icon, add an entry to `Icon.tsx`'s path map in the same 24×24, 1.5-stroke style as `layers`: an isometric cube (`M12 3l8 4.5v9L12 21l-8-4.5v-9L12 3z M12 12l8-4.5 M12 12v9 M12 12L4 7.5`).

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm -C frontend test -- src/api/assetModels.test.ts src/app/routeModel.test.ts src/routes/routes.test.tsx` and `pnpm -C frontend lint`
Expected: PASS, lint clean

- [ ] **Step 5: Commit**

```bash
git add frontend/src/api/assetModels.ts frontend/src/api/assetModels.test.ts frontend/src/assetmodels/useAssetModels.ts frontend/src/screens/AssetModelsScreen.tsx frontend/src/app/lazyScreens.tsx frontend/src/routes/projectRoutes.tsx frontend/src/app/routeModel.ts frontend/src/app/routeModel.test.ts frontend/src/routes/routes.test.tsx frontend/src/ui/Icon.tsx frontend/src/app/paletteCommands.ts frontend/src/reports/ReportFilters.tsx frontend/src/jobs/JobCard.tsx
git commit -m "feat(asset-models): api wrappers, hooks, route and tab

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: The GLB viewer engine and its React shell

**Files:**
- Create: `frontend/src/assetmodels/viewer/engine.ts`
- Create: `frontend/src/assetmodels/viewer/ModelViewer.tsx`
- Create: `frontend/src/test/fakeModelViewer.tsx` (for workspace tests, like `fakeCloudViewer`)
- Test: `frontend/src/assetmodels/viewer/engine.test.ts`, `frontend/src/assetmodels/viewer/ModelViewer.test.tsx`

**Interfaces:**
- Consumes: `NoWebGlError` (`src/clouds/viewer/engine.ts`), `tokenRgb` (`src/clouds/viewer/overlay.ts`), `disposeChildren` (`src/clouds/viewer/dispose.ts`).
- Produces:

```ts
// src/assetmodels/viewer/engine.ts
export type ModelView = "top" | "front" | "side" | "iso" | "fit";
export interface ModelPart { id: string; name: string; group: string }
export interface ModelEngine {
  load(url: string): Promise<ModelPart[]>;          // rejects on a bad GLB; parts come from node extras
  setGroupVisible(group: string, visible: boolean): void;
  select(partId: string | null): void;               // highlight + emits onSelect
  setCut(bearingDeg: number | null): void;           // vertical clip plane through the axis
  setLevels(on: boolean): void;                      // 1 m elevation rings
  setHeadOff(on: boolean): void;                     // hides group "Head"
  setOverlay(points: Float32Array | null): void;     // xyz triples, asset frame
  setView(view: ModelView): void;
  dispose(): void;
}
export function createModelEngine(o: { canvas: HTMLCanvasElement; host: HTMLElement;
  onSelect?: (partId: string | null) => void }): ModelEngine;   // throws NoWebGlError
export function viewDirection(view: Exclude<ModelView, "fit">): [number, number, number];  // pure, tested
export function partsFromScene(root: { traverse(cb: (o: any) => void): void }): ModelPart[];  // pure, tested

// src/assetmodels/viewer/ModelViewer.tsx
export type ModelViewState = "loading" | "running" | "no-webgl" | "load-error";
export interface ModelViewerHandle extends Omit<ModelEngine, "load" | "dispose"> {}
export const ModelViewer: React.ForwardRefExoticComponent<{
  glbUrl: string | null; onParts(parts: ModelPart[]): void; onSelect(id: string | null): void;
  onState?(s: ModelViewState): void } & React.RefAttributes<ModelViewerHandle>>;
```

View conventions match the backend rasterizer: `front` looks north (+X), `side` looks east (+Z), `top` looks down with north up, `iso` looks along (1, −0.8, 1). The camera's up is +Y.

- [ ] **Step 1: Write the failing tests**

```ts
// src/assetmodels/viewer/engine.test.ts
import { describe, expect, it } from "vitest";
import { partsFromScene, viewDirection } from "./engine";

describe("model engine pure helpers", () => {
  it("views match the backend rasterizer", () => {
    expect(viewDirection("front")).toEqual([1, 0, 0]);
    expect(viewDirection("side")).toEqual([0, 0, 1]);
    expect(viewDirection("top")).toEqual([0, -1, 0]);
    const iso = viewDirection("iso");
    expect(Math.hypot(...iso)).toBeCloseTo(1);
  });

  it("reads parts from node extras, skipping nodes without them", () => {
    const nodes = [
      { name: "shell", userData: { name: "Shell", group: "Shell" } },
      { name: "N7", userData: { name: "Nozzle N7", group: "Nozzle" } },
      { name: "Scene", userData: {} },
    ];
    const root = { traverse: (cb: (o: unknown) => void) => nodes.forEach(cb) };
    expect(partsFromScene(root)).toEqual([
      { id: "shell", name: "Shell", group: "Shell" },
      { id: "N7", name: "Nozzle N7", group: "Nozzle" },
    ]);
  });
});
```

```tsx
// src/assetmodels/viewer/ModelViewer.test.tsx
import { render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

const create = vi.fn();
vi.mock("./engine", async (orig) => ({ ...(await orig<typeof import("./engine")>()), createModelEngine: (o: unknown) => create(o) }));

import { NoWebGlError } from "@/clouds/viewer/engine";
import { ModelViewer } from "./ModelViewer";

describe("ModelViewer", () => {
  it("no-webgl shows a notice, never a blank canvas", async () => {
    create.mockImplementation(() => { throw new NoWebGlError("no"); });
    render(<ModelViewer glbUrl="x.glb" onParts={() => {}} onSelect={() => {}} />);
    expect(await screen.findByRole("alert")).toHaveTextContent(/3D view is off/i);
  });

  it("load-error shows a notice with reload", async () => {
    create.mockImplementation(() => ({ load: () => Promise.reject(new Error("bad glb")), dispose: vi.fn(),
      setGroupVisible: vi.fn(), select: vi.fn(), setCut: vi.fn(), setLevels: vi.fn(), setHeadOff: vi.fn(),
      setOverlay: vi.fn(), setView: vi.fn() }));
    render(<ModelViewer glbUrl="x.glb" onParts={() => {}} onSelect={() => {}} />);
    expect(await screen.findByRole("alert")).toHaveTextContent(/could not load/i);
    expect(screen.getByRole("button", { name: /reload view/i })).toBeInTheDocument();
  });

  it("reports parts after a load and disposes on unmount", async () => {
    const dispose = vi.fn();
    create.mockImplementation(() => ({ load: () => Promise.resolve([{ id: "s", name: "S", group: "Shell" }]), dispose,
      setGroupVisible: vi.fn(), select: vi.fn(), setCut: vi.fn(), setLevels: vi.fn(), setHeadOff: vi.fn(),
      setOverlay: vi.fn(), setView: vi.fn() }));
    const onParts = vi.fn();
    const { unmount } = render(<ModelViewer glbUrl="x.glb" onParts={onParts} onSelect={() => {}} />);
    await waitFor(() => expect(onParts).toHaveBeenCalledWith([{ id: "s", name: "S", group: "Shell" }]));
    unmount();
    expect(dispose).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `pnpm -C frontend test -- src/assetmodels/viewer`
Expected: FAIL (the modules don't exist)

- [ ] **Step 3: Implement the engine**

```ts
// src/assetmodels/viewer/engine.ts
// GLB viewer for asset models (spec 2026-10-02 §8). Factory + on-demand render loop, like the clouds engine.
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { disposeChildren } from "@/clouds/viewer/dispose";
import { NoWebGlError } from "@/clouds/viewer/engine";
import { tokenRgb } from "@/clouds/viewer/overlay";

export type ModelView = "top" | "front" | "side" | "iso" | "fit";
export interface ModelPart { id: string; name: string; group: string }
export interface ModelEngine {
  load(url: string): Promise<ModelPart[]>;
  setGroupVisible(group: string, visible: boolean): void;
  select(partId: string | null): void;
  setCut(bearingDeg: number | null): void;
  setLevels(on: boolean): void;
  setHeadOff(on: boolean): void;
  setOverlay(points: Float32Array | null): void;
  setView(view: ModelView): void;
  dispose(): void;
}

export function viewDirection(view: Exclude<ModelView, "fit">): [number, number, number] {
  if (view === "front") return [1, 0, 0];
  if (view === "side") return [0, 0, 1];
  if (view === "top") return [0, -1, 0];
  const n = Math.hypot(1, 0.8, 1);
  return [1 / n, -0.8 / n, 1 / n];
}

export function partsFromScene(root: { traverse(cb: (o: any) => void): void }): ModelPart[] {
  const out: ModelPart[] = [];
  root.traverse((o) => {
    const ud = o.userData ?? {};
    if (typeof ud.group === "string" && typeof o.name === "string" && o.name) {
      out.push({ id: o.name, name: typeof ud.name === "string" ? ud.name : o.name, group: ud.group });
    }
  });
  return out;
}

export function createModelEngine(o: { canvas: HTMLCanvasElement; host: HTMLElement;
  onSelect?: (partId: string | null) => void }): ModelEngine {
  let renderer: THREE.WebGLRenderer;
  try {
    renderer = new THREE.WebGLRenderer({ canvas: o.canvas, antialias: true, powerPreference: "high-performance" });
  } catch {
    throw new NoWebGlError("WebGL is not available");
  }
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.localClippingEnabled = true;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  const [r, g, b] = tokenRgb("bg");
  renderer.setClearColor(new THREE.Color(r / 255, g / 255, b / 255));
  const scene = new THREE.Scene();
  scene.add(new THREE.HemisphereLight(0xdfe8ff, 0x2a2f3a, 0.9));
  const sun = new THREE.DirectionalLight(0xffffff, 1.4);
  sun.position.set(-8, 16, 10);
  scene.add(sun);
  const camera = new THREE.PerspectiveCamera(38, 1, 0.05, 1000);
  camera.up.set(0, 1, 0);
  const controls = new OrbitControls(camera, o.canvas);
  controls.enableDamping = true;
  controls.zoomToCursor = true;
  const modelRoot = new THREE.Group();
  const helpers = new THREE.Group();
  scene.add(modelRoot, helpers);
  const cutPlane = new THREE.Plane(new THREE.Vector3(-1, 0, 0), 0);
  const nodes = new Map<string, THREE.Object3D>();
  const hiddenGroups = new Set<string>();
  let headOff = false;
  let selected: string | null = null;
  let bounds = new THREE.Box3(new THREE.Vector3(-1, 0, -1), new THREE.Vector3(1, 2, 1));
  let raf = 0;
  let idleUntil = 0;

  const frame = () => {
    controls.update();
    renderer.render(scene, camera);
    raf = performance.now() < idleUntil ? requestAnimationFrame(frame) : 0;
  };
  const requestRender = () => {
    idleUntil = performance.now() + 1000;
    if (!raf) raf = requestAnimationFrame(frame);
  };
  controls.addEventListener("change", requestRender);
  const resize = () => {
    const w = o.host.clientWidth || 1;
    const h = o.host.clientHeight || 1;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    requestRender();
  };
  const ro = new ResizeObserver(resize);
  ro.observe(o.host);
  resize();

  const applyVisibility = () => {
    for (const [, node] of nodes) {
      const group = node.userData.group as string;
      node.visible = !hiddenGroups.has(group) && !(headOff && group === "Head");
    }
    requestRender();
  };
  const applyMaterials = (fn: (m: THREE.Material, id: string) => void) => {
    for (const [id, node] of nodes) {
      node.traverse((c) => {
        const mesh = c as THREE.Mesh;
        if (!mesh.isMesh) return;
        const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
        mats.forEach((m) => fn(m, id));
      });
    }
    requestRender();
  };

  const setView = (view: ModelView) => {
    const size = bounds.getSize(new THREE.Vector3());
    const centre = bounds.getCenter(new THREE.Vector3());
    const radius = Math.max(size.length() / 2, 0.5);
    const dir = new THREE.Vector3(...viewDirection(view === "fit" ? "iso" : view));
    const dist = radius / Math.sin(THREE.MathUtils.degToRad(camera.fov / 2));
    camera.position.copy(centre).addScaledVector(dir, -dist);
    camera.up.set(view === "top" ? 1 : 0, view === "top" ? 0 : 1, 0);   // top: north up the screen
    camera.near = dist / 100;
    camera.far = dist * 10;
    camera.updateProjectionMatrix();
    controls.target.copy(centre);
    controls.update();
    requestRender();
  };

  // click to select a part
  const raycaster = new THREE.Raycaster();
  let downAt: [number, number] | null = null;
  const onDown = (e: PointerEvent) => { downAt = [e.clientX, e.clientY]; };
  const onUp = (e: PointerEvent) => {
    if (!downAt || Math.hypot(e.clientX - downAt[0], e.clientY - downAt[1]) > 4) return;
    const rect = o.canvas.getBoundingClientRect();
    raycaster.setFromCamera(new THREE.Vector2(((e.clientX - rect.left) / rect.width) * 2 - 1,
      -((e.clientY - rect.top) / rect.height) * 2 + 1), camera);
    const hit = raycaster.intersectObject(modelRoot, true).find((h) => h.object.visible);
    let n: THREE.Object3D | null = hit?.object ?? null;
    while (n && !nodes.has(n.name)) n = n.parent;
    engine.select(n?.name ?? null);
  };
  o.canvas.addEventListener("pointerdown", onDown);
  o.canvas.addEventListener("pointerup", onUp);

  const engine: ModelEngine = {
    async load(url) {
      const gltf = await new GLTFLoader().loadAsync(url);
      disposeChildren(modelRoot);
      nodes.clear();
      modelRoot.add(gltf.scene);
      const parts = partsFromScene(gltf.scene);
      gltf.scene.traverse((n) => { if (parts.some((p) => p.id === n.name) && typeof n.userData.group === "string") nodes.set(n.name, n); });
      applyMaterials((m) => { m.clippingPlanes = []; (m as THREE.MeshStandardMaterial).side = THREE.DoubleSide; });
      bounds = new THREE.Box3().setFromObject(gltf.scene);
      applyVisibility();
      setView("iso");
      return parts;
    },
    setGroupVisible(group, visible) {
      if (visible) hiddenGroups.delete(group); else hiddenGroups.add(group);
      applyVisibility();
    },
    select(partId) {
      selected = partId && nodes.has(partId) ? partId : null;
      applyMaterials((m, id) => {
        const std = m as THREE.MeshStandardMaterial;
        if (!std.emissive) return;
        std.emissive.setHex(id === selected ? 0x3a1c00 : 0x000000);
      });
      o.onSelect?.(selected);
    },
    setCut(bearing) {
      if (bearing === null) {
        applyMaterials((m) => { m.clippingPlanes = []; });
        return;
      }
      const a = THREE.MathUtils.degToRad(bearing);
      cutPlane.normal.set(-Math.cos(a), 0, -Math.sin(a));   // keep the half beyond the plane, looking along the bearing
      cutPlane.constant = 0;
      applyMaterials((m) => { m.clippingPlanes = [cutPlane]; });
    },
    setLevels(on) {
      disposeChildren(helpers, (c) => c.userData.kind === "level");
      if (on) {
        const r = Math.max(bounds.max.x, bounds.max.z, -bounds.min.x, -bounds.min.z) * 1.15;
        const [lr, lg, lb] = tokenRgb("line");
        const mat = new THREE.LineBasicMaterial({ color: new THREE.Color(lr / 255, lg / 255, lb / 255) });
        for (let y = Math.ceil(bounds.min.y); y <= bounds.max.y; y += 1) {
          const pts = Array.from({ length: 97 }, (_, i) => {
            const t = (i / 96) * Math.PI * 2;
            return new THREE.Vector3(r * Math.cos(t), y, r * Math.sin(t));
          });
          const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), mat);
          line.userData.kind = "level";
          helpers.add(line);
        }
      }
      requestRender();
    },
    setHeadOff(on) { headOff = on; applyVisibility(); },
    setOverlay(points) {
      disposeChildren(helpers, (c) => c.userData.kind === "overlay");
      if (points && points.length >= 3) {
        const geo = new THREE.BufferGeometry();
        geo.setAttribute("position", new THREE.BufferAttribute(points, 3));
        const [pr, pg, pb] = tokenRgb("accent");
        const cloud = new THREE.Points(geo, new THREE.PointsMaterial({ size: 2, sizeAttenuation: false,
          color: new THREE.Color(pr / 255, pg / 255, pb / 255) }));
        cloud.userData.kind = "overlay";
        helpers.add(cloud);
      }
      requestRender();
    },
    setView,
    dispose() {
      cancelAnimationFrame(raf);
      ro.disconnect();
      o.canvas.removeEventListener("pointerdown", onDown);
      o.canvas.removeEventListener("pointerup", onUp);
      controls.dispose();
      disposeChildren(modelRoot);
      disposeChildren(helpers);
      renderer.dispose();
    },
  };
  return engine;
}
```

Notes for the implementer:
- Check that the token names passed to `tokenRgb` (`bg`, `line`, `accent`) exist in `src/index.css`. If they don't, use the nearest ones that do.
- GLTFLoader maps glTF node `extras` to `object.userData`, so `partsFromScene` reads them directly.

- [ ] **Step 4: Implement `ModelViewer.tsx`**

Copy `CloudViewer.tsx`'s structure:
- `forwardRef`, a `useEffect` keyed on `[glbUrl, generation]` that calls `createModelEngine`, then `load(glbUrl)`, then `onParts`;
- `ViewState` handling, with the notices as `<Alert>` at `z-[15]` on `bg-glass-solid`;
- `useImperativeHandle` forwarding every engine method except `load`/`dispose`.

Copy:
- no-webgl: "This computer can't start WebGL, so the 3D view is off. The parts list still works."
- load-error: "The 3D model could not load." with a **Reload view** button that bumps `generation`.
- While loading, show a centred `Skeleton`.

`src/test/fakeModelViewer.tsx`: copy `fakeCloudViewer.tsx`'s pattern. It records calls, exposes `emitParts(parts)` and `emitSelect(id)`, and renders `<div data-testid="fake-model-viewer" />`.

- [ ] **Step 5: Run the tests to verify they pass**

Run: `pnpm -C frontend test -- src/assetmodels/viewer; pnpm -C frontend lint`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add frontend/src/assetmodels/viewer/engine.ts frontend/src/assetmodels/viewer/engine.test.ts frontend/src/assetmodels/viewer/ModelViewer.tsx frontend/src/assetmodels/viewer/ModelViewer.test.tsx frontend/src/test/fakeModelViewer.tsx
git commit -m "feat(asset-models): GLB viewer engine with cut, levels, head-off and overlay

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Pure logic — groups, part edits, spec diff

**Files:**
- Create: `frontend/src/assetmodels/groups.ts`, `partEdit.ts`, `specDiff.ts`
- Test: `frontend/src/assetmodels/partEdit.test.ts`, `frontend/src/assetmodels/specDiff.test.ts`, `frontend/src/assetmodels/groups.test.ts`

**Interfaces:**

```ts
// groups.ts
export const GROUP_ORDER = ["Shell", "Head", "Bottom", "Nozzle", "Manway", "Support", "Access", "Internal", "Lining", "Other"] as const;
export function groupParts<T extends { group: string }>(parts: T[]): [string, T[]][];  // in GROUP_ORDER, empty groups dropped

// partEdit.ts
export type FieldValue = number | string | boolean | null;
export function numericParams(part: AssetPart): { key: string; value: number }[];   // top-level numeric params, in spec order
export function withParam(spec: AssetSpec, partId: string, key: string, value: number): AssetSpec;   // immutable
export function withPlacement(spec: AssetSpec, partId: string, key: "bearing_deg" | "elevation_mm" | "e_mm" | "n_mm", value: number): AssetSpec;
export function withNote(spec: AssetSpec, partId: string, note: string): AssetSpec;
export function editNote(part: AssetPart, key: string, before: number, after: number): string;  // "N7: projection 200 → 250 mm"

// specDiff.ts
export interface SpecDiff { added: string[]; removed: string[]; changed: { id: string; fields: string[] }[] }
export function diffSpecs(a: AssetSpec, b: AssetSpec): SpecDiff;
```

- [ ] **Step 1: Write the failing tests**

```ts
// src/assetmodels/specDiff.test.ts
import { describe, expect, it } from "vitest";
import { diffSpecs } from "./specDiff";

const part = (id: string, height = 3000) => ({ id, name: id, group: "Shell", shape: "cylinder",
  params: { id: 4000, thickness: 8, height }, source: { kind: "assumed" } }) as const;

describe("diffSpecs", () => {
  it("finds added, removed and changed parts with the changed fields", () => {
    const a = { parts: [part("s1"), part("s2")] };
    const b = { parts: [part("s1", 3500), part("s3")] };
    expect(diffSpecs(a as never, b as never)).toEqual({
      added: ["s3"], removed: ["s2"], changed: [{ id: "s1", fields: ["params.height"] }],
    });
  });

  it("is empty for equal specs", () => {
    const a = { parts: [part("s1")] };
    expect(diffSpecs(a as never, a as never)).toEqual({ added: [], removed: [], changed: [] });
  });
});
```

```ts
// src/assetmodels/partEdit.test.ts
import { describe, expect, it } from "vitest";
import { editNote, numericParams, withParam, withPlacement } from "./partEdit";

const spec = { parts: [{ id: "N7", name: "N7", group: "Nozzle", shape: "nozzle",
  params: { dn: 80, od: 88.9, projection: 200, flange_od: 200, flange_t: 20, blind: false },
  placement: { host: "shell", bearing_deg: 270, elevation_mm: 7780 }, source: { kind: "drawing", id: "d" } }] };

describe("part edits", () => {
  it("lists numeric params only, in order", () => {
    expect(numericParams(spec.parts[0] as never).map((p) => p.key)).toEqual(["dn", "od", "projection", "flange_od", "flange_t"]);
  });

  it("edits immutably", () => {
    const next = withParam(spec as never, "N7", "projection", 250);
    expect(next.parts![0].params.projection).toBe(250);
    expect(spec.parts[0].params.projection).toBe(200);
    expect(withPlacement(spec as never, "N7", "bearing_deg", 90).parts![0].placement!.bearing_deg).toBe(90);
  });

  it("writes a readable version note", () => {
    expect(editNote(spec.parts[0] as never, "projection", 200, 250)).toBe("N7: projection 200 → 250 mm");
    expect(editNote(spec.parts[0] as never, "bearing_deg", 270, 90)).toBe("N7: bearing 270 → 90°");
  });
});
```

`groups.test.ts`: `groupParts([{group:"Nozzle"},{group:"Shell"}])` returns `[["Shell",[…]],["Nozzle",[…]]]`.

- [ ] **Step 2: Run them to verify they fail**

Run: `pnpm -C frontend test -- src/assetmodels/partEdit.test.ts src/assetmodels/specDiff.test.ts src/assetmodels/groups.test.ts`
Expected: FAIL (the modules don't exist)

- [ ] **Step 3: Implement**

```ts
// src/assetmodels/groups.ts
export const GROUP_ORDER = ["Shell", "Head", "Bottom", "Nozzle", "Manway", "Support", "Access", "Internal", "Lining", "Other"] as const;

export function groupParts<T extends { group: string }>(parts: T[]): [string, T[]][] {
  const by = new Map<string, T[]>();
  for (const p of parts) by.set(p.group, [...(by.get(p.group) ?? []), p]);
  const known = GROUP_ORDER.filter((g) => by.has(g)).map((g) => [g, by.get(g)!] as [string, T[]]);
  const other = [...by.keys()].filter((g) => !(GROUP_ORDER as readonly string[]).includes(g)).sort();
  return [...known, ...other.map((g) => [g, by.get(g)!] as [string, T[]])];
}
```

```ts
// src/assetmodels/partEdit.ts
import type { AssetPart, AssetSpec } from "@contract/client";

export function numericParams(part: AssetPart): { key: string; value: number }[] {
  return Object.entries(part.params).filter(([, v]) => typeof v === "number").map(([key, value]) => ({ key, value: value as number }));
}

function mapPart(spec: AssetSpec, partId: string, fn: (p: AssetPart) => AssetPart): AssetSpec {
  return { ...spec, parts: (spec.parts ?? []).map((p) => (p.id === partId ? fn(p) : p)) };
}

export function withParam(spec: AssetSpec, partId: string, key: string, value: number): AssetSpec {
  return mapPart(spec, partId, (p) => ({ ...p, params: { ...p.params, [key]: value } }));
}

export function withPlacement(spec: AssetSpec, partId: string, key: "bearing_deg" | "elevation_mm" | "e_mm" | "n_mm", value: number): AssetSpec {
  return mapPart(spec, partId, (p) => ({ ...p, placement: { ...(p.placement ?? {}), [key]: value } }));
}

export function withNote(spec: AssetSpec, partId: string, note: string): AssetSpec {
  return mapPart(spec, partId, (p) => ({ ...p, note: note || null }));
}

export function editNote(part: AssetPart, key: string, before: number, after: number): string {
  const deg = key.endsWith("_deg");
  const label = key.replace(/_deg$|_mm$/, "").replace(/_/g, " ");
  return `${part.id}: ${label} ${before} → ${after}${deg ? "°" : " mm"}`;
}
```

```ts
// src/assetmodels/specDiff.ts
import type { AssetPart, AssetSpec } from "@contract/client";

export interface SpecDiff { added: string[]; removed: string[]; changed: { id: string; fields: string[] }[] }

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

function changedFields(a: AssetPart, b: AssetPart): string[] {
  const out: string[] = [];
  for (const key of ["name", "group", "shape", "material", "confidence", "note", "source"] as const) {
    if (!same(a[key], b[key])) out.push(key);
  }
  for (const nested of ["params", "placement"] as const) {
    const x = (a[nested] ?? {}) as Record<string, unknown>;
    const y = (b[nested] ?? {}) as Record<string, unknown>;
    for (const k of [...new Set([...Object.keys(x), ...Object.keys(y)])].sort()) {
      if (!same(x[k], y[k])) out.push(`${nested}.${k}`);
    }
  }
  return out;
}

export function diffSpecs(a: AssetSpec, b: AssetSpec): SpecDiff {
  const A = new Map((a.parts ?? []).map((p) => [p.id, p]));
  const B = new Map((b.parts ?? []).map((p) => [p.id, p]));
  const changed = [...A.keys()].filter((id) => B.has(id))
    .map((id) => ({ id, fields: changedFields(A.get(id)!, B.get(id)!) }))
    .filter((c) => c.fields.length > 0);
  return { added: [...B.keys()].filter((id) => !A.has(id)), removed: [...A.keys()].filter((id) => !B.has(id)), changed };
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm -C frontend test -- src/assetmodels/partEdit.test.ts src/assetmodels/specDiff.test.ts src/assetmodels/groups.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add frontend/src/assetmodels/groups.ts frontend/src/assetmodels/groups.test.ts frontend/src/assetmodels/partEdit.ts frontend/src/assetmodels/partEdit.test.ts frontend/src/assetmodels/specDiff.ts frontend/src/assetmodels/specDiff.test.ts
git commit -m "feat(asset-models): part edit, grouping and spec diff helpers

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: The workspace — panels, tabs, edit, download

**Files:**
- Create: `frontend/src/assetmodels/workspace/AssetModelWorkspace.tsx` (states and layout)
- Create: `frontend/src/assetmodels/workspace/ModelPanel.tsx` (picker, group toggles, overlay switch)
- Create: `frontend/src/assetmodels/workspace/ViewTools.tsx` (palette: orbit, cut + bearing slider, levels, head off, fit, view presets)
- Create: `frontend/src/assetmodels/workspace/ModelInspector.tsx` (tabs: Parts, Part, Versions; a `runTab` slot prop for U7)
- Create: `frontend/src/assetmodels/workspace/PartsTab.tsx`, `PartTab.tsx`, `VersionsTab.tsx`
- Create: `frontend/src/assetmodels/workspace/NewModelDialog.tsx`
- Create: `frontend/src/assetmodels/workspace/download.ts` (GLB via `assetModelGlbUrl`; spec as a JSON blob)
- Modify: `frontend/src/ui/keymap.ts` (`WorkspaceScope` += `"models"`, `WORKSPACE_KEYS.models`: `C` cut, `L` levels, `U` head off, `Alt+1..4` views; `F` fit is global)
- Test: `frontend/src/assetmodels/workspace/AssetModelWorkspace.test.tsx`, `frontend/src/ui/keymap.test.tsx` (still green: no collisions)
- Test fixtures: `frontend/src/test/assetModelFixtures.ts` (a model, two versions with specs, a run)

**Interfaces:**
- Consumes: Tasks 1–3.
- Produces:
  - `AssetModelWorkspace` (default view of the `models` route), with `data-testid="model-workspace"`
  - `ModelInspector` props: `{ tab, onTab, partsTab, partTab, versionsTab, runTab?: React.ReactNode }`, so U7 passes its Run tab in
  - a bottom slot `<div data-testid="model-build-slot" />` where U7 mounts the Build bar

Layout (geometry from `src/clouds/workspace/layout.ts`):

| Element | Placement | Notes |
| --- | --- | --- |
| `ModelViewer` | `absolute inset-0` in `relative flex h-full` | z 0 |
| `ViewTools` | `left-3.5 top-3.5`, vertical, 38 px buttons | `GlassPanel variant="float"` |
| `ModelPanel` | `left-[72px] top-3.5 w-[282px]` | Picker row (`Popover` listing models: name · tag · v<n> · status pill; footer "New asset model…"), `Switch` per group present, "Show scan overlay" `Switch` (enabled only when the latest run of this version has a `comparison`) |
| `ModelInspector` | `right-3.5 top-3.5 bottom-[84px] w-[330px]`, `as="aside"` | `Tabs` Parts *n* · Part · Versions *n* · (Run, from U7) |
| Actions | `right-[358px] top-3.5` | `MenuButton` "Download": "3D model (GLB)", "Spec (JSON)" |
| Build slot | `bottom-3.5 left-[72px] right-[358px]` | empty in U6 |

States:
- No models: `EmptyState` (icon `cube`) "Build a 3D model of the asset from its drawings, scans and photos", with the action "New asset model…".
- A model with no version: a centred glass card, "No version yet". U7 replaces this with the run progress card while a run is live.
- A version whose `glb_status` is `pending`: viewer notice "Building the 3D model…", polled with `useTrackedJob` on the version's GLB job (from `createVersion`'s job, or by reloading on `asset_model_glb` finishing).
- `failed`: a notice "The 3D model could not be built." The Parts tab still works from the spec.

Scan overlay:
- When "Show scan overlay" is switched on, the workspace takes the latest run whose `version` equals the shown version and whose `comparison` is set.
- It fetches `assetModelOverlayUrl(baseUrl, token, projectId, modelId, run.id, comparison.cloud_id)` with `fetch(...).then(r => r.status === 204 ? null : r.arrayBuffer())`, wraps the buffer as `new Float32Array(buf)`, and passes it to `viewer.current?.setOverlay(...)`.
- Switching it off calls `setOverlay(null)`.
- The buffer is at most 300 000 points (3.6 MB). It's fetched once per run and kept in a ref.

Part tab:
- Shows `name`, `group · shape`, numeric params as `Input type="number"` with units, placement (bearing/elevation or e/n when hosted), and the source line. "Drawing · region": a link that opens the drawing in the Maps workspace with `?sel=drawing:<id>`, which is enough for M1. "Assumed" is shown with the warn tone.
- Shows confidence as a `Pill`, and deviation from the run's `comparison` when present ("median 4.2 mm · p95 9.8 mm").
- **Save as new version** (enabled when something changed) calls `createVersion(spec', editNote(...))`, then toasts "Saved version n" and selects the new version. A 422 shows the `details.errors` messages inline under the form.

Versions tab:
- Rows are "v3 · manual · Restored from version 1 · 2 min ago". The current version is marked.
- **Restore** calls `restoreVersion`.
- **Compare** with checkboxes: picking two shows `diffSpecs` in a list (Added, Removed, Changed with field names).

Downloads:
- GLB: `a.href = assetModelGlbUrl(baseUrl, token, projectId, modelId, version)` with `download="<name>-v<n>.glb"`.
- Spec: `new Blob([JSON.stringify(detail.spec, null, 2)], {type: "application/json"})` and an object URL, `download="<name>-v<n>.json"`.
- In the Tauri shell, use the existing download/save helper if the app has one (grep `download=` in `src/`). Otherwise the anchor approach is what the reports page uses.

- [ ] **Step 1: Write the failing workspace tests**

```tsx
// src/assetmodels/workspace/AssetModelWorkspace.test.tsx
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderWithProviders } from "@/test/render";
import { fakeClient, PROJECT_ID } from "@/test/fixtures";
import { MODEL, SPEC_V1, SPEC_V2, VERSION_1, VERSION_2 } from "@/test/assetModelFixtures";

vi.mock("@/assetmodels/viewer/ModelViewer", async () => ({ ModelViewer: (await import("@/test/fakeModelViewer")).FakeModelViewer }));
import { emitParts, resetFake } from "@/test/fakeModelViewer";
import { AssetModelWorkspace } from "./AssetModelWorkspace";

const routes = (extra: unknown[] = []) => [
  { method: "GET", path: /\/asset-models$/, body: { items: [MODEL] } },
  { method: "GET", path: /\/asset-models\/m1$/, body: MODEL },
  { method: "GET", path: /\/asset-models\/m1\/versions$/, body: { items: [VERSION_2, VERSION_1] } },
  { method: "GET", path: /\/versions\/2$/, body: { ...VERSION_2, spec: SPEC_V2, warnings: [] } },
  { method: "GET", path: /\/versions\/1$/, body: { ...VERSION_1, spec: SPEC_V1, warnings: [] } },
  { method: "GET", path: /\/asset-models\/m1\/runs$/, body: { items: [] } },
  ...extra,
];

describe("AssetModelWorkspace", () => {
  beforeEach(() => resetFake());

  it("shows the empty state when there are no models", async () => {
    const { api } = fakeClient([{ method: "GET", path: /\/asset-models$/, body: { items: [] } }]);
    renderWithProviders(<AssetModelWorkspace />, { api, route: `/p/${PROJECT_ID}/models`, path: "/p/:projectId/models" });
    expect(await screen.findByText(/build a 3d model of the asset/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /new asset model/i })).toBeInTheDocument();
  });

  it("lists parts by group and selects one", async () => {
    const { api } = fakeClient(routes() as never);
    renderWithProviders(<AssetModelWorkspace />, { api, route: `/p/${PROJECT_ID}/models/m1`, path: "/p/:projectId/models/:modelId" });
    await screen.findByTestId("model-workspace");
    emitParts([{ id: "shell", name: "Shell", group: "Shell" }, { id: "N7", name: "Nozzle N7", group: "Nozzle" }]);
    const parts = await screen.findByRole("tabpanel", { name: /parts/i });
    fireEvent.click(within(parts).getByRole("button", { name: /nozzle n7/i }));
    expect(await screen.findByRole("tabpanel", { name: /part/i })).toHaveTextContent(/projection/i);
  });

  it("saving an edit posts a new version with a readable note", async () => {
    const { api, requests } = fakeClient(routes([{ method: "POST", path: /\/asset-models\/m1\/versions$/, status: 201,
      body: { version: { ...VERSION_2, version: 3, kind: "manual" }, job: { id: "j3", type: "asset_model_glb", state: "queued" } } }]) as never);
    renderWithProviders(<AssetModelWorkspace />, { api, route: `/p/${PROJECT_ID}/models/m1`, path: "/p/:projectId/models/:modelId" });
    await screen.findByTestId("model-workspace");
    emitParts([{ id: "N7", name: "Nozzle N7", group: "Nozzle" }]);
    fireEvent.click(await screen.findByRole("button", { name: /nozzle n7/i }));
    const input = await screen.findByLabelText(/projection/i);
    fireEvent.change(input, { target: { value: "250" } });
    fireEvent.click(screen.getByRole("button", { name: /save as new version/i }));
    await waitFor(() => expect(requests.some((r) => r.method === "POST")).toBe(true));
    const body = JSON.parse(String(requests.find((r) => r.method === "POST")!.body));
    expect(body.note).toBe("N7: projection 200 → 250 mm");
    expect(body.spec.parts.find((p: { id: string }) => p.id === "N7").params.projection).toBe(250);
  });

  it("an invalid edit shows the server's errors inline", async () => {
    const { api } = fakeClient(routes([{ method: "POST", path: /\/versions$/, status: 422,
      body: { error: { code: "invalid_spec", message: "The model spec has errors.",
        details: { errors: [{ code: "bad_geometry", part_id: "N7", message: "the flange must be thinner than the projection" }] } } } }]) as never);
    renderWithProviders(<AssetModelWorkspace />, { api, route: `/p/${PROJECT_ID}/models/m1`, path: "/p/:projectId/models/:modelId" });
    await screen.findByTestId("model-workspace");
    emitParts([{ id: "N7", name: "Nozzle N7", group: "Nozzle" }]);
    fireEvent.click(await screen.findByRole("button", { name: /nozzle n7/i }));
    fireEvent.change(await screen.findByLabelText(/projection/i), { target: { value: "10" } });
    fireEvent.click(screen.getByRole("button", { name: /save as new version/i }));
    expect(await screen.findByText(/flange must be thinner/i)).toBeInTheDocument();
  });

  it("compares two versions", async () => {
    const { api } = fakeClient(routes() as never);
    renderWithProviders(<AssetModelWorkspace />, { api, route: `/p/${PROJECT_ID}/models/m1`, path: "/p/:projectId/models/:modelId" });
    await screen.findByTestId("model-workspace");
    fireEvent.click(screen.getByRole("tab", { name: /versions/i }));
    fireEvent.click(await screen.findByRole("checkbox", { name: /compare v1/i }));
    fireEvent.click(screen.getByRole("checkbox", { name: /compare v2/i }));
    expect(await screen.findByText(/changed/i)).toBeInTheDocument();
  });

  it("group switch hides the group in the viewer", async () => {
    const { api } = fakeClient(routes() as never);
    renderWithProviders(<AssetModelWorkspace />, { api, route: `/p/${PROJECT_ID}/models/m1`, path: "/p/:projectId/models/:modelId" });
    await screen.findByTestId("model-workspace");
    emitParts([{ id: "N7", name: "Nozzle N7", group: "Nozzle" }]);
    fireEvent.click(await screen.findByRole("switch", { name: /nozzle/i }));
    const { callsTo } = await import("@/test/fakeModelViewer");
    expect(callsTo("setGroupVisible")).toContainEqual(["Nozzle", false]);
  });
});
```

`assetModelFixtures.ts`:
- `MODEL` is `{ id: "m1", status: "ready", current_version: 2, … }`.
- `SPEC_V1` has `shell` + `N7` with projection 200.
- `SPEC_V2` is the same with the shell `height` changed.
- `VERSION_1`/`VERSION_2` are the matching version rows (`glb_status: "ready"`).

- [ ] **Step 2: Run them to verify they fail**

Run: `pnpm -C frontend test -- src/assetmodels/workspace`
Expected: FAIL

- [ ] **Step 3: Implement the components to the layout and states above.** Keep each file to one panel. Use only `src/ui/` primitives and tokens: `pnpm -C frontend lint` (check-tokens) must pass. Animate panels in with `stagger(i)` and `animate-reveal reduce-motion:animate-none`, as `CloudPanel` does.

- [ ] **Step 4: Run the tests, lint and build**

Run: `pnpm -C frontend test -- src/assetmodels src/ui/keymap.test.tsx; pnpm -C frontend lint; pnpm -C frontend build`
Expected: PASS, clean

- [ ] **Step 5: Look at it.** Run `pnpm -C frontend dev` with the Prism mock (`pnpm -C contract mock`) and open `/p/<id>/models/<id>`. Use the Playwright MCP or Claude in Chrome to screenshot it at 1366×768 and 1920×1080. Check it against `DESIGN.md`:
- the panels don't overlap;
- the inspector scrolls;
- there's no raw colour;
- the empty and pending states read well.

Fix anything off before committing.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/assetmodels/workspace frontend/src/ui/keymap.ts frontend/src/test/assetModelFixtures.ts
git commit -m "feat(asset-models): workspace with parts, part edit, versions and downloads

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: e2e — view and edit against the Prism mock

**Files:**
- Create: `frontend/e2e/fixtures/asset-model.glb` (generated once from the backend builder, committed; < 200 KB)
- Create: `frontend/e2e/fixtures/assetModels.ts` (`page.route` JSON fixtures, using `jsonRoute` from `e2e/fixtures/clouds.ts`)
- Create: `frontend/e2e/models-workspace.spec.ts`

- [ ] **Step 1: Generate the GLB fixture**

```powershell
cd backend
& $PY -c "from pathlib import Path; from app.asset_models.build import build_glb; from app.asset_models.spec import AssetSpec; import json; spec = AssetSpec.model_validate({'parts': [{'id':'shell','name':'Shell','group':'Shell','shape':'cylinder','params':{'id':4000,'thickness':8,'height':8000},'source':{'kind':'assumed'}}, {'id':'N7','name':'Nozzle N7','group':'Nozzle','shape':'nozzle','params':{'dn':80,'od':88.9,'projection':200,'flange_od':200,'flange_t':20},'placement':{'host':'shell','bearing_deg':270,'elevation_mm':7780},'source':{'kind':'assumed'}}]}); Path('../frontend/e2e/fixtures/asset-model.glb').write_bytes(build_glb(spec)[0])"
```

- [ ] **Step 2: Write the spec**

```ts
// e2e/models-workspace.spec.ts
import { expect, test } from "@playwright/test";
import { routeAssetModels } from "./fixtures/assetModels";

test.use({ launchOptions: { args: ["--use-angle=swiftshader-webgl", "--enable-unsafe-swiftshader"] } });

test("open the asset models tab, see the parts, edit one into a new version", async ({ page }) => {
  const posted = await routeAssetModels(page);   // serves MODEL, versions, spec and asset-model.glb; records POSTs
  await page.goto("/p/p1/models/m1");
  await expect(page.getByTestId("model-workspace")).toBeVisible();
  await expect(page.getByRole("button", { name: /nozzle n7/i })).toBeVisible();   // parts came from the GLB extras
  await page.getByRole("button", { name: /nozzle n7/i }).click();
  await page.getByLabel(/projection/i).fill("250");
  await page.getByRole("button", { name: /save as new version/i }).click();
  await expect(page.getByText(/saved version 3/i)).toBeVisible();
  expect(posted.versions[0].note).toBe("N7: projection 200 → 250 mm");
});

test("no WebGL: the parts list still works", async ({ browser }) => {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await page.addInitScript(() => { HTMLCanvasElement.prototype.getContext = () => null; });
  await routeAssetModels(page);
  await page.goto("/p/p1/models/m1");
  await expect(page.getByRole("alert")).toContainText(/3D view is off/i);
  await expect(page.getByRole("tab", { name: /parts/i })).toBeVisible();
  await ctx.close();
});
```

With no WebGL, the parts list can't come from the GLB. So when the viewer is in `no-webgl`, the Parts tab reads parts from the version's spec. Make the workspace do that (`parts = viewerParts ?? spec.parts.map(...)`). This also covers a `failed` GLB.

- [ ] **Step 3: Run it**

Run: `pnpm -C frontend e2e -- models-workspace.spec.ts`
Expected: PASS

- [ ] **Step 4: Commit, gate, merge**

```bash
git add frontend/e2e/fixtures/asset-model.glb frontend/e2e/fixtures/assetModels.ts frontend/e2e/models-workspace.spec.ts frontend/src/assetmodels/workspace/AssetModelWorkspace.tsx
git commit -m "test(asset-models): e2e for viewing and editing a model

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

Run `scripts\finish-task.ps1`, or the manual fallback.
