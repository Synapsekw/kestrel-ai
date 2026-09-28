# Maps (M) unit X evidence

Spec `docs/superpowers/specs/2026-09-26-map-workspace-design.md`; plans
`docs/superpowers/plans/2026-09-27-maps-*.md`. Measured on `task/m-x` at f39485d (parent `main`
7f28374 with every M unit merged: C0, B1–B5, W1–W6), 2026-09-28. The full gate runs once more after the
final review (Task 16b); its lines below read "(pending final gate)" until then.

## Flows (spec §15, Playwright)

"Task run" is the spec's own run in its task (ports 5580/5581, Prism mock plus the stateful workspace
fake `frontend/e2e/fixtures/mapWorkspace.ts`); "gate" is the full `pnpm -C frontend e2e`.

| #    | Flow                                                                        | Spec file                                   | Result                                                                                                                                       |
| ---- | --------------------------------------------------------------------------- | ------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| 1    | Two orthos aligned → Swipe, drag → Side-by-side, mirrored crosshair → Blend | `frontend/e2e/maps.spec.ts` "flow 1"        | task run: 7 passed (2 runs); gate: (pending final gate)                                                                                      |
| 2    | DXF by CRS, PDF by 3 control points, RMSE, save, overlay                    | `maps-drawings.spec.ts`                     | task run: 2 passed (3 clean runs); gate: (pending final gate)                                                                                |
| 3    | Distance, area, profile → Measurements union                                | `maps-measure.spec.ts` "flow 3"             | task run: 2 passed (2 runs, and 6 with `--repeat-each=3`); gate: (pending final gate)                                                        |
| 4    | Volume, base cards, numbers after the job, heatmap                          | `maps-volume.spec.ts`                       | task run: 1 passed (3 runs); gate: (pending final gate)                                                                                      |
| 5    | Pending defect → A → finding pin, F's inspector                             | `maps-review.spec.ts`                       | task run: 2 passed with `detect-review` (2 runs); gate: (pending final gate)                                                                 |
| 6    | Zone tool → site area with a category                                       | `maps-measure.spec.ts` "flow 6"             | task run: with flow 3 above; gate: (pending final gate)                                                                                      |
| 7    | Frame time in Swipe, 4 layers                                               | `maps-frame-time.spec.ts`                   | see below                                                                                                                                    |
| real | Real backend: two orthos in one frame, Swipe, server distance               | `maps-real-backend.spec.ts` (opt-in config) | 1 passed (11.1 s, web 5582 / API 5583); server `length_m` 50.020 m, grid 50.0 m, scale factor 0.9996; skipped in the gate config (1 skipped) |

Also rewritten onto the workspace: `detect-review.spec.ts` (review keys A / X / Tab), the map steps of
`clouds.spec.ts` (19 passed with `shell.spec.ts`, 2 runs, after the footprint fix), and the map test of
`shell.spec.ts` (repointed at `/maps/:mapId/evaluate`); the evaluation view keeps the old viewer's
label/zone/score/export test in `maps.spec.ts`.

What the flows prove beyond the brief's list:

- flow 1 file: the Z readout reads `Z 612.34 m` with a `POST /map-workspace/sample` (after M-X's
  ReadoutZ fix); at 1280 px the coordinates row with the frame switch and a live Z does not overflow;
  the retired `/p/P/maps/:mapId` address settles in the workspace; a map without coordinates links to
  `/maps/:mapId/evaluate`.
- flow 2: the row menu's **Align** starts the align session at once (M-X fix `32566a8`); DXF linework
  selects by a click on a line; the saved placement re-tiles on the new layer version (`v=1`, no `t=`).
- flow 5: `?map=…&sel=run:…` opens with the run selected (R-P1 fix); the accept sends exactly one
  decision and the inspector moves to the created finding.
- clouds: a detection's **Open in 3D** carries its footprint (`&fp=…`) and the cloud view draws it (M-X
  fix `63f3a25`); **Show on map** lands with the picked spot within 5 px of the map centre (R-P4).

## Frame time (spec §13, flow 7)

