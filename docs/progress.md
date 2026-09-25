---
type: report
status: active
tags: [operations, evidence]
---

# Progress log

Resume instructions for a new session: read this file top to bottom, then the plan for the
sub-project whose state is not `merged`, then continue from its first unchecked task.

## Design surfaces (S3) — 2026-09-24

Import a design as a `Surface` (`kind = design`) on the cloud DSM's own grid: a DEM GeoTIFF (copied
when it already conforms, else re-gridded window by window with an exact warp), a LandXML TIN (a
streamed parse that honours the northing-first rule), or a DXF with 3D faces, meshes or contours
(ezdxf; contours through densified Delaunay with boundary peeling). One `design_import` job runs in
three phases — inspect, preview, build — and nothing is imported until the operator imports a clean
preview or accepts its warnings; the preview catches swapped axes, the wrong foot, feet heights, a
wrong CRS and far-apart placements, and offers one-click fixes. Design
`docs/superpowers/specs/2026-09-23-design-surfaces-design.md`, plan
`docs/superpowers/plans/2026-09-24-design-surfaces.md`, evidence `docs/evidence/design-surfaces/README.md`,
walkthrough `docs/usability/2026-09-24-design-surfaces-walkthrough.md`.

Acceptance on the chimney site (headless, real backend, scratch app data): all five §15.4 steps pass —
LandXML N E Z 98.4 % overlap, median dz +0.005 m; E N Z 0 % → Apply swap → 98.4 %; 3D-face DXF 98.4 %,
+0.005 m; contour DXF (Delaunay, 3 559 long triangles trimmed at 6.1 m) 88.2 %, +0.067 m; EPSG:32638
DEM re-gridded, 100 %, −0.012 m; an S2 volume against each of the five designs runs. §16.11 timing:
a 1 M-point / 2 M-face LandXML inspects in 7.90 s and builds onto 4996 × 4996 at 0.2 m in 8.38 s
(targets < 60 s each).

