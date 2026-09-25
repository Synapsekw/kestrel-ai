---
type: session
date: 2026-09-25-2244
branch: task/volumes-t17
trigger: wrapup
status: complete
tags: [session]
related: []
---

# Volumes S2 Task 17 — docs, evidence and the ledger entry

## What changed

Worked in `E:\Dev\Yolo\app\.claude\worktrees\volumes-t17` on `task/volumes-t17` (base `94c4e8b`,
the tip of `task/volumes` after Task 13's fix round). This block is **docs only** — no code was
touched — and covers just the Task 17 brief's documentation deliverables, not the S2 branch's
implementation history (Tasks 1–16), which prior sessions already recorded in the SDD ledger
(`.superpowers/sdd/2026-09-24-volumes/progress.md`).

At wrap-up time the changes are staged in the working tree, not yet committed (the commit lands
right after this note, per the task's own instructions):

- `docs/evidence/volumes-acceptance.md` (new) — the module-level acceptance numbers (build time and
  peak memory for the 21.7 M and 195 M-point clouds, the mound measurement on three base kinds, the
  +0.100 m stable-area/alignment check), a pass/fail table, the environment, and the two controller
  rulings verbatim from the SDD ledger: the shifted-net check on the synthetic +0.100 m copy (ruled
  a pass in substance — float32 µm residue, not an engine defect) and the parked memory-growth
  follow-up (625 MiB → 1 818 MiB across a 9× site, under the 2 GB acceptance bound, over the 1.5 GB
  target).
- `docs/evidence/volumes-crosscheck.md` (new) — the spec §7.3 CloudCompare cross-check template,
  filled with the Kestrel-side numbers that exist from the module-level run, every CloudCompare
  column marked "operator — CloudCompare not installed on the build machine", and an explicit note
  that the rectangle-R/Mean/0.1-0.25 m rows and every in-app screenshot wait on S1's point-cloud
  import UI landing on `main`.
- `docs/usability/2026-09-24-volumes-walkthrough.md` (new) — the 9-step operator walkthrough,
  corrected against the shipped UI by reading `VolumeToolbar.tsx`, `VolumesScreen.tsx`,
  `MeasurePanel.tsx` and `ExportVolumesDialog.tsx` directly: the toolbar's short labels (Pan V,
  Measure P, Stable S, Exclude X, Edit E), the left column's **New** button (tooltip "New
  measurement (P)"), and step 8's export files landing in the project's `exports/<stamp>/` folder
  rather than the Export screen's Past exports list (which doesn't carry volume exports — Task 16's
  ruling P10). A note at the top says steps needing a real cloud wait on S1's import.
- `docs/progress.md` — a new top ledger entry, "Volumes S2 — 2026-09-25", ahead of the existing F0
  entry: what shipped (surfaces, the volume engine, the calc/export jobs, cut/fill tiles, the
  Volumes screen), the acceptance numbers, the gate results on `task/volumes` @ `94c4e8b` (contract
  ok; ruff ok; ruff format ok; pytest 1543 passed, 3 skipped, 9 deselected; frontend lint ok; unit
  848/848; build ok; e2e 80/80 — noting a final-review fix wave follows and `finish-task.ps1`
  re-runs the full gate before merge), a per-task deviation table (Tasks 1–17) summarising the SDD
  ledger's fix rounds and rulings, the controller rulings worth keeping (including the reversed
  Task 16 base-CRS filter and the five Important findings from the final whole-branch review), what
  missed its target, and five numbered follow-ups.

No commits exist yet from this block; `git diff --stat` shows `docs/progress.md` with 116 insertions
and three new untracked files.

## Why

Task 17 of the Volumes (S2) plan is "acceptance on the real cloud, evidence, docs, merge" — but the
brief's own §7.3/QGIS/in-app steps need CloudCompare (not installed on this machine) and S1's
point-cloud import UI (not yet on `main`), so a prior session already ran the acceptance at module
level and left the ledger a controller ruling saying so. This block's job was to turn that
module-level run, the SDD ledger's rulings and the shipped UI's real strings into the four
permanent-record documents the working agreement requires before Volumes can be reviewed for merge,
without inventing any in-app numbers or screenshots that don't exist yet.

## Open threads

- **Not committed yet.** The commit (`docs(volumes): module-level acceptance, cross-check template,
  walkthrough and the ledger entry`, trailer `Co-Authored-By: Claude Opus 5.5 (1M context)
  <noreply@anthropic.com>`) happens immediately after this wrapup, per the dispatching agent's
  instructions — it is not part of this vault commit.
- **`docs/evidence/volumes-crosscheck.md` has open rows.** Rectangle R, ground level H and every
  CloudCompare-side number are the operator's to fill in once CloudCompare 2.13 is installed; the
  rectangle-R/Mean/0.1 m/0.25 m Kestrel-side numbers haven't been run either (the module-level
  acceptance used a different polygon and the API defaults, not this cross-check's exact settings).
- **The walkthrough has no in-app verification.** It was corrected against the shipped component
  source (exact button labels, toast text, export folder), not driven live — the Volumes screen
  currently shows "Import a point cloud first" in any project until S1 merges.
- **The S2 branch itself is not done.** A final-review fix wave (Important findings 1–4 from the
  whole-branch review, plus cheap minors) is running in `volumes-tfx`, separate from this worktree;
  `finish-task.ps1` re-runs the full gate before `task/volumes` merges to `main`. This session did
  not touch that fix wave.
- **The frozen PyInstaller smoke test for `volumes-selftest`** is still pending the operator's
  packaging run (no starter weights/PyInstaller in the overlay venv used for S2's gates).

## How to test

Not user-observable — this block wrote evidence and walkthrough documents plus a progress-log
entry; no application code changed. To sanity-check the documents themselves:

1. Open `docs/evidence/volumes-acceptance.md` and compare its numbers against
   `.superpowers/sdd/2026-09-24-volumes/acceptance-results.md` (the source run report) — they
   should match exactly.
2. Open `docs/usability/2026-09-24-volumes-walkthrough.md` next to
   `frontend/src/volumes/VolumeToolbar.tsx` and `frontend/src/screens/VolumesScreen.tsx` — the
   button labels, tooltips and toast text quoted in the walkthrough should match the source
   verbatim.
3. Open `docs/progress.md` and confirm the new top entry's gate-result line matches the SDD
   ledger's line `Gate on task/volumes @94c4e8b (controller run, integration worktree, shared
   interpreter): contract ok; ruff ok; ruff format ok; pytest 1543 passed, 3 skipped, 9 deselected;
   frontend lint ok; unit 848/848 (174 files); build ok; e2e 80/80.`

## Next session entry point

Once the `volumes-tfx` final fix wave lands and the full gate passes on `task/volumes`, run
`finish-task.ps1` to merge to `main`, remove the `volumes-t17` (and any other leftover
`task/volumes-t<N>`) worktrees/branches, then repeat the task-17 brief's Steps 1–7 end to end once
S1's point-cloud import UI is on `main` (import the chimney/+0.100 mm/195 M clouds through the UI,
re-run the walkthrough live, install CloudCompare and fill in `docs/evidence/volumes-crosscheck.md`'s
open rows, run the QGIS/PDF/XLSX review).
