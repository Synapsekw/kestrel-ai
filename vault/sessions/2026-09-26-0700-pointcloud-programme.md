---
type: session
date: 2026-09-26-0700
branch: task/wrapup-pointcloud-programme
trigger: wrapup
status: complete
tags: [session]
related: ["[[2026-09-26-0404-point-clouds-s1]]", "[[2026-09-26-0144-design-surfaces]]", "[[2026-09-25-2244-volumes-task17-docs]]", "[[2026-09-26-gotcha-swiftshader-compositing]]", "[[2026-09-25-gotcha-maps-guard-test-leaves-app-api-stale]]"]
---

# 2026-09-26-0700-pointcloud-programme

The coordinating block for point clouds, volumes and design surfaces: brainstorm → spike → specs →
plans → four parallel SDD controllers → follow-ups → CI → rebuild. The per-plan notes linked above
carry each plan's detail; this note records what only the coordinator saw.

## What changed

- **Spike (throwaway, nothing kept):** on the operator's real Pix4D chimney LAS (21.7 M points,
  EPSG:32639) — potree-core renders in the **packaged** WebView2 once the CSP gains
  `worker-src blob:` (dev hides the failure); potree-core cannot read COPC; PotreeConverter 2.1.5
  BROTLI converts in 9 s (195 M points: 52 s, 8.7 GB RAM) and aborts on Pix4D's 0.3 mm-short header
  bbox; COPC writers are GPL (untwine) or slow (PDAL: 36 min, 21 GB at 195 M). **COPC dropped; LAZ export.**
- **Operator decisions:** volumes are the paid part (toe, earlier survey, design); design files
  arrive as DXF/LandXML/DEM (DWG out); flights "sometimes" share control → stable-area check +
  vertical shift; machines masked from detection runs; outputs PDF/GPKG/CSV/XLSX + LAZ; clouds up to
  ~200 M points; single-user app → optimise experience over licensing.
- **Specs** `b625112`, **plans** `cc1caea` (F0 + S1 + S2 + S3).
- **Built by four controller agents** in parallel worktrees with a merge lock:
  F0 `ea262c9` → S2 grid early `754c741` → Volumes `798c0c3` → Point clouds `0af7084`/`ab3fa34`
  → Design surfaces `23c1ca6` (131 commits `cd41061..d32722e` on `main` in all).
- **Follow-ups** `2a1f634`, `3ad69e4`: one error-code rule (`not_ready` / `job_running` /
  `conflict`); volume fingerprint now covers the exact masked box set, so a detection review marks
  measurements stale and a stale export is refused; Delete for ready design surfaces; queued-cancel
  settles at once; design reads 404 instead of 500 under a delete race.
- **CI fix** `6bd6e72` + ADR `d32722e`: `--use-angle=swiftshader` moved Chromium's compositor onto
  SwiftShader and starved the 4-vCPU runner (399 % vs 101 % CPU, measured on the runner).
- **Shared venv:** five packages added, additive only (laspy, lazrs, ezdxf, openpyxl, et-xmlfile;
  freeze 125 → 130 lines, nothing changed).
- **Rebuilt from `3ad69e4` and installed** 2026-09-26: frozen smoke green (geo, design, volumes,
  pointcloud, cloud, predict, worker, export…), packaged-webview check `points=49724`; installer
  `E:\Dev\Yolo\installers\Kestrel AI_0.1.0_x64-setup_3ad69e4.exe`.
- Gate at the last merge: pytest 1984 passed / 10 skipped, vitest 999, e2e 94, lint/build ok.
  CI green on `d32722e` (run 36217205986).

## Why

- The operator wanted terrain under detections and, above all, trustworthy earthworks volumes; the
  spike existed to find out before speccing whether WebView2 and conversion would carry a full site —
  they do, but not in COPC, which changed the design.

## Open threads

- Every item is in `00-north-star.md` §5 "Point-cloud programme: cross-cutting" and the S1/S2/S3
  owed lists: `sidecar-smoke` on manual CI runs, maps still answering `conflict`, §17.10 rim
  uncertainty (data-limited), CloudCompare cross-check, in-app walkthroughs, leftover folders.
- Nothing from this programme is unmerged; no worktree of this block remains after this wrapup.

## How to test

1. Start Kestrel AI (installed 2026-09-26) and open a **detection** project.
2. **Point clouds → Import** the chimney LAS from the NAS → the row turns ready (21.7 M points,
   EPSG:32639); it opens in true colour; **Measure → Vertical check** on the stack base and top.
3. **Volumes → Build surface** from that cloud (defaults) → a hillshade; draw a polygon round a mound
   with **Measure (P)** → fill, cut, net and ± appear; switch the base to a flat level → Stale →
   Recalculate.
4. **Volumes → Import design surface** → pick a LandXML/DXF/DEM → preview (overlap %) → import;
   measure a volume against it.
5. On a map run used as a mask, reject a box → the measurement turns **Stale** and export refuses it.
6. **Export** a volume (PDF, GPKG, CSV, XLSX) and **Export LAZ** of the cloud; open them in QGIS.
   Full steps: `docs/usability/2026-09-24-{point-clouds,volumes,design-surfaces}-walkthrough.md`.

## Next session entry point

- Operator feedback from the three walkthroughs on the installed app; then `sidecar-smoke`'s
  PotreeConverter fetch in CI, and maps' `job_running` alignment.
