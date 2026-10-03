---
type: spec
date: 2026-10-03
status: draft
tags: [spec, shell, navigation, sidebar, ui]
related: ["[[2026-09-26-foundation-design]]", "[[2026-10-02-workspace-rail-design]]"]
---

# Sidebar: one labelled navigation with the project as a tree

## 1. Goal

The operator finds the app's navigation unintuitive. They named two problems:

- They can't tell where they are.
- The rail looks off.

The cause is structural. Location is split across three places:

- **The 64px rail.** It shows icons only, so the labels appear only as tooltips.
- **The top-bar breadcrumb.** It names the open project.
- **The project tab strip.** It holds nine tabs plus a More menu.

This spec replaces all three with **one labelled sidebar**. The open project sits under Projects as a small tree, with its pages beneath it. The highlighted row and the rows above it then read as a path, for example Projects › Al Khail Gate Phase 2 › Findings. The sidebar collapses to an icon column.

**Approved mockup:** option A ("Project tree") of the interactive prototype at
https://claude.ai/artifact/T39pC8fR9KxwRJAJLCssWG. The other options were rejected: B (project mode), C (rail and panel) and D (labelled rail, tabs kept).

**Done means all of the following:**

1. On every route, the operator can read the current section, project and page from the sidebar alone.
2. Every page that the tabs or the More menu reached today is reachable from the sidebar.
3. The tab strip and the breadcrumb are gone.
4. Collapse works by button and by Ctrl+B, and the state survives a restart.
5. Maps, Point clouds, Asset models, Images and the report builder open collapsed.

### Non-goals

