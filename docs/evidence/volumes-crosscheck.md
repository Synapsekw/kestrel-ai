---
type: evidence
date: 2026-09-25
tags: [evidence, volumes, acceptance]
---

# Volumes cross-check against CloudCompare 2.5D Volume (spec §7.3)

File: `Chimney stack 3D_group1_densified_point_cloud.las` (21 697 184 points, EPSG:32639), staged as
`chimney.las` in the session scratchpad. CloudCompare 2.13 is **not installed** on the build
machine (checked 2026-09-24: `where CloudCompare` finds nothing, no `C:\Program Files\CloudCompare`)
— the operator installs it and runs this cross-check by hand (task-17 brief, Step 6). No Kestrel
run at these exact settings has been recorded yet either: Task 17's acceptance
(`docs/evidence/volumes-acceptance.md`) ran at **module level**, calling `app.surfaces.build` and
`app.volumes.engine` directly (no app, no import UI), because S1's point-cloud import screen is not
on `main` yet — see the ruling below. That module-level run used its own mound polygon and the
Kestrel-default build (median, auto cell, fill gaps 1 m), not the rectangle-R / Mean / 0.1 m / 0.25 m
settings this cross-check calls for, so the two data sets are not directly interchangeable; the
"Kestrel defaults — information" row below reports what the module-level run actually measured, for
context, with that caveat.

**Every row below is still open.** Rectangle R and ground level H are the operator's to record from
CloudCompare's own view of the cloud (spec §7.3), and the Kestrel-side cells at those exact
settings (Mean, cell 0.1 m and 0.25 m, no fill, no despike, "Drop points classed as noise" off) have
not been run — they need the same UI path once S1's import lands on `main`, or a operator-run
against the CloudCompare rectangle if done sooner. The two-surface rows need the same rectangle and
H reproduced on the +0.100 m copy.

Rectangle R: **operator** (about 100 × 80 m, corners on 0.1 m multiples — record from CloudCompare).
Ground level H: **operator** (heights as stored: ellipsoidal).

| Step | CloudCompare Added | Kestrel fill | Δ | CloudCompare Removed | Kestrel cut | Δ | CC Surface | Kestrel area | Δ | Pass (≤ 0.5 %) |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 0.1 m, mean, no fill, no despike, all classes | operator — CloudCompare not installed on the build machine | not run at module level (needs rectangle R + Mean/0.1 m) | — | operator — CloudCompare not installed on the build machine | not run | — | operator — CloudCompare not installed on the build machine | not run | — | pending |
| 0.25 m, same settings | operator — CloudCompare not installed on the build machine | not run at module level (needs rectangle R + Mean/0.25 m) | — | operator — CloudCompare not installed on the build machine | not run | — | operator — CloudCompare not installed on the build machine | not run | — | pending |
| Kestrel defaults (median, auto, fill) — information | n/a | see note | n/a | n/a | see note | n/a | n/a | see note | n/a | n/a |
| Two-surface: ground = +0.100 m copy, no shift | operator — CloudCompare not installed on the build machine | 160.000 m³ (mound polygon, not rectangle R — see note) | — | operator — CloudCompare not installed on the build machine | 0.000 m³ (mound polygon) | — | operator — CloudCompare not installed on the build machine | 1 600 m² (mound polygon, 40 × 40 m) | — | pending |
| Two-surface, stable area, shift applied: net vs ± U | — | net = 0.00246 m³ | | — | ± U = 0.00048 m³ | | | | | pending (see the ruling below: counted a pass in substance, fails by the letter) |

Note on the "Kestrel defaults — information" row: the module-level acceptance built a surface with
the API defaults (median, auto cell 0.5 m, fill gaps 1 m) and measured a 40 × 40 m polygon over the
chimney base with three base kinds — `toe_plane` net 63 781.3 m³ (± 5 012.0, `base_fit_poor`),
`toe_surface` net 59 621.3 m³ (± 327.8, no warnings), `flat` @ −44.004 m net 67 205.4 m³ (± 15.0,
no warnings). Full detail: `docs/evidence/volumes-acceptance.md` §B. This is offered as
informational context only — the polygon and settings do not match rectangle R, so it is not a
substitute for the CloudCompare comparison rows above.

Note on the two-surface rows: the module-level run in `docs/evidence/volumes-acceptance.md` §C is a
genuine two-surface, alignment-shift test (the same mechanism §7.3 exercises) — no-shift fill/cut/net
and the shift-applied net vs. ± U are both recorded there, on the same 40 × 40 m mound polygon and a
separate stable-area polygon (bare ground about 100 m west of the stack). Those Kestrel-side numbers
are filled in above for reference, but the CloudCompare columns and the rectangle-R geometry are
still the operator's to run.

Screenshots: `docs/evidence/volumes/cc-*.png` (CloudCompare dialogs and reports, operator) and
`docs/evidence/volumes/kestrel-*.png` (the Results panel for each row, waits on S1's point-cloud
import UI landing on `main` so the in-app Volumes screen can be driven — the module-level run has no
UI to screenshot). `docs/evidence/volumes/results.png` (Task 16's 1280 px layout check) already
exists and is unrelated to this cross-check.

## Why the in-app rows are not filled in

The SDD ledger (`.superpowers/sdd/2026-09-24-volumes/progress.md`) records the controller's ruling:
Task 17 acceptance runs at module level (`build_surface` + the volumes engine on the real chimney
LAS, its +0.100 m copy and a 195 M-point 3×3 tiling, called directly with no app, no job runner, no
database) because S1's point-cloud import UI is not on `main` yet; the in-app walkthrough and the
CloudCompare/QGIS cross-checks are recorded as operator steps pending S1. Merging S2 (Volumes) is
not blocked on S1. Once S1's import lands on `main`, the operator repeats Steps 1–7 of the task-17
brief end to end (import the three clouds through the Point clouds screen, build the surfaces from
the UI, run the CloudCompare and QGIS cross-checks) and fills in every "operator" / "not run" cell
above with real numbers and screenshots.
