---
type: session
date: 2026-10-04-2110
branch: main
trigger: wrapup
status: complete
tags: [session]
related: ["[[2026-10-03-gotcha-sqlite-rebuild-cascades-children]]", "[[2026-10-04-1900-plant-model-generator-g1]]"]
---

# 2026-10-04-2110-asset-findings-p1

## What changed

- **Artifact port phase 1, "findings on the asset", is complete on `main` and pushed** (`bfab9c8a..97d29d52`, 2026-10-03..04). Spec `docs/superpowers/specs/2026-10-02-asset-findings-design.md`, index `docs/superpowers/plans/2026-10-03-asset-findings.md`.
- **Build.** 16 units plus the X close-out ran as SDD under one opus unit controller each, in `af-<unit>` worktrees. Merges were serialized through `af-int` with the full gate. Unit merges on `main`:
  - C0 `bfab9c8a`
  - D1 `ccf71a0a`, P1 `404847b7`, U1 `f910243d`, U4 `a907d52e`
  - D2 `0ae37793`
  - J2 `cc312593`, U5 `8b04b060`
  - J1 `3b607228`
  - U6 `bc25bad3`, J4 `f30fdcb4`
  - J3 `41672d88`
  - U2 (carrying U3) `c8cf1f5d`, R1 `00ab67cd`, J5 `835cab34`
  - X `97d29d52`
  - Catch-up merges for other sessions' commits: `4ab2925e`, `e692e56e`, `a073b3c8`, `267c665f`, `f764817e`.
- **Contract (C0).** All §8 operations went in as 501 stubs, then each owning unit routed them.
- **Data.**
  - Project migration 0016 rebuilds `finding` with foreign keys off and writes its own backup (D1).
  - Catalogue 0004 adds `brand` (D2).
- **Profiles and frame.** Review profiles, the frame model, height/bearing/side/zone derivation, and findings-map geometry with its TypeScript twin (P1).
- **Jobs.**
  - `asset_glb_import` (J1).
  - `asset_pose` (J2).
  - `asset_place`, with the numpy ray caster and patch files (J3).
  - `asset_group`, with merge, split and Regroup (J4).
  - `review_kit_import`, with dry run, replay and masks; this adds `ijson==3.5.1` (J5).
- **UI.**
  - The engine gains placements, cameras, ghost, ground and view-from-pose (U1).
  - The asset workspace moves onto WorkspaceRail, with Findings and Photos topics and the "Import inspection review" dialog (U2).
  - Split inspection route `/p/:id/models/:modelId/inspect` (U3).
  - Register columns, gallery and photo outcome chips (U4).
  - Overview asset hero and findings map (U5).
  - Brand editor (U6).
- **Reports (R1).** Asset summary, asset finding pages with a 3D locator, the `asset_sightings` CSV, brand in the PDF, and a no-dash grep test.
- **X close-out.** The synthetic real-backend e2e, plus three operator-ruled product changes:
  - `4d51cc19`: an EBSM photo whose mask is all sub-floor fragments keeps its largest fragment as one sighting;
  - `e643692d` + `eeed7582`: a "Keep every photo" import option (`keep_duplicates`, default off), with a hint in the kit dialog;
  - `08af9a24`: photo-unit findings read "N regions on 1 photo".
- **Evidence** in `docs/evidence/asset-findings/` (numbers and text only):
  - `damac-replay.md`: 4,538/4,538 photos; 656 findings (182/474); 1,441 sightings; 715/625/101 patch/point/none; 45 uncertain; CSV 1,441/1,441 rows agree.
  - `damac-recompute.md`: 652 findings; median 0.0031 m; kind targets amended (operator ruling).
  - `ebsm-replay.md`: 78 findings (77/1); 53/159/9; 78 patches.
  - `reports.md`: e& PDFs with 0 dashes and /SMask 0.
  - `walkthrough.md`.
- **Gate on the X merge (`97d29d52`):**
  - pytest and vitest green; on the X branch: 7,528 backend, 4,850 frontend, cargo 8.
  - e2e 204 of 205: `images-annotate` failed under load and passed 2/2 alone.
