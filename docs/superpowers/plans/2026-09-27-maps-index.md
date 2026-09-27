# Maps (sub-project M): execution index

> **For agentic workers:** this is the coordinator's map of the thirteen Maps unit plans. Each unit is
> executed with superpowers:subagent-driven-development in its own worktree. Read the unit plan you
> were given, this index, the spec and the programme rulings. Do not execute this index itself.

**Spec:** `docs/superpowers/specs/2026-09-26-map-workspace-design.md` (umbrella:
`2026-09-26-inspection-platform-design.md`; Foundation: `2026-09-26-foundation-design.md`, as built on
`main` `4ebcac1`, with `docs/evidence/foundation/rulings.md`).
**Binding rulings:** `.superpowers/sdd/imc-common/programme-rulings.md` (R1–R10). They win over the spec.

**Goal:** land the map workspace on `main`. It covers:

- one site frame for every ortho, elevation model and drawing;
- the four compare modes and the timeline;
- DSM/DTM import;
- drawings (DXF, LandXML, PDF, raster) placed by CRS or control points;
- server-computed distance, area and profile measurements;
- the volume tool;
- detections, findings and zones on the map;
- the `GET /measurements` union and the project Measurements tab (R8).

## Unit plans

| Unit                                                                                           | Plan                    | Worktree / branch    | Tasks | Cut after                               |
| ---------------------------------------------------------------------------------------------- | ----------------------- | -------------------- | ----- | --------------------------------------- |
| M-C0 contract, migration `0012`, stubs                                                         | `2026-09-27-maps-c0.md` | `m-c0` / `task/m-c0` | 9     | Foundation (`main` now)                 |
| M-B1 site frame, grid, site tiles, workspace endpoints, `frame=site`, sample                   | `2026-09-27-maps-b1.md` | `m-b1` / `task/m-b1` | 10    | I-C0, M-C0, C-C0                        |
| M-B2 `elevation_import`, `POST /elevations`, `Surface` columns                                 | `2026-09-27-maps-b2.md` | `m-b2` / `task/m-b2` | 7     | I-C0, M-C0, C-C0                        |
| M-B3 drawings: inspect/build job, DXF/LandXML/PDF/raster, georef, vtiles                       | `2026-09-27-maps-b3.md` | `m-b3` / `task/m-b3` | 18    | I-C0, M-C0, C-C0                        |
| M-B4 map measurements, Geod, profile, `GET /measurements` union                                | `2026-09-27-maps-b4.md` | `m-b4` / `task/m-b4` | 8     | I-C0, M-C0, C-C0                        |
| M-B5 `toe_lowest`, material, `polygon_site`, region runs, defect → finding, zone category      | `2026-09-27-maps-b5.md` | `m-b5` / `task/m-b5` | 8     | I-C0, M-C0, C-C0                        |
| M-W1 workspace shell, registries, `siteGrid.ts`, arrivals                                      | `2026-09-27-maps-w1.md` | `m-w1` / `task/m-w1` | 15    | I-C0, M-C0, C-C0                        |
| M-W2 base map and elevation layers, compare modes, timeline, minimap, readout Z                | `2026-09-27-maps-w2.md` | `m-w2` / `task/m-w2` | 12    | W1, B1 (and B2 for the date/role PATCH) |
| M-W3 distance/area/profile tools, `ProfileChart`, zone tool, finding tools                     | `2026-09-27-maps-w3.md` | `m-w3` / `task/m-w3` | 13    | W1, B1, B4, B5                          |
| M-W4 volume tool, detection layer and review, AI region                                        | `2026-09-27-maps-w4.md` | `m-w4` / `task/m-w4` | 17    | W1, B1, B5                              |
| M-W5 drawing import dialog, drawing layers, align tool, DSM/DTM mode                           | `2026-09-27-maps-w5.md` | `m-w5` / `task/m-w5` | 14    | W1, B2, B3                              |
| M-W6 project Measurements tab (R8)                                                             | `2026-09-27-maps-w6.md` | `m-w6` / `task/m-w6` | 5     | W1, B4                                  |
| M-X evidence: MapEvaluateScreen, redirects, e2e flows, frame scenario, acceptance, walkthrough | `2026-09-27-maps-x.md`  | `m-x` / `task/m-x`   | 16    | every M unit above                      |

## Execution DAG, batches and merge order

Units in the same batch build concurrently. Merges into `main` are serialized by the coordinator
(R5), one unit at a time across all three sub-projects, each rebased on the new `main` and re-gated.