Spec `frontend/e2e/maps-frame-time.spec.ts`, sampler `frontend/e2e/frameTime.ts` (the same rules as
`effects.spec.ts`: 300 ms warm-up, 2 s of `requestAnimationFrame`, gaps over 500 ms dropped, p95 the
sorted sample at `ceil(n × 0.95) − 1`). Swipe mode with 4 visible layers: the two orthos, the DSM
hillshade (its row switched on first, R-DSM, and a `surface/` tile fetched before sampling) and the site
plan. Three evidence runs back to back on 2026-09-28 with `E2E_CAPTURE_EVIDENCE=1 E2E_FRAME_BUDGET=1`,
ports 5580/5581; raw numbers in `frame-time.json` next to this file.

| Surface        | What moves                             | Run 1 p50 / p95 / max | Run 2              | Run 3              | Frames | Verdict     |
| -------------- | -------------------------------------- | --------------------- | ------------------ | ------------------ | ------ | ----------- |
| swipe-pan-zoom | drag-pan and wheel zoom continuously   | 16.7 / 16.7 / 150     | 16.7 / 16.8 / 150  | 16.7 / 16.8 / 150  | 113    | pass (≤ 20) |
| swipe-divider  | the swipe divider dragged side to side | 16.7 / 16.7 / 16.8    | 16.7 / 16.7 / 16.8 | 16.7 / 16.7 / 16.8 | 121    | pass (≤ 20) |

Values in ms. Every p95 is at or below 20 ms. The runs are vsync-locked at 60 Hz, so 16.7 ms is the frame
interval: the probe counts dropped frames, not headroom inside a frame.

**One repeatable 150 ms frame per pan-zoom run** (3 of 3, same value): below 1 % of 113 samples, so p95 is
unaffected. Probably the first wheel zoom crossing a zoom level (new tiles for both orthos, the hillshade
and the drawing at once) or the switch to the Pan tool; not investigated, and the test was not tuned. The
divider drag has no hitch.

**Environment.** `HeadlessChrome/153.0.8010.12`, Windows 10/11 x64, viewport 1280×720 at DPR 1,
`hardwareConcurrency` 24. WebGL renderer `ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (Subzero)
(0x0000C0DE)), SwiftShader driver)`: the software path, not the operator's GPU and not WebView2.

**Machine load.** CPU 10–12 % over 3 samples before the runs (long-running desktop apps: cam_helper,
CurseForge, NZXT CAM, RazerAppEngine, Battle.net, ChatGPT; only idle Playwright MCP servers, no suite
running), 5.5 % after.

The gate asserts only a real sample (≥ 60 frames per surface); the ≤ 20 ms budget is asserted under
`E2E_FRAME_BUDGET=1` (Ruling X10).

## Acceptance (spec §15)

Mode: **synthetic stand-ins** (`acceptance-raw.json` `mode: "synthetic"`; no `KESTREL_MAPS_ACCEPT_DIR`
was supplied, Ruling X7). Driver `backend/scripts/maps_acceptance.py` over HTTP against a real backend
(`python -m app`, port 5583, throwaway app-data), data from `backend/scripts/make_maps_acceptance_data.py`.
Final line: `{"imports": true, "frame": true, "layers": true, "dxf": true, "pdf": true, "measurements": true,
"volumes": true, "dsm_crosscheck": null, "union": true}`; `http_5xx: []`.

