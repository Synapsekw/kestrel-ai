# S2: Annotation UI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the four annotation screens of the desktop app (Data Manager, labeling editor, review queue, project settings) on top of the S0 frontend shell, against the Prism mock server, so that every edit is persisted through the contract API immediately and every screen has Vitest and Playwright coverage.

**Architecture:** The screens are thin compositions of focused modules under `frontend/src`: pure helpers (geometry, hotkey map, list model, selection) tested with Vitest; zustand stores for editor, event-driven refresh and navigation context; API wrappers that take the generated `openapi-fetch` client explicitly so they are testable with a fake `fetch`; React components (Tailwind only) for the Data Manager and settings; and a Konva stage (react-konva) whose world coordinates are image pixels so that display-to-image conversion is one affine transform. Undo/redo is a per-image stack of compensating API calls, never client-only state.

**Tech Stack:** React 18, TypeScript 5, Vite 6, Tailwind 3, react-router 6, zustand 5, Konva 9 via react-konva 18, `openapi-fetch` through `@contract/client`, Vitest 3 + Testing Library (jsdom), Playwright 1 against Stoplight Prism 5 (mock server).

**Spec:** `docs/superpowers/specs/2026-09-17-machinery-detection-app-design.md` section 6 (owned entirely), plus sections 2 (locked decisions), 3, 4, 9, 11, 12 and 13. Contract: `contract/openapi.yaml` (source of truth) and its generated wrapper `contract/client/index.ts`. Existing shell to build on: `frontend/src/**` (S0). Label Studio is the UX blueprint for interaction details (spec section 6); no Label Studio code and never its name in product strings.

## Global Constraints

- Locked (spec section 2): React 18, TypeScript, Vite, Konva via react-konva for the canvas, Tailwind only (no component library), the generated client via `@contract/client`. zustand 5 is available and used for stores. No new runtime dependencies; everything needed is already in `frontend/package.json`. Nothing installed system-wide.
- The contract is the source of truth and S2 must not change it. If a change seems necessary, note it under "Contract gaps found" at the end of this plan and work around it within the contract. Every path carries `/api/v1`.
- Every request goes through the client from `useApi()` (`frontend/src/api/client.tsx`). Images load through `imageFileUrl(baseUrl, token, projectId, imageId, maxSide)` and `thumbnailUrl(baseUrl, token, projectId, imageId)` from `@contract/client` because `<img>` and Konva cannot send headers; `baseUrl` and `token` come from `useBackend()`.
- Wave 1 development runs against the Prism mock server (`pnpm --dir ../contract mock`, port 4010). It returns the schema examples: one project "Ahmadia" (id `7f1c2e3a-1111-4000-8000-000000000001`, eight classes with hotkeys 1 to 8, `preannotation_model_id` set), two example images, two example boxes (one accepted person box, one unreviewed model proposal), the same example for every id, and it does not persist POSTs. See "Mock server limitations" below before writing any test.
- Testing (spec section 12): Vitest for state, geometry and API wrappers (fake `fetch`, never the network); Testing Library for non-Konva components; one Playwright spec per screen against the mock that asserts on UI state and on the requests made (`page.waitForRequest`, `request.postDataJSON()`), never on persistence. Konva cannot render in jsdom (no canvas), so Konva components are covered by Playwright only. TDD in every task: failing test first, run it, implement, run again, commit.
- Every edit becomes a Box row via the API immediately (`POST .../images/{id}/boxes`, `PATCH .../boxes/{id}`, `DELETE .../boxes/{id}`, `POST .../boxes/review`); no client-only state that could be lost. Box coordinates are image pixels (`x, y` top-left, `w, h`); the canvas shows a downscaled JPEG (`max_side`), so the stage's world coordinate system is image pixels and the bitmap is drawn stretched to `Image.width x Image.height`.
- Pre-annotation on open: when the editor opens an image with no unreviewed proposals and the project has a `preannotation_model_id`, call `POST .../images/{imageId}/preannotate` with no body; tolerate 501 `not_implemented` (stub until S4) by showing a one-line notice, never an error dialog.
- Hotkey conflict resolved (spec section 6 lists both "1:1 (1)" and "class hotkeys 1 to 9"): keys `1` to `9` select classes by the class's configured `hotkey`; `0` and `Ctrl+1` set 1:1 zoom; `F` fits. This choice is shown in the toolbar tooltips.
- Websocket events (`AppEvent` types `job.progress`, `job.state`, `images.changed`, `boxes.changed`) already flow through `connectEvents` in `App.tsx` into `useJobsStore.applyEvent`; S2 adds `useChangesStore.applyEvent` so that `images.changed` refreshes the Data Manager and `boxes.changed` refreshes the open image when it is affected.
- Product name "Machinery Detection". No secrets in files. Ports: Vite 1420, mock 4010. Never write to anything under `E:\Dev\Yolo` outside `E:\Dev\Yolo\app`.
- Files stay focused and named by responsibility (file structure below). zustand 5 selectors must return stable references: select primitive fields or use `useShallow` from `zustand/react/shallow`; derive arrays with `useMemo`.
- The ESLint config enables the React Compiler rules of `eslint-plugin-react-hooks` 7 as errors (`set-state-in-effect`, `set-state-in-render`, `refs`, `immutability`, `purity`, `preserve-manual-memoization`). Consequences for every component and hook in this plan: never call a `useState` setter synchronously inside a `useEffect` body (setters inside `.then`, timers, event callbacks and `ResizeObserver` callbacks are fine); derive values during render or reset local state with a `key` prop instead; never read or write `ref.current` during render; never list a dependency in `useMemo`/`useCallback` that the callback does not use. `react-refresh/only-export-components` and `exhaustive-deps` are warnings and do not fail `pnpm lint`; keep component files free of non-component exports except constants.
- Lint is `pnpm lint` (eslint + prettier check); run `pnpm format` before every commit. All commands in this plan run from `frontend/` inside your worktree (`.worktrees/s2-annotation-ui/frontend`, branch `s2-annotation-ui`). Commit messages use the `feat(ui):`, `test(ui):`, `chore(ui):` prefixes.
- Files S2 may modify outside its own new modules: `src/App.tsx` (event handler only), `src/api/client.tsx` (export the context for tests only), `src/app/Shell.tsx` (editor route padding only), `src/screens/{DataManager,Editor,Review,Settings}Screen.tsx`. Models, Train and Query screens belong to S5: leave them.

## Interfaces from S0 you build on (read these files first)

- `contract/client/index.ts`: `createApiClient({baseUrl, token, fetch?})`, `ApiClient`, `eventsUrl`, `imageFileUrl(baseUrl, token, projectId, imageId, maxSide?)`, `thumbnailUrl(baseUrl, token, projectId, imageId)`, type aliases `Project`, `ClassDef`, `ClassDefInput`, `ImportSettings`, `Source`, `Image`, `ImagePage`, `Box`, `BoxCreate`, `BoxUpdate`, `ReviewState`, `Model`, `Job`, `AppEvent`, `ApiError`, and `paths`/`components` for query types. The client's methods are `api.GET(path, {params: {path, query}})`, `api.POST(path, {params, body})`, `api.PATCH`, `api.PUT`, `api.DELETE`; each resolves to `{data, error, response}`.
- `src/api/client.tsx`: `useApi(): ApiClient`, `useBackend(): {baseUrl, token, mode}`, `ApiProvider`.
- `src/api/events.ts`: `connectEvents(url, onEvent)`; `src/App.tsx` `EventsBridge` wires it.
- `src/store/jobs.ts`: `useJobsStore` with `upsert(job)`, `applyEvent(ev)`, `active()`.
- `src/app/diagnostics.ts`: `pushLog(line)`.
- `src/app/Shell.tsx`: sidebar nav and `<main className="min-h-0 flex-1 overflow-auto p-6">` around `<Outlet />`.
- `src/routes.tsx`: `/p/:projectId/data`, `/p/:projectId/edit/:imageId`, `/p/:projectId/review`, `/p/:projectId/settings`.
- `src/screens/ProjectsScreen.tsx`: the finished screen; copy its input and button classes for visual consistency.

## File structure

```
frontend/src/
  api/
    client.tsx            (modify) export ApiContext and ApiContextValue for tests
    errors.ts             ApiFailure, messageOf, codeOf, isNotImplemented, unwrap (data-or-throw over openapi-fetch results)
    project.ts            fetchProject, saveClasses, patchProject, fetchModels, fetchSources, useProject, useSourceNames
    images.ts             ListImagesQuery, fetchImagePage, fetchImage, bulkDeleteImages, preannotateImage, REVIEW_QUEUE_QUERY
    boxes.ts              fetchBoxes, createBox, updateBox, deleteBox, reviewBoxes
  store/
    editor.ts             useEditorStore: image, boxes, selection, view transform, draft, pending counter; selectors; waitForIdle
    changes.ts            useChangesStore: revision counters bumped by images.changed / boxes.changed events
    navigation.ts         useNavigationStore: ordered image ids the editor's next/previous walk
  editor/
    geometry.ts           display<->image conversion, fit, 1:1, zoom-around, rect normalise/clamp/round, duplicate offset
    hotkeys.ts            key event -> EditorAction map, isTypingTarget, HOTKEY_HELP
    history.ts            History (undo/redo stacks of Command {undo, redo}), BoxRef
    commands.ts           API-backed commands with compensating undo: create, move/resize, reclassify, delete, duplicate, review
    labels.ts             colourOf, nameOf (class lookups) and provenanceLabel (badge text); plain helpers kept out of component files
    useKonvaImage.ts      load an HTMLImageElement from a URL, null on failure
    EditorCanvas.tsx      Konva Stage: bitmap or placeholder, wheel zoom, space-drag pan, viewport measuring, data-view-* attributes
    BoxLayer.tsx          Konva boxes: dashed proposals, selection, drag move, Transformer resize, draft rectangle, labels
    RegionList.tsx        right panel: per-box class select, confidence, provenance badge, review state, accept/reject/delete
    ClassSidebar.tsx      left panel: colour swatches, names, hotkeys, active class
    EditorToolbar.tsx     prev/next, position, fit, 1:1, zoom %, undo/redo, accept all, reject all, show rejected, status
    useEditorImage.ts     load image + boxes into the store, pre-annotate on open, reload on boxes.changed
    useHistory.ts         one History per image with a version counter for re-render
    useEditorActions.ts   binds commands.ts to the store/history/api for the screen
    useEditorHotkeys.ts   document key listener dispatching EditorActions
    useEditorNavigation.ts next/previous with flush (auto-save) and navigation context fallback
  data/
    listModel.ts          ImageFilters, ListQuery, SortKey, columns, toImageParams, applyClientFilters, toggleSort, keyboardAction
    selection.ts          pure multi-select: clickSelect (shift/ctrl), toggleSelect, selectAll, clearSelection, pruneSelection
    useVirtualRows.ts     computeWindow (pure) and useVirtualRows (scroll + ResizeObserver) for list and grid virtualisation
    useImageList.ts       cursor-paginated image loading with reload on images.changed
    bulkActions.ts        runModelOnImages, addImagesToDataset, deleteImages
    FilterBar.tsx         search, source, group, labeled, pending, min boxes, capture range, view toggle
    ImageTable.tsx        virtualised list view with sortable column headers, checkboxes, focus row
    ImageGrid.tsx         virtualised thumbnail grid
    SelectionBar.tsx      bulk actions for the selection (label, run model, add to dataset, delete)
  settings/
    ClassesSection.tsx    class table (add, rename, recolour, rehotkey, reorder, remove) -> PUT classes; 409 class_in_use explained
    PreannotationSection.tsx  model select from GET models (501 tolerated) -> PATCH project
    ImportDefaultsSection.tsx import defaults form -> PATCH project
    ProvidersPlaceholder.tsx  static placeholder (S5 owns provider keys)
  screens/
    DataManagerScreen.tsx (replace) composition of data/*
    EditorScreen.tsx      (replace) composition of editor/*
    ReviewScreen.tsx      (replace) review queue over ImageTable with the fixed queue query
    SettingsScreen.tsx    (replace) the four settings sections
  test/
    fixtures.ts           contract examples as typed constants, fakeFetch/fakeClient recording requests
    render.tsx            TestApiProvider and renderWithProviders (router + api context)
frontend/e2e/
  data-manager.spec.ts  editor.spec.ts  review.spec.ts  settings.spec.ts
```

## Mock server limitations (verified against Prism 5.16 on 2026-09-18)

- Same example for every id: `GET /images/{id}` always returns image `10000000-5555-4000-8000-000000000001` (4000 x 2667), `GET /images/{id}/boxes` always returns box `b…0001` (person, accepted, 512,300,140,90) and `b…0002` (local_model, unreviewed, confidence 0.81, 1210.5,802,96,61). `GET /images` always returns those two images with `total: 2` and ignores every filter; the sort and filter tests therefore assert the query string, not the result order.
- POSTs do not persist and `POST .../boxes` answers with the example box `b…0001` regardless of the body; after drawing, the editor store's `upsertBox` replaces the existing example by id, so the drawn box does not appear as a third box. Tests assert the request body.
- `GET .../file` and `GET .../thumbnail` return a 6-byte text body with `Content-Type: image/jpeg`: bitmaps never load under the mock. The stage draws a slate placeholder of `Image.width x Image.height`; the grid draws the file name in a neutral tile. `useKonvaImage` returns `null` on error and nothing else breaks.
- Request validation is on: an invalid body (for example `w: 0`) gets `422` with the generic `Error` example (`code: not_found`). A `Prefer: code=409` header forces that status with the example error body; the e2e tests use `page.route` + `route.fulfill` instead so the message and `details` are realistic.
- The websocket `/api/v1/events` is `404` on the mock: `connectEvents` retries with backoff (already logged by S0); event-driven refresh is unit-tested through `useChangesStore.applyEvent`, not end to end.
- CORS preflights are answered `204` with permissive headers, so `page.route` fulfilments of the actual request work (include `Access-Control-Allow-Origin: *` in every `route.fulfill` anyway).
- `PUT /classes` and `PATCH /projects/{p}` return the unchanged example project, so a rename appears to revert after save under the mock; tests assert the request body.

---

### Task 1: Test fixtures, API error helpers and test providers

**Files:**
- Create: `frontend/src/test/fixtures.ts`, `frontend/src/test/render.tsx`, `frontend/src/api/errors.ts`
- Modify: `frontend/src/api/client.tsx` (export `ApiContext` and `ApiContextValue`)
- Test: `frontend/src/api/errors.test.ts`

**Interfaces:**
- Consumes: `createApiClient`, `ApiClient` and schema types from `@contract/client`; `ApiContext` from `src/api/client.tsx`.
- Produces:
  - `fixtures.ts`: `PROJECT_ID`, `IMAGE_ID`, `IMAGE_ID_2`, `MODEL_ID`, `CLASS_ID(n: number): string`, `exampleClasses: ClassDef[]`, `exampleProject: Project`, `exampleImage: ImageRow`, `exampleImage2: ImageRow`, `exampleImagePage: ImagePage`, `personBox: Box`, `proposalBox: Box`, `exampleModel: Model`, `exampleJob: Job`, `errorBody(code, message, details?)`, `RecordedRequest {method, url, body}`, `FakeRoute {method, path: RegExp, status?, body?}`, `fakeFetch(routes): {fetch, requests}`, `fakeClient(routes): {api, requests}`.
  - `errors.ts`: `class ApiFailure extends Error {code: string; status: number; details: Record<string, unknown>}`, `isEnvelope(v): v is ErrorEnvelope`, `messageOf(err: unknown, fallback: string): string`, `codeOf(err: unknown): string | null`, `isNotImplemented(err: unknown): boolean`, `unwrap<T>(call: Promise<{data?: T; error?: unknown; response: Response}>): Promise<T>`.
  - `render.tsx`: `TestApiProvider({api, children})`, `renderWithProviders(ui, {api, route?, path?})`.
  - Throughout S2 the contract's `Image` type is imported as `import type { Image as ImageRow } from "@contract/client"` to avoid shadowing the DOM `Image` constructor.

- [ ] **Step 1: Export the API context for tests**

In `frontend/src/api/client.tsx` change the two declarations (nothing else):

```ts
export interface ApiContextValue {
  client: ApiClient;
  info: BackendInfo;
  health: Health;
}

export const ApiContext = createContext<ApiContextValue | null>(null);
```

- [ ] **Step 2: Write the failing test**

`frontend/src/api/errors.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { ApiFailure, codeOf, isNotImplemented, messageOf, unwrap } from "./errors";

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

describe("unwrap", () => {
  it("returns data on success", async () => {
    const data = await unwrap(Promise.resolve({ data: { ok: 1 }, response: json(200, { ok: 1 }) }));
    expect(data).toEqual({ ok: 1 });
  });

  it("resolves to undefined on 204", async () => {
    const data = await unwrap(Promise.resolve({ data: undefined, response: new Response(null, { status: 204 }) }));
    expect(data).toBeUndefined();
  });

  it("throws ApiFailure with the envelope code, message and details", async () => {
    const envelope = { error: { code: "class_in_use", message: "class still has boxes", details: { box_count: 3 } } };
    const p = unwrap(Promise.resolve({ error: envelope, response: json(409, envelope) }));
    await expect(p).rejects.toBeInstanceOf(ApiFailure);
    await expect(p).rejects.toMatchObject({ code: "class_in_use", status: 409, message: "class still has boxes", details: { box_count: 3 } });
  });

  it("falls back to http_error without an envelope", async () => {
    const p = unwrap(Promise.resolve({ error: "nope", response: new Response("nope", { status: 500 }) }));
    await expect(p).rejects.toMatchObject({ code: "http_error", status: 500 });
  });

  it("wraps a thrown fetch as a network failure", async () => {
    const p = unwrap(Promise.reject(new TypeError("Failed to fetch")));
    await expect(p).rejects.toMatchObject({ code: "network", status: 0, message: "Failed to fetch" });
  });
});

describe("messageOf / codeOf / isNotImplemented", () => {
  it("reads envelopes, failures and plain errors", () => {
    const envelope = { error: { code: "not_found", message: "gone", details: {} } };
    expect(messageOf(envelope, "x")).toBe("gone");
    expect(messageOf(new Error("boom"), "x")).toBe("boom");
    expect(messageOf(undefined, "fallback")).toBe("fallback");
    expect(codeOf(envelope)).toBe("not_found");
    expect(codeOf(new ApiFailure("conflict", "c", 409))).toBe("conflict");
    expect(codeOf("string")).toBeNull();
    expect(isNotImplemented(new ApiFailure("not_implemented", "later", 501))).toBe(true);
    expect(isNotImplemented(new ApiFailure("http_error", "later", 501))).toBe(true);
    expect(isNotImplemented(new ApiFailure("conflict", "c", 409))).toBe(false);
  });
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `pnpm test src/api/errors.test.ts`
Expected: FAIL with `Failed to resolve import "./errors"`.

- [ ] **Step 4: Implement `errors.ts`**

`frontend/src/api/errors.ts`:

```ts
export interface ErrorEnvelope {
  error: { code: string; message: string; details: Record<string, unknown> };
}

/** Thrown by `unwrap` for any non-2xx response or transport failure. */
export class ApiFailure extends Error {
  readonly code: string;
  readonly status: number;
  readonly details: Record<string, unknown>;