Verified (on `task/design-surfaces` @ `d581a10` + this docs commit, the worktree's overlay interpreter):
- `pnpm -C contract check`: spectral no errors, `schema.d.ts` regenerated with no diff.
- `ruff check .`: all checks passed; `ruff format --check .`: 403 files already formatted.
- `pytest`: 1969 passed, 9 skipped, 9 deselected (763.74 s).
- `pnpm -C frontend lint`: ok (eslint 0 errors, 1 existing warning in `MapView.tsx`; prettier; tokens ok).
- `pnpm -C frontend test`: 982 passed (200 files).
- `pnpm -C frontend build`: ok.
- `pnpm -C frontend e2e`: 91 passed (free ports 14731/14732).
- `cargo test`: not run — no frozen sidecar in `frontend/src-tauri/binaries/` (git-ignored).

Follow-ups:
- a queued design build cancelled from the Jobs panel publishes no `surfaces.changed` (S2's settle
  corrects the row on the next list);
- S2's restart sweep tells a design row "build it again" (a design needs a re-import) — S2 copy;
- after a 409 on import the dialog can keep a vanished target id selected until re-picked;
- `get_design_preview` can answer 500 if a delete races a poll;
- a failed design build keeps its inspection but the dialog can't reopen it (the 24 h sweep removes it);
- the Volumes screen mounts the dialog in two places (list and empty state) as separate instances;
- the next packaging run must pass `smoke_frozen.ps1`'s new `design` step;
- `QHULL_BYTES_PER_POINT` = 700 measured at ~684 B/pt (2.3 % headroom); rasterise `BATCH` 16 384 /
  `RANGE_CHUNK` 65 536;
- the preview's suggestions score hypotheses on the file's vertices, orphans included, not on the
  footprint (spec §10): on the chimney TIN they say 67 % where applying gives 98.4 % (evidence, Findings);
- a ready surface has no Delete on the Volumes screen (S2 offers it on failed rows only);
- no timing follow-up: both §16.11 timings are well inside 60 s.

## Point clouds (S1) — 2026-09-24/2026-09-26 (merged)

The spec is `docs/superpowers/specs/2026-09-23-point-clouds-design.md` and the plan is
`docs/superpowers/plans/2026-09-24-point-clouds.md`. The SDD ledger is
`.superpowers/sdd/2026-09-24-point-clouds/`. S1 merged to `main` at **`0af7084`**. Task 19 (this
entry) came afterwards: acceptance on the real chimney file and the 195 M cloud, with evidence in
`docs/evidence/2026-09-24-point-clouds/` (see its `README.md`) and the walkthrough in
`docs/usability/2026-09-24-point-clouds-walkthrough.md`. A fix round on the same branch then fixed
the two first-run failures (§9 picks 1 mm low, §10 Z refine on the flue floor) and re-measured;
the rows below give the new figures and say what failed first.

What changed:

- **Import pipeline.** Admission (a RAM estimate from the header count; a 422 `insufficient_memory`
  refusal) is followed by a background `pointcloud_import` job: copy, chunked scan with header-bounds
  repair, then the PotreeConverter display copy under a Job Object. Cancel kills the converter, and a
  startup sweep marks an interrupted import `failed`.
- **Display copy.** A BROTLI octree is served by an octree endpoint that allows only the enumerated
  file names.
- **Viewer.** potree-core: true RGB, elevation, a point budget, orbit/pan/zoom, **F** fit, **T**
  top, and a diagnostics hook (`window.__kestrelCloudViewer`).
- **Measurements.** Point, distance and vertical-check, each with a per-pick uncertainty *u* and the
  warn tone above 0.10 m. Lean angle and azimuth are measured from grid north. Copy as CSV.
- **Jumps.** Map → 3D (`?at=`, `&fp=`, Z refine, pin) and 3D → map (a marker), and a map linked on
  Details.
- **LAZ export** with measurements (a `pointcloud_export` job).
- **Packaged check.** `check:webview` runs on the release exe, and `build:installer` stops if it
  fails. See ADR `2026-09-23-gotcha-packaged-webview-needs-worker-src-blob`.
- **About Kestrel AI** lists nine components with their licence texts.

Evidence (spec §17). Measured 2026-09-26 on the operator's machine, which other sessions were loading
at the time: about 21.6 GB of 63.8 GB RAM free at the start. The data was on local NVMe; generated
files were on `D:\kestrel-acceptance`.

| § | Criterion | Measured | Result | Evidence |
| --- | --- | --- | --- | --- |
| 1 | Chimney import | succeeded; 21 697 184 pts; EPSG 32639; `bounds_repaired` true; `bounds_native` = the independent scan exactly (0.001); octree `metadata.json` 21 697 184 pts; octree 0.186 × source; **9.5 s** (≤ 60) | PASS | `import-chimney-local.json`, `independent-scan.txt`, `octree-metadata.txt` |
| 1 | NAS time | the same file straight from `\\DanNas`: **20.3 s** | recorded | `import-chimney-nas.json` |
| 2 | 195 M import | admitted; succeeded in **58.9 s** (≤ 300); converter peak RSS **8.98 GB** (≤ 10); backend RSS growth **0.20 GB** (≤ 1) | PASS | `import-195m.json` |
| 3 | Refusal at 4 GB free | 422 `insufficient_memory`, "about 9.9 GB … 4.0 GB is free", no row (the spec says "about 9.8") | PASS | `refusal.txt` |
| 4 | Cancel | converter gone in **1.08 s**; `failed` "import cancelled"; folder gone | PASS | `cancel.json` |
| 5 | Crash | converter gone **0.13 s** after the sidecar was killed; after the restart `failed` "import interrupted by application restart; import the file again"; `.work` gone | PASS | `crash.txt` |
| 6 | Chimney at 3 M | first points **87 ms**; settled **688 ms**; orbit p50 **17.8 ms** (p95 18.1); webview peak **0.68 GB** | PASS | `viewer-chimney-3M.json` |
| 6 | Chimney at 8 M | webview peak **0.67 GB** (≤ 3). Only 0.46 M points were visible in the whole-site view, so the budget never bound | PASS | `viewer-chimney-8M.json` |
| 6 | 195 M at 3 M | settled **656 ms** (≤ 8000); orbit p50 **17.8 ms** | PASS | `viewer-195m-3M.json` |
| 7 | Colours | white **0.004 %** of sampled pixels (< 5 %); the fixture's red 0.108 / green 0.109. After the colour fix (note 3): background 438 462 of 527 440 pixels, white **0.02 %** of the point pixels; `check:webview` ok | PASS | `viewer-*.json`, `viewer-chimney-3M-fixed.json`, `check-webview-fixed.log` |
| 8 | Packaged check | `check:webview` ok on the release build; `build:installer` ran it before Inno Setup. The negative proof (no `worker-src blob:` → CSP FAIL, no installer) is in the ADR (2026-09-25) and was not re-run | PASS | `check-webview.log`, `installer.log` |
| 9 | Picks are real points | after the fix: 10 picks, nearest source point **0.001–0.002 mm** each (`picks ok 10`). First run: 1.000 mm ×7, 1.414 ×2, 1.732 ×1, every pick one 1 mm step low (note 1) | PASS (fixed) | `picks.txt`, `viewer-picks.json`, `picks-octree-offset.txt` |
| 10 | Uncertainty on the rim | after the fix both picks are on the rim (z 189.1 site-wide, 189.4 close): close range **29.4 m** (≤ 30); ratio **4** (≥ 4); close *u* **0.171 m** (≤ 0.05 fails). The octree ends at level 5 at the rim (5.48 m / 2⁵), and the source itself is 0.074 m apart there (median nearest neighbour), so ≤ 0.05 m is out of reach on this rim. First run: *u* 0.086 m, both picks on the flue floor (z ≈ −41) because the Z refine chose it (note 2) | **FAIL** (data-limited; the refine bug is fixed) | `uncertainty-rim-fixed.json`, `rim-octree-depth.txt`, `pickdown-diag.json`; first run `uncertainty-attempt2-rim.json` |
| 10 | Uncertainty on the "open ground" spot (supplementary) | after the fix the refine lands on airborne sky-coloured points above that spot (2 117 source points at z 130–160 m within 2 m; seen from above they hide the ground within 0.6 m): close *u* 0.086 m, ratio 8. First run (ground): *u* 0.043 m, ratio 16 | recorded | `uncertainty-open-ground-fixed.json`, `open-ground-column.txt`; first run `uncertainty-open-ground.json` |
| 10 | Warn tone above 0.10 m | unit test (`readout.test.ts`); screenshot is an operator step | PASS (unit) | `vitest-criteria.txt` |
| 11 | Formulas | shared vectors, the 1.000° pole and the vertical refusal pass in pytest and vitest | PASS | `pytest-criteria.txt`, `vitest-criteria.txt` |
| 12 | Map ↔ 3D | not run: it needs the installed app (operator walkthrough step 7). The different-CRS unit test passes | operator | `vitest-criteria.txt` |
| 13 | Chimney LAZ export | **0.209** × source (≤ 0.25); **1.77 s** (≤ 30); count 21 697 184; EPSG 32639; header bounds contain every point. QGIS is an operator step | PASS | `export-chimney.json`, `laz-check-chimney.txt` |
| 13 | 195 M LAZ export | **8.51 s** (≤ 180) | PASS | `export-195m.json` |
| 14 | Octree endpoint | `test_pointcloud_octree.py` passes | PASS | `pytest-criteria.txt` |
| 15 | Frozen bundle | `pointcloud ok 50000 32639 BROTLI laz 50000`, `cloud ok 50000 206`, `smoke ok`; the payload check fails on a missing manifest file | PASS | `smoke-frozen.log`, `pytest-payload-scripts.txt` |
| 16 | About | `AboutScreen.test.tsx` and `test_about_versions.py` pass | PASS | the test logs |
| 17 | Gate | see *Gate* below | PASS | — |

Notes:

1. **Picks sat one quantum off (§9) — fixed.** First run: every pick exactly 1 mm low in X, and
   sometimes in Y or Z. PotreeConverter 2.1.5 takes the work copy's header minimum as its offset and
   truncates `(x − offset) / scale`; the repaired minimum (source min widened one step) was
   `243194.29700000002`, a hair above the 1 mm grid, so grid values landed at k − ε and truncated to
   k − 1. Fix (`cbbb884`): the header minimum is now written a thousandth of a step further down
   (`widen_for_converter`), so the octree offset is `243194.296999` and every grid value truncates
   to exactly k. The converter has no offset/scale option, so the header is the lever. The bounds
   still contain every point; `bounds_native` and the export (which reads the source) are
   unchanged. A real-converter test round-trips 20 000 grid points within 0.5 mm per axis.
2. **Rim uncertainty (§10) — refine fixed, criterion data-limited.** First run: at a dense rim
   point (z 188.8, `rim2.txt`) the jump arrival's straight-down Z refine returned the flue bottom
   (z −41.6): potree-core's picker returns the drawn point nearest the window centre, and the ground
   seen past the rim's coarse points was nearer. Fix (`9e9eb7b`, `3d2b588`):
   `pickDown` reads back every point the pick window drew and takes the top surface at the spot
   (`topmostWithin`: the smallest ring of 0.25/0.5/1/2 m holding a hit, a coarse point counting
   within its own uncertainty, then the highest ± 0.5 m, nearest first). Both picks now land on the
   rim, but the close-up *u* is 0.171 m: the octree ends at level 5 at the rim, and the source
   points are 0.074 m apart there, so the spec's ≤ 0.05 m cannot be met on this rim with
   *u* = spacing / 2^level. That needs a decision (another rim definition, or a *u* for leaf
   nodes); it was not changed here. The same fix round found potree's pick answering null with 18
   valid points in the window (a pixel whose node index names no rendered node); `pickAtClient`
   now takes the nearest valid drawn point, which gave the §9 run all 10 picks.
3. **Colour sample — fixed.** `new THREE.Color(r/255, …)` took the canvas token as linear, and the
   sRGB output drew (21, 27, 25) as (81, 92, 88), the grey in the screenshots, so `sampleColours()`
   never matched the background. `tokenColor` sets the token as sRGB for the clear colour and the
   overlay tones: the canvas now shows the DESIGN.md token, and the background count is right.

Timing caveat: an orbit p50 of 17.8 ms is the 60 Hz vsync interval, so it is a floor, not the
viewer's cost.

Bundle: the frozen sidecar is 3 618.8 MB in 14 496 files. The converter ADR
(`2026-09-23-potreeconverter-in-the-frozen-sidecar`) records a growth of +7.5 MiB and +63 files over
the pre-S1 bundle. The Inno setup is 1 877.8 MB, without a WebView2 bootstrapper.

Gate on the merge worktree before `0af7084` (controller run): pytest 1761 passed, 5 skipped,
9 deselected; vitest 196 files, 949 tests; e2e 89 passed; frontend lint 0 errors; build ok; contract
check ok; ruff ok. `cargo test` was skipped there (no frozen sidecar). In this acceptance worktree, with the
sidecar freshly frozen from `main`: `cargo test --manifest-path frontend/src-tauri/Cargo.toml` gave
8 passed, and `pytest -m potreeconverter` gave 2 passed. New in this entry:
`frontend/scripts/measure-cloud-viewer.mjs` (eslint and prettier clean).

Fix round (same branch): sidecar re-frozen (3 618.8 MB, 204 s), `smoke_frozen.ps1` → `pointcloud ok
50000 32639 BROTLI laz 50000`, `cloud ok 50000 206`, `smoke ok`; `pnpm tauri build --no-bundle` ok;
`check:webview` → `webview ok points=49724 red=0.108 green=0.109`; chimney re-import 9.16 s,
21 697 184 pts, same `bounds_native`, octree 0.186 × source (`import-chimney-local-fixed.json`).
Tests: pytest `tests/test_pointcloud*.py tests/test_contract.py` 399 passed, 5 skipped;
`-m potreeconverter` 3 passed; ruff clean; vitest 197 files, 961 tests; frontend lint 0 errors, build ok;
`e2e/clouds.spec.ts` 9 passed.

## Volumes S2 — 2026-09-25 (`task/volumes`, gated at `94c4e8b`, not yet on `main`)

Spec `docs/superpowers/specs/2026-09-23-volumes-design.md` (with F0 §5), plan
`docs/superpowers/plans/2026-09-24-volumes.md`, SDD ledger
`.superpowers/sdd/2026-09-24-volumes/progress.md`. Built as 17 tasks (a solo Task 1 on the critical
path, then batch B1 of Tasks 2–7 and 14 in parallel sub-worktrees, then Tasks 8–13, 15, 16 in
further batches, each cherry-picked into the `task/volumes` integration worktree after review), plus
Task 17 (this entry).

What shipped:

- **Surfaces.** `GridSpec`/`grid.py` (F0's surface-grid convention: GeoTIFF writer/reader, resample,
  stats, hillshade) plus the build pipeline (`app/surfaces/build.py`): median/mean/max/min per-cell
  statistics with their measured bias, auto cell size (~4 points/cell), despike, hole-fill up to a
  configurable gap, Z clip, noise-class drop, a `.build` work dir cleaned up in a `finally`, and
  progress messages ("reading points …", "gridding block …", "filling gaps …", "building zoom
  levels"). Surfaces get hillshade + zoom-level tiles and an ortho-overlay tile endpoint.
- **The volume engine** (`app/volumes/engine.py`): fill/cut/net against a `toe_plane`, `toe_surface`,
  `flat` or `surface` (another survey or a design surface) base; clutter masks from detection-run
  footprints (patch or exclude, with a buffer and a class filter) and hand-drawn exclusion polygons;
  a two-surface alignment check (median dZ / σ / tilt on a stable-area polygon) with a suggested and
  optional vertical-shift correction; a full uncertainty budget (base, alignment, cell size, no
  data, patches → total, "indicative"); `patch_failed` warnings when a mask patch can't be applied.
- **Jobs.** `volume_calc` (the measurement itself) and `volume_export` (PDF report, GeoPackage +
  cut/fill GeoTIFF + `.qml`, CSV, XLSX, `summary.json`, written to the project's `exports/<stamp>/`
  folder, grouped by EPSG, with unique cut/fill file stems so duplicate/slug-equal/non-ASCII
  measurement names never collide).
- **Cut/fill diff tiles** on the results' `top_surface` lattice, and the **Volumes screen**
  (`frontend/src/screens/VolumesScreen.tsx` + `frontend/src/volumes/*`): a surfaces list with a
  **Build surface** dialog, a measurements list with a **New** button, a drawing toolbar (**Pan V,
  Measure P, Stable S, Exclude X, Edit E**), Measure/Results tabs, an **Export…** dialog, and **View
  in 3D** into S1's point-cloud viewer.

Acceptance numbers (module level — see "Deviations" below for why): chimney.las (21.7 M pts) builds
in 8.92 s, 625 MiB peak (target ≤ 60 s / ≤ 2 GB, PASS); a 3×3 tiling to 195.3 M pts builds in 83.82 s,
1 818 MiB peak, `.build` cleaned up (target ≤ 600 s / ≤ 2 GB, PASS — over the 1.5 GB memory *target*,
see below); a 40×40 m mound measures end to end on all three non-surface base kinds (toe_plane net
63 781.3 m³ ± 5 012.0 with `base_fit_poor` correctly firing, toe_surface net 59 621.3 m³ ± 327.8, flat
net 67 205.4 m³ ± 15.0); the +0.100 m copy's stable-area median dZ is +0.0999985 m (target ± 0.005 m,
PASS), `alignment_offset` fires without the shift (PASS), and with the shift applied net is
0.00246 m³ against an indicative ± of 0.00048 m³ — fails the letter of "net within ± U" but is ruled
a pass in substance (see below). Full detail, environment and commands:
`docs/evidence/volumes-acceptance.md`. Cross-check template against CloudCompare 2.5D Volume:
`docs/evidence/volumes-crosscheck.md` (rows open — see below). Walkthrough:
`docs/usability/2026-09-24-volumes-walkthrough.md`.

Gate on `task/volumes` @ `94c4e8b` (controller run, integration worktree, shared interpreter):
contract check ok; ruff check ok; ruff format ok; pytest 1543 passed, 3 skipped, 9 deselected;
frontend lint ok; unit 848/848 (174 files); build ok; e2e 80/80; `cargo test` not run (no frozen
sidecar in this worktree). **A final-review fix wave follows** (Important findings 1–4 from the
whole-branch review below, plus cheap minors), dispatched in `volumes-tfx`; `finish-task.ps1`
re-runs the full gate before the eventual merge to `main`.

Deviations, by task:

| Task | What it built | Deviation from the plan |
| --- | --- | --- |
| 1 | `grid.py`, `paths.py`, the grid convention | 3 review minors fixed before the early merge (rasterio `from_origin` warnings; `crs_problem` leaked a raw pyproj `CRSError`; `.partial` left behind on a failed rename) — grid.py is S3's frozen interface, so a later fix would have moved under S3. Deferred: `resample_onto`'s R2/R3 memory scales with the caller's window; some callbacks/paths/write_cloud paths untested. |
| 2 | Build-time grid errors, `plan_crs` | Fix round: `plan_crs` gives a readable rejection for a malformed CRS or feet units instead of an opaque error; stale spill bins are cleared on a rebuild into a crashed folder (both landed before merge — a rebuild into a stale folder would otherwise silently corrupt a grid). Deferred: `cell<=0` `GridError` unreachable via the contract; a weak cancel test. |
| 3 | (paired with Task 2's tests) | Clean review, no findings. |
| 4 | `densify_ring`, toe fitting | Fix: `np.allclose`'s default relative tolerance dropped a real last vertex at large projected coordinates — switched to an absolute tolerance. Deferred: `fit_toe_surface` rejects `\|r\| ≈ 0` slightly differently from the ADR's median-centred wording; no toe-surface outlier test; empty/1-point ring guard left to Task 11's geometry validation. |
| 5 | Patch/lattice windows | Clean review. Deferred: the `MAX_READ` branch of patch-too-large is untested; `lattice_window` duplicates `GridSpec.window_for_bounds`. |
| 6 | Sampling | Clean review. Deferred: the `SAMPLE_MAX` stride path (k>1) is untested. |
| 7 | Map-run helpers | Clean review; `Affine *` changed to `@` to avoid a future deprecation warning. Deferred: the map-without-coordinates and multi-run-truncation branches of `usable_runs` are untested. |
| 8 | Volume engine core | `patch_failed` warnings added (spec/contract require them). Fix round: a failed patch on the **base** surface wasn't reported (the first pass only half-applied the rule). Deferred: the `patch_failed` message says "masked area(s)" even for an exclusion patch; `areal_scale_factor` is reported but not yet printed anywhere (caught again at final review, in the fix wave now). |
| 9 | Surfaces API + `surface_build` job | Extras: a build fails fast if its cloud disappears; a lossy `to_proj4` warning is silenced; extra assertions. Fix round: a build cancelled while still queued used to leave the row stuck `building` — fixed in the surfaces service's read path (a `building` row with a terminal job settles to a readable `failed`, deletable) rather than a runner hook, since the runner is shared by every job type; a create/cancel race was also fixed. A separate flake investigation (not one of the 17 tasks) found `set_job`/`_settle` racing a build job thread on read-then-flush (`StaleDataError` on cancel, or `_settle` overwriting a failure message) — fixed with single `UPDATE` statements and compare-and-set; 70 consecutive passes after, versus 15/30 failing before. |
| 10 | Contract fuzz coverage | Added a `GenerationMode.POSITIVE` guard so a schemathesis rule judges positive cases only. Deferred: the ortho 409/422 paths are fuzz-covered only, not asserted directly. |
| 11 | Volumes API + `volume_calc`/measurements | Extras: `_settle` for a `calculating` row whose job already ended; diff tiles read the `results.top_surface` lattice; explicit `null` in a PATCH is treated as "not sent". Fix round: `start_calculation` left the *old* job id on a `calculating` row, so `_settle` could flip a running recalculation back to stale — fixed with compare-and-set; PATCH used to silently accept `null`/`{}` (the contract forbids it) — now 422; the diff-tile and footprints hot paths used to run a full `get_measurement` per tile — lightened; a create-submission failure used to leave a row `calculating` with no job id — restored; results are now committed before the diff `os.replace` (a Windows file-lock ordering fix). |
| 12 | PDF report | Added a `patch_failed` sentence to the PDF's Method page (judged in scope by review). Deferred: no dedicated test for that sentence; `row_for` builds a fresh pyproj `Transformer` per row. |
| 13 | Export formats, `volumes-selftest` | The frozen PyInstaller build and `smoke_frozen.ps1` for `volumes-selftest` were **not run** — the overlay venv has no starter weights/PyInstaller, and the shared sidecar binary build is deferred to the operator's packaging run (an ADR records an open hidden-import question). The OpenAPI export-folder summary text was corrected to `exports/<stamp>/`. Fix round: cut/fill file stems used to collide on duplicate, slug-equal or non-ASCII measurement names, and the GeoPackage was grouped by WKT but *named* by EPSG (a collision) — both fixed; cancel checks added inside the plan-image render loop; export formats de-duplicated; a stale-PATCH assertion added. |
| 14 | (paired with the B1 batch) | Clean review, no findings. |
| 15 | Frontend surfaces-screen scaffold, e2e | Deviation: a `toast("warn", …)` call became `toast("info", …)` — no "warn" toast tone exists in the design system. Fix round: a leftover `vi.mock` for `diffLayer` (against an earlier ruling) removed; the Draw tool used to stay active after creating a measurement, so the next click overwrote it — fixed; the empty state now counts only *ready* clouds, and the create dialog clears its error on retry. Deferred: `selectedExclusion` isn't reset when the measurement changes; a cursor-sample ordering/trailing-timer edge case; Modify mode covers footprints; clicking a building/failed surface in the list is a no-op. |
| 16 | Volumes screen, toolbar, panels | Fixed 3 "set state in an effect" lint errors during implementation; Alert actions moved to their own row (a no-wrap slot was squeezing the alert text to zero width). Fix round: the toolbar used to overflow the map at 1280 px over the aside, and "New measurement" spilled the left column — both fixed (this is the walkthrough's toolbar/New-button behaviour above); the buffer-around-machines field went stale after a Revert; the Base surface list was CRS-filtered to reject a cross-CRS base with 422 `invalid_base` — **this ruling was reversed at final review**: spec §6.2/§6.4 allow a base in any CRS (R3 reprojects it), so the UI now offers any CRS and only the local-vs-georeferenced mix is refused. Deferred: `calculate` is invoked from two places (MeasurePanel and VolumesScreen); footprints re-fetch on every masks-object change, not just a real change; Revert / cut-fill / View-in-3D are UI-untested; `editor.spec.ts:169` flakes under machine load. |
| 17 | Acceptance, evidence, docs, merge (this task) | Acceptance ran at **module level** (`build_surface` and the volumes engine called directly — no app, no job runner, no database), by controller ruling, because S1's point-cloud import UI is not on `main` yet; merging S2 is not blocked on S1. The in-app walkthrough, the CloudCompare cross-check and the QGIS/PDF/XLSX review are recorded as pending operator steps. |

Controller rulings worth keeping (from the SDD ledger, summarised): duplicated helpers
(`alignment._cells`, `grid._same_crs`, `ring_polygon(...).bounds`) were kept rather than merged, to
keep tasks parallel; 409 vs `conflict`/`not_ready` response codes were standardised per the
coordinator's pre-flight rulings (P1–P19); implementers ran only their focused tests plus ruff, with
the controller running the full suite after each batch merged, to avoid starving the machine with
concurrent full suites; the **base-CRS filter Task 16 added was reversed** at final review (spec
allows any CRS for a base; only a local/georeferenced mix is refused server-side); and the
**shifted-net check on the synthetic +0.100 m copy is ruled a pass in substance** — the residual
0.0025 m³ over 1 600 m² is float32 height quantisation (about 1.5 µm/cell) on a *perfect* synthetic
shift with zero stable-area spread, not a volume-engine defect; no sigma floor was added to the
engine to force a literal pass, since that would change the uncertainty maths and require bumping
`ENGINE_VERSION` for a demo-only artefact. The **final whole-branch review** (`754c741..94c4e8b`)
found five Important issues — (1) the Volumes screen rejects its whole reload when `GET /pointclouds`
answers F0's 501 stub (S1 not merged yet); (2) the cut/fill layer used the current top surface's
grid while the backend renders on `results.top_surface`'s lattice; (3) a detection review
(reject/reclass) doesn't change a measurement's inputs fingerprint, so stale numbers stay exportable;
(4) the Task 16 base-CRS filter contradicted spec §6.2/§6.4 (reversed, above); (5) these Task 17 docs
were missing (this entry closes it) — plus minors (`areal_scale_factor` not printed though the PDF
claims it is; the volumes service's `_settle` still reads then flushes; a row-less folder can leak
on a Windows rename lock; a surface-create submit failure isn't restored; a calc-vs-export race; a
stale `validate_export` transition not persisted). The fix wave for Important 1–4 plus the cheap
minors is running in `volumes-tfx`; the full gate re-runs before the eventual merge.

What missed its target: big9's peak memory (1 818 MiB) passes the ≤ 2 GB acceptance bound but misses
the tighter 1.5 GB target by about 18 % — parked as a follow-up to profile `build.py`'s bin/spill
buffers, since memory should be set by one block regardless of overall site size; the +0.100 m
shifted-net check fails "net within ± U" literally on the synthetic perfect-shift case (ruled a pass
in substance, above); the CloudCompare cross-check, the QGIS/PDF/XLSX export review and the in-app
walkthrough are all pending — CloudCompare isn't installed on the build machine and S1's import UI
isn't on `main` yet; and the frozen PyInstaller smoke test for `volumes-selftest` is pending the
operator's packaging run (no starter weights/PyInstaller in the overlay venv used for S2's own
gates).

Follow-ups: (1) profile the build pipeline's memory growth with site size before accepting larger
sites; (2) once S1's import UI lands on `main`, repeat the task-17 brief's Steps 1–7 end to end and
fill in `docs/evidence/volumes-crosscheck.md`'s open rows and the walkthrough's in-app screenshots;
(3) the operator installs CloudCompare 2.13 and runs the §7.3 cross-check by hand; (4) run the
frozen-build packaging smoke test for `volumes-selftest` and close the ADR's hidden-import question;
(5) land the final-review fix wave (`volumes-tfx`) and re-run the full gate via `finish-task.ps1`
before merging `task/volumes` to `main`.

## Point-cloud foundation F0 — 2026-09-24 (`task/pointcloud-foundation`, merged to `main`)

Spec `docs/superpowers/specs/2026-09-23-point-clouds-design.md` §5 (with S2 §11 and S3 §12), plan
`docs/superpowers/plans/2026-09-24-pointcloud-foundation.md`. The shared ground S1 (point clouds),
S2 (volumes) and S3 (design surfaces) build on in parallel worktrees.

What changed:

- **Contract:** every S1–S3 path and schema (37 operations; tags `pointclouds`, `surfaces`,
  `volumes`), the job types `pointcloud_import`, `pointcloud_export`, `surface_build`,
  `volume_calc`, `volume_export`, `design_import`, and the events `pointclouds.changed`,
  `surfaces.changed`, `volumes.changed`. Every operation answers 501 until its unit lands
  (`EXPECTED_STUBS`); writes are detection-project only.
- **Migration `0009_pointclouds_surfaces_volumes`** (add-only): `point_cloud`, `cloud_measurement`,
  `surface`, `volume_measurement`. The only migration of S1–S3.
- **Backend scaffolding:** four packages with stub routers and stub jobs, four no-op startup sweeps
  in `project_opened`, the PotreeConverter seam with an offline fake in the `app` fixture,
  `pointcloud-selftest` / `design-selftest` / `volumes-selftest` placeholders, CORS `Range` for the octree loader.
- **Dependencies:** laspy 2.7.0, lazrs 0.8.2, openpyxl 3.1.5, ezdxf 1.4.4 new; scipy, shapely,
  psutil now direct; potree-core 2.0.15, three 0.180.0, @types/three 0.180.0 exact.
- **UI:** Point clouds and Volumes below Site areas in a detection project (empty, lazy-loaded
  screens), "About Kestrel AI" on App settings.
- **Venv** (`vault/decisions/2026-09-24-worktree-overlay-venv-for-new-dependencies.md`): built
  with an overlay venv; laspy, lazrs, ezdxf, openpyxl and et-xmlfile were then installed into the
  shared `backend/.venv` additively (`--no-deps`, nothing else changed), so the landing gate ran
  normally.

Verified on the branch (2026-09-25) with the AGENTS.md gate on the shared interpreter:
`pnpm -C contract check` clean; ruff clean; pytest 1362 passed; frontend lint clean, vitest 824
passed, build ok; e2e 79 passed; cargo test skipped (no frozen sidecar in the worktree). Alembic
heads on the merge result: `['0009']`.

Operator walkthrough: not user-observable beyond two empty screens and two nav entries — open a
detection project and click Point clouds, then Volumes; App settings → About Kestrel AI.

## Detection workspace — 2026-09-23/24 (gated on `task/dw-integration`, not yet on `main`)

Plan 2 of the train/detect split (spec
`docs/superpowers/specs/2026-09-23-train-detect-split-and-model-library-design.md` §7–§10, plan
`docs/superpowers/plans/2026-09-23-detection-workspace.md`). Built as parallel units C, S, D, R, V,
A, E and X in `.claude/worktrees/dw-*`, merged into `.claude/worktrees/dw-integration`.

What changed:

- **A detection project is a site workspace.** Its sidebar is Sources, Runs, Review, Analytics,
  Export, then Site areas. The old Detect, Maps and Surveys steps are gone; their addresses still
  open (`/surveys` redirects to Analytics).
- **Sources** lists photo batches and maps in one table, newest survey first; the survey date is
  edited in place (a map source's date writes the map too).
- **Runs** apply one library model to one source each. A model class the project lacks is asked
  once (`422 unmapped_classes`, then `PUT /model-class-maps/{model}`) and remembered. Pinning a
  run makes it the one its source counts with.
- **Review** picks a source: photos use the image queue and editor, a map opens the viewer in
  review mode (A / R / 1–9 / N, draw a missed object, accept above a confidence as a job).
- **Counts live on run rows** (`counts` = total, `verified_counts`, `area_counts`, migration
  `0008_detect_workspace`, add-only). Every review write increments them in the same transaction;
  `recount` / `area_recount` rebuild them
  (`vault/decisions/2026-09-23-counts-live-on-run-rows.md`).
- **Site areas and Analytics.** Areas are drawn on a map; Analytics shows surveys, one source,
  per-area counts (partly covered marked) and photo batches (detections, never objects), with a
  Verified-only switch. Analytics reads run rows only.
- **Export**: a `detect_export` job writes a CSV (source × class × area) or a PDF report per source
  (new dependency `reportlab==5.0.1`, see `CONTRIBUTING.md`); the GeoPackage gains `review_state`,
  the mapped class name and a `site_areas` layer.

Unit X added:

- e2e specs `sources.spec.ts`, `runs.spec.ts` (422 mapping step, then the retry), `detect-review.spec.ts`
  (map review keys), `analytics.spec.ts` (verified toggle, photo caption), `detect-export.spec.ts`;
  `projects.spec.ts` and `surveys.spec.ts` rewritten for the new steps and the `/surveys` redirect
- the backend flow test `tests/test_detect_flow.py`: photos and a map, a class-mapped run per
  source, review on both, a site area; analytics equal a recount, and the CSV carries the same
  numbers
- the operator walkthrough `docs/usability/2026-09-23-detection-workspace-walkthrough.md`
- the ADR above and the reportlab note in `CONTRIBUTING.md`

X also fixed one regression the full e2e suite found: the old Detect screen's **Review results**
link (`/review?ids=`) landed on the per-source Review picker in a detection project, which ignores
the ids. With `ids` in the address, Review now keeps the narrowed image queue
(`frontend/src/screens/ReviewScreen.tsx`, owned by unit V; test in `ReviewScreenIds.test.tsx`).

Verified in the integration worktree (2026-09-24, on the tree of this entry's commit minus the
entry itself), with the gate lines from `AGENTS.md`:

- contract check: clean
- Ruff check and format: clean
- pytest: 1269 passed, 9 deselected
- frontend lint: 0 errors (1 existing hook warning in `MapView.tsx`)
- unit tests: 796 in 164 files
- build: passed
- e2e: 76 browser tests in 25 files, on free ports as `scriptsinish-task.ps1` runs them
- `cargo test`: skipped, because this worktree has no frozen sidecar

Not yet done: landing (`scriptsinish-task.ps1` from `dw-integration`, then removing the `dw-*`
worktrees by the junction rule), and a frozen build that proves the PDF export with reportlab.

## Model library and project kinds — 2026-09-23 (gated on `task/tds-integration`, not yet on `main`)

Plan 1 of the train/detect split (spec
`docs/superpowers/specs/2026-09-23-train-detect-split-and-model-library-design.md` §4–§6, plan
`docs/superpowers/plans/2026-09-23-model-library-and-project-kinds.md`). It was built as parallel
units C, BL, BK, FL, FK, BM, FM and X in `.claude/worktrees/tds-*`, and merged into the
integration worktree `.claude/worktrees/train-detect-spec`.

What changed:

- **App-wide model library.** Every model now lives in `%APPDATA%\kestrel-ai\library`, which has
  its own `library.db` and migrations. Import, export and starter download run as library jobs on
  the project `JobRunner`, through a project-shaped `LibraryHandle`
  (`vault/decisions/2026-09-23-library-jobs-reuse-the-project-jobrunner.md`). If the library
  cannot open, the app still starts and every library route answers `503 library_unavailable`.
- **Two kinds of project.** Projects are `train` or `detect` (migration `0007_project_kind`). A
  server-side `require_kind` guards every project route, and a route-walk test fails when a route
  declares no kind. Each kind gets its own sidebar steps. Training projects show their old runs
  and maps under a read-only **Past detections**.
- **Adoption of old models.** Opening a training project copies its old models into the library
  (job `library_adopt`). The ids in pre-annotation, query runs, map runs and boxes are rewritten
  with set-based `UPDATE`s. Nothing in the old `models/` folder is deleted. A past map can be
  moved into a detection project (job `map_move`).

Unit X added:

- the e2e specs `library.spec.ts` (import, then a job with progress, then the new model
  selected), `projects.spec.ts` and `past-detections.spec.ts`
- the backend test `test_library_adoption.py::test_real_project_copy`, which opens a schema-0005
  project through the API and adopts its model
- the operator walkthrough `docs/usability/2026-09-23-library-walkthrough.md`
- screenshots in `docs/evidence/model-library/`

X also fixed two e2e problems found in the full suite:

- The `asDetectionProject` helper fetched from the mock inside its route handler, so a request
  still in flight when a test ended failed that test ("route.fetch: Test ended"). The helper now
  reads the mock once, up front.
- The contour spec's locked-Train check broke once Train counted library models trained in the
  project. The spec now serves an empty library.

Verified in the integration worktree (2026-09-23), with the gate lines from `AGENTS.md`:

- contract check: clean
- Ruff check and format: clean
- pytest: 1066 passed, 9 deselected
- frontend lint: 0 errors (1 existing hook warning in `MapView.tsx`)
- unit tests: 703 in 147 files
- build: passed
- e2e: 67 browser tests, on free ports as `scripts\finish-task.ps1` runs them
- `cargo test`: skipped, because this worktree has no frozen sidecar

**Migration renumbered at merge:** `main` already had the survey timeline's `0006_map_captured_on`
(down_revision `"0005"`), so this branch's migration became `0007_project_kind` (revision `"0007"`,
down_revision `"0006"`); a single Alembic head `0007`, chain `0001..0007`. `map_move` copies every
`GeoMap` column, so `captured_on` moves with the map. The Surveys screen is a detection-project
screen (sidebar entry and `KindRoute` for `detect` only; the timeline read stays open to both kinds on
the server).

## Project agent — 2026-09-22 (merged, installed)

An in-project AI drawer that operates the app with the user's own OpenAI or Anthropic key. The
turn loop runs in the sidecar (keys never leave it) as a cancellable asyncio task; ~35 tools call
the existing API routes in-process through httpx `ASGITransport`, so validation, background jobs
and websocket events are the ones the UI already uses. Image-targeting tools take a *selector*
(filters, sort, offset, limit) resolved server-side, so "the first 500 images" never sends 500 ids
through the model. The transcript lives in the project DB (`agent_turn`, `agent_item`, migration
`0004_agent`). Cloud labeling, training and every delete pause the turn with an Approve/Deny card
carrying the cost estimate. Design `docs/superpowers/specs/2026-09-22-project-agent-design.md`,
plan `docs/superpowers/plans/2026-09-22-project-agent.md`, SDD records under
`.superpowers/sdd/2026-09-22-project-agent/`.

Reviews caught and fixed, before merge: a hard kill mid-reply used to replay tool calls with no
result and break the conversation permanently; a model-chosen `..` id could reach
`DELETE /projects/{id}`; an approval card could dead-end when the key was removed; the 120 s model
timeout was too short for adaptive thinking (now 300 s); mutating tools defaulted to "the first
100 images" when the model omitted a selection.

Verified on the reference machine: contract check clean, Ruff clean, 854 backend tests, frontend
lint, 564 unit tests, build, 62 browser tests, 8 Rust tests (the frozen sidecar was present).
The frozen sidecar was smoke-tested for the new routes (startup, health, `GET /agent`, 422 on a
bad body). The installer was rebuilt (1.85 GB, 472 s) and installed over the operator's app; the
drawer was then driven over CDP in the installed build: it opens inside a real project and reports
`gpt-5 · Ready`. No test or check called a paid provider.

## Contour UI — 2026-09-21

The operator selected Contour after the standalone visual study. Source implementation is in
`275f6fe` and `bd145d4`: charcoal/amber tokens, compact expandable navigation, real bounded Home
imagery, separated image captions, and one scrollable drawing/review inspector. Existing shortcuts,
annotation operations and API/background-job behavior are preserved. Review caught and fixed clipped
locked-step tooltips and shortcut help; a bounded 1024px hero replaces enlarged 256px thumbnails.

Verified: contract check, Ruff, 620 backend tests, frontend lint, 517 unit tests plus final focused
checks, build, 57 browser tests and 13 actual-app development screenshots. Rust tests were skipped
because this worktree has no frozen sidecar. The first backend run had one intermediate-epoch timing
failure; the isolated module and full rerun passed without source changes. Full provenance, limits,
reproduction and operator walkthrough: `docs/evidence/ui/2026-09-21-contour/README.md`.
The installed desktop executable was not rebuilt or replaced by this change.

## Current state

Renamed from "Machinery Detection" / `machinery-app` to **Kestrel AI** / `kestrel-ai` on 2026-09-20
(`docs/superpowers/specs/2026-09-20-kestrel-ai-rename-design.md` §2.1 has the full name map).
Evidence and checkpoints below predate the rename and keep the old names on purpose.

| Wave | Sub-project | Branch | Worktree | State | Blockers |
|---|---|---|---|---|---|
| 0 | S0 contract and scaffolding | main (merged from s0-backend, s0-frontend) | - | merged, checkpoint 1 passed | none |
| 1 | S1 dataset backend | main (merged cdafe95) | - | merged; checkpoint 2 backend half passed | none |
| 1 | S2 annotation UI | main (merged 9ed2fd4) | - | merged; checkpoint 2 editor half passed | none |
| 1 | S3 training backend and registry | main (merged 1224343) | - | merged; GPU test passes on main | none |
| 2 | S4 inference and providers | main (merged 6635f71) | - | merged after 2 fix rounds; JobCancelled relocation follow-up open | none |
| 2 | S5 training and inference UI | main (merged 04a879f) | - | merged after 2 fix rounds | none |
| 3 | S6 packaging and acceptance | main (merged from s6-packaging-acceptance at 9f3aa01) | - | merged after 2 fix rounds; checkpoint 4 passed; acceptance run passed (step 7 skipped, no key) | operator key for step 7 |

Last verified checkpoint: 4 (after Wave 3) on main 826a3bf (installed app), 2026-09-18. Acceptance run (spec 13.5) passed from the installed app on 9a2e20d (step 7 skipped: no provider key).

## Phase 2: usability (goal 2, kickoff `KICKOFF_PROMPT_2.md` in the session of 2026-09-19)

Friction list, owner ruling and order of work: `docs/usability/2026-09-19-walkthrough.md` (the "Closed by" column names the commit per item). Evidence: `docs/evidence/usability/`.

| Wave | Item | Branch | State | Blockers |
|---|---|---|---|---|
| U1 | Walk-through of the installed app (51 items), owner ruling: N1, N2, G1, Q1, G2, E4, S2 block | usability-wave1 | done (e1277e2) | none |
| U1 | Small fixes by the goal owner, test-first, one commit each (ids and commits in the friction list): N1-N3, N5, P1, P2, D1-D9, E1-E3, E5, E7, E8, S1, T1-T3, Q1-Q5, Q8, R1, R2, M1, X1, X2, H1 | usability-wave1 | done; verified on the packaged app by `frontend/scripts/usability_walkthrough.mjs` (10 steps passed at a5b9e6c minus the driver fix) | none |
| U1 | G1 starter weights (plan `2026-09-19-g1-starter-weights.md`) | merged into usability-wave1 at e83ce88 (+ re-review fixes 77d23bf) | implemented (sonnet), reviewed (fable), fix round 1, re-reviewed (opus), goal-owner fixes; frozen build 3,520 MB, `smoke_frozen.ps1` ok (`starter ok 3`, `alias ok`); verified on the packaged app (starter model added with the truck alias) | none |
| U1 | E4 negative images (plan `2026-09-19-e4-negative-images.md`) | merged into usability-wave1 (16d480f + re-review fixes 6ec04c8); worktree removed | implemented (sonnet), reviewed (fable), fix round 1 (12 commits), re-reviewed (opus), goal-owner fixes; suites green (447 backend, 331 unit, 48 e2e); first version verified on the packaged app (upgrade of an older project, N, dataset dialog); fix round re-verification with the next build | none |
| U1 | E6 confidence floor in the editor (goal owner, 2f36ebc; E9 interaction with the empty mark aa50eb7) | usability-wave1 | done, unit + e2e; E4 fix round and E6 verified on the packaged app by the walk-through driver (rebuilt from 6ec04c8; all 10 steps passed, steps 6-10 resumed after a driver text fix) | none |
| U1 | S2 Datasets screen + S3 split advice | merged into usability-wave1 via wave1-s2-trial (worktree `.worktrees/wave1`) | implemented (sonnet); review + two frontend fix rounds; dataset deletion rewritten by the goal owner and reviewed three times (8299964 rejected, 355430f, 5f678af, b26dc96); suites green (498 backend, 385 unit, 50 e2e on ports 1520/4110); verified on the packaged app built from the worktree: walk-through 11/11 incl. the Datasets step (list, per-class counts, case-duplicate refused, create and delete a dataset, 404 afterwards); E10 found and fixed | none |
| U1 | G2 results export (plan `2026-09-19-g2-results-export.md`; contract 52e6ce9, 920e32e, 1eafa8c) | merged into wave1-s2-trial (rounds 1-3: efa614a, 13eb4d3) + goal-owner JobFailure fix d587c38 | implemented (sonnet); review (opus) and three re-reviews; suites green (579 backend, 411 unit, 51 e2e); verified on the packaged app: walk-through 12/12 incl. the Export step (all four formats on disk, BOM, self-contained report with thumbnails, no partial folder); the report read by the goal owner | none |
| U1 | Friction list: every item closed except G2/M3 (in G2) and H2 (acceptance step 7) | usability-wave1 | - | none |
| U1 | Friction list closed (2026-09-22, `task/cleanup-a`): M3 was closed in G2 at efa614a per the friction list ("Show in folder" on the model page, tested in `ModelDetail.test.tsx`), only this ledger row was never updated; G3 fixed in 6b04cd1 (readable filled label tags on report thumbnails); H2 closed 2026-09-20 | task/cleanup-a | done | none |
| U1 | Acceptance driver adapted and dry-run on the packaged app (40 frames): steps 1-6 and 8 pass, 7 skipped (no key); real run uses `--conf 0.001`; found and fixed Q10 (66eeb64) | wave1-s2-trial | done | none |
| U1 | End of wave (owner, 2026-09-19): merge to main AND update the owner's installed desktop app: rebuild the installer from the final commit, install it over `%LOCALAPPDATA%/Programs/Machinery Detection` (check no instance runs first), checkpoint 4 and the acceptance driver on it | main 88d9216 | done: installer 1,853.2 MB from 88d9216 (freeze + frozen smoke ok), silent install over the owner's app in 64 s (no instance running); checkpoint 4 PASS (cold 2,170 ms, warm 1,659 ms, GPU visible, clean exit); acceptance 7 passed / 1 skipped (step 7, no key) on all 3,299 frames; walk-through 12/12 on the installed app (`docs/evidence/usability/2026-09-19-after/`) | none |
| U1 | Acceptance step 7 (H2) | main 177f68b | done 2026-09-20: keys stored by the owner; acceptance 8/8 on the installed app, step 7 with tiling and anthropic provenance; both provider keys pass the live test. Evidence `docs/evidence/acceptance/2026-09-20-installed-177f68b/` | none |
| U2 | Site office UI redesign (spec `2026-09-19-site-office-ui-design.md`, plan `2026-09-19-u2-site-office-ui.md`, `PRODUCT.md`, `DESIGN.md`) | merged to main (fast-forward at 2bc15a4) | every screen on `frontend/src/ui/`; pipeline sidebar with Export as step 7, project Home, Label step, toasts, plain wording; lint (raw-palette check), 462 unit, build, 53 e2e, walk-through 12 steps / 66 checks on the real backend; installer rebuilt (1,853.2 MB) and installed | none |

**Two sessions, one checkout (2026-09-19 14:09).** Another session checked out `ui-site-office` (UI redesign, plan `2026-09-19-u2-site-office-ui.md`) in the main checkout `E:/Dev/Yolo/app`, branched from this wave's trial branch at 8299964. A merge of this session landed on that branch uncommitted and was aborted at once (`git merge --abort`; the other session's commits and untracked files were not touched). Since then the usability wave integrates in its own worktree `.worktrees/wave1` (branch `wave1-s2-trial`), never in the main checkout; every git write checks `git branch --show-current` first; `pnpm e2e` only runs when ports 1420/4010 are free. Owner ruling on sequencing (2026-09-19): finish this wave first (S2, G2, installer, checkpoint 4, acceptance, merge to main); the UI redesign rebases `ui-site-office` onto main before it restyles screens. Note for that rebase: `ui-site-office` branched at 8299964, whose dataset-delete code was rejected in review and replaced by 355430f.

How the walk-through instance is started without touching a running app: a second instance of the installed exe with `WEBVIEW2_USER_DATA_FOLDER=<scratch>` and `WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=--remote-debugging-port=9222`; stop it by its own PID only.

Working rules added on 2026-09-19 (afternoon): integration in `.worktrees/wave1` (branch `wave1-s2-trial`, fast-forwarded into `usability-wave1` after each verified step); e2e on own ports (`E2E_WEB_PORT`, `E2E_MOCK_PORT`; 1420/4010 are held by the UI session's dev servers); a worktree freezes the backend with `build.ps1 -Venv E:/Dev/Yolo/app/backend/.venv` and needs its own `backend/starter_weights` (fetch script).

Verification without touching a running installed app: a private copy of the would-be install tree (`machinery-app.exe`, `machinery-backend.exe`, `_internal`) in a scratch folder, started with its own WebView2 profile and CDP port. The installer itself, checkpoint 4 and the acceptance driver run at the end of the wave.

Worktree removal as practised for G1: list reparse points (2,106 pnpm links, none pointing outside), remove each link with `rmdir`/`del`, then `git worktree remove --force`; the shared venv was checked afterwards.

Last verified commit on main: 88d9216 (end of usability wave 1), 2026-09-19: 579 backend, contract check, lint, tsc, 411 unit, build, 51 e2e; installed as the owner's desktop app and verified there (checkpoint 4, acceptance, walk-through). Evidence: `docs/evidence/checkpoint4/2026-09-19-installed-88d9216/`, `docs/evidence/acceptance/2026-09-19-installed-88d9216/`, `docs/evidence/usability/2026-09-19-after/`. Open: acceptance step 7 (H2) once the owner stores the Anthropic key in App settings; G3 (class labels on report thumbnails) after this wave. The UI redesign (`ui-site-office`) rebases onto this main next.

## Plans

- S0: `docs/superpowers/plans/2026-09-17-s0-contract-and-scaffolding.md` (ledger: `2026-09-17-s0-ledger.md`)
- S1: `docs/superpowers/plans/2026-09-17-s1-dataset-backend.md`
- S2: `docs/superpowers/plans/2026-09-17-s2-annotation-ui.md`
- S3: `docs/superpowers/plans/2026-09-17-s3-training-backend.md`
- S4: `docs/superpowers/plans/2026-09-18-s4-inference-providers.md`
- S5: `docs/superpowers/plans/2026-09-18-s5-training-inference-ui.md`
- Wave 2 ledger (rulings, deferred minors): `docs/superpowers/plans/2026-09-18-wave2-ledger.md`
- Wave 3 ledger (rulings, deferred minors): `docs/superpowers/plans/2026-09-18-wave3-ledger.md`
- S6: `docs/superpowers/plans/2026-09-18-s6-packaging-acceptance.md`
- Wave 2 ledger: `.superpowers/sdd/wave2/ledger.md`
- Wave 1 ledger: `.superpowers/sdd/wave1/ledger.md` (git-ignored; copied into docs at wave end)

Wave 1 mechanics: each worktree's `backend/.venv` is a directory junction to `backend/.venv` in the root checkout
(one shared environment; sub-agents must not install packages). Implementer reports land in
`.superpowers/sdd/wave1/<s>-report.md` (git-ignored). Merge order after review: S1, S3, then S2.

## Decisions the spec does not cover (question, chosen default)

1. Where do the shared job runner, event bus, SQLite models, migrations and project store live?
   Default: in S0. Three Wave 1 sub-projects need them and would otherwise each invent one.
   S1, S3 and S4 register job types through `app.jobs.registry.register_job_type`.
2. Are jobs global or per project? Default: per project (`/projects/{p}/jobs`), because the Job
   table is in `project.db` (spec section 4). The websocket `/api/v1/events` is global and
   every event carries `project_id`.
3. How does the browser get the token for the websocket? Default: `?token=` query parameter,
   because browsers cannot set headers on websocket connects. Rejected connects close with 4401.
4. Mock server and client generator: Stoplight Prism serves `openapi.yaml` on 127.0.0.1:4010;
   `openapi-typescript` generates `contract/client/schema.d.ts`; `openapi-fetch` wraps it.
5. Ports: backend dev 8765 (the launcher picks a free port in the packaged app), mock 4010,
   Vite 1420. 8080 and 9090 are left to the existing Label Studio workflow.
6. Extra endpoints beyond the literal spec section 9 list, each tied to another spec section:
   `GET /projects` (recent), `PATCH /projects/{p}` (settings), `POST .../images/{id}/preannotate`,
   `POST .../models/train`, `POST .../query-runs/estimate`, `POST .../images/bulk-delete`,
   `GET /projects/{p}/stats`. Recorded in the S0 plan.
7. The S0 sidecar is a PyInstaller build that excludes torch so checkpoint 1 can prove the
   boot mechanism quickly; S6 produces the full CUDA build.
8. Python dependency management: `uv venv --python 3.11.15` under `backend/.venv` and
   `uv pip install -r requirements-dev.txt`. The ML stack is pinned to the reference machine;
   app libraries are pinned by `requirements-lock.txt` produced after the first install.
9. Tauri identifier `ai.synapse-solutions.kestrel-ai`, product name "Kestrel AI".
10. Contract additions during Wave 1 (goal owner): `ModelImport.weights_path` minLength 1 (S3 can answer 422);
    `ExportRequest.half` documented (onnx on CPU, engine on GPU 0); `BoxReview.action` gains `unreview`
    (undo of accept/reject; person boxes ignored). In the editor, Delete on a proposal means reject.
11. ONNX export needs `onnx`/`onnxslim`/`onnxruntime`; added to `requirements.txt` (S6 decides TensorRT).
13. Installer format: NSIS (`makensis` 32-bit payload offsets) and MSI (compound file with 512-byte sectors, one embedded cab) both fail above 2 GB, and the CUDA sidecar is 3.46 GB with no trimmable margin (torch_cuda.dll imports the big CUDA DLLs by name; the frozen smoke test catches removal). Chosen: Inno Setup 6 (LZMA2, no 2 GB limit, per-user install, Start Menu shortcut, uninstaller) compiled by the `innosetup-compiler` npm package inside `frontend/node_modules` (no system install), wrapping `tauri build --no-bundle` output plus the WebView2 bootstrapper. Rejected: WiX external cabs (multi-file distribution) and a split/side-loaded payload (spec asks for one installer). Spec section 10 updated.
12. Packaged smoke test needs GPU visibility: optional `Health.gpu` `{available, name}` in the contract (f52267c), probed once in a background thread after the first health request so health stays fast.

## Incident: shared venv deleted with the S6 worktree (2026-09-18, recovered)

`rm -rf .worktrees/s6-packaging-acceptance` (after `git worktree remove --force` had refused with "Directory not empty") emptied `backend/.venv` at the same minute: the worktree held a junction to the shared venv and the recursive delete followed it. This is the mechanism that was only suspected in the Wave 1 incident. Recovery: `uv venv .venv --python 3.11.15`, `uv pip install -r requirements-lock.txt -r requirements-dev.txt --extra-index-url https://download.pytorch.org/whl/cu130` (wheels came from the uv cache); verified torch 2.14.0+cu130 with CUDA, ultralytics 8.4.154, and the full backend suite. Rule from now on: never `rm -rf` a worktree; before removing one, list reparse points (`Get-ChildItem -Recurse -Attributes ReparsePoint`) and delete junctions with `rmdir` (which removes the link, not the target); sub-agents must not create links into the shared venv.

## System installs (the single allowed exception)

- 2026-09-17: rustup 1.29.1 via `winget install Rustlang.Rustup`; toolchain stable-x86_64-pc-windows-msvc (rustc 1.98.1, cargo 1.98.1). MSVC 14.29 and Windows SDK 10.0.19041 were already present. Playwright downloaded Chromium into the user profile (not a system install).

## Checkpoints

### Acceptance run (spec 13.5) — PASS with one operator-dependent step skipped, main 9a2e20d, 2026-09-18

Run from the installed app (`%LOCALAPPDATA%\Programs\Machinery Detection`, installer `dist/Machinery Detection_0.1.0_x64-setup.exe`, 1,797 MB, built at 9f3aa01) by `frontend/scripts/acceptance.mjs` over CDP, following `scripts/acceptance.md`. Source: `E:\Dev\Yolo\Ahmadia Construction Data` (read only; the import job only reads it). Project folder: `%TEMP%\acceptance-project` (about 20 GB, kept as evidence source). Evidence: `docs/evidence/acceptance/` (`acceptance.json`, `acceptance-run1..5.log`, screenshots 01–08, `acceptance-04-data-yaml.txt`). Five driver invocations: run 1 was cut by the tool's 10-minute cap during the import (the import job kept running in the sidecar); later runs resumed with `--project-id` and re-verified the earlier steps through the API.

| Spec step | Result | Evidence |
|---|---|---|
| 1. Project "Ahmadia" with the eight classes | PASS | run1.log, `acceptance-01-project.png` |
| 2. Import the original folder: 3299 images, 0 duplicates, 7 flights | PASS: 3299 / 0 / `0031,0033,0034,0035,0038,0040,0042` (import 6 min) | run1.log, `-02-import.png` |
| 3. COCO yolo11m as pre-annotation model; open 10 images; proposals on at least one | PASS: 4 `local_model` proposals over 10 images spread across the import. First attempt FAILED with the driver opening the first 10 frames of flight 0031 (take-off run-in, nothing on them). Goal-owner check: the same weights at the pre-annotation defaults (imgsz 2560, conf 0.25) fire on 49 of 100 frames spread across the import, so the driver and `scripts/acceptance.md` now open 10 evenly spread frames. | run2.log, `-03-preannotation.png` |
| 4. Label 30 images; dataset "v1" split by group; train and val folders; valid data.yaml | PASS: labeled 30, train 24 / val 6, `by_group`, frozen images are exactly the 30 labeled ones, data.yaml names the eight classes | run2.log, `-04-dataset.png`, `-04-data-yaml.txt` |
| 5. Train YOLO11n for 3 epochs; progress events; registered model with metrics | PASS: 3 `job.progress` websocket events, epoch card "3 / 3", model `ahmadia-v1` registered with metrics (mAP50 0.000, as expected from placeholder boxes) | run2.log, `-05-training.png` |
| 6. Run the trained model over 50 unlabeled images; review; promote | PASS: 50 images (verified unlabeled), 600 tiles, 0 failed; review queue lists the 50 images; promoted. At the default confidence 0.25 (and at 0.01) the model produced 0 boxes; the goal owner verified with ultralytics directly that its maximum confidence on these frames is 0.0016, so the run was repeated at 0.001: 54,670 boxes. The spec sets no box count; the driver's own minimum of 1 box is what failed first. | run5.log, `-06-query-run.png`, `-06-review.png`, `-06-promoted.png` |
| 7. Anthropic vision query "dump trucks" over 5 images with tiling; boxes with provider provenance | SKIPPED: no `ANTHROPIC_API_KEY` in this environment and no key in Credential Manager. The driver runs the step when either exists (a key from the environment is stored through the providers endpoint for the run and deleted afterwards; a stored key is used and left alone) and asserts `cloud_provider`/`anthropic` provenance with at least one box. To be run by the operator with a key. | `acceptance.json` `skipped` |
| 8. Export the model to ONNX; file under `models/` | PASS: `models/ahmadia-v1-31e53a50.onnx` | run5.log, `-08-export.png` |

Uninstall check: `unins000.exe /VERYSILENT` exit 0 in 7 s, install dir and Start Menu shortcut removed, app data kept; reinstalled from `dist/` (exit 0, 58 s).

Driver defects found and fixed during the run (not app defects): first 10 frames by path instead of a spread (step 3); review-queue row count read while the list was still loading (step 6).

## Definition of done (kickoff)

| Item | State |
|---|---|
| `pnpm build:installer` (tauri build + Inno Setup) produces an installer; the installed app starts in under 15 s with the sidecar healthy | Done: 1,797 MB installer; cold start 1.6 s (3.0 s on the very first launch), sidecar healthy with GPU visible (checkpoint 4) |
| Acceptance run passes end to end from the installed app with evidence linked | Done for steps 1–6 and 8; step 7 needs an Anthropic key from the operator (see above) |
| Backend, frontend and contract suites pass on `main` | Done at 826a3bf and re-run since: ruff, 403 backend, 4 GPU, contract check, frontend lint, 209 unit, build, 42 e2e |
| README explains build, dev (mock and real backend), tests | Done (`README.md`) |

### Checkpoint 4 (after Wave 3) — PASS on main 826a3bf, 2026-09-18

Spec 13.4 #4: the installed app. Installer `Machinery Detection_0.1.0_x64-setup.exe` (Inno Setup, 1,797 MB, built at 9f3aa01 = main minus docs) installed per-user with `/VERYSILENT /SUPPRESSMSGBOXES /NORESTART /CURRENTUSER`: exit 0 in 60 s; install dir `%LOCALAPPDATA%\Programs\Machinery Detection` 3,512 MB (`machinery-app.exe`, `machinery-backend.exe`, `_internal`, uninstaller); Start Menu shortcut present. Driver: `frontend/scripts/checkpoint4.mjs` (launches the installed exe with the WebView2 debugging port, attaches over CDP). Evidence: `docs/evidence/checkpoint4/checkpoint4.json` and screenshots.

| Measure | Value |
|---|---|
| First launch after install: process start to Projects heading | 2,969 ms (healthy backend 2,980 ms) |
| Cold launch (driver run, machine quiet): to Projects heading / healthy backend / GPU probe answered | 1,645 ms / 1,655 ms / 2,682 ms |
| Warm launch: to Projects heading / healthy backend / GPU probe | 1,625 ms / 1,628 ms / 2,637 ms |
| Health `gpu` | `{available: true, name: "NVIDIA GeForce RTX 5070 Ti"}` |
| Project creation from the installed app | PASS (8 classes) |
| Closing the window stops the sidecar and the app | PASS (cold and warm) |

Rebuilt and re-verified from main 6eeec68 (after the progress-message and import-lock changes): freeze 36 s incremental, frozen smoke ok in 27 s, `pnpm build:installer` 464 s, installer 1,797.3 MB (`dist/`), reinstall 57 s; checkpoint 4 driver again PASS: cold 2,992 ms to Projects / 3,005 ms healthy / GPU probe 6,091 ms; warm 1,391 ms / 1,423 ms / 2,950 ms; project creation and sidecar exit on close both PASS.

Success criteria: installer 1.8 GB (< 6 GB); cold start well under 15 s. The first driver attempt failed on the driver's own timing (it read the `gpu` block before the background probe had answered); the driver now polls for it. Uninstall check recorded after the acceptance run.

### Checkpoint 3 (after Wave 2) — PASS on main 6635f71, 2026-09-18

Spec 13.4 #3: import, label with pre-annotation, create a dataset, train, run a query with the trained model and promote, all from the real app (Tauri dev shell in env mode, `WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=--remote-debugging-port=9222`) against the dev backend started from the full venv on port 8765. Driver: `frontend/scripts/checkpoint3.mjs` (Playwright over CDP; UI actions, API assertions). The run took three driver invocations because of two driver defects, fixed in place; nothing was re-done: the driver resumes on `CP3_PROJECT_ID` and `CP3_TRAIN_JOB_ID`. Evidence in `docs/evidence/checkpoint3/` (`checkpoint3-run1.log`, `-run2.log`, `-run3.log`, `checkpoint3.json`, screenshots 01–09).

| Step (UI unless noted) | Result | Evidence |
|---|---|---|
| Create project from the Projects screen (8 default classes) | PASS, project `ed5a8802` | run1.log |
| Import images dialog: 20 sample frames (copies from `data/raw/ahmadia`), site ahmadia | PASS: imported 20, duplicates 0, failed 0, one group `0031` | run1.log, `checkpoint3-01-import-started.png`, `-02-data-manager-imported.png` |
| Models screen: Import weights (`models/yolo11m.pt`, 80 COCO classes), Use as pre-annotation model | PASS | run1.log, `-03-model-imported.png` |
| Open 10 images in the editor: pre-annotation runs on open | PASS (0 proposals: COCO classes do not fire on nadir construction frames; the call path is exercised and answered 200) | run1.log, `-04-editor-after-preannotate.png` |
| Label 12 images (hotkey 1, drag a box each) | PASS: labeled 12, boxes 12 | run1.log, `-05-labeled.png` |
| Data Manager list view: tick the 12 labeled rows, Add to dataset, name `v1`, Create dataset | PASS: dataset job succeeded, train 10 / val 2 | run2.log, `-06-dataset-created.png` |
| Train screen: start training on `v1` from the imported weights (imgsz 640, batch 4) | PASS: job succeeded, epoch card "50 / 50", model `0c2d4482` registered with metrics (mAP50 0.068, expected for 10 images) | run2.log, `-07-training-done.png` |
| Query screen: trained model, confidence 0.01, Estimate, Start | PASS: estimate "8 images, 96 tiles, 96 requests"; run succeeded, 8 images, 96 tiles, 5263 boxes, 0 failed tiles | run3.log, `-08-query-run.png` |
| Promote at minimum confidence 0 | PASS: `promoted_at` set | run3.log, `-09-promoted.png` |
| Cloud provider query (spec 13.4 #3 "with a cloud provider") | SKIPPED: no `ANTHROPIC_API_KEY` / `OPENAI_API_KEY` in this environment. The driver runs the step when the variable is set (key stored through the providers endpoint at runtime, deleted afterwards, never written). Acceptance step 7 needs the operator to export the key before the run. | `checkpoint3.json` `skipped` |

Driver defects found and fixed during the run (not app defects): Ctrl+A selected page text instead of rows when the table lacked focus (now ticks the row checkboxes by label); `<option>` waits used visibility (now `state: "attached"`).

App observation recorded for a follow-up (not blocking the checkpoint): the Train form is keyed on the dataset and model lists, so it remounts and drops typed values when either list changes. The driver typed before the lists arrived, so the run trained with the suggested name `v1-yolo11m-coco` and the default 50 epochs instead of `cp3-model` / 1 epoch (imgsz and batch, typed after the remount, held). A user editing the form while a training job finishes would lose the edit the same way. Goal-owner fix with a test in the S6 wave.

### Checkpoint 2 (after Wave 1)

Result: PASS (backend half on cdafe95, editor half on de07f6a, 2026-09-18).

#### Backend half

Result: PASS on `main` cdafe95 (2026-09-18) through the real API (`backend/scripts/checkpoint2_backend.py`
against a dev backend on 8765). Evidence: `docs/evidence/checkpoint2/checkpoint2-backend.json`.

| Step | Evidence |
|---|---|
| Import 20 ahmadia frames (copied from `data/raw/ahmadia`): imported 20, duplicates 0, failed 0, one group `0031` | `import` step |
| Label 10 images via the boxes API: labeled_count 10, box_count 20 | `label` step |
| Dataset `v1` by_group -> 8 train / 2 val, `data.yaml` with absolute path and the eight names in order | `dataset` step |
| Import yolo11n (80 COCO class names), train 1 epoch imgsz 640 on the GPU: 21 s, progress event "epoch 1/1 mAP50 0.000", metrics + results_csv/confusion_matrix/pr_curve artifacts registered | `train` step |
| Export ONNX: 10.6 MB file under `models/` | `export onnx` step |

#### Editor half (real Tauri app, real sidecar built from main, driven over CDP)

`frontend/scripts/checkpoint2_editor.mjs`; evidence `docs/evidence/checkpoint2/checkpoint2-editor.json` and screenshots.

| Step | Evidence |
|---|---|
| Attach to the app, read the sidecar URL/token, create a project and import 20 frames through the real API | `attach and read backend info`, `import via api` |
| Open the project from the Projects screen; Data Manager lists the real images (virtualised grid) | `checkpoint2-01-data-manager.png` |
| Enter opens the editor; real frame rendered on the Konva stage; pre-annotate answered 501 (S4 pending) and was tolerated | `checkpoint2-02-editor-open.png` |
| Drag draws a box; `GET .../boxes` shows one person/accepted box | `checkpoint2-03-box-drawn.png` |
| Ctrl+Z deletes it on the server (0 boxes); Ctrl+Y recreates it (1 box) | `checkpoint2-editor.json` |
| Ctrl+Right navigates to the next image; project stats show labeled 1 / boxes 1 | `checkpoint2-04-next-image.png` |
| Window close terminates the sidecar and dev server; ports 1420/9222 free | session check |

### Checkpoint 1 (after Wave 0)

Result: PASS on `main` 389687c (2026-09-17), run by the goal owner on the reference machine.

How: `backend/scripts/build.ps1` froze the S0 backend (PyInstaller one-folder, torch excluded until S6) into
`frontend/src-tauri/binaries/`; `pnpm tauri dev` launched the real app with
`WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=--remote-debugging-port=9222`; `frontend/scripts/checkpoint1.mjs` attached to the
WebView2 over CDP and drove the UI.

| Step | Evidence |
|---|---|
| App boots, Tauri spawns the sidecar with a per-launch token and port, health passes, Projects screen renders | `docs/evidence/checkpoint1/checkpoint1-01-projects.png` |
| Create project from the UI (name, folder, classes) -> navigates to the Data Manager, `project.db` and subfolders exist | `checkpoint1-02-data-manager.png`, `checkpoint1-result.json` |
| Sidecar killed externally -> blocking dialog "Backend process exited (code -1)" with Restart | `checkpoint1-03-sidecar-died.png` |
| Restart respawns a new sidecar (new pid) and the UI recovers | `checkpoint1-04-after-restart.png` |
| Closing the window terminates the sidecar and the dev server (no leftover processes, ports 1420/9222 free) | PowerShell check in the session log |
| Mock server serves the contract (`pnpm mock`, 200 with token, 401 without) | S0 Task 2 verification |

Suites on main 389687c: backend 97 passed + ruff clean; contract `pnpm check` clean; frontend lint, 7 unit tests, build, 1 e2e passed.

Found and fixed during the checkpoint: the WebView2 origin's CORS preflight was answered 405 (Prism had masked it); CORS is now
restricted to `tauri.localhost` and the Vite origin (`Settings.cors_origins`). Cold-start timing is measured against the
installed app in S6 (dev mode includes the cargo build).

## S6 packaging evidence (reference machine, 2026-09-18)

Measured, not estimated. Reference machine: Windows 11 Pro 26200, RTX 5070 Ti, torch 2.14.0+cu130,
ultralytics 8.4.154, PyInstaller 6.22.3, Tauri CLI 2.11.4.

| Step | Command | Result |
|---|---|---|
| Freeze the backend | `backend\scripts\build.ps1` | 127 s; `dist/machinery-backend` 3,457.8 MB in 14,113 files |
| Frozen smoke test | `backend\scripts\smoke_frozen.ps1` | pass in 23.8 s: health 0.57 s, `cuda True NVIDIA GeForce RTX 5070 Ti` 3.8 s, predict, 1-epoch worker train 11.0 s, ONNX export 3.2 s, keyring round trip |
| App binary | `pnpm tauri build` (cargo release) | 65 s; `machinery-app.exe` 11.1 MB |
| Install tree that the installer would write | - | 3,468.9 MB (app 11.1 MB + sidecar exe and `_internal` 3,457.8 MB), well under the 6 GB success criterion |
| NSIS installer | `pnpm tauri build` | **fails**: `makensis` `Internal compiler error #12345: error mmapping file (2057025505, 33554432) is out of range` |
| MSI installer | `pnpm tauri build --bundles msi` | **fails**: `light.exe : error LGHT0001 : Catastrophic failure ... at Microsoft.Tools.WindowsInstallerXml.Cab.Interop.NativeMethods.CreateCabFinish` |
| Installed layout, run from a temp copy without installing | `machinery-app.exe` from the would-be install tree | sidecar spawned, `GET /api/v1/health` 200 with `gpu {available: true, name: NVIDIA GeForce RTX 5070 Ti}`, page served from `http://tauri.localhost/`; closing the window terminated the sidecar |
| **Inno Setup installer** | `pnpm build:installer` | **1,797.3 MB in 387 s** (ISCC alone 361.8 s), built without a WebView2 bootstrapper -> `frontend/src-tauri/target/release/bundle/inno/Machinery Detection_0.1.0_x64-setup.exe` |

Both failures are the same 2 GB wall, reached from two directions: an NSIS installer addresses its
payload with 32-bit offsets, and Tauri's WiX template puts everything in one embedded cabinet
(`<Media Id="1" Cabinet="app.cab" EmbedCab="yes" />`), which the cabinet format caps at 2 GB. The
payload cannot be brought under 2 GB by trimming: `torch/lib` alone is 2.78 GB and its large CUDA
DLLs (`cublasLt` 456 MB, `torch_cuda` 404 MB, `cufft` 272 MB, `cudnn_engines_precompiled` 212 MB,
`cusparse` 144 MB, `cusolver` 121 MB) are imported by name from `torch_cuda.dll`; dropping
`cufft`/`cusolver`/`cusparse` was tried and `torch.cuda.is_available()` went false (the frozen
smoke test caught it). Only about 205 MB is genuinely unreferenced (`cusolverMg`,
`nvrtc64_130_0.alt`, `nvperf_host`).

Resolved by decision 13: the installer is built with Inno Setup 6, which has no 2 GB limit, from
`frontend/installer/machinery-detection.iss` via `pnpm build:installer` (`ISCC.exe` comes from the
`innosetup-compiler` npm package, so nothing is installed system-wide). `bundle.targets` in
`tauri.conf.json` is now empty; the rest of the `bundle` block still drives the exe icon and the
sidecar and resource staging `pnpm tauri dev` needs.

Still open for the goal owner: install from the setup exe, measure cold and warm start, run
checkpoint 4 and the acceptance run on the installed app. The WebView2 bootstrapper is not in the
installer - nothing on this machine had a copy of `MicrosoftEdgeWebview2Setup.exe` (Tauri's
`downloadBootstrapper` mode fetches it at install time, so the cache holds none) and the
redistributable is not committed. The installer's `[Run]` entry and its registry check appear only
when `frontend/installer/MicrosoftEdgeWebview2Setup.exe` exists at build time; Windows 11 ships the
runtime, so the reference machine does not need it.

## S0 status detail

| Task | Owner | State | Commit |
|---|---|---|---|
| 1 skeleton | goal owner | done | c5b5722 |
| 2 contract + mock | goal owner | done, mock verified | 4d71fcd |
| 3 TS client | goal owner | done | 4d71fcd |
| 4 backend shell | goal owner | done | 715e772 (s0-backend) |
| 5 DB + projects | goal owner | done | f74ba9a |
| 6 jobs + events | goal owner | done | ebe00de |
| 7 stubs + conformance | goal owner | done, 85 backend tests | 88c7160 |
| 8 frontend shell | sub-agent | done, fix round 1 in progress | be0b87c (s0-frontend) |
| 9 tauri shell | sub-agent | done in env mode; real sidecar boot unverified | 845e149 |
| 10 dev script + CI | goal owner | done | ba8728c |
| 11 checkpoint 1 | goal owner | pending merge | |
| 12 README | goal owner | pending | |

Contract facts sub-projects must know: every path in `openapi.yaml` carries `/api/v1` (Prism 5 does not route by server base path); the token is accepted as a bearer header or a `token` query parameter; 501 `not_implemented` stubs mark the endpoints S1, S3 and S4 own.

SDD ledger (rulings, deferred minors): `.superpowers/sdd/2026-09-17-s0-contract-and-scaffolding/progress.md` (git-ignored; if lost, the git log is the record).

## Log

### 2026-09-22 — GeoTIFF maps (spec 2026-09-22-geotiff-maps, plan of the same date)

- Import, tiles, detection, labels, scoring and export: 14 build tasks complete on
  `task/geotiff-maps` (HEAD `d0207c8` before this task's own commit); each task passed its own
  spec-and-quality review, most after one or more fix rounds recorded in
  `.superpowers/sdd/2026-09-22-geotiff-maps/progress.md`. Merge to `main` is the controller's step,
  not this task's.
- Gate (this task, on `d0207c8` + Task 15's e2e/docs commit): `pnpm -C contract check` pass (Spectral
  clean, `schema.d.ts` regenerates byte-identical); backend `ruff check`/`ruff format --check` pass;
  backend `pytest` 783 passed, 9 deselected (288s); frontend `lint` pass (0 errors, 1 pre-existing
  `react-hooks/exhaustive-deps` warning in `MapView.tsx` from Task 11, not touched here); frontend
  `test` 598 passed across 138 files; frontend `build` pass (one pre-existing >500kB chunk-size
  advisory, not an error); frontend `e2e` 62 passed, including the new `maps.spec.ts` (also run
  3x in isolation to rule out flake); `cargo test --manifest-path frontend/src-tauri/Cargo.toml` 8
  passed — the frozen sidecar `kestrel-backend-x86_64-pc-windows-msvc.exe` was present in
  `frontend/src-tauri/binaries/`, so this line ran rather than being skipped.
- Frozen sidecar: not rebuilt in this task (no raster/packaging code changed since Task 4's fix
  build). Task 4's figures stand: geo-selftest `geo ok 32633 15.000325 45.000216`; bundle
  3520.6 -> 3610.6 MiB (+90.0 MiB, +325 files) (ADR 2026-09-22 rasterio).
- Real map: **not exercised in this task.** No multi-GB orthomosaic or running desktop instance was
  available in this development session; import, zoom-level tile loading, and screenshots are the
  operator's walkthrough steps 1-2 in `docs/usability/2026-09-22-maps-walkthrough.md`.
  `docs/evidence/maps/` was not populated by this task.
- Detection: not run against a real map or a real model in this task, for the same reason; the e2e
  suite exercises the UI's happy path against fixed Prism-mock fixtures only (a run that is already
  `succeeded` with a fixed count), not a live detector. Seam-duplicate checking is the operator's
  walkthrough step 2.
- GIS check: **no QGIS and no `ogrinfo` exist on this machine.** The `.gpkg` writer is verified only
  at the byte level, by Task 9's own sqlite3 test against the OGC GeoPackage spec (envelope byte
  order, layer geometry, WGS84 GeoJSON ring closure) — no third-party GIS tool has opened the file
  during development. Say this plainly rather than implying it was validated: the walkthrough's
  step 8 ("open the .gpkg in QGIS") is the first real check and stays an explicit, non-skippable
  operator step.
- Deviations from the spec: see the plan's "Deviations" list (display raster, model GSD, run state,
  tile media types, export names, on-demand scoring, mock e2e) plus the seam cut-box filter and
  match geometry in the score response, both added during Task 7's review.
- Deferred minors carried forward from the SDD ledger (summarised; full text in
  `.superpowers/sdd/2026-09-22-geotiff-maps/progress.md`), none blocking:
  - Raster/import (Tasks 4-5): `read_rgb` resamples pixels bilinear but the nodata mask nearest
    (cosmetic at mask edges); untested paths for `nodata=` masking, the 16-bit valid-only percentile
    branch, and a projected CRS with a non-metric linear unit; the generic-exception import-failure
    message is phrased differently on the map row than in the job log for the same failure.
  - Windowing (Task 6): window `sx`/`sy` differ sub-pixel between interior and last-in-row windows
    at non-power-of-two scales (theoretical, not observed); `masked_fraction` returns 1.0 ("skip")
    for an out-of-range lookup; a detection entirely outside its window clamps to a zero-area box
    rather than being dropped, matching the existing per-image tiling path's behaviour.
  - Detect job (Task 7): `_parse_bbox` still accepts `"nan"`/`"inf"` after the pattern was tightened
    (harmless — no rows match); `overlap_px` uses the nominal step for the shifted-back last window
    in a row, which is the safe direction (more visibility, NMS merges).
  - Scoring/labels (Task 8): `seed_labels`' own detection query is unbounded by bbox (seeding is an
    explicit operator action over a zone, not a hot path); the idempotency dedupe is
    O(candidates × existing labels) with no cap, which could drag on a map near `MAX_LABELS`.
  - Export (Task 9): the ftUS regression test asserts width/height but not `area_m2`; no GIS tool
    has opened the `.gpkg` (see GIS check above).
  - Frontend plumbing (Task 10): `@types/proj4` is deprecated-but-inert (tsc uses proj4's own
    types regardless); `scaleBar` has no guard for `resolution <= 0` (unreachable from
    `resolutions()`); `fetchDetections` does not expose the contract's optional `class_id` filter
    (the UI filters client-side instead).
  - Runs/labels UI (Tasks 12-13): the stale-viewport-response race and the undo/redo repeat-guard
    /serialisation and label-vs-detection popover predicate have no automated regression, because
    `runLayer.ts` and the OL interaction callbacks cannot run under jsdom (`MapView` is mocked
    there); each relies on a pattern already audited elsewhere in the codebase. The label/zone
    refetch after each edit is un-batched (one request per edit) but correct. This task's e2e run
    exercises only the happy path for all of these, by design (decided for Task 15).
  - Score/export UI (Task 14): `ExportJobs` now lists results exports and map exports together
    with no grouping between the two kinds; `useResultsExportJobs` covers both kinds and its name
    is stale; the overlay recolouring and the mistake stepper's view-fit have no automated coverage
    (jsdom has no canvas).