1. **M-C0 alone.** It merges after I-C0 and before C-C0 (R3). Its Task 9 rebases on I-C0, sets
   `down_revision = "0011"` and regenerates `schema.d.ts`. The coordinator re-checks `alembic heads`
   on `main` first (R4).
2. **B1 ∥ B2 ∥ B3 ∥ B4 ∥ B5 ∥ W1.** These are cut after I-C0, M-C0 and C-C0 are all on `main`.
   Merge order:
   1. **B1** (the others' frame helpers delegate to it; B3's T16 registers on it)
   2. B2
   3. B4
   4. B5
   5. B3, which may merge its raster-only half first, see its slicing
   6. W1, which may merge at any point in the batch

   B4 and B5 are held until B1 is on `main` (their pre-gate step swaps their local pyproj helper onto
   `app.workspace.frame`). The last of B1–B4 to merge deletes `app/workspace/stubs.py` (M-C0 hand-off
   table).

3. **W2 ∥ W3 ∥ W4 ∥ W5 ∥ W6.** Each is cut when its "Cut after" units are on `main`. They merge in the
   order they are ready. W6 is the smallest and is expected first. W5 is last (critical path).
4. **M-X.**

**Critical path:** C0 → B3 (18 tasks: three formats, the index, georef) → W5 → X.
**Near-critical:** C0 → W1 → W2 (the compare modes and the frame scenario) → X.
If B3 slips, B3's raster half (T0–T8, T14, T15, T17) merges first and W5's Slice A (T1–T11,
raster/PDF plus control points plus the DSM/DTM mode) merges on it. The vector halves follow.

## Budget (spec §13; every unit plan restates its share)

- **Background jobs:**
  - `elevation_import` (B2);
  - `drawing_import`, phases `inspect` and `build` (B3);
  - existing jobs: `volume_calc`, `volume_export`, `map_detect` incl. region runs (B5), `area_recount`,
    `surface_build`.

  Nothing else is a job. Every import answers 202 with a job.

- **Bounded reads:**

  | Read                                      | Bound                                                                               |
  | ----------------------------------------- | ----------------------------------------------------------------------------------- |
  | Site tile                                 | one warped read ≤ 258² from one overview, LRU 1024 (B1)                             |
  | Vector tile                               | ≤ 20 000 vertices with `truncated` (B3)                                             |
  | Detections, findings or zones in view     | ≤ 5 000 per response                                                                |
  | Profile                                   | ≤ 2 000 stations × ≤ 3 surfaces (B4)                                                |
  | Measurement vertices                      | ≤ 5 000                                                                             |
  | Georef                                    | ≤ 12 pairs                                                                          |
  | Sample                                    | 2×2 cells per surface, ≤ 8 surfaces, client throttle 150 ms (W2)                    |
  | Workspace state                           | ≤ 64 KB                                                                             |
  | `listMeasurements`, `listMapMeasurements` | keyset pages, `limit` ≤ 1000 (W6 reads pages of 200; a live refresh re-reads ≤ 500) |
  | Surveys, layers, drawings                 | one row per item                                                                    |

- **Memory:**
  - PDF strips ≈ 80 MB peak (B3; tracemalloc test);
  - DXF under S3's RAM admission;
  - rasters are never decoded whole;
  - the client loads tiles only.
- **Frame budget:** W2 keeps the umbrella laptop target. M-X records the Swipe + 4 layers +
  divider-drag scenario. The p95 assertion is opt-in under `E2E_FRAME_BUDGET=1` (Foundation precedent).

## Rules while Maps is in flight

- No unit builds or installs an installer (R9). IMC-X does that once, after I, M and C are merged.
- `scripts/start-task.ps1` / `finish-task.ps1` are not used (R10). The coordinator cuts worktrees and
  merges by hand.
- Only M-C0 edits `contract/openapi.yaml` or writes a migration. A later unit that finds a contract
  gap reports BLOCKED rather than editing the YAML. The single exception is the retirement of
  M-C0's own stub and guard scaffolding, per M-C0's hand-off table.
- New request options on existing operations answer 501 `not_implemented` with `details {option,
unit}` (M-C0 `app/workspace/pending.py`, `OPTION_STUBS`) until their unit lands. ADR
  `vault/decisions/2026-09-27-new-options-on-existing-operations-answer-501.md` (M-C0 Task 8) records this.
- Backend runs with `E:\Dev\Yolo\app\backend\.venv\Scripts\python.exe` from `<worktree>\backend`.
  M-B3 adds `pypdfium2==5.13.0`: it installs it into an overlay venv while building and additively
  into the shared venv at its last task, with a before/after `pip freeze` diff (CONTRIBUTING, R10).
