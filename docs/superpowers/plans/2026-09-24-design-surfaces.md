# Design Surfaces (S3) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Import a design (DEM GeoTIFF, LandXML TIN, or DXF faces/contours) as a `Surface` with `kind = design` that lands cell-aligned on the site's cloud DSM, after a preview that catches a wrong CRS, a wrong unit or swapped easting/northing.

**Architecture:** A new backend package `app/surfaces/design/` runs one background job type, `design_import`, in three phases: `inspect` (a streamed parse into a flat binary geometry cache under `<project>/cache/design-inspections/<id>/`), `preview` (the full pipeline on a coarse aligned grid, plus validation against the target DSM and a preview PNG), and `build` (the same pipeline on the output grid, written block by block through S2's `grid.SurfaceWriter`). Placement (swap, unit scale, reprojection) happens on vertices; one numpy barycentric rasteriser handles every TIN; points and contours go through densify → dedupe → scipy Delaunay → boundary peeling. The frontend adds `ImportDesignDialog`, a progressive one-scroll dialog mounted from S2's Volumes screen surface list.

**Tech Stack:** Python 3.11, FastAPI, SQLAlchemy, numpy 2.4.6, scipy 1.17.1 (`scipy.spatial.Delaunay`), ezdxf 1.4.4 (pinned by F0), rasterio 1.4.4 + pyproj 3.7.2, psutil 7.2.2, Pillow 12.3.0, stdlib `xml.etree.ElementTree.iterparse`; React 18 + TypeScript, openapi-fetch client, vitest, Playwright against the Prism mock.

**Spec:** `docs/superpowers/specs/2026-09-23-design-surfaces-design.md` (S3). It leans on `docs/superpowers/specs/2026-09-23-volumes-design.md` §4 (S2's frozen `grid.py` interface) and `docs/superpowers/specs/2026-09-23-point-clouds-design.md` §5 (F0) and §15.3 (the cross-spec DAG). Executors read all three.

## Global Constraints

- **F0 is merged to `main` before any task starts** (plan `docs/superpowers/plans/2026-09-24-pointcloud-foundation.md`). F0 delivers: every S3 path and schema in `contract/openapi.yaml` (tag `surfaces`) with `schema.d.ts` regenerated; `JobType` `design_import`; the `Surface`/`VolumeMeasurement` models and migration (no S3 column); the package `app/surfaces/design/` with a stub `router.py` (all 8 S3 operations as 501s via `app.stubs.add_stubs`), a stub `jobs.py` registering `design_import`, a no-op `startup.py::sweep_interrupted(handle, runner) -> list[str]` wired into `main.project_opened()`, and `selftest.py::main` printing "design-selftest not built" and returning 2, dispatched from `app/__main__.py` as `main(argv: list[str] | None = None)`; `ezdxf==1.4.4` (with `openpyxl==3.1.5`, `et-xmlfile==2.0.0`, `laspy==2.7.0`, `lazrs==0.8.2`) pinned direct; `scipy==1.17.1`, `shapely==2.1.2`, `psutil==7.2.2` direct; migration `0009`; `ProjectHandle.surfaces_dir`; `events_util.publish_surfaces_changed(request, handle, surface_ids)`; all eight job-type places carry `design_import` ("Design surface import", icon `volume`, result link `/p/:id/volumes`). `app/api.py` includes the design router inside a guard with `dependencies=[Depends(require_kind(("detect",), ANY_KIND))]`: detection projects write, any project reads, and a training project's writes answer `409 wrong_project_kind` before an S3 handler runs. Implementing an endpoint = delete its tuple from the router's `STUBS` and remove its operationId from `EXPECTED_STUBS` in `backend/tests/test_contract.py`. F0's `backend/tests/test_pointcloud_stubs.py` reads the routers' `STUBS` and skips a stub job once its F0 body is replaced, so no S3 task edits it.
- **No S3 task edits** `contract/openapi.yaml`, `schema.d.ts`, a migration, `app/db/models.py`, `app/api.py`, `app/main.py`, `app/__main__.py`, the dependency pins, `routes.tsx`, the sidebar or the job-label maps. They are F0's.
- **`app/surfaces/grid.py` is S2's (S2 V1).** Tasks that import it (9, 10, 11, 12, 13, 14) start only after S2 V1 is on `main` and the S3 branch is rebased onto it. Use exactly the S2 §4 names: `BLOCK`, `MAX_READ`, `MAX_CELLS`, `GridError`, `GridSpec` (`crs_wkt`, `epsg`, `cell_size`, `x0`, `y0`, `width`, `height`, `transform`, `geotransform`, `bounds`, `window_for_bounds`, `cell_centres`, `to_json`, `from_json`, `from_dataset`), `aligned_grid`, `same_lattice`, `block_windows`, `read_windows`, `SurfaceStats`, `SurfaceWriter(path, spec, *, progress=, check_cancelled=)` with `write_block(window, data)` and `finish() -> SurfaceStats`, `SurfaceReader.read(window, *, out_shape=)`, `open_surface`, `resample_onto(src, dst, window)`, `convention_problems(path)`, `compute_stats(path)`, `hillshade(z, cell_x, cell_y)`. Also `app/surfaces/paths.py::surface_dir(handle, id)` / `surface_path(handle, id)`. Never re-implement any of them.
- `rasterise.py` and `triangulate.py` never import `grid.py` (spec §9.2); they take an object with `x0, y0, cell_size, width, height` and `rasterio.windows.Window`s.
- Every phase is a background job with progress and cancel; `check_cancelled()` once per chunk, per block and per batch of ≤ 64 k triangles.
- Bounded reads: no raster read above 2048 × 2048; the XML tree is cleared as parsed; the target DSM is only read decimated (≤ 512 px) or through `resample_onto` on the preview grid.
- RAM admission refuses when the estimate exceeds 60 % of `psutil.virtual_memory().available`: DXF load `DXF_RAM_FACTOR (12) × file size`; TIN `32 B × points + 12 B × faces`; Delaunay `QHULL_BYTES_PER_POINT (600) × points`; rasterise 100 MB fixed.
- Grid ceilings: `grid.MAX_CELLS` (5 × 10⁸) → `grid_too_large` block; > 2.5 × 10⁸ cells → `large_grid` info.
- Units enum, verbatim: `millimetre`, `centimetre`, `metre`, `international_foot` (0.3048), `us_survey_foot` (1200/3937). The dialog spells out "US survey foot (1200/3937 m)" and "International foot (0.3048 m)".
- LandXML `P` is **northing, easting, elevation**: cached as `x = E` (2nd value), `y = N` (1st value).
- No datum conversion of heights; S3 only warns (`z_offset`).
- DWG is never parsed: `.dwg`, or a `.dxf` whose first bytes are `AC10`, gets `422 validation_error` with `details.reason = "dwg"` and the message "DWG files can't be read. Open the drawing in your CAD program (or the free ODA File Converter) and save it as DXF, then import the DXF."
- UI uses only `frontend/src/ui/` primitives and tokens; `node scripts/check-tokens.mjs` passes; DESIGN.md (Contour). Load the design skills (`impeccable`, `emil-design-eng`) before Tasks 6 and 15.
- **Interpreter.** Every worktree (the S3 worktree and each per-task sub-worktree) builds F0's **overlay venv** at `<worktree>\backend\.venv` (recipe in "Before Task 1", copied from the F0 plan's Task 1 Step 2 and ADR `2026-09-24-worktree-overlay-venv-for-new-dependencies`): a real folder, one `.pth` reading the shared site-packages, F0's new packages installed locally. `$PY` is `.\.venv\Scripts\python.exe`, run from that worktree's `backend\`. S3 never installs into the shared `E:\Dev\Yolo\app\backend\.venv`; F0's last task already put F0's five packages there (operator decision "additive install"), so `scripts\finish-task.ps1` gates S3 normally — no `-SkipGate`.
- Every S3 API test module overrides the conftest fixture `project_kind` to return `"detect"` (the default `project` is a training project, whose writes F0's guard refuses).
- Stage by path, never `git add -A`. Every commit message ends with the trailer `Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>` (pass it as a second `-m`).
- The gate (AGENTS.md §4), run in full with the overlay `$PY` in Task 17 and again by `scripts\finish-task.ps1` with the shared interpreter, which has F0's packages since F0 landed (Task 17 Step 7; never `-SkipGate`):
  ```
  pnpm -C contract check
  cd backend; $PY -m ruff check .; $PY -m ruff format --check .; $PY -m pytest
  pnpm -C frontend lint
  pnpm -C frontend test
  pnpm -C frontend build
  pnpm -C frontend e2e
  cargo test --manifest-path frontend/src-tauri/Cargo.toml   # only if frontend/src-tauri/binaries/kestrel-backend-*.exe exists
  ```

## Review Focus

The spec is silent on these inputs; each would bite an operator. Each line names the task whose tests pin it.

1. **The design file changes on disk between "Read file" and "Import surface".** TIN formats are safe (the build reads the cache), but a DEM is re-read at build. Expected: the preview and the build refuse with "the file changed since it was read; read it again", never a silently different surface. Pinned in Task 11 (`check_unchanged`) and Task 14 (`test_dem_changed_after_preview_fails_the_build`).
2. **A crafted `inspectionId` / `previewId` such as `..\..\projects`.** Expected: 404 and nothing outside `cache/design-inspections/` is read or deleted. Pinned in Task 4 (`test_inspection_ids_are_uuids_only`).
3. **The dialog closes while an inspect or preview job still runs.** Expected: `deleteDesignInspection` cancels the job, the job's late writes do not recreate the deleted folder, and the job ends `cancelled`. Pinned in Task 1 (`test_write_json_is_a_no_op_after_delete`) and Task 4 (`test_delete_cancels_a_running_inspection`).
4. **The app restarts while an inspection is `inspecting` or a preview `running`.** Expected: the project-open sweep marks them `failed` ("interrupted by application restart …") instead of leaving the dialog spinning forever; old folders are removed after 24 h. Pinned in Task 4 (`test_sweep_fails_interrupted_inspections_and_previews`).
5. **The target cloud surface is deleted or rebuilt between the preview and "Import surface".** Expected: `createDesignSurface` answers 409 "the target surface … is no longer ready; preview again" rather than building onto a grid that no longer exists. Pinned in Task 14 (`test_commit_refuses_when_the_target_is_gone`).

## Deviations from the spec, decided while planning (reviewers: do not flag these)

1. **422s and the contract test (the approach, decided once for Tasks 4, 13 and 14).** schemathesis' `positive_data_acceptance` (run by `test_responses_conform`) fails any 422 on a schema-valid request; it accepts 2xx, 401, 403, 404, 409, 429 and 5xx (schemathesis 4.27.3). No S3 handler can hand it a 422, for three reasons, so `tests/test_contract.py` needs only the `EXPECTED_STUBS` edits and **no entry in F0's `REFUSES_VALID_DATA`** (the one allowance mechanism, which F0 defines empty, wires and guards):
   - The contract test's project is a **training** project; F0's `require_kind(("detect",), ANY_KIND)` answers every S3 write (`POST`, `DELETE`) with `409 wrong_project_kind` before the handler runs.
   - Every read and every preview/commit path first resolves `inspectionId`/`previewId`, which must be UUIDs of existing folders: a generated id is `404`.
   - **Missing file → 404, not 422.** Spec §12 lists `422 validation_error` for "file missing"; the plan answers `404 not_found` like `createMap` does (see `app/maps/service.py::create_map`), so a schema-valid path that simply does not exist is never a 422 even in a detection project. The DWG answer stays `422` with `details.reason = "dwg"` (checked before existence, so a `.dwg` path always gets the fix message); an unknown extension on an existing file stays `422`; the preview's option checks stay `422` (spec §12). The contract's `default: Error` response documents 404 and 409.
   Task 4 pins the ordering with `test_contract_positive_cases_never_meet_a_422`; if a later contract change makes a 422 reachable, add `"<operationId>": {422}` to F0's `REFUSES_VALID_DATA` (that operation only, never a global exclusion, and never a second mechanism). F0's branch then also requires the 422 to carry its own code, not `validation_error` — so a reachable DWG or extension refusal would first need its own code; today they stay unreachable in the contract test because every S3 write stops at 409.
2. **Barycentric origin.** Spec §9.2 step 3 computes barycentrics "relative to the block origin"; §15.2/§16.6 require seam output *bit-identical* to a single-block run. Those conflict: a block-relative origin makes a cell's float result depend on the window it was computed in. The rasteriser computes relative to each triangle's **first vertex** instead — same purpose (no cancellation at UTM magnitudes), and the value no longer depends on the window. ADR in Task 2.
3. **Fixture modules split by format.** Spec §15 names one `tests/designs.py`. Batch-parallel tasks would all edit it, so it holds the analytic surfaces (Tasks 2 and 5 only); LandXML, DXF and DEM/target writers live in `tests/design_landxml.py` (Task 7), `tests/design_dxf.py` (Task 8) and `tests/design_targets.py` (Task 10).
4. **`surface_json.py`.** `createDesignSurface` returns S2's `SurfaceWithJob`, but S2's Surface serializer is part of S2 V2, which does not merge to `main` early (only V1 does). Task 14 serialises design rows itself in `app/surfaces/design/surface_json.py`, validated against the contract by `test_contract.py`. Task 17 records a follow-up in `docs/progress.md`: replace it with S2's serializer once V2 is on `main`.
5. **Internal JSON next to the public bodies.** `inspection.json` and `preview.json` hold exactly the contract bodies; values the pipeline needs but the contract does not carry (`$INSUNITS`, nodata/sentinel/scale/offset, file size and mtime, the resolved output `GridSpec`, the resolved maximum edge, TIN counts) live in `internal.json` next to each.
6. **`INSUNITS = 0` → `units_assumed` is `warn` level.** The spec names the code but not the level; a wrong metre assumption is exactly what the preview must make the operator accept explicitly.
7. **GDAL warp tolerance.** The DEM re-grid opens `WarpedVRT(..., tolerance=0.0)`. GDAL's default approximate transformer (0.125 px) alone puts a 2 % slope 2.5 mm off at a 1 m source cell, which breaks the spec's 1 mm oracle (§15.3 DEM). ADR in Task 11.
8. **Rasteriser batch size.** Spec §9.2 says batches of "≤ 65 536"; the plan uses 16 384 so the `(n, 8, 8)` float64 temporaries stay within the "arrays + 150 MB" memory criterion (§16.5).
9. **e2e runs against the Prism mock** with `page.route` stubs (as every e2e suite here does). "The test writes a small LandXML text file" (§15.4) applies to the pytest end-to-end flow in Task 14, which does run the real pipeline; the Playwright test drives the dialog and the Volumes list with stubbed responses.
10. **Hypotheses from sampled vertices.** Spec §10 recomputes each hypothesis "on the footprint's bbox and mask". The plan re-places up to 20 000 cached file vertices under each alternative and looks them up in the target's ≤ 512 px overview — the same question (how much of the design would lie on the cloud surface) at a fixed, tiny cost, with no second rasterisation per hypothesis.
11. **Kind-guard tests of its own.** F0's `tests/test_pointcloud_stubs.py` derives its 501 checks from the routers' `STUBS` and keeps a fixed list of guarded writes (409 for a training project whether a stub or a real handler answers), so S3 never edits it. Each task that lands a write still adds its own "a training project may not write" test, so the kind guard stays pinned in S3's own suite.

## File map

**Backend: `backend/app/surfaces/design/`** (F0 created the package, `router.py`, `jobs.py`, `startup.py`, `selftest.py` as stubs)

| File | Task | Responsibility |
| --- | --- | --- |
| `units.py` | 1 | `LinearUnit`, `unit_to_m`, `unit_from_factor`, `crs_axis_unit`, `xy_scale`, LandXML and `$INSUNITS` maps, labels |
| `codes.py` | 1 | `DesignNote` (code, level, message) and `info`/`warn`/`block` |
| `admission.py` | 1 | `admit(need, what, fix)`, `tin_bytes`, `RASTERISE_BYTES` |
| `inspection.py` | 1 | `Detected`, `Candidate`, `InspectResult` (what readers return) |
| `store.py` | 1 | inspection/preview folders, id validation, atomic JSON, streamed sha256, `CandidateWriter` / `read_candidate` |
| `thumbs.py` | 1 | 160 px plan thumbnails (points) and shade thumbnails (DEM) |
| `rasterise.py` | 2 | `TinRasteriser`, `rasterise_to_array`, `SimpleLattice` |
| `detect.py` | 4 | extension → format, DWG rejection |
| `schemas.py` | 4 | pydantic models for every S3 schema |
| `jobs.py` | 4 | the `design_import` dispatcher (phase → module, lazily imported) |
| `phase_inspect.py` | 4 | the `inspect` phase: hash, reader by format, `inspection.json` |
| `startup.py` | 4 | the body of `sweep_interrupted` |
| `router.py` | 4, 13, 14 | the eight operations |
| `triangulate.py` | 5 | densify, dedupe, Delaunay, peeling |
| `landxml.py` | 7 | streamed LandXML reader |
| `dxf.py` | 8 | ezdxf reader |
| `selftest.py` | 8, 14 | `design-selftest` |
| `dem.py` | 9 | DEM inspection |
| `placement.py` | 10 | options → `Placement`, `place_vertices`, output and preview grids, raster envelope |
| `dem_build.py` | 11 | copy-as-is gate and copy, `WarpedVRT` re-grid, preview read, unchanged-file check |
| `validate.py` | 12 | overlap, hypotheses, z checks, coordinate checks, `TargetOverview` |
| `preview_image.py` | 12 | `preview.png` (one panel or two) |
| `pipeline.py` | 13 | selection, geometry loading, triangulation step shared by preview and build |
| `phase_preview.py` | 13 | the `preview` phase |
| `targets.py` | 13 | `target_ready`: is a surface a usable target (router and commit gate) |
| `phase_build.py` | 14 | commit gate, Surface row, the `build` phase |
| `surface_json.py` | 14 | a design `Surface` row as the contract's `Surface` |

**Backend tests (new):** `tests/designs.py` (2, 5), `tests/fake_design_reader.py` (4), `tests/design_landxml.py` (7), `tests/design_dxf.py` (8), `tests/design_targets.py` (10); `tests/test_design_units.py`, `test_design_store.py` (1), `test_design_rasterise.py` (2), `test_design_api_inspect.py`, `test_design_startup.py` (4), `test_design_triangulate.py` (5), `test_design_landxml.py` (7), `test_design_dxf.py`, `test_design_selftest.py` (8), `test_design_dem.py` (9), `test_design_placement.py` (10), `test_design_dem_build.py` (11), `test_design_validate.py` (12), `test_design_preview.py` (13), `test_design_build.py` (14).

**Backend (modified):** `backend/tests/test_contract.py` (`EXPECTED_STUBS`: 4, 13, 14), `backend/scripts/smoke_frozen.ps1` (8), `backend/scripts/design_acceptance.py` (17, new).

**Frontend (new):** `src/api/designSurfaces.ts` (+test), `src/surfaces/designImport.ts` (+test), `src/surfaces/testFixtures.ts` (3); `src/surfaces/ImportDesignDialog.tsx`, `DesignContents.tsx`, `DesignPlacement.tsx`, `DesignCheck.tsx`, `ImportDesignDialog.test.tsx` (6); `e2e/design-surfaces.spec.ts` (16).

**Frontend (modified):** S2 V7's Volumes surface-list component — one button and the dialog mount (15).

**Docs:** `vault/decisions/2026-09-24-gotcha-barycentric-origin-decides-seams.md` (2), `vault/decisions/2026-09-24-gotcha-gdal-warp-tolerance-breaks-mm-accuracy.md` (11), `docs/usability/2026-09-24-design-surfaces-walkthrough.md`, `docs/evidence/design-surfaces/README.md`, `docs/progress.md`, `vault/sessions/…`, `vault/00-north-star.md` (17).

## Budget and execution DAG

> **Execution note (cross-plan).** Prerequisite: F0 (`2026-09-24-pointcloud-foundation.md`) merged to `main`. S3 Tasks 9–14 additionally need S2 Task 1 (`app/surfaces/grid.py`, V1) on `main` (S3 Tasks 9–12 depend on it directly, 13–14 through them); S3 Tasks 15–16 need S2 Task 15 (the Volumes screen surface list, V7); S3 Task 17 needs S1 Task 14 (import, I2) and S2 Tasks 2 and 9 (surface build, V2), 11 (volume calculation, V5) and 16 (the Volumes UI, V8) on `main`. Only S2 Task 1 merges to `main` early; the other S2 tasks reach `main` with S2 Task 17, and S1 Task 14 with S1 Task 19, unless the coordinator lands them sooner.

**Budget** (spec §14.1)

- **Background jobs:** `design_import` in three phases, each with progress and cancel.
  - `inspect`: streamed sha256 (64 MB chunks) and parse. LandXML memory is O(1 M-row `array` buffers); DXF holds the ezdxf document and is admitted at `12 × file size`.
  - `preview`: the memory-mapped cache, placed vertices (N × 3 float64), Delaunay for points, a preview grid ≤ 513 × 513, one decimated target read ≤ 512 px and one `resample_onto` on the preview grid.
  - `build`: TIN arrays plus one 2048² block and ≤ 64 MB batch buffers; the DEM path reads 2048² windows only.
- **Synchronous and bounded:** create/get/delete inspection and preview (small JSON files and a folder delete), thumbnail and preview PNG (pre-rendered files), `createDesignSurface` (JSON checks and one row insert).
- **Never loaded whole:** the XML tree, the output grid, a DEM, the target DSM. **Bounded by input, admitted:** TIN arrays, Delaunay, the ezdxf document.

**DAG** (a task starts when every dependency is merged into `task/design-surfaces`)

| Task | Depends on | Batch |
| --- | --- | --- |
| 1 Foundations: units, notes, admission, inspection types, store, thumbs | F0 | B1 |
| 2 TIN rasteriser + `tests/designs.py` | F0 | B1 |
| 3 Frontend API client + import state machine | F0 | B1 |
| 4 Router (inspect ops), `design_import` dispatcher, inspect phase, DWG, sweep | 1 | B2 |
| 5 Triangulation (densify, dedupe, Delaunay, peeling) | 2 | B2 |
| 6 `ImportDesignDialog` (standalone, not mounted) | 3 | B2 |
| 10 Placement + `tests/design_targets.py` | 1, 2, **S2 V1** | B2 |
| 7 LandXML reader | 1, 2, 4 | B3 |
| 8 DXF reader + `design-selftest` + smoke step | 1, 4, 5 | B3 |
| 9 DEM inspection | 1, 4, 10, **S2 V1** | B3 |
| 11 DEM build paths (copy, re-grid, preview read) | 10, **S2 V1** | B3 |
| 12 Validation + preview image | 10, **S2 V1** | B3 |
| 13 Preview phase + three preview endpoints | 5, 7, 8, 9, 11, 12 | B4 |
| 14 Build phase + `createDesignSurface` | 13 | B5 |
| 15 Mount the dialog in the Volumes surface list | 6, **S2 V7** | when S2 V7 is on `main` (has slack) |
| 16 e2e | 15 | after 15 |
| 17 Acceptance, walkthrough, evidence, ledger, finish, wrapup | 14, 16; S1 import, S2 V2 + V5 on `main` | B6 |

- **Critical path:** F0 → 1 → 4 → 8 → 13 → 14 → 17 (the spec's F0 → U1 → U3 → U6 → U7 → U9). Task 8 (DXF) is the largest reader. Task 10 gates 9, 11 and 12, and they gate 13, so **S2 V1 must be on `main` by the start of B2**: if it lands later, 9–14 slide with it; 1–8 are unaffected.
- **S2 V1 rebase (before Tasks 9, 10, 11, 12, 13, 14):** from the S3 worktree, `git fetch` is not needed (local repo); run `git -C E:\Dev\Yolo\app log --oneline -1 -- backend/app/surfaces/grid.py` to confirm V1 is on `main`, then `git rebase main` on `task/design-surfaces` and re-run `$PY -m pytest -q` before starting. Re-read `backend/app/surfaces/grid.py` and check every name in Global Constraints exists with the S2 §4 signature; if one differs, stop and report — do not adapt S3 to a drifted interface silently.
- **S2 V7 (before Task 15):** rebase onto `main` once V7 (the Volumes screen surface list) has merged. Task 6 builds and tests the dialog standalone, so nothing else waits.
- **Shared files (tasks that touch the same file must not run at the same time):**
  - `backend/app/surfaces/design/router.py`: 4 → 13 → 14 (different batches).
  - `backend/tests/test_contract.py` (`EXPECTED_STUBS`): 4 → 13 → 14.
  - `backend/tests/test_pointcloud_foundation.py` (the selftest-placeholder parametrize, one entry per line): 8 deletes the `design-selftest` line only (S1 Task 15 and S2 Task 13 delete their own lines; no conflict).
  - `backend/app/surfaces/design/selftest.py`: 8 → 14.
  - `backend/tests/designs.py`: 2 creates, 5 appends (sequential by dependency).
  - `backend/scripts/smoke_frozen.ps1`: 8 (S1 and S2 add adjacent steps; trivial merge).
  - S2's Volumes surface-list component: 15 only.
  - `docs/progress.md`, `vault/00-north-star.md`: 17 only.
- **Running a batch in parallel:** each task of a batch gets its own sub-worktree cut from the current `task/design-surfaces` head: `git -C E:\Dev\Yolo\app worktree add E:\Dev\Yolo\app\.claude\worktrees\ds-<n> -b task/ds-<n> task/design-surfaces`, then build that sub-worktree's overlay venv ("Before Task 1" Step 3, with `$wt` set to the sub-worktree) and run `pnpm -C <wt>\frontend install` and `pnpm -C <wt>\contract install` for frontend tasks. After review, merge each back from the S3 worktree with `git merge --no-ff task/ds-<n>`, run `$PY -m pytest -q` and `pnpm -C frontend test`, then remove the sub-worktree per the junction rule (`vault/decisions/2026-09-18-gotcha-shared-venv-deleted-with-a-worktree.md`: list `LinkType` directories, delete junctions as links, `git worktree remove`, `git branch -d task/ds-<n>`). Never `rm -rf` a worktree.

## Before Task 1: the S3 worktree and its interpreter

- [ ] **Step 1: Confirm F0 is on `main`**

Run (PowerShell): `git -C E:\Dev\Yolo\app log --oneline -1 -- backend/app/surfaces/design/router.py`
Expected: one F0 commit. Then `Select-String -Path E:\Dev\Yolo\app\backend\tests\test_contract.py -Pattern "createDesignInspection|getDesignPreviewImage|createDesignSurface"` shows the three names inside `EXPECTED_STUBS`. If either is missing, stop: F0 is not merged.

- [ ] **Step 2: Cut the S3 worktree**

Run: `E:\Dev\Yolo\app\scripts\start-task.ps1 design-surfaces`
Expected: "worktree ready on task/design-surfaces" at `E:\Dev\Yolo\app\.claude\worktrees\design-surfaces`.

- [ ] **Step 3: Build the overlay venv (nothing is written into the shared venv)**

This is F0's recipe (F0 plan Task 1 Step 2; ADR `2026-09-24-worktree-overlay-venv-for-new-dependencies`). In PowerShell:
```
$wt = "E:\Dev\Yolo\app\.claude\worktrees\design-surfaces"
$shared = "E:\Dev\Yolo\app\backend\.venv"
$base = ((Get-Content "$shared\pyvenv.cfg" | Where-Object { $_ -like 'home = *' }) -replace '^home = ', '').Trim()
uv venv --python "$base\python.exe" "$wt\backend\.venv"
Set-Content -Encoding ascii -Path "$wt\backend\.venv\Lib\site-packages\_kestrel_shared_venv.pth" -Value "$shared\Lib\site-packages"
uv pip install --python "$wt\backend\.venv\Scripts\python.exe" --no-deps laspy==2.7.0 lazrs==0.8.2 ezdxf==1.4.4 openpyxl==3.1.5 et-xmlfile==2.0.0
cd "$wt\backend"; $PY = ".\.venv\Scripts\python.exe"
& $PY -c "import ezdxf, scipy, psutil, rasterio, laspy; print(ezdxf.__version__)"
@(Get-ChildItem "$wt\backend\.venv" -Recurse -Force -Directory | Where-Object LinkType).Count
```
Expected: `1.4.4`, and a link count of `0`. F0 installed its packages into the shared venv too; the `uv pip install` line is then a no-op in effect (the local copies win) and harmless.

- [ ] **Step 4: Baseline**

Run from `backend`: `$PY -m pytest -q`
Expected: all pass (F0's state), including `test_contract.py` with the eight S3 stubs.

---
### Task 1: Foundations — units, notes, admission, inspection types, the inspection store, thumbnails

Pure modules every later backend task imports. No endpoint changes.

**Files:**
- Create: `backend/app/surfaces/design/units.py`, `codes.py`, `admission.py`, `inspection.py`, `store.py`, `thumbs.py`
- Test: `backend/tests/test_design_units.py`, `backend/tests/test_design_store.py`

**Interfaces:**
- Consumes (F0): `ProjectHandle.folder`; `app.jobs.cancellation.JobFailure`; `app.errors.not_found`.
- Produces:
  - `units.LinearUnit` (StrEnum), `unit_to_m(unit) -> float`, `unit_from_factor(factor: float) -> LinearUnit | None`, `horizontal_crs(crs: CRS) -> CRS`, `crs_axis_unit(crs: CRS) -> LinearUnit` (raises `UnsupportedCrsUnit`), `xy_scale(horizontal_unit, crs: CRS) -> float`, `LANDXML_UNITS: dict[str, LinearUnit]`, `INSUNITS: dict[int, LinearUnit]`, `UNIT_LABEL: dict[LinearUnit, str]`, `FEET: frozenset[LinearUnit]`.
  - `codes.DesignNote(code, level, message)` with `to_json()` / `from_json(d)`; `codes.info/warn/block(code, message) -> DesignNote`.
  - `admission.admit(need: int, what: str, fix: str, *, available: Callable[[], int] | None = None) -> None` (raises `JobFailure`), `admission.tin_bytes(points: int, faces: int) -> int`, `admission.RASTERISE_BYTES`.
  - `inspection.Detected`, `inspection.Candidate` (both with `to_json()`), `inspection.InspectResult(detected, candidates, internal)`, `inspection.candidate_from_meta(cid, kind, name, meta, **fields) -> Candidate`.
  - `store.inspections_root(handle)`, `store.new_id()`, `store.inspection_dir(handle, iid)`, `store.require_inspection(handle, iid)`, `store.preview_dir(idir, pid)`, `store.require_preview(idir, pid)`, `store.candidate_dir(idir, cid)`, `store.thumb_path(idir, cid)`, `store.read_json(path)`, `store.write_json(path, data) -> bool`, `store.patch_json(path, **fields) -> dict | None`, `store.create_inspection(handle, iid, source, fmt) -> Path`, `store.job_ids(request: dict) -> list[str]`, `store.sha256_file(path, *, progress, check_cancelled) -> str`, `store.CandidateWriter(cdir, geometry)` with `add_points`, `add_faces`, `add_runs(xyz, lengths)`, `close(**extra) -> dict`, `store.CandidateArrays(points, faces, runs, meta)`, `store.read_candidate(cdir) -> CandidateArrays`.
  - `thumbs.plan_thumbnail(points, out, *, size=160)`, `thumbs.shade_thumbnail(shade_u8, out, *, size=160)`.

- [ ] **Step 1: Write the failing unit tests**

`backend/tests/test_design_units.py`:

```python
"""Units and their factors (spec §2 Units, §5 steps 2-3, §15.3 Placement)."""

import pytest
from pyproj import CRS

from app.jobs.cancellation import JobFailure
from app.surfaces.design import admission, codes
from app.surfaces.design.units import (
    INSUNITS,
    LANDXML_UNITS,
    UNIT_LABEL,
    LinearUnit,
    UnsupportedCrsUnit,
    crs_axis_unit,
    unit_to_m,
    xy_scale,
)


def test_the_two_feet_differ_and_are_exact():
    assert unit_to_m("international_foot") == 0.3048
    assert unit_to_m("us_survey_foot") == 1200 / 3937
    z_int, z_us = 100 * unit_to_m("international_foot"), 100 * unit_to_m("us_survey_foot")
    assert z_int == pytest.approx(30.48, rel=1e-12)
    assert z_us == pytest.approx(30.480060960121920, rel=1e-12)
    assert abs(z_us - z_int) > 5e-5


def test_labels_spell_out_both_feet():
    assert UNIT_LABEL[LinearUnit.us_survey_foot] == "US survey foot (1200/3937 m)"
    assert UNIT_LABEL[LinearUnit.international_foot] == "International foot (0.3048 m)"


def test_crs_axis_units():
    assert crs_axis_unit(CRS.from_epsg(32639)) is LinearUnit.metre
    assert crs_axis_unit(CRS.from_epsg(2229)) is LinearUnit.us_survey_foot  # NAD83 / California zone 5 (ftUS)
    assert crs_axis_unit(CRS.from_epsg(2231)) is LinearUnit.us_survey_foot
    with pytest.raises(UnsupportedCrsUnit):
        crs_axis_unit(CRS.from_proj4("+proj=utm +zone=39 +datum=WGS84 +units=km"))


def test_xy_scale_mm_drawing_in_a_metric_crs():
    assert xy_scale("millimetre", CRS.from_epsg(32639)) == 0.001


def test_xy_scale_international_foot_into_a_us_foot_crs():
    assert xy_scale("international_foot", CRS.from_epsg(2229)) == pytest.approx(0.999998, abs=1e-9)


def test_xy_scale_is_exactly_one_for_equal_units():
    assert xy_scale("metre", CRS.from_epsg(32639)) == 1.0
    assert xy_scale("us_survey_foot", CRS.from_epsg(2229)) == 1.0


def test_xy_scale_is_one_for_a_geographic_crs():
    assert xy_scale("international_foot", CRS.from_epsg(4326)) == 1.0


def test_file_unit_maps():
    assert LANDXML_UNITS["meter"] is LinearUnit.metre
    assert LANDXML_UNITS["foot"] is LinearUnit.international_foot
    assert LANDXML_UNITS["USSurveyFoot"] is LinearUnit.us_survey_foot
    assert INSUNITS == {
        6: LinearUnit.metre,
        4: LinearUnit.millimetre,
        5: LinearUnit.centimetre,
        2: LinearUnit.international_foot,
        21: LinearUnit.us_survey_foot,
    }


def test_notes_round_trip():
    n = codes.warn("foot_ambiguity", "moves 1.2 m")
    assert n.to_json() == {"code": "foot_ambiguity", "level": "warn", "message": "moves 1.2 m"}
    assert codes.DesignNote.from_json(n.to_json()) == n


def test_admission_refuses_above_sixty_percent_of_free_ram():
    admission.admit(599, "x", "y", available=lambda: 1000)
    with pytest.raises(JobFailure, match="Choose a coarser cell"):
        admission.admit(601, "Rasterising", "Choose a coarser cell.", available=lambda: 1000)


def test_tin_bytes():
    assert admission.tin_bytes(1_000, 2_000) == 32 * 1_000 + 12 * 2_000
```

`backend/tests/test_design_store.py`:

```python
"""The inspection folder and the geometry cache (spec §3 Storage)."""

import numpy as np
import pytest
from PIL import Image

from app.errors import AppError
from app.surfaces.design import store, thumbs
from app.surfaces.design.inspection import candidate_from_meta


def test_candidate_cache_round_trip_faces(tmp_path):
    w = store.CandidateWriter(tmp_path / "c0", "faces")
    base = w.add_points(np.array([[500000.0, 2800000.0, 1.0], [500010.0, 2800000.0, 2.0]]))
    assert base == 0
    assert w.add_points([[500000.0, 2800010.0, 3.0]]) == 2
    w.add_faces([[0, 1, 2]])
    meta = w.close()
    assert meta["point_count"] == 3 and meta["face_count"] == 1
    assert meta["bbox"] == [500000.0, 2800000.0, 500010.0, 2800010.0]
    assert (meta["z_min"], meta["z_max"]) == (1.0, 3.0)
    a = store.read_candidate(tmp_path / "c0")
    assert a.points.shape == (3, 3) and a.points.dtype == np.float64
    assert a.faces.tolist() == [[0, 1, 2]] and a.faces.dtype == np.int32
    assert a.runs is None


def test_candidate_cache_runs(tmp_path):
    w = store.CandidateWriter(tmp_path / "c1", "points")
    w.add_runs(np.zeros((5, 3)), [2, 3])
    w.add_runs(np.ones((1, 3)), [1])  # a POINT is a run of 1
    meta = w.close()
    a = store.read_candidate(tmp_path / "c1")
    assert a.runs.tolist() == [0, 2, 5, 6]
    assert meta["run_count"] == 3 and a.faces is None


def test_empty_candidate(tmp_path):
    meta = store.CandidateWriter(tmp_path / "c2", "points").close()
    a = store.read_candidate(tmp_path / "c2")
    assert a.points.shape == (0, 3) and meta["bbox"] is None and meta["z_min"] is None
    c = candidate_from_meta("c2", "dxf_layer", "EMPTY", meta)
    assert c.bounds_file == [0.0, 0.0, 0.0, 0.0] and c.z_min is None


def test_inspection_ids_must_be_uuids(tmp_path):
    class H:
        folder = tmp_path

    for bad in ("..", "..\\..\\x", "abc", "C:/Windows"):
        with pytest.raises(AppError) as e:
            store.inspection_dir(H, bad)
        assert e.value.status == 404
    iid = store.new_id()
    assert store.inspection_dir(H, iid) == tmp_path / "cache" / "design-inspections" / iid


def test_write_json_is_a_no_op_after_delete(tmp_path):
    d = tmp_path / "gone"
    assert store.write_json(d / "inspection.json", {"state": "ready"}) is False
    assert not d.exists()
    assert store.patch_json(d / "inspection.json", state="failed") is None


def test_patch_json_merges(tmp_path):
    p = tmp_path / "x.json"
    store.write_json(p, {"a": 1, "b": 2})
    assert store.patch_json(p, b=3, c=4) == {"a": 1, "b": 3, "c": 4}
    assert store.read_json(p) == {"a": 1, "b": 3, "c": 4}


def test_create_inspection_writes_request_and_body(tmp_path):
    class H:
        folder = tmp_path / "proj"

    src = tmp_path / "site.xml"
    src.write_text("<LandXML/>")
    iid = store.new_id()
    d = store.create_inspection(H, iid, src, "landxml")
    req, body = store.read_json(d / "request.json"), store.read_json(d / "inspection.json")
    assert req["path"] == str(src) and req["preview_job_ids"] == [] and req["build_job_id"] is None
    assert body["state"] == "inspecting" and body["format"] == "landxml" and body["file_size"] == 10
    assert store.job_ids({**req, "inspect_job_id": "a", "preview_job_ids": ["b"], "build_job_id": "c"}) == [
        "a",
        "b",
        "c",
    ]


def test_sha256_is_streamed(tmp_path):
    import hashlib

    p = tmp_path / "f.bin"
    p.write_bytes(b"x" * 1000)
    seen = []
    digest = store.sha256_file(p, progress=seen.append, check_cancelled=lambda: None)
    assert digest == hashlib.sha256(b"x" * 1000).hexdigest() and seen[-1] == 1.0


def test_plan_thumbnail_is_at_most_160_px(tmp_path):
    rng = np.random.default_rng(0)
    pts = np.column_stack([rng.uniform(0, 400, 5000), rng.uniform(0, 100, 5000), rng.uniform(0, 5, 5000)])
    out = tmp_path / "thumbs" / "c0.png"
    thumbs.plan_thumbnail(pts + [500000, 2800000, 0], out)
    im = Image.open(out)
    assert max(im.size) == 160 and im.mode == "RGBA"


def test_shade_thumbnail_keeps_zero_transparent(tmp_path):
    shade = np.zeros((400, 800), np.uint8)
    shade[:, 400:] = 200
    out = tmp_path / "t.png"
    thumbs.shade_thumbnail(shade, out)
    im = np.asarray(Image.open(out))
    assert im.shape[1] == 160 and im[0, 0, 3] == 0 and im[0, -1, 3] == 255
```

- [ ] **Step 2: Run the tests to verify they fail**

Run from `backend`: `$PY -m pytest tests/test_design_units.py tests/test_design_store.py -v`
Expected: FAIL at collection with `ModuleNotFoundError: No module named 'app.surfaces.design.units'`.

- [ ] **Step 3: Write `units.py`**

```python
"""Linear units and their factors (spec §2 "Units" and "XY scaling", §5 steps 2-3).

The two feet are kept apart on purpose: they differ by 2 ppm, about a metre at State Plane
coordinates, so a plain "feet" choice would hide exactly the mistake the preview has to catch.
"""

from __future__ import annotations

from enum import StrEnum

from pyproj import CRS


class LinearUnit(StrEnum):
    millimetre = "millimetre"
    centimetre = "centimetre"
    metre = "metre"
    international_foot = "international_foot"
    us_survey_foot = "us_survey_foot"


_TO_M: dict[LinearUnit, float] = {
    LinearUnit.millimetre: 0.001,
    LinearUnit.centimetre: 0.01,
    LinearUnit.metre: 1.0,
    LinearUnit.international_foot: 0.3048,
    LinearUnit.us_survey_foot: 1200 / 3937,
}

UNIT_LABEL: dict[LinearUnit, str] = {
    LinearUnit.millimetre: "Millimetre",
    LinearUnit.centimetre: "Centimetre",
    LinearUnit.metre: "Metre",
    LinearUnit.international_foot: "International foot (0.3048 m)",
    LinearUnit.us_survey_foot: "US survey foot (1200/3937 m)",
}

FEET = frozenset({LinearUnit.international_foot, LinearUnit.us_survey_foot})

# LandXML <Metric linearUnit=...> / <Imperial linearUnit=...> (spec §5 defaults table).
LANDXML_UNITS: dict[str, LinearUnit] = {
    "meter": LinearUnit.metre,
    "metre": LinearUnit.metre,
    "millimeter": LinearUnit.millimetre,
    "millimetre": LinearUnit.millimetre,
    "centimeter": LinearUnit.centimetre,
    "centimetre": LinearUnit.centimetre,
    "foot": LinearUnit.international_foot,
    "USSurveyFoot": LinearUnit.us_survey_foot,
}

# DXF $INSUNITS codes the importer understands; 0 (unitless) is handled by the reader.
INSUNITS: dict[int, LinearUnit] = {
    6: LinearUnit.metre,
    4: LinearUnit.millimetre,
    5: LinearUnit.centimetre,
    2: LinearUnit.international_foot,
    21: LinearUnit.us_survey_foot,
}


class UnsupportedCrsUnit(ValueError):
    """The CRS axis unit is none of the five LinearUnits (the `unsupported_crs_unit` block)."""


def unit_to_m(unit: LinearUnit | str) -> float:
    return _TO_M[LinearUnit(unit)]


def unit_from_factor(factor: float) -> LinearUnit | None:
    """The unit whose metre factor equals `factor` to 1e-12 relative, else None."""
    for unit, to_m in _TO_M.items():
        if abs(factor - to_m) <= 1e-12 * to_m:
            return unit
    return None


def horizontal_crs(crs: CRS) -> CRS:
    """The horizontal part of a compound CRS; the CRS itself otherwise."""
    return crs.sub_crs_list[0] if crs.is_compound else crs


def crs_axis_unit(crs: CRS) -> LinearUnit:
    axis = horizontal_crs(crs).axis_info[0]
    unit = unit_from_factor(axis.unit_conversion_factor)
    if unit is None:
        raise UnsupportedCrsUnit(
            f"the CRS axis unit '{axis.unit_name}' is not metre, centimetre, millimetre, "
            "international foot or US survey foot"
        )
    return unit


def xy_scale(horizontal_unit: LinearUnit | str, crs: CRS) -> float:
    """XY_crs_units = XY_file * factor (spec §2). Exactly 1.0 when the units are the same member."""
    h = horizontal_crs(crs)
    if not h.is_projected:
        return 1.0
    crs_unit = crs_axis_unit(h)
    file_unit = LinearUnit(horizontal_unit)
    if file_unit is crs_unit:
        return 1.0
    return _TO_M[file_unit] / _TO_M[crs_unit]
```

- [ ] **Step 4: Write `codes.py`, `admission.py` and `inspection.py`**

`backend/app/surfaces/design/codes.py`:

```python
"""Warnings and candidate notes (spec §12 `DesignWarning`): a code, a level and a readable message."""

from __future__ import annotations

from dataclasses import asdict, dataclass
from typing import Literal

Level = Literal["info", "warn", "block"]


@dataclass(frozen=True)
class DesignNote:
    code: str
    level: Level
    message: str

    def to_json(self) -> dict:
        return asdict(self)

    @classmethod
    def from_json(cls, d: dict) -> DesignNote:
        return cls(d["code"], d["level"], d["message"])


def info(code: str, message: str) -> DesignNote:
    return DesignNote(code, "info", message)


def warn(code: str, message: str) -> DesignNote:
    return DesignNote(code, "warn", message)


def block(code: str, message: str) -> DesignNote:
    return DesignNote(code, "block", message)
```

`backend/app/surfaces/design/admission.py`:

```python
"""RAM admission before the heavy step of a phase (spec §4.3)."""

from __future__ import annotations

from collections.abc import Callable

import psutil

from app.jobs.cancellation import JobFailure

RAM_SHARE = 0.6
RASTERISE_BYTES = 100 * 2**20  # one 2048² float32 block, the written-mask and <= 64 MB batch buffers


def available_bytes() -> int:
    return int(psutil.virtual_memory().available)


def _fmt(n: int) -> str:
    return f"{n / 2**30:.1f} GB" if n >= 2**30 else f"{max(1, round(n / 2**20))} MB"


def admit(need: int, what: str, fix: str, *, available: Callable[[], int] | None = None) -> None:
    """Refuse with a JobFailure that states the need and the fix when `need` exceeds 60 % of free RAM."""
    limit = int(RAM_SHARE * (available or available_bytes)())
    if need > limit:
        raise JobFailure(
            f"{what} needs about {_fmt(need)} of memory, but only {_fmt(limit)} is safely free. {fix}"
        )


def tin_bytes(points: int, faces: int) -> int:
    return 32 * points + 12 * faces
```

`backend/app/surfaces/design/inspection.py`:

```python
"""What a reader returns from `inspect_file` (spec §12 `DesignDetected`, `DesignCandidate`)."""

from __future__ import annotations

from dataclasses import asdict, dataclass, field

from app.surfaces.design.codes import DesignNote


@dataclass
class Detected:
    horizontal_unit: str | None
    vertical_unit: str | None
    unit_source: str
    crs_wkt: str | None = None
    epsg: int | None = None
    crs_source: str | None = None
    crs_hint: str | None = None

    def to_json(self) -> dict:
        return asdict(self)


@dataclass
class Candidate:
    id: str
    kind: str  # dem | tin_surface | dxf_layer
    name: str
    geometry: str  # faces | points | raster | none
    bounds_file: list[float]
    z_min: float | None
    z_max: float | None
    point_count: int
    face_count: int
    entity_counts: dict[str, int] = field(default_factory=dict)
    default_selected: bool = False
    notes: list[DesignNote] = field(default_factory=list)
    raster: dict | None = None

    def to_json(self) -> dict:
        return asdict(self)


@dataclass
class InspectResult:
    detected: Detected
    candidates: list[Candidate]
    internal: dict = field(default_factory=dict)  # stored in internal.json, not in the contract body


def candidate_from_meta(cid: str, kind: str, name: str, meta: dict, **fields) -> Candidate:
    """A Candidate whose counts, bounds and z range come from a CandidateWriter's meta."""
    return Candidate(
        id=cid,
        kind=kind,
        name=name,
        geometry=fields.pop("geometry", meta["geometry"]),
        bounds_file=meta["bbox"] or [0.0, 0.0, 0.0, 0.0],
        z_min=meta["z_min"],
        z_max=meta["z_max"],
        point_count=meta["point_count"],
        face_count=meta["face_count"],
        **fields,
    )
```

- [ ] **Step 5: Write `store.py` and `thumbs.py`**

`backend/app/surfaces/design/store.py`:

```python
"""The inspection folder (spec §3 Storage): request, inspection and preview JSON, and the cache.

<project>/cache/design-inspections/<inspection_id>/
  request.json       path, job ids, created_at (written by the router only)
  inspection.json    the DesignInspection body; internal.json next to it
  cand/<cid>/        points.f64 (N x 3), faces.i32 (M x 3) or runs.i64 (K + 1), meta.json
  thumbs/<cid>.png
  previews/<pid>/    preview.json (the DesignPreview body), internal.json, preview.png

Every JSON write is atomic and goes through one lock, so the router and a job can patch disjoint
keys of the same file. A write into a folder that no longer exists is a no-op: a job that is still
running when the dialog deleted its inspection must not recreate the folder.
"""

from __future__ import annotations

import hashlib
import json
import os
import re
import threading
import uuid
from collections.abc import Callable, Iterable
from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path

import numpy as np

from app.errors import not_found

ID_RE = re.compile(r"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$")
HASH_CHUNK = 64 * 2**20
_LOCK = threading.RLock()


def inspections_root(handle) -> Path:
    return Path(handle.folder) / "cache" / "design-inspections"


def new_id() -> str:
    return str(uuid.uuid4())


def inspection_dir(handle, inspection_id: str) -> Path:
    """The folder of one inspection. Ids are UUIDs only, so a crafted id cannot leave the cache."""
    if not ID_RE.match(inspection_id or ""):
        raise not_found("design inspection", inspection_id)
    return inspections_root(handle) / inspection_id


def require_inspection(handle, inspection_id: str) -> Path:
    d = inspection_dir(handle, inspection_id)
    if not (d / "inspection.json").is_file():
        raise not_found("design inspection", inspection_id)
    return d


def preview_dir(idir: Path, preview_id: str) -> Path:
    if not ID_RE.match(preview_id or ""):
        raise not_found("design preview", preview_id)
    return idir / "previews" / preview_id


def require_preview(idir: Path, preview_id: str) -> Path:
    d = preview_dir(idir, preview_id)
    if not (d / "preview.json").is_file():
        raise not_found("design preview", preview_id)
    return d


def candidate_dir(idir: Path, cid: str) -> Path:
    return idir / "cand" / cid


def thumb_path(idir: Path, cid: str) -> Path:
    return idir / "thumbs" / f"{cid}.png"


def read_json(path: Path) -> dict:
    return json.loads(Path(path).read_text("utf-8"))


def write_json(path: Path, data: dict) -> bool:
    """Atomic write; False (and nothing written) when the parent folder is gone."""
    path = Path(path)
    with _LOCK:
        if not path.parent.is_dir():
            return False
        tmp = path.with_name(path.name + ".tmp")
        tmp.write_text(json.dumps(data, indent=2, default=str), "utf-8")
        os.replace(tmp, path)
        return True


def patch_json(path: Path, **fields) -> dict | None:
    """Merge `fields` into a JSON file under the lock; None when the file is gone."""
    path = Path(path)
    with _LOCK:
        if not path.is_file():
            return None
        data = read_json(path)
        data.update(fields)
        write_json(path, data)
        return data


def create_inspection(handle, inspection_id: str, source: Path, fmt: str) -> Path:
    d = inspection_dir(handle, inspection_id)
    d.mkdir(parents=True)
    now = datetime.now(UTC).isoformat()
    write_json(
        d / "request.json",
        {
            "path": str(source),
            "created_at": now,
            "inspect_job_id": None,
            "preview_job_ids": [],
            "latest_preview_id": None,
            "latest_preview_job_id": None,
            "build_job_id": None,
            "surface_id": None,
        },
    )
    write_json(
        d / "inspection.json",
        {
            "id": inspection_id,
            "state": "inspecting",
            "error": None,
            "job_id": "",
            "path": str(source),
            "format": fmt,
            "file_size": source.stat().st_size,
            "sha256": None,
            "detected": None,
            "candidates": [],
            "default_target_surface_id": None,
            "created_at": now,
        },
    )
    return d


def job_ids(request: dict) -> list[str]:
    ids = [request.get("inspect_job_id"), *request.get("preview_job_ids", []), request.get("build_job_id")]
    return [i for i in ids if i]


def sha256_file(path: Path, *, progress: Callable[[float], None], check_cancelled: Callable[[], None]) -> str:
    digest, size, done = hashlib.sha256(), max(Path(path).stat().st_size, 1), 0
    with Path(path).open("rb") as f:
        while chunk := f.read(HASH_CHUNK):
            check_cancelled()
            digest.update(chunk)
            done += len(chunk)
            progress(min(1.0, done / size))
    progress(1.0)
    return digest.hexdigest()


class CandidateWriter:
    """Appends one candidate's geometry to cand/<cid>/ in file units, x = easting (spec §3)."""

    def __init__(self, cdir: Path, geometry: str):
        cdir.mkdir(parents=True, exist_ok=True)
        self.cdir, self.geometry = cdir, geometry
        self._points = (cdir / "points.f64").open("wb")
        self._faces = (cdir / "faces.i32").open("wb") if geometry == "faces" else None
        self._runs = (cdir / "runs.i64").open("wb") if geometry == "points" else None
        if self._runs is not None:
            self._runs.write(np.zeros(1, np.int64).tobytes())
        self.point_count = self.face_count = self.run_count = 0
        self._lo = np.full(3, np.inf)
        self._hi = np.full(3, -np.inf)

    def add_points(self, xyz) -> int:
        """Append vertices; returns the index of the first one."""
        a = np.ascontiguousarray(xyz, dtype=np.float64).reshape(-1, 3)
        base = self.point_count
        if len(a):
            self._points.write(a.tobytes())
            self.point_count += len(a)
            self._lo = np.minimum(self._lo, a.min(0))
            self._hi = np.maximum(self._hi, a.max(0))
        return base

    def add_faces(self, tri) -> None:
        a = np.ascontiguousarray(tri, dtype=np.int32).reshape(-1, 3)
        self._faces.write(a.tobytes())
        self.face_count += len(a)

    def add_runs(self, xyz, lengths: Iterable[int]) -> None:
        """Append vertex runs (a polyline, a LINE, a POINT) whose sizes are `lengths`."""
        lengths = np.asarray(list(lengths) if not isinstance(lengths, np.ndarray) else lengths, np.int64)
        base = self.point_count
        self.add_points(xyz)
        if len(lengths):
            self._runs.write((base + np.cumsum(lengths)).astype(np.int64).tobytes())
            self.run_count += len(lengths)

    def close(self, **extra) -> dict:
        for f in (self._points, self._faces, self._runs):
            if f is not None:
                f.close()
        has = self.point_count > 0
        meta = {
            "geometry": self.geometry,
            "point_count": self.point_count,
            "face_count": self.face_count,
            "run_count": self.run_count,
            "bbox": [float(self._lo[0]), float(self._lo[1]), float(self._hi[0]), float(self._hi[1])]
            if has
            else None,
            "z_min": float(self._lo[2]) if has else None,
            "z_max": float(self._hi[2]) if has else None,
            **extra,
        }
        write_json(self.cdir / "meta.json", meta)
        return meta


@dataclass
class CandidateArrays:
    points: np.ndarray  # (N, 3) float64, memory-mapped
    faces: np.ndarray | None  # (M, 3) int32
    runs: np.ndarray | None  # (K + 1,) int64
    meta: dict


def _map(path: Path, dtype, cols: int) -> np.ndarray:
    itemsize = np.dtype(dtype).itemsize * cols
    n = path.stat().st_size // itemsize
    shape = (n, cols) if cols > 1 else (n,)
    if n == 0:
        return np.zeros(shape, dtype)
    return np.memmap(path, dtype=dtype, mode="r", shape=shape)


def read_candidate(cdir: Path) -> CandidateArrays:
    """Memory-map a cached candidate. On Windows a live memmap keeps the file open: drop the arrays
    (and `gc.collect()`) before deleting the inspection folder."""
    faces, runs = cdir / "faces.i32", cdir / "runs.i64"
    return CandidateArrays(
        points=_map(cdir / "points.f64", np.float64, 3),
        faces=_map(faces, np.int32, 3) if faces.is_file() else None,
        runs=_map(runs, np.int64, 1) if runs.is_file() else None,
        meta=read_json(cdir / "meta.json"),
    )
```

`backend/app/surfaces/design/thumbs.py`:

```python
"""160 px plan-view thumbnails of candidates (spec §3 `thumbs/<cid>.png`)."""

from __future__ import annotations

from pathlib import Path

import numpy as np
from PIL import Image

MAX_POINTS = 200_000


def plan_thumbnail(points: np.ndarray, out: Path, *, size: int = 160) -> None:
    """Vertices drawn as pixels, grey by height, on a transparent square-scaled canvas."""
    n = len(points)
    if n == 0:
        return
    p = np.asarray(points[:: max(1, n // MAX_POINTS)], dtype=np.float64)
    x, y, z = p[:, 0], p[:, 1], p[:, 2]
    w, h = max(float(x.max() - x.min()), 1e-9), max(float(y.max() - y.min()), 1e-9)
    scale = (size - 1) / max(w, h)
    width, height = int(round(w * scale)) + 1, int(round(h * scale)) + 1
    cols = np.clip(np.round((x - x.min()) * scale).astype(int), 0, width - 1)
    rows = np.clip(np.round((y.max() - y) * scale).astype(int), 0, height - 1)
    zr = float(z.max() - z.min())
    shade = (90 + (165 * (z - z.min()) / zr if zr > 0 else 0 * z)).astype(np.uint8)
    img = np.zeros((height, width, 4), np.uint8)
    img[rows, cols, 0] = img[rows, cols, 1] = img[rows, cols, 2] = shade
    img[rows, cols, 3] = 255
    out.parent.mkdir(parents=True, exist_ok=True)
    Image.fromarray(img, "RGBA").save(out)


def shade_thumbnail(shade: np.ndarray, out: Path, *, size: int = 160) -> None:
    """A grid.hillshade result (0 = no data) as a transparent-where-empty thumbnail."""
    rgba = np.zeros((*shade.shape, 4), np.uint8)
    rgba[..., 0] = rgba[..., 1] = rgba[..., 2] = shade
    rgba[..., 3] = np.where(shade > 0, 255, 0)
    im = Image.fromarray(rgba, "RGBA")
    im.thumbnail((size, size), Image.Resampling.BILINEAR)
    out.parent.mkdir(parents=True, exist_ok=True)
    im.save(out)
```

- [ ] **Step 6: Run the tests to verify they pass**

Run from `backend`: `$PY -m pytest tests/test_design_units.py tests/test_design_store.py -v`
Expected: PASS (all). Then `$PY -m ruff check app/surfaces/design tests/test_design_units.py tests/test_design_store.py` and `$PY -m ruff format --check app/surfaces/design tests` clean (run `ruff format` on the new files if not).

- [ ] **Step 7: Commit**

```
git add backend/app/surfaces/design/units.py backend/app/surfaces/design/codes.py backend/app/surfaces/design/admission.py backend/app/surfaces/design/inspection.py backend/app/surfaces/design/store.py backend/app/surfaces/design/thumbs.py backend/tests/test_design_units.py backend/tests/test_design_store.py
git commit -m "feat(design): units, notes, admission and the inspection cache" -m "Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: The TIN rasteriser and the analytic fixtures

**Files:**
- Create: `backend/app/surfaces/design/rasterise.py`, `backend/tests/designs.py`
- Test: `backend/tests/test_design_rasterise.py`
- Create: `vault/decisions/2026-09-24-gotcha-barycentric-origin-decides-seams.md`

**Interfaces:**
- Consumes: nothing from S3; numpy, scipy (tests only), `rasterio.windows.Window`.
- Produces:
  - `rasterise.SimpleLattice(x0, y0, cell_size, width, height)` (frozen dataclass; `grid.GridSpec` has the same attributes and is accepted wherever a lattice is).
  - `rasterise.RasterStats(triangles, degenerate_triangles, empty_triangles, overlapping_triangles)`.
  - `rasterise.TinRasteriser(vertices: (N,3) float64, triangles: (M,3) int32, lattice, *, side: int, check_cancelled=None)` with `rasterise_window(window: Window) -> np.ndarray | None` (float32 (h, w), NaN = no data; `window` must be the `side`-block at (row_off // side, col_off // side)) and `stats() -> RasterStats`.
  - `rasterise.rasterise_to_array(vertices, triangles, lattice, *, check_cancelled=None) -> tuple[np.ndarray, RasterStats]` (whole lattice in one window; for the preview grid ≤ 1024²).
  - `tests/designs.py`: `E0 = 500_000.0`, `N0 = 2_800_000.0`, `plane_z(x, y)`, `two_triangle_plane(size=100.0)`, `random_plane_tin(n_points=2_600, seed=0)`, `pyramid_tin()`, `pyramid_z(x, y)`, `cone_tin()`, `cone_z(x, y)`, `CONE_CENTRE`, `lattice_over(bounds, cell)`.

- [ ] **Step 1: Write the fixtures module**

`backend/tests/designs.py`:

```python
"""Analytic design surfaces for the S3 tests (spec §15.1). Real UTM magnitudes on purpose, so float
cancellation is exercised: E ~ 500 000, N ~ 2 800 000."""

from __future__ import annotations

import math

import numpy as np
from scipy.spatial import Delaunay

from app.surfaces.design.rasterise import SimpleLattice

E0 = 500_000.0
N0 = 2_800_000.0
CONE_CENTRE = (E0 + 50.0, N0 + 50.0)


def plane_z(x, y):
    return 10.0 + 0.02 * (np.asarray(x) - E0) - 0.01 * (np.asarray(y) - N0)


def _with_z(xy: np.ndarray, fn) -> np.ndarray:
    return np.column_stack([xy[:, 0], xy[:, 1], fn(xy[:, 0], xy[:, 1])])


def two_triangle_plane(size: float = 100.0) -> tuple[np.ndarray, np.ndarray]:
    xy = np.array([[E0, N0], [E0 + size, N0], [E0 + size, N0 + size], [E0, N0 + size]])
    return _with_z(xy, plane_z), np.array([[0, 1, 2], [0, 2, 3]], np.int32)


def random_plane_tin(n_points: int = 2_600, seed: int = 0, size: float = 100.0):
    """About 5 000 random triangles over the same square as two_triangle_plane."""
    rng = np.random.default_rng(seed)
    corners = np.array([[0, 0], [size, 0], [size, size], [0, size]], float)
    xy = np.vstack([corners, rng.uniform(0, size, (n_points - 4, 2))]) + [E0, N0]
    tri = Delaunay(xy - [E0, N0])
    return _with_z(xy, plane_z), tri.simplices.astype(np.int32)


def pyramid_z(x, y):
    dx, dy = np.asarray(x) - (E0 + 20.0), np.asarray(y) - (N0 + 20.0)
    return 10.0 * (1.0 - np.maximum(np.abs(dx), np.abs(dy)) / 20.0)


def pyramid_tin():
    """A 40 x 40 base, apex 10 m: four planar faces. Volume 40 * 40 * 10 / 3 = 5 333.3 m³."""
    v = np.array(
        [[E0, N0, 0], [E0 + 40, N0, 0], [E0 + 40, N0 + 40, 0], [E0, N0 + 40, 0], [E0 + 20, N0 + 20, 10]],
        float,
    )
    return v, np.array([[0, 1, 4], [1, 2, 4], [2, 3, 4], [3, 0, 4]], np.int32)


def cone_z(x, y):
    r = np.hypot(np.asarray(x) - CONE_CENTRE[0], np.asarray(y) - CONE_CENTRE[1])
    return 20.0 - 0.5 * r


def cone_tin(ring_step: float = 0.5, sectors: int = 128, radius: float = 40.0):
    """z = 20 - 0.5 r, r <= 40, as a polar TIN (Delaunay of the centre and the ring vertices).
    Returns (vertices, triangles, delaunay) so a test can hand the same triangles to scipy."""
    rings = np.arange(ring_step, radius + 1e-9, ring_step)
    ang = np.linspace(0, 2 * math.pi, sectors, endpoint=False)
    xy = [np.zeros((1, 2))]
    for r in rings:
        xy.append(np.column_stack([r * np.cos(ang), r * np.sin(ang)]))
    local = np.vstack(xy)
    tri = Delaunay(local)
    xy_abs = local + CONE_CENTRE
    return _with_z(xy_abs, cone_z), tri.simplices.astype(np.int32), tri


def lattice_over(bounds: tuple[float, float, float, float], cell: float) -> SimpleLattice:
    """An aligned lattice (origin on multiples of `cell`) covering `bounds`, as grid.aligned_grid makes."""
    minx, miny, maxx, maxy = bounds
    x0 = math.floor(round(minx / cell, 9)) * cell
    y0 = math.ceil(round(maxy / cell, 9)) * cell
    return SimpleLattice(x0, y0, cell, int((maxx - x0) // cell) + 1, int((y0 - miny) // cell) + 1)
```

- [ ] **Step 2: Write the failing tests**

`backend/tests/test_design_rasterise.py`:

```python
"""The TIN rasteriser against closed forms (spec §15.1, §15.2, §16.1, §16.6)."""

import math
import tracemalloc

import numpy as np
import pytest
from designs import (
    CONE_CENTRE,
    E0,
    N0,
    cone_tin,
    cone_z,
    lattice_over,
    plane_z,
    pyramid_tin,
    pyramid_z,
    random_plane_tin,
    two_triangle_plane,
)
from rasterio.windows import Window
from scipy.interpolate import LinearNDInterpolator

from app.surfaces.design.rasterise import SimpleLattice, TinRasteriser, rasterise_to_array


def centres(lat):
    cols, rows = np.meshgrid(np.arange(lat.width), np.arange(lat.height))
    return lat.x0 + (cols + 0.5) * lat.cell_size, lat.y0 - (rows + 0.5) * lat.cell_size


def run_windows(v, t, lat, side):
    r = TinRasteriser(v, t, lat, side=side)
    out = np.full((lat.height, lat.width), np.nan, np.float32)
    for r0 in range(0, lat.height, side):
        for c0 in range(0, lat.width, side):
            w = Window(c0, r0, min(side, lat.width - c0), min(side, lat.height - r0))
            a = r.rasterise_window(w)
            if a is not None:
                out[r0 : r0 + w.height, c0 : c0 + w.width] = a
    return out, r.stats()


@pytest.mark.parametrize("tin", [two_triangle_plane, random_plane_tin])
def test_plane_is_exact_and_crack_free(tin):
    v, t = tin()
    lat = SimpleLattice(E0, N0 + 100, 1.0, 100, 100)
    out, stats = rasterise_to_array(v, t, lat)
    x, y = centres(lat)
    assert np.isfinite(out).all()  # every centre of the square is covered: no cracks on shared edges
    assert np.abs(out - plane_z(x, y)).max() < 1e-4
    assert stats.overlapping_triangles == 0


def test_pyramid_heights_and_volume():
    v, t = pyramid_tin()
    lat = lattice_over((E0, N0, E0 + 40, N0 + 40), 0.25)
    out, _ = rasterise_to_array(v, t, lat)
    x, y = centres(lat)
    ok = np.isfinite(out)
    assert np.abs(out[ok] - pyramid_z(x, y)[ok]).max() < 1e-4
    assert np.nansum(out) * 0.25**2 == pytest.approx(40 * 40 * 10 / 3, rel=0.005)


def test_cone_matches_linear_interpolation_and_closed_form():
    v, t, tri = cone_tin()
    lat = lattice_over(
        (CONE_CENTRE[0] - 40, CONE_CENTRE[1] - 40, CONE_CENTRE[0] + 40, CONE_CENTRE[1] + 40), 0.5
    )
    out, _ = rasterise_to_array(v, t, lat)
    x, y = centres(lat)
    oracle = LinearNDInterpolator(tri, v[:, 2])(x - CONE_CENTRE[0], y - CONE_CENTRE[1])
    both = np.isfinite(out) & np.isfinite(oracle)
    assert both.sum() > 0.7 * out.size
    assert np.abs(out[both] - oracle[both]).max() < 1e-4
    assert np.abs(out[both] - cone_z(x, y)[both]).max() < 0.05
    assert np.nansum(out) * 0.25 == pytest.approx(math.pi * 40**2 * 20 / 3, rel=0.01)


def test_a_triangle_across_nine_blocks_is_bit_identical_to_one_block():
    lat = SimpleLattice(E0, N0 + 192, 1.0, 192, 192)
    v = np.array([[E0 + 3, N0 + 2, 5.0], [E0 + 190, N0 + 30, 9.0], [E0 + 40, N0 + 189, 1.0]])
    t = np.array([[0, 1, 2]], np.int32)
    tiled, _ = run_windows(v, t, lat, 64)
    whole, _ = run_windows(v, t, lat, 192)
    assert np.array_equal(tiled, whole, equal_nan=True)
    assert np.isfinite(whole).sum() > 10_000


def test_many_triangles_across_uneven_blocks_leave_no_seams():
    v, t = random_plane_tin()
    lat = SimpleLattice(E0, N0 + 100, 0.5, 200, 200)
    tiled, _ = run_windows(v, t, lat, 64)  # 200 is not a multiple of 64: edge windows are narrower
    whole, _ = rasterise_to_array(v, t, lat)
    assert np.isfinite(tiled).all()
    np.testing.assert_allclose(tiled, whole, atol=1e-6)


def test_degenerate_and_sub_cell_triangles_are_counted_and_dropped():
    v, t = two_triangle_plane()
    extra = np.array(
        [
            [E0 + 10, N0 + 10, 1.0],
            [E0 + 20, N0 + 20, 1.0],
            [E0 + 30, N0 + 30, 1.0],  # collinear: degenerate
            [E0 + 50.1, N0 + 50.1, 1.0],
            [E0 + 50.2, N0 + 50.1, 1.0],
            [E0 + 50.1, N0 + 50.2, 1.0],  # between cell centres: covers none
        ]
    )
    v2 = np.vstack([v, extra])
    t2 = np.vstack([t, [[4, 5, 6], [7, 8, 9]]]).astype(np.int32)
    lat = SimpleLattice(E0, N0 + 100, 1.0, 100, 100)
    out, stats = rasterise_to_array(v2, t2, lat)
    assert stats.degenerate_triangles == 1 and stats.empty_triangles == 1
    x, y = centres(lat)
    assert np.abs(out - plane_z(x, y)).max() < 1e-4  # neither extra triangle wrote anything


def test_a_folded_tin_reports_overlapping_triangles():
    v, t = two_triangle_plane()
    lifted = v.copy()
    lifted[:, 2] += 1.0
    v2 = np.vstack([v, lifted])
    t2 = np.vstack([t, t + 4]).astype(np.int32)
    _, stats = rasterise_to_array(v2, t2, SimpleLattice(E0, N0 + 100, 1.0, 100, 100))
    assert stats.overlapping_triangles == 2


def test_a_window_off_the_block_lattice_is_refused():
    v, t = two_triangle_plane()
    r = TinRasteriser(v, t, SimpleLattice(E0, N0 + 100, 1.0, 100, 100), side=64)
    with pytest.raises(ValueError, match="not one of the 64-cell blocks"):
        r.rasterise_window(Window(10, 0, 64, 64))


def test_empty_windows_return_none():
    v, t = two_triangle_plane(size=10)
    r = TinRasteriser(v, t, SimpleLattice(E0, N0 + 100, 1.0, 128, 100), side=64)
    assert r.rasterise_window(Window(64, 0, 64, 64)) is None


def test_memory_of_a_million_triangles_stays_within_the_arrays_plus_150_mb():
    n = 708
    g = np.arange(n) * 2.0
    xx, yy = np.meshgrid(g + E0, g + N0)
    v = np.column_stack([xx.ravel(), yy.ravel(), plane_z(xx.ravel(), yy.ravel())])
    i = np.arange(n - 1)
    a = (i[:, None] * n + i[None, :]).ravel()
    t = np.vstack([np.column_stack([a, a + 1, a + n + 1]), np.column_stack([a, a + n + 1, a + n])]).astype(
        np.int32
    )
    assert len(t) > 999_000
    lat = lattice_over((E0, N0, E0 + g[-1], N0 + g[-1]), 1.0)
    tracemalloc.start()
    base = tracemalloc.get_traced_memory()[0]
    r = TinRasteriser(v, t, lat, side=512)
    for r0 in range(0, lat.height, 512):
        for c0 in range(0, lat.width, 512):
            r.rasterise_window(Window(c0, r0, min(512, lat.width - c0), min(512, lat.height - r0)))
    peak = tracemalloc.get_traced_memory()[1] - base
    tracemalloc.stop()
    assert peak < 150 * 2**20, f"peak {peak / 2**20:.0f} MB beyond the TIN arrays"
```

- [ ] **Step 3: Run the tests to verify they fail**

Run from `backend`: `$PY -m pytest tests/test_design_rasterise.py -v`
Expected: FAIL at collection with `ModuleNotFoundError: No module named 'app.surfaces.design.rasterise'`.

- [ ] **Step 4: Write `rasterise.py`**

```python
"""The TIN rasteriser (spec §9.2): a numpy barycentric scan over cell centres, window by window.

Pure: numpy and rasterio.windows only; it never imports app.surfaces.grid. The build passes a
grid.GridSpec (it has the Lattice attributes) and the windows of grid.read_windows(spec).

Barycentrics are computed relative to each triangle's first vertex (not the window origin, as the
spec's §9.2 first said): the float result at a cell is then the same whichever window computed it,
so tiled output is bit-identical to a single-window run (ADR 2026-09-24 barycentric origin), and
the small relative coordinates avoid cancellation at UTM magnitudes.
"""

from __future__ import annotations

from collections.abc import Callable
from dataclasses import dataclass
from typing import Protocol

import numpy as np
from rasterio.windows import Window

SMALL = 8  # triangles whose clipped range fits in SMALL x SMALL cells are scanned in batches
BATCH = 16_384  # <= the spec's 65 536; keeps the (n, 8, 8) float64 temporaries near 8 MB each
CHUNK_CELLS = 4_000_000
RANGE_CHUNK = 262_144
INSIDE_EPS = -1e-9
OVERLAP_DZ = 1e-3
DEGENERATE_REL = 1e-12
_STEPS = np.arange(SMALL)


class Lattice(Protocol):
    x0: float
    y0: float
    cell_size: float
    width: int
    height: int


@dataclass(frozen=True)
class SimpleLattice:
    x0: float
    y0: float
    cell_size: float
    width: int
    height: int


@dataclass(frozen=True)
class RasterStats:
    triangles: int
    degenerate_triangles: int
    empty_triangles: int
    overlapping_triangles: int


class TinRasteriser:
    """Bins triangles to the `side`-cell blocks of `lattice`, then rasterises one block on request."""

    def __init__(
        self,
        vertices,
        triangles,
        lattice: Lattice,
        *,
        side: int,
        check_cancelled: Callable[[], None] | None = None,
    ):
        self.v = np.asarray(vertices, dtype=np.float64)
        self.t = triangles
        self.lat = lattice
        self.side = int(side)
        self._check = check_cancelled or (lambda: None)
        self._degenerate = 0
        self._empty = 0
        self._index()
        self._overlap = np.zeros(len(self.ids), dtype=bool)

    # -- indexing -------------------------------------------------------------------------------
    def _index(self) -> None:
        x0, y0, c = self.lat.x0, self.lat.y0, self.lat.cell_size
        w, h = self.lat.width, self.lat.height
        ids, ranges = [], []
        for s in range(0, len(self.t), RANGE_CHUNK):
            self._check()
            tri = np.asarray(self.t[s : s + RANGE_CHUNK], dtype=np.int64)
            xs, ys = self.v[tri, 0], self.v[tri, 1]
            minx, maxx, miny, maxy = xs.min(1), xs.max(1), ys.min(1), ys.max(1)
            ex, ey = xs[:, 1:] - xs[:, :1], ys[:, 1:] - ys[:, :1]
            area2 = np.abs(ex[:, 0] * ey[:, 1] - ex[:, 1] * ey[:, 0])
            diag2 = (maxx - minx) ** 2 + (maxy - miny) ** 2
            degenerate = (diag2 == 0) | (0.5 * area2 < DEGENERATE_REL * diag2)
            c0 = np.maximum(np.ceil((minx - x0) / c - 0.5), 0)
            c1 = np.minimum(np.floor((maxx - x0) / c - 0.5), w - 1)
            r0 = np.maximum(np.ceil((y0 - maxy) / c - 0.5), 0)
            r1 = np.minimum(np.floor((y0 - miny) / c - 0.5), h - 1)
            empty = ~degenerate & ((c0 > c1) | (r0 > r1))
            keep = ~degenerate & ~empty
            self._degenerate += int(degenerate.sum())
            self._empty += int(empty.sum())
            ids.append(np.flatnonzero(keep).astype(np.int64) + s)
            ranges.append(np.stack([r0[keep], r1[keep], c0[keep], c1[keep]], 1).astype(np.int32))
        self.ids = np.concatenate(ids) if ids else np.zeros(0, np.int64)
        self.rng = np.concatenate(ranges) if ranges else np.zeros((0, 4), np.int32)
        side = self.side
        self.nbx = -(-w // side)
        nblocks = self.nbx * -(-h // side)
        br0, br1 = self.rng[:, 0] // side, self.rng[:, 1] // side
        bc0, bc1 = self.rng[:, 2] // side, self.rng[:, 3] // side
        nbc = (bc1 - bc0 + 1).astype(np.int64)
        per = (br1 - br0 + 1).astype(np.int64) * nbc
        # One (block, triangle) pair per block a triangle's cell range reaches: a triangle that
        # spans several blocks appears in each (spec §9.2 step 2).
        pos = np.repeat(np.arange(len(per), dtype=np.int64), per)
        k = np.arange(len(pos), dtype=np.int64) - np.repeat(np.cumsum(per) - per, per)
        nbc_r = np.repeat(nbc, per)
        block = (
            (np.repeat(br0.astype(np.int64), per) + k // nbc_r) * self.nbx
            + np.repeat(bc0.astype(np.int64), per)
            + k % nbc_r
        )
        del k, nbc_r
        order = np.argsort(block, kind="stable")  # stable: triangle order is kept inside a block
        self._pairs = pos[order]
        self._offsets = np.concatenate([[0], np.cumsum(np.bincount(block, minlength=nblocks))])

    # -- rasterising ------------------------------------------------------------------------------
    def rasterise_window(self, window: Window) -> np.ndarray | None:
        side = self.side
        r_off, c_off = int(window.row_off), int(window.col_off)
        hh, ww = int(window.height), int(window.width)
        if r_off % side or c_off % side or hh > side or ww > side:
            raise ValueError(f"window {window} is not one of the {side}-cell blocks")
        b = (r_off // side) * self.nbx + c_off // side
        if b + 1 >= len(self._offsets):
            return None
        sel = self._pairs[self._offsets[b] : self._offsets[b + 1]]
        if sel.size == 0:
            return None
        rng = self.rng[sel]
        cr0, cr1 = np.maximum(rng[:, 0], r_off), np.minimum(rng[:, 1], r_off + hh - 1)
        cc0, cc1 = np.maximum(rng[:, 2], c_off), np.minimum(rng[:, 3], c_off + ww - 1)
        out = np.full((hh, ww), np.nan, np.float32)
        hit = np.zeros((hh, ww), bool)
        small = ((cr1 - cr0) < SMALL) & ((cc1 - cc0) < SMALL)
        idx = np.flatnonzero(small)
        for s in range(0, len(idx), BATCH):
            self._check()
            part = idx[s : s + BATCH]
            self._small(sel[part], cr0[part], cr1[part], cc0[part], cc1[part], out, hit, r_off, c_off)
        for i in np.flatnonzero(~small):
            self._check()
            self._large(
                int(sel[i]), int(cr0[i]), int(cr1[i]), int(cc0[i]), int(cc1[i]), out, hit, r_off, c_off
            )
        return out if hit.any() else None

    def stats(self) -> RasterStats:
        return RasterStats(len(self.t), self._degenerate, self._empty, int(self._overlap.sum()))

    def _verts(self, pos: np.ndarray) -> np.ndarray:
        tri = np.asarray(self.t[self.ids[pos]], dtype=np.int64)
        return self.v[tri]  # (n, 3 vertices, 3 coords)

    def _bary(self, tv: np.ndarray, rows: np.ndarray, cols: np.ndarray):
        """z and inside at the centres (rows, cols), both broadcast against (n, ...)."""
        lat = self.lat
        e = (slice(None),) + (None,) * (rows.ndim - 1)
        ax, ay, az = tv[:, 0, 0][e], tv[:, 0, 1][e], tv[:, 0, 2][e]
        bx, by = tv[:, 1, 0][e] - ax, tv[:, 1, 1][e] - ay
        cx, cy = tv[:, 2, 0][e] - ax, tv[:, 2, 1][e] - ay
        px = (cols + 0.5) * lat.cell_size + (lat.x0 - ax)
        py = (lat.y0 - ay) - (rows + 0.5) * lat.cell_size
        det = bx * cy - cx * by
        l1 = (px * cy - cx * py) / det
        l2 = (bx * py - px * by) / det
        l0 = 1.0 - l1 - l2
        inside = (l0 >= INSIDE_EPS) & (l1 >= INSIDE_EPS) & (l2 >= INSIDE_EPS)
        return l0 * az + l1 * tv[:, 1, 2][e] + l2 * tv[:, 2, 2][e], inside

    def _small(self, pos, r0, r1, c0, c1, out, hit, r_off, c_off) -> None:
        tv = self._verts(pos)
        rows = (r0[:, None, None] + _STEPS[None, :, None]).astype(np.float64)
        cols = (c0[:, None, None] + _STEPS[None, None, :]).astype(np.float64)
        z, inside = self._bary(tv, rows, cols)
        m = inside & (rows <= r1[:, None, None]) & (cols <= c1[:, None, None])
        rr = np.broadcast_to(rows, m.shape)[m].astype(np.int64) - r_off
        cc = np.broadcast_to(cols, m.shape)[m].astype(np.int64) - c_off
        self._write(out, hit, rr, cc, z[m], np.broadcast_to(pos[:, None, None], m.shape)[m])

    def _large(self, pos, r0, r1, c0, c1, out, hit, r_off, c_off) -> None:
        tv = self._verts(np.array([pos]))
        cols = np.arange(c0, c1 + 1, dtype=np.float64)[None, None, :]
        step = max(1, CHUNK_CELLS // (c1 - c0 + 1))
        for ra in range(r0, r1 + 1, step):
            self._check()
            rows = np.arange(ra, min(ra + step, r1 + 1), dtype=np.float64)[None, :, None]
            z, inside = self._bary(tv, rows, cols)
            rr, cc = np.nonzero(inside[0])
            self._write(out, hit, rr + (ra - r_off), cc + (c0 - c_off), z[0][rr, cc], np.full(len(rr), pos))

    def _write(self, out, hit, rr, cc, z, pos) -> None:
        """Last write wins, in triangle order; a rewrite that moves a cell by > 1 mm marks overlap."""
        if rr.size == 0:
            return
        lin = rr.astype(np.int64) * out.shape[1] + cc
        order = np.argsort(lin, kind="stable")
        lin, z, pos = lin[order], z[order], pos[order]
        same = lin[1:] == lin[:-1]
        self._overlap[pos[1:][same & (np.abs(z[1:] - z[:-1]) > OVERLAP_DZ)]] = True
        flat_out, flat_hit = out.reshape(-1), hit.reshape(-1)
        self._overlap[pos[flat_hit[lin] & (np.abs(flat_out[lin] - z) > OVERLAP_DZ)]] = True
        last = np.ones(lin.size, bool)
        last[:-1] = ~same
        flat_out[lin[last]] = z[last]
        flat_hit[lin[last]] = True


def rasterise_to_array(
    vertices, triangles, lattice: Lattice, *, check_cancelled: Callable[[], None] | None = None
) -> tuple[np.ndarray, RasterStats]:
    """The whole lattice as one window (the preview grid, at most 1024 per side)."""
    if max(lattice.width, lattice.height) > 1024:
        raise ValueError("rasterise_to_array is for preview grids; use TinRasteriser windows")
    r = TinRasteriser(
        vertices, triangles, lattice, side=max(lattice.width, lattice.height), check_cancelled=check_cancelled
    )
    out = r.rasterise_window(Window(0, 0, lattice.width, lattice.height))
    if out is None:
        out = np.full((lattice.height, lattice.width), np.nan, np.float32)
    return out, r.stats()
```

- [ ] **Step 5: Run the tests to verify they pass**

Run from `backend`: `$PY -m pytest tests/test_design_rasterise.py -v`
Expected: PASS (11 tests; the memory test takes a few seconds). If the memory test fails, lower `BATCH` or `RANGE_CHUNK`, never raise the threshold.

- [ ] **Step 6: Record the ADR**

`vault/decisions/2026-09-24-gotcha-barycentric-origin-decides-seams.md`:

```markdown
---
type: adr
date: 2026-09-24
status: accepted
tags: [decision, gotcha, surfaces]
related: ["[[2026-09-23-design-surfaces-design]]"]
---

# Gotcha: the barycentric origin decides whether block seams are bit-identical

## Context

The design-surface rasteriser works window by window (2048² in the build). Spec §9.2 first said to
compute barycentrics "relative to the block origin" to avoid cancellation at UTM magnitudes, while
§16.6 requires a triangle spanning several blocks to give output bit-identical to a single-block run.
With a block-relative origin, the same cell centre is expressed as a different small number in each
window size, so the float result differs in the last bits.

## Decision

Compute barycentrics relative to each triangle's first vertex: `px = (col + 0.5) * cell + (x0 - Ax)`.
The value at a cell no longer depends on the window, and the coordinates are still small.

## Consequences

- Positive: seam-free, bit-identical tiling (test `test_a_triangle_across_nine_blocks_is_bit_identical_to_one_block`).
- Negative: none measured; one subtraction per triangle.
- A shared edge between two triangles is still computed by both; the last write wins in triangle
  order, and the two values agree within float rounding (no cracks, `|dz| < 1 mm`).
```

- [ ] **Step 7: Commit**

```
git add backend/app/surfaces/design/rasterise.py backend/tests/designs.py backend/tests/test_design_rasterise.py vault/decisions/2026-09-24-gotcha-barycentric-origin-decides-seams.md
git commit -m "feat(design): the barycentric TIN rasteriser with analytic fixtures" -m "Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: Frontend API client and the import state machine

Pure TypeScript against the generated client (F0 regenerated `schema.d.ts` with the S3 schemas); no UI.

**Files:**
- Create: `frontend/src/api/designSurfaces.ts`, `frontend/src/api/designSurfaces.test.ts`
- Create: `frontend/src/surfaces/designImport.ts`, `frontend/src/surfaces/designImport.test.ts`
- Create: `frontend/src/surfaces/testFixtures.ts`

**Interfaces:**
- Consumes (F0): `components["schemas"]` `DesignInspection`, `DesignCandidate`, `DesignImportOptions`, `DesignPreview`, `DesignWarning`, `DesignSuggestion`, `LinearUnit`, `Surface`, `DesignInspectionWithJob`, `DesignPreviewWithJob`, `SurfaceWithJob`, `DesignSurfaceCreate`; the paths `/api/v1/projects/{projectId}/design-inspections…`, `/design-surfaces`, `/surfaces`.
- Produces:
  - `api/designSurfaces.ts`: the type aliases above; `createDesignInspection(api, projectId, path)`, `getDesignInspection(api, projectId, inspectionId)`, `deleteDesignInspection(api, projectId, inspectionId)`, `createDesignPreview(api, projectId, inspectionId, body)`, `getDesignPreview(api, projectId, inspectionId, previewId)`, `createDesignSurface(api, projectId, body)`, `listTargetSurfaces(api, projectId): Promise<Surface[]>` (ready `cloud_dsm` only), `designThumbnailUrl(baseUrl, token, projectId, inspectionId, candidateId)`, `designPreviewImageUrl(baseUrl, token, projectId, inspectionId, previewId)`.
  - `surfaces/designImport.ts`: `UNIT_OPTIONS`, `ImportForm`, `initialForm(insp, targets)`, `toRequest(form)`, `formKey(form)`, `isStale(form, preview, previewedKey)`, `applyPatch(form, patch)`, `importGate(preview, stale, accepted): ImportGate`, `defaultName(insp, form)`, `blockedNote(candidate)`, `crsHint(insp, form, targets)`, `pointsSelected(insp, form)`, `formatPct(x)`.
  - `surfaces/testFixtures.ts`: `INSPECTION_ID`, `PREVIEW_ID`, `TARGET_ID`, `exampleTarget`, `landxmlInspection`, `dxfInspection`, `demInspection`, `readyPreview`, `warnPreview`, `blockedPreview`, `designSurface`.

- [ ] **Step 1: Write the fixtures**

`frontend/src/surfaces/testFixtures.ts`:

```ts
import type { DesignInspection, DesignPreview, Surface } from "@/api/designSurfaces";
import { PROJECT_ID } from "@/test/fixtures";

export const INSPECTION_ID = "d0000000-1111-4000-8000-000000000001";
export const PREVIEW_ID = "d0000000-2222-4000-8000-000000000001";
export const TARGET_ID = "s0000000-3333-4000-8000-000000000001";
export const DESIGN_ID = "s0000000-4444-4000-8000-000000000001";
export const INSPECT_JOB = "j0000000-5555-4000-8000-000000000001";
export const PREVIEW_JOB = "j0000000-6666-4000-8000-000000000001";
export const BUILD_JOB = "j0000000-7777-4000-8000-000000000001";

const surfaceBase: Surface = {
  id: TARGET_ID,
  name: "Chimney DSM",
  kind: "cloud_dsm",
  status: "ready",
  error: null,
  point_cloud_id: "c0000000-8888-4000-8000-000000000001",
  design_source: null,
  crs_wkt: 'PROJCS["WGS 84 / UTM zone 39N"]',
  epsg: 32639,
  proj4: "+proj=utm +zone=39 +datum=WGS84 +units=m +no_defs",
  cell_size_m: 0.1,
  width: 4000,
  height: 3000,
  geotransform: [500000, 0.1, 0, 2800300, 0, -0.1],
  bounds_native: [500000, 2800000, 500400, 2800300],
  z_min: -52,
  z_max: 12,
  coverage_fraction: 0.93,
  method: "median",
  build_params: null,
  stats: null,
  captured_on: "2026-04-15",
  map_id: null,
  tile_grid: { tile_size: 256, max_zoom: 4 },
  measurement_count: 0,
  job_id: null,
  created_at: "2026-09-23T10:00:00Z",
};

export const exampleTarget: Surface = surfaceBase;

export const designSurface: Surface = {
  ...surfaceBase,
  id: DESIGN_ID,
  name: "site-tin — Existing ground",
  kind: "design",
  status: "building",
  point_cloud_id: null,
  method: null,
  captured_on: null,
  job_id: BUILD_JOB,
};

export const landxmlInspection: DesignInspection = {
  id: INSPECTION_ID,
  state: "ready",
  error: null,
  job_id: INSPECT_JOB,
  path: "D:\\designs\\site-tin.xml",
  format: "landxml",
  file_size: 1_234_567,
  sha256: "ab".repeat(32),
  detected: {
    horizontal_unit: "metre",
    vertical_unit: "metre",
    unit_source: "LandXML <Metric linearUnit=meter>",
    crs_wkt: 'PROJCS["WGS 84 / UTM zone 39N"]',
    epsg: 32639,
    crs_source: "LandXML <CoordinateSystem epsgCode>",
    crs_hint: null,
  },
  candidates: [
    {
      id: "c0",
      kind: "tin_surface",
      name: "Existing ground",
      geometry: "faces",
      bounds_file: [500000, 2800000, 500400, 2800300],
      z_min: -50,
      z_max: 8,
      point_count: 12_000,
      face_count: 23_800,
      entity_counts: { invisible_faces: 12 },
      default_selected: true,
      notes: [],
      raster: null,
    },
    {
      id: "c1",
      kind: "tin_surface",
      name: "Grid 1m",
      geometry: "faces",
      bounds_file: [500000, 2800000, 500400, 2800300],
      z_min: -50,
      z_max: 8,
      point_count: 120,
      face_count: 0,
      entity_counts: { invisible_faces: 0 },
      default_selected: false,
      notes: [{ code: "not_tin", level: "block", message: "grid-type LandXML surfaces aren't supported" }],
      raster: null,
    },
  ],
  default_target_surface_id: TARGET_ID,
  created_at: "2026-09-24T09:00:00Z",
};

export const dxfInspection: DesignInspection = {
  ...landxmlInspection,
  path: "D:\\designs\\contours.dxf",
  format: "dxf",
  detected: {
    horizontal_unit: null,
    vertical_unit: null,
    unit_source: "DXF $INSUNITS=1 (not supported; choose the unit)",
    crs_wkt: null,
    epsg: null,
    crs_source: null,
    crs_hint: "GEODATA: UTM84-39N",
  },
  candidates: [
    {
      id: "c0",
      kind: "dxf_layer",
      name: "CONTOURS",
      geometry: "points",
      bounds_file: [500000, 2800000, 500400, 2800300],
      z_min: -50,
      z_max: 8,
      point_count: 80_000,
      face_count: 0,
      entity_counts: { lwpolyline: 58, polyline_3d: 0, point: 0, unsupported: 0 },
      default_selected: true,
      notes: [],
      raster: null,
    },
    {
      id: "c1",
      kind: "dxf_layer",
      name: "TEXT",
      geometry: "none",
      bounds_file: [0, 0, 0, 0],
      z_min: null,
      z_max: null,
      point_count: 0,
      face_count: 0,
      entity_counts: { unsupported: 40 },
      default_selected: false,
      notes: [
        { code: "empty_result", level: "block", message: "nothing on this layer can be used as a surface" },
      ],
      raster: null,
    },
  ],
};

export const demInspection: DesignInspection = {
  ...landxmlInspection,
  path: "D:\\designs\\design-dem.tif",
  format: "geotiff",
  detected: {
    horizontal_unit: null,
    vertical_unit: "metre",
    unit_source: "CRS axis unit",
    crs_wkt: 'PROJCS["WGS 84 / UTM zone 38N"]',
    epsg: 32638,
    crs_source: "GeoTIFF CRS",
    crs_hint: null,
  },
  candidates: [
    {
      id: "c0",
      kind: "dem",
      name: "band 1",
      geometry: "raster",
      bounds_file: [740000, 2800000, 740400, 2800300],
      z_min: -50,
      z_max: 8,
      point_count: 0,
      face_count: 0,
      entity_counts: {},
      default_selected: true,
      notes: [],
      raster: {
        width: 400,
        height: 300,
        cell_x: 1,
        cell_y: 1,
        dtype: "float32",
        nodata: -9999,
        band_count: 1,
      },
    },
  ],
};

const previewBase: DesignPreview = {
  id: PREVIEW_ID,
  inspection_id: INSPECTION_ID,
  state: "ready",
  error: null,
  job_id: PREVIEW_JOB,
  options: {
    candidate_ids: ["c0"],
    source_crs: "EPSG:32639",
    horizontal_unit: "metre",
    vertical_unit: "metre",
    swap_xy: false,
    target_surface_id: TARGET_ID,
    cell_size_m: null,
    max_edge_m: null,
  },
  output: {
    crs_wkt: 'PROJCS["WGS 84 / UTM zone 39N"]',
    epsg: 32639,
    cell_size_m: 0.1,
    width: 4000,
    height: 3000,
    bounds_native: [500000, 2800000, 500400, 2800300],
    preview_cell_size_m: 0.8,
  },
  triangle_count: 23_800,
  overlap_fraction: 0.973,
  target_covered_fraction: 0.95,
  design_area_m2: 118_000,
  z_check: {
    median_dz_m: 0.12,
    p05_dz_m: -0.3,
    p95_dz_m: 0.41,
    n_samples: 150_000,
    design_z_min_m: -50,
    design_z_max_m: 8,
  },
  warnings: [
    {
      code: "crs_from_file",
      level: "info",
      message: "CRS from the file (LandXML <CoordinateSystem epsgCode>)",
    },
  ],
  suggestions: [],
  created_at: "2026-09-24T09:01:00Z",
};

export const readyPreview: DesignPreview = previewBase;

export const warnPreview: DesignPreview = {
  ...previewBase,
  overlap_fraction: 0.01,
  warnings: [
    {
      code: "no_overlap",
      level: "warn",
      message: "the design and the cloud surface don't overlap (1 % of the design lies on it)",
    },
  ],
  suggestions: [
    {
      code: "swap_xy",
      message: "With easting/northing swapped the design covers 97 % of the cloud surface.",
      overlap_fraction: 0.97,
      options_patch: { swap_xy: true },
    },
  ],
};

export const blockedPreview: DesignPreview = {
  ...previewBase,
  warnings: [{ code: "mixed_geometry", level: "block", message: "the selection mixes 3D faces and lines" }],
};

export { PROJECT_ID };
```

- [ ] **Step 2: Write the failing tests**

`frontend/src/api/designSurfaces.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { fakeClient, PROJECT_ID } from "@/test/fixtures";
import {
  createDesignInspection,
  createDesignPreview,
  createDesignSurface,
  deleteDesignInspection,
  designPreviewImageUrl,
  designThumbnailUrl,
  listTargetSurfaces,
} from "./designSurfaces";
import { designSurface, exampleTarget, INSPECTION_ID, PREVIEW_ID } from "@/surfaces/testFixtures";

describe("designSurfaces api", () => {
  it("posts the path to create an inspection", async () => {
    const { api, requests } = fakeClient([
      { method: "POST", path: /\/design-inspections$/, status: 202, body: { inspection: {}, job: {} } },
    ]);
    await createDesignInspection(api, PROJECT_ID, "D:\\x.xml");
    expect(requests[0].url).toBe(`/api/v1/projects/${PROJECT_ID}/design-inspections`);
    expect(requests[0].body).toEqual({ path: "D:\\x.xml" });
  });

  it("posts options to the inspection's previews and deletes the inspection", async () => {
    const { api, requests } = fakeClient([
      { method: "POST", path: /\/previews$/, status: 202, body: { preview: {}, job: {} } },
      { method: "DELETE", path: /\/design-inspections\/[^/]+$/, status: 204 },
    ]);
    const body = {
      candidate_ids: ["c0"],
      source_crs: "EPSG:32639",
      horizontal_unit: "metre" as const,
      vertical_unit: "metre" as const,
    };
    await createDesignPreview(api, PROJECT_ID, INSPECTION_ID, body);
    await deleteDesignInspection(api, PROJECT_ID, INSPECTION_ID);
    expect(requests[0].url).toBe(
      `/api/v1/projects/${PROJECT_ID}/design-inspections/${INSPECTION_ID}/previews`,
    );
    expect(requests[0].body).toEqual(body);
    expect(requests[1].method).toBe("DELETE");
  });

  it("creates the design surface", async () => {
    const { api, requests } = fakeClient([
      { method: "POST", path: /\/design-surfaces$/, status: 202, body: { surface: designSurface, job: {} } },
    ]);
    const r = await createDesignSurface(api, PROJECT_ID, {
      inspection_id: INSPECTION_ID,
      preview_id: PREVIEW_ID,
      accept_warnings: true,
    });
    expect(r.surface.kind).toBe("design");
    expect(requests[0].body).toEqual({
      inspection_id: INSPECTION_ID,
      preview_id: PREVIEW_ID,
      accept_warnings: true,
    });
  });

  it("offers only ready cloud surfaces as targets", async () => {
    const { api } = fakeClient([
      {
        method: "GET",
        path: /\/surfaces$/,
        body: { items: [exampleTarget, designSurface, { ...exampleTarget, id: "x", status: "building" }] },
      },
    ]);
    expect((await listTargetSurfaces(api, PROJECT_ID)).map((s) => s.id)).toEqual([exampleTarget.id]);
  });

  it("builds token-carrying image urls", () => {
    expect(designThumbnailUrl("http://h/", "t k", "p", "i", "c0")).toBe(
      "http://h/api/v1/projects/p/design-inspections/i/candidates/c0/thumbnail?token=t+k",
    );
    expect(designPreviewImageUrl("http://h", "t", "p", "i", "v")).toBe(
      "http://h/api/v1/projects/p/design-inspections/i/previews/v/image?token=t",
    );
  });
});
```

`frontend/src/surfaces/designImport.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  applyPatch,
  crsHint,
  defaultName,
  formKey,
  importGate,
  initialForm,
  isStale,
  pointsSelected,
  toRequest,
  UNIT_OPTIONS,
} from "./designImport";
import {
  blockedPreview,
  demInspection,
  dxfInspection,
  exampleTarget,
  landxmlInspection,
  readyPreview,
  TARGET_ID,
  warnPreview,
} from "./testFixtures";

describe("designImport", () => {
  it("prefills a LandXML import from the file and the default target", () => {
    const f = initialForm(landxmlInspection, [exampleTarget]);
    expect(f).toEqual({
      candidateIds: ["c0"],
      sourceCrs: "EPSG:32639",
      horizontalUnit: "metre",
      verticalUnit: "metre",
      swapXy: false,
      targetSurfaceId: TARGET_ID,
      cellSizeM: "0.25",
      maxEdgeM: "",
    });
    expect(crsHint(landxmlInspection, f, [exampleTarget])).toBe(
      "From the file: LandXML <CoordinateSystem epsgCode>",
    );
  });

  it("assumes the target's CRS when the file has none, and says so", () => {
    const f = initialForm(dxfInspection, [exampleTarget]);
    expect(f.sourceCrs).toBe("EPSG:32639");
    expect(f.horizontalUnit).toBe("");
    expect(crsHint(dxfInspection, f, [exampleTarget])).toBe(
      "Assumed from the cloud surface — confirm it. The file says: GEODATA: UTM84-39N",
    );
    expect(pointsSelected(dxfInspection, f)).toBe(true);
  });

  it("uses no target when the default is not among the ready surfaces", () => {
    expect(initialForm(landxmlInspection, []).targetSurfaceId).toBe("");
  });

  it("sends metre as the ignored horizontal unit of a DEM", () => {
    const f = initialForm(demInspection, [exampleTarget]);
    expect(f.horizontalUnit).toBe("metre");
    expect(f.sourceCrs).toBe("EPSG:32638");
  });

  it("maps the form to the request and validates it", () => {
    const f = initialForm(landxmlInspection, [exampleTarget]);
    expect(toRequest(f)).toEqual({
      ok: true,
      body: {
        candidate_ids: ["c0"],
        source_crs: "EPSG:32639",
        horizontal_unit: "metre",
        vertical_unit: "metre",
        swap_xy: false,
        target_surface_id: TARGET_ID,
      },
    });
    const noTarget = { ...f, targetSurfaceId: "", cellSizeM: "0.5", maxEdgeM: "12" };
    expect(toRequest(noTarget)).toMatchObject({
      ok: true,
      body: { target_surface_id: null, cell_size_m: 0.5, max_edge_m: 12 },
    });
    expect(toRequest({ ...noTarget, cellSizeM: "0" })).toEqual({
      ok: false,
      error: "Enter a cell size in metres.",
    });
    expect(toRequest({ ...f, horizontalUnit: "" })).toEqual({
      ok: false,
      error: "Choose the horizontal and height units.",
    });
    expect(toRequest({ ...f, candidateIds: [] })).toEqual({ ok: false, error: "Choose what to import." });
    expect(toRequest({ ...f, sourceCrs: " " })).toEqual({
      ok: false,
      error: "Enter the CRS the design was drawn in, for example EPSG:32639.",
    });
  });

  it("detects a stale preview after any option change", () => {
    const f = initialForm(landxmlInspection, [exampleTarget]);
    const key = formKey(f);
    expect(isStale(f, readyPreview, key)).toBe(false);
    expect(isStale({ ...f, swapXy: true }, readyPreview, key)).toBe(true);
    expect(isStale({ ...f, verticalUnit: "us_survey_foot" }, readyPreview, key)).toBe(true);
    expect(isStale(f, null, null)).toBe(false);
  });

  it("applies a suggestion patch", () => {
    const f = initialForm(landxmlInspection, [exampleTarget]);
    expect(applyPatch(f, { swap_xy: true }).swapXy).toBe(true);
    expect(applyPatch(f, { horizontal_unit: "international_foot" }).horizontalUnit).toBe(
      "international_foot",
    );
    expect(applyPatch(f, { nonsense: 1 })).toEqual(f);
  });

  it("gates the import on block and warn", () => {
    expect(importGate(null, false, false)).toMatchObject({
      allowed: false,
      reason: "Preview the design first.",
    });
    expect(importGate(readyPreview, false, false)).toEqual({
      allowed: true,
      needsAccept: false,
      reason: null,
    });
    expect(importGate(readyPreview, true, false).allowed).toBe(false);
    expect(importGate(blockedPreview, false, true)).toMatchObject({
      allowed: false,
      reason: "This design can't be imported: the selection mixes 3D faces and lines",
    });
    expect(importGate(warnPreview, false, false)).toMatchObject({ allowed: false, needsAccept: true });
    expect(importGate(warnPreview, false, true)).toEqual({ allowed: true, needsAccept: true, reason: null });
  });

  it("names the surface after the file and the candidates", () => {
    expect(defaultName(landxmlInspection, initialForm(landxmlInspection, []))).toBe(
      "site-tin — Existing ground",
    );
  });

  it("spells out both feet", () => {
    const labels = UNIT_OPTIONS.map((u) => u.label);
    expect(labels).toContain("US survey foot (1200/3937 m)");
    expect(labels).toContain("International foot (0.3048 m)");
  });
});
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `pnpm -C frontend exec vitest run src/api/designSurfaces.test.ts src/surfaces/designImport.test.ts`
Expected: FAIL with "Failed to resolve import './designSurfaces'" / "./designImport".

- [ ] **Step 4: Write `designSurfaces.ts`**

```ts
import type { ApiClient, components } from "@contract/client";
import { unwrap } from "./errors";

type S = components["schemas"];
export type DesignInspection = S["DesignInspection"];
export type DesignCandidate = S["DesignCandidate"];
export type DesignImportOptions = S["DesignImportOptions"];
export type DesignPreview = S["DesignPreview"];
export type DesignWarning = S["DesignWarning"];
export type DesignSuggestion = S["DesignSuggestion"];
export type LinearUnit = S["LinearUnit"];
export type Surface = S["Surface"];
export type DesignInspectionWithJob = S["DesignInspectionWithJob"];
export type DesignPreviewWithJob = S["DesignPreviewWithJob"];
export type SurfaceWithJob = S["SurfaceWithJob"];
export type DesignSurfaceCreate = S["DesignSurfaceCreate"];

const P = "/api/v1/projects/{projectId}" as const;

export function createDesignInspection(
  api: ApiClient,
  projectId: string,
  path: string,
): Promise<DesignInspectionWithJob> {
  return unwrap(api.POST(`${P}/design-inspections`, { params: { path: { projectId } }, body: { path } }));
}

export function getDesignInspection(
  api: ApiClient,
  projectId: string,
  inspectionId: string,
): Promise<DesignInspection> {
  return unwrap(
    api.GET(`${P}/design-inspections/{inspectionId}`, { params: { path: { projectId, inspectionId } } }),
  );
}

export async function deleteDesignInspection(
  api: ApiClient,
  projectId: string,
  inspectionId: string,
): Promise<void> {
  await unwrap(
    api.DELETE(`${P}/design-inspections/{inspectionId}`, { params: { path: { projectId, inspectionId } } }),
  );
}

export function createDesignPreview(
  api: ApiClient,
  projectId: string,
  inspectionId: string,
  body: DesignImportOptions,
): Promise<DesignPreviewWithJob> {
  return unwrap(
    api.POST(`${P}/design-inspections/{inspectionId}/previews`, {
      params: { path: { projectId, inspectionId } },
      body,
    }),
  );
}

export function getDesignPreview(
  api: ApiClient,
  projectId: string,
  inspectionId: string,
  previewId: string,
): Promise<DesignPreview> {
  return unwrap(
    api.GET(`${P}/design-inspections/{inspectionId}/previews/{previewId}`, {
      params: { path: { projectId, inspectionId, previewId } },
    }),
  );
}

export function createDesignSurface(
  api: ApiClient,
  projectId: string,
  body: DesignSurfaceCreate,
): Promise<SurfaceWithJob> {
  return unwrap(api.POST(`${P}/design-surfaces`, { params: { path: { projectId } }, body }));
}

/** Ready cloud surfaces: the targets a design can be aligned to. */
export async function listTargetSurfaces(api: ApiClient, projectId: string): Promise<Surface[]> {
  const items = (await unwrap(api.GET(`${P}/surfaces`, { params: { path: { projectId } } }))).items;
  return items.filter((s) => s.kind === "cloud_dsm" && s.status === "ready");
}

function root(baseUrl: string, projectId: string, inspectionId: string): string {
  return `${baseUrl.replace(/\/$/, "")}/api/v1/projects/${projectId}/design-inspections/${inspectionId}`;
}

export function designThumbnailUrl(
  baseUrl: string,
  token: string,
  projectId: string,
  inspectionId: string,
  candidateId: string,
): string {
  return `${root(baseUrl, projectId, inspectionId)}/candidates/${candidateId}/thumbnail?${new URLSearchParams({ token })}`;
}

export function designPreviewImageUrl(
  baseUrl: string,
  token: string,
  projectId: string,
  inspectionId: string,
  previewId: string,
): string {
  return `${root(baseUrl, projectId, inspectionId)}/previews/${previewId}/image?${new URLSearchParams({ token })}`;
}
```

- [ ] **Step 5: Write `designImport.ts`**

```ts
import type {
  DesignCandidate,
  DesignImportOptions,
  DesignInspection,
  DesignPreview,
  DesignWarning,
  LinearUnit,
  Surface,
} from "@/api/designSurfaces";

export const UNIT_OPTIONS: { value: LinearUnit; label: string }[] = [
  { value: "metre", label: "Metre" },
  { value: "millimetre", label: "Millimetre" },
  { value: "centimetre", label: "Centimetre" },
  { value: "us_survey_foot", label: "US survey foot (1200/3937 m)" },
  { value: "international_foot", label: "International foot (0.3048 m)" },
];

/** The dialog's options as typed; strings for the numeric inputs so partial input is kept. */
export interface ImportForm {
  candidateIds: string[];
  sourceCrs: string;
  horizontalUnit: LinearUnit | "";
  verticalUnit: LinearUnit | "";
  swapXy: boolean;
  /** "" = no target. */
  targetSurfaceId: string;
  cellSizeM: string;
  /** "" = automatic, "0" = off. */
  maxEdgeM: string;
}

export interface ImportGate {
  allowed: boolean;
  needsAccept: boolean;
  reason: string | null;
}

export function blockedNote(c: DesignCandidate): DesignWarning | undefined {
  return c.notes.find((n) => n.level === "block");
}

function crsLabel(epsg: number | null | undefined, wkt: string | null | undefined): string {
  return epsg ? `EPSG:${epsg}` : (wkt ?? "");
}

export function initialForm(insp: DesignInspection, targets: Surface[]): ImportForm {
  const d = insp.detected;
  const usable = insp.candidates.filter((c) => c.default_selected && !blockedNote(c)).map((c) => c.id);
  const candidateIds = insp.format === "dxf" ? usable : usable.slice(0, 1);
  const target = targets.find((t) => t.id === insp.default_target_surface_id);
  const fromFile = crsLabel(d?.epsg, d?.crs_wkt);
  return {
    candidateIds,
    sourceCrs: fromFile || (target ? crsLabel(target.epsg, target.crs_wkt) : ""),
    horizontalUnit: insp.format === "geotiff" ? "metre" : (d?.horizontal_unit ?? ""),
    verticalUnit: d?.vertical_unit ?? d?.horizontal_unit ?? "",
    swapXy: false,
    targetSurfaceId: target ? target.id : "",
    cellSizeM: "0.25",
    maxEdgeM: "",
  };
}

export function crsHint(insp: DesignInspection, form: ImportForm, targets: Surface[]): string {
  const d = insp.detected;
  const says = d?.crs_hint ? ` The file says: ${d.crs_hint}` : "";
  if (d && (d.epsg || d.crs_wkt) && form.sourceCrs === crsLabel(d.epsg, d.crs_wkt)) {
    return `From the file: ${d.crs_source ?? "its CRS"}`;
  }
  const target = targets.find((t) => t.id === form.targetSurfaceId);
  if (target && form.sourceCrs === crsLabel(target.epsg, target.crs_wkt)) {
    return `Assumed from the cloud surface — confirm it.${says}`;
  }
  return `Enter the CRS the design was drawn in, as EPSG:<code> or WKT.${says}`;
}

export function pointsSelected(insp: DesignInspection, form: ImportForm): boolean {
  return insp.candidates.some((c) => form.candidateIds.includes(c.id) && c.geometry === "points");
}

export function toRequest(
  form: ImportForm,
): { ok: true; body: DesignImportOptions } | { ok: false; error: string } {
  if (form.candidateIds.length === 0) return { ok: false, error: "Choose what to import." };
  if (!form.sourceCrs.trim()) {
    return { ok: false, error: "Enter the CRS the design was drawn in, for example EPSG:32639." };
  }
  if (!form.horizontalUnit || !form.verticalUnit)
    return { ok: false, error: "Choose the horizontal and height units." };
  const body: DesignImportOptions = {
    candidate_ids: form.candidateIds,
    source_crs: form.sourceCrs.trim(),
    horizontal_unit: form.horizontalUnit,
    vertical_unit: form.verticalUnit,
    swap_xy: form.swapXy,
    target_surface_id: form.targetSurfaceId || null,
  };
  if (!form.targetSurfaceId) {
    const cell = Number(form.cellSizeM);
    if (!(cell > 0)) return { ok: false, error: "Enter a cell size in metres." };
    body.cell_size_m = cell;
  }
  if (form.maxEdgeM.trim()) {
    const m = Number(form.maxEdgeM);
    if (!(m >= 0))
      return { ok: false, error: "The maximum edge length is a number of metres (0 turns trimming off)." };
    body.max_edge_m = m;
  }
  return { ok: true, body };
}

export function formKey(form: ImportForm): string {
  const r = toRequest(form);
  return r.ok ? JSON.stringify(r.body) : "";
}

export function isStale(
  form: ImportForm,
  preview: DesignPreview | null,
  previewedKey: string | null,
): boolean {
  return preview !== null && formKey(form) !== previewedKey;
}

export function applyPatch(form: ImportForm, patch: Record<string, unknown>): ImportForm {
  const next = { ...form };
  if (typeof patch.swap_xy === "boolean") next.swapXy = patch.swap_xy;
  if (typeof patch.horizontal_unit === "string") next.horizontalUnit = patch.horizontal_unit as LinearUnit;
  if (typeof patch.vertical_unit === "string") next.verticalUnit = patch.vertical_unit as LinearUnit;
  if (typeof patch.source_crs === "string") next.sourceCrs = patch.source_crs;
  return next;
}

export function importGate(preview: DesignPreview | null, stale: boolean, accepted: boolean): ImportGate {
  if (!preview || preview.state === "running") {
    return { allowed: false, needsAccept: false, reason: "Preview the design first." };
  }
  if (preview.state === "failed") {
    return {
      allowed: false,
      needsAccept: false,
      reason: preview.error ?? "The preview failed; preview again.",
    };
  }
  if (stale)
    return {
      allowed: false,
      needsAccept: false,
      reason: "The options changed since the preview — preview again.",
    };
  const block = preview.warnings.find((w) => w.level === "block");
  if (block)
    return { allowed: false, needsAccept: false, reason: `This design can't be imported: ${block.message}` };
  const needsAccept = preview.warnings.some((w) => w.level === "warn");
  if (needsAccept && !accepted) {
    return { allowed: false, needsAccept, reason: "Tick “Import despite these warnings” to import." };
  }
  return { allowed: true, needsAccept, reason: null };
}

export function defaultName(insp: DesignInspection, form: ImportForm): string {
  const stem = (insp.path.split(/[\\/]/).pop() ?? insp.path).replace(/\.[^.]+$/, "");
  const names = insp.candidates.filter((c) => form.candidateIds.includes(c.id)).map((c) => c.name);
  return names.length && insp.format !== "geotiff" ? `${stem} — ${names.join(", ")}` : stem;
}

export function formatPct(x: number | null | undefined): string {
  return x === null || x === undefined ? "—" : `${(100 * x).toFixed(1)} %`;
}
```

- [ ] **Step 5b: Run the tests to verify they pass**

Run: `pnpm -C frontend exec vitest run src/api/designSurfaces.test.ts src/surfaces/designImport.test.ts`
Expected: PASS. Then `pnpm -C frontend lint` clean (fix prettier with `pnpm -C frontend exec prettier --write src/api/designSurfaces.ts src/api/designSurfaces.test.ts src/surfaces`).

- [ ] **Step 6: Commit**

```
git add frontend/src/api/designSurfaces.ts frontend/src/api/designSurfaces.test.ts frontend/src/surfaces/designImport.ts frontend/src/surfaces/designImport.test.ts frontend/src/surfaces/testFixtures.ts
git commit -m "feat(design): client for design imports and the options state machine" -m "Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---
### Task 4: Inspection endpoints, the `design_import` dispatcher, the inspect phase, DWG, the sweep

**Files:**
- Create: `backend/app/surfaces/design/detect.py`, `schemas.py`, `phase_inspect.py`
- Replace (F0 stubs): `backend/app/surfaces/design/router.py`, `jobs.py`, `startup.py`
- Create: `backend/tests/fake_design_reader.py`
- Test: `backend/tests/test_design_api_inspect.py`, `backend/tests/test_design_startup.py`
- Modify: `backend/tests/test_contract.py` (`EXPECTED_STUBS`: remove four names)

**Interfaces:**
- Consumes: Task 1 (`store`, `inspection`, `thumbs`); F0 (`Surface` model with `kind`, `status`, `created_at`; `app.stubs.add_stubs`; `JobOut`; the runner's `submit`, `cancel`, `is_live`).
- Produces:
  - `detect.classify(path: Path) -> str` (`"geotiff" | "landxml" | "dxf"`; raises `AppError` 422 `reason: dwg` / 422 `reason: extension` / 404), `detect.DWG_MESSAGE`.
  - `schemas.py`: `DesignInspectionCreate`, `DesignWarningOut`, `DesignRasterInfoOut`, `DesignCandidateOut`, `DesignDetectedOut`, `DesignInspectionOut`, `DesignInspectionWithJob`, `DesignImportOptions`, `DesignSuggestionOut`, `DesignPreviewOutputOut`, `DesignZCheckOut`, `DesignPreviewOut`, `DesignPreviewWithJob`, `DesignSurfaceCreate`.
  - `jobs.PHASES` (phase → module path); every phase module exposes `run(ctx) -> dict`.
  - Reader contract (Tasks 7, 8, 9 implement it): module with `inspect_file(path: Path, idir: Path, *, progress: Callable[[float, str], None], check_cancelled: Callable[[], None]) -> InspectResult`, writing `cand/<cid>/` and `thumbs/<cid>.png` itself; `phase_inspect.READERS = {"landxml": "app.surfaces.design.landxml", "dxf": "app.surfaces.design.dxf", "geotiff": "app.surfaces.design.dem"}`.
  - `phase_inspect.default_target(handle) -> str | None` (newest ready `cloud_dsm`).
  - `internal.json` of an inspection always carries `file_size` and `mtime_ns` plus the reader's `internal`.
  - `router.router` with `createDesignInspection`, `getDesignInspection`, `deleteDesignInspection`, `getDesignCandidateThumbnail` live; `router.STUBS` still holding the other four.
  - `startup.sweep_interrupted(handle, runner) -> list[str]` (removed inspection ids).

- [ ] **Step 1: Write the fake reader the API tests use**

`backend/tests/fake_design_reader.py`:

```python
"""A stand-in design reader for the inspect-phase API tests (Task 4): one 3-point TIN candidate.

HOLD keeps the job running until a test cancels it; FAIL makes it raise a JobFailure.
"""

from __future__ import annotations

import threading
import time

import numpy as np

from app.jobs.cancellation import JobFailure
from app.surfaces.design import store, thumbs
from app.surfaces.design.inspection import Detected, InspectResult, candidate_from_meta

HOLD = threading.Event()
FAIL: list[str] = []


def inspect_file(path, idir, *, progress, check_cancelled) -> InspectResult:
    while HOLD.is_set():
        check_cancelled()
        time.sleep(0.01)
    if FAIL:
        raise JobFailure(FAIL[0])
    pts = np.array([[500000.0, 2800000.0, 1.0], [500010.0, 2800000.0, 2.0], [500000.0, 2800010.0, 3.0]])
    w = store.CandidateWriter(store.candidate_dir(idir, "c0"), "faces")
    w.add_points(pts)
    w.add_faces([[0, 1, 2]])
    meta = w.close()
    thumbs.plan_thumbnail(pts, store.thumb_path(idir, "c0"))
    progress(1.0, "read")
    return InspectResult(
        detected=Detected("metre", "metre", "fake"),
        candidates=[candidate_from_meta("c0", "tin_surface", "Ground", meta, default_selected=True)],
        internal={"reader": "fake"},
    )
```

- [ ] **Step 2: Write the failing API tests**

`backend/tests/test_design_api_inspect.py`:

```python
"""createDesignInspection, getDesignInspection, deleteDesignInspection, the thumbnail (spec §12, §4.2)."""

import hashlib
import time

import fake_design_reader
import pytest

from app.surfaces.design import store

BASE = "/api/v1/projects"


@pytest.fixture
def project_kind() -> str:
    """Design surfaces are detection work: F0 guards the router with require_kind(("detect",), ANY_KIND)."""
    return "detect"


@pytest.fixture
def fake_reader(monkeypatch):
    from app.surfaces.design import phase_inspect

    monkeypatch.setitem(phase_inspect.READERS, "landxml", "fake_design_reader")
    monkeypatch.setitem(phase_inspect.READERS, "dxf", "fake_design_reader")
    yield fake_design_reader
    fake_design_reader.HOLD.clear()
    fake_design_reader.FAIL.clear()


def post(client, project_id, path):
    return client.post(f"{BASE}/{project_id}/design-inspections", json={"path": str(path)})


def url(project_id, iid, rest=""):
    return f"{BASE}/{project_id}/design-inspections/{iid}{rest}"


def wait_state(client, project_id, job_id, state, timeout=10.0):
    deadline = time.time() + timeout
    while time.time() < deadline:
        if client.get(f"{BASE}/{project_id}/jobs/{job_id}").json()["state"] == state:
            return
        time.sleep(0.02)
    raise AssertionError(f"job {job_id} never reached {state}")


def test_inspect_flow(client, project_id, wait_job, fake_reader, tmp_path, handle):
    src = tmp_path / "site.xml"
    src.write_bytes(b"<LandXML/>")
    r = post(client, project_id, src)
    assert r.status_code == 202, r.text
    body = r.json()
    insp = body["inspection"]
    assert insp["state"] == "inspecting" and insp["format"] == "landxml"
    assert insp["job_id"] == body["job"]["id"] and body["job"]["type"] == "design_import"
    job = wait_job(project_id, body["job"]["id"])
    assert job["state"] == "succeeded", job
    assert job["result"] == {"inspection_id": insp["id"], "candidate_count": 1}
    got = client.get(url(project_id, insp["id"])).json()
    assert got["state"] == "ready" and got["error"] is None
    assert got["sha256"] == hashlib.sha256(b"<LandXML/>").hexdigest()
    assert got["detected"]["unit_source"] == "fake"
    assert [c["id"] for c in got["candidates"]] == ["c0"] and got["candidates"][0]["face_count"] == 1
    assert got["default_target_surface_id"] is None
    t = client.get(url(project_id, insp["id"], "/candidates/c0/thumbnail"))
    assert t.status_code == 200 and t.headers["content-type"] == "image/png"
    assert client.get(url(project_id, insp["id"], "/candidates/c7/thumbnail")).status_code == 404
    folder = handle.folder / "cache" / "design-inspections" / insp["id"]
    internal = store.read_json(folder / "internal.json")
    assert internal["reader"] == "fake" and internal["file_size"] == 10 and internal["mtime_ns"] > 0
    assert client.delete(url(project_id, insp["id"])).status_code == 204
    assert not folder.exists()
    assert client.get(url(project_id, insp["id"])).status_code == 404


def test_dwg_is_refused_with_the_fix(client, project_id, tmp_path):
    (tmp_path / "a.dwg").write_bytes(b"AC1032\x00\x00\x00")
    (tmp_path / "b.dxf").write_bytes(b"AC1027\x00\x00\x00")
    for p in (tmp_path / "a.dwg", tmp_path / "b.dxf", tmp_path / "not-there.dwg"):
        r = post(client, project_id, p)
        assert r.status_code == 422, r.text
        err = r.json()["error"]
        assert err["code"] == "validation_error" and err["details"] == {"reason": "dwg"}
        assert "save it as DXF" in err["message"] and "ODA File Converter" in err["message"]


def test_missing_and_unknown_files(client, project_id, tmp_path):
    assert post(client, project_id, tmp_path / "nope.xml").status_code == 404
    (tmp_path / "x.png").write_bytes(b"x")
    r = post(client, project_id, tmp_path / "x.png")
    assert r.status_code == 422 and r.json()["error"]["details"] == {"reason": "extension"}


def test_a_training_project_may_read_but_not_inspect(client, tmp_path):
    body = {"name": "t", "folder": str(tmp_path / "t"), "classes": [], "kind": "train"}
    pid = client.post(BASE, json=body).json()["id"]
    src = tmp_path / "s.xml"
    src.write_text("<LandXML/>")
    r = post(client, pid, src)
    assert r.status_code == 409 and r.json()["error"]["code"] == "wrong_project_kind"
    assert client.get(url(pid, store.new_id())).status_code == 404  # reads pass the guard


def test_contract_positive_cases_never_meet_a_422(client, project_id, tmp_path):
    """Deviation 1: a schema-valid body whose file does not exist is 404, never 422."""
    assert post(client, project_id, tmp_path / "missing.landxml").status_code == 404
    assert post(client, project_id, "relative/name.xml").status_code == 404


def test_inspection_ids_are_uuids_only(client, project_id, handle):
    victim = handle.folder / "keep.txt"
    victim.write_text("x")
    # one path segment each: a literal ".." segment would be resolved by the HTTP client first
    for bad in ("x%5C..%5C..%5Ckeep.txt", "not-a-uuid", "0" * 36):
        assert client.get(url(project_id, bad)).status_code == 404
        assert client.delete(url(project_id, bad)).status_code == 404
        assert client.get(url(project_id, bad, "/candidates/c0/thumbnail")).status_code == 404
    assert victim.is_file()


def test_reader_failure_marks_the_inspection_failed(client, project_id, wait_job, fake_reader, tmp_path):
    fake_reader.FAIL.append("surface 'Ground': face refers to missing point 9")
    src = tmp_path / "bad.xml"
    src.write_text("<LandXML/>")
    body = post(client, project_id, src).json()
    job = wait_job(project_id, body["job"]["id"])
    assert job["state"] == "failed" and job["error"] == "surface 'Ground': face refers to missing point 9"
    got = client.get(url(project_id, body["inspection"]["id"])).json()
    assert got["state"] == "failed" and got["error"] == "surface 'Ground': face refers to missing point 9"


def test_delete_cancels_a_running_inspection(client, project_id, wait_job, fake_reader, tmp_path, handle):
    fake_reader.HOLD.set()
    src = tmp_path / "slow.dxf"
    src.write_text("0\nEOF\n")
    body = post(client, project_id, src).json()
    jid, iid = body["job"]["id"], body["inspection"]["id"]
    wait_state(client, project_id, jid, "running")
    assert client.delete(url(project_id, iid)).status_code == 204
    assert wait_job(project_id, jid)["state"] == "cancelled"
    assert not (handle.folder / "cache" / "design-inspections" / iid).exists()


def test_delete_is_refused_while_a_build_holds_the_inspection(
    client, app, project_id, wait_job, fake_reader, tmp_path, handle, monkeypatch
):
    src = tmp_path / "site.xml"
    src.write_text("<LandXML/>")
    body = post(client, project_id, src).json()
    wait_job(project_id, body["job"]["id"])
    d = store.inspection_dir(handle, body["inspection"]["id"])
    store.patch_json(d / "request.json", build_job_id="build-1")
    monkeypatch.setattr(app.state.jobs, "is_live", lambda job_id: job_id == "build-1")
    r = client.delete(url(project_id, body["inspection"]["id"]))
    assert r.status_code == 409 and r.json()["error"]["code"] == "conflict"
    assert d.exists()
```

`backend/tests/test_design_startup.py`:

```python
"""The design-inspection sweep on project open (spec §4.4)."""

import os
import time
from datetime import UTC, datetime, timedelta

from app.surfaces.design import store
from app.surfaces.design.startup import sweep_interrupted


class Runner:
    def __init__(self, live=()):
        self.live = set(live)

    def is_live(self, job_id):
        return job_id in self.live


def make(handle, *, age_h, jobs=None, state="ready", preview_state=None):
    src = handle.folder / "src.xml"
    src.write_text("<LandXML/>")
    d = store.create_inspection(handle, store.new_id(), src, "landxml")
    created = (datetime.now(UTC) - timedelta(hours=age_h)).isoformat()
    store.patch_json(d / "request.json", created_at=created, **(jobs or {}))
    store.patch_json(d / "inspection.json", state=state)
    if preview_state:
        p = store.preview_dir(d, store.new_id())
        p.mkdir(parents=True)
        store.write_json(p / "preview.json", {"state": preview_state, "error": None})
    return d


def test_no_cache_folder_is_fine(handle):
    assert sweep_interrupted(handle, Runner()) == []


def test_old_inspections_without_live_jobs_are_removed(handle):
    old, fresh = make(handle, age_h=25), make(handle, age_h=1)
    assert sweep_interrupted(handle, Runner()) == [old.name]
    assert not old.exists() and fresh.exists()


def test_live_jobs_keep_even_old_inspections(handle):
    d = make(handle, age_h=48, jobs={"preview_job_ids": ["p1"]})
    assert sweep_interrupted(handle, Runner({"p1"})) == []
    assert d.exists()


def test_sweep_fails_interrupted_inspections_and_previews(handle):
    d = make(handle, age_h=1, state="inspecting", preview_state="running")
    sweep_interrupted(handle, Runner())
    insp = store.read_json(d / "inspection.json")
    assert insp["state"] == "failed" and insp["error"].startswith("interrupted by application restart")
    (preview,) = (d / "previews").iterdir()
    p = store.read_json(preview / "preview.json")
    assert p["state"] == "failed" and p["error"].startswith("interrupted by application restart")


def test_a_corrupt_request_json_falls_back_to_the_folder_age(handle):
    d = make(handle, age_h=1)
    (d / "request.json").write_text("{", "utf-8")
    old = time.time() - 30 * 3600
    os.utime(d, (old, old))
    assert sweep_interrupted(handle, Runner()) == [d.name]
```

- [ ] **Step 3: Run the tests to verify they fail**

Run from `backend`: `$PY -m pytest tests/test_design_api_inspect.py tests/test_design_startup.py -v`
Expected: FAIL — the API tests get `501 not_implemented`, the startup tests fail on `sweep_interrupted` returning `[]` for the old folder, and the fixture's `phase_inspect` import fails with `ModuleNotFoundError`.

- [ ] **Step 4: Write `detect.py` and `schemas.py`**

`backend/app/surfaces/design/detect.py`:

```python
"""Which reader a file needs, and the DWG refusal (spec §2 DWG, §8.1, §12)."""

from __future__ import annotations

from pathlib import Path

from app.errors import AppError, not_found

EXTENSIONS = {".tif": "geotiff", ".tiff": "geotiff", ".xml": "landxml", ".landxml": "landxml", ".dxf": "dxf"}
DWG_MESSAGE = (
    "DWG files can't be read. Open the drawing in your CAD program (or the free ODA File Converter) "
    "and save it as DXF, then import the DXF."
)


def _dwg() -> AppError:
    return AppError("validation_error", DWG_MESSAGE, 422, {"reason": "dwg"})


def classify(path: Path) -> str:
    """The format of `path`. Order matters: a .dwg always gets the fix message (even when missing);
    a missing file is 404, not 422 (the contract's positive-data check forbids 422 on a valid body)."""
    ext = path.suffix.lower()
    if ext == ".dwg":
        raise _dwg()
    if not path.is_file():
        raise not_found("design file", str(path))
    if ext not in EXTENSIONS:
        raise AppError(
            "validation_error",
            f"{path.name}: choose a DEM GeoTIFF (.tif, .tiff), a LandXML file (.xml, .landxml) or a DXF",
            422,
            {"reason": "extension"},
        )
    if ext == ".dxf":
        with path.open("rb") as f:
            if f.read(4) == b"AC10":
                raise _dwg()
    return EXTENSIONS[ext]
```

`backend/app/surfaces/design/schemas.py`:

```python
"""Pydantic models for the design-surface schemas (spec §12), field for field with the contract.

Request properties carry no contract default; the Python defaults below are the documented
"when absent" values (ADR 2026-09-20 openapi default makes a field required in TypeScript).
"""

from __future__ import annotations

from datetime import datetime
from typing import Annotated, Any, Literal

from pydantic import BaseModel, Field

from app.jobs.schemas import JobOut

LinearUnitT = Literal["millimetre", "centimetre", "metre", "international_foot", "us_survey_foot"]
DesignFormatT = Literal["geotiff", "landxml", "dxf"]
LevelT = Literal["info", "warn", "block"]
CandidateId = Annotated[str, Field(pattern=r"^c[0-9]{1,6}$")]


class DesignInspectionCreate(BaseModel):
    path: str = Field(min_length=1)


class DesignWarningOut(BaseModel):
    code: str
    level: LevelT
    message: str


class DesignRasterInfoOut(BaseModel):
    width: int
    height: int
    cell_x: float
    cell_y: float
    dtype: str
    nodata: float | None
    band_count: int


class DesignCandidateOut(BaseModel):
    id: CandidateId
    kind: Literal["dem", "tin_surface", "dxf_layer"]
    name: str
    geometry: Literal["faces", "points", "raster", "none"]
    bounds_file: list[float] = Field(min_length=4, max_length=4)
    z_min: float | None
    z_max: float | None
    point_count: int
    face_count: int
    entity_counts: dict[str, int]
    default_selected: bool
    notes: list[DesignWarningOut]
    raster: DesignRasterInfoOut | None


class DesignDetectedOut(BaseModel):
    horizontal_unit: LinearUnitT | None
    vertical_unit: LinearUnitT | None
    unit_source: str
    crs_wkt: str | None
    epsg: int | None
    crs_source: str | None
    crs_hint: str | None


class DesignInspectionOut(BaseModel):
    id: str
    state: Literal["inspecting", "ready", "failed"]
    error: str | None
    job_id: str
    path: str
    format: DesignFormatT
    file_size: int
    sha256: str | None
    detected: DesignDetectedOut | None
    candidates: list[DesignCandidateOut]
    default_target_surface_id: str | None
    created_at: datetime


class DesignInspectionWithJob(BaseModel):
    inspection: DesignInspectionOut
    job: JobOut


class DesignImportOptions(BaseModel):
    candidate_ids: list[CandidateId] = Field(min_length=1)
    source_crs: str = Field(min_length=1)
    horizontal_unit: LinearUnitT
    vertical_unit: LinearUnitT
    swap_xy: bool = False
    target_surface_id: str | None = None
    cell_size_m: float | None = Field(None, gt=0)
    max_edge_m: float | None = Field(None, ge=0)


class DesignSuggestionOut(BaseModel):
    code: Literal["swap_xy", "horizontal_unit"]
    message: str
    overlap_fraction: float
    options_patch: dict[str, Any]


class DesignPreviewOutputOut(BaseModel):
    crs_wkt: str
    epsg: int | None
    cell_size_m: float
    width: int
    height: int
    bounds_native: list[float] = Field(min_length=4, max_length=4)
    preview_cell_size_m: float


class DesignZCheckOut(BaseModel):
    median_dz_m: float
    p05_dz_m: float
    p95_dz_m: float
    n_samples: int
    design_z_min_m: float
    design_z_max_m: float


class DesignPreviewOut(BaseModel):
    id: str
    inspection_id: str
    state: Literal["running", "ready", "failed"]
    error: str | None
    job_id: str
    options: DesignImportOptions
    output: DesignPreviewOutputOut | None
    triangle_count: int | None
    overlap_fraction: float | None
    target_covered_fraction: float | None
    design_area_m2: float | None
    z_check: DesignZCheckOut | None
    warnings: list[DesignWarningOut]
    suggestions: list[DesignSuggestionOut]
    created_at: datetime


class DesignPreviewWithJob(BaseModel):
    preview: DesignPreviewOut
    job: JobOut


class DesignSurfaceCreate(BaseModel):
    inspection_id: str
    preview_id: str
    name: str | None = Field(None, min_length=1, max_length=200)
    accept_warnings: bool = False
```

- [ ] **Step 5: Write `jobs.py` and `phase_inspect.py`**

Replace `backend/app/surfaces/design/jobs.py` with:

```python
"""The `design_import` job (spec §4.1): one job type, three phases, one module per phase.

Phase modules are imported when a job runs, so importing the router never pulls in ezdxf, scipy or
rasterio: a broken native library must not stop the backend from starting (AGENTS.md).
"""

from __future__ import annotations

import importlib

from app.jobs.cancellation import JobFailure
from app.jobs.registry import register_job_type

PHASES = {
    "inspect": "app.surfaces.design.phase_inspect",
    "preview": "app.surfaces.design.phase_preview",
    "build": "app.surfaces.design.phase_build",
}
MESSAGES = {
    "inspect": "Reading design file",
    "preview": "Previewing design",
    "build": "Importing design surface",
}


@register_job_type("design_import")
def run_design_import(ctx) -> dict:
    phase = ctx.params.get("phase")
    if phase not in PHASES:
        raise JobFailure(f"unknown design import phase {phase!r}")
    ctx.progress(0.0, MESSAGES[phase])
    return importlib.import_module(PHASES[phase]).run(ctx)
```

`backend/app/surfaces/design/phase_inspect.py`:

```python
"""The `inspect` phase (spec §4.1): hash the file, parse every candidate into the cache, thumbnails."""

from __future__ import annotations

import importlib
from pathlib import Path

from sqlalchemy import select

from app.db.models import Surface
from app.jobs.cancellation import JobCancelled, JobFailure
from app.surfaces.design import store

READERS = {
    "landxml": "app.surfaces.design.landxml",
    "dxf": "app.surfaces.design.dxf",
    "geotiff": "app.surfaces.design.dem",
}
MESSAGE = "Reading design file"
HASH_SHARE = 0.2


def default_target(handle) -> str | None:
    """The newest ready cloud surface (spec §5 defaults table)."""
    with handle.session() as s:
        row = s.execute(
            select(Surface.id)
            .where(Surface.kind == "cloud_dsm", Surface.status == "ready")
            .order_by(Surface.created_at.desc())
            .limit(1)
        ).first()
    return row[0] if row else None


def _fail(idir: Path, message: str) -> None:
    store.patch_json(idir / "inspection.json", state="failed", error=message)


def run(ctx) -> dict:
    iid, path = ctx.params["inspection_id"], Path(ctx.params["path"])
    idir = store.inspection_dir(ctx.project, iid)
    try:
        fmt = store.read_json(idir / "inspection.json")["format"]
        if not path.is_file():
            raise JobFailure(f"{path.name} is no longer there; choose the file again")
        sha = store.sha256_file(
            path,
            progress=lambda f: ctx.progress(HASH_SHARE * f, MESSAGE),
            check_cancelled=ctx.check_cancelled,
        )
        reader = importlib.import_module(READERS[fmt])
        result = reader.inspect_file(
            path,
            idir,
            progress=lambda f, m=MESSAGE: ctx.progress(HASH_SHARE + (0.98 - HASH_SHARE) * f, m),
            check_cancelled=ctx.check_cancelled,
        )
    except JobCancelled:
        _fail(idir, "reading the file was cancelled")
        raise
    except JobFailure as e:
        _fail(idir, str(e))
        raise
    except Exception as e:
        _fail(idir, f"reading the file failed: {type(e).__name__}: {e}")
        raise
    stat = path.stat()
    store.write_json(
        idir / "internal.json", {**result.internal, "file_size": stat.st_size, "mtime_ns": stat.st_mtime_ns}
    )
    store.patch_json(
        idir / "inspection.json",
        state="ready",
        error=None,
        sha256=sha,
        detected=result.detected.to_json(),
        candidates=[c.to_json() for c in result.candidates],
        default_target_surface_id=default_target(ctx.project),
    )
    ctx.progress(1.0, f"{len(result.candidates)} part(s) found")
    return {"inspection_id": iid, "candidate_count": len(result.candidates)}
```

- [ ] **Step 6: Write `startup.py`**

Replace `backend/app/surfaces/design/startup.py` with:

```python
"""The design-inspection sweep on project open (spec §4.4). Wired into project_opened() by F0.

Interrupted `building` design surfaces are S2's surface sweep's job (it covers every kind).
"""

from __future__ import annotations

import logging
import shutil
from datetime import UTC, datetime, timedelta
from pathlib import Path

from app.surfaces.design import store

MAX_AGE = timedelta(hours=24)
INTERRUPTED = "interrupted by application restart; {}"
log = logging.getLogger(__name__)


def _created(request: dict, folder: Path) -> datetime:
    try:
        return datetime.fromisoformat(request["created_at"])
    except (KeyError, TypeError, ValueError):
        return datetime.fromtimestamp(folder.stat().st_mtime, UTC)


def _fail_interrupted(folder: Path) -> None:
    insp = folder / "inspection.json"
    if insp.is_file() and store.read_json(insp).get("state") == "inspecting":
        store.patch_json(insp, state="failed", error=INTERRUPTED.format("read the file again"))
    for p in (folder / "previews").glob("*/preview.json"):
        if store.read_json(p).get("state") == "running":
            store.patch_json(p, state="failed", error=INTERRUPTED.format("preview again"))


def sweep_interrupted(handle, runner) -> list[str]:
    """Remove inspection folders no live job holds and older than 24 h; fail interrupted ones."""
    root = store.inspections_root(handle)
    if not root.is_dir():
        return []
    now, removed = datetime.now(UTC), []
    for folder in sorted(p for p in root.iterdir() if p.is_dir()):
        try:
            request = store.read_json(folder / "request.json")
        except (OSError, ValueError):
            request = {}
        if any(runner.is_live(j) for j in store.job_ids(request)):
            continue
        if now - _created(request, folder) > MAX_AGE:
            shutil.rmtree(folder, ignore_errors=True)
            removed.append(folder.name)
            continue
        try:
            _fail_interrupted(folder)
        except (OSError, ValueError):
            log.exception("could not mark design inspection %s interrupted", folder.name)
    if removed:
        log.info("removed %d stale design inspection(s) in project %s", len(removed), handle.id)
    return removed
```

- [ ] **Step 7: Write the router**

Replace `backend/app/surfaces/design/router.py` with:

```python
"""Design surfaces (spec 2026-09-23-design-surfaces): inspections, previews and the import.

Operations not built yet are 501 stubs; the task that lands one removes it from STUBS here and
from EXPECTED_STUBS in tests/test_contract.py.
"""

from __future__ import annotations

import shutil
from pathlib import Path

from fastapi import APIRouter, Depends, Request, Response
from fastapi import Path as PathParam

from app.errors import AppError, not_found
from app.jobs.schemas import JobOut
from app.projects.service import ProjectHandle, get_project
from app.stubs import add_stubs
from app.surfaces.design import detect, store
from app.surfaces.design import jobs as _jobs  # noqa: F401 - registers `design_import`
from app.surfaces.design.schemas import DesignInspectionCreate, DesignInspectionOut, DesignInspectionWithJob

router = APIRouter(prefix="/projects/{projectId}", tags=["surfaces"])
CANDIDATE = r"^c[0-9]{1,6}$"


@router.post("/design-inspections", response_model=DesignInspectionWithJob, status_code=202)
def create_design_inspection(
    body: DesignInspectionCreate, request: Request, handle: ProjectHandle = Depends(get_project)
) -> DesignInspectionWithJob:
    source = Path(body.path)
    fmt = detect.classify(source)
    iid = store.new_id()
    idir = store.create_inspection(handle, iid, source, fmt)
    job = request.app.state.jobs.submit(
        handle, "design_import", {"phase": "inspect", "inspection_id": iid, "path": str(source)}
    )
    store.patch_json(idir / "request.json", inspect_job_id=job.id)
    inspection = store.patch_json(idir / "inspection.json", job_id=job.id)
    return DesignInspectionWithJob(
        inspection=DesignInspectionOut(**inspection), job=JobOut.from_row(job, handle.id)
    )


@router.get("/design-inspections/{inspectionId}", response_model=DesignInspectionOut)
def get_design_inspection(
    inspectionId: str, handle: ProjectHandle = Depends(get_project)
) -> DesignInspectionOut:  # noqa: N803
    idir = store.require_inspection(handle, inspectionId)
    return DesignInspectionOut(**store.read_json(idir / "inspection.json"))


@router.delete("/design-inspections/{inspectionId}", status_code=204)
def delete_design_inspection(
    inspectionId: str,  # noqa: N803
    request: Request,
    handle: ProjectHandle = Depends(get_project),
) -> Response:
    idir = store.require_inspection(handle, inspectionId)
    runner = request.app.state.jobs
    req = store.read_json(idir / "request.json")
    if req.get("build_job_id") and runner.is_live(req["build_job_id"]):
        raise AppError("conflict", "a design surface is being imported from this inspection", 409)
    for job_id in store.job_ids(req):
        if runner.is_live(job_id):
            runner.cancel(handle, job_id)
    shutil.rmtree(idir, ignore_errors=True)  # a job still holding a memmap leaves files: the sweep ends it
    return Response(status_code=204)


@router.get("/design-inspections/{inspectionId}/candidates/{candidateId}/thumbnail", response_class=Response)
def get_design_candidate_thumbnail(
    inspectionId: str,  # noqa: N803
    candidateId: str = PathParam(pattern=CANDIDATE),  # noqa: N803
    handle: ProjectHandle = Depends(get_project),
) -> Response:
    idir = store.require_inspection(handle, inspectionId)
    insp = store.read_json(idir / "inspection.json")
    if insp["state"] == "ready" and candidateId not in {c["id"] for c in insp["candidates"]}:
        raise not_found("design candidate", candidateId)
    thumb = store.thumb_path(idir, candidateId)
    if not thumb.is_file():
        return Response(status_code=204)
    return Response(
        thumb.read_bytes(), media_type="image/png", headers={"Cache-Control": "private, max-age=3600"}
    )


STUBS = [
    ("POST", "/design-inspections/{inspectionId}/previews", "createDesignPreview"),
    ("GET", "/design-inspections/{inspectionId}/previews/{previewId}", "getDesignPreview"),
    ("GET", "/design-inspections/{inspectionId}/previews/{previewId}/image", "getDesignPreviewImage"),
    ("POST", "/design-surfaces", "createDesignSurface"),
]
add_stubs(router, STUBS)
```

- [ ] **Step 8: Remove the four landed operations from `EXPECTED_STUBS`**

In `backend/tests/test_contract.py`, delete exactly these four entries from the `EXPECTED_STUBS` set F0 filled (leave every other entry):

```python
    "createDesignInspection",
    "getDesignInspection",
    "deleteDesignInspection",
    "getDesignCandidateThumbnail",
```

- [ ] **Step 9: Run the tests to verify they pass**

Run from `backend`: `$PY -m pytest tests/test_design_api_inspect.py tests/test_design_startup.py tests/test_contract.py tests/test_pointcloud_stubs.py -v`
Expected: PASS. The contract run calls the four live operations with generated bodies and ids and must see 202/404/422/204 only — never a 500.

- [ ] **Step 10: Commit**

```
git add backend/app/surfaces/design/detect.py backend/app/surfaces/design/schemas.py backend/app/surfaces/design/jobs.py backend/app/surfaces/design/phase_inspect.py backend/app/surfaces/design/startup.py backend/app/surfaces/design/router.py backend/tests/fake_design_reader.py backend/tests/test_design_api_inspect.py backend/tests/test_design_startup.py backend/tests/test_contract.py
git commit -m "feat(design): inspection endpoints, the design_import dispatcher and the sweep" -m "Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 5: Triangulation for points and contours

**Files:**
- Create: `backend/app/surfaces/design/triangulate.py`
- Modify: `backend/tests/designs.py` (append three builders)
- Test: `backend/tests/test_design_triangulate.py`

**Interfaces:**
- Consumes: Task 1 `admission.admit`; Task 2 `rasterise.rasterise_to_array` and `tests/designs.py` (tests only).
- Produces:
  - `triangulate.QHULL_BYTES_PER_POINT = 600`, `NothingToTriangulate(ValueError)`, `NOTHING` (its message).
  - `triangulate.Triangulation(vertices, triangles, max_edge_m, long_edges_removed, duplicate_positions, input_points)`.
  - `triangulate.densify(points, runs, spacing) -> np.ndarray`, `dedupe(xyz) -> tuple[np.ndarray, int]`, `peel(neighbors, longest, max_edge) -> np.ndarray` (removed mask).
  - `triangulate.triangulate(points, runs, *, spacing: float, max_edge_m: float | None, auto_floor: float, check_cancelled=None, admit=admission.admit) -> Triangulation` — `spacing` is 2 × the grid cell being written, `auto_floor` is 10 × the output cell, `max_edge_m` None = automatic, 0 = off.
  - `tests/designs.py`: `l_shape_points()`, `crossing_runs()`, `cone_contour_runs(points_per_ring=256)`.

- [ ] **Step 1: Append the builders to `backend/tests/designs.py`**

```python
def l_shape_points(hole: bool = True):
    """A 1 m grid over 100 x 100 m minus a 30 x 30 m notch (x, y > 70), and minus an enclosed
    25 x 25 m patch (20 < x, y < 45) that stays surrounded by points. Every point is a run of 1."""
    g = np.arange(0, 101, 1.0)
    xx, yy = np.meshgrid(g, g)
    x, y = xx.ravel(), yy.ravel()
    keep = ~((x > 70) & (y > 70))
    if hole:
        keep &= ~((x > 20) & (x < 45) & (y > 20) & (y < 45))
    pts = np.column_stack([x[keep] + E0, y[keep] + N0, np.full(int(keep.sum()), 5.0)])
    return pts, np.arange(len(pts) + 1, dtype=np.int64)


def crossing_runs():
    """Two 2-vertex runs crossing at (E0 + 5, N0) at heights 5 and 7, plus four corner points."""
    pts = np.array(
        [
            [E0, N0, 5.0],
            [E0 + 10, N0, 5.0],
            [E0 + 5, N0 - 5, 7.0],
            [E0 + 5, N0 + 5, 7.0],
            [E0 - 2, N0 - 7, 6.0],
            [E0 + 12, N0 - 7, 6.0],
            [E0 + 12, N0 + 7, 6.0],
            [E0 - 2, N0 + 7, 6.0],
        ]
    )
    return pts, np.array([0, 2, 4, 5, 6, 7, 8], np.int64)


def cone_contour_runs(points_per_ring: int = 256):
    """Contours of cone_z: closed circles at z = 0..19 with radius 2 (20 - z)."""
    ang = np.linspace(0, 2 * math.pi, points_per_ring + 1)  # the last vertex closes the ring
    pts, runs = [], [0]
    for z in range(20):
        r = 2.0 * (20 - z)
        ring = np.column_stack(
            [CONE_CENTRE[0] + r * np.cos(ang), CONE_CENTRE[1] + r * np.sin(ang), np.full(len(ang), float(z))]
        )
        pts.append(ring)
        runs.append(runs[-1] + len(ring))
    return np.vstack(pts), np.array(runs, np.int64)
```

- [ ] **Step 2: Write the failing tests**

`backend/tests/test_design_triangulate.py`:

```python
"""Densify, dedupe, Delaunay and boundary peeling (spec §9.1, §15.1 cone contours, §15.2)."""

import threading
import time

import numpy as np
import psutil
import pytest
from designs import (
    CONE_CENTRE,
    E0,
    N0,
    cone_contour_runs,
    cone_z,
    crossing_runs,
    l_shape_points,
    lattice_over,
)
from scipy.spatial import Delaunay

from app.jobs.cancellation import JobFailure
from app.surfaces.design import triangulate as tr
from app.surfaces.design.rasterise import rasterise_to_array


def no_admit(*args, **kwargs):
    return None


def centroids(t):
    return t.vertices[t.triangles].mean(1) - [E0, N0, 0]


def test_densify_keeps_runs_apart_and_interpolates_z():
    pts = np.array([[0, 0, 0], [10, 0, 10], [100, 100, 3], [103, 100, 3]], float)
    out = tr.densify(pts, np.array([0, 2, 4]), 1.0)
    assert len(out) == 4 + 9 + 2
    mid = out[(out[:, 0] == 5.0) & (out[:, 1] == 0.0)]
    assert mid[0, 2] == pytest.approx(5.0)
    assert not ((out[:, 0] > 10) & (out[:, 0] < 100)).any()  # never bridges two runs


def test_crossing_contours_are_averaged_and_counted():
    pts, runs = crossing_runs()
    t = tr.triangulate(pts, runs, spacing=1.0, max_edge_m=0, auto_floor=5.0, admit=no_admit)
    at = t.vertices[(np.abs(t.vertices[:, 0] - (E0 + 5)) < 1e-6) & (np.abs(t.vertices[:, 1] - N0) < 1e-6)]
    assert len(at) == 1 and at[0, 2] == pytest.approx(6.0)
    assert t.duplicate_positions == 1


def test_collinear_points_are_nothing_to_triangulate():
    pts = np.column_stack([np.arange(10.0) + E0, np.arange(10.0) + N0, np.zeros(10)])
    with pytest.raises(tr.NothingToTriangulate, match="lie on a line"):
        tr.triangulate(pts, np.arange(11), spacing=1.0, max_edge_m=None, auto_floor=5.0, admit=no_admit)
    with pytest.raises(tr.NothingToTriangulate):
        tr.triangulate(pts[:2], np.arange(3), spacing=100.0, max_edge_m=None, auto_floor=5.0, admit=no_admit)


def test_peeling_removes_the_notch_and_keeps_the_enclosed_patch():
    pts, runs = l_shape_points()
    t = tr.triangulate(pts, runs, spacing=2.0, max_edge_m=None, auto_floor=10.0, admit=no_admit)
    assert t.max_edge_m == pytest.approx(10.0)  # 3 x P95 (about 4.2 m) is below the 10 x cell floor
    assert t.long_edges_removed > 0
    c = centroids(t)
    # Triangles with every edge <= L may still bridge the notch's inner corner (within ~L of it);
    # nothing reaches deeper into the notch.
    assert not ((c[:, 0] > 80) & (c[:, 1] > 80)).any()
    v = t.vertices[t.triangles]
    area = 0.5 * np.abs(
        (v[:, 1, 0] - v[:, 0, 0]) * (v[:, 2, 1] - v[:, 0, 1])
        - (v[:, 2, 0] - v[:, 0, 0]) * (v[:, 1, 1] - v[:, 0, 1])
    )
    inside = (c[:, 0] > 21) & (c[:, 0] < 44) & (c[:, 1] > 21) & (c[:, 1] < 44)
    assert area[inside].sum() > 500  # the 25 m sparse patch keeps its big triangles


def test_max_edge_zero_keeps_everything():
    pts, runs = l_shape_points()
    t = tr.triangulate(pts, runs, spacing=2.0, max_edge_m=0, auto_floor=10.0, admit=no_admit)
    assert t.long_edges_removed == 0
    c = centroids(t)
    assert ((c[:, 0] > 80) & (c[:, 1] > 80)).any()


def test_admission_is_asked_for_the_qhull_estimate():
    pts, runs = l_shape_points(hole=False)
    seen = []
    tr.triangulate(
        pts, runs, spacing=2.0, max_edge_m=None, auto_floor=10.0, admit=lambda need, *a: seen.append(need)
    )
    assert seen == [tr.QHULL_BYTES_PER_POINT * len(pts)]

    def refuse(need, what, fix):
        raise JobFailure(fix)

    with pytest.raises(JobFailure, match="coarser cell"):
        tr.triangulate(pts, runs, spacing=2.0, max_edge_m=None, auto_floor=10.0, admit=refuse)


def test_cone_contours_match_the_cone_and_terrace_at_the_top():
    pts, runs = cone_contour_runs()
    t = tr.triangulate(pts, runs, spacing=1.0, max_edge_m=None, auto_floor=5.0, admit=no_admit)
    cx, cy = CONE_CENTRE
    lat = lattice_over((cx - 40, cy - 40, cx + 40, cy + 40), 0.5)
    out, _ = rasterise_to_array(t.vertices, t.triangles, lat)
    cols, rows = np.meshgrid(np.arange(lat.width), np.arange(lat.height))
    x, y = lat.x0 + (cols + 0.5) * 0.5, lat.y0 - (rows + 0.5) * 0.5
    r = np.hypot(x - cx, y - cy)
    ok = np.isfinite(out)
    outer = ok & (r >= 4) & (r <= 39)
    assert outer.sum() > 10_000
    assert np.abs(out[outer] - cone_z(x, y)[outer]).max() < 0.3
    top = ok & (r < 1.9)
    assert top.sum() > 30
    assert np.abs(out[top] - 19.0).max() < 1e-5  # the flat top-contour terrace (spec §9.1 caveat)


def test_qhull_bytes_per_point_holds_for_a_million_points():
    rng = np.random.default_rng(0)
    xy = rng.uniform(0, 1000, (1_000_000, 2))
    proc = psutil.Process()
    base = proc.memory_info().rss
    peak, done = [base], threading.Event()

    def sample():
        while not done.is_set():
            peak[0] = max(peak[0], proc.memory_info().rss)
            time.sleep(0.005)

    th = threading.Thread(target=sample)
    th.start()
    try:
        tri = Delaunay(xy - xy.mean(0), qhull_options="Qbb Qc Qz Q12")
    finally:
        done.set()
        th.join()
    assert len(tri.simplices) > 1_900_000
    per_point = (peak[0] - base) / 1_000_000
    assert per_point <= tr.QHULL_BYTES_PER_POINT, f"measured {per_point:.0f} B per point"
```

- [ ] **Step 3: Run the tests to verify they fail**

Run from `backend`: `$PY -m pytest tests/test_design_triangulate.py -v`
Expected: FAIL at collection with `ModuleNotFoundError: No module named 'app.surfaces.design.triangulate'`.

- [ ] **Step 4: Write `triangulate.py`**

```python
"""Delaunay for points and contours (spec §9.1): densify, deduplicate, Delaunay, boundary peeling.

Densifying to 2 x cell makes Delaunay nearly respect the contour lines (a conforming approximation,
not a constrained triangulation). Peeling removes long triangles only from the boundary inwards,
so big interior triangles on flat ground survive; a global edge cut would punch holes there.
"""

from __future__ import annotations

from collections import deque
from collections.abc import Callable
from dataclasses import dataclass

import numpy as np
from scipy.spatial import Delaunay, QhullError

from app.surfaces.design import admission

QHULL_BYTES_PER_POINT = 600  # measured by test_qhull_bytes_per_point_holds_for_a_million_points
DEDUPE_M = 0.001
EDGE_SAMPLE = 1_000_000
NOTHING = "the selected layers' points lie on a line — nothing to triangulate"


class NothingToTriangulate(ValueError):
    """Fewer than 3 points, or all collinear (the `nothing_to_triangulate` block)."""


@dataclass
class Triangulation:
    vertices: np.ndarray  # (N, 3) float64, deduplicated
    triangles: np.ndarray  # (M, 3) int32, after peeling
    max_edge_m: float  # the rule used; 0 = off
    long_edges_removed: int
    duplicate_positions: int  # positions whose heights differed by > 1 mm (averaged)
    input_points: int


def densify(points: np.ndarray, runs: np.ndarray, spacing: float) -> np.ndarray:
    """Every run's segments split to <= `spacing` (XY), Z linear along each segment."""
    p = np.asarray(points, dtype=np.float64)
    runs = np.asarray(runs, dtype=np.int64)
    if len(p) < 2:
        return p.copy()
    within = np.ones(len(p) - 1, bool)
    ends = runs[1:-1] - 1  # the last vertex of every run but the final one
    within[ends[(ends >= 0) & (ends < len(p) - 1)]] = False
    seg = np.flatnonzero(within)
    a, b = p[seg], p[seg + 1]
    n = np.maximum(1, np.ceil(np.hypot(b[:, 0] - a[:, 0], b[:, 1] - a[:, 1]) / spacing).astype(np.int64))
    extra = n - 1
    total = int(extra.sum())
    if total == 0:
        return p.copy()
    s = np.repeat(np.arange(len(seg)), extra)
    k = np.arange(total) - np.repeat(np.cumsum(extra) - extra, extra) + 1
    t = (k / np.repeat(n, extra))[:, None]
    return np.concatenate([p, a[s] + t * (b[s] - a[s])])


def dedupe(xyz: np.ndarray) -> tuple[np.ndarray, int]:
    """One vertex per 1 mm XY key, Z averaged; returns (vertices, keys whose Z spread > 1 mm)."""
    kx = np.round(xyz[:, 0] / DEDUPE_M).astype(np.int64)
    ky = np.round(xyz[:, 1] / DEDUPE_M).astype(np.int64)
    kx -= kx.min()
    ky -= ky.min()
    key = kx * (int(ky.max()) + 1) + ky
    uniq, inv, counts = np.unique(key, return_inverse=True, return_counts=True)
    if len(uniq) == len(key):
        return xyz, 0
    out = np.column_stack([np.bincount(inv, weights=xyz[:, i]) / counts for i in range(3)])
    order = np.argsort(inv, kind="stable")
    starts = np.concatenate([[0], np.cumsum(counts)[:-1]])
    zs = xyz[order, 2]
    spread = np.maximum.reduceat(zs, starts) - np.minimum.reduceat(zs, starts)
    return out, int(((counts > 1) & (spread > DEDUPE_M)).sum())


def _longest_edges(xy: np.ndarray, simp: np.ndarray) -> np.ndarray:
    a, b, c = xy[simp[:, 0]], xy[simp[:, 1]], xy[simp[:, 2]]
    return np.maximum.reduce([np.hypot(*(a - b).T), np.hypot(*(b - c).T), np.hypot(*(c - a).T)])


def _auto_max_edge(xy: np.ndarray, simp: np.ndarray, floor: float) -> float:
    s = simp[:: max(1, len(simp) // EDGE_SAMPLE)]
    edges = np.concatenate([np.hypot(*(xy[s[:, i]] - xy[s[:, (i + 1) % 3]]).T) for i in range(3)])
    return max(3.0 * float(np.percentile(edges, 95)), floor)


def peel(neighbors: np.ndarray, longest: np.ndarray, max_edge: float) -> np.ndarray:
    """Remove triangles longer than `max_edge` reachable from the hull (O(M)); returns the mask."""
    removed = np.zeros(len(neighbors), bool)
    if max_edge <= 0:
        return removed
    long = longest > max_edge
    queue = deque(np.flatnonzero((neighbors == -1).any(1)).tolist())
    while queue:
        t = queue.popleft()
        if removed[t] or not long[t]:
            continue
        removed[t] = True
        for n in neighbors[t]:
            if n != -1 and not removed[n]:
                queue.append(int(n))
    return removed


def triangulate(
    points: np.ndarray,
    runs: np.ndarray,
    *,
    spacing: float,
    max_edge_m: float | None,
    auto_floor: float,
    check_cancelled: Callable[[], None] | None = None,
    admit: Callable[..., None] = admission.admit,
) -> Triangulation:
    check = check_cancelled or (lambda: None)
    dense = densify(points, runs, spacing)
    check()
    pts, duplicates = dedupe(dense)
    check()
    admit(
        QHULL_BYTES_PER_POINT * len(pts),
        f"Triangulating {len(pts):,} points",
        "Choose a coarser cell size, or select fewer layers.",
    )
    if len(pts) < 3:
        raise NothingToTriangulate(NOTHING)
    xy = pts[:, :2] - pts[:, :2].mean(0)  # centred for Qhull precision at UTM magnitudes
    try:
        tri = Delaunay(xy, qhull_options="Qbb Qc Qz Q12")
    except QhullError:
        raise NothingToTriangulate(NOTHING) from None
    if len(tri.simplices) == 0:
        raise NothingToTriangulate(NOTHING)
    check()
    simp = tri.simplices.astype(np.int32)
    limit = _auto_max_edge(xy, simp, auto_floor) if max_edge_m is None else float(max_edge_m)
    removed = peel(tri.neighbors, _longest_edges(xy, simp), limit)
    return Triangulation(pts, simp[~removed], limit, int(removed.sum()), duplicates, len(points))
```

- [ ] **Step 5: Run the tests to verify they pass**

Run from `backend`: `$PY -m pytest tests/test_design_triangulate.py -v`
Expected: PASS. If `test_qhull_bytes_per_point_holds_for_a_million_points` measures more than 600 B per point on this machine, set `QHULL_BYTES_PER_POINT` to the measured figure rounded up to the next 100, and write the measured number into the Task 17 evidence file — never loosen the assertion itself.

- [ ] **Step 6: Commit**

```
git add backend/app/surfaces/design/triangulate.py backend/tests/designs.py backend/tests/test_design_triangulate.py
git commit -m "feat(design): densified Delaunay with boundary peeling for points and contours" -m "Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 6: `ImportDesignDialog` (standalone)

Load `impeccable` and `emil-design-eng` first, and read DESIGN.md and `frontend/src/ui/`. The dialog is built and tested on its own here; Task 15 mounts it.

**Files:**
- Create: `frontend/src/surfaces/ImportDesignDialog.tsx`, `DesignContents.tsx`, `DesignPlacement.tsx`, `DesignCheck.tsx`
- Test: `frontend/src/surfaces/ImportDesignDialog.test.tsx`

**Interfaces:**
- Consumes: Task 3 (`api/designSurfaces.ts`, `surfaces/designImport.ts`, `surfaces/testFixtures.ts`); `useTrackedJob(projectId, jobId)`; `useJobsStore`, `isActiveJob`; `useApi`, `useBackend`; `messageOf`; `Alert`, `Button`, `Checkbox`, `Dialog`, `Field`, `Input`, `Pill`, `Progress`, `Select`, `Switch` from `@/ui`.
- Produces: `ImportDesignDialog({ projectId, onClose, onStarted }: { projectId: string; onClose: () => void; onStarted: (surface: Surface) => void })`. It deletes its inspection when closed before "Import surface"; after `onStarted` the parent closes it without a delete.

- [ ] **Step 1: Write the failing component tests**

`frontend/src/surfaces/ImportDesignDialog.test.tsx`:

```tsx
import { describe, expect, it, vi } from "vitest";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import { fakeClient, PROJECT_ID } from "@/test/fixtures";
import { renderWithProviders } from "@/test/render";
import { useJobsStore } from "@/store/jobs";
import type { FakeRoute } from "@/test/fixtures";
import { ImportDesignDialog } from "./ImportDesignDialog";
import {
  BUILD_JOB,
  blockedPreview,
  designSurface,
  exampleTarget,
  INSPECT_JOB,
  INSPECTION_ID,
  landxmlInspection,
  PREVIEW_JOB,
  readyPreview,
  warnPreview,
} from "./testFixtures";

const job = (id: string, state: string) => ({
  id,
  project_id: PROJECT_ID,
  type: "design_import",
  state,
  progress: state === "succeeded" ? 1 : 0.3,
  message: "Reading design file",
  log_path: "",
  params: {},
  result: null,
  error: null,
  created_at: "2026-09-24T09:00:00Z",
  started_at: null,
  finished_at: null,
});

function routes(preview = readyPreview, extra: FakeRoute[] = []): FakeRoute[] {
  return [
    ...extra,
    { method: "GET", path: /\/surfaces$/, body: { items: [exampleTarget] } },
    {
      method: "POST",
      path: /\/design-inspections$/,
      status: 202,
      body: {
        inspection: { ...landxmlInspection, state: "inspecting", candidates: [], detected: null },
        job: job(INSPECT_JOB, "queued"),
      },
    },
    { method: "GET", path: new RegExp(`/jobs/${INSPECT_JOB}$`), body: job(INSPECT_JOB, "succeeded") },
    { method: "GET", path: new RegExp(`/design-inspections/${INSPECTION_ID}$`), body: landxmlInspection },
    {
      method: "POST",
      path: /\/previews$/,
      status: 202,
      body: { preview: { ...preview, state: "running" }, job: job(PREVIEW_JOB, "queued") },
    },
    { method: "GET", path: new RegExp(`/jobs/${PREVIEW_JOB}$`), body: job(PREVIEW_JOB, "succeeded") },
    { method: "GET", path: /\/previews\/[^/]+$/, body: preview },
    {
      method: "POST",
      path: /\/design-surfaces$/,
      status: 202,
      body: { surface: designSurface, job: job(BUILD_JOB, "queued") },
    },
    { method: "DELETE", path: /\/design-inspections\/[^/]+$/, status: 204 },
  ];
}

async function readFile() {
  fireEvent.change(screen.getByLabelText("Design file"), { target: { value: "D:\\designs\\site-tin.xml" } });
  fireEvent.click(screen.getByRole("button", { name: "Read file" }));
  await screen.findByRole("combobox", { name: "Surface" });
}

async function preview() {
  fireEvent.click(screen.getByRole("button", { name: "Preview" }));
  await screen.findByRole("img", { name: "The design over the cloud surface" });
}

describe("ImportDesignDialog", () => {
  it("reads a LandXML file and prefills the placement", async () => {
    const { api, requests } = fakeClient(routes());
    renderWithProviders(
      <ImportDesignDialog projectId={PROJECT_ID} onClose={() => {}} onStarted={() => {}} />,
      { api },
    );
    await readFile();
    expect(requests.find((r) => r.method === "POST")?.body).toEqual({ path: "D:\\designs\\site-tin.xml" });
    expect(screen.getByRole("combobox", { name: "Surface" })).toHaveValue("c0");
    expect(screen.getByRole("option", { name: /Grid 1m/ })).toBeDisabled();
    expect(screen.getByLabelText("Source CRS")).toHaveValue("EPSG:32639");
    expect(screen.getByText("From the file: LandXML <CoordinateSystem epsgCode>")).toBeInTheDocument();
    expect(screen.getByText("LandXML stores northing first — already handled")).toBeInTheDocument();
    expect(screen.getAllByRole("option", { name: "US survey foot (1200/3937 m)" })).toHaveLength(2);
    expect(screen.queryByLabelText("Cell size (m)")).not.toBeInTheDocument(); // a target is chosen
  });

  it("shows the DWG answer inline under the file", async () => {
    const dwg = {
      method: "POST",
      path: /\/design-inspections$/,
      status: 422,
      body: {
        error: {
          code: "validation_error",
          message:
            "DWG files can't be read. Open the drawing in your CAD program (or the free ODA File Converter) and save it as DXF, then import the DXF.",
          details: { reason: "dwg" },
        },
      },
    };
    const { api } = fakeClient([dwg]);
    renderWithProviders(
      <ImportDesignDialog projectId={PROJECT_ID} onClose={() => {}} onStarted={() => {}} />,
      { api },
    );
    fireEvent.change(screen.getByLabelText("Design file"), { target: { value: "D:\\site.dwg" } });
    fireEvent.click(screen.getByRole("button", { name: "Read file" }));
    expect(await screen.findByText(/save it as DXF/)).toBeInTheDocument();
  });

  it("previews, marks the preview stale on change, and imports", async () => {
    const onStarted = vi.fn();
    const { api, requests } = fakeClient(routes());
    renderWithProviders(
      <ImportDesignDialog projectId={PROJECT_ID} onClose={() => {}} onStarted={onStarted} />,
      { api },
    );
    await readFile();
    await preview();
    expect(screen.getByText("97.3 %")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("switch", { name: "Swap easting and northing" }));
    expect(screen.getByText("Preview out of date")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Import surface" })).toBeDisabled();
    fireEvent.click(screen.getByRole("switch", { name: "Swap easting and northing" }));
    fireEvent.click(screen.getByRole("button", { name: "Import surface" }));
    await waitFor(() => expect(onStarted).toHaveBeenCalledWith(designSurface));
    const post = requests.find((r) => r.url.endsWith("/design-surfaces"));
    expect(post?.body).toEqual({
      inspection_id: INSPECTION_ID,
      preview_id: readyPreview.id,
      accept_warnings: false,
      name: "site-tin — Existing ground",
    });
    expect(useJobsStore.getState().jobs[BUILD_JOB]?.type).toBe("design_import");
    expect(requests.some((r) => r.method === "DELETE")).toBe(false);
  });

  it("needs the checkbox on warnings and applies a suggestion with a new preview", async () => {
    const { api, requests } = fakeClient(routes(warnPreview));
    renderWithProviders(
      <ImportDesignDialog projectId={PROJECT_ID} onClose={() => {}} onStarted={() => {}} />,
      { api },
    );
    await readFile();
    await preview();
    expect(screen.getByRole("button", { name: "Import surface" })).toBeDisabled();
    fireEvent.click(screen.getByRole("checkbox", { name: "Import despite these warnings" }));
    expect(screen.getByRole("button", { name: "Import surface" })).toBeEnabled();
    fireEvent.click(screen.getByRole("button", { name: "Apply" }));
    await waitFor(() => expect(requests.filter((r) => r.url.endsWith("/previews"))).toHaveLength(2));
    const second = requests.filter((r) => r.url.endsWith("/previews"))[1];
    expect((second.body as { swap_xy: boolean }).swap_xy).toBe(true);
  });

  it("refuses to import a blocked preview and says why", async () => {
    const { api } = fakeClient(routes(blockedPreview));
    renderWithProviders(
      <ImportDesignDialog projectId={PROJECT_ID} onClose={() => {}} onStarted={() => {}} />,
      { api },
    );
    await readFile();
    await preview();
    expect(screen.getByRole("button", { name: "Import surface" })).toBeDisabled();
    expect(
      screen.getByText("This design can't be imported: the selection mixes 3D faces and lines"),
    ).toBeInTheDocument();
    expect(screen.queryByRole("checkbox", { name: "Import despite these warnings" })).not.toBeInTheDocument();
  });

  it("deletes the inspection when closed before importing", async () => {
    const onClose = vi.fn();
    const { api, requests } = fakeClient(routes());
    renderWithProviders(
      <ImportDesignDialog projectId={PROJECT_ID} onClose={onClose} onStarted={() => {}} />,
      { api },
    );
    await readFile();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onClose).toHaveBeenCalled();
    await waitFor(() => expect(requests.some((r) => r.method === "DELETE")).toBe(true));
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm -C frontend exec vitest run src/surfaces/ImportDesignDialog.test.tsx`
Expected: FAIL with "Failed to resolve import './ImportDesignDialog'".

- [ ] **Step 3: Write `DesignContents.tsx`**

```tsx
import { useState } from "react";
import type { DesignCandidate, DesignInspection } from "@/api/designSurfaces";
import { Checkbox, Field, Pill, Select, cx } from "@/ui";
import { blockedNote } from "./designImport";

const KIND_LABEL: Record<string, string> = {
  "3dface": "3D faces",
  mesh: "meshes",
  polyface: "polyface meshes",
  polymesh: "polygon meshes",
  polyline_3d: "3D polylines",
  polyline_2d: "2D polylines",
  lwpolyline: "polylines",
  line: "lines",
  point: "points",
  unsupported: "other objects",
  invisible_faces: "hidden faces",
};

function Thumb({ src }: { src: string }) {
  const [broken, setBroken] = useState(false);
  return (
    <span className="h-12 w-12 shrink-0 overflow-hidden rounded bg-well">
      {!broken && (
        <img src={src} alt="" className="h-full w-full object-contain" onError={() => setBroken(true)} />
      )}
    </span>
  );
}

function CandidateRow({
  c,
  thumb,
  control,
}: {
  c: DesignCandidate;
  thumb: string;
  control?: React.ReactNode;
}) {
  const counts = Object.entries(c.entity_counts)
    .filter(([, n]) => n > 0)
    .map(([k, n]) => `${n.toLocaleString()} ${KIND_LABEL[k] ?? k}`);
  const block = blockedNote(c);
  return (
    <div className={cx("flex gap-3 rounded-md p-2", block ? "opacity-60" : "")}>
      <Thumb src={thumb} />
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        {control ?? <span className="text-sm font-medium text-ink">{c.name}</span>}
        <span className="text-xs text-muted tabular-nums">
          {c.point_count.toLocaleString()} points · {c.face_count.toLocaleString()} triangles
          {counts.length ? ` · ${counts.join(", ")}` : ""}
          {c.z_min !== null && c.z_max !== null ? ` · z ${c.z_min.toFixed(1)} … ${c.z_max.toFixed(1)}` : ""}
        </span>
        {c.notes.map((n) => (
          <span key={n.code} className="flex items-center gap-2 text-xs text-muted">
            <Pill size="sm" tone={n.level === "block" ? "danger" : n.level === "warn" ? "warn" : "neutral"}>
              {n.level === "block" ? "Can't use" : n.level === "warn" ? "Check" : "Note"}
            </Pill>
            {n.message}
          </span>
        ))}
      </div>
    </div>
  );
}

export function DesignContents({
  inspection,
  selected,
  onChange,
  thumbUrl,
}: {
  inspection: DesignInspection;
  selected: string[];
  onChange: (ids: string[]) => void;
  thumbUrl: (candidateId: string) => string;
}) {
  const cands = inspection.candidates;
  if (inspection.format === "landxml") {
    const current = cands.find((c) => c.id === selected[0]);
    return (
      <div className="flex flex-col gap-2">
        <Field
          label="Surface"
          htmlFor="design-surface"
          hint="A LandXML file can hold several surfaces; import one at a time."
        >
          <Select id="design-surface" value={selected[0] ?? ""} onChange={(e) => onChange([e.target.value])}>
            {cands.map((c) => {
              const block = blockedNote(c);
              return (
                <option key={c.id} value={c.id} disabled={Boolean(block)}>
                  {c.name}
                  {block ? ` — ${block.message}` : ""}
                </option>
              );
            })}
          </Select>
        </Field>
        {current && <CandidateRow c={current} thumb={thumbUrl(current.id)} />}
      </div>
    );
  }
  if (inspection.format === "geotiff") {
    return <CandidateRow c={cands[0]} thumb={thumbUrl(cands[0].id)} />;
  }
  return (
    <ul className="flex flex-col gap-1" aria-label="Layers">
      {cands.map((c) => {
        const block = blockedNote(c);
        const checked = selected.includes(c.id);
        return (
          <li key={c.id}>
            <CandidateRow
              c={c}
              thumb={thumbUrl(c.id)}
              control={
                <Checkbox
                  label={c.name}
                  checked={checked}
                  disabled={Boolean(block)}
                  onChange={() =>
                    onChange(checked ? selected.filter((id) => id !== c.id) : [...selected, c.id])
                  }
                />
              }
            />
          </li>
        );
      })}
    </ul>
  );
}
```

- [ ] **Step 4: Write `DesignPlacement.tsx`**

```tsx
import type { DesignInspection, LinearUnit, Surface } from "@/api/designSurfaces";
import { Field, Input, Select, Switch } from "@/ui";
import { crsHint, pointsSelected, UNIT_OPTIONS, type ImportForm } from "./designImport";

function UnitSelect({
  id,
  value,
  disabled,
  onChange,
}: {
  id: string;
  value: LinearUnit | "";
  disabled?: boolean;
  onChange: (u: LinearUnit) => void;
}) {
  return (
    <Select
      id={id}
      value={value}
      disabled={disabled}
      onChange={(e) => onChange(e.target.value as LinearUnit)}
    >
      {value === "" && <option value="">Choose…</option>}
      {UNIT_OPTIONS.map((u) => (
        <option key={u.value} value={u.value}>
          {u.label}
        </option>
      ))}
    </Select>
  );
}

export function DesignPlacement({
  inspection,
  form,
  targets,
  onChange,
}: {
  inspection: DesignInspection;
  form: ImportForm;
  targets: Surface[];
  onChange: (form: ImportForm) => void;
}) {
  const set = (patch: Partial<ImportForm>) => onChange({ ...form, ...patch });
  const geotiff = inspection.format === "geotiff";
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
      <Field
        label="Target cloud surface"
        htmlFor="design-target"
        hint="The design lands on this surface's grid and CRS, cell for cell."
        className="sm:col-span-2"
      >
        <Select
          id="design-target"
          value={form.targetSurfaceId}
          onChange={(e) => set({ targetSurfaceId: e.target.value })}
        >
          {targets.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name} · {t.cell_size_m} m cells
            </option>
          ))}
          <option value="">None — keep the design's own CRS</option>
        </Select>
      </Field>
      <Field
        label="Source CRS"
        htmlFor="design-crs"
        hint={crsHint(inspection, form, targets)}
        className="sm:col-span-2"
      >
        <Input
          id="design-crs"
          value={form.sourceCrs}
          onChange={(e) => set({ sourceCrs: e.target.value })}
          placeholder="EPSG:32639"
          className="font-mono"
        />
      </Field>
      <Field
        label="Horizontal units"
        htmlFor="design-hunit"
        hint={geotiff ? "Set by the file's CRS." : inspection.detected?.unit_source}
      >
        <UnitSelect
          id="design-hunit"
          value={form.horizontalUnit}
          disabled={geotiff}
          onChange={(u) => set({ horizontalUnit: u })}
        />
      </Field>
      <Field label="Height units" htmlFor="design-vunit">
        <UnitSelect id="design-vunit" value={form.verticalUnit} onChange={(u) => set({ verticalUnit: u })} />
      </Field>
      <div className="flex flex-col gap-1 sm:col-span-2">
        <Switch
          label="Swap easting and northing"
          checked={form.swapXy}
          onChange={(v) => set({ swapXy: v })}
        />
        {inspection.format === "landxml" && (
          <span className="text-xs text-muted">LandXML stores northing first — already handled</span>
        )}
      </div>
      {!form.targetSurfaceId && (
        <Field label="Cell size (m)" htmlFor="design-cell">
          <Input
            id="design-cell"
            inputMode="decimal"
            value={form.cellSizeM}
            onChange={(e) => set({ cellSizeM: e.target.value })}
          />
        </Field>
      )}
      {pointsSelected(inspection, form) && (
        <Field
          label="Maximum edge length (m)"
          htmlFor="design-maxedge"
          hint="Long triangles at the edges are trimmed; 0 keeps them all."
        >
          <Input
            id="design-maxedge"
            inputMode="decimal"
            placeholder="automatic"
            value={form.maxEdgeM}
            onChange={(e) => set({ maxEdgeM: e.target.value })}
          />
        </Field>
      )}
    </div>
  );
}
```

- [ ] **Step 5: Write `DesignCheck.tsx`**

```tsx
import type { DesignPreview } from "@/api/designSurfaces";
import { Alert, Button, Checkbox } from "@/ui";
import { formatPct } from "./designImport";

function signed(x: number): string {
  return `${x >= 0 ? "+" : "−"}${Math.abs(x).toFixed(2)} m`;
}

export function DesignCheck({
  preview,
  imageUrl,
  accepted,
  onAccept,
  onApply,
  busy,
}: {
  preview: DesignPreview;
  imageUrl: string;
  accepted: boolean;
  onAccept: (v: boolean) => void;
  onApply: (patch: Record<string, unknown>) => void;
  busy: boolean;
}) {
  const hasWarn = preview.warnings.some((w) => w.level === "warn");
  const hasBlock = preview.warnings.some((w) => w.level === "block");
  const out = preview.output;
  const z = preview.z_check;
  return (
    <div className="flex flex-col gap-3">
      {out && (
        <img
          src={imageUrl}
          alt="The design over the cloud surface"
          className="max-h-80 w-full rounded bg-canvas object-contain"
        />
      )}
      <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm tabular-nums">
        <dt className="text-muted">Design on the cloud surface</dt>
        <dd>{formatPct(preview.overlap_fraction)}</dd>
        <dt className="text-muted">Cloud surface covered</dt>
        <dd>{formatPct(preview.target_covered_fraction)}</dd>
        <dt className="text-muted">Height difference (median, P5 … P95)</dt>
        <dd>{z ? `${signed(z.median_dz_m)} (${signed(z.p05_dz_m)} … ${signed(z.p95_dz_m)})` : "—"}</dd>
        <dt className="text-muted">Output grid</dt>
        <dd>
          {out
            ? `${out.width.toLocaleString()} × ${out.height.toLocaleString()} cells at ${out.cell_size_m} m`
            : "—"}
        </dd>
        <dt className="text-muted">Triangles</dt>
        <dd>{preview.triangle_count !== null ? preview.triangle_count.toLocaleString() : "—"}</dd>
      </dl>
      {preview.warnings.map((w) => (
        <Alert key={w.code} tone={w.level === "block" ? "danger" : w.level === "warn" ? "warn" : "info"}>
          {w.message}
        </Alert>
      ))}
      {preview.suggestions.map((s) => (
        <Alert
          key={s.code}
          tone="info"
          title="Suggestion"
          actions={
            <Button size="sm" disabled={busy} onClick={() => onApply(s.options_patch)}>
              Apply
            </Button>
          }
        >
          {s.message}
        </Alert>
      ))}
      {hasWarn && !hasBlock && (
        <Checkbox
          label="Import despite these warnings"
          checked={accepted}
          onChange={(e) => onAccept(e.target.checked)}
        />
      )}
    </div>
  );
}
```

- [ ] **Step 6: Write `ImportDesignDialog.tsx`**

```tsx
import { useEffect, useState, type FormEvent } from "react";
import { useApi, useBackend } from "@/api/client";
import {
  createDesignInspection,
  createDesignPreview,
  createDesignSurface,
  deleteDesignInspection,
  designPreviewImageUrl,
  designThumbnailUrl,
  getDesignInspection,
  getDesignPreview,
  listTargetSurfaces,
  type DesignInspection,
  type DesignPreview,
  type Surface,
} from "@/api/designSurfaces";
import { messageOf } from "@/api/errors";
import { useTrackedJob } from "@/jobs/useTrackedJob";
import { isActiveJob, useJobsStore } from "@/store/jobs";
import { Alert, Button, Dialog, Field, Input, Pill, Progress } from "@/ui";
import { DesignCheck } from "./DesignCheck";
import { DesignContents } from "./DesignContents";
import { DesignPlacement } from "./DesignPlacement";
import {
  applyPatch,
  defaultName,
  importGate,
  initialForm,
  isStale,
  toRequest,
  type ImportForm,
} from "./designImport";

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-3 border-t border-line pt-4 first:border-t-0 first:pt-0">
      <h3 className="text-sm font-semibold text-ink">{title}</h3>
      {children}
    </section>
  );
}

export function ImportDesignDialog({
  projectId,
  onClose,
  onStarted,
}: {
  projectId: string;
  onClose: () => void;
  onStarted: (surface: Surface) => void;
}) {
  const api = useApi();
  const { mode, baseUrl, token } = useBackend();
  const [path, setPath] = useState("");
  const [fileError, setFileError] = useState<string | null>(null);
  const [inspection, setInspection] = useState<DesignInspection | null>(null);
  const [targets, setTargets] = useState<Surface[]>([]);
  const [form, setForm] = useState<ImportForm | null>(null);
  const [preview, setPreview] = useState<DesignPreview | null>(null);
  const [previewedKey, setPreviewedKey] = useState<string | null>(null);
  const [accepted, setAccepted] = useState(false);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState<"read" | "preview" | "import" | null>(null);
  const [error, setError] = useState<string | null>(null);

  const inspectJob = useTrackedJob(projectId, inspection?.state === "inspecting" ? inspection.job_id : null);
  const previewJob = useTrackedJob(projectId, preview?.state === "running" ? preview.job_id : null);
  const inspectDone = inspectJob.job !== null && !isActiveJob(inspectJob.job);
  const previewDone = previewJob.job !== null && !isActiveJob(previewJob.job);

  useEffect(() => {
    let cancelled = false;
    listTargetSurfaces(api, projectId)
      .then((t) => !cancelled && setTargets(t))
      .catch(() => !cancelled && setTargets([]));
    return () => {
      cancelled = true;
    };
  }, [api, projectId]);

  useEffect(() => {
    if (!inspection || inspection.state !== "inspecting" || !inspectDone) return;
    let cancelled = false;
    getDesignInspection(api, projectId, inspection.id)
      .then((next) => {
        if (cancelled || next.state === "inspecting") return;
        setInspection(next);
        if (next.state === "ready") {
          const f = initialForm(next, targets);
          setForm(f);
          setName(defaultName(next, f));
        }
      })
      .catch((e: unknown) => !cancelled && setFileError(messageOf(e, "could not load the file's contents")));
    return () => {
      cancelled = true;
    };
  }, [api, projectId, inspection, inspectDone, targets]);

  useEffect(() => {
    if (!inspection || !preview || preview.state !== "running" || !previewDone) return;
    let cancelled = false;
    getDesignPreview(api, projectId, inspection.id, preview.id)
      .then((next) => {
        if (!cancelled && next.state !== "running") setPreview(next);
      })
      .catch((e: unknown) => !cancelled && setError(messageOf(e, "could not load the preview")));
    return () => {
      cancelled = true;
    };
  }, [api, projectId, inspection, preview, previewDone]);

  const stale = form !== null && isStale(form, preview, previewedKey);
  const gate = importGate(preview, stale, accepted);

  function discard() {
    if (inspection) void deleteDesignInspection(api, projectId, inspection.id).catch(() => undefined);
  }

  function close() {
    if (busy === "import") return;
    discard();
    onClose();
  }

  async function browse() {
    const { open } = await import("@tauri-apps/plugin-dialog");
    const picked = await open({
      multiple: false,
      filters: [{ name: "Design surface", extensions: ["dxf", "xml", "landxml", "tif", "tiff"] }],
    });
    if (typeof picked === "string") setPath(picked);
  }

  async function readFile() {
    if (!path.trim()) return setFileError("Choose the design file.");
    setBusy("read");
    setFileError(null);
    setError(null);
    discard();
    setInspection(null);
    setForm(null);
    setPreview(null);
    try {
      const r = await createDesignInspection(api, projectId, path.trim());
      useJobsStore.getState().upsert(r.job);
      setInspection(r.inspection);
    } catch (e) {
      setFileError(messageOf(e, "could not read the file"));
    } finally {
      setBusy(null);
    }
  }

  async function runPreview(next: ImportForm) {
    if (!inspection) return;
    const r = toRequest(next);
    if (!r.ok) return setError(r.error);
    setBusy("preview");
    setError(null);
    try {
      const res = await createDesignPreview(api, projectId, inspection.id, r.body);
      useJobsStore.getState().upsert(res.job);
      setPreview(res.preview);
      setPreviewedKey(JSON.stringify(r.body));
      setAccepted(false);
    } catch (e) {
      setError(messageOf(e, "could not start the preview"));
    } finally {
      setBusy(null);
    }
  }

  function applySuggestion(patch: Record<string, unknown>) {
    if (!form) return;
    const next = applyPatch(form, patch);
    setForm(next);
    void runPreview(next);
  }

  async function importSurface(e: FormEvent) {
    e.preventDefault();
    if (!inspection || !preview || !gate.allowed) return;
    setBusy("import");
    setError(null);
    try {
      const res = await createDesignSurface(api, projectId, {
        inspection_id: inspection.id,
        preview_id: preview.id,
        accept_warnings: accepted,
        ...(name.trim() ? { name: name.trim() } : {}),
      });
      useJobsStore.getState().upsert(res.job);
      onStarted(res.surface);
    } catch (err) {
      setError(messageOf(err, "could not start the import"));
    } finally {
      setBusy(null);
    }
  }

  const ready = inspection?.state === "ready" && form !== null;
  return (
    <Dialog
      open
      width="lg"
      title="Import design surface"
      description="A DEM GeoTIFF, a LandXML TIN or a DXF with 3D faces or contours. The file is only read; nothing is imported until you check the preview."
      onClose={close}
      onSubmit={(e) => void importSurface(e)}
      footer={
        <>
          <Button onClick={close} disabled={busy === "import"}>
            Cancel
          </Button>
          <Button
            type="submit"
            variant="primary"
            icon="import"
            loading={busy === "import"}
            disabled={!gate.allowed}
          >
            Import surface
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <Section title="File">
          <Field
            label="Design file"
            htmlFor="design-path"
            error={fileError}
            hint="DXF, LandXML (.xml) or GeoTIFF."
          >
            <div className="flex gap-2">
              <Input
                id="design-path"
                value={path}
                onChange={(e) => setPath(e.target.value)}
                placeholder="D:\designs\site.xml"
                className="min-w-0 flex-1 font-mono"
              />
              {mode === "tauri" && <Button onClick={() => void browse()}>Browse</Button>}
              <Button onClick={() => void readFile()} loading={busy === "read"}>
                Read file
              </Button>
            </div>
          </Field>
          {inspection?.state === "inspecting" && (
            <Progress
              value={inspectJob.job?.progress}
              running
              label={inspectJob.job?.message || "Reading design file"}
            />
          )}
          {inspection?.state === "failed" && <Alert tone="danger">{inspection.error}</Alert>}
        </Section>

        {ready && inspection && form && (
          <>
            <Section title="Contents">
              <DesignContents
                inspection={inspection}
                selected={form.candidateIds}
                onChange={(ids) => setForm({ ...form, candidateIds: ids })}
                thumbUrl={(cid) => designThumbnailUrl(baseUrl, token, projectId, inspection.id, cid)}
              />
            </Section>
            <Section title="Placement">
              <DesignPlacement inspection={inspection} form={form} targets={targets} onChange={setForm} />
              <div className="flex items-center gap-3">
                <Button
                  onClick={() => void runPreview(form)}
                  loading={busy === "preview"}
                  disabled={
                    preview?.state === "running" || (preview !== null && !stale && preview.state !== "failed")
                  }
                >
                  Preview
                </Button>
                {stale && <Pill tone="warn">Preview out of date</Pill>}
              </div>
              {error && <Alert tone="danger">{error}</Alert>}
            </Section>
          </>
        )}

        {preview && inspection && (
          <Section title="Check">
            {preview.state === "running" && (
              <Progress
                value={previewJob.job?.progress}
                running
                label={previewJob.job?.message || "Previewing design"}
              />
            )}
            {preview.state === "failed" && <Alert tone="danger">{preview.error}</Alert>}
            {preview.state === "ready" && (
              <>
                <DesignCheck
                  preview={preview}
                  imageUrl={designPreviewImageUrl(baseUrl, token, projectId, inspection.id, preview.id)}
                  accepted={accepted}
                  onAccept={setAccepted}
                  onApply={applySuggestion}
                  busy={busy !== null}
                />
                <Field label="Name" htmlFor="design-name">
                  <Input id="design-name" value={name} onChange={(e) => setName(e.target.value)} />
                </Field>
              </>
            )}
            {gate.reason && preview.state === "ready" && <p className="text-sm text-muted">{gate.reason}</p>}
          </Section>
        )}
      </div>
    </Dialog>
  );
}
```

- [ ] **Step 7: Run the tests to verify they pass**

Run: `pnpm -C frontend exec vitest run src/surfaces`
Expected: PASS (the Task 3 tests and the six dialog tests). If `Switch` does not render `role="switch"`, read `frontend/src/ui/Switch.tsx` and query it the way `Controls.test.tsx` does — do not change the primitive. Then `pnpm -C frontend lint` (eslint, prettier, check-tokens) clean.

- [ ] **Step 8: Commit**

```
git add frontend/src/surfaces/ImportDesignDialog.tsx frontend/src/surfaces/DesignContents.tsx frontend/src/surfaces/DesignPlacement.tsx frontend/src/surfaces/DesignCheck.tsx frontend/src/surfaces/ImportDesignDialog.test.tsx
git commit -m "feat(design): the Import design surface dialog" -m "Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---
### Task 7: LandXML reader

**Files:**
- Create: `backend/app/surfaces/design/landxml.py`
- Create: `backend/tests/design_landxml.py`
- Test: `backend/tests/test_design_landxml.py`

**Interfaces:**
- Consumes: Task 1 (`store.CandidateWriter`, `store.candidate_dir`, `store.read_candidate`, `store.thumb_path`, `thumbs.plan_thumbnail`, `codes.block`, `inspection.*`, `units.LANDXML_UNITS`); Task 4 (reader contract, `phase_inspect.READERS["landxml"]`).
- Produces:
  - `landxml.inspect_file(path, idir, *, progress, check_cancelled) -> InspectResult`: one `tin_surface` candidate per `<Surface>` in file order (`c0`, `c1`, …), geometry `faces` (or `points` when it has no faces), `entity_counts = {"invisible_faces": n}`, `internal = {"units": {...}, "coordinate_system": {...}}`.
  - `tests/design_landxml.py`: `write_landxml(path, surfaces, *, version="1.2", units=("Metric", "meter", None), crs={"epsgCode": "32639"}, order="NEZ", units_after_crs=False, bom=False, crlf=False) -> Path`, `grid_tin(nx, ny, spacing=1.0, e0=E0, n0=N0, z=plane_z) -> tuple[points, faces]`.

- [ ] **Step 1: Write the fixture writer**

`backend/tests/design_landxml.py`:

```python
"""Tiny LandXML files written from string templates at test time (spec §15.3 LandXML)."""

from __future__ import annotations

from pathlib import Path
from xml.sax.saxutils import quoteattr

import numpy as np
from designs import E0, N0, plane_z

NAMESPACES = {
    "1.0": "http://www.landxml.org/schema/LandXML-1.0",
    "1.1": "http://www.landxml.org/schema/LandXML-1.1",
    "1.2": "http://www.landxml.org/schema/LandXML-1.2",
    "2.0": "http://www.landxml.org/schema/LandXML-2.0",
}


def grid_tin(nx: int, ny: int, spacing: float = 1.0, e0: float = E0, n0: float = N0, z=plane_z):
    """(points as E, N, Z; faces as 0-based index triples) of a regular grid TIN."""
    e, n = np.meshgrid(e0 + np.arange(nx) * spacing, n0 + np.arange(ny) * spacing)
    pts = np.column_stack([e.ravel(), n.ravel(), z(e.ravel(), n.ravel())])
    i, j = np.meshgrid(np.arange(nx - 1), np.arange(ny - 1))
    a = (j * nx + i).ravel()
    faces = np.vstack([np.column_stack([a, a + 1, a + nx + 1]), np.column_stack([a, a + nx + 1, a + nx])])
    return pts, faces


def write_landxml(
    path: Path,
    surfaces: list[dict],
    *,
    version: str | None = "1.2",
    units: tuple[str, str, str | None] | None = ("Metric", "meter", None),
    crs: dict | None = None,
    order: str = "NEZ",
    units_after_crs: bool = False,
    bom: bool = False,
    crlf: bool = False,
) -> Path:
    """surfaces: [{"name", "points" (N x 3, E N Z), "faces" (M x 3, 0-based), optional "ids"
    (list, or "none" to omit the id attribute), "invisible" (face indices), "surf_type", "raw_points"
    (strings used verbatim as P texts)}]. `crs` defaults to {"epsgCode": "32639"}; pass {} for none."""
    crs = {"epsgCode": "32639"} if crs is None else crs
    xmlns = f' xmlns="{NAMESPACES[version]}"' if version else ""
    out = ['<?xml version="1.0" encoding="UTF-8"?>', f'<LandXML{xmlns} version="{version or "1.2"}">']
    unit_xml = ""
    if units:
        elev = f" elevationUnit={quoteattr(units[2])}" if units[2] else ""
        unit_xml = f"<Units><{units[0]} linearUnit={quoteattr(units[1])}{elev}/></Units>"
    crs_xml = (
        "<CoordinateSystem " + " ".join(f"{k}={quoteattr(v)}" for k, v in crs.items()) + "/>" if crs else ""
    )
    out += [crs_xml, unit_xml] if units_after_crs else [unit_xml, crs_xml]
    out.append("<Surfaces>")
    for s in surfaces:
        out.append(
            f'<Surface name={quoteattr(s["name"])}><Definition surfType="{s.get("surf_type", "TIN")}"><Pnts>'
        )
        pts = np.asarray(s.get("points", np.zeros((0, 3))))
        ids = s.get("ids") or list(range(1, len(pts) + 1))
        if "raw_points" in s:
            out += [f'<P id="{k + 1}">{t}</P>' for k, t in enumerate(s["raw_points"])]
        for k, (e, n, z) in enumerate(pts):
            a, b = (n, e) if order == "NEZ" else (e, n)
            attr = "" if ids == "none" else f' id="{ids[k]}"'
            out.append(f"<P{attr}>{a:.4f} {b:.4f} {z:.4f}</P>")
        out.append("</Pnts><Faces>")
        seq = list(range(1, len(pts) + 1)) if ids == "none" else ids
        for k, f in enumerate(s.get("faces", [])):
            flag = ' i="1"' if k in set(s.get("invisible", ())) else ""
            out.append(f"<F{flag}>{seq[f[0]]} {seq[f[1]]} {seq[f[2]]}</F>")
        out.append("</Faces></Definition></Surface>")
    out += ["</Surfaces>", "</LandXML>"]
    data = ("\r\n" if crlf else "\n").join(out).encode("utf-8")
    path.write_bytes((b"\xef\xbb\xbf" if bom else b"") + data)
    return path
```

- [ ] **Step 2: Write the failing tests**

`backend/tests/test_design_landxml.py`:

```python
"""The streamed LandXML reader (spec §7, §15.3 LandXML, §16.2, §16.3, §16.5)."""

import tracemalloc

import numpy as np
import pytest
from design_landxml import grid_tin, write_landxml
from designs import E0, N0
from pyproj import CRS

from app.jobs.cancellation import JobFailure
from app.surfaces.design import landxml, store
from app.surfaces.design.units import unit_to_m


@pytest.fixture
def project_kind() -> str:
    """Design surfaces are detection work: F0 guards the router with require_kind(("detect",), ANY_KIND)."""
    return "detect"


def read(path, tmp_path):
    idir = tmp_path / "insp"
    idir.mkdir(exist_ok=True)
    return landxml.inspect_file(path, idir, progress=lambda f, m: None, check_cancelled=lambda: None), idir


@pytest.mark.parametrize("version", [None, "1.0", "1.2", "2.0"])
def test_every_namespace_reads(tmp_path, version):
    pts, faces = grid_tin(5, 4)
    src = write_landxml(tmp_path / "s.xml", [{"name": "EG", "points": pts, "faces": faces}], version=version)
    res, _ = read(src, tmp_path)
    (c,) = res.candidates
    assert (c.id, c.kind, c.name, c.geometry) == ("c0", "tin_surface", "EG", "faces")
    assert (c.point_count, c.face_count) == (20, len(faces)) and c.default_selected


def test_points_are_northing_easting_elevation(tmp_path):
    e = np.array([E0, E0 + 100, E0 + 100, E0])
    n = np.array([N0, N0, N0 + 50, N0 + 50])
    pts = np.column_stack([e, n, [1.0, 2.0, 3.0, 4.0]])
    src = write_landxml(tmp_path / "s.xml", [{"name": "EG", "points": pts, "faces": [[0, 1, 2], [0, 2, 3]]}])
    res, idir = read(src, tmp_path)
    assert res.candidates[0].bounds_file == [E0, N0, E0 + 100, N0 + 50]
    cached = store.read_candidate(store.candidate_dir(idir, "c0")).points
    assert cached[:, 0].min() == E0 and cached[:, 1].max() == N0 + 50  # x = easting, the 2nd value


def test_invisible_faces_and_sparse_ids(tmp_path):
    pts, faces = grid_tin(3, 3)
    ids = [10 * (k + 7) for k in range(len(pts))]
    src = write_landxml(
        tmp_path / "s.xml", [{"name": "EG", "points": pts, "faces": faces, "ids": ids, "invisible": [0]}]
    )
    res, idir = read(src, tmp_path)
    c = res.candidates[0]
    assert c.face_count == len(faces) - 1 and c.entity_counts == {"invisible_faces": 1}
    a = store.read_candidate(store.candidate_dir(idir, "c0"))
    np.testing.assert_allclose(a.points[a.faces[0]][:, :2], pts[faces[1]][:, :2])


def test_points_without_ids_take_their_sequence_number(tmp_path):
    pts, faces = grid_tin(3, 2)
    src = write_landxml(tmp_path / "s.xml", [{"name": "EG", "points": pts, "faces": faces, "ids": "none"}])
    res, idir = read(src, tmp_path)
    a = store.read_candidate(store.candidate_dir(idir, "c0"))
    assert a.faces.tolist() == faces.tolist()


@pytest.mark.parametrize(
    ("surface", "message"),
    [
        ({"ids": [1, 2, 3], "faces": [[0, 1, 2]], "missing": True}, "face refers to missing point 999"),
        ({"ids": [1, 2, 2], "faces": [[0, 1, 2]]}, "duplicate point id 2"),
    ],
)
def test_broken_ids_fail_with_the_defect(tmp_path, surface, message):
    pts = np.array([[E0, N0, 1], [E0 + 1, N0, 1], [E0, N0 + 1, 1]], float)
    s = {"name": "EG", "points": pts, "ids": surface["ids"], "faces": surface["faces"]}
    src = write_landxml(tmp_path / "s.xml", [s])
    if surface.get("missing"):
        src.write_text(src.read_text().replace("<F>1 2 3</F>", "<F>1 2 999</F>"))
    with pytest.raises(JobFailure, match=message):
        read(src, tmp_path)


def test_points_without_elevations_fail(tmp_path):
    src = write_landxml(tmp_path / "s.xml", [{"name": "EG", "raw_points": ["2800000 500000"], "faces": []}])
    with pytest.raises(JobFailure, match="surface 'EG' has points without elevations"):
        read(src, tmp_path)


def test_non_numeric_points_fail(tmp_path):
    src = write_landxml(
        tmp_path / "s.xml", [{"name": "EG", "raw_points": ["2800000 500000 nan"], "faces": []}]
    )
    with pytest.raises(JobFailure, match="not three numbers"):
        read(src, tmp_path)


def test_grid_and_points_only_surfaces_are_blocked(tmp_path):
    pts, faces = grid_tin(3, 3)
    src = write_landxml(
        tmp_path / "s.xml",
        [
            {"name": "Grid", "points": pts, "faces": faces, "surf_type": "grid"},
            {"name": "Pts", "points": pts, "faces": []},
        ],
    )
    res, _ = read(src, tmp_path)
    grid_c, pts_c = res.candidates
    assert [n.to_json() for n in grid_c.notes] == [
        {"code": "not_tin", "level": "block", "message": "grid-type LandXML surfaces aren't supported"}
    ]
    assert pts_c.notes[0].message == "points only — no triangles" and pts_c.geometry == "points"
    assert not grid_c.default_selected and not pts_c.default_selected


def test_two_surfaces_are_two_candidates_and_the_bigger_is_default(tmp_path):
    small, big = grid_tin(3, 3), grid_tin(6, 6)
    src = write_landxml(
        tmp_path / "s.xml",
        [
            {"name": "Small", "points": small[0], "faces": small[1]},
            {"name": "Big", "points": big[0], "faces": big[1]},
        ],
    )
    res, _ = read(src, tmp_path)
    assert [(c.id, c.name, c.default_selected) for c in res.candidates] == [
        ("c0", "Small", False),
        ("c1", "Big", True),
    ]


@pytest.mark.parametrize(
    ("units", "h", "v", "z100"),
    [
        (("Metric", "meter", None), "metre", "metre", 100.0),
        (("Metric", "meter", "millimeter"), "metre", "millimetre", 0.1),
        (("Imperial", "foot", None), "international_foot", "international_foot", 30.48),
        (("Imperial", "USSurveyFoot", None), "us_survey_foot", "us_survey_foot", 30.480060960121920),
    ],
)
def test_units(tmp_path, units, h, v, z100):
    pts, faces = grid_tin(2, 2)
    res, _ = read(
        write_landxml(tmp_path / "s.xml", [{"name": "EG", "points": pts, "faces": faces}], units=units),
        tmp_path,
    )
    d = res.detected
    assert (d.horizontal_unit, d.vertical_unit) == (h, v)
    assert d.unit_source == f"LandXML <{units[0]} linearUnit={units[1]}>"
    assert 100 * unit_to_m(d.vertical_unit) == pytest.approx(z100, rel=1e-12)


def test_coordinate_system_epsg_wkt_and_absent(tmp_path):
    pts, faces = grid_tin(2, 2)
    s = [{"name": "EG", "points": pts, "faces": faces}]
    by_code, _ = read(
        write_landxml(tmp_path / "a.xml", s, crs={"epsgCode": "32639", "name": "UTM 39N"}), tmp_path
    )
    assert (
        by_code.detected.epsg == 32639
        and by_code.detected.crs_source == "LandXML <CoordinateSystem epsgCode>"
    )
    assert by_code.detected.crs_hint == "UTM 39N"
    wkt = CRS.from_epsg(32639).to_wkt()
    by_wkt, _ = read(write_landxml(tmp_path / "b.xml", s, crs={"ogcWktCode": wkt}), tmp_path)
    assert (
        by_wkt.detected.epsg == 32639
        and by_wkt.detected.crs_source == "LandXML <CoordinateSystem ogcWktCode>"
    )
    none, _ = read(write_landxml(tmp_path / "c.xml", s, crs={}), tmp_path)
    assert none.detected.crs_wkt is None and none.detected.crs_source is None


def test_bom_crlf_and_units_after_the_crs(tmp_path):
    pts, faces = grid_tin(3, 3)
    src = write_landxml(
        tmp_path / "s.xml",
        [{"name": "EG", "points": pts, "faces": faces}],
        units=("Imperial", "USSurveyFoot", None),
        units_after_crs=True,
        bom=True,
        crlf=True,
    )
    res, _ = read(src, tmp_path)
    assert res.detected.horizontal_unit == "us_survey_foot" and res.candidates[0].face_count == len(faces)


def test_parse_memory_stays_flat(tmp_path):
    pts, faces = grid_tin(548, 548)
    assert len(pts) > 300_000
    src = write_landxml(tmp_path / "big.xml", [{"name": "EG", "points": pts, "faces": faces}])
    del pts, faces
    tracemalloc.start()
    base = tracemalloc.get_traced_memory()[0]
    res, _ = read(src, tmp_path)
    peak = tracemalloc.get_traced_memory()[1] - base
    tracemalloc.stop()
    assert res.candidates[0].point_count == 548 * 548
    assert peak < 50 * 2**20, f"parse peak {peak / 2**20:.0f} MB"


def test_inspect_through_the_api(client, project_id, wait_job, tmp_path):
    pts, faces = grid_tin(10, 10)
    src = write_landxml(tmp_path / "site.xml", [{"name": "EG", "points": pts, "faces": faces}])
    body = client.post(f"/api/v1/projects/{project_id}/design-inspections", json={"path": str(src)}).json()
    assert wait_job(project_id, body["job"]["id"])["state"] == "succeeded"
    iid = body["inspection"]["id"]
    got = client.get(f"/api/v1/projects/{project_id}/design-inspections/{iid}").json()
    assert got["detected"]["epsg"] == 32639 and got["candidates"][0]["face_count"] == len(faces)
    t = client.get(f"/api/v1/projects/{project_id}/design-inspections/{iid}/candidates/c0/thumbnail")
    assert t.status_code == 200
```

- [ ] **Step 3: Run the tests to verify they fail**

Run from `backend`: `$PY -m pytest tests/test_design_landxml.py -v`
Expected: FAIL with `ModuleNotFoundError: No module named 'app.surfaces.design.landxml'` (and the API test with a failed inspect job).

- [ ] **Step 4: Write `landxml.py`**

```python
"""LandXML reader (spec §7.1): a streamed iterparse into the candidate cache.

Elements are matched by local name, so LandXML 1.0/1.1/1.2/2.0 and namespace-less files all read.
`P` holds northing, easting, elevation: each point is cached as (x = E, y = N, z). Memory stays flat:
values accumulate in `array` buffers flushed every 1 M rows, every element is cleared at its end,
and Pnts/Faces are cleared every 10 000 rows so iterparse's tree never holds the parsed children.
Python 3.11's bundled expat refuses entity-expansion attacks; ElementTree never resolves external
entities.
"""

from __future__ import annotations

import math
import xml.etree.ElementTree as ET
from array import array
from pathlib import Path

import numpy as np
from pyproj import CRS
from pyproj.exceptions import CRSError

from app.jobs.cancellation import JobFailure
from app.surfaces.design import codes, store, thumbs
from app.surfaces.design.inspection import Detected, InspectResult, candidate_from_meta
from app.surfaces.design.units import LANDXML_UNITS

FLUSH_ROWS = 1_000_000
CLEAR_EVERY = 10_000
RESOLVE_CHUNK = 262_144  # faces per id-resolution chunk
MESSAGE = "Reading design file"


def _local(tag) -> str:
    return tag.rsplit("}", 1)[-1] if isinstance(tag, str) else ""


def _id(value: str, surface: str) -> int:
    try:
        return int(value)
    except ValueError:
        try:
            f = float(value)
        except ValueError:
            f = float("nan")
        if f == f and f.is_integer():
            return int(f)
        raise JobFailure(f"surface '{surface}': point id '{value}' is not a number") from None


class _Surface:
    """One <Surface>: points and raw face ids stream to disk; ids are resolved at its end."""

    def __init__(self, idir: Path, cid: str, name: str):
        self.cid, self.name = cid, name
        self.cdir = store.candidate_dir(idir, cid)
        self.writer = store.CandidateWriter(self.cdir, "faces")
        self._ids_f = (self.cdir / "ids.i64").open("wb")
        self._fids_f = (self.cdir / "faces_ids.i64").open("wb")
        self._pts, self._ids, self._fids = array("d"), array("q"), array("q")
        self.seq = 0
        self.invisible = 0
        self.surf_type = "TIN"
        self.containers: list = []

    def add_point(self, text: str, pid: str | None) -> None:
        vals = text.split()
        if len(vals) < 3:
            raise JobFailure(f"surface '{self.name}' has points without elevations")
        try:
            n, e, z = float(vals[0]), float(vals[1]), float(vals[2])
        except ValueError:
            raise JobFailure(
                f"surface '{self.name}': a point reads '{text.strip()[:60]}', not three numbers"
            ) from None
        if not (math.isfinite(n) and math.isfinite(e) and math.isfinite(z)):
            raise JobFailure(f"surface '{self.name}': a point reads '{text.strip()[:60]}', not three numbers")
        self._pts.extend((e, n, z))
        self.seq += 1
        self._ids.append(self.seq if pid is None else _id(pid, self.name))
        if len(self._ids) >= FLUSH_ROWS:
            self._flush()

    def add_face(self, text: str, invisible: bool) -> None:
        if invisible:
            self.invisible += 1
            return
        vals = text.split()
        if len(vals) < 3:
            raise JobFailure(f"surface '{self.name}': a face lists fewer than three points")
        self._fids.extend((_id(vals[0], self.name), _id(vals[1], self.name), _id(vals[2], self.name)))
        if len(self._fids) >= 3 * FLUSH_ROWS:
            self._flush()

    def clear_containers(self) -> None:
        for el in self.containers:
            el.clear()

    def _flush(self) -> None:
        if self._ids:
            self.writer.add_points(np.frombuffer(self._pts, dtype=np.float64).reshape(-1, 3))
            self._ids_f.write(self._ids.tobytes())
            self._pts, self._ids = array("d"), array("q")
        if self._fids:
            self._fids_f.write(self._fids.tobytes())
            self._fids = array("q")

    def finish(self, check_cancelled) -> dict:
        self._flush()
        self._ids_f.close()
        self._fids_f.close()
        try:
            self._resolve(check_cancelled)
        finally:
            meta = self.writer.close()
            for name in ("ids.i64", "faces_ids.i64"):
                (self.cdir / name).unlink(missing_ok=True)
        return meta

    def _resolve(self, check_cancelled) -> None:
        """Face ids -> vertex indices with argsort + searchsorted (spec §7.1 "Resolving ids")."""
        ids = np.fromfile(self.cdir / "ids.i64", dtype=np.int64)
        order = np.argsort(ids, kind="stable")
        sorted_ids = ids[order]
        del ids
        dup = np.flatnonzero(sorted_ids[1:] == sorted_ids[:-1])
        if dup.size:
            raise JobFailure(f"surface '{self.name}': duplicate point id {int(sorted_ids[dup[0]])}")
        n = len(sorted_ids)
        with (self.cdir / "faces_ids.i64").open("rb") as f:
            while True:
                check_cancelled()
                chunk = np.fromfile(f, dtype=np.int64, count=3 * RESOLVE_CHUNK)
                if chunk.size == 0:
                    return
                pos = np.searchsorted(sorted_ids, chunk)
                pc = np.minimum(pos, max(n - 1, 0))
                bad = np.ones(chunk.size, bool) if n == 0 else (pos >= n) | (sorted_ids[pc] != chunk)
                if bad.any():
                    raise JobFailure(
                        f"surface '{self.name}': face refers to missing point {int(chunk[bad][0])}"
                    )
                self.writer.add_faces(order[pc].reshape(-1, 3))


def _detected(units: dict, cs: dict) -> Detected:
    lin, elev = units.get("linearUnit"), units.get("elevationUnit")
    h = LANDXML_UNITS.get(lin) if lin else None
    v = LANDXML_UNITS.get(elev) if elev else h
    source = f"LandXML <{units['system']} linearUnit={lin}>" if lin else "none"
    crs_wkt = epsg = crs_source = None
    if cs.get("epsgCode"):
        try:
            crs = CRS.from_epsg(int(cs["epsgCode"]))
            crs_wkt, epsg, crs_source = (
                crs.to_wkt(),
                int(cs["epsgCode"]),
                "LandXML <CoordinateSystem epsgCode>",
            )
        except (ValueError, CRSError):
            pass
    if crs_wkt is None and cs.get("ogcWktCode"):
        try:
            crs = CRS.from_wkt(cs["ogcWktCode"])
            crs_wkt, epsg, crs_source = crs.to_wkt(), crs.to_epsg(), "LandXML <CoordinateSystem ogcWktCode>"
        except CRSError:
            pass
    hint = [cs[k] for k in ("name", "horizontalCoordinateSystemName") if cs.get(k)]
    if cs.get("verticalDatum"):
        hint.append(f"vertical datum {cs['verticalDatum']}")
    return Detected(
        h.value if h else None,
        v.value if v else None,
        source,
        crs_wkt=crs_wkt,
        epsg=epsg,
        crs_source=crs_source,
        crs_hint="; ".join(hint) or None,
    )


def inspect_file(path: Path, idir: Path, *, progress, check_cancelled) -> InspectResult:
    size = max(path.stat().st_size, 1)
    units: dict = {}
    cs: dict = {}
    surfaces: list[_Surface] = []
    metas: list[dict] = []
    cur: _Surface | None = None
    stack: list[str] = []
    rows = 0
    try:
        with path.open("rb") as f:
            for event, elem in ET.iterparse(f, events=("start", "end")):
                name = _local(elem.tag)
                if event == "start":
                    parent = stack[-1] if stack else None
                    stack.append(name)
                    if name == "Surface" and parent == "Surfaces":
                        cur = _Surface(
                            idir, f"c{len(surfaces)}", elem.get("name") or f"Surface {len(surfaces) + 1}"
                        )
                        surfaces.append(cur)
                    elif cur is not None and name == "Definition":
                        cur.surf_type = elem.get("surfType", "TIN")
                    elif cur is not None and name in ("Pnts", "Faces"):
                        cur.containers.append(elem)
                    continue
                stack.pop()
                parent = stack[-1] if stack else None
                if cur is not None and name in ("P", "F") and parent in ("Pnts", "Faces"):
                    if name == "P":
                        cur.add_point(elem.text or "", elem.get("id"))
                    else:
                        cur.add_face(elem.text or "", elem.get("i") == "1")
                    elem.clear()
                    rows += 1
                    if rows % CLEAR_EVERY == 0:
                        cur.clear_containers()
                        check_cancelled()
                        progress(min(0.9, f.tell() / size), MESSAGE)
                    continue
                if name in ("Metric", "Imperial") and parent == "Units":
                    units = {"system": name, **elem.attrib}
                elif name == "CoordinateSystem" and parent == "LandXML":
                    cs = dict(elem.attrib)
                elif name == "Surface" and cur is not None and parent == "Surfaces":
                    metas.append(cur.finish(check_cancelled))
                    cur = None
                if name != "LandXML":
                    elem.clear()
    except ET.ParseError as e:
        raise JobFailure(f"{path.name} is not valid XML ({e})") from None
    if not surfaces:
        raise JobFailure(f"{path.name} has no <Surface>: there is no TIN to import")
    most = max(
        (m["face_count"] for s, m in zip(surfaces, metas, strict=True) if s.surf_type.upper() == "TIN"),
        default=0,
    )
    candidates, chosen = [], False
    for s, meta in zip(surfaces, metas, strict=True):
        notes = []
        if s.surf_type.upper() != "TIN":
            notes.append(codes.block("not_tin", "grid-type LandXML surfaces aren't supported"))
        elif meta["face_count"] == 0:
            notes.append(codes.block("not_tin", "points only — no triangles"))
        default = not notes and not chosen and meta["face_count"] == most
        chosen = chosen or default
        candidates.append(
            candidate_from_meta(
                s.cid,
                "tin_surface",
                s.name,
                meta,
                geometry="faces" if meta["face_count"] else "points",
                entity_counts={"invisible_faces": s.invisible},
                default_selected=default,
                notes=notes,
            )
        )
        points = store.read_candidate(store.candidate_dir(idir, s.cid)).points
        thumbs.plan_thumbnail(points, store.thumb_path(idir, s.cid))
        del points
    progress(1.0, MESSAGE)
    return InspectResult(_detected(units, cs), candidates, internal={"units": units, "coordinate_system": cs})
```

- [ ] **Step 5: Run the tests to verify they pass**

Run from `backend`: `$PY -m pytest tests/test_design_landxml.py -v`
Expected: PASS (all parametrised cases; the memory test takes ~15 s).

- [ ] **Step 6: Commit**

```
git add backend/app/surfaces/design/landxml.py backend/tests/design_landxml.py backend/tests/test_design_landxml.py
git commit -m "feat(design): streamed LandXML reader with the northing-first rule" -m "Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 8: DXF reader, `design-selftest` and the frozen-bundle smoke step

**Files:**
- Create: `backend/app/surfaces/design/dxf.py`
- Replace (F0 placeholder): `backend/app/surfaces/design/selftest.py`
- Modify: `backend/scripts/smoke_frozen.ps1` (one step after the `geo` step)
- Create: `backend/tests/design_dxf.py`
- Test: `backend/tests/test_design_dxf.py`, `backend/tests/test_design_selftest.py`
- Modify: `backend/tests/test_pointcloud_foundation.py` (F0's placeholder test: `design-selftest` leaves its parametrize)

**Interfaces:**
- Consumes: Task 1 (`admission`, `codes`, `store`, `thumbs`, `inspection`, `units.INSUNITS`); Task 4 (reader contract); Task 5 (`tests/designs.cone_contour_runs`, test only); Task 2 (`rasterise_to_array`, test only).
- Produces:
  - `dxf.DXF_RAM_FACTOR = 12`, `dxf.ENTITY_KEYS`, `dxf.inspect_file(path, idir, *, progress, check_cancelled) -> InspectResult`: one `dxf_layer` candidate per layer, sorted by layer name; `internal = {"insunits": int}`.
  - `selftest.run() -> dict`, `selftest.main() -> int` printing `design ok <faces> <triangles>`.
  - `tests/design_dxf.py`: `new_doc(insunits=6, version="R2010")`, `save(doc, path, *, binary=False) -> Path`, `add_faces(msp, v, t, layer)`, `add_contours(msp, pts, runs, layer, kind="polyline3d" | "lwpolyline")`, `inject_unknown(path, dxftype, layer, owner)`.

- [ ] **Step 1: Write the fixture helpers**

`backend/tests/design_dxf.py`:

```python
"""Tiny DXF files written with ezdxf at test time (spec §15.3 DXF)."""

from __future__ import annotations

from pathlib import Path

import ezdxf
import numpy as np


def new_doc(insunits: int = 6, version: str = "R2010"):
    doc = ezdxf.new(version)
    doc.header["$INSUNITS"] = insunits
    return doc


def save(doc, path: Path, *, binary: bool = False) -> Path:
    doc.saveas(path, fmt="bin" if binary else "asc")
    return path


def add_faces(msp, v: np.ndarray, t: np.ndarray, layer: str = "TIN") -> None:
    for tri in t:
        msp.add_3dface([tuple(v[i]) for i in tri], dxfattribs={"layer": layer})


def add_contours(
    msp, pts: np.ndarray, runs: np.ndarray, layer: str = "CONTOURS", kind: str = "polyline3d"
) -> None:
    for a, b in zip(runs[:-1], runs[1:], strict=True):
        ring = pts[a:b]
        if kind == "polyline3d":
            msp.add_polyline3d([tuple(p) for p in ring], dxfattribs={"layer": layer})
        else:
            msp.add_lwpolyline(
                [tuple(p[:2]) for p in ring], dxfattribs={"layer": layer, "elevation": float(ring[0, 2])}
            )


def inject_unknown(path: Path, dxftype: str, layer: str, owner: str, handle: str = "ABCDE") -> Path:
    """Put an entity ezdxf cannot interpret (a Civil 3D object) at the top of the ENTITIES section."""
    text = path.read_text("utf-8")
    marker = "  2\nENTITIES\n"
    i = text.index(marker) + len(marker)
    raw = f"  0\n{dxftype}\n  5\n{handle}\n330\n{owner}\n100\nAcDbEntity\n  8\n{layer}\n"
    path.write_text(text[:i] + raw + text[i:], "utf-8")
    return path
```

- [ ] **Step 2: Write the failing tests**

`backend/tests/test_design_dxf.py`:

```python
"""The ezdxf reader (spec §8.1, §15.3 DXF)."""

import tracemalloc

import numpy as np
import pytest
from design_dxf import add_contours, add_faces, inject_unknown, new_doc, save
from designs import E0, N0, cone_contour_runs, two_triangle_plane
from ezdxf.math import Vec3

from app.surfaces.design import dxf, store
from app.surfaces.design.rasterise import SimpleLattice, rasterise_to_array


@pytest.fixture
def project_kind() -> str:
    """Design surfaces are detection work: F0 guards the router with require_kind(("detect",), ANY_KIND)."""
    return "detect"


def read(path, tmp_path):
    idir = tmp_path / "insp"
    idir.mkdir(exist_ok=True)
    res = dxf.inspect_file(path, idir, progress=lambda f, m: None, check_cancelled=lambda: None)
    return res, idir, {c.name: c for c in res.candidates}


def arrays(idir, cand):
    return store.read_candidate(store.candidate_dir(idir, cand.id))


def test_3dface_triangles_and_the_shorter_diagonal_split(tmp_path):
    doc = new_doc()
    msp = doc.modelspace()
    v, t = two_triangle_plane()
    add_faces(msp, v, t, "TIN")
    quad = [(E0, N0, 0.0), (E0 + 10, N0, 0.0), (E0 + 10, N0 + 10, 5.0), (E0, N0 + 10, 0.0)]
    msp.add_3dface(quad, dxfattribs={"layer": "QUAD"})
    res, idir, by = read(save(doc, tmp_path / "f.dxf"), tmp_path)
    assert (
        by["TIN"].geometry == "faces" and by["TIN"].face_count == 2 and by["TIN"].entity_counts["3dface"] == 2
    )
    a = arrays(idir, by["QUAD"])
    assert a.faces.tolist() == [[0, 1, 3], [1, 2, 3]]  # |v1 - v3| = 14.1 < |v0 - v2| = 15.0
    out, _ = rasterise_to_array(a.points, a.faces, SimpleLattice(E0, N0 + 10, 1.0, 10, 10))
    assert out[4, 4] == pytest.approx(0.0, abs=1e-6)  # centre (4.5, 5.5) lies on the 1-3 diagonal
    assert [c.default_selected for c in res.candidates] == [True, True]


def test_mesh_polyface_and_polymesh(tmp_path):
    doc = new_doc()
    msp = doc.modelspace()
    mesh = msp.add_mesh(dxfattribs={"layer": "MESH"})
    with mesh.edit_data() as d:
        d.vertices = [
            (E0, N0, 0),
            (E0 + 2, N0, 0),
            (E0 + 3, N0 + 2, 0),
            (E0 + 1, N0 + 3, 0),
            (E0 - 1, N0 + 2, 0),
        ]
        d.faces = [[0, 1, 2, 3, 4]]
    pf = msp.add_polyface(dxfattribs={"layer": "PF"})
    pf.append_face([(E0, N0, 0), (E0 + 10, N0, 1), (E0 + 10, N0 + 10, 2), (E0, N0 + 10, 3)])
    pm = msp.add_polymesh(size=(3, 3), dxfattribs={"layer": "PM"})
    for i in range(3):
        for j in range(3):
            pm.set_mesh_vertex((i, j), (E0 + 10 * i, N0 + 10 * j, float(i + j)))
    _, _, by = read(save(doc, tmp_path / "m.dxf"), tmp_path)
    assert by["MESH"].face_count == 3 and by["MESH"].entity_counts["mesh"] == 1
    assert by["PF"].face_count == 2 and by["PF"].entity_counts["polyface"] == 1
    assert by["PM"].face_count == 8 and by["PM"].entity_counts["polymesh"] == 1


def test_polylines_lines_and_points_are_runs(tmp_path):
    doc = new_doc()
    msp = doc.modelspace()
    msp.add_polyline3d([(E0, N0, 1), (E0 + 5, N0, 2), (E0 + 5, N0 + 5, 3)], dxfattribs={"layer": "P3D"})
    msp.add_lwpolyline([(E0, N0), (E0 + 5, N0)], dxfattribs={"layer": "LW", "elevation": 7.0})
    msp.add_polyline2d([(E0, N0), (E0, N0 + 5)], dxfattribs={"layer": "P2D", "elevation": (0, 0, 4.0)})
    msp.add_line((E0, N0, 1), (E0 + 1, N0, 2), dxfattribs={"layer": "LINES"})
    msp.add_point((E0 + 3, N0 + 3, 9), dxfattribs={"layer": "LINES"})
    _, idir, by = read(save(doc, tmp_path / "p.dxf"), tmp_path)
    p3d = arrays(idir, by["P3D"])
    assert (
        by["P3D"].geometry == "points"
        and p3d.points[:, 2].tolist() == [1, 2, 3]
        and p3d.runs.tolist() == [0, 3]
    )
    assert arrays(idir, by["LW"]).points[:, 2].tolist() == [7.0, 7.0]
    assert arrays(idir, by["P2D"]).points[:, 2].tolist() == [4.0, 4.0]
    lines = arrays(idir, by["LINES"])
    assert lines.runs.tolist() == [0, 2, 3] and by["LINES"].entity_counts["line"] == 1
    assert by["LINES"].entity_counts["point"] == 1


def test_an_upside_down_extrusion_goes_through_the_ocs(tmp_path):
    doc = new_doc()
    doc.modelspace().add_lwpolyline(
        [(1, 2), (3, 4)], dxfattribs={"layer": "FLIP", "elevation": 5.0, "extrusion": (0, 0, -1)}
    )
    _, idir, by = read(save(doc, tmp_path / "o.dxf"), tmp_path)
    assert arrays(idir, by["FLIP"]).points.tolist() == [[-1.0, 2.0, -5.0], [-3.0, 4.0, -5.0]]


def test_nested_inserts_count_layer_zero_on_the_insert_layer(tmp_path):
    doc = new_doc()
    faces = doc.blocks.new("FACES")
    faces.add_3dface([(0, 0, 1), (1, 0, 1), (0, 1, 1)], dxfattribs={"layer": "0"})
    outer = doc.blocks.new("OUTER")
    outer.add_blockref("FACES", (10, 0, 0), dxfattribs={"layer": "0"})
    doc.modelspace().add_blockref("OUTER", (100, 0, 0), dxfattribs={"layer": "TIN"})
    _, idir, by = read(save(doc, tmp_path / "i.dxf"), tmp_path)
    assert set(by) == {"TIN"}
    assert sorted(arrays(idir, by["TIN"]).points[:, 0].tolist()) == [110.0, 110.0, 111.0]


def test_all_zero_layers_are_flagged_and_not_selected(tmp_path):
    doc = new_doc()
    msp = doc.modelspace()
    msp.add_lwpolyline([(E0, N0), (E0 + 5, N0)], dxfattribs={"layer": "FLAT"})
    add_contours(msp, *cone_contour_runs(32), layer="CONTOURS")
    res, _, by = read(save(doc, tmp_path / "z.dxf"), tmp_path)
    assert [n.code for n in by["FLAT"].notes] == ["no_heights"]
    assert by["FLAT"].notes[0].message == "all elevations are 0 — 2D linework?"
    assert not by["FLAT"].default_selected and by["CONTOURS"].default_selected


def test_faces_win_the_default_selection(tmp_path):
    doc = new_doc()
    msp = doc.modelspace()
    add_faces(msp, *two_triangle_plane(), "TIN")
    add_contours(msp, *cone_contour_runs(32), layer="CONTOURS")
    _, _, by = read(save(doc, tmp_path / "d.dxf"), tmp_path)
    assert by["TIN"].default_selected and not by["CONTOURS"].default_selected


def test_civil_3d_objects_are_counted_as_unsupported(tmp_path):
    doc = new_doc()
    msp = doc.modelspace()
    add_faces(msp, *two_triangle_plane(), "TIN")
    path = save(doc, tmp_path / "c3d.dxf")
    inject_unknown(path, "AECC_TIN_SURFACE", "TIN", msp.layout_key)
    _, _, by = read(path, tmp_path)
    assert by["TIN"].entity_counts["unsupported"] == 1
    (note,) = [n for n in by["TIN"].notes if n.code == "unsupported_entities"]
    assert note.message.startswith("1 Civil 3D objects (AECC) can't be read")


def test_bulges_are_chorded_and_noted(tmp_path):
    doc = new_doc()
    doc.modelspace().add_lwpolyline(
        [(0, 0, 0.5), (10, 0, 0)], format="xyb", dxfattribs={"layer": "ARC", "elevation": 3.0}
    )
    _, _, by = read(save(doc, tmp_path / "b.dxf"), tmp_path)
    assert any(n.code == "chorded_arcs" and n.message == "1 arcs were chorded" for n in by["ARC"].notes)


def test_a_layer_of_text_has_nothing_to_use(tmp_path):
    doc = new_doc()
    doc.modelspace().add_text("KEEP OUT", dxfattribs={"layer": "TEXT"})
    _, _, by = read(save(doc, tmp_path / "t.dxf"), tmp_path)
    assert by["TEXT"].geometry == "none" and by["TEXT"].notes[0].level == "block"


@pytest.mark.parametrize(
    ("insunits", "unit", "source"),
    [
        (0, "metre", "DXF $INSUNITS=0 (unitless; metres assumed)"),
        (2, "international_foot", "DXF $INSUNITS=2"),
        (4, "millimetre", "DXF $INSUNITS=4"),
        (6, "metre", "DXF $INSUNITS=6"),
        (21, "us_survey_foot", "DXF $INSUNITS=21"),
        (1, None, "DXF $INSUNITS=1 (not supported; choose the unit)"),
    ],
)
def test_insunits(tmp_path, insunits, unit, source):
    doc = new_doc(insunits)
    add_faces(doc.modelspace(), *two_triangle_plane())
    res, _, _ = read(save(doc, tmp_path / "u.dxf"), tmp_path)
    assert res.detected.horizontal_unit == unit and res.detected.vertical_unit == unit
    assert res.detected.unit_source.startswith(source)
    assert res.internal == {"insunits": insunits}


def test_a_binary_dxf_reads_the_same(tmp_path):
    doc = new_doc()
    add_faces(doc.modelspace(), *two_triangle_plane())
    _, _, by = read(save(doc, tmp_path / "bin.dxf", binary=True), tmp_path)
    assert by["TIN"].face_count == 2


def test_geodata_gives_an_unverified_hint(tmp_path):
    doc = new_doc()
    msp = doc.modelspace()
    add_faces(msp, *two_triangle_plane())
    geo = msp.new_geodata()
    geo.coordinate_system_definition = '<Dictionary><ProjectedCoordinateSystem id="UTM84-39N"/></Dictionary>'
    res, _, _ = read(save(doc, tmp_path / "g.dxf"), tmp_path)
    assert res.detected.crs_hint == "GEODATA: UTM84-39N" and res.detected.crs_wkt is None


def test_the_ram_factor_holds_on_a_20_mb_dxf(tmp_path):
    doc = new_doc()
    msp = doc.modelspace()
    rng = np.random.default_rng(0)
    xy = rng.uniform(0, 1000, (90_000, 2)) + [E0, N0]
    for x, y in xy:
        msp.add_3dface([Vec3(x, y, 1), Vec3(x + 1, y, 2), Vec3(x, y + 1, 3)], dxfattribs={"layer": "TIN"})
    path = save(doc, tmp_path / "big.dxf")
    del doc, msp
    size = path.stat().st_size
    assert size > 20 * 2**20
    tracemalloc.start()
    base = tracemalloc.get_traced_memory()[0]
    read(path, tmp_path)
    peak = tracemalloc.get_traced_memory()[1] - base
    tracemalloc.stop()
    assert peak <= dxf.DXF_RAM_FACTOR * size, f"measured {peak / size:.1f} x the file size"


def test_inspect_through_the_api(client, project_id, wait_job, tmp_path):
    doc = new_doc()
    add_contours(doc.modelspace(), *cone_contour_runs(64), layer="CONTOURS", kind="lwpolyline")
    src = save(doc, tmp_path / "contours.dxf")
    body = client.post(f"/api/v1/projects/{project_id}/design-inspections", json={"path": str(src)}).json()
    assert wait_job(project_id, body["job"]["id"])["state"] == "succeeded"
    got = client.get(f"/api/v1/projects/{project_id}/design-inspections/{body['inspection']['id']}").json()
    (c,) = got["candidates"]
    assert (c["name"], c["geometry"], c["entity_counts"]["lwpolyline"]) == ("CONTOURS", "points", 20)
```

`backend/tests/test_design_selftest.py`:

```python
"""`kestrel-backend.exe design-selftest` (spec §14.2 U3, U7)."""

from app.__main__ import run
from app.surfaces.design import selftest


def test_selftest_reads_a_dxf_and_triangulates():
    facts = selftest.run()
    assert facts["faces"] == 10 and facts["triangles"] > 0


def test_the_entry_point_dispatches(capsys):
    assert run(["app", "design-selftest"], freeze_support=lambda: None) == 0
    assert "design ok 10" in capsys.readouterr().out
```

In F0's `backend/tests/test_pointcloud_foundation.py`, delete exactly this line from the parametrize of `test_selftest_placeholders_say_so_and_exit_2` (F0 writes one entry per line so that S1, S2 and S3 each delete their own without conflicts):

```python
        "design-selftest",
```

Leave the other entries (`pointcloud-selftest` is S1 Task 15's, `volumes-selftest` is S2 Task 13's). If they are already gone and the list is empty, pytest skips the test; that is expected.

- [ ] **Step 3: Run the tests to verify they fail**

Run from `backend`: `$PY -m pytest tests/test_design_dxf.py tests/test_design_selftest.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'app.surfaces.design.dxf'`, and the selftest returns 2 ("design-selftest not built").

- [ ] **Step 4: Write `dxf.py`**

```python
"""DXF reader (spec §8.1): ezdxf `recover`, one candidate per layer, faces or vertex runs.

INSERTs are expanded recursively through virtual_entities() with their transformation; an entity
on layer 0 inside a block counts on the INSERT's layer (the AutoCAD rule). The whole document is
held in memory, so the load is admitted first at DXF_RAM_FACTOR x the file size.
"""

from __future__ import annotations

import re
from array import array
from collections import defaultdict
from dataclasses import dataclass, field
from pathlib import Path

import numpy as np

from app.jobs.cancellation import JobFailure
from app.surfaces.design import admission, codes, store, thumbs
from app.surfaces.design.inspection import Candidate, Detected, InspectResult, candidate_from_meta
from app.surfaces.design.units import INSUNITS

DXF_RAM_FACTOR = 12  # asserted by test_the_ram_factor_holds_on_a_20_mb_dxf
ENTITY_KEYS = (
    "3dface",
    "mesh",
    "polyface",
    "polymesh",
    "polyline_3d",
    "polyline_2d",
    "lwpolyline",
    "line",
    "point",
    "unsupported",
)
CHECK_EVERY = 5_000
MESSAGE = "Reading design file"


@dataclass
class _Layer:
    counts: dict = field(default_factory=lambda: dict.fromkeys(ENTITY_KEYS, 0))
    face_pts: array = field(default_factory=lambda: array("d"))
    face_idx: array = field(default_factory=lambda: array("q"))
    run_pts: array = field(default_factory=lambda: array("d"))
    run_len: array = field(default_factory=lambda: array("q"))
    aecc: int = 0
    chorded: int = 0

    def add_faces(self, verts, tris) -> None:
        base = len(self.face_pts) // 3
        for v in verts:
            self.face_pts.extend((float(v[0]), float(v[1]), float(v[2])))
        for a, b, c in tris:
            self.face_idx.extend((base + a, base + b, base + c))

    def add_run(self, verts) -> None:
        for v in verts:
            self.run_pts.extend((float(v[0]), float(v[1]), float(v[2])))
        self.run_len.append(len(verts))


def _fan(face) -> list[tuple[int, int, int]]:
    face = list(face)
    return [(face[0], face[i], face[i + 1]) for i in range(1, len(face) - 1)]


def _quad(v) -> list[tuple[int, int, int]]:
    """A quad split along its shorter 3D diagonal (spec §8.1 table)."""
    return [(0, 1, 2), (0, 2, 3)] if v[0].distance(v[2]) <= v[1].distance(v[3]) else [(0, 1, 3), (1, 2, 3)]


def _to_wcs(e, pts: list) -> list:
    from ezdxf.math import Vec3

    if Vec3(e.dxf.get("extrusion", (0, 0, 1))).isclose(Vec3(0, 0, 1)):
        return pts
    return list(e.ocs().points_to_wcs(pts))


class _Walker:
    def __init__(self, check_cancelled):
        self.layers: dict[str, _Layer] = defaultdict(_Layer)
        self._check = check_cancelled
        self._n = 0

    def walk(self, entities, inherited: str | None = None) -> None:
        import ezdxf

        for e in entities:
            self._n += 1
            if self._n % CHECK_EVERY == 0:
                self._check()
            layer = e.dxf.get("layer", "0")
            if inherited is not None and layer == "0":
                layer = inherited
            kind = e.dxftype()
            try:
                if kind == "INSERT":
                    self.walk(e.virtual_entities(), layer)
                else:
                    self._one(e, kind, self.layers[layer])
            except (ezdxf.DXFError, ValueError, IndexError, ZeroDivisionError):
                self.layers[layer].counts["unsupported"] += 1  # one broken entity is counted, not fatal

    def _one(self, e, kind: str, acc: _Layer) -> None:
        from ezdxf.math import Vec3
        from ezdxf.render import MeshBuilder

        if kind == "3DFACE":
            vs = [Vec3(e.dxf.vtx0), Vec3(e.dxf.vtx1), Vec3(e.dxf.vtx2), Vec3(e.dxf.vtx3)]
            if vs[3].isclose(vs[2]):
                acc.add_faces(vs[:3], [(0, 1, 2)])
            else:
                acc.add_faces(vs, _quad(vs))
            acc.counts["3dface"] += 1
        elif kind == "MESH":
            acc.add_faces([Vec3(v) for v in e.vertices], [t for f in e.faces for t in _fan(f)])
            acc.counts["mesh"] += 1
        elif kind == "POLYLINE" and e.is_poly_face_mesh:
            mb = MeshBuilder.from_polyface(e)
            acc.add_faces(mb.vertices, [t for f in mb.faces for t in _fan(f)])
            acc.counts["polyface"] += 1
        elif kind == "POLYLINE" and e.is_polygon_mesh:
            m, n = e.dxf.m_count, e.dxf.n_count
            vs = [Vec3(e.get_mesh_vertex((i, j)).dxf.location) for i in range(m) for j in range(n)]
            tris = []
            for i in range(m - 1):
                for j in range(n - 1):
                    q = [i * n + j, (i + 1) * n + j, (i + 1) * n + j + 1, i * n + j + 1]
                    tris += [tuple(q[k] for k in t) for t in _quad([vs[k] for k in q])]
            acc.add_faces(vs, tris)
            acc.counts["polymesh"] += 1
        elif kind == "POLYLINE" and e.is_3d_polyline:
            pts = [Vec3(v.dxf.location) for v in e.vertices]
            if e.is_closed and pts:
                pts.append(pts[0])
            acc.add_run(pts)
            acc.counts["polyline_3d"] += 1
        elif kind == "POLYLINE":
            elev = Vec3(e.dxf.elevation).z
            pts = [Vec3(v.dxf.location.x, v.dxf.location.y, elev) for v in e.vertices]
            acc.chorded += sum(1 for v in e.vertices if v.dxf.get("bulge", 0))
            if e.is_closed and pts:
                pts.append(pts[0])
            acc.add_run(_to_wcs(e, pts))
            acc.counts["polyline_2d"] += 1
        elif kind == "LWPOLYLINE":
            elev = float(e.dxf.get("elevation", 0.0))
            xyb = list(e.get_points("xyb"))
            pts = [Vec3(x, y, elev) for x, y, _ in xyb]
            acc.chorded += sum(1 for *_, b in xyb if b)
            if e.closed and pts:
                pts.append(pts[0])
            acc.add_run(_to_wcs(e, pts))
            acc.counts["lwpolyline"] += 1
        elif kind == "LINE":
            acc.add_run([Vec3(e.dxf.start), Vec3(e.dxf.end)])
            acc.counts["line"] += 1
        elif kind == "POINT":
            acc.add_run([Vec3(e.dxf.location)])
            acc.counts["point"] += 1
        else:
            acc.counts["unsupported"] += 1
            if kind.startswith("AECC") or kind == "ACAD_PROXY_ENTITY":
                acc.aecc += 1


def _geodata_hint(msp) -> str | None:
    try:
        geo = msp.get_geodata()
    except Exception:  # a malformed GEODATA object is only a missing hint
        return None
    xml = (geo.coordinate_system_definition or "") if geo is not None else ""
    m = re.search(r'<Alias[^>]*\bid="([^"]+)"', xml) or re.search(r'\bid="([^"]+)"', xml)
    return f"GEODATA: {m.group(1)}" if m else None


def _detected(insunits: int, measurement, hint: str | None) -> Detected:
    unit = INSUNITS.get(insunits)
    if insunits == 0:
        h, source = "metre", "DXF $INSUNITS=0 (unitless; metres assumed)"
    elif unit is not None:
        h, source = unit.value, f"DXF $INSUNITS={insunits}"
    else:
        h, source = None, f"DXF $INSUNITS={insunits} (not supported; choose the unit)"
    if measurement is not None:
        source += f"; $MEASUREMENT={int(measurement)} ({'metric' if int(measurement) == 1 else 'imperial'})"
    return Detected(h, h, source, crs_hint=hint)


def _notes(acc: _Layer, geometry: str, has_faces: bool, has_points: bool, meta: dict) -> list:
    notes = []
    if geometry == "none":
        notes.append(codes.block("empty_result", "nothing on this layer can be used as a surface"))
    elif meta["z_min"] == 0 and meta["z_max"] == 0:
        notes.append(codes.warn("no_heights", "all elevations are 0 — 2D linework?"))
    if acc.aecc:
        notes.append(
            codes.warn(
                "unsupported_entities",
                f"{acc.aecc} Civil 3D objects (AECC) can't be read — export the surface to LandXML, "
                "or explode it to 3D faces",
            )
        )
    if acc.chorded:
        notes.append(codes.info("chorded_arcs", f"{acc.chorded} arcs were chorded"))
    if has_faces and has_points:
        notes.append(codes.info("mixed_geometry", "this layer has 3D faces and lines; the lines are ignored"))
    return notes


def _usable(c: Candidate) -> bool:
    return not any(n.level == "block" or n.code == "no_heights" for n in c.notes)


def _candidates(layers: dict[str, _Layer], idir: Path, check_cancelled) -> list[Candidate]:
    out = []
    for i, name in enumerate(sorted(layers)):
        check_cancelled()
        acc = layers.pop(name)
        cid = f"c{i}"
        has_faces, has_points = len(acc.face_idx) > 0, len(acc.run_len) > 0
        geometry = "faces" if has_faces else "points" if has_points else "none"
        cdir = store.candidate_dir(idir, cid)
        w = store.CandidateWriter(cdir, "faces" if has_faces else "points")
        if has_faces:
            w.add_points(np.frombuffer(acc.face_pts, dtype=np.float64).reshape(-1, 3))
            w.add_faces(np.frombuffer(acc.face_idx, dtype=np.int64).reshape(-1, 3))
        elif has_points:
            w.add_runs(
                np.frombuffer(acc.run_pts, dtype=np.float64).reshape(-1, 3),
                np.frombuffer(acc.run_len, dtype=np.int64),
            )
        meta = w.close()
        out.append(
            candidate_from_meta(
                cid,
                "dxf_layer",
                name,
                meta,
                geometry=geometry,
                entity_counts=dict(acc.counts),
                notes=_notes(acc, geometry, has_faces, has_points, meta),
            )
        )
        points = store.read_candidate(cdir).points
        thumbs.plan_thumbnail(points, store.thumb_path(idir, cid))
        del points, acc
    faces = [c for c in out if c.geometry == "faces" and _usable(c)]
    for c in faces or [c for c in out if c.geometry == "points" and _usable(c) and c.z_max > c.z_min]:
        c.default_selected = True
    return out


def _progressing(entities, total: int, progress):
    for i, e in enumerate(entities):
        if i % CHECK_EVERY == 0:
            progress(0.1 + 0.7 * i / total, MESSAGE)
        yield e


def inspect_file(path: Path, idir: Path, *, progress, check_cancelled) -> InspectResult:
    import ezdxf
    from ezdxf import recover

    admission.admit(
        DXF_RAM_FACTOR * path.stat().st_size,
        f"Reading {path.name}",
        "Save only the surface layers to a new DXF (WBLOCK) and import that.",
    )
    progress(0.05, MESSAGE)
    try:
        doc, _auditor = recover.readfile(str(path))
    except ezdxf.DXFStructureError as e:
        raise JobFailure(f"{path.name} can't be read as DXF: {e}") from None
    except OSError as e:
        raise JobFailure(f"{path.name} can't be opened ({e})") from None
    check_cancelled()
    msp = doc.modelspace()
    insunits = int(doc.header.get("$INSUNITS", 0) or 0)
    detected = _detected(insunits, doc.header.get("$MEASUREMENT"), _geodata_hint(msp))
    walker = _Walker(check_cancelled)
    walker.walk(_progressing(msp, max(len(msp), 1), progress))
    del doc, msp  # release the document before the candidates are written
    candidates = _candidates(walker.layers, idir, check_cancelled)
    progress(1.0, MESSAGE)
    return InspectResult(detected, candidates, internal={"insunits": insunits})
```

- [ ] **Step 5: Write `selftest.py` and the smoke step**

Replace `backend/app/surfaces/design/selftest.py` with:

```python
"""`kestrel-backend.exe design-selftest`: proves the frozen bundle carries ezdxf and scipy.spatial.

It writes a DXF with ten 3D faces, reads it back through ezdxf's recover path (the one the reader
uses) and runs a Delaunay of 100 points (Qhull). Task 14 adds a 64 x 64 SurfaceWriter write.
"""

from __future__ import annotations

import tempfile
from pathlib import Path

import numpy as np


def run() -> dict:
    import ezdxf
    from ezdxf import recover
    from scipy.spatial import Delaunay

    with tempfile.TemporaryDirectory(prefix="kestrel-design-") as tmp:
        path = Path(tmp) / "selftest.dxf"
        doc = ezdxf.new("R2010")
        msp = doc.modelspace()
        for i in range(10):
            msp.add_3dface([(i, 0, 0), (i + 1, 0, 1), (i, 1, 2)], dxfattribs={"layer": "TIN"})
        doc.saveas(path)
        back, _auditor = recover.readfile(str(path))
        faces = sum(1 for e in back.modelspace() if e.dxftype() == "3DFACE")
    tri = Delaunay(np.random.default_rng(0).random((100, 2)))
    return {"faces": faces, "triangles": int(len(tri.simplices))}


def main(argv: list[str] | None = None) -> int:
    """`argv` (the arguments after `design-selftest`) is accepted and ignored, as F0 dispatches it."""
    facts = run()
    ok = facts["faces"] == 10 and facts["triangles"] > 0
    print(f"design ok {facts['faces']} {facts['triangles']}" if ok else f"design selftest failed: {facts}")
    return 0 if ok else 1
```

In `backend/scripts/smoke_frozen.ps1`, directly after the `Complete-Step "geo"` line, add:

```powershell
# ezdxf + scipy.spatial (+ the grid writer) inside the bundle (spec 2026-09-23-design-surfaces §14.2 U3/U7).
$design = & $exe design-selftest 2>&1 | Out-String
if ($LASTEXITCODE -ne 0 -or $design -notmatch "design ok 10") { throw "design selftest failed: $design" }
Write-Host ($design.Trim().Split("`n")[-1])
Complete-Step "design"
```

- [ ] **Step 6: Run the tests to verify they pass**

Run from `backend`: `$PY -m pytest tests/test_design_dxf.py tests/test_design_selftest.py tests/test_pointcloud_foundation.py -v`
Expected: PASS. Two measured facts may need a decision, never a looser assertion:
- If `test_civil_3d_objects_are_counted_as_unsupported` finds ezdxf does not list the injected entity (check `[e.dxftype() for e in doc.modelspace()]` after `recover.readfile`), inject it as `ACAD_PROXY_ENTITY` instead; the reader counts both.
- If `test_the_ram_factor_holds_on_a_20_mb_dxf` measures above 12, set `DXF_RAM_FACTOR` to the measured factor rounded up and record the number for the Task 17 evidence.

- [ ] **Step 7: Commit**

```
git add backend/app/surfaces/design/dxf.py backend/app/surfaces/design/selftest.py backend/scripts/smoke_frozen.ps1 backend/tests/design_dxf.py backend/tests/test_design_dxf.py backend/tests/test_design_selftest.py backend/tests/test_pointcloud_foundation.py
git commit -m "feat(design): the ezdxf layer reader and design-selftest" -m "Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```


---

### Task 9: DEM GeoTIFF inspection

Rebase onto `main` with S2 V1 first (see the DAG section).

**Files:**
- Create: `backend/app/surfaces/design/dem.py`
- Test: `backend/tests/test_design_dem.py`

**Interfaces:**
- Consumes: Task 1; Task 4 (reader contract); Task 10 (`placement.raster_envelope(transform, width, height)`, `tests/design_targets.write_dem`); S2 V1 (`grid.hillshade`).
- Produces:
  - `dem.SENTINELS = (-9999.0, -32767.0, -32768.0, -3.4028235e38)`, `dem.DECIMATED_SIDE = 1024`.
  - `dem.inspect_file(path, idir, *, progress, check_cancelled) -> InspectResult` with one candidate `c0`, kind `dem`, geometry `raster`, name `band 1`, `raster = {width, height, cell_x, cell_y, dtype, nodata, band_count}`.
  - `internal` keys (read by Tasks 11, 12, 13): `nodata` (float or None: declared, else the sentinel), `sentinel` (bool), `mask` (bool), `scale` (float), `offset` (float), `rotated` (bool).

- [ ] **Step 1: Write the failing tests**

`backend/tests/test_design_dem.py`:

```python
"""DEM inspection (spec §6 Inspect, §15.3 DEM)."""

import numpy as np
import pytest
from design_targets import write_dem
from designs import E0, N0
from PIL import Image

from app.jobs.cancellation import JobFailure
from app.surfaces.design import dem, store


def read(path, tmp_path):
    idir = tmp_path / "insp"
    idir.mkdir(exist_ok=True)
    res = dem.inspect_file(path, idir, progress=lambda f, m: None, check_cancelled=lambda: None)
    return res, idir


def ramp(h=300, w=400, lo=10.0):
    return (lo + np.arange(w)[None, :] * 0.01 + np.arange(h)[:, None] * 0.02).astype(np.float32)


def test_a_float_dem_with_declared_nodata(tmp_path):
    z = ramp()
    z[:10] = -9999
    src = write_dem(tmp_path / "d.tif", z, x0=E0, y0=N0 + 300, cell=1.0, nodata=-9999)
    res, idir = read(src, tmp_path)
    (c,) = res.candidates
    assert (c.id, c.kind, c.name, c.geometry, c.default_selected) == ("c0", "dem", "band 1", "raster", True)
    assert c.raster == {
        "width": 400,
        "height": 300,
        "cell_x": 1.0,
        "cell_y": 1.0,
        "dtype": "float32",
        "nodata": -9999.0,
        "band_count": 1,
    }
    assert c.bounds_file == [E0, N0, E0 + 400, N0 + 300]
    assert c.z_min == pytest.approx(10.2, abs=0.05) and c.notes == []
    assert res.detected.epsg == 32639 and res.detected.crs_source == "GeoTIFF CRS"
    assert res.detected.horizontal_unit is None and res.detected.vertical_unit == "metre"
    assert res.internal == {
        "nodata": -9999.0,
        "sentinel": False,
        "mask": False,
        "scale": 1.0,
        "offset": 0.0,
        "rotated": False,
    }
    im = Image.open(store.thumb_path(idir, "c0"))
    assert max(im.size) == 160


def test_int16_with_minus_32767_nodata(tmp_path):
    z = (ramp() * 10).astype(np.int16)
    z[:, :5] = -32767
    res, _ = read(
        write_dem(tmp_path / "i.tif", z, x0=E0, y0=N0 + 300, cell=1.0, dtype="int16", nodata=-32767), tmp_path
    )
    assert res.candidates[0].raster["dtype"] == "int16" and res.internal["nodata"] == -32767.0
    assert res.candidates[0].z_min > 0


def test_a_nan_nodata_is_reported_as_none(tmp_path):
    z = ramp()
    z[:5] = np.nan
    res, _ = read(write_dem(tmp_path / "nan.tif", z, x0=E0, y0=N0 + 300, cell=1.0, nodata=np.nan), tmp_path)
    c = res.candidates[0]
    assert c.raster["nodata"] is None and res.internal["nodata"] is None and c.notes == []


def test_an_undeclared_minus_9999_sentinel_is_proposed(tmp_path):
    z = ramp()
    z[:, :20] = -9999
    res, _ = read(write_dem(tmp_path / "s.tif", z, x0=E0, y0=N0 + 300, cell=1.0), tmp_path)
    c = res.candidates[0]
    assert [n.code for n in c.notes] == ["sentinel_nodata"] and c.notes[0].level == "warn"
    assert res.internal["sentinel"] is True and res.internal["nodata"] == -9999.0
    assert c.raster["nodata"] == -9999.0 and c.z_min > 0


def test_no_nodata_at_all_is_an_info(tmp_path):
    res, _ = read(write_dem(tmp_path / "n.tif", ramp(), x0=E0, y0=N0 + 300, cell=1.0), tmp_path)
    assert [(n.code, n.level) for n in res.candidates[0].notes] == [("nodata_unknown", "info")]


def test_scale_and_offset_are_applied(tmp_path):
    z = (ramp() * 100).astype(np.int16)
    res, _ = read(
        write_dem(
            tmp_path / "so.tif", z, x0=E0, y0=N0 + 300, cell=1.0, dtype="int16", scale=0.01, offset=-50.0
        ),
        tmp_path,
    )
    assert res.internal["scale"] == 0.01 and res.internal["offset"] == -50.0
    assert res.candidates[0].z_min == pytest.approx(10.0 - 50.0, abs=0.05)  # raw 1000 x 0.01 - 50


def test_an_rgb_image_is_sent_to_maps(tmp_path):
    rgb = np.zeros((3, 50, 50), np.uint8)
    src = write_dem(tmp_path / "o.tif", rgb, x0=E0, y0=N0 + 50, cell=1.0, dtype="uint8", count=3)
    with pytest.raises(
        JobFailure,
        match="this is an image \\(an orthomosaic\\?\\), not a height model — import it under Maps",
    ):
        read(src, tmp_path)


def test_no_georeferencing_is_refused(tmp_path):
    src = write_dem(tmp_path / "g.tif", ramp(), x0=0, y0=0, cell=1.0, crs=None, identity=True)
    with pytest.raises(JobFailure, match="no georeferencing"):
        read(src, tmp_path)


def test_a_rotated_geotransform_is_accepted(tmp_path):
    res, _ = read(
        write_dem(tmp_path / "r.tif", ramp(), x0=E0, y0=N0 + 300, cell=1.0, rotation=10.0), tmp_path
    )
    c = res.candidates[0]
    assert res.internal["rotated"] is True and c.raster["cell_x"] == pytest.approx(1.0)
    minx, miny, maxx, maxy = c.bounds_file
    assert maxx - minx > 400 and maxy - miny > 300  # the envelope of the rotated corners


def test_feet_heights_in_a_feet_crs_default_to_feet(tmp_path):
    res, _ = read(
        write_dem(tmp_path / "ft.tif", ramp(), x0=6_000_000, y0=2_000_300, cell=3.0, crs="EPSG:2229"),
        tmp_path,
    )
    assert res.detected.vertical_unit == "us_survey_foot"
```

- [ ] **Step 2: Run the tests to verify they fail**

Run from `backend`: `$PY -m pytest tests/test_design_dem.py -v`
Expected: FAIL with `ModuleNotFoundError: No module named 'app.surfaces.design.dem'`.

- [ ] **Step 3: Write `dem.py`**

```python
"""DEM GeoTIFF inspection (spec §6 Inspect): one band, georeferenced, nodata or sentinel, thumbnail."""

from __future__ import annotations

import math
import warnings
from pathlib import Path

import numpy as np
from pyproj import CRS

from app.jobs.cancellation import JobFailure
from app.surfaces import grid
from app.surfaces.design import codes, store, thumbs
from app.surfaces.design.inspection import Candidate, Detected, InspectResult
from app.surfaces.design.placement import raster_envelope
from app.surfaces.design.units import FEET, horizontal_crs, unit_from_factor

SENTINELS = (-9999.0, -32767.0, -32768.0, -3.4028235e38)
DECIMATED_SIDE = 1024
MESSAGE = "Reading design file"


def _sentinel(values: np.ndarray) -> float | None:
    finite = values[np.isfinite(values)]
    if finite.size == 0:
        return None
    low = float(finite.min())
    for s in SENTINELS:
        if math.isclose(low, s, rel_tol=1e-7, abs_tol=1e-9):
            return s
    return None


def _vertical_unit(crs: CRS | None) -> tuple[str, str]:
    """Spec §5 defaults: the vertical CRS unit if compound, else a foot horizontal unit, else metre."""
    if crs is None:
        return "metre", "none"
    if crs.is_compound and len(crs.sub_crs_list) > 1:
        u = unit_from_factor(crs.sub_crs_list[1].axis_info[0].unit_conversion_factor)
        return (u.value if u else "metre"), "vertical CRS unit"
    h = horizontal_crs(crs)
    if h.is_projected:
        u = unit_from_factor(h.axis_info[0].unit_conversion_factor)
        if u in FEET:
            return u.value, "CRS axis unit (foot)"
    return "metre", "CRS axis unit"


def inspect_file(path: Path, idir: Path, *, progress, check_cancelled) -> InspectResult:
    import rasterio
    from rasterio.enums import MaskFlags, Resampling
    from rasterio.errors import NotGeoreferencedWarning, RasterioIOError

    try:
        with warnings.catch_warnings():
            warnings.simplefilter("ignore", NotGeoreferencedWarning)
            src = rasterio.open(path)
    except RasterioIOError as e:
        raise JobFailure(f"{path.name} is not a readable raster ({e})") from None
    with src:
        if src.count != 1:
            if src.dtypes[0] == "uint8" and src.count in (3, 4):
                raise JobFailure(
                    "this is an image (an orthomosaic?), not a height model — import it under Maps"
                )
            raise JobFailure(f"{path.name} has {src.count} bands; a height model has exactly one")
        t = src.transform
        if t.is_identity:
            raise JobFailure(f"{path.name} has no georeferencing (no geotransform); a design DEM needs one")
        declared = src.nodata
        has_mask = MaskFlags.per_dataset in src.mask_flag_enums[0]
        scale = float(src.scales[0] or 1.0)
        offset = float(src.offsets[0] or 0.0)
        factor = min(1.0, DECIMATED_SIDE / max(src.width, src.height))
        h, w = max(1, round(src.height * factor)), max(1, round(src.width * factor))
        check_cancelled()
        raw = src.read(1, out_shape=(h, w), resampling=Resampling.nearest, masked=True)
        data = raw.astype(np.float64).filled(np.nan)
        notes, sentinel = [], None
        if declared is None and not has_mask:
            sentinel = _sentinel(data)
            if sentinel is not None:
                notes.append(
                    codes.warn(
                        "sentinel_nodata", f"cells at {sentinel:g} look like 'no data' and are left out"
                    )
                )
                data[np.isclose(data, sentinel, rtol=1e-7, atol=1e-9)] = np.nan
            else:
                notes.append(
                    codes.info(
                        "nodata_unknown",
                        "the file declares no 'no data' value: every cell counts as a height",
                    )
                )
        z = data * scale + offset
        cell_x, cell_y = math.hypot(t.a, t.d), math.hypot(t.b, t.e)
        shade = grid.hillshade(z.astype(np.float32), cell_x * src.width / w, cell_y * src.height / h)
        thumbs.shade_thumbnail(shade, store.thumb_path(idir, "c0"))
        store.candidate_dir(idir, "c0").mkdir(parents=True, exist_ok=True)
        store.write_json(store.candidate_dir(idir, "c0") / "meta.json", {"geometry": "raster"})
        crs = CRS.from_wkt(src.crs.to_wkt()) if src.crs else None
        valid = z[np.isfinite(z)]
        # A declared NaN nodata (a float surface) needs no value: masked reads already give NaN, and
        # NaN must never reach a JSON response (Starlette refuses non-finite floats).
        nodata = float(declared) if declared is not None and not math.isnan(declared) else sentinel
        candidate = Candidate(
            id="c0",
            kind="dem",
            name="band 1",
            geometry="raster",
            bounds_file=list(raster_envelope(t, src.width, src.height)),
            z_min=float(valid.min()) if valid.size else None,
            z_max=float(valid.max()) if valid.size else None,
            point_count=0,
            face_count=0,
            entity_counts={},
            default_selected=True,
            notes=notes,
            raster={
                "width": src.width,
                "height": src.height,
                "cell_x": cell_x,
                "cell_y": cell_y,
                "dtype": src.dtypes[0],
                "nodata": nodata,
                "band_count": 1,
            },
        )
        rotated = t.b != 0 or t.d != 0
    vertical, source = _vertical_unit(crs)
    detected = Detected(
        None,
        vertical,
        source,
        crs_wkt=crs.to_wkt() if crs else None,
        epsg=crs.to_epsg() if crs else None,
        crs_source="GeoTIFF CRS" if crs else None,
    )
    progress(1.0, MESSAGE)
    internal = {
        "nodata": nodata,
        "sentinel": sentinel is not None,
        "mask": has_mask,
        "scale": scale,
        "offset": offset,
        "rotated": rotated,
    }
    return InspectResult(detected, [candidate], internal)
```

- [ ] **Step 4: Run the tests to verify they pass**

Run from `backend`: `$PY -m pytest tests/test_design_dem.py -v`
Expected: PASS.

- [ ] **Step 5: Commit**

```
git add backend/app/surfaces/design/dem.py backend/tests/test_design_dem.py
git commit -m "feat(design): DEM GeoTIFF inspection with sentinel nodata and a hillshade thumbnail" -m "Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---
### Task 10: Placement, the output and preview grids, and the target fixtures

Rebase onto `main` with S2 V1 first (see the DAG section).

**Files:**
- Create: `backend/app/surfaces/design/placement.py`
- Create: `backend/tests/design_targets.py`
- Test: `backend/tests/test_design_placement.py`

**Interfaces:**
- Consumes: Task 1 (`units`, `codes`); S2 V1 (`grid.aligned_grid`, `grid.same_lattice`, `grid.GridSpec`, `grid.GridError`, `grid.MAX_CELLS`, `grid.SurfaceWriter`, `grid.read_windows`, `grid.compute_stats`); `app.surfaces.paths.surface_path`; F0 `Surface`.
- Produces:
  - `placement.PlacementBlocked(note: DesignNote)` (exception with `.note`).
  - `placement.Placement(source_crs, out_crs, out_crs_wkt, out_epsg, cell_size, swap_xy, xy_factor, z_factor)` with `transformer() -> Transformer | None`.
  - `placement.parse_crs(text) -> CRS`, `placement.resolve(options: dict, fmt: str, target: GridSpec | None) -> Placement`, `placement.place_vertices(xyz, p, *, check_cancelled=None) -> np.ndarray (N, 3)`, `placement.xy_bounds(v) -> tuple`, `placement.output_grid(bounds, p) -> tuple[GridSpec, list[DesignNote]]`, `placement.preview_grid(bounds, out: GridSpec) -> tuple[GridSpec, int]`, `placement.raster_envelope(transform, width, height) -> tuple`.
  - `tests/design_targets.py`: `target_spec(bounds=(E0, N0, E0 + 200, N0 + 100), cell=0.5, epsg=32639)`, `write_target(path, spec, fn) -> Path`, `add_target(handle, spec, fn, *, name="Site DSM") -> str` (a ready `cloud_dsm` Surface row plus its `surface.tif`), `write_dem(path, z, *, x0, y0, cell, crs="EPSG:32639", dtype="float32", nodata=None, scale=None, offset=None, rotation=0.0, count=1, identity=False) -> Path`.

- [ ] **Step 1: Write the target fixtures**

`backend/tests/design_targets.py`:

```python
"""Cloud-surface targets and DEM files for the S3 tests (spec §15.3), written at test time."""

from __future__ import annotations

from pathlib import Path

import numpy as np
import rasterio
from affine import Affine
from designs import E0, N0
from pyproj import CRS

from app.surfaces import grid


def target_spec(
    bounds=(E0, N0, E0 + 200.0, N0 + 100.0), cell: float = 0.5, epsg: int = 32639
) -> grid.GridSpec:
    return grid.aligned_grid(bounds, cell, CRS.from_epsg(epsg).to_wkt(), epsg)


def write_target(path: Path, spec: grid.GridSpec, fn) -> Path:
    """A surface.tif through S2's writer, heights fn(X, Y) at the cell centres."""
    path.parent.mkdir(parents=True, exist_ok=True)
    with grid.SurfaceWriter(path, spec) as w:
        for win in grid.read_windows(spec):
            x, y = spec.cell_centres(win)
            w.write_block(win, np.asarray(fn(x, y), dtype=np.float32))
        w.finish()
    return path


def add_target(handle, spec: grid.GridSpec, fn, *, name: str = "Site DSM") -> str:
    """A ready cloud_dsm Surface row with its surface.tif, as S2's surface_build leaves it."""
    from app.db.models import Surface
    from app.surfaces.paths import surface_path

    with handle.session() as s:
        row = Surface(name=name, kind="cloud_dsm", status="building")
        s.add(row)
        s.flush()
        sid = row.id
    path = write_target(surface_path(handle, sid), spec, fn)
    stats = grid.compute_stats(path)
    with handle.session() as s:
        row = s.get(Surface, sid)
        row.status, row.method = "ready", "median"
        row.crs_wkt, row.epsg, row.cell_size_m = spec.crs_wkt, spec.epsg, spec.cell_size
        row.width, row.height = spec.width, spec.height
        row.geotransform, row.bounds_native = list(spec.geotransform), list(spec.bounds)
        row.z_min, row.z_max, row.coverage_fraction = stats.z_min, stats.z_max, stats.coverage_fraction
    return sid


def write_dem(
    path: Path,
    z,
    *,
    x0: float,
    y0: float,
    cell: float,
    crs: str | None = "EPSG:32639",
    dtype: str = "float32",
    nodata: float | None = None,
    scale: float | None = None,
    offset: float | None = None,
    rotation: float = 0.0,
    count: int = 1,
    identity: bool = False,
) -> Path:
    """A plain (untiled, uncompressed) GeoTIFF: never a conforming surface unless written by write_target."""
    data = np.asarray(z)
    if data.ndim == 2:
        data = data[None]
    _, h, w = data.shape
    transform = (
        Affine.identity()
        if identity
        else Affine.translation(x0, y0) * Affine.rotation(rotation) * Affine.scale(cell, -cell)
    )
    profile = dict(driver="GTiff", width=w, height=h, count=count, dtype=dtype, transform=transform)
    if crs:
        profile["crs"] = crs
    if nodata is not None:
        profile["nodata"] = nodata
    path.parent.mkdir(parents=True, exist_ok=True)
    with rasterio.open(path, "w", **profile) as dst:
        dst.write(data.astype(dtype))
        if scale is not None or offset is not None:
            dst.scales = (scale if scale is not None else 1.0,) * count
            dst.offsets = (offset if offset is not None else 0.0,) * count
    return path
```

- [ ] **Step 2: Write the failing tests**

`backend/tests/test_design_placement.py`:

```python
"""Placement (spec §5, §15.3 Placement, §16.4)."""

import numpy as np
import pytest
from design_targets import target_spec
from designs import E0, N0

from app.surfaces import grid
from app.surfaces.design import placement as pl


def opts(**kw):
    base = {
        "candidate_ids": ["c0"],
        "source_crs": "EPSG:32639",
        "horizontal_unit": "metre",
        "vertical_unit": "metre",
    }
    return {**base, "swap_xy": False, "target_surface_id": None, "cell_size_m": 0.5, **kw}


def test_a_mm_drawing_in_a_metric_crs_is_scaled_by_a_thousandth():
    p = pl.resolve(opts(horizontal_unit="millimetre", vertical_unit="millimetre"), "dxf", None)
    assert p.xy_factor == 0.001 and p.z_factor == 0.001
    out = pl.place_vertices(np.array([[E0 * 1000, N0 * 1000, 1500.0]]), p)
    np.testing.assert_allclose(out, [[E0, N0, 1.5]])


def test_an_international_foot_file_in_a_us_foot_crs():
    p = pl.resolve(opts(source_crs="EPSG:2229", horizontal_unit="international_foot"), "dxf", target_spec())
    assert p.xy_factor == pytest.approx(0.999998, abs=1e-9)


def test_equal_units_give_exactly_one_and_no_transform():
    p = pl.resolve(opts(), "landxml", None)
    assert p.xy_factor == 1.0 and p.z_factor == 1.0 and p.transformer() is None


def test_swap():
    p = pl.resolve(opts(swap_xy=True), "landxml", None)
    np.testing.assert_allclose(pl.place_vertices(np.array([[N0, E0, 3.0]]), p), [[E0, N0, 3.0]])


def test_us_foot_heights_convert_exactly():
    p = pl.resolve(opts(vertical_unit="us_survey_foot"), "landxml", None)
    assert pl.place_vertices(np.array([[E0, N0, 100.0]]), p)[0, 2] == pytest.approx(
        30.480060960121920, rel=1e-12
    )


def test_the_output_grid_is_aligned_and_shares_the_target_lattice():
    target = target_spec(cell=0.5)
    p = pl.resolve(opts(source_crs="EPSG:32638"), "landxml", target)
    assert (p.cell_size, p.out_epsg) == (0.5, 32639) and p.transformer() is not None
    placed = pl.place_vertices(np.array([[740_000.3, 2_800_000.7, 1.0], [740_150.2, 2_800_080.1, 2.0]]), p)
    out, notes = pl.output_grid(pl.xy_bounds(placed), p)
    assert grid.same_lattice(out, target) and notes == []
    assert (out.x0 / 0.5) == pytest.approx(round(out.x0 / 0.5), abs=1e-9)


def test_without_a_target_the_source_crs_and_the_cell_are_used():
    p = pl.resolve(opts(cell_size_m=0.25), "landxml", None)
    out, _ = pl.output_grid((E0 + 0.3, N0 + 0.7, E0 + 10.2, N0 + 5.1), p)
    assert (out.cell_size, out.epsg, out.x0) == (0.25, 32639, E0 + 0.25)


def test_the_preview_grid_is_an_integer_coarsening_of_the_output():
    p = pl.resolve(opts(cell_size_m=0.1), "landxml", None)
    bounds = (E0, N0, E0 + 400.0, N0 + 300.0)
    out, _ = pl.output_grid(bounds, p)
    prev, k = pl.preview_grid(bounds, out)
    assert k == 8 and prev.cell_size == pytest.approx(0.8)
    assert max(prev.width, prev.height) <= 513
    assert (prev.x0 - out.x0) / out.cell_size == pytest.approx(
        round((prev.x0 - out.x0) / out.cell_size), abs=1e-6
    )


@pytest.mark.parametrize(
    ("source", "code"),
    [("EPSG:4326", "geographic_output"), ("EPSG:2229", "non_metric_output")],
)
def test_a_non_metric_output_without_a_target_is_blocked(source, code):
    with pytest.raises(pl.PlacementBlocked) as e:
        pl.resolve(opts(source_crs=source), "landxml", None)
    assert e.value.note.code == code and e.value.note.level == "block"


def test_a_crs_unit_outside_the_enum_is_blocked():
    with pytest.raises(pl.PlacementBlocked) as e:
        pl.resolve(opts(source_crs="+proj=utm +zone=39 +datum=WGS84 +units=km"), "landxml", target_spec())
    assert e.value.note.code == "unsupported_crs_unit"


def test_grid_size_ceilings():
    p = pl.resolve(opts(cell_size_m=0.001), "landxml", None)
    with pytest.raises(pl.PlacementBlocked) as e:
        pl.output_grid((E0, N0, E0 + 100_000, N0 + 100_000), p)
    assert e.value.note.code == "grid_too_large"
    p1 = pl.resolve(opts(cell_size_m=1.0), "landxml", None)
    _, notes = pl.output_grid((E0, N0, E0 + 20_000, N0 + 20_000), p1)
    assert [n.code for n in notes] == ["large_grid"]


def test_unplaceable_coordinates_are_blocked():
    p = pl.resolve(opts(source_crs="EPSG:4326"), "landxml", target_spec())
    with pytest.raises(pl.PlacementBlocked) as e:
        pl.place_vertices(np.array([[5e6, 5e6, 0.0]]), p)
    assert e.value.note.level == "block"


def test_raster_envelope_of_a_rotated_transform():
    from affine import Affine

    t = Affine.translation(100, 200) * Affine.rotation(90) * Affine.scale(1, -1)
    assert pl.raster_envelope(t, 10, 20) == pytest.approx((100.0, 200.0, 120.0, 210.0))
```

- [ ] **Step 3: Run the tests to verify they fail**

Run from `backend`: `$PY -m pytest tests/test_design_placement.py -v`
Expected: FAIL with `ModuleNotFoundError: No module named 'app.surfaces.design.placement'`.

- [ ] **Step 4: Write `placement.py`**

```python
"""Placement (spec §5): swap, horizontal scale, Z scale, reprojection, the output and preview grids.

Vertices are moved (exact at the vertices); rasters are warped later by dem_build. The output grid
is always grid.aligned_grid: with a target it adopts the target's CRS and cell, so
same_lattice(output, target) holds and S2 reads both surfaces with an integer offset (case R1).
"""

from __future__ import annotations

import math
from dataclasses import dataclass

import numpy as np
from pyproj import CRS, Transformer

from app.surfaces import grid
from app.surfaces.design import codes
from app.surfaces.design.codes import DesignNote
from app.surfaces.design.units import (
    LinearUnit,
    UnsupportedCrsUnit,
    horizontal_crs,
    unit_from_factor,
    unit_to_m,
    xy_scale,
)

CHUNK = 1_000_000
PREVIEW_SIDE = 512
LARGE_GRID_CELLS = 250_000_000


class PlacementBlocked(Exception):
    """A `block` warning found while placing: the preview reports it and no import is possible."""

    def __init__(self, note: DesignNote):
        super().__init__(note.message)
        self.note = note


@dataclass(frozen=True)
class Placement:
    source_crs: CRS
    out_crs: CRS | None
    out_crs_wkt: str | None
    out_epsg: int | None
    cell_size: float
    swap_xy: bool
    xy_factor: float
    z_factor: float

    def transformer(self) -> Transformer | None:
        if self.out_crs is None or self.source_crs.equals(self.out_crs):
            return None
        return Transformer.from_crs(self.source_crs, self.out_crs, always_xy=True)


def parse_crs(text: str) -> CRS:
    return CRS.from_user_input(text.strip())


def resolve(options: dict, fmt: str, target: grid.GridSpec | None) -> Placement:
    """Options -> Placement. `target` is the target surface's GridSpec, or None."""
    src = parse_crs(options["source_crs"])
    try:
        xy = 1.0 if fmt == "geotiff" else xy_scale(options["horizontal_unit"], src)
    except UnsupportedCrsUnit as e:
        raise PlacementBlocked(codes.block("unsupported_crs_unit", str(e))) from None
    z = unit_to_m(options["vertical_unit"])
    swap = bool(options.get("swap_xy")) and fmt != "geotiff"
    if target is not None:
        out = CRS.from_wkt(target.crs_wkt) if target.crs_wkt else None
        return Placement(src, out, target.crs_wkt, target.epsg, target.cell_size, swap, xy, z)
    h = horizontal_crs(src)
    if not h.is_projected:
        raise PlacementBlocked(
            codes.block(
                "geographic_output",
                "the source CRS is geographic (degrees): choose a target cloud surface so the design "
                "lands on a grid in metres",
            )
        )
    if unit_from_factor(h.axis_info[0].unit_conversion_factor) is not LinearUnit.metre:
        raise PlacementBlocked(
            codes.block(
                "non_metric_output",
                f"the source CRS is in {h.axis_info[0].unit_name}: choose a target cloud surface so the "
                "design lands on a grid in metres",
            )
        )
    return Placement(src, h, h.to_wkt(), h.to_epsg(), float(options["cell_size_m"]), swap, xy, z)


def place_vertices(xyz, p: Placement, *, check_cancelled=None) -> np.ndarray:
    """File-unit vertices -> output CRS, Z in metres (spec §5 steps 1-4), in chunks of 1 M."""
    check = check_cancelled or (lambda: None)
    n = len(xyz)
    out = np.empty((n, 3), dtype=np.float64)
    tr = p.transformer()
    for s in range(0, n, CHUNK):
        check()
        c = np.asarray(xyz[s : s + CHUNK], dtype=np.float64)
        x, y = (c[:, 1], c[:, 0]) if p.swap_xy else (c[:, 0], c[:, 1])
        if p.xy_factor != 1.0:
            x, y = x * p.xy_factor, y * p.xy_factor
        if tr is not None:
            x, y = tr.transform(x, y)
        out[s : s + len(c), 0] = x
        out[s : s + len(c), 1] = y
        out[s : s + len(c), 2] = c[:, 2] * p.z_factor if p.z_factor != 1.0 else c[:, 2]
    if n and not np.isfinite(out[:, :2]).all():
        raise PlacementBlocked(
            codes.block(
                "empty_result",
                "the design's coordinates can't be placed in the output CRS — check the source CRS",
            )
        )
    return out


def xy_bounds(v: np.ndarray) -> tuple[float, float, float, float]:
    return float(v[:, 0].min()), float(v[:, 1].min()), float(v[:, 0].max()), float(v[:, 1].max())


def output_grid(bounds, p: Placement) -> tuple[grid.GridSpec, list[DesignNote]]:
    try:
        spec = grid.aligned_grid(tuple(bounds), p.cell_size, p.out_crs_wkt, p.out_epsg, max_cells=2**62)
    except grid.GridError as e:
        raise PlacementBlocked(
            codes.block("non_metric_output", f"the output grid can't be made: {e}")
        ) from None
    cells = spec.width * spec.height
    if cells > grid.MAX_CELLS:
        raise PlacementBlocked(
            codes.block(
                "grid_too_large",
                f"the output grid would have {cells:,} cells, more than the {grid.MAX_CELLS:,} a surface "
                "can hold: choose a coarser cell",
            )
        )
    notes = []
    if cells > LARGE_GRID_CELLS:
        notes.append(
            codes.info("large_grid", f"the output grid has {cells:,} cells: the import takes a few minutes")
        )
    return spec, notes


def preview_grid(bounds, out: grid.GridSpec) -> tuple[grid.GridSpec, int]:
    """aligned_grid at k x cell, k = ceil(max(w, h) / 512): each preview cell is k x k output cells."""
    k = max(1, math.ceil(max(out.width, out.height) / PREVIEW_SIDE))
    return grid.aligned_grid(tuple(bounds), k * out.cell_size, out.crs_wkt, out.epsg), k


def raster_envelope(transform, width: int, height: int) -> tuple[float, float, float, float]:
    """The axis-aligned envelope of a (possibly rotated) raster's four corners."""
    xs, ys = zip(*(transform * c for c in ((0, 0), (width, 0), (width, height), (0, height))), strict=True)
    return min(xs), min(ys), max(xs), max(ys)
```

- [ ] **Step 5: Run the tests to verify they pass**

Run from `backend`: `$PY -m pytest tests/test_design_placement.py -v`
Expected: PASS.

- [ ] **Step 6: Commit**

```
git add backend/app/surfaces/design/placement.py backend/tests/design_targets.py backend/tests/test_design_placement.py
git commit -m "feat(design): placement onto the aligned lattice of the target surface" -m "Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 11: DEM build paths — copy as-is, re-grid, preview read

**Files:**
- Create: `backend/app/surfaces/design/dem_build.py`
- Test: `backend/tests/test_design_dem_build.py`
- Create: `vault/decisions/2026-09-24-gotcha-gdal-warp-tolerance-breaks-mm-accuracy.md`

**Interfaces:**
- Consumes: Task 10 (`Placement`, `resolve`, `raster_envelope`, `tests/design_targets`); Task 9's `internal` keys (`nodata`, `sentinel`, `scale`, `offset`, plus Task 4's `file_size`, `mtime_ns`) — the tests build these dicts directly, so this task does not wait on Task 9; S2 V1 (`grid.convention_problems`, `grid.GridSpec.from_dataset`, `grid.same_lattice`, `grid.read_windows`, `grid.MAX_READ`, `grid.SurfaceWriter`, `grid.GridError`).
- Produces:
  - `dem_build.check_unchanged(path, internal) -> None` (raises `JobFailure`).
  - `dem_build.footprint(path, p) -> tuple` (the DEM's envelope in the output CRS).
  - `dem_build.can_copy(path, p, target: GridSpec | None, internal) -> bool`.
  - `dem_build.copy_file(src, dst, *, progress, check_cancelled) -> None` (via `dst.partial`, renamed).
  - `dem_build.read_window(vrt, window) -> np.ndarray` (the one pixel read; spied).
  - `dem_build.regrid(path, spec, writer, p, internal, *, progress, check_cancelled) -> None`.
  - `dem_build.read_preview(path, pspec, p, internal) -> np.ndarray` (float32 (h, w)).

- [ ] **Step 1: Write the failing tests**

`backend/tests/test_design_dem_build.py`:

```python
"""DEM copy and re-grid (spec §6 Build, §15.3 DEM, §16.1, §16.5)."""

import os

import numpy as np
import pytest
import rasterio
from design_targets import target_spec, write_dem, write_target
from designs import E0, N0, plane_z
from pyproj import CRS, Transformer
from rasterio.windows import Window

from app.jobs.cancellation import JobFailure
from app.surfaces import grid
from app.surfaces.design import dem_build
from app.surfaces.design import placement as pl

INTERNAL = {"nodata": None, "sentinel": False, "mask": False, "scale": 1.0, "offset": 0.0, "rotated": False}


def opts(**kw):
    return {
        "candidate_ids": ["c0"],
        "source_crs": "EPSG:32639",
        "horizontal_unit": "metre",
        "vertical_unit": "metre",
        **kw,
    }


def build(tmp_path, src, spec, p, internal=INTERNAL):
    out = tmp_path / "out" / "surface.tif"
    out.parent.mkdir(parents=True, exist_ok=True)
    with grid.SurfaceWriter(out, spec) as w:
        dem_build.regrid(src, spec, w, p, internal, progress=lambda f, m: None, check_cancelled=lambda: None)
        w.finish()
    with rasterio.open(out) as r:
        return r.read(1)


def centres(spec):
    return spec.cell_centres(Window(0, 0, spec.width, spec.height))


def test_a_conforming_dem_on_the_target_lattice_is_copied_byte_for_byte(tmp_path):
    target = target_spec()
    src = write_target(tmp_path / "design.tif", target, lambda x, y: plane_z(x, y) - 1.0)
    p = pl.resolve(opts(), "geotiff", target)
    assert grid.convention_problems(src) == []
    assert dem_build.can_copy(src, p, target, INTERNAL)
    dst = tmp_path / "surface.tif"
    dem_build.copy_file(src, dst, progress=lambda f, m: None, check_cancelled=lambda: None)
    with rasterio.open(src) as a, rasterio.open(dst) as b:
        assert np.array_equal(a.read(1), b.read(1), equal_nan=True)
    assert not dst.with_name("surface.tif.partial").exists()


@pytest.mark.parametrize(
    ("case", "kw"),
    [
        ("plain tiff", {}),
        ("feet heights", {"vertical_unit": "international_foot"}),
        ("other crs", {"source_crs": "EPSG:32638"}),
    ],
)
def test_anything_else_is_regridded(tmp_path, case, kw):
    target = target_spec()
    if case == "plain tiff":
        src = write_dem(tmp_path / "d.tif", np.ones((200, 400), np.float32), x0=E0, y0=N0 + 100, cell=0.5)
    else:
        src = write_target(tmp_path / "d.tif", target, plane_z)
    assert not dem_build.can_copy(src, pl.resolve(opts(**kw), "geotiff", target), target, INTERNAL)
    assert not dem_build.can_copy(
        src, pl.resolve(opts(), "geotiff", target), target, {**INTERNAL, "sentinel": True}
    )


def test_a_plane_in_utm_38_regrids_onto_a_utm_39_target_within_a_millimetre(tmp_path):
    to38 = Transformer.from_crs(32639, 32638, always_xy=True)
    target = target_spec((250_000.0, 3_000_000.0, 250_400.0, 3_000_300.0), cell=0.5)
    xs, ys = to38.transform(
        [250_000, 250_400, 250_400, 250_000], [3_000_000, 3_000_000, 3_000_300, 3_000_300]
    )
    x0, y1 = min(xs) - 20, max(ys) + 20
    w, h = int(max(xs) - x0 + 20), int(y1 - (min(ys) - 20))
    X0, Y0 = x0, y1

    def plane38(x, y):
        return 10.0 + 0.02 * (x - X0) - 0.01 * (Y0 - y)

    cols, rows = np.meshgrid(np.arange(w) + 0.5, np.arange(h) + 0.5)
    src = write_dem(
        tmp_path / "p38.tif", plane38(x0 + cols, y1 - rows), x0=x0, y0=y1, cell=1.0, crs="EPSG:32638"
    )
    p = pl.resolve(opts(source_crs="EPSG:32638"), "geotiff", target)
    out = build(tmp_path, src, target, p)
    X, Y = centres(target)
    ex, ey = to38.transform(X, Y)
    assert np.isfinite(out).all()
    assert np.abs(out - plane38(ex, ey)).max() < 1e-3


def test_feet_heights_become_metres(tmp_path):
    target = target_spec()
    z = plane_z(*centres(target)) / 0.3048
    src = write_dem(tmp_path / "ft.tif", z.astype(np.float32), x0=target.x0, y0=target.y0, cell=0.5)
    out = build(
        tmp_path, src, target, pl.resolve(opts(vertical_unit="international_foot"), "geotiff", target)
    )
    assert np.abs(out - plane_z(*centres(target))).max() < 1e-4


@pytest.mark.parametrize(
    ("dtype", "nodata", "internal"),
    [("int16", -32767, {"nodata": -32767.0}), ("float32", None, {"nodata": -9999.0, "sentinel": True})],
)
def test_nodata_and_sentinels_become_nan(tmp_path, dtype, nodata, internal):
    target = target_spec()
    z = np.full((target.height, target.width), 12, dtype=dtype)
    z[:, :40] = -32767 if dtype == "int16" else -9999
    src = write_dem(tmp_path / "n.tif", z, x0=target.x0, y0=target.y0, cell=0.5, dtype=dtype, nodata=nodata)
    out = build(tmp_path, src, target, pl.resolve(opts(), "geotiff", target), {**INTERNAL, **internal})
    assert np.isnan(out[:, :39]).all() and np.nanmin(out) == 12.0


def test_no_read_is_larger_than_2048(tmp_path, monkeypatch):
    target = target_spec((E0, N0, E0 + 300.0, N0 + 250.0), cell=0.1)
    assert target.width > 2048
    src = write_dem(tmp_path / "big.tif", np.ones((250, 300), np.float32), x0=E0, y0=N0 + 250, cell=1.0)
    sizes, real = [], dem_build.read_window

    def spy(vrt, window):
        sizes.append((window.width, window.height))
        return real(vrt, window)

    monkeypatch.setattr(dem_build, "read_window", spy)
    build(tmp_path, src, target, pl.resolve(opts(), "geotiff", target))
    assert sizes and max(max(s) for s in sizes) == 2048


def test_the_preview_read_is_one_window(tmp_path):
    target = target_spec()
    src = write_target(tmp_path / "d.tif", target, plane_z)
    p = pl.resolve(opts(), "geotiff", target)
    prev, _ = pl.preview_grid(target.bounds, target)
    out = dem_build.read_preview(src, prev, p, INTERNAL)
    assert out.shape == (prev.height, prev.width) and np.isfinite(out).mean() > 0.95


def test_a_changed_file_is_refused(tmp_path):
    src = write_dem(tmp_path / "d.tif", np.ones((10, 10), np.float32), x0=E0, y0=N0 + 10, cell=1.0)
    st = src.stat()
    internal = {"file_size": st.st_size, "mtime_ns": st.st_mtime_ns}
    dem_build.check_unchanged(src, internal)
    os.utime(src, ns=(st.st_atime_ns, st.st_mtime_ns + 5_000_000_000))
    with pytest.raises(JobFailure, match="changed since it was read"):
        dem_build.check_unchanged(src, internal)


def test_footprint_in_another_crs(tmp_path):
    src = write_dem(tmp_path / "d.tif", np.ones((10, 10), np.float32), x0=E0, y0=N0 + 10, cell=1.0)
    p = pl.resolve(opts(), "geotiff", target_spec(epsg=32638))
    minx, miny, maxx, maxy = dem_build.footprint(src, p)
    assert maxx - minx > 9 and CRS.from_wkt(p.out_crs_wkt).to_epsg() == 32638
```

- [ ] **Step 2: Run the tests to verify they fail**

Run from `backend`: `$PY -m pytest tests/test_design_dem_build.py -v`
Expected: FAIL with `ModuleNotFoundError: No module named 'app.surfaces.design.dem_build'`.

- [ ] **Step 3: Write `dem_build.py`**

```python
"""DEM build paths (spec §6 Build): copy as-is when the file already is a surface on the lattice,
else re-grid window by window through a WarpedVRT onto the output grid. No read exceeds 2048².

The warp runs with tolerance=0: GDAL's default approximate transformer (0.125 px) alone is 2.5 mm
off on a 2 % slope at a 1 m source cell (ADR 2026-09-24 GDAL warp tolerance).
"""

from __future__ import annotations

import math
import os
from pathlib import Path

import numpy as np
from pyproj import CRS
from rasterio.windows import Window

from app.jobs.cancellation import JobFailure
from app.surfaces import grid
from app.surfaces.design.placement import Placement, raster_envelope

COPY_CHUNK = 64 * 2**20
MESSAGE = "Importing design surface"


def check_unchanged(path: Path, internal: dict) -> None:
    try:
        st = Path(path).stat()
    except OSError:
        raise JobFailure(f"{Path(path).name} is no longer there; read the file again") from None
    if st.st_size != internal.get("file_size") or st.st_mtime_ns != internal.get("mtime_ns"):
        raise JobFailure(f"{Path(path).name} changed since it was read; read it again")


def footprint(path: Path, p: Placement) -> tuple[float, float, float, float]:
    import rasterio
    from rasterio.warp import transform_bounds

    with rasterio.open(path) as src:
        env = raster_envelope(src.transform, src.width, src.height)
    if p.out_crs is None or p.source_crs.equals(p.out_crs):
        return env
    return tuple(transform_bounds(p.source_crs.to_wkt(), p.out_crs.to_wkt(), *env, densify_pts=21))


def can_copy(path: Path, p: Placement, target: grid.GridSpec | None, internal: dict) -> bool:
    """Spec §6: the copied file must be a valid surface on the aligned lattice as it is."""
    import rasterio

    if internal.get("sentinel") or internal.get("scale", 1.0) != 1.0 or internal.get("offset", 0.0) != 0.0:
        return False
    if p.z_factor != 1.0 or grid.convention_problems(path):
        return False
    with rasterio.open(path) as src:
        spec = grid.GridSpec.from_dataset(src)
    if spec.crs_wkt is None or p.out_crs is None:
        return False
    if not (CRS.from_wkt(spec.crs_wkt).equals(p.source_crs) and p.source_crs.equals(p.out_crs)):
        return False
    if target is not None:
        return grid.same_lattice(spec, target)
    return math.isclose(spec.cell_size, p.cell_size, rel_tol=1e-9)


def copy_file(src: Path, dst: Path, *, progress, check_cancelled) -> None:
    partial = dst.with_name(dst.name + ".partial")
    size, done = max(src.stat().st_size, 1), 0
    try:
        with open(src, "rb") as fi, open(partial, "wb") as fo:
            while chunk := fi.read(COPY_CHUNK):
                check_cancelled()
                fo.write(chunk)
                done += len(chunk)
                progress(done / size, MESSAGE)
        os.replace(partial, dst)
    except BaseException:
        partial.unlink(missing_ok=True)
        raise


def _src_cell(src) -> float:
    t = src.transform
    return min(math.hypot(t.a, t.d), math.hypot(t.b, t.e))


def _open_warped(src, spec: grid.GridSpec, p: Placement, internal: dict):
    from rasterio.enums import Resampling
    from rasterio.vrt import WarpedVRT

    resampling = Resampling.bilinear if spec.cell_size <= 2 * _src_cell(src) else Resampling.average
    return WarpedVRT(
        src,
        src_crs=p.source_crs.to_wkt(),
        crs=spec.crs_wkt or p.source_crs.to_wkt(),
        transform=spec.transform,
        width=spec.width,
        height=spec.height,
        src_nodata=internal.get("nodata"),
        nodata=np.nan,
        dtype="float32",
        resampling=resampling,
        tolerance=0.0,
    )


def read_window(vrt, window: Window) -> np.ndarray:
    """The one pixel read of the DEM paths; never above MAX_READ on a side (spied by the tests)."""
    if window.width > grid.MAX_READ or window.height > grid.MAX_READ:
        raise grid.GridError(f"a read of {window.width} x {window.height} exceeds {grid.MAX_READ}")
    return vrt.read(1, window=window, masked=True).astype(np.float32).filled(np.nan)


def _heights(data: np.ndarray, internal: dict, z_factor: float) -> np.ndarray:
    z = data.astype(np.float64) * internal.get("scale", 1.0) + internal.get("offset", 0.0)
    return (z * z_factor).astype(np.float32)


def regrid(
    path: Path, spec: grid.GridSpec, writer, p: Placement, internal: dict, *, progress, check_cancelled
) -> None:
    """Every read_windows window of `spec` that meets the DEM's footprint, through SurfaceWriter."""
    import rasterio

    within = spec.window_for_bounds(footprint(path, p), pad=1)
    if within.width == 0 or within.height == 0:
        return
    windows = list(grid.read_windows(spec, within=within))
    with rasterio.open(path) as src, _open_warped(src, spec, p, internal) as vrt:
        for i, win in enumerate(windows):
            check_cancelled()
            data = _heights(read_window(vrt, win), internal, p.z_factor)
            if np.isfinite(data).any():
                writer.write_block(win, data)
            progress((i + 1) / len(windows), MESSAGE)


def read_preview(path: Path, pspec: grid.GridSpec, p: Placement, internal: dict) -> np.ndarray:
    import rasterio

    with rasterio.open(path) as src, _open_warped(src, pspec, p, internal) as vrt:
        return _heights(read_window(vrt, Window(0, 0, pspec.width, pspec.height)), internal, p.z_factor)
```

- [ ] **Step 4: Run the tests to verify they pass**

Run from `backend`: `$PY -m pytest tests/test_design_dem_build.py -v`
Expected: PASS. If the UTM 38 → 39 oracle misses 1 mm, check `tolerance=0.0` reached GDAL (print `vrt.tolerance`) before touching anything else.

- [ ] **Step 5: Record the ADR**

`vault/decisions/2026-09-24-gotcha-gdal-warp-tolerance-breaks-mm-accuracy.md`:

```markdown
---
type: adr
date: 2026-09-24
status: accepted
tags: [decision, gotcha, surfaces, gdal]
related: ["[[2026-09-23-design-surfaces-design]]", "[[2026-09-22-rasterio-in-the-frozen-sidecar]]"]
---

# Gotcha: GDAL's default warp tolerance breaks millimetre re-gridding

## Context

A design DEM in another CRS is re-gridded onto the target surface's lattice through a rasterio
`WarpedVRT`. GDAL approximates the coordinate transform with a linear interpolator whose error
tolerance defaults to 0.125 source pixels. On a 2 % slope at a 1 m source cell that alone is
2.5 mm of height error — more than the spec's 1 mm oracle, and invisible in a quick look.

## Decision

Open every design `WarpedVRT` with `tolerance=0.0` (the exact transformer per pixel). The cost is
a slower warp, paid once per import in a background job.

## Consequences

- Positive: `test_a_plane_in_utm_38_regrids_onto_a_utm_39_target_within_a_millimetre` holds.
- Negative: re-gridding a large DEM in another CRS is measurably slower (the Task 17 evidence
  records the time on the operator's machine).
```

- [ ] **Step 6: Commit**

```
git add backend/app/surfaces/design/dem_build.py backend/tests/test_design_dem_build.py vault/decisions/2026-09-24-gotcha-gdal-warp-tolerance-breaks-mm-accuracy.md
git commit -m "feat(design): DEM copy-as-is gate and exact windowed re-grid" -m "Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 12: Validation and the preview image

**Files:**
- Create: `backend/app/surfaces/design/validate.py`, `backend/app/surfaces/design/preview_image.py`
- Test: `backend/tests/test_design_validate.py`

**Interfaces:**
- Consumes: Task 1 (`codes`, `units`); Task 10 (`placement.*`, `tests/design_targets`); S2 V1 (`grid.open_surface`, `SurfaceReader.read(window, out_shape=)`, `grid.resample_onto`, `grid.hillshade`).
- Produces:
  - `validate.TargetOverview(z, x0, y0, cell_x, cell_y, crs_wkt)` with `bounds`, `valid_area_m2`, `sample(x, y)`; `validate.read_target_overview(reader) -> TargetOverview` (one read, ≤ 512 px).
  - `validate.ValidationInput(fmt, options, detected, internal, file_bounds, placement, design, pspec, target_spec=None, target_on_preview=None, overview=None, samples=None, tin={})`.
  - `validate.ValidationResult(overlap_fraction, target_covered_fraction, design_area_m2, z_check, warnings: list[DesignNote], suggestions: list[dict])`.
  - `validate.validate(v) -> ValidationResult`.
  - `preview_image.Layer(z, x0, y0, cell_x, cell_y)`, `preview_image.render(design: Layer, target: Layer | None, out: Path) -> int` (panels drawn: 1 or 2).

- [ ] **Step 1: Write the failing tests**

`backend/tests/test_design_validate.py`:

```python
"""Validation and the preview image (spec §10, §15.3 Validation, §16.2, §16.3)."""

import numpy as np
import pytest
from design_targets import target_spec, write_target
from designs import E0, N0, plane_z
from PIL import Image
from pyproj import CRS
from rasterio.windows import Window

from app.surfaces import grid
from app.surfaces.design import placement as pl
from app.surfaces.design import preview_image, validate

DESIGN_BOUNDS = (E0 + 20, N0 + 20, E0 + 180, N0 + 80)


@pytest.fixture
def target(tmp_path):
    spec = target_spec()
    reader = grid.open_surface(write_target(tmp_path / "t.tif", spec, plane_z))
    yield spec, reader
    reader.close()


def samples_over(bounds, swap=False, scale=1.0):
    e, n = np.meshgrid(np.linspace(bounds[0], bounds[2], 60), np.linspace(bounds[1], bounds[3], 30))
    pts = np.column_stack([e.ravel(), n.ravel(), np.zeros(e.size)])
    if swap:
        pts[:, [0, 1]] = pts[:, [1, 0]]
    return pts * [scale, scale, 1]


def make(target, *, dz=0.0, zscale=1.0, shift=(0.0, 0.0), fmt="landxml", with_target=True, **kw):
    spec, reader = target
    options = {
        "candidate_ids": ["c0"],
        "source_crs": "EPSG:32639",
        "horizontal_unit": "metre",
        "vertical_unit": "metre",
        "swap_xy": False,
        "target_surface_id": "t" if with_target else None,
        "cell_size_m": 0.5,
        **kw.pop("options", {}),
    }
    p = pl.resolve(options, fmt, spec if with_target else None)
    b = (
        DESIGN_BOUNDS[0] + shift[0],
        DESIGN_BOUNDS[1] + shift[1],
        DESIGN_BOUNDS[2] + shift[0],
        DESIGN_BOUNDS[3] + shift[1],
    )
    out, _ = pl.output_grid(b, p)
    pspec, _ = pl.preview_grid(b, out)
    x, y = pspec.cell_centres(Window(0, 0, pspec.width, pspec.height))
    design = (plane_z(x, y) * zscale + dz).astype(np.float32)
    full = Window(0, 0, pspec.width, pspec.height)
    return validate.ValidationInput(
        fmt=fmt,
        options=options,
        detected=kw.pop("detected", {}),
        internal=kw.pop("internal", {}),
        file_bounds=kw.pop("file_bounds", b),
        placement=p,
        design=design,
        pspec=pspec,
        target_spec=spec if with_target else None,
        target_on_preview=grid.resample_onto(reader, pspec, full) if with_target else None,
        overview=validate.read_target_overview(reader) if with_target else None,
        samples=kw.pop("samples", None),
        tin=kw.pop("tin", {}),
    )


def codes_of(result):
    return {w.code: w for w in result.warnings}


def test_the_same_design_on_the_target_overlaps_and_shows_the_offset(target):
    r = validate.validate(make(target, dz=0.3))
    assert r.overlap_fraction >= 0.99
    assert r.z_check["median_dz_m"] == pytest.approx(0.3, abs=1e-3)
    assert r.target_covered_fraction == pytest.approx(160 * 60 / (200 * 100), abs=0.02)
    assert r.design_area_m2 == pytest.approx(160 * 60, rel=0.02)
    assert not {"no_overlap", "low_overlap", "z_offset", "z_units"} & set(codes_of(r))


def test_a_45_m_offset_is_a_z_offset(target):
    w = codes_of(validate.validate(make(target, dz=45.0)))["z_offset"]
    assert w.level == "warn" and "+45.0 m" in w.message


def test_feet_heights_read_as_metres_are_z_units(target):
    assert codes_of(validate.validate(make(target, zscale=3.2808)))["z_units"].level == "warn"


def test_a_swapped_file_gets_no_overlap_and_a_swap_suggestion(target):
    v = make(target, shift=(5_000.0, 0.0), samples=samples_over(DESIGN_BOUNDS, swap=True))
    r = validate.validate(v)
    assert codes_of(r)["no_overlap"].level == "warn"
    (s,) = [s for s in r.suggestions if s["code"] == "swap_xy"]
    assert s["overlap_fraction"] >= 0.9 and s["options_patch"] == {"swap_xy": True}
    assert s["message"].startswith("With easting/northing swapped the design covers")


def test_metres_read_as_feet_get_a_unit_suggestion(target):
    v = make(
        target,
        shift=(5_000.0, 0.0),
        options={"horizontal_unit": "international_foot"},
        samples=samples_over(DESIGN_BOUNDS),
    )
    r = validate.validate(v)
    (s,) = [s for s in r.suggestions if s["code"] == "horizontal_unit"]
    assert s["options_patch"] == {"horizontal_unit": "metre"} and s["overlap_fraction"] >= 0.9
    assert codes_of(r)["units_mismatch_crs"].level == "info"


def test_a_foot_unit_states_how_far_the_other_foot_moves_it(target):
    v = make(
        target,
        options={
            "source_crs": "EPSG:2229",
            "horizontal_unit": "us_survey_foot",
            "vertical_unit": "us_survey_foot",
        },
        file_bounds=(6_000_000.0, 2_000_000.0, 6_001_000.0, 2_001_000.0),
    )
    w = codes_of(validate.validate(v))["foot_ambiguity"]
    assert w.level == "warn" and "3.66 m" in w.message


def test_insunits_2_is_a_foot_ambiguity_too(target):
    assert "foot_ambiguity" in codes_of(validate.validate(make(target, fmt="dxf", internal={"insunits": 2})))


def test_unitless_dxf_warns_that_metres_were_assumed(target):
    assert (
        codes_of(validate.validate(make(target, fmt="dxf", internal={"insunits": 0})))["units_assumed"].level
        == "warn"
    )


def test_degrees_and_local_grids(target):
    geo = codes_of(validate.validate(make(target, file_bounds=(50.1, 25.1, 50.2, 25.2))))
    assert geo["looks_geographic"].level == "warn"
    local = codes_of(validate.validate(make(target, file_bounds=(1000.0, 2000.0, 1200.0, 2100.0))))
    assert (
        local["looks_local"].message
        == "coordinates look like a local site grid; site calibration isn't supported"
    )


def test_no_target_is_an_info_and_no_overlap_is_measured(target):
    r = validate.validate(make(target, with_target=False))
    assert codes_of(r)["no_target"].level == "info"
    assert r.overlap_fraction is None and r.z_check is None and r.suggestions == []


def test_crs_provenance(target):
    wkt = CRS.from_epsg(32639).to_wkt()
    from_file = codes_of(
        validate.validate(
            make(target, detected={"crs_wkt": wkt, "crs_source": "LandXML <CoordinateSystem epsgCode>"})
        )
    )
    assert from_file["crs_from_file"].message == "CRS from the file (LandXML <CoordinateSystem epsgCode>)"
    assumed = codes_of(validate.validate(make(target, detected={"crs_wkt": None})))
    assert assumed["crs_assumed"].level == "info"


def test_tin_quality_notes(target):
    tin = {
        "overlapping_triangles": 3,
        "long_edges_removed": 12,
        "max_edge_m": 10.0,
        "duplicate_points": 2,
        "degenerate_triangles": 1,
    }
    w = codes_of(validate.validate(make(target, tin=tin)))
    assert w["overlapping_triangles"].level == "warn"
    assert (
        w["long_edges_removed"].message
        == "12 long triangles were trimmed from the edges (maximum edge 10.0 m)"
    )
    assert (
        w["duplicate_points"].message
        == "2 positions had different heights (crossing contours?) and were averaged"
    )
    assert w["degenerate_triangles"].level == "info"


def test_an_empty_design_is_blocked(target):
    v = make(target)
    v.design[:] = np.nan
    assert codes_of(validate.validate(v))["empty_result"].level == "block"


def test_the_preview_image_is_one_panel_or_two(target, tmp_path):
    spec, reader = target
    ov = validate.read_target_overview(reader)
    t_layer = preview_image.Layer(ov.z, ov.x0, ov.y0, ov.cell_x, ov.cell_y)
    v = make(target)
    d_layer = preview_image.Layer(v.design, v.pspec.x0, v.pspec.y0, v.pspec.cell_size, v.pspec.cell_size)
    assert preview_image.render(d_layer, t_layer, tmp_path / "one.png") == 1
    assert max(Image.open(tmp_path / "one.png").size) <= 512
    far = preview_image.Layer(v.design, v.pspec.x0 + 50_000, v.pspec.y0, v.pspec.cell_size, v.pspec.cell_size)
    assert preview_image.render(far, t_layer, tmp_path / "two.png") == 2
    im = Image.open(tmp_path / "two.png")
    assert im.size[0] == 512 and im.size[0] > im.size[1]
    assert preview_image.render(d_layer, None, tmp_path / "solo.png") == 1
```

- [ ] **Step 2: Run the tests to verify they fail**

Run from `backend`: `$PY -m pytest tests/test_design_validate.py -v`
Expected: FAIL with `ModuleNotFoundError: No module named 'app.surfaces.design.validate'`.

- [ ] **Step 3: Write `validate.py`**

```python
"""Validation of a preview against the target surface (spec §10).

All target reads are overview reads: one SurfaceReader.read at <= 512 px for the whole target, and
grid.resample_onto on the preview grid (at most 513 x 513). The hypotheses re-place up to 20 000
sampled file vertices under each alternative (swap, other units) and look them up in the overview.
"""

from __future__ import annotations

from dataclasses import dataclass, field

import numpy as np
from pyproj import CRS
from rasterio.windows import Window

from app.surfaces import grid
from app.surfaces.design import codes
from app.surfaces.design import placement as placing
from app.surfaces.design.codes import DesignNote
from app.surfaces.design.units import (
    FEET,
    UNIT_LABEL,
    LinearUnit,
    UnsupportedCrsUnit,
    crs_axis_unit,
    horizontal_crs,
)

OVERVIEW_SIDE = 512
NO_OVERLAP, LOW_OVERLAP = 0.05, 0.5
SUGGEST_MIN, SUGGEST_GAIN = 0.5, 0.30
Z_OFFSET_M = 15.0
Z_RANGE_MIN_M = 2.0
FOOT_RATIOS = (3.2808, 0.3048)
LOCAL_LIMIT = 100_000.0


def _pct(x: float) -> str:
    return f"{round(100 * x)} %"


@dataclass
class TargetOverview:
    z: np.ndarray
    x0: float
    y0: float
    cell_x: float
    cell_y: float
    crs_wkt: str | None

    @property
    def bounds(self) -> tuple[float, float, float, float]:
        h, w = self.z.shape
        return self.x0, self.y0 - h * self.cell_y, self.x0 + w * self.cell_x, self.y0

    @property
    def valid_area_m2(self) -> float:
        return float(np.isfinite(self.z).sum()) * self.cell_x * self.cell_y

    def sample(self, x, y) -> np.ndarray:
        h, w = self.z.shape
        col = np.floor((np.asarray(x) - self.x0) / self.cell_x).astype(np.int64)
        row = np.floor((self.y0 - np.asarray(y)) / self.cell_y).astype(np.int64)
        ok = (col >= 0) & (col < w) & (row >= 0) & (row < h)
        out = np.full(np.shape(x), np.nan, np.float32)
        out[ok] = self.z[row[ok], col[ok]]
        return out


def read_target_overview(reader) -> TargetOverview:
    spec = reader.spec
    f = max(1.0, max(spec.width, spec.height) / OVERVIEW_SIDE)
    h, w = max(1, round(spec.height / f)), max(1, round(spec.width / f))
    z = reader.read(Window(0, 0, spec.width, spec.height), out_shape=(h, w))
    return TargetOverview(
        z, spec.x0, spec.y0, spec.width * spec.cell_size / w, spec.height * spec.cell_size / h, spec.crs_wkt
    )


@dataclass
class ValidationInput:
    fmt: str
    options: dict
    detected: dict
    internal: dict
    file_bounds: tuple[float, float, float, float]
    placement: placing.Placement
    design: np.ndarray
    pspec: grid.GridSpec
    target_spec: grid.GridSpec | None = None
    target_on_preview: np.ndarray | None = None
    overview: TargetOverview | None = None
    samples: np.ndarray | None = None
    tin: dict = field(default_factory=dict)


@dataclass
class ValidationResult:
    overlap_fraction: float | None
    target_covered_fraction: float | None
    design_area_m2: float
    z_check: dict | None
    warnings: list[DesignNote]
    suggestions: list[dict]


def validate(v: ValidationInput) -> ValidationResult:
    notes: list[DesignNote] = []
    dvalid = np.isfinite(v.design)
    n_design = int(dvalid.sum())
    cell_area = v.pspec.cell_size**2
    if n_design == 0:
        notes.append(
            codes.block(
                "empty_result",
                "the design covers no cell of the grid — check the CRS, the units and the selection",
            )
        )
    overlap = covered = z_check = None
    suggestions: list[dict] = []
    if v.target_on_preview is None:
        notes.append(
            codes.info(
                "no_target", "no cloud surface was chosen, so the design can't be checked against the site"
            )
        )
    else:
        t = v.target_on_preview
        both = dvalid & np.isfinite(t)
        n_both = int(both.sum())
        overlap = n_both / n_design if n_design else 0.0
        area = v.overview.valid_area_m2 if v.overview is not None else 0.0
        covered = min(1.0, n_both * cell_area / area) if area > 0 else 0.0
        if overlap < NO_OVERLAP:
            notes.append(
                codes.warn(
                    "no_overlap",
                    f"the design and the cloud surface don't overlap "
                    f"({_pct(overlap)} of the design lies on it)",
                )
            )
        elif overlap < LOW_OVERLAP:
            notes.append(
                codes.warn("low_overlap", f"only {_pct(overlap)} of the design lies on the cloud surface")
            )
        if n_both:
            z_check = _z_check(v.design, t, dvalid, both, notes)
        suggestions = _suggestions(v)
    notes += _coordinate_notes(v)
    notes += _tin_notes(v.tin)
    return ValidationResult(overlap, covered, n_design * cell_area, z_check, notes, suggestions)


def _z_check(design, t, dvalid, both, notes) -> dict:
    dz = design[both].astype(np.float64) - t[both]
    med, p5, p95 = (float(x) for x in np.percentile(dz, [50, 5, 95]))
    if abs(med) > Z_OFFSET_M:
        notes.append(
            codes.warn(
                "z_offset",
                f"the design sits {med:+.1f} m from the cloud surface (median) — "
                "ellipsoidal vs orthometric heights, "
                "or a units problem; the volume's alignment check can measure and apply a vertical shift",
            )
        )
    d_lo, d_hi = np.percentile(design[both], [5, 95])
    t_lo, t_hi = np.percentile(t[both], [5, 95])
    d_range, t_range = float(d_hi - d_lo), float(t_hi - t_lo)
    if d_range > Z_RANGE_MIN_M and t_range > Z_RANGE_MIN_M:
        ratio = d_range / t_range
        if any(abs(ratio - f) <= 0.15 * f for f in FOOT_RATIOS):
            notes.append(
                codes.warn(
                    "z_units",
                    f"the design's height range is {ratio:.2f} × the cloud surface's — the heights may "
                    "be in feet read as metres, or the other way round",
                )
            )
    dsg = design[dvalid]
    return {
        "median_dz_m": med,
        "p05_dz_m": p5,
        "p95_dz_m": p95,
        "n_samples": int(both.sum()),
        "design_z_min_m": float(dsg.min()),
        "design_z_max_m": float(dsg.max()),
    }


def _file_unit(v: ValidationInput) -> LinearUnit | None:
    if v.fmt != "geotiff":
        return LinearUnit(v.options["horizontal_unit"])
    try:
        return crs_axis_unit(v.placement.source_crs)
    except UnsupportedCrsUnit:
        return None


def _coordinate_notes(v: ValidationInput) -> list[DesignNote]:
    out: list[DesignNote] = []
    minx, miny, maxx, maxy = v.file_bounds
    maxabs = max(abs(minx), abs(miny), abs(maxx), abs(maxy))
    projected = horizontal_crs(v.placement.source_crs).is_projected
    if projected and v.fmt != "geotiff" and -180 <= minx and maxx <= 180 and -90 <= miny and maxy <= 90:
        out.append(
            codes.warn(
                "looks_geographic",
                "the coordinates look like degrees, but the source CRS is projected — check the CRS",
            )
        )
    if (
        v.target_spec is not None
        and v.target_spec.crs_wkt
        and CRS.from_wkt(v.target_spec.crs_wkt).is_projected
    ):
        if maxabs < LOCAL_LIMIT and max(abs(b) for b in v.target_spec.bounds) > LOCAL_LIMIT:
            out.append(
                codes.warn(
                    "looks_local", "coordinates look like a local site grid; site calibration isn't supported"
                )
            )
    if _file_unit(v) in FEET or v.internal.get("insunits") == 2:
        shift = maxabs * 2e-6 * 0.3048
        out.append(
            codes.warn(
                "foot_ambiguity",
                "US survey and international feet differ by 2 ppm: the other foot would move this design "
                f"by up to {shift:.2f} m. "
                "Check which foot the designer used.",
            )
        )
    if v.fmt != "geotiff" and projected and v.placement.xy_factor != 1.0:
        label = UNIT_LABEL[LinearUnit(v.options["horizontal_unit"])]
        out.append(
            codes.info(
                "units_mismatch_crs",
                f"the file's unit ({label}) differs from the CRS unit: coordinates were scaled by "
                f"{v.placement.xy_factor:.9g}",
            )
        )
    if v.fmt == "dxf" and v.internal.get("insunits") == 0 and v.options["horizontal_unit"] == "metre":
        out.append(
            codes.warn(
                "units_assumed",
                "the DXF declares no unit ($INSUNITS=0); metres were assumed — confirm the unit",
            )
        )
    detected = v.detected or {}
    chosen = v.placement.source_crs
    if detected.get("crs_wkt") and chosen.equals(CRS.from_wkt(detected["crs_wkt"])):
        out.append(
            codes.info("crs_from_file", f"CRS from the file ({detected.get('crs_source') or 'its CRS'})")
        )
    elif not detected.get("crs_wkt") and v.target_spec is not None and v.target_spec.crs_wkt:
        if chosen.equals(CRS.from_wkt(v.target_spec.crs_wkt)):
            out.append(
                codes.info(
                    "crs_assumed", "the file names no CRS; the cloud surface's CRS was assumed — confirm it"
                )
            )
    return out


def _tin_notes(tin: dict) -> list[DesignNote]:
    out: list[DesignNote] = []
    if tin.get("overlapping_triangles"):
        out.append(
            codes.warn(
                "overlapping_triangles",
                f"{tin['overlapping_triangles']:,} triangles overlap others (a folded or broken TIN); "
                "where they overlap the last one wins",
            )
        )
    if "long_edges_removed" in tin:
        limit = tin.get("max_edge_m") or 0.0
        message = (
            f"{tin['long_edges_removed']:,} long triangles were trimmed from the edges "
            f"(maximum edge {limit:.1f} m)"
            if limit > 0
            else "edge trimming is off (maximum edge 0)"
        )
        out.append(codes.info("long_edges_removed", message))
    if tin.get("duplicate_points"):
        out.append(
            codes.info(
                "duplicate_points",
                f"{tin['duplicate_points']:,} positions had different heights (crossing contours?) "
                "and were averaged",
            )
        )
    if tin.get("degenerate_triangles"):
        out.append(
            codes.info(
                "degenerate_triangles", f"{tin['degenerate_triangles']:,} zero-area triangles were skipped"
            )
        )
    return out


def _sample_overlap(v: ValidationInput, options: dict) -> float:
    try:
        p = placing.resolve(options, v.fmt, v.target_spec)
        xy = placing.place_vertices(v.samples, p)
    except placing.PlacementBlocked:
        return 0.0
    return float(np.isfinite(v.overview.sample(xy[:, 0], xy[:, 1])).mean())


def _suggestions(v: ValidationInput) -> list[dict]:
    if v.fmt == "geotiff" or v.samples is None or len(v.samples) == 0 or v.overview is None:
        return []
    current = _sample_overlap(v, v.options)
    variants = [("swap_xy", {"swap_xy": not bool(v.options.get("swap_xy"))})]
    variants += [
        ("horizontal_unit", {"horizontal_unit": u.value})
        for u in LinearUnit
        if u.value != v.options["horizontal_unit"]
    ]
    best: dict[str, dict] = {}
    for code, patch in variants:
        frac = _sample_overlap(v, {**v.options, **patch})
        if frac < SUGGEST_MIN or frac - current < SUGGEST_GAIN:
            continue
        if frac > best.get(code, {}).get("overlap_fraction", -1.0):
            message = (
                f"With easting/northing swapped the design covers {_pct(frac)} of the cloud surface."
                if code == "swap_xy"
                else f"Read in {UNIT_LABEL[LinearUnit(patch['horizontal_unit'])]} the design covers "
                f"{_pct(frac)} of the cloud surface."
            )
            best[code] = {"code": code, "message": message, "overlap_fraction": frac, "options_patch": patch}
    return sorted(best.values(), key=lambda s: -s["overlap_fraction"])
```

- [ ] **Step 4: Write `preview_image.py`**

```python
"""preview.png (spec §10): the target's hillshade in greys, the design's tinted in the Contour accent
at 60 % over it, both footprints outlined; two labelled panels when the boxes are far apart."""

from __future__ import annotations

import math
from dataclasses import dataclass
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw

from app.surfaces import grid

ACCENT = np.array([0xE5, 0xAF, 0x64], dtype=np.float64)
TARGET_LINE = np.array([0xA3, 0xAE, 0xA6], dtype=np.float64)
BACKGROUND = np.array([0x15, 0x1B, 0x19], dtype=np.float64)
INK = (0xED, 0xF0, 0xE9, 255)
MAX_SIDE = 512
PANEL_SIDE = 252  # two panels + an 8 px gutter = 512
LABEL_H = 20
FAR = 10.0


@dataclass(frozen=True)
class Layer:
    """A north-up raster in the output CRS: the preview grid, or the target's overview."""

    z: np.ndarray
    x0: float
    y0: float
    cell_x: float
    cell_y: float

    @property
    def bounds(self) -> tuple[float, float, float, float]:
        h, w = self.z.shape
        return self.x0, self.y0 - h * self.cell_y, self.x0 + w * self.cell_x, self.y0


def _outline(mask: np.ndarray) -> np.ndarray:
    inner = mask.copy()
    inner[1:, :] &= mask[:-1, :]
    inner[:-1, :] &= mask[1:, :]
    inner[:, 1:] &= mask[:, :-1]
    inner[:, :-1] &= mask[:, 1:]
    return mask & ~inner


def _sample(layer: Layer, shade: np.ndarray, x0: float, y0: float, cell: float, w: int, h: int):
    lh, lw = layer.z.shape
    cols = np.floor((x0 + (np.arange(w) + 0.5) * cell - layer.x0) / layer.cell_x).astype(np.int64)
    rows = np.floor((layer.y0 - (y0 - (np.arange(h) + 0.5) * cell)) / layer.cell_y).astype(np.int64)
    ok = ((rows >= 0) & (rows < lh))[:, None] & ((cols >= 0) & (cols < lw))[None, :]
    rr, cc = np.ix_(rows.clip(0, lh - 1), cols.clip(0, lw - 1))
    return np.where(ok, shade[rr, cc], 0), ok & np.isfinite(layer.z[rr, cc])


def _panel(layers: list[tuple[Layer, str]], bounds, side: int) -> np.ndarray:
    minx, miny, maxx, maxy = bounds
    cell = max(maxx - minx, maxy - miny, 1e-9) / side
    w = min(side, max(1, math.ceil((maxx - minx) / cell)))
    h = min(side, max(1, math.ceil((maxy - miny) / cell)))
    img = np.empty((h, w, 3), np.float64)
    img[:] = BACKGROUND
    edges = []
    for layer, role in layers:
        shade, valid = _sample(
            layer,
            grid.hillshade(layer.z.astype(np.float32), layer.cell_x, layer.cell_y),
            minx,
            maxy,
            cell,
            w,
            h,
        )
        s = shade.astype(np.float64)[..., None]
        if role == "target":
            img = np.where(valid[..., None], np.repeat(s, 3, axis=-1), img)
        else:
            img = np.where(valid[..., None], 0.6 * ACCENT * (s / 255.0) + 0.4 * img, img)
        edges.append((_outline(valid), TARGET_LINE if role == "target" else ACCENT))
    for edge, colour in edges:
        img[edge] = colour
    rgba = np.full((h, w, 4), 255, np.uint8)
    rgba[..., :3] = img.clip(0, 255).astype(np.uint8)
    return rgba


def _gap(a, b) -> float:
    dx = max(0.0, max(a[0], b[0]) - min(a[2], b[2]))
    dy = max(0.0, max(a[1], b[1]) - min(a[3], b[3]))
    return math.hypot(dx, dy)


def render(design: Layer, target: Layer | None, out: Path) -> int:
    """Write preview.png; returns the number of panels (1 or 2)."""
    out.parent.mkdir(parents=True, exist_ok=True)
    if target is None:
        Image.fromarray(_panel([(design, "design")], design.bounds, MAX_SIDE), "RGBA").save(out)
        return 1
    db, tb = design.bounds, target.bounds
    gap = _gap(db, tb)
    extent = max(db[2] - db[0], db[3] - db[1], tb[2] - tb[0], tb[3] - tb[1])
    if gap <= FAR * extent:
        union = (min(db[0], tb[0]), min(db[1], tb[1]), max(db[2], tb[2]), max(db[3], tb[3]))
        Image.fromarray(_panel([(target, "target"), (design, "design")], union, MAX_SIDE), "RGBA").save(out)
        return 1
    left = _panel([(design, "design")], db, PANEL_SIDE)
    right = _panel([(target, "target")], tb, PANEL_SIDE)
    h = max(left.shape[0], right.shape[0]) + LABEL_H
    canvas = Image.new("RGBA", (MAX_SIDE, h), tuple(int(c) for c in BACKGROUND) + (255,))
    canvas.paste(Image.fromarray(left, "RGBA"), (0, 0))
    canvas.paste(Image.fromarray(right, "RGBA"), (PANEL_SIDE + 8, 0))
    ImageDraw.Draw(canvas).text(
        (4, h - LABEL_H + 4), f"design | cloud surface — {gap / 1000:.1f} km apart", fill=INK
    )
    canvas.save(out)
    return 2
```

- [ ] **Step 5: Run the tests to verify they pass**

Run from `backend`: `$PY -m pytest tests/test_design_validate.py -v`
Expected: PASS.

- [ ] **Step 6: Commit**

```
git add backend/app/surfaces/design/validate.py backend/app/surfaces/design/preview_image.py backend/tests/test_design_validate.py
git commit -m "feat(design): overlap, hypothesis, height and coordinate checks with the preview image" -m "Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---
### Task 13: The preview phase and the three preview endpoints

**Files:**
- Create: `backend/app/surfaces/design/pipeline.py`, `backend/app/surfaces/design/phase_preview.py`, `backend/app/surfaces/design/targets.py`
- Modify: `backend/app/surfaces/design/router.py` (three operations; `STUBS` keeps only `createDesignSurface`)
- Modify: `backend/tests/test_contract.py` (`EXPECTED_STUBS`: remove three names)
- Test: `backend/tests/test_design_preview.py`

**Interfaces:**
- Consumes: Task 1 (`store`, `admission`, `codes`); Task 2 (`rasterise.rasterise_to_array`); Task 4 (`schemas`, the `design_import` dispatcher, `phase_inspect`); Task 5 (`triangulate`); Tasks 7, 8, 9 (readers, their `internal`); Task 10 (`placement`, `tests/design_targets`); Task 11 (`dem_build.check_unchanged`, `footprint`, `read_preview`); Task 12 (`validate`, `preview_image`); S2 V1 (`grid.open_surface`, `grid.resample_onto`, `GridSpec.to_json/from_json`); `app.surfaces.paths.surface_path`.
- Produces:
  - `pipeline.Blocked(notes)`, `pipeline.Selection(fmt, geometry, candidates)`, `pipeline.select(inspection, candidate_ids) -> Selection`, `pipeline.load_geometry(idir, sel, p, *, check_cancelled) -> (V, T | None, runs | None)`, `pipeline.Tin(vertices, triangles, counts, method)`, `pipeline.triangulate_points(V, runs, *, grid_cell, out_cell, max_edge_m, check_cancelled) -> Tin`, `pipeline.file_samples(idir, sel) -> np.ndarray | None`, `pipeline.file_bounds(sel) -> tuple`.
  - `targets.target_ready(handle, surface_id) -> bool` (a ready `cloud_dsm` whose `surface.tif` exists).
  - `phase_preview.run(ctx) -> {"preview_id", "overlap_fraction"}`; `phase_preview.compute(handle, idir, pdir, options, *, progress, check_cancelled) -> (body, internal)`.
  - A ready preview's `internal.json`: `{"output_spec": GridSpec.to_json(), "bounds": [...], "tin": {...}, "max_edge_m": float | None}` — Task 14 builds from exactly this.
  - `request.json` keeps `latest_preview_id`, `latest_preview_job_id`, `preview_job_ids`.

- [ ] **Step 1: Write the failing tests**

`backend/tests/test_design_preview.py`:

```python
"""createDesignPreview, getDesignPreview, getDesignPreviewImage and the preview phase (spec §4, §10, §12)."""

import time

import pytest
from design_dxf import add_contours, add_faces, new_doc, save
from design_landxml import grid_tin, write_landxml
from design_targets import add_target, target_spec, write_target
from designs import E0, N0, cone_contour_runs, plane_z, two_triangle_plane

from app.surfaces import grid
from app.surfaces.design import phase_preview, store
from app.surfaces.paths import surface_path

BASE = "/api/v1/projects"


@pytest.fixture
def project_kind() -> str:
    """Design surfaces are detection work: F0 guards the router with require_kind(("detect",), ANY_KIND)."""
    return "detect"


def url(pid, iid, rest=""):
    return f"{BASE}/{pid}/design-inspections/{iid}{rest}"


def inspect(client, pid, wait_job, path) -> str:
    body = client.post(f"{BASE}/{pid}/design-inspections", json={"path": str(path)}).json()
    assert wait_job(pid, body["job"]["id"])["state"] == "succeeded"
    return body["inspection"]["id"]


def options(**kw):
    return {
        "candidate_ids": ["c0"],
        "source_crs": "EPSG:32639",
        "horizontal_unit": "metre",
        "vertical_unit": "metre",
        **kw,
    }


def preview(client, pid, wait_job, iid, **kw) -> dict:
    r = client.post(url(pid, iid, "/previews"), json=options(**kw))
    assert r.status_code == 202, r.text
    body = r.json()
    assert body["preview"]["state"] == "running" and body["job"]["type"] == "design_import"
    wait_job(pid, body["job"]["id"])
    return client.get(url(pid, iid, f"/previews/{body['preview']['id']}")).json()


def codes_of(p):
    return {w["code"]: w for w in p["warnings"]}


@pytest.fixture
def target(handle):
    return add_target(handle, target_spec(), plane_z)


def site_tin(dz=0.3, **kw):
    return grid_tin(161, 61, 1.0, E0 + 20, N0 + 20, lambda e, n: plane_z(e, n) + dz)


def test_a_landxml_on_its_site(client, project_id, wait_job, tmp_path, target, handle):
    pts, faces = site_tin()
    iid = inspect(
        client,
        project_id,
        wait_job,
        write_landxml(tmp_path / "s.xml", [{"name": "EG", "points": pts, "faces": faces}]),
    )
    assert client.get(url(project_id, iid)).json()["default_target_surface_id"] == target
    p = preview(client, project_id, wait_job, iid, target_surface_id=target)
    assert p["state"] == "ready" and p["error"] is None
    assert p["overlap_fraction"] >= 0.99 and p["z_check"]["median_dz_m"] == pytest.approx(0.3, abs=0.01)
    assert (p["output"]["epsg"], p["output"]["cell_size_m"]) == (32639, 0.5) and p["triangle_count"] == len(
        faces
    )
    assert "crs_from_file" in codes_of(p) and not [w for w in p["warnings"] if w["level"] != "info"]
    img = client.get(url(project_id, iid, f"/previews/{p['id']}/image"))
    assert img.status_code == 200 and img.headers["content-type"] == "image/png"
    internal = store.read_json(
        store.preview_dir(store.inspection_dir(handle, iid), p["id"]) / "internal.json"
    )
    with grid.open_surface(surface_path(handle, target)) as r:
        assert grid.same_lattice(grid.GridSpec.from_json(internal["output_spec"]), r.spec)


def test_an_east_north_file_gets_no_overlap_and_the_swap_fixes_it(
    client, project_id, wait_job, tmp_path, target
):
    pts, faces = site_tin()
    src = write_landxml(tmp_path / "enz.xml", [{"name": "EG", "points": pts, "faces": faces}], order="ENZ")
    iid = inspect(client, project_id, wait_job, src)
    p = preview(client, project_id, wait_job, iid, target_surface_id=target)
    assert codes_of(p)["no_overlap"]["level"] == "warn"
    (s,) = [s for s in p["suggestions"] if s["code"] == "swap_xy"]
    assert s["overlap_fraction"] >= 0.9 and s["options_patch"] == {"swap_xy": True}
    fixed = preview(client, project_id, wait_job, iid, target_surface_id=target, **s["options_patch"])
    assert fixed["overlap_fraction"] >= 0.99 and "no_overlap" not in codes_of(fixed)


def test_metres_read_as_feet_get_a_unit_suggestion(client, project_id, wait_job, tmp_path, target):
    pts, faces = site_tin()
    iid = inspect(
        client,
        project_id,
        wait_job,
        write_landxml(tmp_path / "s.xml", [{"name": "EG", "points": pts, "faces": faces}]),
    )
    p = preview(
        client, project_id, wait_job, iid, target_surface_id=target, horizontal_unit="international_foot"
    )
    assert [s["options_patch"] for s in p["suggestions"] if s["code"] == "horizontal_unit"] == [
        {"horizontal_unit": "metre"}
    ]
    assert "foot_ambiguity" in codes_of(p)


def test_dxf_contours_are_triangulated_and_trimmed(client, project_id, wait_job, tmp_path, target, handle):
    doc = new_doc()
    add_contours(doc.modelspace(), *cone_contour_runs(128), layer="CONTOURS")
    iid = inspect(client, project_id, wait_job, save(doc, tmp_path / "c.dxf"))
    p = preview(client, project_id, wait_job, iid, target_surface_id=target)
    assert p["state"] == "ready" and p["triangle_count"] > 1000
    assert codes_of(p)["long_edges_removed"]["level"] == "info"
    internal = store.read_json(
        store.preview_dir(store.inspection_dir(handle, iid), p["id"]) / "internal.json"
    )
    assert internal["max_edge_m"] >= 10 * 0.5


def test_a_mixed_selection_is_blocked(client, project_id, wait_job, tmp_path, target):
    doc = new_doc()
    add_faces(doc.modelspace(), *two_triangle_plane(), "TIN")
    add_contours(doc.modelspace(), *cone_contour_runs(32), layer="CONTOURS")
    iid = inspect(client, project_id, wait_job, save(doc, tmp_path / "m.dxf"))
    p = preview(client, project_id, wait_job, iid, target_surface_id=target, candidate_ids=["c0", "c1"])
    assert p["state"] == "ready" and codes_of(p)["mixed_geometry"]["level"] == "block" and p["output"] is None
    assert client.get(url(project_id, iid, f"/previews/{p['id']}/image")).status_code == 204


def test_a_dem_preview(client, project_id, wait_job, tmp_path, target):
    src = write_target(tmp_path / "dem.tif", target_spec(), lambda x, y: plane_z(x, y) + 0.5)
    iid = inspect(client, project_id, wait_job, src)
    p = preview(client, project_id, wait_job, iid, target_surface_id=target)
    assert p["overlap_fraction"] >= 0.99 and p["triangle_count"] is None
    assert p["z_check"]["median_dz_m"] == pytest.approx(0.5, abs=0.01)


def test_no_target_uses_the_cell_size(client, project_id, wait_job, tmp_path):
    pts, faces = site_tin()
    iid = inspect(
        client,
        project_id,
        wait_job,
        write_landxml(tmp_path / "s.xml", [{"name": "EG", "points": pts, "faces": faces}]),
    )
    p = preview(client, project_id, wait_job, iid, cell_size_m=0.25)
    assert p["output"]["cell_size_m"] == 0.25 and "no_target" in codes_of(p) and p["overlap_fraction"] is None


def test_refusals(client, project_id, wait_job, tmp_path, target, handle):
    two = [
        {"name": "A", "points": site_tin()[0], "faces": site_tin()[1]},
        {"name": "B", "points": site_tin()[0], "faces": site_tin()[1]},
    ]
    iid = inspect(client, project_id, wait_job, write_landxml(tmp_path / "s.xml", two))
    post = lambda **kw: client.post(url(project_id, iid, "/previews"), json=options(**kw))  # noqa: E731
    assert post(candidate_ids=["c9"], target_surface_id=target).status_code == 422
    assert post(candidate_ids=["c0", "c1"], target_surface_id=target).status_code == 422
    assert post(source_crs="EPSG:999999", target_surface_id=target).status_code == 422
    assert post(target_surface_id="not-a-surface").status_code == 422
    assert post().status_code == 422  # neither a target nor a cell size
    store.patch_json(store.inspection_dir(handle, iid) / "inspection.json", state="inspecting")
    r = post(target_surface_id=target)
    assert r.status_code == 409 and r.json()["error"]["code"] == "conflict"
    assert (
        client.get(url(project_id, iid, "/previews/00000000-0000-4000-8000-000000000000")).status_code == 404
    )


def test_a_new_preview_cancels_the_running_one(client, project_id, wait_job, tmp_path, target, monkeypatch):
    pts, faces = site_tin()
    iid = inspect(
        client,
        project_id,
        wait_job,
        write_landxml(tmp_path / "s.xml", [{"name": "EG", "points": pts, "faces": faces}]),
    )
    calls, real = [], phase_preview.compute

    def slow_first(handle, idir, pdir, opts, *, progress, check_cancelled):
        calls.append(pdir.name)
        while len(calls) == 1:
            check_cancelled()
            time.sleep(0.01)
        return real(handle, idir, pdir, opts, progress=progress, check_cancelled=check_cancelled)

    monkeypatch.setattr(phase_preview, "compute", slow_first)
    first = client.post(url(project_id, iid, "/previews"), json=options(target_surface_id=target)).json()
    deadline = time.time() + 10
    while not calls and time.time() < deadline:
        time.sleep(0.01)
    second = client.post(
        url(project_id, iid, "/previews"), json=options(target_surface_id=target, swap_xy=True)
    ).json()
    assert wait_job(project_id, first["job"]["id"])["state"] == "cancelled"
    old = client.get(url(project_id, iid, f"/previews/{first['preview']['id']}")).json()
    assert old["state"] == "failed" and old["error"] == "preview cancelled"
    assert wait_job(project_id, second["job"]["id"])["state"] == "succeeded"
```

- [ ] **Step 2: Run the tests to verify they fail**

Run from `backend`: `$PY -m pytest tests/test_design_preview.py -v`
Expected: FAIL — every POST to `/previews` answers `501 not_implemented`.

- [ ] **Step 3: Write `pipeline.py`**

```python
"""The pipeline shared by the preview and the build (spec §4.1: they differ only in the grid)."""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path

import numpy as np

from app.surfaces.design import admission, codes, store, triangulate
from app.surfaces.design import placement as placing
from app.surfaces.design.codes import DesignNote

SAMPLE_POINTS = 20_000


class Blocked(Exception):
    """Block-level warnings found before rasterising; the preview reports them, the build refuses."""

    def __init__(self, notes: list[DesignNote]):
        super().__init__("; ".join(n.message for n in notes))
        self.notes = notes


@dataclass(frozen=True)
class Selection:
    fmt: str
    geometry: str  # faces | points | raster
    candidates: list[dict]


@dataclass
class Tin:
    vertices: np.ndarray
    triangles: np.ndarray
    counts: dict
    method: str  # tin | delaunay


def select(inspection: dict, candidate_ids: list[str]) -> Selection:
    by_id = {c["id"]: c for c in inspection["candidates"]}
    cands = [by_id[c] for c in candidate_ids]
    blocks = [DesignNote.from_json(n) for c in cands for n in c["notes"] if n["level"] == "block"]
    if blocks:
        raise Blocked(blocks)
    if inspection["format"] == "geotiff":
        return Selection("geotiff", "raster", cands)
    kinds = {c["geometry"] for c in cands}
    if kinds in ({"faces"}, {"points"}):
        return Selection(inspection["format"], kinds.pop(), cands)
    raise Blocked(
        [
            codes.block(
                "mixed_geometry",
                "the selection mixes 3D faces with lines or points; import them as two surfaces",
            )
        ]
    )


def load_geometry(idir: Path, sel: Selection, p: placing.Placement, *, check_cancelled):
    """Placed vertices of every selected candidate, with faces (offset per candidate) or run offsets."""
    arrays = [store.read_candidate(store.candidate_dir(idir, c["id"])) for c in sel.candidates]
    n_pts = sum(len(a.points) for a in arrays)
    n_faces = sum(len(a.faces) for a in arrays if a.faces is not None)
    admission.admit(
        admission.tin_bytes(n_pts, n_faces) + admission.RASTERISE_BYTES,
        f"The design's {n_pts:,} points and {n_faces:,} triangles",
        "Select fewer layers, or split the design into smaller files.",
    )
    verts, faces, runs, base = [], [], [np.zeros(1, np.int64)], 0
    for a in arrays:
        verts.append(placing.place_vertices(a.points, p, check_cancelled=check_cancelled))
        if sel.geometry == "faces":
            faces.append(np.asarray(a.faces, dtype=np.int64) + base)
        else:
            runs.append(np.asarray(a.runs[1:], dtype=np.int64) + base)
        base += len(a.points)
    del arrays  # release the memory maps
    v = np.concatenate(verts) if verts else np.zeros((0, 3))
    if sel.geometry == "faces":
        return v, np.concatenate(faces).astype(np.int32), None
    return v, None, np.concatenate(runs)


def triangulate_points(v, runs, *, grid_cell: float, out_cell: float, max_edge_m, check_cancelled) -> Tin:
    try:
        t = triangulate.triangulate(
            v,
            runs,
            spacing=2 * grid_cell,
            max_edge_m=max_edge_m,
            auto_floor=10 * out_cell,
            check_cancelled=check_cancelled,
        )
    except triangulate.NothingToTriangulate as e:
        raise Blocked([codes.block("nothing_to_triangulate", str(e))]) from None
    counts = {
        "long_edges_removed": t.long_edges_removed,
        "max_edge_m": t.max_edge_m,
        "duplicate_points": t.duplicate_positions,
    }
    return Tin(t.vertices, t.triangles, counts, "delaunay")


def file_samples(idir: Path, sel: Selection) -> np.ndarray | None:
    """Up to ~20 000 cached vertices in file units, for the placement hypotheses (spec §10)."""
    if sel.geometry == "raster":
        return None
    parts = []
    for c in sel.candidates:
        pts = store.read_candidate(store.candidate_dir(idir, c["id"])).points
        step = max(1, len(pts) * len(sel.candidates) // SAMPLE_POINTS)
        parts.append(np.array(pts[::step], dtype=np.float64))
        del pts
    return np.concatenate(parts) if parts else None


def file_bounds(sel: Selection) -> tuple[float, float, float, float]:
    b = np.array([c["bounds_file"] for c in sel.candidates], dtype=np.float64)
    return float(b[:, 0].min()), float(b[:, 1].min()), float(b[:, 2].max()), float(b[:, 3].max())
```

- [ ] **Step 4: Write `phase_preview.py`**

```python
"""The `preview` phase (spec §4.1, §10): the whole pipeline on the coarse preview grid, validation
against the target, preview.png and preview.json. The automatic maximum edge is resolved here once
and stored, so the build's finer densification cannot change the trimming the operator saw."""

from __future__ import annotations

from pathlib import Path

from rasterio.windows import Window

from app.jobs.cancellation import JobCancelled, JobFailure
from app.surfaces import grid
from app.surfaces.design import dem_build, pipeline, preview_image, rasterise, store, validate
from app.surfaces.design import placement as placing
from app.surfaces.design.codes import DesignNote

MESSAGE = "Previewing design"


def open_target(handle, surface_id: str | None):
    if not surface_id:
        return None
    from app.surfaces.paths import surface_path

    return grid.open_surface(surface_path(handle, surface_id))


def _unique(notes: list[DesignNote]) -> list[DesignNote]:
    seen, out = set(), []
    for n in notes:
        if (n.code, n.message) not in seen:
            seen.add((n.code, n.message))
            out.append(n)
    return out


def compute(handle, idir: Path, pdir: Path, options: dict, *, progress, check_cancelled) -> tuple[dict, dict]:
    inspection = store.read_json(idir / "inspection.json")
    iinternal = store.read_json(idir / "internal.json")
    fmt = inspection["format"]
    body = {
        "output": None,
        "triangle_count": None,
        "overlap_fraction": None,
        "target_covered_fraction": None,
        "design_area_m2": None,
        "z_check": None,
        "suggestions": [],
    }
    internal: dict = {}
    warnings: list[DesignNote] = []
    reader = open_target(handle, options.get("target_surface_id"))
    try:
        target_spec = reader.spec if reader is not None else None
        sel = pipeline.select(inspection, options["candidate_ids"])
        warnings += [
            DesignNote.from_json(n) for c in sel.candidates for n in c["notes"] if n["level"] == "warn"
        ]
        p = placing.resolve(options, fmt, target_spec)
        progress(0.1, MESSAGE)
        if fmt == "geotiff":
            src = Path(inspection["path"])
            dem_build.check_unchanged(src, iinternal)
            bounds = dem_build.footprint(src, p)
        else:
            v, t, runs = pipeline.load_geometry(idir, sel, p, check_cancelled=check_cancelled)
            bounds = placing.xy_bounds(v)
        out, grid_notes = placing.output_grid(bounds, p)
        warnings += grid_notes
        pspec, _k = placing.preview_grid(bounds, out)
        progress(0.3, MESSAGE)
        tin_counts: dict = {}
        if fmt == "geotiff":
            design = dem_build.read_preview(src, pspec, p, iinternal)
        else:
            if sel.geometry == "points":
                tin = pipeline.triangulate_points(
                    v,
                    runs,
                    grid_cell=pspec.cell_size,
                    out_cell=out.cell_size,
                    max_edge_m=options.get("max_edge_m"),
                    check_cancelled=check_cancelled,
                )
            else:
                tin = pipeline.Tin(v, t, {}, "tin")
            design, stats = rasterise.rasterise_to_array(
                tin.vertices, tin.triangles, pspec, check_cancelled=check_cancelled
            )
            tin_counts = {
                **tin.counts,
                "degenerate_triangles": stats.degenerate_triangles,
                "overlapping_triangles": stats.overlapping_triangles,
            }
            body["triangle_count"] = int(len(tin.triangles))
            internal["max_edge_m"] = tin.counts.get("max_edge_m")
        progress(0.7, MESSAGE)
        overview = validate.read_target_overview(reader) if reader is not None else None
        full = Window(0, 0, pspec.width, pspec.height)
        result = validate.validate(
            validate.ValidationInput(
                fmt=fmt,
                options=options,
                detected=inspection.get("detected") or {},
                internal=iinternal,
                file_bounds=pipeline.file_bounds(sel),
                placement=p,
                design=design,
                pspec=pspec,
                target_spec=target_spec,
                target_on_preview=grid.resample_onto(reader, pspec, full) if reader is not None else None,
                overview=overview,
                samples=pipeline.file_samples(idir, sel),
                tin=tin_counts,
            )
        )
        warnings += result.warnings
        target_layer = (
            preview_image.Layer(overview.z, overview.x0, overview.y0, overview.cell_x, overview.cell_y)
            if overview
            else None
        )
        preview_image.render(
            preview_image.Layer(design, pspec.x0, pspec.y0, pspec.cell_size, pspec.cell_size),
            target_layer,
            pdir / "preview.png",
        )
        body.update(
            output={
                "crs_wkt": out.crs_wkt or "",
                "epsg": out.epsg,
                "cell_size_m": out.cell_size,
                "width": out.width,
                "height": out.height,
                "bounds_native": list(out.bounds),
                "preview_cell_size_m": pspec.cell_size,
            },
            overlap_fraction=result.overlap_fraction,
            target_covered_fraction=result.target_covered_fraction,
            design_area_m2=result.design_area_m2,
            z_check=result.z_check,
            suggestions=result.suggestions,
        )
        internal.update(output_spec=out.to_json(), bounds=list(bounds), tin=tin_counts)
    except pipeline.Blocked as b:
        warnings += b.notes
    except placing.PlacementBlocked as b:
        warnings.append(b.note)
    finally:
        if reader is not None:
            reader.close()
    body["warnings"] = [w.to_json() for w in _unique(warnings)]
    return body, internal


def run(ctx) -> dict:
    iid, pid, options = ctx.params["inspection_id"], ctx.params["preview_id"], ctx.params["options"]
    idir = store.inspection_dir(ctx.project, iid)
    pdir = store.preview_dir(idir, pid)
    try:
        body, internal = compute(
            ctx.project, idir, pdir, options, progress=ctx.progress, check_cancelled=ctx.check_cancelled
        )
    except JobCancelled:
        store.patch_json(pdir / "preview.json", state="failed", error="preview cancelled")
        raise
    except JobFailure as e:
        store.patch_json(pdir / "preview.json", state="failed", error=str(e))
        raise
    except Exception as e:
        store.patch_json(
            pdir / "preview.json", state="failed", error=f"preview failed: {type(e).__name__}: {e}"
        )
        raise
    store.write_json(pdir / "internal.json", internal)
    store.patch_json(pdir / "preview.json", state="ready", error=None, **body)
    ctx.progress(1.0, "Preview ready")
    return {"preview_id": pid, "overlap_fraction": body["overlap_fraction"]}
```

- [ ] **Step 4b: Write `targets.py`** (shared by the router here and the commit gate in Task 14; light imports only)

```python
"""Is a surface a usable target: a ready cloud DSM whose surface.tif exists (spec §5, §12)."""

from __future__ import annotations

from sqlalchemy import select

from app.db.models import Surface
from app.surfaces.paths import surface_path


def target_ready(handle, surface_id: str) -> bool:
    with handle.session() as s:
        row = s.execute(select(Surface).where(Surface.id == surface_id)).scalar_one_or_none()
        ok = row is not None and row.kind == "cloud_dsm" and row.status == "ready"
    return ok and surface_path(handle, surface_id).is_file()
```

- [ ] **Step 5: Add the three operations to the router**

In `backend/app/surfaces/design/router.py`:

1. Add these imports, replacing the existing single-line `from app.surfaces.design.schemas import …`:

```python
from datetime import UTC, datetime

from pyproj import CRS
from pyproj.exceptions import CRSError

from app.surfaces.design.schemas import (
    DesignImportOptions,
    DesignInspectionCreate,
    DesignInspectionOut,
    DesignInspectionWithJob,
    DesignPreviewOut,
    DesignPreviewWithJob,
)
from app.surfaces.design.targets import target_ready
```

2. Add, above `STUBS`:

```python
def _check_options(handle: ProjectHandle, inspection: dict, body: DesignImportOptions) -> dict:
    """The 422s of createDesignPreview (spec §12); pyproj only, so importing the router stays light."""
    ids = {c["id"] for c in inspection["candidates"]}
    unknown = [c for c in body.candidate_ids if c not in ids]
    if unknown:
        raise AppError("validation_error", f"there is no part {unknown[0]} in this file", 422)
    if len(set(body.candidate_ids)) != len(body.candidate_ids):
        raise AppError("validation_error", "each part can be chosen once", 422)
    if inspection["format"] in ("landxml", "geotiff") and len(body.candidate_ids) != 1:
        raise AppError("validation_error", "choose exactly one surface of this file", 422)
    try:
        CRS.from_user_input(body.source_crs.strip())
    except CRSError as e:
        raise AppError("validation_error", f"the source CRS can't be read: {e}", 422) from None
    if body.target_surface_id:
        if not target_ready(handle, body.target_surface_id):
            raise AppError(
                "validation_error", f"surface {body.target_surface_id} is not a ready cloud surface", 422
            )
    elif body.cell_size_m is None:
        raise AppError("validation_error", "choose a target cloud surface or a cell size", 422)
    return body.model_dump()


@router.post(
    "/design-inspections/{inspectionId}/previews", response_model=DesignPreviewWithJob, status_code=202
)
def create_design_preview(
    inspectionId: str,  # noqa: N803
    body: DesignImportOptions,
    request: Request,
    handle: ProjectHandle = Depends(get_project),
) -> DesignPreviewWithJob:
    idir = store.require_inspection(handle, inspectionId)
    inspection = store.read_json(idir / "inspection.json")
    if inspection["state"] != "ready":
        raise AppError("conflict", "the file has not been read yet, or reading it failed: read it again", 409)
    options = _check_options(handle, inspection, body)
    runner = request.app.state.jobs
    req = store.read_json(idir / "request.json")
    if req.get("build_job_id") and runner.is_live(req["build_job_id"]):
        raise AppError("conflict", "a design surface is being imported from this inspection", 409)
    if req.get("latest_preview_job_id") and runner.is_live(req["latest_preview_job_id"]):
        runner.cancel(handle, req["latest_preview_job_id"])  # only the newest preview is shown (spec §4.2)
    pid = store.new_id()
    pdir = store.preview_dir(idir, pid)
    pdir.mkdir(parents=True)
    store.write_json(
        pdir / "preview.json",
        {
            "id": pid,
            "inspection_id": inspectionId,
            "state": "running",
            "error": None,
            "job_id": "",
            "options": options,
            "output": None,
            "triangle_count": None,
            "overlap_fraction": None,
            "target_covered_fraction": None,
            "design_area_m2": None,
            "z_check": None,
            "warnings": [],
            "suggestions": [],
            "created_at": datetime.now(UTC).isoformat(),
        },
    )
    job = runner.submit(
        handle,
        "design_import",
        {"phase": "preview", "inspection_id": inspectionId, "preview_id": pid, "options": options},
    )
    store.patch_json(
        idir / "request.json",
        latest_preview_id=pid,
        latest_preview_job_id=job.id,
        preview_job_ids=[*req.get("preview_job_ids", []), job.id],
    )
    preview = store.patch_json(pdir / "preview.json", job_id=job.id)
    return DesignPreviewWithJob(preview=DesignPreviewOut(**preview), job=JobOut.from_row(job, handle.id))


@router.get("/design-inspections/{inspectionId}/previews/{previewId}", response_model=DesignPreviewOut)
def get_design_preview(
    inspectionId: str,  # noqa: N803
    previewId: str,  # noqa: N803
    handle: ProjectHandle = Depends(get_project),
) -> DesignPreviewOut:
    pdir = store.require_preview(store.require_inspection(handle, inspectionId), previewId)
    return DesignPreviewOut(**store.read_json(pdir / "preview.json"))


@router.get("/design-inspections/{inspectionId}/previews/{previewId}/image", response_class=Response)
def get_design_preview_image(
    inspectionId: str,  # noqa: N803
    previewId: str,  # noqa: N803
    handle: ProjectHandle = Depends(get_project),
) -> Response:
    pdir = store.require_preview(store.require_inspection(handle, inspectionId), previewId)
    png = pdir / "preview.png"
    if store.read_json(pdir / "preview.json")["state"] != "ready" or not png.is_file():
        return Response(status_code=204)
    return Response(
        png.read_bytes(), media_type="image/png", headers={"Cache-Control": "private, max-age=3600"}
    )
```

3. Replace `STUBS` with:

```python
STUBS = [("POST", "/design-surfaces", "createDesignSurface")]
```

- [ ] **Step 6: Remove the three landed operations from `EXPECTED_STUBS`**

In `backend/tests/test_contract.py`, delete exactly:

```python
    "createDesignPreview",
    "getDesignPreview",
    "getDesignPreviewImage",
```

- [ ] **Step 7: Run the tests to verify they pass**

Run from `backend`: `$PY -m pytest tests/test_design_preview.py tests/test_contract.py tests/test_design_api_inspect.py tests/test_pointcloud_stubs.py -v`
Expected: PASS.

- [ ] **Step 8: Commit**

```
git add backend/app/surfaces/design/pipeline.py backend/app/surfaces/design/phase_preview.py backend/app/surfaces/design/targets.py backend/app/surfaces/design/router.py backend/tests/test_contract.py backend/tests/test_design_preview.py
git commit -m "feat(design): the preview phase with validation, suggestions and the preview image" -m "Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 14: The build phase and `createDesignSurface`

**Files:**
- Create: `backend/app/surfaces/design/phase_build.py`, `backend/app/surfaces/design/surface_json.py`
- Modify: `backend/app/surfaces/design/router.py` (the last operation; `STUBS` and `add_stubs` go away)
- Modify: `backend/app/surfaces/design/selftest.py` (the 64² `SurfaceWriter` write)
- Modify: `backend/tests/test_contract.py` (`EXPECTED_STUBS`: remove `createDesignSurface`)
- Test: `backend/tests/test_design_build.py`; modify `backend/tests/test_design_selftest.py`

**Interfaces:**
- Consumes: Task 13 (`pipeline`, a ready preview's `internal.json`, `request.json` keys); Task 11 (`dem_build`); Task 10 (`placement`); Task 2 (`TinRasteriser`); S2 V1 (`grid.SurfaceWriter`, `grid.read_windows`, `grid.MAX_READ`, `grid.compute_stats`, `grid.GridSpec.from_dataset/from_json`, `grid.same_lattice`, `grid.open_surface`); `app.surfaces.paths.surface_dir`, `surface_path`; F0 `Surface`, `VolumeMeasurement`.
- Produces:
  - `phase_build.check_commit(handle, idir, preview_id, accept, runner) -> (inspection, preview)` (409s), `phase_build.design_source(inspection, preview, pinternal, accept) -> dict` (the §3 `DesignSource`), `phase_build.create(handle, runner, body) -> (surface_id, job)`, `phase_build.run(ctx) -> {"surface_id", "width", "height", "coverage_fraction"}`.
  - `surface_json.surface_json(handle, surface_id) -> dict` (the contract's `Surface`).
  - Build result on disk: `<project>/surfaces/<id>/surface.tif` and `source.json`; the inspection folder is deleted on success and kept on failure.
  - Event `surfaces.changed {"surface_ids": [id]}` on success and on failure.

- [ ] **Step 1: Write the failing tests**

`backend/tests/test_design_build.py`:

```python
"""createDesignSurface and the build phase (spec §2 Commit gate, §3, §4, §6, §15.3 API and jobs, §16)."""

import numpy as np
import pytest
import rasterio
from design_dxf import add_contours, add_faces, new_doc, save
from design_landxml import grid_tin, write_landxml
from design_targets import add_target, target_spec, write_dem, write_target
from designs import CONE_CENTRE, E0, N0, cone_contour_runs, cone_z, plane_z, two_triangle_plane
from rasterio.windows import Window

from app.db.models import Surface
from app.surfaces import grid
from app.surfaces.design import phase_build, store
from app.surfaces.paths import surface_dir, surface_path

BASE = "/api/v1/projects"


@pytest.fixture
def project_kind() -> str:
    """Design surfaces are detection work: F0 guards the router with require_kind(("detect",), ANY_KIND)."""
    return "detect"


def url(pid, rest):
    return f"{BASE}/{pid}{rest}"


def inspect(client, pid, wait_job, path) -> str:
    body = client.post(url(pid, "/design-inspections"), json={"path": str(path)}).json()
    assert wait_job(pid, body["job"]["id"])["state"] == "succeeded"
    return body["inspection"]["id"]


def preview(client, pid, wait_job, iid, **kw) -> dict:
    opts = {
        "candidate_ids": ["c0"],
        "source_crs": "EPSG:32639",
        "horizontal_unit": "metre",
        "vertical_unit": "metre",
        **kw,
    }
    body = client.post(url(pid, f"/design-inspections/{iid}/previews"), json=opts).json()
    wait_job(pid, body["job"]["id"])
    return client.get(url(pid, f"/design-inspections/{iid}/previews/{body['preview']['id']}")).json()


def commit(client, pid, iid, prev, **kw):
    return client.post(url(pid, "/design-surfaces"), json={"inspection_id": iid, "preview_id": prev, **kw})


def build(client, pid, wait_job, iid, prev, **kw) -> tuple[dict, dict]:
    r = commit(client, pid, iid, prev, **kw)
    assert r.status_code == 202, r.text
    return r.json(), wait_job(pid, r.json()["job"]["id"])


def row(handle, sid) -> Surface:
    with handle.session() as s:
        r = s.get(Surface, sid)
        s.expunge(r)
        return r


def cells(handle, sid):
    with rasterio.open(surface_path(handle, sid)) as ds:
        spec = grid.GridSpec.from_dataset(ds)
        z = ds.read(1)
    return spec, z, spec.cell_centres(Window(0, 0, spec.width, spec.height))


@pytest.fixture
def target(handle):
    return add_target(handle, target_spec(), plane_z)


@pytest.fixture
def events(app, client):
    seen = []
    real = app.state.events.publish
    app.state.events.publish = lambda e: (seen.append(e), real(e))
    return seen


def test_a_landxml_design_lands_on_the_target_lattice(
    client, app, project_id, wait_job, tmp_path, handle, target, events
):
    pts, faces = grid_tin(161, 61, 1.0, E0 + 20, N0 + 20, lambda e, n: plane_z(e, n) + 0.3)
    iid = inspect(
        client,
        project_id,
        wait_job,
        write_landxml(tmp_path / "site-tin.xml", [{"name": "EG", "points": pts, "faces": faces}]),
    )
    p = preview(client, project_id, wait_job, iid, target_surface_id=target)
    body, job = build(client, project_id, wait_job, iid, p["id"])
    s = body["surface"]
    assert (s["kind"], s["status"], s["name"], body["job"]["type"]) == (
        "design",
        "building",
        "site-tin — EG",
        "design_import",
    )
    assert s["design_source"]["format"] == "landxml" and s["build_params"] is None and s["stats"] is None
    assert job["state"] == "succeeded", job
    r = row(handle, s["id"])
    assert (r.status, r.method, r.cell_size_m, r.epsg, r.point_cloud_id, r.error) == (
        "ready",
        "tin",
        0.5,
        32639,
        None,
        None,
    )
    spec, z, (x, y) = cells(handle, s["id"])
    assert grid.same_lattice(spec, target_spec())  # S2 reads it with an integer offset (case R1)
    ok = np.isfinite(z)
    assert ok.sum() > 0.95 * 160 * 60 / 0.25
    assert np.abs(z[ok] - (plane_z(x, y)[ok] + 0.3)).max() < 1e-4
    assert r.z_min == pytest.approx(float(np.nanmin(z))) and 0 < r.coverage_fraction <= 1
    assert grid.convention_problems(surface_path(handle, s["id"])) == []
    ds = r.design_source
    assert set(ds) == {
        "path",
        "format",
        "units",
        "vertical_units",
        "sha256",
        "candidates",
        "source_crs_wkt",
        "source_epsg",
        "swap_xy",
        "max_edge_m",
        "aligned_to_surface_id",
        "accepted_warnings",
    }
    assert (ds["units"], ds["candidates"], ds["source_epsg"], ds["aligned_to_surface_id"]) == (
        "metre",
        ["EG"],
        32639,
        target,
    )
    assert (surface_dir(handle, s["id"]) / "source.json").is_file()
    assert not store.inspection_dir(handle, iid).exists()
    assert {"type": "surfaces.changed", "payload": {"surface_ids": [s["id"]]}}.items() <= next(
        e for e in events if e["type"] == "surfaces.changed"
    ).items()


def test_dxf_faces_rasterise_to_the_plane(client, project_id, wait_job, tmp_path, handle, target):
    doc = new_doc()
    v, t = two_triangle_plane(size=90.0)
    add_faces(doc.modelspace(), v + [10, 5, 0], t, "TIN")
    iid = inspect(client, project_id, wait_job, save(doc, tmp_path / "f.dxf"))
    p = preview(client, project_id, wait_job, iid, target_surface_id=target)
    body, job = build(client, project_id, wait_job, iid, p["id"])
    assert job["state"] == "succeeded" and row(handle, body["surface"]["id"]).method == "tin"
    _, z, (x, y) = cells(handle, body["surface"]["id"])
    ok = np.isfinite(z)
    assert np.abs(z[ok] - plane_z(x - 10, y - 5)[ok]).max() < 1e-4


def test_contours_build_with_the_previewed_trimming(client, project_id, wait_job, tmp_path, handle, target):
    doc = new_doc()
    add_contours(doc.modelspace(), *cone_contour_runs(128), layer="CONTOURS")
    iid = inspect(client, project_id, wait_job, save(doc, tmp_path / "c.dxf"))
    p = preview(client, project_id, wait_job, iid, target_surface_id=target)
    pinternal = store.read_json(
        store.preview_dir(store.inspection_dir(handle, iid), p["id"]) / "internal.json"
    )
    body, job = build(client, project_id, wait_job, iid, p["id"])
    r = row(handle, body["surface"]["id"])
    assert job["state"] == "succeeded" and r.method == "delaunay"
    assert r.design_source["max_edge_m"] == pinternal["max_edge_m"]
    _, z, (x, y) = cells(handle, body["surface"]["id"])
    rr = np.hypot(x - CONE_CENTRE[0], y - CONE_CENTRE[1])
    ok = np.isfinite(z) & (rr >= 4) & (rr <= 39)
    assert ok.sum() > 10_000 and np.abs(z[ok] - cone_z(x, y)[ok]).max() < 0.3


def test_a_conforming_dem_is_copied(client, project_id, wait_job, tmp_path, handle, target):
    src = write_target(tmp_path / "dem.tif", target_spec(), lambda x, y: plane_z(x, y) - 1.0)
    iid = inspect(client, project_id, wait_job, src)
    p = preview(client, project_id, wait_job, iid, target_surface_id=target)
    body, job = build(client, project_id, wait_job, iid, p["id"])
    r = row(handle, body["surface"]["id"])
    assert job["state"] == "succeeded" and r.method == "dem_copy" and r.design_source["units"] is None
    with rasterio.open(src) as a, rasterio.open(surface_path(handle, r.id)) as b:
        assert np.array_equal(a.read(1), b.read(1), equal_nan=True)


def test_an_offset_dem_in_feet_is_regridded_in_metres(client, project_id, wait_job, tmp_path, handle, target):
    spec = target_spec()
    x, y = spec.cell_centres(Window(0, 0, spec.width, spec.height))
    z_ft = (plane_z(x + 0.25, y - 0.25) / 0.3048).astype(np.float32)
    src = write_dem(tmp_path / "ft.tif", z_ft, x0=spec.x0 + 0.25, y0=spec.y0 - 0.25, cell=0.5)
    iid = inspect(client, project_id, wait_job, src)
    p = preview(
        client, project_id, wait_job, iid, target_surface_id=target, vertical_unit="international_foot"
    )
    body, job = build(client, project_id, wait_job, iid, p["id"], accept_warnings=True)
    assert job["state"] == "succeeded" and row(handle, body["surface"]["id"]).method == "dem_resample"
    _, z, (xx, yy) = cells(handle, body["surface"]["id"])
    ok = np.isfinite(z)
    assert ok.mean() > 0.9 and np.abs(z[ok] - plane_z(xx, yy)[ok]).max() < 1e-3


def test_without_a_target_the_design_keeps_its_crs(client, project_id, wait_job, tmp_path, handle):
    pts, faces = grid_tin(21, 11, 1.0)
    iid = inspect(
        client,
        project_id,
        wait_job,
        write_landxml(tmp_path / "s.xml", [{"name": "EG", "points": pts, "faces": faces}]),
    )
    p = preview(client, project_id, wait_job, iid, cell_size_m=0.25)
    body, job = build(client, project_id, wait_job, iid, p["id"])
    r = row(handle, body["surface"]["id"])
    assert job["state"] == "succeeded" and (r.cell_size_m, r.epsg) == (0.25, 32639)
    assert r.design_source["aligned_to_surface_id"] is None


def test_the_commit_gate(client, app, project_id, wait_job, tmp_path, handle, target):
    pts, faces = grid_tin(161, 61, 1.0, E0 + 20, N0 + 20, lambda e, n: plane_z(e, n) + 0.3)
    swapped = write_landxml(
        tmp_path / "enz.xml", [{"name": "EG", "points": pts, "faces": faces}], order="ENZ"
    )
    iid = inspect(client, project_id, wait_job, swapped)
    warn = preview(client, project_id, wait_job, iid, target_surface_id=target)
    assert "no_overlap" in {w["code"] for w in warn["warnings"]}
    r = commit(client, project_id, iid, warn["id"])
    assert r.status_code == 409 and "accept" in r.json()["error"]["message"]
    newer = preview(client, project_id, wait_job, iid, target_surface_id=target, swap_xy=True)
    assert commit(client, project_id, iid, warn["id"], accept_warnings=True).status_code == 409  # superseded
    pdir = store.preview_dir(store.inspection_dir(handle, iid), newer["id"])
    store.patch_json(pdir / "preview.json", state="running")
    assert commit(client, project_id, iid, newer["id"]).status_code == 409  # not ready
    store.patch_json(
        pdir / "preview.json",
        state="ready",
        warnings=[{"code": "mixed_geometry", "level": "block", "message": "x"}],
    )
    assert commit(client, project_id, iid, newer["id"], accept_warnings=True).status_code == 409  # block
    assert commit(client, project_id, "00000000-0000-4000-8000-000000000000", newer["id"]).status_code == 404


def test_accepted_warnings_are_recorded(client, project_id, wait_job, tmp_path, handle, target):
    pts, faces = grid_tin(161, 61, 1.0, E0 + 20, N0 + 20, lambda e, n: plane_z(e, n) + 45.0)
    iid = inspect(
        client,
        project_id,
        wait_job,
        write_landxml(tmp_path / "s.xml", [{"name": "EG", "points": pts, "faces": faces}]),
    )
    p = preview(client, project_id, wait_job, iid, target_surface_id=target)
    body, job = build(client, project_id, wait_job, iid, p["id"], accept_warnings=True)
    assert job["state"] == "succeeded"
    assert row(handle, body["surface"]["id"]).design_source["accepted_warnings"] == ["z_offset"]


def test_commit_refuses_when_the_target_is_gone(client, project_id, wait_job, tmp_path, handle, target):
    pts, faces = grid_tin(161, 61, 1.0, E0 + 20, N0 + 20)
    iid = inspect(
        client,
        project_id,
        wait_job,
        write_landxml(tmp_path / "s.xml", [{"name": "EG", "points": pts, "faces": faces}]),
    )
    p = preview(client, project_id, wait_job, iid, target_surface_id=target)
    with handle.session() as s:
        s.get(Surface, target).status = "failed"
    r = commit(client, project_id, iid, p["id"])
    assert r.status_code == 409 and "no longer ready" in r.json()["error"]["message"]


def test_dem_changed_after_preview_fails_the_build(client, project_id, wait_job, tmp_path, handle, target):
    import os

    src = write_target(tmp_path / "dem.tif", target_spec(), plane_z)
    iid = inspect(client, project_id, wait_job, src)
    p = preview(client, project_id, wait_job, iid, target_surface_id=target)
    st = src.stat()
    os.utime(src, ns=(st.st_atime_ns, st.st_mtime_ns + 5_000_000_000))
    body, job = build(client, project_id, wait_job, iid, p["id"])
    assert job["state"] == "failed" and "changed since it was read" in job["error"]
    r = row(handle, body["surface"]["id"])
    assert r.status == "failed" and "changed since it was read" in r.error
    assert not surface_dir(handle, r.id).exists() and store.inspection_dir(handle, iid).exists()


def test_cancel_leaves_no_partial_and_no_folder(
    client, app, project_id, wait_job, tmp_path, handle, target, monkeypatch
):
    import threading

    started = threading.Event()

    def stuck(tin, spec, path, progress, check):
        path.with_name(path.name + ".partial").write_bytes(b"x")  # what a half-written SurfaceWriter leaves
        started.set()
        while True:
            try:
                check()
            except BaseException:
                path.with_name(path.name + ".partial").unlink()
                raise

    monkeypatch.setattr(phase_build, "_rasterise", stuck)
    pts, faces = grid_tin(161, 61, 1.0, E0 + 20, N0 + 20)
    iid = inspect(
        client,
        project_id,
        wait_job,
        write_landxml(tmp_path / "s.xml", [{"name": "EG", "points": pts, "faces": faces}]),
    )
    p = preview(client, project_id, wait_job, iid, target_surface_id=target)
    r = commit(client, project_id, iid, p["id"]).json()
    assert started.wait(10)
    client.post(url(project_id, f"/jobs/{r['job']['id']}/cancel"))
    assert wait_job(project_id, r["job"]["id"])["state"] == "cancelled"
    s = row(handle, r["surface"]["id"])
    assert (s.status, s.error) == ("failed", "import cancelled")
    assert not surface_dir(handle, s.id).exists()
    assert store.inspection_dir(handle, iid).exists()  # a retry needs no re-parse


def test_a_training_project_may_not_import_a_design(client, tmp_path):
    body = {"name": "t", "folder": str(tmp_path / "t"), "classes": [], "kind": "train"}
    pid = client.post(BASE, json=body).json()["id"]
    r = commit(client, pid, "00000000-0000-4000-8000-000000000000", "00000000-0000-4000-8000-000000000001")
    assert r.status_code == 409 and r.json()["error"]["code"] == "wrong_project_kind"


def test_read_windows_tile_on_the_rasteriser_blocks():
    spec = target_spec((E0, N0, E0 + 500, N0 + 300), cell=0.1)
    wins = list(grid.read_windows(spec))
    assert all(w.col_off % grid.MAX_READ == 0 and w.row_off % grid.MAX_READ == 0 for w in wins)
    assert all(w.width <= grid.MAX_READ and w.height <= grid.MAX_READ for w in wins)
```

In `backend/tests/test_design_selftest.py`, change the first test to:

```python
def test_selftest_reads_a_dxf_triangulates_and_writes_a_surface():
    facts = selftest.run()
    assert facts["faces"] == 10 and facts["triangles"] > 0
    assert facts["surface"] == "64x64" and facts["valid_cells"] == 64 * 64
```

- [ ] **Step 2: Run the tests to verify they fail**

Run from `backend`: `$PY -m pytest tests/test_design_build.py tests/test_design_selftest.py -v`
Expected: FAIL — `createDesignSurface` answers 501, `phase_build` does not exist, and `facts` has no `surface`.

- [ ] **Step 3: Write `surface_json.py`**

```python
"""A design Surface row as the contract's `Surface` (S2 §11.2), for createDesignSurface's SurfaceWithJob.

S2 owns the Surface serializer (its V2 unit), which is not on main when S3's build lands; this
module serialises the design rows S3 creates, and tests/test_contract.py validates it against the
contract. docs/progress.md carries the follow-up: use S2's serializer once V2 is on main.
"""

from __future__ import annotations

from pyproj import CRS
from sqlalchemy import func, or_, select

from app.db.models import Surface, VolumeMeasurement
from app.maps.tiles import TILE, max_zoom


def surface_json(handle, surface_id: str) -> dict:
    with handle.session() as s:
        row = s.get(Surface, surface_id)
        uses = s.execute(
            select(func.count())
            .select_from(VolumeMeasurement)
            .where(
                or_(
                    VolumeMeasurement.top_surface_id == surface_id,
                    func.json_extract(VolumeMeasurement.base, "$.surface_id") == surface_id,
                )
            )
        ).scalar_one()
        return {
            "id": row.id,
            "name": row.name,
            "kind": row.kind,
            "status": row.status,
            "error": row.error,
            "point_cloud_id": row.point_cloud_id,
            "design_source": row.design_source,
            "crs_wkt": row.crs_wkt,
            "epsg": row.epsg,
            "proj4": CRS.from_wkt(row.crs_wkt).to_proj4() if row.crs_wkt else None,
            "cell_size_m": row.cell_size_m,
            "width": row.width,
            "height": row.height,
            "geotransform": row.geotransform,
            "bounds_native": row.bounds_native,
            "z_min": row.z_min,
            "z_max": row.z_max,
            "coverage_fraction": row.coverage_fraction,
            "method": row.method,
            "build_params": None,
            "stats": None,
            "captured_on": None,
            "map_id": None,
            "tile_grid": {"tile_size": TILE, "max_zoom": max_zoom(row.width, row.height)}
            if row.width and row.height
            else None,
            "measurement_count": int(uses),
            "job_id": row.job_id,
            "created_at": row.created_at,
        }
```

- [ ] **Step 4: Write `phase_build.py`**

```python
"""The commit gate and the `build` phase (spec §2 Commit gate, §3, §4.1 build, §4.2, §6 Build).

The build re-runs the preview's pipeline on the output grid the preview stored (internal.json), with
the preview's resolved maximum edge, and writes block by block through S2's SurfaceWriter.
"""

from __future__ import annotations

import gc
import shutil
from pathlib import Path

from app.db.models import Surface
from app.errors import AppError
from app.jobs.cancellation import JobCancelled, JobFailure
from app.surfaces import grid
from app.surfaces.design import dem_build, pipeline, rasterise, store
from app.surfaces.design import placement as placing
from app.surfaces.design.targets import target_ready
from app.surfaces.paths import surface_dir, surface_path

MESSAGE = "Importing design surface"


def _conflict(message: str) -> AppError:
    return AppError("conflict", message, 409)


def check_commit(handle, idir: Path, preview_id: str, accept: bool, runner) -> tuple[dict, dict]:
    """Look before you commit (spec §2): a ready, newest preview; no block; warn needs accept."""
    inspection = store.read_json(idir / "inspection.json")
    preview = store.read_json(store.require_preview(idir, preview_id) / "preview.json")
    req = store.read_json(idir / "request.json")
    if req.get("build_job_id") and runner.is_live(req["build_job_id"]):
        raise _conflict("this design is already being imported")
    if preview["state"] != "ready":
        raise _conflict("the preview is not ready: wait for it, or preview again")
    if req.get("latest_preview_id") != preview_id:
        raise _conflict("a newer preview exists: import from the newest one")
    blocks = [w for w in preview["warnings"] if w["level"] == "block"]
    if blocks:
        raise _conflict(f"this design can't be imported: {blocks[0]['message']}")
    if any(w["level"] == "warn" for w in preview["warnings"]) and not accept:
        raise _conflict("this preview has warnings: accept them to import")
    target = preview["options"].get("target_surface_id")
    if target and not target_ready(handle, target):
        raise _conflict(f"the target surface {target} is no longer ready; preview again")
    return inspection, preview


def design_source(inspection: dict, preview: dict, pinternal: dict, accept: bool) -> dict:
    o, fmt = preview["options"], inspection["format"]
    src = placing.parse_crs(o["source_crs"])
    return {
        "path": inspection["path"],
        "format": fmt,
        "units": None if fmt == "geotiff" else o["horizontal_unit"],
        "vertical_units": o["vertical_unit"],
        "sha256": inspection["sha256"],
        "candidates": [c["name"] for c in inspection["candidates"] if c["id"] in o["candidate_ids"]],
        "source_crs_wkt": src.to_wkt(),
        "source_epsg": src.to_epsg(),
        "swap_xy": bool(o.get("swap_xy")) and fmt != "geotiff",
        "max_edge_m": pinternal.get("max_edge_m"),
        "aligned_to_surface_id": o.get("target_surface_id"),
        "accepted_warnings": sorted({w["code"] for w in preview["warnings"] if w["level"] == "warn"})
        if accept
        else [],
    }


def _default_name(inspection: dict, source: dict) -> str:
    stem = Path(inspection["path"]).stem
    name = stem if inspection["format"] == "geotiff" else f"{stem} — {', '.join(source['candidates'])}"
    return name[:200]


def create(handle, runner, body) -> tuple[str, object]:
    idir = store.require_inspection(handle, body.inspection_id)
    inspection, preview = check_commit(handle, idir, body.preview_id, body.accept_warnings, runner)
    pinternal = store.read_json(store.preview_dir(idir, body.preview_id) / "internal.json")
    source = design_source(inspection, preview, pinternal, body.accept_warnings)
    with handle.session() as s:
        row = Surface(
            name=body.name or _default_name(inspection, source),
            kind="design",
            status="building",
            point_cloud_id=None,
            design_source=source,
        )
        s.add(row)
        s.flush()
        sid = row.id
    job = runner.submit(
        handle,
        "design_import",
        {
            "phase": "build",
            "surface_id": sid,
            "inspection_id": body.inspection_id,
            "preview_id": body.preview_id,
        },
    )
    with handle.session() as s:
        s.get(Surface, sid).job_id = job.id
    store.patch_json(idir / "request.json", build_job_id=job.id, surface_id=sid)
    return sid, job


def _rasterise(tin: pipeline.Tin, spec: grid.GridSpec, path: Path, progress, check) -> grid.SurfaceStats:
    r = rasterise.TinRasteriser(tin.vertices, tin.triangles, spec, side=grid.MAX_READ, check_cancelled=check)
    windows = list(grid.read_windows(spec))
    with grid.SurfaceWriter(path, spec, check_cancelled=check) as w:
        for i, win in enumerate(windows):
            block = r.rasterise_window(win)
            if block is not None:
                w.write_block(win, block)
            progress((i + 1) / len(windows), MESSAGE)
        return w.finish()


def _build(ctx, sid: str, idir: Path, pid: str) -> dict:
    handle = ctx.project
    inspection = store.read_json(idir / "inspection.json")
    iinternal = store.read_json(idir / "internal.json")
    pdir = store.preview_dir(idir, pid)
    preview, pinternal = store.read_json(pdir / "preview.json"), store.read_json(pdir / "internal.json")
    options, fmt = preview["options"], inspection["format"]
    out = grid.GridSpec.from_json(pinternal["output_spec"])
    target = None
    if options.get("target_surface_id"):
        with grid.open_surface(surface_path(handle, options["target_surface_id"])) as reader:
            target = reader.spec
        if not grid.same_lattice(out, target):
            raise JobFailure("the target surface changed since the preview; preview again")
    p = placing.resolve(options, fmt, target)
    surface_dir(handle, sid).mkdir(parents=True, exist_ok=True)
    path = surface_path(handle, sid)

    def progress(f: float, m: str = MESSAGE) -> None:
        ctx.progress(0.05 + 0.9 * f, m)

    if fmt == "geotiff":
        import rasterio

        src = Path(inspection["path"])
        dem_build.check_unchanged(src, iinternal)
        if dem_build.can_copy(src, p, target, iinternal):
            dem_build.copy_file(src, path, progress=progress, check_cancelled=ctx.check_cancelled)
            stats = grid.compute_stats(path, check_cancelled=ctx.check_cancelled)
            with rasterio.open(path) as ds:
                spec = grid.GridSpec.from_dataset(ds)
            method = "dem_copy"
        else:
            with grid.SurfaceWriter(path, out, check_cancelled=ctx.check_cancelled) as w:
                dem_build.regrid(
                    src, out, w, p, iinternal, progress=progress, check_cancelled=ctx.check_cancelled
                )
                stats = w.finish()
            spec, method = out, "dem_resample"
    else:
        sel = pipeline.select(inspection, options["candidate_ids"])
        v, t, runs = pipeline.load_geometry(idir, sel, p, check_cancelled=ctx.check_cancelled)
        if sel.geometry == "points":
            tin = pipeline.triangulate_points(
                v,
                runs,
                grid_cell=out.cell_size,
                out_cell=out.cell_size,
                max_edge_m=pinternal.get("max_edge_m"),
                check_cancelled=ctx.check_cancelled,
            )
        else:
            tin = pipeline.Tin(v, t, {}, "tin")
        del v, t, runs
        stats = _rasterise(tin, out, path, progress, ctx.check_cancelled)
        spec, method = out, tin.method
    if stats.valid_cells == 0:
        raise JobFailure("the design covers no cell of the output grid")
    with handle.session() as s:
        row = s.get(Surface, sid)
        row.status, row.error, row.method = "ready", None, method
        row.crs_wkt, row.epsg, row.cell_size_m = spec.crs_wkt, spec.epsg, spec.cell_size
        row.width, row.height = spec.width, spec.height
        row.geotransform, row.bounds_native = list(spec.geotransform), list(spec.bounds)
        row.z_min, row.z_max, row.coverage_fraction = stats.z_min, stats.z_max, stats.coverage_fraction
        source = dict(row.design_source)
    keys = (
        "overlap_fraction",
        "target_covered_fraction",
        "design_area_m2",
        "z_check",
        "triangle_count",
        "warnings",
    )
    store.write_json(
        surface_dir(handle, sid) / "source.json", {**source, "preview": {k: preview[k] for k in keys}}
    )
    return {
        "surface_id": sid,
        "width": spec.width,
        "height": spec.height,
        "coverage_fraction": stats.coverage_fraction,
    }


def _fail(ctx, sid: str, message: str) -> None:
    with ctx.project.session() as s:
        row = s.get(Surface, sid)
        if row is not None:
            row.status, row.error = "failed", message
    shutil.rmtree(surface_dir(ctx.project, sid), ignore_errors=True)
    ctx.publish("surfaces.changed", {"surface_ids": [sid]})


def run(ctx) -> dict:
    sid, iid, pid = ctx.params["surface_id"], ctx.params["inspection_id"], ctx.params["preview_id"]
    idir = store.inspection_dir(ctx.project, iid)
    try:
        result = _build(ctx, sid, idir, pid)
    except JobCancelled:
        _fail(ctx, sid, "import cancelled")
        raise
    except JobFailure as e:
        _fail(ctx, sid, str(e))
        raise
    except Exception as e:
        _fail(ctx, sid, f"import failed: {type(e).__name__}: {e}")
        raise
    gc.collect()  # memory maps of the cache must be gone before Windows lets the folder go
    shutil.rmtree(idir, ignore_errors=True)
    ctx.publish("surfaces.changed", {"surface_ids": [sid]})
    ctx.progress(1.0, "Design surface ready")
    return result
```

- [ ] **Step 5: Add `createDesignSurface` to the router and remove the stubs**

In `backend/app/surfaces/design/router.py`:

1. Add `DesignSurfaceCreate` to the schemas import, and `from app.events_util import publish_surfaces_changed` (F0's helper).
2. Delete the `STUBS = [...]` line, the `add_stubs(router, STUBS)` line and the `from app.stubs import add_stubs` import, and the module docstring's sentence about stubs.
3. Add:

```python
@router.post("/design-surfaces", status_code=202)
def create_design_surface(
    body: DesignSurfaceCreate, request: Request, handle: ProjectHandle = Depends(get_project)
) -> dict:
    # Imported here: the build modules pull in rasterio and scipy, which the router must not need to load.
    from app.surfaces.design import phase_build, surface_json

    surface_id, job = phase_build.create(handle, request.app.state.jobs, body)
    publish_surfaces_changed(request, handle, [surface_id])  # the list shows the building row at once
    return {"surface": surface_json.surface_json(handle, surface_id), "job": JobOut.from_row(job, handle.id)}
```

- [ ] **Step 6: Remove the last S3 operation from `EXPECTED_STUBS`**

In `backend/tests/test_contract.py`, delete exactly:

```python
    "createDesignSurface",
```

- [ ] **Step 7: Add the surface write to `design-selftest`**

In `backend/app/surfaces/design/selftest.py`, replace `run` and `main` with:

```python
def run() -> dict:
    import ezdxf
    from ezdxf import recover
    from pyproj import CRS
    from rasterio.windows import Window
    from scipy.spatial import Delaunay

    from app.surfaces import grid

    with tempfile.TemporaryDirectory(prefix="kestrel-design-") as tmp:
        path = Path(tmp) / "selftest.dxf"
        doc = ezdxf.new("R2010")
        msp = doc.modelspace()
        for i in range(10):
            msp.add_3dface([(i, 0, 0), (i + 1, 0, 1), (i, 1, 2)], dxfattribs={"layer": "TIN"})
        doc.saveas(path)
        back, _auditor = recover.readfile(str(path))
        faces = sum(1 for e in back.modelspace() if e.dxftype() == "3DFACE")
        spec = grid.aligned_grid(
            (500000.0, 2800000.0, 500031.5, 2800031.5), 0.5, CRS.from_epsg(32639).to_wkt(), 32639
        )
        with grid.SurfaceWriter(Path(tmp) / "surface.tif", spec) as w:
            w.write_block(
                Window(0, 0, spec.width, spec.height), np.ones((spec.height, spec.width), np.float32)
            )
            stats = w.finish()
    tri = Delaunay(np.random.default_rng(0).random((100, 2)))
    return {
        "faces": faces,
        "triangles": int(len(tri.simplices)),
        "surface": f"{spec.width}x{spec.height}",
        "valid_cells": stats.valid_cells,
    }


def main(argv: list[str] | None = None) -> int:
    """`argv` (the arguments after `design-selftest`) is accepted and ignored, as F0 dispatches it."""
    facts = run()
    ok = facts["faces"] == 10 and facts["triangles"] > 0 and facts["valid_cells"] == 64 * 64
    if ok:
        print(f"design ok {facts['faces']} {facts['triangles']} surface {facts['surface']}")
    else:
        print(f"design selftest failed: {facts}")
    return 0 if ok else 1
```

Update the module docstring's last sentence to "It also writes a 64 x 64 surface through grid.SurfaceWriter (GDAL, overviews)."

- [ ] **Step 8: Run the tests to verify they pass**

Run from `backend`: `$PY -m pytest tests/test_design_build.py tests/test_design_selftest.py tests/test_contract.py tests/test_pointcloud_stubs.py -v`
Expected: PASS. `test_contract.py` now calls `createDesignSurface` with generated bodies (404 for the unknown inspection) and must see no 501 from any S3 operation.

- [ ] **Step 9: Run the whole backend suite**

Run from `backend`: `$PY -m ruff check .; $PY -m ruff format --check .; $PY -m pytest -q`
Expected: all clean and passing.

- [ ] **Step 10: Commit**

```
git add backend/app/surfaces/design/phase_build.py backend/app/surfaces/design/surface_json.py backend/app/surfaces/design/router.py backend/app/surfaces/design/selftest.py backend/tests/test_contract.py backend/tests/test_design_build.py backend/tests/test_design_selftest.py
git commit -m "feat(design): the build phase and createDesignSurface behind the preview gate" -m "Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---
### Task 15: Mount the dialog in the Volumes screen's surface list

Starts when S2 V7 (the Volumes screen surface list) is on `main`: rebase `task/design-surfaces` onto `main` first. Load `impeccable` and `emil-design-eng` again. This is the only S3 edit to an S2 file (spec §11, §14.2).

**Files:**
- Create: `frontend/src/surfaces/ImportDesignButton.tsx`, `frontend/src/surfaces/ImportDesignButton.test.tsx`
- Modify: S2 V7's surface-list component — the file that renders the "Build surface" button. Find it with `Select-String -Path frontend\src\volumes\*.tsx,frontend\src\screens\VolumesScreen.tsx -Pattern '"Build surface"|>Build surface<'`; exactly one file matches. The edit is one import and one element.

**Interfaces:**
- Consumes: Task 6 (`ImportDesignDialog`); `useOnJobsFinished(type, onFinished)`; S2 V7's list and the callback it already uses to reload its surfaces (the function it hands to `useOnJobsFinished("surface_build", …)`).
- Produces: `ImportDesignButton({ projectId, onChanged }: { projectId: string; onChanged: () => void })` — the button, the dialog, and a reload when an import starts or a `design_import` job finishes (S2's list listens only to `surface_build` and `volume_calc`, S2 §9).

- [ ] **Step 1: Write the failing test**

`frontend/src/surfaces/ImportDesignButton.test.tsx`:

```tsx
import { describe, expect, it, vi } from "vitest";
import { act, fireEvent, screen } from "@testing-library/react";
import { fakeClient, PROJECT_ID } from "@/test/fixtures";
import { renderWithProviders } from "@/test/render";
import { useJobsStore } from "@/store/jobs";
import { ImportDesignButton } from "./ImportDesignButton";
import { BUILD_JOB } from "./testFixtures";

const job = (state: string) => ({
  id: BUILD_JOB,
  project_id: PROJECT_ID,
  type: "design_import" as const,
  state,
  progress: 0,
  message: "",
  log_path: "",
  params: {},
  result: null,
  error: null,
  created_at: "2026-09-24T09:00:00Z",
  started_at: null,
  finished_at: null,
});

describe("ImportDesignButton", () => {
  it("opens the dialog and closes it again", () => {
    const { api } = fakeClient([{ method: "GET", path: /\/surfaces$/, body: { items: [] } }]);
    renderWithProviders(<ImportDesignButton projectId={PROJECT_ID} onChanged={() => {}} />, { api });
    fireEvent.click(screen.getByRole("button", { name: "Import design surface" }));
    expect(screen.getByRole("dialog", { name: "Import design surface" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("reloads the list when a design import finishes", () => {
    const onChanged = vi.fn();
    const { api } = fakeClient([]);
    renderWithProviders(<ImportDesignButton projectId={PROJECT_ID} onChanged={onChanged} />, { api });
    act(() => useJobsStore.getState().upsert(job("running") as never));
    act(() => useJobsStore.getState().upsert(job("succeeded") as never));
    expect(onChanged).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm -C frontend exec vitest run src/surfaces/ImportDesignButton.test.tsx`
Expected: FAIL with "Failed to resolve import './ImportDesignButton'".

- [ ] **Step 3: Write `ImportDesignButton.tsx`**

```tsx
import { useState } from "react";
import { useOnJobsFinished } from "@/jobs/useOnJobsFinished";
import { Button } from "@/ui";
import { ImportDesignDialog } from "./ImportDesignDialog";

/** "Import design surface" next to S2's "Build surface" (spec 2026-09-23-design-surfaces §11). */
export function ImportDesignButton({ projectId, onChanged }: { projectId: string; onChanged: () => void }) {
  const [open, setOpen] = useState(false);
  useOnJobsFinished("design_import", onChanged);
  return (
    <>
      <Button icon="import" onClick={() => setOpen(true)}>
        Import design surface
      </Button>
      {open && (
        <ImportDesignDialog
          projectId={projectId}
          onClose={() => setOpen(false)}
          onStarted={() => {
            setOpen(false);
            onChanged();
          }}
        />
      )}
    </>
  );
}
```

- [ ] **Step 4: Mount it**

Locate the file (PowerShell, from the worktree root) and keep its path:

```
$s2 = (Select-String -Path frontend\src\volumes\*.tsx,frontend\src\screens\VolumesScreen.tsx -Pattern '"Build surface"|>Build surface<' -List).Path
$s2
```

Expected: exactly one path. In that file, add the import

```tsx
import { ImportDesignButton } from "@/surfaces/ImportDesignButton";
```

and, directly after the element that renders the "Build surface" button (inside the same button row), add

```tsx
<ImportDesignButton projectId={projectId} onChanged={RELOAD} />
```

where `RELOAD` is the identifier that file already passes to `useOnJobsFinished("surface_build", …)` (its surfaces reload); `projectId` is the variable that file already has in scope under that name (use its actual name if it differs). No other line of the S2 file changes.

- [ ] **Step 5: Run the tests**

Run: `pnpm -C frontend exec vitest run src/surfaces src/volumes src/screens` then `pnpm -C frontend lint`
Expected: PASS, including S2's own Volumes tests unchanged.

- [ ] **Step 6: Commit**

```
git add frontend/src/surfaces/ImportDesignButton.tsx frontend/src/surfaces/ImportDesignButton.test.tsx $s2
git commit -m "feat(design): Import design surface from the Volumes surface list" -m "Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 16: End-to-end test of the import flow

Runs against the Prism mock with `page.route` stubs, like every e2e suite here (Deviation 9). The real pipeline end to end is `tests/test_design_build.py` (Task 14) and the acceptance in Task 17.

**Files:**
- Create: `frontend/e2e/design-surfaces.spec.ts`

**Interfaces:**
- Consumes: Task 15 (the mounted button); `e2e/kinds.ts` (`asDetectionProject`, `jsonReply`); the Volumes route `/p/:projectId/volumes` (F0).

- [ ] **Step 1: Write the test**

`frontend/e2e/design-surfaces.spec.ts`:

```ts
import { test, expect, type Page } from "@playwright/test";
import { asDetectionProject, jsonReply } from "./kinds";

const P = "7f1c2e3a-1111-4000-8000-000000000001";
const INSP = "d0000000-1111-4000-8000-000000000001";
const PREV = "d0000000-2222-4000-8000-000000000001";
const SURF = "s0000000-4444-4000-8000-000000000001";
const IJ = "j0000000-5555-4000-8000-000000000001";
const PJ = "j0000000-6666-4000-8000-000000000001";
const BJ = "j0000000-7777-4000-8000-000000000001";
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkaGhgAAAChACB8f3CzwAAAABJRU5ErkJggg==",
  "base64",
);
const CORS = { "Access-Control-Allow-Origin": "*" };

const job = (id: string, state: string) => ({
  id,
  project_id: P,
  type: "design_import",
  state,
  progress: state === "succeeded" ? 1 : 0,
  message: "",
  log_path: "",
  params: {},
  result: null,
  error: null,
  created_at: "2026-09-24T09:00:00Z",
  started_at: null,
  finished_at: null,
});
const inspection = {
  id: INSP,
  state: "ready",
  error: null,
  job_id: IJ,
  path: "C:\\temp\\site-tin.xml",
  format: "landxml",
  file_size: 2048,
  sha256: "ab".repeat(32),
  detected: {
    horizontal_unit: "metre",
    vertical_unit: "metre",
    unit_source: "LandXML <Metric linearUnit=meter>",
    crs_wkt: 'PROJCS["WGS 84 / UTM zone 39N"]',
    epsg: 32639,
    crs_source: "LandXML <CoordinateSystem epsgCode>",
    crs_hint: null,
  },
  candidates: [
    {
      id: "c0",
      kind: "tin_surface",
      name: "Existing ground",
      geometry: "faces",
      bounds_file: [500000, 2800000, 500100, 2800050],
      z_min: -50,
      z_max: -40,
      point_count: 120,
      face_count: 200,
      entity_counts: { invisible_faces: 0 },
      default_selected: true,
      notes: [],
      raster: null,
    },
  ],
  default_target_surface_id: null,
  created_at: "2026-09-24T09:00:00Z",
};
const options = {
  candidate_ids: ["c0"],
  source_crs: "EPSG:32639",
  horizontal_unit: "metre",
  vertical_unit: "metre",
  swap_xy: false,
  target_surface_id: null,
  cell_size_m: 0.5,
  max_edge_m: null,
};
const preview = {
  id: PREV,
  inspection_id: INSP,
  state: "ready",
  error: null,
  job_id: PJ,
  options,
  output: {
    crs_wkt: 'PROJCS["WGS 84 / UTM zone 39N"]',
    epsg: 32639,
    cell_size_m: 0.5,
    width: 201,
    height: 101,
    bounds_native: [500000, 2800000, 500100.5, 2800050.5],
    preview_cell_size_m: 0.5,
  },
  triangle_count: 200,
  overlap_fraction: null,
  target_covered_fraction: null,
  design_area_m2: 5000,
  z_check: null,
  warnings: [
    {
      code: "no_target",
      level: "info",
      message: "no cloud surface was chosen, so the design can't be checked against the site",
    },
  ],
  suggestions: [],
  created_at: "2026-09-24T09:01:00Z",
};
const surface = (status: string) => ({
  id: SURF,
  name: "site-tin — Existing ground",
  kind: "design",
  status,
  error: null,
  point_cloud_id: null,
  design_source: null,
  crs_wkt: 'PROJCS["WGS 84 / UTM zone 39N"]',
  epsg: 32639,
  proj4: null,
  cell_size_m: 0.5,
  width: 201,
  height: 101,
  geotransform: [500000, 0.5, 0, 2800050.5, 0, -0.5],
  bounds_native: [500000, 2800000, 500100.5, 2800050.5],
  z_min: -50,
  z_max: -40,
  coverage_fraction: 0.98,
  method: status === "ready" ? "tin" : null,
  build_params: null,
  stats: null,
  captured_on: null,
  map_id: null,
  tile_grid: { tile_size: 256, max_zoom: 0 },
  measurement_count: 0,
  job_id: BJ,
  created_at: "2026-09-24T09:02:00Z",
});

async function stubDesignApi(page: Page, posts: Record<string, unknown[]>) {
  let created = false;
  const base = `/api/v1/projects/${P}`;
  await page.route(
    (u) => u.pathname === `${base}/surfaces`,
    (r) => r.fulfill(jsonReply({ items: created ? [surface("ready")] : [] })),
  );
  await page.route(
    (u) => u.pathname === `${base}/design-inspections`,
    (r) => {
      posts.inspections.push(r.request().postDataJSON());
      return r.fulfill(
        jsonReply(
          {
            inspection: { ...inspection, state: "inspecting", candidates: [], detected: null },
            job: job(IJ, "queued"),
          },
          202,
        ),
      );
    },
  );
  await page.route(
    (u) => u.pathname === `${base}/design-inspections/${INSP}`,
    (r) =>
      r.request().method() === "DELETE"
        ? r.fulfill({ status: 204, headers: CORS })
        : r.fulfill(jsonReply(inspection)),
  );
  await page.route(
    (u) => u.pathname === `${base}/design-inspections/${INSP}/previews`,
    (r) => {
      posts.previews.push(r.request().postDataJSON());
      return r.fulfill(jsonReply({ preview: { ...preview, state: "running" }, job: job(PJ, "queued") }, 202));
    },
  );
  await page.route(
    (u) => u.pathname === `${base}/design-inspections/${INSP}/previews/${PREV}`,
    (r) => r.fulfill(jsonReply(preview)),
  );
  await page.route(
    (u) => u.pathname.endsWith(`/previews/${PREV}/image`),
    (r) => r.fulfill({ status: 200, contentType: "image/png", headers: CORS, body: PNG }),
  );
  await page.route(
    (u) => u.pathname.includes("/candidates/") && u.pathname.endsWith("/thumbnail"),
    (r) => r.fulfill({ status: 200, contentType: "image/png", headers: CORS, body: PNG }),
  );
  for (const id of [IJ, PJ, BJ]) {
    await page.route(
      (u) => u.pathname === `${base}/jobs/${id}`,
      (r) => r.fulfill(jsonReply(job(id, "succeeded"))),
    );
  }
  await page.route(
    (u) => u.pathname === `${base}/design-surfaces`,
    (r) => {
      posts.surfaces.push(r.request().postDataJSON());
      created = true;
      return r.fulfill(jsonReply({ surface: surface("building"), job: job(BJ, "queued") }, 202));
    },
  );
}

test.beforeEach(({ page }) => asDetectionProject(page, P));

test("imports a LandXML design with no target and lists it", async ({ page }) => {
  const posts: Record<string, unknown[]> = { inspections: [], previews: [], surfaces: [] };
  await stubDesignApi(page, posts);
  await page.goto(`/p/${P}/volumes`);
  await page.getByRole("button", { name: "Import design surface" }).click();
  const dialog = page.getByRole("dialog", { name: "Import design surface" });
  await dialog.getByLabel("Design file").fill("C:\\temp\\site-tin.xml");
  await dialog.getByRole("button", { name: "Read file" }).click();
  await expect(dialog.getByRole("combobox", { name: "Surface" })).toHaveValue("c0");
  await expect(dialog.getByLabel("Source CRS")).toHaveValue("EPSG:32639");
  await dialog.getByLabel("Target cloud surface").selectOption("");
  await dialog.getByLabel("Cell size (m)").fill("0.5");
  await dialog.getByRole("button", { name: "Preview" }).click();
  await expect(dialog.getByRole("img", { name: "The design over the cloud surface" })).toBeVisible();
  await expect(dialog.getByText("no cloud surface was chosen")).toBeVisible();
  await dialog.getByRole("button", { name: "Import surface" }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  expect(posts.inspections[0]).toEqual({ path: "C:\\temp\\site-tin.xml" });
  expect(posts.previews[0]).toMatchObject({
    source_crs: "EPSG:32639",
    cell_size_m: 0.5,
    target_surface_id: null,
  });
  expect(posts.surfaces[0]).toMatchObject({ inspection_id: INSP, preview_id: PREV, accept_warnings: false });
  await expect(page.getByText("site-tin — Existing ground")).toBeVisible();
});

test("a DWG shows the fix inline", async ({ page }) => {
  await page.route(
    (u) => u.pathname === `/api/v1/projects/${P}/design-inspections`,
    (r) =>
      r.fulfill(
        jsonReply(
          {
            error: {
              code: "validation_error",
              message:
                "DWG files can't be read. Open the drawing in your CAD program (or the free ODA File Converter) and save it as DXF, then import the DXF.",
              details: { reason: "dwg" },
            },
          },
          422,
        ),
      ),
  );
  await page.goto(`/p/${P}/volumes`);
  await page.getByRole("button", { name: "Import design surface" }).click();
  const dialog = page.getByRole("dialog", { name: "Import design surface" });
  await dialog.getByLabel("Design file").fill("C:\\temp\\site.dwg");
  await dialog.getByRole("button", { name: "Read file" }).click();
  await expect(dialog.getByText(/save it as DXF/)).toBeVisible();
});
```

- [ ] **Step 2: Run it**

Run: `pnpm -C frontend e2e -- design-surfaces.spec.ts` (from a worktree whose dev servers are free, or with `$env:E2E_WEB_PORT` / `$env:E2E_MOCK_PORT` set to free ports).
Expected: 2 passed. If the Volumes list names surfaces through a different element than plain text, keep the assertion on the visible name text — do not reach into S2's DOM structure.

- [ ] **Step 3: Commit**

```
git add frontend/e2e/design-surfaces.spec.ts
git commit -m "test(design): e2e import of a design surface from the Volumes screen" -m "Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 17: Acceptance on the chimney site, walkthrough, evidence, ledger, finish, wrapup

Starts when Tasks 1–16 are merged into `task/design-surfaces` **and** `main` carries S1's import (I2) and S2's surface build (V2) and volume calculation (V5, with V8 for the UI): rebase onto `main` first. The acceptance needs a real chimney cloud imported and a DSM built from it.

**Files:**
- Create: `backend/scripts/design_acceptance.py`
- Create: `docs/usability/2026-09-24-design-surfaces-walkthrough.md`
- Create: `docs/evidence/design-surfaces/README.md`
- Modify: `docs/progress.md`
- Create: `vault/sessions/<date>-<time>-design-surfaces.md` and modify `vault/00-north-star.md` (through `/wrapup`)

**Interfaces:**
- Consumes: everything above; S2's `grid.open_surface`; `contourpy` (already in the lock through matplotlib; used only by this script).
- Produces: `python scripts/design_acceptance.py --dsm <surface.tif> --out <folder>` writing `site-nez.xml`, `site-enz.xml`, `site-3dface.dxf`, `site-contours.dxf`, `site-dem-32638.tif`, `perf-1m.xml` and printing each path.

- [ ] **Step 1: Write the acceptance file generator**

`backend/scripts/design_acceptance.py`:

```python
"""Acceptance files for the design-surface import (spec 2026-09-23-design-surfaces §15.4, §16.11).

From the real chimney DSM (a surface.tif S2 built from the imported cloud) this writes a synthetic
design of the same site in every format the importer reads, plus a 1 M-point LandXML for the timing
criterion. Run from backend/ with the overlay interpreter:
    .venv\\Scripts\\python.exe scripts\\design_acceptance.py --dsm <surface.tif> --out <folder>
"""

from __future__ import annotations

import argparse
import math
from pathlib import Path

import contourpy
import ezdxf
import numpy as np
import rasterio
from pyproj import CRS
from rasterio.warp import Resampling, calculate_default_transform, reproject
from rasterio.windows import Window

from app.surfaces import grid

TIN_STEP_M = 2.0
DEM_CELL_M = 1.0


def sample(dsm: Path, step: float) -> tuple[np.ndarray, np.ndarray, np.ndarray, grid.GridSpec]:
    """Cell-centre X, Y and Z of the DSM on a `step`-metre lattice (one overview read, <= 2048)."""
    with grid.open_surface(dsm) as r:
        spec = r.spec
        w = min(2048, max(2, math.ceil(spec.width * spec.cell_size / step)))
        h = min(2048, max(2, math.ceil(spec.height * spec.cell_size / step)))
        z = r.read(Window(0, 0, spec.width, spec.height), out_shape=(h, w))
    cx, cy = spec.width * spec.cell_size / w, spec.height * spec.cell_size / h
    xx, yy = np.meshgrid(spec.x0 + (np.arange(w) + 0.5) * cx, spec.y0 - (np.arange(h) + 0.5) * cy)
    return xx, yy, z.astype(np.float64), spec


def grid_faces(valid: np.ndarray) -> np.ndarray:
    """Two triangles per grid square whose four corners are valid, as flat vertex indices."""
    h, w = valid.shape
    i, j = np.meshgrid(np.arange(w - 1), np.arange(h - 1))
    a = (j * w + i).ravel()
    ok = (valid[:-1, :-1] & valid[:-1, 1:] & valid[1:, :-1] & valid[1:, 1:]).ravel()
    a = a[ok]
    return np.vstack([np.column_stack([a, a + 1, a + w + 1]), np.column_stack([a, a + w + 1, a + w])])


def write_landxml(path: Path, x, y, z, faces, *, order: str, epsg: int = 32639) -> None:
    """Streams a LandXML 1.2 TIN; `order` is "NEZ" (the rule) or "ENZ" (the exporter mistake)."""
    with path.open("w", encoding="utf-8", newline="\n") as f:
        f.write(
            '<?xml version="1.0" encoding="UTF-8"?>\n'
            '<LandXML xmlns="http://www.landxml.org/schema/LandXML-1.2" version="1.2">\n'
        )
        f.write(
            '<Units><Metric linearUnit="meter" elevationUnit="meter"/></Units>\n'
            f'<CoordinateSystem epsgCode="{epsg}"/>\n'
        )
        f.write('<Surfaces><Surface name="Design"><Definition surfType="TIN"><Pnts>\n')
        for k, (e, n, h) in enumerate(zip(x, y, z, strict=True), start=1):
            a, b = (n, e) if order == "NEZ" else (e, n)
            f.write(f'<P id="{k}">{a:.3f} {b:.3f} {h:.3f}</P>\n')
        f.write("</Pnts><Faces>\n")
        for t in faces + 1:
            f.write(f"<F>{t[0]} {t[1]} {t[2]}</F>\n")
        f.write("</Faces></Definition></Surface></Surfaces>\n</LandXML>\n")


def write_3dface_dxf(path: Path, v: np.ndarray, faces: np.ndarray) -> None:
    doc = ezdxf.new("R2010")
    doc.header["$INSUNITS"] = 6
    msp = doc.modelspace()
    for t in faces:
        msp.add_3dface([tuple(v[i]) for i in t], dxfattribs={"layer": "DESIGN_TIN"})
    doc.saveas(path)


def write_contour_dxf(path: Path, x, y, z, interval: float = 1.0) -> int:
    doc = ezdxf.new("R2010")
    doc.header["$INSUNITS"] = 6
    msp = doc.modelspace()
    gen = contourpy.contour_generator(x, y, np.ma.masked_invalid(z))
    lines = 0
    for level in np.arange(math.floor(np.nanmin(z)), math.ceil(np.nanmax(z)) + interval, interval):
        for line in gen.lines(level):
            if len(line) >= 2:
                msp.add_polyline3d(
                    [(px, py, float(level)) for px, py in line], dxfattribs={"layer": "CONTOURS"}
                )
                lines += 1
    doc.saveas(path)
    return lines


def write_dem_32638(path: Path, x, y, z, spec: grid.GridSpec) -> None:
    src_transform = rasterio.transform.from_origin(
        x[0, 0] - (x[0, 1] - x[0, 0]) / 2,
        y[0, 0] + (y[0, 0] - y[1, 0]) / 2,
        x[0, 1] - x[0, 0],
        y[0, 0] - y[1, 0],
    )
    src_crs, dst_crs = CRS.from_wkt(spec.crs_wkt).to_wkt(), CRS.from_epsg(32638).to_wkt()
    h, w = z.shape
    transform, width, height = calculate_default_transform(
        src_crs, dst_crs, w, h, *rasterio.transform.array_bounds(h, w, src_transform), resolution=DEM_CELL_M
    )
    out = np.full((height, width), np.nan, np.float32)
    reproject(
        z.astype(np.float32),
        out,
        src_transform=src_transform,
        src_crs=src_crs,
        dst_transform=transform,
        dst_crs=dst_crs,
        src_nodata=np.nan,
        dst_nodata=np.nan,
        resampling=Resampling.bilinear,
    )
    with rasterio.open(
        path,
        "w",
        driver="GTiff",
        width=width,
        height=height,
        count=1,
        dtype="float32",
        crs=dst_crs,
        transform=transform,
        nodata=np.nan,
    ) as dst:
        dst.write(out, 1)


def write_perf(path: Path, spec: grid.GridSpec) -> None:
    """1 M points / 2 M faces over 1 x 1 km at the site, for the §16.11 timing."""
    g = np.arange(1000, dtype=np.float64)
    xx, yy = np.meshgrid(spec.x0 + g, spec.y0 - 1000 + g)
    zz = -45.0 + 0.01 * (xx - spec.x0) + 0.005 * (yy - spec.y0)
    faces = grid_faces(np.ones(xx.shape, bool))
    write_landxml(path, xx.ravel(), yy.ravel(), zz.ravel(), faces, order="NEZ", epsg=spec.epsg or 32639)


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--dsm", type=Path, required=True)
    ap.add_argument("--out", type=Path, required=True)
    args = ap.parse_args()
    args.out.mkdir(parents=True, exist_ok=True)
    x, y, z, spec = sample(args.dsm, TIN_STEP_M)
    valid = np.isfinite(z)
    faces = grid_faces(valid)
    v = np.column_stack([x.ravel(), y.ravel(), np.nan_to_num(z.ravel())])
    for order, name in (("NEZ", "site-nez.xml"), ("ENZ", "site-enz.xml")):
        write_landxml(args.out / name, v[:, 0], v[:, 1], v[:, 2], faces, order=order, epsg=spec.epsg or 32639)
    write_3dface_dxf(args.out / "site-3dface.dxf", v, faces)
    lines = write_contour_dxf(args.out / "site-contours.dxf", x, y, z)
    dx, dy, dz, _ = sample(args.dsm, DEM_CELL_M)
    write_dem_32638(args.out / "site-dem-32638.tif", dx, dy, dz, spec)
    write_perf(args.out / "perf-1m.xml", spec)
    print(f"{len(faces):,} TIN faces, {lines:,} contour lines")
    for p in sorted(args.out.iterdir()):
        print(p)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
```

Run from `backend`: `$PY -m ruff check scripts/design_acceptance.py; $PY -m ruff format scripts/design_acceptance.py`
Expected: clean. Then run it against the chimney DSM (Step 3).

- [ ] **Step 2: Write the operator walkthrough**

`docs/usability/2026-09-24-design-surfaces-walkthrough.md`:

```markdown
---
type: walkthrough
date: 2026-09-24
tags: [usability, surfaces, design]
related: ["[[2026-09-23-design-surfaces-design]]"]
---

# How to test: import a design surface

You need a detection project with the chimney cloud imported (Point clouds) and a surface built from
it (Volumes → Build surface). Generate the test designs once, from `backend\` in a terminal:
`.venv\Scripts\python.exe scripts\design_acceptance.py --dsm "<project>\surfaces\<surface id>\surface.tif" --out D:\designs\chimney`.

1. Open **Volumes**. Next to "Build surface", click **Import design surface**.
2. Type `D:\designs\chimney\site-nez.xml` in "Design file" and click **Read file**. A progress bar
   shows "Reading design file", then the Contents section lists the surface "Design" with its counts.
3. Check Placement: the target is your chimney surface, the Source CRS reads `EPSG:32639` with the hint
   "From the file: LandXML <CoordinateSystem epsgCode>", both units are Metre, and the switch hint says
   "LandXML stores northing first — already handled". Click **Preview**.
4. The preview image shows the grey hillshade of the cloud with the amber design over it. "Design on the
   cloud surface" is at least 95 %, and the median height difference is within ±0.2 m.
5. Click **Import surface**. The dialog closes, the new surface appears in the list as building and
   then ready.
6. Import `site-enz.xml` the same way. The preview says the design and the cloud surface don't overlap
   and suggests "With easting/northing swapped the design covers … %". Click **Apply**: a new preview
   runs and the overlap is back above 95 %.
7. Import `site-3dface.dxf`: one layer, DESIGN_TIN, selected, "3D faces" in the counts. Preview and
   import it.
8. Import `site-contours.dxf`: one layer, CONTOURS. The Placement section now shows "Maximum edge
   length (m)" with "automatic". The preview lists "… long triangles were trimmed from the edges" and
   the image shows the notches of the hull trimmed. Import it.
9. Import `site-dem-32638.tif`: the Source CRS reads `EPSG:32638` "From the file: GeoTIFF CRS". The
   preview lands on the chimney surface; import it (the design is re-gridded onto the surface's grid).
10. Pick any file and change "Horizontal units" to "International foot (0.3048 m)": the Preview button
    shows "Preview out of date"; the preview then warns that the other foot moves the design by up to
    … m and offers "Read in Metre …". Close the dialog with **Cancel** — nothing is imported.
11. Type the path of a `.dwg` file: "Read file" answers under the field with "DWG files can't be read …
    save it as DXF".
12. For each imported design, start a **New measurement** over the chimney base with base "Another
    surface" set to that design and **Calculate**: every one runs and reports cut and fill.
```

- [ ] **Step 3: Run the acceptance and record the evidence**

Start the app from this worktree against the real backend (`scripts\dev.ps1 -Mode backend`), follow the walkthrough on the chimney project, and time `perf-1m.xml` (inspect, then a build onto a 5 000 × 5 000 grid: no target, cell 0.2 m) from the Jobs panel. Then write `docs/evidence/design-surfaces/README.md` with the measured values, in this structure (every cell holds a number or text you observed):

```markdown
---
type: report
date: 2026-09-24
tags: [evidence, surfaces, design]
---

# Design surfaces — acceptance evidence

Machine: <CPU, RAM, disk>. Chimney project: <cloud file>, DSM <surface id>, cell <m>, <w> × <h>.

| Step (spec §15.4) | File | Overlap | Median dz | Method | Result |
| --- | --- | --- | --- | --- | --- |
| 1 LandXML N E Z | site-nez.xml | | | tin | |
| 2 LandXML E N Z → Apply swap | site-enz.xml | before / after | | tin | |
| 3a DXF 3D faces | site-3dface.dxf | | | tin | |
| 3b DXF contours (trimmed) | site-contours.dxf | | | delaunay | long edges removed, max edge |
| 4 DEM in EPSG:32638 | site-dem-32638.tif | | | dem_resample | |
| 5 S2 volume against each design | — | — | — | — | cut / fill per design |

| Timing (spec §16.11) | Target | Measured |
| --- | --- | --- |
| Inspect 1 M points / 2 M faces | < 60 s | |
| Build onto 5 000 × 5 000 | < 60 s | |

Measured constants: `QHULL_BYTES_PER_POINT` <value from Task 5>, `DXF_RAM_FACTOR` <value from Task 8>.
```

If a timing misses its target, record it as measured and add the spec's stated fallback (rasterising blocks on a small thread pool, spec §18) to the follow-ups in Step 4 — do not change the code in this task.

- [ ] **Step 4: Ledger entry**

Add a section to `docs/progress.md`, directly above the newest existing section, in the style of the entries there:

```markdown
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

Verified: <the gate results of Step 5, one line each with counts>.

Follow-ups: replace `app/surfaces/design/surface_json.py` with S2's Surface serializer now that V2 is
on main;
<any timing follow-up from Step 3>.
```

- [ ] **Step 5: The full gate, with the overlay interpreter**

Run, from the S3 worktree:

```
pnpm -C contract check
cd backend; .\.venv\Scripts\python.exe -m ruff check .; .\.venv\Scripts\python.exe -m ruff format --check .; .\.venv\Scripts\python.exe -m pytest; cd ..
pnpm -C frontend lint
pnpm -C frontend test
pnpm -C frontend build
pnpm -C frontend e2e
```

and `cargo test --manifest-path frontend/src-tauri/Cargo.toml` only if `frontend/src-tauri/binaries/kestrel-backend-*.exe` exists (it is git-ignored; a fresh worktree skips it). Every command must pass; paste the counts into the progress entry. Rebuilding the frozen sidecar is not part of this task: record in the follow-ups that the next packaging run must pass `smoke_frozen.ps1`'s new `design` step.

- [ ] **Step 6: Commit the docs**

```
git add backend/scripts/design_acceptance.py docs/usability/2026-09-24-design-surfaces-walkthrough.md docs/evidence/design-surfaces/README.md docs/progress.md
git commit -m "docs(design): acceptance on the chimney site, walkthrough, evidence and ledger" -m "Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

- [ ] **Step 7: Finish the branch**

Invoke `superpowers:finishing-a-development-branch` and choose the local merge. Land with `scripts\finish-task.ps1`, normally — no `-SkipGate`: it gates with the shared interpreter, which has F0's packages since F0 landed (F0 plan Task 10 Step 3). If the gate fails only because a package is missing from the shared interpreter, stop and report it to the coordinator; never land with `-SkipGate` to get around it. The script removes the worktree by the junction rule; afterwards confirm `E:\Dev\Yolo\app\backend\.venv\Scripts\python.exe` still exists.

- [ ] **Step 8: Wrap up**

Run `/wrapup` (the `wrapup` skill): it writes the session note in `vault/sessions/` and bumps `vault/00-north-star.md`. Give the operator the walkthrough path from Step 2 as the numbered "how to test this".

---

## Self-review notes (for reviewers)

- **Spec coverage.** §1 done-criteria 1–7 → Tasks 7/13/14 (LandXML), 8/13/14 (DXF faces and contours), 9/11/14 (DEM copy and re-grid), 12/13 (no-overlap, suggestions, gate), 14 (S2 reads the result on its lattice), 2/5/7/8/10/11 (bounded memory and reads). §2 decisions → Tasks 4 (one job, three phases, DWG), 1 (cache, units), 10 (aligned grid, reprojection of vertices), 2 (rasteriser), 5 (Delaunay + peeling), 7 (iterparse), 8 (ezdxf + admission), 13/14 (commit gate, mixed geometry). §3 data model → Tasks 1 (storage), 14 (Surface row, `design_source`, `source.json`). §4 → Tasks 4 (phases, sweep), 13 (preview, cancel superseded), 14 (build, failure cleanup), 1/5/8 (admission). §5 → Task 10. §6 → Tasks 9, 11, 14. §7 → Task 7. §8 → Task 8. §9 → Tasks 2, 5. §10 → Task 12. §11 → Tasks 3, 6, 15. §12 → Tasks 4, 13, 14 (contract written by F0). §13 → Global Constraints. §15 → every task's tests; §15.4 acceptance → Task 17. §16 → criteria 1 (Tasks 2, 14), 2 (Tasks 7, 13), 3 (Tasks 1, 7, 12), 4 (Tasks 10, 14), 5 (Tasks 2, 7, 11), 6 (Task 2), 7 (Task 5), 8 (Task 14), 9 (Task 4), 10 (Tasks 4, 14), 11–12 (Task 17).
- **Type consistency checked:** `inspect_file(path, idir, *, progress, check_cancelled) -> InspectResult` (Tasks 4, 7, 8, 9); `Placement` fields and `resolve(options, fmt, target)` (Tasks 10–14); `internal.json` keys (`insunits`; `nodata`, `sentinel`, `mask`, `scale`, `offset`, `rotated`; `file_size`, `mtime_ns`; preview `output_spec`, `bounds`, `tin`, `max_edge_m`); `TinRasteriser(..., side=)` with `grid.MAX_READ` in the build and `rasterise_to_array` in the preview; `triangulate(points, runs, *, spacing, max_edge_m, auto_floor, …)`.