| Item                    | Measured                                                                                                                                | Target                     | Verdict                              |
| ----------------------- | --------------------------------------------------------------------------------------------------------------------------------------- | -------------------------- | ------------------------------------ |
| Imports                 | 2 maps and 3 surfaces as jobs, 5.8 s, all succeeded                                                                                     | every file registered      | pass                                 |
| Frame                   | EPSG 32633 "WGS 84 / UTM zone 33N", `frame_items` crs 5 / local 0; all 5 layers `in_frame`                                              | the first map's CRS        | pass                                 |
| DXF offset              | max 0.0052 m over 6 check points (0, 0, 0, 0, 0, 0.0052; the circle's east point, chord approximation)                                  | ≤ 0.1 m                    | pass                                 |
| PDF by 4 points         | RMSE 9.3e-10 m, residuals 4 × 9.3e-10 m, similarity, no warnings, `georef_version` 1                                                    | reported                   | pass                                 |
| Stockpile × 4 bases     | lowest 4271.016 / plane 3351.033 / design 3351.033 / earlier 837.758 m³ (analytic cone 3351.032 m³; earlier survey expected 837.758 m³) | server-computed, S2 engine | pass (plane +0.000 % vs cone, ≤ 2 %) |
| DSM import vs cloud DSM | not measured: needs operator data (`dsm_crosscheck: null`)                                                                              | median \|dz\| ≤ 0.02 m     | operator step                        |
| Measurements            | distance grid 60.000 m (true 60.024, 3D 63.085); area grid 200.000 m² (true 200.160); profile 2 series                                  | the figure's own geometry  | pass                                 |
| Measurements union      | 7 items: kinds map/area, map/distance, map/profile, volume/volume                                                                       | map + volume listed        | pass                                 |

The lowest-point base is 27.45 % above the cone by design: a flat base at the lowest toe also counts the
tilted-ground wedge. Cut is ≤ 0.01 m³ and the area 2500 m² for every base. The design-DTM card uses an
imported bare-ground DTM as the stand-in design (X7). The operator-only checks (DSM vs cloud, a real DXF
against visible features, a scanned PDF) are in the walkthrough.

`acceptance-raw.json` was searched for `Users`, `Temp`, `maps-accept`, `PROJCRS`, `GEOGCRS` and `:\`: no
matches (no path, token or WKT).

## Success criteria (spec §16) → evidence

Backend test files are named per the unit that added them (`git diff --name-only <merge>^1 <merge> --
backend/tests` for each M-B merge).

| #   | Criterion                                                                     | Evidence                                                                                                                                                                                                                                                                                                                                                                                                                   |
| --- | ----------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Every georeferenced ortho, DEM and drawing renders aligned in one frame       | flow 1 (shared site-tile grid), real flow (two extents), acceptance "Frame"/"DXF offset"; B1 pytest `test_workspace_frame.py`, `test_workspace_frame_site.py`, `test_workspace_grid.py`, `test_workspace_layers.py`, `test_workspace_tiles.py`, `test_workspace_tile_routes.py`, `test_workspace_views.py`, `test_workspace_state.py`                                                                                      |
| 2   | Four compare modes, synced side-by-side, mirrored crosshair                   | flow 1; W2 vitest `mapws/compare/swipeClip.test.ts`, `CompareStage.test.tsx`, `CompareBar.test.tsx`, `coverage.test.ts`, `mapws/state/workspaceStore.test.ts`                                                                                                                                                                                                                                                              |
| 3   | DSM/DTM GeoTIFF imports without preview; volume top/base; profile surface     | acceptance imports, volumes (DEM top and bases), profile; B2 pytest `test_elevation_import.py`, `test_elevation_job.py`, `test_elevation_admission.py`, `test_elevation_consumers.py`, `test_surfaces_dates.py`                                                                                                                                                                                                            |
| 4   | DXF, PDF page, PNG and LandXML place by CRS or 2–12 points with RMSE          | flow 2; acceptance DXF/PDF; B3 pytest `test_drawings_dxf.py`, `test_drawings_pdf.py`, `test_drawings_landxml.py`, `test_drawings_raster_source.py`, `test_drawings_raster_build.py`, `test_drawings_georef.py`, `test_drawings_georef_api.py`, `test_drawings_api_inspect.py`, `test_drawings_vtiles.py`                                                                                                                   |
| 5   | Distance, area, profile server-computed, stored, listed with cloud and volume | flow 3; real flow (server distance 50.020 m); acceptance measurements + union; B4 pytest `test_mapmeasure_api.py`, `test_mapmeasure_service.py`, `test_mapmeasure_geodesy.py`, `test_mapmeasure_profile.py`, `test_mapmeasure_frames.py`, `test_measurements_union.py`, `test_measurements_providers.py`                                                                                                                   |
| 6   | Volume against the four bases on the unchanged S2 engine                      | flow 4; acceptance volumes; B5 pytest `toe_lowest` in `test_volumes_bases.py`, `test_volumes_engine.py`, `test_volumes_workspace.py`, `test_volumes_writers.py`                                                                                                                                                                                                                                                            |
| 7   | Findings as point/polygon; accepted defect → finding with map-CRS anchor      | flow 5; W3 vitest `mapws/findings/FindingOverlay.test.tsx`, `actions.test.ts`, `FindingMeasure.test.tsx`, `mapws/annotations/plugins.test.ts`; B5 pytest `test_map_findings.py` (`test_the_finding_is_in_the_review_transaction`, `test_accepting_a_defect_creates_one_reviewed_finding_on_the_map`)                                                                                                                       |
| 8   | A region run never changes a survey count                                     | B5 pytest `test_maps_timeline.py::test_a_region_run_is_never_the_basis_nor_a_surveys_run`, `test_detect_analytics.py::test_a_region_run_never_speaks_for_a_map`, `test_site_areas.py::test_the_area_recount_skips_region_runs`, `test_maps_detect.py::test_a_region_run_never_counts_site_areas`                                                                                                                           |
| 9   | No request grows with data size; imports are jobs; UI never blocks            | Budget greps below; §13 bounded-read tests: B1 `test_workspace_tile_routes.py::test_one_read_per_surface_tile_within_258`; B3 `test_drawings_pdf.py::test_peak_python_memory_stays_under_the_strip_bound`, `test_drawings_vtiles.py::test_the_vertex_cap_drops_the_shortest_first`; B4 `test_measurements_union.py::test_a_page_is_one_bounded_statement_per_provider`, `test_mapmeasure_service.py::test_the_project_cap` |
| 10  | Mockup layout, shortcuts (P for Play), motion; check-tokens passes            | W1 vitest `mapws/tools/keymap.test.ts` ("plays on P … and F's table has no collision"), `pnpm -C frontend lint` (pending final gate); flows' screenshots under `evidencePath("maps", …)`                                                                                                                                                                                                                                   |

## Budget

Run on `task/m-x` at f39485d, 2026-09-28, from the worktree root (PowerShell, the plan's commands).

**Grep 1: whole-raster reads in M's backend files.** 174 `.py` files under `backend/app` changed since
4ebcac1; `\.read\(\s*\)` hits once:

```
backend\app\workspace\tiles.py:217: arr = vrt.read()
```

Bounded: `_read_vrt` is called only from `_warp_read`, inside `with WarpedVRT(ds, …) as vrt` whose `width`
and `height` are `grid.TILE + 2 * src.halo` (256, or 258 with the DSM's 1-pixel halo), at the overview level
chosen for the tile's zoom. The read is at most 258 × 258 × bands. Guarded by
`test_one_read_per_surface_tile_within_258`. **Verdict: holds.**

**Grep 2: both import job types are registered.** The plan's paths (`backend\app\jobs\*.py`,
`backend\app\db\models.py`) return no hit: job types register by decorator in their own modules, not in a
central table or a model enum. The same pattern over `backend/app`:

```
backend/app/drawings/jobs.py:26:@register_job_type("drawing_import", on_cancelled_before_start=_cancelled_before_start)
backend/app/surfaces/jobs_elevation.py:154:@register_job_type("elevation_import", on_cancelled_before_start=cancelled_before_start)
backend/app/drawings/router.py:23:from app.drawings import jobs as _jobs  # noqa: F401 - registers `drawing_import`
backend/app/surfaces/router.py:20:from app.surfaces.jobs_elevation import run_elevation_import  # noqa: F401 - registers elevation_import
```

Both routers submit through `request.app.state.jobs.submit(...)` (`drawings/router.py:64`, `:156`;
`surfaces/router.py:64`). **Verdict: holds** (both imports are background jobs).

**Grep 3: every workspace read of findings and detections passes a `bbox`.** The plan's pattern over
`frontend\src\mapws` hits only imports, tests and a doc comment (the URLs live in `frontend/src/api/`):

```
frontend\src\mapws\detect\DetectionMount.tsx:41: import { lookStyle, tagText, type LookStyle } from "./detectionStyle";
frontend\src\mapws\detect\detectionStyle.test.ts:3: import { lookStyle, tagText } from "./detectionStyle";
frontend\src\mapws\detect\plugins.test.ts:6: import detectionsLayer from "../layers/detections.layer";
frontend\src\mapws\findings\useFindingsInView.test.tsx:60: requests.filter((r) => r.url.includes("/map-workspace/findings"));
frontend\src\mapws\findings\useFindingsInView.ts:16: * The Findings layer's read (spec §13, W3-13): one `GET /map-workspace/findings` per settled view
```

Followed to the client calls:

| Client call                                                    | Caller in `mapws/`                                         | `bbox`                                                 |
| -------------------------------------------------------------- | ---------------------------------------------------------- | ------------------------------------------------------ |
| `api/mapFindings.ts` `listMapFindingsInView` (`bbox` required) | `findings/useFindingsInView.ts:60`                         | the settled view extent, `frame: "site"`; ≤ 5 000 pins |
| `api/mapDetect.ts` `fetchSiteDetections` (`bbox` required)     | `detect/DetectionMount.tsx:135`                            | `siteBbox(extent)`, `frame: "site"`                    |
| `api/maps.ts` `fetchDetections` (`bbox` nullable)              | none in `mapws/`; only `screens/MapEvaluateScreen.tsx:357` | the evaluation viewer's own loader (pre-M, unchanged)  |

`useReview.ts` imports only the review helpers: `nextUnreviewedSite` reads one next detection after
`after_id`, and `reviewDetections` posts decisions (at most `REVIEW_CHUNK` = 1000 ids per request). No list
read. **Verdict: holds** for the workspace.

## Gate

(pending final gate) — Task 16b runs the full gate once after the final review and fills these lines:

- `pnpm -C contract check`: (pending final gate)
- `ruff check .` / `ruff format --check .`: (pending final gate)
- `pytest`: (pending final gate)
- `pnpm -C frontend lint`: (pending final gate)
- `pnpm -C frontend test`: (pending final gate)
- `pnpm -C frontend build`: (pending final gate)
- `pnpm -C frontend e2e`: (pending final gate)
- `cargo test`: (pending final gate)

## Product fixes M-X made

Defects the flows found in earlier M units, fixed in M-X with a test each:

- `a2375a4` the Z readout keeps a live sampler through StrictMode's remount (W2: Z stayed "—" in dev).
- `32566a8` the row menu's **Align** starts a live align session under StrictMode (W5).
- `63f3a25` a detection's **Open in 3D** carries its footprint again, so the cloud view draws it (W1/W4).
- `4ddd26f`, `55c46ac` a `map=` arrival keeps the link's `sel` and arms its `tool`; a failed arrival
  applies neither (R-P1).
- `fc26336` the minimap recentres instantly (`centreOn(…, { instant: true })`).
- `5597865`, `5fc88bb` **Import drawing** (Add a layer, and the Drawings group's **+ Import**) opens Add data
  on the drawing import (R-P5.3).
- `c099097` a capped drawing name keeps its page suffix; `5e63a6a` Escape closes the expanded profile
  sheet; `2953913` a failed detection run shows its job's error; `dc62bda` the evaluation route gives each
  map a fresh screen.

Deferred minors (ledger `m-x.md`): a double-click finishes a line or polygon draft even when the two clicks
land far apart (OpenLayers' 250 ms `dblclick`); the workspace fake does not publish `volumes.changed` after a
volume job (flow 4 sends it itself); non-PDF drawings map to a DXF inspection in the fake; `frameTime.ts`
duplicates `effects.spec.ts`'s inline sampler (R-X5); the real-backend config defaults to the dev machine's
interpreter path (overridable); CloudWorkspace and AnchorSlot duplicate the map-jump URL line, and the
AnchorSlot "Show on map" URL has no test; `detect-review` no longer checks the class name (covered by the
inspector's type chip), and the T reclass key has no e2e.

## Rulings made while building M-X

From the plan:

- **X1:** `MapEvaluateScreen` keeps the Results tab only for maps without a CRS (they would otherwise lose
  their counts).
- **X2:** the `maps/:mapId` redirect translates `mode=review&run=` → `sel=run:` and `draw=site-area` →
  `tool=zone`, and keeps every other parameter.
- **X3:** "Draw an area" links `maps?map=<picked>&tool=zone`, not the spec's bare `maps?tool=zone`.
- **X4:** `dataHref`: elevation → `maps?sel=surface:<id>`, drawing → `maps?sel=drawing:<id>`, map →
  `maps?map=<id>`.
- **X5:** the frame-time sampler is a new helper, `e2e/frameTime.ts`; `effects.spec.ts` keeps its inline
  copy.
- **X6:** the real-backend flow is an opt-in spec with its own config (`playwright.real-backend.config.ts`),
  skipped in the gate.
- **X7:** acceptance runs on the operator's data when supplied (`KESTREL_MAPS_ACCEPT_DIR`), otherwise on
  synthetic stand-ins; in synthetic mode the DSM-vs-cloud, real-DXF and scanned-PDF checks move to the
  walkthrough; the design-DTM card uses an imported bare-ground DTM.
- **X8:** the evaluation screen drops the map rail, Import, review mode, the detection popover, the
  right-click 3D jump, the `?at=` marker and the site-area overlay (now in the workspace or Add data).
- **X9:** a module is deleted only if a grep shows it unreferenced. (Its reuse claim for `useAtMarker` is
  void under R-P4.)
- **X10:** the frame budget (p95 ≤ 20 ms) is asserted only under `E2E_FRAME_BUDGET=1`, in three quiet
  evidence runs; the gate asserts a real sample.
- **X11:** e2e fixture bodies follow spec §12's field names, corrected by Task 1's contract field map.
- **X12:** W1's stage menu "Open this spot in 3D", W4's detection "Open in 3D", and the diagnostics hook
  `window.__kestrelSiteMap`; W1's tool ids and selection kinds are canonical.
- **X13:** the volume view is `/p/:projectId/measurements/volumes[/:id]`; site-tile URLs carry `frame_key=`;
  the fixture matches on the pathname only.

Added by the controller (`.superpowers/sdd/2026-09-27-maps-x/rulings.md` and the ledger):

- **R-P1:** after a `map=` arrival settles, `sel` applies (when the arrival selected nothing) and `tool`
  arms (if registered); `tool=` is stripped from the settled URL, as for a tool-only arrival.
- **R-P2:** `evaluateHref` points at `/p/:projectId/maps/:mapId/evaluate`.
- **R-P3:** the fixture applies the contract field map and adds `GET /jobs/:id`, the events websocket
  and `POST /drawings/georef-fit`, plus a `site` option for other frames.
- **R-P4:** the workspace has no `at` marker; a 3D → map jump is asserted by centring (the picked spot
  within ~5 px of the map centre).
- **R-P5 / R-P5.3:** the selector map (swipe slider, Length/Area regions, the drawing-import steps, row
  menu Align, zones via the inspector); Import drawing opens the Drawing tile.
- **R-DSM:** surface rows stay hidden by default; flows switch the DSM row on.
- **R-URL:** e2e asserts settled URLs plus visible state; exact redirect targets are pinned in
  `routes.test.tsx`.
- **R-T4 / R-T5 / R-T11 / R-T12 / R-T14 / R-T15:** where "Show on map" is edited; the sweep list; the
  review start by Tab; the shell test repointed at `/evaluate`; the real-backend config in
  `tsconfig.node.json`; the acceptance field map with the Sep DSM as the cross-check `dem`.
- **R-X5:** `frameTime.ts` duplicates `effects.spec.ts`'s sampler (Foundation's file; moving it deferred).
- **R-HX:** Task 17 hand-off fixes (instant minimap `centreOn`, Import drawing tile, cheap minors); the
  coordinates row checked at 1280 px; DXF click-to-select tried (it works).
- Ledger: the ReadoutZ, row-menu Align and footprint defects are fixed in M-X rather than pinned;
  `drawSite` in the shared fixture paces clicks past OpenLayers' double-click window; Task 16 is split
  into 16a (this evidence) and 16b (the full gate once, after the final review).
