---
type: session
date: 2026-10-03-1803
branch: main
trigger: wrapup
status: complete
tags: [session]
related: ["[[2026-10-03-sidebar-replaces-rail-and-tabs]]", "[[2026-10-03-sidebar-project-tree-design]]"]
---

# 2026-10-03-1803-sidebar-project-tree

## What changed

- **Sidebar project tree, merged as `056175f3` on `main` (not pushed).** Built on `task/sidebar` via subagent-driven development, then `main` was merged in (`e923a56d`, clean) before landing. 42 files, +1326/−458.
  - Spec `1d9636dd` (`docs/superpowers/specs/2026-10-03-sidebar-project-tree-design.md`) and plan `1bcb24c8` (`docs/superpowers/plans/2026-10-03-sidebar-project-tree.md`). Before that, an interactive prototype offered four options: https://claude.ai/artifact/T39pC8fR9KxwRJAJLCssWG. The operator chose A, the project tree.
  - `5f23ce6d`: route rules in `app/routeModel.ts` (`isForcedCollapse`, `sidebarCollapsed`, `topBarTitle`, `secondaryOf`).
  - `5bb663f6`: `app/sidebarStore.ts` (`kestrel.sidebar` in localStorage), `useSidebarShortcut` (Ctrl+B), `useWindowWidth`, and the keymap entry `toggle-sidebar`.
  - `f8de42fb`: `SidebarLink`, `SidebarProjectTree`, `SidebarView` and the `Sidebar` container, plus the gallery section "Sidebar".
  - `bc9e6076`: `Shell` renders `Sidebar`, and `TopBar` shows a plain page title. `Rail.tsx` and `ProjectTabs.tsx` were deleted, along with their tests.
  - `dd1824da`, `7e1f9285`: e2e specs find project pages as links in the "Main navigation" nav. New checks cover collapse persistence, full-bleed and narrow windows.
  - `66b59503`: **ruling** — the sidebar is also forced collapsed on the `workspace` layout (Images, report builder), not only full-bleed. Expanded, it left the Images canvas about 370 px wide at 1280 and broke e2e drawing.
  - `5320aa9b`: DESIGN.md § Shell, ADR [[2026-10-03-sidebar-replaces-rail-and-tabs]], and spec amendments (`--dur-base`, workspace forced).
  - Final-review fixes:
    - `b581cfb4`: focus is kept on collapse/expand. `Tooltip` gained an optional `disabled` prop, so the wrapper no longer remounts the link.
    - `e50880e0`: when collapsed, More is marked on secondary pages. `MenuItem` gained an optional `current`.
    - `3302c091`: the override is keyed to its page's transitionKey, and Ctrl+B ignores repeats and open modals.
    - `68232ff2`: nested rows fill their width.
- Gate on the merged tree (`e923a56d`): frontend lint 0, vitest 4445, build ok, e2e 192 passed / 8 skipped. The branch gate before catch-up also had contract check ok, ruff ok and pytest 5555 passed / 17 skipped. The backend and contract were unchanged by this branch. `cargo test` was skipped (no frozen sidecar in the worktree).
- Controller browser check at `/gallery.html`: expanded nested rows 168 px wide, and the active bar sits on the tree's guide line.

## Why

- The operator found the old navigation unintuitive: they couldn't tell where they were, and it looked off. Location was split across the icon-only rail, the breadcrumb and the 9-tab strip. Now one labelled column reads top-down as a path (Projects › project › page) and collapses to icons.

## Open threads

- **Operator question, unanswered.** On collapsed canvases (Maps, Point clouds, Asset models, Images), the project name only shows on hover of the AK tile, because the top bar is page-only per spec §5. Should the top bar read "Project · Page" there?
- **Workspace-layout forced collapse is a ruling the operator hasn't confirmed.** It is a one-line revert in `isForcedCollapse` plus docs.
- The width transition still animates on route-driven collapse changes (e.g. Findings → Maps). The `clouds-journey` "Back to 3D not stable" flake was attributed to that animation; it was not instrumented. If a canvas flake returns, animate only operator toggles.
- Deferred minors from the reviews:
  - The project row's live StatusDot is not announced to screen readers (the link's aria-label overrides it).
  - The sidebar scrolls when the window is shorter than about 760 px collapsed in a project (seen in the 640 px gallery frames).
  - There is no e2e asserting that Images opens collapsed.
  - Stale "tabs" wording remains in a few e2e comments.
- Not pushed and not installed. The installed app is still the 11:28 build.
- During the run, a haiku docs subagent wrote copies of 3 files into the main checkout. They were byte-identical to its commit and were reverted. Brief subagents with an explicit "never write outside the worktree" line.

## How to test

1. Run `pnpm -C frontend dev` (or build and install). Open the app. The left sidebar shows labels: Projects, Models, Catalogue, Jobs, then Settings and "Collapse sidebar · Ctrl B" at the bottom.
2. Open a project. Its name appears under Projects, with Overview, Images, Maps, Drawings, Point clouds, Asset models, Findings, Measurements, Reports and More. Overview is highlighted, and there is no tab strip above the page.
3. Click Findings. The Findings row is highlighted, and the top bar says "Findings".
4. Click More, then Runs. Runs is highlighted and More stays open.
5. Press Ctrl+B (not in a text field). The sidebar becomes an icon column; hover an icon to see its name. Close and reopen the app: it is still collapsed. Press Ctrl+B to expand.
6. Open Maps. The sidebar is collapsed. Click the expand chevron, go to Findings, then back to Maps: it is collapsed again. The same happens on Images.
7. Make the window narrower than 1100 px on Findings. The sidebar collapses by itself.
8. Start a detection. Jobs shows a badge with 1, and the project row's dot pulses.

## Next session entry point

- Get the operator's answer on "Project · Page" in the top bar for collapsed canvases, and confirm the Images collapse ruling. Then build and install an installer from `main` (it would also carry `26a3b90a` and the asset-findings merges).