- Each unit runs focused tests per task and the full gate once near its end. The coordinator gives
  each dispatch an e2e port range.

## Shared-file touches (outside M's own new packages `app/workspace/`, `app/drawings/`, `app/mapmeasure/`, `app/measurements/`, `frontend/src/mapws/`, `frontend/src/measurements/`)

Same-batch overlaps are marked **⚠** with the rule that keeps them disjoint.

| File                                                                                                                                                   | Unit (batch)             | Anchor                                                                                                                                                                                                        | What                                                                                                                                                                                                                      |
| ------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `contract/openapi.yaml`, `contract/client/schema.d.ts`, `contract/client/index.ts`                                                                     | C0 (1)                   | M's tag, paths, schemas and parameters appended; `Error.code` description end; `JobType.enum`; `Event.type.enum`                                                                                              | the whole §12 contract (R6: M's groups only)                                                                                                                                                                              |
| `contract/fixtures/site-grid-vectors.json`                                                                                                             | C0 (1)                   | new                                                                                                                                                                                                           | shared vectors, read by B1 and W1                                                                                                                                                                                         |
| `contract/fixtures/georef-fit-vectors.json`                                                                                                            | B3 (2)                   | new                                                                                                                                                                                                           | shared fit vectors, read by W5                                                                                                                                                                                            |
| `backend/app/api.py`                                                                                                                                   | C0 (1); B1, B3, B4 (2) ⚠ | C0 writes the M block multi-line: `for _module in (` / `    "app.workspace.stubs",` / `):`                                                                                                                    | each B unit inserts **its own line** before `"app.workspace.stubs",`: B1 `app.workspace.router`, B3 `app.drawings.router`, B4 `app.mapmeasure.router` and `app.measurements.union`. B2 routes inside the surfaces router. |
| `backend/app/main.py`                                                                                                                                  | C0 (1)                   | `project_opened` steps, after `("stale design inspection sweep", …)`                                                                                                                                          | the drawing sweep line                                                                                                                                                                                                    |
| `backend/app/projects/service.py`                                                                                                                      | C0 (1)                   | `ProjectHandle`, after `volumes_dir`                                                                                                                                                                          | `drawings_dir`                                                                                                                                                                                                            |
| `backend/app/events_util.py`                                                                                                                           | C0 (1)                   | end of file                                                                                                                                                                                                   | three `publish_*` helpers                                                                                                                                                                                                 |
| `backend/app/db/models.py` + `migrations/versions/0012_map_workspace.py`                                                                               | C0 (1)                   | named classes; end of file                                                                                                                                                                                    | columns, indexes, three classes (R4: `down_revision "0011"`)                                                                                                                                                              |
| `backend/app/surfaces/{schemas,service}.py`                                                                                                            | C0 (1); B2 (2)           | `SurfaceKind`, `SurfaceOut`, `SurfacePatch`, `to_out`                                                                                                                                                         | `dem`, `elevation_role`, `captured_on`                                                                                                                                                                                    |
| `backend/app/volumes/schemas.py`, `volumes/service.py`                                                                                                 | C0 (1); B1, B5 (2) ⚠     | B1: **the last line** of `VolumeMeasurementOut` and of `VolumeFootprint`                                                                                                                                      | B1 adds `polygon_site` / `ring_site`. B5 anchors after `alignment:` and never touches B1's last lines.                                                                                                                    |
| `backend/app/volumes/router.py`                                                                                                                        | C0 (1); B1 (2)           | the `get_volume_measurement`, `get_volume_footprints` handlers                                                                                                                                                | B1 adds `frame`. B5 does not touch this router.                                                                                                                                                                           |
| `backend/app/maps/schemas.py`                                                                                                                          | C0 (1); B1, B5 (2) ⚠     | B1: last field of `MapDetectionOut` and `MapDensityCell`. B5: `MapRunOut` after `area_counts`                                                                                                                 | disjoint classes                                                                                                                                                                                                          |
| `backend/app/maps/router.py`                                                                                                                           | B1 (2)                   | `list_map_detections`, `get_map_density`, `next_unreviewed…`                                                                                                                                                  | `frame` param. B5 does not touch it.                                                                                                                                                                                      |
| `backend/app/detect/analytics_router.py`                                                                                                               | C0 (1); B1, B5 (2) ⚠     | B1: last line of `SiteAreaOut`, plus `list_site_areas`. B5: after `polygon_wgs84`, `SiteAreaCreate`/`Patch`, the create and update handlers                                                                   | disjoint lines                                                                                                                                                                                                            |
| `backend/app/detect/{schemas,router}.py`, `maps/timeline.py`, `maps/service.py`, `maps/jobs_detect.py`                                                 | C0 (1); B5 (2)           | `RunCreate`; `create_runs`; the timeline and analytics filters                                                                                                                                                | region runs                                                                                                                                                                                                               |
| `backend/app/detect/review_router.py`                                                                                                                  | B1, B5 (2) ⚠             | B1: `def next_unreviewed(` only. B5: the `review_map_detections` route only                                                                                                                                   | disjoint handlers                                                                                                                                                                                                         |
| `backend/app/findings/service.py` (F)                                                                                                                  | B5 (2)                   | `delete_in_session`, after `row = get_or_404(...)`                                                                                                                                                            | a 3-line map hook                                                                                                                                                                                                         |
| `backend/app/data_items/providers.py`                                                                                                                  | B2, B3 (2) ⚠             | B2: `class Elevations` `_day` line. B3: import line, plus the end of file                                                                                                                                     | B2 coalesces the date; B3 adds the `Drawings` provider                                                                                                                                                                    |
| `backend/app/overview/service.py`                                                                                                                      | B3 (2)                   | `data_counts`                                                                                                                                                                                                 | drawings count                                                                                                                                                                                                            |
| `backend/app/__main__.py`, `kestrel_backend.spec`, `scripts/smoke_frozen.ps1`, `requirements*.txt`, `tests/test_dependency_pins.py`, `CONTRIBUTING.md` | B3 (2)                   | named in B3                                                                                                                                                                                                   | `pypdfium2` and `drawings-selftest`                                                                                                                                                                                       |
| `backend/tests/test_contract.py`                                                                                                                       | C0 (1); B1–B5 (2) ⚠      | `REFUSES_VALID_DATA` (each unit appends one `# M-Bn` block); `OPTION_STUBS` (B2 and B5 delete their entries); the `EXPECTED_STUBS \|=` line (the last of B1–B4 deletes it)                                    | trivial serial rebases                                                                                                                                                                                                    |
| `frontend/src/jobs/jobLabels.ts`, `app/jobVerbs.ts`, `jobs/JobCard.tsx`, `agent/project/ToolRow.tsx`, `ui/useJobToasts.ts`                             | C0 (1); W6 (3)           | exhaustive job maps (C0); W6 changes one `design_import` target                                                                                                                                               | two job types, one retarget                                                                                                                                                                                               |
| `frontend/src/volumes/model.ts`, `volumes/MeasurePanel.tsx`                                                                                            | C0 (1); W4 (3)           | `BASE_KIND_TEXT`; the base `<Select>`; the alignment block and the "Machines and exclusions" `Disclosure`                                                                                                     | C0 adds `toe_lowest`. W4 extracts `MasksSection` and `AlignmentSection`.                                                                                                                                                  |
| `frontend/src/routes/projectRoutes.tsx`                                                                                                                | W1 (2); W6 (3); X (4)    | W1: the `maps` entry. W6: the Measurements block. X: the `maps/:mapId` entry                                                                                                                                  | batches differ                                                                                                                                                                                                            |
| `frontend/src/routes/legacyRedirects.tsx`                                                                                                              | W6 (3); X (4)            | W6: `volumes*` and `measurements/:id`. X: `past/maps/:mapId` and `maps/:mapId`                                                                                                                                |                                                                                                                                                                                                                           |
| `frontend/src/app/routeModel.ts` (+ test)                                                                                                              | W1 (2)                   | `layoutOf` maps line                                                                                                                                                                                          | full-bleed                                                                                                                                                                                                                |
| `frontend/src/store/changes.ts`                                                                                                                        | W1 (2); W4, W6 (3) ⚠     | W1: `mapWorkspaceRevision`, `mapMeasurementsRevision`. W4: a `lastFindingIds` field, set in the `findings.changed` branch. W6: `measurementsRevision`, `PROJECT_SCOPED_EVENTS` and the `volumes.changed` line | each adds its own field; the second to merge rebases (keep both)                                                                                                                                                          |
| `frontend/src/ui/Icon.tsx` (+ `Feedback.test.tsx`)                                                                                                     | W1 (2)                   | end of `IconName` and `PATHS`                                                                                                                                                                                 | **eleven icons**: the R6 primitive addition for M. No other M unit edits `ui/`.                                                                                                                                           |
| `frontend/src/surfaces/ImportElevationDialog.tsx` (+ test)                                                                                             | W5, W6 (3) ⚠             | W5: `type Mode` and the chooser list. W6: only the `<Link to={…/measurements}>` line                                                                                                                          | disjoint lines                                                                                                                                                                                                            |
| `frontend/src/app/paletteCommands.ts` (+ test)                                                                                                         | W5, W6 (3) ⚠; X (4)      | W5: `IMPORTERS`. W6: the `dataHref` elevation line. X: the other `dataHref` lines                                                                                                                             | disjoint lines                                                                                                                                                                                                            |
| `frontend/src/app/addDataStore.ts`, `data/addDataTiles.ts`, `data/AddDataDialog.tsx` (+ test), `e2e/project-screens.spec.ts`                           | W5 (3)                   | the Drawing tile                                                                                                                                                                                              | enabled                                                                                                                                                                                                                   |
| `frontend/src/screens/VolumesScreen.tsx`                                                                                                               | W6 (3); X (4)            | W6: the four `navigate(…/measurements…)` calls. X: the list `<li>`                                                                                                                                            | batches differ                                                                                                                                                                                                            |
| `frontend/src/api/siteAreas.ts`, `api/volumes.ts`                                                                                                      | W3, W4 (3)               | end of file (different files)                                                                                                                                                                                 | new fetchers                                                                                                                                                                                                              |
| `frontend/src/maps/MapReviewPanel.tsx`                                                                                                                 | W4 (3)                   | `STATE` const                                                                                                                                                                                                 | moved to `maps/reviewState.ts`                                                                                                                                                                                            |
| `frontend/src/review/DetectReview.tsx`, `screens/SiteAreasScreen.tsx`, `screens/CloudsScreen.tsx` (or C-W1's `clouds/workspace/CloudWorkspace.tsx`, IMC item 7) | X (4)                    | named in X                                                                                                                                                                                                    | links into the workspace. I-FW edits `DetectReview`'s photo branch; X only the map branch                                                                                                                                  |
| `frontend/e2e/shell.spec.ts`                                                                                                                           | W1 (2); W6 (3); X (4)    | named tests                                                                                                                                                                                                   | batches differ                                                                                                                                                                                                            |
| `frontend/e2e/volumes.spec.ts`, `design-surfaces.spec.ts`                                                                                              | W6 (3)                   | `/measurements` goto lines                                                                                                                                                                                    | retargeted to `/measurements/volumes`                                                                                                                                                                                     |
| `frontend/e2e/clouds.spec.ts`, `detect-review.spec.ts`, `maps.spec.ts`                                                                                 | X (4)                    | named in X                                                                                                                                                                                                    | C-G rewrites `clouds.spec.ts`; M-X owns `mapRoutes` and the two map-start tests; the second of X and C-G to merge keeps the other's (IMC item 8)                                                                          |
| `docs/progress.md`                                                                                                                                     | X (4)                    | top section                                                                                                                                                                                                   | the Maps entry                                                                                                                                                                                                            |

`ui/keymap.ts`: **no M edit**. F already carries the map-workspace entries, and M-W1 verifies them
with the collision test.

## Cross-sub-project edges (R7)

- **C-B1 → M-B4's cloud provider.** In the file `backend/app/measurements/providers.py`,
  `CLOUD_HEADLINES: dict[str, Callable[[CloudMeasurement], Headline]]` is keyed by `sub_kind`
  (`point`, `distance`, `height`, `vertical` today). The anchor line is
  `# C-B1: add "area" and "profile" entries here`. An unknown sub-kind falls back to `NO_HEADLINE`
  (headline null, never an error), and cloud status is already mapped generically. **One design (IMC
  reconciliation item 6):** the two entries call C-B1's `app.pointclouds.headline.headline_for` (units
  `m2`/`m`) and are written by whichever of C-B1 and M-B4 merges second (C-B1 Task 8, or M-B4 Task 6
  Step 7). No `method_label`/`list_status`. M-C0's `MeasurementSubKind` enum already contains `area`
  and `profile`.
