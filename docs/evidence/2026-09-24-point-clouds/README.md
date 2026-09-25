# Point clouds (S1): acceptance evidence

This folder holds the evidence from S1 Task 19, run on 2026-09-26 against `main` at `0af7084` in the
`point-clouds-t18` worktree (branch `task/point-clouds-acceptance`). The machine was shared: other
sessions ran heavy suites at the same time. About 21.6 GB of 63.8 GB RAM was free at the start. Read
every timing and memory figure with that in mind.

## Data

Every source file was only read.

- `chimney.las` is a byte copy of the NAS file
  `\\DanNas\…\Chimney stack 3D_group1_densified_point_cloud.las`, stored on local NVMe (C:, the
  session scratchpad). It has 21 697 184 points, 737 705 337 bytes, LAS 1.2 format 3, EPSG:32639.
- `big9.las` is the chimney tiled 3 × 3 with `make_tiled_cloud.py`. It has 195 274 656 points in
  its header (checked) and 6 639 339 385 bytes, on local NVMe (C:).
- Generated files are on `D:\kestrel-acceptance` (local NVMe, Kingston SFYRD2000G). That covers the
  ortho `chimney-ortho.tif`, the project folders `project` and `project-nas`, the app data, and the
  exports. None of it is committed.

## Files

| File | What it proves (spec §17) |
| --- | --- |
| `build.log` | `backend\scripts\build.ps1` freeze: 3 618.8 MB in 14 496 files, 217 s (§15) |
| `smoke-frozen.log` | `smoke_frozen.ps1`: `pointcloud ok 50000 32639 BROTLI laz 50000`, `cloud ok 50000 206`, `smoke ok` (§15) |
| `tauri-build.log` | `pnpm tauri build --no-bundle` (release exe) |
| `check-webview.log` | `pnpm check:webview`: `webview ok points=49723 red=0.108 green=0.109` (§7, §8) |
| `installer.log` | `pnpm -C frontend build:installer`: the check ran first, then Inno Setup built the 1 877.8 MB setup. It was never run. (§8) |
| `cargo-test.log` | `cargo test` with the frozen sidecar present: 8 passed |
| `pytest-potreeconverter.txt` | `pytest -m potreeconverter`: 2 passed (the real converter) |
| `pytest-criteria.txt` | octree, measure, measurements API (the vertical refusal), about-versions, API, export and admission tests: 88 passed (§3, §11, §14, §16) |
| `pytest-payload-scripts.txt` | the payload check fails on a missing manifest file, plus the acceptance-script tests: 13 passed (§15) |
| `vitest-criteria.txt` | `src/clouds` and the About screen: 74 passed (§10 warn tone, §11, §12 other-CRS, §16) |
| `refusal.txt` | `test_195m_points_refused_with_4_gb_free` PASSED (§3) |
| `import-chimney-local.json` | chimney import from local SSD (§1) |
| `import-chimney-nas.json` | the same file imported straight from `\\DanNas` into a second project (§1, the NAS time) |
| `independent-scan.txt` | chunked laspy bounds scan, to compare with `bounds_native` (§1) |
| `octree-metadata.txt` | the octree `metadata.json` point count (§1) |
| `import-195m.json` | 195 M import: wall time, converter peak RSS, backend RSS growth (§2) |
| `cancel.json` | cancelling during conversion (§4) |
| `crash.txt` | killing the sidecar mid-conversion; the cloud after the restart; `.work` gone (§5) |
| `viewer-chimney-3M.json`, `viewer-chimney-8M.json`, `viewer-195m-3M.json` and the `chimney-3M/`, `chimney-8M/`, `195m-3M/` screenshots | packaged viewer perf and colours through `measure-cloud-viewer.mjs` (§6, §7) |
| `viewer-picks.json`, `picks/viewer-picks.png`, `export-chimney-with-picks.json`, `picks-measurements.csv`, `picks.txt` | 10 picks saved as Point measurements, the export's CSV, and `check_picks.py` (§9) |
| `rim.txt`, `rim-scan.py`, `rim2.txt`, `rim-scan2.py` | how `KESTREL_RIM` was derived from the data, since no one was there to pick the rim in the app (§10) |
| `uncertainty-attempt1-flue.json` (+ folder) | uncertainty run 1: the median XY of the top 0.3 m, which is over the hollow flue (§10) |
| `uncertainty-attempt2-rim.json` (+ folder) | uncertainty run 2: a dense point on the rim ring (§10, the run that counts) |
| `uncertainty-open-ground.json` (+ folder) | uncertainty run 3 (supplementary): open ground 25 m from the stack (§10) |
| `export-chimney.json`, `export-195m.json` | LAZ export wall time and size ratio (§13) |
| `laz-check.py`, `laz-check-chimney.txt` | the exported chimney LAZ: count, EPSG, and header bounds containing every point (§13) |
| `ortho.txt` | `make_test_ortho.py`: `ortho ok 13732x14031 0.05 EPSG:32639` (§12 input) |

Not in this folder: `jump-3d.png`, `jump-map.png`, `qgis.png` and `uncertainty-warn.png`. They come
from the installed app, which the operator runs by following
`docs/usability/2026-09-24-point-clouds-walkthrough.md`.