- Task 15 (this task): `frontend/e2e/maps.spec.ts` opens a map, sees the first tile requested, reads
  the pixel/native/lat-lon cursor readout, ticks a run and reads its whole-map count from the
  Results table, draws an evaluation zone, opens the Score tab and reads Precision, opens the export
  dialog and starts a GeoJSON+GeoPackage+CSV export of the ticked run. The brief's selectors were
  checked against the shipped UI before use and needed no changes (the checkbox/radio/row labels,
  the Score panel's `aria-label="Precision"` row, and the `Zone ▭` Segmented option all matched
  as drafted). The one real change from the brief: its press-drag-release zone draw
  (`mouse.down`/`move`/`up`) was flaky in this environment's headless Chromium (failed once in
  isolated runs); replaced with the documented click-move-click alternative for OpenLayers'
  `createBox`, which passed 3/3 repeated solo runs and in the full 62-spec suite.
- Walkthrough for the operator: `docs/usability/2026-09-22-maps-walkthrough.md` (9 numbered steps,
  each stating what to see, ending with the plain-TIFF-without-coordinates case).

- 2026-09-22: Windows icon report investigated without a rebuild. All 17 source assets, installed
  PE icons, running-window SMALL/SMALL2 and shell-resolved shortcut already showed the approved bird.
  Set the Start shortcut to an explicit content-specific bird ICO and refreshed Windows references;
  post-change shell extraction verified. App remains open; binary hash matches the setup-agent build.
  Evidence and limits: `docs/evidence/brand/2026-09-22-windows-icon-refresh/`. No app source changed;
  the reported stale bitmap was not reproduced by native reads. Later CI UI fixes remain uninstalled.
