# S5: Training and Inference UI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the model registry, training, query-run and jobs screens plus the provider settings of the desktop app on top of the S2 annotation UI, against the Prism mock server, so that a user can import or train a model, watch the job live, run a local model or a cloud vision query over images, review and promote the results, and manage provider keys, with Vitest and Playwright coverage for every screen.

**Architecture:** Five new API wrapper modules (`api/models.ts`, `api/datasets.ts`, `api/providers.ts`, `api/queryRuns.ts`, `api/jobs.ts`) take the generated `openapi-fetch` client explicitly, so they are unit-tested with the S2 fake `fetch`. The S2 `useJobsStore` grows a panel flag, bulk upsert and terminal-state handling; three small hooks (`useTrackedJob`, `useJobLog`, `useJobList`) poll the `jobs` resource while a job is active so the UI stays live even where the websocket is missing (the mock) and stays consistent when it is present (the real backend). Screens are thin compositions of focused modules under `models/`, `train/`, `query/`, `jobs/` and `settings/`; pure helpers (CSV parsing, alias parsing, form-to-request mapping, message parsing, labels) live in plain `.ts` files with their own tests; a shared `JobCard` renders any job's progress, error, cancel and log everywhere a job is shown.

**Tech Stack:** React 18, TypeScript 5, Vite 6, Tailwind 3, react-router 6, zustand 5, `openapi-fetch` through `@contract/client`, Vitest 3 + Testing Library (jsdom), Playwright 1 against Stoplight Prism 5 (mock server). Inline SVG for the training curve (no chart library).

**Spec:** `docs/superpowers/specs/2026-09-17-machinery-detection-app-design.md` section 13.1 row S5 (training screen, model registry screen, query run screen, job panel, settings), drawing on sections 7 (training and registry: parameters, artifacts, exports, pre-annotation model) and 8 (inference: providers, tiling, query run job, cost estimate, promotion), plus sections 2, 3, 6 (screen 5: provider keys), 9, 11, 12 and 13. Contract: `contract/openapi.yaml` (source of truth) and its generated wrapper `contract/client/index.ts`. Existing UI to build on: the S2 branch `s2-annotation-ui` (merging into `main` before S5 starts); read the "Interfaces from S0/S2 you build on" section below first.

## Global Constraints

- Locked (spec section 2): React 18, TypeScript, Vite, Tailwind only (no component library), the generated client via `@contract/client`; zustand 5 is available and used for stores. No new dependencies: everything needed is already in `frontend/package.json` (`@tauri-apps/plugin-dialog` for the weights file picker is already there). The training curve is drawn with inline SVG; do not add a chart library. Nothing installed system-wide.
- The contract is the source of truth and S5 must not change it. If a change seems necessary, note it under "Contract gaps found" at the end of this plan and work around it within the contract. Every path carries `/api/v1`.
- Every request goes through the client from `useApi()` (`frontend/src/api/client.tsx`); wrappers take `api: ApiClient` as their first argument so tests can pass `fakeClient(...)`. Images that go through `<img src>` (confusion matrix, PR curve) cannot send headers, so the artifact URL carries the token in the query exactly like `imageFileUrl` in `@contract/client`; `baseUrl` and `token` come from `useBackend()`.
- Development runs against the Prism mock server (`pnpm --dir ../contract mock`, port 4010). It returns the schema examples: the same example for every id, POSTs are not persisted, every list endpoint except `images` returns `next_cursor: "string"`. See "Mock server limitations" below before writing any test.
- The real backend answers `501 not_implemented` for `providers` and `query-runs` until S4 lands (and `datasets`/`models` were 501 before S1/S3). Every call is guarded: a 501 (`isNotImplemented(err)` from `src/api/errors.ts`) shows a "not available yet" note (`role="note"`) and keeps the rest of the screen working; any other failure shows the envelope message in `role="alert"`. The mock never returns 501, so the 501 branch is covered by unit tests with the fake fetch, and by Playwright `page.route` fulfilments where an e2e needs it.
- Testing (spec section 12): Vitest for state, helpers and API wrappers (fake `fetch`, never the network) and Testing Library for components; one Playwright spec per screen against the mock that asserts on UI state and on the requests made (`page.waitForRequest`, `request.postDataJSON()`), never on persistence. TDD in every task: failing test first, run it, implement, run again, commit.
- Secrets: the API key is typed into a `type="password"` field, sent once with `PUT /providers/{provider}/key`, cleared from component state right after the request resolves (success or failure), never displayed, never logged (`pushLog` lines about keys carry the provider name only), never written to any file. The settings screen states that keys are stored in Windows Credential Manager.
- Websocket events (`job.progress`, `job.state`) already flow through `connectEvents` in `App.tsx` into `useJobsStore.applyEvent`. S5 additionally polls `GET .../jobs/{id}` every 2 s while a tracked job is `queued`/`running` and `GET .../jobs/{id}/log?tail=200` every 2 s while a log view is live, so the mock (no websocket) and a dropped socket both keep the UI moving.
- Product name "Machinery Detection". No secrets in files. Ports: Vite 1420, mock 4010. Never write to anything under `E:\Dev\Yolo` outside `E:\Dev\Yolo\app`.
- Files stay focused and named by responsibility (file structure below): `frontend/src/models/*`, `frontend/src/train/*`, `frontend/src/query/*`, `frontend/src/jobs/*`, `frontend/src/settings/ProvidersSection.tsx` (+ `ProviderCard.tsx`, `providersModel.ts`), API wrappers `api/models.ts`, `api/providers.ts`, `api/queryRuns.ts`, `api/jobs.ts`, `api/datasets.ts`, `api/paging.ts`.
- zustand 5 selectors must return stable references: select primitive fields or arrays stored as-is in the store; derive sorted/filtered arrays with `useMemo`.
- The ESLint config enables the React Compiler rules of `eslint-plugin-react-hooks` 7 as errors (`set-state-in-effect`, `set-state-in-render`, `refs`, `immutability`, `purity`, `preserve-manual-memoization`). Consequences: never call a `useState` setter synchronously inside a `useEffect` body (setters inside `.then`, timers, event callbacks are fine; zustand `getState().upsert(...)` calls are plain functions and fine); derive values during render or reset local state with a `key` prop; never read or write `ref.current` during render; never list a dependency in `useMemo`/`useCallback` that the callback does not use. `react-refresh/only-export-components` and `exhaustive-deps` are warnings and do not fail `pnpm lint`; keep component files free of non-component exports except constants.
- Lint is `pnpm lint` (eslint + prettier check, printWidth 110, double quotes, trailing commas); run `pnpm format` before every commit. All commands in this plan run from `frontend/` inside your worktree (`.worktrees/s5-training-inference-ui/frontend`, branch `s5-training-inference-ui`, created from `main` after `s2-annotation-ui` is merged; run `pnpm install --frozen-lockfile` once in `frontend/` and once in `contract/` if `node_modules` is missing). Commit messages use the `feat(ui):`, `test(ui):`, `chore(ui):` prefixes.
- Files S5 may modify outside its own new modules: `src/app/Shell.tsx` (jobs button and panel), `src/store/jobs.ts`, `src/store/navigation.ts` (one union member), `src/data/bulkActions.ts`, `src/data/SelectionBar.tsx`, `src/screens/{DataManager,Review,Models,Train,Query,Settings}Screen.tsx`, `src/settings/ProvidersPlaceholder.tsx` (deleted), `src/test/fixtures.ts` (additions only), their tests, and `e2e/data-manager.spec.ts`, `e2e/settings.spec.ts`. Everything under `src/editor/*` and `src/api/{client,errors,events,backend,project,images,boxes}.ts(x)` stays untouched.

## Interfaces from S0/S2 you build on (read these files first)

- `contract/client/index.ts`: `createApiClient({baseUrl, token, fetch?})`, `ApiClient`, `eventsUrl(baseUrl, token)`, `imageFileUrl(baseUrl, token, projectId, imageId, maxSide?)`, `thumbnailUrl(...)`, type aliases `Project`, `ClassDef`, `Image`, `ImagePage`, `Box`, `Dataset`, `DatasetStats`, `Model`, `ModelMetrics`, `TrainRequest`, `Provider`, `ProviderName`, `QueryRun`, `QueryRunCreate`, `Tiling`, `CostEstimate`, `Job`, `JobState`, `JobType`, `JobLog`, `AppEvent`, `ApiError`, plus `paths` and `components` for anything else (`components["schemas"]["ModelImport"]`, `["ExportRequest"]`, `["DatasetCreate"]`, `["DatasetWithJob"]`, `["ProviderUpdate"]`, `["ProviderTestResult"]`, `["QueryRunWithJob"]`, `["PromoteResult"]`, `["ClassMetrics"]`, `["SplitMethod"]`). Client methods: `api.GET(path, {params: {path, query}})`, `api.POST(path, {params, body})`, `api.PATCH`, `api.PUT`, `api.DELETE`; each resolves to `{data, error, response}`. `api.GET(path, {..., parseAs: "text", headers: {Accept: "text/csv"}})` returns the body as a string (used for `results.csv`).
- Generated-client quirk (S2 report, contract gap 5): fields that carry a `default` in the YAML are **required** in the generated types. So `TrainRequest` requires `epochs`, `imgsz`, `patience`, `augmentation`, `device` (`batch` optional, nullable); `ExportRequest` requires `imgsz` and `half`; `DatasetCreate` requires `val_fraction` and `seed`; `QueryRunCreate` requires `conf`; `Tiling` requires all four fields; `PromoteRequest` requires `min_confidence`. Always send them explicitly with the contract defaults.
- `src/api/client.tsx`: `useApi(): ApiClient`, `useBackend(): {baseUrl, token, mode: "tauri" | "env" | "mock"}`, `ApiContext`, `ApiContextValue`.
- `src/api/errors.ts`: `class ApiFailure extends Error {code; status; details}`, `messageOf(err, fallback)`, `codeOf(err)`, `isNotImplemented(err)`, `unwrap<T>(call)` (data-or-throw; a 204 resolves to `undefined`).
- `src/api/project.ts`: `fetchProject(api, projectId)`, `patchProject(api, projectId, patch: ProjectUpdate)`, `fetchModels(api, projectId): Promise<Model[]>` (first page only; S5 adds `fetchAllModels`), `useProject(projectId): {project, error, reload, setProject}`.
- `src/api/images.ts`: `type ListImagesQuery` (`source_id`, `group_key`, `labeled`, `has_pending`, `search`, `ids`, `sort`, `order`, `limit`, `cursor`), `fetchImagePage(api, projectId, query): Promise<ImagePage>`, `IMAGE_PAGE_SIZE = 200`, `REVIEW_QUEUE_QUERY`.
- `src/store/jobs.ts` (S2 version, replaced in Task 3): `useJobsStore` with `jobs: Record<string, Job>`, `upsert(job)`, `applyEvent(ev)`, `active(): Job[]`.
- `src/store/navigation.ts`: `useNavigationStore` with `ids: string[]`, `source: NavSource` (`"data" | "review" | "selection" | null`, S5 adds `"query"`), `setContext(ids, source)`, `neighbours(id)`.
- `src/store/changes.ts`: `useChangesStore` with `imagesRevision`, `bumpImages()`, `applyEvent(ev)`.
- `src/app/diagnostics.ts`: `pushLog(line)`. `src/app/Shell.tsx`: sidebar nav (`Models`, `Train`, `Query`, `Settings` links exist), top bar with `<span>{activeJobs} active job(s)</span>` (replaced by the jobs button in Task 4), `<main className="min-h-0 flex-1 overflow-auto p-6">` around `<Outlet />`.
- `src/routes.tsx`: `/p/:projectId/models`, `/p/:projectId/train`, `/p/:projectId/query`, `/p/:projectId/settings`, `/p/:projectId/review`, `/p/:projectId/data`, `/p/:projectId/edit/:imageId` already exist and point at the placeholder screens S5 replaces.
- `src/data/bulkActions.ts` (S2): `DatasetOptions {name, split_method, val_fraction}`, `runModelOnImages(...)` (removed in Task 14), `addImagesToDataset(...)` (changed in Task 14), `deleteImages(api, projectId, imageIds)`.
- `src/data/SelectionBar.tsx` (S2): props `{projectId, selectedIds, preannotationModelId, onLabel, onDeleted, onClear}`; buttons "Label selected", "Run model", "Add to dataset", "Delete", "Clear selection" (changed in Task 14).
- `src/settings/*` (S2): `ClassesSection`, `PreannotationSection({project, onSaved})`, `ImportDefaultsSection`, `ProvidersPlaceholder` (replaced in Task 13); `src/screens/SettingsScreen.tsx` mounts them.
- `src/test/fixtures.ts` (S2): `PROJECT_ID`, `IMAGE_ID`, `IMAGE_ID_2`, `MODEL_ID`, `SOURCE_ID`, `CLASS_ID(n)`, `exampleClasses`, `exampleProject`, `exampleImage`, `exampleImage2`, `exampleImagePage`, `personBox`, `proposalBox`, `exampleModel` (imported yolo11m-coco, `metrics: null`, `artifacts: {}`), `exampleJob` (type `infer`, `queued`), `errorBody(code, message, details?)`, `RecordedRequest {method, url, body}`, `FakeRoute {method, path: RegExp, status?, body?: FakeBody | ((req) => FakeBody)}`, `fakeFetch(routes)`, `fakeClient(routes): {api, requests}` (first matching route wins; unknown routes answer 404; `status: 204` or `body: undefined` answers an empty body).
- `src/test/render.tsx` (S2): `TestApiProvider({api, children})`, `renderWithProviders(ui, {api, route?, path?})` (API context + `MemoryRouter`; `path` mounts `ui` as a route so `useParams`/`useSearchParams` work).
- Input/button classes used across S2 for visual consistency: inputs `rounded border border-slate-700 bg-slate-800 px-2 py-1 text-sm`, primary buttons `rounded bg-orange-600 px-3 py-1 text-sm font-medium hover:bg-orange-500 disabled:opacity-50`, secondary buttons `rounded border border-slate-700 px-3 py-1 text-sm hover:bg-slate-800 disabled:opacity-50`, alerts `rounded border border-red-800 bg-red-950 px-3 py-2 text-sm text-red-200`, status lines `text-xs text-emerald-300`, notes `text-xs text-slate-400`.
- Backend facts that shape the UI (S3/S4 reports): training `job.progress` messages are `epoch 3/50 mAP50 0.612` (or `epoch 3/50` before the first validation); a finished training job's `result` is `{model_id, metrics}`; export jobs put the path in `model.exports[format]`; query-run `job.progress` messages are `12 / 50 images, 37 boxes`, and the run's `box_count` grows as tiles land; `job.state` payload is `{state, result, error}`.

## File structure

```
frontend/src/
  api/
    paging.ts             collectPages<T extends {id}>(fetchPage, maxPages): follows next_cursor, dedupes by id, stops on a repeated cursor
    models.ts             fetchAllModels, fetchModel, importModel, trainModel, exportModel, deleteModel, artifactUrl, fetchResultsCsv
    datasets.ts           fetchDatasets, fetchDataset, fetchDatasetStats, createDataset
    providers.ts          fetchProviders, updateProvider, setProviderKey, deleteProviderKey, testProvider
    queryRuns.ts          DEFAULT_TILING, estimateQueryRun, createQueryRun, fetchQueryRuns, fetchQueryRun, promoteQueryRun
    jobs.ts               fetchJobs, fetchJob, cancelJob, fetchJobLog
  store/
    jobs.ts               (replace) useJobsStore: jobs, panelOpen, upsert, upsertMany, setPanelOpen, applyEvent (terminal states stamp finished_at), active; selectActiveCount, isActiveJob
    navigation.ts         (modify) NavSource gains "query"
  jobs/
    jobLabels.ts          jobTitle, stateLabel, elapsedSeconds, formatDuration, resultTarget (link for a finished job)
    useNow.ts             useNow(intervalMs): ticking Date.now()
    useTrackedJob.ts      useTrackedJob(projectId, jobId): store job, polled every 2 s while active
    useJobLog.ts          useJobLog(projectId, jobId, live, tail): lines polled every 2 s while live
    useJobList.ts         useJobList(projectId, enabled): loads GET /jobs into the store, refreshes every 5 s while enabled
    JobCard.tsx           progress bar, message, elapsed, error, cancel, result link, optional log toggle
    JobLogView.tsx        <pre> of the log tail
    JobsButton.tsx        top-bar button "N active jobs" toggling the panel
    JobsPanel.tsx         slide-over listing every job newest first
  models/
    resultsCsv.ts         CurvePoint, parseResultsCsv, curvePolyline
    aliases.ts            DEFAULT_ALIASES, parseAliases, formatAliases
    modelLabels.ts        formatMetric, formatDate, kindLabel
    useModels.ts          useModels(projectId): list with reload/replace/remove, 501 tolerated
    ModelTable.tsx        registry table (kind, name, base, dataset, mAP50, mAP50-95, precision, recall, created)
    TrainingCurve.tsx     inline SVG of mAP50 (and mAP50-95) over epochs
    ModelArtifacts.tsx    confusion matrix + PR curve <img> through artifactUrl, results.csv -> TrainingCurve
    ExportButtons.tsx     ONNX / TensorRT export -> job (JobCard), existing exports listed
    ImportModelForm.tsx   name, weights path (Tauri file dialog in tauri mode), class aliases editor -> POST models/import
    ModelDetail.tsx       metadata, per-class metrics table, artifacts, exports, use as pre-annotation, delete with confirm
  train/
    trainModel.ts         TrainForm, DEFAULT_TRAIN_FORM, toTrainRequest, validateTrainForm, parseEpochMessage
    TrainForm.tsx         dataset picker, base model picker, parameter form, Start
    TrainProgress.tsx     live card: epoch, mAP50, elapsed, progress, log tail, cancel, link to the model
  query/
    queryModel.ts         QueryForm, DEFAULT_QUERY_FORM, ImageMode, toQueryRunCreate, validateQueryForm, imageQuery, reviewLink, runTitle
    useImageSelection.ts  resolves the form's image mode to image ids (preloaded selection or listing)
    useTrackedRun.ts      run + job, run refetched every 2 s while the job is active
    SourcePicker.tsx      kind, model picker, provider picker (disabled without key), query text
    ImagePicker.tsx       selection mode, group key, N, count line
    TilingFields.tsx      tiling enabled, tile size, overlap, NMS IoU, confidence
    EstimateCard.tsx      images, tiles, requests, cost
    RunCard.tsx           run summary, JobCard, boxes so far, Review results link, promote form
    RunHistory.tsx        list of runs, click to select
  settings/
    providersModel.ts     providerLabel, ProviderForm, formOf, diffProvider
    ProviderCard.tsx      per-provider config form, key entry/removal, Test
    ProvidersSection.tsx  loads GET /providers; replaces ProvidersPlaceholder
  data/
    AddToDatasetDialog.tsx dialog: name, split method, val fraction, seed -> POST datasets -> JobCard
    bulkActions.ts        (modify) addImagesToDataset returns DatasetWithJob and sends seed; runModelOnImages removed
    SelectionBar.tsx      (modify) Run model navigates to the query screen; Add to dataset opens the dialog
  screens/
    ModelsScreen.tsx      (replace) registry composition, ?model= selects the detail
    TrainScreen.tsx       (replace) form + progress, ?job= tracks a job
    QueryScreen.tsx       (replace) source, images, tiling, estimate, start, run card, history; ?run= selects a run
    SettingsScreen.tsx    (modify) mounts ProvidersSection
    DataManagerScreen.tsx (modify) onRunModel navigation
    ReviewScreen.tsx      (modify) ?ids= narrows the queue to a run's images
  test/
    fixtures.ts           (modify) trained model, dataset, providers, query run, estimate, job log, running job, RESULTS_CSV
frontend/e2e/
  models.spec.ts  train.spec.ts  query.spec.ts  jobs.spec.ts  providers.spec.ts  data-manager.spec.ts (modify)  settings.spec.ts (modify)
```

## Mock server limitations (verified against Prism 5 on 2026-09-18)

- Same example for every id, POSTs not persisted. `GET /models` and `GET /models/{id}` always return the imported `yolo11m-coco` (`m…0001`, `metrics: null`, `artifacts: {}`, `exports: {}`); `POST /models/import` answers 201 with the same model; `DELETE` answers 204. A trained model with metrics and artifacts only appears in e2e through `page.route` fulfilments (Task 15).
- Every list except `images` returns `next_cursor: "string"` (no example on the page schemas): a naive cursor loop never ends. `collectPages` (Task 1) stops when a cursor repeats and dedupes items by id, so each list costs two requests under the mock and one item.
- `GET /jobs`, `GET /jobs/{id}` and `POST /jobs/{id}/cancel` always return the example job `j…0001` (`type: import`, `state: running`, `progress: 0.42`, `message: "1386 / 3299 images"`); `POST /models/train`, `POST /models/{id}/export`, `POST /datasets` and `POST /query-runs` all return that same job. So under the mock a started training shows an "Import" job at 42 % forever and never reaches `succeeded`; e2e tests assert the request bodies and the live card, and the success branch (link to the model) is unit-tested with a fake job. `GET /jobs/{id}/log` returns two example lines.
- `GET /models/{id}/artifacts/{artifact}` returns the 6-byte body `string` with `Content-Type` chosen from the `Accept` header (`image/png` by default, `text/csv` when asked): the `<img>` elements fire `onError` (fallback text), and `parseResultsCsv("string")` yields no points (the curve shows "No epochs recorded"). e2e serves a real CSV through `page.route`.
- `GET /providers` returns `openai` (`has_key: false`) and `anthropic` (`has_key: true`, `claude-opus-5`); `PATCH` returns the anthropic example whatever the path; `PUT`/`DELETE key` answer 204; `POST test` answers `{ok: true, message: "responded in 1.2 s", model_name: "claude-opus-5"}`.
- `POST /query-runs/estimate` answers `{images: 5, tiles: 40, requests: 40, cost_per_request: 0.02, estimated_cost: 0.8}` whatever the body; `POST /query-runs` answers run `q…0001` (cloud_provider anthropic, "dump trucks", two image ids, `box_count: 7`, `job_id: j…0003`) with job `j…0001`; `GET /query-runs` lists that run; `POST …/promote` answers `accepted: 6` and `promoted_at` set.
- `GET /images` ignores every filter and always returns the two example images with `total: 2` and `next_cursor: null`; image-selection tests assert the query string (`labeled=false`, `group_key=`, `limit=`).
- `GET /datasets` returns dataset `v1` (`d…0001`, 30 images); `POST /datasets` answers 202 with that dataset and job `j…0001`.
- The websocket `/api/v1/events` is 404 on the mock; polling (Task 3) keeps jobs moving. Missing token answers 401. Request validation is on (an invalid body gets 422 with the generic `Error` example); use `page.route` + `route.fulfill` (with `Access-Control-Allow-Origin: *`) for 501 and error scenarios in e2e.

---

### Task 1: Fixtures, page collector and the models/datasets API wrappers

**Files:**
- Create: `frontend/src/api/paging.ts`, `frontend/src/api/models.ts`, `frontend/src/api/datasets.ts`
- Modify: `frontend/src/test/fixtures.ts` (append new fixtures; change nothing existing)
- Test: `frontend/src/api/paging.test.ts`, `frontend/src/api/models.test.ts`, `frontend/src/api/datasets.test.ts`

**Interfaces:**
- Consumes: `unwrap`, `ApiFailure` from `src/api/errors.ts`; `fakeClient`, `errorBody`, existing fixtures.
- Produces:
  - `fixtures.ts` additions: `TRAINED_MODEL_ID`, `DATASET_ID`, `RUN_ID`, `JOB_ID`, `exampleTrainedModel: Model`, `exampleDataset: Dataset`, `exampleProviders: Provider[]`, `exampleQueryRun: QueryRun`, `exampleEstimate: CostEstimate`, `exampleJobLog: JobLog`, `runningJob: Job` (the mock's `j…0001`), `RESULTS_CSV: string`.
  - `paging.ts`: `interface Page<T> {items: T[]; next_cursor: string | null}`, `collectPages<T extends {id: string}>(fetchPage: (cursor?: string) => Promise<Page<T>>, maxPages = 50): Promise<T[]>`.
  - `models.ts`: `type Artifact = "results_csv" | "confusion_matrix" | "pr_curve"`, `type ModelImport`, `type ExportRequest`, `type ExportFormat = ExportRequest["format"]`, `fetchAllModels(api, projectId): Promise<Model[]>`, `fetchModel(api, projectId, modelId): Promise<Model>`, `importModel(api, projectId, body: ModelImport): Promise<Model>`, `trainModel(api, projectId, body: TrainRequest): Promise<Job>`, `exportModel(api, projectId, modelId, body: ExportRequest): Promise<Job>`, `deleteModel(api, projectId, modelId): Promise<void>`, `artifactUrl(baseUrl, token, projectId, modelId, artifact: Artifact): string`, `fetchResultsCsv(api, projectId, modelId): Promise<string>`.
  - `datasets.ts`: `type DatasetCreate`, `type DatasetWithJob`, `type SplitMethod`, `fetchDatasets(api, projectId): Promise<Dataset[]>`, `fetchDataset(api, projectId, datasetId): Promise<Dataset>`, `fetchDatasetStats(api, projectId, datasetId): Promise<DatasetStats>`, `createDataset(api, projectId, body: DatasetCreate): Promise<DatasetWithJob>`.

- [ ] **Step 1: Append the fixtures**

Append to `frontend/src/test/fixtures.ts` (extend the existing import from `@contract/client` with `CostEstimate`, `Dataset`, `JobLog`, `Provider`, `QueryRun`):

```ts
export const TRAINED_MODEL_ID = "m0000000-2222-4000-8000-000000000002";
export const DATASET_ID = "d0000000-7777-4000-8000-000000000001";
export const RUN_ID = "q0000000-8888-4000-8000-000000000001";
export const JOB_ID = "j0000000-4444-4000-8000-000000000001";

export const exampleTrainedModel: Model = {
  id: TRAINED_MODEL_ID,
  name: "ahmadia-v1-n",
  kind: "trained",
  weights_path: "models/ahmadia-v1-n.pt",
  base_weights: "yolo11n.pt",
  dataset_id: DATASET_ID,
  hyperparameters: { epochs: 3, imgsz: 1280, augmentation: "aerial" },
  metrics: {
    map50: 0.71,
    map50_95: 0.44,
    precision: 0.78,
    recall: 0.66,
    per_class: [
      { class_name: "excavator", map50: 0.8, map50_95: 0.5, precision: 0.82, recall: 0.7 },
      { class_name: "dump_truck", map50: 0.62, map50_95: 0.38, precision: 0.74, recall: 0.62 },
    ],
  },
  class_names: ["excavator", "dump_truck"],
  class_aliases: {},
  exports: { onnx: "models/ahmadia-v1-n.onnx" },
  artifacts: {
    results_csv: "runs/j1/results.csv",
    confusion_matrix: "runs/j1/confusion_matrix.png",
    pr_curve: "runs/j1/PR_curve.png",
  },
  run_id: "j0000000-4444-4000-8000-000000000009",
  created_at: "2026-09-17T15:00:00Z",
};

export const exampleDataset: Dataset = {
  id: DATASET_ID,
  name: "v1",
  classes: [exampleClasses[0]],
  split_method: "by_group",
  split_params: { val_fraction: 0.2, seed: 42 },
  path: "datasets/v1",
  image_count: 30,
  train_count: 24,
  val_count: 6,
  job_id: "j0000000-4444-4000-8000-000000000002",
  created_at: "2026-09-17T12:00:00Z",
};

export const exampleProviders: Provider[] = [
  { name: "openai", has_key: false, model_name: "gpt-5", requests_per_minute: 30, cost_per_request: 0.02 },
  { name: "anthropic", has_key: true, model_name: "claude-opus-5", requests_per_minute: 30, cost_per_request: 0.02 },
];

export const exampleQueryRun: QueryRun = {
  id: RUN_ID,
  kind: "cloud_provider",
  model_id: null,
  provider: "anthropic",
  model_name: "claude-opus-5",
  query: "dump trucks",
  image_ids: [IMAGE_ID, IMAGE_ID_2],
  tiling: { enabled: true, tile_size: 1280, overlap: 0.2, nms_iou: 0.5 },
  conf: 0.25,
  job_id: "j0000000-4444-4000-8000-000000000003",
  box_count: 7,
  promoted_at: null,
  created_at: "2026-09-17T13:00:00Z",
};

export const exampleEstimate: CostEstimate = {
  images: 5,
  tiles: 40,
  requests: 40,
  cost_per_request: 0.02,
  estimated_cost: 0.8,
};

export const exampleJobLog: JobLog = {
  lines: ["2026-09-17 10:05:01 INFO job started", "2026-09-17 10:05:09 INFO 50 / 3299 images"],
  path: "runs/j0000000-4444-4000-8000-000000000001/job.log",
};

/** The mock's example job: what every job endpoint and every job-returning POST answers. */
export const runningJob: Job = {
  id: JOB_ID,
  project_id: PROJECT_ID,
  type: "import",
  state: "running",
  progress: 0.42,
  message: "1386 / 3299 images",
  log_path: "runs/j0000000-4444-4000-8000-000000000001/job.log",
  params: { source_id: SOURCE_ID },
  result: null,
  error: null,
  created_at: "2026-09-17T10:05:00Z",
  started_at: "2026-09-17T10:05:01Z",
  finished_at: null,
};

/** Ultralytics `results.csv` shape (8.4); older versions pad the header cells with spaces. */
export const RESULTS_CSV = [
  "epoch,time,train/box_loss,train/cls_loss,train/dfl_loss,metrics/precision(B),metrics/recall(B),metrics/mAP50(B),metrics/mAP50-95(B),val/box_loss,val/cls_loss,val/dfl_loss,lr/pg0,lr/pg1,lr/pg2",
  "1,12.3,1.9,2.4,1.5,0.31,0.22,0.18,0.09,1.8,2.1,1.4,0.001,0.001,0.001",
  "2,24.1,1.6,1.9,1.4,0.52,0.41,0.45,0.24,1.5,1.7,1.3,0.001,0.001,0.001",
  "3,36.0,1.4,1.6,1.3,0.78,0.66,0.71,0.44,1.3,1.4,1.2,0.001,0.001,0.001",
].join("\n");
```

- [ ] **Step 2: Write the failing tests**

`frontend/src/api/paging.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { collectPages } from "./paging";

describe("collectPages", () => {
  it("follows next_cursor until null", async () => {
    const pages: Record<string, { items: { id: string }[]; next_cursor: string | null }> = {
      first: { items: [{ id: "a" }, { id: "b" }], next_cursor: "c2" },
      c2: { items: [{ id: "c" }], next_cursor: null },
    };
    const calls: (string | undefined)[] = [];
    const items = await collectPages(async (cursor) => {
      calls.push(cursor);
      return pages[cursor ?? "first"];
    });
    expect(items.map((i) => i.id)).toEqual(["a", "b", "c"]);
    expect(calls).toEqual([undefined, "c2"]);
  });

  it("stops on a repeated cursor and dedupes by id (the mock answers next_cursor: 'string')", async () => {
    let calls = 0;
    const items = await collectPages(async () => {
      calls += 1;
      return { items: [{ id: "a" }], next_cursor: "string" };
    });
    expect(items).toEqual([{ id: "a" }]);
    expect(calls).toBe(2);
  });

  it("stops after maxPages", async () => {
    let n = 0;
    const items = await collectPages(
      async () => {
        n += 1;
        return { items: [{ id: `i${n}` }], next_cursor: `c${n}` };
      },
      3,
    );
    expect(items).toHaveLength(3);
  });
});
```

`frontend/src/api/models.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { createApiClient } from "@contract/client";
import {
  errorBody,
  exampleModel,
  exampleTrainedModel,
  fakeClient,
  MODEL_ID,
  PROJECT_ID,
  RESULTS_CSV,
  runningJob,
  TRAINED_MODEL_ID,
} from "@/test/fixtures";
import {
  artifactUrl,
  deleteModel,
  exportModel,
  fetchAllModels,
  fetchModel,
  fetchResultsCsv,
  importModel,
  trainModel,
} from "./models";

describe("models api", () => {
  it("lists every page, gets one model and imports weights with aliases", async () => {
    const { api, requests } = fakeClient([
      {
        method: "GET",
        path: /\/models$/,
        body: { items: [exampleModel, exampleTrainedModel], next_cursor: null },
      },
      { method: "GET", path: /\/models\/[^/]+$/, body: exampleTrainedModel },
      { method: "POST", path: /\/models\/import$/, status: 201, body: exampleModel },
    ]);
    const models = await fetchAllModels(api, PROJECT_ID);
    expect(models.map((m) => m.id)).toEqual([MODEL_ID, TRAINED_MODEL_ID]);
    expect(requests[0].url).toBe(`/api/v1/projects/${PROJECT_ID}/models?limit=1000`);
    expect((await fetchModel(api, PROJECT_ID, TRAINED_MODEL_ID)).name).toBe("ahmadia-v1-n");
    const imported = await importModel(api, PROJECT_ID, {
      name: "yolo11m-coco",
      weights_path: "E:\\Dev\\Yolo\\models\\yolo11m.pt",
      class_aliases: { truck: "dump_truck" },
    });
    expect(imported.id).toBe(MODEL_ID);
    expect(requests[2]).toMatchObject({
      method: "POST",
      url: `/api/v1/projects/${PROJECT_ID}/models/import`,
      body: { name: "yolo11m-coco", weights_path: "E:\\Dev\\Yolo\\models\\yolo11m.pt", class_aliases: { truck: "dump_truck" } },
    });
  });

  it("starts training and export jobs, deletes a model", async () => {
    const { api, requests } = fakeClient([
      { method: "POST", path: /\/models\/train$/, status: 202, body: { job: runningJob } },
      { method: "POST", path: /\/export$/, status: 202, body: { job: { ...runningJob, type: "export" } } },
      { method: "DELETE", path: /\/models\/[^/]+$/, status: 204 },
    ]);
    const body = {
      name: "ahmadia-v1-n",
      dataset_id: "d",
      base_model_id: MODEL_ID,
      epochs: 3,
      imgsz: 1280,
      batch: null,
      patience: 50,
      augmentation: "aerial" as const,
      device: "0",
    };
    expect((await trainModel(api, PROJECT_ID, body)).id).toBe(runningJob.id);
    expect(requests[0].body).toEqual(body);
    const job = await exportModel(api, PROJECT_ID, MODEL_ID, { format: "onnx", imgsz: 1280, half: false });
    expect(job.type).toBe("export");
    expect(requests[1]).toMatchObject({
      url: `/api/v1/projects/${PROJECT_ID}/models/${MODEL_ID}/export`,
      body: { format: "onnx", imgsz: 1280, half: false },
    });
    await deleteModel(api, PROJECT_ID, MODEL_ID);
    expect(requests[2]).toMatchObject({ method: "DELETE", url: `/api/v1/projects/${PROJECT_ID}/models/${MODEL_ID}` });
  });

  it("builds artifact URLs with the token in the query and fetches results.csv as text", async () => {
    expect(artifactUrl("http://127.0.0.1:4010/", "tok en", PROJECT_ID, MODEL_ID, "pr_curve")).toBe(
      `http://127.0.0.1:4010/api/v1/projects/${PROJECT_ID}/models/${MODEL_ID}/artifacts/pr_curve?token=tok+en`,
    );
    const csvFetch: typeof fetch = async (input, init) => {
      const req = input instanceof Request ? input : new Request(input, init);
      expect(req.headers.get("Accept")).toBe("text/csv");
      expect(req.url).toContain(`/models/${TRAINED_MODEL_ID}/artifacts/results_csv`);
      return new Response(RESULTS_CSV, { status: 200, headers: { "Content-Type": "text/csv" } });
    };
    const api = createApiClient({ baseUrl: "http://fake", token: "t", fetch: csvFetch });
    expect(await fetchResultsCsv(api, PROJECT_ID, TRAINED_MODEL_ID)).toBe(RESULTS_CSV);
  });

  it("surfaces 501 as ApiFailure with code not_implemented", async () => {
    const { api } = fakeClient([
      { method: "GET", path: /\/models$/, status: 501, body: errorBody("not_implemented", "models arrive with S3") },
    ]);
    await expect(fetchAllModels(api, PROJECT_ID)).rejects.toMatchObject({ code: "not_implemented", status: 501 });
  });
});
```

`frontend/src/api/datasets.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { DATASET_ID, errorBody, exampleDataset, fakeClient, PROJECT_ID, runningJob } from "@/test/fixtures";
import { createDataset, fetchDataset, fetchDatasets, fetchDatasetStats } from "./datasets";

