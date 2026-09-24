---
type: session
date: 2026-09-24-0622
branch: main
trigger: wrapup
status: complete
tags: [session]
related: ["[[2026-09-23-library-jobs-reuse-the-project-jobrunner]]", "[[2026-09-23-counts-live-on-run-rows]]", "[[2026-09-24-gotcha-finish-task-rebase-drops-merge-resolutions]]", "[[2026-09-23-1703-survey-timeline]]"]
---

# 2026-09-24-0622-train-detect-split-and-library

## What changed

The work was built by parallel agents in `tds-*` / `dw-*` task worktrees, merged one at a time into an integration branch, then landed on `main` in two fast-forwards. Both landings were pushed to `origin/main` by `finish-task.ps1` or its equivalent steps.

- **Design:** `34a4d71` is the spec `docs/superpowers/specs/2026-09-23-train-detect-split-and-model-library-design.md`. It was brainstormed with the operator. The operator's choices:
  - standalone library models
  - the library stored in app data
  - existing projects become training projects
  - a detection project is a site monitored over time
  - analytics are counts per class/source, per area, review/verified, and export
  - a per-project class list
  - "send to training" deferred

  The spec was revised once before it was written, after the superseded frame-count measurements and the survey timeline showed that photo batches can't give object counts.
- **Plan 1, model library and project kinds:** landed `d01a7cb..c9f88e2` (71 commits; plan `8411dc6`).
  - An app-wide `library.db` under `%APPDATA%\kestrel-ai\library`, with `/library/*`. Library jobs run on the existing JobRunner through a project-shaped handle.
  - `Project.kind` (`train|detect`), with a per-route kind guard and a route-walk test.
  - Kind-specific sidebars and a Library screen.
  - Adoption of old per-project models into the library as a background job, with ids rewritten and nothing deleted.
  - Past detections are read-only in training projects, with move-map into a detection project.
  - Our migration was renumbered to `0007_project_kind` because the survey timeline had taken `0006`.
  - Gate at landing: 1088 backend, 713 frontend, 69 e2e.
- **Plan 2, detection workspace:** landed `c9f88e2..f7d7ab6` (61 commits; plan `fd597be`).
  - Migration `0008_detect_workspace`.
  - Sources carrying a survey date; runs that take a library model plus a one-time class mapping (`422 unmapped_classes`); pinning; review of map and photo detections with counts incremented in the same transaction.
  - Site areas in WGS84 projected onto each map; the Analytics screen, which absorbs Surveys, with total (verified).
  - CSV, a PDF report per source (new dependency `reportlab==5.0.1`, added to `kestrel_backend.spec`) and GeoPackage additions.
  - Gate at landing: 1269 backend, 796 frontend, 76 e2e. `cargo test` was skipped (no frozen sidecar).
- **Decisions made in the build that differ from the spec:**
  - Query runs stay open in training projects, because assisted labelling uses them. The new `/runs` API is detection-only.
  - `MapRun.counts` keeps its shape and means total; `verified_counts` and `area_counts` are new columns, so no data is rewritten.
  - Site-area membership is a box-centre test, with no polygon clipping.
  - Surveys is detection-only and `/surveys` redirects to Analytics.
- **ADRs:** `vault/decisions/2026-09-23-library-jobs-reuse-the-project-jobrunner.md` and `2026-09-23-counts-live-on-run-rows.md` (written by the build agents); `2026-09-24-gotcha-finish-task-rebase-drops-merge-resolutions.md` (this wrap-up).
- **Walkthroughs:** `docs/usability/2026-09-23-library-walkthrough.md` and `docs/usability/2026-09-23-detection-workspace-walkthrough.md`.

## Why

The operator wanted training and detection to be clearly separate kinds of work, with every model in one shared place so a detection project can pick any of them. Detection projects are for monitoring a site over repeated surveys with checked counts.

## Open threads

- **Not installed.** A rebuild was started this wrap-up and stopped at the operator's request before it wrote anything; the sidecar binary is still the 2026-09-23 16:12 build. The operator will rebuild once the other session (`model-gsd` / `pointcloud-*`) lands.
- **The frozen sidecar with `reportlab` has never been built or smoke-tested.** The PDF export is proven only in pytest. Dispatch CI `sidecar-smoke` after the rebuild.
- **Adoption and migration have never run against the operator's real projects,** only against test fixtures built at revision 0005. Back up a real project folder before the first open on the new build.
- ONNX model import and video sources are out of scope, each needing its own spec. The library's `format` field has room for ONNX.
- **The "Send to training project" loop** from reviewed detections is designed-for but not built.
- **`finish-task.ps1` rebases unconditionally.** On Plan 2 that rebase conflicted, and the landing ran the script's remaining steps by hand. See the gotcha ADR.
- **`GET /survey-timeline` is readable from training projects.** Harmless, but inconsistent with Surveys being detection-only in the UI.

## How to test

1. Rebuild and install (freeze the backend, then `pnpm build:installer`), then open the app.
2. **Library** (app-level sidebar): add a starter model and import a `.pt` file. Each row shows its origin; the detail shows provenance and lets you edit notes and the supplier.
3. **Open an existing project:** it is a training project, and after a short background job its models appear in the Library. If it had detection runs or maps, "Past detections" shows them read-only.
4. **Create a detection project** (Projects → Detection project). The sidebar shows Sources, Runs, Review, Analytics, Export and Site areas.
5. **Sources:** add a map and a photo folder. The survey dates are filled from the files and can be edited.
6. **Runs → New run:** pick a library model. The first run fills the empty class list; a later model with other class names asks for the mapping once.
7. **Review:** open the map source and use A, R, a digit and N; "Accept all ≥ 0.80" runs as a job. Progress reads "N of M reviewed".
8. **Site areas:** draw an area on the map. **Analytics:** Surveys (with the verified-only toggle), per source, per area, and photo batches captioned as detections.
9. **Export:** the CSV of all sources and a PDF for one source. The PDF opens and shows total/verified and the method footnote.

The full steps are in the two walkthroughs listed above.

## Next session entry point

Rebuild and install once the other session lands, then run both walkthroughs on the installed app with a real orthomosaic and a copy of a real training project (to watch adoption). Then dispatch `sidecar-smoke`. After that: the ONNX import spec, and the de-machinery pass.