  constructor(code: string, message: string, status: number, details: Record<string, unknown> = {}) {
    super(message);
    this.name = "ApiFailure";
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

export function isEnvelope(v: unknown): v is ErrorEnvelope {
  if (typeof v !== "object" || v === null || !("error" in v)) return false;
  const err = (v as { error?: unknown }).error;
  return typeof err === "object" && err !== null && typeof (err as { message?: unknown }).message === "string";
}

/** Human-readable message for an envelope, an ApiFailure, an Error or anything else. */
export function messageOf(err: unknown, fallback: string): string {
  if (isEnvelope(err)) return err.error.message;
  if (err instanceof Error) return err.message || fallback;
  return fallback;
}

export function codeOf(err: unknown): string | null {
  if (isEnvelope(err)) return err.error.code;
  if (err instanceof ApiFailure) return err.code;
  return null;
}

/** 501 stubs exist until S3/S4 land; callers show a notice instead of an error. */
export function isNotImplemented(err: unknown): boolean {
  return codeOf(err) === "not_implemented" || (err instanceof ApiFailure && err.status === 501);
}

interface FetchResult<T> {
  data?: T;
  error?: unknown;
  response: Response;
}

/** Turns openapi-fetch's `{data, error, response}` into data-or-throw. A 204 resolves to `undefined`. */
export async function unwrap<T>(call: Promise<FetchResult<T>>): Promise<T> {
  let result: FetchResult<T>;
  try {
    result = await call;
  } catch (e) {
    throw new ApiFailure("network", e instanceof Error ? e.message : String(e), 0);
  }
  if (result.response.ok) return result.data as T;
  const status = result.response.status;
  if (isEnvelope(result.error)) {
    const { code, message, details } = result.error.error;
    throw new ApiFailure(code, message, status, details ?? {});
  }
  throw new ApiFailure("http_error", `request failed with status ${status}`, status);
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `pnpm test src/api/errors.test.ts`
Expected: `Test Files 1 passed`, `Tests 6 passed`.

- [ ] **Step 6: Write the fixtures**

`frontend/src/test/fixtures.ts` (values copied from the `openapi.yaml` examples so Vitest and the mock agree):

```ts
import {
  createApiClient,
  type ApiClient,
  type Box,
  type ClassDef,
  type Image as ImageRow,
  type ImagePage,
  type Job,
  type Model,
  type Project,
} from "@contract/client";

export const PROJECT_ID = "7f1c2e3a-1111-4000-8000-000000000001";
export const IMAGE_ID = "10000000-5555-4000-8000-000000000001";
export const IMAGE_ID_2 = "10000000-5555-4000-8000-000000000002";
export const MODEL_ID = "m0000000-2222-4000-8000-000000000001";
export const SOURCE_ID = "50000000-3333-4000-8000-000000000001";
export const CLASS_ID = (n: number): string => `c1a2b3c4-0000-4000-8000-00000000000${n}`;

const NAMES = ["excavator", "wheel_loader", "bulldozer", "dump_truck", "crane", "concrete_mixer", "roller", "backhoe"];
const COLOURS = ["#f97316", "#eab308", "#22c55e", "#06b6d4", "#3b82f6", "#a855f7", "#ec4899", "#ef4444"];

export const exampleClasses: ClassDef[] = NAMES.map((name, i) => ({
  id: CLASS_ID(i + 1),
  name,
  colour: COLOURS[i],
  hotkey: String(i + 1),
  order: i,
}));

export const exampleProject: Project = {
  id: PROJECT_ID,
  name: "Ahmadia",
  folder: "E:\\Projects\\Ahmadia",
  classes: exampleClasses,
  preannotation_model_id: MODEL_ID,
  import_defaults: {
    max_side: 4000,
    quality: 95,
    dedupe_threshold: 4,
    group_regex: "^(?P<camera>[A-Za-z0-9-]+)_(?P<flight>\\d+)_(?P<frame>\\d+)",
  },
  schema_version: 1,
  created_at: "2026-09-17T10:00:00Z",
};

export const exampleImage: ImageRow = {
  id: IMAGE_ID,
  path: "images/ahmadia/IX-12-02491_0031_0001.jpg",
  file_name: "IX-12-02491_0031_0001.jpg",
  width: 4000,
  height: 2667,
  source_id: SOURCE_ID,
  group_key: "IX-12-02491_0031",
  capture_time: "2019-04-15T06:35:36Z",
  lat: 29.49469,
  lon: 47.76513,
  alt: 191.3,
  phash: "82a81f67f94615ae",
  box_count: 3,
  pending_count: 2,
  max_pending_confidence: 0.81,
  labeled: true,
  created_at: "2026-09-17T10:06:00Z",
};

export const exampleImage2: ImageRow = {
  ...exampleImage,
  id: IMAGE_ID_2,
  path: "images/ahmadia/IX-12-02491_0031_0002.jpg",
  file_name: "IX-12-02491_0031_0002.jpg",
  capture_time: "2019-04-15T06:35:39Z",
  lat: 29.49476,
  lon: 47.76486,
  alt: 191.8,
  phash: "8488349d3494bffb",
  box_count: 0,
  pending_count: 0,
  max_pending_confidence: null,
  labeled: false,
};

export const exampleImagePage: ImagePage = { items: [exampleImage, exampleImage2], next_cursor: null, total: 2 };

export const personBox: Box = {
  id: "b0000000-6666-4000-8000-000000000001",
  image_id: IMAGE_ID,
  class_id: CLASS_ID(1),
  x: 512,
  y: 300,
  w: 140,
  h: 90,
  confidence: null,
  provenance: { kind: "person", model_id: null, provider: null, model_name: null, query_run_id: null },
  review_state: "accepted",
  reviewed_at: "2026-09-17T10:45:00Z",
  created_at: "2026-09-17T10:45:00Z",
};

export const proposalBox: Box = {
  id: "b0000000-6666-4000-8000-000000000002",
  image_id: IMAGE_ID,
  class_id: CLASS_ID(4),
  x: 1210.5,
  y: 802,
  w: 96,
  h: 61,
  confidence: 0.81,
  provenance: { kind: "local_model", model_id: MODEL_ID, provider: null, model_name: "yolo11m-coco", query_run_id: null },
  review_state: "unreviewed",
  reviewed_at: null,
  created_at: "2026-09-17T11:00:00Z",
};

export const exampleModel: Model = {
  id: MODEL_ID,
  name: "yolo11m-coco",
  kind: "imported",
  weights_path: "models/yolo11m.pt",
  base_weights: null,
  dataset_id: null,
  hyperparameters: {},
  metrics: null,
  class_names: ["person", "bicycle", "car", "motorcycle", "airplane", "bus", "train", "truck"],
  class_aliases: { truck: "dump_truck" },
  exports: {},
  artifacts: {},
  run_id: null,
  created_at: "2026-09-17T10:10:00Z",
};

export const exampleJob: Job = {
  id: "j0000000-4444-4000-8000-000000000003",
  project_id: PROJECT_ID,
  type: "infer",
  state: "queued",
  progress: 0,
  message: "",
  log_path: "runs/j0000000-4444-4000-8000-000000000003/job.log",
  params: {},
  result: null,
  error: null,
  created_at: "2026-09-17T13:00:00Z",
  started_at: null,
  finished_at: null,
};

export function errorBody(code: string, message: string, details: Record<string, unknown> = {}) {
  return { error: { code, message, details } };
}

export interface RecordedRequest {
  method: string;
  /** path plus query string, e.g. `/api/v1/projects/p/images?sort=path` */
  url: string;
  body: unknown;
}

export interface FakeRoute {
  method: string;
  path: RegExp;
  status?: number;
  body?: unknown | ((req: RecordedRequest) => unknown);
}

/** A `fetch` that answers from `routes` (first match wins) and records every request. */
export function fakeFetch(routes: FakeRoute[]): { fetch: typeof fetch; requests: RecordedRequest[] } {
  const requests: RecordedRequest[] = [];
  const fetchImpl = (async (input: Request | string | URL, init?: RequestInit) => {
    const req = input instanceof Request ? input : new Request(input, init);
    const url = new URL(req.url);
    const text = await req.text();
    const rec: RecordedRequest = { method: req.method, url: url.pathname + url.search, body: text ? JSON.parse(text) : null };
    requests.push(rec);
    const route = routes.find((r) => r.method === req.method && r.path.test(url.pathname));
    if (!route) {
      return new Response(JSON.stringify(errorBody("not_found", `no fake route for ${req.method} ${url.pathname}`)), {
        status: 404,
        headers: { "Content-Type": "application/json" },
      });
    }
    const status = route.status ?? 200;
    const payload = typeof route.body === "function" ? (route.body as (r: RecordedRequest) => unknown)(rec) : route.body;
    if (status === 204 || payload === undefined) return new Response(null, { status });
    return new Response(JSON.stringify(payload), { status, headers: { "Content-Type": "application/json" } });
  }) as typeof fetch;
  return { fetch: fetchImpl, requests };
}

export function fakeClient(routes: FakeRoute[]): { api: ApiClient; requests: RecordedRequest[] } {
  const { fetch: fetchImpl, requests } = fakeFetch(routes);
  return { api: createApiClient({ baseUrl: "http://fake", token: "t", fetch: fetchImpl }), requests };
}

/** Routes that mirror the mock server for the common S2 reads. */
export function mockRoutes(): FakeRoute[] {
  return [
    { method: "GET", path: /\/projects\/[^/]+$/, body: exampleProject },
    { method: "GET", path: /\/projects\/[^/]+\/images$/, body: exampleImagePage },
    { method: "GET", path: /\/images\/[^/]+$/, body: exampleImage },
    { method: "GET", path: /\/images\/[^/]+\/boxes$/, body: { items: [personBox, proposalBox] } },
    { method: "GET", path: /\/models$/, body: { items: [exampleModel], next_cursor: null } },
    { method: "GET", path: /\/sources$/, body: { items: [], next_cursor: null } },
  ];
}
```

- [ ] **Step 7: Write the test render helpers**

`frontend/src/test/render.tsx`:

```tsx
import { useMemo, type ReactElement, type ReactNode } from "react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { render } from "@testing-library/react";
import type { ApiClient } from "@contract/client";
import { ApiContext, type ApiContextValue } from "@/api/client";

export function TestApiProvider({ api, children }: { api: ApiClient; children: ReactNode }) {
  const value = useMemo<ApiContextValue>(
    () => ({
      client: api,
      info: { baseUrl: "http://fake", token: "t", mode: "mock" },
      health: { status: "ok", version: "test", pid: 1, started_at: "2026-09-17T00:00:00Z" },
    }),
    [api],
  );
  return <ApiContext.Provider value={value}>{children}</ApiContext.Provider>;
}

/** Renders `ui` inside the API context and a memory router; `path` mounts it as a route so `useParams` works. */
export function renderWithProviders(ui: ReactElement, opts: { api: ApiClient; route?: string; path?: string }) {
  return render(
    <TestApiProvider api={opts.api}>
      <MemoryRouter initialEntries={[opts.route ?? "/"]}>
        {opts.path ? (
          <Routes>
            <Route path={opts.path} element={ui} />
          </Routes>
        ) : (
          ui
        )}
      </MemoryRouter>
    </TestApiProvider>,
  );
}
```

- [ ] **Step 8: Type-check and lint**

Run: `pnpm exec tsc -b && pnpm lint`
Expected: no output from tsc; eslint and prettier clean (run `pnpm format` first if prettier complains).

- [ ] **Step 9: Commit**

```bash
git add src/api/errors.ts src/api/errors.test.ts src/api/client.tsx src/test/fixtures.ts src/test/render.tsx
git commit -m "test(ui): contract fixtures, fake fetch client and api error helpers"
```

---

### Task 2: Geometry helpers

**Files:**
- Create: `frontend/src/editor/geometry.ts`
- Test: `frontend/src/editor/geometry.test.ts`

**Interfaces:**
- Produces (all pure, image pixels unless stated):
  - `interface Point {x: number; y: number}`, `interface Rect {x: number; y: number; w: number; h: number}`, `interface Size {width: number; height: number}`, `interface ViewTransform {scale: number; x: number; y: number}` (display = image * scale + offset).
  - Constants `MIN_SCALE = 0.02`, `MAX_SCALE = 32`, `ZOOM_STEP = 1.15`, `FIT_PADDING = 16`, `DISPLAY_MAX_SIDE = 4096`, `MIN_BOX_SIDE = 2`.
  - `toImage(p: Point, v: ViewTransform): Point`, `toDisplay(p: Point, v: ViewTransform): Point`, `clampScale(s: number): number`, `fitView(image: Size, viewport: Size, padding?: number): ViewTransform`, `oneToOneView(viewport: Size, current: ViewTransform): ViewTransform`, `zoomAround(v: ViewTransform, at: Point, factor: number): ViewTransform`, `normalizeRect(a: Point, b: Point): Rect`, `clampRect(r: Rect, image: Size): Rect`, `roundRect(r: Rect, decimals?: number): Rect`, `rectEquals(a: Rect, b: Rect, eps?: number): boolean`, `rectOf(b: {x, y, w, h}): Rect`, `isDrawable(r: Rect): boolean`, `displayMaxSide(image: Size, cap?: number): number`, `duplicateOffset(r: Rect, image: Size, offset?: number): Rect`.

- [ ] **Step 1: Write the failing test**

`frontend/src/editor/geometry.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import {
  clampRect,
  displayMaxSide,
  duplicateOffset,
  fitView,
  isDrawable,
  normalizeRect,
  oneToOneView,
  rectEquals,
  roundRect,
  toDisplay,
  toImage,
  zoomAround,
  MAX_SCALE,
  MIN_SCALE,
} from "./geometry";

const image = { width: 4000, height: 2667 };
const viewport = { width: 1000, height: 700 };

describe("view transforms", () => {
  it("converts display to image pixels and back", () => {
    const v = { scale: 0.25, x: 10, y: 20 };
    const p = toImage({ x: 260, y: 220 }, v);
    expect(p).toEqual({ x: 1000, y: 800 });
    expect(toDisplay(p, v)).toEqual({ x: 260, y: 220 });
  });

  it("fits the whole image inside the viewport with padding and centres it", () => {
    const v = fitView(image, viewport, 16);
    expect(v.scale).toBeCloseTo(Math.min(968 / 4000, 668 / 2667), 6);
    const w = image.width * v.scale;
    const h = image.height * v.scale;
    expect(v.x).toBeCloseTo((viewport.width - w) / 2, 6);
    expect(v.y).toBeCloseTo((viewport.height - h) / 2, 6);
  });

  it("1:1 keeps the image point under the viewport centre", () => {
    const fitted = fitView(image, viewport);
    const centreBefore = toImage({ x: 500, y: 350 }, fitted);
    const v = oneToOneView(viewport, fitted);
    expect(v.scale).toBe(1);
    expect(toImage({ x: 500, y: 350 }, v)).toEqual(centreBefore);
  });

  it("zooms around the pointer and clamps the scale", () => {
    const v = { scale: 1, x: 0, y: 0 };
    const at = { x: 100, y: 50 };
    const z = zoomAround(v, at, 2);
    expect(z.scale).toBe(2);
    expect(toImage(at, z)).toEqual(toImage(at, v));
    expect(zoomAround(v, at, 1000).scale).toBe(MAX_SCALE);
    expect(zoomAround(v, at, 0.0001).scale).toBe(MIN_SCALE);
  });
});

describe("rects", () => {
  it("normalises two corners in any order", () => {
    expect(normalizeRect({ x: 10, y: 50 }, { x: 4, y: 20 })).toEqual({ x: 4, y: 20, w: 6, h: 30 });
  });

  it("clamps inside the image and enforces a minimum size", () => {
    expect(clampRect({ x: -5, y: -5, w: 50, h: 50 }, image)).toEqual({ x: 0, y: 0, w: 50, h: 50 });
    expect(clampRect({ x: 3990, y: 2660, w: 50, h: 50 }, image)).toEqual({ x: 3950, y: 2617, w: 50, h: 50 });
    expect(clampRect({ x: 10, y: 10, w: 0, h: 0 }, image)).toEqual({ x: 10, y: 10, w: 2, h: 2 });
  });

  it("rounds to one decimal and compares with tolerance", () => {
    expect(roundRect({ x: 1.26, y: 2.24, w: 3.36, h: 4.06 })).toEqual({ x: 1.3, y: 2.2, w: 3.4, h: 4.1 });
    expect(rectEquals({ x: 1, y: 1, w: 1, h: 1 }, { x: 1.01, y: 1, w: 1, h: 1 })).toBe(true);
    expect(rectEquals({ x: 1, y: 1, w: 1, h: 1 }, { x: 2, y: 1, w: 1, h: 1 })).toBe(false);
  });

  it("knows when a drag is too small to be a box", () => {
    expect(isDrawable({ x: 0, y: 0, w: 1, h: 10 })).toBe(false);
    expect(isDrawable({ x: 0, y: 0, w: 2, h: 2 })).toBe(true);
  });

  it("offsets a duplicate and keeps it inside the image", () => {
    expect(duplicateOffset({ x: 10, y: 10, w: 20, h: 20 }, image)).toEqual({ x: 22, y: 22, w: 20, h: 20 });
    expect(duplicateOffset({ x: 3980, y: 2647, w: 20, h: 20 }, image)).toEqual({ x: 3980, y: 2647, w: 20, h: 20 });
  });

  it("requests at most the display cap as max_side", () => {
    expect(displayMaxSide(image)).toBe(4000);
    expect(displayMaxSide({ width: 6000, height: 4000 })).toBe(4096);
    expect(displayMaxSide({ width: 800, height: 600 }, 2048)).toBe(800);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm test src/editor/geometry.test.ts`
Expected: FAIL with `Failed to resolve import "./geometry"`.

- [ ] **Step 3: Implement `geometry.ts`**

```ts
export interface Point {
  x: number;
  y: number;
}
export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}
export interface Size {
  width: number;
  height: number;
}
/** display = image * scale + (x, y); the Konva stage uses exactly these three numbers. */
export interface ViewTransform {
  scale: number;
  x: number;
  y: number;
}

export const MIN_SCALE = 0.02;
export const MAX_SCALE = 32;
export const ZOOM_STEP = 1.15;
export const FIT_PADDING = 16;
/** Largest `max_side` the editor asks the backend for; prepared images are 4000 px so this is full size. */
export const DISPLAY_MAX_SIDE = 4096;
/** Smallest box side in image pixels; anything smaller is treated as a click. */
export const MIN_BOX_SIDE = 2;

export function toImage(p: Point, v: ViewTransform): Point {
  return { x: (p.x - v.x) / v.scale, y: (p.y - v.y) / v.scale };
}

export function toDisplay(p: Point, v: ViewTransform): Point {
  return { x: p.x * v.scale + v.x, y: p.y * v.scale + v.y };
}

export function clampScale(s: number): number {
  return Math.min(MAX_SCALE, Math.max(MIN_SCALE, s));
}

export function fitView(image: Size, viewport: Size, padding = FIT_PADDING): ViewTransform {
  const availW = Math.max(1, viewport.width - 2 * padding);
  const availH = Math.max(1, viewport.height - 2 * padding);
  const scale = clampScale(Math.min(availW / image.width, availH / image.height));
  return {
    scale,
    x: (viewport.width - image.width * scale) / 2,
    y: (viewport.height - image.height * scale) / 2,
  };
}

/** Scale 1 while keeping whatever image point is under the viewport centre in place. */
export function oneToOneView(viewport: Size, current: ViewTransform): ViewTransform {
  const centre = { x: viewport.width / 2, y: viewport.height / 2 };
  const anchor = toImage(centre, current);
  return { scale: 1, x: centre.x - anchor.x, y: centre.y - anchor.y };
}

export function zoomAround(v: ViewTransform, at: Point, factor: number): ViewTransform {
  const scale = clampScale(v.scale * factor);
  const anchor = toImage(at, v);
  return { scale, x: at.x - anchor.x * scale, y: at.y - anchor.y * scale };
}

export function normalizeRect(a: Point, b: Point): Rect {
  return { x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), w: Math.abs(a.x - b.x), h: Math.abs(a.y - b.y) };
}

export function clampRect(r: Rect, image: Size): Rect {
  const w = Math.min(Math.max(r.w, MIN_BOX_SIDE), image.width);
  const h = Math.min(Math.max(r.h, MIN_BOX_SIDE), image.height);
  const x = Math.min(Math.max(r.x, 0), image.width - w);
  const y = Math.min(Math.max(r.y, 0), image.height - h);
  return { x, y, w, h };
}

export function roundRect(r: Rect, decimals = 1): Rect {
  const f = 10 ** decimals;
  const round = (n: number) => Math.round(n * f) / f;
  return { x: round(r.x), y: round(r.y), w: round(r.w), h: round(r.h) };
}

export function rectEquals(a: Rect, b: Rect, eps = 0.05): boolean {
  return Math.abs(a.x - b.x) < eps && Math.abs(a.y - b.y) < eps && Math.abs(a.w - b.w) < eps && Math.abs(a.h - b.h) < eps;
}

export function rectOf(b: { x: number; y: number; w: number; h: number }): Rect {
  return { x: b.x, y: b.y, w: b.w, h: b.h };
}

export function isDrawable(r: Rect): boolean {
  return r.w >= MIN_BOX_SIDE && r.h >= MIN_BOX_SIDE;
}

export function displayMaxSide(image: Size, cap = DISPLAY_MAX_SIDE): number {
  return Math.min(cap, Math.max(image.width, image.height));
}

export function duplicateOffset(r: Rect, image: Size, offset = 12): Rect {
  return clampRect({ ...r, x: r.x + offset, y: r.y + offset }, image);
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm test src/editor/geometry.test.ts`
Expected: `Tests 10 passed`.

- [ ] **Step 5: Commit**

```bash
git add src/editor/geometry.ts src/editor/geometry.test.ts
git commit -m "feat(ui): editor geometry helpers (view transform, fit, zoom, rect clamping)"
```

---

### Task 3: Editor store

**Files:**
- Create: `frontend/src/store/editor.ts`
- Test: `frontend/src/store/editor.test.ts`

**Interfaces:**
- Consumes: `geometry.ts` (`fitView`, `oneToOneView`, `zoomAround`, `Rect`, `Size`, `Point`, `ViewTransform`); `Box`, `Image as ImageRow` from `@contract/client`.
- Produces:
  - `interface Draft extends Rect { classId: string }`
  - `useEditorStore` (zustand) with state `imageId: string | null`, `image: ImageRow | null`, `boxes: Record<string, Box>`, `order: string[]`, `selectedId`, `hoveredId`, `activeClassId: string | null`, `view: ViewTransform`, `viewport: Size`, `fitted: boolean`, `spaceHeld: boolean`, `draft: Draft | null`, `pending: number`, `error: string | null`, `notice: string | null`, `showRejected: boolean` and actions `loadImage(image, boxes)`, `setBoxes(boxes)`, `upsertBox(box)`, `removeBox(id)`, `patchStates(ids, state)`, `select(id)`, `hover(id)`, `setActiveClass(id)`, `setViewport(size)`, `setView(view)`, `fit()`, `oneToOne()`, `zoomAt(displayPoint, factor)`, `setSpaceHeld(held)`, `setDraft(draft)`, `beginRequest()`, `endRequest()`, `setError(msg)`, `setNotice(msg)`, `toggleShowRejected()`, `reset()`.
  - Selectors (pure functions over the state): `visibleBoxes(s): Box[]` (in `order`, rejected hidden unless `showRejected`), `visibleProposalIds(s): string[]` (visible and `unreviewed`), `selectedBox(s): Box | null`.
  - `waitForIdle(store = useEditorStore, timeoutMs = 10000): Promise<void>` resolves when `pending === 0`.
  - `INITIAL_VIEW: ViewTransform = {scale: 1, x: 0, y: 0}`.

- [ ] **Step 1: Write the failing test**

`frontend/src/store/editor.test.ts`:

```ts
import { describe, it, expect, beforeEach } from "vitest";
import { exampleImage, personBox, proposalBox } from "@/test/fixtures";
import { selectedBox, useEditorStore, visibleBoxes, visibleProposalIds, waitForIdle } from "./editor";

const rejected = { ...proposalBox, id: "b-rej", review_state: "rejected" as const, created_at: "2026-09-17T12:00:00Z" };

describe("editor store", () => {
  beforeEach(() => useEditorStore.getState().reset());

  it("loads an image with boxes ordered by creation time and fits once the viewport is known", () => {
    const s = useEditorStore.getState();
    s.setViewport({ width: 1000, height: 700 });
    s.loadImage(exampleImage, [proposalBox, personBox]);
    const st = useEditorStore.getState();
    expect(st.imageId).toBe(exampleImage.id);
    expect(st.order).toEqual([personBox.id, proposalBox.id]);
    expect(st.fitted).toBe(true);
    expect(st.view.scale).toBeLessThan(1);
    expect(st.view.scale).toBeCloseTo(Math.min(968 / 4000, 668 / 2667), 6);
  });

  it("fits when the viewport arrives after the image", () => {
    const s = useEditorStore.getState();
    s.loadImage(exampleImage, []);
    expect(useEditorStore.getState().fitted).toBe(false);
    s.setViewport({ width: 800, height: 600 });
    expect(useEditorStore.getState().fitted).toBe(true);
    expect(useEditorStore.getState().view.scale).toBeCloseTo(768 / 4000, 6);
  });

  it("upserts, removes and patches review states", () => {
    const s = useEditorStore.getState();
    s.loadImage(exampleImage, [personBox]);
    s.upsertBox(proposalBox);
    expect(useEditorStore.getState().order).toEqual([personBox.id, proposalBox.id]);
    s.upsertBox({ ...proposalBox, x: 1 });
    expect(useEditorStore.getState().boxes[proposalBox.id].x).toBe(1);
    expect(useEditorStore.getState().order).toHaveLength(2);
    s.patchStates([proposalBox.id], "accepted");
    expect(useEditorStore.getState().boxes[proposalBox.id].review_state).toBe("accepted");
    expect(useEditorStore.getState().boxes[proposalBox.id].reviewed_at).not.toBeNull();
    s.select(proposalBox.id);
    s.removeBox(proposalBox.id);
    expect(useEditorStore.getState().order).toEqual([personBox.id]);
    expect(useEditorStore.getState().selectedId).toBeNull();
  });

  it("hides rejected boxes unless asked and lists visible proposals", () => {
    const s = useEditorStore.getState();
    s.loadImage(exampleImage, [personBox, proposalBox, rejected]);
    expect(visibleBoxes(useEditorStore.getState()).map((b) => b.id)).toEqual([personBox.id, proposalBox.id]);
    expect(visibleProposalIds(useEditorStore.getState())).toEqual([proposalBox.id]);
    s.toggleShowRejected();
    expect(visibleBoxes(useEditorStore.getState())).toHaveLength(3);
    s.select(personBox.id);
    expect(selectedBox(useEditorStore.getState())?.id).toBe(personBox.id);
  });

  it("zooms around a display point and sets 1:1", () => {
    const s = useEditorStore.getState();
    s.setViewport({ width: 1000, height: 700 });
    s.loadImage(exampleImage, []);
    const before = useEditorStore.getState().view.scale;
    s.zoomAt({ x: 500, y: 350 }, 2);
    expect(useEditorStore.getState().view.scale).toBeCloseTo(before * 2, 9);
    s.oneToOne();
    expect(useEditorStore.getState().view.scale).toBe(1);
    s.fit();
    expect(useEditorStore.getState().view.scale).toBeCloseTo(before, 9);
  });

  it("counts pending requests and resolves waitForIdle", async () => {
    const s = useEditorStore.getState();
    s.beginRequest();
    s.beginRequest();
    let idle = false;
    const p = waitForIdle(useEditorStore).then(() => {
      idle = true;
    });
    s.endRequest();
    await Promise.resolve();
    expect(idle).toBe(false);
    s.endRequest();
    await p;
    expect(idle).toBe(true);
    expect(useEditorStore.getState().pending).toBe(0);
  });

  it("reset clears everything but keeps the viewport", () => {
    const s = useEditorStore.getState();
    s.setViewport({ width: 1000, height: 700 });
    s.loadImage(exampleImage, [personBox]);
    s.setActiveClass("c1");
    s.setError("x");
    s.reset();
    const st = useEditorStore.getState();
    expect(st.image).toBeNull();
    expect(st.order).toEqual([]);
    expect(st.error).toBeNull();
    expect(st.activeClassId).toBe("c1");
    expect(st.viewport).toEqual({ width: 1000, height: 700 });
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm test src/store/editor.test.ts`
Expected: FAIL with `Failed to resolve import "./editor"`.

- [ ] **Step 3: Implement `store/editor.ts`**

```ts
import { create, type StoreApi, type UseBoundStore } from "zustand";
import type { Box, Image as ImageRow, ReviewState } from "@contract/client";
import {
  fitView,
  oneToOneView,
  zoomAround,
  type Point,
  type Rect,
  type Size,
  type ViewTransform,
} from "@/editor/geometry";

export interface Draft extends Rect {
  classId: string;
}

export const INITIAL_VIEW: ViewTransform = { scale: 1, x: 0, y: 0 };

export interface EditorState {
  imageId: string | null;
  image: ImageRow | null;
  boxes: Record<string, Box>;
  order: string[];
  selectedId: string | null;
  hoveredId: string | null;
  activeClassId: string | null;
  view: ViewTransform;
  viewport: Size;
  fitted: boolean;
  spaceHeld: boolean;
  draft: Draft | null;
  pending: number;
  error: string | null;
  notice: string | null;
  showRejected: boolean;

  loadImage: (image: ImageRow, boxes: Box[]) => void;
  setBoxes: (boxes: Box[]) => void;
  upsertBox: (box: Box) => void;
  removeBox: (id: string) => void;
  patchStates: (ids: string[], state: ReviewState) => void;
  select: (id: string | null) => void;
  hover: (id: string | null) => void;
  setActiveClass: (id: string | null) => void;
  setViewport: (size: Size) => void;
  setView: (view: ViewTransform) => void;
  fit: () => void;
  oneToOne: () => void;
  zoomAt: (displayPoint: Point, factor: number) => void;
  setSpaceHeld: (held: boolean) => void;
  setDraft: (draft: Draft | null) => void;
  beginRequest: () => void;
  endRequest: () => void;
  setError: (message: string | null) => void;
  setNotice: (message: string | null) => void;
  toggleShowRejected: () => void;
  reset: () => void;
}

function sortedIds(boxes: Record<string, Box>): string[] {
  return Object.values(boxes)
    .sort((a, b) => a.created_at.localeCompare(b.created_at) || a.id.localeCompare(b.id))
    .map((b) => b.id);
}

function keyed(boxes: Box[]): Record<string, Box> {
  return Object.fromEntries(boxes.map((b) => [b.id, b]));
}

const EMPTY = {
  imageId: null,
  image: null,
  boxes: {},
  order: [],
  selectedId: null,
  hoveredId: null,
  view: INITIAL_VIEW,
  fitted: false,
  spaceHeld: false,
  draft: null,
  pending: 0,
  error: null,
  notice: null,
} satisfies Partial<EditorState>;

export const useEditorStore = create<EditorState>((set, get) => ({
  ...EMPTY,
  activeClassId: null,
  viewport: { width: 0, height: 0 },
  showRejected: false,

  loadImage: (image, boxes) =>
    set((s) => {
      const map = keyed(boxes);
      const canFit = s.viewport.width > 0 && s.viewport.height > 0;
      return {
        ...EMPTY,
        imageId: image.id,
        image,
        boxes: map,
        order: sortedIds(map),
        view: canFit ? fitView(image, s.viewport) : INITIAL_VIEW,
        fitted: canFit,
      };
    }),
  setBoxes: (boxes) =>
    set((s) => {
      const map = keyed(boxes);
      return { boxes: map, order: sortedIds(map), selectedId: s.selectedId && map[s.selectedId] ? s.selectedId : null };
    }),
  upsertBox: (box) =>
    set((s) => {
      const boxes = { ...s.boxes, [box.id]: box };
      return { boxes, order: sortedIds(boxes) };
    }),
  removeBox: (id) =>
    set((s) => {
      const boxes = { ...s.boxes };
      delete boxes[id];
      return {
        boxes,
        order: s.order.filter((x) => x !== id),
        selectedId: s.selectedId === id ? null : s.selectedId,
        hoveredId: s.hoveredId === id ? null : s.hoveredId,
      };
    }),
  patchStates: (ids, state) =>
    set((s) => {
      const now = new Date().toISOString();
      const boxes = { ...s.boxes };
      for (const id of ids) if (boxes[id]) boxes[id] = { ...boxes[id], review_state: state, reviewed_at: now };
      return { boxes };
    }),
  select: (id) => set({ selectedId: id }),
  hover: (id) => set({ hoveredId: id }),
  setActiveClass: (id) => set({ activeClassId: id }),
  setViewport: (size) =>
    set((s) => {
      if (size.width === s.viewport.width && size.height === s.viewport.height) return s;
      if (s.image && !s.fitted && size.width > 0 && size.height > 0) {
        return { viewport: size, view: fitView(s.image, size), fitted: true };
      }
      return { viewport: size };
    }),
  setView: (view) => set({ view }),
  fit: () => {
    const { image, viewport } = get();
    if (image && viewport.width > 0) set({ view: fitView(image, viewport), fitted: true });
  },
  oneToOne: () => {
    const { image, viewport, view } = get();
    if (image) set({ view: oneToOneView(viewport, view) });
  },
  zoomAt: (displayPoint, factor) => set((s) => ({ view: zoomAround(s.view, displayPoint, factor) })),
  setSpaceHeld: (held) => set({ spaceHeld: held }),
  setDraft: (draft) => set({ draft }),
  beginRequest: () => set((s) => ({ pending: s.pending + 1 })),
  endRequest: () => set((s) => ({ pending: Math.max(0, s.pending - 1) })),
  setError: (message) => set({ error: message }),
  setNotice: (message) => set({ notice: message }),
  toggleShowRejected: () => set((s) => ({ showRejected: !s.showRejected })),
  reset: () => set({ ...EMPTY }),
}));

export type EditorStore = UseBoundStore<StoreApi<EditorState>>;

export function visibleBoxes(s: Pick<EditorState, "boxes" | "order" | "showRejected">): Box[] {
  return s.order.map((id) => s.boxes[id]).filter((b) => b && (s.showRejected || b.review_state !== "rejected"));
}

export function visibleProposalIds(s: Pick<EditorState, "boxes" | "order" | "showRejected">): string[] {
  return visibleBoxes(s)
    .filter((b) => b.review_state === "unreviewed")
    .map((b) => b.id);
}

export function selectedBox(s: Pick<EditorState, "boxes" | "selectedId">): Box | null {
  return s.selectedId ? (s.boxes[s.selectedId] ?? null) : null;
}

/** Resolves once no API call is in flight (auto-save before navigation). */
export function waitForIdle(store: EditorStore = useEditorStore, timeoutMs = 10_000): Promise<void> {
  return new Promise((resolve) => {
    if (store.getState().pending === 0) return resolve();
    const timer = setTimeout(() => {
      unsubscribe();
      resolve();
    }, timeoutMs);
    const unsubscribe = store.subscribe((s) => {
      if (s.pending === 0) {
        clearTimeout(timer);
        unsubscribe();
        resolve();
      }
    });
  });
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm test src/store/editor.test.ts`
Expected: `Tests 7 passed`.

- [ ] **Step 5: Commit**

```bash
git add src/store/editor.ts src/store/editor.test.ts
git commit -m "feat(ui): editor store with view transform, boxes and pending counter"
```

---

### Task 4: Undo history and the hotkey map

**Files:**
- Create: `frontend/src/editor/history.ts`, `frontend/src/editor/hotkeys.ts`
- Test: `frontend/src/editor/history.test.ts`, `frontend/src/editor/hotkeys.test.ts`

**Interfaces:**
- Produces:
  - `interface Command { label: string; undo: () => Promise<void>; redo: () => Promise<void> }`, `interface BoxRef { id: string }` (a mutable id holder shared by a command's undo and redo, because redoing a create yields a new server id).
  - `class History { constructor(limit = 100); push(cmd): void; canUndo(): boolean; canRedo(): boolean; undo(): Promise<Command | null>; redo(): Promise<Command | null>; clear(): void; subscribe(listener: () => void): () => void; version: number }`. `push` clears the redo stack; `undo`/`redo` run the command and move it between stacks; every change bumps `version` and notifies listeners; a command that throws stays where it was and the error propagates.
  - `type EditorAction = {type: "class-key"; key: string} | {type: "fit"} | {type: "one-to-one"} | {type: "delete"} | {type: "duplicate"} | {type: "accept-all"} | {type: "reject-all"} | {type: "next"} | {type: "prev"} | {type: "undo"} | {type: "redo"} | {type: "escape"} | {type: "space-down"} | {type: "space-up"}`.
  - `interface KeyLike { type: "keydown" | "keyup"; key: string; ctrlKey: boolean; metaKey: boolean; shiftKey: boolean; altKey: boolean; repeat?: boolean }`, `actionForKey(e: KeyLike): EditorAction | null`, `isTypingTarget(target: EventTarget | null): boolean`, `HOTKEY_HELP: ReadonlyArray<{keys: string; does: string}>`.
  - Key map: `1`..`9` and any other unmodified printable key that is not reserved -> `class-key` (the caller resolves it against `ClassDef.hotkey`); reserved: `f`/`F` fit, `0` and `Ctrl+1` one-to-one, `a` accept-all, `r` reject-all, `Delete`/`Backspace` delete, `Ctrl+D` duplicate, `Ctrl+Z` undo, `Ctrl+Y` or `Ctrl+Shift+Z` redo, `Ctrl+ArrowRight` next, `Ctrl+ArrowLeft` prev, `Escape`, Space keydown (non-repeat) / keyup -> `space-down` / `space-up`. `metaKey` counts as Ctrl.

- [ ] **Step 1: Write the failing tests**

`frontend/src/editor/history.test.ts`:

```ts
import { describe, it, expect, vi } from "vitest";
import { History, type Command } from "./history";

function cmd(label: string, log: string[]): Command {
  return {
    label,
    undo: async () => {
      log.push(`undo ${label}`);
    },
    redo: async () => {
      log.push(`redo ${label}`);
    },
  };
}

describe("History", () => {
  it("undoes and redoes in order and clears redo on push", async () => {
    const log: string[] = [];
    const h = new History();
    h.push(cmd("a", log));
    h.push(cmd("b", log));
    expect(h.canUndo()).toBe(true);
    expect(h.canRedo()).toBe(false);
    expect((await h.undo())?.label).toBe("b");
    expect((await h.undo())?.label).toBe("a");
    expect(await h.undo()).toBeNull();
    expect((await h.redo())?.label).toBe("a");
    h.push(cmd("c", log));
    expect(h.canRedo()).toBe(false);
    expect(log).toEqual(["undo b", "undo a", "redo a"]);
  });

  it("keeps a failing command in place and rethrows", async () => {
    const h = new History();
    h.push({
      label: "bad",
      undo: async () => {
        throw new Error("nope");
      },
      redo: async () => {},
    });
    await expect(h.undo()).rejects.toThrow("nope");
    expect(h.canUndo()).toBe(true);
  });

  it("caps the stack and notifies subscribers with a version", async () => {
    const h = new History(2);
    const listener = vi.fn();
    h.subscribe(listener);
    const log: string[] = [];
    h.push(cmd("a", log));
    h.push(cmd("b", log));
    h.push(cmd("c", log));
    expect(h.version).toBe(3);
    expect(listener).toHaveBeenCalledTimes(3);
    await h.undo();
    await h.undo();
    expect(await h.undo()).toBeNull();
    expect(log).toEqual(["undo c", "undo b"]);
    h.clear();
    expect(h.canRedo()).toBe(false);
  });
});
```

`frontend/src/editor/hotkeys.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { actionForKey, isTypingTarget, type KeyLike } from "./hotkeys";

function key(k: string, mods: Partial<KeyLike> = {}): KeyLike {
  return { type: "keydown", key: k, ctrlKey: false, metaKey: false, shiftKey: false, altKey: false, ...mods };
}

describe("actionForKey", () => {
  it("maps class keys and reserved editor keys", () => {
    expect(actionForKey(key("1"))).toEqual({ type: "class-key", key: "1" });
    expect(actionForKey(key("9"))).toEqual({ type: "class-key", key: "9" });
    expect(actionForKey(key("x"))).toEqual({ type: "class-key", key: "x" });
    expect(actionForKey(key("0"))).toEqual({ type: "one-to-one" });
    expect(actionForKey(key("1", { ctrlKey: true }))).toEqual({ type: "one-to-one" });
    expect(actionForKey(key("f"))).toEqual({ type: "fit" });
    expect(actionForKey(key("F"))).toEqual({ type: "fit" });
    expect(actionForKey(key("a"))).toEqual({ type: "accept-all" });
    expect(actionForKey(key("r"))).toEqual({ type: "reject-all" });
    expect(actionForKey(key("Delete"))).toEqual({ type: "delete" });
    expect(actionForKey(key("Backspace"))).toEqual({ type: "delete" });
    expect(actionForKey(key("Escape"))).toEqual({ type: "escape" });
  });

  it("maps control chords, treating meta as control", () => {
    expect(actionForKey(key("d", { ctrlKey: true }))).toEqual({ type: "duplicate" });
    expect(actionForKey(key("z", { ctrlKey: true }))).toEqual({ type: "undo" });
    expect(actionForKey(key("y", { ctrlKey: true }))).toEqual({ type: "redo" });
    expect(actionForKey(key("Z", { ctrlKey: true, shiftKey: true }))).toEqual({ type: "redo" });
    expect(actionForKey(key("ArrowRight", { metaKey: true }))).toEqual({ type: "next" });
    expect(actionForKey(key("ArrowLeft", { ctrlKey: true }))).toEqual({ type: "prev" });
    expect(actionForKey(key("x", { ctrlKey: true }))).toBeNull();
    expect(actionForKey(key("x", { altKey: true }))).toBeNull();
  });

  it("tracks the space bar without auto-repeat", () => {
    expect(actionForKey(key(" "))).toEqual({ type: "space-down" });
    expect(actionForKey(key(" ", { repeat: true }))).toBeNull();
    expect(actionForKey({ ...key(" "), type: "keyup" })).toEqual({ type: "space-up" });
    expect(actionForKey({ ...key("f"), type: "keyup" })).toBeNull();
  });

  it("ignores shifted letters and non-printable keys", () => {
    expect(actionForKey(key("X", { shiftKey: true }))).toBeNull();
    expect(actionForKey(key("ArrowUp"))).toBeNull();
  });
});

describe("isTypingTarget", () => {
  it("is true for inputs, textareas and selects", () => {
    expect(isTypingTarget(document.createElement("input"))).toBe(true);
    expect(isTypingTarget(document.createElement("textarea"))).toBe(true);
    expect(isTypingTarget(document.createElement("select"))).toBe(true);
    expect(isTypingTarget(document.createElement("div"))).toBe(false);
    expect(isTypingTarget(null)).toBe(false);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm test src/editor/history.test.ts src/editor/hotkeys.test.ts`
Expected: both FAIL with unresolved imports.

- [ ] **Step 3: Implement `history.ts`**

```ts
export interface Command {
  label: string;
  undo: () => Promise<void>;
  redo: () => Promise<void>;
}

/** Shared by a command's undo and redo: redoing a create yields a new server id. */
export interface BoxRef {
  id: string;
}

/** Per-image undo/redo stack of compensating API calls (spec section 6). */
export class History {
  private undoStack: Command[] = [];
  private redoStack: Command[] = [];
  private listeners = new Set<() => void>();
  version = 0;

  constructor(private readonly limit = 100) {}

  push(cmd: Command): void {
    this.undoStack.push(cmd);
    if (this.undoStack.length > this.limit) this.undoStack.shift();
    this.redoStack = [];
    this.bump();
  }

  canUndo(): boolean {
    return this.undoStack.length > 0;
  }

  canRedo(): boolean {
    return this.redoStack.length > 0;
  }

  async undo(): Promise<Command | null> {
    const cmd = this.undoStack[this.undoStack.length - 1];
    if (!cmd) return null;
    await cmd.undo();
    this.undoStack.pop();
    this.redoStack.push(cmd);
    this.bump();
    return cmd;
  }

  async redo(): Promise<Command | null> {
    const cmd = this.redoStack[this.redoStack.length - 1];
    if (!cmd) return null;
    await cmd.redo();
    this.redoStack.pop();
    this.undoStack.push(cmd);
    this.bump();
    return cmd;
  }

  clear(): void {
    this.undoStack = [];
    this.redoStack = [];
    this.bump();
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private bump(): void {
    this.version += 1;
    this.listeners.forEach((l) => l());
  }
}
```

- [ ] **Step 4: Implement `hotkeys.ts`**

```ts
export type EditorAction =
  | { type: "class-key"; key: string }
  | { type: "fit" }
  | { type: "one-to-one" }
  | { type: "delete" }
  | { type: "duplicate" }
  | { type: "accept-all" }
  | { type: "reject-all" }
  | { type: "next" }
  | { type: "prev" }
  | { type: "undo" }
  | { type: "redo" }
  | { type: "escape" }
  | { type: "space-down" }
  | { type: "space-up" };

export interface KeyLike {
  type: "keydown" | "keyup";
  key: string;
  ctrlKey: boolean;
  metaKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
  repeat?: boolean;
}

/**
 * Spec section 6 lists both "1:1 (1)" and class hotkeys 1 to 9. Decision: digits select classes,
 * `0` and `Ctrl+1` are 1:1, `F` fits. Letters `a`, `r`, `f` are editor keys and cannot be class hotkeys.
 */
export function actionForKey(e: KeyLike): EditorAction | null {
  const ctrl = e.ctrlKey || e.metaKey;
  if (e.key === " ") {
    if (e.type === "keyup") return { type: "space-up" };
    return e.repeat ? null : { type: "space-down" };
  }
  if (e.type !== "keydown") return null;
  const lower = e.key.toLowerCase();
  if (ctrl && e.shiftKey && !e.altKey && lower === "z") return { type: "redo" };
  if (ctrl && !e.shiftKey && !e.altKey) {
    switch (lower) {
      case "z":
        return { type: "undo" };
      case "y":
        return { type: "redo" };
      case "d":
        return { type: "duplicate" };
      case "1":
        return { type: "one-to-one" };
      case "arrowright":
        return { type: "next" };
      case "arrowleft":
        return { type: "prev" };
      default:
        return null;
    }
  }
  if (ctrl || e.altKey) return null;
  if (e.key === "Escape") return { type: "escape" };
  if (e.key === "Delete" || e.key === "Backspace") return { type: "delete" };
  if (e.shiftKey) return null;
  if (lower === "f") return { type: "fit" };
  if (lower === "0") return { type: "one-to-one" };
  if (lower === "a") return { type: "accept-all" };
  if (lower === "r") return { type: "reject-all" };
  if (e.key.length === 1) return { type: "class-key", key: e.key };
  return null;
}

export function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || target.isContentEditable;
}

export const HOTKEY_HELP: ReadonlyArray<{ keys: string; does: string }> = [
  { keys: "1-9", does: "select class" },
  { keys: "drag", does: "draw a box with the active class" },
  { keys: "wheel", does: "zoom" },
  { keys: "space + drag", does: "pan" },
  { keys: "F", does: "fit image" },
  { keys: "0 / Ctrl+1", does: "1:1" },
  { keys: "Delete", does: "delete selected box" },
  { keys: "Ctrl+D", does: "duplicate selected box" },
  { keys: "A", does: "accept all visible proposals" },
  { keys: "R", does: "reject all visible proposals" },
  { keys: "Ctrl+Z / Ctrl+Y", does: "undo / redo" },
  { keys: "Ctrl+Right / Ctrl+Left", does: "next / previous image" },
  { keys: "Esc", does: "deselect" },
];
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `pnpm test src/editor/history.test.ts src/editor/hotkeys.test.ts`
Expected: `Test Files 2 passed`, `Tests 8 passed`.

- [ ] **Step 6: Commit**

```bash
git add src/editor/history.ts src/editor/history.test.ts src/editor/hotkeys.ts src/editor/hotkeys.test.ts
git commit -m "feat(ui): editor undo history and hotkey map"
```

---

### Task 5: API wrappers for project, images and boxes

**Files:**
- Create: `frontend/src/api/project.ts`, `frontend/src/api/images.ts`, `frontend/src/api/boxes.ts`
- Test: `frontend/src/api/images.test.ts`, `frontend/src/api/boxes.test.ts`, `frontend/src/api/project.test.tsx`

**Interfaces:**
- Consumes: `unwrap`, `ApiFailure` from `errors.ts`; `useApi` from `client.tsx`; `fakeClient` and fixtures; `TestApiProvider`.
- Produces (every function takes the client explicitly so it is testable without React):
  - `images.ts`: `type ListImagesQuery = NonNullable<paths["/api/v1/projects/{projectId}/images"]["get"]["parameters"]["query"]>`; `type PreannotateResult = components["schemas"]["PreannotateResult"]`; `IMAGE_PAGE_SIZE = 200`; `REVIEW_QUEUE_QUERY: ListImagesQuery = {has_pending: true, sort: "max_pending_confidence", order: "desc"}`; `fetchImagePage(api, projectId, query): Promise<ImagePage>`; `fetchImage(api, projectId, imageId): Promise<ImageRow>`; `bulkDeleteImages(api, projectId, imageIds): Promise<number>`; `preannotateImage(api, projectId, imageId): Promise<PreannotateResult>`.
  - `boxes.ts`: `fetchBoxes(api, projectId, imageId): Promise<Box[]>`; `createBox(api, projectId, imageId, body: BoxCreate): Promise<Box>`; `updateBox(api, projectId, boxId, body: BoxUpdate): Promise<Box>`; `deleteBox(api, projectId, boxId): Promise<void>`; `reviewBoxes(api, projectId, boxIds, action: "accept" | "reject"): Promise<number>`.
  - `project.ts`: `type ProjectUpdate = components["schemas"]["ProjectUpdate"]`; `fetchProject(api, projectId): Promise<Project>`; `saveClasses(api, projectId, classes: ClassDefInput[]): Promise<Project>`; `patchProject(api, projectId, patch: ProjectUpdate): Promise<Project>`; `fetchModels(api, projectId): Promise<Model[]>`; `fetchSources(api, projectId): Promise<Source[]>`; hooks `useProject(projectId): {project: Project | null; error: string | null; reload(): void; setProject(p: Project): void}` and `useSourceNames(projectId): Record<string, string>` (source id -> site; `{}` when the endpoint fails, including 501).

- [ ] **Step 1: Write the failing tests**

`frontend/src/api/images.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { exampleImage, exampleImagePage, fakeClient, PROJECT_ID, IMAGE_ID, proposalBox, errorBody } from "@/test/fixtures";
import { bulkDeleteImages, fetchImage, fetchImagePage, preannotateImage, REVIEW_QUEUE_QUERY } from "./images";
import { ApiFailure } from "./errors";

describe("images api", () => {
  it("lists with filters and sort in the query string", async () => {
    const { api, requests } = fakeClient([{ method: "GET", path: /\/images$/, body: exampleImagePage }]);
    const page = await fetchImagePage(api, PROJECT_ID, { ...REVIEW_QUEUE_QUERY, limit: 50, search: "0031" });
    expect(page.total).toBe(2);
    const url = new URL(`http://x${requests[0].url}`);
    expect(url.pathname).toBe(`/api/v1/projects/${PROJECT_ID}/images`);
    expect(url.searchParams.get("has_pending")).toBe("true");
    expect(url.searchParams.get("sort")).toBe("max_pending_confidence");
    expect(url.searchParams.get("order")).toBe("desc");
    expect(url.searchParams.get("limit")).toBe("50");
    expect(url.searchParams.get("search")).toBe("0031");
  });

  it("gets one image and bulk-deletes", async () => {
    const { api, requests } = fakeClient([
      { method: "GET", path: /\/images\/[^/]+$/, body: exampleImage },
      { method: "POST", path: /\/images\/bulk-delete$/, body: { deleted: 2 } },
    ]);
    expect((await fetchImage(api, PROJECT_ID, IMAGE_ID)).id).toBe(IMAGE_ID);
    expect(await bulkDeleteImages(api, PROJECT_ID, ["a", "b"])).toBe(2);
    expect(requests[1]).toMatchObject({ method: "POST", body: { image_ids: ["a", "b"] } });
  });

  it("pre-annotates with no body and surfaces 501 as ApiFailure", async () => {
    const { api, requests } = fakeClient([
      { method: "POST", path: /\/preannotate$/, body: { skipped: false, model_id: "m", items: [proposalBox] } },
    ]);
    const r = await preannotateImage(api, PROJECT_ID, IMAGE_ID);
    expect(r.items).toHaveLength(1);
    expect(requests[0].body).toBeNull();
    const stub = fakeClient([
      { method: "POST", path: /\/preannotate$/, status: 501, body: errorBody("not_implemented", "S4 later") },
    ]);
    await expect(preannotateImage(stub.api, PROJECT_ID, IMAGE_ID)).rejects.toMatchObject({ code: "not_implemented", status: 501 });
    await expect(preannotateImage(stub.api, PROJECT_ID, IMAGE_ID)).rejects.toBeInstanceOf(ApiFailure);
  });
});
```

`frontend/src/api/boxes.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { fakeClient, PROJECT_ID, IMAGE_ID, personBox, proposalBox, CLASS_ID } from "@/test/fixtures";
import { createBox, deleteBox, fetchBoxes, reviewBoxes, updateBox } from "./boxes";

describe("boxes api", () => {
  it("lists, creates, updates, deletes and reviews through the contract paths", async () => {
    const { api, requests } = fakeClient([
      { method: "GET", path: /\/boxes$/, body: { items: [personBox, proposalBox] } },
      { method: "POST", path: /\/images\/[^/]+\/boxes$/, status: 201, body: personBox },
      { method: "PATCH", path: /\/boxes\/[^/]+$/, body: { ...proposalBox, review_state: "edited" } },
      { method: "DELETE", path: /\/boxes\/[^/]+$/, status: 204 },
      { method: "POST", path: /\/boxes\/review$/, body: { updated: 2 } },
    ]);
    expect(await fetchBoxes(api, PROJECT_ID, IMAGE_ID)).toHaveLength(2);
    const created = await createBox(api, PROJECT_ID, IMAGE_ID, { class_id: CLASS_ID(1), x: 1, y: 2, w: 3, h: 4 });
    expect(created.id).toBe(personBox.id);
    const updated = await updateBox(api, PROJECT_ID, proposalBox.id, { x: 10, y: 20 });
    expect(updated.review_state).toBe("edited");
    await deleteBox(api, PROJECT_ID, personBox.id);
    expect(await reviewBoxes(api, PROJECT_ID, ["a", "b"], "accept")).toBe(2);

    expect(requests.map((r) => `${r.method} ${r.url}`)).toEqual([
      `GET /api/v1/projects/${PROJECT_ID}/images/${IMAGE_ID}/boxes`,
      `POST /api/v1/projects/${PROJECT_ID}/images/${IMAGE_ID}/boxes`,
      `PATCH /api/v1/projects/${PROJECT_ID}/boxes/${proposalBox.id}`,
      `DELETE /api/v1/projects/${PROJECT_ID}/boxes/${personBox.id}`,
      `POST /api/v1/projects/${PROJECT_ID}/boxes/review`,
    ]);
    expect(requests[1].body).toEqual({ class_id: CLASS_ID(1), x: 1, y: 2, w: 3, h: 4 });
    expect(requests[2].body).toEqual({ x: 10, y: 20 });
    expect(requests[4].body).toEqual({ box_ids: ["a", "b"], action: "accept" });
  });
});
```

`frontend/src/api/project.test.tsx`:

```tsx
import type { ReactNode } from "react";
import { describe, it, expect } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { exampleModel, exampleProject, errorBody, fakeClient, PROJECT_ID, CLASS_ID, SOURCE_ID } from "@/test/fixtures";
import { TestApiProvider } from "@/test/render";
import { fetchModels, patchProject, saveClasses, useProject, useSourceNames } from "./project";

describe("project api", () => {
  it("saves classes with PUT and patches the project", async () => {
    const { api, requests } = fakeClient([
      { method: "PUT", path: /\/classes$/, body: exampleProject },
      { method: "PATCH", path: /\/projects\/[^/]+$/, body: exampleProject },
      { method: "GET", path: /\/models$/, body: { items: [exampleModel], next_cursor: null } },
    ]);
    await saveClasses(api, PROJECT_ID, [{ id: CLASS_ID(1), name: "digger", colour: "#ffffff", hotkey: "1" }]);
    await patchProject(api, PROJECT_ID, { preannotation_model_id: null });
    expect((await fetchModels(api, PROJECT_ID))[0].name).toBe("yolo11m-coco");
    expect(requests[0]).toMatchObject({ method: "PUT", url: `/api/v1/projects/${PROJECT_ID}/classes` });
    expect(requests[0].body).toEqual([{ id: CLASS_ID(1), name: "digger", colour: "#ffffff", hotkey: "1" }]);
    expect(requests[1]).toMatchObject({ method: "PATCH", body: { preannotation_model_id: null } });
  });

  it("useProject loads the project; useSourceNames tolerates 501 and maps ids to sites", async () => {
    const stub = fakeClient([
      { method: "GET", path: /\/projects\/[^/]+$/, body: exampleProject },
      { method: "GET", path: /\/sources$/, status: 501, body: errorBody("not_implemented", "S1 later") },
    ]);
    const wrapper = ({ children }: { children: ReactNode }) => <TestApiProvider api={stub.api}>{children}</TestApiProvider>;
    const { result } = renderHook(() => useProject(PROJECT_ID), { wrapper });
    await waitFor(() => expect(result.current.project?.name).toBe("Ahmadia"));
    const names = renderHook(() => useSourceNames(PROJECT_ID), { wrapper });
    await waitFor(() => expect(stub.requests.some((r) => r.url.endsWith("/sources"))).toBe(true));
    expect(names.result.current).toEqual({});

    const ok = fakeClient([
      {
        method: "GET",
        path: /\/sources$/,
        body: {
          items: [
            {
              id: SOURCE_ID,
              folder: "E:\\data",
              site: "ahmadia",
              settings: exampleProject.import_defaults,
              image_count: 1,
              duplicate_count: 0,
              job_id: null,
              imported_at: null,
              created_at: "2026-09-17T10:05:00Z",
            },
          ],
          next_cursor: null,
        },
      },
    ]);
    const wrapper2 = ({ children }: { children: ReactNode }) => <TestApiProvider api={ok.api}>{children}</TestApiProvider>;
    const names2 = renderHook(() => useSourceNames(PROJECT_ID), { wrapper: wrapper2 });
    await waitFor(() => expect(names2.result.current).toEqual({ [SOURCE_ID]: "ahmadia" }));
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm test src/api/images.test.ts src/api/boxes.test.ts src/api/project.test.tsx`
Expected: all FAIL with unresolved imports.

- [ ] **Step 3: Implement `images.ts`**

```ts
import type { ApiClient, ImagePage, Image as ImageRow, components, paths } from "@contract/client";
import { unwrap } from "./errors";

export type ListImagesQuery = NonNullable<paths["/api/v1/projects/{projectId}/images"]["get"]["parameters"]["query"]>;
export type PreannotateResult = components["schemas"]["PreannotateResult"];

export const IMAGE_PAGE_SIZE = 200;

/** Spec section 6 screen 4: images with unreviewed proposals, highest proposal confidence first. */
export const REVIEW_QUEUE_QUERY: ListImagesQuery = { has_pending: true, sort: "max_pending_confidence", order: "desc" };

export function fetchImagePage(api: ApiClient, projectId: string, query: ListImagesQuery): Promise<ImagePage> {
  return unwrap(api.GET("/api/v1/projects/{projectId}/images", { params: { path: { projectId }, query } }));
}

export function fetchImage(api: ApiClient, projectId: string, imageId: string): Promise<ImageRow> {
  return unwrap(api.GET("/api/v1/projects/{projectId}/images/{imageId}", { params: { path: { projectId, imageId } } }));
}

export async function bulkDeleteImages(api: ApiClient, projectId: string, imageIds: string[]): Promise<number> {
  const r = await unwrap(
    api.POST("/api/v1/projects/{projectId}/images/bulk-delete", {
      params: { path: { projectId } },
      body: { image_ids: imageIds },
    }),
  );
  return r.deleted;
}

/** No body: the backend uses the project's pre-annotation model and its defaults. */
export function preannotateImage(api: ApiClient, projectId: string, imageId: string): Promise<PreannotateResult> {
  return unwrap(
    api.POST("/api/v1/projects/{projectId}/images/{imageId}/preannotate", { params: { path: { projectId, imageId } } }),
  );
}
```

- [ ] **Step 4: Implement `boxes.ts`**

```ts
import type { ApiClient, Box, BoxCreate, BoxUpdate } from "@contract/client";
import { unwrap } from "./errors";

export async function fetchBoxes(api: ApiClient, projectId: string, imageId: string): Promise<Box[]> {
  const r = await unwrap(
    api.GET("/api/v1/projects/{projectId}/images/{imageId}/boxes", { params: { path: { projectId, imageId } } }),
  );
  return r.items;
}

export function createBox(api: ApiClient, projectId: string, imageId: string, body: BoxCreate): Promise<Box> {
  return unwrap(
    api.POST("/api/v1/projects/{projectId}/images/{imageId}/boxes", { params: { path: { projectId, imageId } }, body }),
  );
}

export function updateBox(api: ApiClient, projectId: string, boxId: string, body: BoxUpdate): Promise<Box> {
  return unwrap(api.PATCH("/api/v1/projects/{projectId}/boxes/{boxId}", { params: { path: { projectId, boxId } }, body }));
}

export async function deleteBox(api: ApiClient, projectId: string, boxId: string): Promise<void> {
  await unwrap<unknown>(api.DELETE("/api/v1/projects/{projectId}/boxes/{boxId}", { params: { path: { projectId, boxId } } }));
}

export async function reviewBoxes(
  api: ApiClient,
  projectId: string,
  boxIds: string[],
  action: "accept" | "reject",
): Promise<number> {
  const r = await unwrap(
    api.POST("/api/v1/projects/{projectId}/boxes/review", {
      params: { path: { projectId } },
      body: { box_ids: boxIds, action },
    }),
  );
  return r.updated;
}
```

- [ ] **Step 5: Implement `project.ts`**

```ts
import { useCallback, useEffect, useState } from "react";
import type { ApiClient, ClassDefInput, Model, Project, Source, components } from "@contract/client";
import { useApi } from "./client";
import { messageOf, unwrap } from "./errors";
import { pushLog } from "@/app/diagnostics";

export type ProjectUpdate = components["schemas"]["ProjectUpdate"];

export function fetchProject(api: ApiClient, projectId: string): Promise<Project> {
  return unwrap(api.GET("/api/v1/projects/{projectId}", { params: { path: { projectId } } }));
}

/** Replace the class list; items with an `id` keep it. 409 `class_in_use` when a removed class still has boxes. */
export function saveClasses(api: ApiClient, projectId: string, classes: ClassDefInput[]): Promise<Project> {
  return unwrap(api.PUT("/api/v1/projects/{projectId}/classes", { params: { path: { projectId } }, body: classes }));
}

export function patchProject(api: ApiClient, projectId: string, patch: ProjectUpdate): Promise<Project> {
  return unwrap(api.PATCH("/api/v1/projects/{projectId}", { params: { path: { projectId } }, body: patch }));
}

/** May reject with 501 until S3 lands; callers decide how to degrade. */
export async function fetchModels(api: ApiClient, projectId: string): Promise<Model[]> {
  const r = await unwrap(api.GET("/api/v1/projects/{projectId}/models", { params: { path: { projectId } } }));
  return r.items;
}

/** May reject with 501 until S1 lands. */
export async function fetchSources(api: ApiClient, projectId: string): Promise<Source[]> {
  const r = await unwrap(api.GET("/api/v1/projects/{projectId}/sources", { params: { path: { projectId } } }));
  return r.items;
}

export function useProject(projectId: string): {
  project: Project | null;
  error: string | null;
  reload: () => void;
  setProject: (p: Project) => void;
} {
  const api = useApi();
  const [project, setProject] = useState<Project | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let cancelled = false;
    fetchProject(api, projectId)
      .then((p) => {
        if (!cancelled) setProject(p);
      })
      .catch((e: unknown) => {
        if (cancelled) return;
        pushLog(`load project failed: ${messageOf(e, String(e))}`);
        setError(messageOf(e, "could not load the project"));
      });
    return () => {
      cancelled = true;
    };
  }, [api, projectId, attempt]);
  const reload = useCallback(() => setAttempt((a) => a + 1), []);
  return { project, error, reload, setProject };
}

/** Source id -> site name for the Data Manager's source column; empty when sources are unavailable. */
export function useSourceNames(projectId: string): Record<string, string> {
  const api = useApi();
  const [names, setNames] = useState<Record<string, string>>({});
  useEffect(() => {
    let cancelled = false;
    fetchSources(api, projectId)
      .then((items) => {
        if (!cancelled) setNames(Object.fromEntries(items.map((s) => [s.id, s.site])));
      })
      .catch((e: unknown) => {
        pushLog(`sources unavailable: ${messageOf(e, String(e))}`);
        if (!cancelled) setNames({});
      });
    return () => {
      cancelled = true;
    };
  }, [api, projectId]);
  return names;
}
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `pnpm test src/api`
Expected: `Test Files 5 passed` (backend, errors, images, boxes, project).

- [ ] **Step 7: Commit**

```bash
git add src/api/images.ts src/api/images.test.ts src/api/boxes.ts src/api/boxes.test.ts src/api/project.ts src/api/project.test.tsx
git commit -m "feat(ui): api wrappers for project, images and boxes with fake-fetch tests"
```

---

### Task 6: Change-notification and navigation stores, event wiring

**Files:**
- Create: `frontend/src/store/changes.ts`, `frontend/src/store/navigation.ts`
- Modify: `frontend/src/App.tsx` (the `EventsBridge` handler)
- Test: `frontend/src/store/changes.test.ts`, `frontend/src/store/navigation.test.ts`

**Interfaces:**
- Consumes: `AppEvent` from `@contract/client`; `useJobsStore`.
- Produces:
  - `useChangesStore`: `imagesRevision: number`, `boxesRevision: Record<string, number>`, `applyEvent(ev: AppEvent)`, `bumpImages()`. `images.changed` bumps `imagesRevision`; `boxes.changed` bumps `boxesRevision[id]` for each id in `payload.image_ids` and also `imagesRevision` (counts changed). Other event types are ignored.
  - `useNavigationStore`: `ids: string[]`, `source: NavSource` where `type NavSource = "data" | "review" | "selection" | null`, `setContext(ids: string[], source: NavSource)`, `neighbours(id): {prev: string | null; next: string | null; index: number; count: number}` (`index` is -1 when the id is not in the list).
  - `App.tsx` `EventsBridge` passes one handler that calls both `useJobsStore.getState().applyEvent(ev)` and `useChangesStore.getState().applyEvent(ev)`.

- [ ] **Step 1: Write the failing tests**

`frontend/src/store/changes.test.ts`:

```ts
import { describe, it, expect, beforeEach } from "vitest";
import type { AppEvent } from "@contract/client";
import { useChangesStore } from "./changes";

function ev(type: AppEvent["type"], payload: Record<string, unknown>): AppEvent {
  return { type, project_id: "p", job_id: "j", progress: null, message: "", payload };
}

describe("changes store", () => {
  beforeEach(() => useChangesStore.setState({ imagesRevision: 0, boxesRevision: {} }));

  it("bumps the image revision on images.changed", () => {
    useChangesStore.getState().applyEvent(ev("images.changed", { source_id: "s", count: 50 }));
    expect(useChangesStore.getState().imagesRevision).toBe(1);
  });

  it("bumps per-image box revisions and the image revision on boxes.changed", () => {
    useChangesStore.getState().applyEvent(ev("boxes.changed", { image_ids: ["a", "b"] }));
    useChangesStore.getState().applyEvent(ev("boxes.changed", { image_ids: ["a"] }));
    expect(useChangesStore.getState().boxesRevision).toEqual({ a: 2, b: 1 });
    expect(useChangesStore.getState().imagesRevision).toBe(2);
  });

  it("ignores job events and malformed payloads", () => {
    useChangesStore.getState().applyEvent(ev("job.progress", {}));
    useChangesStore.getState().applyEvent(ev("boxes.changed", {}));
    expect(useChangesStore.getState().imagesRevision).toBe(0);
    expect(useChangesStore.getState().boxesRevision).toEqual({});
  });
});
```

`frontend/src/store/navigation.test.ts`:

```ts
import { describe, it, expect, beforeEach } from "vitest";
import { useNavigationStore } from "./navigation";

describe("navigation store", () => {
  beforeEach(() => useNavigationStore.getState().setContext([], null));

  it("walks the context in order", () => {
    useNavigationStore.getState().setContext(["a", "b", "c"], "data");
    const n = useNavigationStore.getState().neighbours;
    expect(n("a")).toEqual({ prev: null, next: "b", index: 0, count: 3 });
    expect(n("b")).toEqual({ prev: "a", next: "c", index: 1, count: 3 });
    expect(n("c")).toEqual({ prev: "b", next: null, index: 2, count: 3 });
    expect(n("zz")).toEqual({ prev: null, next: null, index: -1, count: 3 });
    expect(useNavigationStore.getState().source).toBe("data");
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm test src/store/changes.test.ts src/store/navigation.test.ts`
Expected: FAIL with unresolved imports.

- [ ] **Step 3: Implement `changes.ts`**

```ts
import { create } from "zustand";
import type { AppEvent } from "@contract/client";

interface ChangesState {
  /** Bumped whenever the image list may have changed (import batches, box counts). */
  imagesRevision: number;
  /** Per image id: bumped whenever a job wrote proposals or reviews on it. */
  boxesRevision: Record<string, number>;
  applyEvent: (ev: AppEvent) => void;
  bumpImages: () => void;
}

export const useChangesStore = create<ChangesState>((set) => ({
  imagesRevision: 0,
  boxesRevision: {},
  bumpImages: () => set((s) => ({ imagesRevision: s.imagesRevision + 1 })),
  applyEvent: (ev) =>
    set((s) => {
      if (ev.type === "images.changed") return { imagesRevision: s.imagesRevision + 1 };
      if (ev.type === "boxes.changed") {
        const ids = (ev.payload as { image_ids?: unknown }).image_ids;
        if (!Array.isArray(ids)) return s;
        const boxesRevision = { ...s.boxesRevision };
        for (const id of ids) if (typeof id === "string") boxesRevision[id] = (boxesRevision[id] ?? 0) + 1;
        return { boxesRevision, imagesRevision: s.imagesRevision + 1 };
      }
      return s;
    }),
}));
```

- [ ] **Step 4: Implement `navigation.ts`**

```ts
import { create } from "zustand";

export type NavSource = "data" | "review" | "selection" | null;

interface NavigationState {
  ids: string[];
  source: NavSource;
  setContext: (ids: string[], source: NavSource) => void;
  neighbours: (id: string) => { prev: string | null; next: string | null; index: number; count: number };
}

/** The ordered image ids the editor's Ctrl+Right / Ctrl+Left walk: set by whichever list opened the editor. */
export const useNavigationStore = create<NavigationState>((set, get) => ({
  ids: [],
  source: null,
  setContext: (ids, source) => set({ ids: [...ids], source }),
  neighbours: (id) => {
    const { ids } = get();
    const index = ids.indexOf(id);
    return {
      prev: index > 0 ? ids[index - 1] : null,
      next: index >= 0 && index < ids.length - 1 ? ids[index + 1] : null,
      index,
      count: ids.length,
    };
  },
}));
```

- [ ] **Step 5: Wire the events bridge**

In `frontend/src/App.tsx` add `import { useChangesStore } from "@/store/changes";` next to the jobs store import and replace `EventsBridge` with:

```tsx
/** Keeps the jobs and change stores fed by the backend event websocket for as long as the app is mounted. */
function EventsBridge({ children }: { children: ReactNode }) {
  const info = useBackend();
  useEffect(
    () =>
      connectEvents(eventsUrl(info.baseUrl, info.token), (ev) => {
        useJobsStore.getState().applyEvent(ev);
        useChangesStore.getState().applyEvent(ev);
      }),
    [info.baseUrl, info.token],
  );
  return children;
}
```

- [ ] **Step 6: Run the whole unit suite**

Run: `pnpm test && pnpm exec tsc -b`
Expected: every file passes (S0's 7 tests plus the new ones); tsc silent.

- [ ] **Step 7: Commit**

```bash
git add src/store/changes.ts src/store/changes.test.ts src/store/navigation.ts src/store/navigation.test.ts src/App.tsx
git commit -m "feat(ui): change-notification and navigation stores wired to websocket events"
```

---

### Task 7: Data Manager model: list query, selection, virtualisation, image list hook

**Files:**
- Create: `frontend/src/data/listModel.ts`, `frontend/src/data/selection.ts`, `frontend/src/data/useVirtualRows.ts`, `frontend/src/data/useImageList.ts`
- Test: `frontend/src/data/listModel.test.ts`, `frontend/src/data/selection.test.ts`, `frontend/src/data/useVirtualRows.test.ts`, `frontend/src/data/useImageList.test.tsx`

**Interfaces:**
- Consumes: `ListImagesQuery`, `fetchImagePage`, `IMAGE_PAGE_SIZE` from `api/images.ts`; `useChangesStore`; `useApi`.
- Produces:
  - `listModel.ts`: `type ViewMode = "grid" | "list"`, `type SortKey = NonNullable<ListImagesQuery["sort"]>`, `type Order = "asc" | "desc"`, `type TriState = "all" | "yes" | "no"`, `interface ImageFilters {search: string; sourceId: string; groupKey: string; labeled: TriState; pending: TriState; minBoxes: number | null; captureFrom: string; captureTo: string}`, `interface ListQuery {filters: ImageFilters; sort: SortKey; order: Order}`, `DEFAULT_FILTERS`, `DEFAULT_QUERY`, `toImageParams(q: ListQuery, limit: number, cursor?: string): ListImagesQuery`, `applyClientFilters(items: ImageRow[], f: ImageFilters): ImageRow[]` (`minBoxes`, `captureFrom`, `captureTo` are client-side because the contract has no such filters), `toggleSort(q: ListQuery, key: SortKey): ListQuery`, `formatCaptureTime(iso: string | null): string` (`YYYY-MM-DD HH:mm` in UTC, `""` for null), `interface RowContext {sourceNames: Record<string, string>}`, `interface ColumnDef {key: string; label: string; sortKey?: SortKey; width: string; render: (img: ImageRow, ctx: RowContext) => ReactNode}`, `DATA_COLUMNS: ColumnDef[]` (file, source, group, labeled, boxes, pending, captured), `REVIEW_COLUMNS: ColumnDef[]` (file, group, pending, top confidence, boxes), `type ListKeyAction = {type: "move"; delta: number} | {type: "open"} | {type: "toggle"} | {type: "select-all"} | {type: "clear"}`, `keyboardAction(e: {key: string; ctrlKey: boolean; metaKey: boolean}): ListKeyAction | null` (J/ArrowDown +1, K/ArrowUp -1, Enter open, Space toggle, Ctrl+A select-all, Escape clear).
  - `selection.ts`: `interface SelectionState {selected: ReadonlySet<string>; anchor: string | null}`, `EMPTY_SELECTION`, `clickSelect(state, ids, id, mod: {shift: boolean; ctrl: boolean}): SelectionState`, `toggleSelect(state, id): SelectionState`, `selectAll(ids): SelectionState`, `clearSelection(): SelectionState`, `pruneSelection(state, ids): SelectionState`.
  - `useVirtualRows.ts`: `interface RowWindow {start: number; end: number; offsetTop: number; totalHeight: number}`, `computeWindow(scrollTop, viewportHeight, rowHeight, count, overscan = 4): RowWindow` (pure), and `useVirtualRows({rowHeight, fallbackHeight?}): VirtualViewport` where `interface VirtualViewport {containerRef: RefObject<HTMLDivElement>; width: number; height: number; scrollTop: number; onScroll(): void; scrollToIndex(i: number): void}`. Callers combine the two: `const vp = useVirtualRows({rowHeight}); const win = computeWindow(vp.scrollTop, vp.height, rowHeight, count);` so the grid can derive its column count from `vp.width` before computing rows.
  - `useImageList.ts`: `interface ImageList {items: ImageRow[]; total: number; loading: boolean; error: string | null; hasMore: boolean; loadMore(): void; reload(): void}`, `useImageList(projectId: string, query: ListImagesQuery, pageSize = IMAGE_PAGE_SIZE): ImageList`; refetches the first page when `query` (by value), `projectId` or `useChangesStore.imagesRevision` change; `loadMore` appends the next cursor page.

- [ ] **Step 1: Write the failing tests**

`frontend/src/data/listModel.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { exampleImage, exampleImage2 } from "@/test/fixtures";
import {
  applyClientFilters,
  DATA_COLUMNS,
  DEFAULT_FILTERS,
  DEFAULT_QUERY,
  formatCaptureTime,
  keyboardAction,
  REVIEW_COLUMNS,
  toggleSort,
  toImageParams,
} from "./listModel";

describe("toImageParams", () => {
  it("sends only the server-side filters that are set", () => {
    expect(toImageParams(DEFAULT_QUERY, 200)).toEqual({ sort: "path", order: "asc", limit: 200 });
    const q = {
      filters: { ...DEFAULT_FILTERS, search: "0031", sourceId: "s", groupKey: "g", labeled: "yes" as const, pending: "no" as const, minBoxes: 2 },
      sort: "box_count" as const,
      order: "desc" as const,
    };
    expect(toImageParams(q, 50, "abc")).toEqual({
      sort: "box_count",
      order: "desc",
      limit: 50,
      cursor: "abc",
      search: "0031",
      source_id: "s",
      group_key: "g",
      labeled: true,
      has_pending: false,
    });
  });
});

describe("applyClientFilters", () => {
  it("filters by minimum box count and capture date range", () => {
    const items = [exampleImage, exampleImage2];
    expect(applyClientFilters(items, DEFAULT_FILTERS)).toHaveLength(2);
    expect(applyClientFilters(items, { ...DEFAULT_FILTERS, minBoxes: 1 }).map((i) => i.id)).toEqual([exampleImage.id]);
    expect(applyClientFilters(items, { ...DEFAULT_FILTERS, captureFrom: "2019-04-15", captureTo: "2019-04-15" })).toHaveLength(2);
    expect(applyClientFilters(items, { ...DEFAULT_FILTERS, captureFrom: "2019-04-16" })).toHaveLength(0);
    expect(applyClientFilters([{ ...exampleImage, capture_time: null }], { ...DEFAULT_FILTERS, captureTo: "2019-04-14" })).toHaveLength(0);
  });
});

describe("toggleSort / columns / formatting / keyboard", () => {
  it("flips the order on the same key and resets to asc on a new key", () => {
    const q1 = toggleSort(DEFAULT_QUERY, "path");
    expect(q1).toMatchObject({ sort: "path", order: "desc" });
    expect(toggleSort(q1, "capture_time")).toMatchObject({ sort: "capture_time", order: "asc" });
  });

  it("renders the seven data columns and the review columns", () => {
    expect(DATA_COLUMNS.map((c) => c.label)).toEqual(["File", "Source", "Group", "Labeled", "Boxes", "Pending", "Captured"]);
    const ctx = { sourceNames: { [exampleImage.source_id]: "ahmadia" } };
    expect(DATA_COLUMNS.map((c) => c.render(exampleImage, ctx))).toEqual([
      "IX-12-02491_0031_0001.jpg",
      "ahmadia",
      "IX-12-02491_0031",
      "yes",
      3,
      2,
      "2019-04-15 06:35",
    ]);
    expect(DATA_COLUMNS[1].render(exampleImage, { sourceNames: {} })).toBe("50000000");
    expect(REVIEW_COLUMNS.map((c) => c.label)).toEqual(["File", "Group", "Pending", "Top confidence", "Boxes"]);
    expect(REVIEW_COLUMNS[3].render(exampleImage, ctx)).toBe("81%");
    expect(REVIEW_COLUMNS[3].render(exampleImage2, ctx)).toBe("");
    expect(formatCaptureTime(null)).toBe("");
  });

  it("maps list keys", () => {
    const k = (key: string, ctrl = false) => keyboardAction({ key, ctrlKey: ctrl, metaKey: false });
    expect(k("j")).toEqual({ type: "move", delta: 1 });
    expect(k("K")).toEqual({ type: "move", delta: -1 });
    expect(k("ArrowDown")).toEqual({ type: "move", delta: 1 });
    expect(k("Enter")).toEqual({ type: "open" });
    expect(k(" ")).toEqual({ type: "toggle" });
    expect(k("a", true)).toEqual({ type: "select-all" });
    expect(k("Escape")).toEqual({ type: "clear" });
    expect(k("x")).toBeNull();
  });
});
```

`frontend/src/data/selection.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { clearSelection, clickSelect, EMPTY_SELECTION, pruneSelection, selectAll, toggleSelect } from "./selection";

const ids = ["a", "b", "c", "d"];

describe("selection", () => {
  it("plain click selects one and sets the anchor", () => {
    const s = clickSelect(EMPTY_SELECTION, ids, "b", { shift: false, ctrl: false });
    expect([...s.selected]).toEqual(["b"]);
    expect(s.anchor).toBe("b");
  });

  it("ctrl click toggles without touching the others", () => {
    let s = clickSelect(EMPTY_SELECTION, ids, "b", { shift: false, ctrl: false });
    s = clickSelect(s, ids, "d", { shift: false, ctrl: true });
    expect([...s.selected].sort()).toEqual(["b", "d"]);
    s = clickSelect(s, ids, "b", { shift: false, ctrl: true });
    expect([...s.selected]).toEqual(["d"]);
  });

  it("shift click selects the range from the anchor, adding with ctrl", () => {
    let s = clickSelect(EMPTY_SELECTION, ids, "b", { shift: false, ctrl: false });
    s = clickSelect(s, ids, "d", { shift: true, ctrl: false });
    expect([...s.selected]).toEqual(["b", "c", "d"]);
    expect(s.anchor).toBe("b");
    s = clickSelect(s, ids, "a", { shift: true, ctrl: false });
    expect([...s.selected]).toEqual(["a", "b"]);
    s = clickSelect(s, ids, "d", { shift: true, ctrl: true });
    expect([...s.selected].sort()).toEqual(["a", "b", "c", "d"]);
  });

  it("toggle, select all, clear and prune", () => {
    let s = toggleSelect(EMPTY_SELECTION, "c");
    expect([...s.selected]).toEqual(["c"]);
    s = selectAll(ids);
    expect(s.selected.size).toBe(4);
    s = pruneSelection(s, ["a", "c"]);
    expect([...s.selected].sort()).toEqual(["a", "c"]);
    expect(clearSelection().selected.size).toBe(0);
  });
});
```

`frontend/src/data/useVirtualRows.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { computeWindow } from "./useVirtualRows";

describe("computeWindow", () => {
  it("returns the visible rows plus overscan", () => {
    expect(computeWindow(0, 400, 40, 1000, 2)).toEqual({ start: 0, end: 12, offsetTop: 0, totalHeight: 40_000 });
    expect(computeWindow(4000, 400, 40, 1000, 2)).toEqual({ start: 98, end: 112, offsetTop: 3920, totalHeight: 40_000 });
    expect(computeWindow(39_900, 400, 40, 1000, 2)).toEqual({ start: 995, end: 1000, offsetTop: 39_800, totalHeight: 40_000 });
  });

  it("handles empty lists and a zero viewport", () => {
    expect(computeWindow(0, 0, 40, 0)).toEqual({ start: 0, end: 0, offsetTop: 0, totalHeight: 0 });
    expect(computeWindow(0, 0, 40, 10, 4)).toEqual({ start: 0, end: 4, offsetTop: 0, totalHeight: 400 });
  });
});
```

`frontend/src/data/useImageList.test.tsx`:

```tsx
import type { ReactNode } from "react";
import { describe, it, expect, beforeEach } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";
import { exampleImage, exampleImage2, fakeClient, PROJECT_ID } from "@/test/fixtures";
import { TestApiProvider } from "@/test/render";
import { useChangesStore } from "@/store/changes";
import { useImageList } from "./useImageList";

describe("useImageList", () => {
  beforeEach(() => useChangesStore.setState({ imagesRevision: 0, boxesRevision: {} }));

  it("loads the first page, appends the next cursor page and reloads on images.changed", async () => {
    const { api, requests } = fakeClient([
      {
        method: "GET",
        path: /\/images$/,
        body: (req) =>
          req.url.includes("cursor=c1")
            ? { items: [exampleImage2], next_cursor: null, total: 2 }
            : { items: [exampleImage], next_cursor: "c1", total: 2 },
      },
    ]);
    const wrapper = ({ children }: { children: ReactNode }) => <TestApiProvider api={api}>{children}</TestApiProvider>;
    const { result } = renderHook(() => useImageList(PROJECT_ID, { sort: "path", order: "asc" }, 1), { wrapper });
    await waitFor(() => expect(result.current.items).toHaveLength(1));
    expect(result.current.total).toBe(2);
    expect(result.current.hasMore).toBe(true);
    expect(requests[0].url).toContain("limit=1");

    act(() => result.current.loadMore());
    await waitFor(() => expect(result.current.items).toHaveLength(2));
    expect(result.current.hasMore).toBe(false);
    expect(requests[1].url).toContain("cursor=c1");

    act(() => useChangesStore.getState().bumpImages());
    await waitFor(() => expect(requests).toHaveLength(3));
    await waitFor(() => expect(result.current.items).toHaveLength(1));
  });

  it("exposes the error envelope message", async () => {
    const { api } = fakeClient([
      { method: "GET", path: /\/images$/, status: 501, body: { error: { code: "not_implemented", message: "images later", details: {} } } },
    ]);
    const wrapper = ({ children }: { children: ReactNode }) => <TestApiProvider api={api}>{children}</TestApiProvider>;
    const { result } = renderHook(() => useImageList(PROJECT_ID, { sort: "path", order: "asc" }), { wrapper });
    await waitFor(() => expect(result.current.error).toBe("images later"));
    expect(result.current.loading).toBe(false);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm test src/data`
Expected: 4 files FAIL with unresolved imports.

- [ ] **Step 3: Implement `listModel.ts`**

```ts
import type { ReactNode } from "react";
import type { Image as ImageRow } from "@contract/client";
import type { ListImagesQuery } from "@/api/images";

export type ViewMode = "grid" | "list";
export type SortKey = NonNullable<ListImagesQuery["sort"]>;
export type Order = "asc" | "desc";
export type TriState = "all" | "yes" | "no";

export interface ImageFilters {
  search: string;
  sourceId: string;
  groupKey: string;
  labeled: TriState;
  pending: TriState;
  /** Client-side over the loaded rows: the contract has no box_count filter. */
  minBoxes: number | null;
  /** Client-side, `YYYY-MM-DD`, inclusive; the contract has no capture_time filter. */
  captureFrom: string;
  captureTo: string;
}

export interface ListQuery {
  filters: ImageFilters;
  sort: SortKey;
  order: Order;
}

export const DEFAULT_FILTERS: ImageFilters = {
  search: "",
  sourceId: "",
  groupKey: "",
  labeled: "all",
  pending: "all",
  minBoxes: null,
  captureFrom: "",
  captureTo: "",
};

export const DEFAULT_QUERY: ListQuery = { filters: DEFAULT_FILTERS, sort: "path", order: "asc" };

export function toImageParams(q: ListQuery, limit: number, cursor?: string): ListImagesQuery {
  const p: ListImagesQuery = { sort: q.sort, order: q.order, limit };
  if (cursor) p.cursor = cursor;
  const f = q.filters;
  if (f.search) p.search = f.search;
  if (f.sourceId) p.source_id = f.sourceId;
  if (f.groupKey) p.group_key = f.groupKey;
  if (f.labeled !== "all") p.labeled = f.labeled === "yes";
  if (f.pending !== "all") p.has_pending = f.pending === "yes";
  return p;
}

export function applyClientFilters(items: ImageRow[], f: ImageFilters): ImageRow[] {
  return items.filter((i) => {
    if (f.minBoxes !== null && i.box_count < f.minBoxes) return false;
    if (f.captureFrom || f.captureTo) {
      if (!i.capture_time) return false;
      const day = i.capture_time.slice(0, 10);
      if (f.captureFrom && day < f.captureFrom) return false;
      if (f.captureTo && day > f.captureTo) return false;
    }
    return true;
  });
}

export function toggleSort(q: ListQuery, key: SortKey): ListQuery {
  if (q.sort === key) return { ...q, order: q.order === "asc" ? "desc" : "asc" };
  return { ...q, sort: key, order: "asc" };
}

/** `YYYY-MM-DD HH:mm` in UTC, deterministic across locales. */
export function formatCaptureTime(iso: string | null): string {
  return iso ? `${iso.slice(0, 10)} ${iso.slice(11, 16)}` : "";
}

export interface RowContext {
  sourceNames: Record<string, string>;
}

export interface ColumnDef {
  key: string;
  label: string;
  sortKey?: SortKey;
  /** CSS grid track size */
  width: string;
  render: (img: ImageRow, ctx: RowContext) => ReactNode;
}

const fileColumn: ColumnDef = { key: "file", label: "File", sortKey: "path", width: "minmax(16rem, 2fr)", render: (i) => i.file_name };
const groupColumn: ColumnDef = { key: "group", label: "Group", sortKey: "group_key", width: "minmax(8rem, 1fr)", render: (i) => i.group_key };
const boxesColumn: ColumnDef = { key: "boxes", label: "Boxes", sortKey: "box_count", width: "5rem", render: (i) => i.box_count };
const pendingColumn: ColumnDef = { key: "pending", label: "Pending", sortKey: "pending_count", width: "5rem", render: (i) => i.pending_count };

export const DATA_COLUMNS: ColumnDef[] = [
  fileColumn,
  {
    key: "source",
    label: "Source",
    sortKey: "source_id",
    width: "minmax(6rem, 1fr)",
    render: (i, ctx) => ctx.sourceNames[i.source_id] ?? i.source_id.slice(0, 8),
  },
  groupColumn,
  { key: "labeled", label: "Labeled", sortKey: "labeled", width: "5rem", render: (i) => (i.labeled ? "yes" : "no") },
  boxesColumn,
  pendingColumn,
  { key: "captured", label: "Captured", sortKey: "capture_time", width: "9rem", render: (i) => formatCaptureTime(i.capture_time) },
];

export const REVIEW_COLUMNS: ColumnDef[] = [
  fileColumn,
  groupColumn,
  pendingColumn,
  {
    key: "confidence",
    label: "Top confidence",
    sortKey: "max_pending_confidence",
    width: "8rem",
    render: (i) => (i.max_pending_confidence === null ? "" : `${Math.round(i.max_pending_confidence * 100)}%`),
  },
  boxesColumn,
];

export type ListKeyAction =
  | { type: "move"; delta: number }
  | { type: "open" }
  | { type: "toggle" }
  | { type: "select-all" }
  | { type: "clear" };

/** Spec section 6: J and K move, Enter opens; plus Space toggles selection, Ctrl+A selects all, Escape clears. */
export function keyboardAction(e: { key: string; ctrlKey: boolean; metaKey: boolean }): ListKeyAction | null {
  const ctrl = e.ctrlKey || e.metaKey;
  if (ctrl && e.key.toLowerCase() === "a") return { type: "select-all" };
  if (ctrl) return null;
  switch (e.key) {
    case "j":
    case "J":
    case "ArrowDown":
      return { type: "move", delta: 1 };
    case "k":
    case "K":
    case "ArrowUp":
      return { type: "move", delta: -1 };
    case "Enter":
      return { type: "open" };
    case " ":
      return { type: "toggle" };
    case "Escape":
      return { type: "clear" };
    default:
      return null;
  }
}
```

- [ ] **Step 4: Implement `selection.ts`**

```ts
export interface SelectionState {
  selected: ReadonlySet<string>;
  anchor: string | null;
}

export const EMPTY_SELECTION: SelectionState = { selected: new Set(), anchor: null };

/** Data Manager multi-select: click, Ctrl+click toggles, Shift+click ranges from the anchor. */
export function clickSelect(
  state: SelectionState,
  ids: string[],
  id: string,
  mod: { shift: boolean; ctrl: boolean },
): SelectionState {
  if (mod.shift && state.anchor) {
    const a = ids.indexOf(state.anchor);
    const b = ids.indexOf(id);
    if (a >= 0 && b >= 0) {
      const [lo, hi] = a < b ? [a, b] : [b, a];
      const range = ids.slice(lo, hi + 1);
      return { selected: new Set(mod.ctrl ? [...state.selected, ...range] : range), anchor: state.anchor };
    }
  }
  if (mod.ctrl) return { ...toggleSelect(state, id), anchor: id };
  return { selected: new Set([id]), anchor: id };
}

export function toggleSelect(state: SelectionState, id: string): SelectionState {
  const selected = new Set(state.selected);
  if (selected.has(id)) selected.delete(id);
  else selected.add(id);
  return { selected, anchor: state.anchor ?? id };
}

export function selectAll(ids: string[]): SelectionState {
  return { selected: new Set(ids), anchor: ids[0] ?? null };
}

export function clearSelection(): SelectionState {
  return EMPTY_SELECTION;
}

/** Drop ids that are no longer listed (after a reload or delete). */
export function pruneSelection(state: SelectionState, ids: string[]): SelectionState {
  const keep = new Set(ids);
  const selected = new Set([...state.selected].filter((id) => keep.has(id)));
  if (selected.size === state.selected.size) return state;
  return { selected, anchor: state.anchor && keep.has(state.anchor) ? state.anchor : null };
}
```

- [ ] **Step 5: Implement `useVirtualRows.ts`**

```ts
import { useCallback, useEffect, useRef, useState, type RefObject } from "react";

export interface RowWindow {
  start: number;
  end: number;
  offsetTop: number;
  totalHeight: number;
}

/** Rows [start, end) to render for a fixed row height, with `overscan` rows above and below. */
export function computeWindow(scrollTop: number, viewportHeight: number, rowHeight: number, count: number, overscan = 4): RowWindow {
  const totalHeight = count * rowHeight;
  if (count === 0) return { start: 0, end: 0, offsetTop: 0, totalHeight };
  const first = Math.floor(Math.max(0, scrollTop) / rowHeight);
  const visible = Math.ceil(viewportHeight / rowHeight);
  const start = Math.max(0, first - overscan);
  const end = Math.min(count, first + visible + overscan);
  return { start, end, offsetTop: start * rowHeight, totalHeight };
}

export interface VirtualViewport {
  containerRef: RefObject<HTMLDivElement>;
  width: number;
  height: number;
  scrollTop: number;
  onScroll: () => void;
  scrollToIndex: (index: number) => void;
}

/**
 * Scrolling viewport for a fixed-height row virtualiser; the container is the scrolling element
 * (`overflow-auto`). Callers pass `scrollTop` and `height` to `computeWindow`. The size comes only
 * from ResizeObserver callbacks (it delivers an initial notification on `observe`), so no state is
 * set synchronously inside the effect; jsdom has no ResizeObserver and falls back to
 * `fallbackHeight` and width 0.
 */
export function useVirtualRows(opts: { rowHeight: number; fallbackHeight?: number }): VirtualViewport {
  const { rowHeight, fallbackHeight = 600 } = opts;
  const containerRef = useRef<HTMLDivElement>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [size, setSize] = useState({ width: 0, height: 0 });

  useEffect(() => {
    const el = containerRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(() => setSize({ width: el.clientWidth, height: el.clientHeight }));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const onScroll = useCallback(() => {
    const el = containerRef.current;
    if (el) setScrollTop(el.scrollTop);
  }, []);

  const height = size.height || fallbackHeight;

  const scrollToIndex = useCallback(
    (index: number) => {
      const el = containerRef.current;
      if (!el) return;
      const top = index * rowHeight;
      const bottom = top + rowHeight;
      if (top < el.scrollTop) el.scrollTop = top;
      else if (bottom > el.scrollTop + height) el.scrollTop = bottom - height;
    },
    [rowHeight, height],
  );

  return { containerRef, width: size.width, height, scrollTop, onScroll, scrollToIndex };
}
```

- [ ] **Step 6: Implement `useImageList.ts`**

```ts
import { useCallback, useEffect, useRef, useState } from "react";
import type { Image as ImageRow } from "@contract/client";
import { useApi } from "@/api/client";
import { messageOf } from "@/api/errors";
import { fetchImagePage, IMAGE_PAGE_SIZE, type ListImagesQuery } from "@/api/images";
import { pushLog } from "@/app/diagnostics";
import { useChangesStore } from "@/store/changes";

export interface ImageList {
  items: ImageRow[];
  total: number;
  loading: boolean;
  error: string | null;
  hasMore: boolean;
  loadMore: () => void;
  reload: () => void;
}

interface State {
  /** The request key the data belongs to; `loading` is derived from `key !== requestKey`. */
  key: string | null;
  items: ImageRow[];
  total: number;
  cursor: string | null;
  error: string | null;
  more: boolean;
}

/**
 * Cursor-paginated image listing; the first page reloads whenever the query, the project or
 * `imagesRevision` changes. Loading is derived from a request key instead of set inside the
 * effect (React Compiler rule `set-state-in-effect`); stale rows stay visible while reloading.
 */
export function useImageList(projectId: string, query: ListImagesQuery, pageSize = IMAGE_PAGE_SIZE): ImageList {
  const api = useApi();
  const imagesRevision = useChangesStore((s) => s.imagesRevision);
  const [attempt, setAttempt] = useState(0);
  const queryKey = JSON.stringify(query);
  const requestKey = `${projectId}|${queryKey}|${pageSize}|${imagesRevision}|${attempt}`;
  const [state, setState] = useState<State>({ key: null, items: [], total: 0, cursor: null, error: null, more: false });
  const loadingMore = useRef(false);

  useEffect(() => {
    let cancelled = false;
    fetchImagePage(api, projectId, { ...(JSON.parse(queryKey) as ListImagesQuery), limit: pageSize })
      .then((page) => {
        if (cancelled) return;
        setState({ key: requestKey, items: page.items, total: page.total, cursor: page.next_cursor, error: null, more: false });
      })
      .catch((e: unknown) => {
        if (cancelled) return;
        pushLog(`list images failed: ${messageOf(e, String(e))}`);
        setState((s) => ({ ...s, key: requestKey, error: messageOf(e, "could not load images"), more: false }));
      });
    return () => {
      cancelled = true;
    };
  }, [api, projectId, queryKey, pageSize, requestKey]);

  const loaded = state.key === requestKey;
  const cursor = loaded ? state.cursor : null;

  const loadMore = useCallback(() => {
    if (!cursor || loadingMore.current) return;
    loadingMore.current = true;
    setState((s) => ({ ...s, more: true }));
    fetchImagePage(api, projectId, { ...(JSON.parse(queryKey) as ListImagesQuery), limit: pageSize, cursor })
      .then((page) => {
        setState((s) =>
          s.key === requestKey
            ? { ...s, items: [...s.items, ...page.items], total: page.total, cursor: page.next_cursor, more: false }
            : s,
        );
      })
      .catch((e: unknown) => {
        pushLog(`load more images failed: ${messageOf(e, String(e))}`);
        setState((s) => ({ ...s, error: messageOf(e, "could not load more images"), more: false }));
      })
      .finally(() => {
        loadingMore.current = false;
      });
  }, [api, projectId, queryKey, pageSize, cursor, requestKey]);

  const reload = useCallback(() => setAttempt((a) => a + 1), []);

  return {
    items: state.items,
    total: state.total,
    loading: !loaded || state.more,
    error: loaded ? state.error : null,
    hasMore: cursor !== null,
    loadMore,
    reload,
  };
}
```

- [ ] **Step 7: Run the tests to verify they pass**

Run: `pnpm test src/data`
Expected: `Test Files 4 passed`.

- [ ] **Step 8: Commit**

```bash
git add src/data/listModel.ts src/data/listModel.test.ts src/data/selection.ts src/data/selection.test.ts src/data/useVirtualRows.ts src/data/useVirtualRows.test.ts src/data/useImageList.ts src/data/useImageList.test.tsx
git commit -m "feat(ui): data manager list model, selection, virtualiser and image list hook"
```

---

### Task 8: Data Manager screen: filter bar, list view, grid view, keyboard

**Files:**
- Create: `frontend/src/data/FilterBar.tsx`, `frontend/src/data/ImageTable.tsx`, `frontend/src/data/ImageGrid.tsx`
- Modify: `frontend/src/screens/DataManagerScreen.tsx` (replace the placeholder)
- Test: `frontend/src/data/FilterBar.test.tsx`, `frontend/src/data/ImageTable.test.tsx`

**Interfaces:**
- Consumes: Task 7 modules; `useProject`, `useSourceNames`; `useImageList`; `useNavigationStore`; `thumbnailUrl`, `useBackend`.
- Produces:
  - `FilterBar({query, onChange, view, onView, sourceNames, total, loaded}: {query: ListQuery; onChange: (q: ListQuery) => void; view: ViewMode; onView: (v: ViewMode) => void; sourceNames: Record<string, string>; total: number; loaded: number})`. The search input debounces 300 ms; every other control emits immediately. Sort is a `<select aria-label="Sort by">` over `DATA_COLUMNS` with a sortKey plus an order toggle button `aria-label="Sort order"`.
  - `ImageTable(props: ImageTableProps)` where `interface ImageTableProps {items: ImageRow[]; columns: ColumnDef[]; rowContext: RowContext; sort?: {key: SortKey; order: Order}; onSort?: (key: SortKey) => void; selected: ReadonlySet<string>; focusIndex: number; onRowClick: (id: string, index: number, mod: {shift: boolean; ctrl: boolean}) => void; onOpen: (id: string) => void; onToggle: (id: string) => void; onNearEnd?: () => void; onKeyDown?: (e: KeyboardEvent<HTMLDivElement>) => void}`. Renders `role="grid"` with a `tabIndex=0` scroll container (`data-testid="image-table"`), `role="columnheader"` buttons when `onSort` is given, `role="row"` rows with `aria-selected`, a checkbox `aria-label="Select <file_name>"` per row, double-click opens. Row height 36 px, virtualised.
  - `ImageGrid(props: ImageGridProps)` where `interface ImageGridProps {projectId: string; items: ImageRow[]; selected: ReadonlySet<string>; focusIndex: number; onCellClick: ImageTableProps["onRowClick"]; onOpen: (id: string) => void; onToggle: (id: string) => void; onNearEnd?: () => void; onKeyDown?: ImageTableProps["onKeyDown"]}`. 200 x 190 px cells (`data-testid="image-grid"`), thumbnail `<img>` with the file name as fallback when it fails to load, badges for boxes and pending, virtualised by rows of `floor(width / 200)` columns.
  - `DataManagerScreen`: heading "Data Manager"; state `query: ListQuery`, `view: ViewMode` (default grid), `selection`, `focusIndex`; opens the editor with `useNavigationStore.setContext(ids, "data")`; keyboard J/K/Enter/Space/Ctrl+A/Escape through `keyboardAction`; near-end loads more; shows `list.error` in a `role="alert"`; renders `SelectionBar` (Task 9) when the selection is non-empty (leave a `{/* SelectionBar */}` comment until Task 9 replaces it).

- [ ] **Step 1: Write the failing tests**

`frontend/src/data/FilterBar.test.tsx`:

```tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { FilterBar } from "./FilterBar";
import { DEFAULT_QUERY } from "./listModel";

describe("FilterBar", () => {
  it("debounces search and emits sort, filters and view changes", async () => {
    const onChange = vi.fn();
    const onView = vi.fn();
    render(
      <FilterBar query={DEFAULT_QUERY} onChange={onChange} view="grid" onView={onView} sourceNames={{ s1: "ahmadia" }} total={2} loaded={2} />,
    );
    fireEvent.change(screen.getByPlaceholderText("Search file name"), { target: { value: "0031" } });
    expect(onChange).not.toHaveBeenCalled();
    await waitFor(() => expect(onChange).toHaveBeenCalledWith({ ...DEFAULT_QUERY, filters: { ...DEFAULT_QUERY.filters, search: "0031" } }));

    fireEvent.change(screen.getByLabelText("Sort by"), { target: { value: "capture_time" } });
    expect(onChange).toHaveBeenLastCalledWith({ ...DEFAULT_QUERY, sort: "capture_time", order: "asc" });
    fireEvent.click(screen.getByLabelText("Sort order"));
    expect(onChange).toHaveBeenLastCalledWith({ ...DEFAULT_QUERY, order: "desc" });

    fireEvent.change(screen.getByLabelText("Source"), { target: { value: "s1" } });
    expect(onChange).toHaveBeenLastCalledWith({ ...DEFAULT_QUERY, filters: { ...DEFAULT_QUERY.filters, sourceId: "s1" } });
    fireEvent.change(screen.getByLabelText("Labeled"), { target: { value: "yes" } });
    expect(onChange).toHaveBeenLastCalledWith({ ...DEFAULT_QUERY, filters: { ...DEFAULT_QUERY.filters, labeled: "yes" } });
    fireEvent.change(screen.getByLabelText("Pending review"), { target: { value: "no" } });
    expect(onChange).toHaveBeenLastCalledWith({ ...DEFAULT_QUERY, filters: { ...DEFAULT_QUERY.filters, pending: "no" } });
    fireEvent.change(screen.getByLabelText("Min boxes"), { target: { value: "3" } });
    expect(onChange).toHaveBeenLastCalledWith({ ...DEFAULT_QUERY, filters: { ...DEFAULT_QUERY.filters, minBoxes: 3 } });

    fireEvent.click(screen.getByRole("button", { name: "List" }));
    expect(onView).toHaveBeenCalledWith("list");
    expect(screen.getByText("2 of 2 images")).toBeInTheDocument();
  });
});
```

`frontend/src/data/ImageTable.test.tsx`:

```tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { exampleImage, exampleImage2 } from "@/test/fixtures";
import { ImageTable } from "./ImageTable";
import { DATA_COLUMNS } from "./listModel";

describe("ImageTable", () => {
  it("renders columns and rows, sorts on header click, selects and opens", () => {
    const onSort = vi.fn();
    const onRowClick = vi.fn();
    const onOpen = vi.fn();
    const onToggle = vi.fn();
    render(
      <ImageTable
        items={[exampleImage, exampleImage2]}
        columns={DATA_COLUMNS}
        rowContext={{ sourceNames: {} }}
        sort={{ key: "path", order: "asc" }}
        onSort={onSort}
        selected={new Set([exampleImage2.id])}
        focusIndex={0}
        onRowClick={onRowClick}
        onOpen={onOpen}
        onToggle={onToggle}
      />,
    );
    expect(screen.getAllByRole("columnheader").map((h) => h.textContent)).toEqual(
      expect.arrayContaining(["File ▲", "Source", "Group", "Labeled", "Boxes", "Pending", "Captured"]),
    );
    fireEvent.click(screen.getByRole("columnheader", { name: "Boxes" }));
    expect(onSort).toHaveBeenCalledWith("box_count");

    const rows = screen.getAllByRole("row").filter((r) => r.getAttribute("aria-selected") !== null);
    expect(rows).toHaveLength(2);
    expect(rows[1]).toHaveAttribute("aria-selected", "true");
    expect(screen.getByText("IX-12-02491_0031_0002.jpg")).toBeInTheDocument();

    fireEvent.click(rows[0], { shiftKey: true });
    expect(onRowClick).toHaveBeenCalledWith(exampleImage.id, 0, { shift: true, ctrl: false });
    fireEvent.doubleClick(rows[1]);
    expect(onOpen).toHaveBeenCalledWith(exampleImage2.id);
    fireEvent.click(screen.getByLabelText("Select IX-12-02491_0031_0001.jpg"));
    expect(onToggle).toHaveBeenCalledWith(exampleImage.id);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm test src/data/FilterBar.test.tsx src/data/ImageTable.test.tsx`
Expected: FAIL with unresolved imports.

- [ ] **Step 3: Implement `FilterBar.tsx`**

```tsx
import { useEffect, useState } from "react";
import { DATA_COLUMNS, type ListQuery, type Order, type SortKey, type TriState, type ViewMode } from "./listModel";

interface Props {
  query: ListQuery;
  onChange: (q: ListQuery) => void;
  view: ViewMode;
  onView: (v: ViewMode) => void;
  sourceNames: Record<string, string>;
  total: number;
  loaded: number;
}

const input = "rounded border border-slate-700 bg-slate-800 px-2 py-1 text-sm";
const label = "flex flex-col gap-0.5 text-xs text-slate-400";

export function FilterBar({ query, onChange, view, onView, sourceNames, total, loaded }: Props) {
  // The search box owns its text; the query only learns about it after the debounce.
  const [search, setSearch] = useState(query.filters.search);
  useEffect(() => {
    if (search === query.filters.search) return;
    const t = setTimeout(() => onChange({ ...query, filters: { ...query.filters, search } }), 300);
    return () => clearTimeout(t);
  }, [search, query, onChange]);

  const setFilter = <K extends keyof ListQuery["filters"]>(key: K, value: ListQuery["filters"][K]) =>
    onChange({ ...query, filters: { ...query.filters, [key]: value } });

  return (
    <div className="flex flex-wrap items-end gap-3 border-b border-slate-800 pb-3">
      <label className={label}>
        Search
        <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search file name" className={input} />
      </label>
      <label className={label}>
        Source
        <select value={query.filters.sourceId} onChange={(e) => setFilter("sourceId", e.target.value)} className={input}>
          <option value="">all</option>
          {Object.entries(sourceNames).map(([id, site]) => (
            <option key={id} value={id}>
              {site}
            </option>
          ))}
        </select>
      </label>
      <label className={label}>
        Group
        <input value={query.filters.groupKey} onChange={(e) => setFilter("groupKey", e.target.value)} placeholder="flight or tile" className={`${input} w-32`} />
      </label>
      <label className={label}>
        Labeled
        <select value={query.filters.labeled} onChange={(e) => setFilter("labeled", e.target.value as TriState)} className={input}>
          <option value="all">all</option>
          <option value="yes">yes</option>
          <option value="no">no</option>
        </select>
      </label>
      <label className={label}>
        Pending review
        <select value={query.filters.pending} onChange={(e) => setFilter("pending", e.target.value as TriState)} className={input}>
          <option value="all">all</option>
          <option value="yes">yes</option>
          <option value="no">no</option>
        </select>
      </label>
      <label className={label}>
        Min boxes
        <input
          type="number"
          min={0}
          value={query.filters.minBoxes ?? ""}
          onChange={(e) => setFilter("minBoxes", e.target.value === "" ? null : Number(e.target.value))}
          className={`${input} w-20`}
        />
      </label>
      <label className={label}>
        Captured from
        <input type="date" value={query.filters.captureFrom} onChange={(e) => setFilter("captureFrom", e.target.value)} className={input} />
      </label>
      <label className={label}>
        Captured to
        <input type="date" value={query.filters.captureTo} onChange={(e) => setFilter("captureTo", e.target.value)} className={input} />
      </label>
      <label className={label}>
        Sort by
        <select value={query.sort} onChange={(e) => onChange({ ...query, sort: e.target.value as SortKey, order: "asc" })} className={input}>
          {DATA_COLUMNS.filter((c) => c.sortKey).map((c) => (
            <option key={c.key} value={c.sortKey}>
              {c.label}
            </option>
          ))}
        </select>
      </label>
      <button
        type="button"
        aria-label="Sort order"
        title={query.order === "asc" ? "ascending" : "descending"}
        onClick={() => onChange({ ...query, order: (query.order === "asc" ? "desc" : "asc") as Order })}
        className="rounded border border-slate-700 px-2 py-1 text-sm hover:bg-slate-800"
      >
        {query.order === "asc" ? "▲" : "▼"}
      </button>
      <div className="ml-auto flex items-center gap-2">
        <span className="text-xs text-slate-400">
          {loaded} of {total} images
        </span>
        {(["grid", "list"] as ViewMode[]).map((v) => (
          <button
            key={v}
            type="button"
            onClick={() => onView(v)}
            aria-pressed={view === v}
            className={`rounded px-3 py-1 text-sm ${view === v ? "bg-slate-700 text-white" : "border border-slate-700 hover:bg-slate-800"}`}
          >
            {v === "grid" ? "Grid" : "List"}
          </button>
        ))}
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Implement `ImageTable.tsx`**

```tsx
import { useEffect, type KeyboardEvent, type MouseEvent } from "react";
import type { Image as ImageRow } from "@contract/client";
import { computeWindow, useVirtualRows } from "./useVirtualRows";
import type { ColumnDef, Order, RowContext, SortKey } from "./listModel";

export const ROW_HEIGHT = 36;

export interface ImageTableProps {
  items: ImageRow[];
  columns: ColumnDef[];
  rowContext: RowContext;
  sort?: { key: SortKey; order: Order };
  onSort?: (key: SortKey) => void;
  selected: ReadonlySet<string>;
  focusIndex: number;
  onRowClick: (id: string, index: number, mod: { shift: boolean; ctrl: boolean }) => void;
  onOpen: (id: string) => void;
  onToggle: (id: string) => void;
  onNearEnd?: () => void;
  onKeyDown?: (e: KeyboardEvent<HTMLDivElement>) => void;
}

function mods(e: MouseEvent): { shift: boolean; ctrl: boolean } {
  return { shift: e.shiftKey, ctrl: e.ctrlKey || e.metaKey };
}

export function ImageTable(p: ImageTableProps) {
  const { onNearEnd, focusIndex } = p;
  const count = p.items.length;
  const vp = useVirtualRows({ rowHeight: ROW_HEIGHT });
  const win = computeWindow(vp.scrollTop, vp.height, ROW_HEIGHT, count);
  const { end } = win;
  const { scrollToIndex } = vp;
  const template = `2rem ${p.columns.map((c) => c.width).join(" ")}`;

  useEffect(() => {
    if (onNearEnd && count > 0 && end >= count - 20) onNearEnd();
  }, [end, count, onNearEnd]);

  useEffect(() => scrollToIndex(focusIndex), [focusIndex, scrollToIndex]);

  return (
    <div role="grid" aria-rowcount={p.items.length} className="flex min-h-0 flex-1 flex-col">
      <div role="row" className="grid border-b border-slate-800 text-xs uppercase tracking-wide text-slate-400" style={{ gridTemplateColumns: template }}>
        <span role="columnheader" aria-label="select" />
        {p.columns.map((c) =>
          p.onSort && c.sortKey ? (
            <button
              key={c.key}
              type="button"
              role="columnheader"
              onClick={() => p.onSort?.(c.sortKey as SortKey)}
              className="px-2 py-1.5 text-left hover:text-white"
            >
              {c.label}
              {p.sort?.key === c.sortKey ? (p.sort.order === "asc" ? " ▲" : " ▼") : ""}
            </button>
          ) : (
            <span key={c.key} role="columnheader" className="px-2 py-1.5">
              {c.label}
            </span>
          ),
        )}
      </div>
      <div
        ref={vp.containerRef}
        onScroll={vp.onScroll}
        tabIndex={0}
        onKeyDown={p.onKeyDown}
        data-testid="image-table"
        className="min-h-0 flex-1 overflow-auto outline-none focus:ring-1 focus:ring-orange-500"
      >
        <div style={{ height: win.totalHeight, position: "relative" }}>
          <div style={{ position: "absolute", top: win.offsetTop, left: 0, right: 0 }}>
            {p.items.slice(win.start, win.end).map((img, i) => {
              const index = win.start + i;
              const isSelected = p.selected.has(img.id);
              const isFocused = index === p.focusIndex;
              return (
                <div
                  key={img.id}
                  role="row"
                  aria-selected={isSelected}
                  onClick={(e) => p.onRowClick(img.id, index, mods(e))}
                  onDoubleClick={() => p.onOpen(img.id)}
                  style={{ gridTemplateColumns: template, height: ROW_HEIGHT }}
                  className={`grid cursor-default items-center border-b border-slate-800/60 text-sm ${
                    isSelected ? "bg-orange-900/40" : "hover:bg-slate-800/60"
                  } ${isFocused ? "ring-1 ring-inset ring-orange-500" : ""}`}
                >
                  <span role="gridcell" className="flex justify-center">
                    <input
                      type="checkbox"
                      aria-label={`Select ${img.file_name}`}
                      checked={isSelected}
                      onClick={(e) => e.stopPropagation()}
                      onChange={() => p.onToggle(img.id)}
                    />
                  </span>
                  {p.columns.map((c) => (
                    <span key={c.key} role="gridcell" className="truncate px-2">
                      {c.render(img, p.rowContext)}
                    </span>
                  ))}
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 5: Implement `ImageGrid.tsx`**

```tsx
import { useEffect, useState, type KeyboardEvent } from "react";
import { thumbnailUrl, type Image as ImageRow } from "@contract/client";
import { useBackend } from "@/api/client";
import { computeWindow, useVirtualRows } from "./useVirtualRows";
import type { ImageTableProps } from "./ImageTable";

export const CELL_WIDTH = 200;
export const CELL_HEIGHT = 190;

export interface ImageGridProps {
  projectId: string;
  items: ImageRow[];
  selected: ReadonlySet<string>;
  focusIndex: number;
  onCellClick: ImageTableProps["onRowClick"];
  onOpen: (id: string) => void;
  onToggle: (id: string) => void;
  onNearEnd?: () => void;
  onKeyDown?: (e: KeyboardEvent<HTMLDivElement>) => void;
}

/** Mounted with `key={src}` by the grid so a new source starts un-failed without an effect. */
function Thumb({ src, alt }: { src: string; alt: string }) {
  const [failed, setFailed] = useState(false);
  if (failed) return <span className="px-2 text-center text-xs text-slate-400">{alt}</span>;
  return <img src={src} alt={alt} onError={() => setFailed(true)} className="max-h-full max-w-full object-contain" />;
}

export function ImageGrid(p: ImageGridProps) {
  const { baseUrl, token } = useBackend();
  const { onNearEnd, focusIndex } = p;
  const count = p.items.length;
  // Columns are derived from the measured width; the first render (width 0) uses one column.
  const vp = useVirtualRows({ rowHeight: CELL_HEIGHT });
  const cols = Math.max(1, Math.floor((vp.width || CELL_WIDTH) / CELL_WIDTH));
  const rows = Math.ceil(count / cols);
  const win = computeWindow(vp.scrollTop, vp.height, CELL_HEIGHT, rows, 2);
  const { end } = win;
  const { scrollToIndex } = vp;

  useEffect(() => {
    if (onNearEnd && count > 0 && end * cols >= count - 20) onNearEnd();
  }, [end, cols, count, onNearEnd]);

  useEffect(() => scrollToIndex(Math.floor(focusIndex / cols)), [focusIndex, cols, scrollToIndex]);

  const visible = p.items.slice(win.start * cols, win.end * cols);
  return (
    <div
      ref={vp.containerRef}
      onScroll={vp.onScroll}
      tabIndex={0}
      onKeyDown={p.onKeyDown}
      role="grid"
      data-testid="image-grid"
      className="min-h-0 flex-1 overflow-auto outline-none focus:ring-1 focus:ring-orange-500"
    >
      <div style={{ height: win.totalHeight, position: "relative" }}>
        <div className="flex flex-wrap" style={{ position: "absolute", top: win.offsetTop, left: 0, right: 0 }}>
          {visible.map((img, i) => {
            const index = win.start * cols + i;
            const isSelected = p.selected.has(img.id);
            const isFocused = index === p.focusIndex;
            return (
              <div
                key={img.id}
                role="row"
                aria-selected={isSelected}
                onClick={(e) => p.onCellClick(img.id, index, { shift: e.shiftKey, ctrl: e.ctrlKey || e.metaKey })}
                onDoubleClick={() => p.onOpen(img.id)}
                style={{ width: CELL_WIDTH, height: CELL_HEIGHT }}
                className={`flex flex-col p-1.5 ${isFocused ? "ring-1 ring-inset ring-orange-500" : ""}`}
              >
                <div
                  className={`relative flex flex-1 items-center justify-center overflow-hidden rounded bg-slate-800 ${
                    isSelected ? "outline outline-2 outline-orange-500" : ""
                  }`}
                >
                  <Thumb key={img.id} src={thumbnailUrl(baseUrl, token, p.projectId, img.id)} alt={img.file_name} />
                  <input
                    type="checkbox"
                    aria-label={`Select ${img.file_name}`}
                    checked={isSelected}
                    onClick={(e) => e.stopPropagation()}
                    onChange={() => p.onToggle(img.id)}
                    className="absolute left-1 top-1"
                  />
                  <span className="absolute bottom-1 right-1 flex gap-1 text-[10px]">
                    {img.box_count > 0 && <span className="rounded bg-emerald-700 px-1">{img.box_count} boxes</span>}
                    {img.pending_count > 0 && <span className="rounded bg-amber-600 px-1">{img.pending_count} pending</span>}
                  </span>
                </div>
                <span className="mt-1 truncate text-xs text-slate-300" title={img.file_name}>
                  {img.file_name}
                </span>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 6: Replace `DataManagerScreen.tsx`**

```tsx
import { useCallback, useMemo, useState, type KeyboardEvent } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useProject, useSourceNames } from "@/api/project";
import { FilterBar } from "@/data/FilterBar";
import { ImageGrid } from "@/data/ImageGrid";
import { ImageTable } from "@/data/ImageTable";
import { applyClientFilters, DATA_COLUMNS, DEFAULT_QUERY, keyboardAction, toggleSort, toImageParams, type ListQuery, type ViewMode } from "@/data/listModel";
import { clearSelection, clickSelect, EMPTY_SELECTION, pruneSelection, selectAll, toggleSelect } from "@/data/selection";
import { useImageList } from "@/data/useImageList";
import { IMAGE_PAGE_SIZE } from "@/api/images";
import { isTypingTarget } from "@/editor/hotkeys";
import { useNavigationStore } from "@/store/navigation";

export function DataManagerScreen() {
  const { projectId = "" } = useParams();
  const navigate = useNavigate();
  const { project } = useProject(projectId);
  const sourceNames = useSourceNames(projectId);
  const [query, setQuery] = useState<ListQuery>(DEFAULT_QUERY);
  const [view, setView] = useState<ViewMode>("grid");
  const params = useMemo(() => toImageParams(query, IMAGE_PAGE_SIZE), [query]);
  const list = useImageList(projectId, params);
  const items = useMemo(() => applyClientFilters(list.items, query.filters), [list.items, query.filters]);
  const ids = useMemo(() => items.map((i) => i.id), [items]);
  const [selection, setSelection] = useState(EMPTY_SELECTION);
  const [rawFocus, setFocusIndex] = useState(0);
  // Derived, not synced with effects: the focus row is clamped to the list and the selection is
  // pruned to the ids currently listed (React Compiler rule `set-state-in-effect`).
  const focusIndex = Math.min(rawFocus, Math.max(0, ids.length - 1));
  const pruned = useMemo(() => pruneSelection(selection, ids), [selection, ids]);
  const rowContext = useMemo(() => ({ sourceNames }), [sourceNames]);

  const open = useCallback(
    (id: string) => {
      useNavigationStore.getState().setContext(ids, "data");
      void navigate(`/p/${projectId}/edit/${id}`);
    },
    [ids, navigate, projectId],
  );

  const onRowClick = useCallback(
    (id: string, index: number, mod: { shift: boolean; ctrl: boolean }) => {
      setFocusIndex(index);
      setSelection((s) => clickSelect(s, ids, id, mod));
    },
    [ids],
  );
  const onToggle = useCallback((id: string) => setSelection((s) => toggleSelect(s, id)), []);

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (isTypingTarget(e.target)) return;
    const action = keyboardAction(e);
    if (!action) return;
    e.preventDefault();
    switch (action.type) {
      case "move":
        setFocusIndex((i) => Math.max(0, Math.min(ids.length - 1, i + action.delta)));
        break;
      case "open":
        if (ids[focusIndex]) open(ids[focusIndex]);
        break;
      case "toggle":
        if (ids[focusIndex]) onToggle(ids[focusIndex]);
        break;
      case "select-all":
        setSelection(selectAll(ids));
        break;
      case "clear":
        setSelection(clearSelection());
        break;
    }
  };

  const selectedIds = useMemo(() => ids.filter((id) => pruned.selected.has(id)), [ids, pruned]);
  const labelSelected = () => {
    useNavigationStore.getState().setContext(selectedIds, "selection");
    void navigate(`/p/${projectId}/edit/${selectedIds[0]}`);
  };

  return (
    <section className="flex h-full min-h-0 flex-col gap-3">
      <div className="flex items-baseline justify-between">
        <h1 className="text-2xl font-semibold">Data Manager</h1>
        <span className="text-xs text-slate-400">J / K move, Enter opens, Space selects</span>
      </div>
      <FilterBar query={query} onChange={setQuery} view={view} onView={setView} sourceNames={sourceNames} total={list.total} loaded={items.length} />
      {list.error && (
        <p role="alert" className="rounded border border-red-800 bg-red-950 px-3 py-2 text-sm text-red-200">
          {list.error}
        </p>
      )}
      {selectedIds.length > 0 && (
        <div className="text-sm text-slate-300">{/* SelectionBar (Task 9) */}{selectedIds.length} selected</div>
      )}
      {view === "list" ? (
        <ImageTable
          items={items}
          columns={DATA_COLUMNS}
          rowContext={rowContext}
          sort={{ key: query.sort, order: query.order }}
          onSort={(key) => setQuery((q) => toggleSort(q, key))}
          selected={pruned.selected}
          focusIndex={focusIndex}
          onRowClick={onRowClick}
          onOpen={open}
          onToggle={onToggle}
          onNearEnd={list.hasMore ? list.loadMore : undefined}
          onKeyDown={onKeyDown}
        />
      ) : (
        <ImageGrid
          projectId={projectId}
          items={items}
          selected={pruned.selected}
          focusIndex={focusIndex}
          onCellClick={onRowClick}
          onOpen={open}
          onToggle={onToggle}
          onNearEnd={list.hasMore ? list.loadMore : undefined}
          onKeyDown={onKeyDown}
        />
      )}
      {list.loading && <p className="text-xs text-slate-400">Loading…</p>}
      {!list.loading && items.length === 0 && !list.error && (
        <p className="text-sm text-slate-400">{project ? "No images match. Import a folder from the Projects screen or clear the filters." : "Loading project…"}</p>
      )}
      <button type="button" className="hidden" onClick={labelSelected} aria-hidden="true" />
    </section>
  );
}
```

(The hidden button and the `{/* SelectionBar (Task 9) */}` line are replaced in Task 9; `labelSelected` moves into the `SelectionBar` props there.)

- [ ] **Step 7: Run the tests, type-check, and look at it**

Run: `pnpm test src/data && pnpm exec tsc -b && pnpm lint`
Expected: 6 data test files pass; tsc and lint clean.

Then start the mock and Vite (`pnpm --dir ../contract mock` in one terminal, `pnpm dev` in another), open `http://127.0.0.1:1420/`, click "Open" on Ahmadia and confirm: the grid shows two tiles named `IX-12-02491_0031_0001.jpg` and `…0002.jpg` (thumbnails fail under the mock, names show instead), the List button shows seven columns, the header sort arrows toggle, J/K/Enter open the editor placeholder route.

- [ ] **Step 8: Commit**

```bash
git add src/data/FilterBar.tsx src/data/FilterBar.test.tsx src/data/ImageTable.tsx src/data/ImageTable.test.tsx src/data/ImageGrid.tsx src/screens/DataManagerScreen.tsx
git commit -m "feat(ui): data manager screen with virtualised grid and list, filters, sort, selection and keyboard"
```

---

### Task 9: Bulk actions (label, run model, add to dataset, delete)

**Files:**
- Create: `frontend/src/data/bulkActions.ts`, `frontend/src/data/SelectionBar.tsx`
- Modify: `frontend/src/screens/DataManagerScreen.tsx` (mount `SelectionBar`)
- Test: `frontend/src/data/bulkActions.test.ts`, `frontend/src/data/SelectionBar.test.tsx`

**Interfaces:**
- Consumes: `unwrap`, `bulkDeleteImages`, `useJobsStore.upsert`, `useChangesStore.bumpImages`, `useApi`.
- Produces:
  - `bulkActions.ts`: `interface DatasetOptions {name: string; split_method: "by_group" | "by_tile" | "random"; val_fraction: number}`, `runModelOnImages(api, projectId, imageIds, modelId): Promise<Job>` (`POST /query-runs` with `{kind: "local_model", model_id, image_ids}`, returns `.job`), `addImagesToDataset(api, projectId, imageIds, opts: DatasetOptions): Promise<Job>` (`POST /datasets` with `{name, split_method, val_fraction, image_ids}`, returns `.job`), `deleteImages(api, projectId, imageIds): Promise<number>`.
  - `SelectionBar({projectId, selectedIds, preannotationModelId, onLabel, onDeleted, onClear}: {projectId: string; selectedIds: string[]; preannotationModelId: string | null; onLabel: () => void; onDeleted: () => void; onClear: () => void})`: buttons "Label selected", "Run model", "Add to dataset" (reveals an inline form with `aria-label="Dataset name"`, `aria-label="Split method"`, `aria-label="Validation fraction"` and a "Create dataset" submit), "Delete" (reveals "Delete N images" confirm and "Cancel"), "Clear selection"; shows the error envelope message in `role="alert"` and a success line in `role="status"`. Jobs returned are pushed to `useJobsStore.upsert` so the shell's active-job counter reacts.

- [ ] **Step 1: Write the failing tests**

`frontend/src/data/bulkActions.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { exampleJob, fakeClient, PROJECT_ID, MODEL_ID, errorBody } from "@/test/fixtures";
import { addImagesToDataset, deleteImages, runModelOnImages } from "./bulkActions";

describe("bulk actions", () => {
  it("posts a local-model query run, a dataset with image ids and a bulk delete", async () => {
    const { api, requests } = fakeClient([
      { method: "POST", path: /\/query-runs$/, status: 202, body: { query_run: { id: "q" }, job: exampleJob } },
      { method: "POST", path: /\/datasets$/, status: 202, body: { dataset: { id: "d" }, job: { ...exampleJob, id: "j2", type: "dataset" } } },
      { method: "POST", path: /\/images\/bulk-delete$/, body: { deleted: 2 } },
    ]);
    expect((await runModelOnImages(api, PROJECT_ID, ["a", "b"], MODEL_ID)).id).toBe(exampleJob.id);
    expect((await addImagesToDataset(api, PROJECT_ID, ["a", "b"], { name: "v1", split_method: "by_group", val_fraction: 0.2 })).id).toBe("j2");
    expect(await deleteImages(api, PROJECT_ID, ["a", "b"])).toBe(2);
    expect(requests[0].body).toEqual({ kind: "local_model", model_id: MODEL_ID, image_ids: ["a", "b"] });
    expect(requests[1].body).toEqual({ name: "v1", split_method: "by_group", val_fraction: 0.2, image_ids: ["a", "b"] });
    expect(requests[2].body).toEqual({ image_ids: ["a", "b"] });
  });

  it("surfaces the 501 envelope until S4 lands", async () => {
    const { api } = fakeClient([{ method: "POST", path: /\/query-runs$/, status: 501, body: errorBody("not_implemented", "query runs arrive with S4") }]);
    await expect(runModelOnImages(api, PROJECT_ID, ["a"], MODEL_ID)).rejects.toMatchObject({ message: "query runs arrive with S4" });
  });
});
```

`frontend/src/data/SelectionBar.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, fireEvent, waitFor } from "@testing-library/react";
import { exampleJob, fakeClient, PROJECT_ID, MODEL_ID, errorBody } from "@/test/fixtures";
import { renderWithProviders } from "@/test/render";
import { useJobsStore } from "@/store/jobs";
import { SelectionBar } from "./SelectionBar";

describe("SelectionBar", () => {
  beforeEach(() => useJobsStore.setState({ jobs: {} }));

  it("runs the model, creates a dataset and deletes after confirmation", async () => {
    const { api, requests } = fakeClient([
      { method: "POST", path: /\/query-runs$/, status: 202, body: { query_run: { id: "q" }, job: exampleJob } },
      { method: "POST", path: /\/datasets$/, status: 202, body: { dataset: { id: "d" }, job: { ...exampleJob, id: "j2" } } },
      { method: "POST", path: /\/images\/bulk-delete$/, body: { deleted: 2 } },
    ]);
    const onDeleted = vi.fn();
    const onLabel = vi.fn();
    renderWithProviders(
      <SelectionBar projectId={PROJECT_ID} selectedIds={["a", "b"]} preannotationModelId={MODEL_ID} onLabel={onLabel} onDeleted={onDeleted} onClear={() => {}} />,
      { api },
    );
    fireEvent.click(screen.getByRole("button", { name: "Label selected" }));
    expect(onLabel).toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Run model" }));
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("Model run queued"));
    expect(Object.keys(useJobsStore.getState().jobs)).toEqual([exampleJob.id]);

    fireEvent.click(screen.getByRole("button", { name: "Add to dataset" }));
    fireEvent.change(screen.getByLabelText("Dataset name"), { target: { value: "v1" } });
    fireEvent.change(screen.getByLabelText("Split method"), { target: { value: "random" } });
    fireEvent.change(screen.getByLabelText("Validation fraction"), { target: { value: "0.3" } });
    fireEvent.click(screen.getByRole("button", { name: "Create dataset" }));
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("Dataset v1 queued"));
    expect(requests[1].body).toEqual({ name: "v1", split_method: "random", val_fraction: 0.3, image_ids: ["a", "b"] });

    fireEvent.click(screen.getByRole("button", { name: "Delete" }));
    fireEvent.click(screen.getByRole("button", { name: "Delete 2 images" }));
    await waitFor(() => expect(onDeleted).toHaveBeenCalled());
    expect(requests[2].body).toEqual({ image_ids: ["a", "b"] });
  });

  it("disables Run model without a pre-annotation model and shows the envelope message on failure", async () => {
    const { api } = fakeClient([{ method: "POST", path: /\/datasets$/, status: 501, body: errorBody("not_implemented", "datasets arrive with S1") }]);
    renderWithProviders(
      <SelectionBar projectId={PROJECT_ID} selectedIds={["a"]} preannotationModelId={null} onLabel={() => {}} onDeleted={() => {}} onClear={() => {}} />,
      { api },
    );
    expect(screen.getByRole("button", { name: "Run model" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Add to dataset" }));
    fireEvent.change(screen.getByLabelText("Dataset name"), { target: { value: "v1" } });
    fireEvent.click(screen.getByRole("button", { name: "Create dataset" }));
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("datasets arrive with S1"));
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm test src/data/bulkActions.test.ts src/data/SelectionBar.test.tsx`
Expected: FAIL with unresolved imports.

- [ ] **Step 3: Implement `bulkActions.ts`**

```ts
import type { ApiClient, Job } from "@contract/client";
import { unwrap } from "@/api/errors";
import { bulkDeleteImages } from "@/api/images";

export interface DatasetOptions {
  name: string;
  split_method: "by_group" | "by_tile" | "random";
  val_fraction: number;
}

/** "Run model on selected": a local-model query run with the project's pre-annotation model (501 until S4). */
export async function runModelOnImages(api: ApiClient, projectId: string, imageIds: string[], modelId: string): Promise<Job> {
  const r = await unwrap(
    api.POST("/api/v1/projects/{projectId}/query-runs", {
      params: { path: { projectId } },
      body: { kind: "local_model", model_id: modelId, image_ids: imageIds },
    }),
  );
  return r.job;
}

/** "Add to dataset": freeze the selection into a new dataset (501 until S1). */
export async function addImagesToDataset(api: ApiClient, projectId: string, imageIds: string[], opts: DatasetOptions): Promise<Job> {
  const r = await unwrap(
    api.POST("/api/v1/projects/{projectId}/datasets", {
      params: { path: { projectId } },
      body: { name: opts.name, split_method: opts.split_method, val_fraction: opts.val_fraction, image_ids: imageIds },
    }),
  );
  return r.job;
}

export function deleteImages(api: ApiClient, projectId: string, imageIds: string[]): Promise<number> {
  return bulkDeleteImages(api, projectId, imageIds);
}
```

- [ ] **Step 4: Implement `SelectionBar.tsx`**

```tsx
import { useState, type FormEvent } from "react";
import { useApi } from "@/api/client";
import { messageOf } from "@/api/errors";
import { pushLog } from "@/app/diagnostics";
import { useChangesStore } from "@/store/changes";
import { useJobsStore } from "@/store/jobs";
import { addImagesToDataset, deleteImages, runModelOnImages, type DatasetOptions } from "./bulkActions";

interface Props {
  projectId: string;
  selectedIds: string[];
  preannotationModelId: string | null;
  onLabel: () => void;
  onDeleted: () => void;
  onClear: () => void;
}

const btn = "rounded border border-slate-700 px-3 py-1 text-sm hover:bg-slate-800 disabled:opacity-50";
const primary = "rounded bg-orange-600 px-3 py-1 text-sm font-medium hover:bg-orange-500 disabled:opacity-50";
const input = "rounded border border-slate-700 bg-slate-800 px-2 py-1 text-sm";

export function SelectionBar({ projectId, selectedIds, preannotationModelId, onLabel, onDeleted, onClear }: Props) {
  const api = useApi();
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [mode, setMode] = useState<"idle" | "dataset" | "confirm-delete">("idle");
  const [dataset, setDataset] = useState<DatasetOptions>({ name: "", split_method: "by_group", val_fraction: 0.2 });
  const n = selectedIds.length;

  async function run(label: string, fn: () => Promise<string>) {
    setBusy(true);
    setError(null);
    setStatus(null);
    try {
      setStatus(await fn());
      setMode("idle");
    } catch (e) {
      pushLog(`${label} failed: ${messageOf(e, String(e))}`);
      setError(messageOf(e, `${label} failed`));
    } finally {
      setBusy(false);
    }
  }

  const runModel = () =>
    run("run model", async () => {
      const job = await runModelOnImages(api, projectId, selectedIds, preannotationModelId as string);
      useJobsStore.getState().upsert(job);
      return `Model run queued for ${n} images (job ${job.id.slice(0, 8)})`;
    });

  const createDataset = (e: FormEvent) => {
    e.preventDefault();
    void run("add to dataset", async () => {
      const job = await addImagesToDataset(api, projectId, selectedIds, dataset);
      useJobsStore.getState().upsert(job);
      return `Dataset ${dataset.name} queued with ${n} images (job ${job.id.slice(0, 8)})`;
    });
  };

  const confirmDelete = () =>
    run("delete images", async () => {
      const deleted = await deleteImages(api, projectId, selectedIds);
      useChangesStore.getState().bumpImages();
      onDeleted();
      return `${deleted} images deleted`;
    });

  return (
    <div className="flex flex-col gap-2 rounded border border-slate-700 bg-slate-800/60 px-3 py-2">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm font-medium">{n} selected</span>
        <button type="button" className={primary} onClick={onLabel} disabled={busy}>
          Label selected
        </button>
        <button
          type="button"
          className={btn}
          onClick={() => void runModel()}
          disabled={busy || !preannotationModelId}
          title={preannotationModelId ? "Run the pre-annotation model over the selection" : "Choose a pre-annotation model in Settings first"}
        >
          Run model
        </button>
        <button type="button" className={btn} onClick={() => setMode(mode === "dataset" ? "idle" : "dataset")} disabled={busy}>
          Add to dataset
        </button>
        <button type="button" className={btn} onClick={() => setMode(mode === "confirm-delete" ? "idle" : "confirm-delete")} disabled={busy}>
          Delete
        </button>
        <button type="button" className="ml-auto text-xs text-slate-400 hover:text-white" onClick={onClear}>
          Clear selection
        </button>
      </div>
      {mode === "dataset" && (
        <form onSubmit={createDataset} className="flex flex-wrap items-end gap-2">
          <input
            aria-label="Dataset name"
            required
            pattern="[A-Za-z0-9._-]+"
            placeholder="dataset name"
            value={dataset.name}
            onChange={(e) => setDataset({ ...dataset, name: e.target.value })}
            className={input}
          />
          <select aria-label="Split method" value={dataset.split_method} onChange={(e) => setDataset({ ...dataset, split_method: e.target.value as DatasetOptions["split_method"] })} className={input}>
            <option value="by_group">by group</option>
            <option value="by_tile">by tile</option>
            <option value="random">random</option>
          </select>
          <input
            aria-label="Validation fraction"
            type="number"
            min={0.05}
            max={0.5}
            step={0.05}
            value={dataset.val_fraction}
            onChange={(e) => setDataset({ ...dataset, val_fraction: Number(e.target.value) })}
            className={`${input} w-20`}
          />
          <button type="submit" className={primary} disabled={busy}>
            Create dataset
          </button>
        </form>
      )}
      {mode === "confirm-delete" && (
        <div className="flex items-center gap-2 text-sm">
          <span>Remove {n} images and their boxes from the project? Original files are not touched.</span>
          <button type="button" className="rounded bg-red-700 px-3 py-1 text-sm hover:bg-red-600" onClick={() => void confirmDelete()} disabled={busy}>
            Delete {n} images
          </button>
          <button type="button" className={btn} onClick={() => setMode("idle")}>
            Cancel
          </button>
        </div>
      )}
      {status && (
        <p role="status" className="text-xs text-emerald-300">
          {status}
        </p>
      )}
      {error && (
        <p role="alert" className="text-xs text-red-300">
          {error}
        </p>
      )}
    </div>
  );
}
```

- [ ] **Step 5: Mount it in `DataManagerScreen.tsx`**

Replace the `{selectedIds.length > 0 && (...)}` block with:

```tsx
      {selectedIds.length > 0 && (
        <SelectionBar
          projectId={projectId}
          selectedIds={selectedIds}
          preannotationModelId={project?.preannotation_model_id ?? null}
          onLabel={labelSelected}
          onDeleted={() => setSelection(clearSelection())}
          onClear={() => setSelection(clearSelection())}
        />
      )}
```

Add `import { SelectionBar } from "@/data/SelectionBar";` and delete the hidden `<button … onClick={labelSelected} />` line.

- [ ] **Step 6: Run the tests to verify they pass**

Run: `pnpm test src/data && pnpm exec tsc -b && pnpm lint`
Expected: 8 data test files pass; tsc and lint clean. In the browser against the mock: select both tiles (Ctrl+click), "Run model" shows "Model run queued…", "Delete" asks for confirmation and reports "1 images deleted" (the mock's example count).

- [ ] **Step 7: Commit**

```bash
git add src/data/bulkActions.ts src/data/bulkActions.test.ts src/data/SelectionBar.tsx src/data/SelectionBar.test.tsx src/screens/DataManagerScreen.tsx
git commit -m "feat(ui): data manager bulk actions (label, run model, add to dataset, delete)"
```

---

### Task 10: Konva stage: image, zoom, pan, fit, 1:1

**Files:**
- Create: `frontend/src/editor/useKonvaImage.ts`, `frontend/src/editor/EditorCanvas.tsx`, `frontend/src/editor/useEditorImage.ts`, `frontend/e2e/editor.spec.ts`
- Modify: `frontend/src/screens/EditorScreen.tsx` (replace the placeholder), `frontend/src/app/Shell.tsx` (no padding on the editor route)
- Test: `frontend/e2e/editor.spec.ts` (Konva cannot render in jsdom; this task's failing test is the e2e spec)

**Interfaces:**
- Consumes: `useEditorStore`, `geometry.ts`, `fetchImage`, `fetchBoxes`, `preannotateImage`, `useProject`, `useChangesStore`, `imageFileUrl`, `useBackend`.
- Produces:
  - `useKonvaImage(src: string | null): HTMLImageElement | null` (null until loaded and null on error; logs the failure).
  - `BACKGROUND_NAME = "background"`; `EditorCanvas({src, children, onBackgroundMouseDown, onMouseMove, onMouseUp}: {src: string | null; children?: ReactNode; onBackgroundMouseDown?: (e: KonvaEventObject<MouseEvent>) => void; onMouseMove?: (e: KonvaEventObject<MouseEvent>) => void; onMouseUp?: (e: KonvaEventObject<MouseEvent>) => void})`. Renders a container `data-testid="editor-canvas"` with `data-image="<w>x<h>"`, `data-view-scale` (4 decimals), `data-view-x`, `data-view-y`; a `Stage` sized to the container, `scaleX/scaleY/x/y` from the store view, `draggable` while Space is held (pan), wheel zoom around the pointer by `ZOOM_STEP`; the background layer holds the bitmap stretched to `Image.width x Image.height` (or a slate `Rect` placeholder) named `BACKGROUND_NAME`; `children` render as further layers.
  - `useEditorImage(projectId: string, imageId: string, preannotationModelId: string | null): {loading: boolean}`: resets the store, loads image and boxes into it, then, when no box is `unreviewed` and a model is configured, calls `preannotateImage` and upserts `items` (501 or any failure becomes a `notice`); reloads boxes when `useChangesStore.boxesRevision[imageId]` changes.
  - `EditorScreen`: three-column layout (`aside` left 12rem for classes, centre column with a toolbar row and the canvas, `aside` right 18rem for regions); this task renders the canvas plus placeholders `<div data-slot="classes" />`, `<div data-slot="toolbar" />`, `<div data-slot="regions" />` that Tasks 11 to 14 fill. Sets the active class to the project's first class when none is active.

- [ ] **Step 1: Write the failing e2e test**

`frontend/e2e/editor.spec.ts`:

```ts
import { test, expect, type Page } from "@playwright/test";

export const P = "7f1c2e3a-1111-4000-8000-000000000001";
export const IMG = "10000000-5555-4000-8000-000000000001";

export async function openEditor(page: Page) {
  await page.goto(`/p/${P}/edit/${IMG}`);
  const canvas = page.getByTestId("editor-canvas");
  await expect(canvas).toHaveAttribute("data-image", "4000x2667", { timeout: 15_000 });
  return canvas;
}

export async function readView(page: Page) {
  const canvas = page.getByTestId("editor-canvas");
  return {
    scale: Number(await canvas.getAttribute("data-view-scale")),
    x: Number(await canvas.getAttribute("data-view-x")),
    y: Number(await canvas.getAttribute("data-view-y")),
  };
}

/** Display coordinates (page pixels) of an image-pixel point. */
export async function displayPoint(page: Page, ix: number, iy: number) {
  const box = await page.getByTestId("editor-canvas").boundingBox();
  if (!box) throw new Error("canvas not laid out");
  const v = await readView(page);
  return { x: box.x + ix * v.scale + v.x, y: box.y + iy * v.scale + v.y };
}

test("loads the image record and boxes, fits the image and zooms with the wheel", async ({ page }) => {
  const boxesRequest = page.waitForRequest((r) => r.method() === "GET" && r.url().endsWith(`/images/${IMG}/boxes`));
  const canvas = await openEditor(page);
  await boxesRequest;
  const fitted = await readView(page);
  expect(fitted.scale).toBeGreaterThan(0.1);
  expect(fitted.scale).toBeLessThan(1);
  const box = await canvas.boundingBox();
  if (!box) throw new Error("no canvas box");
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.wheel(0, -240);
  await expect.poll(async () => (await readView(page)).scale).toBeGreaterThan(fitted.scale);
});

test("pans with space-drag", async ({ page }) => {
  const canvas = await openEditor(page);
  const before = await readView(page);
  const box = await canvas.boundingBox();
  if (!box) throw new Error("no canvas box");
  await page.keyboard.down(" ");
  await page.mouse.move(box.x + 200, box.y + 200);
  await page.mouse.down();
  await page.mouse.move(box.x + 260, box.y + 230, { steps: 6 });
  await page.mouse.up();
  await page.keyboard.up(" ");
  await expect.poll(async () => (await readView(page)).x).toBeCloseTo(before.x + 60, 0);
  expect((await readView(page)).scale).toBe(before.scale);
});
```

The second test needs the Space hotkey from Task 12; keep it in the file now (it fails until then) and run only the first with `-g`.

- [ ] **Step 2: Run the first test to verify it fails**

Run: `pnpm e2e e2e/editor.spec.ts -g "loads the image record"`
Expected: FAIL (`editor-canvas` never appears; the placeholder screen renders "Editor").

- [ ] **Step 3: Implement `useKonvaImage.ts`**

```ts
import { useEffect, useState } from "react";
import { pushLog } from "@/app/diagnostics";

/**
 * Loads a bitmap for Konva; `null` while loading or when the request fails (the mock serves no
 * real JPEG). The loaded bitmap is keyed by its source, so a new `src` reads as "not loaded"
 * without resetting state inside the effect.
 */
export function useKonvaImage(src: string | null): HTMLImageElement | null {
  const [loaded, setLoaded] = useState<{ src: string; el: HTMLImageElement } | null>(null);
  useEffect(() => {
    if (!src) return;
    let cancelled = false;
    const el = new window.Image();
    el.onload = () => {
      if (!cancelled) setLoaded({ src, el });
    };
    el.onerror = () => {
      if (!cancelled) pushLog(`image failed to load: ${src.replace(/token=[^&]+/, "token=…")}`);
    };
    el.src = src;
    return () => {
      cancelled = true;
    };
  }, [src]);
  return loaded && loaded.src === src ? loaded.el : null;
}
```

- [ ] **Step 4: Implement `EditorCanvas.tsx`**

```tsx
import { useEffect, useRef, type ReactNode } from "react";
import { Stage, Layer, Image as KonvaImage, Rect } from "react-konva";
import type Konva from "konva";
import type { KonvaEventObject } from "konva/lib/Node";
import { useEditorStore } from "@/store/editor";
import { ZOOM_STEP } from "./geometry";
import { useKonvaImage } from "./useKonvaImage";

export const BACKGROUND_NAME = "background";

interface Props {
  src: string | null;
  children?: ReactNode;
  onBackgroundMouseDown?: (e: KonvaEventObject<MouseEvent>) => void;
  onMouseMove?: (e: KonvaEventObject<MouseEvent>) => void;
  onMouseUp?: (e: KonvaEventObject<MouseEvent>) => void;
}

/** The stage's world coordinates are image pixels; `view` is the only display transform. */
export function EditorCanvas({ src, children, onBackgroundMouseDown, onMouseMove, onMouseUp }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<Konva.Stage>(null);
  const image = useEditorStore((s) => s.image);
  const view = useEditorStore((s) => s.view);
  const viewport = useEditorStore((s) => s.viewport);
  const spaceHeld = useEditorStore((s) => s.spaceHeld);
  const setViewport = useEditorStore((s) => s.setViewport);
  const setView = useEditorStore((s) => s.setView);
  const zoomAt = useEditorStore((s) => s.zoomAt);
  const bitmap = useKonvaImage(src);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const measure = () => setViewport({ width: el.clientWidth, height: el.clientHeight });
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [setViewport]);

  const onWheel = (e: KonvaEventObject<WheelEvent>) => {
    e.evt.preventDefault();
    const p = stageRef.current?.getPointerPosition();
    if (!p) return;
    zoomAt(p, e.evt.deltaY < 0 ? ZOOM_STEP : 1 / ZOOM_STEP);
  };

  const onDragEnd = (e: KonvaEventObject<DragEvent>) => {
    if (e.target === stageRef.current) setView({ ...view, x: e.target.x(), y: e.target.y() });
  };

  return (
    <div
      ref={containerRef}
      data-testid="editor-canvas"
      data-image={image ? `${image.width}x${image.height}` : ""}
      data-view-scale={view.scale.toFixed(4)}
      data-view-x={view.x.toFixed(1)}
      data-view-y={view.y.toFixed(1)}
      className={`relative h-full w-full overflow-hidden bg-slate-950 ${spaceHeld ? "cursor-grab" : "cursor-crosshair"}`}
    >
      {image && viewport.width > 0 && viewport.height > 0 && (
        <Stage
          ref={stageRef}
          width={viewport.width}
          height={viewport.height}
          scaleX={view.scale}
          scaleY={view.scale}
          x={view.x}
          y={view.y}
          draggable={spaceHeld}
          onDragEnd={onDragEnd}
          onWheel={onWheel}
          onMouseDown={(e) => {
            if (!spaceHeld && e.target.name() === BACKGROUND_NAME) onBackgroundMouseDown?.(e);
          }}
          onMouseMove={onMouseMove}
          onMouseUp={onMouseUp}
          onMouseLeave={onMouseUp}
        >
          <Layer>
            {bitmap ? (
              <KonvaImage name={BACKGROUND_NAME} image={bitmap} width={image.width} height={image.height} />
            ) : (
              <Rect name={BACKGROUND_NAME} width={image.width} height={image.height} fill="#334155" />
            )}
          </Layer>
          {children}
        </Stage>
      )}
    </div>
  );
}
```

- [ ] **Step 5: Implement `useEditorImage.ts`**

```ts
import { useEffect, useState } from "react";
import { fetchBoxes } from "@/api/boxes";
import { useApi } from "@/api/client";
import { isNotImplemented, messageOf } from "@/api/errors";
import { fetchImage, preannotateImage } from "@/api/images";
import { pushLog } from "@/app/diagnostics";
import { useChangesStore } from "@/store/changes";
import { useEditorStore } from "@/store/editor";

/**
 * Loads the image record and its boxes into the editor store, runs pre-annotation on open when the
 * image has no unreviewed proposals (spec section 7), and reloads boxes when a job changes them.
 */
export function useEditorImage(projectId: string, imageId: string, preannotationModelId: string | null): { loading: boolean } {
  const api = useApi();
  const revision = useChangesStore((s) => s.boxesRevision[imageId] ?? 0);
  // `loading` is derived: the id of the last image whose load settled versus the requested one.
  const [settledId, setSettledId] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    useEditorStore.getState().reset();
    void (async () => {
      try {
        const [image, boxes] = await Promise.all([fetchImage(api, projectId, imageId), fetchBoxes(api, projectId, imageId)]);
        if (cancelled) return;
        useEditorStore.getState().loadImage(image, boxes);
        setSettledId(imageId);
        const hasPending = boxes.some((b) => b.review_state === "unreviewed");
        if (hasPending || !preannotationModelId) return;
        try {
          const result = await preannotateImage(api, projectId, imageId);
          if (cancelled) return;
          const store = useEditorStore.getState();
          result.items.forEach((b) => store.upsertBox(b));
          const n = result.items.length;
          if (!result.skipped) store.setNotice(`${n} ${n === 1 ? "proposal" : "proposals"} from the pre-annotation model`);
        } catch (e) {
          if (cancelled) return;
          pushLog(`preannotate failed: ${messageOf(e, String(e))}`);
          useEditorStore
            .getState()
            .setNotice(isNotImplemented(e) ? "Pre-annotation is not available yet" : `Pre-annotation failed: ${messageOf(e, "unknown error")}`);
        }
      } catch (e) {
        if (cancelled) return;
        pushLog(`load image failed: ${messageOf(e, String(e))}`);
        useEditorStore.getState().setError(messageOf(e, "could not load the image"));
        setSettledId(imageId);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [api, projectId, imageId, preannotationModelId]);

  useEffect(() => {
    if (revision === 0) return;
    let cancelled = false;
    fetchBoxes(api, projectId, imageId)
      .then((boxes) => {
        if (!cancelled && useEditorStore.getState().imageId === imageId) useEditorStore.getState().setBoxes(boxes);
      })
      .catch((e: unknown) => pushLog(`reload boxes failed: ${messageOf(e, String(e))}`));
    return () => {
      cancelled = true;
    };
  }, [api, projectId, imageId, revision]);

  return { loading: settledId !== imageId };
}
```

- [ ] **Step 6: Replace `EditorScreen.tsx`**

```tsx
import { useEffect, useMemo } from "react";
import { useParams } from "react-router-dom";
import { imageFileUrl, type Project } from "@contract/client";
import { useBackend } from "@/api/client";
import { useProject } from "@/api/project";
import { EditorCanvas } from "@/editor/EditorCanvas";
import { displayMaxSide } from "@/editor/geometry";
import { useEditorImage } from "@/editor/useEditorImage";
import { useEditorStore } from "@/store/editor";

export function EditorScreen() {
  const { projectId = "", imageId = "" } = useParams();
  const { project, error: projectError } = useProject(projectId);
  if (projectError) {
    return (
      <p role="alert" className="m-6 rounded border border-red-800 bg-red-950 px-3 py-2 text-sm text-red-200">
        {projectError}
      </p>
    );
  }
  if (!project) return <p className="m-6 text-sm text-slate-400">Loading project…</p>;
  return <EditorBody projectId={projectId} imageId={imageId} project={project} />;
}

function EditorBody({ projectId, imageId, project }: { projectId: string; imageId: string; project: Project }) {
  const { baseUrl, token } = useBackend();
  const { loading } = useEditorImage(projectId, imageId, project.preannotation_model_id);
  const image = useEditorStore((s) => s.image);
  const error = useEditorStore((s) => s.error);
  const notice = useEditorStore((s) => s.notice);
  const activeClassId = useEditorStore((s) => s.activeClassId);
  const setActiveClass = useEditorStore((s) => s.setActiveClass);

  useEffect(() => {
    if (!activeClassId || !project.classes.some((c) => c.id === activeClassId)) setActiveClass(project.classes[0]?.id ?? null);
  }, [activeClassId, project.classes, setActiveClass]);

  const src = useMemo(
    () => (image ? imageFileUrl(baseUrl, token, projectId, image.id, displayMaxSide(image)) : null),
    [baseUrl, token, projectId, image],
  );

  return (
    <div className="flex h-full min-h-0">
      <aside className="flex w-48 shrink-0 flex-col border-r border-slate-800 bg-slate-950 p-2" data-slot="classes" />
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="flex items-center gap-2 border-b border-slate-800 px-3 py-1.5 text-sm" data-slot="toolbar">
          <span className="truncate text-slate-300">{image?.file_name ?? (loading ? "Loading…" : "")}</span>
        </div>
        {error && (
          <p role="alert" className="border-b border-red-900 bg-red-950 px-3 py-1 text-xs text-red-200">
            {error}
          </p>
        )}
        {notice && (
          <p role="status" className="border-b border-slate-800 bg-slate-900 px-3 py-1 text-xs text-slate-300">
            {notice}
          </p>
        )}
        <div className="min-h-0 flex-1">
          <EditorCanvas src={src} />
        </div>
      </div>
      <aside className="flex w-72 shrink-0 flex-col border-l border-slate-800 bg-slate-950" data-slot="regions" />
    </div>
  );
}
```

The `setActiveClass` call inside `useEffect` is a zustand action, not a React state setter, so the compiler rule `set-state-in-effect` does not apply.

- [ ] **Step 7: Let the editor route use the full main area**

In `frontend/src/app/Shell.tsx` change the `<main>` line to:

```tsx
        <main className={imageId ? "min-h-0 flex-1 overflow-hidden" : "min-h-0 flex-1 overflow-auto p-6"}>
```

(`imageId` is already read from `useParams()` in `Shell`.)

- [ ] **Step 8: Run the e2e test to verify it passes**

Run: `pnpm exec tsc -b && pnpm lint && pnpm e2e e2e/editor.spec.ts -g "loads the image record"`
Expected: `1 passed`. Also `pnpm e2e e2e/boot.spec.ts` still passes.

- [ ] **Step 9: Commit**

```bash
git add src/editor/useKonvaImage.ts src/editor/EditorCanvas.tsx src/editor/useEditorImage.ts src/screens/EditorScreen.tsx src/app/Shell.tsx e2e/editor.spec.ts
git commit -m "feat(ui): konva editor stage with fit, wheel zoom and image loading"
```

---

### Task 11: Box commands with compensating undo, box layer, draw, move and resize

**Files:**
- Create: `frontend/src/editor/commands.ts`, `frontend/src/editor/useHistory.ts`, `frontend/src/editor/useEditorActions.ts`, `frontend/src/editor/labels.ts`, `frontend/src/editor/BoxLayer.tsx`
- Modify: `frontend/src/screens/EditorScreen.tsx` (drawing wiring, box layer), `frontend/e2e/editor.spec.ts` (draw and drag tests)
- Test: `frontend/src/editor/commands.test.ts`, e2e

**Interfaces:**
- Consumes: `boxes.ts` API functions, `useEditorStore` (`EditorStore` type), `History`, `BoxRef`, geometry.
- Produces:
  - `commands.ts`: `interface CommandContext {api: ApiClient; projectId: string; store: EditorStore; history: History}`; `tracked<T>(ctx, label: string, fn: () => Promise<T>): Promise<T | undefined>` (pending counter, error capture into `store.error`, resolves `undefined` on failure); `cmdCreateBox(ctx, imageId, body: BoxCreate): Promise<Box | undefined>`; `cmdUpdateRect(ctx, id, before: Rect, after: Rect): Promise<void>` (no-op when `rectEquals`); `cmdSetClass(ctx, id, classId): Promise<void>`; `cmdDelete(ctx, id): Promise<void>`; `cmdDuplicate(ctx, id): Promise<Box | undefined>`; `cmdReview(ctx, ids, action: "accept" | "reject"): Promise<void>`; `cmdUndo(ctx): Promise<void>`; `cmdRedo(ctx): Promise<void>`. Undo semantics: create <-> delete (through a `BoxRef` so redo's new id is used later), rect/class patch <-> patch back, delete <-> re-create as a person box, review accept <-> reject (the contract has no "unreview"; see Contract gaps).
  - `useHistory(imageId: string): History` (a fresh `History` per image id).
  - `useEditorActions(projectId: string, history: History): {actions: EditorActions; canUndo: boolean; canRedo: boolean}` where `interface EditorActions {drawBox(rect: Rect, classId: string): Promise<void>; commitRect(id: string, before: Rect, after: Rect): Promise<void>; deleteBox(id: string): Promise<void>; deleteSelected(): Promise<void>; duplicateSelected(): Promise<void>; setClass(id: string, classId: string): Promise<void>; review(ids: string[], action: "accept" | "reject"): Promise<void>; acceptAll(): Promise<void>; rejectAll(): Promise<void>; undo(): Promise<void>; redo(): Promise<void>}`. `actions` is stable for a given project and history; the two booleans come from `useSyncExternalStore` on the history so the toolbar re-renders after every command.
  - `labels.ts`: `colourOf(classes: ClassDef[], classId: string): string` (`#94a3b8` when unknown) and `nameOf(classes: ClassDef[], classId: string): string` (`unknown class` when unknown); Task 12 adds `provenanceLabel` here.
  - `BoxLayer({classes, onCommitRect}: {classes: ClassDef[]; onCommitRect: (id: string, before: Rect, after: Rect) => void})`: a Konva `Layer` with one `Rect` per visible box (stroke = class colour, `strokeScaleEnabled={false}`, dashed `[8, 4]` when `review_state === "unreviewed"`, 35 % opacity when rejected, filled tint when selected or hovered, `draggable` unless Space is held, a `Text` label with the class name), the draft rectangle, and a `Transformer` on the selected box (`rotateEnabled={false}`, `keepRatio={false}`); drag end and transform end clamp to the image and call `onCommitRect` with rounded rects.
  - `EditorScreen` draws on background mouse down with the active class (`draft` in the store), commits on mouse up through `actions.drawBox`, and mounts `<BoxLayer>` inside `<EditorCanvas>`.

- [ ] **Step 1: Write the failing unit test**

`frontend/src/editor/commands.test.ts`:

```ts
import { describe, it, expect, beforeEach } from "vitest";
import { exampleImage, fakeClient, personBox, proposalBox, PROJECT_ID, CLASS_ID, errorBody, type FakeRoute } from "@/test/fixtures";
import { useEditorStore } from "@/store/editor";
import { cmdCreateBox, cmdDelete, cmdDuplicate, cmdRedo, cmdReview, cmdSetClass, cmdUndo, cmdUpdateRect, type CommandContext } from "./commands";
import { History } from "./history";

let counter = 0;
const routes: FakeRoute[] = [
  {
    method: "POST",
    path: /\/images\/[^/]+\/boxes$/,
    status: 201,
    body: (req) => ({ ...personBox, ...(req.body as object), id: `new-${++counter}` }),
  },
  { method: "PATCH", path: /\/boxes\/[^/]+$/, body: (req) => ({ ...proposalBox, ...(req.body as object), review_state: "edited" }) },
  { method: "DELETE", path: /\/boxes\/[^/]+$/, status: 204 },
  { method: "POST", path: /\/boxes\/review$/, body: { updated: 1 } },
];

function ctx(): CommandContext & { requests: ReturnType<typeof fakeClient>["requests"] } {
  const { api, requests } = fakeClient(routes);
  return { api, projectId: PROJECT_ID, store: useEditorStore, history: new History(), requests };
}

describe("editor commands", () => {
  beforeEach(() => {
    counter = 0;
    useEditorStore.getState().reset();
    useEditorStore.getState().loadImage(exampleImage, [personBox, proposalBox]);
  });

  it("creates a box, undoes with DELETE and redoes with a fresh POST", async () => {
    const c = ctx();
    const created = await cmdCreateBox(c, exampleImage.id, { class_id: CLASS_ID(2), x: 10, y: 20, w: 30, h: 40 });
    expect(created?.id).toBe("new-1");
    expect(useEditorStore.getState().selectedId).toBe("new-1");
    expect(useEditorStore.getState().order).toContain("new-1");
    await cmdUndo(c);
    expect(c.requests.at(-1)).toMatchObject({ method: "DELETE", url: `/api/v1/projects/${PROJECT_ID}/boxes/new-1` });
    expect(useEditorStore.getState().order).not.toContain("new-1");
    await cmdRedo(c);
    expect(c.requests.at(-1)).toMatchObject({ method: "POST", body: { class_id: CLASS_ID(2), x: 10, y: 20, w: 30, h: 40 } });
    expect(useEditorStore.getState().order).toContain("new-2");
    await cmdUndo(c);
    expect(c.requests.at(-1)).toMatchObject({ method: "DELETE", url: `/api/v1/projects/${PROJECT_ID}/boxes/new-2` });
    expect(useEditorStore.getState().pending).toBe(0);
  });

  it("patches a rect, marks a proposal edited, and undoes by patching back", async () => {
    const c = ctx();
    const before = { x: 1210.5, y: 802, w: 96, h: 61 };
    const after = { x: 1300, y: 810, w: 96, h: 61 };
    await cmdUpdateRect(c, proposalBox.id, before, after);
    expect(c.requests[0]).toMatchObject({ method: "PATCH", body: after });
    expect(useEditorStore.getState().boxes[proposalBox.id]).toMatchObject({ x: 1300, review_state: "edited" });
    await cmdUndo(c);
    expect(c.requests[1]).toMatchObject({ method: "PATCH", body: before });
    await cmdUpdateRect(c, proposalBox.id, before, before);
    expect(c.requests).toHaveLength(2);
  });

  it("reclassifies with PATCH class_id and undoes", async () => {
    const c = ctx();
    await cmdSetClass(c, personBox.id, CLASS_ID(3));
    expect(c.requests[0]).toMatchObject({ method: "PATCH", body: { class_id: CLASS_ID(3) } });
    await cmdUndo(c);
    expect(c.requests[1]).toMatchObject({ method: "PATCH", body: { class_id: CLASS_ID(1) } });
  });

  it("deletes and undoes by re-creating a person box with the same geometry", async () => {
    const c = ctx();
    useEditorStore.getState().select(personBox.id);
    await cmdDelete(c, personBox.id);
    expect(c.requests[0]).toMatchObject({ method: "DELETE", url: `/api/v1/projects/${PROJECT_ID}/boxes/${personBox.id}` });
    expect(useEditorStore.getState().selectedId).toBeNull();
    await cmdUndo(c);
    expect(c.requests[1]).toMatchObject({ method: "POST", body: { class_id: CLASS_ID(1), x: 512, y: 300, w: 140, h: 90 } });
    expect(useEditorStore.getState().order).toContain("new-1");
    await cmdRedo(c);
    expect(c.requests[2]).toMatchObject({ method: "DELETE", url: `/api/v1/projects/${PROJECT_ID}/boxes/new-1` });
  });

  it("duplicates with an offset", async () => {
    const c = ctx();
    const dup = await cmdDuplicate(c, personBox.id);
    expect(dup?.id).toBe("new-1");
    expect(c.requests[0]).toMatchObject({ method: "POST", body: { class_id: CLASS_ID(1), x: 524, y: 312, w: 140, h: 90 } });
    expect(useEditorStore.getState().selectedId).toBe("new-1");
  });

  it("reviews proposals and undoes with the opposite action", async () => {
    const c = ctx();
    await cmdReview(c, [proposalBox.id], "accept");
    expect(c.requests[0]).toMatchObject({ method: "POST", url: `/api/v1/projects/${PROJECT_ID}/boxes/review`, body: { box_ids: [proposalBox.id], action: "accept" } });
    expect(useEditorStore.getState().boxes[proposalBox.id].review_state).toBe("accepted");
    await cmdUndo(c);
    expect(c.requests[1]).toMatchObject({ body: { box_ids: [proposalBox.id], action: "reject" } });
    expect(useEditorStore.getState().boxes[proposalBox.id].review_state).toBe("rejected");
    await cmdReview(c, [], "accept");
    expect(c.requests).toHaveLength(2);
  });

  it("records the error envelope and pushes nothing on failure", async () => {
    const { api, requests } = fakeClient([{ method: "POST", path: /\/boxes$/, status: 500, body: errorBody("internal_error", "disk full") }]);
    const c: CommandContext = { api, projectId: PROJECT_ID, store: useEditorStore, history: new History() };
    const created = await cmdCreateBox(c, exampleImage.id, { class_id: CLASS_ID(1), x: 1, y: 1, w: 5, h: 5 });
    expect(created).toBeUndefined();
    expect(requests).toHaveLength(1);
    expect(useEditorStore.getState().error).toBe("draw box failed: disk full");
    expect(useEditorStore.getState().pending).toBe(0);
    expect(c.history.canUndo()).toBe(false);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm test src/editor/commands.test.ts`
Expected: FAIL with `Failed to resolve import "./commands"`.

- [ ] **Step 3: Implement `commands.ts`**

```ts
import type { ApiClient, Box, BoxCreate } from "@contract/client";
import { createBox, deleteBox, reviewBoxes, updateBox } from "@/api/boxes";
import { messageOf } from "@/api/errors";
import { pushLog } from "@/app/diagnostics";
import type { EditorStore } from "@/store/editor";
import { duplicateOffset, rectEquals, rectOf, roundRect, type Rect } from "./geometry";
import type { BoxRef, History } from "./history";

export interface CommandContext {
  api: ApiClient;
  projectId: string;
  store: EditorStore;
  history: History;
}

/** Runs one API interaction with the pending counter and error capture; resolves `undefined` on failure. */
export async function tracked<T>(ctx: CommandContext, label: string, fn: () => Promise<T>): Promise<T | undefined> {
  ctx.store.getState().beginRequest();
  ctx.store.getState().setError(null);
  try {
    return await fn();
  } catch (e) {
    pushLog(`${label} failed: ${messageOf(e, String(e))}`);
    ctx.store.getState().setError(`${label} failed: ${messageOf(e, "unknown error")}`);
    return undefined;
  } finally {
    ctx.store.getState().endRequest();
  }
}

/** Spec section 6: every edit is a Box row immediately; undo issues the compensating call. */
export async function cmdCreateBox(ctx: CommandContext, imageId: string, body: BoxCreate): Promise<Box | undefined> {
  const { api, projectId, store, history } = ctx;
  const created = await tracked(ctx, "draw box", () => createBox(api, projectId, imageId, body));
  if (!created) return undefined;
  store.getState().upsertBox(created);
  store.getState().select(created.id);
  const ref: BoxRef = { id: created.id };
  history.push({
    label: "draw box",
    undo: async () => {
      await deleteBox(api, projectId, ref.id);
      store.getState().removeBox(ref.id);
    },
    redo: async () => {
      const again = await createBox(api, projectId, imageId, body);
      ref.id = again.id;
      store.getState().upsertBox(again);
      store.getState().select(again.id);
    },
  });
  return created;
}

export async function cmdUpdateRect(ctx: CommandContext, id: string, before: Rect, after: Rect): Promise<void> {
  if (rectEquals(before, after)) return;
  const { api, projectId, store, history } = ctx;
  const updated = await tracked(ctx, "move box", () => updateBox(api, projectId, id, after));
  if (!updated) return;
  store.getState().upsertBox(updated);
  history.push({
    label: "move box",
    undo: async () => store.getState().upsertBox(await updateBox(api, projectId, id, before)),
    redo: async () => store.getState().upsertBox(await updateBox(api, projectId, id, after)),
  });
}

export async function cmdSetClass(ctx: CommandContext, id: string, classId: string): Promise<void> {
  const { api, projectId, store, history } = ctx;
  const box = store.getState().boxes[id];
  if (!box || box.class_id === classId) return;
  const previous = box.class_id;
  const updated = await tracked(ctx, "change class", () => updateBox(api, projectId, id, { class_id: classId }));
  if (!updated) return;
  store.getState().upsertBox(updated);
  history.push({
    label: "change class",
    undo: async () => store.getState().upsertBox(await updateBox(api, projectId, id, { class_id: previous })),
    redo: async () => store.getState().upsertBox(await updateBox(api, projectId, id, { class_id: classId })),
  });
}

export async function cmdDelete(ctx: CommandContext, id: string): Promise<void> {
  const { api, projectId, store, history } = ctx;
  const box = store.getState().boxes[id];
  if (!box) return;
  const ok = await tracked(ctx, "delete box", async () => {
    await deleteBox(api, projectId, id);
    return true;
  });
  if (!ok) return;
  store.getState().removeBox(id);
  const ref: BoxRef = { id };
  const body: BoxCreate = { class_id: box.class_id, x: box.x, y: box.y, w: box.w, h: box.h };
  history.push({
    label: "delete box",
    // The contract cannot re-create a box with model provenance; the undo yields a person box (see Contract gaps).
    undo: async () => {
      const again = await createBox(api, projectId, box.image_id, body);
      ref.id = again.id;
      store.getState().upsertBox(again);
    },
    redo: async () => {
      await deleteBox(api, projectId, ref.id);
      store.getState().removeBox(ref.id);
    },
  });
}

export async function cmdDuplicate(ctx: CommandContext, id: string): Promise<Box | undefined> {
  const { store } = ctx;
  const box = store.getState().boxes[id];
  const image = store.getState().image;
  if (!box || !image) return undefined;
  const rect = roundRect(duplicateOffset(rectOf(box), image));
  return cmdCreateBox(ctx, box.image_id, { class_id: box.class_id, ...rect });
}

export async function cmdReview(ctx: CommandContext, ids: string[], action: "accept" | "reject"): Promise<void> {
  if (ids.length === 0) return;
  const { api, projectId, store, history } = ctx;
  const opposite = action === "accept" ? "reject" : "accept";
  const state = action === "accept" ? "accepted" : "rejected";
  const oppositeState = action === "accept" ? "rejected" : "accepted";
  const ok = await tracked(ctx, `${action} proposals`, () => reviewBoxes(api, projectId, ids, action));
  if (ok === undefined) return;
  store.getState().patchStates(ids, state);
  history.push({
    label: `${action} proposals`,
    // No "unreview" action exists in the contract: the compensation flips to the opposite decision.
    undo: async () => {
      await reviewBoxes(api, projectId, ids, opposite);
      store.getState().patchStates(ids, oppositeState);
    },
    redo: async () => {
      await reviewBoxes(api, projectId, ids, action);
      store.getState().patchStates(ids, state);
    },
  });
}

export async function cmdUndo(ctx: CommandContext): Promise<void> {
  await tracked(ctx, "undo", () => ctx.history.undo());
}

export async function cmdRedo(ctx: CommandContext): Promise<void> {
  await tracked(ctx, "redo", () => ctx.history.redo());
}
```

- [ ] **Step 4: Run the unit test to verify it passes**

Run: `pnpm test src/editor/commands.test.ts`
Expected: `Tests 7 passed`.

- [ ] **Step 5: Implement `useHistory.ts` and `useEditorActions.ts`**

`frontend/src/editor/useHistory.ts`:

```ts
import { useMemo } from "react";
import { History } from "./history";

/** Undo and redo are per image (spec section 6): a new stack whenever the image id changes. */
export function useHistory(imageId: string): History {
  const entry = useMemo(() => ({ imageId, history: new History() }), [imageId]);
  return entry.history;
}
```

`frontend/src/editor/useEditorActions.ts`:

```ts
import { useCallback, useMemo, useSyncExternalStore } from "react";
import { useApi } from "@/api/client";
import { useEditorStore, visibleProposalIds } from "@/store/editor";
import { cmdCreateBox, cmdDelete, cmdDuplicate, cmdRedo, cmdReview, cmdSetClass, cmdUndo, cmdUpdateRect, type CommandContext } from "./commands";
import type { Rect } from "./geometry";
import type { History } from "./history";

export interface EditorActions {
  drawBox: (rect: Rect, classId: string) => Promise<void>;
  commitRect: (id: string, before: Rect, after: Rect) => Promise<void>;
  deleteBox: (id: string) => Promise<void>;
  deleteSelected: () => Promise<void>;
  duplicateSelected: () => Promise<void>;
  setClass: (id: string, classId: string) => Promise<void>;
  review: (ids: string[], action: "accept" | "reject") => Promise<void>;
  acceptAll: () => Promise<void>;
  rejectAll: () => Promise<void>;
  undo: () => Promise<void>;
  redo: () => Promise<void>;
}

/** Stable command bindings plus undo/redo availability, which re-renders on every history change. */
export function useEditorActions(
  projectId: string,
  history: History,
): { actions: EditorActions; canUndo: boolean; canRedo: boolean } {
  const api = useApi();
  const subscribe = useCallback((listener: () => void) => history.subscribe(listener), [history]);
  const canUndo = useSyncExternalStore(subscribe, () => history.canUndo());
  const canRedo = useSyncExternalStore(subscribe, () => history.canRedo());
  const ctx = useMemo<CommandContext>(() => ({ api, projectId, store: useEditorStore, history }), [api, projectId, history]);

  const actions = useMemo<EditorActions>(() => {
    const state = () => useEditorStore.getState();
    return {
      drawBox: async (rect, classId) => {
        const imageId = state().imageId;
        if (imageId) await cmdCreateBox(ctx, imageId, { class_id: classId, ...rect });
      },
      commitRect: (id, before, after) => cmdUpdateRect(ctx, id, before, after),
      deleteBox: (id) => cmdDelete(ctx, id),
      deleteSelected: async () => {
        const id = state().selectedId;
        if (id) await cmdDelete(ctx, id);
      },
      duplicateSelected: async () => {
        const id = state().selectedId;
        if (id) await cmdDuplicate(ctx, id);
      },
      setClass: (id, classId) => cmdSetClass(ctx, id, classId),
      review: (ids, action) => cmdReview(ctx, ids, action),
      acceptAll: () => cmdReview(ctx, visibleProposalIds(state()), "accept"),
      rejectAll: () => cmdReview(ctx, visibleProposalIds(state()), "reject"),
      undo: () => cmdUndo(ctx),
      redo: () => cmdRedo(ctx),
    };
  }, [ctx]);

  return { actions, canUndo, canRedo };
}
```

- [ ] **Step 6: Implement `labels.ts` and `BoxLayer.tsx`**

`frontend/src/editor/labels.ts` (plain helpers live outside component files so `react-refresh/only-export-components` stays quiet):

```ts
import type { ClassDef } from "@contract/client";

export function colourOf(classes: ClassDef[], classId: string): string {
  return classes.find((c) => c.id === classId)?.colour ?? "#94a3b8";
}

export function nameOf(classes: ClassDef[], classId: string): string {
  return classes.find((c) => c.id === classId)?.name ?? "unknown class";
}
```

`frontend/src/editor/BoxLayer.tsx`:

```tsx
import { useEffect, useMemo, useRef } from "react";
import { Layer, Rect, Text, Transformer } from "react-konva";
import type Konva from "konva";
import type { KonvaEventObject } from "konva/lib/Node";
import type { ClassDef } from "@contract/client";
import { useEditorStore, visibleBoxes } from "@/store/editor";
import { clampRect, MIN_BOX_SIDE, rectOf, roundRect, type Rect as RectShape } from "./geometry";
import { colourOf, nameOf } from "./labels";

interface Props {
  classes: ClassDef[];
  onCommitRect: (id: string, before: RectShape, after: RectShape) => void;
}

/** Boxes in image pixels; strokes, dashes and labels are kept in screen pixels through `strokeScaleEnabled={false}` and 1/scale. */
export function BoxLayer({ classes, onCommitRect }: Props) {
  const boxes = useEditorStore((s) => s.boxes);
  const order = useEditorStore((s) => s.order);
  const showRejected = useEditorStore((s) => s.showRejected);
  const selectedId = useEditorStore((s) => s.selectedId);
  const hoveredId = useEditorStore((s) => s.hoveredId);
  const draft = useEditorStore((s) => s.draft);
  const scale = useEditorStore((s) => s.view.scale);
  const spaceHeld = useEditorStore((s) => s.spaceHeld);
  const image = useEditorStore((s) => s.image);
  const select = useEditorStore((s) => s.select);
  const hover = useEditorStore((s) => s.hover);
  const list = useMemo(() => visibleBoxes({ boxes, order, showRejected }), [boxes, order, showRejected]);

  const trRef = useRef<Konva.Transformer>(null);
  const nodeRefs = useRef(new Map<string, Konva.Rect>());
  useEffect(() => {
    const tr = trRef.current;
    if (!tr) return;
    const node = selectedId ? nodeRefs.current.get(selectedId) : undefined;
    tr.nodes(node ? [node] : []);
    tr.getLayer()?.batchDraw();
  }, [selectedId, list]);

  if (!image) return null;
  const px = (n: number) => n / scale;

  const commit = (id: string, e: KonvaEventObject<Event>) => {
    const box = boxes[id];
    const node = e.target as Konva.Rect;
    if (!box) return;
    const after = clampRect(
      { x: node.x(), y: node.y(), w: node.width() * node.scaleX(), h: node.height() * node.scaleY() },
      image,
    );
    node.scale({ x: 1, y: 1 });
    node.setAttrs({ x: after.x, y: after.y, width: after.w, height: after.h });
    onCommitRect(id, rectOf(box), roundRect(after));
  };

  return (
    <Layer>
      {list.map((b) => {
        const colour = colourOf(classes, b.class_id);
        const isSelected = b.id === selectedId;
        const proposal = b.review_state === "unreviewed";
        return (
          <Rect
            key={b.id}
            ref={(n) => {
              if (n) nodeRefs.current.set(b.id, n);
              else nodeRefs.current.delete(b.id);
            }}
            name={`box ${b.id}`}
            x={b.x}
            y={b.y}
            width={b.w}
            height={b.h}
            stroke={colour}
            strokeWidth={isSelected ? 3 : 2}
            strokeScaleEnabled={false}
            dash={proposal ? [8, 4] : undefined}
            opacity={b.review_state === "rejected" ? 0.35 : 1}
            fill={isSelected || b.id === hoveredId ? `${colour}33` : "rgba(0,0,0,0.01)"}
            draggable={!spaceHeld}
            onMouseDown={(e) => {
              e.cancelBubble = true;
              select(b.id);
            }}
            onMouseEnter={() => hover(b.id)}
            onMouseLeave={() => hover(null)}
            onDragEnd={(e) => {
              e.cancelBubble = true;
              commit(b.id, e);
            }}
            onTransformEnd={(e) => commit(b.id, e)}
          />
        );
      })}
      {list.map((b) => (
        <Text
          key={`label-${b.id}`}
          x={b.x}
          y={b.y - px(14)}
          text={`${nameOf(classes, b.class_id)}${b.confidence !== null ? ` ${Math.round(b.confidence * 100)}%` : ""}`}
          fontSize={px(12)}
          fill={colourOf(classes, b.class_id)}
          listening={false}
        />
      ))}
      {draft && (
        <Rect
          x={draft.x}
          y={draft.y}
          width={draft.w}
          height={draft.h}
          stroke={colourOf(classes, draft.classId)}
          strokeWidth={2}
          strokeScaleEnabled={false}
          dash={[4, 4]}
          listening={false}
        />
      )}
      {selectedId && (
        <Transformer
          ref={trRef}
          rotateEnabled={false}
          keepRatio={false}
          ignoreStroke
          anchorSize={8}
          borderEnabled={false}
          boundBoxFunc={(oldBox, newBox) =>
            newBox.width < MIN_BOX_SIDE * scale || newBox.height < MIN_BOX_SIDE * scale ? oldBox : newBox
          }
        />
      )}
    </Layer>
  );
}
```

- [ ] **Step 7: Wire drawing and the layer into `EditorScreen.tsx`**

In `EditorBody` add these imports and hooks:

```tsx
import { useRef } from "react";
import type { KonvaEventObject } from "konva/lib/Node";
import { BoxLayer } from "@/editor/BoxLayer";
import { clampRect, isDrawable, normalizeRect, roundRect, toImage, type Point } from "@/editor/geometry";
import { useEditorActions } from "@/editor/useEditorActions";
import { useHistory } from "@/editor/useHistory";
```

```tsx
  const history = useHistory(imageId);
  const { actions, canUndo, canRedo } = useEditorActions(projectId, history);
  const drawStart = useRef<Point | null>(null);

  const onBackgroundMouseDown = (e: KonvaEventObject<MouseEvent>) => {
    if (e.evt.button !== 0) return;
    const st = useEditorStore.getState();
    const pos = e.target.getStage()?.getPointerPosition();
    if (!pos) return;
    if (!st.activeClassId) {
      st.setNotice("Pick a class first (keys 1 to 9)");
      return;
    }
    st.select(null);
    const p = toImage(pos, st.view);
    drawStart.current = p;
    st.setDraft({ x: p.x, y: p.y, w: 0, h: 0, classId: st.activeClassId });
  };

  const onMouseMove = (e: KonvaEventObject<MouseEvent>) => {
    const start = drawStart.current;
    const st = useEditorStore.getState();
    const pos = e.target.getStage()?.getPointerPosition();
    if (!start || !pos || !st.image || !st.draft) return;
    st.setDraft({ ...clampRect(normalizeRect(start, toImage(pos, st.view)), st.image), classId: st.draft.classId });
  };

  const onMouseUp = () => {
    const start = drawStart.current;
    drawStart.current = null;
    const st = useEditorStore.getState();
    const draft = st.draft;
    st.setDraft(null);
    if (!start || !draft || !st.image) return;
    const rect = roundRect(clampRect(draft, st.image));
    if (isDrawable(rect)) void actions.drawBox(rect, draft.classId);
  };
```

and render:

```tsx
          <EditorCanvas src={src} onBackgroundMouseDown={onBackgroundMouseDown} onMouseMove={onMouseMove} onMouseUp={onMouseUp}>
            <BoxLayer classes={project.classes} onCommitRect={(id, before, after) => void actions.commitRect(id, before, after)} />
          </EditorCanvas>
```

- [ ] **Step 8: Add the e2e tests for drawing and dragging**

Append to `frontend/e2e/editor.spec.ts`:

```ts
test("drawing on the canvas posts a box in image pixels with the active class", async ({ page }) => {
  await openEditor(page);
  const from = await displayPoint(page, 2000, 1500);
  const to = await displayPoint(page, 2400, 1800);
  const posted = page.waitForRequest((r) => r.method() === "POST" && r.url().endsWith(`/images/${IMG}/boxes`));
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(to.x, to.y, { steps: 8 });
  await page.mouse.up();
  const body = (await posted).postDataJSON() as { class_id: string; x: number; y: number; w: number; h: number };
  const { scale } = await readView(page);
  const tolerance = 2 / scale + 1;
  expect(body.class_id).toBe("c1a2b3c4-0000-4000-8000-000000000001");
  expect(Math.abs(body.x - 2000)).toBeLessThan(tolerance);
  expect(Math.abs(body.y - 1500)).toBeLessThan(tolerance);
  expect(Math.abs(body.w - 400)).toBeLessThan(tolerance);
  expect(Math.abs(body.h - 300)).toBeLessThan(tolerance);
});

test("dragging a box patches its position", async ({ page }) => {
  await openEditor(page);
  const centre = await displayPoint(page, 512 + 70, 300 + 45);
  const patched = page.waitForRequest((r) => r.method() === "PATCH" && r.url().includes("/boxes/b0000000-6666-4000-8000-000000000001"));
  await page.mouse.move(centre.x, centre.y);
  await page.mouse.down();
  await page.mouse.move(centre.x + 40, centre.y + 20, { steps: 8 });
  await page.mouse.up();
  const body = (await patched).postDataJSON() as { x: number; y: number; w: number; h: number };
  const { scale } = await readView(page);
  expect(Math.abs(body.x - (512 + 40 / scale))).toBeLessThan(2 / scale + 1);
  expect(Math.abs(body.y - (300 + 20 / scale))).toBeLessThan(2 / scale + 1);
  expect(body.w).toBeCloseTo(140, 0);
  expect(body.h).toBeCloseTo(90, 0);
});
```

- [ ] **Step 9: Run the e2e tests to verify they pass**

Run: `pnpm exec tsc -b && pnpm lint && pnpm e2e e2e/editor.spec.ts -g "drawing|dragging|loads the image"`
Expected: `3 passed`. Under the mock the drawn box is answered with the example box `b…0001` (see Mock server limitations), so the canvas shows the same two boxes afterwards; the request body is what the test checks.

- [ ] **Step 10: Commit**

```bash
git add src/editor/commands.ts src/editor/commands.test.ts src/editor/useHistory.ts src/editor/useEditorActions.ts src/editor/labels.ts src/editor/BoxLayer.tsx src/screens/EditorScreen.tsx e2e/editor.spec.ts
git commit -m "feat(ui): box layer with draw, move, resize and compensating undo commands"
```

---

### Task 12: Region list, class sidebar, toolbar and hotkeys

**Files:**
- Create: `frontend/src/editor/RegionList.tsx`, `frontend/src/editor/ClassSidebar.tsx`, `frontend/src/editor/EditorToolbar.tsx`, `frontend/src/editor/useEditorHotkeys.ts`
- Modify: `frontend/src/editor/labels.ts` (add `provenanceLabel`), `frontend/src/screens/EditorScreen.tsx` (fill the three slots, mount the hotkeys), `frontend/e2e/editor.spec.ts`
- Test: `frontend/src/editor/RegionList.test.tsx`, `frontend/src/editor/ClassSidebar.test.tsx`, e2e

**Interfaces:**
- Consumes: `EditorActions`, `useEditorStore`, `actionForKey`, `isTypingTarget`, `visibleBoxes`, `colourOf` from `labels.ts`.
- Produces:
  - `provenanceLabel(p: Provenance): string` in `labels.ts` ("Person", "Model <model_name>", "Cloud <provider>").
  - `RegionList({boxes, classes, selectedId, hoveredId, onSelect, onHover, onSetClass, onDelete, onReview}: {boxes: Box[]; classes: ClassDef[]; selectedId: string | null; hoveredId: string | null; onSelect: (id: string) => void; onHover: (id: string | null) => void; onSetClass: (id: string, classId: string) => void; onDelete: (id: string) => void; onReview: (id: string, action: "accept" | "reject") => void})`: a `role="list"` of `role="listitem"` rows (`data-box-id`, `aria-selected`), each with a colour swatch, `<select aria-label="Class of box N">`, confidence (`81%` or `–`), the provenance badge, a review chip (`Proposal`, `Accepted`, `Edited`, `Rejected`) and a `Delete box N` button. Accept/Reject buttons per proposal are added in Task 13.
  - `ClassSidebar({classes, activeClassId, counts, onSelect}: {classes: ClassDef[]; activeClassId: string | null; counts: Record<string, number>; onSelect: (id: string) => void})`: one `aria-pressed` button per class with swatch, name, hotkey and box count.
  - `EditorToolbar(props: ToolbarProps)` with `interface ToolbarProps {fileName: string; position: {index: number; count: number} | null; zoom: number; pending: number; canUndo: boolean; canRedo: boolean; onPrev: () => void; onNext: () => void; onFit: () => void; onOneToOne: () => void; onUndo: () => void; onRedo: () => void; extra?: ReactNode}`: buttons "Previous", "Next", "Fit", "1:1", "Undo", "Redo", the zoom percentage (`data-testid="zoom"`), the position "n / count", and a `role="status"` save indicator ("Saving…" while `pending > 0`, else "Saved"). `extra` renders the review controls from Task 13.
  - `useEditorHotkeys({enabled, classes, actions, nav}: {enabled: boolean; classes: ClassDef[]; actions: EditorActions; nav?: {next: () => void; prev: () => void}}): void`: document `keydown`/`keyup` listener; ignores typing targets; `class-key` resolves the class whose `hotkey` equals the key, makes it active and reclassifies the selected box if any; Space toggles `spaceHeld` (prevent default); Escape deselects and cancels a draft; the rest dispatch to `actions`/`nav`.

- [ ] **Step 1: Write the failing component tests**

`frontend/src/editor/RegionList.test.tsx`:

```tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { exampleClasses, personBox, proposalBox, CLASS_ID } from "@/test/fixtures";
import { provenanceLabel } from "./labels";
import { RegionList } from "./RegionList";

describe("RegionList", () => {
  it("shows class, confidence, provenance and review state and dispatches edits", () => {
    const onSelect = vi.fn();
    const onSetClass = vi.fn();
    const onDelete = vi.fn();
    render(
      <RegionList
        boxes={[personBox, proposalBox]}
        classes={exampleClasses}
        selectedId={personBox.id}
        hoveredId={null}
        onSelect={onSelect}
        onHover={() => {}}
        onSetClass={onSetClass}
        onDelete={onDelete}
        onReview={() => {}}
      />,
    );
    const rows = screen.getAllByRole("listitem");
    expect(rows).toHaveLength(2);
    expect(rows[0]).toHaveAttribute("aria-selected", "true");
    expect(rows[0]).toHaveTextContent("Person");
    expect(rows[0]).toHaveTextContent("Accepted");
    expect(rows[1]).toHaveTextContent("81%");
    expect(rows[1]).toHaveTextContent("Model yolo11m-coco");
    expect(rows[1]).toHaveTextContent("Proposal");
    expect(screen.getByLabelText("Class of box 2")).toHaveValue(CLASS_ID(4));

    fireEvent.click(rows[1]);
    expect(onSelect).toHaveBeenCalledWith(proposalBox.id);
    fireEvent.change(screen.getByLabelText("Class of box 1"), { target: { value: CLASS_ID(3) } });
    expect(onSetClass).toHaveBeenCalledWith(personBox.id, CLASS_ID(3));
    fireEvent.click(screen.getByRole("button", { name: "Delete box 1" }));
    expect(onDelete).toHaveBeenCalledWith(personBox.id);
  });

  it("labels provenance", () => {
    expect(provenanceLabel(personBox.provenance)).toBe("Person");
    expect(provenanceLabel(proposalBox.provenance)).toBe("Model yolo11m-coco");
    expect(provenanceLabel({ kind: "cloud_provider", model_id: null, provider: "anthropic", model_name: "claude-opus-5", query_run_id: "q" })).toBe("Cloud anthropic");
  });
});
```

`frontend/src/editor/ClassSidebar.test.tsx`:

```tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { exampleClasses, CLASS_ID } from "@/test/fixtures";
import { ClassSidebar } from "./ClassSidebar";

describe("ClassSidebar", () => {
  it("lists classes with hotkeys and counts and marks the active one", () => {
    const onSelect = vi.fn();
    render(<ClassSidebar classes={exampleClasses} activeClassId={CLASS_ID(4)} counts={{ [CLASS_ID(1)]: 2 }} onSelect={onSelect} />);
    const buttons = screen.getAllByRole("button");
    expect(buttons).toHaveLength(8);
    expect(buttons[3]).toHaveAttribute("aria-pressed", "true");
    expect(buttons[0]).toHaveTextContent("excavator");
    expect(buttons[0]).toHaveTextContent("1");
    expect(buttons[0]).toHaveTextContent("2");
    fireEvent.click(buttons[1]);
    expect(onSelect).toHaveBeenCalledWith(CLASS_ID(2));
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm test src/editor/RegionList.test.tsx src/editor/ClassSidebar.test.tsx`
Expected: FAIL with unresolved imports.

- [ ] **Step 3: Add `provenanceLabel` to `labels.ts` and implement `RegionList.tsx`**

Append to `frontend/src/editor/labels.ts` (and add `Provenance` to its type import from `@contract/client`):

```ts
/** Badge text for the region list: who produced the box. */
export function provenanceLabel(p: Provenance): string {
  if (p.kind === "person") return "Person";
  if (p.kind === "local_model") return p.model_name ? `Model ${p.model_name}` : "Model";
  return p.provider ? `Cloud ${p.provider}` : "Cloud";
}
```

`frontend/src/editor/RegionList.tsx`:

```tsx
import type { Box, ClassDef } from "@contract/client";
import { colourOf, provenanceLabel } from "./labels";

const REVIEW_LABEL: Record<Box["review_state"], string> = {
  unreviewed: "Proposal",
  accepted: "Accepted",
  edited: "Edited",
  rejected: "Rejected",
};

const REVIEW_CLASS: Record<Box["review_state"], string> = {
  unreviewed: "bg-amber-700/60 text-amber-100",
  accepted: "bg-emerald-800/60 text-emerald-100",
  edited: "bg-sky-800/60 text-sky-100",
  rejected: "bg-slate-700 text-slate-300 line-through",
};

interface Props {
  boxes: Box[];
  classes: ClassDef[];
  selectedId: string | null;
  hoveredId: string | null;
  onSelect: (id: string) => void;
  onHover: (id: string | null) => void;
  onSetClass: (id: string, classId: string) => void;
  onDelete: (id: string) => void;
  onReview: (id: string, action: "accept" | "reject") => void;
}

export function RegionList({ boxes, classes, selectedId, hoveredId, onSelect, onHover, onSetClass, onDelete, onReview }: Props) {
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <h2 className="border-b border-slate-800 px-3 py-2 text-xs font-semibold uppercase tracking-wide text-slate-400">
        Regions ({boxes.length})
      </h2>
      <ul role="list" className="min-h-0 flex-1 overflow-auto">
        {boxes.map((b, i) => {
          const n = i + 1;
          const selected = b.id === selectedId;
          return (
            <li
              key={b.id}
              role="listitem"
              data-box-id={b.id}
              aria-selected={selected}
              onClick={() => onSelect(b.id)}
              onMouseEnter={() => onHover(b.id)}
              onMouseLeave={() => onHover(null)}
              className={`flex cursor-pointer flex-col gap-1 border-b border-slate-800/60 px-3 py-2 text-xs ${
                selected ? "bg-orange-900/40" : b.id === hoveredId ? "bg-slate-800/60" : ""
              }`}
            >
              <div className="flex items-center gap-2">
                <span className="h-3 w-3 shrink-0 rounded-sm" style={{ background: colourOf(classes, b.class_id) }} />
                <select
                  aria-label={`Class of box ${n}`}
                  value={b.class_id}
                  onClick={(e) => e.stopPropagation()}
                  onChange={(e) => onSetClass(b.id, e.target.value)}
                  className="min-w-0 flex-1 rounded border border-slate-700 bg-slate-800 px-1 py-0.5"
                >
                  {classes.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
                <span className="w-8 text-right tabular-nums text-slate-300">{b.confidence === null ? "–" : `${Math.round(b.confidence * 100)}%`}</span>
              </div>
              <div className="flex items-center gap-1">
                <span className="rounded bg-slate-800 px-1.5 py-0.5 text-slate-300">{provenanceLabel(b.provenance)}</span>
                <span className={`rounded px-1.5 py-0.5 ${REVIEW_CLASS[b.review_state]}`}>{REVIEW_LABEL[b.review_state]}</span>
                <span className="ml-auto flex gap-1">
                  {b.review_state === "unreviewed" && (
                    <>
                      <button
                        type="button"
                        aria-label={`Accept box ${n}`}
                        onClick={(e) => {
                          e.stopPropagation();
                          onReview(b.id, "accept");
                        }}
                        className="rounded px-1.5 py-0.5 text-emerald-300 hover:bg-slate-800"
                      >
                        Accept
                      </button>
                      <button
                        type="button"
                        aria-label={`Reject box ${n}`}
                        onClick={(e) => {
                          e.stopPropagation();
                          onReview(b.id, "reject");
                        }}
                        className="rounded px-1.5 py-0.5 text-amber-300 hover:bg-slate-800"
                      >
                        Reject
                      </button>
                    </>
                  )}
                  <button
                    type="button"
                    aria-label={`Delete box ${n}`}
                    onClick={(e) => {
                      e.stopPropagation();
                      onDelete(b.id);
                    }}
                    className="rounded px-1.5 py-0.5 text-red-300 hover:bg-slate-800"
                  >
                    Delete
                  </button>
                </span>
              </div>
            </li>
          );
        })}
        {boxes.length === 0 && <li className="px-3 py-4 text-xs text-slate-500">No boxes yet. Pick a class and drag on the image.</li>}
      </ul>
    </div>
  );
}
```

(The Accept/Reject buttons are included here so Task 13 only has to wire and test them.)

- [ ] **Step 4: Implement `ClassSidebar.tsx`**

```tsx
import type { ClassDef } from "@contract/client";

interface Props {
  classes: ClassDef[];
  activeClassId: string | null;
  counts: Record<string, number>;
  onSelect: (id: string) => void;
}

export function ClassSidebar({ classes, activeClassId, counts, onSelect }: Props) {
  return (
    <div className="flex flex-col gap-1">
      <h2 className="px-2 py-1 text-xs font-semibold uppercase tracking-wide text-slate-400">Classes</h2>
      {classes.map((c) => {
        const active = c.id === activeClassId;
        return (
          <button
            key={c.id}
            type="button"
            aria-pressed={active}
            onClick={() => onSelect(c.id)}
            className={`flex items-center gap-2 rounded px-2 py-1 text-left text-sm ${active ? "bg-slate-800 text-white ring-1 ring-orange-500" : "text-slate-300 hover:bg-slate-800"}`}
          >
            <span className="h-3 w-3 shrink-0 rounded-sm" style={{ background: c.colour }} />
            <span className="min-w-0 flex-1 truncate">{c.name}</span>
            <span className="text-xs text-slate-500">{counts[c.id] ?? 0}</span>
            {c.hotkey && <kbd className="rounded border border-slate-600 px-1 text-[10px] text-slate-300">{c.hotkey}</kbd>}
          </button>
        );
      })}
    </div>
  );
}
```

- [ ] **Step 5: Implement `EditorToolbar.tsx`**

```tsx
import type { ReactNode } from "react";

export interface ToolbarProps {
  fileName: string;
  position: { index: number; count: number } | null;
  zoom: number;
  pending: number;
  canUndo: boolean;
  canRedo: boolean;
  onPrev: () => void;
  onNext: () => void;
  onFit: () => void;
  onOneToOne: () => void;
  onUndo: () => void;
  onRedo: () => void;
  extra?: ReactNode;
}

const btn = "rounded border border-slate-700 px-2 py-0.5 text-xs hover:bg-slate-800 disabled:opacity-40";

export function EditorToolbar(p: ToolbarProps) {
  return (
    <div className="flex flex-wrap items-center gap-2 border-b border-slate-800 px-3 py-1.5 text-sm">
      <button type="button" className={btn} onClick={p.onPrev} title="Ctrl+Left" disabled={!p.position || p.position.index <= 0}>
        Previous
      </button>
      <button type="button" className={btn} onClick={p.onNext} title="Ctrl+Right" disabled={!p.position || p.position.index >= p.position.count - 1}>
        Next
      </button>
      {p.position && p.position.index >= 0 && (
        <span className="text-xs text-slate-400" data-testid="position">
          {p.position.index + 1} / {p.position.count}
        </span>
      )}
      <span className="min-w-0 truncate text-slate-300">{p.fileName}</span>
      <span className="mx-1 h-4 border-l border-slate-700" />
      <button type="button" className={btn} onClick={p.onFit} title="F">
        Fit
      </button>
      <button type="button" className={btn} onClick={p.onOneToOne} title="0 or Ctrl+1">
        1:1
      </button>
      <span className="w-12 text-xs tabular-nums text-slate-400" data-testid="zoom">
        {Math.round(p.zoom * 100)}%
      </span>
      <span className="mx-1 h-4 border-l border-slate-700" />
      <button type="button" className={btn} onClick={p.onUndo} disabled={!p.canUndo} title="Ctrl+Z">
        Undo
      </button>
      <button type="button" className={btn} onClick={p.onRedo} disabled={!p.canRedo} title="Ctrl+Y">
        Redo
      </button>
      {p.extra}
      <span role="status" className={`ml-auto text-xs ${p.pending > 0 ? "text-amber-300" : "text-slate-500"}`}>
        {p.pending > 0 ? "Saving…" : "Saved"}
      </span>
    </div>
  );
}
```

- [ ] **Step 6: Implement `useEditorHotkeys.ts`**

```ts
import { useEffect } from "react";
import type { ClassDef } from "@contract/client";
import { useEditorStore } from "@/store/editor";
import { actionForKey, isTypingTarget } from "./hotkeys";
import type { EditorActions } from "./useEditorActions";

interface Options {
  enabled: boolean;
  classes: ClassDef[];
  actions: EditorActions;
  nav?: { next: () => void; prev: () => void };
}

/** Document-level hotkeys for the editor (spec section 6); typing targets are left alone. */
export function useEditorHotkeys({ enabled, classes, actions, nav }: Options): void {
  useEffect(() => {
    if (!enabled) return;
    const handle = (e: KeyboardEvent) => {
      if (isTypingTarget(e.target)) return;
      const action = actionForKey({
        type: e.type === "keyup" ? "keyup" : "keydown",
        key: e.key,
        ctrlKey: e.ctrlKey,
        metaKey: e.metaKey,
        shiftKey: e.shiftKey,
        altKey: e.altKey,
        repeat: e.repeat,
      });
      if (!action) return;
      const st = useEditorStore.getState();
      switch (action.type) {
        case "class-key": {
          const cls = classes.find((c) => c.hotkey === action.key);
          if (!cls) return;
          e.preventDefault();
          st.setActiveClass(cls.id);
          if (st.selectedId) void actions.setClass(st.selectedId, cls.id);
          return;
        }
        case "space-down":
          e.preventDefault();
          st.setSpaceHeld(true);
          return;
        case "space-up":
          e.preventDefault();
          st.setSpaceHeld(false);
          return;
        case "escape":
          st.select(null);
          st.setDraft(null);
          return;
        case "fit":
          st.fit();
          return;
        case "one-to-one":
          e.preventDefault();
          st.oneToOne();
          return;
        case "delete":
          e.preventDefault();
          void actions.deleteSelected();
          return;
        case "duplicate":
          e.preventDefault();
          void actions.duplicateSelected();
          return;
        case "accept-all":
          void actions.acceptAll();
          return;
        case "reject-all":
          void actions.rejectAll();
          return;
        case "undo":
          e.preventDefault();
          void actions.undo();
          return;
        case "redo":
          e.preventDefault();
          void actions.redo();
          return;
        case "next":
          e.preventDefault();
          nav?.next();
          return;
        case "prev":
          e.preventDefault();
          nav?.prev();
          return;
      }
    };
    document.addEventListener("keydown", handle);
    document.addEventListener("keyup", handle);
    return () => {
      document.removeEventListener("keydown", handle);
      document.removeEventListener("keyup", handle);
      useEditorStore.getState().setSpaceHeld(false);
    };
  }, [enabled, classes, actions, nav]);
}
```

- [ ] **Step 7: Fill the slots in `EditorScreen.tsx`**

Add imports:

```tsx
import { ClassSidebar } from "@/editor/ClassSidebar";
import { EditorToolbar } from "@/editor/EditorToolbar";
import { RegionList } from "@/editor/RegionList";
import { useEditorHotkeys } from "@/editor/useEditorHotkeys";
import { visibleBoxes } from "@/store/editor";
```

In `EditorBody` add state reads and the hotkey hook (after `actions`):

```tsx
  const boxes = useEditorStore((s) => s.boxes);
  const order = useEditorStore((s) => s.order);
  const showRejected = useEditorStore((s) => s.showRejected);
  const selectedId = useEditorStore((s) => s.selectedId);
  const hoveredId = useEditorStore((s) => s.hoveredId);
  const zoom = useEditorStore((s) => s.view.scale);
  const pending = useEditorStore((s) => s.pending);
  const select = useEditorStore((s) => s.select);
  const hover = useEditorStore((s) => s.hover);
  const fit = useEditorStore((s) => s.fit);
  const oneToOne = useEditorStore((s) => s.oneToOne);
  const visible = useMemo(() => visibleBoxes({ boxes, order, showRejected }), [boxes, order, showRejected]);
  const counts = useMemo(() => {
    const c: Record<string, number> = {};
    for (const b of visible) c[b.class_id] = (c[b.class_id] ?? 0) + 1;
    return c;
  }, [visible]);
  useEditorHotkeys({ enabled: !loading, classes: project.classes, actions });
```

Replace the left aside, the toolbar div and the right aside with:

```tsx
      <aside className="flex w-48 shrink-0 flex-col border-r border-slate-800 bg-slate-950 p-2">
        <ClassSidebar classes={project.classes} activeClassId={activeClassId} counts={counts} onSelect={setActiveClass} />
      </aside>
      <div className="flex min-w-0 flex-1 flex-col">
        <EditorToolbar
          fileName={image?.file_name ?? (loading ? "Loading…" : "")}
          position={null}
          zoom={zoom}
          pending={pending}
          canUndo={canUndo}
          canRedo={canRedo}
          onPrev={() => {}}
          onNext={() => {}}
          onFit={fit}
          onOneToOne={oneToOne}
          onUndo={() => void actions.undo()}
          onRedo={() => void actions.redo()}
        />
        {error && (
          <p role="alert" className="border-b border-red-900 bg-red-950 px-3 py-1 text-xs text-red-200">
            {error}
          </p>
        )}
        {notice && (
          <p role="status" className="border-b border-slate-800 bg-slate-900 px-3 py-1 text-xs text-slate-300">
            {notice}
          </p>
        )}
        <div className="min-h-0 flex-1">
          <EditorCanvas src={src} onBackgroundMouseDown={onBackgroundMouseDown} onMouseMove={onMouseMove} onMouseUp={onMouseUp}>
            <BoxLayer classes={project.classes} onCommitRect={(id, before, after) => void actions.commitRect(id, before, after)} />
          </EditorCanvas>
        </div>
      </div>
      <aside className="flex w-72 shrink-0 flex-col border-l border-slate-800 bg-slate-950">
        <RegionList
          boxes={visible}
          classes={project.classes}
          selectedId={selectedId}
          hoveredId={hoveredId}
          onSelect={select}
          onHover={hover}
          onSetClass={(id, classId) => void actions.setClass(id, classId)}
          onDelete={(id) => void actions.deleteBox(id)}
          onReview={(id, action) => void actions.review([id], action)}
        />
      </aside>
```

(`position`, `onPrev` and `onNext` are wired in Task 14.)

- [ ] **Step 8: Add the hotkey e2e tests**

Append to `frontend/e2e/editor.spec.ts`:

```ts
test("class hotkeys, fit and 1:1 keys, region list selection, Delete and Ctrl+D", async ({ page }) => {
  await openEditor(page);
  const fitted = await readView(page);
  await page.keyboard.press("4");
  await expect(page.getByRole("button", { name: /dump_truck/ })).toHaveAttribute("aria-pressed", "true");
  await page.keyboard.press("0");
  await expect(page.getByTestId("editor-canvas")).toHaveAttribute("data-view-scale", "1.0000");
  await page.keyboard.press("f");
  await expect(page.getByTestId("editor-canvas")).toHaveAttribute("data-view-scale", fitted.scale.toFixed(4));

  const excavatorRow = page.getByRole("listitem").filter({ hasText: "Person" });
  await excavatorRow.click();
  await expect(excavatorRow).toHaveAttribute("aria-selected", "true");

  const duplicated = page.waitForRequest((r) => r.method() === "POST" && r.url().endsWith(`/images/${IMG}/boxes`));
  await page.keyboard.press("Control+d");
  const dupBody = (await duplicated).postDataJSON() as { x: number; y: number; w: number; h: number };
  expect(dupBody).toEqual({ class_id: "c1a2b3c4-0000-4000-8000-000000000001", x: 524, y: 312, w: 140, h: 90 });

  await excavatorRow.click();
  const deleted = page.waitForRequest((r) => r.method() === "DELETE" && r.url().includes("/boxes/b0000000-6666-4000-8000-000000000001"));
  await page.keyboard.press("Delete");
  await deleted;
  await expect(page.getByRole("status").filter({ hasText: /Saved/ })).toBeVisible();
});

test("a class hotkey with a selected box reclassifies it", async ({ page }) => {
  await openEditor(page);
  await page.getByRole("listitem").filter({ hasText: "Person" }).click();
  const patched = page.waitForRequest((r) => r.method() === "PATCH" && r.url().includes("/boxes/b0000000-6666-4000-8000-000000000001"));
  await page.keyboard.press("3");
  expect((await patched).postDataJSON()).toEqual({ class_id: "c1a2b3c4-0000-4000-8000-000000000003" });
});
```

- [ ] **Step 9: Run everything for the editor**

Run: `pnpm test src/editor && pnpm exec tsc -b && pnpm lint && pnpm e2e e2e/editor.spec.ts`
Expected: unit files pass; all six editor e2e tests pass (including "pans with space-drag" from Task 10).

- [ ] **Step 10: Commit**

```bash
git add src/editor/labels.ts src/editor/RegionList.tsx src/editor/RegionList.test.tsx src/editor/ClassSidebar.tsx src/editor/ClassSidebar.test.tsx src/editor/EditorToolbar.tsx src/editor/useEditorHotkeys.ts src/screens/EditorScreen.tsx e2e/editor.spec.ts
git commit -m "feat(ui): region list, class sidebar, toolbar and editor hotkeys"
```

---

### Task 13: Proposals and review actions

**Files:**
- Modify: `frontend/src/screens/EditorScreen.tsx` (review controls in the toolbar `extra` slot), `frontend/e2e/editor.spec.ts`
- Test: e2e (accept all, reject all, single accept, pre-annotation on open); `frontend/src/store/editor.test.ts` already covers `visibleProposalIds`.

**Interfaces:**
- Consumes: `actions.acceptAll`, `actions.rejectAll`, `actions.review`, `visibleProposalIds`, `useEditorStore.toggleShowRejected`, `useEditorImage` (pre-annotation on open from Task 10).
- Produces: toolbar controls "Accept all (A)" and "Reject all (R)" (disabled when there are no visible proposals), a proposal counter `data-testid="proposal-count"` ("1 proposal" / "n proposals"), and a "Show rejected" `aria-pressed` toggle. Dashed rendering of proposals and click-edit-accepts-as-edited already come from Task 11 (`PATCH` turns a proposal into `edited`, and the store shows the server's state).

- [ ] **Step 1: Write the failing e2e tests**

Append to `frontend/e2e/editor.spec.ts`:

```ts
const PROPOSAL = "b0000000-6666-4000-8000-000000000002";

test("A accepts all visible proposals and R rejects them through the review endpoint", async ({ page }) => {
  await openEditor(page);
  await expect(page.getByTestId("proposal-count")).toHaveText("1 proposal");
  const accepted = page.waitForRequest((r) => r.method() === "POST" && r.url().endsWith("/boxes/review"));
  await page.keyboard.press("a");
  expect((await accepted).postDataJSON()).toEqual({ box_ids: [PROPOSAL], action: "accept" });
  await expect(page.getByTestId("proposal-count")).toHaveText("0 proposals");
  await expect(page.getByRole("button", { name: "Accept all (A)" })).toBeDisabled();
});

test("R rejects, Show rejected reveals the row, and the region list accepts one proposal", async ({ page }) => {
  await openEditor(page);
  const rejected = page.waitForRequest((r) => r.method() === "POST" && r.url().endsWith("/boxes/review"));
  await page.keyboard.press("r");
  expect((await rejected).postDataJSON()).toEqual({ box_ids: [PROPOSAL], action: "reject" });
  await expect(page.getByRole("listitem")).toHaveCount(1);
  await page.getByRole("button", { name: "Show rejected" }).click();
  await expect(page.getByRole("listitem")).toHaveCount(2);
  await expect(page.getByRole("listitem").nth(1)).toContainText("Rejected");

  await page.reload();
  await openEditor(page);
  const one = page.waitForRequest((r) => r.method() === "POST" && r.url().endsWith("/boxes/review"));
  await page.getByRole("button", { name: "Accept box 2" }).click();
  expect((await one).postDataJSON()).toEqual({ box_ids: [PROPOSAL], action: "accept" });
});

test("pre-annotates on open when no proposal is pending and tolerates 501", async ({ page }) => {
  await page.route(`**/api/v1/projects/${P}/images/${IMG}/boxes`, (route) =>
    route.request().method() === "GET"
      ? route.fulfill({
          status: 200,
          contentType: "application/json",
          headers: { "Access-Control-Allow-Origin": "*" },
          body: JSON.stringify({
            items: [
              {
                id: "b0000000-6666-4000-8000-000000000001",
                image_id: IMG,
                class_id: "c1a2b3c4-0000-4000-8000-000000000001",
                x: 512,
                y: 300,
                w: 140,
                h: 90,
                confidence: null,
                provenance: { kind: "person", model_id: null, provider: null, model_name: null, query_run_id: null },
                review_state: "accepted",
                reviewed_at: "2026-09-17T10:45:00Z",
                created_at: "2026-09-17T10:45:00Z",
              },
            ],
          }),
        })
      : route.continue(),
  );
  const preannotate = page.waitForRequest((r) => r.method() === "POST" && r.url().endsWith(`/images/${IMG}/preannotate`));
  await openEditor(page);
  await preannotate;
  await expect(page.getByTestId("proposal-count")).toHaveText("1 proposal");
  await expect(page.getByRole("status").filter({ hasText: "1 proposal from the pre-annotation model" })).toBeVisible();

  await page.route(`**/api/v1/projects/${P}/images/${IMG}/preannotate`, (route) =>
    route.fulfill({
      status: 501,
      contentType: "application/json",
      headers: { "Access-Control-Allow-Origin": "*" },
      body: JSON.stringify({ error: { code: "not_implemented", message: "pre-annotation arrives with S4", details: {} } }),
    }),
  );
  await page.reload();
  await openEditor(page);
  await expect(page.getByRole("status").filter({ hasText: "Pre-annotation is not available yet" })).toBeVisible();
  await expect(page.getByRole("alert")).toHaveCount(0);
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `pnpm e2e e2e/editor.spec.ts -g "accepts all|R rejects|pre-annotates"`
Expected: FAIL (`proposal-count` and the review buttons do not exist yet).

- [ ] **Step 3: Add the review controls to the toolbar slot**

In `EditorBody` (`EditorScreen.tsx`) add:

```tsx
import { visibleProposalIds } from "@/store/editor";
```

```tsx
  const proposalIds = useMemo(() => visibleProposalIds({ boxes, order, showRejected }), [boxes, order, showRejected]);
  const toggleShowRejected = useEditorStore((s) => s.toggleShowRejected);
  const reviewControls = (
    <>
      <span className="mx-1 h-4 border-l border-slate-700" />
      <span className="text-xs text-slate-400" data-testid="proposal-count">
        {proposalIds.length} {proposalIds.length === 1 ? "proposal" : "proposals"}
      </span>
      <button
        type="button"
        className="rounded border border-emerald-800 px-2 py-0.5 text-xs text-emerald-200 hover:bg-emerald-900/40 disabled:opacity-40"
        disabled={proposalIds.length === 0}
        onClick={() => void actions.acceptAll()}
      >
        Accept all (A)
      </button>
      <button
        type="button"
        className="rounded border border-amber-800 px-2 py-0.5 text-xs text-amber-200 hover:bg-amber-900/40 disabled:opacity-40"
        disabled={proposalIds.length === 0}
        onClick={() => void actions.rejectAll()}
      >
        Reject all (R)
      </button>
      <button
        type="button"
        aria-pressed={showRejected}
        className={`rounded border border-slate-700 px-2 py-0.5 text-xs ${showRejected ? "bg-slate-700 text-white" : "hover:bg-slate-800"}`}
        onClick={toggleShowRejected}
      >
        Show rejected
      </button>
    </>
  );
```

and pass `extra={reviewControls}` to `<EditorToolbar … />`.

Since `visibleBoxes` and `visibleProposalIds` are imported from the same module, combine the imports: `import { useEditorStore, visibleBoxes, visibleProposalIds } from "@/store/editor";`.

- [ ] **Step 4: Run the e2e tests to verify they pass**

Run: `pnpm exec tsc -b && pnpm lint && pnpm e2e e2e/editor.spec.ts`
Expected: all editor tests pass (9 so far). Note for the third test: after the `page.route` override the boxes list has no proposal, so `useEditorImage` posts to `preannotate` and the mock answers with the example proposal, which the store upserts.

- [ ] **Step 5: Commit**

```bash
git add src/screens/EditorScreen.tsx e2e/editor.spec.ts
git commit -m "feat(ui): proposal review controls and pre-annotation on open"
```

---

### Task 14: Navigation with auto-save, undo/redo wiring

**Files:**
- Create: `frontend/src/editor/useEditorNavigation.ts`
- Modify: `frontend/src/screens/EditorScreen.tsx`, `frontend/e2e/editor.spec.ts`
- Test: `frontend/src/editor/useEditorNavigation.test.tsx`, e2e

**Interfaces:**
- Consumes: `useNavigationStore`, `waitForIdle`, `fetchImagePage`, `useNavigate`.
- Produces: `useEditorNavigation(projectId: string, imageId: string): {next: () => void; prev: () => void; position: {index: number; count: number} | null}`. When the navigation context is empty or does not contain `imageId` (deep link, page reload), it loads `GET /images?sort=path&order=asc&limit=1000` once and sets the context with source `"data"`. `next`/`prev` first `await waitForIdle()` (auto-save: every edit is already an API call; this only waits for in-flight ones) and then navigate to `/p/{projectId}/edit/{id}`.

- [ ] **Step 1: Write the failing tests**

`frontend/src/editor/useEditorNavigation.test.tsx`:

```tsx
import type { ReactNode } from "react";
import { describe, it, expect, beforeEach } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { exampleImagePage, fakeClient, PROJECT_ID, IMAGE_ID, IMAGE_ID_2 } from "@/test/fixtures";
import { TestApiProvider } from "@/test/render";
import { useEditorStore } from "@/store/editor";
import { useNavigationStore } from "@/store/navigation";
import { useEditorNavigation } from "./useEditorNavigation";

function useHarness(projectId: string, imageId: string) {
  return { nav: useEditorNavigation(projectId, imageId), path: useLocation().pathname };
}

describe("useEditorNavigation", () => {
  beforeEach(() => {
    useNavigationStore.getState().setContext([], null);
    useEditorStore.getState().reset();
  });

  it("loads a context on a deep link and navigates after pending requests settle", async () => {
    const { api, requests } = fakeClient([{ method: "GET", path: /\/images$/, body: exampleImagePage }]);
    const wrapper = ({ children }: { children: ReactNode }) => (
      <TestApiProvider api={api}>
        <MemoryRouter initialEntries={[`/p/${PROJECT_ID}/edit/${IMAGE_ID}`]}>
          <Routes>
            <Route path="/p/:projectId/edit/:imageId" element={children} />
          </Routes>
        </MemoryRouter>
      </TestApiProvider>
    );
    const { result } = renderHook(() => useHarness(PROJECT_ID, IMAGE_ID), { wrapper });
    await waitFor(() => expect(result.current.nav.position).toEqual({ index: 0, count: 2 }));
    expect(requests[0].url).toContain("sort=path");
    expect(requests[0].url).toContain("limit=1000");

    useEditorStore.getState().beginRequest();
    act(() => result.current.nav.next());
    await new Promise((r) => setTimeout(r, 20));
    expect(result.current.path).toBe(`/p/${PROJECT_ID}/edit/${IMAGE_ID}`);
    act(() => useEditorStore.getState().endRequest());
    await waitFor(() => expect(result.current.path).toBe(`/p/${PROJECT_ID}/edit/${IMAGE_ID_2}`));
  });

  it("uses an existing context without fetching", async () => {
    useNavigationStore.getState().setContext(["x", IMAGE_ID, "y"], "selection");
    const { api, requests } = fakeClient([]);
    const wrapper = ({ children }: { children: ReactNode }) => (
      <TestApiProvider api={api}>
        <MemoryRouter initialEntries={[`/p/${PROJECT_ID}/edit/${IMAGE_ID}`]}>{children}</MemoryRouter>
      </TestApiProvider>
    );
    const { result } = renderHook(() => useEditorNavigation(PROJECT_ID, IMAGE_ID), { wrapper });
    expect(result.current.position).toEqual({ index: 1, count: 3 });
    await new Promise((r) => setTimeout(r, 10));
    expect(requests).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm test src/editor/useEditorNavigation.test.tsx`
Expected: FAIL with `Failed to resolve import "./useEditorNavigation"`.

- [ ] **Step 3: Implement `useEditorNavigation.ts`**

```ts
import { useCallback, useEffect, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { useApi } from "@/api/client";
import { messageOf } from "@/api/errors";
import { fetchImagePage } from "@/api/images";
import { pushLog } from "@/app/diagnostics";
import { useEditorStore, waitForIdle } from "@/store/editor";
import { useNavigationStore } from "@/store/navigation";

/** Ctrl+Right / Ctrl+Left over the list that opened the editor; auto-save = wait for in-flight box calls. */
export function useEditorNavigation(projectId: string, imageId: string): {
  next: () => void;
  prev: () => void;
  position: { index: number; count: number } | null;
} {
  const api = useApi();
  const navigate = useNavigate();
  const ids = useNavigationStore((s) => s.ids);
  const setContext = useNavigationStore((s) => s.setContext);
  const known = ids.includes(imageId);

  useEffect(() => {
    if (known) return;
    let cancelled = false;
    fetchImagePage(api, projectId, { sort: "path", order: "asc", limit: 1000 })
      .then((page) => {
        if (!cancelled) setContext(page.items.map((i) => i.id), "data");
      })
      .catch((e: unknown) => pushLog(`navigation context failed: ${messageOf(e, String(e))}`));
    return () => {
      cancelled = true;
    };
  }, [api, projectId, known, setContext]);

  const position = useMemo(() => {
    const index = ids.indexOf(imageId);
    return index >= 0 ? { index, count: ids.length } : null;
  }, [ids, imageId]);

  const go = useCallback(
    (target: string | null) => {
      if (!target) return;
      void waitForIdle(useEditorStore).then(() => navigate(`/p/${projectId}/edit/${target}`));
    },
    [navigate, projectId],
  );

  const next = useCallback(() => go(useNavigationStore.getState().neighbours(imageId).next), [go, imageId]);
  const prev = useCallback(() => go(useNavigationStore.getState().neighbours(imageId).prev), [go, imageId]);

  return { next, prev, position };
}
```

- [ ] **Step 4: Wire it into `EditorScreen.tsx`**

```tsx
import { useEditorNavigation } from "@/editor/useEditorNavigation";
```

In `EditorBody`, after `actions`:

```tsx
  const navigation = useEditorNavigation(projectId, imageId);
  const nav = useMemo(() => ({ next: navigation.next, prev: navigation.prev }), [navigation.next, navigation.prev]);
  useEditorHotkeys({ enabled: !loading, classes: project.classes, actions, nav });
```

(remove the earlier `useEditorHotkeys` call without `nav`) and in the toolbar: `position={navigation.position}`, `onPrev={navigation.prev}`, `onNext={navigation.next}`.

- [ ] **Step 5: Add the e2e tests**

Append to `frontend/e2e/editor.spec.ts`:

```ts
const IMG2 = "10000000-5555-4000-8000-000000000002";

test("Ctrl+Right moves to the next image after in-flight saves finish; Ctrl+Left returns", async ({ page }) => {
  await page.route(`**/api/v1/projects/${P}/images/${IMG}/boxes`, async (route) => {
    if (route.request().method() !== "POST") return route.continue();
    await new Promise((r) => setTimeout(r, 800));
    return route.continue();
  });
  await openEditor(page);
  await expect(page.getByTestId("position")).toHaveText("1 / 2");
  const from = await displayPoint(page, 2000, 1500);
  const to = await displayPoint(page, 2300, 1700);
  let postDone = 0;
  const posted = page.waitForResponse((r) => r.request().method() === "POST" && r.url().endsWith(`/images/${IMG}/boxes`)).then(() => {
    postDone = Date.now();
  });
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(to.x, to.y, { steps: 6 });
  await page.mouse.up();
  await expect(page.getByRole("status").filter({ hasText: "Saving…" })).toBeVisible();
  await page.keyboard.press("Control+ArrowRight");
  await page.waitForURL(`**/p/${P}/edit/${IMG2}`);
  const navigated = Date.now();
  await posted;
  expect(postDone).toBeLessThanOrEqual(navigated);
  await expect(page.getByTestId("position")).toHaveText("2 / 2");
  await page.keyboard.press("Control+ArrowLeft");
  await page.waitForURL(`**/p/${P}/edit/${IMG}`);
});

test("Ctrl+Z undoes a draw with DELETE and Ctrl+Y redoes with POST", async ({ page }) => {
  await openEditor(page);
  const from = await displayPoint(page, 2000, 1500);
  const to = await displayPoint(page, 2300, 1700);
  const posted = page.waitForRequest((r) => r.method() === "POST" && r.url().endsWith(`/images/${IMG}/boxes`));
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(to.x, to.y, { steps: 6 });
  await page.mouse.up();
  await posted;
  await expect(page.getByRole("button", { name: "Undo" })).toBeEnabled();
  const deleted = page.waitForRequest((r) => r.method() === "DELETE" && r.url().includes("/boxes/b0000000-6666-4000-8000-000000000001"));
  await page.keyboard.press("Control+z");
  await deleted;
  await expect(page.getByRole("button", { name: "Redo" })).toBeEnabled();
  const reposted = page.waitForRequest((r) => r.method() === "POST" && r.url().endsWith(`/images/${IMG}/boxes`));
  await page.keyboard.press("Control+y");
  await reposted;
});
```

(The mock answers every create with box `b…0001`, so the undo's DELETE targets that id.)

- [ ] **Step 6: Run the tests to verify they pass**

Run: `pnpm test src/editor && pnpm exec tsc -b && pnpm lint && pnpm e2e e2e/editor.spec.ts`
Expected: unit files pass; all 11 editor e2e tests pass.

- [ ] **Step 7: Commit**

```bash
git add src/editor/useEditorNavigation.ts src/editor/useEditorNavigation.test.tsx src/screens/EditorScreen.tsx e2e/editor.spec.ts
git commit -m "feat(ui): editor navigation with auto-save wait and undo/redo hotkeys"
```

---

### Task 15: Review queue screen

**Files:**
- Modify: `frontend/src/screens/ReviewScreen.tsx` (replace the placeholder)
- Test: `frontend/src/screens/ReviewScreen.test.tsx`

**Interfaces:**
- Consumes: `useImageList`, `REVIEW_QUEUE_QUERY`, `ImageTable`, `REVIEW_COLUMNS`, `useSourceNames`, `keyboardAction`, `useNavigationStore`, selection helpers.
- Produces: `ReviewScreen`: heading "Review queue", subtitle "Images with unreviewed proposals, highest proposal confidence first", the `ImageTable` with `REVIEW_COLUMNS` and a fixed sort (`max_pending_confidence desc`, headers not clickable), J/K/Enter/Space keyboard, a footer "N images waiting"; opening sets the navigation context with source `"review"` so the editor's next/previous walk the queue.

- [ ] **Step 1: Write the failing test**

`frontend/src/screens/ReviewScreen.test.tsx`:

```tsx
import { describe, it, expect, beforeEach } from "vitest";
import { screen, fireEvent, waitFor } from "@testing-library/react";
import { Route, Routes } from "react-router-dom";
import { exampleImagePage, fakeClient, PROJECT_ID, IMAGE_ID } from "@/test/fixtures";
import { renderWithProviders } from "@/test/render";
import { useNavigationStore } from "@/store/navigation";
import { ReviewScreen } from "./ReviewScreen";

describe("ReviewScreen", () => {
  beforeEach(() => useNavigationStore.getState().setContext([], null));

  it("requests the review queue query, shows confidence and opens the editor with a review context", async () => {
    const { api, requests } = fakeClient([
      { method: "GET", path: /\/images$/, body: exampleImagePage },
      { method: "GET", path: /\/sources$/, body: { items: [], next_cursor: null } },
    ]);
    renderWithProviders(
      <Routes>
        <Route path="/p/:projectId/review" element={<ReviewScreen />} />
        <Route path="/p/:projectId/edit/:imageId" element={<p>editor route</p>} />
      </Routes>,
      { api, route: `/p/${PROJECT_ID}/review` },
    );
    await waitFor(() => expect(screen.getByText("81%")).toBeInTheDocument());
    const url = new URL(`http://x${requests.find((r) => r.url.includes("/images?"))?.url}`);
    expect(url.searchParams.get("has_pending")).toBe("true");
    expect(url.searchParams.get("sort")).toBe("max_pending_confidence");
    expect(url.searchParams.get("order")).toBe("desc");
    expect(screen.getByRole("heading", { name: "Review queue" })).toBeInTheDocument();
    expect(screen.getAllByRole("columnheader").map((h) => h.textContent)).toEqual(expect.arrayContaining(["File", "Group", "Pending", "Top confidence", "Boxes"]));
    expect(screen.getByText("2 images waiting")).toBeInTheDocument();

    fireEvent.keyDown(screen.getByTestId("image-table"), { key: "Enter" });
    await waitFor(() => expect(screen.getByText("editor route")).toBeInTheDocument());
    expect(useNavigationStore.getState().source).toBe("review");
    expect(useNavigationStore.getState().ids[0]).toBe(IMAGE_ID);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm test src/screens/ReviewScreen.test.tsx`
Expected: FAIL (the placeholder renders "Review", no table).

- [ ] **Step 3: Replace `ReviewScreen.tsx`**

```tsx
import { useCallback, useMemo, useState, type KeyboardEvent } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { REVIEW_QUEUE_QUERY } from "@/api/images";
import { useSourceNames } from "@/api/project";
import { ImageTable } from "@/data/ImageTable";
import { keyboardAction, REVIEW_COLUMNS } from "@/data/listModel";
import { clearSelection, clickSelect, EMPTY_SELECTION, pruneSelection, selectAll, toggleSelect } from "@/data/selection";
import { useImageList } from "@/data/useImageList";
import { isTypingTarget } from "@/editor/hotkeys";
import { useNavigationStore } from "@/store/navigation";

/** Spec section 6 screen 4: images with unreviewed proposals sorted by proposal confidence, same editor. */
export function ReviewScreen() {
  const { projectId = "" } = useParams();
  const navigate = useNavigate();
  const sourceNames = useSourceNames(projectId);
  const list = useImageList(projectId, REVIEW_QUEUE_QUERY);
  const ids = useMemo(() => list.items.map((i) => i.id), [list.items]);
  const rowContext = useMemo(() => ({ sourceNames }), [sourceNames]);
  const [selection, setSelection] = useState(EMPTY_SELECTION);
  const [rawFocus, setFocusIndex] = useState(0);
  const focusIndex = Math.min(rawFocus, Math.max(0, ids.length - 1));
  const pruned = useMemo(() => pruneSelection(selection, ids), [selection, ids]);

  const open = useCallback(
    (id: string) => {
      useNavigationStore.getState().setContext(ids, "review");
      void navigate(`/p/${projectId}/edit/${id}`);
    },
    [ids, navigate, projectId],
  );

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (isTypingTarget(e.target)) return;
    const action = keyboardAction(e);
    if (!action) return;
    e.preventDefault();
    if (action.type === "move") setFocusIndex((i) => Math.max(0, Math.min(ids.length - 1, i + action.delta)));
    else if (action.type === "open" && ids[focusIndex]) open(ids[focusIndex]);
    else if (action.type === "toggle" && ids[focusIndex]) setSelection((s) => toggleSelect(s, ids[focusIndex]));
    else if (action.type === "select-all") setSelection(selectAll(ids));
    else if (action.type === "clear") setSelection(clearSelection());
  };

  return (
    <section className="flex h-full min-h-0 flex-col gap-3">
      <div>
        <h1 className="text-2xl font-semibold">Review queue</h1>
        <p className="text-sm text-slate-400">Images with unreviewed proposals, highest proposal confidence first. Enter opens the editor; A and R there accept or reject.</p>
      </div>
      {list.error && (
        <p role="alert" className="rounded border border-red-800 bg-red-950 px-3 py-2 text-sm text-red-200">
          {list.error}
        </p>
      )}
      <ImageTable
        items={list.items}
        columns={REVIEW_COLUMNS}
        rowContext={rowContext}
        sort={{ key: "max_pending_confidence", order: "desc" }}
        selected={pruned.selected}
        focusIndex={focusIndex}
        onRowClick={(id, index, mod) => {
          setFocusIndex(index);
          setSelection((s) => clickSelect(s, ids, id, mod));
        }}
        onOpen={open}
        onToggle={(id) => setSelection((s) => toggleSelect(s, id))}
        onNearEnd={list.hasMore ? list.loadMore : undefined}
        onKeyDown={onKeyDown}
      />
      <p className="text-xs text-slate-400">{list.loading ? "Loading…" : `${list.total} images waiting`}</p>
    </section>
  );
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm test src/screens/ReviewScreen.test.tsx && pnpm exec tsc -b && pnpm lint`
Expected: pass; tsc and lint clean. In the browser: `/p/<id>/review` lists the two mock images with "81%" on the first; Enter opens the editor and its toolbar shows "1 / 2".

- [ ] **Step 5: Commit**

```bash
git add src/screens/ReviewScreen.tsx src/screens/ReviewScreen.test.tsx
git commit -m "feat(ui): review queue screen over the pending-proposals query"
```

---

### Task 16: Project settings: classes, pre-annotation model, import defaults, provider placeholder

**Files:**
- Create: `frontend/src/settings/classesModel.ts`, `frontend/src/settings/ClassesSection.tsx`, `frontend/src/settings/PreannotationSection.tsx`, `frontend/src/settings/ImportDefaultsSection.tsx`, `frontend/src/settings/ProvidersPlaceholder.tsx`
- Modify: `frontend/src/screens/SettingsScreen.tsx` (replace the placeholder)
- Test: `frontend/src/settings/classesModel.test.ts`, `frontend/src/settings/ClassesSection.test.tsx`, `frontend/src/settings/PreannotationSection.test.tsx`, `frontend/src/settings/ImportDefaultsSection.test.tsx`

**Interfaces:**
- Consumes: `useProject`, `saveClasses`, `patchProject`, `fetchModels`, `ApiFailure`, `isNotImplemented`, `messageOf`.
- Produces:
  - `classesModel.ts`: `interface DraftClass {id?: string; name: string; colour: string; hotkey: string}`, `PALETTE: string[]` (the eight colours), `toDrafts(classes: ClassDef[]): DraftClass[]`, `toClassInputs(drafts: DraftClass[]): ClassDefInput[]` (`hotkey: null` when empty, `id` only when present), `validateDrafts(drafts): string | null` (empty name, duplicate names, duplicate hotkeys, hotkeys must be 1 to 9), `classInUseMessage(err: unknown, classes: ClassDef[]): string | null` (for `ApiFailure` with code `class_in_use` and details `{class_id, box_count}`: `Class "<name>" still has <n> boxes. Reassign or delete those boxes in the editor before removing it.`; otherwise null), `nextColour(drafts): string`, `moveDraft(drafts, index, delta): DraftClass[]`.
  - `ClassesSection({project, onSaved}: {project: Project; onSaved: (p: Project) => void})`: a table of drafts with inputs `aria-label="Name of class N"`, `aria-label="Colour of class N"` (`type="color"`), `aria-label="Hotkey of class N"` (`<select>` with "none" and 1 to 9), buttons `Move class N up`, `Move class N down`, `Remove class N`, plus "Add class" and "Save classes"; `role="alert"` for validation and API errors (with the `class_in_use` explanation), `role="status"` "Classes saved".
  - `PreannotationSection({project, onSaved})`: `<select aria-label="Pre-annotation model">` with "None" plus the registry models; `PATCH` on change; when `fetchModels` fails the select is disabled and a `role="note"` says "The model registry is not available yet (it arrives with the training backend). The current setting is kept." (a 501 is not an error here).
  - `ImportDefaultsSection({project, onSaved})`: number inputs "Max side", "JPEG quality", "Duplicate threshold" and a text input "Group regex", "Save import defaults" -> `PATCH {import_defaults}`.
  - `ProvidersPlaceholder()`: static section "Provider keys" explaining that OpenAI and Anthropic keys are configured from the Query screen (S5) and stored in Windows Credential Manager.
  - `SettingsScreen`: heading "Settings", loads the project, renders the four sections; `onSaved` replaces the project state.

- [ ] **Step 1: Write the failing tests**

`frontend/src/settings/classesModel.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { exampleClasses, CLASS_ID } from "@/test/fixtures";
import { ApiFailure } from "@/api/errors";
import { classInUseMessage, moveDraft, nextColour, toClassInputs, toDrafts, validateDrafts } from "./classesModel";

describe("classes model", () => {
  it("round-trips drafts and inputs", () => {
    const drafts = toDrafts(exampleClasses);
    expect(drafts[0]).toEqual({ id: CLASS_ID(1), name: "excavator", colour: "#f97316", hotkey: "1" });
    const inputs = toClassInputs([...drafts.slice(0, 1), { name: "new", colour: "#ffffff", hotkey: "" }]);
    expect(inputs).toEqual([
      { id: CLASS_ID(1), name: "excavator", colour: "#f97316", hotkey: "1" },
      { name: "new", colour: "#ffffff", hotkey: null },
    ]);
  });

  it("validates names and hotkeys", () => {
    const drafts = toDrafts(exampleClasses);
    expect(validateDrafts(drafts)).toBeNull();
    expect(validateDrafts([{ name: " ", colour: "#000000", hotkey: "" }])).toBe("Every class needs a name.");
    expect(validateDrafts([{ name: "a", colour: "#000000", hotkey: "1" }, { name: "a", colour: "#000000", hotkey: "2" }])).toBe('Class name "a" is used twice.');
    expect(validateDrafts([{ name: "a", colour: "#000000", hotkey: "1" }, { name: "b", colour: "#000000", hotkey: "1" }])).toBe("Hotkey 1 is used twice.");
    expect(validateDrafts([{ name: "a", colour: "#000000", hotkey: "x" }])).toBe("Hotkeys must be a digit from 1 to 9.");
  });

  it("explains class_in_use and ignores other errors", () => {
    const err = new ApiFailure("class_in_use", "class still has boxes", 409, { class_id: CLASS_ID(4), box_count: 40 });
    expect(classInUseMessage(err, exampleClasses)).toBe('Class "dump_truck" still has 40 boxes. Reassign or delete those boxes in the editor before removing it.');
    expect(classInUseMessage(new ApiFailure("conflict", "x", 409), exampleClasses)).toBeNull();
    expect(classInUseMessage(new Error("x"), exampleClasses)).toBeNull();
  });

  it("moves drafts and picks the next colour", () => {
    const drafts = toDrafts(exampleClasses);
    expect(moveDraft(drafts, 0, 1).map((d) => d.name).slice(0, 2)).toEqual(["wheel_loader", "excavator"]);
    expect(moveDraft(drafts, 0, -1)).toBe(drafts);
    expect(nextColour(drafts.slice(0, 2))).toBe("#22c55e");
  });
});
```

`frontend/src/settings/ClassesSection.test.tsx`:

```tsx
import { describe, it, expect, vi } from "vitest";
import { screen, fireEvent, waitFor } from "@testing-library/react";
import { exampleProject, fakeClient, PROJECT_ID, CLASS_ID, errorBody } from "@/test/fixtures";
import { renderWithProviders } from "@/test/render";
import { ClassesSection } from "./ClassesSection";

describe("ClassesSection", () => {
  it("renames, adds and saves with PUT keeping ids", async () => {
    const { api, requests } = fakeClient([{ method: "PUT", path: /\/classes$/, body: exampleProject }]);
    const onSaved = vi.fn();
    renderWithProviders(<ClassesSection project={exampleProject} onSaved={onSaved} />, { api });
    fireEvent.change(screen.getByLabelText("Name of class 1"), { target: { value: "digger" } });
    fireEvent.change(screen.getByLabelText("Hotkey of class 1"), { target: { value: "9" } });
    fireEvent.click(screen.getByRole("button", { name: "Add class" }));
    fireEvent.change(screen.getByLabelText("Name of class 9"), { target: { value: "grader" } });
    fireEvent.click(screen.getByRole("button", { name: "Save classes" }));
    await waitFor(() => expect(onSaved).toHaveBeenCalledWith(exampleProject));
    const body = requests[0].body as Array<Record<string, unknown>>;
    expect(requests[0]).toMatchObject({ method: "PUT", url: `/api/v1/projects/${PROJECT_ID}/classes` });
    expect(body[0]).toEqual({ id: CLASS_ID(1), name: "digger", colour: "#f97316", hotkey: "9" });
    expect(body[8]).toEqual({ name: "grader", colour: expect.stringMatching(/^#/), hotkey: null });
    expect(screen.getByRole("status")).toHaveTextContent("Classes saved");
  });

  it("explains a 409 class_in_use when removing a class that still has boxes", async () => {
    const { api } = fakeClient([
      { method: "PUT", path: /\/classes$/, status: 409, body: errorBody("class_in_use", "class still has boxes", { class_id: CLASS_ID(4), box_count: 40 }) },
    ]);
    renderWithProviders(<ClassesSection project={exampleProject} onSaved={() => {}} />, { api });
    fireEvent.click(screen.getByRole("button", { name: "Remove class 4" }));
    expect(screen.queryByLabelText("Name of class 8")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Save classes" }));
    await waitFor(() =>
      expect(screen.getByRole("alert")).toHaveTextContent('Class "dump_truck" still has 40 boxes. Reassign or delete those boxes in the editor before removing it.'),
    );
    expect(screen.getByLabelText("Name of class 4")).toHaveValue("dump_truck");
  });

  it("blocks duplicate hotkeys before calling the API", () => {
    const { api, requests } = fakeClient([]);
    renderWithProviders(<ClassesSection project={exampleProject} onSaved={() => {}} />, { api });
    fireEvent.change(screen.getByLabelText("Hotkey of class 2"), { target: { value: "1" } });
    fireEvent.click(screen.getByRole("button", { name: "Save classes" }));
    expect(screen.getByRole("alert")).toHaveTextContent("Hotkey 1 is used twice.");
    expect(requests).toHaveLength(0);
  });
});
```

`frontend/src/settings/PreannotationSection.test.tsx`:

```tsx
import { describe, it, expect, vi } from "vitest";
import { screen, fireEvent, waitFor } from "@testing-library/react";
import { exampleModel, exampleProject, fakeClient, errorBody } from "@/test/fixtures";
import { renderWithProviders } from "@/test/render";
import { PreannotationSection } from "./PreannotationSection";

describe("PreannotationSection", () => {
  it("lists models and patches the project on change", async () => {
    const { api, requests } = fakeClient([
      { method: "GET", path: /\/models$/, body: { items: [exampleModel], next_cursor: null } },
      { method: "PATCH", path: /\/projects\/[^/]+$/, body: { ...exampleProject, preannotation_model_id: null } },
    ]);
    const onSaved = vi.fn();
    renderWithProviders(<PreannotationSection project={exampleProject} onSaved={onSaved} />, { api });
    const select = await screen.findByLabelText("Pre-annotation model");
    await waitFor(() => expect(select).toHaveValue(exampleModel.id));
    fireEvent.change(select, { target: { value: "" } });
    await waitFor(() => expect(onSaved).toHaveBeenCalled());
    expect(requests[1]).toMatchObject({ method: "PATCH", body: { preannotation_model_id: null } });
  });

  it("tolerates 501 from the registry", async () => {
    const { api } = fakeClient([{ method: "GET", path: /\/models$/, status: 501, body: errorBody("not_implemented", "models later") }]);
    renderWithProviders(<PreannotationSection project={exampleProject} onSaved={() => {}} />, { api });
    await waitFor(() => expect(screen.getByRole("note")).toHaveTextContent("The model registry is not available yet"));
    expect(screen.getByLabelText("Pre-annotation model")).toBeDisabled();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
});
```

`frontend/src/settings/ImportDefaultsSection.test.tsx`:

```tsx
import { describe, it, expect, vi } from "vitest";
import { screen, fireEvent, waitFor } from "@testing-library/react";
import { exampleProject, fakeClient } from "@/test/fixtures";
import { renderWithProviders } from "@/test/render";
import { ImportDefaultsSection } from "./ImportDefaultsSection";

describe("ImportDefaultsSection", () => {
  it("patches import_defaults with every field", async () => {
    const { api, requests } = fakeClient([{ method: "PATCH", path: /\/projects\/[^/]+$/, body: exampleProject }]);
    const onSaved = vi.fn();
    renderWithProviders(<ImportDefaultsSection project={exampleProject} onSaved={onSaved} />, { api });
    expect(screen.getByLabelText("Max side")).toHaveValue(4000);
    fireEvent.change(screen.getByLabelText("Max side"), { target: { value: "3000" } });
    fireEvent.change(screen.getByLabelText("Duplicate threshold"), { target: { value: "6" } });
    fireEvent.click(screen.getByRole("button", { name: "Save import defaults" }));
    await waitFor(() => expect(onSaved).toHaveBeenCalledWith(exampleProject));
    expect(requests[0].body).toEqual({
      import_defaults: { max_side: 3000, quality: 95, dedupe_threshold: 6, group_regex: exampleProject.import_defaults.group_regex },
    });
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm test src/settings`
Expected: 4 files FAIL with unresolved imports.

- [ ] **Step 3: Implement `classesModel.ts`**

```ts
import type { ClassDef, ClassDefInput } from "@contract/client";
import { ApiFailure } from "@/api/errors";

export interface DraftClass {
  id?: string;
  name: string;
  colour: string;
  hotkey: string;
}

export const PALETTE = ["#f97316", "#eab308", "#22c55e", "#06b6d4", "#3b82f6", "#a855f7", "#ec4899", "#ef4444"];

export function toDrafts(classes: ClassDef[]): DraftClass[] {
  return [...classes]
    .sort((a, b) => a.order - b.order)
    .map((c) => ({ id: c.id, name: c.name, colour: c.colour, hotkey: c.hotkey ?? "" }));
}

/** Items with an `id` keep it (rename, recolour, rehotkey); items without one are new (contract `updateClasses`). */
export function toClassInputs(drafts: DraftClass[]): ClassDefInput[] {
  return drafts.map((d) => ({
    ...(d.id ? { id: d.id } : {}),
    name: d.name.trim(),
    colour: d.colour,
    hotkey: d.hotkey ? d.hotkey : null,
  }));
}

export function validateDrafts(drafts: DraftClass[]): string | null {
  const names = new Set<string>();
  const keys = new Set<string>();
  for (const d of drafts) {
    const name = d.name.trim();
    if (!name) return "Every class needs a name.";
    if (names.has(name)) return `Class name "${name}" is used twice.`;
    names.add(name);
    if (d.hotkey) {
      if (!/^[1-9]$/.test(d.hotkey)) return "Hotkeys must be a digit from 1 to 9.";
      if (keys.has(d.hotkey)) return `Hotkey ${d.hotkey} is used twice.`;
      keys.add(d.hotkey);
    }
  }
  return null;
}

/** Spec section 6: deleting a class with boxes is refused; the UI must explain what to do. */
export function classInUseMessage(err: unknown, classes: ClassDef[]): string | null {
  if (!(err instanceof ApiFailure) || err.code !== "class_in_use") return null;
  const classId = typeof err.details.class_id === "string" ? err.details.class_id : null;
  const count = typeof err.details.box_count === "number" ? err.details.box_count : null;
  const name = classes.find((c) => c.id === classId)?.name ?? "that class";
  const boxes = count === null ? "boxes" : `${count} ${count === 1 ? "box" : "boxes"}`;
  return `Class "${name}" still has ${boxes}. Reassign or delete those boxes in the editor before removing it.`;
}

export function nextColour(drafts: DraftClass[]): string {
  const used = new Set(drafts.map((d) => d.colour.toLowerCase()));
  return PALETTE.find((c) => !used.has(c)) ?? PALETTE[drafts.length % PALETTE.length];
}

export function moveDraft(drafts: DraftClass[], index: number, delta: number): DraftClass[] {
  const target = index + delta;
  if (target < 0 || target >= drafts.length) return drafts;
  const next = [...drafts];
  [next[index], next[target]] = [next[target], next[index]];
  return next;
}
```

- [ ] **Step 4: Implement `ClassesSection.tsx`**

```tsx
import { useState } from "react";
import type { Project } from "@contract/client";
import { useApi } from "@/api/client";
import { messageOf } from "@/api/errors";
import { saveClasses } from "@/api/project";
import { pushLog } from "@/app/diagnostics";
import { classInUseMessage, moveDraft, nextColour, toClassInputs, toDrafts, validateDrafts, type DraftClass } from "./classesModel";

interface Props {
  project: Project;
  onSaved: (p: Project) => void;
}

const input = "rounded border border-slate-700 bg-slate-800 px-2 py-1 text-sm";
const btn = "rounded border border-slate-700 px-2 py-1 text-xs hover:bg-slate-800 disabled:opacity-40";

export function ClassesSection({ project, onSaved }: Props) {
  const api = useApi();
  // Mounted with `key={JSON.stringify(project.classes)}` by SettingsScreen, so a saved project remounts with fresh drafts.
  const [drafts, setDrafts] = useState<DraftClass[]>(() => toDrafts(project.classes));
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const update = (i: number, patch: Partial<DraftClass>) => setDrafts((d) => d.map((c, j) => (j === i ? { ...c, ...patch } : c)));

  async function save() {
    setError(null);
    setStatus(null);
    const problem = validateDrafts(drafts);
    if (problem) {
      setError(problem);
      return;
    }
    setBusy(true);
    try {
      const saved = await saveClasses(api, project.id, toClassInputs(drafts));
      onSaved(saved);
      setStatus("Classes saved");
    } catch (e) {
      pushLog(`save classes failed: ${messageOf(e, String(e))}`);
      const explained = classInUseMessage(e, project.classes);
      setError(explained ?? messageOf(e, "could not save the classes"));
      if (explained) setDrafts(toDrafts(project.classes));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="flex flex-col gap-3">
      <h2 className="text-lg font-medium">Classes</h2>
      <p className="text-sm text-slate-400">Rename, recolour, change hotkeys or reorder. Removing a class that still has boxes is refused until those boxes are reassigned or deleted.</p>
      <div className="flex flex-col gap-2">
        {drafts.map((d, i) => {
          const n = i + 1;
          return (
            <div key={d.id ?? `new-${i}`} className="flex items-center gap-2">
              <input aria-label={`Colour of class ${n}`} type="color" value={d.colour} onChange={(e) => update(i, { colour: e.target.value })} className="h-8 w-10 rounded border border-slate-700 bg-slate-800" />
              <input aria-label={`Name of class ${n}`} value={d.name} onChange={(e) => update(i, { name: e.target.value })} className={`${input} flex-1`} />
              <select aria-label={`Hotkey of class ${n}`} value={d.hotkey} onChange={(e) => update(i, { hotkey: e.target.value })} className={input}>
                <option value="">none</option>
                {["1", "2", "3", "4", "5", "6", "7", "8", "9"].map((k) => (
                  <option key={k} value={k}>
                    {k}
                  </option>
                ))}
              </select>
              <button type="button" aria-label={`Move class ${n} up`} className={btn} disabled={i === 0} onClick={() => setDrafts((x) => moveDraft(x, i, -1))}>
                ↑
              </button>
              <button type="button" aria-label={`Move class ${n} down`} className={btn} disabled={i === drafts.length - 1} onClick={() => setDrafts((x) => moveDraft(x, i, 1))}>
                ↓
              </button>
              <button type="button" aria-label={`Remove class ${n}`} className={`${btn} text-red-300`} onClick={() => setDrafts((x) => x.filter((_, j) => j !== i))}>
                Remove
              </button>
            </div>
          );
        })}
      </div>
      <div className="flex items-center gap-2">
        <button type="button" className={btn} onClick={() => setDrafts((x) => [...x, { name: "", colour: nextColour(x), hotkey: "" }])}>
          Add class
        </button>
        <button type="button" disabled={busy} onClick={() => void save()} className="rounded bg-orange-600 px-3 py-1 text-sm font-medium hover:bg-orange-500 disabled:opacity-50">
          Save classes
        </button>
        {status && (
          <span role="status" className="text-xs text-emerald-300">
            {status}
          </span>
        )}
      </div>
      {error && (
        <p role="alert" className="rounded border border-red-800 bg-red-950 px-3 py-2 text-sm text-red-200">
          {error}
        </p>
      )}
    </section>
  );
}
```

- [ ] **Step 5: Implement `PreannotationSection.tsx`**

```tsx
import { useEffect, useState } from "react";
import type { Model, Project } from "@contract/client";
import { useApi } from "@/api/client";
import { messageOf } from "@/api/errors";
import { fetchModels, patchProject } from "@/api/project";
import { pushLog } from "@/app/diagnostics";

interface Props {
  project: Project;
  onSaved: (p: Project) => void;
}

export function PreannotationSection({ project, onSaved }: Props) {
  const api = useApi();
  const [models, setModels] = useState<Model[] | null>(null);
  const [unavailable, setUnavailable] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetchModels(api, project.id)
      .then((items) => {
        if (!cancelled) setModels(items);
      })
      .catch((e: unknown) => {
        pushLog(`models unavailable: ${messageOf(e, String(e))}`);
        if (!cancelled) {
          setModels([]);
          setUnavailable("The model registry is not available yet (it arrives with the training backend). The current setting is kept.");
        }
      });
    return () => {
      cancelled = true;
    };
  }, [api, project.id]);

  async function choose(value: string) {
    setError(null);
    setStatus(null);
    try {
      onSaved(await patchProject(api, project.id, { preannotation_model_id: value || null }));
      setStatus("Pre-annotation model saved");
    } catch (e) {
      pushLog(`set preannotation model failed: ${messageOf(e, String(e))}`);
      setError(messageOf(e, "could not save the pre-annotation model"));
    }
  }

  const current = project.preannotation_model_id ?? "";
  const known = models?.some((m) => m.id === current) ?? false;
  return (
    <section className="flex flex-col gap-3">
      <h2 className="text-lg font-medium">Pre-annotation</h2>
      <p className="text-sm text-slate-400">This model runs on an image when the editor opens it and its proposals appear dashed until reviewed.</p>
      <label className="flex items-center gap-2 text-sm">
        Model
        <select aria-label="Pre-annotation model" value={current} disabled={unavailable !== null || models === null} onChange={(e) => void choose(e.target.value)} className="rounded border border-slate-700 bg-slate-800 px-2 py-1 text-sm">
          <option value="">None</option>
          {!known && current && <option value={current}>{current}</option>}
          {(models ?? []).map((m) => (
            <option key={m.id} value={m.id}>
              {m.name} ({m.kind})
            </option>
          ))}
        </select>
      </label>
      {unavailable && (
        <p role="note" className="text-xs text-slate-400">
          {unavailable}
        </p>
      )}
      {status && (
        <p role="status" className="text-xs text-emerald-300">
          {status}
        </p>
      )}
      {error && (
        <p role="alert" className="text-xs text-red-300">
          {error}
        </p>
      )}
    </section>
  );
}
```

- [ ] **Step 6: Implement `ImportDefaultsSection.tsx` and `ProvidersPlaceholder.tsx`**

`ImportDefaultsSection.tsx`:

```tsx
import { useState, type FormEvent } from "react";
import type { ImportSettings, Project } from "@contract/client";
import { useApi } from "@/api/client";
import { messageOf } from "@/api/errors";
import { patchProject } from "@/api/project";
import { pushLog } from "@/app/diagnostics";

interface Props {
  project: Project;
  onSaved: (p: Project) => void;
}

const input = "rounded border border-slate-700 bg-slate-800 px-2 py-1 text-sm";

function fromProject(p: Project): Required<ImportSettings> {
  return {
    max_side: p.import_defaults.max_side ?? 4000,
    quality: p.import_defaults.quality ?? 95,
    dedupe_threshold: p.import_defaults.dedupe_threshold ?? 4,
    group_regex: p.import_defaults.group_regex ?? "^(?P<camera>[A-Za-z0-9-]+)_(?P<flight>\\d+)_(?P<frame>\\d+)",
  };
}

export function ImportDefaultsSection({ project, onSaved }: Props) {
  const api = useApi();
  // Mounted with `key={JSON.stringify(project.import_defaults)}` by SettingsScreen.
  const [form, setForm] = useState(() => fromProject(project));
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setStatus(null);
    try {
      onSaved(await patchProject(api, project.id, { import_defaults: form }));
      setStatus("Import defaults saved");
    } catch (err) {
      pushLog(`save import defaults failed: ${messageOf(err, String(err))}`);
      setError(messageOf(err, "could not save the import defaults"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={(e) => void submit(e)} className="flex flex-col gap-3">
      <h2 className="text-lg font-medium">Import defaults</h2>
      <p className="text-sm text-slate-400">Applied to new sources unless overridden at import time (spec section 5).</p>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <label className="flex flex-col gap-1 text-xs text-slate-400">
          Max side
          <input type="number" min={512} max={12000} value={form.max_side} onChange={(e) => setForm({ ...form, max_side: Number(e.target.value) })} className={input} />
        </label>
        <label className="flex flex-col gap-1 text-xs text-slate-400">
          JPEG quality
          <input type="number" min={50} max={100} value={form.quality} onChange={(e) => setForm({ ...form, quality: Number(e.target.value) })} className={input} />
        </label>
        <label className="flex flex-col gap-1 text-xs text-slate-400">
          Duplicate threshold
          <input type="number" min={0} max={32} value={form.dedupe_threshold} onChange={(e) => setForm({ ...form, dedupe_threshold: Number(e.target.value) })} className={input} />
        </label>
        <label className="flex flex-col gap-1 text-xs text-slate-400">
          Group regex
          <input value={form.group_regex} onChange={(e) => setForm({ ...form, group_regex: e.target.value })} className={`${input} font-mono`} />
        </label>
      </div>
      <div className="flex items-center gap-2">
        <button type="submit" disabled={busy} className="rounded bg-orange-600 px-3 py-1 text-sm font-medium hover:bg-orange-500 disabled:opacity-50">
          Save import defaults
        </button>
        {status && (
          <span role="status" className="text-xs text-emerald-300">
            {status}
          </span>
        )}
      </div>
      {error && (
        <p role="alert" className="text-xs text-red-300">
          {error}
        </p>
      )}
    </form>
  );
}
```

`ProvidersPlaceholder.tsx`:

```tsx
/** Spec section 6 screen 5 lists provider keys; S5 owns the provider UI (query screen), this is the pointer. */
export function ProvidersPlaceholder() {
  return (
    <section className="flex flex-col gap-2">
      <h2 className="text-lg font-medium">Provider keys</h2>
      <p className="text-sm text-slate-400">
        OpenAI and Anthropic API keys are entered from the Query screen and stored in Windows Credential Manager; they are never written to the project folder. This section becomes editable with the inference UI.
      </p>
    </section>
  );
}
```

- [ ] **Step 7: Replace `SettingsScreen.tsx`**

```tsx
import { useParams } from "react-router-dom";
import { useProject } from "@/api/project";
import { ClassesSection } from "@/settings/ClassesSection";
import { ImportDefaultsSection } from "@/settings/ImportDefaultsSection";
import { PreannotationSection } from "@/settings/PreannotationSection";
import { ProvidersPlaceholder } from "@/settings/ProvidersPlaceholder";

export function SettingsScreen() {
  const { projectId = "" } = useParams();
  const { project, error, setProject } = useProject(projectId);
  return (
    <section className="mx-auto flex max-w-4xl flex-col gap-8">
      <h1 className="text-2xl font-semibold">Settings</h1>
      {error && (
        <p role="alert" className="rounded border border-red-800 bg-red-950 px-3 py-2 text-sm text-red-200">
          {error}
        </p>
      )}
      {!project && !error && <p className="text-sm text-slate-400">Loading project…</p>}
      {project && (
        <>
          {/* keys remount the form sections with fresh drafts whenever the saved project changes */}
          <ClassesSection key={JSON.stringify(project.classes)} project={project} onSaved={setProject} />
          <PreannotationSection project={project} onSaved={setProject} />
          <ImportDefaultsSection key={JSON.stringify(project.import_defaults)} project={project} onSaved={setProject} />
          <ProvidersPlaceholder />
        </>
      )}
    </section>
  );
}
```

- [ ] **Step 8: Run the tests to verify they pass**

Run: `pnpm test src/settings && pnpm exec tsc -b && pnpm lint`
Expected: 4 settings files pass; tsc and lint clean.

- [ ] **Step 9: Commit**

```bash
git add src/settings src/screens/SettingsScreen.tsx
git commit -m "feat(ui): project settings (classes, pre-annotation model, import defaults, provider placeholder)"
```

---

### Task 17: Playwright e2e for the Data Manager

**Files:**
- Create: `frontend/e2e/data-manager.spec.ts`

**Interfaces:**
- Consumes: the screen from Tasks 8 and 9; the mock server examples (see "Mock server limitations": filters are ignored, so the tests assert the query string and the requests made).

- [ ] **Step 1: Write the spec**

```ts
import { test, expect } from "@playwright/test";

const P = "7f1c2e3a-1111-4000-8000-000000000001";
const IMG = "10000000-5555-4000-8000-000000000001";
const IMG2 = "10000000-5555-4000-8000-000000000002";
const MODEL = "m0000000-2222-4000-8000-000000000001";

test("lists images with the default query and shows the seven columns in list view", async ({ page }) => {
  const first = page.waitForRequest((r) => r.method() === "GET" && r.url().includes(`/api/v1/projects/${P}/images?`));
  await page.goto(`/p/${P}/data`);
  const url = new URL((await first).url());
  expect(url.searchParams.get("sort")).toBe("path");
  expect(url.searchParams.get("order")).toBe("asc");
  expect(url.searchParams.get("limit")).toBe("200");
  await expect(page.getByRole("heading", { name: "Data Manager" })).toBeVisible();
  await expect(page.getByTestId("image-grid")).toBeVisible();
  await expect(page.getByText("IX-12-02491_0031_0001.jpg")).toBeVisible();
  await expect(page.getByText("2 of 2 images")).toBeVisible();

  await page.getByRole("button", { name: "List" }).click();
  await expect(page.getByTestId("image-table")).toBeVisible();
  const headers = await page.getByRole("columnheader").allTextContents();
  for (const label of ["File", "Source", "Group", "Labeled", "Boxes", "Pending", "Captured"]) {
    expect(headers.some((h) => h.startsWith(label))).toBe(true);
  }
  await expect(page.getByRole("row").filter({ hasText: "IX-12-02491_0031_0001.jpg" })).toContainText("2019-04-15 06:35");
});

test("sorting by a column header and filtering change the request", async ({ page }) => {
  await page.goto(`/p/${P}/data`);
  await page.getByRole("button", { name: "List" }).click();
  const sorted = page.waitForRequest((r) => r.url().includes("sort=box_count") && r.url().includes("order=asc"));
  await page.getByRole("columnheader", { name: "Boxes" }).click();
  await sorted;
  const reversed = page.waitForRequest((r) => r.url().includes("sort=box_count") && r.url().includes("order=desc"));
  await page.getByRole("columnheader", { name: /Boxes/ }).click();
  await reversed;

  const labeled = page.waitForRequest((r) => r.url().includes("labeled=true"));
  await page.getByLabel("Labeled").selectOption("yes");
  await labeled;
  const pending = page.waitForRequest((r) => r.url().includes("has_pending=false"));
  await page.getByLabel("Pending review").selectOption("no");
  await pending;
  const searched = page.waitForRequest((r) => r.url().includes("search=0031"));
  await page.getByPlaceholder("Search file name").fill("0031");
  await searched;
  const grouped = page.waitForRequest((r) => r.url().includes("group_key=IX"));
  await page.getByLabel("Group").fill("IX");
  await grouped;
});

test("multi-select with checkboxes and bulk delete after confirmation", async ({ page }) => {
  await page.goto(`/p/${P}/data`);
  await page.getByRole("button", { name: "List" }).click();
  await page.getByLabel("Select IX-12-02491_0031_0001.jpg").check();
  await page.getByLabel("Select IX-12-02491_0031_0002.jpg").check();
  await expect(page.getByText("2 selected")).toBeVisible();
  await page.getByRole("button", { name: "Delete", exact: true }).click();
  const deleted = page.waitForRequest((r) => r.method() === "POST" && r.url().endsWith("/images/bulk-delete"));
  await page.getByRole("button", { name: "Delete 2 images" }).click();
  expect((await deleted).postDataJSON()).toEqual({ image_ids: [IMG, IMG2] });
  await expect(page.getByRole("status")).toContainText("images deleted");
});

test("run model on selected posts a local-model query run; add to dataset posts the ids", async ({ page }) => {
  await page.goto(`/p/${P}/data`);
  await page.getByRole("button", { name: "List" }).click();
  await page.getByLabel("Select IX-12-02491_0031_0001.jpg").check();
  const run = page.waitForRequest((r) => r.method() === "POST" && r.url().endsWith("/query-runs"));
  await page.getByRole("button", { name: "Run model" }).click();
  expect((await run).postDataJSON()).toEqual({ kind: "local_model", model_id: MODEL, image_ids: [IMG] });
  await expect(page.getByRole("status")).toContainText("Model run queued");
  await expect(page.getByText(/1 active job/)).toBeVisible();

  await page.getByRole("button", { name: "Add to dataset" }).click();
  await page.getByLabel("Dataset name").fill("v1");
  const dataset = page.waitForRequest((r) => r.method() === "POST" && r.url().endsWith("/datasets"));
  await page.getByRole("button", { name: "Create dataset" }).click();
  expect((await dataset).postDataJSON()).toEqual({ name: "v1", split_method: "by_group", val_fraction: 0.2, image_ids: [IMG] });
});

test("J, K and Enter open the focused image with the list as navigation context", async ({ page }) => {
  await page.goto(`/p/${P}/data`);
  await expect(page.getByText("IX-12-02491_0031_0002.jpg")).toBeVisible();
  await page.getByTestId("image-grid").focus();
  await page.keyboard.press("j");
  await page.keyboard.press("Enter");
  await page.waitForURL(`**/p/${P}/edit/${IMG2}`);
  await expect(page.getByTestId("position")).toHaveText("2 / 2");
  await page.keyboard.press("Control+ArrowLeft");
  await page.waitForURL(`**/p/${P}/edit/${IMG}`);
});

test("label selected opens the editor over the selection only", async ({ page }) => {
  await page.goto(`/p/${P}/data`);
  await page.getByRole("button", { name: "List" }).click();
  await page.getByLabel("Select IX-12-02491_0031_0002.jpg").check();
  await page.getByRole("button", { name: "Label selected" }).click();
  await page.waitForURL(`**/p/${P}/edit/${IMG2}`);
  await expect(page.getByTestId("position")).toHaveText("1 / 1");
});
```

- [ ] **Step 2: Run it**

Run: `pnpm e2e e2e/data-manager.spec.ts`
Expected: `6 passed`. If "sorting by a column header" flakes on the second click because the header text changed to "Boxes ▼", the `{ name: /Boxes/ }` regex form is already used for the second click; keep it.

- [ ] **Step 3: Commit**

```bash
git add e2e/data-manager.spec.ts
git commit -m "test(ui): data manager e2e against the mock server"
```

---

### Task 18: Playwright e2e for the review queue

**Files:**
- Create: `frontend/e2e/review.spec.ts`

- [ ] **Step 1: Write the spec**

```ts
import { test, expect } from "@playwright/test";

const P = "7f1c2e3a-1111-4000-8000-000000000001";
const IMG = "10000000-5555-4000-8000-000000000001";

test("review queue asks for pending images by confidence, shows the confidence column and opens the editor", async ({ page }) => {
  const queue = page.waitForRequest((r) => {
    if (r.method() !== "GET" || !r.url().includes(`/api/v1/projects/${P}/images?`)) return false;
    const q = new URL(r.url()).searchParams;
    return q.get("has_pending") === "true" && q.get("sort") === "max_pending_confidence" && q.get("order") === "desc";
  });
  await page.goto(`/p/${P}/review`);
  await queue;
  await expect(page.getByRole("heading", { name: "Review queue" })).toBeVisible();
  await expect(page.getByRole("columnheader", { name: /Top confidence/ })).toBeVisible();
  await expect(page.getByRole("row").filter({ hasText: "IX-12-02491_0031_0001.jpg" })).toContainText("81%");
  await expect(page.getByText("2 images waiting")).toBeVisible();

  await page.getByTestId("image-table").focus();
  await page.keyboard.press("Enter");
  await page.waitForURL(`**/p/${P}/edit/${IMG}`);
  await expect(page.getByTestId("position")).toHaveText("1 / 2");
  await expect(page.getByTestId("proposal-count")).toHaveText("1 proposal");
  const accepted = page.waitForRequest((r) => r.method() === "POST" && r.url().endsWith("/boxes/review"));
  await page.keyboard.press("a");
  expect((await accepted).postDataJSON()).toEqual({ box_ids: ["b0000000-6666-4000-8000-000000000002"], action: "accept" });
});
```

- [ ] **Step 2: Run it**

Run: `pnpm e2e e2e/review.spec.ts`
Expected: `1 passed`.

- [ ] **Step 3: Commit**

```bash
git add e2e/review.spec.ts
git commit -m "test(ui): review queue e2e against the mock server"
```

---

### Task 19: Playwright e2e for settings

**Files:**
- Create: `frontend/e2e/settings.spec.ts`

- [ ] **Step 1: Write the spec**

```ts
import { test, expect } from "@playwright/test";

const P = "7f1c2e3a-1111-4000-8000-000000000001";
const CLASS1 = "c1a2b3c4-0000-4000-8000-000000000001";
const CLASS4 = "c1a2b3c4-0000-4000-8000-000000000004";
const MODEL = "m0000000-2222-4000-8000-000000000001";

test("renames and rehotkeys a class and saves the full list with PUT", async ({ page }) => {
  await page.goto(`/p/${P}/settings`);
  await expect(page.getByRole("heading", { name: "Settings" })).toBeVisible();
  await page.getByLabel("Name of class 1").fill("digger");
  await page.getByLabel("Hotkey of class 1").selectOption("9");
  const put = page.waitForRequest((r) => r.method() === "PUT" && r.url().endsWith(`/projects/${P}/classes`));
  await page.getByRole("button", { name: "Save classes" }).click();
  const body = (await put).postDataJSON() as Array<{ id?: string; name: string; colour: string; hotkey: string | null }>;
  expect(body).toHaveLength(8);
  expect(body[0]).toEqual({ id: CLASS1, name: "digger", colour: "#f97316", hotkey: "9" });
  await expect(page.getByRole("status").filter({ hasText: "Classes saved" })).toBeVisible();
});

test("removing a class that still has boxes is refused with an explanation", async ({ page }) => {
  await page.route(`**/api/v1/projects/${P}/classes`, (route) =>
    route.request().method() === "PUT"
      ? route.fulfill({
          status: 409,
          contentType: "application/json",
          headers: { "Access-Control-Allow-Origin": "*" },
          body: JSON.stringify({
            error: { code: "class_in_use", message: "class still has boxes", details: { class_id: CLASS4, box_count: 40 } },
          }),
        })
      : route.continue(),
  );
  await page.goto(`/p/${P}/settings`);
  await page.getByRole("button", { name: "Remove class 4" }).click();
  await expect(page.getByLabel("Name of class 8")).toHaveCount(0);
  await page.getByRole("button", { name: "Save classes" }).click();
  await expect(page.getByRole("alert")).toContainText('Class "dump_truck" still has 40 boxes. Reassign or delete those boxes in the editor before removing it.');
  await expect(page.getByLabel("Name of class 4")).toHaveValue("dump_truck");
});

test("pre-annotation model selection patches the project and tolerates a missing registry", async ({ page }) => {
  await page.goto(`/p/${P}/settings`);
  const select = page.getByLabel("Pre-annotation model");
  await expect(select).toHaveValue(MODEL);
  const patched = page.waitForRequest((r) => r.method() === "PATCH" && r.url().endsWith(`/projects/${P}`));
  await select.selectOption("");
  expect((await patched).postDataJSON()).toEqual({ preannotation_model_id: null });

  await page.route(`**/api/v1/projects/${P}/models*`, (route) =>
    route.fulfill({
      status: 501,
      contentType: "application/json",
      headers: { "Access-Control-Allow-Origin": "*" },
      body: JSON.stringify({ error: { code: "not_implemented", message: "models arrive with S3", details: {} } }),
    }),
  );
  await page.reload();
  await expect(page.getByRole("note")).toContainText("The model registry is not available yet");
  await expect(page.getByLabel("Pre-annotation model")).toBeDisabled();
});

test("import defaults save with PATCH and the provider placeholder is present", async ({ page }) => {
  await page.goto(`/p/${P}/settings`);
  await page.getByLabel("Max side").fill("3000");
  const patched = page.waitForRequest((r) => r.method() === "PATCH" && r.url().endsWith(`/projects/${P}`));
  await page.getByRole("button", { name: "Save import defaults" }).click();
  const body = (await patched).postDataJSON() as { import_defaults: { max_side: number; quality: number; dedupe_threshold: number; group_regex: string } };
  expect(body.import_defaults.max_side).toBe(3000);
  expect(body.import_defaults.quality).toBe(95);
  expect(body.import_defaults.dedupe_threshold).toBe(4);
  await expect(page.getByRole("heading", { name: "Provider keys" })).toBeVisible();
  await expect(page.getByText(/Windows Credential Manager/)).toBeVisible();
});
```

- [ ] **Step 2: Run it**

Run: `pnpm e2e e2e/settings.spec.ts`
Expected: `4 passed`.

- [ ] **Step 3: Commit**

```bash
git add e2e/settings.spec.ts
git commit -m "test(ui): settings e2e against the mock server"
```

---

### Task 20: Final verification

**Files:**
- No new files. Everything from `frontend/`.

- [ ] **Step 1: Format, lint, type-check, unit tests, build**

Run: `pnpm format && pnpm lint && pnpm test && pnpm build`
Expected: prettier writes nothing new (or only formatting), eslint clean, Vitest reports every file green (S0's 2 files plus S2's: errors, images, boxes, project, editor store, changes, navigation, geometry, history, hotkeys, commands, useEditorNavigation, RegionList, ClassSidebar, listModel, selection, useVirtualRows, useImageList, FilterBar, ImageTable, bulkActions, SelectionBar, ReviewScreen, classesModel, ClassesSection, PreannotationSection, ImportDefaultsSection), `vite build` writes `dist/`.

- [ ] **Step 2: Full e2e run against the mock**

Run: `pnpm e2e`
Expected: `boot` 1, `data-manager` 6, `editor` 11, `review` 1, `settings` 4: `23 passed`. Run it a second time to make sure nothing is order-dependent.

- [ ] **Step 3: Contract untouched**

Run from the repo root of the worktree: `git status --porcelain -- contract` and `pnpm --dir contract check`
Expected: empty status; `check` prints the Spectral result and `git diff --exit-code` passes (client unchanged).

- [ ] **Step 4: Manual pass in the browser (spec section 12 "demonstrated through the real UI")**

With `pnpm --dir ../contract mock` and `pnpm dev` running, walk: Projects -> Open Ahmadia -> grid, list, filters, select two, Run model, Delete (cancel) -> Enter on a tile -> editor: wheel zoom, space-drag pan, F, 0, draw with class 2, drag the person box, resize by a handle, Ctrl+D, Delete, A, R, Show rejected, Ctrl+Z, Ctrl+Y, Ctrl+Right, Ctrl+Left -> Review -> Enter -> Settings: rename, save, choose model, save import defaults. Note anything that behaves unexpectedly in the commit message of a fix commit.

- [ ] **Step 5: Commit any last fixes and report**

```bash
git add -A src e2e
git commit -m "chore(ui): S2 annotation UI verification pass"
```

Report to the goal owner: the branch name, the commit range, the unit and e2e counts, and the "Contract gaps found" list below (the goal owner owns `contract/openapi.yaml` and `docs/progress.md`; do not edit them).

---

## Contract gaps found

Each item stayed inside the contract with the workaround noted; the goal owner decides whether to change `openapi.yaml`.

1. **No way to return a box to `unreviewed`.** `BoxReview.action` is `accept | reject` only, and `PATCH` on a proposal always yields `edited`. Undo of "accept" therefore issues `reject` (and vice versa), and undo of a click-edit restores the geometry but the box stays `edited`. Workaround in `commands.ts` (`cmdReview`), documented in the code. Suggested change: add `unreview` to `BoxReview.action`.
2. **Undo of a delete cannot restore provenance or confidence.** `BoxCreate` only takes `class_id, x, y, w, h` and always creates a `person`/`accepted` box, so undoing the deletion of a model proposal re-creates it as a person box. Workaround in `cmdDelete`. Suggested change: an undelete endpoint or soft delete.
3. **No server-side filters for box count or capture time.** `listImages` filters are `source_id, group_key, labeled, has_pending, search, ids`. The Data Manager's "Min boxes" and "Captured from/to" filters run client-side over the loaded rows (`applyClientFilters`), which is exact only once every page is loaded. Suggested change: `min_box_count`, `capture_from`, `capture_to` query parameters.
4. **No endpoint lists group keys.** The group filter is a free-text input; `GET /projects/{p}/stats` would give the list but may be 501 until S1 and is heavy. Suggested change: a lightweight `GET /projects/{p}/groups` or a `distinct` flag. No workaround beyond the text input.
5. **Creating a box has no client-side idempotency key.** A redo of "draw" re-posts and gets a new id; the `BoxRef` indirection in `history.ts` handles it. No contract change needed, noted for S1's implementers because redo-after-undo makes two create calls for one visible box.

Everything else the screens need exists: listing with sort and filters, per-image boxes, create/update/delete/bulk review, pre-annotation, class replacement with `class_in_use`, project patch for the pre-annotation model and import defaults, models list, query-run and dataset creation for bulk actions, bulk delete, and the four websocket event types.

## Self-review checklist (run before reporting)

- Spec section 6 coverage: Data Manager grid/list, seven columns, filters and sort on every column, multi-select, bulk actions, J/K/Enter (Tasks 7-9, 17). Editor: Konva stage, wheel zoom, space-drag pan, F, 1:1 (Task 10, hotkeys in 12), class sidebar with swatches and hotkeys 1 to 9 (12), draw/move/resize/Delete/Ctrl+D (11, 12), region list with class, confidence, provenance badge, review state (12), dashed proposals, A/R, click-edit accepts as edited (11, 13), Ctrl+Right/Left with auto-save (14), undo/redo per image as compensating calls (11, 14). Review queue (15, 18). Settings: classes with `class_in_use` explanation, pre-annotation model with 501 tolerance, provider placeholder, import defaults (16, 19). Behaviour: every edit is a Box row immediately (11); images served at `max_side` and 256 px thumbnails (10, 8); class changes never delete boxes (16). Section 7 pre-annotation on open (10, 13). Section 11: errors surface through the envelope message, never a crash (1, every screen). Section 12: Vitest for state and utilities, Playwright per screen against the mock (every task, 17-19).
- Placeholder scan: the only intentional placeholders are the `data-slot` divs in Task 10 and the `{/* SelectionBar (Task 9) */}` line in Task 8, each replaced by a named later task with the exact replacement code.
- Type consistency to verify by grep once implemented: `ImageRow` alias everywhere the contract `Image` type is used; `useEditorActions` returns `{actions, canUndo, canRedo}` and `EditorScreen` destructures it; `EditorActions.drawBox(rect, classId)` matches the call in `EditorScreen.onMouseUp`; `onCommitRect(id, before, after)` in `BoxLayer` matches `actions.commitRect`; `useVirtualRows` returns `{containerRef, width, height, scrollTop, onScroll, scrollToIndex}` and `ImageTable`/`ImageGrid` feed `scrollTop` and `height` to `computeWindow`; `colourOf`, `nameOf`, `provenanceLabel` live in `editor/labels.ts`; `ListImagesQuery` is the type of both `useImageList`'s argument and `REVIEW_QUEUE_QUERY`; `useNavigationStore.neighbours` returns `{prev, next, index, count}` as used by `useEditorNavigation`; `fakeClient` returns `{api, requests}` in every test; `ApiContext`/`ApiContextValue` are exported from `client.tsx` for `render.tsx`.