describe("datasets api", () => {
  it("lists, gets, reads stats and creates with the split parameters and seed", async () => {
    const stats = { image_count: 30, train_count: 24, val_count: 6, boxes_per_class: [], groups: [] };
    const { api, requests } = fakeClient([
      { method: "GET", path: /\/datasets$/, body: { items: [exampleDataset], next_cursor: null } },
      { method: "GET", path: /\/datasets\/[^/]+\/stats$/, body: stats },
      { method: "GET", path: /\/datasets\/[^/]+$/, body: exampleDataset },
      {
        method: "POST",
        path: /\/datasets$/,
        status: 202,
        body: { dataset: exampleDataset, job: { ...runningJob, type: "dataset" } },
      },
    ]);
    expect((await fetchDatasets(api, PROJECT_ID)).map((d) => d.name)).toEqual(["v1"]);
    expect((await fetchDatasetStats(api, PROJECT_ID, DATASET_ID)).train_count).toBe(24);
    expect((await fetchDataset(api, PROJECT_ID, DATASET_ID)).id).toBe(DATASET_ID);
    const created = await createDataset(api, PROJECT_ID, {
      name: "v2",
      split_method: "random",
      val_fraction: 0.3,
      seed: 7,
      image_ids: ["a", "b"],
    });
    expect(created.job.type).toBe("dataset");
    expect(requests[3]).toMatchObject({
      method: "POST",
      url: `/api/v1/projects/${PROJECT_ID}/datasets`,
      body: { name: "v2", split_method: "random", val_fraction: 0.3, seed: 7, image_ids: ["a", "b"] },
    });
  });

  it("surfaces 501 until S1 lands", async () => {
    const { api } = fakeClient([
      { method: "GET", path: /\/datasets$/, status: 501, body: errorBody("not_implemented", "S1 later") },
    ]);
    await expect(fetchDatasets(api, PROJECT_ID)).rejects.toMatchObject({ status: 501 });
  });
});
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `pnpm test src/api/paging.test.ts src/api/models.test.ts src/api/datasets.test.ts`
Expected: 3 files fail with `Failed to resolve import "./paging"` (and `./models`, `./datasets`).

- [ ] **Step 4: Implement `paging.ts`**

```ts
export interface Page<T> {
  items: T[];
  next_cursor: string | null;
}

/**
 * Follows `next_cursor` until it is null. Stops early when a cursor repeats (the Prism mock answers
 * `next_cursor: "string"` on every list page) or after `maxPages`, and dedupes items by id so a
 * repeated page never doubles the list.
 */
export async function collectPages<T extends { id: string }>(
  fetchPage: (cursor?: string) => Promise<Page<T>>,
  maxPages = 50,
): Promise<T[]> {
  const seenCursors = new Set<string>();
  const byId = new Map<string, T>();
  let cursor: string | undefined;
  for (let page = 0; page < maxPages; page += 1) {
    const result = await fetchPage(cursor);
    for (const item of result.items) if (!byId.has(item.id)) byId.set(item.id, item);
    const next = result.next_cursor;
    if (!next || seenCursors.has(next)) break;
    seenCursors.add(next);
    cursor = next;
  }
  return [...byId.values()];
}
```

- [ ] **Step 5: Implement `models.ts`**

```ts
import type { ApiClient, Job, Model, TrainRequest, components } from "@contract/client";
import { unwrap } from "./errors";
import { collectPages } from "./paging";

export type Artifact = "results_csv" | "confusion_matrix" | "pr_curve";
export type ModelImport = components["schemas"]["ModelImport"];
export type ExportRequest = components["schemas"]["ExportRequest"];
export type ExportFormat = ExportRequest["format"];

const LIST_LIMIT = 1000;

/** Every registry model, newest first as the backend orders them. */
export function fetchAllModels(api: ApiClient, projectId: string): Promise<Model[]> {
  return collectPages((cursor) =>
    unwrap(
      api.GET("/api/v1/projects/{projectId}/models", {
        params: { path: { projectId }, query: cursor ? { limit: LIST_LIMIT, cursor } : { limit: LIST_LIMIT } },
      }),
    ),
  );
}

export function fetchModel(api: ApiClient, projectId: string, modelId: string): Promise<Model> {
  return unwrap(
    api.GET("/api/v1/projects/{projectId}/models/{modelId}", { params: { path: { projectId, modelId } } }),
  );
}

export function importModel(api: ApiClient, projectId: string, body: ModelImport): Promise<Model> {
  return unwrap(api.POST("/api/v1/projects/{projectId}/models/import", { params: { path: { projectId } }, body }));
}

/** 202 with the training job; the model row appears when the job succeeds (`job.result.model_id`). */
export async function trainModel(api: ApiClient, projectId: string, body: TrainRequest): Promise<Job> {
  const r = await unwrap(
    api.POST("/api/v1/projects/{projectId}/models/train", { params: { path: { projectId } }, body }),
  );
  return r.job;
}

export async function exportModel(
  api: ApiClient,
  projectId: string,
  modelId: string,
  body: ExportRequest,
): Promise<Job> {
  const r = await unwrap(
    api.POST("/api/v1/projects/{projectId}/models/{modelId}/export", {
      params: { path: { projectId, modelId } },
      body,
    }),
  );
  return r.job;
}

export async function deleteModel(api: ApiClient, projectId: string, modelId: string): Promise<void> {
  await unwrap<unknown>(
    api.DELETE("/api/v1/projects/{projectId}/models/{modelId}", { params: { path: { projectId, modelId } } }),
  );
}

/** For `<img src>`: the token goes in the query because images cannot send headers (like `imageFileUrl`). */
export function artifactUrl(
  baseUrl: string,
  token: string,
  projectId: string,
  modelId: string,
  artifact: Artifact,
): string {
  const base = baseUrl.replace(/\/$/, "");
  const q = new URLSearchParams({ token });
  return `${base}/api/v1/projects/${projectId}/models/${modelId}/artifacts/${artifact}?${q}`;
}

/** The raw `results.csv` text; `Accept: text/csv` because the endpoint also serves PNG artifacts. */
export function fetchResultsCsv(api: ApiClient, projectId: string, modelId: string): Promise<string> {
  return unwrap(
    api.GET("/api/v1/projects/{projectId}/models/{modelId}/artifacts/{artifact}", {
      params: { path: { projectId, modelId, artifact: "results_csv" } },
      parseAs: "text",
      headers: { Accept: "text/csv" },
    }),
  );
}
```

- [ ] **Step 6: Implement `datasets.ts`**

```ts
import type { ApiClient, Dataset, DatasetStats, components } from "@contract/client";
import { unwrap } from "./errors";
import { collectPages } from "./paging";

export type DatasetCreate = components["schemas"]["DatasetCreate"];
export type DatasetWithJob = components["schemas"]["DatasetWithJob"];
export type SplitMethod = components["schemas"]["SplitMethod"];

const LIST_LIMIT = 1000;

export function fetchDatasets(api: ApiClient, projectId: string): Promise<Dataset[]> {
  return collectPages((cursor) =>
    unwrap(
      api.GET("/api/v1/projects/{projectId}/datasets", {
        params: { path: { projectId }, query: cursor ? { limit: LIST_LIMIT, cursor } : { limit: LIST_LIMIT } },
      }),
    ),
  );
}

export function fetchDataset(api: ApiClient, projectId: string, datasetId: string): Promise<Dataset> {
  return unwrap(
    api.GET("/api/v1/projects/{projectId}/datasets/{datasetId}", { params: { path: { projectId, datasetId } } }),
  );
}

export function fetchDatasetStats(api: ApiClient, projectId: string, datasetId: string): Promise<DatasetStats> {
  return unwrap(
    api.GET("/api/v1/projects/{projectId}/datasets/{datasetId}/stats", {
      params: { path: { projectId, datasetId } },
    }),
  );
}

/** 202: the dataset row plus its materialise job. `seed` and `val_fraction` are required by the generated client. */
export function createDataset(api: ApiClient, projectId: string, body: DatasetCreate): Promise<DatasetWithJob> {
  return unwrap(api.POST("/api/v1/projects/{projectId}/datasets", { params: { path: { projectId } }, body }));
}
```

- [ ] **Step 7: Run the tests to verify they pass**

Run: `pnpm test src/api/paging.test.ts src/api/models.test.ts src/api/datasets.test.ts`
Expected: 3 files, 9 tests passed. If `tsc` complains about `parseAs: "text"` typing on `fetchResultsCsv`, wrap the call: `unwrap(api.GET(...) as Promise<{ data?: string; error?: unknown; response: Response }>)`.

- [ ] **Step 8: Format, lint, type-check and commit**

Run: `pnpm format && pnpm lint && pnpm exec tsc -b`
Expected: prettier rewrites at most the new files, eslint clean, tsc silent.

```bash
git add src/test/fixtures.ts src/api/paging.ts src/api/paging.test.ts src/api/models.ts src/api/models.test.ts src/api/datasets.ts src/api/datasets.test.ts
git commit -m "feat(ui): models and datasets api wrappers with page collector"
```

---

### Task 2: Providers, query-runs and jobs API wrappers

**Files:**
- Create: `frontend/src/api/providers.ts`, `frontend/src/api/queryRuns.ts`, `frontend/src/api/jobs.ts`
- Test: `frontend/src/api/providers.test.ts`, `frontend/src/api/queryRuns.test.ts`, `frontend/src/api/jobs.test.ts`

**Interfaces:**
- Consumes: `unwrap`, `collectPages`, fixtures from Task 1.
- Produces:
  - `providers.ts`: `type ProviderUpdate`, `type ProviderTestResult`, `fetchProviders(api): Promise<Provider[]>`, `updateProvider(api, name: ProviderName, patch: ProviderUpdate): Promise<Provider>`, `setProviderKey(api, name, apiKey: string): Promise<void>`, `deleteProviderKey(api, name): Promise<void>`, `testProvider(api, name): Promise<ProviderTestResult>`.
  - `queryRuns.ts`: `DEFAULT_TILING: Tiling`, `DEFAULT_CONF = 0.25`, `type QueryRunWithJob`, `type PromoteResult`, `estimateQueryRun(api, projectId, body: QueryRunCreate): Promise<CostEstimate>`, `createQueryRun(api, projectId, body): Promise<QueryRunWithJob>`, `fetchQueryRuns(api, projectId): Promise<QueryRun[]>`, `fetchQueryRun(api, projectId, runId): Promise<QueryRun>`, `promoteQueryRun(api, projectId, runId, minConfidence: number): Promise<PromoteResult>`.
  - `jobs.ts`: `type ListJobsQuery`, `JOB_LIST_LIMIT = 100`, `fetchJobs(api, projectId, query?: ListJobsQuery): Promise<Job[]>` (one page, newest first), `fetchJob(api, projectId, jobId): Promise<Job>`, `cancelJob(api, projectId, jobId): Promise<Job>`, `fetchJobLog(api, projectId, jobId, tail = 200): Promise<JobLog>`.

- [ ] **Step 1: Write the failing tests**

`frontend/src/api/providers.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { errorBody, exampleProviders, fakeClient } from "@/test/fixtures";
import { deleteProviderKey, fetchProviders, setProviderKey, testProvider, updateProvider } from "./providers";

describe("providers api", () => {
  it("lists, patches, stores and removes a key, and tests", async () => {
    const { api, requests } = fakeClient([
      { method: "GET", path: /\/providers$/, body: { items: exampleProviders } },
      { method: "PATCH", path: /\/providers\/anthropic$/, body: { ...exampleProviders[1], requests_per_minute: 10 } },
      { method: "PUT", path: /\/providers\/openai\/key$/, status: 204 },
      { method: "DELETE", path: /\/providers\/openai\/key$/, status: 204 },
      {
        method: "POST",
        path: /\/providers\/anthropic\/test$/,
        body: { ok: true, message: "responded in 1.2 s", model_name: "claude-opus-5" },
      },
    ]);
    expect((await fetchProviders(api)).map((p) => p.name)).toEqual(["openai", "anthropic"]);
    expect((await updateProvider(api, "anthropic", { requests_per_minute: 10 })).requests_per_minute).toBe(10);
    await setProviderKey(api, "openai", "sk-test");
    await deleteProviderKey(api, "openai");
    expect((await testProvider(api, "anthropic")).ok).toBe(true);
    expect(requests[1]).toMatchObject({ method: "PATCH", url: "/api/v1/providers/anthropic", body: { requests_per_minute: 10 } });
    expect(requests[2]).toMatchObject({ method: "PUT", url: "/api/v1/providers/openai/key", body: { api_key: "sk-test" } });
    expect(requests[3]).toMatchObject({ method: "DELETE", url: "/api/v1/providers/openai/key", body: null });
    expect(requests[4]).toMatchObject({ method: "POST", url: "/api/v1/providers/anthropic/test" });
  });

  it("surfaces 501 until S4 lands", async () => {
    const { api } = fakeClient([
      { method: "GET", path: /\/providers$/, status: 501, body: errorBody("not_implemented", "providers arrive with S4") },
    ]);
    await expect(fetchProviders(api)).rejects.toMatchObject({ code: "not_implemented", status: 501 });
  });
});
```

`frontend/src/api/queryRuns.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import {
  errorBody,
  exampleEstimate,
  exampleQueryRun,
  fakeClient,
  IMAGE_ID,
  PROJECT_ID,
  RUN_ID,
  runningJob,
} from "@/test/fixtures";
import {
  createQueryRun,
  DEFAULT_TILING,
  estimateQueryRun,
  fetchQueryRun,
  fetchQueryRuns,
  promoteQueryRun,
} from "./queryRuns";

describe("query runs api", () => {
  it("estimates, creates, lists, gets and promotes", async () => {
    const { api, requests } = fakeClient([
      { method: "POST", path: /\/query-runs\/estimate$/, body: exampleEstimate },
      { method: "POST", path: /\/query-runs$/, status: 202, body: { query_run: exampleQueryRun, job: runningJob } },
      { method: "GET", path: /\/query-runs$/, body: { items: [exampleQueryRun], next_cursor: null } },
      {
        method: "POST",
        path: /\/promote$/,
        body: { query_run: { ...exampleQueryRun, promoted_at: "2026-09-17T13:30:00Z" }, accepted: 6 },
      },
      { method: "GET", path: /\/query-runs\/[^/]+$/, body: exampleQueryRun },
    ]);
    const body = {
      kind: "cloud_provider" as const,
      provider: "anthropic" as const,
      query: "dump trucks",
      image_ids: [IMAGE_ID],
      tiling: DEFAULT_TILING,
      conf: 0.25,
    };
    expect((await estimateQueryRun(api, PROJECT_ID, body)).estimated_cost).toBe(0.8);
    expect(requests[0]).toMatchObject({ url: `/api/v1/projects/${PROJECT_ID}/query-runs/estimate`, body });
    const created = await createQueryRun(api, PROJECT_ID, body);
    expect(created.query_run.id).toBe(RUN_ID);
    expect(created.job.id).toBe(runningJob.id);
    expect(requests[1].body).toEqual(body);
    expect((await fetchQueryRuns(api, PROJECT_ID)).map((r) => r.id)).toEqual([RUN_ID]);
    expect((await fetchQueryRun(api, PROJECT_ID, RUN_ID)).query).toBe("dump trucks");
    const promoted = await promoteQueryRun(api, PROJECT_ID, RUN_ID, 0.5);
    expect(promoted.accepted).toBe(6);
    expect(requests[4]).toMatchObject({
      method: "POST",
      url: `/api/v1/projects/${PROJECT_ID}/query-runs/${RUN_ID}/promote`,
      body: { min_confidence: 0.5 },
    });
  });

  it("surfaces 501 until S4 lands", async () => {
    const { api } = fakeClient([
      { method: "POST", path: /\/estimate$/, status: 501, body: errorBody("not_implemented", "query runs arrive with S4") },
    ]);
    await expect(
      estimateQueryRun(api, PROJECT_ID, { kind: "local_model", model_id: "m", image_ids: ["a"], conf: 0.25 }),
    ).rejects.toMatchObject({ code: "not_implemented" });
  });
});
```

