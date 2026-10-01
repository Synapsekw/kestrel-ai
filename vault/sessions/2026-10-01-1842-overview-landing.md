---
type: session
date: 2026-10-01-1842
branch: main
trigger: wrapup
status: complete
tags: [session]
related: ["[[2026-10-01-gotcha-subagent-non-ascii-commits-as-replacement-char]]"]
---

# 2026-10-01-1842-overview-landing

## What changed

- **Project landing (Overview v2) on `main`.** Range `35534daf..335c37fb`, fast-forwarded and pushed. 57 files changed, +5334/−136 against the base. It went through brainstorm, spec, plan, and then SDD with per-task reviews and a final opus review.
  - Spec: `docs/superpowers/specs/2026-09-30-project-landing-design.md` (`36bd4d98`, amended `0605f3ac`, `fcb2c008`)
  - Plan: `docs/superpowers/plans/2026-09-30-project-landing.md` (`0605f3ac`)
- **Backend and contract** (`d3f70a01`):
  - `ProjectOverview.hero` was added. It picks a ready map, else a ready point cloud, else the images, else a ready drawing. Every candidate query always runs, so the `/overview` statement-count pin holds.
  - `GET /overview/site` returns the site bounds by priority (map, then cloud, then photo GPS), plus up to 500 photo points. These come from one keyed `rowid IN (…)` read and never scan `image`. Code: `backend/app/overview/site.py`, tests: `tests/test_overview_site.py`.
- **Frontend** (`frontend/src/overview/`):
  - `composeOverview(facts)` decides the panes and grid placement (`924dc41e`). There is no `max-w-[1400px]`, and the grid fills `main` (`10bb257a`).
  - New panes:
    - `HeaderStrip`: coordinates and their source, plus only the non-zero figures.
    - `SiteLocation`: an offline SVG.
    - `CloudPreview`: lazy `CloudViewer` with 1 M / 300 k point budgets, a local error boundary, a static card and an Auto-probe gate.
    - `ImageMosaic` and `ImageryPane`.
    - `SummaryHero`.
    - `StatusPane`: severity bars, active jobs and 3 activity lines. It replaces the 8-row activity pane (spec D7).
    - `FirstData`, for an empty project.
  - `KpiRow.tsx` was deleted.
- **Final-review fix wave** (`077fe88e..893bb857`):
  - The live 3D preview rendered 0 px tall, because `CloudViewer` needs a flex parent.
  - A cloud failure escaped to the app-level error boundary.
  - Empty image panes appeared after a failed read.
  - `image_sets` counted as data during a first import.
  - The Status pane clipped its content.
  - The cloud pane showed misleading copy.
  - The preview landed inside the Auto frame-probe window.
- **New e2e tests:**
  - `frontend/e2e/overview-landing.spec.ts`: fill at 1920 and 2560, scroll at 1366×768, and the empty project.
  - `frontend/e2e/overview-landing-cloud.spec.ts`: the live canvas height under SwiftShader.
- **Gate on `9728d5b6`:**
  - `pnpm -C contract check` and ruff passed.
  - pytest: 4787 passed, 16 skipped.
  - Frontend: 3769 passed. Lint passed with 0 errors. The build passed.
  - e2e: 167 passed, 1 skipped.
  - cargo was skipped because there is no frozen sidecar.
  - After the final `main` sync (`335c37fb`), the focused re-check passed: `test_contract` + overview at 297 passed, overview/api vitest at 302 passed, and the build.

## Why

- The Overview was centred in a 1400 px column and used about half the window height. The operator wanted a landing screen that fills any screen and shows previews, the location and a 3D/map preview without empty containers, so panes now depend on the data the project actually has.

## Open threads

- **Operator design calls, not yet confirmed in use:**
  - D7 folds Activity and Running jobs into one Status pane.
  - The header shows coordinates only, with no place name. Reverse geocoding is deferred.
  - RecentFindings scrolls inside its pane instead of clipping by rows.
- **Not verified on real data or a real GPU:**
  - The live point-cloud preview, which e2e only proves under SwiftShader.
  - The map hero with real tiles.
  - The photo-GPS location plot.
  - The behaviour of a 1366×768 laptop window. e2e asserts a scroll and a ≥340 px hero.
- **Parked, each with a ruling in the SDD ledger** (copy at the session scratchpad, not in git):
  - The contract has only one `OverviewSite`/`ProjectOverview` example; there are no Prism examples for the four data states.
  - When an images read comes back empty, the imagery pane flashes for a frame.
  - `site.py` keeps `source = "map"` briefly when the map bounds are null. The result is still correct.
  - The `bbox_area_m2` antimeridian case.
  - A few untested minors: the SummaryHero "No data yet." line, and the RunningJobs `bare`/`hideWhenIdle` defaults.
- No installer was built this block.

## How to test

1. Run `pnpm -C frontend dev` with the backend, or install a build from `main` at or after `335c37fb`. Open a project that has an orthomosaic and a point cloud.
2. Look at the Overview at full screen. The grid should reach the bottom of the window with no centred column. The header shows `lat° N lon° E · from ortho` and only non-zero figures. The map hero sits on the left, the 3D tile above the Location pane on the right, and findings, imagery and Status run along the bottom.
3. Drag the 3D tile. It orbits, and it never spins on its own. Turn on Settings → reduced effects. The tile becomes a static card with "Open in Point clouds".
4. Open a project with photos only. The hero is a photo mosaic (each tile opens the image). The Location pane shows the flight pattern of photo points, and the header says `from ~N photos`.
5. Create a new project. You should see only "Add the first survey" and the "What each kind of data unlocks" list. Import photos; when the import finishes, the dashboard appears.
6. Resize the window to about 1366×768. The page scrolls, and the panes are not squashed.

## Next session entry point

- Run the How to test steps above on real projects and decide on D7, the place name and the findings scroll. Then pick up the Reports (R) wave, which a parallel session is merging on `main` (`r-r*` merges in `git log`).
