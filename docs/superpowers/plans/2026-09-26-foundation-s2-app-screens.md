# Foundation S2: App Sections (Catalogue, Models, Jobs, Settings appearance) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

> **Where and when this runs.** The executor works in its own worktree
> `E:\Dev\Yolo\app\.claude\worktrees\f-s2` on branch `task/f-s2`, cut from `main` with
> `scripts\start-task.ps1 f-s2` **after SH (shell), BC (catalogue + findings backend) and BM (models
> backend) have merged into `main`**. C0 (contract) and DS (design system) merged earlier, because SH
> depends on both. Do not start while any of SH, BC or BM is unmerged. S1 (project screens) runs at
> the same time in its own worktree. Merges into `main` are serialized: rebase onto `main` and run the
> full gate before merging.

**Goal:** Build the four app-level sections of the Foundation: the **Catalogue** (types, the severity
scale editor, and the migrated-types classification banner that starts the findings backfill),
**Models** (the Library host, Datasets built across projects, Training with compare), **Jobs** (every
job in the app), and **Settings → Appearance**.

**Architecture:** Every screen is a thin React component over three layers: typed API wrappers in
`frontend/src/api/` (the only files that name contract paths), pure models (`*Model.ts`, unit-tested
without React), and small hooks that load, poll and merge into the existing stores
(`store/jobs.ts`, `store/changes.ts`). Screens are built only from the DS primitives in `@/ui` and
mounted as lazy entries in SH's `routes/appRoutes.tsx`. Long work (dataset build, export, training,
findings backfill) is started here and followed as library jobs through the existing jobs store.

**Tech Stack:** React 18, TypeScript 5.9, react-router-dom 6.30, zustand 5, openapi-fetch 0.13 with
the generated `@contract/client`, Tailwind 3.4 with the Aero glass tokens, vitest 3 +
@testing-library/react 16, Playwright 1.63 against the Prism mock with `page.route` fixtures.

**Spec:** `docs/superpowers/specs/2026-09-26-foundation-design.md` (F), mainly §7 (catalogue and
severity), §10.1–10.2 (Jobs), §12 (Models), §4.3 and §5.3 (Settings appearance, "Your name"), §15
(errors), §16 (testing), §18 (unit S2). Umbrella: `docs/superpowers/specs/2026-09-26-inspection-platform-design.md`
(D2, D4, D7, D8, D9). Look: theme `.tD` in
`E:\Dev\Yolo\app\.superpowers\brainstorm\1481982-1790403567\content\visual-directions.html`.

**Sibling plans this one consumes.** This plan was reconciled against the DS, SH and BM plans as they
stood when it was finished. Names taken from them are marked **confirmed** under "Assumed names":

- DS: `docs/superpowers/plans/2026-09-26-foundation-ds-design-system.md`. It was still being
  written: its Tasks 9–18 (severity, tabs, inspector, table) had no interface blocks yet.
- SH: `docs/superpowers/plans/2026-09-26-foundation-sh-shell.md`. It carries a table that answers
  this plan's earlier guesses.
- BM: `docs/superpowers/plans/2026-09-26-foundation-bm-models-backend.md`
- S1: `docs/superpowers/plans/2026-09-26-foundation-s1-project-screens.md`, which runs in parallel

C0's and BC's plans did not exist. The catalogue, Jobs and project-types operation and schema names
are the spec's, or this plan's choice, and are flagged. Task 1 Step 1 checks every name against the
merged code and records the real one.

## Global Constraints

- **Contract-first.** `contract/openapi.yaml` is the source of truth and `contract/client/schema.d.ts`
  is generated and never hand-edited. **S2 edits them only to retire C0's deprecated operations whose
  last caller it deletes** (the index, "Deprecated contract paths"): the five `/projects/{projectId}/datasets*`
  operations and `trainModel` (Task 11 Step 6b) and `updateClasses` (Task 15 Step 4b), each with its
  `RETIRING` entry, regenerating `schema.d.ts` in the same commit. If an operation or schema this
  plan needs is missing or shaped differently, first rename at the call site in the one wrapper file
  that names it (`src/api/catalogue.ts`, `appJobs.ts`, `libraryDatasets.ts`, `trainingRuns.ts`,
  `projectTypes.ts`, `recentProjects.ts`, `library.ts`). If the operation does not exist at all, stop
  and raise it with the coordinator: it is a C0 change.
- **Schema types come from `components["schemas"][...]`** of `@contract/client`, never from a named
  re-export that may not exist.
- **Primitives only.** No raw colours, no `rgba(` in `className`, no `backdrop-blur` or
  `backdrop-filter`, no `duration-\d+`, `ease-[`, `delay-\d+`, `rounded-[`, `font-[`, `shadow-[`,
  and no retired Contour names (`ground`, `side`, `panel`, `well`, `canvas`, `accent-line`,
  `warn-strong`, `inverse`) (F §4.5). `node scripts/check-tokens.mjs` must pass. The one inline
  colour allowed is a data colour (type colour, severity colour) passed through a `--c` custom
  property on `style`, used as `bg-[var(--c)]`, `stroke-[var(--c)]` or `border-[var(--c)]`.
- **Glass (F7).** S2 never blurs. Lists, tables and inspectors are `GlassPanel variant="pane"`, which is
  translucent without blur. `Dialog` owns its own glass.
- **Motion (F §4.2).** Motion animates only `transform` and `opacity`. No interaction waits for
  motion, and nothing on an interaction path runs longer than 400 ms. A loop (live dot, progress
  shimmer) runs only while a job runs. Every JS animation reads `useReducedMotion()`.
- **Typography.** Figures use `tabular-nums`. Ids, figures, kbd, file names and folders are
  `font-mono`.
- **Copy (verbatim from the spec where it gives it):**
  - Banner: "12 types came from your existing projects. Mark which are defects."
  - Backfill: "Create findings from accepted annotations of this type"
  - Sentence case everywhere, and no exclamation marks.
- **Browser storage.** `localStorage` holds per-viewer conveniences only: `kestrel.effects` (DS),
  the reduce-motion override (DS). "Your name" is not browser storage: it is `operator_name` in the backend's `settings.json` (Task 14). Every access is wrapped in try/catch.
- **The app never blocks on a job.** Start requests return at once with a job, and screens follow
  the job through `store/jobs.ts`.
- **No project `kind`.** No S2 file names a project kind, `ProjectKind`, `useProjectKind` or
  `KindRoute` (F §17.1 grep gate).
- **Budget (F §14):**
  - Background jobs started by S2: `dataset_build`, `dataset` (export), `train`, and
    `findings_backfill`. All run in the library runner.
  - Bounded reads:
    - Catalogue list: `limit=500` pages, stopping on a repeated cursor or after 50 pages.
    - Jobs: `limit=50` pages with a cursor. Only the first page is polled, every 5 s.
    - Active counts: `limit=100`.
    - Datasets and training runs: `limit=100` pages.
    - Dataset samples: 24 items.
    - Preview: server `COUNT`s only, debounced 400 ms.
    - Compare: at most 4 `results.csv`.
    - Recent projects: at most 20 (`MAX_RECENT`).
- **Git.** Stage by path, never `git add -A`. Every commit message ends with
  `Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>`. Commit identity is pinned
  by `scripts\start-task.ps1`.
- **Interpreter.** S2 changes no backend file. The backend part of the gate runs the shared venv
  `E:\Dev\Yolo\app\backend\.venv\Scripts\python.exe` from `<worktree>\backend`, because a worktree
  has no venv of its own (CONTRIBUTING.md).
- **UI work loads the design skills first** (AGENTS.md §3): `impeccable` and `emil-design-eng`,
  together with the rewritten `DESIGN.md` ("Design system: Aero glass") and `frontend/src/ui/`.
  Do this before Tasks 3, 5, 6, 9, 10, 11 and 14.
- **The gate** (AGENTS.md §4), in full before the merge:
  ```
  pnpm -C contract check
  cd backend; E:\Dev\Yolo\app\backend\.venv\Scripts\python.exe -m ruff check .; E:\Dev\Yolo\app\backend\.venv\Scripts\python.exe -m ruff format --check .; E:\Dev\Yolo\app\backend\.venv\Scripts\python.exe -m pytest
  pnpm -C frontend lint
  pnpm -C frontend test
  pnpm -C frontend build
  pnpm -C frontend e2e  # scripts\finish-task.ps1 runs it on free ports
  cargo test --manifest-path frontend/src-tauri/Cargo.toml  # only if the frozen sidecar is present
  ```

## Assumed names (reconcile in Task 1 Step 1)

Names marked **confirmed** come from the DS, SH or BM plan. Every other name below is the spec's
name, or, where the spec gives none, this plan's choice. Task 1 Step 1 greps each one. When the merged name
differs, the executor records it in `.superpowers/sdd/f-s2/ledger.md` and renames mechanically at
every call site in this plan. The behaviour stays as specified. The tests query the DOM by role and
text, never by a primitive's props, so they survive a rename.

**DS (`@/ui`):**

| Name | Assumed shape |
|---|---|
| `GlassPanel` | `{variant?: "pane" \| "float"; interactive?: boolean; className?: string; children}` |
| `DataTable` | `<T>{label: string; columns: readonly Column<T>[]; rows: readonly T[]; rowKey: (r: T) => string; total?: number; loading?: boolean; empty?: ReactNode; selected?: ReadonlySet<string>; onSelectionChange?: (next: Set<string>) => void; sort?: Sort \| null; onSortChange?: (next: Sort) => void; onOpen?: (r: T) => void; activeKey?: string \| null; onEndReached?: () => void; endThreshold?: number; className?: string}` (**confirmed by the DS plan, Task 17**). Rows have role `row`; Enter or a click calls `onOpen` |
| `Column<T>` | `{key: string; header: ReactNode; width?: string; render: (row: T, index: number) => ReactNode; sortable?: boolean; align?: "start" \| "end"}` (**confirmed, DS Task 17**) |
| `InspectorPane` | the 340 px right pane: `{label: string; header?: ReactNode; footer?: ReactNode; children; className?}` (**confirmed, DS Task 16**). DS's `InspectorLayout({children; inspector?: ReactNode \| null; className?})` is the two-column grid (`min-[1100px]:grid-cols-[minmax(0,1fr)_340px]`, stacked below 1100 px); this plan's own grids with the same classes may be swapped for it |
| `InspectorSection` | `{title: ReactNode; action?: ReactNode; children; className?}` (**confirmed, DS Task 16**) |
| `Tabs` | `{label: string; items: readonly TabItem[]; value?: string; onChange?; asLinks?: boolean; className?}`, `TabItem {id: string; label: ReactNode; count?: number \| null; to?: string; end?: boolean; disabled?: boolean}` (**confirmed, DS Task 11**) |
| `TypeChip` | `{name: string; colour: string; kind: "defect" \| "object"}` |
| `SeverityPill` | `{level: number \| null}` |
| `SeverityPicker` | `{value: number \| null; onChange: (level: number \| null) => void; allowNone?: boolean; label?: string; className?}`: radios named `"<level> <name>"` and "None" (**confirmed, DS Task 10**) |
| `useSeverityScale()` | returns `SeverityLevel[]` from a React context in `ui/severityScale.ts`, whose default is D4's four levels (**confirmed by the DS plan's decision 4**) |
| `SeverityScaleContext` | DS's React context itself (`createContext<readonly SeverityLevel[]>(DEFAULT_SEVERITY_SCALE)`); DS ships no provider component, so S2 renders `<SeverityScaleContext.Provider value={levels}>` fed by `GET /catalogue/severity` (**confirmed, DS Task 10**) |
| `StatusDot` | `{status: "open" \| "reviewed" \| "closed" \| "running" \| "failed" \| "idle"; live?: boolean; label?: string}` (**confirmed, DS Task 10**) |
| `Kbd`, `Progress`, `Pill`, `Segmented`, `Select`, `Input`, `Checkbox`, `Switch`, `Field`, `Alert`, `EmptyState`, `Dialog`, `Disclosure`, `Button`, `IconButton`, `buttonClass`, `cx`, `transition` | as today |
| `useReducedMotion()` | from `@/ui/motion` |
| `MotionChoice = "system" \| "reduce"`, `readMotionChoice()`, `setMotionChoice(choice)` | from `@/ui/motion`: the Settings override, stored in `kestrel.motion`, which sets `<html data-motion="reduced">` (**confirmed by the DS plan**) |
| `EffectsChoice = "auto" \| "full" \| "reduced"`, `readEffectsChoice()`, `setEffectsChoice(c)` | from `@/app/effects`. `setEffectsChoice` writes `kestrel.effects` and sets `<html data-effects>`. Choosing Auto again clears the remembered probe outcome (**confirmed by the DS plan**) |
| Icons | today's `jobs`, `datasets`, `train`, `models`, `plus`, `x`, `trash`, `refresh`, `import`, `label`, `chevron-down`, plus DS's new `catalogue` and `findings` |
| Tailwind token classes | `bg-surface`, `bg-surface-2`, `bg-field`, `bg-hover`, `border-line`, `border-card-line`, `text-ink`, `text-muted`, `text-dim`, `text-accent`, `bg-accent-soft`, `text-ok`, `text-warn`, `text-danger`, `text-info`, `stroke-accent`, `stroke-ok`, `stroke-info`, `stroke-warn`, `bg-accent`, `bg-ok`, `bg-info`, `bg-warn`, `rounded-panel`, `rounded-control`, `rounded-chip`, `rounded-sm`, `text-2xs`, `text-kpi` |

**SH:**

| Name | Assumed shape |
|---|---|
| `frontend/src/routes/appRoutes.tsx` | exports `appRoutes: RouteObject[]`, assembled by SH's `routes/tree.tsx` under the Shell. SH ships **flat** entries with placeholders: `models` (a redirect), `models/library`, `models/datasets[/:datasetId]` and `models/training[/:runId]` (`SectionPlaceholder`), `catalogue` and `catalogue/severity` (placeholder), `jobs` (`InterimJobs`), `settings`, `about` (**confirmed by the SH plan**) |
| `useProvideRouteActions` | `useProvideRouteActions(actions: readonly RouteAction[])` from `@/app/routeActions` registers the route's context actions. `RouteAction = {id; label; icon?: IconName; variant?: "primary" \| "secondary"; to?: string; run?: () => void; disabled?: boolean; tooltip?: string}` (**confirmed by the SH plan**) |
| Redirects | `/library` → `/models/library`, `/p/:id/datasets` → `/models/datasets?project=:id`, `/p/:id/train` → `/models/training`, `/p/:id/label` → `images?filter=unlabeled`, all in `routes/legacyRedirects.tsx` |
| "Use in dataset…" | SH's SelectionBar and the all-labelled alert hard-code `/models/datasets?new=1&project=<id>`. Task 10 swaps both for `datasetBuilderHref()` |
| "Label next" | SH ships `data/labelNext.ts` (`labelNext(api, projectId)`) and a button in `DataManagerScreen`, so Task 16 only verifies it |

**C0 (all under `/api/v1`, via `components["schemas"]`):**

| Operation | Assumed shape |
|---|---|
| `GET /catalogue/types?include_archived&limit&cursor` | → `CatalogueTypePage {items: CatalogueType[]; next_cursor: string \| null}` (**BC plan**). It also carries the optional `needs_classification: boolean` (C0; BC Task 4 fills it; decision 1) |
| `POST /catalogue/types` | `CatalogueTypeCreate` → 201 `CatalogueType`. 409 `type_exists` with details `{type_id}` (the existing type). 409 `hotkey_conflict` with `{type_id}` (**BC plan**) |
| `PATCH /catalogue/types/{typeId}` | `CatalogueTypePatch` → `CatalogueTypeUpdated` (= `CatalogueType` + `backfill_candidates: boolean`; BC's Python name is `CatalogueTypePatchOut`, so confirm C0's schema name) |
| `POST /catalogue/types/{typeId}/backfill` | → 202 `JobRef`, read as `{job: Job}` (**BC plan**) |
| `GET /catalogue/severity` | → `SeverityScale {levels: SeverityLevel[]}`, with 1–9 levels (**BC plan**) |
| `PUT /catalogue/severity` | `{levels}` → `SeverityScale`. 409 `severity_in_use` with details `{level, projects: string[]}` (project names) (**BC plan**) |
| `POST /catalogue/classification/done` | → 204; clears `catalogue_meta.needs_classification` (C0's `completeCatalogueClassification`, built by BC Task 4; decision 1) |
| 503 `catalogue_unavailable` | BC sends no details. This plan reads an optional `details.folder` and shows no copy button without it |
| `GET /jobs?state&type&project_id&limit&cursor` | → `AppJobPage {items: AppJob[]; next_cursor}`. `state` and `type` are exploded arrays. `project_id=library` selects library jobs |
| `GET /library/datasets?limit&cursor` | → `LibraryDatasetPage {items: LibraryDataset[]; next_cursor}` |
| `GET/DELETE /library/datasets/{datasetId}` | GET → `LibraryDataset` |
| `POST /library/datasets/preview` | `DatasetFilter` → `DatasetPreview` (**BM plan**) |
| `POST /library/datasets` | `LibraryDatasetCreate` → 202 `LibraryDatasetWithJob {dataset, job}` (**BM plan**) |
| `POST /library/datasets/{datasetId}/export` | → 202 `JobRef`, read as `{job}` (BM names the model `JobRef`; confirm its field) |
| `GET /library/datasets/{datasetId}/items?limit&cursor` | → `{items: LibraryDatasetItem[]; next_cursor}` |
| `GET/POST /library/training-runs`, `GET /library/training-runs/{runId}` | POST body `TrainRequest` → 202 `TrainingRunWithJob {training_run, job}` (**BM plan**) |
| `PUT /library/models/{modelId}/class-map` | `{mapping: {[name]: string \| null}}`, **merged** over the stored map → `LibraryModel` (**BM plan**: `LibraryModelClassMapPut`) |
| `PUT /projects/{projectId}/types` | `ProjectTypesUpdate {type_ids: string[]; hotkeys?: {[typeId]: string \| null}}` → `Project` (**BC plan**; its Python name is `ProjectTypesPut`) |

**Schema fields:**

| Schema | Fields |
|---|---|
| `CatalogueType` | `id`, `name`, `colour`, `kind`, `default_severity`, `hotkey`, `group`, `archived`, `origin` (`user` \| `migrated`) (**BC plan**: `CatalogueTypeOut`, no timestamps) |
| `SeverityLevel` | `level`, `name`, `colour` |
| `AppJob` | `Job` + `project_name: string \| null` |
| `LibraryDataset` | the spec §12.1 `dataset` columns plus `sources: DatasetSource[]`. `counts` is `{images, train, val, per_class: {[typeId]: number}}`. `export_state` is `none` \| `building` \| `ready` \| `stale` \| `failed`. `split_method` is a plain string, `split_params` is `{[k]: number}`, and `filter` and `job_id` are nullable (legacy datasets) (**BM plan**: `LibraryDatasetOut`) |
| `DatasetSource` | `{project_id, project_name, project_folder, image_count}` |
| `DatasetFilter` | `{project_ids, type_ids, captured_from, captured_to, reviewed_only}` |
| `DatasetPreview` | `{images, boxes_per_type: {[typeId]: number}, projects: {project_id, project_name, images, boxes, state: "ok" \| "missing" \| "unavailable" \| "timed_out"}[]}` (**BM plan**) |
| `LibraryDatasetCreate` | `{name (≤ 120), task, filter, split_method, val_fraction (0.05–0.5), seed}` (**BM plan**) |
| `LibraryDatasetItem` | `{project_id, image_id, split, label_count}` |
| `TrainingRun` | `{id, name, dataset_id, base_model_id, params: {[k]: unknown}, job_id: string \| null, state: JobState, model_id, metrics: ModelMetrics \| null, created_at, finished_at}` (**BM plan**: `TrainingRunOut`) |
| `LibraryModel` | adds `class_map: {[name]: string \| null}` |
| `ClassDef` | adds `kind`, `default_severity`, `group` |

## Review Focus

These are the five inputs or conditions the spec implies that no test exercises, most likely first.
Each one has a pinning test in the task that owns the code.

1. **The catalogue is unavailable (503 `catalogue_unavailable`).** Expected (F §15):
   - The Catalogue screen blocks with the reason and the folder.
   - The screens that only *read* the catalogue say why a part is off and keep working: the dataset
     builder's type list and the model class mapping.
   - Nothing crashes.

   Pinned in:
   - Task 3: `CatalogueScreen.test.tsx`, "blocks with the reason and the folder when the catalogue is unavailable"
   - Task 10: `DatasetBuilder.test.tsx`, "explains that types cannot be chosen while the catalogue is unavailable"
   - Task 13: `ClassMapEditor.test.tsx`, "says the mapping cannot be edited while the catalogue is unavailable"
2. **Dataset preview responses arrive out of order.** The operator ticks projects quickly, and the
   slow count of an earlier filter lands after the fast count of the current one. Expected: only the
   current filter's counts are shown. Pinned in Task 10: `useDatasetPreview.test.tsx`, "never shows
   the counts of a filter that is no longer current".
3. **A type name that differs only by case, space, `_` or `-`.** For example, "dump-truck" when
   "Dump truck" exists. Expected (F §7.1 `normalise_name`, §15 `type_exists`):
   - The editor refuses it before sending and offers **Use existing**.
   - A server 409 `type_exists` offers the same.

   Pinned in Task 3: `TypeEditor.test.tsx`, "refuses a name that normalises to an existing type and
   opens that one", and "offers the existing type when the server answers type_exists".
4. **A job that finishes while the Running segment is shown and its inspector is open.** Expected:
   - The row leaves the Running list at once, driven by the WebSocket through `store/jobs.ts`,
     without waiting for the next poll.
   - The open inspector stays open, switches to the finished state and offers the result link.

   Pinned in Task 6: `JobsScreen.test.tsx`, "a job that finishes leaves the Running list and its
   open inspector offers the result".
5. **A deep link to something that no longer exists** (`/models/datasets/:id`,
   `/models/training/:runId`, `/jobs?job=`). This happens after a delete, or with a link copied
   before a restart. Expected: a quiet "no longer exists" empty state with the list still usable,
   never an endless skeleton. Pinned in:
   - Task 6: `JobsScreen.test.tsx`, "an unknown ?job= says the job is not in the list"
   - Task 9: `DatasetsScreen.test.tsx`, "a dataset link that no longer exists says so"
   - Task 11: `TrainingScreen.test.tsx`, "a run link that no longer exists says so"

## Decisions this plan makes where the spec is silent or ambiguous

These are recorded here so reviewers do not flag them. Each is also in the final report.

1. **The classification flag.** The spec sets `catalogue_meta.needs_classification` but never
   says how the Catalogue reads it or how it clears. BC's plan exposes it only as the project
   Overview's "types to classify" banner, which links to `/catalogue?origin=migrated`, and never
   clears it.
   - The Catalogue shows its banner when the URL has `?origin=migrated` (BC's link), or when
     `GET /catalogue/types` carries `needs_classification: true`.
   - The banner gets **Done**, which calls `POST /catalogue/classification/done` (204) and so
     also clears BC's Overview banner.
   - C0 adopted both (`CatalogueTypePage.needs_classification`, optional, and
     `completeCatalogueClassification`), and BC builds them (its Task 4). Task 1 Step 1 checks them.
2. **The banner's count** is the number of non-archived types with `origin = migrated`. The banner
   starts with the table filtered to `origin=migrated`, as §7.5 asks. **Show all types** lifts the
   filter.
3. **The severity scale has at most 9 levels.** Review keys 1–9 set severity (§5.6), and digits
   beyond the scale are ignored. BC's `SeverityScale` enforces 1–9 as well. **Add level** is
   disabled at 9, and **Remove top level** is disabled at 1.
4. **Jobs segments.**
   - Running = `running`, Queued = `queued`, Finished = `succeeded` + `cancelled`, Failed = `failed`.
   - Only Running and Queued show counts, from one bounded `state=running&state=queued&limit=100`
     poll. Finished and Failed have no count: the API pages and has no count endpoint, and a scan
     would break the budget.
5. **Jobs URL state.**
   - `?state=` holds the segment (running is the default and is omitted).
   - `?project=` holds the project filter (`library` for library jobs), the shape SH's RunningPill
     links to (`/jobs?project=`).
   - `?job=` opens the inspector. No `/jobs/:jobId` route is added, because §5.3 lists only `/jobs`.
6. **"Reveal folder" on a catalogue 503 becomes "Copy folder path".**
   - There is no app-level reveal endpoint: the existing one is per project.
   - The Tauri capability allow-list has no shell `open`, and widening it is an ADR-level change
     (AGENTS.md).
   - The folder shows in mono with a copy button, the same way the Library shows its unavailable
     root today.
7. **The dataset list shows its sources** from `LibraryDataset.sources` (≤ 20 rows per dataset).
   The list has a sources column (§12.4), so the list item carries them. There is no separate
   detail schema.
8. **The dataset builder needs at least one type.** The frozen class order *is* the type
   selection (§12.1 `classes`). **Select all** fills it in one click. The `segment` task is
   offered but disabled with "Polygon datasets arrive with the Images workspace", because export
   answers 422 `task_not_supported` until I.
9. **The builder opens from the URL:**
   - `/models/datasets?new=1[&project=a,b][&types=x,y]`. `?project=` alone also opens it, which is
     the target of SH's `/p/:id/datasets` redirect.
   - `models/links.ts` exports `datasetBuilderHref()`, so SH's and S1's "Use in dataset…" link can
     build the URL instead of hard-coding it.
10. **Split advice** (`datasets/splitAdvice.ts`, kept) runs on the built dataset's detail, where the
    achieved split is known. The builder states the rule ("whole flights stay together") in its
    hint.
11. **The "New training run" drawer is a `Dialog` opened by `?new=1[&dataset=id]`.** TrainForm
    lists only datasets whose `state` is `ready`.
12. **Compare** is `?compare=a,b[,c,d]`: 2–4 runs that have a registered model (a `results.csv`
    exists). Runs without one are listed as "no curve yet".
13. **The class mapping edits only the leftovers.** A class that already resolves by name or by
    alias (§7.4 order: name → alias → `class_map`) is shown as matched and has no picker, because a
    `class_map` entry for it would never be read. BM's `PUT …/class-map` merges over the stored
    map, so a stored class can move to another type or to Ignore, but not back to "Not mapped".
14. **"Your name"** (§5.3, used on comments) lives in the backend's app-data `settings.json` as
    `operator_name`, read and written through C0's `GET`/`PUT /settings/operator` (built by BC, which
    reads the same key as the comment author). `settings/operatorName.ts` wraps the two calls; nothing
    is kept in localStorage. S1 shows each comment's `author` as the server returns it. (Reconciled
    2026-09-26, the index's operator decision 3.)
15. **The project type list UI (§7.3)** is S2's (the index; Task 15 is unconditional). It replaces
    `ClassesSection`, the last caller of the deprecated `PUT /projects/{id}/classes`, so Task 15 also
    retires `updateClasses` from the contract.
16. **"Label next"** (§12.4). SH's plan already ships it: `data/labelNext.ts` plus a button in
    `DataManagerScreen`. Task 16 therefore only verifies that, and deletes the train-project
    leftovers. Its route-action implementation runs only if SH's file is missing.
17. **A new catalogue type defaults to `defect`.** The Catalogue belongs to an inspection app, and
    migrated types are already objects (F4). This is one click to change.
18. **Keeping the severity scale in sync.** DS's `useSeverityScale()` is a React context whose
    provider is S2's (DS decision 4, SH's reconciliation table). S2 adds
    `CatalogueSeverityProvider`, which loads `GET /catalogue/severity` on boot and on every
    `catalogue.changed` into a small store, and provides DS's context. S2 wraps what SH's
    `app/Shell.tsx` returns in it: a two-line edit, the only one S2 makes to an SH-owned shell file.

## File map

**New, frontend:**

| File | Task | Responsibility |
|---|---|---|
| `src/api/catalogue.ts` (+ test) | 1 | catalogue types, severity scale, backfill, classification-done, error helpers |
| `src/catalogue/normaliseName.ts` (+ test) | 1 | the client mirror of `normalise_name` (§7.1) |
| `src/test/appSectionFixtures.ts` | 1 (+11) | fixtures for catalogue, jobs, datasets and runs |
| `src/store/changes.catalogue.test.ts` | 1 | `catalogueRevision` |
| `src/catalogue/catalogueModel.ts` (+ test) | 2 | filters, drafts, validation, patch diff, clash |
| `src/catalogue/useCatalogue.ts` (+ test) | 2 | loads the catalogue and reloads on `catalogue.changed` |
| `src/catalogue/ColourSwatch.tsx` | 3 | the native colour input as a swatch (shared with Task 5) |
| `src/catalogue/CatalogueScreen.tsx` (+ test) | 3 (+4, 5) | the header, sub-tabs, unavailable block, route action |
| `src/catalogue/TypesPane.tsx` | 3 (+4) | the filters and the types `DataTable` |
| `src/catalogue/TypeEditor.tsx` (+ test) | 3 | the inspector: create, edit, archive |
| `src/catalogue/ClassificationBanner.tsx` (+ test) | 4 | the migrated-types banner |
| `src/catalogue/BackfillOffer.tsx` (+ test) | 4 | the object → defect backfill offer |
| `src/catalogue/severityModel.ts` (+ test) | 5 | level drafts, append, remove top, validation, the in-use message |
| `src/catalogue/SeverityEditor.tsx` (+ test) | 5 | the editor and its live preview |
| `src/catalogue/severityStore.ts` | 5 | the loaded scale (null until the first answer) |
| `src/catalogue/useSeverityScaleSync.ts` | 5 | loads the scale into the store on boot and on change |
| `src/catalogue/CatalogueSeverityProvider.tsx` (+ test) | 5 | provides DS's severity context from the store |
| `src/api/appJobs.ts` (+ test) | 6 | `GET /jobs` |
| `src/jobs/jobsFilters.ts` (+ test) | 6 | segments ↔ states ↔ URL, `mergeJobs` |
| `src/jobs/useAppJobs.ts` (+ test) | 6 | paging, polling, store merge, active counts |
| `src/jobs/JobsScreen.tsx` (+ test) | 6 | the Jobs section |
| `src/jobs/JobInspector.tsx` | 6 | details, log, cancel, go to result |
| `src/api/libraryDatasets.ts` (+ test) | 7 | library datasets |
| `src/api/trainingRuns.ts` (+ test) | 7 | training runs |
| `src/api/recentProjects.ts` (+ test) | 6 | `GET /projects` (≤ 20) and `useRecentProjects` |
| `src/models/usePagedList.ts` | 7 | the shared cursor-paged list core |
| `src/models/useLibraryDatasets.ts` (+ test) | 7 | the list, paging, remove, reload |
| `src/models/useTrainingRuns.ts` | 7 | the list, paging, reload |
| `src/models/ModelsLayout.tsx` (+ test) | 8 | the Models header and sub-tabs |
| `src/models/DatasetsScreen.tsx` (+ test) | 9 (+10) | the list and detail host |
| `src/models/DatasetDetail.tsx` | 9 | status, split, classes, sources, samples, export, delete |
| `src/models/datasetLabels.ts` (+ test) | 9 | the dataset state pill text and tone |
| `src/models/useItemById.ts` | 9 | the deep-linked item from the list or by id, with `missing` on 404 |
| `src/models/links.ts` (+ test) | 9 (+10) | `trainingHref`, then `datasetBuilderHref`, `readBuilderPreset` |
| `src/models/builderModel.ts` (+ test) | 10 | the builder form, filter, validation and create body |
| `src/models/useDatasetPreview.ts` (+ test) | 10 | the debounced, stale-safe preview |
| `src/models/DatasetBuilder.tsx` (+ test) | 10 | the filter form and live counts |
| `src/models/TrainingScreen.tsx` (+ test) | 11 (+12) | the runs list, run detail, new-run dialog |
| `src/models/useResultsCurve.ts` | 11 | `results.csv` → curve points for one model |
| `src/models/compareModel.ts` (+ test) | 12 | the shared epoch axis and selection rules |
| `src/models/CompareCurves.tsx` (+ test) | 12 | the overlaid curves |
| `src/library/classMapModel.ts` (+ test) | 13 | resolution order name → alias → map |
| `src/library/ClassMapEditor.tsx` (+ test) | 13 | the Class mapping section |
| `src/settings/operatorName.ts` (+ test) | 14 | "Your name" |
| `src/settings/AppearanceSection.tsx` (+ test) | 14 | Visual effects, Reduce motion, Your name |
| `src/api/projectTypes.ts` | 15 | `PUT /projects/{id}/types` |
| `src/catalogue/projectTypesModel.ts` (+ test) | 15 | the project type list drafts and rules |
| `src/catalogue/ProjectTypesSection.tsx` (+ test) | 15 | the project settings section |
| `src/data/labelNext.ts` (+ test) | 16 | the "Label next" target |
| `e2e/fixtures/appSections.ts` | 6 (+9, 10, 11) | the `page.route` JSON helper and fixture bodies |
| `e2e/catalogue.spec.ts` | 5 | the Catalogue end to end |
| `e2e/app-settings.spec.ts` | 14 | Appearance end to end |
| `e2e/training.spec.ts` | 11 | training end to end (replaces `train.spec.ts`) |

**Modified, frontend:**

- `src/store/changes.ts` (1)
- `src/routes/appRoutes.tsx` (3, 6, 8, 9, 11)
- `src/app/Shell.tsx`: wrapped in `CatalogueSeverityProvider` (5)
- `src/jobs/jobLabels.ts` (+ test) and `src/jobs/JobCard.tsx` `TYPE_ICON` (6)
- `src/api/library.ts`: `saveClassMap` (7); delete `trainModel` (11)
- `src/library/LibraryScreen.tsx` (8)
- `src/library/ModelDetail.tsx` (13)
- `src/library/modelLabels.ts` (13, only if `segment` is missing)
- `src/train/TrainForm.tsx`, `trainModel.ts` and their tests (11)
- `src/screens/AppSettingsScreen.tsx` (+ test) (14)
- `src/screens/SettingsScreen.tsx` (15)
- `src/screens/DataManagerScreen.tsx`: one line (16)
- `e2e/jobs.spec.ts` (6), `e2e/library.spec.ts` (8), `e2e/datasets.spec.ts` (10), `e2e/settings.spec.ts` (15)

**Deleted, frontend (each "if present": SH or C0 may already have removed it):**

- `src/screens/DatasetsScreen.tsx` (+ test), `src/datasets/DatasetList.tsx` (+ test),
  `src/datasets/DatasetDetail.tsx` (+ test), `src/datasets/NewDatasetForm.tsx` (+ test) (9)
- `src/screens/TrainScreen.tsx` (+ test), `src/train/useDatasets.ts` (+ test), `src/api/datasets.ts`
  (+ test), `e2e/train.spec.ts` (11)
- `src/settings/ClassesSection.tsx` (+ test), `src/settings/classesModel.ts` (+ test) (15)
- `src/screens/LabelResolverScreen.tsx` (+ test), `src/screens/PastDetectionsScreen.tsx` (+ test),
  `e2e/past-detections.spec.ts` (16)

**Docs:**

- `.superpowers/sdd/f-s2/ledger.md` (1, 17), staged with `git add -f`
- `docs/usability/2026-09-26-foundation-s2-walkthrough.md` (17)

## Budget and execution DAG

**Position in F's DAG (§18).** S2 is in **batch 4** (S1 ∥ S2). It needs C0 → DS → SH on the frontend
side and C0 → BC and C0 → BM on the backend side, all merged. S2 is **not on F's critical path**
(C0 → DS → SH → S1 → X). It must merge before X, which writes `models.spec.ts` and the evidence.
S1 and S2 share no file except `src/store/changes.ts` (a one-field addition each) and possibly
`src/test/fixtures.ts` (S2 adds its fixtures in a separate file to avoid that). Whichever merges
second rebases and resolves those few lines.

**Budget:**

- **Background jobs started here** (each shows progress and cancels through the jobs store; the UI
  never waits on one):
  - `dataset_build` (Task 10)
  - `dataset` export (Task 9)
  - `train` (Task 11)
  - `findings_backfill` (Task 4)

  All four are library jobs, followed with `useTrackedJob("library", id)`.
- **Bounded reads:** as in Global Constraints. Nothing in S2 lists images. The sample grid asks for
  24 items, and its thumbnails are lazy `<img>` tags through the existing per-project thumbnail route.
- **Memory:** the jobs table keeps only loaded pages (each 50). The datasets and runs lists keep
  loaded pages (each 100). The catalogue is app-level and small: hundreds of types, capped at 50
  pages × 500.

**Internal DAG.** A task starts when every task it depends on is committed on `task/f-s2`.

| Task | Depends on | Batch | Shares files with |
|---|---|---|---|
| 1 Catalogue API, `normaliseName`, fixtures, `catalogueRevision` | (S2 start) | B1 | none |
| 2 Catalogue model + `useCatalogue` | 1 | B2 | none |
| 6 Jobs section | 1 | B2 | `routes/appRoutes.tsx` (3, 8, 9, 11) |
| 7 Models API + hooks | 1 | B2 | `api/library.ts` (11) |
| 14 Settings appearance | none beyond S2 start | B2 | none |
| 16 Label next + leftovers | none beyond S2 start | B2 | none |
| 3 Catalogue screen, types, editor | 2 | B3 | `routes/appRoutes.tsx` |
| 8 Models layout + Library host | 7 | B3 | `routes/appRoutes.tsx` |
| 13 Class map editor | 2, 7 | B3 | none |
| 15 Project type list | 2, 6 (the e2e helper) | B3 | none |
| 4 Classification banner + backfill | 3 | B4 | `catalogue/TypesPane.tsx` |
| 9 Datasets screen | 8 | B4 | `routes/appRoutes.tsx` |
| 5 Severity editor, sync, catalogue e2e | 3, 4, 6 (the e2e helper) | B5 | `catalogue/CatalogueScreen.tsx`, `routes/appRoutes.tsx` |
| 10 Dataset builder | 9, 2, 6 (`useRecentProjects`) | B5 | `models/DatasetsScreen.tsx`, `e2e/fixtures/appSections.ts` |
| 11 Training screen | 8, 7 | B5 | `routes/appRoutes.tsx`, `api/library.ts`, `e2e/fixtures/appSections.ts` |
| 12 Compare | 11 | B6 | `models/TrainingScreen.tsx` |
| 17 Final gate, walkthrough, merge | all | B7 | none |

- **Parallel batches:** B2 has five independent tasks. B3 has four, and B4 and B5 three each.
- **Serialization:** tasks in one batch that share `routes/appRoutes.tsx` (3 and 8; 5 and 11) or
  `e2e/fixtures/appSections.ts` (10 and 11) each add their own lines. The second task in a batch
  rebases its few-line insert.
- **Critical path:** 1 → 7 → 8 → 9 → 10 → 17, and 1 → 7 → 8 → 11 → 12 → 17 (six tasks each).
  1 → 2 → 3 → 4 → 5 → 17 is as long, but lighter.

---

### Task 1: Preflight, catalogue API wrappers, `normaliseName`, fixtures, `catalogueRevision`

**Files:**
- Create: `.superpowers/sdd/f-s2/ledger.md`
- Create: `frontend/src/api/catalogue.ts`, `frontend/src/api/catalogue.test.ts`
- Create: `frontend/src/catalogue/normaliseName.ts`, `frontend/src/catalogue/normaliseName.test.ts`
- Create: `frontend/src/test/appSectionFixtures.ts`
- Modify: `frontend/src/store/changes.ts`
- Test: `frontend/src/store/changes.catalogue.test.ts`

**Interfaces:**
- Consumes: C0's catalogue operations and schemas (Assumed names). `unwrap`, `ApiFailure`, `codeOf`
  from `@/api/errors`.
- Produces:
  - `api/catalogue.ts`:
    - types `CatalogueType`, `CatalogueTypeCreate`, `CatalogueTypePatch`, `CatalogueTypeUpdated`,
      `SeverityLevel`, `TypeKind`, `CatalogueList {types; needsClassification}`, `SeverityInUse {level; projects}`
    - `fetchCatalogue(api): Promise<CatalogueList>`
    - `createCatalogueType(api, body): Promise<CatalogueType>`
    - `patchCatalogueType(api, typeId, patch): Promise<CatalogueTypeUpdated>`
    - `startBackfill(api, typeId): Promise<Job>`
    - `fetchSeverityScale(api): Promise<SeverityLevel[]>`
    - `saveSeverityScale(api, levels): Promise<SeverityLevel[]>`
    - `finishClassification(api): Promise<void>`
    - `isCatalogueUnavailable(err): boolean`, `unavailableFolder(err): string | null`
    - `existingTypeId(err): string | null`, `isHotkeyConflict(err): boolean`
    - `severityInUse(err): SeverityInUse | null`
  - `catalogue/normaliseName.ts`: `normaliseName(name: string): string`
  - `test/appSectionFixtures.ts`:
    - `TYPE_ID(n)`, `exampleTypes` (Excavator and Dump truck are migrated objects; Crack is a defect
      with default severity 2, hotkey `c`, group "Concrete defects"; Spalling is an archived defect)
    - `exampleSeverity` (the four default levels), `exampleCataloguePage`
    - `LIB_DATASET_ID`, `exampleLibraryDataset`, `exampleDatasetItems`, `examplePreview`
    - `TRAINING_RUN_ID`, `TRAINING_RUN_2_ID`, `exampleTrainingRun`, `exampleTrainingRun2`
    - `LIB_JOB_ID`, `exampleAppJobs`
  - `store/changes.ts`: `catalogueRevision: number`, bumped on `catalogue.changed`

- [ ] **Step 1: Preflight — check every assumed name against the merged code**

Run from `E:\Dev\Yolo\app\.claude\worktrees\f-s2` (PowerShell):

```powershell
git log --oneline -5
Select-String -Path frontend\src\ui\index.ts -Pattern 'GlassPanel','DataTable','InspectorLayout','InspectorPane','InspectorSection','Tabs','TypeChip','SeverityPill','SeverityPicker','useSeverityScale','SeverityScaleContext','StatusDot' | Select-Object -ExpandProperty Line
Select-String -Path frontend\src\ui\motion.ts -Pattern 'useReducedMotion','readMotionChoice','setMotionChoice' | Select-Object -ExpandProperty Line
Select-String -Path frontend\src\app\effects.ts -Pattern 'EffectsChoice','readEffectsChoice','setEffectsChoice' | Select-Object -ExpandProperty Line
Select-String -Path frontend\src\app\routeActions.ts -Pattern 'export function useProvideRouteActions','export interface RouteAction' | Select-Object -ExpandProperty Line
Select-String -Path frontend\src\ui\severityScale.ts,frontend\src\ui\index.ts -Pattern 'SeverityScale' | Select-Object Path,Line
Test-Path frontend\src\routes\appRoutes.tsx
Select-String -Path contract\client\schema.d.ts -SimpleMatch -Pattern '"/api/v1/catalogue/types"','"/api/v1/catalogue/types/{typeId}"','"/api/v1/catalogue/types/{typeId}/backfill"','"/api/v1/catalogue/severity"','"/api/v1/catalogue/classification/done"','"/api/v1/jobs"','"/api/v1/library/datasets"','"/api/v1/library/datasets/preview"','"/api/v1/library/datasets/{datasetId}/export"','"/api/v1/library/datasets/{datasetId}/items"','"/api/v1/library/training-runs"','"/api/v1/library/training-runs/{runId}"','"/api/v1/library/models/{modelId}/class-map"','"/api/v1/projects/{projectId}/types"' | Select-Object -ExpandProperty Line
Select-String -Path contract\client\schema.d.ts -Pattern '^\s{8}(CatalogueType|CatalogueTypePage|CatalogueTypeCreate|CatalogueTypePatch|CatalogueTypeUpdated|SeverityLevel|SeverityScale|AppJob|AppJobPage|LibraryDataset|LibraryDatasetPage|LibraryDatasetWithJob|LibraryDatasetCreate|LibraryDatasetItem|DatasetSource|DatasetFilter|DatasetPreview|TrainingRun|TrainingRunWithJob|ProjectTypesUpdate):' | Select-Object -ExpandProperty Line
Get-ChildItem frontend\src\screens\DatasetsScreen.tsx,frontend\src\screens\TrainScreen.tsx,frontend\src\screens\LabelResolverScreen.tsx,frontend\src\screens\PastDetectionsScreen.tsx,frontend\src\datasets\*.tsx,frontend\src\api\datasets.ts,frontend\src\train\useDatasets.ts,frontend\src\settings\ClassesSection.tsx,frontend\e2e\train.spec.ts,frontend\e2e\past-detections.spec.ts -ErrorAction SilentlyContinue | Select-Object -ExpandProperty FullName
```

Expected:
- SH, BC and BM appear in the log (merge commits).
- Every `Select-String` line prints a match (`"/api/v1/catalogue/classification/done"` included:
  C0 declares it and BC Task 4 routes it).
- `Test-Path` prints `True`.
- The last command lists the legacy files that still exist.

For every name that is missing or differs:
- If it is renamed, record the real name and rename it at the call sites this plan gives.
- If it is absent (for example `/catalogue/classification/done`), stop and raise it with the
  coordinator as a C0 change before Task 4. Tasks 1–3 do not depend on it.

- [ ] **Step 2: Write the ledger**

Create `.superpowers/sdd/f-s2/ledger.md`:

```markdown
---
type: ledger
plan: docs/superpowers/plans/2026-09-26-foundation-s2-app-screens.md
branch: task/f-s2
---

# F-S2 ledger

## Preflight (Task 1)

| Assumed name | Real name on main | Action |
|---|---|---|
| (one row per name that differed; "none" if all matched) | | |

Legacy files present at start: (paste the last command's output)

## Tasks

| Task | Commit | Notes |
|---|---|---|
```

- [ ] **Step 3: Write the failing tests for `normaliseName`**

Create `frontend/src/catalogue/normaliseName.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { normaliseName } from "./normaliseName";

describe("normaliseName (F §7.1)", () => {
  it.each([
    ["dump_truck", "dump truck"],
    ["Dump truck", "dump truck"],
    ["  Dump   truck ", "dump truck"],
    ["Dump-Truck", "dump truck"],
    ["dump__-truck", "dump truck"],
    ["Crack", "crack"],
    ["", ""],
  ])("%j becomes %j", (input, expected) => {
    expect(normaliseName(input)).toBe(expected);
  });
});
```

- [ ] **Step 4: Run it to see it fail**

Run: `pnpm -C frontend exec vitest run src/catalogue/normaliseName.test.ts`
Expected: FAIL with `Failed to resolve import "./normaliseName"`.

- [ ] **Step 5: Implement `normaliseName`**

Create `frontend/src/catalogue/normaliseName.ts`:

```ts
/**
 * The client mirror of the backend's `normalise_name` (F §7.1): casefold, trim, `_` and `-` become
 * spaces, runs of spaces collapse to one, so "dump_truck" and "Dump truck" are the same type. The
 * server stays the authority (409 `type_exists`); this only lets the UI say so before sending.
 */
export function normaliseName(name: string): string {
  return name.toLowerCase().replace(/[_-]/g, " ").replace(/\s+/g, " ").trim();
}
```

- [ ] **Step 6: Run it to see it pass**

Run: `pnpm -C frontend exec vitest run src/catalogue/normaliseName.test.ts`
Expected: PASS (7 tests).

- [ ] **Step 7: Write the fixtures**

Create `frontend/src/test/appSectionFixtures.ts`:

```ts
import type { components } from "@contract/client";
import { IMAGE_ID, JOB_ID, MODEL_ID, PROJECT_ID, TRAINED_MODEL_ID, runningJob } from "./fixtures";

type S = components["schemas"];

export const TYPE_ID = (n: number): string => `70000000-9999-4000-8000-00000000000${n}`;

/** Two migrated objects, one defect in a group, one archived defect. */
export const exampleTypes: S["CatalogueType"][] = [
  {
    id: TYPE_ID(1),
    name: "Excavator",
    colour: "#f97316",
    kind: "object",
    default_severity: null,
    hotkey: "1",
    group: null,
    archived: false,
    origin: "migrated",
  },
  {
    id: TYPE_ID(2),
    name: "Dump truck",
    colour: "#06b6d4",
    kind: "object",
    default_severity: null,
    hotkey: "2",
    group: null,
    archived: false,
    origin: "migrated",
  },
  {
    id: TYPE_ID(3),
    name: "Crack",
    colour: "#ef4444",
    kind: "defect",
    default_severity: 2,
    hotkey: "c",
    group: "Concrete defects",
    archived: false,
    origin: "user",
  },
  {
    id: TYPE_ID(4),
    name: "Spalling",
    colour: "#a855f7",
    kind: "defect",
    default_severity: 3,
    hotkey: null,
    group: "Concrete defects",
    archived: true,
    origin: "user",
  },
];

/** D4's default scale (F §4.1 severity defaults). */
export const exampleSeverity: S["SeverityLevel"][] = [
  { level: 1, name: "Minor", colour: "#3fb68e" },
  { level: 2, name: "Moderate", colour: "#e2bf2e" },
  { level: 3, name: "Major", colour: "#ff9c3a" },
  { level: 4, name: "Critical", colour: "#ff5a4f" },
];

export const exampleCataloguePage = { items: exampleTypes, next_cursor: null, needs_classification: true };

export const LIB_DATASET_ID = "d1000000-7777-4000-8000-000000000001";
export const LIB_JOB_ID = "j1000000-4444-4000-8000-000000000001";

export const exampleLibraryDataset: S["LibraryDataset"] = {
  id: LIB_DATASET_ID,
  name: "machines-v1",
  task: "detect",
  origin: "built",
  filter: {
    project_ids: [PROJECT_ID],
    type_ids: [TYPE_ID(1), TYPE_ID(2)],
    captured_from: null,
    captured_to: null,
    reviewed_only: true,
  },
  classes: [
    { type_id: TYPE_ID(1), name: "Excavator" },
    { type_id: TYPE_ID(2), name: "Dump truck" },
  ],
  split_method: "by_group",
  split_params: { val_fraction: 0.2, seed: 42 },
  state: "ready",
  counts: { images: 30, train: 24, val: 6, per_class: { [TYPE_ID(1)]: 40, [TYPE_ID(2)]: 72 } },
  export_path: null,
  export_state: "none",
  legacy_path: null,
  job_id: LIB_JOB_ID,
  created_at: "2026-09-26T09:00:00Z",
  sources: [
    { project_id: PROJECT_ID, project_name: "Ahmadia", project_folder: "E:\\Projects\\Ahmadia", image_count: 30 },
  ],
};

export const exampleDatasetItems = {
  items: [{ project_id: PROJECT_ID, image_id: IMAGE_ID, split: "train", label_count: 3 }],
  next_cursor: null,
};

export const examplePreview: S["DatasetPreview"] = {
  images: 30,
  boxes_per_type: { [TYPE_ID(1)]: 40, [TYPE_ID(2)]: 72 },
  projects: [{ project_id: PROJECT_ID, project_name: "Ahmadia", images: 30, boxes: 112, state: "ok" }],
};

export const TRAINING_RUN_ID = "t0000000-8888-4000-8000-000000000001";
export const TRAINING_RUN_2_ID = "t0000000-8888-4000-8000-000000000002";

const TRAIN_PARAMS = {
  name: "machines-v1-yolo11m-coco",
  dataset_id: LIB_DATASET_ID,
  base_model_id: MODEL_ID,
  epochs: 50,
  imgsz: 1280,
  batch: null,
  patience: 50,
  augmentation: "default" as const,
  device: "0",
};

export const exampleTrainingRun: S["TrainingRun"] = {
  id: TRAINING_RUN_ID,
  name: "machines-v1-yolo11m-coco",
  dataset_id: LIB_DATASET_ID,
  base_model_id: MODEL_ID,
  params: TRAIN_PARAMS,
  job_id: JOB_ID,
  state: "succeeded",
  model_id: TRAINED_MODEL_ID,
  metrics: { map50: 0.71, map50_95: 0.44 },
  created_at: "2026-09-26T10:00:00Z",
  finished_at: "2026-09-26T10:42:00Z",
};

export const exampleTrainingRun2: S["TrainingRun"] = {
  ...exampleTrainingRun,
  id: TRAINING_RUN_2_ID,
  name: "machines-v1-e100",
  job_id: "j0000000-4444-4000-8000-000000000009",
  model_id: "m0000000-2222-4000-8000-000000000009",
  metrics: { map50: 0.74, map50_95: 0.47 },
  created_at: "2026-09-26T11:00:00Z",
  finished_at: "2026-09-26T12:20:00Z",
};

/** A running project import, a finished library dataset build, a failed library training. */
export const exampleAppJobs: S["AppJob"][] = [
  { ...runningJob, project_name: "Ahmadia" },
  {
    ...runningJob,
    id: LIB_JOB_ID,
    project_id: "library",
    project_name: null,
    type: "dataset_build",
    state: "succeeded",
    progress: 1,
    message: "30 images",
    params: { name: "machines-v1", dataset_id: LIB_DATASET_ID },
    result: { dataset_id: LIB_DATASET_ID },
    created_at: "2026-09-26T09:00:00Z",
    started_at: "2026-09-26T09:00:01Z",
    finished_at: "2026-09-26T09:00:09Z",
  },
  {
    ...runningJob,
    id: "j1000000-4444-4000-8000-000000000002",
    project_id: "library",
    project_name: null,
    type: "train",
    state: "failed",
    progress: 0.3,
    message: "epoch 15/50 mAP50 0.410",
    params: { name: "ahmadia-v1-n" },
    error: "CUDA out of memory",
    created_at: "2026-09-26T08:05:00Z",
    started_at: "2026-09-26T08:05:01Z",
    finished_at: "2026-09-26T08:35:01Z",
  },
];
```

- [ ] **Step 8: Write the failing tests for the catalogue API**

Create `frontend/src/api/catalogue.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { errorBody, fakeClient, runningJob } from "@/test/fixtures";
import { exampleSeverity, exampleTypes, TYPE_ID } from "@/test/appSectionFixtures";
import {
  createCatalogueType,
  existingTypeId,
  fetchCatalogue,
  fetchSeverityScale,
  finishClassification,
  isCatalogueUnavailable,
  isHotkeyConflict,
  patchCatalogueType,
  saveSeverityScale,
  severityInUse,
  startBackfill,
  unavailableFolder,
} from "./catalogue";

const NEW_TYPE = {
  name: "dump-truck",
  colour: "#06b6d4",
  kind: "object" as const,
  default_severity: null,
  hotkey: null,
  group: null,
};

describe("fetchCatalogue", () => {
  it("follows the cursor, keeps archived types and reads the flag from the first page", async () => {
    const { api, requests } = fakeClient([
      {
        method: "GET",
        path: /\/api\/v1\/catalogue\/types$/,
        body: (req) =>
          req.url.includes("cursor=p2")
            ? { items: exampleTypes.slice(2), next_cursor: null, needs_classification: false }
            : { items: exampleTypes.slice(0, 2), next_cursor: "p2", needs_classification: true },
      },
    ]);
    const list = await fetchCatalogue(api);
    expect(list.types.map((t) => t.name)).toEqual(["Excavator", "Dump truck", "Crack", "Spalling"]);
    expect(list.needsClassification).toBe(true);
    expect(requests[0].url).toContain("include_archived=true");
    expect(requests[0].url).toContain("limit=500");
  });

  it("stops when a cursor repeats (the Prism mock answers the same cursor forever)", async () => {
    const { api, requests } = fakeClient([
      {
        method: "GET",
        path: /\/catalogue\/types$/,
        body: { items: exampleTypes, next_cursor: "string", needs_classification: false },
      },
    ]);
    const list = await fetchCatalogue(api);
    expect(list.types).toHaveLength(4);
    expect(requests).toHaveLength(2);
  });
});

describe("catalogue writes", () => {
  it("patches one type and returns the backfill flag", async () => {
    const { api, requests } = fakeClient([
      {
        method: "PATCH",
        path: /\/catalogue\/types\/[^/]+$/,
        body: { ...exampleTypes[0], kind: "defect", backfill_candidates: true },
      },
    ]);
    const saved = await patchCatalogueType(api, TYPE_ID(1), { kind: "defect" });
    expect(saved.backfill_candidates).toBe(true);
    expect(requests[0].url).toBe(`/api/v1/catalogue/types/${TYPE_ID(1)}`);
    expect(requests[0].body).toEqual({ kind: "defect" });
  });

  it("starts the backfill and returns its job", async () => {
    const { api } = fakeClient([
      { method: "POST", path: /\/backfill$/, status: 202, body: { job: { ...runningJob, type: "findings_backfill" } } },
    ]);
    expect((await startBackfill(api, TYPE_ID(1))).type).toBe("findings_backfill");
  });

  it("reads and saves the whole severity scale", async () => {
    const { api, requests } = fakeClient([
      { method: "GET", path: /\/catalogue\/severity$/, body: { levels: exampleSeverity } },
      { method: "PUT", path: /\/catalogue\/severity$/, body: { levels: exampleSeverity } },
    ]);
    expect(await fetchSeverityScale(api)).toEqual(exampleSeverity);
    await saveSeverityScale(api, exampleSeverity);
    expect(requests[1].body).toEqual({ levels: exampleSeverity });
  });

  it("marks the classification as done", async () => {
    const { api, requests } = fakeClient([
      { method: "POST", path: /\/catalogue\/classification\/done$/, status: 204 },
    ]);
    await finishClassification(api);
    expect(requests[0].method).toBe("POST");
  });
});

describe("catalogue error helpers", () => {
  it("reads the existing id from type_exists", async () => {
    const { api } = fakeClient([
      {
        method: "POST",
        path: /\/catalogue\/types$/,
        status: 409,
        body: errorBody("type_exists", "Dump truck already exists", { type_id: TYPE_ID(2) }),
      },
    ]);
    const err = await createCatalogueType(api, NEW_TYPE).catch((e: unknown) => e);
    expect(existingTypeId(err)).toBe(TYPE_ID(2));
    expect(isHotkeyConflict(err)).toBe(false);
  });

  it("reads the level and the project names from severity_in_use", async () => {
    const { api } = fakeClient([
      {
        method: "PUT",
        path: /\/catalogue\/severity$/,
        status: 409,
        body: errorBody("severity_in_use", "level 4 is in use", { level: 4, projects: ["Ahmadia", "Bridge A"] }),
      },
    ]);
    const err = await saveSeverityScale(api, exampleSeverity.slice(0, 3)).catch((e: unknown) => e);
    expect(severityInUse(err)).toEqual({ level: 4, projects: ["Ahmadia", "Bridge A"] });
  });

  it("recognises the 503 and its folder", async () => {
    const { api } = fakeClient([
      {
        method: "GET",
        path: /\/catalogue\/types$/,
        status: 503,
        body: errorBody("catalogue_unavailable", "catalogue.db is locked", {
          folder: "C:\\Users\\D\\AppData\\Roaming\\kestrel-ai\\library",
        }),
      },
    ]);
    const err = await fetchCatalogue(api).catch((e: unknown) => e);
    expect(isCatalogueUnavailable(err)).toBe(true);
    expect(unavailableFolder(err)).toBe("C:\\Users\\D\\AppData\\Roaming\\kestrel-ai\\library");
  });
});
```

- [ ] **Step 9: Run them to see them fail**

Run: `pnpm -C frontend exec vitest run src/api/catalogue.test.ts`
Expected: FAIL with `Failed to resolve import "./catalogue"`.

- [ ] **Step 10: Implement the catalogue API**

Create `frontend/src/api/catalogue.ts`:

```ts
import type { ApiClient, Job, components } from "@contract/client";
import { ApiFailure, codeOf, unwrap } from "./errors";

type S = components["schemas"];
export type CatalogueType = S["CatalogueType"];
export type CatalogueTypeCreate = S["CatalogueTypeCreate"];
export type CatalogueTypePatch = S["CatalogueTypePatch"];
export type CatalogueTypeUpdated = S["CatalogueTypeUpdated"];
export type SeverityLevel = S["SeverityLevel"];
export type TypeKind = CatalogueType["kind"];

export const CATALOGUE_PAGE = 500;
const MAX_PAGES = 50;

export interface CatalogueList {
  types: CatalogueType[];
  /** `catalogue_meta.needs_classification`: set by migration until the operator says Done (§7.5). */
  needsClassification: boolean;
}

/**
 * Every type, archived ones included (they still render everywhere, §7.2). Follows `next_cursor`,
 * stopping on a repeated cursor (the Prism mock repeats one forever) or after 50 pages.
 */
export async function fetchCatalogue(api: ApiClient): Promise<CatalogueList> {
  const byId = new Map<string, CatalogueType>();
  const seen = new Set<string>();
  let cursor: string | undefined;
  let needsClassification = false;
  for (let page = 0; page < MAX_PAGES; page += 1) {
    const r = await unwrap(
      api.GET("/api/v1/catalogue/types", {
        params: {
          query: { include_archived: true, limit: CATALOGUE_PAGE, ...(cursor ? { cursor } : {}) },
        },
      }),
    );
    // C0's optional `CatalogueTypePage.needs_classification` (absent means false; plan decision 1).
    if (page === 0) needsClassification = r.needs_classification ?? false;
    for (const t of r.items) if (!byId.has(t.id)) byId.set(t.id, t);
    const next = r.next_cursor;
    if (!next || seen.has(next)) break;
    seen.add(next);
    cursor = next;
  }
  return { types: [...byId.values()], needsClassification };
}

export function createCatalogueType(api: ApiClient, body: CatalogueTypeCreate): Promise<CatalogueType> {
  return unwrap(api.POST("/api/v1/catalogue/types", { body }));
}

/** An object → defect change answers `backfill_candidates: true` (§7.2). */
export function patchCatalogueType(
  api: ApiClient,
  typeId: string,
  body: CatalogueTypePatch,
): Promise<CatalogueTypeUpdated> {
  return unwrap(api.PATCH("/api/v1/catalogue/types/{typeId}", { params: { path: { typeId } }, body }));
}

/** 202: a `findings_backfill` library job over the recent projects (§7.2). */
export async function startBackfill(api: ApiClient, typeId: string): Promise<Job> {
  const r = await unwrap(
    api.POST("/api/v1/catalogue/types/{typeId}/backfill", { params: { path: { typeId } } }),
  );
  return r.job;
}

export async function fetchSeverityScale(api: ApiClient): Promise<SeverityLevel[]> {
  const r = await unwrap(api.GET("/api/v1/catalogue/severity"));
  return r.levels;
}

/** Replaces the whole scale; removing a level still in use answers 409 `severity_in_use`. */
export async function saveSeverityScale(api: ApiClient, levels: SeverityLevel[]): Promise<SeverityLevel[]> {
  const r = await unwrap(api.PUT("/api/v1/catalogue/severity", { body: { levels } }));
  return r.levels;
}

/** Clears the migrated-types banner (plan decision 1). */
export async function finishClassification(api: ApiClient): Promise<void> {
  await unwrap<unknown>(api.POST("/api/v1/catalogue/classification/done"));
}

/** 503 `catalogue_unavailable`: the app started without `catalogue.db` (F §15). */
export function isCatalogueUnavailable(err: unknown): boolean {
  return codeOf(err) === "catalogue_unavailable";
}

export function unavailableFolder(err: unknown): string | null {
  return err instanceof ApiFailure && typeof err.details.folder === "string" ? err.details.folder : null;
}

/** 409 `type_exists` carries the id of the type that already has this name (BC: `details.type_id`). */
export function existingTypeId(err: unknown): string | null {
  if (!(err instanceof ApiFailure) || err.code !== "type_exists") return null;
  const id = err.details.type_id;
  return typeof id === "string" ? id : null;
}

export function isHotkeyConflict(err: unknown): boolean {
  return codeOf(err) === "hotkey_conflict";
}

export interface SeverityInUse {
  level: number;
  projects: string[];
}

export function severityInUse(err: unknown): SeverityInUse | null {
  if (!(err instanceof ApiFailure) || err.code !== "severity_in_use") return null;
  const { level, projects } = err.details;
  if (typeof level !== "number") return null;
  const names = Array.isArray(projects) ? projects.filter((p): p is string => typeof p === "string") : [];
  return { level, projects: names };
}
```

- [ ] **Step 11: Run them to see them pass**

Run: `pnpm -C frontend exec vitest run src/api/catalogue.test.ts`
Expected: PASS (9 tests). If a path or a field name differs from the generated client, `tsc` in
the editor flags it here. Fix it in this file only, using the Step 1 ledger.

- [ ] **Step 12: Write the failing test for `catalogueRevision`**

Create `frontend/src/store/changes.catalogue.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import type { AppEvent } from "@contract/client";
import { useChangesStore } from "./changes";

describe("catalogue.changed", () => {
  it("bumps catalogueRevision and leaves the image revision alone", () => {
    const before = useChangesStore.getState();
    useChangesStore.getState().applyEvent({ type: "catalogue.changed", payload: {} } as unknown as AppEvent);
    const after = useChangesStore.getState();
    expect(after.catalogueRevision).toBe(before.catalogueRevision + 1);
    expect(after.imagesRevision).toBe(before.imagesRevision);
  });
});
```

Run: `pnpm -C frontend exec vitest run src/store/changes.catalogue.test.ts`
Expected: FAIL. TypeScript reports that `catalogueRevision` does not exist, and at run time the
assertion gets `NaN`.

- [ ] **Step 13: Add `catalogueRevision` to the changes store**

In `frontend/src/store/changes.ts`:

1. Add the field to `ChangesState`, below `volumesRevision`:

   ```ts
     /** Bumped on `catalogue.changed` (F §13): a type or the severity scale changed. */
     catalogueRevision: number;
   ```

2. Add the initial value, below `volumesRevision: 0,`:

   ```ts
     catalogueRevision: 0,
   ```

3. In `applyEvent`, add this line before `return s;`:

   ```ts
         if (ev.type === "catalogue.changed") return { catalogueRevision: s.catalogueRevision + 1 };
   ```

Run: `pnpm -C frontend exec vitest run src/store/changes.catalogue.test.ts src/store/changes.test.ts`
Expected: PASS.

- [ ] **Step 14: Lint and commit**

Run: `pnpm -C frontend lint`
Expected: exit 0, and the last line is `tokens ok`.

```powershell
git add frontend/src/api/catalogue.ts frontend/src/api/catalogue.test.ts frontend/src/catalogue/normaliseName.ts frontend/src/catalogue/normaliseName.test.ts frontend/src/test/appSectionFixtures.ts frontend/src/store/changes.ts frontend/src/store/changes.catalogue.test.ts
git add -f .superpowers/sdd/f-s2/ledger.md
git commit -m "feat(catalogue): API wrappers, normaliseName and the catalogue revision

S2 of the foundation starts from typed wrappers so every contract name lives in one file.

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: Catalogue model and `useCatalogue`

**Files:**
- Create: `frontend/src/catalogue/catalogueModel.ts`, `frontend/src/catalogue/catalogueModel.test.ts`
- Create: `frontend/src/catalogue/useCatalogue.ts`, `frontend/src/catalogue/useCatalogue.test.tsx`

**Interfaces:**
- Consumes: `fetchCatalogue`, `isCatalogueUnavailable`, `unavailableFolder` and the types from
  Task 1; `normaliseName`; `useChangesStore().catalogueRevision`.
- Produces:
  - `catalogueModel.ts`:
    - `KindFilter = "all" | TypeKind`
    - `TypeFilters {q: string; kind: KindFilter; showArchived: boolean; migratedOnly: boolean}`,
      `DEFAULT_FILTERS`
    - `filterTypes(types, f): CatalogueType[]`, `migratedCount(types): number`
    - `TypeDraft {name; colour; kind; group; defaultSeverity: number | null; hotkey: string}`
    - `TYPE_HOTKEYS: string[]`, `TYPE_PALETTE: string[]`
    - `draftOf(type | null, types): TypeDraft`
    - `findClash(draft, types, selfId?): CatalogueType | null`
    - `validateTypeDraft(draft, types, selfId?): string | null`
    - `toCreate(draft): CatalogueTypeCreate`, `toPatch(draft, type): CatalogueTypePatch`
    - `nextTypeColour(types): string`
  - `useCatalogue(): Catalogue`, where `Catalogue = {types; needsClassification; loading; unavailable;
    folder: string | null; error: string | null; reload(); put(type)}`

- [ ] **Step 1: Write the failing model tests**

Create `frontend/src/catalogue/catalogueModel.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { exampleTypes, TYPE_ID } from "@/test/appSectionFixtures";
import {
  DEFAULT_FILTERS,
  draftOf,
  filterTypes,
  findClash,
  migratedCount,
  nextTypeColour,
  toCreate,
  toPatch,
  validateTypeDraft,
} from "./catalogueModel";

const names = (f: Partial<typeof DEFAULT_FILTERS>) =>
  filterTypes(exampleTypes, { ...DEFAULT_FILTERS, ...f }).map((t) => t.name);
const crack = exampleTypes[2];

describe("filterTypes", () => {
  it("hides archived types unless asked, sorted by group then name", () => {
    expect(names({})).toEqual(["Dump truck", "Excavator", "Crack"]);
    expect(names({ showArchived: true })).toEqual(["Dump truck", "Excavator", "Crack", "Spalling"]);
  });

  it("filters by kind, by migrated origin, and searches names and groups by normalised text", () => {
    expect(names({ kind: "defect" })).toEqual(["Crack"]);
    expect(names({ migratedOnly: true })).toEqual(["Dump truck", "Excavator"]);
    expect(names({ q: "dump_truck" })).toEqual(["Dump truck"]);
    expect(names({ q: "concrete" })).toEqual(["Crack"]);
  });
});

describe("migratedCount", () => {
  it("counts non-archived migrated types", () => {
    expect(migratedCount(exampleTypes)).toBe(2);
    expect(migratedCount([{ ...exampleTypes[0], archived: true }])).toBe(0);
  });
});

describe("drafts", () => {
  it("starts a new type as a defect with the first unused palette colour", () => {
    expect(draftOf(null, exampleTypes)).toEqual({
      name: "",
      colour: "#eab308",
      kind: "defect",
      group: "",
      defaultSeverity: null,
      hotkey: "",
    });
  });

  it("finds a clash by normalised name among live types only", () => {
    expect(findClash({ ...draftOf(null, exampleTypes), name: "dump-truck" }, exampleTypes)?.id).toBe(TYPE_ID(2));
    expect(findClash({ ...draftOf(null, exampleTypes), name: "dump-truck" }, exampleTypes, TYPE_ID(2))).toBeNull();
    expect(findClash({ ...draftOf(null, exampleTypes), name: "spalling" }, exampleTypes)).toBeNull();
  });

  it("validates name, clash and hotkey", () => {
    const blank = draftOf(null, exampleTypes);
    expect(validateTypeDraft(blank, exampleTypes)).toBe("Give the type a name.");
    expect(validateTypeDraft({ ...blank, name: "Dump_truck" }, exampleTypes)).toBe(
      '"Dump truck" already exists. Open it instead of creating a second one.',
    );
    expect(validateTypeDraft({ ...blank, name: "Rust", hotkey: "c" }, exampleTypes)).toBe(
      'Hotkey C is already used by "Crack".',
    );
    expect(validateTypeDraft({ ...blank, name: "Rust", hotkey: "%" }, exampleTypes)).toBe(
      "A hotkey is one digit from 1 to 9 or one letter.",
    );
    expect(validateTypeDraft({ ...blank, name: "Rust", hotkey: "r" }, exampleTypes)).toBeNull();
    expect(validateTypeDraft(draftOf(crack, exampleTypes), exampleTypes, crack.id)).toBeNull();
  });

  it("sends only what changed in a patch, and nulls for cleared optional fields", () => {
    const d = draftOf(crack, exampleTypes);
    expect(toPatch(d, crack)).toEqual({});
    expect(toPatch({ ...d, name: " Hairline crack " }, crack)).toEqual({ name: "Hairline crack" });
    expect(toPatch({ ...d, group: "", defaultSeverity: null, hotkey: "" }, crack)).toEqual({
      group: null,
      default_severity: null,
      hotkey: null,
    });
    expect(toPatch({ ...d, kind: "object" }, crack)).toEqual({ kind: "object" });
  });

  it("builds a create body with trimmed text and nulls for empty fields", () => {
    expect(toCreate({ ...draftOf(null, exampleTypes), name: " Rust ", group: " " })).toEqual({
      name: "Rust",
      colour: "#eab308",
      kind: "defect",
      group: null,
      default_severity: null,
      hotkey: null,
    });
  });

  it("picks the next colour among live types only", () => {
    expect(nextTypeColour(exampleTypes)).toBe("#eab308");
    expect(nextTypeColour([])).toBe("#f97316");
  });
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `pnpm -C frontend exec vitest run src/catalogue/catalogueModel.test.ts`
Expected: FAIL with `Failed to resolve import "./catalogueModel"`.

- [ ] **Step 3: Implement the model**

Create `frontend/src/catalogue/catalogueModel.ts`:

```ts
import type { CatalogueType, CatalogueTypeCreate, CatalogueTypePatch, TypeKind } from "@/api/catalogue";
import { normaliseName } from "./normaliseName";

export type KindFilter = "all" | TypeKind;

export interface TypeFilters {
  q: string;
  kind: KindFilter;
  showArchived: boolean;
  /** Only `origin = migrated` (the classification banner's view, §7.5). */
  migratedOnly: boolean;
}

export const DEFAULT_FILTERS: TypeFilters = { q: "", kind: "all", showArchived: false, migratedOnly: false };

/** Digits 1–9 and letters, as §7.2 allows; live only inside a type picker, never at workspace level. */
export const TYPE_HOTKEYS = [..."123456789abcdefghijklmnopqrstuvwxyz"];

export const TYPE_PALETTE = ["#f97316", "#eab308", "#22c55e", "#06b6d4", "#3b82f6", "#a855f7", "#ec4899", "#ef4444"];

export function filterTypes(types: CatalogueType[], f: TypeFilters): CatalogueType[] {
  const q = normaliseName(f.q);
  return types
    .filter((t) => f.showArchived || !t.archived)
    .filter((t) => f.kind === "all" || t.kind === f.kind)
    .filter((t) => !f.migratedOnly || t.origin === "migrated")
    .filter((t) => !q || normaliseName(t.name).includes(q) || normaliseName(t.group ?? "").includes(q))
    .sort((a, b) => (a.group ?? "").localeCompare(b.group ?? "") || a.name.localeCompare(b.name));
}

/** The banner's count (plan decision 2): types that came from existing projects and are still live. */
export function migratedCount(types: CatalogueType[]): number {
  return types.filter((t) => t.origin === "migrated" && !t.archived).length;
}

export interface TypeDraft {
  name: string;
  colour: string;
  kind: TypeKind;
  group: string;
  defaultSeverity: number | null;
  hotkey: string;
}

export function nextTypeColour(types: CatalogueType[]): string {
  const used = new Set(types.filter((t) => !t.archived).map((t) => t.colour.toLowerCase()));
  return TYPE_PALETTE.find((c) => !used.has(c)) ?? TYPE_PALETTE[types.length % TYPE_PALETTE.length];
}

/** A new type starts as a defect (plan decision 17); an existing one copies its fields. */
export function draftOf(type: CatalogueType | null, types: CatalogueType[]): TypeDraft {
  if (!type) {
    return { name: "", colour: nextTypeColour(types), kind: "defect", group: "", defaultSeverity: null, hotkey: "" };
  }
  return {
    name: type.name,
    colour: type.colour,
    kind: type.kind,
    group: type.group ?? "",
    defaultSeverity: type.default_severity ?? null,
    hotkey: type.hotkey ?? "",
  };
}

/** A live type other than `selfId` whose name normalises to the draft's. */
export function findClash(d: TypeDraft, types: CatalogueType[], selfId?: string): CatalogueType | null {
  const key = normaliseName(d.name);
  if (!key) return null;
  return types.find((t) => t.id !== selfId && !t.archived && normaliseName(t.name) === key) ?? null;
}

export function validateTypeDraft(d: TypeDraft, types: CatalogueType[], selfId?: string): string | null {
  const name = d.name.trim();
  if (!name) return "Give the type a name.";
  if (name.length > 60) return "Keep the name to 60 characters or fewer.";
  if (!/^#[0-9a-f]{6}$/i.test(d.colour)) return "Choose a colour.";
  const clash = findClash(d, types, selfId);
  if (clash) return `"${clash.name}" already exists. Open it instead of creating a second one.`;
  if (d.hotkey) {
    if (!TYPE_HOTKEYS.includes(d.hotkey)) return "A hotkey is one digit from 1 to 9 or one letter.";
    const taken = types.find((t) => t.id !== selfId && !t.archived && t.hotkey === d.hotkey);
    if (taken) return `Hotkey ${d.hotkey.toUpperCase()} is already used by "${taken.name}".`;
  }
  return null;
}

export function toCreate(d: TypeDraft): CatalogueTypeCreate {
  return {
    name: d.name.trim(),
    colour: d.colour,
    kind: d.kind,
    group: d.group.trim() || null,
    default_severity: d.defaultSeverity,
    hotkey: d.hotkey || null,
  };
}

export function toPatch(d: TypeDraft, t: CatalogueType): CatalogueTypePatch {
  const patch: CatalogueTypePatch = {};
  const name = d.name.trim();
  const group = d.group.trim() || null;
  const hotkey = d.hotkey || null;
  if (name !== t.name) patch.name = name;
  if (d.colour !== t.colour) patch.colour = d.colour;
  if (d.kind !== t.kind) patch.kind = d.kind;
  if (group !== (t.group ?? null)) patch.group = group;
  if (d.defaultSeverity !== (t.default_severity ?? null)) patch.default_severity = d.defaultSeverity;
  if (hotkey !== (t.hotkey ?? null)) patch.hotkey = hotkey;
  return patch;
}
```

- [ ] **Step 4: Run the model tests to see them pass**

Run: `pnpm -C frontend exec vitest run src/catalogue/catalogueModel.test.ts`
Expected: PASS (9 tests).

- [ ] **Step 5: Write the failing hook tests**

Create `frontend/src/catalogue/useCatalogue.test.tsx`:

```tsx
import type { ReactNode } from "react";
import { describe, expect, it } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";
import type { ApiClient, AppEvent } from "@contract/client";
import { errorBody, fakeClient } from "@/test/fixtures";
import { exampleCataloguePage, exampleTypes } from "@/test/appSectionFixtures";
import { TestApiProvider } from "@/test/render";
import { useChangesStore } from "@/store/changes";
import { useCatalogue } from "./useCatalogue";

const wrapper =
  (api: ApiClient) =>
  ({ children }: { children: ReactNode }) => <TestApiProvider api={api}>{children}</TestApiProvider>;

describe("useCatalogue", () => {
  it("loads every type and the classification flag", async () => {
    const { api } = fakeClient([{ method: "GET", path: /\/catalogue\/types$/, body: exampleCataloguePage }]);
    const { result } = renderHook(() => useCatalogue(), { wrapper: wrapper(api) });
    expect(result.current.loading).toBe(true);
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.types).toHaveLength(4);
    expect(result.current.needsClassification).toBe(true);
    expect(result.current.error).toBeNull();
  });

  it("reports the 503 as unavailable with its folder, not as an error", async () => {
    const { api } = fakeClient([
      {
        method: "GET",
        path: /\/catalogue\/types$/,
        status: 503,
        body: errorBody("catalogue_unavailable", "locked", { folder: "C:\\lib" }),
      },
    ]);
    const { result } = renderHook(() => useCatalogue(), { wrapper: wrapper(api) });
    await waitFor(() => expect(result.current.unavailable).toBe(true));
    expect(result.current.folder).toBe("C:\\lib");
    expect(result.current.error).toBeNull();
  });

  it("reloads when the catalogue changes", async () => {
    const { api, requests } = fakeClient([
      { method: "GET", path: /\/catalogue\/types$/, body: exampleCataloguePage },
    ]);
    const { result } = renderHook(() => useCatalogue(), { wrapper: wrapper(api) });
    await waitFor(() => expect(result.current.loading).toBe(false));
    act(() => {
      useChangesStore.getState().applyEvent({ type: "catalogue.changed", payload: {} } as unknown as AppEvent);
    });
    await waitFor(() => expect(requests.filter((r) => r.method === "GET")).toHaveLength(2));
  });

  it("put() shows a saved type at once", async () => {
    const { api } = fakeClient([{ method: "GET", path: /\/catalogue\/types$/, body: exampleCataloguePage }]);
    const { result } = renderHook(() => useCatalogue(), { wrapper: wrapper(api) });
    await waitFor(() => expect(result.current.loading).toBe(false));
    act(() => result.current.put({ ...exampleTypes[0], kind: "defect" }));
    expect(result.current.types[0].kind).toBe("defect");
    act(() => result.current.put({ ...exampleTypes[0], id: "new", name: "Rust" }));
    expect(result.current.types.map((t) => t.name)).toContain("Rust");
  });
});
```

- [ ] **Step 6: Run them to see them fail**

Run: `pnpm -C frontend exec vitest run src/catalogue/useCatalogue.test.tsx`
Expected: FAIL with `Failed to resolve import "./useCatalogue"`.

- [ ] **Step 7: Implement the hook**

Create `frontend/src/catalogue/useCatalogue.ts`:

```ts
import { useCallback, useEffect, useState } from "react";
import { useApi } from "@/api/client";
import { fetchCatalogue, isCatalogueUnavailable, unavailableFolder, type CatalogueType } from "@/api/catalogue";
import { messageOf } from "@/api/errors";
import { pushLog } from "@/app/diagnostics";
import { useChangesStore } from "@/store/changes";

export interface Catalogue {
  types: CatalogueType[];
  needsClassification: boolean;
  /** True only until the first answer; a reload keeps showing the last list. */
  loading: boolean;
  /** 503 `catalogue_unavailable` (F §15). */
  unavailable: boolean;
  folder: string | null;
  error: string | null;
  reload: () => void;
  /** Shows a saved or created type at once; the `catalogue.changed` reload confirms it. */
  put: (type: CatalogueType) => void;
}

interface State {
  key: string;
  types: CatalogueType[];
  needsClassification: boolean;
  unavailable: boolean;
  folder: string | null;
  error: string | null;
}

const INITIAL: State = { key: "", types: [], needsClassification: false, unavailable: false, folder: null, error: null };

/** The app-wide catalogue, reloaded on every `catalogue.changed` event. */
export function useCatalogue(): Catalogue {
  const api = useApi();
  const revision = useChangesStore((s) => s.catalogueRevision);
  const [attempt, setAttempt] = useState(0);
  const key = `${revision}|${attempt}`;
  const [state, setState] = useState<State>(INITIAL);

  useEffect(() => {
    let cancelled = false;
    fetchCatalogue(api)
      .then((list) => {
        if (cancelled) return;
        setState({
          key,
          types: list.types,
          needsClassification: list.needsClassification,
          unavailable: false,
          folder: null,
          error: null,
        });
      })
      .catch((e: unknown) => {
        if (cancelled) return;
        pushLog(`load catalogue failed: ${messageOf(e, String(e))}`);
        const unavailable = isCatalogueUnavailable(e);
        setState((s) => ({
          key,
          types: unavailable ? [] : s.types,
          needsClassification: false,
          unavailable,
          folder: unavailableFolder(e),
          error: unavailable ? null : messageOf(e, "could not load the catalogue"),
        }));
      });
    return () => {
      cancelled = true;
    };
  }, [api, key]);

  const reload = useCallback(() => setAttempt((a) => a + 1), []);
  const put = useCallback(
    (type: CatalogueType) =>
      setState((s) => ({
        ...s,
        types: s.types.some((t) => t.id === type.id)
          ? s.types.map((t) => (t.id === type.id ? type : t))
          : [...s.types, type],
      })),
    [],
  );

  return {
    types: state.types,
    needsClassification: state.needsClassification,
    loading: state.key === "",
    unavailable: state.unavailable,
    folder: state.folder,
    error: state.error,
    reload,
    put,
  };
}
```

- [ ] **Step 8: Run the hook tests to see them pass**

Run: `pnpm -C frontend exec vitest run src/catalogue`
Expected: PASS (model, hook and normaliseName: 20 tests).

- [ ] **Step 9: Commit**

```powershell
pnpm -C frontend lint
git add frontend/src/catalogue/catalogueModel.ts frontend/src/catalogue/catalogueModel.test.ts frontend/src/catalogue/useCatalogue.ts frontend/src/catalogue/useCatalogue.test.tsx
git commit -m "feat(catalogue): filter, draft and validation model and the catalogue hook

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: Catalogue screen, types table and type editor

Load `impeccable`, `emil-design-eng` and `DESIGN.md` first.

**Files:**
- Create: `frontend/src/catalogue/ColourSwatch.tsx`
- Create: `frontend/src/catalogue/TypeEditor.tsx`, `frontend/src/catalogue/TypeEditor.test.tsx`
- Create: `frontend/src/catalogue/TypesPane.tsx`
- Create: `frontend/src/catalogue/CatalogueScreen.tsx`, `frontend/src/catalogue/CatalogueScreen.test.tsx`
- Modify: `frontend/src/routes/appRoutes.tsx`

**Interfaces:**
- Consumes:
  - Task 1: `createCatalogueType`, `patchCatalogueType`, `existingTypeId`, `isHotkeyConflict`, `CatalogueType`, `CatalogueTypeUpdated`
  - Task 2: `useCatalogue`, `Catalogue`, `filterTypes`, `DEFAULT_FILTERS`, `TypeFilters`, `draftOf`,
    `findClash`, `validateTypeDraft`, `toCreate`, `toPatch`, `TYPE_HOTKEYS`
  - DS: `GlassPanel`, `DataTable`, `Column`, `InspectorPane`, `InspectorSection`, `Tabs`,
    `TypeChip`, `SeverityPill`, `SeverityPicker`, `Kbd`
  - SH: `useProvideRouteActions`, `RouteAction`
- Produces:
  - `ColourSwatch({label, value, onChange, disabled?})`, reused by Task 5
  - `TypeEditor(props: TypeEditorProps)`, where `TypeEditorProps = {type: CatalogueType | null;
    types: CatalogueType[]; onSaved(type, backfillCandidates: boolean); onUseExisting(id); onClose()}`
  - `TypesPane({catalogue}: {catalogue: Catalogue})`, which Task 4 extends
  - `CatalogueScreen({tab}: {tab: "types"})`. Task 5 widens `tab` to `"types" | "severity"`
  - The route `/catalogue`, with `?type=<id>` or `?type=new` opening the editor

- [ ] **Step 1: Check how SH's `useProvideRouteActions` is provided to tests**

Run: `Select-String -Path frontend\src\app\routeActions.ts -Pattern 'create\(','createContext'`

Expected: `create(` (the SH plan keeps route actions in a zustand store: `entries`, `put`), so no
provider is needed and the tests below use `renderWithProviders` unchanged. If it is a React context
instead, SH added its provider to `renderWithProviders`. Confirm that with
`Select-String -Path frontend\src\test\render.tsx -Pattern 'RouteActions'`.

- [ ] **Step 2: Write the failing editor tests**

Create `frontend/src/catalogue/TypeEditor.test.tsx`:

```tsx
import { describe, expect, it, vi } from "vitest";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import { errorBody, fakeClient, type FakeRoute } from "@/test/fixtures";
import { exampleTypes, TYPE_ID } from "@/test/appSectionFixtures";
import { renderWithProviders } from "@/test/render";
import { TypeEditor, type TypeEditorProps } from "./TypeEditor";

const crack = exampleTypes[2];

function renderEditor(props: Partial<TypeEditorProps> = {}, routes: FakeRoute[] = []) {
  const { api, requests } = fakeClient(routes);
  const onSaved = vi.fn();
  const onUseExisting = vi.fn();
  const onClose = vi.fn();
  renderWithProviders(
    <TypeEditor
      type={null}
      types={exampleTypes}
      onSaved={onSaved}
      onUseExisting={onUseExisting}
      onClose={onClose}
      {...props}
    />,
    { api },
  );
  return { requests, onSaved, onUseExisting, onClose };
}

// The severity picker reads DS's context, whose default is D4's scale (Minor … Critical).
describe("TypeEditor", () => {
  it("creates a defect with a default severity", async () => {
    const created = { ...crack, id: "new", name: "Rust", default_severity: 3 };
    const { requests, onSaved } = renderEditor({}, [
      { method: "POST", path: /\/catalogue\/types$/, status: 201, body: created },
    ]);
    expect(screen.getByRole("heading", { name: "New type" })).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Rust" } });
    fireEvent.click(screen.getByRole("radio", { name: /Major/ }));
    fireEvent.click(screen.getByRole("button", { name: "Create type" }));
    await waitFor(() => expect(onSaved).toHaveBeenCalledWith(created, false));
    expect(requests[0].body).toEqual({
      name: "Rust",
      colour: "#eab308",
      kind: "defect",
      group: null,
      default_severity: 3,
      hotkey: null,
    });
  });

  it("refuses a name that normalises to an existing type and opens that one", () => {
    const { requests, onUseExisting } = renderEditor();
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "dump-truck" } });
    fireEvent.click(screen.getByRole("button", { name: "Create type" }));
    expect(screen.getByText('"Dump truck" already exists. Open it instead of creating a second one.')).toBeInTheDocument();
    expect(requests).toHaveLength(0);
    fireEvent.click(screen.getByRole("button", { name: "Use existing" }));
    expect(onUseExisting).toHaveBeenCalledWith(TYPE_ID(2));
  });

  it("offers the existing type when the server answers type_exists", async () => {
    const { onUseExisting } = renderEditor({}, [
      {
        method: "POST",
        path: /\/catalogue\/types$/,
        status: 409,
        body: errorBody("type_exists", "exists", { type_id: TYPE_ID(4) }),
      },
    ]);
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Spall" } });
    fireEvent.click(screen.getByRole("button", { name: "Create type" }));
    expect(await screen.findByText("A type with this name already exists.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Use existing" }));
    expect(onUseExisting).toHaveBeenCalledWith(TYPE_ID(4));
  });

  it("says findings are kept when a defect becomes an object, and drops the severity", () => {
    renderEditor({ type: crack });
    expect(screen.getByRole("heading", { name: "Crack" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("radio", { name: "Object", exact: true }));
    expect(screen.getByText("Findings of this type are kept. No new findings will be created from it.")).toBeInTheDocument();
    expect(screen.getByText("Objects are counted, not graded, so they have no severity.")).toBeInTheDocument();
  });

  it("passes the backfill flag on from an object -> defect save", async () => {
    const excavator = exampleTypes[0];
    const { requests, onSaved } = renderEditor({ type: excavator }, [
      {
        method: "PATCH",
        path: /\/catalogue\/types\/[^/]+$/,
        body: { ...excavator, kind: "defect", backfill_candidates: true },
      },
    ]);
    fireEvent.click(screen.getByRole("radio", { name: "Defect", exact: true }));
    fireEvent.click(screen.getByRole("button", { name: "Save type" }));
    await waitFor(() => expect(onSaved).toHaveBeenCalledWith({ ...excavator, kind: "defect" }, true));
    expect(requests[0].body).toEqual({ kind: "defect" });
  });

  it("archives a type", async () => {
    const { requests, onSaved } = renderEditor({ type: crack }, [
      { method: "PATCH", path: /\/catalogue\/types\/[^/]+$/, body: { ...crack, archived: true } },
    ]);
    fireEvent.click(screen.getByRole("button", { name: "Archive" }));
    await waitFor(() => expect(onSaved).toHaveBeenCalledWith({ ...crack, archived: true }, false));
    expect(requests[0].body).toEqual({ archived: true });
  });

  it("closes without a request when nothing changed", () => {
    const { requests, onClose } = renderEditor({ type: crack });
    fireEvent.click(screen.getByRole("button", { name: "Save type" }));
    expect(onClose).toHaveBeenCalled();
    expect(requests).toHaveLength(0);
  });
});
```

- [ ] **Step 3: Run them to see them fail**

Run: `pnpm -C frontend exec vitest run src/catalogue/TypeEditor.test.tsx`
Expected: FAIL with `Failed to resolve import "./TypeEditor"`.

- [ ] **Step 4: Implement `ColourSwatch` and `TypeEditor`**

Create `frontend/src/catalogue/ColourSwatch.tsx`:

```tsx
import type { CSSProperties } from "react";

interface Props {
  label: string;
  value: string;
  onChange: (colour: string) => void;
  disabled?: boolean;
}

/**
 * The browser's own colour picker drawn as a swatch. The colour is data, so it reaches CSS only
 * through `--c` (F §4.5).
 */
export function ColourSwatch({ label, value, onChange, disabled }: Props) {
  return (
    <span
      className="relative inline-block h-7 w-7 shrink-0 overflow-hidden rounded-sm border border-line bg-[var(--c)] focus-within:ring-2 focus-within:ring-accent"
      style={{ "--c": value } as CSSProperties}
      title={label}
    >
      <input
        aria-label={label}
        type="color"
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value)}
        className="absolute inset-0 h-full w-full cursor-pointer opacity-0 disabled:cursor-not-allowed"
      />
    </span>
  );
}
```

Create `frontend/src/catalogue/TypeEditor.tsx`:

```tsx
import { useMemo, useState } from "react";
import { useApi } from "@/api/client";
import {
  createCatalogueType,
  existingTypeId,
  isHotkeyConflict,
  patchCatalogueType,
  type CatalogueType,
  type CatalogueTypeUpdated,
  type TypeKind,
} from "@/api/catalogue";
import { messageOf } from "@/api/errors";
import { pushLog } from "@/app/diagnostics";
import {
  Alert,
  Button,
  Field,
  IconButton,
  Input,
  InspectorPane,
  InspectorSection,
  Segmented,
  Select,
  SeverityPicker,
} from "@/ui";
import { ColourSwatch } from "./ColourSwatch";
import {
  TYPE_HOTKEYS,
  draftOf,
  findClash,
  toCreate,
  toPatch,
  validateTypeDraft,
  type TypeDraft,
} from "./catalogueModel";

export interface TypeEditorProps {
  /** null: a new type. */
  type: CatalogueType | null;
  types: CatalogueType[];
  onSaved: (type: CatalogueType, backfillCandidates: boolean) => void;
  onUseExisting: (id: string) => void;
  onClose: () => void;
}

const KINDS: { value: TypeKind; label: string }[] = [
  { value: "defect", label: "Defect" },
  { value: "object", label: "Object" },
];

function split({ backfill_candidates, ...type }: CatalogueTypeUpdated): [CatalogueType, boolean] {
  return [type, Boolean(backfill_candidates)];
}

/** The Catalogue's inspector (F §7.5): name, colour, kind, group, default severity, hotkey, archive. */
export function TypeEditor({ type, types, onSaved, onUseExisting, onClose }: TypeEditorProps) {
  const api = useApi();
  const [draft, setDraft] = useState<TypeDraft>(() => draftOf(type, types));
  const [error, setError] = useState<string | null>(null);
  const [existingId, setExistingId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const groups = useMemo(
    () => [...new Set(types.map((t) => t.group).filter((g): g is string => Boolean(g)))].sort(),
    [types],
  );
  const patch = (p: Partial<TypeDraft>) => setDraft((d) => ({ ...d, ...p }));
  const turningToObject = type?.kind === "defect" && draft.kind === "object";
  const turningToDefect = type?.kind === "object" && draft.kind === "defect";

  async function save() {
    const problem = validateTypeDraft(draft, types, type?.id);
    setExistingId(findClash(draft, types, type?.id)?.id ?? null);
    setError(problem);
    if (problem) return;
    setBusy(true);
    try {
      if (type) {
        const body = toPatch(draft, type);
        if (Object.keys(body).length === 0) {
          onClose();
          return;
        }
        const [saved, backfill] = split(await patchCatalogueType(api, type.id, body));
        onSaved(saved, backfill);
      } else {
        onSaved(await createCatalogueType(api, toCreate(draft)), false);
      }
    } catch (e) {
      pushLog(`save catalogue type failed: ${messageOf(e, String(e))}`);
      const existing = existingTypeId(e);
      setExistingId(existing);
      setError(
        existing
          ? "A type with this name already exists."
          : isHotkeyConflict(e)
            ? `Hotkey ${draft.hotkey.toUpperCase()} is already used by another type.`
            : messageOf(e, "could not save the type"),
      );
    } finally {
      setBusy(false);
    }
  }

  async function toggleArchived() {
    if (!type) return;
    setBusy(true);
    setError(null);
    try {
      const [saved] = split(await patchCatalogueType(api, type.id, { archived: !type.archived }));
      onSaved(saved, false);
    } catch (e) {
      pushLog(`archive catalogue type failed: ${messageOf(e, String(e))}`);
      setError(messageOf(e, "could not change the type"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <InspectorPane
      label="Type"
      header={
        <div className="flex items-center gap-2">
          <h2 className="min-w-0 flex-1 truncate text-lg font-semibold">{type ? type.name : "New type"}</h2>
          <IconButton icon="x" label="Close type" size="sm" onClick={onClose} />
        </div>
      }
      footer={
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="primary" loading={busy} onClick={() => void save()}>
            {type ? "Save type" : "Create type"}
          </Button>
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          {type && (
            <Button
              variant={type.archived ? "secondary" : "danger"}
              className="ml-auto"
              disabled={busy}
              onClick={() => void toggleArchived()}
            >
              {type.archived ? "Restore" : "Archive"}
            </Button>
          )}
        </div>
      }
    >
      <InspectorSection title="Type">
        <div className="flex flex-col gap-4">
          <Field label="Name" htmlFor="type-name">
            <Input id="type-name" value={draft.name} onChange={(e) => patch({ name: e.target.value })} />
          </Field>
          <div className="flex items-center gap-3">
            <ColourSwatch label="Colour" value={draft.colour} onChange={(colour) => patch({ colour })} />
            <span className="text-xs text-muted">Colour on images, maps and reports</span>
          </div>
          <Field label="Group" htmlFor="type-group" hint="Shown as Catalogue › group, for example Concrete defects.">
            <Input
              id="type-group"
              list="catalogue-groups"
              value={draft.group}
              onChange={(e) => patch({ group: e.target.value })}
            />
          </Field>
          <datalist id="catalogue-groups">
            {groups.map((g) => (
              <option key={g} value={g} />
            ))}
          </datalist>
        </div>
      </InspectorSection>

      <InspectorSection title="Kind">
        <div className="flex flex-col gap-3">
          <Segmented
            label="Kind"
            options={KINDS}
            value={draft.kind}
            onChange={(kind) => patch({ kind, defaultSeverity: kind === "object" ? null : draft.defaultSeverity })}
          />
          <p className="text-xs text-muted">
            Defect detections become findings. Objects such as machines and stockpiles are counted.
          </p>
          {turningToObject && (
            <Alert tone="info">Findings of this type are kept. No new findings will be created from it.</Alert>
          )}
          {turningToDefect && (
            <p className="text-xs text-muted">
              After saving you can create findings from its accepted annotations.
            </p>
          )}
        </div>
      </InspectorSection>

      <InspectorSection title="Default severity">
        {draft.kind === "defect" ? (
          <div className="flex flex-col gap-2">
            <SeverityPicker
              label="Default severity"
              allowNone
              value={draft.defaultSeverity}
              onChange={(level) => patch({ defaultSeverity: level })}
            />
            <Button
              size="sm"
              variant={draft.defaultSeverity === null ? "secondary" : "ghost"}
              aria-pressed={draft.defaultSeverity === null}
              className="self-start"
              onClick={() => patch({ defaultSeverity: null })}
            >
              None
            </Button>
          </div>
        ) : (
          <p className="text-xs text-muted">Objects are counted, not graded, so they have no severity.</p>
        )}
      </InspectorSection>

      <InspectorSection title="Hotkey">
        <Field label="Hotkey" htmlFor="type-hotkey" hint="Picks this type inside the type picker (T).">
          <Select id="type-hotkey" value={draft.hotkey} onChange={(e) => patch({ hotkey: e.target.value })}>
            <option value="">None</option>
            {TYPE_HOTKEYS.map((k) => (
              <option key={k} value={k}>
                {k.toUpperCase()}
              </option>
            ))}
          </Select>
        </Field>
      </InspectorSection>

      {error && (
        <Alert
          tone="danger"
          actions={
            existingId && existingId !== type?.id ? (
              <Button size="sm" onClick={() => onUseExisting(existingId)}>
                Use existing
              </Button>
            ) : undefined
          }
        >
          {error}
        </Alert>
      )}
    </InspectorPane>
  );
}
```

- [ ] **Step 5: Run the editor tests to see them pass**

Run: `pnpm -C frontend exec vitest run src/catalogue/TypeEditor.test.tsx`
Expected: PASS (7 tests).

- [ ] **Step 6: Write the failing screen tests**

Create `frontend/src/catalogue/CatalogueScreen.test.tsx`:

```tsx
import { describe, expect, it } from "vitest";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { errorBody, fakeClient, type FakeRoute } from "@/test/fixtures";
import { exampleCataloguePage, exampleTypes } from "@/test/appSectionFixtures";
import { renderWithProviders } from "@/test/render";
import { CatalogueScreen } from "./CatalogueScreen";

const LIST: FakeRoute = {
  method: "GET",
  path: /\/catalogue\/types$/,
  body: { ...exampleCataloguePage, needs_classification: false },
};

function renderCatalogue(routes: FakeRoute[], route = "/catalogue") {
  const { api, requests } = fakeClient(routes);
  renderWithProviders(<CatalogueScreen tab="types" />, { api, route, path: "/catalogue" });
  return requests;
}

describe("CatalogueScreen, types", () => {
  it("lists the live types with group, default severity and hotkey", async () => {
    renderCatalogue([LIST]);
    const row = await screen.findByRole("row", { name: /Crack/ });
    expect(row).toHaveTextContent("Concrete defects");
    expect(row).toHaveTextContent("Moderate");
    expect(within(row).getByText("C")).toBeInTheDocument();
    expect(screen.queryByRole("row", { name: /Spalling/ })).not.toBeInTheDocument();
  });

  it("filters by search, kind and archived", async () => {
    renderCatalogue([LIST]);
    await screen.findByRole("row", { name: /Crack/ });
    fireEvent.change(screen.getByLabelText("Search types"), { target: { value: "dump_truck" } });
    expect(screen.getByRole("row", { name: /Dump truck/ })).toBeInTheDocument();
    expect(screen.queryByRole("row", { name: /Excavator/ })).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Search types"), { target: { value: "" } });
    fireEvent.click(screen.getByRole("radio", { name: "Defects" }));
    expect(screen.queryByRole("row", { name: /Excavator/ })).not.toBeInTheDocument();
    fireEvent.click(screen.getByLabelText("Show archived"));
    expect(screen.getByRole("row", { name: /Spalling/ })).toHaveTextContent("Archived");
  });

  it("opens a row in the editor and saves only the change", async () => {
    const requests = renderCatalogue([
      LIST,
      { method: "PATCH", path: /\/catalogue\/types\/[^/]+$/, body: { ...exampleTypes[2], name: "Hairline crack" } },
    ]);
    fireEvent.click(await screen.findByRole("row", { name: /Crack/ }));
    expect(screen.getByRole("heading", { name: "Crack" })).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Hairline crack" } });
    fireEvent.click(screen.getByRole("button", { name: "Save type" }));
    await waitFor(() =>
      expect(requests.find((r) => r.method === "PATCH")?.body).toEqual({ name: "Hairline crack" }),
    );
    expect(await screen.findByRole("heading", { name: "Hairline crack" })).toBeInTheDocument();
  });

  it("opens the new-type editor from ?type=new", async () => {
    renderCatalogue([LIST], "/catalogue?type=new");
    expect(await screen.findByRole("heading", { name: "New type" })).toBeInTheDocument();
  });

  it("an unknown ?type= says so and keeps the list", async () => {
    renderCatalogue([LIST], "/catalogue?type=gone");
    expect(await screen.findByText("That type is not in the catalogue")).toBeInTheDocument();
    expect(screen.getByRole("row", { name: /Crack/ })).toBeInTheDocument();
  });

  it("blocks with the reason and the folder when the catalogue is unavailable", async () => {
    renderCatalogue([
      {
        method: "GET",
        path: /\/catalogue\/types$/,
        status: 503,
        body: errorBody("catalogue_unavailable", "locked", { folder: "C:\\lib" }),
      },
    ]);
    expect(await screen.findByText("The catalogue could not be opened")).toBeInTheDocument();
    expect(screen.getByText("C:\\lib")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Copy folder path" })).toBeInTheDocument();
    expect(screen.queryByRole("row", { name: /Crack/ })).not.toBeInTheDocument();
  });
});
```

- [ ] **Step 7: Run them to see them fail**

Run: `pnpm -C frontend exec vitest run src/catalogue/CatalogueScreen.test.tsx`
Expected: FAIL with `Failed to resolve import "./CatalogueScreen"`.

- [ ] **Step 8: Implement `TypesPane` and `CatalogueScreen`**

Create `frontend/src/catalogue/TypesPane.tsx`:

```tsx
import { useCallback, useMemo, useState, type CSSProperties } from "react";
import { useSearchParams } from "react-router-dom";
import type { CatalogueType } from "@/api/catalogue";
import {
  Checkbox,
  DataTable,
  EmptyState,
  GlassPanel,
  Input,
  Kbd,
  Pill,
  Segmented,
  SeverityPill,
  TypeChip,
  type Column,
} from "@/ui";
import { DEFAULT_FILTERS, filterTypes, type KindFilter, type TypeFilters } from "./catalogueModel";
import { TypeEditor } from "./TypeEditor";
import type { Catalogue } from "./useCatalogue";

const KIND_FILTERS: { value: KindFilter; label: string }[] = [
  { value: "all", label: "All" },
  { value: "defect", label: "Defects" },
  { value: "object", label: "Objects" },
];

const COLUMNS: Column<CatalogueType>[] = [
  {
    key: "name",
    header: "Type",
    width: "minmax(12rem,2fr)",
    render: (t) => <TypeChip name={t.name} colour={t.colour} kind={t.kind} />,
  },
  {
    key: "group",
    header: "Group",
    width: "minmax(8rem,1fr)",
    render: (t) => <span className="truncate text-muted">{t.group ?? "–"}</span>,
  },
  {
    key: "severity",
    header: "Default severity",
    width: "9rem",
    render: (t) =>
      t.kind === "defect" && t.default_severity != null ? (
        <SeverityPill level={t.default_severity} />
      ) : (
        <span className="text-dim">–</span>
      ),
  },
  {
    key: "hotkey",
    header: "Hotkey",
    width: "5rem",
    render: (t) => (t.hotkey ? <Kbd>{t.hotkey.toUpperCase()}</Kbd> : <span className="text-dim">–</span>),
  },
  {
    key: "state",
    header: "State",
    width: "9rem",
    render: (t) =>
      t.archived ? (
        <Pill size="sm">Archived</Pill>
      ) : t.origin === "migrated" ? (
        <Pill size="sm" tone="accent">
          From projects
        </Pill>
      ) : null,
  },
];

/** The Types sub-tab: filters, the types table and, from `?type=`, the editor (F §7.5). */
export function TypesPane({ catalogue }: { catalogue: Catalogue }) {
  const [params, setParams] = useSearchParams();
  const openId = params.get("type");
  const [filters, setFilters] = useState<TypeFilters>(DEFAULT_FILTERS);
  const rows = useMemo(() => filterTypes(catalogue.types, filters), [catalogue.types, filters]);

  const open = useCallback(
    (id: string | null) =>
      setParams(
        (p) => {
          const next = new URLSearchParams(p);
          if (id) next.set("type", id);
          else next.delete("type");
          return next;
        },
        { replace: true },
      ),
    [setParams],
  );

  const editing: CatalogueType | null | undefined =
    openId === "new" ? null : catalogue.types.find((t) => t.id === openId);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-3">
        <Input
          aria-label="Search types"
          placeholder="Search types"
          value={filters.q}
          onChange={(e) => setFilters((f) => ({ ...f, q: e.target.value }))}
          className="w-64"
        />
        <Segmented
          label="Kind"
          size="sm"
          options={KIND_FILTERS}
          value={filters.kind}
          onChange={(kind) => setFilters((f) => ({ ...f, kind }))}
        />
        <Checkbox
          label="Show archived"
          checked={filters.showArchived}
          onChange={(e) => setFilters((f) => ({ ...f, showArchived: e.target.checked }))}
        />
      </div>
      <div className="grid items-start gap-4 min-[1100px]:grid-cols-[minmax(0,1fr)_340px]">
        <GlassPanel variant="pane" className="min-w-0 overflow-hidden">
          <DataTable
            label="Catalogue types"
            columns={COLUMNS}
            rows={rows}
            rowKey={(t) => t.id}
            activeKey={openId}
            onOpen={(t) => open(t.id)}
            loading={catalogue.loading}
            empty={
              <EmptyState icon="catalogue" title="No types match">
                Change the filters, or add a type with New type.
              </EmptyState>
            }
          />
        </GlassPanel>
        {openId &&
          !catalogue.loading &&
          (editing === undefined ? (
            <GlassPanel variant="pane" className="p-4">
              <EmptyState icon="catalogue" title="That type is not in the catalogue">
                The link may be out of date. Choose a type from the list.
              </EmptyState>
            </GlassPanel>
          ) : (
            <TypeEditor
              key={openId}
              type={editing}
              types={catalogue.types}
              onSaved={(t) => {
                catalogue.put(t);
                open(t.id);
              }}
              onUseExisting={(id) => open(id)}
              onClose={() => open(null)}
            />
          ))}
      </div>
    </div>
  );
}

/** A small swatch for places that show a type colour without a chip (Task 15). */
export function TypeSwatch({ colour }: { colour: string }) {
  return (
    <span
      aria-hidden
      className="block h-3.5 w-3.5 shrink-0 rounded-sm bg-[var(--c)]"
      style={{ "--c": colour } as CSSProperties}
    />
  );
}
```

Create `frontend/src/catalogue/CatalogueScreen.tsx`:

```tsx
import { useMemo, useState } from "react";
import { useProvideRouteActions, type RouteAction } from "@/app/routeActions";
import { Alert, Button, Tabs } from "@/ui";
import { TypesPane } from "./TypesPane";
import { useCatalogue } from "./useCatalogue";

export type CatalogueTab = "types";

const TABS = [{ id: "types", to: "/catalogue", label: "Types", end: true }];

/** The 503 block (F §15). "Copy folder path" stands in for "Reveal folder" (plan decision 6). */
function CatalogueUnavailable({ folder }: { folder: string | null }) {
  const [copied, setCopied] = useState(false);
  async function copy() {
    if (!folder) return;
    try {
      await navigator.clipboard.writeText(folder);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  }
  return (
    <Alert
      tone="danger"
      title="The catalogue could not be opened"
      actions={
        folder ? (
          <Button size="sm" onClick={() => void copy()}>
            {copied ? "Copied" : "Copy folder path"}
          </Button>
        ) : undefined
      }
    >
      <p>
        Projects still open and show their types from their own copy. Creating types, the severity scale and the
        findings backfill need the catalogue. Check the folder, then restart the app.
      </p>
      {folder && <p className="mt-1 break-all font-mono text-xs">{folder}</p>}
    </Alert>
  );
}

/** App-level Catalogue (F §7.5): defect and object types, and (Task 5) the severity scale. */
export function CatalogueScreen({ tab }: { tab: CatalogueTab }) {
  const catalogue = useCatalogue();
  const actions = useMemo<RouteAction[]>(
    () =>
      tab === "types" && !catalogue.unavailable
        ? [{ id: "new-type", label: "New type", icon: "plus", variant: "primary", to: "/catalogue?type=new" }]
        : [],
    [tab, catalogue.unavailable],
  );
  useProvideRouteActions(actions);

  return (
    <section className="flex flex-col gap-5">
      <header className="flex flex-col gap-1">
        <h1 className="text-xl font-semibold tracking-tight">Catalogue</h1>
        <p className="text-sm text-muted">
          The defect and object types every project picks from, and the severity scale findings are graded on.
        </p>
      </header>
      <Tabs asLinks label="Catalogue sections" items={TABS} />
      {catalogue.unavailable ? (
        <CatalogueUnavailable folder={catalogue.folder} />
      ) : catalogue.error ? (
        <Alert
          tone="danger"
          actions={
            <Button size="sm" onClick={catalogue.reload}>
              Retry
            </Button>
          }
        >
          {catalogue.error}
        </Alert>
      ) : (
        <TypesPane catalogue={catalogue} />
      )}
    </section>
  );
}
```

- [ ] **Step 9: Add the `/catalogue` route**

In `frontend/src/routes/appRoutes.tsx` (SH's file; S2 swaps entries only):

1. Add `import { lazy } from "react";` at the top (SH already imports `Later` from
   `@/app/lazyScreens`).

2. Below the imports, add:

   ```tsx
   const CatalogueScreen = lazy(() =>
     import("@/catalogue/CatalogueScreen").then((m) => ({ default: m.CatalogueScreen })),
   );
   ```

3. Replace SH's `{ path: "catalogue", element: catalogue }` entry with the entry below. Leave SH's
   `catalogue/severity` placeholder for Task 5.

   ```tsx
     {
       path: "catalogue",
       element: (
         <Later>
           <CatalogueScreen tab="types" />
         </Later>
       ),
     },
   ```

- [ ] **Step 10: Run the catalogue tests, lint and build**

Run: `pnpm -C frontend exec vitest run src/catalogue src/routes`
Expected: PASS. This includes the 6 new screen tests and any SH route test in `src/routes`.

Run: `pnpm -C frontend lint; pnpm -C frontend build`
Expected: both exit 0, and lint prints `tokens ok`.

- [ ] **Step 11: Commit**

```powershell
git add frontend/src/catalogue/ColourSwatch.tsx frontend/src/catalogue/TypeEditor.tsx frontend/src/catalogue/TypeEditor.test.tsx frontend/src/catalogue/TypesPane.tsx frontend/src/catalogue/CatalogueScreen.tsx frontend/src/catalogue/CatalogueScreen.test.tsx frontend/src/routes/appRoutes.tsx
git commit -m "feat(catalogue): the Catalogue screen with the types table and the type editor

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 4: Classification banner and findings backfill offer

**Files:**
- Create: `frontend/src/catalogue/ClassificationBanner.tsx`, `frontend/src/catalogue/ClassificationBanner.test.tsx`
- Create: `frontend/src/catalogue/BackfillOffer.tsx`, `frontend/src/catalogue/BackfillOffer.test.tsx`
- Modify: `frontend/src/catalogue/TypesPane.tsx`
- Modify: `frontend/src/catalogue/CatalogueScreen.test.tsx` (two new cases)

**Interfaces:**
- Consumes:
  - Task 1: `finishClassification`, `startBackfill`
  - Task 2: `migratedCount`
  - Task 3: `TypesPane`, `TypeEditor.onSaved(type, backfillCandidates)`
  - `useJobsStore`
- Produces:
  - `ClassificationBanner({count, filtered, onShowAll, onShowMigrated, onDone})`
  - `BackfillOffer({type, onDismiss})`. Its "Follow in Jobs" link is `/jobs?project=library&job=<id>`,
    which Task 6's screen reads.

- [ ] **Step 1: Write the failing component tests**

Create `frontend/src/catalogue/ClassificationBanner.test.tsx`:

```tsx
import { describe, expect, it, vi } from "vitest";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import { errorBody, fakeClient } from "@/test/fixtures";
import { renderWithProviders } from "@/test/render";
import { ClassificationBanner } from "./ClassificationBanner";

function renderBanner(count: number, filtered = true, status = 204) {
  const { api, requests } = fakeClient([
    {
      method: "POST",
      path: /\/catalogue\/classification\/done$/,
      status,
      body: status === 204 ? undefined : errorBody("catalogue_unavailable", "locked"),
    },
  ]);
  const props = { onShowAll: vi.fn(), onShowMigrated: vi.fn(), onDone: vi.fn() };
  renderWithProviders(<ClassificationBanner count={count} filtered={filtered} {...props} />, { api });
  return { requests, ...props };
}

describe("ClassificationBanner", () => {
  it("says how many types came from existing projects, in the spec's words", () => {
    renderBanner(12);
    expect(screen.getByText("12 types came from your existing projects. Mark which are defects.")).toBeInTheDocument();
  });

  it("uses the singular for one type", () => {
    renderBanner(1);
    expect(screen.getByText("1 type came from your existing projects. Mark which are defects.")).toBeInTheDocument();
  });

  it("switches between the migrated view and all types", () => {
    const filtered = renderBanner(2, true);
    fireEvent.click(screen.getByRole("button", { name: "Show all types" }));
    expect(filtered.onShowAll).toHaveBeenCalled();
  });

  it("Done clears the flag on the server and tells the screen", async () => {
    const { requests, onDone } = renderBanner(2);
    fireEvent.click(screen.getByRole("button", { name: "Done" }));
    await waitFor(() => expect(onDone).toHaveBeenCalled());
    expect(requests[0].url).toBe("/api/v1/catalogue/classification/done");
  });

  it("keeps the banner and explains when Done fails", async () => {
    const { onDone } = renderBanner(2, true, 503);
    fireEvent.click(screen.getByRole("button", { name: "Done" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("locked");
    expect(onDone).not.toHaveBeenCalled();
  });
});
```

Create `frontend/src/catalogue/BackfillOffer.test.tsx`:

```tsx
import { describe, expect, it, vi } from "vitest";
import { fireEvent, screen } from "@testing-library/react";
import { fakeClient, runningJob } from "@/test/fixtures";
import { exampleTypes } from "@/test/appSectionFixtures";
import { renderWithProviders } from "@/test/render";
import { useJobsStore } from "@/store/jobs";
import { BackfillOffer } from "./BackfillOffer";

const JOB = { ...runningJob, id: "j-backfill", project_id: "library", type: "findings_backfill" as const };

describe("BackfillOffer", () => {
  it("starts the findings backfill as a library job and links to it in Jobs", async () => {
    const { api, requests } = fakeClient([
      { method: "POST", path: /\/catalogue\/types\/[^/]+\/backfill$/, status: 202, body: { job: JOB } },
    ]);
    renderWithProviders(<BackfillOffer type={{ ...exampleTypes[0], kind: "defect" }} onDismiss={vi.fn()} />, { api });
    expect(screen.getByText("Excavator is now a defect")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Create findings from accepted annotations of this type" }));
    expect(await screen.findByRole("link", { name: "Follow in Jobs" })).toHaveAttribute(
      "href",
      "/jobs?project=library&job=j-backfill",
    );
    expect(requests[0].url).toBe(`/api/v1/catalogue/types/${exampleTypes[0].id}/backfill`);
    expect(useJobsStore.getState().jobs["j-backfill"]?.type).toBe("findings_backfill");
  });
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `pnpm -C frontend exec vitest run src/catalogue/ClassificationBanner.test.tsx src/catalogue/BackfillOffer.test.tsx`
Expected: FAIL with `Failed to resolve import "./ClassificationBanner"` and `"./BackfillOffer"`.

- [ ] **Step 3: Implement both components**

Create `frontend/src/catalogue/ClassificationBanner.tsx`:

```tsx
import { useState } from "react";
import { useApi } from "@/api/client";
import { finishClassification } from "@/api/catalogue";
import { messageOf } from "@/api/errors";
import { pushLog } from "@/app/diagnostics";
import { Alert, Button } from "@/ui";

export interface ClassificationBannerProps {
  /** Non-archived migrated types (`migratedCount`). */
  count: number;
  /** The table shows only migrated types. */
  filtered: boolean;
  onShowAll: () => void;
  onShowMigrated: () => void;
  onDone: () => void;
}

/** F §7.5 / F4: migrated types start as objects; the operator marks the defects once. */
export function ClassificationBanner({ count, filtered, onShowAll, onShowMigrated, onDone }: ClassificationBannerProps) {
  const api = useApi();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function done() {
    setBusy(true);
    setError(null);
    try {
      await finishClassification(api);
      onDone();
    } catch (e) {
      pushLog(`finish classification failed: ${messageOf(e, String(e))}`);
      setError(messageOf(e, "could not save that"));
    } finally {
      setBusy(false);
    }
  }

  const title =
    count === 1
      ? "1 type came from your existing projects. Mark which are defects."
      : `${count} types came from your existing projects. Mark which are defects.`;

  return (
    <Alert
      tone="info"
      title={title}
      actions={
        <>
          {filtered ? (
            <Button size="sm" variant="ghost" onClick={onShowAll}>
              Show all types
            </Button>
          ) : (
            <Button size="sm" variant="ghost" onClick={onShowMigrated}>
              Show them
            </Button>
          )}
          <Button size="sm" loading={busy} onClick={() => void done()}>
            Done
          </Button>
        </>
      }
    >
      Open a type and set its kind to Defect. You can then create findings from its accepted annotations.
      {error && (
        <span role="alert" className="mt-1 block text-danger">
          {error}
        </span>
      )}
    </Alert>
  );
}
```

Create `frontend/src/catalogue/BackfillOffer.tsx`:

```tsx
import { useState } from "react";
import { Link } from "react-router-dom";
import type { Job } from "@contract/client";
import { useApi } from "@/api/client";
import { startBackfill, type CatalogueType } from "@/api/catalogue";
import { messageOf } from "@/api/errors";
import { pushLog } from "@/app/diagnostics";
import { useJobsStore } from "@/store/jobs";
import { Alert, Button, buttonClass } from "@/ui";

/** F §7.2: after object → defect, offer D6's rule for this type (a `findings_backfill` library job). */
export function BackfillOffer({ type, onDismiss }: { type: CatalogueType; onDismiss: () => void }) {
  const api = useApi();
  const [job, setJob] = useState<Job | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function start() {
    setBusy(true);
    setError(null);
    try {
      const started = await startBackfill(api, type.id);
      useJobsStore.getState().upsert(started);
      setJob(started);
    } catch (e) {
      pushLog(`start backfill failed: ${messageOf(e, String(e))}`);
      setError(messageOf(e, "could not start the backfill"));
    } finally {
      setBusy(false);
    }
  }

  if (job) {
    return (
      <Alert
        tone="ok"
        title="Creating findings in the background"
        onDismiss={onDismiss}
        actions={
          <Link to={`/jobs?project=library&job=${job.id}`} className={buttonClass("secondary", "sm")}>
            Follow in Jobs
          </Link>
        }
      >
        Every recent project is checked in turn. Boxes that already have a finding are skipped.
      </Alert>
    );
  }
  return (
    <Alert
      tone="info"
      title={`${type.name} is now a defect`}
      onDismiss={onDismiss}
      actions={
        <Button size="sm" variant="primary" loading={busy} onClick={() => void start()}>
          Create findings from accepted annotations of this type
        </Button>
      }
    >
      Accepted boxes of this type in your projects can become findings, marked Reviewed with no severity. Nothing
      changes until you choose to.
      {error && (
        <span role="alert" className="mt-1 block text-danger">
          {error}
        </span>
      )}
    </Alert>
  );
}
```

- [ ] **Step 4: Run the component tests to see them pass**

Run: `pnpm -C frontend exec vitest run src/catalogue/ClassificationBanner.test.tsx src/catalogue/BackfillOffer.test.tsx`
Expected: PASS (6 tests).

- [ ] **Step 5: Write the failing screen cases**

Append inside the `describe` of `frontend/src/catalogue/CatalogueScreen.test.tsx`:

```tsx
  it("starts filtered to migrated types while the banner shows, and can show all", async () => {
    renderCatalogue([{ method: "GET", path: /\/catalogue\/types$/, body: exampleCataloguePage }]);
    expect(
      await screen.findByText("2 types came from your existing projects. Mark which are defects."),
    ).toBeInTheDocument();
    expect(screen.getByRole("row", { name: /Excavator/ })).toBeInTheDocument();
    expect(screen.queryByRole("row", { name: /Crack/ })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Show all types" }));
    expect(screen.getByRole("row", { name: /Crack/ })).toBeInTheDocument();
  });

  it("shows the banner from the Overview's link even when the list carries no flag", async () => {
    renderCatalogue([LIST], "/catalogue?origin=migrated");
    expect(
      await screen.findByText("2 types came from your existing projects. Mark which are defects."),
    ).toBeInTheDocument();
    expect(screen.queryByRole("row", { name: /Crack/ })).not.toBeInTheDocument();
  });

  it("offers the backfill after a type becomes a defect", async () => {
    renderCatalogue([
      { method: "GET", path: /\/catalogue\/types$/, body: exampleCataloguePage },
      {
        method: "PATCH",
        path: /\/catalogue\/types\/[^/]+$/,
        body: { ...exampleTypes[0], kind: "defect", backfill_candidates: true },
      },
    ]);
    fireEvent.click(await screen.findByRole("row", { name: /Excavator/ }));
    fireEvent.click(screen.getByRole("radio", { name: "Defect", exact: true }));
    fireEvent.click(screen.getByRole("button", { name: "Save type" }));
    expect(
      await screen.findByRole("button", { name: "Create findings from accepted annotations of this type" }),
    ).toBeInTheDocument();
  });
```

Run: `pnpm -C frontend exec vitest run src/catalogue/CatalogueScreen.test.tsx`
Expected: FAIL. Neither the banner text nor the backfill button is found.

- [ ] **Step 6: Wire the banner and the offer into `TypesPane`**

In `frontend/src/catalogue/TypesPane.tsx`:

1. Add the imports:

   ```tsx
   import { BackfillOffer } from "./BackfillOffer";
   import { migratedCount } from "./catalogueModel";
   import { ClassificationBanner } from "./ClassificationBanner";
   ```

2. Below `const [filters, setFilters] = ...`, add the migrated view and the offer state:

   ```tsx
     // BC's Overview banner links to /catalogue?origin=migrated; the flag may also come from the list.
     const fromBanner = params.get("origin") === "migrated";
     const showBanner = catalogue.needsClassification || fromBanner;
     // null follows the banner: filtered to migrated types while classification is pending (§7.5).
     const [migratedChoice, setMigratedChoice] = useState<boolean | null>(null);
     const migratedOnly = migratedChoice ?? showBanner;
     const [backfill, setBackfill] = useState<CatalogueType | null>(null);
   ```

3. Replace the `rows` line with:

   ```tsx
     const rows = useMemo(
       () => filterTypes(catalogue.types, { ...filters, migratedOnly }),
       [catalogue.types, filters, migratedOnly],
     );
   ```

4. Directly inside the outer `<div className="flex flex-col gap-4">`, before the filters row, add:

   ```tsx
         {showBanner && (
           <ClassificationBanner
             count={migratedCount(catalogue.types)}
             filtered={migratedOnly}
             onShowAll={() => setMigratedChoice(false)}
             onShowMigrated={() => setMigratedChoice(true)}
             onDone={() => {
               setMigratedChoice(false);
               setParams(
                 (p) => {
                   const next = new URLSearchParams(p);
                   next.delete("origin");
                   return next;
                 },
                 { replace: true },
               );
               catalogue.reload();
             }}
           />
         )}
         {backfill && <BackfillOffer key={backfill.id} type={backfill} onDismiss={() => setBackfill(null)} />}
   ```

5. Replace the `onSaved` prop of `<TypeEditor>` with:

   ```tsx
                 onSaved={(t, backfillCandidates) => {
                   catalogue.put(t);
                   if (backfillCandidates) setBackfill(t);
                   open(t.id);
                 }}
   ```

- [ ] **Step 7: Run the catalogue tests to see them pass**

Run: `pnpm -C frontend exec vitest run src/catalogue`
Expected: PASS. The first screen test uses `needs_classification: false`, so its unfiltered list is
unchanged.

- [ ] **Step 8: Lint and commit**

```powershell
pnpm -C frontend lint
git add frontend/src/catalogue/ClassificationBanner.tsx frontend/src/catalogue/ClassificationBanner.test.tsx frontend/src/catalogue/BackfillOffer.tsx frontend/src/catalogue/BackfillOffer.test.tsx frontend/src/catalogue/TypesPane.tsx frontend/src/catalogue/CatalogueScreen.test.tsx
git commit -m "feat(catalogue): classify migrated types and offer the findings backfill

Migrated types start as objects (F4); the banner asks once and object -> defect offers
the findings_backfill library job.

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 5: Severity scale editor, scale sync, and the Catalogue e2e

Load `impeccable`, `emil-design-eng` and `DESIGN.md` first.

**Files:**
- Create: `frontend/src/catalogue/severityModel.ts`, `frontend/src/catalogue/severityModel.test.ts`
- Create: `frontend/src/catalogue/SeverityEditor.tsx`, `frontend/src/catalogue/SeverityEditor.test.tsx`
- Create: `frontend/src/catalogue/severityStore.ts`, `frontend/src/catalogue/useSeverityScaleSync.ts`
- Create: `frontend/src/catalogue/CatalogueSeverityProvider.tsx`, `frontend/src/catalogue/CatalogueSeverityProvider.test.tsx`
- Modify: `frontend/src/catalogue/CatalogueScreen.tsx`, `frontend/src/routes/appRoutes.tsx`
- Modify: `frontend/src/app/Shell.tsx` (wrap its tree: plan decision 18)
- Create: `frontend/e2e/catalogue.spec.ts`

**Interfaces:**
- Consumes:
  - Task 1: `fetchSeverityScale`, `saveSeverityScale`, `severityInUse`, `SeverityInUse`, `SeverityLevel`
  - Task 3: `ColourSwatch`, `CatalogueScreen`
  - DS: `SeverityScaleContext`, `useSeverityScale`
  - Task 6: `fulfilJson`, `CATALOGUE_PAGE`, `SEVERITY`, `BACKFILL_JOB` from `e2e/fixtures/appSections.ts`
- Produces:
  - `severityModel.ts`: `MAX_LEVELS = 9`, `LEVEL_PALETTE`, `PREVIEW_COUNTS`,
    `appendLevel(levels)`, `removeTopLevel(levels)`, `validateLevels(levels): string | null`,
    `toLevels(levels)`, `severityInUseMessage(info, levels): string`
  - `SeverityEditor()`
  - `severityStore.ts`: `useCatalogueSeverity` (zustand: `{levels: SeverityLevel[] | null; setLevels(levels)}`)
  - `useSeverityScaleSync(): void`
  - `CatalogueSeverityProvider({children})`, wrapped around SH's Shell tree
  - `CatalogueTab = "types" | "severity"`, and the route `/catalogue/severity`

- [ ] **Step 1: Write the failing model tests**

Create `frontend/src/catalogue/severityModel.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { exampleSeverity } from "@/test/appSectionFixtures";
import {
  MAX_LEVELS,
  appendLevel,
  removeTopLevel,
  severityInUseMessage,
  toLevels,
  validateLevels,
} from "./severityModel";

describe("severity scale edits (F §7.2)", () => {
  it("appends the next level with a name and a colour", () => {
    const next = appendLevel(exampleSeverity);
    expect(next).toHaveLength(5);
    expect(next[4]).toEqual({ level: 5, name: "Level 5", colour: "#c2185b" });
  });

  it("never grows beyond nine levels and never shrinks below one", () => {
    let levels = exampleSeverity;
    for (let i = 0; i < 10; i += 1) levels = appendLevel(levels);
    expect(levels).toHaveLength(MAX_LEVELS);
    let few = exampleSeverity;
    for (let i = 0; i < 10; i += 1) few = removeTopLevel(few);
    expect(few).toEqual([exampleSeverity[0]]);
  });

  it("refuses blank and duplicate names", () => {
    expect(validateLevels([{ ...exampleSeverity[0], name: " " }])).toBe("Give level 1 a name.");
    expect(validateLevels([exampleSeverity[0], { ...exampleSeverity[1], name: "minor" }])).toBe(
      'Two levels are called "minor". Give each level its own name.',
    );
    expect(validateLevels(exampleSeverity)).toBeNull();
  });

  it("trims names and numbers levels 1..n", () => {
    expect(toLevels([{ level: 7, name: " Low ", colour: "#3fb68e" }])).toEqual([
      { level: 1, name: "Low", colour: "#3fb68e" },
    ]);
  });

  it("names the level and the projects that still use it", () => {
    expect(severityInUseMessage({ level: 4, projects: ["Ahmadia", "Bridge A"] }, exampleSeverity)).toBe(
      "Level 4 (Critical) is still used by open findings in Ahmadia, Bridge A. Regrade or close them, then remove the level.",
    );
    expect(severityInUseMessage({ level: 4, projects: [] }, exampleSeverity)).toBe(
      "Level 4 (Critical) is still used by open findings in an open project. Regrade or close them, then remove the level.",
    );
  });
});
```

Run: `pnpm -C frontend exec vitest run src/catalogue/severityModel.test.ts`
Expected: FAIL with `Failed to resolve import "./severityModel"`.

- [ ] **Step 2: Implement the model**

Create `frontend/src/catalogue/severityModel.ts`:

```ts
import type { SeverityInUse, SeverityLevel } from "@/api/catalogue";

/** Keys 1–9 grade a finding (F §5.6), so the scale has at most nine levels (plan decision 3). */
export const MAX_LEVELS = 9;

/** Colours for appended levels; the first four are D4's defaults (F §4.1). */
export const LEVEL_PALETTE = [
  "#3fb68e",
  "#e2bf2e",
  "#ff9c3a",
  "#ff5a4f",
  "#c2185b",
  "#7b1fa2",
  "#4527a0",
  "#283593",
  "#1565c0",
];

/** Sample open-finding counts for the preview bars, lowest level first. */
export const PREVIEW_COUNTS = [12, 7, 4, 2, 1, 1, 1, 1, 1];

export function appendLevel(levels: SeverityLevel[]): SeverityLevel[] {
  if (levels.length >= MAX_LEVELS) return levels;
  const level = levels.length + 1;
  return [...levels, { level, name: `Level ${level}`, colour: LEVEL_PALETTE[level - 1] }];
}

/** Only the highest level can go (F §7.2); the server refuses it while findings use it. */
export function removeTopLevel(levels: SeverityLevel[]): SeverityLevel[] {
  return levels.length <= 1 ? levels : levels.slice(0, -1);
}

export function validateLevels(levels: SeverityLevel[]): string | null {
  if (levels.length === 0) return "The scale needs at least one level.";
  if (levels.length > MAX_LEVELS) return `The scale has at most ${MAX_LEVELS} levels.`;
  for (const l of levels) {
    if (!l.name.trim()) return `Give level ${l.level} a name.`;
    if (!/^#[0-9a-f]{6}$/i.test(l.colour)) return `Choose a colour for level ${l.level}.`;
  }
  const names = levels.map((l) => l.name.trim().toLowerCase());
  const dupAt = names.findIndex((n, i) => names.indexOf(n) !== i);
  if (dupAt >= 0) return `Two levels are called "${levels[dupAt].name.trim()}". Give each level its own name.`;
  return null;
}

export function toLevels(levels: SeverityLevel[]): SeverityLevel[] {
  return levels.map((l, i) => ({ level: i + 1, name: l.name.trim(), colour: l.colour }));
}

/** 409 `severity_in_use` as a sentence; `levels` is the saved scale, which still has the level. */
export function severityInUseMessage(info: SeverityInUse, levels: SeverityLevel[]): string {
  const name = levels.find((l) => l.level === info.level)?.name;
  const label = name ? `Level ${info.level} (${name})` : `Level ${info.level}`;
  const where = info.projects.length > 0 ? info.projects.join(", ") : "an open project";
  return `${label} is still used by open findings in ${where}. Regrade or close them, then remove the level.`;
}
```

Run: `pnpm -C frontend exec vitest run src/catalogue/severityModel.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 3: Write the failing editor and sync tests**

Create `frontend/src/catalogue/SeverityEditor.test.tsx`:

```tsx
import { beforeEach, describe, expect, it } from "vitest";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import { errorBody, fakeClient, type FakeRoute } from "@/test/fixtures";
import { exampleSeverity } from "@/test/appSectionFixtures";
import { renderWithProviders } from "@/test/render";
import { useSeverityScale } from "@/ui";
import { CatalogueSeverityProvider } from "./CatalogueSeverityProvider";
import { SeverityEditor } from "./SeverityEditor";
import { useCatalogueSeverity } from "./severityStore";

const GET: FakeRoute = { method: "GET", path: /\/catalogue\/severity$/, body: { levels: exampleSeverity } };

function Probe() {
  return <span data-testid="scale">{useSeverityScale().map((l) => l.name).join(",")}</span>;
}

function renderEditor(routes: FakeRoute[]) {
  const { api, requests } = fakeClient(routes);
  renderWithProviders(
    <CatalogueSeverityProvider>
      <SeverityEditor />
      <Probe />
    </CatalogueSeverityProvider>,
    { api },
  );
  return requests;
}

describe("SeverityEditor", () => {
  // The loaded scale is module state: every case starts from "not loaded yet".
  beforeEach(() => useCatalogueSeverity.setState({ levels: null }));

  it("renames a level, saves the whole scale and updates every pill in the app", async () => {
    const requests = renderEditor([
      GET,
      { method: "PUT", path: /\/catalogue\/severity$/, body: (r) => r.body as object },
    ]);
    fireEvent.change(await screen.findByLabelText("Name of level 2"), { target: { value: "Medium" } });
    fireEvent.click(screen.getByRole("button", { name: "Save scale" }));
    expect(await screen.findByText("Severity scale saved")).toBeInTheDocument();
    expect((requests.find((r) => r.method === "PUT")?.body as { levels: { name: string }[] }).levels[1].name).toBe(
      "Medium",
    );
    await waitFor(() => expect(screen.getByTestId("scale")).toHaveTextContent("Minor,Medium,Major,Critical"));
  });

  it("adds levels up to nine and removes only the top one", async () => {
    renderEditor([GET]);
    await screen.findByLabelText("Name of level 4");
    fireEvent.click(screen.getByRole("button", { name: "Add level" }));
    expect(screen.getByLabelText("Name of level 5")).toHaveValue("Level 5");
    fireEvent.click(screen.getByRole("button", { name: "Remove top level" }));
    expect(screen.queryByLabelText("Name of level 5")).not.toBeInTheDocument();
    for (let i = 0; i < 5; i += 1) fireEvent.click(screen.getByRole("button", { name: "Add level" }));
    expect(screen.getByLabelText("Name of level 9")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Add level" })).toBeDisabled();
  });

  it("refuses a duplicate name before sending", async () => {
    const requests = renderEditor([GET]);
    fireEvent.change(await screen.findByLabelText("Name of level 2"), { target: { value: "minor" } });
    fireEvent.click(screen.getByRole("button", { name: "Save scale" }));
    expect(screen.getByText('Two levels are called "minor". Give each level its own name.')).toBeInTheDocument();
    expect(requests.filter((r) => r.method === "PUT")).toHaveLength(0);
  });

  it("names the projects when the top level is still in use, and keeps the drafts", async () => {
    renderEditor([
      GET,
      {
        method: "PUT",
        path: /\/catalogue\/severity$/,
        status: 409,
        body: errorBody("severity_in_use", "in use", { level: 4, projects: ["Ahmadia"] }),
      },
    ]);
    await screen.findByLabelText("Name of level 4");
    fireEvent.click(screen.getByRole("button", { name: "Remove top level" }));
    fireEvent.click(screen.getByRole("button", { name: "Save scale" }));
    expect(
      await screen.findByText(
        "Level 4 (Critical) is still used by open findings in Ahmadia. Regrade or close them, then remove the level.",
      ),
    ).toBeInTheDocument();
    expect(screen.queryByLabelText("Name of level 4")).not.toBeInTheDocument();
    expect(screen.getByTestId("scale")).toHaveTextContent("Minor,Moderate,Major,Critical");
  });

  it("previews the drafts live", async () => {
    renderEditor([GET]);
    fireEvent.change(await screen.findByLabelText("Name of level 4"), { target: { value: "Urgent" } });
    const preview = screen.getByRole("region", { name: "Severity preview" });
    await waitFor(() => expect(preview).toHaveTextContent("Urgent"));
  });
});
```

Create `frontend/src/catalogue/CatalogueSeverityProvider.test.tsx`:

```tsx
import { beforeEach, describe, expect, it } from "vitest";
import { screen } from "@testing-library/react";
import { fakeClient } from "@/test/fixtures";
import { renderWithProviders } from "@/test/render";
import { useSeverityScale } from "@/ui";
import { CatalogueSeverityProvider } from "./CatalogueSeverityProvider";
import { useCatalogueSeverity } from "./severityStore";

function Probe() {
  return <span data-testid="scale">{useSeverityScale().map((l) => l.name).join(",")}</span>;
}

describe("CatalogueSeverityProvider", () => {
  beforeEach(() => useCatalogueSeverity.setState({ levels: null }));

  it("shows DS's default scale until the catalogue answers", () => {
    const { api } = fakeClient([]);
    renderWithProviders(
      <CatalogueSeverityProvider>
        <Probe />
      </CatalogueSeverityProvider>,
      { api },
    );
    expect(screen.getByTestId("scale")).toHaveTextContent("Minor,Moderate,Major,Critical");
  });

  it("feeds the app-wide scale from the catalogue", async () => {
    const { api } = fakeClient([
      {
        method: "GET",
        path: /\/catalogue\/severity$/,
        body: {
          levels: [
            { level: 1, name: "Low", colour: "#3fb68e" },
            { level: 2, name: "High", colour: "#ff5a4f" },
          ],
        },
      },
    ]);
    renderWithProviders(
      <CatalogueSeverityProvider>
        <Probe />
      </CatalogueSeverityProvider>,
      { api },
    );
    expect(await screen.findByText("Low,High")).toBeInTheDocument();
  });
});
```

Run: `pnpm -C frontend exec vitest run src/catalogue/SeverityEditor.test.tsx src/catalogue/CatalogueSeverityProvider.test.tsx`
Expected: FAIL with `Failed to resolve import "./SeverityEditor"` and `"./CatalogueSeverityProvider"`.

- [ ] **Step 4: Implement the store, the sync, the provider and the editor**

Create `frontend/src/catalogue/severityStore.ts`:

```ts
import { create } from "zustand";
import type { SeverityLevel } from "@/api/catalogue";

interface CatalogueSeverityState {
  /** The catalogue's scale; null until the first answer (DS's default scale shows meanwhile). */
  levels: SeverityLevel[] | null;
  setLevels: (levels: SeverityLevel[]) => void;
}

export const useCatalogueSeverity = create<CatalogueSeverityState>((set) => ({
  levels: null,
  setLevels: (levels) => set({ levels }),
}));
```

Create `frontend/src/catalogue/CatalogueSeverityProvider.tsx`:

```tsx
import type { ReactNode } from "react";
import { SeverityScaleContext } from "@/ui";
import { useCatalogueSeverity } from "./severityStore";
import { useSeverityScaleSync } from "./useSeverityScaleSync";

/**
 * DS's severity context fed from the catalogue (DS decision 4, plan decision 18). Until the first
 * answer, or when the catalogue is unavailable, DS's default (D4's four levels) stays in effect.
 */
export function CatalogueSeverityProvider({ children }: { children: ReactNode }) {
  useSeverityScaleSync();
  const levels = useCatalogueSeverity((s) => s.levels);
  return levels ? <SeverityScaleContext.Provider value={levels}>{children}</SeverityScaleContext.Provider> : <>{children}</>;
}
```

Create `frontend/src/catalogue/useSeverityScaleSync.ts`:

```ts
import { useEffect } from "react";
import { useApi } from "@/api/client";
import { fetchSeverityScale } from "@/api/catalogue";
import { messageOf } from "@/api/errors";
import { pushLog } from "@/app/diagnostics";
import { useChangesStore } from "@/store/changes";
import { useCatalogueSeverity } from "./severityStore";

/**
 * Loads the catalogue's scale into `useCatalogueSeverity`: on boot and on every `catalogue.changed`.
 * A failure keeps the last scale (DS's default before the first answer) and is logged.
 */
export function useSeverityScaleSync(): void {
  const api = useApi();
  const revision = useChangesStore((s) => s.catalogueRevision);
  useEffect(() => {
    let cancelled = false;
    fetchSeverityScale(api)
      .then((levels) => {
        if (!cancelled) useCatalogueSeverity.getState().setLevels(levels);
      })
      .catch((e: unknown) => pushLog(`load severity scale failed: ${messageOf(e, String(e))}`));
    return () => {
      cancelled = true;
    };
  }, [api, revision]);
}
```

Create `frontend/src/catalogue/SeverityEditor.tsx`:

```tsx
import { useEffect, useState, type CSSProperties } from "react";
import { useApi } from "@/api/client";
import { fetchSeverityScale, saveSeverityScale, severityInUse, type SeverityLevel } from "@/api/catalogue";
import { messageOf } from "@/api/errors";
import { pushLog } from "@/app/diagnostics";
import { useChangesStore } from "@/store/changes";
import { Alert, Button, GlassPanel, Input, SkeletonRows, cx, transition } from "@/ui";
import { ColourSwatch } from "./ColourSwatch";
import { useCatalogueSeverity } from "./severityStore";
import {
  MAX_LEVELS,
  PREVIEW_COUNTS,
  appendLevel,
  removeTopLevel,
  severityInUseMessage,
  toLevels,
  validateLevels,
} from "./severityModel";

interface Loaded {
  key: string;
  levels: SeverityLevel[] | null;
  error: string | null;
}

/** The Severity sub-tab (F §7.5): an ordered list, Add level, Remove top level, and a live preview. */
export function SeverityEditor() {
  const api = useApi();
  const revision = useChangesStore((s) => s.catalogueRevision);
  const [attempt, setAttempt] = useState(0);
  const key = `${revision}|${attempt}`;
  const [loaded, setLoaded] = useState<Loaded>({ key: "", levels: null, error: null });
  const [status, setStatus] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetchSeverityScale(api)
      .then((levels) => {
        if (!cancelled) setLoaded({ key, levels, error: null });
      })
      .catch((e: unknown) => {
        if (cancelled) return;
        pushLog(`load severity scale failed: ${messageOf(e, String(e))}`);
        setLoaded((s) => ({ key, levels: s.levels, error: messageOf(e, "could not load the severity scale") }));
      });
    return () => {
      cancelled = true;
    };
  }, [api, key]);

  if (loaded.levels === null) {
    return loaded.error ? (
      <Alert
        tone="danger"
        actions={
          <Button size="sm" onClick={() => setAttempt((a) => a + 1)}>
            Retry
          </Button>
        }
      >
        {loaded.error}
      </Alert>
    ) : (
      <SkeletonRows rows={4} columns={3} />
    );
  }
  return (
    <div className="flex flex-col gap-3">
      {status && (
        <Alert tone="ok" role="status" onDismiss={() => setStatus(null)}>
          {status}
        </Alert>
      )}
      <SeverityForm
        key={loaded.key}
        saved={loaded.levels}
        onSaved={(levels) => {
          setLoaded((s) => ({ ...s, levels }));
          setStatus("Severity scale saved");
        }}
        onEdited={() => setStatus(null)}
      />
    </div>
  );
}

function SeverityForm({
  saved,
  onSaved,
  onEdited,
}: {
  saved: SeverityLevel[];
  onSaved: (levels: SeverityLevel[]) => void;
  onEdited: () => void;
}) {
  const api = useApi();
  const [drafts, setDrafts] = useState<SeverityLevel[]>(saved);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const dirty = JSON.stringify(drafts) !== JSON.stringify(saved);

  const edit = (next: (d: SeverityLevel[]) => SeverityLevel[]) => {
    setDrafts(next);
    onEdited();
  };
  const update = (i: number, p: Partial<SeverityLevel>) =>
    edit((ds) => ds.map((d, j) => (j === i ? { ...d, ...p } : d)));

  async function save() {
    const problem = validateLevels(drafts);
    setError(problem);
    if (problem) return;
    setBusy(true);
    try {
      const levels = await saveSeverityScale(api, toLevels(drafts));
      useCatalogueSeverity.getState().setLevels(levels);
      onSaved(levels);
    } catch (e) {
      pushLog(`save severity scale failed: ${messageOf(e, String(e))}`);
      const inUse = severityInUse(e);
      setError(inUse ? severityInUseMessage(inUse, saved) : messageOf(e, "could not save the severity scale"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="grid items-start gap-4 min-[1100px]:grid-cols-[minmax(0,1fr)_340px]">
      <GlassPanel variant="pane" className="flex flex-col gap-4 p-5">
        <ol aria-label="Severity levels" className="flex flex-col gap-2">
          {drafts.map((l, i) => (
            <li key={l.level} className="flex items-center gap-3">
              <span className="w-6 text-right font-mono text-sm tabular-nums text-muted">{l.level}</span>
              <ColourSwatch
                label={`Colour of level ${l.level}`}
                value={l.colour}
                onChange={(colour) => update(i, { colour })}
              />
              <Input
                aria-label={`Name of level ${l.level}`}
                value={l.name}
                onChange={(e) => update(i, { name: e.target.value })}
                className="max-w-xs"
              />
            </li>
          ))}
        </ol>
        <div className="flex flex-wrap gap-2">
          <Button icon="plus" size="sm" disabled={drafts.length >= MAX_LEVELS} onClick={() => edit(appendLevel)}>
            Add level
          </Button>
          <Button size="sm" variant="ghost" disabled={drafts.length <= 1} onClick={() => edit(removeTopLevel)}>
            Remove top level
          </Button>
        </div>
        <p className="text-xs text-muted">
          Only the highest level can be removed, and only while no open finding uses it. Keys 1 to {drafts.length} grade
          a finding.
        </p>
        {error && <Alert tone="danger">{error}</Alert>}
        <div className="flex gap-2">
          <Button variant="primary" loading={busy} disabled={!dirty} onClick={() => void save()}>
            Save scale
          </Button>
          <Button
            variant="ghost"
            disabled={!dirty || busy}
            onClick={() => {
              setDrafts(saved);
              setError(null);
            }}
          >
            Reset
          </Button>
        </div>
      </GlassPanel>
      <SeverityPreview levels={drafts} />
    </div>
  );
}

/** The Overview's severity bars and pills, drawn from the drafts (colours are data: `--c`). */
function SeverityPreview({ levels }: { levels: SeverityLevel[] }) {
  const counts = levels.map((l) => PREVIEW_COUNTS[l.level - 1] ?? 1);
  const max = Math.max(1, ...counts);
  return (
    <GlassPanel variant="pane" className="p-5">
      <section aria-label="Severity preview" className="flex flex-col gap-4">
        <h2 className="text-lg font-semibold">Preview</h2>
        <div className="flex flex-col gap-2.5">
          {[...levels].reverse().map((l) => {
            const n = PREVIEW_COUNTS[l.level - 1] ?? 1;
            return (
              <div
                key={l.level}
                className="grid grid-cols-[5.5rem_1fr_2rem] items-center gap-3 text-xs"
                style={{ "--c": l.colour } as CSSProperties}
              >
                <span className="truncate">{l.name || `Level ${l.level}`}</span>
                <span className="h-2 overflow-hidden rounded-chip bg-surface-2">
                  <span
                    className={cx("block h-full origin-left rounded-chip bg-[var(--c)]", transition)}
                    style={{ transform: `scaleX(${n / max})` }}
                  />
                </span>
                <span className="text-right font-mono tabular-nums text-muted">{n}</span>
              </div>
            );
          })}
        </div>
        <div className="flex flex-wrap gap-2">
          {levels.map((l) => (
            <span
              key={l.level}
              className="inline-flex items-center gap-1.5 rounded-chip bg-surface-2 px-2.5 py-0.5 text-2xs font-semibold"
              style={{ "--c": l.colour } as CSSProperties}
            >
              <span aria-hidden className="h-2 w-2 rounded-chip bg-[var(--c)]" />
              {l.name || `Level ${l.level}`}
            </span>
          ))}
        </div>
      </section>
    </GlassPanel>
  );
}
```

Run: `pnpm -C frontend exec vitest run src/catalogue/SeverityEditor.test.tsx src/catalogue/CatalogueSeverityProvider.test.tsx`
Expected: PASS (7 tests).

- [ ] **Step 5: Add the Severity sub-tab, its route and the app-wide provider**

In `frontend/src/catalogue/CatalogueScreen.tsx`:

1. Change the tab type and the tabs:

   ```tsx
   export type CatalogueTab = "types" | "severity";

   const TABS = [
     { id: "types", to: "/catalogue", label: "Types", end: true },
     { id: "severity", to: "/catalogue/severity", label: "Severity" },
   ];
   ```

2. Import the editor: `import { SeverityEditor } from "./SeverityEditor";`

3. Replace the final `: (<TypesPane catalogue={catalogue} />)` branch with:

   ```tsx
         ) : tab === "types" ? (
           <TypesPane catalogue={catalogue} />
         ) : (
           <SeverityEditor />
         )}
   ```

In `frontend/src/routes/appRoutes.tsx`, replace SH's `{ path: "catalogue/severity", element: catalogue }`
placeholder entry with the entry below. Then delete SH's now-unused `const catalogue = (…)`
placeholder element. Keep `SectionPlaceholder` imported while `datasets` and `training` still use it.

```tsx
  {
    path: "catalogue/severity",
    element: (
      <Later>
        <CatalogueScreen tab="severity" />
      </Later>
    ),
  },
```

In `frontend/src/app/Shell.tsx` (plan decision 18):

1. Add the import: `import { CatalogueSeverityProvider } from "@/catalogue/CatalogueSeverityProvider";`
2. Wrap the element that `Shell` returns: `return (<CatalogueSeverityProvider>…the existing tree…</CatalogueSeverityProvider>);`.
   The provider renders no DOM of its own, so layout and SH's tests are unchanged.

Then add one screen test to `CatalogueScreen.test.tsx`, and add `exampleSeverity` to its
`@/test/appSectionFixtures` import:

```tsx
  it("shows the severity editor on the Severity tab", async () => {
    const { api } = fakeClient([
      LIST,
      { method: "GET", path: /\/catalogue\/severity$/, body: { levels: exampleSeverity } },
    ]);
    renderWithProviders(<CatalogueScreen tab="severity" />, { api, route: "/catalogue/severity", path: "/catalogue/severity" });
    expect(await screen.findByLabelText("Name of level 1")).toHaveValue("Minor");
  });
```

Run: `pnpm -C frontend exec vitest run src/catalogue src/app/Shell.test.tsx`
Expected: PASS. If `Shell.test.tsx` fails with `no fake route for GET /api/v1/catalogue/severity`,
that is only a logged failure (`pushLog`), not an assertion. If one of its assertions reads the
diagnostics log, add
`{ method: "GET", path: /\/catalogue\/severity$/, body: { levels: exampleSeverity } }` to that test's
fake routes.

- [ ] **Step 6: Write the Catalogue e2e**

The fixtures `CATALOGUE_PAGE`, `SEVERITY` and `BACKFILL_JOB` are in `e2e/fixtures/appSections.ts`
(Task 6).

Create `frontend/e2e/catalogue.spec.ts`:

```ts
import { expect, test } from "@playwright/test";
import { BACKFILL_JOB, CATALOGUE_PAGE, SEVERITY, fulfilJson } from "./fixtures/appSections";

test("the Catalogue classifies a migrated type, offers the backfill and edits the severity scale", async ({
  page,
}) => {
  await page.route(
    (url) => url.pathname === "/api/v1/catalogue/types",
    (route) => fulfilJson(route, CATALOGUE_PAGE),
  );
  await page.route(
    (url) => /^\/api\/v1\/catalogue\/types\/[^/]+$/.test(url.pathname),
    (route) => fulfilJson(route, { ...CATALOGUE_PAGE.items[0], kind: "defect", backfill_candidates: true }),
  );
  await page.route(
    (url) => url.pathname.endsWith("/backfill"),
    (route) => fulfilJson(route, { job: BACKFILL_JOB }, 202),
  );
  await page.route(
    (url) => url.pathname === "/api/v1/catalogue/severity",
    (route) =>
      fulfilJson(route, {
        levels: route.request().method() === "PUT" ? (route.request().postDataJSON() as { levels: unknown }).levels : SEVERITY,
      }),
  );

  await page.goto("/catalogue");
  await expect(page.getByRole("heading", { name: "Catalogue", exact: true })).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText("2 types came from your existing projects. Mark which are defects.")).toBeVisible();

  await page.getByRole("row", { name: /Excavator/ }).click();
  await page.getByRole("radio", { name: "Defect", exact: true }).click();
  const patch = page.waitForRequest((r) => r.method() === "PATCH");
  await page.getByRole("button", { name: "Save type" }).click();
  expect((await patch).postDataJSON()).toEqual({ kind: "defect" });

  const backfill = page.waitForRequest((r) => r.method() === "POST" && r.url().endsWith("/backfill"));
  await page.getByRole("button", { name: "Create findings from accepted annotations of this type" }).click();
  await backfill;
  await expect(page.getByRole("link", { name: "Follow in Jobs" })).toHaveAttribute(
    "href",
    "/jobs?project=library&job=j-backfill",
  );

  await page.goto("/catalogue/severity");
  await page.getByRole("button", { name: "Add level" }).click();
  await page.getByLabel("Name of level 5").fill("Emergency");
  const put = page.waitForRequest((r) => r.method() === "PUT" && r.url().endsWith("/catalogue/severity"));
  await page.getByRole("button", { name: "Save scale" }).click();
  expect(((await put).postDataJSON() as { levels: unknown[] }).levels).toHaveLength(5);
  await expect(page.getByText("Severity scale saved")).toBeVisible();
});
```

Run: `$env:E2E_WEB_PORT=1520; $env:E2E_MOCK_PORT=4110; pnpm -C frontend exec playwright test e2e/catalogue.spec.ts`
Expected: 1 passed. The free ports keep the run off another checkout's dev servers.

- [ ] **Step 7: Lint, build and commit**

```powershell
pnpm -C frontend lint; pnpm -C frontend build
git add frontend/src/catalogue/severityModel.ts frontend/src/catalogue/severityModel.test.ts frontend/src/catalogue/SeverityEditor.tsx frontend/src/catalogue/SeverityEditor.test.tsx frontend/src/catalogue/severityStore.ts frontend/src/catalogue/useSeverityScaleSync.ts frontend/src/catalogue/CatalogueSeverityProvider.tsx frontend/src/catalogue/CatalogueSeverityProvider.test.tsx frontend/src/catalogue/CatalogueScreen.tsx frontend/src/catalogue/CatalogueScreen.test.tsx frontend/src/routes/appRoutes.tsx frontend/src/app/Shell.tsx frontend/e2e/catalogue.spec.ts
git commit -m "feat(catalogue): severity scale editor with live preview, app-wide scale sync, e2e

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 6: Jobs section

Load `impeccable`, `emil-design-eng` and `DESIGN.md` first.

**Files:**
- Create: `frontend/src/api/appJobs.ts`, `frontend/src/api/appJobs.test.ts`
- Create: `frontend/src/api/recentProjects.ts`, `frontend/src/api/recentProjects.test.tsx`
- Create: `frontend/src/jobs/jobsFilters.ts`, `frontend/src/jobs/jobsFilters.test.ts`
- Create: `frontend/src/jobs/useAppJobs.ts`, `frontend/src/jobs/useAppJobs.test.tsx`
- Create: `frontend/src/jobs/JobInspector.tsx`
- Create: `frontend/src/jobs/JobsScreen.tsx`, `frontend/src/jobs/JobsScreen.test.tsx`
- Modify: `frontend/src/jobs/jobLabels.ts`, `frontend/src/jobs/jobLabels.test.ts`, `frontend/src/jobs/JobCard.tsx` (`TYPE_ICON` only if an entry is missing)
- Delete (if unused): SH's `frontend/src/app/InterimJobs.tsx`, `frontend/src/app/InterimJobs.test.tsx`
- Create: `frontend/src/jobs/appJobLabels.test.ts`
- Modify: `frontend/src/routes/appRoutes.tsx`
- Create: `frontend/e2e/fixtures/appSections.ts`
- Modify (rewrite): `frontend/e2e/jobs.spec.ts`

**Interfaces:**
- Consumes:
  - `fetchJobLog`, `cancelJob` (route on `project_id === "library"`), `JobLogView`, `useNow`
  - `jobTitle`, `stateLabel`, `elapsedSeconds`, `formatDuration`, `resultTarget`
  - `useJobsStore`, `isActiveJob`, `formatLocalDate`
  - DS: `DataTable`, `InspectorPane`, `InspectorSection`, `GlassPanel`
- Produces:
  - `api/appJobs.ts`: `AppJob`, `AppJobQuery`, `AppJobPage`, `APP_JOBS_PAGE = 50`,
    `fetchAppJobs(api, q): Promise<AppJobPage>`
  - `api/recentProjects.ts`: `fetchRecentProjects(api): Promise<Project[]>`,
    `useRecentProjects(): {projects; loading; error}`. Tasks 10 and 15 reuse it.
  - `jobs/jobsFilters.ts`:
    - `JobSegment`, `SEGMENTS`, `SEGMENT_STATES`, `LIBRARY_FILTER = "library"`, `JOB_STATE_TONE`
    - `JobsView {segment; project; jobId}`
    - `readJobsView(params)`, `jobsViewParams(view)`, `inSegment(segment, state)`, `mergeJobs(a, b)`
    - `projectLabel(job)`
  - `jobs/useAppJobs.ts`: `APP_JOBS_POLL_MS = 5000`,
    `useAppJobs(segment, project): AppJobsList {rows; find(id); loading; error; hasMore; loadMore(); reload()}`,
    `useActiveJobCounts(project): {running; queued}`
  - `JobsScreen()` at `/jobs`, reading `?state=`, `?project=` and `?job=`
  - `resultTarget` links for `train`, `library_*`, `dataset`, `dataset_build`, `findings_backfill`,
    `project_migrate` and `findings_recount`

- [ ] **Step 1: Confirm the job-type maps are complete**

Run: `Select-String -Path frontend\src\jobs\jobLabels.ts,frontend\src\jobs\JobCard.tsx -Pattern 'project_migrate','findings_backfill','findings_recount','dataset_build' | Select-Object Path,Line`

Expected: each of the four types appears in both files. C0 had to add them to the
`Record<Job["type"], …>` maps to keep `tsc` green. If `JobCard.tsx` lacks one, add it to `TYPE_ICON`
as `project_migrate: "refresh"`, `findings_backfill: "findings"`, `findings_recount: "findings"` or
`dataset_build: "datasets"`.

- [ ] **Step 2: Write the failing API and filter tests**

Create `frontend/src/api/appJobs.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { fakeClient } from "@/test/fixtures";
import { exampleAppJobs } from "@/test/appSectionFixtures";
import { fetchAppJobs } from "./appJobs";

describe("fetchAppJobs", () => {
  it("asks for one page with exploded states and a project filter", async () => {
    const { api, requests } = fakeClient([
      { method: "GET", path: /\/api\/v1\/jobs$/, body: { items: exampleAppJobs, next_cursor: "c2" } },
    ]);
    const page = await fetchAppJobs(api, { state: ["succeeded", "cancelled"], project_id: "library" });
    expect(page.items).toHaveLength(3);
    expect(page.next_cursor).toBe("c2");
    expect(requests[0].url).toContain("state=succeeded&state=cancelled");
    expect(requests[0].url).toContain("project_id=library");
    expect(requests[0].url).toContain("limit=50");
  });
});
```

Create `frontend/src/api/recentProjects.test.tsx`:

```tsx
import type { ReactNode } from "react";
import { describe, expect, it } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import type { ApiClient } from "@contract/client";
import { exampleProject, fakeClient } from "@/test/fixtures";
import { TestApiProvider } from "@/test/render";
import { fetchRecentProjects, useRecentProjects } from "./recentProjects";

describe("recent projects", () => {
  it("follows pages of GET /projects", async () => {
    const { api } = fakeClient([
      {
        method: "GET",
        path: /\/api\/v1\/projects$/,
        body: (r) =>
          r.url.includes("cursor=c2")
            ? { items: [{ ...exampleProject, id: "p2", name: "Bridge A" }], next_cursor: null }
            : { items: [exampleProject], next_cursor: "c2" },
      },
    ]);
    expect((await fetchRecentProjects(api)).map((p) => p.name)).toEqual(["Ahmadia", "Bridge A"]);
  });

  it("loads them in a hook", async () => {
    const { api } = fakeClient([
      { method: "GET", path: /\/api\/v1\/projects$/, body: { items: [exampleProject], next_cursor: null } },
    ]);
    const wrapper = ({ children }: { children: ReactNode }) => (
      <TestApiProvider api={api as ApiClient}>{children}</TestApiProvider>
    );
    const { result } = renderHook(() => useRecentProjects(), { wrapper });
    await waitFor(() => expect(result.current.projects).toHaveLength(1));
    expect(result.current.loading).toBe(false);
  });
});
```

Create `frontend/src/jobs/jobsFilters.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { exampleAppJobs } from "@/test/appSectionFixtures";
import { inSegment, jobsViewParams, mergeJobs, projectLabel, readJobsView } from "./jobsFilters";

describe("jobs view <-> URL", () => {
  it("defaults to Running with no project and no open job", () => {
    expect(readJobsView(new URLSearchParams(""))).toEqual({ segment: "running", project: null, jobId: null });
  });

  it("reads state, project and job, and ignores an unknown state", () => {
    expect(readJobsView(new URLSearchParams("state=failed&project=library&job=j1"))).toEqual({
      segment: "failed",
      project: "library",
      jobId: "j1",
    });
    expect(readJobsView(new URLSearchParams("state=toString")).segment).toBe("running");
  });

  it("writes only what differs from the defaults", () => {
    expect(jobsViewParams({ segment: "running", project: null, jobId: null }).toString()).toBe("");
    expect(jobsViewParams({ segment: "finished", project: "p1", jobId: "j1" }).toString()).toBe(
      "state=finished&project=p1&job=j1",
    );
  });
});

describe("segments", () => {
  it("puts succeeded and cancelled under Finished", () => {
    expect(inSegment("finished", "succeeded")).toBe(true);
    expect(inSegment("finished", "cancelled")).toBe(true);
    expect(inSegment("finished", "failed")).toBe(false);
    expect(inSegment("running", "queued")).toBe(false);
  });
});

describe("mergeJobs", () => {
  it("lets the newer copy win and keeps newest first", () => {
    const [a, b, c] = exampleAppJobs;
    const merged = mergeJobs([b, c], [{ ...b, progress: 1 }, a]);
    expect(merged.map((j) => j.id)).toEqual([a.id, b.id, c.id]);
    expect(merged[1].progress).toBe(1);
  });
});

describe("projectLabel", () => {
  it("names library jobs and falls back when the name is unknown", () => {
    expect(projectLabel(exampleAppJobs[0])).toBe("Ahmadia");
    expect(projectLabel(exampleAppJobs[1])).toBe("Model library");
    expect(projectLabel({ ...exampleAppJobs[0], project_name: null })).toBe("Project");
  });
});
```

Run: `pnpm -C frontend exec vitest run src/api/appJobs.test.ts src/api/recentProjects.test.tsx src/jobs/jobsFilters.test.ts`
Expected: FAIL with `Failed to resolve import` for `./appJobs`, `./recentProjects` and `./jobsFilters`.

- [ ] **Step 3: Implement the API wrappers and the filters**

Create `frontend/src/api/appJobs.ts`:

```ts
import type { ApiClient, JobState, components } from "@contract/client";
import { unwrap } from "./errors";

/** A job from any runner: `Job` plus the project's name, null for library jobs (F §10.1). */
export type AppJob = components["schemas"]["AppJob"];

export const APP_JOBS_PAGE = 50;

export interface AppJobQuery {
  state?: JobState[];
  /** A project id, or `library` for library jobs. */
  project_id?: string;
  limit?: number;
  cursor?: string;
}

export interface AppJobPage {
  items: AppJob[];
  next_cursor: string | null;
}

/** One keyset page of `GET /jobs`, newest first. */
export async function fetchAppJobs(api: ApiClient, q: AppJobQuery = {}): Promise<AppJobPage> {
  const r = await unwrap(
    api.GET("/api/v1/jobs", {
      params: {
        query: {
          limit: q.limit ?? APP_JOBS_PAGE,
          ...(q.state && q.state.length > 0 ? { state: q.state } : {}),
          ...(q.project_id ? { project_id: q.project_id } : {}),
          ...(q.cursor ? { cursor: q.cursor } : {}),
        },
      },
    }),
  );
  return { items: r.items, next_cursor: r.next_cursor ?? null };
}
```

Create `frontend/src/api/recentProjects.ts`:

```ts
import { useEffect, useState } from "react";
import type { ApiClient, Project } from "@contract/client";
import { pushLog } from "@/app/diagnostics";
import { useApi } from "./client";
import { messageOf, unwrap } from "./errors";
import { collectPages } from "./paging";

/** The recent projects (the backend caps the list at `MAX_RECENT = 20`). */
export function fetchRecentProjects(api: ApiClient): Promise<Project[]> {
  return collectPages((cursor) =>
    unwrap(api.GET("/api/v1/projects", { params: { query: cursor ? { cursor } : {} } })),
  );
}

export function useRecentProjects(): { projects: Project[]; loading: boolean; error: string | null } {
  const api = useApi();
  const [state, setState] = useState<{ done: boolean; projects: Project[]; error: string | null }>({
    done: false,
    projects: [],
    error: null,
  });
  useEffect(() => {
    let cancelled = false;
    fetchRecentProjects(api)
      .then((projects) => {
        if (!cancelled) setState({ done: true, projects, error: null });
      })
      .catch((e: unknown) => {
        if (cancelled) return;
        pushLog(`list recent projects failed: ${messageOf(e, String(e))}`);
        setState({ done: true, projects: [], error: messageOf(e, "could not list the projects") });
      });
    return () => {
      cancelled = true;
    };
  }, [api]);
  return { projects: state.projects, loading: !state.done, error: state.error };
}
```

Create `frontend/src/jobs/jobsFilters.ts`:

```ts
import type { JobState } from "@contract/client";
import type { AppJob } from "@/api/appJobs";
import type { PillTone } from "@/ui";

/** The state pill's tone, as the job card uses it. */
export const JOB_STATE_TONE: Record<JobState, PillTone> = {
  queued: "neutral",
  running: "accent",
  succeeded: "ok",
  failed: "danger",
  cancelled: "neutral",
};

export type JobSegment = "running" | "queued" | "finished" | "failed";

export const SEGMENTS: JobSegment[] = ["running", "queued", "finished", "failed"];

/** Plan decision 4: Finished holds succeeded and cancelled jobs. */
export const SEGMENT_STATES: Record<JobSegment, JobState[]> = {
  running: ["running"],
  queued: ["queued"],
  finished: ["succeeded", "cancelled"],
  failed: ["failed"],
};

/** `Job.project_id` of library jobs, and the `?project=` value that selects them. */
export const LIBRARY_FILTER = "library";

export interface JobsView {
  segment: JobSegment;
  project: string | null;
  jobId: string | null;
}

export function readJobsView(params: URLSearchParams): JobsView {
  const s = params.get("state");
  const segment = SEGMENTS.find((x) => x === s) ?? "running";
  return { segment, project: params.get("project") || null, jobId: params.get("job") || null };
}

export function jobsViewParams(v: JobsView): URLSearchParams {
  const p = new URLSearchParams();
  if (v.segment !== "running") p.set("state", v.segment);
  if (v.project) p.set("project", v.project);
  if (v.jobId) p.set("job", v.jobId);
  return p;
}

export function inSegment(segment: JobSegment, state: JobState): boolean {
  return SEGMENT_STATES[segment].includes(state);
}

/** By id, `incoming` wins; newest first by `created_at`, then id, as the API orders them. */
export function mergeJobs(current: AppJob[], incoming: AppJob[]): AppJob[] {
  const byId = new Map(current.map((j) => [j.id, j]));
  for (const j of incoming) byId.set(j.id, j);
  return [...byId.values()].sort((a, b) => b.created_at.localeCompare(a.created_at) || b.id.localeCompare(a.id));
}

export function projectLabel(job: Pick<AppJob, "project_id" | "project_name">): string {
  if (job.project_id === LIBRARY_FILTER) return "Model library";
  return job.project_name ?? "Project";
}
```

Run: `pnpm -C frontend exec vitest run src/api/appJobs.test.ts src/api/recentProjects.test.tsx src/jobs/jobsFilters.test.ts`
Expected: PASS (8 tests).

- [ ] **Step 4: Write the failing hook test**

Create `frontend/src/jobs/useAppJobs.test.tsx`:

```tsx
import type { ReactNode } from "react";
import { describe, expect, it } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";
import type { ApiClient } from "@contract/client";
import { fakeClient } from "@/test/fixtures";
import { exampleAppJobs } from "@/test/appSectionFixtures";
import { TestApiProvider } from "@/test/render";
import { useAppJobs } from "./useAppJobs";

const wrapper =
  (api: ApiClient) =>
  ({ children }: { children: ReactNode }) => <TestApiProvider api={api}>{children}</TestApiProvider>;

describe("useAppJobs", () => {
  it("loads more pages on demand and stops on a repeated cursor", async () => {
    const [, done, failed] = exampleAppJobs;
    const { api, requests } = fakeClient([
      {
        method: "GET",
        path: /\/api\/v1\/jobs$/,
        body: (r) =>
          r.url.includes("cursor=")
            ? { items: [{ ...failed, state: "succeeded" }], next_cursor: "string" }
            : { items: [done], next_cursor: "string" },
      },
    ]);
    const { result } = renderHook(() => useAppJobs("finished", null), { wrapper: wrapper(api) });
    await waitFor(() => expect(result.current.rows).toHaveLength(1));
    expect(result.current.hasMore).toBe(true);
    act(() => result.current.loadMore());
    await waitFor(() => expect(result.current.rows).toHaveLength(2));
    expect(result.current.hasMore).toBe(false);
    expect(requests.filter((r) => r.url.includes("cursor="))).toHaveLength(1);
  });
});
```

Run: `pnpm -C frontend exec vitest run src/jobs/useAppJobs.test.tsx`
Expected: FAIL with `Failed to resolve import "./useAppJobs"`.

- [ ] **Step 5: Implement `useAppJobs` and `useActiveJobCounts`**

Create `frontend/src/jobs/useAppJobs.ts`:

```ts
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useApi } from "@/api/client";
import { fetchAppJobs, type AppJob } from "@/api/appJobs";
import { messageOf } from "@/api/errors";
import { pushLog } from "@/app/diagnostics";
import { useJobsStore } from "@/store/jobs";
import { SEGMENT_STATES, inSegment, mergeJobs, type JobSegment } from "./jobsFilters";

export const APP_JOBS_POLL_MS = 5000;
/** Running + queued jobs are few; one bounded page counts them. */
export const ACTIVE_COUNT_LIMIT = 100;

export interface AppJobsList {
  /** Loaded jobs of this segment, live from the jobs store (WebSocket). */
  rows: AppJob[];
  /** A loaded job by id even after it left the segment, else the store's copy. */
  find: (id: string) => AppJob | null;
  loading: boolean;
  error: string | null;
  hasMore: boolean;
  loadMore: () => void;
  reload: () => void;
}

interface State {
  key: string;
  items: AppJob[];
  cursor: string | null;
  /** Once a later page is loaded, polling page one must not reset the cursor. */
  paged: boolean;
  error: string | null;
}

const INITIAL: State = { key: "", items: [], cursor: null, paged: false, error: null };

/**
 * `GET /jobs` for one segment and project filter. Page one is polled every 5 s and merged by id
 * (new jobs appear, finished ones update); later pages load on `loadMore` (the table's end).
 * Rows come through `store/jobs.ts`, so WebSocket progress and state changes show at once, and a
 * job that leaves the segment leaves the list without waiting for the next poll.
 */
export function useAppJobs(segment: JobSegment, project: string | null): AppJobsList {
  const api = useApi();
  const [attempt, setAttempt] = useState(0);
  const key = `${segment}|${project ?? ""}|${attempt}`;
  const [state, setState] = useState<State>(INITIAL);
  const loadingMore = useRef(false);

  useEffect(() => {
    let cancelled = false;
    let failed = false;
    const tick = () => {
      fetchAppJobs(api, { state: SEGMENT_STATES[segment], project_id: project ?? undefined })
        .then((page) => {
          if (cancelled) return;
          failed = false;
          useJobsStore.getState().upsertMany(page.items);
          setState((s) =>
            s.key === key
              ? { ...s, items: mergeJobs(s.items, page.items), cursor: s.paged ? s.cursor : page.next_cursor, error: null }
              : { key, items: page.items, cursor: page.next_cursor, paged: false, error: null },
          );
        })
        .catch((e: unknown) => {
          if (cancelled) return;
          if (!failed) pushLog(`list app jobs failed: ${messageOf(e, String(e))}`);
          failed = true;
          const error = messageOf(e, "could not load the jobs");
          setState((s) => (s.key === key ? { ...s, error } : { ...INITIAL, key, error }));
        });
    };
    tick();
    const id = window.setInterval(tick, APP_JOBS_POLL_MS);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, [api, key, segment, project]);

  const cursor = state.key === key ? state.cursor : null;
  const loadMore = useCallback(() => {
    if (!cursor || loadingMore.current) return;
    loadingMore.current = true;
    fetchAppJobs(api, { state: SEGMENT_STATES[segment], project_id: project ?? undefined, cursor })
      .then((page) => {
        useJobsStore.getState().upsertMany(page.items);
        setState((s) =>
          s.key === key
            ? {
                ...s,
                items: mergeJobs(s.items, page.items),
                // The Prism mock repeats its cursor forever; a repeat means there is no more.
                cursor: page.next_cursor === cursor ? null : page.next_cursor,
                paged: true,
              }
            : s,
        );
      })
      .catch((e: unknown) => pushLog(`load more jobs failed: ${messageOf(e, String(e))}`))
      .finally(() => {
        loadingMore.current = false;
      });
  }, [api, key, segment, project, cursor]);

  const live = useJobsStore((s) => s.jobs);
  const merged = useMemo(
    () => (state.key === key ? state.items : []).map((j) => ({ ...j, ...live[j.id] }) as AppJob),
    [state.key, state.items, key, live],
  );
  const rows = useMemo(() => merged.filter((j) => inSegment(segment, j.state)), [merged, segment]);
  const find = useCallback(
    (id: string) => merged.find((j) => j.id === id) ?? (live[id] as AppJob | undefined) ?? null,
    [merged, live],
  );
  const reload = useCallback(() => setAttempt((a) => a + 1), []);

  return {
    rows,
    find,
    loading: state.key !== key,
    error: state.key === key ? state.error : null,
    hasMore: cursor !== null,
    loadMore,
    reload,
  };
}

/** The Running and Queued counts (plan decision 4), polled with the list. */
export function useActiveJobCounts(project: string | null): { running: number; queued: number } {
  const api = useApi();
  const [ids, setIds] = useState<string[]>([]);
  useEffect(() => {
    let cancelled = false;
    const tick = () => {
      fetchAppJobs(api, { state: ["running", "queued"], project_id: project ?? undefined, limit: ACTIVE_COUNT_LIMIT })
        .then((page) => {
          if (cancelled) return;
          useJobsStore.getState().upsertMany(page.items);
          setIds(page.items.map((j) => j.id));
        })
        .catch((e: unknown) => pushLog(`count active jobs failed: ${messageOf(e, String(e))}`));
    };
    tick();
    const id = window.setInterval(tick, APP_JOBS_POLL_MS);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, [api, project]);
  const jobs = useJobsStore((s) => s.jobs);
  return useMemo(() => {
    let running = 0;
    let queued = 0;
    for (const id of ids) {
      const state = jobs[id]?.state;
      if (state === "running") running += 1;
      else if (state === "queued") queued += 1;
    }
    return { running, queued };
  }, [ids, jobs]);
}
```

Run: `pnpm -C frontend exec vitest run src/jobs/useAppJobs.test.tsx`
Expected: PASS (1 test).

- [ ] **Step 6: Write the failing result-link tests and update the old expectations**

Create `frontend/src/jobs/appJobLabels.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import type { Job } from "@contract/client";
import { runningJob } from "@/test/fixtures";
import { jobTitle, resultTarget } from "./jobLabels";

const done = (patch: Partial<Job>): Job => ({ ...runningJob, params: {}, result: null, ...patch, state: "succeeded" });

describe("result links after the Models and Catalogue sections (F §5.3)", () => {
  it.each<[Partial<Job>, { label: string; to: string }]>([
    [{ type: "train", result: { model_id: "m1" } }, { label: "Open model", to: "/models/library?model=m1" }],
    [{ type: "library_import", result: { model_id: "m1" } }, { label: "Open model", to: "/models/library?model=m1" }],
    [{ type: "library_adopt" }, { label: "Open library", to: "/models/library" }],
    [{ type: "dataset_build", result: { dataset_id: "d1" } }, { label: "Open dataset", to: "/models/datasets/d1" }],
    [{ type: "dataset", params: { dataset_id: "d1" } }, { label: "Open dataset", to: "/models/datasets/d1" }],
    [{ type: "dataset" }, { label: "Open datasets", to: "/models/datasets" }],
    [{ type: "findings_backfill" }, { label: "Open catalogue", to: "/catalogue" }],
    [{ type: "project_migrate" }, { label: "Open projects", to: "/projects" }],
    [{ type: "findings_recount" }, { label: "Open findings", to: "/p/p/findings" }],
  ])("%o links to %o", (patch, target) => {
    expect(resultTarget(done(patch), "p")).toEqual(target);
  });

  it("titles the foundation job types", () => {
    expect(jobTitle({ ...runningJob, type: "dataset_build", params: { name: "machines-v1" } })).toBe(
      "Dataset build: machines-v1",
    );
    expect(jobTitle({ ...runningJob, type: "dataset", params: {} })).toBe("Dataset export");
    expect(jobTitle({ ...runningJob, type: "project_migrate", params: {} })).toBe("Project upgrade");
    expect(jobTitle({ ...runningJob, type: "findings_backfill", params: {} })).toBe("Findings from annotations");
    expect(jobTitle({ ...runningJob, type: "findings_recount", params: {} })).toBe("Findings recount");
  });
});
```

Run: `pnpm -C frontend exec vitest run src/jobs/appJobLabels.test.ts`
Expected: FAIL. At least the `/models/library?model=m1`, `dataset_build` and `dataset` rows differ.

- [ ] **Step 7: Update `jobLabels.ts`**

In `frontend/src/jobs/jobLabels.ts`:

1. Set these `TYPE_LABEL` entries (add or overwrite):

   ```ts
     dataset: "Dataset export",
     dataset_build: "Dataset build",
     project_migrate: "Project upgrade",
     findings_backfill: "Findings from annotations",
     findings_recount: "Findings recount",
   ```

2. Replace the `model` helper line in `resultTarget` with:

   ```ts
     const model = (id: string | null) => (id ? { label: "Open model", to: `/models/library?model=${id}` } : null);
   ```

3. Replace the `library_adopt` case body with `return { label: "Open library", to: "/models/library" };`.

4. Replace the `case "dataset":` case with:

   ```ts
       case "dataset":
       case "dataset_build": {
         const id = str(job.result, "dataset_id") ?? str(job.params, "dataset_id");
         return id ? { label: "Open dataset", to: `/models/datasets/${id}` } : { label: "Open datasets", to: "/models/datasets" };
       }
       case "findings_backfill":
         return { label: "Open catalogue", to: "/catalogue" };
       case "project_migrate":
         return { label: "Open projects", to: "/projects" };
       case "findings_recount":
         return { label: "Open findings", to: `${p}/findings` };
   ```

   If C0 already added cases for `dataset_build`, `findings_backfill`, `project_migrate` or
   `findings_recount`, delete those cases so the switch has one case per type.

Run: `pnpm -C frontend exec vitest run src/jobs`
Expected: `appJobLabels.test.ts` passes. `jobLabels.test.ts` may fail on the old expectations. Update
exactly those in `frontend/src/jobs/jobLabels.test.ts`:
- `"/library?model=` → `"/models/library?model=`
- `to: "/library"` → `to: "/models/library"`
- `{ label: "Train on it", to: "/p/p/train" }` (or the same with another project id) →
  `{ label: "Open datasets", to: "/models/datasets" }`
- the `dataset` title `"Dataset"` → `"Dataset export"`

Run it again. Expected: PASS.

- [ ] **Step 8: Write the failing screen tests**

Create `frontend/src/jobs/JobsScreen.test.tsx`:

```tsx
import { beforeEach, describe, expect, it } from "vitest";
import { act, fireEvent, screen, waitFor } from "@testing-library/react";
import type { AppEvent } from "@contract/client";
import { exampleJobLog, exampleProject, fakeClient, JOB_ID, PROJECT_ID, runningJob, type FakeRoute } from "@/test/fixtures";
import { exampleAppJobs, LIB_JOB_ID } from "@/test/appSectionFixtures";
import { renderWithProviders } from "@/test/render";
import { useJobsStore } from "@/store/jobs";
import { JobsScreen } from "./JobsScreen";

function jobsRoute(items = exampleAppJobs): FakeRoute {
  return {
    method: "GET",
    path: /\/api\/v1\/jobs$/,
    body: (r) => {
      const states = new URL(`http://x${r.url}`).searchParams.getAll("state");
      return { items: items.filter((j) => states.length === 0 || states.includes(j.state)), next_cursor: null };
    },
  };
}

const PROJECTS: FakeRoute = {
  method: "GET",
  path: /\/api\/v1\/projects$/,
  body: { items: [exampleProject], next_cursor: null },
};
const LOG: FakeRoute = { method: "GET", path: /\/jobs\/[^/]+\/log$/, body: exampleJobLog };

function renderJobs(route = "/jobs", routes: FakeRoute[] = [jobsRoute(), PROJECTS, LOG]) {
  const { api, requests } = fakeClient(routes);
  renderWithProviders(<JobsScreen />, { api, route, path: "/jobs" });
  return requests;
}

describe("JobsScreen", () => {
  // The jobs store is module state: start every case from an empty store.
  beforeEach(() => useJobsStore.setState({ jobs: {} }));

  it("shows running jobs with their project, and counts running and queued", async () => {
    renderJobs();
    const row = await screen.findByRole("row", { name: /Import/ });
    expect(row).toHaveTextContent("Ahmadia");
    expect(row).toHaveTextContent("1386 / 3299 images");
    await waitFor(() => expect(screen.getByRole("radio", { name: "Running · 1" })).toBeChecked());
    expect(screen.getByRole("radio", { name: "Queued · 0" })).toBeInTheDocument();
  });

  it("Finished lists succeeded and cancelled jobs, library jobs included", async () => {
    const requests = renderJobs("/jobs?state=finished");
    expect(await screen.findByRole("row", { name: /Dataset build: machines-v1/ })).toHaveTextContent("Model library");
    expect(requests.some((r) => r.url.includes("state=succeeded&state=cancelled"))).toBe(true);
  });

  it("filters by project through the URL and the request", async () => {
    const requests = renderJobs("/jobs?project=library");
    await waitFor(() => expect(requests.some((r) => r.url.includes("project_id=library"))).toBe(true));
    expect(screen.getByLabelText("Project")).toHaveValue("library");
    await screen.findByRole("option", { name: "Ahmadia" });
    fireEvent.change(screen.getByLabelText("Project"), { target: { value: PROJECT_ID } });
    await waitFor(() => expect(requests.some((r) => r.url.includes(`project_id=${PROJECT_ID}`))).toBe(true));
  });

  it("opens a row with its log and cancels through the project's route", async () => {
    const requests = renderJobs("/jobs", [
      jobsRoute(),
      PROJECTS,
      LOG,
      { method: "POST", path: /\/jobs\/[^/]+\/cancel$/, body: { ...runningJob, state: "cancelled" } },
    ]);
    fireEvent.click(await screen.findByRole("row", { name: /Import/ }));
    expect(await screen.findByTestId("jobcard-log")).toHaveTextContent("50 / 3299 images");
    fireEvent.click(screen.getByRole("button", { name: "Cancel job" }));
    await waitFor(() =>
      expect(requests.some((r) => r.url === `/api/v1/projects/${PROJECT_ID}/jobs/${JOB_ID}/cancel`)).toBe(true),
    );
  });

  it("cancels a library job through the library route", async () => {
    const libRunning = { ...exampleAppJobs[1], state: "running" as const, finished_at: null };
    const requests = renderJobs(`/jobs?job=${LIB_JOB_ID}`, [
      jobsRoute([libRunning]),
      PROJECTS,
      LOG,
      { method: "POST", path: /\/cancel$/, body: { ...libRunning, state: "cancelled" } },
    ]);
    fireEvent.click(await screen.findByRole("button", { name: "Cancel job" }));
    await waitFor(() =>
      expect(requests.some((r) => r.url === `/api/v1/library/jobs/${LIB_JOB_ID}/cancel`)).toBe(true),
    );
  });

  it("a job that finishes leaves the Running list and its open inspector offers the result", async () => {
    renderJobs(`/jobs?job=${JOB_ID}`);
    await screen.findByRole("row", { name: /Import/ });
    expect(await screen.findByRole("button", { name: "Cancel job" })).toBeInTheDocument();
    act(() =>
      useJobsStore
        .getState()
        .applyEvent({ type: "job.state", job_id: JOB_ID, payload: { state: "succeeded" } } as unknown as AppEvent),
    );
    expect(screen.queryByRole("row", { name: /Import/ })).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Open images" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Cancel job" })).not.toBeInTheDocument();
  });

  it("an unknown ?job= says the job is not in the list", async () => {
    renderJobs("/jobs?job=nope");
    expect(await screen.findByText("This job is not in the list")).toBeInTheDocument();
  });
});
```

Run: `pnpm -C frontend exec vitest run src/jobs/JobsScreen.test.tsx`
Expected: FAIL with `Failed to resolve import "./JobsScreen"`.

- [ ] **Step 9: Implement the inspector and the screen**

Create `frontend/src/jobs/JobInspector.tsx`:

```tsx
import { useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import type { AppJob } from "@/api/appJobs";
import { useApi } from "@/api/client";
import { messageOf } from "@/api/errors";
import { cancelJob } from "@/api/jobs";
import { pushLog } from "@/app/diagnostics";
import { formatLocalDate } from "@/library/modelLabels";
import { isActiveJob, useJobsStore } from "@/store/jobs";
import {
  Alert,
  Button,
  IconButton,
  InspectorPane,
  InspectorSection,
  Pill,
  Progress,
  buttonClass,
} from "@/ui";
import { elapsedSeconds, formatDuration, jobTitle, resultTarget, stateLabel } from "./jobLabels";
import { JobLogView } from "./JobLogView";
import { JOB_STATE_TONE, projectLabel } from "./jobsFilters";
import { useNow } from "./useNow";

function Row({ term, children, mono }: { term: string; children: ReactNode; mono?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-4 py-1.5 text-sm">
      <dt className="shrink-0 text-muted">{term}</dt>
      <dd className={mono ? "min-w-0 truncate font-mono text-xs" : "min-w-0 truncate tabular-nums"}>{children}</dd>
    </div>
  );
}

/** F §10.2: one job's details, its log tail, Cancel, and Go to result. */
export function JobInspector({ job, onClose }: { job: AppJob; onClose: () => void }) {
  const api = useApi();
  const active = isActiveJob(job);
  const now = useNow(1000, active);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const elapsed = elapsedSeconds(job, now);
  const target = resultTarget(job, job.project_id);
  const title = jobTitle(job);

  async function cancel() {
    setBusy(true);
    setError(null);
    try {
      useJobsStore.getState().upsert(await cancelJob(api, job.project_id, job.id));
    } catch (e) {
      pushLog(`cancel job ${job.id} failed: ${messageOf(e, String(e))}`);
      setError(messageOf(e, "could not cancel the job"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <InspectorPane
      label="Job"
      header={
        <div className="flex items-center gap-2">
          <h2 className="min-w-0 flex-1 truncate text-lg font-semibold">{title}</h2>
          <Pill tone={JOB_STATE_TONE[job.state]} live={job.state === "running"} size="sm">
            {stateLabel(job.state)}
          </Pill>
          <IconButton icon="x" label="Close job" size="sm" onClick={onClose} />
        </div>
      }
      footer={
        <div className="flex flex-wrap items-center gap-2">
          {target && (
            <Link to={target.to} className={buttonClass("primary", "sm")}>
              {target.label}
            </Link>
          )}
          {active && (
            <Button size="sm" loading={busy} onClick={() => void cancel()}>
              Cancel job
            </Button>
          )}
        </div>
      }
    >
      <InspectorSection title="Details">
        <Progress value={job.progress} running={job.state === "running"} label={`${title} progress`} />
        <dl className="mt-2 divide-y divide-line">
          <Row term="Project">{projectLabel(job)}</Row>
          <Row term="Progress">
            {Math.round(job.progress * 100)}%{job.message ? ` · ${job.message}` : ""}
          </Row>
          <Row term="Started">{job.started_at ? formatLocalDate(job.started_at) : "Not yet"}</Row>
          <Row term="Duration">{elapsed === null ? "–" : formatDuration(elapsed)}</Row>
          <Row term="Job" mono>
            {job.id}
          </Row>
        </dl>
        {job.error && <Alert tone="danger">{job.error}</Alert>}
        {error && <Alert tone="danger">{error}</Alert>}
      </InspectorSection>
      <InspectorSection title="Log">
        <JobLogView projectId={job.project_id} jobId={job.id} live={active} />
      </InspectorSection>
    </InspectorPane>
  );
}
```

Create `frontend/src/jobs/JobsScreen.tsx`:

```tsx
import { useSearchParams } from "react-router-dom";
import type { AppJob } from "@/api/appJobs";
import { useRecentProjects } from "@/api/recentProjects";
import { formatLocalDate } from "@/library/modelLabels";
import { isActiveJob } from "@/store/jobs";
import {
  Alert,
  Button,
  DataTable,
  EmptyState,
  Field,
  GlassPanel,
  Pill,
  Progress,
  Segmented,
  Select,
  type Column,
} from "@/ui";
import { JobInspector } from "./JobInspector";
import { elapsedSeconds, formatDuration, jobTitle, stateLabel } from "./jobLabels";
import {
  JOB_STATE_TONE,
  LIBRARY_FILTER,
  jobsViewParams,
  projectLabel,
  readJobsView,
  type JobSegment,
  type JobsView,
} from "./jobsFilters";
import { useActiveJobCounts, useAppJobs } from "./useAppJobs";
import { useNow } from "./useNow";

const EMPTY_TITLE: Record<JobSegment, string> = {
  running: "Nothing is running",
  queued: "Nothing is waiting",
  finished: "No finished jobs yet",
  failed: "No failed jobs",
};

function JobDuration({ job }: { job: AppJob }) {
  const now = useNow(1000, isActiveJob(job));
  const s = elapsedSeconds(job, now);
  return <span className="font-mono text-xs tabular-nums">{s === null ? "–" : formatDuration(s)}</span>;
}

const COLUMNS: Column<AppJob>[] = [
  {
    key: "type",
    header: "Job",
    width: "minmax(12rem,2fr)",
    render: (j) => <span className="truncate font-medium">{jobTitle(j)}</span>,
  },
  {
    key: "state",
    header: "State",
    width: "7rem",
    render: (j) => (
      <Pill tone={JOB_STATE_TONE[j.state]} live={j.state === "running"} size="sm">
        {stateLabel(j.state)}
      </Pill>
    ),
  },
  {
    key: "project",
    header: "Project",
    width: "minmax(8rem,1fr)",
    render: (j) => <span className="truncate text-muted">{projectLabel(j)}</span>,
  },
  {
    key: "message",
    header: "Message",
    width: "minmax(10rem,2fr)",
    render: (j) => <span className="truncate text-muted">{j.error ?? j.message}</span>,
  },
  {
    key: "progress",
    header: "Progress",
    width: "8rem",
    render: (j) => <Progress value={j.progress} running={j.state === "running"} label={`${jobTitle(j)} progress`} />,
  },
  {
    key: "started",
    header: "Started",
    width: "9rem",
    render: (j) => (
      <span className="font-mono text-xs tabular-nums text-muted">
        {j.started_at ? formatLocalDate(j.started_at) : "–"}
      </span>
    ),
  },
  { key: "duration", header: "Duration", width: "7rem", render: (j) => <JobDuration job={j} /> },
];

/** F §10.2: every job in the app, library and open projects together. */
export function JobsScreen() {
  const [params, setParams] = useSearchParams();
  const view = readJobsView(params);
  const jobs = useAppJobs(view.segment, view.project);
  const counts = useActiveJobCounts(view.project);
  const { projects } = useRecentProjects();
  const set = (next: Partial<JobsView>) => setParams(jobsViewParams({ ...view, ...next }), { replace: true });
  const selected = view.jobId ? jobs.find(view.jobId) : null;

  const segments: { value: JobSegment; label: string }[] = [
    { value: "running", label: `Running · ${counts.running}` },
    { value: "queued", label: `Queued · ${counts.queued}` },
    { value: "finished", label: "Finished" },
    { value: "failed", label: "Failed" },
  ];

  return (
    <section className="flex flex-col gap-5">
      <header className="flex flex-col gap-1">
        <h1 className="text-xl font-semibold tracking-tight">Jobs</h1>
        <p className="text-sm text-muted">
          Every background job on this computer: imports, detection runs, dataset builds, training, exports and
          upgrades.
        </p>
      </header>
      <div className="flex flex-wrap items-end gap-3">
        <Segmented
          label="Job state"
          options={segments}
          value={view.segment}
          onChange={(segment) => set({ segment, jobId: null })}
        />
        <Field label="Project" htmlFor="jobs-project" inline>
          <Select
            id="jobs-project"
            value={view.project ?? ""}
            onChange={(e) => set({ project: e.target.value || null, jobId: null })}
          >
            <option value="">All projects</option>
            <option value={LIBRARY_FILTER}>Model library</option>
            {projects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </Select>
        </Field>
      </div>
      {jobs.error && (
        <Alert
          tone="danger"
          actions={
            <Button size="sm" onClick={jobs.reload}>
              Retry
            </Button>
          }
        >
          {jobs.error}
        </Alert>
      )}
      <div className="grid items-start gap-4 min-[1100px]:grid-cols-[minmax(0,1fr)_340px]">
        <GlassPanel variant="pane" className="min-w-0 overflow-hidden">
          <DataTable
            label="Jobs"
            columns={COLUMNS}
            rows={jobs.rows}
            rowKey={(j) => j.id}
            activeKey={view.jobId}
            onOpen={(j) => set({ jobId: j.id })}
            loading={jobs.loading}
            onEndReached={jobs.hasMore ? jobs.loadMore : undefined}
            empty={<EmptyState icon="jobs" title={EMPTY_TITLE[view.segment]} />}
          />
        </GlassPanel>
        {view.jobId &&
          (selected ? (
            <JobInspector key={selected.id} job={selected} onClose={() => set({ jobId: null })} />
          ) : (
            !jobs.loading && (
              <GlassPanel variant="pane" className="p-4">
                <EmptyState icon="jobs" title="This job is not in the list">
                  It may be older than the loaded pages, or its project is closed. Choose a job from the list.
                </EmptyState>
              </GlassPanel>
            )
          ))}
      </div>
    </section>
  );
}
```

- [ ] **Step 10: Add the `/jobs` route**

In `frontend/src/routes/appRoutes.tsx`, add the lazy declaration, and replace SH's
`{ path: "jobs", element: <InterimJobs /> }` with the entry below. Then remove the `InterimJobs`
import. If nothing else imports SH's interim jobs view, delete it:

```powershell
Get-ChildItem frontend\src -Recurse -Include *.ts,*.tsx | Select-String -Pattern 'InterimJobs' | Select-Object Path,Line
git rm --ignore-unmatch frontend/src/app/InterimJobs.tsx frontend/src/app/InterimJobs.test.tsx
```

Expected: the first command lists only `app/InterimJobs.tsx` and its test. If anything else still
imports `InterimJobs`, keep both files.

```tsx
const JobsScreen = lazy(() => import("@/jobs/JobsScreen").then((m) => ({ default: m.JobsScreen })));
```

```tsx
  {
    path: "jobs",
    element: (
      <Later>
        <JobsScreen />
      </Later>
    ),
  },
```

Run: `pnpm -C frontend exec vitest run src/jobs src/api/appJobs.test.ts src/api/recentProjects.test.tsx`
Expected: PASS (all jobs tests, including the 7 screen tests).

- [ ] **Step 11: Create the e2e fixture helper and rewrite `jobs.spec.ts`**

Create `frontend/e2e/fixtures/appSections.ts`:

```ts
import type { Route } from "@playwright/test";

export const P = "7f1c2e3a-1111-4000-8000-000000000001";
export const JOB = "j0000000-4444-4000-8000-000000000001";
export const T0 = "2026-09-26T08:00:00Z";

/** Answers a routed request with JSON; the dev UI and the mock are different origins. */
export function fulfilJson(route: Route, body: unknown, status = 200): Promise<void> {
  return route.fulfill({
    status,
    contentType: "application/json",
    headers: { "Access-Control-Allow-Origin": "*" },
    body: JSON.stringify(body),
  });
}

const RUNNING_IMPORT = {
  id: JOB,
  project_id: P,
  project_name: "Ahmadia",
  type: "import",
  state: "running",
  progress: 0.42,
  message: "1386 / 3299 images",
  log_path: `runs/${JOB}/job.log`,
  params: {},
  result: null,
  error: null,
  created_at: "2026-09-26T10:05:00Z",
  started_at: "2026-09-26T10:05:01Z",
  finished_at: null,
};

const DONE_BUILD = {
  ...RUNNING_IMPORT,
  id: "j-build",
  project_id: "library",
  project_name: null,
  type: "dataset_build",
  state: "succeeded",
  progress: 1,
  message: "30 images",
  params: { name: "machines-v1", dataset_id: "d-lib-1" },
  result: { dataset_id: "d-lib-1" },
  created_at: "2026-09-26T09:00:00Z",
  finished_at: "2026-09-26T09:00:09Z",
};

const FAILED_TRAIN = {
  ...RUNNING_IMPORT,
  id: "j-failed",
  project_id: "library",
  project_name: null,
  type: "train",
  state: "failed",
  progress: 0.3,
  message: "epoch 15/50 mAP50 0.410",
  params: { name: "ahmadia-v1-n" },
  error: "CUDA out of memory",
  created_at: "2026-09-26T08:05:00Z",
  started_at: "2026-09-26T08:05:01Z",
  finished_at: "2026-09-26T08:35:01Z",
};

export const APP_JOBS = [RUNNING_IMPORT, DONE_BUILD, FAILED_TRAIN];

/** The catalogue as the Catalogue, builder and project-types specs see it (Tasks 5, 10, 15). */
export const CATALOGUE_PAGE = {
  items: [
    { id: "t-1", name: "Excavator", colour: "#f97316", kind: "object", default_severity: null, hotkey: "1", group: null, archived: false, origin: "migrated" },
    { id: "t-2", name: "Dump truck", colour: "#06b6d4", kind: "object", default_severity: null, hotkey: "2", group: null, archived: false, origin: "migrated" },
    { id: "t-3", name: "Crack", colour: "#ef4444", kind: "defect", default_severity: 2, hotkey: "c", group: "Concrete defects", archived: false, origin: "user" },
  ],
  next_cursor: null,
  needs_classification: true,
};

export const SEVERITY = [
  { level: 1, name: "Minor", colour: "#3fb68e" },
  { level: 2, name: "Moderate", colour: "#e2bf2e" },
  { level: 3, name: "Major", colour: "#ff9c3a" },
  { level: 4, name: "Critical", colour: "#ff5a4f" },
];

export const BACKFILL_JOB = {
  id: "j-backfill",
  project_id: "library",
  type: "findings_backfill",
  state: "queued",
  progress: 0,
  message: "",
  log_path: "library/runs/j-backfill/job.log",
  params: {},
  result: null,
  error: null,
  created_at: T0,
  started_at: null,
  finished_at: null,
};

/** `GET /jobs` filtered by the request's `state` params, as the backend does. */
export function appJobsBody(url: string) {
  const states = new URL(url).searchParams.getAll("state");
  return { items: APP_JOBS.filter((j) => states.length === 0 || states.includes(j.state)), next_cursor: null };
}
```

Replace the whole content of `frontend/e2e/jobs.spec.ts`:

```ts
import { expect, test } from "@playwright/test";
import { JOB, P, appJobsBody, fulfilJson } from "./fixtures/appSections";

test("the Jobs section lists project and library jobs, opens one with its log, and cancels it", async ({
  page,
}) => {
  await page.route(
    (url) => url.pathname === "/api/v1/jobs",
    (route) => fulfilJson(route, appJobsBody(route.request().url())),
  );
  await page.goto("/jobs");
  await expect(page.getByRole("heading", { name: "Jobs", exact: true })).toBeVisible({ timeout: 15_000 });
  const row = page.getByRole("row", { name: /Import/ });
  await expect(row).toContainText("Ahmadia");
  await expect(page.getByRole("radio", { name: "Running · 1" })).toBeVisible();

  const log = page.waitForRequest((r) => r.url().includes(`/projects/${P}/jobs/${JOB}/log`));
  await row.click();
  await expect(page).toHaveURL(new RegExp(`job=${JOB}`));
  await log;

  const cancel = page.waitForRequest(
    (r) => r.method() === "POST" && r.url().endsWith(`/projects/${P}/jobs/${JOB}/cancel`),
  );
  await page.getByRole("button", { name: "Cancel job" }).click();
  await cancel;
});

test("the Failed segment shows the error, and the library filter reaches the request", async ({ page }) => {
  const requested: string[] = [];
  await page.route(
    (url) => url.pathname === "/api/v1/jobs",
    (route) => {
      requested.push(route.request().url());
      return fulfilJson(route, appJobsBody(route.request().url()));
    },
  );
  await page.goto("/jobs?state=failed&project=library");
  await expect(page.getByRole("row", { name: /Training: ahmadia-v1-n/ })).toContainText("CUDA out of memory");
  expect(requested.some((u) => u.includes("project_id=library"))).toBe(true);
  await page.getByRole("radio", { name: "Finished" }).click();
  await expect(page).toHaveURL(/state=finished/);
  await expect(page.getByRole("row", { name: /Dataset build: machines-v1/ })).toContainText("Model library");
});
```

Run: `$env:E2E_WEB_PORT=1520; $env:E2E_MOCK_PORT=4110; pnpm -C frontend exec playwright test e2e/jobs.spec.ts`
Expected: 2 passed.

- [ ] **Step 12: Lint, build and commit**

```powershell
pnpm -C frontend lint; pnpm -C frontend build
git add frontend/src/api/appJobs.ts frontend/src/api/appJobs.test.ts frontend/src/api/recentProjects.ts frontend/src/api/recentProjects.test.tsx frontend/src/jobs/jobsFilters.ts frontend/src/jobs/jobsFilters.test.ts frontend/src/jobs/useAppJobs.ts frontend/src/jobs/useAppJobs.test.tsx frontend/src/jobs/JobInspector.tsx frontend/src/jobs/JobsScreen.tsx frontend/src/jobs/JobsScreen.test.tsx frontend/src/jobs/jobLabels.ts frontend/src/jobs/jobLabels.test.ts frontend/src/jobs/appJobLabels.test.ts frontend/src/routes/appRoutes.tsx frontend/e2e/fixtures/appSections.ts frontend/e2e/jobs.spec.ts
git add frontend/src/jobs/JobCard.tsx  # only if Step 1 changed it
git commit -m "feat(jobs): the Jobs section with segments, project filter, inspector and log

Library and project jobs page together from GET /jobs; rows follow the WebSocket through
the jobs store.

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 7: Models API wrappers and list hooks

**Files:**
- Create: `frontend/src/api/libraryDatasets.ts`, `frontend/src/api/libraryDatasets.test.ts`
- Create: `frontend/src/api/trainingRuns.ts`, `frontend/src/api/trainingRuns.test.ts`
- Modify: `frontend/src/api/library.ts` (add `saveClassMap`), `frontend/src/api/library.test.ts`
- Create: `frontend/src/models/useLibraryDatasets.ts`, `frontend/src/models/useLibraryDatasets.test.tsx`
- Create: `frontend/src/models/useTrainingRuns.ts`

**Interfaces:**
- Consumes: C0's `/library/datasets…`, `/library/training-runs…` and `/library/models/{id}/class-map`;
  `isLibraryUnavailable`.
- Produces:
  - `api/libraryDatasets.ts`:
    - types `LibraryDataset`, `DatasetFilter`, `DatasetPreview`, `LibraryDatasetCreate`,
      `LibraryDatasetItem`, `DatasetTask`
    - `DATASET_PAGE = 100`, `SAMPLE_COUNT = 24`
    - `fetchLibraryDatasets(api, cursor?): Promise<Page<LibraryDataset>>`
    - `fetchLibraryDataset(api, id): Promise<LibraryDataset>`
    - `deleteLibraryDataset(api, id): Promise<void>`
    - `previewDataset(api, filter): Promise<DatasetPreview>`
    - `createLibraryDataset(api, body): Promise<{dataset: LibraryDataset; job: Job}>`
    - `exportLibraryDataset(api, id): Promise<Job>`
    - `fetchDatasetSamples(api, id): Promise<LibraryDatasetItem[]>`
  - `api/trainingRuns.ts`:
    - `TrainingRun`, `TRAINING_RUN_PAGE = 100`
    - `fetchTrainingRuns(api, cursor?): Promise<Page<TrainingRun>>`
    - `fetchTrainingRun(api, id): Promise<TrainingRun>`
    - `startTrainingRun(api, body: TrainRequest): Promise<{training_run: TrainingRun; job: Job}>`
  - `api/library.ts`: `ClassMap = Record<string, string | null>`,
    `saveClassMap(api, modelId, classMap): Promise<LibraryModel>`
  - `useLibraryDatasets(): LibraryDatasets {datasets; loading; unavailable; error; hasMore; loadMore(); reload(); remove(id); put(d)}`
  - `useTrainingRuns(): TrainingRuns {runs; loading; unavailable; error; hasMore; loadMore(); reload()}`

- [ ] **Step 1: Write the failing API tests**

Create `frontend/src/api/libraryDatasets.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { fakeClient, runningJob } from "@/test/fixtures";
import {
  exampleDatasetItems,
  exampleLibraryDataset,
  examplePreview,
  LIB_DATASET_ID,
} from "@/test/appSectionFixtures";
import {
  createLibraryDataset,
  deleteLibraryDataset,
  exportLibraryDataset,
  fetchDatasetSamples,
  fetchLibraryDataset,
  fetchLibraryDatasets,
  previewDataset,
} from "./libraryDatasets";

describe("library datasets API (F §12.3)", () => {
  it("lists one page with a cursor", async () => {
    const { api, requests } = fakeClient([
      { method: "GET", path: /\/library\/datasets$/, body: { items: [exampleLibraryDataset], next_cursor: "c2" } },
    ]);
    const page = await fetchLibraryDatasets(api, "c1");
    expect(page.items[0].name).toBe("machines-v1");
    expect(page.next_cursor).toBe("c2");
    expect(requests[0].url).toContain("limit=100");
    expect(requests[0].url).toContain("cursor=c1");
  });

  it("reads, deletes and exports one dataset", async () => {
    const { api, requests } = fakeClient([
      { method: "GET", path: /\/library\/datasets\/[^/]+$/, body: exampleLibraryDataset },
      { method: "DELETE", path: /\/library\/datasets\/[^/]+$/, status: 204 },
      { method: "POST", path: /\/export$/, status: 202, body: { job: { ...runningJob, type: "dataset" } } },
    ]);
    expect((await fetchLibraryDataset(api, LIB_DATASET_ID)).id).toBe(LIB_DATASET_ID);
    await deleteLibraryDataset(api, LIB_DATASET_ID);
    expect((await exportLibraryDataset(api, LIB_DATASET_ID)).type).toBe("dataset");
    expect(requests.map((r) => `${r.method} ${r.url}`)).toEqual([
      `GET /api/v1/library/datasets/${LIB_DATASET_ID}`,
      `DELETE /api/v1/library/datasets/${LIB_DATASET_ID}`,
      `POST /api/v1/library/datasets/${LIB_DATASET_ID}/export`,
    ]);
  });

  it("previews a filter and creates a dataset with its build job", async () => {
    const { api, requests } = fakeClient([
      { method: "POST", path: /\/library\/datasets\/preview$/, body: examplePreview },
      {
        method: "POST",
        path: /\/library\/datasets$/,
        status: 202,
        body: { dataset: { ...exampleLibraryDataset, state: "resolving" }, job: { ...runningJob, type: "dataset_build" } },
      },
    ]);
    expect((await previewDataset(api, exampleLibraryDataset.filter)).images).toBe(30);
    expect(requests[0].body).toEqual(exampleLibraryDataset.filter);
    const created = await createLibraryDataset(api, {
      name: "machines-v1",
      task: "detect",
      filter: exampleLibraryDataset.filter,
      split_method: "by_group",
      val_fraction: 0.2,
      seed: 42,
    });
    expect(created.dataset.state).toBe("resolving");
    expect(created.job.type).toBe("dataset_build");
  });

  it("asks for 24 sample items", async () => {
    const { api, requests } = fakeClient([
      { method: "GET", path: /\/items$/, body: exampleDatasetItems },
    ]);
    expect(await fetchDatasetSamples(api, LIB_DATASET_ID)).toHaveLength(1);
    expect(requests[0].url).toContain("limit=24");
  });
});
```

Create `frontend/src/api/trainingRuns.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { fakeClient, runningJob } from "@/test/fixtures";
import { exampleTrainingRun, TRAINING_RUN_ID } from "@/test/appSectionFixtures";
import { fetchTrainingRun, fetchTrainingRuns, startTrainingRun } from "./trainingRuns";

describe("training runs API (F §12.3)", () => {
  it("lists, reads and starts runs", async () => {
    const { api, requests } = fakeClient([
      { method: "GET", path: /\/library\/training-runs$/, body: { items: [exampleTrainingRun], next_cursor: null } },
      { method: "GET", path: /\/library\/training-runs\/[^/]+$/, body: exampleTrainingRun },
      {
        method: "POST",
        path: /\/library\/training-runs$/,
        status: 202,
        body: { training_run: { ...exampleTrainingRun, state: "queued" }, job: { ...runningJob, type: "train" } },
      },
    ]);
    expect((await fetchTrainingRuns(api)).items).toHaveLength(1);
    expect((await fetchTrainingRun(api, TRAINING_RUN_ID)).id).toBe(TRAINING_RUN_ID);
    const started = await startTrainingRun(api, exampleTrainingRun.params);
    expect(started.training_run.state).toBe("queued");
    expect(started.job.type).toBe("train");
    expect(requests[2].body).toEqual(exampleTrainingRun.params);
  });
});
```

Append to `frontend/src/api/library.test.ts`, with the extra imports it needs (`saveClassMap` from
`./library`, and `exampleModel`, `fakeClient`, `MODEL_ID` from `@/test/fixtures`, if not already
imported):

```ts
describe("saveClassMap", () => {
  it("puts the whole map for one model", async () => {
    const { api, requests } = fakeClient([
      { method: "PUT", path: /\/class-map$/, body: { ...exampleModel, class_map: { truck: "t-2" } } },
    ]);
    const saved = await saveClassMap(api, MODEL_ID, { truck: "t-2", bicycle: null });
    expect(saved.class_map).toEqual({ truck: "t-2" });
    expect(requests[0].url).toBe(`/api/v1/library/models/${MODEL_ID}/class-map`);
    expect(requests[0].body).toEqual({ mapping: { truck: "t-2", bicycle: null } });
  });
});
```

Run: `pnpm -C frontend exec vitest run src/api/libraryDatasets.test.ts src/api/trainingRuns.test.ts src/api/library.test.ts`
Expected: FAIL. The first two cannot resolve their modules, and `saveClassMap` is not exported.

- [ ] **Step 2: Implement the wrappers**

Create `frontend/src/api/libraryDatasets.ts`:

```ts
import type { ApiClient, Job, components } from "@contract/client";
import { unwrap } from "./errors";
import type { Page } from "./paging";

type S = components["schemas"];
export type LibraryDataset = S["LibraryDataset"];
export type DatasetFilter = S["DatasetFilter"];
export type DatasetPreview = S["DatasetPreview"];
export type LibraryDatasetCreate = S["LibraryDatasetCreate"];
export type LibraryDatasetItem = S["LibraryDatasetItem"];
export type DatasetTask = LibraryDataset["task"];

export const DATASET_PAGE = 100;
/** The detail's sample grid (bounded: F §14). */
export const SAMPLE_COUNT = 24;

export async function fetchLibraryDatasets(api: ApiClient, cursor?: string): Promise<Page<LibraryDataset>> {
  const r = await unwrap(
    api.GET("/api/v1/library/datasets", {
      params: { query: { limit: DATASET_PAGE, ...(cursor ? { cursor } : {}) } },
    }),
  );
  return { items: r.items, next_cursor: r.next_cursor ?? null };
}

export function fetchLibraryDataset(api: ApiClient, datasetId: string): Promise<LibraryDataset> {
  return unwrap(api.GET("/api/v1/library/datasets/{datasetId}", { params: { path: { datasetId } } }));
}

/** Deletes the row and its export folder; project images are never touched (§12.3). */
export async function deleteLibraryDataset(api: ApiClient, datasetId: string): Promise<void> {
  await unwrap<unknown>(api.DELETE("/api/v1/library/datasets/{datasetId}", { params: { path: { datasetId } } }));
}

/** COUNT queries only, with a per-project timeout on the server (§12.2 step 1). */
export function previewDataset(api: ApiClient, filter: DatasetFilter): Promise<DatasetPreview> {
  return unwrap(api.POST("/api/v1/library/datasets/preview", { body: filter }));
}

/** 202: the dataset (`state: resolving`) and its `dataset_build` job. */
export function createLibraryDataset(
  api: ApiClient,
  body: LibraryDatasetCreate,
): Promise<{ dataset: LibraryDataset; job: Job }> {
  return unwrap(api.POST("/api/v1/library/datasets", { body }));
}

/** 202: the YOLO export (`dataset` job). */
export async function exportLibraryDataset(api: ApiClient, datasetId: string): Promise<Job> {
  const r = await unwrap(
    api.POST("/api/v1/library/datasets/{datasetId}/export", { params: { path: { datasetId } } }),
  );
  return r.job;
}

export async function fetchDatasetSamples(api: ApiClient, datasetId: string): Promise<LibraryDatasetItem[]> {
  const r = await unwrap(
    api.GET("/api/v1/library/datasets/{datasetId}/items", {
      params: { path: { datasetId }, query: { limit: SAMPLE_COUNT } },
    }),
  );
  return r.items;
}
```

Create `frontend/src/api/trainingRuns.ts`:

```ts
import type { ApiClient, Job, TrainRequest, components } from "@contract/client";
import { unwrap } from "./errors";
import type { Page } from "./paging";

export type TrainingRun = components["schemas"]["TrainingRun"];

export const TRAINING_RUN_PAGE = 100;

export async function fetchTrainingRuns(api: ApiClient, cursor?: string): Promise<Page<TrainingRun>> {
  const r = await unwrap(
    api.GET("/api/v1/library/training-runs", {
      params: { query: { limit: TRAINING_RUN_PAGE, ...(cursor ? { cursor } : {}) } },
    }),
  );
  return { items: r.items, next_cursor: r.next_cursor ?? null };
}

export function fetchTrainingRun(api: ApiClient, runId: string): Promise<TrainingRun> {
  return unwrap(api.GET("/api/v1/library/training-runs/{runId}", { params: { path: { runId } } }));
}

/** 202: the run and its `train` library job; it exports the dataset first when needed (§12.2 step 4). */
export function startTrainingRun(api: ApiClient, body: TrainRequest): Promise<{ training_run: TrainingRun; job: Job }> {
  return unwrap(api.POST("/api/v1/library/training-runs", { body }));
}
```

In `frontend/src/api/library.ts`, add after `updateLibraryModel`:

```ts
/** Model class name → catalogue type id, or null for "ignore" (F §7.4, F10). */
export type ClassMap = Record<string, string | null>;

/** Merged over the model's stored map on the server (BM `LibraryModelClassMapPut`): absent names keep theirs. */
export function saveClassMap(api: ApiClient, modelId: string, classMap: ClassMap): Promise<LibraryModel> {
  return unwrap(
    api.PUT("/api/v1/library/models/{modelId}/class-map", {
      params: { path: { modelId } },
      body: { mapping: classMap },
    }),
  );
}
```

Run: `pnpm -C frontend exec vitest run src/api/libraryDatasets.test.ts src/api/trainingRuns.test.ts src/api/library.test.ts`
Expected: PASS.

- [ ] **Step 3: Write the failing list-hook test**

Create `frontend/src/models/useLibraryDatasets.test.tsx`:

```tsx
import type { ReactNode } from "react";
import { describe, expect, it } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";
import type { ApiClient } from "@contract/client";
import { errorBody, fakeClient } from "@/test/fixtures";
import { exampleLibraryDataset } from "@/test/appSectionFixtures";
import { TestApiProvider } from "@/test/render";
import { useLibraryDatasets } from "./useLibraryDatasets";

const wrapper =
  (api: ApiClient) =>
  ({ children }: { children: ReactNode }) => <TestApiProvider api={api}>{children}</TestApiProvider>;

describe("useLibraryDatasets", () => {
  it("loads the first page, loads more once and removes locally", async () => {
    const second = { ...exampleLibraryDataset, id: "d2", name: "machines-v2" };
    const { api } = fakeClient([
      {
        method: "GET",
        path: /\/library\/datasets$/,
        body: (r) =>
          r.url.includes("cursor=c2")
            ? { items: [second], next_cursor: null }
            : { items: [exampleLibraryDataset], next_cursor: "c2" },
      },
    ]);
    const { result } = renderHook(() => useLibraryDatasets(), { wrapper: wrapper(api) });
    await waitFor(() => expect(result.current.datasets).toHaveLength(1));
    expect(result.current.hasMore).toBe(true);
    act(() => result.current.loadMore());
    await waitFor(() => expect(result.current.datasets).toHaveLength(2));
    expect(result.current.hasMore).toBe(false);
    act(() => result.current.remove("d2"));
    expect(result.current.datasets.map((d) => d.id)).toEqual([exampleLibraryDataset.id]);
  });

  it("reports an unopened library as unavailable", async () => {
    const { api } = fakeClient([
      {
        method: "GET",
        path: /\/library\/datasets$/,
        status: 503,
        body: errorBody("library_unavailable", "no library"),
      },
    ]);
    const { result } = renderHook(() => useLibraryDatasets(), { wrapper: wrapper(api) });
    await waitFor(() => expect(result.current.unavailable).toBe(true));
    expect(result.current.error).toBeNull();
  });
});
```

Run: `pnpm -C frontend exec vitest run src/models/useLibraryDatasets.test.tsx`
Expected: FAIL with `Failed to resolve import "./useLibraryDatasets"`.

- [ ] **Step 4: Implement both list hooks**

Both hooks share one small paging core. Create `frontend/src/models/usePagedList.ts`:

```ts
import { useCallback, useEffect, useRef, useState } from "react";
import { messageOf } from "@/api/errors";
import { isLibraryUnavailable } from "@/api/library";
import type { Page } from "@/api/paging";
import { pushLog } from "@/app/diagnostics";

export interface PagedList<T> {
  items: T[];
  loading: boolean;
  unavailable: boolean;
  error: string | null;
  hasMore: boolean;
  loadMore: () => void;
  reload: () => void;
  remove: (id: string) => void;
  put: (item: T) => void;
}

interface State<T> {
  key: number;
  items: T[];
  cursor: string | null;
  unavailable: boolean;
  error: string | null;
}

/** A cursor-paged library list: page one on mount and on reload, later pages on demand. */
export function usePagedList<T extends { id: string }>(
  fetchPage: (cursor?: string) => Promise<Page<T>>,
  what: string,
): PagedList<T> {
  const [attempt, setAttempt] = useState(0);
  const [state, setState] = useState<State<T>>({ key: -1, items: [], cursor: null, unavailable: false, error: null });
  const fetchRef = useRef(fetchPage);
  const busy = useRef(false);
  useEffect(() => {
    fetchRef.current = fetchPage;
  }, [fetchPage]);

  useEffect(() => {
    let cancelled = false;
    fetchRef.current()
      .then((page) => {
        if (!cancelled)
          setState({ key: attempt, items: page.items, cursor: page.next_cursor, unavailable: false, error: null });
      })
      .catch((e: unknown) => {
        if (cancelled) return;
        pushLog(`load ${what} failed: ${messageOf(e, String(e))}`);
        const unavailable = isLibraryUnavailable(e);
        setState((s) => ({
          key: attempt,
          items: unavailable ? [] : s.items,
          cursor: null,
          unavailable,
          error: unavailable ? null : messageOf(e, `could not load ${what}`),
        }));
      });
    return () => {
      cancelled = true;
    };
  }, [attempt, what]);

  const cursor = state.cursor;
  const loadMore = useCallback(() => {
    if (!cursor || busy.current) return;
    busy.current = true;
    fetchRef.current(cursor)
      .then((page) =>
        setState((s) => {
          const seen = new Set(s.items.map((i) => i.id));
          return {
            ...s,
            items: [...s.items, ...page.items.filter((i) => !seen.has(i.id))],
            cursor: page.next_cursor === cursor ? null : page.next_cursor,
          };
        }),
      )
      .catch((e: unknown) => pushLog(`load more ${what} failed: ${messageOf(e, String(e))}`))
      .finally(() => {
        busy.current = false;
      });
  }, [cursor, what]);

  const reload = useCallback(() => setAttempt((a) => a + 1), []);
  const remove = useCallback(
    (id: string) => setState((s) => ({ ...s, items: s.items.filter((i) => i.id !== id) })),
    [],
  );
  const put = useCallback(
    (item: T) =>
      setState((s) => ({
        ...s,
        items: s.items.some((i) => i.id === item.id)
          ? s.items.map((i) => (i.id === item.id ? item : i))
          : [item, ...s.items],
      })),
    [],
  );

  return {
    items: state.items,
    loading: state.key !== attempt && state.items.length === 0,
    unavailable: state.unavailable,
    error: state.error,
    hasMore: cursor !== null,
    loadMore,
    reload,
    remove,
    put,
  };
}
```

Create `frontend/src/models/useLibraryDatasets.ts`:

```ts
import { useCallback } from "react";
import { useApi } from "@/api/client";
import { fetchLibraryDatasets, type LibraryDataset } from "@/api/libraryDatasets";
import { usePagedList } from "./usePagedList";

export interface LibraryDatasets {
  datasets: LibraryDataset[];
  loading: boolean;
  unavailable: boolean;
  error: string | null;
  hasMore: boolean;
  loadMore: () => void;
  reload: () => void;
  remove: (id: string) => void;
  put: (dataset: LibraryDataset) => void;
}

export function useLibraryDatasets(): LibraryDatasets {
  const api = useApi();
  const fetchPage = useCallback((cursor?: string) => fetchLibraryDatasets(api, cursor), [api]);
  const list = usePagedList(fetchPage, "datasets");
  return { ...list, datasets: list.items };
}
```

Create `frontend/src/models/useTrainingRuns.ts`:

```ts
import { useCallback } from "react";
import { useApi } from "@/api/client";
import { fetchTrainingRuns, type TrainingRun } from "@/api/trainingRuns";
import { usePagedList } from "./usePagedList";

export interface TrainingRuns {
  runs: TrainingRun[];
  loading: boolean;
  unavailable: boolean;
  error: string | null;
  hasMore: boolean;
  loadMore: () => void;
  reload: () => void;
  put: (run: TrainingRun) => void;
}

export function useTrainingRuns(): TrainingRuns {
  const api = useApi();
  const fetchPage = useCallback((cursor?: string) => fetchTrainingRuns(api, cursor), [api]);
  const list = usePagedList(fetchPage, "training runs");
  return { ...list, runs: list.items };
}
```

Add `frontend/src/models/usePagedList.ts` to this task's files.

Run: `pnpm -C frontend exec vitest run src/models src/api`
Expected: PASS.

- [ ] **Step 5: Lint and commit**

```powershell
pnpm -C frontend lint
git add frontend/src/api/libraryDatasets.ts frontend/src/api/libraryDatasets.test.ts frontend/src/api/trainingRuns.ts frontend/src/api/trainingRuns.test.ts frontend/src/api/library.ts frontend/src/api/library.test.ts frontend/src/models/usePagedList.ts frontend/src/models/useLibraryDatasets.ts frontend/src/models/useLibraryDatasets.test.tsx frontend/src/models/useTrainingRuns.ts
git commit -m "feat(models): library datasets, training runs and class map API with paged hooks

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 8: Models layout and the Library host

**Files:**
- Create: `frontend/src/models/ModelsLayout.tsx`, `frontend/src/models/ModelsLayout.test.tsx`
- Modify: `frontend/src/library/LibraryScreen.tsx`
- Modify: `frontend/src/routes/appRoutes.tsx`
- Modify: `frontend/e2e/library.spec.ts`

**Interfaces:**
- Consumes: `LibraryScreen` (unchanged API), DS `Tabs`, SH `useProvideRouteActions`.
- Produces:
  - `ModelsLayout()`, which renders the `Models` h1, the sub-tabs Library · Datasets · Training, and
    `<Outlet/>`
  - The nested `models` route with its `index` → `library` redirect and its `library`,
    `datasets…` and `training…` children. Tasks 9 and 11 swap the placeholder elements of the last
    four.
  - Sub-screens use `h2` for their own title.

- [ ] **Step 1: Write the failing layout test**

Create `frontend/src/models/ModelsLayout.test.tsx`:

```tsx
import { describe, expect, it } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { Outlet, RouterProvider, createMemoryRouter } from "react-router-dom";
import { exampleLibraryStatus, exampleModel, fakeClient } from "@/test/fixtures";
import { TestApiProvider } from "@/test/render";
import { appRoutes } from "@/routes/appRoutes";

function renderModels(path: string) {
  const { api } = fakeClient([
    { method: "GET", path: /\/library\/status$/, body: exampleLibraryStatus },
    { method: "GET", path: /\/library\/models$/, body: { items: [exampleModel], next_cursor: null } },
    { method: "GET", path: /\/library\/jobs$/, body: { items: [], next_cursor: null } },
  ]);
  const router = createMemoryRouter([{ path: "/", element: <Outlet />, children: appRoutes }], {
    initialEntries: [path],
  });
  render(
    <TestApiProvider api={api}>
      <RouterProvider router={router} />
    </TestApiProvider>,
  );
  return router;
}

describe("Models section (F §5.3, §12)", () => {
  it("/models lands on the Library and shows the three sub-tabs", async () => {
    const router = renderModels("/models");
    await waitFor(() => expect(router.state.location.pathname).toBe("/models/library"));
    expect(await screen.findByRole("heading", { name: "Models", level: 1 })).toBeInTheDocument();
    expect(screen.getByText("Library", { selector: "a, a *" }).closest("a")).toHaveAttribute("href", "/models/library");
    expect(screen.getByText("Datasets", { selector: "a, a *" }).closest("a")).toHaveAttribute("href", "/models/datasets");
    expect(screen.getByText("Training", { selector: "a, a *" }).closest("a")).toHaveAttribute("href", "/models/training");
  });

  it("hosts the Library at /models/library", async () => {
    renderModels("/models/library");
    expect(await screen.findByRole("heading", { name: "Library", level: 2 })).toBeInTheDocument();
    expect(await screen.findByText("yolo11m-coco")).toBeInTheDocument();
  });
});
```

Run: `pnpm -C frontend exec vitest run src/models/ModelsLayout.test.tsx`
Expected: FAIL. `/models` has no route yet, so the location stays `/models` and the "Models"
heading is not found.

- [ ] **Step 2: Implement the layout, the route, and the Library changes**

Create `frontend/src/models/ModelsLayout.tsx`:

```tsx
import { Outlet } from "react-router-dom";
import { Tabs } from "@/ui";

const TABS = [
  { id: "library", to: "/models/library", label: "Library" },
  { id: "datasets", to: "/models/datasets", label: "Datasets" },
  { id: "training", to: "/models/training", label: "Training" },
];

/** F §12 / D8: the app-level Models section. Sub-screens title themselves with h2. */
export function ModelsLayout() {
  return (
    <section className="flex flex-col gap-5">
      <header className="flex flex-col gap-1">
        <h1 className="text-xl font-semibold tracking-tight">Models</h1>
        <p className="text-sm text-muted">
          Every model on this computer, the datasets built from your projects, and training.
        </p>
      </header>
      <Tabs asLinks label="Models sections" items={TABS} />
      <Outlet />
    </section>
  );
}
```

In `frontend/src/routes/appRoutes.tsx`:

1. Add `import { ModelsLayout } from "@/models/ModelsLayout";`. SH already imports `Navigate`
   and `LibraryScreen`.

2. Replace SH's six flat entries (`models`, `models/library`, `models/datasets`,
   `models/datasets/:datasetId`, `models/training`, `models/training/:runId`) with this one nested
   entry. It keeps SH's `datasets` and `training` placeholder elements until Tasks 9 and 11 swap
   them. SH's `/library` → `/models/library` redirect stays in `routes/legacyRedirects.tsx`.

   ```tsx
     {
       path: "models",
       element: <ModelsLayout />,
       children: [
         { index: true, element: <Navigate to="library" replace /> },
         { path: "library", element: <LibraryScreen /> },
         { path: "datasets", element: datasets },
         { path: "datasets/:datasetId", element: datasets },
         { path: "training", element: training },
         { path: "training/:runId", element: training },
       ],
     },
   ```

In `frontend/src/library/LibraryScreen.tsx`:

1. In `LibraryContent` and in `LibraryScreen`, change the two `<h1 className="text-xl font-semibold tracking-tight">Library</h1>`
   to `<h2 className="text-lg font-semibold">Library</h2>`.
2. Replace the empty-state text "Train a model in a training project, import a model file, or add a
   starter model above." with "Train one under Training, import a model file, or add a starter
   model above."
3. Register the Library's context action (F §5.1) at the top of `LibraryContent`, after `adding` is
   declared:

   ```tsx
     const actions = useMemo<RouteAction[]>(
       () => [{ id: "import-model", label: "Import model", icon: "import", variant: "primary", run: () => setAdding("file") }],
       [],
     );
     useProvideRouteActions(actions);
   ```

   with `import { useProvideRouteActions, type RouteAction } from "@/app/routeActions";`.
4. Change the JSDoc line "App-level `/library`" to "App-level `/models/library`".

Run: `pnpm -C frontend exec vitest run src/models/ModelsLayout.test.tsx src/library`
Expected: PASS. If `LibraryScreen.test.tsx` asserts `level: 1` or matches the old empty-state text,
update exactly those assertions to `level: 2` and the new text.

- [ ] **Step 3: Point the Library e2e at its new route**

In `frontend/e2e/library.spec.ts`, replace every `page.goto("/library")` and
`` page.goto(`/library `` prefix with `/models/library` (for example
`page.goto("/library?model=…")` becomes `page.goto("/models/library?model=…")`). Replace every
`toHaveURL(/\/library/` with `toHaveURL(/\/models\/library/`.

Run: `$env:E2E_WEB_PORT=1520; $env:E2E_MOCK_PORT=4110; pnpm -C frontend exec playwright test e2e/library.spec.ts`
Expected: 4 passed.

- [ ] **Step 4: Lint, build and commit**

```powershell
pnpm -C frontend lint; pnpm -C frontend build
git add frontend/src/models/ModelsLayout.tsx frontend/src/models/ModelsLayout.test.tsx frontend/src/library/LibraryScreen.tsx frontend/src/library/LibraryScreen.test.tsx frontend/src/routes/appRoutes.tsx frontend/e2e/library.spec.ts
git commit -m "feat(models): the Models section hosts the Library at /models/library

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 9: Datasets screen (list, detail, samples, export, delete)

Load `impeccable`, `emil-design-eng` and `DESIGN.md` first.

**Files:**
- Create: `frontend/src/models/datasetLabels.ts`, `frontend/src/models/datasetLabels.test.ts`
- Create: `frontend/src/models/useItemById.ts`
- Create: `frontend/src/models/DatasetDetail.tsx`
- Create: `frontend/src/models/DatasetsScreen.tsx`, `frontend/src/models/DatasetsScreen.test.tsx`
- Create: `frontend/src/models/links.ts` with `trainingHref` only (Task 10 adds the builder helpers)
- Modify: `frontend/src/datasets/splitAdvice.ts` (an explicit input type, no project `Dataset` schema)
- Modify: `frontend/src/routes/appRoutes.tsx`
- Delete (if present): `frontend/src/screens/DatasetsScreen.tsx`, `frontend/src/screens/DatasetsScreen.test.tsx`,
  `frontend/src/datasets/DatasetList.tsx`, `frontend/src/datasets/DatasetList.test.tsx`,
  `frontend/src/datasets/DatasetDetail.tsx`, `frontend/src/datasets/DatasetDetail.test.tsx`,
  `frontend/src/datasets/NewDatasetForm.tsx`, `frontend/src/datasets/NewDatasetForm.test.tsx`
- Modify (fixtures): `frontend/e2e/fixtures/appSections.ts`
- Create (SH deleted the old `frontend/e2e/datasets.spec.ts` with the per-project Datasets screen; if it is still present, replace it): `frontend/e2e/datasets.spec.ts`

**Interfaces:**
- Consumes:
  - Task 7: `useLibraryDatasets`, `fetchLibraryDataset`, `deleteLibraryDataset`, `exportLibraryDataset`, `fetchDatasetSamples`
  - `useTrackedJob`, `useOnJobsFinished`, `thumbnailUrl` (from `@contract/client`), `useBackend`, `splitAdvice`
- Produces:
  - `datasetLabels.ts`:
    - `datasetStateLabel(d): {text; tone; live}`, `DATASET_TASK_LABEL`, `SPLIT_LABEL`
    - `sourcesText(d): string`, `toSplitAdviceInput(d): SplitAdviceInput`
  - `links.ts`: `trainingHref(opts?: {datasetId?: string}): string`
  - `useItemById(id, known, listLoading, fetchById, what): {item; missing; error}`
  - `DatasetDetail({dataset, onChanged, onDeleted, onClose})`
  - `DatasetsScreen()` at `/models/datasets` and `/models/datasets/:datasetId`. Task 10 adds the
    builder slot.

- [ ] **Step 1: Make `splitAdvice` independent of the removed project `Dataset` schema**

In `frontend/src/datasets/splitAdvice.ts`, replace the `import type { Dataset } …` line and the
`SplitAdviceInput` type with:

```ts
/** The fields `splitAdvice` needs; a library dataset maps onto it with `toSplitAdviceInput`. */
export interface SplitAdviceInput {
  image_count: number;
  train_count: number;
  val_count: number;
  split_method: "by_group" | "by_tile" | "random";
  split_params: { val_fraction: number };
}
```

Run: `pnpm -C frontend exec vitest run src/datasets/splitAdvice.test.ts`
Expected: PASS (unchanged behaviour). If that test imports `exampleDataset` and C0 removed it,
replace those inputs with object literals of the same five fields.

- [ ] **Step 2: Write the failing label tests**

Create `frontend/src/models/datasetLabels.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { exampleLibraryDataset } from "@/test/appSectionFixtures";
import { datasetStateLabel, sourcesText, toSplitAdviceInput } from "./datasetLabels";
import { trainingHref } from "./links";

describe("dataset labels", () => {
  it.each([
    [{ state: "resolving", export_state: "none" }, "Building", true],
    [{ state: "failed", export_state: "none" }, "Failed", false],
    [{ state: "ready", export_state: "none" }, "Ready", false],
    [{ state: "ready", export_state: "building" }, "Exporting", true],
    [{ state: "ready", export_state: "ready" }, "Exported", false],
    [{ state: "ready", export_state: "stale" }, "Export out of date", false],
    [{ state: "ready", export_state: "failed" }, "Export failed", false],
  ] as const)("%o reads %s", (d, text, live) => {
    expect(datasetStateLabel(d)).toMatchObject({ text, live });
  });

  it("names up to three source projects, then counts the rest", () => {
    const src = (name: string) => ({ ...exampleLibraryDataset.sources[0], project_id: name, project_name: name });
    expect(sourcesText(exampleLibraryDataset)).toBe("Ahmadia");
    expect(sourcesText({ sources: ["A", "B", "C", "D", "E"].map(src) })).toBe("A, B, C + 2 more");
  });

  it("maps counts onto the split advice input", () => {
    expect(toSplitAdviceInput(exampleLibraryDataset)).toEqual({
      image_count: 30,
      train_count: 24,
      val_count: 6,
      split_method: "by_group",
      split_params: { val_fraction: 0.2 },
    });
  });

  it("links a dataset to a new training run", () => {
    expect(trainingHref()).toBe("/models/training?new=1");
    expect(trainingHref({ datasetId: "d1" })).toBe("/models/training?new=1&dataset=d1");
  });
});
```

Run: `pnpm -C frontend exec vitest run src/models/datasetLabels.test.ts`
Expected: FAIL with `Failed to resolve import "./datasetLabels"`.

- [ ] **Step 3: Implement the labels and `trainingHref`**

Create `frontend/src/models/datasetLabels.ts`:

```ts
import type { DatasetTask, LibraryDataset } from "@/api/libraryDatasets";
import type { SplitAdviceInput } from "@/datasets/splitAdvice";
import type { PillTone } from "@/ui";

export const DATASET_TASK_LABEL: Record<DatasetTask, string> = {
  detect: "Boxes",
  obb: "Rotated boxes",
  segment: "Polygons",
};

export const SPLIT_LABEL: Record<string, string> = {
  by_group: "By flight",
  by_tile: "By place",
  random: "Random",
};

export interface DatasetStateLabel {
  text: string;
  tone: PillTone;
  live: boolean;
}

/** One pill for the build state and, once ready, the export state (F §12.1). */
export function datasetStateLabel(d: Pick<LibraryDataset, "state" | "export_state">): DatasetStateLabel {
  if (d.state === "resolving") return { text: "Building", tone: "accent", live: true };
  if (d.state === "failed") return { text: "Failed", tone: "danger", live: false };
  switch (d.export_state) {
    case "building":
      return { text: "Exporting", tone: "accent", live: true };
    case "ready":
      return { text: "Exported", tone: "ok", live: false };
    case "stale":
      return { text: "Export out of date", tone: "warn", live: false };
    case "failed":
      return { text: "Export failed", tone: "danger", live: false };
    default:
      return { text: "Ready", tone: "neutral", live: false };
  }
}

export function sourcesText(d: Pick<LibraryDataset, "sources">): string {
  const names = d.sources.map((s) => s.project_name);
  if (names.length <= 3) return names.join(", ");
  return `${names.slice(0, 3).join(", ")} + ${names.length - 3} more`;
}

const SPLITS: SplitAdviceInput["split_method"][] = ["by_group", "by_tile", "random"];

/** BM types `split_method` as a string and `split_params` as a number map; advice needs the known shape. */
export function toSplitAdviceInput(d: LibraryDataset): SplitAdviceInput {
  const method = SPLITS.find((m) => m === d.split_method) ?? "random";
  return {
    image_count: d.counts.images,
    train_count: d.counts.train,
    val_count: d.counts.val,
    split_method: method,
    split_params: { val_fraction: Number(d.split_params.val_fraction ?? 0.2) },
  };
}
```

Create `frontend/src/models/links.ts`:

```ts
/** The "New training run" drawer, optionally with a dataset preselected (plan decision 11). */
export function trainingHref(opts: { datasetId?: string } = {}): string {
  const q = new URLSearchParams({ new: "1" });
  if (opts.datasetId) q.set("dataset", opts.datasetId);
  return `/models/training?${q}`;
}
```

Run: `pnpm -C frontend exec vitest run src/models/datasetLabels.test.ts`
Expected: PASS (10 tests).

- [ ] **Step 4: Write the failing screen tests**

Create `frontend/src/models/DatasetsScreen.test.tsx`:

```tsx
import { beforeEach, describe, expect, it } from "vitest";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { errorBody, fakeClient, IMAGE_ID, runningJob, type FakeRoute } from "@/test/fixtures";
import { exampleDatasetItems, exampleLibraryDataset, LIB_DATASET_ID } from "@/test/appSectionFixtures";
import { renderWithProviders } from "@/test/render";
import { useJobsStore } from "@/store/jobs";
import { DatasetsScreen } from "./DatasetsScreen";

const LIST: FakeRoute = {
  method: "GET",
  path: /\/library\/datasets$/,
  body: { items: [exampleLibraryDataset], next_cursor: null },
};
const ITEMS: FakeRoute = { method: "GET", path: /\/items$/, body: exampleDatasetItems };

function renderDatasets(route: string, routes: FakeRoute[] = [LIST, ITEMS]) {
  const { api, requests } = fakeClient(routes);
  renderWithProviders(<DatasetsScreen />, { api, route, path: "/models/datasets/:datasetId?" });
  return requests;
}

describe("DatasetsScreen (F §12.4)", () => {
  beforeEach(() => useJobsStore.setState({ jobs: {} }));

  it("lists datasets with their sources, images, split and state", async () => {
    renderDatasets("/models/datasets");
    const row = await screen.findByRole("row", { name: /machines-v1/ });
    expect(row).toHaveTextContent("Ahmadia");
    expect(row).toHaveTextContent("30");
    expect(row).toHaveTextContent("24 / 6");
    expect(row).toHaveTextContent("Ready");
  });

  it("opens the detail with classes, sources, samples and the training link", async () => {
    renderDatasets(`/models/datasets/${LIB_DATASET_ID}`);
    expect(await screen.findByRole("heading", { name: "machines-v1" })).toBeInTheDocument();
    const classes = screen.getByTestId("dataset-classes");
    expect(within(classes).getByText("Dump truck")).toBeInTheDocument();
    expect(within(classes).getByText("72")).toBeInTheDocument();
    expect(screen.getByTestId("dataset-sources")).toHaveTextContent("E:\\Projects\\Ahmadia");
    const img = await screen.findByRole("img", { name: "train image, 3 labels" });
    expect(img.getAttribute("src")).toContain(`/images/${IMAGE_ID}/thumbnail`);
    expect(screen.getByRole("link", { name: "Train on this dataset" })).toHaveAttribute(
      "href",
      `/models/training?new=1&dataset=${LIB_DATASET_ID}`,
    );
  });

  it("builds the export as a job and shows it running", async () => {
    const requests = renderDatasets(`/models/datasets/${LIB_DATASET_ID}`, [
      LIST,
      ITEMS,
      { method: "POST", path: /\/export$/, status: 202, body: { job: { ...runningJob, id: "j-exp", project_id: "library", type: "dataset" } } },
      { method: "GET", path: /\/library\/jobs\/j-exp$/, body: { ...runningJob, id: "j-exp", project_id: "library", type: "dataset" } },
    ]);
    fireEvent.click(await screen.findByRole("button", { name: "Build export" }));
    await waitFor(() => expect(requests.some((r) => r.method === "POST" && r.url.endsWith("/export"))).toBe(true));
    expect(await screen.findAllByText("Exporting")).not.toHaveLength(0);
  });

  it("deletes after a confirmation and returns to the list", async () => {
    const requests = renderDatasets(`/models/datasets/${LIB_DATASET_ID}`, [
      LIST,
      ITEMS,
      { method: "DELETE", path: /\/library\/datasets\/[^/]+$/, status: 204 },
    ]);
    fireEvent.click(await screen.findByRole("button", { name: "Delete dataset" }));
    expect(screen.getByText(/Delete dataset machines-v1\?/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Delete permanently" }));
    await waitFor(() => expect(requests.some((r) => r.method === "DELETE")).toBe(true));
    await waitFor(() => expect(screen.queryByRole("row", { name: /machines-v1/ })).not.toBeInTheDocument());
    expect(screen.queryByRole("heading", { name: "machines-v1" })).not.toBeInTheDocument();
  });

  it("a dataset link that no longer exists says so", async () => {
    renderDatasets("/models/datasets/gone", [
      LIST,
      { method: "GET", path: /\/library\/datasets\/gone$/, status: 404, body: errorBody("not_found", "no dataset") },
    ]);
    expect(await screen.findByText("That dataset no longer exists")).toBeInTheDocument();
    expect(screen.getByRole("row", { name: /machines-v1/ })).toBeInTheDocument();
  });

  it("blocks with the reason when the library is unavailable", async () => {
    renderDatasets("/models/datasets", [
      { method: "GET", path: /\/library\/datasets$/, status: 503, body: errorBody("library_unavailable", "no library") },
    ]);
    expect(await screen.findByText("The model library could not be opened")).toBeInTheDocument();
  });
});
```

Run: `pnpm -C frontend exec vitest run src/models/DatasetsScreen.test.tsx`
Expected: FAIL with `Failed to resolve import "./DatasetsScreen"`.

- [ ] **Step 5: Implement the by-id hook, the detail and the screen**

Create `frontend/src/models/useItemById.ts` (Task 11 reuses it for training runs):

```ts
import { useEffect, useRef, useState } from "react";
import { ApiFailure, codeOf, messageOf } from "@/api/errors";
import { pushLog } from "@/app/diagnostics";

export interface ItemById<T> {
  item: T | null;
  /** The server answered 404: the link names something that no longer exists. */
  missing: boolean;
  error: string | null;
}

/**
 * The item a route names: from the loaded pages when it is there, else fetched by id (a deep link
 * past page one, or one copied before a restart). A 404 is `missing`, never an endless skeleton.
 */
export function useItemById<T extends { id: string }>(
  id: string | null,
  known: T[],
  listLoading: boolean,
  fetchById: (id: string) => Promise<T>,
  what: string,
): ItemById<T> {
  const fromList = id ? (known.find((x) => x.id === id) ?? null) : null;
  const need = Boolean(id) && !fromList && !listLoading;
  const fetchRef = useRef(fetchById);
  useEffect(() => {
    fetchRef.current = fetchById;
  }, [fetchById]);
  const [fetched, setFetched] = useState<({ id: string } & ItemById<T>) | null>(null);

  useEffect(() => {
    if (!need || !id) return;
    let cancelled = false;
    fetchRef
      .current(id)
      .then((item) => {
        if (!cancelled) setFetched({ id, item, missing: false, error: null });
      })
      .catch((e: unknown) => {
        if (cancelled) return;
        pushLog(`load ${what} ${id} failed: ${messageOf(e, String(e))}`);
        const missing = codeOf(e) === "not_found" || (e instanceof ApiFailure && e.status === 404);
        setFetched({ id, item: null, missing, error: missing ? null : messageOf(e, `could not load the ${what}`) });
      });
    return () => {
      cancelled = true;
    };
  }, [id, need, what]);

  if (fromList) return { item: fromList, missing: false, error: null };
  if (fetched && fetched.id === id) return { item: fetched.item, missing: fetched.missing, error: fetched.error };
  return { item: null, missing: false, error: null };
}
```

Create `frontend/src/models/DatasetDetail.tsx`:

```tsx
import { useEffect, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { thumbnailUrl } from "@contract/client";
import { useApi, useBackend } from "@/api/client";
import { messageOf } from "@/api/errors";
import { LIBRARY_JOBS } from "@/api/library";
import {
  deleteLibraryDataset,
  exportLibraryDataset,
  fetchDatasetSamples,
  type LibraryDataset,
  type LibraryDatasetItem,
} from "@/api/libraryDatasets";
import { pushLog } from "@/app/diagnostics";
import { splitAdvice } from "@/datasets/splitAdvice";
import { jobTitle } from "@/jobs/jobLabels";
import { useTrackedJob } from "@/jobs/useTrackedJob";
import { formatLocalDate } from "@/library/modelLabels";
import { useJobsStore } from "@/store/jobs";
import {
  Alert,
  Button,
  IconButton,
  InspectorPane,
  InspectorSection,
  Pill,
  Progress,
  SkeletonRows,
  buttonClass,
} from "@/ui";
import { DATASET_TASK_LABEL, SPLIT_LABEL, datasetStateLabel, toSplitAdviceInput } from "./datasetLabels";
import { trainingHref } from "./links";

export interface DatasetDetailProps {
  dataset: LibraryDataset;
  onChanged: (dataset: LibraryDataset) => void;
  onDeleted: (id: string) => void;
  onClose: () => void;
}

function Row({ term, children, mono }: { term: string; children: ReactNode; mono?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-4 py-1.5 text-sm">
      <dt className="shrink-0 text-muted">{term}</dt>
      <dd className={mono ? "min-w-0 truncate font-mono text-xs" : "font-medium tabular-nums"}>{children}</dd>
    </div>
  );
}

/** 24 referenced images through the per-project thumbnail route; nothing is copied (F §12.2). */
function DatasetSamples({ datasetId }: { datasetId: string }) {
  const api = useApi();
  const { baseUrl, token } = useBackend();
  const [state, setState] = useState<{ id: string; items: LibraryDatasetItem[]; error: string | null } | null>(null);
  useEffect(() => {
    let cancelled = false;
    fetchDatasetSamples(api, datasetId)
      .then((items) => {
        if (!cancelled) setState({ id: datasetId, items, error: null });
      })
      .catch((e: unknown) => {
        if (!cancelled) setState({ id: datasetId, items: [], error: messageOf(e, "could not load the samples") });
      });
    return () => {
      cancelled = true;
    };
  }, [api, datasetId]);
  if (!state || state.id !== datasetId) return <SkeletonRows rows={2} columns={4} />;
  if (state.error) return <p className="text-xs text-muted">{state.error}</p>;
  return (
    <ul data-testid="dataset-samples" className="grid grid-cols-4 gap-1.5">
      {state.items.map((i) => (
        <li key={`${i.project_id}/${i.image_id}`}>
          <img
            src={thumbnailUrl(baseUrl, token, i.project_id, i.image_id)}
            alt={`${i.split} image, ${i.label_count} labels`}
            loading="lazy"
            className="aspect-[4/3] w-full rounded-sm bg-surface-2 object-cover"
          />
        </li>
      ))}
    </ul>
  );
}

export function DatasetDetail({ dataset, onChanged, onDeleted, onClose }: DatasetDetailProps) {
  const api = useApi();
  const building = dataset.state === "resolving" || dataset.export_state === "building";
  // `job_id` is the dataset's latest job: the build, then the export.
  const { job } = useTrackedJob(LIBRARY_JOBS, building || dataset.state === "failed" ? dataset.job_id : null);
  const state = datasetStateLabel(dataset);
  const advice = dataset.state === "ready" ? splitAdvice(toSplitAdviceInput(dataset)) : null;
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function remove() {
    setBusy(true);
    setError(null);
    try {
      await deleteLibraryDataset(api, dataset.id);
      onDeleted(dataset.id);
    } catch (e) {
      pushLog(`delete dataset ${dataset.id} failed: ${messageOf(e, String(e))}`);
      setError(messageOf(e, "could not delete the dataset"));
      setBusy(false);
    }
  }

  async function buildExport() {
    setExporting(true);
    setError(null);
    try {
      const started = await exportLibraryDataset(api, dataset.id);
      useJobsStore.getState().upsert(started);
      onChanged({ ...dataset, export_state: "building", job_id: started.id });
    } catch (e) {
      pushLog(`export dataset ${dataset.id} failed: ${messageOf(e, String(e))}`);
      setError(messageOf(e, "could not start the export"));
    } finally {
      setExporting(false);
    }
  }

  return (
    <InspectorPane
      label="Dataset"
      header={
        <div className="flex items-center gap-2">
          <h2 className="min-w-0 flex-1 truncate text-lg font-semibold">{dataset.name}</h2>
          <Pill tone={state.tone} live={state.live} size="sm">
            {state.text}
          </Pill>
          <IconButton icon="x" label="Close dataset" size="sm" onClick={onClose} />
        </div>
      }
      footer={
        <div className="flex flex-wrap items-center gap-2">
          {dataset.state === "ready" && !confirming && (
            <Link to={trainingHref({ datasetId: dataset.id })} className={buttonClass("primary", "sm")}>
              Train on this dataset
            </Link>
          )}
          {confirming ? (
            <>
              <span className="basis-full text-xs text-danger">
                Delete dataset {dataset.name}? Its export folder goes too; project images are never touched.
              </span>
              <Button size="sm" variant="danger" loading={busy} onClick={() => void remove()}>
                Delete permanently
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setConfirming(false)} disabled={busy}>
                Keep it
              </Button>
            </>
          ) : (
            <Button size="sm" variant="ghost" className="ml-auto" onClick={() => setConfirming(true)}>
              Delete dataset
            </Button>
          )}
        </div>
      }
    >
      {building && job && (
        <InspectorSection title="Progress">
          <Progress value={job.progress} running={job.state === "running"} label={`${jobTitle(job)} progress`} />
          {job.message && <p className="mt-1 text-xs text-muted">{job.message}</p>}
        </InspectorSection>
      )}
      {dataset.state === "failed" && (
        <Alert tone="danger" title="The dataset could not be built">
          {job?.error ?? "Open Jobs for the log."}
        </Alert>
      )}

      <InspectorSection title="Split">
        <dl className="divide-y divide-line">
          <Row term="Task">{DATASET_TASK_LABEL[dataset.task]}</Row>
          <Row term="Split">
            {SPLIT_LABEL[dataset.split_method] ?? dataset.split_method} ·{" "}
            {Math.round(Number(dataset.split_params.val_fraction ?? 0) * 100)}% validation
          </Row>
          <Row term="Images">{dataset.counts.images}</Row>
          <Row term="Train / val">
            {dataset.counts.train} / {dataset.counts.val}
          </Row>
          <Row term="Created">{formatLocalDate(dataset.created_at)}</Row>
        </dl>
        {advice && <Alert tone="warn">{advice}</Alert>}
      </InspectorSection>

      <InspectorSection title="Classes">
        <table data-testid="dataset-classes" className="w-full text-sm">
          <tbody>
            {dataset.classes.map((c, i) => (
              <tr key={c.type_id} className="border-b border-line last:border-b-0">
                <td className="w-6 py-1.5 font-mono text-xs tabular-nums text-dim">{i}</td>
                <td className="py-1.5">{c.name}</td>
                <td className="py-1.5 text-right font-mono tabular-nums">{dataset.counts.per_class[c.type_id] ?? 0}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </InspectorSection>

      <InspectorSection title="Sources">
        <ul data-testid="dataset-sources" className="flex flex-col divide-y divide-line">
          {dataset.sources.map((s) => (
            <li key={s.project_id} className="flex flex-col gap-0.5 py-1.5">
              <span className="flex items-baseline justify-between gap-3 text-sm">
                <span className="truncate font-medium">{s.project_name}</span>
                <span className="font-mono tabular-nums">{s.image_count}</span>
              </span>
              <span className="truncate font-mono text-xs text-muted">{s.project_folder}</span>
            </li>
          ))}
        </ul>
      </InspectorSection>

      {dataset.state === "ready" && (
        <InspectorSection title="Samples">
          <DatasetSamples datasetId={dataset.id} />
        </InspectorSection>
      )}

      <InspectorSection title="Export">
        {dataset.origin === "legacy" ? (
          <>
            <p className="text-xs text-muted">A dataset from before the Models section. It trains from its own folder.</p>
            <p className="mt-1 break-all font-mono text-xs">{dataset.legacy_path}</p>
          </>
        ) : (
          <div className="flex flex-col gap-2">
            {dataset.export_state === "ready" && dataset.export_path && (
              <p className="break-all font-mono text-xs">{dataset.export_path}</p>
            )}
            <p className="text-xs text-muted">
              {dataset.task === "segment"
                ? "Polygon datasets export with the Images workspace."
                : "Training builds the export when it needs one. Build it here to use the files elsewhere."}
            </p>
            <Button
              size="sm"
              className="self-start"
              loading={exporting}
              disabled={dataset.state !== "ready" || dataset.export_state === "building" || dataset.task === "segment"}
              onClick={() => void buildExport()}
            >
              {dataset.export_state === "none" ? "Build export" : "Rebuild export"}
            </Button>
          </div>
        )}
        {error && <Alert tone="danger">{error}</Alert>}
      </InspectorSection>
    </InspectorPane>
  );
}
```

Create `frontend/src/models/DatasetsScreen.tsx`:

```tsx
import { useCallback, useMemo } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useApi } from "@/api/client";
import { fetchLibraryDataset, type LibraryDataset } from "@/api/libraryDatasets";
import { useProvideRouteActions, type RouteAction } from "@/app/routeActions";
import { useOnJobsFinished } from "@/jobs/useOnJobsFinished";
import { formatLocalDate } from "@/library/modelLabels";
import {
  Alert,
  Button,
  DataTable,
  EmptyState,
  GlassPanel,
  Pill,
  SkeletonRows,
  type Column,
} from "@/ui";
import { DatasetDetail } from "./DatasetDetail";
import { DATASET_TASK_LABEL, datasetStateLabel, sourcesText } from "./datasetLabels";
import { useItemById } from "./useItemById";
import { useLibraryDatasets } from "./useLibraryDatasets";

const COLUMNS: Column<LibraryDataset>[] = [
  {
    key: "name",
    header: "Dataset",
    width: "minmax(10rem,2fr)",
    render: (d) => (
      <span className="flex min-w-0 items-center gap-2">
        <span className="truncate font-medium">{d.name}</span>
        {d.origin === "legacy" && <Pill size="sm">Legacy</Pill>}
      </span>
    ),
  },
  { key: "task", header: "Task", width: "7rem", render: (d) => <span className="text-muted">{DATASET_TASK_LABEL[d.task]}</span> },
  {
    key: "sources",
    header: "Sources",
    width: "minmax(9rem,2fr)",
    render: (d) => <span className="truncate text-muted">{sourcesText(d)}</span>,
  },
  {
    key: "images",
    header: "Images",
    width: "5rem",
    render: (d) => <span className="font-mono tabular-nums">{d.counts.images}</span>,
  },
  {
    key: "split",
    header: "Train / val",
    width: "7rem",
    render: (d) => (
      <span className="font-mono tabular-nums text-muted">
        {d.counts.train} / {d.counts.val}
      </span>
    ),
  },
  {
    key: "state",
    header: "State",
    width: "9rem",
    render: (d) => {
      const s = datasetStateLabel(d);
      return (
        <Pill tone={s.tone} live={s.live} size="sm">
          {s.text}
        </Pill>
      );
    },
  },
  {
    key: "created",
    header: "Created",
    width: "9rem",
    render: (d) => <span className="font-mono text-xs tabular-nums text-muted">{formatLocalDate(d.created_at)}</span>,
  },
];

/** F §12.4: datasets built across projects, with the detail at `/models/datasets/:datasetId`. */
export function DatasetsScreen() {
  const { datasetId = null } = useParams();
  const api = useApi();
  const navigate = useNavigate();
  const list = useLibraryDatasets();
  const fetchDataset = useCallback((id: string) => fetchLibraryDataset(api, id), [api]);
  const { reload } = list;
  useOnJobsFinished("dataset_build", reload);
  useOnJobsFinished("dataset", reload);

  const actions = useMemo<RouteAction[]>(
    () => [{ id: "new-dataset", label: "New dataset", icon: "plus", variant: "primary", to: "/models/datasets?new=1" }],
    [],
  );
  useProvideRouteActions(actions);

  const selected = useItemById(datasetId, list.datasets, list.loading, fetchDataset, "dataset");
  const count = list.datasets.length;

  return (
    <section className="flex flex-col gap-4">
      <header className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <h2 className="text-lg font-semibold">Datasets</h2>
        {!list.loading && !list.unavailable && (
          <span className="text-xs tabular-nums text-muted">
            {count}
            {list.hasMore ? "+" : ""} {count === 1 ? "dataset" : "datasets"}
          </span>
        )}
        <p className="basis-full text-sm text-muted">
          A dataset gathers labelled images from any of your projects. Images are copied only when an export is
          built.
        </p>
      </header>

      {list.unavailable && (
        <Alert tone="danger" title="The model library could not be opened">
          Datasets and training need the library. Check the library folder, then restart the app.
        </Alert>
      )}
      {list.error && (
        <Alert
          tone="danger"
          actions={
            <Button size="sm" onClick={list.reload}>
              Retry
            </Button>
          }
        >
          {list.error}
        </Alert>
      )}

      {!list.unavailable && (
        <div className="grid items-start gap-4 min-[1100px]:grid-cols-[minmax(0,1fr)_340px]">
          <GlassPanel variant="pane" className="min-w-0 overflow-hidden">
            <DataTable
              label="Datasets"
              columns={COLUMNS}
              rows={list.datasets}
              rowKey={(d) => d.id}
              activeKey={datasetId}
              onOpen={(d) => navigate(`/models/datasets/${d.id}`)}
              loading={list.loading}
              onEndReached={list.hasMore ? list.loadMore : undefined}
              empty={
                <EmptyState icon="datasets" title="No datasets yet">
                  Choose New dataset to gather labelled images from your projects.
                </EmptyState>
              }
            />
          </GlassPanel>
          {datasetId &&
            (selected.item ? (
              <DatasetDetail
                key={selected.item.id}
                dataset={selected.item}
                onChanged={list.put}
                onDeleted={(id) => {
                  list.remove(id);
                  navigate("/models/datasets");
                }}
                onClose={() => navigate("/models/datasets")}
              />
            ) : selected.missing ? (
              <GlassPanel variant="pane" className="p-4">
                <EmptyState icon="datasets" title="That dataset no longer exists">
                  It was deleted, or the link is out of date. Choose one from the list.
                </EmptyState>
              </GlassPanel>
            ) : selected.error ? (
              <Alert tone="danger">{selected.error}</Alert>
            ) : (
              <GlassPanel variant="pane" className="p-4">
                <SkeletonRows rows={4} columns={2} />
              </GlassPanel>
            ))}
        </div>
      )}
    </section>
  );
}
```

- [ ] **Step 6: Add the routes and delete the project-scoped datasets UI**

In `frontend/src/routes/appRoutes.tsx`, add the lazy declaration, and swap the two `datasets…`
children of the `models` route. Then delete SH's now-unused `const datasets = (…)` placeholder
element.

```tsx
const DatasetsScreen = lazy(() => import("@/models/DatasetsScreen").then((m) => ({ default: m.DatasetsScreen })));
```

```tsx
        { path: "datasets", element: (<Later><DatasetsScreen /></Later>) },
        { path: "datasets/:datasetId", element: (<Later><DatasetsScreen /></Later>) },
```

Find the importers of the old files:

```powershell
Get-ChildItem frontend\src -Recurse -Include *.ts,*.tsx | Select-String -Pattern 'screens/DatasetsScreen','datasets/DatasetList','datasets/DatasetDetail','datasets/NewDatasetForm' | Select-Object Path,LineNumber,Line
```

Expected: only the files about to be deleted. SH's plan rewrites `routes.tsx` into
`routes/tree.tsx` and adds the redirects in `routes/legacyRedirects.tsx`, so neither should appear.
If one does, remove the import and point its route at the redirect to `/models/datasets?project=:id`
(§5.3). Then delete:

```powershell
git rm --ignore-unmatch frontend/src/screens/DatasetsScreen.tsx frontend/src/screens/DatasetsScreen.test.tsx frontend/src/datasets/DatasetList.tsx frontend/src/datasets/DatasetList.test.tsx frontend/src/datasets/DatasetDetail.tsx frontend/src/datasets/DatasetDetail.test.tsx frontend/src/datasets/NewDatasetForm.tsx frontend/src/datasets/NewDatasetForm.test.tsx
```

Run: `pnpm -C frontend exec vitest run src/models src/datasets`
Expected: PASS (label, list-hook, layout and 6 screen tests, and splitAdvice).

- [ ] **Step 7: Rewrite the datasets e2e for the Models route**

Add to `frontend/e2e/fixtures/appSections.ts`:

```ts
export const LIB_DATASET = {
  id: "d-lib-1",
  name: "machines-v1",
  task: "detect",
  origin: "built",
  filter: { project_ids: [P], type_ids: ["t-1", "t-2"], captured_from: null, captured_to: null, reviewed_only: true },
  classes: [
    { type_id: "t-1", name: "Excavator" },
    { type_id: "t-2", name: "Dump truck" },
  ],
  split_method: "by_group",
  split_params: { val_fraction: 0.2, seed: 42 },
  state: "ready",
  counts: { images: 30, train: 24, val: 6, per_class: { "t-1": 40, "t-2": 72 } },
  export_path: null,
  export_state: "none",
  legacy_path: null,
  job_id: "j-build",
  created_at: T0,
  sources: [{ project_id: P, project_name: "Ahmadia", project_folder: "E:\\Projects\\Ahmadia", image_count: 30 }],
};

/** A queued library job; `patch` sets the id, type and params (export, build and training fixtures). */
export function libraryJob(patch: Record<string, unknown>) {
  return {
    id: "j-lib",
    project_id: "library",
    type: "dataset",
    state: "queued",
    progress: 0,
    message: "",
    log_path: "library/runs/j-lib/job.log",
    params: {},
    result: null,
    error: null,
    created_at: T0,
    started_at: null,
    finished_at: null,
    ...patch,
  };
}

export const EXPORT_JOB = libraryJob({ id: "j-export", type: "dataset", params: { dataset_id: "d-lib-1" } });

/** Routes every `/library/datasets…` request to fixtures (Task 10 adds preview and create). */
export async function routeDatasets(page: import("@playwright/test").Page): Promise<void> {
  await page.route(
    (url) => url.pathname.startsWith("/api/v1/library/datasets"),
    (route) => {
      const { pathname } = new URL(route.request().url());
      const method = route.request().method();
      if (pathname === "/api/v1/library/datasets" && method === "GET")
        return fulfilJson(route, { items: [LIB_DATASET], next_cursor: null });
      if (pathname.endsWith("/items")) return fulfilJson(route, { items: [], next_cursor: null });
      if (pathname.endsWith("/export")) return fulfilJson(route, { job: EXPORT_JOB }, 202);
      if (method === "DELETE") return route.fulfill({ status: 204, headers: { "Access-Control-Allow-Origin": "*" } });
      return fulfilJson(route, LIB_DATASET);
    },
  );
}
```

Write `frontend/e2e/datasets.spec.ts` (SH deleted the old one; replace it if still present):

```ts
import { expect, test } from "@playwright/test";
import { routeDatasets } from "./fixtures/appSections";

test("Models > Datasets lists a dataset built across projects, opens it, exports and deletes it", async ({
  page,
}) => {
  await routeDatasets(page);
  await page.goto("/models/datasets");
  await expect(page.getByRole("heading", { name: "Datasets", exact: true })).toBeVisible({ timeout: 15_000 });
  const row = page.getByRole("row", { name: /machines-v1/ });
  await expect(row).toContainText("Ahmadia");
  await expect(row).toContainText("24 / 6");

  await row.click();
  await expect(page).toHaveURL(/\/models\/datasets\/d-lib-1$/);
  await expect(page.getByTestId("dataset-classes")).toContainText("Dump truck");
  await expect(page.getByRole("link", { name: "Train on this dataset" })).toHaveAttribute(
    "href",
    "/models/training?new=1&dataset=d-lib-1",
  );

  const exported = page.waitForRequest((r) => r.method() === "POST" && r.url().endsWith("/datasets/d-lib-1/export"));
  await page.getByRole("button", { name: "Build export" }).click();
  await exported;

  await page.getByRole("button", { name: "Delete dataset" }).click();
  const deleted = page.waitForRequest((r) => r.method() === "DELETE" && r.url().endsWith("/datasets/d-lib-1"));
  await page.getByRole("button", { name: "Delete permanently" }).click();
  await deleted;
  await expect(page).toHaveURL(/\/models\/datasets$/);
});
```

Run: `$env:E2E_WEB_PORT=1520; $env:E2E_MOCK_PORT=4110; pnpm -C frontend exec playwright test e2e/datasets.spec.ts`
Expected: 1 passed.

- [ ] **Step 8: Lint, build and commit**

```powershell
pnpm -C frontend lint; pnpm -C frontend build
git add frontend/src/models/datasetLabels.ts frontend/src/models/datasetLabels.test.ts frontend/src/models/links.ts frontend/src/models/useItemById.ts frontend/src/models/DatasetDetail.tsx frontend/src/models/DatasetsScreen.tsx frontend/src/models/DatasetsScreen.test.tsx frontend/src/datasets/splitAdvice.ts frontend/src/datasets/splitAdvice.test.ts frontend/src/routes/appRoutes.tsx frontend/e2e/fixtures/appSections.ts frontend/e2e/datasets.spec.ts
git add frontend/src/routes/legacyRedirects.tsx  # only if Step 6 changed it
git commit -m "feat(models): datasets built across projects, with sources, samples, export and delete

Replaces the per-project Datasets screen (F §12.4); images are referenced, never copied
until an export is built.

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 10: Dataset builder with live preview counts

Load `impeccable`, `emil-design-eng` and `DESIGN.md` first.

**Files:**
- Modify: `frontend/src/models/links.ts` (+ `datasetBuilderHref`, `readBuilderPreset`)
- Create: `frontend/src/models/links.test.ts`
- Create: `frontend/src/models/builderModel.ts`, `frontend/src/models/builderModel.test.ts`
- Create: `frontend/src/models/useDatasetPreview.ts`, `frontend/src/models/useDatasetPreview.test.tsx`
- Create: `frontend/src/models/DatasetBuilder.tsx`, `frontend/src/models/DatasetBuilder.test.tsx`
- Modify: `frontend/src/models/DatasetsScreen.tsx`
- Modify: `frontend/e2e/fixtures/appSections.ts` (`routeDatasets` gains preview and create; `RECENT_PROJECT`)
- Modify: `frontend/e2e/datasets.spec.ts` (a second test)

**Interfaces:**
- Consumes:
  - Task 7: `previewDataset`, `createLibraryDataset`, `DatasetFilter`, `DatasetPreview`, `DatasetTask`
  - Task 6: `useRecentProjects`
  - Task 2: `useCatalogue`
  - Task 9: `DatasetsScreen`, `DATASET_TASK_LABEL`, `SPLIT_LABEL`
  - `useJobsStore`
- Produces:
  - `links.ts`:
    - `datasetBuilderHref(opts?: {projectIds?: string[]; typeIds?: string[]}): string`
    - `BuilderPreset {open; projectIds; typeIds}`, `readBuilderPreset(params): BuilderPreset`
  - `builderModel.ts`:
    - `BuilderForm`, `emptyBuilderForm(projectIds, typeIds)`
    - `toFilter(f): DatasetFilter | null`, `validateBuilder(f): string | null`
    - `toCreateBody(f): LibraryDatasetCreate`
  - `useDatasetPreview(filter: DatasetFilter | null): {preview; loading; error}`,
    `PREVIEW_DEBOUNCE_MS = 400`
  - `DatasetBuilder({initialProjectIds, initialTypeIds, onCreated, onClose})`

- [ ] **Step 1: Write the failing pure tests**

Create `frontend/src/models/links.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { datasetBuilderHref, readBuilderPreset } from "./links";

describe("dataset builder links (plan decision 9)", () => {
  it("builds the builder URL with optional presets", () => {
    expect(datasetBuilderHref()).toBe("/models/datasets?new=1");
    expect(datasetBuilderHref({ projectIds: ["p1"], typeIds: ["t1", "t2"] })).toBe(
      "/models/datasets?new=1&project=p1&types=t1%2Ct2",
    );
  });

  it("opens on ?new=1 or on ?project= alone (SH's /p/:id/datasets redirect)", () => {
    expect(readBuilderPreset(new URLSearchParams(""))).toEqual({ open: false, projectIds: [], typeIds: [] });
    expect(readBuilderPreset(new URLSearchParams("project=p1"))).toEqual({ open: true, projectIds: ["p1"], typeIds: [] });
    expect(readBuilderPreset(new URLSearchParams("new=1&types=t1,t2"))).toEqual({
      open: true,
      projectIds: [],
      typeIds: ["t1", "t2"],
    });
  });
});
```

Create `frontend/src/models/builderModel.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { emptyBuilderForm, toCreateBody, toFilter, validateBuilder } from "./builderModel";

const ready = { ...emptyBuilderForm(["p1"], ["t1"]), name: " machines-v2 " };

describe("dataset builder form", () => {
  it("has no filter until a project and a type are chosen", () => {
    expect(toFilter(emptyBuilderForm([], ["t1"]))).toBeNull();
    expect(toFilter(emptyBuilderForm(["p1"], []))).toBeNull();
    expect(toFilter(ready)).toEqual({
      project_ids: ["p1"],
      type_ids: ["t1"],
      captured_from: null,
      captured_to: null,
      reviewed_only: true,
    });
  });

  it("validates name, projects, types, dates and split", () => {
    expect(validateBuilder({ ...ready, name: " " })).toBe("Give the dataset a name.");
    expect(validateBuilder({ ...ready, projectIds: [] })).toBe("Choose at least one project.");
    expect(validateBuilder({ ...ready, typeIds: [] })).toBe("Choose at least one type.");
    expect(validateBuilder({ ...ready, from: "2026-05-02", to: "2026-05-01" })).toBe(
      "The start date is after the end date.",
    );
    expect(validateBuilder({ ...ready, valFraction: "0.9" })).toBe("Validation fraction must be between 0.05 and 0.5.");
    expect(validateBuilder({ ...ready, seed: "1.5" })).toBe("Seed must be a whole number.");
    expect(validateBuilder(ready)).toBeNull();
  });

  it("builds the create body", () => {
    expect(toCreateBody({ ...ready, from: "2026-04-01" })).toEqual({
      name: "machines-v2",
      task: "detect",
      filter: {
        project_ids: ["p1"],
        type_ids: ["t1"],
        captured_from: "2026-04-01",
        captured_to: null,
        reviewed_only: true,
      },
      split_method: "by_group",
      val_fraction: 0.2,
      seed: 42,
    });
  });
});
```

Run: `pnpm -C frontend exec vitest run src/models/links.test.ts src/models/builderModel.test.ts`
Expected: FAIL. `datasetBuilderHref` is not exported, and `./builderModel` does not resolve.

- [ ] **Step 2: Implement the links and the form model**

Append to `frontend/src/models/links.ts`:

```ts
/** The dataset builder, optionally preselected (the Images tab's "Use in dataset…", plan decision 9). */
export function datasetBuilderHref(opts: { projectIds?: string[]; typeIds?: string[] } = {}): string {
  const q = new URLSearchParams({ new: "1" });
  if (opts.projectIds?.length) q.set("project", opts.projectIds.join(","));
  if (opts.typeIds?.length) q.set("types", opts.typeIds.join(","));
  return `/models/datasets?${q}`;
}

export interface BuilderPreset {
  open: boolean;
  projectIds: string[];
  typeIds: string[];
}

export function readBuilderPreset(params: URLSearchParams): BuilderPreset {
  const list = (key: string) =>
    (params.get(key) ?? "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
  const projectIds = list("project");
  return { open: params.get("new") === "1" || projectIds.length > 0, projectIds, typeIds: list("types") };
}
```

Create `frontend/src/models/builderModel.ts`:

```ts
import type { DatasetFilter, DatasetTask, LibraryDatasetCreate } from "@/api/libraryDatasets";

export interface BuilderForm {
  name: string;
  projectIds: string[];
  /** The frozen class order is this order (F §12.1 `classes`). */
  typeIds: string[];
  from: string;
  to: string;
  reviewedOnly: boolean;
  task: DatasetTask;
  split: "by_group" | "by_tile" | "random";
  valFraction: string;
  seed: string;
}

export function emptyBuilderForm(projectIds: string[], typeIds: string[]): BuilderForm {
  return {
    name: "",
    projectIds,
    typeIds,
    from: "",
    to: "",
    reviewedOnly: true,
    task: "detect",
    split: "by_group",
    valFraction: "0.2",
    seed: "42",
  };
}

/** The preview's filter; null until at least one project and one type are chosen. */
export function toFilter(f: BuilderForm): DatasetFilter | null {
  if (f.projectIds.length === 0 || f.typeIds.length === 0) return null;
  return {
    project_ids: f.projectIds,
    type_ids: f.typeIds,
    captured_from: f.from || null,
    captured_to: f.to || null,
    reviewed_only: f.reviewedOnly,
  };
}

export function validateBuilder(f: BuilderForm): string | null {
  const name = f.name.trim();
  if (!name) return "Give the dataset a name.";
  if (name.length > 120) return "Keep the name to 120 characters or fewer.";
  if (f.projectIds.length === 0) return "Choose at least one project.";
  if (f.typeIds.length === 0) return "Choose at least one type.";
  if (f.from && f.to && f.from > f.to) return "The start date is after the end date.";
  const fraction = Number(f.valFraction);
  if (!(fraction >= 0.05 && fraction <= 0.5)) return "Validation fraction must be between 0.05 and 0.5.";
  if (!/^-?\d+$/.test(f.seed.trim())) return "Seed must be a whole number.";
  return null;
}

/** Only call after `validateBuilder` returned null. */
export function toCreateBody(f: BuilderForm): LibraryDatasetCreate {
  const filter = toFilter(f);
  if (!filter) throw new Error("toCreateBody needs a project and a type");
  return {
    name: f.name.trim(),
    task: f.task,
    filter,
    split_method: f.split,
    val_fraction: Number(f.valFraction),
    seed: Number(f.seed),
  };
}
```

Run: `pnpm -C frontend exec vitest run src/models/links.test.ts src/models/builderModel.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 3: Write the failing preview-hook test (Review Focus 2)**

Create `frontend/src/models/useDatasetPreview.test.tsx`:

```tsx
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { createApiClient, type ApiClient } from "@contract/client";
import type { DatasetFilter } from "@/api/libraryDatasets";
import { examplePreview } from "@/test/appSectionFixtures";
import { TestApiProvider } from "@/test/render";
import { PREVIEW_DEBOUNCE_MS, useDatasetPreview } from "./useDatasetPreview";

const filter = (projects: string[]): DatasetFilter => ({
  project_ids: projects,
  type_ids: ["t1"],
  captured_from: null,
  captured_to: null,
  reviewed_only: true,
});

/** Counts 10 images per project; a one-project filter answers after a slow second. */
function slowFirstApi(calls: string[][]): ApiClient {
  const fetchImpl = (async (input: Request | string | URL, init?: RequestInit) => {
    const req = input instanceof Request ? input : new Request(input, init);
    const body = JSON.parse(await req.text()) as DatasetFilter;
    calls.push(body.project_ids);
    if (body.project_ids.length === 1) await new Promise((r) => setTimeout(r, 1000));
    return new Response(JSON.stringify({ ...examplePreview, images: body.project_ids.length * 10 }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }) as typeof fetch;
  return createApiClient({ baseUrl: "http://fake", token: "t", fetch: fetchImpl });
}

describe("useDatasetPreview", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("waits for the filter to settle before counting", async () => {
    const calls: string[][] = [];
    const api = slowFirstApi(calls);
    const wrapper = ({ children }: { children: ReactNode }) => <TestApiProvider api={api}>{children}</TestApiProvider>;
    const { rerender } = renderHook(({ f }) => useDatasetPreview(f), {
      wrapper,
      initialProps: { f: filter(["a", "b"]) },
    });
    rerender({ f: filter(["a", "b", "c"]) });
    await act(() => vi.advanceTimersByTimeAsync(PREVIEW_DEBOUNCE_MS));
    expect(calls).toEqual([["a", "b", "c"]]);
  });

  it("never shows the counts of a filter that is no longer current", async () => {
    const calls: string[][] = [];
    const api = slowFirstApi(calls);
    const wrapper = ({ children }: { children: ReactNode }) => <TestApiProvider api={api}>{children}</TestApiProvider>;
    const { result, rerender } = renderHook(({ f }) => useDatasetPreview(f), {
      wrapper,
      initialProps: { f: filter(["a"]) },
    });
    await act(() => vi.advanceTimersByTimeAsync(PREVIEW_DEBOUNCE_MS));
    rerender({ f: filter(["a", "b"]) });
    await act(() => vi.advanceTimersByTimeAsync(PREVIEW_DEBOUNCE_MS));
    await vi.waitFor(() => expect(result.current.preview?.images).toBe(20));
    await act(() => vi.advanceTimersByTimeAsync(1000));
    expect(result.current.preview?.images).toBe(20);
    expect(calls).toEqual([["a"], ["a", "b"]]);
  });

  it("does nothing without a filter", () => {
    const calls: string[][] = [];
    const api = slowFirstApi(calls);
    const wrapper = ({ children }: { children: ReactNode }) => <TestApiProvider api={api}>{children}</TestApiProvider>;
    const { result } = renderHook(() => useDatasetPreview(null), { wrapper });
    expect(result.current).toEqual({ preview: null, loading: false, error: null });
  });
});
```

Run: `pnpm -C frontend exec vitest run src/models/useDatasetPreview.test.tsx`
Expected: FAIL with `Failed to resolve import "./useDatasetPreview"`.

- [ ] **Step 4: Implement the preview hook**

Create `frontend/src/models/useDatasetPreview.ts`:

```ts
import { useEffect, useState } from "react";
import { useApi } from "@/api/client";
import { messageOf } from "@/api/errors";
import { previewDataset, type DatasetFilter, type DatasetPreview } from "@/api/libraryDatasets";
import { pushLog } from "@/app/diagnostics";

export const PREVIEW_DEBOUNCE_MS = 400;

interface State {
  key: string;
  preview: DatasetPreview | null;
  error: string | null;
}

/**
 * The builder's live counts (F §12.2 step 1): COUNT queries on the server, asked once the filter
 * has been still for 400 ms. An answer for an older filter is dropped (Review Focus 2).
 */
export function useDatasetPreview(filter: DatasetFilter | null): {
  preview: DatasetPreview | null;
  loading: boolean;
  error: string | null;
} {
  const api = useApi();
  const key = filter ? JSON.stringify(filter) : "";
  const [state, setState] = useState<State>({ key: "", preview: null, error: null });

  useEffect(() => {
    if (!key) return;
    let cancelled = false;
    const current = JSON.parse(key) as DatasetFilter;
    const timer = window.setTimeout(() => {
      previewDataset(api, current)
        .then((preview) => {
          if (!cancelled) setState({ key, preview, error: null });
        })
        .catch((e: unknown) => {
          if (cancelled) return;
          pushLog(`dataset preview failed: ${messageOf(e, String(e))}`);
          setState({ key, preview: null, error: messageOf(e, "could not count the images") });
        });
    }, PREVIEW_DEBOUNCE_MS);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [api, key]);

  if (!key) return { preview: null, loading: false, error: null };
  const answered = state.key === key;
  return { preview: answered ? state.preview : null, loading: !answered, error: answered ? state.error : null };
}
```

Run: `pnpm -C frontend exec vitest run src/models/useDatasetPreview.test.tsx`
Expected: PASS (3 tests).

- [ ] **Step 5: Write the failing builder tests**

Create `frontend/src/models/DatasetBuilder.test.tsx`:

```tsx
import { describe, expect, it, vi } from "vitest";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { errorBody, exampleProject, fakeClient, PROJECT_ID, runningJob, type FakeRoute } from "@/test/fixtures";
import {
  exampleCataloguePage,
  exampleLibraryDataset,
  examplePreview,
  TYPE_ID,
} from "@/test/appSectionFixtures";
import { renderWithProviders } from "@/test/render";
import { useJobsStore } from "@/store/jobs";
import { DatasetBuilder } from "./DatasetBuilder";

const PROJECTS: FakeRoute = { method: "GET", path: /\/api\/v1\/projects$/, body: { items: [exampleProject], next_cursor: null } };
const TYPES: FakeRoute = { method: "GET", path: /\/catalogue\/types$/, body: exampleCataloguePage };
const PREVIEW: FakeRoute = { method: "POST", path: /\/preview$/, body: examplePreview };

function renderBuilder(routes: FakeRoute[] = [PROJECTS, TYPES, PREVIEW], types = [TYPE_ID(1), TYPE_ID(2)]) {
  const { api, requests } = fakeClient(routes);
  const onCreated = vi.fn();
  const onClose = vi.fn();
  renderWithProviders(
    <DatasetBuilder initialProjectIds={[PROJECT_ID]} initialTypeIds={types} onCreated={onCreated} onClose={onClose} />,
    { api },
  );
  return { requests, onCreated, onClose };
}

describe("DatasetBuilder (F §12.2, §12.4)", () => {
  it("preselects the link's project and types and shows the live counts", async () => {
    renderBuilder();
    expect(await screen.findByLabelText("Ahmadia")).toBeChecked();
    expect(await screen.findByLabelText("Dump truck")).toBeChecked();
    expect(screen.getByLabelText("Crack")).not.toBeChecked();
    expect(screen.queryByLabelText("Spalling")).not.toBeInTheDocument();
    await waitFor(() => expect(screen.getByTestId("preview-images")).toHaveTextContent("30"));
    expect(within(screen.getByTestId("preview-types")).getByText("72")).toBeInTheDocument();
  });

  it("creates the dataset as a build job and hands it over", async () => {
    const created = { ...exampleLibraryDataset, id: "d-new", name: "machines-v2", state: "resolving" as const };
    const job = { ...runningJob, id: "j-build", project_id: "library", type: "dataset_build" as const };
    const { requests, onCreated } = renderBuilder([
      PROJECTS,
      TYPES,
      PREVIEW,
      { method: "POST", path: /\/library\/datasets$/, status: 202, body: { dataset: created, job } },
    ]);
    await screen.findByLabelText("Dump truck");
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "machines-v2" } });
    fireEvent.click(screen.getByRole("button", { name: "Create dataset" }));
    await waitFor(() => expect(onCreated).toHaveBeenCalledWith(created));
    expect(requests.find((r) => r.method === "POST" && r.url.endsWith("/library/datasets"))?.body).toEqual({
      name: "machines-v2",
      task: "detect",
      filter: {
        project_ids: [PROJECT_ID],
        type_ids: [TYPE_ID(1), TYPE_ID(2)],
        captured_from: null,
        captured_to: null,
        reviewed_only: true,
      },
      split_method: "by_group",
      val_fraction: 0.2,
      seed: 42,
    });
    expect(useJobsStore.getState().jobs["j-build"]?.type).toBe("dataset_build");
  });

  it("refuses to create without a type, before sending", async () => {
    const { requests } = renderBuilder([PROJECTS, TYPES, PREVIEW], []);
    await screen.findByLabelText("Dump truck");
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "x" } });
    fireEvent.click(screen.getByRole("button", { name: "Create dataset" }));
    expect(screen.getByText("Choose at least one type.")).toBeInTheDocument();
    expect(requests.some((r) => r.url.endsWith("/library/datasets"))).toBe(false);
  });

  it("says when nothing matches and keeps Create off", async () => {
    renderBuilder([PROJECTS, TYPES, { method: "POST", path: /\/preview$/, body: { ...examplePreview, images: 0 } }]);
    expect(await screen.findByText("No labelled images match this filter.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Create dataset" })).toBeDisabled();
  });

  it("explains that types cannot be chosen while the catalogue is unavailable", async () => {
    renderBuilder([
      PROJECTS,
      PREVIEW,
      { method: "GET", path: /\/catalogue\/types$/, status: 503, body: errorBody("catalogue_unavailable", "locked") },
    ]);
    expect(
      await screen.findByText("The catalogue is not available, so types cannot be chosen. Check the Catalogue section."),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Create dataset" })).toBeDisabled();
  });

  it("offers polygons only once the Images workspace lands", async () => {
    renderBuilder();
    expect(await screen.findByRole("radio", { name: "Polygons" })).toBeDisabled();
  });
});
```

Run: `pnpm -C frontend exec vitest run src/models/DatasetBuilder.test.tsx`
Expected: FAIL with `Failed to resolve import "./DatasetBuilder"`.

- [ ] **Step 6: Implement the builder and mount it in the Datasets screen**

Create `frontend/src/models/DatasetBuilder.tsx`:

```tsx
import { useMemo, useState, type FormEvent } from "react";
import type { CatalogueType } from "@/api/catalogue";
import { useApi } from "@/api/client";
import { messageOf } from "@/api/errors";
import { createLibraryDataset, type DatasetFilter, type DatasetPreview, type DatasetTask, type LibraryDataset } from "@/api/libraryDatasets";
import { useRecentProjects } from "@/api/recentProjects";
import { pushLog } from "@/app/diagnostics";
import { useCatalogue } from "@/catalogue/useCatalogue";
import { useJobsStore } from "@/store/jobs";
import { Alert, Button, Checkbox, Disclosure, Field, GlassPanel, Input, Segmented, Select } from "@/ui";
import { emptyBuilderForm, toCreateBody, toFilter, validateBuilder, type BuilderForm } from "./builderModel";
import { SPLIT_LABEL } from "./datasetLabels";
import { useDatasetPreview } from "./useDatasetPreview";

export interface DatasetBuilderProps {
  initialProjectIds: string[];
  initialTypeIds: string[];
  onCreated: (dataset: LibraryDataset) => void;
  onClose: () => void;
}

const TASKS: { value: DatasetTask; label: string; disabled?: boolean }[] = [
  { value: "detect", label: "Boxes" },
  { value: "obb", label: "Rotated boxes" },
  { value: "segment", label: "Polygons", disabled: true },
];

/** What a project's preview row says instead of a count. */
const PROJECT_STATE: Record<Exclude<DatasetPreview["projects"][number]["state"], "ok">, string> = {
  timed_out: "still counting",
  missing: "folder not found",
  unavailable: "cannot open",
};

const toggle = (ids: string[], id: string, on: boolean) => (on ? [...ids.filter((x) => x !== id), id] : ids.filter((x) => x !== id));

function PreviewPanel({
  filter,
  preview,
  loading,
  error,
  types,
}: {
  filter: DatasetFilter | null;
  preview: DatasetPreview | null;
  loading: boolean;
  error: string | null;
  types: CatalogueType[];
}) {
  if (!filter) {
    return (
      <aside aria-label="Preview" className="rounded-panel border border-line bg-surface-2 p-4 text-sm text-muted">
        Choose projects and types to count the images.
      </aside>
    );
  }
  return (
    <aside aria-label="Preview" aria-busy={loading} className="flex flex-col gap-3 rounded-panel border border-line bg-surface-2 p-4">
      <span className="text-xs text-muted">Images with labels</span>
      <span data-testid="preview-images" className="text-kpi font-semibold tabular-nums">
        {preview ? preview.images : "–"}
      </span>
      {loading && <span className="text-xs text-muted">Counting…</span>}
      {error && <Alert tone="danger">{error}</Alert>}
      {preview && preview.images === 0 && <Alert tone="warn">No labelled images match this filter.</Alert>}
      {preview && (
        <ul data-testid="preview-types" className="flex flex-col gap-1 text-sm">
          {filter.type_ids.map((id) => (
            <li key={id} className="flex items-baseline justify-between gap-3">
              <span className="truncate">{types.find((t) => t.id === id)?.name ?? "Unknown type"}</span>
              <span className="font-mono tabular-nums">{preview.boxes_per_type[id] ?? 0}</span>
            </li>
          ))}
        </ul>
      )}
      {preview && (
        <ul data-testid="preview-projects" className="flex flex-col gap-1 border-t border-line pt-2 text-xs text-muted">
          {preview.projects.map((p) => (
            <li key={p.project_id} className="flex items-baseline justify-between gap-3">
              <span className="truncate">{p.project_name}</span>
              <span className="font-mono tabular-nums">{p.state === "ok" ? p.images : PROJECT_STATE[p.state]}</span>
            </li>
          ))}
        </ul>
      )}
      {preview?.projects.some((p) => p.state === "timed_out") && (
        <p className="text-xs text-muted">Some projects took longer than 2 s to count. The build still includes them.</p>
      )}
      {preview?.projects.some((p) => p.state === "missing" || p.state === "unavailable") && (
        <p className="text-xs text-warn">A project that cannot be opened now makes the build fail. Untick it, or open it first.</p>
      )}
    </aside>
  );
}

/** F §12.4: projects, types, dates, reviewed-only, task and split, with live counts. */
export function DatasetBuilder({ initialProjectIds, initialTypeIds, onCreated, onClose }: DatasetBuilderProps) {
  const api = useApi();
  const { projects } = useRecentProjects();
  const catalogue = useCatalogue();
  const liveTypes = useMemo(() => catalogue.types.filter((t) => !t.archived), [catalogue.types]);
  const [form, setForm] = useState<BuilderForm>(() => emptyBuilderForm(initialProjectIds, initialTypeIds));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const filter = useMemo(() => toFilter(form), [form]);
  const preview = useDatasetPreview(filter);
  const patch = (p: Partial<BuilderForm>) => setForm((f) => ({ ...f, ...p }));
  const nothingMatches = preview.preview !== null && preview.preview.images === 0;
  const canCreate = !catalogue.unavailable && !nothingMatches && !busy;

  async function submit(e: FormEvent) {
    e.preventDefault();
    const problem = validateBuilder(form);
    setError(problem);
    if (problem) return;
    setBusy(true);
    try {
      const { dataset, job } = await createLibraryDataset(api, toCreateBody(form));
      useJobsStore.getState().upsert(job);
      onCreated(dataset);
    } catch (err) {
      pushLog(`create dataset failed: ${messageOf(err, String(err))}`);
      setError(messageOf(err, "could not create the dataset"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <GlassPanel variant="pane" className="p-5">
      <form
        aria-label="New dataset"
        noValidate
        onSubmit={(e) => void submit(e)}
        className="grid items-start gap-5 min-[1100px]:grid-cols-[minmax(0,1fr)_300px]"
      >
        <div className="flex min-w-0 flex-col gap-4">
          <h3 className="text-lg font-semibold">New dataset</h3>
          <Field label="Name" htmlFor="ds-name" className="max-w-sm">
            <Input id="ds-name" value={form.name} onChange={(e) => patch({ name: e.target.value })} />
          </Field>

          <fieldset className="flex flex-col gap-2">
            <legend className="text-xs font-medium text-muted">Projects</legend>
            {projects.length === 0 && <p className="text-sm text-muted">No recent projects. Open one from Projects first.</p>}
            <div className="flex flex-wrap gap-x-5 gap-y-2">
              {projects.map((p) => (
                <Checkbox
                  key={p.id}
                  label={p.name}
                  checked={form.projectIds.includes(p.id)}
                  onChange={(e) => patch({ projectIds: toggle(form.projectIds, p.id, e.target.checked) })}
                />
              ))}
            </div>
          </fieldset>

          <fieldset className="flex flex-col gap-2">
            <legend className="text-xs font-medium text-muted">Types (the class order of the dataset)</legend>
            {catalogue.unavailable ? (
              <Alert tone="info">
                The catalogue is not available, so types cannot be chosen. Check the Catalogue section.
              </Alert>
            ) : (
              <>
                <Button
                  size="sm"
                  variant="ghost"
                  className="self-start"
                  onClick={() => patch({ typeIds: liveTypes.map((t) => t.id) })}
                >
                  Select all
                </Button>
                <div className="flex flex-wrap gap-x-5 gap-y-2">
                  {liveTypes.map((t) => (
                    <Checkbox
                      key={t.id}
                      label={t.name}
                      checked={form.typeIds.includes(t.id)}
                      onChange={(e) => patch({ typeIds: toggle(form.typeIds, t.id, e.target.checked) })}
                    />
                  ))}
                </div>
              </>
            )}
          </fieldset>

          <div className="grid max-w-md gap-4 sm:grid-cols-2">
            <Field label="Captured from" htmlFor="ds-from">
              <Input id="ds-from" type="date" value={form.from} onChange={(e) => patch({ from: e.target.value })} />
            </Field>
            <Field label="Captured to" htmlFor="ds-to">
              <Input id="ds-to" type="date" value={form.to} onChange={(e) => patch({ to: e.target.value })} />
            </Field>
          </div>

          <Checkbox
            label="Reviewed annotations only (accepted, edited or drawn by a person)"
            checked={form.reviewedOnly}
            onChange={(e) => patch({ reviewedOnly: e.target.checked })}
          />

          <div className="flex flex-col gap-1">
            <Segmented label="Task" options={TASKS} value={form.task} onChange={(task) => patch({ task })} />
            <p className="text-xs text-muted">Polygon datasets arrive with the Images workspace.</p>
          </div>

          <Disclosure label="Split options">
            <div className="grid max-w-xl gap-4 sm:grid-cols-3">
              <Field label="Split method" htmlFor="ds-split">
                <Select
                  id="ds-split"
                  value={form.split}
                  onChange={(e) => patch({ split: e.target.value as BuilderForm["split"] })}
                >
                  {(Object.keys(SPLIT_LABEL) as BuilderForm["split"][]).map((m) => (
                    <option key={m} value={m}>
                      {SPLIT_LABEL[m]}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Validation fraction" htmlFor="ds-fraction">
                <Input
                  id="ds-fraction"
                  type="number"
                  min={0.05}
                  max={0.5}
                  step={0.05}
                  value={form.valFraction}
                  onChange={(e) => patch({ valFraction: e.target.value })}
                  className="tabular-nums"
                />
              </Field>
              <Field label="Seed" htmlFor="ds-seed">
                <Input
                  id="ds-seed"
                  type="number"
                  value={form.seed}
                  onChange={(e) => patch({ seed: e.target.value })}
                  className="tabular-nums"
                />
              </Field>
            </div>
            <p className="mt-2 text-xs text-muted">
              By flight keeps every image of one flight on the same side, so validation measures flights the model has
              not seen. Group keys include the project, so a flight never straddles train and validation.
            </p>
          </Disclosure>

          {error && <Alert tone="danger">{error}</Alert>}
          <div className="flex items-center gap-2">
            <Button type="submit" variant="primary" loading={busy} disabled={!canCreate}>
              Create dataset
            </Button>
            <Button variant="ghost" onClick={onClose} disabled={busy}>
              Cancel
            </Button>
          </div>
        </div>
        <PreviewPanel
          filter={filter}
          preview={preview.preview}
          loading={preview.loading}
          error={preview.error}
          types={catalogue.types}
        />
      </form>
    </GlassPanel>
  );
}
```

In `frontend/src/models/DatasetsScreen.tsx`:

1. Add the imports:

   ```tsx
   import { DatasetBuilder } from "./DatasetBuilder";
   import { readBuilderPreset } from "./links";
   ```

2. Add `useSearchParams` to the `react-router-dom` import, and below `const navigate = useNavigate();`
   add:

   ```tsx
     const [params, setParams] = useSearchParams();
     const preset = readBuilderPreset(params);
   ```

3. Directly after the closing `</header>`, add:

   ```tsx
         {preset.open && !list.unavailable && (
           <DatasetBuilder
             key={params.toString()}
             initialProjectIds={preset.projectIds}
             initialTypeIds={preset.typeIds}
             onCreated={(d) => {
               list.put(d);
               navigate(`/models/datasets/${d.id}`);
             }}
             onClose={() => setParams({}, { replace: true })}
           />
         )}
   ```

Then add this case to `DatasetsScreen.test.tsx`:

```tsx
  it("opens the builder from ?project= (the /p/:id/datasets redirect)", async () => {
    renderDatasets(`/models/datasets?project=${PROJECT_ID}`, [
      LIST,
      { method: "GET", path: /\/api\/v1\/projects$/, body: { items: [exampleProject], next_cursor: null } },
      { method: "GET", path: /\/catalogue\/types$/, body: exampleCataloguePage },
      { method: "POST", path: /\/preview$/, body: examplePreview },
    ]);
    expect(await screen.findByRole("form", { name: "New dataset" })).toBeInTheDocument();
    expect(await screen.findByLabelText("Ahmadia")).toBeChecked();
  });
```

with `exampleProject` and `PROJECT_ID` added to its `@/test/fixtures` import, and
`exampleCataloguePage` and `examplePreview` added to its `@/test/appSectionFixtures` import.

Run: `pnpm -C frontend exec vitest run src/models`
Expected: PASS. This includes the 6 builder cases, 3 preview cases, 5 pure cases, and 7 screen cases.

Swap SH's hard-coded builder links for the helper (SH's reconciliation table):

```powershell
Get-ChildItem frontend\src -Recurse -Include *.ts,*.tsx | Select-String -SimpleMatch -Pattern 'models/datasets?new=1' | Select-Object Path,LineNumber,Line
```

Expected: SH's "Use in dataset…" in `data/SelectionBar.tsx` (or wherever SH put it), the all-labelled
alert, and `models/links.ts` itself. In each hit outside `models/links.ts`:
- import `datasetBuilderHref` from `@/models/links`
- replace `` `/models/datasets?new=1&project=${projectId}` `` with
  `datasetBuilderHref({ projectIds: [projectId] })`
- if the string also carries `&types=${…}`, pass those ids as `typeIds`

Run those files' tests: `pnpm -C frontend exec vitest run src/data`. Expected: PASS. Their
expected hrefs are unchanged, apart from a `types` value that is now URL-encoded (`%2C` for the
comma). If a test asserts the raw comma, update it to the encoded form.

- [ ] **Step 7: Add the builder e2e**

In `frontend/e2e/fixtures/appSections.ts`:

1. Add the fixtures:

   ```ts
   export const RECENT_PROJECT = { id: P, name: "Ahmadia", folder: "E:\\Projects\\Ahmadia", classes: [] };

   export const PREVIEW = {
     images: 30,
     boxes_per_type: { "t-1": 40, "t-2": 72 },
     projects: [{ project_id: P, project_name: "Ahmadia", images: 30, boxes: 112, state: "ok" }],
   };
   ```

2. Add these two branches to `routeDatasets`, before the `pathname.endsWith("/items")` line:

   ```ts
         if (pathname.endsWith("/preview")) return fulfilJson(route, PREVIEW);
         if (pathname === "/api/v1/library/datasets" && method === "POST")
           return fulfilJson(
             route,
             {
               dataset: { ...LIB_DATASET, id: "d-lib-2", name: "machines-v2", state: "resolving" },
               job: libraryJob({ id: "j-build-2", type: "dataset_build" }),
             },
             202,
           );
   ```

Append to `frontend/e2e/datasets.spec.ts` (and extend its import with `CATALOGUE_PAGE`, `P`,
`RECENT_PROJECT` and `fulfilJson`):

```ts
test("the dataset builder counts a filter and creates the dataset as a job", async ({ page }) => {
  await routeDatasets(page);
  await page.route(
    (url) => url.pathname === "/api/v1/catalogue/types",
    (route) => fulfilJson(route, CATALOGUE_PAGE),
  );
  await page.route(
    (url) => url.pathname === "/api/v1/projects",
    (route) =>
      route.request().method() === "GET"
        ? fulfilJson(route, { items: [RECENT_PROJECT], next_cursor: null })
        : route.fallback(),
  );
  await page.goto(`/models/datasets?project=${P}&types=t-1,t-2`);
  await expect(page.getByLabel("Ahmadia")).toBeChecked({ timeout: 15_000 });
  await expect(page.getByTestId("preview-images")).toHaveText("30");
  await page.getByLabel("Name", { exact: true }).fill("machines-v2");
  const created = page.waitForRequest((r) => r.method() === "POST" && r.url().endsWith("/library/datasets"));
  await page.getByRole("button", { name: "Create dataset" }).click();
  expect((await created).postDataJSON()).toMatchObject({
    name: "machines-v2",
    task: "detect",
    filter: { project_ids: [P], type_ids: ["t-1", "t-2"], reviewed_only: true },
  });
  await expect(page).toHaveURL(/\/models\/datasets\/d-lib-2$/);
});
```

Run: `$env:E2E_WEB_PORT=1520; $env:E2E_MOCK_PORT=4110; pnpm -C frontend exec playwright test e2e/datasets.spec.ts`
Expected: 2 passed.

- [ ] **Step 8: Lint, build and commit**

```powershell
pnpm -C frontend lint; pnpm -C frontend build
git add frontend/src/data  # only the files the helper swap changed; check `git status` first
git add frontend/src/models/links.ts frontend/src/models/links.test.ts frontend/src/models/builderModel.ts frontend/src/models/builderModel.test.ts frontend/src/models/useDatasetPreview.ts frontend/src/models/useDatasetPreview.test.tsx frontend/src/models/DatasetBuilder.tsx frontend/src/models/DatasetBuilder.test.tsx frontend/src/models/DatasetsScreen.tsx frontend/src/models/DatasetsScreen.test.tsx frontend/e2e/fixtures/appSections.ts frontend/e2e/datasets.spec.ts
git commit -m "feat(models): build a dataset across projects with live, stale-safe preview counts

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 11: Training screen (runs, run detail, new-run drawer)

Load `impeccable`, `emil-design-eng` and `DESIGN.md` first.

**Files:**
- Modify: `frontend/src/train/trainModel.ts` (`TrainableDataset`, `toTrainable`), `frontend/src/train/trainModel.test.ts`
- Modify: `frontend/src/train/TrainForm.tsx`, `frontend/src/train/TrainForm.test.tsx`, `frontend/src/train/TrainForm.lists.test.tsx`
- Modify: `frontend/src/test/appSectionFixtures.ts` (+ `exampleTrainable`)
- Create: `frontend/src/models/useResultsCurve.ts`
- Create: `frontend/src/models/TrainingScreen.tsx`, `frontend/src/models/TrainingScreen.test.tsx`
- Modify: `frontend/src/routes/appRoutes.tsx`
- Modify: `frontend/src/api/library.ts` (delete `trainModel` if present)
- Delete (if present): `frontend/src/screens/TrainScreen.tsx`, `frontend/src/screens/TrainScreen.test.tsx`,
  `frontend/src/train/useDatasets.ts`, `frontend/src/train/useDatasets.test.tsx`, `frontend/src/api/datasets.ts`,
  `frontend/src/api/datasets.test.ts`, `frontend/e2e/train.spec.ts`
- Create: `frontend/e2e/training.spec.ts`
- Modify: `frontend/e2e/fixtures/appSections.ts` (+ `TRAINING_RUN`, `routeTraining`)

**Interfaces:**
- Consumes:
  - Task 7: `useTrainingRuns`, `startTrainingRun`, `fetchTrainingRun`, `TrainingRun`
  - Task 9: `useLibraryDatasets`, `useItemById`
  - Task 10: `datasetBuilderHref`
  - Existing: `useLibraryModels`, `TrainProgress`, `TrainingCurve`, `parseResultsCsv`, `fetchResultsCsv`,
    `LIBRARY_JOBS`, `formatMetric`, `formatDuration`
- Produces:
  - `train/trainModel.ts`: `TrainableDataset {id; name; image_count; train_count; val_count;
    class_count; split_method}`, `toTrainable(d: LibraryDataset): TrainableDataset`.
    `suggestName` and `trainAdvice` take `TrainableDataset`.
  - `TrainForm`: the `projectId` prop is removed, and `datasets: TrainableDataset[]`.
  - `useResultsCurve(modelId: string | null): CurveState`, where
    `CurveState = {state: "idle" | "loading"} | {state: "ready"; points} | {state: "error"; error}`
  - `TrainingScreen()` at `/models/training` and `/models/training/:runId`, reading `?new=1[&dataset=]`
    and (Task 12) `?compare=`

- [ ] **Step 1: Retarget the form model and its tests to library datasets**

In `frontend/src/train/trainModel.ts`:

1. Replace `import type { Dataset, LibraryModel, TrainRequest } from "@contract/client";` with:

   ```ts
   import type { LibraryModel, TrainRequest } from "@contract/client";
   import type { LibraryDataset } from "@/api/libraryDatasets";

   /** What the training form needs of a dataset: a ready library dataset through `toTrainable`. */
   export interface TrainableDataset {
     id: string;
     name: string;
     image_count: number;
     train_count: number;
     val_count: number;
     class_count: number;
     split_method: string;
   }

   export function toTrainable(d: LibraryDataset): TrainableDataset {
     return {
       id: d.id,
       name: d.name,
       image_count: d.counts.images,
       train_count: d.counts.train,
       val_count: d.counts.val,
       class_count: d.classes.length,
       split_method: d.split_method,
     };
   }
   ```

2. In `suggestName` and `trainAdvice`, change the parameter type `Dataset | undefined` to
   `TrainableDataset | undefined`.

Append to `frontend/src/test/appSectionFixtures.ts`:

```ts
import type { TrainableDataset } from "@/train/trainModel";

/** The training form's view of a dataset; the same id, name and counts as the old project fixture. */
export const exampleTrainable: TrainableDataset = {
  id: "d0000000-7777-4000-8000-000000000001",
  name: "v1",
  image_count: 30,
  train_count: 24,
  val_count: 6,
  class_count: 1,
  split_method: "by_group",
};
```

Move that `import type` line to the top of the file with the other imports.

In `frontend/src/train/trainModel.test.ts`, `TrainForm.test.tsx` and `TrainForm.lists.test.tsx`
(use the Edit tool; PowerShell's `Set-Content` writes a BOM):
- Drop `exampleDataset` from the `@/test/fixtures` import and add
  `import { exampleTrainable } from "@/test/appSectionFixtures";`.
- Replace every other `exampleDataset` with `exampleTrainable`.
- Delete every `projectId={PROJECT_ID}` prop line, and the `projectId: PROJECT_ID,` line in
  `TrainForm.lists.test.tsx`. Drop `PROJECT_ID` from the import where it is now unused.
- Change `` `/p/${PROJECT_ID}/datasets` `` (the "Create dataset" link) to `"/models/datasets?new=1"`,
  and the "Add a starter model" href `"/library"` to `"/models/library"`.

Run: `pnpm -C frontend exec vitest run src/train`
Expected: FAIL. `TrainForm` still requires `projectId`, still reads `classes.length`, and its links
still point at the old routes.

- [ ] **Step 2: Retarget `TrainForm`**

In `frontend/src/train/TrainForm.tsx`:

1. Replace `import type { Dataset, LibraryModel, TrainRequest } from "@contract/client";` with
   `import type { LibraryModel, TrainRequest } from "@contract/client";`, and add
   `import { datasetBuilderHref } from "@/models/links";`.
2. Add `type TrainableDataset` to the `./trainModel` import.
3. In `interface Props`, delete the `projectId: string;` line and change `datasets: Dataset[];` to
   `datasets: TrainableDataset[];`. Remove `projectId,` from the destructured parameters.
4. In `datasetHint`, change `` ${dataset.classes.length} classes `` to `` ${dataset.class_count} classes ``, and replace

   ```tsx
         <Link to={`/p/${projectId}/datasets`} className={link}>
           Create dataset
         </Link>
         , or select images on the Images screen and use Add to dataset.
   ```

   with

   ```tsx
         <Link to={datasetBuilderHref()} className={link}>
           Create dataset
         </Link>
         , or select images on the Images tab and choose Use in dataset.
   ```

5. In `modelHint`, change `<Link to="/library" className={link}>` to `<Link to="/models/library" className={link}>`.

Run: `pnpm -C frontend exec vitest run src/train`
Expected: PASS (every `TrainForm`, `trainModel` and `TrainProgress` test).

- [ ] **Step 3: Write the failing screen tests**

Create `frontend/src/models/TrainingScreen.test.tsx`:

```tsx
import { beforeEach, describe, expect, it } from "vitest";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import {
  RESULTS_CSV,
  errorBody,
  exampleModel,
  fakeClient,
  JOB_ID,
  MODEL_ID,
  runningJob,
  TRAINED_MODEL_ID,
  type FakeRoute,
} from "@/test/fixtures";
import {
  exampleLibraryDataset,
  exampleTrainingRun,
  LIB_DATASET_ID,
  TRAINING_RUN_ID,
} from "@/test/appSectionFixtures";
import { renderWithProviders } from "@/test/render";
import { useJobsStore } from "@/store/jobs";
import { TrainingScreen } from "./TrainingScreen";

const BASE: FakeRoute[] = [
  { method: "GET", path: /\/library\/training-runs$/, body: { items: [exampleTrainingRun], next_cursor: null } },
  { method: "GET", path: /\/library\/datasets$/, body: { items: [exampleLibraryDataset], next_cursor: null } },
  { method: "GET", path: /\/library\/models$/, body: { items: [exampleModel], next_cursor: null } },
  {
    method: "GET",
    path: /\/library\/jobs\/[^/]+$/,
    body: { ...runningJob, id: JOB_ID, project_id: "library", type: "train", state: "succeeded", progress: 1, message: "epoch 3/3 mAP50 0.710", result: { model_id: TRAINED_MODEL_ID } },
  },
  { method: "GET", path: /\/artifacts\/results_csv$/, body: RESULTS_CSV, raw: true },
  { method: "GET", path: /\/jobs\/[^/]+\/log$/, body: { lines: [], path: "x" } },
];

function renderTraining(route: string, extra: FakeRoute[] = []) {
  const { api, requests } = fakeClient([...extra, ...BASE]);
  renderWithProviders(<TrainingScreen />, { api, route, path: "/models/training/:runId?" });
  return requests;
}

describe("TrainingScreen (F §12.4)", () => {
  beforeEach(() => useJobsStore.setState({ jobs: {} }));

  it("lists runs with dataset, base model, best mAP50 and duration", async () => {
    renderTraining("/models/training");
    const row = await screen.findByRole("row", { name: /machines-v1-yolo11m-coco/ });
    await waitFor(() => expect(row).toHaveTextContent("yolo11m-coco"));
    expect(row).toHaveTextContent("machines-v1");
    expect(row).toHaveTextContent("71.0%");
    expect(row).toHaveTextContent("42 min 00 s");
  });

  it("opens a run with its live card and its training curve", async () => {
    renderTraining(`/models/training/${TRAINING_RUN_ID}`);
    expect(await screen.findByTestId("train-progress")).toBeInTheDocument();
    expect(await screen.findByTestId("training-curve")).toHaveAttribute("data-points", "3");
  });

  it("starts a run from the drawer with the linked dataset and opens it", async () => {
    const started = { ...exampleTrainingRun, id: "t-new", state: "queued" as const, model_id: null, metrics: null, finished_at: null };
    const requests = renderTraining(`/models/training?new=1&dataset=${LIB_DATASET_ID}`, [
      {
        method: "POST",
        path: /\/library\/training-runs$/,
        status: 202,
        body: { training_run: started, job: { ...runningJob, id: "j-train", project_id: "library", type: "train" } },
      },
      { method: "GET", path: /\/library\/training-runs\/t-new$/, body: started },
    ]);
    expect(await screen.findByRole("heading", { name: "New training run" })).toBeInTheDocument();
    await waitFor(() => expect(screen.getByLabelText("Dataset")).toHaveValue(LIB_DATASET_ID));
    await waitFor(() => expect(screen.getByLabelText("Base model")).toHaveValue(MODEL_ID));
    fireEvent.click(screen.getByRole("button", { name: "Start training" }));
    await waitFor(() =>
      expect(requests.find((r) => r.method === "POST")?.body).toEqual({
        name: "machines-v1-yolo11m-coco",
        dataset_id: LIB_DATASET_ID,
        base_model_id: MODEL_ID,
        epochs: 50,
        imgsz: 1280,
        batch: null,
        patience: 50,
        augmentation: "default",
        device: "0",
      }),
    );
    expect(await screen.findByRole("heading", { name: "machines-v1-yolo11m-coco", level: 2 })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "New training run" })).not.toBeInTheDocument();
  });

  it("offers only ready datasets in the drawer", async () => {
    renderTraining("/models/training?new=1", [
      {
        method: "GET",
        path: /\/library\/datasets$/,
        body: { items: [{ ...exampleLibraryDataset, id: "d-building", name: "still-building", state: "resolving" }], next_cursor: null },
      },
    ]);
    await screen.findByRole("heading", { name: "New training run" });
    expect(screen.queryByRole("option", { name: /still-building/ })).not.toBeInTheDocument();
  });

  it("a run link that no longer exists says so", async () => {
    renderTraining("/models/training/gone", [
      { method: "GET", path: /\/library\/training-runs\/gone$/, status: 404, body: errorBody("not_found", "no run") },
    ]);
    expect(await screen.findByText("That training run no longer exists")).toBeInTheDocument();
  });
});
```

Run: `pnpm -C frontend exec vitest run src/models/TrainingScreen.test.tsx`
Expected: FAIL with `Failed to resolve import "./TrainingScreen"`.

- [ ] **Step 4: Implement the curve hook and the screen**

Create `frontend/src/models/useResultsCurve.ts`:

```ts
import { useEffect, useState } from "react";
import { useApi } from "@/api/client";
import { messageOf } from "@/api/errors";
import { fetchResultsCsv } from "@/api/library";
import { parseResultsCsv, type CurvePoint } from "@/library/resultsCsv";

export type CurveState =
  | { state: "idle" }
  | { state: "loading" }
  | { state: "ready"; points: CurvePoint[] }
  | { state: "error"; error: string };

/** One model's `results.csv` artefact, read client-side (F §12.4). */
export function useResultsCurve(modelId: string | null): CurveState {
  const api = useApi();
  const [loaded, setLoaded] = useState<{ id: string; value: CurveState } | null>(null);
  useEffect(() => {
    if (!modelId) return;
    let cancelled = false;
    fetchResultsCsv(api, modelId)
      .then((text) => {
        if (!cancelled) setLoaded({ id: modelId, value: { state: "ready", points: parseResultsCsv(text) } });
      })
      .catch((e: unknown) => {
        if (!cancelled)
          setLoaded({ id: modelId, value: { state: "error", error: messageOf(e, "this model has no training curve") } });
      });
    return () => {
      cancelled = true;
    };
  }, [api, modelId]);
  if (!modelId) return { state: "idle" };
  return loaded && loaded.id === modelId ? loaded.value : { state: "loading" };
}
```

Create `frontend/src/models/TrainingScreen.tsx`:

```tsx
import { useCallback, useMemo, useState, type ReactNode } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import type { TrainRequest } from "@contract/client";
import { useApi } from "@/api/client";
import { messageOf } from "@/api/errors";
import { LIBRARY_JOBS } from "@/api/library";
import { fetchTrainingRun, startTrainingRun, type TrainingRun } from "@/api/trainingRuns";
import { useProvideRouteActions, type RouteAction } from "@/app/routeActions";
import { pushLog } from "@/app/diagnostics";
import { formatDuration, stateLabel } from "@/jobs/jobLabels";
import { JOB_STATE_TONE } from "@/jobs/jobsFilters";
import { useOnJobsFinished } from "@/jobs/useOnJobsFinished";
import { formatLocalDate, formatMetric } from "@/library/modelLabels";
import { TrainingCurve } from "@/library/TrainingCurve";
import { useLibraryModels } from "@/library/useLibraryModels";
import { useJobsStore } from "@/store/jobs";
import { TrainForm } from "@/train/TrainForm";
import { TrainProgress } from "@/train/TrainProgress";
import { toTrainable } from "@/train/trainModel";
import {
  Alert,
  Button,
  DataTable,
  Dialog,
  EmptyState,
  GlassPanel,
  IconButton,
  InspectorPane,
  InspectorSection,
  Pill,
  Skeleton,
  SkeletonRows,
  type Column,
} from "@/ui";
import { useItemById } from "./useItemById";
import { useLibraryDatasets } from "./useLibraryDatasets";
import { useResultsCurve } from "./useResultsCurve";
import { useTrainingRuns } from "./useTrainingRuns";

function runSeconds(run: TrainingRun): number | null {
  if (!run.finished_at) return null;
  return Math.max(0, Math.round((Date.parse(run.finished_at) - Date.parse(run.created_at)) / 1000));
}

function Row({ term, children }: { term: string; children: ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-4 py-1.5 text-sm">
      <dt className="shrink-0 text-muted">{term}</dt>
      <dd className="min-w-0 truncate font-medium tabular-nums">{children}</dd>
    </div>
  );
}

function RunDetail({
  run,
  datasetName,
  modelName,
  onClose,
}: {
  run: TrainingRun;
  datasetName: string;
  modelName: string;
  onClose: () => void;
}) {
  const curve = useResultsCurve(run.model_id ?? null);
  return (
    <InspectorPane
      label="Training run"
      header={
        <div className="flex items-center gap-2">
          <h2 className="min-w-0 flex-1 truncate text-lg font-semibold">{run.name}</h2>
          <IconButton icon="x" label="Close run" size="sm" onClick={onClose} />
        </div>
      }
    >
      <InspectorSection title="Run">
        <dl className="divide-y divide-line">
          <Row term="Dataset">{datasetName}</Row>
          <Row term="Base model">{modelName}</Row>
          <Row term="Epochs">{String(run.params.epochs ?? "–")}</Row>
          <Row term="Image size">{String(run.params.imgsz ?? "–")}</Row>
          <Row term="Best mAP50">{formatMetric(run.metrics?.map50)}</Row>
        </dl>
      </InspectorSection>
      {run.job_id && (
        <InspectorSection title="Progress">
          <TrainProgress projectId={LIBRARY_JOBS} jobId={run.job_id} />
        </InspectorSection>
      )}
      {run.model_id && (
        <InspectorSection title="Curve">
          {curve.state === "ready" ? (
            <TrainingCurve points={curve.points} />
          ) : curve.state === "error" ? (
            <p className="text-xs text-muted">{curve.error}</p>
          ) : (
            <Skeleton className="h-32 w-full" />
          )}
        </InspectorSection>
      )}
    </InspectorPane>
  );
}

/** F §12.4: training runs in the library, their live progress and curves, and new runs. */
export function TrainingScreen() {
  const { runId = null } = useParams();
  const api = useApi();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const runs = useTrainingRuns();
  const datasets = useLibraryDatasets();
  const library = useLibraryModels();
  const creating = params.get("new") === "1";
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useOnJobsFinished("train", runs.reload);

  const actions = useMemo<RouteAction[]>(
    () => [{ id: "new-run", label: "New training run", icon: "plus", variant: "primary", to: "/models/training?new=1" }],
    [],
  );
  useProvideRouteActions(actions);

  const trainable = useMemo(
    () => datasets.datasets.filter((d) => d.state === "ready").map(toTrainable),
    [datasets.datasets],
  );
  // Training starts from box models only: rotated-box weights would train a different task.
  const baseModels = useMemo(() => library.models.filter((m) => m.task === "detect"), [library.models]);
  const datasetName = useCallback(
    (id: string) => datasets.datasets.find((d) => d.id === id)?.name ?? "Deleted dataset",
    [datasets.datasets],
  );
  const modelName = useCallback(
    (id: string) => library.models.find((m) => m.id === id)?.name ?? "Unknown model",
    [library.models],
  );

  const columns = useMemo<Column<TrainingRun>[]>(
    () => [
      { key: "name", header: "Run", width: "minmax(12rem,2fr)", render: (r) => <span className="truncate font-medium">{r.name}</span> },
      {
        key: "state",
        header: "State",
        width: "7rem",
        render: (r) => (
          <Pill tone={JOB_STATE_TONE[r.state]} live={r.state === "running"} size="sm">
            {stateLabel(r.state)}
          </Pill>
        ),
      },
      { key: "dataset", header: "Dataset", width: "minmax(8rem,1fr)", render: (r) => <span className="truncate text-muted">{datasetName(r.dataset_id)}</span> },
      { key: "base", header: "Base model", width: "minmax(8rem,1fr)", render: (r) => <span className="truncate text-muted">{modelName(r.base_model_id)}</span> },
      { key: "map", header: "Best mAP50", width: "7rem", render: (r) => <span className="font-mono tabular-nums">{formatMetric(r.metrics?.map50)}</span> },
      {
        key: "duration",
        header: "Duration",
        width: "8rem",
        render: (r) => {
          const s = runSeconds(r);
          return <span className="font-mono text-xs tabular-nums text-muted">{s === null ? "–" : formatDuration(s)}</span>;
        },
      },
      { key: "created", header: "Started", width: "9rem", render: (r) => <span className="font-mono text-xs tabular-nums text-muted">{formatLocalDate(r.created_at)}</span> },
    ],
    [datasetName, modelName],
  );

  const fetchRun = useCallback((id: string) => fetchTrainingRun(api, id), [api]);
  const selected = useItemById(runId, runs.runs, runs.loading, fetchRun, "training run");

  async function start(req: TrainRequest) {
    setBusy(true);
    setError(null);
    try {
      const { training_run: run, job } = await startTrainingRun(api, req);
      useJobsStore.getState().upsert(job);
      runs.put(run);
      navigate(`/models/training/${run.id}`);
    } catch (e) {
      pushLog(`start training failed: ${messageOf(e, String(e))}`);
      setError(messageOf(e, "could not start training"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="flex flex-col gap-4">
      <header className="flex flex-col gap-1">
        <h2 className="text-lg font-semibold">Training</h2>
        <p className="text-sm text-muted">
          Train a model on a dataset. Each run registers its model in the Library when it finishes.
        </p>
      </header>

      {runs.unavailable && (
        <Alert tone="danger" title="The model library could not be opened">
          Training needs the library. Check the library folder, then restart the app.
        </Alert>
      )}
      {runs.error && (
        <Alert
          tone="danger"
          actions={
            <Button size="sm" onClick={runs.reload}>
              Retry
            </Button>
          }
        >
          {runs.error}
        </Alert>
      )}

      {!runs.unavailable && (
        <div className="grid items-start gap-4 min-[1100px]:grid-cols-[minmax(0,1fr)_340px]">
          <GlassPanel variant="pane" className="min-w-0 overflow-hidden">
            <DataTable
              label="Training runs"
              columns={columns}
              rows={runs.runs}
              rowKey={(r) => r.id}
              activeKey={runId}
              onOpen={(r) => navigate(`/models/training/${r.id}`)}
              loading={runs.loading}
              onEndReached={runs.hasMore ? runs.loadMore : undefined}
              empty={
                <EmptyState icon="train" title="No training runs yet">
                  Choose New training run to train a model on a dataset.
                </EmptyState>
              }
            />
          </GlassPanel>
          {runId &&
            (selected.item ? (
              <RunDetail
                key={selected.item.id}
                run={selected.item}
                datasetName={datasetName(selected.item.dataset_id)}
                modelName={modelName(selected.item.base_model_id)}
                onClose={() => navigate("/models/training")}
              />
            ) : selected.missing ? (
              <GlassPanel variant="pane" className="p-4">
                <EmptyState icon="train" title="That training run no longer exists">
                  The link is out of date. Choose a run from the list.
                </EmptyState>
              </GlassPanel>
            ) : selected.error ? (
              <Alert tone="danger">{selected.error}</Alert>
            ) : (
              <GlassPanel variant="pane" className="p-4">
                <SkeletonRows rows={4} columns={2} />
              </GlassPanel>
            ))}
        </div>
      )}

      <Dialog open={creating} title="New training run" width="lg" onClose={() => setParams({}, { replace: true })}>
        <TrainForm
          datasets={trainable}
          models={baseModels}
          datasetsUnavailable={datasets.unavailable}
          modelsUnavailable={library.unavailable}
          modelsLoading={library.loading}
          modelsError={library.error}
          busy={busy}
          onStart={(req) => void start(req)}
          initialDatasetId={params.get("dataset") ?? undefined}
        />
        {error && <Alert tone="danger">{error}</Alert>}
      </Dialog>
    </section>
  );
}
```

- [ ] **Step 5: Add the routes and delete the project-scoped training UI**

In `frontend/src/routes/appRoutes.tsx`:
- Add the lazy declaration, and swap the two `training…` children of the `models` route.
- Delete SH's now-unused `const training = (…)` placeholder.
- If `SectionPlaceholder` is no longer used in the file, remove its import. `pnpm -C frontend lint`
  flags an unused import.

```tsx
const TrainingScreen = lazy(() => import("@/models/TrainingScreen").then((m) => ({ default: m.TrainingScreen })));
```

```tsx
        { path: "training", element: (<Later><TrainingScreen /></Later>) },
        { path: "training/:runId", element: (<Later><TrainingScreen /></Later>) },
```

Find the remaining importers:

```powershell
Get-ChildItem frontend\src -Recurse -Include *.ts,*.tsx | Select-String -Pattern 'screens/TrainScreen','train/useDatasets','api/datasets"','trainModel\(api' | Select-Object Path,LineNumber,Line
```

Expected: only the files about to be deleted, and `api/library.ts` (`trainModel`). If a route
file still names `TrainScreen`, point it at SH's redirect to `/models/training`. Delete the
`trainModel` function from `frontend/src/api/library.ts`, and its test case in `api/library.test.ts`
if there is one. Then:

```powershell
git rm --ignore-unmatch frontend/src/screens/TrainScreen.tsx frontend/src/screens/TrainScreen.test.tsx frontend/src/train/useDatasets.ts frontend/src/train/useDatasets.test.tsx frontend/src/api/datasets.ts frontend/src/api/datasets.test.ts frontend/e2e/train.spec.ts
```

Run: `pnpm -C frontend exec vitest run src/models src/train src/api`
Expected: PASS (5 new screen tests).

- [ ] **Step 6: Write the training e2e**

Add to `frontend/e2e/fixtures/appSections.ts`:

```ts
export const TRAINING_RUN = {
  id: "t-1",
  name: "machines-v1-yolo11m-coco",
  dataset_id: "d-lib-1",
  base_model_id: "m0000000-2222-4000-8000-000000000001",
  params: {
    name: "machines-v1-yolo11m-coco",
    dataset_id: "d-lib-1",
    base_model_id: "m0000000-2222-4000-8000-000000000001",
    epochs: 50,
    imgsz: 1280,
    batch: null,
    patience: 50,
    augmentation: "default",
    device: "0",
  },
  job_id: "j-train",
  state: "running",
  model_id: null,
  metrics: null,
  created_at: T0,
  finished_at: null,
};

/** Routes `/library/training-runs…` and the run's job; the model list comes from the Prism mock. */
export async function routeTraining(page: import("@playwright/test").Page): Promise<void> {
  await page.route(
    (url) => url.pathname.startsWith("/api/v1/library/training-runs"),
    (route) => {
      const { pathname } = new URL(route.request().url());
      if (route.request().method() === "POST")
        return fulfilJson(
          route,
          { training_run: { ...TRAINING_RUN, id: "t-2", state: "queued" }, job: libraryJob({ id: "j-train-2", type: "train" }) },
          202,
        );
      if (pathname === "/api/v1/library/training-runs") return fulfilJson(route, { items: [TRAINING_RUN], next_cursor: null });
      return fulfilJson(route, pathname.endsWith("/t-2") ? { ...TRAINING_RUN, id: "t-2", state: "queued" } : TRAINING_RUN);
    },
  );
  await page.route(
    (url) => /^\/api\/v1\/library\/jobs\/j-train(-2)?$/.test(url.pathname),
    (route) =>
      fulfilJson(route, libraryJob({ id: "j-train", type: "train", state: "running", progress: 0.2, message: "epoch 10/50 mAP50 0.412", started_at: T0 })),
  );
}
```

Create `frontend/e2e/training.spec.ts`:

```ts
import { expect, test } from "@playwright/test";
import { routeDatasets, routeTraining } from "./fixtures/appSections";

test("Models > Training lists runs, shows a live run and starts a new one on a library dataset", async ({ page }) => {
  await routeDatasets(page);
  await routeTraining(page);
  await page.goto("/models/training");
  await expect(page.getByRole("heading", { name: "Training", exact: true })).toBeVisible({ timeout: 15_000 });
  const row = page.getByRole("row", { name: /machines-v1-yolo11m-coco/ });
  await expect(row).toContainText("machines-v1");
  await row.click();
  await expect(page.getByTestId("train-progress")).toContainText("10 / 50");

  await page.goto("/models/training?new=1&dataset=d-lib-1");
  await expect(page.getByRole("heading", { name: "New training run" })).toBeVisible();
  await expect(page.getByLabel("Dataset")).toHaveValue("d-lib-1");
  await page.getByLabel("Model name").fill("machines-v2");
  const post = page.waitForRequest((r) => r.method() === "POST" && r.url().endsWith("/library/training-runs"));
  await page.getByRole("button", { name: "Start training" }).click();
  expect((await post).postDataJSON()).toMatchObject({ name: "machines-v2", dataset_id: "d-lib-1" });
  await expect(page).toHaveURL(/\/models\/training\/t-2$/);
});
```

Run: `$env:E2E_WEB_PORT=1520; $env:E2E_MOCK_PORT=4110; pnpm -C frontend exec playwright test e2e/training.spec.ts`
Expected: 1 passed. The base model comes from the Prism example library model. If the mock's
example model is not `detect` or not `ready`, the Base model picker is empty. In that case add a
`page.route` for `/api/v1/library/models` answering one `detect`, `ready` model, in the style of
`routeTraining`.

- [ ] **Step 6b: Retire the per-project dataset and train operations from the contract**

S2 has just deleted their last callers (`api/datasets.ts`, `train/useDatasets.ts`, `trainModel` in
`api/library.ts`; SH deleted the old screens). C0 kept them `deprecated: true` with
`x-retire-with: F-S2`, and BM already deleted the backend routes.

1. In `contract/openapi.yaml`, delete the operations `listDatasets`, `createDataset`, `getDataset`,
   `deleteDataset`, `getDatasetStats` and `trainModel` (and a path item that is left empty).
2. Delete the schemas `Dataset`, `DatasetCreate`, `DatasetWithJob`, `DatasetPage`, `DatasetStats`
   (and any schema only they referenced) **that nothing else references**: check with
   `Select-String -Path contract/openapi.yaml -Pattern 'schemas/Dataset(Create|WithJob|Page|Stats)?"'`
   and `Get-ChildItem frontend/src -Recurse -Include *.ts,*.tsx | Select-String -Pattern '\bDataset(Create|WithJob|Page|Stats)?\b' | Select-String -Pattern contract`.
   A schema still used stays. Remove the matching aliases from `contract/client/index.ts`.
3. `pnpm -C contract generate`.
4. In `backend/tests/test_contract.py`, delete the six entries from `RETIRING`. In
   `backend/tests/test_foundation_contract.py`, delete the six from the dict in
   `test_the_replaced_operations_are_deprecated_with_the_unit_that_removes_them`.

Run: `pnpm -C contract check`, then from `backend`:
`E:/Dev/Yolo/app/backend/.venv/Scripts/python.exe -m pytest tests/test_contract.py tests/test_foundation_contract.py -q`,
then `pnpm -C frontend build`.
Expected: all pass; the build proves no caller is left.

- [ ] **Step 7: Lint, build and commit**

```powershell
pnpm -C frontend lint; pnpm -C frontend build
git add frontend/src/train/trainModel.ts frontend/src/train/trainModel.test.ts frontend/src/train/TrainForm.tsx frontend/src/train/TrainForm.test.tsx frontend/src/train/TrainForm.lists.test.tsx frontend/src/test/appSectionFixtures.ts frontend/src/models/useResultsCurve.ts frontend/src/models/TrainingScreen.tsx frontend/src/models/TrainingScreen.test.tsx frontend/src/routes/appRoutes.tsx frontend/src/api/library.ts frontend/src/api/library.test.ts frontend/e2e/fixtures/appSections.ts frontend/e2e/training.spec.ts
git add contract/openapi.yaml contract/client/schema.d.ts contract/client/index.ts backend/tests/test_contract.py backend/tests/test_foundation_contract.py
git add frontend/src/routes/legacyRedirects.tsx  # only if Step 5 changed it
git commit -m "feat(models): training moves to the library with runs, live progress, curves and a new-run drawer

The per-project Train screen and project datasets are gone (F §12.4); TrainForm lists library
datasets.

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 12: Compare training runs

**Files:**
- Create: `frontend/src/models/compareModel.ts`, `frontend/src/models/compareModel.test.ts`
- Create: `frontend/src/models/CompareCurves.tsx`, `frontend/src/models/CompareCurves.test.tsx`
- Modify: `frontend/src/models/useResultsCurve.ts` (+ `useResultsCurves`)
- Modify: `frontend/src/models/TrainingScreen.tsx`, `frontend/src/models/TrainingScreen.test.tsx`

**Interfaces:**
- Consumes:
  - Task 11: `TrainingScreen`, `CurveState`
  - `CurvePoint`, `CurveBox`, `fetchResultsCsv`, `parseResultsCsv`
  - DS `DataTable` selection props
- Produces:
  - `compareModel.ts`:
    - `MIN_COMPARE = 2`, `MAX_COMPARE = 4`
    - `compareProblem(runs): string | null`, `readCompare(params): string[]`
    - `EpochSpan {min; max}`, `epochSpan(series): EpochSpan | null`
    - `overlayPolyline(points, span, box): string`
    - `SERIES_STROKE`, `SERIES_SWATCH`
  - `useResultsCurves(modelIds: string[]): Record<string, CurveState>`
  - `CompareCurves({runs}: {runs: TrainingRun[]})`
  - `TrainingScreen` reads `?compare=a,b[,c,d]`

- [ ] **Step 1: Write the failing model tests**

Create `frontend/src/models/compareModel.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { exampleTrainingRun, exampleTrainingRun2 } from "@/test/appSectionFixtures";
import { compareProblem, epochSpan, overlayPolyline, readCompare } from "./compareModel";

const BOX = { width: 100, height: 60, pad: 10 };

describe("compare runs (F §12.4)", () => {
  it("asks for two to four runs, two of them with a model", () => {
    expect(compareProblem([exampleTrainingRun])).toBe("Choose two to four runs to compare.");
    expect(compareProblem([exampleTrainingRun, { ...exampleTrainingRun2, model_id: null }])).toBe(
      "At least two of the chosen runs need a finished model.",
    );
    expect(compareProblem(Array(5).fill(exampleTrainingRun))).toBe("Compare up to four runs at a time.");
    expect(compareProblem([exampleTrainingRun, exampleTrainingRun2])).toBeNull();
  });

  it("reads at most four ids from ?compare=", () => {
    expect(readCompare(new URLSearchParams("compare=a,b,c,d,e"))).toEqual(["a", "b", "c", "d"]);
    expect(readCompare(new URLSearchParams(""))).toEqual([]);
  });

  it("puts every series on one epoch axis", () => {
    const a = [1, 2, 3].map((epoch) => ({ epoch, map50: 0.5, map50_95: null }));
    const b = [1, 2, 3, 4, 5].map((epoch) => ({ epoch, map50: 1, map50_95: null }));
    const span = epochSpan([a, b]);
    expect(span).toEqual({ min: 1, max: 5 });
    expect(overlayPolyline(a, span!, BOX)).toBe("10,30 30,30 50,30");
    expect(overlayPolyline(b, span!, BOX).split(" ").pop()).toBe("90,10");
    expect(epochSpan([[], []])).toBeNull();
  });
});
```

Run: `pnpm -C frontend exec vitest run src/models/compareModel.test.ts`
Expected: FAIL with `Failed to resolve import "./compareModel"`.

- [ ] **Step 2: Implement the model**

Create `frontend/src/models/compareModel.ts`:

```ts
import type { TrainingRun } from "@/api/trainingRuns";
import type { CurveBox, CurvePoint } from "@/library/resultsCsv";

export const MIN_COMPARE = 2;
export const MAX_COMPARE = 4;

/** Series colours are tokens, never data: one per compared run, in selection order. */
export const SERIES_STROKE = ["stroke-accent", "stroke-ok", "stroke-info", "stroke-warn"];
export const SERIES_SWATCH = ["bg-accent", "bg-ok", "bg-info", "bg-warn"];

export function compareProblem(runs: Pick<TrainingRun, "model_id">[]): string | null {
  if (runs.length < MIN_COMPARE) return "Choose two to four runs to compare.";
  if (runs.length > MAX_COMPARE) return "Compare up to four runs at a time.";
  if (runs.filter((r) => r.model_id).length < MIN_COMPARE) return "At least two of the chosen runs need a finished model.";
  return null;
}

export function readCompare(params: URLSearchParams): string[] {
  return (params.get("compare") ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .slice(0, MAX_COMPARE);
}

export interface EpochSpan {
  min: number;
  max: number;
}

export function epochSpan(series: CurvePoint[][]): EpochSpan | null {
  const epochs = series.flat().map((p) => p.epoch);
  if (epochs.length === 0) return null;
  return { min: Math.min(...epochs), max: Math.max(...epochs) };
}

const round1 = (n: number) => Math.round(n * 10) / 10;

/** mAP50 over a shared epoch axis, so runs of different length line up. */
export function overlayPolyline(points: CurvePoint[], span: EpochSpan, box: CurveBox): string {
  const w = box.width - 2 * box.pad;
  const h = box.height - 2 * box.pad;
  const range = Math.max(1, span.max - span.min);
  return points
    .map((p) => {
      const x = box.pad + ((p.epoch - span.min) / range) * w;
      const y = box.pad + (1 - Math.min(1, Math.max(0, p.map50))) * h;
      return `${round1(x)},${round1(y)}`;
    })
    .join(" ");
}
```

Run: `pnpm -C frontend exec vitest run src/models/compareModel.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 3: Write the failing component test**

Create `frontend/src/models/CompareCurves.test.tsx`:

```tsx
import { describe, expect, it } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import { RESULTS_CSV, errorBody, fakeClient } from "@/test/fixtures";
import { exampleTrainingRun, exampleTrainingRun2 } from "@/test/appSectionFixtures";
import { renderWithProviders } from "@/test/render";
import { CompareCurves } from "./CompareCurves";

describe("CompareCurves", () => {
  it("overlays one line per run with its final mAP50, and names runs without a curve", async () => {
    const third = { ...exampleTrainingRun2, id: "t3", name: "no-csv", model_id: "m-missing" };
    const { api } = fakeClient([
      { method: "GET", path: /\/models\/m-missing\/artifacts\/results_csv$/, status: 404, body: errorBody("not_found", "none") },
      { method: "GET", path: /\/artifacts\/results_csv$/, body: RESULTS_CSV, raw: true },
    ]);
    renderWithProviders(<CompareCurves runs={[exampleTrainingRun, exampleTrainingRun2, third]} />, { api });
    const figure = await screen.findByRole("img", { name: /mAP50 of 3 runs/ });
    await waitFor(() => expect(figure.querySelectorAll("polyline")).toHaveLength(2));
    expect(screen.getByText("machines-v1-yolo11m-coco").closest("li")).toHaveTextContent("71.0%");
    expect(screen.getByText("no-csv").closest("li")).toHaveTextContent("no curve yet");
  });
});
```

Run: `pnpm -C frontend exec vitest run src/models/CompareCurves.test.tsx`
Expected: FAIL with `Failed to resolve import "./CompareCurves"`.

- [ ] **Step 4: Implement `useResultsCurves` and the component**

Append to `frontend/src/models/useResultsCurve.ts`:

```ts
/** Several models' curves at once (Compare, at most 4 requests). */
export function useResultsCurves(modelIds: string[]): Record<string, CurveState> {
  const api = useApi();
  const key = modelIds.join(",");
  const [loaded, setLoaded] = useState<{ key: string; curves: Record<string, CurveState> }>({ key: "", curves: {} });
  useEffect(() => {
    if (!key) return;
    let cancelled = false;
    const ids = key.split(",");
    for (const id of ids) {
      fetchResultsCsv(api, id)
        .then((text) => ({ state: "ready", points: parseResultsCsv(text) }) as CurveState)
        .catch((e: unknown) => ({ state: "error", error: messageOf(e, "no curve") }) as CurveState)
        .then((value) => {
          if (cancelled) return;
          setLoaded((s) => ({ key, curves: { ...(s.key === key ? s.curves : {}), [id]: value } }));
        });
    }
    return () => {
      cancelled = true;
    };
  }, [api, key]);
  const curves = loaded.key === key ? loaded.curves : {};
  return Object.fromEntries(modelIds.map((id) => [id, curves[id] ?? ({ state: "loading" } as CurveState)]));
}
```

Create `frontend/src/models/CompareCurves.tsx`:

```tsx
import type { TrainingRun } from "@/api/trainingRuns";
import { formatMetric } from "@/library/modelLabels";
import type { CurvePoint } from "@/library/resultsCsv";
import { cx } from "@/ui";
import { SERIES_STROKE, SERIES_SWATCH, epochSpan, overlayPolyline } from "./compareModel";
import { useResultsCurves } from "./useResultsCurve";

const W = 480;
const H = 220;
const PAD = 24;
const BOX = { width: W, height: H, pad: PAD };
const GRID = [0, 0.25, 0.5, 0.75, 1];

/** mAP50 of 2–4 runs on one axis, from each model's `results.csv` (F §12.4 Compare). */
export function CompareCurves({ runs }: { runs: TrainingRun[] }) {
  const modelIds = runs.map((r) => r.model_id).filter((id): id is string => Boolean(id));
  const curves = useResultsCurves(modelIds);
  const series = runs.map((r, i) => {
    const c = r.model_id ? curves[r.model_id] : undefined;
    const points: CurvePoint[] = c && c.state === "ready" ? c.points : [];
    return { run: r, points, index: i };
  });
  const span = epochSpan(series.map((s) => s.points));

  return (
    <figure className="flex flex-col gap-3">
      <svg
        role="img"
        aria-label={`mAP50 of ${runs.length} runs over epochs`}
        viewBox={`0 0 ${W} ${H}`}
        className="w-full max-w-2xl"
      >
        {GRID.map((v) => {
          const y = PAD + (1 - v) * (H - 2 * PAD);
          return (
            <g key={v}>
              <line x1={PAD} x2={W - PAD} y1={y} y2={y} className="stroke-line" strokeWidth={1} />
              <text x={2} y={y + 3} fontSize={9} className="fill-muted tabular-nums">
                {Math.round(v * 100)}%
              </text>
            </g>
          );
        })}
        {span &&
          series
            .filter((s) => s.points.length > 0)
            .map((s) => (
              <polyline
                key={s.run.id}
                data-run={s.run.id}
                points={overlayPolyline(s.points, span, BOX)}
                fill="none"
                strokeWidth={2}
                className={SERIES_STROKE[s.index % SERIES_STROKE.length]}
              />
            ))}
      </svg>
      <ul className="flex flex-col gap-1.5 text-sm">
        {series.map((s) => {
          const last = s.points.length > 0 ? s.points[s.points.length - 1] : undefined;
          return (
            <li key={s.run.id} className="flex items-center gap-2">
              <span aria-hidden className={cx("h-2 w-4 rounded-chip", SERIES_SWATCH[s.index % SERIES_SWATCH.length])} />
              <span className="min-w-0 flex-1 truncate">{s.run.name}</span>
              <span className="font-mono tabular-nums text-muted">{last ? formatMetric(last.map50) : "no curve yet"}</span>
            </li>
          );
        })}
      </ul>
    </figure>
  );
}
```

Run: `pnpm -C frontend exec vitest run src/models/CompareCurves.test.tsx`
Expected: PASS (1 test). The route order in the test matters: `fakeFetch` takes the first match,
so the 404 route for `m-missing` comes first.

- [ ] **Step 5: Wire selection and the compare view into the Training screen**

Add to `frontend/src/models/TrainingScreen.test.tsx`:

```tsx
  it("shows the compare view from ?compare= and closes it", async () => {
    const second = { ...exampleTrainingRun, id: "t-2b", name: "machines-v1-e100", model_id: "m-2b" };
    renderTraining(`/models/training?compare=${TRAINING_RUN_ID},t-2b`, [
      { method: "GET", path: /\/library\/training-runs$/, body: { items: [exampleTrainingRun, second], next_cursor: null } },
    ]);
    expect(await screen.findByRole("img", { name: /mAP50 of 2 runs/ })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Close compare" }));
    expect(screen.queryByRole("img", { name: /mAP50 of 2 runs/ })).not.toBeInTheDocument();
  });

  it("keeps Compare off until two runs with a model are chosen", async () => {
    renderTraining("/models/training");
    await screen.findByRole("row", { name: /machines-v1-yolo11m-coco/ });
    expect(screen.getByRole("button", { name: "Compare" })).toBeDisabled();
  });
```

Run: `pnpm -C frontend exec vitest run src/models/TrainingScreen.test.tsx`
Expected: FAIL. There is no compare figure and no Compare button yet.

In `frontend/src/models/TrainingScreen.tsx`:

1. Add the imports:

   ```tsx
   import { CompareCurves } from "./CompareCurves";
   import { compareProblem, readCompare } from "./compareModel";
   ```

2. Below `const creating = …`, add:

   ```tsx
     const compareKey = readCompare(params).join(",");
     const compared = useMemo(
       () =>
         (compareKey ? compareKey.split(",") : [])
           .map((id) => runs.runs.find((r) => r.id === id))
           .filter((r): r is TrainingRun => Boolean(r)),
       [compareKey, runs.runs],
     );
     const [chosen, setChosen] = useState<string[]>([]);
     const chosenRuns = runs.runs.filter((r) => chosen.includes(r.id));
     const chooseProblem = compareProblem(chosenRuns);
   ```

3. Directly after the `runs.error` alert, add the toolbar and the compare panel:

   ```tsx
         {!runs.unavailable && (
           <div className="flex flex-wrap items-center gap-3">
             <Button
               size="sm"
               disabled={chooseProblem !== null}
               title={chooseProblem ?? undefined}
               onClick={() => setParams({ compare: chosen.join(",") })}
             >
               Compare
             </Button>
             <span className="text-xs text-muted">{chooseProblem ?? `${chosen.length} runs chosen`}</span>
           </div>
         )}
         {compared.length > 0 && (
           <GlassPanel variant="pane" className="flex flex-col gap-3 p-5">
             <div className="flex items-center gap-2">
               <h3 className="flex-1 text-lg font-semibold">Compare</h3>
               <IconButton icon="x" label="Close compare" size="sm" onClick={() => setParams({}, { replace: true })} />
             </div>
             <CompareCurves runs={compared} />
           </GlassPanel>
         )}
   ```

4. Give the runs `DataTable` its selection props:

   ```tsx
                 selectable
                 selectedIds={chosen}
                 onSelectionChange={setChosen}
   ```

Run: `pnpm -C frontend exec vitest run src/models`
Expected: PASS (7 screen tests, plus compare).

- [ ] **Step 6: Lint, build and commit**

```powershell
pnpm -C frontend lint; pnpm -C frontend build
git add frontend/src/models/compareModel.ts frontend/src/models/compareModel.test.ts frontend/src/models/CompareCurves.tsx frontend/src/models/CompareCurves.test.tsx frontend/src/models/useResultsCurve.ts frontend/src/models/TrainingScreen.tsx frontend/src/models/TrainingScreen.test.tsx
git commit -m "feat(models): compare two to four training runs on one mAP50 axis

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 13: Model class mapping in the Library

**Files:**
- Create: `frontend/src/library/classMapModel.ts`, `frontend/src/library/classMapModel.test.ts`
- Create: `frontend/src/library/ClassMapEditor.tsx`, `frontend/src/library/ClassMapEditor.test.tsx`
- Modify: `frontend/src/library/ModelDetail.tsx`, `frontend/src/library/ModelDetail.test.tsx`
- Modify: `frontend/src/library/modelLabels.ts` (only if `TASK_LABEL` lacks `segment`)

**Interfaces:**
- Consumes: Task 2 `useCatalogue` and `normaliseName`; Task 7 `saveClassMap` and `ClassMap`;
  `LibraryModel.class_names`, `class_aliases` and `class_map`.
- Produces:
  - `classMapModel.ts`:
    - `IGNORE = "__ignore"`
    - `Resolution = {kind: "name"; type} | {kind: "alias"; type; alias} | {kind: "map"; typeId: string | null} | {kind: "unmapped"}`
    - `resolveClass(name, model, types): Resolution`, `leftoverNames(model, types): string[]`
    - `draftsOf(model, types): Record<string, string>`, `toClassMap(drafts): ClassMap`
    - `unmappedCount(drafts): number`
  - `ClassMapEditor({model, onSaved})`, mounted in `ModelDetail` under a "Class mapping" `Disclosure`

- [ ] **Step 1: Write the failing model tests**

Create `frontend/src/library/classMapModel.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { exampleModel } from "@/test/fixtures";
import { exampleTypes, TYPE_ID } from "@/test/appSectionFixtures";
import { IGNORE, draftsOf, leftoverNames, resolveClass, toClassMap, unmappedCount } from "./classMapModel";

const types = [...exampleTypes, { ...exampleTypes[0], id: TYPE_ID(5), name: "Bus", origin: "user" as const }];
const model = { ...exampleModel, class_map: { person: null, car: TYPE_ID(1) } };

describe("model class -> catalogue type (F §7.4: name, then alias, then class_map)", () => {
  it("resolves by name, alias and map, and leaves the rest unmapped", () => {
    expect(resolveClass("bus", model, types)).toMatchObject({ kind: "name", type: { id: TYPE_ID(5) } });
    expect(resolveClass("truck", model, types)).toMatchObject({ kind: "alias", alias: "dump_truck", type: { id: TYPE_ID(2) } });
    expect(resolveClass("person", model, types)).toEqual({ kind: "map", typeId: null });
    expect(resolveClass("car", model, types)).toEqual({ kind: "map", typeId: TYPE_ID(1) });
    expect(resolveClass("bicycle", model, types)).toEqual({ kind: "unmapped" });
  });

  it("never matches an archived type by name", () => {
    expect(resolveClass("spalling", model, types)).toEqual({ kind: "unmapped" });
  });

  it("offers a picker only for the leftovers, in the model's class order", () => {
    expect(leftoverNames(model, types)).toEqual(["person", "bicycle", "car", "motorcycle", "airplane", "train"]);
    const drafts = draftsOf(model, types);
    expect(drafts).toEqual({ person: IGNORE, bicycle: "", car: TYPE_ID(1), motorcycle: "", airplane: "", train: "" });
    expect(unmappedCount(drafts)).toBe(4);
    expect(toClassMap(drafts)).toEqual({ person: null, car: TYPE_ID(1) });
  });
});
```

Run: `pnpm -C frontend exec vitest run src/library/classMapModel.test.ts`
Expected: FAIL with `Failed to resolve import "./classMapModel"`.

- [ ] **Step 2: Implement the model**

Create `frontend/src/library/classMapModel.ts`:

```ts
import type { LibraryModel } from "@contract/client";
import type { CatalogueType } from "@/api/catalogue";
import type { ClassMap } from "@/api/library";
import { normaliseName } from "@/catalogue/normaliseName";

/** The picker value for "ignore this class" (a `null` in `class_map`). */
export const IGNORE = "__ignore";

export type Resolution =
  | { kind: "name"; type: CatalogueType }
  | { kind: "alias"; type: CatalogueType; alias: string }
  | { kind: "map"; typeId: string | null }
  | { kind: "unmapped" };

type MapSource = Pick<LibraryModel, "class_aliases" | "class_map">;

function byName(name: string, types: CatalogueType[]): CatalogueType | null {
  const key = normaliseName(name);
  return types.find((t) => !t.archived && normaliseName(t.name) === key) ?? null;
}

/** The order runs use (F §7.4): exact normalised name, then the model's alias, then `class_map`. */
export function resolveClass(name: string, model: MapSource, types: CatalogueType[]): Resolution {
  const direct = byName(name, types);
  if (direct) return { kind: "name", type: direct };
  const alias = model.class_aliases?.[name];
  if (alias) {
    const viaAlias = byName(alias, types);
    if (viaAlias) return { kind: "alias", type: viaAlias, alias };
  }
  const map = model.class_map ?? {};
  if (Object.prototype.hasOwnProperty.call(map, name)) return { kind: "map", typeId: map[name] ?? null };
  return { kind: "unmapped" };
}

/** Classes the name and alias rules do not reach: the only ones a `class_map` entry can affect. */
export function leftoverNames(model: MapSource & Pick<LibraryModel, "class_names">, types: CatalogueType[]): string[] {
  return model.class_names.filter((n) => {
    const r = resolveClass(n, model, types);
    return r.kind === "map" || r.kind === "unmapped";
  });
}

export function draftsOf(model: MapSource & Pick<LibraryModel, "class_names">, types: CatalogueType[]): Record<string, string> {
  const drafts: Record<string, string> = {};
  for (const name of leftoverNames(model, types)) {
    const r = resolveClass(name, model, types);
    drafts[name] = r.kind === "map" ? (r.typeId ?? IGNORE) : "";
  }
  return drafts;
}

export function toClassMap(drafts: Record<string, string>): ClassMap {
  const map: ClassMap = {};
  for (const [name, value] of Object.entries(drafts)) {
    if (value === IGNORE) map[name] = null;
    else if (value) map[name] = value;
  }
  return map;
}

export function unmappedCount(drafts: Record<string, string>): number {
  return Object.values(drafts).filter((v) => v === "").length;
}
```

Run: `pnpm -C frontend exec vitest run src/library/classMapModel.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 3: Write the failing editor tests**

Create `frontend/src/library/ClassMapEditor.test.tsx`:

```tsx
import { describe, expect, it, vi } from "vitest";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import { errorBody, exampleModel, fakeClient, type FakeRoute } from "@/test/fixtures";
import { exampleCataloguePage, exampleTypes, TYPE_ID } from "@/test/appSectionFixtures";
import { renderWithProviders } from "@/test/render";
import { ClassMapEditor } from "./ClassMapEditor";

const TYPES: FakeRoute = { method: "GET", path: /\/catalogue\/types$/, body: exampleCataloguePage };
const model = { ...exampleModel, class_map: { person: null } };

describe("ClassMapEditor", () => {
  it("shows the automatic matches and saves only the leftovers", async () => {
    const onSaved = vi.fn();
    const { api, requests } = fakeClient([
      TYPES,
      {
        method: "PUT",
        path: /\/class-map$/,
        body: (r) => ({ ...model, class_map: { ...model.class_map, ...(r.body as { mapping: object }).mapping } }),
      },
    ]);
    renderWithProviders(<ClassMapEditor model={model} onSaved={onSaved} />, { api });
    expect(await screen.findByText("by alias dump_truck")).toBeInTheDocument();
    expect(screen.getByLabelText("Type for person")).toHaveValue("__ignore");
    expect(screen.getByText("6 classes are not mapped. A run with this model asks for them before it starts.")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Type for car"), { target: { value: TYPE_ID(1) } });
    fireEvent.click(screen.getByRole("button", { name: "Save class mapping" }));
    await waitFor(() => expect(onSaved).toHaveBeenCalled());
    expect(requests.find((r) => r.method === "PUT")?.body).toEqual({ mapping: { person: null, car: TYPE_ID(1) } });
    expect(screen.getByText("Class mapping saved")).toBeInTheDocument();
  });

  it("offers only live types in the pickers", async () => {
    const { api } = fakeClient([TYPES]);
    renderWithProviders(<ClassMapEditor model={model} onSaved={vi.fn()} />, { api });
    const picker = await screen.findByLabelText("Type for car");
    expect(picker).toHaveTextContent(exampleTypes[2].name);
    expect(picker).not.toHaveTextContent("Spalling");
  });

  it("says the mapping cannot be edited while the catalogue is unavailable", async () => {
    const { api } = fakeClient([
      { method: "GET", path: /\/catalogue\/types$/, status: 503, body: errorBody("catalogue_unavailable", "locked") },
    ]);
    renderWithProviders(<ClassMapEditor model={model} onSaved={vi.fn()} />, { api });
    expect(
      await screen.findByText(
        "The catalogue is not available, so the class mapping cannot be edited now. Runs keep using the saved mapping.",
      ),
    ).toBeInTheDocument();
  });
});
```

Run: `pnpm -C frontend exec vitest run src/library/ClassMapEditor.test.tsx`
Expected: FAIL with `Failed to resolve import "./ClassMapEditor"`.

- [ ] **Step 4: Implement the editor and mount it**

Create `frontend/src/library/ClassMapEditor.tsx`:

```tsx
import { useMemo, useState } from "react";
import type { LibraryModel } from "@contract/client";
import { useApi } from "@/api/client";
import { messageOf } from "@/api/errors";
import { saveClassMap } from "@/api/library";
import { pushLog } from "@/app/diagnostics";
import { useCatalogue } from "@/catalogue/useCatalogue";
import { Alert, Button, Select, SkeletonRows, TypeChip } from "@/ui";
import { IGNORE, draftsOf, resolveClass, toClassMap, unmappedCount } from "./classMapModel";

/** Library → model detail → Class mapping (F §7.4): asked once per model, not once per project. */
export function ClassMapEditor({ model, onSaved }: { model: LibraryModel; onSaved: (m: LibraryModel) => void }) {
  const api = useApi();
  const catalogue = useCatalogue();
  const live = useMemo(() => catalogue.types.filter((t) => !t.archived), [catalogue.types]);
  const base = useMemo(() => draftsOf(model, catalogue.types), [model, catalogue.types]);
  const [edits, setEdits] = useState<Record<string, string> | null>(null);
  const current = edits ?? base;
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const dirty = JSON.stringify(toClassMap(current)) !== JSON.stringify(toClassMap(base));
  const unmapped = unmappedCount(current);

  async function save() {
    setBusy(true);
    setError(null);
    try {
      const next = await saveClassMap(api, model.id, toClassMap(current));
      setEdits(null);
      setSaved(true);
      onSaved(next);
    } catch (e) {
      pushLog(`save class map ${model.id} failed: ${messageOf(e, String(e))}`);
      setError(messageOf(e, "could not save the class mapping"));
    } finally {
      setBusy(false);
    }
  }

  if (catalogue.loading) return <SkeletonRows rows={3} columns={2} />;
  if (catalogue.unavailable) {
    return (
      <Alert tone="info">
        The catalogue is not available, so the class mapping cannot be edited now. Runs keep using the saved mapping.
      </Alert>
    );
  }
  return (
    <div className="flex flex-col gap-3">
      <p className="text-xs text-muted">
        Detections of each model class become this catalogue type. Classes whose name or alias matches a type are
        mapped automatically.
      </p>
      <table data-testid="class-map" className="w-full text-sm">
        <tbody>
          {model.class_names.map((name) => {
            const r = resolveClass(name, model, catalogue.types);
            return (
              <tr key={name} className="border-b border-line last:border-b-0">
                <td className="py-1.5 pr-3 font-mono text-xs">{name}</td>
                <td className="py-1.5">
                  {r.kind === "name" || r.kind === "alias" ? (
                    <span className="flex items-center gap-2">
                      <TypeChip name={r.type.name} colour={r.type.colour} kind={r.type.kind} />
                      <span className="text-xs text-muted">{r.kind === "name" ? "by name" : `by alias ${r.alias}`}</span>
                    </span>
                  ) : (
                    <Select
                      aria-label={`Type for ${name}`}
                      value={current[name] ?? ""}
                      onChange={(e) => {
                        setSaved(false);
                        setEdits({ ...current, [name]: e.target.value });
                      }}
                    >
                      {/* The server merges the map, so a stored class cannot go back to "not mapped". */}
                      <option value="" disabled={base[name] !== ""}>
                        Not mapped
                      </option>
                      <option value={IGNORE}>Ignore</option>
                      {live.map((t) => (
                        <option key={t.id} value={t.id}>
                          {t.name}
                        </option>
                      ))}
                    </Select>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {unmapped > 0 && (
        <p className="text-xs text-warn">
          {unmapped === 1 ? "1 class is" : `${unmapped} classes are`} not mapped. A run with this model asks for them
          before it starts.
        </p>
      )}
      {error && <Alert tone="danger">{error}</Alert>}
      {saved && !dirty && (
        <Alert tone="ok" role="status">
          Class mapping saved
        </Alert>
      )}
      <Button size="sm" variant="primary" className="self-start" disabled={!dirty} loading={busy} onClick={() => void save()}>
        Save class mapping
      </Button>
    </div>
  );
}
```

In `frontend/src/library/ModelDetail.tsx`:

1. Import `ClassMapEditor` from `./ClassMapEditor`, and `Disclosure` from `@/ui` (add it to the
   existing `@/ui` import).
2. Replace `<span className="text-xs text-muted">{taskLabel(model.task)}</span>` with
   `<Pill size="sm">{taskLabel(model.task)}</Pill>` (the task badge, F §12.4).
3. Directly before the model's export section (the element that renders `ExportButtons`), add:

   ```tsx
         <Disclosure label="Class mapping">
           <ClassMapEditor model={model} onSaved={onChanged} />
         </Disclosure>
   ```

If `TASK_LABEL` in `frontend/src/library/modelLabels.ts` lacks `segment`, add `segment: "Polygons"`.

Append to `frontend/src/library/ModelDetail.test.tsx` (with `fireEvent` and `screen` from
`@testing-library/react`, `exampleCataloguePage` from `@/test/appSectionFixtures`, and this file's
existing render helper or `renderWithProviders`):

```tsx
it("opens the class mapping and loads the catalogue only then", async () => {
  const { api, requests } = fakeClient([
    { method: "GET", path: /\/catalogue\/types$/, body: exampleCataloguePage },
  ]);
  renderWithProviders(
    <ModelDetail model={exampleModel} onChanged={() => {}} onDeleted={() => {}} onJobStarted={() => {}} />,
    { api },
  );
  expect(requests.some((r) => r.url.includes("/catalogue/types"))).toBe(false);
  fireEvent.click(screen.getByRole("button", { name: "Class mapping" }));
  expect(await screen.findByText("by alias dump_truck")).toBeInTheDocument();
});
```

Run: `pnpm -C frontend exec vitest run src/library`
Expected: PASS. If an existing `ModelDetail` test waits on every request made by the detail
(usage, GSD estimate), the catalogue request is not among them: the `Disclosure` mounts its content
only when opened.

- [ ] **Step 5: Lint, build and commit**

```powershell
pnpm -C frontend lint; pnpm -C frontend build
git add frontend/src/library/classMapModel.ts frontend/src/library/classMapModel.test.ts frontend/src/library/ClassMapEditor.tsx frontend/src/library/ClassMapEditor.test.tsx frontend/src/library/ModelDetail.tsx frontend/src/library/ModelDetail.test.tsx
git add frontend/src/library/modelLabels.ts  # only if segment was added
git commit -m "feat(library): map a model's classes onto catalogue types once per model

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 14: Settings → Appearance and "Your name"

Load `impeccable`, `emil-design-eng` and `DESIGN.md` first.

**Files:**
- Create: `frontend/src/settings/operatorName.ts`, `frontend/src/settings/operatorName.test.ts`
- Create: `frontend/src/settings/AppearanceSection.tsx`, `frontend/src/settings/AppearanceSection.test.tsx`
- Modify: `frontend/src/screens/AppSettingsScreen.tsx`, `frontend/src/screens/AppSettingsScreen.test.tsx`
- Create: `frontend/e2e/app-settings.spec.ts`

**Interfaces:**
- Consumes: DS `readEffectsChoice`, `setEffectsChoice` and `EffectsChoice` from `@/app/effects`;
  `readMotionChoice` and `setMotionChoice` from `@/ui/motion`; C0's `getOperatorSettings` /
  `putOperatorSettings` (`GET`/`PUT /api/v1/settings/operator`, `OperatorSettings {operator_name: string | null}`),
  built by BC.
- Produces:
  - `operatorName.ts`: `DEFAULT_OPERATOR_NAME = "Operator"`, `fetchOperatorName(api): Promise<string | null>`,
    `saveOperatorName(api, name): Promise<string | null>`. The name lives in the backend's
    `settings.json` (`operator_name`), where BC reads it as the comment author; nothing is kept in
    localStorage. S1 shows each comment's `author` as the server returns it (plan decision 14).
  - `AppearanceSection()`, the first section of `/settings`

- [ ] **Step 1: Write the failing tests**

Create `frontend/src/settings/operatorName.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { fakeClient } from "@/test/fixtures";
import { fetchOperatorName, saveOperatorName } from "./operatorName";

describe("operator name (F §5.3, used on comments; stored by the backend)", () => {
  it("reads the name from GET /settings/operator", async () => {
    const { api } = fakeClient([{ method: "GET", path: /\/settings\/operator$/, body: { operator_name: "Dana" } }]);
    expect(await fetchOperatorName(api)).toBe("Dana");
  });

  it("saves a trimmed name, and a blank one as null, with PUT", async () => {
    const { api, requests } = fakeClient([
      { method: "PUT", path: /\/settings\/operator$/, body: (r) => r.body as object },
    ]);
    expect(await saveOperatorName(api, "  Dana  ")).toBe("Dana");
    expect(requests[0]).toMatchObject({ method: "PUT", url: "/api/v1/settings/operator", body: { operator_name: "Dana" } });
    expect(await saveOperatorName(api, "   ")).toBeNull();
    expect(requests[1].body).toEqual({ operator_name: null });
  });
});
```

Create `frontend/src/settings/AppearanceSection.test.tsx`:

```tsx
import { beforeEach, describe, expect, it } from "vitest";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import { readEffectsChoice } from "@/app/effects";
import { fakeClient } from "@/test/fixtures";
import { renderWithProviders } from "@/test/render";
import { readMotionChoice } from "@/ui/motion";
import { AppearanceSection } from "./AppearanceSection";

function renderSection(name: string | null = null) {
  const client = fakeClient([
    { method: "GET", path: /\/settings\/operator$/, body: { operator_name: name } },
    { method: "PUT", path: /\/settings\/operator$/, body: (r) => r.body as object },
  ]);
  renderWithProviders(<AppearanceSection />, { api: client.api });
  return client;
}

describe("AppearanceSection (F §4.3)", () => {
  beforeEach(() => window.localStorage.clear());

  it("switches visual effects and remembers the choice", () => {
    renderSection();
    expect(screen.getByRole("radio", { name: "Auto" })).toBeChecked();
    fireEvent.click(screen.getByRole("radio", { name: "Reduced" }));
    expect(readEffectsChoice()).toBe("reduced");
    expect(document.documentElement.dataset.effects).toBe("reduced");
    expect(screen.getByRole("radio", { name: "Reduced" })).toBeChecked();
  });

  it("turns on reduced motion", () => {
    renderSection();
    fireEvent.click(screen.getByRole("switch", { name: "Reduce motion" }));
    expect(readMotionChoice()).toBe("reduce");
    expect(document.documentElement.dataset.motion).toBe("reduced");
  });

  it("shows the stored name and saves a new one through the backend when the field loses focus", async () => {
    const { requests } = renderSection("Ana");
    const input = screen.getByLabelText("Your name");
    await waitFor(() => expect(input).toHaveValue("Ana"));
    expect(input).toHaveAttribute("placeholder", "Operator");
    fireEvent.change(input, { target: { value: "Dana" } });
    fireEvent.blur(input);
    expect(await screen.findByText("Saved")).toBeInTheDocument();
    expect(requests.find((r) => r.method === "PUT")?.body).toEqual({ operator_name: "Dana" });
  });
});
```

Add to `frontend/src/screens/AppSettingsScreen.test.tsx`, inside its `describe`:

```tsx
  it("starts with Appearance", () => {
    const { api } = fakeClient([
      { method: "GET", path: /\/providers$/, body: { items: exampleProviders } },
      { method: "GET", path: /\/settings\/operator$/, body: { operator_name: null } },
    ]);
    renderWithProviders(<AppSettingsScreen />, { api, route: "/settings", path: "/settings" });
    expect(screen.getByRole("heading", { name: "Appearance" })).toBeInTheDocument();
  });
```

Run: `pnpm -C frontend exec vitest run src/settings/operatorName.test.ts src/settings/AppearanceSection.test.tsx src/screens/AppSettingsScreen.test.tsx`
Expected: FAIL. `./operatorName` and `./AppearanceSection` do not resolve, and the Appearance heading
is missing.

- [ ] **Step 2: Implement `operatorName` and the section**

Create `frontend/src/settings/operatorName.ts`:

```ts
import type { ApiClient } from "@contract/client";
import { unwrap } from "@/api/errors";

/** What the backend writes as a comment's author while no name is set (BC `comments.DEFAULT_AUTHOR`). */
export const DEFAULT_OPERATOR_NAME = "Operator";
export const MAX_OPERATOR_NAME = 80;

/** The name on the operator's comments (F §5.3, §8.1 `author`), kept in the backend's settings.json. */
export async function fetchOperatorName(api: ApiClient): Promise<string | null> {
  const r = await unwrap(api.GET("/api/v1/settings/operator"));
  return r.operator_name;
}

/** Saves a trimmed name (blank clears it) and returns the name now stored, or null. */
export async function saveOperatorName(api: ApiClient, name: string): Promise<string | null> {
  const clean = name.trim().slice(0, MAX_OPERATOR_NAME);
  const r = await unwrap(api.PUT("/api/v1/settings/operator", { body: { operator_name: clean || null } }));
  return r.operator_name;
}
```

Create `frontend/src/settings/AppearanceSection.tsx`:

```tsx
import { useEffect, useState } from "react";
import { useApi } from "@/api/client";
import { readEffectsChoice, setEffectsChoice, type EffectsChoice } from "@/app/effects";
import { Field, Input, Segmented, Switch } from "@/ui";
import { readMotionChoice, setMotionChoice } from "@/ui/motion";
import { DEFAULT_OPERATOR_NAME, fetchOperatorName, saveOperatorName } from "./operatorName";

const EFFECTS: { value: EffectsChoice; label: string }[] = [
  { value: "auto", label: "Auto" },
  { value: "full", label: "Full" },
  { value: "reduced", label: "Reduced" },
];

/** Settings → Appearance (F §4.3): visual effects, reduce motion, and the name on comments (§5.3). */
export function AppearanceSection() {
  const [effects, setEffects] = useState<EffectsChoice>(() => readEffectsChoice());
  const [motion, setMotion] = useState(() => readMotionChoice() === "reduce");
  const api = useApi();
  const [name, setName] = useState("");
  const [saved, setSaved] = useState<"idle" | "saved" | "failed">("idle");

  useEffect(() => {
    let live = true;
    fetchOperatorName(api)
      .then((stored) => {
        if (live) setName(stored ?? "");
      })
      .catch(() => {
        // The field stays empty (comments say "Operator"); saving still works once the backend answers.
      });
    return () => {
      live = false;
    };
  }, [api]);

  return (
    <section className="flex flex-col gap-5 py-6" aria-labelledby="appearance-title">
      <div className="flex flex-col gap-1">
        <h2 id="appearance-title" className="text-lg font-semibold">
          Appearance
        </h2>
        <p className="text-sm text-muted">How the app looks and moves on this computer.</p>
      </div>
      <div className="flex flex-col gap-1.5">
        <Segmented
          label="Visual effects"
          options={EFFECTS}
          value={effects}
          onChange={(choice) => {
            setEffectsChoice(choice);
            setEffects(choice);
          }}
        />
        <p className="max-w-prose text-xs text-muted">
          Auto starts with full effects and reduces them if this computer draws slowly. Reduced drops the frosted
          glass and glows. Your choice here is final.
        </p>
      </div>
      <div className="flex flex-col gap-1.5">
        <Switch
          label="Reduce motion"
          checked={motion}
          onChange={(on) => {
            setMotionChoice(on ? "reduce" : "system");
            setMotion(on);
          }}
        />
        <p className="max-w-prose text-xs text-muted">
          Animations become instant. The Windows setting to reduce animations always applies as well.
        </p>
      </div>
      <Field
        label="Your name"
        htmlFor="operator-name"
        hint={saved === "saved" ? "Saved" : saved === "failed" ? "Could not save your name" : "Shown on your comments."}
        className="max-w-sm"
      >
        <Input
          id="operator-name"
          value={name}
          placeholder={DEFAULT_OPERATOR_NAME}
          onChange={(e) => {
            setSaved("idle");
            setName(e.target.value);
          }}
          onBlur={() => {
            saveOperatorName(api, name)
              .then((stored) => {
                setName(stored ?? "");
                setSaved("saved");
              })
              .catch(() => setSaved("failed"));
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") e.currentTarget.blur();
          }}
        />
      </Field>
    </section>
  );
}
```

In `frontend/src/screens/AppSettingsScreen.tsx`, import `AppearanceSection` from
`@/settings/AppearanceSection` and put `<AppearanceSection />` as the first child of the
`<div className="divide-y divide-line">`, above `<ProvidersSection />`.

Run: `pnpm -C frontend exec vitest run src/settings src/screens/AppSettingsScreen.test.tsx`
Expected: PASS. If `role="switch"` is not how DS's `Switch` exposes itself, use the role it renders
(`checkbox`); the accessible name stays "Reduce motion".

- [ ] **Step 3: Write the Appearance e2e**

Create `frontend/e2e/app-settings.spec.ts`:

```ts
import { expect, test } from "@playwright/test";

test("Settings > Appearance reduces effects across a reload and saves the operator's name to the backend", async ({ page }) => {
  await page.goto("/settings");
  await expect(page.getByRole("heading", { name: "Appearance" })).toBeVisible({ timeout: 15_000 });
  await page.getByRole("radio", { name: "Reduced" }).click();
  await expect(page.locator("html")).toHaveAttribute("data-effects", "reduced");
  await page.getByLabel("Your name").fill("Dana");
  const put = page.waitForRequest((r) => r.method() === "PUT" && r.url().endsWith("/api/v1/settings/operator"));
  await page.getByLabel("Your name").press("Enter");
  expect((await put).postDataJSON()).toEqual({ operator_name: "Dana" });
  await expect(page.getByText("Saved")).toBeVisible();

  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("data-effects", "reduced");
  await expect(page.getByRole("radio", { name: "Reduced" })).toHaveAttribute("aria-checked", "true");
});
```

Run: `$env:E2E_WEB_PORT=1520; $env:E2E_MOCK_PORT=4110; pnpm -C frontend exec playwright test e2e/app-settings.spec.ts`
Expected: 1 passed.

- [ ] **Step 4: Lint, build and commit**

```powershell
pnpm -C frontend lint; pnpm -C frontend build
git add frontend/src/settings/operatorName.ts frontend/src/settings/operatorName.test.ts frontend/src/settings/AppearanceSection.tsx frontend/src/settings/AppearanceSection.test.tsx frontend/src/screens/AppSettingsScreen.tsx frontend/src/screens/AppSettingsScreen.test.tsx frontend/e2e/app-settings.spec.ts
git commit -m "feat(settings): Appearance with visual effects, reduce motion and the name on comments

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 15: Project type list in project settings (plan decision 15)

**Unconditional.** The index assigns the project type list editor to S2 (this task); SH and S1 do
not build one. S2 also retires the deprecated `updateClasses` operation here, because it deletes its
last caller (`ClassesSection` through `api/project.ts::saveClasses`).

**Files:**
- Create: `frontend/src/api/projectTypes.ts`
- Modify: `frontend/src/test/appSectionFixtures.ts` (+ `exampleProjectClasses`)
- Create: `frontend/src/catalogue/projectTypesModel.ts`, `frontend/src/catalogue/projectTypesModel.test.ts`
- Create: `frontend/src/catalogue/ProjectTypesSection.tsx`, `frontend/src/catalogue/ProjectTypesSection.test.tsx`
- Modify: `frontend/src/screens/SettingsScreen.tsx`
- Delete (if present): `frontend/src/settings/ClassesSection.tsx`, `frontend/src/settings/ClassesSection.test.tsx`,
  `frontend/src/settings/classesModel.ts`, `frontend/src/settings/classesModel.test.ts`
- Modify: `frontend/src/api/project.ts` (delete `saveClasses`), `frontend/src/api/project.test.tsx` (its test)
- Modify: `contract/openapi.yaml`, `contract/client/schema.d.ts` (regenerated), `contract/client/index.ts`,
  `backend/tests/test_contract.py`, `backend/tests/test_foundation_contract.py` (retire `updateClasses`)
- Modify: `frontend/e2e/settings.spec.ts`

**Interfaces:**
- Consumes:
  - Task 1: `createCatalogueType`, `existingTypeId`, `isHotkeyConflict`
  - Task 2: `useCatalogue`, `nextTypeColour`, `TYPE_HOTKEYS`, `normaliseName`
  - `ApiFailure`
  - `Project.classes` (derived `ClassDef` with `kind`, `group`)
- Produces:
  - `api/projectTypes.ts`: `ProjectTypesUpdate`, `saveProjectTypes(api, projectId, body): Promise<Project>`
  - `projectTypesModel.ts`:
    - `TypeRow {typeId; name; colour; kind; group; catalogueHotkey: string | null; override: string}`
    - `rowsOf(classes, catalogue)`, `effectiveHotkey(row)`
    - `moveRow(rows, i, delta)`, `addRow(rows, type)`, `removeRow(rows, typeId)`
    - `hotkeyProblem(rows): string | null`, `toTypesBody(rows): ProjectTypesUpdate`
    - `suggestions(query, catalogue, rows): CatalogueType[]`, `exactMatch(query, catalogue): CatalogueType | null`
    - `typeInUseMessage(err, rows): string | null`
  - `ProjectTypesSection({project, onSaved})`

- [ ] **Step 1: Write the failing model tests**

Append to `frontend/src/test/appSectionFixtures.ts` (and add `ClassDef` to a
`import type { ClassDef } from "@contract/client";` at the top):

```ts
/** A project's derived type list (F §7.3): Excavator first with a project hotkey override "9", then Crack. */
export const exampleProjectClasses: ClassDef[] = [
  { id: TYPE_ID(3), name: "Crack", colour: "#ef4444", hotkey: "c", order: 1, kind: "defect", default_severity: 2, group: "Concrete defects" },
  { id: TYPE_ID(1), name: "Excavator", colour: "#f97316", hotkey: "9", order: 0, kind: "object", default_severity: null, group: null },
];
```

Create `frontend/src/catalogue/projectTypesModel.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { ApiFailure } from "@/api/errors";
import { exampleProjectClasses, exampleTypes, TYPE_ID } from "@/test/appSectionFixtures";
import {
  addRow,
  effectiveHotkey,
  exactMatch,
  hotkeyProblem,
  moveRow,
  removeRow,
  rowsOf,
  suggestions,
  toTypesBody,
  typeInUseMessage,
} from "./projectTypesModel";

const projectClasses = exampleProjectClasses;

describe("project type list (F §7.3)", () => {
  it("orders rows by position and spots a project hotkey override", () => {
    const rows = rowsOf(projectClasses, exampleTypes);
    expect(rows.map((r) => r.name)).toEqual(["Excavator", "Crack"]);
    expect(rows[0]).toMatchObject({ catalogueHotkey: "1", override: "9" });
    expect(rows[1]).toMatchObject({ catalogueHotkey: "c", override: "" });
    expect(effectiveHotkey(rows[0])).toBe("9");
  });

  it("without the catalogue, keeps each hotkey as the type's own", () => {
    expect(rowsOf(projectClasses, [])[0]).toMatchObject({ catalogueHotkey: "9", override: "" });
  });

  it("adds, moves and removes rows", () => {
    let rows = rowsOf(projectClasses, exampleTypes);
    rows = addRow(rows, exampleTypes[1]);
    expect(rows.map((r) => r.name)).toEqual(["Excavator", "Crack", "Dump truck"]);
    expect(addRow(rows, exampleTypes[1])).toBe(rows);
    rows = moveRow(rows, 2, -1);
    expect(rows.map((r) => r.name)).toEqual(["Excavator", "Dump truck", "Crack"]);
    expect(removeRow(rows, TYPE_ID(3)).map((r) => r.name)).toEqual(["Excavator", "Dump truck"]);
  });

  it("refuses a hotkey used twice in the project", () => {
    const rows = rowsOf(projectClasses, exampleTypes).map((r) => (r.name === "Crack" ? { ...r, override: "9" } : r));
    expect(hotkeyProblem(rows)).toBe('Hotkey 9 is used by "Excavator" and "Crack" in this project.');
    expect(hotkeyProblem(rowsOf(projectClasses, exampleTypes))).toBeNull();
  });

  it("sends the order and only the overrides", () => {
    expect(toTypesBody(rowsOf(projectClasses, exampleTypes))).toEqual({
      type_ids: [TYPE_ID(1), TYPE_ID(3)],
      hotkeys: { [TYPE_ID(1)]: "9" },
    });
  });

  it("suggests live catalogue types not yet in the list, by normalised text", () => {
    const rows = rowsOf(projectClasses, exampleTypes);
    expect(suggestions("dump_", exampleTypes, rows).map((t) => t.name)).toEqual(["Dump truck"]);
    expect(suggestions("", exampleTypes, rows)).toEqual([]);
    expect(suggestions("spall", exampleTypes, rows)).toEqual([]);
    expect(exactMatch("dump-truck", exampleTypes)?.id).toBe(TYPE_ID(2));
    expect(exactMatch("rust", exampleTypes)).toBeNull();
  });

  it("explains a type that still has annotations or findings", () => {
    const rows = rowsOf(projectClasses, exampleTypes);
    const err = new ApiFailure("class_in_use", "in use", 409, { type_id: TYPE_ID(3), box_count: 4, finding_count: 1 });
    expect(typeInUseMessage(err, rows)).toBe(
      '"Crack" still has 4 annotations and 1 finding. Reassign or delete them before removing the type.',
    );
    expect(typeInUseMessage(new Error("x"), rows)).toBeNull();
  });
});
```

Run: `pnpm -C frontend exec vitest run src/catalogue/projectTypesModel.test.ts`
Expected: FAIL with `Failed to resolve import "./projectTypesModel"`.

- [ ] **Step 2: Implement the API wrapper and the model**

Create `frontend/src/api/projectTypes.ts`:

```ts
import type { ApiClient, Project, components } from "@contract/client";
import { unwrap } from "./errors";

export type ProjectTypesUpdate = components["schemas"]["ProjectTypesUpdate"];

/** F §7.3: the ordered type list and per-project hotkey overrides; answers the updated project. */
export function saveProjectTypes(api: ApiClient, projectId: string, body: ProjectTypesUpdate): Promise<Project> {
  return unwrap(api.PUT("/api/v1/projects/{projectId}/types", { params: { path: { projectId } }, body }));
}
```

Create `frontend/src/catalogue/projectTypesModel.ts`:

```ts
import type { ClassDef } from "@contract/client";
import type { CatalogueType, TypeKind } from "@/api/catalogue";
import { ApiFailure } from "@/api/errors";
import type { ProjectTypesUpdate } from "@/api/projectTypes";
import { normaliseName } from "./normaliseName";

export interface TypeRow {
  typeId: string;
  name: string;
  colour: string;
  kind: TypeKind;
  group: string | null;
  /** The catalogue's hotkey, or the project's own when the catalogue is unavailable. */
  catalogueHotkey: string | null;
  /** "" = use the catalogue's hotkey. */
  override: string;
}

export function effectiveHotkey(r: TypeRow): string | null {
  return r.override || r.catalogueHotkey;
}

/** `Project.classes` is derived from `project_type` (F §7.3): id = type id, order = position. */
export function rowsOf(classes: ClassDef[], catalogue: CatalogueType[]): TypeRow[] {
  return [...classes]
    .sort((a, b) => a.order - b.order)
    .map((c) => {
      const cat = catalogue.find((t) => t.id === c.id);
      const catalogueHotkey = cat ? (cat.hotkey ?? null) : (c.hotkey ?? null);
      const own = c.hotkey ?? null;
      return {
        typeId: c.id,
        name: c.name,
        colour: c.colour,
        kind: c.kind,
        group: c.group ?? null,
        catalogueHotkey,
        override: cat && own !== catalogueHotkey ? (own ?? "") : "",
      };
    });
}

export function addRow(rows: TypeRow[], t: CatalogueType): TypeRow[] {
  if (rows.some((r) => r.typeId === t.id)) return rows;
  return [
    ...rows,
    { typeId: t.id, name: t.name, colour: t.colour, kind: t.kind, group: t.group ?? null, catalogueHotkey: t.hotkey ?? null, override: "" },
  ];
}

export function moveRow(rows: TypeRow[], index: number, delta: number): TypeRow[] {
  const to = index + delta;
  if (to < 0 || to >= rows.length) return rows;
  const next = [...rows];
  [next[index], next[to]] = [next[to], next[index]];
  return next;
}

export function removeRow(rows: TypeRow[], typeId: string): TypeRow[] {
  return rows.filter((r) => r.typeId !== typeId);
}

/** Hotkeys must be conflict-free within the project (F §7.2, 409 `hotkey_conflict`). */
export function hotkeyProblem(rows: TypeRow[]): string | null {
  const seen = new Map<string, TypeRow>();
  for (const r of rows) {
    const key = effectiveHotkey(r);
    if (!key) continue;
    const first = seen.get(key);
    if (first) return `Hotkey ${key.toUpperCase()} is used by "${first.name}" and "${r.name}" in this project.`;
    seen.set(key, r);
  }
  return null;
}

export function toTypesBody(rows: TypeRow[]): ProjectTypesUpdate {
  const hotkeys: Record<string, string> = {};
  for (const r of rows) if (r.override) hotkeys[r.typeId] = r.override;
  return { type_ids: rows.map((r) => r.typeId), hotkeys };
}

export function suggestions(query: string, catalogue: CatalogueType[], rows: TypeRow[]): CatalogueType[] {
  const q = normaliseName(query);
  if (!q) return [];
  const taken = new Set(rows.map((r) => r.typeId));
  return catalogue
    .filter((t) => !t.archived && !taken.has(t.id) && normaliseName(t.name).includes(q))
    .slice(0, 6);
}

export function exactMatch(query: string, catalogue: CatalogueType[]): CatalogueType | null {
  const q = normaliseName(query);
  return catalogue.find((t) => !t.archived && normaliseName(t.name) === q) ?? null;
}

/** The generalised `class_in_use` rule (F §7.3) counts annotations and findings. */
export function typeInUseMessage(err: unknown, rows: TypeRow[]): string | null {
  if (!(err instanceof ApiFailure) || err.code !== "class_in_use") return null;
  const id = typeof err.details.type_id === "string" ? err.details.type_id : err.details.class_id;
  const name = rows.find((r) => r.typeId === id)?.name ?? "That type";
  const boxes = typeof err.details.box_count === "number" ? err.details.box_count : 0;
  const findings = typeof err.details.finding_count === "number" ? err.details.finding_count : 0;
  const parts = [
    boxes > 0 ? `${boxes} ${boxes === 1 ? "annotation" : "annotations"}` : null,
    findings > 0 ? `${findings} ${findings === 1 ? "finding" : "findings"}` : null,
  ].filter(Boolean);
  const what = parts.length > 0 ? parts.join(" and ") : "annotations";
  return `"${name}" still has ${what}. Reassign or delete them before removing the type.`;
}
```

Run: `pnpm -C frontend exec vitest run src/catalogue/projectTypesModel.test.ts`
Expected: PASS (7 tests).

- [ ] **Step 3: Write the failing section tests**

Create `frontend/src/catalogue/ProjectTypesSection.test.tsx`:

```tsx
import { describe, expect, it, vi } from "vitest";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import { errorBody, exampleProject, fakeClient, PROJECT_ID, type FakeRoute } from "@/test/fixtures";
import { exampleCataloguePage, exampleProjectClasses, exampleTypes, TYPE_ID } from "@/test/appSectionFixtures";
import { renderWithProviders } from "@/test/render";
import { ProjectTypesSection } from "./ProjectTypesSection";

const project = { ...exampleProject, classes: exampleProjectClasses };
const TYPES: FakeRoute = { method: "GET", path: /\/catalogue\/types$/, body: exampleCataloguePage };

function renderSection(routes: FakeRoute[]) {
  const { api, requests } = fakeClient([TYPES, ...routes]);
  const onSaved = vi.fn();
  renderWithProviders(<ProjectTypesSection project={project} onSaved={onSaved} />, { api });
  return { requests, onSaved };
}

describe("ProjectTypesSection", () => {
  it("adds a catalogue type from the one field and saves the ordered list", async () => {
    const { requests, onSaved } = renderSection([
      { method: "PUT", path: /\/projects\/[^/]+\/types$/, body: project },
    ]);
    await screen.findByRole("button", { name: "Move Excavator down" });
    fireEvent.change(screen.getByLabelText("Add type"), { target: { value: "dump" } });
    fireEvent.click(await screen.findByRole("button", { name: "Add Dump truck" }));
    fireEvent.click(screen.getByRole("button", { name: "Save types" }));
    await waitFor(() => expect(onSaved).toHaveBeenCalled());
    expect(requests.find((r) => r.method === "PUT")?.url).toBe(`/api/v1/projects/${PROJECT_ID}/types`);
    expect(requests.find((r) => r.method === "PUT")?.body).toEqual({
      type_ids: [TYPE_ID(1), TYPE_ID(3), TYPE_ID(2)],
      hotkeys: { [TYPE_ID(1)]: "9" },
    });
  });

  it("creates a type that is not in the catalogue yet, from the same field", async () => {
    const rust = { ...exampleTypes[2], id: "t-rust", name: "Rust", hotkey: null, group: null, default_severity: null };
    const { requests } = renderSection([{ method: "POST", path: /\/catalogue\/types$/, status: 201, body: rust }]);
    await screen.findByRole("button", { name: "Move Excavator down" });
    fireEvent.change(screen.getByLabelText("Add type"), { target: { value: "Rust" } });
    fireEvent.click(screen.getByRole("button", { name: 'Create "Rust"' }));
    expect(await screen.findByRole("button", { name: "Move Rust up" })).toBeInTheDocument();
    expect(requests.find((r) => r.method === "POST")?.body).toMatchObject({ name: "Rust", kind: "defect" });
  });

  it("refuses a hotkey used twice before sending", async () => {
    const { requests } = renderSection([]);
    fireEvent.change(await screen.findByLabelText("Hotkey of Crack"), { target: { value: "9" } });
    fireEvent.click(screen.getByRole("button", { name: "Save types" }));
    expect(screen.getByText('Hotkey 9 is used by "Excavator" and "Crack" in this project.')).toBeInTheDocument();
    expect(requests.some((r) => r.method === "PUT")).toBe(false);
  });

  it("explains a type that still has annotations", async () => {
    renderSection([
      {
        method: "PUT",
        path: /\/projects\/[^/]+\/types$/,
        status: 409,
        body: errorBody("class_in_use", "in use", { type_id: TYPE_ID(3), box_count: 4, finding_count: 1 }),
      },
    ]);
    fireEvent.click(await screen.findByRole("button", { name: "Remove Crack" }));
    fireEvent.click(screen.getByRole("button", { name: "Save types" }));
    expect(
      await screen.findByText('"Crack" still has 4 annotations and 1 finding. Reassign or delete them before removing the type.'),
    ).toBeInTheDocument();
  });
});
```

Run: `pnpm -C frontend exec vitest run src/catalogue/ProjectTypesSection.test.tsx`
Expected: FAIL with `Failed to resolve import "./ProjectTypesSection"`.

- [ ] **Step 4: Implement the section and swap it into project settings**

Create `frontend/src/catalogue/ProjectTypesSection.tsx`:

```tsx
import { useMemo, useState } from "react";
import type { Project } from "@contract/client";
import { createCatalogueType, existingTypeId, isHotkeyConflict, type TypeKind } from "@/api/catalogue";
import { useApi } from "@/api/client";
import { messageOf } from "@/api/errors";
import { saveProjectTypes } from "@/api/projectTypes";
import { pushLog } from "@/app/diagnostics";
import { Alert, Button, IconButton, Input, Segmented, Select, TypeChip } from "@/ui";
import { TYPE_HOTKEYS, nextTypeColour } from "./catalogueModel";
import {
  addRow,
  exactMatch,
  hotkeyProblem,
  moveRow,
  removeRow,
  rowsOf,
  suggestions,
  toTypesBody,
  typeInUseMessage,
  type TypeRow,
} from "./projectTypesModel";
import { useCatalogue } from "./useCatalogue";

const KINDS: { value: TypeKind; label: string }[] = [
  { value: "defect", label: "Defect" },
  { value: "object", label: "Object" },
];

/** Project settings → Types (F §7.3): the catalogue types this project uses, in order. */
export function ProjectTypesSection({ project, onSaved }: { project: Project; onSaved: (p: Project) => void }) {
  const api = useApi();
  const catalogue = useCatalogue();
  const initial = useMemo(() => rowsOf(project.classes, catalogue.types), [project.classes, catalogue.types]);
  const [edited, setEdited] = useState<TypeRow[] | null>(null);
  const rows = edited ?? initial;
  const [query, setQuery] = useState("");
  const [newKind, setNewKind] = useState<TypeKind>("defect");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const edit = (next: TypeRow[]) => {
    setEdited(next);
    setStatus(null);
  };
  const matches = suggestions(query, catalogue.types, rows);
  const exact = exactMatch(query, catalogue.types);

  async function createType() {
    const name = query.trim();
    if (!name) return;
    setBusy(true);
    setError(null);
    try {
      const created = await createCatalogueType(api, {
        name,
        colour: nextTypeColour(catalogue.types),
        kind: newKind,
        default_severity: null,
        hotkey: null,
        group: null,
      });
      catalogue.put(created);
      edit(addRow(rows, created));
      setQuery("");
    } catch (e) {
      pushLog(`create type from project settings failed: ${messageOf(e, String(e))}`);
      const existing = catalogue.types.find((t) => t.id === existingTypeId(e));
      if (existing) {
        edit(addRow(rows, existing));
        setQuery("");
      } else setError(messageOf(e, "could not create the type"));
    } finally {
      setBusy(false);
    }
  }

  async function save() {
    const problem = hotkeyProblem(rows);
    setError(problem);
    setStatus(null);
    if (problem) return;
    setBusy(true);
    try {
      const saved = await saveProjectTypes(api, project.id, toTypesBody(rows));
      setEdited(null);
      setStatus("Types saved");
      onSaved(saved);
    } catch (e) {
      pushLog(`save project types failed: ${messageOf(e, String(e))}`);
      setError(
        typeInUseMessage(e, rows) ??
          (isHotkeyConflict(e) ? "Two types share a hotkey in this project." : messageOf(e, "could not save the types")),
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="flex flex-col gap-4 py-6" aria-labelledby="project-types-title">
      <div className="flex flex-col gap-1">
        <h2 id="project-types-title" className="text-lg font-semibold">
          Types
        </h2>
        <p className="text-sm text-muted">
          The catalogue types this project uses, in order. Names and colours come from the Catalogue.
        </p>
      </div>
      <ol className="flex flex-col divide-y divide-line rounded-panel border border-line">
        {rows.map((r, i) => (
          <li key={r.typeId} className="flex items-center gap-3 px-3 py-2">
            <span className="w-5 text-right font-mono text-xs tabular-nums text-dim">{i + 1}</span>
            <TypeChip name={r.name} colour={r.colour} kind={r.kind} />
            {r.group && <span className="truncate text-xs text-muted">{r.group}</span>}
            <span className="ml-auto flex items-center gap-1">
              <Select
                aria-label={`Hotkey of ${r.name}`}
                value={r.override}
                onChange={(e) => edit(rows.map((x) => (x.typeId === r.typeId ? { ...x, override: e.target.value } : x)))}
                className="w-32"
              >
                <option value="">{r.catalogueHotkey ? `Default (${r.catalogueHotkey.toUpperCase()})` : "None"}</option>
                {TYPE_HOTKEYS.map((k) => (
                  <option key={k} value={k}>
                    {k.toUpperCase()}
                  </option>
                ))}
              </Select>
              <IconButton
                icon="chevron-down"
                label={`Move ${r.name} up`}
                size="sm"
                className="[&_svg]:rotate-180"
                disabled={i === 0}
                onClick={() => edit(moveRow(rows, i, -1))}
              />
              <IconButton
                icon="chevron-down"
                label={`Move ${r.name} down`}
                size="sm"
                disabled={i === rows.length - 1}
                onClick={() => edit(moveRow(rows, i, 1))}
              />
              <IconButton icon="trash" label={`Remove ${r.name}`} size="sm" onClick={() => edit(removeRow(rows, r.typeId))} />
            </span>
          </li>
        ))}
      </ol>

      {catalogue.unavailable ? (
        <Alert tone="info">The catalogue is not available, so types cannot be added now.</Alert>
      ) : (
        <div className="flex flex-col gap-2">
          <Input
            aria-label="Add type"
            placeholder="Add type: search the catalogue or name a new one"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="max-w-md"
          />
          <div className="flex flex-wrap items-center gap-2">
            {matches.map((t) => (
              <Button
                key={t.id}
                size="sm"
                variant="secondary"
                onClick={() => {
                  edit(addRow(rows, t));
                  setQuery("");
                }}
              >
                Add {t.name}
              </Button>
            ))}
            {query.trim() && !exact && (
              <>
                <Segmented label="Kind of the new type" size="sm" options={KINDS} value={newKind} onChange={setNewKind} />
                <Button size="sm" icon="plus" loading={busy} onClick={() => void createType()}>
                  Create "{query.trim()}"
                </Button>
              </>
            )}
          </div>
        </div>
      )}

      {error && <Alert tone="danger">{error}</Alert>}
      {status && (
        <Alert tone="ok" role="status">
          {status}
        </Alert>
      )}
      <Button variant="primary" className="self-start" loading={busy} disabled={edited === null} onClick={() => void save()}>
        Save types
      </Button>
    </section>
  );
}
```

In `frontend/src/screens/SettingsScreen.tsx`:

1. Replace `import { ClassesSection } from "@/settings/ClassesSection";` with
   `import { ProjectTypesSection } from "@/catalogue/ProjectTypesSection";`.
2. Replace `<ClassesSection key={JSON.stringify(project.classes)} project={project} onSaved={setProject} />`
   with `<ProjectTypesSection key={JSON.stringify(project.classes)} project={project} onSaved={setProject} />`.
3. Change the description to "Types, pre-annotation, import defaults and the imported folders of
   this project."

Then:

```powershell
Get-ChildItem frontend\src -Recurse -Include *.ts,*.tsx | Select-String -Pattern 'settings/ClassesSection','settings/classesModel' | Select-Object Path,Line
git rm --ignore-unmatch frontend/src/settings/ClassesSection.tsx frontend/src/settings/ClassesSection.test.tsx frontend/src/settings/classesModel.ts frontend/src/settings/classesModel.test.ts
```

Expected: the first command lists only the files being deleted.

- [ ] **Step 4b: Retire `updateClasses` (C0 `x-retire-with: F-S2`)**

1. Delete `saveClasses` from `frontend/src/api/project.ts` and its test case from
   `frontend/src/api/project.test.tsx` (the one asserting `PUT …/classes`). Then
   `Get-ChildItem frontend/src -Recurse -Include *.ts,*.tsx | Select-String -SimpleMatch -Pattern '/classes"','saveClasses','ClassDefInput'`
   must print nothing.
2. In `contract/openapi.yaml`, delete the `put` operation `updateClasses` (the path item
   `/api/v1/projects/{projectId}/classes` goes with it if nothing else is left in it) and the
   `ClassDefInput` schema if nothing else references it. Remove a `ClassDefInput` alias from
   `contract/client/index.ts`. `pnpm -C contract generate`.
3. In `backend/tests/test_contract.py`, delete `updateClasses` from `RETIRING` and, if it is still
   there, from `BACKEND_PENDING`. In `backend/tests/test_foundation_contract.py`, delete it from the
   dict in `test_the_replaced_operations_are_deprecated_with_the_unit_that_removes_them`.

Run: `pnpm -C contract check`; from `backend`,
`E:/Dev/Yolo/app/backend/.venv/Scripts/python.exe -m pytest tests/test_contract.py tests/test_foundation_contract.py -q`.
Expected: pass (BC deleted the route; `RETIRING` no longer needs to cover it).

The "Save types" button in the "refuses a hotkey used twice" test is enabled because changing the
hotkey is an edit. In the "explains a type that still has annotations" test, removing Crack is the
edit.

Run: `pnpm -C frontend exec vitest run src/catalogue src/screens`
Expected: PASS.

- [ ] **Step 5: Replace the class tests in `settings.spec.ts`**

In `frontend/e2e/settings.spec.ts`, delete these tests entirely:
- "renames and rehotkeys a class and saves the full list with PUT"
- "removing a class that still has boxes is refused with an explanation"
- "class-name fields keep their width beside the narrow hotkey select"

Also delete the `CLASS1` and `CLASS4` constants if nothing else uses them. Add, with the import
`import { CATALOGUE_PAGE, fulfilJson } from "./fixtures/appSections";`:

```ts
test("the project's type list adds a catalogue type and saves the order with PUT /types", async ({ page }) => {
  await page.route(
    (url) => url.pathname === "/api/v1/catalogue/types",
    (route) => fulfilJson(route, CATALOGUE_PAGE),
  );
  await page.route(`**/api/v1/projects/${P}`, async (route) => {
    if (route.request().method() !== "GET") return route.fallback();
    const response = await route.fetch();
    const project = (await response.json()) as Record<string, unknown>;
    project.classes = [
      { id: "t-1", name: "Excavator", colour: "#f97316", hotkey: "1", order: 0, kind: "object", default_severity: null, group: null },
    ];
    return route.fulfill({ response, json: project });
  });
  await page.route(`**/api/v1/projects/${P}/types`, async (route) => {
    const response = await route.fetch();
    return route.fulfill({ response });
  });
  await page.goto(`/p/${P}/settings`);
  await expect(page.getByRole("heading", { name: "Types" })).toBeVisible({ timeout: 15_000 });
  await page.getByLabel("Add type").fill("dump");
  await page.getByRole("button", { name: "Add Dump truck" }).click();
  const put = page.waitForRequest((r) => r.method() === "PUT" && r.url().endsWith(`/projects/${P}/types`));
  await page.getByRole("button", { name: "Save types" }).click();
  expect((await put).postDataJSON()).toEqual({ type_ids: ["t-1", "t-2"], hotkeys: {} });
});
```

Run: `$env:E2E_WEB_PORT=1520; $env:E2E_MOCK_PORT=4110; pnpm -C frontend exec playwright test e2e/settings.spec.ts`
Expected: every test passes. The PUT goes on to the Prism mock (its contract example answers). If
the mock rejects the body, answer the PUT with `fulfilJson(route, {})` instead of `route.fetch()`:
the assertion is on the request.

- [ ] **Step 6: Lint, build and commit**

```powershell
pnpm -C frontend lint; pnpm -C frontend build
git add frontend/src/api/projectTypes.ts frontend/src/test/appSectionFixtures.ts frontend/src/catalogue/projectTypesModel.ts frontend/src/catalogue/projectTypesModel.test.ts frontend/src/catalogue/ProjectTypesSection.tsx frontend/src/catalogue/ProjectTypesSection.test.tsx frontend/src/screens/SettingsScreen.tsx frontend/src/api/project.ts frontend/src/api/project.test.tsx frontend/e2e/settings.spec.ts
git add contract/openapi.yaml contract/client/schema.d.ts contract/client/index.ts backend/tests/test_contract.py backend/tests/test_foundation_contract.py
git commit -m "feat(catalogue): project settings pick their types from the catalogue (PUT /types)

Replaces the per-project class editor; hotkeys may be overridden per project.

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 16: "Label next" and the leftover train-project screens

**Precondition:** SH's plan ships `data/labelNext.ts` (`labelNext(api, projectId)`) and a "Label
next" button in `DataManagerScreen` (its reconciliation table). Run
`Test-Path frontend\src\data\labelNext.ts`. If it prints `True`, skip Steps 1 and 2, write "Label
next: SH's" in the ledger, and do only Steps 3 and 4. If it prints `False`, do every step.

**Files:**
- Create: `frontend/src/data/labelNext.ts`, `frontend/src/data/labelNext.test.ts`
- Modify: `frontend/src/screens/DataManagerScreen.tsx` (one line: plan decision 16)
- Delete (if present): `frontend/src/screens/LabelResolverScreen.tsx`, `frontend/src/screens/LabelResolverScreen.test.tsx`,
  `frontend/src/screens/PastDetectionsScreen.tsx`, `frontend/src/screens/PastDetectionsScreen.test.tsx`,
  `frontend/e2e/past-detections.spec.ts`

**Interfaces:**
- Consumes: `fetchImagePage`, `IMAGE_PAGE_SIZE`, `DEFAULT_QUERY`, `toImageParams`, `useNavigationStore`, SH `useProvideRouteActions`.
- Produces:
  - `labelNextTarget(api, projectId): Promise<{to: string; ids: string[]}>`
  - `useLabelNextAction(projectId: string): void`, which registers the Images tab's "Label next"
    action

- [ ] **Step 1: Write the failing test**

Create `frontend/src/data/labelNext.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { exampleImage, exampleImage2, fakeClient, IMAGE_ID, PROJECT_ID } from "@/test/fixtures";
import { labelNextTarget } from "./labelNext";

function answers(...pages: object[][]) {
  let call = 0;
  return fakeClient([
    {
      method: "GET",
      path: /\/images$/,
      body: () => ({ items: pages[Math.min(call++, pages.length - 1)], next_cursor: null, total: 0 }),
    },
  ]).api;
}

describe("Label next (F §12.4, the former Label step)", () => {
  it("opens the first unlabeled image with the unlabeled ones as the walk", async () => {
    const api = answers([exampleImage, exampleImage2]);
    expect(await labelNextTarget(api, PROJECT_ID)).toEqual({
      to: `/p/${PROJECT_ID}/images/${IMAGE_ID}`,
      ids: [exampleImage.id, exampleImage2.id],
    });
  });

  it("says everything is labelled when images exist but none is unlabeled", async () => {
    const api = answers([], [exampleImage]);
    expect(await labelNextTarget(api, PROJECT_ID)).toEqual({ to: `/p/${PROJECT_ID}/images?notice=all-labeled`, ids: [] });
  });

  it("goes to the Images tab when the project has no images", async () => {
    const api = answers([], []);
    expect(await labelNextTarget(api, PROJECT_ID)).toEqual({ to: `/p/${PROJECT_ID}/images`, ids: [] });
  });
});
```

Run: `pnpm -C frontend exec vitest run src/data/labelNext.test.ts`
Expected: FAIL with `Failed to resolve import "./labelNext"`.

- [ ] **Step 2: Implement it and register the action**

Create `frontend/src/data/labelNext.ts`:

```ts
import { useMemo } from "react";
import { useNavigate } from "react-router-dom";
import type { ApiClient } from "@contract/client";
import { useApi } from "@/api/client";
import { messageOf } from "@/api/errors";
import { fetchImagePage, IMAGE_PAGE_SIZE } from "@/api/images";
import { useProvideRouteActions, type RouteAction } from "@/app/routeActions";
import { pushLog } from "@/app/diagnostics";
import { useNavigationStore } from "@/store/navigation";
import { DEFAULT_QUERY, toImageParams } from "./listModel";

export interface LabelNextTarget {
  to: string;
  /** The unlabeled images, for the editor's Next / Previous walk. */
  ids: string[];
}

/** LabelResolverScreen's logic (deleted, F §12.4) on the Images routes. */
export async function labelNextTarget(api: ApiClient, projectId: string): Promise<LabelNextTarget> {
  const base = `/p/${projectId}/images`;
  const unlabeled = toImageParams({ ...DEFAULT_QUERY, filters: { ...DEFAULT_QUERY.filters, labeled: "no" } }, IMAGE_PAGE_SIZE);
  const page = await fetchImagePage(api, projectId, unlabeled);
  if (page.items.length > 0) {
    const ids = page.items.map((i) => i.id);
    return { to: `${base}/${ids[0]}`, ids };
  }
  const any = await fetchImagePage(api, projectId, toImageParams(DEFAULT_QUERY, 1));
  return { to: any.items.length > 0 ? `${base}?notice=all-labeled` : base, ids: [] };
}

/** The Images tab's "Label next" context action. */
export function useLabelNextAction(projectId: string): void {
  const api = useApi();
  const navigate = useNavigate();
  const actions = useMemo<RouteAction[]>(
    () => [
      {
        id: "label-next",
        label: "Label next",
        icon: "label",
        run: () => {
          labelNextTarget(api, projectId)
            .then(({ to, ids }) => {
              if (ids.length > 0) useNavigationStore.getState().setContext(ids, "data", `/p/${projectId}/images`);
              void navigate(to);
            })
            .catch((e: unknown) => {
              pushLog(`label next failed: ${messageOf(e, String(e))}`);
              void navigate(`/p/${projectId}/images`);
            });
        },
      },
    ],
    [api, navigate, projectId],
  );
  useProvideRouteActions(actions);
}
```

In `frontend/src/screens/DataManagerScreen.tsx`, import `useLabelNextAction` from `@/data/labelNext`
and add `useLabelNextAction(projectId);` directly after the line that reads `projectId` from
`useParams()`. If the Images screen already registers route actions, add this call beside them.

Run: `pnpm -C frontend exec vitest run src/data/labelNext.test.ts src/screens/DataManagerScreen.test.tsx`
Expected: PASS.

- [ ] **Step 3: Delete the leftover screens**

```powershell
Get-ChildItem frontend\src,frontend\e2e -Recurse -Include *.ts,*.tsx | Select-String -Pattern 'LabelResolverScreen','PastDetectionsScreen' | Select-Object Path,Line
git rm --ignore-unmatch frontend/src/screens/LabelResolverScreen.tsx frontend/src/screens/LabelResolverScreen.test.tsx frontend/src/screens/PastDetectionsScreen.tsx frontend/src/screens/PastDetectionsScreen.test.tsx frontend/e2e/past-detections.spec.ts
```

Expected: the first command lists only these files, or nothing when SH already deleted them
(then `git rm` prints nothing). SH's `routes/legacyRedirects.tsx` holds the redirects (§5.3:
`/label` → `images?filter=unlabeled`, `/past` → `overview`, `/past/maps/:mapId` → `maps/:mapId`).

- [ ] **Step 4: Lint, build and commit**

```powershell
pnpm -C frontend lint; pnpm -C frontend build
git add frontend/src/data/labelNext.ts frontend/src/data/labelNext.test.ts frontend/src/screens/DataManagerScreen.tsx  # only if Steps 1-2 ran
git commit -m "feat(images): Label next becomes an Images action; the train-project screens are gone

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 17: Final gate, grep gates, walkthrough, merge

**Files:**
- Create: `docs/usability/2026-09-26-foundation-s2-walkthrough.md`
- Modify: `.superpowers/sdd/f-s2/ledger.md`

- [ ] **Step 1: Rebase onto `main`**

```powershell
git fetch; git rebase main
```

Expected: a clean rebase. If S1 merged first, the likely conflicts are `src/store/changes.ts` (keep
both new fields) and `src/test/fixtures.ts` (keep both). Resolve by keeping both sides.

- [ ] **Step 2: Run the grep gates**

```powershell
Get-ChildItem frontend\src -Recurse -Include *.ts,*.tsx | Select-String -Pattern 'ProjectKind','useProjectKind','KindRoute','kind: "train"','kind: "detect"' | Select-Object Path,LineNumber
Get-ChildItem frontend\src\catalogue,frontend\src\models,frontend\src\jobs,frontend\src\settings -Recurse -Include *.tsx | Select-String -Pattern 'backdrop-','duration-\d','rgba\(','bg-\[#','rounded-\[' | Select-Object Path,LineNumber,Line
```

Expected: both print nothing (F §17.1 and §4.5). Then run `node frontend/scripts/check-tokens.mjs`.
Expected: `tokens ok`.

- [ ] **Step 3: Run the full gate**

```powershell
pnpm -C contract check
cd backend; E:\Dev\Yolo\app\backend\.venv\Scripts\python.exe -m ruff check .; E:\Dev\Yolo\app\backend\.venv\Scripts\python.exe -m ruff format --check .; E:\Dev\Yolo\app\backend\.venv\Scripts\python.exe -m pytest; cd ..
pnpm -C frontend lint
pnpm -C frontend test
pnpm -C frontend build
$env:E2E_WEB_PORT=1520; $env:E2E_MOCK_PORT=4110; pnpm -C frontend e2e
```

Expected:
- the contract check reports no drift
- ruff is clean, and pytest passes (S2 changed no backend file)
- lint prints `tokens ok`
- vitest is all green
- the build exits 0
- every Playwright spec passes, including `catalogue`, `jobs`, `datasets`, `training`,
  `app-settings`, `library` and `settings`

`cargo test` runs only if `frontend/src-tauri/binaries/kestrel-backend-*.exe` exists.

- [ ] **Step 4: Look at it**

Run `scripts\dev.ps1 -Mode backend` against a copy of real app data (never the operator's live
`%APPDATA%`). Open `/catalogue`, `/catalogue/severity`, `/models/library`, `/models/datasets`,
`/models/training`, `/jobs` and `/settings`, and check them against theme `.tD` of the mockup:
- glass panes without blur
- the violet primary gradient
- mono figures
- the 16 px panel radius
- no layout shift when a row opens its inspector

Then set Settings → Appearance → Visual effects to Reduced and confirm no `backdrop-filter`
remains (DevTools: computed style of a `Dialog`).

- [ ] **Step 5: Write the operator walkthrough**

Create `docs/usability/2026-09-26-foundation-s2-walkthrough.md`:

```markdown
---
type: walkthrough
date: 2026-09-26
plan: docs/superpowers/plans/2026-09-26-foundation-s2-app-screens.md
---

# How to test the app sections (Foundation S2)

1. Start the app. In the rail, open **Catalogue**. If your projects were upgraded, a banner says how
   many types came from them, and the table shows only those types.
2. Open one of them, for example a crack type that came from a project. Set **Kind** to Defect and
   choose **Save type**. A note offers **Create findings from accepted annotations of this type**.
   Choose it, then **Follow in Jobs**: the backfill job runs in the Model library row of Jobs.
3. Back in Catalogue, choose **Done** on the banner. It disappears and the table shows every type.
4. Choose **New type** (top bar). Name it "Dump-Truck" when "Dump truck" exists: the editor refuses
   it and offers **Use existing**.
5. Open **Severity**. Rename level 2, add a level, and watch the preview bars and pills change as
   you type. Choose **Save scale**. Remove the top level and save again. If findings still use it,
   the message names the projects.
6. Open **Models → Datasets → New dataset**. Tick two projects and a few types. The image count
   updates as you tick. Choose **Create dataset**: the dataset shows as Building, then Ready, with
   its sources and sample images. No images were copied.
7. On the dataset, choose **Build export**, then **Train on this dataset**. The New training run
   drawer opens with the dataset chosen. Start a short run (Epochs 3 under More options).
8. The run opens with live epoch, mAP50 and loss. When it finishes, its curve appears and the model
   is in **Models → Library**.
9. In **Library**, open the new model, then **Class mapping**. Classes that match a type say "by
   name". Map one leftover class and choose **Save class mapping**.
10. In **Training**, tick two finished runs and choose **Compare**: both mAP50 curves share one axis.
11. Open **Jobs**. Switch between Running, Queued, Finished and Failed, filter by a project, open a
    job to read its log, and cancel a running one.
12. Open **Settings**. Under Appearance, choose Visual effects **Reduced**: the frosted glass turns
    solid at once. Turn on **Reduce motion**, then type your name and press Enter. Restart the app:
    all three are remembered.
13. Open a project → **Settings**. Under **Types**, type part of a catalogue type's name and choose
    **Add …**, reorder with the arrows, and choose **Save types**.
14. Open a project's **Images** tab and choose **Label next**. The first unlabeled image opens
    in the editor.
```

- [ ] **Step 6: Record, commit and finish**

Append to `.superpowers/sdd/f-s2/ledger.md`:
- a row per task with its commit hash
- the list of legacy files that were already gone
- each assumed name that differed and what it became
- whether Task 15 ran

```powershell
git add docs/usability/2026-09-26-foundation-s2-walkthrough.md
git add -f .superpowers/sdd/f-s2/ledger.md
git commit -m "docs(f-s2): operator walkthrough and ledger for the app sections

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
scripts\finish-task.ps1
```

Expected: `finish-task.ps1` runs the gate on free ports, merges `task/f-s2` into `main`, removes
the worktree (links deleted as links, per the worktree-removal rule) and deletes the branch. Then
run `/wrapup` to log the session in `vault/sessions/` and bump `vault/00-north-star.md`. Give the
operator the walkthrough above as the numbered "how to test this".

---

## Spec coverage (self-review)

| Spec requirement | Task |
|---|---|
| §7.5 Catalogue sub-tabs Types and Severity | 3, 5 |
| §7.5 types table: swatch, name, group, kind, default severity, hotkey, state (swatch and kind are carried by the `TypeChip` in one column) | 3 |
| §7.5 filters: search, kind, show archived | 3 |
| §7.5 `TypeEditor` in an inspector: name, colour, kind, group, default severity (+ None), hotkey, archive | 3 |
| §7.5 classification banner, filtered to `origin=migrated` | 4 |
| §7.2 object → defect `backfill_candidates` offer → `POST …/backfill` (library job) | 4 |
| §7.2 defect → object: findings kept, the UI says so | 3 |
| §7.2 severity: rename, recolour, append, remove top, `severity_in_use` | 5 |
| §7.2 hotkeys 1–9 and letters, unique | 2, 3, 15 |
| §7.3 project type list, `PUT /projects/{id}/types`, `class_in_use` with findings, one "Add type" field | 15 |
| §7.4 Library → model detail → Class mapping; task badge; `segment` label | 13 |
| §4.4 `useSeverityScale` kept current (DS's context, fed by S2's provider) | 5 |
| §5.1 context actions: Catalogue New type; Datasets New dataset; Library Import model | 3, 9, 8 |
| §5.3 routes `/models/*`, `/catalogue`, `/catalogue/severity`, `/jobs`; Settings gains Appearance and "Your name" | 3, 5, 6, 8, 9, 11, 14 |
| §4.3 Settings → Appearance → Visual effects Auto · Full · Reduced; §4.2 Reduce motion | 14 |
| §10.1–10.2 Jobs: segments with counts, project filter, table, inspector (details, log, cancel, go to result), live via store | 6 |
| §12.4 `DatasetsScreen`: list with sources, detail with sources and sample grid; `DatasetBuilder` with live preview; `/p/:id/datasets` → `?project=` | 9, 10 |
| §12.2 export as a job, `segment` export refused in the UI | 9 |
| §12.4 `TrainingScreen`: runs list (state, dataset, base model, best mAP, duration), detail with `TrainProgress` and `TrainingCurve`, Compare 2–4, drawer = `TrainForm` on library datasets | 11, 12 |
| §12.4 `LabelResolverScreen` deleted → `data/labelNext.ts` "Label next" (SH ships it; 16 verifies or falls back); `PastDetectionsScreen` deleted | 16 |
| §15 catalogue 503 block; library unavailable; `type_exists` → Use existing | 3, 9, 11, 13, 10 |
| §16 vitest: `DatasetBuilder` preview; `TrainingScreen` compare; `JobsScreen` filters | 10, 12, 6 |
| §16 e2e: `datasets.spec.ts` moved to Models routes; `train.spec.ts` → `training.spec.ts`; `past-detections.spec.ts` deleted | 9, 10, 11, 16 |
| §17.8 Jobs shows library and project jobs together, with cancel and logs | 6 |

Out of S2's scope and owned elsewhere:
- `models.spec.ts`, `effects.spec.ts` and the frame-time evidence (X)
- the palette's Toggle reduced effects (SH)
- ProjectsScreen's "Types to start with" (S1)
- the Findings comment thread, which shows each comment's server-set `author` (S1)