`frontend/src/api/jobs.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { errorBody, exampleJobLog, fakeClient, JOB_ID, PROJECT_ID, runningJob } from "@/test/fixtures";
import { cancelJob, fetchJob, fetchJobLog, fetchJobs } from "./jobs";

describe("jobs api", () => {
  it("lists one page newest first, gets, cancels and tails the log", async () => {
    const { api, requests } = fakeClient([
      { method: "GET", path: /\/jobs$/, body: { items: [runningJob], next_cursor: "string" } },
      { method: "GET", path: /\/jobs\/[^/]+\/log$/, body: exampleJobLog },
      { method: "GET", path: /\/jobs\/[^/]+$/, body: runningJob },
      { method: "POST", path: /\/cancel$/, body: { ...runningJob, state: "cancelled" } },
    ]);
    expect((await fetchJobs(api, PROJECT_ID)).map((j) => j.id)).toEqual([JOB_ID]);
    expect(requests[0].url).toBe(`/api/v1/projects/${PROJECT_ID}/jobs?limit=100`);
    await fetchJobs(api, PROJECT_ID, { state: "running", type: "train" });
    const url = new URL(`http://x${requests[1].url}`);
    expect(url.searchParams.get("state")).toBe("running");
    expect(url.searchParams.get("type")).toBe("train");
    expect((await fetchJob(api, PROJECT_ID, JOB_ID)).progress).toBe(0.42);
    expect((await cancelJob(api, PROJECT_ID, JOB_ID)).state).toBe("cancelled");
    expect(requests[3]).toMatchObject({ method: "POST", url: `/api/v1/projects/${PROJECT_ID}/jobs/${JOB_ID}/cancel` });
    const log = await fetchJobLog(api, PROJECT_ID, JOB_ID, 50);
    expect(log.lines).toHaveLength(2);
    expect(requests[4].url).toBe(`/api/v1/projects/${PROJECT_ID}/jobs/${JOB_ID}/log?tail=50`);
  });

  it("propagates the envelope message on failure", async () => {
    const { api } = fakeClient([
      { method: "GET", path: /\/jobs\/[^/]+$/, status: 404, body: errorBody("not_found", "job j1 not found") },
    ]);
    await expect(fetchJob(api, PROJECT_ID, "j1")).rejects.toMatchObject({ code: "not_found", message: "job j1 not found" });
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm test src/api/providers.test.ts src/api/queryRuns.test.ts src/api/jobs.test.ts`
Expected: 3 files fail with unresolved imports.

- [ ] **Step 3: Implement `providers.ts`**

```ts
import type { ApiClient, Provider, ProviderName, components } from "@contract/client";
import { unwrap } from "./errors";

export type ProviderUpdate = components["schemas"]["ProviderUpdate"];
export type ProviderTestResult = components["schemas"]["ProviderTestResult"];

/** Keys are never returned: `has_key` says whether Credential Manager holds one. 501 until S4 lands. */
export async function fetchProviders(api: ApiClient): Promise<Provider[]> {
  const r = await unwrap(api.GET("/api/v1/providers"));
  return r.items;
}

export function updateProvider(api: ApiClient, provider: ProviderName, patch: ProviderUpdate): Promise<Provider> {
  return unwrap(api.PATCH("/api/v1/providers/{provider}", { params: { path: { provider } }, body: patch }));
}

/** The key travels once, in this request body; callers must drop it from state afterwards. Never log it. */
export async function setProviderKey(api: ApiClient, provider: ProviderName, apiKey: string): Promise<void> {
  await unwrap<unknown>(
    api.PUT("/api/v1/providers/{provider}/key", { params: { path: { provider } }, body: { api_key: apiKey } }),
  );
}

export async function deleteProviderKey(api: ApiClient, provider: ProviderName): Promise<void> {
  await unwrap<unknown>(api.DELETE("/api/v1/providers/{provider}/key", { params: { path: { provider } } }));
}

export function testProvider(api: ApiClient, provider: ProviderName): Promise<ProviderTestResult> {
  return unwrap(api.POST("/api/v1/providers/{provider}/test", { params: { path: { provider } } }));
}
```

- [ ] **Step 4: Implement `queryRuns.ts`**

```ts
import type { ApiClient, CostEstimate, QueryRun, QueryRunCreate, Tiling, components } from "@contract/client";
import { unwrap } from "./errors";
import { collectPages } from "./paging";

export type QueryRunWithJob = components["schemas"]["QueryRunWithJob"];
export type PromoteResult = components["schemas"]["PromoteResult"];

/** Spec section 8 defaults; every field is required by the generated client. */
export const DEFAULT_TILING: Tiling = { enabled: true, tile_size: 1280, overlap: 0.2, nms_iou: 0.5 };
export const DEFAULT_CONF = 0.25;

const LIST_LIMIT = 1000;

export function estimateQueryRun(api: ApiClient, projectId: string, body: QueryRunCreate): Promise<CostEstimate> {
  return unwrap(
    api.POST("/api/v1/projects/{projectId}/query-runs/estimate", { params: { path: { projectId } }, body }),
  );
}

export function createQueryRun(api: ApiClient, projectId: string, body: QueryRunCreate): Promise<QueryRunWithJob> {
  return unwrap(api.POST("/api/v1/projects/{projectId}/query-runs", { params: { path: { projectId } }, body }));
}

export function fetchQueryRuns(api: ApiClient, projectId: string): Promise<QueryRun[]> {
  return collectPages((cursor) =>
    unwrap(
      api.GET("/api/v1/projects/{projectId}/query-runs", {
        params: { path: { projectId }, query: cursor ? { limit: LIST_LIMIT, cursor } : { limit: LIST_LIMIT } },
      }),
    ),
  );
}

export function fetchQueryRun(api: ApiClient, projectId: string, runId: string): Promise<QueryRun> {
  return unwrap(
    api.GET("/api/v1/projects/{projectId}/query-runs/{runId}", { params: { path: { projectId, runId } } }),
  );
}

/** Accept the run's unreviewed boxes at or above `minConfidence` (a state change, not a copy). */
export function promoteQueryRun(
  api: ApiClient,
  projectId: string,
  runId: string,
  minConfidence: number,
): Promise<PromoteResult> {
  return unwrap(
    api.POST("/api/v1/projects/{projectId}/query-runs/{runId}/promote", {
      params: { path: { projectId, runId } },
      body: { min_confidence: minConfidence },
    }),
  );
}
```

- [ ] **Step 5: Implement `jobs.ts`**

```ts
import type { ApiClient, Job, JobLog, paths } from "@contract/client";
import { unwrap } from "./errors";

export type ListJobsQuery = NonNullable<paths["/api/v1/projects/{projectId}/jobs"]["get"]["parameters"]["query"]>;

export const JOB_LIST_LIMIT = 100;

/** One page, newest first; the panel shows the last 100 jobs. */
export async function fetchJobs(api: ApiClient, projectId: string, query: ListJobsQuery = {}): Promise<Job[]> {
  const r = await unwrap(
    api.GET("/api/v1/projects/{projectId}/jobs", {
      params: { path: { projectId }, query: { limit: JOB_LIST_LIMIT, ...query } },
    }),
  );
  return r.items;
}

export function fetchJob(api: ApiClient, projectId: string, jobId: string): Promise<Job> {
  return unwrap(api.GET("/api/v1/projects/{projectId}/jobs/{jobId}", { params: { path: { projectId, jobId } } }));
}

/** Requests cancellation; the returned job may still be `running` until the worker notices. */
export function cancelJob(api: ApiClient, projectId: string, jobId: string): Promise<Job> {
  return unwrap(
    api.POST("/api/v1/projects/{projectId}/jobs/{jobId}/cancel", { params: { path: { projectId, jobId } } }),
  );
}

export function fetchJobLog(api: ApiClient, projectId: string, jobId: string, tail = 200): Promise<JobLog> {
  return unwrap(
    api.GET("/api/v1/projects/{projectId}/jobs/{jobId}/log", {
      params: { path: { projectId, jobId }, query: { tail } },
    }),
  );
}
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `pnpm test src/api`
Expected: every `src/api` file green (S2's 5 plus the 6 new ones).

- [ ] **Step 7: Format, lint, type-check and commit**

Run: `pnpm format && pnpm lint && pnpm exec tsc -b`

```bash
git add src/api/providers.ts src/api/providers.test.ts src/api/queryRuns.ts src/api/queryRuns.test.ts src/api/jobs.ts src/api/jobs.test.ts
git commit -m "feat(ui): providers, query-runs and jobs api wrappers"
```

---

### Task 3: Jobs store extensions and polling hooks

**Files:**
- Modify: `frontend/src/store/jobs.ts` (replace the file with the version below; `App.tsx` keeps calling `applyEvent(ev)` unchanged)
- Create: `frontend/src/jobs/jobLabels.ts`, `frontend/src/jobs/useNow.ts`, `frontend/src/jobs/useTrackedJob.ts`, `frontend/src/jobs/useJobLog.ts`, `frontend/src/jobs/useJobList.ts`
- Test: `frontend/src/store/jobs.test.ts` (replace), `frontend/src/jobs/jobLabels.test.ts`, `frontend/src/jobs/useTrackedJob.test.tsx`, `frontend/src/jobs/useJobLog.test.tsx`

**Interfaces:**
- Consumes: `fetchJob`, `fetchJobs`, `fetchJobLog` (Task 2), `useApi`, `pushLog`, `messageOf`.
- Produces:
  - `store/jobs.ts`: `ACTIVE_STATES: ReadonlySet<JobState>`, `isActiveJob(job: Job): boolean`, `interface JobsState {jobs: Record<string, Job>; panelOpen: boolean; upsert(job): void; upsertMany(jobs: Job[]): void; setPanelOpen(open: boolean): void; applyEvent(ev: AppEvent, nowIso?: string): void; active(): Job[]}`, `useJobsStore`, `selectActiveCount(s: JobsState): number`. `applyEvent` on `job.state` merges `payload` (`{state, result, error}`), sets `progress` to 1 on `succeeded`, and stamps `finished_at` (with `nowIso`, default `new Date().toISOString()`) when the new state is terminal and `finished_at` was null.
  - `jobs/jobLabels.ts`: `jobTitle(job): string` ("Training: ahmadia-v1-n" when `params.name` is a string, else "Training" / "Import" / "Dataset" / "Query run" / "Export"), `stateLabel(state): string`, `elapsedSeconds(job, nowMs): number | null`, `formatDuration(seconds): string` ("42 s", "3 min 05 s", "1 h 02 min"), `interface ResultTarget {label: string; to: string}`, `resultTarget(job, projectId): ResultTarget | null` (succeeded only: train -> `/p/{p}/models?model={result.model_id}`, infer -> `/p/{p}/query?run={result.query_run_id}`, export -> `/p/{p}/models?model={params.model_id}`, dataset -> `/p/{p}/train`, import -> `/p/{p}/data`).
  - `jobs/useNow.ts`: `useNow(intervalMs = 1000, enabled = true): number` (ticking `Date.now()`).
  - `jobs/useTrackedJob.ts`: `JOB_POLL_MS = 2000`, `useTrackedJob(projectId: string, jobId: string | null): Job | null` (the store's job; polled with `fetchJob` every 2 s while unknown or active, each answer `upsert`ed).
  - `jobs/useJobLog.ts`: `LOG_POLL_MS = 2000`, `useJobLog(projectId, jobId: string | null, live: boolean, tail = 200): {lines: string[]; error: string | null}` (fetched once on mount/jobId change, every 2 s while `live`).
  - `jobs/useJobList.ts`: `LIST_POLL_MS = 5000`, `useJobList(projectId, enabled: boolean): {loading: boolean; error: string | null; reload(): void}` (loads `fetchJobs` into the store with `upsertMany` when enabled and every 5 s while enabled).

- [ ] **Step 1: Write the failing tests**

Replace `frontend/src/store/jobs.test.ts` with:

```ts
import { describe, it, expect, beforeEach } from "vitest";
import type { Job } from "@contract/client";
import { isActiveJob, selectActiveCount, useJobsStore } from "./jobs";

const job = {
  id: "j1",
  project_id: "p",
  type: "train",
  state: "queued",
  progress: 0,
  message: "",
  log_path: "runs/j1/job.log",
  params: {},
  result: null,
  error: null,
  created_at: "2026-09-17T00:00:00Z",
  started_at: null,
  finished_at: null,
} satisfies Job;

describe("jobs store", () => {
  beforeEach(() => {
    useJobsStore.setState({ jobs: {}, panelOpen: false });
  });

  it("applies progress and state events", () => {
    const s = useJobsStore.getState();
    s.upsert(job);
    s.applyEvent({ type: "job.progress", project_id: "p", job_id: "j1", progress: 0.5, message: "half", payload: {} });
    expect(useJobsStore.getState().jobs.j1.progress).toBe(0.5);
    expect(useJobsStore.getState().jobs.j1.message).toBe("half");
    expect(useJobsStore.getState().active().map((j) => j.id)).toEqual(["j1"]);
    expect(selectActiveCount(useJobsStore.getState())).toBe(1);
    s.applyEvent(
      {
        type: "job.state",
        project_id: "p",
        job_id: "j1",
        progress: null,
        message: "",
        payload: { state: "succeeded", result: { model_id: "m9" }, error: null },
      },
      "2026-09-17T00:10:00Z",
    );
    const done = useJobsStore.getState().jobs.j1;
    expect(done.state).toBe("succeeded");
    expect(done.progress).toBe(1);
    expect(done.result).toEqual({ model_id: "m9" });
    expect(done.finished_at).toBe("2026-09-17T00:10:00Z");
    expect(isActiveJob(done)).toBe(false);
    expect(useJobsStore.getState().active()).toEqual([]);
  });

  it("keeps a failed job's error and does not overwrite an existing finished_at", () => {
    useJobsStore.getState().upsert({ ...job, state: "running", finished_at: null });
    useJobsStore.getState().applyEvent(
      { type: "job.state", project_id: "p", job_id: "j1", progress: 0.3, message: "", payload: { state: "failed", error: "boom" } },
      "2026-09-17T00:05:00Z",
    );
    const failed = useJobsStore.getState().jobs.j1;
    expect(failed).toMatchObject({ state: "failed", error: "boom", progress: 0.3, finished_at: "2026-09-17T00:05:00Z" });
    useJobsStore.getState().applyEvent(
      { type: "job.state", project_id: "p", job_id: "j1", progress: null, message: "", payload: { state: "failed" } },
      "2026-09-17T00:06:00Z",
    );
    expect(useJobsStore.getState().jobs.j1.finished_at).toBe("2026-09-17T00:05:00Z");
  });

  it("ignores events for unknown jobs, merges lists and toggles the panel", () => {
    useJobsStore.getState().applyEvent({ type: "job.progress", project_id: "p", job_id: "missing", progress: 0.5, message: "half", payload: {} });
    expect(useJobsStore.getState().jobs).toEqual({});
    useJobsStore.getState().upsertMany([job, { ...job, id: "j2" }]);
    useJobsStore.getState().upsertMany([{ ...job, id: "j2", state: "running" }]);
    expect(Object.keys(useJobsStore.getState().jobs).sort()).toEqual(["j1", "j2"]);
    expect(useJobsStore.getState().jobs.j2.state).toBe("running");
    useJobsStore.getState().setPanelOpen(true);
    expect(useJobsStore.getState().panelOpen).toBe(true);
  });
});
```

`frontend/src/jobs/jobLabels.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { runningJob } from "@/test/fixtures";
import { elapsedSeconds, formatDuration, jobTitle, resultTarget, stateLabel } from "./jobLabels";

describe("job labels", () => {
  it("titles jobs by type and name", () => {
    expect(jobTitle(runningJob)).toBe("Import");
    expect(jobTitle({ ...runningJob, type: "train", params: { name: "ahmadia-v1-n" } })).toBe("Training: ahmadia-v1-n");
    expect(jobTitle({ ...runningJob, type: "infer" })).toBe("Query run");
    expect(stateLabel("cancelled")).toBe("Cancelled");
  });

  it("computes elapsed time from started_at to now or finished_at", () => {
    const now = Date.parse("2026-09-17T10:06:31Z");
    expect(elapsedSeconds(runningJob, now)).toBe(90);
    expect(elapsedSeconds({ ...runningJob, finished_at: "2026-09-17T10:05:43Z" }, now)).toBe(42);
    expect(elapsedSeconds({ ...runningJob, started_at: null }, now)).toBeNull();
    expect(formatDuration(42)).toBe("42 s");
    expect(formatDuration(185)).toBe("3 min 05 s");
    expect(formatDuration(3720)).toBe("1 h 02 min");
  });

  it("links a finished job to what it produced", () => {
    expect(resultTarget(runningJob, "p")).toBeNull();
    expect(resultTarget({ ...runningJob, type: "train", state: "succeeded", result: { model_id: "m9" } }, "p")).toEqual({
      label: "Open model",
      to: "/p/p/models?model=m9",
    });
    expect(
      resultTarget({ ...runningJob, type: "infer", state: "succeeded", result: { query_run_id: "q1", boxes: 3 } }, "p"),
    ).toEqual({ label: "Open run", to: "/p/p/query?run=q1" });
    expect(
      resultTarget(
        {
          ...runningJob,
          type: "export",
          state: "succeeded",
          params: { model_id: "m1", format: "onnx" },
          result: { format: "onnx", path: "models/x.onnx" },
        },
        "p",
      ),
    ).toEqual({ label: "Open model", to: "/p/p/models?model=m1" });
    expect(resultTarget({ ...runningJob, type: "dataset", state: "succeeded", result: { dataset_id: "d1" } }, "p")).toEqual({
      label: "Train on it",
      to: "/p/p/train",
    });
    expect(resultTarget({ ...runningJob, type: "train", state: "succeeded", result: null }, "p")).toBeNull();
  });
});
```

`frontend/src/jobs/useTrackedJob.test.tsx`:

```tsx
import type { ReactNode } from "react";
import { describe, it, expect, beforeEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { fakeClient, JOB_ID, PROJECT_ID, runningJob } from "@/test/fixtures";
import { TestApiProvider } from "@/test/render";
import { useJobsStore } from "@/store/jobs";
import { useTrackedJob } from "./useTrackedJob";

describe("useTrackedJob", () => {
  beforeEach(() => useJobsStore.setState({ jobs: {}, panelOpen: false }));

  it("fetches an unknown job into the store and returns it", async () => {
    const { api, requests } = fakeClient([{ method: "GET", path: /\/jobs\/[^/]+$/, body: runningJob }]);
    const wrapper = ({ children }: { children: ReactNode }) => <TestApiProvider api={api}>{children}</TestApiProvider>;
    const { result } = renderHook(() => useTrackedJob(PROJECT_ID, JOB_ID), { wrapper });
    expect(result.current).toBeNull();
    await waitFor(() => expect(result.current?.progress).toBe(0.42));
    expect(requests[0].url).toBe(`/api/v1/projects/${PROJECT_ID}/jobs/${JOB_ID}`);
    expect(useJobsStore.getState().jobs[JOB_ID].state).toBe("running");
  });

  it("does not poll a finished job", async () => {
    const { api, requests } = fakeClient([{ method: "GET", path: /\/jobs\/[^/]+$/, body: runningJob }]);
    useJobsStore.getState().upsert({ ...runningJob, state: "succeeded", finished_at: "2026-09-17T11:00:00Z" });
    const wrapper = ({ children }: { children: ReactNode }) => <TestApiProvider api={api}>{children}</TestApiProvider>;
    const { result } = renderHook(() => useTrackedJob(PROJECT_ID, JOB_ID), { wrapper });
    expect(result.current?.state).toBe("succeeded");
    await new Promise((r) => setTimeout(r, 20));
    expect(requests).toHaveLength(0);
  });
});
```

`frontend/src/jobs/useJobLog.test.tsx`:

```tsx
import type { ReactNode } from "react";
import { describe, it, expect } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { errorBody, exampleJobLog, fakeClient, JOB_ID, PROJECT_ID } from "@/test/fixtures";
import { TestApiProvider } from "@/test/render";
import { useJobLog } from "./useJobLog";

describe("useJobLog", () => {
  it("loads the tail once when not live and reports errors", async () => {
    const { api, requests } = fakeClient([{ method: "GET", path: /\/log$/, body: exampleJobLog }]);
    const wrapper = ({ children }: { children: ReactNode }) => <TestApiProvider api={api}>{children}</TestApiProvider>;
    const { result } = renderHook(() => useJobLog(PROJECT_ID, JOB_ID, false, 50), { wrapper });
    await waitFor(() => expect(result.current.lines).toHaveLength(2));
    expect(requests[0].url).toBe(`/api/v1/projects/${PROJECT_ID}/jobs/${JOB_ID}/log?tail=50`);
    await new Promise((r) => setTimeout(r, 20));
    expect(requests).toHaveLength(1);

    const failing = fakeClient([{ method: "GET", path: /\/log$/, status: 404, body: errorBody("not_found", "no log yet") }]);
    const wrapper2 = ({ children }: { children: ReactNode }) => (
      <TestApiProvider api={failing.api}>{children}</TestApiProvider>
    );
    const bad = renderHook(() => useJobLog(PROJECT_ID, JOB_ID, false), { wrapper: wrapper2 });
    await waitFor(() => expect(bad.result.current.error).toBe("no log yet"));
    expect(bad.result.current.lines).toEqual([]);
  });

  it("returns nothing without a job id", () => {
    const { api } = fakeClient([]);
    const wrapper = ({ children }: { children: ReactNode }) => <TestApiProvider api={api}>{children}</TestApiProvider>;
    const { result } = renderHook(() => useJobLog(PROJECT_ID, null, true), { wrapper });
    expect(result.current).toEqual({ lines: [], error: null });
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm test src/store/jobs.test.ts src/jobs`
Expected: `jobs.test.ts` fails on `selectActiveCount`/`isActiveJob`/`upsertMany` being undefined; the three `src/jobs` files fail on unresolved imports.

- [ ] **Step 3: Replace `store/jobs.ts`**

```ts
import { create } from "zustand";
import type { AppEvent, Job, JobState } from "@contract/client";

export const ACTIVE_STATES: ReadonlySet<JobState> = new Set<JobState>(["queued", "running"]);

export function isActiveJob(job: Job): boolean {
  return ACTIVE_STATES.has(job.state);
}

export interface JobsState {
  jobs: Record<string, Job>;
  /** The global jobs slide-over (Shell). */
  panelOpen: boolean;
  upsert: (job: Job) => void;
  upsertMany: (jobs: Job[]) => void;
  setPanelOpen: (open: boolean) => void;
  /** `nowIso` stamps `finished_at` on terminal `job.state` events (injected by tests). */
  applyEvent: (ev: AppEvent, nowIso?: string) => void;
  active: () => Job[];
}

export const selectActiveCount = (s: JobsState): number => Object.values(s.jobs).filter(isActiveJob).length;

export const useJobsStore = create<JobsState>((set, get) => ({
  jobs: {},
  panelOpen: false,
  upsert: (job) => set((s) => ({ jobs: { ...s.jobs, [job.id]: job } })),
  upsertMany: (jobs) =>
    set((s) => {
      const next = { ...s.jobs };
      for (const job of jobs) next[job.id] = job;
      return { jobs: next };
    }),
  setPanelOpen: (open) => set({ panelOpen: open }),
  applyEvent: (ev, nowIso = new Date().toISOString()) =>
    set((s) => {
      const id = ev.job_id;
      if (!id || !s.jobs[id]) return s;
      const cur = s.jobs[id];
      if (ev.type === "job.progress") {
        return {
          jobs: {
            ...s.jobs,
            [id]: { ...cur, progress: ev.progress ?? cur.progress, message: ev.message ?? cur.message },
          },
        };
      }
      if (ev.type === "job.state") {
        const patch = (ev.payload ?? {}) as Partial<Job>;
        const state = patch.state ?? cur.state;
        const terminal = !ACTIVE_STATES.has(state);
        const next: Job = {
          ...cur,
          ...patch,
          state,
          progress: state === "succeeded" ? 1 : (ev.progress ?? cur.progress),
          finished_at: cur.finished_at ?? (terminal ? nowIso : null),
        };
        return { jobs: { ...s.jobs, [id]: next } };
      }
      return s;
    }),
  active: () => Object.values(get().jobs).filter(isActiveJob),
}));
```

- [ ] **Step 4: Implement `jobLabels.ts`**

```ts
import type { Job, JobState } from "@contract/client";

const TYPE_LABEL: Record<Job["type"], string> = {
  import: "Import",
  dataset: "Dataset",
  train: "Training",
  infer: "Query run",
  export: "Export",
};

const STATE_LABEL: Record<JobState, string> = {
  queued: "Queued",
  running: "Running",
  succeeded: "Succeeded",
  failed: "Failed",
  cancelled: "Cancelled",
};

function str(record: Record<string, unknown> | null | undefined, key: string): string | null {
  const v = record?.[key];
  return typeof v === "string" && v ? v : null;
}

export function jobTitle(job: Job): string {
  const name = str(job.params, "name");
  return name ? `${TYPE_LABEL[job.type]}: ${name}` : TYPE_LABEL[job.type];
}

export function stateLabel(state: JobState): string {
  return STATE_LABEL[state];
}

/** Seconds from `started_at` to `finished_at` (or to `nowMs` while running); null before the job starts. */
export function elapsedSeconds(job: Job, nowMs: number): number | null {
  if (!job.started_at) return null;
  const start = Date.parse(job.started_at);
  const end = job.finished_at ? Date.parse(job.finished_at) : nowMs;
  return Math.max(0, Math.round((end - start) / 1000));
}

export function formatDuration(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  if (h > 0) return `${h} h ${String(m).padStart(2, "0")} min`;
  if (m > 0) return `${m} min ${String(s).padStart(2, "0")} s`;
  return `${s} s`;
}

export interface ResultTarget {
  label: string;
  to: string;
}

/** Where a succeeded job's output lives (contract `Job.result` shapes per type). */
export function resultTarget(job: Job, projectId: string): ResultTarget | null {
  if (job.state !== "succeeded") return null;
  const p = `/p/${projectId}`;
  switch (job.type) {
    case "train": {
      const id = str(job.result, "model_id");
      return id ? { label: "Open model", to: `${p}/models?model=${id}` } : null;
    }
    case "infer": {
      const id = str(job.result, "query_run_id");
      return id ? { label: "Open run", to: `${p}/query?run=${id}` } : null;
    }
    case "export": {
      const id = str(job.params, "model_id");
      return id ? { label: "Open model", to: `${p}/models?model=${id}` } : null;
    }
    case "dataset":
      return { label: "Train on it", to: `${p}/train` };
    case "import":
      return { label: "Open Data Manager", to: `${p}/data` };
  }
}
```

- [ ] **Step 5: Implement the hooks**

`frontend/src/jobs/useNow.ts`:

```ts
import { useEffect, useState } from "react";

/** `Date.now()` re-read every `intervalMs` while `enabled`; drives elapsed-time displays. */
export function useNow(intervalMs = 1000, enabled = true): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!enabled) return;
    const id = window.setInterval(() => setNow(Date.now()), intervalMs);
    return () => window.clearInterval(id);
  }, [intervalMs, enabled]);
  return now;
}
```

`frontend/src/jobs/useTrackedJob.ts`:

```ts
import { useEffect } from "react";
import type { Job } from "@contract/client";
import { useApi } from "@/api/client";
import { messageOf } from "@/api/errors";
import { fetchJob } from "@/api/jobs";
import { pushLog } from "@/app/diagnostics";
import { isActiveJob, useJobsStore } from "@/store/jobs";

export const JOB_POLL_MS = 2000;

/**
 * The store's copy of one job, kept fresh by polling `GET /jobs/{id}` every 2 s while the job is
 * unknown or active. Websocket events update the same store entry, so both paths agree.
 */
export function useTrackedJob(projectId: string, jobId: string | null): Job | null {
  const api = useApi();
  const job = useJobsStore((s) => (jobId ? (s.jobs[jobId] ?? null) : null));
  const polling = jobId !== null && (job === null || isActiveJob(job));

  useEffect(() => {
    if (!jobId || !polling) return;
    let cancelled = false;
    const tick = () => {
      fetchJob(api, projectId, jobId)
        .then((j) => {
          if (!cancelled) useJobsStore.getState().upsert(j);
        })
        .catch((e: unknown) => {
          pushLog(`poll job ${jobId} failed: ${messageOf(e, String(e))}`);
        });
    };
    tick();
    const id = window.setInterval(tick, JOB_POLL_MS);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, [api, projectId, jobId, polling]);

  return job;
}
```

`frontend/src/jobs/useJobLog.ts`:

```ts
import { useEffect, useState } from "react";
import { useApi } from "@/api/client";
import { messageOf } from "@/api/errors";
import { fetchJobLog } from "@/api/jobs";

export const LOG_POLL_MS = 2000;

interface LogState {
  jobId: string | null;
  lines: string[];
  error: string | null;
}

const EMPTY: { lines: string[]; error: string | null } = { lines: [], error: null };

/** The last `tail` lines of a job log; refreshed every 2 s while `live`. */
export function useJobLog(
  projectId: string,
  jobId: string | null,
  live: boolean,
  tail = 200,
): { lines: string[]; error: string | null } {
  const api = useApi();
  const [state, setState] = useState<LogState>({ jobId: null, lines: [], error: null });

  useEffect(() => {
    if (!jobId) return;
    let cancelled = false;
    const tick = () => {
      fetchJobLog(api, projectId, jobId, tail)
        .then((log) => {
          if (!cancelled) setState({ jobId, lines: log.lines, error: null });
        })
        .catch((e: unknown) => {
          if (cancelled) return;
          setState((s) => ({
            jobId,
            lines: s.jobId === jobId ? s.lines : [],
            error: messageOf(e, "could not read the job log"),
          }));
        });
    };
    tick();
    if (!live) {
      return () => {
        cancelled = true;
      };
    }
    const id = window.setInterval(tick, LOG_POLL_MS);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, [api, projectId, jobId, live, tail]);

  return state.jobId === jobId && jobId ? { lines: state.lines, error: state.error } : EMPTY;
}
```

`frontend/src/jobs/useJobList.ts`:

```ts
import { useCallback, useEffect, useState } from "react";
import { useApi } from "@/api/client";
import { messageOf } from "@/api/errors";
import { fetchJobs } from "@/api/jobs";
import { pushLog } from "@/app/diagnostics";
import { useJobsStore } from "@/store/jobs";

export const LIST_POLL_MS = 5000;

/** Loads the project's recent jobs into the store while `enabled` (the panel is open) and every 5 s after. */
export function useJobList(
  projectId: string,
  enabled: boolean,
): { loading: boolean; error: string | null; reload: () => void } {
  const api = useApi();
  const [attempt, setAttempt] = useState(0);
  const [status, setStatus] = useState<{ key: string; error: string | null }>({ key: "", error: null });
  const key = `${projectId}|${attempt}`;

  useEffect(() => {
    if (!enabled || !projectId) return;
    let cancelled = false;
    const tick = () => {
      fetchJobs(api, projectId)
        .then((jobs) => {
          if (cancelled) return;
          useJobsStore.getState().upsertMany(jobs);
          setStatus({ key, error: null });
        })
        .catch((e: unknown) => {
          if (cancelled) return;
          pushLog(`list jobs failed: ${messageOf(e, String(e))}`);
          setStatus({ key, error: messageOf(e, "could not load jobs") });
        });
    };
    tick();
    const id = window.setInterval(tick, LIST_POLL_MS);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, [api, projectId, enabled, key]);

  const reload = useCallback(() => setAttempt((a) => a + 1), []);
  const loaded = status.key === key;
  return { loading: enabled && !loaded, error: loaded ? status.error : null, reload };
}
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `pnpm test src/store src/jobs`
Expected: `jobs.test.ts` 3 passed, `jobLabels` 3, `useTrackedJob` 2, `useJobLog` 2; S2's `changes`, `editor`, `navigation` store tests still green.

- [ ] **Step 7: Format, lint, type-check and commit**

Run: `pnpm format && pnpm lint && pnpm exec tsc -b`

```bash
git add src/store/jobs.ts src/store/jobs.test.ts src/jobs/jobLabels.ts src/jobs/jobLabels.test.ts src/jobs/useNow.ts src/jobs/useTrackedJob.ts src/jobs/useTrackedJob.test.tsx src/jobs/useJobLog.ts src/jobs/useJobLog.test.tsx src/jobs/useJobList.ts
git commit -m "feat(ui): jobs store panel state, terminal stamps and polling hooks"
```

---

### Task 4: Job card, log view, jobs panel and the Shell button

**Files:**
- Create: `frontend/src/jobs/JobCard.tsx`, `frontend/src/jobs/JobLogView.tsx`, `frontend/src/jobs/JobsButton.tsx`, `frontend/src/jobs/JobsPanel.tsx`
- Modify: `frontend/src/app/Shell.tsx`
- Test: `frontend/src/jobs/JobCard.test.tsx`, `frontend/src/jobs/JobsPanel.test.tsx`

**Interfaces:**
- Consumes: Task 3 store and hooks, `cancelJob` (Task 2).
- Produces:
  - `JobCard({projectId, job, showLog?}: {projectId: string; job: Job; showLog?: boolean})`: `data-testid="job-{id}"`, title, state badge (`data-testid="job-state"`), elapsed, `role="progressbar"` with `aria-valuenow` percent, message line, `job.error` in `role="alert"`, "Cancel job" while active (`POST cancel`, answer `upsert`ed), the `resultTarget` link when succeeded, "Show log"/"Hide log" toggle mounting `JobLogView`.
  - `JobLogView({projectId, jobId, live}: {projectId: string; jobId: string; live: boolean})`: `<pre data-testid="job-log">`.
  - `JobsButton()`: top-bar `<button aria-controls="jobs-panel" aria-expanded>` with text `{n} active job(s)`.
  - `JobsPanel({projectId}: {projectId: string})`: renders nothing while `panelOpen` is false; otherwise `<aside id="jobs-panel" role="dialog" aria-label="Jobs">` with "Close jobs" and "Refresh" buttons and one `JobCard` per job of the project, newest first.
  - `Shell`: the top-bar span becomes `<JobsButton />`; `<JobsPanel projectId={projectId} />` mounts inside a `relative` column next to `<main>` when a project is open.

- [ ] **Step 1: Write the failing tests**

`frontend/src/jobs/JobCard.test.tsx`:

```tsx
import { describe, it, expect, beforeEach } from "vitest";
import { screen, fireEvent, waitFor } from "@testing-library/react";
import { exampleJobLog, fakeClient, PROJECT_ID, runningJob } from "@/test/fixtures";
import { renderWithProviders } from "@/test/render";
import { useJobsStore } from "@/store/jobs";
import { JobCard } from "./JobCard";

describe("JobCard", () => {
  beforeEach(() => useJobsStore.setState({ jobs: {}, panelOpen: false }));

  it("shows progress and message, cancels through the api and toggles the log", async () => {
    const { api, requests } = fakeClient([
      {
        method: "POST",
        path: /\/cancel$/,
        body: { ...runningJob, state: "cancelled", finished_at: "2026-09-17T10:07:00Z" },
      },
      { method: "GET", path: /\/log$/, body: exampleJobLog },
    ]);
    useJobsStore.getState().upsert(runningJob);
    renderWithProviders(<JobCard projectId={PROJECT_ID} job={runningJob} />, { api });
    expect(screen.getByText("Import")).toBeInTheDocument();
    expect(screen.getByTestId("job-state")).toHaveTextContent("Running");
    expect(screen.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "42");
    expect(screen.getByText(/1386 \/ 3299 images/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Show log" }));
    await waitFor(() => expect(screen.getByTestId("job-log")).toHaveTextContent("job started"));
    fireEvent.click(screen.getByRole("button", { name: "Cancel job" }));
    await waitFor(() => expect(useJobsStore.getState().jobs[runningJob.id].state).toBe("cancelled"));
    expect(requests.some((r) => r.method === "POST" && r.url.endsWith(`/jobs/${runningJob.id}/cancel`))).toBe(true);
  });

  it("shows the error of a failed job and the result link of a succeeded one", () => {
    const { api } = fakeClient([]);
    const failed = { ...runningJob, type: "train" as const, state: "failed" as const, error: "CUDA out of memory" };
    const { unmount } = renderWithProviders(<JobCard projectId={PROJECT_ID} job={failed} />, { api });
    expect(screen.getByRole("alert")).toHaveTextContent("CUDA out of memory");
    expect(screen.queryByRole("button", { name: "Cancel job" })).not.toBeInTheDocument();
    unmount();
    const done = {
      ...runningJob,
      type: "train" as const,
      state: "succeeded" as const,
      progress: 1,
      result: { model_id: "m9" },
    };
    renderWithProviders(<JobCard projectId={PROJECT_ID} job={done} />, { api });
    expect(screen.getByRole("link", { name: "Open model" })).toHaveAttribute("href", `/p/${PROJECT_ID}/models?model=m9`);
  });
});
```

`frontend/src/jobs/JobsPanel.test.tsx`:

```tsx
import { describe, it, expect, beforeEach } from "vitest";
import { screen, fireEvent, waitFor } from "@testing-library/react";
import { errorBody, fakeClient, PROJECT_ID, runningJob } from "@/test/fixtures";
import { renderWithProviders } from "@/test/render";
import { useJobsStore } from "@/store/jobs";
import { JobsButton } from "./JobsButton";
import { JobsPanel } from "./JobsPanel";

describe("JobsPanel", () => {
  beforeEach(() => useJobsStore.setState({ jobs: {}, panelOpen: false }));

  it("opens from the button, loads the job list newest first and closes", async () => {
    const older = { ...runningJob, id: "j0", created_at: "2026-09-17T09:00:00Z", state: "succeeded" as const };
    const { api, requests } = fakeClient([
      { method: "GET", path: /\/jobs$/, body: { items: [runningJob, older], next_cursor: null } },
    ]);
    renderWithProviders(
      <>
        <JobsButton />
        <JobsPanel projectId={PROJECT_ID} />
      </>,
      { api },
    );
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "0 active jobs" })).toHaveAttribute("aria-expanded", "false");
    fireEvent.click(screen.getByRole("button", { name: "0 active jobs" }));
    const dialog = await screen.findByRole("dialog", { name: "Jobs" });
    await waitFor(() => expect(screen.getAllByTestId(/^job-/)).toHaveLength(2));
    expect(requests[0].url).toBe(`/api/v1/projects/${PROJECT_ID}/jobs?limit=100`);
    const ids = screen.getAllByTestId(/^job-/).map((el) => el.getAttribute("data-testid"));
    expect(ids).toEqual([`job-${runningJob.id}`, "job-j0"]);
    expect(screen.getByRole("button", { name: "1 active job" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Close jobs" }));
    expect(dialog).not.toBeInTheDocument();
  });

  it("shows the envelope message when the list fails", async () => {
    const { api } = fakeClient([
      { method: "GET", path: /\/jobs$/, status: 500, body: errorBody("internal_error", "db locked") },
    ]);
    useJobsStore.setState({ panelOpen: true });
    renderWithProviders(<JobsPanel projectId={PROJECT_ID} />, { api });
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("db locked"));
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm test src/jobs/JobCard.test.tsx src/jobs/JobsPanel.test.tsx`
Expected: both fail with unresolved imports.

- [ ] **Step 3: Implement `JobLogView.tsx` and `JobCard.tsx`**

`frontend/src/jobs/JobLogView.tsx`:

```tsx
import { useJobLog } from "./useJobLog";

interface Props {
  projectId: string;
  jobId: string;
  live: boolean;
}

export function JobLogView({ projectId, jobId, live }: Props) {
  const { lines, error } = useJobLog(projectId, jobId, live);
  return (
    <div className="flex flex-col gap-1">
      {error && (
        <p role="alert" className="text-xs text-red-300">
          {error}
        </p>
      )}
      <pre
        data-testid="job-log"
        aria-label="Job log"
        className="max-h-64 overflow-auto whitespace-pre-wrap rounded bg-slate-950 p-2 font-mono text-xs text-slate-300"
      >
        {lines.length > 0 ? lines.join("\n") : "(log is empty)"}
      </pre>
    </div>
  );
}
```

`frontend/src/jobs/JobCard.tsx`:

```tsx
import { useState } from "react";
import { Link } from "react-router-dom";
import type { Job } from "@contract/client";
import { useApi } from "@/api/client";
import { messageOf } from "@/api/errors";
import { cancelJob } from "@/api/jobs";
import { pushLog } from "@/app/diagnostics";
import { isActiveJob, useJobsStore } from "@/store/jobs";
import { elapsedSeconds, formatDuration, jobTitle, resultTarget, stateLabel } from "./jobLabels";
import { JobLogView } from "./JobLogView";
import { useNow } from "./useNow";

interface Props {
  projectId: string;
  job: Job;
  /** Start with the log open (the training screen). */
  showLog?: boolean;
}

const STATE_CLASS: Record<Job["state"], string> = {
  queued: "bg-slate-700 text-slate-200",
  running: "bg-orange-700 text-orange-100",
  succeeded: "bg-emerald-800 text-emerald-100",
  failed: "bg-red-800 text-red-100",
  cancelled: "bg-slate-600 text-slate-200",
};

const btn = "rounded border border-slate-700 px-2 py-0.5 text-xs hover:bg-slate-800 disabled:opacity-50";

export function JobCard({ projectId, job, showLog = false }: Props) {
  const api = useApi();
  const active = isActiveJob(job);
  const now = useNow(1000, active);
  const [logOpen, setLogOpen] = useState(showLog);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const elapsed = elapsedSeconds(job, now);
  const target = resultTarget(job, projectId);
  const percent = Math.round(job.progress * 100);
  const title = jobTitle(job);

  async function cancel() {
    setBusy(true);
    setError(null);
    try {
      useJobsStore.getState().upsert(await cancelJob(api, projectId, job.id));
    } catch (e) {
      pushLog(`cancel job ${job.id} failed: ${messageOf(e, String(e))}`);
      setError(messageOf(e, "could not cancel the job"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <article
      data-testid={`job-${job.id}`}
      className="flex flex-col gap-2 rounded border border-slate-700 bg-slate-800/60 p-3 text-sm"
    >
      <header className="flex flex-wrap items-center gap-2">
        <span className="font-medium">{title}</span>
        <span data-testid="job-state" className={`rounded px-2 py-0.5 text-xs ${STATE_CLASS[job.state]}`}>
          {stateLabel(job.state)}
        </span>
        {elapsed !== null && <span className="text-xs text-slate-400">{formatDuration(elapsed)}</span>}
        <span className="ml-auto font-mono text-xs text-slate-500">{job.id.slice(0, 8)}</span>
      </header>
      <div
        role="progressbar"
        aria-label={`${title} progress`}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={percent}
        className="h-2 w-full overflow-hidden rounded bg-slate-700"
      >
        <div className="h-full bg-orange-500 transition-[width]" style={{ width: `${percent}%` }} />
      </div>
      <p className="text-xs text-slate-300">
        {percent}%{job.message ? ` · ${job.message}` : ""}
      </p>
      {job.error && (
        <p role="alert" className="rounded border border-red-800 bg-red-950 px-2 py-1 text-xs text-red-200">
          {job.error}
        </p>
      )}
      {error && (
        <p role="alert" className="text-xs text-red-300">
          {error}
        </p>
      )}
      <div className="flex flex-wrap items-center gap-2">
        {active && (
          <button type="button" className={btn} onClick={() => void cancel()} disabled={busy}>
            Cancel job
          </button>
        )}
        {target && (
          <Link to={target.to} className="text-xs text-orange-300 hover:underline">
            {target.label}
          </Link>
        )}
        <button type="button" className={btn} onClick={() => setLogOpen((o) => !o)}>
          {logOpen ? "Hide log" : "Show log"}
        </button>
      </div>
      {logOpen && <JobLogView projectId={projectId} jobId={job.id} live={active} />}
    </article>
  );
}
```

- [ ] **Step 4: Implement `JobsButton.tsx` and `JobsPanel.tsx`**

`frontend/src/jobs/JobsButton.tsx`:

```tsx
import { selectActiveCount, useJobsStore } from "@/store/jobs";

/** Top-bar toggle for the jobs panel; the text doubles as the active-job counter. */
export function JobsButton() {
  const count = useJobsStore(selectActiveCount);
  const open = useJobsStore((s) => s.panelOpen);
  const setPanelOpen = useJobsStore((s) => s.setPanelOpen);
  return (
    <button
      type="button"
      aria-controls="jobs-panel"
      aria-expanded={open}
      onClick={() => setPanelOpen(!open)}
      className={`rounded px-2 py-1 text-xs hover:bg-slate-700 ${count > 0 ? "bg-orange-700 text-orange-50" : "bg-slate-800 text-slate-300"}`}
    >
      {count} active {count === 1 ? "job" : "jobs"}
    </button>
  );
}
```

`frontend/src/jobs/JobsPanel.tsx`:

```tsx
import { useMemo } from "react";
import { useJobsStore } from "@/store/jobs";
import { JobCard } from "./JobCard";
import { useJobList } from "./useJobList";

const btn = "rounded border border-slate-700 px-2 py-1 text-xs hover:bg-slate-800 disabled:opacity-50";

/** Global slide-over listing the project's jobs newest first; fed by the websocket and by polling while open. */
export function JobsPanel({ projectId }: { projectId: string }) {
  const open = useJobsStore((s) => s.panelOpen);
  const setPanelOpen = useJobsStore((s) => s.setPanelOpen);
  const jobs = useJobsStore((s) => s.jobs);
  const list = useJobList(projectId, open);
  const sorted = useMemo(
    () =>
      Object.values(jobs)
        .filter((j) => j.project_id === projectId)
        .sort((a, b) => b.created_at.localeCompare(a.created_at)),
    [jobs, projectId],
  );
  if (!open) return null;
  return (
    <aside
      id="jobs-panel"
      role="dialog"
      aria-label="Jobs"
      className="absolute inset-y-0 right-0 z-20 flex w-[28rem] max-w-full flex-col gap-3 overflow-y-auto border-l border-slate-800 bg-slate-950 p-4 shadow-xl"
    >
      <header className="flex items-center gap-2">
        <h2 className="text-lg font-medium">Jobs</h2>
        <button type="button" className={btn} onClick={list.reload} disabled={list.loading}>
          Refresh
        </button>
        <button type="button" className={`${btn} ml-auto`} onClick={() => setPanelOpen(false)}>
          Close jobs
        </button>
      </header>
      {list.error && (
        <p role="alert" className="rounded border border-red-800 bg-red-950 px-3 py-2 text-sm text-red-200">
          {list.error}
        </p>
      )}
      {sorted.length === 0 && (
        <p className="text-sm text-slate-400">{list.loading ? "Loading…" : "No jobs yet."}</p>
      )}
      <ul className="flex flex-col gap-2">
        {sorted.map((job) => (
          <li key={job.id}>
            <JobCard projectId={projectId} job={job} />
          </li>
        ))}
      </ul>
    </aside>
  );
}
```

- [ ] **Step 5: Wire the Shell**

In `frontend/src/app/Shell.tsx`: delete the `ACTIVE_STATES` constant, the `useJobsStore` import and the `activeJobs` selector; add `import { JobsButton } from "@/jobs/JobsButton";` and `import { JobsPanel } from "@/jobs/JobsPanel";`. Replace the right-hand column with:

```tsx
      <div className="relative flex min-w-0 flex-1 flex-col">
        <header className="flex items-center justify-between border-b border-slate-800 px-6 py-3">
          <span className="truncate text-sm text-slate-300">{projectName ?? "No project open"}</span>
          <JobsButton />
        </header>
        <main className={imageId ? "min-h-0 flex-1 overflow-hidden" : "min-h-0 flex-1 overflow-auto p-6"}>
          <Outlet />
        </main>
        {projectId && <JobsPanel projectId={projectId} />}
      </div>
```

The S2 e2e `data-manager.spec.ts` asserts `page.getByText(/1 active job/)`; the button text keeps that wording.

- [ ] **Step 6: Run the tests to verify they pass**

Run: `pnpm test src/jobs`
Expected: `JobCard` 2 passed, `JobsPanel` 2 passed, hooks and labels still green.

- [ ] **Step 7: Format, lint, type-check, quick e2e smoke and commit**

Run: `pnpm format && pnpm lint && pnpm exec tsc -b && pnpm e2e e2e/boot.spec.ts e2e/data-manager.spec.ts`
Expected: lint clean; boot 1 passed, data-manager 6 passed (the "1 active job" assertion now reads the button).

```bash
git add src/jobs/JobCard.tsx src/jobs/JobCard.test.tsx src/jobs/JobLogView.tsx src/jobs/JobsButton.tsx src/jobs/JobsPanel.tsx src/jobs/JobsPanel.test.tsx src/app/Shell.tsx
git commit -m "feat(ui): jobs panel with job cards, log tail and cancel"
```

---

### Task 5: Registry helpers: results.csv parser, alias editor model, labels, `useModels`

**Files:**
- Create: `frontend/src/models/resultsCsv.ts`, `frontend/src/models/aliases.ts`, `frontend/src/models/modelLabels.ts`, `frontend/src/models/useModels.ts`, `frontend/src/models/useDatasetNames.ts`
- Test: `frontend/src/models/resultsCsv.test.ts`, `frontend/src/models/aliases.test.ts`, `frontend/src/models/modelLabels.test.ts`, `frontend/src/models/useModels.test.tsx`

**Interfaces:**
- Consumes: `fetchAllModels` (Task 1), `fetchDatasets` (Task 1), `isNotImplemented`, `messageOf`, `pushLog`, `useApi`.
- Produces:
  - `resultsCsv.ts`: `interface CurvePoint {epoch: number; map50: number; map50_95: number | null}`, `parseResultsCsv(text: string): CurvePoint[]` (columns `epoch`, `metrics/mAP50(B)`, `metrics/mAP50-95(B)`; header cells trimmed; bad rows skipped; anything without those columns yields `[]`), `interface CurveBox {width: number; height: number; pad: number}`, `curvePolyline(points, pick: (p: CurvePoint) => number | null, box: CurveBox): string` (SVG `points` string; x spans the epoch range, y maps 0..1 to bottom..top).
  - `aliases.ts`: `DEFAULT_ALIASES = {truck: "dump_truck"}`, `parseAliases(text): Record<string, string>` (one `model_class=project_class` per line; `:` and `->` also accepted; blank and `#` lines ignored), `formatAliases(map): string`.
  - `modelLabels.ts`: `formatMetric(v: number | null | undefined): string` (`71.0%` or an en dash), `formatDate(iso): string` (`YYYY-MM-DD HH:mm`), `kindLabel(kind): string` ("Imported" / "Trained").
  - `useModels.ts`: `interface ModelsList {models: Model[]; loading: boolean; unavailable: boolean; error: string | null; reload(): void; replace(model: Model): void; remove(id: string): void}`, `useModels(projectId): ModelsList` (`unavailable` true on 501, `error` for other failures; `replace` inserts unknown models at the front).
  - `useDatasetNames.ts`: `useDatasetNames(projectId): Record<string, string>` (dataset id -> name; `{}` on any failure).

- [ ] **Step 1: Write the failing tests**

`frontend/src/models/resultsCsv.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { RESULTS_CSV } from "@/test/fixtures";
import { curvePolyline, parseResultsCsv } from "./resultsCsv";

describe("results.csv", () => {
  it("parses epoch, mAP50 and mAP50-95 columns", () => {
    const points = parseResultsCsv(RESULTS_CSV);
    expect(points).toEqual([
      { epoch: 1, map50: 0.18, map50_95: 0.09 },
      { epoch: 2, map50: 0.45, map50_95: 0.24 },
      { epoch: 3, map50: 0.71, map50_95: 0.44 },
    ]);
  });

  it("tolerates padded headers, skips bad rows and yields nothing for unknown text", () => {
    const padded = "   epoch,   metrics/mAP50(B)\n1, 0.5\nx, y\n2, 0.6\n";
    expect(parseResultsCsv(padded)).toEqual([
      { epoch: 1, map50: 0.5, map50_95: null },
      { epoch: 2, map50: 0.6, map50_95: null },
    ]);
    expect(parseResultsCsv("string")).toEqual([]);
    expect(parseResultsCsv("")).toEqual([]);
  });

  it("maps points into an SVG polyline", () => {
    const points = parseResultsCsv(RESULTS_CSV);
    expect(curvePolyline(points, (p) => p.map50, { width: 100, height: 50, pad: 0 })).toBe("0,41 50,27.5 100,14.5");
    expect(curvePolyline(points, () => null, { width: 100, height: 50, pad: 0 })).toBe("");
    expect(curvePolyline([points[0]], (p) => p.map50, { width: 100, height: 50, pad: 10 })).toBe("10,34.6");
  });
});
```

`frontend/src/models/aliases.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { DEFAULT_ALIASES, formatAliases, parseAliases } from "./aliases";

describe("class aliases", () => {
  it("round-trips the default and accepts =, : and ->", () => {
    expect(formatAliases(DEFAULT_ALIASES)).toBe("truck=dump_truck");
    expect(parseAliases("truck=dump_truck")).toEqual(DEFAULT_ALIASES);
    expect(parseAliases("# comment\n\ntruck : dump_truck\ncar -> wheel_loader\nbad line\n")).toEqual({
      truck: "dump_truck",
      car: "wheel_loader",
    });
    expect(parseAliases("")).toEqual({});
  });
});
```

`frontend/src/models/modelLabels.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { formatDate, formatMetric, kindLabel } from "./modelLabels";

describe("model labels", () => {
  it("formats metrics as percentages and dates as UTC minutes", () => {
    expect(formatMetric(0.71)).toBe("71.0%");
    expect(formatMetric(0.4444)).toBe("44.4%");
    expect(formatMetric(null)).toBe("\u2013");
    expect(formatMetric(undefined)).toBe("\u2013");
    expect(formatDate("2026-09-17T10:10:00Z")).toBe("2026-09-17 10:10");
    expect(kindLabel("imported")).toBe("Imported");
    expect(kindLabel("trained")).toBe("Trained");
  });
});
```

`frontend/src/models/useModels.test.tsx`:

```tsx
import type { ReactNode } from "react";
import { describe, it, expect } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";
import { errorBody, exampleModel, exampleTrainedModel, fakeClient, PROJECT_ID } from "@/test/fixtures";
import { TestApiProvider } from "@/test/render";
import { useModels } from "./useModels";

function wrapperFor(api: ReturnType<typeof fakeClient>["api"]) {
  return ({ children }: { children: ReactNode }) => <TestApiProvider api={api}>{children}</TestApiProvider>;
}

describe("useModels", () => {
  it("loads the registry and supports replace and remove", async () => {
    const { api } = fakeClient([
      { method: "GET", path: /\/models$/, body: { items: [exampleModel], next_cursor: null } },
    ]);
    const { result } = renderHook(() => useModels(PROJECT_ID), { wrapper: wrapperFor(api) });
    expect(result.current.loading).toBe(true);
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.models.map((m) => m.id)).toEqual([exampleModel.id]);
    act(() => result.current.replace(exampleTrainedModel));
    expect(result.current.models.map((m) => m.id)).toEqual([exampleTrainedModel.id, exampleModel.id]);
    act(() => result.current.replace({ ...exampleModel, name: "renamed" }));
    expect(result.current.models[1].name).toBe("renamed");
    act(() => result.current.remove(exampleModel.id));
    expect(result.current.models.map((m) => m.id)).toEqual([exampleTrainedModel.id]);
  });

  it("marks the registry unavailable on 501 and reports other errors", async () => {
    const stub = fakeClient([
      { method: "GET", path: /\/models$/, status: 501, body: errorBody("not_implemented", "S3 later") },
    ]);
    const { result } = renderHook(() => useModels(PROJECT_ID), { wrapper: wrapperFor(stub.api) });
    await waitFor(() => expect(result.current.unavailable).toBe(true));
    expect(result.current.error).toBeNull();
    const broken = fakeClient([
      { method: "GET", path: /\/models$/, status: 500, body: errorBody("internal_error", "disk full") },
    ]);
    const bad = renderHook(() => useModels(PROJECT_ID), { wrapper: wrapperFor(broken.api) });
    await waitFor(() => expect(bad.result.current.error).toBe("disk full"));
    expect(bad.result.current.unavailable).toBe(false);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm test src/models`
Expected: 4 files fail with unresolved imports.

- [ ] **Step 3: Implement `resultsCsv.ts`**

```ts
export interface CurvePoint {
  epoch: number;
  map50: number;
  map50_95: number | null;
}

const EPOCH = "epoch";
const MAP50 = "metrics/mAP50(B)";
const MAP50_95 = "metrics/mAP50-95(B)";

/** Ultralytics `results.csv`: one row per epoch; header cells may carry padding in older versions. */
export function parseResultsCsv(text: string): CurvePoint[] {
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  if (lines.length < 2) return [];
  const header = lines[0].split(",").map((h) => h.trim());
  const iEpoch = header.indexOf(EPOCH);
  const iMap50 = header.indexOf(MAP50);
  const iMap5095 = header.indexOf(MAP50_95);
  if (iEpoch < 0 || iMap50 < 0) return [];
  const points: CurvePoint[] = [];
  for (const line of lines.slice(1)) {
    const cells = line.split(",").map((c) => c.trim());
    const epoch = Number(cells[iEpoch]);
    const map50 = Number(cells[iMap50]);
    if (!Number.isFinite(epoch) || !Number.isFinite(map50)) continue;
    const m95 = iMap5095 >= 0 ? Number(cells[iMap5095]) : Number.NaN;
    points.push({ epoch, map50, map50_95: Number.isFinite(m95) ? m95 : null });
  }
  return points;
}

export interface CurveBox {
  width: number;
  height: number;
  pad: number;
}

const round1 = (n: number) => Math.round(n * 10) / 10;

/** SVG `points` for a metric over epochs: x spans the epoch range, y maps 1 to the top and 0 to the bottom. */
export function curvePolyline(
  points: CurvePoint[],
  pick: (p: CurvePoint) => number | null,
  box: CurveBox,
): string {
  if (points.length === 0) return "";
  const minEpoch = points[0].epoch;
  const span = Math.max(1, points[points.length - 1].epoch - minEpoch);
  const w = box.width - 2 * box.pad;
  const h = box.height - 2 * box.pad;
  return points
    .flatMap((p) => {
      const v = pick(p);
      if (v === null) return [];
      const x = box.pad + ((p.epoch - minEpoch) / span) * w;
      const y = box.pad + (1 - Math.min(1, Math.max(0, v))) * h;
      return [`${round1(x)},${round1(y)}`];
    })
    .join(" ");
}
```

- [ ] **Step 4: Implement `aliases.ts` and `modelLabels.ts`**

`frontend/src/models/aliases.ts`:

```ts
/** Spec section 8: COCO weights map `truck` to the project's `dump_truck`. */
export const DEFAULT_ALIASES: Record<string, string> = { truck: "dump_truck" };

const LINE = /^([^=:>]+?)\s*(?:=|:|->)\s*(.+)$/;

/** One `model_class=project_class` per line (`:` and `->` also accepted); blank and `#` lines are ignored. */
export function parseAliases(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const m = LINE.exec(line);
    if (!m) continue;
    out[m[1].trim()] = m[2].trim();
  }
  return out;
}

export function formatAliases(map: Record<string, string>): string {
  return Object.entries(map)
    .map(([from, to]) => `${from}=${to}`)
    .join("\n");
}
```

`frontend/src/models/modelLabels.ts`:

```ts
import type { Model } from "@contract/client";

const KIND_LABEL: Record<Model["kind"], string> = { imported: "Imported", trained: "Trained" };

export function formatMetric(v: number | null | undefined): string {
  return typeof v === "number" ? `${(v * 100).toFixed(1)}%` : "\u2013";
}

/** `YYYY-MM-DD HH:mm` in UTC, deterministic across locales (same shape as the Data Manager). */
export function formatDate(iso: string): string {
  return `${iso.slice(0, 10)} ${iso.slice(11, 16)}`;
}

export function kindLabel(kind: Model["kind"]): string {
  return KIND_LABEL[kind];
}
```

- [ ] **Step 5: Implement `useModels.ts` and `useDatasetNames.ts`**

`frontend/src/models/useModels.ts`:

```ts
import { useCallback, useEffect, useState } from "react";
import type { Model } from "@contract/client";
import { useApi } from "@/api/client";
import { isNotImplemented, messageOf } from "@/api/errors";
import { fetchAllModels } from "@/api/models";
import { pushLog } from "@/app/diagnostics";

export interface ModelsList {
  models: Model[];
  loading: boolean;
  /** 501 from the backend: the registry arrives with S3. */
  unavailable: boolean;
  error: string | null;
  reload: () => void;
  replace: (model: Model) => void;
  remove: (id: string) => void;
}

interface State {
  key: string;
  models: Model[];
  unavailable: boolean;
  error: string | null;
}

export function useModels(projectId: string): ModelsList {
  const api = useApi();
  const [attempt, setAttempt] = useState(0);
  const key = `${projectId}|${attempt}`;
  const [state, setState] = useState<State>({ key: "", models: [], unavailable: false, error: null });

  useEffect(() => {
    let cancelled = false;
    fetchAllModels(api, projectId)
      .then((models) => {
        if (!cancelled) setState({ key, models, unavailable: false, error: null });
      })
      .catch((e: unknown) => {
        if (cancelled) return;
        pushLog(`load models failed: ${messageOf(e, String(e))}`);
        const unavailable = isNotImplemented(e);
        setState({
          key,
          models: [],
          unavailable,
          error: unavailable ? null : messageOf(e, "could not load the model registry"),
        });
      });
    return () => {
      cancelled = true;
    };
  }, [api, projectId, key]);

  const reload = useCallback(() => setAttempt((a) => a + 1), []);
  const replace = useCallback(
    (model: Model) =>
      setState((s) => ({
        ...s,
        models: s.models.some((m) => m.id === model.id)
          ? s.models.map((m) => (m.id === model.id ? model : m))
          : [model, ...s.models],
      })),
    [],
  );
  const remove = useCallback(
    (id: string) => setState((s) => ({ ...s, models: s.models.filter((m) => m.id !== id) })),
    [],
  );

  const loaded = state.key === key;
  return {
    models: state.models,
    loading: !loaded,
    unavailable: loaded && state.unavailable,
    error: loaded ? state.error : null,
    reload,
    replace,
    remove,
  };
}
```

`frontend/src/models/useDatasetNames.ts`:

```ts
import { useEffect, useState } from "react";
import { useApi } from "@/api/client";
import { fetchDatasets } from "@/api/datasets";
import { messageOf } from "@/api/errors";
import { pushLog } from "@/app/diagnostics";

/** Dataset id -> name for the registry table; empty when datasets are unavailable. */
export function useDatasetNames(projectId: string): Record<string, string> {
  const api = useApi();
  const [names, setNames] = useState<Record<string, string>>({});
  useEffect(() => {
    let cancelled = false;
    fetchDatasets(api, projectId)
      .then((items) => {
        if (!cancelled) setNames(Object.fromEntries(items.map((d) => [d.id, d.name])));
      })
      .catch((e: unknown) => {
        pushLog(`datasets unavailable: ${messageOf(e, String(e))}`);
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

Run: `pnpm test src/models`
Expected: `resultsCsv` 3, `aliases` 1, `modelLabels` 1, `useModels` 2 passed.

- [ ] **Step 7: Format, lint, type-check and commit**

Run: `pnpm format && pnpm lint && pnpm exec tsc -b`

```bash
git add src/models
git commit -m "feat(ui): registry helpers (results.csv parser, aliases, labels, useModels)"
```

---

### Task 6: Model registry screen: table, detail, per-class metrics, artifacts and training curve

**Files:**
- Create: `frontend/src/models/ModelTable.tsx`, `frontend/src/models/TrainingCurve.tsx`, `frontend/src/models/ModelArtifacts.tsx`, `frontend/src/models/ModelDetail.tsx`
- Modify: `frontend/src/screens/ModelsScreen.tsx` (replace the placeholder)
- Test: `frontend/src/models/ModelArtifacts.test.tsx`, `frontend/src/screens/ModelsScreen.test.tsx`

**Interfaces:**
- Consumes: Task 5 helpers and hooks, `artifactUrl`, `fetchResultsCsv` (Task 1), `useBackend`, `useProject`.
- Produces:
  - `ModelTable({models, datasetNames, selectedId, onSelect}: {models: Model[]; datasetNames: Record<string, string>; selectedId: string | null; onSelect: (id: string) => void})`: `<table data-testid="model-table">` with columns Kind, Name, Base, Dataset, mAP50, mAP50-95, Precision, Recall, Created; each name cell is a `<button aria-label="Select model {name}">`; the selected row has `aria-selected="true"`.
  - `TrainingCurve({points}: {points: CurvePoint[]})`: `<svg data-testid="training-curve" data-points="{n}" role="img">` with the mAP50 polyline (orange) and the mAP50-95 polyline (dashed sky), or `<p data-testid="training-curve-empty">` when no points.
  - `ModelArtifacts({projectId, model}: {projectId: string; model: Model})`: fetches `results.csv` when `model.artifacts.results_csv` is set and renders `TrainingCurve`; `<img alt="Confusion matrix">` / `<img alt="PR curve">` through `artifactUrl` when present, with an "not available" fallback on error; "No training artifacts (imported weights)." when the model has none.
  - `ModelDetail({projectId, model, project, datasetNames, onProjectSaved, onChanged, onDeleted}: {projectId: string; model: Model; project: Project; datasetNames: Record<string, string>; onProjectSaved: (p: Project) => void; onChanged: (m: Model) => void; onDeleted: (id: string) => void})`: `<section data-testid="model-detail">` with the metadata list, class names and aliases, summary metrics, `<table data-testid="class-metrics">`, `ModelArtifacts`, and an actions area filled in Task 7 (the three callbacks are declared now so the signature never changes).
  - `ModelsScreen`: heading "Models", `?model=` search param selects the detail, 501 note `role="note"` "The model registry is not available yet", import button and form arrive in Task 7.

- [ ] **Step 1: Write the failing tests**

`frontend/src/models/ModelArtifacts.test.tsx`:

```tsx
import { describe, it, expect } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import { createApiClient } from "@contract/client";
import { exampleModel, exampleTrainedModel, PROJECT_ID, RESULTS_CSV, TRAINED_MODEL_ID } from "@/test/fixtures";
import { renderWithProviders } from "@/test/render";
import { ModelArtifacts } from "./ModelArtifacts";

describe("ModelArtifacts", () => {
  it("fetches results.csv into the curve and links the PNG artifacts with the token in the query", async () => {
    const csvFetch: typeof fetch = async () =>
      new Response(RESULTS_CSV, { status: 200, headers: { "Content-Type": "text/csv" } });
    const api = createApiClient({ baseUrl: "http://fake", token: "t", fetch: csvFetch });
    renderWithProviders(<ModelArtifacts projectId={PROJECT_ID} model={exampleTrainedModel} />, { api });
    const curve = await screen.findByTestId("training-curve");
    await waitFor(() => expect(curve).toHaveAttribute("data-points", "3"));
    expect(screen.getByRole("img", { name: "Confusion matrix" })).toHaveAttribute(
      "src",
      `http://fake/api/v1/projects/${PROJECT_ID}/models/${TRAINED_MODEL_ID}/artifacts/confusion_matrix?token=t`,
    );
    expect(screen.getByRole("img", { name: "PR curve" })).toHaveAttribute(
      "src",
      `http://fake/api/v1/projects/${PROJECT_ID}/models/${TRAINED_MODEL_ID}/artifacts/pr_curve?token=t`,
    );
  });

  it("explains that imported weights have no artifacts", () => {
    const api = createApiClient({ baseUrl: "http://fake", token: "t", fetch: async () => new Response("", { status: 404 }) });
    renderWithProviders(<ModelArtifacts projectId={PROJECT_ID} model={exampleModel} />, { api });
    expect(screen.getByText("No training artifacts (imported weights).")).toBeInTheDocument();
    expect(screen.queryByTestId("training-curve")).not.toBeInTheDocument();
  });
});
```

`frontend/src/screens/ModelsScreen.test.tsx`:

```tsx
import { describe, it, expect } from "vitest";
import { screen, fireEvent, waitFor } from "@testing-library/react";
import {
  errorBody,
  exampleDataset,
  exampleModel,
  exampleProject,
  exampleTrainedModel,
  fakeClient,
  PROJECT_ID,
  RESULTS_CSV,
  TRAINED_MODEL_ID,
} from "@/test/fixtures";
import { renderWithProviders } from "@/test/render";
import { ModelsScreen } from "./ModelsScreen";

const routes = [
  { method: "GET", path: /\/projects\/[^/]+$/, body: exampleProject },
  { method: "GET", path: /\/models$/, body: { items: [exampleTrainedModel, exampleModel], next_cursor: null } },
  { method: "GET", path: /\/datasets$/, body: { items: [exampleDataset], next_cursor: null } },
  { method: "GET", path: /\/artifacts\/results_csv$/, body: RESULTS_CSV },
];

describe("ModelsScreen", () => {
  it("lists the registry with metrics and opens the detail from the ?model= param", async () => {
    const { api } = fakeClient(routes);
    renderWithProviders(<ModelsScreen />, {
      api,
      route: `/p/${PROJECT_ID}/models?model=${TRAINED_MODEL_ID}`,
      path: "/p/:projectId/models",
    });
    expect(await screen.findByRole("heading", { name: "Models" })).toBeInTheDocument();
    const table = await screen.findByTestId("model-table");
    await waitFor(() => expect(table).toHaveTextContent("ahmadia-v1-n"));
    const row = screen.getByRole("button", { name: "Select model ahmadia-v1-n" }).closest("tr");
    expect(row).toHaveTextContent("Trained");
    expect(row).toHaveTextContent("v1");
    expect(row).toHaveTextContent("71.0%");
    expect(row).toHaveTextContent("44.0%");
    expect(row).toHaveAttribute("aria-selected", "true");
    const detail = screen.getByTestId("model-detail");
    expect(detail).toHaveTextContent("yolo11n.pt");
    const classMetrics = screen.getByTestId("class-metrics");
    expect(classMetrics).toHaveTextContent("excavator");
    expect(classMetrics).toHaveTextContent("80.0%");
    expect(classMetrics).toHaveTextContent("dump_truck");
    await waitFor(() => expect(screen.getByTestId("training-curve")).toHaveAttribute("data-points", "3"));
  });

  it("selects a model by clicking its name", async () => {
    const { api } = fakeClient(routes);
    renderWithProviders(<ModelsScreen />, { api, route: `/p/${PROJECT_ID}/models`, path: "/p/:projectId/models" });
    fireEvent.click(await screen.findByRole("button", { name: "Select model yolo11m-coco" }));
    const detail = await screen.findByTestId("model-detail");
    expect(detail).toHaveTextContent("truck");
    expect(detail).toHaveTextContent("dump_truck");
    expect(detail).toHaveTextContent("No training artifacts (imported weights).");
  });

  it("shows the not-available note on 501 and keeps the heading", async () => {
    const { api } = fakeClient([
      { method: "GET", path: /\/projects\/[^/]+$/, body: exampleProject },
      { method: "GET", path: /\/models$/, status: 501, body: errorBody("not_implemented", "S3 later") },
      { method: "GET", path: /\/datasets$/, status: 501, body: errorBody("not_implemented", "S1 later") },
    ]);
    renderWithProviders(<ModelsScreen />, { api, route: `/p/${PROJECT_ID}/models`, path: "/p/:projectId/models" });
    expect(await screen.findByRole("note")).toHaveTextContent("The model registry is not available yet");
    expect(screen.getByRole("heading", { name: "Models" })).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
});
```

Note: `fakeFetch` serialises `body` with `JSON.stringify`, so the CSV route answers a JSON string literal; `fetchResultsCsv` uses `parseAs: "text"`, which returns that literal with its quotes. `parseResultsCsv` trims lines and splits on commas, so the quotes only pollute the first header cell and the last cell of the last row; the `epoch` column stays at index 0 only if the first cell is `epoch`. To keep the test honest, make the `results_csv` route a function that returns the CSV unchanged: extend `FakeRoute` in `fixtures.ts` with `raw?: boolean` and in `fakeFetch` return `new Response(String(payload), {status, headers: {"Content-Type": "text/csv"}})` when `route.raw` is true; then write the route as `{ method: "GET", path: /\/artifacts\/results_csv$/, body: RESULTS_CSV, raw: true }` in both tests above. This is the one change to `fakeFetch` in S5 (additive).

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm test src/models/ModelArtifacts.test.tsx src/screens/ModelsScreen.test.tsx`
Expected: unresolved import `./ModelArtifacts`; `ModelsScreen` renders the placeholder and fails on `findByTestId("model-table")`.

- [ ] **Step 3: Add the `raw` route flag to `fakeFetch`**

In `frontend/src/test/fixtures.ts`, extend the interface and the response branch:

```ts
export interface FakeRoute {
  method: string;
  path: RegExp;
  status?: number;
  body?: FakeBody | ((req: RecordedRequest) => FakeBody);
  /** Send `body` verbatim as `text/csv` instead of JSON (artifact downloads). */
  raw?: boolean;
}
```

and, right after `const payload = ...` inside `fakeFetch`:

```ts
    if (route.raw) {
      return new Response(String(payload), { status, headers: { "Content-Type": "text/csv" } });
    }
```

- [ ] **Step 4: Implement `ModelTable.tsx` and `TrainingCurve.tsx`**

`frontend/src/models/ModelTable.tsx`:

```tsx
import type { Model } from "@contract/client";
import { formatDate, formatMetric, kindLabel } from "./modelLabels";

interface Props {
  models: Model[];
  datasetNames: Record<string, string>;
  selectedId: string | null;
  onSelect: (id: string) => void;
}

const HEADERS = ["Kind", "Name", "Base", "Dataset", "mAP50", "mAP50-95", "Precision", "Recall", "Created"];

export function ModelTable({ models, datasetNames, selectedId, onSelect }: Props) {
  return (
    <table data-testid="model-table" className="w-full border-collapse text-left text-sm">
      <thead>
        <tr className="text-xs uppercase tracking-wide text-slate-400">
          {HEADERS.map((h) => (
            <th key={h} className="border-b border-slate-800 px-2 py-1 font-medium">
              {h}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {models.map((m) => {
          const selected = m.id === selectedId;
          return (
            <tr
              key={m.id}
              aria-selected={selected}
              onClick={() => onSelect(m.id)}
              className={`cursor-pointer border-b border-slate-800/60 ${selected ? "bg-slate-800" : "hover:bg-slate-800/50"}`}
            >
              <td className="px-2 py-1 text-xs text-slate-400">{kindLabel(m.kind)}</td>
              <td className="px-2 py-1">
                <button
                  type="button"
                  aria-label={`Select model ${m.name}`}
                  onClick={() => onSelect(m.id)}
                  className="font-medium hover:underline"
                >
                  {m.name}
                </button>
              </td>
              <td className="px-2 py-1 font-mono text-xs">{m.base_weights ?? "\u2013"}</td>
              <td className="px-2 py-1">
                {m.dataset_id ? (datasetNames[m.dataset_id] ?? m.dataset_id.slice(0, 8)) : "\u2013"}
              </td>
              <td className="px-2 py-1 tabular-nums">{formatMetric(m.metrics?.map50)}</td>
              <td className="px-2 py-1 tabular-nums">{formatMetric(m.metrics?.map50_95)}</td>
              <td className="px-2 py-1 tabular-nums">{formatMetric(m.metrics?.precision)}</td>
              <td className="px-2 py-1 tabular-nums">{formatMetric(m.metrics?.recall)}</td>
              <td className="px-2 py-1 text-xs text-slate-400">{formatDate(m.created_at)}</td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
```

`frontend/src/models/TrainingCurve.tsx`:

```tsx
import { formatMetric } from "./modelLabels";
import { curvePolyline, type CurvePoint } from "./resultsCsv";

const W = 480;
const H = 200;
const PAD = 24;
const BOX = { width: W, height: H, pad: PAD };
const GRID = [0, 0.25, 0.5, 0.75, 1];

/** Inline SVG (no chart library): mAP50 solid orange, mAP50-95 dashed sky, y from 0 to 100 %. */
export function TrainingCurve({ points }: { points: CurvePoint[] }) {
  if (points.length === 0) {
    return (
      <p data-testid="training-curve-empty" className="text-xs text-slate-400">
        No epochs recorded in results.csv.
      </p>
    );
  }
  const last = points[points.length - 1];
  const map50 = curvePolyline(points, (p) => p.map50, BOX);
  const map5095 = curvePolyline(points, (p) => p.map50_95, BOX);
  return (
    <figure className="flex flex-col gap-1">
      <svg
        data-testid="training-curve"
        data-points={points.length}
        role="img"
        aria-label={`mAP50 over ${points.length} epochs, last ${formatMetric(last.map50)}`}
        viewBox={`0 0 ${W} ${H}`}
        className="w-full max-w-xl rounded bg-slate-950"
      >
        {GRID.map((v) => {
          const y = PAD + (1 - v) * (H - 2 * PAD);
          return (
            <g key={v}>
              <line x1={PAD} x2={W - PAD} y1={y} y2={y} stroke="#334155" strokeWidth={1} />
              <text x={2} y={y + 3} fontSize={9} fill="#94a3b8">
                {Math.round(v * 100)}%
              </text>
            </g>
          );
        })}
        <polyline points={map50} fill="none" stroke="#f97316" strokeWidth={2} />
        {map5095 && <polyline points={map5095} fill="none" stroke="#38bdf8" strokeWidth={1.5} strokeDasharray="4 3" />}
        <text x={PAD} y={H - 6} fontSize={9} fill="#94a3b8">
          epoch {points[0].epoch}
        </text>
        <text x={W - PAD} y={H - 6} fontSize={9} fill="#94a3b8" textAnchor="end">
          epoch {last.epoch}
        </text>
      </svg>
      <figcaption className="text-xs text-slate-400">
        <span className="text-orange-400">mAP50</span> and <span className="text-sky-400">mAP50-95</span> per epoch
        from results.csv (last: {formatMetric(last.map50)} / {formatMetric(last.map50_95)})
      </figcaption>
    </figure>
  );
}
```

- [ ] **Step 5: Implement `ModelArtifacts.tsx`**

```tsx
import { useEffect, useState } from "react";
import type { Model } from "@contract/client";
import { useApi, useBackend } from "@/api/client";
import { messageOf } from "@/api/errors";
import { artifactUrl, fetchResultsCsv } from "@/api/models";
import { pushLog } from "@/app/diagnostics";
import { parseResultsCsv, type CurvePoint } from "./resultsCsv";
import { TrainingCurve } from "./TrainingCurve";

interface CsvState {
  modelId: string;
  points: CurvePoint[];
  error: string | null;
}

/** Mounted with `key={src}` so a new source starts un-failed without an effect. */
function ArtifactImage({ src, alt }: { src: string; alt: string }) {
  const [failed, setFailed] = useState(false);
  return (
    <figure className="flex flex-col gap-1">
      {failed ? (
        <span className="rounded bg-slate-950 px-2 py-6 text-center text-xs text-slate-500">{alt} not available</span>
      ) : (
        <img src={src} alt={alt} onError={() => setFailed(true)} className="w-full rounded bg-white" />
      )}
      <figcaption className="text-xs text-slate-400">{alt}</figcaption>
    </figure>
  );
}

export function ModelArtifacts({ projectId, model }: { projectId: string; model: Model }) {
  const api = useApi();
  const { baseUrl, token } = useBackend();
  const hasCsv = Boolean(model.artifacts.results_csv);
  const [csv, setCsv] = useState<CsvState | null>(null);

  useEffect(() => {
    if (!hasCsv) return;
    let cancelled = false;
    fetchResultsCsv(api, projectId, model.id)
      .then((text) => {
        if (!cancelled) setCsv({ modelId: model.id, points: parseResultsCsv(text), error: null });
      })
      .catch((e: unknown) => {
        if (cancelled) return;
        pushLog(`results.csv of ${model.id} failed: ${messageOf(e, String(e))}`);
        setCsv({ modelId: model.id, points: [], error: messageOf(e, "could not load results.csv") });
      });
    return () => {
      cancelled = true;
    };
  }, [api, projectId, model.id, hasCsv]);

  const { confusion_matrix, pr_curve } = model.artifacts;
  if (!hasCsv && !confusion_matrix && !pr_curve) {
    return <p className="text-sm text-slate-400">No training artifacts (imported weights).</p>;
  }
  const curve = csv && csv.modelId === model.id ? csv : null;
  const cmSrc = confusion_matrix ? artifactUrl(baseUrl, token, projectId, model.id, "confusion_matrix") : null;
  const prSrc = pr_curve ? artifactUrl(baseUrl, token, projectId, model.id, "pr_curve") : null;
  return (
    <div className="flex flex-col gap-3">
      {hasCsv &&
        (curve ? (
          curve.error ? (
            <p role="alert" className="text-xs text-red-300">
              {curve.error}
            </p>
          ) : (
            <TrainingCurve points={curve.points} />
          )
        ) : (
          <p className="text-xs text-slate-400">Loading results.csv\u2026</p>
        ))}
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        {cmSrc && <ArtifactImage key={cmSrc} src={cmSrc} alt="Confusion matrix" />}
        {prSrc && <ArtifactImage key={prSrc} src={prSrc} alt="PR curve" />}
      </div>
    </div>
  );
}
```

- [ ] **Step 6: Implement `ModelDetail.tsx` (read-only parts; actions in Task 7)**

```tsx
import type { Model, Project } from "@contract/client";
import { ModelArtifacts } from "./ModelArtifacts";
import { formatDate, formatMetric, kindLabel } from "./modelLabels";

export interface ModelDetailProps {
  projectId: string;
  model: Model;
  project: Project;
  datasetNames: Record<string, string>;
  onProjectSaved: (p: Project) => void;
  onChanged: (m: Model) => void;
  onDeleted: (id: string) => void;
}

const dt = "text-xs uppercase tracking-wide text-slate-500";
const dd = "text-sm";

export function ModelDetail({ projectId, model, project, datasetNames, onProjectSaved, onChanged, onDeleted }: ModelDetailProps) {
  const metrics = model.metrics;
  const aliases = Object.entries(model.class_aliases);
  return (
    <section data-testid="model-detail" className="flex flex-col gap-4 rounded border border-slate-800 bg-slate-800/30 p-4">
      <header className="flex flex-wrap items-baseline gap-2">
        <h2 className="text-lg font-medium">{model.name}</h2>
        <span className="rounded bg-slate-700 px-2 py-0.5 text-xs">{kindLabel(model.kind)}</span>
        <span className="text-xs text-slate-400">created {formatDate(model.created_at)}</span>
      </header>

      <dl className="grid grid-cols-2 gap-x-6 gap-y-2 md:grid-cols-4">
        <div>
          <dt className={dt}>Base weights</dt>
          <dd className={`${dd} font-mono`}>{model.base_weights ?? "\u2013"}</dd>
        </div>
        <div>
          <dt className={dt}>Dataset</dt>
          <dd className={dd}>{model.dataset_id ? (datasetNames[model.dataset_id] ?? model.dataset_id) : "\u2013"}</dd>
        </div>
        <div>
          <dt className={dt}>Weights</dt>
          <dd className={`${dd} font-mono`}>{model.weights_path}</dd>
        </div>
        <div>
          <dt className={dt}>Training job</dt>
          <dd className={`${dd} font-mono`}>{model.run_id ? model.run_id.slice(0, 8) : "\u2013"}</dd>
        </div>
      </dl>

      {Object.keys(model.hyperparameters).length > 0 && (
        <p className="font-mono text-xs text-slate-400">{JSON.stringify(model.hyperparameters)}</p>
      )}

      <div className="flex flex-col gap-1">
        <h3 className="text-sm font-medium">Classes</h3>
        <p className="text-sm text-slate-300">{model.class_names.join(", ") || "\u2013"}</p>
        {aliases.length > 0 && (
          <p className="text-xs text-slate-400">
            Aliases: {aliases.map(([from, to]) => `${from} \u2192 ${to}`).join(", ")}
          </p>
        )}
      </div>

      <div className="flex flex-col gap-2">
        <h3 className="text-sm font-medium">Metrics</h3>
        {metrics ? (
          <>
            <dl className="grid grid-cols-4 gap-2">
              {(
                [
                  ["mAP50", metrics.map50],
                  ["mAP50-95", metrics.map50_95],
                  ["Precision", metrics.precision],
                  ["Recall", metrics.recall],
                ] as const
              ).map(([label, value]) => (
                <div key={label} className="rounded bg-slate-900 px-3 py-2">
                  <dt className={dt}>{label}</dt>
                  <dd className="text-lg tabular-nums">{formatMetric(value)}</dd>
                </div>
              ))}
            </dl>
            <table data-testid="class-metrics" className="w-full text-left text-sm">
              <thead>
                <tr className="text-xs uppercase text-slate-500">
                  <th className="px-2 py-1 font-medium">Class</th>
                  <th className="px-2 py-1 font-medium">mAP50</th>
                  <th className="px-2 py-1 font-medium">mAP50-95</th>
                  <th className="px-2 py-1 font-medium">Precision</th>
                  <th className="px-2 py-1 font-medium">Recall</th>
                </tr>
              </thead>
              <tbody>
                {metrics.per_class.map((c) => (
                  <tr key={c.class_name} className="border-t border-slate-800">
                    <td className="px-2 py-1">{c.class_name}</td>
                    <td className="px-2 py-1 tabular-nums">{formatMetric(c.map50)}</td>
                    <td className="px-2 py-1 tabular-nums">{formatMetric(c.map50_95)}</td>
                    <td className="px-2 py-1 tabular-nums">{formatMetric(c.precision)}</td>
                    <td className="px-2 py-1 tabular-nums">{formatMetric(c.recall)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </>
        ) : (
          <p className="text-sm text-slate-400">No metrics: imported weights are not evaluated on a project dataset.</p>
        )}
      </div>

      <div className="flex flex-col gap-2">
        <h3 className="text-sm font-medium">Training artifacts</h3>
        <ModelArtifacts projectId={projectId} model={model} />
      </div>

      {/* actions (Task 7): exports, pre-annotation, delete */}
      <div data-slot="model-actions" hidden>
        {String(Boolean(project && onProjectSaved && onChanged && onDeleted))}
      </div>
    </section>
  );
}
```

The hidden `data-slot` div only exists so the unused props do not fail `noUnusedParameters` until Task 7 replaces it with the actions block.

- [ ] **Step 7: Replace `screens/ModelsScreen.tsx`**

```tsx
import { useCallback } from "react";
import { useParams, useSearchParams } from "react-router-dom";
import { useProject } from "@/api/project";
import { ModelDetail } from "@/models/ModelDetail";
import { ModelTable } from "@/models/ModelTable";
import { useDatasetNames } from "@/models/useDatasetNames";
import { useModels } from "@/models/useModels";

export function ModelsScreen() {
  const { projectId = "" } = useParams();
  const { project, error: projectError, setProject } = useProject(projectId);
  const registry = useModels(projectId);
  const datasetNames = useDatasetNames(projectId);
  const [params, setParams] = useSearchParams();
  const selectedId = params.get("model");
  const selected = registry.models.find((m) => m.id === selectedId) ?? null;

  const select = useCallback(
    (id: string | null) => setParams(id ? { model: id } : {}, { replace: true }),
    [setParams],
  );

  return (
    <section className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-2xl font-semibold">Models</h1>
        <span className="text-xs text-slate-400">
          {registry.loading ? "Loading\u2026" : `${registry.models.length} in the registry`}
        </span>
        {/* import button (Task 7) */}
      </div>
      {projectError && (
        <p role="alert" className="rounded border border-red-800 bg-red-950 px-3 py-2 text-sm text-red-200">
          {projectError}
        </p>
      )}
      {registry.error && (
        <p role="alert" className="rounded border border-red-800 bg-red-950 px-3 py-2 text-sm text-red-200">
          {registry.error}
        </p>
      )}
      {registry.unavailable && (
        <p role="note" className="rounded border border-slate-700 bg-slate-800/60 px-3 py-2 text-sm text-slate-300">
          The model registry is not available yet (it arrives with the training backend).
        </p>
      )}
      {/* import form (Task 7) */}
      {!registry.unavailable && (
        <ModelTable models={registry.models} datasetNames={datasetNames} selectedId={selectedId} onSelect={select} />
      )}
      {!registry.loading && !registry.unavailable && registry.models.length === 0 && (
        <p className="text-sm text-slate-400">No models yet. Import COCO weights or train one on a dataset.</p>
      )}
      {selected && project && (
        <ModelDetail
          key={selected.id}
          projectId={projectId}
          model={selected}
          project={project}
          datasetNames={datasetNames}
          onProjectSaved={setProject}
          onChanged={registry.replace}
          onDeleted={(id) => {
            registry.remove(id);
            select(null);
          }}
        />
      )}
    </section>
  );
}
```

- [ ] **Step 8: Run the tests to verify they pass**

Run: `pnpm test src/models src/screens/ModelsScreen.test.tsx`
Expected: `ModelArtifacts` 2 passed, `ModelsScreen` 3 passed; Task 5 tests still green.

- [ ] **Step 9: Format, lint, type-check and commit**

Run: `pnpm format && pnpm lint && pnpm exec tsc -b`

```bash
git add src/test/fixtures.ts src/models/ModelTable.tsx src/models/TrainingCurve.tsx src/models/ModelArtifacts.tsx src/models/ModelArtifacts.test.tsx src/models/ModelDetail.tsx src/screens/ModelsScreen.tsx src/screens/ModelsScreen.test.tsx
git commit -m "feat(ui): model registry screen with per-class metrics, artifacts and training curve"
```

---

### Task 7: Registry actions: import weights, export, delete, use as pre-annotation model

**Files:**
- Create: `frontend/src/models/ImportModelForm.tsx`, `frontend/src/models/ExportButtons.tsx`
- Modify: `frontend/src/models/ModelDetail.tsx` (replace the `data-slot="model-actions"` div), `frontend/src/screens/ModelsScreen.tsx` (import button and form)
- Test: `frontend/src/models/ImportModelForm.test.tsx`, `frontend/src/models/ModelDetail.test.tsx`

**Interfaces:**
- Consumes: `importModel`, `exportModel`, `deleteModel` (Task 1), `patchProject` (S2), `useTrackedJob`, `JobCard` (Tasks 3-4), `parseAliases`, `formatAliases`, `DEFAULT_ALIASES` (Task 5), `useBackend().mode` for the Tauri dialog.
- Produces:
  - `ImportModelForm({projectId, onImported, onClose}: {projectId: string; onImported: (m: Model) => void; onClose: () => void})`: `<form role="dialog" aria-label="Import weights">` with `aria-label="Model name"`, `aria-label="Weights path"` (plus a "Browse" button in tauri mode opening `@tauri-apps/plugin-dialog` `open({filters: [{name: "PyTorch weights", extensions: ["pt"]}]})`), `aria-label="Class aliases"` textarea prefilled with `truck=dump_truck`, buttons "Import" and "Cancel"; posts `{name, weights_path, class_aliases}`.
  - `ExportButtons({projectId, model}: {projectId: string; model: Model})`: lists `model.exports`, buttons "Export ONNX" (`{format: "onnx", imgsz: 1280, half: false}`) and "Export TensorRT" (`{format: "engine", imgsz: 1280, half: false}`); the returned job is `upsert`ed and rendered as a `JobCard` under the buttons.
  - `ModelDetail` actions: `ExportButtons`; "Use as pre-annotation model" (`PATCH /projects/{p}` `{preannotation_model_id}`, calls `onProjectSaved`) replaced by the badge "Pre-annotation model" when `project.preannotation_model_id === model.id`; "Delete model" revealing "Delete permanently" / "Cancel" (`DELETE`, then `onDeleted(model.id)`).
  - `ModelsScreen`: "Import weights" button toggling the form; `onImported` calls `registry.replace(model)`, closes the form and selects the model.

- [ ] **Step 1: Write the failing tests**

`frontend/src/models/ImportModelForm.test.tsx`:

```tsx
import { describe, it, expect, vi } from "vitest";
import { screen, fireEvent, waitFor } from "@testing-library/react";
import { errorBody, exampleModel, fakeClient, PROJECT_ID } from "@/test/fixtures";
import { renderWithProviders } from "@/test/render";
import { ImportModelForm } from "./ImportModelForm";

describe("ImportModelForm", () => {
  it("posts name, path and parsed aliases, then reports the model", async () => {
    const { api, requests } = fakeClient([{ method: "POST", path: /\/models\/import$/, status: 201, body: exampleModel }]);
    const onImported = vi.fn();
    renderWithProviders(<ImportModelForm projectId={PROJECT_ID} onImported={onImported} onClose={() => {}} />, { api });
    expect(screen.getByLabelText("Class aliases")).toHaveValue("truck=dump_truck");
    expect(screen.queryByRole("button", { name: "Browse" })).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Model name"), { target: { value: "yolo11m-coco" } });
    fireEvent.change(screen.getByLabelText("Weights path"), { target: { value: "E:\\Dev\\Yolo\\models\\yolo11m.pt" } });
    fireEvent.change(screen.getByLabelText("Class aliases"), { target: { value: "truck=dump_truck\ncar=wheel_loader" } });
    fireEvent.click(screen.getByRole("button", { name: "Import" }));
    await waitFor(() => expect(onImported).toHaveBeenCalledWith(exampleModel));
    expect(requests[0].body).toEqual({
      name: "yolo11m-coco",
      weights_path: "E:\\Dev\\Yolo\\models\\yolo11m.pt",
      class_aliases: { truck: "dump_truck", car: "wheel_loader" },
    });
  });

  it("shows the envelope message when the path is rejected", async () => {
    const { api } = fakeClient([
      { method: "POST", path: /\/models\/import$/, status: 404, body: errorBody("not_found", "weights file not found") },
    ]);
    renderWithProviders(<ImportModelForm projectId={PROJECT_ID} onImported={() => {}} onClose={() => {}} />, { api });
    fireEvent.change(screen.getByLabelText("Model name"), { target: { value: "x" } });
    fireEvent.change(screen.getByLabelText("Weights path"), { target: { value: "E:\\nope.pt" } });
    fireEvent.click(screen.getByRole("button", { name: "Import" }));
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("weights file not found"));
  });
});
```

`frontend/src/models/ModelDetail.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, fireEvent, waitFor } from "@testing-library/react";
import { exampleModel, exampleProject, exampleTrainedModel, fakeClient, PROJECT_ID, runningJob, TRAINED_MODEL_ID } from "@/test/fixtures";
import { renderWithProviders } from "@/test/render";
import { useJobsStore } from "@/store/jobs";
import { ModelDetail } from "./ModelDetail";

const noop = () => {};

describe("ModelDetail actions", () => {
  beforeEach(() => useJobsStore.setState({ jobs: {}, panelOpen: false }));

  it("starts an export job and shows it as a job card", async () => {
    const { api, requests } = fakeClient([
      { method: "POST", path: /\/export$/, status: 202, body: { job: { ...runningJob, type: "export", params: { model_id: TRAINED_MODEL_ID, format: "onnx" } } } },
      { method: "GET", path: /\/jobs\/[^/]+$/, body: { ...runningJob, type: "export" } },
    ]);
    renderWithProviders(
      <ModelDetail projectId={PROJECT_ID} model={exampleTrainedModel} project={exampleProject} datasetNames={{}} onProjectSaved={noop} onChanged={noop} onDeleted={noop} />,
      { api },
    );
    expect(screen.getByText("models/ahmadia-v1-n.onnx")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Export ONNX" }));
    await waitFor(() => expect(screen.getByTestId(`job-${runningJob.id}`)).toBeInTheDocument());
    expect(requests[0]).toMatchObject({
      method: "POST",
      url: `/api/v1/projects/${PROJECT_ID}/models/${TRAINED_MODEL_ID}/export`,
      body: { format: "onnx", imgsz: 1280, half: false },
    });
    expect(useJobsStore.getState().jobs[runningJob.id].type).toBe("export");
  });

  it("sets the pre-annotation model through PATCH and shows the badge when current", async () => {
    const { api, requests } = fakeClient([
      { method: "PATCH", path: /\/projects\/[^/]+$/, body: { ...exampleProject, preannotation_model_id: TRAINED_MODEL_ID } },
    ]);
    const onProjectSaved = vi.fn();
    const { rerender } = renderWithProviders(
      <ModelDetail projectId={PROJECT_ID} model={exampleTrainedModel} project={exampleProject} datasetNames={{}} onProjectSaved={onProjectSaved} onChanged={noop} onDeleted={noop} />,
      { api },
    );
    fireEvent.click(screen.getByRole("button", { name: "Use as pre-annotation model" }));
    await waitFor(() => expect(onProjectSaved).toHaveBeenCalled());
    expect(requests[0]).toMatchObject({ method: "PATCH", body: { preannotation_model_id: TRAINED_MODEL_ID } });
    rerender(
      <ModelDetail projectId={PROJECT_ID} model={exampleModel} project={exampleProject} datasetNames={{}} onProjectSaved={onProjectSaved} onChanged={noop} onDeleted={noop} />,
    );
    expect(screen.getByText("Pre-annotation model")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Use as pre-annotation model" })).not.toBeInTheDocument();
  });

  it("deletes only after confirmation", async () => {
    const { api, requests } = fakeClient([{ method: "DELETE", path: /\/models\/[^/]+$/, status: 204 }]);
    const onDeleted = vi.fn();
    renderWithProviders(
      <ModelDetail projectId={PROJECT_ID} model={exampleTrainedModel} project={exampleProject} datasetNames={{}} onProjectSaved={noop} onChanged={noop} onDeleted={onDeleted} />,
      { api },
    );
    fireEvent.click(screen.getByRole("button", { name: "Delete model" }));
    expect(requests).toHaveLength(0);
    expect(screen.getByText(/Delete ahmadia-v1-n\?/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Delete permanently" }));
    await waitFor(() => expect(onDeleted).toHaveBeenCalledWith(TRAINED_MODEL_ID));
    expect(requests[0]).toMatchObject({ method: "DELETE", url: `/api/v1/projects/${PROJECT_ID}/models/${TRAINED_MODEL_ID}` });
  });
});
```

Note: `rerender` from `renderWithProviders` re-renders the element inside the same providers; `renderWithProviders` returns Testing Library's render result, so `rerender` is available. Because the second `ModelDetail` is rendered without the router `path` option, it is rendered directly inside `MemoryRouter`, which is what the first render did too (no `path` passed).

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm test src/models/ImportModelForm.test.tsx src/models/ModelDetail.test.tsx`
Expected: `ImportModelForm` unresolved; `ModelDetail` fails on "Export ONNX" not found.

- [ ] **Step 3: Implement `ImportModelForm.tsx`**

```tsx
import { useCallback, useState, type FormEvent } from "react";
import type { Model } from "@contract/client";
import { useApi, useBackend } from "@/api/client";
import { messageOf } from "@/api/errors";
import { importModel } from "@/api/models";
import { pushLog } from "@/app/diagnostics";
import { DEFAULT_ALIASES, formatAliases, parseAliases } from "./aliases";

interface Props {
  projectId: string;
  onImported: (model: Model) => void;
  onClose: () => void;
}

const input = "rounded border border-slate-700 bg-slate-800 px-2 py-1 text-sm";
const primary = "rounded bg-orange-600 px-3 py-1 text-sm font-medium hover:bg-orange-500 disabled:opacity-50";
const secondary = "rounded border border-slate-700 px-3 py-1 text-sm hover:bg-slate-800 disabled:opacity-50";

function baseName(path: string): string {
  return path.split(/[\\/]/).pop()?.replace(/\.pt$/i, "") ?? "";
}

/** Register existing `.pt` weights (spec section 7). Native file dialog inside Tauri, text field elsewhere. */
export function ImportModelForm({ projectId, onImported, onClose }: Props) {
  const api = useApi();
  const { mode } = useBackend();
  const [name, setName] = useState("");
  const [path, setPath] = useState("");
  const [aliases, setAliases] = useState(formatAliases(DEFAULT_ALIASES));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const browse = useCallback(async () => {
    const { open } = await import("@tauri-apps/plugin-dialog");
    const picked = await open({
      multiple: false,
      directory: false,
      filters: [{ name: "PyTorch weights", extensions: ["pt"] }],
    });
    if (typeof picked === "string") {
      setPath(picked);
      setName((n) => n || baseName(picked));
    }
  }, []);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const model = await importModel(api, projectId, {
        name: name.trim(),
        weights_path: path.trim(),
        class_aliases: parseAliases(aliases),
      });
      onImported(model);
    } catch (err) {
      pushLog(`import model failed: ${messageOf(err, String(err))}`);
      setError(messageOf(err, "could not import the weights"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form
      role="dialog"
      aria-label="Import weights"
      onSubmit={(e) => void submit(e)}
      className="flex flex-col gap-3 rounded border border-slate-700 bg-slate-800/60 p-4"
    >
      <h2 className="text-lg font-medium">Import weights</h2>
      <p className="text-sm text-slate-400">
        The file is copied into the project's models folder. Aliases map the weights' class names to project
        classes, one per line (COCO weights: truck=dump_truck); unmapped classes are dropped.
      </p>
      <label className="flex flex-col gap-1 text-xs text-slate-400">
        Name
        <input aria-label="Model name" required value={name} onChange={(e) => setName(e.target.value)} className={input} />
      </label>
      <label className="flex flex-col gap-1 text-xs text-slate-400">
        Weights path (.pt)
        <div className="flex gap-2">
          <input
            aria-label="Weights path"
            required
            value={path}
            onChange={(e) => setPath(e.target.value)}
            placeholder="E:\Dev\Yolo\models\yolo11m.pt"
            className={`${input} min-w-0 flex-1 font-mono`}
          />
          {mode === "tauri" && (
            <button type="button" className={secondary} onClick={() => void browse()}>
              Browse
            </button>
          )}
        </div>
      </label>
      <label className="flex flex-col gap-1 text-xs text-slate-400">
        Class aliases
        <textarea
          aria-label="Class aliases"
          rows={3}
          value={aliases}
          onChange={(e) => setAliases(e.target.value)}
          className={`${input} font-mono`}
        />
      </label>
      {error && (
        <p role="alert" className="text-xs text-red-300">
          {error}
        </p>
      )}
      <div className="flex gap-2">
        <button type="submit" className={primary} disabled={busy}>
          Import
        </button>
        <button type="button" className={secondary} onClick={onClose} disabled={busy}>
          Cancel
        </button>
      </div>
    </form>
  );
}
```

- [ ] **Step 4: Implement `ExportButtons.tsx`**

```tsx
import { useState } from "react";
import type { Model } from "@contract/client";
import { useApi } from "@/api/client";
import { messageOf } from "@/api/errors";
import { exportModel, type ExportFormat } from "@/api/models";
import { pushLog } from "@/app/diagnostics";
import { JobCard } from "@/jobs/JobCard";
import { useTrackedJob } from "@/jobs/useTrackedJob";
import { useJobsStore } from "@/store/jobs";

const btn = "rounded border border-slate-700 px-3 py-1 text-sm hover:bg-slate-800 disabled:opacity-50";

/** Spec section 7: ONNX and TensorRT exports run as jobs; the path lands in `model.exports[format]`. */
export function ExportButtons({ projectId, model }: { projectId: string; model: Model }) {
  const api = useApi();
  const [jobId, setJobId] = useState<string | null>(null);
  const [busy, setBusy] = useState<ExportFormat | null>(null);
  const [error, setError] = useState<string | null>(null);
  const job = useTrackedJob(projectId, jobId);
  const exports = Object.entries(model.exports);

  async function start(format: ExportFormat) {
    setBusy(format);
    setError(null);
    try {
      const j = await exportModel(api, projectId, model.id, { format, imgsz: 1280, half: false });
      useJobsStore.getState().upsert(j);
      setJobId(j.id);
    } catch (e) {
      pushLog(`export ${format} of ${model.id} failed: ${messageOf(e, String(e))}`);
      setError(messageOf(e, "could not start the export"));
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="flex flex-col gap-2">
      <h3 className="text-sm font-medium">Exports</h3>
      {exports.length > 0 ? (
        <ul className="text-sm">
          {exports.map(([format, path]) => (
            <li key={format} className="flex gap-2">
              <span className="w-16 uppercase text-slate-400">{format}</span>
              <span className="font-mono text-xs">{path}</span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-xs text-slate-400">Not exported yet.</p>
      )}
      <div className="flex gap-2">
        <button type="button" className={btn} onClick={() => void start("onnx")} disabled={busy !== null}>
          Export ONNX
        </button>
        <button type="button" className={btn} onClick={() => void start("engine")} disabled={busy !== null}>
          Export TensorRT
        </button>
      </div>
      {error && (
        <p role="alert" className="text-xs text-red-300">
          {error}
        </p>
      )}
      {job && <JobCard projectId={projectId} job={job} />}
    </div>
  );
}
```

- [ ] **Step 5: Add the actions to `ModelDetail.tsx`**

Add the imports `import { useState } from "react";`, `import { useApi } from "@/api/client";`, `import { messageOf } from "@/api/errors";`, `import { deleteModel } from "@/api/models";`, `import { patchProject } from "@/api/project";`, `import { pushLog } from "@/app/diagnostics";`, `import { ExportButtons } from "./ExportButtons";`. Add this state and these handlers at the top of the component body (after `const aliases = ...`):

```tsx
  const api = useApi();
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const isPreannotation = project.preannotation_model_id === model.id;

  async function usePreannotation() {
    setBusy(true);
    setError(null);
    setStatus(null);
    try {
      onProjectSaved(await patchProject(api, projectId, { preannotation_model_id: model.id }));
      setStatus("Pre-annotation model set");
    } catch (e) {
      pushLog(`set preannotation model failed: ${messageOf(e, String(e))}`);
      setError(messageOf(e, "could not set the pre-annotation model"));
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    setBusy(true);
    setError(null);
    try {
      await deleteModel(api, projectId, model.id);
      onDeleted(model.id);
    } catch (e) {
      pushLog(`delete model ${model.id} failed: ${messageOf(e, String(e))}`);
      setError(messageOf(e, "could not delete the model"));
      setBusy(false);
    }
  }
```

Replace the hidden `data-slot="model-actions"` div with:

```tsx
      <ExportButtons projectId={projectId} model={model} />

      <div className="flex flex-col gap-2 border-t border-slate-800 pt-3">
        <div className="flex flex-wrap items-center gap-2">
          {isPreannotation ? (
            <span className="rounded bg-emerald-800 px-2 py-0.5 text-xs text-emerald-100">Pre-annotation model</span>
          ) : (
            <button type="button" className={btn} onClick={() => void usePreannotation()} disabled={busy}>
              Use as pre-annotation model
            </button>
          )}
          {!confirming && (
            <button type="button" className={danger} onClick={() => setConfirming(true)} disabled={busy}>
              Delete model
            </button>
          )}
          {status && (
            <span role="status" className="text-xs text-emerald-300">
              {status}
            </span>
          )}
        </div>
        {confirming && (
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <span>Delete {model.name}? Its weights and exports are removed; boxes keep their provenance.</span>
            <button type="button" className={danger} onClick={() => void remove()} disabled={busy}>
              Delete permanently
            </button>
            <button type="button" className={btn} onClick={() => setConfirming(false)} disabled={busy}>
              Cancel
            </button>
          </div>
        )}
        {error && (
          <p role="alert" className="text-xs text-red-300">
            {error}
          </p>
        )}
      </div>
```

and add next to the `dt`/`dd` constants:

```tsx
const btn = "rounded border border-slate-700 px-3 py-1 text-sm hover:bg-slate-800 disabled:opacity-50";
const danger = "rounded bg-red-800 px-3 py-1 text-sm hover:bg-red-700 disabled:opacity-50";
```

`onChanged` stays in the props (the screen passes `registry.replace`) for the export job's completion: when the tracked export job succeeds, `ExportButtons` cannot know the new `exports` map, so add to `ExportButtons` a prop `onFinished?: () => void` called once when `job.state === "succeeded"`, and in `ModelDetail` pass `onFinished={() => void fetchModel(api, projectId, model.id).then(onChanged).catch((e: unknown) => pushLog(`refresh model failed: ${messageOf(e, String(e))}`))}` (import `fetchModel` from `@/api/models`). Inside `ExportButtons`, call it from a `useEffect` keyed on `job?.state`:

```tsx
  const finished = job?.state === "succeeded";
  useEffect(() => {
    if (finished) onFinished?.();
  }, [finished, onFinished]);
```

with `onFinished` declared in the props interface as `onFinished?: () => void` and destructured. Wrap the handler in `ModelDetail` with `useCallback` (deps `[api, projectId, model.id, onChanged]`) so the effect does not re-fire on every render.

- [ ] **Step 6: Add the import button and form to `ModelsScreen.tsx`**

Add `import { useState } from "react";` alongside `useCallback`, `import type { Model } from "@contract/client";` and `import { ImportModelForm } from "@/models/ImportModelForm";`. Add state `const [importing, setImporting] = useState(false);` and the handler:

```tsx
  const onImported = useCallback(
    (model: Model) => {
      registry.replace(model);
      setImporting(false);
      select(model.id);
    },
    [registry, select],
  );
```

Replace the `{/* import button (Task 7) */}` comment with:

```tsx
        <button
          type="button"
          onClick={() => setImporting((v) => !v)}
          disabled={registry.unavailable}
          className="ml-auto rounded bg-orange-600 px-3 py-1 text-sm font-medium hover:bg-orange-500 disabled:opacity-50"
        >
          Import weights
        </button>
```

and the `{/* import form (Task 7) */}` comment with:

```tsx
      {importing && (
        <ImportModelForm projectId={projectId} onImported={onImported} onClose={() => setImporting(false)} />
      )}
```

`registry` is an object recreated every render; to keep `onImported` stable list `registry.replace` instead: `const replace = registry.replace;` above the callback and use `[replace, select]` as deps.

- [ ] **Step 7: Run the tests to verify they pass**

Run: `pnpm test src/models src/screens/ModelsScreen.test.tsx`
Expected: `ImportModelForm` 2, `ModelDetail` 3 passed; the rest still green.

- [ ] **Step 8: Format, lint, type-check and commit**

Run: `pnpm format && pnpm lint && pnpm exec tsc -b`

```bash
git add src/models/ImportModelForm.tsx src/models/ImportModelForm.test.tsx src/models/ExportButtons.tsx src/models/ModelDetail.tsx src/models/ModelDetail.test.tsx src/screens/ModelsScreen.tsx
git commit -m "feat(ui): import weights, export, delete and pre-annotation actions in the registry"
```

---

### Task 8: Training form model, dataset hook and the parameter form

**Files:**
- Create: `frontend/src/train/trainModel.ts`, `frontend/src/train/useDatasets.ts`, `frontend/src/train/TrainForm.tsx`
- Test: `frontend/src/train/trainModel.test.ts`, `frontend/src/train/TrainForm.test.tsx`

**Interfaces:**
- Consumes: `fetchDatasets` (Task 1), `useModels` (Task 5), `Dataset`, `Model`, `TrainRequest` types.
- Produces:
  - `trainModel.ts`: `interface TrainForm {name: string; datasetId: string; baseModelId: string; epochs: string; imgsz: string; batchAuto: boolean; batch: string; patience: string; augmentation: "default" | "aerial"; device: string}` (numbers are kept as strings so an emptied field never becomes `NaN`), `DEFAULT_TRAIN_FORM` (`epochs "50"`, `imgsz "1280"`, `batchAuto true`, `batch "16"`, `patience "50"`, `augmentation "default"`, `device "0"`), `validateTrainForm(f): string | null`, `toTrainRequest(f): TrainRequest` (`batch: null` when auto), `parseEpochMessage(message): {epoch: number; epochs: number; map50: number | null} | null` (matches the backend's `epoch 3/50 mAP50 0.612` / `epoch 3/50`), `suggestName(dataset: Dataset | undefined, base: Model | undefined): string` (`{dataset.name}-{base.name}`).
  - `useDatasets.ts`: `interface DatasetsList {datasets: Dataset[]; loading: boolean; unavailable: boolean; error: string | null; reload(): void}`, `useDatasets(projectId): DatasetsList` (501 -> `unavailable`).
  - `TrainForm.tsx`: `TrainForm({projectId, datasets, models, datasetsUnavailable, modelsUnavailable, busy, onStart}: {projectId: string; datasets: Dataset[]; models: Model[]; datasetsUnavailable: boolean; modelsUnavailable: boolean; busy: boolean; onStart: (req: TrainRequest) => void})`: selects `aria-label="Dataset"`, `aria-label="Base model"`, `aria-label="Augmentation"`, `aria-label="Device"`; inputs `aria-label="Model name"`, `"Epochs"`, `"Image size"`, `"Batch size"` with a checkbox `aria-label="Automatic batch size"`, `"Patience"`; a "Create dataset" link to `/p/{projectId}/data`; submit button "Start training"; validation message in `role="alert"`; the first dataset and model are preselected when the lists arrive (the parent remounts the form with a `key`).

- [ ] **Step 1: Write the failing tests**

`frontend/src/train/trainModel.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { exampleDataset, exampleModel } from "@/test/fixtures";
import { DEFAULT_TRAIN_FORM, parseEpochMessage, suggestName, toTrainRequest, validateTrainForm } from "./trainModel";

const valid = { ...DEFAULT_TRAIN_FORM, name: "ahmadia-v1-n", datasetId: "d1", baseModelId: "m1" };

describe("train form model", () => {
  it("maps the form to the contract request with auto batch as null", () => {
    expect(toTrainRequest(valid)).toEqual({
      name: "ahmadia-v1-n",
      dataset_id: "d1",
      base_model_id: "m1",
      epochs: 50,
      imgsz: 1280,
      batch: null,
      patience: 50,
      augmentation: "default",
      device: "0",
    });
    expect(toTrainRequest({ ...valid, batchAuto: false, batch: "8", epochs: "3", augmentation: "aerial", device: "cpu" })).toMatchObject({
      batch: 8,
      epochs: 3,
      augmentation: "aerial",
      device: "cpu",
    });
  });

  it("validates every field", () => {
    expect(validateTrainForm(valid)).toBeNull();
    expect(validateTrainForm({ ...valid, datasetId: "" })).toBe("Choose a dataset.");
    expect(validateTrainForm({ ...valid, baseModelId: "" })).toBe("Choose a base model.");
    expect(validateTrainForm({ ...valid, name: "  " })).toBe("Give the model a name.");
    expect(validateTrainForm({ ...valid, epochs: "0" })).toBe("Epochs must be a whole number from 1 to 1000.");
    expect(validateTrainForm({ ...valid, epochs: "2.5" })).toBe("Epochs must be a whole number from 1 to 1000.");
    expect(validateTrainForm({ ...valid, imgsz: "100" })).toBe("Image size must be a whole number from 320 to 4096.");
    expect(validateTrainForm({ ...valid, batchAuto: false, batch: "" })).toBe("Batch size must be a whole number of at least 1, or automatic.");
    expect(validateTrainForm({ ...valid, batchAuto: true, batch: "" })).toBeNull();
    expect(validateTrainForm({ ...valid, patience: "-1" })).toBe("Patience must be a whole number of at least 0.");
  });

  it("parses the backend's epoch messages", () => {
    expect(parseEpochMessage("epoch 3/50 mAP50 0.612")).toEqual({ epoch: 3, epochs: 50, map50: 0.612 });
    expect(parseEpochMessage("epoch 1/3")).toEqual({ epoch: 1, epochs: 3, map50: null });
    expect(parseEpochMessage("1386 / 3299 images")).toBeNull();
    expect(parseEpochMessage("")).toBeNull();
  });

  it("suggests a name from the dataset and the base model", () => {
    expect(suggestName(exampleDataset, exampleModel)).toBe("v1-yolo11m-coco");
    expect(suggestName(undefined, exampleModel)).toBe("");
  });
});
```

`frontend/src/train/TrainForm.test.tsx`:

```tsx
import { describe, it, expect, vi } from "vitest";
import { screen, fireEvent } from "@testing-library/react";
import { exampleDataset, exampleModel, exampleTrainedModel, fakeClient, PROJECT_ID } from "@/test/fixtures";
import { renderWithProviders } from "@/test/render";
import { TrainForm } from "./TrainForm";

describe("TrainForm", () => {
  it("preselects the first dataset and model, suggests a name and submits the request", () => {
    const { api } = fakeClient([]);
    const onStart = vi.fn();
    renderWithProviders(
      <TrainForm
        projectId={PROJECT_ID}
        datasets={[exampleDataset]}
        models={[exampleModel, exampleTrainedModel]}
        datasetsUnavailable={false}
        modelsUnavailable={false}
        busy={false}
        onStart={onStart}
      />,
      { api },
    );
    expect(screen.getByLabelText("Dataset")).toHaveValue(exampleDataset.id);
    expect(screen.getByLabelText("Base model")).toHaveValue(exampleModel.id);
    expect(screen.getByLabelText("Model name")).toHaveValue("v1-yolo11m-coco");
    expect(screen.getByLabelText("Image size")).toHaveValue(1280);
    expect(screen.getByLabelText("Automatic batch size")).toBeChecked();
    expect(screen.getByLabelText("Batch size")).toBeDisabled();
    expect(screen.getByRole("link", { name: "Create dataset" })).toHaveAttribute("href", `/p/${PROJECT_ID}/data`);
    expect(screen.getByText(/30 images/)).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Epochs"), { target: { value: "3" } });
    fireEvent.change(screen.getByLabelText("Augmentation"), { target: { value: "aerial" } });
    fireEvent.click(screen.getByLabelText("Automatic batch size"));
    fireEvent.change(screen.getByLabelText("Batch size"), { target: { value: "8" } });
    fireEvent.click(screen.getByRole("button", { name: "Start training" }));
    expect(onStart).toHaveBeenCalledWith({
      name: "v1-yolo11m-coco",
      dataset_id: exampleDataset.id,
      base_model_id: exampleModel.id,
      epochs: 3,
      imgsz: 1280,
      batch: 8,
      patience: 50,
      augmentation: "aerial",
      device: "0",
    });
  });

  it("refuses an invalid form and explains missing datasets", () => {
    const { api } = fakeClient([]);
    const onStart = vi.fn();
    renderWithProviders(
      <TrainForm
        projectId={PROJECT_ID}
        datasets={[]}
        models={[exampleModel]}
        datasetsUnavailable={true}
        modelsUnavailable={false}
        busy={false}
        onStart={onStart}
      />,
      { api },
    );
    expect(screen.getByRole("note")).toHaveTextContent("Datasets are not available yet");
    fireEvent.change(screen.getByLabelText("Model name"), { target: { value: "x" } });
    fireEvent.click(screen.getByRole("button", { name: "Start training" }));
    expect(onStart).not.toHaveBeenCalled();
    expect(screen.getByRole("alert")).toHaveTextContent("Choose a dataset.");
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm test src/train`
Expected: both files fail with unresolved imports.

- [ ] **Step 3: Implement `trainModel.ts`**

```ts
import type { Dataset, Model, TrainRequest } from "@contract/client";

export interface TrainForm {
  name: string;
  datasetId: string;
  baseModelId: string;
  epochs: string;
  imgsz: string;
  batchAuto: boolean;
  batch: string;
  patience: string;
  augmentation: "default" | "aerial";
  device: string;
}

/** Contract defaults for `TrainRequest` (spec section 7: image size 1280, batch auto). */
export const DEFAULT_TRAIN_FORM: TrainForm = {
  name: "",
  datasetId: "",
  baseModelId: "",
  epochs: "50",
  imgsz: "1280",
  batchAuto: true,
  batch: "16",
  patience: "50",
  augmentation: "default",
  device: "0",
};

function whole(text: string): number | null {
  if (!/^\d+$/.test(text.trim())) return null;
  return Number(text.trim());
}

export function validateTrainForm(f: TrainForm): string | null {
  if (!f.datasetId) return "Choose a dataset.";
  if (!f.baseModelId) return "Choose a base model.";
  if (!f.name.trim()) return "Give the model a name.";
  const epochs = whole(f.epochs);
  if (epochs === null || epochs < 1 || epochs > 1000) return "Epochs must be a whole number from 1 to 1000.";
  const imgsz = whole(f.imgsz);
  if (imgsz === null || imgsz < 320 || imgsz > 4096) return "Image size must be a whole number from 320 to 4096.";
  if (!f.batchAuto) {
    const batch = whole(f.batch);
    if (batch === null || batch < 1) return "Batch size must be a whole number of at least 1, or automatic.";
  }
  const patience = whole(f.patience);
  if (patience === null) return "Patience must be a whole number of at least 0.";
  return null;
}

/** Only call after `validateTrainForm` returned null. Every defaulted field is sent (generated client). */
export function toTrainRequest(f: TrainForm): TrainRequest {
  return {
    name: f.name.trim(),
    dataset_id: f.datasetId,
    base_model_id: f.baseModelId,
    epochs: Number(f.epochs),
    imgsz: Number(f.imgsz),
    batch: f.batchAuto ? null : Number(f.batch),
    patience: Number(f.patience),
    augmentation: f.augmentation,
    device: f.device,
  };
}

const EPOCH_MESSAGE = /^epoch (\d+)\/(\d+)(?: mAP50 ([\d.]+))?$/;

/** The trainer's `job.progress` message: `epoch 3/50 mAP50 0.612` (mAP50 absent before the first validation). */
export function parseEpochMessage(message: string): { epoch: number; epochs: number; map50: number | null } | null {
  const m = EPOCH_MESSAGE.exec(message.trim());
  if (!m) return null;
  return { epoch: Number(m[1]), epochs: Number(m[2]), map50: m[3] === undefined ? null : Number(m[3]) };
}

export function suggestName(dataset: Dataset | undefined, base: Model | undefined): string {
  if (!dataset || !base) return "";
  return `${dataset.name}-${base.name}`;
}
```

- [ ] **Step 4: Implement `useDatasets.ts`**

```ts
import { useCallback, useEffect, useState } from "react";
import type { Dataset } from "@contract/client";
import { useApi } from "@/api/client";
import { fetchDatasets } from "@/api/datasets";
import { isNotImplemented, messageOf } from "@/api/errors";
import { pushLog } from "@/app/diagnostics";

export interface DatasetsList {
  datasets: Dataset[];
  loading: boolean;
  unavailable: boolean;
  error: string | null;
  reload: () => void;
}

interface State {
  key: string;
  datasets: Dataset[];
  unavailable: boolean;
  error: string | null;
}

export function useDatasets(projectId: string): DatasetsList {
  const api = useApi();
  const [attempt, setAttempt] = useState(0);
  const key = `${projectId}|${attempt}`;
  const [state, setState] = useState<State>({ key: "", datasets: [], unavailable: false, error: null });

  useEffect(() => {
    let cancelled = false;
    fetchDatasets(api, projectId)
      .then((datasets) => {
        if (!cancelled) setState({ key, datasets, unavailable: false, error: null });
      })
      .catch((e: unknown) => {
        if (cancelled) return;
        pushLog(`load datasets failed: ${messageOf(e, String(e))}`);
        const unavailable = isNotImplemented(e);
        setState({ key, datasets: [], unavailable, error: unavailable ? null : messageOf(e, "could not load datasets") });
      });
    return () => {
      cancelled = true;
    };
  }, [api, projectId, key]);

  const reload = useCallback(() => setAttempt((a) => a + 1), []);
  const loaded = state.key === key;
  return {
    datasets: state.datasets,
    loading: !loaded,
    unavailable: loaded && state.unavailable,
    error: loaded ? state.error : null,
    reload,
  };
}
```

- [ ] **Step 5: Implement `TrainForm.tsx`**

```tsx
import { useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import type { Dataset, Model, TrainRequest } from "@contract/client";
import { kindLabel } from "@/models/modelLabels";
import { DEFAULT_TRAIN_FORM, suggestName, toTrainRequest, validateTrainForm, type TrainForm as Form } from "./trainModel";

interface Props {
  projectId: string;
  datasets: Dataset[];
  models: Model[];
  datasetsUnavailable: boolean;
  modelsUnavailable: boolean;
  busy: boolean;
  onStart: (req: TrainRequest) => void;
}

const input = "rounded border border-slate-700 bg-slate-800 px-2 py-1 text-sm disabled:opacity-50";
const label = "flex flex-col gap-1 text-xs text-slate-400";
const primary = "rounded bg-orange-600 px-3 py-1 text-sm font-medium hover:bg-orange-500 disabled:opacity-50";

/** Spec section 7 parameters. Mounted with a `key` by the screen so the preselection happens in the initialiser. */
export function TrainForm({ projectId, datasets, models, datasetsUnavailable, modelsUnavailable, busy, onStart }: Props) {
  const [form, setForm] = useState<Form>(() => ({
    ...DEFAULT_TRAIN_FORM,
    datasetId: datasets[0]?.id ?? "",
    baseModelId: models[0]?.id ?? "",
    name: suggestName(datasets[0], models[0]),
  }));
  const [error, setError] = useState<string | null>(null);
  const dataset = datasets.find((d) => d.id === form.datasetId);

  const patch = (p: Partial<Form>) => setForm((f) => ({ ...f, ...p }));

  function chooseDataset(datasetId: string) {
    setForm((f) => {
      const base = models.find((m) => m.id === f.baseModelId);
      const suggested = suggestName(datasets.find((d) => d.id === f.datasetId), base);
      const name = f.name === suggested ? suggestName(datasets.find((d) => d.id === datasetId), base) : f.name;
      return { ...f, datasetId, name };
    });
  }

  function chooseModel(baseModelId: string) {
    setForm((f) => {
      const current = datasets.find((d) => d.id === f.datasetId);
      const suggested = suggestName(current, models.find((m) => m.id === f.baseModelId));
      const name = f.name === suggested ? suggestName(current, models.find((m) => m.id === baseModelId)) : f.name;
      return { ...f, baseModelId, name };
    });
  }

  function submit(e: FormEvent) {
    e.preventDefault();
    const problem = validateTrainForm(form);
    setError(problem);
    if (!problem) onStart(toTrainRequest(form));
  }

  return (
    <form onSubmit={submit} className="flex max-w-3xl flex-col gap-4">
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        <label className={label}>
          Dataset
          <select
            aria-label="Dataset"
            value={form.datasetId}
            onChange={(e) => chooseDataset(e.target.value)}
            disabled={datasetsUnavailable}
            className={input}
          >
            <option value="">Choose a dataset</option>
            {datasets.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name} ({d.image_count} images, {d.split_method})
              </option>
            ))}
          </select>
          <span>
            {dataset
              ? `${dataset.image_count} images: ${dataset.train_count} train / ${dataset.val_count} val, ${dataset.classes.length} classes`
              : "Datasets are frozen from labeled images."}{" "}
            <Link to={`/p/${projectId}/data`} className="text-orange-300 hover:underline">
              Create dataset
            </Link>{" "}
            (select images in the Data Manager and use Add to dataset).
          </span>
        </label>
        <label className={label}>
          Base model
          <select
            aria-label="Base model"
            value={form.baseModelId}
            onChange={(e) => chooseModel(e.target.value)}
            disabled={modelsUnavailable}
            className={input}
          >
            <option value="">Choose a base model</option>
            {models.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name} ({kindLabel(m.kind)})
              </option>
            ))}
          </select>
          <span>Any registry model, including imported COCO weights.</span>
        </label>
      </div>
      {datasetsUnavailable && (
        <p role="note" className="text-xs text-slate-400">
          Datasets are not available yet (they arrive with the dataset backend).
        </p>
      )}
      {modelsUnavailable && (
        <p role="note" className="text-xs text-slate-400">
          The model registry is not available yet (it arrives with the training backend).
        </p>
      )}
      <label className={label}>
        Model name
        <input aria-label="Model name" value={form.name} onChange={(e) => patch({ name: e.target.value })} className={input} />
      </label>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <label className={label}>
          Epochs
          <input aria-label="Epochs" type="number" min={1} max={1000} value={form.epochs} onChange={(e) => patch({ epochs: e.target.value })} className={input} />
        </label>
        <label className={label}>
          Image size
          <input aria-label="Image size" type="number" min={320} max={4096} step={32} value={form.imgsz} onChange={(e) => patch({ imgsz: e.target.value })} className={input} />
        </label>
        <label className={label}>
          Batch size
          <input aria-label="Batch size" type="number" min={1} value={form.batch} disabled={form.batchAuto} onChange={(e) => patch({ batch: e.target.value })} className={input} />
          <span className="flex items-center gap-1">
            <input aria-label="Automatic batch size" type="checkbox" checked={form.batchAuto} onChange={(e) => patch({ batchAuto: e.target.checked })} />
            auto
          </span>
        </label>
        <label className={label}>
          Patience
          <input aria-label="Patience" type="number" min={0} value={form.patience} onChange={(e) => patch({ patience: e.target.value })} className={input} />
        </label>
        <label className={label}>
          Augmentation
          <select aria-label="Augmentation" value={form.augmentation} onChange={(e) => patch({ augmentation: e.target.value as Form["augmentation"] })} className={input}>
            <option value="default">default</option>
            <option value="aerial">aerial (flips both axes, 90 degree rotations)</option>
          </select>
        </label>
        <label className={label}>
          Device
          <select aria-label="Device" value={form.device} onChange={(e) => patch({ device: e.target.value })} className={input}>
            <option value="0">GPU 0</option>
            <option value="cpu">CPU</option>
          </select>
        </label>
      </div>
      {error && (
        <p role="alert" className="text-xs text-red-300">
          {error}
        </p>
      )}
      <button type="submit" className={`${primary} self-start`} disabled={busy}>
        Start training
      </button>
    </form>
  );
}
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `pnpm test src/train`
Expected: `trainModel` 4 passed, `TrainForm` 2 passed.

- [ ] **Step 7: Format, lint, type-check and commit**

Run: `pnpm format && pnpm lint && pnpm exec tsc -b`

```bash
git add src/train
git commit -m "feat(ui): training form with dataset and base model pickers"
```

---

### Task 9: Training progress card and the Train screen

**Files:**
- Create: `frontend/src/train/TrainProgress.tsx`
- Modify: `frontend/src/screens/TrainScreen.tsx` (replace the placeholder)
- Test: `frontend/src/train/TrainProgress.test.tsx`, `frontend/src/screens/TrainScreen.test.tsx`

**Interfaces:**
- Consumes: `trainModel` (Task 1), `useTrackedJob`, `useNow`, `JobCard`, `elapsedSeconds`, `formatDuration` (Tasks 3-4), `parseEpochMessage` (Task 8), `useDatasets`, `useModels`, `TrainForm`, `useJobsStore`.
- Produces:
  - `TrainProgress({projectId, jobId}: {projectId: string; jobId: string})`: `<section data-testid="train-progress">` with three tiles `data-testid="epoch"` (`3 / 50`, or an en dash), `data-testid="map50"` (`61.2%`), `data-testid="elapsed"`; a headline "Training finished: the model is registered." with the "Open model" link (from `JobCard`) on success, "Training failed." on failure, "Training cancelled." on cancel; `JobCard` with the log open (`showLog`).
  - `TrainScreen`: heading "Train"; `?job=` tracks a job (progress card + "New training" button clearing the param); otherwise `TrainForm`; `POST /models/train` on start, `upsert` the job, set `?job=`; 501 shows the note "Training is not available yet"; "Recent training jobs" list from the store (type `train`, newest first) with "Show" buttons.

- [ ] **Step 1: Write the failing tests**

`frontend/src/train/TrainProgress.test.tsx`:

```tsx
import { describe, it, expect, beforeEach } from "vitest";
import { screen } from "@testing-library/react";
import { exampleJobLog, fakeClient, PROJECT_ID, runningJob } from "@/test/fixtures";
import { renderWithProviders } from "@/test/render";
import { useJobsStore } from "@/store/jobs";
import { TrainProgress } from "./TrainProgress";

describe("TrainProgress", () => {
  beforeEach(() => useJobsStore.setState({ jobs: {}, panelOpen: false }));

  it("shows epoch, mAP50 and elapsed from the running job", async () => {
    const { api } = fakeClient([
      { method: "GET", path: /\/log$/, body: exampleJobLog },
      { method: "GET", path: /\/jobs\/[^/]+$/, body: runningJob },
    ]);
    useJobsStore.getState().upsert({ ...runningJob, type: "train", message: "epoch 3/50 mAP50 0.612", progress: 0.06 });
    renderWithProviders(<TrainProgress projectId={PROJECT_ID} jobId={runningJob.id} />, { api });
    expect(screen.getByTestId("epoch")).toHaveTextContent("3 / 50");
    expect(screen.getByTestId("map50")).toHaveTextContent("61.2%");
    expect(screen.getByTestId("elapsed")).not.toHaveTextContent("–");
    expect(screen.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "6");
    expect(await screen.findByTestId("job-log")).toHaveTextContent("job started");
    expect(screen.getByRole("button", { name: "Cancel job" })).toBeInTheDocument();
  });

  it("links the registered model when the job succeeded", () => {
    const { api } = fakeClient([{ method: "GET", path: /\/log$/, body: exampleJobLog }]);
    useJobsStore.getState().upsert({
      ...runningJob,
      type: "train",
      state: "succeeded",
      progress: 1,
      message: "epoch 3/3 mAP50 0.710",
      result: { model_id: "m9", metrics: {} },
      finished_at: "2026-09-17T10:20:00Z",
    });
    renderWithProviders(<TrainProgress projectId={PROJECT_ID} jobId={runningJob.id} />, { api });
    expect(screen.getByText("Training finished: the model is registered.")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Open model" })).toHaveAttribute("href", `/p/${PROJECT_ID}/models?model=m9`);
    expect(screen.getByTestId("map50")).toHaveTextContent("71.0%");
    expect(screen.getByTestId("elapsed")).toHaveTextContent("14 min 59 s");
  });
});
```

`frontend/src/screens/TrainScreen.test.tsx`:

```tsx
import { describe, it, expect, beforeEach } from "vitest";
import { screen, fireEvent, waitFor } from "@testing-library/react";
import {
  errorBody,
  exampleDataset,
  exampleJobLog,
  exampleModel,
  fakeClient,
  PROJECT_ID,
  runningJob,
} from "@/test/fixtures";
import { renderWithProviders } from "@/test/render";
import { useJobsStore } from "@/store/jobs";
import { TrainScreen } from "./TrainScreen";

const lists = [
  { method: "GET", path: /\/datasets$/, body: { items: [exampleDataset], next_cursor: null } },
  { method: "GET", path: /\/models$/, body: { items: [exampleModel], next_cursor: null } },
];

describe("TrainScreen", () => {
  beforeEach(() => useJobsStore.setState({ jobs: {}, panelOpen: false }));

  it("posts the training request, tracks the job in ?job= and shows the progress card", async () => {
    const { api, requests } = fakeClient([
      ...lists,
      { method: "POST", path: /\/models\/train$/, status: 202, body: { job: { ...runningJob, type: "train" } } },
      { method: "GET", path: /\/jobs\/[^/]+$/, body: { ...runningJob, type: "train" } },
      { method: "GET", path: /\/log$/, body: exampleJobLog },
    ]);
    renderWithProviders(<TrainScreen />, { api, route: `/p/${PROJECT_ID}/train`, path: "/p/:projectId/train" });
    await waitFor(() => expect(screen.getByLabelText("Dataset")).toHaveValue(exampleDataset.id));
    fireEvent.change(screen.getByLabelText("Epochs"), { target: { value: "3" } });
    fireEvent.click(screen.getByRole("button", { name: "Start training" }));
    await waitFor(() => expect(screen.getByTestId("train-progress")).toBeInTheDocument());
    const post = requests.find((r) => r.method === "POST");
    expect(post).toMatchObject({
      url: `/api/v1/projects/${PROJECT_ID}/models/train`,
      body: { name: "v1-yolo11m-coco", dataset_id: exampleDataset.id, base_model_id: exampleModel.id, epochs: 3, imgsz: 1280, batch: null, patience: 50, augmentation: "default", device: "0" },
    });
    expect(useJobsStore.getState().jobs[runningJob.id].type).toBe("train");
    expect(screen.getByRole("button", { name: "New training" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "New training" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Start training" })).toBeInTheDocument());
    expect(screen.getByRole("button", { name: /Show/ })).toBeInTheDocument();
  });

  it("shows the not-available note on 501 without breaking the form", async () => {
    const { api } = fakeClient([
      ...lists,
      { method: "POST", path: /\/models\/train$/, status: 501, body: errorBody("not_implemented", "S3 later") },
    ]);
    renderWithProviders(<TrainScreen />, { api, route: `/p/${PROJECT_ID}/train`, path: "/p/:projectId/train" });
    await waitFor(() => expect(screen.getByLabelText("Dataset")).toHaveValue(exampleDataset.id));
    fireEvent.click(screen.getByRole("button", { name: "Start training" }));
    await waitFor(() => expect(screen.getByRole("note")).toHaveTextContent("Training is not available yet"));
    expect(screen.getByRole("button", { name: "Start training" })).toBeEnabled();
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm test src/train/TrainProgress.test.tsx src/screens/TrainScreen.test.tsx`
Expected: `TrainProgress` unresolved; `TrainScreen` fails on `getByLabelText("Dataset")`.

- [ ] **Step 3: Implement `TrainProgress.tsx`**

```tsx
import { JobCard } from "@/jobs/JobCard";
import { elapsedSeconds, formatDuration } from "@/jobs/jobLabels";
import { useNow } from "@/jobs/useNow";
import { useTrackedJob } from "@/jobs/useTrackedJob";
import { formatMetric } from "@/models/modelLabels";
import { isActiveJob } from "@/store/jobs";
import { parseEpochMessage } from "./trainModel";

const tile = "rounded bg-slate-900 px-3 py-2";
const dt = "text-xs uppercase tracking-wide text-slate-500";

/** Live training card: epoch and mAP50 from the `job.progress` message, elapsed from `started_at`, log tail. */
export function TrainProgress({ projectId, jobId }: { projectId: string; jobId: string }) {
  const job = useTrackedJob(projectId, jobId);
  const active = job ? isActiveJob(job) : true;
  const now = useNow(1000, active);
  if (!job) return <p className="text-sm text-slate-400">Loading job {jobId.slice(0, 8)}…</p>;
  const epoch = parseEpochMessage(job.message);
  const elapsed = elapsedSeconds(job, now);
  const headline =
    job.state === "succeeded"
      ? "Training finished: the model is registered."
      : job.state === "failed"
        ? "Training failed."
        : job.state === "cancelled"
          ? "Training cancelled."
          : null;
  return (
    <section data-testid="train-progress" className="flex max-w-3xl flex-col gap-3">
      <dl className="grid grid-cols-3 gap-2">
        <div className={tile}>
          <dt className={dt}>Epoch</dt>
          <dd data-testid="epoch" className="text-lg tabular-nums">
            {epoch ? `${epoch.epoch} / ${epoch.epochs}` : "–"}
          </dd>
        </div>
        <div className={tile}>
          <dt className={dt}>mAP50</dt>
          <dd data-testid="map50" className="text-lg tabular-nums">
            {formatMetric(epoch?.map50)}
          </dd>
        </div>
        <div className={tile}>
          <dt className={dt}>Elapsed</dt>
          <dd data-testid="elapsed" className="text-lg tabular-nums">
            {elapsed === null ? "–" : formatDuration(elapsed)}
          </dd>
        </div>
      </dl>
      {headline && (
        <p role="status" className={`text-sm ${job.state === "succeeded" ? "text-emerald-300" : "text-slate-300"}`}>
          {headline}
        </p>
      )}
      <JobCard projectId={projectId} job={job} showLog />
    </section>
  );
}
```

- [ ] **Step 4: Replace `screens/TrainScreen.tsx`**

```tsx
import { useMemo, useState } from "react";
import { useParams, useSearchParams } from "react-router-dom";
import type { TrainRequest } from "@contract/client";
import { useApi } from "@/api/client";
import { isNotImplemented, messageOf } from "@/api/errors";
import { trainModel } from "@/api/models";
import { pushLog } from "@/app/diagnostics";
import { jobTitle, stateLabel } from "@/jobs/jobLabels";
import { formatDate } from "@/models/modelLabels";
import { useModels } from "@/models/useModels";
import { useJobsStore } from "@/store/jobs";
import { TrainForm } from "@/train/TrainForm";
import { TrainProgress } from "@/train/TrainProgress";
import { useDatasets } from "@/train/useDatasets";

const btn = "rounded border border-slate-700 px-3 py-1 text-sm hover:bg-slate-800 disabled:opacity-50";

export function TrainScreen() {
  const { projectId = "" } = useParams();
  const api = useApi();
  const [params, setParams] = useSearchParams();
  const jobId = params.get("job");
  const datasets = useDatasets(projectId);
  const registry = useModels(projectId);
  const jobs = useJobsStore((s) => s.jobs);
  const trainJobs = useMemo(
    () =>
      Object.values(jobs)
        .filter((j) => j.project_id === projectId && j.type === "train")
        .sort((a, b) => b.created_at.localeCompare(a.created_at)),
    [jobs, projectId],
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [unavailable, setUnavailable] = useState(false);

  async function start(req: TrainRequest) {
    setBusy(true);
    setError(null);
    setUnavailable(false);
    try {
      const job = await trainModel(api, projectId, req);
      useJobsStore.getState().upsert(job);
      setParams({ job: job.id });
    } catch (e) {
      pushLog(`start training failed: ${messageOf(e, String(e))}`);
      if (isNotImplemented(e)) setUnavailable(true);
      else setError(messageOf(e, "could not start training"));
    } finally {
      setBusy(false);
    }
  }

  const listsKey = `${datasets.datasets.map((d) => d.id).join(",")}|${registry.models.map((m) => m.id).join(",")}`;

  return (
    <section className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-2xl font-semibold">Train</h1>
        {jobId && (
          <button type="button" className={`${btn} ml-auto`} onClick={() => setParams({})}>
            New training
          </button>
        )}
      </div>
      {jobId ? (
        <TrainProgress projectId={projectId} jobId={jobId} />
      ) : (
        <TrainForm
          key={listsKey}
          projectId={projectId}
          datasets={datasets.datasets}
          models={registry.models}
          datasetsUnavailable={datasets.unavailable}
          modelsUnavailable={registry.unavailable}
          busy={busy}
          onStart={(req) => void start(req)}
        />
      )}
      {unavailable && (
        <p role="note" className="rounded border border-slate-700 bg-slate-800/60 px-3 py-2 text-sm text-slate-300">
          Training is not available yet (it arrives with the training backend).
        </p>
      )}
      {(error || datasets.error || registry.error) && (
        <p role="alert" className="rounded border border-red-800 bg-red-950 px-3 py-2 text-sm text-red-200">
          {error ?? datasets.error ?? registry.error}
        </p>
      )}
      {trainJobs.length > 0 && (
        <div className="flex flex-col gap-2">
          <h2 className="text-lg font-medium">Recent training jobs</h2>
          <ul className="flex flex-col gap-1 text-sm">
            {trainJobs.map((j) => (
              <li key={j.id} className="flex items-center gap-3">
                <span className="font-medium">{jobTitle(j)}</span>
                <span className="text-xs text-slate-400">
                  {stateLabel(j.state)} · {formatDate(j.created_at)}
                </span>
                {j.id !== jobId && (
                  <button type="button" className={btn} onClick={() => setParams({ job: j.id })}>
                    Show {j.id.slice(0, 8)}
                  </button>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
```

Write `·` in JSX as `{"·"}` (a literal escape inside JSX text is not decoded).

- [ ] **Step 5: Run the tests to verify they pass**

Run: `pnpm test src/train src/screens/TrainScreen.test.tsx`
Expected: `TrainProgress` 2, `TrainScreen` 2 passed; Task 8 tests green.

- [ ] **Step 6: Format, lint, type-check and commit**

Run: `pnpm format && pnpm lint && pnpm exec tsc -b`

```bash
git add src/train/TrainProgress.tsx src/train/TrainProgress.test.tsx src/screens/TrainScreen.tsx src/screens/TrainScreen.test.tsx
git commit -m "feat(ui): training screen with live progress card, log tail and cancel"
```

---

### Task 10: Query form model, image selection hook, providers hook, navigation source

**Files:**
- Create: `frontend/src/query/queryModel.ts`, `frontend/src/query/useImageSelection.ts`
- Modify: `frontend/src/api/providers.ts` (append `providerLabel` and `useProviders`), `frontend/src/store/navigation.ts` (`NavSource` gains `"query"`)
- Test: `frontend/src/query/queryModel.test.ts`, `frontend/src/query/useImageSelection.test.tsx`, `frontend/src/api/useProviders.test.tsx`

**Interfaces:**
- Consumes: `DEFAULT_TILING`, `DEFAULT_CONF` (Task 2), `fetchImagePage`, `ListImagesQuery` (S2), `collectPages` (Task 1), `fetchProviders` (Task 2), `useNavigationStore`.
- Produces:
  - `store/navigation.ts`: `export type NavSource = "data" | "review" | "selection" | "query" | null;` (the only change; `setContext(ids, "query")` carries a Data Manager selection to the query screen).
  - `api/providers.ts` additions: `providerLabel(name: string | null | undefined): string` ("OpenAI", "Anthropic", else the raw name or an en dash), `interface ProvidersList {providers: Provider[]; loading: boolean; unavailable: boolean; error: string | null; reload(): void; replace(p: Provider): void}`, `useProviders(): ProvidersList`.
  - `queryModel.ts`: `type QueryKind = QueryRunCreate["kind"]`, `type ImageMode = "selection" | "unlabeled" | "group" | "first_n"`, `interface QueryForm {kind: QueryKind; modelId: string; provider: ProviderName; query: string; mode: ImageMode; groupKey: string; firstN: string; tilingEnabled: boolean; tileSize: string; overlap: string; nmsIou: string; conf: string}`, `DEFAULT_QUERY_FORM` (local model, anthropic, mode `unlabeled`, firstN "50", tiling on 1280/0.2/0.5, conf "0.25"), `validateQueryForm(f, imageCount, providers): string | null`, `toTiling(f): Tiling`, `toQueryRunCreate(f, imageIds): QueryRunCreate`, `imageQuery(f): {query: ListImagesQuery; maxPages: number} | null` (null for `selection`), `REVIEW_LINK_MAX_IDS = 200`, `reviewLink(projectId, run): {to: string; capped: boolean}`, `runTitle(run: QueryRun): string`, `formKey(f, imageIds): string` (JSON of the request the estimate was computed for).
  - `useImageSelection.ts`: `interface ImageSelection {ids: string[]; loading: boolean; error: string | null}`, `useImageSelection(projectId, form, preloaded: string[]): ImageSelection` (selection mode returns `preloaded`; other modes list images with `imageQuery` and `collectPages`, first_n capped to N).

- [ ] **Step 1: Write the failing tests**

`frontend/src/query/queryModel.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { exampleProviders, exampleQueryRun } from "@/test/fixtures";
import {
  DEFAULT_QUERY_FORM,
  formKey,
  imageQuery,
  REVIEW_LINK_MAX_IDS,
  reviewLink,
  runTitle,
  toQueryRunCreate,
  validateQueryForm,
} from "./queryModel";

const local = { ...DEFAULT_QUERY_FORM, modelId: "m1" };
const cloud = { ...DEFAULT_QUERY_FORM, kind: "cloud_provider" as const, provider: "anthropic" as const, query: "dump trucks" };

describe("query form model", () => {
  it("builds the contract request for both kinds", () => {
    expect(toQueryRunCreate(local, ["a", "b"])).toEqual({
      kind: "local_model",
      model_id: "m1",
      image_ids: ["a", "b"],
      tiling: { enabled: true, tile_size: 1280, overlap: 0.2, nms_iou: 0.5 },
      conf: 0.25,
    });
    expect(toQueryRunCreate({ ...cloud, tilingEnabled: false, tileSize: "640", conf: "0.4" }, ["a"])).toEqual({
      kind: "cloud_provider",
      provider: "anthropic",
      query: "dump trucks",
      image_ids: ["a"],
      tiling: { enabled: false, tile_size: 640, overlap: 0.2, nms_iou: 0.5 },
      conf: 0.4,
    });
    expect(formKey(local, ["a"])).toBe(JSON.stringify(toQueryRunCreate(local, ["a"])));
  });

  it("validates source, provider key, query text, images and tiling", () => {
    expect(validateQueryForm(local, 2, exampleProviders)).toBeNull();
    expect(validateQueryForm({ ...local, modelId: "" }, 2, exampleProviders)).toBe("Choose a model.");
    expect(validateQueryForm(cloud, 2, exampleProviders)).toBeNull();
    expect(validateQueryForm({ ...cloud, provider: "openai" }, 2, exampleProviders)).toBe(
      "No API key stored for OpenAI. Add one in Settings.",
    );
    expect(validateQueryForm({ ...cloud, query: " " }, 2, exampleProviders)).toBe(
      "Describe what to find, for example: dump trucks.",
    );
    expect(validateQueryForm({ ...local, mode: "group" }, 2, exampleProviders)).toBe("Enter a group key.");
    expect(validateQueryForm({ ...local, mode: "first_n", firstN: "0" }, 2, exampleProviders)).toBe(
      "Number of images must be a whole number of at least 1.",
    );
    expect(validateQueryForm(local, 0, exampleProviders)).toBe("No images selected.");
    expect(validateQueryForm({ ...local, tileSize: "100" }, 2, exampleProviders)).toBe(
      "Tile size must be a whole number from 256 to 4096.",
    );
    expect(validateQueryForm({ ...local, overlap: "0.9" }, 2, exampleProviders)).toBe("Overlap must be between 0 and 0.5.");
    expect(validateQueryForm({ ...local, nmsIou: "2" }, 2, exampleProviders)).toBe("NMS IoU must be between 0 and 1.");
    expect(validateQueryForm({ ...local, conf: "" }, 2, exampleProviders)).toBe("Confidence must be between 0 and 1.");
  });

  it("maps image modes to list queries", () => {
    expect(imageQuery({ ...local, mode: "selection" })).toBeNull();
    expect(imageQuery({ ...local, mode: "unlabeled" })).toEqual({
      query: { labeled: false, sort: "path", order: "asc", limit: 1000 },
      maxPages: 20,
    });
    expect(imageQuery({ ...local, mode: "group", groupKey: " 0031 " })).toEqual({
      query: { group_key: "0031", sort: "path", order: "asc", limit: 1000 },
      maxPages: 20,
    });
    expect(imageQuery({ ...local, mode: "first_n", firstN: "25" })).toEqual({
      query: { sort: "path", order: "asc", limit: 25 },
      maxPages: 1,
    });
    expect(imageQuery({ ...local, mode: "first_n", firstN: "5000" })).toEqual({
      query: { sort: "path", order: "asc", limit: 1000 },
      maxPages: 5,
    });
  });

  it("links the review queue to the run's images, capped", () => {
    expect(reviewLink("p", exampleQueryRun)).toEqual({
      to: `/p/p/review?ids=${exampleQueryRun.image_ids.join(",")}`,
      capped: false,
    });
    const big = { ...exampleQueryRun, image_ids: Array.from({ length: 250 }, (_, i) => `i${i}`) };
    const link = reviewLink("p", big);
    expect(link.capped).toBe(true);
    expect(link.to.split(",")).toHaveLength(REVIEW_LINK_MAX_IDS);
    expect(runTitle(exampleQueryRun)).toBe('Anthropic: "dump trucks"');
    expect(runTitle({ ...exampleQueryRun, kind: "local_model", provider: null, model_name: "yolo11m-coco", query: "" })).toBe(
      "Local model yolo11m-coco",
    );
  });
});
```

`frontend/src/query/useImageSelection.test.tsx`:

```tsx
import type { ReactNode } from "react";
import { describe, it, expect } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { errorBody, exampleImagePage, fakeClient, IMAGE_ID, IMAGE_ID_2, PROJECT_ID } from "@/test/fixtures";
import { TestApiProvider } from "@/test/render";
import { DEFAULT_QUERY_FORM } from "./queryModel";
import { useImageSelection } from "./useImageSelection";

function wrapperFor(api: ReturnType<typeof fakeClient>["api"]) {
  return ({ children }: { children: ReactNode }) => <TestApiProvider api={api}>{children}</TestApiProvider>;
}

describe("useImageSelection", () => {
  it("returns the preloaded selection without a request", async () => {
    const { api, requests } = fakeClient([]);
    const { result } = renderHook(
      () => useImageSelection(PROJECT_ID, { ...DEFAULT_QUERY_FORM, mode: "selection" }, ["x", "y"]),
      { wrapper: wrapperFor(api) },
    );
    expect(result.current).toEqual({ ids: ["x", "y"], loading: false, error: null });
    await new Promise((r) => setTimeout(r, 10));
    expect(requests).toHaveLength(0);
  });

  it("lists unlabeled images and caps first_n", async () => {
    const { api, requests } = fakeClient([{ method: "GET", path: /\/images$/, body: exampleImagePage }]);
    const { result } = renderHook(() => useImageSelection(PROJECT_ID, DEFAULT_QUERY_FORM, []), {
      wrapper: wrapperFor(api),
    });
    expect(result.current.loading).toBe(true);
    await waitFor(() => expect(result.current.ids).toEqual([IMAGE_ID, IMAGE_ID_2]));
    const url = new URL(`http://x${requests[0].url}`);
    expect(url.searchParams.get("labeled")).toBe("false");
    expect(url.searchParams.get("limit")).toBe("1000");
    const one = renderHook(
      () => useImageSelection(PROJECT_ID, { ...DEFAULT_QUERY_FORM, mode: "first_n", firstN: "1" }, []),
      { wrapper: wrapperFor(api) },
    );
    await waitFor(() => expect(one.result.current.ids).toEqual([IMAGE_ID]));
  });

  it("reports listing errors", async () => {
    const { api } = fakeClient([
      { method: "GET", path: /\/images$/, status: 500, body: errorBody("internal_error", "db locked") },
    ]);
    const { result } = renderHook(() => useImageSelection(PROJECT_ID, DEFAULT_QUERY_FORM, []), {
      wrapper: wrapperFor(api),
    });
    await waitFor(() => expect(result.current.error).toBe("db locked"));
    expect(result.current.ids).toEqual([]);
  });
});
```

`frontend/src/api/useProviders.test.tsx`:

```tsx
import type { ReactNode } from "react";
import { describe, it, expect } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";
import { errorBody, exampleProviders, fakeClient } from "@/test/fixtures";
import { TestApiProvider } from "@/test/render";
import { providerLabel, useProviders } from "./providers";

describe("useProviders", () => {
  it("loads the list, labels names and replaces one provider", async () => {
    const { api } = fakeClient([{ method: "GET", path: /\/providers$/, body: { items: exampleProviders } }]);
    const wrapper = ({ children }: { children: ReactNode }) => <TestApiProvider api={api}>{children}</TestApiProvider>;
    const { result } = renderHook(() => useProviders(), { wrapper });
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.providers.map((p) => p.name)).toEqual(["openai", "anthropic"]);
    act(() => result.current.replace({ ...exampleProviders[0], has_key: true }));
    expect(result.current.providers[0].has_key).toBe(true);
    expect(providerLabel("openai")).toBe("OpenAI");
    expect(providerLabel("anthropic")).toBe("Anthropic");
    expect(providerLabel(null)).toBe("–");
  });

  it("marks providers unavailable on 501", async () => {
    const { api } = fakeClient([
      { method: "GET", path: /\/providers$/, status: 501, body: errorBody("not_implemented", "S4 later") },
    ]);
    const wrapper = ({ children }: { children: ReactNode }) => <TestApiProvider api={api}>{children}</TestApiProvider>;
    const { result } = renderHook(() => useProviders(), { wrapper });
    await waitFor(() => expect(result.current.unavailable).toBe(true));
    expect(result.current.error).toBeNull();
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm test src/query src/api/useProviders.test.tsx`
Expected: three files fail with unresolved imports / missing exports.

- [ ] **Step 3: Extend `store/navigation.ts` and `api/providers.ts`**

In `frontend/src/store/navigation.ts` change one line: `export type NavSource = "data" | "review" | "selection" | "query" | null;`

Append to `frontend/src/api/providers.ts` (add `import { useCallback, useEffect, useState } from "react";`, `import { useApi } from "./client";` and `import { isNotImplemented, messageOf } from "./errors";`, `import { pushLog } from "@/app/diagnostics";` at the top):

```ts
const LABELS: Record<ProviderName, string> = { openai: "OpenAI", anthropic: "Anthropic" };

export function providerLabel(name: string | null | undefined): string {
  if (!name) return "–";
  return (LABELS as Record<string, string>)[name] ?? name;
}

export interface ProvidersList {
  providers: Provider[];
  loading: boolean;
  /** 501 until S4 lands. */
  unavailable: boolean;
  error: string | null;
  reload: () => void;
  replace: (p: Provider) => void;
}

interface ProvidersState {
  key: string;
  providers: Provider[];
  unavailable: boolean;
  error: string | null;
}

export function useProviders(): ProvidersList {
  const api = useApi();
  const [attempt, setAttempt] = useState(0);
  const key = String(attempt);
  const [state, setState] = useState<ProvidersState>({ key: "", providers: [], unavailable: false, error: null });

  useEffect(() => {
    let cancelled = false;
    fetchProviders(api)
      .then((providers) => {
        if (!cancelled) setState({ key, providers, unavailable: false, error: null });
      })
      .catch((e: unknown) => {
        if (cancelled) return;
        pushLog(`load providers failed: ${messageOf(e, String(e))}`);
        const unavailable = isNotImplemented(e);
        setState({ key, providers: [], unavailable, error: unavailable ? null : messageOf(e, "could not load providers") });
      });
    return () => {
      cancelled = true;
    };
  }, [api, key]);

  const reload = useCallback(() => setAttempt((a) => a + 1), []);
  const replace = useCallback(
    (p: Provider) => setState((s) => ({ ...s, providers: s.providers.map((x) => (x.name === p.name ? p : x)) })),
    [],
  );
  const loaded = state.key === key;
  return {
    providers: state.providers,
    loading: !loaded,
    unavailable: loaded && state.unavailable,
    error: loaded ? state.error : null,
    reload,
    replace,
  };
}
```

- [ ] **Step 4: Implement `queryModel.ts`**

```ts
import type { Provider, ProviderName, QueryRun, QueryRunCreate, Tiling } from "@contract/client";
import type { ListImagesQuery } from "@/api/images";
import { providerLabel } from "@/api/providers";
import { DEFAULT_CONF, DEFAULT_TILING } from "@/api/queryRuns";

export type QueryKind = QueryRunCreate["kind"];
export type ImageMode = "selection" | "unlabeled" | "group" | "first_n";

export interface QueryForm {
  kind: QueryKind;
  modelId: string;
  provider: ProviderName;
  query: string;
  mode: ImageMode;
  groupKey: string;
  firstN: string;
  tilingEnabled: boolean;
  tileSize: string;
  overlap: string;
  nmsIou: string;
  conf: string;
}

export const DEFAULT_QUERY_FORM: QueryForm = {
  kind: "local_model",
  modelId: "",
  provider: "anthropic",
  query: "",
  mode: "unlabeled",
  groupKey: "",
  firstN: "50",
  tilingEnabled: DEFAULT_TILING.enabled,
  tileSize: String(DEFAULT_TILING.tile_size),
  overlap: String(DEFAULT_TILING.overlap),
  nmsIou: String(DEFAULT_TILING.nms_iou),
  conf: String(DEFAULT_CONF),
};

const LIST_LIMIT = 1000;
const MAX_LIST_PAGES = 20;
export const REVIEW_LINK_MAX_IDS = 200;

function whole(text: string): number | null {
  return /^\d+$/.test(text.trim()) ? Number(text.trim()) : null;
}

function fraction(text: string, max: number): number | null {
  const n = Number(text.trim());
  return text.trim() !== "" && Number.isFinite(n) && n >= 0 && n <= max ? n : null;
}

export function validateQueryForm(f: QueryForm, imageCount: number, providers: Provider[]): string | null {
  if (f.kind === "local_model" && !f.modelId) return "Choose a model.";
  if (f.kind === "cloud_provider") {
    const p = providers.find((x) => x.name === f.provider);
    if (!p) return "Choose a provider.";
    if (!p.has_key) return `No API key stored for ${providerLabel(p.name)}. Add one in Settings.`;
    if (!f.query.trim()) return "Describe what to find, for example: dump trucks.";
  }
  if (f.mode === "group" && !f.groupKey.trim()) return "Enter a group key.";
  if (f.mode === "first_n") {
    const n = whole(f.firstN);
    if (n === null || n < 1) return "Number of images must be a whole number of at least 1.";
  }
  if (imageCount < 1) return "No images selected.";
  const tile = whole(f.tileSize);
  if (tile === null || tile < 256 || tile > 4096) return "Tile size must be a whole number from 256 to 4096.";
  if (fraction(f.overlap, 0.5) === null) return "Overlap must be between 0 and 0.5.";
  if (fraction(f.nmsIou, 1) === null) return "NMS IoU must be between 0 and 1.";
  if (fraction(f.conf, 1) === null) return "Confidence must be between 0 and 1.";
  return null;
}

export function toTiling(f: QueryForm): Tiling {
  return {
    enabled: f.tilingEnabled,
    tile_size: Number(f.tileSize),
    overlap: Number(f.overlap),
    nms_iou: Number(f.nmsIou),
  };
}

/** Only call after `validateQueryForm` returned null. */
export function toQueryRunCreate(f: QueryForm, imageIds: string[]): QueryRunCreate {
  const base = { image_ids: imageIds, tiling: toTiling(f), conf: Number(f.conf) };
  if (f.kind === "local_model") return { kind: "local_model", model_id: f.modelId, ...base };
  return { kind: "cloud_provider", provider: f.provider, query: f.query.trim(), ...base };
}

/** Identity of an estimate: the exact request it was computed for. */
export function formKey(f: QueryForm, imageIds: string[]): string {
  return JSON.stringify(toQueryRunCreate(f, imageIds));
}

/** How to list the images for a mode; null when the ids come from the Data Manager selection. */
export function imageQuery(f: QueryForm): { query: ListImagesQuery; maxPages: number } | null {
  const base: ListImagesQuery = { sort: "path", order: "asc", limit: LIST_LIMIT };
  switch (f.mode) {
    case "selection":
      return null;
    case "unlabeled":
      return { query: { labeled: false, ...base }, maxPages: MAX_LIST_PAGES };
    case "group":
      return { query: { group_key: f.groupKey.trim(), ...base }, maxPages: MAX_LIST_PAGES };
    case "first_n": {
      const n = Math.max(1, whole(f.firstN) ?? 1);
      return { query: { ...base, limit: Math.min(LIST_LIMIT, n) }, maxPages: Math.ceil(n / LIST_LIMIT) };
    }
  }
}

/** The review queue narrowed to the run's images (`ids` query parameter), capped to keep the URL short. */
export function reviewLink(projectId: string, run: QueryRun): { to: string; capped: boolean } {
  const ids = run.image_ids.slice(0, REVIEW_LINK_MAX_IDS);
  return { to: `/p/${projectId}/review?ids=${ids.join(",")}`, capped: run.image_ids.length > ids.length };
}

export function runTitle(run: QueryRun): string {
  if (run.kind === "local_model") return `Local model ${run.model_name ?? run.model_id ?? ""}`.trim();
  return `${providerLabel(run.provider)}: "${run.query}"`;
}
```

- [ ] **Step 5: Implement `useImageSelection.ts`**

```ts
import { useEffect, useState } from "react";
import { useApi } from "@/api/client";
import { messageOf } from "@/api/errors";
import { fetchImagePage, type ListImagesQuery } from "@/api/images";
import { collectPages } from "@/api/paging";
import { pushLog } from "@/app/diagnostics";
import { imageQuery, type QueryForm } from "./queryModel";

export interface ImageSelection {
  ids: string[];
  loading: boolean;
  error: string | null;
}

interface State {
  key: string | null;
  ids: string[];
  error: string | null;
}

/** Resolves the form's image mode to image ids: the carried selection, or a listing by filter. */
export function useImageSelection(projectId: string, form: QueryForm, preloaded: string[]): ImageSelection {
  const api = useApi();
  const spec = imageQuery(form);
  const key = spec ? JSON.stringify({ projectId, ...spec }) : null;
  const cap = form.mode === "first_n" ? Number(form.firstN) || 1 : Number.POSITIVE_INFINITY;
  const [state, setState] = useState<State>({ key: null, ids: [], error: null });

  useEffect(() => {
    if (!key) return;
    const { query, maxPages } = JSON.parse(key) as { query: ListImagesQuery; maxPages: number };
    let cancelled = false;
    collectPages((cursor) => fetchImagePage(api, projectId, cursor ? { ...query, cursor } : query), maxPages)
      .then((items) => {
        if (!cancelled) setState({ key, ids: items.map((i) => i.id), error: null });
      })
      .catch((e: unknown) => {
        if (cancelled) return;
        pushLog(`list images for query failed: ${messageOf(e, String(e))}`);
        setState({ key, ids: [], error: messageOf(e, "could not list the images") });
      });
    return () => {
      cancelled = true;
    };
  }, [api, projectId, key]);

  if (!key) return { ids: preloaded, loading: false, error: null };
  const loaded = state.key === key;
  return {
    ids: loaded ? state.ids.slice(0, cap) : [],
    loading: !loaded,
    error: loaded ? state.error : null,
  };
}
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `pnpm test src/query src/api/useProviders.test.tsx src/store/navigation.test.ts`
Expected: `queryModel` 4, `useImageSelection` 3, `useProviders` 2 passed; the navigation store test still green.

- [ ] **Step 7: Format, lint, type-check and commit**

Run: `pnpm format && pnpm lint && pnpm exec tsc -b`

```bash
git add src/query/queryModel.ts src/query/queryModel.test.ts src/query/useImageSelection.ts src/query/useImageSelection.test.tsx src/api/providers.ts src/api/useProviders.test.tsx src/store/navigation.ts
git commit -m "feat(ui): query form model, image selection and providers hooks"
```

---

### Task 11: Query screen: source, images, tiling, estimate and start

**Files:**
- Create: `frontend/src/query/SourcePicker.tsx`, `frontend/src/query/ImagePicker.tsx`, `frontend/src/query/TilingFields.tsx`, `frontend/src/query/EstimateCard.tsx`
- Modify: `frontend/src/screens/QueryScreen.tsx` (replace the placeholder)
- Test: `frontend/src/screens/QueryScreen.test.tsx`

**Interfaces:**
- Consumes: Task 10 model and hooks, `estimateQueryRun`, `createQueryRun` (Task 2), `useModels` (Task 5), `useProviders`, `useJobsStore`, `useNavigationStore`, `useProject` (for the pre-annotation model preselection).
- Produces:
  - `SourcePicker({form, onChange, models, modelsUnavailable, providers, providersUnavailable}: {form: QueryForm; onChange: (patch: Partial<QueryForm>) => void; models: Model[]; modelsUnavailable: boolean; providers: Provider[]; providersUnavailable: boolean})`: radios `aria-label="Local model"` / `aria-label="Cloud provider"`; select `aria-label="Model"`; select `aria-label="Provider"` whose keyless options are disabled and suffixed "(no key stored)", with a `role="note"` hint "Add the key in Settings" when the chosen provider has no key; input `aria-label="Query"`.
  - `ImagePicker({form, onChange, preloadedCount, count, loading}: {...; preloadedCount: number; count: number; loading: boolean})`: select `aria-label="Images"` with options `selection` ("Data Manager selection (N)", disabled when `preloadedCount === 0`), `unlabeled`, `group`, `first_n`; input `aria-label="Group key"` (group mode); input `aria-label="Number of images"` (first_n); `<p data-testid="image-count">` "N images selected" / "1 image selected" / "Counting images...".
  - `TilingFields({form, onChange})`: checkbox `aria-label="Tiling"`, inputs `aria-label="Tile size"`, `"Overlap"`, `"NMS IoU"`, `"Confidence"`.
  - `EstimateCard({estimate}: {estimate: CostEstimate})`: `<p data-testid="estimate">` "5 images, 40 tiles, 40 requests, estimated $0.80 (at $0.02 per request)".
  - `QueryScreen`: heading "Query"; form state (`DEFAULT_QUERY_FORM` with `modelId` preset to the project's `preannotation_model_id` when it exists in the registry, `mode: "selection"` when a Data Manager selection was carried over); "Estimate" button (`POST /query-runs/estimate`, card shown while the form is unchanged); "Start" button enabled only with a current estimate (`POST /query-runs`, job `upsert`ed, `?run=` set, placeholder `<p data-testid="run-started">` until Task 12 mounts `RunCard`); 501 note "Query runs are not available yet"; validation message in `role="alert"`.

- [ ] **Step 1: Write the failing test**

`frontend/src/screens/QueryScreen.test.tsx`:

```tsx
import { describe, it, expect, beforeEach } from "vitest";
import { screen, fireEvent, waitFor } from "@testing-library/react";
import {
  errorBody,
  exampleEstimate,
  exampleImagePage,
  exampleModel,
  exampleProject,
  exampleProviders,
  exampleQueryRun,
  fakeClient,
  IMAGE_ID,
  IMAGE_ID_2,
  PROJECT_ID,
  runningJob,
} from "@/test/fixtures";
import { renderWithProviders } from "@/test/render";
import { useJobsStore } from "@/store/jobs";
import { useNavigationStore } from "@/store/navigation";
import { QueryScreen } from "./QueryScreen";

const base = [
  { method: "GET", path: /\/projects\/[^/]+$/, body: exampleProject },
  { method: "GET", path: /\/models$/, body: { items: [exampleModel], next_cursor: null } },
  { method: "GET", path: /\/providers$/, body: { items: exampleProviders } },
  { method: "GET", path: /\/images$/, body: exampleImagePage },
  { method: "GET", path: /\/query-runs$/, body: { items: [], next_cursor: null } },
];

describe("QueryScreen", () => {
  beforeEach(() => {
    useJobsStore.setState({ jobs: {}, panelOpen: false });
    useNavigationStore.setState({ ids: [], source: null });
  });

  it("estimates a cloud query over unlabeled images, then starts the run", async () => {
    const { api, requests } = fakeClient([
      ...base,
      { method: "POST", path: /\/estimate$/, body: exampleEstimate },
      { method: "POST", path: /\/query-runs$/, status: 202, body: { query_run: exampleQueryRun, job: { ...runningJob, type: "infer" } } },
    ]);
    renderWithProviders(<QueryScreen />, { api, route: `/p/${PROJECT_ID}/query`, path: "/p/:projectId/query" });
    await waitFor(() => expect(screen.getByLabelText("Model")).toHaveValue(exampleModel.id));
    await waitFor(() => expect(screen.getByTestId("image-count")).toHaveTextContent("2 images selected"));
    expect(screen.getByRole("button", { name: "Start" })).toBeDisabled();
    fireEvent.click(screen.getByLabelText("Cloud provider"));
    const provider = screen.getByLabelText("Provider");
    expect(provider).toHaveValue("anthropic");
    expect(screen.getByRole("option", { name: /OpenAI/ })).toBeDisabled();
    fireEvent.change(screen.getByLabelText("Query"), { target: { value: "dump trucks" } });
    fireEvent.click(screen.getByRole("button", { name: "Estimate" }));
    await waitFor(() => expect(screen.getByTestId("estimate")).toHaveTextContent("40 requests"));
    expect(screen.getByTestId("estimate")).toHaveTextContent("$0.80");
    const expected = {
      kind: "cloud_provider",
      provider: "anthropic",
      query: "dump trucks",
      image_ids: [IMAGE_ID, IMAGE_ID_2],
      tiling: { enabled: true, tile_size: 1280, overlap: 0.2, nms_iou: 0.5 },
      conf: 0.25,
    };
    expect(requests.find((r) => r.url.endsWith("/estimate"))?.body).toEqual(expected);
    fireEvent.click(screen.getByRole("button", { name: "Start" }));
    await waitFor(() => expect(screen.getByTestId("run-started")).toBeInTheDocument());
    expect(requests.find((r) => r.method === "POST" && r.url.endsWith("/query-runs"))?.body).toEqual(expected);
    expect(useJobsStore.getState().jobs[runningJob.id].type).toBe("infer");
  });

  it("preloads a Data Manager selection and clears a stale estimate when the form changes", async () => {
    useNavigationStore.getState().setContext([IMAGE_ID], "query");
    const { api } = fakeClient([...base, { method: "POST", path: /\/estimate$/, body: exampleEstimate }]);
    renderWithProviders(<QueryScreen />, { api, route: `/p/${PROJECT_ID}/query`, path: "/p/:projectId/query" });
    await waitFor(() => expect(screen.getByLabelText("Images")).toHaveValue("selection"));
    expect(screen.getByTestId("image-count")).toHaveTextContent("1 image selected");
    fireEvent.click(screen.getByRole("button", { name: "Estimate" }));
    await waitFor(() => expect(screen.getByTestId("estimate")).toBeInTheDocument());
    fireEvent.change(screen.getByLabelText("Confidence"), { target: { value: "0.5" } });
    expect(screen.queryByTestId("estimate")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Start" })).toBeDisabled();
  });

  it("refuses an invalid form and shows the not-available note on 501", async () => {
    const { api } = fakeClient([
      ...base,
      { method: "POST", path: /\/estimate$/, status: 501, body: errorBody("not_implemented", "S4 later") },
    ]);
    renderWithProviders(<QueryScreen />, { api, route: `/p/${PROJECT_ID}/query`, path: "/p/:projectId/query" });
    await waitFor(() => expect(screen.getByTestId("image-count")).toHaveTextContent("2 images selected"));
    fireEvent.click(screen.getByLabelText("Cloud provider"));
    fireEvent.click(screen.getByRole("button", { name: "Estimate" }));
    expect(screen.getByRole("alert")).toHaveTextContent("Describe what to find");
    fireEvent.change(screen.getByLabelText("Query"), { target: { value: "cranes" } });
    fireEvent.click(screen.getByRole("button", { name: "Estimate" }));
    await waitFor(() => expect(screen.getByRole("note")).toHaveTextContent("Query runs are not available yet"));
    expect(screen.getByRole("heading", { name: "Query" })).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm test src/screens/QueryScreen.test.tsx`
Expected: fails on `getByLabelText("Model")` (placeholder screen).

- [ ] **Step 3: Implement the pickers**

`frontend/src/query/SourcePicker.tsx`:

```tsx
import type { Model, Provider, ProviderName } from "@contract/client";
import { providerLabel } from "@/api/providers";
import { kindLabel } from "@/models/modelLabels";
import type { QueryForm } from "./queryModel";

interface Props {
  form: QueryForm;
  onChange: (patch: Partial<QueryForm>) => void;
  models: Model[];
  modelsUnavailable: boolean;
  providers: Provider[];
  providersUnavailable: boolean;
}

const input = "rounded border border-slate-700 bg-slate-800 px-2 py-1 text-sm disabled:opacity-50";
const label = "flex flex-col gap-1 text-xs text-slate-400";

export function SourcePicker({ form, onChange, models, modelsUnavailable, providers, providersUnavailable }: Props) {
  const chosen = providers.find((p) => p.name === form.provider);
  return (
    <fieldset className="flex flex-col gap-3">
      <legend className="text-sm font-medium">Source</legend>
      <div className="flex gap-4 text-sm">
        <label className="flex items-center gap-1">
          <input
            type="radio"
            name="kind"
            aria-label="Local model"
            checked={form.kind === "local_model"}
            onChange={() => onChange({ kind: "local_model" })}
          />
          Local model
        </label>
        <label className="flex items-center gap-1">
          <input
            type="radio"
            name="kind"
            aria-label="Cloud provider"
            checked={form.kind === "cloud_provider"}
            onChange={() => onChange({ kind: "cloud_provider" })}
          />
          Cloud provider
        </label>
      </div>
      {form.kind === "local_model" ? (
        <label className={label}>
          Model
          <select
            aria-label="Model"
            value={form.modelId}
            onChange={(e) => onChange({ modelId: e.target.value })}
            disabled={modelsUnavailable}
            className={input}
          >
            <option value="">Choose a model</option>
            {models.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name} ({kindLabel(m.kind)})
              </option>
            ))}
          </select>
          {modelsUnavailable && <span role="note">The model registry is not available yet.</span>}
        </label>
      ) : (
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          <label className={label}>
            Provider
            <select
              aria-label="Provider"
              value={form.provider}
              onChange={(e) => onChange({ provider: e.target.value as ProviderName })}
              disabled={providersUnavailable}
              className={input}
            >
              {providers.map((p) => (
                <option key={p.name} value={p.name} disabled={!p.has_key}>
                  {providerLabel(p.name)} ({p.model_name}){p.has_key ? "" : " (no key stored)"}
                </option>
              ))}
            </select>
            {providersUnavailable && <span role="note">Cloud providers are not available yet.</span>}
            {chosen && !chosen.has_key && (
              <span role="note">No API key stored for {providerLabel(chosen.name)}. Add the key in Settings.</span>
            )}
          </label>
          <label className={label}>
            Query
            <input
              aria-label="Query"
              value={form.query}
              onChange={(e) => onChange({ query: e.target.value })}
              placeholder="dump trucks"
              className={input}
            />
            <span>Free text describing what to find; answers are constrained to the project classes.</span>
          </label>
        </div>
      )}
    </fieldset>
  );
}
```

`frontend/src/query/ImagePicker.tsx`:

```tsx
import type { ImageMode, QueryForm } from "./queryModel";

interface Props {
  form: QueryForm;
  onChange: (patch: Partial<QueryForm>) => void;
  preloadedCount: number;
  count: number;
  loading: boolean;
}

const input = "rounded border border-slate-700 bg-slate-800 px-2 py-1 text-sm disabled:opacity-50";
const label = "flex flex-col gap-1 text-xs text-slate-400";

export function ImagePicker({ form, onChange, preloadedCount, count, loading }: Props) {
  return (
    <fieldset className="flex flex-col gap-3">
      <legend className="text-sm font-medium">Images</legend>
      <div className="flex flex-wrap items-end gap-3">
        <label className={label}>
          Images
          <select
            aria-label="Images"
            value={form.mode}
            onChange={(e) => onChange({ mode: e.target.value as ImageMode })}
            className={input}
          >
            <option value="selection" disabled={preloadedCount === 0}>
              Data Manager selection ({preloadedCount})
            </option>
            <option value="unlabeled">All unlabeled images</option>
            <option value="group">Images in a group</option>
            <option value="first_n">First N images</option>
          </select>
        </label>
        {form.mode === "group" && (
          <label className={label}>
            Group key
            <input aria-label="Group key" value={form.groupKey} onChange={(e) => onChange({ groupKey: e.target.value })} className={input} />
          </label>
        )}
        {form.mode === "first_n" && (
          <label className={label}>
            Number of images
            <input
              aria-label="Number of images"
              type="number"
              min={1}
              value={form.firstN}
              onChange={(e) => onChange({ firstN: e.target.value })}
              className={`${input} w-24`}
            />
          </label>
        )}
      </div>
      <p data-testid="image-count" className="text-xs text-slate-300">
        {loading ? "Counting images…" : `${count} ${count === 1 ? "image" : "images"} selected`}
      </p>
    </fieldset>
  );
}
```

`frontend/src/query/TilingFields.tsx`:

```tsx
import type { QueryForm } from "./queryModel";

interface Props {
  form: QueryForm;
  onChange: (patch: Partial<QueryForm>) => void;
}

const input = "rounded border border-slate-700 bg-slate-800 px-2 py-1 text-sm disabled:opacity-50";
const label = "flex flex-col gap-1 text-xs text-slate-400";

/** Spec section 8 tiling (default 1280 px, overlap 0.2, NMS IoU 0.5) and the confidence threshold. */
export function TilingFields({ form, onChange }: Props) {
  return (
    <fieldset className="flex flex-col gap-3">
      <legend className="text-sm font-medium">Tiling and confidence</legend>
      <div className="flex flex-wrap items-end gap-3">
        <label className="flex items-center gap-1 text-sm">
          <input
            type="checkbox"
            aria-label="Tiling"
            checked={form.tilingEnabled}
            onChange={(e) => onChange({ tilingEnabled: e.target.checked })}
          />
          Tile large images
        </label>
        <label className={label}>
          Tile size
          <input aria-label="Tile size" type="number" min={256} max={4096} step={64} value={form.tileSize} disabled={!form.tilingEnabled} onChange={(e) => onChange({ tileSize: e.target.value })} className={`${input} w-24`} />
        </label>
        <label className={label}>
          Overlap
          <input aria-label="Overlap" type="number" min={0} max={0.5} step={0.05} value={form.overlap} disabled={!form.tilingEnabled} onChange={(e) => onChange({ overlap: e.target.value })} className={`${input} w-24`} />
        </label>
        <label className={label}>
          NMS IoU
          <input aria-label="NMS IoU" type="number" min={0} max={1} step={0.05} value={form.nmsIou} disabled={!form.tilingEnabled} onChange={(e) => onChange({ nmsIou: e.target.value })} className={`${input} w-24`} />
        </label>
        <label className={label}>
          Confidence
          <input aria-label="Confidence" type="number" min={0} max={1} step={0.05} value={form.conf} onChange={(e) => onChange({ conf: e.target.value })} className={`${input} w-24`} />
        </label>
      </div>
    </fieldset>
  );
}
```

`frontend/src/query/EstimateCard.tsx`:

```tsx
import type { CostEstimate } from "@contract/client";

const usd = (n: number) => `$${n.toFixed(2)}`;

/** Spec section 8: images x tiles x per-provider cost, shown before "Start". */
export function EstimateCard({ estimate }: { estimate: CostEstimate }) {
  return (
    <p data-testid="estimate" className="rounded border border-slate-700 bg-slate-800/60 px-3 py-2 text-sm">
      {estimate.images} {estimate.images === 1 ? "image" : "images"}, {estimate.tiles} tiles, {estimate.requests} requests,
      estimated {usd(estimate.estimated_cost)} (at {usd(estimate.cost_per_request)} per request)
    </p>
  );
}
```

- [ ] **Step 4: Replace `screens/QueryScreen.tsx`**

```tsx
import { useMemo, useState } from "react";
import { useParams, useSearchParams } from "react-router-dom";
import type { CostEstimate } from "@contract/client";
import { useApi } from "@/api/client";
import { isNotImplemented, messageOf } from "@/api/errors";
import { useProject } from "@/api/project";
import { useProviders } from "@/api/providers";
import { createQueryRun, estimateQueryRun } from "@/api/queryRuns";
import { pushLog } from "@/app/diagnostics";
import { useModels } from "@/models/useModels";
import { EstimateCard } from "@/query/EstimateCard";
import { ImagePicker } from "@/query/ImagePicker";
import { DEFAULT_QUERY_FORM, formKey, toQueryRunCreate, validateQueryForm, type QueryForm } from "@/query/queryModel";
import { SourcePicker } from "@/query/SourcePicker";
import { TilingFields } from "@/query/TilingFields";
import { useImageSelection } from "@/query/useImageSelection";
import { useJobsStore } from "@/store/jobs";
import { useNavigationStore } from "@/store/navigation";

const EMPTY: string[] = [];
const primary = "rounded bg-orange-600 px-3 py-1 text-sm font-medium hover:bg-orange-500 disabled:opacity-50";
const secondary = "rounded border border-slate-700 px-3 py-1 text-sm hover:bg-slate-800 disabled:opacity-50";

export function QueryScreen() {
  const { projectId = "" } = useParams();
  const api = useApi();
  const [params, setParams] = useSearchParams();
  const runId = params.get("run");
  const { project } = useProject(projectId);
  const registry = useModels(projectId);
  const providers = useProviders();
  const preloaded = useNavigationStore((s) => (s.source === "query" ? s.ids : EMPTY));
  const [form, setForm] = useState<QueryForm>(() => ({
    ...DEFAULT_QUERY_FORM,
    mode: preloaded.length > 0 ? "selection" : DEFAULT_QUERY_FORM.mode,
  }));
  const selection = useImageSelection(projectId, form, preloaded);
  const [estimate, setEstimate] = useState<{ key: string; value: CostEstimate } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [unavailable, setUnavailable] = useState(false);

  // The project's pre-annotation model is the natural default once the registry has loaded.
  const preferredModelId = project?.preannotation_model_id ?? null;
  const modelId =
    form.modelId || (preferredModelId && registry.models.some((m) => m.id === preferredModelId) ? preferredModelId : (registry.models[0]?.id ?? ""));
  const effectiveForm = useMemo(() => (modelId === form.modelId ? form : { ...form, modelId }), [form, modelId]);
  const currentKey = selection.loading ? null : formKey(effectiveForm, selection.ids);
  const currentEstimate = estimate && estimate.key === currentKey ? estimate.value : null;

  const patch = (p: Partial<QueryForm>) => {
    setForm((f) => ({ ...f, ...p }));
    setError(null);
  };

  function validate(): string | null {
    const problem = validateQueryForm(effectiveForm, selection.ids.length, providers.providers);
    setError(problem);
    return problem;
  }

  async function guard(label: string, fn: () => Promise<void>) {
    setBusy(true);
    setError(null);
    setUnavailable(false);
    try {
      await fn();
    } catch (e) {
      pushLog(`${label} failed: ${messageOf(e, String(e))}`);
      if (isNotImplemented(e)) setUnavailable(true);
      else setError(messageOf(e, `${label} failed`));
    } finally {
      setBusy(false);
    }
  }

  const doEstimate = () => {
    if (validate() || !currentKey) return;
    void guard("estimate", async () => {
      const value = await estimateQueryRun(api, projectId, toQueryRunCreate(effectiveForm, selection.ids));
      setEstimate({ key: currentKey, value });
    });
  };

  const doStart = () => {
    if (validate() || !currentEstimate) return;
    void guard("start query run", async () => {
      const created = await createQueryRun(api, projectId, toQueryRunCreate(effectiveForm, selection.ids));
      useJobsStore.getState().upsert(created.job);
      setEstimate(null);
      setParams({ run: created.query_run.id });
    });
  };

  return (
    <section className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-2xl font-semibold">Query</h1>
        {runId && (
          <button type="button" className={`${secondary} ml-auto`} onClick={() => setParams({})}>
            New query
          </button>
        )}
      </div>
      {runId ? (
        <p data-testid="run-started" className="text-sm text-slate-300">
          Run {runId.slice(0, 8)} started.
        </p>
      ) : (
        <div className="flex max-w-3xl flex-col gap-5">
          <SourcePicker
            form={effectiveForm}
            onChange={patch}
            models={registry.models}
            modelsUnavailable={registry.unavailable}
            providers={providers.providers}
            providersUnavailable={providers.unavailable}
          />
          <ImagePicker
            form={effectiveForm}
            onChange={patch}
            preloadedCount={preloaded.length}
            count={selection.ids.length}
            loading={selection.loading}
          />
          <TilingFields form={effectiveForm} onChange={patch} />
          {selection.error && (
            <p role="alert" className="text-xs text-red-300">
              {selection.error}
            </p>
          )}
          {currentEstimate && <EstimateCard estimate={currentEstimate} />}
          <div className="flex items-center gap-2">
            <button type="button" className={secondary} onClick={doEstimate} disabled={busy || selection.loading}>
              Estimate
            </button>
            <button type="button" className={primary} onClick={doStart} disabled={busy || !currentEstimate}>
              Start
            </button>
            <span className="text-xs text-slate-400">Estimate first; Start runs the estimated request.</span>
          </div>
        </div>
      )}
      {unavailable && (
        <p role="note" className="rounded border border-slate-700 bg-slate-800/60 px-3 py-2 text-sm text-slate-300">
          Query runs are not available yet (they arrive with the inference backend).
        </p>
      )}
      {error && (
        <p role="alert" className="rounded border border-red-800 bg-red-950 px-3 py-2 text-sm text-red-200">
          {error}
        </p>
      )}
      {/* run card and history (Task 12) */}
    </section>
  );
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `pnpm test src/screens/QueryScreen.test.tsx src/query`
Expected: `QueryScreen` 3 passed; Task 10 tests green.

- [ ] **Step 6: Format, lint, type-check and commit**

Run: `pnpm format && pnpm lint && pnpm exec tsc -b`

```bash
git add src/query/SourcePicker.tsx src/query/ImagePicker.tsx src/query/TilingFields.tsx src/query/EstimateCard.tsx src/screens/QueryScreen.tsx src/screens/QueryScreen.test.tsx
git commit -m "feat(ui): query screen with source, image selection, tiling, estimate and start"
```

---

### Task 12: Run card (progress, results, review link, promote) and run history

**Files:**
- Create: `frontend/src/query/useTrackedRun.ts`, `frontend/src/query/useQueryRuns.ts`, `frontend/src/query/RunCard.tsx`, `frontend/src/query/RunHistory.tsx`
- Modify: `frontend/src/screens/QueryScreen.tsx` (mount `RunCard` and `RunHistory`), `frontend/src/screens/ReviewScreen.tsx` (`?ids=` narrows the queue)
- Test: `frontend/src/query/RunCard.test.tsx`, `frontend/src/screens/ReviewScreenIds.test.tsx`

**Interfaces:**
- Consumes: `fetchQueryRun`, `fetchQueryRuns`, `promoteQueryRun` (Task 2), `useTrackedJob`, `JobCard` (Tasks 3-4), `reviewLink`, `runTitle` (Task 10), `REVIEW_QUEUE_QUERY`, `useImageList` (S2).
- Produces:
  - `useTrackedRun(projectId, runId: string | null): {run: QueryRun | null; job: Job | null; error: string | null; replace: (run: QueryRun) => void}` (run fetched on mount and every 2 s while its job is active; the job through `useTrackedJob`).
  - `useQueryRuns(projectId): {runs: QueryRun[]; loading: boolean; unavailable: boolean; error: string | null; reload(): void}`.
  - `RunCard({projectId, runId}: {projectId: string; runId: string})`: `<section data-testid="run-card">` with title, parameters line, `JobCard` (when the job is known), `<p data-testid="box-count">` "N boxes written so far", link "Review results" (`reviewLink`, plus "(first 200 of N)" when capped), promote form: input `aria-label="Minimum confidence"` (default 0.5) and button "Promote" (`POST promote`, then `role="status"` "6 boxes accepted" and the "Promoted" badge).
  - `RunHistory({runs, selectedId, onSelect}: {runs: QueryRun[]; selectedId: string | null; onSelect: (id: string) => void})`: `<ul data-testid="run-history">` newest first, each row a button `aria-label="Open run {title}"` with created time, image count, box count, promoted marker.
  - `ReviewScreen`: reads `?ids=`; when present the list query is `{...REVIEW_QUEUE_QUERY, ids}` and a line "Showing N images from a query run" with a link "Show the whole queue" (`/p/{p}/review`) appears.

- [ ] **Step 1: Write the failing tests**

`frontend/src/query/RunCard.test.tsx`:

```tsx
import { describe, it, expect, beforeEach } from "vitest";
import { screen, fireEvent, waitFor } from "@testing-library/react";
import { exampleQueryRun, fakeClient, IMAGE_ID, IMAGE_ID_2, PROJECT_ID, RUN_ID, runningJob } from "@/test/fixtures";
import { renderWithProviders } from "@/test/render";
import { useJobsStore } from "@/store/jobs";
import { RunCard } from "./RunCard";

describe("RunCard", () => {
  beforeEach(() => useJobsStore.setState({ jobs: {}, panelOpen: false }));

  it("shows the run, its job, the box count, the review link and promotes", async () => {
    const { api, requests } = fakeClient([
      { method: "GET", path: /\/query-runs\/[^/]+$/, body: exampleQueryRun },
      { method: "GET", path: /\/jobs\/[^/]+$/, body: { ...runningJob, id: exampleQueryRun.job_id as string, type: "infer" } },
      {
        method: "POST",
        path: /\/promote$/,
        body: { query_run: { ...exampleQueryRun, promoted_at: "2026-09-17T13:30:00Z" }, accepted: 6 },
      },
    ]);
    renderWithProviders(<RunCard projectId={PROJECT_ID} runId={RUN_ID} />, { api });
    const card = await screen.findByTestId("run-card");
    expect(card).toHaveTextContent('Anthropic: "dump trucks"');
    expect(screen.getByTestId("box-count")).toHaveTextContent("7 boxes written so far");
    await waitFor(() => expect(screen.getByTestId(`job-${exampleQueryRun.job_id}`)).toBeInTheDocument());
    expect(screen.getByRole("link", { name: "Review results" })).toHaveAttribute(
      "href",
      `/p/${PROJECT_ID}/review?ids=${IMAGE_ID},${IMAGE_ID_2}`,
    );
    expect(screen.getByLabelText("Minimum confidence")).toHaveValue(0.5);
    fireEvent.change(screen.getByLabelText("Minimum confidence"), { target: { value: "0.6" } });
    fireEvent.click(screen.getByRole("button", { name: "Promote" }));
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("6 boxes accepted"));
    expect(requests.find((r) => r.url.endsWith("/promote"))).toMatchObject({
      method: "POST",
      url: `/api/v1/projects/${PROJECT_ID}/query-runs/${RUN_ID}/promote`,
      body: { min_confidence: 0.6 },
    });
    expect(screen.getByText("Promoted")).toBeInTheDocument();
  });
});
```

`frontend/src/screens/ReviewScreenIds.test.tsx`:

```tsx
import { describe, it, expect } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import { exampleImagePage, fakeClient, IMAGE_ID, IMAGE_ID_2, PROJECT_ID } from "@/test/fixtures";
import { renderWithProviders } from "@/test/render";
import { ReviewScreen } from "./ReviewScreen";

describe("ReviewScreen with ?ids=", () => {
  it("asks for exactly those images and offers the whole queue", async () => {
    const { api, requests } = fakeClient([
      { method: "GET", path: /\/images$/, body: exampleImagePage },
      { method: "GET", path: /\/sources$/, body: { items: [], next_cursor: null } },
    ]);
    renderWithProviders(<ReviewScreen />, {
      api,
      route: `/p/${PROJECT_ID}/review?ids=${IMAGE_ID},${IMAGE_ID_2}`,
      path: "/p/:projectId/review",
    });
    await waitFor(() => expect(requests.some((r) => r.url.includes("/images?"))).toBe(true));
    const url = new URL(`http://x${requests.find((r) => r.url.includes("/images?"))?.url}`);
    expect(url.searchParams.get("ids")).toBe(`${IMAGE_ID},${IMAGE_ID_2}`);
    expect(url.searchParams.get("has_pending")).toBe("true");
    expect(await screen.findByText(/Showing 2 images from a query run/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Show the whole queue" })).toHaveAttribute("href", `/p/${PROJECT_ID}/review`);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm test src/query/RunCard.test.tsx src/screens/ReviewScreenIds.test.tsx`
Expected: `RunCard` unresolved; the review test fails on the `ids` query parameter being null.

- [ ] **Step 3: Implement the hooks**

`frontend/src/query/useTrackedRun.ts`:

```ts
import { useCallback, useEffect, useState } from "react";
import type { Job, QueryRun } from "@contract/client";
import { useApi } from "@/api/client";
import { messageOf } from "@/api/errors";
import { fetchQueryRun } from "@/api/queryRuns";
import { pushLog } from "@/app/diagnostics";
import { JOB_POLL_MS, useTrackedJob } from "@/jobs/useTrackedJob";
import { isActiveJob } from "@/store/jobs";

interface State {
  runId: string | null;
  run: QueryRun | null;
  error: string | null;
}

/** The run (box_count grows while the job writes tiles) and its job; both polled while the job is active. */
export function useTrackedRun(
  projectId: string,
  runId: string | null,
): { run: QueryRun | null; job: Job | null; error: string | null; replace: (run: QueryRun) => void } {
  const api = useApi();
  const [state, setState] = useState<State>({ runId: null, run: null, error: null });
  const run = state.runId === runId ? state.run : null;
  const job = useTrackedJob(projectId, run?.job_id ?? null);
  const live = job !== null && isActiveJob(job);

  useEffect(() => {
    if (!runId) return;
    let cancelled = false;
    const tick = () => {
      fetchQueryRun(api, projectId, runId)
        .then((r) => {
          if (!cancelled) setState({ runId, run: r, error: null });
        })
        .catch((e: unknown) => {
          if (cancelled) return;
          pushLog(`load query run ${runId} failed: ${messageOf(e, String(e))}`);
          setState((s) => ({ runId, run: s.runId === runId ? s.run : null, error: messageOf(e, "could not load the run") }));
        });
    };
    tick();
    if (!live) {
      return () => {
        cancelled = true;
      };
    }
    const id = window.setInterval(tick, JOB_POLL_MS);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, [api, projectId, runId, live]);

  const replace = useCallback((r: QueryRun) => setState({ runId: r.id, run: r, error: null }), []);
  return { run, job, error: state.runId === runId ? state.error : null, replace };
}
```

`frontend/src/query/useQueryRuns.ts`:

```ts
import { useCallback, useEffect, useState } from "react";
import type { QueryRun } from "@contract/client";
import { useApi } from "@/api/client";
import { isNotImplemented, messageOf } from "@/api/errors";
import { fetchQueryRuns } from "@/api/queryRuns";
import { pushLog } from "@/app/diagnostics";

interface State {
  key: string;
  runs: QueryRun[];
  unavailable: boolean;
  error: string | null;
}

export function useQueryRuns(projectId: string): {
  runs: QueryRun[];
  loading: boolean;
  unavailable: boolean;
  error: string | null;
  reload: () => void;
} {
  const api = useApi();
  const [attempt, setAttempt] = useState(0);
  const key = `${projectId}|${attempt}`;
  const [state, setState] = useState<State>({ key: "", runs: [], unavailable: false, error: null });

  useEffect(() => {
    let cancelled = false;
    fetchQueryRuns(api, projectId)
      .then((runs) => {
        if (!cancelled) setState({ key, runs, unavailable: false, error: null });
      })
      .catch((e: unknown) => {
        if (cancelled) return;
        pushLog(`list query runs failed: ${messageOf(e, String(e))}`);
        const unavailable = isNotImplemented(e);
        setState({ key, runs: [], unavailable, error: unavailable ? null : messageOf(e, "could not load query runs") });
      });
    return () => {
      cancelled = true;
    };
  }, [api, projectId, key]);

  const reload = useCallback(() => setAttempt((a) => a + 1), []);
  const loaded = state.key === key;
  return {
    runs: state.runs,
    loading: !loaded,
    unavailable: loaded && state.unavailable,
    error: loaded ? state.error : null,
    reload,
  };
}
```

- [ ] **Step 4: Implement `RunCard.tsx` and `RunHistory.tsx`**

`frontend/src/query/RunCard.tsx`:

```tsx
import { useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { useApi } from "@/api/client";
import { messageOf } from "@/api/errors";
import { promoteQueryRun } from "@/api/queryRuns";
import { pushLog } from "@/app/diagnostics";
import { JobCard } from "@/jobs/JobCard";
import { formatDate } from "@/models/modelLabels";
import { reviewLink, runTitle } from "./queryModel";
import { useTrackedRun } from "./useTrackedRun";

const input = "rounded border border-slate-700 bg-slate-800 px-2 py-1 text-sm";
const primary = "rounded bg-orange-600 px-3 py-1 text-sm font-medium hover:bg-orange-500 disabled:opacity-50";

export function RunCard({ projectId, runId }: { projectId: string; runId: string }) {
  const api = useApi();
  const { run, job, error: loadError, replace } = useTrackedRun(projectId, runId);
  const [minConf, setMinConf] = useState("0.5");
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function promote(e: FormEvent) {
    e.preventDefault();
    const threshold = Number(minConf);
    if (!Number.isFinite(threshold) || threshold < 0 || threshold > 1) {
      setError("Minimum confidence must be between 0 and 1.");
      return;
    }
    setBusy(true);
    setError(null);
    setStatus(null);
    try {
      const result = await promoteQueryRun(api, projectId, runId, threshold);
      replace(result.query_run);
      setStatus(`${result.accepted} ${result.accepted === 1 ? "box" : "boxes"} accepted`);
    } catch (err) {
      pushLog(`promote run ${runId} failed: ${messageOf(err, String(err))}`);
      setError(messageOf(err, "could not promote the run"));
    } finally {
      setBusy(false);
    }
  }

  if (loadError) {
    return (
      <p role="alert" className="rounded border border-red-800 bg-red-950 px-3 py-2 text-sm text-red-200">
        {loadError}
      </p>
    );
  }
  if (!run) return <p className="text-sm text-slate-400">Loading run {runId.slice(0, 8)}…</p>;
  const link = reviewLink(projectId, run);
  const tiling = run.tiling.enabled
    ? `tiles ${run.tiling.tile_size} px, overlap ${run.tiling.overlap}, NMS IoU ${run.tiling.nms_iou}`
    : "no tiling";
  return (
    <section data-testid="run-card" className="flex max-w-3xl flex-col gap-3 rounded border border-slate-800 bg-slate-800/30 p-4">
      <header className="flex flex-wrap items-baseline gap-2">
        <h2 className="text-lg font-medium">{runTitle(run)}</h2>
        {run.promoted_at && (
          <span className="rounded bg-emerald-800 px-2 py-0.5 text-xs text-emerald-100" title={run.promoted_at}>
            Promoted
          </span>
        )}
        <span className="text-xs text-slate-400">started {formatDate(run.created_at)}</span>
      </header>
      <p className="text-xs text-slate-400">
        {run.image_ids.length} {run.image_ids.length === 1 ? "image" : "images"}, {tiling}, confidence {run.conf}
        {run.model_name ? `, model ${run.model_name}` : ""}
      </p>
      {job && <JobCard projectId={projectId} job={job} />}
      <p data-testid="box-count" className="text-sm">
        {run.box_count} {run.box_count === 1 ? "box" : "boxes"} written so far
      </p>
      <p className="text-sm">
        <Link to={link.to} className="text-orange-300 hover:underline">
          Review results
        </Link>
        {link.capped && (
          <span className="text-xs text-slate-400">
            {" "}
            (first {link.to.split(",").length} of {run.image_ids.length} images)
          </span>
        )}
      </p>
      <form onSubmit={(e) => void promote(e)} className="flex flex-wrap items-end gap-2">
        <label className="flex flex-col gap-1 text-xs text-slate-400">
          Minimum confidence
          <input
            aria-label="Minimum confidence"
            type="number"
            min={0}
            max={1}
            step={0.05}
            value={minConf}
            onChange={(e) => setMinConf(e.target.value)}
            className={`${input} w-24`}
          />
        </label>
        <button type="submit" className={primary} disabled={busy}>
          Promote
        </button>
        <span className="text-xs text-slate-400">Accepts the run's unreviewed boxes at or above the threshold.</span>
      </form>
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

`frontend/src/query/RunHistory.tsx`:

```tsx
import type { QueryRun } from "@contract/client";
import { formatDate } from "@/models/modelLabels";
import { runTitle } from "./queryModel";

interface Props {
  runs: QueryRun[];
  selectedId: string | null;
  onSelect: (id: string) => void;
}

export function RunHistory({ runs, selectedId, onSelect }: Props) {
  if (runs.length === 0) return <p className="text-sm text-slate-400">No query runs yet.</p>;
  return (
    <ul data-testid="run-history" className="flex flex-col gap-1">
      {runs.map((run) => {
        const title = runTitle(run);
        return (
          <li key={run.id}>
            <button
              type="button"
              aria-label={`Open run ${title}`}
              aria-current={run.id === selectedId ? "true" : undefined}
              onClick={() => onSelect(run.id)}
              className={`flex w-full flex-wrap items-center gap-3 rounded px-2 py-1 text-left text-sm hover:bg-slate-800 ${run.id === selectedId ? "bg-slate-800" : ""}`}
            >
              <span className="font-medium">{title}</span>
              <span className="text-xs text-slate-400">
                {formatDate(run.created_at)} · {run.image_ids.length} images · {run.box_count} boxes
                {run.promoted_at ? " · promoted" : ""}
              </span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}
```

Write the `·` separators in JSX as `{"·"}`.

- [ ] **Step 5: Mount the card and the history in `QueryScreen.tsx`**

Add `import { RunCard } from "@/query/RunCard";`, `import { RunHistory } from "@/query/RunHistory";`, `import { useQueryRuns } from "@/query/useQueryRuns";`. Add `const history = useQueryRuns(projectId);` next to the other hooks. In `doStart`, after `setParams(...)`, call `history.reload();`. Replace the `run-started` paragraph with `<RunCard projectId={projectId} runId={runId} />` and the `{/* run card and history (Task 12) */}` comment with:

```tsx
      <div className="flex max-w-3xl flex-col gap-2">
        <h2 className="text-lg font-medium">Run history</h2>
        {history.error && (
          <p role="alert" className="text-xs text-red-300">
            {history.error}
          </p>
        )}
        {history.unavailable ? (
          <p role="note" className="text-xs text-slate-400">
            Query runs are not available yet (they arrive with the inference backend).
          </p>
        ) : (
          <RunHistory runs={history.runs} selectedId={runId} onSelect={(id) => setParams({ run: id })} />
        )}
      </div>
```

Update `src/screens/QueryScreen.test.tsx`: the first test's final assertion becomes `await waitFor(() => expect(screen.getByTestId("run-card")).toBeInTheDocument());` and its route list gains `{ method: "GET", path: /\/query-runs\/[^/]+$/, body: exampleQueryRun }` and `{ method: "GET", path: /\/jobs\/[^/]+$/, body: { ...runningJob, type: "infer" } }` (add them before the `POST /query-runs` route so the `/query-runs$/` regex still matches the create). Add to the same test, after the run card appears: `expect(screen.getByTestId("run-history")).toHaveTextContent("dump trucks");` with the base `GET /query-runs` route body changed to `{ items: [exampleQueryRun], next_cursor: null }`.

- [ ] **Step 6: Narrow the review queue with `?ids=` in `ReviewScreen.tsx`**

Add `Link, useSearchParams` to the `react-router-dom` import. Replace `const list = useImageList(projectId, REVIEW_QUEUE_QUERY);` with:

```tsx
  const [params] = useSearchParams();
  const ids = params.get("ids");
  const query = useMemo(() => (ids ? { ...REVIEW_QUEUE_QUERY, ids } : REVIEW_QUEUE_QUERY), [ids]);
  const list = useImageList(projectId, query);
```

and under the description paragraph add:

```tsx
        {ids && (
          <p className="text-sm text-slate-300">
            Showing {ids.split(",").length} images from a query run.{" "}
            <Link to={`/p/${projectId}/review`} className="text-orange-300 hover:underline">
              Show the whole queue
            </Link>
          </p>
        )}
```

The contract says `ids` makes the backend ignore the other filters; the queue then shows every image of the run (also those without pending proposals), which is what "review this run's results" needs. This is contract gap 2 below.

- [ ] **Step 7: Run the tests to verify they pass**

Run: `pnpm test src/query src/screens/QueryScreen.test.tsx src/screens/ReviewScreenIds.test.tsx src/screens/ReviewScreen.test.tsx`
Expected: `RunCard` 1, `ReviewScreenIds` 1, `QueryScreen` 3 passed; S2's `ReviewScreen.test.tsx` unchanged and green.

- [ ] **Step 8: Format, lint, type-check and commit**

Run: `pnpm format && pnpm lint && pnpm exec tsc -b`

```bash
git add src/query/useTrackedRun.ts src/query/useQueryRuns.ts src/query/RunCard.tsx src/query/RunCard.test.tsx src/query/RunHistory.tsx src/screens/QueryScreen.tsx src/screens/QueryScreen.test.tsx src/screens/ReviewScreen.tsx src/screens/ReviewScreenIds.test.tsx
git commit -m "feat(ui): query run card with progress, review link, promotion and run history"
```

---