- 2026-09-21: Setup agent/catalog desktop rebuilt from `75aa11b` in `task/setup-agent-desktop`.
  Application trees match the prior source gates exactly. Fresh backend freeze passed (204s,
  3,522.9 MiB), CUDA/worker/ONNX smoke passed (23.13s), 8 Rust tests passed, native/Inno build
  passed (427s, 1,853.8 MiB). Installed with exit 0 and matching app/sidecar hashes, no reboot.
  Installed WebView2 checks: 16 passed, including stored GPT/Claude readiness, drawer state/focus,
  all 44 choices/eight families, a real YOLO26 nano download, cached registration and prediction.
  First Projects 3.052s, final verification 1.966s, warm 2.443s. Four native screenshots and
  reproducible checks: `docs/evidence/setup-agent-desktop/`. An initial compact-layout assertion
  measured the entrance animation; diagnosed and fixed in the driver, with no app-source changes.
  Retained installer is under `dist/`; no paid provider calls or full provider acceptance claimed.
- 2026-09-21: Setup agent and the expanded YOLO catalog merged/pushed to main at `89de91b`;
  task worktree and branch removed, shared backend environment intact. Implemented on `task/setup-agent`
  (`4930d3c`..`da2e475`), rebased onto the new Kestrel identity at `ad2f762`. The drawer uses
  stored GPT/Claude credentials for bounded project planning, then creates a project, downloads
  a selected starter, imports images, guides a 24-image first labeling batch and opens review.
  44 compatible detection checkpoints across eight YOLO families are available on demand.
  Real backend integration covers project/import/query/boxes with only paid AI calls replaced.
  Independent final review ready with no blockers after recovery/estimate/task-validation fixes.
  Required gates passed: contract check, Ruff, 666 backend tests (9 marked tests deselected),
  frontend lint, 533 unit tests and production build; full browser suite 59 passed.
  Rust skipped per policy because the fresh worktree has no frozen sidecar. Five refreshed
  screenshots, full walkthrough, scope and limitations: `docs/evidence/setup-agent/README.md`.
  No paid provider calls, all-model training benchmark or replacement installer claimed.
