---
type: session
date: 2026-09-26-0144
branch: task/design-surfaces
trigger: wrapup
status: complete
tags: [session]
related: []
---

# Design surfaces (S3) Task 17 — acceptance on the chimney site, walkthrough, evidence, ledger

## What changed

Worked in `E:\Dev\Yolo\app\.claude\worktrees\design-surfaces` on `task/design-surfaces` (tip before
this block `d581a10`, "merge: S3 final-review fixes"; S1 point clouds and S2 volumes already merged
in from `main`). One commit this block, `2633708` "docs(design): acceptance on the chimney site,
walkthrough, evidence and ledger". No product code changed:

- `backend/scripts/design_acceptance.py` (new) — the brief's generator: from a DSM `surface.tif` it
  writes `site-nez.xml`, `site-enz.xml`, `site-3dface.dxf`, `site-contours.dxf`,
  `site-dem-32638.tif` and `perf-1m.xml`. One deviation from the brief: it puts `backend/` on
  `sys.path`, because run as a file (`python scripts\design_acceptance.py`) it failed with
  `ModuleNotFoundError: No module named 'app'`.
- `docs/evidence/design-surfaces/` (new) — `README.md` with the measured table, `acceptance-raw.json`
  (API responses, WKT and scratch paths trimmed) and four preview PNGs.
- `docs/usability/2026-09-24-design-surfaces-walkthrough.md` (new) — 14 operator steps.
- `docs/progress.md` — the "Design surfaces (S3)" entry above the Volumes S2 one, with the gate counts
  and the follow-ups.

The acceptance ran headless, as ruled. The real backend ran from this worktree on port 8791 with
`APP_DATA_DIR` in the session scratchpad, never the operator's app data. `KESTREL_POTREECONVERTER`
pointed at the verified converter in the `point-clouds-t18` worktree. Every step went through the
HTTP API. The measured results:
- chimney.las (21.7 M points) imported in 10.05 s, and the DSM (0.5 m, 1374 × 1404) built in 9.87 s.
- The five §15.4 steps all pass. LandXML N E Z: 98.4 % overlap, median dz +0.005 m. E N Z: 0 %, then
  98.4 % after Apply swap. 3D faces: 98.4 %. Contours: 88.2 %, +0.067 m, 3 559 long triangles trimmed
  at 6.1 m. EPSG:32638 DEM: `dem_resample`, 100 %, −0.012 m. An S2 volume against each of the five
  designs ran.
- §16.11 timing: the 1 M-point / 2 M-face LandXML inspected in 7.90 s and built onto 4996 × 4996 at
  0.2 m in 8.38 s. The target is under 60 s for each.
- The wrong-foot preview, the DWG 422 and the delete 409/204 behaved as the spec says.

Gate, run with this worktree's overlay interpreter:
- contract check ok
- ruff and ruff format ok (403 files)
- pytest 1969 passed, 9 skipped, 9 deselected
- frontend lint ok (1 old warning)
- unit tests 982/982 (200 files)
- build ok
- e2e 91/91, on free ports 14731/14732
- `cargo test` skipped: there is no frozen sidecar in this worktree

## Why

Task 17 closes the S3 plan. It proves the importer on real data (the chimney cloud → DSM → a
synthetic design in every format) and records the numbers, the walkthrough and the ledger entry
before the controller merges the branch.

## Open threads

- **The branch is not merged.** Per the controller's ruling, `finish-task.ps1` (Step 7) is the
  controller's to run under the cross-plan merge lock. This worktree stays until then.
- **The suggestions under-report their overlap** (a finding, not fixed). `validate._suggestions`
  scores on file vertices, orphans included, not on the footprint. On the chimney TIN it says 67 %
  where applying gives 98.4 %. The repro is in the evidence README under "Findings".
- **A ready surface has no Delete on the Volumes screen.** This is S2's design: only failed rows
  offer Delete.
- **Contour overlap was 88 %**, because Delaunay bridges the DSM's interior no-data areas. It was
  recorded, not judged against step 1's 95 %.
- **The walkthrough was not driven through the UI.** Its strings come from the component source,
  and its behaviour from the API run.
- The follow-ups from the reviews are listed in `docs/progress.md`, and include the packaging run's
  new `smoke_frozen.ps1` `design` step.

## How to test

Follow `docs/usability/2026-09-24-design-surfaces-walkthrough.md`:

1. Build a surface from the chimney cloud.
2. Generate the designs with `design_acceptance.py`.
3. Import each design from Volumes → **Import design surface**, and check the preview figures
   against `docs/evidence/design-surfaces/README.md`.

## Next session entry point

The controller runs `scripts\finish-task.ps1` for `task/design-surfaces`. After that, rebuild and
install, and walk the design-surfaces walkthrough in the installed app. Then decide whether to fix
the suggestion's vertex-based overlap score.
