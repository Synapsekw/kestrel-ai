# Foundation SH: App Shell Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

> **Where and when this runs.** The executor works in its own worktree
> `E:\Dev\Yolo\app\.claude\worktrees\f-sh` on branch `task/f-sh`, cut from `main` **after unit DS
> (design system) and unit C0 (contract) have both merged**. SH consumes DS's primitives, motion
> tokens and keymap, and C0's regenerated client with `kind` removed. Do not start before both are
> on `main` (Task 1 Step 1 checks it).

**Goal:** Replace the kind-specific sidebar shell with the Aero glass shell of Foundation §5: a
64px rail, a top bar with a Ctrl K command palette and route actions, the seven project tabs, page
transitions, the new route map with a redirect for every old URL, the two route table files S1 and
S2 add to, no project kind anywhere in the UI, and today's screens hosted and restyled as the
interim Images, Maps and Measurements tabs.

**Architecture:** One pure module (`app/routeModel.ts`) turns a pathname into everything the
chrome needs (section, project, tab, page name, layout, transition key); the rail, top bar, tabs,
transition and palette all read it, so they can never disagree. Screens add to the chrome through
two small registries (`useCommands` for the palette, `useProvideRouteActions` for top-bar buttons)
instead of the shell knowing about them. Routes live in three table files under `routes/`
(`projectRoutes.tsx`, `appRoutes.tsx`, `legacyRedirects.tsx`) assembled by `routes/tree.tsx`;
S1, S2, I, M, C and R only ever edit the first two. Interim hosts (placeholders, an Add data
chooser, an in-page jobs list and a Data-list map table) keep every section reachable until S1 and
S2 land their real screens.

**Tech Stack:** React 18, react-router-dom 6.30 (data router, `RouteObject` tables), zustand 5,
the DS primitives in `frontend/src/ui/`, openapi-fetch against C0's client, vitest + Testing
Library (jsdom), Playwright against the Prism mock.

**Spec:** `docs/superpowers/specs/2026-09-26-foundation-design.md` §5 (shell, route map,
palette, transitions, keymap), §6.2 (the kind UI), §16 (tests), §18 (unit SH), §19 items 4–5; the
umbrella `docs/superpowers/specs/2026-09-26-inspection-platform-design.md` D8–D10 and §8. Visual
target: `.superpowers/brainstorm/1481982-1790403567/content/visual-directions.html` theme `.tD`
(rail, `.top`, `.tabs`) and `ws-images.html` / `ws-maps.html` / `ws-clouds.html`.

**Budget.** SH adds **no background job**; every importer it reaches (Add data) is today's job,
unchanged. Bounded reads only:
- the tab counts read `GET /projects/{id}/overview` (pre-aggregated, spec §9.1): one request per
  project open and per `data.changed` / `findings.changed` event;
- the Maps tab reads `GET /projects/{id}/data?type=map&type=elevation&type=drawing` in keyset pages
  of 100 with "Load more";
- palette search is `GET /projects/{id}/search?limit=8`, debounced 120ms by the palette, only for
  queries of two characters or more; the recent-projects group reads `GET /projects` (≤ 20) when
  the palette opens;
- "Label next" reads one image page (`IMAGE_PAGE_SIZE`), as the Label step did.
Nothing loads an image set, a finding table or a full data list into memory.

**DAG position.** Foundation critical path: **C0 → DS → SH → S1 → X** (spec §18). SH is batch 3,
alongside MG-steps; S1 and S2 cannot cut their worktrees until SH is on `main`, so SH ships the
route table files and the registries they add to, and nothing else of theirs.

## Global Constraints

- Worktree `.claude/worktrees/f-sh`, branch `task/f-sh`, created with `scripts\start-task.ps1 -Name f-sh` from a `main` that contains DS and C0. Stage by path, never `git add -A`. Commit messages end with a blank line and `Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>`.
- SH edits `contract/` only to retire `moveMapToProject` (C0 deprecated it with `x-retire-with: F-SH`; SH deletes its last caller, `MoveMapDialog`; Task 11 Step 4b), regenerating `schema.d.ts` in the same commit. Otherwise `contract/client/schema.d.ts` is C0's. If a field this plan reads is missing or named differently in C0's client, use C0's name (TypeScript will say which); if it does not exist at all, stop and report to the controller.
- Route map, verbatim from spec §5.3: `/` → `/projects`; `/p/:projectId` → `overview`; tabs `overview`, `images`, `images/:imageId`, `maps`, `maps/:mapId`, `clouds`, `clouds/:cloudId`, `findings`, `findings/:findingId`, `measurements`, `measurements/:measurementId`, `reports`, `settings`; secondary `runs`, `review`, `analytics`, `site-areas`, `query`, `export`; app `/models` → `/models/library`, `/models/datasets[/:datasetId]`, `/models/training[/:runId]`, `/catalogue`, `/catalogue/severity`, `/jobs`, `/settings`, `/about`.
- Redirects, verbatim from spec §5.3: `/p/:id/data` → `images`; `/edit/:imageId` → `images/:imageId`; `/label` → `images?filter=unlabeled`; `/past` → `overview`; `/past/maps/:mapId` → `maps/:mapId`; `/sources` → `maps`; `/surveys` → `analytics`; `/datasets` → `/models/datasets?project=:id`; `/train` → `/models/training`; `/library` → `/models/library`; plus `/volumes[/:id]` → `measurements[/:id]` ("redirects kept"). Every redirect keeps the old query string.
- The 3D jump contract `/p/:projectId/clouds/:cloudId?at=x,y[&fp=…]` keeps its exact shape; the comment block documenting it moves with the clouds routes into `routes/projectRoutes.tsx` verbatim.
- `routes.tsx` and `routes/tree.tsx` are SH's. S1 and S2 add entries only to `routes/projectRoutes.tsx` and `routes/appRoutes.tsx` (spec §19 item 5). Redirects live in `routes/legacyRedirects.tsx`.
- No `kind` of a **project** anywhere in `frontend/src` or `frontend/e2e` after Task 11 (spec §17 item 1). Other `kind` fields (source kind, measure kind, provenance kind, surface kind) are unrelated and stay.
- Motion (spec §4.2): animate only `transform` and `opacity`; no exit animation; nothing on an interaction path longer than 400ms; durations and easings come from the DS tokens `--dur-base`, `--ease-out`, `--ease-in-out`; reduced motion is honoured because DS sets `--dur-base: 0ms` under it.
- `node scripts/check-tokens.mjs` (inside `pnpm -C frontend lint`) passes with DS's rules: no raw palette, no arbitrary colours or `rgba(` in `className`, no `backdrop-blur`/`backdrop-filter` outside `ui/`, no `duration-\d+`, `ease-[`, `delay-\d+`, `rounded-[`, `font-[`, `shadow-[`, no retired Contour names (`ground`, `side`, `panel`, `well`, `canvas`, `accent-line`, `warn-strong`, `inverse`).
- UI copy: sentence case, plain words, no unit or sub-project names ("S1", "SH") in anything the operator sees.
- Interim screens (Images = `DataManagerScreen` + `EditorScreen`, Maps = `maps/MapDataList.tsx` + `MapsScreen`, Measurements = `VolumesScreen`, Point clouds = `CloudsScreen`) change only through primitives and tokens; the only behaviour changes are the ones spec §6.2 lists (kind branches become the union) and the moved "Label next" and "Use in dataset…".
- UI work loads the design skills first (AGENTS.md item 3): `impeccable` or `emil-design-eng`, plus `DESIGN.md` (rewritten by DS as "Design system: Aero glass") and `frontend/src/ui/`.
- The frontend gate: `pnpm -C frontend lint`, `pnpm -C frontend test`, `pnpm -C frontend build`, `pnpm -C frontend e2e` (free ports), plus `pnpm -C contract check` and the backend lines of AGENTS.md §4 in Task 15.

### Assumed DS and C0 names (reconcile in Task 1)

The DS plan (`docs/superpowers/plans/2026-09-26-foundation-ds-design-system.md`) appeared while this
plan was being finished. It **confirms** the Tailwind keys below (`bg-rail`, `bg-surface-2`,
`bg-tip`/`text-tip-fg` as RGB triplets, `bg-grad-brand`, `bg-grad-ink`, `shadow-elev-2`,
`duration-fast`, `text-2xs`, `rounded-panel|control|chip|sm` with `rounded-md`/`rounded-lg`/`shadow-float`
kept as aliases), the `app/effects.ts` API (`applyEffects`, `setEffectsChoice`, `readEffectsChoice`,
`runAutoProbe`), and that DS itself renames the Contour class names across `frontend/src` (its Task 2).
The reconciliation of 2026-09-26 replaced the earlier assumptions for `Tabs`, `CommandPalette`
(`CommandSource`), `MenuButton`/`Menu` and `StatusDot` with DS's final props (rows marked "DS plan,
confirmed" below), and this plan's code uses them. Task 1 Step 3 still greps the merged
code for each one. If DS or C0 named something differently, use their name everywhere this plan uses
the assumed one (imports and props only; the tests assert roles, names and URLs, so they do not
change).

| Used here | Source | Assumption |
| --- | --- | --- |
| `Tabs` | DS Task 11 | `Tabs({items: readonly TabItem[]; label: string; value?: string; onChange?(id): void; asLinks?: boolean; className?: string})`, `TabItem {id; label: ReactNode; count?: number \| null; to?: string; end?: boolean; disabled?: boolean}` (DS plan, confirmed); `role="tablist"`/`tab` with `aria-selected`; `asLinks` renders router `Link`s whose selection follows the route. Pass `value={tab ?? undefined}` |
| `CommandPalette`, `Command`, `CommandGroup`, `CommandSource` | DS Task 15 | `Command {id, title, hint?, icon?, shortcut?, run}`; `CommandPalette({open; onClose; groups: readonly CommandGroup[]; sources?: readonly CommandSource[]; placeholder?})`, DS's `CommandGroup {label; items: readonly Command[]}` (SH's registry keeps its own `CommandGroup` name union in `app/commands.ts`; no file imports both); `CommandSource {id: string; label: string; minQuery?: number (2); search(q, signal): Promise<readonly Command[]>}`, one group per source (DS plan, confirmed); debounced 120 ms; roles `dialog` "Command palette", `combobox` "Command", `listbox`, `option` |
| `MenuButton` (and `Menu`) | DS Task 12 | `MenuButton({label: string; items: readonly MenuItem[]; menuLabel?: string; iconOnly?: boolean; side?; align?} & button props)` renders a `button` named `label` that opens `Menu` (`role="menu"`/`menuitem`); `MenuItem {id; label; icon?; hint?; shortcut?; danger?; disabled?; onSelect()}`. `Menu` itself is the controlled popup (`open`, `onClose`, `anchorRef`) (DS plan, confirmed) |
| `StatusDot` | DS Task 10 | `StatusDot({status: DotStatus; live?: boolean; label?: string; className?: string})`, `DotStatus = "open" \| "reviewed" \| "closed" \| "running" \| "failed" \| "idle"` (DS plan, confirmed; `label` → `aria-label`) |
| `Tooltip` `shortcut`, `Kbd`, `EmptyState`, `Dialog`, `Button`, `IconButton`, `buttonClass`, `Pill` (`tone: "accent"\|"ok"\|"danger"\|"neutral"`, `live`, `size`), `Segmented`, `Icon` | DS, rewritten in place | today's props kept (spec §4.4: "API kept wherever callers allow") |
| Icons `catalogue`, `jobs`, `findings`, `measure`, `report`, `overview`, `sparkle`, `layers`, `drawing`, `elevation` | DS, spec §4.4 | verbatim |
| Tailwind keys `bg-rail`, `bg-field`, `bg-hover`, `bg-surface`, `bg-surface-2`, `bg-bg`, `text-bg`, `bg-tip`, `text-tip-fg`, `bg-accent-soft`, `text-accent-ink`, `border-line`, `border-line-strong`, `bg-warn`, `shadow-elev-1`, `shadow-elev-2`, `rounded-panel`, `rounded-control`, `rounded-chip`, `text-2xs`, `duration-fast` | DS plan Task 1 "Produces" | confirmed |
| `bg-grad-brand`, `bg-grad-ink` | DS plan Task 1 (`backgroundImage`) | confirmed |
| `app/effects.ts` `setEffectsChoice(c: "auto"\|"full"\|"reduced"): void`; the effective mode is `<html data-effects="full\|reduced">` | DS plan, resolved ambiguity 2 | confirmed name; the argument union is spec §4.3 |
| CSS vars `--dur-base`, `--ease-out`, `--ease-in-out` | DS, spec §4.2 | verbatim |
| `components["schemas"]["ProjectOverview"]` with `data.images`, `data.maps`, `data.point_clouds`, `findings.by_status.open` | C0, spec §9.1 / §8.3 | `by_status` as `{open, reviewed, closed}` **(assumed)** |
| `components["schemas"]["DataItem"]` `{id, type, label, captured_on, status, summary, created_at}`; `GET /api/v1/projects/{projectId}/data` query `{type?: DataItemType[], limit?, cursor?}` → `{items, next_cursor}` | C0, spec §6.3 | verbatim; `type` as a repeated query array **(assumed)** |
| `GET /api/v1/projects/{projectId}/search` query `{q, limit}` → `{findings: Finding[], data: DataItem[]}`; `Finding {id, number, type_id, note}` | C0, spec §10.3 / §8.1 | verbatim |
| `AppEvent.type` includes `data.changed`, `findings.changed`; `ProjectCreate {name, folder, type_ids}`; `JobType` includes `project_migrate`, `findings_backfill`, `findings_recount`, `dataset_build` | C0, spec §13 | verbatim |

## Review Focus