- **M-W6 renders C's rows generically.** Unknown sub-kinds get humanised labels, and a null headline
  shows "—". Cloud rows deep-link to `clouds/<data_id>`; C defines no measurement-selection parameter.
- **Map ↔ 3D.** M-W1's stage context menu "Open this spot in 3D" and `openIn3dHref(projectId, e, n,
date)` reuse today's clouds URL shape. M-W4's detection inspector uses the same helper. C keeps
  accepting that URL.
- **I:** no edge. Image lengths are not a union provider (deferred, I §20). The finding-edit echo is
  I's (R8).
- **Migration chain:** `0010 → 0011 (I) → 0012 (M) → 0013 (C)`. M-C0 Task 9 sets `down_revision =
"0011"`.
- **`frontend/e2e/clouds.spec.ts`:** M-X edits only its map-jump tests. C-G owns the rest.

## Coordinator rulings (binding on executors)

1. **The volume view moves to `/p/:projectId/measurements/volumes[/:id]`** (W6 R-W6-1). The
   Measurements tab owns `/measurements`, and `/measurements/:id` and `/volumes*` redirect to the new
   address. B4's deep-link table, W4's mask link and X's links use the new path. M §11's "VolumesScreen
   unchanged" becomes "its UI is unchanged; four internal paths move".
2. **Selection deep links are `maps?sel=<kind>:<id>`**, with the kinds `measurement`, `finding`,
   `zone`, `volume`, `detection`, `run`, `surface` and `drawing` (W1 parses them; W3, W4 and W6 use
   them). W1 also handles the arrivals `?finding=`, `?map=`, `?at=` and `?tool=`.
3. **Tile URL queries:**
   - `v` is the layer version.
   - `frame_key=<siteCode>` is a client cache key, ignored by the server.
   - `t=a,b,c,d,e,f` is a drawing preview affine, answered `no-store`, and 422 `invalid_preview`
     when malformed.
   - `knockout=true` turns white transparent on drawing rasters.
   - `style` and `interval` apply to surfaces.

   M-C0 declares all of them. B1 parses `t` into `TileStyle.preview`, and B3's `drawing_raster`
   resolver uses it.

4. **B3's fit maths and `contract/fixtures/georef-fit-vectors.json` are canonical.** W5's `fit.ts`
   passes all of its vectors: `scale` is the mean axis length, a similarity with 3+ mirrored points is
   refused, and RMSE is 0 at the minimum pair count.
5. **One site-frame implementation.** B4 (`mapmeasure/frames.py`) and B5 (`maps/site_crs.py`) build
   on thin local pyproj helpers so batch 2 stays parallel. Each delegates to `app.workspace.frame`
   before its gate, once B1 is on `main`.
6. **W1 exposes `useWorkspaceLayers()`** (one layers read per `mapWorkspaceRevision`), and every W
   plugin uses it rather than its own read.
7. **Diagnostics hook for e2e:** W1 installs `window.__kestrelSiteMap = {pixelOf, coordOf}` only
   when diagnostics are on (the switch is named in W1). M-X's flows click at site coordinates through
   it.
8. **`map_run.scope` and `site_area.category` are NOT NULL with defaults** (`map`, `general`). A
   nullable scope would silently drop old runs from the timeline (C0 Ruling 5).
9. **`GET /measurements` pages on `created_at`** (a stable key), not `updated_at`. Units and status
   are enums (C0 Rulings 8–9).
10. **`MapDataList` is left unrouted by W1** and deleted by X. W6 does not edit it.
11. **The PDF strip render is compared within ±4 grey levels**, not pixel-exact as §15 asks. B3
    measured that PDFium's anti-aliasing depends on the device origin.

## Deviations from the spec caused by what Foundation built (summary; each plan lists its own)

- F's `ui/keymap.ts` already holds the map-workspace keys, so W1 adds no keymap entry.
- F hosts VolumesScreen at `/measurements`, so R8's tab forces the move in ruling 1.
- The existing `surfaces/startup.py` sweep already fails a `building` surface of any kind (including
  `dem`). C0 and B2 only pin it with a test.
- F's frame-time "harness" is inline code in `effects.spec.ts`. X adds `e2e/frameTime.ts` and leaves F's
  spec untouched.
- `site-tiles/{kind}/{layerId}` instead of `{id}`. `setSiteFrame` takes `{kind, epsg?}`. The
  drawing georef is `georef: null` when unplaced. Map-measurement geometry is a vertex list, not
  GeoJSON (C0 Rulings 16–19).
- `map_detection.finding_id` has a unique index and no FK: SQLite would have to rebuild the table.
- B2 routes `POST /elevations` inside the surfaces router, so it makes no `api.py` edit.

## Unit M-X: evidence (R9)

M-X is planned in full in `2026-09-27-maps-x.md`, and runs after every M unit is on `main`.

- **Screens and links:** `MapsScreen` is trimmed into `MapEvaluateScreen`, `SurveysScreen` and
  `MapDataList` are deleted, the redirects and "Open in map" links are added, and `maps.spec` is
  rewritten.
- **E2E:** spec §15 flows 1–7 run on Prism with a stateful workspace fake, plus one opt-in
  real-backend flow and the frame scenario.
- **Acceptance:** an HTTP acceptance script runs on the operator's data, or on synthetic stand-ins
  when that data is absent.
- **Docs:** `docs/evidence/maps/README.md` maps §16 to evidence, and M-X adds a `docs/progress.md`
  entry, the full gate and a 14-step operator walkthrough.

It builds **no installer** (IMC-X does).

## Reconciliation log (2026-09-27)

Cross-sub-project seams (I ↔ M ↔ C) are reconciled in `2026-09-27-imc-reconciliation.md`; its
items 2, 3, 4, 6, 7, 8, 10, 11 and 12 changed `b4`, `b5`, `w1`, `w3`, `w4`, `w6` and `x`, and items
13 and 15 are M-C0 hand-offs.

One line per change: what, and which plan files.

1. **`api.py` block.** C0 writes the M block one module per line. B1 (`app.workspace.router`), B3 (`app.drawings.router`) and B4 (`app.mapmeasure.router`, `app.measurements.union`) each insert their own line before `"app.workspace.stubs",`. B2 routes inside the surfaces router. Files: c0, b1, b3, b4.
2. **`SurfacePatch` date and role.** `SurfacePatch.captured_on` and `elevation_role` are added by C0 behind `guard_surface_patch` (501, `OPTION_STUBS` unit M-B2). B2's Task 6 builds them and deletes the guard, which makes W2's "set date and role" real. W2 is now cut after W1, B1 and B2. Files: c0, b2, w2, index.
3. **B5 retires C0's option guards.** B5 deletes each of its guards with the call site, `OPTION_STUBS` entry and guard test as it builds the option. `pending.py` goes only once B2's guard is also gone. B5 keeps C0's response passthroughs. Files: b5.
4. **`nextUnreviewedMapDetection` gains `frame=site`.** C0 declares it, B1 fills `corners_site` in `review_router.next_unreviewed` only, and W4 drops its "missing" caveat. Files: c0, b1, w4.
5. **Tile queries** (index ruling 3):
   - `t` (preview affine, `no-store`, 422 `invalid_preview`) and `frame_key` (a cache key, ignored) are declared by C0 on `getSiteTile` and `getDrawingVectorTile`.
   - B1 adds `TileStyle.preview` and `SiteTileSource.src_transform`, passed to WarpedVRT; B3's T16 resolver uses them.
   - W2 and W5 rename `frame=` to `frame_key=`, and W5 renames `preview=` to `t=` (`PREVIEW_TILES = true`).
   - X matches fixture routes on the path only.

   Files: c0, b1, b3, w2, w5, x.

6. **Error codes.** C0 now declares the codes the B plans use:
   - `outside_map`;
   - `no_site_frame` and `not_in_site_frame`;
   - `invalid_surfaces` and `surface_not_in_frame`;
   - `measurement_limit`;
   - `degenerate` and `invalid_preview`;
   - `not_elevation`, `geographic_output`, `non_metric_output` and `invalid_patch`;
   - the S2 codes on `importElevation`;
   - 422 `no_coordinates` on vector tiles.

   Files: c0, b1, b2, b3, b4.

7. **`DrawingLabel.layer`** is added as optional (C0); W5 reads it. Files: c0, w5.
8. **One site-frame implementation** (index ruling 5). B1 merges first in batch 2 and freezes `points_to_site`, `points_from_site` and `crs_to_wgs84`. B4 (`mapmeasure/frames.py`, T8 Step 1) and B5 (`maps/site_crs.py`, T8 Step 0a) delegate to `app.workspace.frame` after rebasing on B1, with unchanged tests. The coordinator holds B4 and B5 until B1 is on `main`. Files: b1, b4, b5, index.
9. **Same-batch file rule.** B1 appends its `*_site` field as the last line of `SiteAreaOut`, `VolumeMeasurementOut`, `VolumeFootprint`, `MapDetectionOut` and `MapDensityCell`. B5 anchors after `polygon_wgs84` and `alignment` and never edits B1's lines. In `review_router.py`, B1 takes `next_unreviewed` and B5 takes the review POST. Files: b1, b5, index.
10. **The `*_site` response fields are nullable** (`oneOf […, null]` or `type: [array, "null"]`), so B1's pydantic `None` defaults conform when `frame=site` is not asked. Edited in C0 Task 5 by the controller. Files: c0.
11. **Volume view address.** The view moves to `measurements/volumes[/:id]` (W6 R-W6-1, index ruling 1). B4's deep-link table, W4's mask link and X's "Open in map" route and test follow it. Files: b4, w4, w6, x, index.
12. **Measurements union item.** W6 uses C0's `MeasurementItem`: `headline` is number or null, `unit` is the enum `m|m2|m3|deg|mm_per_m`, `status` is an enum, the item has `created_at`, and `limit` is at most 1000. W6's string-headline path is removed. Files: w6.
13. **`MapDataList`.** W1 leaves it unrouted and X deletes it. W6 drops its edit to it. Files: w1, w6, x.
14. **One shared-file `ImportElevationDialog.tsx`** in batch 3 (W5 and W6):
    - W5 anchors at the closing `</button>` of the "Design surface" option and appends its tests.
    - W6 changes only the "Build from a point cloud" `<Link>` line.

    Files: w5, w6.

15. **Fit maths.** B3's fit maths and `contract/fixtures/georef-fit-vectors.json` (19 cases) are canonical. W5's `fit.ts` follows B3's T1 steps 1–11 (`degenerate`, mean-axis `scale`, the mirrored-similarity refusal, RMSE 0 at the minimum pair count), and W5's proposed `backend/tests/fixtures/` path is dropped. Files: b3, w5.
16. **`useWorkspaceLayers()`.** W1 adds it (`mapws/data/useWorkspaceLayers.ts`, one read per revision, published through the store). W2's `useRasterLayers()` and W3's `useSiteLayers()` become thin wrappers over it, with no layers request of their own. Files: w1, w2, w3.
17. **Diagnostics hook.** W1 adds `mapws/diagnostics.ts`: `window.__kestrelSiteMap {pixelOf, coordOf, resolution}`, installed only while `localStorage["kestrel.diagnostics"] === "1"`, with the selectors X needs (`map-workspace`, `site-map`, `layer-row`, `tool-hint`, `map-inspector`, `coord-readout`). X's T1 reads the switch. Files: w1, x.
18. **Map ↔ 3D jump** (X's gap X12). W1 adds `chrome/StageMenu.tsx` "Open this spot in 3D" and `mapws/threeD.ts` (`openIn3dHref`, `useOpenIn3d`, reusing `clouds/jump.ts`). W4 adds "Open in 3D" to the detection inspector through `useOpenIn3d()`. Files: w1, w4, x.
19. **W4 against W1's final names.** W4 plugs into W1's file-name plugin discovery (no `extensions.ts`, no register calls), and its adapter `mapws/w4host.ts` is rewritten against W1's real exports. W4 is cut after W1, B1 and B5. Files: w4.
20. **X uses W1's names.** Tool ids are `align-drawing` and `ai-region`; selection kinds are `measurement` and `zone`. Files: x.
21. **W2: `{layerId}` path parameter and W1 import path** (`mapws/data/useWorkspaceLayers.ts`). W3 uses the same import path. Files: w2, w3.
22. **C-B1 anchor.** The anchor in `backend/app/measurements/providers.py` is confirmed and stated in "Cross-sub-project edges" (R7). C0's `MeasurementSubKind` already contains `area` and `profile`. Files: b4, c0, index.

23. **The site-grid vectors file is M-C0's alone.** C0 Task 7 writes it with the keys `tile_px`, `res`, `tiles`, `bounds`, `max_zoom` and `note`. B1 never writes it; B1's grid tests read C0's structure, and W1 reads the same file. Files: b1, c0, w1.
24. **Layer row keys are `${kind}:${id}`.** The keys follow W1's `LayerRow` rule. W2's raster kinds are `map` and `surface`, and W3's `layerKeyOf` relies on those ids. Files: w3.

25. **W4's new finding id.** W4 learns it from `findings.changed` through a new `lastFindingIds` field in `store/changes.ts`, because the review response stays `{updated}` (B5 R-B5-9). This is a batch-3 shared touch with W6 (disjoint fields). W4's plugin files follow W1's discovery (8 files) and `w4host.ts` re-exports W1's real names. Files: w4, index.

**Verified unchanged:**

- Migration: `0012_map_workspace.py` is C0's only; `down_revision` is `"0010"` while building and `"0011"` after C0 Task 9 (R4). No other M plan writes a migration.
- Job types `elevation_import` (B2) and `drawing_import` with `params.phase` `inspect`/`build` (B3).
- Events `drawings.changed`, `map_measurements.changed` and `map_workspace.changed`, published through C0's `publish_*` helpers.
- The 29 `workspace` operationIds and their path-parameter names (`layerId`, `inspectionId`, `page`, `drawingId`, `mapMeasurementId`) are used as C0 names them by B1–B4, W1–W6 and X.
- The stub lists `B1_STUBS`…`B4_STUBS` are each deleted by their own unit; the last of B1–B4 removes `stubs.py`.
- Selection deep links: `maps?sel=<kind>:<id>` in W1, W3, W4, W6 and X.
- The shared vectors: `contract/fixtures/site-grid-vectors.json`, written by C0 and read by B1 and W1.
- `ui/`: only W1 adds icons; no M unit edits `ui/keymap.ts`.