- 2026-09-21: Approved A / Kestrel bird implemented in `89a63a2`: one SVG geometry master for
  the shared sidebar/splash Brand and all 17 native PNG/ICO/ICNS assets. Deterministic generation
  and integrity check added. Contract/Ruff, 620 backend tests, frontend lint/517 tests/build and
  8 Rust tests passed. Fresh CUDA freeze/smoke passed (23.01s); native release/Inno package passed
  (457s, 1,853.8 MiB). Installed with matching app/sidecar hashes, then passed 15 installed checks
  and exact 16px/32px app-versus-installer icon checks. First Projects 3.053s, warm 2.459s.
  Task/final/scoped reviews approved. Evidence, six UI screenshots, four extracted icons and
  reproducible drivers: `docs/evidence/brand/2026-09-21-kestrel-a/`. Saved installer remains in
  `dist/`; installed app reopened. No provider calls or backend behavior changes; full provider
  acceptance and the pre-existing settings layout issue remain separately owed.
- 2026-09-21: Contour rebuilt and installed from `54b5e29` in `task/contour-desktop`, with unchanged
  application trees. Fresh CUDA backend smoke passed (31.84s), 8 Rust tests passed, release build
  and Inno installer passed (1,853.8 MiB), installation exited 0 with both executable hashes matching.
  Installed WebView2 checks passed: project creation, three-photo import, Contour navigation/hover/focus,
  real annotation save/undo/redo, compact layout, jobs/settings navigation and clean shutdown.
  First startup 3.097s; warm 1.948s. Six native screenshots and reproducible driver:
  `docs/evidence/ui/2026-09-21-contour-installed/`. Full cloud-provider acceptance was not rerun.
  Visual follow-up: pre-existing cramped class-name fields in project settings, also present in the
  earlier source capture. Installer retained in `dist/`; installed app opened for the operator.
