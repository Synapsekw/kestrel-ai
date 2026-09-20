# S5 report: training and inference UI

**Branch:** `s5-training-inference-ui` (worktree `E:\Dev\Yolo\app\.worktrees\s5-training-inference-ui`)
**Commit range:** `a0322d5..f44c3ee` — 21 commits, one per plan task.
**Plan:** `docs/superpowers/plans/2026-09-18-s5-training-inference-ui.md` (21 tasks, all done).

## Status

All 21 tasks implemented TDD (failing test first, run, implement, run again), each with its own commit
using the plan's message. Final verification green:

- `pnpm test` — **65 files, 189 tests passed** (S2 had 41 files / 136 tests; S5 adds 24 files / 53 tests).
- `pnpm lint` — eslint clean, prettier clean.
- `pnpm exec tsc -b` — silent.
- `pnpm build` — `vite build` writes `dist/` (only the pre-existing >500 kB chunk-size warning).
- `pnpm e2e` — **41 passed**, run twice with identical results (S2's 27: boot 1, data-manager 6, editor 15,
  review 1, settings 4; S5's 14: models 4, train 2, query 2, jobs 2, providers 2, import 2).
- Contract untouched: `git status --porcelain -- contract` empty, `pnpm --dir contract check` clean
  ("No results with a severity of 'error' found"), `git diff --exit-code -- client/schema.d.ts` passes
  after regeneration.
- Ports 1420 and 4010 free afterwards; the Prism mock I started was stopped by PID. 8080/9090 never touched.

---

## Per-task notes with RED/GREEN evidence

Every task ran `pnpm test <files>` before implementing (RED) and after (GREEN), then
`pnpm format && pnpm lint && pnpm exec tsc -b` before committing. Only the interesting output is quoted.

### Task 1 — fixtures, `collectPages`, models/datasets wrappers (`d059463`)
- RED: `Failed to resolve import "./paging"` (+ `./models`, `./datasets`) — 3 files failed, no tests.
- GREEN: `Test Files 3 passed (3) / Tests 9 passed (9)`.
- The plan's Step 7 fallback for `parseAs: "text"` typing **was needed**: `fetchResultsCsv` carries the cast
  `as Promise<{ data?: string; error?: unknown; response: Response }>` (plan uncertainty (b), confirmed).

### Task 2 — providers / query-runs / jobs wrappers (`aa9e379`)
- RED: three `Failed to resolve import` errors. GREEN: `pnpm test src/api` → `11 passed / 33 tests`.

### Task 3 — jobs store + polling hooks (`8a82933`)
- RED: `(0 , selectActiveCount) is not a function`, `useJobsStore.getState(...).upsertMany is not a function`,
  and three unresolved `src/jobs` imports.
- GREEN: `pnpm test src/store src/jobs` → `7 passed / 22 tests`.

### Task 4 — JobCard, JobLogView, JobsButton, JobsPanel, Shell (`8937c7c`)
- RED: unresolved `./JobCard`, `./JobsButton`.
- First GREEN attempt failed: `expected [...] to have a length of 2 but got 4` in `JobsPanel.test.tsx`.
  **Cause (plan defect):** `getAllByTestId(/^job-/)` also matched the card's inner `data-testid="job-state"`
  and `data-testid="job-log"`. Several later e2e specs use `getByTestId(/^job-/)` expecting a *single*
  element inside one card, which would have been a Playwright strict-mode violation.
  **Fix (deviation):** the inner testids are now `jobcard-state` and `jobcard-log`; the card root keeps
  `job-{id}` exactly as the plan specifies, so every `/^job-/` query resolves only to card roots.
  All later tests/specs were written with the new names.
- GREEN: `pnpm test src/jobs` → `5 passed / 11 tests`; `pnpm e2e e2e/boot.spec.ts e2e/data-manager.spec.ts`
  → `7 passed` (the S2 "1 active job" assertion reads the new button unchanged).

### Task 5 — registry helpers (`f18f338`)
- RED: four unresolved imports. GREEN: `4 passed / 7 tests`.
- Deviation: the plan writes `"\–"` / `"\…"` / `"\→"` in several string literals. A backslash before a
  non-escape character is a no-op in JS but `no-useless-escape` (in `js.configs.recommended`) rejects it,
  so all of these are written as the plain characters `–`, `…`, `→` (identical values; the tests compare
  the same literals).

### Task 6 — registry screen, table, detail, artifacts, curve (`d78f5ef`)
- RED: `Unable to find an element by: [data-testid="model-table"]` (placeholder screen) plus unresolved
  `./ModelArtifacts`. GREEN: `6 passed / 12 tests`.
- Deviation: the plan's temporary `<div data-slot="model-actions" hidden>{String(Boolean(project && …))}</div>`
  placeholder fails `tsc` with `TS2774: This condition will always return true since this function is always
  defined`. Replaced with `ModelDetail(props)` + `const { projectId, model, datasetNames } = props;` for that
  one commit; Task 7 destructures the full prop list as planned. The public prop type never changed.
- `FakeRoute.raw` was added to `fakeFetch` exactly as the plan specifies (additive, the only change to S2's
  test helper).

### Task 7 — import / export / delete / pre-annotation actions (`8e74b6f`)
- RED: `Unable to find … "Export ONNX"`, `"Use as pre-annotation model"`, `"Delete model"`; unresolved
  `./ImportModelForm`.
- Two plan-test defects found and fixed (deviations, both in the plan's own test code):
  1. `requests[0]` is **not** the action: `ModelDetail` mounts `ModelArtifacts`, which fires the
     `results.csv` GET first. The three assertions now select by method
     (`requests.find((r) => r.method === "POST" | "PATCH" | "DELETE")`), which is also a stronger assertion.
  2. `rerender` from `renderWithProviders` replaces the **whole** tree including the providers
     (`useApi must be used inside <ApiProvider>`), because `renderWithProviders` passes the providers to
     `render`. The badge case now does `unmount()` + a fresh `renderWithProviders`, which exercises the same
     branch (`exampleProject.preannotation_model_id === exampleModel.id`).
  3. `usePreannotation` is rejected by `react-hooks/rules-of-hooks` ("React Hook … cannot be called inside a
     callback") because of the `use` prefix. Renamed to `setAsPreannotation`.
- GREEN: `pnpm test src/models src/screens/ModelsScreen.test.tsx` → `8 passed / 17 tests`.

### Task 8 — training form model, `useDatasets`, `TrainForm` (`10f7e18`)
- RED: two unresolved imports. First GREEN attempt: `Found multiple elements with the text: /30 images/`
  (the string appears in the `<option>` label *and* in the split summary). The assertion now matches the
  summary line `/30 images: 24 train \/ 6 val/`.
- GREEN: `2 passed / 6 tests`.

### Task 9 — `TrainProgress` + Train screen (`741cc48`)
- RED: `Unable to find a label with the text of: Dataset`; unresolved `./TrainProgress`.
- GREEN: `4 passed / 10 tests`.
- Small refactor: the plan's nested ternary for the headline is a `HEADLINE` lookup record (same output,
  easier to read); `jobcard-log` used in place of `job-log` (Task 4 deviation).

### Task 10 — query model, image selection, providers hook, `NavSource` (`b854dc2`)
- RED: `(0 , useProviders) is not a function` + two unresolved `./queryModel` imports.
- GREEN: `pnpm test src/query src/api/useProviders.test.tsx src/store/navigation.test.ts` → `4 passed / 10`.

### Task 11 — query screen (`883c331`)
- RED: `Unable to find a label with the text of: Model` (placeholder screen), 3 tests failing.
- GREEN: `3 passed / 10 tests`.

### Task 12 — run card, run history, `?ids=` review queue (`efcc4cc`)
- RED: `expected null to be '10000000-…'` for the `ids` query parameter; unresolved `./RunCard`.
- One deviation: `ReviewScreen` already has a local `const ids = list.items.map(...)`, so the plan's
  `const ids = params.get("ids")` is a duplicate declaration (`The symbol "ids" has already been declared`).
  Renamed to `runIds`.
- GREEN: `pnpm test src/query src/screens/{QueryScreen,ReviewScreenIds,ReviewScreen}.test.tsx` → all green;
  full unit suite `59 files / 177 tests`.

### Task 13 — provider settings replace the placeholder (`8704bff`)
- RED: two unresolved imports. GREEN: `pnpm test src/settings` → `6 passed / 15 tests`.
- `pnpm e2e e2e/settings.spec.ts` → `4 passed`; the S2 assertion
  `getByText(/Windows Credential Manager/)` still resolves uniquely (the new section is the only place that
  sentence appears now), so **no S2 e2e change was needed** (the plan's `.first()` contingency was not used).

### Task 14 — import images, sources API, sources section (`2ac0d8c`)
- **Mock verified with curl first** (plan uncertainty (c)). All three responses match what the plan inferred
  from the schema examples, byte for byte:
  - `GET /projects/{p}/sources?limit=1000` → one source `50000000-…0001`, folder
    `E:\Dev\Yolo\Ahmadia Construction Data`, site `ahmadia`, 3299 images, 0 duplicates,
    `job_id j0000000-…0001`, `next_cursor: "string"`.
  - `GET /sources/{id}/stats` → the `Stats` example (3299 / 30 labeled / 3269 unlabeled / 112 boxes /
    41 pending / groups `0031`, `0033`).
  - `POST /sources` → `202` with that same source plus job `j…0001` (`import`, `running`, 0.42), whatever
    the body.
- RED: three unresolved imports. GREEN: `pnpm test src/api/sources.test.ts src/data src/settings`
  → `18 passed / 42 tests`; `pnpm e2e e2e/import.spec.ts e2e/data-manager.spec.ts e2e/settings.spec.ts`
  → `12 passed`.

### Task 15 — Data Manager bulk actions (`68ad782`)
- RED: `Cannot read properties of undefined (reading 'id')` (S2's `addImagesToDataset` returned a `Job`),
  `expected "spy" to be called at least once` (no `onRunModel`), unresolved `./AddToDatasetDialog`.
- GREEN: `pnpm test src/data` → `11 passed / 25 tests`; `pnpm e2e e2e/data-manager.spec.ts` → `6 passed`.
- The unused `MODEL` constant was removed from `e2e/data-manager.spec.ts` as the plan instructed.

### Task 16 — models e2e (`b479247`)
- One plan bug fixed: inside the third test the local `const imported = page.waitForRequest(...)` shadows the
  module-level `imported` model fixture used by the `page.route` callback declared above it — a TDZ
  `ReferenceError` at route time. The fixture is now `importedModel` and the local is `importRequest`.
- **Plan uncertainty (a) resolved:** `page.route((url) => …)` URL predicates and
  `locator("xpath=ancestor::tr")` both work as written on Playwright 1.63. First run: `4 passed`.

### Task 17 — train e2e (`5738b20`)
- First run failed: `strict mode violation: getByLabel('Batch size') resolved to 2 elements` — Playwright's
  `getByLabel` is **substring**-matching, so it also matched "Automatic batch size". Fixed with
  `getByLabel("Batch size", { exact: true })`. GREEN: `2 passed`.

### Task 18 — query e2e (`cef39ff`)
Three genuine problems, all fixed in the spec (no production-code change):
1. Same substring problem for `Model` (vs "Local model"), `Provider` (vs "Cloud provider"), `Images`
   (vs "Number of images") and `Confidence` (vs "Minimum confidence") → `{ exact: true }` on all four.
2. `expect(option).toBeDisabled()` does not treat `<option disabled>` as disabled in Playwright 1.63
   (log: `locator resolved to <option disabled …> - unexpected value "enabled"`). Replaced with
   `toHaveJSProperty("disabled", true)`.
3. **Mock inconsistency:** the mock's query run points at job `j…0003` but `GET /jobs/{id}` *always* answers
   with job `j…0001`, so `useTrackedJob` (which looks the job up by the id it asked for — correct against a
   real backend) never resolves and the run card shows no job. The spec now `page.route`s
   `GET /query-runs/{RUN}` to return the same run with `job_id` set to the job the mock actually serves.
   That route also remembers the promotion (`promoted_at`), because the card re-polls the run while its job
   is active and the static mock answer would otherwise clobber the "Promoted" badge.
- GREEN: `2 passed`.

### Tasks 19, 20 — jobs panel and provider e2e (`73e0dc6`, `839e1fc`)
- Written with `jobcard-state` / `jobcard-log`; both passed on the first run
  (`pnpm e2e e2e/jobs.spec.ts e2e/providers.spec.ts e2e/settings.spec.ts` → `8 passed`).

### Task 21 — final verification (`f44c3ee`)
- Full suites as listed under **Status**, e2e run twice.
- Manual/visual pass done by driving the real app in Chromium against the mock and capturing full-page
  screenshots of Models (+detail), Train, Query, Settings (top and bottom) and the jobs panel over the Data
  Manager. Everything renders in the S2 visual language, nothing overlaps or overflows, the slide-over sits
  correctly over `<main>`, and the Sources and Provider-keys sections read well. The temporary screenshot
  spec was deleted before committing.
- One cosmetic issue found and fixed in this commit: the query screen's image picker rendered
  "Images / Images" (fieldset legend plus field label). The visible field label now reads "Selection";
  the control keeps `aria-label="Images"`, so every unit test and e2e locator is unchanged.

---

## Files changed

105 files, +7198 / −313. Exactly the allowlist the plan permits — nothing under `src/editor/*` or
`src/api/{client,errors,events,backend,project,images,boxes}.ts(x)` was touched, and `backend/` and the
contract were never opened for writing.

**New (88):** `api/{paging,models,datasets,providers,queryRuns,jobs,sources}.ts` (+ tests,
`api/useProviders.test.tsx`); `jobs/{jobLabels,useNow,useTrackedJob,useJobLog,useJobList,JobCard,JobLogView,
JobsButton,JobsPanel}` (+ tests); `models/{resultsCsv,aliases,modelLabels,useModels,useDatasetNames,
ModelTable,TrainingCurve,ModelArtifacts,ExportButtons,ImportModelForm,ModelDetail}` (+ tests);
`train/{trainModel,useDatasets,TrainForm,TrainProgress}` (+ tests);
`query/{queryModel,useImageSelection,useTrackedRun,useQueryRuns,SourcePicker,ImagePicker,TilingFields,
EstimateCard,RunCard,RunHistory}` (+ tests);
`settings/{providersModel,ProviderCard,ProvidersSection,SourcesSection}` (+ tests);
`data/{ImportImagesDialog,AddToDatasetDialog}` (+ tests);
`screens/{ModelsScreen,TrainScreen,QueryScreen,ReviewScreenIds}.test.tsx`;
`e2e/{models,train,query,jobs,providers,import}.spec.ts`.

**Modified (16):** `app/Shell.tsx`, `store/{jobs,navigation}.ts` (+ `jobs.test.ts`),
`data/{bulkActions,SelectionBar}.ts(x)` (+ tests), `screens/{DataManager,Models,Train,Query,Review,Settings}Screen.tsx`,
`test/fixtures.ts`, `e2e/data-manager.spec.ts`.

**Deleted (1):** `settings/ProvidersPlaceholder.tsx`.

---

## Deviations from the plan (all deliberate, with reasons)

| # | Deviation | Reason |
|---|---|---|
| 1 | `job-state` → `jobcard-state`, `job-log` → `jobcard-log` | The plan's inner testids collide with the card-root query `/^job-/`, breaking one unit test and (silently) four e2e strict-mode locators. The card root keeps `job-{id}` as specified. |
| 2 | Plain `–`, `…`, `→` instead of `"\–"`, `"\…"`, `"\→"` | `no-useless-escape` (eslint recommended) rejects the escapes; the values are identical. |
| 3 | `ModelDetail` used `props` + partial destructure in Task 6 only | The plan's `data-slot` placeholder fails `tsc` (`TS2774`). Task 7 restores the full destructure; the prop type never changed. |
| 4 | `usePreannotation` → `setAsPreannotation` | `react-hooks/rules-of-hooks` treats any `use*` function as a hook. |
| 5 | Three `ModelDetail.test.tsx` assertions select requests by method, not `requests[0]` | `ModelArtifacts` fires the `results.csv` GET first; index 0 is never the action. |
| 6 | `ModelDetail.test.tsx` uses `unmount()` + re-render instead of `rerender` | `renderWithProviders` passes the providers to `render`, so `rerender(<ModelDetail/>)` drops the API context. |
| 7 | `ReviewScreen`'s `?ids=` variable is `runIds` | `ids` already exists in that component. |
| 8 | `TrainForm.test.tsx` matches `/30 images: 24 train \/ 6 val/` | `/30 images/` matches the `<option>` label too. |
| 9 | e2e `getByLabel(..., { exact: true })` for Model, Provider, Images, Confidence, Batch size | Playwright's `getByLabel` is substring-based; the plan's plain strings hit sibling labels. |
| 10 | e2e `toHaveJSProperty("disabled", true)` for the disabled `<option>` | Playwright 1.63's `toBeDisabled()` does not cover `<option disabled>`. |
| 11 | `query.spec.ts` routes `GET /query-runs/{RUN}` to a run whose `job_id` is the job the mock serves | Mock inconsistency (run points at `j…0003`, `GET /jobs/*` always answers `j…0001`); see **Concerns**. |
| 12 | `models.spec.ts`: fixture renamed `importedModel`, local renamed `importRequest` | The plan shadows the module-level `imported` inside the test, a TDZ `ReferenceError` in the route callback. |
| 13 | Query screen image-picker field label reads "Selection" | Removed the "Images / Images" stutter found in the visual pass; `aria-label` unchanged. |

Nothing in the contract or the spec was contradicted by any of these; no behaviour the plan asked for was
dropped.

## Plan uncertainties, resolved

- **(a) `page.route(url => …)` predicates and `xpath=ancestor::tr`** — both work as written
  (`models.spec.ts` passed on the first run). No change needed.
- **(b) `parseAs: "text"` typing for `fetchResultsCsv`** — the cast the plan offered as a fallback **is**
  required; it is in `api/models.ts` with the plan's exact shape.
- **(c) the mock's `sources` responses** — verified with `curl` before writing the code; identical to what the
  plan inferred from the schema examples (details in Task 14 above).
- **(d) "Sources" lives on the settings screen** — implemented there, mounted between `ImportDefaultsSection`
  and `ProvidersSection`; it reads naturally next to the import defaults it shares settings with.

## Contract gaps

The plan's nine gaps all still hold as written; I hit four of them in practice and worked around each
inside the contract (numbering follows the plan's "Contract gaps found"):

1. **No `example` on the page schemas** → the mock answers `next_cursor: "string"` on `models`, `datasets`,
   `query-runs`, `jobs`, `sources`. `collectPages` stops on a repeated cursor and dedupes by id, so every
   list costs two requests under the mock and terminates. Confirmed live against Prism.
2. **No way to list a query run's images** → "Review results" links to `/review?ids=…` capped at 200 ids;
   because `ids` overrides the other filters, the narrowed queue shows every image of the run, not only
   those with pending proposals. A `query_run_id` filter that combines with `has_pending` would fix it.
5. **Artifact content negotiation** → `fetchResultsCsv` sends `Accept: text/csv` explicitly, because
   `image/png` is listed first and the mock honours the header.
9. **Generated client requires defaulted fields** → every request sends the contract defaults explicitly
   (`TrainRequest`, `ExportRequest`, `DatasetCreate`, `QueryRunCreate`, `Tiling`, `PromoteRequest`).

Two additional observations for the goal owner (not contract changes, mock-fixture inconsistencies):

- **A.** The mock's `QueryRun` example points at `job_id j…0003`, but `GET /jobs/{id}` always returns the
  example job `j…0001`. Any UI that fetches a run's job by id therefore gets nothing under the mock. Giving
  the `Job` example the id `j…0003`, or the `QueryRun` example `job_id: j…0001`, would let the run card be
  exercised against the plain mock. The real backend is unaffected.
- **B.** `GET /models/{id}/artifacts/{artifact}` on the mock returns the 6-byte body `string`, so the
  `<img>` elements fall back to their "not available" text and `parseResultsCsv("string")` yields no points
  — exactly as the plan predicted; the e2e serves a real CSV through `page.route`.

## Concerns

1. **`useTrackedJob` polls forever when a job id never resolves.** It keeps polling every 2 s while the job
   is unknown, which is correct for a job that has not appeared yet but never gives up. Against the real
   backend a `GET /jobs/{id}` 404 means the id is wrong and polling is pointless. The failure is visible
   only in `diagnostics` (`poll job … failed: …`). Worth a follow-up: stop polling after N consecutive
   `not_found` answers. (Surfaced by mock inconsistency A above.)
2. **The real backend is unverified.** Everything here ran against Prism only, as instructed. S4's real
   `providers` / `query-runs` and S3's `models` / `train` are the goal owner's checkpoint. The 501 branch of
   every screen is unit-tested with the fake fetch and e2e-tested with `page.route` fulfilments, so a
   not-yet-implemented backend degrades to a `role="note"` rather than an error.
3. **`fetchDataset` and `fetchDatasetStats` have no UI consumer yet** (only their own unit tests). They are
   part of the datasets API surface the plan specifies; a dataset-detail view would use them. Flagging so a
   reviewer does not read them as accidental dead code.
4. **The Data Manager does not auto-refresh after an import on the mock.** The list refreshes from
   `images.changed` websocket events, and the mock has no websocket (`/api/v1/events` is 404). Against the
   real backend this works; on the mock the user re-opens the screen. Behaviour matches the plan.
5. **`vite build` still warns about a >500 kB chunk.** Pre-existing (Konva); S5 adds no dependency and no
   code splitting was in scope.
6. **The `ids` review link is capped at 200 images.** A run over more images shows "(first 200 of N images)".
   Contract gap 2; a `query_run_id` filter would remove the cap.

## Secrets

The API key is typed into `<input type="password" autoComplete="off" spellCheck={false}>`, copied to a local
`const`, **cleared from component state before the request is issued** (`setApiKey("")` runs first, so even a
failed `PUT` leaves the field empty — unit-tested), sent once in `PUT /providers/{provider}/key`, never
rendered, never written to any file, and never logged: every `pushLog` line in `ProviderCard` carries the
provider name only. `ProvidersSection.test.tsx` asserts `document.body.textContent` does not contain the key
and `providers.spec.ts` asserts the same on `page.content()`. No secret appears in any fixture or spec beyond
the throwaway literals `sk-test`, `sk-secret`, `sk-test-123`.

---

## Manual testing guide (against the Prism mock)

**Start:** two terminals in the worktree.

```bash
pnpm --dir contract mock      # Prism on 127.0.0.1:4010
pnpm --dir frontend dev       # Vite on 127.0.0.1:1420
```

Open `http://127.0.0.1:1420/`, click **Open** on the Ahmadia project (or go straight to
`/p/7f1c2e3a-1111-4000-8000-000000000001/data`). Remember the mock's limits: POSTs are not persisted, every
job endpoint answers the same running import job at 42 %, and every list answers one example item.

**1. Import images (Data Manager).** Click **Import images**. The four preparation fields are prefilled from
the project defaults (4000 / 95 / 4 / the group regex) and **Browse** is absent outside Tauri. Type any
folder (e.g. `E:\Dev\Yolo\Ahmadia Construction Data`), optionally a site, change Max side to 3000, press
**Start import**. Expect: the jobs slide-over opens with the import job at 42 %, the top-bar button reads
"1 active job", and a green status line "Import started for … (job j0000000)".

**2. Jobs panel (top bar, any screen).** Click the "N active jobs" button. Expect the panel listing the
project's jobs newest first: title "Import", a "Running" badge, a 42 % progress bar, "1386 / 3299 images",
a ticking elapsed time. **Show log** appends the two example log lines; **Cancel job** posts the cancel
(the mock answers `running` again, so the state does not change — that is the mock, not the UI);
**Refresh** re-lists; **Close jobs** dismisses it.

**3. Sources (Settings, below Import defaults).** Expect one row: `ahmadia`, the folder, "3299 images,
0 duplicates, imported 2026-09-17 10:30". **Stats** loads the per-source statistics (30 labeled / 3269
unlabeled, 112 boxes / 41 pending, 2 groups, resolutions, capture range). **Re-import new files** posts the
same folder with the source's own settings and opens the jobs panel.

**4. Provider keys (Settings, bottom).** OpenAI shows "No key stored", Anthropic "Key stored". Type anything
into **OpenAI API key** and press **Save OpenAI key**: the field clears immediately, the badge flips to
"Key stored", and the key never appears anywhere on the page. **Test Anthropic** shows
"OK: responded in 1.2 s (claude-opus-5)". Change **Anthropic requests per minute** to 10 and **Save Anthropic
settings**: only the changed field is sent. **Remove Anthropic key** flips the badge back and disables the
button.

**5. Model registry (Models).** The table lists the imported `yolo11m-coco` with en dashes for the metrics.
Click the name: the detail shows base weights, weights path, classes, the alias `truck → dump_truck`,
"No metrics: imported weights are not evaluated on a project dataset", "No training artifacts (imported
weights)", "Not exported yet", and the green **Pre-annotation model** badge (the example project already
points at this model). **Export ONNX** posts `{format: "onnx", imgsz: 1280, half: false}` and shows the job
card inline; the top-bar counter goes to 1. **Import weights** opens the form with `truck=dump_truck`
prefilled (no **Browse** outside Tauri); filling a name and a path posts the import and selects the returned
model. **Delete model** asks first, then sends the DELETE and closes the detail.
(A *trained* model with metrics, per-class table, the results.csv curve and the two artifact images cannot
be seen against the plain mock — the registry only holds the imported example. `e2e/models.spec.ts` serves
one through `page.route` and asserts all of it.)

**6. Train.** Dataset `v1` and base model `yolo11m-coco` are preselected and the name is suggested as
`v1-yolo11m-coco`; the dataset line shows "30 images: 24 train / 6 val, 1 classes" and links to the Data
Manager. Change Epochs to 3, Augmentation to *aerial*, untick **auto** and set Batch size 8, press
**Start training**: the request carries exactly those values plus the contract defaults, the URL gains
`?job=…`, and the live card appears — epoch shows "–" (the mock's message is an import message, not
`epoch 3/50 …`), elapsed ticks, the progress bar sits at 42 %, and the log tail is open. **Cancel job**
posts the cancel; **New training** returns to the form and the job appears under "Recent training jobs".

**7. Data Manager → Query (selection hand-off).** In **List** view tick one image, then **Run model**: the
app navigates to the query screen with the Images picker on "Data Manager selection" and
"1 image selected".

**8. Add to dataset.** Back on the Data Manager, tick an image, **Add to dataset**, name `v1`, seed 7,
**Create dataset**: the request carries `{name, split_method: "by_group", val_fraction: 0.2, seed: 7,
image_ids}`, the job card appears inside the dialog and a **Train on it** link points at the train screen.

**9. Query run.** On **Query**, the local model is preselected from the project's pre-annotation model and
"All unlabeled images" resolves to "2 images selected". Switch to **Cloud provider**: OpenAI is disabled and
suffixed "(no key stored)", Anthropic is selected. Type "dump trucks", press **Estimate**: the card reads
"5 images, 40 tiles, 40 requests, estimated $0.80 (at $0.02 per request)". Change any field and the estimate
disappears and **Start** disables again — by design, Start only ever runs the estimated request. Press
**Estimate** then **Start**: the URL gains `?run=…` and the run card shows
`Anthropic: "dump trucks"`, the parameter line, "7 boxes written so far" and the **Review results** link.
Set **Minimum confidence** 0.5 and **Promote**: "6 boxes accepted" (the "Promoted" badge needs a backend that
returns `promoted_at` on the next poll; the mock does not, see gap A). **Review results** opens the review
queue narrowed to the run's two images with "Showing 2 images from a query run" and a **Show the whole
queue** link. The run also appears under **Run history**.
*Note:* against the plain mock the run card shows no job card (mock gap A above); `e2e/query.spec.ts` routes
around it and asserts the job card, so the code path is covered.

**10. Degraded backends.** Every screen tolerates a 501: Models shows "The model registry is not available
yet" and disables **Import weights**; Train shows "Training is not available yet" and keeps the form usable;
Query shows "Query runs are not available yet"; Settings shows "Cloud providers are not available yet" while
Classes and Pre-annotation keep working; Sources shows "Sources are not available yet". These branches are
unit-tested and e2e-tested with `page.route` fulfilments (the mock never answers 501).

---

# Fix round 1 (review of `a0322d5..f44c3ee`)

**Commits:** `f827a4c` (contract) and `b1acfc8` (code), on top of `f44c3ee`.
**Range:** `f44c3ee..b1acfc8` — 27 files, +608 / −64.

## Final verification

| Command | Result |
|---|---|
| `pnpm lint` | eslint clean, `All matched files use Prettier code style!` |
| `pnpm exec tsc -b` | silent |
| `pnpm test` | **66 files, 199 tests passed** (was 65 / 189: +1 file, +10 tests) |
| `pnpm build` | `✓ built in 1.60s` (only the pre-existing chunk-size warning) |
| `pnpm e2e` (run 1) | **42 passed** (was 41; +1 resume spec) |
| `pnpm e2e` (run 2) | **42 passed** |
| `pnpm --dir contract check` | spectral clean, generate clean, `git diff --exit-code -- client/schema.d.ts` passes |

Worktree clean; ports 1420/4010 free (Playwright manages its own servers).

## Contract (commit `f827a4c`)

Applied the goal owner's two edits to `contract/openapi.yaml` verbatim and regenerated the client:

- `QueryRunCreate.query` gained `minLength: 1`.
- New path `POST /api/v1/projects/{projectId}/query-runs/{runId}/resume` (`resumeQueryRun`, 202 `JobRef`,
  409 `conflict`, 404 unknown run), inserted immediately before the `/promote` path.

`pnpm --dir ../contract generate` from `frontend/` regenerated `contract/client/schema.d.ts`, which now
carries `resumeQueryRun` (paths entry at line 674, operation at line 3281). Both files are in the commit.
`pnpm lint` in `contract/` reports "No results with a severity of 'error' found!".

## IMPORTANT 1 — `useTrackedJob` never gave up (`jobs/useTrackedJob.ts`)

**What changed.** The poller now stops for good in two cases and says why:

- **Job unknown** (`code === "not_found"` or HTTP 404, via a local `isMissing`): stop after the *first*
  answer — a job the backend does not know is never going to appear.
- **Any other failure**: retry, and give up after `JOB_POLL_MAX_FAILURES` (5) *consecutive* failures; a
  success resets the counter, so a flaky sidecar still recovers.

Logging went from one line every 2 s to at most two per tracker: the first failure of a run
(`poll job … failed: …`) and the one that ends it (`poll job … gave up: …`).

The return type is now `TrackedJob = { job: Job | null; error: string | null }`. `error` is scoped to the
tracked id, so switching `?job=` clears it and the new id is polled from scratch. The four call sites were
updated: `ExportButtons` and `AddToDatasetDialog` (destructure only), `useTrackedRun` (folds the job error
into its own `error`), and `TrainProgress`, which now renders `role="alert"`
"Job {id8} is not available: {reason}" instead of "Loading job…" forever.

**Covering tests** (`src/jobs/useTrackedJob.test.tsx`, fake timers, both branches):

- *stops after one 404 and reports that the job is unknown* — advances 5 poll intervals, asserts exactly
  **1** request and `error === "job j1 not found"`.
- *retries other failures and gives up after the limit* — a 500 route; after one interval there are 2
  requests and **no** error yet (still retrying); after the limit there are exactly
  `JOB_POLL_MAX_FAILURES` requests and `error === "db locked"`.

The two pre-existing tests were kept (adapted to the new return shape).

```
✓ src/jobs/useTrackedJob.test.tsx (4 tests) 127ms
```

## IMPORTANT 2 — `RunCard` threw the card away on a poll failure (`query/RunCard.tsx`, `query/useTrackedRun.ts`)

**What changed.** The early return is now guarded by `!run`: the alert is built once and rendered *inside*
the card (above the header) whenever a run is loaded, and only stands alone when there is nothing to show
yet. A failed poll no longer wipes the title, the box count, the review link, the promote form or the job
card. `useTrackedRun` keeps the previously loaded run in state on a failed refetch and resets its failure
flag on the next success.

**Covering test** — *keeps the loaded card visible when a later poll fails*: a custom `fetch` answers the
first `GET /query-runs/{id}` with the run and every later one with a 500 (a fake route's status is fixed, so
`fakeClient` cannot express this). It waits for the alert, then asserts the card element is still mounted
and still shows "7 boxes written so far".

## NEW — Resume an interrupted run

- `api/queryRuns.ts`: `resumeQueryRun(api, projectId, runId): Promise<Job>` → `POST …/resume`, returning
  `JobRef.job`.
- `RunCard`: a **Resume run** button appears only when the run's job exists and is neither active nor
  succeeded (`failed` / `cancelled`), so it is absent while a job is queued or running and after success.
  It is disabled while any card action is in flight (`busy`). On success the new job is `upsert`ed into the
  store, the card starts tracking it (`useTrackedRun.trackJob`, which repoints `run.job_id` without waiting
  for the next run poll) and a `role="status"` reads "Resumed (job {id8})". A 409 renders the envelope
  message in `role="alert"` with the card intact.
- Explanatory line next to the button: "Finished tiles are reused, so the run continues where it stopped."

**Covering tests:**

- `src/api/queryRuns.test.ts` — *resumes an interrupted run and surfaces the 409 conflict*: asserts the POST
  URL and empty body, and that a 409 rejects with `{code: "conflict", status: 409}`.
- `src/query/RunCard.test.tsx` — *offers Resume for an interrupted job and posts to the resume endpoint*
  (status line, POST URL, new job in the store) and *shows the 409 envelope when the run's job is still
  going* (alert shown, card still rendered). The existing happy-path test now also asserts the button is
  **absent** for a running job.
- `e2e/query.spec.ts` — *an interrupted run offers Resume, which re-submits the run's job*: routes the run's
  job to a `failed` job, asserts the state badge and the job error, then asserts the real
  `POST /query-runs/{RUN}/resume` (served by Prism from the new contract path) and the status line.

## Minors

| # | Change | Where | Test |
|---|---|---|---|
| 3 | `useInitialJobs(projectId)` does one `GET /jobs` when a project opens, upserting into the store, so the active-job counter and TrainScreen's recent jobs are populated after a restart | `jobs/useJobList.ts`, mounted in `app/Shell.tsx` | new `src/jobs/useJobList.test.tsx` (2 tests): loads once into the store (1 request, `active()` = 1); silent without a project and on a failing list |
| 4 | The carried Data Manager selection is snapshotted into component state on entry and **cleared** from the navigation store, so a later visit cannot inherit it | `screens/QueryScreen.tsx` | `QueryScreen.test.tsx` — *consumes the carried selection once*: the screen still shows "1 image selected" while `useNavigationStore` reports `source: null`, `ids: []` |
| 6 | Tiling fields are not validated while tiling is off (they are disabled in the form); confidence is still always validated | `query/queryModel.ts` | `queryModel.test.ts` — a form with `tilingEnabled: false` and deliberately invalid `tileSize`/`overlap` validates to `null` |
| 8 | `SourcesSection` re-lists the sources after a re-import so the counts are not stale | `settings/SourcesSection.tsx` (`reload` via an attempt key, passed to `SourceRow` as `onReimported`) | existing `SourcesSection.test.tsx` still green (it exercises the re-import path) |
| 9 | The run poller and the job-list poller log only the first failure of a run of failures | `query/useTrackedRun.ts`, `jobs/useJobList.ts` | behavioural, no assertion added (logging only) |
| 10 | a11y: `aria-current` instead of `aria-selected` on the registry `<tr>`; the jobs slide-over gets `tabIndex={-1}`, takes focus when it opens and closes on Escape; the API key field is `autoComplete="new-password"` | `models/ModelTable.tsx`, `jobs/JobsPanel.tsx`, `settings/ProviderCard.tsx` | `ModelsScreen.test.tsx` asserts `aria-current="true"`; `JobsPanel.test.tsx` — *takes focus when it opens and closes on Escape* |

## Two follow-on fixes the changes forced (worth knowing)

1. **StrictMode.** My first take on minor 4 cleared the navigation context in an unmount cleanup. React 18
   StrictMode double-invokes effects (mount → cleanup → mount), so the context was wiped *during the first
   mount* and the query screen showed "0 images selected". Caught by `e2e/data-manager.spec.ts` (the unit
   test passed because Testing Library does not wrap in StrictMode). The committed version snapshots the
   ids in a `useState` initializer and clears the store in a mount effect, which is StrictMode-safe: the
   snapshot survives and the second effect run finds nothing to clear.
2. **The jobs button no longer reads "0 active jobs" on arrival**, because minor 3 loads the job list when a
   project opens. `e2e/jobs.spec.ts` clicked the button by that exact text, which became a race. Both clicks
   now use `getByRole("button", { name: /active jobs?$/ })`; the assertion that the counter reaches
   "1 active job" is unchanged.

## Deviation from the review text

- Minor 3 suggested "`useJobList(projectId, true)` once in `Shell`". `useJobList` keeps polling every 5 s
  while enabled, so mounting it that way would add a permanent app-wide 5 s poll on every screen. The
  requirement as stated ("one initial `fetchJobs` when a project opens") is implemented as a dedicated
  `useInitialJobs(projectId)` in the same module: one request per project, no interval. The panel still
  starts its 5 s poll while open, unchanged.

## Concerns after this round

- The concern raised in the first report — unbounded polling on an unknown job id — is **resolved** by
  Important 1 and no longer applies.
- The mock inconsistency (its `QueryRun` points at job `…0003` while `GET /jobs/*` always answers `…0001`)
  still stands; both affected query e2e tests route around it. Unchanged from the first report.
- `resumeQueryRun` is exercised against Prism only. Whether a resumed run really reuses persisted tiles is
  S4's to prove; the UI asserts the request, the 409 branch and the job hand-off.

---

# Fix round 2 (re-review of round 1)

**Commit:** `1bcd89a`, on top of `b1acfc8`. 11 files.

## Final verification

| Command | Result |
|---|---|
| `pnpm lint` | eslint clean, `All matched files use Prettier code style!` |
| `pnpm exec tsc -b` | silent |
| `pnpm test` | **66 files, 204 tests passed** (was 199: +5) |
| `pnpm build` | `✓ built in 1.63s` |
| `pnpm e2e` (run 1) | **42 passed** |
| `pnpm e2e` (run 2) | **42 passed** |
| `pnpm --dir contract check` | clean (contract untouched this round) |

Worktree clean.

## 1. NOT ADDRESSED — the re-list ran while the import job was still queued

**What was wrong.** `reimport()` called `onReimported()` immediately after the 202, so the new
`GET /sources` raced the job and returned the pre-import counts.

**What changed** (`settings/SourcesSection.tsx`). `SourceRow` now keeps the returned job id, tracks it with
`useTrackedJob`, and re-lists only when the job reaches a terminal state:

```ts
const [reimportJobId, setReimportJobId] = useState<string | null>(null);
const { job } = useTrackedJob(projectId, reimportJobId);
const finished = job !== null && !isActiveJob(job);
useEffect(() => { if (finished) onReimported(); }, [finished, onReimported]);
```

The row's cached `stats` are dropped by remounting the row when the source actually changed: the list keys
rows by `${id}|${image_count}|${duplicate_count}|${imported_at}`. This clears the statistics exactly when
they went stale and keeps them when the re-import changed nothing.

*Why not `setStats(null)` in the effect:* the ESLint React-Compiler rule `set-state-in-effect` forbids
calling a setter synchronously in an effect body (the same rule that shaped the S2 screens). Calling only
`onReimported()` there and letting the key do the clearing keeps the rule satisfied with no extra state.

**Covering test** — *re-lists only once the re-import job has finished, and drops the stale statistics*:
the `sources` route counts its calls and answers 3299 images first and 3400 afterwards; the `jobs` route
answers `running` on the first poll and `succeeded` on the second. The test asserts, in order, that after
the first poll `sourceLists === 1` (no premature re-list), then that "3400 images" appears with
`sourceLists === 2`, and that "3269 unlabeled" (the statistics loaded before the re-import) is gone.

## 2. IMPORTANT — the give-up was permanent

**What changed** (`jobs/useTrackedJob.ts`). Giving up now only pauses the poller:

- **(a) Store-driven resume.** The effect subscribes to `useJobsStore` for its job id. Anything that
  changes that entry — a websocket `job.state`/`job.progress`, the jobs panel's list, another tracker's
  poll — clears the recorded failure and calls `start()` again. The backend answering someone is proof it
  is back.
- **(b) Retry.** `TrackedJob` gained `retry()`, which clears the failure and bumps an `attempt` counter in
  the effect's deps, re-arming the poller. `TrainProgress` and `RunCard` render the alert with a **Retry**
  button next to the message (`RunCard`'s goes through `useTrackedRun.retry`, which re-arms the run fetch
  *and* the job tracker).

The effect was restructured around `start()` / `stop()` so it can be armed and disarmed many times within
one mount; `start()` is a no-op when an interval already exists or when the store already holds a finished
job, and polling now also stops by itself when a poll returns a terminal job.

**Covering tests** (fake timers, in `src/jobs/useTrackedJob.test.tsx`), both driven by a `recoveringClient(n)`
helper whose `fetch` 404s for the first `n` calls and then answers with the job:

- *re-arms and clears the error when the job reaches the store from elsewhere* — after the give-up
  (1 request, error set), `useJobsStore.getState().upsert(runningJob)` clears the error, the job is
  returned, and a second request went out.
- *re-arms on retry() after it gave up* — `result.current.retry()` clears the error, the poller asks again
  (2 calls) and the job loads (`progress === 0.42`).

## 3. IMPORTANT — the recorded failure was never cleared

**What changed.** The failure is cleared in three places instead of none: on every successful poll
(`clearFailure()` in the `.then`), whenever the store delivers anything for that id (the subscription
above), and by `retry()`. The clear is a functional update scoped to the tracked id, so React bails out
when there is nothing to clear and a different `?job=` is unaffected. `useTrackedRun` clears its own run
failure on the next successful run fetch and in `retry()`.

The two tests above are exactly this assertion (`error` back to `null` after the job arrives, and after a
retry that succeeds); the round-1 tests still assert that the error *is* raised in the first place.

## Minors

| Minor | Change |
|---|---|
| `toTiling` normalisation | `query/queryModel.ts`: disabled tiling returns `{...DEFAULT_TILING, enabled: false}`, so the disabled fields' leftovers never reach the run. The unit test now asserts a `tile_size: 640` typed while tiling was on comes back as the default `1280` when it is off. The e2e expectation was already the defaults, so it is unchanged. |
| `JobsPanel` focus restore | The panel records `document.activeElement` when it opens and focuses it again on close. New test *returns focus to the button that opened it*. |
| `giveUp` double-fire | `giveUp` sets a `gaveUp` flag and returns early if it is already set, so a second in-flight request cannot give up — or log — twice. The `catch` handler checks it too. |
| `trackJob` race | `useTrackedRun` records the resumed job id as `pendingJobId`; a run poll that still reports the *old* `job_id` keeps the local one, and `pendingJobId` is dropped as soon as the backend reports the new job. |
| failed re-list | `SourcesSection`'s catch keeps `prev.sources` instead of emptying the list (only a 501 clears it, where the section is not shown at all). New test *keeps the sources already on screen when a re-list fails*. |

## Deviation from the review text

- The reviewer asked that `giveUp` "sets the cancelled flag". Setting the effect's `cancelled` flag would
  also kill the store subscription that item 2(a) relies on, so the guard is a dedicated `gaveUp` flag with
  the same effect for the stated purpose (no second give-up, no duplicate log line) while leaving the
  re-arm path alive. `cancelled` keeps its single meaning: this effect run has been torn down.

## Concerns after this round

- The give-up thresholds (immediate on 404, five consecutive failures otherwise, ~8 s) are unchanged and
  still a judgement call; with the resume paths in place the cost of being wrong is now a Retry click or the
  next websocket event rather than a dead screen.
- `SourceRow`'s job tracking means a re-import now polls `GET /jobs/{id}` every 2 s until the import ends —
  one extra poller per row the user re-imports, stopped automatically at the terminal state.
- Unchanged from earlier rounds: the mock's `QueryRun` points at a job id the mock's `GET /jobs/*` never
  serves (both query e2e tests route around it), and `resumeQueryRun` is exercised against Prism only.