- **Installer** built from `97d29d52`. `smoke_frozen` passes, including `review-import ok yajl2_c`. Copied to `.superpowers/sdd/af-common/Kestrel AI_0.1.0_x64-setup-97d29d52.exe` (893 MB). **Not installed.**
- **Rulings.** Every ruling from the coordinator and unit ledgers is collected in `docs/evidence/asset-findings/rulings.md`.

## Why

- **Goal.** Findings now live on an asset model the way the EBSM and DAMAC review artifacts do: posed photos look at a GLB, sightings land as pins or textured patches and group into findings with height, side and zone, and the register, Overview, CSV and branded PDF show the same numbers.
- **Acceptance.** Replaying both customer kits reproduces their counts.

## Open threads

- **Install and walk.** The operator installs the `97d29d52` installer and walks `docs/evidence/asset-findings/walkthrough.md`. Street map textures were checked in a browser only, not yet in the packaged app.
- **Operator rulings during acceptance:**
  - the EBSM sub-floor fragment rule;
  - keep-every-photo;
  - recompute kind targets amended: the spec's rectangle = pin rule turns 27 kit rectangle patches into pins and 2 into none;
  - the "N regions on 1 photo" wording.
- **Deferred minors** (in the unit ledgers and `rulings.md`):
  - after a recompute regroup, Overview's recent-findings strip lists closed findings whose thumbnails 404;
  - the report preview shows a 3D placeholder until a render warms the mesh cache;
  - a finding with 0 sightings prints "1 region";
  - the kit GLB is not X/Z-centred (sides still agree);
  - J3 has no cached BVH (DAMAC placement took 180 s);
  - `asset_group` can 409 J3's follow-up if a group job is live;
  - flaky under load: `images-annotate` and the review-import e2e, `lazyScreens` "loads Point clouds", and trainer/stats tests.
- **Clean-up:**
  - worktrees `af-x` (holds build artefacts) and `af-int` are still on disk;
  - the git-ignored ledgers live in `.superpowers/sdd/af-common/`;
  - about 30 GB of acceptance photo copies are under `...\Kestrel AI Reference Pack\_work\af-acceptance\`; delete when done.
- **Tooling.** `scripts\start-task.ps1` fails on PowerShell 5.1: the `git fetch` stderr trips `$ErrorActionPreference = 'Stop'`. All af worktrees were cut by hand.

## How to test

1. Install `.superpowers\sdd\af-common\Kestrel AI_0.1.0_x64-setup-97d29d52.exe`.
2. Open a project with drone photos, then go to Asset models, create a model, and use **Import a GLB…**. Expect a version that says "Imported", the 3D view, and a populated part list.
3. Set a review profile and frame. Run **Estimate poses**, then **Compute placements**. Expect camera glyphs on the model, and pins and patches on the defects. Grouping runs on its own afterwards.
4. Findings register with Source = Asset: expect Height, Side, Zone, Component and Sightings columns. Open a finding: the split inspection opens, with the model turned to the finding and the photo on the right. Hold Space to compare, and use J and K for the next and previous finding.
5. On the model, use **Import inspection review…** with a kit folder. The dry run lists matches and unmatched photos and shows the class mapping; the import creates the findings. If photos are unmatched, re-import the photo folder with **Keep every photo** on.
6. Overview: the asset hero turns slowly beside the "Findings on the asset" map. Click a dot to open its finding.
7. In App settings, Report brands, pick e&, then render a report with Asset summary and asset finding pages. Expect the brand cover and logos, and a 3D locator on each finding page.
8. Full detail: `docs/evidence/asset-findings/walkthrough.md`.

## Next session entry point

- **First:** the operator's install and walkthrough.
- **Then:**
  - remove `af-x` and `af-int` with `.superpowers/sdd/af-common/remove-worktree.ps1`;
  - delete the acceptance scratch;
  - fix `start-task.ps1` for PowerShell 5.1.
- **Next for the programme:** artifact port P2 per `docs/artifact-to-kestrel-plan.md`, together with G2 (points and pictures on plant items).
