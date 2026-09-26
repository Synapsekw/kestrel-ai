# Foundation S1: Project Screens Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

> **Where this runs.** Worktree `E:\Dev\Yolo\app\.claude\worktrees\f-s1` on branch `task/f-s1`, cut from
> `main` with `scripts\start-task.ps1 -Name f-s1` **after SH, BC and BK have merged** (and therefore
> C0 and DS). S2 runs at the same time in `f-s2`; the two touch disjoint folders. Merges into `main`
> are serialized with a rebase and the full gate between them.

**Goal:** Build the project-level screens of the Foundation: the redesigned Projects list, the
project Overview dashboard, the Add data dialog that routes to each importer, the virtualised
Findings tab with filters and bulk status, and the shared `FindingInspector` with slots for I, M and C.

**Architecture:** A thin typed API layer (`api/findings.ts`, `api/overview.ts`, `api/dataItems.ts`)
over the regenerated client feeds pure model modules (`findings/filters.ts`, `overview/kpis.ts`,
`overview/heroPins.ts`, `screens/projects/projectCards.ts`) and a few hooks that page, debounce and
re-fetch on the `findings.changed` / `data.changed` / `migration.changed` events. Screens compose the
DS primitives (`DataTable`, `InspectorPane`, `StatTile`, `GlassPanel`, `SeverityPicker` …) and plug
into SH's shell through `routes/projectRoutes.tsx`, the command registry and one Add data store.
Nothing here edits the contract, the backend or a DS primitive.

**Tech Stack:** React 18.3, TypeScript 5.9, react-router-dom 6.30, zustand 5, openapi-fetch 0.13,
OpenLayers 10 + proj4 2.22 (Overview hero map), vitest 3 + Testing Library 16, Playwright 1.63
against the Prism mock.

**Spec:** `docs/superpowers/specs/2026-09-26-foundation-design.md` (F) §5.1–§5.6 (shell contracts
S1 plugs into), §6.3–§6.4 (Data list, Add data), §8.1–§8.7 (Finding core, Findings tab, inspector,
deep links), §9 (Overview, Projects list), §14 (Budget), §15, §16, §18 (unit S1). Umbrella:
`docs/superpowers/specs/2026-09-26-inspection-platform-design.md` (D4–D9, §3, §7, §10 items 4, 6,
12, 20). Mockups: `.superpowers/brainstorm/1481982-1790403567/content/visual-directions.html`
theme D (the Overview is the exact target) and `ws-images.html` (the inspector).

## Budget

- **Background jobs:** none are created by S1. Every importer behind Add data is already a job
  (`import`, `map_import`, `design_import`, `pointcloud_import`); the dialog closes when the job is
  queued. Migration retry submits a `project_migrate` library job.
- **Bounded reads:**
  - Findings tab: keyset pages of **200** (`FINDINGS_PAGE`); a refresh after `findings.changed`
    re-reads at most **500** rows (`FINDINGS_REFRESH_MAX`, the API cap). The table renders only the
    virtual window (DS `DataTable`, fixed 44 px rows).
  - Overview: **one** pre-aggregated `GET /projects/{id}/overview` (never scans `finding`, `box`,
    `image`), plus `GET /findings?sort=-updated_at&limit=5`, `GET /activity?limit=8`, hero pins
    `GET /findings?has_location=true&status=open&limit=300`, the hero map as tiles only, and
    `GET /projects/{id}/jobs?limit=10`. No full scan per render; event bursts are debounced 400 ms.
  - Projects list: `GET /projects` (≤ `MAX_RECENT` = 20) with the pre-aggregated `summary`.
  - Data labels: one `GET /projects/{id}/data?limit=200` page per `data.changed`.
  - Inspector: one detail read; comments paged 50; history `limit=20`; attachment thumbnails 256 px,
    the original only in the lightbox.
  - Bulk: ≤ 1000 ids per request (`FINDINGS_BULK_MAX`), larger selections are chunked.

## DAG position

Programme (F §18): `C0 → DS → SH → **S1** → X` is F's **critical path**; S1 is the largest screen
unit. S1 needs SH (shell, `routes/projectRoutes.tsx`, command registry), BC (findings, overview,
activity endpoints) and BK (data list, kind removal) merged. It runs in parallel with S2. X (evidence)
waits on S1.

Inside S1 (one worktree; tasks start when their dependencies are committed on `task/f-s1`):

| Task | Depends on | Batch | Shares files with |
|---|---|---|---|
| 0 Reconcile names | — | B0 | — |
| 1 API layer, fixtures, change revisions | 0 | B1 | `store/changes.ts` (only here) |
| 12 Projects model | 0 | B1 | — |
| 2 Findings pure model | 1 | B2 | — |
| 8 Add data dialog + elevation chooser | 1 | B2 | `app/AddDataHost.tsx` (SH's file, body replaced) |
| 9 Overview model | 1, 2 | B2 | — |
| 13 Projects grid + migration states | 12 | B2 | `screens/ProjectsScreen.tsx` (with 14) |
| 3 Findings hooks | 1, 2 | B3 | — |
| 10 Overview map hero | 2, 8, 9 | B3 | — |
| 14 New project, open folder, remove | 13 | B3 | `screens/ProjectsScreen.tsx` (with 13) |
| 4 Findings tab: filters + table + route | 2, 3 | B4 | `routes/projectRoutes.tsx` (with 11) |
| 5 FindingInspector core | 2, 3 | B4 | `findings/FindingInspector.tsx` (with 6) |
| 11 Overview screen + route | 3, 9, 10 | B4 | `routes/projectRoutes.tsx` (with 4) |
| 6 Inspector sections | 5 | B5 | `findings/FindingInspector.tsx` (with 5) |
| 7 Findings tab: inspector, bulk, keys | 4, 6 | B6 | `findings/FindingsScreen.tsx` (with 4) |
| 15 e2e | 7, 8, 11, 14 | B7 | — |
| 16 Gate, walkthrough, merge | all | B8 | — |

**Critical path inside S1:** 0 → 1 → 2 → 3 → 5 → 6 → 7 → 15 → 16. Tasks in the same batch touch
disjoint files except where the last column says so; run those in numeric order. With one
implementer, run in numeric order of the batches.

## Global Constraints

- **Contract:** S1 edits nothing in `contract/` and nothing in `backend/`. `contract/openapi.yaml`
  is the source of truth and `schema.d.ts` is generated. If a field S1 needs is missing (Task 0
  lists them), **stop and raise it with the coordinator** (a C0 change); never type around it.
- **No `kind`** on projects anywhere (F §17.1). Copy never says "training project" or "detection
  project".
- **Tokens only** (F §4.5): no `bg-[#…]`/`text-[#…]`/`rgba(` in `className`; no `backdrop-blur`/
  `backdrop-filter` (blur lives in `GlassPanel variant="float"` and `Dialog`, F7); no
  `duration-\d+`, `ease-[`, `delay-\d+`, `rounded-[`, `font-[`, `shadow-[`; none of the retired
  Contour names (`ground`, `side`, `panel`, `well`, `canvas`, `accent-line`, `warn-strong`,
  `inverse`). Colours from data (severity, type colours) pass through a `--c` custom property on a
  `style` prop — the one inline colour allowed. `node scripts/check-tokens.mjs` must pass.
- **Glass cost (F7):** dashboard cards and list panes are `GlassPanel variant="pane"` (no blur);
  `variant="float"` only over imagery (the hero map's legend, scale and caption, the bulk bar over
  the table is `pane`). Never blur the Findings table's scroll container.
- **Motion (F §4.2):** animate only `transform` and `opacity`; durations only from the tokens
  (`--dur-base` 180 ms, `--dur-emphasis` 350 ms, `--dur-count` 600 ms, `--stagger-step` 40 ms,
  `--stagger-max` 8 items); nothing on an interaction path longer than 400 ms; no input waits for
  motion; no looping animation on static data (pins pop once, no pulse); `prefers-reduced-motion`
  and Settings "Reduce motion" show final states at once.
- **Keymap (F §5.6):** keys never fire while focus is in a text field (`isTypingTarget` from
  `@/ui/keymap`); digits 1–9 are severity (digits beyond the scale are ignored); **T** opens the type
  picker; the Findings tab owns only Shift+O / Shift+R / Shift+C; Esc closes the inspector.
- **Findings numbers** always render `F-` plus at least four digits (`F-0217`, F §8.1).
- **Deep links** come only from `findings/links.ts` (F §8.7): canonical `/p/:pid/findings/:fid`;
  `images/:imageId?finding=`, `maps?map=<mapId>&finding=`, `clouds/:cloudId?finding=`.
- **Status transitions (F §8.2):** closed → reviewed is refused (409 `invalid_transition`); the UI
  disables it and says "reopen first". Severity is never required.
- **The app must stay usable when a read fails:** a failed hero, activity or recent-findings read
  degrades that block only; the Overview endpoint failing shows an Alert with Retry; one broken
  project never breaks the Projects list.
- **UI work loads the design skills first** (AGENTS.md item 3): `impeccable` and `emil-design-eng`,
  plus the rewritten `DESIGN.md` (Aero glass) and the primitives in `frontend/src/ui/`, before Tasks
  4, 5, 6, 8, 10, 11, 13, 14.
- **Git:** stage by path, never `git add -A`. Every commit message ends with
  `Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>`. Identity is pinned by
  `start-task.ps1`.
- **Interpreter:** S1 adds no Python package. Backend gate commands use the shared interpreter
  `E:\Dev\Yolo\app\backend\.venv\Scripts\python.exe` (CONTRIBUTING.md "A worktree has no venv").
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

## Review Focus

The five inputs the spec implies but no requirement names, most likely to bite the operator first.
Each is pinned by a test in the task named.

1. **Switching findings inside the 600 ms note-autosave window** (type a note, press J/Enter or click
   the next row). Expected: the text is saved to the finding it was typed on — never lost, never
   written to the newly selected finding. Pinned in Task 6
   (`flushes an unsaved note to its own finding when the inspector switches`).
2. **Digits and letters typed into a text field** (a note "crack 3 mm", the search box, a comment).
   Expected: no severity, status or type change fires. Pinned in Task 7
   (`typing digits in the search field sets no severity`) and Task 6 (note field).
3. **Hero pins that coincide or a single located finding** (one finding with GPS, or several on the
   same photo). Expected: pins render at finite positions with a scale bar, never NaN / off-canvas.
   Pinned in Task 9 (`lays out a single pin and identical coordinates without NaN`).
4. **A live refresh after scrolling past 500 rows** (`findings.changed` arrives while 700 findings
   are loaded). Expected: one bounded re-read of 500 rows, no duplicated rows, and paging continues
   from the new cursor. Pinned in Task 3 (`refreshes at most 500 rows and keeps paging`).
5. **A project whose database cannot be read** (folder gone, failed upgrade, `summary` null).
   Expected: its card renders with "Couldn't upgrade", Retry and Details, the other cards are
   unaffected, and it cannot be opened. Pinned in Task 12 (`a failed project with no summary`) and
   Task 13 (`lists a failed project next to a healthy one`).

## Spec ambiguities resolved while planning

Recorded so reviewers do not flag them; each is repeated in the final report.

1. **`findingHref` signature.** F §8.7 writes `findingHref(finding)`, but a finding row in the
   per-project DB carries no project id (F §8.1). The builder is
   `findingHref(projectId, finding)`; `findingPath(projectId, findingId)` gives the canonical link.
2. **Findings "location" column.** The `Finding` schema (F §8.1) has `data_id` but no label or
   filename. S1 resolves the data item label from BK's Data list (one page ≤ 200 per project,
   refreshed on `data.changed`) and shows the image filename when the anchor carries
   `file_name`; `findingLocation` reads it structurally, so it lights up if C0/BC add it without an
   S1 change. No per-row request.
3. **Findings tab defaults.** No `status` in the URL means all statuses. The URL uses the API's own
   parameter names (`status`, `severity`, `type_id`, `anchor_kind`, `q`, `sort`), so a link from the
   Overview is also the API query. Sorting is a Sort select (the four API sorts), not column headers.
4. **What the review keys act on in the tab.** 1–9 / Shift+O/R/C apply to the checked rows when any
   are checked, otherwise to the finding open in the inspector; both go through
   `POST /findings/bulk` so skips (e.g. closed → reviewed) are reported the same way. T opens the
   inspector's type picker.
5. **Inspector slots and navigation.** `anchorSlot` renders in the `InspectorPane` sticky
   footer (default "Open in workspace"). `onNavigate?: (href: string | null) => void` receives the
   workspace link, or `null` after the finding was deleted; without it the inspector uses the router
   (`null` → the Findings tab).
6. **Comments "your own".** The app has one operator (single-user), so every comment can be edited
   and deleted.
7. **Copy link** copies the canonical in-app path `/p/:pid/findings/:fid`.
8. **"Reveal backup"** is C0's `revealProjectBackup` (`POST /projects/migrations/reveal-backup {folder}`,
   built by MG; the backend starts Explorer, so `capabilities/default.json` is not touched). S1's
   **Details** dialog shows the error and backup path with **Reveal backup** and **Copy backup path**
   (reconciliation 2026-09-26).
9. **KPI 2 "closed this week"** counts all closures in the last 7 days: `finding_daily.closed` has no
   severity split.
10. **"View all n →"** on Recent findings counts all findings and links to the tab sorted
    `-updated_at` (the same order as the five rows). Rows open the canonical link (the tab with the
    inspector, which offers "Open in workspace").
11. **Severity bars** show one bar per level (highest first) plus a "No severity" bar when
    `open_no_severity > 0`; widths are relative to the largest bar and grow with `scaleX` (motion
    only on `transform`).
12. **Elevation tile** opens `surfaces/ImportElevationDialog.tsx`, a chooser: "Design surface" (today's
    `ImportDesignDialog`) and "Build from a point cloud" (a link to the Measurements tab, where the
    interim Volumes screen's Build surface lives). M adds its GeoTIFF DSM/DTM mode to this chooser.
13. **Add data wiring** is SH's (SH plan Task 2): `app/addDataStore.ts` `useAddData.show(tile | null)`
    for the project in the URL, the top-bar action, the palette actions and `app/AddDataHost.tsx`
    mounted in `Shell`. S1 replaces the host's body with its dialog and adds `openAddData(tile?)`
    (`data/addDataTiles.ts`) as the thin wrapper its own empty states call.
14. **"Last opened"** needs `Project.last_opened_at` (recent_projects.json already stores it); the
    "Last opened" sort is the server's recent order.
15. **Hero map interaction.** The map is locked with `pointer-events: none`; a transparent button over
    it opens `maps?map=<hero_map_id>`; pins are links to the canonical finding link. Without a map,
    pins lie on a local equirectangular projection in an 800 × 360 virtual box positioned by
    percentages.
16. **Overview motion.** Card and row entrances use DS's `.stagger animate-rise` with `--i` (DS plan
    Task 3). The severity-bar growth and the one-time pin pop, which DS does not provide, live in
    `overview/overview.css`, driven only by DS tokens (`--dur-*`, `--ease-*`, `--stagger-step`).
17. **Home and AdoptionBanner.** SH deletes `HomeScreen` and `useHomePreviews` and drops the banner's
    kind gate; S1 moves `app/AdoptionBanner.tsx` (+ test) to `overview/AdoptionBanner.tsx` (F §5.1).
18. **Provenance fallback.** When the library no longer has the model, the inspector says
    "Model m0000000" (the id's first 8 characters); the run snapshot is not reachable from a finding.
19. **Esc** closes the inspector only when focus is not inside a dialog, listbox or menu.
20. **KPI 4 fallback "Reviewed %"** counts reviewed **and closed** findings over all findings (a
    closed finding has been looked at); F §9.1 writes "reviewed / all findings %".
21. **Open-findings delta** compares today with the newest `finding_daily` row on or before 7 days
    ago; no delta is shown when the trend has no such row (a new project).

## Consumed interfaces (reconciled in Task 0)

Reconciled against the sibling plans in `docs/superpowers/plans/` as they stood when this plan was
finished: `2026-09-26-foundation-ds-design-system.md` (Tasks 1–13 written; `DataTable`,
`Combobox` and the inspector layout were still to come), `2026-09-26-foundation-sh-shell.md`
(complete, including its "Names the neighbouring plans assumed" table),
`2026-09-26-foundation-bc-catalogue-findings.md` and
`2026-09-26-foundation-bk-kind-removal-data-list.md`. Rows marked **spec** use F's names verbatim
because the DS plan had not reached them: Task 0 records the merged name in the ledger and every
later task uses it.

**DS (`@/ui`, `@/app/effects`)**

| Name | Shape S1 uses | Source |
|---|---|---|
| `GlassPanel` | `GlassPanelProps extends HTMLAttributes<HTMLDivElement> {variant?: "pane" \| "float"; interactive?; radius?; as?}` | DS Task 3 |
| `.stagger` + `animate-rise`, `stagger(i)` | entrance classes with the `--i` index (capped at `--stagger-max`) | DS Task 3 |
| `StatTile`, `StatDelta` | `{label; value: number \| null; unit?; delta?: {value; good: "up" \| "down"; label?}; tone?: "default" \| "accent" \| "ok" \| "danger"; spark?: readonly number[]; chips?: ReactNode}` | DS Task 9 |
| `SeverityPill`, `SeverityPicker`, `useSeverityScale`, `SeverityLevel` | `SeverityPill {level: number \| null}`; `SeverityPicker {value: number \| null; onChange(level: number \| null); allowNone?; label?}` (radios named `"<level> <name>"`); `useSeverityScale(): readonly SeverityLevel[]` from `SeverityScaleContext` (default D4 scale; S2 provides the loaded one) | DS Task 10 |
| `StatusDot` | `{status: "open" \| "reviewed" \| "closed" \| "running" \| "failed" \| "idle"; live?}` | DS Task 10 |
| `TypeChip` | `{name; colour; kind: "defect" \| "object"}` | DS Task 10 |
| `Popover` | `{open; onClose(); anchorRef: RefObject<HTMLElement>; label; children}` | DS Task 12 |
| `MenuButton`, `MenuItem` | `MenuButton {label; items: MenuItem[]; iconOnly?; icon?; size?}`; `MenuItem {id; label; icon?; danger?; disabled?; onSelect()}` | DS Task 12 |
| `@/ui/keymap` | `isTypingTarget(target)`; `KeyEntry {keys: string[]; scope; action; help}`; `GLOBAL_KEYS`, `REVIEW_KEYS`. The Findings tab's Shift+O/R/C are S1-owned focused-view keys, not keymap entries (DS deviation 5) | DS Task 4 |
| `@/ui/motion` | `useReducedMotion(): boolean` | DS Task 3 |
| `@/app/effects` | `runAutoProbe(): Promise<Effects \| null>` — S1 calls it on the Overview's first render (DS deviation 2) | DS Task 3 |
| `DataTable`, `Column`, `Sort` | `DataTable<T> {label; columns: readonly Column<T>[]; rows: readonly T[]; rowKey(row): string; total?; loading?; empty?; selected?: ReadonlySet<string>; onSelectionChange?(next: Set<string>); sort?; onSortChange?; activeKey?: string \| null; onOpen?(row); onEndReached?(); endThreshold?}`; `Column<T> {key; header: ReactNode; width?: string (a grid track, e.g. "84px"); render(row, index): ReactNode; sortable?; align?}`. Fixed 44 px rows, only the window rendered, at most one `onEndReached` per page | DS Task 17 (reconciled 2026-09-26) |
| `ComboboxList`, `ComboItem` | `ComboboxList {label; items: readonly ComboItem[]; value: string \| null; onSelect(id); placeholder?; emptyText?}` for embedding in a caller's `Popover` (the type picker); `ComboItem {id; label; icon?; hint?; hotkey?; colour?}`. (`Combobox` is the self-contained trigger + popover variant.) | DS Task 14 (reconciled 2026-09-26) |
| `InspectorPane`, `InspectorSection`, `InspectorLayout` | `InspectorPane {label; header?; footer?; children; className?}` (the pane: header, staggered sections, footer); `InspectorSection {title: ReactNode; action?; children}`; `InspectorLayout {children; inspector?: ReactNode \| null}` (the grid) | DS Task 16 (reconciled 2026-09-26) |
| `Segmented`, `Dialog`, `Tooltip`, `Alert`, `Button`, `IconButton`, `Input`, `Select`, `Textarea`, `Checkbox`, `Field`, `Pill`, `Progress`, `Skeleton`, `SkeletonRows`, `EmptyState`, `Icon`, `toast`, `useToastStore`, `cx`, `focusRing`, `transition`, `buttonClass` | today's APIs, kept by DS | DS Tasks 5–7, 11 |
| `Icon` names | new: `findings`, `sparkle`, `elevation`, `drawing`, `jobs`; today's: `images`, `map`, `cloud`, `import`, `check`, `warning`, `info`, `folder`, `plus`, `trash`, `external`, `list`, `label`, `chevron-right` | DS Task 6 |
| Tailwind utilities | `bg-surface`, `bg-surface-2`, `bg-field`, `bg-hover`, `border-line`, `border-line-strong`, `border-card-line`, `text-ink`, `text-muted`, `text-dim`, `text-accent-ink`, `bg-accent-soft`, `text-danger`, `text-ok`, `bg-grad-ai`, `rounded-panel`, `rounded-control`, `rounded-chip`, `rounded-sm`, `text-2xs` | DS Task 1 |

**SH**

| Name | Shape S1 uses | Source |
|---|---|---|
| `routes/projectRoutes.tsx` | children of `p/:projectId` with relative paths; S1 replaces the `overview` and `findings` placeholder entries (`app/InterimScreens.tsx`) | SH Tasks 1, 8 |
| `app/addDataStore.ts` | `AddDataTile = "photos" \| "orthomosaic" \| "elevation" \| "point_cloud"`; `useAddData {open; tile; show(tile \| null); close()}` | SH Task 2 |
| `app/AddDataHost.tsx` | `AddDataHost({project})`, mounted by `Shell`; S1 replaces its body | SH Task 8 |
| top-bar actions, palette | `defaultRouteActions` already opens Add data; the palette lists each importer — S1 registers nothing | SH Tasks 2, 6 |
| `store/changes.ts` | SH adds `dataRevision`, `findingsRevision`; S1 adds `projectsRevision`, `bumpFindings`, `bumpData` | SH Task 5 |
| `app/AdoptionBanner.tsx` | kind gate dropped by SH; S1 moves it | SH Task 8 |
| `HomeScreen`, `useHomePreviews` | deleted by SH | SH file map |

**BC / BK through the regenerated client** — see "Contract assumptions" (BC's own reconciliation
table assumes the same `FindingSummary` and `ProjectOverview`; its banner items also carry an
`action`, which S1 ignores).

## Contract assumptions (checked by `tsc -b` in Task 1)

Task 1's typed wrappers index `components["schemas"]` and `paths` directly, so `pnpm -C frontend
build` fails at Task 1 if any name below differs. Task 0 checks them in `contract/client/schema.d.ts`
first. **A missing field is a C0 change: stop and raise it.**

| Contract item (F §8.3, §9, §13) | Fields S1 reads |
|---|---|
| `GET/… /api/v1/projects/{projectId}/findings` | query `status[]`, `severity[]` (int or `"none"`), `type_id[]`, `anchor_kind[]`, `q`, `sort` (`-severity` \| `number` \| `-updated_at` \| `type`), `has_location`, `limit` (≤ 500), `cursor`; response `{items: Finding[], next_cursor}` |
| `Finding` | `id, number, type_id, severity (int \| null), status, note, created_by, confidence, anchor, lon, lat, data_type, data_id, created_at, updated_at, reviewed_at, closed_at` |
| `FindingAnchor` | oneOf with discriminator **`kind`** (`image {image_id, annotation_id}` \| `map {map_id, geometry}` \| `cloud {cloud_id, x, y, z, uncertainty_m}`); optional `file_name` on image anchors (ambiguity 2) |
| `GET/PATCH/DELETE …/findings/{findingId}` | detail = `Finding` + `attachment_count`, `comment_count`; PATCH body `{type_id?, severity?, status?, note?}` |
| `POST …/findings/bulk` | body `{ids, set: {status?, severity?, type_id?}}`; response `{updated: int, skipped: {id, code}[]}` |
| `GET …/findings/summary` | `FindingSummary {by_status: {open, reviewed, closed}, open_by_severity: {[level]: n}, open_no_severity, by_type: {type_id, n}[], trend: {day, open, open_by_severity, closed}[]}` |
| `…/findings/{findingId}/thumbnail`, `…/attachments/{attachmentId}/file`, `…/thumbnail` | image routes accepting `?token=` like today's image thumbnails |
| `GET/POST …/findings/{findingId}/comments`, `PATCH/DELETE …/comments/{commentId}` | `FindingComment {id, finding_id, author, text, created_at, edited_at}`; page `{items, next_cursor}` |
| `GET/POST …/findings/{findingId}/attachments`, `DELETE …/{attachmentId}` | `FindingAttachment {id, finding_id, path, original_name, width, height, bytes, created_at}`; POST `{path}`; list `{items}` |
| `GET …/activity` | query `subject_id`, `limit`, `cursor`; `Activity {id, at, kind, subject_id, summary, payload}` |
| `GET …/overview` | `ProjectOverview {findings: FindingSummary, data: {image_sets, images, maps, elevations, point_clouds, drawings}, latest_volume: {measurement_id, name, net_m3, previous_net_m3} \| null, hero_map_id: string \| null, banners: {kind, tone: "info" \| "warn" \| "danger", message}[]}` — `latest_volume` and `banners` item fields are **flagged** (F §9.1 names only the blocks) |
| `GET …/data` | query `type[]`, `limit`, `cursor`; `DataItem {id, type, label, captured_on, status, summary, created_at}` |
| `Project` | + `summary: ProjectSummary \| null {image_count, maps, point_clouds, elevations, open_findings, open_top_severity, cover: {kind: "map" \| "image", id} \| null}`, `migration: MigrationState {state: "ok" \| "pending" \| "running" \| "failed", job_id?, error?, backup_path?}`, **`last_opened_at: string \| null`** (flagged, ambiguity 14), `availability: "ok" \| "missing"` (C0 `ProjectAvailability`; a missing folder is listed as "Folder not found", operator decision 2026-09-26, Tasks 12–14); no `kind` |
| `ProjectCreate` | `{name, folder, type_ids}` |
| `POST /api/v1/projects/migrations/retry` | body `{folder}` |
| `GET /api/v1/catalogue/types` | `{items: CatalogueType[]}`, `CatalogueType {id, name, colour, kind, archived, group}`; 503 `catalogue_unavailable` |
| `GET /api/v1/catalogue/severity` | loaded by S2 into DS's `SeverityScaleContext`; without a provider `useSeverityScale` returns the D4 default, which S1's tests rely on (`severityRoute` is kept in the fixtures for a provider that fetches) |
| `ClassDef` | + `kind`, `default_severity`, `group` |
| `Event.type` | + `findings.changed`, `data.changed`, `migration.changed` |
| `JobType` | + `project_migrate` |

## File map

**Create**

| File | Task | Responsibility |
|---|---|---|
| `frontend/src/api/findings.ts` (+ `.test.ts`) | 1 | typed calls and image URLs for findings, comments, attachments, activity, summary, bulk |
| `frontend/src/api/overview.ts` | 1 | `fetchOverview` |
| `frontend/src/api/dataItems.ts` | 1 | `listDataItems` |
| `frontend/src/test/findingFixtures.ts` | 1 | findings, summary, overview, activity, types and route fixtures |
| `frontend/src/store/changes.findings.test.ts` | 1 | the new revisions |
| `frontend/src/findings/format.ts`, `status.ts`, `links.ts`, `filters.ts`, `location.ts`, `model.test.ts` | 2 | pure findings model |
| `frontend/src/findings/useFindingsList.ts`, `useFindingSummary.ts`, `useDataLabels.ts`, `useProjectTypes.ts`, `hooks.test.tsx` | 3 | paged list and lookups |
| `frontend/src/findings/FindingThumb.tsx`, `FindingFilters.tsx`, `columns.tsx`, `FindingsScreen.tsx`, `FindingsScreen.test.tsx` | 4 | the Findings tab |
| `frontend/src/findings/inspectorStore.ts`, `FindingInspector.tsx`, `inspector/useFinding.ts`, `inspector/fields.tsx`, `inspector/Provenance.tsx`, `FindingInspector.test.tsx` | 5 | shared inspector, core |
| `frontend/src/findings/inspector/useAutosave.ts`, `NoteField.tsx`, `Attachments.tsx`, `Comments.tsx`, `History.tsx`, `FindingInspector.sections.test.tsx` | 6 | note, photos, comments, history |
| `frontend/src/findings/BulkBar.tsx`, `keys.ts`, `useFindingKeys.ts`, `FindingsScreen.keys.test.tsx` | 7 | bulk status/severity, keyboard |
| `frontend/src/data/addDataTiles.ts`, `AddDataDialog.tsx`, `AddDataDialog.test.tsx` | 8 | Add data |
| `frontend/src/surfaces/ImportElevationDialog.tsx` (+ `.test.tsx`) | 8 | the elevation chooser (M extends it) |
| `frontend/src/overview/kpis.ts`, `heroPins.ts`, `model.test.ts` | 9 | Overview pure model |
| `frontend/src/overview/overview.css`, `MapHero.tsx`, `MapHero.test.tsx` | 10 | hero map with pins |
| `frontend/src/overview/useOverview.ts`, `KpiRow.tsx`, `SeverityBars.tsx`, `RunningJobs.tsx`, `RecentFindings.tsx`, `ActivityFeed.tsx`, `Banners.tsx`, `OverviewScreen.tsx`, `OverviewScreen.test.tsx` | 11 | Overview screen |
| `frontend/src/screens/projects/projectCards.ts`, `projectCards.test.ts`, `projectFixtures.ts` | 12 | Projects model |
| `frontend/src/screens/projects/ProjectCard.tsx`, `MigrationDetailsDialog.tsx` | 13 | cards |
| `frontend/src/screens/projects/FolderField.tsx`, `NewProjectDialog.tsx`, `OpenFolderDialog.tsx`, `catalogueTypes.ts` | 14 | dialogs |
| `frontend/e2e/project-screens.spec.ts` | 15 | e2e of Overview, Findings, Add data |

**Modify:** `frontend/src/store/changes.ts` (1), `frontend/src/routes/projectRoutes.tsx` (4, 11),
`frontend/src/app/AddDataHost.tsx` (+ test, body replaced, 8), `frontend/src/screens/ProjectsScreen.tsx` and
`ProjectsScreen.test.tsx` (rewritten, 13, 14), `frontend/e2e/projects.spec.ts` (rewritten, 15).

**Move:** `frontend/src/app/AdoptionBanner.tsx` (+ test) → `frontend/src/overview/` (11).

**Delete:** nothing — SH already deletes `HomeScreen` and `useHomePreviews` (Task 11 checks).

---

### Task 0: Reconcile names with the merged DS, SH, BC and BK

**Files:**
- Create: `.superpowers/sdd/f-s1/ledger.md`

**Interfaces:**
- Consumes: `main` with SH, BC, BK (and C0, DS) merged.
- Produces: the ledger's "Name map" table that every later task reads.

- [ ] **Step 1: Create the worktree**

Run (PowerShell, from `E:\Dev\Yolo\app`): `.\scripts\start-task.ps1 -Name f-s1`
Expected: `worktree add` succeeds and pnpm installs in `.claude\worktrees\f-s1`.

- [ ] **Step 2: Confirm the prerequisites are on the branch**

Run: `git -C .claude/worktrees/f-s1 log --oneline main -40`
Expected: merge commits for SH, BC and BK (and C0, DS). If any is missing, stop: S1 cannot start.

- [ ] **Step 3: Find each consumed name**

Run from `.claude/worktrees/f-s1/frontend`:
```
rg -n "export (function|const|type|interface) (GlassPanel|StatTile|StatDelta|SeverityPill|SeverityPicker|useSeverityScale|StatusDot|TypeChip|DataTable|Column|InspectorLayout|InspectorPane|InspectorSection|MenuButton|Popover|Combobox|stagger|useReducedMotion|isTypingTarget|GLOBAL_KEYS|REVIEW_KEYS|KeyEntry)" src/ui
rg -n "export" src/app/effects.ts src/app/addDataStore.ts src/app/AddDataHost.tsx src/routes/projectRoutes.tsx
rg -n "InterimScreens|AddDataHost" src/app/Shell.tsx src/routes/projectRoutes.tsx
rg -n "findings.changed|data.changed|migration.changed|project_migrate|last_opened_at|file_name|previous_net_m3|hero_map_id|open_top_severity" ../contract/client/schema.d.ts
rg -n "stagger" src/index.css src/ui tailwind.config.ts
```
Expected: one hit per name, or a different name to record.

- [ ] **Step 4: Write the ledger**

Create `.superpowers/sdd/f-s1/ledger.md` with a table `| Plan name | Merged name / file | Note |`
covering every row of "Consumed interfaces" and "Contract assumptions". For any **contract** field
that is missing, stop and raise it with the coordinator before Task 1. For a **DS/SH** prop that
differs, record the real one; implementers adapt the call sites in their task (same behaviour).
Record whether DS ships a stagger utility (ambiguity 16) and whether SH already deleted
`HomeScreen` / moved `AdoptionBanner` (ambiguity 17).

- [ ] **Step 5: Commit**

```bash
git add .superpowers/sdd/f-s1/ledger.md
git commit -m "docs(sdd): f-s1 ledger with the reconciled DS/SH/contract names

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

### Task 1: API layer, fixtures and change revisions

**Files:**
- Create: `frontend/src/api/findings.ts`, `frontend/src/api/overview.ts`, `frontend/src/api/dataItems.ts`
- Create: `frontend/src/test/findingFixtures.ts`
- Modify: `frontend/src/store/changes.ts`
- Test: `frontend/src/api/findings.test.ts`, `frontend/src/store/changes.findings.test.ts`

**Interfaces:**
- Consumes: `@contract/client` (`ApiClient`, `components`, `paths`), `unwrap` from `./errors`,
  `Page` from `./paging`.
- Produces:
  - types `Finding`, `FindingDetail`, `FindingAnchor`, `FindingStatus`, `FindingPatch`,
    `FindingListQuery`, `FindingComment`, `FindingAttachment`, `FindingSummary`, `Activity`,
    `BulkSet`, `BulkResult`, `ProjectOverview`, `DataItem`, `DataItemType`
  - `listFindings(api, projectId, query): Promise<Page<Finding>>`
  - `fetchFinding(api, projectId, findingId): Promise<FindingDetail>`
  - `patchFinding(api, projectId, findingId, patch): Promise<FindingDetail>`
  - `deleteFinding(api, projectId, findingId): Promise<void>`
  - `bulkUpdateFindings(api, projectId, ids: string[], set: BulkSet): Promise<BulkResult>`; `FINDINGS_BULK_MAX = 1000`
  - `fetchFindingSummary(api, projectId): Promise<FindingSummary>`
  - `listComments(api, projectId, findingId, cursor?)`, `addComment(…, text)`, `editComment(…, commentId, text)`, `deleteComment(…, commentId)`
  - `listAttachments(api, projectId, findingId): Promise<FindingAttachment[]>`, `addAttachment(…, path)`, `deleteAttachment(…, attachmentId)`
  - `listActivity(api, projectId, {subject_id?, limit?, cursor?}): Promise<Page<Activity>>`
  - `findingThumbnailUrl(baseUrl, token, projectId, findingId)`, `attachmentThumbnailUrl(…, findingId, attachmentId)`, `attachmentFileUrl(…)`
  - `fetchOverview(api, projectId): Promise<ProjectOverview>`
  - `listDataItems(api, projectId, {type?, limit?, cursor?}): Promise<Page<DataItem>>`
  - `useChangesStore`: `findingsRevision`, `dataRevision`, `projectsRevision`, `bumpFindings()`, `bumpData()`
  - fixtures: `FINDING_ID`, `FINDING_ID_2`, `TYPE_SPALLING`, `TYPE_CRACK`, `TYPE_EXCAVATOR`,
    `projectTypes`, `SEVERITY_SCALE`, `severityRoute`, `exampleFinding`, `exampleFinding2`,
    `exampleFindingDetail`, `exampleSummary`, `emptySummary`, `exampleOverview`, `emptyOverview`,
    `exampleActivity`, `exampleComment`, `exampleAttachment`, `exampleDataItem`, `typedProject`,
    `baseRoutes(overrides)`

- [ ] **Step 1: Write the fixtures**

`frontend/src/test/findingFixtures.ts`:

```ts
import type { ClassDef, Project } from "@contract/client";
import type { DataItem } from "@/api/dataItems";
import type {
  Activity,
  Finding,
  FindingAttachment,
  FindingComment,
  FindingDetail,
  FindingSummary,
} from "@/api/findings";
import type { ProjectOverview } from "@/api/overview";
import { exampleProject, IMAGE_ID, MAP_ID, MODEL_ID, SOURCE_ID, type FakeRoute } from "./fixtures";

export const FINDING_ID = "f0000000-9999-4000-8000-000000000217";
export const FINDING_ID_2 = "f0000000-9999-4000-8000-000000000218";
export const ANNOTATION_ID = "b0000000-1212-4000-8000-000000000001";
export const TYPE_SPALLING = "t0000000-1111-4000-8000-000000000001";
export const TYPE_CRACK = "t0000000-1111-4000-8000-000000000002";
export const TYPE_EXCAVATOR = "t0000000-1111-4000-8000-000000000003";

export const projectTypes: ClassDef[] = [
  { id: TYPE_SPALLING, name: "Spalling", colour: "#ff5a4f", hotkey: null, order: 0, kind: "defect", default_severity: 3, group: "Concrete defects" },
  { id: TYPE_CRACK, name: "Crack", colour: "#ff9c3a", hotkey: null, order: 1, kind: "defect", default_severity: null, group: null },
  { id: TYPE_EXCAVATOR, name: "excavator", colour: "#f97316", hotkey: "1", order: 2, kind: "object", default_severity: null, group: null },
];

/** The example project with a catalogue type list (defects and one object). */
export const typedProject: Project = { ...exampleProject, classes: projectTypes };

export const SEVERITY_SCALE = [
  { level: 1, name: "Minor", colour: "#3fb68e" },
  { level: 2, name: "Moderate", colour: "#e2bf2e" },
  { level: 3, name: "Major", colour: "#ff9c3a" },
  { level: 4, name: "Critical", colour: "#ff5a4f" },
];

/** The scale endpoint, for tests that mount S2's provider; DS's default scale equals SEVERITY_SCALE. */
export const severityRoute: FakeRoute = {
  method: "GET",
  path: /\/catalogue\/severity$/,
  body: { items: SEVERITY_SCALE },
};

export const exampleFinding: Finding = {
  id: FINDING_ID,
  number: 217,
  type_id: TYPE_SPALLING,
  severity: 4,
  status: "open",
  note: "Spall at the column base, north face.",
  created_by: `model:${MODEL_ID}`,
  confidence: 0.87,
  anchor: { kind: "image", image_id: IMAGE_ID, annotation_id: ANNOTATION_ID },
  lon: 47.765,
  lat: 29.495,
  data_type: "image_set",
  data_id: SOURCE_ID,
  created_at: "2026-09-14T09:00:00Z",
  updated_at: "2026-09-14T11:06:00Z",
  reviewed_at: null,
  closed_at: null,
};

export const exampleFinding2: Finding = {
  ...exampleFinding,
  id: FINDING_ID_2,
  number: 218,
  type_id: TYPE_CRACK,
  severity: null,
  status: "closed",
  created_by: "human",
  confidence: null,
  anchor: { kind: "map", map_id: MAP_ID, geometry: { type: "Point", coordinates: [500, 500] } },
  data_type: "map",
  data_id: MAP_ID,
  closed_at: "2026-09-20T08:00:00Z",
};

export const exampleFindingDetail: FindingDetail = {
  ...exampleFinding,
  attachment_count: 1,
  comment_count: 1,
};

/** 30 days ending 2026-09-26: open 41 a week ago, 47 today; two closures this week. */
function trend(): FindingSummary["trend"] {
  const days: FindingSummary["trend"] = [];
  for (let i = 29; i >= 0; i -= 1) {
    const day = new Date(Date.UTC(2026, 8, 26 - i)).toISOString().slice(0, 10);
    days.push({ day, open: i >= 7 ? 41 : 47 - i, open_by_severity: {}, closed: i === 2 || i === 5 ? 1 : 0 });
  }
  return days;
}

export const exampleSummary: FindingSummary = {
  by_status: { open: 47, reviewed: 12, closed: 30 },
  open_by_severity: { "1": 9, "2": 19, "3": 14, "4": 5 },
  open_no_severity: 0,
  by_type: [
    { type_id: TYPE_SPALLING, n: 20 },
    { type_id: TYPE_CRACK, n: 27 },
  ],
  trend: trend(),
};

export const emptySummary: FindingSummary = {
  by_status: { open: 0, reviewed: 0, closed: 0 },
  open_by_severity: {},
  open_no_severity: 0,
  by_type: [],
  trend: [],
};

export const exampleOverview: ProjectOverview = {
  findings: exampleSummary,
  data: { image_sets: 2, images: 1284, maps: 3, elevations: 1, point_clouds: 2, drawings: 0 },
  latest_volume: {
    measurement_id: "v0000000-8888-4000-8000-000000000001",
    name: "Stockpile N",
    net_m3: 12480,
    previous_net_m3: 12893,
  },
  hero_map_id: MAP_ID,
  banners: [],
};

export const emptyOverview: ProjectOverview = {
  findings: emptySummary,
  data: { image_sets: 0, images: 0, maps: 0, elevations: 0, point_clouds: 0, drawings: 0 },
  latest_volume: null,
  hero_map_id: null,
  banners: [],
};

export const exampleActivity: Activity[] = [
  { id: "a1", at: "2026-09-26T09:48:00Z", kind: "detections.accepted", subject_id: null, summary: "9 detections accepted as findings", payload: {} },
  { id: "a2", at: "2026-09-26T09:00:00Z", kind: "finding.severity", subject_id: FINDING_ID, summary: "F-0217 set to Critical", payload: {} },
  { id: "a3", at: "2026-09-25T15:00:00Z", kind: "data.imported", subject_id: SOURCE_ID, summary: "Photos imported: Flight 14 Sep", payload: {} },
];

export const exampleComment: FindingComment = {
  id: "c0000000-0000-4000-8000-000000000001",
  finding_id: FINDING_ID,
  author: "Operator",
  text: "Depth measured with a gauge: 28 mm.",
  created_at: "2026-09-26T08:00:00Z",
  edited_at: null,
};

export const exampleAttachment: FindingAttachment = {
  id: "p0000000-0000-4000-8000-000000000001",
  finding_id: FINDING_ID,
  path: `findings/${FINDING_ID}/p0000000-0000-4000-8000-000000000001.jpg`,
  original_name: "site-photo.jpg",
  width: 4000,
  height: 3000,
  bytes: 2_400_000,
  created_at: "2026-09-26T08:05:00Z",
};

export const exampleDataItem: DataItem = {
  id: SOURCE_ID,
  type: "image_set",
  label: "Flight 14 Sep",
  captured_on: "2026-09-14",
  status: "ready",
  summary: { image_count: 312, duplicate_count: 0 },
  created_at: "2026-09-14T12:00:00Z",
};

/** Routes most findings screens need; `overrides` come first, so they win. */
export function baseRoutes(overrides: FakeRoute[] = []): FakeRoute[] {
  return [
    ...overrides,
    { method: "GET", path: /\/projects\/[^/]+$/, body: typedProject },
    severityRoute,
    { method: "GET", path: /\/projects\/[^/]+\/data$/, body: { items: [exampleDataItem], next_cursor: null } },
    { method: "GET", path: /\/findings\/summary$/, body: exampleSummary },
  ];
}
```

- [ ] **Step 2: Write the failing API test**

`frontend/src/api/findings.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { fakeClient, PROJECT_ID } from "@/test/fixtures";
import { exampleFinding, FINDING_ID } from "@/test/findingFixtures";
import {
  bulkUpdateFindings,
  findingThumbnailUrl,
  listActivity,
  listFindings,
  patchFinding,
} from "./findings";

describe("findings API", () => {
  it("sends repeated filter params, the sort and the cursor", async () => {
    const { api, requests } = fakeClient([
      { method: "GET", path: /\/findings$/, body: { items: [exampleFinding], next_cursor: null } },
    ]);
    const page = await listFindings(api, PROJECT_ID, {
      status: ["open", "reviewed"],
      severity: [4, "none"],
      sort: "-severity",
      limit: 200,
      cursor: "c1",
    });
    expect(page.items[0].number).toBe(217);
    const params = new URL(requests[0].url, "http://fake").searchParams;
    expect(params.getAll("status")).toEqual(["open", "reviewed"]);
    expect(params.getAll("severity")).toEqual(["4", "none"]);
    expect(params.get("sort")).toBe("-severity");
    expect(params.get("cursor")).toBe("c1");
  });

  it("patches one finding and posts a bulk change", async () => {
    const { api, requests } = fakeClient([
      { method: "PATCH", path: /\/findings\/[^/]+$/, body: { ...exampleFinding, severity: 2, attachment_count: 0, comment_count: 0 } },
      { method: "POST", path: /\/findings\/bulk$/, body: { updated: 1, skipped: [] } },
    ]);
    const saved = await patchFinding(api, PROJECT_ID, FINDING_ID, { severity: 2 });
    expect(saved.severity).toBe(2);
    const result = await bulkUpdateFindings(api, PROJECT_ID, [FINDING_ID], { status: "closed" });
    expect(result.updated).toBe(1);
    expect(requests[1].body).toEqual({ ids: [FINDING_ID], set: { status: "closed" } });
  });

  it("filters the activity feed by subject", async () => {
    const { api, requests } = fakeClient([
      { method: "GET", path: /\/activity$/, body: { items: [], next_cursor: null } },
    ]);
    await listActivity(api, PROJECT_ID, { subject_id: FINDING_ID, limit: 20 });
    const params = new URL(requests[0].url, "http://fake").searchParams;
    expect(params.get("subject_id")).toBe(FINDING_ID);
    expect(params.get("limit")).toBe("20");
  });

  it("puts the token in the thumbnail query, escaped", () => {
    expect(findingThumbnailUrl("http://h:1/", "a b", PROJECT_ID, FINDING_ID)).toBe(
      `http://h:1/api/v1/projects/${PROJECT_ID}/findings/${FINDING_ID}/thumbnail?token=a%20b`,
    );
  });
});
```

- [ ] **Step 3: Run it to verify it fails**

Run: `pnpm -C frontend exec vitest run src/api/findings.test.ts`
Expected: FAIL — `Failed to resolve import "./findings"`.

- [ ] **Step 4: Write the API modules**

`frontend/src/api/findings.ts`:

```ts
import type { ApiClient, components, paths } from "@contract/client";
import { unwrap } from "./errors";
import type { Page } from "./paging";

type S = components["schemas"];
const P = "/api/v1/projects/{projectId}" as const;
type ListPath = paths["/api/v1/projects/{projectId}/findings"];
type ItemPath = paths["/api/v1/projects/{projectId}/findings/{findingId}"];
type BulkPath = paths["/api/v1/projects/{projectId}/findings/bulk"];

export type Finding = S["Finding"];
export type FindingAnchor = S["FindingAnchor"];
export type FindingStatus = Finding["status"];
export type FindingDetail = ItemPath["get"]["responses"][200]["content"]["application/json"];
export type FindingPatch = NonNullable<ItemPath["patch"]["requestBody"]>["content"]["application/json"];
export type FindingListQuery = NonNullable<ListPath["get"]["parameters"]["query"]>;
export type FindingComment = S["FindingComment"];
export type FindingAttachment = S["FindingAttachment"];
export type FindingSummary = S["FindingSummary"];
export type Activity = S["Activity"];
export type BulkSet = NonNullable<BulkPath["post"]["requestBody"]>["content"]["application/json"]["set"];
export type BulkResult = BulkPath["post"]["responses"][200]["content"]["application/json"];

/** F §8.3: `POST /findings/bulk` takes at most this many ids. */
export const FINDINGS_BULK_MAX = 1000;

export function listFindings(api: ApiClient, projectId: string, query: FindingListQuery): Promise<Page<Finding>> {
  return unwrap(api.GET(`${P}/findings`, { params: { path: { projectId }, query } }));
}

export function fetchFinding(api: ApiClient, projectId: string, findingId: string): Promise<FindingDetail> {
  return unwrap(api.GET(`${P}/findings/{findingId}`, { params: { path: { projectId, findingId } } }));
}

export function patchFinding(
  api: ApiClient,
  projectId: string,
  findingId: string,
  patch: FindingPatch,
): Promise<FindingDetail> {
  return unwrap(
    api.PATCH(`${P}/findings/{findingId}`, { params: { path: { projectId, findingId } }, body: patch }),
  );
}

export async function deleteFinding(api: ApiClient, projectId: string, findingId: string): Promise<void> {
  await unwrap(api.DELETE(`${P}/findings/{findingId}`, { params: { path: { projectId, findingId } } }));
}

export function bulkUpdateFindings(
  api: ApiClient,
  projectId: string,
  ids: string[],
  set: BulkSet,
): Promise<BulkResult> {
  return unwrap(api.POST(`${P}/findings/bulk`, { params: { path: { projectId } }, body: { ids, set } }));
}

export function fetchFindingSummary(api: ApiClient, projectId: string): Promise<FindingSummary> {
  return unwrap(api.GET(`${P}/findings/summary`, { params: { path: { projectId } } }));
}

export function listComments(
  api: ApiClient,
  projectId: string,
  findingId: string,
  cursor?: string,
): Promise<Page<FindingComment>> {
  return unwrap(
    api.GET(`${P}/findings/{findingId}/comments`, {
      params: { path: { projectId, findingId }, query: { limit: 50, ...(cursor ? { cursor } : {}) } },
    }),
  );
}

export function addComment(api: ApiClient, projectId: string, findingId: string, text: string): Promise<FindingComment> {
  return unwrap(
    api.POST(`${P}/findings/{findingId}/comments`, { params: { path: { projectId, findingId } }, body: { text } }),
  );
}

export function editComment(
  api: ApiClient,
  projectId: string,
  findingId: string,
  commentId: string,
  text: string,
): Promise<FindingComment> {
  return unwrap(
    api.PATCH(`${P}/findings/{findingId}/comments/{commentId}`, {
      params: { path: { projectId, findingId, commentId } },
      body: { text },
    }),
  );
}

export async function deleteComment(
  api: ApiClient,
  projectId: string,
  findingId: string,
  commentId: string,
): Promise<void> {
  await unwrap(
    api.DELETE(`${P}/findings/{findingId}/comments/{commentId}`, {
      params: { path: { projectId, findingId, commentId } },
    }),
  );
}

export async function listAttachments(
  api: ApiClient,
  projectId: string,
  findingId: string,
): Promise<FindingAttachment[]> {
  const r = await unwrap(
    api.GET(`${P}/findings/{findingId}/attachments`, { params: { path: { projectId, findingId } } }),
  );
  return r.items;
}

/** `path` is a local file chosen in the Tauri dialog; the backend validates and copies it (≤ 50 MB). */
export function addAttachment(
  api: ApiClient,
  projectId: string,
  findingId: string,
  path: string,
): Promise<FindingAttachment> {
  return unwrap(
    api.POST(`${P}/findings/{findingId}/attachments`, { params: { path: { projectId, findingId } }, body: { path } }),
  );
}

export async function deleteAttachment(
  api: ApiClient,
  projectId: string,
  findingId: string,
  attachmentId: string,
): Promise<void> {
  await unwrap(
    api.DELETE(`${P}/findings/{findingId}/attachments/{attachmentId}`, {
      params: { path: { projectId, findingId, attachmentId } },
    }),
  );
}

export function listActivity(
  api: ApiClient,
  projectId: string,
  query: { subject_id?: string; limit?: number; cursor?: string },
): Promise<Page<Activity>> {
  return unwrap(api.GET(`${P}/activity`, { params: { path: { projectId }, query } }));
}

/** `<img src>` URLs carry the token in the query, as today's image thumbnails do. */
function tokenUrl(baseUrl: string, token: string, path: string): string {
  return `${baseUrl.replace(/\/$/, "")}${path}?token=${encodeURIComponent(token)}`;
}

export function findingThumbnailUrl(baseUrl: string, token: string, projectId: string, findingId: string): string {
  return tokenUrl(baseUrl, token, `/api/v1/projects/${projectId}/findings/${findingId}/thumbnail`);
}

export function attachmentThumbnailUrl(
  baseUrl: string,
  token: string,
  projectId: string,
  findingId: string,
  attachmentId: string,
): string {
  return tokenUrl(baseUrl, token, `/api/v1/projects/${projectId}/findings/${findingId}/attachments/${attachmentId}/thumbnail`);
}

export function attachmentFileUrl(
  baseUrl: string,
  token: string,
  projectId: string,
  findingId: string,
  attachmentId: string,
): string {
  return tokenUrl(baseUrl, token, `/api/v1/projects/${projectId}/findings/${findingId}/attachments/${attachmentId}/file`);
}
```

`frontend/src/api/overview.ts`:

```ts
import type { ApiClient, components } from "@contract/client";
import { unwrap } from "./errors";

export type ProjectOverview = components["schemas"]["ProjectOverview"];

/** F §9.1: one pre-aggregated read; it never scans findings, boxes or images. */
export function fetchOverview(api: ApiClient, projectId: string): Promise<ProjectOverview> {
  return unwrap(api.GET("/api/v1/projects/{projectId}/overview", { params: { path: { projectId } } }));
}
```

`frontend/src/api/dataItems.ts`:

```ts
import type { ApiClient, components } from "@contract/client";
import { unwrap } from "./errors";
import type { Page } from "./paging";

export type DataItem = components["schemas"]["DataItem"];
export type DataItemType = components["schemas"]["DataItemType"];

/** F §6.3: the union of every data type, keyset-paged. */
export function listDataItems(
  api: ApiClient,
  projectId: string,
  query: { type?: DataItemType[]; limit?: number; cursor?: string },
): Promise<Page<DataItem>> {
  return unwrap(api.GET("/api/v1/projects/{projectId}/data", { params: { path: { projectId }, query } }));
}
```

- [ ] **Step 5: Run the API test**

Run: `pnpm -C frontend exec vitest run src/api/findings.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 6: Write the failing revisions test**

`frontend/src/store/changes.findings.test.ts`:

```ts
import { beforeEach, describe, expect, it } from "vitest";
import type { AppEvent } from "@contract/client";
import { useChangesStore } from "./changes";

const ev = (type: AppEvent["type"]): AppEvent => ({ type, payload: {} }) as AppEvent;

describe("changes store: findings, data and migrations", () => {
  beforeEach(() => useChangesStore.setState({ findingsRevision: 0, dataRevision: 0, projectsRevision: 0 }));

  it("bumps each revision on its own event only", () => {
    const s = useChangesStore.getState();
    s.applyEvent(ev("findings.changed"));
    s.applyEvent(ev("data.changed"));
    s.applyEvent(ev("migration.changed"));
    s.applyEvent(ev("data.changed"));
    expect(useChangesStore.getState()).toMatchObject({ findingsRevision: 1, dataRevision: 2, projectsRevision: 1 });
  });

  it("lets this client bump after its own writes", () => {
    useChangesStore.getState().bumpFindings();
    useChangesStore.getState().bumpData();
    expect(useChangesStore.getState()).toMatchObject({ findingsRevision: 1, dataRevision: 1 });
  });
});
```

- [ ] **Step 7: Run it to verify it fails**

Run: `pnpm -C frontend exec vitest run src/store/changes.findings.test.ts`
Expected: FAIL — `projectsRevision` stays `undefined` and `bumpFindings` is not a function.

- [ ] **Step 8: Extend the store**

SH already added `dataRevision` and `findingsRevision` with their two events (SH plan Task 5); check
with `rg -n "Revision" frontend/src/store/changes.ts` and add only what is missing. The complete set
in `frontend/src/store/changes.ts`'s `ChangesState` is:

```ts
  /** Bumped on `findings.changed` and after this client's own finding writes (F §8.3). */
  findingsRevision: number;
  /** Bumped on `data.changed` and when Add data queues an import (F §6.3). */
  dataRevision: number;
  /** Bumped on `migration.changed`: the Projects list re-reads (F §11.3). */
  projectsRevision: number;
  bumpFindings: () => void;
  bumpData: () => void;
```

In the store body (again only the missing members), next to `bumpImages`:

```ts
  findingsRevision: 0,
  dataRevision: 0,
  projectsRevision: 0,
  bumpFindings: () => set((s) => ({ findingsRevision: s.findingsRevision + 1 })),
  bumpData: () => set((s) => ({ dataRevision: s.dataRevision + 1 })),
```

and in `applyEvent`, before the final `return s;` (SH has the first two lines):

```ts
      if (ev.type === "findings.changed") return { findingsRevision: s.findingsRevision + 1 };
      if (ev.type === "data.changed") return { dataRevision: s.dataRevision + 1 };
      if (ev.type === "migration.changed") return { projectsRevision: s.projectsRevision + 1 };
```

- [ ] **Step 9: Run the tests and the type check**

Run: `pnpm -C frontend exec vitest run src/store src/api/findings.test.ts`
Expected: PASS (every changes test, old and new).
Run: `pnpm -C frontend exec tsc -b`
Expected: exit 0. A type error on a schema or path name means the contract differs from
"Contract assumptions": stop and raise it (Task 0 Step 4).

- [ ] **Step 10: Commit**

```bash
git add frontend/src/api/findings.ts frontend/src/api/findings.test.ts frontend/src/api/overview.ts frontend/src/api/dataItems.ts frontend/src/test/findingFixtures.ts frontend/src/store/changes.ts frontend/src/store/changes.findings.test.ts
git commit -m "feat(findings): typed findings, overview and data list calls; change revisions

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

### Task 2: Findings pure model (format, status, links, filters, location)

**Files:**
- Create: `frontend/src/findings/format.ts`, `status.ts`, `links.ts`, `filters.ts`, `location.ts`
- Test: `frontend/src/findings/model.test.ts`

**Interfaces:**
- Consumes: `Finding`, `FindingStatus`, `FindingListQuery` (Task 1); `IconName` from `@/ui`.
- Produces:
  - `formatFindingNumber(n: number): string` → `"F-0217"`
  - `relativeTime(iso: string, nowMs: number): string`
  - `parseCreatedBy(v: string): CreatedBy` (`{kind:"human"} | {kind:"model"; modelId}`)
  - `formatPercent(v: number | null): string | null`
  - `STATUS_LABEL: Record<FindingStatus, string>`, `canTransition(from, to): boolean`
  - `findingPath(projectId, findingId)`, `findingHref(projectId, finding: Pick<Finding,"id"|"anchor">)`
  - `FindingFilters`, `SeverityFilter`, `SourceKind`, `FindingSort`, `FINDING_SORTS`,
    `DEFAULT_FILTERS`, `parseFilters(search)`, `filtersToSearch(f)`, `filtersToQuery(f)`,
    `isFiltered(f)`, `findingsListPath(projectId, partial)`
  - `findingLocation(f, labels): FindingLocation` (`{icon, primary, secondary}`), `SOURCE_LABEL`

- [ ] **Step 1: Write the failing test**

`frontend/src/findings/model.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { IMAGE_ID, MAP_ID, PROJECT_ID, SOURCE_ID } from "@/test/fixtures";
import { exampleFinding, exampleFinding2, FINDING_ID } from "@/test/findingFixtures";
import { formatFindingNumber, formatPercent, parseCreatedBy, relativeTime } from "./format";
import { canTransition } from "./status";
import { findingHref, findingPath } from "./links";
import {
  DEFAULT_FILTERS,
  filtersToQuery,
  filtersToSearch,
  findingsListPath,
  isFiltered,
  parseFilters,
} from "./filters";
import { findingLocation } from "./location";

const NOW = Date.parse("2026-09-26T12:00:00Z");

describe("format", () => {
  it("pads finding numbers to four digits and never truncates", () => {
    expect(formatFindingNumber(7)).toBe("F-0007");
    expect(formatFindingNumber(217)).toBe("F-0217");
    expect(formatFindingNumber(12345)).toBe("F-12345");
  });

  it("says how long ago, then falls back to a date", () => {
    expect(relativeTime("2026-09-26T11:59:40Z", NOW)).toBe("just now");
    expect(relativeTime("2026-09-26T11:48:00Z", NOW)).toBe("12 min ago");
    expect(relativeTime("2026-09-26T09:00:00Z", NOW)).toBe("3 h ago");
    expect(relativeTime("2026-09-25T10:00:00Z", NOW)).toBe("yesterday");
    expect(relativeTime("2026-09-22T12:00:00Z", NOW)).toBe("4 d ago");
    expect(relativeTime("2026-09-12T12:00:00Z", NOW)).toBe("12 Sep");
    expect(relativeTime("not a date", NOW)).toBe("");
  });

  it("reads who created a finding", () => {
    expect(parseCreatedBy("human")).toEqual({ kind: "human" });
    expect(parseCreatedBy("model:m-1")).toEqual({ kind: "model", modelId: "m-1" });
    expect(parseCreatedBy("model:")).toEqual({ kind: "human" });
  });

  it("formats confidence as a whole percent", () => {
    expect(formatPercent(0.874)).toBe("87%");
    expect(formatPercent(null)).toBeNull();
  });
});

describe("status transitions (F §8.2)", () => {
  it("refuses only closed → reviewed, and no-op moves", () => {
    expect(canTransition("open", "reviewed")).toBe(true);
    expect(canTransition("open", "closed")).toBe(true);
    expect(canTransition("reviewed", "open")).toBe(true);
    expect(canTransition("closed", "open")).toBe(true);
    expect(canTransition("closed", "reviewed")).toBe(false);
    expect(canTransition("open", "open")).toBe(false);
  });
});

describe("finding links (F §8.7)", () => {
  it("builds the canonical link and one workspace link per anchor", () => {
    expect(findingPath(PROJECT_ID, FINDING_ID)).toBe(`/p/${PROJECT_ID}/findings/${FINDING_ID}`);
    expect(findingHref(PROJECT_ID, exampleFinding)).toBe(`/p/${PROJECT_ID}/images/${IMAGE_ID}?finding=${FINDING_ID}`);
    expect(findingHref(PROJECT_ID, exampleFinding2)).toBe(
      `/p/${PROJECT_ID}/maps?map=${MAP_ID}&finding=${exampleFinding2.id}`,
    );
    const cloud = { id: "f9", anchor: { kind: "cloud", cloud_id: "c1", x: 1, y: 2, z: 3, uncertainty_m: 0.1 } } as const;
    expect(findingHref(PROJECT_ID, cloud)).toBe(`/p/${PROJECT_ID}/clouds/c1?finding=f9`);
  });
});

describe("filters ↔ URL ↔ query", () => {
  it("parses the URL, dropping unknown and malformed values", () => {
    const f = parseFilters(
      new URLSearchParams("status=open&severity=4&severity=none&severity=x&type_id=t1&anchor_kind=map&anchor_kind=disk&q=crack&sort=bogus"),
    );
    expect(f).toEqual({ status: "open", severity: [4, "none"], typeIds: ["t1"], source: ["map"], q: "crack", sort: "-severity" });
    expect(parseFilters(new URLSearchParams("status=weird")).status).toBeNull();
  });

  it("round-trips and omits defaults", () => {
    const f = { ...DEFAULT_FILTERS, status: "reviewed" as const, severity: [3], sort: "number" as const };
    expect(filtersToSearch(f).toString()).toBe("status=reviewed&severity=3&sort=number");
    expect(parseFilters(filtersToSearch(f))).toEqual(f);
    expect(filtersToSearch(DEFAULT_FILTERS).toString()).toBe("");
  });

  it("turns filters into the API query", () => {
    expect(filtersToQuery({ ...DEFAULT_FILTERS, status: "open", source: ["image"], q: "  spall " })).toEqual({
      sort: "-severity",
      status: ["open"],
      anchor_kind: ["image"],
      q: "spall",
    });
  });

  it("knows when anything is filtered and builds pre-filtered links", () => {
    expect(isFiltered(DEFAULT_FILTERS)).toBe(false);
    expect(isFiltered({ ...DEFAULT_FILTERS, q: "x" })).toBe(true);
    expect(isFiltered({ ...DEFAULT_FILTERS, sort: "number" })).toBe(false);
    expect(findingsListPath(PROJECT_ID, { status: "open", severity: [4] })).toBe(
      `/p/${PROJECT_ID}/findings?status=open&severity=4`,
    );
    expect(findingsListPath(PROJECT_ID, {})).toBe(`/p/${PROJECT_ID}/findings`);
  });
});

describe("finding location", () => {
  it("names the data item and, when the anchor has one, the file", () => {
    const labels = new Map([[SOURCE_ID, "Flight 14 Sep"]]);
    expect(findingLocation(exampleFinding, labels)).toEqual({ icon: "images", primary: "Flight 14 Sep", secondary: null });
    const withFile = { ...exampleFinding, anchor: { ...exampleFinding.anchor, file_name: "DJI_0412.JPG" } };
    expect(findingLocation(withFile, labels).secondary).toBe("DJI_0412.JPG");
    expect(findingLocation(exampleFinding2, new Map())).toEqual({ icon: "map", primary: "Map", secondary: null });
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm -C frontend exec vitest run src/findings/model.test.ts`
Expected: FAIL — `Failed to resolve import "./format"`.

- [ ] **Step 3: Write the modules**

`frontend/src/findings/format.ts`:

```ts
/** F §8.1: `F-` plus at least four digits. */
export function formatFindingNumber(n: number): string {
  return `F-${String(n).padStart(4, "0")}`;
}

/** "just now", "12 min ago", "3 h ago", "yesterday", "4 d ago", then "12 Sep". */
export function relativeTime(iso: string, nowMs: number): string {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return "";
  const s = Math.max(0, Math.round((nowMs - t) / 1000));
  if (s < 60) return "just now";
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} h ago`;
  const d = Math.round(h / 24);
  if (d === 1) return "yesterday";
  if (d < 7) return `${d} d ago`;
  return new Date(t).toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });
}

export type CreatedBy = { kind: "human" } | { kind: "model"; modelId: string };

/** `created_by` is `human` or `model:<library_model_id>` (F §8.1). */
export function parseCreatedBy(v: string): CreatedBy {
  return v.startsWith("model:") && v.length > 6 ? { kind: "model", modelId: v.slice(6) } : { kind: "human" };
}

export function formatPercent(v: number | null): string | null {
  return v === null ? null : `${Math.round(v * 100)}%`;
}
```

`frontend/src/findings/status.ts`:

```ts
import type { FindingStatus } from "@/api/findings";

export const STATUSES: readonly FindingStatus[] = ["open", "reviewed", "closed"];

export const STATUS_LABEL: Record<FindingStatus, string> = { open: "Open", reviewed: "Reviewed", closed: "Closed" };

/** F §8.2: every move is allowed except closed → reviewed (reopen first). */
export function canTransition(from: FindingStatus, to: FindingStatus): boolean {
  return from !== to && !(from === "closed" && to === "reviewed");
}
```

`frontend/src/findings/links.ts`:

```ts
import type { Finding } from "@/api/findings";

/** The canonical finding link: the Findings tab with the inspector open ("Copy link"). */
export function findingPath(projectId: string, findingId: string): string {
  return `/p/${projectId}/findings/${findingId}`;
}

/**
 * F §8.7's one deep-link builder: the workspace of the finding's anchor with `?finding=`. The
 * project id comes first because a finding row (per-project DB) does not carry it.
 */
export function findingHref(projectId: string, finding: Pick<Finding, "id" | "anchor">): string {
  const a = finding.anchor;
  const fid = encodeURIComponent(finding.id);
  switch (a.kind) {
    case "image":
      return `/p/${projectId}/images/${a.image_id}?finding=${fid}`;
    case "map":
      return `/p/${projectId}/maps?map=${a.map_id}&finding=${fid}`;
    case "cloud":
      return `/p/${projectId}/clouds/${a.cloud_id}?finding=${fid}`;
  }
}
```

`frontend/src/findings/filters.ts`:

```ts
import type { FindingListQuery, FindingStatus } from "@/api/findings";
import { STATUSES } from "./status";

export type SourceKind = "image" | "map" | "cloud";
export type SeverityFilter = number | "none";
export const FINDING_SORTS = ["-severity", "number", "-updated_at", "type"] as const;
export type FindingSort = (typeof FINDING_SORTS)[number];

export interface FindingFilters {
  status: FindingStatus | null;
  severity: SeverityFilter[];
  typeIds: string[];
  source: SourceKind[];
  q: string;
  sort: FindingSort;
}

export const DEFAULT_FILTERS: FindingFilters = {
  status: null,
  severity: [],
  typeIds: [],
  source: [],
  q: "",
  sort: "-severity",
};

const SOURCES: readonly SourceKind[] = ["image", "map", "cloud"];
const MAX_Q = 200;

const unique = <T>(xs: T[]): T[] => [...new Set(xs)];

function parseSeverity(v: string): SeverityFilter[] {
  if (v === "none") return ["none"];
  return /^[1-9]\d?$/.test(v) ? [Number(v)] : [];
}

/** The URL uses the API's own parameter names, so a pre-filtered link is also the query. */
export function parseFilters(search: URLSearchParams): FindingFilters {
  const status = search.get("status");
  const sort = search.get("sort");
  return {
    status: STATUSES.includes(status as FindingStatus) ? (status as FindingStatus) : null,
    severity: unique(search.getAll("severity").flatMap(parseSeverity)),
    typeIds: unique(search.getAll("type_id").filter(Boolean)),
    source: unique(search.getAll("anchor_kind").filter((s): s is SourceKind => SOURCES.includes(s as SourceKind))),
    q: (search.get("q") ?? "").slice(0, MAX_Q),
    sort: FINDING_SORTS.includes(sort as FindingSort) ? (sort as FindingSort) : "-severity",
  };
}

export function filtersToSearch(f: FindingFilters): URLSearchParams {
  const s = new URLSearchParams();
  if (f.status) s.set("status", f.status);
  for (const v of f.severity) s.append("severity", String(v));
  for (const v of f.typeIds) s.append("type_id", v);
  for (const v of f.source) s.append("anchor_kind", v);
  if (f.q.trim()) s.set("q", f.q.trim());
  if (f.sort !== DEFAULT_FILTERS.sort) s.set("sort", f.sort);
  return s;
}

export function filtersToQuery(f: FindingFilters): FindingListQuery {
  const q: FindingListQuery = { sort: f.sort };
  if (f.status) q.status = [f.status];
  if (f.severity.length) q.severity = f.severity;
  if (f.typeIds.length) q.type_id = f.typeIds;
  if (f.source.length) q.anchor_kind = f.source;
  if (f.q.trim()) q.q = f.q.trim();
  return q;
}

/** True when the list is narrowed (sort does not narrow). */
export function isFiltered(f: FindingFilters): boolean {
  return Boolean(f.status || f.severity.length || f.typeIds.length || f.source.length || f.q.trim());
}

/** A link into the Findings tab with these filters (the Overview's "View all" and severity bars). */
export function findingsListPath(projectId: string, partial: Partial<FindingFilters>): string {
  const search = filtersToSearch({ ...DEFAULT_FILTERS, ...partial }).toString();
  return `/p/${projectId}/findings${search ? `?${search}` : ""}`;
}
```

`frontend/src/findings/location.ts`:

```ts
import type { Finding } from "@/api/findings";
import type { IconName } from "@/ui";
import type { SourceKind } from "./filters";

const SOURCE_ICON: Record<SourceKind, IconName> = { image: "images", map: "map", cloud: "cloud" };

export const SOURCE_LABEL: Record<SourceKind, string> = { image: "Images", map: "Map", cloud: "Point cloud" };

export interface FindingLocation {
  icon: IconName;
  primary: string;
  secondary: string | null;
}

/**
 * The data item's label (from the Data list), plus the photo's file name when the anchor carries
 * one. Read structurally so a `file_name` added to the image anchor shows without a change here.
 */
export function findingLocation(
  f: Pick<Finding, "anchor" | "data_id">,
  labels: ReadonlyMap<string, string>,
): FindingLocation {
  const kind = f.anchor.kind;
  const anchor: object = f.anchor;
  const fileName = "file_name" in anchor && typeof anchor.file_name === "string" ? anchor.file_name : null;
  const label = f.data_id ? labels.get(f.data_id) : undefined;
  return { icon: SOURCE_ICON[kind], primary: label ?? SOURCE_LABEL[kind], secondary: fileName };
}
```

- [ ] **Step 4: Run the test**

Run: `pnpm -C frontend exec vitest run src/findings/model.test.ts`
Expected: PASS (11 tests).

- [ ] **Step 5: Commit**

```bash
git add frontend/src/findings/format.ts frontend/src/findings/status.ts frontend/src/findings/links.ts frontend/src/findings/filters.ts frontend/src/findings/location.ts frontend/src/findings/model.test.ts
git commit -m "feat(findings): numbers, transitions, deep links and URL filters

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

### Task 3: Findings hooks (paged list, summary, data labels, project types)

**Files:**
- Create: `frontend/src/findings/useFindingsList.ts`, `useFindingSummary.ts`, `useDataLabels.ts`, `useProjectTypes.ts`
- Test: `frontend/src/findings/hooks.test.tsx`

**Interfaces:**
- Consumes: `listFindings`, `fetchFindingSummary`, `listDataItems` (Task 1); `filtersToQuery`,
  `FindingFilters` (Task 2); `useChangesStore` revisions (Task 1); `useProject` (`@/api/project`).
- Produces:
  - `FINDINGS_PAGE = 200`, `FINDINGS_REFRESH_MAX = 500`
  - `useFindingsList(projectId, filters): FindingsList` — `{items: Finding[]; status: "loading" | "ready" | "error"; error: string | null; hasMore: boolean; loadMore(): void; reload(): void}`
  - `useFindingSummary(projectId): FindingSummary | null`
  - `useDataLabels(projectId): ReadonlyMap<string, string>`; `DATA_LABELS_LIMIT = 200`
  - `useProjectTypes(projectId): {loaded: boolean; types: ReadonlyMap<string, ClassDef>; defectTypes: ClassDef[]; all: ClassDef[]}`

- [ ] **Step 1: Write the failing test**

`frontend/src/findings/hooks.test.tsx`:

```tsx
import { beforeEach, describe, expect, it } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { errorBody, fakeClient, PROJECT_ID, SOURCE_ID, type FakeRoute } from "@/test/fixtures";
import { baseRoutes, exampleFinding, TYPE_CRACK, TYPE_SPALLING } from "@/test/findingFixtures";
import { TestApiProvider } from "@/test/render";
import { useChangesStore } from "@/store/changes";
import type { Finding } from "@/api/findings";
import { DEFAULT_FILTERS } from "./filters";
import { FINDINGS_PAGE, FINDINGS_REFRESH_MAX, useFindingsList } from "./useFindingsList";
import { useDataLabels } from "./useDataLabels";
import { useProjectTypes } from "./useProjectTypes";

const many = (from: number, n: number): Finding[] =>
  Array.from({ length: n }, (_, i) => ({ ...exampleFinding, id: `f-${from + i}`, number: from + i }));

function setup(routes: FakeRoute[]) {
  const { api, requests } = fakeClient(routes);
  const wrapper = ({ children }: { children: ReactNode }) => <TestApiProvider api={api}>{children}</TestApiProvider>;
  return { requests, wrapper };
}

const params = (url: string) => new URL(url, "http://fake").searchParams;

describe("useFindingsList", () => {
  beforeEach(() => useChangesStore.setState({ findingsRevision: 0, dataRevision: 0 }));

  it("loads the first page with the filter query", async () => {
    const { requests, wrapper } = setup([
      { method: "GET", path: /\/findings$/, body: { items: many(1, 3), next_cursor: null } },
    ]);
    const { result } = renderHook(() => useFindingsList(PROJECT_ID, { ...DEFAULT_FILTERS, status: "open" }), { wrapper });
    expect(result.current.status).toBe("loading");
    await waitFor(() => expect(result.current.status).toBe("ready"));
    expect(result.current.items).toHaveLength(3);
    expect(result.current.hasMore).toBe(false);
    const p = params(requests[0].url);
    expect(p.get("limit")).toBe(String(FINDINGS_PAGE));
    expect(p.getAll("status")).toEqual(["open"]);
  });

  it("pages with the cursor, dedupes, and stops on a repeated cursor", async () => {
    const { requests, wrapper } = setup([
      {
        method: "GET",
        path: /\/findings$/,
        body: (r) =>
          params(r.url).get("cursor") === "c1"
            ? { items: [...many(2, 1), ...many(3, 2)], next_cursor: "c1" }
            : { items: many(1, 2), next_cursor: "c1" },
      },
    ]);
    const { result } = renderHook(() => useFindingsList(PROJECT_ID, DEFAULT_FILTERS), { wrapper });
    await waitFor(() => expect(result.current.items).toHaveLength(2));
    act(() => result.current.loadMore());
    await waitFor(() => expect(result.current.items).toHaveLength(4));
    expect(result.current.items.map((f) => f.number)).toEqual([1, 2, 3, 4]);
    expect(params(requests[1].url).get("cursor")).toBe("c1");
    expect(result.current.hasMore).toBe(false);
  });

  it("starts over when the filters change", async () => {
    const { requests, wrapper } = setup([
      { method: "GET", path: /\/findings$/, body: { items: many(1, 1), next_cursor: null } },
    ]);
    const { result, rerender } = renderHook(({ status }) => useFindingsList(PROJECT_ID, { ...DEFAULT_FILTERS, status }), {
      wrapper,
      initialProps: { status: "open" as "open" | "closed" },
    });
    await waitFor(() => expect(result.current.status).toBe("ready"));
    rerender({ status: "closed" });
    expect(result.current.status).toBe("loading");
    await waitFor(() => expect(result.current.status).toBe("ready"));
    expect(params(requests[1].url).getAll("status")).toEqual(["closed"]);
  });

  it("refreshes at most 500 rows and keeps paging", async () => {
    let pages = 0;
    const { requests, wrapper } = setup([
      {
        method: "GET",
        path: /\/findings$/,
        body: (r) => {
          const p = params(r.url);
          const limit = Number(p.get("limit"));
          if (limit === FINDINGS_REFRESH_MAX) return { items: many(1, 500), next_cursor: "after-500" };
          pages += 1;
          return pages === 1 ? { items: many(1, 200), next_cursor: "a" } : { items: many(200 * (pages - 1) + 1, 200), next_cursor: `p${pages}` };
        },
      },
    ]);
    const { result } = renderHook(() => useFindingsList(PROJECT_ID, DEFAULT_FILTERS), { wrapper });
    await waitFor(() => expect(result.current.items).toHaveLength(200));
    for (const n of [400, 600]) {
      act(() => result.current.loadMore());
      await waitFor(() => expect(result.current.items).toHaveLength(n));
    }
    act(() => useChangesStore.getState().bumpFindings());
    await waitFor(() => expect(result.current.items).toHaveLength(500), { timeout: 2000 });
    expect(new Set(result.current.items.map((f) => f.id)).size).toBe(500);
    const refresh = requests.at(-1)!;
    expect(params(refresh.url).get("limit")).toBe("500");
    expect(params(refresh.url).get("cursor")).toBeNull();
    act(() => result.current.loadMore());
    await waitFor(() => expect(params(requests.at(-1)!.url).get("cursor")).toBe("after-500"));
  });

  it("reports a failed first page", async () => {
    const { wrapper } = setup([
      { method: "GET", path: /\/findings$/, status: 500, body: errorBody("internal", "database is locked") },
    ]);
    const { result } = renderHook(() => useFindingsList(PROJECT_ID, DEFAULT_FILTERS), { wrapper });
    await waitFor(() => expect(result.current.status).toBe("error"));
    expect(result.current.error).toBe("database is locked");
  });
});

describe("lookups", () => {
  it("maps data item ids to labels", async () => {
    const { wrapper, requests } = setup(baseRoutes());
    const { result } = renderHook(() => useDataLabels(PROJECT_ID), { wrapper });
    await waitFor(() => expect(result.current.get(SOURCE_ID)).toBe("Flight 14 Sep"));
    expect(params(requests.find((r) => r.url.includes("/data"))!.url).get("limit")).toBe("200");
  });

  it("splits the project's types into a lookup and the defect list", async () => {
    const { wrapper } = setup(baseRoutes());
    const { result } = renderHook(() => useProjectTypes(PROJECT_ID), { wrapper });
    await waitFor(() => expect(result.current.loaded).toBe(true));
    expect(result.current.types.get(TYPE_CRACK)?.name).toBe("Crack");
    expect(result.current.defectTypes.map((t) => t.id)).toEqual([TYPE_SPALLING, TYPE_CRACK]);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm -C frontend exec vitest run src/findings/hooks.test.tsx`
Expected: FAIL — `Failed to resolve import "./useFindingsList"`.

- [ ] **Step 3: Write the hooks**

`frontend/src/findings/useFindingsList.ts`:

```ts
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useApi } from "@/api/client";
import { messageOf } from "@/api/errors";
import { listFindings, type Finding, type FindingListQuery } from "@/api/findings";
import { pushLog } from "@/app/diagnostics";
import { useChangesStore } from "@/store/changes";
import { filtersToQuery, type FindingFilters } from "./filters";

/** Rows per keyset page; the table holds only loaded pages (F §14). */
export const FINDINGS_PAGE = 200;
/** A refresh re-reads at most this many rows from the top (the API's `limit` cap). */
export const FINDINGS_REFRESH_MAX = 500;
const REFRESH_DEBOUNCE_MS = 300;

interface Loaded {
  key: string;
  items: Finding[];
  cursor: string | null;
  error: string | null;
}

export interface FindingsList {
  items: Finding[];
  status: "loading" | "ready" | "error";
  error: string | null;
  hasMore: boolean;
  loadMore: () => void;
  reload: () => void;
}

const EMPTY: Finding[] = [];

export function useFindingsList(projectId: string, filters: FindingFilters): FindingsList {
  const api = useApi();
  // Keyed on the serialised query, so a caller that builds a new filters object each render (a test,
  // a parent without useMemo) does not refetch in a loop.
  const queryJson = JSON.stringify(filtersToQuery(filters));
  const query = useMemo(() => JSON.parse(queryJson) as FindingListQuery, [queryJson]);
  const key = `${projectId}|${queryJson}`;
  const revision = useChangesStore((s) => s.findingsRevision);
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [reloadTick, setReloadTick] = useState(0);
  const loadedRef = useRef<Loaded | null>(null);
  const fetchingMore = useRef(false);
  const handledRevision = useRef(revision);

  useEffect(() => {
    loadedRef.current = loaded;
  });

  // The first page, whenever the query (or a manual reload) changes.
  useEffect(() => {
    let cancelled = false;
    listFindings(api, projectId, { ...query, limit: FINDINGS_PAGE })
      .then((page) => {
        if (!cancelled) setLoaded({ key, items: page.items, cursor: page.next_cursor, error: null });
      })
      .catch((e: unknown) => {
        if (!cancelled) setLoaded({ key, items: [], cursor: null, error: messageOf(e, "could not load the findings") });
      });
    return () => {
      cancelled = true;
    };
  }, [api, projectId, key, query, reloadTick]);

  // `findings.changed`: re-read the rows already shown (bounded), without flashing a loading state.
  useEffect(() => {
    if (revision === handledRevision.current) return;
    handledRevision.current = revision;
    const timer = window.setTimeout(() => {
      const cur = loadedRef.current;
      const shown = cur && cur.key === key ? cur.items.length : 0;
      const limit = Math.min(FINDINGS_REFRESH_MAX, Math.max(FINDINGS_PAGE, shown));
      listFindings(api, projectId, { ...query, limit })
        .then((page) =>
          setLoaded((s) => (s && s.key === key ? { key, items: page.items, cursor: page.next_cursor, error: null } : s)),
        )
        .catch((e: unknown) => pushLog(`findings refresh failed: ${messageOf(e, String(e))}`));
    }, REFRESH_DEBOUNCE_MS);
    return () => window.clearTimeout(timer);
  }, [api, projectId, key, query, revision]);

  const loadMore = useCallback(() => {
    const cur = loadedRef.current;
    if (!cur || cur.key !== key || !cur.cursor || fetchingMore.current) return;
    fetchingMore.current = true;
    const cursor = cur.cursor;
    listFindings(api, projectId, { ...query, limit: FINDINGS_PAGE, cursor })
      .then((page) =>
        setLoaded((s) => {
          if (!s || s.key !== key) return s;
          const seen = new Set(s.items.map((f) => f.id));
          return {
            key,
            items: [...s.items, ...page.items.filter((f) => !seen.has(f.id))],
            // A repeated cursor (the Prism mock) ends paging instead of looping.
            cursor: page.next_cursor === cursor ? null : page.next_cursor,
            error: null,
          };
        }),
      )
      .catch((e: unknown) => pushLog(`findings page failed: ${messageOf(e, String(e))}`))
      .finally(() => {
        fetchingMore.current = false;
      });
  }, [api, projectId, key, query]);

  const reload = useCallback(() => setReloadTick((t) => t + 1), []);
  const current = loaded && loaded.key === key ? loaded : null;
  return {
    items: current?.items ?? EMPTY,
    status: !current ? "loading" : current.error ? "error" : "ready",
    error: current?.error ?? null,
    hasMore: Boolean(current?.cursor),
    loadMore,
    reload,
  };
}
```

`frontend/src/findings/useFindingSummary.ts`:

```ts
import { useEffect, useState } from "react";
import { useApi } from "@/api/client";
import { messageOf } from "@/api/errors";
import { fetchFindingSummary, type FindingSummary } from "@/api/findings";
import { pushLog } from "@/app/diagnostics";
import { useChangesStore } from "@/store/changes";

/** The pre-aggregated counts (F §8.3 summary); null until loaded or when unavailable. */
export function useFindingSummary(projectId: string): FindingSummary | null {
  const api = useApi();
  const revision = useChangesStore((s) => s.findingsRevision);
  const [loaded, setLoaded] = useState<{ projectId: string; summary: FindingSummary } | null>(null);
  useEffect(() => {
    let cancelled = false;
    fetchFindingSummary(api, projectId)
      .then((summary) => {
        if (!cancelled) setLoaded({ projectId, summary });
      })
      .catch((e: unknown) => pushLog(`finding summary unavailable: ${messageOf(e, String(e))}`));
    return () => {
      cancelled = true;
    };
  }, [api, projectId, revision]);
  return loaded?.projectId === projectId ? loaded.summary : null;
}
```

`frontend/src/findings/useDataLabels.ts`:

```ts
import { useEffect, useState } from "react";
import { useApi } from "@/api/client";
import { listDataItems } from "@/api/dataItems";
import { messageOf } from "@/api/errors";
import { pushLog } from "@/app/diagnostics";
import { useChangesStore } from "@/store/changes";

/** One Data list page is enough to name every item of a real project (F §6.3). */
export const DATA_LABELS_LIMIT = 200;
const EMPTY: ReadonlyMap<string, string> = new Map();

export function useDataLabels(projectId: string): ReadonlyMap<string, string> {
  const api = useApi();
  const revision = useChangesStore((s) => s.dataRevision);
  const [loaded, setLoaded] = useState<{ projectId: string; labels: ReadonlyMap<string, string> } | null>(null);
  useEffect(() => {
    let cancelled = false;
    listDataItems(api, projectId, { limit: DATA_LABELS_LIMIT })
      .then((page) => {
        if (!cancelled) setLoaded({ projectId, labels: new Map(page.items.map((d) => [d.id, d.label])) });
      })
      .catch((e: unknown) => pushLog(`data list unavailable: ${messageOf(e, String(e))}`));
    return () => {
      cancelled = true;
    };
  }, [api, projectId, revision]);
  return loaded?.projectId === projectId ? loaded.labels : EMPTY;
}
```

`frontend/src/findings/useProjectTypes.ts`:

```ts
import { useMemo } from "react";
import type { ClassDef } from "@contract/client";
import { useProject } from "@/api/project";

export interface ProjectTypes {
  loaded: boolean;
  types: ReadonlyMap<string, ClassDef>;
  defectTypes: ClassDef[];
  all: ClassDef[];
}

/** The project's type list (`Project.classes`, derived from `project_type`, F §7.3). */
export function useProjectTypes(projectId: string): ProjectTypes {
  const { project } = useProject(projectId);
  return useMemo(() => {
    const all = [...(project?.classes ?? [])].sort((a, b) => a.order - b.order);
    return {
      loaded: project !== null,
      types: new Map(all.map((c) => [c.id, c])),
      defectTypes: all.filter((c) => c.kind === "defect"),
      all,
    };
  }, [project]);
}
```

- [ ] **Step 4: Run the test**

Run: `pnpm -C frontend exec vitest run src/findings/hooks.test.tsx`
Expected: PASS (7 tests).

- [ ] **Step 5: Lint the hooks** (react-hooks 7 rules)

Run: `pnpm -C frontend exec eslint src/findings`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/findings/useFindingsList.ts frontend/src/findings/useFindingSummary.ts frontend/src/findings/useDataLabels.ts frontend/src/findings/useProjectTypes.ts frontend/src/findings/hooks.test.tsx
git commit -m "feat(findings): paged findings list with bounded live refresh, summary and lookups

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

### Task 4: Findings tab — filter bar, virtualised table, route

Load `impeccable` and `emil-design-eng`, read `DESIGN.md` and `frontend/src/ui/DataTable.tsx` first.

**Files:**
- Create: `frontend/src/findings/FindingThumb.tsx`, `FindingFilters.tsx`, `columns.tsx`, `FindingsScreen.tsx`
- Modify: `frontend/src/routes/projectRoutes.tsx` (the `findings` entry)
- Test: `frontend/src/findings/FindingsScreen.test.tsx`

**Interfaces:**
- Consumes: Task 2 (`parseFilters`, `filtersToSearch`, `isFiltered`, `DEFAULT_FILTERS`,
  `FINDING_SORTS`, `findingPath`, `findingLocation`, `formatFindingNumber`, `relativeTime`,
  `STATUS_LABEL`, `STATUSES`), Task 3 hooks, `findingThumbnailUrl` (Task 1); DS `DataTable`,
  `TypeChip`, `SeverityPill`, `StatusDot`, `Segmented`, `Popover`, `Checkbox`, `EmptyState`,
  `useSeverityScale`; `useNow` (`@/jobs/useNow`).
- Produces:
  - `FindingsScreen` (route `p/:projectId/findings/:findingId?`)
  - `FindingFiltersBar({filters, summary, scale, types, onChange})`
  - `findingColumns(ctx: {projectId; types; labels; nowMs}): Column<Finding>[]`
  - `FindingThumb({projectId, finding, colour})`

- [ ] **Step 1: Write the failing test**

`frontend/src/findings/FindingsScreen.test.tsx`:

```tsx
import { beforeEach, describe, expect, it } from "vitest";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { useLocation } from "react-router-dom";
import { fakeClient, PROJECT_ID, type RecordedRequest } from "@/test/fixtures";
import { baseRoutes, exampleFinding, exampleFinding2 } from "@/test/findingFixtures";
import { renderWithProviders } from "@/test/render";
import { useChangesStore } from "@/store/changes";
import { FindingsScreen } from "./FindingsScreen";

function LocationProbe() {
  const l = useLocation();
  return <output data-testid="location">{l.pathname + l.search}</output>;
}

function renderTab(search = "", items = [exampleFinding, exampleFinding2]) {
  const { api, requests } = fakeClient(
    baseRoutes([{ method: "GET", path: /\/findings$/, body: { items, next_cursor: null } }]),
  );
  renderWithProviders(
    <>
      <FindingsScreen />
      <LocationProbe />
    </>,
    { api, route: `/p/${PROJECT_ID}/findings${search}`, path: "/p/:projectId/findings/:findingId?" },
  );
  return requests;
}

const listRequests = (requests: RecordedRequest[]) =>
  requests.filter((r) => /\/findings\?/.test(r.url)).map((r) => new URL(r.url, "http://fake").searchParams);

describe("FindingsScreen", () => {
  beforeEach(() => useChangesStore.setState({ findingsRevision: 0, dataRevision: 0 }));

  it("reads the filters from the URL and sends them", async () => {
    const requests = renderTab("?status=open&severity=4");
    await screen.findByText("F-0217");
    const q = listRequests(requests)[0];
    expect(q.getAll("status")).toEqual(["open"]);
    expect(q.getAll("severity")).toEqual(["4"]);
    expect(q.get("limit")).toBe("200");
  });

  it("shows number, type, severity, location and status per row", async () => {
    renderTab();
    const number = await screen.findByText("F-0217");
    const row = number.closest('[role="row"]') as HTMLElement;
    expect(within(row).getByText("Spalling")).toBeInTheDocument();
    expect(within(row).getByText("Flight 14 Sep")).toBeInTheDocument();
    expect(within(row).getByText("Open")).toBeInTheDocument();
    expect(screen.getByText("F-0218")).toBeInTheDocument();
  });

  it("writes a status choice into the URL and fetches that view", async () => {
    const requests = renderTab();
    await screen.findByText("F-0217");
    fireEvent.click(screen.getByRole("radio", { name: /Reviewed/ }));
    await waitFor(() => expect(screen.getByTestId("location")).toHaveTextContent("status=reviewed"));
    await waitFor(() => expect(listRequests(requests).at(-1)!.getAll("status")).toEqual(["reviewed"]));
  });

  it("toggles a severity and the No severity filter", async () => {
    renderTab();
    await screen.findByText("F-0217");
    fireEvent.click(screen.getByRole("button", { name: "Critical", pressed: false }));
    fireEvent.click(screen.getByRole("button", { name: "No severity", pressed: false }));
    await waitFor(() =>
      expect(screen.getByTestId("location")).toHaveTextContent("severity=4&severity=none"),
    );
  });

  it("debounces the search into the URL", async () => {
    renderTab();
    await screen.findByText("F-0217");
    fireEvent.change(screen.getByRole("searchbox", { name: "Search findings" }), { target: { value: "F-0217" } });
    await waitFor(() => expect(screen.getByTestId("location")).toHaveTextContent("q=F-0217"));
  });

  it("clears every filter", async () => {
    renderTab("?severity=4&anchor_kind=map");
    await screen.findByText("F-0217");
    fireEvent.click(screen.getByRole("button", { name: "Clear filters" }));
    await waitFor(() => expect(screen.getByTestId("location")).toHaveTextContent(`/p/${PROJECT_ID}/findings`));
    expect(screen.getByTestId("location").textContent).not.toContain("?");
  });

  it("explains where findings come from when there are none", async () => {
    renderTab("", []);
    expect(await screen.findByText("No findings yet")).toBeInTheDocument();
  });

  it("offers Clear when filters hide everything", async () => {
    renderTab("?severity=1", []);
    expect(await screen.findByText("No findings match these filters")).toBeInTheDocument();
  });

  it("renders a finding whose type left the project as Unknown type", async () => {
    renderTab("", [{ ...exampleFinding, type_id: "gone" }]);
    expect(await screen.findByText("Unknown type")).toBeInTheDocument();
  });

  it("opens a row in the inspector route, keeping the filters", async () => {
    renderTab("?status=open");
    fireEvent.doubleClick(await screen.findByText("F-0217"));
    await waitFor(() =>
      expect(screen.getByTestId("location")).toHaveTextContent(`/p/${PROJECT_ID}/findings/${exampleFinding.id}?status=open`),
    );
  });
});
```

The last test opens a row with a double click; if the merged `DataTable` opens on single click or
Enter only, use its gesture (record it in the ledger).

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm -C frontend exec vitest run src/findings/FindingsScreen.test.tsx`
Expected: FAIL — `Failed to resolve import "./FindingsScreen"`.

- [ ] **Step 3: Write the thumbnail and the columns**

`frontend/src/findings/FindingThumb.tsx`:

```tsx
import { useState, type CSSProperties } from "react";
import { useBackend } from "@/api/client";
import { findingThumbnailUrl, type Finding } from "@/api/findings";

/** 44 × 32 lazy crop (F §8.6); a failed or missing crop shows the type colour as an outline. */
export function FindingThumb({ projectId, finding, colour }: { projectId: string; finding: Finding; colour: string }) {
  const { baseUrl, token } = useBackend();
  const [failed, setFailed] = useState(false);
  return (
    <span
      className="relative grid h-8 w-11 shrink-0 place-items-center overflow-hidden rounded-sm bg-surface-2"
      style={{ "--c": colour } as CSSProperties}
    >
      {failed ? (
        <span aria-hidden className="absolute inset-x-2.5 inset-y-1.5 rounded-sm border-2 border-[var(--c)]" />
      ) : (
        <img
          src={findingThumbnailUrl(baseUrl, token, projectId, finding.id)}
          alt=""
          loading="lazy"
          onError={() => setFailed(true)}
          className="h-full w-full object-cover"
        />
      )}
    </span>
  );
}
```

`frontend/src/findings/columns.tsx`:

```tsx
import type { ClassDef } from "@contract/client";
import type { Finding } from "@/api/findings";
import { Icon, SeverityPill, StatusDot, TypeChip, type Column } from "@/ui";
import { FindingThumb } from "./FindingThumb";
import { formatFindingNumber, relativeTime } from "./format";
import { findingLocation } from "./location";
import { STATUS_LABEL } from "./status";

export interface ColumnContext {
  projectId: string;
  types: ReadonlyMap<string, ClassDef>;
  labels: ReadonlyMap<string, string>;
  nowMs: number;
}

/** The Findings table (F §8.6): select (from DataTable), thumbnail, number, type, severity, location, status, updated. */
export function findingColumns(ctx: ColumnContext): Column<Finding>[] {
  return [
    {
      key: "thumb",
      header: <span className="sr-only">Preview</span>,
      width: "60px",
      render: (f) => (
        <FindingThumb projectId={ctx.projectId} finding={f} colour={ctx.types.get(f.type_id)?.colour ?? "rgb(var(--muted))"} />
      ),
    },
    {
      key: "number",
      header: "ID",
      width: "84px",
      render: (f) => <span className="font-mono text-xs tabular-nums text-ink">{formatFindingNumber(f.number)}</span>,
    },
    {
      key: "type",
      header: "Type",
      width: "200px",
      render: (f) => {
        const t = ctx.types.get(f.type_id);
        return t ? <TypeChip name={t.name} colour={t.colour} kind={t.kind} /> : <span className="text-sm text-muted">Unknown type</span>;
      },
    },
    { key: "severity", header: "Severity", width: "130px", render: (f) => <SeverityPill level={f.severity} /> },
    {
      key: "location",
      header: "Location",
      width: "260px",
      render: (f) => {
        const loc = findingLocation(f, ctx.labels);
        return (
          <span className="flex min-w-0 items-center gap-2 text-sm">
            <Icon name={loc.icon} size={14} className="shrink-0 text-muted" />
            <span className="truncate">{loc.primary}</span>
            {loc.secondary && <span className="truncate font-mono text-2xs text-muted">{loc.secondary}</span>}
          </span>
        );
      },
    },
    {
      key: "status",
      header: "Status",
      width: "120px",
      render: (f) => (
        <span className="inline-flex items-center gap-2 text-xs text-muted">
          <StatusDot status={f.status} />
          {STATUS_LABEL[f.status]}
        </span>
      ),
    },
    {
      key: "updated",
      header: "Updated",
      width: "110px",
      render: (f) => <span className="text-xs text-muted">{relativeTime(f.updated_at, ctx.nowMs)}</span>,
    },
  ];
}
```

- [ ] **Step 4: Write the filter bar**

`frontend/src/findings/FindingFilters.tsx`:

```tsx
import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import type { ClassDef } from "@contract/client";
import type { FindingSummary } from "@/api/findings";
import {
  Button,
  Checkbox,
  Input,
  Popover,
  Segmented,
  Select,
  buttonClass,
  cx,
  focusRing,
  transition,
  type SeverityLevel,
} from "@/ui";
import {
  DEFAULT_FILTERS,
  FINDING_SORTS,
  isFiltered,
  type FindingFilters,
  type FindingSort,
  type SeverityFilter,
  type SourceKind,
} from "./filters";
import { STATUSES, STATUS_LABEL } from "./status";

const SEARCH_DEBOUNCE_MS = 250;
const SORT_LABEL: Record<FindingSort, string> = {
  "-severity": "Severity",
  number: "Number",
  "-updated_at": "Recently updated",
  type: "Type",
};
const SOURCES: SourceKind[] = ["image", "map", "cloud"];
const SOURCE_BUTTON: Record<SourceKind, string> = { image: "Images", map: "Maps", cloud: "Clouds" };

function ToggleChip({
  pressed,
  onClick,
  colour,
  children,
}: {
  pressed: boolean;
  onClick: () => void;
  colour?: string;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      aria-pressed={pressed}
      onClick={onClick}
      style={colour ? ({ "--c": colour } as CSSProperties) : undefined}
      className={cx(
        "inline-flex h-7 items-center gap-1.5 rounded-chip border px-2.5 text-xs",
        focusRing,
        transition,
        pressed ? "border-line-strong bg-surface-2 text-ink" : "border-line text-muted hover:bg-hover hover:text-ink",
      )}
    >
      {colour && <span aria-hidden className="h-2 w-2 rounded-full bg-[var(--c)]" />}
      {children}
    </button>
  );
}

const toggle = <T,>(list: T[], v: T): T[] => (list.includes(v) ? list.filter((x) => x !== v) : [...list, v]);

export function FindingFiltersBar({
  filters,
  summary,
  scale,
  types,
  onChange,
}: {
  filters: FindingFilters;
  summary: FindingSummary | null;
  scale: readonly SeverityLevel[];
  types: readonly ClassDef[];
  onChange: (next: FindingFilters) => void;
}) {
  const [q, setQ] = useState(filters.q);
  const [seenQ, setSeenQ] = useState(filters.q);
  const [typesOpen, setTypesOpen] = useState(false);
  const typesRef = useRef<HTMLButtonElement>(null);
  // A Clear (or a link) changes the URL's q: adopt it while rendering, not in an effect.
  if (seenQ !== filters.q) {
    setSeenQ(filters.q);
    setQ(filters.q);
  }
  useEffect(() => {
    if (q === filters.q) return;
    const t = window.setTimeout(() => onChange({ ...filters, q }), SEARCH_DEBOUNCE_MS);
    return () => window.clearTimeout(t);
  }, [q, filters, onChange]);

  const count = (s: (typeof STATUSES)[number]) => (summary ? ` ${summary.by_status[s]}` : "");
  const total = summary ? summary.by_status.open + summary.by_status.reviewed + summary.by_status.closed : null;
  const severities: { value: SeverityFilter; name: string; colour?: string }[] = [
    ...[...scale].sort((a, b) => b.level - a.level).map((l) => ({ value: l.level, name: l.name, colour: l.colour })),
    { value: "none", name: "No severity" },
  ];

  return (
    <div className="flex flex-wrap items-center gap-2.5" role="group" aria-label="Filter findings">
      <Segmented
        label="Status"
        size="sm"
        value={filters.status ?? "all"}
        onChange={(v) => onChange({ ...filters, status: v === "all" ? null : v })}
        options={[
          { value: "all", label: `All${total === null ? "" : ` ${total}`}` },
          ...STATUSES.map((s) => ({ value: s, label: `${STATUS_LABEL[s]}${count(s)}` })),
        ]}
      />
      <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="Severity">
        {severities.map((s) => (
          <ToggleChip
            key={String(s.value)}
            pressed={filters.severity.includes(s.value)}
            colour={s.colour}
            onClick={() => onChange({ ...filters, severity: toggle(filters.severity, s.value) })}
          >
            {s.name}
          </ToggleChip>
        ))}
      </div>
      <button
        ref={typesRef}
        type="button"
        aria-expanded={typesOpen}
        onClick={() => setTypesOpen((o) => !o)}
        className={buttonClass("secondary", "sm")}
      >
        {filters.typeIds.length ? `Types · ${filters.typeIds.length}` : "All types"}
      </button>
      <Popover open={typesOpen} onClose={() => setTypesOpen(false)} anchorRef={typesRef} label="Filter by type">
        <ul className="flex max-h-72 flex-col gap-1 overflow-y-auto p-1">
          {types.map((t) => (
            <li key={t.id}>
              <Checkbox
                label={t.name}
                checked={filters.typeIds.includes(t.id)}
                onChange={() => onChange({ ...filters, typeIds: toggle(filters.typeIds, t.id) })}
              />
            </li>
          ))}
        </ul>
      </Popover>
      <div className="flex items-center gap-1.5" role="group" aria-label="Source">
        {SOURCES.map((s) => (
          <ToggleChip
            key={s}
            pressed={filters.source.includes(s)}
            onClick={() => onChange({ ...filters, source: toggle(filters.source, s) })}
          >
            {SOURCE_BUTTON[s]}
          </ToggleChip>
        ))}
      </div>
      <Input
        type="search"
        aria-label="Search findings"
        placeholder="Note, type or F-0123"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        className="h-8 w-56"
      />
      <Select
        aria-label="Sort findings"
        value={filters.sort}
        onChange={(e) => onChange({ ...filters, sort: e.target.value as FindingSort })}
        className="h-8 w-44"
      >
        {FINDING_SORTS.map((s) => (
          <option key={s} value={s}>
            Sort: {SORT_LABEL[s]}
          </option>
        ))}
      </Select>
      {isFiltered(filters) && (
        <Button size="sm" variant="ghost" onClick={() => onChange({ ...DEFAULT_FILTERS, sort: filters.sort })}>
          Clear filters
        </Button>
      )}
    </div>
  );
}
```

- [ ] **Step 5: Write the screen**

`frontend/src/findings/FindingsScreen.tsx`:

```tsx
import { useCallback, useMemo, useState } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import type { Finding } from "@/api/findings";
import { useNow } from "@/jobs/useNow";
import { Alert, Button, DataTable, EmptyState, useSeverityScale } from "@/ui";
import { findingColumns } from "./columns";
import { FindingFiltersBar } from "./FindingFilters";
import { DEFAULT_FILTERS, filtersToSearch, isFiltered, parseFilters, type FindingFilters } from "./filters";
import { findingPath } from "./links";
import { useDataLabels } from "./useDataLabels";
import { useFindingsList } from "./useFindingsList";
import { useFindingSummary } from "./useFindingSummary";
import { useProjectTypes } from "./useProjectTypes";

/** The project's one Findings list (F §8.6): filters in the URL, a virtualised table, the inspector route. */
export function FindingsScreen() {
  const { projectId = "", findingId } = useParams();
  const [search, setSearch] = useSearchParams();
  const navigate = useNavigate();
  const filters = useMemo(() => parseFilters(search), [search]);
  const list = useFindingsList(projectId, filters);
  const summary = useFindingSummary(projectId);
  const scale = useSeverityScale();
  const { types, all } = useProjectTypes(projectId);
  const labels = useDataLabels(projectId);
  const nowMs = useNow(60_000);
  const [selected, setSelected] = useState<ReadonlySet<string>>(() => new Set());
  const query = search.toString();
  const suffix = query ? `?${query}` : "";

  const onFilters = useCallback(
    (next: FindingFilters) => {
      setSelected(new Set());
      setSearch(filtersToSearch(next), { replace: true });
    },
    [setSearch],
  );
  const openFinding = useCallback(
    (f: Finding) => void navigate(`${findingPath(projectId, f.id)}${suffix}`),
    [navigate, projectId, suffix],
  );
  const columns = useMemo(() => findingColumns({ projectId, types, labels, nowMs }), [projectId, types, labels, nowMs]);
  const empty = list.status === "ready" && list.items.length === 0;

  return (
    <section className="flex h-full min-h-0 flex-col gap-4" aria-label="Findings">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">Findings</h1>
          <p className="text-sm text-muted">
            Every defect in this project, from photos, maps and point clouds. Grade, comment and close them here.
          </p>
        </div>
      </header>
      <FindingFiltersBar filters={filters} summary={summary} scale={scale} types={all} onChange={onFilters} />
      {list.status === "error" && (
        <Alert tone="danger" actions={<Button size="sm" onClick={list.reload}>Retry</Button>}>
          {list.error}
        </Alert>
      )}
      <div className="flex min-h-0 flex-1 gap-4">
        <div className="relative flex min-w-0 flex-1 flex-col">
          {empty ? (
            isFiltered(filters) ? (
              <EmptyState
                icon="findings"
                title="No findings match these filters"
                action={<Button onClick={() => onFilters({ ...DEFAULT_FILTERS, sort: filters.sort })}>Clear filters</Button>}
              />
            ) : (
              <EmptyState icon="findings" title="No findings yet">
                Findings are made in the Images, Maps and Point clouds workspaces: mark a defect there, or accept
                an AI detection of a defect type.
              </EmptyState>
            )
          ) : (
            <DataTable
              label="Findings"
              columns={columns}
              rows={list.items}
              rowKey={(f) => f.id}
              loading={list.status === "loading"}
              selected={selected}
              onSelectionChange={setSelected}
              activeKey={findingId ?? null}
              onOpen={openFinding}
              onEndReached={list.hasMore ? list.loadMore : undefined}
            />
          )}
        </div>
      </div>
    </section>
  );
}
```

- [ ] **Step 6: Route it**

In `frontend/src/routes/projectRoutes.tsx`, replace SH's `findings` placeholder entry (or entries,
`app/InterimScreens.tsx`) with one optional-segment route, importing `FindingsScreen` from
`@/findings/FindingsScreen`:

```tsx
  // F §8.6: the list, and the inspector at findings/:findingId (the canonical finding link).
  { path: "findings/:findingId?", element: <FindingsScreen /> },
```

If SH lazy-loads tab screens (`Later`), keep its wrapper around `<FindingsScreen />`.

- [ ] **Step 7: Run the tests**

Run: `pnpm -C frontend exec vitest run src/findings`
Expected: PASS (all findings tests, 10 new).

- [ ] **Step 8: Lint and token check**

Run: `pnpm -C frontend lint`
Expected: exit 0 (eslint, prettier, check-tokens).

- [ ] **Step 9: Commit**

```bash
git add frontend/src/findings/FindingThumb.tsx frontend/src/findings/FindingFilters.tsx frontend/src/findings/columns.tsx frontend/src/findings/FindingsScreen.tsx frontend/src/findings/FindingsScreen.test.tsx frontend/src/routes/projectRoutes.tsx
git commit -m "feat(findings): Findings tab with URL filters and a virtualised table

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

### Task 5: FindingInspector core (header, type, severity, status, slots, provenance)

Load the design skills; follow the `ws-images.html` inspector (`.ins`, `.type`, `.sevseg`, `.prov`).

**Files:**
- Create: `frontend/src/findings/inspectorStore.ts`, `frontend/src/findings/FindingInspector.tsx`,
  `frontend/src/findings/inspector/useFinding.ts`, `frontend/src/findings/inspector/fields.tsx`,
  `frontend/src/findings/inspector/Provenance.tsx`
- Test: `frontend/src/findings/FindingInspector.test.tsx`

**Interfaces:**
- Consumes: `fetchFinding`, `patchFinding`, `deleteFinding`, `FindingDetail`, `FindingPatch`
  (Task 1); `formatFindingNumber`, `parseCreatedBy`, `formatPercent`, `relativeTime`,
  `canTransition`, `STATUS_LABEL`, `STATUSES`, `findingHref`, `findingPath` (Task 2);
  `useProjectTypes` (Task 3); `fetchLibraryModel` (`@/api/library`); DS `InspectorPane`,
  `InspectorSection`, `SeverityPicker`, `Segmented`, `TypeChip`, `Popover`, `ComboboxList`, `MenuButton`,
  `Dialog`, `Pill`, `toast`.
- Produces (the contract I, M and C build on):
  - `FindingInspector(props: FindingInspectorProps)`,
    `FindingInspectorProps {projectId: string; findingId: string; anchorSlot?: ReactNode; measureSlot?: ReactNode; onNavigate?: (href: string | null) => void}`
  - `useInspectorCommands` (zustand): `{typePickerNonce: number; openTypePicker(): void}` — T in any host opens the type picker
  - `useFinding(projectId, findingId): {finding: FindingDetail | null; error: string | null; update(patch): Promise<void>; remove(): Promise<void>}`
  - `TypeField`, `StatusField` (`inspector/fields.tsx`), `Provenance`

- [ ] **Step 1: Write the failing test**

`frontend/src/findings/FindingInspector.test.tsx`:

```tsx
import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, screen, waitFor } from "@testing-library/react";
import { useLocation } from "react-router-dom";
import { errorBody, exampleModel, fakeClient, IMAGE_ID, PROJECT_ID, type FakeRoute } from "@/test/fixtures";
import { baseRoutes, exampleFindingDetail, FINDING_ID, TYPE_CRACK } from "@/test/findingFixtures";
import { renderWithProviders } from "@/test/render";
import { useChangesStore } from "@/store/changes";
import { FindingInspector, type FindingInspectorProps } from "./FindingInspector";
import { useInspectorCommands } from "./inspectorStore";

function LocationProbe() {
  const l = useLocation();
  return <output data-testid="location">{l.pathname + l.search}</output>;
}

const detail = (patch: Partial<typeof exampleFindingDetail> = {}) => ({ ...exampleFindingDetail, ...patch });

function renderInspector(routes: FakeRoute[] = [], props: Partial<FindingInspectorProps> = {}) {
  const { api, requests } = fakeClient(
    baseRoutes([
      ...routes,
      {
        method: "PATCH",
        path: /\/findings\/[^/]+$/,
        body: (r) => ({ ...detail(), ...(r.body as object) }),
      },
      { method: "DELETE", path: /\/findings\/[^/]+$/, status: 204 },
      { method: "GET", path: /\/library\/models\/[^/]+$/, body: exampleModel },
      { method: "GET", path: /\/findings\/[^/]+\/(comments|attachments)$/, body: { items: [], next_cursor: null } },
      { method: "GET", path: /\/activity$/, body: { items: [], next_cursor: null } },
      { method: "GET", path: /\/findings\/[^/]+$/, body: detail() },
    ]),
  );
  renderWithProviders(
    <>
      <FindingInspector projectId={PROJECT_ID} findingId={FINDING_ID} {...props} />
      <LocationProbe />
    </>,
    { api, route: `/p/${PROJECT_ID}/findings/${FINDING_ID}`, path: "/p/:projectId/findings/:findingId" },
  );
  return requests;
}

const patches = (requests: { method: string; body: unknown }[]) =>
  requests.filter((r) => r.method === "PATCH").map((r) => r.body);

describe("FindingInspector", () => {
  beforeEach(() => useChangesStore.setState({ findingsRevision: 0 }));

  it("shows the number, the type, AI provenance and the default anchor link", async () => {
    renderInspector();
    expect(await screen.findByText("F-0217")).toBeInTheDocument();
    expect(screen.getByText("Spalling")).toBeInTheDocument();
    expect(await screen.findByText(`Created by AI · ${exampleModel.name} · 87%`)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Open in workspace" })).toHaveAttribute(
      "href",
      `/p/${PROJECT_ID}/images/${IMAGE_ID}?finding=${FINDING_ID}`,
    );
  });

  it("falls back to the model id when the library no longer has it", async () => {
    renderInspector([
      { method: "GET", path: /\/library\/models\/[^/]+$/, status: 404, body: errorBody("not_found", "no such model") },
    ]);
    expect(await screen.findByText(/Created by AI · Model m0000000 · 87%/)).toBeInTheDocument();
  });

  it("sets the severity", async () => {
    const requests = renderInspector();
    await screen.findByText("F-0217");
    fireEvent.click(screen.getByRole("radio", { name: /Major/ }));
    await waitFor(() => expect(patches(requests)).toEqual([{ severity: 3 }]));
    expect(useChangesStore.getState().findingsRevision).toBeGreaterThan(0);
  });

  it("refuses closed → reviewed and explains why", async () => {
    const requests = renderInspector([{ method: "GET", path: /\/findings\/[^/]+$/, body: detail({ status: "closed" }) }]);
    await screen.findByText("F-0217");
    expect(screen.getByRole("radio", { name: "Reviewed" })).toBeDisabled();
    expect(screen.getByText("Reopen a closed finding before marking it reviewed.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("radio", { name: "Open" }));
    await waitFor(() => expect(patches(requests)).toEqual([{ status: "open" }]));
  });

  it("reverts and says so when the server refuses a change", async () => {
    renderInspector([
      {
        method: "PATCH",
        path: /\/findings\/[^/]+$/,
        status: 409,
        body: errorBody("invalid_transition", "closed findings must be reopened first"),
      },
    ]);
    await screen.findByText("F-0217");
    fireEvent.click(screen.getByRole("radio", { name: "Closed" }));
    await waitFor(() => expect(screen.getByRole("radio", { name: "Open" })).toHaveAttribute("aria-checked", "true"));
  });

  it("changes the type through the picker, and T opens it", async () => {
    const requests = renderInspector();
    await screen.findByText("F-0217");
    act(() => useInspectorCommands.getState().openTypePicker());
    fireEvent.click(await screen.findByRole("option", { name: /Crack/ }));
    await waitFor(() => expect(patches(requests)).toEqual([{ type_id: TYPE_CRACK }]));
  });

  it("renders the host's slots", async () => {
    renderInspector([], { anchorSlot: <button type="button">Show on image</button>, measureSlot: <p>0.084 m²</p> });
    expect(await screen.findByText("0.084 m²")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Show on image" })).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Open in workspace" })).toBeNull();
  });

  it("deletes after confirming and hands null to the host", async () => {
    const onNavigate = vi.fn();
    const requests = renderInspector([], { onNavigate });
    await screen.findByText("F-0217");
    fireEvent.click(screen.getByRole("button", { name: "Finding actions" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Delete" }));
    expect(screen.getByText(/Its box on the image is deleted too/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Delete F-0217" }));
    await waitFor(() => expect(onNavigate).toHaveBeenCalledWith(null));
    expect(requests.some((r) => r.method === "DELETE")).toBe(true);
  });

  it("copies the canonical link", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    renderInspector();
    await screen.findByText("F-0217");
    fireEvent.click(screen.getByRole("button", { name: "Finding actions" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Copy link" }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith(`/p/${PROJECT_ID}/findings/${FINDING_ID}`));
  });
});
```

DS's `SeverityPicker` names its radios `"<level> <name>"` ("3 Major", DS Task 10), which `/Major/` matches, and
`Segmented` renders radios; adapt the queries to the ledger if the DS roles differ.

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm -C frontend exec vitest run src/findings/FindingInspector.test.tsx`
Expected: FAIL — `Failed to resolve import "./FindingInspector"`.

- [ ] **Step 3: Write the store and the data hook**

`frontend/src/findings/inspectorStore.ts`:

```ts
import { create } from "zustand";

/** Commands a host sends the open inspector (review key T, F §5.6). */
interface InspectorCommands {
  typePickerNonce: number;
  openTypePicker: () => void;
}

export const useInspectorCommands = create<InspectorCommands>((set) => ({
  typePickerNonce: 0,
  openTypePicker: () => set((s) => ({ typePickerNonce: s.typePickerNonce + 1 })),
}));
```

`frontend/src/findings/inspector/useFinding.ts`:

```ts
import { useCallback, useEffect, useState } from "react";
import { useApi } from "@/api/client";
import { codeOf, messageOf } from "@/api/errors";
import { deleteFinding, fetchFinding, patchFinding, type FindingDetail, type FindingPatch } from "@/api/findings";
import { useChangesStore } from "@/store/changes";
import { toast } from "@/ui";

interface Loaded {
  id: string;
  finding: FindingDetail | null;
  error: string | null;
}

function updateFailure(e: unknown): string {
  switch (codeOf(e)) {
    case "invalid_transition":
      return "A closed finding has to be reopened before it can be marked reviewed.";
    case "not_a_defect":
      return "Only defect types can hold a finding.";
    default:
      return messageOf(e, "could not save the finding");
  }
}

/** One finding's detail, re-read on `findings.changed`; writes are optimistic and revert on refusal. */
export function useFinding(projectId: string, findingId: string) {
  const api = useApi();
  const revision = useChangesStore((s) => s.findingsRevision);
  const [loaded, setLoaded] = useState<Loaded | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetchFinding(api, projectId, findingId)
      .then((finding) => {
        if (!cancelled) setLoaded({ id: findingId, finding, error: null });
      })
      .catch((e: unknown) => {
        if (!cancelled) setLoaded({ id: findingId, finding: null, error: messageOf(e, "could not load the finding") });
      });
    return () => {
      cancelled = true;
    };
  }, [api, projectId, findingId, revision]);

  const current = loaded && loaded.id === findingId ? loaded : null;
  const before = current?.finding ?? null;

  const update = useCallback(
    async (patch: FindingPatch) => {
      if (!before) return;
      setLoaded({ id: findingId, finding: { ...before, ...patch } as FindingDetail, error: null });
      try {
        const saved = await patchFinding(api, projectId, findingId, patch);
        setLoaded({ id: findingId, finding: saved, error: null });
        useChangesStore.getState().bumpFindings();
      } catch (e) {
        setLoaded({ id: findingId, finding: before, error: null });
        toast("danger", updateFailure(e));
      }
    },
    [api, projectId, findingId, before],
  );

  const remove = useCallback(async () => {
    await deleteFinding(api, projectId, findingId);
    useChangesStore.getState().bumpFindings();
  }, [api, projectId, findingId]);

  return { finding: current?.finding ?? null, error: current?.error ?? null, update, remove };
}
```

- [ ] **Step 4: Write the fields and provenance**

`frontend/src/findings/inspector/fields.tsx`:

```tsx
import { useRef, useState } from "react";
import type { ClassDef } from "@contract/client";
import type { FindingStatus } from "@/api/findings";
import { ComboboxList, Popover, Segmented, TypeChip } from "@/ui";
import { useInspectorCommands } from "../inspectorStore";
import { canTransition, STATUSES, STATUS_LABEL } from "../status";

/** A TypeChip button opening a picker of the project's defect types (F §8.7 item 2). */
export function TypeField({
  type,
  defectTypes,
  onChange,
}: {
  type: ClassDef | null;
  defectTypes: readonly ClassDef[];
  onChange: (typeId: string) => void;
}) {
  const nonce = useInspectorCommands((s) => s.typePickerNonce);
  const [seenNonce, setSeenNonce] = useState(nonce);
  const [open, setOpen] = useState(false);
  const anchor = useRef<HTMLButtonElement>(null);
  if (seenNonce !== nonce) {
    setSeenNonce(nonce);
    setOpen(true);
  }
  return (
    <>
      <button
        ref={anchor}
        type="button"
        aria-expanded={open}
        onClick={() => setOpen(true)}
        className="w-full rounded-control border border-line bg-field px-3 py-2.5 text-left hover:border-line-strong"
        aria-label={`Type: ${type?.name ?? "Unknown type"}. Change`}
      >
        {type ? (
          <TypeChip name={type.name} colour={type.colour} kind={type.kind} />
        ) : (
          <span className="text-sm text-muted">Unknown type</span>
        )}
        {type?.group && <span className="mt-0.5 block text-2xs text-muted">Catalogue › {type.group}</span>}
      </button>
      <Popover open={open} onClose={() => setOpen(false)} anchorRef={anchor} label="Change type">
        <ComboboxList
          label="Type"
          items={defectTypes.map((t) => ({ id: t.id, label: t.name, hint: t.group ?? undefined, colour: t.colour }))}
          value={type?.id ?? null}
          onSelect={(id) => {
            setOpen(false);
            if (id !== type?.id) onChange(id);
          }}
        />
      </Popover>
    </>
  );
}

/** Open · Reviewed · Closed; closed → reviewed is disabled (F §8.2). */
export function StatusField({ value, onChange }: { value: FindingStatus; onChange: (next: FindingStatus) => void }) {
  return (
    <div className="flex flex-col gap-1.5">
      <Segmented
        label="Status"
        value={value}
        onChange={(next) => {
          if (canTransition(value, next)) onChange(next);
        }}
        options={STATUSES.map((s) => ({
          value: s,
          label: STATUS_LABEL[s],
          disabled: s !== value && !canTransition(value, s),
        }))}
      />
      {value === "closed" && <p className="text-2xs text-dim">Reopen a closed finding before marking it reviewed.</p>}
    </div>
  );
}
```

`frontend/src/findings/inspector/Provenance.tsx`:

```tsx
import { useEffect, useState } from "react";
import { useApi } from "@/api/client";
import type { FindingDetail } from "@/api/findings";
import { fetchLibraryModel } from "@/api/library";
import { Icon } from "@/ui";
import { formatPercent, parseCreatedBy, relativeTime } from "../format";

function useModelName(modelId: string | null): string | null {
  const api = useApi();
  const [loaded, setLoaded] = useState<{ id: string; name: string } | null>(null);
  useEffect(() => {
    if (!modelId) return;
    let cancelled = false;
    fetchLibraryModel(api, modelId)
      .then((m) => {
        if (!cancelled) setLoaded({ id: modelId, name: m.name });
      })
      .catch(() => {
        if (!cancelled) setLoaded({ id: modelId, name: `Model ${modelId.slice(0, 8)}` });
      });
    return () => {
      cancelled = true;
    };
  }, [api, modelId]);
  return modelId && loaded?.id === modelId ? loaded.name : null;
}

/** F §8.7 item 6: AI provenance on `--grad-ai`; a person's finding gets one plain line. */
export function Provenance({ finding, nowMs }: { finding: FindingDetail; nowMs: number }) {
  const by = parseCreatedBy(finding.created_by);
  const name = useModelName(by.kind === "model" ? by.modelId : null);
  if (by.kind === "human") {
    return <p className="text-xs text-muted">Marked by hand · {relativeTime(finding.created_at, nowMs)}</p>;
  }
  const confidence = formatPercent(finding.confidence);
  return (
    <div className="flex items-center gap-2.5 rounded-control border border-accent/30 bg-grad-ai px-3 py-2.5 text-xs">
      <Icon name="sparkle" size={16} className="shrink-0 text-accent-ink" />
      <div className="min-w-0">
        <p className="font-semibold text-ink">
          {["Created by AI", name ?? "…", confidence].filter(Boolean).join(" · ")}
        </p>
        <p className="text-2xs text-muted">
          {finding.reviewed_at ? `Accepted ${relativeTime(finding.reviewed_at, nowMs)}` : "Awaiting review"}
        </p>
      </div>
    </div>
  );
}
```

- [ ] **Step 5: Write the inspector**

`frontend/src/findings/FindingInspector.tsx`:

```tsx
import { useCallback, useState, type ReactNode } from "react";
import { Link, useNavigate } from "react-router-dom";
import { messageOf } from "@/api/errors";
import { useNow } from "@/jobs/useNow";
import {
  Alert,
  Button,
  Dialog,
  InspectorPane,
  InspectorSection,
  MenuButton,
  Pill,
  SeverityPicker,
  Skeleton,
  SkeletonRows,
  buttonClass,
  toast,
} from "@/ui";
import { formatFindingNumber, parseCreatedBy } from "./format";
import { TypeField, StatusField } from "./inspector/fields";
import { Provenance } from "./inspector/Provenance";
import { useFinding } from "./inspector/useFinding";
import { findingHref, findingPath } from "./links";
import { useProjectTypes } from "./useProjectTypes";

export interface FindingInspectorProps {
  projectId: string;
  findingId: string;
  /** Replaces the default "Open in workspace" link (I: "Show on image", M, C: their own). */
  anchorSlot?: ReactNode;
  /** Measured size (I), area or elevation (M), linked measurements (C). */
  measureSlot?: ReactNode;
  /** Called with the workspace link, or null once the finding is deleted; defaults to the router. */
  onNavigate?: (href: string | null) => void;
}

/** The shared finding inspector (F §8.7), reused by the Findings tab and by I, M and C. */
export function FindingInspector({ projectId, findingId, anchorSlot, measureSlot, onNavigate }: FindingInspectorProps) {
  const navigate = useNavigate();
  const { finding, error, update, remove } = useFinding(projectId, findingId);
  const { types, defectTypes } = useProjectTypes(projectId);
  const nowMs = useNow(60_000);
  const [confirming, setConfirming] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const go = useCallback(
    (href: string | null) => {
      if (onNavigate) onNavigate(href);
      else void navigate(href ?? `/p/${projectId}/findings`);
    },
    [navigate, onNavigate, projectId],
  );

  if (error)
    return (
      <InspectorPane label="Finding" header={<span className="text-xs text-muted">Selected finding</span>}>
        <Alert tone="danger">{error}</Alert>
      </InspectorPane>
    );
  if (!finding)
    return (
      <InspectorPane label="Finding" header={<Skeleton className="h-4 w-28" />}>
        <SkeletonRows rows={6} columns={1} />
      </InspectorPane>
    );

  const number = formatFindingNumber(finding.number);
  const by = parseCreatedBy(finding.created_by);
  const href = findingHref(projectId, finding);

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(findingPath(projectId, findingId));
      toast("ok", `Link to ${number} copied`);
    } catch {
      toast("danger", "Could not copy the link");
    }
  }

  async function confirmDelete() {
    setDeleting(true);
    try {
      await remove();
      setConfirming(false);
      toast("ok", `${number} deleted`);
      go(null);
    } catch (e) {
      toast("danger", messageOf(e, "could not delete the finding"));
    } finally {
      setDeleting(false);
    }
  }

  return (
    <InspectorPane
      label={`Finding ${number}`}
      header={
        <div className="flex items-center justify-between gap-2">
          <div className="flex min-w-0 items-center gap-2">
            <span className="text-xs text-muted">Selected finding</span>
            <span className="font-mono text-xs text-ink">{number}</span>
            <Pill size="sm" tone={by.kind === "model" ? "accent" : "neutral"}>
              {by.kind === "model" ? "AI" : "Manual"}
            </Pill>
          </div>
          <MenuButton
            label="Finding actions"
            iconOnly
            icon="list"
            items={[
              { id: "copy", label: "Copy link", icon: "external", onSelect: () => void copyLink() },
              { id: "delete", label: "Delete", icon: "trash", danger: true, onSelect: () => setConfirming(true) },
            ]}
          />
        </div>
      }
      footer={
        anchorSlot ?? (
          <Link
            to={href}
            onClick={(e) => {
              if (!onNavigate) return;
              e.preventDefault();
              onNavigate(href);
            }}
            className={buttonClass("secondary", "md", "w-full justify-center")}
          >
            Open in workspace
          </Link>
        )
      }
    >
      <InspectorSection title="Type">
        <TypeField
          type={types.get(finding.type_id) ?? null}
          defectTypes={defectTypes}
          onChange={(typeId) => void update({ type_id: typeId })}
        />
      </InspectorSection>
      <InspectorSection title="Severity">
        <SeverityPicker allowNone value={finding.severity} onChange={(level) => void update({ severity: level })} />
      </InspectorSection>
      <InspectorSection title="Status">
        <StatusField value={finding.status} onChange={(status) => void update({ status })} />
      </InspectorSection>
      {measureSlot && <InspectorSection title="Measured size">{measureSlot}</InspectorSection>}
      <Provenance finding={finding} nowMs={nowMs} />
      <Dialog
        open={confirming}
        title={`Delete ${number}?`}
        onClose={() => setConfirming(false)}
        footer={
          <>
            <Button variant="ghost" onClick={() => setConfirming(false)}>
              Keep
            </Button>
            <Button variant="danger" loading={deleting} onClick={() => void confirmDelete()}>
              {`Delete ${number}`}
            </Button>
          </>
        }
      >
        <p className="text-sm text-muted">
          Its photos and comments go with it.
          {finding.anchor.kind === "image" ? " Its box on the image is deleted too." : ""}
        </p>
      </Dialog>
    </InspectorPane>
  );
}
```

- [ ] **Step 6: Run the tests**

Run: `pnpm -C frontend exec vitest run src/findings/FindingInspector.test.tsx`
Expected: PASS (9 tests).

- [ ] **Step 7: Lint**

Run: `pnpm -C frontend lint`
Expected: exit 0.

- [ ] **Step 8: Commit**

```bash
git add frontend/src/findings/inspectorStore.ts frontend/src/findings/FindingInspector.tsx frontend/src/findings/inspector/useFinding.ts frontend/src/findings/inspector/fields.tsx frontend/src/findings/inspector/Provenance.tsx frontend/src/findings/FindingInspector.test.tsx
git commit -m "feat(findings): shared FindingInspector with type, severity, status, provenance and slots

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

### Task 6: Inspector sections — note autosave, photos, comments, history

**Files:**
- Create: `frontend/src/findings/inspector/useAutosave.ts`, `NoteField.tsx`, `Attachments.tsx`, `Comments.tsx`, `History.tsx`
- Modify: `frontend/src/findings/FindingInspector.tsx` (add sections 7–10)
- Test: `frontend/src/findings/FindingInspector.sections.test.tsx`

**Interfaces:**
- Consumes: `patchFinding`, `listComments`, `addComment`, `editComment`, `deleteComment`,
  `listAttachments`, `addAttachment`, `deleteAttachment`, `listActivity`, `attachmentThumbnailUrl`,
  `attachmentFileUrl` (Task 1); `relativeTime` (Task 2); `FindingInspector` (Task 5).
- Produces:
  - `NOTE_AUTOSAVE_MS = 600`; `useAutosave(value, saved, save): SaveState` (`"idle" | "saving" | "saved" | "error"`), flushing a pending value on unmount
  - `NoteField({projectId, findingId, initial})`, `Attachments({projectId, findingId})`,
    `Comments({projectId, findingId})`, `History({projectId, findingId})`

- [ ] **Step 1: Write the failing test**

`frontend/src/findings/FindingInspector.sections.test.tsx`:

```tsx
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { errorBody, exampleModel, fakeClient, PROJECT_ID, type FakeRoute, type RecordedRequest } from "@/test/fixtures";
import {
  baseRoutes,
  exampleActivity,
  exampleAttachment,
  exampleComment,
  exampleFindingDetail,
  FINDING_ID,
  FINDING_ID_2,
} from "@/test/findingFixtures";
import { renderWithProviders, TestApiProvider } from "@/test/render";
import { useChangesStore } from "@/store/changes";
import { MemoryRouter } from "react-router-dom";
import { FindingInspector } from "./FindingInspector";
import { NoteField } from "./inspector/NoteField";

const routes = (extra: FakeRoute[] = []): FakeRoute[] =>
  baseRoutes([
    ...extra,
    { method: "GET", path: /\/library\/models\/[^/]+$/, body: exampleModel },
    { method: "GET", path: /\/comments$/, body: { items: [exampleComment], next_cursor: null } },
    { method: "POST", path: /\/comments$/, status: 201, body: (r) => ({ ...exampleComment, id: "c2", text: (r.body as { text: string }).text }) },
    { method: "PATCH", path: /\/comments\/[^/]+$/, body: (r) => ({ ...exampleComment, text: (r.body as { text: string }).text, edited_at: "2026-09-26T10:00:00Z" }) },
    { method: "DELETE", path: /\/comments\/[^/]+$/, status: 204 },
    { method: "GET", path: /\/attachments$/, body: { items: [exampleAttachment] } },
    { method: "POST", path: /\/attachments$/, status: 201, body: exampleAttachment },
    { method: "GET", path: /\/activity$/, body: { items: exampleActivity, next_cursor: null } },
    { method: "PATCH", path: /\/findings\/[^/]+$/, body: exampleFindingDetail },
    { method: "GET", path: /\/findings\/[^/]+$/, body: exampleFindingDetail },
  ]);

function renderInspector(extra: FakeRoute[] = []) {
  const { api, requests } = fakeClient(routes(extra));
  renderWithProviders(<FindingInspector projectId={PROJECT_ID} findingId={FINDING_ID} />, { api });
  return requests;
}

const bodies = (requests: RecordedRequest[], method: string, re: RegExp) =>
  requests.filter((r) => r.method === method && re.test(r.url)).map((r) => r.body);

describe("inspector note", () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    useChangesStore.setState({ findingsRevision: 0 });
  });
  afterEach(() => vi.useRealTimers());

  it("saves once, 600 ms after the last keystroke, then says Saved", async () => {
    const requests = renderInspector();
    const note = await screen.findByRole("textbox", { name: "Note" });
    fireEvent.change(note, { target: { value: "crack 3" } });
    fireEvent.change(note, { target: { value: "crack 3 mm" } });
    await act(async () => {
      vi.advanceTimersByTime(599);
    });
    expect(bodies(requests, "PATCH", /\/findings\/[^/]+$/)).toEqual([]);
    await act(async () => {
      vi.advanceTimersByTime(1);
    });
    await waitFor(() => expect(bodies(requests, "PATCH", /\/findings\/[^/]+$/)).toEqual([{ note: "crack 3 mm" }]));
    expect(await screen.findByText("Saved")).toBeInTheDocument();
    // Typing a digit into the note is text, not a severity key.
    expect(requests.some((r) => r.url.includes("/bulk"))).toBe(false);
  });

  it("flushes an unsaved note to its own finding when the inspector switches", async () => {
    const { api, requests } = fakeClient(routes());
    const view = (findingId: string) => (
      <TestApiProvider api={api}>
        <MemoryRouter>
          <NoteField key={findingId} projectId={PROJECT_ID} findingId={findingId} initial="" />
        </MemoryRouter>
      </TestApiProvider>
    );
    const { rerender } = render(view(FINDING_ID));
    fireEvent.change(screen.getByRole("textbox", { name: "Note" }), { target: { value: "for 217" } });
    rerender(view(FINDING_ID_2));
    await waitFor(() => expect(requests.filter((r) => r.method === "PATCH")).toHaveLength(1));
    const patch = requests.find((r) => r.method === "PATCH")!;
    expect(patch.url).toContain(`/findings/${FINDING_ID}`);
    expect(patch.body).toEqual({ note: "for 217" });
  });
});

describe("inspector photos, comments and history", () => {
  beforeEach(() => useChangesStore.setState({ findingsRevision: 0 }));

  it("adds a photo by path in the browser and shows the refusal reason", async () => {
    const requests = renderInspector([
      {
        method: "POST",
        path: /\/attachments$/,
        status: 422,
        body: errorBody("attachment_invalid", "not an image: notes.txt"),
      },
    ]);
    expect(await screen.findByRole("button", { name: "View site-photo.jpg" })).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Photo file"), { target: { value: "E:/notes.txt" } });
    fireEvent.click(screen.getByRole("button", { name: "Add photo" }));
    expect(await screen.findByText("This photo was not added: not an image: notes.txt")).toBeInTheDocument();
    expect(bodies(requests, "POST", /\/attachments$/)).toEqual([{ path: "E:/notes.txt" }]);
  });

  it("opens a photo in the lightbox", async () => {
    renderInspector();
    fireEvent.click(await screen.findByRole("button", { name: "View site-photo.jpg" }));
    const dialog = await screen.findByRole("dialog", { name: "site-photo.jpg" });
    expect(dialog.querySelector("img")?.getAttribute("src")).toContain(`/attachments/${exampleAttachment.id}/file?token=`);
  });

  it("replies with Enter; Shift+Enter keeps a new line", async () => {
    const requests = renderInspector();
    expect(await screen.findByText(exampleComment.text)).toBeInTheDocument();
    const reply = screen.getByRole("textbox", { name: "Reply" });
    fireEvent.change(reply, { target: { value: "Patched" } });
    fireEvent.keyDown(reply, { key: "Enter", shiftKey: true });
    expect(bodies(requests, "POST", /\/comments$/)).toEqual([]);
    fireEvent.keyDown(reply, { key: "Enter" });
    await waitFor(() => expect(bodies(requests, "POST", /\/comments$/)).toEqual([{ text: "Patched" }]));
    expect(await screen.findByText("Patched")).toBeInTheDocument();
  });

  it("edits and deletes a comment", async () => {
    const requests = renderInspector();
    await screen.findByText(exampleComment.text);
    fireEvent.click(screen.getByRole("button", { name: "Edit comment" }));
    const box = screen.getByRole("textbox", { name: "Edit comment" });
    fireEvent.change(box, { target: { value: "Depth 30 mm." } });
    fireEvent.keyDown(box, { key: "Enter" });
    expect(await screen.findByText("Depth 30 mm.")).toBeInTheDocument();
    expect(screen.getByText("(edited)")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Delete comment" }));
    fireEvent.click(screen.getByRole("button", { name: "Delete" }));
    await waitFor(() => expect(requests.some((r) => r.method === "DELETE" && r.url.includes("/comments/"))).toBe(true));
  });

  it("lists the finding's history from the activity feed", async () => {
    const requests = renderInspector();
    expect(await screen.findByText("F-0217 set to Critical")).toBeInTheDocument();
    const q = new URL(requests.find((r) => r.url.includes("/activity"))!.url, "http://fake").searchParams;
    expect(q.get("subject_id")).toBe(FINDING_ID);
    expect(q.get("limit")).toBe("20");
  });
});
```

The fixture activity feed contains three rows; the fake backend does not filter by `subject_id`,
so all three render — the assertion is on the query, not on filtering.

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm -C frontend exec vitest run src/findings/FindingInspector.sections.test.tsx`
Expected: FAIL — `Failed to resolve import "./inspector/NoteField"`.

- [ ] **Step 3: Write the autosave hook and the note field**

`frontend/src/findings/inspector/useAutosave.ts`:

```ts
import { useEffect, useRef, useState } from "react";

export const NOTE_AUTOSAVE_MS = 600;
export type SaveState = "idle" | "saving" | "saved" | "error";

/**
 * Saves `value` `delay` ms after it last changed, unless it equals `saved`. A value still waiting
 * when the component unmounts (the inspector switched findings) is saved at once, through the
 * `save` of the render that typed it, so it lands on its own finding.
 */
export function useAutosave(
  value: string,
  saved: string,
  save: (v: string) => Promise<void>,
  delay = NOTE_AUTOSAVE_MS,
): SaveState {
  const [state, setState] = useState<SaveState>("idle");
  const saveRef = useRef(save);
  const pending = useRef<string | null>(null);
  useEffect(() => {
    saveRef.current = save;
  });

  useEffect(() => {
    if (value === saved) {
      pending.current = null;
      return;
    }
    pending.current = value;
    const timer = window.setTimeout(() => {
      pending.current = null;
      setState("saving");
      saveRef.current(value).then(
        () => setState("saved"),
        () => setState("error"),
      );
    }, delay);
    return () => window.clearTimeout(timer);
  }, [value, saved, delay]);

  useEffect(
    () => () => {
      if (pending.current !== null) void saveRef.current(pending.current).catch(() => undefined);
    },
    [],
  );

  return state;
}
```

`frontend/src/findings/inspector/NoteField.tsx`:

```tsx
import { useCallback, useState } from "react";
import { useApi } from "@/api/client";
import { patchFinding } from "@/api/findings";
import { useChangesStore } from "@/store/changes";
import { Textarea } from "@/ui";
import { useAutosave } from "./useAutosave";

const LABEL = { idle: "", saving: "Saving…", saved: "Saved", error: "Not saved. Keep typing to retry." } as const;

/**
 * F §8.7 item 7. Mounted with `key={findingId}`: it reads `initial` once, so a refetch never
 * overwrites what the operator is typing, and its save is bound to its own finding.
 */
export function NoteField({ projectId, findingId, initial }: { projectId: string; findingId: string; initial: string }) {
  const api = useApi();
  const [text, setText] = useState(initial);
  const [saved, setSaved] = useState(initial);
  const save = useCallback(
    async (v: string) => {
      await patchFinding(api, projectId, findingId, { note: v });
      setSaved(v);
      useChangesStore.getState().bumpFindings();
    },
    [api, projectId, findingId],
  );
  const state = useAutosave(text, saved, save);
  return (
    <div className="flex flex-col gap-1">
      <Textarea aria-label="Note" rows={4} value={text} onChange={(e) => setText(e.target.value)} className="resize-none" />
      <span aria-live="polite" className="h-4 text-2xs text-muted">
        {LABEL[state]}
      </span>
    </div>
  );
}
```

`setSaved` after unmount (the flush path) is a no-op in React 18; the save still reaches the server.

- [ ] **Step 4: Write the photos section**

`frontend/src/findings/inspector/Attachments.tsx`:

```tsx
import { useEffect, useState } from "react";
import { useApi, useBackend } from "@/api/client";
import { codeOf, messageOf } from "@/api/errors";
import {
  addAttachment,
  attachmentFileUrl,
  attachmentThumbnailUrl,
  deleteAttachment,
  listAttachments,
  type FindingAttachment,
} from "@/api/findings";
import { pushLog } from "@/app/diagnostics";
import { useChangesStore } from "@/store/changes";
import { Alert, Button, Dialog, Input } from "@/ui";

function refusal(e: unknown): string {
  return codeOf(e) === "attachment_invalid"
    ? `This photo was not added: ${messageOf(e, "not a JPEG, PNG or WebP under 50 MB")}`
    : messageOf(e, "could not add the photo");
}

/** F §8.7 item 8: a thumbnail grid, add through the Tauri file dialog, a lightbox. */
export function Attachments({ projectId, findingId }: { projectId: string; findingId: string }) {
  const api = useApi();
  const { baseUrl, token, mode } = useBackend();
  const [loaded, setLoaded] = useState<{ id: string; items: FindingAttachment[] } | null>(null);
  const [revision, setRevision] = useState(0);
  const [path, setPath] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [viewing, setViewing] = useState<FindingAttachment | null>(null);

  useEffect(() => {
    let cancelled = false;
    listAttachments(api, projectId, findingId)
      .then((items) => {
        if (!cancelled) setLoaded({ id: findingId, items });
      })
      .catch((e: unknown) => pushLog(`attachments unavailable: ${messageOf(e, String(e))}`));
    return () => {
      cancelled = true;
    };
  }, [api, projectId, findingId, revision]);

  async function add(file: string) {
    setBusy(true);
    setError(null);
    try {
      await addAttachment(api, projectId, findingId, file);
      setPath("");
      setRevision((r) => r + 1);
      useChangesStore.getState().bumpFindings();
    } catch (e) {
      setError(refusal(e));
    } finally {
      setBusy(false);
    }
  }

  async function pick() {
    const { open } = await import("@tauri-apps/plugin-dialog");
    const picked = await open({ multiple: false, filters: [{ name: "Photos", extensions: ["jpg", "jpeg", "png", "webp"] }] });
    if (typeof picked === "string") await add(picked);
  }

  async function remove(a: FindingAttachment) {
    try {
      await deleteAttachment(api, projectId, findingId, a.id);
      setViewing(null);
      setRevision((r) => r + 1);
      useChangesStore.getState().bumpFindings();
    } catch (e) {
      setError(messageOf(e, "could not remove the photo"));
    }
  }

  const items = loaded?.id === findingId ? loaded.items : [];
  return (
    <div className="flex flex-col gap-2">
      {items.length > 0 && (
        <ul className="grid grid-cols-4 gap-1.5">
          {items.map((a) => (
            <li key={a.id}>
              <button
                type="button"
                aria-label={`View ${a.original_name}`}
                onClick={() => setViewing(a)}
                className="block aspect-square w-full overflow-hidden rounded-sm bg-surface-2"
              >
                <img
                  src={attachmentThumbnailUrl(baseUrl, token, projectId, findingId, a.id)}
                  alt=""
                  loading="lazy"
                  className="h-full w-full object-cover"
                />
              </button>
            </li>
          ))}
        </ul>
      )}
      {mode === "tauri" ? (
        <Button size="sm" icon="plus" loading={busy} onClick={() => void pick()} className="self-start">
          Add photo
        </Button>
      ) : (
        <div className="flex gap-2">
          <Input aria-label="Photo file" value={path} onChange={(e) => setPath(e.target.value)} placeholder="E:/photos/site.jpg" className="font-mono" />
          <Button size="sm" loading={busy} disabled={!path.trim()} onClick={() => void add(path.trim())}>
            Add photo
          </Button>
        </div>
      )}
      {error && (
        <Alert tone="danger" onDismiss={() => setError(null)}>
          {error}
        </Alert>
      )}
      <Dialog
        open={viewing !== null}
        title={viewing?.original_name ?? ""}
        width="lg"
        onClose={() => setViewing(null)}
        footer={
          viewing && (
            <Button variant="danger" icon="trash" onClick={() => void remove(viewing)}>
              Remove photo
            </Button>
          )
        }
      >
        {viewing && (
          <img
            src={attachmentFileUrl(baseUrl, token, projectId, findingId, viewing.id)}
            alt={viewing.original_name}
            className="max-h-[70vh] w-full rounded-control object-contain"
          />
        )}
      </Dialog>
    </div>
  );
}
```

- [ ] **Step 5: Write comments and history**

`frontend/src/findings/inspector/Comments.tsx`:

```tsx
import { useEffect, useState, type KeyboardEvent } from "react";
import { useApi } from "@/api/client";
import { messageOf } from "@/api/errors";
import { addComment, deleteComment, editComment, listComments, type FindingComment } from "@/api/findings";
import { pushLog } from "@/app/diagnostics";
import { useNow } from "@/jobs/useNow";
import { useChangesStore } from "@/store/changes";
import { Alert, Button, IconButton, Textarea } from "@/ui";
import { relativeTime } from "../format";

const MAX_TEXT = 4000;

/** Enter sends, Shift+Enter is a new line; Esc cancels an edit. */
function onEnter(e: KeyboardEvent<HTMLTextAreaElement>, send: () => void, cancel?: () => void) {
  if (e.key === "Enter" && !e.shiftKey) {
    e.preventDefault();
    send();
  } else if (e.key === "Escape" && cancel) {
    e.preventDefault();
    cancel();
  }
}

/** F §8.7 item 9. One operator uses the app, so every comment is theirs to edit or delete. */
export function Comments({ projectId, findingId }: { projectId: string; findingId: string }) {
  const api = useApi();
  const nowMs = useNow(60_000);
  const [loaded, setLoaded] = useState<{ id: string; items: FindingComment[]; cursor: string | null } | null>(null);
  const [reply, setReply] = useState("");
  const [editing, setEditing] = useState<{ id: string; text: string } | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    listComments(api, projectId, findingId)
      .then((page) => {
        if (!cancelled) setLoaded({ id: findingId, items: page.items, cursor: page.next_cursor });
      })
      .catch((e: unknown) => pushLog(`comments unavailable: ${messageOf(e, String(e))}`));
    return () => {
      cancelled = true;
    };
  }, [api, projectId, findingId]);

  const items = loaded?.id === findingId ? loaded.items : [];
  const setItems = (next: (xs: FindingComment[]) => FindingComment[]) =>
    setLoaded((s) => (s && s.id === findingId ? { ...s, items: next(s.items) } : s));

  async function more() {
    if (!loaded?.cursor) return;
    const page = await listComments(api, projectId, findingId, loaded.cursor);
    setLoaded((s) => (s ? { ...s, items: [...s.items, ...page.items], cursor: page.next_cursor === s.cursor ? null : page.next_cursor } : s));
  }

  async function send() {
    const text = reply.trim();
    if (!text) return;
    try {
      const c = await addComment(api, projectId, findingId, text);
      setItems((xs) => [...xs, c]);
      setReply("");
      useChangesStore.getState().bumpFindings();
    } catch (e) {
      setError(messageOf(e, "could not post the comment"));
    }
  }

  async function saveEdit() {
    if (!editing || !editing.text.trim()) return;
    try {
      const c = await editComment(api, projectId, findingId, editing.id, editing.text.trim());
      setItems((xs) => xs.map((x) => (x.id === c.id ? c : x)));
      setEditing(null);
    } catch (e) {
      setError(messageOf(e, "could not save the comment"));
    }
  }

  async function remove(id: string) {
    try {
      await deleteComment(api, projectId, findingId, id);
      setItems((xs) => xs.filter((x) => x.id !== id));
      setDeleting(null);
      useChangesStore.getState().bumpFindings();
    } catch (e) {
      setError(messageOf(e, "could not delete the comment"));
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <ul className="flex flex-col gap-3">
        {items.map((c) => (
          <li key={c.id} className="flex flex-col gap-1 text-sm">
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs font-semibold text-ink">
                {c.author}{" "}
                <span className="font-normal text-muted">{relativeTime(c.created_at, nowMs)}</span>
                {c.edited_at && <span className="ml-1 font-normal text-muted">(edited)</span>}
              </span>
              <span className="flex gap-0.5">
                <IconButton size="sm" icon="label" label="Edit comment" onClick={() => setEditing({ id: c.id, text: c.text })} />
                <IconButton size="sm" icon="trash" label="Delete comment" onClick={() => setDeleting(c.id)} />
              </span>
            </div>
            {editing?.id === c.id ? (
              <Textarea
                aria-label="Edit comment"
                rows={2}
                maxLength={MAX_TEXT}
                value={editing.text}
                onChange={(e) => setEditing({ id: c.id, text: e.target.value })}
                onKeyDown={(e) => onEnter(e, () => void saveEdit(), () => setEditing(null))}
              />
            ) : (
              <p className="whitespace-pre-wrap text-ink">{c.text}</p>
            )}
            {deleting === c.id && (
              <Alert
                tone="warn"
                role="status"
                actions={
                  <>
                    <Button size="sm" variant="danger" onClick={() => void remove(c.id)}>
                      Delete
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => setDeleting(null)}>
                      Keep
                    </Button>
                  </>
                }
              >
                Delete this comment?
              </Alert>
            )}
          </li>
        ))}
      </ul>
      {loaded?.cursor && (
        <Button size="sm" variant="ghost" onClick={() => void more()} className="self-start">
          Show more comments
        </Button>
      )}
      <Textarea
        aria-label="Reply"
        rows={2}
        maxLength={MAX_TEXT}
        placeholder="Reply · Enter to send"
        value={reply}
        onChange={(e) => setReply(e.target.value)}
        onKeyDown={(e) => onEnter(e, () => void send())}
      />
      {error && (
        <Alert tone="danger" onDismiss={() => setError(null)}>
          {error}
        </Alert>
      )}
    </div>
  );
}
```

`IconButton`'s `label` prop and `icon="label"` are today's API; use the ledger's names if DS
renamed them.

`frontend/src/findings/inspector/History.tsx`:

```tsx
import { useEffect, useState } from "react";
import { useApi } from "@/api/client";
import { messageOf } from "@/api/errors";
import { listActivity, type Activity } from "@/api/findings";
import { pushLog } from "@/app/diagnostics";
import { useNow } from "@/jobs/useNow";
import { useChangesStore } from "@/store/changes";
import { relativeTime } from "../format";

export const HISTORY_LIMIT = 20;

/** F §8.7 item 10: the activity feed filtered to this finding. */
export function History({ projectId, findingId }: { projectId: string; findingId: string }) {
  const api = useApi();
  const nowMs = useNow(60_000);
  const revision = useChangesStore((s) => s.findingsRevision);
  const [loaded, setLoaded] = useState<{ id: string; items: Activity[] } | null>(null);
  useEffect(() => {
    let cancelled = false;
    listActivity(api, projectId, { subject_id: findingId, limit: HISTORY_LIMIT })
      .then((page) => {
        if (!cancelled) setLoaded({ id: findingId, items: page.items });
      })
      .catch((e: unknown) => pushLog(`history unavailable: ${messageOf(e, String(e))}`));
    return () => {
      cancelled = true;
    };
  }, [api, projectId, findingId, revision]);
  const items = loaded?.id === findingId ? loaded.items : [];
  if (items.length === 0) return <p className="text-xs text-muted">No history yet.</p>;
  return (
    <ol className="flex flex-col gap-2 text-xs">
      {items.map((a) => (
        <li key={a.id} className="flex items-baseline justify-between gap-3">
          <span className="text-ink">{a.summary}</span>
          <span className="shrink-0 text-muted">{relativeTime(a.at, nowMs)}</span>
        </li>
      ))}
    </ol>
  );
}
```

- [ ] **Step 6: Add the sections to the inspector**

In `frontend/src/findings/FindingInspector.tsx` add the imports

```tsx
import { Attachments } from "./inspector/Attachments";
import { Comments } from "./inspector/Comments";
import { History } from "./inspector/History";
import { NoteField } from "./inspector/NoteField";
```

and, directly after `<Provenance finding={finding} nowMs={nowMs} />`:

```tsx
      <InspectorSection title="Note">
        <NoteField key={finding.id} projectId={projectId} findingId={finding.id} initial={finding.note} />
      </InspectorSection>
      <InspectorSection title={`Attached photos · ${finding.attachment_count}`}>
        <Attachments projectId={projectId} findingId={finding.id} />
      </InspectorSection>
      <InspectorSection title={`Comments · ${finding.comment_count}`}>
        <Comments projectId={projectId} findingId={finding.id} />
      </InspectorSection>
      <InspectorSection title="History">
        <History projectId={projectId} findingId={finding.id} />
      </InspectorSection>
```

- [ ] **Step 7: Run the inspector tests**

Run: `pnpm -C frontend exec vitest run src/findings/FindingInspector`
Expected: PASS (both files; 7 new tests).

- [ ] **Step 8: Lint**

Run: `pnpm -C frontend lint`
Expected: exit 0.

- [ ] **Step 9: Commit**

```bash
git add frontend/src/findings/inspector/useAutosave.ts frontend/src/findings/inspector/NoteField.tsx frontend/src/findings/inspector/Attachments.tsx frontend/src/findings/inspector/Comments.tsx frontend/src/findings/inspector/History.tsx frontend/src/findings/FindingInspector.tsx frontend/src/findings/FindingInspector.sections.test.tsx
git commit -m "feat(findings): inspector note autosave, photos, comments and history

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

### Task 7: Findings tab — inspector route, bulk bar, keyboard

**Files:**
- Create: `frontend/src/findings/BulkBar.tsx`, `frontend/src/findings/keys.ts`, `frontend/src/findings/useFindingKeys.ts`
- Modify: `frontend/src/findings/FindingsScreen.tsx`
- Test: `frontend/src/findings/FindingsScreen.keys.test.tsx`

**Interfaces:**
- Consumes: `bulkUpdateFindings`, `FINDINGS_BULK_MAX`, `BulkSet`, `BulkResult` (Task 1);
  `STATUS_LABEL` (Task 2); `FindingInspector`, `useInspectorCommands` (Task 5); DS `MenuButton`,
  `GlassPanel`, `toast`; `isTypingTarget`, `GLOBAL_KEYS`, `REVIEW_KEYS` from `@/ui/keymap`.
- Produces:
  - `BulkBar({projectId, ids, scale, onDone, onClear})`, `bulkMessage(updated, skipped, what): string`, `applyBulk(api, projectId, ids, set): Promise<BulkResult>` (chunks by 1000)
  - `FindingsKey {keys: string[]; action; help}`, `FINDINGS_KEYS` (Shift+O/R/C)
  - `useFindingKeys(enabled, scaleSize, handlers: {onSeverity(level); onStatus(status); onTypePicker(); onClose()})`

- [ ] **Step 1: Write the failing test**

`frontend/src/findings/FindingsScreen.keys.test.tsx`:

```tsx
import { beforeEach, describe, expect, it } from "vitest";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import { useLocation } from "react-router-dom";
import { fakeClient, PROJECT_ID, type RecordedRequest } from "@/test/fixtures";
import { baseRoutes, exampleFinding, exampleFinding2, exampleFindingDetail } from "@/test/findingFixtures";
import { renderWithProviders } from "@/test/render";
import { useChangesStore } from "@/store/changes";
import { GLOBAL_KEYS, REVIEW_KEYS } from "@/ui/keymap";
import { applyBulk, bulkMessage } from "./BulkBar";
import { FindingsScreen } from "./FindingsScreen";
import { FINDINGS_KEYS } from "./keys";
import { useInspectorCommands } from "./inspectorStore";

function LocationProbe() {
  const l = useLocation();
  return <output data-testid="location">{l.pathname + l.search}</output>;
}

function renderTab(path = "") {
  const { api, requests } = fakeClient(
    baseRoutes([
      { method: "POST", path: /\/findings\/bulk$/, body: (r) => ({ updated: (r.body as { ids: string[] }).ids.length, skipped: [] }) },
      { method: "GET", path: /\/findings$/, body: { items: [exampleFinding, exampleFinding2], next_cursor: null } },
      { method: "GET", path: /\/findings\/[^/]+\/(comments|attachments)$/, body: { items: [], next_cursor: null } },
      { method: "GET", path: /\/activity$/, body: { items: [], next_cursor: null } },
      { method: "GET", path: /\/library\/models\/[^/]+$/, status: 404, body: { error: { code: "not_found", message: "x", details: {} } } },
      { method: "GET", path: /\/findings\/(?!summary$)[^/]+$/, body: exampleFindingDetail },
    ]),
  );
  renderWithProviders(
    <>
      <FindingsScreen />
      <LocationProbe />
    </>,
    { api, route: `/p/${PROJECT_ID}/findings${path}`, path: "/p/:projectId/findings/:findingId?" },
  );
  return requests;
}

const bulkBodies = (requests: RecordedRequest[]) => requests.filter((r) => r.url.includes("/bulk")).map((r) => r.body);
const key = (k: string, init: KeyboardEventInit = {}) => fireEvent.keyDown(window, { key: k, ...init });

describe("Findings tab keys and bulk", () => {
  beforeEach(() => useChangesStore.setState({ findingsRevision: 0 }));

  it("keeps its own keys clear of the global and review keys", () => {
    const taken = new Set([...GLOBAL_KEYS, ...REVIEW_KEYS].flatMap((k) => k.keys.map((c) => c.toLowerCase())));
    for (const k of FINDINGS_KEYS) for (const c of k.keys) expect(taken.has(c.toLowerCase())).toBe(false);
  });

  it("opens the inspector for the finding in the URL", async () => {
    renderTab(`/${exampleFinding.id}`);
    expect(await screen.findByText("Selected finding")).toBeInTheDocument();
  });

  it("grades the open finding with a digit and ignores digits beyond the scale", async () => {
    const requests = renderTab(`/${exampleFinding.id}`);
    await screen.findByText("Selected finding");
    key("7");
    key("3");
    await waitFor(() => expect(bulkBodies(requests)).toEqual([{ ids: [exampleFinding.id], set: { severity: 3 } }]));
  });

  it("typing digits in the search field sets no severity", async () => {
    const requests = renderTab(`/${exampleFinding.id}`);
    await screen.findByText("Selected finding");
    const search = screen.getByRole("searchbox", { name: "Search findings" });
    fireEvent.keyDown(search, { key: "3" });
    fireEvent.keyDown(search, { key: "C", shiftKey: true });
    expect(bulkBodies(requests)).toEqual([]);
  });

  it("sets the status with Shift+O / Shift+R / Shift+C", async () => {
    const requests = renderTab(`/${exampleFinding.id}`);
    await screen.findByText("Selected finding");
    key("C", { shiftKey: true });
    await waitFor(() => expect(bulkBodies(requests)).toEqual([{ ids: [exampleFinding.id], set: { status: "closed" } }]));
  });

  it("T asks the inspector for its type picker", async () => {
    renderTab(`/${exampleFinding.id}`);
    await screen.findByText("Selected finding");
    const before = useInspectorCommands.getState().typePickerNonce;
    key("t");
    expect(useInspectorCommands.getState().typePickerNonce).toBe(before + 1);
  });

  it("Esc closes the inspector and keeps the filters", async () => {
    renderTab(`/${exampleFinding.id}?status=open`);
    await screen.findByText("Selected finding");
    key("Escape");
    await waitFor(() => expect(screen.getByTestId("location")).toHaveTextContent(`/p/${PROJECT_ID}/findings?status=open`));
  });

  it("closes every checked row from the bulk bar", async () => {
    const requests = renderTab();
    await screen.findByText("F-0217");
    for (const box of screen.getAllByRole("checkbox", { name: /Select/ }).slice(0, 2)) fireEvent.click(box);
    expect(screen.getByText("2 selected")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Set status" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Closed" }));
    await waitFor(() =>
      expect(bulkBodies(requests)).toEqual([{ ids: [exampleFinding.id, exampleFinding2.id], set: { status: "closed" } }]),
    );
    await waitFor(() => expect(screen.queryByText("2 selected")).toBeNull());
  });
});

describe("bulk helpers", () => {
  it("splits more than 1000 ids into several requests", async () => {
    const { api, requests } = fakeClient([
      { method: "POST", path: /\/findings\/bulk$/, body: (r) => ({ updated: (r.body as { ids: string[] }).ids.length, skipped: [] }) },
    ]);
    const ids = Array.from({ length: 2345 }, (_, i) => `f-${i}`);
    const result = await applyBulk(api, PROJECT_ID, ids, { status: "closed" });
    expect(requests.map((r) => (r.body as { ids: string[] }).ids.length)).toEqual([1000, 1000, 345]);
    expect(result.updated).toBe(2345);
  });

  it("explains skipped findings", () => {
    expect(bulkMessage(3, [], "Closed")).toBe("3 findings set to Closed.");
    expect(bulkMessage(1, [], "Critical")).toBe("1 finding set to Critical.");
    expect(bulkMessage(2, [{ id: "a", code: "invalid_transition" }], "Reviewed")).toBe(
      "2 findings set to Reviewed. 1 skipped: a closed finding has to be reopened first.",
    );
  });
});
```

The checkbox names (`/Select/`) assume DS `DataTable` labels its row checkboxes "Select F-0217"-style;
adapt the query to the ledger.

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm -C frontend exec vitest run src/findings/FindingsScreen.keys.test.tsx`
Expected: FAIL — `Failed to resolve import "./BulkBar"`.

- [ ] **Step 3: Write keys and the key hook**

`frontend/src/findings/keys.ts`:

```ts
/**
 * The Findings tab's own keys (F §8.6). DS keeps them out of the app keymap (they are focused-view
 * keys, DS plan deviation 5), so they live here for the ? sheet and the collision test; digits, T and
 * Esc are the shared review and global keys.
 */
export interface FindingsKey {
  keys: string[];
  action: string;
  help: string;
}

export const FINDINGS_KEYS: FindingsKey[] = [
  { keys: ["Shift+O"], action: "status-open", help: "Set status Open" },
  { keys: ["Shift+R"], action: "status-reviewed", help: "Set status Reviewed" },
  { keys: ["Shift+C"], action: "status-closed", help: "Set status Closed" },
];
```

`frontend/src/findings/useFindingKeys.ts`:

```ts
import { useEffect, useRef } from "react";
import type { FindingStatus } from "@/api/findings";
import { isTypingTarget } from "@/ui/keymap";

export interface FindingKeyHandlers {
  onSeverity: (level: number) => void;
  onStatus: (status: FindingStatus) => void;
  onTypePicker: () => void;
  onClose: () => void;
}

const STATUS_KEY: Record<string, FindingStatus> = { o: "open", r: "reviewed", c: "closed" };

/** Esc belongs to an open dialog, listbox or menu before it closes the inspector. */
function insideOverlay(target: EventTarget | null): boolean {
  return target instanceof Element && target.closest('[role="dialog"],[role="listbox"],[role="menu"]') !== null;
}

/** 1–9 severity (beyond the scale ignored), Shift+O/R/C status, T type picker, Esc close (F §5.6, §8.6). */
export function useFindingKeys(enabled: boolean, scaleSize: number, handlers: FindingKeyHandlers): void {
  const ref = useRef(handlers);
  useEffect(() => {
    ref.current = handlers;
  });
  useEffect(() => {
    if (!enabled) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.ctrlKey || e.metaKey || e.altKey || isTypingTarget(e.target)) return;
      const k = e.key.toLowerCase();
      if (!e.shiftKey && /^[1-9]$/.test(k)) {
        const level = Number(k);
        if (level <= scaleSize) {
          e.preventDefault();
          ref.current.onSeverity(level);
        }
        return;
      }
      if (e.shiftKey && k in STATUS_KEY) {
        e.preventDefault();
        ref.current.onStatus(STATUS_KEY[k]);
        return;
      }
      if (!e.shiftKey && k === "t") {
        e.preventDefault();
        ref.current.onTypePicker();
        return;
      }
      if (k === "escape" && !insideOverlay(e.target)) ref.current.onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [enabled, scaleSize]);
}
```

- [ ] **Step 4: Write the bulk bar**

`frontend/src/findings/BulkBar.tsx`:

```tsx
import { useState } from "react";
import type { ApiClient } from "@contract/client";
import { useApi } from "@/api/client";
import { messageOf } from "@/api/errors";
import { bulkUpdateFindings, FINDINGS_BULK_MAX, type BulkResult, type BulkSet } from "@/api/findings";
import { useChangesStore } from "@/store/changes";
import { Button, GlassPanel, MenuButton, toast, type SeverityLevel } from "@/ui";
import { STATUSES, STATUS_LABEL } from "./status";

/** One transaction per ≤ 1000 ids (F §8.3); results are summed. */
export async function applyBulk(api: ApiClient, projectId: string, ids: readonly string[], set: BulkSet): Promise<BulkResult> {
  let updated = 0;
  const skipped: BulkResult["skipped"] = [];
  for (let i = 0; i < ids.length; i += FINDINGS_BULK_MAX) {
    const r = await bulkUpdateFindings(api, projectId, ids.slice(i, i + FINDINGS_BULK_MAX), set);
    updated += r.updated;
    skipped.push(...r.skipped);
  }
  return { updated, skipped };
}

const SKIP_REASON: Record<string, string> = { invalid_transition: "a closed finding has to be reopened first" };

export function bulkMessage(updated: number, skipped: readonly { code: string }[], what: string): string {
  const head = `${updated} ${updated === 1 ? "finding" : "findings"} set to ${what}.`;
  if (skipped.length === 0) return head;
  const codes = [...new Set(skipped.map((s) => s.code))];
  const why = codes.map((c) => SKIP_REASON[c] ?? c.replace(/_/g, " ")).join("; ");
  return `${head} ${skipped.length} skipped: ${why}.`;
}

/** The floating bar over a selection (F §8.6): Set status, Set severity, Clear. */
export function BulkBar({
  projectId,
  ids,
  scale,
  onDone,
  onClear,
}: {
  projectId: string;
  ids: readonly string[];
  scale: readonly SeverityLevel[];
  onDone: () => void;
  onClear: () => void;
}) {
  const api = useApi();
  const [busy, setBusy] = useState(false);

  async function apply(set: BulkSet, what: string) {
    setBusy(true);
    try {
      const r = await applyBulk(api, projectId, ids, set);
      useChangesStore.getState().bumpFindings();
      toast(r.skipped.length ? "info" : "ok", bulkMessage(r.updated, r.skipped, what));
      onDone();
    } catch (e) {
      toast("danger", messageOf(e, "could not update the findings"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <GlassPanel
      variant="pane"
      className="absolute bottom-4 left-1/2 z-10 flex -translate-x-1/2 items-center gap-2 px-3 py-2 shadow-none"
      role="toolbar"
      aria-label="Selected findings"
    >
      <span className="px-1 text-sm font-medium tabular-nums">{ids.length} selected</span>
      <MenuButton
        label="Set status"
        size="sm"
        items={STATUSES.map((s) => ({
          id: s,
          label: STATUS_LABEL[s],
          disabled: busy,
          onSelect: () => void apply({ status: s }, STATUS_LABEL[s]),
        }))}
      />
      <MenuButton
        label="Set severity"
        size="sm"
        items={[
          ...[...scale]
            .sort((a, b) => b.level - a.level)
            .map((l) => ({ id: String(l.level), label: l.name, disabled: busy, onSelect: () => void apply({ severity: l.level }, l.name) })),
          { id: "none", label: "No severity", disabled: busy, onSelect: () => void apply({ severity: null }, "No severity") },
        ]}
      />
      <Button size="sm" variant="ghost" onClick={onClear}>
        Clear
      </Button>
    </GlassPanel>
  );
}
```

`shadow-none` is a Tailwind default utility, not an arbitrary shadow; drop it if `GlassPanel`
already sets the elevation you want.

- [ ] **Step 5: Wire inspector, bulk and keys into the screen**

In `frontend/src/findings/FindingsScreen.tsx` add the imports:

```tsx
import { useApi } from "@/api/client";
import type { BulkSet } from "@/api/findings";
import { STATUS_LABEL } from "./status";
import { applyBulk, BulkBar, bulkMessage } from "./BulkBar";
import { FindingInspector } from "./FindingInspector";
import { useInspectorCommands } from "./inspectorStore";
import { useFindingKeys } from "./useFindingKeys";
import { useChangesStore } from "@/store/changes";
import { messageOf } from "@/api/errors";
import { toast } from "@/ui";
```

(merge `toast` into the existing `@/ui` import). After `openFinding`, add:

```tsx
  const api = useApi();
  const closeInspector = useCallback(
    () => void navigate(`/p/${projectId}/findings${suffix}`),
    [navigate, projectId, suffix],
  );
  // Review keys act on the checked rows, else on the finding open in the inspector (ambiguity 4).
  const targets = useMemo(
    () => (selected.size > 0 ? [...selected] : findingId ? [findingId] : []),
    [selected, findingId],
  );
  const applyKey = useCallback(
    async (set: BulkSet, what: string) => {
      if (targets.length === 0) return;
      try {
        const r = await applyBulk(api, projectId, targets, set);
        useChangesStore.getState().bumpFindings();
        if (r.skipped.length || targets.length > 1) toast(r.skipped.length ? "info" : "ok", bulkMessage(r.updated, r.skipped, what));
      } catch (e) {
        toast("danger", messageOf(e, "could not update the finding"));
      }
    },
    [api, projectId, targets],
  );
  useFindingKeys(true, scale.length, {
    onSeverity: (level) => void applyKey({ severity: level }, scale.find((l) => l.level === level)?.name ?? `Level ${level}`),
    onStatus: (status) => void applyKey({ status }, STATUS_LABEL[status]),
    onTypePicker: () => {
      if (findingId) useInspectorCommands.getState().openTypePicker();
    },
    onClose: () => {
      if (findingId) closeInspector();
      else if (selected.size > 0) setSelected(new Set());
    },
  });
```

Inside the table wrapper, after the `DataTable`/`EmptyState` block:

```tsx
          {selected.size > 0 && (
            <BulkBar
              projectId={projectId}
              ids={[...selected]}
              scale={scale}
              onDone={() => setSelected(new Set())}
              onClear={() => setSelected(new Set())}
            />
          )}
```

and after that wrapper `</div>` (still inside the flex row):

```tsx
        {findingId && (
          <FindingInspector
            key={findingId}
            projectId={projectId}
            findingId={findingId}
            onNavigate={(href) => (href ? void navigate(href) : closeInspector())}
          />
        )}
```

Hooks must stay above any early return; `FindingsScreen` has none.

- [ ] **Step 6: Run the tests**

Run: `pnpm -C frontend exec vitest run src/findings`
Expected: PASS (all findings files; 10 new tests here).

- [ ] **Step 7: Lint**

Run: `pnpm -C frontend lint`
Expected: exit 0.

- [ ] **Step 8: Commit**

```bash
git add frontend/src/findings/BulkBar.tsx frontend/src/findings/keys.ts frontend/src/findings/useFindingKeys.ts frontend/src/findings/FindingsScreen.tsx frontend/src/findings/FindingsScreen.keys.test.tsx
git commit -m "feat(findings): inspector route, bulk status and severity, review keys in the Findings tab

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

### Task 8: Add data — dialog, elevation chooser, SH's host

Load the design skills first.

SH ships the mechanism (SH plan Task 2 and Task 8): `app/addDataStore.ts` with
`useAddData {open, tile, show(tile | null), close()}` (the project is the one in the URL), the top-bar
"Add data" route action and one palette action per importer, and `app/AddDataHost.tsx` mounted in
`Shell` as `<AddDataHost project={project}/>` with an interim chooser. S1 replaces that host's body
with the real dialog and adds the elevation chooser; it does not register commands or actions again.

**Files:**
- Create: `frontend/src/data/addDataTiles.ts`, `frontend/src/data/AddDataDialog.tsx`
- Create: `frontend/src/surfaces/ImportElevationDialog.tsx`
- Modify: `frontend/src/app/AddDataHost.tsx` (body replaced), its test `frontend/src/app/AddDataHost.test.tsx` (SH's interim cases replaced by the ones below)
- Test: `frontend/src/data/AddDataDialog.test.tsx`, `frontend/src/surfaces/ImportElevationDialog.test.tsx`

**Interfaces:**
- Consumes: SH `useAddData`, `AddDataTile` (`"photos" | "orthomosaic" | "elevation" | "point_cloud"`);
  `ImportImagesDialog` (`{project, onClose, onStarted}`), `ImportMapDialog`, `ImportCloudDialog`,
  `ImportDesignDialog` (`{projectId, onClose, onStarted}`); `useChangesStore.bumpData` (Task 1).
- Produces:
  - `ADD_DATA_TILES: AddDataTileInfo[]`, `AddDataTileInfo {tile: AddDataTile | "drawing"; title; hint; icon; disabledReason?}`
  - `openAddData(tile?: AddDataTile): void` — the one call for S1's empty states (thin wrapper over `useAddData.show`)
  - `AddDataDialog({project, initialTile?, onClose})`
  - `AddDataHost({project})` (SH's file and props, S1's body)
  - `ImportElevationDialog({projectId, onClose, onStarted})` — M extends this file (F §6.4)

- [ ] **Step 1: Write the failing tests**

`frontend/src/data/AddDataDialog.test.tsx`:

```tsx
import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, screen, waitFor } from "@testing-library/react";
import { exampleProject, fakeClient } from "@/test/fixtures";
import { renderWithProviders } from "@/test/render";
import { AddDataHost } from "@/app/AddDataHost";
import { useAddData } from "@/app/addDataStore";
import { useChangesStore } from "@/store/changes";
import { useToastStore } from "@/ui";
import { AddDataDialog } from "./AddDataDialog";
import { openAddData } from "./addDataTiles";

// The importers have their own tests; here each is a stub that can report "started".
const stub = (name: string) => ({ onStarted }: { onStarted: () => void }) => (
  <div role="dialog" aria-label={name}>
    <button type="button" onClick={() => onStarted()}>
      Start {name}
    </button>
  </div>
);
vi.mock("./ImportImagesDialog", () => ({ ImportImagesDialog: stub("Import images") }));
vi.mock("@/maps/ImportMapDialog", () => ({ ImportMapDialog: stub("Import map") }));
vi.mock("@/clouds/ImportCloudDialog", () => ({ ImportCloudDialog: stub("Import cloud") }));
vi.mock("@/surfaces/ImportElevationDialog", () => ({ ImportElevationDialog: stub("Add elevation") }));

describe("AddDataDialog", () => {
  beforeEach(() => {
    useChangesStore.setState({ dataRevision: 0 });
    useToastStore.getState().clear();
    useAddData.getState().close();
  });

  it("offers five tiles, with Drawing disabled until the Maps workspace", () => {
    const { api } = fakeClient([]);
    renderWithProviders(<AddDataDialog project={exampleProject} onClose={() => {}} />, { api });
    const dialog = screen.getByRole("dialog", { name: "Add data" });
    for (const name of [/Photos/, /Orthomosaic/, /Elevation/, /Point cloud/]) {
      expect(screen.getByRole("button", { name })).toBeEnabled();
    }
    expect(screen.getByRole("button", { name: /Drawing/ })).toHaveAttribute("aria-disabled", "true");
    expect(dialog).toHaveTextContent("Arrives with the Maps workspace");
  });

  it("closes when the photo import is queued, and says it runs in the background", () => {
    const onClose = vi.fn();
    const { api } = fakeClient([]);
    renderWithProviders(<AddDataDialog project={exampleProject} onClose={onClose} />, { api });
    fireEvent.click(screen.getByRole("button", { name: /Photos/ }));
    fireEvent.click(screen.getByRole("button", { name: "Start Import images" }));
    expect(onClose).toHaveBeenCalled();
    expect(useChangesStore.getState().dataRevision).toBe(1);
    expect(useToastStore.getState().toasts.at(-1)?.text).toMatch(/Photos import started/);
  });

  it.each([
    [/Orthomosaic/, "Start Import map"],
    [/Elevation/, "Start Add elevation"],
    [/Point cloud/, "Start Import cloud"],
  ])("routes %s to its importer", (tile, start) => {
    const onClose = vi.fn();
    const { api } = fakeClient([]);
    renderWithProviders(<AddDataDialog project={exampleProject} onClose={onClose} />, { api });
    fireEvent.click(screen.getByRole("button", { name: tile }));
    fireEvent.click(screen.getByRole("button", { name: start }));
    expect(onClose).toHaveBeenCalled();
  });

  it("the host opens straight on a tile from the store (palette, empty states) and closes it", async () => {
    const { api } = fakeClient([]);
    renderWithProviders(<AddDataHost project={exampleProject} />, { api });
    expect(screen.queryByRole("dialog")).toBeNull();
    act(() => openAddData("orthomosaic"));
    fireEvent.click(await screen.findByRole("button", { name: "Start Import map" }));
    await waitFor(() => expect(useAddData.getState().open).toBe(false));
  });
});
```

`frontend/src/surfaces/ImportElevationDialog.test.tsx`:

```tsx
import { describe, expect, it, vi } from "vitest";
import { fireEvent, screen } from "@testing-library/react";
import { fakeClient, PROJECT_ID } from "@/test/fixtures";
import { renderWithProviders } from "@/test/render";
import { ImportElevationDialog } from "./ImportElevationDialog";

vi.mock("./ImportDesignDialog", () => ({
  ImportDesignDialog: () => <div role="dialog" aria-label="Import design surface" />,
}));

describe("ImportElevationDialog", () => {
  it("opens the design-surface import", async () => {
    const { api } = fakeClient([]);
    renderWithProviders(<ImportElevationDialog projectId={PROJECT_ID} onClose={() => {}} onStarted={() => {}} />, { api });
    fireEvent.click(screen.getByRole("button", { name: /Design surface/ }));
    expect(await screen.findByRole("dialog", { name: "Import design surface" })).toBeInTheDocument();
  });

  it("links a cloud-built DSM to the Measurements tab", () => {
    const onClose = vi.fn();
    const { api } = fakeClient([]);
    renderWithProviders(<ImportElevationDialog projectId={PROJECT_ID} onClose={onClose} onStarted={() => {}} />, { api });
    const link = screen.getByRole("link", { name: /Build from a point cloud/ });
    expect(link).toHaveAttribute("href", `/p/${PROJECT_ID}/measurements`);
    fireEvent.click(link);
    expect(onClose).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `pnpm -C frontend exec vitest run src/data/AddDataDialog.test.tsx src/surfaces/ImportElevationDialog.test.tsx`
Expected: FAIL — `Failed to resolve import "./AddDataDialog"` and `"./ImportElevationDialog"`.

- [ ] **Step 3: Write the tiles module**

`frontend/src/data/addDataTiles.ts`:

```ts
import { useAddData, type AddDataTile } from "@/app/addDataStore";
import type { IconName } from "@/ui";

export interface AddDataTileInfo {
  tile: AddDataTile | "drawing";
  title: string;
  hint: string;
  icon: IconName;
  /** Present when the tile cannot be used yet. */
  disabledReason?: string;
}

/** F §6.4's five tiles, in the order the dialog shows them. */
export const ADD_DATA_TILES: AddDataTileInfo[] = [
  { tile: "photos", title: "Photos", hint: "A folder of drone photos (JPEG)", icon: "images" },
  { tile: "orthomosaic", title: "Orthomosaic", hint: "A GeoTIFF map", icon: "map" },
  { tile: "elevation", title: "Elevation", hint: "A design surface, or a DSM built from a cloud", icon: "elevation" },
  { tile: "point_cloud", title: "Point cloud", hint: "LAS or LAZ", icon: "cloud" },
  {
    tile: "drawing",
    title: "Drawing",
    hint: "DXF, LandXML, or a PDF/PNG plan",
    icon: "drawing",
    disabledReason: "Arrives with the Maps workspace",
  },
];

/** The one way in for S1's empty states (the Overview hero); the project is the one in the URL. */
export function openAddData(tile?: AddDataTile): void {
  useAddData.getState().show(tile ?? null);
}
```

- [ ] **Step 4: Write the elevation chooser**

`frontend/src/surfaces/ImportElevationDialog.tsx`:

```tsx
import { useState } from "react";
import { Link } from "react-router-dom";
import { Dialog, Icon, cx, focusRing, transition } from "@/ui";
import { ImportDesignDialog } from "./ImportDesignDialog";

type Mode = "design";

const OPTION = cx(
  "flex w-full items-start gap-3 rounded-control border border-line bg-field p-3 text-left hover:border-line-strong hover:bg-hover",
  focusRing,
  transition,
);

/**
 * Add data → Elevation (F §6.4). Today: a design surface, or a DSM built from a point cloud. M adds
 * its plain DSM/DTM GeoTIFF mode to this same chooser (M §7).
 */
export function ImportElevationDialog({
  projectId,
  onClose,
  onStarted,
}: {
  projectId: string;
  onClose: () => void;
  onStarted: () => void;
}) {
  const [mode, setMode] = useState<Mode | null>(null);
  if (mode === "design") return <ImportDesignDialog projectId={projectId} onClose={onClose} onStarted={() => onStarted()} />;
  return (
    <Dialog open title="Add elevation" description="Every elevation import runs in the background." onClose={onClose}>
      <div className="flex flex-col gap-2.5">
        <button type="button" className={OPTION} onClick={() => setMode("design")}>
          <Icon name="elevation" size={18} className="mt-0.5 text-accent-ink" />
          <span>
            <span className="block text-sm font-semibold text-ink">Design surface</span>
            <span className="block text-xs text-muted">A design model to compare the site against, placed on the map.</span>
          </span>
        </button>
        <Link to={`/p/${projectId}/measurements`} onClick={onClose} className={OPTION}>
          <Icon name="cloud" size={18} className="mt-0.5 text-accent-ink" />
          <span>
            <span className="block text-sm font-semibold text-ink">Build from a point cloud</span>
            <span className="block text-xs text-muted">Opens Measurements, where Build surface turns an imported cloud into a DSM.</span>
          </span>
        </Link>
      </div>
    </Dialog>
  );
}
```

- [ ] **Step 5: Write the dialog and replace the host's body**

`frontend/src/data/AddDataDialog.tsx`:

```tsx
import { useCallback, useState } from "react";
import type { Project } from "@contract/client";
import type { AddDataTile } from "@/app/addDataStore";
import { ImportCloudDialog } from "@/clouds/ImportCloudDialog";
import { ImportMapDialog } from "@/maps/ImportMapDialog";
import { useChangesStore } from "@/store/changes";
import { ImportElevationDialog } from "@/surfaces/ImportElevationDialog";
import { Dialog, Icon, Tooltip, cx, focusRing, toast, transition } from "@/ui";
import { ADD_DATA_TILES } from "./addDataTiles";
import { ImportImagesDialog } from "./ImportImagesDialog";

const TILE_NAME: Record<AddDataTile, string> = {
  photos: "Photos",
  orthomosaic: "Orthomosaic",
  elevation: "Elevation",
  point_cloud: "Point cloud",
};

/** F §6.4: five tiles, each opening today's importer; closes once the import job is queued. */
export function AddDataDialog({
  project,
  initialTile = null,
  onClose,
}: {
  project: Project;
  initialTile?: AddDataTile | null;
  onClose: () => void;
}) {
  const [tile, setTile] = useState<AddDataTile | null>(initialTile);
  const started = useCallback(
    (t: AddDataTile) => {
      useChangesStore.getState().bumpData();
      toast("ok", `${TILE_NAME[t]} import started. It runs in the background; follow it in Jobs.`);
      onClose();
    },
    [onClose],
  );
  const pid = project.id;

  if (tile === "photos") return <ImportImagesDialog project={project} onClose={onClose} onStarted={() => started("photos")} />;
  if (tile === "orthomosaic") return <ImportMapDialog projectId={pid} onClose={onClose} onStarted={() => started("orthomosaic")} />;
  if (tile === "elevation") return <ImportElevationDialog projectId={pid} onClose={onClose} onStarted={() => started("elevation")} />;
  if (tile === "point_cloud") return <ImportCloudDialog projectId={pid} onClose={onClose} onStarted={() => started("point_cloud")} />;

  return (
    <Dialog
      open
      title="Add data"
      width="lg"
      description="Everything imports in the background. A new item shows as importing until it is ready."
      onClose={onClose}
    >
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {ADD_DATA_TILES.map((t) => {
          const choose = t.tile === "drawing" || t.disabledReason ? undefined : (t.tile as AddDataTile);
          const button = (
            <button
              key={t.tile}
              type="button"
              aria-disabled={choose ? undefined : true}
              onClick={choose ? () => setTile(choose) : undefined}
              className={cx(
                "flex h-full w-full flex-col items-start gap-2 rounded-panel border border-card-line bg-surface p-4 text-left",
                focusRing,
                transition,
                choose ? "hover:-translate-y-0.5 hover:border-line-strong" : "cursor-not-allowed opacity-60",
              )}
            >
              <span className="grid h-9 w-9 place-items-center rounded-control bg-accent-soft text-accent-ink">
                <Icon name={t.icon} size={18} />
              </span>
              <span className="text-base font-semibold text-ink">{t.title}</span>
              <span className="text-xs text-muted">{t.disabledReason ?? t.hint}</span>
            </button>
          );
          return t.disabledReason ? (
            <Tooltip key={t.tile} label={t.disabledReason}>
              {button}
            </Tooltip>
          ) : (
            button
          );
        })}
      </div>
    </Dialog>
  );
}
```

Replace the body of SH's `frontend/src/app/AddDataHost.tsx`, keeping its export and props:

```tsx
import type { Project } from "@contract/client";
import { AddDataDialog } from "@/data/AddDataDialog";
import { useAddData } from "./addDataStore";

/** Mounted once by Shell for the open project (SH); renders S1's Add data dialog (F §6.4). */
export function AddDataHost({ project }: { project: Project }) {
  const open = useAddData((s) => s.open);
  const tile = useAddData((s) => s.tile);
  const close = useAddData((s) => s.close);
  if (!open) return null;
  return <AddDataDialog key={tile ?? "tiles"} project={project} initialTile={tile} onClose={close} />;
}
```

Delete SH's interim cases from `frontend/src/app/AddDataHost.test.tsx` (the host's behaviour is now
pinned by `AddDataDialog.test.tsx`); keep any case that checks the Shell mount.

- [ ] **Step 6: Run the tests**

Run: `pnpm -C frontend exec vitest run src/data src/surfaces src/app`
Expected: PASS (8 new tests; SH's shell, route-action and palette tests still pass).

- [ ] **Step 7: Lint**

Run: `pnpm -C frontend lint`
Expected: exit 0.

- [ ] **Step 8: Commit**

```bash
git add frontend/src/data/addDataTiles.ts frontend/src/data/AddDataDialog.tsx frontend/src/data/AddDataDialog.test.tsx frontend/src/surfaces/ImportElevationDialog.tsx frontend/src/surfaces/ImportElevationDialog.test.tsx frontend/src/app/AddDataHost.tsx frontend/src/app/AddDataHost.test.tsx
git commit -m "feat(data): Add data dialog routing to every importer, behind SH's host

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

### Task 9: Overview pure model (KPIs, severity bars, hero pins)

Read the `dataviz` skill before this task (stat tiles, bars, sparkline form).

**Files:**
- Create: `frontend/src/overview/kpis.ts`, `frontend/src/overview/heroPins.ts`
- Test: `frontend/src/overview/model.test.ts`

**Interfaces:**
- Consumes: `ProjectOverview`, `FindingSummary`, `Finding` (Task 1); `findingsListPath`,
  `formatFindingNumber` (Task 2); `SeverityLevel` (`@/ui`); `GeoMap` (`@contract/client`);
  `scaleBar` (`@/maps/grid`).
- Produces:
  - `Kpi {id: "open" | "top" | "data" | "volume" | "reviewed"; label; value: number; unit?; tone?: "danger"; delta?: {value; good; label}; spark?: number[]; chips?: string[]; href?: string}`
  - `buildKpis(o: ProjectOverview, scale, projectId, today: string /* YYYY-MM-DD */): Kpi[]`; `SPARK_DAYS = 30`
  - `SeverityRow {key; name; colour: string | null; count; fraction; href}`; `severityRows(summary, scale, projectId): SeverityRow[]`
  - `HERO_PIN_LIMIT = 300`; `PinInput {id; number; severity: number | null; lon; lat}`; `pinsFromFindings(findings: Finding[]): PinInput[]`
  - `lonLatToMapPixel(m: Pick<GeoMap, "geotransform" | "proj4" | "width" | "height">, lon, lat): [number, number] | null`
  - `BACKDROP = {width: 800, height: 360, pad: 36}`; `backdropLayout(pins): {points: {id; xPct; yPct}[]; scale: {widthPct; label} | null}`

- [ ] **Step 1: Write the failing test**

`frontend/src/overview/model.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { exampleGeoMap, PROJECT_ID } from "@/test/fixtures";
import { emptyOverview, exampleFinding, exampleOverview, SEVERITY_SCALE } from "@/test/findingFixtures";
import { buildKpis, severityRows } from "./kpis";
import { backdropLayout, lonLatToMapPixel, pinsFromFindings, type PinInput } from "./heroPins";

const TODAY = "2026-09-26";

describe("buildKpis (F §9.1)", () => {
  it("builds the four tiles of a full project", () => {
    const [open, top, data, volume] = buildKpis(exampleOverview, SEVERITY_SCALE, PROJECT_ID, TODAY);
    expect(open).toMatchObject({
      id: "open",
      label: "Open findings",
      value: 47,
      delta: { value: 6, good: "down", label: "vs 7 days ago" },
      href: `/p/${PROJECT_ID}/findings?status=open`,
    });
    expect(open.spark).toHaveLength(30);
    expect(open.spark?.at(-1)).toBe(47);
    expect(top).toMatchObject({
      id: "top",
      label: "Critical",
      value: 5,
      tone: "danger",
      delta: { value: -2, good: "down", label: "closed this week" },
      href: `/p/${PROJECT_ID}/findings?status=open&severity=4`,
    });
    expect(data).toMatchObject({ id: "data", label: "Project data", value: 1284, unit: "images" });
    expect(data.chips).toEqual(["3 maps", "2 clouds", "1 elevation"]);
    expect(volume).toMatchObject({ id: "volume", label: "Stockpile volume", value: 12480, unit: "m³" });
    expect(volume.delta).toEqual({ value: -3.2, good: "up", label: "% vs previous survey" });
  });

  it("falls back to Reviewed % without a volume, and stays calm when empty", () => {
    const kpis = buildKpis(emptyOverview, SEVERITY_SCALE, PROJECT_ID, TODAY);
    expect(kpis.map((k) => k.id)).toEqual(["open", "top", "data", "reviewed"]);
    expect(kpis[0]).toMatchObject({ value: 0, delta: undefined, spark: undefined });
    expect(kpis[1]).toMatchObject({ value: 0, tone: undefined, delta: undefined });
    expect(kpis[2].chips).toEqual([]);
    expect(kpis[3]).toMatchObject({ label: "Reviewed", value: 0, unit: "%" });
    const some = { ...emptyOverview, findings: { ...emptyOverview.findings, by_status: { open: 1, reviewed: 2, closed: 1 } } };
    // Reviewed % counts reviewed and closed findings (a closed finding was looked at): 3 of 4.
    expect(buildKpis(some, SEVERITY_SCALE, PROJECT_ID, TODAY)[3].value).toBe(75);
  });

  it("names the top tile after the highest level of an edited scale", () => {
    const scale = [...SEVERITY_SCALE, { level: 5, name: "Unsafe", colour: "#aa0000" }];
    const top = buildKpis(exampleOverview, scale, PROJECT_ID, TODAY)[1];
    expect(top).toMatchObject({ label: "Unsafe", value: 0 });
  });
});

describe("severityRows", () => {
  it("lists levels highest first, relative to the largest, with a No severity row when needed", () => {
    const rows = severityRows({ ...exampleOverview.findings, open_no_severity: 3 }, SEVERITY_SCALE, PROJECT_ID);
    expect(rows.map((r) => [r.name, r.count])).toEqual([
      ["Critical", 5],
      ["Major", 14],
      ["Moderate", 19],
      ["Minor", 9],
      ["No severity", 3],
    ]);
    expect(rows[2].fraction).toBe(1);
    expect(rows[0].fraction).toBeCloseTo(5 / 19);
    expect(rows[0].href).toBe(`/p/${PROJECT_ID}/findings?status=open&severity=4`);
    expect(rows[4]).toMatchObject({ colour: null, href: `/p/${PROJECT_ID}/findings?status=open&severity=none` });
    expect(severityRows(exampleOverview.findings, SEVERITY_SCALE, PROJECT_ID)).toHaveLength(4);
  });

  it("draws empty bars when nothing is open", () => {
    expect(severityRows(emptyOverview.findings, SEVERITY_SCALE, PROJECT_ID).every((r) => r.fraction === 0)).toBe(true);
  });
});

describe("hero pins", () => {
  const geo = {
    ...exampleGeoMap,
    width: 1000,
    height: 1000,
    proj4: "+proj=longlat +datum=WGS84 +no_defs",
    geotransform: [47.76, 0.00001, 0, 29.5, 0, -0.00001],
  };

  it("projects lon/lat into the map's pixels, and rejects points off the map", () => {
    const px = lonLatToMapPixel(geo, 47.765, 29.495);
    expect(px?.[0]).toBeCloseTo(500, 3);
    expect(px?.[1]).toBeCloseTo(500, 3);
    expect(lonLatToMapPixel(geo, 47.9, 29.495)).toBeNull();
    expect(lonLatToMapPixel({ ...geo, geotransform: null }, 47.765, 29.495)).toBeNull();
  });

  it("keeps only located findings", () => {
    expect(pinsFromFindings([exampleFinding, { ...exampleFinding, id: "x", lon: null, lat: null }])).toEqual([
      { id: exampleFinding.id, number: 217, severity: 4, lon: 47.765, lat: 29.495 },
    ]);
  });

  it("spreads pins over the backdrop with a scale bar", () => {
    const pins: PinInput[] = [
      { id: "a", number: 1, severity: 4, lon: 47.76, lat: 29.49 },
      { id: "b", number: 2, severity: 1, lon: 47.77, lat: 29.49 },
    ];
    const { points, scale } = backdropLayout(pins);
    expect(points[0].yPct).toBeCloseTo(points[1].yPct);
    expect(points[1].xPct).toBeGreaterThan(points[0].xPct);
    expect(scale?.label).toMatch(/m$/);
  });

  it("lays out a single pin and identical coordinates without NaN", () => {
    const one = backdropLayout([{ id: "a", number: 1, severity: null, lon: 47.76, lat: 29.49 }]);
    expect(one.points[0]).toEqual({ id: "a", xPct: 50, yPct: 50 });
    expect(one.scale).not.toBeNull();
    const same = backdropLayout([
      { id: "a", number: 1, severity: 1, lon: 47.76, lat: 29.49 },
      { id: "b", number: 2, severity: 2, lon: 47.76, lat: 29.49 },
    ]);
    expect(same.points.every((p) => Number.isFinite(p.xPct) && Number.isFinite(p.yPct))).toBe(true);
    expect(backdropLayout([])).toEqual({ points: [], scale: null });
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm -C frontend exec vitest run src/overview/model.test.ts`
Expected: FAIL — `Failed to resolve import "./kpis"`.

- [ ] **Step 3: Write the KPI model**

`frontend/src/overview/kpis.ts`:

```ts
import type { FindingSummary } from "@/api/findings";
import type { ProjectOverview } from "@/api/overview";
import { findingsListPath } from "@/findings/filters";
import type { SeverityLevel } from "@/ui";

export interface Kpi {
  id: "open" | "top" | "data" | "volume" | "reviewed";
  label: string;
  value: number;
  unit?: string;
  tone?: "danger";
  delta?: { value: number; good: "up" | "down"; label: string };
  spark?: number[];
  chips?: string[];
  href?: string;
}

export const SPARK_DAYS = 30;
const DAY_MS = 86_400_000;

const plural = (n: number, one: string, many: string) => `${n.toLocaleString("en-US")} ${n === 1 ? one : many}`;

function daysBefore(day: string, days: number): string {
  return new Date(Date.parse(`${day}T00:00:00Z`) - days * DAY_MS).toISOString().slice(0, 10);
}

function sortedTrend(s: FindingSummary): FindingSummary["trend"] {
  return [...s.trend].sort((a, b) => a.day.localeCompare(b.day));
}

function topLevel(scale: readonly SeverityLevel[]): SeverityLevel | null {
  return scale.reduce<SeverityLevel | null>((top, l) => (top === null || l.level > top.level ? l : top), null);
}

/** F §9.1's four tiles, from the pre-aggregated payload only. */
export function buildKpis(o: ProjectOverview, scale: readonly SeverityLevel[], projectId: string, today: string): Kpi[] {
  const s = o.findings;
  const trend = sortedTrend(s);
  const weekAgo = daysBefore(today, 7);

  const openNow = s.by_status.open;
  const past = [...trend].reverse().find((t) => t.day <= weekAgo);
  const openDelta = past ? openNow - past.open : 0;
  const spark = trend.slice(-SPARK_DAYS).map((t) => t.open);
  const open: Kpi = {
    id: "open",
    label: "Open findings",
    value: openNow,
    delta: openDelta ? { value: openDelta, good: "down", label: "vs 7 days ago" } : undefined,
    spark: spark.length >= 2 ? spark : undefined,
    href: findingsListPath(projectId, { status: "open" }),
  };

  const level = topLevel(scale);
  const topCount = level ? (s.open_by_severity[String(level.level)] ?? 0) : 0;
  const closedWeek = trend.filter((t) => t.day > weekAgo).reduce((n, t) => n + t.closed, 0);
  const top: Kpi = {
    id: "top",
    label: level?.name ?? "Highest severity",
    value: topCount,
    tone: topCount > 0 ? "danger" : undefined,
    delta: closedWeek ? { value: -closedWeek, good: "down", label: "closed this week" } : undefined,
    href: level ? findingsListPath(projectId, { status: "open", severity: [level.level] }) : undefined,
  };

  const d = o.data;
  const chips = [
    d.maps ? plural(d.maps, "map", "maps") : null,
    d.point_clouds ? plural(d.point_clouds, "cloud", "clouds") : null,
    d.elevations ? plural(d.elevations, "elevation", "elevations") : null,
    d.drawings ? plural(d.drawings, "drawing", "drawings") : null,
  ].filter((c): c is string => c !== null);
  const data: Kpi = { id: "data", label: "Project data", value: d.images, unit: d.images === 1 ? "image" : "images", chips };

  const v = o.latest_volume;
  if (v) {
    const pct =
      v.previous_net_m3 !== null && v.previous_net_m3 !== 0
        ? Math.round(((v.net_m3 - v.previous_net_m3) / Math.abs(v.previous_net_m3)) * 1000) / 10
        : null;
    const volume: Kpi = {
      id: "volume",
      label: "Stockpile volume",
      value: Math.round(v.net_m3),
      unit: "m³",
      delta: pct ? { value: pct, good: "up", label: "% vs previous survey" } : undefined,
    };
    return [open, top, data, volume];
  }
  const total = s.by_status.open + s.by_status.reviewed + s.by_status.closed;
  const reviewed: Kpi = {
    id: "reviewed",
    label: "Reviewed",
    value: total ? Math.round(((s.by_status.reviewed + s.by_status.closed) / total) * 100) : 0,
    unit: "%",
  };
  return [open, top, data, reviewed];
}

export interface SeverityRow {
  key: string;
  name: string;
  colour: string | null;
  count: number;
  fraction: number;
  href: string;
}

/** One bar per level, highest first, plus "No severity" when any open finding lacks one. */
export function severityRows(s: FindingSummary, scale: readonly SeverityLevel[], projectId: string): SeverityRow[] {
  const rows: Omit<SeverityRow, "fraction">[] = [...scale]
    .sort((a, b) => b.level - a.level)
    .map((l) => ({
      key: String(l.level),
      name: l.name,
      colour: l.colour,
      count: s.open_by_severity[String(l.level)] ?? 0,
      href: findingsListPath(projectId, { status: "open", severity: [l.level] }),
    }));
  if (s.open_no_severity > 0)
    rows.push({
      key: "none",
      name: "No severity",
      colour: null,
      count: s.open_no_severity,
      href: findingsListPath(projectId, { status: "open", severity: ["none"] }),
    });
  const max = Math.max(0, ...rows.map((r) => r.count));
  return rows.map((r) => ({ ...r, fraction: max ? r.count / max : 0 }));
}
```

"Reviewed %" counts reviewed and closed findings over all findings (a closed finding was looked at;
F §9.1 says "reviewed / all findings %", read here as "past Open").

- [ ] **Step 4: Write the pin model**

`frontend/src/overview/heroPins.ts`:

```ts
import proj4 from "proj4";
import type { GeoMap } from "@contract/client";
import type { Finding } from "@/api/findings";
import { scaleBar } from "@/maps/grid";

/** F §9.1: the hero shows at most this many pins, most severe first. */
export const HERO_PIN_LIMIT = 300;
/** The no-map backdrop is laid out in this virtual box and placed by percentages. */
export const BACKDROP = { width: 800, height: 360, pad: 36 } as const;
const MIN_SPAN_M = 100;
const M_PER_DEG_LAT = 110_540;
const M_PER_DEG_LON_EQ = 111_320;

export interface PinInput {
  id: string;
  number: number;
  severity: number | null;
  lon: number;
  lat: number;
}

export function pinsFromFindings(findings: readonly Finding[]): PinInput[] {
  return findings.flatMap((f) =>
    f.lon === null || f.lat === null ? [] : [{ id: f.id, number: f.number, severity: f.severity, lon: f.lon, lat: f.lat }],
  );
}

/** WGS84 → the map's native CRS (proj4) → pixel (inverse geotransform); null off the map or without georeference. */
export function lonLatToMapPixel(
  m: Pick<GeoMap, "geotransform" | "proj4" | "width" | "height">,
  lon: number,
  lat: number,
): [number, number] | null {
  const gt = m.geotransform;
  if (!gt || !m.proj4) return null;
  const [x, y] = proj4("EPSG:4326", m.proj4).forward([lon, lat]) as [number, number];
  const det = gt[1] * gt[5] - gt[2] * gt[4];
  if (!det) return null;
  const px = (gt[5] * (x - gt[0]) - gt[2] * (y - gt[3])) / det;
  const py = (-gt[4] * (x - gt[0]) + gt[1] * (y - gt[3])) / det;
  if (!Number.isFinite(px) || !Number.isFinite(py) || px < 0 || py < 0 || px > m.width || py > m.height) return null;
  return [px, py];
}

/**
 * Pins without a map: a local equirectangular projection (metres) fitted into the virtual box,
 * aspect kept, at least `MIN_SPAN_M` across so one pin or coinciding pins sit in the middle.
 */
export function backdropLayout(pins: readonly PinInput[]): {
  points: { id: string; xPct: number; yPct: number }[];
  scale: { widthPct: number; label: string } | null;
} {
  if (pins.length === 0) return { points: [], scale: null };
  const lat0 = pins.reduce((n, p) => n + p.lat, 0) / pins.length;
  const kx = M_PER_DEG_LON_EQ * Math.cos((lat0 * Math.PI) / 180);
  const xy = pins.map((p) => ({ id: p.id, x: p.lon * kx, y: p.lat * M_PER_DEG_LAT }));
  const minX = Math.min(...xy.map((p) => p.x));
  const maxX = Math.max(...xy.map((p) => p.x));
  const minY = Math.min(...xy.map((p) => p.y));
  const maxY = Math.max(...xy.map((p) => p.y));
  const spanX = Math.max(maxX - minX, MIN_SPAN_M);
  const spanY = Math.max(maxY - minY, MIN_SPAN_M);
  const innerW = BACKDROP.width - 2 * BACKDROP.pad;
  const innerH = BACKDROP.height - 2 * BACKDROP.pad;
  const pxPerM = Math.min(innerW / spanX, innerH / spanY);
  const cx = (minX + maxX) / 2;
  const cy = (minY + maxY) / 2;
  const points = xy.map((p) => ({
    id: p.id,
    xPct: ((BACKDROP.width / 2 + (p.x - cx) * pxPerM) / BACKDROP.width) * 100,
    yPct: ((BACKDROP.height / 2 - (p.y - cy) * pxPerM) / BACKDROP.height) * 100,
  }));
  // scaleBar works in "resolution × gsd": one virtual pixel is 1 / pxPerM metres = 100 / pxPerM cm.
  const bar = scaleBar(1, 100 / pxPerM, 120);
  return { points, scale: bar ? { widthPct: (bar.px / BACKDROP.width) * 100, label: bar.label } : null };
}
```

- [ ] **Step 5: Run the test**

Run: `pnpm -C frontend exec vitest run src/overview/model.test.ts`
Expected: PASS (9 tests).

- [ ] **Step 6: Commit**

```bash
git add frontend/src/overview/kpis.ts frontend/src/overview/heroPins.ts frontend/src/overview/model.test.ts
git commit -m "feat(overview): KPI, severity bar and hero pin models from the pre-aggregated payload

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

### Task 10: Overview map hero

Load the design skills; the target is the mockup's `.map` card (span 8) without the `scan` sweep
(F §4.2 rejects it) and with pins that pop once (no pulse).

**Files:**
- Create: `frontend/src/overview/overview.css`, `frontend/src/overview/MapHero.tsx`
- Test: `frontend/src/overview/MapHero.test.tsx`

**Interfaces:**
- Consumes: `listFindings` (Task 1); `findingPath`, `formatFindingNumber` (Task 2);
  `HERO_PIN_LIMIT`, `pinsFromFindings`, `lonLatToMapPixel`, `backdropLayout` (Task 9); `openAddData()`
  (Task 8); `fetchMap` (`@/api/maps`), `MapView` (`@/maps/MapView`), `toOl`, `scaleBar`
  (`@/maps/grid`), `mapTileUrl` (`@contract/client`); DS `GlassPanel`, `EmptyState`, `useSeverityScale`.
- Produces: `MapHero({projectId, heroMapId})`; CSS classes `ov-bar`, `ov-pin` driven by `--i`
  (stagger index) — used by Task 11.

- [ ] **Step 1: Write the failing test**

`frontend/src/overview/MapHero.test.tsx`:

```tsx
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useEffect } from "react";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import { useLocation } from "react-router-dom";
import type { MapViewProps } from "@/maps/MapView";
import { errorBody, exampleGeoMap, fakeClient, MAP_ID, PROJECT_ID, type FakeRoute } from "@/test/fixtures";
import { exampleFinding, severityRoute } from "@/test/findingFixtures";
import { renderWithProviders } from "@/test/render";
import { useAddData } from "@/app/addDataStore";
import { MapHero } from "./MapHero";

// OpenLayers needs a canvas; the stub hands MapHero a map whose pixels equal OL coordinates flipped.
vi.mock("@/maps/MapView", () => ({
  MapView: (props: MapViewProps) => {
    useEffect(() => {
      props.onReady?.({ getPixelFromCoordinate: (c: number[]) => [c[0], -c[1]] } as never);
      props.onViewChange?.({ extent: [0, -1000, 1000, 0], resolution: 2 });
    }, []); // eslint-disable-line react-hooks/exhaustive-deps
    return <div data-testid="map-view" />;
  },
}));

const geo = {
  ...exampleGeoMap,
  width: 1000,
  height: 1000,
  proj4: "+proj=longlat +datum=WGS84 +no_defs",
  geotransform: [47.76, 0.00001, 0, 29.5, 0, -0.00001],
  gsd_cm: 1,
};

function LocationProbe() {
  const l = useLocation();
  return <output data-testid="location">{l.pathname + l.search}</output>;
}

function renderHero(heroMapId: string | null, routes: FakeRoute[]) {
  const { api, requests } = fakeClient([severityRoute, ...routes]);
  renderWithProviders(
    <>
      <MapHero projectId={PROJECT_ID} heroMapId={heroMapId} />
      <LocationProbe />
    </>,
    { api, route: `/p/${PROJECT_ID}/overview`, path: "/p/:projectId/overview" },
  );
  return requests;
}

const pins = { method: "GET", path: /\/findings$/, body: { items: [exampleFinding], next_cursor: null } };
const noPins = { method: "GET", path: /\/findings$/, body: { items: [], next_cursor: null } };

describe("MapHero", () => {
  beforeEach(() => useAddData.getState().close());

  it("asks for at most 300 open located findings, most severe first", async () => {
    const requests = renderHero(null, [pins]);
    await screen.findByRole("link", { name: /F-0217/ });
    const q = new URL(requests.find((r) => r.url.includes("/findings"))!.url, "http://fake").searchParams;
    expect(q.get("has_location")).toBe("true");
    expect(q.getAll("status")).toEqual(["open"]);
    expect(q.get("sort")).toBe("-severity");
    expect(q.get("limit")).toBe("300");
  });

  it("places pins on the newest map and opens the Maps tab on click", async () => {
    renderHero(MAP_ID, [pins, { method: "GET", path: /\/maps\/[^/]+$/, body: geo }]);
    expect(await screen.findByTestId("map-view")).toBeInTheDocument();
    const pin = await screen.findByRole("link", { name: "F-0217 · Critical" });
    expect(pin).toHaveStyle({ left: "500px", top: "500px" });
    expect(pin).toHaveAttribute("href", `/p/${PROJECT_ID}/findings/${exampleFinding.id}`);
    // resolution 2 × GSD 1 cm = 2 cm per screen pixel: the longest round length under 120 px is 2 m.
    expect(screen.getByTestId("hero-scale")).toHaveTextContent("2 m");
    fireEvent.click(screen.getByRole("button", { name: "Open the Maps tab" }));
    await waitFor(() => expect(screen.getByTestId("location")).toHaveTextContent(`/p/${PROJECT_ID}/maps?map=${MAP_ID}`));
  });

  it("puts pins on the plain backdrop when there is no map", async () => {
    renderHero(null, [pins]);
    const pin = await screen.findByRole("link", { name: "F-0217 · Critical" });
    expect(pin).toHaveStyle({ left: "50%", top: "50%" });
    expect(screen.queryByTestId("map-view")).toBeNull();
    expect(screen.getByTestId("hero-scale")).toHaveTextContent(/\d+ (m|km)$/);
  });

  it("falls back to the backdrop when the map cannot be read", async () => {
    renderHero(MAP_ID, [pins, { method: "GET", path: /\/maps\/[^/]+$/, status: 404, body: errorBody("not_found", "gone") }]);
    const pin = await screen.findByRole("link", { name: "F-0217 · Critical" });
    expect(pin).toHaveStyle({ left: "50%" });
  });

  it("asks for data when there is neither a map nor a located finding", async () => {
    renderHero(null, [noPins]);
    fireEvent.click(await screen.findByRole("button", { name: "Add data" }));
    expect(useAddData.getState().open).toBe(true);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm -C frontend exec vitest run src/overview/MapHero.test.tsx`
Expected: FAIL — `Failed to resolve import "./MapHero"`.

- [ ] **Step 3: Write the motion CSS**

`frontend/src/overview/overview.css`:

```css
/* Severity bars and hero pins (F §4.2). Card and row entrances use DS's `.stagger animate-rise`.
   Durations, easings and stagger come only from the DS tokens, so reduced motion (tokens at 0 ms)
   needs no extra rule; transform and opacity only. */
/* Severity bars grow from the left to their inline `transform: scaleX(f)`. */
.ov-bar {
  transform-origin: left center;
  animation: ov-grow var(--dur-emphasis) var(--ease-out) both;
  animation-delay: calc(var(--stagger-step) * var(--i, 0));
}
@keyframes ov-grow {
  from {
    transform: scaleX(0);
  }
}

/* Pins pop once on arrival; never a looping pulse on static data. */
.ov-pin {
  animation: ov-pop var(--dur-base) var(--ease-spring) both;
  animation-delay: calc(var(--stagger-step) * min(var(--i, 0), var(--stagger-max) - 1));
}
@keyframes ov-pop {
  from {
    transform: translate(-50%, -50%) scale(0);
  }
}

@media (prefers-reduced-motion: reduce) {
  .ov-bar,
  .ov-pin {
    animation: none;
  }
}
```

Card and row entrances use DS's `.stagger animate-rise` (DS plan Task 3) with the `--i` index.

- [ ] **Step 4: Write the hero**

`frontend/src/overview/MapHero.tsx`:

```tsx
import { useEffect, useMemo, useState, type CSSProperties } from "react";
import { Link, useNavigate } from "react-router-dom";
import type OlMap from "ol/Map";
import { mapTileUrl, type GeoMap } from "@contract/client";
import { useApi, useBackend } from "@/api/client";
import { messageOf } from "@/api/errors";
import { listFindings } from "@/api/findings";
import { fetchMap } from "@/api/maps";
import { pushLog } from "@/app/diagnostics";
import { openAddData } from "@/data/addDataTiles";
import { formatFindingNumber } from "@/findings/format";
import { findingPath } from "@/findings/links";
import { scaleBar, toOl } from "@/maps/grid";
import { MapView } from "@/maps/MapView";
import { useChangesStore } from "@/store/changes";
import { Button, EmptyState, GlassPanel, Skeleton, useSeverityScale, type SeverityLevel } from "@/ui";
import { backdropLayout, HERO_PIN_LIMIT, lonLatToMapPixel, pinsFromFindings, type PinInput } from "./heroPins";
import "./overview.css";

interface Placed {
  pin: PinInput;
  left: string;
  top: string;
}

function Pin({ projectId, placed, index, scale }: { projectId: string; placed: Placed; index: number; scale: readonly SeverityLevel[] }) {
  const level = scale.find((l) => l.level === placed.pin.severity);
  const name = level?.name ?? "No severity";
  return (
    <Link
      to={findingPath(projectId, placed.pin.id)}
      aria-label={`${formatFindingNumber(placed.pin.number)} · ${name}`}
      title={`${formatFindingNumber(placed.pin.number)} · ${name}`}
      className="ov-pin absolute z-[2] h-3.5 w-3.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-ink bg-[var(--c)] hover:z-[3] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
      style={{ left: placed.left, top: placed.top, "--c": level?.colour ?? "rgb(var(--muted))", "--i": index } as CSSProperties}
    />
  );
}

function Legend({ scale }: { scale: readonly SeverityLevel[] }) {
  return (
    <GlassPanel variant="float" className="absolute bottom-3 left-3 z-[2] flex flex-wrap gap-3 px-2.5 py-1.5 text-xs">
      {[...scale]
        .sort((a, b) => b.level - a.level)
        .map((l) => (
          <span key={l.level} className="inline-flex items-center gap-1.5" style={{ "--c": l.colour } as CSSProperties}>
            <span aria-hidden className="h-2 w-2 rounded-full bg-[var(--c)]" />
            {l.name}
          </span>
        ))}
    </GlassPanel>
  );
}

/** F §9.1 map hero: the newest ready map as tiles, locked until clicked, with open-finding pins. */
export function MapHero({ projectId, heroMapId }: { projectId: string; heroMapId: string | null }) {
  const api = useApi();
  const { baseUrl, token } = useBackend();
  const navigate = useNavigate();
  const scale = useSeverityScale();
  const revision = useChangesStore((s) => s.findingsRevision);
  const [pins, setPins] = useState<{ projectId: string; items: PinInput[] } | null>(null);
  const [geo, setGeo] = useState<{ id: string; map: GeoMap | null } | null>(null);
  const [ol, setOl] = useState<OlMap | null>(null);
  const [resolution, setResolution] = useState<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    listFindings(api, projectId, { has_location: true, status: ["open"], sort: "-severity", limit: HERO_PIN_LIMIT })
      .then((page) => {
        if (!cancelled) setPins({ projectId, items: pinsFromFindings(page.items) });
      })
      .catch((e: unknown) => {
        pushLog(`hero pins unavailable: ${messageOf(e, String(e))}`);
        if (!cancelled) setPins({ projectId, items: [] });
      });
    return () => {
      cancelled = true;
    };
  }, [api, projectId, revision]);

  useEffect(() => {
    if (!heroMapId) return;
    let cancelled = false;
    fetchMap(api, projectId, heroMapId)
      .then((map) => {
        if (!cancelled) setGeo({ id: heroMapId, map: map.status === "ready" ? map : null });
      })
      .catch((e: unknown) => {
        pushLog(`hero map unavailable: ${messageOf(e, String(e))}`);
        if (!cancelled) setGeo({ id: heroMapId, map: null });
      });
    return () => {
      cancelled = true;
    };
  }, [api, projectId, heroMapId]);

  const items = pins?.projectId === projectId ? pins.items : null;
  const map = heroMapId && geo?.id === heroMapId ? geo.map : null;
  const mapPending = Boolean(heroMapId) && geo?.id !== heroMapId;

  const placedOnMap = useMemo<Placed[]>(() => {
    if (!map || !ol || resolution === null || !items) return [];
    return items.flatMap((pin) => {
      const px = lonLatToMapPixel(map, pin.lon, pin.lat);
      const screen = px ? ol.getPixelFromCoordinate(toOl(px[0], px[1])) : null;
      return screen ? [{ pin, left: `${screen[0]}px`, top: `${screen[1]}px` }] : [];
    });
  }, [map, ol, resolution, items]);

  const backdrop = useMemo(() => (items && !map ? backdropLayout(items) : null), [items, map]);
  const placedOnBackdrop: Placed[] =
    backdrop && items
      ? backdrop.points.map((p, i) => ({ pin: items[i], left: `${p.xPct}%`, top: `${p.yPct}%` }))
      : [];

  const frame = "relative col-span-12 min-h-[360px] overflow-hidden p-0 lg:col-span-8";
  if (!items || mapPending)
    return (
      <GlassPanel variant="pane" className={frame}>
        <Skeleton className="absolute inset-0" />
      </GlassPanel>
    );

  if (!map && items.length === 0)
    return (
      <GlassPanel variant="pane" className={`${frame} grid place-items-center`}>
        <EmptyState
          icon="map"
          title="Start by adding data"
          action={
            <Button variant="primary" icon="plus" onClick={() => openAddData()}>
              Add data
            </Button>
          }
        >
          Photos, an orthomosaic, an elevation model or a point cloud. Each import runs in the background, and
          open findings appear here as pins.
        </EmptyState>
      </GlassPanel>
    );

  const mapBar = map && resolution !== null ? scaleBar(resolution, map.gsd_cm, 120) : null;
  const bar = map ? (mapBar ? { width: `${mapBar.px}px`, label: mapBar.label } : null) : backdrop?.scale ? { width: `${backdrop.scale.widthPct}%`, label: backdrop.scale.label } : null;
  const placed = map ? placedOnMap : placedOnBackdrop;
  const mapsHref = heroMapId ? `/p/${projectId}/maps?map=${heroMapId}` : `/p/${projectId}/maps`;

  return (
    <GlassPanel variant="pane" className={frame} aria-label="Site map">
      {map ? (
        <div className="pointer-events-none absolute inset-0">
          <MapView
            geoMap={map}
            tileUrl={mapTileUrl(baseUrl, token, projectId, map.id)}
            onReady={setOl}
            onViewChange={(v) => setResolution(v.resolution)}
          />
        </div>
      ) : (
        <div aria-hidden className="absolute inset-0 bg-surface-2" />
      )}
      <button type="button" aria-label="Open the Maps tab" onClick={() => void navigate(mapsHref)} className="absolute inset-0 z-[1] cursor-pointer" />
      {placed.map((p, i) => (
        <Pin key={p.pin.id} projectId={projectId} placed={p} index={i} scale={scale} />
      ))}
      <GlassPanel variant="float" className="absolute left-3 top-3 z-[2] px-2.5 py-1.5 text-xs">
        {map ? `${map.name}${map.captured_on ? ` · ${map.captured_on}` : ""}` : "Open findings by location"}
      </GlassPanel>
      <Legend scale={scale} />
      {bar && (
        <GlassPanel variant="float" className="absolute bottom-3 right-3 z-[2] px-2.5 py-1.5 font-mono text-2xs">
          <span data-testid="hero-scale" className="flex items-center gap-2">
            <span aria-hidden className="block h-1 border-x border-b border-ink" style={{ width: bar.width }} />
            {bar.label}
          </span>
        </GlassPanel>
      )}
    </GlassPanel>
  );
}
```

`min-h-[360px]` and `z-[1]`…`z-[3]` are arbitrary sizes, not colours; `check-tokens` allows them.

- [ ] **Step 5: Run the test**

Run: `pnpm -C frontend exec vitest run src/overview/MapHero.test.tsx`
Expected: PASS (5 tests).

- [ ] **Step 6: Lint**

Run: `pnpm -C frontend lint`
Expected: exit 0.

- [ ] **Step 7: Commit**

```bash
git add frontend/src/overview/overview.css frontend/src/overview/MapHero.tsx frontend/src/overview/MapHero.test.tsx
git commit -m "feat(overview): map hero with severity pins, legend and scale; backdrop without a map

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

### Task 11: Overview screen and route

Load the design skills; the target is the whole theme-D Overview in `visual-directions.html`: four
count-up tiles (span 3), map hero (span 8), severity bars and job cards (span 4), recent findings
(span 8) and activity (span 4), on the 12-column grid with the 14 px gap.

**Files:**
- Create: `frontend/src/overview/useOverview.ts`, `KpiRow.tsx`, `SeverityBars.tsx`, `RunningJobs.tsx`,
  `RecentFindings.tsx`, `ActivityFeed.tsx`, `Banners.tsx`, `OverviewScreen.tsx`
- Move: `frontend/src/app/AdoptionBanner.tsx` → `frontend/src/overview/AdoptionBanner.tsx`, and
  `AdoptionBanner.test.tsx` with it (unless SH already did)
- Modify: `frontend/src/routes/projectRoutes.tsx` (the `overview` entry)
- Test: `frontend/src/overview/OverviewScreen.test.tsx`

**Interfaces:**
- Consumes: `fetchOverview`, `listFindings`, `listActivity` (Task 1); `buildKpis`, `severityRows`
  (Task 9); `MapHero`, `overview.css` (Task 10); `useProjectTypes`, `useDataLabels` (Task 3);
  `findingPath`, `findingsListPath`, `findingLocation`, `formatFindingNumber`, `relativeTime`,
  `STATUS_LABEL` (Task 2); `FindingThumb` (Task 4); `fetchJobs` (`@/api/jobs`), `useJobsStore`,
  `isActiveJob`, `jobTitle`; DS `StatTile`, `GlassPanel`, `SeverityPill`, `StatusDot`, `Progress`,
  `Alert`; `runAutoProbe` (`@/app/effects`).
- Produces: `OverviewScreen` (route `p/:projectId/overview`); `useOverview(projectId)`;
  `OVERVIEW_RECENT = 5`, `OVERVIEW_ACTIVITY = 8`.

- [ ] **Step 1: Write the failing test**

`frontend/src/overview/OverviewScreen.test.tsx`:

```tsx
import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, screen, waitFor, within } from "@testing-library/react";
import { errorBody, fakeClient, PROJECT_ID, runningJob, type FakeRoute } from "@/test/fixtures";
import { baseRoutes, emptyOverview, exampleActivity, exampleFinding, exampleOverview } from "@/test/findingFixtures";
import { renderWithProviders } from "@/test/render";
import { useChangesStore } from "@/store/changes";
import { useJobsStore } from "@/store/jobs";
import { OverviewScreen } from "./OverviewScreen";

vi.mock("./MapHero", () => ({ MapHero: () => <div data-testid="map-hero" /> }));
vi.mock("@/app/effects", async (orig) => ({ ...(await orig<object>()), runAutoProbe: vi.fn(async () => null) }));
// Count-up shows the final value at once under reduced motion (F §4.2).
vi.mock("@/ui/motion", async (orig) => ({ ...(await orig<object>()), useReducedMotion: () => true }));

function renderOverview(overview: object | FakeRoute, extra: FakeRoute[] = []) {
  const overviewRoute: FakeRoute =
    "method" in overview ? (overview as FakeRoute) : { method: "GET", path: /\/overview$/, body: overview };
  const { api, requests } = fakeClient(
    baseRoutes([
      overviewRoute,
      ...extra,
      { method: "GET", path: /\/findings$/, body: { items: [exampleFinding], next_cursor: null } },
      { method: "GET", path: /\/activity$/, body: { items: exampleActivity, next_cursor: null } },
      { method: "GET", path: /\/jobs$/, body: { items: [], next_cursor: null } },
      { method: "GET", path: /\/adoption$/, body: { pending: 0, adopted: 0, missing: [], job_id: null } },
    ]),
  );
  renderWithProviders(<OverviewScreen />, { api, route: `/p/${PROJECT_ID}/overview`, path: "/p/:projectId/overview" });
  return requests;
}

describe("OverviewScreen", () => {
  beforeEach(() => {
    useJobsStore.setState({ jobs: {}, panelOpen: false });
    useChangesStore.setState({ findingsRevision: 0, dataRevision: 0 });
  });

  it("shows the full dashboard from one overview read and bounded lists", async () => {
    const requests = renderOverview(exampleOverview);
    expect(await screen.findByText("Open findings")).toBeInTheDocument();
    expect(screen.getByText("47")).toBeInTheDocument();
    expect(screen.getByText("Stockpile volume")).toBeInTheDocument();
    expect(screen.getByTestId("map-hero")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Critical: 5 open" })).toHaveAttribute(
      "href",
      `/p/${PROJECT_ID}/findings?status=open&severity=4`,
    );
    expect(screen.getByRole("link", { name: "View all 89 findings" })).toHaveAttribute(
      "href",
      `/p/${PROJECT_ID}/findings?sort=-updated_at`,
    );
    const recent = screen.getByRole("list", { name: "Recent findings" });
    expect(within(recent).getByText("F-0217")).toBeInTheDocument();
    expect(screen.getByText("9 detections accepted as findings")).toBeInTheDocument();
    expect(requests.filter((r) => r.url.includes("/overview"))).toHaveLength(1);
    const findingsQ = new URL(requests.find((r) => /\/findings\?/.test(r.url))!.url, "http://fake").searchParams;
    expect(findingsQ.get("limit")).toBe("5");
    expect(findingsQ.get("sort")).toBe("-updated_at");
    const activityQ = new URL(requests.find((r) => r.url.includes("/activity"))!.url, "http://fake").searchParams;
    expect(activityQ.get("limit")).toBe("8");
  });

  it("says what to do on an empty project", async () => {
    renderOverview(emptyOverview, [{ method: "GET", path: /\/findings$/, body: { items: [], next_cursor: null } }]);
    expect(await screen.findByText("Reviewed")).toBeInTheDocument();
    expect(screen.getByText("No findings yet. Mark a defect in a workspace, or accept an AI detection of a defect type.")).toBeInTheDocument();
    expect(screen.getByText("Nothing is running.")).toBeInTheDocument();
  });

  it("lists this project's running job with its progress", async () => {
    useJobsStore.getState().upsert({ ...runningJob, project_id: PROJECT_ID, type: "infer", progress: 0.68 });
    renderOverview(exampleOverview);
    expect(await screen.findByRole("progressbar")).toHaveAttribute("aria-valuenow", "68");
  });

  it("shows the payload's banners", async () => {
    renderOverview({
      ...exampleOverview,
      banners: [{ kind: "types_to_classify", tone: "info", message: "12 types came from your existing projects. Mark which are defects." }],
    });
    expect(await screen.findByText(/12 types came from your existing projects/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Open Catalogue" })).toHaveAttribute("href", "/catalogue");
  });

  it("explains an upgrading project instead of an error", async () => {
    renderOverview({
      method: "GET",
      path: /\/overview$/,
      status: 409,
      body: errorBody("project_upgrading", "project is being upgraded", { job_id: "j1" }),
    });
    expect(await screen.findByText(/This project is being upgraded/)).toBeInTheDocument();
  });

  it("re-reads once after a burst of finding changes", async () => {
    const requests = renderOverview(exampleOverview);
    await screen.findByText("Open findings");
    act(() => {
      useChangesStore.getState().bumpFindings();
      useChangesStore.getState().bumpFindings();
      useChangesStore.getState().bumpFindings();
    });
    await waitFor(() => expect(requests.filter((r) => r.url.includes("/overview"))).toHaveLength(2), { timeout: 2000 });
    await new Promise((r) => setTimeout(r, 600));
    expect(requests.filter((r) => r.url.includes("/overview"))).toHaveLength(2);
  });
});
```

`screen.getByText("47")` assumes `StatTile` renders the value as its own text; if it formats
(`47` inside a `<span>` with the unit), query the tile by its label and assert its text content.

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm -C frontend exec vitest run src/overview/OverviewScreen.test.tsx`
Expected: FAIL — `Failed to resolve import "./OverviewScreen"`.

- [ ] **Step 3: Write the data hook**

`frontend/src/overview/useOverview.ts`:

```ts
import { useCallback, useEffect, useRef, useState } from "react";
import { useApi } from "@/api/client";
import { codeOf, messageOf } from "@/api/errors";
import { listActivity, listFindings, type Activity, type Finding } from "@/api/findings";
import { fetchJobs } from "@/api/jobs";
import { fetchOverview, type ProjectOverview } from "@/api/overview";
import { pushLog } from "@/app/diagnostics";
import { useChangesStore } from "@/store/changes";
import { useJobsStore } from "@/store/jobs";

export const OVERVIEW_RECENT = 5;
export const OVERVIEW_ACTIVITY = 8;
const OVERVIEW_JOBS = 10;
const BURST_DEBOUNCE_MS = 400;

interface Loaded {
  projectId: string;
  overview: ProjectOverview | null;
  recent: Finding[];
  activity: Activity[];
  error: string | null;
  code: string | null;
}

/** The Overview's reads (F §9.1, §14): one pre-aggregated payload plus three bounded lists. */
export function useOverview(projectId: string) {
  const api = useApi();
  const findingsRev = useChangesStore((s) => s.findingsRevision);
  const dataRev = useChangesStore((s) => s.dataRevision);
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [tick, setTick] = useState(0);
  const loadedFor = useRef<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    // The first read is immediate; a burst of change events collapses into one re-read.
    const delay = loadedFor.current === projectId ? BURST_DEBOUNCE_MS : 0;
    const timer = window.setTimeout(() => {
      void Promise.allSettled([
        fetchOverview(api, projectId),
        listFindings(api, projectId, { sort: "-updated_at", limit: OVERVIEW_RECENT }),
        listActivity(api, projectId, { limit: OVERVIEW_ACTIVITY }),
      ]).then(([o, r, a]) => {
        if (cancelled) return;
        loadedFor.current = projectId;
        if (r.status === "rejected") pushLog(`recent findings unavailable: ${messageOf(r.reason, String(r.reason))}`);
        if (a.status === "rejected") pushLog(`activity unavailable: ${messageOf(a.reason, String(a.reason))}`);
        setLoaded({
          projectId,
          overview: o.status === "fulfilled" ? o.value : null,
          recent: r.status === "fulfilled" ? r.value.items : [],
          activity: a.status === "fulfilled" ? a.value.items : [],
          error: o.status === "rejected" ? messageOf(o.reason, "could not load the overview") : null,
          code: o.status === "rejected" ? codeOf(o.reason) : null,
        });
      });
    }, delay);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [api, projectId, findingsRev, dataRev, tick]);

  // Running jobs come from the WebSocket store; seed it with this project's newest jobs once.
  useEffect(() => {
    fetchJobs(api, projectId, { limit: OVERVIEW_JOBS })
      .then((jobs) => useJobsStore.getState().upsertMany(jobs))
      .catch((e: unknown) => pushLog(`jobs unavailable: ${messageOf(e, String(e))}`));
  }, [api, projectId]);

  const reload = useCallback(() => setTick((t) => t + 1), []);
  const current = loaded?.projectId === projectId ? loaded : null;
  return {
    overview: current?.overview ?? null,
    recent: current?.recent ?? [],
    activity: current?.activity ?? [],
    error: current?.error ?? null,
    code: current?.code ?? null,
    loading: current === null,
    reload,
  };
}
```

- [ ] **Step 4: Write the blocks**

`frontend/src/overview/KpiRow.tsx`:

```tsx
import type { CSSProperties } from "react";
import { Link } from "react-router-dom";
import { StatTile, focusRing, cx } from "@/ui";
import type { Kpi } from "./kpis";

/** Four StatTiles (span 3 each); count-up and sparkline draw come from the DS primitive. */
export function KpiRow({ kpis }: { kpis: Kpi[] }) {
  return (
    <>
      {kpis.map((k, i) => {
        const tile = (
          <StatTile
            label={k.label}
            value={k.value}
            unit={k.unit}
            delta={k.delta}
            tone={k.tone}
            spark={k.spark}
            chips={
              k.chips?.length ? (
                <span className="flex flex-wrap gap-1">
                  {k.chips.map((c) => (
                    <span key={c} className="rounded-chip bg-surface-2 px-2 py-0.5 font-mono text-2xs text-muted">
                      {c}
                    </span>
                  ))}
                </span>
              ) : undefined
            }
          />
        );
        return (
          <div key={k.id} className="stagger animate-rise col-span-12 sm:col-span-6 xl:col-span-3" style={{ "--i": i } as CSSProperties}>
            {k.href ? (
              <Link to={k.href} className={cx("block h-full rounded-panel", focusRing)}>
                {tile}
              </Link>
            ) : (
              tile
            )}
          </div>
        );
      })}
    </>
  );
}
```

`frontend/src/overview/SeverityBars.tsx`:

```tsx
import type { CSSProperties } from "react";
import { Link } from "react-router-dom";
import { GlassPanel, cx, focusRing } from "@/ui";
import type { SeverityRow } from "./kpis";

/** One bar per level; a click opens the Findings tab filtered to it (F §9.1). */
export function SeverityBars({ rows }: { rows: SeverityRow[] }) {
  return (
    <GlassPanel variant="pane" className="stagger animate-rise p-4" style={{ "--i": 5 } as CSSProperties}>
      <h2 className="text-xs font-medium text-muted">Open findings by severity</h2>
      <ul className="mt-3 flex flex-col gap-2.5">
        {rows.map((r, i) => (
          <li key={r.key}>
            <Link
              to={r.href}
              aria-label={`${r.name}: ${r.count} open`}
              className={cx("grid grid-cols-[5.5rem_1fr_2rem] items-center gap-2.5 rounded-sm text-xs text-ink", focusRing)}
            >
              <span className="truncate">{r.name}</span>
              <span className="h-2 overflow-hidden rounded-chip bg-surface-2">
                <span
                  className="ov-bar block h-full rounded-chip bg-[var(--c)]"
                  style={
                    { "--c": r.colour ?? "rgb(var(--muted))", "--i": i, transform: `scaleX(${r.fraction})` } as CSSProperties
                  }
                />
              </span>
              <span className="text-right font-mono tabular-nums text-muted">{r.count}</span>
            </Link>
          </li>
        ))}
      </ul>
    </GlassPanel>
  );
}
```

`frontend/src/overview/RunningJobs.tsx`:

```tsx
import type { CSSProperties } from "react";
import { Link } from "react-router-dom";
import type { Job } from "@contract/client";
import { jobTitle } from "@/jobs/jobLabels";
import { isActiveJob, useJobsStore } from "@/store/jobs";
import { GlassPanel, Progress, StatusDot } from "@/ui";

const SHOWN = 2;

function JobCard({ job, index }: { job: Job; index: number }) {
  const running = isActiveJob(job);
  return (
    <GlassPanel variant="pane" className="stagger animate-rise p-4" style={{ "--i": 6 + index } as CSSProperties}>
      <p className="flex items-center gap-2 text-xs font-medium text-muted">
        <StatusDot status={running ? "running" : "idle"} live={running} />
        {running ? "Running" : "Done"}
      </p>
      <div className="mt-2 flex items-baseline justify-between gap-3 text-sm">
        <span className="truncate font-semibold text-ink">{jobTitle(job)}</span>
        {running ? (
          <span className="font-mono text-xs tabular-nums text-muted">{Math.round(job.progress * 100)}%</span>
        ) : (
          <span className="text-xs text-ok">Done</span>
        )}
      </div>
      {running && <Progress value={job.progress} running label={jobTitle(job)} className="mt-2.5" />}
      {job.message && <p className="mt-2 truncate font-mono text-2xs text-muted">{job.message}</p>}
    </GlassPanel>
  );
}

/** The project's active jobs (live from the WebSocket store) and the newest finished one. */
export function RunningJobs({ projectId }: { projectId: string }) {
  const jobs = useJobsStore((s) => s.jobs);
  const mine = Object.values(jobs)
    .filter((j) => j.project_id === projectId)
    .sort((a, b) => b.created_at.localeCompare(a.created_at));
  const running = mine.filter(isActiveJob);
  const done = mine.find((j) => j.state === "succeeded");
  if (running.length === 0 && !done)
    return (
      <GlassPanel variant="pane" className="stagger animate-rise p-4" style={{ "--i": 6 } as CSSProperties}>
        <h2 className="text-xs font-medium text-muted">Jobs</h2>
        <p className="mt-2 text-sm text-muted">Nothing is running.</p>
      </GlassPanel>
    );
  return (
    <>
      {running.slice(0, SHOWN).map((j, i) => (
        <JobCard key={j.id} job={j} index={i} />
      ))}
      {running.length > SHOWN && (
        <Link to={`/jobs?project=${projectId}`} className="text-xs text-accent-ink">
          {running.length - SHOWN} more running in Jobs →
        </Link>
      )}
      {done && <JobCard job={done} index={SHOWN} />}
    </>
  );
}
```

`Progress` gains `className` only if DS kept it; otherwise wrap it in `<div className="mt-2.5">`.

`frontend/src/overview/RecentFindings.tsx`:

```tsx
import type { CSSProperties } from "react";
import { Link } from "react-router-dom";
import type { ClassDef } from "@contract/client";
import type { Finding } from "@/api/findings";
import { FindingThumb } from "@/findings/FindingThumb";
import { findingsListPath } from "@/findings/filters";
import { formatFindingNumber } from "@/findings/format";
import { findingPath } from "@/findings/links";
import { findingLocation } from "@/findings/location";
import { STATUS_LABEL } from "@/findings/status";
import { GlassPanel, Icon, SeverityPill, StatusDot, cx, focusRing } from "@/ui";

export function RecentFindings({
  projectId,
  findings,
  total,
  types,
  labels,
}: {
  projectId: string;
  findings: Finding[];
  total: number;
  types: ReadonlyMap<string, ClassDef>;
  labels: ReadonlyMap<string, string>;
}) {
  return (
    <GlassPanel variant="pane" className="stagger animate-rise col-span-12 p-0 lg:col-span-8" style={{ "--i": 7 } as CSSProperties}>
      <div className="flex items-center justify-between border-b border-line px-4 py-3">
        <h2 className="text-lg font-semibold">Recent findings</h2>
        {total > 0 && (
          <Link
            to={findingsListPath(projectId, { sort: "-updated_at" })}
            aria-label={`View all ${total} findings`}
            className={cx("text-xs text-accent-ink", focusRing)}
          >
            View all {total} →
          </Link>
        )}
      </div>
      {findings.length === 0 ? (
        <p className="px-4 py-6 text-sm text-muted">
          No findings yet. Mark a defect in a workspace, or accept an AI detection of a defect type.
        </p>
      ) : (
        <ul aria-label="Recent findings">
          {findings.map((f, i) => {
            const t = types.get(f.type_id);
            const loc = findingLocation(f, labels);
            return (
              <li key={f.id} className="stagger animate-rise border-b border-line last:border-b-0" style={{ "--i": 8 + i } as CSSProperties}>
                <Link
                  to={findingPath(projectId, f.id)}
                  className={cx(
                    "group grid grid-cols-[44px_1.6fr_1fr_0.9fr_0.8fr_16px] items-center gap-3 px-4 py-2.5 text-sm hover:bg-hover",
                    focusRing,
                  )}
                >
                  <FindingThumb projectId={projectId} finding={f} colour={t?.colour ?? "rgb(var(--muted))"} />
                  <span className="min-w-0">
                    <span className="block truncate font-semibold text-ink">
                      {t?.name ?? "Unknown type"} <span className="font-mono text-2xs font-normal text-muted">{formatFindingNumber(f.number)}</span>
                    </span>
                    <span className="block truncate text-xs text-muted">{loc.secondary ?? loc.primary}</span>
                  </span>
                  <SeverityPill level={f.severity} />
                  <span className="flex min-w-0 items-center gap-1.5 text-xs text-muted">
                    <Icon name={loc.icon} size={14} className="shrink-0" />
                    <span className="truncate">{loc.primary}</span>
                  </span>
                  <span className="inline-flex items-center gap-1.5 text-xs text-muted">
                    <StatusDot status={f.status} />
                    {STATUS_LABEL[f.status]}
                  </span>
                  <Icon name="chevron-right" size={14} className="text-dim transition-transform group-hover:translate-x-0.5" />
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </GlassPanel>
  );
}
```

`frontend/src/overview/ActivityFeed.tsx`:

```tsx
import type { CSSProperties } from "react";
import { Link } from "react-router-dom";
import type { Activity } from "@/api/findings";
import { relativeTime } from "@/findings/format";
import { findingPath } from "@/findings/links";
import { useNow } from "@/jobs/useNow";
import { GlassPanel, Icon, type IconName } from "@/ui";

const ICON: Record<string, IconName> = {
  "finding.created": "findings",
  "finding.status": "check",
  "finding.severity": "warning",
  "finding.comment": "list",
  "data.imported": "import",
  "job.finished": "jobs",
  "detections.accepted": "sparkle",
};

export function ActivityFeed({ projectId, items }: { projectId: string; items: Activity[] }) {
  const nowMs = useNow(60_000);
  return (
    <GlassPanel variant="pane" className="stagger animate-rise col-span-12 p-4 lg:col-span-4" style={{ "--i": 7 } as CSSProperties}>
      <h2 className="text-xs font-medium text-muted">Activity</h2>
      {items.length === 0 ? (
        <p className="mt-3 text-sm text-muted">Nothing has happened here yet.</p>
      ) : (
        <ul className="mt-3 flex flex-col gap-3">
          {items.map((a, i) => {
            const body = (
              <>
                <span className="grid h-6 w-6 shrink-0 place-items-center rounded-sm bg-surface-2 text-muted">
                  <Icon name={ICON[a.kind] ?? "info"} size={14} />
                </span>
                <span className="min-w-0 text-sm">
                  <span className="block text-ink">{a.summary}</span>
                  <span className="block text-2xs text-muted">{relativeTime(a.at, nowMs)}</span>
                </span>
              </>
            );
            return (
              <li key={a.id} className="stagger animate-rise" style={{ "--i": 8 + i } as CSSProperties}>
                {a.kind.startsWith("finding.") && a.subject_id ? (
                  <Link to={findingPath(projectId, a.subject_id)} className="flex gap-2.5 rounded-sm hover:bg-hover">
                    {body}
                  </Link>
                ) : (
                  <div className="flex gap-2.5">{body}</div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </GlassPanel>
  );
}
```

`frontend/src/overview/Banners.tsx`:

```tsx
import { Link } from "react-router-dom";
import type { ProjectOverview } from "@/api/overview";
import { Alert, buttonClass } from "@/ui";
import { AdoptionBanner } from "./AdoptionBanner";

/** Migration warnings, "types to classify" (from the payload) and model adoption (F §9.1). */
export function Banners({ projectId, banners }: { projectId: string; banners: ProjectOverview["banners"] }) {
  return (
    <div className="col-span-12 flex flex-col gap-2 empty:hidden">
      {banners.map((b, i) => (
        <Alert
          key={`${b.kind}-${i}`}
          tone={b.tone}
          actions={
            b.kind === "types_to_classify" ? (
              <Link to="/catalogue" className={buttonClass("secondary", "sm")}>
                Open Catalogue
              </Link>
            ) : undefined
          }
        >
          {b.message}
        </Alert>
      ))}
      <AdoptionBanner projectId={projectId} />
    </div>
  );
}
```

- [ ] **Step 5: Move the adoption banner and check Home is gone**

Run (from the worktree root):
```
git mv frontend/src/app/AdoptionBanner.tsx frontend/src/overview/AdoptionBanner.tsx
git mv frontend/src/app/AdoptionBanner.test.tsx frontend/src/overview/AdoptionBanner.test.tsx
```
Then `rg -n "AdoptionBanner|HomeScreen|useHomePreviews" frontend/src` and fix each import to
`@/overview/AdoptionBanner`; no reference to `HomeScreen` or `useHomePreviews` may remain (SH deleted them).

- [ ] **Step 6: Write the screen**

`frontend/src/overview/OverviewScreen.tsx`:

```tsx
import { useEffect, useMemo } from "react";
import { Link, useParams } from "react-router-dom";
import { runAutoProbe } from "@/app/effects";
import { useDataLabels } from "@/findings/useDataLabels";
import { useProjectTypes } from "@/findings/useProjectTypes";
import { Alert, Button, Skeleton, buttonClass, useSeverityScale } from "@/ui";
import { ActivityFeed } from "./ActivityFeed";
import { Banners } from "./Banners";
import { KpiRow } from "./KpiRow";
import { buildKpis, severityRows } from "./kpis";
import { MapHero } from "./MapHero";
import { RecentFindings } from "./RecentFindings";
import { RunningJobs } from "./RunningJobs";
import { SeverityBars } from "./SeverityBars";
import { useOverview } from "./useOverview";
import "./overview.css";

function OverviewSkeleton() {
  return (
    <div className="grid grid-cols-12 gap-3.5" aria-busy="true">
      {[0, 1, 2, 3].map((i) => (
        <Skeleton key={i} className="col-span-12 h-28 rounded-panel sm:col-span-6 xl:col-span-3" />
      ))}
      <Skeleton className="col-span-12 h-[360px] rounded-panel lg:col-span-8" />
      <Skeleton className="col-span-12 h-[360px] rounded-panel lg:col-span-4" />
    </div>
  );
}

/** The project's front page (F §9.1): pre-aggregated counts only, never a scan per render. */
export function OverviewScreen() {
  const { projectId = "" } = useParams();
  const { overview, recent, activity, error, code, loading, reload } = useOverview(projectId);
  const scale = useSeverityScale();
  const { types } = useProjectTypes(projectId);
  const labels = useDataLabels(projectId);
  const today = useMemo(() => new Date().toISOString().slice(0, 10), []);

  useEffect(() => {
    // F §4.3: the reduced-effects Auto probe measures frames on the first Overview render.
    void runAutoProbe();
  }, []);

  if (code === "project_upgrading")
    return (
      <Alert tone="info" actions={<Link to="/projects" className={buttonClass("secondary", "sm")}>Projects</Link>}>
        This project is being upgraded to the new format. It opens when the upgrade finishes; the Projects page
        shows its progress.
      </Alert>
    );
  if (error)
    return (
      <Alert tone="danger" actions={<Button size="sm" onClick={reload}>Retry</Button>}>
        {error}
      </Alert>
    );
  if (loading || !overview) return <OverviewSkeleton />;

  const s = overview.findings;
  const total = s.by_status.open + s.by_status.reviewed + s.by_status.closed;
  return (
    <section aria-label="Overview" className="mx-auto grid max-w-[1400px] grid-cols-12 gap-3.5">
      <Banners projectId={projectId} banners={overview.banners} />
      <KpiRow kpis={buildKpis(overview, scale, projectId, today)} />
      <MapHero projectId={projectId} heroMapId={overview.hero_map_id} />
      <div className="col-span-12 flex flex-col gap-3.5 lg:col-span-4">
        <SeverityBars rows={severityRows(s, scale, projectId)} />
        <RunningJobs projectId={projectId} />
      </div>
      <RecentFindings projectId={projectId} findings={recent} total={total} types={types} labels={labels} />
      <ActivityFeed projectId={projectId} items={activity} />
    </section>
  );
}
```

- [ ] **Step 7: Route it**

In `frontend/src/routes/projectRoutes.tsx`, replace SH's `overview` entry (an `app/InterimScreens.tsx`
placeholder; keep SH's `index` redirect to `overview`):

```tsx
  // F §9.1: the project opens here.
  { path: "overview", element: <OverviewScreen /> },
```

with `import { OverviewScreen } from "@/overview/OverviewScreen";`.

- [ ] **Step 8: Run the tests**

Run: `pnpm -C frontend exec vitest run src/overview src/routes src/app`
Expected: PASS (6 new Overview tests; the moved AdoptionBanner test; SH's redirect tests).

- [ ] **Step 9: Lint and build**

Run: `pnpm -C frontend lint` then `pnpm -C frontend build`
Expected: both exit 0.

- [ ] **Step 10: Commit** (`git mv` / `git rm` already staged the moves and deletions)

```bash
git add frontend/src/overview/useOverview.ts frontend/src/overview/KpiRow.tsx frontend/src/overview/SeverityBars.tsx frontend/src/overview/RunningJobs.tsx frontend/src/overview/RecentFindings.tsx frontend/src/overview/ActivityFeed.tsx frontend/src/overview/Banners.tsx frontend/src/overview/OverviewScreen.tsx frontend/src/overview/OverviewScreen.test.tsx frontend/src/overview/AdoptionBanner.tsx frontend/src/overview/AdoptionBanner.test.tsx frontend/src/routes/projectRoutes.tsx
git commit -m "feat(overview): project Overview dashboard with KPIs, hero map, severity, jobs and activity

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

### Task 12: Projects list model

**Files:**
- Create: `frontend/src/screens/projects/projectCards.ts`, `frontend/src/screens/projects/projectFixtures.ts`
- Test: `frontend/src/screens/projects/projectCards.test.ts`

**Interfaces:**
- Consumes: `Project` (`@contract/client`, with `summary`, `migration`, `last_opened_at`);
  `thumbnailUrl`, `mapPreviewUrl` (`@contract/client`).
- Produces:
  - `ProjectSort = "recent" | "name" | "findings"`; `visibleProjects(list, q, sort): Project[]`
  - `CardState = {kind:"ok"} | {kind:"missing"} | {kind:"pending"} | {kind:"upgrading"; jobId: string | null} | {kind:"failed"; error: string; backupPath: string | null}`; `cardState(p)` (`availability: "missing"` wins over the migration state; operator decision 2026-09-26); `canOpen(p)`
  - `dataChips(summary): string[]`; `coverUrl(p, baseUrl, token): string | null`
  - fixtures `okProject`, `upgradingProject`, `failedProject`, `pendingProject`, `missingProject`

- [ ] **Step 1: Write the fixtures and the failing test**

`frontend/src/screens/projects/projectFixtures.ts`:

```ts
import type { Project } from "@contract/client";
import { exampleProject, IMAGE_ID, MAP_ID } from "@/test/fixtures";

export const okProject: Project = {
  ...exampleProject,
  id: "p-ok",
  name: "Ahmadia Tower",
  folder: "E:\\Projects\\Ahmadia-Tower",
  summary: {
    image_count: 1284,
    maps: 3,
    point_clouds: 2,
    elevations: 1,
    open_findings: 47,
    open_top_severity: 5,
    cover: { kind: "map", id: MAP_ID },
  },
  migration: { state: "ok" },
  last_opened_at: "2026-09-26T08:00:00Z",
};

export const upgradingProject: Project = {
  ...okProject,
  id: "p-up",
  name: "Bridge B2",
  folder: "E:\\Projects\\Bridge-B2",
  summary: { ...okProject.summary!, open_findings: 3, open_top_severity: 0, cover: { kind: "image", id: IMAGE_ID } },
  migration: { state: "running", job_id: "j-migrate" },
};

export const failedProject: Project = {
  ...okProject,
  id: "p-bad",
  name: "Yard 7",
  folder: "E:\\Projects\\Yard-7",
  summary: null,
  migration: {
    state: "failed",
    error: "step rewrite_class_ids: database disk image is malformed",
    backup_path: "E:\\Projects\\Yard-7\\backups\\project.db.v1-20260926T080000Z.bak",
  },
  last_opened_at: null,
};

export const pendingProject: Project = {
  ...okProject,
  id: "p-wait",
  name: "Quarry",
  folder: "E:\\Projects\\Quarry",
  migration: { state: "pending" },
};

/** A recent project whose folder was moved or deleted (operator decision 2026-09-26: listed, not hidden). */
export const missingProject: Project = {
  ...okProject,
  id: "p-gone",
  name: "Yard 9",
  folder: "E:\\Projects\\Yard-9",
  summary: null,
  migration: { state: "ok" },
  availability: "missing",
};
```

`frontend/src/screens/projects/projectCards.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { IMAGE_ID, MAP_ID } from "@/test/fixtures";
import { canOpen, cardState, coverUrl, dataChips, visibleProjects } from "./projectCards";
import { failedProject, missingProject, okProject, pendingProject, upgradingProject } from "./projectFixtures";

const all = [okProject, upgradingProject, failedProject, pendingProject];

describe("visibleProjects", () => {
  it("keeps the server's last-opened order by default and searches names", () => {
    expect(visibleProjects(all, "", "recent").map((p) => p.id)).toEqual(["p-ok", "p-up", "p-bad", "p-wait"]);
    expect(visibleProjects(all, "  bridge ", "recent").map((p) => p.id)).toEqual(["p-up"]);
  });

  it("sorts by name and by open findings", () => {
    expect(visibleProjects(all, "", "name").map((p) => p.name)).toEqual(["Ahmadia Tower", "Bridge B2", "Quarry", "Yard 7"]);
    expect(visibleProjects(all, "", "findings").map((p) => p.id)).toEqual(["p-ok", "p-wait", "p-up", "p-bad"]);
  });
});

describe("cardState", () => {
  it("maps the migration state", () => {
    expect(cardState(okProject)).toEqual({ kind: "ok" });
    expect(cardState(upgradingProject)).toEqual({ kind: "upgrading", jobId: "j-migrate" });
    expect(cardState(pendingProject)).toEqual({ kind: "pending" });
    expect(cardState(failedProject)).toEqual({
      kind: "failed",
      error: "step rewrite_class_ids: database disk image is malformed",
      backupPath: failedProject.migration.backup_path,
    });
    expect(all.filter(canOpen).map((p) => p.id)).toEqual(["p-ok"]);
  });

  it("a project whose folder is gone is missing and cannot open, whatever its migration says", () => {
    expect(cardState(missingProject)).toEqual({ kind: "missing" });
    expect(canOpen(missingProject)).toBe(false);
    expect(coverUrl(missingProject, "http://h", "t")).toBeNull();
  });

  it("a failed project with no summary still has chips and no cover", () => {
    expect(dataChips(failedProject.summary)).toEqual([]);
    expect(coverUrl(failedProject, "http://h", "t")).toBeNull();
  });
});

describe("chips and covers", () => {
  it("lists non-zero data", () => {
    expect(dataChips(okProject.summary)).toEqual(["1,284 images", "3 maps", "2 clouds", "1 elevation"]);
    expect(dataChips({ ...okProject.summary!, maps: 1, point_clouds: 0, elevations: 0, image_count: 1 })).toEqual(["1 image", "1 map"]);
  });

  it("uses the hero map's preview, else the newest image thumbnail", () => {
    expect(coverUrl(okProject, "http://h", "t")).toBe(`http://h/api/v1/projects/p-ok/maps/${MAP_ID}/preview?token=t`);
    expect(coverUrl(upgradingProject, "http://h", "t")).toBe(`http://h/api/v1/projects/p-up/images/${IMAGE_ID}/thumbnail?token=t`);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm -C frontend exec vitest run src/screens/projects/projectCards.test.ts`
Expected: FAIL — `Failed to resolve import "./projectCards"`.

- [ ] **Step 3: Write the model**

`frontend/src/screens/projects/projectCards.ts`:

```ts
import { mapPreviewUrl, thumbnailUrl, type Project } from "@contract/client";

export type ProjectSort = "recent" | "name" | "findings";
type Summary = Project["summary"];

/** "Last opened" is the server's order (recent_projects.json keeps the newest first). */
export function visibleProjects(list: readonly Project[], q: string, sort: ProjectSort): Project[] {
  const needle = q.trim().toLocaleLowerCase();
  const hits = needle ? list.filter((p) => p.name.toLocaleLowerCase().includes(needle)) : [...list];
  const byName = (a: Project, b: Project) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" });
  if (sort === "name") return hits.sort(byName);
  if (sort === "findings")
    return hits.sort(
      (a, b) =>
        (b.summary?.open_findings ?? -1) - (a.summary?.open_findings ?? -1) ||
        (b.summary?.open_top_severity ?? 0) - (a.summary?.open_top_severity ?? 0) ||
        byName(a, b),
    );
  return hits;
}

export type CardState =
  | { kind: "ok" }
  | { kind: "missing" }
  | { kind: "pending" }
  | { kind: "upgrading"; jobId: string | null }
  | { kind: "failed"; error: string; backupPath: string | null };

/** F §9.2: a project that is not `ok` is listed but will not open. A folder that is gone is listed
 * as "Folder not found" (operator decision 2026-09-26). */
export function cardState(p: Project): CardState {
  if (p.availability === "missing") return { kind: "missing" };
  const m = p.migration;
  switch (m.state) {
    case "ok":
      return { kind: "ok" };
    case "pending":
      return { kind: "pending" };
    case "running":
      return { kind: "upgrading", jobId: m.job_id ?? null };
    case "failed":
      return { kind: "failed", error: m.error ?? "The upgrade stopped without a message.", backupPath: m.backup_path ?? null };
  }
}

export function canOpen(p: Project): boolean {
  return p.availability === "ok" && p.migration.state === "ok";
}

const count = (n: number, one: string, many: string) => `${n.toLocaleString("en-US")} ${n === 1 ? one : many}`;

export function dataChips(s: Summary): string[] {
  if (!s) return [];
  return [
    s.image_count ? count(s.image_count, "image", "images") : null,
    s.maps ? count(s.maps, "map", "maps") : null,
    s.point_clouds ? count(s.point_clouds, "cloud", "clouds") : null,
    s.elevations ? count(s.elevations, "elevation", "elevations") : null,
  ].filter((c): c is string => c !== null);
}

export function coverUrl(p: Project, baseUrl: string, token: string): string | null {
  const cover = p.summary?.cover;
  if (!cover) return null;
  return cover.kind === "map" ? mapPreviewUrl(baseUrl, token, p.id, cover.id) : thumbnailUrl(baseUrl, token, p.id, cover.id);
}
```

- [ ] **Step 4: Run the test**

Run: `pnpm -C frontend exec vitest run src/screens/projects/projectCards.test.ts`
Expected: PASS (7 tests).

- [ ] **Step 5: Commit**

```bash
git add frontend/src/screens/projects/projectCards.ts frontend/src/screens/projects/projectFixtures.ts frontend/src/screens/projects/projectCards.test.ts
git commit -m "feat(projects): card model with search, sort, migration states, chips and covers

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

### Task 13: Projects list — card grid, toolbar, migration states

Load the design skills first.

**Files:**
- Create: `frontend/src/screens/projects/ProjectCard.tsx`, `frontend/src/screens/projects/MigrationDetailsDialog.tsx`
- Modify (rewrite): `frontend/src/screens/ProjectsScreen.tsx`, `frontend/src/screens/ProjectsScreen.test.tsx`

**Interfaces:**
- Consumes: Task 12 (`visibleProjects`, `cardState`, `canOpen`, `dataChips`, `coverUrl`,
  fixtures); `relativeTime` (Task 2); `useChangesStore.projectsRevision` (Task 1); `fetchJob`
  (`@/api/jobs`), `useJobsStore`, `isActiveJob`, `useOnJobsFinished`; DS `GlassPanel`, `StatusDot`,
  `SeverityPill`, `Pill`, `Progress`, `MenuButton`, `Dialog`, `useSeverityScale`; DS `.stagger animate-rise`.
- Produces: `ProjectsScreen`; `ProjectCard({project, onOpen, onRetry, onRemove, onLocate})`;
  `MigrationDetailsDialog({project, onClose})` (with Reveal backup: C0 `revealProjectBackup`); `retryMigration(api, folder)`.

- [ ] **Step 1: Write the failing test** (replaces the whole file; Task 14 appends to it)

`frontend/src/screens/ProjectsScreen.test.tsx`:

```tsx
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { useLocation } from "react-router-dom";
import { fakeClient, runningJob, type FakeRoute } from "@/test/fixtures";
import { severityRoute } from "@/test/findingFixtures";
import { renderWithProviders } from "@/test/render";
import { useChangesStore } from "@/store/changes";
import { useJobsStore } from "@/store/jobs";
import { failedProject, missingProject, okProject, pendingProject, upgradingProject } from "./projects/projectFixtures";
import { ProjectsScreen } from "./ProjectsScreen";

function LocationProbe() {
  const l = useLocation();
  return <output data-testid="location">{l.pathname}</output>;
}

function renderList(items = [okProject, upgradingProject, failedProject, pendingProject], extra: FakeRoute[] = []) {
  const { api, requests } = fakeClient([
    ...extra,
    { method: "GET", path: /\/projects$/, body: { items, next_cursor: null } },
    { method: "GET", path: /\/library\/jobs\/[^/]+$/, body: { ...runningJob, id: "j-migrate", project_id: "library", type: "project_migrate", progress: 0.4 } },
    { method: "POST", path: /\/projects\/migrations\/retry$/, status: 202, body: { ...runningJob, id: "j2", project_id: "library", type: "project_migrate" } },
    severityRoute,
  ]);
  renderWithProviders(
    <>
      <ProjectsScreen />
      <LocationProbe />
    </>,
    { api, route: "/projects", path: "/projects" },
  );
  return requests;
}

const card = (name: string) => screen.getByRole("article", { name });

describe("ProjectsScreen: the list", () => {
  beforeEach(() => {
    useJobsStore.setState({ jobs: {}, panelOpen: false });
    useChangesStore.setState({ projectsRevision: 0 });
  });

  it("shows a card per project with folder, open findings and data chips", async () => {
    renderList();
    await screen.findByRole("article", { name: "Ahmadia Tower" });
    const ok = card("Ahmadia Tower");
    expect(within(ok).getByText("E:\\Projects\\Ahmadia-Tower")).toBeInTheDocument();
    expect(within(ok).getByText("47 open")).toBeInTheDocument();
    expect(within(ok).getByText("5 Critical")).toBeInTheDocument();
    expect(within(ok).getByText("1,284 images")).toBeInTheDocument();
    expect(ok.querySelector("img")?.getAttribute("src")).toContain("/preview?token=");
  });

  it("removes a project from the list after asking, and says the folder stays", async () => {
    const requests = renderList([okProject], [{ method: "DELETE", path: /\/projects\/[^/]+$/, status: 204 }]);
    const ok = await screen.findByRole("article", { name: "Ahmadia Tower" });
    fireEvent.click(within(ok).getByRole("button", { name: "More for Ahmadia Tower" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Remove from the list" }));
    const dialog = await screen.findByRole("dialog", { name: "Remove Ahmadia Tower from the list?" });
    expect(dialog).toHaveTextContent("The folder and everything in it stay on disk");
    expect(requests.some((r) => r.method === "DELETE")).toBe(false);
    fireEvent.click(within(dialog).getByRole("button", { name: "Remove from the list" }));
    await waitFor(() => expect(screen.queryByRole("article", { name: "Ahmadia Tower" })).toBeNull());
    expect(requests.find((r) => r.method === "DELETE")?.url).toBe("/api/v1/projects/p-ok");
  });

  it("opens a healthy project on its Overview", async () => {
    renderList();
    fireEvent.click(within(await screen.findByRole("article", { name: "Ahmadia Tower" })).getByRole("button", { name: "Open" }));
    await waitFor(() => expect(screen.getByTestId("location")).toHaveTextContent("/p/p-ok/overview"));
  });

  it("shows an upgrade in progress, and the project cannot be opened", async () => {
    renderList();
    const up = await screen.findByRole("article", { name: "Bridge B2" });
    expect(within(up).getByText("Upgrading…")).toBeInTheDocument();
    expect(within(up).getByRole("button", { name: "Open" })).toBeDisabled();
    await waitFor(() => expect(within(up).getByRole("progressbar")).toHaveAttribute("aria-valuenow", "40"));
  });

  it("lists a failed project next to a healthy one, with Retry and Details", async () => {
    const requests = renderList();
    const bad = await screen.findByRole("article", { name: "Yard 7" });
    expect(within(bad).getByText("Couldn't upgrade")).toBeInTheDocument();
    expect(within(bad).getByRole("button", { name: "Open" })).toBeDisabled();
    fireEvent.click(within(bad).getByRole("button", { name: "Details" }));
    const dialog = await screen.findByRole("dialog", { name: "Yard 7 could not be upgraded" });
    expect(dialog).toHaveTextContent("database disk image is malformed");
    expect(dialog).toHaveTextContent(failedProject.migration.backup_path!);
    fireEvent.click(within(dialog).getByRole("button", { name: "Done" }));
    fireEvent.click(within(bad).getByRole("button", { name: "Retry" }));
    await waitFor(() =>
      expect(requests.find((r) => r.url.endsWith("/migrations/retry"))?.body).toEqual({ folder: failedProject.folder }),
    );
    expect(screen.getByRole("article", { name: "Ahmadia Tower" })).toBeInTheDocument();
  });

  it("lists a project whose folder is gone as Folder not found, and removes it from the list", async () => {
    const requests = renderList([okProject, missingProject], [{ method: "DELETE", path: /\/projects\/[^/]+$/, status: 204 }]);
    const gone = await screen.findByRole("article", { name: "Yard 9" });
    expect(within(gone).getByText("Folder not found")).toBeInTheDocument();
    expect(within(gone).getByRole("button", { name: "Locate folder…" })).toBeInTheDocument();
    expect(within(gone).queryByRole("button", { name: "Open" })).toBeNull();
    fireEvent.click(within(gone).getByRole("button", { name: "Remove from list" }));
    const dialog = await screen.findByRole("dialog", { name: "Remove Yard 9 from the list?" });
    fireEvent.click(within(dialog).getByRole("button", { name: "Remove from the list" }));
    await waitFor(() => expect(screen.queryByRole("article", { name: "Yard 9" })).toBeNull());
    expect(requests.find((r) => r.method === "DELETE")?.url).toBe("/api/v1/projects/p-gone");
    expect(screen.getByRole("article", { name: "Ahmadia Tower" })).toBeInTheDocument();
  });

  it("reveals the backup in Explorer through the backend", async () => {
    const requests = renderList([failedProject], [{ method: "POST", path: /\/migrations\/reveal-backup$/, status: 204 }]);
    fireEvent.click(within(await screen.findByRole("article", { name: "Yard 7" })).getByRole("button", { name: "Details" }));
    fireEvent.click(await screen.findByRole("button", { name: "Reveal backup" }));
    await waitFor(() =>
      expect(requests.find((r) => r.url.endsWith("/migrations/reveal-backup"))?.body).toEqual({ folder: failedProject.folder }),
    );
  });

  it("copies the backup path", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    renderList();
    fireEvent.click(within(await screen.findByRole("article", { name: "Yard 7" })).getByRole("button", { name: "Details" }));
    fireEvent.click(await screen.findByRole("button", { name: "Copy backup path" }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith(failedProject.migration.backup_path));
  });

  it("searches by name and sorts", async () => {
    renderList();
    await screen.findByRole("article", { name: "Ahmadia Tower" });
    fireEvent.change(screen.getByRole("searchbox", { name: "Search projects" }), { target: { value: "yard" } });
    expect(screen.getAllByRole("article").map((a) => a.getAttribute("aria-label"))).toEqual(["Yard 7"]);
    fireEvent.change(screen.getByRole("searchbox", { name: "Search projects" }), { target: { value: "" } });
    fireEvent.change(screen.getByRole("combobox", { name: "Sort projects" }), { target: { value: "name" } });
    expect(screen.getAllByRole("article").map((a) => a.getAttribute("aria-label"))).toEqual([
      "Ahmadia Tower",
      "Bridge B2",
      "Quarry",
      "Yard 7",
    ]);
  });

  it("re-reads the list on migration.changed", async () => {
    const requests = renderList();
    await screen.findByRole("article", { name: "Ahmadia Tower" });
    useChangesStore.setState({ projectsRevision: 1 });
    await waitFor(() => expect(requests.filter((r) => r.url.endsWith("/projects"))).toHaveLength(2));
  });

  it("marks a project with a running job as live", async () => {
    useJobsStore.getState().upsert({ ...runningJob, project_id: "p-ok" });
    renderList();
    const ok = await screen.findByRole("article", { name: "Ahmadia Tower" });
    expect(within(ok).getByText("Job running")).toBeInTheDocument();
  });

  it("says how to start when the list is empty", async () => {
    renderList([]);
    expect(await screen.findByText("No projects yet")).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm -C frontend exec vitest run src/screens/ProjectsScreen.test.tsx`
Expected: FAIL — no `article` named "Ahmadia Tower" (the old screen renders a `<ul>` with kind pills).

- [ ] **Step 3: Write the details dialog and the card**

`frontend/src/screens/projects/MigrationDetailsDialog.tsx`:

```tsx
import type { Project } from "@contract/client";
import { useApi } from "@/api/client";
import { messageOf, unwrap } from "@/api/errors";
import { Button, Dialog, toast } from "@/ui";

/**
 * "Couldn't upgrade" details (F §9.2, §11.3). The database was not changed: the copy under
 * backups\ is the pre-upgrade state. Restoring it is a manual step (F §11.3 "Restore").
 */
export function MigrationDetailsDialog({ project, onClose }: { project: Project; onClose: () => void }) {
  const api = useApi();
  const backup = project.migration.backup_path ?? null;
  async function reveal() {
    try {
      await unwrap(api.POST("/api/v1/projects/migrations/reveal-backup", { body: { folder: project.folder } }));
    } catch (e) {
      toast("danger", messageOf(e, "could not show the backup"));
    }
  }
  async function copy() {
    if (!backup) return;
    try {
      await navigator.clipboard.writeText(backup);
      toast("ok", "Backup path copied");
    } catch {
      toast("danger", "Could not copy the path");
    }
  }
  return (
    <Dialog
      open
      title={`${project.name} could not be upgraded`}
      onClose={onClose}
      footer={
        <>
          {backup && (
            <>
              <Button icon="folder" onClick={() => void reveal()}>
                Reveal backup
              </Button>
              <Button variant="ghost" onClick={() => void copy()}>
                Copy backup path
              </Button>
            </>
          )}
          <Button variant="primary" onClick={onClose}>
            Done
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3 text-sm">
        <p className="text-muted">
          The project was left as it was. Retry runs the upgrade again from the step that failed.
        </p>
        <p className="rounded-control bg-field p-3 font-mono text-xs text-ink">{project.migration.error ?? "No message."}</p>
        {backup && (
          <p className="text-muted">
            A copy taken before the upgrade is at <span className="break-all font-mono text-xs text-ink">{backup}</span>.
          </p>
        )}
      </div>
    </Dialog>
  );
}
```

`frontend/src/screens/projects/ProjectCard.tsx`:

```tsx
import { useState } from "react";
import type { Project } from "@contract/client";
import { useBackend } from "@/api/client";
import { relativeTime } from "@/findings/format";
import { useNow } from "@/jobs/useNow";
import { isActiveJob, useJobsStore } from "@/store/jobs";
import { Button, GlassPanel, Icon, MenuButton, Pill, Progress, SeverityPill, StatusDot, Tooltip, useSeverityScale } from "@/ui";
import { MigrationDetailsDialog } from "./MigrationDetailsDialog";
import { canOpen, cardState, coverUrl, dataChips } from "./projectCards";

function Cover({ url }: { url: string | null }) {
  const [failed, setFailed] = useState(false);
  return (
    <div className="relative h-32 overflow-hidden bg-surface-2">
      {url && !failed ? (
        <img src={url} alt="" loading="lazy" onError={() => setFailed(true)} className="h-full w-full object-cover" />
      ) : (
        <div className="grid h-full place-items-center text-dim">
          <Icon name="images" size={24} />
        </div>
      )}
    </div>
  );
}

export function ProjectCard({
  project,
  onOpen,
  onRetry,
  onRemove,
  onLocate,
}: {
  project: Project;
  onOpen: (p: Project) => void;
  onRetry: (p: Project) => void;
  onRemove: (p: Project) => void;
  onLocate: (p: Project) => void;
}) {
  const { baseUrl, token } = useBackend();
  const nowMs = useNow(60_000);
  const scale = useSeverityScale();
  const state = cardState(project);
  const [details, setDetails] = useState(false);
  const live = useJobsStore((s) => Object.values(s.jobs).some((j) => j.project_id === project.id && isActiveJob(j)));
  const migrationJob = useJobsStore((s) => (state.kind === "upgrading" && state.jobId ? s.jobs[state.jobId] : undefined));
  const top = scale.reduce<(typeof scale)[number] | null>((a, l) => (a === null || l.level > a.level ? l : a), null);
  const s = project.summary;
  const openable = canOpen(project);

  return (
    <GlassPanel variant="pane" interactive className="flex h-full flex-col overflow-hidden p-0">
      <article aria-label={project.name} className="flex h-full flex-col">
        <Cover url={coverUrl(project, baseUrl, token)} />
        <div className="flex flex-1 flex-col gap-2.5 p-4">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <h3 className="flex items-center gap-2 truncate text-lg font-semibold">
                <StatusDot status={state.kind === "failed" || state.kind === "missing" ? "failed" : live ? "running" : "idle"} live={live} />
                <span className="truncate">{project.name}</span>
              </h3>
              <p className="truncate font-mono text-2xs text-muted" title={project.folder}>
                {project.folder}
              </p>
            </div>
            <MenuButton
              label={`More for ${project.name}`}
              iconOnly
              icon="list"
              items={[{ id: "remove", label: "Remove from the list", icon: "trash", onSelect: () => onRemove(project) }]}
            />
          </div>
          {live && <span className="sr-only">Job running</span>}
          {s && (
            <p className="flex flex-wrap items-center gap-2 text-sm">
              <span className="font-semibold tabular-nums text-ink">{s.open_findings} open</span>
              {s.open_top_severity > 0 && top && (
                <span className="inline-flex items-center gap-1.5">
                  <SeverityPill level={top.level} />
                  <span className="text-xs text-muted">{`${s.open_top_severity} ${top.name}`}</span>
                </span>
              )}
            </p>
          )}
          <div className="flex flex-wrap gap-1">
            {dataChips(s).map((c) => (
              <span key={c} className="rounded-chip bg-surface-2 px-2 py-0.5 font-mono text-2xs text-muted">
                {c}
              </span>
            ))}
          </div>
          {state.kind === "upgrading" && (
            <div className="flex flex-col gap-1.5">
              <Pill size="sm" tone="accent" live>
                Upgrading…
              </Pill>
              <Progress value={migrationJob?.progress ?? 0} running label={`Upgrading ${project.name}`} />
            </div>
          )}
          {state.kind === "pending" && (
            <Pill size="sm" tone="neutral">
              Waiting to upgrade
            </Pill>
          )}
          {state.kind === "missing" && (
            <div className="flex flex-wrap items-center gap-2">
              <Pill size="sm" tone="danger">
                Folder not found
              </Pill>
              <Button size="sm" onClick={() => onLocate(project)}>
                Locate folder…
              </Button>
              <Button size="sm" variant="ghost" onClick={() => onRemove(project)}>
                Remove from list
              </Button>
            </div>
          )}
          {state.kind === "failed" && (
            <div className="flex flex-wrap items-center gap-2">
              <Pill size="sm" tone="danger">
                Couldn't upgrade
              </Pill>
              <Button size="sm" onClick={() => onRetry(project)}>
                Retry
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setDetails(true)}>
                Details
              </Button>
            </div>
          )}
          <div className="mt-auto flex items-center justify-between gap-2 pt-1">
            <span className="text-2xs text-muted">
              {project.last_opened_at ? `Opened ${relativeTime(project.last_opened_at, nowMs)}` : "Never opened here"}
            </span>
            {state.kind === "missing" ? null : openable ? (
              <Button size="sm" variant="primary" onClick={() => onOpen(project)}>
                Open
              </Button>
            ) : (
              <Tooltip label="It opens once the upgrade has finished.">
                <Button size="sm" variant="primary" disabled>
                  Open
                </Button>
              </Tooltip>
            )}
          </div>
        </div>
      </article>
      {details && <MigrationDetailsDialog project={project} onClose={() => setDetails(false)} />}
    </GlassPanel>
  );
}
```

The pending chip covers F §15 "Waiting for the model library": the reason is in the project's
migration flag, and Details is only offered once the upgrade has failed. A card whose folder is gone
(`availability: "missing"`) has no Open button: only Locate folder… (wired in Task 14) and Remove
from list (the same confirmation as the ⋯ menu).

- [ ] **Step 4: Rewrite the screen** (New project and Open folder arrive in Task 14)

`frontend/src/screens/ProjectsScreen.tsx`:

```tsx
import { useCallback, useEffect, useMemo, useState, type CSSProperties } from "react";
import { useNavigate } from "react-router-dom";
import type { ApiClient, Project } from "@contract/client";
import { useAgentPanel } from "@/agent/panelStore";
import { useApi } from "@/api/client";
import { messageOf, unwrap } from "@/api/errors";
import { fetchJob } from "@/api/jobs";
import { pushLog } from "@/app/diagnostics";
import { useOnJobsFinished } from "@/jobs/useOnJobsFinished";
import { useChangesStore } from "@/store/changes";
import { useJobsStore } from "@/store/jobs";
import { Alert, Button, Dialog, EmptyState, Input, Select, Skeleton, toast } from "@/ui";
import { ProjectCard } from "./projects/ProjectCard";
import { visibleProjects, type ProjectSort } from "./projects/projectCards";

export function retryMigration(api: ApiClient, folder: string) {
  return unwrap(api.POST("/api/v1/projects/migrations/retry", { body: { folder } }));
}

/** F §9.2: a card grid of the recent projects (≤ 20), with search, sort, New project and Open folder. */
export function ProjectsScreen() {
  const api = useApi();
  const navigate = useNavigate();
  const revision = useChangesStore((s) => s.projectsRevision);
  const [tick, setTick] = useState(0);
  const [loaded, setLoaded] = useState<{ items: Project[]; error: string | null } | null>(null);
  const [q, setQ] = useState("");
  const [sort, setSort] = useState<ProjectSort>("recent");
  const [removing, setRemoving] = useState<Project | null>(null);
  const [locating, setLocating] = useState<Project | null>(null);
  const [busy, setBusy] = useState(false);
  const reload = useCallback(() => setTick((t) => t + 1), []);
  useOnJobsFinished("project_migrate", reload);

  useEffect(() => {
    let cancelled = false;
    api
      .GET("/api/v1/projects")
      .then(({ data, error }) => {
        if (cancelled) return;
        setLoaded(data ? { items: data.items, error: null } : { items: [], error: messageOf(error, "could not list the projects") });
      })
      .catch((e: unknown) => {
        pushLog(`list projects failed: ${e}`);
        if (!cancelled) setLoaded({ items: [], error: String(e) });
      });
    return () => {
      cancelled = true;
    };
  }, [api, revision, tick]);

  const items = useMemo(() => loaded?.items ?? [], [loaded]);

  // Seed running migration jobs (library runner) so their progress shows and finishes are seen.
  useEffect(() => {
    for (const p of items) {
      const id = p.migration.state === "running" ? p.migration.job_id : null;
      if (id && !useJobsStore.getState().jobs[id])
        fetchJob(api, "library", id)
          .then((job) => useJobsStore.getState().upsert(job))
          .catch((e: unknown) => pushLog(`migration job ${id} unavailable: ${messageOf(e, String(e))}`));
    }
  }, [api, items]);

  const shown = useMemo(() => visibleProjects(items, q, sort), [items, q, sort]);

  const openProject = useCallback(
    (p: Project) => {
      pushLog(`open project ${p.id}`);
      void navigate(`/p/${p.id}/overview`);
    },
    [navigate],
  );

  async function retry(p: Project) {
    try {
      const job = await retryMigration(api, p.folder);
      useJobsStore.getState().upsert(job);
      toast("info", `Upgrading ${p.name} again`);
      reload();
    } catch (e) {
      toast("danger", messageOf(e, "could not start the upgrade"));
    }
  }

  async function forget(p: Project) {
    setBusy(true);
    try {
      await unwrap(api.DELETE("/api/v1/projects/{projectId}", { params: { path: { projectId: p.id } } }));
      setLoaded((s) => (s ? { ...s, items: s.items.filter((x) => x.id !== p.id) } : s));
      setRemoving(null);
    } catch (e) {
      pushLog(`forget project failed: ${messageOf(e, String(e))}`);
      toast("danger", messageOf(e, "could not remove the project from the list"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section aria-label="Projects" className="mx-auto flex max-w-7xl flex-col gap-5">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div className="flex flex-col gap-1">
          <h1 className="text-xl font-semibold">Projects</h1>
          <p className="max-w-prose text-sm text-muted">
            A project is a folder on disk. It holds the photos, maps, elevation models and point clouds of a site,
            and the findings recorded on them.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="ghost" onClick={() => useAgentPanel.getState().setOpen(true)}>
            Plan with the setup agent
          </Button>
        </div>
      </header>

      <div className="flex flex-wrap items-center gap-2">
        <Input type="search" aria-label="Search projects" placeholder="Search by name" value={q} onChange={(e) => setQ(e.target.value)} className="h-9 w-64" />
        <Select aria-label="Sort projects" value={sort} onChange={(e) => setSort(e.target.value as ProjectSort)} className="h-9 w-48">
          <option value="recent">Last opened</option>
          <option value="name">Name</option>
          <option value="findings">Open findings</option>
        </Select>
      </div>

      {loaded?.error && (
        <Alert tone="danger" actions={<Button size="sm" onClick={reload}>Retry</Button>}>
          {loaded.error}
        </Alert>
      )}

      {!loaded ? (
        <div className="grid gap-3.5 sm:grid-cols-2 xl:grid-cols-3">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-72 rounded-panel" />
          ))}
        </div>
      ) : items.length === 0 ? (
        <EmptyState icon="folder" title="No projects yet">
          Create one with New project, or open a folder that already holds a project.
        </EmptyState>
      ) : shown.length === 0 ? (
        <p className="py-6 text-sm text-muted">No project is called “{q.trim()}”.</p>
      ) : (
        <ul className="grid gap-3.5 sm:grid-cols-2 xl:grid-cols-3">
          {shown.map((p, i) => (
            <li key={p.id} className="stagger animate-rise" style={{ "--i": i } as CSSProperties}>
              <ProjectCard project={p} onOpen={openProject} onRetry={(x) => void retry(x)} onRemove={setRemoving} onLocate={setLocating} />
            </li>
          ))}
        </ul>
      )}
      <Dialog
        open={removing !== null}
        title={removing ? `Remove ${removing.name} from the list?` : ""}
        onClose={() => setRemoving(null)}
        footer={
          <>
            <Button variant="ghost" onClick={() => setRemoving(null)}>
              Keep
            </Button>
            <Button loading={busy} onClick={() => removing && void forget(removing)}>
              Remove from the list
            </Button>
          </>
        }
      >
        <p className="text-sm text-muted">
          The folder and everything in it stay on disk; Open folder brings the project back.
        </p>
      </Dialog>
    </section>
  );
}
```

- [ ] **Step 5: Run the tests**

Run: `pnpm -C frontend exec vitest run src/screens/ProjectsScreen.test.tsx src/screens/projects`
Expected: PASS (12 + 7 tests). `locating` is set but only read in Task 14 (Locate folder…); if lint
flags it as unused before then, prefix it `_` until Task 14.

- [ ] **Step 6: Lint**

Run: `pnpm -C frontend lint`
Expected: exit 0.

- [ ] **Step 7: Commit**

```bash
git add frontend/src/screens/ProjectsScreen.tsx frontend/src/screens/ProjectsScreen.test.tsx frontend/src/screens/projects/ProjectCard.tsx frontend/src/screens/projects/MigrationDetailsDialog.tsx
git commit -m "feat(projects): card grid with search, sort, live jobs and upgrade states

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

### Task 14: New project and Open folder

**Files:**
- Create: `frontend/src/screens/projects/FolderField.tsx` (moved out of today's `ProjectsScreen`),
  `frontend/src/screens/projects/catalogueTypes.ts`, `frontend/src/screens/projects/NewProjectDialog.tsx`,
  `frontend/src/screens/projects/OpenFolderDialog.tsx`
- Modify: `frontend/src/screens/ProjectsScreen.tsx`, `frontend/src/screens/ProjectsScreen.test.tsx` (append)

**Interfaces:**
- Consumes: `ProjectsScreen` (Task 13); `ProjectCreate {name, folder, type_ids}`,
  `GET /api/v1/catalogue/types`; DS `Dialog` (with `onSubmit`), `Field`, `Input`, `Checkbox`, `TypeChip`, `Alert`.
- Produces: `NewProjectDialog({onClose, onCreated})`, `OpenFolderDialog({onClose, onOpened, title?, submitLabel?})` (also "Locate folder…" for a missing project: `POST /projects/open` on the new folder; the backend replaces the stale recent entry of the same id, MG Task 7),
  `FolderField({id, label, value, onChange, hint?})`, `fetchPickableTypes(api): Promise<CatalogueType[]>`.

- [ ] **Step 1: Append the failing tests**

Add to `frontend/src/screens/ProjectsScreen.test.tsx`:

```tsx
import { errorBody, exampleProject } from "@/test/fixtures";
import { TYPE_CRACK, TYPE_SPALLING } from "@/test/findingFixtures";

const catalogue = {
  method: "GET",
  path: /\/catalogue\/types$/,
  body: {
    items: [
      { id: TYPE_SPALLING, name: "Spalling", colour: "#ff5a4f", kind: "defect", archived: false, group: "Concrete defects" },
      { id: TYPE_CRACK, name: "Crack", colour: "#ff9c3a", kind: "defect", archived: false, group: null },
      { id: "t-old", name: "Old type", colour: "#888888", kind: "object", archived: true, group: null },
    ],
  },
};

describe("ProjectsScreen: new project and open folder", () => {
  beforeEach(() => useJobsStore.setState({ jobs: {}, panelOpen: false }));

  it("locates a missing project's folder through the open-folder flow", async () => {
    const requests = renderList([missingProject], [
      { method: "POST", path: /\/projects\/open$/, body: { ...missingProject, folder: "E:\\Moved\\Yard-9", availability: "ok" } },
    ]);
    const gone = await screen.findByRole("article", { name: "Yard 9" });
    fireEvent.click(within(gone).getByRole("button", { name: "Locate folder…" }));
    const dialog = await screen.findByRole("dialog", { name: "Locate Yard 9" });
    fireEvent.change(within(dialog).getByLabelText("Folder"), { target: { value: "E:\\Moved\\Yard-9" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Use this folder" }));
    await waitFor(() => expect(requests.find((r) => r.url.endsWith("/projects/open"))?.body).toEqual({ folder: "E:\\Moved\\Yard-9" }));
    await waitFor(() => expect(screen.getByTestId("location")).toHaveTextContent("/p/p-gone/overview"));
    expect(requests.some((r) => r.method === "DELETE")).toBe(false);
  });

  it("asks for a folder instead of sending a request the backend will reject", async () => {
    const requests = renderList([], [catalogue]);
    fireEvent.click(await screen.findByRole("button", { name: "New project" }));
    const dialog = await screen.findByRole("dialog", { name: "New project" });
    fireEvent.change(within(dialog).getByLabelText("Name"), { target: { value: "Site A" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Create project" }));
    expect(await within(dialog).findByText("Choose a folder for the project.")).toBeInTheDocument();
    expect(requests.filter((r) => r.method === "POST")).toHaveLength(0);
  });

  it("creates a project with the chosen types and no kind, then opens it", async () => {
    const requests = renderList([], [catalogue, { method: "POST", path: /\/projects$/, status: 201, body: exampleProject }]);
    fireEvent.click(await screen.findByRole("button", { name: "New project" }));
    const dialog = await screen.findByRole("dialog", { name: "New project" });
    expect(within(dialog).queryByText("Old type")).toBeNull();
    fireEvent.change(within(dialog).getByLabelText("Name"), { target: { value: "Tower Q3" } });
    fireEvent.change(within(dialog).getByLabelText("Folder"), { target: { value: "E:\\Projects\\Tower-Q3" } });
    fireEvent.click(await within(dialog).findByRole("checkbox", { name: /Spalling/ }));
    fireEvent.click(within(dialog).getByRole("button", { name: "Create project" }));
    await waitFor(() =>
      expect(requests.find((r) => r.method === "POST")?.body).toEqual({
        name: "Tower Q3",
        folder: "E:\\Projects\\Tower-Q3",
        type_ids: [TYPE_SPALLING],
      }),
    );
    await waitFor(() => expect(screen.getByTestId("location")).toHaveTextContent(`/p/${exampleProject.id}/overview`));
  });

  it("still creates a project when the catalogue is unavailable", async () => {
    const requests = renderList(
      [],
      [
        { method: "GET", path: /\/catalogue\/types$/, status: 503, body: errorBody("catalogue_unavailable", "catalogue.db could not be opened") },
        { method: "POST", path: /\/projects$/, status: 201, body: exampleProject },
      ],
    );
    fireEvent.click(await screen.findByRole("button", { name: "New project" }));
    const dialog = await screen.findByRole("dialog", { name: "New project" });
    expect(await within(dialog).findByText(/The catalogue is unavailable/)).toBeInTheDocument();
    fireEvent.change(within(dialog).getByLabelText("Name"), { target: { value: "Yard" } });
    fireEvent.change(within(dialog).getByLabelText("Folder"), { target: { value: "E:/Projects/Yard" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Create project" }));
    await waitFor(() => expect(requests.find((r) => r.method === "POST")?.body).toMatchObject({ type_ids: [] }));
  });

  it("shows which field the backend rejected", async () => {
    renderList(
      [],
      [
        catalogue,
        {
          method: "POST",
          path: /\/projects$/,
          status: 422,
          body: errorBody("validation_error", "request validation failed", {
            errors: [{ loc: ["body", "folder"], msg: "folder already holds a project", type: "value_error" }],
          }),
        },
      ],
    );
    fireEvent.click(await screen.findByRole("button", { name: "New project" }));
    const dialog = await screen.findByRole("dialog", { name: "New project" });
    fireEvent.change(within(dialog).getByLabelText("Name"), { target: { value: "Site A" } });
    fireEvent.change(within(dialog).getByLabelText("Folder"), { target: { value: "E:\\Projects\\A" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Create project" }));
    expect(await within(dialog).findByText("folder: folder already holds a project")).toBeInTheDocument();
  });

  it("opens an existing folder", async () => {
    const requests = renderList([], [{ method: "POST", path: /\/projects\/open$/, body: exampleProject }]);
    fireEvent.click(await screen.findByRole("button", { name: "Open folder" }));
    const dialog = await screen.findByRole("dialog", { name: "Open a project folder" });
    fireEvent.change(within(dialog).getByLabelText("Folder"), { target: { value: "E:\\Projects\\Old" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Open project" }));
    await waitFor(() => expect(requests.find((r) => r.url.endsWith("/projects/open"))?.body).toEqual({ folder: "E:\\Projects\\Old" }));
    await waitFor(() => expect(screen.getByTestId("location")).toHaveTextContent(`/p/${exampleProject.id}/overview`));
  });
});
```

Merge the two new imports into the file's existing import lines.

- [ ] **Step 2: Run them to verify they fail**

Run: `pnpm -C frontend exec vitest run src/screens/ProjectsScreen.test.tsx`
Expected: FAIL — no button named "New project".

- [ ] **Step 3: Write the helpers and dialogs**

`frontend/src/screens/projects/catalogueTypes.ts`:

```ts
import type { ApiClient, components } from "@contract/client";
import { unwrap } from "@/api/errors";

export type CatalogueType = components["schemas"]["CatalogueType"];

/** Non-archived catalogue types, defects first, then by name (F §7.2: archived types are not offered). */
export async function fetchPickableTypes(api: ApiClient): Promise<CatalogueType[]> {
  const r = await unwrap(api.GET("/api/v1/catalogue/types"));
  return r.items
    .filter((t) => !t.archived)
    .sort((a, b) => (a.kind === b.kind ? a.name.localeCompare(b.name) : a.kind === "defect" ? -1 : 1));
}
```

`frontend/src/screens/projects/FolderField.tsx` (today's helper, unchanged in behaviour):

```tsx
import { useCallback } from "react";
import { useBackend } from "@/api/client";
import { Button, Field, Input } from "@/ui";

/** A native directory picker inside Tauri, a plain text field in the browser. */
export function FolderField({
  id,
  label,
  value,
  onChange,
  hint,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (folder: string) => void;
  hint?: string;
}) {
  const { mode } = useBackend();
  const pick = useCallback(async () => {
    const { open } = await import("@tauri-apps/plugin-dialog");
    const picked = await open({ directory: true });
    if (typeof picked === "string") onChange(picked);
  }, [onChange]);
  return (
    <Field label={label} htmlFor={id} hint={hint}>
      <div className="flex gap-2">
        <Input id={id} value={value} onChange={(e) => onChange(e.target.value)} placeholder="E:\Projects\Ahmadia" className="font-mono" />
        {mode === "tauri" && (
          <Button icon="folder" onClick={() => void pick()}>
            Browse
          </Button>
        )}
      </div>
    </Field>
  );
}
```

`frontend/src/screens/projects/NewProjectDialog.tsx`:

```tsx
import { useEffect, useMemo, useState, type FormEvent } from "react";
import type { Project } from "@contract/client";
import { useApi } from "@/api/client";
import { messageOf } from "@/api/errors";
import { pushLog } from "@/app/diagnostics";
import { Alert, Button, Checkbox, Dialog, Field, Input, TypeChip } from "@/ui";
import { fetchPickableTypes, type CatalogueType } from "./catalogueTypes";
import { FolderField } from "./FolderField";

/** F §9.2: a name, a folder and "Types to start with" (optional); there is no kind. */
export function NewProjectDialog({ onClose, onCreated }: { onClose: () => void; onCreated: (p: Project) => void }) {
  const api = useApi();
  const [name, setName] = useState("");
  const [folder, setFolder] = useState("");
  const [types, setTypes] = useState<{ items: CatalogueType[]; error: string | null } | null>(null);
  const [picked, setPicked] = useState<string[]>([]);
  const [filter, setFilter] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetchPickableTypes(api)
      .then((items) => {
        if (!cancelled) setTypes({ items, error: null });
      })
      .catch((e: unknown) => {
        pushLog(`catalogue unavailable: ${messageOf(e, String(e))}`);
        if (!cancelled) setTypes({ items: [], error: messageOf(e, "the catalogue is unavailable") });
      });
    return () => {
      cancelled = true;
    };
  }, [api]);

  const shown = useMemo(() => {
    const needle = filter.trim().toLocaleLowerCase();
    return (types?.items ?? []).filter((t) => !needle || t.name.toLocaleLowerCase().includes(needle));
  }, [types, filter]);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!name.trim()) return setError("Give the project a name.");
    if (!folder.trim()) return setError("Choose a folder for the project.");
    setBusy(true);
    setError(null);
    try {
      const { data, error: err } = await api.POST("/api/v1/projects", {
        body: { name: name.trim(), folder: folder.trim(), type_ids: picked },
      });
      if (data) onCreated(data);
      else setError(messageOf(err, "could not create the project"));
    } catch (e2) {
      pushLog(`create project failed: ${e2}`);
      setError(String(e2));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog
      open
      title="New project"
      width="lg"
      onClose={onClose}
      onSubmit={(e) => void submit(e)}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" variant="primary" icon="plus" loading={busy}>
            Create project
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <Field label="Name" htmlFor="project-name">
          <Input id="project-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Site name or campaign" />
        </Field>
        <FolderField
          id="project-folder"
          label="Folder"
          value={folder}
          onChange={setFolder}
          hint="A new or empty folder. Imported data is copied here; the originals are never touched."
        />
        <fieldset className="flex flex-col gap-2">
          <legend className="text-xs font-medium text-muted">Types to start with (optional)</legend>
          {types?.error ? (
            <p className="text-xs text-muted">
              The catalogue is unavailable, so types can be added later in Project settings. ({types.error})
            </p>
          ) : (
            <>
              <Input type="search" aria-label="Filter types" placeholder="Filter types" value={filter} onChange={(e) => setFilter(e.target.value)} className="h-8" />
              <ul className="flex max-h-56 flex-col gap-1.5 overflow-y-auto">
                {shown.map((t) => (
                  <li key={t.id}>
                    <Checkbox
                      label={<TypeChip name={t.name} colour={t.colour} kind={t.kind} />}
                      checked={picked.includes(t.id)}
                      onChange={() => setPicked((p) => (p.includes(t.id) ? p.filter((x) => x !== t.id) : [...p, t.id]))}
                    />
                  </li>
                ))}
              </ul>
              {picked.length > 0 && <p className="text-2xs text-muted">{picked.length} selected</p>}
            </>
          )}
        </fieldset>
        {error && (
          <Alert tone="danger" onDismiss={() => setError(null)}>
            {error}
          </Alert>
        )}
      </div>
    </Dialog>
  );
}
```

`frontend/src/screens/projects/OpenFolderDialog.tsx`:

```tsx
import { useState, type FormEvent } from "react";
import type { Project } from "@contract/client";
import { useApi } from "@/api/client";
import { messageOf } from "@/api/errors";
import { pushLog } from "@/app/diagnostics";
import { Alert, Button, Dialog } from "@/ui";
import { FolderField } from "./FolderField";

export function OpenFolderDialog({
  onClose,
  onOpened,
  title = "Open a project folder",
  submitLabel = "Open project",
}: {
  onClose: () => void;
  onOpened: (p: Project) => void;
  title?: string;
  submitLabel?: string;
}) {
  const api = useApi();
  const [folder, setFolder] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!folder.trim()) return setError("Choose the project folder to open.");
    setBusy(true);
    setError(null);
    try {
      const { data, error: err } = await api.POST("/api/v1/projects/open", { body: { folder: folder.trim() } });
      if (data) onOpened(data);
      else setError(messageOf(err, "could not open the folder"));
    } catch (e2) {
      pushLog(`open folder failed: ${e2}`);
      setError(String(e2));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog
      open
      title={title}
      onClose={onClose}
      onSubmit={(e) => void submit(e)}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" variant="primary" icon="folder" loading={busy}>
            {submitLabel}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        <FolderField id="open-folder" label="Folder" value={folder} onChange={setFolder} hint="A folder that holds a project.db." />
        {error && <Alert tone="danger">{error}</Alert>}
      </div>
    </Dialog>
  );
}
```

- [ ] **Step 4: Wire them into the screen**

In `frontend/src/screens/ProjectsScreen.tsx`:

1. Imports: `import { NewProjectDialog } from "./projects/NewProjectDialog";` and
   `import { OpenFolderDialog } from "./projects/OpenFolderDialog";`.
2. State, next to `removing`: `const [dialog, setDialog] = useState<"new" | "open" | null>(null);`
3. In the header's button group, after "Plan with the setup agent":
   ```tsx
   <Button icon="folder" onClick={() => setDialog("open")}>
     Open folder
   </Button>
   <Button variant="primary" icon="plus" onClick={() => setDialog("new")}>
     New project
   </Button>
   ```
4. Before the Remove `Dialog`:
   ```tsx
   {dialog === "new" && <NewProjectDialog onClose={() => setDialog(null)} onCreated={openProject} />}
   {dialog === "open" && <OpenFolderDialog onClose={() => setDialog(null)} onOpened={openProject} />}
   {locating && (
     <OpenFolderDialog
       title={`Locate ${locating.name}`}
       submitLabel="Use this folder"
       onClose={() => setLocating(null)}
       onOpened={(opened) => {
         setLocating(null);
         // Same project id: the backend replaced the stale entry. A different project: drop the stale one.
         if (opened.id !== locating.id) void forget(locating);
         reload();
         openProject(opened);
       }}
     />
   )}
   ```

The empty-list test in Task 13 still passes: "New project" now also sits in the header.

- [ ] **Step 5: Run the tests**

Run: `pnpm -C frontend exec vitest run src/screens/ProjectsScreen.test.tsx`
Expected: PASS (18 tests).

- [ ] **Step 6: Confirm no kind remains in the Projects code**

Run: `rg -n "ProjectKind|useProjectKind|Training project|Detection project|p\.kind|project\.kind" frontend/src/screens frontend/src/overview frontend/src/findings frontend/src/data`
Expected: no output.

- [ ] **Step 7: Lint**

Run: `pnpm -C frontend lint`
Expected: exit 0.

- [ ] **Step 8: Commit**

```bash
git add frontend/src/screens/projects/FolderField.tsx frontend/src/screens/projects/catalogueTypes.ts frontend/src/screens/projects/NewProjectDialog.tsx frontend/src/screens/projects/OpenFolderDialog.tsx frontend/src/screens/ProjectsScreen.tsx frontend/src/screens/ProjectsScreen.test.tsx
git commit -m "feat(projects): New project with catalogue types (no kind) and Open folder dialogs

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

### Task 15: End-to-end checks against the Prism mock

These are S1's own smoke paths; the full §16 specs (`findings.spec.ts` with a real draw, the frame
budget) belong to unit X.

**Files:**
- Modify (rewrite): `frontend/e2e/projects.spec.ts`
- Create: `frontend/e2e/project-screens.spec.ts`

**Interfaces:**
- Consumes: every screen above; `evidencePath` (`e2e/evidence.ts`). The helpers `fromMock` and
  `jsonReply` are defined locally in each spec (SH deletes `e2e/kinds.ts`, F §6.2).

- [ ] **Step 1: Rewrite the projects spec**

`frontend/e2e/projects.spec.ts`:

```ts
import { test, expect, type Page } from "@playwright/test";
import { evidencePath } from "./evidence";

const MOCK = `http://127.0.0.1:${process.env.E2E_MOCK_PORT ?? 4010}`;
// The contract's Project example, which the Prism mock serves for every project id.
const P = "7f1c2e3a-1111-4000-8000-000000000001";

const jsonReply = (body: unknown, status = 200) => ({
  status,
  contentType: "application/json",
  headers: { "Access-Control-Allow-Origin": "*" },
  body: JSON.stringify(body),
});

async function fromMock<T = Record<string, unknown>>(page: Page, path: string): Promise<T> {
  const r = await page.request.get(`${MOCK}${path}`, { headers: { Authorization: "Bearer mock" } });
  return (await r.json()) as T;
}

async function serveProjects(page: Page, items: unknown[]) {
  await page.route(
    (u) => u.pathname === "/api/v1/projects",
    (route) => (route.request().method() === "GET" ? route.fulfill(jsonReply({ items, next_cursor: null })) : route.fallback()),
  );
}

test("the projects list shows cards and creates a project without a kind", async ({ page }) => {
  const example = await fromMock(page, `/api/v1/projects/${P}`);
  await serveProjects(page, [{ ...example, migration: { state: "ok" } }]);
  await page.goto("/projects");
  await expect(page.getByRole("article").first()).toBeVisible();
  await page.screenshot({ path: evidencePath("foundation-s1", "projects-list.png"), fullPage: true });

  await page.getByRole("button", { name: "New project" }).click();
  const dialog = page.getByRole("dialog", { name: "New project" });
  await dialog.getByLabel("Name").fill("Tower Q3");
  await dialog.locator("#project-folder").fill("E:\\Projects\\Tower-Q3");
  const created = page.waitForRequest((r) => r.method() === "POST" && r.url().endsWith("/api/v1/projects"));
  await dialog.getByRole("button", { name: "Create project" }).click();
  const body = (await created).postDataJSON() as Record<string, unknown>;
  expect(body).toMatchObject({ name: "Tower Q3", folder: "E:\\Projects\\Tower-Q3" });
  expect(Array.isArray(body.type_ids)).toBe(true);
  expect(body).not.toHaveProperty("kind");
  await expect(page).toHaveURL(new RegExp(`/p/${P}/overview$`));
});

test("a project that failed to upgrade offers Retry and Details and cannot be opened", async ({ page }) => {
  const example = await fromMock(page, `/api/v1/projects/${P}`);
  await serveProjects(page, [
    { ...example, id: "p-ok", name: "Healthy", migration: { state: "ok" } },
    {
      ...example,
      id: "p-bad",
      name: "Broken",
      summary: null,
      migration: { state: "failed", error: "step catalogue_merge: disk full", backup_path: "E:\\Projects\\Broken\\backups\\project.db.v1.bak" },
    },
  ]);
  await page.goto("/projects");
  const bad = page.getByRole("article", { name: "Broken" });
  await expect(bad.getByText("Couldn't upgrade")).toBeVisible();
  await expect(bad.getByRole("button", { name: "Open" })).toBeDisabled();
  await expect(page.getByRole("article", { name: "Healthy" }).getByRole("button", { name: "Open" })).toBeEnabled();
  await bad.getByRole("button", { name: "Details" }).click();
  await expect(page.getByRole("dialog", { name: "Broken could not be upgraded" })).toContainText("disk full");
  await page.screenshot({ path: evidencePath("foundation-s1", "projects-failed-upgrade.png") });
});
```

- [ ] **Step 2: Write the project screens spec**

`frontend/e2e/project-screens.spec.ts`:

```ts
import { test, expect, type Page } from "@playwright/test";
import { evidencePath } from "./evidence";

const P = "7f1c2e3a-1111-4000-8000-000000000001";
const jsonReply = (body: unknown, status = 200) => ({
  status,
  contentType: "application/json",
  headers: { "Access-Control-Allow-Origin": "*" },
  body: JSON.stringify(body),
});

const finding = {
  id: "f0000000-9999-4000-8000-000000000217",
  number: 217,
  type_id: "t1",
  severity: 4,
  status: "open",
  note: "",
  created_by: "human",
  confidence: null,
  anchor: { kind: "image", image_id: "i1", annotation_id: "b1" },
  lon: null,
  lat: null,
  data_type: "image_set",
  data_id: "s1",
  created_at: "2026-09-14T09:00:00Z",
  updated_at: "2026-09-14T11:06:00Z",
  reviewed_at: null,
  closed_at: null,
};

async function serveFindings(page: Page) {
  const list = Array.from({ length: 60 }, (_, i) => ({ ...finding, id: `f-${i}`, number: 300 - i }));
  await page.route(
    (u) => u.pathname === `/api/v1/projects/${P}/findings`,
    (route) => route.fulfill(jsonReply({ items: [finding, ...list], next_cursor: null })),
  );
}

test("the Overview renders its blocks and a severity bar filters the Findings tab", async ({ page }) => {
  await serveFindings(page);
  await page.goto(`/p/${P}/overview`);
  await expect(page.getByText("Open findings")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Recent findings" })).toBeVisible();
  // Let the entrances finish before the evidence screenshot (ADR 2026-09-21 measuring animated drawers).
  await page.waitForFunction(() => document.getAnimations().every((a) => a.playState !== "running"));
  await page.screenshot({ path: evidencePath("foundation-s1", "overview.png"), fullPage: true });
  const bar = page.getByRole("link", { name: /: \d+ open$/ }).first();
  await bar.click();
  await expect(page).toHaveURL(new RegExp(`/p/${P}/findings\\?status=open&severity=\\d`));
  await expect(page.getByRole("radio", { name: /^Open/ })).toHaveAttribute("aria-checked", "true");
});

test("the Findings tab lists rows, opens the inspector and closes it with Esc", async ({ page }) => {
  await serveFindings(page);
  await page.goto(`/p/${P}/findings`);
  await expect(page.getByText("F-0217")).toBeVisible();
  await page.getByText("F-0217").dblclick();
  await expect(page).toHaveURL(new RegExp(`/findings/${finding.id}$`));
  await expect(page.getByText("Selected finding")).toBeVisible();
  await page.screenshot({ path: evidencePath("foundation-s1", "findings-inspector.png"), fullPage: true });
  await page.keyboard.press("Escape");
  await expect(page).toHaveURL(new RegExp(`/p/${P}/findings$`));
});

test("Add data offers five tiles and opens the map importer", async ({ page }) => {
  await page.goto(`/p/${P}/overview`);
  await page.getByRole("button", { name: "Add data" }).first().click();
  const dialog = page.getByRole("dialog", { name: "Add data" });
  for (const name of ["Photos", "Orthomosaic", "Elevation", "Point cloud"]) {
    await expect(dialog.getByRole("button", { name: new RegExp(name) })).toBeEnabled();
  }
  await expect(dialog.getByRole("button", { name: /Drawing/ })).toHaveAttribute("aria-disabled", "true");
  await page.screenshot({ path: evidencePath("foundation-s1", "add-data.png") });
  await dialog.getByRole("button", { name: /Orthomosaic/ }).click();
  await expect(page.getByRole("dialog", { name: /map/i })).toBeVisible();
});
```

The virtualisation budget (a fixed rendered-row count at 10k rows) is asserted by DS's `DataTable`
test (F §16) and the frame budget by X; these specs check the S1 paths end to end.

- [ ] **Step 3: Run the e2e suite on free ports**

Run (PowerShell, from the worktree's `frontend`):
`$env:E2E_WEB_PORT=1522; $env:E2E_MOCK_PORT=4112; pnpm e2e -- projects.spec.ts project-screens.spec.ts`
Expected: 5 passed. Screenshots land under `docs/evidence/foundation-s1/`.

- [ ] **Step 4: Run the whole e2e suite**

Run: `$env:E2E_WEB_PORT=1522; $env:E2E_MOCK_PORT=4112; pnpm e2e`
Expected: every spec passes. A spec that still opens `/p/:id` expecting Home, or uses the kind radio,
is updated to open `/p/:id/overview` and the New project dialog (record each in the ledger).

- [ ] **Step 5: Commit**

```bash
git add frontend/e2e/projects.spec.ts frontend/e2e/project-screens.spec.ts docs/evidence/foundation-s1
git commit -m "test(e2e): projects list, Overview, Findings tab and Add data smoke paths

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

### Task 16: Gate, walkthrough, merge

**Files:**
- Modify: `.superpowers/sdd/f-s1/ledger.md` (final state, reconciliations made)

- [ ] **Step 1: Rebase on the newest `main`**

Run: `git -C .claude/worktrees/f-s1 fetch; git -C .claude/worktrees/f-s1 rebase main`
Expected: clean, or conflicts only in `routes/projectRoutes.tsx` / `store/changes.ts` (keep both
sides' entries).

- [ ] **Step 2: Run the full gate** (Global Constraints). Expected: every command exits 0; `cargo
  test` is skipped with the "no frozen sidecar" message.

- [ ] **Step 3: Check the budget greps**

Run: `rg -n "limit: (FINDINGS_PAGE|FINDINGS_REFRESH_MAX|HERO_PIN_LIMIT|OVERVIEW_RECENT|OVERVIEW_ACTIVITY|DATA_LABELS_LIMIT|HISTORY_LIMIT)" frontend/src`
Expected: every list call in `findings/`, `overview/` uses a named bound; `rg -n "collectPages" frontend/src/findings frontend/src/overview` prints nothing.

- [ ] **Step 4: Merge** with `scripts\finish-task.ps1` (never `-SkipGate`). It gates, merges into
  `main`, removes the worktree the junction-safe way and deletes `task/f-s1`.

- [ ] **Step 5: Hand the operator the walkthrough**

1. Start the app (`scripts\dev.ps1`). The Projects page shows a card per recent project: cover, name,
   folder, open findings with the top-severity count, data chips, "Opened …".
2. Type part of a name in the search box; switch Sort to Name, then Open findings.
3. On a card that says "Couldn't upgrade" (if any), open Details: the error and the backup path show;
   Copy backup path copies it. Retry starts the upgrade again and the card shows "Upgrading…".
4. New project: enter a name and an empty folder, tick two types, Create. The app opens the project on
   its Overview.
5. On the Overview: four tiles count up; the map hero shows the newest map with pins (or pins on the
   backdrop); the severity bars grow in; running jobs show live progress; Recent findings and Activity
   list the latest rows.
6. Click the Critical bar: the Findings tab opens filtered to open + Critical. Change the status
   segment, a severity chip, the search; the URL follows. Clear filters.
7. Open a finding (double-click or Enter): the inspector opens on the right. Press 3 (severity Major),
   Shift+R (Reviewed), T (type picker). Type a note, wait a moment: "Saved". Add a photo, reply to the
   thread with Enter. Esc closes the inspector.
8. Tick three rows: the bulk bar appears; Set status → Closed closes them all.
9. Top bar → Add data: five tiles, Drawing disabled with its tooltip. Pick Orthomosaic, choose a
   GeoTIFF, Import: the dialog closes, a toast says the import started, the job shows in Jobs.
10. Settings → Reduce motion, back to the Overview: tiles show final values at once and nothing slides.

- [ ] **Step 6: Commit the ledger**

```bash
git add .superpowers/sdd/f-s1/ledger.md
git commit -m "docs(sdd): f-s1 ledger final state

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

## Self-review

**Spec coverage (F §18 S1 and the sections it points to):**

| Requirement | Task |
|---|---|
| §9.2 card grid: cover, name, folder mono, open findings + top-severity `SeverityPill`, data chips, last opened, `StatusDot` live, migration badge | 12, 13 |
| §9.2 toolbar: search, sort (last opened, name, open findings), New project, Open folder | 13, 14 |
| §9.2 New project: name, folder, "Types to start with" (catalogue multi-select), no kind | 14 |
| §9.2 migration: not-ok not openable; "Upgrading…" with progress; "Couldn't upgrade" with Retry, Reveal backup, Details; per-project isolation | 12, 13 (Reveal → ambiguity 8) |
| §9.1 Overview: four KPIs with delta, sparkline, chips, volume or Reviewed %; map hero with pins ≤ 300, locked, legend, scale, no-map backdrop, empty state; severity bars with stagger and links; running jobs + newest Done; recent findings (5) with View all; activity (8); banners incl. adoption; one pre-aggregated endpoint | 9, 10, 11 |
| §4.3 the Auto probe on the first Overview render | 11 (`runAutoProbe`) |
| §6.4 Add data: five tiles, each opening today's importer; Drawing disabled with tooltip; closes when the job is queued; opened from top bar, Overview, palette, empty states | 8, 10 |
| §6.4 `surfaces/ImportElevationDialog.tsx` extracted, "Build from a point cloud" link | 8 |
| §8.6 filter bar (status Segmented with counts, severity toggles incl. None, type multi-select, source kind, search, Clear), virtualised table with the eight columns, selection + floating bulk bar (status, severity, Clear), keys J/K/↑/↓/Enter (DataTable), 1–9, T, Shift+O/R/C, Esc; inspector route with table interactive; filters and sort in the URL | 4, 7 |
| §8.7 `FindingInspector` props and the ten sections; `anchorSlot` default "Open in workspace"; `findingHref` the one builder | 2, 5, 6 |
| §5.1 AdoptionBanner moved to the Overview banner area; Home deleted (§5.3) | 11 |
| §14 Budget (paged findings, pre-aggregated overview, pins ≤ 300, bulk ≤ 1000) | 3, 7, 10, 11, 16 |
| §16 vitest: FindingsScreen filters ↔ URL, FindingInspector autosave and transitions, ProjectsScreen migration states, OverviewScreen empty and full | 4, 5, 6, 11, 13 |

No S1 requirement is left without a task. Out of S1 by design: the `?finding=` arrival in the
Images/Maps/Clouds workspaces (I, M, C), the Command palette itself and the top bar (SH), the full
§16 e2e specs and the frame budget (X).

**Placeholder scan:** no "TBD", "TODO" or "similar to Task N"; every code step carries its code. The
places that depend on names not yet merged are routed through Task 0's ledger with the spec names
written out in full.

**Type consistency:** `findingHref(projectId, finding)` / `findingPath(projectId, findingId)` (Task
2) are used with that argument order in Tasks 5, 10 and 11; `FindingFilters.typeIds`/`source` map to
the URL/API names `type_id`/`anchor_kind` only inside `filters.ts`; `useChangesStore.bumpFindings`
(Task 1) is the one post-write signal in Tasks 5, 6, 7; `openAddData(tile?)` (Task 8, over SH's
`useAddData`) is called in Task 10; `Kpi.delta.label` (Task 9) is passed to `StatTile.delta` (Task 11, flagged in the
consumed-interfaces table); `HERO_PIN_LIMIT` lives in `heroPins.ts` (Task 9) and is read by Task 10.

**Review Focus:** each of the five lines has its test in the owning task (6, 7, 9, 3, 12/13).