1. **An old link with a query string** (`/p/:id/train?job=…`, `/library?model=…`, `/p/:id/edit/:img?finding=…`) must land on the new route with its query intact, because the Jobs toasts, library links and saved bookmarks all carry one. Pinned by the query cases in `routes/routes.test.tsx` (Task 9).
2. **Ctrl K pressed inside a text field or on a work surface** (the editor, the map's window-level key handler) must open the palette and must not type a "k" or reach the workspace. Pinned by `usePaletteShortcut` tests (Task 7) and the Shell test (Task 10).
3. **The overview endpoint failing** (503, 404 before BC merges, a project still upgrading) must leave the tabs usable without counts, never an error screen. Pinned by `useProjectCounts` and `ProjectTabs` tests (Task 5).
4. **A project whose `GET /projects/{id}` fails** (409 `project_upgrading` from MG) must still render the rail, top bar ("Project" as its name) and tabs. Pinned by the Shell test (Task 10).
5. **An address that matches no route** (a bookmark to a page that no longer exists, a typo) must render inside the shell with a way back, not React Router's default error page. Pinned by the NotFound cases in `routes/routes.test.tsx` (Task 9).

---

## File map

**Create (frontend/src):**

| File | Responsibility |
| --- | --- |
| `app/routeModel.ts` | pathname → `RouteInfo` (section, project, tab, page, layout, transition key); the tab, secondary-page and rail tables |
| `app/commands.ts` | the palette command registry and `useCommands` |
| `app/routeActions.ts` | `RouteAction`, the default actions per route, `useProvideRouteActions`, `useRouteActions` |
| `app/addDataStore.ts` | `useAddData` open/tile state |
| `app/AddDataHost.tsx` | the interim Add data chooser (S1 replaces its body) |
| `app/jobVerbs.ts` | `JOB_VERB` (moved from `Header.tsx`) |
| `app/RunningPill.tsx` | the running-job pill, a link to `/jobs?project=` |
| `app/Rail.tsx` | the 64px rail |
| `app/TopBar.tsx` | breadcrumb, palette field, route actions, agent button |
| `app/useProjectCounts.ts` | tab counts from the overview |
| `app/ProjectTabs.tsx` | the seven tabs + the More menu |
| `app/transition.ts`, `app/PageTransition.tsx` | the tab entrance |
| `app/usePaletteShortcut.ts`, `app/paletteCommands.ts`, `app/Palette.tsx` | Ctrl K and the palette's groups and search |
| `app/InterimScreens.tsx` | interim Overview, Findings and app-section placeholders |
| `app/InterimJobs.tsx` | interim `/jobs` page (S2 replaces) |
| `app/NotFound.tsx` | the in-shell unknown-address page |
| `reports/ReportsPlaceholder.tsx` | the Reports tab EmptyState (spec §5.3) |
| `maps/dataItems.ts`, `maps/MapDataList.tsx` | the interim Maps tab |
| `data/labelNext.ts` | "Label next" (moved from `LabelResolverScreen`) |
| `review/reviewView.ts` | which review a URL asks for |
| `routes/Redirect.tsx`, `routes/legacyRedirects.tsx`, `routes/projectRoutes.tsx`, `routes/appRoutes.tsx`, `routes/tree.tsx` | the route tables |

Tests next to each: `app/routeModel.test.ts`, `app/commands.test.tsx`, `app/routeActions.test.tsx`, `app/AddDataHost.test.tsx`, `app/Rail.test.tsx`, `app/TopBar.test.tsx`, `app/useProjectCounts.test.tsx`, `app/ProjectTabs.test.tsx`, `app/PageTransition.test.tsx`, `app/paletteCommands.test.ts`, `app/Palette.test.tsx`, `app/usePaletteShortcut.test.tsx`, `app/InterimScreens.test.tsx`, `app/InterimJobs.test.tsx`, `maps/MapDataList.test.tsx`, `data/labelNext.test.ts`, `review/reviewView.test.ts`, `routes/routes.test.tsx`; e2e `e2e/mock.ts`, `e2e/shell.spec.ts`.

**Modify:** `app/Shell.tsx` (+test), `app/Brand.tsx`, `app/lazyScreens.tsx`, `app/AdoptionBanner.tsx` (+test), `routes.tsx`, `store/changes.ts` (+test), `test/fixtures.ts`, `screens/DataManagerScreen.tsx` (+test), `data/SelectionBar.tsx` (+test), `screens/ReviewScreen.tsx` (+2 tests), `review/DetectReview.tsx` (+test), `screens/ExportScreen.tsx` (+test), `screens/ProjectsScreen.tsx` (+test), `api/adoption.ts` (+test), `settings/SourcesSection.tsx` (+test), `jobs/jobLabels.ts` (+test), the link strings of Task 12, the token sweep of Task 13, the e2e specs of Task 14.

**Delete:** `app/Sidebar.tsx`, `Header.tsx`, `KindRoute.tsx`, `useProjectKind.ts`, `pipeline.ts`, `nextStep.ts`, `projectNextStep.ts`, `NextStepBar.tsx`, `useProjectProgress.ts`, `useHomePreviews.ts` and their tests; `store/progress.ts`; `screens/HomeScreen.tsx`, `LabelResolverScreen.tsx`, `PastDetectionsScreen.tsx`, `SourcesScreen.tsx`, `DatasetsScreen.tsx`, `TrainScreen.tsx` and their tests; `sources/SourceTable.tsx`, `sources/sourceRows.ts` (+test), `sources/useSources.ts`, `sources/SurveysRedirect.tsx` (+test); `maps/MoveMapDialog.tsx` (+test); `data/AddToDatasetDialog.tsx` (+test); `e2e/kinds.ts`, `e2e/past-detections.spec.ts`, `e2e/sources.spec.ts`, `e2e/datasets.spec.ts`, `e2e/train.spec.ts`.

## Deviations and resolved ambiguities (recorded so reviewers do not flag them)

1. **Transition key.** §5.5 says "keys on the first two path segments after the project", which for `/findings/:findingId` would change with the id, contradicting "a change within a tab does not animate". SH keys project routes on the **tab segment** (`p/<id>/<tab>`) and app routes on the first two segments (`models/datasets`), so sub-tabs animate and item ids never do.
2. **Which surfaces are full-bleed.** §5.2 hides the tabs on "the Maps and Point clouds workspaces". Until M and C build them, the interim hosts decide: `/maps/:mapId` (today's `MapsScreen`, already a work surface) is full-bleed; `/clouds…` stays a padded page with tabs, because `CloudsScreen` is "unchanged" and was never full-bleed. `layoutOf()` in `app/routeModel.ts` is the one place M and C change when their workspaces land. `/images/:imageId` is a bare workspace **with** tabs (I §6).
3. **Jobs drawer.** §5.1 deletes `JobsPanel`/`JobsButton`, but the Jobs section that replaces them is S2's. SH removes `JobsButton` from the chrome, makes the rail's Jobs entry and the RunningPill go to `/jobs?project=`, serves `/jobs` with an interim in-page list (`app/InterimJobs.tsx`), and **keeps `JobsPanel` mounted** so the toasts' "Show log" and Settings → Sources' re-import keep opening it. S2 deletes `InterimJobs` with the Jobs screen (its Task 6). S2's plan does **not** delete `JobsPanel`, `JobsButton` or `panelOpen` (30 test files, S1's among them, reset `panelOpen`), so they stay after Foundation; their removal is open for the coordinator (reconciliation 2026-09-26).
4. **Interim screens for S1/S2 routes.** Overview, Findings, Catalogue, Datasets and Training get `app/InterimScreens.tsx` placeholders in the table files; Add data gets `app/AddDataHost.tsx` (Photos and Orthomosaic open today's importers, Elevation and Point cloud open the screens that import them, Drawing disabled). S1 and S2 swap these entries; nothing else of theirs is built here.
5. **Context actions of S2's screens** (Catalogue "New type", Datasets "New dataset", Library "Import model") need S2's handlers. SH ships the mechanism (`useProvideRouteActions`) and the project-route defaults (Add data, Generate report, the disabled New finding); S2 registers its three.
6. **Secondary pages menu.** §5.3 says secondary routes are "reachable from the Images and Maps tab overflow `Menu`". SH puts **one** "More" `MenuButton` at the end of the tab strip, listing Runs, Review, Detect, Analytics, Site areas, Export and Project settings (Project settings has no tab and needs a way in too). I and M may move entries into their workspaces.
7. **Review union.** §6.2 "Review shows both image-box review and run review": a `Segmented` "Image suggestions · Detection runs" at the top of `/review`, driven by `?view=`. `?ids=` forces suggestions, `?source=` implies runs, the default is suggestions.
8. **"Use in dataset…" preselection.** §6.2 wants "the selected images' types preselected", but an `Image` row carries no class ids and loading its boxes is an unbounded read. SH navigates to `/models/datasets?new=1&project=<id>`; S2's builder preselects the project's type list. S2 reads `new=1` and `project=`.
9. **`SourcesScreen`.** The spec redirects `/sources` → `maps` and does not keep the screen. Its one unique feature, survey-date correction, is kept: map rows in `MapDataList` and photo folders in Settings → Sources get the existing `SurveyDateCell`. `SourceTable`, `sourceRows` and `useSources` become unused and are deleted. "Run a model" from a row is still on Runs.
10. **`/models/datasets` and `/models/training` before S2** show placeholders; today's `screens/DatasetsScreen.tsx` and `TrainScreen.tsx` are deleted. Their per-project endpoints did **not** leave the contract in C0: they are `deprecated` with `x-retire-with: F-S2`, and S2 removes them with their last callers (`api/datasets.ts`, `train/useDatasets.ts`, `api/library.ts::trainModel`), which SH leaves alone. `datasets/`, `train/` and `library/` components stay for S2.
11. **Idle dot colour.** §5.1 "green when idle": DS's `StatusDot` has an `idle` status (the `--ok` green), used with `aria-label="Idle"`; busy is `running` + `live`.
12. **The `?` shortcut sheet is SH's** (the index). Task 10b renders DS's keymap table (`keysFor(scope)` from `@/ui/keymap`) in a `Dialog`, opened by `?` anywhere outside a text field; it adds no key. Today's screen-level shortcut buttons stay; I, M and C only add their workspace scopes to DS's table.
13. **New project from the palette** navigates to `/projects?new=1`; S1's rewritten Projects screen honours `new=1`.
14. **ProjectsScreen** gets only the kind removal here (name + folder, `type_ids: []`); S1 rewrites it (§9.2).
15. **Palette search result links** use the canonical `/p/:pid/findings/:findingId`; S1's `findings/links.ts` `findingHref` may replace the inline builder in `app/paletteCommands.ts`.

## Names the neighbouring plans assumed (for their Task 0 reconciliation)

The S1 and S2 plans were written in parallel with this one and guessed SH's shapes. What SH actually
ships, so their Task 0 maps in one step:

| S1/S2 assumed | SH ships |
| --- | --- |
| S1: a project layout route element (`app/ProjectLayout.tsx`) rendering `ProjectTabs` + `<Outlet/>`, where S1 mounts `<ProjectAddData/>` | no layout element: `Shell` renders `ProjectTabs` and mounts `<AddDataHost project={project}/>`. S1 replaces `AddDataHost`'s body with its dialog (or swaps the one mount line in `Shell.tsx`) |
| S1: `data/addDataStore.ts` `openAddData(projectId, tile?)` | `app/addDataStore.ts` `useAddData.getState().show(tile \| null)`; the project is the one in the URL. S1 may add `openAddData` as a thin wrapper around it |
| S1: `useCommands(commands)` with `Command.group: "go" \| "actions"` | `useCommands(commands, group?: "Go to" \| "Actions")` (default "Actions"); `Command` is DS's, without a `group` field |
| S2: `useRouteActions(actions)` registers, `RouteAction.primary?: boolean`, `run` required | `useProvideRouteActions(actions)` registers; `useRouteActions()` reads; `RouteAction.variant?: "primary" \| "secondary"`, `run?` or `to?` |
| S2: redirects "all in `routes.tsx`" | in `routes/legacyRedirects.tsx`, assembled by `routes/tree.tsx` |
| S2: `/models/datasets?new=1[&project=…]` builder URL, `datasetBuilderHref()` | SH's "Use in dataset…" and the all-labeled alert hard-code `/models/datasets?new=1&project=<id>`; S2 may swap both for `datasetBuilderHref()` |
| S2: "Label next" as an Images route action | SH ships it as a button in `DataManagerScreen` with the logic in `data/labelNext.ts`; either is fine |
| S2: `useSeverityScaleSync()` added to `Shell.tsx` (one line) | SH leaves room: add it at the top of `Shell()` |
| S2/DS: the severity-scale provider "added by SH or S2" | S2 (SH adds none) |

## Execution DAG (inside SH)

| Task | Depends on | Batch |
| --- | --- | --- |
| 1 Worktree, baseline gate, name reconciliation, route model | DS, C0 on `main` | B0 |
| 2 Command registry, route actions, Add data store | 1 | B1 |
| 3 Rail and logo tile | 1 | B1 |
| 5 Tab counts and ProjectTabs | 1 | B1 |
| 6 PageTransition | 1 | B1 |
| 4 TopBar and RunningPill | 2 | B2 |
| 7 Palette and Ctrl K | 2 | B2 |
| 8 Interim hosts: placeholders, jobs, Add data, Maps list, NotFound | 2 | B2 |
| 9 Route tables and redirects | 8 | B3 |
| 10 Shell cutover and old-shell deletions | 3, 4, 5, 6, 7, 9 | B4 |
| 10b The `?` shortcut sheet | 10 | B5 |
| 11 Kind removal in screens (§6.2), Label next, Use in dataset | 10 | B5 |
| 12 Internal links onto the new routes | 10 | B5 |
| 13 Token and restyle sweep | 11, 12 | B6 |
| 14 e2e migration and `shell.spec.ts` | 13 | B7 |
| 15 Gate, ledger, merge, hand-off | all | B8 |

**Critical path:** 1 → 2 → 8 → 9 → 10 → 11 → 13 → 14 → 15. One worker runs the tasks in numeric
order (which respects every edge); the batches show what a reviewer can take independently. The
build stays green at every commit: Tasks 2–9 add unused modules, Task 10 switches over.

---

### Task 1: Worktree, baseline gate, name reconciliation and the route model

**Files:**
- Create: `frontend/src/app/routeModel.ts`
- Test: `frontend/src/app/routeModel.test.ts`

**Interfaces:**
- Consumes: DS's `IconName` from `@/ui`.
- Produces (used by every later task):
  ```ts
  export type ProjectTabId = "overview" | "images" | "maps" | "clouds" | "findings" | "measurements" | "reports";
  export type Section = "projects" | "models" | "catalogue" | "jobs" | "settings";
  export type Layout = "page" | "workspace" | "fullbleed";
  export interface NavEntry<Id extends string = string> { id: Id; label: string; icon: IconName }
  export interface RailEntry extends NavEntry<Section> { to: string }
  export const PROJECT_TABS: readonly NavEntry<ProjectTabId>[];
  export const SECONDARY_PAGES: readonly NavEntry[];
  export const RAIL_ENTRIES: readonly RailEntry[];
  export const RAIL_SETTINGS: RailEntry;
  export const SECTION_LABEL: Record<Section, string>;
  export interface RouteInfo { section: Section | null; projectId: string | null; tab: ProjectTabId | null; page: string | null; layout: Layout; transitionKey: string }
  export function layoutOf(tab: string, detail: boolean): Layout;
  export function routeInfo(pathname: string): RouteInfo;
  ```

- [ ] **Step 1: Create the worktree and prove DS and C0 are on `main`**

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File E:\Dev\Yolo\app\scripts\start-task.ps1 -Name f-sh
cd E:\Dev\Yolo\app\.claude\worktrees\f-sh
git log -1 --oneline; git -C E:\Dev\Yolo\app log -1 --oneline main
git log --oneline main | Select-String -Pattern "DS|design system|C0|contract" | Select-Object -First 6
Test-Path frontend\src\ui\CommandPalette.tsx, frontend\src\ui\Tabs.tsx, frontend\src\ui\keymap.ts, frontend\src\app\effects.ts
Select-String -Path contract\openapi.yaml -Pattern "ProjectKind|WrongProjectKind" | Measure-Object | Select-Object -ExpandProperty Count
```

Expected: `worktree ready on task/f-sh`; both `git log -1` lines name the same commit; the merge commits of DS and C0 are listed; four `True`; `0` (C0 removed the kind from the contract). Any `False` or a count above 0: stop and report to the controller that DS or C0 has not merged.

- [ ] **Step 2: Run the baseline gate**

```powershell
pnpm -C frontend install --frozen-lockfile
pnpm -C frontend lint; pnpm -C frontend test; pnpm -C frontend build
```

Expected: all three pass on the untouched worktree. If `lint` fails only in `check-tokens` on files outside `src/ui/` with retired Contour names, note the file list: Task 13 clears them (DS may have shipped its new rules with a baseline file; Task 13 empties it). Any other failure: stop and report; it is DS's or C0's gate, not SH's.

- [ ] **Step 3: Reconcile the assumed names**

```powershell
cd frontend
Select-String -Path src\ui\index.ts -Pattern "Tabs|CommandPalette|Command\b|CommandSource|Menu|StatusDot|GlassPanel|Kbd|Tooltip"
Select-String -Path src\ui\Tabs.tsx, src\ui\CommandPalette.tsx, src\ui\Menu.tsx, src\ui\StatusDot.tsx -Pattern "export (interface|type|function)|^\s+[a-zA-Z]+\??:"
Select-String -Path src\app\effects.ts -Pattern "export function"
Select-String -Path tailwind.config.ts -Pattern "rail|field|surface|tip|grad|elev|panel|control|chip|2xs|fast"
Select-String -Path src\ui\Icon.tsx -Pattern "catalogue|jobs|findings|measure|report|overview|sparkle|layers|drawing|elevation"
Select-String -Path ..\contract\client\schema.d.ts -Pattern "ProjectOverview|DataItem:|by_status|/search|data.changed|findings.changed|type_ids"
cd ..
```

Expected: every name in "Assumed DS and C0 names" is found. For each one that differs, write the actual name down (in the SDD ledger for this plan, `.superpowers/sdd/f-sh/ledger.md`) and use it in every later task in place of the assumed one. No commit in this step.

- [ ] **Step 4: Write the failing test**

`frontend/src/app/routeModel.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { PROJECT_TABS, RAIL_ENTRIES, RAIL_SETTINGS, layoutOf, routeInfo } from "./routeModel";

describe("routeInfo", () => {
  it.each([
    ["/", "projects", null, "Projects"],
    ["/projects", "projects", null, "Projects"],
    ["/p/abc", "projects", "overview", "Overview"],
    ["/p/abc/overview", "projects", "overview", "Overview"],
    ["/p/abc/images", "projects", "images", "Images"],
    ["/p/abc/images/i1", "projects", "images", "Images"],
    ["/p/abc/maps/m1", "projects", "maps", "Maps"],
    ["/p/abc/clouds/c1", "projects", "clouds", "Point clouds"],
    ["/p/abc/findings/f1", "projects", "findings", "Findings"],
    ["/p/abc/measurements", "projects", "measurements", "Measurements"],
    ["/p/abc/runs", "projects", null, "Runs"],
    ["/p/abc/query", "projects", null, "Detect"],
    ["/p/abc/site-areas", "projects", null, "Site areas"],
    ["/p/abc/settings", "projects", null, "Project settings"],
    ["/models", "models", null, "Library"],
    ["/models/datasets/d1", "models", null, "Datasets"],
    ["/models/training", "models", null, "Training"],
    ["/catalogue", "catalogue", null, "Types"],
    ["/catalogue/severity", "catalogue", null, "Severity"],
    ["/jobs", "jobs", null, "Jobs"],
    ["/settings", "settings", null, "Settings"],
    ["/about", "settings", null, "About"],
    ["/nowhere", null, null, null],
  ])("%s is section %s, tab %s, page %s", (path, section, tab, page) => {
    const info = routeInfo(path);
    expect(info.section).toBe(section);
    expect(info.tab).toBe(tab);
    expect(info.page).toBe(page);
  });

  it("reads the project id only inside a project", () => {
    expect(routeInfo("/p/abc/images").projectId).toBe("abc");
    expect(routeInfo("/models/library").projectId).toBeNull();
  });

  it("frames pages: the images workspace keeps the tabs, the map workspace is full-bleed", () => {
    expect(routeInfo("/p/a/images").layout).toBe("page");
    expect(routeInfo("/p/a/images/i1").layout).toBe("workspace");
    expect(routeInfo("/p/a/maps").layout).toBe("page");
    expect(routeInfo("/p/a/maps/m1").layout).toBe("fullbleed");
    expect(routeInfo("/p/a/clouds/c1").layout).toBe("page");
    expect(layoutOf("findings", true)).toBe("page");
  });

  it("keys transitions on the tab, never on an item inside it", () => {
    const key = (p: string) => routeInfo(p).transitionKey;
    expect(key("/p/a/findings")).toBe(key("/p/a/findings/f1"));
    expect(key("/p/a/images")).toBe(key("/p/a/images/i1"));
    expect(key("/p/a")).toBe(key("/p/a/overview"));
    expect(key("/p/a/images")).not.toBe(key("/p/a/maps"));
    expect(key("/models/datasets")).toBe(key("/models/datasets/d1"));
    expect(key("/models/library")).not.toBe(key("/models/datasets"));
    expect(key("/")).toBe(key("/projects"));
  });

  it("has the seven tabs and the rail entries in the spec's order", () => {
    expect(PROJECT_TABS.map((t) => t.label)).toEqual([
      "Overview",
      "Images",
      "Maps",
      "Point clouds",
      "Findings",
      "Measurements",
      "Reports",
    ]);
    expect([...RAIL_ENTRIES, RAIL_SETTINGS].map((e) => e.label)).toEqual([
      "Projects",
      "Models",
      "Catalogue",
      "Jobs",
      "Settings",
    ]);
  });
});
```

- [ ] **Step 5: Run it to verify it fails**

Run: `pnpm -C frontend exec vitest run src/app/routeModel.test.ts`
Expected: FAIL, `Failed to resolve import "./routeModel"`.

- [ ] **Step 6: Write the implementation**

`frontend/src/app/routeModel.ts`:

```ts
import type { IconName } from "@/ui";

/** The seven project tabs, in order (spec 2026-09-26-foundation section 5.2). */
export type ProjectTabId = "overview" | "images" | "maps" | "clouds" | "findings" | "measurements" | "reports";
/** The rail's sections (section 5.1). */
export type Section = "projects" | "models" | "catalogue" | "jobs" | "settings";
/** A padded, scrolling page; a bare workspace under the tabs; or a full-bleed surface without tabs. */
export type Layout = "page" | "workspace" | "fullbleed";

export interface NavEntry<Id extends string = string> {
  id: Id;
  label: string;
  icon: IconName;
}

export interface RailEntry extends NavEntry<Section> {
  to: string;
}

export const PROJECT_TABS: readonly NavEntry<ProjectTabId>[] = [
  { id: "overview", label: "Overview", icon: "overview" },
  { id: "images", label: "Images", icon: "images" },
  { id: "maps", label: "Maps", icon: "map" },
  { id: "clouds", label: "Point clouds", icon: "cloud" },
  { id: "findings", label: "Findings", icon: "findings" },
  { id: "measurements", label: "Measurements", icon: "measure" },
  { id: "reports", label: "Reports", icon: "report" },
];

/** Project pages without a tab (section 5.3): the tab strip's More menu and the palette reach them. */
export const SECONDARY_PAGES: readonly NavEntry[] = [
  { id: "runs", label: "Runs", icon: "detect" },
  { id: "review", label: "Review", icon: "review" },
  { id: "query", label: "Detect", icon: "detect" },
  { id: "analytics", label: "Analytics", icon: "trend" },
  { id: "site-areas", label: "Site areas", icon: "map" },
  { id: "export", label: "Export", icon: "download" },
  { id: "settings", label: "Project settings", icon: "settings" },
];

export const RAIL_ENTRIES: readonly RailEntry[] = [
  { id: "projects", label: "Projects", icon: "folder", to: "/projects" },
  { id: "models", label: "Models", icon: "models", to: "/models" },
  { id: "catalogue", label: "Catalogue", icon: "catalogue", to: "/catalogue" },
  { id: "jobs", label: "Jobs", icon: "jobs", to: "/jobs" },
];

export const RAIL_SETTINGS: RailEntry = { id: "settings", label: "Settings", icon: "settings", to: "/settings" };

export const SECTION_LABEL: Record<Section, string> = {
  projects: "Projects",
  models: "Models",
  catalogue: "Catalogue",
  jobs: "Jobs",
  settings: "Settings",
};

const MODELS_PAGES: Record<string, string> = { library: "Library", datasets: "Datasets", training: "Training" };

export interface RouteInfo {
  section: Section | null;
  projectId: string | null;
  /** The highlighted project tab; null on secondary pages and outside a project. */
  tab: ProjectTabId | null;
  /** The human name of the page, for the breadcrumb; null when unknown. */
  page: string | null;
  layout: Layout;
  /** Changes when the page transition should play: the tab in a project, two segments elsewhere. */
  transitionKey: string;
}

/**
 * How the shell frames a project page. The one place a workspace unit changes when its surface
 * lands: M makes `maps` full-bleed at its list too, C makes `clouds` full-bleed.
 */
export function layoutOf(tab: string, detail: boolean): Layout {
  if (tab === "maps" && detail) return "fullbleed";
  if (tab === "images" && detail) return "workspace";
  return "page";
}

export function routeInfo(pathname: string): RouteInfo {
  const parts = pathname.split("/").filter(Boolean);
  const [head, second] = parts;
  const app = (section: Section | null, page: string | null): RouteInfo => ({
    section,
    projectId: null,
    tab: null,
    page,
    layout: "page",
    transitionKey: parts.slice(0, 2).join("/"),
  });
  if (!head || head === "projects") return { ...app("projects", "Projects"), transitionKey: "projects" };
  if (head === "p" && second) {
    const seg = parts[2] ?? "overview";
    const tab = PROJECT_TABS.find((t) => t.id === seg) ?? null;
    const secondary = SECONDARY_PAGES.find((s) => s.id === seg) ?? null;
    return {
      section: "projects",
      projectId: second,
      tab: tab?.id ?? null,
      page: tab?.label ?? secondary?.label ?? null,
      layout: layoutOf(seg, parts.length > 3),
      transitionKey: `p/${second}/${seg}`,
    };
  }
  if (head === "models") return app("models", second ? (MODELS_PAGES[second] ?? null) : "Library");
  if (head === "catalogue") return app("catalogue", second === "severity" ? "Severity" : "Types");
  if (head === "jobs") return app("jobs", "Jobs");
  if (head === "settings") return app("settings", "Settings");
  if (head === "about") return app("settings", "About");
  return app(null, null);
}
```

- [ ] **Step 7: Run it to verify it passes**

Run: `pnpm -C frontend exec vitest run src/app/routeModel.test.ts`
Expected: PASS (27 tests).

- [ ] **Step 8: Commit**

```powershell
git add frontend/src/app/routeModel.ts frontend/src/app/routeModel.test.ts
git commit -m "feat(shell): route model - section, tab, page, layout and transition key from a path" -m "Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: Command registry, route actions and the Add data store

**Files:**
- Create: `frontend/src/app/commands.ts`, `frontend/src/app/routeActions.ts`, `frontend/src/app/addDataStore.ts`
- Test: `frontend/src/app/commands.test.tsx`, `frontend/src/app/routeActions.test.tsx`

**Interfaces:**
- Consumes: `routeInfo`, `RouteInfo` (Task 1); DS `Command`, `IconName`.
- Produces:
  ```ts
  // app/commands.ts
  export type CommandGroup = "Go to" | "Actions";
  export interface CommandEntry { key: string; group: CommandGroup; commands: readonly Command[] }
  export const useCommandRegistry: UseBoundStore<StoreApi<{ entries: CommandEntry[]; put(e: CommandEntry): void; remove(key: string): void }>>;
  export function collectCommands(entries: readonly CommandEntry[], group: CommandGroup): Command[];
  export function useCommands(commands: readonly Command[], group?: CommandGroup): void;
  // app/routeActions.ts
  export interface RouteAction { id: string; label: string; icon?: IconName; variant?: "primary" | "secondary"; to?: string; run?: () => void; disabled?: boolean; tooltip?: string }
  export function defaultRouteActions(info: RouteInfo, openAddData: () => void): RouteAction[];
  export const useProvidedRouteActions: UseBoundStore<...>;   // test reset only
  export function useProvideRouteActions(actions: readonly RouteAction[]): void;   // S2 registers New type, New dataset, Import model
  export function useRouteActions(): RouteAction[];
  // app/addDataStore.ts
  export type AddDataTile = "photos" | "orthomosaic" | "elevation" | "point_cloud";
  export const useAddData: UseBoundStore<StoreApi<{ open: boolean; tile: AddDataTile | null; show(tile: AddDataTile | null): void; close(): void }>>;
  ```

- [ ] **Step 1: Write the failing tests**

`frontend/src/app/commands.test.tsx`:

```tsx
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render } from "@testing-library/react";
import type { Command } from "@/ui";
import { collectCommands, useCommandRegistry, useCommands, type CommandGroup } from "./commands";

function Registers({ commands, group }: { commands: Command[]; group?: CommandGroup }) {
  useCommands(commands, group);
  return null;
}

const cmd = (id: string, title = id): Command => ({ id, title, run: vi.fn() });

describe("the command registry", () => {
  beforeEach(() => useCommandRegistry.setState({ entries: [] }));

  it("adds a screen's commands while it is mounted and removes them after", () => {
    const view = render(<Registers commands={[cmd("tool:box", "Box tool")]} />);
    const actions = () => collectCommands(useCommandRegistry.getState().entries, "Actions");
    expect(actions().map((c) => c.title)).toEqual(["Box tool"]);
    view.unmount();
    expect(actions()).toEqual([]);
  });

  it("keeps groups apart", () => {
    render(
      <>
        <Registers commands={[cmd("a")]} group="Go to" />
        <Registers commands={[cmd("b")]} />
      </>,
    );
    const { entries } = useCommandRegistry.getState();
    expect(collectCommands(entries, "Go to").map((c) => c.id)).toEqual(["a"]);
    expect(collectCommands(entries, "Actions").map((c) => c.id)).toEqual(["b"]);
  });

  it("lets a later registration of the same id replace the earlier one", () => {
    render(
      <>
        <Registers commands={[cmd("x", "Old")]} />
        <Registers commands={[cmd("x", "New")]} />
      </>,
    );
    expect(collectCommands(useCommandRegistry.getState().entries, "Actions").map((c) => c.title)).toEqual([
      "New",
    ]);
  });

  it("follows a screen whose commands change", () => {
    const view = render(<Registers commands={[cmd("a")]} />);
    view.rerender(<Registers commands={[cmd("b")]} />);
    expect(collectCommands(useCommandRegistry.getState().entries, "Actions").map((c) => c.id)).toEqual(["b"]);
  });
});
```

`frontend/src/app/routeActions.test.tsx`:

```tsx
import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { MemoryRouter } from "react-router-dom";
import { useAddData } from "./addDataStore";
import {
  defaultRouteActions,
  useProvideRouteActions,
  useProvidedRouteActions,
  useRouteActions,
  type RouteAction,
} from "./routeActions";
import { routeInfo } from "./routeModel";

const at =
  (path: string) =>
  ({ children }: { children: ReactNode }) => <MemoryRouter initialEntries={[path]}>{children}</MemoryRouter>;

describe("route actions", () => {
  beforeEach(() => {
    useProvidedRouteActions.setState({ entries: [] });
    useAddData.setState({ open: false, tile: null });
  });

  it("gives every project route Add data and Generate report, the report opening the Reports tab", () => {
    const open = vi.fn();
    const actions = defaultRouteActions(routeInfo("/p/p1/images"), open);
    expect(actions.map((a) => a.label)).toEqual(["Add data", "Generate report"]);
    expect(actions[1]).toMatchObject({ variant: "primary", to: "/p/p1/reports" });
    actions[0].run?.();
    expect(open).toHaveBeenCalled();
  });

  it("shows New finding on the Findings tab, disabled with the reason", () => {
    const [first] = defaultRouteActions(routeInfo("/p/p1/findings"), vi.fn());
    expect(first).toMatchObject({ label: "New finding", disabled: true });
    expect(first.tooltip).toMatch(/created in the Images, Maps and Point clouds workspaces/);
  });

  it("gives app sections no default actions", () => {
    expect(defaultRouteActions(routeInfo("/catalogue"), vi.fn())).toEqual([]);
    expect(defaultRouteActions(routeInfo("/projects"), vi.fn())).toEqual([]);
  });

  it("puts a screen's own actions before the defaults and opens Add data from the default", () => {
    const provided: RouteAction[] = [{ id: "new-type", label: "New type", run: vi.fn() }];
    const { result } = renderHook(
      () => {
        useProvideRouteActions(provided);
        return useRouteActions();
      },
      { wrapper: at("/p/p1/overview") },
    );
    expect(result.current.map((a) => a.label)).toEqual(["New type", "Add data", "Generate report"]);
    result.current[1].run?.();
    expect(useAddData.getState()).toMatchObject({ open: true, tile: null });
  });
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `pnpm -C frontend exec vitest run src/app/commands.test.tsx src/app/routeActions.test.tsx`
Expected: FAIL, unresolved imports `./commands`, `./addDataStore`, `./routeActions`.

- [ ] **Step 3: Write the implementation**

`frontend/src/app/commands.ts`:

```ts
import { useEffect, useId } from "react";
import { create } from "zustand";
import type { Command } from "@/ui";

export type CommandGroup = "Go to" | "Actions";

export interface CommandEntry {
  key: string;
  group: CommandGroup;
  commands: readonly Command[];
}

interface Registry {
  entries: CommandEntry[];
  put: (entry: CommandEntry) => void;
  remove: (key: string) => void;
}

/** Commands screens add to the palette (spec 2026-09-26-foundation section 5.4). */
export const useCommandRegistry = create<Registry>((set) => ({
  entries: [],
  put: (entry) => set((s) => ({ entries: [...s.entries.filter((e) => e.key !== entry.key), entry] })),
  remove: (key) => set((s) => ({ entries: s.entries.filter((e) => e.key !== key) })),
}));

/** The commands of `group` in registration order; a later command with the same id replaces an earlier one. */
export function collectCommands(entries: readonly CommandEntry[], group: CommandGroup): Command[] {
  const byId = new Map<string, Command>();
  for (const entry of entries) {
    if (entry.group !== group) continue;
    for (const command of entry.commands) {
      byId.delete(command.id);
      byId.set(command.id, command);
    }
  }
  return [...byId.values()];
}

/**
 * Adds a screen's commands to the palette while the screen is mounted. Pass a memoised array: a
 * new array re-registers, which is cheap but re-renders the palette.
 */
export function useCommands(commands: readonly Command[], group: CommandGroup = "Actions"): void {
  const key = useId();
  useEffect(() => {
    useCommandRegistry.getState().put({ key, group, commands });
  }, [key, group, commands]);
  useEffect(() => () => useCommandRegistry.getState().remove(key), [key]);
}
```

`frontend/src/app/addDataStore.ts`:

```ts
import { create } from "zustand";

/** The importers behind Add data (spec section 6.4); Drawing arrives with the Maps workspace. */
export type AddDataTile = "photos" | "orthomosaic" | "elevation" | "point_cloud";

interface AddDataState {
  open: boolean;
  /** The importer to open directly; null shows the chooser. */
  tile: AddDataTile | null;
  show: (tile: AddDataTile | null) => void;
  close: () => void;
}

export const useAddData = create<AddDataState>((set) => ({
  open: false,
  tile: null,
  show: (tile) => set({ open: true, tile }),
  close: () => set({ open: false, tile: null }),
}));
```

`frontend/src/app/routeActions.ts`:

```ts
import { useEffect, useId, useMemo } from "react";
import { useLocation } from "react-router-dom";
import { create } from "zustand";
import type { IconName } from "@/ui";
import { useAddData } from "./addDataStore";
import { routeInfo, type RouteInfo } from "./routeModel";

/** A button in the top bar's context area (spec section 5.1); the palette lists the enabled ones too. */
export interface RouteAction {
  id: string;
  label: string;
  icon?: IconName;
  variant?: "primary" | "secondary";
  /** Renders a link instead of a button. */
  to?: string;
  run?: () => void;
  disabled?: boolean;
  /** Why it is disabled, or what it does. */
  tooltip?: string;
}

export function defaultRouteActions(info: RouteInfo, openAddData: () => void): RouteAction[] {
  if (!info.projectId) return [];
  const actions: RouteAction[] = [];
  if (info.tab === "findings") {
    actions.push({
      id: "new-finding",
      label: "New finding",
      icon: "plus",
      disabled: true,
      tooltip: "Findings are created in the Images, Maps and Point clouds workspaces",
    });
  }
  actions.push({ id: "add-data", label: "Add data", icon: "plus", variant: "secondary", run: openAddData });
  actions.push({
    id: "generate-report",
    label: "Generate report",
    icon: "report",
    variant: "primary",
    to: `/p/${info.projectId}/reports`,
  });
  return actions;
}

interface Provided {
  entries: { key: string; actions: readonly RouteAction[] }[];
  put: (key: string, actions: readonly RouteAction[]) => void;
  remove: (key: string) => void;
}

export const useProvidedRouteActions = create<Provided>((set) => ({
  entries: [],
  put: (key, actions) => set((s) => ({ entries: [...s.entries.filter((e) => e.key !== key), { key, actions }] })),
  remove: (key) => set((s) => ({ entries: s.entries.filter((e) => e.key !== key) })),
}));

/** A screen's own context actions (Catalogue "New type", Models "New dataset"…) while it is mounted. Pass a memoised array. */
export function useProvideRouteActions(actions: readonly RouteAction[]): void {
  const key = useId();
  useEffect(() => {
    useProvidedRouteActions.getState().put(key, actions);
  }, [key, actions]);
  useEffect(() => () => useProvidedRouteActions.getState().remove(key), [key]);
}

/** The current route's actions: the screen's own first, then the route's defaults. */
export function useRouteActions(): RouteAction[] {
  const { pathname } = useLocation();
  const entries = useProvidedRouteActions((s) => s.entries);
  return useMemo(
    () => [
      ...entries.flatMap((e) => e.actions),
      ...defaultRouteActions(routeInfo(pathname), () => useAddData.getState().show(null)),
    ],
    [entries, pathname],
  );
}
```

- [ ] **Step 4: Run them to verify they pass**

Run: `pnpm -C frontend exec vitest run src/app/commands.test.tsx src/app/routeActions.test.tsx`
Expected: PASS (8 tests).

- [ ] **Step 5: Commit**

```powershell
git add frontend/src/app/commands.ts frontend/src/app/commands.test.tsx frontend/src/app/routeActions.ts frontend/src/app/routeActions.test.tsx frontend/src/app/addDataStore.ts
git commit -m "feat(shell): command registry, route actions and the Add data store" -m "Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: Rail and the logo tile

Load the design skills and `DESIGN.md` before this task (AGENTS.md item 3). Visual target: mockup `.rail` in `visual-directions.html` (64px column, 42px entries with 10px radius, tooltip to the right, active entry `--accent-soft` with the 3px bar 11px left of it, logo 36px on `--grad-brand` with 12px radius, 14px under it).

**Files:**
- Create: `frontend/src/app/Rail.tsx`
- Modify: `frontend/src/app/Brand.tsx` (the tile classes)
- Test: `frontend/src/app/Rail.test.tsx`

**Interfaces:**
- Consumes: `RAIL_ENTRIES`, `RAIL_SETTINGS`, `routeInfo`, `RailEntry` (Task 1); DS `Icon`, `Tooltip`, `cx`, `focusRing`.
- Produces: `export function Rail({ projectId }: { projectId: string | undefined }): JSX.Element` — a `nav` named "Main navigation".

- [ ] **Step 1: Write the failing test**

`frontend/src/app/Rail.test.tsx`:

```tsx
import { describe, expect, it } from "vitest";
import { act, render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { Rail } from "./Rail";

function renderRail(path: string, projectId?: string) {
  render(
    <MemoryRouter initialEntries={[path]}>
      <Rail projectId={projectId} />
    </MemoryRouter>,
  );
  return screen.getByRole("navigation", { name: "Main navigation" });
}

describe("Rail", () => {
  it("lists Projects, Models, Catalogue, Jobs and Settings, with the logo first", () => {
    const nav = renderRail("/projects");
    const links = within(nav).getAllByRole("link");
    expect(links.map((l) => l.getAttribute("aria-label"))).toEqual([
      "Kestrel AI",
      "Projects",
      "Models",
      "Catalogue",
      "Jobs",
      "Settings",
    ]);
    expect(within(nav).getByRole("link", { name: "Models" })).toHaveAttribute("href", "/models");
    expect(within(nav).getByRole("link", { name: "Catalogue" })).toHaveAttribute("href", "/catalogue");
    expect(within(nav).getByRole("link", { name: "Settings" })).toHaveAttribute("href", "/settings");
  });

  it("marks Projects inside a project and sends Jobs to that project's jobs", () => {
    const nav = renderRail("/p/p1/images", "p1");
    expect(within(nav).getByRole("link", { name: "Projects" })).toHaveAttribute("aria-current", "page");
    expect(within(nav).getByRole("link", { name: "Models" })).not.toHaveAttribute("aria-current");
    expect(within(nav).getByRole("link", { name: "Jobs" })).toHaveAttribute("href", "/jobs?project=p1");
  });

  it("marks the section of an app page and links Jobs plainly outside a project", () => {
    const nav = renderRail("/models/datasets");
    expect(within(nav).getByRole("link", { name: "Models" })).toHaveAttribute("aria-current", "page");
    expect(within(nav).getByRole("link", { name: "Jobs" })).toHaveAttribute("href", "/jobs");
  });

  it("marks Settings on About", () => {
    const nav = renderRail("/about");
    expect(within(nav).getByRole("link", { name: "Settings" })).toHaveAttribute("aria-current", "page");
  });

  it("names an entry in a tooltip on focus", () => {
    const nav = renderRail("/projects");
    act(() => within(nav).getByRole("link", { name: "Catalogue" }).focus());
    expect(screen.getByRole("tooltip")).toHaveTextContent("Catalogue");
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm -C frontend exec vitest run src/app/Rail.test.tsx`
Expected: FAIL, `Failed to resolve import "./Rail"`.

- [ ] **Step 3: Write the implementation**

`frontend/src/app/Rail.tsx`:

```tsx
import { Link, useLocation } from "react-router-dom";
import { Icon, Tooltip, cx, focusRing } from "@/ui";
import { Brand } from "./Brand";
import { RAIL_ENTRIES, RAIL_SETTINGS, routeInfo, type RailEntry } from "./routeModel";

function RailLink({ entry, to, active }: { entry: RailEntry; to: string; active: boolean }) {
  return (
    <Tooltip label={entry.label} side="right">
      <Link
        to={to}
        aria-label={entry.label}
        aria-current={active ? "page" : undefined}
        className={cx(
          "relative grid h-[42px] w-[42px] place-items-center rounded-control",
          focusRing,
          active
            ? "bg-accent-soft text-accent-ink before:absolute before:-left-[11px] before:bottom-2.5 before:top-2.5 before:w-[3px] before:rounded-chip before:bg-grad-ink"
            : "text-muted hover:bg-hover hover:text-ink",
        )}
      >
        <Icon name={entry.icon} size={20} />
      </Link>
    </Tooltip>
  );
}

/**
 * The 64px icon rail (spec 2026-09-26-foundation section 5.1): the logo tile, Projects, Models,
 * Catalogue and Jobs, then Settings at the foot. Selection is instant (`--dur-instant`).
 */
export function Rail({ projectId }: { projectId: string | undefined }) {
  const { pathname } = useLocation();
  const section = routeInfo(pathname).section;
  return (
    <nav
      aria-label="Main navigation"
      className="flex w-16 shrink-0 flex-col items-center gap-1.5 border-r border-line bg-rail py-3.5"
    >
      <Link to="/projects" aria-label="Kestrel AI" className={cx("mb-3.5 rounded-xl", focusRing)}>
        <Brand compact />
      </Link>
      {RAIL_ENTRIES.map((entry) => (
        <RailLink
          key={entry.id}
          entry={entry}
          active={section === entry.id}
          to={entry.id === "jobs" && projectId ? `/jobs?project=${projectId}` : entry.to}
        />
      ))}
      <div className="flex-1" />
      <RailLink entry={RAIL_SETTINGS} to={RAIL_SETTINGS.to} active={section === "settings"} />
    </nav>
  );
}
```

In `frontend/src/app/Brand.tsx` replace the tile's class list

```tsx
          "grid shrink-0 place-items-center rounded-md bg-accent text-accent-fg",
```

with

```tsx
          "grid shrink-0 place-items-center rounded-xl bg-grad-brand text-accent-fg",
```

(`rounded-xl` is Tailwind's 12px; if DS replaced Tailwind's radius scale instead of extending it, use `rounded-control`.)

- [ ] **Step 4: Run it to verify it passes**

Run: `pnpm -C frontend exec vitest run src/app/Rail.test.tsx`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```powershell
git add frontend/src/app/Rail.tsx frontend/src/app/Rail.test.tsx frontend/src/app/Brand.tsx
git commit -m "feat(shell): the five-entry icon rail on the gradient logo tile" -m "Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 4: TopBar and the running pill

Visual target: mockup `.top` (56px, 20px side padding, 14px gap, crumb 13px muted with the name in ink 600, the status dot, the 300×34 search field on `--field` with `Kbd` "Ctrl K", then the buttons; `.btn.pri` gradient for Generate report).

**Files:**
- Create: `frontend/src/app/jobVerbs.ts`, `frontend/src/app/RunningPill.tsx`, `frontend/src/app/TopBar.tsx`
- Test: `frontend/src/app/TopBar.test.tsx`

**Interfaces:**
- Consumes: `useRouteActions`, `RouteAction` (Task 2); `routeInfo`, `SECTION_LABEL` (Task 1); `useAgentPanel` (`@/agent/panelStore`); `useJobsStore`, `isActiveJob` (`@/store/jobs`); DS `Button`, `IconButton`, `Icon`, `Kbd`, `StatusDot`, `Tooltip`, `Pill`, `buttonClass`, `cx`, `focusRing`.
- Produces:
  ```ts
  export const JOB_VERB: Record<Job["type"], string>;   // app/jobVerbs.ts
  export function RunningPill({ projectId }: { projectId: string | undefined }): JSX.Element | null;
  export function TopBar(props: { projectId: string | undefined; projectName: string | null; onOpenPalette: () => void }): JSX.Element;
  ```

- [ ] **Step 1: Write the failing test**

`frontend/src/app/TopBar.test.tsx`:

```tsx
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { useAgentPanel } from "@/agent/panelStore";
import { useJobsStore } from "@/store/jobs";
import { PROJECT_ID, runningJob } from "@/test/fixtures";
import { useAddData } from "./addDataStore";
import { useProvidedRouteActions } from "./routeActions";
import { TopBar } from "./TopBar";

function renderBar(path: string, projectId?: string, projectName: string | null = "Ahmadia") {
  const onOpenPalette = vi.fn();
  render(
    <MemoryRouter initialEntries={[path]}>
      <TopBar projectId={projectId} projectName={projectName} onOpenPalette={onOpenPalette} />
    </MemoryRouter>,
  );
  return { onOpenPalette, banner: screen.getByRole("banner") };
}

describe("TopBar", () => {
  beforeEach(() => {
    useJobsStore.setState({ jobs: {}, panelOpen: false });
    useAgentPanel.setState({ open: false });
    useAddData.setState({ open: false, tile: null });
    useProvidedRouteActions.setState({ entries: [] });
  });

  it("shows Projects / the project / the tab, with an idle dot", () => {
    const { banner } = renderBar(`/p/${PROJECT_ID}/images`, PROJECT_ID);
    const crumbs = within(banner).getByRole("navigation", { name: "Breadcrumb" });
    expect(within(crumbs).getByRole("link", { name: "Projects" })).toHaveAttribute("href", "/projects");
    expect(within(crumbs).getByRole("link", { name: "Ahmadia" })).toHaveAttribute(
      "href",
      `/p/${PROJECT_ID}/overview`,
    );
    expect(within(crumbs).getByText("Images")).toHaveAttribute("aria-current", "page");
    expect(within(crumbs).getByLabelText("Idle")).toBeInTheDocument();
  });

  it("calls a project whose name has not loaded 'Project'", () => {
    const { banner } = renderBar(`/p/${PROJECT_ID}/overview`, PROJECT_ID, null);
    expect(within(banner).getByRole("link", { name: "Project" })).toBeInTheDocument();
  });

  it("goes live and links the running job to the project's jobs", () => {
    useJobsStore.getState().upsert({ ...runningJob, project_id: PROJECT_ID });
    const { banner } = renderBar(`/p/${PROJECT_ID}/images`, PROJECT_ID);
    expect(within(banner).getByLabelText("Jobs running")).toBeInTheDocument();
    const pill = within(banner).getByRole("link", { name: /^Importing/ });
    expect(pill).toHaveAttribute("href", `/jobs?project=${PROJECT_ID}`);
  });

  it("opens the palette from the search field", () => {
    const { banner, onOpenPalette } = renderBar("/projects");
    const field = within(banner).getByRole("button", { name: "Search and commands" });
    expect(field).toHaveAttribute("aria-keyshortcuts", "Control+K");
    expect(field).toHaveTextContent("Ctrl K");
    fireEvent.click(field);
    expect(onOpenPalette).toHaveBeenCalled();
  });

  it("offers Add data and Generate report on project routes", () => {
    const { banner } = renderBar(`/p/${PROJECT_ID}/maps`, PROJECT_ID);
    fireEvent.click(within(banner).getByRole("button", { name: "Add data" }));
    expect(useAddData.getState().open).toBe(true);
    expect(within(banner).getByRole("link", { name: "Generate report" })).toHaveAttribute(
      "href",
      `/p/${PROJECT_ID}/reports`,
    );
  });

  it("shows New finding disabled on the Findings tab", () => {
    const { banner } = renderBar(`/p/${PROJECT_ID}/findings`, PROJECT_ID);
    expect(within(banner).getByRole("button", { name: "New finding" })).toBeDisabled();
  });

  it("names app sections and their pages, with no project actions", () => {
    const { banner } = renderBar("/models/datasets");
    const crumbs = within(banner).getByRole("navigation", { name: "Breadcrumb" });
    expect(crumbs).toHaveTextContent("Models");
    expect(crumbs).toHaveTextContent("Datasets");
    expect(within(banner).queryByRole("button", { name: "Add data" })).toBeNull();
  });

  it("opens the setup agent outside a project and the project agent inside one", () => {
    const { banner } = renderBar("/projects");
    const agent = within(banner).getByRole("button", { name: "Setup agent" });
    expect(agent).toHaveAttribute("aria-expanded", "false");
    fireEvent.click(agent);
    expect(useAgentPanel.getState().open).toBe(true);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm -C frontend exec vitest run src/app/TopBar.test.tsx`
Expected: FAIL, `Failed to resolve import "./TopBar"`.

- [ ] **Step 3: Write the implementation**

`frontend/src/app/jobVerbs.ts` — move the `TYPE_VERB` record out of `frontend/src/app/Header.tsx` verbatim, renamed and exported, and make sure it has the four job types C0 added (keep C0's wording if C0 already added them to `Header.tsx`):

```ts
import type { Job } from "@contract/client";

/** Present-tense verbs for the running pill; TypeScript checks the record covers every job type. */
export const JOB_VERB: Record<Job["type"], string> = {
  import: "Importing",
  dataset: "Building a dataset",
  train: "Training",
  infer: "Detecting",
  export: "Exporting",
  results_export: "Exporting results",
  map_import: "Importing a map",
  map_detect: "Detecting on a map",
  map_export: "Exporting map results",
  library_import: "Importing a model",
  library_export: "Exporting a model",
  library_starter: "Adding a starter model",
  library_adopt: "Moving models into the library",
  map_move: "Moving a map",
  accept_above: "Accepting detections",
  recount: "Recounting a run",
  area_recount: "Recounting site areas",
  detect_export: "Exporting counts",
  pointcloud_import: "Importing a point cloud",
  pointcloud_export: "Exporting a point cloud",
  surface_build: "Building a surface",
  volume_calc: "Calculating a volume",
  volume_export: "Exporting volumes",
  design_import: "Importing a design surface",
  project_migrate: "Upgrading the project",
  findings_backfill: "Creating findings",
  findings_recount: "Recounting findings",
  dataset_build: "Collecting a dataset",
};
```

`frontend/src/app/RunningPill.tsx`:

```tsx
import { Link } from "react-router-dom";
import { isActiveJob, useJobsStore } from "@/store/jobs";
import { Pill, cx, focusRing } from "@/ui";
import { JOB_VERB } from "./jobVerbs";

/** The project's newest active job as a live pill that opens its jobs; nothing when idle. */
export function RunningPill({ projectId }: { projectId: string | undefined }) {
  const jobs = useJobsStore((s) => s.jobs);
  if (!projectId) return null;
  const active = Object.values(jobs)
    .filter((j) => j.project_id === projectId && isActiveJob(j))
    .sort((a, b) => b.created_at.localeCompare(a.created_at));
  if (active.length === 0) return null;
  const job = active[0];
  const text = job.message ? `${JOB_VERB[job.type]}: ${job.message}` : JOB_VERB[job.type];
  const more = active.length > 1 ? ` (+${active.length - 1})` : "";
  return (
    <Link
      to={`/jobs?project=${projectId}`}
      title={text}
      className={cx("hidden min-w-0 max-w-xs rounded-chip sm:inline-flex", focusRing)}
    >
      <Pill tone="accent" live>
        <span className="truncate">
          {text}
          {more}
        </span>
      </Pill>
    </Link>
  );
}
```

`frontend/src/app/TopBar.tsx`:

```tsx
import { Link, useLocation } from "react-router-dom";
import { useAgentPanel } from "@/agent/panelStore";
import { isActiveJob, useJobsStore } from "@/store/jobs";
import { Button, Icon, IconButton, Kbd, StatusDot, Tooltip, buttonClass, cx, focusRing } from "@/ui";
import { useRouteActions, type RouteAction } from "./routeActions";
import { SECTION_LABEL, routeInfo } from "./routeModel";
import { RunningPill } from "./RunningPill";

function ActionControl({ action }: { action: RouteAction }) {
  const variant = action.variant ?? "secondary";
  if (action.to && !action.disabled) {
    return (
      <Link to={action.to} className={buttonClass(variant, "sm")}>
        {action.icon && <Icon name={action.icon} size={14} />}
        {action.label}
      </Link>
    );
  }
  const button = (
    <Button size="sm" variant={variant} icon={action.icon} disabled={action.disabled} onClick={action.run}>
      {action.label}
    </Button>
  );
  if (!action.tooltip) return button;
  // A disabled button gets no pointer or focus events, so the wrapper carries the tooltip.
  return (
    <Tooltip label={action.tooltip}>
      <span tabIndex={action.disabled ? 0 : undefined} className={cx("inline-flex rounded-control", focusRing)}>
        {button}
      </span>
    </Tooltip>
  );
}

function Crumbs({ projectId, projectName, busy }: { projectId?: string; projectName: string | null; busy: boolean }) {
  const { pathname } = useLocation();
  const info = routeInfo(pathname);
  const sep = <li aria-hidden="true" className="text-dim">/</li>;
  if (projectId) {
    return (
      <nav aria-label="Breadcrumb" className="min-w-0">
        <ol className="flex min-w-0 items-center gap-2 text-sm text-muted">
          <li>
            <Link to="/projects" className="hover:text-ink">
              Projects
            </Link>
          </li>
          {sep}
          <li className="flex min-w-0 items-center gap-2">
            <StatusDot status={busy ? "running" : "idle"} live={busy} label={busy ? "Jobs running" : "Idle"} />
            <Link to={`/p/${projectId}/overview`} className="truncate font-semibold text-ink">
              {projectName ?? "Project"}
            </Link>
          </li>
          {info.page && (
            <>
              {sep}
              <li aria-current="page" className="truncate text-ink">
                {info.page}
              </li>
            </>
          )}
        </ol>
      </nav>
    );
  }
  const section = info.section ? SECTION_LABEL[info.section] : null;
  const sub = info.page && info.page !== section ? info.page : null;
  return (
    <nav aria-label="Breadcrumb" className="min-w-0">
      <ol className="flex min-w-0 items-center gap-2 text-sm text-muted">
        {section && (
          <li aria-current={sub ? undefined : "page"} className={sub ? undefined : "font-semibold text-ink"}>
            {section}
          </li>
        )}
        {sub && (
          <>
            {sep}
            <li aria-current="page" className="text-ink">
              {sub}
            </li>
          </>
        )}
      </ol>
    </nav>
  );
}

/**
 * The top bar (spec 2026-09-26-foundation section 5.1): breadcrumb, the palette field (Ctrl K), the
 * route's context actions, the running pill and the agent button.
 */
export function TopBar({
  projectId,
  projectName,
  onOpenPalette,
}: {
  projectId: string | undefined;
  projectName: string | null;
  onOpenPalette: () => void;
}) {
  const actions = useRouteActions();
  const agentOpen = useAgentPanel((s) => s.open);
  const busy = useJobsStore(
    (s) => !!projectId && Object.values(s.jobs).some((j) => j.project_id === projectId && isActiveJob(j)),
  );
  return (
    <header className="flex h-14 shrink-0 items-center gap-3.5 border-b border-line px-5">
      <Crumbs projectId={projectId} projectName={projectName} busy={busy} />
      <RunningPill projectId={projectId} />
      <button
        type="button"
        onClick={onOpenPalette}
        aria-label="Search and commands"
        aria-keyshortcuts="Control+K"
        className={cx(
          "ml-auto flex h-[34px] w-[300px] min-w-0 shrink items-center gap-2 rounded-control border border-line bg-field px-2.5 text-sm text-dim hover:text-muted",
          focusRing,
        )}
      >
        <Icon name="search" size={14} />
        <span className="truncate">Search findings, data, measurements…</span>
        <span className="ml-auto">
          <Kbd>Ctrl K</Kbd>
        </span>
      </button>
      {actions.map((action) => (
        <ActionControl key={action.id} action={action} />
      ))}
      <IconButton
        icon="sparkle"
        label={projectId ? "Project agent" : "Setup agent"}
        aria-controls={projectId ? "project-agent" : "setup-agent"}
        aria-expanded={agentOpen}
        onClick={() => {
          useJobsStore.getState().setPanelOpen(false);
          useAgentPanel.getState().setOpen(true);
        }}
      />
    </header>
  );
}
```

- [ ] **Step 4: Run it to verify it passes**

Run: `pnpm -C frontend exec vitest run src/app/TopBar.test.tsx`
Expected: PASS (8 tests).

- [ ] **Step 5: Commit**

```powershell
git add frontend/src/app/jobVerbs.ts frontend/src/app/RunningPill.tsx frontend/src/app/TopBar.tsx frontend/src/app/TopBar.test.tsx
git commit -m "feat(shell): top bar with breadcrumb, palette field, route actions and the running pill" -m "Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 5: Tab counts and ProjectTabs

Visual target: mockup `.tabs` (20px side padding, 13px labels, mono count chips on `--well`, the 2px `--grad-ink` indicator sliding over `--dur-emphasis`). The indicator and roving focus are DS's `Tabs`; SH supplies items and counts.

**Files:**
- Modify: `frontend/src/store/changes.ts` (+ `frontend/src/store/changes.test.ts`), `frontend/src/test/fixtures.ts` (add `exampleOverview`)
- Create: `frontend/src/app/useProjectCounts.ts`, `frontend/src/app/ProjectTabs.tsx`
- Test: `frontend/src/app/useProjectCounts.test.tsx`, `frontend/src/app/ProjectTabs.test.tsx`

**Interfaces:**
- Consumes: `PROJECT_TABS`, `SECONDARY_PAGES`, `routeInfo` (Task 1); C0 `ProjectOverview`; DS `Tabs`, `MenuButton`.
- Produces:
  ```ts
  // store/changes.ts gains
  dataRevision: number;       // bumped on "data.changed"
  findingsRevision: number;   // bumped on "findings.changed"
  // app/useProjectCounts.ts
  export interface ProjectCounts { images: number; maps: number; pointClouds: number; openFindings: number }
  export function countsFromOverview(o: components["schemas"]["ProjectOverview"]): ProjectCounts;
  export function useProjectCounts(projectId: string): ProjectCounts | null;
  // app/ProjectTabs.tsx
  export function ProjectTabs({ projectId }: { projectId: string }): JSX.Element;
  // test/fixtures.ts
  export const exampleOverview: ProjectOverview;
  ```

- [ ] **Step 1: Write the failing tests**

Append to `frontend/src/store/changes.test.ts` (inside its top-level `describe`, or as a new one at the end):

```ts
describe("data and findings revisions", () => {
  it("bumps on data.changed and findings.changed and nothing else", () => {
    useChangesStore.setState({ dataRevision: 0, findingsRevision: 0 });
    const apply = useChangesStore.getState().applyEvent;
    apply({ type: "data.changed", payload: {} } as AppEvent);
    apply({ type: "findings.changed", payload: { ids: ["f1"] } } as AppEvent);
    apply({ type: "images.changed", payload: {} } as AppEvent);
    expect(useChangesStore.getState()).toMatchObject({ dataRevision: 1, findingsRevision: 1 });
  });
});
```

(Import `AppEvent` from `@contract/client` at the top if the file does not yet.)

Add to `frontend/src/test/fixtures.ts`, next to `exampleProject` (and add `type components` to its `@contract/client` import):

```ts
/** GET /projects/{id}/overview (spec 2026-09-26-foundation section 9.1). */
export const exampleOverview: components["schemas"]["ProjectOverview"] = {
  findings: {
    by_status: { open: 47, reviewed: 12, closed: 30 },
    open_by_severity: { "1": 10, "2": 20, "3": 12, "4": 5 },
    open_no_severity: 0,
    by_type: [],
    trend: [],
  },
  data: { image_sets: 2, images: 1284, maps: 3, elevations: 1, point_clouds: 2, drawings: 0 },
  latest_volume: null,
  hero_map_id: null,
  banners: [],
};
```

`frontend/src/app/useProjectCounts.test.tsx`:

```tsx
import { beforeEach, describe, expect, it } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { useChangesStore } from "@/store/changes";
import { exampleOverview, fakeClient, PROJECT_ID } from "@/test/fixtures";
import { TestApiProvider } from "@/test/render";
import { countsFromOverview, useProjectCounts } from "./useProjectCounts";

function wrapperFor(api: ReturnType<typeof fakeClient>["api"]) {
  return ({ children }: { children: ReactNode }) => <TestApiProvider api={api}>{children}</TestApiProvider>;
}

describe("useProjectCounts", () => {
  beforeEach(() => useChangesStore.setState({ dataRevision: 0, findingsRevision: 0 }));

  it("reads images, maps, point clouds and open findings from the overview", () => {
    expect(countsFromOverview(exampleOverview)).toEqual({
      images: 1284,
      maps: 3,
      pointClouds: 2,
      openFindings: 47,
    });
  });

  it("loads once, and again when data or findings change", async () => {
    const { api, requests } = fakeClient([{ method: "GET", path: /\/overview$/, body: exampleOverview }]);
    const { result } = renderHook(() => useProjectCounts(PROJECT_ID), { wrapper: wrapperFor(api) });
    await waitFor(() => expect(result.current?.images).toBe(1284));
    expect(requests).toHaveLength(1);
    act(() => useChangesStore.setState({ findingsRevision: 1 }));
    await waitFor(() => expect(requests).toHaveLength(2));
    expect(result.current?.openFindings).toBe(47);
  });

  it("gives no counts when the overview fails, without throwing", async () => {
    const { api, requests } = fakeClient([
      { method: "GET", path: /\/overview$/, status: 503, body: { error: { code: "x", message: "down" } } },
    ]);
    const { result } = renderHook(() => useProjectCounts(PROJECT_ID), { wrapper: wrapperFor(api) });
    await waitFor(() => expect(requests).toHaveLength(1));
    expect(result.current).toBeNull();
  });
});
```

`frontend/src/app/ProjectTabs.test.tsx`:

```tsx
import { describe, expect, it } from "vitest";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { Route, Routes, useLocation } from "react-router-dom";
import { exampleOverview, fakeClient, PROJECT_ID } from "@/test/fixtures";
import { renderWithProviders } from "@/test/render";
import { ProjectTabs } from "./ProjectTabs";

function Where() {
  return <p data-testid="where">{useLocation().pathname}</p>;
}

function renderTabs(path: string, overviewStatus = 200) {
  const { api } = fakeClient([
    {
      method: "GET",
      path: /\/overview$/,
      status: overviewStatus,
      body: overviewStatus === 200 ? exampleOverview : { error: { code: "x", message: "down" } },
    },
  ]);
  renderWithProviders(
    <Routes>
      <Route
        path="*"
        element={
          <>
            <ProjectTabs projectId={PROJECT_ID} />
            <Where />
          </>
        }
      />
    </Routes>,
    { api, route: path },
  );
}

describe("ProjectTabs", () => {
  it("lists the seven tabs as links, marks the current one and shows the counts", async () => {
    renderTabs(`/p/${PROJECT_ID}/findings`);
    const list = screen.getByRole("tablist");
    const tabs = within(list).getAllByRole("tab");
    expect(tabs).toHaveLength(7);
    expect(within(list).getByRole("tab", { name: /^Images/ })).toHaveAttribute("href", `/p/${PROJECT_ID}/images`);
    expect(within(list).getByRole("tab", { name: /^Findings/ })).toHaveAttribute("aria-selected", "true");
    await waitFor(() => expect(within(list).getByRole("tab", { name: /^Images/ })).toHaveTextContent(/1,?284/));
    expect(within(list).getByRole("tab", { name: /^Maps/ })).toHaveTextContent("3");
    expect(within(list).getByRole("tab", { name: /^Point clouds/ })).toHaveTextContent("2");
    expect(within(list).getByRole("tab", { name: /^Findings/ })).toHaveTextContent("47");
  });

  it("selects the Images tab inside the image workspace", () => {
    renderTabs(`/p/${PROJECT_ID}/images/i1`);
    expect(screen.getByRole("tab", { name: /^Images/ })).toHaveAttribute("aria-selected", "true");
  });

  it("still works without counts when the overview fails", async () => {
    renderTabs(`/p/${PROJECT_ID}/overview`, 503);
    await new Promise((r) => setTimeout(r, 30));
    expect(screen.getAllByRole("tab")).toHaveLength(7);
    expect(screen.getByRole("tab", { name: /^Images/ })).not.toHaveTextContent(/\d/);
  });

  it("reaches the secondary pages from More", async () => {
    renderTabs(`/p/${PROJECT_ID}/overview`);
    fireEvent.click(screen.getByRole("button", { name: "More" }));
    const menu = await screen.findByRole("menu");
    expect(within(menu).getAllByRole("menuitem").map((i) => i.textContent)).toEqual([
      "Runs",
      "Review",
      "Detect",
      "Analytics",
      "Site areas",
      "Export",
      "Project settings",
    ]);
    fireEvent.click(within(menu).getByRole("menuitem", { name: "Analytics" }));
    expect(screen.getByTestId("where")).toHaveTextContent(`/p/${PROJECT_ID}/analytics`);
  });
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `pnpm -C frontend exec vitest run src/store/changes.test.ts src/app/useProjectCounts.test.tsx src/app/ProjectTabs.test.tsx`
Expected: FAIL: `dataRevision` undefined in the store test; unresolved `./useProjectCounts` and `./ProjectTabs`.

- [ ] **Step 3: Write the implementation**

In `frontend/src/store/changes.ts`, add to `ChangesState`:

```ts
  /** Bumped on `data.changed` (spec 2026-09-26-foundation section 13): the tab counts and the Data list. */
  dataRevision: number;
  /** Bumped on `findings.changed`. */
  findingsRevision: number;
```

to the initial state `dataRevision: 0, findingsRevision: 0,` and to `applyEvent`, before `return s;`:

```ts
      if (ev.type === "data.changed") return { dataRevision: s.dataRevision + 1 };
      if (ev.type === "findings.changed") return { findingsRevision: s.findingsRevision + 1 };
```

`frontend/src/app/useProjectCounts.ts`:

```ts
import { useEffect, useState } from "react";
import type { components } from "@contract/client";
import { useApi } from "@/api/client";
import { messageOf, unwrap } from "@/api/errors";
import { pushLog } from "@/app/diagnostics";
import { useChangesStore } from "@/store/changes";

type ProjectOverview = components["schemas"]["ProjectOverview"];

export interface ProjectCounts {
  images: number;
  maps: number;
  pointClouds: number;
  openFindings: number;
}

export function countsFromOverview(o: ProjectOverview): ProjectCounts {
  return {
    images: o.data.images,
    maps: o.data.maps,
    pointClouds: o.data.point_clouds,
    openFindings: o.findings.by_status.open,
  };
}

/**
 * The tab counts (spec section 5.2), from the pre-aggregated overview; reloaded when data or
 * findings change. Null while loading and when the overview is unavailable: the tabs then show
 * no counts, never an error.
 */
export function useProjectCounts(projectId: string): ProjectCounts | null {
  const api = useApi();
  const revision = useChangesStore((s) => `${s.dataRevision}|${s.findingsRevision}`);
  const [loaded, setLoaded] = useState<{ projectId: string; counts: ProjectCounts | null } | null>(null);
  useEffect(() => {
    let cancelled = false;
    unwrap(api.GET("/api/v1/projects/{projectId}/overview", { params: { path: { projectId } } }))
      .then((o) => {
        if (!cancelled) setLoaded({ projectId, counts: countsFromOverview(o) });
      })
      .catch((e: unknown) => {
        pushLog(`project counts unavailable: ${messageOf(e, String(e))}`);
        if (!cancelled) setLoaded({ projectId, counts: null });
      });
    return () => {
      cancelled = true;
    };
  }, [api, projectId, revision]);
  // A reload keeps the previous counts on screen until the new ones arrive.
  return loaded?.projectId === projectId ? loaded.counts : null;
}
```

`frontend/src/app/ProjectTabs.tsx`:

```tsx
import { useLocation, useNavigate } from "react-router-dom";
import { MenuButton, Tabs } from "@/ui";
import { PROJECT_TABS, SECONDARY_PAGES, routeInfo, type ProjectTabId } from "./routeModel";
import { useProjectCounts, type ProjectCounts } from "./useProjectCounts";

function countFor(id: ProjectTabId, counts: ProjectCounts | null): number | null {
  if (!counts) return null;
  if (id === "images") return counts.images;
  if (id === "maps") return counts.maps;
  if (id === "clouds") return counts.pointClouds;
  if (id === "findings") return counts.openFindings;
  return null;
}

/** The seven project tabs (spec 2026-09-26-foundation section 5.2) and the More menu of secondary pages. */
export function ProjectTabs({ projectId }: { projectId: string }) {
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const counts = useProjectCounts(projectId);
  const items = PROJECT_TABS.map((t) => ({
    id: t.id,
    label: t.label,
    to: `/p/${projectId}/${t.id}`,
    count: countFor(t.id, counts),
  }));
  return (
    <div className="flex shrink-0 items-center gap-2 border-b border-line px-5">
      <Tabs label="Project" items={items} value={routeInfo(pathname).tab ?? undefined} asLinks className="min-w-0 flex-1" />
      <MenuButton
        label="More"
        items={SECONDARY_PAGES.map((p) => ({
          id: p.id,
          label: p.label,
          icon: p.icon,
          onSelect: () => void navigate(`/p/${projectId}/${p.id}`),
        }))}
      />
    </div>
  );
}
```

- [ ] **Step 4: Run them to verify they pass**

Run: `pnpm -C frontend exec vitest run src/store/changes.test.ts src/app/useProjectCounts.test.tsx src/app/ProjectTabs.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```powershell
git add frontend/src/store/changes.ts frontend/src/store/changes.test.ts frontend/src/test/fixtures.ts frontend/src/app/useProjectCounts.ts frontend/src/app/useProjectCounts.test.tsx frontend/src/app/ProjectTabs.tsx frontend/src/app/ProjectTabs.test.tsx
git commit -m "feat(shell): the seven project tabs with counts from the overview, and the More menu" -m "Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 6: PageTransition

**Files:**
- Create: `frontend/src/app/transition.ts`, `frontend/src/app/PageTransition.tsx`
- Test: `frontend/src/app/PageTransition.test.tsx`

**Interfaces:**
- Consumes: `routeInfo`, `Layout` (Task 1); DS CSS variables `--dur-base`, `--ease-out`, `--ease-in-out`.
- Produces:
  ```ts
  export interface TransitionTiming { duration: number; easing: string; keyframes: Keyframe[] }
  export function transitionTiming(style: { getPropertyValue(name: string): string }, layout: Layout): TransitionTiming;
  export function PageTransition({ children }: { children: ReactNode }): JSX.Element;  // a flex column with data-transition-key
  ```

- [ ] **Step 1: Write the failing test**

`frontend/src/app/PageTransition.test.tsx`:

```tsx
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { Link, MemoryRouter } from "react-router-dom";
import { PageTransition } from "./PageTransition";
import { transitionTiming } from "./transition";

const style = (vars: Record<string, string>) => ({ getPropertyValue: (n: string) => vars[n] ?? "" });

describe("transitionTiming", () => {
  it("rises 6px and fades in over --dur-base with --ease-out", () => {
    const t = transitionTiming(style({ "--dur-base": "180ms", "--ease-out": "cubic-bezier(.2,.8,.2,1)" }), "page");
    expect(t.duration).toBe(180);
    expect(t.easing).toBe("cubic-bezier(.2,.8,.2,1)");
    expect(t.keyframes).toEqual([
      { opacity: 0, transform: "translateY(6px)" },
      { opacity: 1, transform: "translateY(0)" },
    ]);
  });

  it("only cross-fades onto a full-bleed surface, with --ease-in-out", () => {
    const t = transitionTiming(style({ "--dur-base": "0.18s", "--ease-in-out": "cubic-bezier(.65,0,.35,1)" }), "fullbleed");
    expect(t.duration).toBe(180);
    expect(t.easing).toBe("cubic-bezier(.65,0,.35,1)");
    expect(t.keyframes).toEqual([{ opacity: 0 }, { opacity: 1 }]);
  });

  it("is instant under reduced motion, where the token is 0ms", () => {
    expect(transitionTiming(style({ "--dur-base": "0ms" }), "page").duration).toBe(0);
  });

  it("falls back to the spec's values when the tokens are missing", () => {
    const t = transitionTiming(style({}), "page");
    expect(t.duration).toBe(180);
    expect(t.easing).toBe("cubic-bezier(.2,.8,.2,1)");
  });
});

describe("PageTransition", () => {
  const animate = vi.fn();
  beforeEach(() => {
    animate.mockReset();
    Object.defineProperty(HTMLElement.prototype, "animate", { value: animate, configurable: true });
  });
  afterEach(() => {
    delete (HTMLElement.prototype as { animate?: unknown }).animate;
  });

  function renderAt(path: string) {
    render(
      <MemoryRouter initialEntries={[path]}>
        <Link to="/p/a/images">images</Link>
        <Link to="/p/a/findings">findings</Link>
        <Link to="/p/a/findings/f1">one finding</Link>
        <Link to="/p/a/maps/m1">map</Link>
        <PageTransition>
          <p>page</p>
        </PageTransition>
      </MemoryRouter>,
    );
  }

  it("does not animate the first page", () => {
    renderAt("/p/a/overview");
    expect(animate).not.toHaveBeenCalled();
  });

  it("animates a tab change once, and not a change inside the tab", () => {
    renderAt("/p/a/overview");
    fireEvent.click(screen.getByText("findings"));
    expect(animate).toHaveBeenCalledTimes(1);
    expect(animate.mock.calls[0][0]).toEqual([
      { opacity: 0, transform: "translateY(6px)" },
      { opacity: 1, transform: "translateY(0)" },
    ]);
    fireEvent.click(screen.getByText("one finding"));
    expect(animate).toHaveBeenCalledTimes(1);
  });

  it("cross-fades onto the full-bleed map", () => {
    renderAt("/p/a/images");
    fireEvent.click(screen.getByText("map"));
    expect(animate.mock.calls[0][0]).toEqual([{ opacity: 0 }, { opacity: 1 }]);
  });

  it("keys the wrapper on the tab for the e2e animation check", () => {
    renderAt("/p/a/findings/f1");
    expect(screen.getByText("page").parentElement).toHaveAttribute("data-transition-key", "p/a/findings");
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm -C frontend exec vitest run src/app/PageTransition.test.tsx`
Expected: FAIL, unresolved `./PageTransition` and `./transition`.

- [ ] **Step 3: Write the implementation**

`frontend/src/app/transition.ts`:

```ts
import type { Layout } from "./routeModel";

export interface TransitionTiming {
  duration: number;
  easing: string;
  keyframes: Keyframe[];
}

/** "180ms" or "0.18s" to milliseconds; a missing or unreadable token gives `fallback`. */
function ms(raw: string, fallback: number): number {
  const v = raw.trim();
  if (v.endsWith("ms")) return Number.parseFloat(v);
  if (v.endsWith("s")) return Number.parseFloat(v) * 1000;
  return fallback;
}

/**
 * The page entrance (spec 2026-09-26-foundation section 5.5), read from the DS motion tokens so
 * reduced motion (which sets `--dur-base: 0ms`) and the Settings override apply without code here.
 */
export function transitionTiming(style: { getPropertyValue(name: string): string }, layout: Layout): TransitionTiming {
  const fullbleed = layout === "fullbleed";
  const easing = style.getPropertyValue(fullbleed ? "--ease-in-out" : "--ease-out").trim();
  return {
    duration: ms(style.getPropertyValue("--dur-base"), 180),
    easing: easing || (fullbleed ? "cubic-bezier(.65,0,.35,1)" : "cubic-bezier(.2,.8,.2,1)"),
    keyframes: fullbleed
      ? [{ opacity: 0 }, { opacity: 1 }]
      : [
          { opacity: 0, transform: "translateY(6px)" },
          { opacity: 1, transform: "translateY(0)" },
        ],
  };
}
```

`frontend/src/app/PageTransition.tsx`:

```tsx
import { useLayoutEffect, useRef, type ReactNode } from "react";
import { useLocation } from "react-router-dom";
import { routeInfo } from "./routeModel";
import { transitionTiming } from "./transition";

/**
 * Plays the entrance when the tab (or app sub-section) changes; a change inside a tab does not.
 * No exit animation and no remount: the new page is interactive at once.
 */
export function PageTransition({ children }: { children: ReactNode }) {
  const { pathname } = useLocation();
  const { transitionKey, layout } = routeInfo(pathname);
  const ref = useRef<HTMLDivElement>(null);
  const lastKey = useRef(transitionKey);
  useLayoutEffect(() => {
    if (lastKey.current === transitionKey) return;
    lastKey.current = transitionKey;
    const el = ref.current;
    if (!el || typeof el.animate !== "function") return;
    const t = transitionTiming(getComputedStyle(document.documentElement), layout);
    if (t.duration <= 0) return;
    el.animate(t.keyframes, { duration: t.duration, easing: t.easing });
  }, [transitionKey, layout]);
  return (
    <div ref={ref} data-transition-key={transitionKey} className="flex min-h-0 flex-1 flex-col">
      {children}
    </div>
  );
}
```

- [ ] **Step 4: Run it to verify it passes**

Run: `pnpm -C frontend exec vitest run src/app/PageTransition.test.tsx`
Expected: PASS (8 tests).

- [ ] **Step 5: Commit**

```powershell
git add frontend/src/app/transition.ts frontend/src/app/PageTransition.tsx frontend/src/app/PageTransition.test.tsx
git commit -m "feat(shell): page entrance keyed on the tab, from the motion tokens" -m "Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 7: The palette and Ctrl K

**Files:**
- Create: `frontend/src/app/usePaletteShortcut.ts`, `frontend/src/app/paletteCommands.ts`, `frontend/src/app/Palette.tsx`
- Test: `frontend/src/app/usePaletteShortcut.test.tsx`, `frontend/src/app/paletteCommands.test.ts`, `frontend/src/app/Palette.test.tsx`

**Interfaces:**
- Consumes: `collectCommands`, `useCommandRegistry` (Task 2); `useRouteActions`, `RouteAction`, `useAddData`, `AddDataTile` (Task 2); `routeInfo`, tables (Task 1); DS `CommandPalette`, `Command`, `CommandSource`; DS `setEffectsChoice` from `@/app/effects`.
- Produces:
  ```ts
  export function isPaletteChord(e: Pick<KeyboardEvent, "key" | "ctrlKey" | "metaKey" | "altKey" | "shiftKey">): boolean;
  export function usePaletteShortcut(): [open: boolean, setOpen: (open: boolean) => void];
  export function goToCommands(info: RouteInfo, recent: readonly { id: string; name: string }[], go: (to: string) => void): Command[];
  export function actionCommands(o: { info: RouteInfo; actions: readonly RouteAction[]; go: (to: string) => void; addData: (tile: AddDataTile | null) => void; toggleEffects: () => void }): Command[];
  export function formatFindingNumber(n: number): string;       // "F-0217"
  export function dataHref(projectId: string, item: { id: string; type: string }): string;
  export function projectSearchSources(api: ApiClient, projectId: string, classes: readonly ClassDef[], go: (to: string) => void): CommandSource[]; // DS's CommandSource: [Findings, Data], one shared request per query
  export function Palette(props: { open: boolean; onClose: () => void; project: Project | null }): JSX.Element;
  ```

- [ ] **Step 1: Write the failing tests**

`frontend/src/app/usePaletteShortcut.test.tsx`:

```tsx
import { describe, expect, it } from "vitest";
import { act, fireEvent, render, renderHook, screen } from "@testing-library/react";
import { isPaletteChord, usePaletteShortcut } from "./usePaletteShortcut";

describe("Ctrl K", () => {
  it("is Ctrl or Cmd with K, in either case, and nothing else", () => {
    const k = (over: Partial<KeyboardEvent>) =>
      isPaletteChord({ key: "k", ctrlKey: false, metaKey: false, altKey: false, shiftKey: false, ...over });
    expect(k({ ctrlKey: true })).toBe(true);
    expect(k({ metaKey: true })).toBe(true);
    expect(k({ ctrlKey: true, key: "K" })).toBe(true);
    expect(k({})).toBe(false);
    expect(k({ ctrlKey: true, shiftKey: true })).toBe(false);
    expect(k({ ctrlKey: true, altKey: true })).toBe(false);
  });

  it("opens from a text field, is not typed into it and never reaches the page's own handlers", () => {
    const { result } = renderHook(() => usePaletteShortcut());
    let reachedPage = false;
    render(<input aria-label="Note" />);
    const input = screen.getByLabelText("Note");
    input.addEventListener("keydown", () => (reachedPage = true));
    input.focus();
    let notCancelled = true;
    act(() => {
      notCancelled = fireEvent.keyDown(input, { key: "k", ctrlKey: true });
    });
    expect(result.current[0]).toBe(true);
    expect(notCancelled).toBe(false);
    expect(reachedPage).toBe(false);
  });
});
```

`frontend/src/app/paletteCommands.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";
import { exampleClasses, fakeClient, PROJECT_ID } from "@/test/fixtures";
import { actionCommands, dataHref, formatFindingNumber, goToCommands, projectSearchSources } from "./paletteCommands";
import { defaultRouteActions } from "./routeActions";
import { routeInfo } from "./routeModel";

describe("palette commands", () => {
  it("go to: the sections everywhere; the tabs, pages and other recent projects inside a project", () => {
    const go = vi.fn();
    const outside = goToCommands(routeInfo("/projects"), [{ id: "p2", name: "North site" }], go);
    expect(outside.map((c) => c.title)).toEqual(["Projects", "Models", "Catalogue", "Jobs", "Settings", "North site"]);
    const inside = goToCommands(routeInfo(`/p/${PROJECT_ID}/images`), [{ id: PROJECT_ID, name: "Ahmadia" }], go);
    const titles = inside.map((c) => c.title);
    expect(titles).toContain("Point clouds");
    expect(titles).toContain("Site areas");
    expect(titles).not.toContain("Ahmadia");
    inside.find((c) => c.title === "Findings")?.run();
    expect(go).toHaveBeenCalledWith(`/p/${PROJECT_ID}/findings`);
  });

  it("actions: the route's enabled actions, the importers, New project and reduced effects", () => {
    const go = vi.fn();
    const addData = vi.fn();
    const toggleEffects = vi.fn();
    const info = routeInfo(`/p/${PROJECT_ID}/findings`);
    const cmds = actionCommands({ info, actions: defaultRouteActions(info, vi.fn()), go, addData, toggleEffects });
    expect(cmds.map((c) => c.title)).toEqual([
      "Add data",
      "Generate report",
      "Add photos",
      "Add an orthomosaic",
      "Add an elevation model",
      "Add a point cloud",
      "New project",
      "Toggle reduced effects",
    ]);
    cmds.find((c) => c.title === "Generate report")?.run();
    expect(go).toHaveBeenCalledWith(`/p/${PROJECT_ID}/reports`);
    cmds.find((c) => c.title === "Add a point cloud")?.run();
    expect(addData).toHaveBeenCalledWith("point_cloud");
    cmds.find((c) => c.title === "New project")?.run();
    expect(go).toHaveBeenCalledWith("/projects?new=1");
    cmds.find((c) => c.title === "Toggle reduced effects")?.run();
    expect(toggleEffects).toHaveBeenCalled();
  });

  it("numbers findings F- plus at least four digits", () => {
    expect(formatFindingNumber(7)).toBe("F-0007");
    expect(formatFindingNumber(217)).toBe("F-0217");
    expect(formatFindingNumber(12345)).toBe("F-12345");
  });

  it("links each data type to where it opens", () => {
    expect(dataHref("p", { id: "m1", type: "map" })).toBe("/p/p/maps/m1");
    expect(dataHref("p", { id: "c1", type: "point_cloud" })).toBe("/p/p/clouds/c1");
    expect(dataHref("p", { id: "s1", type: "image_set" })).toBe("/p/p/images");
    expect(dataHref("p", { id: "e1", type: "elevation" })).toBe("/p/p/measurements");
    expect(dataHref("p", { id: "d1", type: "drawing" })).toBe("/p/p/maps");
  });

  it("searches findings and data in two groups, naming the type from the project's classes", async () => {
    const { api, requests } = fakeClient([
      {
        method: "GET",
        path: /\/search$/,
        body: {
          findings: [{ id: "f1", number: 217, type_id: exampleClasses[0].id, note: "Crack along the north face of column C4, 40cm" }],
          data: [{ id: "m1", type: "map", label: "May survey", captured_on: null, status: "ready", summary: {}, created_at: "2026-05-20T00:00:00Z" }],
        },
      },
    ]);
    const go = vi.fn();
    const [findings, data] = projectSearchSources(api, PROJECT_ID, exampleClasses, go);
    expect([findings.label, data.label]).toEqual(["Findings", "Data"]);
    expect([findings.minQuery, data.minQuery]).toEqual([2, 2]);
    const signal = new AbortController().signal;
    const [found, items] = await Promise.all([findings.search("cr", signal), data.search("cr", signal)]);
    expect(requests).toHaveLength(1);
    expect(requests[0].url).toBe(`/api/v1/projects/${PROJECT_ID}/search?q=cr&limit=8`);
    expect(found[0].title).toBe(`F-0217 · ${exampleClasses[0].name}`);
    expect(found[0].hint).toBe("Crack along the north face of column C4, 40cm");
    found[0].run();
    expect(go).toHaveBeenCalledWith(`/p/${PROJECT_ID}/findings/f1`);
    expect(items[0]).toMatchObject({ title: "May survey", hint: "Orthomosaic" });
  });
});
```

`frontend/src/app/Palette.test.tsx`:

```tsx
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import { Route, Routes, useLocation } from "react-router-dom";
import { exampleClasses, exampleProject, fakeClient, PROJECT_ID } from "@/test/fixtures";
import { renderWithProviders } from "@/test/render";
import { useCommandRegistry, useCommands } from "./commands";
import { Palette } from "./Palette";

function Where() {
  return <p data-testid="where">{useLocation().pathname}</p>;
}

function ScreenWithCommand({ run }: { run: () => void }) {
  useCommands([{ id: "tool:box", title: "Box tool", run }]);
  return null;
}

function renderPalette(path: string, extra?: ReactNode) {
  const onClose = vi.fn();
  const { api } = fakeClient([
    { method: "GET", path: /\/projects$/, body: { items: [exampleProject, { ...exampleProject, id: "p2", name: "North site" }], next_cursor: null } },
    {
      method: "GET",
      path: /\/search$/,
      body: { findings: [{ id: "f1", number: 217, type_id: exampleClasses[0].id, note: "Crack" }], data: [] },
    },
  ]);
  renderWithProviders(
    <Routes>
      <Route
        path="*"
        element={
          <>
            <Palette open onClose={onClose} project={exampleProject} />
            {extra}
            <Where />
          </>
        }
      />
    </Routes>,
    { api, route: path },
  );
  return onClose;
}

describe("Palette", () => {
  beforeEach(() => useCommandRegistry.setState({ entries: [] }));

  it("goes to a tab by name with the keyboard", async () => {
    const onClose = renderPalette(`/p/${PROJECT_ID}/images`);
    const input = screen.getByRole("combobox");
    fireEvent.change(input, { target: { value: "Findings" } });
    fireEvent.keyDown(input, { key: "Enter" });
    await waitFor(() => expect(screen.getByTestId("where")).toHaveTextContent(`/p/${PROJECT_ID}/findings`));
    expect(onClose).toHaveBeenCalled();
  });

  it("lists the other recent projects", async () => {
    renderPalette(`/p/${PROJECT_ID}/images`);
    expect(await screen.findByRole("option", { name: /North site/ })).toBeInTheDocument();
  });

  it("searches the project's findings from two characters", async () => {
    renderPalette(`/p/${PROJECT_ID}/images`);
    fireEvent.change(screen.getByRole("combobox"), { target: { value: "cr" } });
    const hit = await screen.findByRole("option", { name: new RegExp(`F-0217 · ${exampleClasses[0].name}`) });
    fireEvent.click(hit);
    await waitFor(() => expect(screen.getByTestId("where")).toHaveTextContent(`/p/${PROJECT_ID}/findings/f1`));
  });

  it("includes the commands a mounted screen registered", async () => {
    const run = vi.fn();
    renderPalette(`/p/${PROJECT_ID}/images`, <ScreenWithCommand run={run} />);
    fireEvent.click(await screen.findByRole("option", { name: /Box tool/ }));
    expect(run).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `pnpm -C frontend exec vitest run src/app/usePaletteShortcut.test.tsx src/app/paletteCommands.test.ts src/app/Palette.test.tsx`
Expected: FAIL, unresolved `./usePaletteShortcut`, `./paletteCommands`, `./Palette`.

- [ ] **Step 3: Write the implementation**

`frontend/src/app/usePaletteShortcut.ts`:

```ts
import { useEffect, useState } from "react";

export function isPaletteChord(
  e: Pick<KeyboardEvent, "key" | "ctrlKey" | "metaKey" | "altKey" | "shiftKey">,
): boolean {
  return (e.ctrlKey || e.metaKey) && !e.altKey && !e.shiftKey && e.key.toLowerCase() === "k";
}

/**
 * Ctrl K from anywhere, including text fields and work surfaces (spec 2026-09-26-foundation
 * section 5.4): caught in the capture phase on window, so no screen's own key handler sees it.
 */
export function usePaletteShortcut(): [boolean, (open: boolean) => void] {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!isPaletteChord(e)) return;
      e.preventDefault();
      e.stopPropagation();
      setOpen(true);
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, []);
  return [open, setOpen];
}
```

`frontend/src/app/paletteCommands.ts`:

```ts
import type { ApiClient, ClassDef, components } from "@contract/client";
import { unwrap } from "@/api/errors";
import type { Command, CommandSource, IconName } from "@/ui";
import type { AddDataTile } from "./addDataStore";
import type { RouteAction } from "./routeActions";
import { PROJECT_TABS, RAIL_ENTRIES, RAIL_SETTINGS, SECONDARY_PAGES, type RouteInfo } from "./routeModel";

/** The Go to group (spec 2026-09-26-foundation section 5.4). */
export function goToCommands(
  info: RouteInfo,
  recent: readonly { id: string; name: string }[],
  go: (to: string) => void,
): Command[] {
  const out: Command[] = [...RAIL_ENTRIES, RAIL_SETTINGS].map((e) => ({
    id: `go:${e.id}`,
    title: e.label,
    icon: e.icon,
    hint: "Section",
    run: () => go(e.to),
  }));
  if (info.projectId) {
    const base = `/p/${info.projectId}`;
    for (const t of PROJECT_TABS)
      out.push({ id: `go:tab:${t.id}`, title: t.label, icon: t.icon, hint: "Tab", run: () => go(`${base}/${t.id}`) });
    for (const p of SECONDARY_PAGES)
      out.push({ id: `go:page:${p.id}`, title: p.label, icon: p.icon, hint: "Page", run: () => go(`${base}/${p.id}`) });
  }
  for (const r of recent) {
    if (r.id === info.projectId) continue;
    out.push({ id: `go:project:${r.id}`, title: r.name, icon: "folder", hint: "Project", run: () => go(`/p/${r.id}/overview`) });
  }
  return out;
}

const IMPORTERS: { tile: AddDataTile; title: string }[] = [
  { tile: "photos", title: "Add photos" },
  { tile: "orthomosaic", title: "Add an orthomosaic" },
  { tile: "elevation", title: "Add an elevation model" },
  { tile: "point_cloud", title: "Add a point cloud" },
];

/** The Actions group: the route's enabled actions, each importer, New project, reduced effects. */
export function actionCommands(o: {
  info: RouteInfo;
  actions: readonly RouteAction[];
  go: (to: string) => void;
  addData: (tile: AddDataTile | null) => void;
  toggleEffects: () => void;
}): Command[] {
  const out: Command[] = o.actions
    .filter((a) => !a.disabled)
    .map((a) => ({ id: `action:${a.id}`, title: a.label, icon: a.icon, run: () => (a.to ? o.go(a.to) : a.run?.()) }));
  if (o.info.projectId) {
    for (const i of IMPORTERS)
      out.push({ id: `action:add:${i.tile}`, title: i.title, icon: "plus", hint: "Add data", run: () => o.addData(i.tile) });
  }
  out.push({ id: "action:new-project", title: "New project", icon: "plus", run: () => o.go("/projects?new=1") });
  out.push({ id: "action:toggle-effects", title: "Toggle reduced effects", icon: "layers", run: o.toggleEffects });
  return out;
}

/** The human finding number (spec section 8.1): F- and at least four digits. */
export const formatFindingNumber = (n: number): string => `F-${String(n).padStart(4, "0")}`;

const DATA_LABEL: Record<string, string> = {
  image_set: "Photos",
  map: "Orthomosaic",
  elevation: "Elevation",
  point_cloud: "Point cloud",
  drawing: "Drawing",
};

const DATA_ICON: Record<string, IconName> = {
  image_set: "images",
  map: "map",
  elevation: "elevation",
  point_cloud: "cloud",
  drawing: "drawing",
};

export function dataHref(projectId: string, item: { id: string; type: string }): string {
  const base = `/p/${projectId}`;
  if (item.type === "map") return `${base}/maps/${item.id}`;
  if (item.type === "point_cloud") return `${base}/clouds/${item.id}`;
  if (item.type === "elevation") return `${base}/measurements`;
  if (item.type === "drawing") return `${base}/maps`;
  return `${base}/images`;
}

const excerpt = (note: string): string | undefined =>
  note ? (note.length > 60 ? `${note.slice(0, 57)}…` : note) : undefined;

/**
 * The Search groups (spec section 10.3): findings and data of the open project, 8 of each at most.
 * DS's `CommandSource` answers one group, so there are two sources; they share one
 * `GET /search` per query (the last query's promise is reused), so a keystroke costs one request.
 */
export function projectSearchSources(
  api: ApiClient,
  projectId: string,
  classes: readonly ClassDef[],
  go: (to: string) => void,
): CommandSource[] {
  const typeName = (id: string) => classes.find((c) => c.id === id)?.name ?? "Unknown type";
  let last: { q: string; result: Promise<components["schemas"]["ProjectSearchResult"]> } | null = null;
  const fetchOnce = (q: string, signal: AbortSignal) => {
    if (last?.q !== q) {
      last = {
        q,
        result: unwrap(
          api.GET("/api/v1/projects/{projectId}/search", {
            params: { path: { projectId }, query: { q, limit: 8 } },
            signal,
          }),
        ),
      };
    }
    return last.result;
  };
  return [
    {
      id: "search:findings",
      label: "Findings",
      minQuery: 2,
      search: async (q, signal) =>
        (await fetchOnce(q, signal)).findings.map((f) => ({
          id: `finding:${f.id}`,
          title: `${formatFindingNumber(f.number)} · ${typeName(f.type_id)}`,
          hint: excerpt(f.note),
          icon: "findings" as IconName,
          run: () => go(`/p/${projectId}/findings/${f.id}`),
        })),
    },
    {
      id: "search:data",
      label: "Data",
      minQuery: 2,
      search: async (q, signal) =>
        (await fetchOnce(q, signal)).data.map((d) => ({
          id: `data:${d.id}`,
          title: d.label,
          hint: DATA_LABEL[d.type] ?? d.type,
          icon: DATA_ICON[d.type] ?? ("images" as IconName),
          run: () => go(dataHref(projectId, d)),
        })),
    },
  ];
}
```

`frontend/src/app/Palette.tsx`:

```tsx
import { useEffect, useMemo, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import type { Project } from "@contract/client";
import { useApi } from "@/api/client";
import { messageOf, unwrap } from "@/api/errors";
import { setEffectsChoice } from "@/app/effects";
import { pushLog } from "@/app/diagnostics";
import { CommandPalette } from "@/ui";
import { useAddData } from "./addDataStore";
import { collectCommands, useCommandRegistry } from "./commands";
import { actionCommands, goToCommands, projectSearchSources } from "./paletteCommands";
import { useRouteActions } from "./routeActions";
import { routeInfo } from "./routeModel";

/** Recent projects for Go to, read when the palette opens (GET /projects is bounded at 20). */
function useRecentProjects(open: boolean): { id: string; name: string }[] {
  const api = useApi();
  const [recent, setRecent] = useState<{ id: string; name: string }[]>([]);
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    unwrap(api.GET("/api/v1/projects"))
      .then((page) => {
        if (!cancelled)
          setRecent(
            // Only projects that open: not a missing folder (C0 `availability`) nor an unfinished upgrade.
            page.items
              .filter((p) => p.availability === "ok" && p.migration.state === "ok")
              .map((p) => ({ id: p.id, name: p.name })),
          );
      })
      .catch((e: unknown) => pushLog(`palette projects unavailable: ${messageOf(e, String(e))}`));
    return () => {
      cancelled = true;
    };
  }, [api, open]);
  return recent;
}

/** The Ctrl K command palette (spec 2026-09-26-foundation section 5.4). */
export function Palette({ open, onClose, project }: { open: boolean; onClose: () => void; project: Project | null }) {
  const api = useApi();
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const actions = useRouteActions();
  const entries = useCommandRegistry((s) => s.entries);
  const recent = useRecentProjects(open);
  const info = useMemo(() => routeInfo(pathname), [pathname]);
  const go = useMemo(
    () => (to: string) => {
      onClose();
      void navigate(to);
    },
    [navigate, onClose],
  );
  const groups = useMemo(
    () => [
      { label: "Go to", items: [...goToCommands(info, recent, go), ...collectCommands(entries, "Go to")] },
      {
        label: "Actions",
        items: [
          ...actionCommands({
            info,
            actions,
            go,
            addData: (tile) => {
              onClose();
              useAddData.getState().show(tile);
            },
            // The effective mode (Auto may have resolved to either) is on <html data-effects>.
            toggleEffects: () =>
              setEffectsChoice(document.documentElement.dataset.effects === "reduced" ? "full" : "reduced"),
          }),
          ...collectCommands(entries, "Actions"),
        ],
      },
    ],
    [info, recent, go, entries, actions, onClose],
  );
  const sources = useMemo(
    () => (info.projectId ? projectSearchSources(api, info.projectId, project?.classes ?? [], go) : []),
    [api, info.projectId, project, go],
  );
  return <CommandPalette open={open} onClose={onClose} groups={groups} sources={sources} />;
}
```

- [ ] **Step 4: Run them to verify they pass**

Run: `pnpm -C frontend exec vitest run src/app/usePaletteShortcut.test.tsx src/app/paletteCommands.test.ts src/app/Palette.test.tsx`
Expected: PASS (all). If the palette test cannot find `combobox` or `option`, read DS's `CommandPalette.test.tsx` for the roles it renders and use those; do not change DS.

- [ ] **Step 5: Commit**

```powershell
git add frontend/src/app/usePaletteShortcut.ts frontend/src/app/usePaletteShortcut.test.tsx frontend/src/app/paletteCommands.ts frontend/src/app/paletteCommands.test.ts frontend/src/app/Palette.tsx frontend/src/app/Palette.test.tsx
git commit -m "feat(shell): Ctrl K palette with Go to, Actions, registered commands and project search" -m "Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 8: Interim hosts: placeholders, jobs, Add data, the Maps list, NotFound

**Files:**
- Create: `frontend/src/app/InterimScreens.tsx`, `frontend/src/app/InterimJobs.tsx`, `frontend/src/app/NotFound.tsx`, `frontend/src/app/AddDataHost.tsx`, `frontend/src/reports/ReportsPlaceholder.tsx`, `frontend/src/maps/dataItems.ts`, `frontend/src/maps/MapDataList.tsx`
- Modify: `frontend/src/app/AdoptionBanner.tsx` (drop the kind gate), `frontend/src/app/AdoptionBanner.test.tsx`, `frontend/src/settings/SourcesSection.tsx` (+ `SourcesSection.test.tsx`)
- Test: `frontend/src/app/InterimScreens.test.tsx`, `frontend/src/app/InterimJobs.test.tsx`, `frontend/src/app/AddDataHost.test.tsx`, `frontend/src/maps/MapDataList.test.tsx`

**Interfaces:**
- Consumes: `useAddData`, `AddDataTile` (Task 2); `useChangesStore.dataRevision` (Task 5); existing `ImportImagesDialog`, `ImportMapDialog`, `JobCard`, `useJobList`, `SurveyDateCell`, `updateMapDate`, `updateSource`, `AdoptionBanner`; C0 `DataItem`.
- Produces:
  ```ts
  export function InterimOverview(): JSX.Element;        // S1 replaces its route entry
  export function InterimFindings(): JSX.Element;        // S1 replaces
  export function SectionPlaceholder(p: { title: string; icon: IconName; children: ReactNode }): JSX.Element;  // S2 replaces its entries
  export function InterimJobs(): JSX.Element;            // S2 replaces
  export function NotFound(): JSX.Element;
  export function AddDataHost({ project }: { project: Project | null }): JSX.Element | null;  // S1 swaps its body for AddDataDialog
  export function ReportsPlaceholder(): JSX.Element;     // R replaces
  // maps/dataItems.ts
  export const MAP_DATA_TYPES: readonly ["map", "elevation", "drawing"];
  export const MAP_PAGE = 100;
  export function fetchMapItems(api: ApiClient, projectId: string, cursor: string | null): Promise<{ items: DataItem[]; next_cursor: string | null }>;
  export function detailOf(item: DataItem): string;
  export function MapDataList(): JSX.Element;            // M replaces with the workspace
  ```

- [ ] **Step 1: Write the failing tests**

`frontend/src/app/InterimScreens.test.tsx`:

```tsx
import { beforeEach, describe, expect, it } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { fakeClient, PROJECT_ID } from "@/test/fixtures";
import { renderWithProviders } from "@/test/render";
import { ReportsPlaceholder } from "@/reports/ReportsPlaceholder";
import { useAddData } from "./addDataStore";
import { InterimFindings, InterimOverview, SectionPlaceholder } from "./InterimScreens";
import { NotFound } from "./NotFound";

describe("interim screens", () => {
  beforeEach(() => useAddData.setState({ open: false, tile: null }));

  it("Overview says what to add first and opens Add data", () => {
    const { api } = fakeClient([]);
    renderWithProviders(<InterimOverview />, { api, route: `/p/${PROJECT_ID}/overview`, path: "/p/:projectId/overview" });
    expect(screen.getByRole("heading", { name: "Overview" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Add data" }));
    expect(useAddData.getState().open).toBe(true);
  });

  it("Findings says where findings come from", () => {
    render(<InterimFindings />);
    expect(screen.getByText(/created in the Images, Maps and Point clouds workspaces/)).toBeInTheDocument();
  });

  it("an app section placeholder has its title as the page heading", () => {
    render(
      <SectionPlaceholder title="Catalogue" icon="catalogue">
        Types
      </SectionPlaceholder>,
    );
    expect(screen.getByRole("heading", { name: "Catalogue" })).toBeInTheDocument();
  });

  it("Reports is an empty state", () => {
    render(<ReportsPlaceholder />);
    expect(screen.getByRole("heading", { name: "Reports" })).toBeInTheDocument();
  });

  it("an unknown address offers the way back to Projects", () => {
    render(
      <MemoryRouter>
        <NotFound />
      </MemoryRouter>,
    );
    expect(screen.getByText("Nothing at this address")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Open Projects" })).toHaveAttribute("href", "/projects");
  });
});
```

`frontend/src/app/InterimJobs.test.tsx`:

```tsx
import { beforeEach, describe, expect, it } from "vitest";
import { screen } from "@testing-library/react";
import { useJobsStore } from "@/store/jobs";
import { fakeClient, PROJECT_ID, runningJob } from "@/test/fixtures";
import { renderWithProviders } from "@/test/render";
import { InterimJobs } from "./InterimJobs";

describe("InterimJobs", () => {
  beforeEach(() => useJobsStore.setState({ jobs: {}, panelOpen: false }));

  it("asks for a project when none is given", () => {
    renderWithProviders(<InterimJobs />, { api: fakeClient([]).api, route: "/jobs" });
    expect(screen.getByText("Open a project to see its jobs")).toBeInTheDocument();
  });

  it("lists the project's jobs newest first", async () => {
    const job = { ...runningJob, project_id: PROJECT_ID };
    const { api, requests } = fakeClient([{ method: "GET", path: /\/jobs$/, body: { items: [job], next_cursor: null } }]);
    renderWithProviders(<InterimJobs />, { api, route: `/jobs?project=${PROJECT_ID}` });
    expect(await screen.findByTestId(`job-${job.id}`)).toBeInTheDocument();
    expect(requests[0].url).toContain(`/projects/${PROJECT_ID}/jobs`);
    expect(screen.getByRole("heading", { name: "Jobs" })).toBeInTheDocument();
  });
});
```

`frontend/src/app/AddDataHost.test.tsx`:

```tsx
import { beforeEach, describe, expect, it } from "vitest";
import { act, fireEvent, screen } from "@testing-library/react";
import { Route, Routes, useLocation } from "react-router-dom";
import { exampleProject, fakeClient, PROJECT_ID } from "@/test/fixtures";
import { renderWithProviders } from "@/test/render";
import { AddDataHost } from "./AddDataHost";
import { useAddData } from "./addDataStore";

function Where() {
  return <p data-testid="where">{useLocation().pathname}</p>;
}

function renderHost() {
  renderWithProviders(
    <Routes>
      <Route
        path="*"
        element={
          <>
            <AddDataHost project={exampleProject} />
            <Where />
          </>
        }
      />
    </Routes>,
    { api: fakeClient([]).api, route: `/p/${PROJECT_ID}/overview` },
  );
}

describe("AddDataHost", () => {
  beforeEach(() => useAddData.setState({ open: false, tile: null }));

  it("renders nothing until opened", () => {
    renderHost();
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("offers five kinds of data, Drawing not yet", () => {
    renderHost();
    act(() => useAddData.getState().show(null));
    const dialog = screen.getByRole("dialog", { name: "Add data" });
    for (const name of [/Photos/, /Orthomosaic/, /Elevation/, /Point cloud/]) {
      expect(screen.getByRole("button", { name })).toBeEnabled();
    }
    expect(screen.getByRole("button", { name: /Drawing/ })).toBeDisabled();
    expect(dialog).toBeInTheDocument();
  });

  it("opens the photo importer from Photos", () => {
    renderHost();
    act(() => useAddData.getState().show(null));
    fireEvent.click(screen.getByRole("button", { name: /Photos/ }));
    expect(screen.getByRole("dialog", { name: "Import images" })).toBeInTheDocument();
  });

  it("opens an importer directly when asked for one", () => {
    renderHost();
    act(() => useAddData.getState().show("orthomosaic"));
    expect(screen.queryByRole("dialog", { name: "Add data" })).toBeNull();
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  it("takes Point cloud and Elevation to the screens that import them", () => {
    renderHost();
    act(() => useAddData.getState().show(null));
    fireEvent.click(screen.getByRole("button", { name: /Point cloud/ }));
    expect(screen.getByTestId("where")).toHaveTextContent(`/p/${PROJECT_ID}/clouds`);
    expect(useAddData.getState().open).toBe(false);
    act(() => useAddData.getState().show(null));
    fireEvent.click(screen.getByRole("button", { name: /Elevation/ }));
    expect(screen.getByTestId("where")).toHaveTextContent(`/p/${PROJECT_ID}/measurements`);
  });
});
```

`frontend/src/maps/MapDataList.test.tsx`:

```tsx
import { beforeEach, describe, expect, it } from "vitest";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { useAddData } from "@/app/addDataStore";
import { useChangesStore } from "@/store/changes";
import { exampleGeoMap, fakeClient, MAP_ID, PROJECT_ID } from "@/test/fixtures";
import { renderWithProviders } from "@/test/render";
import { detailOf } from "./dataItems";
import { MapDataList } from "./MapDataList";

const mapItem = {
  id: MAP_ID,
  type: "map" as const,
  label: "Site north ortho",
  captured_on: "2026-04-15",
  status: "ready",
  summary: { gsd_cm: 3, epsg: 32633, width: 80000, height: 60000 },
  created_at: "2026-09-22T10:00:00Z",
};
const elevationItem = {
  id: "s1",
  type: "elevation" as const,
  label: "Design surface",
  captured_on: null,
  status: "importing",
  summary: { kind: "design", cell_size_m: 0.5, z_min: 10, z_max: 30 },
  created_at: "2026-09-22T11:00:00Z",
};

function renderList(items: unknown[], next: string | null = null) {
  const fake = fakeClient([
    { method: "GET", path: /\/data$/, body: { items, next_cursor: next } },
    { method: "PATCH", path: /\/maps\/[^/]+$/, body: { ...exampleGeoMap, captured_on: "2026-04-16" } },
  ]);
  renderWithProviders(<MapDataList />, { api: fake.api, route: `/p/${PROJECT_ID}/maps`, path: "/p/:projectId/maps" });
  return fake;
}

describe("MapDataList", () => {
  beforeEach(() => {
    useChangesStore.setState({ dataRevision: 0 });
    useAddData.setState({ open: false, tile: null });
  });

  it("asks the data list for maps, elevation and drawings, one bounded page", async () => {
    const { requests } = renderList([mapItem]);
    await screen.findByText("Site north ortho");
    const url = new URL(`http://x${requests[0].url}`);
    expect(url.searchParams.getAll("type")).toEqual(["map", "elevation", "drawing"]);
    expect(url.searchParams.get("limit")).toBe("100");
  });

  it("lists each item with its type, date, state and details, and opens a map", async () => {
    renderList([mapItem, elevationItem]);
    const map = (await screen.findByRole("rowheader", { name: "Site north ortho" })).closest("tr")!;
    expect(within(map).getByRole("link", { name: "Site north ortho" })).toHaveAttribute(
      "href",
      `/p/${PROJECT_ID}/maps/${MAP_ID}`,
    );
    expect(map).toHaveTextContent("Orthomosaic");
    expect(map).toHaveTextContent("Ready");
    expect(map).toHaveTextContent("3 cm/px · EPSG:32633");
    const surface = screen.getByRole("rowheader", { name: "Design surface" }).closest("tr")!;
    expect(surface).toHaveTextContent("Elevation");
    expect(surface).toHaveTextContent("Importing");
    expect(surface).toHaveTextContent("date not set");
  });

  it("corrects a map's survey date in place", async () => {
    const { requests } = renderList([mapItem]);
    const row = (await screen.findByRole("rowheader", { name: "Site north ortho" })).closest("tr")!;
    fireEvent.click(within(row).getByRole("button", { name: /Site north ortho/ }));
    fireEvent.change(within(row).getByRole("textbox"), { target: { value: "2026-04-16" } });
    fireEvent.submit(within(row).getByRole("textbox").closest("form")!);
    await waitFor(() => expect(requests.some((r) => r.method === "PATCH")).toBe(true));
    expect(requests.find((r) => r.method === "PATCH")?.body).toEqual({ captured_on: "2026-04-16" });
    await waitFor(() => expect(row).toHaveTextContent("2026-04-16"));
  });

  it("loads the next page on request", async () => {
    const { requests } = renderList([mapItem], "cursor-2");
    fireEvent.click(await screen.findByRole("button", { name: "Load more" }));
    await waitFor(() => expect(requests).toHaveLength(2));
    expect(new URL(`http://x${requests[1].url}`).searchParams.get("cursor")).toBe("cursor-2");
  });

  it("offers Add data when the project has no maps", async () => {
    renderList([]);
    fireEvent.click(await screen.findByRole("button", { name: "Add an orthomosaic" }));
    expect(useAddData.getState()).toMatchObject({ open: true, tile: "orthomosaic" });
  });

  it("formats details per type", () => {
    expect(detailOf(mapItem as never)).toBe("3 cm/px · EPSG:32633");
    expect(detailOf(elevationItem as never)).toBe("0.5 m cells");
    expect(detailOf({ ...mapItem, type: "drawing", summary: {} } as never)).toBe("");
  });
});
```

(`SurveyDateCell` renders a button named after its `label` that starts editing, a text field, and a form; if its accessible names differ, read `sources/SurveyDateCell.tsx` and match them.)

Add to `frontend/src/settings/SourcesSection.test.tsx` (inside its `describe`; `exampleSource` is the fixture the file already renders — use the name the file uses):

```tsx
  it("corrects a photo folder's survey date in place", async () => {
    const { api, requests } = fakeClient([
      { method: "GET", path: /\/sources$/, body: { items: [{ ...exampleSource, captured_on: null }], next_cursor: null } },
      { method: "PATCH", path: /\/sources\/[^/]+$/, body: { ...exampleSource, captured_on: "2019-04-15" } },
    ]);
    renderWithProviders(<SourcesSection projectId={PROJECT_ID} />, { api });
    const section = await screen.findByTestId("sources-section");
    await within(section).findByText("date not set");
    fireEvent.click(within(section).getByRole("button", { name: new RegExp(exampleSource.site) }));
    fireEvent.change(within(section).getByRole("textbox"), { target: { value: "2019-04-15" } });
    fireEvent.submit(within(section).getByRole("textbox").closest("form")!);
    await waitFor(() => expect(requests.find((r) => r.method === "PATCH")?.body).toEqual({ captured_on: "2019-04-15" }));
  });
```

In `frontend/src/app/AdoptionBanner.test.tsx` delete the `import { useProjectKindStore } from "./useProjectKind";` line and the `useProjectKindStore.setState({ byProject: { [PROJECT_ID]: "train" } });` line in `beforeEach`.

- [ ] **Step 2: Run them to verify they fail**

Run: `pnpm -C frontend exec vitest run src/app/InterimScreens.test.tsx src/app/InterimJobs.test.tsx src/app/AddDataHost.test.tsx src/maps/MapDataList.test.tsx src/settings/SourcesSection.test.tsx`
Expected: FAIL: unresolved modules; the SourcesSection date test fails ("date not set" not found).

- [ ] **Step 3: Write the implementation**

`frontend/src/app/InterimScreens.tsx`:

```tsx
import type { ReactNode } from "react";
import { useParams } from "react-router-dom";
import { Button, EmptyState, type IconName } from "@/ui";
import { AdoptionBanner } from "./AdoptionBanner";
import { useAddData } from "./addDataStore";

/** Interim Overview until the dashboard lands: the adoption notice and what to add first. */
export function InterimOverview() {
  const { projectId = "" } = useParams();
  return (
    <section className="flex flex-col gap-4">
      <h1 className="text-xl font-semibold">Overview</h1>
      <AdoptionBanner projectId={projectId} />
      <EmptyState
        icon="overview"
        title="Start by adding data"
        action={
          <Button variant="primary" icon="plus" onClick={() => useAddData.getState().show(null)}>
            Add data
          </Button>
        }
      >
        Photos, orthomosaics, elevation models and point clouds all live in this project. Add what you
        have, then open it from the tabs above.
      </EmptyState>
    </section>
  );
}

/** Interim Findings tab. */
export function InterimFindings() {
  return (
    <section className="flex flex-col gap-4">
      <h1 className="text-xl font-semibold">Findings</h1>
      <EmptyState icon="findings" title="No findings yet">
        Findings are created in the Images, Maps and Point clouds workspaces, and are listed here.
      </EmptyState>
    </section>
  );
}

/** A section page whose screen has not landed yet. */
export function SectionPlaceholder({ title, icon, children }: { title: string; icon: IconName; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-4">
      <h1 className="text-xl font-semibold">{title}</h1>
      <EmptyState icon={icon} title={`${title} will appear here`}>
        {children}
      </EmptyState>
    </section>
  );
}
```

`frontend/src/app/NotFound.tsx`:

```tsx
import { Link } from "react-router-dom";
import { EmptyState, buttonClass } from "@/ui";

/** Any address no route matches, inside the shell (the router's own error page is never shown). */
export function NotFound() {
  return (
    <EmptyState
      icon="search"
      title="Nothing at this address"
      action={
        <Link to="/projects" className={buttonClass("secondary", "md")}>
          Open Projects
        </Link>
      }
    >
      The page may have moved. Pick a section on the left, or open your projects.
    </EmptyState>
  );
}
```

`frontend/src/reports/ReportsPlaceholder.tsx`:

```tsx
import { EmptyState } from "@/ui";

/** The Reports tab until the report builder lands (spec 2026-09-26-foundation section 5.3). */
export function ReportsPlaceholder() {
  return (
    <section className="flex flex-col gap-4">
      <h1 className="text-xl font-semibold">Reports</h1>
      <EmptyState icon="report" title="No reports yet">
        Reports of this project&apos;s findings and measurements will be built here.
      </EmptyState>
    </section>
  );
}
```

`frontend/src/app/InterimJobs.tsx`:

```tsx
import { useMemo } from "react";
import { useSearchParams } from "react-router-dom";
import { JobCard } from "@/jobs/JobCard";
import { useJobList } from "@/jobs/useJobList";
import { useJobsStore } from "@/store/jobs";
import { Alert, EmptyState, IconButton, SkeletonRows } from "@/ui";

/** `/jobs?project=` until the app-wide Jobs section lands: the project's jobs, newest first. */
export function InterimJobs() {
  const [params] = useSearchParams();
  const projectId = params.get("project") ?? "";
  const jobs = useJobsStore((s) => s.jobs);
  const list = useJobList(projectId, projectId !== "");
  const sorted = useMemo(
    () =>
      Object.values(jobs)
        .filter((j) => j.project_id === projectId)
        .sort((a, b) => b.created_at.localeCompare(a.created_at)),
    [jobs, projectId],
  );
  return (
    <section className="flex max-w-3xl flex-col gap-4">
      <div className="flex items-center gap-2">
        <h1 className="flex-1 text-xl font-semibold">Jobs</h1>
        {projectId && <IconButton icon="refresh" label="Refresh" onClick={list.reload} disabled={list.loading} />}
      </div>
      {!projectId ? (
        <EmptyState icon="jobs" title="Open a project to see its jobs">
          Imports, detections, exports and training runs are listed here while they run and after they finish.
        </EmptyState>
      ) : (
        <>
          {list.error && <Alert tone="danger">{list.error}</Alert>}
          {sorted.length === 0 &&
            (list.loading ? <SkeletonRows rows={3} columns={3} /> : <p className="py-6 text-sm text-muted">No jobs yet.</p>)}
          {sorted.length > 0 && (
            <ul className="flex flex-col divide-y divide-line">
              {sorted.map((job) => (
                <li key={job.id}>
                  <JobCard projectId={projectId} job={job} />
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </section>
  );
}
```

`frontend/src/app/AddDataHost.tsx`:

```tsx
import { useNavigate } from "react-router-dom";
import type { Project } from "@contract/client";
import { ImportImagesDialog } from "@/data/ImportImagesDialog";
import { ImportMapDialog } from "@/maps/ImportMapDialog";
import { Dialog, Icon, Tooltip, cx, focusRing, type IconName } from "@/ui";
import { useAddData, type AddDataTile } from "./addDataStore";

type TileId = AddDataTile | "drawing";

const TILES: { id: TileId; label: string; hint: string; icon: IconName }[] = [
  { id: "photos", label: "Photos", hint: "A folder of drone photos", icon: "images" },
  { id: "orthomosaic", label: "Orthomosaic", hint: "A GeoTIFF map of the site", icon: "map" },
  { id: "elevation", label: "Elevation", hint: "A DSM, DTM or design surface", icon: "elevation" },
  { id: "point_cloud", label: "Point cloud", hint: "A LAS or LAZ file", icon: "cloud" },
  { id: "drawing", label: "Drawing", hint: "DXF, LandXML, PDF or PNG", icon: "drawing" },
];

function Tile({ tile, disabled, onClick }: { tile: (typeof TILES)[number]; disabled?: boolean; onClick?: () => void }) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className={cx(
        "flex w-full items-center gap-3 rounded-control border border-line bg-surface p-3 text-left hover:bg-hover disabled:opacity-50",
        focusRing,
      )}
    >
      <Icon name={tile.icon} size={20} />
      <span className="flex flex-col">
        <span className="text-sm font-semibold text-ink">{tile.label}</span>
        <span className="text-xs text-muted">{tile.hint}</span>
      </span>
    </button>
  );
}

/**
 * Add data (spec 2026-09-26-foundation section 6.4), interim until `data/AddDataDialog`: Photos and
 * Orthomosaic open today's importers; Elevation and Point cloud open the screens that import them.
 */
export function AddDataHost({ project }: { project: Project | null }) {
  const { open, tile, show, close } = useAddData();
  const navigate = useNavigate();
  // Elevation and Point cloud have no dialog of their own yet: their screens import them.
  useEffect(() => {
    if (!open || !project) return;
    if (tile !== "elevation" && tile !== "point_cloud") return;
    close();
    void navigate(`/p/${project.id}/${tile === "elevation" ? "measurements" : "clouds"}`);
  }, [open, tile, project, close, navigate]);
  if (!open || !project) return null;
  const base = `/p/${project.id}`;
  const leave = (to: string) => {
    close();
    void navigate(to);
  };
  if (tile === "photos")
    return <ImportImagesDialog project={project} onClose={close} onStarted={() => leave(`${base}/images`)} />;
  if (tile === "orthomosaic")
    return <ImportMapDialog projectId={project.id} onClose={close} onStarted={() => leave(`${base}/maps`)} />;
  if (tile === "elevation" || tile === "point_cloud") return null;
  return (
    <Dialog open title="Add data" onClose={close} description="Every import runs as a background job; keep working meanwhile.">
      <ul className="grid grid-cols-2 gap-2">
        {TILES.map((t) => (
          <li key={t.id}>
            {t.id === "drawing" ? (
              <Tooltip label="Arrives with the Maps workspace">
                <span className="block">
                  <Tile tile={t} disabled />
                </span>
              </Tooltip>
            ) : (
              <Tile tile={t} onClick={() => show(t.id as AddDataTile)} />
            )}
          </li>
        ))}
      </ul>
    </Dialog>
  );
}
```

(Add `import { useEffect } from "react";` at the top of `AddDataHost.tsx`.)

`frontend/src/maps/dataItems.ts`:

```ts
import type { ApiClient, components } from "@contract/client";
import { unwrap } from "@/api/errors";

export type DataItem = components["schemas"]["DataItem"];

/** The data types the Maps tab lists (spec 2026-09-26-foundation section 5.3). */
export const MAP_DATA_TYPES = ["map", "elevation", "drawing"] as const;
export const MAP_PAGE = 100;

export function fetchMapItems(api: ApiClient, projectId: string, cursor: string | null) {
  return unwrap(
    api.GET("/api/v1/projects/{projectId}/data", {
      params: {
        path: { projectId },
        query: { type: [...MAP_DATA_TYPES], limit: MAP_PAGE, ...(cursor ? { cursor } : {}) },
      },
    }),
  );
}

const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);

/** The mono detail column: resolution and CRS for a map, cell size for an elevation model. */
export function detailOf(item: DataItem): string {
  const s = (item.summary ?? {}) as Record<string, unknown>;
  if (item.type === "map") {
    const gsd = num(s.gsd_cm);
    const epsg = num(s.epsg);
    return [gsd !== null ? `${gsd} cm/px` : null, epsg !== null ? `EPSG:${epsg}` : null].filter(Boolean).join(" · ");
  }
  if (item.type === "elevation") {
    const cell = num(s.cell_size_m);
    return cell !== null ? `${cell} m cells` : "";
  }
  return "";
}
```

`frontend/src/maps/MapDataList.tsx`:

```tsx
import { useCallback, useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { useApi } from "@/api/client";
import { messageOf } from "@/api/errors";
import { updateMapDate } from "@/api/sources";
import { pushLog } from "@/app/diagnostics";
import { useAddData } from "@/app/addDataStore";
import { SurveyDateCell } from "@/sources/SurveyDateCell";
import { useChangesStore } from "@/store/changes";
import { Alert, Button, EmptyState, Pill, SkeletonRows, type PillTone } from "@/ui";
import { detailOf, fetchMapItems, type DataItem } from "./dataItems";

const TYPE_LABEL: Record<string, string> = { map: "Orthomosaic", elevation: "Elevation", drawing: "Drawing" };
const STATUS: Record<string, { label: string; tone: PillTone; live?: boolean }> = {
  ready: { label: "Ready", tone: "ok" },
  importing: { label: "Importing", tone: "accent", live: true },
  failed: { label: "Failed", tone: "danger" },
};

/**
 * The Maps tab until the map workspace lands: the project's orthomosaics, elevation models and
 * drawings from the Data list, newest survey first, in pages of 100. A map opens in today's viewer.
 */
export function MapDataList() {
  const { projectId = "" } = useParams();
  const api = useApi();
  const revision = useChangesStore((s) => s.dataRevision);
  const [list, setList] = useState<{ key: string; items: DataItem[]; next: string | null } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [more, setMore] = useState(false);
  const key = `${projectId}|${revision}`;

  useEffect(() => {
    let cancelled = false;
    fetchMapItems(api, projectId, null)
      .then((page) => {
        if (cancelled) return;
        setList({ key, items: page.items, next: page.next_cursor });
        setError(null);
      })
      .catch((e: unknown) => {
        if (cancelled) return;
        pushLog(`load maps failed: ${messageOf(e, String(e))}`);
        setError(messageOf(e, "could not load the maps"));
      });
    return () => {
      cancelled = true;
    };
  }, [api, projectId, key]);

  const loadMore = useCallback(async () => {
    if (!list?.next) return;
    setMore(true);
    try {
      const page = await fetchMapItems(api, projectId, list.next);
      setList((l) => (l ? { ...l, items: [...l.items, ...page.items], next: page.next_cursor } : l));
    } catch (e) {
      setError(messageOf(e, "could not load more maps"));
    } finally {
      setMore(false);
    }
  }, [api, projectId, list]);

  const saveDate = async (item: DataItem, next: string | null) => {
    await updateMapDate(api, projectId, item.id, next);
    setList((l) => (l ? { ...l, items: l.items.map((i) => (i.id === item.id ? { ...i, captured_on: next } : i)) } : l));
  };

  const items = list?.items ?? null;
  return (
    <section className="flex flex-col gap-4">
      <h1 className="text-xl font-semibold">Maps</h1>
      {error && <Alert tone="danger">{error}</Alert>}
      {items === null && !error && <SkeletonRows rows={3} columns={5} />}
      {items && items.length === 0 && (
        <EmptyState
          icon="map"
          title="No maps yet"
          action={
            <Button variant="primary" icon="plus" onClick={() => useAddData.getState().show("orthomosaic")}>
              Add an orthomosaic
            </Button>
          }
        >
          Add a GeoTIFF orthomosaic of the site. Elevation models and drawings are listed here too.
        </EmptyState>
      )}
      {items && items.length > 0 && (
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs text-muted">
              <th scope="col" className="py-2 font-medium">Name</th>
              <th scope="col" className="font-medium">Type</th>
              <th scope="col" className="font-medium">Survey date</th>
              <th scope="col" className="font-medium">State</th>
              <th scope="col" className="font-medium">Details</th>
            </tr>
          </thead>
          <tbody>
            {items.map((item) => {
              const status = STATUS[item.status] ?? { label: item.status, tone: "neutral" as PillTone };
              const href =
                item.type === "map"
                  ? `/p/${projectId}/maps/${item.id}`
                  : item.type === "elevation"
                    ? `/p/${projectId}/measurements`
                    : null;
              return (
                <tr key={item.id} className="border-t border-line">
                  <th scope="row" className="py-2 pr-3 text-left font-medium text-ink">
                    {href ? (
                      <Link to={href} className="hover:underline">
                        {item.label}
                      </Link>
                    ) : (
                      item.label
                    )}
                  </th>
                  <td className="pr-3 text-muted">{TYPE_LABEL[item.type] ?? item.type}</td>
                  <td className="pr-3">
                    {item.type === "map" ? (
                      <SurveyDateCell label={item.label} value={item.captured_on} onSave={(d) => saveDate(item, d)} />
                    ) : (
                      <span className="text-muted">{item.captured_on ?? "date not set"}</span>
                    )}
                  </td>
                  <td className="pr-3">
                    <Pill size="sm" tone={status.tone} live={status.live}>
                      {status.label}
                    </Pill>
                  </td>
                  <td className="font-mono text-xs text-muted">{detailOf(item)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
      {list?.next && (
        <Button className="self-start" onClick={() => void loadMore()} loading={more}>
          Load more
        </Button>
      )}
    </section>
  );
}
```

In `frontend/src/app/AdoptionBanner.tsx`: delete `import { useProjectKind } from "./useProjectKind";`, the line `const kind = useProjectKind(projectId);`, the line `if (kind !== "train") return;`, and `kind` from the effect's dependency array; change the doc comment's first line to "Overview's notice about a project's old models moving into the app-wide library: progress".

In `frontend/src/settings/SourcesSection.tsx`, in `SourceRow`: add `import { updateSource } from "@/api/sources";` (extend the existing `@/api/sources` import) and `import { SurveyDateCell } from "@/sources/SurveyDateCell";`; add state `const [capturedOn, setCapturedOn] = useState(source.captured_on);`; and after the counts `<span>` insert:

```tsx
        <SurveyDateCell
          label={source.site}
          value={capturedOn}
          onSave={async (next) => {
            const saved = await updateSource(api, projectId, source.id, { captured_on: next });
            setCapturedOn(saved.captured_on);
          }}
        />
```

- [ ] **Step 4: Run them to verify they pass**

Run: `pnpm -C frontend exec vitest run src/app/InterimScreens.test.tsx src/app/InterimJobs.test.tsx src/app/AddDataHost.test.tsx src/maps/MapDataList.test.tsx src/settings/SourcesSection.test.tsx src/app/AdoptionBanner.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```powershell
git add frontend/src/app/InterimScreens.tsx frontend/src/app/InterimScreens.test.tsx frontend/src/app/InterimJobs.tsx frontend/src/app/InterimJobs.test.tsx frontend/src/app/NotFound.tsx frontend/src/app/AddDataHost.tsx frontend/src/app/AddDataHost.test.tsx frontend/src/reports/ReportsPlaceholder.tsx frontend/src/maps/dataItems.ts frontend/src/maps/MapDataList.tsx frontend/src/maps/MapDataList.test.tsx frontend/src/app/AdoptionBanner.tsx frontend/src/app/AdoptionBanner.test.tsx frontend/src/settings/SourcesSection.tsx frontend/src/settings/SourcesSection.test.tsx
git commit -m "feat(shell): interim hosts - overview, findings, sections, jobs, Add data, the Maps data list" -m "Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 9: Route tables and redirects

**Files:**
- Create: `frontend/src/routes/Redirect.tsx`, `frontend/src/routes/legacyRedirects.tsx`, `frontend/src/routes/projectRoutes.tsx`, `frontend/src/routes/appRoutes.tsx`, `frontend/src/routes/tree.tsx`
- Modify: `frontend/src/app/lazyScreens.tsx` (take `ScreenPlaceholder` in from `KindRoute.tsx`)
- Test: `frontend/src/routes/routes.test.tsx`

**Interfaces:**
- Consumes: every interim host (Task 8); existing screens; `Shell` (still the old one until Task 10).
- Produces:
  ```ts
  export function Redirect({ to }: { to: (params: Params<string>) => string }): JSX.Element;
  export const legacyProjectRedirects: RouteObject[];   // relative to p/:projectId
  export const legacyAppRedirects: RouteObject[];
  export const projectRoutes: RouteObject[];            // S1, I, M, C, R edit entries here
  export const appRoutes: RouteObject[];                // S2 edits entries here
  export const routeTree: RouteObject[];
  export function ScreenPlaceholder(): JSX.Element;     // now in app/lazyScreens.tsx
  ```

- [ ] **Step 1: Write the failing test**

`frontend/src/routes/routes.test.tsx`:

```tsx
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { Navigate, RouterProvider, createMemoryRouter, matchRoutes } from "react-router-dom";
import { appRoutes } from "./appRoutes";
import { legacyAppRedirects, legacyProjectRedirects } from "./legacyRedirects";
import { routeTree } from "./tree";

const P = "7f1c2e3a-1111-4000-8000-000000000001";
const I = "10000000-5555-4000-8000-000000000001";

/** Every old path of spec section 5.3 and where it must land, query strings included. */
const CASES: [string, string][] = [
  ["/", "/projects"],
  [`/p/${P}`, `/p/${P}/overview`],
  ["/models", "/models/library"],
  [`/p/${P}/data`, `/p/${P}/images`],
  [`/p/${P}/edit/${I}`, `/p/${P}/images/${I}`],
  [`/p/${P}/edit/${I}?finding=f1`, `/p/${P}/images/${I}?finding=f1`],
  [`/p/${P}/label`, `/p/${P}/images?filter=unlabeled`],
  [`/p/${P}/past`, `/p/${P}/overview`],
  [`/p/${P}/past/maps/m1`, `/p/${P}/maps/m1`],
  [`/p/${P}/sources`, `/p/${P}/maps`],
  [`/p/${P}/surveys`, `/p/${P}/analytics`],
  [`/p/${P}/volumes`, `/p/${P}/measurements`],
  [`/p/${P}/volumes/v1`, `/p/${P}/measurements/v1`],
  [`/p/${P}/datasets`, `/models/datasets?project=${P}`],
  [`/p/${P}/datasets?dataset=d1`, `/models/datasets?dataset=d1&project=${P}`],
  [`/p/${P}/train`, "/models/training"],
  [`/p/${P}/train?job=j1`, "/models/training?job=j1"],
  ["/library", "/models/library"],
  ["/library?model=m1", "/models/library?model=m1"],
];

function land(start: string) {
  const models = appRoutes.find((r) => r.path === "models");
  const router = createMemoryRouter(
    [
      {
        path: "/",
        children: [
          { index: true, element: <Navigate to="/projects" replace /> },
          ...(models ? [models] : []),
          ...legacyAppRedirects,
          {
            path: "p/:projectId",
            children: [{ index: true, element: <Navigate to="overview" replace /> }, ...legacyProjectRedirects],
          },
          { path: "*", element: <p>landed</p> },
        ],
      },
    ],
    { initialEntries: [start] },
  );
  render(<RouterProvider router={router} />);
  return router;
}

const isRedirect = (route: unknown) =>
  [...legacyProjectRedirects, ...legacyAppRedirects].includes(route as (typeof legacyProjectRedirects)[number]);

describe("routes", () => {
  it.each(CASES)("%s lands on %s", async (from, to) => {
    const router = land(from);
    await screen.findByText("landed");
    const { pathname, search } = router.state.location;
    expect(`${pathname}${search}`).toBe(to);
  });

  it.each(CASES.map(([, to]) => to.split("?")[0]))("%s is a real screen in the tree", (path) => {
    const matches = matchRoutes(routeTree, path);
    expect(matches).not.toBeNull();
    const last = matches!.at(-1)!.route;
    expect(last.path).not.toBe("*");
    expect(isRedirect(last)).toBe(false);
  });

  it.each([
    `/p/${P}/overview`,
    `/p/${P}/images/${I}`,
    `/p/${P}/maps/m1`,
    `/p/${P}/clouds/c1`,
    `/p/${P}/findings/f1`,
    `/p/${P}/measurements/v1`,
    `/p/${P}/reports`,
    `/p/${P}/settings`,
    `/p/${P}/runs`,
    `/p/${P}/review`,
    `/p/${P}/analytics`,
    `/p/${P}/site-areas`,
    `/p/${P}/query`,
    `/p/${P}/export`,
    "/models/datasets/d1",
    "/models/training/r1",
    "/catalogue",
    "/catalogue/severity",
    "/jobs",
    "/settings",
    "/about",
  ])("routes %s", (path) => {
    const last = matchRoutes(routeTree, path)!.at(-1)!.route;
    expect(last.path).not.toBe("*");
  });

  it.each(["/nowhere", `/p/${P}/nonsense`, "/models/nothing"])("sends %s to the in-shell not-found page", (path) => {
    expect(matchRoutes(routeTree, path)!.at(-1)!.route.path).toBe("*");
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm -C frontend exec vitest run src/routes/routes.test.tsx`
Expected: FAIL, unresolved `./appRoutes`, `./legacyRedirects`, `./tree`.

- [ ] **Step 3: Write the implementation**

`frontend/src/routes/Redirect.tsx`:

```tsx
import { Navigate, useLocation, useParams, type Params } from "react-router-dom";

/**
 * Replaces an old address with its new one, keeping the old query string and hash (a toast's
 * `?job=`, a library `?model=`); query parameters named in `to` are added on top.
 */
export function Redirect({ to }: { to: (params: Params<string>) => string }) {
  const params = useParams();
  const { search, hash } = useLocation();
  const [path, query = ""] = to(params).split("?");
  const merged = new URLSearchParams(search);
  new URLSearchParams(query).forEach((value, key) => merged.set(key, value));
  const qs = merged.toString();
  return <Navigate to={`${path}${qs ? `?${qs}` : ""}${hash}`} replace />;
}
```

`frontend/src/routes/legacyRedirects.tsx`:

```tsx
import type { RouteObject } from "react-router-dom";
import { Redirect } from "./Redirect";

/** Old project addresses (spec 2026-09-26-foundation section 5.3), relative to `p/:projectId`. */
export const legacyProjectRedirects: RouteObject[] = [
  { path: "data", element: <Redirect to={(p) => `/p/${p.projectId}/images`} /> },
  { path: "edit/:imageId", element: <Redirect to={(p) => `/p/${p.projectId}/images/${p.imageId}`} /> },
  { path: "label", element: <Redirect to={(p) => `/p/${p.projectId}/images?filter=unlabeled`} /> },
  { path: "past", element: <Redirect to={(p) => `/p/${p.projectId}/overview`} /> },
  { path: "past/maps/:mapId", element: <Redirect to={(p) => `/p/${p.projectId}/maps/${p.mapId}`} /> },
  { path: "sources", element: <Redirect to={(p) => `/p/${p.projectId}/maps`} /> },
  { path: "surveys", element: <Redirect to={(p) => `/p/${p.projectId}/analytics`} /> },
  { path: "volumes", element: <Redirect to={(p) => `/p/${p.projectId}/measurements`} /> },
  {
    path: "volumes/:measurementId",
    element: <Redirect to={(p) => `/p/${p.projectId}/measurements/${p.measurementId}`} />,
  },
  { path: "datasets", element: <Redirect to={(p) => `/models/datasets?project=${p.projectId}`} /> },
  { path: "train", element: <Redirect to={() => "/models/training"} /> },
];

/** Old app addresses. */
export const legacyAppRedirects: RouteObject[] = [{ path: "library", element: <Redirect to={() => "/models/library"} /> }];
```

`frontend/src/routes/projectRoutes.tsx`:

```tsx
import type { RouteObject } from "react-router-dom";
import { InterimFindings, InterimOverview } from "@/app/InterimScreens";
import { CloudsScreen, Later, VolumesScreen } from "@/app/lazyScreens";
import { MapDataList } from "@/maps/MapDataList";
import { ReportsPlaceholder } from "@/reports/ReportsPlaceholder";
import { AnalyticsScreen } from "@/screens/AnalyticsScreen";
import { DataManagerScreen } from "@/screens/DataManagerScreen";
import { EditorScreen } from "@/screens/EditorScreen";
import { ExportScreen } from "@/screens/ExportScreen";
import { MapsScreen } from "@/screens/MapsScreen";
import { QueryScreen } from "@/screens/QueryScreen";
import { ReviewScreen } from "@/screens/ReviewScreen";
import { RunsScreen } from "@/screens/RunsScreen";
import { SettingsScreen } from "@/screens/SettingsScreen";
import { SiteAreasScreen } from "@/screens/SiteAreasScreen";

/**
 * The project routes, relative to `p/:projectId` (spec 2026-09-26-foundation section 5.3). S1, I,
 * M, C and R add or swap entries here only; `routes.tsx` and `routes/tree.tsx` stay SH's.
 */
export const projectRoutes: RouteObject[] = [
  { path: "overview", element: <InterimOverview /> },
  // Images: interim host, today's screens (I replaces them).
  { path: "images", element: <DataManagerScreen /> },
  { path: "images/:imageId", element: <EditorScreen /> },
  // Maps: interim Data-list host and today's viewer (M replaces them).
  { path: "maps", element: <MapDataList /> },
  { path: "maps/:mapId", element: <MapsScreen /> },
  // The 3D jump contract (spec 2026-09-23-point-clouds section 10), used unchanged by the
  // maps -> 3D jump, the 3D -> map jump and the Volumes screen's "View in 3D":
  //   /p/:projectId/clouds/:cloudId?at=x,y[&fp=x1,y1;x2,y2;x3,y3;x4,y4]
  //   /p/:projectId/maps/:mapId?at=x,y
  // Coordinates are in the DESTINATION's native CRS; the source screen converts them with
  // proj4 (both entities carry `proj4`), so the destination never knows where the caller came
  // from. `fp` is a box footprint's four corners. The screen reads them once per navigation.
  {
    path: "clouds",
    element: (
      <Later>
        <CloudsScreen />
      </Later>
    ),
  },
  {
    path: "clouds/:cloudId",
    element: (
      <Later>
        <CloudsScreen />
      </Later>
    ),
  },
  { path: "findings", element: <InterimFindings /> },
  { path: "findings/:findingId", element: <InterimFindings /> },
  // Measurements: interim host, today's Volumes screen.
  {
    path: "measurements",
    element: (
      <Later>
        <VolumesScreen />
      </Later>
    ),
  },
  {
    path: "measurements/:measurementId",
    element: (
      <Later>
        <VolumesScreen />
      </Later>
    ),
  },
  { path: "reports", element: <ReportsPlaceholder /> },
  { path: "settings", element: <SettingsScreen /> },
  // Secondary routes without a tab: the tab strip's More menu and the palette reach them.
  { path: "runs", element: <RunsScreen /> },
  { path: "review", element: <ReviewScreen /> },
  { path: "analytics", element: <AnalyticsScreen /> },
  { path: "site-areas", element: <SiteAreasScreen /> },
  { path: "query", element: <QueryScreen /> },
  { path: "export", element: <ExportScreen /> },
];
```

`frontend/src/routes/appRoutes.tsx`:

```tsx
import { Navigate, type RouteObject } from "react-router-dom";
import { InterimJobs } from "@/app/InterimJobs";
import { SectionPlaceholder } from "@/app/InterimScreens";
import { AboutScreen, Later } from "@/app/lazyScreens";
import { LibraryScreen } from "@/library/LibraryScreen";
import { AppSettingsScreen } from "@/screens/AppSettingsScreen";

const datasets = (
  <SectionPlaceholder title="Datasets" icon="datasets">
    Datasets built from the reviewed images of any project are listed here.
  </SectionPlaceholder>
);
const training = (
  <SectionPlaceholder title="Training" icon="train">
    Training runs on those datasets, and their results, are listed here.
  </SectionPlaceholder>
);
const catalogue = (
  <SectionPlaceholder title="Catalogue" icon="catalogue">
    The defect and object types your projects use, and the severity scale, are managed here.
  </SectionPlaceholder>
);

/** The app-level routes (spec 2026-09-26-foundation section 5.3). S2 adds or swaps entries here only. */
export const appRoutes: RouteObject[] = [
  { path: "models", element: <Navigate to="/models/library" replace /> },
  { path: "models/library", element: <LibraryScreen /> },
  { path: "models/datasets", element: datasets },
  { path: "models/datasets/:datasetId", element: datasets },
  { path: "models/training", element: training },
  { path: "models/training/:runId", element: training },
  { path: "catalogue", element: catalogue },
  { path: "catalogue/severity", element: catalogue },
  { path: "jobs", element: <InterimJobs /> },
  { path: "settings", element: <AppSettingsScreen /> },
  {
    path: "about",
    element: (
      <Later>
        <AboutScreen />
      </Later>
    ),
  },
];
```

`frontend/src/routes/tree.tsx`:

```tsx
import { Navigate, type RouteObject } from "react-router-dom";
import { NotFound } from "@/app/NotFound";
import { Shell } from "@/app/Shell";
import { ProjectsScreen } from "@/screens/ProjectsScreen";
import { appRoutes } from "./appRoutes";
import { legacyAppRedirects, legacyProjectRedirects } from "./legacyRedirects";
import { projectRoutes } from "./projectRoutes";

/** The whole route tree; `routes.tsx` makes the browser router from it, tests match against it. */
export const routeTree: RouteObject[] = [
  {
    path: "/",
    element: <Shell />,
    children: [
      { index: true, element: <Navigate to="/projects" replace /> },
      { path: "projects", element: <ProjectsScreen /> },
      ...appRoutes,
      ...legacyAppRedirects,
      {
        path: "p/:projectId",
        children: [
          { index: true, element: <Navigate to="overview" replace /> },
          ...projectRoutes,
          ...legacyProjectRedirects,
        ],
      },
      { path: "*", element: <NotFound /> },
    ],
  },
];
```

In `frontend/src/app/lazyScreens.tsx`: replace `import { ScreenPlaceholder } from "./KindRoute";` with `import { Skeleton } from "@/ui";` and add, above `Later`, the `ScreenPlaceholder` function moved verbatim from `app/KindRoute.tsx`:

```tsx
/** A screen-shaped placeholder while a screen's code is still loading. */
export function ScreenPlaceholder() {
  return (
    <div role="status" aria-label="Loading" className="flex max-w-3xl flex-col gap-3">
      <Skeleton className="h-6 w-48" />
      <Skeleton className="h-4 w-80 max-w-full" />
      <Skeleton className="h-40 w-full rounded-panel" />
    </div>
  );
}
```

In `app/KindRoute.tsx`, replace its own `ScreenPlaceholder` definition with `import { ScreenPlaceholder } from "./lazyScreens";` so it keeps compiling until Task 10 deletes it.

- [ ] **Step 4: Run it to verify it passes**

Run: `pnpm -C frontend exec vitest run src/routes/routes.test.tsx src/app/lazyScreens.test.tsx`
Expected: PASS (19 landing cases, 19 real-screen cases, 21 route cases, 3 not-found cases, 2 lazy screens).

- [ ] **Step 5: Commit**

```powershell
git add frontend/src/routes/Redirect.tsx frontend/src/routes/legacyRedirects.tsx frontend/src/routes/projectRoutes.tsx frontend/src/routes/appRoutes.tsx frontend/src/routes/tree.tsx frontend/src/routes/routes.test.tsx frontend/src/app/lazyScreens.tsx frontend/src/app/KindRoute.tsx
git commit -m "feat(routes): route tables for projects and app sections, redirects for every old address" -m "Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 10: Shell cutover and the old shell's deletion

**Files:**
- Modify: `frontend/src/app/Shell.tsx`, `frontend/src/app/Shell.test.tsx`, `frontend/src/routes.tsx`
- Delete: `frontend/src/app/Sidebar.tsx`, `Sidebar.test.tsx`, `Header.tsx`, `Header.test.ts`, `KindRoute.tsx`, `KindRoute.test.tsx`, `pipeline.ts`, `pipeline.test.ts`, `nextStep.ts`, `nextStep.test.ts`, `projectNextStep.ts`, `projectNextStep.test.ts`, `NextStepBar.tsx`, `NextStepBar.test.tsx`, `useProjectProgress.ts`, `useProjectProgress.test.tsx`, `useHomePreviews.ts`; `frontend/src/store/progress.ts`; `frontend/src/screens/HomeScreen.tsx` (+test), `LabelResolverScreen.tsx` (+test), `PastDetectionsScreen.tsx` (+test), `SourcesScreen.tsx` (+test), `DatasetsScreen.tsx` (+test), `TrainScreen.tsx` (+test); `frontend/src/sources/SourceTable.tsx`, `sourceRows.ts`, `sourceRows.test.ts`, `useSources.ts`, `SurveysRedirect.tsx`, `SurveysRedirect.test.tsx`; `frontend/src/maps/MoveMapDialog.tsx` (+test)

**Interfaces:**
- Consumes: `Rail` (3), `TopBar` (4), `ProjectTabs` (5), `PageTransition` (6), `Palette`, `usePaletteShortcut` (7), `AddDataHost` (8), `routeTree` (9), `routeInfo` (1).
- Produces: `export function Shell(): JSX.Element` (the layout route element); `export const router` in `routes.tsx` built from `routeTree`.

- [ ] **Step 1: Write the failing test**

Replace `frontend/src/app/Shell.test.tsx` whole:

```tsx
import { beforeEach, describe, expect, it } from "vitest";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { Route, Routes } from "react-router-dom";
import { useJobsStore } from "@/store/jobs";
import { exampleOverview, exampleProject, fakeClient, PROJECT_ID } from "@/test/fixtures";
import { renderWithProviders } from "@/test/render";
import { Shell } from "./Shell";

function renderShell(route: string, projectStatus = 200) {
  const { api } = fakeClient([
    {
      method: "GET",
      path: /\/projects\/[^/]+$/,
      status: projectStatus,
      body: projectStatus === 200 ? exampleProject : { error: { code: "project_upgrading", message: "upgrading", details: { job_id: "j1" } } },
    },
    { method: "GET", path: /\/overview$/, body: exampleOverview },
    { method: "GET", path: /\/jobs/, body: { items: [], next_cursor: null } },
    { method: "GET", path: /\/projects$/, body: { items: [exampleProject], next_cursor: null } },
  ]);
  return renderWithProviders(
    <Routes>
      <Route path="/" element={<Shell />}>
        <Route path="projects" element={<p>projects page</p>} />
        <Route path="models/library" element={<p>library page</p>} />
        <Route path="p/:projectId/images" element={<input aria-label="Filter" />} />
        <Route path="p/:projectId/maps/:mapId" element={<p>map surface</p>} />
      </Route>
    </Routes>,
    { api, route },
  );
}

describe("Shell", () => {
  beforeEach(() => useJobsStore.setState({ jobs: {}, panelOpen: false }));

  it("frames an app page with the rail and the top bar, and no project tabs", async () => {
    renderShell("/projects");
    expect(await screen.findByText("projects page")).toBeInTheDocument();
    expect(screen.getByRole("navigation", { name: "Main navigation" })).toBeInTheDocument();
    expect(screen.getByRole("banner")).toHaveTextContent("Projects");
    expect(screen.queryByRole("tablist")).toBeNull();
  });

  it("frames a project page with its name and the tabs", async () => {
    renderShell(`/p/${PROJECT_ID}/images`);
    const banner = screen.getByRole("banner");
    expect(await within(banner).findByRole("link", { name: exampleProject.name })).toBeInTheDocument();
    expect(within(banner).getByText("Images")).toBeInTheDocument();
    expect(screen.getByRole("tablist")).toBeInTheDocument();
  });

  it("hides the tabs on the full-bleed map and names the tab in the breadcrumb", async () => {
    renderShell(`/p/${PROJECT_ID}/maps/m1`);
    expect(await screen.findByText("map surface")).toBeInTheDocument();
    expect(screen.queryByRole("tablist")).toBeNull();
    expect(screen.getByRole("banner")).toHaveTextContent("Maps");
  });

  it("still renders a project that cannot be loaded, as 'Project'", async () => {
    renderShell(`/p/${PROJECT_ID}/images`, 409);
    await new Promise((r) => setTimeout(r, 30));
    expect(within(screen.getByRole("banner")).getByRole("link", { name: "Project" })).toBeInTheDocument();
    expect(screen.getByRole("tablist")).toBeInTheDocument();
  });

  it("opens the palette with Ctrl K typed into a field", async () => {
    renderShell(`/p/${PROJECT_ID}/images`);
    const field = await screen.findByLabelText("Filter");
    field.focus();
    fireEvent.keyDown(field, { key: "k", ctrlKey: true });
    await waitFor(() => expect(screen.getByRole("combobox")).toBeInTheDocument());
  });

  it("has no jobs button: the rail and the pill lead to Jobs", () => {
    renderShell("/projects");
    expect(screen.queryByRole("button", { name: /active jobs?$/ })).toBeNull();
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm -C frontend exec vitest run src/app/Shell.test.tsx`
Expected: FAIL: the old Shell renders the sidebar and header, not the rail and tabs (e.g. "Unable to find role tablist").

- [ ] **Step 3: Write the implementation**

Replace `frontend/src/app/Shell.tsx` whole:

```tsx
import { useEffect, useRef, useState } from "react";
import { Outlet, useLocation, useParams } from "react-router-dom";
import type { Project } from "@contract/client";
import { AgentDrawer } from "@/agent/AgentDrawer";
import { useAgentPanel } from "@/agent/panelStore";
import { useApi } from "@/api/client";
import { messageOf } from "@/api/errors";
import { fetchProject } from "@/api/project";
import { pushLog } from "@/app/diagnostics";
import { JobsPanel } from "@/jobs/JobsPanel";
import { useInitialJobs } from "@/jobs/useJobList";
import { Toaster, useJobToasts } from "@/ui";
import { AddDataHost } from "./AddDataHost";
import { PageTransition } from "./PageTransition";
import { Palette } from "./Palette";
import { ProjectTabs } from "./ProjectTabs";
import { Rail } from "./Rail";
import { routeInfo } from "./routeModel";
import { TopBar } from "./TopBar";
import { usePaletteShortcut } from "./usePaletteShortcut";

/** The open project, or null while loading and when it cannot be loaded (the chrome still renders). */
function useShellProject(projectId: string | undefined): Project | null {
  const api = useApi();
  const [loaded, setLoaded] = useState<Project | null>(null);
  useEffect(() => {
    if (!projectId) return;
    let cancelled = false;
    fetchProject(api, projectId)
      .then((p) => {
        if (!cancelled) setLoaded(p);
      })
      .catch((e: unknown) => pushLog(`load project failed: ${messageOf(e, String(e))}`));
    return () => {
      cancelled = true;
    };
  }, [api, projectId]);
  return loaded && loaded.id === projectId ? loaded : null;
}

/**
 * The app shell (spec 2026-09-26-foundation section 5.1): the rail, then a column of the top bar,
 * the project tabs (not on full-bleed surfaces) and the page, entering through PageTransition.
 */
export function Shell() {
  const agent = useAgentPanel();
  const { projectId } = useParams();
  const { pathname } = useLocation();
  const info = routeInfo(pathname);
  const project = useShellProject(projectId);
  const [paletteOpen, setPaletteOpen] = usePaletteShortcut();
  useInitialJobs(projectId ?? "");
  // Read when a job ends: a toast is skipped on the screen that already reports that job.
  const pathnameRef = useRef(pathname);
  useEffect(() => {
    pathnameRef.current = pathname;
  }, [pathname]);
  useJobToasts(projectId, pathnameRef);
  const bare = info.layout !== "page";

  return (
    <div className="grid h-full w-full grid-cols-[64px_minmax(0,1fr)] text-ink">
      <Rail projectId={projectId} />
      <div className="relative flex min-w-0 flex-col">
        <TopBar projectId={projectId} projectName={project?.name ?? null} onOpenPalette={() => setPaletteOpen(true)} />
        {projectId && info.layout !== "fullbleed" && <ProjectTabs projectId={projectId} />}
        <main
          className={
            bare
              ? "flex min-h-0 flex-1 flex-col overflow-hidden"
              : "flex min-h-0 flex-1 flex-col overflow-auto px-5 py-4 lg:px-6 lg:py-5"
          }
        >
          <PageTransition>
            <Outlet />
          </PageTransition>
        </main>
        {/* Kept until the Jobs section replaces it: toasts' "Show log" and re-imports open it. */}
        {projectId && <JobsPanel projectId={projectId} />}
        <AgentDrawer
          projectId={projectId}
          projectName={project?.name ?? null}
          open={agent.open}
          onClose={() => agent.setOpen(false)}
        />
        <AddDataHost project={project} />
      </div>
      <Palette open={paletteOpen} onClose={() => setPaletteOpen(false)} project={project} />
      <Toaster />
    </div>
  );
}
```

Replace `frontend/src/routes.tsx` whole:

```tsx
import { createBrowserRouter } from "react-router-dom";
import { routeTree } from "@/routes/tree";

/** The app's router. Routes live in `routes/`: S1 and S2 add entries to its two table files only. */
export const router = createBrowserRouter(routeTree);
```

Delete the old shell and the screens the new route map no longer routes:

```powershell
cd E:\Dev\Yolo\app\.claude\worktrees\f-sh
git rm frontend/src/app/Sidebar.tsx frontend/src/app/Sidebar.test.tsx frontend/src/app/Header.tsx frontend/src/app/Header.test.ts frontend/src/app/KindRoute.tsx frontend/src/app/KindRoute.test.tsx frontend/src/app/pipeline.ts frontend/src/app/pipeline.test.ts frontend/src/app/nextStep.ts frontend/src/app/nextStep.test.ts frontend/src/app/projectNextStep.ts frontend/src/app/projectNextStep.test.ts frontend/src/app/NextStepBar.tsx frontend/src/app/NextStepBar.test.tsx frontend/src/app/useProjectProgress.ts frontend/src/app/useProjectProgress.test.tsx frontend/src/app/useHomePreviews.ts frontend/src/store/progress.ts
git rm frontend/src/screens/HomeScreen.tsx frontend/src/screens/HomeScreen.test.tsx frontend/src/screens/LabelResolverScreen.tsx frontend/src/screens/LabelResolverScreen.test.tsx frontend/src/screens/PastDetectionsScreen.tsx frontend/src/screens/PastDetectionsScreen.test.tsx frontend/src/screens/SourcesScreen.tsx frontend/src/screens/SourcesScreen.test.tsx frontend/src/screens/DatasetsScreen.tsx frontend/src/screens/DatasetsScreen.test.tsx frontend/src/screens/TrainScreen.tsx frontend/src/screens/TrainScreen.test.tsx
git rm frontend/src/sources/SourceTable.tsx frontend/src/sources/sourceRows.ts frontend/src/sources/sourceRows.test.ts frontend/src/sources/useSources.ts frontend/src/sources/SurveysRedirect.tsx frontend/src/sources/SurveysRedirect.test.tsx frontend/src/maps/MoveMapDialog.tsx frontend/src/maps/MoveMapDialog.test.tsx
```

Then find anything still importing a deleted module:

```powershell
Get-ChildItem -Recurse frontend\src -Include *.ts,*.tsx | Select-String -Pattern 'app/(Sidebar|Header|KindRoute|pipeline|nextStep|projectNextStep|NextStepBar|useProjectProgress|useHomePreviews)"|store/progress"|screens/(HomeScreen|LabelResolverScreen|PastDetectionsScreen|SourcesScreen|DatasetsScreen|TrainScreen)"|sources/(SourceTable|sourceRows|useSources|SurveysRedirect)"|MoveMapDialog"' | ForEach-Object { "$($_.Path):$($_.LineNumber): $($_.Line.Trim())" }
```

Expected: no line. For `api/adoption.ts`, delete `moveMap`, `fetchDetectionProjects` and `createDetectionProject` (their only caller was `MoveMapDialog`) and the imports only they used; in `api/adoption.test.ts` delete the tests of those three functions (the `describe`/`it` blocks naming them) and the now-unused imports.

- [ ] **Step 4: Run the unit suite and the build**

Run: `pnpm -C frontend test; pnpm -C frontend build`
Expected: vitest passes except the tests of screens that still branch on kind (`ReviewScreen`, `ReviewScreenIds`, `DataManagerScreen`, `ExportScreen`, `ProjectsScreen`, `DetectReview`, `SelectionBar`, `MapsScreen` if it imports `MoveMapDialog`), which still import `useProjectKind` and pass because that file still exists; build ok. Any other failure is a missed import: fix it in this task.

- [ ] **Step 5: Commit**

```powershell
git add frontend/src/app/Shell.tsx frontend/src/app/Shell.test.tsx frontend/src/routes.tsx frontend/src/api/adoption.ts frontend/src/api/adoption.test.ts
git commit -m "feat(shell): switch to the rail, top bar, tabs and palette; delete the kind sidebar and the unrouted screens" -m "Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

(The `git rm` lines already staged the deletions.)

---

### Task 10b: The `?` shortcut sheet

**Files:**
- Create: `frontend/src/app/ShortcutSheet.tsx`, `frontend/src/app/ShortcutSheet.test.tsx`
- Modify: `frontend/src/app/Shell.tsx` (one mount line next to `<Palette …/>`)

**Interfaces:**
- Consumes: DS `keysFor(scope: WorkspaceScope | null): KeyEntry[]`, `formatChord(chord): string[]`, `isTypingTarget(target)`, `type WorkspaceScope` from `@/ui/keymap`; DS `Dialog`, `Kbd`; `routeInfo` (Task 1).
- Produces: `ShortcutSheet()` (self-contained: listens for `?`, reads the scope from the URL); `sheetScope(info: RouteInfo): WorkspaceScope | null` (`images` / `maps` / `clouds` on those tabs, else `null`). No new key: `?` is DS's `GLOBAL_KEYS` entry `shortcuts`.

- [ ] **Step 1: Write the failing test**

`frontend/src/app/ShortcutSheet.test.tsx`:

```tsx
import { describe, expect, it } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { keysFor } from "@/ui/keymap";
import { routeInfo } from "./routeModel";
import { ShortcutSheet, sheetScope } from "./ShortcutSheet";

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <input aria-label="Name" />
      <ShortcutSheet />
    </MemoryRouter>,
  );
}

describe("ShortcutSheet (F §5.6: rendered from DS's keymap table)", () => {
  it("opens on ? with every entry of the scope's table, and closes on Escape", () => {
    renderAt("/p/p1/maps/m1");
    fireEvent.keyDown(window, { key: "?", shiftKey: true });
    const sheet = screen.getByRole("dialog", { name: "Keyboard shortcuts" });
    const rows = within(sheet).getAllByRole("row").slice(1); // header row first
    expect(rows).toHaveLength(keysFor("maps").length);
    expect(within(sheet).getByText("Command palette")).toBeInTheDocument();
    fireEvent.keyDown(sheet, { key: "Escape" });
    expect(screen.queryByRole("dialog", { name: "Keyboard shortcuts" })).toBeNull();
  });

  it("does not open while typing in a field", () => {
    renderAt("/projects");
    fireEvent.keyDown(screen.getByLabelText("Name"), { key: "?", shiftKey: true });
    expect(screen.queryByRole("dialog", { name: "Keyboard shortcuts" })).toBeNull();
  });

  it("uses the workspace scope of the tab", () => {
    expect(sheetScope(routeInfo("/p/p1/images/i1"))).toBe("images");
    expect(sheetScope(routeInfo("/p/p1/clouds"))).toBe("clouds");
    expect(sheetScope(routeInfo("/p/p1/overview"))).toBeNull();
    expect(sheetScope(routeInfo("/catalogue"))).toBeNull();
  });
});
```

Run: `pnpm -C frontend exec vitest run src/app/ShortcutSheet.test.tsx`
Expected: FAIL, `./ShortcutSheet` does not resolve.

- [ ] **Step 2: Implement it**

`frontend/src/app/ShortcutSheet.tsx`:

```tsx
import { useEffect, useState } from "react";
import { useLocation } from "react-router-dom";
import { Dialog, Kbd } from "@/ui";
import { formatChord, isTypingTarget, keysFor, type WorkspaceScope } from "@/ui/keymap";
import { routeInfo, type RouteInfo } from "./routeModel";

const WORKSPACE_TABS: readonly WorkspaceScope[] = ["images", "maps", "clouds"];

export function sheetScope(info: RouteInfo): WorkspaceScope | null {
  return info.tab && (WORKSPACE_TABS as readonly string[]).includes(info.tab) ? (info.tab as WorkspaceScope) : null;
}

/** The `?` sheet (spec 2026-09-26-foundation section 5.6): DS's keymap table for this screen. */
export function ShortcutSheet() {
  const { pathname } = useLocation();
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "?" || e.ctrlKey || e.metaKey || e.altKey || e.defaultPrevented) return;
      if (isTypingTarget(e.target)) return;
      e.preventDefault();
      setOpen(true);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  const entries = keysFor(sheetScope(routeInfo(pathname)));
  return (
    <Dialog open={open} title="Keyboard shortcuts" onClose={() => setOpen(false)} width="lg">
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-xs text-muted">
            <th className="py-1 pr-4 font-medium">Keys</th>
            <th className="py-1 font-medium">Action</th>
          </tr>
        </thead>
        <tbody>
          {entries.map((e) => (
            <tr key={`${e.scope}:${e.action}`} className="border-t border-line">
              <td className="py-1.5 pr-4">
                <span className="inline-flex flex-wrap gap-1">
                  {e.keys.map((chord) => (
                    <span key={chord} className="inline-flex gap-0.5">
                      {formatChord(chord).map((part) => (
                        <Kbd key={part}>{part}</Kbd>
                      ))}
                    </span>
                  ))}
                </span>
              </td>
              <td className="py-1.5">{e.help}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </Dialog>
  );
}
```

In `frontend/src/app/Shell.tsx`, import `ShortcutSheet` from `./ShortcutSheet` and add
`<ShortcutSheet />` on the line after `<Palette open={paletteOpen} … />`.

Run: `pnpm -C frontend exec vitest run src/app/ShortcutSheet.test.tsx src/app/Shell.test.tsx`
Expected: PASS. If DS's `Dialog` names itself differently than by `title`, use the name it renders;
the test asserts the role and the rows.

- [ ] **Step 3: Commit**

```powershell
pnpm -C frontend lint
git add frontend/src/app/ShortcutSheet.tsx frontend/src/app/ShortcutSheet.test.tsx frontend/src/app/Shell.tsx
git commit -m "feat(shell): the ? shortcut sheet renders the app keymap for this screen" -m "Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 11: No project kind in the screens (spec §6.2), Label next and Use in dataset

**Files:**
- Create: `frontend/src/data/labelNext.ts`, `frontend/src/data/labelNext.test.ts`, `frontend/src/review/reviewView.ts`, `frontend/src/review/reviewView.test.ts`
- Modify: `frontend/src/screens/DataManagerScreen.tsx` (+test), `frontend/src/data/SelectionBar.tsx` (+test), `frontend/src/screens/ReviewScreen.tsx`, `ReviewScreen.test.tsx`, `ReviewScreenIds.test.tsx`, `frontend/src/review/DetectReview.tsx` (+test), `frontend/src/screens/ExportScreen.tsx` (+test), `frontend/src/screens/ProjectsScreen.tsx` (+test), `frontend/src/test/fixtures.ts`, `frontend/src/agent/useSetupAgent.ts`, `frontend/src/agent/SetupAgent.test.tsx`
- Delete: `frontend/src/app/useProjectKind.ts`, `useProjectKind.test.tsx`, `frontend/src/data/AddToDatasetDialog.tsx`, `AddToDatasetDialog.test.tsx`, and C0's kind shim `frontend/src/api/legacyKind.ts`, `frontend/src/api/legacyKind.test.ts` (the index: SH deletes it)
- Modify: `frontend/src/api/adoption.ts` (+test) (what Task 10 left of it: drop `legacyKind`/`legacyCreateBody`)
- Modify (retire `moveMapToProject`): `contract/openapi.yaml`, `contract/client/schema.d.ts` (regenerated), `backend/tests/test_contract.py`, `backend/tests/test_foundation_contract.py`

**Interfaces:**
- Consumes: `useAddData` (Task 2); C0's `@/api/legacyKind` (`legacyKind`, `withLegacyKind`, `legacyCreateBody`), which this task removes with every importer; `fetchImagePage`, `IMAGE_PAGE_SIZE`, `toImageParams`, `DEFAULT_QUERY`, `useNavigationStore` (existing).
- Produces:
  ```ts
  export type LabelNext = { imageId: string } | "all-labeled" | "no-images";
  export async function labelNext(api: ApiClient, projectId: string): Promise<LabelNext>;
  export type ReviewView = "suggestions" | "runs";
  export function reviewView(params: URLSearchParams): ReviewView;
  ```
  URL contract for S2: `/models/datasets?new=1&project=<projectId>` opens the dataset builder with that project preselected.

- [ ] **Step 1: Write the failing tests**

`frontend/src/data/labelNext.test.ts`:

```ts
import { beforeEach, describe, expect, it } from "vitest";
import { useNavigationStore } from "@/store/navigation";
import { exampleImagePage, fakeClient, IMAGE_ID, PROJECT_ID } from "@/test/fixtures";
import { labelNext } from "./labelNext";

const empty = { items: [], next_cursor: null, total: 0 };

describe("labelNext", () => {
  beforeEach(() => useNavigationStore.getState().setContext([], null));

  it("opens the first unlabeled image with the unlabeled ones as the editor's walk", async () => {
    const { api, requests } = fakeClient([{ method: "GET", path: /\/images$/, body: exampleImagePage }]);
    expect(await labelNext(api, PROJECT_ID)).toEqual({ imageId: IMAGE_ID });
    expect(new URL(`http://x${requests[0].url}`).searchParams.get("labeled")).toBe("false");
    const nav = useNavigationStore.getState();
    expect(nav.ids[0]).toBe(IMAGE_ID);
    expect(nav.returnTo).toBe(`/p/${PROJECT_ID}/images`);
  });

  it("says all-labeled when images exist but none needs labels", async () => {
    let call = 0;
    const { api } = fakeClient([{ method: "GET", path: /\/images$/, body: () => (call++ === 0 ? empty : exampleImagePage) }]);
    expect(await labelNext(api, PROJECT_ID)).toBe("all-labeled");
  });

  it("says no-images for an empty project and on a failure", async () => {
    expect(await labelNext(fakeClient([{ method: "GET", path: /\/images$/, body: empty }]).api, PROJECT_ID)).toBe("no-images");
    expect(await labelNext(fakeClient([]).api, PROJECT_ID)).toBe("no-images");
  });
});
```

`frontend/src/review/reviewView.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { reviewView } from "./reviewView";

const v = (q: string) => reviewView(new URLSearchParams(q));

describe("reviewView", () => {
  it("defaults to image suggestions", () => expect(v("")).toBe("suggestions"));
  it("follows ?view=", () => {
    expect(v("view=runs")).toBe("runs");
    expect(v("view=suggestions")).toBe("suggestions");
  });
  it("shows runs for a ?source= link", () => expect(v("source=s1")).toBe("runs"));
  it("always shows suggestions for a run's ?ids= link", () => expect(v("ids=a,b&view=runs")).toBe("suggestions"));
});
```

In `frontend/src/data/SelectionBar.test.tsx`: add at the top

```tsx
import { Route, Routes, useLocation } from "react-router-dom";

function Where() {
  return <p data-testid="where">{useLocation().pathname + useLocation().search}</p>;
}
```

change `renderBar` so it renders `<Routes><Route path="*" element={<><SelectionBar … /><Where /></>} /></Routes>` (same props as today minus `labeledCount` and `unlabeledCount`), replace the two kind tests (the `it` blocks titled "offers only its own kind's actions…" and "a detection project's selection runs a model…") with

```tsx
  it("offers every action on any project: label, run a model and use in a dataset", () => {
    renderBar(fakeClient([]).api);
    expect(screen.getByRole("button", { name: "Label selected" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Run model" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Use in dataset…" })).toBeInTheDocument();
  });

  it("takes the selection's project to the Models dataset builder", () => {
    renderBar(fakeClient([]).api);
    fireEvent.click(screen.getByRole("button", { name: "Use in dataset…" }));
    expect(screen.getByTestId("where")).toHaveTextContent(`/models/datasets?new=1&project=${PROJECT_ID}`);
  });
```

and in the test titled "hands label and run-model to the screen, opens the dataset dialog and deletes after confirmation" delete the four lines from `fireEvent.click(screen.getByRole("button", { name: "Add to dataset" }));` to `expect(screen.queryByRole("dialog")).not.toBeInTheDocument();` and retitle it "hands label and run-model to the screen and deletes after confirmation".

In `frontend/src/screens/DataManagerScreen.test.tsx`: delete the `useProjectKindStore` import and its `beforeEach` line; delete the test "does not point a detection project at Datasets"; in "says every image is labeled…" replace the link assertion with

```tsx
    expect(screen.getByRole("link", { name: "Build a dataset" })).toHaveAttribute(
      "href",
      `/models/datasets?new=1&project=${PROJECT_ID}`,
    );
```

and the two text lookups `"Every image is labeled. Create a dataset next."` with `"Every image is labeled. Build a dataset from them in Models."`; and add

```tsx
  it("lists only unlabeled images when opened with ?filter=unlabeled", async () => {
    const requests = renderScreen(`/p/${PROJECT_ID}/images?filter=unlabeled`);
    await screen.findByRole("list", { name: "Images" });
    const url = new URL(`http://x${requests.find((r) => r.url.includes("/images?"))!.url}`);
    expect(url.searchParams.get("labeled")).toBe("false");
  });

  it("Label next opens the first unlabeled image", async () => {
    renderScreen(`/p/${PROJECT_ID}/images`);
    fireEvent.click(await screen.findByRole("button", { name: "Label next" }));
    expect(await screen.findByTestId("editor-route")).toBeInTheDocument();
  });
```

For these two, `renderScreen` must return the fake client's `requests` and mount a route `p/:projectId/images/:imageId` rendering `<p data-testid="editor-route" />` next to the screen's route; change the screen's route path from `p/:projectId/data` to `p/:projectId/images` and every `renderScreen(\`/p/${PROJECT_ID}/data…\`)` to `/images…`.

In `frontend/src/screens/ReviewScreen.test.tsx`: delete the `useProjectKindStore` import and both `useProjectKindStore` lines; replace the first test with

```tsx
  it("with nothing to review, says where suggestions come from", async () => {
    const { api } = fakeClient([
      { method: "GET", path: /\/images$/, body: { items: [], next_cursor: null, total: 0 } },
      { method: "GET", path: /\/sources$/, body: { items: [], next_cursor: null } },
    ]);
    renderWithProviders(
      <Routes>
        <Route path="/p/:projectId/review" element={<ReviewScreen />} />
      </Routes>,
      { api, route: `/p/${PROJECT_ID}/review` },
    );
    const empty = await screen.findByTestId("review-empty");
    expect(empty).toHaveTextContent("Suggestions appear here after a detection run");
    expect(screen.getByRole("link", { name: "Detect screen" })).toBeInTheDocument();
  });

  it("switches between image suggestions and detection runs", async () => {
    const { api } = fakeClient([
      { method: "GET", path: /\/images$/, body: { items: [], next_cursor: null, total: 0 } },
      { method: "GET", path: /\/sources$/, body: { items: [], next_cursor: null } },
    ]);
    renderWithProviders(
      <Routes>
        <Route path="/p/:projectId/review" element={<ReviewScreen />} />
      </Routes>,
      { api, route: `/p/${PROJECT_ID}/review` },
    );
    fireEvent.click(await screen.findByRole("radio", { name: "Detection runs" }));
    expect(await screen.findByText("Nothing to review yet")).toBeInTheDocument();
  });
```

In `frontend/src/screens/ReviewScreenIds.test.tsx`: delete the import, the `beforeEach`, and the `useProjectKindStore.getState().set(PROJECT_ID, "detect");` line; retitle "in a detection project, a detection run's link…" to "a detection run's link narrows the queue to its images".

In `frontend/src/review/DetectReview.test.tsx`: delete the import and the whole `beforeEach` that sets the kind; change `renderScreen`'s default route to `` `/p/${PROJECT_ID}/review?view=runs` ``; in the test asserting the link "Add photos or a map", replace that assertion with `expect(screen.getByRole("button", { name: "Add data" })).toBeInTheDocument();`.

In `frontend/src/screens/ExportScreen.test.tsx`: delete the `useProjectKindStore` import and its `beforeEach` line; delete the test "shows neither kind's section while the project kind is still loading"; unwrap the `describe("in a detection project", …)` block (delete its `describe` line, its `beforeEach` line and its closing `});`), retitle its test "shows the counts export and the model export together", and in it change `expect(screen.queryByRole("heading", { name: "Model for other applications" })).not.toBeInTheDocument();` to `expect(screen.getByRole("heading", { name: "Model for other applications" })).toBeInTheDocument();`. In the first test, change the expected href `"/library"` to `"/models/library"`.

In `frontend/src/screens/ProjectsScreen.test.tsx`: delete the three `it` blocks "creates a training project by default, with the class list", "choosing Detection hides the class editor and sends kind detect with no classes" and "shows each project's kind and filters the list by kind"; add

```tsx
  it("creates a project from a name and a folder, with no kind, and opens its Overview", async () => {
    const { api, requests } = fakeClient([
      emptyList,
      { method: "POST", path: /\/projects$/, status: 201, body: exampleProject },
    ]);
    renderWithProviders(
      <Routes>
        <Route path="/" element={<ProjectsScreen />} />
        <Route path="/p/:projectId/overview" element={<p>overview route</p>} />
      </Routes>,
      { api },
    );
    expect(screen.queryByRole("radio", { name: "Training project" })).toBeNull();
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Site A" } });
    fireEvent.change(screen.getAllByLabelText("Folder")[0], { target: { value: "E:\\Projects\\A" } });
    fireEvent.click(screen.getByRole("button", { name: "Create project" }));
    expect(await screen.findByText("overview route")).toBeInTheDocument();
    expect(requests.find((r) => r.method === "POST")?.body).toEqual({
      name: "Site A",
      folder: "E:\\Projects\\A",
      type_ids: [],
    });
  });

  it("lists projects without a kind label or filter", async () => {
    const { api } = fakeClient([{ method: "GET", path: /\/projects$/, body: { items: [exampleProject], next_cursor: null } }]);
    renderWithProviders(<ProjectsScreen />, { api });
    expect(await screen.findByText(exampleProject.name)).toBeInTheDocument();
    expect(screen.queryByRole("radiogroup", { name: "Show projects" })).toBeNull();
    expect(screen.queryByText("Training")).toBeNull();
    expect(screen.queryByText("Detection")).toBeNull();
  });
```

(add `import { Route, Routes } from "react-router-dom";`).

- [ ] **Step 2: Run them to verify they fail**

Run: `pnpm -C frontend exec vitest run src/data src/review src/screens/ReviewScreen.test.tsx src/screens/ReviewScreenIds.test.tsx src/screens/DataManagerScreen.test.tsx src/screens/ExportScreen.test.tsx src/screens/ProjectsScreen.test.tsx`
Expected: FAIL: unresolved `./labelNext`, `./reviewView`; missing "Use in dataset…", "Label next", "Detection runs"; the POST body still has `kind` (or `classes`).

- [ ] **Step 3: Write the implementation**

`frontend/src/data/labelNext.ts`:

```ts
import type { ApiClient } from "@contract/client";
import { messageOf } from "@/api/errors";
import { fetchImagePage, IMAGE_PAGE_SIZE } from "@/api/images";
import { pushLog } from "@/app/diagnostics";
import { useNavigationStore } from "@/store/navigation";
import { DEFAULT_QUERY, toImageParams } from "./listModel";

export type LabelNext = { imageId: string } | "all-labeled" | "no-images";

/**
 * The Images tab's "Label next" (was the Label step): the first image that still needs labels,
 * with the unlabeled page as the editor's Next / Previous walk. One bounded page.
 */
export async function labelNext(api: ApiClient, projectId: string): Promise<LabelNext> {
  const unlabeled = toImageParams(
    { ...DEFAULT_QUERY, filters: { ...DEFAULT_QUERY.filters, labeled: "no" } },
    IMAGE_PAGE_SIZE,
  );
  try {
    const page = await fetchImagePage(api, projectId, unlabeled);
    if (page.items.length > 0) {
      const ids = page.items.map((i) => i.id);
      useNavigationStore.getState().setContext(ids, "data", `/p/${projectId}/images`);
      return { imageId: ids[0] };
    }
    const any = await fetchImagePage(api, projectId, toImageParams(DEFAULT_QUERY, 1));
    return any.items.length > 0 ? "all-labeled" : "no-images";
  } catch (e) {
    pushLog(`label next failed: ${messageOf(e, String(e))}`);
    return "no-images";
  }
}
```

`frontend/src/review/reviewView.ts`:

```ts
export type ReviewView = "suggestions" | "runs";

/**
 * Which review `/review` shows (spec 2026-09-26-foundation section 6.2: both, for any project):
 * a run's `?ids=` always narrows the image queue; `?view=` picks; a `?source=` link means runs.
 */
export function reviewView(params: URLSearchParams): ReviewView {
  if (params.get("ids")) return "suggestions";
  const view = params.get("view");
  if (view === "runs" || view === "suggestions") return view;
  return params.get("source") ? "runs" : "suggestions";
}
```

`frontend/src/screens/ReviewScreen.tsx`: remove the `useProjectKind` import; replace `ReviewScreen` with

```tsx
export function ReviewScreen() {
  const { projectId = "" } = useParams();
  const [params, setParams] = useSearchParams();
  const view = reviewView(params);
  return (
    <div className="flex h-full min-h-0 flex-col gap-3">
      <Segmented
        label="What to review"
        size="sm"
        className="self-end"
        value={view}
        onChange={(next: ReviewView) => setParams(new URLSearchParams({ view: next }))}
        options={[
          { value: "suggestions", label: "Image suggestions" },
          { value: "runs", label: "Detection runs" },
        ]}
      />
      {view === "runs" ? <DetectReview projectId={projectId} /> : <SuggestionReview projectId={projectId} />}
    </div>
  );
}
```

(imports: `Segmented` from `@/ui`, `reviewView, type ReviewView` from `@/review/reviewView`); change `SuggestionReview`'s signature to `({ projectId }: { projectId: string })` and replace its `{kind === "train" ? (…) : (<>…</>)}` with the detection branch's fragment (the one mentioning the "Detect screen" link and the "Project settings" link). Update the doc comment to "Review: image suggestions or detection runs, for any project; a run's `?ids=` link narrows the image queue."

`frontend/src/review/DetectReview.tsx`: replace the `<Link to={\`/p/${projectId}/sources\`} …>Add photos or a map</Link>.` in the empty state with

```tsx
          <Button size="sm" icon="plus" onClick={() => useAddData.getState().show(null)}>
            Add data
          </Button>
```

(imports: `Button` from `@/ui`, `useAddData` from `@/app/addDataStore`; drop `Link`/`linkClass` if now unused).

`frontend/src/screens/ExportScreen.tsx`: remove the `useProjectKind` import and `const kind = …`; render the `DetectExportForm` fragment and the "Model for other applications" section unconditionally (delete the `kind === "detect" &&` and `kind === "train" &&` guards and their wrapping braces); change the library link to `to="/models/library"`.

`frontend/src/data/SelectionBar.tsx`: remove the `ProjectKind` import, the `AddToDatasetDialog` import, the `kind`, `labeledCount` and `unlabeledCount` props (interface, destructuring, doc lines) and the `"dataset"` member of the `mode` union and its `{mode === "dataset" && (…)}` block; remove the three `kind !== …` guards so Label selected, Run model and the dataset button always render; replace the "Add to dataset" button with

```tsx
          <Button
            size="sm"
            className={onInverse}
            onClick={() => void navigate(`/models/datasets?new=1&project=${projectId}`)}
            disabled={busy}
            title="Open the dataset builder in Models with this project"
          >
            Use in dataset…
          </Button>
```

(add `const navigate = useNavigate();` from `react-router-dom`).

`frontend/src/screens/DataManagerScreen.tsx`:
- remove the `useProjectKind` import and `const kind = useProjectKind(projectId);`;
- add `const api = useApi();` (import from `@/api/client` if missing) and `import { labelNext } from "@/data/labelNext";`, `DEFAULT_FILTERS` to the `@/data/listModel` import;
- initial query honours `?filter=unlabeled`:
  ```tsx
  const [query, setQuery] = useState<ListQuery>(() =>
    searchParams.get("filter") === "unlabeled"
      ? { ...DEFAULT_QUERY, filters: { ...DEFAULT_FILTERS, labeled: "no" } }
      : DEFAULT_QUERY,
  );
  ```
- `open` and `labelSelected`: `setContext(ids, "data", \`/p/${projectId}/images\`)` and `navigate(\`/p/${projectId}/images/${id}\`)` (both places);
- add the Label next button before `<ShortcutsButton />`:
  ```tsx
  const [nexting, setNexting] = useState(false);
  const onLabelNext = () => {
    setNexting(true);
    void labelNext(api, projectId).then((next) => {
      setNexting(false);
      if (next === "all-labeled") setAllLabeled(true);
      else if (next !== "no-images") void navigate(`/p/${projectId}/images/${next.imageId}`);
    });
  };
  // …
  <Button icon="label" onClick={onLabelNext} loading={nexting}>
    Label next
  </Button>
  ```
- the all-labeled alert: drop `&& kind !== "detect"`; its action becomes
  ```tsx
  <Link to={`/models/datasets?new=1&project=${projectId}`} className={buttonClass("secondary", "sm")}>
    Build a dataset
  </Link>
  ```
  and its text `Every image is labeled. Build a dataset from them in Models.`;
- the `SelectionBar` call: drop `kind={kind}`, `labeledCount=…` and `unlabeledCount=…`, and delete the then-unused `selectedLabeledCount` and `selectedUnlabeledCount` memos.

`frontend/src/screens/ProjectsScreen.tsx`:
- delete `useProjectKindStore`/`ProjectKind` import, `KindFilter`, `KIND_PILL`, `DEFAULT_CLASSES`, `CLASS_COLOURS`, `parseClasses`, the `classes`, `kind` and `filter` state, `shown` (render `projects` directly) and `classNames`;
- `openProject`: delete the kind-store line; navigate to `` `/p/${project.id}/overview` ``;
- `onCreate` body: `body: { name, folder, type_ids: [] }`;
- delete the list's `Segmented` "Show projects", the "No … projects in the list." branch and the kind `Pill`;
- in the create form delete the "Kind of project" `Segmented` and its description paragraph, the `kind === "train"` guard around "Plan with the setup agent" (keep the button), and the whole class-list block (`{kind === "train" ? (…) : null}`);
- intro copy: `A project is a folder on disk. It holds a site's photos, maps, elevation models and point clouds, and the findings made on them.`;
- drop now-unused imports (`ClassDefInput`, `Disclosure`, `Pill`, `Segmented`, `Textarea`, `useMemo`).

`frontend/src/test/fixtures.ts`, `frontend/src/agent/useSetupAgent.ts`, `frontend/src/agent/SetupAgent.test.tsx`: delete any remaining `kind: "train",` / `kind: "detect",` line that belongs to a **project** object (fixtures line near `exampleProject`, the setup agent's `POST /projects` body and its test's expected body). If C0 already removed them, nothing to do.

C0's kind shim `@/api/legacyKind` goes now (the index: SH deletes it). In every remaining importer
(`useSetupAgent.ts`, what Task 10 left of `api/adoption.ts`, `ProjectsScreen.tsx`, and any test using
`withLegacyKind`):
- `legacyCreateBody(name, folder, …)` → `{ name, folder, type_ids: [] }` (the contract's `ProjectCreate`);
- `legacyKind(p) === "detect"` / `=== "train"` branches → the union (both behaviours), as for `kind` above;
- `withLegacyKind(project, …)` in a test → `project`.

Delete:

```powershell
git rm frontend/src/app/useProjectKind.ts frontend/src/app/useProjectKind.test.tsx frontend/src/data/AddToDatasetDialog.tsx frontend/src/data/AddToDatasetDialog.test.tsx frontend/src/api/legacyKind.ts frontend/src/api/legacyKind.test.ts
```

- [ ] **Step 4: Run the grep gate and the tests**

```powershell
cd E:\Dev\Yolo\app\.claude\worktrees\f-sh\frontend
Get-ChildItem -Recurse src, e2e -Include *.ts,*.tsx | Select-String -Pattern 'legacyKind|legacyCreateBody|withLegacyKind|useProjectKind|ProjectKind|KindRoute|kind:\s*"(train|detect)"|\.kind\s*===\s*"(train|detect)"|kind\s*!==\s*"(train|detect)"|Detection project|Training project' | ForEach-Object { "$($_.Path):$($_.LineNumber)" }
pnpm test
cd ..
```

Expected: the grep lists only `e2e/` files (Task 14 clears them), and **no** line names `legacyKind`, `legacyCreateBody` or `withLegacyKind`; `Test-Path src\api\legacyKind.ts` prints `False`; `pnpm test` passes.

- [ ] **Step 4b: Retire `moveMapToProject` from the contract**

`MoveMapDialog` (deleted in Task 10) was the last caller; BK already deleted the backend route (if
`Select-String -Path backend/app/maps/router.py -Pattern '/move'` still finds it, delete that route
and `MapMoveRequest` in `backend/app/maps/schemas.py` too).
1. In `contract/openapi.yaml`, delete the `moveMapToProject` operation (its path item
   `/api/v1/projects/{projectId}/maps/{mapId}/move`) and the `MapMoveRequest` schema.
   `JobType` keeps `map_move` (old job rows still list).
2. `pnpm -C contract generate`.
3. In `backend/tests/test_contract.py`, delete `moveMapToProject` from `RETIRING`; in
   `backend/tests/test_foundation_contract.py`, delete it from the dict in
   `test_the_replaced_operations_are_deprecated_with_the_unit_that_removes_them`.

Run: `pnpm -C contract check`; from `backend`,
`E:/Dev/Yolo/app/backend/.venv/Scripts/python.exe -m pytest tests/test_contract.py tests/test_foundation_contract.py -q`;
`pnpm -C frontend build`.
Expected: all pass.

- [ ] **Step 5: Commit**

```powershell
git add frontend/src/data/labelNext.ts frontend/src/data/labelNext.test.ts frontend/src/review/reviewView.ts frontend/src/review/reviewView.test.ts frontend/src/screens/DataManagerScreen.tsx frontend/src/screens/DataManagerScreen.test.tsx frontend/src/data/SelectionBar.tsx frontend/src/data/SelectionBar.test.tsx frontend/src/screens/ReviewScreen.tsx frontend/src/screens/ReviewScreen.test.tsx frontend/src/screens/ReviewScreenIds.test.tsx frontend/src/review/DetectReview.tsx frontend/src/review/DetectReview.test.tsx frontend/src/screens/ExportScreen.tsx frontend/src/screens/ExportScreen.test.tsx frontend/src/screens/ProjectsScreen.tsx frontend/src/screens/ProjectsScreen.test.tsx frontend/src/test/fixtures.ts frontend/src/agent/useSetupAgent.ts frontend/src/agent/SetupAgent.test.tsx frontend/src/api/adoption.ts frontend/src/api/adoption.test.ts
git add contract/openapi.yaml contract/client/schema.d.ts backend/tests/test_contract.py backend/tests/test_foundation_contract.py
git commit -m "feat(projects): no project kind in the UI - union of review, export and selection actions; Label next; Use in dataset" -m "Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 12: Internal links onto the new routes

The redirects keep old links working, but every link the app itself makes should point at the new route (no redirect hop, no URL flicker, and the tab highlights immediately).

**Files:** the exact replacements below, and their test expectations.

**Interfaces:**
- Consumes: the route map (Task 9).
- Produces: no link in `frontend/src` (outside `routes/legacyRedirects.tsx` and its test) names `/data`, `/edit/`, `/label`, `/sources`, `/volumes`, `/past`, `/p/…/datasets`, `/p/…/train` or `/library` as a route.

- [ ] **Step 1: Write the failing test expectations**

Change the expected strings in these tests first:

| Test file | Old expectation | New expectation |
| --- | --- | --- |
| `src/jobs/jobLabels.test.ts` | `"/library?model=m9"`, `"/library?model=m1"` (×2), `"/library?model=m2"`, `"/library?model=m3"`, `"/library?model=m4"` | `"/models/library?model=…"` (same ids) |
| `src/jobs/jobLabels.test.ts` | `{ label: "Open library", to: "/library" }` | `{ label: "Open library", to: "/models/library" }` |
| `src/jobs/jobLabels.test.ts` | any `` `${p}/sources` `` / `"…/sources"` for `map_import` or `map_move` | `"…/maps"` with label `"Open maps"` |
| `src/jobs/jobLabels.test.ts` | `…/data` for `import` | `…/images` |
| `src/jobs/jobLabels.test.ts` | `…/train` for `dataset` | `"/models/training"` |
| `src/jobs/jobLabels.test.ts` | `…/volumes` with `"Open volumes"` | `…/measurements` with `"Open measurements"` |
| `src/jobs/JobCard.test.tsx`, `src/train/TrainProgress.test.tsx` | `"/library?model=m9"` | `"/models/library?model=m9"` |
| `src/screens/QueryScreen.test.tsx`, `src/train/TrainForm.test.tsx` | `toHaveAttribute("href", "/library")` | `"/models/library"` |

Run: `pnpm -C frontend exec vitest run src/jobs src/train src/screens/QueryScreen.test.tsx`
Expected: FAIL on exactly the changed expectations.

- [ ] **Step 2: Make the replacements**

| File | Old | New |
| --- | --- | --- |
| `src/jobs/jobLabels.ts` | `` to: `/library?model=${id}` `` | `` to: `/models/library?model=${id}` `` |
| `src/jobs/jobLabels.ts` | `{ label: "Open library", to: "/library" }` | `{ label: "Open library", to: "/models/library" }` |
| `src/jobs/jobLabels.ts` (`map_move`, `map_import`) | `{ label: "Open sources", to: `${p}/sources` }` | `{ label: "Open maps", to: `${p}/maps` }` |
| `src/jobs/jobLabels.ts` (`dataset`) | `` to: `${p}/train` `` | `to: "/models/training"` |
| `src/jobs/jobLabels.ts` (`import`) | `` to: `${p}/data` `` | `` to: `${p}/images` `` |
| `src/jobs/jobLabels.ts` (surface/volume/design) | `{ label: "Open volumes", to: `${p}/volumes` }` | `{ label: "Open measurements", to: `${p}/measurements` }` |
| `src/jobs/jobLabels.ts` | the comment above `map_move` about Sources | `// Maps are listed on the Maps tab; every run, photo or map, is on Runs.` |
| `src/screens/ExportScreen.tsx` | `to="/library"` | already `/models/library` (Task 11) |
| `src/query/SourcePicker.tsx`, `src/train/TrainForm.tsx` | `to="/library"` | `to="/models/library"` |
| `src/train/TrainForm.tsx` | `` to={`/p/${projectId}/datasets`} `` | `to="/models/datasets"` |
| `src/datasets/DatasetDetail.tsx` | `` to={`/p/${projectId}/train?dataset=${dataset.id}`} `` | `` to={`/models/training?dataset=${dataset.id}`} `` |
| `src/agent/project/useProjectAgent.ts` | `` `${base}/edit/${encodeURIComponent(nav.image_id)}` `` | `` `${base}/images/${encodeURIComponent(nav.image_id)}` `` |
| `src/editor/useEditorNavigation.ts` | `` navigate(`/p/${projectId}/edit/${target}`) `` | `` navigate(`/p/${projectId}/images/${target}`) `` |
| `src/review/ImageReviewQueue.tsx` | `` navigate(`/p/${projectId}/edit/${id}`) `` | `` navigate(`/p/${projectId}/images/${id}`) `` |
| `src/screens/VolumesScreen.tsx` (4 places) | `` `/p/${projectId}/volumes…` `` | `` `/p/${projectId}/measurements…` `` |
| `src/screens/MapsScreen.tsx` | `` readOnly ? `/p/${projectId}/past/maps` : `/p/${projectId}/maps` `` | `` `/p/${projectId}/maps` `` (the `readOnly` prop stays; its only caller is gone) |
| `src/ui/useJobToasts.ts` | any `/data`, `/sources`, `/volumes` path in `reportedInline` | the same replacements (`/images`, `/maps`, `/measurements`) |

Then run the sweep check:

```powershell
cd E:\Dev\Yolo\app\.claude\worktrees\f-sh\frontend
Get-ChildItem -Recurse src -Include *.ts,*.tsx | Where-Object { $_.FullName -notmatch 'routes\\(legacyRedirects|routes\.test)' } | Select-String -Pattern '(\$\{p\}|\$\{base\}|/p/\$\{[A-Za-z.]+\})/(data|edit|label|sources|volumes|past|datasets|train)\b|["`]/library\b' | ForEach-Object { "$($_.Path):$($_.LineNumber): $($_.Line.Trim())" }
cd ..
```

Expected: no line other than test files that assert a redirect or an `/api/v1/…/library/…` request (the pattern excludes `/api/v1` because those strings start with `/api`).

- [ ] **Step 3: Run the tests**

Run: `pnpm -C frontend test`
Expected: PASS.

- [ ] **Step 4: Commit**

```powershell
git add frontend/src/jobs/jobLabels.ts frontend/src/jobs/jobLabels.test.ts frontend/src/jobs/JobCard.test.tsx frontend/src/train/TrainProgress.test.tsx frontend/src/train/TrainForm.tsx frontend/src/train/TrainForm.test.tsx frontend/src/query/SourcePicker.tsx frontend/src/screens/QueryScreen.test.tsx frontend/src/datasets/DatasetDetail.tsx frontend/src/agent/project/useProjectAgent.ts frontend/src/editor/useEditorNavigation.ts frontend/src/review/ImageReviewQueue.tsx frontend/src/screens/VolumesScreen.tsx frontend/src/screens/MapsScreen.tsx frontend/src/ui/useJobToasts.ts
git commit -m "refactor(routes): internal links point at the new tabs and Models routes" -m "Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

(Stage only the files the sweep actually changed; drop any from the list that needed no edit.)

---

### Task 13: Token and restyle sweep

Load the design skills and `DESIGN.md` first. Interim screens change **only** through tokens and primitives (spec §19 item 4): no layout rewrites, no behaviour.

**Files:** every file outside `frontend/src/ui/` that `check-tokens` flags, plus the interim hosts' page headers.

**Interfaces:**
- Consumes: DS tokens (assumed Tailwind keys in the table above).
- Produces: `node scripts/check-tokens.mjs` → `tokens ok`; if DS shipped a baseline/allow-list of known violations, it is empty for every file outside `src/ui/`.

- [ ] **Step 1: List the violations (the failing check)**

```powershell
cd E:\Dev\Yolo\app\.claude\worktrees\f-sh\frontend
node scripts/check-tokens.mjs
Get-ChildItem -Recurse src -Include *.tsx,*.ts | Where-Object { $_.FullName -notmatch '\\src\\ui\\' } | Select-String -Pattern '\b(bg|text|border|ring|divide|shadow|from|to)-(ground|side|panel|well|canvas|accent-line|warn-strong|inverse)|duration-\d+|rounded-\[|font-\[|shadow-\[' | ForEach-Object { "$($_.Path):$($_.LineNumber)" }
cd ..
```

Expected before the sweep: DS's Task 2 already renamed the Contour classes across `frontend/src`, so the list should hold only what SH itself added (none, if Tasks 3–11 followed this plan) plus DS's kept aliases `rounded-md`, `rounded-lg` and `shadow-float` on the interim screens. If the list holds retired names, DS missed them: apply DS's rename map below and note it in the ledger.

- [ ] **Step 2: Apply the restyle pass**

Leftover Contour names, with **DS's rename map** (DS plan, Global Constraints):

| Contour class | Aero glass class |
| --- | --- |
| `…-ground`, `…-canvas` | `…-bg` (on the shell's own elements, drop `bg-ground` entirely: the body paints `--backdrop`) |
| `…-side` | `…-rail` |
| `bg-panel` | `bg-surface`; `bg-panel/90` → `bg-glass` |
| `…-well` | `…-surface-2` |
| `…-inverse`, `…-inverse-fg` | `…-tip`, `…-tip-fg` (triplets: opacity modifiers work) |
| `…-warn-strong` | `…-warn` |
| `…-accent-hover` | `…-accent-ink` |
| `…-accent-line` | `…-line-strong` |
| `duration-140` / `-180` / `-220` | `duration-fast` / `-base` / `-slow` |
| `rounded-[10px]` | `rounded-control`; `rounded-[3px]`, `rounded-[4px]` → `rounded-sm` |

The interim-host restyle proper (spec §19 item 4: tokens and primitives only, no layout or behaviour change), on `DataManagerScreen`, `EditorScreen`, `maps/MapDataList`, `VolumesScreen`, `CloudsScreen` and the secondary screens (`RunsScreen`, `ReviewScreen`/`DetectReview`, `AnalyticsScreen`, `SiteAreasScreen`, `QueryScreen`, `ExportScreen`, `SettingsScreen`, `AppSettingsScreen`, `AboutScreen`), plus the `data/` components the Images tab renders:

| Today | Aero glass |
| --- | --- |
| DS's aliases `rounded-lg` on cards and panes, `rounded-md` on controls, `shadow-float` | `rounded-panel`, `rounded-control`, `shadow-elev-2` |
| page `h1` (`text-2xl font-semibold tracking-tight` and variants) | `text-xl font-semibold` (spec §4.1 "page titles") |
| `text-[11px]`, `text-[13px]` | `text-2xs`, `text-sm` |
| `SelectionBar.tsx` `onInverse` | `"!border-line-strong !bg-transparent !text-tip-fg hover:!bg-hover"` |
| a card built from `rounded-lg border border-line bg-surface` by hand | `<GlassPanel variant="pane">` (only where the element is a plain card with no other behaviour) |

- [ ] **Step 3: Verify**

```powershell
cd E:\Dev\Yolo\app\.claude\worktrees\f-sh
pnpm -C frontend lint
pnpm -C frontend test
pnpm -C frontend build
```

Expected: lint ends with `tokens ok` and no ESLint error; tests pass; build ok. Then look at it: `pnpm -C frontend dev` against the mock (`pnpm --dir contract exec prism mock openapi.yaml --port 4010`), open `/projects`, `/p/7f1c2e3a-1111-4000-8000-000000000001/images`, `/maps`, `/measurements`, `/clouds`, `/runs`, and compare the rail, top bar and tabs with `visual-directions.html` theme D: 64px rail, 56px top bar, tab strip with mono counts, no opaque Contour greys left on any page.

- [ ] **Step 4: Commit per folder** (one commit per top-level folder touched, so a reviewer can reject one without the rest)

```powershell
git add frontend/src/app
git commit -m "style(shell): Aero glass tokens in the app chrome" -m "Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
git add frontend/src/screens frontend/src/data frontend/src/volumes frontend/src/maps
git commit -m "style(screens): interim Images, Maps and Measurements hosts on Aero glass tokens" -m "Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
git add frontend/src/agent frontend/src/analytics frontend/src/api frontend/src/clouds frontend/src/datasets frontend/src/editor frontend/src/exports frontend/src/jobs frontend/src/library frontend/src/query frontend/src/runs frontend/src/settings frontend/src/surfaces frontend/src/train
git commit -m "style: retire the Contour colour names outside the shell" -m "Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

(`git add <folder>` stages only tracked changes and new files in that folder; run `git status --short` first and make sure nothing unrelated is in it. If DS left a baseline file under `frontend/scripts/`, add its emptied version to the last commit by path.)

---

### Task 14: e2e migration and `shell.spec.ts`

**Files:**
- Create: `frontend/e2e/mock.ts`, `frontend/e2e/shell.spec.ts`
- Delete: `frontend/e2e/kinds.ts`, `past-detections.spec.ts`, `sources.spec.ts`, `datasets.spec.ts`, `train.spec.ts`
- Modify: `analytics.spec.ts`, `boot.spec.ts`, `clouds.spec.ts`, `clouds-no-webgl.spec.ts`, `contour.spec.ts`, `data-manager.spec.ts`, `design-surfaces.spec.ts`, `detect-export.spec.ts`, `detect-review.spec.ts`, `editor.spec.ts`, `import.spec.ts`, `jobs.spec.ts`, `library.spec.ts`, `maps.spec.ts`, `model-gsd.spec.ts`, `pointcloud-foundation.spec.ts`, `project-agent.spec.ts`, `projects.spec.ts`, `query.spec.ts`, `review.spec.ts`, `runs.spec.ts`, `surveys.spec.ts`, `volumes.spec.ts`

**Interfaces:**
- Consumes: the Prism mock serving C0's examples on `E2E_MOCK_PORT`.
- Produces: `fromMock<T>(page, path)` and `jsonReply(body, status?)` in `e2e/mock.ts` (moved verbatim from `kinds.ts`).

- [ ] **Step 1: Write the new spec (the failing test)**

`frontend/e2e/shell.spec.ts`:

```ts
import { test, expect, type Page } from "@playwright/test";
import { fromMock } from "./mock";

// The contract's examples, which the Prism mock serves for every id.
const P = "7f1c2e3a-1111-4000-8000-000000000001";
const IMG = "10000000-5555-4000-8000-000000000001";
const MAP = "a0000000-6666-4000-8000-000000000001";

/** Waits for the page entrance to finish (ADR 2026-09-21-gotcha-measuring-animated-drawers). */
async function settled(page: Page) {
  const opacity = await page
    .locator("[data-transition-key]")
    .evaluate((el) => Promise.all(el.getAnimations().map((a) => a.finished)).then(() => getComputedStyle(el).opacity));
  expect(opacity).toBe("1");
}

test("the rail reaches every section and marks the current one", async ({ page }) => {
  await page.goto("/");
  await expect(page).toHaveURL(/\/projects$/);
  const rail = page.getByRole("navigation", { name: "Main navigation" });
  await expect(rail.getByRole("link", { name: "Projects", exact: true })).toHaveAttribute("aria-current", "page");
  await rail.getByRole("link", { name: "Models", exact: true }).click();
  await expect(page).toHaveURL(/\/models\/library$/);
  await expect(rail.getByRole("link", { name: "Models", exact: true })).toHaveAttribute("aria-current", "page");
  await rail.getByRole("link", { name: "Catalogue", exact: true }).click();
  await expect(page).toHaveURL(/\/catalogue$/);
  await rail.getByRole("link", { name: "Jobs", exact: true }).click();
  await expect(page).toHaveURL(/\/jobs$/);
  await rail.getByRole("link", { name: "Settings", exact: true }).click();
  await expect(page.getByRole("heading", { name: "App settings" })).toBeVisible();
  const box = await rail.boundingBox();
  expect(box?.width).toBe(64);
});

test("a project opens on Overview; the tabs switch pages and the entrance finishes", async ({ page }) => {
  const overview = await fromMock<{ data: { images: number } }>(page, `/api/v1/projects/${P}/overview`);
  await page.goto(`/p/${P}`);
  await expect(page).toHaveURL(new RegExp(`/p/${P}/overview$`));
  const tabs = page.getByRole("tablist");
  await expect(tabs.getByRole("tab")).toHaveCount(7);
  await expect(tabs.getByRole("tab", { name: /^Images/ })).toContainText(
    new RegExp(String(overview.data.images).replace(/\B(?=(\d{3})+(?!\d))/g, ",?")),
  );
  await tabs.getByRole("tab", { name: /^Images/ }).click();
  await expect(page).toHaveURL(new RegExp(`/p/${P}/images$`));
  await expect(tabs.getByRole("tab", { name: /^Images/ })).toHaveAttribute("aria-selected", "true");
  await expect(page.getByRole("banner")).toContainText("Images");
  await settled(page);
});

test("Ctrl K goes to a tab and finds a finding or a data item", async ({ page }) => {
  const results = await fromMock<{ findings: { number: number }[]; data: { label: string }[] }>(
    page,
    `/api/v1/projects/${P}/search?q=cr&limit=8`,
  );
  await page.goto(`/p/${P}/images`);
  await expect(page.getByRole("heading", { name: "Images", exact: true })).toBeVisible({ timeout: 15_000 });
  await page.keyboard.press("Control+K");
  const input = page.getByRole("combobox");
  await expect(input).toBeFocused();
  await input.fill("Measurements");
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(new RegExp(`/p/${P}/measurements$`));

  await page.keyboard.press("Control+K");
  await page.getByRole("combobox").fill("cr");
  const expected = results.findings[0]
    ? `F-${String(results.findings[0].number).padStart(4, "0")}`
    : results.data[0].label;
  await expect(page.getByRole("option", { name: new RegExp(expected) })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("combobox")).toHaveCount(0);
});

test("old addresses land on the new tabs", async ({ page }) => {
  await page.goto(`/p/${P}/data`);
  await expect(page).toHaveURL(new RegExp(`/p/${P}/images$`));
  await page.goto(`/p/${P}/edit/${IMG}`);
  await expect(page).toHaveURL(new RegExp(`/p/${P}/images/${IMG}$`));
  await page.goto(`/p/${P}/volumes`);
  await expect(page).toHaveURL(new RegExp(`/p/${P}/measurements$`));
  await page.goto("/library?model=m1");
  await expect(page).toHaveURL(/\/models\/library\?model=m1$/);
  await page.goto("/no/such/page");
  await expect(page.getByText("Nothing at this address")).toBeVisible();
  await expect(page.getByRole("navigation", { name: "Main navigation" })).toBeVisible();
});

test("the map viewer is full-bleed: no tabs, and the breadcrumb names the tab", async ({ page }) => {
  await page.goto(`/p/${P}/maps/${MAP}`);
  await expect(page.getByRole("banner")).toContainText("Maps");
  await expect(page.getByRole("tablist")).toHaveCount(0);
});

test("the Maps tab lists the project's maps from the data list", async ({ page }) => {
  const data = await fromMock<{ items: { label: string }[] }>(
    page,
    `/api/v1/projects/${P}/data?type=map&type=elevation&type=drawing&limit=100`,
  );
  await page.goto(`/p/${P}/maps`);
  await expect(page.getByRole("heading", { name: "Maps", exact: true })).toBeVisible();
  if (data.items.length > 0) await expect(page.getByRole("rowheader", { name: data.items[0].label })).toBeVisible();
  else await expect(page.getByText("No maps yet")).toBeVisible();
});

test("secondary pages open from More", async ({ page }) => {
  await page.goto(`/p/${P}/overview`);
  await page.getByRole("button", { name: "More", exact: true }).click();
  await page.getByRole("menuitem", { name: "Analytics" }).click();
  await expect(page).toHaveURL(new RegExp(`/p/${P}/analytics$`));
  await expect(page.getByRole("heading", { name: "Analytics", exact: true })).toBeVisible();
});
```

Run (free ports, from the worktree root):

```powershell
$ports = 1..2 | ForEach-Object { $l = [System.Net.Sockets.TcpListener]::new([System.Net.IPAddress]::Loopback, 0); $l.Start(); $l.LocalEndpoint.Port; $l.Stop() }
$env:E2E_WEB_PORT = "$($ports[0])"; $env:E2E_MOCK_PORT = "$($ports[1])"
pnpm -C frontend exec playwright test e2e/shell.spec.ts
```

Expected: FAIL, `Cannot find module './mock'`.

- [ ] **Step 2: Migrate the helpers and the existing specs**

Create `frontend/e2e/mock.ts` with `MOCK`, `fromMock` and `jsonReply` copied verbatim from `e2e/kinds.ts` (everything except `asDetectionProject`), then `git rm frontend/e2e/kinds.ts frontend/e2e/past-detections.spec.ts frontend/e2e/sources.spec.ts frontend/e2e/datasets.spec.ts frontend/e2e/train.spec.ts`.

In every spec that imported from `./kinds`: import `fromMock`/`jsonReply` from `./mock` (drop the import line when only `asDetectionProject` was imported), and delete every `asDetectionProject(page, P)` call (the `test.beforeEach(({ page }) => asDetectionProject(page, P));` lines, and the `await asDetectionProject(page, P);` lines inside `beforeEach` or tests; a `beforeEach` left empty is deleted).

Per-file changes:

| Spec | Change |
| --- | --- |
| `analytics.spec.ts` | replace the nav click (`getByRole("navigation", …).getByRole("link", { name: /^Analytics/ }).click()`) with `await page.getByRole("button", { name: "More", exact: true }).click(); await page.getByRole("menuitem", { name: "Analytics" }).click();` |
| `boot.spec.ts` | test 2 → title "with no project open the rail reaches App settings, which holds the provider keys"; delete the "Open or create a project" assertion; click `page.getByRole("navigation", { name: "Main navigation" }).getByRole("link", { name: "Settings", exact: true })`. Test 3 → title "a project opens on Overview with counts in the tabs": `goto(\`/p/${P}\`)`, `toHaveURL(/overview$/)`, `expect(page.getByRole("tablist").getByRole("tab", { name: /^Images/ })).toContainText(/\d/)`, banner contains "Overview". Test 4 → title "Label next opens the first unlabeled image with the list as its walk": `goto(\`/p/${P}/images\`)`, click `getByRole("button", { name: "Label next" })`, `toHaveURL(new RegExp(\`/p/${P}/images/${IMG}$\`))`, position `1 / 2` |
| `contour.spec.ts` | delete the tests "Contour rail expands…", "Home's imagery is bounded…" and "locked-step explanations…"; in the remaining editor test change `goto(\`/p/${PROJECT}/edit/${IMAGE}\`)` to `/images/${IMAGE}` (X renames the file to `aero.spec.ts`) |
| `data-manager.spec.ts` | every `` `/p/${P}/data` `` → `` `/p/${P}/images` ``; every `**/p/${P}/edit/` and `/edit/` regex → `/images/`; test "in a detection project, run model…" → title "run model opens the query screen with the selection", replace `expect(… "Add to dataset" …).toHaveCount(0)` with `await expect(page.getByRole("button", { name: "Use in dataset…" })).toBeVisible();`; replace the test "in a training project, add to dataset posts the ids with the seed" whole with: select the row, click "Use in dataset…", `await expect(page).toHaveURL(new RegExp(\`/models/datasets\\?new=1&project=${P}$\`));` |
| `design-surfaces.spec.ts`, `volumes.spec.ts` | `goto(\`/p/${P}/volumes\`)` → `/measurements`; `volumes.spec.ts` `toHaveURL(new RegExp(\`/volumes/${M}$\`))` → `/measurements/${M}$` |
| `detect-review.spec.ts` | `goto(\`/p/${P}/review\`)` → `/review?view=runs` |
| `editor.spec.ts`, `review.spec.ts` | `goto`/`waitForURL` `…/edit/…` → `…/images/…` |
| `import.spec.ts` | test 1: `goto` `/data` → `/images`; replace `await page.getByRole("button", { name: "1 active job" }).click();` and the following panel assertion with `await page.getByRole("banner").getByRole("link", { name: /^Importing/ }).click(); await expect(page).toHaveURL(new RegExp(\`/jobs\\?project=${P}$\`)); await expect(page.getByTestId(\`job-${JOB}\`).getByRole("progressbar")).toHaveAttribute("aria-valuenow", "42");`; delete the final `"1 active job"` assertion. Test 2 unchanged (the drawer still opens on re-import) |
| `jobs.spec.ts` | test 1 → title "lists the project's jobs with progress and log, and cancels": `goto(\`/jobs?project=${P}\`)` instead of `/data` and the button click; `const card = page.getByRole("main").getByTestId(\`job-${JOB}\`)`; delete the `"1 active job"` and "Close jobs"/panel assertions; keep the listed-request, progress, log and cancel steps. Test 2: `goto(\`/jobs?project=${P}\`)`, card from `page.getByRole("main")` |
| `pointcloud-foundation.spec.ts` | test 1 → title "Point clouds and Measurements open from the project tabs": click `page.getByRole("tab", { name: /^Point clouds/ })` then `/^Measurements/`; URLs `/clouds$` and `/measurements$`; headings unchanged ("Point clouds", "Volumes"). Delete test 2 ("a training project sends a Point clouds address Home") |
| `project-agent.spec.ts` | `toContainText("Home")` → `toContainText("Overview")` |
| `projects.spec.ts` | replace the file's tests with: "creating a project posts its name and folder and opens its Overview" (fill Name and `#project-folder`, click Create project, expect the POST body `{ name, folder, type_ids: [] }`, `toHaveURL(new RegExp(\`/p/${P}/overview$\`))`, 7 tabs visible) and "the projects list has no kind" (`goto("/")`, "Ahmadia" visible, `getByRole("radio", { name: "Detection", exact: true })` count 0, `getByText("Training project")` count 0); keep the imports it still uses |
| `surveys.spec.ts` | keep test 1 (the redirect to Analytics); delete test 2 |
| `library.spec.ts`, `maps.spec.ts`, `clouds.spec.ts`, `clouds-no-webgl.spec.ts`, `detect-export.spec.ts`, `model-gsd.spec.ts`, `query.spec.ts`, `runs.spec.ts` | only the import and `asDetectionProject` removal |

- [ ] **Step 3: Run the whole e2e suite**

```powershell
pnpm -C frontend exec playwright test
Remove-Item Env:E2E_WEB_PORT, Env:E2E_MOCK_PORT
```

Expected: every test passes. If a layout-measuring assertion (a canvas or viewer size) fails only by the tab strip's height (about 42px), adjust that expected number with a comment naming the tab strip; never change the shell to fit an old number. Any other failure: superpowers:systematic-debugging.

- [ ] **Step 4: The kind grep gate over the whole frontend**

```powershell
Get-ChildItem -Recurse frontend\src, frontend\e2e -Include *.ts,*.tsx | Select-String -Pattern 'useProjectKind|ProjectKind|KindRoute|asDetectionProject|kind:\s*"(train|detect)"|\.kind\s*===\s*"(train|detect)"|Detection project|Training project' | ForEach-Object { "$($_.Path):$($_.LineNumber)" }
```

Expected: no line (the "Training project" hit in `projects.spec.ts` is inside `getByText("Training project")).toHaveCount(0)`; if the pattern lists it, that one line is the allowed exception — note it in the ledger).

- [ ] **Step 5: Commit**

```powershell
git add frontend/e2e/mock.ts frontend/e2e/shell.spec.ts frontend/e2e/analytics.spec.ts frontend/e2e/boot.spec.ts frontend/e2e/clouds.spec.ts frontend/e2e/clouds-no-webgl.spec.ts frontend/e2e/contour.spec.ts frontend/e2e/data-manager.spec.ts frontend/e2e/design-surfaces.spec.ts frontend/e2e/detect-export.spec.ts frontend/e2e/detect-review.spec.ts frontend/e2e/editor.spec.ts frontend/e2e/import.spec.ts frontend/e2e/jobs.spec.ts frontend/e2e/library.spec.ts frontend/e2e/maps.spec.ts frontend/e2e/model-gsd.spec.ts frontend/e2e/pointcloud-foundation.spec.ts frontend/e2e/project-agent.spec.ts frontend/e2e/projects.spec.ts frontend/e2e/query.spec.ts frontend/e2e/review.spec.ts frontend/e2e/runs.spec.ts frontend/e2e/surveys.spec.ts frontend/e2e/volumes.spec.ts
git commit -m "test(e2e): shell spec; existing specs on the new shell and routes, no project kinds" -m "Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 15: Gate, ledger, merge, hand-off

S1 and S2 cut their worktrees from `main` only after this task.

**Files:**
- Modify: `docs/progress.md` (a new entry at the top, under the resume instructions)

**Interfaces:**
- Consumes: everything above.
- Produces: `task/f-sh` merged into `main`, the worktree removed, the branch deleted.

- [ ] **Step 1: Bring the branch up to `main`**

```powershell
cd E:\Dev\Yolo\app\.claude\worktrees\f-sh
git rebase main
git merge-base --is-ancestor main HEAD; "main is an ancestor: $($LASTEXITCODE -eq 0)"
```

Expected: the rebase succeeds; `main is an ancestor: True`. If MG-steps merged meanwhile and touched `frontend/`, resolve in favour of both and rerun Task 14 Step 3.

- [ ] **Step 2: Run the full gate** (AGENTS.md §4)

```powershell
pnpm -C contract check
cd backend; .\.venv\Scripts\python.exe -m ruff check .; .\.venv\Scripts\python.exe -m ruff format --check .; .\.venv\Scripts\python.exe -m pytest; cd ..
pnpm -C frontend lint
pnpm -C frontend test
pnpm -C frontend build
$ports = 1..2 | ForEach-Object { $l = [System.Net.Sockets.TcpListener]::new([System.Net.IPAddress]::Loopback, 0); $l.Start(); $l.LocalEndpoint.Port; $l.Stop() }
$env:E2E_WEB_PORT = "$($ports[0])"; $env:E2E_MOCK_PORT = "$($ports[1])"; pnpm -C frontend e2e; Remove-Item Env:E2E_WEB_PORT, Env:E2E_MOCK_PORT
if (Test-Path frontend\src-tauri\binaries\kestrel-backend-*.exe) { cargo test --manifest-path frontend/src-tauri/Cargo.toml } else { "cargo test skipped: no frozen sidecar in this worktree" }
```

Expected: contract clean and `schema.d.ts` equal to its regenerated output (Task 11 Step 4b retired `moveMapToProject`); ruff clean; pytest passes (SH touches no backend file); lint clean with `tokens ok`; vitest all pass; build ok; every e2e test passes; `cargo test skipped`. Record the counts.

- [ ] **Step 3: The ledger entry**

In `docs/progress.md`, insert after the resume-instructions paragraph:

```markdown
## Foundation SH: app shell — 2026-09-26 (`task/f-sh`, merged to `main`)

Spec `docs/superpowers/specs/2026-09-26-foundation-design.md` §5, §6.2, plan
`docs/superpowers/plans/2026-09-26-foundation-sh-shell.md`. The Aero glass shell S1 and S2 build on.

What changed:

- **Shell:** a 64px rail (Projects, Models, Catalogue, Jobs, Settings), a top bar (breadcrumb with
  the project's live dot, a Ctrl K palette field, the route's actions, the running pill, the agent
  button), the seven project tabs with counts from the overview and a More menu, and a page
  entrance keyed on the tab. Full-bleed map viewer without tabs.
- **Palette:** Go to (sections, tabs, pages, recent projects), Actions (route actions, each
  importer, New project, reduced effects), project search; screens add commands with `useCommands`.
- **Routes:** `routes/projectRoutes.tsx` and `routes/appRoutes.tsx` (S1/S2 add entries there only),
  redirects for every old address with the query kept, an in-shell not-found page.
- **No project kind in the UI:** the kind sidebar, step pipeline, next-step bar and kind routes are
  deleted; Review, Export and the selection bar offer everything to every project; "Label next"
  and "Use in dataset…" replace the Label step and Add to dataset.
- **Interim hosts:** Images, Maps (a Data-list table with survey-date correction) and
  Measurements host today's screens on Aero glass tokens; Overview, Findings, Catalogue,
  Datasets, Training, Reports and Jobs are placeholders or interim pages until S1, S2 and R.

Verified on the rebased branch (2026-09-26) with the AGENTS.md gate: contract clean; ruff clean;
pytest <N> passed; frontend lint clean, vitest <M> passed, build ok; e2e <K> passed; cargo test
skipped (no frozen sidecar in the worktree).
```

Replace `<N>`, `<M>`, `<K>` with Step 2's counts, then:

```powershell
git add docs/progress.md
git commit -m "docs(progress): ledger entry for the Foundation shell (SH), with the gate results" -m "Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

- [ ] **Step 4: Land with the finish flow**

```powershell
git status --porcelain   # must print nothing
powershell -NoProfile -ExecutionPolicy Bypass -File scripts\finish-task.ps1
```

Expected: the gate passes, then `done: task/f-sh merged into main, worktree removed, branch deleted.` Never `-SkipGate`. A failure: fix it (superpowers:systematic-debugging), commit, re-run Step 2, then this step.

- [ ] **Step 5: Hand-off to the operator** (the numbered "how to test this")

Give the operator this walkthrough, with the app built from `main` (`pnpm -C frontend tauri dev`, or the installer flow in the "Site office UI" memory note):

1. Start the app. It opens on **Projects**; the left rail shows the logo, Projects, Models, Catalogue, Jobs and, at the bottom, Settings. Hover each: its name appears to the right.
2. Open a project. It lands on **Overview**; the top bar reads "Projects / ● <name> / Overview" with a green dot. Seven tabs sit under the top bar; Images, Maps, Point clouds and Findings show counts.
3. Click **Images**: the page slides in slightly and fades up once; the tab underline moves. Open an image: the tabs stay, the editor fills the rest. Press **Label next** on the Images page: the first unlabeled image opens.
4. Click **Maps**: a table of your orthomosaics (and elevation models). Click a map's name: the map viewer opens full-width without tabs; the breadcrumb says "Maps". Click a map's survey date to correct it.
5. Press **Ctrl K** anywhere (also while typing in a field). Type "meas" and Enter: the Measurements tab opens. Press Ctrl K again, type two letters of a finding or map name: matching findings and data appear.
6. Open **More** at the right of the tabs: Runs, Review, Detect, Analytics, Site areas, Export and Project settings are there. Review has a switch between image suggestions and detection runs.
7. Start an import (top bar **Add data** → Photos). A live pill appears in the top bar; click it: the project's jobs page shows the import with progress.
8. Old bookmarks still work: `/p/<id>/data` opens Images, `/library` opens Models → Library.
9. Nothing asks for a training or detection project any more, and every screen is dark indigo glass; no grey Contour panels remain.

---

## Self-review

**Spec coverage.** §5.1 Rail (Task 3), TopBar with breadcrumb/dot/search/context actions/agent/RunningPill (Task 4), deleted Sidebar/Header/NextStepBar/pipeline/nextStep/projectNextStep/useProjectProgress/KindRoute/useProjectKind (Tasks 10–11), JobsPanel/JobsButton (JobsButton out of the chrome, panel kept: deviation 3), AdoptionBanner kept on the interim Overview without its kind gate (Task 8; S1 moves it into `overview/Banners.tsx`), Brand tile (Task 3), context actions by route (Task 2, deviation 5). §5.2 tabs with counts, hidden on full-bleed (Tasks 5, 10, deviation 2). §5.3 every route and every redirect (Task 9, cases table), interim hosts (Task 8), secondary routes and their reachability (Tasks 5, 7). §5.4 registry, groups, search, Ctrl K from anywhere (Tasks 2, 7, 10). §5.5 transition (Task 6, deviation 1). §5.6 the keymap is DS's; SH binds Ctrl+K and renders the `?` sheet from DS's table (Task 10b, deviation 12). §6.2 every listed deletion and union (Tasks 10–11; `e2e/kinds.ts` in Task 14). §16 frontend: `routes.tsx` redirects test (Task 9), `shell.spec.ts` with the finished animation (Task 14). §18 SH content and the two table files (Task 9). §19 item 4 (restyle only through primitives: Task 13), item 5 (table files: Task 9).

**Placeholder scan.** No TBD/TODO. The 3D jump comment (Task 9) and the `JOB_VERB` record (Task 4) are given in full, moved from today's `routes.tsx` and `Header.tsx`. Task 13 is a mechanical sweep driven by an exact mapping table and a verification command.

**Type consistency.** `RouteInfo`/`routeInfo`, `RouteAction`/`useRouteActions`/`useProvideRouteActions`/`useProvidedRouteActions`, `useCommands`/`collectCommands`/`useCommandRegistry`, `useAddData.show/close`, `AddDataTile`, `ProjectCounts`/`useProjectCounts`, `transitionTiming`, `isPaletteChord`/`usePaletteShortcut`, `labelNext`/`LabelNext`, `reviewView`/`ReviewView`, `fetchMapItems`/`detailOf`/`MAP_DATA_TYPES`/`MAP_PAGE`, `legacyProjectRedirects`/`legacyAppRedirects`/`projectRoutes`/`appRoutes`/`routeTree` are used with the same names and signatures in every task that consumes them.

**Review Focus.** Each of the five lines has its test in the owning task: query strings (Task 9 cases with `?finding=`, `?dataset=`, `?job=`, `?model=`), Ctrl K from a field (Tasks 7 and 10), overview failure (Task 5), project load failure (Task 10), unknown address (Tasks 9 and 14).
