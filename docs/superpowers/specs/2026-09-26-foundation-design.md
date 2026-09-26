---
type: spec
date: 2026-09-26
status: draft
tags: [spec, foundation, design-system, shell, catalogue, findings, models, migration, inspection-platform]
related: ["[[2026-09-26-inspection-platform-design]]", "[[2026-09-23-train-detect-split-and-model-library-design]]", "[[2026-09-21-contour-ui-design]]", "[[2026-09-23-point-clouds-design]]"]
---

# Foundation (sub-project F)

Sub-project F of the inspection platform programme (`2026-09-26-inspection-platform-design.md`,
"the umbrella"). The umbrella's decisions D1–D11 and its §3 domain model are binding here. Names
used below (Project, Data item, Catalogue type, Severity scale, Annotation, Finding, Detection,
Measurement, Model, Dataset) mean exactly what the umbrella says they mean.

## 1. Goal

F lays the ground that I (images), M (maps), C (point clouds) and R (reports) build on in parallel.
When F is merged:

1. The app looks and moves like the approved **Aero glass** mockup (umbrella D9). Every screen is
   built from rewritten `frontend/src/ui/` primitives, and `check-tokens` enforces them.
2. The shell has a five-entry rail (Projects, Models, Catalogue, Jobs, Settings), a top bar with a
   Ctrl K command palette, and the seven project tabs.
3. A project has **no kind**. Everything a project can hold is listed by one Data endpoint and
   added through one "Add data" flow.
4. The **Catalogue** and **severity scale** exist app-wide. Projects choose their types from it,
   and model classes map onto it.
5. **Findings** exist as one entity with an API, a virtualised Findings tab and a shared inspector
   component. The workspaces in I, M and C only have to create them.
6. The **Models** section holds the library, datasets built across projects, and training.
7. Every existing project is **migrated** on first start, copy-first. A failure skips and flags
   that project, and the app still opens.
8. A project opens on an **Overview** dashboard, and the Projects list is redesigned. A **Jobs**
   section lists every job in the app.

## 2. Scope

**In:** everything in §4–§12.

**Out, owned by a later sub-project (umbrella §5):**

| Deferred item | Owner |
|---|---|
| Images workspace (grid ⇄ capture map, canvas tools, polygon and smart polygon, GSD length), batch AI detect UI, suggestion review, YOLO-seg dataset export and training | I |
| Map workspace, drawings (table, import, georeferencing), 2D measure, compare, map findings created from the map, detections layer, the survey timeline in the workspace | M |
| Cloud workspace, 3D pinned findings, area and cross-section, camera positions | C |
| Report builder, templates, PDF job; the "Generate report" action does more than open the Reports tab | R |
| The unified **Measurements** list endpoint `GET /projects/{id}/measurements` (union of cloud, volume and map measurements) | **M owns it** (the endpoint and its cloud, volume and map providers, M §12). C adds only its new cloud kinds (`area`, `profile`) to the cloud provider's headline mapping (C §12). F gives the tab an interim host (§5.3) |
| Accepting **map** detections as findings | M. F implements the rule for image boxes only (§8.5), because image review exists today. Cloud detections do not exist (3D AI is deferred, C §19) |
| Merging two catalogue types into one | later. It rewrites ids in every project |
| Several operators, authentication, sync | not planned (single user) |

**Depends on:** `task/model-gsd` is merged into `main` (commit `9a3175b`), so umbrella risk 1 is
closed for F's start. F cuts from the newest `main` and rebases before each merge.

## 3. Decisions

These are F-level decisions that the umbrella leaves open.

