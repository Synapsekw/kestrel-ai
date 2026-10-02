---
type: session
date: 2026-10-02-1650
branch: main
trigger: wrapup
status: complete
tags: [session, pointclouds]
related: ["[[2026-10-02-gotcha-potreeconverter-ram-plateaus]]", "[[2026-09-23-point-clouds-design]]"]
---

# 2026-10-02-1650-cloud-ram-admission

## What changed

- `4a4e4d8d` fix(pointclouds): admit the converter at its measured RAM plateau (task worktree
  `task/cloud-ram-admission`, fast-forwarded to `main`, worktree and branch removed).
  - `backend/app/pointclouds/admission.py`: `ram_needed` = min(45 MB/Mpt, 9 GB + 2.5 MB/Mpt) + 1 GiB.
    Unchanged below ~212 M points; 842 M now needs 12.2 GB (was 39.0 GB).
  - `backend/tests/test_pointcloud_admission.py`: three tests (the plateau value, monotonic need,
    the 842 M LNG cloud admitted with 36 GB free); written first and seen failing.
  - Spec `2026-09-23-point-clouds-design.md` §RAM admission and §15.1 budget amended.
  - ADR [[2026-10-02-gotcha-potreeconverter-ram-plateaus]].
- Evidence: PotreeConverter 2.1.5 `--encoding BROTLI` run directly on
  `E:\Asset Inspections\LNG Terminal\Point_Cloud\Production_2-Final.laz` (842 M points, 3.9 GB):
  exit 0, 132 s, peak 10.3 GB private / 9.9 GB RSS, octree 4.4 GB.
- Gate on the worktree: contract check, ruff check + format, pytest 5184 passed / 17 skipped
  (37 min, CPU shared with two other sessions' suites), frontend lint, vitest 4116 passed, build,
  e2e 180 passed / 8 skipped on the second run (the first run had 1 failure; no frontend change).
  cargo test skipped (no frozen sidecar in the worktree).
- Backend frozen and installer rebuilt from `4a4e4d8d` (the am-u1/am-u4 merges landed at 16:44,
  after the installer finished), installed with `/VERYSILENT`. The operator re-imported the LNG
  cloud on it: "works great".

## Why

- The operator's 842 M-point LNG cloud was refused with "needs about 39.0 GB of free memory; 36.0
  GB is free", after the copy and scan, with an ortho import running alongside. The admission was a
  straight line through the spike's two clouds; measurement showed the converter's memory plateaus.

## Open threads

- Nothing above 842 M points has been measured; the 2.5 MB/Mpt tail is extrapolated. The plateau
  depends on thread count (24 logical CPUs here).
- Heavy jobs (point-cloud import, ortho import, training) still run concurrently in the 2-worker
  pool. Not needed now; the next lever if they crowd each other again. Also: a refusal still only
  comes after the copy + scan.
- For a much larger cloud: thin the display copy (the octree is display-only; surfaces, profiles
  and export read the source).
- `scripts/start-task.ps1` throws on PS 5.1 at `git fetch` (stderr wrapped as NativeCommandError);
  the worktree was cut by hand from local `main`.

## How to test

1. Open Kestrel AI (the build installed 2026-10-02 ~16:40).
2. Open the **LNG Terminal** project and import `Point_Cloud\Production_2-Final.laz`.
3. The import dialog shows no memory warning; the job copies, scans, builds the 3D view and ends
   at "842.0 M points ready" (about 4 min in total).
4. The cloud opens in the 3D view.

## Next session entry point

- Nothing owed from this block beyond the open threads above; carry on with §4 Now.