- 2026-09-17: session 1 started. Read spec, README, reuse files. Toolchain: node 24.11, pnpm 10.24,
  uv 0.11.32 with CPython 3.11.15 available, MSVC 14.29 (VS 2019 Build Tools) and Windows SDK
  10.0.19041 present, WebView2 153 present, Rust missing. Wrote the S0 plan.
- 2026-09-17: contract written and mock verified; backend tasks 4-7 and 10 implemented test-first (85 tests); Rust installed;
  frontend+tauri shell implemented by a sub-agent and reviewed (needs fixes, round 1 running); backend review running.
- 2026-09-18: Wave 1 started. S1 and S3 implementers dispatched in worktrees; S2 plan being written (first attempt stalled, retried).
- 2026-09-18: S3 reviewed (fable), fixed, re-reviewed (opus), merged to main 1224343; 168 backend tests, GPU training + ONNX export verified on main.
- 2026-09-18: S1 reviewed, fixed, re-reviewed, merged cdafe95 (250 backend tests). Checkpoint 2 backend half passed. Shared venv incident recovered (see wave 1 ledger).
- 2026-09-18: S2 reviewed (fable), 3 fix rounds, merged 9ed2fd4; main: 252 backend tests, 109 frontend unit, 27 e2e. Model artifact endpoint added (372d962). S4 plan written; S5 plan in progress; 'Import images' UI gap assigned to S5.
- 2026-09-18: Checkpoint 2 passed in full (editor half on the real app). Wave 2 started: S4 dispatched.
- 2026-09-18: S5 reviewed (fable), 2 fix rounds, merged 04a879f. S4 reviewed (fable), round 1 done, round 2 in progress. Contract: query minLength, query-run resume endpoint, model artifacts endpoint.
- 2026-09-18: S4 fix round 2 re-reviewed (opus) and merged 6635f71; main: 382 backend tests, 4 GPU tests, ruff, contract check clean; frontend 204 unit, 42 e2e. Wave 2 ledger copied to docs. Checkpoint 3 running on the real app (driver frontend/scripts/checkpoint3.mjs).
- 2026-09-18: Checkpoint 3 passed on the real app (cloud step skipped, no key). Wave 3 next: S6 dispatch. Goal-owner follow-ups: JobCancelled relocation (S4 M4), Train form remount on list change.
- 2026-09-18: Goal-owner follow-ups on main: JobCancelled leaf module (e85a363), Train form keeps typed values on list change (024ec6f, with tests), contract Health.gpu optional block (f52267c; client regenerated; contract test green). Wave 3 started: S6 dispatched; ledger `.superpowers/sdd/wave3/ledger.md`. Ruling: the sub-agent builds the installer and dry-runs the acceptance driver on the dev app; install, checkpoint 4 timing and the acceptance run on the installed app stay with the goal owner.
- 2026-09-18: S6 tasks 1, 2, 4 and 5 done on `s6-packaging-acceptance`: full CUDA PyInstaller bundle with a frozen smoke test, packaging hardening (orphan sweep, Arial pre-seed, sidecar log tee, CSP), the acceptance script and its CDP driver (dry-run green on 20 frames), and the README. Task 3 landed after the ruling on decision 13: the installer is built with Inno Setup 6 (1,797.3 MB in 377 s); install, cold start and checkpoint 4 are the goal owner's.
- 2026-09-18: S6 reviewed (fable: tasks 1, 2, 5 approved, task 4 rejected), Task 3 reviewed and round 1 re-reviewed (opus, approved with fixes), round 2 re-reviewed (sonnet, approved). Merged to main. Goal-owner verification at 9f3aa01: ruff clean, 403 backend, 4 gpu, contract check, frontend lint, 209 unit, build, 42 e2e. Next: install, checkpoint 4, acceptance run.
- 2026-09-18: S6 merged 826a3bf; post-merge main: ruff, 403 backend, contract check, frontend lint, 209 unit, build, 42 e2e. Installed the app; checkpoint 4 passed (cold start 1.6 s, first launch 3.0 s). Acceptance run started on the installed app.
- 2026-09-18: Acceptance run passed from the installed app (7 steps; step 7 skipped for lack of a key). Uninstall verified and reinstalled. S6 worktree removed. Wave 3 ledger copied to docs. Remaining: acceptance step 7 with an operator-provided Anthropic key; deferred minors listed in the wave ledgers.
- 2026-09-18: Shared venv deleted with the S6 worktree (junction) and rebuilt from the lock file; rule recorded. Polish: training progress message now carries loss terms and ETA (spec 7), Train screen shows Loss and ETA. Verified on main: ruff, 406 backend, 4 gpu, frontend lint, 211 unit, build, 42 e2e.
- 2026-09-18: Polish: imports into one project run one at a time (6eeec68, Wave 1 deferred). Installer rebuilt from main (needs `%USERPROFILE%\.cargo\bin` on PATH and `pnpm install` for the Inno compiler package; README updated), reinstalled, checkpoint 4 re-passed. The installed app now matches main.
- 2026-09-19: Usability wave 1 finished and merged to main (88d9216). Installer rebuilt from main (1,853.2 MB), installed over the owner's desktop app; checkpoint 4 PASS, acceptance 7 passed / 1 skipped (step 7, no key), walk-through 12/12 on the installed app. The installed app now matches main.
- 2026-09-19: U2 site office UI on `ui-site-office`: tokens and bundled Instrument Sans, the `src/ui` component set, pipeline sidebar with step states, project Home, Label resolver, every screen restyled (six screens by sub-agents in worktrees, merged), plain wording (Images, Label, Detect, suggestions, accept as labels). Frontend lint (with the raw-palette check), 410 unit, build and 52 e2e green on the mock; the walk-through driver passed all 10 steps (59 checks) against the real backend in a browser (evidence `docs/evidence/ui/2026-09-19-site-office/walkthrough/`). Not merged to main: waits for the usability wave, then a rebase.
- 2026-09-20: U2 merged into main after the usability wave landed there: `wave1-s2-trial` merged into `ui-site-office` (15 conflicts; the wave's review fixes kept, its Export screen restyled, Export added as the seventh pipeline step), then main fast-forwarded to 2bc15a4. Verified: lint, 462 unit, build, 53 e2e on the mock, walk-through 12 steps / 66 checks on the real backend. Installer rebuilt from main with the wave's frozen backend and installed over the owner's app; the installed app now matches main. Evidence: `docs/evidence/ui/2026-09-19-site-office/`.
- 2026-09-20: Acceptance step 7 (H2) closed on the installed app (main 177f68b, site office UI): the owner stored Anthropic and OpenAI keys in App settings, the run passed 8/8 (step 7: tiling 1280 px, box with anthropic provenance, stored key used and never rewritten), both keys pass the live provider test. The acceptance driver needed three fixes for the redesigned UI (post-create route is now the project Home screen, the dataset dialog stays open on its result and has to be closed, accepting ~51k boxes needs a wait on the card instead of a fixed pause) plus an exact `Projects` heading match in checkpoint 1/2/4.
- 2026-09-22: Acceptance re-run on the renamed installed Kestrel AI build (main `8823d95`, installer 1,853.3 MB): **8 passed, 0 skipped**; step 7 Anthropic with tiling on the stored key, step 6 at `--conf 0.001`. Replaces the stale 8/8 at `177f68b`; closes rename plan Task 11 Steps 5-6. Also on this build: G3 report labels confirmed in the frozen bundle. On the way the driver's window was used by the operator and step 3 wrote into their project (repaired with consent; driver now guards, `22e0c30`). Evidence `docs/evidence/acceptance/2026-09-22-installed-8823d95/`; ADR `2026-09-22-gotcha-acceptance-window-looks-like-the-operators-app`.
- 2026-09-23: **Survey timeline** on `task/survey-timeline`: counts over time across a project's maps. A map now carries `captured_on` (read from `TIFFTAG_DATETIME`, correctable by `PATCH /maps/{id}`), `GET /survey-timeline` returns each survey's counts with the change since the previous **comparable** one, and a Surveys screen draws the chart and table. A survey counted with another model or confidence is marked and excluded from deltas. Found and fixed on the way: `source.json` could not serialise the new date, which failed every map import. Superseded `2026-09-23-object-counts-per-group-design.md` (frame projection measured at 10-17 m spread; the maps path already counts exactly). Evidence: `docs/evidence/surveys/`.