| # | Question | Decision | Why |
|---|---|---|---|
| F1 | Where do the catalogue and severity scale live? | Their own `catalogue.db` in `%APPDATA%\kestrel-ai\library\` next to `library.db`, with its own Alembic history. `catalogue_root()` is the one function that knows the path. | It follows the umbrella ("next to library.db"). A corrupt library must not take the catalogue down, and the reverse. |
| F2 | Can a project render without the catalogue? | Yes. Each project keeps a **snapshot** of the types it uses (`project_type`: name, colour, kind, hotkey), refreshed on open and whenever the catalogue changes. | A catalogue that fails to open, or a project copied from another machine, still renders its annotations and findings. |
| F3 | What does an annotation's class id point to? | The **catalogue type id**. Migration rewrites old per-project class ids (§11.4). | Umbrella §3: an annotation has a catalogue type, and `Finding.type_id` is a catalogue id. One id space avoids a second mapping table on every hot path. |
| F4 | Kind of a migrated type | **`object`** by default. The Catalogue asks once to classify the migrated types. Switching a type to `defect` offers a **findings backfill** job that applies D6's rule ("accepted boxes become findings, Reviewed, no severity") to that type's accepted annotations in every known project. | Every existing project is construction-machinery detection, where the types are objects. Marking them defects would turn thousands of excavators into findings, against D7. The rule in D6 still runs, and the operator decides which types it runs on. **Flagged for operator confirmation.** |
| F5 | `kind` in the API | **Removed** from the contract in the same change (`Project.kind`, `ProjectCreate.kind`, `ProjectKind`, `WrongProjectKind`). There is no deprecation window. | The only client is this frontend, and it changes in the same merge. The umbrella allows the deprecated field "only if the contract needs it", and it does not. |
| F6 | The annotation table | Today's `box` table **is** the annotation store (`box.id` is the `annotation_id`). F does not rename it. I adds polygon geometry to it. | Renaming touches every image code path, and I rewrites those anyway. |
| F7 | Glass cost | `backdrop-filter` only in `GlassPanel variant="float"` over imagery. Dashboard cards and list panes are translucent **without** blur. Blur over a smooth gradient backdrop looks the same and costs GPU. | Umbrella §8 (performance on a laptop). |
| F8 | Migration trigger | The backup and schema upgrade happen inside `open_project_db`, before Alembic runs, so every path that opens a project is copy-first. The data steps run as a `project_migrate` **job in the library runner**, submitted at startup for every recent project and on open for any other project. | The app opens at once. Migration progress shows in Jobs. The copy is taken before anything else can touch the database. |
| F9 | Where do cross-project datasets and training live? | In `library.db` (new tables), run by the library job runner. Built exports go to `library\datasets\<slug>-<id8>\`. | Models is an app-level section (D8). The library already has a runner and handle (ADR `2026-09-23-library-jobs-reuse-the-project-jobrunner`). |
| F10 | Model class map | It moves from per project (`model_class_map`) to **app-wide**, as `library_model.class_map` {model class name → catalogue type id \| null}. | With one catalogue there is one right answer per model. The per-project table stays read-only for one release. |

## 4. Aero glass design system

### 4.1 Tokens (`frontend/src/index.css`, exposed in `frontend/tailwind.config.ts`)

The Contour palette in `index.css` (`--ground`, `--side`, `--panel`, amber `--accent` …) is
**replaced**. Values come from theme `.tD` in
`.superpowers/brainstorm/1481982-1790403567/content/visual-directions.html`.

Opaque colours stay as RGB triplets (`rgb(var(--x) / <alpha-value>)`), so opacity modifiers keep
working. Translucent surfaces are complete `rgba()` values and are used without modifiers.

| Token | Value | Use |
|---|---|---|
| `--backdrop` | `radial-gradient(1200px 600px at 80% -10%, #3b2a7a 0%, transparent 60%), radial-gradient(900px 500px at -10% 110%, #0f5b66 0%, transparent 55%), #0e0f1c` | the app background on `body`, painted once and fixed |
| `--bg` | `14 15 28` (#0e0f1c) | the solid base; the canvas behind imagery; reduced-effects fallback |
| `--surface` | `rgba(255,255,255,.055)` | cards, panes (mockup `--panel`) |
| `--surface-2` | `rgba(255,255,255,.08)` | wells, tracks, neutral chips (`--well`) |
| `--field` | `rgba(255,255,255,.06)` | inputs, segmented tracks |
| `--hover` | `rgba(255,255,255,.05)` | row and entry hover |
| `--rail` | `rgba(255,255,255,.03)` | the icon rail |
| `--glass` / `--glass-line` / `--glass-ink` | `rgba(14,15,28,.55)` / `rgba(255,255,255,.14)` / `#f2f1fb` | floating panels over imagery |
| `--line` / `--line-strong` / `--card-line` | `rgba(255,255,255,.08)` / `.2` / `.09` | separators and borders |
| `--ink` / `--muted` / `--dim` | `242 241 251` / `167 166 196` / `110 109 142` | text |
| `--accent` / `--accent-ink` / `--accent-fg` | `143 123 255` / `201 191 255` / `255 255 255` | focus, the active state, links |
| `--accent-soft` | `rgba(143,123,255,.18)` | the active rail entry, selected rows |
| `--ok` / `--ok-soft` | `95 227 192` / `rgba(95,227,192,.18)` | success, done |
| `--danger` / `--danger-soft` | `255 138 160` / `rgba(255,138,160,.15)` | errors, destructive actions, the defect tag |
| `--warn` / `--warn-soft` | `255 196 107` / `rgba(255,196,107,.15)` | warnings (**new**, not in the mockup; checked by the contrast test) |
| `--info` | `138 164 255` | the `reviewed` status, the object tag |
| `--tip` / `--tip-fg` | `#1b1a33` / `#fff` | tooltips, palette, menus |

**Gradients:** `--grad-primary: linear-gradient(135deg,#9d8bff,#6a8dff)` (primary buttons),
`--grad-brand: linear-gradient(135deg,#9d8bff,#5fe3c0)` (the logo tile),
`--grad-ink: linear-gradient(90deg,#9d8bff,#5fe3c0)` (the tab indicator),
`--grad-ai: linear-gradient(135deg,rgba(143,123,255,.16),rgba(95,227,192,.08))` (AI provenance).

**Severity defaults** (app data, not tokens, §7): 1 Minor `#3fb68e`, 2 Moderate `#e2bf2e`,
3 Major `#ff9c3a`, 4 Critical `#ff5a4f`. **Status:** open `--accent`, reviewed `--info`,
closed `--ok`.

**Radii:** `--r-panel: 16px`, `--r-control: 10px`, `--r-chip: 999px`, `--r-sm: 6px` (thumbnails,
kbd). Tailwind: `rounded-panel`, `rounded-control`, `rounded-chip`, `rounded-sm`.

**Blur:** `--blur-sm: 8px`, `--blur-md: 12px`, `--blur-lg: 18px`. Only `GlassPanel` and `Dialog`
may use them (F7).

**Elevation:** `--elev-1: inset 0 1px 0 rgba(255,255,255,.08), 0 10px 30px rgba(0,0,0,.25)` (card),
`--elev-2: inset 0 1px 0 rgba(255,255,255,.12), 0 20px 50px rgba(20,10,60,.5)` (card hover,
popover), `--glow-primary: 0 8px 26px rgba(143,123,255,.45)`.

**Typography:** `Space Grotesk` for UI and display, `JetBrains Mono` for ids, figures, kbd,
coordinates and file names. Both are **bundled** as `@fontsource-variable/space-grotesk` and
`@fontsource-variable/jetbrains-mono`, imported in `index.css`, and they replace
`@fontsource-variable/instrument-sans`. No Google Fonts; the CSP in
`frontend/src-tauri/tauri.conf.json` (`default-src 'self'`) would block them anyway. The scale:

| Step | Size / line / weight | Use |
|---|---|---|
| `text-2xs` | 10.5 / 14 / 500 | chip counts, meta |
| `text-xs` | 11.5 / 16 / 500 | labels (`.lbl`) |
| `text-sm` | 12.5 / 18 / 400 | body, table rows |
| `text-base` | 13.5 / 20 / 400 | forms |
| `text-lg` | 16 / 22 / 600 | card and section titles |
| `text-xl` | 20 / 26 / 600 | page titles |
| `text-kpi` | 30 / 33 / 600, tracking −0.02em, tabular | StatTile values |

Figures always use `tabular-nums`.

### 4.2 Motion tokens

These are CSS custom properties, with the same names exported from `frontend/src/ui/motion.ts` for
JavaScript animation (count-up, the tab indicator).

| Token | Value | Use |
|---|---|---|
| `--dur-instant` | 0ms | keyboard-driven selection, the rail |
| `--dur-fast` | 120ms | hover, press, colour |
| `--dur-base` | 180ms | reveals, page transition, tooltip |
| `--dur-slow` | 260ms | drawers, inspector, dialog |
| `--dur-emphasis` | 350ms | tab indicator, segmented thumb, severity bar fill |
| `--dur-count` | 600ms | StatTile count-up, sparkline draw (decorative, never blocks input) |
| `--ease-out` | `cubic-bezier(.2,.8,.2,1)` | the default (mockup `--ease`) |
| `--ease-spring` | `cubic-bezier(.3,1.6,.5,1)` | pin and badge pop only |
| `--ease-in-out` | `cubic-bezier(.65,0,.35,1)` | the page cross-fade |
| `--stagger-step` / `--stagger-max` | 40ms / 8 items | list and card entrances; item 9 onward appears with item 8 |

Rules:

- Motion animates only `transform` and `opacity`.
- No interaction path waits for motion. Nothing on an interaction path runs longer than 400ms
  (umbrella §8).
- Looping animations (live dot, progress shimmer, pin pulse) run only while real work runs. A
  finite pulse (at most 3 cycles) on create or select is allowed; an indefinite pulse on static
  data (for example "critical pins pulse") is not.
- The mockup's map "scan" sweep is **not** adopted. It is a decorative loop, and the ADR
  `2026-09-26-gotcha-swiftshader-compositing` shows what repaint loops cost.

**`prefers-reduced-motion: reduce`**, and the Settings override "Reduce motion":

- Every `--dur-*` except `--dur-fast` becomes 0ms, and stagger becomes 0.
- Count-up shows the final value, sparklines draw at once, and the tab indicator jumps.
- Loops stop. Live dots are static and the shimmer is off.

A `useReducedMotion()` hook in `ui/motion.ts` feeds the JavaScript animations.

### 4.3 Reduced-effects mode

`<html data-effects="full|reduced">`, set by `frontend/src/app/effects.ts`:

- **Reduced:**
  - `GlassPanel` and `Dialog` drop `backdrop-filter` and use an opaque `--glass-solid: #16172a`.
  - `--backdrop` becomes the flat `--bg` plus one static radial gradient.
  - Shadows keep `--elev-1` and lose the glows.
  - Motion is not changed; that is a separate setting.
- **Choice:** Settings → Appearance → Visual effects: **Auto** (the default) · Full · Reduced.
  It is stored in `localStorage` (`kestrel.effects`), with every access wrapped in try/catch.
- **Auto:**
  1. It starts `full`, unless the WebGL renderer string names SwiftShader or "Basic Render".
  2. On the first Overview render, a 2-second `requestAnimationFrame` probe measures frame times.
  3. If p95 exceeds 24ms, it switches to `reduced` and shows one toast: "Visual effects reduced
     for smoother performance · Undo".

### 4.4 Primitives (`frontend/src/ui/`)

**Rewritten in place** (API kept wherever callers allow, so screens do not churn):

- `Button`: variants `primary` (gradient + glow), `secondary`, `ghost`, `danger`.
- `IconButton`, `Input`/`Select`/`Textarea`, `Checkbox`, `Switch`, `Field`.
- `Pill` (tones follow the new tokens), `Alert`, `Toaster`, `Progress` (shimmer only while running).
- `Skeleton`, `EmptyState`.
- `Segmented`: gets a sliding thumb.
- `Kbd` (mono), `Dialog` (a glass panel, 260ms), `Tooltip` (gains a `shortcut` prop that renders
  `Kbd`), `Disclosure`.
- `Icon`: adds `catalogue`, `jobs`, `findings`, `measure`, `report`, `overview`, `pin`, `sparkle`,
  `layers`, `drawing`, `elevation`.
- `tokens.ts`: `focusRing` uses `ring-accent` with `ring-offset-bg`, and `transition` uses the
  motion tokens.

**New:**

| Component | File | Contract |
|---|---|---|
| `GlassPanel` | `GlassPanel.tsx` | `variant: "pane" \| "float"`; `pane` = `--surface` + `--card-line` + `--elev-1`, `rounded-panel`, no blur; `float` = `--glass` + `blur(--blur-md)`; `interactive` adds the hover lift (translateY −2px, `--elev-2`) |
| `FloatingToolbar`, `ToolButton` | `FloatingToolbar.tsx` | a vertical or horizontal glass group; `ToolButton {icon, label, shortcut, active, onClick}` shows a tooltip "Box · B". A `useToolShortcuts(tools)` hook binds the keys while the toolbar is mounted and ignores keys typed into inputs |
| `StatTile` | `StatTile.tsx` | `{label, value, unit?, delta?: {value, good: "up"\|"down"}, tone?, spark?: number[], chips?}`; count-up via `useCountUp(value)` over `--dur-count`, and only on first mount or when the value changes |
| `Sparkline` | `Sparkline.tsx` | an SVG line + area, `values: number[]` (≤ 60), stroke `--accent`; draw-in animation |
| `SeverityPill`, `SeverityPicker` | `Severity.tsx` | reads the scale from `useSeverityScale()` (§7); `level: number \| null`, and null renders "No severity"; the picker is the 4-up segmented grid from `ws-images.html` `.sevseg`, keyed 1–9 |
| `StatusDot` | `StatusDot.tsx` | `status: open\|reviewed\|closed\|running\|failed`; `live` pulses only when `running` |
| `TypeChip` | `TypeChip.tsx` | colour square + name + Defect/Object tag |
| `Tabs` | `Tabs.tsx` | `role="tablist"`, roving focus, an optional `count` badge in mono, a sliding `--grad-ink` indicator measured from the active tab (`--dur-emphasis`); `asLinks` mode renders `NavLink`s |
| `CommandPalette` | `CommandPalette.tsx` | a glass dialog with a combobox and listbox; `groups: {label, items: Command[]}[]`, where `Command {id, title, hint?, icon?, shortcut?, run}`; async search sources are debounced 120ms; ↑↓ Enter Esc |
| `InspectorLayout`, `InspectorSection` | `Inspector.tsx` | a right pane 340px wide (stacked under the content below 1100px); `header`, scrolling `sections` with a staggered rise, a sticky `footer` |
| `DataTable` | `DataTable.tsx` | columns `{key, header, width, render, sortable}`; fixed 44px rows virtualised with `useVirtualRows` (moved from `frontend/src/data/useVirtualRows.ts` to `ui/`); sticky header; selection with a checkbox column and shift-range; `onEndReached` for cursor paging; ↑↓ J K Enter; a `SkeletonRows` loading state; never blurred |
| `Menu` | `Menu.tsx` | a popover list for "Add data", row actions and overflow tabs |
| `Popover` | `Popover.tsx` | an anchored glass `float` panel (focus-trapped, Esc closes, returns focus); `Menu` is built on it. Used by the M and C pickers and popovers |
| `Slider` | `Slider.tsx` | `{min, max, step?, stops?: number[], value, onChange, format?}`; continuous or snapping to discrete `stops`; arrow keys step, value in mono. Used for opacity, blend, point size and point budget (M, C) |
| `Combobox` | `Combobox.tsx` | a filterable single-select over `{id, label, icon?, hint?}` items, the listbox pattern of `CommandPalette`; used by the type pickers of I, M and C (catalogue type `hotkey`s are live inside it, §5.6) |

### 4.5 `DESIGN.md` and `check-tokens`

`DESIGN.md` is rewritten as "Design system: Aero glass". Its sections are:

- Colour
- Typography
- Radii and elevation
- Glass and blur rules
- Motion (the tokens and reduced motion)
- Reduced effects
- Shell
- Workspaces (full-bleed with floating glass, for I, M and C)
- Data visualisation (StatTile, Sparkline, severity bars)
- App identity (the Kestrel mark on `--grad-brand`)
- Copy
- Budgets

The Contour text is removed. `AGENTS.md` item 3 ("the Site office system") is updated to point at
Aero glass in the same change.

`frontend/scripts/check-tokens.mjs` keeps its raw-palette rule and adds these. Each rule exempts
`src/ui/**`.

| Rule | Why |
|---|---|
| no arbitrary colours: `(bg\|text\|border\|ring\|fill\|stroke\|from\|to\|via)-\[#` and `rgba(` in `className` | tokens only |
| no `backdrop-blur` or `backdrop-filter` | F7: blur lives in GlassPanel |
| no `duration-\d+`, `ease-\[`, `delay-\d+` | motion tokens only |
| no `rounded-\[`, `font-\[`, `shadow-\[` | radii, type and elevation tokens |
| no retired Contour names (`ground`, `side`, `panel`, `well`, `canvas`, `accent-line`, `warn-strong`, `inverse`) | catches missed migrations |

Colours that come from data (severity, type colours) pass through a `--c` custom property on a
`style` prop. That is the one inline colour allowed. `ui/contrast.test.ts` is rewritten to
composite each translucent surface over `--bg` before measuring 4.5:1 for text and 3:1 for
control boundaries.

## 5. App shell

### 5.1 Structure

`frontend/src/app/Shell.tsx` is rewritten as a grid of the 64px `Rail`, then a main column of
`TopBar`, optional `ProjectTabs`, and a `<main>` holding `PageTransition` → `<Outlet/>`.
`AgentDrawer` and `Toaster` stay.

| Today | After F |
|---|---|
| `app/Sidebar.tsx` (kind-specific steps, 82/224px) | **deleted**; `app/Rail.tsx`: logo tile, Projects, Models, Catalogue, Jobs, spacer, Settings. Tooltips on the right; the active entry is `--accent-soft` with the 3px gradient bar (mockup `.rail a.on::before`) |
| `app/Header.tsx` (breadcrumb, RunningPill, agent button, JobsButton) | **replaced** by `app/TopBar.tsx`: breadcrumb (`Projects / ● Name / Tab`, where the dot is `StatusDot`: green when idle, live when a job runs), a search field that opens the palette (Ctrl K), context actions from `useRouteActions()`, the agent button (IconButton "Project agent" / "Setup agent"), and the RunningPill that links to `/jobs?project=` |
| `app/NextStepBar.tsx`, `pipeline.ts`, `nextStep.ts`, `projectNextStep.ts`, `useProjectProgress.ts` | **deleted**; the step pipeline goes with the split. Overview empty states say what to add first |
| `app/KindRoute.tsx`, `app/useProjectKind.ts` (+ tests) | **deleted** (§6) |
| `jobs/JobsPanel.tsx`, `jobs/JobsButton.tsx` (header drawer) | **deleted**; the Jobs section replaces them. `JobCard`, `JobLogView`, `useJobLog` and `jobLabels` are reused |
| `app/AdoptionBanner.tsx` | moved into the Overview banner area (`overview/Banners.tsx`) with migration warnings |
| `app/Brand.tsx` | the logo tile on `--grad-brand`, 12px radius |

**Context actions by route:**

- Project routes: **Add data** and **Generate report** (primary; it opens the Reports tab until R).
- Findings tab: **New finding** is disabled with a tooltip saying findings are created in a
  workspace.
- Catalogue: **New type**.
- Models → Datasets: **New dataset**. Models → Library: **Import model**.

### 5.2 Project tabs

`app/ProjectTabs.tsx` uses `Tabs asLinks`: Overview, Images (count), Maps (count),
Point clouds (count), Findings (open count), Measurements, Reports. Counts come from the Overview
summary (§9). The tabs hide on the full-bleed work surfaces (the Maps and Point clouds workspaces),
where the top bar breadcrumb carries the tab name. The Images workspace is not full-bleed and keeps
them (I §6).

### 5.3 Route map (`frontend/src/routes.tsx`)

| Route | Screen (after F) | Replaces |
|---|---|---|
| `/` | redirect → `/projects` | `ProjectsScreen` at index |
| `/projects` | `screens/ProjectsScreen.tsx` (rewritten, §9.2) | |
| `/p/:projectId` | redirect → `overview` | `HomeScreen` (deleted) |
| `/p/:projectId/overview` | `overview/OverviewScreen.tsx` | |
| `/p/:projectId/images` | interim: `DataManagerScreen` (restyled) | `/data` |
| `/p/:projectId/images/:imageId` | interim: `EditorScreen` | `/edit/:imageId` |
| `/p/:projectId/maps` | interim: `maps/MapDataList.tsx` (Data list filtered to map, elevation and drawing) | `/sources` for maps, `/maps` |
| `/p/:projectId/maps/:mapId` | `MapsScreen` (unchanged, until M) | |
| `/p/:projectId/clouds`, `/clouds/:cloudId` | `CloudsScreen` (unchanged); **the 3D jump contract `?at=x,y[&fp=…]` keeps its exact shape** | |
| `/p/:projectId/findings`, `/findings/:findingId` | `findings/FindingsScreen.tsx` | |
| `/p/:projectId/measurements`, `/measurements/:measurementId` | interim: `VolumesScreen` | `/volumes…` (redirects kept) |
| `/p/:projectId/reports` | `reports/ReportsPlaceholder.tsx`, an EmptyState | |
| `/p/:projectId/settings` | `SettingsScreen` + the project type list (§7.3) | |
| `/p/:projectId/runs`, `/review`, `/analytics`, `/site-areas`, `/query`, `/export` | **kept as secondary routes**, no tab. Reachable from the Images and Maps tab overflow `Menu` and from the palette. I and M decide their fate | |
| `/models` → `/models/library` | `library/LibraryScreen` inside `models/ModelsLayout.tsx` (sub-tabs Library · Datasets · Training) | `/library` (redirect) |
| `/models/datasets`, `/models/datasets/:datasetId` | `models/DatasetsScreen.tsx`, `models/DatasetBuilder.tsx` | `/p/:id/datasets` |
| `/models/training`, `/models/training/:runId` | `models/TrainingScreen.tsx` | `/p/:id/train` |
| `/catalogue`, `/catalogue/severity` | `catalogue/CatalogueScreen.tsx` | |
| `/jobs` | `jobs/JobsScreen.tsx` | the header drawer |
| `/settings`, `/about` | unchanged screens, restyled; Settings gains Appearance (§4.3) and "Your name" (used on comments) | |

**Redirects** keep old links working:

- `/p/:id/data` → `images`; `/edit/:imageId` → `images/:imageId`.
- `/label` → `images?filter=unlabeled`; `LabelResolverScreen`'s "first unlabeled image" becomes the
  Images tab's **Label next** action.
- `/past`, `/past/maps/:mapId` → `overview` and `maps/:mapId`.
- `/sources` → `maps`; `/surveys` → `analytics` (as today).
- `/datasets` → `/models/datasets?project=:id`; `/train` → `/models/training`;
  `/library` → `/models/library`.

### 5.4 Command palette

`app/commands.ts` is a registry that screens add to with `useCommands(commands)`, removed on
unmount. Groups:

1. **Go to:** the rail entries, project tabs, recent projects (from `GET /projects`).
2. **Actions:** the route's context actions, Add data (and each importer), New project, Toggle
   reduced effects.
3. **Search** (inside a project, query ≥ 2 characters): `GET /projects/{id}/search` (§10), shown
   as Findings (F-number, type, note excerpt) and Data (label, type).
   Measurements join when M's union endpoint `GET /measurements` exists.

Ctrl K opens it from anywhere, including work surfaces, and Esc returns focus to the opener.

### 5.5 Page transitions

`app/PageTransition.tsx` keys on the first two path segments after the project, so a tab change
animates and a change within a tab (a `findingId`) does not. The entrance is opacity 0→1 plus
translateY 6px→0 over `--dur-base` `--ease-out`, with no exit animation, so input is never
blocked. Cards and rows inside use the stagger. Full-bleed work surfaces cross-fade only.

### 5.6 Keyboard map (app-wide, binding on I, M and C)

There is **one** keymap. `frontend/src/ui/keymap.ts` holds the global and review entries below as
data (`{keys, scope, action, help}`), plus `isTypingTarget` (moved here from `editor/hotkeys.ts`,
which I deletes; I, M and C import it from `ui/keymap.ts`). Each workspace registers its tool keys
into the same table through `useToolShortcuts`. A vitest walks the merged table and fails when a
workspace tool key equals a global or review key, or when two entries share a key within one scope.
The **?** sheet and the status-bar/hint-bar key hints render from this table.

Keys never fire while focus is in a text field (`isTypingTarget`). Letter keys are case-insensitive
and fire without modifiers unless a modifier is shown.

**Global keys** (the same meaning everywhere, never re-bound by a workspace):

| Keys | Action |
|---|---|
| Ctrl+K | command palette (§5.4) |
| ? | shortcut sheet for the current screen |
| Esc | cancel the draft or active tool; a second Esc deselects (and in C returns to Orbit) |
| Enter | commit the draft / save the tool's result |
| Backspace | remove the last vertex while drawing |
| Del | delete the selection (confirming when a finding with content goes too) |
| Ctrl+Z · Ctrl+Y | undo · redo (while drawing, Ctrl+Z removes the last vertex) |
| Space (held) | temporary pan from any tool |
| V · H | Select tool (Orbit in C) · Pan tool |
| F | fit: the image (I), the site extent (M), the whole cloud (C) |
| + · − | zoom in · out |

**Review keys** (the same in every workspace and in the Findings tab; live whenever a finding, a
pending suggestion or a pending detection is selected or focused):

| Keys | Action |
|---|---|
| A · X | accept · reject the focused suggestion/detection (else the top one) |
| Shift+A · Shift+X | accept · reject all visible pending items, confirming above 20 |
| 1–9 | set the severity level on the selected finding (default scale 1–4; digits beyond the scale are ignored). On a pending item digits do nothing, so **A, 3** is accept-and-grade |
| T | type picker (`Combobox`) for the selection or the active draw type; catalogue `hotkey`s are live **only inside this picker** (§7.2) |
| Tab · Shift+Tab | next · previous pending item (then, in I, the next image with suggestions) |

**Workspace tool keys** (each workspace owns only these; none equals a global or review key):

| Workspace | Keys |
|---|---|
| I (Images) | B box · R rotated box · P polygon · S smart polygon · M point marker · L measure length · D AI detect · G suggestions toggle · Shift+H annotations toggle · N nothing to report · C focus comment · ← → image · Shift+← → rotate rbox · Alt+arrows nudge · 0 fit (alias of F) · Ctrl+1 1:1 · Ctrl+D duplicate · [ ] threshold · Ctrl+[ Ctrl+] toggle browser / inspector pane · Shift+M grid ⇄ map (I §13) |
| M (Maps) | L distance · Q area · E elevation profile · U volume · M finding point · G finding polygon · Z zone · K align drawing · D AI detect region · [ ] previous/next survey · P play · C cycle compare mode · Shift+N north up (M §5.1) |
| C (Point clouds) | O orbit (alias of V) · W fly · P point · L distance · Z height · U verticality · Q area · E cross-section · C clipping box · M pin finding · I photo link · N next ring (rings method) · Alt+1…Alt+4 top/front/side/iso view (C §6) |

Shared meanings across workspaces: **M** always drops a finding marker, **L** always measures a
length, **D** always runs AI detection, **Q** is area and **E** is a profile/section wherever they
exist. The one sanctioned exception is C's **fly mode** (pointer lock): while it is active, W A S D
Q E are movement keys and the review keys are suspended until Esc leaves fly mode.

## 6. Project model without kind

### 6.1 Backend: what is deleted and what changes

| Item | Change |
|---|---|
| `backend/app/projects/kinds.py` (`require_kind`, `project_kind`, `wrong_project_kind`) | **deleted** |
| `backend/tests/test_project_kinds.py` | **deleted** |
| `app/api.py` | every `dependencies=[Depends(require_kind(...))]` is removed; routers are included plainly |
| `app/datasets/router.py` `TRAIN_ONLY`/`DETECT_ONLY`; `inference/router.py` `TRAIN_ONLY` (preannotate); `maps/router.py` `DETECT_WRITE`; `project_agent/router.py` train-only | removed; every project may do everything |
| `ProjectRegistry.create(name, folder, classes, kind)` | becomes `create(name, folder, type_ids)`. `_cache`, `open`, `_name_and_kind` lose `kind` |
| `AppData.remember(..., kind)` | the `kind` argument goes; existing `kind` keys in `recent_projects.json` are ignored |
| `Project.kind` column | dropped by migration `0010` (batch mode), after the backup (§11) |
| `Project.classes` JSON | kept read-only for one release as the migration's input; the `project_type` table replaces it |
| `POST /projects/{id}/maps/{mapId}/move`, `maps/move.py`, the `map_move` job | **deleted**; their only purpose was the split. `JobType` keeps `map_move` so old job rows still validate |
| `POST /projects/{id}/train`, `GET/POST/DELETE /projects/{id}/datasets…` | **deleted**; moved to Models (§12). Materialised folders on disk are kept, and migration registers them in the library as legacy datasets |
| `project_opened` in `app/main.py` | loses the "model adoption" step's kind check; gains the "findings counts check" (§8.6) |

### 6.2 Frontend

- Delete `KindRoute`, `useProjectKind`, `pipeline`, `NextStepBar`, `projectNextStep`, `nextStep`,
  `e2e/kinds.ts`, `maps/MoveMapDialog.tsx` and `screens/PastDetectionsScreen.tsx`.
- Branches on `kind` in `DataManagerScreen`, `ReviewScreen`, `ExportScreen`, `data/SelectionBar`,
  `review/DetectReview` and `ProjectsScreen` keep the union of behaviour:
  - Review shows both image-box review and run review.
  - Export shows both project export and detection export.
  - The SelectionBar offers "Use in dataset…", which opens the Models dataset builder with this
    project and the selected images' types preselected. It replaces `data/AddToDatasetDialog.tsx`,
    which is deleted.

### 6.3 Data list

A **data item** is a view over existing tables. There is no new storage, except the drawing table
that M adds.

| `type` | Backing rows | `label` | `captured_on` | `status` | `summary` |
|---|---|---|---|---|---|
| `image_set` | `source` where `kind = 'images'` | `Source.label` ?? `site` | `Source.captured_on` | the import job's state → `importing\|ready\|failed` | `{image_count, duplicate_count}` |
| `map` | `geo_map` | `name` | `captured_on` | `status` | `{gsd_cm, epsg, width, height}` |
| `elevation` | `surface` (`cloud_dsm`, `design`) | `name` | the cloud's `captured_on` for `cloud_dsm`, null for `design` | `building` → `importing` | `{kind, cell_size_m, z_min, z_max}` |
| `point_cloud` | `point_cloud` | `name` | `captured_on` | `status` | `{point_count, has_rgb, epsg}` |
| `drawing` | declared in the contract enum; **no provider in F** | | | | M adds the table and provider |

`Source` rows of `kind = 'map'` are not listed; their map is.

`backend/app/data_items/` holds `providers.py`, one `Provider` per type with
`page(session, after: SortKey | None, limit) -> list[DataItem]` and `count(session)`. `router.py`
serves `GET /projects/{id}/data`, which sorts by `(captured_on desc nulls last, created_at desc,
id)`. The keyset merge asks each provider for `limit + 1` rows after the cursor and merges them.
A page costs at most five small indexed queries. `?type=` restricts the providers used.

### 6.4 Add data

`data/AddDataDialog.tsx` opens from the top bar, the Overview empty states, the palette and each
tab's empty state. It offers five tiles, each opening today's importer unchanged apart from styling:

| Tile | Opens | Endpoint (existing) |
|---|---|---|
| Photos | `data/ImportImagesDialog` | `POST /projects/{id}/sources` |
| Orthomosaic (GeoTIFF) | `maps/ImportMapDialog` | `POST /projects/{id}/maps` |
| Elevation (DSM/DTM) | the design-surface import from `VolumesScreen`, extracted to `surfaces/ImportElevationDialog.tsx`; "Build from a point cloud" links to the cloud's surface build. M **extends this same file** with the plain DSM/DTM GeoTIFF mode (M §7); there is no second dialog | `POST /projects/{id}/design-surfaces`, `POST /projects/{id}/surfaces` (M adds `POST /projects/{id}/elevations`) |
| Point cloud (LAS/LAZ) | the import from `CloudsScreen`, extracted to `clouds/ImportCloudDialog.tsx` | `POST /projects/{id}/pointclouds` |
| Drawing (DXF, LandXML, PDF/PNG) | disabled, with the tooltip "Arrives with the Maps workspace"; M enables it on `ImportDrawingDialog` | M |

Every import is already a background job. The dialog closes when the job is queued, and the new
item appears in the Data list as `importing`.

## 7. Catalogue and severity scale

### 7.1 Storage: `catalogue.db` (Alembic history `backend/app/catalogue/migrations`, revision `0001`)

| Table | Columns |
|---|---|
| `catalogue_type` | `id` (uuid), `name` (unique among non-archived rows, compared by `normalise_name`), `colour` (#rrggbb), `kind` (`defect`\|`object`), `default_severity` (int, null), `hotkey` (str, null), `group` (str, null; e.g. "Concrete defects", shown as "Catalogue › group"), `archived` (bool), `origin` (`user`\|`migrated`), `created_at`, `updated_at` |
| `severity_level` | `level` (int PK, 1..n contiguous), `name`, `colour` |
| `catalogue_meta` | `key`, `value`: the pending-classification flag, the seeding marker |

- `normalise_name`: casefold, trim, `_` and `-` become spaces, runs of spaces collapse to one.
  "dump_truck" and "Dump truck" are the same type.
- On first open, `severity_level` is seeded with D4's four levels and colours (§4.1).
- `backend/app/catalogue/` holds `paths.py` (`catalogue_root(data_dir)`, the only place that
  knows the path), `db.py`, `handle.py` (a `CatalogueHandle` like `LibraryHandle`), `service.py`,
  `router.py` and `schemas.py`.
- `catalogue.db` is **the** app-wide database for app-level domain data. R adds its
  `report_template` table there in catalogue revision `0002` (R §6.2); there is no separate
  `app.db`.
- `main.py` gets `open_catalogue(app, settings)` with the same failure contract as
  `open_model_library`: log the error, set `app.state.catalogue = None`, and answer the catalogue
  endpoints with 503 `catalogue_unavailable`.

### 7.2 Rules

- Types are never deleted, only **archived**. An archived type still renders everywhere, but is
  not offered for new annotations or findings.
- **Kind change object → defect:** the response carries `backfill_candidates: true`, and the UI
  offers "Create findings from accepted annotations of this type" → `POST
  /catalogue/types/{id}/backfill`. This submits a `findings_backfill` library job that walks the
  recent projects one at a time. It is idempotent: it skips boxes that already have a finding.
- **Kind change defect → object:** existing findings are kept. The UI says so, and no new findings
  are created from that type.
- **Severity scale edits:**
  - Rename and recolour always.
  - Append a level.
  - Remove only the **highest** level, and only when no open project's `finding_count` uses it.
    Otherwise 409 `severity_in_use` with `{level, projects}`.
  - A finding in an unknown project with a level that no longer exists renders as "Level 5
    (removed)".
- **Hotkeys:** `1`–`9` and letters, unique among non-archived types in the catalogue. A project's
  type list may override a hotkey (`project_type.hotkey`), and must be conflict-free within the
  project (409 `hotkey_conflict`). A type hotkey is live **only inside a type picker** (the T
  picker and the type popovers of M and C); it never binds at workspace level, so it cannot clash
  with the keymap (§5.6), where digits mean severity.

### 7.3 Project type list (project DB, migration `0010`)

`project_type`: `type_id` (PK, a catalogue id), `position` (int), `hotkey_override` (null), and a
snapshot of `name`, `colour`, `kind`, `default_severity`, `hotkey` and `group` (F2).

- On project open, and on a `catalogue.changed` event for open projects, the snapshot is
  refreshed from the catalogue when it is available.
- `ProjectOut.classes` (`ClassDef[]`) stays in the contract and is now **derived** from
  `project_type` (`id` = type id, `order` = position), so the editor, review and map code that
  reads `project.classes` keeps working unchanged.
- `ClassDef` gains `kind`, `default_severity` and `group`.
- `PUT /projects/{id}/classes` is replaced by `PUT /projects/{id}/types`.
  - The body is `{type_ids: string[], hotkeys?: {type_id: key}}`.
  - Removing a type that still has annotations or findings is refused with the existing
    `class_in_use` rule (`check_removed_classes_unused` generalised to count findings too).
  - Adding a type that is not yet in the catalogue is done with `POST /catalogue/types` first. The
    UI does both from one "Add type" field.
- **The Setup agent** (`backend/app/agent/`) creates project types instead of classes. Its plan's
  class names are resolved against the catalogue by `normalise_name`, creating missing ones as
  `object`.

### 7.4 Model classes → catalogue types

`library_model.class_map` (JSON {model class name → type id | null}, where null means ignored) is
added in library migration `0002`.

- Run creation (`backend/app/detect/runs` and `classMapping.ts` / `runs/ClassMappingStep.tsx`)
  resolves in this order: exact `normalise_name` match on the catalogue → the model's
  `class_aliases` → `class_map`.
- Leftovers still give `422 unmapped_classes` before any job is queued. The mapping step now
  writes to the library, so it is asked once per model, not once per project.
- A mapped type that is not in the project's type list is **added to the list** when the run
  starts, and the response says so.
- `MapRun.class_map` and `QueryRun.class_map` keep their per-run snapshot, with values now type
  ids.
- The per-project `model_class_map` table is read by migration step `library_class_maps` (§11.4)
  and is otherwise unused.
- Library → model detail gains a **Class mapping** section (`library/ClassMapEditor.tsx`).

### 7.5 Catalogue screen (`frontend/src/catalogue/`)

`CatalogueScreen` has sub-tabs **Types** and **Severity**.

- **Types:**
  - A `DataTable` with columns: swatch, name, group, kind (`TypeChip` tag), default severity
    (`SeverityPill`), hotkey (`Kbd`), and state.
  - Filters: search, kind, "show archived".
  - A row opens `TypeEditor` in an `InspectorLayout`: name, colour picker, kind (Segmented),
    group, default severity (`SeverityPicker` + "None"), hotkey, Archive.
  - When `catalogue_meta.needs_classification` is set (after migration), a banner reads "12 types
    came from your existing projects. Mark which are defects." and filters to `origin=migrated`.
- **Severity:** `SeverityEditor` is an ordered list (level, name, colour), "Add level" and
  "Remove top level". It shows a live preview of the severity bars and pills.

## 8. Finding core

### 8.1 Storage (project DB, migration `0010`)

| Table | Columns |
|---|---|
| `finding` | `id` (uuid), `number` (int, unique, per-project sequence; shown as `F-0217`), `type_id`, `severity` (int, null), `status` (`open`\|`reviewed`\|`closed`), `note` (text, ""), `created_by` (`human` \| `model:<library_model_id>`), `confidence` (float, null), **anchor** (below), `lon`, `lat` (float, null; WGS84 location for maps and dashboards), `data_type`, `data_id` (the anchor's data item, denormalised for filters), `created_at`, `updated_at`, `reviewed_at`, `closed_at` |
| anchor columns | `anchor_kind` (`image`\|`map`\|`cloud`); **image:** `image_id`, `annotation_id` (→ `box.id`, unique); **map:** `map_id`, `geometry` (GeoJSON Point or Polygon in the map CRS); **cloud:** `cloud_id`, `x`, `y`, `z`, `uncertainty_m`. A CHECK constraint enforces exactly the columns of its kind |
| `finding_attachment` | `id`, `finding_id` (FK, cascade), `path` (relative `findings/<finding_id>/<id>.<ext>`), `original_name`, `width`, `height`, `bytes`, `created_at` |
| `finding_comment` | `id`, `finding_id` (FK, cascade), `author` (the Settings name, default "Operator"), `text` (≤ 4000), `created_at`, `edited_at` |
| `finding_count` | `status`, `severity` (−1 = none), `type_id`, `n`; PK over the three. Pre-aggregated, written in the same transaction as every finding write |
| `finding_daily` | `day` (date PK), `open`, `open_by_severity` (JSON {level: n}), `closed` (the day's closures); upserted by the counts module; the trend for StatTile sparklines |
| `activity` | `id`, `at`, `kind` (`finding.created`, `finding.status`, `finding.severity`, `finding.comment`, `data.imported`, `job.finished`, `detections.accepted`), `subject_id`, `summary` (a short human string), `payload` (JSON, small); indexed on `at`; the Overview feed and the inspector history (`subject_id`) |
| `migration_step`, `class_id_map` | §11 |

Indexes on `finding`: `(status, severity, number)`, `(type_id)`, `(data_id)`, `(updated_at)`,
`(anchor_kind, image_id)`, `(lon, lat)`.

`number` is **F's**, and it is the human finding number everywhere (the inspector, Findings tab,
search, map tooltips, reports): allocated as `max(number) + 1` inside the create transaction,
never reused after a delete, formatted `F-` plus at least four digits. Migration step 6 (§11.4)
numbers the findings it creates in `created_at` order. No sub-spec adds its own number.

### 8.2 Status transitions

| From → to | Allowed | Side effect |
|---|---|---|
| open → reviewed | yes | `reviewed_at` |
| open → closed | yes | `closed_at` |
| reviewed → closed | yes | `closed_at` |
| reviewed → open | yes | `reviewed_at` cleared |
| closed → open | yes (reopen) | `closed_at` cleared |
| closed → reviewed | no | 409 `invalid_transition` (reopen first) |

Severity is never required for a transition (D4: set on review; migrated findings are Reviewed
without a severity). The Findings tab shows "No severity" findings with a filter so they can be
graded.

### 8.3 API (`backend/app/findings/`)

| Endpoint | Purpose |
|---|---|
| `GET /projects/{id}/findings` | paged list. Filters: `status[]`, `severity[]` (int or `none`), `type_id[]`, `anchor_kind[]`, `data_id`, `created_by` (`human`\|`model`), `q` (note, type name, `F-0123`), `updated_from`/`updated_to`, `has_location`. `sort`: `-severity` (default, nulls last, then `-number`), `number`, `-updated_at`, `type`. Keyset cursor (`app/pagination.py`), `limit` ≤ 500 |
| `POST /projects/{id}/findings` | create with `{type_id, anchor, severity?, note?, status?}`. An `image` anchor may carry `annotation_id` (an existing box) **or** `box` geometry (the box is created in the same transaction). A type of kind `object` gets 422 `not_a_defect` (D7). `severity` defaults to the type's `default_severity` |
| `GET/PATCH/DELETE /projects/{id}/findings/{findingId}` | detail (with attachment and comment counts); patch `type_id`, `severity`, `status`, `note`, and `anchor.geometry` for map/cloud; delete cascades attachments, comments and, for image anchors, the annotation (§8.5) |
| `POST /projects/{id}/findings/bulk` | `{ids (≤ 1000), set: {status?, severity?, type_id?}}` in one transaction; returns `{updated, skipped: [{id, code}]}` |
| `GET /projects/{id}/findings/summary` | reads `finding_count` and `finding_daily` only: `{by_status, open_by_severity, open_no_severity, by_type (top 10), trend (≤ 60 days)}` |
| `GET /projects/{id}/findings/{fid}/thumbnail` | image anchors: a 160×120 crop around the annotation, cached in `cache/thumbs/findings/`; otherwise the first attachment's thumbnail; otherwise 404 |
| `GET/POST /projects/{id}/findings/{fid}/comments`, `PATCH/DELETE …/comments/{cid}` | the thread, oldest first, paged |
| `GET/POST /projects/{id}/findings/{fid}/attachments`, `DELETE …/{aid}`, `GET …/{aid}/file`, `GET …/{aid}/thumbnail` | POST `{path}`: a local file chosen in the Tauri dialog. JPEG, PNG or WebP, ≤ 50 MB, checked with Pillow, copied into `findings/<fid>/`, 256px thumbnail |
| `GET /projects/{id}/activity` | paged feed; `subject_id` filter |
| `POST /projects/{id}/findings/recount` | a `findings_recount` job that rebuilds `finding_count` and `finding_daily` from `finding` (the repair tool) |

`findings.changed` is added to `Event.type`, with a payload of `{ids}` (≤ 100, else `{all: true}`).

### 8.4 The counts module

`backend/app/findings/counts.py` is the only writer of `finding_count` and `finding_daily`, and is
called by the service inside the finding write's transaction. It follows the ADR
`2026-09-23-counts-live-on-run-rows`: one place holds the numbers, and a recount repairs them.
A property test checks that after random sequences of create, patch, bulk and delete, the counts
equal a recount.

### 8.5 Annotation ↔ finding invariant (image anchors)

An annotation on a `defect` type **is** a finding's geometry (umbrella §3). `findings/annotations.py`
has hooks that the box service (`backend/app/datasets/boxes.py`) calls inside its own transaction.

| Box event | Finding effect |
|---|---|
| created by a person on a defect type | a finding: `open`, `created_by: human`, default severity |
| a model proposal (`review_state = unreviewed`) | **none**. It is a Detection |
| a proposal accepted or edited (`boxes/review`, the editor) on a defect type | a finding: `reviewed`, `created_by: model:<model_id>`, `confidence`; an `activity` row (`detections.accepted`, batched per request) |
| reclassed to another defect type | `finding.type_id` follows |
| reclassed defect → object | the finding is deleted after a confirmation in the UI; the API requires `?confirm_finding_delete=true`, otherwise 409 `finding_would_be_deleted` |
| deleted | the finding is deleted (attachments go to `findings/_trash/` and are purged after 30 days) |
| geometry edited | nothing (the finding references the box) |

Deleting a finding deletes its box. Rejected proposals stay as they are today: a negative for
training statistics.

The same rule holds for every host: **an accepted defect detection becomes a finding with status
`reviewed`**, `created_by: model:<library_model_id>` and its `confidence`; a person-made finding
starts `open`. `findings/service.create_in_session(session, …)` is public so that another write
path (M's map review, M §9.3) creates the finding inside its own transaction, with the counts
module, as the box hooks do. For a map anchor the caller supplies `lon`/`lat`.

### 8.6 Findings tab (`frontend/src/findings/`)

- **`FindingsScreen`:**
  - A filter bar (`FindingFilters`): a status `Segmented` with counts from the summary, severity
    toggle pills including "None", a type multi-select, source kind (Images/Maps/Clouds), a search
    field, and "Clear".
  - A virtualised `DataTable` with these columns:
    - select
    - thumbnail (`/thumbnail`, lazy, 44×32)
    - `F-0123`
    - type (`TypeChip`)
    - severity (`SeverityPill`)
    - location (data item label + image filename or map/cloud name, with a type icon)
    - status (`StatusDot` + text)
    - updated (relative)
- **Selection** shows a floating bulk bar: Set status, Set severity, Clear.
- **Keyboard:** J/K or ↑/↓ move, Enter opens, 1–9 set severity, T opens the type picker (the
  review keys of §5.6), Shift+O / Shift+R / Shift+C set the status, Esc closes the inspector.
- The route `/findings/:findingId` opens `FindingInspector` in the right `InspectorLayout`. The
  table stays interactive.
- Filters and sort live in the URL query, so the Overview's "View all 47 →" and severity bars
  link to pre-filtered views.

### 8.7 The shared inspector

`findings/FindingInspector.tsx` is reused by I, M and C.

- Props: `{projectId, findingId, anchorSlot?, measureSlot?, onNavigate?}`.
- Its sections follow `ws-images.html`:
  1. header: `F-0217`, the created-by chip, and the menu (Delete, Copy link)
  2. type (a `TypeChip` button that opens a catalogue picker filtered to the project's defect
     types)
  3. severity (`SeverityPicker`)
  4. status (`Segmented`)
  5. `measureSlot` (I, M and C fill it with measured size)
  6. AI provenance on `--grad-ai` (model name from the library or the run snapshot, confidence)
  7. note (a textarea, autosaved 600ms after the last keystroke, "Saved" state)
  8. attachments (a grid, add through the Tauri file dialog, a lightbox)
  9. comments (the thread, reply with Enter, edit and delete your own)
  10. the history (activity filtered by `subject_id`)
- `anchorSlot` defaults to "Open in workspace", which follows the finding deep link below.

**Finding deep link** (uniform; `findings/links.ts` `findingHref(finding)` is the one builder, used
by the inspector, the Findings tab, the Overview, search, the palette and R's builder warnings):

| Anchor | Link | The workspace on arrival |
|---|---|---|
| any | `/p/:pid/findings/:findingId` | the Findings tab with the inspector open (the canonical link, "Copy link") |
| `image` | `/p/:pid/images/:imageId?finding=<fid>` | I opens the image, selects the annotation, pans it into view and shows the inspector (I §6.5) |
| `map` | `/p/:pid/maps?map=<mapId>&finding=<fid>` | M selects the anchor map's date, centres on the geometry and opens the inspector (M §5) |
| `cloud` | `/p/:pid/clouds/:cloudId?finding=<fid>` | C flies to the stored view pose (else the anchor) and opens the callout (C §10.4) |

`?finding=` is the same parameter on all three workspaces. A finding whose anchor names another
item than the URL is redirected to its own item. The coordinate jumps (`?at=` between map and
cloud, S1; `?at=px,py&r=` from cloud to image, I §6.5) stay separate and are not finding links.

## 9. Overview dashboard and Projects list

### 9.1 Overview (`frontend/src/overview/OverviewScreen.tsx`)

It reads one endpoint, `GET /projects/{id}/overview`, served by `backend/app/overview/`. The layout
is the mockup's 12-column grid:

| Block | Content | Source (pre-aggregated only) |
|---|---|---|
| KPI 1 "Open findings" | count, delta vs 7 days ago, a 30-day `Sparkline` | `finding_count`, `finding_daily` |
| KPI 2 "Critical" (the highest severity level's name) | open count at the top level, "▼ n closed this week" | `finding_count`, `finding_daily.closed` |
| KPI 3 "Project data" | image count + chips (maps, clouds, elevation, drawings) | `SUM(source.image_count)` + `COUNT` on the small data tables |
| KPI 4 "Stockpile volume" | the newest `ready` volume measurement's net volume and delta vs the previous one on the same polygon; when there is none, "Reviewed" = reviewed / all findings % | one indexed row from `volume_measurement`, or `finding_count` |
| Map hero (span 8) | the newest ready `map` as an OpenLayers view (tiles only, the existing tile endpoint), pan and zoom locked until clicked (a click opens the Maps tab), severity pins for findings with `lon/lat` (image findings take the image's EXIF location), a glass legend and scale | `GET /findings?has_location=true&status=open&limit=300` sorted by severity. **With no map:** pins on the plain backdrop over the findings' extent with a scale bar; with no pins either, an Add data empty state |
| Severity bars (span 4) | one bar per scale level, open counts, bars grow in over `--dur-emphasis` with stagger; a click filters Findings | summary |
| Running jobs (span 4) | the project's active jobs, as mockup `.job` cards with live progress; the newest finished job ("Done") | the jobs store (WebSocket), `GET /projects/{id}/jobs?state=running` |
| Recent findings (span 8) | 5 rows: thumbnail, type + location, severity, source, status; "View all n →" | `GET /findings?sort=-updated_at&limit=5` |
| Activity (span 4) | the last 8 `activity` rows with icons | `GET /activity?limit=8` |
| Banners | migration warnings (§11), model adoption (today's `AdoptionBanner`), "types to classify" | the overview payload |

The payload is `{findings: summary, data: {image_sets, images, maps, elevations, point_clouds,
drawings}, latest_volume | null, hero_map_id | null, banners[]}`. Everything reads bounded rows;
the endpoint never scans `box`, `image` or `finding`.

### 9.2 Projects list (`frontend/src/screens/ProjectsScreen.tsx`, rewritten)

- A card grid (`GlassPanel pane interactive`):
  - a cover (the hero map's `/preview` or the newest image thumbnail)
  - the name, the folder in mono
  - open findings with a critical count as a `SeverityPill`
  - data chips
  - last opened
  - a `StatusDot` (live when jobs run)
  - the **migration state** badge
- A toolbar with search by name, sort (last opened, name, open findings), **New project** and
  **Open folder**.
- **New project** asks for a name, a folder and "Types to start with" (a catalogue multi-select,
  optional). There is no kind.
- `ProjectOut` gains `summary: ProjectSummary {image_count, maps, point_clouds, elevations,
  open_findings, open_top_severity, cover: {kind: map|image, id} | null}`, filled from the same
  pre-aggregated reads. `GET /projects` stays bounded by `MAX_RECENT = 20`.
- **Migration state:** `ProjectOut` gains `migration: {state: ok|pending|running|failed,
  job_id?, error?, backup_path?}`.
  - A project that is not `ok` is listed but will not open.
  - The card shows "Upgrading…" with progress, or "Couldn't upgrade" with **Retry**,
    **Reveal backup** and **Details** (the report).
- **Per-project isolation:** `list_projects` catches a failure for each folder. Today a single
  failing `reg.open` fails the whole list. Now the failing project comes back as an item with
  `migration.state = failed` and an `error`.

## 10. Jobs section and search

### 10.1 `GET /api/v1/jobs` (`backend/app/jobs/app_router.py`)

- It pages across the **library runner's jobs** and the jobs of every project in the recent list
  that is currently open (`ProjectRegistry._handles`). Only open projects can have live jobs; the
  orphan sweep closes the rest.
- It is a keyset merge on `(created_at desc, id)`, asking each source for `limit + 1` rows. That
  bounds it at 21 small indexed queries.
- Filters: `state[]`, `type[]`, `project_id`.
- Items are `AppJob = Job + {project_name}`, where `project_name` is null for library jobs.
- Cancel and log use the existing per-project and `/library/jobs` routes, chosen by
  `job.project_id`.

### 10.2 Jobs screen (`frontend/src/jobs/JobsScreen.tsx`)

- Segmented Running · Queued · Finished · Failed, with counts.
- A project filter.
- A `DataTable`: type (via `jobLabels`), project, message, progress (`Progress`), started, duration.
- A row opens the job in `InspectorLayout`: `JobCard` details, `JobLogView` tail (existing
  `useJobLog`), Cancel, and "Go to result" (from `job.result`).
- Live updates come from the existing WebSocket through `store/jobs.ts`.

### 10.3 `GET /projects/{id}/search?q=&limit=8`

- Findings: `number` exact match, or `note`/type name `LIKE`, limited.
- Data items: label `LIKE` across the providers, limited.
- The response is `{findings: [...], data: [...]}`. It never scans images.

## 11. Migration (D6)

### 11.1 Revisions

| DB | Revision | Content |
|---|---|---|
| project | `0010_foundation` | adds `project_type`, `finding` (+ indexes and CHECK), `finding_attachment`, `finding_comment`, `finding_count`, `finding_daily`, `activity`, `migration_step`, `class_id_map`; drops `project.kind` (batch) |
| library | `0002_models_section` | `library_model.class_map`; `task` gains `segment`; `dataset`, `dataset_source`, `dataset_item`, `training_run` (§12) |
| catalogue | `0001_catalogue` | §7.1 |

Following the ADR `2026-09-23-gotcha-parallel-branches-collide-on-migration-ids`, F **reserves**
these ids. Each is written by exactly one F unit (§18). The programme's other ids are fixed in
umbrella §6 ("Migration ids"): project `0011` I, `0012` M, `0013` C, `0014` R; catalogue `0002` R
(`report_template`); no sub-project claims a library revision. The number is a reservation, not an
order: each revision's `down_revision` is set to `main`'s head at merge time.

### 11.2 Copy-first backup (in `backend/app/db/session.py::open_project_db`)

1. Read the current Alembic revision with `MigrationContext.get_current_revision()`. When it is
   below `0010`, before calling `command.upgrade`:
   1. `PRAGMA wal_checkpoint(TRUNCATE)`.
   2. `sqlite3.Connection.backup()` into `<project>\backups\project.db.v1-<UTC stamp>.bak`.
      This is SQLite's own online backup, consistent under WAL.
   3. `PRAGMA quick_check` on the copy.
2. A failed backup (disk full, permissions) raises `BackupFailed`. The upgrade does **not** run.
   The project is flagged `failed` with the code `backup_failed`, and its database is untouched.
3. An existing backup for the same revision is kept. The next backup gets a new stamp, and the app
   never deletes backups.

### 11.3 Orchestration (`backend/app/migration/`)

- `state.py` keeps `%APPDATA%\kestrel-ai\migrations.json`, keyed by the lower-cased folder:
  `{state, job_id, error, backup_path, report_path, updated_at}`.
- `startup.py` runs in `lifespan` after the library and catalogue open. For every recent project
  whose `project.schema_version < 2`, it submits one `project_migrate` job to the **library**
  runner. Nothing blocks startup, and a failure to submit is logged.
- `ProjectRegistry.open` checks `schema_version`. Below 2, it submits the job if none is live.
- `get_project` then raises 409 `project_upgrading` (`{job_id}`) or 409 `project_upgrade_failed`
  (`{error, backup_path}`), so no project route runs on half-migrated data.
- **Retry:** `POST /projects/migrations/retry {folder}` submits a new job.
- **Restore:** the backup is restored by hand ("Reveal backup"). The app does not overwrite a
  database automatically.

### 11.4 Data steps (`backend/app/migration/steps.py`)

Each step is recorded in `migration_step(name, done_at, detail)` and **skipped if already
recorded**, so the job can be re-run at any point. Each step is one transaction unless noted.

| # | Step | What it does |
|---|---|---|
| 1 | `catalogue_merge` | for each `Project.classes` entry, finds a catalogue type by `normalise_name` or creates one (`origin: migrated`, `kind: object` (F4), the class colour, the hotkey only if free). Writes `class_id_map(old_class_id, type_id)`. Sets `catalogue_meta.needs_classification` |
| 2 | `rewrite_class_ids` | where old ≠ new: `UPDATE box / map_detection / map_label SET class_id = :new WHERE class_id = :old` (indexed SQL, no rows loaded). JSON keys and values in `query_run.counts/verified_counts/class_map` and `map_run.counts/verified_counts/area_counts/class_map` (a handful of rows per project). `model_class_map.mapping` values. `dataset.classes` ids. `dataset_image.boxes` is **not** rewritten: legacy datasets train from their materialised `data.yaml`, whose class names are unchanged |
| 3 | `project_types` | fills `project_type` from `class_id_map` in the old class order, with snapshots |
| 4 | `library_class_maps` | merges the project's `model_class_map` into `library_model.class_map`. The first mapping wins; conflicts are listed in the report |
| 5 | `legacy_datasets` | registers each materialised project dataset in `library.db` as `dataset` (`origin: legacy`, `legacy_path` absolute, frozen class names, counts), so it stays trainable from Models |
| 6 | `findings_from_annotations` | for boxes with `review_state in (accepted, edited)` or `provenance_kind = person` on **defect** types: a finding `reviewed`, severity null, `created_by` from provenance, `lon/lat` from the image. With F4 this is normally empty; the backfill job reuses this function. Batched 1000 boxes per transaction, with progress |
| 7 | `counts_rebuild` | `finding_count`, `finding_daily` (today only), `activity` "Project upgraded" |
| 8 | `finish` | `project.schema_version = 2`; writes the report `<project>\backups\migration-v2.json` (steps, counts, warnings, duration) |

Maps, clouds, surfaces, volumes, runs and detections are not touched beyond step 2, so they carry
over as D6 requires. Old project model adoption (`library/adoption.py`) keeps running from
`project_opened` as today.

### 11.5 Dry run on real folders

- `backend/scripts/migration_dry_run.py [--recent | --folders a b …] [--out report.json]`:
  1. Copies each project's `project.db` (and `-wal`/`-shm`) plus copies of `library.db` and
     `catalogue.db` into a temp dir. It never copies images and never opens an original for
     writing.
  2. Runs backup, upgrade and all steps against the copies with a stub runner.
  3. Prints for each project: types merged and created, ids rewritten per table, legacy datasets,
     findings created, warnings, and duration.
  4. Exits non-zero on any failure.
- `backend/tests/test_migration_real.py` is marked `real_data`. It runs the script when
  `KESTREL_REAL_PROJECTS` is set and is skipped otherwise.
- The operator's run over every real project is **evidence required before F's migration unit
  merges**, recorded under `docs/evidence/`.

## 12. Models section

### 12.1 Storage (`library.db`, revision `0002`)

| Table | Columns |
|---|---|
| `dataset` | `id`, `name` (unique), `task` (`detect`\|`obb`\|`segment`), `origin` (`built`\|`legacy`), `filter` (JSON: `{project_ids[], type_ids[], captured_from, captured_to, reviewed_only}`), `classes` (frozen `[{type_id, name}]`, which fixes the class index order), `split_method`, `split_params`, `state` (`resolving`\|`ready`\|`failed`), `counts` (JSON: images, per class, train/val), `export_path` (null until built), `export_state` (`none`\|`building`\|`ready`\|`stale`), `legacy_path` (null), `job_id`, `created_at` |
| `dataset_source` | `dataset_id`, `project_id`, `project_folder` (at resolve time), `project_name`, `image_count` |
| `dataset_item` | `dataset_id`, `project_id`, `image_id`, `split`, `labels` (frozen JSON `[{type_id, x, y, w, h, angle}]`); PK over the first three |
| `training_run` | `id`, `name`, `dataset_id`, `base_model_id`, `params` (TrainRequest), `job_id`, `state`, `model_id` (null until registered), `metrics`, `created_at`, `finished_at` |

### 12.2 Flow

1. **Preview** (`POST /library/datasets/preview`, synchronous): for each selected project, `COUNT`
   queries only (images with ground truth, boxes per type), under a per-project 2-second
   timeout. The builder shows the counts as the filter changes (debounced).
2. **Create** (`POST /library/datasets`) → a `dataset_build` library job:
   - It opens each project (`registry.open(remember=False)`) and pages its matching images 500 at
     a time.
   - It freezes `dataset_item` rows and assigns splits with the existing
     `app/datasets/splits.py`. Group keys are prefixed with the project id so a flight never
     straddles train/val.
   - It sets `state = ready`. **No image is copied.** `dataset_source` records the provenance.
   - `reviewed_only` means ground truth, which is `accepted`/`edited` or person-drawn. Otherwise
     unreviewed proposals are excluded anyway, as today.
3. **Export** (`POST /library/datasets/{id}/export`) → the `dataset` job type (today's materialise,
   generalised to items across projects):
   - It writes YOLO `images/`, `labels/` and `data.yaml` under
     `library\datasets\<slug>-<id8>\`, hard-linking when on the same volume and copying otherwise
     (today's rule in `materialise.py`).
   - `detect` writes axis-aligned labels (`geometry.aabb_of`) and `obb` writes rotated ones.
     `segment` is refused with 422 `task_not_supported` until I lands YOLO-seg.
   - A source project that is missing or not openable fails the job with the list of missing
     projects. The dataset stays `ready`, and the export becomes `failed`.
4. **Train** (`POST /library/training-runs`): the body is today's `TrainRequest` plus nothing
   else.
   - It exports first if `export_state != ready`, as a chained step in the same `train` job.
   - `backend/app/training/jobs.py` moves from `ProjectHandle` to `LibraryHandle`. `get_dataset`,
     `data_yaml_path` and `check_materialised` read the library dataset (`legacy_path` for legacy
     ones), and the run dir becomes `library\runs\<job_id>`.
   - `_train_gsd` (`library.estimate_for_dataset`) is ported to sample EXIF from `dataset_item`
     rows across projects, with the same best-effort contract.
   - Registration is unchanged (`origin: trained`), plus the `task` of the dataset and a
     `class_map` pre-filled from `dataset.classes` (model class name → type id).

### 12.3 API (all under `/api/v1/library`)

| Endpoint | Purpose |
|---|---|
| `GET /library/datasets`, `GET/DELETE /library/datasets/{id}` | list (paged), detail with sources and counts, delete (the row and the export folder; never project images) |
| `POST /library/datasets/preview` | the counts for a filter |
| `POST /library/datasets` | create → `dataset_build` job |
| `POST /library/datasets/{id}/export` | build the YOLO export (job) |
| `GET /library/datasets/{id}/items` | paged items (project, image, split, label count) for the detail screen's sample grid; thumbnails through the existing per-project thumbnail route |
| `GET/POST /library/training-runs`, `GET /library/training-runs/{id}` | list, start (job), detail with metrics and artefacts |
| `PUT /library/models/{id}/class-map` | the model → catalogue mapping |
| `LibraryModel.task` | enum gains `segment`; `LibraryModel` gains `class_map` |

### 12.4 Screens: where today's train-project screens go

| Today | After F |
|---|---|
| `screens/DatasetsScreen.tsx` + `datasets/DatasetList`, `DatasetDetail`, `NewDatasetForm`, `splitAdvice` | `models/DatasetsScreen.tsx`: `DatasetList` restyled on `DataTable` with a sources column; `DatasetDetail` gains the sources table and a sample grid; `NewDatasetForm` becomes `models/DatasetBuilder.tsx`, a filter form (projects multi-select from recent, types from the catalogue, date range, reviewed-only, task, split method and val fraction with `splitAdvice`) plus live preview counts. `/p/:id/datasets` redirects with `?project=` preselected |
| `screens/TrainScreen.tsx` + `train/TrainForm`, `TrainProgress`, `trainModel`, `useDatasets` | `models/TrainingScreen.tsx`: a list of `training_run`s (state, dataset, base model, best mAP, duration), a detail with `TrainProgress` and `library/TrainingCurve`, and **Compare** (2–4 runs, curves overlaid from each model's `results.csv` artefact, read client-side with `library/resultsCsv.ts`). The "New training run" drawer is `TrainForm`, whose dataset picker now lists library datasets. `useDatasets` points at `/library/datasets` |
| `screens/LabelResolverScreen.tsx` | **deleted**. `/label` redirects to Images; the "Label next" action in the Images tab keeps its logic (moved to `data/labelNext.ts`) |
| `screens/PastDetectionsScreen.tsx` | **deleted**. Past query runs are ordinary runs (the Runs secondary route), past maps are ordinary maps in the Maps tab, and "Move map" is gone (§6.1) |
| `library/LibraryScreen.tsx` and friends | unchanged apart from styling; `ModelDetail` gains `ClassMapEditor` and a task badge; hosted at `/models/library` |

## 13. API summary (contract first)

`contract/openapi.yaml` is edited first, and `contract/client/schema.d.ts` is regenerated in the
same change. F owns these path groups and schemas, and I, M and C must not edit them except to add
fields. Two agreed additions inside F's `/findings` group: I's `image_id` filter on
`GET /findings` (I §14), and C's `PUT`/`GET /findings/{findingId}/view3d` (C §11.4, tag
`pointclouds`, owned by C). The Measurements union `GET /projects/{id}/measurements` is M's (§2).

- **Removed:**
  - `ProjectKind` and `components/responses/WrongProjectKind` (all 50 references).
  - `kind` from `Project` and `ProjectCreate`.
  - `/projects/{id}/datasets*`, `/projects/{id}/train`, `/projects/{id}/maps/{mapId}/move`.
  - `PUT /projects/{id}/classes` (replaced by `/types`).
- **Changed:**
  - `ProjectCreate {name, folder, type_ids[]}`.
  - `Project` + `summary`, `migration`.
  - `ClassDef` + `kind`, `default_severity`, `group`.
  - `LibraryModel.task` + `segment`, and `class_map`.
  - `JobType` + `project_migrate`, `findings_backfill`, `findings_recount`, `dataset_build`.
  - `Event.type` + `findings.changed`, `data.changed`, `catalogue.changed`, `migration.changed`.
- **Added:**
  - `/catalogue/types`, `/catalogue/types/{typeId}`, `/catalogue/types/{typeId}/backfill`,
    `/catalogue/severity`.
  - `/projects/{id}/types`, `/projects/{id}/data`, `/projects/{id}/overview`,
    `/projects/{id}/search`, `/projects/{id}/activity`.
  - `/projects/{id}/findings…` (§8.3).
  - `/projects/migrations/retry`.
  - `/jobs`.
  - `/library/datasets…`, `/library/training-runs…`, `/library/models/{id}/class-map`.
  - Schemas: `CatalogueType`, `SeverityLevel`, `DataItem`, `DataItemType` (enum including
    `drawing`), `Finding`, `FindingAnchor` (oneOf image, map, cloud), `FindingComment`,
    `FindingAttachment`, `FindingSummary`, `Activity`, `ProjectOverview`, `ProjectSummary`,
    `MigrationState`, `AppJob`, `LibraryDataset`, `DatasetFilter`, `TrainingRun`.

## 14. Budget

**Background jobs:**

| Job | Runner |
|---|---|
| `project_migrate` (one per project) | library |
| `findings_backfill` | library |
| `findings_recount` | project |
| `dataset_build` | library |
| `dataset` (export) | library |
| `train` (moved) | library |
| every importer behind Add data (unchanged) | project |
| attachment copy | synchronous, capped at 50 MB and validated before copying; the one exception, since a photo copy is well under a second |

**Bounded reads:**

- **Findings list:** keyset pages ≤ 500, indexed filters. The table holds only loaded pages
  (virtualised, `onEndReached`).
- **Overview, summary, Projects list:** read `finding_count`, `finding_daily`, small-table `COUNT`s
  and `SUM(source.image_count)`. They never scan `finding`, `box` or `image`. The hero map is tiles
  only, and its pins are capped at 300.
- **Data list:** ≤ 5 × (limit + 1) indexed rows per page.
- **App jobs:** ≤ 21 sources × (limit + 1) rows.
- **Search:** `LIMIT 8` per group.
- **Dataset preview:** `COUNT` only, with a per-project timeout. The build pages 500 images at a
  time and never holds a project's image set.
- **Finding thumbnails:** one crop read, cached. Attachments: 256px thumbnails in lists; the
  original only in the lightbox.
- **Migration:** SQL `UPDATE … WHERE` for row tables. JSON rewrites only on run rows (tens per
  project). Box → finding in batches of 1000.

## 15. Errors and edge cases

| Case | Behaviour |
|---|---|
| `catalogue.db` fails to open | the app starts. Catalogue endpoints return 503 `catalogue_unavailable`, and the Catalogue screen shows a blocking error with "Reveal folder". Projects render from the `project_type` snapshots. Creating types and backfill are disabled with that reason |
| Library unavailable | as today (503 `library_unavailable`). Models is blocked; migration jobs cannot be submitted, so projects below `schema_version` 2 show "Waiting for the model library" and stay closed. That is the one dependency; it is logged and visible |
| A project's backup fails | not upgraded; flagged `failed/backup_failed`; the app opens |
| A migration step fails | the job fails; the flag carries the step and error; Retry re-runs from the first unrecorded step |
| The project folder is gone or read-only | listed with `failed` and the error; never blocks the list |
| A type name collides on create or rename | 409 `type_exists` with the existing id; the UI offers "Use existing" |
| A severity level still in use | 409 `severity_in_use` |
| Creating a finding on an object type | 422 `not_a_defect` |
| An invalid status transition | 409 `invalid_transition` |
| A box reclass would delete a finding | 409 `finding_would_be_deleted` without `confirm_finding_delete` |
| An attachment that is too large or not an image | 422 `attachment_invalid` with the reason |
| A dataset source project is missing at export | the export job fails and lists the projects; the dataset stays |
| A segment dataset export before I | 422 `task_not_supported` |
| Reduced effects wrongly chosen by Auto | the toast's Undo, and the Settings override is final |

## 16. Testing

**Backend (pytest):**

- **Kind removal:** a route walk asserts that no `require_kind` remains, and that a formerly
  train-only or detect-only write (preannotate, map import, dataset) succeeds on any project.
- **Catalogue:**
  - `normalise_name`, the uniqueness and archive rules, hotkey conflicts
  - severity edits including `severity_in_use`
  - the 503 path
  - the snapshot refresh
- **Findings:**
  - CRUD
  - every transition in §8.2
  - filters, sorts and cursor stability under inserts
  - bulk with skips
  - attachments (valid, oversize, not an image)
  - comments
  - activity rows
  - the thumbnail crop
- **Counts:** a seeded random property test (no new dependency) that counts equal a recount after
  random operation sequences.
- **Annotation invariant:** every row of §8.5, including accept through `boxes/review`.
- **Data list:** the merge order and cursor across the five providers, with `type` filters and an
  empty project.
- **Overview:** a query-count assertion (a fixed number of statements, independent of finding and
  image counts) using a SQLAlchemy `before_cursor_execute` counter.
- **Migration:**
  - The backup exists and passes `quick_check` before `0010` runs.
  - A failing backup leaves the DB byte-identical.
  - Each step is idempotent: run twice, and kill between steps, then resume.
  - Class id rewrite across all tables and JSON shapes: the counts and area counts totals are
    equal before and after.
  - A merge by name across two fixture projects ("dump_truck" / "Dump truck").
  - A failed project does not break `GET /projects`.
  - Fixture projects: a pre-`0007` train project, a detect project with maps, runs, clouds and
    volumes (from existing test builders).
- **Models:**
  - build across two projects, where splits keep groups
  - export hard-link vs copy, and a missing project
  - `segment` refused
  - training from built and legacy datasets
  - class map pre-fill
  - `_train_gsd` across projects
- **App jobs:** the merge across library and two projects.
- **Contract tests** for every new endpoint (the existing `tests/test_contract.py` pattern).

**Frontend (vitest):**

- Tokens: `contrast.test.ts` composited.
- `check-tokens` rules: a fixture file that must fail each rule.
- `useCountUp` and `Sparkline` under reduced motion (the final value at once).
- `effects.ts` Auto decisions.
- `Tabs` indicator and roving focus.
- `CommandPalette` keyboard and async groups.
- `DataTable` virtualisation (a fixed rendered-row count at 10k rows), selection and keyboard.
- `SeverityPicker` keys.
- `FindingsScreen` filters ↔ URL.
- `FindingInspector` autosave and transitions.
- `ProjectsScreen` migration states.
- `OverviewScreen` empty and full states.
- `DatasetBuilder` preview.
- `TrainingScreen` compare.
- `JobsScreen` filters.
- `routes.tsx` redirects: every old path in §5.3 lands on its new route.

**Playwright e2e:**

1. `shell.spec.ts`: rail, tabs, Ctrl K navigation and search, the page transition finishing (per
   ADR `2026-09-21-gotcha-measuring-animated-drawers`, await `getAnimations()`).
2. `findings.spec.ts`:
   1. Create a defect type in the Catalogue.
   2. Draw a box in the interim editor, and a finding appears.
   3. Grade it, comment, attach a photo, close it.
   4. The Overview counts update.
3. `models.spec.ts`: build a dataset across two fixture projects, then train the starter on the
   tiny fixture, then the model appears in the Library with a class map.
4. `migration.spec.ts`: start the app with a pre-F fixture train project and detect project.
   Both upgrade, a backup exists, the types are merged, and the old runs, maps and clouds open.
5. `effects.spec.ts`:
   1. The frame-time probe on Overview, the Findings table scrolling 5k rows, and a map with a
      floating glass panel: p95 frame time ≤ 20ms at `full` on the dev machine, recorded in
      evidence.
   2. `data-effects="reduced"` removes every `backdrop-filter` (computed style scan).
6. Existing specs updated: `contour.spec.ts` → `aero.spec.ts`, `kinds.ts` users,
   `past-detections.spec.ts` deleted, `datasets.spec.ts` moved to the Models routes.

## 17. Success criteria

1. There is no `kind` anywhere: not in the contract, backend, frontend or e2e (a grep gate in the
   review checklist). Any project can import every data type and run every action.
2. The rail, top bar, palette, tabs and every screen use the Aero glass tokens and primitives, and
   `check-tokens` passes with the new rules.
3. Reduced motion and reduced effects each work as specified and are verified by tests.
4. The Catalogue lists merged types from real projects. The severity scale is editable. Model
   classes map to types once per model.
5. Findings can be created (through the image invariant), filtered, graded, commented, given
   attachments and bulk-closed. The Findings tab scrolls 10k findings smoothly. The Overview reads
   only pre-aggregated counts.
6. A dataset can be built across projects without copying images until export, trained, and the
   model lands in the Library.
7. The dry run over every real project passes, and on the operator's machine every project
   upgrades with a backup on first start. A deliberately broken fixture is skipped and flagged
   while the app opens.
8. The Jobs section shows library and project jobs together, with cancel and logs.

## 18. Execution DAG

**Units:**

| Unit | Content | Touches | Needs |
|---|---|---|---|
| **C0** contract | all of §13 plus the regenerated client and Prism examples | `contract/` | none |
| **DS** design system | tokens, fonts, motion, effects, all `ui/` primitives (including `Popover`, `Slider`, `Combobox`), the keymap table `ui/keymap.ts` with `isTypingTarget` and its collision test (§5.6), `DESIGN.md`, `AGENTS.md` item 3, `check-tokens`, contrast test | `frontend/src/ui`, `index.css`, `tailwind.config.ts`, `scripts/`, `DESIGN.md` | none |
| **SH** shell | Rail, TopBar, ProjectTabs, PageTransition, command registry, routes and redirects, deleting the kind UI (§6.2), restyle passes on the interim screens | `frontend/src/app`, `routes.tsx`, `screens/*` restyle | DS, C0 |
| **BK** kind removal + data list + search + app jobs | §6.1, §6.3, §10.1, §10.3 | `backend/app/{projects,api.py,data_items,jobs/app_router.py}` | C0 |
| **BC** catalogue + project types + findings core | `catalogue/`, `findings/`, project migration **`0010`** (sole owner), counts, the annotation invariant in `datasets/boxes.py`, overview endpoint | `backend/app/{catalogue,findings,overview,db,datasets/boxes.py}` | C0 |
| **BM** models backend | library **`0002`** (sole owner), datasets across projects, the training move, class map, `task: segment`, run class mapping against the catalogue | `backend/app/{library,training,datasets/materialise.py,detect/class_maps.py}` | C0; the catalogue module interface from BC (`resolve_types`), stubbed until BC merges |
| **MG** migration | backup in `open_project_db`, orchestration, steps, dry-run script, `migrations.json` | `backend/app/{migration,db/session.py}`, `backend/scripts/` | framework: none. Steps 1–7 need BC and BM merged |
| **S1** screens: project | ProjectsScreen, Overview, Add data dialog, Findings tab + FindingInspector | `frontend/src/{screens/ProjectsScreen,overview,findings,data/AddDataDialog}` | SH, BC, BK |
| **S2** screens: app sections | Catalogue, Models (Library host, Datasets, Training), Jobs, Settings appearance | `frontend/src/{catalogue,models,jobs,library}` | SH, BC, BM |
| **X** evidence | the e2e specs of §16, the frame-time check, the real-folder dry run, the walkthrough, the `docs/progress.md` entry | `frontend/e2e`, `docs/` | all |

**Parallel batches** (one worktree per unit; merges into `main` are serialized with a rebase and
gate between them):

1. **C0** alone (small, first on the critical path).
2. **DS ∥ BK ∥ BC ∥ BM ∥ MG-framework**: five worktrees, with disjoint files and disjoint migration
   ids.
3. **SH** (after DS) ∥ **MG-steps** (after BC and BM).
4. **S1 ∥ S2** (after SH plus their backends).
5. **X**.

**Critical path:** C0 → DS → SH → S1 → X. DS and SH are the longest frontend chain, and S1 is the
largest screen unit. The backend chain C0 → BC → MG-steps runs alongside it and must finish before
X. MG's real-folder dry run is the gate on merging MG, not on starting S1 or S2.

**Merge order inside batch 2:** BK first, because it removes the `kind` guard that the others'
tests would otherwise hit. Then BC (it owns `0010`), then BM, then MG-framework.

## 19. Risks

1. **The migration touches every real project.** Mitigations:
   - the SQLite backup API copy before any change
   - per-project skip-and-flag
   - step records with resume
   - the dry run on copies of every real folder before merging
   - no deletes; `Project.classes` and `model_class_map` are kept for one release
2. **F4 (migrated types are objects)** could surprise the operator if an existing project really
   holds defects. The Catalogue's classification banner and the backfill job make it one action
   to correct. It is flagged for confirmation at plan review.
3. **Glass on a laptop GPU.** Blur is confined to floating panels (F7), there is a reduced-effects
   Auto mode with a frame probe, and the e2e frame budget is recorded. If the probe misfires, the
   Settings override is final.
4. **Interim screens in the new shell.** Images, Maps and Measurements run today's screens until
   I, M and C replace them. SH restyles them only through the primitives, and changes no
   behaviour, so I, M and C inherit working screens rather than half-rewritten ones.
5. **Merge contention on shared files** (`openapi.yaml`, `routes.tsx`, `api.py`). C0 lands the
   whole contract first. `routes.tsx` is owned by SH, and S1 and S2 only add lazy route entries
   through a `routes/` table file each (`routes/projectRoutes.tsx`, `routes/appRoutes.tsx`) that
   SH creates.
6. **Training moving from project to library** changes where run folders and logs live. Old run
   folders stay in their projects. Model provenance snapshots already record them.