- No API, contract, backend or database change.
- No project switcher in the sidebar; the command palette (Ctrl+K) switches projects.
- No change to the floating workspace rail inside Maps and Point clouds (`ui/WorkspaceRail`), or to `\`.
- The Models (Library · Datasets · Training) and Catalogue (Types · Severity) sub-tabs stay inside their pages.
- No change to the top bar's search field, context actions, running pill or agent button.

## 2. Budget

- **Background jobs:** none are added. The sidebar only reads existing state:
  - The jobs store, for the Jobs badge and the project's live dot.
  - `useProjectCounts`, which the tab strip already calls on `GET /projects/{id}/overview`.
- **Bounded reads:** one overview request per project open. This is unchanged; the call moves from `ProjectTabs` to the sidebar. Nothing loads images or lists.
- **Persistence:** one `localStorage` key, `kestrel.sidebar`. Every read and write is wrapped in try/catch, and the default is expanded. No app-data migration is needed.

## 3. Structure

### 3.1 Expanded (236px)

From top to bottom:

1. **Brand row.** The existing `Brand` logo tile and "Kestrel AI". It links to `/projects`.
2. **Projects.** It is active on `/projects` and `/projects/new`.
3. **Project tree.** Shown only on `/p/:projectId/*`. It is indented under Projects and has a 1px `line` guide on its left. It contains:
   - **Project row.**
     - Shows the 24px initials tile, then the project name (truncated, with the full name in a tooltip), then a `StatusDot` that is live while any job of the project runs.
     - Links to `/p/:id/overview`.
     - Shows "Project" while the project is loading or fails to load. This matches today's breadcrumb.
   - **The nine `PROJECT_TABS` in their current order:** Overview, Images, Maps, Drawings, Point clouds, Asset models, Findings, Measurements, Reports.
     - The counts come from `useProjectCounts` and are set in mono at `text-2xs`: images, maps, drawings, point clouds and open findings.
     - When the counts are unavailable, no count is shown.
   - **More.** A disclosure button (`aria-expanded`) that reveals the six `SECONDARY_PAGES` inline: Runs, Review, Detect, Analytics, Site areas, Project settings.
     - It is open whenever the current route is one of those pages.
     - Otherwise it remembers the operator's toggle for the session, in memory only.
4. **Models, Catalogue, Jobs.**
   - Jobs keeps `railHref` (`/jobs?project=` inside a project).
   - Jobs carries an accent badge with the count of active jobs across all projects. The badge is hidden at 0.
5. **Spacer**, then **Settings**. Settings is active on `/settings` and `/about`.
6. **Collapse button.** Its label is "Collapse sidebar" and it shows the `Ctrl+B` key cap.

**Rows and states:**

- **Row sizes.** Rows are 34px with `rounded-control`. Tree rows are 30px. Icons are 20px, and labels are `text-sm`.
- **Inactive rows.** `text-muted`, with `hover:bg-hover hover:text-ink`.
- **Active row.** `bg-accent-soft text-accent-ink font-medium` with `aria-current="page"`, plus the existing 3px `grad-ink` bar on the left edge.
- **Parent rows.** When a project page is active, the Projects row and the project row are drawn in `text-ink` without the active fill. This makes the path read top-down without three highlighted rows.

### 3.2 Collapsed (64px)

- Every row becomes a 42×40 icon button with a right-side `Tooltip` showing its label.
- The project tree becomes:
  - The initials tile.
  - The page icons, set between two hairlines so they read as one group.
  - More, which becomes a `MenuButton` (`iconOnly`, `side="right"`) that lists the secondary pages.
- Counts are hidden.
- The Jobs badge stays as a small corner badge.
- The collapse button becomes "Expand sidebar".

### 3.3 Accessible names

- The landmark stays `<nav aria-label="Main navigation">`.
- A link's accessible name is its label followed by its count when it has one, in both states, for example "Images 1" or "Findings 12". Collapsing therefore does not change how tests and assistive tech find a link.
- The active link carries `aria-current="page"`.
- The tree is nested `<ul>` lists, not an ARIA `tree`, because these rows are links and not a widget.

## 4. Collapse behaviour

The collapsed state is derived in one pure function, `sidebarCollapsed(stored, forced, override)`:

- `stored` is the operator's preference from `kestrel.sidebar`.
- `forced` is true on the full-bleed and workspace layouts (`layoutOf(...)` is `"fullbleed"` or `"workspace"`: Maps, Asset models, the point cloud workspace, Images and the report builder) and when the window is narrower than 1100px. The 1100px threshold is the same one the inspector already uses.
- `override` is a per-visit choice. It is cleared whenever `routeInfo(...).transitionKey` changes.

The rules:

- On a forced route, the sidebar is collapsed unless the operator expanded it on this visit.
- Elsewhere, the stored preference applies.
- The toggle (the button or Ctrl+B) sets `override` on a forced route. Elsewhere it flips and persists `stored`.
- Expanding on a forced route pushes the content over; it does not overlay it.
- The width animates over `--dur-base`, which is 0 under reduced motion, so it is instant there. (`--dur-fast` is not reduced, so it would keep animating.)

Ctrl+B is added to `GLOBAL_KEYS` in `ui/keymap.ts` as `toggle-sidebar`, "Show or hide the sidebar", so the `?` sheet lists it.

- Plain `B` (the Box tool in Images) is untouched.
- Like the palette shortcut, Ctrl+B is ignored while focus is in a text field.

Amended 2026-10-03 during implementation: the workspace layout is forced too (see the ADR).

## 5. Top bar

- The breadcrumb (`Crumbs`) is removed.
- The top bar's left side shows the page name as plain text in `text-lg font-semibold`. It is not a heading, because screens own their `h1`. The name comes from:
  - **Inside a project:** `routeInfo(pathname).page`, e.g. "Findings" or "Runs". It falls back to "Project" when that is null.
  - **Elsewhere:** the section label, then " · sub-page" when the sub-page differs (e.g. "Models · Datasets", "Settings · About", "Projects · New project").
- Everything else in the top bar is unchanged.
- The project's live `StatusDot` moves from the breadcrumb to the sidebar's project row.

## 6. Components and files

| Unit | Files | Purpose |
| --- | --- | --- |
| Nav model | `app/routeModel.ts` (extend) | `sidebarCollapsed()`, `isForcedCollapse(info, width)`, `topBarTitle(info)`; reuse `PROJECT_TABS`, `SECONDARY_PAGES`, `RAIL_ENTRIES`, `railHref` |
| Sidebar store | `app/sidebarStore.ts` (new) | zustand: `stored` (persisted, `kestrel.sidebar`), `override` (per visit), `toggle(forced)`, `clearOverride()` |
| Sidebar | `app/Sidebar.tsx` (new), `app/SidebarProjectTree.tsx` (new) | The component in sections 3 and 4; the tree is split out to keep each file small |
| Shell | `app/Shell.tsx` | Grid becomes `grid-cols-[auto_minmax(0,1fr)]`; renders `Sidebar`; drops `ProjectTabs`; clears the override on a transition key change |
| Top bar | `app/TopBar.tsx` | Replaces `Crumbs` with the title from `topBarTitle` |
| Keymap | `ui/keymap.ts` | `Ctrl+B` → `toggle-sidebar` |
| Removed | `app/Rail.tsx`, `app/ProjectTabs.tsx` and their tests | Replaced by the sidebar |
| Gallery | `ui/gallery/sections/` | One section showing the sidebar expanded and collapsed, inside and outside a project |
| Docs | `DESIGN.md` § Shell, `vault/decisions/2026-10-03-sidebar-replaces-rail-and-tabs.md` | Describe the new shell; record why the tabs went (location in one place) |

`Tabs` itself stays in `ui/`. Models, Catalogue and other screens still use it.

## 7. Error handling

- **Project fails to load.** The tree still renders with "Project" and every page link works, because the links only need the route's `projectId`. The failure is logged through `pushLog`, as today.
- **Counts unavailable.** The rows render without counts.
- **`localStorage` throws or is empty.** The sidebar defaults to expanded and the session works. A failed write is ignored.

## 8. Testing

**Unit tests (vitest + Testing Library):**

- **`sidebarCollapsed` and `isForcedCollapse` truth table:** stored on/off × forced on/off × override on/off, the 1100px boundary, and each full-bleed route.
- **`topBarTitle`:** every route in the router table, including `/about`, `/projects/new` and a secondary project page.
- **Sidebar in an app section:** no tree is shown; the active row has `aria-current`; the Jobs link keeps `?project=`; the Jobs badge shows the active job count and hides at 0.
- **Sidebar in a project:**
  - The nine page links have the right hrefs and counts.
  - More starts closed and opens on click.
  - More is open on `/p/:id/runs`, and the Runs link is current.
  - The parent rows are not `aria-current`.
- **Collapsed:** links keep their accessible names; tooltips show; More becomes a menu that navigates.
- **Store:** persists `stored`; tolerates a throwing `localStorage`; Ctrl+B toggles; Ctrl+B is ignored in an input.
- **Shell:** no `tablist` on any project route; full-bleed routes render collapsed; the override clears on navigation.

**e2e (Playwright).** These specs move from `getByRole("tab")` to sidebar links: `nav = getByRole("navigation", { name: "Main navigation" })`, then `nav.getByRole("link", { name })`, with `aria-current="page"` replacing `aria-selected`.

- `boot`
- `clouds`
- `clouds-workspace`
- `foundation-journey`
- `images-annotate`
- `images-flight`
- `pointcloud-foundation`
- `setup-real-backend`
- `shell`

`models-workspace` matches an in-page tab ("parts") and is unchanged.

`shell.spec.ts` gains these checks:

- Collapse by button and by Ctrl+B persists across a reload.
- Maps opens collapsed and expanding there does not persist.
- A 1000px-wide window starts collapsed.
- The page title replaces the breadcrumb.

**Gate:** the full AGENTS.md gate. `contract check` and pytest run unchanged and must still pass.

## 9. Execution DAG

**Units:**

- **U1 (Nav model and store).** `routeModel` additions, `sidebarStore`, and the keymap entry, each with unit tests. Pure functions and no UI.
- **U2 (Sidebar component).** `Sidebar` and `SidebarProjectTree` with unit tests and the gallery section. Depends on U1.
- **U3 (Shell integration).** Shell and TopBar changes, deleting Rail and ProjectTabs, and updating the Shell and TopBar tests. Depends on U2.
- **U4 (e2e migration).** Moves the nine specs to sidebar links and adds the new shell checks. It depends only on the accessible names fixed in section 3.3, so it can be written in parallel with U3, but it is run after U3.
- **U5 (Docs).** DESIGN.md Shell section and the ADR. Depends only on this spec.

**Batches:**

1. U1 and U5 in parallel.
2. U2.
3. U3 and U4 in parallel, in one worktree with separate files, so there is no merge conflict.
4. Gate, then merge.

**Critical path:** U1 → U2 → U3 → gate.

## 10. Operator walkthrough (after merge)

1. Open the app. The sidebar shows labels: Projects, Models, Catalogue, Jobs, then Settings at the bottom.
2. Open a project. Its name appears under Projects with its nine pages, and Overview is highlighted. There are no tabs above the page.
3. Click Findings. The Findings row is highlighted, and the top bar says "Findings".
4. Click More, then Runs. The Runs row is highlighted and More stays open.
5. Press Ctrl+B. The sidebar shrinks to icons, and hovering one shows its name. Restart the app and it is still collapsed.
6. Expand it again and open Maps. The sidebar is collapsed. Expand it there, go to Findings, then back to Maps; it is collapsed again.
7. Narrow the window below 1100px. The sidebar collapses on its own.
8. Start a detection. The Jobs badge shows 1 and the project row's dot pulses.
