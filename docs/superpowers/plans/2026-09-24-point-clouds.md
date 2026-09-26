# Point Clouds (S1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Import a LAS/LAZ point cloud of up to ~200 M points, view it in 3D in the app with true colours, measure points, distances, height differences and plumbness with a stated uncertainty, jump between the orthomosaic and the same spot in 3D, and export a LAZ that QGIS opens in the right place — without ever running the machine out of memory, and with an installer build that refuses to ship a blank viewer.

**Architecture:** A new backend package `app/pointclouds/` turns the source into a display copy: a streamed local work copy (hashed while copying), a chunked laspy scan (bounds, Z stats, class histogram), a header-bounds repair, then the bundled PotreeConverter 2.1.5 (BROTLI) run out of process under a Windows Job Object and a one-at-a-time lock. The octree is served by one Range-aware endpoint restricted to three filenames. The frontend adds a lazy-loaded Clouds screen that embeds potree-core 2.0.15 + three 0.180.0 in a React component with an idle render loop, client-side picking with an uncertainty, a Measure tab whose results the server recomputes and stores, and URL-based jumps to and from the Maps screen. A packaged-webview check drives the release exe over CDP and blocks the installer when the viewer would be blank.

**Tech Stack:** Python 3.11, FastAPI, SQLAlchemy/Alembic (tables from F0), laspy 2.7.0 + lazrs 0.8.2, pyproj 3.7.2, psutil 7.2.2, ctypes (Job Object); PotreeConverter 2.1.5 (bundled as PyInstaller datas); React 18 + TypeScript, potree-core 2.0.15, three 0.180.0, proj4, openapi-fetch; pytest, vitest, Playwright (Prism mock + `page.route`), Playwright over CDP for the packaged exe; PowerShell 5.1 build scripts.

**Spec:** `docs/superpowers/specs/2026-09-23-point-clouds-design.md` (S1). This plan covers every S1 unit **after** F0 (spec §15.2: K1, I1, O1, M1, E1, V1, A1, I2, K2, U1, U2, J1, W1, G). F0 is planned separately in `docs/superpowers/plans/2026-09-24-pointcloud-foundation.md` and is **assumed merged to `main`** before "Before Task 1" starts; what F0 delivers is taken from spec §5.

## Global Constraints

- **F0 is on `main`.** It owns `contract/openapi.yaml` + `schema.d.ts`, the migration, `app/db/models.py`, `app/api.py`, `main.project_opened`, `app/__main__.py`, the dependency pins, `routes.tsx`, the sidebar and the eight job-type places (the six `Record<Job["type"], …>` label maps plus the `resultTarget` and `jobToastText` switches). **No task in this plan edits any of them.** Implementing an S1 endpoint means replacing its 501 stub in `app/pointclouds/router.py` and removing its operationId from `EXPECTED_STUBS` in `backend/tests/test_contract.py` — nothing else in the contract changes.
- **Interpreter.** `$PY` is the worktree-local **overlay venv** that F0 defined (F0 plan Task 1, `vault/decisions/2026-09-24-worktree-overlay-venv-for-new-dependencies.md`): `uv venv` from the shared venv's base Python, one `.pth` file pointing at the shared `site-packages`, and the packages F0 added (laspy, lazrs, ezdxf, openpyxl, et-xmlfile) installed into the overlay too. Nothing is ever installed into the shared `E:\Dev\Yolo\app\backend\.venv` by S1; F0's last task already installed F0's five packages there (operator decision "additive install"), so `scripts\finish-task.ps1` gates S1 normally with the shared interpreter — no `-SkipGate`. The overlay stays for isolation while S1 develops. Every worktree — the integration one and each unit sub-worktree — builds its own overlay with the recipe in "Before Task 1" (about 30 s), and runs backend commands from its own `backend\` folder as `$PY = ".\.venv\Scripts\python.exe"`, so the AGENTS.md gate lines work verbatim. `backend\scripts\build.ps1` gets it through `-Venv <worktree>\backend\.venv`. If CONTRIBUTING.md on `main` gives a different recipe (F0 adds a note there), CONTRIBUTING.md wins.
- **Worktrees.** The S1 integration worktree is `.claude/worktrees/pointclouds` on `task/pointclouds` ("Before Task 1"). Every task runs in its **own** unit sub-worktree cut from the integration branch (two implementers never share one — spec §15.2):
  ```powershell
  $repo = "E:\Dev\Yolo\app"; $u = "pc-t<N>"   # e.g. pc-t5
  git -C "$repo\.claude\worktrees\pointclouds" worktree add "$repo\.claude\worktrees\$u" -b "task/$u" task/pointclouds
  git -C "$repo\.claude\worktrees\$u" config user.name 'Danijel Jovanovic'
  git -C "$repo\.claude\worktrees\$u" config user.email 'info@synapse-solutions.ai'
  pnpm -C "$repo\.claude\worktrees\$u\frontend" install; pnpm -C "$repo\.claude\worktrees\$u\contract" install
  # then build the overlay venv ("Before Task 1" Step 3) with $wt = "$repo\.claude\worktrees\$u"
  ```
  A task is merged by rebasing its branch onto `task/pointclouds` (`git rebase task/pointclouds` in the sub-worktree), re-running its tests plus the full gate, then `git -C "$repo\.claude\worktrees\pointclouds" merge --ff-only task/pc-t<N>`. The sub-worktree is removed with `git worktree remove` using the junction rule of `scripts/finish-task.ps1` (never `rm -rf`), and its branch deleted. Only Task 19 merges `task/pointclouds` to `main`, through `scripts\finish-task.ps1`.
- **Shared files** (edited by more than one task; batch-mates run in separate sub-worktrees and are rebased **in task-number order**): `backend/app/pointclouds/router.py` and `backend/tests/test_contract.py` (Tasks 1, 10, 11, 12, 14); `frontend/src/screens/CloudsScreen.tsx` (Tasks 6 → 13 → 16 → 17, sequential by dependency); `frontend/src/api/clouds.ts` (Tasks 6 → 13); F0's frontend tests `src/screens/foundationScreens.test.tsx`, `src/app/lazyScreens.test.tsx` (Task 6) and `e2e/pointcloud-foundation.spec.ts` (Task 13). Each endpoint task edits `router.py` in exactly two places — one import plus one entry in the `SUB_ROUTERS` tuple, and deleting its own tuples from `STUBS` — and `test_contract.py` in at most two: its operationIds out of `EXPECTED_STUBS` and, where listed below, its entries in `REFUSES_VALID_DATA`. A rebase conflict there is resolved by keeping both sides.
- **The contract test and deliberate refusals.** `tests/test_contract.py::test_responses_conform` sends schema-valid random requests, and schemathesis's positive-data-acceptance check allows only 2xx, 401, 403, 404, 409, 429 and 5xx for them — a 422 or a 416 fails it. Two rules keep S1 green: (1) **error order** — unknown project/cloud/map/file → 404, wrong kind or state → 409, only then body semantics → 422 and Range → 416 — so a random `cloudId` or `path` stops at 404 (a random path is `404 not_found` "point cloud file … not found", exactly as `app/maps/service.py::create_map` does), and the training project the suite uses stops every S1 write at 409 `wrong_project_kind`; (2) for the operations that can still refuse a schema-valid request *by design* (a Range the file cannot satisfy, a point count the kind does not take, an admission refusal, a link without overlap), S1 **adds entries** to F0's `REFUSES_VALID_DATA: dict[str, set[int]]` in `test_contract.py` (F0 defines it empty, wires it and guards it; S1 never redefines it): when such an operation answers one of its listed statuses, only schemathesis's positive-data-acceptance check is skipped — every conformance check still runs, and the error code must not be `validation_error`. Task 10 adds `getPointCloudOctreeFile: {416}`, Task 11 adds `createCloudMeasurement: {422}`, Task 14 adds `createPointCloud`, `inspectPointCloudFile` and `patchPointCloud: {422}`. Nothing else in the contract test is loosened, and F0's guard test requires each entry's status to be declared for that operation in `openapi.yaml` (F0 wrote them from spec §4.1).
- The gate (AGENTS.md §4) passes on every task before it merges into `task/pointclouds`:
  ```
  pnpm -C contract check
  cd backend; & $PY -m ruff check .; & $PY -m ruff format --check .; & $PY -m pytest
  pnpm -C frontend lint
  pnpm -C frontend test
  pnpm -C frontend build
  pnpm -C frontend e2e   # on free ports: set E2E_WEB_PORT / E2E_MOCK_PORT as finish-task.ps1 does
  cargo test --manifest-path frontend/src-tauri/Cargo.toml  # only if frontend/src-tauri/binaries/kestrel-backend-*.exe exists
  ```
  During TDD run the task's own tests; run the full backend suite in at most two sub-worktrees at a time (`vault/decisions/2026-09-21-gotcha-concurrent-gate-runs-may-starve-the-job-runner.md`). Packaging tasks (2, 15, 18) also run `backend\scripts\build.ps1 -Venv …`, `backend\scripts\smoke_frozen.ps1` and `pnpm -C frontend build:installer`.
- **Background jobs** (progress + cancel + restart sweep): `pointcloud_import`, `pointcloud_export`. Everything else is synchronous and bounded (spec §15.1): inspect reads the header and VLRs only (≤ 1 MiB); octree serving uses one file handle, ≤ 64 MiB per response, streamed in 1 MiB chunks; measurement CRUD ≤ 1 000 rows per cloud; picking is client-side.
- **Never in memory:** the point set. Scan and export hold one 2 000 000-point chunk. The Z percentile sample is ≤ 2 000 000 float64. The copy buffer is 64 MiB. One PotreeConverter runs at a time per process.
- **RAM admission:** need = `45 MB × point_count/1e6 + 1 GiB` (MB = 10^6 bytes, GiB = 2^30 bytes) against `psutil.virtual_memory().available`; checked at inspect, at submit, and in the job right before the converter. **Disk admission:** `source_size + 40 B × points + 0.25 × points × record_len + 1 GiB` against the project folder's volume. Messages are shown verbatim; sizes print as `bytes / 1e9` with one decimal and "GB".
- Pinned exact: `potree-core` 2.0.15, `three` 0.180.0 (F0 added them). The CSP gains exactly `worker-src blob:` and nothing else (spec §13).
- Material colour encoding is always `inputColorEncoding = outputColorEncoding = 1` (the white-colour trap).
- UI uses only `frontend/src/ui/` primitives and DESIGN.md "Contour" tokens; `node scripts/check-tokens.mjs` must pass. UI tasks (6, 8, 13, 16, 17) load the design skills first (`impeccable`, `emil-design-eng`) together with `DESIGN.md`.
- Tests are written first and run (TDD). Nothing binary is committed: fixtures come from `tests/pointclouds.py` (`make_las`, `write_fake_octree`, `insert_cloud`) and `frontend/e2e/fixtures/potreeOctree.ts` at test time.
- Stage by path, never `git add -A`. Every commit message ends with a blank line and `Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>`.

## What F0 delivers that this plan consumes (spec §5 — checked in Task 1 Step 1)

| F0 artefact | Name / signature this plan relies on |
| --- | --- |
| Models | `app.db.models.PointCloud` (`point_cloud`, every column of spec §3) and `app.db.models.CloudMeasurement` (`cloud_measurement`); migration `0009`; `id` defaults to `new_id`, `created_at` to `utcnow` |
| Project path | `ProjectHandle.pointclouds_dir` → `<project>/pointclouds` |
| Router | `app/pointclouds/router.py`: `router = APIRouter(prefix="/projects/{projectId}", tags=["pointclouds"])`, `STUBS: list[tuple[str, str, str]]` (method, path, operationId) and `add_stubs(router, STUBS)`; it imports `run_pointcloud_import` / `run_pointcloud_export` from the job modules. `app/api.py` includes it inside a guard with `dependencies=[Depends(require_kind(("detect",), ANY_KIND))]`, so every route in it — and every sub-router included into it — is detection-write / any-read |
| Stub jobs | `app/pointclouds/jobs_import.py::run_pointcloud_import` registers `pointcloud_import`, `jobs_export.py::run_pointcloud_export` registers `pointcloud_export`; each raises `JobFailure("not implemented")` |
| Startup | `app/pointclouds/startup.py::sweep_interrupted(handle, runner) -> list[str]` (no-op), called in its own `try` by `main.project_opened()` |
| Selftest | `__main__.py` dispatches `pointcloud-selftest` to `app.pointclouds.selftest:main(argv)` with `argv[2:]` (placeholder printing "pointcloud-selftest not built", exit 2) |
| Converter seam | `app/pointclouds/converter.py`: `@dataclass(frozen=True) ConverterResult(octree_dir: Path, log_tail: list[str], command: list[str], seconds: float, encoding: str = "BROTLI", version: str = "2.1.5")` and `run_converter(input_path, out_dir, *, progress, check_cancelled) -> ConverterResult` raising `NotImplementedError`; F0's `fake_run_converter` already returns `encoding="DEFAULT"`. I1 keeps the dataclass exactly as F0 defined it (no field added, renamed or re-defaulted) |
| Events | `app.events_util.publish_pointclouds_changed(request, handle, cloud_ids: list[str]) -> None` (nothing is published for an empty list) |
| Test helpers | `tests/pointclouds.py`: `make_las(path, n, *, epsg=32639, rgb=True, compressed=False, header_shrink_mm=0.0, points=None, version="1.2", point_format=3) -> Path` (default points: a 10 × 10 × 5 m box at `ORIGIN = (553100, 2847300, -45)`, classification 2, red west / green east); `write_fake_octree(points (n, 3), out_dir, *, rgb=None (uint16 (n, 3)), scale=0.001) -> Path` (DEFAULT encoding); `read_fake_octree`, `read_header_bounds`, `default_points`, `west_red_east_green`; `fake_run_converter(input_path, out_dir, *, progress, check_cancelled) -> ConverterResult`, which the `app` fixture installs with `monkeypatch.setattr("app.pointclouds.converter.run_converter", fake_run_converter)` — so every caller must look the seam up **at call time** |
| CORS | `allow_headers=["Authorization", "Content-Type", "Range"]`, `expose_headers=["Content-Range", "Accept-Ranges", "Content-Length"]` (tested in `tests/test_cors.py`) |
| Client | `contract/client/index.ts::cloudOctreeUrl(baseUrl, projectId, cloudId) -> string` — `…/octree/metadata.json` **without** a token (F0 deviation 5; the RequestManager adds it) — and the generated `components["schemas"]["PointCloudOut" …]` |
| Frontend | `src/app/lazyScreens.tsx` lazy-loads `CloudsScreen` and `AboutScreen` (named exports in `src/screens/`); routes `p/:projectId/clouds`, `p/:projectId/clouds/:cloudId` (detection-only `KindRoute`) and `/about`; F0's empty screens show the headings "Point clouds" and "About Kestrel AI", which F0's `foundationScreens.test.tsx`, `lazyScreens.test.tsx` and `e2e/pointcloud-foundation.spec.ts` assert; the rail shows **Point clouds** after Site areas in a detection project; icons `cloud`, `volume`; the eight job-type places; the "About Kestrel AI" link on App settings |

If a name differs on `main`, the task that consumes it adapts its own call site and says so in its commit message; it never changes the F0 file's public shape (S2 and S3 build on it too).

## Review Focus

1. **Paths with spaces or non-ASCII characters.** The operator's real file is `…\Chimney stack 3D\…\Chimney stack 3D_group1_densified_point_cloud.las`, and project folders can hold Arabic or accented names. PotreeConverter is a C++ exe with narrow-string argv. Expected: the import works. Pinned by Task 5 (the converter always runs with `cwd=.work` and the relative ASCII arguments `input.las -o octree`) and Task 9 (an import from a source folder named `Chimney stack 3D — Kuwait/جديد` through the fake converter).
2. **The source goes away mid-copy** (the NAS drops, the USB disk is unplugged). Expected: the import fails with "could not read the source file: <path> (<reason>)", `.work` is gone, the cloud is `failed`. Pinned by Task 3 (a reader that raises `OSError` half-way) and Task 9 (the cleanup).
3. **The project drive fills up during the import** even though admission passed. Expected: "the project drive is full; free some space and import again", `.work` and any partial `octree/` removed. Pinned by Task 3 (`OSError(errno.ENOSPC)` from the writer) and Task 9.
4. **A cloud in a geographic CRS** (EPSG:4326, degrees). A "distance" in degrees is nonsense that looks like a number. Expected: Point measurements work; Distance, Height difference and Vertical check are refused with 422 `needs_projected_crs` ("distances need a projected coordinate system; this cloud is in degrees"), and the Measure tab says so before a pick is made. Pinned by Task 11 and Task 16.
5. **The 3D view copy is missing on disk** (the operator cleaned the project folder by hand, or deleted the cloud in another window while the viewer was open). Expected: the octree endpoint answers `404 octree_missing` ("the 3D view copy is missing; import the file again"), and the viewer shows that message in an `Alert` instead of a blank canvas. Pinned by Task 10 and Task 6.

## Decisions made while planning (recorded so reviewers do not flag them)

1. **Export folder.** The spec names `<project>/exports/<stamp>-cloud-<name>/`, but the shared `_reserve_partial_folder`/`_promote` helpers in `app/exports/job.py` (which the partial-export sweep relies on) produce `exports/<stamp>[_n]/`. The export reuses them unchanged; the files inside are `cloud-<slug>.laz`, `cloud-<slug>.json` and `cloud-<slug>-measurements.csv` — the deviation the maps plan made too (maps plan, deviation 5).
2. **Validation encoding.** Spec §6.8 requires `encoding == "BROTLI"`, but the F0 fake converter writes a `DEFAULT` octree (potree-core renders it without brotli). F0's `ConverterResult` carries `encoding: str = "BROTLI"` (and F0's fake reports `"DEFAULT"`); validation compares `metadata.json`'s encoding with the encoding the converter reports. The real converter is always run with `--encoding BROTLI`, so production behaviour is exactly the spec's.
3. **Link at create.** `PointCloudCreate.map_id` is validated at create time against the file's header CRS and header bounds (the cloud has no scanned bounds yet). A later `patchPointCloud` validates against the scanned bounds.
4. **Vertical check storage.** `points` are stored lower-first (sorted by Z), so `measurements.csv` columns x1/y1/z1 are always the base.
5. **Result fields per kind.** `point`: `lon`, `lat` (null without CRS), `uncertainty_m`. `distance` and `height`: `dx`, `dy`, `dz`, `distance_3d`, `distance_horizontal`, `distance_vertical`, `height_difference`, `uncertainty_m`. `vertical`: all of those plus `lean_offset_m`, `lean_angle_deg`, `lean_azimuth_deg`, `lean_mm_per_m`, `angle_uncertainty_deg`. Every other field is null.
6. **lon/lat are not in the shared vectors.** proj4js and PROJ agree to ~1e-9° but not reliably tighter; the vectors pin the geometry to 1e-9, and a separate test pins lon/lat to 1e-7° against pyproj.
7. **The diagnostics hook gains two read-only readings:** `stats().cameraDistance` (metres from the camera to the orbit target, so the acceptance can prove the "≤ 30 m range" of spec §17.10) and `overlays()` (the keys of the overlays drawn, so e2e can see the jump pin). It changes nothing in the view.
8. **Admission display.** 195 274 656 points need 9 861 101 344 bytes, printed "9.9 GB" (spec §17.3 says "about 9.8 GB"; the formula is the spec's).
9. **Converter invocation.** `PotreeConverter.exe input.<ext> -o octree --encoding BROTLI` with `cwd=<cloud>/.work` — relative ASCII arguments only (Review Focus 1).
10. **Geographic clouds** refuse two-point measurements (Review Focus 4).
11. **Missing octree files** on a `ready` cloud answer `404 octree_missing` (Review Focus 5).
12. **Project kind.** F0 includes the pointclouds router with `require_kind(("detect",), ANY_KIND)`; S1's sub-routers inherit it. S1 tests create a `detect` project (`project_kind` fixture); the contract test's training project gets 409 on every S1 write, which the positive-data check accepts.
13. **Playwright + WebGL.** Headless Chromium no longer falls back to SwiftShader for WebGL on its own; Task 6 adds `--use-angle=swiftshader --enable-unsafe-swiftshader` to `playwright.config.ts` `launchOptions`.
14. **CDP driver import.** The packaged check imports `chromium` from `@playwright/test` (a direct dev dependency), not `playwright-core` (a transitive one pnpm does not hoist).
15. **MSVC runtime.** The fetch script takes the newest `VC\Redist\MSVC\*\x64\Microsoft.VC14*.CRT` it finds (or `-CrtDir`), then **runs** `PotreeConverter.exe --help` from the payload folder: DLLs next to an exe load before System32, so a too-old redist fails there instead of on the operator's machine.
16. **"Import again"** on a failed cloud creates a new cloud from the same path and name, then deletes the failed row.

## File map

**Backend: `backend/app/pointclouds/` (F0 created the package, `router.py`, `startup.py`, `selftest.py`, `jobs_import.py`, `jobs_export.py`, `converter.py`)**

| File | Task | Responsibility |
| --- | --- | --- |
| `schemas.py` | 1 | pydantic models mirroring the contract |
| `rows.py` | 1 | `cloud_dir`, `octree_dir`, `work_dir`, `get_cloud`, `require_ready` |
| `converter_path.py` | 2 | where `PotreeConverter.exe` is (frozen / dev / env) |
| `lasbounds.py` | 3 | header bounds at byte 179: read, write, widen |
| `admission.py` | 3 | RAM + disk admission, seams `available_ram`, `free_disk` |
| `workcopy.py` | 3 | streamed copy + sha256, header repair |
| `crs.py`, `lasfile.py`, `scan.py` | 4 | CRS + WGS84 bounds; header-only inspection; chunked scan |
| `winjob.py`, `converter.py`, `validate.py` | 5 | Job Object; the runner (replaces F0's seam body); output checks |
| `importer.py` | 9 | `import_cloud`: the pure pipeline + `source.json` |
| `octree.py`, `routes_octree.py` | 10 | Range parsing and streaming; the octree route |
| `measure.py`, `measurements.py`, `routes_measurements.py` | 11 | formulas; CRUD; routes |
| `export.py`, `routes_export.py` | 12 | LAZ writer + sidecars; export route; `jobs_export.py` body |
| `service.py`, `routes_clouds.py` | 14 | cloud CRUD, link rules, inspect/create; routes; `jobs_import.py` and `startup.py` bodies |
| `selftest.py` | 15 | `pointcloud-selftest` and `--write-fixture` |

**Backend: modified shared files** — `app/pointclouds/router.py` (1, 10, 11, 12, 14), `tests/test_contract.py` (10, 11, 12, 14), `tests/pointclouds.py` (1), `app/maps/service.py` (14), `pyproject.toml` (9), `kestrel_backend.spec` and `scripts/build.ps1` (2), `scripts/smoke_frozen.ps1` (15), `.gitignore` (2).

**Backend: new scripts** — `scripts/fetch_potreeconverter.ps1`, `scripts/check_potree_payload.ps1` (2); `scripts/make_test_ortho.py`, `scripts/check_picks.py`, `scripts/make_tiled_cloud.py`, `scripts/pointcloud_acceptance.py` (7).

**Backend tests (new)** — `test_pointcloud_schemas.py` (1), `test_pointcloud_converter_path.py` (2), `test_pointcloud_admission.py`, `test_pointcloud_workcopy.py` (3), `test_pointcloud_crs.py`, `test_pointcloud_lasfile.py`, `test_pointcloud_scan.py` (4), `fake_potreeconverter.py`, `test_pointcloud_converter.py`, `test_pointcloud_validate.py` (5), `test_pointcloud_scripts.py` (7), `test_about_versions.py` (8), `test_pointcloud_importer.py` (9), `test_pointcloud_octree.py` (10), `test_pointcloud_measure.py`, `test_pointcloud_measurements_api.py` (11), `test_pointcloud_export.py` (12), `test_pointcloud_api.py`, `test_pointcloud_startup.py` (14), `test_pointcloud_selftest.py` (15).

**Contract** — `contract/fixtures/cloud-measure-vectors.json` (11). `openapi.yaml` and `schema.d.ts` are not touched.

**Frontend (new)** — `src/clouds/viewer/{requestManager,materialOptions,budget,uncertainty,camera,idle,overlay,diagnostics}.ts` (+tests) and `src/clouds/CloudViewer.tsx` (6); `src/api/clouds.ts` (6, 13); `src/clouds/{format,link}.ts`, `CloudList.tsx`, `ImportCloudDialog.tsx`, `CloudDetails.tsx`, `ViewPanel.tsx` (13); `src/api/cloudMeasurements.ts`, `src/clouds/{measure,readout,measureCsv}.ts`, `useMeasureTool.ts`, `MeasurePanel.tsx` (16); `src/clouds/jump.ts`, `useJumpArrival.ts`, `src/maps/MapContextMenu.tsx`, `src/maps/useAtMarker.ts` (17); `src/about/notices.json`, `src/about/notices.ts`, `src/about/licences/*.txt` (8); `e2e/fixtures/potreeOctree.ts`, `e2e/fixtures/clouds.ts` (6); `e2e/clouds.spec.ts` (6, 13, 16, 17), `e2e/about.spec.ts` (8); `scripts/check-packaged-webview.{ps1,mjs}` (18), `scripts/measure-cloud-viewer.mjs` (19).

**Frontend (modified)** — `src/screens/CloudsScreen.tsx` (6, 13, 16, 17), F0's `src/screens/foundationScreens.test.tsx` and `src/app/lazyScreens.test.tsx` (6), F0's `e2e/pointcloud-foundation.spec.ts` (13), `src/screens/AboutScreen.tsx` (8), `src/screens/MapsScreen.tsx` (17), `src/ui/Segmented.tsx` (13), `src/ui/useJobToasts.ts` (13), `playwright.config.ts` (6), `src-tauri/tauri.conf.json`, `src/app/csp.test.ts`, `package.json` scripts, `scripts/build-installer.ps1` (18).

**Docs / vault** — `vault/decisions/2026-09-23-potreeconverter-in-the-frozen-sidecar.md` (15), `vault/decisions/2026-09-23-gotcha-packaged-webview-needs-worker-src-blob.md` (18), `docs/usability/2026-09-24-point-clouds-walkthrough.md`, `docs/progress.md`, `docs/evidence/2026-09-24-point-clouds/` (19).

## Budget and execution DAG

> **Execution note (cross-plan).** Prerequisite: F0 (`2026-09-24-pointcloud-foundation.md`) merged to `main`. S3 Tasks 9–14 additionally need S2 Task 1 (`app/surfaces/grid.py`, V1) on `main` (S3 Tasks 9–12 depend on it directly, 13–14 through them); S3 Tasks 15–16 need S2 Task 15 (the Volumes screen surface list, V7); S3 Task 17 needs S1 Task 14 (import, I2) and S2 Tasks 2 and 9 (surface build, V2), 11 (volume calculation, V5) and 16 (the Volumes UI, V8) on `main`. Only S2 Task 1 merges to `main` early; the other S2 tasks reach `main` with S2 Task 17, and S1 Task 14 with S1 Task 19, unless the coordinator lands them sooner.

**Budget** — spec §15.1, restated in Global Constraints. Measured targets (spec §17): chimney import ≤ 60 s from local SSD; 195 M import ≤ 5 min, converter peak RSS ≤ 10 GB, backend RSS growth ≤ 1 GB; LAZ export ≤ 30 s (chimney) / ≤ 3 min (195 M); viewer first points ≤ 1 s, settled ≤ 5 s, orbit p50 frame ≤ 20 ms, webview peak ≤ 2.5 GB at 3 M and ≤ 3 GB at 8 M.

**DAG.** A task starts as soon as every task it depends on is merged into `task/pointclouds`; the batch column is its depth, for planning — do not wait for a whole batch.

| Task | Unit (spec §15.2) | Depends on | Batch | Shared files touched |
| --- | --- | --- | --- | --- |
| 1 Scaffold: schemas, rows, sub-router block | (new: shared code split out of O1/M1/E1/I2) | F0 | B1 | `router.py` (adds `SUB_ROUTERS`), `tests/pointclouds.py` |
| 2 Converter payload | K1 | F0 | B1 | `kestrel_backend.spec`, `build.ps1`, `.gitignore` |
| 3 Admission, work copy, header bounds | I1 (a) | F0 | B1 | — |
| 4 Header inspection, scan, CRS | I1 (b) | F0 | B1 | — |
| 5 Converter runner + validation | I1 (c) | F0 | B1 | — (F0's `fake_run_converter` already reports its encoding) |
| 6 CloudViewer + e2e octree fixture | V1 | F0 | B1 | `CloudsScreen.tsx` (minimal), `api/clouds.ts`, `playwright.config.ts`, F0's `foundationScreens.test.tsx` + `lazyScreens.test.tsx` |
| 7 Acceptance tools | (for G: spec §1, §17.9, §17.12) | F0 | B1 | — |
| 8 About screen | A1 | 2 | B2 | — |
| 9 Importer pipeline | I1 (d) | 2, 3, 4, 5 | B2 | `pyproject.toml` |
| 10 Octree endpoint | O1 | 1 | B2 | `router.py`, `test_contract.py` (first `REFUSES_VALID_DATA` entry) |
| 11 Measurements | M1 | 1 | B2 | `router.py`, `test_contract.py` |
| 12 LAZ export | E1 | 1, 3 | B2 | `router.py`, `test_contract.py` |
| 13 Clouds screen | U1 | 6 | B2 | `CloudsScreen.tsx`, `api/clouds.ts`, `ui/Segmented.tsx`, `ui/useJobToasts.ts`, F0's `e2e/pointcloud-foundation.spec.ts` |
| 14 Import job + cloud routes | I2 | 1, 9 | B3 | `router.py`, `test_contract.py`, `app/maps/service.py` |
| 15 Selftest + frozen smoke + converter ADR | K2 | 2, 9, 12 | B3 | `smoke_frozen.ps1` |
| 16 Measure tab | U2 | 6, 11, 13 | B3 | `CloudsScreen.tsx` |
| 17 Map ↔ 3D jumps | J1 | 13, 16 | B4 | `CloudsScreen.tsx`, `MapsScreen.tsx` |
| 18 CSP, packaged-webview check, CSP ADR | W1 | 6, 10, 13, 14, 15 | B4 | `tauri.conf.json`, `csp.test.ts`, `package.json`, `build-installer.ps1` |
| 19 Acceptance, docs, merge | G | all | B5 | `docs/progress.md` |

- **Parallel batches:** {1, 2, 3, 4, 5, 6, 7} → {8, 9, 10, 11, 12, 13} → {14, 15, 16} → {17, 18} → {19}.
- **Critical path:** F0 → 5 (converter runner) → 9 (importer) → 15 (selftest, frozen build) → 18 (packaged check, release build) → 19. Task 14 joins it at 18.
- **Near-critical:** F0 → 6 → 13 → 16 → 17 → 19.
- **Slack:** 1, 2, 3, 4, 7, 8, 10, 11, 12.
- **Rebase order for shared files:** 1 → 10 → 11 → 12 → 14 (router + `test_contract.py`); 6 → 13 → 16 → 17 (CloudsScreen).
- Nothing in S1 waits on S2 or S3 (spec §15.3).

---

## Before Task 1: the S1 integration worktree and its interpreter

- [ ] **Step 1: Confirm F0 is on `main`**

Run: `git -C E:\Dev\Yolo\app log --oneline -1 -- backend/app/pointclouds/router.py`
Expected: one F0 commit. Then `Select-String -Path E:\Dev\Yolo\app\backend\tests\test_contract.py -Pattern "getPointCloudOctreeFile|createCloudMeasurement|createPointCloudExport"` shows all three inside `EXPECTED_STUBS`, and `Select-String -Path E:\Dev\Yolo\app\backend\tests\test_contract.py -Pattern "REFUSES_VALID_DATA"` shows F0's empty `REFUSES_VALID_DATA: dict[str, set[int]] = {}` and its guard test. If either is missing, stop: F0 is not merged.

- [ ] **Step 2: Cut the integration worktree**

Run: `E:\Dev\Yolo\app\scripts\start-task.ps1 pointclouds`
Expected: "worktree ready on task/pointclouds" at `E:\Dev\Yolo\app\.claude\worktrees\pointclouds`.

- [ ] **Step 3: Build the overlay venv** (the recipe of F0 plan Task 1 Step 2; run it in every worktree this plan creates)

```powershell
$wt = "E:\Dev\Yolo\app\.claude\worktrees\pointclouds"   # or the unit sub-worktree
$shared = "E:\Dev\Yolo\app\backend\.venv"
$base = ((Get-Content "$shared\pyvenv.cfg" | Where-Object { $_ -like 'home = *' }) -replace '^home = ', '').Trim()
uv venv --python "$base\python.exe" "$wt\backend\.venv"
Set-Content -Encoding ascii -Path "$wt\backend\.venv\Lib\site-packages\_kestrel_shared_venv.pth" -Value "$shared\Lib\site-packages"
uv pip install --python "$wt\backend\.venv\Scripts\python.exe" --no-deps laspy==2.7.0 lazrs==0.8.2 ezdxf==1.4.4 openpyxl==3.1.5 et-xmlfile==2.0.0
cd "$wt\backend"; $PY = ".\.venv\Scripts\python.exe"
& $PY -c "import laspy, lazrs, psutil, numpy, pytest; print(laspy.__version__, psutil.__version__, numpy.__file__)"
@(Get-ChildItem "$wt\backend\.venv" -Recurse -Force -Directory | Where-Object LinkType).Count
& $PY -m pytest -q
```

Expected: `2.7.0 7.2.2 E:\Dev\Yolo\app\backend\.venv\Lib\site-packages\numpy\__init__.py`, a link count of `0` (the overlay is a real folder), then the suite passes on the fresh `main` with the 12 S1 operations answering 501 and listed in `EXPECTED_STUBS`. Keep the `uv pip install` line even though F0 installed its packages into the shared venv: the local copies win and the overlay must not depend on the shared one.

- [ ] **Step 4: Tell the operator**

One line in the session: "S1 runs in `.claude/worktrees/pointclouds` with an overlay venv; unit tasks use sub-worktrees `.claude/worktrees/pc-t<N>`, each with its own overlay."

---

### Task 1: Scaffold — schemas, row helpers, the sub-router block

Shared code that Tasks 10, 11, 12 and 14 would otherwise each create at the same time. No endpoint is implemented here.

**Files:**
- Create: `backend/app/pointclouds/schemas.py`
- Create: `backend/app/pointclouds/rows.py`
- Modify: `backend/app/pointclouds/router.py` (append the `SUB_ROUTERS` block)
- Modify: `backend/tests/pointclouds.py` (append `insert_cloud`)
- Test: `backend/tests/test_pointcloud_schemas.py`

**Interfaces:**
- Consumes (F0): `PointCloud`, `CloudMeasurement`, `ProjectHandle.pointclouds_dir`, `router`, `STUBS`, `make_las`, `write_fake_octree`.
- Produces:
  - `app.pointclouds.schemas`: `PointCloudZStats`, `PointCloudOut.from_row(row) -> PointCloudOut`, `PointCloudList`, `PointCloudCreate`, `PointCloudWithJob`, `PointCloudPatch`, `PointCloudInspectRequest`, `PointCloudAdmission`, `PointCloudFileInfo`, `CloudMeasurementKind`, `CloudMeasurementPoint`, `CloudMeasurementCreate`, `CloudMeasurementUpdate`, `CloudMeasurementResults`, `CloudMeasurementOut.from_row(row)`, `CloudMeasurementList`, `PointCloudExportRequest`.
  - `app.pointclouds.rows`: `cloud_dir(handle, cloud_id) -> Path`, `octree_dir(handle, cloud_id) -> Path`, `work_dir(handle, cloud_id) -> Path`, `get_cloud(handle, cloud_id) -> PointCloud` (404 `not_found`), `require_ready(handle, cloud_id) -> PointCloud` (409 `not_ready`), `OCTREE_FILES = ("metadata.json", "hierarchy.bin", "octree.bin")`.
  - `app.pointclouds.router.SUB_ROUTERS: tuple[APIRouter, ...]` — later tasks add their sub-router here.
  - `tests.pointclouds.insert_cloud(handle, **fields) -> str` — a `ready` cloud row with realistic defaults.

- [ ] **Step 1: Check the F0 surface this plan consumes**

Run from the task worktree's `backend\` folder:

```powershell
& $PY -c "from app.db.models import PointCloud, CloudMeasurement; from app.pointclouds import router, converter, startup, selftest, jobs_import, jobs_export; from app.events_util import publish_pointclouds_changed; import dataclasses, inspect; print(inspect.signature(converter.run_converter)); print([f.name for f in dataclasses.fields(converter.ConverterResult)]); print(inspect.signature(publish_pointclouds_changed)); print(sorted(c.name for c in PointCloud.__table__.columns)); print(sorted(c.name for c in CloudMeasurement.__table__.columns)); print([t[2] for t in router.STUBS])"
& $PY -c "import sys; sys.path.insert(0, 'tests'); import pointclouds, inspect; print(inspect.signature(pointclouds.make_las)); print(inspect.signature(pointclouds.write_fake_octree)); print(inspect.signature(pointclouds.fake_run_converter))"
Select-String -Path app\api.py -Pattern 'app.pointclouds.router', 'require_kind\(\("detect",\), ANY_KIND\)'
```

Expected: `run_converter(input_path, out_dir, *, progress, check_cancelled)`; `['octree_dir', 'log_tail', 'command', 'seconds', 'encoding', 'version']`; `publish_pointclouds_changed(request, handle, cloud_ids)`; `point_cloud` has every column of spec §3 (including `error`, `source_mtime`, `scale`, `proj4`, `vertical_crs`, `crs_source`, `bounds_repaired`, `class_counts`, `octree_bytes`); `STUBS` lists the 12 S1 operationIds; `write_fake_octree(points, out_dir, *, rgb=None, scale=0.001)`; and `api.py` includes the router with the detect/any-kind guard. Any difference is recorded in this task's commit message, and the consuming task adapts its call site (see "What F0 delivers").

- [ ] **Step 2: Write the failing tests**

`backend/tests/test_pointcloud_schemas.py`:

```python
"""S1 scaffold: the pydantic models mirror the contract, and the row helpers answer 404/409."""

from pathlib import Path

import pytest
import yaml
from pointclouds import insert_cloud

from app.errors import AppError
from app.pointclouds import rows, schemas

SPEC = Path(__file__).resolve().parents[2] / "contract" / "openapi.yaml"
NAMES = [
    "PointCloudOut",
    "PointCloudZStats",
    "PointCloudList",
    "PointCloudCreate",
    "PointCloudWithJob",
    "PointCloudPatch",
    "PointCloudInspectRequest",
    "PointCloudFileInfo",
    "PointCloudAdmission",
    "CloudMeasurementPoint",
    "CloudMeasurementCreate",
    "CloudMeasurementUpdate",
    "CloudMeasurementResults",
    "CloudMeasurementOut",
    "CloudMeasurementList",
    "PointCloudExportRequest",
]


@pytest.fixture
def project_kind() -> str:
    return "detect"


@pytest.mark.parametrize("name", NAMES)
def test_every_schema_has_exactly_the_contract_fields(name):
    contract = yaml.safe_load(SPEC.read_text("utf-8"))["components"]["schemas"][name]
    assert set(getattr(schemas, name).model_fields) == set(contract.get("properties", {}))


def test_point_cloud_out_from_row(handle):
    cloud_id = insert_cloud(handle, name="Chimney", point_count=21_697_184)
    out = schemas.PointCloudOut.from_row(rows.get_cloud(handle, cloud_id))
    assert out.name == "Chimney" and out.point_count == 21_697_184
    assert out.z_stats is not None and out.z_stats.p50 == pytest.approx(12.0)
    assert out.crs_source == "file" and out.scale == [0.001, 0.001, 0.001]


def test_unknown_cloud_is_404(handle):
    with pytest.raises(AppError) as e:
        rows.get_cloud(handle, "nope")
    assert e.value.status == 404 and e.value.code == "not_found"


def test_importing_cloud_is_not_ready(handle):
    cloud_id = insert_cloud(handle, status="importing")
    with pytest.raises(AppError) as e:
        rows.require_ready(handle, cloud_id)
    assert (e.value.status, e.value.code) == (409, "not_ready")


def test_cloud_folders(handle):
    assert rows.cloud_dir(handle, "c1") == handle.folder / "pointclouds" / "c1"
    assert rows.octree_dir(handle, "c1").name == "octree"
    assert rows.work_dir(handle, "c1").name == ".work"
```

- [ ] **Step 3: Run them to verify they fail**

Run: `cd backend; & $PY -m pytest tests/test_pointcloud_schemas.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'app.pointclouds.schemas'` (collection error).

- [ ] **Step 4: Write `schemas.py`**

`backend/app/pointclouds/schemas.py`:

```python
"""Pydantic models for point clouds, matching contract/openapi.yaml exactly (spec §4.2)."""

from __future__ import annotations

from datetime import date, datetime
from typing import Literal

from pydantic import BaseModel, Field

from app.db.models import CloudMeasurement, PointCloud
from app.jobs.schemas import JobOut

CloudMeasurementKind = Literal["point", "distance", "height", "vertical"]


class PointCloudZStats(BaseModel):
    min: float
    max: float
    mean: float
    p01: float
    p1: float
    p5: float
    p50: float
    p95: float
    p99: float
    p999: float
    sample_count: int


class PointCloudOut(BaseModel):
    id: str
    name: str
    status: Literal["importing", "ready", "failed"]
    error: str | None
    source_path: str
    source_size: int
    source_sha256: str | None
    las_version: str | None
    point_format: int | None
    point_count: int | None
    has_rgb: bool | None
    scale: list[float] | None
    crs_wkt: str | None
    epsg: int | None
    proj4: str | None
    vertical_crs: str | None
    crs_source: Literal["file", "assigned"] | None
    bounds_native: list[float] | None
    bounds_repaired: bool | None
    bounds_wgs84: list[float] | None
    octree_spacing_m: float | None
    z_stats: PointCloudZStats | None
    class_counts: dict[str, int] | None
    octree_bytes: int | None
    captured_on: date | None
    map_id: str | None
    job_id: str | None
    created_at: datetime

    @classmethod
    def from_row(cls, row: PointCloud) -> PointCloudOut:
        values = {name: getattr(row, name) for name in cls.model_fields}
        values["source_sha256"] = values["source_sha256"] or None  # "" until the import hashed it
        return cls(**values)


class PointCloudList(BaseModel):
    items: list[PointCloudOut]


class PointCloudCreate(BaseModel):
    path: str = Field(min_length=1)
    name: str | None = Field(default=None, min_length=1, max_length=200)
    map_id: str | None = None


class PointCloudWithJob(BaseModel):
    cloud: PointCloudOut
    job: JobOut


class PointCloudPatch(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=200)
    captured_on: date | None = None
    map_id: str | None = None
    assign_epsg: int | None = None


class PointCloudInspectRequest(BaseModel):
    path: str = Field(min_length=1)


class PointCloudAdmission(BaseModel):
    ok: bool
    ram_needed_bytes: int
    ram_available_bytes: int
    disk_needed_bytes: int
    disk_available_bytes: int
    reason: str | None


class PointCloudFileInfo(BaseModel):
    path: str
    size: int
    compressed: bool
    las_version: str
    point_format: int
    point_count: int
    has_rgb: bool
    header_bounds: list[float]
    crs_wkt: str | None
    epsg: int | None
    captured_on: date | None
    admission: PointCloudAdmission


class CloudMeasurementPoint(BaseModel):
    x: float
    y: float
    z: float
    uncertainty_m: float = Field(ge=0)


class CloudMeasurementCreate(BaseModel):
    kind: CloudMeasurementKind
    points: list[CloudMeasurementPoint] = Field(min_length=1, max_length=2)
    name: str | None = Field(default=None, min_length=1, max_length=200)
    note: str | None = Field(default=None, max_length=2000)


class CloudMeasurementUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=200)
    note: str | None = Field(default=None, max_length=2000)


class CloudMeasurementResults(BaseModel):
    lon: float | None = None
    lat: float | None = None
    dx: float | None = None
    dy: float | None = None
    dz: float | None = None
    distance_3d: float | None = None
    distance_horizontal: float | None = None
    distance_vertical: float | None = None
    height_difference: float | None = None
    lean_offset_m: float | None = None
    lean_angle_deg: float | None = None
    lean_azimuth_deg: float | None = None
    lean_mm_per_m: float | None = None
    uncertainty_m: float | None = None
    angle_uncertainty_deg: float | None = None


class CloudMeasurementOut(BaseModel):
    id: str
    point_cloud_id: str
    kind: CloudMeasurementKind
    name: str
    note: str | None
    points: list[CloudMeasurementPoint]
    results: CloudMeasurementResults
    created_at: datetime
    updated_at: datetime

    @classmethod
    def from_row(cls, row: CloudMeasurement) -> CloudMeasurementOut:
        return cls(**{name: getattr(row, name) for name in cls.model_fields})


class CloudMeasurementList(BaseModel):
    items: list[CloudMeasurementOut]


class PointCloudExportRequest(BaseModel):
    format: Literal["laz"]
    include_measurements: bool = True
```

- [ ] **Step 5: Write `rows.py`**

`backend/app/pointclouds/rows.py`:

```python
"""Where a point cloud lives on disk, and its row with the 404/409 every route needs (spec §3, §7)."""

from __future__ import annotations

from pathlib import Path

from app.db.models import PointCloud
from app.errors import AppError, not_found
from app.projects.service import ProjectHandle

OCTREE_FILES = ("metadata.json", "hierarchy.bin", "octree.bin")


def cloud_dir(handle: ProjectHandle, cloud_id: str) -> Path:
    return handle.pointclouds_dir / cloud_id


def octree_dir(handle: ProjectHandle, cloud_id: str) -> Path:
    return cloud_dir(handle, cloud_id) / "octree"


def work_dir(handle: ProjectHandle, cloud_id: str) -> Path:
    return cloud_dir(handle, cloud_id) / ".work"


def get_cloud(handle: ProjectHandle, cloud_id: str) -> PointCloud:
    with handle.session() as s:
        row = s.get(PointCloud, cloud_id)
        if row is None:
            raise not_found("point cloud", cloud_id)
        s.expunge(row)
    return row


def require_ready(handle: ProjectHandle, cloud_id: str) -> PointCloud:
    row = get_cloud(handle, cloud_id)
    if row.status != "ready":
        raise AppError("not_ready", f"point cloud {row.name} is {row.status}, not ready", 409)
    return row
```

- [ ] **Step 6: Add the sub-router block to `router.py`**

Append at the end of `backend/app/pointclouds/router.py`, after `add_stubs(router, STUBS)`:

```python
# S1 units land their operations as sub-routers (plan 2026-09-24-point-clouds): each one removes
# its tuples from STUBS above and adds its router here. They inherit this router's prefix, tag and
# project-kind guard.
SUB_ROUTERS: tuple[APIRouter, ...] = ()

for _sub in SUB_ROUTERS:
    router.include_router(_sub)
```

The kind guard is not repeated here: `app/api.py` includes `router` with `require_kind(("detect",), ANY_KIND)`, and FastAPI copies an including router's dependencies onto every route it includes, sub-routers' routes too. `tests/test_project_kinds.py` (which walks every route) proves it once Task 10 adds the first sub-router.

- [ ] **Step 7: Add `insert_cloud` to the test helpers**

Append to `backend/tests/pointclouds.py`:

```python
def insert_cloud(handle, **fields) -> str:
    """A point_cloud row (ready by default) with the chimney's shape; `fields` override any column."""
    from pyproj import CRS

    from app.db.models import PointCloud

    crs = CRS.from_epsg(32639)
    values = dict(
        name="Cloud",
        status="ready",
        error=None,
        source_path=str(handle.folder / "source.las"),
        source_size=0,
        source_sha256="",
        source_mtime=0.0,
        las_version="1.2",
        point_format=3,
        point_count=1000,
        has_rgb=True,
        scale=[0.001, 0.001, 0.001],
        crs_wkt=crs.to_wkt(),
        epsg=32639,
        proj4=crs.to_proj4(),
        vertical_crs=None,
        crs_source="file",
        bounds_native=[243500.0, 3178000.0, -45.0, 243600.0, 3178100.0, 175.0],
        bounds_repaired=False,
        bounds_wgs84=[48.3744, 28.7038, 48.3755, 28.7048],
        octree_spacing_m=4.0,
        z_stats={
            "min": -45.0,
            "max": 175.0,
            "mean": 10.0,
            "p01": -44.9,
            "p1": -44.0,
            "p5": -43.0,
            "p50": 12.0,
            "p95": 120.0,
            "p99": 170.0,
            "p999": 174.0,
            "sample_count": 1000,
        },
        class_counts={"2": 1000},
        octree_bytes=0,
        captured_on=None,
        map_id=None,
        job_id=None,
    )
    values.update(fields)
    with handle.session() as s:
        row = PointCloud(**values)
        s.add(row)
        s.flush()
        return row.id
```

- [ ] **Step 8: Run the tests to verify they pass**

Run: `cd backend; & $PY -m pytest tests/test_pointcloud_schemas.py tests/test_contract.py tests/test_project_kinds.py -v`
Expected: PASS. (`test_contract.py` still sees all 12 S1 stubs: nothing was un-stubbed.)

- [ ] **Step 9: Gate and commit**

Run the full gate (Global Constraints). Then:

```powershell
git add backend/app/pointclouds/schemas.py backend/app/pointclouds/rows.py backend/app/pointclouds/router.py backend/tests/pointclouds.py backend/tests/test_pointcloud_schemas.py
git commit -m "feat(pointclouds): schemas, row helpers and the sub-router block for the S1 units

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: Converter payload (unit K1)

**Files:**
- Create: `backend/scripts/fetch_potreeconverter.ps1`
- Create: `backend/scripts/check_potree_payload.ps1`
- Create: `backend/app/pointclouds/converter_path.py`
- Modify: `backend/kestrel_backend.spec` (datas)
- Modify: `backend/scripts/build.ps1` (payload checks before PyInstaller and in `dist`)
- Modify: `.gitignore` (`backend/third_party/`)
- Test: `backend/tests/test_pointcloud_converter_path.py`

**Interfaces:**
- Produces:
  - `app.pointclouds.converter_path.converter_exe() -> Path | None`, `require_converter() -> Path` (raises `JobFailure(NOT_INSTALLED)`), `NOT_INSTALLED: str`, `CONVERTER_VERSION = "2.1.5"`.
  - `backend/third_party/potreeconverter/{PotreeConverter.exe, laszip.dll, msvcp140.dll, msvcp140_atomic_wait.dll, vcruntime140.dll, vcruntime140_1.dll, licenses/*.txt, MANIFEST.json}` (git-ignored).
  - `MANIFEST.json`: `{"converter_version": "2.1.5", "files": [{"name": "<relative/posix>", "size": int, "sha256": "<hex>"}]}`.
  - `backend/scripts/fetch_potreeconverter.ps1` contains the literal line `$version = "2.1.5"` (Task 8's version test reads it).

- [ ] **Step 1: Write the failing tests**

`backend/tests/test_pointcloud_converter_path.py`:

```python
"""Where PotreeConverter.exe is found (spec §14), and the build's payload check."""

import json
import os
import subprocess
import sys
from pathlib import Path

import pytest

from app.jobs.cancellation import JobFailure
from app.pointclouds import converter_path

SCRIPTS = Path(__file__).resolve().parents[1] / "scripts"


def test_frozen_uses_only_the_bundle(monkeypatch, tmp_path):
    exe = tmp_path / "potreeconverter" / "PotreeConverter.exe"
    exe.parent.mkdir()
    exe.write_bytes(b"MZ")
    monkeypatch.setattr(sys, "frozen", True, raising=False)
    monkeypatch.setattr(sys, "_MEIPASS", str(tmp_path), raising=False)
    monkeypatch.setenv("KESTREL_POTREECONVERTER", str(tmp_path / "elsewhere.exe"))
    assert converter_path.converter_exe() == exe


def test_dev_prefers_the_environment(monkeypatch, tmp_path):
    exe = tmp_path / "pc" / "PotreeConverter.exe"
    exe.parent.mkdir()
    exe.write_bytes(b"MZ")
    monkeypatch.delattr(sys, "frozen", raising=False)
    monkeypatch.setenv("KESTREL_POTREECONVERTER", str(exe))
    assert converter_path.converter_exe() == exe


def test_dev_default_is_third_party(monkeypatch):
    monkeypatch.delattr(sys, "frozen", raising=False)
    monkeypatch.delenv("KESTREL_POTREECONVERTER", raising=False)
    expected = Path(__file__).resolve().parents[1] / "third_party" / "potreeconverter" / "PotreeConverter.exe"
    assert converter_path.default_dev_exe() == expected


def test_missing_converter_fails_readably(monkeypatch, tmp_path):
    monkeypatch.delattr(sys, "frozen", raising=False)
    monkeypatch.setenv("KESTREL_POTREECONVERTER", str(tmp_path / "missing.exe"))
    assert converter_path.converter_exe() is None
    with pytest.raises(JobFailure) as e:
        converter_path.require_converter()
    assert str(e.value) == (
        "the point-cloud converter is not installed (run backend\\scripts\\fetch_potreeconverter.ps1)"
    )


def _payload(dir_: Path, names: list[str], present: list[str]) -> None:
    dir_.mkdir(parents=True, exist_ok=True)
    for n in present:
        (dir_ / n).parent.mkdir(parents=True, exist_ok=True)
        (dir_ / n).write_bytes(b"x")
    manifest = {"converter_version": "2.1.5", "files": [{"name": n, "size": 1, "sha256": "0"} for n in names]}
    (dir_ / "MANIFEST.json").write_text(json.dumps(manifest), "utf-8")


def _check(dir_: Path) -> subprocess.CompletedProcess:
    return subprocess.run(
        [
            "powershell",
            "-NoProfile",
            "-ExecutionPolicy",
            "Bypass",
            "-File",
            str(SCRIPTS / "check_potree_payload.ps1"),
            "-Dir",
            str(dir_),
        ],
        capture_output=True,
        text=True,
    )


@pytest.mark.skipif(os.name != "nt", reason="PowerShell build scripts are Windows-only")
def test_payload_check_passes_on_a_complete_payload(tmp_path):
    names = ["PotreeConverter.exe", "laszip.dll", "licenses/license_laszip.txt"]
    _payload(tmp_path / "p", names, names)
    r = _check(tmp_path / "p")
    assert r.returncode == 0, r.stdout + r.stderr


@pytest.mark.skipif(os.name != "nt", reason="PowerShell build scripts are Windows-only")
def test_payload_check_fails_when_a_manifest_file_is_missing(tmp_path):
    names = ["PotreeConverter.exe", "laszip.dll", "vcruntime140_1.dll"]
    _payload(tmp_path / "p", names, names[:2])
    r = _check(tmp_path / "p")
    assert r.returncode != 0
    assert "vcruntime140_1.dll" in r.stdout + r.stderr


@pytest.mark.skipif(os.name != "nt", reason="PowerShell build scripts are Windows-only")
def test_payload_check_fails_without_a_manifest(tmp_path):
    (tmp_path / "p").mkdir()
    r = _check(tmp_path / "p")
    assert r.returncode != 0 and "fetch_potreeconverter.ps1" in r.stdout + r.stderr
```

- [ ] **Step 2: Run them to verify they fail**

Run: `cd backend; & $PY -m pytest tests/test_pointcloud_converter_path.py -v`
Expected: FAIL — `ImportError: cannot import name 'converter_path'`.

- [ ] **Step 3: Write `converter_path.py`**

`backend/app/pointclouds/converter_path.py`:

```python
"""Where PotreeConverter.exe lives (spec §14).

Frozen: only `_MEIPASS/potreeconverter/PotreeConverter.exe`, the copy the build verified. Dev:
`KESTREL_POTREECONVERTER`, else `backend/third_party/potreeconverter/`, which
`backend/scripts/fetch_potreeconverter.ps1` fills.
"""

from __future__ import annotations

import os
import sys
from pathlib import Path

from app.jobs.cancellation import JobFailure

CONVERTER_VERSION = "2.1.5"
NOT_INSTALLED = "the point-cloud converter is not installed (run backend\\scripts\\fetch_potreeconverter.ps1)"
_BACKEND = Path(__file__).resolve().parents[2]


def default_dev_exe() -> Path:
    return _BACKEND / "third_party" / "potreeconverter" / "PotreeConverter.exe"


def converter_exe() -> Path | None:
    if getattr(sys, "frozen", False):
        exe = Path(sys._MEIPASS) / "potreeconverter" / "PotreeConverter.exe"
    else:
        env = os.environ.get("KESTREL_POTREECONVERTER")
        exe = Path(env) if env else default_dev_exe()
    return exe if exe.is_file() else None


def require_converter() -> Path:
    exe = converter_exe()
    if exe is None:
        raise JobFailure(NOT_INSTALLED)
    return exe
```

- [ ] **Step 4: Write `check_potree_payload.ps1`**

`backend/scripts/check_potree_payload.ps1`:

```powershell
<#
.SYNOPSIS
  Fails unless every file MANIFEST.json lists is present in a PotreeConverter payload folder.
.DESCRIPTION
  Used by build.ps1 twice: on backend\third_party\potreeconverter before PyInstaller runs, and on
  dist\kestrel-backend\_internal\potreeconverter after it (spec §14). A missing MSVC DLL would
  otherwise go unnoticed on the build machine, which has the runtime installed system-wide.
#>
[CmdletBinding()]
param([Parameter(Mandatory = $true)][string] $Dir)
$ErrorActionPreference = "Stop"
$manifest = Join-Path $Dir "MANIFEST.json"
if (-not (Test-Path $manifest)) {
  throw "no PotreeConverter payload at ${Dir}: run backend\scripts\fetch_potreeconverter.ps1"
}
$m = Get-Content $manifest -Raw | ConvertFrom-Json
$missing = @()
foreach ($f in $m.files) {
  if (-not (Test-Path (Join-Path $Dir $f.name))) { $missing += $f.name }
}
if ($missing.Count -gt 0) {
  throw "the PotreeConverter payload at $Dir is missing: $($missing -join ', ') (run backend\scripts\fetch_potreeconverter.ps1)"
}
Write-Host "potreeconverter payload ok: $($m.files.Count) files, version $($m.converter_version)"
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `cd backend; & $PY -m pytest tests/test_pointcloud_converter_path.py -v`
Expected: PASS (7 tests).

- [ ] **Step 6: Write the fetch script**

`backend/scripts/fetch_potreeconverter.ps1`:

```powershell
<#
.SYNOPSIS
  Fills backend/third_party/potreeconverter/ with PotreeConverter 2.1.5, its laszip.dll, its
  licence texts and the MSVC runtime DLLs it needs (spec §14).

.DESCRIPTION
  1. Takes the release zip from -Zip, else downloads the pinned GitHub release asset; either way
     its SHA-256 must equal the pinned value.
  2. Extracts PotreeConverter.exe, laszip.dll and licenses/ (resources/ is only for
     --generate-page and is not taken).
  3. Copies msvcp140.dll, msvcp140_atomic_wait.dll, vcruntime140.dll and vcruntime140_1.dll from
     -CrtDir, else from the newest VC\Redist\MSVC\*\x64\Microsoft.VC14*.CRT of any installed Visual
     Studio / Build Tools.
  4. Runs dumpbin /dependents on the exe and laszip.dll: every import must be in the folder or a
     Windows system DLL.
  5. Runs `PotreeConverter.exe --help` from the folder. DLLs next to an exe load before System32,
     so a redist older than the converter's toolset fails here, not on the operator's machine.
  6. Writes MANIFEST.json (name, size, sha256 per file, converter version).

.PARAMETER Zip
  A local copy of PotreeConverter_2.1.5_x64_windows.zip (checked against the same SHA-256).

.PARAMETER CrtDir
  A folder holding the four MSVC DLLs, when auto-detection picks the wrong redist.

.EXAMPLE
  powershell -ExecutionPolicy Bypass -File backend\scripts\fetch_potreeconverter.ps1
#>
[CmdletBinding()]
param([string] $Zip, [string] $CrtDir, [string] $Destination)

$ErrorActionPreference = "Stop"
$ProgressPreference = "SilentlyContinue"
$version = "2.1.5"
$url = "https://github.com/potree/PotreeConverter/releases/download/$version/PotreeConverter_${version}_x64_windows.zip"
$sha256 = "A05BC3A936E41705649DC41B9AE4300EE5273ED23A3F1845E94690CA142E6248"
$crtNames = @("msvcp140.dll", "msvcp140_atomic_wait.dll", "vcruntime140.dll", "vcruntime140_1.dll")
$systemDll = '^(api-ms-win-|ext-ms-win-)|^(kernel32|user32|advapi32|shell32|ole32|oleaut32|ws2_32|bcrypt|ntdll|ucrtbase|gdi32|shlwapi|rpcrt4|version|winmm|psapi|dbghelp|comdlg32|secur32|crypt32)\.dll$'

$backend = Split-Path $PSScriptRoot -Parent
if (-not $Destination) { $Destination = Join-Path $backend "third_party\potreeconverter" }
$tmp = Join-Path $env:TEMP ("kestrel-potree-" + [guid]::NewGuid().ToString("N").Substring(0, 8))
New-Item -ItemType Directory -Force $tmp | Out-Null

function Find-VsFile([string] $pattern) {
  $roots = @("${env:ProgramFiles(x86)}\Microsoft Visual Studio", "$env:ProgramFiles\Microsoft Visual Studio") |
    Where-Object { $_ -and (Test-Path $_) }
  $hits = foreach ($r in $roots) { Get-ChildItem -Path (Join-Path $r $pattern) -ErrorAction SilentlyContinue }
  # newest toolset first: the version folder is the one right after MSVC\
  $hits | Sort-Object { $v = ($_.FullName -split '\\MSVC\\')[1].Split('\')[0]; try { [version]$v } catch { [version]"0.0" } } -Descending |
    Select-Object -First 1
}

try {
  # 1. the zip
  $zipPath = Join-Path $tmp "potree.zip"
  if ($Zip) { Copy-Item $Zip $zipPath } else { Invoke-WebRequest -Uri $url -OutFile $zipPath -UseBasicParsing }
  $actual = (Get-FileHash -Algorithm SHA256 $zipPath).Hash
  if ($actual -ne $sha256) { throw "PotreeConverter zip SHA-256 mismatch: expected $sha256, got $actual" }
  Write-Host "zip ok ($actual)"

  # 2. extract
  Expand-Archive -Path $zipPath -DestinationPath (Join-Path $tmp "x")
  $exe = Get-ChildItem (Join-Path $tmp "x") -Recurse -Filter PotreeConverter.exe | Select-Object -First 1
  if (-not $exe) { throw "the zip holds no PotreeConverter.exe" }
  $src = $exe.Directory.FullName
  if (Test-Path $Destination) { Remove-Item $Destination -Recurse -Force }
  New-Item -ItemType Directory -Force $Destination | Out-Null
  Copy-Item (Join-Path $src "PotreeConverter.exe"), (Join-Path $src "laszip.dll") $Destination
  Copy-Item (Join-Path $src "licenses") (Join-Path $Destination "licenses") -Recurse

  # 3. MSVC runtime
  if (-not $CrtDir) {
    $crt = Find-VsFile "*\*\VC\Redist\MSVC\*\x64\Microsoft.VC14*.CRT"
    if (-not $crt) { throw "no MSVC redist found; install the Visual Studio Build Tools or pass -CrtDir" }
    $CrtDir = $crt.FullName
  }
  foreach ($n in $crtNames) {
    $p = Join-Path $CrtDir $n
    if (-not (Test-Path $p)) { throw "$n is not in $CrtDir" }
    Copy-Item $p $Destination
  }
  Write-Host "msvc runtime from $CrtDir"

  # 4. dependency closure
  $dumpbin = Find-VsFile "*\*\VC\Tools\MSVC\*\bin\Hostx64\x64\dumpbin.exe"
  if (-not $dumpbin) { throw "dumpbin.exe not found; install the Visual Studio Build Tools (C++ workload)" }
  $local = @(Get-ChildItem $Destination -Filter *.dll | ForEach-Object { $_.Name.ToLower() })
  foreach ($bin in @("PotreeConverter.exe", "laszip.dll")) {
    $deps = & $dumpbin.FullName /nologo /dependents (Join-Path $Destination $bin) |
      ForEach-Object { $_.Trim() } | Where-Object { $_ -match '\.dll$' -and $_ -notmatch '^Dump of' }
    foreach ($d in $deps) {
      $name = $d.ToLower()
      if ($local -notcontains $name -and $name -notmatch $systemDll) {
        throw "$bin imports $d, which is neither in $Destination nor a Windows system DLL"
      }
    }
    Write-Host "closure ok: $bin ($($deps.Count) imports)"
  }

  # 5. it loads with the bundled DLLs
  $help = & (Join-Path $Destination "PotreeConverter.exe") --help 2>&1 | Out-String
  if ($LASTEXITCODE -ne 0 -or $help -notmatch "--encoding") {
    throw "PotreeConverter.exe --help failed with the bundled runtime (exit $LASTEXITCODE). A redist older than the converter's toolset shows up here: pass -CrtDir with a newer Microsoft.VC14x.CRT. Output:`n$help"
  }
  Write-Host "load ok"

  # 6. manifest
  $files = Get-ChildItem $Destination -Recurse -File | Where-Object { $_.Name -ne "MANIFEST.json" } | Sort-Object FullName |
    ForEach-Object {
      [ordered]@{
        name   = $_.FullName.Substring($Destination.Length + 1).Replace('\', '/')
        size   = $_.Length
        sha256 = (Get-FileHash -Algorithm SHA256 $_.FullName).Hash.ToLower()
      }
    }
  $manifest = [ordered]@{ converter_version = $version; files = @($files) }
  $manifest | ConvertTo-Json -Depth 4 | Set-Content -Encoding utf8 (Join-Path $Destination "MANIFEST.json")
  Write-Host "manifest ok: $(@($files).Count) files in $Destination"
} finally {
  Remove-Item $tmp -Recurse -Force -ErrorAction SilentlyContinue
}
```

- [ ] **Step 7: Run the fetch script**

Run: `powershell -ExecutionPolicy Bypass -File backend\scripts\fetch_potreeconverter.ps1`
Expected: `zip ok (A05BC3…)`, `msvc runtime from …`, `closure ok: PotreeConverter.exe (14 imports)`, `closure ok: laszip.dll (9 imports)`, `load ok`, `manifest ok: 10 files …`. If the download's hash differs from the pinned spike copy, **stop and ask the operator** (the pinned hash is the spike's copy); do not re-pin silently. The spike's copy is at `C:\Users\D\AppData\Local\Temp\claude\E--Dev-Yolo-app\94a62452-00f9-4a20-ac7d-ca08e57e33c2\scratchpad\tools\pc\PotreeConverter_2.1.5_x64_windows.zip` and can be passed as `-Zip` while it exists.

Then: `powershell -NoProfile -ExecutionPolicy Bypass -File backend\scripts\check_potree_payload.ps1 -Dir backend\third_party\potreeconverter`
Expected: `potreeconverter payload ok: 10 files, version 2.1.5`.

- [ ] **Step 8: Bundle it**

`.gitignore` — add under the backend section:

```
backend/third_party/
```

`backend/kestrel_backend.spec` — after the `datas = (...)` expression, add:

```python
# PotreeConverter 2.1.5 + laszip.dll + the MSVC runtime + licence texts (spec §14), fetched by
# scripts/fetch_potreeconverter.ps1. As datas, not binaries: PyInstaller must keep the folder layout
# and must not relocate the DLLs away from the exe that loads them.
POTREE = Path(SPECPATH) / "third_party" / "potreeconverter"
datas += [
    (str(p), (Path("potreeconverter") / p.relative_to(POTREE).parent).as_posix())
    for p in sorted(POTREE.rglob("*"))
    if p.is_file()
]
```

`backend/scripts/build.ps1` — after the starter-weights check (before PyInstaller runs):

```powershell
# PotreeConverter payload (spec §14): every MANIFEST.json file must be there before freezing.
& powershell -NoProfile -ExecutionPolicy Bypass -File (Join-Path $PSScriptRoot "check_potree_payload.ps1") -Dir (Join-Path $backend "third_party\potreeconverter")
if ($LASTEXITCODE -ne 0) { throw "PotreeConverter payload incomplete; run scripts\fetch_potreeconverter.ps1" }
```

and after the bundled-starter check (after PyInstaller):

```powershell
& powershell -NoProfile -ExecutionPolicy Bypass -File (Join-Path $PSScriptRoot "check_potree_payload.ps1") -Dir "dist\kestrel-backend\_internal\potreeconverter"
if ($LASTEXITCODE -ne 0) { throw "the PotreeConverter payload did not make it into the bundle intact" }
```

- [ ] **Step 9: Freeze and check the bundle**

Run: `powershell -ExecutionPolicy Bypass -File backend\scripts\build.ps1 -Venv E:\Dev\Yolo\app\backend\.venv`
Expected: two `potreeconverter payload ok: 10 files, version 2.1.5` lines, then the sidecar copy line. Then prove the build refuses a broken payload: rename `backend\third_party\potreeconverter\vcruntime140_1.dll` to `.bak`, run `build.ps1` again → it throws `… is missing: vcruntime140_1.dll …` before PyInstaller starts; rename it back.

Then: `powershell -ExecutionPolicy Bypass -File backend\scripts\smoke_frozen.ps1` → `smoke ok` (nothing else changed yet).

- [ ] **Step 10: Gate and commit**

```powershell
git add .gitignore backend/kestrel_backend.spec backend/scripts/build.ps1 backend/scripts/check_potree_payload.ps1 backend/scripts/fetch_potreeconverter.ps1 backend/app/pointclouds/converter_path.py backend/tests/test_pointcloud_converter_path.py
git commit -m "build(pointclouds): fetch, verify and bundle PotreeConverter 2.1.5 with its MSVC runtime

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: Admission, work copy and header bounds (unit I1, part a)

**Files:**
- Create: `backend/app/pointclouds/lasbounds.py`
- Create: `backend/app/pointclouds/admission.py`
- Create: `backend/app/pointclouds/workcopy.py`
- Test: `backend/tests/test_pointcloud_admission.py`, `backend/tests/test_pointcloud_workcopy.py`

**Interfaces:**
- Consumes (F0): `tests.pointclouds.make_las`.
- Produces:
  - `lasbounds.HEADER_BOUNDS_OFFSET = 179`; `read_header_bounds(path) -> list[float]` (`[minx, miny, minz, maxx, maxy, maxz]`); `write_header_bounds(path, bounds: Sequence[float]) -> None`; `widen(bounds, scale) -> list[float]`; `contains(outer, inner) -> bool`.
  - `admission.available_ram() -> int`, `admission.free_disk(folder: Path) -> int` (the two seams); `ram_needed(point_count) -> int`; `disk_needed(point_count, source_size, record_len) -> int`; `gb(n) -> str`; `Admission` (frozen dataclass: `ok`, `ram_needed_bytes`, `ram_available_bytes`, `disk_needed_bytes`, `disk_available_bytes`, `reason`, property `code -> "insufficient_memory" | "insufficient_disk" | None`, `as_dict()`); `assess(point_count, source_size, record_len, folder) -> Admission`; `require(adm) -> None` (raises `JobFailure(adm.reason)`).
  - `workcopy.COPY_CHUNK = 64 MiB`; `DISK_FULL: str`; `copy_and_hash(source, dest, *, progress: Callable[[int, int], None], check_cancelled: Callable[[], None], chunk=COPY_CHUNK) -> str` (sha256 hex; deletes `dest` on any failure); `repair_header(path, bounds, scale) -> bool` (True when the header did not contain every point); seams `_open_source(path)`, `_open_dest(path)`.

- [ ] **Step 1: Write the failing admission tests**

`backend/tests/test_pointcloud_admission.py`:

```python
"""RAM and disk admission (spec §6.2): arithmetic, the refusal messages, the seams."""

import pytest

from app.jobs.cancellation import JobFailure
from app.pointclouds import admission

GB = 1_000_000_000


@pytest.fixture
def plenty(monkeypatch):
    monkeypatch.setattr(admission, "available_ram", lambda: 64 * GB)
    monkeypatch.setattr(admission, "free_disk", lambda folder: 2_000 * GB)


def test_ram_need_is_45_mb_per_million_points_plus_a_gib():
    assert admission.ram_needed(21_697_184) == int(45_000_000 * 21.697184) + 2**30
    assert admission.ram_needed(195_274_656) == 9_861_101_344


def test_disk_need_counts_the_work_copy_chunks_octree_and_margin():
    need = admission.disk_needed(point_count=1_000_000, source_size=34_000_000, record_len=34)
    assert need == 34_000_000 + 40 * 1_000_000 + int(0.25 * 1_000_000 * 34) + 2**30


def test_admits_when_both_fit(plenty, tmp_path):
    a = admission.assess(21_697_184, 738_000_000, 34, tmp_path)
    assert a.ok and a.reason is None and a.code is None
    admission.require(a)  # does not raise


def test_refuses_195m_points_with_4_gb_free(monkeypatch, tmp_path):
    monkeypatch.setattr(admission, "available_ram", lambda: 4 * GB)
    monkeypatch.setattr(admission, "free_disk", lambda folder: 2_000 * GB)
    a = admission.assess(195_274_656, 6_200_000_000, 34, tmp_path)
    assert not a.ok and a.code == "insufficient_memory"
    assert a.reason == (
        "This cloud needs about 9.9 GB of free memory; 4.0 GB is free. Close other programs and try again."
    )
    with pytest.raises(JobFailure) as e:
        admission.require(a)
    assert str(e.value) == a.reason


def test_refuses_when_the_project_drive_is_too_small(monkeypatch, tmp_path):
    monkeypatch.setattr(admission, "available_ram", lambda: 64 * GB)
    monkeypatch.setattr(admission, "free_disk", lambda folder: 5 * GB)
    a = admission.assess(195_274_656, 6_200_000_000, 34, tmp_path)
    assert a.code == "insufficient_disk"
    assert a.reason.startswith("This import needs about 16.")
    assert a.reason.endswith(
        "GB of free disk space on the project drive; 5.0 GB is free. Free some space and try again."
    )


def test_free_disk_walks_up_to_an_existing_folder(tmp_path):
    assert admission.free_disk(tmp_path / "not" / "yet" / "made") > 0


def test_as_dict_matches_the_contract_fields(plenty, tmp_path):
    d = admission.assess(10, 100, 34, tmp_path).as_dict()
    assert set(d) == {
        "ok",
        "ram_needed_bytes",
        "ram_available_bytes",
        "disk_needed_bytes",
        "disk_available_bytes",
        "reason",
    }
```

- [ ] **Step 2: Write the failing work-copy tests**

`backend/tests/test_pointcloud_workcopy.py`:

```python
"""Streamed work copy + hash, header bounds at byte 179, header repair (spec §6.3, §6.6)."""

import errno
import hashlib
import io
import os

import laspy
import numpy as np
import pytest
from pointclouds import make_las

from app.jobs.cancellation import JobCancelled, JobFailure
from app.pointclouds import lasbounds, workcopy


def _noop(*_a):
    return None


def test_hash_equals_hashlib_and_the_source_is_untouched(tmp_path):
    src = make_las(tmp_path / "src.las", 20_000)
    before = (src.read_bytes(), os.stat(src).st_mtime_ns)
    seen: list[tuple[int, int]] = []
    sha = workcopy.copy_and_hash(
        src,
        tmp_path / "work" / "input.las",
        progress=lambda d, t: seen.append((d, t)),
        check_cancelled=_noop,
        chunk=100_000,
    )
    assert sha == hashlib.sha256(src.read_bytes()).hexdigest()
    assert (tmp_path / "work" / "input.las").read_bytes() == src.read_bytes()
    assert seen[-1] == (src.stat().st_size, src.stat().st_size) and len(seen) > 3
    assert (src.read_bytes(), os.stat(src).st_mtime_ns) == before


def test_cancel_mid_copy_removes_the_partial_copy(tmp_path):
    src = make_las(tmp_path / "src.las", 20_000)
    calls = {"n": 0}

    def cancel_on_third():
        calls["n"] += 1
        if calls["n"] == 3:
            raise JobCancelled()

    dest = tmp_path / "work" / "input.las"
    with pytest.raises(JobCancelled):
        workcopy.copy_and_hash(src, dest, progress=_noop, check_cancelled=cancel_on_third, chunk=100_000)
    assert not dest.exists()


class _FlakySource(io.BytesIO):
    def read(self, n=-1):
        if self.tell() > 0:
            raise OSError(errno.EIO, "The specified network name is no longer available")
        return super().read(n)


def test_source_vanishing_mid_copy_fails_readably(tmp_path, monkeypatch):
    """Review Focus 2: the NAS drops half-way through."""
    src = make_las(tmp_path / "src.las", 20_000)
    monkeypatch.setattr(workcopy, "_open_source", lambda p: _FlakySource(p.read_bytes()))
    dest = tmp_path / "work" / "input.las"
    with pytest.raises(JobFailure) as e:
        workcopy.copy_and_hash(src, dest, progress=_noop, check_cancelled=_noop, chunk=100_000)
    assert str(e.value).startswith(f"could not read the source file: {src} (")
    assert "no longer available" in str(e.value)
    assert not dest.exists()


class _FullDisk(io.BytesIO):
    def write(self, b):
        raise OSError(errno.ENOSPC, "There is not enough space on the disk")


def test_full_project_drive_fails_readably(tmp_path, monkeypatch):
    """Review Focus 3: another program filled the drive after admission passed."""
    src = make_las(tmp_path / "src.las", 2_000)
    monkeypatch.setattr(workcopy, "_open_dest", lambda p: _FullDisk())
    dest = tmp_path / "work" / "input.las"
    with pytest.raises(JobFailure) as e:
        workcopy.copy_and_hash(src, dest, progress=_noop, check_cancelled=_noop)
    assert str(e.value) == "the project drive is full; free some space and import again"


@pytest.mark.parametrize(
    ("name", "kwargs"),
    [
        ("v12.las", {"version": "1.2", "point_format": 3}),
        ("v14.las", {"version": "1.4", "point_format": 6, "rgb": False}),
        ("v12.laz", {"version": "1.2", "point_format": 3, "compressed": True}),
    ],
)
def test_byte_179_holds_the_bounds_in_las_12_14_and_laz(tmp_path, name, kwargs):
    path = make_las(tmp_path / name, 500, **kwargs)
    with laspy.open(path) as r:
        expected = [*r.header.mins, *r.header.maxs]
    assert lasbounds.read_header_bounds(path) == pytest.approx(expected, abs=1e-9)
    lasbounds.write_header_bounds(path, [1, 2, 3, 4, 5, 6])
    with laspy.open(path) as r:
        assert [*r.header.mins, *r.header.maxs] == [1, 2, 3, 4, 5, 6]


def test_write_refuses_a_file_that_is_not_las(tmp_path):
    p = tmp_path / "x.las"
    p.write_bytes(b"NOTLAS" + b"\0" * 300)
    with pytest.raises(ValueError):
        lasbounds.write_header_bounds(p, [0, 0, 0, 1, 1, 1])


def test_widen_and_contains():
    assert lasbounds.widen([0, 0, 0, 1, 1, 1], [0.001, 0.01, 0.1]) == pytest.approx(
        [-0.001, -0.01, -0.1, 1.001, 1.01, 1.1]
    )
    assert lasbounds.contains([0, 0, 0, 2, 2, 2], [0, 0, 0, 2, 2, 2])
    assert not lasbounds.contains([0, 0, 0, 2, 2, 2], [0, 0, 0, 2.0003, 2, 2])


def _true_bounds(path):
    with laspy.open(path) as r:
        las = r.read()
    xyz = np.column_stack([las.x, las.y, las.z])
    return [*xyz.min(0), *xyz.max(0)]


def test_repair_fixes_the_pix4d_header(tmp_path):
    path = make_las(tmp_path / "pix4d.las", 5_000, header_shrink_mm=0.3)
    bounds = _true_bounds(path)
    assert workcopy.repair_header(path, bounds, [0.001, 0.001, 0.001]) is True
    with laspy.open(path) as r:
        mins, maxs = r.header.mins, r.header.maxs
    assert all(mins <= np.array(bounds[:3])) and all(maxs >= np.array(bounds[3:]))
    assert maxs[0] == pytest.approx(bounds[3] + 0.001, abs=1e-9)


def test_a_correct_header_still_gets_the_widened_bounds(tmp_path):
    path = make_las(tmp_path / "ok.las", 5_000)
    bounds = _true_bounds(path)
    assert workcopy.repair_header(path, bounds, [0.001, 0.001, 0.001]) is False
    assert lasbounds.read_header_bounds(path) == pytest.approx(lasbounds.widen(bounds, [0.001] * 3), abs=1e-9)
```

- [ ] **Step 3: Run them to verify they fail**

Run: `cd backend; & $PY -m pytest tests/test_pointcloud_admission.py tests/test_pointcloud_workcopy.py -v`
Expected: FAIL — `ImportError: cannot import name 'admission' from 'app.pointclouds'`.

- [ ] **Step 4: Write `lasbounds.py`**

`backend/app/pointclouds/lasbounds.py`:

```python
"""The six header bounds of a LAS/LAZ file, read and written in place (spec §2 "Bounds repair").

At byte 179 of the public header block, identical in LAS 1.0-1.4 and in LAZ (whose header is not
compressed): max X, min X, max Y, min Y, max Z, min Z as little-endian doubles.
"""

from __future__ import annotations

import struct
from collections.abc import Sequence
from pathlib import Path

HEADER_BOUNDS_OFFSET = 179
_FORMAT = "<6d"
_SIZE = struct.calcsize(_FORMAT)


def _check_signature(f) -> None:
    f.seek(0)
    if f.read(4) != b"LASF":
        raise ValueError("not a LAS or LAZ file (no LASF signature)")


def read_header_bounds(path: Path) -> list[float]:
    """`[minx, miny, minz, maxx, maxy, maxz]` exactly as the header stores them."""
    with open(path, "rb") as f:
        _check_signature(f)
        f.seek(HEADER_BOUNDS_OFFSET)
        maxx, minx, maxy, miny, maxz, minz = struct.unpack(_FORMAT, f.read(_SIZE))
    return [minx, miny, minz, maxx, maxy, maxz]


def write_header_bounds(path: Path, bounds: Sequence[float]) -> None:
    minx, miny, minz, maxx, maxy, maxz = (float(v) for v in bounds)
    with open(path, "r+b") as f:
        _check_signature(f)
        f.seek(HEADER_BOUNDS_OFFSET)
        f.write(struct.pack(_FORMAT, maxx, minx, maxy, miny, maxz, minz))


def widen(bounds: Sequence[float], scale: Sequence[float]) -> list[float]:
    """One scale step outwards on every side: margin against the converter's own quantisation."""
    return [
        bounds[0] - scale[0],
        bounds[1] - scale[1],
        bounds[2] - scale[2],
        bounds[3] + scale[0],
        bounds[4] + scale[1],
        bounds[5] + scale[2],
    ]


def contains(outer: Sequence[float], inner: Sequence[float]) -> bool:
    return all(outer[i] <= inner[i] for i in range(3)) and all(outer[i] >= inner[i] for i in range(3, 6))
```

- [ ] **Step 5: Write `admission.py`**

`backend/app/pointclouds/admission.py`:

```python
"""RAM and disk admission for a point-cloud import (spec §6.2).

Pure arithmetic around two seams, `available_ram()` and `free_disk()`, so a test can pretend the
machine has 4 GB free. Checked at inspect, at submit, and in the job right before the converter.
"""

from __future__ import annotations

import shutil
from dataclasses import asdict, dataclass
from pathlib import Path

import psutil

from app.jobs.cancellation import JobFailure

MB = 1_000_000
GIB = 1 << 30
RAM_PER_MPOINT = 45 * MB  # spike: 8.7 GB peak for 195 M points
CHUNK_BYTES_PER_POINT = 40  # the converter's temporary chunks
OCTREE_FRACTION = 0.25  # measured 0.186 x the LAS size


def available_ram() -> int:
    return int(psutil.virtual_memory().available)


def free_disk(folder: Path) -> int:
    p = Path(folder)
    while not p.exists() and p != p.parent:
        p = p.parent
    return int(shutil.disk_usage(p).free)


def gb(n: int) -> str:
    return f"{n / 1e9:.1f} GB"


def ram_needed(point_count: int) -> int:
    return int(RAM_PER_MPOINT * point_count / 1e6) + GIB


def disk_needed(point_count: int, source_size: int, record_len: int) -> int:
    return (
        int(source_size + CHUNK_BYTES_PER_POINT * point_count + OCTREE_FRACTION * point_count * record_len)
        + GIB
    )


@dataclass(frozen=True)
class Admission:
    ok: bool
    ram_needed_bytes: int
    ram_available_bytes: int
    disk_needed_bytes: int
    disk_available_bytes: int
    reason: str | None

    @property
    def code(self) -> str | None:
        if self.ok:
            return None
        return (
            "insufficient_memory" if self.ram_needed_bytes > self.ram_available_bytes else "insufficient_disk"
        )

    def as_dict(self) -> dict:
        return asdict(self)


def assess(point_count: int, source_size: int, record_len: int, folder: Path) -> Admission:
    ram_need, ram_have = ram_needed(point_count), available_ram()
    disk_need, disk_have = disk_needed(point_count, source_size, record_len), free_disk(folder)
    reason = None
    if ram_need > ram_have:
        reason = (
            f"This cloud needs about {gb(ram_need)} of free memory; {gb(ram_have)} is free. "
            "Close other programs and try again."
        )
    elif disk_need > disk_have:
        reason = (
            f"This import needs about {gb(disk_need)} of free disk space on the project drive; "
            f"{gb(disk_have)} is free. Free some space and try again."
        )
    return Admission(reason is None, ram_need, ram_have, disk_need, disk_have, reason)


def require(adm: Admission) -> None:
    if not adm.ok:
        raise JobFailure(adm.reason)
```

- [ ] **Step 6: Write `workcopy.py`**

`backend/app/pointclouds/workcopy.py`:

```python
"""The transient local work copy of a source cloud (spec §6.3) and its header repair (spec §6.6).

The source, often on a NAS, is read exactly once, in 64 MiB chunks, hashed on the way. The copy is
the only file ever modified; the source never is.
"""

from __future__ import annotations

import errno
import hashlib
from collections.abc import Callable, Sequence
from pathlib import Path

import laspy
import numpy as np

from app.jobs.cancellation import JobFailure
from app.pointclouds.lasbounds import contains, read_header_bounds, widen, write_header_bounds

COPY_CHUNK = 64 * 1024 * 1024
DISK_FULL = "the project drive is full; free some space and import again"
_DISK_FULL_WINERRORS = {39, 112}  # ERROR_HANDLE_DISK_FULL, ERROR_DISK_FULL


def _open_source(path: Path):
    return open(path, "rb")


def _open_dest(path: Path):
    return open(path, "wb")


def _reason(e: OSError) -> str:
    return e.strerror or str(e) or type(e).__name__


def _is_disk_full(e: OSError) -> bool:
    return e.errno == errno.ENOSPC or getattr(e, "winerror", None) in _DISK_FULL_WINERRORS


def copy_and_hash(
    source: Path,
    dest: Path,
    *,
    progress: Callable[[int, int], None],
    check_cancelled: Callable[[], None],
    chunk: int = COPY_CHUNK,
) -> str:
    """Copies `source` to `dest` and returns its sha256; `dest` is removed on any failure."""
    dest.parent.mkdir(parents=True, exist_ok=True)
    try:
        total = source.stat().st_size
        src = _open_source(source)
    except OSError as e:
        raise JobFailure(f"could not read the source file: {source} ({_reason(e)})") from None
    digest, done = hashlib.sha256(), 0
    try:
        with src, _open_dest(dest) as out:
            while True:
                check_cancelled()
                try:
                    block = src.read(chunk)
                except OSError as e:
                    raise JobFailure(f"could not read the source file: {source} ({_reason(e)})") from None
                if not block:
                    break
                digest.update(block)
                try:
                    out.write(block)
                except OSError as e:
                    if _is_disk_full(e):
                        raise JobFailure(DISK_FULL) from None
                    raise JobFailure(f"could not write the work copy: {_reason(e)}") from None
                done += len(block)
                progress(done, total)
        if done != total:
            raise JobFailure(f"the source file changed while it was being copied: {source}")
    except BaseException:
        dest.unlink(missing_ok=True)
        raise
    return digest.hexdigest()


def repair_header(path: Path, bounds: Sequence[float], scale: Sequence[float]) -> bool:
    """Writes the scanned bounds, widened one scale step, into the copy's header; True if they were
    not already inside the header (the Pix4D defect). A laspy reopen then proves the result."""
    repaired = not contains(read_header_bounds(path), bounds)
    write_header_bounds(path, widen(bounds, scale))
    with laspy.open(path) as r:
        mins, maxs = np.asarray(r.header.mins), np.asarray(r.header.maxs)
    if not (np.all(mins <= np.asarray(bounds[:3])) and np.all(maxs >= np.asarray(bounds[3:]))):
        raise JobFailure("could not repair the header bounds of the work copy")
    return repaired
```

- [ ] **Step 7: Run the tests to verify they pass**

Run: `cd backend; & $PY -m pytest tests/test_pointcloud_admission.py tests/test_pointcloud_workcopy.py -v`
Expected: PASS (all).

- [ ] **Step 8: Gate and commit**

```powershell
git add backend/app/pointclouds/lasbounds.py backend/app/pointclouds/admission.py backend/app/pointclouds/workcopy.py backend/tests/test_pointcloud_admission.py backend/tests/test_pointcloud_workcopy.py
git commit -m "feat(pointclouds): RAM/disk admission, streamed work copy with hash, header bounds repair

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 4: Header inspection, scan and CRS (unit I1, part b)

**Files:**
- Create: `backend/app/pointclouds/crs.py`
- Create: `backend/app/pointclouds/lasfile.py`
- Create: `backend/app/pointclouds/scan.py`
- Test: `backend/tests/test_pointcloud_crs.py`, `backend/tests/test_pointcloud_lasfile.py`, `backend/tests/test_pointcloud_scan.py`

**Interfaces:**
- Produces:
  - `crs.CrsInfo` (frozen dataclass: `crs_wkt`, `epsg`, `proj4`, `vertical_crs`, `warning`, all optional; property `is_geographic`); `crs_from_header(header) -> CrsInfo`; `crs_info(crs: pyproj.CRS) -> CrsInfo`; `crs_from_epsg(code: int) -> CrsInfo` (raises `ValueError` for an unknown code); `bounds_wgs84(bounds6, crs_wkt) -> list[float]`; `EDGE_SAMPLES = 21`.
  - `lasfile.HeaderInfo` (frozen dataclass: `path`, `size`, `compressed`, `las_version: str`, `point_format: int`, `point_count: int`, `record_len: int`, `has_rgb: bool`, `header_bounds: list[float]`, `scale: list[float]`, `offsets: list[float]`, `crs: CrsInfo`, `captured_on: date | None`, `vlrs: list[str]`); `UnsupportedCloud(JobFailure)`; `header_info(fileobj, path, size) -> HeaderInfo`; `inspect_file(path) -> HeaderInfo`; `RGB_FORMATS = {2, 3, 5, 7, 8, 10}`; `SUFFIXES = {".las", ".laz"}`.
  - `scan.ScanResult` (dataclass: `count`, `header_count`, `bounds: list[float]`, `z_stats: dict`, `class_counts: dict[str, int]`); `scan.scan(path, *, progress: Callable[[int, int], None], check_cancelled, chunk=2_000_000) -> ScanResult`; `CHUNK`, `SAMPLE_MAX = 2_000_000`, `PERCENTILES`.

- [ ] **Step 1: Write the failing CRS tests**

`backend/tests/test_pointcloud_crs.py`:

```python
"""CRS from the header (spec §6.5): GeoKeys, WKT, compound, none, unreadable; WGS84 bounds."""

import laspy
import numpy as np
import pytest
from pointclouds import make_las
from pyproj import CRS, Transformer

from app.pointclouds import crs as cloud_crs


def _header(path):
    with laspy.open(path) as r:
        return r.header


def test_epsg_from_geokeys_in_las_12(tmp_path):
    info = cloud_crs.crs_from_header(_header(make_las(tmp_path / "a.las", 10, epsg=32639)))
    assert info.epsg == 32639 and "+proj=utm" in info.proj4 and "+zone=39" in info.proj4
    assert info.vertical_crs is None and info.warning is None and not info.is_geographic


def test_epsg_from_wkt_in_las_14(tmp_path):
    path = make_las(tmp_path / "b.las", 10, epsg=32639, version="1.4", point_format=6, rgb=False)
    assert cloud_crs.crs_from_header(_header(path)).epsg == 32639


def test_compound_crs_splits_horizontal_and_vertical(tmp_path):
    h = laspy.LasHeader(point_format=6, version="1.4")
    h.scales, h.offsets = [0.001] * 3, [243000, 3177000, 0]
    h.add_crs(CRS("EPSG:32639+5773"))
    las = laspy.LasData(h)
    las.x, las.y, las.z = np.array([243500.0]), np.array([3178000.0]), np.array([1.0])
    las.write(tmp_path / "c.las")
    info = cloud_crs.crs_from_header(_header(tmp_path / "c.las"))
    assert info.epsg == 32639 and info.vertical_crs == "EGM96 height"
    assert CRS.from_wkt(info.crs_wkt).to_epsg() == 32639


def test_no_crs_means_no_coordinates(tmp_path):
    info = cloud_crs.crs_from_header(_header(make_las(tmp_path / "d.las", 10, epsg=None)))
    assert info == cloud_crs.CrsInfo()


class _Unreadable:
    def parse_crs(self):
        raise ValueError("GeoKeyDirectory is truncated")


def test_unreadable_crs_is_nulls_plus_a_warning():
    info = cloud_crs.crs_from_header(_Unreadable())
    assert info.crs_wkt is None and info.epsg is None
    assert (
        info.warning
        == "the coordinate system in the file could not be read: ValueError: GeoKeyDirectory is truncated"
    )


def test_geographic_crs_is_flagged():
    assert cloud_crs.crs_from_epsg(4326).is_geographic


def test_unknown_epsg_raises_value_error():
    with pytest.raises(ValueError):
        cloud_crs.crs_from_epsg(999_999)


def test_bounds_wgs84_matches_an_independent_pyproj_result():
    wkt = CRS.from_epsg(32639).to_wkt()
    got = cloud_crs.bounds_wgs84([243500, 3178000, -45, 243700, 3178300, 175], wkt)
    want = Transformer.from_crs(32639, 4326, always_xy=True).transform_bounds(
        243500, 3178000, 243700, 3178300, densify_pts=21
    )
    assert got == pytest.approx(list(want), abs=1e-9)
```

- [ ] **Step 2: Write the failing header-inspection tests**

`backend/tests/test_pointcloud_lasfile.py`:

```python
"""Header-only inspection (spec §4.1 op 3): the facts, and never more than 1 MiB read."""

import io
from datetime import date

import pytest
from pointclouds import make_las

from app.pointclouds import lasfile


class CountingFile(io.FileIO):
    def __init__(self, *a, **k):
        super().__init__(*a, **k)
        self.bytes_read = 0

    def read(self, n=-1):
        b = super().read(n)
        self.bytes_read += len(b or b"")
        return b

    def readinto(self, buf):
        n = super().readinto(buf)
        self.bytes_read += n or 0
        return n


@pytest.mark.parametrize("name", ["big.las", "big.laz"])
def test_reads_only_the_header_and_vlrs(tmp_path, name):
    path = make_las(tmp_path / name, 1_000_000, compressed=name.endswith(".laz"))
    f = CountingFile(path)
    info = lasfile.header_info(f, path, path.stat().st_size)
    f.close()
    assert f.bytes_read <= 1 << 20
    assert info.point_count == 1_000_000 and info.compressed is name.endswith(".laz")


def test_header_facts(tmp_path):
    path = make_las(tmp_path / "a.las", 1000, header_shrink_mm=0.3)
    info = lasfile.inspect_file(path)
    assert (info.las_version, info.point_format, info.record_len, info.has_rgb) == ("1.2", 3, 34, True)
    assert info.crs.epsg == 32639 and info.scale == [0.001, 0.001, 0.001]
    assert len(info.header_bounds) == 6 and info.header_bounds[3] > info.header_bounds[0]
    assert info.captured_on == date.today()
    assert "GeoKeyDirectoryVlr" in info.vlrs


def test_no_rgb_formats(tmp_path):
    info = lasfile.inspect_file(make_las(tmp_path / "b.las", 10, version="1.4", point_format=6, rgb=False))
    assert info.has_rgb is False and info.record_len == 30


@pytest.mark.parametrize("content", [b"", b"NOTLAS" * 100, b"LASF" + b"\0" * 50])
def test_not_a_las_file_is_unsupported(tmp_path, content):
    p = tmp_path / "x.las"
    p.write_bytes(content)
    with pytest.raises(lasfile.UnsupportedCloud) as e:
        lasfile.inspect_file(p)
    assert str(e.value).startswith("this is not a readable LAS or LAZ file:")


def test_wrong_extension_is_unsupported(tmp_path):
    p = tmp_path / "cloud.e57"
    p.write_bytes(b"x")
    with pytest.raises(lasfile.UnsupportedCloud) as e:
        lasfile.inspect_file(p)
    assert str(e.value) == "only .las and .laz point clouds can be imported (got .e57)"
```

- [ ] **Step 3: Write the failing scan tests**

`backend/tests/test_pointcloud_scan.py`:

```python
"""The chunked scan (spec §6.4): exact count/bounds/mean, stride-sampled percentiles, histogram."""

import laspy
import numpy as np
import pytest
from pointclouds import make_las

from app.jobs.cancellation import JobCancelled, JobFailure
from app.pointclouds import scan


def _noop(*_a):
    return None


def _points(n, seed=0):
    rng = np.random.default_rng(seed)
    return np.column_stack(
        [243500 + rng.random(n) * 100, 3178000 + rng.random(n) * 100, rng.normal(10, 20, n)]
    ).round(3)


def test_exact_count_bounds_mean(tmp_path):
    pts = _points(10_000)
    path = make_las(tmp_path / "a.las", len(pts), points=pts)
    r = scan.scan(path, progress=_noop, check_cancelled=_noop, chunk=3_001)
    assert r.count == r.header_count == 10_000
    assert r.bounds == pytest.approx([*pts.min(0), *pts.max(0)], abs=5e-4)
    assert r.z_stats["mean"] == pytest.approx(pts[:, 2].mean(), abs=1e-3)
    assert r.z_stats["min"] == pytest.approx(pts[:, 2].min(), abs=5e-4)


def test_percentiles_land_within_one_stride(tmp_path, monkeypatch):
    # Points written in Z order: the stride sample is then every 10th value of the sorted array, so
    # its percentiles sit within one stride of the full array's. (On shuffled points the difference
    # is sampling noise, not a property of the code.) Chunks of 2 999 are not a multiple of the stride,
    # so this also proves the sample follows the global index across chunk boundaries.
    monkeypatch.setattr(scan, "SAMPLE_MAX", 1_000)
    pts = _points(10_000, seed=3)
    pts = pts[np.argsort(pts[:, 2])]
    path = make_las(tmp_path / "b.las", len(pts), points=pts)
    r = scan.scan(path, progress=_noop, check_cancelled=_noop, chunk=2_999)
    z = np.sort(pts[:, 2])
    stride = 10
    assert r.z_stats["sample_count"] == 1_000
    for key, q in scan.PERCENTILES.items():
        rank = np.searchsorted(z, r.z_stats[key])
        assert abs(rank - q / 100 * (len(z) - 1)) <= stride + 1, key


def test_class_histogram(tmp_path):
    path = make_las(tmp_path / "c.las", 1_000)
    las = laspy.read(path)
    las.classification = np.array([2] * 600 + [6] * 399 + [7], dtype=np.uint8)
    las.write(path)
    r = scan.scan(path, progress=_noop, check_cancelled=_noop)
    assert r.class_counts == {"2": 600, "6": 399, "7": 1}


def test_chunk_boundary_two_million_and_one(tmp_path):
    path = make_las(tmp_path / "d.las", 2_000_001)
    seen = []
    r = scan.scan(path, progress=lambda d, t: seen.append(d), check_cancelled=_noop)
    assert r.count == 2_000_001 and seen == [2_000_000, 2_000_001]
    assert r.z_stats["sample_count"] <= scan.SAMPLE_MAX + 1


def test_count_mismatch_is_recorded_and_the_scan_wins(tmp_path):
    path = make_las(tmp_path / "e.las", 1_000)
    with open(path, "r+b") as f:  # legacy point count (LAS 1.2) at byte 107
        f.seek(107)
        f.write((900).to_bytes(4, "little"))
    r = scan.scan(path, progress=_noop, check_cancelled=_noop)
    assert r.header_count == 900 and r.count in (900, 1_000)


def test_empty_file_fails(tmp_path):
    path = tmp_path / "f.las"
    laspy.LasData(laspy.LasHeader(point_format=3, version="1.2")).write(path)
    with pytest.raises(JobFailure) as e:
        scan.scan(path, progress=_noop, check_cancelled=_noop)
    assert str(e.value) == "the file has no points"


def test_cancel_between_chunks(tmp_path):
    path = make_las(tmp_path / "g.las", 10_000)

    def cancel():
        raise JobCancelled()

    with pytest.raises(JobCancelled):
        scan.scan(path, progress=_noop, check_cancelled=cancel, chunk=1_000)
```

(`test_count_mismatch_is_recorded_and_the_scan_wins`: laspy stops at the header's count for uncompressed files, so the scanned count may equal it; what the test pins is that `header_count` carries the header's figure and nothing crashes. The importer records both in `source.json`.)

- [ ] **Step 4: Run them to verify they fail**

Run: `cd backend; & $PY -m pytest tests/test_pointcloud_crs.py tests/test_pointcloud_lasfile.py tests/test_pointcloud_scan.py -v`
Expected: FAIL — `ImportError` for `crs`, `lasfile`, `scan`.

- [ ] **Step 5: Write `crs.py`**

`backend/app/pointclouds/crs.py`:

```python
"""The cloud's coordinate system (spec §6.5): parsed from the header, never reprojected.

PotreeConverter drops the CRS, so it is stored here. A compound CRS gives its horizontal part as
`epsg`/`proj4`/`crs_wkt` and its vertical part's name as `vertical_crs`.
"""

from __future__ import annotations

import warnings
from dataclasses import dataclass
from typing import Any

from pyproj import CRS, Transformer
from pyproj.exceptions import CRSError

EDGE_SAMPLES = 21  # points per bbox edge when projecting to WGS84: edges curve


@dataclass(frozen=True)
class CrsInfo:
    crs_wkt: str | None = None
    epsg: int | None = None
    proj4: str | None = None
    vertical_crs: str | None = None
    warning: str | None = None

    @property
    def is_geographic(self) -> bool:
        return bool(self.crs_wkt) and CRS.from_wkt(self.crs_wkt).is_geographic


def crs_info(crs: CRS) -> CrsInfo:
    horizontal, vertical = crs, None
    if crs.is_compound:
        subs = crs.sub_crs_list
        horizontal = next((c for c in subs if c.is_projected or c.is_geographic), subs[0])
        vertical = next((c for c in subs if c.is_vertical), None)
    with warnings.catch_warnings():
        warnings.simplefilter("ignore", UserWarning)  # "you will likely lose ... information"
        proj4 = horizontal.to_proj4()
    return CrsInfo(
        crs_wkt=horizontal.to_wkt(),
        epsg=horizontal.to_epsg(),
        proj4=proj4,
        vertical_crs=vertical.name if vertical is not None else None,
    )


def crs_from_header(header: Any) -> CrsInfo:
    try:
        crs = header.parse_crs()
    except Exception as e:  # a corrupt VLR must not fail the import
        return CrsInfo(
            warning=f"the coordinate system in the file could not be read: {type(e).__name__}: {e}"
        )
    return crs_info(crs) if crs is not None else CrsInfo()


def crs_from_epsg(code: int) -> CrsInfo:
    try:
        return crs_info(CRS.from_epsg(code))
    except CRSError as e:
        raise ValueError(f"EPSG:{code} is not a known coordinate system") from e


def bounds_wgs84(bounds: list[float], crs_wkt: str) -> list[float]:
    minx, miny, _, maxx, maxy, _ = bounds
    xs: list[float] = []
    ys: list[float] = []
    for i in range(EDGE_SAMPLES):
        t = i / (EDGE_SAMPLES - 1)
        x, y = minx + t * (maxx - minx), miny + t * (maxy - miny)
        xs += [x, x, minx, maxx]
        ys += [miny, maxy, y, y]
    to_wgs84 = Transformer.from_crs(CRS.from_wkt(crs_wkt), CRS.from_epsg(4326), always_xy=True)
    lons, lats = to_wgs84.transform(xs, ys)
    return [float(min(lons)), float(min(lats)), float(max(lons)), float(max(lats))]
```

- [ ] **Step 6: Write `lasfile.py`**

`backend/app/pointclouds/lasfile.py`:

```python
"""Header-only inspection of a LAS/LAZ file (spec §4.1 op 3, §6.1): the header and VLRs, ≤ 1 MiB."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import date
from pathlib import Path
from typing import BinaryIO

import laspy

from app.jobs.cancellation import JobFailure
from app.pointclouds.crs import CrsInfo, crs_from_header

SUFFIXES = {".las", ".laz"}
RGB_FORMATS = {2, 3, 5, 7, 8, 10}


class UnsupportedCloud(JobFailure):
    """The file is not a LAS/LAZ laspy can read: 422 `unsupported_point_cloud` on the API."""


@dataclass(frozen=True)
class HeaderInfo:
    path: Path
    size: int
    compressed: bool
    las_version: str
    point_format: int
    point_count: int
    record_len: int
    has_rgb: bool
    header_bounds: list[float]
    scale: list[float]
    offsets: list[float]
    crs: CrsInfo
    captured_on: date | None
    vlrs: list[str]


def header_info(fileobj: BinaryIO, path: Path, size: int) -> HeaderInfo:
    try:
        with laspy.open(fileobj, closefd=False) as r:
            h = r.header
            try:
                captured_on = h.creation_date
            except (ValueError, OverflowError):  # day 0 / year 0 written by some exporters
                captured_on = None
            fmt = h.point_format
            return HeaderInfo(
                path=path,
                size=size,
                compressed=bool(h.are_points_compressed),
                las_version=f"{h.version.major}.{h.version.minor}",
                point_format=int(fmt.id),
                point_count=int(h.point_count),
                record_len=int(fmt.size),
                has_rgb=int(fmt.id) in RGB_FORMATS,
                header_bounds=[*map(float, h.mins), *map(float, h.maxs)],
                scale=[*map(float, h.scales)],
                offsets=[*map(float, h.offsets)],
                crs=crs_from_header(h),
                captured_on=captured_on,
                vlrs=[type(v).__name__ for v in h.vlrs],
            )
    except UnsupportedCloud:
        raise
    except Exception as e:
        raise UnsupportedCloud(f"this is not a readable LAS or LAZ file: {type(e).__name__}: {e}") from None


def inspect_file(path: Path) -> HeaderInfo:
    if path.suffix.lower() not in SUFFIXES:
        raise UnsupportedCloud(f"only .las and .laz point clouds can be imported (got {path.suffix.lower()})")
    size = path.stat().st_size
    with open(path, "rb") as f:
        return header_info(f, path, size)
```

- [ ] **Step 7: Write `scan.py`**

`backend/app/pointclouds/scan.py`:

```python
"""The chunked scan of the work copy (spec §6.4). Peak memory is one 2 M-point chunk plus a
≤ 2 M-value Z sample, whatever the file size."""

from __future__ import annotations

import math
from collections.abc import Callable
from dataclasses import dataclass
from pathlib import Path

import laspy
import numpy as np

from app.jobs.cancellation import JobFailure

CHUNK = 2_000_000
SAMPLE_MAX = 2_000_000
PERCENTILES = {"p01": 0.1, "p1": 1.0, "p5": 5.0, "p50": 50.0, "p95": 95.0, "p99": 99.0, "p999": 99.9}


@dataclass
class ScanResult:
    count: int
    header_count: int
    bounds: list[float]  # [minx, miny, minz, maxx, maxy, maxz], true, from scaled coordinates
    z_stats: dict
    class_counts: dict[str, int]


def scan(
    path: Path,
    *,
    progress: Callable[[int, int], None],
    check_cancelled: Callable[[], None],
    chunk: int = CHUNK,
) -> ScanResult:
    with laspy.open(path) as r:
        header_count = int(r.header.point_count)
        stride = max(1, math.ceil(max(header_count, 1) / SAMPLE_MAX))
        mins, maxs = np.full(3, np.inf), np.full(3, -np.inf)
        zsum, count = 0.0, 0
        hist = np.zeros(256, dtype=np.int64)
        samples: list[np.ndarray] = []
        sampled = 0
        for pts in r.chunk_iterator(chunk):
            check_cancelled()
            axes = (np.asarray(pts.x), np.asarray(pts.y), np.asarray(pts.z))
            for i, a in enumerate(axes):
                mins[i] = min(mins[i], float(a.min()))
                maxs[i] = max(maxs[i], float(a.max()))
            z = axes[2]
            zsum += float(z.sum())
            hist += np.bincount(np.asarray(pts.classification, dtype=np.uint8), minlength=256)
            picked = z[(-count) % stride :: stride].copy()  # every stride-th point by global index
            samples.append(picked)
            sampled += picked.size
            if sampled > 2 * SAMPLE_MAX:  # the header undercounted: thin what we hold, keep bounded
                merged = np.concatenate(samples)[::2]
                samples, sampled, stride = [merged], merged.size, stride * 2
            count += len(z)
            progress(count, header_count)
    if count == 0:
        raise JobFailure("the file has no points")
    sample = np.concatenate(samples)
    if sample.size > SAMPLE_MAX:
        sample = sample[:: math.ceil(sample.size / SAMPLE_MAX)]
    z_stats = {
        "min": float(mins[2]),
        "max": float(maxs[2]),
        "mean": zsum / count,
        "sample_count": int(sample.size),
    }
    for key, q in PERCENTILES.items():
        z_stats[key] = float(np.percentile(sample, q))
    return ScanResult(
        count=count,
        header_count=header_count,
        bounds=[*map(float, mins), *map(float, maxs)],
        z_stats=z_stats,
        class_counts={str(i): int(n) for i, n in enumerate(hist) if n},
    )
```

- [ ] **Step 8: Run the tests to verify they pass**

Run: `cd backend; & $PY -m pytest tests/test_pointcloud_crs.py tests/test_pointcloud_lasfile.py tests/test_pointcloud_scan.py -v`
Expected: PASS.

- [ ] **Step 9: Gate and commit**

```powershell
git add backend/app/pointclouds/crs.py backend/app/pointclouds/lasfile.py backend/app/pointclouds/scan.py backend/tests/test_pointcloud_crs.py backend/tests/test_pointcloud_lasfile.py backend/tests/test_pointcloud_scan.py
git commit -m "feat(pointclouds): header inspection, chunked scan with Z stats and class histogram, CRS parsing

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 5: Converter runner and octree validation (unit I1, part c)

**Files:**
- Create: `backend/app/pointclouds/winjob.py`
- Modify: `backend/app/pointclouds/converter.py` (replace F0's `NotImplementedError` body; keep the seam signature)
- Create: `backend/app/pointclouds/validate.py`
- Create: `backend/tests/fake_potreeconverter.py`
- Test: `backend/tests/test_pointcloud_converter.py`, `backend/tests/test_pointcloud_validate.py`

**Interfaces:**
- Consumes: `converter_path.require_converter()` (Task 2) — imported lazily inside `_exe_prefix()`, so this task's tests run before Task 2 merges.
- Produces:
  - `converter.ConverterResult` (F0's frozen dataclass, kept exactly: `octree_dir: Path`, `log_tail: list[str]`, `command: list[str]`, `seconds: float`, `encoding: str = "BROTLI"`, `version: str = "2.1.5"`; this task re-states it verbatim when it replaces the module body and adds no field).
  - `converter.run_converter(input_path: Path, out_dir: Path, *, progress: Callable[[float, str], None], check_cancelled: Callable[[], None]) -> ConverterResult` — `progress` gets the converter's own 0–1 fraction; `input_path` and `out_dir` must share a parent (the work folder).
  - `converter.ConverterStopped(JobFailure)` with `.log_tail: list[str]` (a non-zero exit); `converter.parse_progress(line) -> tuple[float, str] | None`; `converter.WAITING = "waiting for another point-cloud import"`; `converter.ENCODING = "BROTLI"`; `converter.terminate_tree(proc)`; seam `converter._exe_prefix() -> list[str]`.
  - `winjob.kill_on_close(proc: subprocess.Popen) -> int` (job handle), `winjob.close(handle) -> None`.
  - `validate.validate_octree(octree: Path, *, points: int, bounds: list[float], encoding: str) -> dict` (the parsed metadata; raises `JobFailure`).

- [ ] **Step 1: Write the fake converter**

`backend/tests/fake_potreeconverter.py`:

```python
"""Stand-in for PotreeConverter.exe in the runner tests; launched as a script, never imported.

Mode from FAKE_PC_MODE: `ok` prints recorded progress lines and writes <outdir>/done.txt; `slow` is
`ok` with sleeps and writes start/end times to FAKE_PC_TIMES; `fail` prints an ERROR line and exits
123; `sleep` spawns a sleeping grandchild, writes both pids to FAKE_PC_PIDS and sleeps; `argv`
writes its argv and cwd to FAKE_PC_ARGV.
"""

import json
import os
import subprocess
import sys
import time
from pathlib import Path

LINES = [
    "#threads: 24",
    "=== COUNTING",
    "[67%, 1s], [DISTRIBUTING: 100%, duration: 0s, throughput: 73MPs][RAM: 0.2GB (highest 0.7GB), CPU: 39%]",
    "sampling: 2.992121s",
    "[80%, 3s], [INDEXING: 39%, duration: 1s, throughput: 8MPs][RAM: 0.4GB (highest 1.5GB), CPU: 68%]",
    "[97%, 9s], [INDEXING: 96%, duration: 7s, throughput: 3MPs][RAM: 0.1GB (highest 1.5GB), CPU: 1%]",
    "metadata & hierarchy: 7.890049s",
]


def main() -> int:
    mode = os.environ.get("FAKE_PC_MODE", "ok")
    args = sys.argv[1:]
    out = Path(args[args.index("-o") + 1]) if "-o" in args else Path("octree")
    if mode == "argv":
        Path(os.environ["FAKE_PC_ARGV"]).write_text(json.dumps({"argv": args, "cwd": os.getcwd()}), "utf-8")
        return 0
    if mode == "fail":
        print("=== COUNTING", flush=True)
        print("ERROR(chunker_countsort_laszip.cpp:248): encountered point outside bounding box.", flush=True)
        print("PotreeConverter requires a valid bounding box to operate.", flush=True)
        return 123
    if mode == "sleep":
        child = subprocess.Popen([sys.executable, "-c", "import time; time.sleep(120)"])
        Path(os.environ["FAKE_PC_PIDS"]).write_text(json.dumps([os.getpid(), child.pid]), "utf-8")
        time.sleep(120)
        return 0
    start = time.time()
    for line in LINES:
        print(line, flush=True)
        if mode == "slow":
            time.sleep(0.1)
    out.mkdir(parents=True, exist_ok=True)
    (out / "done.txt").write_text("ok", "utf-8")
    if mode == "slow":
        with open(os.environ["FAKE_PC_TIMES"], "a", encoding="utf-8") as f:
            f.write(f"{start} {time.time()}\n")
    return 0


if __name__ == "__main__":
    sys.exit(main())
```

- [ ] **Step 2: Write the failing runner tests**

`backend/tests/test_pointcloud_converter.py`:

```python
"""Running PotreeConverter (spec §6.7): progress parsing, failures, cancel, the lock, the Job Object."""

import json
import os
import subprocess
import sys
import threading
import time
from pathlib import Path

import psutil
import pytest

from app.jobs.cancellation import JobCancelled, JobFailure
from app.pointclouds import converter

FAKE = Path(__file__).resolve().parent / "fake_potreeconverter.py"


@pytest.fixture
def fake(monkeypatch):
    monkeypatch.setattr(converter, "_exe_prefix", lambda: [sys.executable, str(FAKE)])

    def use(mode: str, **env):
        monkeypatch.setenv("FAKE_PC_MODE", mode)
        for k, v in env.items():
            monkeypatch.setenv(k, str(v))

    return use


def _work(tmp_path: Path, name: str = "work") -> tuple[Path, Path]:
    work = tmp_path / name
    work.mkdir(parents=True)
    (work / "input.las").write_bytes(b"LASF")
    return work / "input.las", work / "octree"


def _never():
    return None


def _alive(pid: int) -> bool:
    try:
        return psutil.Process(pid).status() != psutil.STATUS_ZOMBIE
    except psutil.NoSuchProcess:
        return False


def test_parse_progress_on_recorded_spike_lines():
    line = "[67%, 1s], [DISTRIBUTING: 100%, duration: 0s, throughput: 73MPs][RAM: 0.2GB, CPU: 39%]"
    assert converter.parse_progress(line) == (0.67, "building the 3D view copy: DISTRIBUTING 100 %")
    assert converter.parse_progress("[80%, 3s], [INDEXING: 39%, duration: 1s, throughput: 8MPs]") == (
        0.80,
        "building the 3D view copy: INDEXING 39 %",
    )
    for line in ["sampling: 2.992121s", "#points: 21'697'184", "", "[80%, 3s]"]:
        assert converter.parse_progress(line) is None


def test_a_run_reports_progress_and_keeps_the_log(fake, tmp_path):
    fake("ok")
    src, out = _work(tmp_path)
    seen: list[tuple[float, str]] = []
    result = converter.run_converter(
        src, out, progress=lambda f, m: seen.append((f, m)), check_cancelled=_never
    )
    assert (out / "done.txt").read_text("utf-8") == "ok"
    assert seen[-1] == (0.97, "building the 3D view copy: INDEXING 96 %")
    assert result.log_tail[-1] == "metadata & hierarchy: 7.890049s" and result.encoding == "BROTLI"
    assert result.command[-5:] == ["input.las", "-o", "octree", "--encoding", "BROTLI"]
    assert result.octree_dir == out and result.seconds > 0


def test_argv_is_relative_ascii_from_the_work_folder(fake, tmp_path):
    """Review Focus 1: the project path has spaces and non-ASCII characters."""
    record = tmp_path / "argv.json"
    fake("argv", FAKE_PC_ARGV=record)
    src, out = _work(tmp_path / "Chimney stack 3D — Kuwait" / "جديد", ".work")
    converter.run_converter(src, out, progress=lambda *_: None, check_cancelled=_never)
    got = json.loads(record.read_text("utf-8"))
    assert got["argv"] == ["input.las", "-o", "octree", "--encoding", "BROTLI"]
    assert Path(got["cwd"]) == src.parent


def test_nonzero_exit_is_a_readable_failure(fake, tmp_path):
    fake("fail")
    src, out = _work(tmp_path)
    with pytest.raises(JobFailure) as e:
        converter.run_converter(src, out, progress=lambda *_: None, check_cancelled=_never)
    assert str(e.value) == (
        "the point-cloud converter stopped: "
        "ERROR(chunker_countsort_laszip.cpp:248): encountered point outside bounding box."
    )
    assert isinstance(e.value, converter.ConverterStopped)
    assert e.value.log_tail[-1] == "PotreeConverter requires a valid bounding box to operate."


def test_cancel_kills_the_whole_tree(fake, tmp_path):
    pids_file = tmp_path / "pids.json"
    fake("sleep", FAKE_PC_PIDS=pids_file)
    src, out = _work(tmp_path)
    cancel = threading.Event()

    def check():
        if cancel.is_set():
            raise JobCancelled()

    errors: list[BaseException] = []
    t = threading.Thread(
        target=lambda: _capture(
            errors, lambda: converter.run_converter(src, out, progress=lambda *_: None, check_cancelled=check)
        )
    )
    t.start()
    deadline = time.time() + 20
    while not pids_file.exists() and time.time() < deadline:
        time.sleep(0.05)
    pids = json.loads(pids_file.read_text("utf-8"))
    cancel.set()
    t.join(15)
    assert errors and isinstance(errors[0], JobCancelled)
    deadline = time.time() + 5
    while any(_alive(p) for p in pids) and time.time() < deadline:
        time.sleep(0.1)
    assert not any(_alive(p) for p in pids)


def _capture(errors, fn):
    try:
        fn()
    except BaseException as e:  # noqa: BLE001 - the test inspects it
        errors.append(e)


def test_the_lock_serialises_two_imports(fake, tmp_path):
    times = tmp_path / "times.txt"
    fake("slow", FAKE_PC_TIMES=times)
    a = _work(tmp_path, "a")
    b = _work(tmp_path, "b")
    threads = [
        threading.Thread(
            target=converter.run_converter,
            args=w,
            kwargs={"progress": lambda *_: None, "check_cancelled": _never},
        )
        for w in (a, b)
    ]
    for t in threads:
        t.start()
    for t in threads:
        t.join(30)
    (s1, e1), (s2, e2) = sorted(
        tuple(map(float, line.split())) for line in times.read_text("utf-8").splitlines()
    )
    assert s2 >= e1


def test_a_waiting_import_can_be_cancelled(fake, tmp_path):
    record = tmp_path / "argv.json"
    fake("argv", FAKE_PC_ARGV=record)
    src, out = _work(tmp_path)
    messages: list[str] = []
    started = time.monotonic()

    def cancel_after_half_a_second():
        if time.monotonic() - started > 0.5:
            raise JobCancelled()

    converter._LOCK.acquire()
    try:
        with pytest.raises(JobCancelled):
            converter.run_converter(
                src, out, progress=lambda f, m: messages.append(m), check_cancelled=cancel_after_half_a_second
            )
    finally:
        converter._LOCK.release()
    assert messages == ["waiting for another point-cloud import"]
    assert not record.exists()


PARENT = """
import json, sys
sys.path.insert(0, {backend!r})
from pathlib import Path
from app.pointclouds import converter
converter._exe_prefix = lambda: [sys.executable, {fake!r}]
converter.run_converter(Path({src!r}), Path({out!r}), progress=lambda *a: None, check_cancelled=lambda: None)
"""


@pytest.mark.skipif(os.name != "nt", reason="Windows Job Object")
def test_killing_the_parent_kills_the_converter(tmp_path, backend_dir, monkeypatch):
    pids_file = tmp_path / "pids.json"
    src, out = _work(tmp_path)
    env = {**os.environ, "FAKE_PC_MODE": "sleep", "FAKE_PC_PIDS": str(pids_file)}
    code = PARENT.format(backend=str(backend_dir), fake=str(FAKE), src=str(src), out=str(out))
    parent = subprocess.Popen([sys.executable, "-c", code], cwd=backend_dir, env=env)
    deadline = time.time() + 30
    while not pids_file.exists() and time.time() < deadline:
        time.sleep(0.05)
    converter_pid, _grandchild = json.loads(pids_file.read_text("utf-8"))
    parent.kill()  # like a sidecar crash: no finally block runs
    parent.wait(10)
    deadline = time.time() + 5
    while _alive(converter_pid) and time.time() < deadline:
        time.sleep(0.1)
    assert not _alive(converter_pid)
```

- [ ] **Step 3: Write the failing validation tests**

`backend/tests/test_pointcloud_validate.py`:

```python
"""Validation of the converter's output (spec §6.8): each defect fails readably."""

import json

import pytest

from app.jobs.cancellation import JobFailure
from app.pointclouds.validate import validate_octree

BOUNDS = [0.0, 0.0, 0.0, 10.0, 10.0, 5.0]


def _octree(tmp_path, **meta_overrides):
    d = tmp_path / "octree"
    d.mkdir()
    meta = {
        "version": "2.0",
        "encoding": "BROTLI",
        "points": 1000,
        "spacing": 0.5,
        "boundingBox": {"min": [-0.001, -0.001, -0.001], "max": [10.001, 10.001, 10.001]},
        "hierarchy": {"firstChunkSize": 22, "stepSize": 4, "depth": 1},
    }
    meta.update(meta_overrides)
    (d / "metadata.json").write_text(json.dumps(meta), "utf-8")
    (d / "hierarchy.bin").write_bytes(b"\0" * 22)
    (d / "octree.bin").write_bytes(b"\0" * 100)
    return d


def test_a_good_octree_passes(tmp_path):
    assert validate_octree(_octree(tmp_path), points=1000, bounds=BOUNDS, encoding="BROTLI")["spacing"] == 0.5


@pytest.mark.parametrize(
    ("override", "fragment"),
    [
        ({"points": 999}, "999 points, expected 1000"),
        ({"encoding": "DEFAULT"}, "encoding 'DEFAULT', expected 'BROTLI'"),
        ({"version": "1.8"}, "version '1.8', expected '2.0'"),
        ({"spacing": 0}, "spacing 0"),
        ({"boundingBox": {"min": [0, 0, 0], "max": [9, 10, 10]}}, "bounding box does not contain the cloud"),
    ],
)
def test_each_defect_fails_readably(tmp_path, override, fragment):
    with pytest.raises(JobFailure) as e:
        validate_octree(_octree(tmp_path, **override), points=1000, bounds=BOUNDS, encoding="BROTLI")
    assert str(e.value).startswith("the 3D view copy failed its checks: ") and fragment in str(e.value)


@pytest.mark.parametrize("name", ["metadata.json", "hierarchy.bin", "octree.bin"])
def test_missing_files_fail(tmp_path, name):
    d = _octree(tmp_path)
    (d / name).unlink()
    with pytest.raises(JobFailure) as e:
        validate_octree(d, points=1000, bounds=BOUNDS, encoding="BROTLI")
    assert name in str(e.value)


def test_short_hierarchy_fails(tmp_path):
    d = _octree(tmp_path)
    (d / "hierarchy.bin").write_bytes(b"\0" * 10)
    with pytest.raises(JobFailure) as e:
        validate_octree(d, points=1000, bounds=BOUNDS, encoding="BROTLI")
    assert "hierarchy.bin is 10 bytes, shorter than its first chunk (22)" in str(e.value)
```

- [ ] **Step 4: Run them to verify they fail**

Run: `cd backend; & $PY -m pytest tests/test_pointcloud_converter.py tests/test_pointcloud_validate.py -v`
Expected: FAIL — `NotImplementedError` from F0's seam and `ModuleNotFoundError: No module named 'app.pointclouds.validate'`.

- [ ] **Step 5: Write `winjob.py`**

`backend/app/pointclouds/winjob.py`:

```python
"""A Windows Job Object with KILL_ON_JOB_CLOSE (spec §2 "Orphan converters").

The handle lives as long as this process holds it: if the sidecar crashes, Windows closes it and
kills the converter, so the startup sweep never deletes a folder a live orphan is still writing.
"""

from __future__ import annotations

import ctypes
import subprocess
from ctypes import wintypes

JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE = 0x2000
_EXTENDED_LIMIT_INFORMATION = 9


class _IoCounters(ctypes.Structure):
    _fields_ = [
        (name, ctypes.c_ulonglong)
        for name in (
            "ReadOperationCount",
            "WriteOperationCount",
            "OtherOperationCount",
            "ReadTransferCount",
            "WriteTransferCount",
            "OtherTransferCount",
        )
    ]


class _BasicLimits(ctypes.Structure):
    _fields_ = [
        ("PerProcessUserTimeLimit", ctypes.c_longlong),
        ("PerJobUserTimeLimit", ctypes.c_longlong),
        ("LimitFlags", wintypes.DWORD),
        ("MinimumWorkingSetSize", ctypes.c_size_t),
        ("MaximumWorkingSetSize", ctypes.c_size_t),
        ("ActiveProcessLimit", wintypes.DWORD),
        ("Affinity", ctypes.c_size_t),
        ("PriorityClass", wintypes.DWORD),
        ("SchedulingClass", wintypes.DWORD),
    ]


class _ExtendedLimits(ctypes.Structure):
    _fields_ = [
        ("BasicLimitInformation", _BasicLimits),
        ("IoInfo", _IoCounters),
        ("ProcessMemoryLimit", ctypes.c_size_t),
        ("JobMemoryLimit", ctypes.c_size_t),
        ("PeakProcessMemoryUsed", ctypes.c_size_t),
        ("PeakJobMemoryUsed", ctypes.c_size_t),
    ]


def _kernel32():
    k32 = ctypes.WinDLL("kernel32", use_last_error=True)
    k32.CreateJobObjectW.restype = wintypes.HANDLE
    k32.CreateJobObjectW.argtypes = [ctypes.c_void_p, wintypes.LPCWSTR]
    k32.SetInformationJobObject.argtypes = [wintypes.HANDLE, ctypes.c_int, ctypes.c_void_p, wintypes.DWORD]
    k32.AssignProcessToJobObject.argtypes = [wintypes.HANDLE, wintypes.HANDLE]
    k32.CloseHandle.argtypes = [wintypes.HANDLE]
    return k32


def kill_on_close(proc: subprocess.Popen) -> int:
    k32 = _kernel32()
    job = k32.CreateJobObjectW(None, None)
    if not job:
        raise ctypes.WinError(ctypes.get_last_error())
    info = _ExtendedLimits()
    info.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE
    ok = k32.SetInformationJobObject(
        job, _EXTENDED_LIMIT_INFORMATION, ctypes.byref(info), ctypes.sizeof(info)
    )
    if not ok or not k32.AssignProcessToJobObject(job, wintypes.HANDLE(int(proc._handle))):
        err = ctypes.get_last_error()
        k32.CloseHandle(job)
        raise ctypes.WinError(err)
    return job


def close(job: int) -> None:
    _kernel32().CloseHandle(job)
```

- [ ] **Step 6: Replace the body of `converter.py`**

`backend/app/pointclouds/converter.py` (keep any F0 docstring lines that name the seam; the whole module becomes):

```python
"""Run PotreeConverter out of process (spec §6.7).

One converter at a time per process (a module lock; a second import waits, cancellably). The
converter runs in the work folder with relative ASCII arguments only, inside a Job Object that kills
it if this process dies; cancel kills its tree with taskkill /T /F. `run_converter` is the seam the
test fixture replaces (gotcha: contract jobs need offline seams).
"""

from __future__ import annotations

import collections
import os
import re
import subprocess
import threading
import time
from collections.abc import Callable
from dataclasses import dataclass
from pathlib import Path

from app.jobs.cancellation import JobCancelled, JobFailure

ENCODING = "BROTLI"
LOG_LINES = 200
WAITING = "waiting for another point-cloud import"
PROGRESS_RE = re.compile(r"^\[(\d+)%, (\d+)s\], \[([A-Z]+): (\d+)%")
CREATE_NO_WINDOW = 0x08000000
TERMINATE_GRACE_S = 10
_LOCK = threading.Lock()


class ConverterStopped(JobFailure):
    """A non-zero exit; carries the converter's last lines for the job log (spec §6.7)."""

    def __init__(self, message: str, log_tail: list[str]):
        super().__init__(message)
        self.log_tail = log_tail


@dataclass(frozen=True)
class ConverterResult:
    """What a finished conversion reports. F0's dataclass, re-stated verbatim; never changed here."""

    octree_dir: Path  # holds metadata.json, hierarchy.bin and octree.bin
    log_tail: list[str]  # the converter's last output lines, at most 200
    command: list[str]  # the command line, for source.json
    seconds: float
    encoding: str = "BROTLI"  # what metadata.json must say; the offline fake reports "DEFAULT"
    version: str = "2.1.5"  # the PotreeConverter version, for source.json


def parse_progress(line: str) -> tuple[float, str] | None:
    m = PROGRESS_RE.match(line.strip())
    if not m:
        return None
    overall, _seconds, stage, pct = m.groups()
    return int(overall) / 100, f"building the 3D view copy: {stage} {int(pct)} %"


def _exe_prefix() -> list[str]:
    from app.pointclouds.converter_path import require_converter

    return [str(require_converter())]


def terminate_tree(proc: subprocess.Popen) -> None:
    """Take the converter and anything it started down; only ever our own process tree."""
    if proc.poll() is not None:
        return
    if os.name == "nt":
        subprocess.run(["taskkill", "/T", "/F", "/PID", str(proc.pid)], capture_output=True, check=False)  # noqa: S603, S607
    else:
        proc.kill()
    try:
        proc.wait(TERMINATE_GRACE_S)
    except subprocess.TimeoutExpired:
        proc.kill()
        proc.wait(5)


def _last_error(lines: list[str], code: int) -> str:
    for line in reversed(lines):
        if "ERROR" in line:
            return line.strip()
    for line in reversed(lines):
        if line.strip():
            return line.strip()
    return f"exit code {code}"


def _acquire(progress: Callable[[float, str], None], check_cancelled: Callable[[], None]) -> None:
    if _LOCK.acquire(blocking=False):
        return
    progress(0.0, WAITING)
    while not _LOCK.acquire(timeout=0.25):
        check_cancelled()


def run_converter(
    input_path: Path,
    out_dir: Path,
    *,
    progress: Callable[[float, str], None],
    check_cancelled: Callable[[], None],
) -> ConverterResult:
    work = input_path.parent
    if out_dir.parent != work:
        raise ValueError("the converter's input and output must share the work folder")
    _acquire(progress, check_cancelled)
    try:
        return _run(work, input_path.name, out_dir.name, progress, check_cancelled)
    finally:
        _LOCK.release()


def _run(work: Path, input_name: str, out_name: str, progress, check_cancelled) -> ConverterResult:
    command = [*_exe_prefix(), input_name, "-o", out_name, "--encoding", ENCODING]
    tail: collections.deque[str] = collections.deque(maxlen=LOG_LINES)
    latest: list[tuple[float, str] | None] = [None]
    started = time.monotonic()
    proc = subprocess.Popen(  # noqa: S603 - our own converter, no shell
        command,
        cwd=work,
        stdin=subprocess.DEVNULL,
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        text=True,
        encoding="utf-8",
        errors="replace",
        creationflags=CREATE_NO_WINDOW if os.name == "nt" else 0,
    )
    job = None
    try:
        if os.name == "nt":
            from app.pointclouds import winjob

            job = winjob.kill_on_close(proc)

        def pump() -> None:
            for raw in proc.stdout:
                line = raw.rstrip("\r\n")
                tail.append(line)
                parsed = parse_progress(line)
                if parsed:
                    latest[0] = parsed

        reader = threading.Thread(target=pump, name="potreeconverter-stdout", daemon=True)
        reader.start()
        reported = None
        while proc.poll() is None:
            try:
                check_cancelled()
            except JobCancelled:
                terminate_tree(proc)
                raise
            if latest[0] is not None and latest[0] != reported:
                reported = latest[0]
                progress(*reported)
            time.sleep(0.2)
        reader.join(5)
        if latest[0] is not None and latest[0] != reported:
            progress(*latest[0])
    finally:
        if proc.poll() is None:
            terminate_tree(proc)
        if job is not None:
            from app.pointclouds import winjob

            winjob.close(job)
    lines = list(tail)
    if proc.returncode != 0:
        raise ConverterStopped(
            f"the point-cloud converter stopped: {_last_error(lines, proc.returncode)}", lines
        )
    return ConverterResult(
        octree_dir=work / out_name,
        log_tail=lines,
        command=command,
        seconds=time.monotonic() - started,
        encoding=ENCODING,
    )
```

The dataclass is F0's, field for field (including `encoding` and `version` with their defaults), so F0's `fake_run_converter` — which already reports `encoding="DEFAULT"` — constructs it unchanged.

- [ ] **Step 7: Write `validate.py`**

`backend/app/pointclouds/validate.py`:

```python
"""Checks on the converter's output before it becomes the cloud's display copy (spec §6.8)."""

from __future__ import annotations

import json
from pathlib import Path

from app.jobs.cancellation import JobFailure

TOLERANCE = 1e-6


def validate_octree(octree: Path, *, points: int, bounds: list[float], encoding: str) -> dict:
    try:
        meta = json.loads((octree / "metadata.json").read_text("utf-8"))
    except (OSError, ValueError) as e:
        raise JobFailure(
            f"the 3D view copy failed its checks: metadata.json could not be read ({e})"
        ) from None
    problems: list[str] = []
    if meta.get("version") != "2.0":
        problems.append(f"version {meta.get('version')!r}, expected '2.0'")
    if meta.get("encoding") != encoding:
        problems.append(f"encoding {meta.get('encoding')!r}, expected {encoding!r}")
    if meta.get("points") != points:
        problems.append(f"{meta.get('points')} points, expected {points}")
    box = meta.get("boundingBox") or {}
    lo, hi = box.get("min"), box.get("max")
    inside = (
        isinstance(lo, list)
        and isinstance(hi, list)
        and all(lo[i] <= bounds[i] + TOLERANCE for i in range(3))
        and all(hi[i] >= bounds[i + 3] - TOLERANCE for i in range(3))
    )
    if not inside:
        problems.append("its bounding box does not contain the cloud")
    spacing = meta.get("spacing")
    if not isinstance(spacing, (int, float)) or spacing <= 0:
        problems.append(f"spacing {spacing}")
    hierarchy, data = octree / "hierarchy.bin", octree / "octree.bin"
    if not hierarchy.is_file():
        problems.append("hierarchy.bin is missing")
    else:
        first = int((meta.get("hierarchy") or {}).get("firstChunkSize", 0))
        size = hierarchy.stat().st_size
        if size < first or first <= 0:
            problems.append(f"hierarchy.bin is {size} bytes, shorter than its first chunk ({first})")
    if not data.is_file() or data.stat().st_size == 0:
        problems.append("octree.bin is missing or empty")
    if problems:
        raise JobFailure("the 3D view copy failed its checks: " + "; ".join(problems))
    return meta
```

- [ ] **Step 8: (no step) F0's fake already reports its encoding**

F0's `tests/pointclouds.py::fake_run_converter` returns `ConverterResult(..., encoding="DEFAULT")`, which is what validation compares `metadata.json` with (plan decision 2). Nothing in `tests/pointclouds.py` changes in this task.

- [ ] **Step 9: Run the tests to verify they pass**

Run: `cd backend; & $PY -m pytest tests/test_pointcloud_converter.py tests/test_pointcloud_validate.py -v`
Expected: PASS (the Job Object test runs on Windows only).

- [ ] **Step 10: Gate and commit**

```powershell
git add backend/app/pointclouds/winjob.py backend/app/pointclouds/converter.py backend/app/pointclouds/validate.py backend/tests/fake_potreeconverter.py backend/tests/test_pointcloud_converter.py backend/tests/test_pointcloud_validate.py
git commit -m "feat(pointclouds): PotreeConverter runner with Job Object, lock, cancel and progress; octree validation

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 6: CloudViewer and the e2e octree fixture (unit V1)

Load `impeccable` and `emil-design-eng` with `DESIGN.md` first. The working reference is the spike's `E:\Dev\Yolo\app\.claude\worktrees\pointcloud-spike\frontend\src\spike\PointCloudSpike.tsx` (throwaway; read it, do not copy its globals).

**Files:**
- Create: `frontend/src/api/clouds.ts`
- Create: `frontend/src/clouds/viewer/requestManager.ts`, `materialOptions.ts`, `budget.ts`, `uncertainty.ts`, `camera.ts`, `idle.ts`, `overlay.ts`, `diagnostics.ts` (each with a `.test.ts`)
- Create: `frontend/src/clouds/CloudViewer.tsx`
- Create: `frontend/src/test/cloudFixtures.ts`
- Modify: `frontend/src/screens/CloudsScreen.tsx` (F0's empty screen → a minimal host for the viewer; Task 13 replaces it)
- Modify: F0's `frontend/src/screens/foundationScreens.test.tsx` and `frontend/src/app/lazyScreens.test.tsx` (the Clouds screen now needs the API context and a route)
- Create: `frontend/e2e/fixtures/potreeOctree.ts`, `frontend/e2e/fixtures/clouds.ts`, `frontend/e2e/clouds.spec.ts`
- Modify: `frontend/playwright.config.ts` (WebGL launch flags)

**Interfaces:**
- Consumes (F0): `cloudOctreeUrl(baseUrl, projectId, cloudId)` (no token), `components["schemas"]["PointCloudOut"]`, the `cloud` icon, the lazy `CloudsScreen` route and its F0 tests.
- Produces:
  - `api/clouds.ts`: `type PointCloud = components["schemas"]["PointCloudOut"]`; `fetchPointCloud(api, projectId, cloudId): Promise<PointCloud>`.
  - `viewer/requestManager.ts`: `interface OctreeRequestManager { fetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response>; getUrl(url: string): Promise<string> }`; `withToken(url, token): string`; `metadataUrl(url): string` (strips the query; must end in `/metadata.json`); `makeRequestManager(token, fetchImpl?): OctreeRequestManager` (a non-2xx response throws `Error(<envelope message>)`).
  - `viewer/materialOptions.ts`: `type ColourMode = "rgb" | "elevation"`; `interface MaterialOptions { inputColorEncoding: 1; outputColorEncoding: 1; pointSizeType: 2; pointColorType: 0 | 3; size: number; elevationRange: [number, number] }`; `makeMaterialOptions({ colour, elevationRange, pointSize }): MaterialOptions`; `defaultColour(hasRgb): ColourMode`; `defaultElevationRange(cloud): [number, number]`; `POINT_SIZE_MIN = 0.5`, `POINT_SIZE_MAX = 3`.
  - `viewer/budget.ts`: `BUDGETS`, `DEFAULT_BUDGET = 3_000_000`, `BUDGET_KEY = "kestrel.clouds.pointBudget"`, `readBudget(storage?): number`, `writeBudget(n, storage?): void`.
  - `viewer/uncertainty.ts`: `WARN_UNCERTAINTY_M = 0.1`; `pickUncertainty(rootSpacing, level): number`; `interface NodeBox { level: number; min: [number, number, number]; max: [number, number, number] }`; `deepestLevelAt(nodes, p): number | null`.
  - `viewer/camera.ts`: `type Bounds6 = [number, number, number, number, number, number]`; `interface Vec3 { x: number; y: number; z: number }`; `siteDiagonal(b)`, `nearFar(distance, diagonal): { near; far }`, `southOblique(target, distance, elevationDeg = 45): Vec3`, `wholeSiteView(b): { target: Vec3; position: Vec3 }`, `topView(b): { target: Vec3; position: Vec3 }`, `jumpDistance(footprintDiagonal): number` (= `max(40, 3 × d)`).
  - `viewer/idle.ts`: `IDLE_AFTER_MS = 1000`; `shouldKeepRendering({ nodesLoading, pendingLoads, lastActivityAt, now, hidden }): boolean`.
  - `viewer/overlay.ts`: `type OverlayTone = "accent" | "ok" | "warn"`; `type OverlayShape = { kind: "line"; points: Vec3[]; closed?: boolean; tone: OverlayTone } | { kind: "points"; points: Vec3[]; tone: OverlayTone }`; `localPositions(points, origin, closed?): Float32Array`; `tokenRgb(name, el?): [number, number, number]`.
  - `viewer/diagnostics.ts`: `DIAGNOSTICS_KEY = "kestrel.diagnostics"`; `diagnosticsEnabled(storage?)`; `interface ViewerStats { numVisiblePoints; visibleNodes; nodesLoading; firstPointsMs: number | null; settledMs: number | null; errors: string[]; contextLost: boolean; cameraDistance: number }`; `interface ColourSample { total; background; red; green; white }`; `classifyPixels(rgba, background, tolerance = 6): ColourSample`; `interface CloudViewerDiagnostics { stats(): ViewerStats; sampleColours(): ColourSample; pickCenter(): CloudPick | null; overlays(): string[] }` on `window.__kestrelCloudViewer` (read-only).
  - `CloudViewer.tsx`: `interface CloudPick { x: number; y: number; z: number; level: number; uncertainty_m: number }`; `interface CloudViewerHandle { fit(): void; topView(): void; lookAt(target: Vec3, distance: number): void; pickAtClient(clientX: number, clientY: number): CloudPick | null; project(p: Vec3): { x: number; y: number } | null; setOverlay(key: string, shapes: OverlayShape[]): void; stats(): ViewerStats }`; `interface CloudViewerProps { cloud: PointCloud; octreeUrl: string; token: string; budget: number; colour: ColourMode; elevationRange: [number, number]; pointSize: number; armed?: boolean; onPick?(p: CloudPick): void; onHover?(p: CloudPick | null): void; onDoublePick?(p: CloudPick): void }`; `CloudViewer = forwardRef<CloudViewerHandle, CloudViewerProps>`. The canvas has `data-testid="cloud-canvas"`.
  - `test/cloudFixtures.ts`: `CLOUD_ID`, `exampleCloud: PointCloud` (the chimney's shape).
  - `e2e/fixtures/potreeOctree.ts`: `interface FixturePoint { x; y; z; r; g; b }` (colours 0–255); `buildOctree(points, scale = 0.001): OctreeFiles`; `redGreenGrid({ origin, size, step }): FixturePoint[]`; `routeOctree(page, cloudId, files): Promise<string[]>` (returns the list it appends every served request to, e.g. `"hierarchy.bin bytes=0-21"`).
  - `e2e/fixtures/clouds.ts`: `CLOUD`, `cloudJson(overrides)`, `jsonRoute(page, pathname, body, status?)`.

- [ ] **Step 1: Write the failing unit tests for the pure viewer modules**

`frontend/src/clouds/viewer/requestManager.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";
import { makeRequestManager, metadataUrl, withToken } from "./requestManager";

const META = "http://127.0.0.1:8765/api/v1/projects/p/pointclouds/c/octree/metadata.json";

describe("octree request manager", () => {
  it("appends the token once", async () => {
    const rm = makeRequestManager("s3cret");
    const url = await rm.getUrl(META);
    expect(url).toBe(`${META}?token=s3cret`);
    expect(await rm.getUrl(url)).toBe(url);
    expect(withToken(`${META}?token=already`, "other")).toBe(`${META}?token=already`);
  });

  it("keeps the token through potree-core's /metadata.json replace", async () => {
    const url = await makeRequestManager("s3cret").getUrl(META);
    expect(url.replace("/metadata.json", "/octree.bin")).toBe(
      META.replace("metadata.json", "octree.bin") + "?token=s3cret",
    );
    expect(url.replace("/metadata.json", "/hierarchy.bin")).toContain("/hierarchy.bin?token=s3cret");
  });

  it("passes requests through and turns an error envelope into its message", async () => {
    const ok = new Response("{}", { status: 206 });
    const missing = new Response(
      JSON.stringify({
        error: {
          code: "octree_missing",
          message: "the 3D view copy is missing; import the file again",
          details: {},
        },
      }),
      { status: 404, headers: { "content-type": "application/json" } },
    );
    const fetchImpl = vi.fn().mockResolvedValueOnce(ok).mockResolvedValueOnce(missing);
    const rm = makeRequestManager("t", fetchImpl);
    expect(await rm.fetch("u1", { headers: { Range: "bytes=0-21" } })).toBe(ok);
    expect(fetchImpl).toHaveBeenCalledWith("u1", { headers: { Range: "bytes=0-21" } });
    await expect(rm.fetch("u2")).rejects.toThrow("the 3D view copy is missing; import the file again");
  });

  it("names the status when the error body is not an envelope", async () => {
    const rm = makeRequestManager("t", vi.fn().mockResolvedValue(new Response("nope", { status: 500 })));
    await expect(rm.fetch("u")).rejects.toThrow("the 3D view copy could not be loaded (HTTP 500)");
  });

  it("hands potree-core a URL that ends in metadata.json", () => {
    // potree-core 2.0.15 picks its Potree 2 loader with url.endsWith("metadata.json"): a ?token=
    // on the URL passed to loadPointCloud silently selects the Potree 1 loader instead.
    expect(metadataUrl(`${META}?token=abc`)).toBe(META);
    expect(metadataUrl(META)).toBe(META);
    expect(() => metadataUrl("http://x/octree/octree.bin")).toThrow();
  });
});
```

`frontend/src/clouds/viewer/materialOptions.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { exampleCloud } from "@/test/cloudFixtures";
import { defaultColour, defaultElevationRange, makeMaterialOptions } from "./materialOptions";

describe("material options", () => {
  it("pins colour encoding 1/1 (the white-colour trap) and adaptive points", () => {
    const o = makeMaterialOptions({ colour: "rgb", elevationRange: [0, 10], pointSize: 1 });
    expect(o.inputColorEncoding).toBe(1);
    expect(o.outputColorEncoding).toBe(1);
    expect(o.pointSizeType).toBe(2);
    expect(o.pointColorType).toBe(0);
  });

  it("uses the HEIGHT colour type for elevation and clamps the point size", () => {
    expect(makeMaterialOptions({ colour: "elevation", elevationRange: [1, 2], pointSize: 9 })).toMatchObject({
      pointColorType: 3,
      size: 3,
      elevationRange: [1, 2],
    });
    expect(makeMaterialOptions({ colour: "rgb", elevationRange: [1, 2], pointSize: 0 }).size).toBe(0.5);
  });

  it("defaults to elevation without RGB, and to the p1-p99 range", () => {
    expect(defaultColour(true)).toBe("rgb");
    expect(defaultColour(false)).toBe("elevation");
    expect(defaultColour(null)).toBe("elevation");
    expect(defaultElevationRange(exampleCloud)).toEqual([-44.0, 170.0]);
    expect(defaultElevationRange({ ...exampleCloud, z_stats: null })).toEqual([-45, 175]);
  });
});
```

`frontend/src/clouds/viewer/budget.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { BUDGET_KEY, DEFAULT_BUDGET, readBudget, writeBudget } from "./budget";

function memory(initial: Record<string, string> = {}) {
  const data = { ...initial };
  return {
    getItem: (k: string) => data[k] ?? null,
    setItem: (k: string, v: string) => void (data[k] = v),
    data,
  };
}

describe("point budget", () => {
  it("reads a stored budget and writes one back", () => {
    const s = memory({ [BUDGET_KEY]: "5000000" });
    expect(readBudget(s)).toBe(5_000_000);
    writeBudget(8_000_000, s);
    expect(s.data[BUDGET_KEY]).toBe("8000000");
  });

  it("falls back to 3 M on anything else", () => {
    expect(readBudget(memory())).toBe(DEFAULT_BUDGET);
    expect(readBudget(memory({ [BUDGET_KEY]: "4000000" }))).toBe(DEFAULT_BUDGET);
    expect(readBudget(memory({ [BUDGET_KEY]: "lots" }))).toBe(DEFAULT_BUDGET);
    const throwing = {
      getItem: () => {
        throw new Error("SecurityError");
      },
      setItem: () => {
        throw new Error("x");
      },
    };
    expect(readBudget(throwing)).toBe(DEFAULT_BUDGET);
    expect(() => writeBudget(1_000_000, throwing)).not.toThrow();
    expect(readBudget(null)).toBe(DEFAULT_BUDGET);
  });
});
```

`frontend/src/clouds/viewer/uncertainty.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { deepestLevelAt, pickUncertainty, type NodeBox } from "./uncertainty";

describe("pick uncertainty", () => {
  it("halves the root spacing per level", () => {
    expect(pickUncertainty(4, 0)).toBe(4);
    expect(pickUncertainty(4, 7)).toBeCloseTo(0.03125, 12);
    expect(pickUncertainty(4.13, 3)).toBeCloseTo(0.51625, 12);
  });

  it("takes the deepest visible node that contains the pick", () => {
    const nodes: NodeBox[] = [
      { level: 0, min: [0, 0, 0], max: [100, 100, 100] },
      { level: 2, min: [0, 0, 0], max: [25, 25, 25] },
      { level: 5, min: [50, 50, 50], max: [53.125, 53.125, 53.125] },
    ];
    expect(deepestLevelAt(nodes, { x: 10, y: 10, z: 10 })).toBe(2);
    expect(deepestLevelAt(nodes, { x: 51, y: 52, z: 53 })).toBe(5);
    expect(deepestLevelAt(nodes, { x: 60, y: 60, z: 60 })).toBe(0);
    expect(deepestLevelAt(nodes, { x: -1, y: 0, z: 0 })).toBeNull();
  });
});
```

`frontend/src/clouds/viewer/camera.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  jumpDistance,
  nearFar,
  siteDiagonal,
  southOblique,
  topView,
  wholeSiteView,
  type Bounds6,
} from "./camera";

const B: Bounds6 = [243194, 3177915, -141, 243895, 3178616, 560];

describe("camera maths", () => {
  it("near and far follow the target distance and the site", () => {
    const d = siteDiagonal(B);
    expect(nearFar(10, d)).toEqual({ near: 0.05, far: 20 * d });
    expect(nearFar(1000, d).near).toBe(0.5);
    expect(nearFar(1e6, d).far).toBeGreaterThan(1e6);
  });

  it("puts the camera 45 degrees up from the south", () => {
    const p = southOblique({ x: 0, y: 0, z: 0 }, 100);
    expect(p.x).toBe(0);
    expect(p.y).toBeCloseTo(-70.7107, 3);
    expect(p.z).toBeCloseTo(70.7107, 3);
  });

  it("frames the whole site from the south and the top", () => {
    const w = wholeSiteView(B);
    expect(w.target.x).toBeCloseTo((B[0] + B[3]) / 2);
    expect(w.position.y).toBeLessThan(w.target.y);
    expect(w.position.z).toBeGreaterThan(w.target.z);
    const t = topView(B);
    expect(t.position.x).toBeCloseTo(t.target.x);
    expect(t.position.z - t.target.z).toBeGreaterThan(B[3] - B[0]);
  });

  it("jumps to at least 40 m, else three footprint diagonals", () => {
    expect(jumpDistance(0)).toBe(40);
    expect(jumpDistance(20)).toBe(60);
  });
});
```

`frontend/src/clouds/viewer/idle.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { IDLE_AFTER_MS, shouldKeepRendering } from "./idle";

const base = { nodesLoading: 0, pendingLoads: 0, lastActivityAt: 0, now: 5000, hidden: false };

describe("idle render loop", () => {
  it("renders while nodes load or within a second of activity", () => {
    expect(shouldKeepRendering({ ...base, nodesLoading: 2 })).toBe(true);
    expect(shouldKeepRendering({ ...base, pendingLoads: 1 })).toBe(true);
    expect(shouldKeepRendering({ ...base, lastActivityAt: base.now - IDLE_AFTER_MS + 1 })).toBe(true);
  });

  it("stops when idle and whenever the document is hidden", () => {
    expect(shouldKeepRendering(base)).toBe(false);
    expect(shouldKeepRendering({ ...base, nodesLoading: 5, hidden: true })).toBe(false);
  });
});
```

`frontend/src/clouds/viewer/overlay.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { localPositions } from "./overlay";

describe("overlay geometry", () => {
  it("stores UTM points relative to a local origin so float32 keeps millimetres", () => {
    const origin = { x: 243000, y: 3178000, z: 0 };
    const pts = [
      { x: 243522.123, y: 3178252.456, z: -44.321 },
      { x: 243522.124, y: 3178252.457, z: 175.6 },
    ];
    const local = localPositions(pts, origin);
    expect(local.length).toBe(6);
    expect(Math.abs(local[0] + origin.x - pts[0].x)).toBeLessThan(1e-4);
    expect(Math.abs(local[1] + origin.y - pts[0].y)).toBeLessThan(1e-4);
    expect(local[4] - local[1]).toBeCloseTo(0.001, 4);
    // the naive absolute Float32Array loses the millimetre
    expect(Math.abs(new Float32Array([pts[0].y])[0] - pts[0].y)).toBeGreaterThan(1e-3);
  });

  it("closes a ring by repeating the first point", () => {
    const o = { x: 0, y: 0, z: 0 };
    expect(
      Array.from(
        localPositions(
          [
            { x: 1, y: 2, z: 3 },
            { x: 4, y: 5, z: 6 },
          ],
          o,
          true,
        ),
      ),
    ).toEqual([1, 2, 3, 4, 5, 6, 1, 2, 3]);
  });
});
```

`frontend/src/clouds/viewer/diagnostics.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { classifyPixels, diagnosticsEnabled, DIAGNOSTICS_KEY } from "./diagnostics";

describe("diagnostics", () => {
  it("is off unless the flag is exactly 1", () => {
    expect(diagnosticsEnabled({ getItem: () => "1" })).toBe(true);
    expect(diagnosticsEnabled({ getItem: () => "true" })).toBe(false);
    expect(diagnosticsEnabled({ getItem: () => null })).toBe(false);
    expect(
      diagnosticsEnabled({
        getItem: () => {
          throw new Error("blocked");
        },
      }),
    ).toBe(false);
    expect(DIAGNOSTICS_KEY).toBe("kestrel.diagnostics");
  });

  it("counts background, red, green and pure-white pixels", () => {
    const px = (r: number, g: number, b: number) => [r, g, b, 255];
    const rgba = new Uint8Array([
      ...px(21, 27, 25), // background (canvas token)
      ...px(23, 28, 25), // background within tolerance
      ...px(200, 30, 30), // red
      ...px(30, 200, 40), // green
      ...px(255, 252, 250), // white
      ...px(120, 110, 100), // other
    ]);
    expect(classifyPixels(rgba, [21, 27, 25])).toEqual({
      total: 6,
      background: 2,
      red: 1,
      green: 1,
      white: 1,
    });
  });
});
```

`frontend/src/test/cloudFixtures.ts`:

```ts
import type { PointCloud } from "@/api/clouds";

export const CLOUD_ID = "c0000000-8888-4000-8000-000000000001";

/** The chimney's shape (spec §1): 21.7 M points, EPSG:32639, header bounds repaired. */
export const exampleCloud: PointCloud = {
  id: CLOUD_ID,
  name: "Chimney stack 3D",
  status: "ready",
  error: null,
  source_path: "\\\\DanNas\\Work Data\\Chimney stack 3D_group1_densified_point_cloud.las",
  source_size: 737_902_645,
  source_sha256: "ab".repeat(32),
  las_version: "1.2",
  point_format: 3,
  point_count: 21_697_184,
  has_rgb: true,
  scale: [0.001, 0.001, 0.001],
  crs_wkt: 'PROJCRS["WGS 84 / UTM zone 39N"]',
  epsg: 32639,
  proj4: "+proj=utm +zone=39 +datum=WGS84 +units=m +no_defs",
  vertical_crs: null,
  crs_source: "file",
  bounds_native: [243194.298, 3177915.06, -45, 243895.765, 3178616.528, 175],
  bounds_repaired: true,
  bounds_wgs84: [48.3712, 28.7004, 48.3784, 28.7068],
  octree_spacing_m: 4.13,
  z_stats: {
    min: -141.2,
    max: 175,
    mean: 8.2,
    p01: -46,
    p1: -44,
    p5: -43.5,
    p50: -40.1,
    p95: 60,
    p99: 170,
    p999: 174.5,
    sample_count: 1_972_472,
  },
  class_counts: { "1": 21_697_184 },
  octree_bytes: 137_000_000,
  captured_on: "2026-05-04",
  map_id: null,
  job_id: null,
  created_at: "2026-09-24T09:00:00Z",
};
```

- [ ] **Step 2: Run them to verify they fail**

Run: `pnpm -C frontend test -- src/clouds/viewer`
Expected: FAIL — cannot resolve `./requestManager`, `./materialOptions`, … and `@/api/clouds`.

- [ ] **Step 3: Write the pure modules and the API module**

`frontend/src/api/clouds.ts`:

```ts
import type { ApiClient, components } from "@contract/client";
import { unwrap } from "./errors";

type S = components["schemas"];
export type PointCloud = S["PointCloudOut"];

const P = "/api/v1/projects/{projectId}" as const;

export function fetchPointCloud(api: ApiClient, projectId: string, cloudId: string): Promise<PointCloud> {
  return unwrap(api.GET(`${P}/pointclouds/{cloudId}`, { params: { path: { projectId, cloudId } } }));
}
```

`frontend/src/clouds/viewer/requestManager.ts`:

```ts
/**
 * potree-core's RequestManager (spec §7): the loader asks for `…/metadata.json` through `getUrl`,
 * then derives the other two files with `.replace("/metadata.json", …)`, so a `?token=` query
 * survives. A non-2xx answer throws the backend's own message, so the viewer can say why.
 */
export interface OctreeRequestManager {
  fetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response>;
  getUrl(url: string): Promise<string>;
}

export function withToken(url: string, token: string): string {
  const u = new URL(url);
  if (!u.searchParams.has("token")) u.searchParams.set("token", token);
  return u.toString();
}

/** The URL handed to `potree.loadPointCloud`: potree-core chooses its Potree 2 loader with
 * `url.endsWith("metadata.json")`, so any query (a token) is stripped here and added back by
 * `getUrl` on every request. */
export function metadataUrl(url: string): string {
  const u = new URL(url);
  u.search = "";
  u.hash = "";
  const bare = u.toString();
  if (!bare.endsWith("/metadata.json")) throw new Error(`not an octree metadata URL: ${bare}`);
  return bare;
}

async function failure(r: Response): Promise<Error> {
  try {
    const body = (await r.clone().json()) as { error?: { message?: unknown } };
    if (typeof body?.error?.message === "string") return new Error(body.error.message);
  } catch {
    // not JSON: fall through to the status
  }
  return new Error(`the 3D view copy could not be loaded (HTTP ${r.status})`);
}

export function makeRequestManager(
  token: string,
  fetchImpl: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response> = (i, init) =>
    fetch(i, init),
): OctreeRequestManager {
  return {
    getUrl: async (url) => withToken(url, token),
    fetch: async (input, init) => {
      const r = await fetchImpl(input, init);
      if (!r.ok) throw await failure(r);
      return r;
    },
  };
}
```

`frontend/src/clouds/viewer/materialOptions.ts`:

```ts
import type { PointCloud } from "@/api/clouds";

export type ColourMode = "rgb" | "elevation";
export const POINT_SIZE_MIN = 0.5;
export const POINT_SIZE_MAX = 3;

/** potree-core's enum values, written out so this module (and its test) never loads WebGL code:
 * ColorEncoding.SRGB = 1, PointSizeType.ADAPTIVE = 2, PointColorType.RGB = 0 / HEIGHT = 3. */
export interface MaterialOptions {
  inputColorEncoding: 1;
  outputColorEncoding: 1;
  pointSizeType: 2;
  pointColorType: 0 | 3;
  size: number;
  elevationRange: [number, number];
}

export function makeMaterialOptions(o: {
  colour: ColourMode;
  elevationRange: [number, number];
  pointSize: number;
}): MaterialOptions {
  return {
    // Both encodings 1, or every RGB point renders pure white (spike, spec §8 "Material").
    inputColorEncoding: 1,
    outputColorEncoding: 1,
    pointSizeType: 2,
    pointColorType: o.colour === "rgb" ? 0 : 3,
    size: Math.min(POINT_SIZE_MAX, Math.max(POINT_SIZE_MIN, o.pointSize)),
    elevationRange: o.elevationRange,
  };
}

export function defaultColour(hasRgb: boolean | null | undefined): ColourMode {
  return hasRgb ? "rgb" : "elevation";
}

/** p1-p99 ignores the 0.009 % noise the spike found below -52 m; bounds when there are no stats. */
export function defaultElevationRange(
  cloud: Pick<PointCloud, "z_stats" | "bounds_native">,
): [number, number] {
  if (cloud.z_stats) return [cloud.z_stats.p1, cloud.z_stats.p99];
  const b = cloud.bounds_native;
  return b ? [b[2], b[5]] : [0, 1];
}
```

`frontend/src/clouds/viewer/budget.ts`:

```ts
export const BUDGETS = [1_000_000, 2_000_000, 3_000_000, 5_000_000, 8_000_000] as const;
export const DEFAULT_BUDGET = 3_000_000;
export const BUDGET_KEY = "kestrel.clouds.pointBudget";

type Reader = Pick<Storage, "getItem">;
type Writer = Pick<Storage, "setItem">;

function localStore(): Storage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

export function readBudget(storage: Reader | null = localStore()): number {
  try {
    const v = Number(storage?.getItem(BUDGET_KEY));
    return (BUDGETS as readonly number[]).includes(v) ? v : DEFAULT_BUDGET;
  } catch {
    return DEFAULT_BUDGET;
  }
}

export function writeBudget(n: number, storage: Writer | null = localStore()): void {
  try {
    storage?.setItem(BUDGET_KEY, String(n));
  } catch {
    // a private window or blocked storage: the budget just is not remembered
  }
}
```

`frontend/src/clouds/viewer/uncertainty.ts`:

```ts
/** A pick is a real source point; what is uncertain is whether it is the point the operator meant
 * (spec §2 "Picking"): the true surface point can be one displayed spacing away. */
export const WARN_UNCERTAINTY_M = 0.1;

export function pickUncertainty(rootSpacing: number, level: number): number {
  return rootSpacing / 2 ** level;
}

export interface NodeBox {
  level: number;
  min: [number, number, number];
  max: [number, number, number];
}

const EPS = 1e-6;

export function deepestLevelAt(nodes: NodeBox[], p: { x: number; y: number; z: number }): number | null {
  let best: number | null = null;
  const c = [p.x, p.y, p.z];
  for (const n of nodes) {
    const inside = c.every((v, i) => v >= n.min[i] - EPS && v <= n.max[i] + EPS);
    if (inside && (best === null || n.level > best)) best = n.level;
  }
  return best;
}
```

`frontend/src/clouds/viewer/camera.ts`:

```ts
export type Bounds6 = [number, number, number, number, number, number];
export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

export function siteDiagonal(b: Bounds6): number {
  return Math.hypot(b[3] - b[0], b[4] - b[1], b[5] - b[2]);
}

/** Set every frame from the distance to the orbit target (spec §8 "Navigation"). */
export function nearFar(distance: number, diagonal: number): { near: number; far: number } {
  return { near: Math.max(0.05, distance / 2000), far: Math.max(20 * diagonal, 4 * distance) };
}

export function southOblique(target: Vec3, distance: number, elevationDeg = 45): Vec3 {
  const e = (elevationDeg * Math.PI) / 180;
  return { x: target.x, y: target.y - distance * Math.cos(e), z: target.z + distance * Math.sin(e) };
}

function centre(b: Bounds6): Vec3 {
  return { x: (b[0] + b[3]) / 2, y: (b[1] + b[4]) / 2, z: (b[2] + b[5]) / 2 };
}

/** From the south, above the site, as in the spike. */
export function wholeSiteView(b: Bounds6): { target: Vec3; position: Vec3 } {
  const target = centre(b);
  return { target, position: southOblique(target, 1.1 * siteDiagonal(b), 40) };
}

export function topView(b: Bounds6): { target: Vec3; position: Vec3 } {
  const target = centre(b);
  const h = 1.6 * Math.max(b[3] - b[0], b[4] - b[1]);
  // a hair south of straight down: an orbit with Z up has no heading when looking exactly along -Z
  return { target, position: { x: target.x, y: target.y - h * 1e-4, z: target.z + h } };
}

export function jumpDistance(footprintDiagonal: number): number {
  return Math.max(40, 3 * footprintDiagonal);
}
```

`frontend/src/clouds/viewer/idle.ts`:

```ts
/** Render only while there is something to render (spec §8 "Loop"): an idle 3D view holds no GPU. */
export const IDLE_AFTER_MS = 1000;

export function shouldKeepRendering(s: {
  nodesLoading: number;
  pendingLoads: number;
  lastActivityAt: number;
  now: number;
  hidden: boolean;
}): boolean {
  if (s.hidden) return false;
  return s.nodesLoading > 0 || s.pendingLoads > 0 || s.now - s.lastActivityAt < IDLE_AFTER_MS;
}
```

`frontend/src/clouds/viewer/overlay.ts`:

```ts
import type { Vec3 } from "./camera";

export type OverlayTone = "accent" | "ok" | "warn";
export type OverlayShape =
  | { kind: "line"; points: Vec3[]; closed?: boolean; tone: OverlayTone }
  | { kind: "points"; points: Vec3[]; tone: OverlayTone };

/** float32 holds ~7 digits: a UTM northing loses its millimetres, so overlay geometry is stored
 * relative to a local origin and the group is placed at that origin in float64. */
export function localPositions(points: Vec3[], origin: Vec3, closed = false): Float32Array {
  const ring = closed && points.length > 1 ? [...points, points[0]] : points;
  const out = new Float32Array(ring.length * 3);
  ring.forEach((p, i) => {
    out[3 * i] = p.x - origin.x;
    out[3 * i + 1] = p.y - origin.y;
    out[3 * i + 2] = p.z - origin.z;
  });
  return out;
}

/** A DESIGN.md colour token (`--accent: 229 175 100`) as 0-255 RGB. */
export function tokenRgb(name: string, el: Element = document.documentElement): [number, number, number] {
  const parts = getComputedStyle(el).getPropertyValue(`--${name}`).trim().split(/\s+/).map(Number);
  return parts.length === 3 && parts.every(Number.isFinite)
    ? [parts[0], parts[1], parts[2]]
    : [229, 175, 100];
}
```

`frontend/src/clouds/viewer/diagnostics.ts`:

```ts
/** The read-only diagnostics hook (spec §8): the packaged check and the acceptance read it. */
export const DIAGNOSTICS_KEY = "kestrel.diagnostics";

export interface ViewerStats {
  numVisiblePoints: number;
  visibleNodes: number;
  nodesLoading: number;
  firstPointsMs: number | null;
  settledMs: number | null;
  errors: string[];
  contextLost: boolean;
  /** Metres from the camera to the orbit target (plan decision 7). */
  cameraDistance: number;
}

export interface ColourSample {
  total: number;
  background: number;
  red: number;
  green: number;
  white: number;
}

export interface CloudViewerDiagnostics {
  stats(): ViewerStats;
  sampleColours(): ColourSample;
  pickCenter(): { x: number; y: number; z: number; level: number; uncertainty_m: number } | null;
  /** The keys of the overlays currently drawn ("measure", "pin", "footprint"), for the e2e tests. */
  overlays(): string[];
}

declare global {
  interface Window {
    __kestrelCloudViewer?: CloudViewerDiagnostics;
  }
}

export function diagnosticsEnabled(storage: Pick<Storage, "getItem"> | null = safeStorage()): boolean {
  try {
    return storage?.getItem(DIAGNOSTICS_KEY) === "1";
  } catch {
    return false;
  }
}

function safeStorage(): Storage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

const DOMINANT = 40;

export function classifyPixels(
  rgba: Uint8Array,
  background: [number, number, number],
  tolerance = 6,
): ColourSample {
  const out: ColourSample = { total: 0, background: 0, red: 0, green: 0, white: 0 };
  for (let i = 0; i + 3 < rgba.length; i += 4) {
    const r = rgba[i];
    const g = rgba[i + 1];
    const b = rgba[i + 2];
    out.total += 1;
    if (
      Math.abs(r - background[0]) <= tolerance &&
      Math.abs(g - background[1]) <= tolerance &&
      Math.abs(b - background[2]) <= tolerance
    )
      out.background += 1;
    else if (r >= 250 && g >= 250 && b >= 250) out.white += 1;
    else if (r > g + DOMINANT && r > b + DOMINANT) out.red += 1;
    else if (g > r + DOMINANT && g > b + DOMINANT) out.green += 1;
  }
  return out;
}
```

- [ ] **Step 4: Run the unit tests to verify they pass**

Run: `pnpm -C frontend test -- src/clouds/viewer`
Expected: PASS (7 files).

- [ ] **Step 5: Write the e2e octree fixture and helpers**

`frontend/e2e/fixtures/potreeOctree.ts`:

```ts
import type { Page } from "@playwright/test";

/** A minimal Potree 2.0 octree built in memory (DEFAULT encoding, one leaf root node, position +
 * rgb), served with HTTP Range exactly as the backend does (spec §7). Nothing binary is committed. */
export interface FixturePoint {
  x: number;
  y: number;
  z: number;
  r: number;
  g: number;
  b: number;
}

export type OctreeFiles = Record<"metadata.json" | "hierarchy.bin" | "octree.bin", Buffer>;

const RECORD = 18; // int32 x, y, z + uint16 r, g, b

export function buildOctree(points: FixturePoint[], scale = 0.001): OctreeFiles {
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (const p of points) {
    [p.x, p.y, p.z].forEach((v, i) => {
      min[i] = Math.min(min[i], v);
      max[i] = Math.max(max[i], v);
    });
  }
  const size = Math.max(max[0] - min[0], max[1] - min[1], max[2] - min[2], 1);
  const cubeMax = min.map((v) => v + size);
  const octree = Buffer.alloc(points.length * RECORD);
  points.forEach((p, i) => {
    const o = i * RECORD;
    octree.writeInt32LE(Math.round((p.x - min[0]) / scale), o);
    octree.writeInt32LE(Math.round((p.y - min[1]) / scale), o + 4);
    octree.writeInt32LE(Math.round((p.z - min[2]) / scale), o + 8);
    octree.writeUInt16LE(p.r * 257, o + 12);
    octree.writeUInt16LE(p.g * 257, o + 14);
    octree.writeUInt16LE(p.b * 257, o + 16);
  });
  const hierarchy = Buffer.alloc(22);
  hierarchy.writeUInt8(1, 0); // leaf
  hierarchy.writeUInt8(0, 1); // no children
  hierarchy.writeUInt32LE(points.length, 2);
  hierarchy.writeBigInt64LE(0n, 6);
  hierarchy.writeBigInt64LE(BigInt(octree.length), 14);
  const metadata = {
    version: "2.0",
    name: "fixture",
    description: "",
    points: points.length,
    projection: "",
    hierarchy: { firstChunkSize: 22, stepSize: 4, depth: 0 },
    offset: min,
    scale: [scale, scale, scale],
    spacing: size / 128,
    boundingBox: { min, max: cubeMax },
    encoding: "DEFAULT",
    attributes: [
      {
        name: "position",
        description: "",
        size: 12,
        numElements: 3,
        elementSize: 4,
        type: "int32",
        min,
        max,
      },
      {
        name: "rgb",
        description: "",
        size: 6,
        numElements: 3,
        elementSize: 2,
        type: "uint16",
        min: [0, 0, 0],
        max: [65535, 65535, 65535],
      },
    ],
  };
  return {
    "metadata.json": Buffer.from(JSON.stringify(metadata)),
    "hierarchy.bin": hierarchy,
    "octree.bin": octree,
  };
}

/** A flat, gently sloping grid: red in the west half, green in the east half. */
export function redGreenGrid(o: {
  origin: [number, number, number];
  size: number;
  step: number;
}): FixturePoint[] {
  const out: FixturePoint[] = [];
  for (let x = 0; x <= o.size; x += o.step) {
    for (let y = 0; y <= o.size; y += o.step) {
      const west = x < o.size / 2;
      out.push({
        x: o.origin[0] + x,
        y: o.origin[1] + y,
        z: o.origin[2] + 0.02 * x,
        r: west ? 220 : 20,
        g: west ? 20 : 200,
        b: 20,
      });
    }
  }
  return out;
}

const CORS = {
  "access-control-allow-origin": "*",
  "access-control-expose-headers": "Content-Range, Accept-Ranges, Content-Length",
};

export async function routeOctree(page: Page, cloudId: string, files: OctreeFiles): Promise<string[]> {
  const served: string[] = [];
  await page.route(
    (u) => u.pathname.includes(`/pointclouds/${cloudId}/octree/`),
    async (route) => {
      const req = route.request();
      if (req.method() === "OPTIONS") {
        return route.fulfill({
          status: 204,
          headers: {
            ...CORS,
            "access-control-allow-headers": "authorization, content-type, range",
            "access-control-allow-methods": "GET",
          },
        });
      }
      const name = new URL(req.url()).pathname.split("/").pop() as keyof OctreeFiles;
      const body = files[name];
      const type = name === "metadata.json" ? "application/json" : "application/octet-stream";
      const range = req.headers()["range"];
      served.push(range ? `${name} ${range}` : name);
      if (!body) return route.fulfill({ status: 422, headers: CORS, body: "" });
      const m = range ? /^bytes=(\d+)-(\d+)$/.exec(range) : null;
      if (!m) {
        return route.fulfill({
          status: 200,
          headers: { ...CORS, "content-type": type, "accept-ranges": "bytes" },
          body,
        });
      }
      const a = Number(m[1]);
      const b = Math.min(Number(m[2]), body.length - 1);
      return route.fulfill({
        status: 206,
        headers: {
          ...CORS,
          "content-type": type,
          "accept-ranges": "bytes",
          "content-range": `bytes ${a}-${b}/${body.length}`,
        },
        body: body.subarray(a, b + 1),
      });
    },
  );
  return served;
}
```

`frontend/e2e/fixtures/clouds.ts`:

```ts
import type { Page } from "@playwright/test";

export const CLOUD = "c0000000-8888-4000-8000-000000000001";
const CORS = { "Access-Control-Allow-Origin": "*" };

/** A `PointCloudOut` for the red/green fixture grid at the chimney's UTM position. */
export function cloudJson(overrides: Record<string, unknown> = {}) {
  return {
    id: CLOUD,
    name: "Fixture cloud",
    status: "ready",
    error: null,
    source_path: "D:\\clouds\\fixture.laz",
    source_size: 2_000_000,
    source_sha256: "ab".repeat(32),
    las_version: "1.2",
    point_format: 3,
    point_count: 10_201,
    has_rgb: true,
    scale: [0.001, 0.001, 0.001],
    crs_wkt: 'PROJCRS["WGS 84 / UTM zone 39N"]',
    epsg: 32639,
    proj4: "+proj=utm +zone=39 +datum=WGS84 +units=m +no_defs",
    vertical_crs: null,
    crs_source: "file",
    bounds_native: [243500, 3178000, 0, 243600, 3178100, 2],
    bounds_repaired: true,
    bounds_wgs84: [48.3744, 28.7038, 48.3755, 28.7048],
    octree_spacing_m: 0.78125,
    z_stats: {
      min: 0,
      max: 2,
      mean: 1,
      p01: 0,
      p1: 0.02,
      p5: 0.1,
      p50: 1,
      p95: 1.9,
      p99: 1.98,
      p999: 2,
      sample_count: 10_201,
    },
    class_counts: { "1": 10_201 },
    octree_bytes: 183_640,
    captured_on: "2026-05-04",
    map_id: null,
    job_id: null,
    created_at: "2026-09-24T09:00:00Z",
    ...overrides,
  };
}

export async function jsonRoute(page: Page, pathname: string, body: unknown, status = 200): Promise<void> {
  await page.route(
    (u) => u.pathname === pathname,
    (route) =>
      route.request().method() === "GET"
        ? route.fulfill({
            status,
            contentType: "application/json",
            headers: CORS,
            body: JSON.stringify(body),
          })
        : route.fallback(),
  );
}
```

- [ ] **Step 6: Write the failing e2e test**

`frontend/e2e/clouds.spec.ts`:

```ts
import { test, expect, type Page } from "@playwright/test";
import { asDetectionProject } from "./kinds";
import { CLOUD, cloudJson, jsonRoute } from "./fixtures/clouds";
import { buildOctree, redGreenGrid, routeOctree } from "./fixtures/potreeOctree";

const P = "7f1c2e3a-1111-4000-8000-000000000001";

async function viewerStats(page: Page) {
  return page.evaluate(() => window.__kestrelCloudViewer?.stats() ?? null);
}

test.beforeEach(async ({ page }) => {
  await asDetectionProject(page, P);
  await page.addInitScript(() => localStorage.setItem("kestrel.diagnostics", "1"));
});

test("the viewer renders the cloud and its canvas fills the centre", async ({ page }) => {
  const files = buildOctree(redGreenGrid({ origin: [243500, 3178000, 0], size: 100, step: 1 }));
  await jsonRoute(page, `/api/v1/projects/${P}/pointclouds/${CLOUD}`, cloudJson());
  const served = await routeOctree(page, CLOUD, files);
  await page.goto(`/p/${P}/clouds/${CLOUD}`);
  await expect
    .poll(async () => (await viewerStats(page))?.numVisiblePoints ?? 0, { timeout: 20_000 })
    .toBeGreaterThan(0);
  await expect.poll(async () => (await viewerStats(page))?.nodesLoading ?? 1).toBe(0);
  expect(served).toContain("hierarchy.bin bytes=0-21");
  const centre = await page.getByTestId("cloud-centre").boundingBox();
  const canvas = await page.getByTestId("cloud-canvas").boundingBox();
  expect(canvas).toEqual(centre);
  const colours = await page.evaluate(() => window.__kestrelCloudViewer!.sampleColours());
  expect(colours.red / colours.total).toBeGreaterThan(0.01);
  expect(colours.green / colours.total).toBeGreaterThan(0.01);
  expect(colours.white).toBe(0);
  const pick = await page.evaluate(() => window.__kestrelCloudViewer!.pickCenter());
  expect(pick).not.toBeNull();
  expect(pick!.x).toBeGreaterThan(243500);
  expect(pick!.uncertainty_m).toBeGreaterThan(0);
});

test("a missing 3D view copy says so instead of a blank canvas", async ({ page }) => {
  await jsonRoute(page, `/api/v1/projects/${P}/pointclouds/${CLOUD}`, cloudJson());
  await page.route(
    (u) => u.pathname.includes(`/pointclouds/${CLOUD}/octree/`),
    (route) =>
      route.fulfill({
        status: 404,
        contentType: "application/json",
        headers: { "Access-Control-Allow-Origin": "*" },
        body: JSON.stringify({
          error: {
            code: "octree_missing",
            message: "the 3D view copy is missing; import the file again",
            details: {},
          },
        }),
      }),
  );
  await page.goto(`/p/${P}/clouds/${CLOUD}`);
  await expect(page.getByRole("alert")).toContainText("the 3D view copy is missing; import the file again");
});
```

Add the WebGL flags to `frontend/playwright.config.ts` inside `use`:

```ts
    // WebGL in headless Chromium needs SwiftShader asked for explicitly (plan decision 13).
    launchOptions: { args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"] },
```

Run: `pnpm -C frontend e2e -- clouds.spec.ts` (with `E2E_WEB_PORT`/`E2E_MOCK_PORT` set to free ports)
Expected: FAIL — `getByTestId("cloud-centre")` not found (the screen is still F0's empty one).

- [ ] **Step 7: Write `CloudViewer.tsx`**

`frontend/src/clouds/CloudViewer.tsx`:

```tsx
import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { Potree, VIRIDIS, type PointCloudMaterial, type PointCloudOctree } from "potree-core";
import type { PointCloud } from "@/api/clouds";
import { Alert, Button } from "@/ui";
import { nearFar, siteDiagonal, topView, wholeSiteView, type Bounds6, type Vec3 } from "./viewer/camera";
import {
  classifyPixels,
  diagnosticsEnabled,
  type ColourSample,
  type ViewerStats,
} from "./viewer/diagnostics";
import { shouldKeepRendering } from "./viewer/idle";
import { makeMaterialOptions, type ColourMode } from "./viewer/materialOptions";
import { localPositions, tokenRgb, type OverlayShape } from "./viewer/overlay";
import { makeRequestManager, metadataUrl } from "./viewer/requestManager";
import { deepestLevelAt, pickUncertainty, type NodeBox } from "./viewer/uncertainty";

export interface CloudPick {
  x: number;
  y: number;
  z: number;
  level: number;
  uncertainty_m: number;
}

export interface CloudViewerHandle {
  fit(): void;
  topView(): void;
  lookAt(target: Vec3, distance: number): void;
  pickAtClient(clientX: number, clientY: number): CloudPick | null;
  project(p: Vec3): { x: number; y: number } | null;
  setOverlay(key: string, shapes: OverlayShape[]): void;
  stats(): ViewerStats;
}

export interface CloudViewerProps {
  cloud: PointCloud;
  octreeUrl: string;
  token: string;
  budget: number;
  colour: ColourMode;
  elevationRange: [number, number];
  pointSize: number;
  /** A measuring tool is armed: hover picks at ≤ 10 Hz with a cursor marker. */
  armed?: boolean;
  onPick?(p: CloudPick): void;
  onHover?(p: CloudPick | null): void;
  onDoublePick?(p: CloudPick): void;
}

const HOVER_MS = 100;
const CLICK_SLOP_PX = 4;
const PICK_WINDOW = 15;
const fmt = (v: number) => v.toFixed(3);
const points = new Intl.NumberFormat("en-GB", { maximumFractionDigits: 1 });

interface Engine {
  renderer: THREE.WebGLRenderer;
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  controls: OrbitControls;
  potree: Potree;
  overlay: THREE.Group;
  pco: PointCloudOctree | null;
  stats: ViewerStats;
  requestRender(): void;
}

function emptyStats(): ViewerStats {
  return {
    numVisiblePoints: 0,
    visibleNodes: 0,
    nodesLoading: 0,
    firstPointsMs: null,
    settledMs: null,
    errors: [],
    contextLost: false,
    cameraDistance: 0,
  };
}

/**
 * potree-core 2.0.15 + three 0.180.0 in a React component (spec §8). One cloud; the render loop
 * runs while nodes load or for 1 s after input, then idles. The cloud sits at its native UTM offset
 * (potree offsets each node), so picks come back in the cloud's native CRS.
 */
export const CloudViewer = forwardRef<CloudViewerHandle, CloudViewerProps>(function CloudViewer(props, ref) {
  const { cloud, octreeUrl, token, budget, colour, elevationRange, pointSize, armed = false } = props;
  const box = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const engine = useRef<Engine | null>(null);
  const callbacks = useRef({
    onPick: props.onPick,
    onHover: props.onHover,
    onDoublePick: props.onDoublePick,
    armed,
  });
  const [generation, setGeneration] = useState(0);
  // Keyed by the scene they belong to, so a new cloud or a "Reload view" clears them without a
  // synchronous setState in the effect (react-hooks `set-state-in-effect`).
  const sceneKey = `${cloud.id}|${octreeUrl}|${generation}`;
  const [loadError, setLoadError] = useState<{ key: string; message: string } | null>(null);
  const [lostKey, setLostKey] = useState<string | null>(null);
  const [bar, setBar] = useState<{ pts: number; loading: number; pick: CloudPick | null }>({
    pts: 0,
    loading: 0,
    pick: null,
  });
  const bounds = cloud.bounds_native as Bounds6 | null;
  // Read by the scene effect's `applyMaterial`, so a colour/size change never rebuilds the scene.
  const materialRef = useRef({ colour, elevationRange, pointSize });
  const applyRef = useRef<() => void>(() => {});

  useEffect(() => {
    callbacks.current = {
      onPick: props.onPick,
      onHover: props.onHover,
      onDoublePick: props.onDoublePick,
      armed,
    };
  });

  const nodeBoxes = useCallback((): NodeBox[] => {
    const pco = engine.current?.pco;
    if (!pco) return [];
    return pco.visibleNodes.map((n) => {
      const b = n.boundingBox.clone().applyMatrix4(pco.matrixWorld);
      return {
        level: n.level,
        min: b.min.toArray() as NodeBox["min"],
        max: b.max.toArray() as NodeBox["max"],
      };
    });
  }, []);

  const pickAtClient = useCallback(
    (clientX: number, clientY: number): CloudPick | null => {
      const e = engine.current;
      const canvas = canvasRef.current;
      if (!e?.pco || !canvas) return null;
      const rect = canvas.getBoundingClientRect();
      const ndc = new THREE.Vector2(
        ((clientX - rect.left) / rect.width) * 2 - 1,
        -((clientY - rect.top) / rect.height) * 2 + 1,
      );
      const ray = new THREE.Raycaster();
      ray.setFromCamera(ndc, e.camera);
      const hit = e.pco.pick(e.renderer, e.camera, ray.ray, { pickWindowSize: PICK_WINDOW });
      const p = hit?.position;
      if (!p) return null;
      const level = deepestLevelAt(nodeBoxes(), p) ?? 0;
      const spacing =
        cloud.octree_spacing_m ?? (e.pco.pcoGeometry as unknown as { spacing?: number }).spacing ?? 1;
      return { x: p.x, y: p.y, z: p.z, level, uncertainty_m: pickUncertainty(spacing, level) };
    },
    [cloud.octree_spacing_m, nodeBoxes],
  );

  useEffect(() => {
    const canvas = canvasRef.current;
    const host = box.current;
    if (!canvas || !host) return;
    const key = `${cloud.id}|${octreeUrl}|${generation}`;
    const renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: false,
      powerPreference: "high-performance",
    });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    const clear = tokenRgb("canvas");
    renderer.setClearColor(new THREE.Color(clear[0] / 255, clear[1] / 255, clear[2] / 255));
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(60, 1, 0.05, 1e6);
    camera.up.set(0, 0, 1);
    const controls = new OrbitControls(camera, canvas);
    controls.zoomToCursor = true;
    controls.screenSpacePanning = true;
    const potree = new Potree();
    potree.pointBudget = budget;
    const overlay = new THREE.Group();
    overlay.renderOrder = 10;
    scene.add(overlay);
    const stats = emptyStats();
    const started = performance.now();
    const diagonal = bounds ? siteDiagonal(bounds) : 1000;
    let raf = 0;
    let lastInputAt = started;
    let lastLoadAt = started;
    let lastBarAt = 0;
    let disposed = false;

    const e: Engine = {
      renderer,
      scene,
      camera,
      controls,
      potree,
      overlay,
      pco: null,
      stats,
      requestRender: () => {},
    };
    engine.current = e;

    const tick = () => {
      raf = 0;
      if (disposed) return;
      const now = performance.now();
      const distance = camera.position.distanceTo(controls.target);
      const nf = nearFar(distance, diagonal);
      camera.near = nf.near;
      camera.far = nf.far;
      camera.updateProjectionMatrix();
      stats.cameraDistance = distance;
      let pending = 0;
      if (e.pco) {
        const r = potree.updatePointClouds([e.pco], camera, renderer);
        const loading = (e.pco.pcoGeometry as unknown as { numNodesLoading?: number }).numNodesLoading ?? 0;
        pending = r.nodeLoadPromises.length + (r.exceededMaxLoadsToGPU ? 1 : 0);
        stats.numVisiblePoints = r.numVisiblePoints;
        stats.visibleNodes = r.visibleNodes.length;
        stats.nodesLoading = loading;
        if (loading > 0 || pending > 0) lastLoadAt = now;
        if (stats.firstPointsMs === null && r.visibleNodes.length > 0) stats.firstPointsMs = now - started;
        if (stats.firstPointsMs !== null && stats.settledMs === null && loading === 0 && pending === 0) {
          stats.settledMs = now - started;
        }
        if (r.nodeLoadFailed) stats.errors.push("a node failed to load");
        pending += loading;
      }
      renderer.render(scene, camera);
      if (now - lastBarAt > 250) {
        lastBarAt = now;
        setBar((b) => ({ ...b, pts: stats.numVisiblePoints, loading: stats.nodesLoading }));
      }
      const keep = shouldKeepRendering({
        nodesLoading: stats.nodesLoading,
        pendingLoads: pending,
        lastActivityAt: Math.max(lastInputAt, lastLoadAt),
        now,
        hidden: document.hidden,
      });
      if (keep) raf = requestAnimationFrame(tick);
    };
    const requestRender = () => {
      lastInputAt = performance.now();
      if (!raf && !disposed && !document.hidden) raf = requestAnimationFrame(tick);
    };
    e.requestRender = requestRender;

    const resize = () => {
      const w = Math.max(1, host.clientWidth);
      const h = Math.max(1, host.clientHeight);
      renderer.setSize(w, h, false);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      requestRender();
    };
    const observer = new ResizeObserver(resize);
    observer.observe(host);
    resize();
    controls.addEventListener("change", requestRender);
    controls.addEventListener("start", requestRender);

    let down: { x: number; y: number } | null = null;
    let lastHover = 0;
    const onDown = (ev: PointerEvent) => {
      down = { x: ev.clientX, y: ev.clientY };
      requestRender();
    };
    const onUp = (ev: PointerEvent) => {
      const d = down;
      down = null;
      if (!d || ev.button !== 0 || Math.hypot(ev.clientX - d.x, ev.clientY - d.y) > CLICK_SLOP_PX) return;
      const p = pickAtClient(ev.clientX, ev.clientY);
      if (p) {
        setBar((b) => ({ ...b, pick: p }));
        callbacks.current.onPick?.(p);
      }
    };
    const onMove = (ev: PointerEvent) => {
      if (!callbacks.current.armed || down) return;
      const now = performance.now();
      if (now - lastHover < HOVER_MS) return;
      lastHover = now;
      callbacks.current.onHover?.(pickAtClient(ev.clientX, ev.clientY));
    };
    const onDouble = (ev: MouseEvent) => {
      const p = pickAtClient(ev.clientX, ev.clientY);
      if (!p) return;
      controls.target.set(p.x, p.y, p.z);
      controls.update();
      callbacks.current.onDoublePick?.(p);
      requestRender();
    };
    const onLost = (ev: Event) => {
      ev.preventDefault();
      stats.contextLost = true;
      stats.errors.push("webglcontextlost");
      setLostKey(key);
    };
    const onVisible = () => {
      if (!document.hidden) requestRender();
    };
    canvas.addEventListener("pointerdown", onDown);
    canvas.addEventListener("pointerup", onUp);
    canvas.addEventListener("pointermove", onMove);
    canvas.addEventListener("dblclick", onDouble);
    canvas.addEventListener("webglcontextlost", onLost);
    document.addEventListener("visibilitychange", onVisible);

    potree
      .loadPointCloud(metadataUrl(octreeUrl), makeRequestManager(token))
      .then((pco) => {
        if (disposed) {
          pco.dispose();
          return;
        }
        pco.material.gradient = VIRIDIS;
        scene.add(pco);
        e.pco = pco;
        const view = bounds ? wholeSiteView(bounds) : null;
        if (view) {
          camera.position.set(view.position.x, view.position.y, view.position.z);
          controls.target.set(view.target.x, view.target.y, view.target.z);
          controls.update();
        }
        applyMaterial();
        requestRender();
      })
      .catch((err: unknown) => {
        const message = err instanceof Error ? err.message : String(err);
        stats.errors.push(`load: ${message}`);
        if (!disposed) setLoadError({ key, message });
      });

    function applyMaterial() {
      const pco = e.pco;
      if (!pco) return;
      const o = makeMaterialOptions(materialRef.current);
      // materialOptions.ts spells potree-core's enum values out as numbers (so its test never loads WebGL code)
      type M = PointCloudMaterial; // ColorEncoding itself is not exported from potree-core's index
      pco.material.inputColorEncoding = o.inputColorEncoding as M["inputColorEncoding"];
      pco.material.outputColorEncoding = o.outputColorEncoding as M["outputColorEncoding"];
      pco.material.pointSizeType = o.pointSizeType as M["pointSizeType"];
      pco.material.pointColorType = o.pointColorType as M["pointColorType"];
      pco.material.size = o.size;
      pco.material.elevationRange = o.elevationRange;
    }
    applyRef.current = applyMaterial;

    if (diagnosticsEnabled()) {
      window.__kestrelCloudViewer = {
        stats: () => ({ ...stats, errors: [...stats.errors] }),
        sampleColours: (): ColourSample => {
          renderer.render(scene, camera);
          const gl = renderer.getContext();
          const w = gl.drawingBufferWidth;
          const h = gl.drawingBufferHeight;
          const buf = new Uint8Array(w * h * 4);
          gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, buf);
          return classifyPixels(buf, clear);
        },
        pickCenter: () => {
          const r = canvas.getBoundingClientRect();
          return pickAtClient(r.left + r.width / 2, r.top + r.height / 2);
        },
        overlays: () => [...new Set(overlay.children.map((c) => String(c.userData.key)))],
      };
    }

    return () => {
      disposed = true;
      if (raf) cancelAnimationFrame(raf);
      observer.disconnect();
      canvas.removeEventListener("pointerdown", onDown);
      canvas.removeEventListener("pointerup", onUp);
      canvas.removeEventListener("pointermove", onMove);
      canvas.removeEventListener("dblclick", onDouble);
      canvas.removeEventListener("webglcontextlost", onLost);
      document.removeEventListener("visibilitychange", onVisible);
      controls.dispose();
      e.pco?.dispose();
      renderer.dispose();
      if (window.__kestrelCloudViewer) delete window.__kestrelCloudViewer;
      engine.current = null;
      applyRef.current = () => {};
    };
    // budget/material changes are applied by the effects below without rebuilding the scene
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cloud.id, octreeUrl, token, generation]);

  useEffect(() => {
    materialRef.current = { colour, elevationRange, pointSize };
    applyRef.current();
    engine.current?.requestRender();
  }, [colour, elevationRange, pointSize]);
  useEffect(() => {
    if (engine.current) engine.current.potree.pointBudget = budget;
    engine.current?.requestRender();
  }, [budget]);

  useImperativeHandle(
    ref,
    (): CloudViewerHandle => ({
      fit() {
        const e = engine.current;
        if (!e || !bounds) return;
        const v = wholeSiteView(bounds);
        e.camera.position.set(v.position.x, v.position.y, v.position.z);
        e.controls.target.set(v.target.x, v.target.y, v.target.z);
        e.controls.update();
        e.requestRender();
      },
      topView() {
        const e = engine.current;
        if (!e || !bounds) return;
        const v = topView(bounds);
        e.camera.position.set(v.position.x, v.position.y, v.position.z);
        e.controls.target.set(v.target.x, v.target.y, v.target.z);
        e.controls.update();
        e.requestRender();
      },
      lookAt(target, distance) {
        const e = engine.current;
        if (!e) return;
        const k = Math.SQRT1_2 * distance;
        e.camera.position.set(target.x, target.y - k, target.z + k);
        e.controls.target.set(target.x, target.y, target.z);
        e.controls.update();
        e.requestRender();
      },
      pickAtClient,
      project(p) {
        const e = engine.current;
        const canvas = canvasRef.current;
        if (!e || !canvas) return null;
        const v = new THREE.Vector3(p.x, p.y, p.z).project(e.camera);
        if (v.z > 1 || v.z < -1) return null;
        const r = canvas.getBoundingClientRect();
        return { x: ((v.x + 1) / 2) * r.width, y: ((1 - v.y) / 2) * r.height };
      },
      setOverlay(key, shapes) {
        const e = engine.current;
        if (!e || !bounds) return;
        const origin = { x: bounds[0], y: bounds[1], z: bounds[2] };
        e.overlay.position.set(origin.x, origin.y, origin.z);
        for (const old of e.overlay.children.filter((c) => c.userData.key === key)) {
          e.overlay.remove(old);
          (old as THREE.Line).geometry.dispose();
        }
        for (const s of shapes) {
          const [r, g, b] = tokenRgb(s.tone === "accent" ? "accent" : s.tone === "ok" ? "ok" : "warn");
          const color = new THREE.Color(r / 255, g / 255, b / 255);
          const geom = new THREE.BufferGeometry();
          const closed = s.kind === "line" && !!s.closed;
          geom.setAttribute(
            "position",
            new THREE.BufferAttribute(localPositions(s.points, origin, closed), 3),
          );
          const obj =
            s.kind === "line"
              ? new THREE.Line(
                  geom,
                  new THREE.LineBasicMaterial({ color, depthTest: false, transparent: true }),
                )
              : new THREE.Points(
                  geom,
                  new THREE.PointsMaterial({ color, size: 8, sizeAttenuation: false, depthTest: false }),
                );
          obj.userData.key = key;
          obj.renderOrder = 10;
          e.overlay.add(obj);
        }
        e.requestRender();
      },
      stats: () => ({ ...(engine.current?.stats ?? emptyStats()) }),
    }),
    [bounds, pickAtClient],
  );

  return (
    <div ref={box} className="relative min-h-0 min-w-0 flex-1" data-testid="cloud-viewer">
      <canvas
        key={generation}
        ref={canvasRef}
        data-testid="cloud-canvas"
        className="absolute inset-0 h-full w-full bg-canvas"
        style={{ cursor: armed ? "crosshair" : "grab" }}
      />
      {loadError?.key === sceneKey && (
        <div className="absolute inset-x-4 top-4">
          <Alert tone="danger" title="The 3D view could not be shown">
            {loadError.message}
          </Alert>
        </div>
      )}
      {lostKey === sceneKey && (
        <div className="absolute inset-x-4 top-4">
          <Alert
            tone="warn"
            actions={
              <Button size="sm" icon="refresh" onClick={() => setGeneration((g) => g + 1)}>
                Reload view
              </Button>
            }
          >
            The 3D view lost its graphics context
          </Alert>
        </div>
      )}
      <div className="absolute inset-x-0 bottom-0 flex items-center gap-4 border-t border-line bg-panel/90 px-3 py-1.5 text-xs tabular-nums text-muted">
        <span data-testid="cloud-points-shown">{points.format(bar.pts / 1e6)} M points shown</span>
        {bar.loading > 0 && <span>loading {bar.loading} nodes</span>}
        {bar.pick && (
          <span className="ml-auto text-ink">
            E {fmt(bar.pick.x)} · N {fmt(bar.pick.y)} · Z {fmt(bar.pick.z)}
          </span>
        )}
      </div>
    </div>
  );
});
```

Notes for the implementer: `setOverlay` stores geometry relative to the cloud's `bounds_native` minimum (float32 precision, the overlay test). `loadPointCloud` gets `metadataUrl(octreeUrl)`: F0's `cloudOctreeUrl` already returns a token-free URL, and `metadataUrl` keeps it that way even if a caller passes one with a query (the requestManager test explains why that matters). The scene effect deliberately depends only on `cloud.id`, `octreeUrl`, `token` and `generation`; budget and material changes go through the two small effects below it.

- [ ] **Step 8: Host the viewer in a minimal `CloudsScreen`**

Replace the body of `frontend/src/screens/CloudsScreen.tsx` (keep the named export F0's `lazyScreens.tsx` imports):

```tsx
import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { cloudOctreeUrl } from "@contract/client";
import { useApi, useBackend } from "@/api/client";
import { fetchPointCloud, type PointCloud } from "@/api/clouds";
import { messageOf } from "@/api/errors";
import { CloudViewer } from "@/clouds/CloudViewer";
import { readBudget } from "@/clouds/viewer/budget";
import { defaultColour, defaultElevationRange } from "@/clouds/viewer/materialOptions";
import { Alert, EmptyState } from "@/ui";

/** Minimal host for the viewer (plan Task 6); Task 13 builds the full work surface around it.
 * Lazy-loaded (F0's lazyScreens.tsx), so three and potree-core load only on this screen. */
export function CloudsScreen() {
  const { projectId = "", cloudId } = useParams();
  const api = useApi();
  const { baseUrl, token } = useBackend();
  const [cloud, setCloud] = useState<PointCloud | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!cloudId) return;
    let live = true;
    fetchPointCloud(api, projectId, cloudId)
      .then((c) => live && setCloud(c))
      .catch((e: unknown) => live && setError(messageOf(e, "could not load the point cloud")));
    return () => {
      live = false;
    };
  }, [api, projectId, cloudId]);

  return (
    <div className="flex h-full min-h-0 w-full flex-col">
      <h1 className="border-b border-line px-4 py-2 text-xl font-semibold tracking-tight">Point clouds</h1>
      {!cloudId ? (
        <EmptyState className="m-auto p-6" icon="cloud" title="Import a LAS or LAZ point cloud" />
      ) : (
        <section data-testid="cloud-centre" className="relative flex min-h-0 min-w-0 flex-1">
          {error && <Alert tone="danger">{error}</Alert>}
          {cloud?.status === "ready" && (
            <CloudViewer
              cloud={cloud}
              octreeUrl={cloudOctreeUrl(baseUrl, projectId, cloud.id)}
              token={token}
              budget={readBudget()}
              colour={defaultColour(cloud.has_rgb)}
              elevationRange={defaultElevationRange(cloud)}
              pointSize={1}
            />
          )}
        </section>
      )}
    </div>
  );
}
```

F0's two frontend tests rendered the old screen bare; it now reads the route and the API. In `frontend/src/screens/foundationScreens.test.tsx`, replace the "Point clouds says what it is for…" case with:

```tsx
it("Point clouds says what it is for", async () => {
  const { api } = fakeClient([{ method: "GET", path: /\/pointclouds$/, body: { items: [] } }]);
  renderWithProviders(<CloudsScreen />, { api, route: "/p/p1/clouds", path: "/p/:projectId/clouds" });
  expect(await screen.findByRole("heading", { name: "Point clouds" })).toBeInTheDocument();
  expect(await screen.findByText("Import a LAS or LAZ point cloud")).toBeInTheDocument();
});
```

(importing `fakeClient` from `@/test/fixtures` and `renderWithProviders` from `@/test/render`; the `/pointclouds` route is already there for Task 13's list). In `frontend/src/app/lazyScreens.test.tsx`, wrap the Clouds element of the `it.each` table in the same providers:

```tsx
    [
      "Point clouds",
      <TestApiProvider key="c" api={fakeClient([{ method: "GET", path: /\/pointclouds$/, body: { items: [] } }]).api}>
        <MemoryRouter initialEntries={["/p/p1/clouds"]}>
          <Routes>
            <Route path="/p/:projectId/clouds" element={<CloudsScreen />} />
          </Routes>
        </MemoryRouter>
      </TestApiProvider>,
    ],
```

(importing `TestApiProvider` from `@/test/render`, `fakeClient` from `@/test/fixtures`, and `MemoryRouter`, `Route`, `Routes` from `react-router-dom`).

- [ ] **Step 9: Run the e2e and unit tests to verify they pass**

Run: `pnpm -C frontend test -- src/clouds src/screens/foundationScreens src/app/lazyScreens` then `pnpm -C frontend e2e -- clouds.spec.ts pointcloud-foundation.spec.ts` (free ports)
Expected: PASS. If the first e2e test times out with `numVisiblePoints` at 0, open the trace: a `webgl` context failure means the launch flags did not apply (check `use.launchOptions`); a stuck `nodesLoading` of 1 with a CSP line means the dev server has a CSP it should not — neither is fixed by changing the viewer.

- [ ] **Step 10: Gate and commit**

```powershell
git add frontend/src/api/clouds.ts frontend/src/clouds frontend/src/test/cloudFixtures.ts frontend/src/screens/CloudsScreen.tsx frontend/src/screens/foundationScreens.test.tsx frontend/src/app/lazyScreens.test.tsx frontend/e2e/fixtures/potreeOctree.ts frontend/e2e/fixtures/clouds.ts frontend/e2e/clouds.spec.ts frontend/playwright.config.ts
git commit -m "feat(clouds): CloudViewer on potree-core with idle loop, picking with uncertainty, diagnostics hook; e2e octree fixture

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

(`frontend/src/clouds` is a new folder containing only this task's files, so staging it by folder path is staging by path.)

---

### Task 7: Acceptance tools (for Task 19)

Four small scripts the acceptance runs. They live in `backend/scripts/` like `checkpoint2_backend.py`, and are tested on tiny inputs.

**Files:**
- Create: `backend/scripts/make_test_ortho.py` (spec §17.12: a synthetic ortho rasterised from a cloud's RGB — 5 cm, highest point per cell)
- Create: `backend/scripts/check_picks.py` (spec §17.9: every Point measurement in `measurements.csv` is a source point within 1 mm)
- Create: `backend/scripts/make_tiled_cloud.py` (spec §1: the chimney tiled 3 × 3)
- Create: `backend/scripts/pointcloud_acceptance.py` (import / cancel / export timing and RSS against a running backend)
- Test: `backend/tests/test_pointcloud_scripts.py`

**Interfaces:**
- Consumes (F0): `tests.pointclouds.make_las`.
- Produces (CLI):
  - `python scripts/make_test_ortho.py <cloud.las|laz> <out.tif> [--cell 0.05]` → a 3-band uint8 GeoTIFF in the cloud's CRS; prints `ortho ok <w>x<h> <cell> EPSG:<n>`.
  - `python scripts/check_picks.py <source.las|laz> <measurements.csv> [--tolerance 0.001]` → prints one line per Point row and `picks ok <n>` (exit 0) or `picks FAIL` (exit 1).
  - `python scripts/make_tiled_cloud.py <source> <out.las> [--gap 50]` → prints `tiled ok <count>`.
  - `python scripts/pointcloud_acceptance.py import|cancel|export --base URL --token T --project-folder DIR --source PATH [--backend-pid N] [--cloud-id ID]` → one JSON line per scenario.
  - Functions tested: `make_test_ortho.rasterise(cloud, out, cell) -> tuple[int, int]`, `check_picks.nearest_distances(source, picks) -> list[float]`, `make_tiled_cloud.tile(source, out, gap) -> int`, `pointcloud_acceptance.tree_rss(pid) -> int`, `pointcloud_acceptance.PeakSampler`.

- [ ] **Step 1: Write the failing tests**

`backend/tests/test_pointcloud_scripts.py`:

```python
"""The acceptance tools (Task 19 runs them on the chimney): tested on tiny inputs."""

import csv
import importlib.util
import os
import time
from pathlib import Path

import laspy
import numpy as np
import pytest
import rasterio
from pointclouds import make_las

SCRIPTS = Path(__file__).resolve().parents[1] / "scripts"


def _load(name: str):
    spec = importlib.util.spec_from_file_location(name, SCRIPTS / f"{name}.py")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def test_ortho_keeps_the_highest_point_per_cell(tmp_path):
    ortho = _load("make_test_ortho")
    pts = np.array([[243500.01, 3178000.01, 1.0], [243500.02, 3178000.02, 5.0], [243500.26, 3178000.26, 2.0]])
    src = make_las(tmp_path / "c.las", 3, points=pts)
    las = laspy.read(src)
    las.red = np.array([10, 200, 30], dtype=np.uint16) * 257
    las.green = np.array([10, 20, 30], dtype=np.uint16) * 257
    las.blue = np.array([10, 20, 30], dtype=np.uint16) * 257
    las.write(src)
    w, h = ortho.rasterise(src, tmp_path / "o.tif", 0.05)
    with rasterio.open(tmp_path / "o.tif") as ds:
        assert (ds.width, ds.height) == (w, h) and ds.crs.to_epsg() == 32639
        assert ds.transform.a == pytest.approx(0.05) and ds.transform.e == pytest.approx(-0.05)
        row, col = ds.index(243500.015, 3178000.015)
        assert tuple(ds.read()[:, row, col]) == (200, 20, 20)  # z 5 beats z 1 in the same cell


def test_check_picks_finds_real_points(tmp_path):
    picks_mod = _load("check_picks")
    pts = np.array([[243500.0, 3178000.0, 1.0], [243510.0, 3178010.0, 5.0]])
    src = make_las(tmp_path / "c.las", 2, points=pts)
    d = picks_mod.nearest_distances(src, [(243510.0, 3178010.0, 5.0), (243500.0, 3178000.0, 1.5)])
    assert d[0] == pytest.approx(0, abs=1e-6) and d[1] == pytest.approx(0.5, abs=1e-6)


def test_check_picks_reads_point_rows_from_the_export_csv(tmp_path):
    picks_mod = _load("check_picks")
    rows = tmp_path / "m.csv"
    with rows.open("w", newline="", encoding="utf-8") as f:
        w = csv.writer(f)
        w.writerow(["id", "name", "kind", "note", "x1", "y1", "z1", "u1", "x2", "y2", "z2", "u2"])
        w.writerow(["a", "Point 1", "point", "", "1", "2", "3", "0.01", "", "", "", ""])
        w.writerow(["b", "Distance 1", "distance", "", "1", "2", "3", "0.01", "4", "5", "6", "0.01"])
    assert picks_mod.point_rows(rows) == [(1.0, 2.0, 3.0)]


def test_tiling_makes_nine_offset_copies(tmp_path):
    tiled = _load("make_tiled_cloud")
    src = make_las(tmp_path / "c.las", 1_000)
    n = tiled.tile(src, tmp_path / "t.las", gap=50.0)
    assert n == 9_000
    with laspy.open(src) as a, laspy.open(tmp_path / "t.las") as b:
        ext = a.header.maxs - a.header.mins
        assert b.header.point_count == 9_000
        assert b.header.maxs[0] - b.header.mins[0] == pytest.approx(3 * ext[0] + 2 * 50.0, abs=0.01)
        assert b.header.parse_crs().to_epsg() == 32639


def test_tree_rss_and_peak_sampler():
    acc = _load("pointcloud_acceptance")
    assert acc.tree_rss(os.getpid()) > 10_000_000
    sampler = acc.PeakSampler(os.getpid(), interval=0.02)
    sampler.start()
    time.sleep(0.1)
    peak = sampler.stop()
    assert peak >= acc.tree_rss(os.getpid()) * 0.5


def test_converter_rss_is_zero_without_a_converter():
    acc = _load("pointcloud_acceptance")
    assert acc.converter_rss(os.getpid()) == 0
```

- [ ] **Step 2: Run them to verify they fail**

Run: `cd backend; & $PY -m pytest tests/test_pointcloud_scripts.py -v`
Expected: FAIL — `FileNotFoundError` for `scripts/make_test_ortho.py`.

- [ ] **Step 3: Write `make_test_ortho.py`**

`backend/scripts/make_test_ortho.py`:

```python
"""A synthetic orthomosaic rasterised from a cloud's RGB (spec §17.12): the highest point per cell.

Bounded memory: the Z buffer and the RGB buffer are disk-backed memmaps; the cloud is read in
2 M-point chunks. Usage: python scripts/make_test_ortho.py <cloud> <out.tif> [--cell 0.05]
"""

from __future__ import annotations

import argparse
import math
import tempfile
from pathlib import Path

import laspy
import numpy as np
import rasterio
from rasterio.transform import from_origin
from rasterio.windows import Window

CHUNK = 2_000_000
BLOCK = 2048


def rasterise(cloud: Path, out: Path, cell: float) -> tuple[int, int]:
    with laspy.open(cloud) as r:
        crs = r.header.parse_crs()
        minx, miny, _ = r.header.mins
        maxx, maxy, _ = r.header.maxs
        width = max(1, math.ceil((maxx - minx) / cell) + 1)
        height = max(1, math.ceil((maxy - miny) / cell) + 1)
        with tempfile.TemporaryDirectory(prefix="kestrel-ortho-") as tmp:
            zbuf = np.memmap(Path(tmp) / "z.bin", dtype=np.float32, mode="w+", shape=(height * width,))
            rgb = np.memmap(Path(tmp) / "rgb.bin", dtype=np.uint8, mode="w+", shape=(height * width, 3))
            zbuf[:] = -np.inf
            for pts in r.chunk_iterator(CHUNK):
                x, y, z = np.asarray(pts.x), np.asarray(pts.y), np.asarray(pts.z)
                col = np.clip(((x - minx) / cell).astype(np.int64), 0, width - 1)
                row = np.clip(((maxy - y) / cell).astype(np.int64), 0, height - 1)
                idx = row * width + col
                colours = np.column_stack([np.asarray(pts.red), np.asarray(pts.green), np.asarray(pts.blue)])
                colours = (colours >> 8).astype(np.uint8) if colours.max() > 255 else colours.astype(np.uint8)
                order = np.argsort(z, kind="stable")  # ascending: the last write per cell is the highest
                idx, z, colours = idx[order], z[order].astype(np.float32), colours[order]
                higher = z > zbuf[idx]
                zbuf[idx[higher]] = z[higher]
                rgb[idx[higher]] = colours[higher]
            profile = dict(
                driver="GTiff",
                width=width,
                height=height,
                count=3,
                dtype="uint8",
                crs=crs,
                transform=from_origin(minx, maxy, cell, cell),
                tiled=True,
                blockxsize=512,
                blockysize=512,
                compress="deflate",
            )
            grid = rgb.reshape(height, width, 3)
            with rasterio.open(out, "w", **profile) as dst:
                for top in range(0, height, BLOCK):
                    rows = min(BLOCK, height - top)
                    dst.write(
                        np.moveaxis(np.asarray(grid[top : top + rows]), -1, 0),
                        window=Window(0, top, width, rows),
                    )
            del zbuf, rgb, grid
    return width, height


def main() -> int:
    p = argparse.ArgumentParser()
    p.add_argument("cloud", type=Path)
    p.add_argument("out", type=Path)
    p.add_argument("--cell", type=float, default=0.05)
    a = p.parse_args()
    w, h = rasterise(a.cloud, a.out, a.cell)
    with rasterio.open(a.out) as ds:
        print(f"ortho ok {w}x{h} {a.cell} EPSG:{ds.crs.to_epsg() if ds.crs else 'none'}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
```

- [ ] **Step 4: Write `check_picks.py`**

`backend/scripts/check_picks.py`:

```python
"""Are the saved picks real source points? (spec §17.9) A laspy chunked nearest search.

Usage: python scripts/check_picks.py <source.las|laz> <measurements.csv> [--tolerance 0.001]
"""

from __future__ import annotations

import argparse
import csv
from pathlib import Path

import laspy
import numpy as np

CHUNK = 2_000_000


def point_rows(csv_path: Path) -> list[tuple[float, float, float]]:
    with csv_path.open(newline="", encoding="utf-8") as f:
        return [
            (float(r["x1"]), float(r["y1"]), float(r["z1"]))
            for r in csv.DictReader(f)
            if r["kind"] == "point"
        ]


def nearest_distances(source: Path, picks: list[tuple[float, float, float]]) -> list[float]:
    target = np.asarray(picks, dtype=np.float64).reshape(-1, 3)
    best = np.full(len(target), np.inf)
    with laspy.open(source) as r:
        for pts in r.chunk_iterator(CHUNK):
            xyz = np.column_stack([np.asarray(pts.x), np.asarray(pts.y), np.asarray(pts.z)])
            for i, t in enumerate(target):
                best[i] = min(best[i], float(np.sqrt(((xyz - t) ** 2).sum(axis=1)).min()))
    return best.tolist()


def main() -> int:
    p = argparse.ArgumentParser()
    p.add_argument("source", type=Path)
    p.add_argument("csv", type=Path)
    p.add_argument("--tolerance", type=float, default=0.001)
    a = p.parse_args()
    picks = point_rows(a.csv)
    distances = nearest_distances(a.source, picks)
    for (x, y, z), d in zip(picks, distances, strict=True):
        print(f"pick {x:.3f} {y:.3f} {z:.3f} nearest {d * 1000:.3f} mm")
    ok = bool(picks) and all(d <= a.tolerance + 1e-9 for d in distances)
    print(f"picks ok {len(picks)}" if ok else "picks FAIL")
    return 0 if ok else 1


if __name__ == "__main__":
    raise SystemExit(main())
```

- [ ] **Step 5: Write `make_tiled_cloud.py`**

`backend/scripts/make_tiled_cloud.py`:

```python
"""The 195 M-point synthetic cloud (spec §1): a source tiled 3 x 3 with a gap, streamed.

Usage: python scripts/make_tiled_cloud.py <source> <out.las> [--gap 50]
"""

from __future__ import annotations

import argparse
from pathlib import Path

import laspy

CHUNK = 2_000_000


def tile(source: Path, out: Path, gap: float = 50.0) -> int:
    with laspy.open(source) as r:
        h = r.header
        ext = h.maxs - h.mins
        hdr = laspy.LasHeader(point_format=h.point_format, version=h.version)
        hdr.scales, hdr.offsets = h.scales, h.offsets
        for v in h.vlrs:
            hdr.vlrs.append(v)
    written = 0
    with laspy.open(out, mode="w", header=hdr) as w:
        for i in range(3):
            for j in range(3):
                dx = int(round(i * (ext[0] + gap) / hdr.scales[0]))
                dy = int(round(j * (ext[1] + gap) / hdr.scales[1]))
                with laspy.open(source) as rr:
                    for pts in rr.chunk_iterator(CHUNK):
                        pts.array["X"] += dx
                        pts.array["Y"] += dy
                        w.write_points(pts)
                        written += len(pts)
    return written


def main() -> int:
    p = argparse.ArgumentParser()
    p.add_argument("source", type=Path)
    p.add_argument("out", type=Path)
    p.add_argument("--gap", type=float, default=50.0)
    a = p.parse_args()
    print(f"tiled ok {tile(a.source, a.out, a.gap)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
```

- [ ] **Step 6: Write `pointcloud_acceptance.py`**

`backend/scripts/pointcloud_acceptance.py`:

```python
"""Point-cloud acceptance driver (spec §17.1-§17.4, §17.13) against a running backend.

  import  create a detection project in --project-folder, import --source, report wall time,
          the cloud's facts, the converter's peak RSS and the backend's RSS growth
  cancel  start an import, cancel it once the converter runs, report how long until no
          PotreeConverter.exe is left, and the cloud's final state
  export  export --cloud-id (in --project-id) as LAZ, report wall time and size ratio

Each prints one JSON line. The backend's pid (--backend-pid) is needed for the RSS figures.
"""

from __future__ import annotations

import argparse
import json
import threading
import time
from pathlib import Path

import httpx
import psutil

CONVERTER = "potreeconverter.exe"


def tree_rss(pid: int) -> int:
    try:
        root = psutil.Process(pid)
        procs = [root, *root.children(recursive=True)]
    except psutil.Error:
        return 0
    total = 0
    for p in procs:
        try:
            total += p.memory_info().rss
        except psutil.Error:
            pass
    return total


def converter_rss(pid: int) -> int:
    try:
        kids = psutil.Process(pid).children(recursive=True)
    except psutil.Error:
        return 0
    total = 0
    for p in kids:
        try:
            if p.name().lower() == CONVERTER:
                total += p.memory_info().rss
        except psutil.Error:
            pass
    return total


def converters_alive() -> int:
    n = 0
    for p in psutil.process_iter(["name"]):
        if (p.info.get("name") or "").lower() == CONVERTER:
            n += 1
    return n


class PeakSampler:
    """Samples a pid's own RSS and its converter children's RSS until stopped."""

    def __init__(self, pid: int, interval: float = 0.05):
        self.pid, self.interval = pid, interval
        self.peak_tree = self.peak_converter = self.peak_backend = 0
        self._stop = threading.Event()
        self._t = threading.Thread(target=self._run, daemon=True)

    def _run(self) -> None:
        while not self._stop.is_set():
            self.peak_tree = max(self.peak_tree, tree_rss(self.pid))
            self.peak_converter = max(self.peak_converter, converter_rss(self.pid))
            try:
                self.peak_backend = max(self.peak_backend, psutil.Process(self.pid).memory_info().rss)
            except psutil.Error:
                pass
            time.sleep(self.interval)

    def start(self) -> None:
        self._t.start()

    def stop(self) -> int:
        self._stop.set()
        self._t.join(5)
        return self.peak_tree


def client(base: str, token: str) -> httpx.Client:
    return httpx.Client(
        base_url=f"{base.rstrip('/')}/api/v1", headers={"Authorization": f"Bearer {token}"}, timeout=120
    )


def wait_job(c: httpx.Client, project_id: str, job_id: str, timeout: float = 3600) -> dict:
    deadline = time.time() + timeout
    while time.time() < deadline:
        j = c.get(f"/projects/{project_id}/jobs/{job_id}").json()
        if j["state"] in ("succeeded", "failed", "cancelled"):
            return j
        time.sleep(0.25)
    raise TimeoutError(job_id)


def new_project(c: httpx.Client, folder: Path) -> str:
    folder.mkdir(parents=True, exist_ok=True)
    body = {
        "name": "Point-cloud acceptance",
        "folder": str(folder),
        "classes": [{"name": "excavator", "colour": "#f97316"}],
        "kind": "detect",
    }
    r = c.post("/projects", json=body)
    r.raise_for_status()
    return r.json()["id"]


def run_import(a) -> dict:
    c = client(a.base, a.token)
    pid = a.project_id or new_project(c, Path(a.project_folder))
    before = psutil.Process(a.backend_pid).memory_info().rss if a.backend_pid else 0
    sampler = PeakSampler(a.backend_pid) if a.backend_pid else None
    if sampler:
        sampler.start()
    t0 = time.perf_counter()
    r = c.post(f"/projects/{pid}/pointclouds", json={"path": a.source})
    r.raise_for_status()
    created = r.json()
    job = wait_job(c, pid, created["job"]["id"])
    wall = time.perf_counter() - t0
    if sampler:
        sampler.stop()
    cloud = c.get(f"/projects/{pid}/pointclouds/{created['cloud']['id']}").json()
    return {
        "scenario": "import",
        "project_id": pid,
        "cloud_id": cloud["id"],
        "state": job["state"],
        "error": job.get("error"),
        "wall_s": round(wall, 2),
        "point_count": cloud["point_count"],
        "epsg": cloud["epsg"],
        "bounds_repaired": cloud["bounds_repaired"],
        "bounds_native": cloud["bounds_native"],
        "octree_bytes": cloud["octree_bytes"],
        "source_size": cloud["source_size"],
        "octree_ratio": round(cloud["octree_bytes"] / cloud["source_size"], 4)
        if cloud["octree_bytes"]
        else None,
        "converter_peak_rss_gb": round(sampler.peak_converter / 1e9, 2) if sampler else None,
        "backend_rss_growth_gb": round((sampler.peak_backend - before) / 1e9, 3) if sampler else None,
    }


def run_cancel(a) -> dict:
    c = client(a.base, a.token)
    pid = a.project_id or new_project(c, Path(a.project_folder))
    created = c.post(f"/projects/{pid}/pointclouds", json={"path": a.source}).json()
    job_id = created["job"]["id"]
    deadline = time.time() + 1800
    while time.time() < deadline:
        j = c.get(f"/projects/{pid}/jobs/{job_id}").json()
        if (
            "building the 3D view copy" in (j.get("message") or "")
            or j["state"] != "running"
            and j["state"] != "queued"
        ):
            break
        time.sleep(0.1)
    t0 = time.perf_counter()
    c.post(f"/projects/{pid}/jobs/{job_id}/cancel")
    while converters_alive() and time.perf_counter() - t0 < 30:
        time.sleep(0.05)
    gone_s = time.perf_counter() - t0
    job = wait_job(c, pid, job_id)
    cloud = c.get(f"/projects/{pid}/pointclouds/{created['cloud']['id']}").json()
    folder = Path(a.project_folder) / "pointclouds" / cloud["id"]
    return {
        "scenario": "cancel",
        "job_state": job["state"],
        "converter_gone_s": round(gone_s, 2),
        "cloud_status": cloud["status"],
        "cloud_error": cloud["error"],
        "cloud_folder_exists": folder.exists(),
    }


def run_export(a) -> dict:
    c = client(a.base, a.token)
    t0 = time.perf_counter()
    r = c.post(
        f"/projects/{a.project_id}/pointclouds/{a.cloud_id}/exports",
        json={"format": "laz", "include_measurements": True},
    )
    r.raise_for_status()
    job = wait_job(c, a.project_id, r.json()["job"]["id"])
    wall = time.perf_counter() - t0
    result = job.get("result") or {}
    laz = Path(a.project_folder) / result.get("folder", "") / result.get("laz", "")
    source_size = c.get(f"/projects/{a.project_id}/pointclouds/{a.cloud_id}").json()["source_size"]
    return {
        "scenario": "export",
        "state": job["state"],
        "error": job.get("error"),
        "wall_s": round(wall, 2),
        "laz": str(laz),
        "laz_ratio": round(laz.stat().st_size / source_size, 4) if laz.is_file() else None,
        "point_count": result.get("point_count"),
    }


def main() -> int:
    p = argparse.ArgumentParser()
    p.add_argument("scenario", choices=["import", "cancel", "export"])
    p.add_argument("--base", required=True)
    p.add_argument("--token", required=True)
    p.add_argument("--project-folder", required=True)
    p.add_argument("--project-id")
    p.add_argument("--source")
    p.add_argument("--cloud-id")
    p.add_argument("--backend-pid", type=int)
    a = p.parse_args()
    out = {"import": run_import, "cancel": run_cancel, "export": run_export}[a.scenario](a)
    print(json.dumps(out))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
```

- [ ] **Step 7: Run the tests to verify they pass**

Run: `cd backend; & $PY -m pytest tests/test_pointcloud_scripts.py -v`
Expected: PASS (6 tests).

- [ ] **Step 8: Gate and commit**

```powershell
git add backend/scripts/make_test_ortho.py backend/scripts/check_picks.py backend/scripts/make_tiled_cloud.py backend/scripts/pointcloud_acceptance.py backend/tests/test_pointcloud_scripts.py
git commit -m "test(pointclouds): acceptance tools - synthetic ortho, pick check, 3x3 tiling, import/cancel/export driver

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 8: About screen and licence notices (unit A1)

Load `impeccable` and `emil-design-eng` with `DESIGN.md` first.

**Files:**
- Create: `frontend/src/about/notices.json`
- Create: `frontend/src/about/notices.ts`
- Create: `frontend/src/about/licences/potree-core.txt`, `three.txt`, `brotli-js.txt`, `potreeconverter.txt`, `laszip.txt`, `brotli.txt`, `nlohmann-json.txt`, `laspy.txt`, `lazrs.txt` (copied, never retyped)
- Modify: `frontend/src/screens/AboutScreen.tsx` (F0's empty screen)
- Test: `frontend/src/about/notices.test.ts`, `frontend/src/screens/AboutScreen.test.tsx`, `frontend/e2e/about.spec.ts`, `backend/tests/test_about_versions.py`

**Interfaces:**
- Consumes: Task 2's `backend/third_party/potreeconverter/licenses/` and the `$version = "2.1.5"` line of `backend/scripts/fetch_potreeconverter.ps1`; `converter_path.CONVERTER_VERSION`.
- Produces: `about/notices.ts`: `interface Notice { id: string; name: string; version: string; licence: string; usedFor: string; note?: string; licenceFile: string; text: string }`; `NOTICES: Notice[]` (texts found by `import.meta.glob`, so a new row needs only JSON and a `.txt`); `appVersion(fallback: string): Promise<string>`. The screen keeps F0's heading "About Kestrel AI" (F0's `foundationScreens.test.tsx`, `lazyScreens.test.tsx` and `e2e/pointcloud-foundation.spec.ts` assert it).

- [ ] **Step 1: Copy the licence texts**

From the worktree root (PowerShell). Each source is the upstream file itself:

```powershell
$lic = "frontend\src\about\licences"; New-Item -ItemType Directory -Force $lic | Out-Null
Copy-Item frontend\node_modules\potree-core\LICENSE "$lic\potree-core.txt"   # MIT + the Potree (BSD-2) and plasio (MIT) notices it bundles
Copy-Item frontend\node_modules\three\LICENSE "$lic\three.txt"
$brotliJs = Get-ChildItem frontend\node_modules\.pnpm -Directory -Filter "brotli@1.3.3" | Select-Object -First 1
Copy-Item (Join-Path $brotliJs.FullName "node_modules\brotli\LICENSE") "$lic\brotli-js.txt"   # potree-core depends on brotli 1.3.3
$pc = "backend\third_party\potreeconverter\licenses"
Copy-Item "$pc\license_potree_converter.txt" "$lic\potreeconverter.txt"
Copy-Item "$pc\license_laszip.txt" "$lic\laszip.txt"
Copy-Item "$pc\license_brotli.txt" "$lic\brotli.txt"
Copy-Item "$pc\license_json.txt" "$lic\nlohmann-json.txt"
$site = & $PY -c "import sysconfig; print(sysconfig.get_paths()['purelib'])"
Copy-Item "$site\laspy-2.7.0.dist-info\licenses\LICENSE.txt" "$lic\laspy.txt"
Copy-Item "$site\lazrs-0.8.2.dist-info\licenses\LICENSE.txt" "$lic\lazrs.txt"
Get-ChildItem $lic | Select-Object Name, Length
```

Expected: nine files, each more than 900 bytes (`laszip.txt` about 26 KB). If `brotli@1.3.3` is not under `.pnpm`, run `pnpm -C frontend why brotli` to find the folder; do not type a licence from memory.

- [ ] **Step 2: Write `notices.json`**

`frontend/src/about/notices.json`:

```json
{
  "components": [
    { "id": "potree-core", "name": "potree-core", "version": "2.0.15", "licence": "MIT", "usedFor": "3D viewer", "note": "Includes the notices of Potree (BSD-2-Clause) and plasio (MIT).", "licenceFile": "potree-core.txt" },
    { "id": "three", "name": "three", "version": "0.180.0", "licence": "MIT", "usedFor": "WebGL rendering", "licenceFile": "three.txt" },
    { "id": "brotli-js", "name": "brotli.js (bundled in potree-core's decoder worker)", "version": "1.3.3", "licence": "MIT", "usedFor": "Decoding the octree", "licenceFile": "brotli-js.txt" },
    { "id": "potreeconverter", "name": "PotreeConverter", "version": "2.1.5", "licence": "BSD-2-Clause", "usedFor": "Building the 3D view copy", "licenceFile": "potreeconverter.txt" },
    { "id": "laszip", "name": "laszip.dll (shipped with PotreeConverter)", "version": "as shipped with PotreeConverter 2.1.5", "licence": "LGPL-2.1", "usedFor": "Reading LAS/LAZ in the converter", "note": "Used unmodified and loaded dynamically by PotreeConverter.exe; it can be replaced with a compatible build; source: github.com/LASzip/LASzip", "licenceFile": "laszip.txt" },
    { "id": "brotli", "name": "brotli (C, in PotreeConverter)", "version": "as built into PotreeConverter 2.1.5", "licence": "MIT", "usedFor": "Octree compression", "licenceFile": "brotli.txt" },
    { "id": "nlohmann-json", "name": "nlohmann/json (in PotreeConverter)", "version": "as built into PotreeConverter 2.1.5", "licence": "MIT", "usedFor": "Converter metadata", "licenceFile": "nlohmann-json.txt" },
    { "id": "laspy", "name": "laspy", "version": "2.7.0", "licence": "BSD-2-Clause", "usedFor": "Reading and writing LAS/LAZ", "licenceFile": "laspy.txt" },
    { "id": "lazrs", "name": "lazrs", "version": "0.8.2", "licence": "MIT", "usedFor": "LAZ compression", "licenceFile": "lazrs.txt" }
  ]
}
```

- [ ] **Step 3: Write the failing tests**

`frontend/src/about/notices.test.ts`:

```ts
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { NOTICES } from "./notices";

const pkg = JSON.parse(readFileSync(resolve(__dirname, "../../package.json"), "utf8")) as {
  dependencies: Record<string, string>;
};

describe("licence notices", () => {
  it("lists the nine components with full texts", () => {
    expect(NOTICES.map((n) => n.id)).toEqual([
      "potree-core",
      "three",
      "brotli-js",
      "potreeconverter",
      "laszip",
      "brotli",
      "nlohmann-json",
      "laspy",
      "lazrs",
    ]);
    for (const n of NOTICES) {
      expect(n.text.length, n.id).toBeGreaterThan(900);
      expect(n.licence && n.usedFor && n.version, n.id).toBeTruthy();
    }
  });

  it("carries the versions package.json pins", () => {
    expect(NOTICES.find((n) => n.id === "potree-core")!.version).toBe(pkg.dependencies["potree-core"]);
    expect(NOTICES.find((n) => n.id === "three")!.version).toBe(pkg.dependencies["three"]);
  });

  it("states how laszip is used", () => {
    expect(NOTICES.find((n) => n.id === "laszip")!.note).toContain(
      "loaded dynamically by PotreeConverter.exe",
    );
  });
});
```

`frontend/src/screens/AboutScreen.test.tsx`:

```tsx
import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { fakeClient } from "@/test/fixtures";
import { renderWithProviders } from "@/test/render";
import { AboutScreen } from "./AboutScreen";

describe("About screen", () => {
  it("shows every component and opens a licence text", async () => {
    renderWithProviders(<AboutScreen />, { api: fakeClient([]).api });
    const table = screen.getByRole("table", { name: "Open-source components" });
    expect(within(table).getAllByRole("row")).toHaveLength(1 + 9);
    expect(screen.getByRole("heading", { name: "About Kestrel AI" })).toBeInTheDocument();
    expect(screen.getByText(/^Version /)).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Licence text: laspy" }));
    expect(screen.getByText(/Redistribution and use in source and binary forms/)).toBeInTheDocument();
  });
});
```

`frontend/e2e/about.spec.ts`:

```ts
import { test, expect } from "@playwright/test";

test("the About screen lists every licence notice", async ({ page }) => {
  await page.goto("/about");
  const table = page.getByRole("table", { name: "Open-source components" });
  await expect(table.getByRole("row")).toHaveCount(10);
  await expect(table).toContainText("PotreeConverter");
  await expect(table).toContainText("LGPL-2.1");
});
```

`backend/tests/test_about_versions.py`:

```python
"""The About screen's versions match what is installed and what the build fetches (spec §12)."""

import json
import re
from importlib.metadata import version
from pathlib import Path

from app.pointclouds.converter_path import CONVERTER_VERSION

ROOT = Path(__file__).resolve().parents[2]
NOTICES = {
    c["id"]: c
    for c in json.loads((ROOT / "frontend" / "src" / "about" / "notices.json").read_text("utf-8"))[
        "components"
    ]
}


def test_laspy_and_lazrs_versions_are_the_installed_ones():
    assert NOTICES["laspy"]["version"] == version("laspy")
    assert NOTICES["lazrs"]["version"] == version("lazrs")


def test_potreeconverter_version_is_the_fetched_one():
    script = (ROOT / "backend" / "scripts" / "fetch_potreeconverter.ps1").read_text("utf-8")
    pinned = re.search(r'^\$version = "([^"]+)"', script, re.M).group(1)
    assert NOTICES["potreeconverter"]["version"] == pinned == CONVERTER_VERSION
```

- [ ] **Step 4: Run them to verify they fail**

Run: `pnpm -C frontend test -- src/about src/screens/AboutScreen` and `cd backend; & $PY -m pytest tests/test_about_versions.py -v`
Expected: FAIL — cannot resolve `./notices` (vitest); the pytest passes already only if Step 2 is done, which is fine: it pins the data.

- [ ] **Step 5: Write `notices.ts` and the screen**

`frontend/src/about/notices.ts`:

```ts
import data from "./notices.json";

export interface Notice {
  id: string;
  name: string;
  version: string;
  licence: string;
  usedFor: string;
  note?: string;
  licenceFile: string;
  text: string;
}

// Every committed licence text, keyed by file name: a new component needs a JSON row and a .txt only.
const texts = import.meta.glob("./licences/*.txt", {
  query: "?raw",
  import: "default",
  eager: true,
}) as Record<string, string>;

export const NOTICES: Notice[] = data.components.map((c) => ({
  ...c,
  text: texts[`./licences/${c.licenceFile}`] ?? "",
}));

/** The Tauri app's version, or the frontend package's when not running inside Tauri. */
export async function appVersion(fallback: string): Promise<string> {
  try {
    const { getVersion } = await import("@tauri-apps/api/app");
    return await getVersion();
  } catch {
    return fallback;
  }
}
```

`frontend/src/screens/AboutScreen.tsx`:

```tsx
import { useEffect, useState } from "react";
import { NOTICES, appVersion } from "@/about/notices";
import pkg from "../../package.json";
import { Disclosure } from "@/ui";

export function AboutScreen() {
  const [version, setVersion] = useState(pkg.version);
  useEffect(() => {
    let live = true;
    void appVersion(pkg.version).then((v) => live && setVersion(v));
    return () => {
      live = false;
    };
  }, []);

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto flex max-w-4xl flex-col gap-6 p-6">
        <header className="flex flex-col gap-1">
          <h1 className="text-2xl font-semibold tracking-tight">About Kestrel AI</h1>
          <p className="text-sm text-muted">Version {version}</p>
        </header>
        <table aria-label="Open-source components" className="w-full border-collapse text-sm">
          <caption className="pb-3 text-left text-base font-semibold text-ink">
            Open-source components
          </caption>
          <thead>
            <tr className="border-b border-line text-left text-xs text-muted">
              <th className="py-2 pr-4 font-medium">Component</th>
              <th className="py-2 pr-4 font-medium">Version</th>
              <th className="py-2 pr-4 font-medium">Licence</th>
              <th className="py-2 font-medium">Used for</th>
            </tr>
          </thead>
          <tbody>
            {NOTICES.map((n) => (
              <tr key={n.id} className="border-b border-line align-top">
                <td className="py-3 pr-4">
                  <div className="flex flex-col gap-2">
                    <span className="font-medium text-ink">{n.name}</span>
                    {n.note && <span className="text-xs text-muted">{n.note}</span>}
                    <Disclosure label={`Licence text: ${n.name}`}>
                      <pre className="max-h-72 overflow-auto whitespace-pre-wrap rounded-md bg-well p-3 font-mono text-xs text-ink">
                        {n.text}
                      </pre>
                    </Disclosure>
                  </div>
                </td>
                <td className="py-3 pr-4 tabular-nums text-muted">{n.version}</td>
                <td className="py-3 pr-4 text-ink">{n.licence}</td>
                <td className="py-3 text-muted">{n.usedFor}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
```

The Disclosure's accessible name is its label, so the unit test's button name for laspy is `Licence text: laspy` (the `name` field). Keep the named export F0's `lazyScreens.tsx` imports. F0's `foundationScreens.test.tsx` renders `<AboutScreen />` bare and still passes: the screen needs no API context.

- [ ] **Step 6: Run the tests to verify they pass**

Run: `pnpm -C frontend test -- src/about src/screens/AboutScreen src/screens/foundationScreens src/app/lazyScreens`, `pnpm -C frontend e2e -- about.spec.ts pointcloud-foundation.spec.ts` (free ports), `cd backend; & $PY -m pytest tests/test_about_versions.py -v`
Expected: PASS.

- [ ] **Step 7: Gate and commit**

```powershell
git add frontend/src/about frontend/src/screens/AboutScreen.tsx frontend/src/screens/AboutScreen.test.tsx frontend/e2e/about.spec.ts backend/tests/test_about_versions.py
git commit -m "feat(about): About screen with the point-cloud licence notices, data-driven

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 9: The import pipeline (unit I1, part d)

**Files:**
- Create: `backend/app/pointclouds/importer.py`
- Modify: `backend/pyproject.toml` (register the `potreeconverter` marker)
- Test: `backend/tests/test_pointcloud_importer.py`

**Interfaces:**
- Consumes: Task 2 `converter_path.converter_exe()`; Task 3 `admission.assess/require`, `workcopy.copy_and_hash`, `workcopy.repair_header`; Task 4 `lasfile.inspect_file`, `scan.scan`, `crs.crs_from_header`, `crs.bounds_wgs84`; Task 5 `converter.run_converter`, `ConverterResult`, `validate.validate_octree`.
- Produces:
  - `importer.ImportResult` (dataclass): `point_count`, `header_count`, `las_version`, `point_format`, `has_rgb`, `scale`, `crs: CrsInfo`, `bounds_native`, `bounds_repaired`, `bounds_wgs84`, `z_stats`, `class_counts`, `octree_spacing_m`, `octree_bytes`, `encoding`, `source_sha256`, `source_size`, `source_mtime`, `captured_on`, `seconds`, `timings: dict[str, float]`, `log_tail: list[str]`.
  - `importer.import_cloud(source: Path, cloud_dir: Path, *, progress: Callable[[float, str], None], check_cancelled: Callable[[], None], converter: Callable | None = None) -> ImportResult` — writes `cloud_dir/octree/` and `cloud_dir/source.json`; every exit path removes `cloud_dir/.work`, and a failure also removes `cloud_dir/octree`. With `converter=None` it calls `app.pointclouds.converter.run_converter` **looked up at call time** (the test seam replaces the module attribute).
  - Progress bands: copy 0–0.30 ("copying 1.2 / 6.2 GB"), scan 0.30–0.45 ("scanning 40 M / 195 M points"), convert 0.45–0.97, validate 0.97–0.99.

- [ ] **Step 1: Write the failing tests**

`backend/tests/test_pointcloud_importer.py`:

```python
"""The pure import pipeline (spec §6): no database, the same code the job and the selftest run."""

import errno
import io
import json

import pytest
from pointclouds import fake_run_converter, make_las

from app.jobs.cancellation import JobCancelled, JobFailure
from app.pointclouds import admission, converter_path, workcopy
from app.pointclouds.importer import import_cloud

GB = 1_000_000_000


@pytest.fixture(autouse=True)
def plenty(monkeypatch):
    monkeypatch.setattr(admission, "available_ram", lambda: 64 * GB)
    monkeypatch.setattr(admission, "free_disk", lambda folder: 2_000 * GB)


def fake_converter(calls=None, points_delta=0):
    """F0's offline converter (a real DEFAULT octree), recording its arguments, optionally corrupted."""

    def run(input_path, out_dir, *, progress, check_cancelled):
        if calls is not None:
            calls.append((input_path, out_dir))
        result = fake_run_converter(input_path, out_dir, progress=progress, check_cancelled=check_cancelled)
        if points_delta:
            meta = json.loads((out_dir / "metadata.json").read_text("utf-8"))
            meta["points"] += points_delta
            (out_dir / "metadata.json").write_text(json.dumps(meta), "utf-8")
        return result

    return run


def _run(src, cloud_dir, **kw):
    seen: list[tuple[float, str]] = []
    result = import_cloud(
        src, cloud_dir, progress=lambda f, m: seen.append((f, m)), check_cancelled=lambda: None, **kw
    )
    return result, seen


def test_imports_a_pix4d_style_las(tmp_path):
    src = make_las(tmp_path / "src" / "chimney.las", 5_000, header_shrink_mm=0.3)
    cloud_dir = tmp_path / "proj" / "pointclouds" / "c1"
    calls = []
    r, seen = _run(src, cloud_dir, converter=fake_converter(calls))
    assert r.point_count == 5_000 and r.bounds_repaired is True and r.crs.epsg == 32639
    assert (r.las_version, r.point_format, r.has_rgb, r.scale) == ("1.2", 3, True, [0.001, 0.001, 0.001])
    assert (
        r.octree_spacing_m > 0 and r.octree_bytes > 0 and r.encoding == "DEFAULT"
    )  # F0's fake writes DEFAULT
    assert len(r.bounds_wgs84) == 4 and r.z_stats["sample_count"] == 5_000
    assert (cloud_dir / "octree" / "metadata.json").is_file()
    assert not (cloud_dir / ".work").exists()
    assert (
        calls[0][0].name == "input.las"
        and calls[0][1].name == "octree"
        and calls[0][0].parent.name == ".work"
    )
    fractions = [f for f, _ in seen]
    assert fractions == sorted(fractions) and fractions[-1] == pytest.approx(0.99)
    assert any(m.startswith("copying ") for _, m in seen) and any(m.startswith("scanning ") for _, m in seen)
    record = json.loads((cloud_dir / "source.json").read_text("utf-8"))
    assert (
        record["path"] == str(src)
        and record["sha256"] == r.source_sha256
        and record["bounds_repaired"] is True
    )
    assert record["header"]["point_count"] == 5_000
    assert record["converter"]["log_tail"] == ["fake converter: 5000 points"]
    assert set(record["timings"]) >= {"copy_s", "scan_s", "convert_s", "validate_s"}
    assert src.stat().st_size == r.source_size  # the source is only ever read


def test_imports_a_laz(tmp_path):
    src = make_las(tmp_path / "c.laz", 3_000, compressed=True)
    r, _ = _run(src, tmp_path / "pc" / "c2", converter=fake_converter())
    assert r.point_count == 3_000 and r.bounds_repaired is False


def test_paths_with_spaces_and_non_ascii(tmp_path):
    """Review Focus 1."""
    src = make_las(tmp_path / "Chimney stack 3D — Kuwait" / "جديد" / "Chimney stack 3D_group1.las", 1_000)
    cloud_dir = tmp_path / "مشروع" / "pointclouds" / "c3"
    calls = []
    r, _ = _run(src, cloud_dir, converter=fake_converter(calls))
    assert r.point_count == 1_000 and calls[0][0].name == "input.las"


def test_refused_up_front_without_touching_disk(tmp_path, monkeypatch):
    monkeypatch.setattr(admission, "available_ram", lambda: 1 * GB)
    src = make_las(tmp_path / "c.las", 1_000)
    cloud_dir = tmp_path / "pc" / "c4"
    with pytest.raises(JobFailure) as e:
        _run(src, cloud_dir, converter=fake_converter())
    assert "of free memory" in str(e.value)
    assert not (cloud_dir / ".work").exists()


def test_admission_is_checked_again_right_before_the_converter(tmp_path, monkeypatch):
    answers = iter([64 * GB, 1 * GB])
    monkeypatch.setattr(admission, "available_ram", lambda: next(answers))
    calls = []
    cloud_dir = tmp_path / "pc" / "c5"
    with pytest.raises(JobFailure):
        _run(make_las(tmp_path / "c.las", 1_000), cloud_dir, converter=fake_converter(calls))
    assert calls == [] and not (cloud_dir / ".work").exists()


def test_converter_failure_cleans_up(tmp_path):
    def broken(input_path, out_dir, **_):
        out_dir.mkdir()
        (out_dir / "chunks").mkdir()  # a half-written converter output
        raise JobFailure("the point-cloud converter stopped: ERROR(x)")

    cloud_dir = tmp_path / "pc" / "c6"
    with pytest.raises(JobFailure):
        _run(make_las(tmp_path / "c.las", 1_000), cloud_dir, converter=broken)
    assert not (cloud_dir / ".work").exists() and not (cloud_dir / "octree").exists()


def test_validation_failure_cleans_up(tmp_path):
    cloud_dir = tmp_path / "pc" / "c7"
    with pytest.raises(JobFailure) as e:
        _run(make_las(tmp_path / "c.las", 1_000), cloud_dir, converter=fake_converter(points_delta=-1))
    assert "999 points, expected 1000" in str(e.value)
    assert not (cloud_dir / ".work").exists() and not (cloud_dir / "octree").exists()


def test_cancel_during_the_scan_cleans_up(tmp_path):
    cloud_dir = tmp_path / "pc" / "c8"
    state = {"scanning": False}

    def progress(_f, m):
        state["scanning"] = state["scanning"] or m.startswith("scanning")

    def check():
        if state["scanning"]:
            raise JobCancelled()

    with pytest.raises(JobCancelled):
        import_cloud(
            make_las(tmp_path / "c.las", 5_000),
            cloud_dir,
            progress=progress,
            check_cancelled=check,
            converter=fake_converter(),
        )
    assert not (cloud_dir / ".work").exists()


class _Flaky(io.BytesIO):
    def read(self, n=-1):
        if self.tell() > 0:
            raise OSError(errno.EIO, "The specified network name is no longer available")
        return super().read(n)


def test_source_vanishing_mid_copy_cleans_up(tmp_path, monkeypatch):
    """Review Focus 2."""
    src = make_las(tmp_path / "c.las", 50_000)
    monkeypatch.setattr(workcopy, "COPY_CHUNK", 100_000)
    monkeypatch.setattr(workcopy, "_open_source", lambda p: _Flaky(p.read_bytes()))
    cloud_dir = tmp_path / "pc" / "c9"
    with pytest.raises(JobFailure) as e:
        _run(src, cloud_dir, converter=fake_converter())
    assert str(e.value).startswith("could not read the source file:")
    assert not (cloud_dir / ".work").exists()


def test_full_drive_cleans_up(tmp_path, monkeypatch):
    """Review Focus 3."""

    class Full(io.BytesIO):
        def write(self, b):
            raise OSError(errno.ENOSPC, "There is not enough space on the disk")

    monkeypatch.setattr(workcopy, "_open_dest", lambda p: Full())
    cloud_dir = tmp_path / "pc" / "c10"
    with pytest.raises(JobFailure) as e:
        _run(make_las(tmp_path / "c.las", 1_000), cloud_dir, converter=fake_converter())
    assert str(e.value) == "the project drive is full; free some space and import again"
    assert not (cloud_dir / ".work").exists()


@pytest.mark.potreeconverter
@pytest.mark.skipif(converter_path.converter_exe() is None, reason="PotreeConverter payload not fetched")
def test_the_real_converter_on_a_pix4d_style_laz(tmp_path):
    src = make_las(tmp_path / "fixture.laz", 50_000, compressed=True, header_shrink_mm=0.3)
    r, _ = _run(src, tmp_path / "pc" / "real")
    meta = json.loads((tmp_path / "pc" / "real" / "octree" / "metadata.json").read_text("utf-8"))
    assert (r.bounds_repaired, r.crs.epsg, meta["points"], meta["encoding"]) == (
        True,
        32639,
        50_000,
        "BROTLI",
    )
```

- [ ] **Step 2: Run them to verify they fail**

Run: `cd backend; & $PY -m pytest tests/test_pointcloud_importer.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'app.pointclouds.importer'`.

- [ ] **Step 3: Write `importer.py`**

`backend/app/pointclouds/importer.py`:

```python
"""The point-cloud import pipeline (spec §6), with no database.

copy + hash (0-30 %) -> scan (30-45 %) -> CRS -> header repair -> admission re-check ->
convert (45-97 %) -> validate (97-99 %) -> octree/ + source.json. Both the `pointcloud_import`
job and `pointcloud-selftest` call `import_cloud`, so the selftest exercises the real path.
"""

from __future__ import annotations

import json
import os
import shutil
import time
from collections.abc import Callable
from dataclasses import dataclass, field
from datetime import date
from pathlib import Path

import laspy

from app.jobs.cancellation import JobFailure
from app.pointclouds import admission
from app.pointclouds.crs import CrsInfo, bounds_wgs84, crs_from_header
from app.pointclouds.lasfile import inspect_file
from app.pointclouds.scan import scan
from app.pointclouds.validate import validate_octree
from app.pointclouds.workcopy import copy_and_hash, repair_header

COPY_END, SCAN_END, CONVERT_END, VALIDATE_END = 0.30, 0.45, 0.97, 0.99


@dataclass
class ImportResult:
    point_count: int
    header_count: int
    las_version: str
    point_format: int
    has_rgb: bool
    scale: list[float]
    crs: CrsInfo
    bounds_native: list[float]
    bounds_repaired: bool
    bounds_wgs84: list[float] | None
    z_stats: dict
    class_counts: dict[str, int]
    octree_spacing_m: float
    octree_bytes: int
    encoding: str
    source_sha256: str
    source_size: int
    source_mtime: float
    captured_on: date | None
    seconds: float
    timings: dict[str, float] = field(default_factory=dict)
    log_tail: list[str] = field(default_factory=list)  # the converter's last lines, for the job log


def _gb(n: int) -> str:
    return f"{n / 1e9:.1f}"


def _mpts(n: int) -> str:
    return f"{n / 1e6:.0f} M" if n >= 10_000_000 else f"{n / 1e6:.1f} M"


def import_cloud(
    source: Path,
    cloud_dir: Path,
    *,
    progress: Callable[[float, str], None],
    check_cancelled: Callable[[], None],
    converter: Callable | None = None,
) -> ImportResult:
    if converter is None:
        from app.pointclouds import converter as converter_module

        converter = converter_module.run_converter  # looked up now: the test seam patches the module
    started = time.monotonic()
    timings: dict[str, float] = {}
    work, octree = cloud_dir / ".work", cloud_dir / "octree"

    def lap(name: str, t: float) -> float:
        now = time.monotonic()
        timings[name] = round(now - t, 3)
        return now

    try:
        try:
            st = source.stat()
        except OSError as e:
            raise JobFailure(f"could not read the source file: {source} ({e.strerror or e})") from None
        info = inspect_file(source)
        admission.require(admission.assess(info.point_count, st.st_size, info.record_len, cloud_dir.parent))
        shutil.rmtree(work, ignore_errors=True)
        work.mkdir(parents=True)
        t = time.monotonic()
        copy = work / f"input{source.suffix.lower()}"
        sha = copy_and_hash(
            source,
            copy,
            progress=lambda d, n: progress(COPY_END * d / max(n, 1), f"copying {_gb(d)} / {_gb(n)} GB"),
            check_cancelled=check_cancelled,
        )
        t = lap("copy_s", t)
        scanned = scan(
            copy,
            progress=lambda d, n: progress(
                COPY_END + (SCAN_END - COPY_END) * min(d / max(n, 1), 1.0),
                f"scanning {_mpts(d)} / {_mpts(n)} points",
            ),
            check_cancelled=check_cancelled,
        )
        t = lap("scan_s", t)
        with laspy.open(copy) as r:
            crs = crs_from_header(r.header)
        wgs84 = bounds_wgs84(scanned.bounds, crs.crs_wkt) if crs.crs_wkt else None
        repaired = repair_header(copy, scanned.bounds, info.scale)
        t = lap("crs_repair_s", t)
        check_cancelled()
        admission.require(admission.assess(scanned.count, st.st_size, info.record_len, cloud_dir.parent))
        out = work / "octree"
        result = converter(
            copy,
            out,
            progress=lambda f, m: progress(SCAN_END + (CONVERT_END - SCAN_END) * f, m),
            check_cancelled=check_cancelled,
        )
        t = lap("convert_s", t)
        progress(CONVERT_END, "checking the 3D view copy")
        meta = validate_octree(out, points=scanned.count, bounds=scanned.bounds, encoding=result.encoding)
        shutil.rmtree(octree, ignore_errors=True)
        os.replace(out, octree)  # same volume: atomic
        octree_bytes = sum(f.stat().st_size for f in octree.iterdir() if f.is_file())
        lap("validate_s", t)
        record = {
            "path": str(source),
            "size": st.st_size,
            "mtime": st.st_mtime,
            "sha256": sha,
            "header": {
                "las_version": info.las_version,
                "point_format": info.point_format,
                "point_count": info.point_count,
                "scales": info.scale,
                "offsets": info.offsets,
                "bounds": info.header_bounds,
            },
            "scanned_point_count": scanned.count,
            "point_count_mismatch": scanned.count != scanned.header_count,
            "true_bounds": scanned.bounds,
            "bounds_repaired": repaired,
            "vlrs": info.vlrs,
            "crs_wkt": crs.crs_wkt,
            "crs_warning": crs.warning,
            "converter": {
                "version": result.version,
                "command": result.command,
                "encoding": result.encoding,
                "log_tail": result.log_tail,
            },
            "timings": timings,
        }
        (cloud_dir / "source.json").write_text(json.dumps(record, indent=2, default=str), "utf-8")
        progress(VALIDATE_END, "3D view copy ready")
    except BaseException:
        shutil.rmtree(octree, ignore_errors=True)
        raise
    finally:
        shutil.rmtree(work, ignore_errors=True)
    return ImportResult(
        point_count=scanned.count,
        header_count=scanned.header_count,
        las_version=info.las_version,
        point_format=info.point_format,
        has_rgb=info.has_rgb,
        scale=info.scale,
        crs=crs,
        bounds_native=scanned.bounds,
        bounds_repaired=repaired,
        bounds_wgs84=wgs84,
        z_stats=scanned.z_stats,
        class_counts=scanned.class_counts,
        octree_spacing_m=float(meta["spacing"]),
        octree_bytes=octree_bytes,
        encoding=result.encoding,
        source_sha256=sha,
        source_size=st.st_size,
        source_mtime=st.st_mtime,
        captured_on=info.captured_on,
        seconds=round(time.monotonic() - started, 3),
        timings=timings,
        log_tail=list(result.log_tail),
    )
```

- [ ] **Step 4: Register the marker**

`backend/pyproject.toml`, in `[tool.pytest.ini_options]` `markers`, add `"potreeconverter: runs the real PotreeConverter from backend/third_party (skipped when fetch_potreeconverter.ps1 has not run)"`. It is not excluded in `addopts`: the test runs wherever the payload exists and skips elsewhere (spec §16).

- [ ] **Step 5: Run the tests to verify they pass**

Run: `cd backend; & $PY -m pytest tests/test_pointcloud_importer.py -v`
Expected: PASS, including `test_the_real_converter_on_a_pix4d_style_laz` in a worktree where Task 2's fetch ran (it needs `backend/third_party/potreeconverter/`; set `KESTREL_POTREECONVERTER` to the integration worktree's copy when running from a sub-worktree).

- [ ] **Step 6: Gate and commit**

```powershell
git add backend/app/pointclouds/importer.py backend/pyproject.toml backend/tests/test_pointcloud_importer.py
git commit -m "feat(pointclouds): the import pipeline - work copy, scan, CRS, repair, re-admission, convert, validate

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 10: Octree endpoint (unit O1)

**Files:**
- Create: `backend/app/pointclouds/octree.py`
- Create: `backend/app/pointclouds/routes_octree.py`
- Modify: `backend/app/pointclouds/router.py` (remove the `getPointCloudOctreeFile` stub tuple; add `octree_routes` to `SUB_ROUTERS`)
- Modify: `backend/tests/test_contract.py` (remove `"getPointCloudOctreeFile"` from `EXPECTED_STUBS`; add `"getPointCloudOctreeFile": {416}` to F0's `REFUSES_VALID_DATA`)
- Test: `backend/tests/test_pointcloud_octree.py`

**Interfaces:**
- Consumes: Task 1 `rows.require_ready`, `rows.octree_dir`, `rows.OCTREE_FILES`; `tests.pointclouds.insert_cloud`.
- Produces: `octree.MAX_RANGE = 64 MiB`, `octree.STREAM_CHUNK = 1 MiB`, `octree.RangeNotSatisfiable`, `octree.parse_range(header, size) -> tuple[int, int] | None` (inclusive; `None` = whole file), `octree.stream(path, start, length) -> Iterator[bytes]`, seam `octree._open(path)`; `routes_octree.sub` (an `APIRouter`) with `GET /pointclouds/{cloudId}/octree/{octreeFile}`.

- [ ] **Step 1: Write the failing tests**

`backend/tests/test_pointcloud_octree.py`:

```python
"""Octree serving (spec §7): Range rules, the filename enum, readiness, caching, the preflight."""

import os

import pytest
from pointclouds import insert_cloud

from app.pointclouds import octree, rows

BASE = "/api/v1/projects"
MIB = 1024 * 1024


@pytest.fixture
def project_kind() -> str:
    return "detect"


@pytest.fixture
def cloud(handle):
    cloud_id = insert_cloud(handle)
    folder = rows.octree_dir(handle, cloud_id)
    folder.mkdir(parents=True)
    (folder / "metadata.json").write_bytes(b'{"version": "2.0"}')
    (folder / "hierarchy.bin").write_bytes(bytes(range(256)) * 4)  # 1024 bytes
    (folder / "octree.bin").write_bytes(os.urandom(3 * MIB))
    return cloud_id, folder


def url(project_id, cloud_id, name):
    return f"{BASE}/{project_id}/pointclouds/{cloud_id}/octree/{name}"


@pytest.mark.parametrize(
    ("header", "start", "end"),
    [
        ("bytes=0-21", 0, 21),
        ("bytes=100-", 100, 1023),
        ("bytes=-10", 1014, 1023),
        ("bytes=1000-5000", 1000, 1023),
    ],
)
def test_single_ranges_answer_206_with_the_exact_slice(client, project_id, cloud, header, start, end):
    cloud_id, folder = cloud
    r = client.get(url(project_id, cloud_id, "hierarchy.bin"), headers={"Range": header})
    assert r.status_code == 206
    assert r.content == (folder / "hierarchy.bin").read_bytes()[start : end + 1]
    assert r.headers["content-range"] == f"bytes {start}-{end}/1024"
    assert r.headers["content-length"] == str(end - start + 1)
    assert r.headers["accept-ranges"] == "bytes"
    assert r.headers["content-type"] == "application/octet-stream"
    assert r.headers["cache-control"] == "private, max-age=31536000, immutable"


def test_metadata_is_json_and_small_files_come_whole(client, project_id, cloud):
    cloud_id, _ = cloud
    r = client.get(url(project_id, cloud_id, "metadata.json"))
    assert r.status_code == 200 and r.headers["content-type"].startswith("application/json")
    assert r.json() == {"version": "2.0"} and r.headers["accept-ranges"] == "bytes"


@pytest.mark.parametrize(
    "header", ["bytes=0-1,5-6", "bytes=abc", "items=0-1", "bytes=5-1", "bytes=1024-", "bytes=-0", "bytes=-"]
)
def test_unsatisfiable_ranges_are_416(client, project_id, cloud, header):
    cloud_id, _ = cloud
    r = client.get(url(project_id, cloud_id, "hierarchy.bin"), headers={"Range": header})
    assert r.status_code == 416
    assert r.headers["content-range"] == "bytes */1024"
    assert r.json()["error"]["code"] == "range_not_satisfiable"


def test_more_than_64_mib_is_416_with_or_without_a_range(client, project_id, cloud):
    cloud_id, folder = cloud
    with open(folder / "octree.bin", "r+b") as f:
        f.truncate(65 * MIB)
    assert (
        client.get(url(project_id, cloud_id, "octree.bin"), headers={"Range": "bytes=0-"}).status_code == 416
    )
    assert client.get(url(project_id, cloud_id, "octree.bin")).status_code == 416
    r = client.get(url(project_id, cloud_id, "octree.bin"), headers={"Range": f"bytes=0-{64 * MIB - 1}"})
    assert r.status_code == 206 and len(r.content) == 64 * MIB


def test_streams_in_one_mib_chunks(cloud):
    _, folder = cloud
    chunks = list(octree.stream(folder / "octree.bin", 10, 3 * MIB - 10))
    assert [len(c) for c in chunks[:-1]] == [MIB] * (len(chunks) - 1)
    assert sum(map(len, chunks)) == 3 * MIB - 10


@pytest.mark.parametrize(
    "name", ["source.json", "octree.bin.bak", "metadata.json.", "OCTREE.BIN", "hierarchy"]
)
def test_other_names_are_422_and_never_touch_the_disk(client, project_id, cloud, monkeypatch, name):
    cloud_id, _ = cloud

    def spy(_path):
        raise AssertionError("open() must not be reached")

    monkeypatch.setattr(octree, "_open", spy)
    r = client.get(url(project_id, cloud_id, name))
    assert r.status_code == 422


def test_traversal_never_reaches_the_disk(client, project_id, cloud, monkeypatch):
    cloud_id, _ = cloud

    def spy(_path):
        raise AssertionError("open() must not be reached")

    monkeypatch.setattr(octree, "_open", spy)
    r = client.get(f"{BASE}/{project_id}/pointclouds/{cloud_id}/octree/..%2Fsource.json")
    assert r.status_code in (404, 422)


def test_unknown_cloud_is_404_and_importing_is_409(client, project_id, handle):
    assert client.get(url(project_id, "nope", "metadata.json")).status_code == 404
    importing = insert_cloud(handle, status="importing")
    r = client.get(url(project_id, importing, "metadata.json"))
    assert r.status_code == 409 and r.json()["error"]["code"] == "not_ready"


def test_missing_octree_files_say_so(client, project_id, cloud):
    """Review Focus 5: the folder was cleaned by hand."""
    cloud_id, folder = cloud
    (folder / "hierarchy.bin").unlink()
    r = client.get(url(project_id, cloud_id, "hierarchy.bin"), headers={"Range": "bytes=0-21"})
    assert r.status_code == 404
    assert r.json()["error"] == {
        "code": "octree_missing",
        "message": "the 3D view copy is missing; import the file again",
        "details": {},
    }


def test_the_token_query_param_authorises(anon, project_id, cloud):
    cloud_id, _ = cloud
    assert anon.get(url(project_id, cloud_id, "metadata.json")).status_code == 401
    assert anon.get(url(project_id, cloud_id, "metadata.json") + "?token=test-token").status_code == 200


def test_the_loaders_preflight_is_answered(anon, project_id, cloud):
    cloud_id, _ = cloud
    r = anon.options(
        url(project_id, cloud_id, "hierarchy.bin"),
        headers={
            "Origin": "http://tauri.localhost",
            "Access-Control-Request-Method": "GET",
            "Access-Control-Request-Headers": "content-type,range",
        },
    )
    assert r.status_code == 200
    allowed = r.headers["access-control-allow-headers"].lower()
    assert "range" in allowed and "content-type" in allowed


def test_range_headers_are_exposed_to_the_page(client, project_id, cloud):
    cloud_id, _ = cloud
    r = client.get(
        url(project_id, cloud_id, "hierarchy.bin"),
        headers={"Range": "bytes=0-21", "Origin": "http://tauri.localhost"},
    )
    assert "content-range" in r.headers["access-control-expose-headers"].lower()
```

- [ ] **Step 2: Run them to verify they fail**

Run: `cd backend; & $PY -m pytest tests/test_pointcloud_octree.py -v`
Expected: FAIL — `ImportError: cannot import name 'octree'`, and the route still answers 501.

- [ ] **Step 3: Write `octree.py`**

`backend/app/pointclouds/octree.py`:

```python
"""HTTP Range serving of a cloud's octree files (spec §7): one file handle, 1 MiB chunks."""

from __future__ import annotations

import re
from collections.abc import Iterator
from pathlib import Path

MAX_RANGE = 64 * 1024 * 1024
STREAM_CHUNK = 1024 * 1024
_RANGE = re.compile(r"^bytes=(\d*)-(\d*)$")


class RangeNotSatisfiable(Exception):
    pass


def parse_range(header: str | None, size: int) -> tuple[int, int] | None:
    """`(start, end)` inclusive for exactly one satisfiable range; `None` for "the whole file",
    allowed only up to 64 MiB. Anything else raises RangeNotSatisfiable (416)."""
    if header is None:
        if size > MAX_RANGE:
            raise RangeNotSatisfiable
        return None
    m = _RANGE.match(header.strip())
    if not m:
        raise RangeNotSatisfiable  # malformed, another unit, or several ranges
    first, last = m.groups()
    if first == "" and last == "":
        raise RangeNotSatisfiable
    if first == "":
        n = int(last)
        if n == 0:
            raise RangeNotSatisfiable
        start, end = max(0, size - n), size - 1
    else:
        start = int(first)
        end = size - 1 if last == "" else int(last)
        if end < start:
            raise RangeNotSatisfiable
        end = min(end, size - 1)
    if start >= size or end - start + 1 > MAX_RANGE:
        raise RangeNotSatisfiable
    return start, end


def _open(path: Path):
    return open(path, "rb")


def stream(path: Path, start: int, length: int) -> Iterator[bytes]:
    with _open(path) as f:
        f.seek(start)
        left = length
        while left > 0:
            block = f.read(min(STREAM_CHUNK, left))
            if not block:
                break
            left -= len(block)
            yield block
```

- [ ] **Step 4: Write the route**

`backend/app/pointclouds/routes_octree.py`:

```python
"""GET /pointclouds/{cloudId}/octree/{octreeFile} (spec §4.1 op 7, §7).

`octreeFile` is an enum, so any other name is a 422 before any filesystem access; the folder comes
from the database row's id, never from request text. Preflight OPTIONS requests are answered by
CORSMiddleware before routing (spec §2 "CORS").
"""

from __future__ import annotations

from typing import Literal

from fastapi import APIRouter, Depends, Header
from fastapi.responses import JSONResponse, Response, StreamingResponse

from app.errors import AppError, envelope
from app.pointclouds import octree, rows
from app.projects.service import ProjectHandle, get_project

sub = APIRouter()
IMMUTABLE = "private, max-age=31536000, immutable"
MISSING = "the 3D view copy is missing; import the file again"


@sub.get("/pointclouds/{cloudId}/octree/{octreeFile}", response_class=Response)
def get_point_cloud_octree_file(
    cloudId: str,  # noqa: N803 - path parameter names come from the contract
    octreeFile: Literal["metadata.json", "hierarchy.bin", "octree.bin"],  # noqa: N803
    range_header: str | None = Header(default=None, alias="Range"),
    handle: ProjectHandle = Depends(get_project),
) -> Response:
    row = rows.require_ready(handle, cloudId)
    folder = rows.octree_dir(handle, row.id)
    path = folder / octreeFile
    if path.parent != folder or not path.is_file():
        raise AppError("octree_missing", MISSING, 404)
    size = path.stat().st_size
    try:
        span = octree.parse_range(range_header, size)
    except octree.RangeNotSatisfiable:
        return JSONResponse(
            envelope(
                "range_not_satisfiable",
                f"range {range_header!r} cannot be served for {octreeFile} ({size} bytes)",
            ),
            status_code=416,
            headers={"Content-Range": f"bytes */{size}", "Accept-Ranges": "bytes"},
        )
    media = "application/json" if octreeFile == "metadata.json" else "application/octet-stream"
    headers = {"Cache-Control": IMMUTABLE, "Accept-Ranges": "bytes"}
    if span is None:
        return StreamingResponse(
            octree.stream(path, 0, size), media_type=media, headers={**headers, "Content-Length": str(size)}
        )
    start, end = span
    length = end - start + 1
    return StreamingResponse(
        octree.stream(path, start, length),
        status_code=206,
        media_type=media,
        headers={**headers, "Content-Length": str(length), "Content-Range": f"bytes {start}-{end}/{size}"},
    )
```

In `backend/app/pointclouds/router.py`: delete the `("GET", "/pointclouds/{cloudId}/octree/{octreeFile}", "getPointCloudOctreeFile")` tuple from `STUBS`; add `from app.pointclouds.routes_octree import sub as octree_routes` to the imports and make the tuple `SUB_ROUTERS: tuple[APIRouter, ...] = (octree_routes,)` (later tasks append).

In `backend/tests/test_contract.py`, delete `"getPointCloudOctreeFile"` from `EXPECTED_STUBS`, and add the first entry to F0's `REFUSES_VALID_DATA` (Global Constraints, "The contract test and deliberate refusals"; F0 defined the dict empty, wired it into `test_responses_conform` and guards it with `test_refusal_allowances_name_real_operations_and_declared_statuses` — change nothing else):

```python
REFUSES_VALID_DATA: dict[str, set[int]] = {
    "getPointCloudOctreeFile": {416},  # a Range the file cannot satisfy
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `cd backend; & $PY -m pytest tests/test_pointcloud_octree.py tests/test_contract.py tests/test_project_kinds.py -v`
Expected: PASS. In the contract run a random `cloudId` answers 404 before the range is parsed; the allowance only matters for a request that reaches a real cloud.

- [ ] **Step 6: Gate and commit**

Rebase onto `task/pointclouds` first (Task 1 must be in; batch-mates 11 and 12 rebase after this one).

```powershell
git add backend/app/pointclouds/octree.py backend/app/pointclouds/routes_octree.py backend/app/pointclouds/router.py backend/tests/test_contract.py backend/tests/test_pointcloud_octree.py
git commit -m "feat(pointclouds): Range-aware octree endpoint restricted to three files

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 11: Measurements — formulas, shared vectors, CRUD (unit M1)

**Files:**
- Create: `contract/fixtures/cloud-measure-vectors.json`
- Create: `backend/app/pointclouds/measure.py`
- Create: `backend/app/pointclouds/measurements.py`
- Create: `backend/app/pointclouds/routes_measurements.py`
- Modify: `backend/app/pointclouds/router.py` (remove the four measurement stub tuples; add `measurement_routes`)
- Modify: `backend/tests/test_contract.py` (remove `listCloudMeasurements`, `createCloudMeasurement`, `updateCloudMeasurement`, `deleteCloudMeasurement` from `EXPECTED_STUBS`; add `"createCloudMeasurement": {422}` to `REFUSES_VALID_DATA`)
- Test: `backend/tests/test_pointcloud_measure.py`, `backend/tests/test_pointcloud_measurements_api.py`

**Interfaces:**
- Consumes: Task 1 `schemas.CloudMeasurementCreate/Update/Out/List`, `rows.get_cloud`, `rows.require_ready`, `insert_cloud`; F0 `publish_pointclouds_changed`.
- Produces:
  - `contract/fixtures/cloud-measure-vectors.json`: `{ "tolerance": 1e-9, "fields": [15 names], "cases": [{ "name", "kind", "points": [{x, y, z, uncertainty_m}], "results": {non-null fields only} }] }` — Task 16's vitest reads the same file.
  - `measure.FIELDS: list[str]` (the 15 result names, contract order); `measure.MIN_VERTICAL_SPAN_M = 0.5`; `measure.ordered(kind, points) -> list[dict]` (vertical: lower first); `measure.results(kind, points) -> dict[str, float | None]` (all 15 keys; no lon/lat).
  - `measurements.MAX_PER_CLOUD = 1000`; `measurements.LABELS`; `list_for(handle, cloud_id)`, `create(handle, cloud_id, body) -> CloudMeasurement`, `update(handle, cloud_id, measurement_id, body) -> CloudMeasurement`, `delete(handle, cloud_id, measurement_id) -> None`; `lonlat(crs_wkt, x, y) -> tuple[float, float]`.
  - Error codes (422): `wrong_point_count`, `needs_projected_crs`, `vertical_span_too_small`, `measurement_limit`; 404 `not_found` for an unknown measurement; 409 `not_ready` for a cloud that is not ready.
  - `routes_measurements.sub`.

- [ ] **Step 1: Write the shared vectors file**

`contract/fixtures/cloud-measure-vectors.json` (computed with the spec §9.3 formulas in float64; the 1° pole is `dx = 100 · tan 1°`):

```json
{
  "tolerance": 1e-9,
  "fields": ["lon", "lat", "dx", "dy", "dz", "distance_3d", "distance_horizontal", "distance_vertical", "height_difference", "lean_offset_m", "lean_angle_deg", "lean_azimuth_deg", "lean_mm_per_m", "uncertainty_m", "angle_uncertainty_deg"],
  "cases": [
    {
      "name": "a single pick", "kind": "point",
      "points": [{"x": 243522.123, "y": 3178252.456, "z": -44.321, "uncertainty_m": 0.032}],
      "results": {"uncertainty_m": 0.032}
    },
    {
      "name": "3-4-12 box diagonal", "kind": "distance",
      "points": [{"x": 0, "y": 0, "z": 0, "uncertainty_m": 0.03}, {"x": 3, "y": 4, "z": 12, "uncertainty_m": 0.04}],
      "results": {"dx": 3, "dy": 4, "dz": 12, "distance_3d": 13.0, "distance_horizontal": 5.0, "distance_vertical": 12, "height_difference": 12, "uncertainty_m": 0.05}
    },
    {
      "name": "UTM coordinates, going down", "kind": "distance",
      "points": [{"x": 500000.5, "y": 4983000.25, "z": 100.0, "uncertainty_m": 0.01}, {"x": 500010.5, "y": 4982990.25, "z": 95.0, "uncertainty_m": 0.02}],
      "results": {"dx": 10.0, "dy": -10.0, "dz": -5.0, "distance_3d": 15.0, "distance_horizontal": 14.142135623730951, "distance_vertical": 5.0, "height_difference": -5.0, "uncertainty_m": 0.022360679774997897}
    },
    {
      "name": "second pick lower: negative", "kind": "height",
      "points": [{"x": 10, "y": 10, "z": 50, "uncertainty_m": 0.005}, {"x": 10, "y": 12, "z": 47.5, "uncertainty_m": 0.005}],
      "results": {"dx": 0, "dy": 2, "dz": -2.5, "distance_3d": 3.2015621187164243, "distance_horizontal": 2.0, "distance_vertical": 2.5, "height_difference": -2.5, "uncertainty_m": 0.007071067811865475}
    },
    {
      "name": "second pick higher: positive", "kind": "height",
      "points": [{"x": 243500, "y": 3178200, "z": -45.2, "uncertainty_m": 0.02}, {"x": 243501, "y": 3178200.5, "z": 130.8, "uncertainty_m": 0.08}],
      "results": {"dx": 1, "dy": 0.5, "dz": 176.0, "distance_3d": 176.00355110053889, "distance_horizontal": 1.118033988749895, "distance_vertical": 176.0, "height_difference": 176.0, "uncertainty_m": 0.08246211251235322}
    },
    {
      "name": "pole leaning exactly 1 degree to grid east", "kind": "vertical",
      "points": [{"x": 243522, "y": 3178252, "z": -44, "uncertainty_m": 0.01}, {"x": 243523.74550649282, "y": 3178252, "z": 56, "uncertainty_m": 0.01}],
      "results": {"dx": 1.7455064928217325, "dy": 0, "dz": 100, "distance_3d": 100.01523280439076, "distance_horizontal": 1.7455064928217325, "distance_vertical": 100, "height_difference": 100, "lean_offset_m": 1.7455064928217325, "lean_angle_deg": 0.9999999999999851, "lean_azimuth_deg": 90.0, "lean_mm_per_m": 17.455064928217325, "uncertainty_m": 0.01414213562373095, "angle_uncertainty_deg": 0.008102846791394976}
    },
    {
      "name": "top picked first: sorted by Z", "kind": "vertical",
      "points": [{"x": 243523.74550649282, "y": 3178252, "z": 56, "uncertainty_m": 0.01}, {"x": 243522, "y": 3178252, "z": -44, "uncertainty_m": 0.01}],
      "results": {"dx": 1.7455064928217325, "dy": 0, "dz": 100, "distance_3d": 100.01523280439076, "distance_horizontal": 1.7455064928217325, "distance_vertical": 100, "height_difference": 100, "lean_offset_m": 1.7455064928217325, "lean_angle_deg": 0.9999999999999851, "lean_azimuth_deg": 90.0, "lean_mm_per_m": 17.455064928217325, "uncertainty_m": 0.01414213562373095, "angle_uncertainty_deg": 0.008102846791394976}
    },
    {
      "name": "lean to the north-west", "kind": "vertical",
      "points": [{"x": 1000, "y": 2000, "z": 0, "uncertainty_m": 0.05}, {"x": 999, "y": 2001, "z": 50, "uncertainty_m": 0.05}],
      "results": {"dx": -1, "dy": 1, "dz": 50, "distance_3d": 50.0199960015992, "distance_horizontal": 1.4142135623730951, "distance_vertical": 50, "height_difference": 50, "lean_offset_m": 1.4142135623730951, "lean_angle_deg": 1.6201374245654556, "lean_azimuth_deg": 315.0, "lean_mm_per_m": 28.284271247461902, "uncertainty_m": 0.07071067811865477, "angle_uncertainty_deg": 0.0810284144352254}
    },
    {
      "name": "perfectly plumb", "kind": "vertical",
      "points": [{"x": 5, "y": 5, "z": 0, "uncertainty_m": 0.02}, {"x": 5, "y": 5, "z": 30, "uncertainty_m": 0.02}],
      "results": {"dx": 0, "dy": 0, "dz": 30, "distance_3d": 30.0, "distance_horizontal": 0.0, "distance_vertical": 30, "height_difference": 30, "lean_offset_m": 0.0, "lean_angle_deg": 0.0, "lean_azimuth_deg": 0.0, "lean_mm_per_m": 0.0, "uncertainty_m": 0.0282842712474619, "angle_uncertainty_deg": 0.054018962963811507}
    },
    {
      "name": "lean to the south, chimney scale", "kind": "vertical",
      "points": [{"x": 243522.4, "y": 3178252.1, "z": -44.0, "uncertainty_m": 0.012}, {"x": 243522.35, "y": 3178251.93, "z": 175.6, "uncertainty_m": 0.031}],
      "results": {"dx": -0.04999999998835847, "dy": -0.1699999999254942, "dz": 219.6, "distance_3d": 219.60007149361306, "distance_horizontal": 0.17720045139193036, "distance_vertical": 219.6, "height_difference": 219.6, "lean_offset_m": 0.17720045139193036, "lean_angle_deg": 0.04623331415746636, "lean_azimuth_deg": 196.38954033722115, "lean_mm_per_m": 0.8069237312929434, "uncertainty_m": 0.03324154027718932, "angle_uncertainty_deg": 0.008673041656875507}
    }
  ]
}
```

- [ ] **Step 2: Write the failing formula tests**

`backend/tests/test_pointcloud_measure.py`:

```python
"""Measurement formulas (spec §9.3), pinned by the vectors vitest reads too."""

import json
import math
from pathlib import Path

import pytest

from app.pointclouds import measure

VECTORS = json.loads(
    (Path(__file__).resolve().parents[2] / "contract" / "fixtures" / "cloud-measure-vectors.json").read_text(
        "utf-8"
    )
)


@pytest.mark.parametrize("case", VECTORS["cases"], ids=lambda c: c["name"])
def test_shared_vectors(case):
    got = measure.results(case["kind"], case["points"])
    assert list(got) == VECTORS["fields"]
    for field in VECTORS["fields"]:
        want = case["results"].get(field)
        if want is None:
            assert got[field] is None, field  # lon/lat are filled by the service, never by the formulas
        else:
            assert got[field] == pytest.approx(want, abs=VECTORS["tolerance"]), field


def test_a_pole_leaning_one_degree_to_grid_east():
    top = {"x": 100 * math.tan(math.radians(1)), "y": 0.0, "z": 100.0, "uncertainty_m": 0.01}
    r = measure.results("vertical", [{"x": 0.0, "y": 0.0, "z": 0.0, "uncertainty_m": 0.01}, top])
    assert r["lean_angle_deg"] == pytest.approx(1.00, abs=0.02)
    assert r["lean_azimuth_deg"] == pytest.approx(90, abs=1)
    assert r["lean_mm_per_m"] == pytest.approx(17.5, abs=0.4)


def test_vertical_points_are_ordered_lower_first():
    hi = {"x": 1, "y": 1, "z": 10, "uncertainty_m": 0}
    lo = {"x": 0, "y": 0, "z": 0, "uncertainty_m": 0}
    assert measure.ordered("vertical", [hi, lo]) == [lo, hi]
    assert measure.ordered("distance", [hi, lo]) == [hi, lo]
```

- [ ] **Step 3: Write the failing API tests**

`backend/tests/test_pointcloud_measurements_api.py`:

```python
"""Measurement CRUD (spec §4.1 ops 8-11, §9): server-computed results, refusals, the cap, events."""

import pytest
from pointclouds import insert_cloud
from pyproj import CRS, Transformer

from app.db.models import CloudMeasurement

BASE = "/api/v1/projects"
P = lambda x, y, z, u=0.01: {"x": x, "y": y, "z": z, "uncertainty_m": u}  # noqa: E731


@pytest.fixture
def project_kind() -> str:
    return "detect"


@pytest.fixture
def cloud_id(handle):
    return insert_cloud(handle)


def murl(project_id, cloud_id, mid=""):
    return f"{BASE}/{project_id}/pointclouds/{cloud_id}/measurements" + (f"/{mid}" if mid else "")


def test_create_list_rename_delete(client, project_id, cloud_id):
    body = {"kind": "distance", "points": [P(243500, 3178000, 0), P(243503, 3178004, 12)]}
    r = client.post(murl(project_id, cloud_id), json=body)
    assert r.status_code == 201, r.text
    m = r.json()
    assert m["name"] == "Distance 1" and m["results"]["distance_3d"] == pytest.approx(13.0)
    assert m["results"]["lean_angle_deg"] is None
    second = client.post(murl(project_id, cloud_id), json=body).json()
    assert second["name"] == "Distance 2"
    r = client.patch(
        murl(project_id, cloud_id, m["id"]), json={"name": "Stack to gate", "note": "north face"}
    )
    assert r.status_code == 200 and (r.json()["name"], r.json()["note"]) == ("Stack to gate", "north face")
    items = client.get(murl(project_id, cloud_id)).json()["items"]
    assert [i["name"] for i in items] == ["Stack to gate", "Distance 2"]
    assert client.delete(murl(project_id, cloud_id, m["id"])).status_code == 204
    assert client.delete(murl(project_id, cloud_id, m["id"])).status_code == 404


def test_the_server_recomputes_and_ignores_client_results(client, project_id, cloud_id):
    body = {
        "kind": "height",
        "points": [P(10, 10, 50), P(10, 12, 47.5)],
        "results": {"height_difference": 999},
    }
    m = client.post(murl(project_id, cloud_id), json=body).json()
    assert m["results"]["height_difference"] == pytest.approx(-2.5)


def test_point_gets_wgs84_from_pyproj(client, project_id, cloud_id):
    m = client.post(
        murl(project_id, cloud_id), json={"kind": "point", "points": [P(243522.123, 3178252.456, -44.3)]}
    ).json()
    lon, lat = Transformer.from_crs(32639, 4326, always_xy=True).transform(243522.123, 3178252.456)
    assert m["results"]["lon"] == pytest.approx(lon, abs=1e-7) and m["results"]["lat"] == pytest.approx(
        lat, abs=1e-7
    )
    assert m["name"] == "Point 1"


def test_vertical_is_stored_lower_first(client, project_id, cloud_id):
    m = client.post(
        murl(project_id, cloud_id), json={"kind": "vertical", "points": [P(1, 1, 60), P(1, 1.1, 0)]}
    ).json()
    assert [p["z"] for p in m["points"]] == [0, 60] and m["name"] == "Vertical check 1"


@pytest.mark.parametrize(
    ("body", "code"),
    [
        ({"kind": "point", "points": [P(0, 0, 0), P(1, 1, 1)]}, "wrong_point_count"),
        ({"kind": "distance", "points": [P(0, 0, 0)]}, "wrong_point_count"),
        ({"kind": "vertical", "points": [P(0, 0, 0), P(0.2, 0, 0.49)]}, "vertical_span_too_small"),
    ],
)
def test_refusals(client, project_id, cloud_id, body, code):
    r = client.post(murl(project_id, cloud_id), json=body)
    assert r.status_code == 422 and r.json()["error"]["code"] == code


def test_vertical_refusal_names_the_fix(client, project_id, cloud_id):
    r = client.post(
        murl(project_id, cloud_id), json={"kind": "vertical", "points": [P(0, 0, 0), P(0, 0, 0.3)]}
    )
    assert r.json()["error"]["message"] == "pick points further apart vertically (at least 0.5 m)"


def test_geographic_clouds_refuse_distances(client, project_id, handle):
    """Review Focus 4."""
    wgs = CRS.from_epsg(4326)
    geo = insert_cloud(handle, crs_wkt=wgs.to_wkt(), epsg=4326, proj4=wgs.to_proj4())
    r = client.post(
        murl(project_id, geo), json={"kind": "distance", "points": [P(48.1, 28.1, 0), P(48.2, 28.2, 5)]}
    )
    assert r.status_code == 422 and r.json()["error"]["code"] == "needs_projected_crs"
    assert (
        r.json()["error"]["message"]
        == "distances need a projected coordinate system; this cloud is in degrees"
    )
    assert (
        client.post(murl(project_id, geo), json={"kind": "point", "points": [P(48.1, 28.1, 0)]}).status_code
        == 201
    )


def test_no_crs_point_has_no_wgs84(client, project_id, handle):
    bare = insert_cloud(handle, crs_wkt=None, epsg=None, proj4=None, crs_source=None, bounds_wgs84=None)
    m = client.post(murl(project_id, bare), json={"kind": "point", "points": [P(1, 2, 3)]}).json()
    assert m["results"]["lon"] is None and m["results"]["uncertainty_m"] == pytest.approx(0.01)


def test_the_1000_cap(client, project_id, handle, cloud_id):
    with handle.session() as s:
        for i in range(1000):
            s.add(
                CloudMeasurement(
                    point_cloud_id=cloud_id,
                    kind="point",
                    name=f"Point {i + 1}",
                    note=None,
                    points=[P(0, 0, 0)],
                    results={},
                )
            )
    r = client.post(murl(project_id, cloud_id), json={"kind": "point", "points": [P(0, 0, 0)]})
    assert r.status_code == 422 and r.json()["error"]["code"] == "measurement_limit"


def test_unknown_cloud_404_and_not_ready_409(client, project_id, handle):
    body = {"kind": "point", "points": [P(0, 0, 0)]}
    assert client.post(murl(project_id, "nope"), json=body).status_code == 404
    importing = insert_cloud(handle, status="importing")
    assert client.post(murl(project_id, importing), json=body).status_code == 409


def test_changes_publish_pointclouds_changed(client, project_id, cloud_id, app):
    seen = []
    original = app.state.events.publish
    app.state.events.publish = lambda e: (seen.append(e), original(e))
    client.post(murl(project_id, cloud_id), json={"kind": "point", "points": [P(0, 0, 0)]})
    assert any(e["type"] == "pointclouds.changed" and e["payload"] == {"cloud_ids": [cloud_id]} for e in seen)
```

- [ ] **Step 4: Run them to verify they fail**

Run: `cd backend; & $PY -m pytest tests/test_pointcloud_measure.py tests/test_pointcloud_measurements_api.py -v`
Expected: FAIL — `ImportError: cannot import name 'measure'`; the API tests get 501.

- [ ] **Step 5: Write `measure.py`**

`backend/app/pointclouds/measure.py`:

```python
"""Measurement formulas (spec §9.3), identical to frontend/src/clouds/measure.ts.

Both are pinned by contract/fixtures/cloud-measure-vectors.json to 1e-9. For picks A and B:
d = B - A, u = sqrt(uA^2 + uB^2). A vertical check sorts its picks by Z (A lower, B upper).
"""

from __future__ import annotations

import math

FIELDS = [
    "lon",
    "lat",
    "dx",
    "dy",
    "dz",
    "distance_3d",
    "distance_horizontal",
    "distance_vertical",
    "height_difference",
    "lean_offset_m",
    "lean_angle_deg",
    "lean_azimuth_deg",
    "lean_mm_per_m",
    "uncertainty_m",
    "angle_uncertainty_deg",
]
MIN_VERTICAL_SPAN_M = 0.5


def ordered(kind: str, points: list[dict]) -> list[dict]:
    if kind == "vertical" and len(points) == 2 and points[1]["z"] < points[0]["z"]:
        return [points[1], points[0]]
    return list(points)


def results(kind: str, points: list[dict]) -> dict[str, float | None]:
    out: dict[str, float | None] = dict.fromkeys(FIELDS)
    if kind == "point":
        out["uncertainty_m"] = float(points[0]["uncertainty_m"])
        return out
    a, b = ordered(kind, points)
    dx, dy, dz = b["x"] - a["x"], b["y"] - a["y"], b["z"] - a["z"]
    u = math.sqrt(a["uncertainty_m"] ** 2 + b["uncertainty_m"] ** 2)
    h = math.hypot(dx, dy)
    out.update(
        dx=dx,
        dy=dy,
        dz=dz,
        distance_3d=math.sqrt(dx * dx + dy * dy + dz * dz),
        distance_horizontal=h,
        distance_vertical=abs(dz),
        height_difference=dz,
        uncertainty_m=u,
    )
    if kind == "vertical":
        span = abs(dz)
        out.update(
            lean_offset_m=h,
            lean_angle_deg=math.degrees(math.atan2(h, span)),
            lean_azimuth_deg=(math.atan2(dx, dy) * 180 / math.pi + 360) % 360,
            lean_mm_per_m=1000 * h / span,
            angle_uncertainty_deg=math.degrees(math.atan(u / span)),
        )
    return out
```

- [ ] **Step 6: Write `measurements.py`**

`backend/app/pointclouds/measurements.py`:

```python
"""Measurement rows (spec §3 `cloud_measurement`, §9): the server computes and stores the results."""

from __future__ import annotations

import re
from datetime import UTC, datetime

from pyproj import CRS, Transformer
from sqlalchemy import func, select

from app.db.models import CloudMeasurement
from app.errors import AppError, not_found
from app.pointclouds import measure, rows
from app.pointclouds.schemas import CloudMeasurementCreate, CloudMeasurementUpdate
from app.projects.service import ProjectHandle

MAX_PER_CLOUD = 1000
LABELS = {
    "point": "Point",
    "distance": "Distance",
    "height": "Height difference",
    "vertical": "Vertical check",
}


def lonlat(crs_wkt: str, x: float, y: float) -> tuple[float, float]:
    lon, lat = Transformer.from_crs(CRS.from_wkt(crs_wkt), CRS.from_epsg(4326), always_xy=True).transform(
        x, y
    )
    return float(lon), float(lat)


def list_for(handle: ProjectHandle, cloud_id: str) -> list[CloudMeasurement]:
    rows.get_cloud(handle, cloud_id)
    with handle.session() as s:
        items = list(
            s.execute(
                select(CloudMeasurement)
                .where(CloudMeasurement.point_cloud_id == cloud_id)
                .order_by(CloudMeasurement.created_at, CloudMeasurement.id)
            ).scalars()
        )
        for m in items:
            s.expunge(m)
    return items


def _next_name(s, cloud_id: str, kind: str) -> str:
    label = LABELS[kind]
    pattern = re.compile(rf"^{re.escape(label)} (\d+)$")
    names = s.execute(
        select(CloudMeasurement.name).where(
            CloudMeasurement.point_cloud_id == cloud_id, CloudMeasurement.kind == kind
        )
    ).scalars()
    numbers = [int(m.group(1)) for n in names if (m := pattern.match(n))]
    return f"{label} {max(numbers, default=0) + 1}"


def create(handle: ProjectHandle, cloud_id: str, body: CloudMeasurementCreate) -> CloudMeasurement:
    cloud = rows.require_ready(handle, cloud_id)
    points = [p.model_dump() for p in body.points]
    expected = 1 if body.kind == "point" else 2
    if len(points) != expected:
        raise AppError(
            "wrong_point_count",
            f"a {LABELS[body.kind].lower()} needs {expected} point{'s' if expected > 1 else ''}",
            422,
        )
    if body.kind != "point" and cloud.crs_wkt and CRS.from_wkt(cloud.crs_wkt).is_geographic:
        raise AppError(
            "needs_projected_crs",
            "distances need a projected coordinate system; this cloud is in degrees",
            422,
        )
    points = measure.ordered(body.kind, points)
    if body.kind == "vertical" and abs(points[1]["z"] - points[0]["z"]) < measure.MIN_VERTICAL_SPAN_M:
        raise AppError(
            "vertical_span_too_small", "pick points further apart vertically (at least 0.5 m)", 422
        )
    results = measure.results(body.kind, points)
    if body.kind == "point" and cloud.crs_wkt:
        results["lon"], results["lat"] = lonlat(cloud.crs_wkt, points[0]["x"], points[0]["y"])
    with handle.session() as s:
        count = s.execute(
            select(func.count())
            .select_from(CloudMeasurement)
            .where(CloudMeasurement.point_cloud_id == cloud_id)
        ).scalar_one()
        if count >= MAX_PER_CLOUD:
            raise AppError(
                "measurement_limit", "this cloud already has 1 000 measurements; delete some first", 422
            )
        row = CloudMeasurement(
            point_cloud_id=cloud_id,
            kind=body.kind,
            name=body.name or _next_name(s, cloud_id, body.kind),
            note=body.note,
            points=points,
            results=results,
        )
        s.add(row)
        s.flush()
        s.expunge(row)
    return row


def _get(s, cloud_id: str, measurement_id: str) -> CloudMeasurement:
    row = s.get(CloudMeasurement, measurement_id)
    if row is None or row.point_cloud_id != cloud_id:
        raise not_found("measurement", measurement_id)
    return row


def update(
    handle: ProjectHandle, cloud_id: str, measurement_id: str, body: CloudMeasurementUpdate
) -> CloudMeasurement:
    rows.get_cloud(handle, cloud_id)
    with handle.session() as s:
        row = _get(s, cloud_id, measurement_id)
        if "name" in body.model_fields_set and body.name is not None:
            row.name = body.name
        if "note" in body.model_fields_set:
            row.note = body.note
        row.updated_at = datetime.now(UTC)
        s.flush()
        s.expunge(row)
    return row


def delete(handle: ProjectHandle, cloud_id: str, measurement_id: str) -> None:
    rows.get_cloud(handle, cloud_id)
    with handle.session() as s:
        s.delete(_get(s, cloud_id, measurement_id))
```

- [ ] **Step 7: Write the routes and un-stub them**

`backend/app/pointclouds/routes_measurements.py`:

```python
"""Measurement routes (spec §4.1 ops 8-11). Each change publishes pointclouds.changed."""

from __future__ import annotations

from fastapi import APIRouter, Depends, Request, Response

from app.events_util import publish_pointclouds_changed
from app.pointclouds import measurements
from app.pointclouds.schemas import (
    CloudMeasurementCreate,
    CloudMeasurementList,
    CloudMeasurementOut,
    CloudMeasurementUpdate,
)
from app.projects.service import ProjectHandle, get_project

sub = APIRouter()


@sub.get("/pointclouds/{cloudId}/measurements", response_model=CloudMeasurementList)
def list_cloud_measurements(
    cloudId: str, handle: ProjectHandle = Depends(get_project)
) -> CloudMeasurementList:  # noqa: N803
    return CloudMeasurementList(
        items=[CloudMeasurementOut.from_row(m) for m in measurements.list_for(handle, cloudId)]
    )


@sub.post("/pointclouds/{cloudId}/measurements", response_model=CloudMeasurementOut, status_code=201)
def create_cloud_measurement(
    cloudId: str,  # noqa: N803
    body: CloudMeasurementCreate,
    request: Request,
    handle: ProjectHandle = Depends(get_project),
) -> CloudMeasurementOut:
    row = measurements.create(handle, cloudId, body)
    publish_pointclouds_changed(request, handle, [cloudId])
    return CloudMeasurementOut.from_row(row)


@sub.patch("/pointclouds/{cloudId}/measurements/{cloudMeasurementId}", response_model=CloudMeasurementOut)
def update_cloud_measurement(
    cloudId: str,  # noqa: N803
    cloudMeasurementId: str,  # noqa: N803
    body: CloudMeasurementUpdate,
    request: Request,
    handle: ProjectHandle = Depends(get_project),
) -> CloudMeasurementOut:
    row = measurements.update(handle, cloudId, cloudMeasurementId, body)
    publish_pointclouds_changed(request, handle, [cloudId])
    return CloudMeasurementOut.from_row(row)


@sub.delete("/pointclouds/{cloudId}/measurements/{cloudMeasurementId}", status_code=204)
def delete_cloud_measurement(
    cloudId: str,  # noqa: N803
    cloudMeasurementId: str,  # noqa: N803
    request: Request,
    handle: ProjectHandle = Depends(get_project),
) -> Response:
    measurements.delete(handle, cloudId, cloudMeasurementId)
    publish_pointclouds_changed(request, handle, [cloudId])
    return Response(status_code=204)
```

In `router.py`: delete the four measurement tuples from `STUBS`; import `from app.pointclouds.routes_measurements import sub as measurement_routes` and append it to `SUB_ROUTERS`. In `tests/test_contract.py`: delete the four operationIds from `EXPECTED_STUBS`, and add `"createCloudMeasurement": {422},` to `REFUSES_VALID_DATA` (a point measurement with two points, or a vertical check 0.3 m tall, is schema-valid and refused on purpose).

- [ ] **Step 8: Run the tests to verify they pass**

Run: `cd backend; & $PY -m pytest tests/test_pointcloud_measure.py tests/test_pointcloud_measurements_api.py tests/test_contract.py -v`
Expected: PASS.

- [ ] **Step 9: Gate and commit** (rebase after Task 10)

```powershell
git add contract/fixtures/cloud-measure-vectors.json backend/app/pointclouds/measure.py backend/app/pointclouds/measurements.py backend/app/pointclouds/routes_measurements.py backend/app/pointclouds/router.py backend/tests/test_contract.py backend/tests/test_pointcloud_measure.py backend/tests/test_pointcloud_measurements_api.py
git commit -m "feat(pointclouds): measurements - shared-vector formulas, server-computed results, CRUD with refusals and cap

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 12: LAZ export (unit E1)

**Files:**
- Create: `backend/app/pointclouds/export.py`
- Modify: `backend/app/pointclouds/jobs_export.py` (replace F0's stub body)
- Create: `backend/app/pointclouds/routes_export.py`
- Modify: `backend/app/pointclouds/router.py` (remove the `createPointCloudExport` stub; add `export_routes`)
- Modify: `backend/tests/test_contract.py` (remove `"createPointCloudExport"`)
- Test: `backend/tests/test_pointcloud_export.py`

**Interfaces:**
- Consumes: Task 1 `rows.require_ready`, `schemas.PointCloudExportRequest`, `insert_cloud`; Task 3 `lasbounds.widen`, `lasbounds.write_header_bounds`; `app.exports.job._now_local`, `_reserve_partial_folder`, `_promote`; `app.training.schemas.JobRef`; `app.jobs.schemas.JobOut`.
- Produces:
  - `export.CHUNK = 2_000_000`; `export.slug(name) -> str`; `export.write_laz(source, dst, *, bounds, scale, assign_epsg, progress: Callable[[int, int], None], check_cancelled) -> int`; `export.verify_laz(path, *, point_count, epsg) -> None`; `export.write_measurements_csv(path, measurements) -> None`; `export.CSV_COLUMNS`; `export.write_cloud_json(path, cloud, app_version) -> None`; `export.check_source(cloud) -> Path` (raises the two refusals).
  - Job `pointcloud_export` params `{cloud_id, name, format, include_measurements}`; result `{cloud_id, folder, laz, files, point_count}` (`folder` relative to the project, POSIX).
  - `routes_export.sub`: `POST /pointclouds/{cloudId}/exports` → 202 `JobRef`.

- [ ] **Step 1: Write the failing tests**

`backend/tests/test_pointcloud_export.py`:

```python
"""LAZ export (spec §11): streamed from the source, bounds repaired, CRS, sidecars, refusals, cancel."""

import csv
import json
import os
import time

import laspy
import numpy as np
import pytest
from pointclouds import insert_cloud, make_las

from app.db.models import CloudMeasurement
from app.jobs.cancellation import JobCancelled
from app.pointclouds import export
from app.pointclouds.jobs_export import run_pointcloud_export

BASE = "/api/v1/projects"


@pytest.fixture
def project_kind() -> str:
    return "detect"


def _cloud_from(handle, src, **overrides):
    with laspy.open(src) as r:
        las = r.read()
        scale = list(map(float, r.header.scales))
    xyz = np.column_stack([las.x, las.y, las.z])
    st = src.stat()
    return insert_cloud(
        handle,
        name="Chimney stack 3D",
        source_path=str(src),
        source_size=st.st_size,
        source_mtime=st.st_mtime,
        point_count=len(xyz),
        scale=scale,
        bounds_native=[*map(float, xyz.min(0)), *map(float, xyz.max(0))],
        **overrides,
    )


def _export(client, wait_job, project_id, cloud_id, **body):
    r = client.post(f"{BASE}/{project_id}/pointclouds/{cloud_id}/exports", json={"format": "laz", **body})
    assert r.status_code == 202, r.text
    return wait_job(project_id, r.json()["job"]["id"])


def test_exports_a_repaired_laz_with_sidecars(client, wait_job, project_id, handle, tmp_path):
    src = make_las(tmp_path / "chimney.las", 20_000, header_shrink_mm=0.3)
    cloud_id = _cloud_from(handle, src)
    with handle.session() as s:
        s.add(
            CloudMeasurement(
                point_cloud_id=cloud_id,
                kind="distance",
                name="Distance 1",
                note="gate",
                points=[
                    {"x": 1, "y": 2, "z": 3, "uncertainty_m": 0.01},
                    {"x": 4, "y": 6, "z": 3, "uncertainty_m": 0.02},
                ],
                results={"distance_3d": 5.0, "uncertainty_m": 0.0224},
            )
        )
    job = _export(client, wait_job, project_id, cloud_id)
    assert job["state"] == "succeeded", job
    res = job["result"]
    folder = handle.folder / res["folder"]
    laz = folder / res["laz"]
    assert res["laz"] == "cloud-chimney-stack-3d.laz" and res["point_count"] == 20_000
    with laspy.open(laz) as r:
        assert r.header.point_count == 20_000 and r.header.parse_crs().to_epsg() == 32639
        las = r.read()
        mins, maxs = r.header.mins, r.header.maxs
    xyz = np.column_stack([las.x, las.y, las.z])
    assert np.all(mins <= xyz.min(0)) and np.all(maxs >= xyz.max(0))
    assert laz.stat().st_size < src.stat().st_size
    meta = json.loads((folder / "cloud-chimney-stack-3d.json").read_text("utf-8"))
    assert meta["point_count"] == 20_000 and meta["epsg"] == 32639 and meta["source"]["path"] == str(src)
    with (folder / "cloud-chimney-stack-3d-measurements.csv").open(newline="", encoding="utf-8") as f:
        rows_ = list(csv.DictReader(f))
    assert list(rows_[0])[:12] == [
        "id",
        "name",
        "kind",
        "note",
        "x1",
        "y1",
        "z1",
        "u1",
        "x2",
        "y2",
        "z2",
        "u2",
    ]
    assert rows_[0]["distance_3d"] == "5.0" and rows_[0]["note"] == "gate"
    assert not list((handle.folder / "exports").glob(".partial-*"))


def test_no_measurements_file_when_not_asked(client, wait_job, project_id, handle, tmp_path):
    cloud_id = _cloud_from(handle, make_las(tmp_path / "a.las", 1_000))
    job = _export(client, wait_job, project_id, cloud_id, include_measurements=False)
    assert all(not f.endswith("measurements.csv") for f in job["result"]["files"])


def test_assigned_crs_is_written(client, wait_job, project_id, handle, tmp_path):
    src = make_las(tmp_path / "bare.las", 1_000, epsg=None)
    cloud_id = _cloud_from(handle, src, crs_source="assigned", epsg=32639)
    job = _export(client, wait_job, project_id, cloud_id)
    with laspy.open(handle.folder / job["result"]["folder"] / job["result"]["laz"]) as r:
        assert r.header.parse_crs().to_epsg() == 32639


def test_a_missing_source_is_refused(client, wait_job, project_id, handle, tmp_path):
    src = make_las(tmp_path / "gone.las", 1_000)
    cloud_id = _cloud_from(handle, src)
    src.unlink()
    job = _export(client, wait_job, project_id, cloud_id)
    assert job["state"] == "failed" and job["error"] == f"the source file is not reachable: {src}"


def test_a_changed_source_is_refused(client, wait_job, project_id, handle, tmp_path):
    src = make_las(tmp_path / "edited.las", 1_000)
    cloud_id = _cloud_from(handle, src)
    later = time.time() + 60
    os.utime(src, (later, later))
    job = _export(client, wait_job, project_id, cloud_id)
    assert job["error"] == "the source file changed since import; import it again"


def test_not_ready_is_409(client, project_id, handle):
    cloud_id = insert_cloud(handle, status="importing")
    r = client.post(f"{BASE}/{project_id}/pointclouds/{cloud_id}/exports", json={"format": "laz"})
    assert r.status_code == 409 and r.json()["error"]["code"] == "not_ready"


class _Ctx:
    def __init__(self, handle, params, cancel_after):
        self.project, self.params, self.job_id = handle, params, "job-test"
        self.calls, self.cancel_after = 0, cancel_after

    def progress(self, *_a):
        pass

    def publish(self, *_a):
        pass

    def check_cancelled(self):
        self.calls += 1
        if self.calls > self.cancel_after:
            raise JobCancelled()


def test_cancel_removes_the_partial_folder(handle, tmp_path, monkeypatch):
    monkeypatch.setattr(export, "CHUNK", 1_000)
    cloud_id = _cloud_from(handle, make_las(tmp_path / "big.las", 10_000))
    ctx = _Ctx(handle, {"cloud_id": cloud_id, "format": "laz", "include_measurements": True}, cancel_after=3)
    with pytest.raises(JobCancelled):
        run_pointcloud_export(ctx)
    exports = handle.folder / "exports"
    assert not list(exports.glob(".partial-*")) and not [p for p in exports.iterdir() if p.is_dir()]


def test_slug():
    assert export.slug("Chimney stack 3D") == "chimney-stack-3d"
    assert export.slug("   ") == "cloud"
```

- [ ] **Step 2: Run them to verify they fail**

Run: `cd backend; & $PY -m pytest tests/test_pointcloud_export.py -v`
Expected: FAIL — `ImportError: cannot import name 'export'`.

- [ ] **Step 3: Write `export.py`**

`backend/app/pointclouds/export.py`:

```python
"""The LAZ export writer (spec §11): built from the source file, never from the octree.

Streamed through laspy + lazrs in 2 M-point chunks. The header bounds are the scanned true bounds
widened one scale step, so the export never carries the Pix4D bbox defect.
"""

from __future__ import annotations

import copy
import csv
import json
import re
from collections.abc import Callable, Iterable
from pathlib import Path

import laspy
from pyproj import CRS

from app.jobs.cancellation import JobFailure
from app.pointclouds.lasbounds import widen, write_header_bounds
from app.pointclouds.measure import FIELDS

CHUNK = 2_000_000
CSV_COLUMNS = ["id", "name", "kind", "note", "x1", "y1", "z1", "u1", "x2", "y2", "z2", "u2", *FIELDS]


def slug(name: str) -> str:
    return re.sub(r"[^A-Za-z0-9]+", "-", name).strip("-").lower() or "cloud"


def check_source(cloud) -> Path:
    src = Path(cloud.source_path)
    try:
        st = src.stat()
    except OSError:
        raise JobFailure(f"the source file is not reachable: {src}") from None
    if st.st_size != cloud.source_size or abs(st.st_mtime - float(cloud.source_mtime or 0)) > 1e-3:
        raise JobFailure("the source file changed since import; import it again")
    return src


def write_laz(
    source: Path,
    dst: Path,
    *,
    bounds: list[float],
    scale: list[float],
    assign_epsg: int | None,
    progress: Callable[[int, int], None],
    check_cancelled: Callable[[], None],
) -> int:
    written = 0
    with laspy.open(source) as r:
        header = copy.deepcopy(r.header)
        if assign_epsg is not None:
            header.add_crs(CRS.from_epsg(assign_epsg))
        total = int(r.header.point_count)
        with laspy.open(
            dst, mode="w", header=header, do_compress=True, laz_backend=laspy.LazBackend.LazrsParallel
        ) as w:
            for pts in r.chunk_iterator(CHUNK):
                check_cancelled()
                w.write_points(pts)
                written += len(pts)
                progress(written, total)
    write_header_bounds(dst, widen(bounds, scale))
    return written


def verify_laz(path: Path, *, point_count: int, epsg: int | None) -> None:
    with laspy.open(path) as r:
        count = int(r.header.point_count)
        crs = r.header.parse_crs()
    problems = []
    if count != point_count:
        problems.append(f"{count} points, expected {point_count}")
    got = crs.to_epsg() if crs is not None else None
    if epsg is not None and got != epsg:
        problems.append(f"EPSG {got}, expected {epsg}")
    if problems:
        raise JobFailure("the exported LAZ failed its checks: " + "; ".join(problems))


def write_measurements_csv(path: Path, measurements: Iterable) -> None:
    with path.open("w", newline="", encoding="utf-8") as f:
        w = csv.writer(f)
        w.writerow(CSV_COLUMNS)
        for m in measurements:
            pts = list(m.points) + [{}] * (2 - len(m.points))
            coords = [pts[i].get(k, "") for i in range(2) for k in ("x", "y", "z", "uncertainty_m")]
            results = m.results or {}
            w.writerow(
                [
                    m.id,
                    m.name,
                    m.kind,
                    m.note or "",
                    *coords,
                    *[("" if results.get(k) is None else results[k]) for k in FIELDS],
                ]
            )


def write_cloud_json(path: Path, cloud, app_version: str) -> None:
    body = {
        "name": cloud.name,
        "crs_wkt": cloud.crs_wkt,
        "epsg": cloud.epsg,
        "vertical_crs": cloud.vertical_crs,
        "point_count": cloud.point_count,
        "bounds_native": cloud.bounds_native,
        "bounds_wgs84": cloud.bounds_wgs84,
        "source": {"path": cloud.source_path, "sha256": cloud.source_sha256},
        "app_version": app_version,
    }
    path.write_text(json.dumps(body, indent=2), "utf-8")
```

- [ ] **Step 4: Write the job body**

`backend/app/pointclouds/jobs_export.py` (whole module):

```python
"""The `pointcloud_export` job (spec §11): a LAZ plus cloud.json and measurements.csv, written into
exports/.partial-<stamp> and promoted; a cancel or a failure deletes the partial folder."""

from __future__ import annotations

import shutil
from importlib.metadata import PackageNotFoundError, version

from sqlalchemy import select

from app.db.models import CloudMeasurement
from app.exports.job import _now_local, _promote, _reserve_partial_folder
from app.jobs.registry import register_job_type
from app.jobs.runner import JobContext
from app.pointclouds import export, rows


def _app_version() -> str:
    try:
        return version("kestrel-backend")
    except PackageNotFoundError:
        return "0.1.0"


@register_job_type("pointcloud_export")
def run_pointcloud_export(ctx: JobContext) -> dict:
    p = ctx.params
    cloud = rows.require_ready(ctx.project, p["cloud_id"])
    src = export.check_source(cloud)
    base = ctx.project.exports_dir
    base.mkdir(parents=True, exist_ok=True)
    partial, stamp, n = _reserve_partial_folder(base, _now_local())
    stem = f"cloud-{export.slug(cloud.name)}"
    try:
        laz = partial / f"{stem}.laz"
        count = export.write_laz(
            src,
            laz,
            bounds=cloud.bounds_native,
            scale=cloud.scale,
            assign_epsg=cloud.epsg if cloud.crs_source == "assigned" else None,
            progress=lambda d, t: ctx.progress(
                0.95 * d / max(t, 1), f"writing {d / 1e6:.1f} / {t / 1e6:.1f} M points"
            ),
            check_cancelled=ctx.check_cancelled,
        )
        ctx.progress(0.96, "checking the LAZ")
        export.verify_laz(laz, point_count=cloud.point_count, epsg=cloud.epsg)
        files = [laz.name]
        export.write_cloud_json(partial / f"{stem}.json", cloud, _app_version())
        files.append(f"{stem}.json")
        if p.get("include_measurements", True):
            with ctx.project.session() as s:
                ms = list(
                    s.execute(
                        select(CloudMeasurement)
                        .where(CloudMeasurement.point_cloud_id == cloud.id)
                        .order_by(CloudMeasurement.created_at)
                    ).scalars()
                )
                for m in ms:
                    s.expunge(m)
            if ms:
                export.write_measurements_csv(partial / f"{stem}-measurements.csv", ms)
                files.append(f"{stem}-measurements.csv")
        ctx.check_cancelled()
        final = _promote(base, partial, stamp, n)
    except BaseException:
        shutil.rmtree(partial, ignore_errors=True)
        raise
    folder = "/".join(final.relative_to(ctx.project.folder).parts)
    ctx.progress(1.0, f"{count / 1e6:.1f} M points exported")
    return {"cloud_id": cloud.id, "folder": folder, "laz": laz.name, "files": files, "point_count": count}
```

- [ ] **Step 5: Write the route and un-stub it**

`backend/app/pointclouds/routes_export.py`:

```python
"""POST /pointclouds/{cloudId}/exports (spec §4.1 op 12): 202 with the job."""

from __future__ import annotations

from fastapi import APIRouter, Depends, Request

from app.jobs.schemas import JobOut
from app.pointclouds import rows
from app.pointclouds.jobs_export import run_pointcloud_export  # noqa: F401 - registers pointcloud_export
from app.pointclouds.schemas import PointCloudExportRequest
from app.projects.service import ProjectHandle, get_project
from app.training.schemas import JobRef

sub = APIRouter()


@sub.post("/pointclouds/{cloudId}/exports", response_model=JobRef, status_code=202)
def create_point_cloud_export(
    cloudId: str,  # noqa: N803
    body: PointCloudExportRequest,
    request: Request,
    handle: ProjectHandle = Depends(get_project),
) -> JobRef:
    cloud = rows.require_ready(handle, cloudId)
    job = request.app.state.jobs.submit(
        handle,
        "pointcloud_export",
        {
            "cloud_id": cloud.id,
            "name": cloud.name,
            "format": body.format,
            "include_measurements": body.include_measurements,
        },
    )
    return JobRef(job=JobOut.from_row(job, handle.id))
```

In `router.py`: delete the export stub tuple; import `sub as export_routes` and append it to `SUB_ROUTERS`. In `tests/test_contract.py`: delete `"createPointCloudExport"`.

- [ ] **Step 6: Run the tests to verify they pass**

Run: `cd backend; & $PY -m pytest tests/test_pointcloud_export.py tests/test_contract.py -v`
Expected: PASS.

- [ ] **Step 7: Gate and commit** (rebase after Tasks 10 and 11)

```powershell
git add backend/app/pointclouds/export.py backend/app/pointclouds/jobs_export.py backend/app/pointclouds/routes_export.py backend/app/pointclouds/router.py backend/tests/test_contract.py backend/tests/test_pointcloud_export.py
git commit -m "feat(pointclouds): LAZ export job - streamed from the source, repaired bounds, CRS, cloud.json and measurements.csv

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 13: The Clouds screen — list, import dialog, Details and View tabs (unit U1)

Load `impeccable` and `emil-design-eng` with `DESIGN.md` first. The layout copies `MapsScreen` (left `w-52 xl:w-64`, centre, right `aside w-72 xl:w-80`).

**Files:**
- Modify: `frontend/src/api/clouds.ts` (add the list/create/inspect/patch/delete/export calls)
- Create: `frontend/src/clouds/format.ts`, `frontend/src/clouds/link.ts` (+ `.test.ts` each)
- Create: `frontend/src/clouds/CloudList.tsx`, `ImportCloudDialog.tsx`, `CloudDetails.tsx`, `ViewPanel.tsx`
- Modify: `frontend/src/screens/CloudsScreen.tsx` (the full work surface; Task 6's minimal host goes away)
- Modify: `frontend/src/ui/Segmented.tsx` (an option can be `disabled`), `frontend/src/ui/Controls.test.tsx`
- Modify: `frontend/src/ui/useJobToasts.ts` + its test (`pointcloud_export` is reported inline on the Clouds screen)
- Modify: F0's `frontend/e2e/pointcloud-foundation.spec.ts` (the Prism mock's cloud list is not empty, so the empty-state line no longer shows)
- Test: `frontend/src/screens/CloudsScreen.test.tsx`, `frontend/src/clouds/ImportCloudDialog.test.tsx`, `frontend/e2e/clouds.spec.ts` (append)

**Interfaces:**
- Consumes: Task 6 `CloudViewer`, `CloudViewerHandle`, `readBudget`, `writeBudget`, `BUDGETS`, `defaultColour`, `defaultElevationRange`, `POINT_SIZE_MIN/MAX`, `fetchPointCloud`, `exampleCloud`, `CLOUD_ID`; `@/api/maps.listMaps`; `@/api/exports.revealInExplorer`; `useTrackedJob`, `useOnJobsFinished`, `useJobsStore`.
- Produces:
  - `api/clouds.ts`: `listPointClouds(api, projectId): Promise<PointCloud[]>`, `createPointCloud(api, projectId, body): Promise<PointCloudWithJob>`, `inspectPointCloudFile(api, projectId, path): Promise<PointCloudFileInfo>`, `patchPointCloud(api, projectId, cloudId, body): Promise<PointCloud>`, `deletePointCloud(api, projectId, cloudId): Promise<void>`, `createPointCloudExport(api, projectId, cloudId, includeMeasurements): Promise<Job>`; types `PointCloudWithJob`, `PointCloudFileInfo`, `PointCloudPatch`.
  - `clouds/format.ts`: `formatPoints(n)`, `formatBytes(n)`, `crsLabel(cloud)`, `crsName(wkt)`, `heightsLabel(cloud)`.
  - `clouds/link.ts`: `interface RankedMap { map: GeoMap; overlap: number; likelySameFlight: boolean }`; `rankMaps(cloud, maps): RankedMap[]`; `SAME_FLIGHT_OVERLAP = 0.5`.
  - `CloudsScreen` renders the right aside as `<aside data-testid="cloud-panel">` with a `Segmented` labelled "Cloud panel" whose options come from a `TABS` array (Task 16 appends `{ value: "measure", label: "Measure" }`); it holds a `viewer = useRef<CloudViewerHandle>(null)` and the `cloud` it shows, so Tasks 16 and 17 can add props without restructuring.
  - `ui/Segmented`: `SegmentedOption.disabled?: boolean`.

- [ ] **Step 1: Write the failing unit tests**

`frontend/src/clouds/format.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { exampleCloud } from "@/test/cloudFixtures";
import { crsLabel, crsName, formatBytes, formatPoints, heightsLabel } from "./format";

describe("cloud formatting", () => {
  it("formats point counts and sizes the way the list shows them", () => {
    expect(formatPoints(21_697_184)).toBe("21.7 M points");
    expect(formatPoints(195_274_656)).toBe("195.3 M points");
    expect(formatPoints(50_000)).toBe("50 000 points");
    expect(formatBytes(737_902_645)).toBe("738 MB");
    expect(formatBytes(6_200_000_000)).toBe("6.2 GB");
    expect(formatBytes(900_000)).toBe("0.9 MB");
  });

  it("labels the CRS and the heights", () => {
    expect(crsLabel(exampleCloud)).toBe("EPSG:32639");
    expect(crsLabel({ ...exampleCloud, epsg: null, crs_wkt: null })).toBe("no coordinates");
    expect(crsLabel({ ...exampleCloud, epsg: null })).toBe("custom CRS");
    expect(heightsLabel(exampleCloud)).toBe("as stored, no vertical datum");
    expect(crsName('PROJCRS["WGS 84 / UTM zone 39N",BASEGEOGCRS["WGS 84"]]')).toBe("WGS 84 / UTM zone 39N");
    expect(crsName(null)).toBeNull();
    expect(heightsLabel({ ...exampleCloud, vertical_crs: "EGM96 height" })).toBe("EGM96 height");
  });
});
```

`frontend/src/clouds/link.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import type { GeoMap } from "@contract/client";
import { exampleGeoMap } from "@/test/fixtures";
import { exampleCloud } from "@/test/cloudFixtures";
import { rankMaps } from "./link";

const cloud = { ...exampleCloud, bounds_wgs84: [48.0, 28.0, 48.1, 28.1], captured_on: "2026-05-04" };
const map = (id: string, b: number[] | null, extra: Partial<GeoMap> = {}): GeoMap => ({
  ...exampleGeoMap,
  id,
  name: id,
  bounds_wgs84: b,
  captured_on: "2026-05-04",
  ...extra,
});

describe("map link ranking", () => {
  it("ranks by overlap and flags the likely same flight", () => {
    const ranked = rankMaps(cloud, [
      map("quarter", [48.05, 28.05, 48.2, 28.2]),
      map("full", [47.9, 27.9, 48.2, 28.2]),
      map("other-day", [47.9, 27.9, 48.2, 28.2], { captured_on: "2026-06-01" }),
    ]);
    expect(ranked.map((r) => r.map.id)).toEqual(["full", "other-day", "quarter"]);
    expect(ranked[0].overlap).toBeCloseTo(1, 6);
    expect(ranked[0].likelySameFlight).toBe(true);
    expect(ranked[1].likelySameFlight).toBe(false);
    expect(ranked[2].overlap).toBeCloseTo(0.25, 6);
    expect(ranked[2].likelySameFlight).toBe(false);
  });

  it("leaves out maps that cannot be linked", () => {
    expect(
      rankMaps(cloud, [
        map("apart", [10, 10, 11, 11]),
        map("no-crs", [48, 28, 48.1, 28.1], { crs_wkt: null }),
        map("importing", [48, 28, 48.1, 28.1], { status: "importing" }),
        map("no-bounds", null),
      ]),
    ).toEqual([]);
    expect(rankMaps({ ...cloud, bounds_wgs84: null }, [map("full", [47.9, 27.9, 48.2, 28.2])])).toEqual([]);
  });
});
```

`frontend/src/clouds/ImportCloudDialog.test.tsx`:

```tsx
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { fakeClient, PROJECT_ID, runningJob } from "@/test/fixtures";
import { exampleCloud } from "@/test/cloudFixtures";
import { renderWithProviders } from "@/test/render";
import { ImportCloudDialog } from "./ImportCloudDialog";

const info = (ok: boolean) => ({
  path: "D:\\clouds\\site.las",
  size: 737_902_645,
  compressed: false,
  las_version: "1.2",
  point_format: 3,
  point_count: 21_697_184,
  has_rgb: true,
  header_bounds: [0, 0, 0, 1, 1, 1],
  crs_wkt: "x",
  epsg: 32639,
  captured_on: "2026-05-04",
  admission: {
    ok,
    ram_needed_bytes: 2_050_000_000,
    ram_available_bytes: ok ? 30e9 : 1e9,
    disk_needed_bytes: 1,
    disk_available_bytes: 2,
    reason: ok
      ? null
      : "This cloud needs about 2.1 GB of free memory; 1.0 GB is free. Close other programs and try again.",
  },
});

describe("import dialog", () => {
  it("shows the refusal verbatim and disables Import", async () => {
    const { api } = fakeClient([
      { method: "GET", path: /\/maps$/, body: { items: [] } },
      { method: "POST", path: /\/pointclouds\/inspect$/, body: info(false) },
    ]);
    renderWithProviders(<ImportCloudDialog projectId={PROJECT_ID} onClose={vi.fn()} onStarted={vi.fn()} />, {
      api,
    });
    await userEvent.type(screen.getByLabelText("LAS or LAZ file"), "D:\\clouds\\site.las");
    expect(await screen.findByText(/needs about 2.1 GB of free memory; 1.0 GB is free/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Import" })).toBeDisabled();
  });

  it("imports an admissible file with its name", async () => {
    const onStarted = vi.fn();
    const { api, requests } = fakeClient([
      { method: "GET", path: /\/maps$/, body: { items: [] } },
      { method: "POST", path: /\/pointclouds\/inspect$/, body: info(true) },
      {
        method: "POST",
        path: /\/pointclouds$/,
        status: 202,
        body: { cloud: { ...exampleCloud, status: "importing" }, job: runningJob },
      },
    ]);
    renderWithProviders(
      <ImportCloudDialog projectId={PROJECT_ID} onClose={vi.fn()} onStarted={onStarted} />,
      { api },
    );
    await userEvent.type(screen.getByLabelText("LAS or LAZ file"), "D:\\clouds\\site.las");
    expect(await screen.findByText("21.7 M points")).toBeInTheDocument();
    await userEvent.type(screen.getByLabelText("Name"), "Chimney");
    await userEvent.click(screen.getByRole("button", { name: "Import" }));
    await waitFor(() => expect(onStarted).toHaveBeenCalled());
    const post = requests.find((r) => r.method === "POST" && /\/pointclouds$/.test(r.url));
    expect(post?.body).toEqual({ path: "D:\\clouds\\site.las", name: "Chimney" });
  });
});
```

`frontend/src/screens/CloudsScreen.test.tsx`:

```tsx
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { fakeClient, PROJECT_ID } from "@/test/fixtures";
import { CLOUD_ID, exampleCloud } from "@/test/cloudFixtures";
import { renderWithProviders } from "@/test/render";
import { CloudsScreen } from "./CloudsScreen";

// The viewer needs WebGL; the screen's own behaviour is tested around a stand-in.
vi.mock("@/clouds/CloudViewer", () => ({ CloudViewer: () => <div data-testid="cloud-viewer" /> }));

const routes = (items: unknown[]) => [
  { method: "GET", path: /\/pointclouds$/, body: { items } },
  { method: "GET", path: new RegExp(`/pointclouds/${CLOUD_ID}$`), body: items[0] },
  { method: "GET", path: /\/maps$/, body: { items: [] } },
];

describe("Clouds screen", () => {
  it("invites an import when there are no clouds", async () => {
    const { api } = fakeClient(routes([]));
    renderWithProviders(<CloudsScreen />, {
      api,
      route: `/p/${PROJECT_ID}/clouds`,
      path: "/p/:projectId/clouds",
    });
    expect(await screen.findByText("Import a LAS or LAZ point cloud")).toBeInTheDocument();
  });

  it("lists clouds with their facts and a failed one with its reason", async () => {
    const failed = {
      ...exampleCloud,
      id: "c2",
      name: "Broken",
      status: "failed",
      error: "the file has no points",
      point_count: null,
    };
    const { api } = fakeClient(routes([exampleCloud, failed]));
    renderWithProviders(<CloudsScreen />, {
      api,
      route: `/p/${PROJECT_ID}/clouds`,
      path: "/p/:projectId/clouds",
    });
    const list = await screen.findByRole("list", { name: "Point clouds" });
    expect(list).toHaveTextContent("21.7 M points");
    expect(list).toHaveTextContent("EPSG:32639");
    expect(list).toHaveTextContent("738 MB");
    expect(screen.getByText("the file has no points")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Import again" })).toBeInTheDocument();
  });

  it("shows Details, and View with RGB disabled for a cloud without colour", async () => {
    const grey = { ...exampleCloud, has_rgb: false };
    const { api } = fakeClient(routes([grey]));
    renderWithProviders(<CloudsScreen />, {
      api,
      route: `/p/${PROJECT_ID}/clouds/${CLOUD_ID}`,
      path: "/p/:projectId/clouds/:cloudId",
    });
    const panel = await screen.findByTestId("cloud-panel");
    expect(panel).toHaveTextContent(/Header bounds repaired/);
    expect(panel).toHaveTextContent("as stored, no vertical datum");
    await userEvent.click(screen.getByRole("radio", { name: "View" }));
    expect(screen.getByRole("radio", { name: "RGB" })).toBeDisabled();
    expect(screen.getByRole("radio", { name: "Elevation" })).toHaveAttribute("aria-checked", "true");
    expect(screen.getByLabelText("Lowest")).toHaveValue(-44);
    expect(screen.getByLabelText("Highest")).toHaveValue(170);
  });

  it("offers Assign CRS only when the cloud has no coordinates", async () => {
    const bare = { ...exampleCloud, crs_wkt: null, epsg: null, proj4: null, bounds_wgs84: null };
    const { api } = fakeClient(routes([bare]));
    renderWithProviders(<CloudsScreen />, {
      api,
      route: `/p/${PROJECT_ID}/clouds/${CLOUD_ID}`,
      path: "/p/:projectId/clouds/:cloudId",
    });
    expect(await screen.findByLabelText("EPSG code")).toBeInTheDocument();
  });
});
```

Add to `frontend/src/ui/Controls.test.tsx`:

```tsx
it("Segmented: a disabled option cannot be chosen", async () => {
  const onChange = vi.fn();
  render(
    <Segmented
      label="Colour"
      value="elevation"
      onChange={onChange}
      options={[
        { value: "rgb", label: "RGB", disabled: true },
        { value: "elevation", label: "Elevation" },
      ]}
    />,
  );
  const rgb = screen.getByRole("radio", { name: "RGB" });
  expect(rgb).toBeDisabled();
  await userEvent.click(rgb);
  expect(onChange).not.toHaveBeenCalled();
});
```

(use the imports already at the top of `Controls.test.tsx`; add `vi`, `userEvent` or `Segmented` there if missing.)

Add to `frontend/src/ui/useJobToasts.test.ts`:

```ts
it("the Clouds screen reports its own LAZ export", () => {
  const job = { ...runningJob, type: "pointcloud_export", project_id: "p1", state: "succeeded" } as Job;
  expect(reportedInline(job, "/p/p1/clouds")).toBe(true);
  expect(reportedInline(job, "/p/p1/clouds/c-123")).toBe(true);
  expect(reportedInline(job, "/p/p1/maps/m-1")).toBe(false);
  expect(reportedInline({ ...job, type: "import" } as Job, "/p/p1/data/x")).toBe(false);
});
```

(import `runningJob` from `@/test/fixtures` and `Job` from `@contract/client` if the file does not already.)

- [ ] **Step 2: Run them to verify they fail**

Run: `pnpm -C frontend test -- src/clouds src/screens/CloudsScreen src/ui`
Expected: FAIL — missing modules and the new assertions.

- [ ] **Step 3: Extend the API module**

Append to `frontend/src/api/clouds.ts`:

```ts
import type { Job } from "@contract/client";

export type PointCloudWithJob = S["PointCloudWithJob"];
export type PointCloudFileInfo = S["PointCloudFileInfo"];
export type PointCloudPatch = S["PointCloudPatch"];

export async function listPointClouds(api: ApiClient, projectId: string): Promise<PointCloud[]> {
  return (await unwrap(api.GET(`${P}/pointclouds`, { params: { path: { projectId } } }))).items;
}

export function createPointCloud(
  api: ApiClient,
  projectId: string,
  body: S["PointCloudCreate"],
): Promise<PointCloudWithJob> {
  return unwrap(api.POST(`${P}/pointclouds`, { params: { path: { projectId } }, body }));
}

export function inspectPointCloudFile(
  api: ApiClient,
  projectId: string,
  path: string,
): Promise<PointCloudFileInfo> {
  return unwrap(api.POST(`${P}/pointclouds/inspect`, { params: { path: { projectId } }, body: { path } }));
}

export function patchPointCloud(
  api: ApiClient,
  projectId: string,
  cloudId: string,
  body: PointCloudPatch,
): Promise<PointCloud> {
  return unwrap(api.PATCH(`${P}/pointclouds/{cloudId}`, { params: { path: { projectId, cloudId } }, body }));
}

export async function deletePointCloud(api: ApiClient, projectId: string, cloudId: string): Promise<void> {
  await unwrap(api.DELETE(`${P}/pointclouds/{cloudId}`, { params: { path: { projectId, cloudId } } }));
}

export async function createPointCloudExport(
  api: ApiClient,
  projectId: string,
  cloudId: string,
  includeMeasurements: boolean,
): Promise<Job> {
  const body = { format: "laz" as const, include_measurements: includeMeasurements };
  return (
    await unwrap(
      api.POST(`${P}/pointclouds/{cloudId}/exports`, { params: { path: { projectId, cloudId } }, body }),
    )
  ).job;
}
```

(Move the new `import type { Job }` up into the existing import line from `@contract/client`.)

- [ ] **Step 4: Write `format.ts` and `link.ts`**

`frontend/src/clouds/format.ts`:

```ts
import type { PointCloud } from "@/api/clouds";

const grouped = (n: number) => new Intl.NumberFormat("en-GB").format(n).replace(/,/g, " ");

export function formatPoints(n: number): string {
  return n >= 1_000_000 ? `${(n / 1e6).toFixed(1)} M points` : `${grouped(n)} points`;
}

export function formatBytes(n: number): string {
  if (n >= 1e9) return `${(n / 1e9).toFixed(1)} GB`;
  if (n >= 1e8) return `${Math.round(n / 1e6)} MB`;
  return `${(n / 1e6).toFixed(1)} MB`;
}

export function crsLabel(c: Pick<PointCloud, "epsg" | "crs_wkt">): string {
  if (c.epsg) return `EPSG:${c.epsg}`;
  return c.crs_wkt ? "custom CRS" : "no coordinates";
}

/** The CRS's own name, the first quoted string of its WKT ("WGS 84 / UTM zone 39N"). */
export function crsName(wkt: string | null): string | null {
  const m = wkt ? /^\s*[A-Z_]+\[\s*"([^"]+)"/.exec(wkt) : null;
  return m ? m[1] : null;
}

export function heightsLabel(c: Pick<PointCloud, "vertical_crs">): string {
  return c.vertical_crs ?? "as stored, no vertical datum";
}
```

`frontend/src/clouds/link.ts`:

```ts
import type { GeoMap } from "@contract/client";
import type { PointCloud } from "@/api/clouds";

export const SAME_FLIGHT_OVERLAP = 0.5;

export interface RankedMap {
  map: GeoMap;
  /** Share of the cloud's WGS84 box that the map covers, 0..1. */
  overlap: number;
  likelySameFlight: boolean;
}

function area(b: number[]): number {
  return Math.max(0, b[2] - b[0]) * Math.max(0, b[3] - b[1]);
}

function intersection(a: number[], b: number[]): number[] {
  return [Math.max(a[0], b[0]), Math.max(a[1], b[1]), Math.min(a[2], b[2]), Math.min(a[3], b[3])];
}

/** Ready maps with a CRS that overlap the cloud, best first (spec §2 "Map link"). */
export function rankMaps(
  cloud: Pick<PointCloud, "bounds_wgs84" | "captured_on">,
  maps: GeoMap[],
): RankedMap[] {
  const box = cloud.bounds_wgs84;
  if (!box || area(box) === 0) return [];
  return maps
    .filter((m) => m.status === "ready" && m.crs_wkt && m.bounds_wgs84)
    .map((m) => {
      const overlap = area(intersection(box, m.bounds_wgs84!)) / area(box);
      return {
        map: m,
        overlap,
        likelySameFlight:
          overlap >= SAME_FLIGHT_OVERLAP && !!cloud.captured_on && m.captured_on === cloud.captured_on,
      };
    })
    .filter((r) => r.overlap > 0)
    .sort((a, b) => b.overlap - a.overlap || Number(b.likelySameFlight) - Number(a.likelySameFlight));
}
```

- [ ] **Step 5: Let a Segmented option be disabled; report the export inline**

`frontend/src/ui/Segmented.tsx`: add `disabled?: boolean;` to `SegmentedOption`, and on the `<button>`: `disabled={o.disabled}`, `onClick={() => !o.disabled && onChange(o.value)}`, and add `"disabled:cursor-not-allowed disabled:opacity-40"` to its class list.

`frontend/src/ui/useJobToasts.ts`: add `pointcloud_export: "clouds",` to `REPORTED_ON`, and make `reportedInline` also match a deeper path under the segment:

```ts
export function reportedInline(job: Job, pathname: string): boolean {
  const segment = REPORTED_ON[job.type];
  if (!segment) return false;
  const path = pathname.replace(/\/$/, "");
  const base = `/p/${job.project_id}/${segment}`;
  return path.endsWith(base) || (job.type === "pointcloud_export" && path.startsWith(`${base}/`));
}
```

(The deeper match is limited to `pointcloud_export` so the existing screens behave exactly as before.)

- [ ] **Step 6: Write the list and the import dialog**

`frontend/src/clouds/CloudList.tsx`:

```tsx
import { Link } from "react-router-dom";
import type { GeoMap } from "@contract/client";
import type { PointCloud } from "@/api/clouds";
import { useTrackedJob } from "@/jobs/useTrackedJob";
import { Alert, Button, Pill, Progress, cx, focusRing, transition } from "@/ui";
import { crsLabel, formatBytes, formatPoints } from "./format";

const TONE = { ready: "ok", importing: "accent", failed: "danger" } as const;

function ImportProgress({ projectId, jobId }: { projectId: string; jobId: string }) {
  const { job } = useTrackedJob(projectId, jobId);
  return <Progress thin value={job?.progress ?? 0} running label={job?.message || "importing"} />;
}

export function CloudList({
  projectId,
  clouds,
  maps,
  activeId,
  onImportAgain,
  onDelete,
}: {
  projectId: string;
  clouds: PointCloud[];
  maps: GeoMap[];
  activeId?: string;
  onImportAgain(c: PointCloud): void;
  onDelete(c: PointCloud): void;
}) {
  const mapName = (id: string | null) => maps.find((m) => m.id === id)?.name;
  return (
    <ul className="flex flex-col gap-1" aria-label="Point clouds">
      {clouds.map((c) => (
        <li key={c.id} className="flex flex-col gap-1.5">
          <Link
            to={`/p/${projectId}/clouds/${c.id}`}
            aria-current={c.id === activeId ? "page" : undefined}
            className={cx(
              "flex flex-col gap-0.5 rounded-md p-2 text-xs",
              transition,
              focusRing,
              c.id === activeId ? "bg-accent-soft" : "hover:bg-hover",
            )}
          >
            <span className="flex items-center justify-between gap-2">
              <span className="min-w-0 truncate text-sm font-medium text-ink">{c.name}</span>
              <Pill size="sm" tone={TONE[c.status]}>
                {c.status}
              </Pill>
            </span>
            <span className="tabular-nums text-muted">
              {c.point_count != null ? formatPoints(c.point_count) : "—"} · {formatBytes(c.source_size)}
            </span>
            <span className="text-muted">
              {crsLabel(c)}
              {c.captured_on ? ` · ${c.captured_on}` : ""}
              {mapName(c.map_id) ? ` · ${mapName(c.map_id)}` : ""}
            </span>
          </Link>
          {c.status === "importing" && c.job_id && <ImportProgress projectId={projectId} jobId={c.job_id} />}
          {c.status === "failed" && (
            <Alert
              tone="danger"
              actions={
                <>
                  <Button size="sm" icon="refresh" onClick={() => onImportAgain(c)}>
                    Import again
                  </Button>
                  <Button size="sm" variant="ghost" icon="trash" onClick={() => onDelete(c)}>
                    Delete
                  </Button>
                </>
              }
            >
              {c.error}
            </Alert>
          )}
        </li>
      ))}
    </ul>
  );
}
```

`frontend/src/clouds/ImportCloudDialog.tsx`:

```tsx
import { useEffect, useState, type FormEvent } from "react";
import type { GeoMap } from "@contract/client";
import { useApi, useBackend } from "@/api/client";
import {
  createPointCloud,
  inspectPointCloudFile,
  type PointCloud,
  type PointCloudFileInfo,
} from "@/api/clouds";
import { messageOf } from "@/api/errors";
import { listMaps } from "@/api/maps";
import { useJobsStore } from "@/store/jobs";
import { Alert, Button, Dialog, Field, Input, Select } from "@/ui";
import { formatBytes, formatPoints } from "./format";

const INSPECT_DELAY_MS = 300;

export function ImportCloudDialog({
  projectId,
  initialPath = "",
  initialName = "",
  onClose,
  onStarted,
}: {
  projectId: string;
  initialPath?: string;
  initialName?: string;
  onClose(): void;
  onStarted(c: PointCloud): void;
}) {
  const api = useApi();
  const { mode } = useBackend();
  const [path, setPath] = useState(initialPath);
  const [name, setName] = useState(initialName);
  const [mapId, setMapId] = useState("");
  const [maps, setMaps] = useState<GeoMap[]>([]);
  // The last inspect answer and the path it was for: a stale answer for another path shows nothing.
  const [inspected, setInspected] = useState<{
    path: string;
    info: PointCloudFileInfo | null;
    error: string | null;
  } | null>(null);
  const current = inspected && inspected.path === path.trim() ? inspected : null;
  const info = current?.info ?? null;
  const inspectError = current?.error ?? null;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void listMaps(api, projectId)
      .then((ms) => setMaps(ms.filter((m) => m.status === "ready" && m.crs_wkt)))
      .catch(() => setMaps([]));
  }, [api, projectId]);

  useEffect(() => {
    const p = path.trim();
    if (!p) return;
    let live = true;
    const t = window.setTimeout(() => {
      inspectPointCloudFile(api, projectId, p)
        .then((i) => live && setInspected({ path: p, info: i, error: null }))
        .catch(
          (e: unknown) =>
            live && setInspected({ path: p, info: null, error: messageOf(e, "could not read the file") }),
        );
    }, INSPECT_DELAY_MS);
    return () => {
      live = false;
      window.clearTimeout(t);
    };
  }, [api, projectId, path]);

  async function browse() {
    const { open } = await import("@tauri-apps/plugin-dialog");
    const picked = await open({
      multiple: false,
      filters: [{ name: "LAS / LAZ point cloud", extensions: ["las", "laz"] }],
    });
    if (typeof picked === "string") setPath(picked);
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!info?.admission.ok) return;
    setBusy(true);
    setError(null);
    try {
      const r = await createPointCloud(api, projectId, {
        path: path.trim(),
        ...(name.trim() ? { name: name.trim() } : {}),
        ...(mapId ? { map_id: mapId } : {}),
      });
      useJobsStore.getState().upsert(r.job);
      onStarted(r.cloud);
    } catch (err) {
      setError(messageOf(err, "could not start the import"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog
      open
      title="Import point cloud"
      description="Pick a LAS or LAZ file. It is only read: the project keeps a 3D view copy next to it. Big clouds take a few minutes and import in the background, one at a time."
      onClose={() => !busy && onClose()}
      onSubmit={(e) => void submit(e)}
      footer={
        <>
          <Button onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button type="submit" variant="primary" icon="import" loading={busy} disabled={!info?.admission.ok}>
            Import
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <Field label="LAS or LAZ file" htmlFor="cloud-path" error={inspectError ?? error}>
          <div className="flex gap-2">
            <Input
              id="cloud-path"
              value={path}
              onChange={(e) => setPath(e.target.value)}
              placeholder="D:\clouds\site.las"
              className="min-w-0 flex-1 font-mono"
            />
            {mode === "tauri" && <Button onClick={() => void browse()}>Browse</Button>}
          </div>
        </Field>
        {info && (
          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
            <dt className="text-muted">Points</dt>
            <dd className="text-right tabular-nums">{formatPoints(info.point_count)}</dd>
            <dt className="text-muted">File</dt>
            <dd className="text-right tabular-nums">
              {formatBytes(info.size)} · LAS {info.las_version} · format {info.point_format}
              {info.compressed ? " · LAZ" : ""}
            </dd>
            <dt className="text-muted">Coordinates</dt>
            <dd className="text-right">
              {info.epsg ? `EPSG:${info.epsg}` : info.crs_wkt ? "custom CRS" : "none in the file"}
            </dd>
            <dt className="text-muted">Colour</dt>
            <dd className="text-right">{info.has_rgb ? "RGB" : "none (shown by elevation)"}</dd>
          </dl>
        )}
        {info && !info.admission.ok && <Alert tone="danger">{info.admission.reason}</Alert>}
        <Field label="Name" htmlFor="cloud-name" hint="Defaults to the file name.">
          <Input id="cloud-name" value={name} onChange={(e) => setName(e.target.value)} />
        </Field>
        {maps.length > 0 && (
          <Field
            label="Linked map"
            htmlFor="cloud-map"
            hint="The orthomosaic of the same flight, for jumping between 2D and 3D."
          >
            <Select id="cloud-map" value={mapId} onChange={(e) => setMapId(e.target.value)}>
              <option value="">No link</option>
              {maps.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name}
                </option>
              ))}
            </Select>
          </Field>
        )}
      </div>
    </Dialog>
  );
}
```

- [ ] **Step 7: Write the Details and View panels**

`frontend/src/clouds/CloudDetails.tsx`:

```tsx
import { useEffect, useMemo, useRef, useState } from "react";
import type { GeoMap } from "@contract/client";
import { useApi } from "@/api/client";
import { createPointCloudExport, deletePointCloud, patchPointCloud, type PointCloud } from "@/api/clouds";
import { messageOf } from "@/api/errors";
import { revealInExplorer } from "@/api/exports";
import { useTrackedJob } from "@/jobs/useTrackedJob";
import { isActiveJob, useJobsStore } from "@/store/jobs";
import { Alert, Button, Dialog, Field, Input, Pill, Select, toast } from "@/ui";
import { crsLabel, crsName, formatBytes, formatPoints, heightsLabel } from "./format";
import { rankMaps } from "./link";

const m3 = (v: number) => v.toFixed(3);

export function CloudDetails({
  projectId,
  cloud,
  maps,
  onChanged,
  onDeleted,
}: {
  projectId: string;
  cloud: PointCloud;
  maps: GeoMap[];
  onChanged(c: PointCloud): void;
  onDeleted(): void;
}) {
  const api = useApi();
  const [error, setError] = useState<string | null>(null);
  const [epsg, setEpsg] = useState("");
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [exportJobId, setExportJobId] = useState<string | null>(null);
  const { job: exportJob } = useTrackedJob(projectId, exportJobId);
  const ranked = useMemo(() => rankMaps(cloud, maps), [cloud, maps]);
  const b = cloud.bounds_native;

  // One toast per finished export; a ref (not state) remembers which job it was already shown for.
  const toasted = useRef<string | null>(null);
  const exporting = !!exportJob && isActiveJob(exportJob);
  useEffect(() => {
    if (!exportJob || isActiveJob(exportJob) || toasted.current === exportJob.id) return;
    toasted.current = exportJob.id;
    if (exportJob.state === "succeeded") {
      const folder = String((exportJob.result as Record<string, unknown> | null)?.folder ?? "exports");
      toast("ok", "LAZ export finished", {
        label: "Show folder",
        onClick: () => void revealInExplorer(api, projectId, folder).catch(() => undefined),
      });
    } else {
      toast("danger", `LAZ export ${exportJob.state}: ${exportJob.error ?? "see the log"}`);
    }
  }, [api, projectId, exportJob]);

  const patch = (body: Parameters<typeof patchPointCloud>[3]) =>
    void patchPointCloud(api, projectId, cloud.id, body)
      .then((c) => {
        setError(null);
        onChanged(c);
      })
      .catch((e: unknown) => setError(messageOf(e, "could not save")));

  const facts: [string, string][] = [
    ["Points", cloud.point_count != null ? formatPoints(cloud.point_count) : "—"],
    ["File", cloud.source_path],
    ["Size", formatBytes(cloud.source_size)],
    ["Format", cloud.las_version ? `LAS ${cloud.las_version} · format ${cloud.point_format}` : "—"],
    ["Coordinates", [crsLabel(cloud), crsName(cloud.crs_wkt)].filter(Boolean).join(" · ")],
    ["Heights", heightsLabel(cloud)],
    ["Bounds", b ? `${m3(b[0])}, ${m3(b[1])} – ${m3(b[3])}, ${m3(b[4])}` : "—"],
    ["Octree spacing", cloud.octree_spacing_m != null ? `${cloud.octree_spacing_m.toFixed(2)} m` : "—"],
    ["Z p1–p99", cloud.z_stats ? `${cloud.z_stats.p1.toFixed(2)} – ${cloud.z_stats.p99.toFixed(2)} m` : "—"],
  ];

  return (
    <div className="flex flex-col gap-4">
      <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-sm">
        {facts.map(([k, v]) => (
          <div key={k} className="contents">
            <dt className="text-muted">{k}</dt>
            <dd className="min-w-0 break-words text-right tabular-nums text-ink">{v}</dd>
          </div>
        ))}
      </dl>
      {cloud.bounds_repaired && (
        <p className="text-xs text-muted">
          Header bounds repaired: the file's header box missed some points, so the import fixed its own copy
          (the file itself is unchanged).
        </p>
      )}
      {error && <Alert tone="danger">{error}</Alert>}
      <Field label="Captured on" htmlFor="cloud-captured">
        <Input
          id="cloud-captured"
          type="date"
          value={cloud.captured_on ?? ""}
          onChange={(e) => patch({ captured_on: e.target.value || null })}
        />
      </Field>
      {!cloud.crs_wkt && (
        <Field
          label="EPSG code"
          htmlFor="cloud-epsg"
          hint="The file has no coordinate system. Assign the one it was surveyed in."
        >
          <div className="flex gap-2">
            <Input
              id="cloud-epsg"
              inputMode="numeric"
              value={epsg}
              onChange={(e) => setEpsg(e.target.value.replace(/\D/g, ""))}
            />
            <Button disabled={!epsg} onClick={() => patch({ assign_epsg: Number(epsg) })}>
              Assign CRS
            </Button>
          </div>
        </Field>
      )}
      <Field
        label="Linked map"
        htmlFor="cloud-link"
        hint={ranked.length ? undefined : "No ready map with coordinates overlaps this cloud."}
      >
        <Select
          id="cloud-link"
          value={cloud.map_id ?? ""}
          disabled={!cloud.crs_wkt}
          onChange={(e) => patch({ map_id: e.target.value || null })}
        >
          <option value="">Not linked</option>
          {ranked.map((r) => (
            <option key={r.map.id} value={r.map.id}>
              {r.map.name} · {Math.round(r.overlap * 100)} % overlap
              {r.likelySameFlight ? " · likely same flight" : ""}
            </option>
          ))}
        </Select>
      </Field>
      {ranked[0]?.likelySameFlight && cloud.map_id !== ranked[0].map.id && (
        <Pill tone="accent">likely same flight: {ranked[0].map.name}</Pill>
      )}
      <div className="flex flex-wrap gap-2 border-t border-line pt-3">
        <Button
          icon="download"
          loading={exporting}
          onClick={() =>
            void createPointCloudExport(api, projectId, cloud.id, true)
              .then((job) => {
                useJobsStore.getState().upsert(job);
                setExportJobId(job.id);
              })
              .catch((e: unknown) => setError(messageOf(e, "could not start the export")))
          }
        >
          Export LAZ
        </Button>
        <Button variant="danger" icon="trash" onClick={() => setConfirmDelete(true)}>
          Delete
        </Button>
      </div>
      {confirmDelete && (
        <Dialog
          open
          title={`Delete ${cloud.name}?`}
          description="The 3D view copy and the measurements go; the source file is not touched."
          onClose={() => setConfirmDelete(false)}
          footer={
            <>
              <Button onClick={() => setConfirmDelete(false)}>Keep it</Button>
              <Button
                variant="danger"
                onClick={() =>
                  void deletePointCloud(api, projectId, cloud.id)
                    .then(onDeleted)
                    .catch((e: unknown) => {
                      setConfirmDelete(false);
                      setError(messageOf(e, "could not delete"));
                    })
                }
              >
                Delete
              </Button>
            </>
          }
        >
          <p className="text-sm text-muted">{cloud.source_path}</p>
        </Dialog>
      )}
    </div>
  );
}
```

`frontend/src/clouds/ViewPanel.tsx`:

```tsx
import { BUDGETS } from "@/clouds/viewer/budget";
import { POINT_SIZE_MAX, POINT_SIZE_MIN, type ColourMode } from "@/clouds/viewer/materialOptions";
import { Button, Field, Input, Kbd, Segmented, Select } from "@/ui";

export interface ViewSettings {
  budget: number;
  colour: ColourMode;
  elevationRange: [number, number];
  pointSize: number;
}

export function ViewPanel({
  settings,
  hasRgb,
  defaultRange,
  onChange,
  onFit,
  onTop,
}: {
  settings: ViewSettings;
  hasRgb: boolean;
  defaultRange: [number, number];
  onChange(s: ViewSettings): void;
  onFit(): void;
  onTop(): void;
}) {
  const set = (patch: Partial<ViewSettings>) => onChange({ ...settings, ...patch });
  const [lo, hi] = settings.elevationRange;
  return (
    <div className="flex flex-col gap-4">
      <Field label="Point budget" htmlFor="cloud-budget" hint="More points look denser and use more memory.">
        <Select
          id="cloud-budget"
          value={settings.budget}
          onChange={(e) => set({ budget: Number(e.target.value) })}
        >
          {BUDGETS.map((b) => (
            <option key={b} value={b}>
              {b / 1e6} M
            </option>
          ))}
        </Select>
      </Field>
      <Segmented
        label="Colour"
        value={settings.colour}
        onChange={(colour) => set({ colour })}
        options={[
          { value: "rgb", label: "RGB", disabled: !hasRgb },
          { value: "elevation", label: "Elevation" },
        ]}
      />
      {settings.colour === "elevation" && (
        <div className="flex items-end gap-2">
          <Field label="Lowest" htmlFor="cloud-zlo">
            <Input
              id="cloud-zlo"
              type="number"
              step="0.1"
              value={lo}
              onChange={(e) => set({ elevationRange: [Number(e.target.value), hi] })}
            />
          </Field>
          <Field label="Highest" htmlFor="cloud-zhi">
            <Input
              id="cloud-zhi"
              type="number"
              step="0.1"
              value={hi}
              onChange={(e) => set({ elevationRange: [lo, Number(e.target.value)] })}
            />
          </Field>
          <Button size="sm" variant="ghost" onClick={() => set({ elevationRange: defaultRange })}>
            Reset
          </Button>
        </div>
      )}
      <Field label={`Point size · ${settings.pointSize.toFixed(1)}`} htmlFor="cloud-size">
        <input
          id="cloud-size"
          type="range"
          min={POINT_SIZE_MIN}
          max={POINT_SIZE_MAX}
          step={0.1}
          value={settings.pointSize}
          onChange={(e) => set({ pointSize: Number(e.target.value) })}
          className="accent-accent"
        />
      </Field>
      <div className="flex gap-2">
        <Button size="sm" icon="fit" onClick={onFit}>
          Fit view <Kbd>F</Kbd>
        </Button>
        <Button size="sm" onClick={onTop}>
          Top view <Kbd>T</Kbd>
        </Button>
      </div>
    </div>
  );
}
```

(The elevation inputs render in both colour modes in the unit test above — keep them visible whenever `colour === "elevation"`; the no-RGB cloud's default colour is Elevation, which is what the test checks.)

- [ ] **Step 8: Build the screen**

`frontend/src/screens/CloudsScreen.tsx` (whole file):

```tsx
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { cloudOctreeUrl, type GeoMap } from "@contract/client";
import { useApi, useBackend } from "@/api/client";
import { createPointCloud, deletePointCloud, listPointClouds, type PointCloud } from "@/api/clouds";
import { messageOf } from "@/api/errors";
import { listMaps } from "@/api/maps";
import { pushLog } from "@/app/diagnostics";
import { CloudDetails } from "@/clouds/CloudDetails";
import { CloudList } from "@/clouds/CloudList";
import { CloudViewer, type CloudViewerHandle } from "@/clouds/CloudViewer";
import { ImportCloudDialog } from "@/clouds/ImportCloudDialog";
import { ViewPanel, type ViewSettings } from "@/clouds/ViewPanel";
import { readBudget, writeBudget } from "@/clouds/viewer/budget";
import { defaultColour, defaultElevationRange } from "@/clouds/viewer/materialOptions";
import { isTypingTarget } from "@/editor/hotkeys";
import { useOnJobsFinished } from "@/jobs/useOnJobsFinished";
import { useJobsStore } from "@/store/jobs";
import { Alert, Button, EmptyState, Segmented, toast } from "@/ui";

type Tab = "details" | "view";
const TABS: { value: Tab; label: string }[] = [
  { value: "details", label: "Details" },
  { value: "view", label: "View" },
];

function report(action: string, err: unknown): string {
  const message = messageOf(err, `could not ${action}`);
  pushLog(`${action} failed: ${message}`);
  toast("danger", message);
  return message;
}

export function CloudsScreen() {
  const { projectId = "", cloudId } = useParams();
  const api = useApi();
  const navigate = useNavigate();
  const { baseUrl, token } = useBackend();
  const viewer = useRef<CloudViewerHandle>(null);
  const [clouds, setClouds] = useState<PointCloud[] | null>(null);
  const [maps, setMaps] = useState<GeoMap[]>([]);
  const [listError, setListError] = useState<string | null>(null);
  const [importing, setImporting] = useState<{ path: string; name: string } | null>(null);
  const [tab, setTab] = useState<Tab>("details");
  const [settings, setSettings] = useState<ViewSettings | null>(null);

  const reload = useCallback(() => {
    void listPointClouds(api, projectId)
      .then((cs) => {
        setClouds(cs);
        setListError(null);
      })
      .catch((e: unknown) => setListError(report("load point clouds", e)));
    void listMaps(api, projectId)
      .then(setMaps)
      .catch(() => setMaps([]));
  }, [api, projectId]);
  useEffect(reload, [reload]);
  useOnJobsFinished("pointcloud_import", reload);

  const cloud = clouds?.find((c) => c.id === cloudId) ?? null;
  const defaultRange = useMemo<[number, number]>(
    () => (cloud ? defaultElevationRange(cloud) : [0, 1]),
    [cloud],
  );

  // A new cloud starts from its own defaults; the budget is remembered across clouds.
  const [settingsFor, setSettingsFor] = useState<string | null>(null);
  if (cloud && cloud.id !== settingsFor) {
    setSettingsFor(cloud.id);
    setSettings({
      budget: readBudget(),
      colour: defaultColour(cloud.has_rgb),
      elevationRange: defaultRange,
      pointSize: 1,
    });
  }

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (isTypingTarget(e.target) || e.ctrlKey || e.metaKey || e.altKey) return;
      if (e.key === "f" || e.key === "F") viewer.current?.fit();
      if (e.key === "t" || e.key === "T") viewer.current?.topView();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const importAgain = (c: PointCloud) =>
    void createPointCloud(api, projectId, { path: c.source_path, name: c.name })
      .then((r) => {
        useJobsStore.getState().upsert(r.job);
        return deletePointCloud(api, projectId, c.id).then(() => {
          reload();
          navigate(`/p/${projectId}/clouds/${r.cloud.id}`);
        });
      })
      .catch((e: unknown) => report("import again", e));

  const remove = (c: PointCloud) =>
    void deletePointCloud(api, projectId, c.id)
      .then(() => {
        reload();
        if (c.id === cloudId) navigate(`/p/${projectId}/clouds`);
      })
      .catch((e: unknown) => report("delete the point cloud", e));

  if (clouds && clouds.length === 0 && !importing) {
    return (
      <div className="flex h-full flex-col p-6">
        <h1 className="text-xl font-semibold tracking-tight">Point clouds</h1>
        <EmptyState
          className="m-auto"
          icon="cloud"
          title="Import a LAS or LAZ point cloud"
          action={
            <Button variant="primary" icon="import" onClick={() => setImporting({ path: "", name: "" })}>
              Import
            </Button>
          }
        >
          See a drone survey in 3D, measure points, distances and plumbness, and hand a LAZ to a client.
        </EmptyState>
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 w-full">
      <section className="flex w-52 shrink-0 flex-col gap-4 overflow-y-auto border-r border-line p-3 xl:w-64">
        <div className="flex items-center justify-between">
          <h1 className="text-xl font-semibold tracking-tight">Point clouds</h1>
          <Button size="sm" icon="import" onClick={() => setImporting({ path: "", name: "" })}>
            Import
          </Button>
        </div>
        {clouds ? (
          <CloudList
            projectId={projectId}
            clouds={clouds}
            maps={maps}
            activeId={cloudId}
            onImportAgain={importAgain}
            onDelete={remove}
          />
        ) : (
          listError && (
            <Alert
              tone="danger"
              actions={
                <Button size="sm" icon="refresh" onClick={reload}>
                  Retry
                </Button>
              }
            >
              {listError}
            </Alert>
          )
        )}
      </section>
      <section data-testid="cloud-centre" className="relative flex min-h-0 min-w-0 flex-1">
        {cloud?.status === "ready" && settings ? (
          <CloudViewer
            ref={viewer}
            cloud={cloud}
            octreeUrl={cloudOctreeUrl(baseUrl, projectId, cloud.id)}
            token={token}
            budget={settings.budget}
            colour={settings.colour}
            elevationRange={settings.elevationRange}
            pointSize={settings.pointSize}
          />
        ) : (
          <EmptyState
            className="m-auto"
            icon="cloud"
            title={cloud ? `${cloud.name} is ${cloud.status}` : "Choose a point cloud"}
          >
            {cloud?.error ?? "Pick a cloud on the left, or import one."}
          </EmptyState>
        )}
      </section>
      <aside
        data-testid="cloud-panel"
        className="flex w-72 shrink-0 flex-col gap-4 overflow-y-auto border-l border-line p-4 xl:w-80"
      >
        {cloud && (
          <>
            <h2 className="min-w-0 truncate text-base font-semibold">{cloud.name}</h2>
            <Segmented label="Cloud panel" size="sm" value={tab} onChange={setTab} options={TABS} />
            {tab === "details" && (
              <CloudDetails
                projectId={projectId}
                cloud={cloud}
                maps={maps}
                onChanged={(c) => setClouds((cs) => cs?.map((x) => (x.id === c.id ? c : x)) ?? cs)}
                onDeleted={() => {
                  reload();
                  navigate(`/p/${projectId}/clouds`);
                }}
              />
            )}
            {tab === "view" && settings && (
              <ViewPanel
                settings={settings}
                hasRgb={!!cloud.has_rgb}
                defaultRange={defaultRange}
                onChange={(s) => {
                  if (s.budget !== settings.budget) writeBudget(s.budget);
                  setSettings(s);
                }}
                onFit={() => viewer.current?.fit()}
                onTop={() => viewer.current?.topView()}
              />
            )}
          </>
        )}
      </aside>
      {importing && (
        <ImportCloudDialog
          projectId={projectId}
          initialPath={importing.path}
          initialName={importing.name}
          onClose={() => setImporting(null)}
          onStarted={(c) => {
            setImporting(null);
            reload();
            navigate(`/p/${projectId}/clouds/${c.id}`);
          }}
        />
      )}
    </div>
  );
}
```

- [ ] **Step 9: Run the unit tests to verify they pass**

Run: `pnpm -C frontend test -- src/clouds src/screens/CloudsScreen src/ui`
Expected: PASS.

- [ ] **Step 10: Write the screen e2e tests** (spec §16 e2e 1, 3 and 7)

Append to `frontend/e2e/clouds.spec.ts`:

```ts
const CORS = { "Access-Control-Allow-Origin": "*" };
const job = (state: string, type = "pointcloud_import", result: unknown = null) => ({
  id: "j0000000-9999-4000-8000-000000000001",
  project_id: P,
  type,
  state,
  progress: state === "succeeded" ? 1 : 0.4,
  message: "building the 3D view copy: INDEXING 63 %",
  log_path: "",
  params: {},
  result,
  error: null,
  created_at: "2026-09-24T10:00:00Z",
  started_at: null,
  finished_at: null,
});
const admission = (ok: boolean) => ({
  ok,
  ram_needed_bytes: 9_861_101_344,
  ram_available_bytes: ok ? 30e9 : 4e9,
  disk_needed_bytes: 1,
  disk_available_bytes: 2,
  reason: ok
    ? null
    : "This cloud needs about 9.9 GB of free memory; 4.0 GB is free. Close other programs and try again.",
});

test("import: inspect, a refusal, then an admissible file goes importing then ready", async ({ page }) => {
  let list: unknown[] = [];
  let polls = 0;
  await page.route(
    (u) => u.pathname === `/api/v1/projects/${P}/pointclouds`,
    async (route) => {
      if (route.request().method() === "POST") {
        list = [cloudJson({ status: "importing", job_id: job("running").id })];
        return route.fulfill({
          status: 202,
          contentType: "application/json",
          headers: CORS,
          body: JSON.stringify({ cloud: list[0], job: job("queued") }),
        });
      }
      return route.fulfill({
        contentType: "application/json",
        headers: CORS,
        body: JSON.stringify({ items: list }),
      });
    },
  );
  await page.route(
    (u) => u.pathname.endsWith("/pointclouds/inspect"),
    (route) => {
      const path = (route.request().postDataJSON() as { path: string }).path;
      const big = path.includes("huge");
      return route.fulfill({
        contentType: "application/json",
        headers: CORS,
        body: JSON.stringify({
          path,
          size: 6_200_000_000,
          compressed: false,
          las_version: "1.2",
          point_format: 3,
          point_count: big ? 195_274_656 : 10_201,
          has_rgb: true,
          header_bounds: [0, 0, 0, 1, 1, 1],
          crs_wkt: "x",
          epsg: 32639,
          captured_on: null,
          admission: admission(!big),
        }),
      });
    },
  );
  await page.route(
    (u) => u.pathname.endsWith(`/jobs/${job("running").id}`),
    (route) => {
      polls += 1;
      const done = polls > 1;
      if (done) list = [cloudJson()];
      return route.fulfill({
        contentType: "application/json",
        headers: CORS,
        body: JSON.stringify(job(done ? "succeeded" : "running")),
      });
    },
  );
  await jsonRoute(page, `/api/v1/projects/${P}/pointclouds/${CLOUD}`, cloudJson());
  await routeOctree(
    page,
    CLOUD,
    buildOctree(redGreenGrid({ origin: [243500, 3178000, 0], size: 100, step: 2 })),
  );

  await page.goto(`/p/${P}/clouds`);
  await page.getByRole("button", { name: "Import" }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("LAS or LAZ file").fill("D:\\clouds\\huge.las");
  await expect(dialog).toContainText(
    "This cloud needs about 9.9 GB of free memory; 4.0 GB is free. Close other programs and try again.",
  );
  await expect(dialog.getByRole("button", { name: "Import" })).toBeDisabled();
  await dialog.getByLabel("LAS or LAZ file").fill("D:\\clouds\\site.laz");
  await expect(dialog).toContainText("10 201 points");
  await dialog.getByRole("button", { name: "Import" }).click();
  const row = page.getByRole("list", { name: "Point clouds" });
  await expect(row).toContainText("importing");
  await expect(row).toContainText("ready", { timeout: 15_000 });
});

test("view: budget and colour switches", async ({ page }) => {
  await jsonRoute(page, `/api/v1/projects/${P}/pointclouds`, { items: [cloudJson()] });
  await jsonRoute(page, `/api/v1/projects/${P}/pointclouds/${CLOUD}`, cloudJson());
  await routeOctree(
    page,
    CLOUD,
    buildOctree(redGreenGrid({ origin: [243500, 3178000, 0], size: 100, step: 2 })),
  );
  await page.goto(`/p/${P}/clouds/${CLOUD}`);
  await page.getByRole("radio", { name: "View" }).click();
  await page.getByLabel("Point budget").selectOption("8000000");
  expect(await page.evaluate(() => localStorage.getItem("kestrel.clouds.pointBudget"))).toBe("8000000");
  await page.getByRole("radio", { name: "Elevation" }).click();
  await expect(page.getByLabel("Lowest")).toHaveValue("0.02");
  await page.getByRole("button", { name: "Reset" }).click();
});

test("export LAZ ends with a toast that reveals the folder", async ({ page }) => {
  const posts: unknown[] = [];
  await jsonRoute(page, `/api/v1/projects/${P}/pointclouds`, { items: [cloudJson()] });
  await jsonRoute(page, `/api/v1/projects/${P}/pointclouds/${CLOUD}`, cloudJson());
  await routeOctree(
    page,
    CLOUD,
    buildOctree(redGreenGrid({ origin: [243500, 3178000, 0], size: 100, step: 2 })),
  );
  const done = job("succeeded", "pointcloud_export", {
    folder: "exports/2026-09-24_101500",
    laz: "cloud-fixture-cloud.laz",
    files: [],
    point_count: 10_201,
    cloud_id: CLOUD,
  });
  await page.route(
    (u) => u.pathname.endsWith(`/pointclouds/${CLOUD}/exports`),
    (route) => {
      posts.push(route.request().postDataJSON());
      return route.fulfill({
        status: 202,
        contentType: "application/json",
        headers: CORS,
        body: JSON.stringify({ job: job("queued", "pointcloud_export") }),
      });
    },
  );
  await page.route(
    (u) => u.pathname.endsWith(`/jobs/${done.id}`),
    (route) => route.fulfill({ contentType: "application/json", headers: CORS, body: JSON.stringify(done) }),
  );
  await page.goto(`/p/${P}/clouds/${CLOUD}`);
  await page.getByRole("button", { name: "Export LAZ" }).click();
  await expect.poll(() => posts.length).toBe(1);
  expect(posts[0]).toEqual({ format: "laz", include_measurements: true });
  await expect(page.getByText("LAZ export finished")).toBeVisible({ timeout: 10_000 });
  await expect(page.getByRole("button", { name: "Show folder" })).toBeVisible();
});
```

In F0's `frontend/e2e/pointcloud-foundation.spec.ts`, the first test asserts the empty state after clicking **Point clouds** in the rail; the Prism mock now serves the contract's example cloud there, so replace

```ts
  await expect(page.getByText("Import a LAS or LAZ point cloud")).toBeVisible();
```

with

```ts
  await expect(page.getByRole("button", { name: "Import", exact: true })).toBeVisible();
```

Its other assertions (the heading, the deep link with `?at=`) hold unchanged: the full screen keeps the `Point clouds` heading in the left column.

Run: `pnpm -C frontend e2e -- clouds.spec.ts pointcloud-foundation.spec.ts` (free ports)
Expected: PASS (the Task 6 tests keep passing: the full screen still renders `cloud-centre` and the viewer).

- [ ] **Step 11: Gate and commit**

```powershell
git add frontend/e2e/pointcloud-foundation.spec.ts frontend/src/api/clouds.ts frontend/src/clouds/format.ts frontend/src/clouds/format.test.ts frontend/src/clouds/link.ts frontend/src/clouds/link.test.ts frontend/src/clouds/CloudList.tsx frontend/src/clouds/ImportCloudDialog.tsx frontend/src/clouds/ImportCloudDialog.test.tsx frontend/src/clouds/CloudDetails.tsx frontend/src/clouds/ViewPanel.tsx frontend/src/screens/CloudsScreen.tsx frontend/src/screens/CloudsScreen.test.tsx frontend/src/ui/Segmented.tsx frontend/src/ui/Controls.test.tsx frontend/src/ui/useJobToasts.ts frontend/src/ui/useJobToasts.test.ts frontend/e2e/clouds.spec.ts
git commit -m "feat(clouds): Clouds screen - list, import dialog with admission, Details (link, CRS, export, delete) and View tabs

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 14: Import job, cloud routes, link rules, startup sweep (unit I2)

**Files:**
- Create: `backend/app/pointclouds/service.py`
- Create: `backend/app/pointclouds/routes_clouds.py`
- Modify: `backend/app/pointclouds/jobs_import.py` (replace F0's stub body)
- Modify: `backend/app/pointclouds/startup.py` (fill `sweep_interrupted`)
- Modify: `backend/app/maps/service.py::delete_map` (null the links in the same transaction)
- Modify: `backend/app/pointclouds/router.py` (remove the six cloud stub tuples; add `cloud_routes`)
- Modify: `backend/tests/test_contract.py` (remove `listPointClouds`, `createPointCloud`, `inspectPointCloudFile`, `getPointCloud`, `patchPointCloud`, `deletePointCloud`, so `EXPECTED_STUBS` holds no S1 operation; add `createPointCloud`, `inspectPointCloudFile` and `patchPointCloud` with `{422}` to `REFUSES_VALID_DATA`)
- Test: `backend/tests/test_pointcloud_api.py`, `backend/tests/test_pointcloud_startup.py`

**Interfaces:**
- Consumes: Task 1 schemas/rows/`insert_cloud`; Task 3 `admission`; Task 4 `lasfile.inspect_file`, `UnsupportedCloud`, `crs.crs_from_epsg`, `crs.bounds_wgs84`; Task 2 `converter_path.converter_exe`, `NOT_INSTALLED`; Task 9 `importer.import_cloud`; F0 `publish_pointclouds_changed`, the conftest fake converter.
- Produces:
  - `service.list_clouds`, `service.inspect(handle, path) -> PointCloudFileInfo`, `service.create_cloud(handle, body) -> PointCloud`, `service.set_job(handle, cloud_id, job_id) -> PointCloud`, `service.patch_cloud(handle, cloud_id, body) -> PointCloud`, `service.delete_cloud(handle, cloud_id, is_live) -> None`, `service.converter_installed() -> bool` (seam), `service.overlaps(a, b) -> bool`.
  - Error codes: 404 `not_found` (file / cloud / map); 422 `unsupported_point_cloud`, `insufficient_memory`, `insufficient_disk`, `link_needs_coordinates`, `no_overlap`, `crs_already_set`, `invalid_epsg`; 409 `job_running`.
  - Job `pointcloud_import` params `{cloud_id, name}`; result `{cloud_id, point_count, epsg, octree_bytes, seconds}`.
  - `startup.INTERRUPTED = "import interrupted by application restart; import the file again"`; `startup.sweep_interrupted(handle, runner) -> list[str]`.

- [ ] **Step 1: Write the failing API tests**

`backend/tests/test_pointcloud_api.py`:

```python
"""Point-cloud CRUD, inspect, the import job, link rules and delete (spec §4, §6, §10)."""

import threading
import time

import pytest
from pointclouds import insert_cloud, make_las
from pyproj import CRS

from app.db.models import CloudMeasurement, GeoMap
from app.jobs.cancellation import JobFailure
from app.pointclouds import admission, service

BASE = "/api/v1/projects"
GB = 1_000_000_000


@pytest.fixture
def project_kind() -> str:
    return "detect"


@pytest.fixture(autouse=True)
def plenty(monkeypatch):
    monkeypatch.setattr(admission, "available_ram", lambda: 64 * GB)
    monkeypatch.setattr(admission, "free_disk", lambda folder: 2_000 * GB)
    monkeypatch.setattr(service, "converter_installed", lambda: True)


@pytest.fixture
def events(app, client):
    seen = []
    original = app.state.events.publish
    app.state.events.publish = lambda e: (seen.append(e), original(e))
    return seen


def _map(handle, bounds_wgs84, epsg=32639, captured_on=None):
    crs = CRS.from_epsg(epsg)
    with handle.session() as s:
        m = GeoMap(
            name="Ortho",
            status="ready",
            source_path="D:/o.tif",
            source_size=1,
            crs_wkt=crs.to_wkt(),
            epsg=epsg,
            proj4=crs.to_proj4(),
            bounds_wgs84=bounds_wgs84,
            captured_on=captured_on,
        )
        s.add(m)
        s.flush()
        return m.id


def _import(client, wait_job, project_id, path, **body):
    r = client.post(f"{BASE}/{project_id}/pointclouds", json={"path": str(path), **body})
    assert r.status_code == 202, r.text
    return r.json(), wait_job(project_id, r.json()["job"]["id"])


def test_import_to_ready(client, wait_job, project_id, handle, tmp_path, events):
    src = make_las(tmp_path / "Chimney stack 3D.las", 5_000, header_shrink_mm=0.3)
    created, job = _import(client, wait_job, project_id, src)
    assert created["cloud"]["status"] == "importing" and created["cloud"]["name"] == "Chimney stack 3D"
    assert job["state"] == "succeeded", job
    assert set(job["result"]) == {"cloud_id", "point_count", "epsg", "octree_bytes", "seconds"}
    c = client.get(f"{BASE}/{project_id}/pointclouds/{created['cloud']['id']}").json()
    assert (c["status"], c["point_count"], c["epsg"], c["bounds_repaired"], c["crs_source"]) == (
        "ready",
        5_000,
        32639,
        True,
        "file",
    )
    assert c["octree_spacing_m"] > 0 and c["z_stats"]["sample_count"] == 5_000 and c["class_counts"]
    assert c["captured_on"] is not None and c["source_sha256"] and c["job_id"] == created["job"]["id"]
    assert (handle.folder / "pointclouds" / c["id"] / "octree" / "metadata.json").is_file()
    assert any(e["type"] == "pointclouds.changed" for e in events)
    items = client.get(f"{BASE}/{project_id}/pointclouds").json()["items"]
    assert [i["id"] for i in items] == [c["id"]]


def test_newest_first(client, wait_job, project_id, tmp_path):
    a, _ = _import(client, wait_job, project_id, make_las(tmp_path / "a.las", 100))
    b, _ = _import(client, wait_job, project_id, make_las(tmp_path / "b.las", 100))
    assert [i["id"] for i in client.get(f"{BASE}/{project_id}/pointclouds").json()["items"]] == [
        b["cloud"]["id"],
        a["cloud"]["id"],
    ]


def test_missing_file_is_404_and_not_las_is_422(client, project_id, tmp_path):
    assert (
        client.post(f"{BASE}/{project_id}/pointclouds", json={"path": str(tmp_path / "nope.las")}).status_code
        == 404
    )
    junk = tmp_path / "junk.las"
    junk.write_bytes(b"not a point cloud")
    r = client.post(f"{BASE}/{project_id}/pointclouds", json={"path": str(junk)})
    assert r.status_code == 422 and r.json()["error"]["code"] == "unsupported_point_cloud"


def test_admission_refusal_creates_no_row(client, project_id, tmp_path, monkeypatch):
    monkeypatch.setattr(admission, "available_ram", lambda: 1 * GB)
    r = client.post(f"{BASE}/{project_id}/pointclouds", json={"path": str(make_las(tmp_path / "a.las", 100))})
    assert r.status_code == 422 and r.json()["error"]["code"] == "insufficient_memory"
    assert "GB of free memory" in r.json()["error"]["message"]
    assert client.get(f"{BASE}/{project_id}/pointclouds").json()["items"] == []


def test_195m_points_refused_with_4_gb_free(client, project_id, tmp_path, monkeypatch):
    """Spec §17.3: admission reads the header's count, so a small file claiming 195 M points is enough."""
    src = make_las(tmp_path / "huge.las", 100)
    with open(src, "r+b") as f:  # LAS 1.2 legacy point count at byte 107
        f.seek(107)
        f.write((195_274_656).to_bytes(4, "little"))
    monkeypatch.setattr(admission, "available_ram", lambda: 4 * GB)
    r = client.post(f"{BASE}/{project_id}/pointclouds", json={"path": str(src)})
    assert r.status_code == 422 and r.json()["error"]["code"] == "insufficient_memory"
    assert r.json()["error"]["message"] == (
        "This cloud needs about 9.9 GB of free memory; 4.0 GB is free. Close other programs and try again."
    )
    assert client.get(f"{BASE}/{project_id}/pointclouds").json()["items"] == []


def test_inspect_reports_facts_and_admission(client, project_id, tmp_path, monkeypatch):
    src = make_las(tmp_path / "a.laz", 1_000, compressed=True)
    r = client.post(f"{BASE}/{project_id}/pointclouds/inspect", json={"path": str(src)})
    assert r.status_code == 200, r.text
    info = r.json()
    assert (info["compressed"], info["point_count"], info["epsg"], info["has_rgb"]) == (
        True,
        1_000,
        32639,
        True,
    )
    assert info["admission"]["ok"] is True and info["admission"]["reason"] is None
    monkeypatch.setattr(service, "converter_installed", lambda: False)
    info = client.post(f"{BASE}/{project_id}/pointclouds/inspect", json={"path": str(src)}).json()
    assert info["admission"]["ok"] is False
    assert (
        info["admission"]["reason"]
        == "the point-cloud converter is not installed (run backend\\scripts\\fetch_potreeconverter.ps1)"
    )


def test_failed_import_is_failed_with_its_reason_and_no_folder(
    client, wait_job, project_id, handle, tmp_path, monkeypatch
):
    def broken(input_path, out_dir, *, progress, check_cancelled):
        raise JobFailure("the point-cloud converter stopped: ERROR(x)")

    monkeypatch.setattr("app.pointclouds.converter.run_converter", broken)
    created, job = _import(client, wait_job, project_id, make_las(tmp_path / "a.las", 100))
    assert job["state"] == "failed"
    c = client.get(f"{BASE}/{project_id}/pointclouds/{created['cloud']['id']}").json()
    assert (c["status"], c["error"]) == ("failed", "the point-cloud converter stopped: ERROR(x)")
    assert not (handle.folder / "pointclouds" / c["id"]).exists()


def _blocking_converter(started: threading.Event):
    def run(input_path, out_dir, *, progress, check_cancelled):
        started.set()
        while True:
            check_cancelled()
            time.sleep(0.05)

    return run


def test_cancel_and_delete_while_running(client, wait_job, project_id, handle, tmp_path, monkeypatch):
    started = threading.Event()
    monkeypatch.setattr("app.pointclouds.converter.run_converter", _blocking_converter(started))
    r = client.post(
        f"{BASE}/{project_id}/pointclouds", json={"path": str(make_las(tmp_path / "a.las", 100))}
    ).json()
    assert started.wait(20)
    cloud_id, job_id = r["cloud"]["id"], r["job"]["id"]
    busy = client.delete(f"{BASE}/{project_id}/pointclouds/{cloud_id}")
    assert busy.status_code == 409 and busy.json()["error"]["code"] == "job_running"
    client.post(f"{BASE}/{project_id}/jobs/{job_id}/cancel")
    assert wait_job(project_id, job_id)["state"] == "cancelled"
    c = client.get(f"{BASE}/{project_id}/pointclouds/{cloud_id}").json()
    assert (c["status"], c["error"]) == ("failed", "import cancelled")
    assert not (handle.folder / "pointclouds" / cloud_id).exists()


def test_delete_cascades_measurements_and_removes_the_folder(client, project_id, handle):
    cloud_id = insert_cloud(handle)
    folder = handle.folder / "pointclouds" / cloud_id / "octree"
    folder.mkdir(parents=True)
    with handle.session() as s:
        s.add(
            CloudMeasurement(
                point_cloud_id=cloud_id, kind="point", name="Point 1", note=None, points=[], results={}
            )
        )
    assert client.delete(f"{BASE}/{project_id}/pointclouds/{cloud_id}").status_code == 204
    assert not folder.parent.exists()
    with handle.session() as s:
        assert s.query(CloudMeasurement).count() == 0
    assert client.get(f"{BASE}/{project_id}/pointclouds/{cloud_id}").status_code == 404


BOX = [48.3744, 28.7038, 48.3755, 28.7048]


def test_link_rules(client, project_id, handle):
    cloud_id = insert_cloud(handle, bounds_wgs84=BOX)
    url = f"{BASE}/{project_id}/pointclouds/{cloud_id}"
    assert client.patch(url, json={"map_id": "nope"}).status_code == 404
    far = _map(handle, [10, 10, 11, 11])
    r = client.patch(url, json={"map_id": far})
    assert r.status_code == 422 and r.json()["error"]["code"] == "no_overlap"
    other_crs = _map(handle, [48.37, 28.70, 48.38, 28.71], epsg=32638)  # a different CRS that does overlap
    assert client.patch(url, json={"map_id": other_crs}).json()["map_id"] == other_crs
    assert client.patch(url, json={"map_id": None}).json()["map_id"] is None
    bare = insert_cloud(handle, crs_wkt=None, epsg=None, proj4=None, crs_source=None, bounds_wgs84=None)
    r = client.patch(f"{BASE}/{project_id}/pointclouds/{bare}", json={"map_id": other_crs})
    assert r.status_code == 422 and r.json()["error"]["code"] == "link_needs_coordinates"


def test_deleting_the_map_nulls_the_link(client, project_id, handle):
    map_id = _map(handle, BOX)
    cloud_id = insert_cloud(handle, bounds_wgs84=BOX, map_id=map_id)
    assert client.delete(f"{BASE}/{project_id}/maps/{map_id}").status_code == 204
    assert client.get(f"{BASE}/{project_id}/pointclouds/{cloud_id}").json()["map_id"] is None


def test_assign_epsg_only_without_a_crs(client, project_id, handle):
    has = insert_cloud(handle)
    r = client.patch(f"{BASE}/{project_id}/pointclouds/{has}", json={"assign_epsg": 32638})
    assert r.status_code == 422 and r.json()["error"]["code"] == "crs_already_set"
    bare = insert_cloud(handle, crs_wkt=None, epsg=None, proj4=None, crs_source=None, bounds_wgs84=None)
    url = f"{BASE}/{project_id}/pointclouds/{bare}"
    bad = client.patch(url, json={"assign_epsg": 999999})
    assert bad.status_code == 422 and bad.json()["error"]["code"] == "invalid_epsg"
    c = client.patch(url, json={"assign_epsg": 32639}).json()
    assert (c["epsg"], c["crs_source"]) == (32639, "assigned") and len(c["bounds_wgs84"]) == 4


def test_rename_and_captured_on(client, project_id, handle):
    cloud_id = insert_cloud(handle)
    url = f"{BASE}/{project_id}/pointclouds/{cloud_id}"
    c = client.patch(url, json={"name": "Stack", "captured_on": "2026-05-04"}).json()
    assert (c["name"], c["captured_on"]) == ("Stack", "2026-05-04")
    assert client.patch(url, json={"captured_on": None}).json()["captured_on"] is None
```

`backend/tests/test_pointcloud_startup.py`:

```python
"""The startup sweep (spec §3): interrupted imports fail, .work and partial octrees go."""

import pytest
from pointclouds import insert_cloud

from app.pointclouds import startup


@pytest.fixture
def project_kind() -> str:
    return "detect"


class Runner:
    def __init__(self, live=()):
        self.live = set(live)

    def is_live(self, job_id):
        return job_id in self.live


def test_interrupted_import_fails_and_its_folders_go(handle):
    dead = insert_cloud(handle, status="importing", job_id="j-dead")
    live = insert_cloud(handle, status="importing", job_id="j-live")
    ready = insert_cloud(handle)
    base = handle.folder / "pointclouds"
    for cid in (dead, live, ready):
        (base / cid / ".work").mkdir(parents=True)
        (base / cid / "octree").mkdir(parents=True)
    swept = startup.sweep_interrupted(handle, Runner(live=["j-live"]))
    assert swept == [dead]
    from app.pointclouds import rows

    d = rows.get_cloud(handle, dead)
    assert (d.status, d.error) == (
        "failed",
        "import interrupted by application restart; import the file again",
    )
    assert not (base / dead / ".work").exists() and not (base / dead / "octree").exists()
    assert (base / live / ".work").exists() and (base / live / "octree").exists()
    assert not (base / ready / ".work").exists() and (base / ready / "octree").exists()


def test_a_missing_folder_is_fine(handle):
    assert startup.sweep_interrupted(handle, Runner()) == []
```

- [ ] **Step 2: Run them to verify they fail**

Run: `cd backend; & $PY -m pytest tests/test_pointcloud_api.py tests/test_pointcloud_startup.py -v`
Expected: FAIL — 501 from the stubs; `ImportError` for `service`.

- [ ] **Step 3: Write `service.py`**

`backend/app/pointclouds/service.py`:

```python
"""Point clouds: rows, inspect, create, patch (link rules, assigned CRS), delete (spec §4, §6, §10)."""

from __future__ import annotations

import shutil
from collections.abc import Callable
from pathlib import Path

from sqlalchemy import select

from app.db.models import GeoMap, Job, PointCloud
from app.errors import AppError, not_found
from app.pointclouds import admission, converter_path, rows
from app.pointclouds.crs import bounds_wgs84, crs_from_epsg
from app.pointclouds.lasfile import HeaderInfo, UnsupportedCloud, inspect_file
from app.pointclouds.schemas import (
    PointCloudAdmission,
    PointCloudCreate,
    PointCloudFileInfo,
    PointCloudPatch,
)
from app.projects.service import ProjectHandle

LIVE = ("queued", "running")


def converter_installed() -> bool:
    return converter_path.converter_exe() is not None


def _file(path_text: str) -> Path:
    path = Path(path_text)
    if not path.is_file():
        # 404, not 422: a well-formed path that is not a file is a missing resource, and the
        # contract's positive-data-acceptance check forbids a 422 for a schema-valid body.
        raise not_found("point cloud file", str(path))
    return path


def _header(path: Path) -> HeaderInfo:
    try:
        return inspect_file(path)
    except UnsupportedCloud as e:
        raise AppError("unsupported_point_cloud", str(e), 422) from None


def _assess(handle: ProjectHandle, info: HeaderInfo) -> admission.Admission:
    return admission.assess(info.point_count, info.size, info.record_len, handle.pointclouds_dir)


def list_clouds(handle: ProjectHandle) -> list[PointCloud]:
    with handle.session() as s:
        items = list(s.execute(select(PointCloud).order_by(PointCloud.created_at.desc())).scalars())
        for c in items:
            s.expunge(c)
    return items


def inspect(handle: ProjectHandle, path_text: str) -> PointCloudFileInfo:
    path = _file(path_text)
    info = _header(path)
    adm = _assess(handle, info).as_dict()
    if not converter_installed():
        adm.update(ok=False, reason=converter_path.NOT_INSTALLED)
    return PointCloudFileInfo(
        path=str(path),
        size=info.size,
        compressed=info.compressed,
        las_version=info.las_version,
        point_format=info.point_format,
        point_count=info.point_count,
        has_rgb=info.has_rgb,
        header_bounds=info.header_bounds,
        crs_wkt=info.crs.crs_wkt,
        epsg=info.crs.epsg,
        captured_on=info.captured_on,
        admission=PointCloudAdmission(**adm),
    )


def overlaps(a: list[float], b: list[float]) -> bool:
    return a[0] < b[2] and b[0] < a[2] and a[1] < b[3] and b[1] < a[3]


def _map_for_link(s, map_id: str) -> GeoMap:
    gmap = s.get(GeoMap, map_id)
    if gmap is None:
        raise not_found("map", map_id)
    return gmap


def _check_link(gmap: GeoMap, cloud_crs_wkt: str | None, cloud_wgs84: list[float] | None) -> None:
    if not cloud_crs_wkt or not cloud_wgs84 or not gmap.crs_wkt or not gmap.bounds_wgs84:
        raise AppError(
            "link_needs_coordinates", "linking needs coordinates on both the cloud and the map", 422
        )
    if not overlaps(cloud_wgs84, gmap.bounds_wgs84):
        raise AppError("no_overlap", f"the map {gmap.name} does not overlap this cloud", 422)


def create_cloud(handle: ProjectHandle, body: PointCloudCreate) -> PointCloud:
    path = _file(body.path)
    info = _header(path)
    adm = _assess(handle, info)
    if not adm.ok:
        raise AppError(adm.code, adm.reason, 422)
    with handle.session() as s:
        if body.map_id:
            gmap = _map_for_link(s, body.map_id)
            header_wgs84 = bounds_wgs84(info.header_bounds, info.crs.crs_wkt) if info.crs.crs_wkt else None
            _check_link(gmap, info.crs.crs_wkt, header_wgs84)
        st = path.stat()
        row = PointCloud(
            name=body.name or path.stem,
            status="importing",
            source_path=str(path.resolve()),
            source_size=st.st_size,
            source_sha256="",
            source_mtime=st.st_mtime,
            las_version=info.las_version,
            point_format=info.point_format,
            point_count=info.point_count,
            has_rgb=info.has_rgb,
            scale=info.scale,
            map_id=body.map_id,
        )
        s.add(row)
        s.flush()
        s.expunge(row)
    return row


def set_job(handle: ProjectHandle, cloud_id: str, job_id: str) -> PointCloud:
    with handle.session() as s:
        row = s.get(PointCloud, cloud_id)
        row.job_id = job_id
        s.flush()
        s.expunge(row)
    return row


def patch_cloud(handle: ProjectHandle, cloud_id: str, body: PointCloudPatch) -> PointCloud:
    fields = body.model_fields_set
    with handle.session() as s:
        row = s.get(PointCloud, cloud_id)
        if row is None:
            raise not_found("point cloud", cloud_id)
        gmap = _map_for_link(s, body.map_id) if "map_id" in fields and body.map_id else None  # 404 first
        crs_wkt, wgs84 = row.crs_wkt, row.bounds_wgs84
        assigned = None
        if "assign_epsg" in fields and body.assign_epsg is not None:
            if row.crs_wkt:
                raise AppError(
                    "crs_already_set", "this cloud already has a coordinate system from its file", 422
                )
            try:
                assigned = crs_from_epsg(body.assign_epsg)
            except ValueError as e:
                raise AppError("invalid_epsg", str(e), 422) from None
            crs_wkt = assigned.crs_wkt
            wgs84 = bounds_wgs84(row.bounds_native, crs_wkt) if row.bounds_native else None
        if gmap is not None:
            _check_link(gmap, crs_wkt, wgs84)
        if assigned is not None:
            row.crs_wkt, row.epsg, row.proj4 = assigned.crs_wkt, assigned.epsg, assigned.proj4
            row.vertical_crs, row.crs_source, row.bounds_wgs84 = None, "assigned", wgs84
        if "map_id" in fields:
            row.map_id = body.map_id
        if "name" in fields and body.name:
            row.name = body.name
        if "captured_on" in fields:
            row.captured_on = body.captured_on
        s.flush()
        s.expunge(row)
    return row


def delete_cloud(handle: ProjectHandle, cloud_id: str, is_live: Callable[[str], bool]) -> None:
    with handle.session() as s:
        row = s.get(PointCloud, cloud_id)
        if row is None:
            raise not_found("point cloud", cloud_id)
        exports = s.execute(
            select(Job.id, Job.params).where(Job.type == "pointcloud_export", Job.state.in_(LIVE))
        ).all()
        job_ids = [row.job_id, *(j for j, params in exports if (params or {}).get("cloud_id") == cloud_id)]
        if any(j and is_live(j) for j in job_ids):
            raise AppError(
                "job_running", "the point cloud has an import or export running; cancel it first", 409
            )
        s.delete(row)  # measurements go with it (ON DELETE CASCADE)
    shutil.rmtree(rows.cloud_dir(handle, cloud_id), ignore_errors=True)
```

- [ ] **Step 4: Write the job body**

`backend/app/pointclouds/jobs_import.py` (whole module):

```python
"""The `pointcloud_import` job (spec §6): the pure pipeline, then the row."""

from __future__ import annotations

import shutil
from pathlib import Path

from app.db.models import PointCloud
from app.jobs.cancellation import JobCancelled, JobFailure
from app.jobs.registry import register_job_type
from app.jobs.runner import JobContext
from app.pointclouds.crs import bounds_wgs84
from app.pointclouds.importer import import_cloud
from app.pointclouds.rows import cloud_dir


def _fail(ctx: JobContext, cloud_id: str, message: str) -> None:
    with ctx.project.session() as s:
        row = s.get(PointCloud, cloud_id)
        if row is not None:
            row.status, row.error = "failed", message
    shutil.rmtree(cloud_dir(ctx.project, cloud_id), ignore_errors=True)
    ctx.publish("pointclouds.changed", {"cloud_ids": [cloud_id]})


@register_job_type("pointcloud_import")
def run_pointcloud_import(ctx: JobContext) -> dict:
    cloud_id = ctx.params["cloud_id"]
    with ctx.project.session() as s:
        source = Path(s.get(PointCloud, cloud_id).source_path)
    try:
        r = import_cloud(
            source,
            cloud_dir(ctx.project, cloud_id),
            progress=ctx.progress,
            check_cancelled=ctx.check_cancelled,
        )
    except JobCancelled:
        _fail(ctx, cloud_id, "import cancelled")
        raise
    except JobFailure as e:
        for line in getattr(e, "log_tail", []):  # ConverterStopped carries the converter's last lines
            ctx.log.error("converter: %s", line)
        _fail(ctx, cloud_id, str(e))
        raise
    except Exception as e:
        _fail(ctx, cloud_id, f"import failed: {type(e).__name__}: {e}")
        raise
    with ctx.project.session() as s:
        row = s.get(PointCloud, cloud_id)
        row.point_count, row.las_version, row.point_format = r.point_count, r.las_version, r.point_format
        row.has_rgb, row.scale = r.has_rgb, r.scale
        if r.crs.crs_wkt:
            row.crs_wkt, row.epsg, row.proj4, row.vertical_crs = (
                r.crs.crs_wkt,
                r.crs.epsg,
                r.crs.proj4,
                r.crs.vertical_crs,
            )
            row.crs_source, row.bounds_wgs84 = "file", r.bounds_wgs84
        elif row.crs_source == "assigned" and row.crs_wkt:
            row.bounds_wgs84 = bounds_wgs84(r.bounds_native, row.crs_wkt)
        row.bounds_native, row.bounds_repaired = r.bounds_native, r.bounds_repaired
        row.octree_spacing_m, row.octree_bytes = r.octree_spacing_m, r.octree_bytes
        row.z_stats, row.class_counts = r.z_stats, r.class_counts
        row.source_sha256, row.source_size, row.source_mtime = r.source_sha256, r.source_size, r.source_mtime
        if row.captured_on is None:  # never overwrite a date set by hand
            row.captured_on = r.captured_on
        row.status, row.error = "ready", None
    for line in r.log_tail:
        ctx.log.info("converter: %s", line)
    ctx.publish("pointclouds.changed", {"cloud_ids": [cloud_id]})
    ctx.progress(1.0, f"{r.point_count / 1e6:.1f} M points ready")
    return {
        "cloud_id": cloud_id,
        "point_count": r.point_count,
        "epsg": r.crs.epsg,
        "octree_bytes": r.octree_bytes,
        "seconds": r.seconds,
    }
```

- [ ] **Step 5: Fill the startup sweep and null links on map delete**

`backend/app/pointclouds/startup.py` (whole module):

```python
"""Imports a crash cut short (spec §3 "Startup sweep"). Each step logs and continues."""

from __future__ import annotations

import logging
import shutil

from sqlalchemy import select

from app.db.models import PointCloud
from app.projects.service import ProjectHandle

INTERRUPTED = "import interrupted by application restart; import the file again"
log = logging.getLogger(__name__)


def sweep_interrupted(handle: ProjectHandle, runner) -> list[str]:
    swept: list[str] = []
    live: set[str] = set()
    try:
        with handle.session() as s:
            for row in s.execute(select(PointCloud).where(PointCloud.status == "importing")).scalars():
                if row.job_id and runner.is_live(row.job_id):
                    live.add(row.id)
                    continue
                row.status, row.error = "failed", INTERRUPTED
                swept.append(row.id)
    except Exception:
        log.exception("could not mark interrupted point-cloud imports in project %s", handle.id)
    base = handle.pointclouds_dir
    for cloud_id in swept:
        shutil.rmtree(base / cloud_id / "octree", ignore_errors=True)
    try:
        if base.is_dir():
            for folder in base.iterdir():
                if folder.name not in live:
                    shutil.rmtree(folder / ".work", ignore_errors=True)
    except Exception:
        log.exception("could not sweep point-cloud work folders in project %s", handle.id)
    if swept:
        log.info("marked %d interrupted point-cloud import(s) failed in project %s", len(swept), handle.id)
    return swept
```

`backend/app/maps/service.py::delete_map` — inside the session, right before `s.delete(row)`:

```python
        # A cloud linked to this map loses the link (spec §3 `map_id`; ON DELETE SET NULL too).
        s.execute(update(PointCloud).where(PointCloud.map_id == map_id).values(map_id=None))
```

and add `update` to the `sqlalchemy` import and `PointCloud` to the `app.db.models` import.

- [ ] **Step 6: Write the routes and un-stub them**

`backend/app/pointclouds/routes_clouds.py`:

```python
"""Point-cloud routes (spec §4.1 ops 1-6)."""

from __future__ import annotations

from fastapi import APIRouter, Depends, Request, Response

from app.events_util import publish_pointclouds_changed
from app.jobs.schemas import JobOut
from app.pointclouds import rows, service
from app.pointclouds.jobs_import import run_pointcloud_import  # noqa: F401 - registers pointcloud_import
from app.pointclouds.schemas import (
    PointCloudCreate,
    PointCloudFileInfo,
    PointCloudInspectRequest,
    PointCloudList,
    PointCloudOut,
    PointCloudPatch,
    PointCloudWithJob,
)
from app.projects.service import ProjectHandle, get_project

sub = APIRouter()


@sub.get("/pointclouds", response_model=PointCloudList)
def list_point_clouds(handle: ProjectHandle = Depends(get_project)) -> PointCloudList:
    return PointCloudList(items=[PointCloudOut.from_row(c) for c in service.list_clouds(handle)])


@sub.post("/pointclouds", response_model=PointCloudWithJob, status_code=202)
def create_point_cloud(
    body: PointCloudCreate, request: Request, handle: ProjectHandle = Depends(get_project)
) -> PointCloudWithJob:
    row = service.create_cloud(handle, body)
    job = request.app.state.jobs.submit(handle, "pointcloud_import", {"cloud_id": row.id, "name": row.name})
    row = service.set_job(handle, row.id, job.id)
    publish_pointclouds_changed(request, handle, [row.id])
    return PointCloudWithJob(cloud=PointCloudOut.from_row(row), job=JobOut.from_row(job, handle.id))


@sub.post("/pointclouds/inspect", response_model=PointCloudFileInfo)
def inspect_point_cloud_file(
    body: PointCloudInspectRequest, handle: ProjectHandle = Depends(get_project)
) -> PointCloudFileInfo:
    return service.inspect(handle, body.path)


@sub.get("/pointclouds/{cloudId}", response_model=PointCloudOut)
def get_point_cloud(cloudId: str, handle: ProjectHandle = Depends(get_project)) -> PointCloudOut:  # noqa: N803
    return PointCloudOut.from_row(rows.get_cloud(handle, cloudId))


@sub.patch("/pointclouds/{cloudId}", response_model=PointCloudOut)
def patch_point_cloud(
    cloudId: str,  # noqa: N803
    body: PointCloudPatch,
    request: Request,
    handle: ProjectHandle = Depends(get_project),
) -> PointCloudOut:
    row = service.patch_cloud(handle, cloudId, body)
    publish_pointclouds_changed(request, handle, [cloudId])
    return PointCloudOut.from_row(row)


@sub.delete("/pointclouds/{cloudId}", status_code=204)
def delete_point_cloud(
    cloudId: str, request: Request, handle: ProjectHandle = Depends(get_project)
) -> Response:  # noqa: N803
    service.delete_cloud(handle, cloudId, request.app.state.jobs.is_live)
    publish_pointclouds_changed(request, handle, [cloudId])
    return Response(status_code=204)
```

In `router.py`: delete the six cloud tuples from `STUBS` (it now holds no S1 operation; keep `add_stubs(router, STUBS)` so the file stays the pattern F0 set), import `sub as cloud_routes` and append it to `SUB_ROUTERS`. In `tests/test_contract.py`: delete the six operationIds from `EXPECTED_STUBS`, and add to `REFUSES_VALID_DATA`:

```python
    "createPointCloud": {422},  # a readable path that is not LAS/LAZ, or refused by admission
    "inspectPointCloudFile": {422},  # a readable path that is not LAS/LAZ
    "patchPointCloud": {422},  # a link without overlap or coordinates, an unknown EPSG
```

- [ ] **Step 7: Run the tests to verify they pass**

Run: `cd backend; & $PY -m pytest tests/test_pointcloud_api.py tests/test_pointcloud_startup.py tests/test_maps_import.py tests/test_contract.py tests/test_project_kinds.py -v`
Expected: PASS.

- [ ] **Step 8: Gate and commit** (rebase after Tasks 10, 11 and 12)

```powershell
git add backend/app/pointclouds/service.py backend/app/pointclouds/routes_clouds.py backend/app/pointclouds/jobs_import.py backend/app/pointclouds/startup.py backend/app/maps/service.py backend/app/pointclouds/router.py backend/tests/test_contract.py backend/tests/test_pointcloud_api.py backend/tests/test_pointcloud_startup.py
git commit -m "feat(pointclouds): import job, cloud routes with inspect/admission, link rules, assigned CRS, startup sweep

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 15: `pointcloud-selftest`, the frozen smoke steps and the converter ADR (unit K2)

**Files:**
- Modify: `backend/app/pointclouds/selftest.py` (replace F0's placeholder; keep `main(argv)`)
- Modify: `backend/scripts/smoke_frozen.ps1` (the selftest line and one API step)
- Create: `vault/decisions/2026-09-23-potreeconverter-in-the-frozen-sidecar.md`
- Modify: `backend/tests/test_pointcloud_foundation.py` (F0's placeholder test: delete the `"pointcloud-selftest",` line from its parametrize)
- Test: `backend/tests/test_pointcloud_selftest.py`

**Interfaces:**
- Consumes: Task 2 `converter_path.converter_exe()`, `CONVERTER_VERSION`, the payload's `MANIFEST.json`; Task 3 `lasbounds.read_header_bounds/write_header_bounds`; Task 9 `importer.import_cloud`; Task 12 `export.write_laz`, `export.verify_laz`; F0's `__main__.py` dispatch (`main(argv[2:])`).
- Produces:
  - `selftest.FIXTURE_POINTS = 50_000`; `selftest.write_fixture(path, n=50_000) -> Path` (LAZ through lazrs: PF3 RGB, EPSG:32639 GeoKeys, red west / green east, header max X shrunk 0.3 mm); `selftest.verify_manifest(folder) -> int` (files checked; raises `SelftestError`); `selftest.run(tmp) -> dict`; `selftest.main(argv) -> int` printing `pointcloud ok 50000 32639 BROTLI laz 50000` (exit 0), `pointcloud FAIL <reason>` (exit 1), or `fixture ok <path>` for `--write-fixture <path>`.
  - `smoke_frozen.ps1` prints `pointcloud ok 50000 32639 BROTLI laz 50000` after `geo ok …`, and `cloud ok 50000 206` after the project step.
  - Task 18 calls `kestrel-backend.exe pointcloud-selftest --write-fixture <path>`.

- [ ] **Step 1: Write the failing tests**

`backend/tests/test_pointcloud_selftest.py`:

```python
"""pointcloud-selftest (spec §14): the fixture, the manifest check, the whole real path."""

import hashlib
import json

import laspy
import numpy as np
import pytest

from app.pointclouds import converter_path, selftest
from app.pointclouds.lasbounds import read_header_bounds


def test_the_fixture_is_a_pix4d_style_red_green_laz(tmp_path):
    path = selftest.write_fixture(tmp_path / "fixture.laz")
    with laspy.open(path) as r:
        assert r.header.are_points_compressed and r.header.point_count == 50_000
        assert r.header.point_format.id == 3 and r.header.parse_crs().to_epsg() == 32639
        las = r.read()
    x = np.asarray(las.x)
    assert x.max() - read_header_bounds(path)[3] == pytest.approx(0.0003, abs=1e-6)
    west = x < (x.min() + x.max()) / 2
    red, green = np.asarray(las.red), np.asarray(las.green)
    assert (red[west] == 65535).all() and (green[west] == 0).all()
    assert (green[~west] == 65535).all() and (red[~west] == 0).all()


def test_write_fixture_mode_prints_and_exits_0(tmp_path, capsys):
    assert selftest.main(["--write-fixture", str(tmp_path / "f.laz")]) == 0
    assert capsys.readouterr().out.strip() == f"fixture ok {tmp_path / 'f.laz'}"


def _payload(folder, files):
    folder.mkdir()
    entries = []
    for name, data in files.items():
        (folder / name).write_bytes(data)
        entries.append({"name": name, "size": len(data), "sha256": hashlib.sha256(data).hexdigest()})
    (folder / "MANIFEST.json").write_text(
        json.dumps({"converter_version": "2.1.5", "files": entries}), "utf-8"
    )


def test_manifest_verification(tmp_path):
    _payload(tmp_path / "ok", {"PotreeConverter.exe": b"MZ", "vcruntime140.dll": b"dll"})
    assert selftest.verify_manifest(tmp_path / "ok") == 2
    _payload(tmp_path / "bad", {"PotreeConverter.exe": b"MZ", "vcruntime140.dll": b"dll"})
    (tmp_path / "bad" / "vcruntime140.dll").write_bytes(b"tampered")
    with pytest.raises(selftest.SelftestError, match="vcruntime140.dll"):
        selftest.verify_manifest(tmp_path / "bad")
    _payload(tmp_path / "gone", {"msvcp140.dll": b"x"})
    (tmp_path / "gone" / "msvcp140.dll").unlink()
    with pytest.raises(selftest.SelftestError, match="msvcp140.dll is missing"):
        selftest.verify_manifest(tmp_path / "gone")


def test_a_failure_prints_fail_and_exits_1(monkeypatch, capsys):
    def no_converter(tmp):
        raise selftest.SelftestError("no converter")

    monkeypatch.setattr(selftest, "run", no_converter)
    assert selftest.main([]) == 1
    assert capsys.readouterr().out.strip() == "pointcloud FAIL SelftestError: no converter"


@pytest.mark.potreeconverter
@pytest.mark.skipif(converter_path.converter_exe() is None, reason="PotreeConverter payload not fetched")
def test_the_whole_real_path(capsys):
    assert selftest.main([]) == 0
    assert capsys.readouterr().out.strip().splitlines()[-1] == "pointcloud ok 50000 32639 BROTLI laz 50000"
```

- [ ] **Step 2: Run them to verify they fail**

Run: `cd backend; & $PY -m pytest tests/test_pointcloud_selftest.py -v`
Expected: FAIL — `AttributeError: module 'app.pointclouds.selftest' has no attribute 'write_fixture'`.

- [ ] **Step 3: Write the selftest**

`backend/app/pointclouds/selftest.py` (whole module):

```python
"""`kestrel-backend.exe pointcloud-selftest` (spec §14): the frozen-bundle check for point clouds.

1. Verifies MANIFEST.json's sha256 for every bundled converter file (the build machine has the MSVC
   runtime installed system-wide, so a missing DLL would otherwise go unnoticed).
2. Writes the fixture LAZ through lazrs: 50 000 points, PF3 RGB, EPSG:32639, red west / green east,
   header max X shrunk 0.3 mm (the Pix4D trap).
3. Runs the real `import_cloud` - work copy, hash, scan, CRS, repair, admission, the bundled
   converter through laszip.dll, validation - and 4. asserts the facts; 5. runs the real LAZ writer.

Prints `pointcloud ok 50000 32639 BROTLI laz 50000` and exits 0; anything else exits 1.
`--write-fixture <path>` only writes the fixture (for the packaged-webview check).
"""

from __future__ import annotations

import hashlib
import json
import tempfile
from pathlib import Path

NAME = "pointcloud-selftest"
FIXTURE_POINTS = 50_000
ORIGIN = (243_500.0, 3_178_000.0, 0.0)


class SelftestError(Exception):
    pass


def write_fixture(path: Path, n: int = FIXTURE_POINTS) -> Path:
    import laspy
    import numpy as np
    from pyproj import CRS

    from app.pointclouds.lasbounds import read_header_bounds, write_header_bounds

    rng = np.random.default_rng(0)
    xyz = np.asarray(ORIGIN) + rng.random((n, 3)) * np.array([100.0, 100.0, 10.0])
    header = laspy.LasHeader(point_format=3, version="1.2")
    header.scales = np.array([0.001, 0.001, 0.001])
    header.offsets = np.floor(xyz.min(axis=0))
    header.add_crs(CRS.from_epsg(32639))
    las = laspy.LasData(header)
    las.x, las.y, las.z = xyz[:, 0], xyz[:, 1], xyz[:, 2]
    west = xyz[:, 0] < ORIGIN[0] + 50.0
    las.red = np.where(west, 65535, 0).astype(np.uint16)
    las.green = np.where(west, 0, 65535).astype(np.uint16)
    las.blue = np.zeros(n, dtype=np.uint16)
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    las.write(path, do_compress=True, laz_backend=laspy.LazBackend.Lazrs)
    bounds = read_header_bounds(path)
    bounds[3] -= 0.0003  # the header misses the true max X by 0.3 mm, like Pix4D's
    write_header_bounds(path, bounds)
    return path


def verify_manifest(folder: Path) -> int:
    manifest = folder / "MANIFEST.json"
    if not manifest.is_file():
        raise SelftestError(f"no MANIFEST.json in {folder}")
    files = json.loads(manifest.read_text("utf-8"))["files"]
    for entry in files:
        f = folder / entry["name"]
        if not f.is_file():
            raise SelftestError(f"{entry['name']} is missing from {folder}")
        digest = hashlib.sha256(f.read_bytes()).hexdigest()
        if digest != entry["sha256"].lower():
            raise SelftestError(f"{entry['name']} does not match MANIFEST.json")
    return len(files)


def run(tmp: Path) -> dict:
    import laspy

    from app.pointclouds.converter_path import converter_exe
    from app.pointclouds.export import verify_laz, write_laz
    from app.pointclouds.importer import import_cloud

    exe = converter_exe()
    if exe is None:
        raise SelftestError("PotreeConverter.exe is not in the bundle")
    verify_manifest(exe.parent)
    fixture = write_fixture(tmp / "fixture.laz")
    result = import_cloud(fixture, tmp / "cloud", progress=lambda *_: None, check_cancelled=lambda: None)
    meta = json.loads((tmp / "cloud" / "octree" / "metadata.json").read_text("utf-8"))
    out = tmp / "export.laz"
    write_laz(
        fixture,
        out,
        bounds=result.bounds_native,
        scale=result.scale,
        assign_epsg=None,
        progress=lambda *_: None,
        check_cancelled=lambda: None,
    )
    verify_laz(out, point_count=result.point_count, epsg=result.crs.epsg)
    with laspy.open(out) as r:
        laz_points = int(r.header.point_count)
    return {
        "bounds_repaired": result.bounds_repaired,
        "epsg": result.crs.epsg,
        "points": meta["points"],
        "encoding": meta["encoding"],
        "laz_points": laz_points,
    }


def main(argv: list[str] | None = None) -> int:
    argv = list(argv or [])
    if argv[:1] == ["--write-fixture"] and len(argv) == 2:
        path = write_fixture(Path(argv[1]))
        print(f"fixture ok {path}", flush=True)
        return 0
    try:
        with tempfile.TemporaryDirectory(prefix="kestrel-pc-") as tmp:
            facts = run(Path(tmp))
        problems = []
        if not facts["bounds_repaired"]:
            problems.append("the header bounds were not repaired")
        if facts["epsg"] != 32639:
            problems.append(f"EPSG {facts['epsg']}")
        if facts["points"] != FIXTURE_POINTS or facts["laz_points"] != FIXTURE_POINTS:
            problems.append(f"{facts['points']} octree / {facts['laz_points']} LAZ points")
        if facts["encoding"] != "BROTLI":
            problems.append(f"encoding {facts['encoding']}")
        if problems:
            raise SelftestError("; ".join(problems))
    except Exception as e:
        print(f"pointcloud FAIL {type(e).__name__}: {e}", flush=True)
        return 1
    print(
        f"pointcloud ok {facts['points']} {facts['epsg']} {facts['encoding']} laz {facts['laz_points']}",
        flush=True,
    )
    return 0
```

F0's `app/__main__.py` already dispatches `pointcloud-selftest` to this `main(argv[2:])`; it is not touched. In F0's `backend/tests/test_pointcloud_foundation.py`, delete exactly this line from the parametrize of `test_selftest_placeholders_say_so_and_exit_2` (F0 writes one entry per line; S2 and S3 delete their own):

```python
        "pointcloud-selftest",
```

If the other two entries are already gone and the list is empty, pytest skips the test; that is expected.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd backend; & $PY -m pytest tests/test_pointcloud_selftest.py tests/test_pointcloud_foundation.py -v` (set `KESTREL_POTREECONVERTER` to the integration worktree's `backend\third_party\potreeconverter\PotreeConverter.exe` when running from a sub-worktree)
Expected: PASS, including `test_the_whole_real_path`.

- [ ] **Step 5: Add the frozen smoke steps**

In `backend/scripts/smoke_frozen.ps1`:

1. In the `.DESCRIPTION`, add `pointcloud ok 50000 32639 BROTLI laz 50000` after `geo ok …` and `cloud ok 50000 206` after `import ok …` in the list of printed lines.
2. Right after the `geo-selftest` block (`Complete-Step "geo"`):

```powershell
# PotreeConverter + laspy/lazrs inside the bundle (ADR 2026-09-23): the real import path on a fixture.
$pc = & $exe pointcloud-selftest 2>&1 | Out-String
if ($LASTEXITCODE -ne 0 -or $pc -notmatch "pointcloud ok 50000 32639 BROTLI laz 50000") { throw "pointcloud selftest failed: $pc" }
Write-Host ($pc.Trim().Split("`n")[-1])
Complete-Step "pointcloud"
```

3. Right after `Write-Host "import ok $($stats.image_count) images"` (the training project cannot write point clouds, so this step uses its own detection project):

```powershell
  # 5b. a point cloud through the API: import in a detection project, then a Range read of its octree
  $cloudsFolder = Join-Path $WorkDir "clouds-project"
  New-Item -ItemType Directory -Force $cloudsFolder | Out-Null
  $fixture = Join-Path $WorkDir "fixture.laz"
  $written = & $exe pointcloud-selftest --write-fixture $fixture 2>&1 | Out-String
  if ($LASTEXITCODE -ne 0) { throw "could not write the point-cloud fixture: $written" }
  $pcProject = Invoke-Api POST "/projects" @{ name = "Frozen smoke clouds"; folder = $cloudsFolder; classes = $classes; kind = "detect" }
  $created = Invoke-Api POST "/projects/$($pcProject.id)/pointclouds" @{ path = $fixture }
  $job = Wait-ApiJob "/projects/$($pcProject.id)/jobs" $created.job.id
  if ($job.state -ne "succeeded") { throw "point-cloud import failed: $($job.error)" }
  $cloud = Invoke-Api GET "/projects/$($pcProject.id)/pointclouds/$($created.cloud.id)"
  if ($cloud.status -ne "ready" -or $cloud.point_count -ne 50000) { throw "cloud not ready: $($cloud | ConvertTo-Json -Compress)" }
  # PowerShell 5.1 refuses a Range header in -Headers; HttpWebRequest.AddRange sets it properly.
  $rangeUrl = "$script:Base/api/v1/projects/$($pcProject.id)/pointclouds/$($cloud.id)/octree/hierarchy.bin"
  $req = [System.Net.HttpWebRequest]::Create($rangeUrl)
  $req.Headers.Add("Authorization", "Bearer $script:Token")
  $req.AddRange(0, 21)
  $resp = $req.GetResponse()
  $stream = $resp.GetResponseStream(); $buffer = New-Object byte[] 64; $read = 0
  while (($n = $stream.Read($buffer, $read, $buffer.Length - $read)) -gt 0) { $read += $n }
  $status = [int]$resp.StatusCode; $resp.Close()
  if ($status -ne 206 -or $read -ne 22) { throw "octree Range read gave $status with $read bytes" }
  Complete-Step "pointcloud_api"
  Write-Host "cloud ok $($cloud.point_count) $status"
```

- [ ] **Step 6: Freeze and smoke**

Run: `powershell -ExecutionPolicy Bypass -File backend\scripts\build.ps1 -Venv <worktree>\backend\.venv`, then `powershell -ExecutionPolicy Bypass -File backend\scripts\smoke_frozen.ps1`
Expected: among the output, `pointcloud ok 50000 32639 BROTLI laz 50000`, `cloud ok 50000 206` and finally `smoke ok`. Note the `bundle: … MB` line; compare with the same line from a build of `main` before Task 2 (it is in `docs/progress.md`'s last packaging entry, or build `main` once) — the difference goes into the ADR.

If the selftest fails with a `ModuleNotFoundError` for a laspy or lazrs submodule, add it to `hiddenimports` in `kestrel_backend.spec` next to F0's `collect_submodules("laspy")` / `"lazrs"` lines, and say so in the ADR (the rasterio precedent: ADR 2026-09-22).

- [ ] **Step 7: Write the converter ADR**

`vault/decisions/2026-09-23-potreeconverter-in-the-frozen-sidecar.md`:

```markdown
---
type: decision
date: 2026-09-23
status: accepted
tags: [adr, packaging, pointclouds, potreeconverter]
related: ["[[2026-09-23-point-clouds-design]]", "[[2026-09-22-rasterio-in-the-frozen-sidecar]]"]
---

# PotreeConverter inside the frozen sidecar

**Context.** Point clouds need a display copy (a Potree 2.0 octree) that the 3D viewer streams.
PotreeConverter 2.1.5 builds it in seconds (21.7 M points in 9 s, 195 M in 52 s on the spike); a
Python octree builder would take weeks to write and run slower. It is a native Windows exe.

**Decision.** `backend/scripts/fetch_potreeconverter.ps1` downloads the pinned release zip
(SHA-256 `a05bc3a9…6248`), takes `PotreeConverter.exe`, `laszip.dll` and `licenses/`, adds the four
MSVC runtime DLLs from the newest installed redist, proves the import closure with `dumpbin
/dependents`, **runs `PotreeConverter.exe --help` from that folder**, and writes `MANIFEST.json`.
`kestrel_backend.spec` ships the folder as **datas** into `_internal/potreeconverter/`, so
PyInstaller keeps the layout and never moves the DLLs away from the exe. `build.ps1` refuses to
build (and refuses the result) when any manifest file is missing. `kestrel-backend.exe
pointcloud-selftest` re-checks every sha256 and runs the real import on a fixture;
`smoke_frozen.ps1` runs it and one API import with a Range read.

**Traps this records.**

- *The zip lacks the MSVC runtime.* `msvcp140.dll`, `msvcp140_atomic_wait.dll`, `vcruntime140.dll`
  and `vcruntime140_1.dll` are not in the release zip.
- *The build machine masks it.* It has the runtime installed system-wide, so the converter runs
  there without the DLLs and fails on a clean machine. The dumpbin closure check, the `--help` run
  from the payload folder (a DLL next to the exe loads before System32) and the selftest's sha256
  check each catch it at build time.
- *Pix4D's header bounding box is 0.3 mm too small*, and PotreeConverter aborts with "encountered
  point outside bounding box". The import scans the work copy and writes the true bounds, widened
  by one scale step, at header byte 179; the source is never modified.
- *PotreeConverter drops the CRS.* The import parses it with laspy and stores it on the cloud.
- *Narrow-string argv.* The converter runs in the work folder with relative ASCII arguments only
  (`input.las -o octree`), so project paths with spaces or non-ASCII characters are safe.

**Consequences.** The bundle grows by the converter payload (about 4 MB) plus laspy and lazrs;
measured: <the `bundle:` line of this build> against <the `bundle:` line of the build before>.
A new MSVC toolset in a future PotreeConverter release shows up as a failed `--help` run in the
fetch script: pass `-CrtDir` with a newer redist.
```

Replace the two `<…>` spans with the two `bundle: … MB` lines from Step 6 before committing — they are measurements, not text to invent.

- [ ] **Step 8: Gate and commit**

```powershell
git add backend/app/pointclouds/selftest.py backend/scripts/smoke_frozen.ps1 backend/tests/test_pointcloud_selftest.py backend/tests/test_pointcloud_foundation.py vault/decisions/2026-09-23-potreeconverter-in-the-frozen-sidecar.md
git commit -m "feat(pointclouds): pointcloud-selftest, frozen smoke import with a Range read, converter ADR

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

(Also stage `backend/kestrel_backend.spec` if Step 6 needed a hidden import.)

---

### Task 16: The Measure tab (unit U2)

Load `impeccable` and `emil-design-eng` with `DESIGN.md` first.

**Files:**
- Create: `frontend/src/api/cloudMeasurements.ts`
- Create: `frontend/src/clouds/measure.ts`, `frontend/src/clouds/readout.ts`, `frontend/src/clouds/measureCsv.ts` (+ `.test.ts` each)
- Create: `frontend/src/clouds/useMeasureTool.ts`, `frontend/src/clouds/MeasurePanel.tsx` (+ `MeasurePanel.test.tsx`)
- Modify: `frontend/src/screens/CloudsScreen.tsx` (the Measure tab, the armed viewer, the overlay)
- Test: `frontend/e2e/clouds.spec.ts` (append spec §16 e2e 4)

**Interfaces:**
- Consumes: Task 6 `CloudViewerHandle.setOverlay/lookAt`, `CloudPick`, `OverlayShape`, `WARN_UNCERTAINTY_M`, `exampleCloud`; Task 11's `contract/fixtures/cloud-measure-vectors.json` and API; Task 13 `CloudsScreen` (`TABS`, `viewer` ref, `cloud`).
- Produces:
  - `api/cloudMeasurements.ts`: `type CloudMeasurement = S["CloudMeasurementOut"]`; `listCloudMeasurements(api, projectId, cloudId)`, `createCloudMeasurement(api, projectId, cloudId, body)`, `updateCloudMeasurement(api, projectId, cloudId, id, body)`, `deleteCloudMeasurement(api, projectId, cloudId, id)`.
  - `clouds/measure.ts`: `FIELDS`, `type MeasureKind`, `interface MPoint { x; y; z; uncertainty_m }`, `type Results`, `MIN_VERTICAL_SPAN_M`, `pointsNeeded(kind)`, `ordered(kind, pts)`, `results(kind, pts): Results`, `refusal(kind, pts, geographic): string | null`, `isGeographic(cloud)`, `overlayShapes(kind, picks, hover): OverlayShape[]`, `KIND_LABEL`.
  - `clouds/readout.ts`: `interface PickReadout { native: string; wgs84: string | null; zLabel: string; precision: string; warn: boolean }`; `makePickReadout(cloud): (p: CloudPick) => PickReadout`; `formatLength(m)`.
  - `clouds/measureCsv.ts`: `CSV_COLUMNS`, `measurementsCsv(items): string`.
  - `clouds/useMeasureTool.ts`: `useMeasureTool(): { tool, picks, hover, arm(kind), cancel(), add(p), setHover(p), complete }`.
  - `clouds/MeasurePanel.tsx`: `MeasurePanel({ projectId, cloud, tool: ReturnType<typeof useMeasureTool>, onFlyTo(p: MPoint) })`.

- [ ] **Step 1: Write the failing unit tests**

`frontend/src/clouds/measure.test.ts`:

```ts
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { exampleCloud } from "@/test/cloudFixtures";
import {
  FIELDS,
  isGeographic,
  overlayShapes,
  refusal,
  results,
  type MeasureKind,
  type MPoint,
} from "./measure";

const VECTORS = JSON.parse(
  readFileSync(resolve(__dirname, "../../../contract/fixtures/cloud-measure-vectors.json"), "utf8"),
) as {
  tolerance: number;
  fields: string[];
  cases: { name: string; kind: MeasureKind; points: MPoint[]; results: Record<string, number> }[];
};

describe("measurement formulas (the same vectors the backend reads)", () => {
  it("lists the fields in contract order", () => {
    expect([...FIELDS]).toEqual(VECTORS.fields);
  });

  it.each(VECTORS.cases.map((c) => [c.name, c] as const))("%s", (_name, c) => {
    const got = results(c.kind, c.points);
    for (const f of FIELDS) {
      const want = c.results[f];
      if (want === undefined) expect(got[f], f).toBeNull();
      else expect(Math.abs((got[f] as number) - want), f).toBeLessThanOrEqual(VECTORS.tolerance);
    }
  });

  it("previews the server's refusals", () => {
    const p = (z: number): MPoint => ({ x: 0, y: 0, z, uncertainty_m: 0 });
    expect(refusal("vertical", [p(0), p(0.3)], false)).toBe(
      "pick points further apart vertically (at least 0.5 m)",
    );
    expect(refusal("vertical", [p(0), p(3)], false)).toBeNull();
    expect(refusal("distance", [p(0), p(3)], true)).toBe(
      "distances need a projected coordinate system; this cloud is in degrees",
    );
    expect(refusal("point", [p(0)], true)).toBeNull();
  });

  it("knows a cloud in degrees", () => {
    expect(isGeographic(exampleCloud)).toBe(false);
    expect(isGeographic({ ...exampleCloud, proj4: "+proj=longlat +datum=WGS84 +no_defs" })).toBe(true);
    expect(isGeographic({ ...exampleCloud, proj4: null })).toBe(false);
  });

  it("draws the picks, the segment and the plumb line", () => {
    const a: MPoint = { x: 0, y: 0, z: 0, uncertainty_m: 0 };
    const b: MPoint = { x: 1, y: 0, z: 10, uncertainty_m: 0 };
    expect(overlayShapes("distance", [a, b], null).map((s) => s.kind)).toEqual(["points", "line"]);
    const v = overlayShapes("vertical", [b, a], null);
    expect(v.map((s) => s.kind)).toEqual(["points", "line", "line", "line"]);
    expect(v[2].points).toEqual([
      { x: 0, y: 0, z: 0 },
      { x: 0, y: 0, z: 10 },
    ]); // plumb through the lower pick
    expect(v[3].points).toEqual([
      { x: 0, y: 0, z: 10 },
      { x: 1, y: 0, z: 10 },
    ]); // the horizontal offset
    expect(overlayShapes("distance", [a], { ...b, level: 3 }).map((s) => s.kind)).toEqual(["points", "line"]);
  });
});
```

`frontend/src/clouds/readout.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { exampleCloud } from "@/test/cloudFixtures";
import { formatLength, makePickReadout } from "./readout";

const pick = { x: 243522.1234, y: 3178252.4567, z: -44.3211, level: 7, uncertainty_m: 0.032 };

describe("pick readout", () => {
  it("shows native coordinates to the millimetre and WGS84 to 8 decimals", () => {
    const r = makePickReadout(exampleCloud)(pick);
    expect(r.native).toBe("E 243522.123 · N 3178252.457 · Z -44.321 · EPSG:32639");
    expect(r.wgs84).toMatch(/^28\.\d{8}° N, 48\.\d{8}° E$/);
    expect(r.zLabel).toBe("Z as stored (no vertical datum)");
    expect(r.precision).toBe("point exact to 1 mm (file scale) · pick ± 3.2 cm at this zoom");
    expect(r.warn).toBe(false);
  });

  it("hides WGS84 without coordinates, names a vertical datum, warns above 10 cm", () => {
    const bare = makePickReadout({
      ...exampleCloud,
      proj4: null,
      epsg: null,
      crs_wkt: null,
      vertical_crs: null,
    });
    expect(bare({ ...pick, uncertainty_m: 0.2 }).wgs84).toBeNull();
    expect(bare({ ...pick, uncertainty_m: 0.2 }).warn).toBe(true);
    expect(bare({ ...pick, uncertainty_m: 0.2 }).precision).toBe(
      "point exact to 1 mm (file scale) · pick ± 20.0 cm at this zoom — zoom in to refine",
    );
    expect(makePickReadout({ ...exampleCloud, vertical_crs: "EGM96 height" })(pick).zLabel).toBe(
      "Z in EGM96 height",
    );
  });

  it("formats lengths", () => {
    expect(formatLength(0.001)).toBe("1 mm");
    expect(formatLength(0.032)).toBe("3.2 cm");
    expect(formatLength(13)).toBe("13.000 m");
  });
});
```

`frontend/src/clouds/measureCsv.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { CSV_COLUMNS, measurementsCsv } from "./measureCsv";

describe("measurements CSV", () => {
  it("writes the export's columns and quotes text", () => {
    const csv = measurementsCsv([
      {
        id: "m1",
        point_cloud_id: "c",
        kind: "distance",
        name: 'Gate, "north"',
        note: null,
        points: [
          { x: 1, y: 2, z: 3, uncertainty_m: 0.01 },
          { x: 4, y: 6, z: 3, uncertainty_m: 0.02 },
        ],
        results: {
          lon: null,
          lat: null,
          dx: 3,
          dy: 4,
          dz: 0,
          distance_3d: 5,
          distance_horizontal: 5,
          distance_vertical: 0,
          height_difference: 0,
          lean_offset_m: null,
          lean_angle_deg: null,
          lean_azimuth_deg: null,
          lean_mm_per_m: null,
          uncertainty_m: 0.0224,
          angle_uncertainty_deg: null,
        },
        created_at: "2026-09-24T10:00:00Z",
        updated_at: "2026-09-24T10:00:00Z",
      },
    ]);
    const [head, row] = csv.trim().split("\r\n");
    expect(head.split(",")).toEqual([...CSV_COLUMNS]);
    expect(
      row.startsWith('m1,"Gate, ""north""",distance,,1,2,3,0.01,4,6,3,0.02,,,3,4,0,5,5,0,0,,,,,0.0224,'),
    ).toBe(true);
  });
});
```

`frontend/src/clouds/MeasurePanel.test.tsx`:

```tsx
import { useEffect } from "react";
import { act, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { PointCloud } from "@/api/clouds";
import { fakeClient, PROJECT_ID } from "@/test/fixtures";
import { CLOUD_ID, exampleCloud } from "@/test/cloudFixtures";
import { renderWithProviders } from "@/test/render";
import { MeasurePanel } from "./MeasurePanel";
import { useMeasureTool, type MeasureTool } from "./useMeasureTool";

const saved = {
  id: "m1",
  point_cloud_id: CLOUD_ID,
  kind: "distance",
  name: "Distance 1",
  note: null,
  points: [
    { x: 0, y: 0, z: 0, uncertainty_m: 0.03 },
    { x: 3, y: 4, z: 12, uncertainty_m: 0.04 },
  ],
  results: { distance_3d: 13, uncertainty_m: 0.05 },
  created_at: "2026-09-24T10:00:00Z",
  updated_at: "2026-09-24T10:00:00Z",
};

/** The screen's wiring in miniature: one tool state shared by the panel and the test. */
function Harness({ cloud, onTool }: { cloud: PointCloud; onTool(t: MeasureTool): void }) {
  const tool = useMeasureTool();
  useEffect(() => {
    onTool(tool);
  });
  return <MeasurePanel projectId={PROJECT_ID} cloud={cloud} tool={tool} onFlyTo={vi.fn()} />;
}

describe("Measure panel", () => {
  it("measures a distance live and saves it", async () => {
    const { api, requests } = fakeClient([
      { method: "GET", path: /\/measurements$/, body: { items: [] } },
      { method: "POST", path: /\/measurements$/, status: 201, body: saved },
    ]);
    let tool: MeasureTool | null = null;
    renderWithProviders(<Harness cloud={exampleCloud} onTool={(t) => (tool = t)} />, { api });
    act(() => tool!.arm("distance"));
    act(() => tool!.add({ x: 0, y: 0, z: 0, level: 5, uncertainty_m: 0.03 }));
    act(() => tool!.add({ x: 3, y: 4, z: 12, level: 5, uncertainty_m: 0.04 }));
    expect(screen.getByText("13.000 m")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Save" }));
    const post = requests.find((r) => r.method === "POST");
    expect(post?.body).toEqual({
      kind: "distance",
      points: [
        { x: 0, y: 0, z: 0, uncertainty_m: 0.03 },
        { x: 3, y: 4, z: 12, uncertainty_m: 0.04 },
      ],
    });
    expect(await screen.findByText("Distance 1")).toBeInTheDocument();
  });

  it("says why distances are off on a cloud in degrees", () => {
    const { api } = fakeClient([{ method: "GET", path: /\/measurements$/, body: { items: [] } }]);
    const geographic = { ...exampleCloud, proj4: "+proj=longlat +datum=WGS84 +no_defs" };
    renderWithProviders(<Harness cloud={geographic} onTool={() => undefined} />, { api });
    expect(
      screen.getByText("distances need a projected coordinate system; this cloud is in degrees"),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Distance" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Point" })).toBeEnabled();
  });
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `pnpm -C frontend test -- src/clouds`
Expected: FAIL — cannot resolve `./measure`, `./readout`, `./measureCsv`, `./MeasurePanel`, `./useMeasureTool`.

- [ ] **Step 3: Write the API module and the pure modules**

`frontend/src/api/cloudMeasurements.ts`:

```ts
import type { ApiClient, components } from "@contract/client";
import { unwrap } from "./errors";

type S = components["schemas"];
export type CloudMeasurement = S["CloudMeasurementOut"];

const P = "/api/v1/projects/{projectId}/pointclouds/{cloudId}/measurements" as const;

export async function listCloudMeasurements(
  api: ApiClient,
  projectId: string,
  cloudId: string,
): Promise<CloudMeasurement[]> {
  return (await unwrap(api.GET(P, { params: { path: { projectId, cloudId } } }))).items;
}

export function createCloudMeasurement(
  api: ApiClient,
  projectId: string,
  cloudId: string,
  body: S["CloudMeasurementCreate"],
): Promise<CloudMeasurement> {
  return unwrap(api.POST(P, { params: { path: { projectId, cloudId } }, body }));
}

export function updateCloudMeasurement(
  api: ApiClient,
  projectId: string,
  cloudId: string,
  cloudMeasurementId: string,
  body: S["CloudMeasurementUpdate"],
): Promise<CloudMeasurement> {
  return unwrap(
    api.PATCH(`${P}/{cloudMeasurementId}`, {
      params: { path: { projectId, cloudId, cloudMeasurementId } },
      body,
    }),
  );
}

export async function deleteCloudMeasurement(
  api: ApiClient,
  projectId: string,
  cloudId: string,
  cloudMeasurementId: string,
): Promise<void> {
  await unwrap(
    api.DELETE(`${P}/{cloudMeasurementId}`, { params: { path: { projectId, cloudId, cloudMeasurementId } } }),
  );
}
```

`frontend/src/clouds/measure.ts`:

```ts
import type { PointCloud } from "@/api/clouds";
import type { Vec3 } from "./viewer/camera";
import type { OverlayShape } from "./viewer/overlay";

/** Spec §9.3, identical to backend/app/pointclouds/measure.py; both are pinned by
 * contract/fixtures/cloud-measure-vectors.json to 1e-9. */
export const FIELDS = [
  "lon",
  "lat",
  "dx",
  "dy",
  "dz",
  "distance_3d",
  "distance_horizontal",
  "distance_vertical",
  "height_difference",
  "lean_offset_m",
  "lean_angle_deg",
  "lean_azimuth_deg",
  "lean_mm_per_m",
  "uncertainty_m",
  "angle_uncertainty_deg",
] as const;
export type Field = (typeof FIELDS)[number];
export type Results = Record<Field, number | null>;
export type MeasureKind = "point" | "distance" | "height" | "vertical";
export interface MPoint {
  x: number;
  y: number;
  z: number;
  uncertainty_m: number;
}

export const MIN_VERTICAL_SPAN_M = 0.5;
export const KIND_LABEL: Record<MeasureKind, string> = {
  point: "Point",
  distance: "Distance",
  height: "Height difference",
  vertical: "Vertical check",
};

export const pointsNeeded = (kind: MeasureKind): 1 | 2 => (kind === "point" ? 1 : 2);

export function ordered<T extends { z: number }>(kind: MeasureKind, pts: T[]): T[] {
  return kind === "vertical" && pts.length === 2 && pts[1].z < pts[0].z ? [pts[1], pts[0]] : [...pts];
}

const deg = (r: number) => (r * 180) / Math.PI;

export function results(kind: MeasureKind, pts: MPoint[]): Results {
  const out = Object.fromEntries(FIELDS.map((f) => [f, null])) as Results;
  if (kind === "point") {
    out.uncertainty_m = pts[0].uncertainty_m;
    return out;
  }
  const [a, b] = ordered(kind, pts);
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const dz = b.z - a.z;
  const u = Math.sqrt(a.uncertainty_m ** 2 + b.uncertainty_m ** 2);
  const h = Math.hypot(dx, dy);
  Object.assign(out, {
    dx,
    dy,
    dz,
    distance_3d: Math.sqrt(dx * dx + dy * dy + dz * dz),
    distance_horizontal: h,
    distance_vertical: Math.abs(dz),
    height_difference: dz,
    uncertainty_m: u,
  });
  if (kind === "vertical") {
    const span = Math.abs(dz);
    Object.assign(out, {
      lean_offset_m: h,
      lean_angle_deg: deg(Math.atan2(h, span)),
      lean_azimuth_deg: (deg(Math.atan2(dx, dy)) + 360) % 360,
      lean_mm_per_m: (1000 * h) / span,
      angle_uncertainty_deg: deg(Math.atan(u / span)),
    });
  }
  return out;
}

export function isGeographic(cloud: Pick<PointCloud, "proj4">): boolean {
  return !!cloud.proj4 && /\+proj=longlat\b/.test(cloud.proj4);
}

/** What the server would refuse, said before Save (spec §9.3; Review Focus 4). */
export function refusal(kind: MeasureKind, pts: MPoint[], geographic: boolean): string | null {
  if (kind !== "point" && geographic)
    return "distances need a projected coordinate system; this cloud is in degrees";
  if (kind === "vertical" && pts.length === 2 && Math.abs(pts[1].z - pts[0].z) < MIN_VERTICAL_SPAN_M) {
    return "pick points further apart vertically (at least 0.5 m)";
  }
  return null;
}

const xyz = (p: Vec3): Vec3 => ({ x: p.x, y: p.y, z: p.z });

/** The 3D overlay: picks, the segment, and for a vertical check the plumb line through the lower
 * pick plus the horizontal offset at the upper pick's height (spec §9.1). */
export function overlayShapes(kind: MeasureKind, picks: MPoint[], hover: MPoint | null): OverlayShape[] {
  const shown = picks.length < pointsNeeded(kind) && hover ? [...picks, hover] : picks;
  if (shown.length === 0) return [];
  const shapes: OverlayShape[] = [{ kind: "points", points: shown.map(xyz), tone: "accent" }];
  if (shown.length < 2) return shapes;
  const [a, b] = kind === "vertical" ? ordered(kind, shown) : shown;
  shapes.push({ kind: "line", points: [xyz(a), xyz(b)], tone: "accent" });
  if (kind === "vertical") {
    const top = { x: a.x, y: a.y, z: b.z };
    shapes.push({ kind: "line", points: [xyz(a), top], tone: "ok" });
    shapes.push({ kind: "line", points: [top, xyz(b)], tone: "warn" });
  }
  return shapes;
}
```

`frontend/src/clouds/readout.ts`:

```ts
import proj4 from "proj4";
import type { PointCloud } from "@/api/clouds";
import type { CloudPick } from "./CloudViewer";
import { WARN_UNCERTAINTY_M } from "./viewer/uncertainty";

export interface PickReadout {
  native: string;
  wgs84: string | null;
  zLabel: string;
  precision: string;
  warn: boolean;
}

export function formatLength(m: number): string {
  if (m < 0.01) return `${Math.round(m * 1000)} mm`;
  if (m < 1) return `${(m * 100).toFixed(1)} cm`;
  return `${m.toFixed(3)} m`;
}

/** Spec §9.2: E/N/Z to the mm with EPSG, WGS84 to 8 decimals, the Z datum, and the precision line. */
export function makePickReadout(
  cloud: Pick<PointCloud, "epsg" | "proj4" | "scale" | "vertical_crs">,
): (p: CloudPick) => PickReadout {
  const toWgs84 = cloud.proj4 ? proj4(cloud.proj4, "EPSG:4326") : null;
  const fileScale = formatLength(Math.max(...(cloud.scale ?? [0.001])));
  return (p) => {
    let wgs84: string | null = null;
    if (toWgs84) {
      const [lon, lat] = toWgs84.forward([p.x, p.y]);
      wgs84 = `${Math.abs(lat).toFixed(8)}° ${lat >= 0 ? "N" : "S"}, ${Math.abs(lon).toFixed(8)}° ${lon >= 0 ? "E" : "W"}`;
    }
    const warn = p.uncertainty_m > WARN_UNCERTAINTY_M;
    return {
      native: `E ${p.x.toFixed(3)} · N ${p.y.toFixed(3)} · Z ${p.z.toFixed(3)}${cloud.epsg ? ` · EPSG:${cloud.epsg}` : ""}`,
      wgs84,
      zLabel: cloud.vertical_crs ? `Z in ${cloud.vertical_crs}` : "Z as stored (no vertical datum)",
      precision: `point exact to ${fileScale} (file scale) · pick ± ${formatLength(p.uncertainty_m)} at this zoom${warn ? " — zoom in to refine" : ""}`,
      warn,
    };
  };
}
```

`frontend/src/clouds/measureCsv.ts`:

```ts
import type { CloudMeasurement } from "@/api/cloudMeasurements";
import { FIELDS } from "./measure";

export const CSV_COLUMNS = [
  "id",
  "name",
  "kind",
  "note",
  "x1",
  "y1",
  "z1",
  "u1",
  "x2",
  "y2",
  "z2",
  "u2",
  ...FIELDS,
] as const;

const cell = (v: unknown): string => {
  if (v === null || v === undefined) return "";
  const s = String(v);
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

/** The same columns as the LAZ export's measurements.csv (spec §11). */
export function measurementsCsv(items: CloudMeasurement[]): string {
  const rows = items.map((m) => {
    const p = [...m.points, undefined, undefined].slice(0, 2);
    const coords = p.flatMap((q) => (q ? [q.x, q.y, q.z, q.uncertainty_m] : ["", "", "", ""]));
    const res = m.results as Record<string, number | null>;
    return [m.id, m.name, m.kind, m.note ?? "", ...coords, ...FIELDS.map((f) => res[f] ?? "")]
      .map(cell)
      .join(",");
  });
  return [CSV_COLUMNS.join(","), ...rows].join("\r\n") + "\r\n";
}
```

- [ ] **Step 4: Write the tool hook and the panel**

`frontend/src/clouds/useMeasureTool.ts`:

```ts
import { useCallback, useState } from "react";
import type { CloudPick } from "./CloudViewer";
import { pointsNeeded, type MeasureKind } from "./measure";

/** The armed tool and its picks. A click after a complete measurement starts a new one. */
export function useMeasureTool() {
  const [tool, setTool] = useState<MeasureKind | null>(null);
  const [picks, setPicks] = useState<CloudPick[]>([]);
  const [hover, setHover] = useState<CloudPick | null>(null);
  const arm = useCallback((kind: MeasureKind) => {
    setTool(kind);
    setPicks([]);
  }, []);
  const cancel = useCallback(() => {
    setTool(null);
    setPicks([]);
    setHover(null);
  }, []);
  const add = useCallback(
    (p: CloudPick) => {
      if (!tool) return;
      setPicks((ps) => (ps.length >= pointsNeeded(tool) ? [p] : [...ps, p]));
    },
    [tool],
  );
  const complete = tool !== null && picks.length === pointsNeeded(tool);
  return { tool, picks, hover, arm, cancel, add, setHover, complete };
}

export type MeasureTool = ReturnType<typeof useMeasureTool>;
```

`frontend/src/clouds/MeasurePanel.tsx`:

```tsx
import { useCallback, useEffect, useMemo, useState } from "react";
import { useApi } from "@/api/client";
import type { PointCloud } from "@/api/clouds";
import {
  createCloudMeasurement,
  deleteCloudMeasurement,
  listCloudMeasurements,
  updateCloudMeasurement,
  type CloudMeasurement,
} from "@/api/cloudMeasurements";
import { messageOf } from "@/api/errors";
import { Alert, Button, IconButton, Input, cx, toast } from "@/ui";
import {
  KIND_LABEL,
  isGeographic,
  refusal,
  results,
  type MeasureKind,
  type MPoint,
  type Results,
} from "./measure";
import { measurementsCsv } from "./measureCsv";
import { formatLength, makePickReadout } from "./readout";
import type { MeasureTool } from "./useMeasureTool";

const KINDS: MeasureKind[] = ["point", "distance", "height", "vertical"];
const HELP =
  "For inspection. A pick is a real point of the file, but the true surface point can be up to ± the pick uncertainty away; zoom in to shrink it. Volumes never come from the 3D view.";

function ResultRows({ kind, r }: { kind: MeasureKind; r: Results }) {
  const rows: [string, string][] =
    kind === "point"
      ? []
      : kind === "vertical"
        ? [
            ["Horizontal offset", formatLength(r.lean_offset_m ?? 0)],
            [
              "Lean",
              `${(r.lean_angle_deg ?? 0).toFixed(3)}° ± ${(r.angle_uncertainty_deg ?? 0).toFixed(3)}°`,
            ],
            ["Lean direction", `${(r.lean_azimuth_deg ?? 0).toFixed(1)}° from grid north`],
            ["Lean ratio", `${(r.lean_mm_per_m ?? 0).toFixed(1)} mm/m`],
            ["Height", formatLength(r.distance_vertical ?? 0)],
          ]
        : kind === "height"
          ? [
              [
                "Height difference",
                `${(r.height_difference ?? 0) >= 0 ? "+" : "−"}${formatLength(Math.abs(r.height_difference ?? 0))}`,
              ],
              ["Horizontal", formatLength(r.distance_horizontal ?? 0)],
            ]
          : [
              ["3D distance", formatLength(r.distance_3d ?? 0)],
              ["Horizontal", formatLength(r.distance_horizontal ?? 0)],
              ["Vertical", formatLength(r.distance_vertical ?? 0)],
            ];
  return (
    <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
      {rows.map(([k, v]) => (
        <div key={k} className="contents">
          <dt className="text-muted">{k}</dt>
          <dd className="text-right tabular-nums text-ink">{v}</dd>
        </div>
      ))}
      <dt className="text-muted">Uncertainty</dt>
      <dd className="text-right tabular-nums text-ink">± {formatLength(r.uncertainty_m ?? 0)}</dd>
    </dl>
  );
}

export function MeasurePanel({
  projectId,
  cloud,
  tool,
  onFlyTo,
}: {
  projectId: string;
  cloud: PointCloud;
  tool: MeasureTool;
  onFlyTo(p: MPoint): void;
}) {
  const api = useApi();
  const [items, setItems] = useState<CloudMeasurement[]>([]);
  const [error, setError] = useState<string | null>(null);
  const geographic = isGeographic(cloud);
  const readout = useMemo(() => makePickReadout(cloud), [cloud]);
  const reload = useCallback(() => {
    void listCloudMeasurements(api, projectId, cloud.id)
      .then(setItems)
      .catch((e: unknown) => setError(messageOf(e, "could not load the measurements")));
  }, [api, projectId, cloud.id]);
  useEffect(reload, [reload]);

  const points: MPoint[] = tool.picks.map((p) => ({
    x: p.x,
    y: p.y,
    z: p.z,
    uncertainty_m: p.uncertainty_m,
  }));
  const live = tool.complete && tool.tool ? results(tool.tool, points) : null;
  const blocked = tool.tool ? refusal(tool.tool, points, geographic) : null;
  const last = tool.picks[tool.picks.length - 1] ?? tool.hover;
  const r = last ? readout(last) : null;

  const save = () => {
    if (!tool.tool || !tool.complete || blocked) return;
    void createCloudMeasurement(api, projectId, cloud.id, { kind: tool.tool, points })
      .then((m) => {
        setItems((xs) => [...xs, m]);
        setError(null);
      })
      .catch((e: unknown) => setError(messageOf(e, "could not save the measurement")));
  };

  return (
    <div className="flex flex-col gap-4">
      {geographic && (
        <Alert tone="warn">distances need a projected coordinate system; this cloud is in degrees</Alert>
      )}
      <div className="grid grid-cols-2 gap-1.5" role="group" aria-label="Measuring tools">
        {KINDS.map((k) => (
          <Button
            key={k}
            size="sm"
            variant={tool.tool === k ? "primary" : "secondary"}
            aria-pressed={tool.tool === k}
            disabled={k !== "point" && geographic}
            onClick={() => (tool.tool === k ? tool.cancel() : tool.arm(k))}
          >
            {KIND_LABEL[k]}
          </Button>
        ))}
      </div>
      <p className="text-xs text-muted">
        {tool.tool
          ? `Click ${tool.tool === "point" ? "a point" : "two points"} in the view · Esc cancels`
          : HELP}
      </p>
      {r && (
        <div
          className="flex flex-col gap-0.5 rounded-md bg-well p-2.5 text-xs tabular-nums"
          data-testid="pick-readout"
        >
          <span className="text-ink">{r.native}</span>
          {r.wgs84 && <span className="text-muted">{r.wgs84}</span>}
          <span className="text-muted">{r.zLabel}</span>
          <span className={cx(r.warn ? "text-warn" : "text-muted")}>{r.precision}</span>
        </div>
      )}
      {live && tool.tool && <ResultRows kind={tool.tool} r={live} />}
      {blocked && tool.complete && <Alert tone="warn">{blocked}</Alert>}
      {error && <Alert tone="danger">{error}</Alert>}
      <Button variant="primary" disabled={!tool.complete || !!blocked} onClick={save}>
        Save
      </Button>
      <div className="flex items-center justify-between border-t border-line pt-3">
        <h3 className="text-sm font-semibold">Saved</h3>
        <Button
          size="sm"
          variant="ghost"
          disabled={items.length === 0}
          onClick={() =>
            void navigator.clipboard
              .writeText(measurementsCsv(items))
              .then(() => toast("ok", `Copied ${items.length} measurement${items.length === 1 ? "" : "s"}`))
              .catch(() => toast("danger", "could not copy to the clipboard"))
          }
        >
          Copy all as CSV
        </Button>
      </div>
      <ul className="flex flex-col gap-2" aria-label="Saved measurements">
        {items.map((m) => {
          const res = m.results as Results;
          const main =
            m.kind === "point"
              ? `E ${m.points[0].x.toFixed(3)} N ${m.points[0].y.toFixed(3)}`
              : m.kind === "vertical"
                ? `${(res.lean_angle_deg ?? 0).toFixed(3)}° lean`
                : m.kind === "height"
                  ? formatLength(Math.abs(res.height_difference ?? 0))
                  : formatLength(res.distance_3d ?? 0);
          return (
            <li key={m.id} className="flex flex-col gap-1 rounded-md border border-line p-2">
              <div className="flex items-center gap-1">
                <Input
                  dense
                  aria-label={`Name of ${m.name}`}
                  defaultValue={m.name}
                  onBlur={(e) =>
                    e.target.value.trim() &&
                    e.target.value !== m.name &&
                    void updateCloudMeasurement(api, projectId, cloud.id, m.id, {
                      name: e.target.value.trim(),
                    }).then((u) => setItems((xs) => xs.map((x) => (x.id === u.id ? u : x))))
                  }
                />
                <IconButton
                  icon="eye"
                  size="sm"
                  label={`Fly to ${m.name}`}
                  onClick={() => onFlyTo(m.points[m.points.length - 1] as MPoint)}
                />
                <IconButton
                  icon="trash"
                  size="sm"
                  label={`Delete ${m.name}`}
                  onClick={() =>
                    void deleteCloudMeasurement(api, projectId, cloud.id, m.id).then(() =>
                      setItems((xs) => xs.filter((x) => x.id !== m.id)),
                    )
                  }
                />
              </div>
              <span className="text-xs tabular-nums text-muted">
                {KIND_LABEL[m.kind]} · {main} · ± {formatLength(res.uncertainty_m ?? 0)}
              </span>
              <span className="hidden">{m.name}</span>
              <Input
                dense
                aria-label={`Note for ${m.name}`}
                placeholder="Note"
                defaultValue={m.note ?? ""}
                onBlur={(e) =>
                  e.target.value !== (m.note ?? "") &&
                  void updateCloudMeasurement(api, projectId, cloud.id, m.id, {
                    note: e.target.value || null,
                  }).then((u) => setItems((xs) => xs.map((x) => (x.id === u.id ? u : x))))
                }
              />
            </li>
          );
        })}
      </ul>
    </div>
  );
}
```

(The hidden `<span>` carries the name as text, so the list and the unit test can find a saved item by its name; the visible name is the rename field.)

- [ ] **Step 5: Mount the tab in the screen**

In `frontend/src/screens/CloudsScreen.tsx`:

1. Imports: `import { MeasurePanel } from "@/clouds/MeasurePanel";`, `import { overlayShapes } from "@/clouds/measure";`, `import { useMeasureTool } from "@/clouds/useMeasureTool";`.
2. `type Tab = "details" | "view" | "measure";` and append `{ value: "measure", label: "Measure" }` to `TABS`.
3. Inside the component, after the `settings` state: `const measure = useMeasureTool();`, and these effects:

```tsx
  // The overlay follows the tool (an effect that only talks to the viewer, never to React state).
  useEffect(() => {
    viewer.current?.setOverlay("measure", tab === "measure" && measure.tool ? overlayShapes(measure.tool, measure.picks, measure.hover) : []);
  }, [tab, measure.tool, measure.picks, measure.hover]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") measure.cancel();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [measure.cancel]);
```

4. Leaving the Measure tab puts the tool down in the tab's own handler (a `setState` in an effect would trip `react-hooks/set-state-in-effect`): change the Segmented's `onChange={setTab}` to `onChange={(t) => { setTab(t); if (t !== "measure") measure.cancel(); }}`.
5. On `<CloudViewer …>` add `armed={tab === "measure" && !!measure.tool}`, `onPick={(p) => tab === "measure" && measure.add(p)}` and `onHover={measure.setHover}`.
6. In the aside, after the View branch:

```tsx
            {tab === "measure" && (
              <MeasurePanel
                projectId={projectId}
                cloud={cloud}
                tool={measure}
                onFlyTo={(p) => viewer.current?.lookAt({ x: p.x, y: p.y, z: p.z }, 30)}
              />
            )}
```

- [ ] **Step 6: Run the unit tests to verify they pass**

Run: `pnpm -C frontend test -- src/clouds src/screens/CloudsScreen`
Expected: PASS.

- [ ] **Step 7: Write the e2e test** (spec §16 e2e 4)

Append to `frontend/e2e/clouds.spec.ts`:

```ts
test("measure a distance with two picks, save it, copy the CSV", async ({ page, context }) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  const saved: unknown[] = [];
  await jsonRoute(page, `/api/v1/projects/${P}/pointclouds`, { items: [cloudJson()] });
  await jsonRoute(page, `/api/v1/projects/${P}/pointclouds/${CLOUD}`, cloudJson());
  await routeOctree(
    page,
    CLOUD,
    buildOctree(redGreenGrid({ origin: [243500, 3178000, 0], size: 100, step: 1 })),
  );
  await page.route(
    (u) => u.pathname.endsWith(`/pointclouds/${CLOUD}/measurements`),
    async (route) => {
      if (route.request().method() === "POST") {
        const body = route.request().postDataJSON() as { kind: string; points: unknown[] };
        const m = {
          id: `m${saved.length + 1}`,
          point_cloud_id: CLOUD,
          kind: body.kind,
          name: `Distance ${saved.length + 1}`,
          note: null,
          points: body.points,
          results: { distance_3d: 12.5, uncertainty_m: 0.04 },
          created_at: "2026-09-24T10:00:00Z",
          updated_at: "2026-09-24T10:00:00Z",
        };
        saved.push(m);
        return route.fulfill({
          status: 201,
          contentType: "application/json",
          headers: { "Access-Control-Allow-Origin": "*" },
          body: JSON.stringify(m),
        });
      }
      return route.fulfill({
        contentType: "application/json",
        headers: { "Access-Control-Allow-Origin": "*" },
        body: JSON.stringify({ items: saved }),
      });
    },
  );
  await page.goto(`/p/${P}/clouds/${CLOUD}`);
  await expect.poll(async () => (await viewerStats(page))?.nodesLoading ?? 1, { timeout: 20_000 }).toBe(0);
  await page.getByRole("radio", { name: "Measure" }).click();
  await page.getByRole("button", { name: "Distance" }).click();
  const box = (await page.getByTestId("cloud-canvas").boundingBox())!;
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.click(box.x + box.width / 2 + 80, box.y + box.height / 2);
  await expect(page.getByText("3D distance")).toBeVisible();
  await expect(page.getByTestId("pick-readout")).toContainText("EPSG:32639");
  expect(await page.evaluate(() => window.__kestrelCloudViewer!.overlays())).toContain("measure");
  await page.getByRole("button", { name: "Save" }).click();
  await expect(page.getByRole("list", { name: "Saved measurements" })).toContainText("Distance 1");
  await page.getByRole("button", { name: "Copy all as CSV" }).click();
  const csv = await page.evaluate(() => navigator.clipboard.readText());
  expect(csv.split("\r\n")[0]).toBe(
    "id,name,kind,note,x1,y1,z1,u1,x2,y2,z2,u2,lon,lat,dx,dy,dz,distance_3d,distance_horizontal,distance_vertical,height_difference,lean_offset_m,lean_angle_deg,lean_azimuth_deg,lean_mm_per_m,uncertainty_m,angle_uncertainty_deg",
  );
});
```

Run: `pnpm -C frontend e2e -- clouds.spec.ts` (free ports)
Expected: PASS. The two clicks land on the fixture grid (1 m spacing, it fills the middle of the whole-site view); if a click returns no pick in a slow software-GL run, the readout stays empty — look at the trace before touching the picking code.

- [ ] **Step 8: Gate and commit**

```powershell
git add frontend/src/api/cloudMeasurements.ts frontend/src/clouds/measure.ts frontend/src/clouds/measure.test.ts frontend/src/clouds/readout.ts frontend/src/clouds/readout.test.ts frontend/src/clouds/measureCsv.ts frontend/src/clouds/measureCsv.test.ts frontend/src/clouds/useMeasureTool.ts frontend/src/clouds/MeasurePanel.tsx frontend/src/clouds/MeasurePanel.test.tsx frontend/src/screens/CloudsScreen.tsx frontend/e2e/clouds.spec.ts
git commit -m "feat(clouds): Measure tab - point, distance, height and vertical check with uncertainty, saved list, CSV

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 17: Jumps between the map and the 3D view (unit J1)

Load `impeccable` and `emil-design-eng` with `DESIGN.md` first. `MapsScreen.tsx` is shared with the detection workspace (review mode, site areas): every edit below is additive and leaves its existing behaviour alone.

**Files:**
- Create: `frontend/src/clouds/jump.ts` (+ `jump.test.ts`)
- Create: `frontend/src/clouds/useJumpArrival.ts`
- Create: `frontend/src/maps/MapContextMenu.tsx`, `frontend/src/maps/useAtMarker.ts`
- Modify: `frontend/src/screens/MapsScreen.tsx` (linked clouds, "Open in 3D" in the box popover, the right-click menu, `?at=` marker)
- Modify: `frontend/src/screens/CloudsScreen.tsx` (`?at=&fp=` arrival, the last pick, "Show on map")
- Modify: `frontend/src/clouds/CloudViewer.tsx` (`project()` returns client coordinates)
- Test: `frontend/e2e/clouds.spec.ts` (append spec §16 e2e 5 and 6)

**Interfaces:**
- Consumes: Task 6 `CloudViewerHandle`, `jumpDistance`, `Bounds6`, `Vec3`; Task 13 `listPointClouds`, `CloudsScreen` (`maps`, `viewer`, `cloud`); Task 16's `onPick` wiring; `@/maps/coords.pixelToNative`, `@/maps/grid.toOl/fromOl`; the existing `p/:projectId/maps/:mapId` route.
- Produces:
  - `clouds/jump.ts`: `interface XY { x: number; y: number }`; `parseAt(q: URLSearchParams): XY | null`; `parseFootprint(q): XY[] | null`; `jumpQuery(at, fp?): string` (`?at=x,y[&fp=x,y;…]`, 3 decimals); `nativeToPixel(gt, x, y): [number, number]`; `between(from, to): (p: XY) => XY` (identity when both carry the same EPSG); `mapPixelToCloud(map, cloud, px, py): XY`; `cloudToMapNative(cloud, map, p): XY`; `cloudsForMap(clouds, mapId): PointCloud[]` (ready, linked, with coordinates, newest first); `insideXY(bounds6, p): boolean`; `footprintDiagonal(fp): number`.
  - `clouds/useJumpArrival.ts`: `useJumpArrival(viewer, cloud, search): void`.
  - `maps/useAtMarker.ts`: `useAtMarker(olMap, geoMap, at): { outside: boolean }` (an `ol/Overlay` with `data-testid="map-at-marker"`).
  - `CloudViewerHandle.project(p)` now returns **client** (viewport) coordinates, ready for `pickAtClient`.

- [ ] **Step 1: Write the failing unit tests**

`frontend/src/clouds/jump.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import type { GeoMap } from "@contract/client";
import { exampleGeoMap } from "@/test/fixtures";
import { exampleCloud } from "@/test/cloudFixtures";
import { pixelToNative } from "@/maps/coords";
import {
  between,
  cloudToMapNative,
  cloudsForMap,
  footprintDiagonal,
  insideXY,
  jumpQuery,
  mapPixelToCloud,
  nativeToPixel,
  parseAt,
  parseFootprint,
} from "./jump";

const UTM39 = "+proj=utm +zone=39 +datum=WGS84 +units=m +no_defs";
const UTM38 = "+proj=utm +zone=38 +datum=WGS84 +units=m +no_defs";
const map: GeoMap = {
  ...exampleGeoMap,
  id: "m1",
  epsg: 32639,
  proj4: UTM39,
  geotransform: [243500, 0.05, 0.01, 3178100, 0.02, -0.05],
};
const cloud = { ...exampleCloud, epsg: 32639, proj4: UTM39 };

describe("3D jump URLs", () => {
  it("parses and writes at and fp", () => {
    const q = new URLSearchParams("at=243522.5,3178252.25&fp=1,2;3,4;5,6;7,8");
    expect(parseAt(q)).toEqual({ x: 243522.5, y: 3178252.25 });
    expect(parseFootprint(q)).toEqual([
      { x: 1, y: 2 },
      { x: 3, y: 4 },
      { x: 5, y: 6 },
      { x: 7, y: 8 },
    ]);
    expect(jumpQuery({ x: 1, y: 2 })).toBe("?at=1.000,2.000");
    expect(
      jumpQuery({ x: 1, y: 2 }, [
        { x: 3, y: 4 },
        { x: 5.5, y: 6 },
      ]),
    ).toBe("?at=1.000,2.000&fp=3.000,4.000;5.500,6.000");
    for (const bad of ["at=", "at=1", "at=a,b", "at=1,2,3"])
      expect(parseAt(new URLSearchParams(bad))).toBeNull();
    expect(parseFootprint(new URLSearchParams("fp=1,2;x,4"))).toBeNull();
  });

  it("inverts an affine with rotation terms", () => {
    const [x, y] = pixelToNative(map.geotransform!, 1234.5, 678.25);
    const [px, py] = nativeToPixel(map.geotransform!, x, y);
    expect(px).toBeCloseTo(1234.5, 6); // UTM magnitudes leave ~1e-9 px of float64 noise
    expect(py).toBeCloseTo(678.25, 6);
  });

  it("is the identity between entities in the same EPSG", () => {
    const [x, y] = pixelToNative(map.geotransform!, 100, 200);
    expect(mapPixelToCloud(map, cloud, 100, 200)).toEqual({ x, y });
  });

  it("round-trips 32639 <-> 32638 within a millimetre", () => {
    const there = between({ proj4: UTM39, epsg: 32639 }, { proj4: UTM38, epsg: 32638 });
    const back = between({ proj4: UTM38, epsg: 32638 }, { proj4: UTM39, epsg: 32639 });
    const p = { x: 243522.123, y: 3178252.456 };
    const q = back(there(p));
    expect(Math.hypot(q.x - p.x, q.y - p.y)).toBeLessThan(0.001);
    const onMap38 = cloudToMapNative(cloud, { ...map, epsg: 32638, proj4: UTM38 }, p);
    expect(Math.abs(onMap38.x - p.x)).toBeGreaterThan(1000); // really another zone
  });

  it("finds the ready clouds linked to a map, newest first, and tests bounds", () => {
    const a = { ...cloud, id: "a", map_id: "m1", created_at: "2026-09-01T00:00:00Z" };
    const b = { ...cloud, id: "b", map_id: "m1", created_at: "2026-09-02T00:00:00Z" };
    const busy = { ...cloud, id: "c", map_id: "m1", status: "importing" as const };
    const other = { ...cloud, id: "d", map_id: "m2" };
    expect(cloudsForMap([a, busy, other, b], "m1").map((c) => c.id)).toEqual(["b", "a"]);
    expect(insideXY([0, 0, 0, 10, 10, 10], { x: 5, y: 5 })).toBe(true);
    expect(insideXY([0, 0, 0, 10, 10, 10], { x: 11, y: 5 })).toBe(false);
    expect(
      footprintDiagonal([
        { x: 0, y: 0 },
        { x: 3, y: 0 },
        { x: 3, y: 4 },
        { x: 0, y: 4 },
      ]),
    ).toBe(5);
  });
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `pnpm -C frontend test -- src/clouds/jump`
Expected: FAIL — cannot resolve `./jump`.

- [ ] **Step 3: Write `jump.ts`**

`frontend/src/clouds/jump.ts`:

```ts
import proj4 from "proj4";
import type { GeoMap } from "@contract/client";
import type { PointCloud } from "@/api/clouds";
import { pixelToNative } from "@/maps/coords";

/** The 3D-jump URL contract (spec §2, §10): `?at=x,y[&fp=x,y;…]` in the destination's native CRS. */
export interface XY {
  x: number;
  y: number;
}

const NUM = /^-?\d+(\.\d+)?$/;
const pair = (s: string): XY | null => {
  const parts = s.split(",");
  return parts.length === 2 && NUM.test(parts[0]) && NUM.test(parts[1])
    ? { x: Number(parts[0]), y: Number(parts[1]) }
    : null;
};

export function parseAt(q: URLSearchParams): XY | null {
  const v = q.get("at");
  return v ? pair(v) : null;
}

export function parseFootprint(q: URLSearchParams): XY[] | null {
  const v = q.get("fp");
  if (!v) return null;
  const pts = v.split(";").map(pair);
  return pts.every((p): p is XY => p !== null) ? pts : null;
}

const f3 = (v: number) => v.toFixed(3);

export function jumpQuery(at: XY, fp?: XY[]): string {
  const base = `?at=${f3(at.x)},${f3(at.y)}`;
  return fp?.length ? `${base}&fp=${fp.map((p) => `${f3(p.x)},${f3(p.y)}`).join(";")}` : base;
}

/** The inverse of the GDAL geotransform, rotation terms included. */
export function nativeToPixel(gt: number[], x: number, y: number): [number, number] {
  const det = gt[1] * gt[5] - gt[2] * gt[4];
  const dx = x - gt[0];
  const dy = y - gt[3];
  return [(gt[5] * dx - gt[2] * dy) / det, (-gt[4] * dx + gt[1] * dy) / det];
}

type Georef = { proj4?: string | null; epsg?: number | null };

export function between(from: Georef, to: Georef): (p: XY) => XY {
  if ((from.epsg && from.epsg === to.epsg) || from.proj4 === to.proj4) return (p) => ({ x: p.x, y: p.y });
  const t = proj4(from.proj4!, to.proj4!);
  return (p) => {
    const [x, y] = t.forward([p.x, p.y]);
    return { x, y };
  };
}

export function mapPixelToCloud(
  map: GeoMap,
  cloud: Pick<PointCloud, "proj4" | "epsg">,
  px: number,
  py: number,
): XY {
  const [x, y] = pixelToNative(map.geotransform!, px, py);
  return between(map, cloud)({ x, y });
}

export function cloudToMapNative(
  cloud: Pick<PointCloud, "proj4" | "epsg">,
  map: Pick<GeoMap, "proj4" | "epsg">,
  p: XY,
): XY {
  return between(cloud, map)(p);
}

export function cloudsForMap(clouds: PointCloud[], mapId: string): PointCloud[] {
  return clouds
    .filter((c) => c.status === "ready" && c.map_id === mapId && c.proj4)
    .sort((a, b) => b.created_at.localeCompare(a.created_at));
}

export function insideXY(b: number[], p: XY): boolean {
  return p.x >= b[0] && p.x <= b[3] && p.y >= b[1] && p.y <= b[4];
}

export function footprintDiagonal(fp: XY[]): number {
  const xs = fp.map((p) => p.x);
  const ys = fp.map((p) => p.y);
  return Math.hypot(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys));
}
```

Run: `pnpm -C frontend test -- src/clouds/jump`
Expected: PASS.

- [ ] **Step 4: `project()` returns client coordinates**

In `frontend/src/clouds/CloudViewer.tsx`, `project` becomes:

```ts
      project(p) {
        const e = engine.current;
        const canvas = canvasRef.current;
        if (!e || !canvas) return null;
        const v = new THREE.Vector3(p.x, p.y, p.z).project(e.camera);
        if (v.z > 1 || v.z < -1) return null;
        const r = canvas.getBoundingClientRect();
        return { x: r.left + ((v.x + 1) / 2) * r.width, y: r.top + ((1 - v.y) / 2) * r.height };
      },
```

and its doc line in `CloudViewerHandle` reads `/** Client (viewport) coordinates of a native-CRS point, or null behind the camera. */`.

- [ ] **Step 5: Arrive in 3D**

`frontend/src/clouds/useJumpArrival.ts`:

```ts
import { useEffect, type RefObject } from "react";
import type { PointCloud } from "@/api/clouds";
import { toast } from "@/ui";
import type { CloudViewerHandle } from "./CloudViewer";
import { footprintDiagonal, insideXY, parseAt, parseFootprint } from "./jump";
import { jumpDistance } from "./viewer/camera";

const TICK_MS = 100;
const MAX_WAIT_TICKS = 300; // 30 s
const Z_REFINE_M = 2;

/**
 * Spec §10 "Arriving in 3D", once per navigation: outside the cloud → a toast; else look at
 * (x, y, p50) from 45° south at max(40 m, 3 × footprint diagonal), draw a vertical pin, and once
 * the view has settled pick at the pin: a hit within 2 m retargets Z and draws the footprint there.
 */
export function useJumpArrival(
  viewer: RefObject<CloudViewerHandle | null>,
  cloud: PointCloud | null,
  search: string,
): void {
  const cloudId = cloud?.status === "ready" ? cloud.id : null;
  useEffect(() => {
    if (!cloud || !cloudId || !cloud.bounds_native) return;
    const q = new URLSearchParams(search);
    const at = parseAt(q);
    if (!at) return;
    const fp = parseFootprint(q);
    const b = cloud.bounds_native;
    if (!insideXY(b, at)) {
      toast("info", "This spot is outside the cloud");
      return;
    }
    const z0 = cloud.z_stats?.p50 ?? (b[2] + b[5]) / 2;
    const distance = jumpDistance(fp ? footprintDiagonal(fp) : 0);
    let placed = false;
    let ticks = 0;
    const timer = window.setInterval(() => {
      const v = viewer.current;
      ticks += 1;
      if (!v || ticks > MAX_WAIT_TICKS) {
        if (ticks > MAX_WAIT_TICKS) window.clearInterval(timer);
        return;
      }
      const s = v.stats();
      if (!placed) {
        if (s.numVisiblePoints === 0) return; // the cloud is not loaded yet
        v.lookAt({ x: at.x, y: at.y, z: z0 }, distance);
        v.setOverlay("pin", [
          {
            kind: "line",
            points: [
              { x: at.x, y: at.y, z: b[2] },
              { x: at.x, y: at.y, z: b[5] },
            ],
            tone: "accent",
          },
        ]);
        placed = true;
        return;
      }
      if (s.nodesLoading > 0) return;
      window.clearInterval(timer);
      const screen = v.project({ x: at.x, y: at.y, z: z0 });
      const hit = screen ? v.pickAtClient(screen.x, screen.y) : null;
      if (hit && Math.hypot(hit.x - at.x, hit.y - at.y) <= Z_REFINE_M) {
        v.lookAt({ x: at.x, y: at.y, z: hit.z }, distance);
        if (fp)
          v.setOverlay("footprint", [
            { kind: "line", points: fp.map((p) => ({ x: p.x, y: p.y, z: hit.z })), closed: true, tone: "ok" },
          ]);
      }
    }, TICK_MS);
    return () => window.clearInterval(timer);
    // once per navigation: the search string and the cloud decide; the cloud object's identity does not
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [viewer, cloudId, search]);
}
```

In `frontend/src/screens/CloudsScreen.tsx`:

1. Imports: `useLocation` from `react-router-dom`; `useJumpArrival` from `@/clouds/useJumpArrival`; `cloudToMapNative` from `@/clouds/jump`; `type CloudPick` from `@/clouds/CloudViewer`.
2. In the component: `const location = useLocation();`, `useJumpArrival(viewer, cloud, location.search);`, and `const [lastPick, setLastPick] = useState<CloudPick | null>(null);`.
3. The viewer's pick handler records every pick: `onPick={(p) => { setLastPick(p); if (tab === "measure") measure.add(p); }}`.
4. Inside the centre `<section>`, after the viewer:

```tsx
            {(() => {
              const linkedMap = maps.find((m) => m.id === cloud?.map_id && m.proj4 && m.geotransform);
              if (!cloud || !lastPick || !linkedMap) return null;
              return (
                <div className="absolute bottom-10 right-3">
                  <Button
                    size="sm"
                    icon="map"
                    onClick={() => {
                      const q = cloudToMapNative(cloud, linkedMap, lastPick);
                      navigate(`/p/${projectId}/maps/${linkedMap.id}?at=${q.x.toFixed(3)},${q.y.toFixed(3)}`);
                    }}
                  >
                    Show on map
                  </Button>
                </div>
              );
            })()}
```

- [ ] **Step 6: Jump from the map**

`frontend/src/maps/useAtMarker.ts`:

```ts
import { useEffect, useMemo } from "react";
import type OlMap from "ol/Map";
import Overlay from "ol/Overlay";
import type { GeoMap } from "@contract/client";
import { nativeToPixel, type XY } from "@/clouds/jump";
import { toOl } from "./grid";

/** Spec §10 "3D to map": centre on `at` (map native CRS) at full resolution and drop a marker. */
export function useAtMarker(map: OlMap | null, geoMap: GeoMap | null, at: XY | null): { outside: boolean } {
  const pixel = useMemo(
    () => (geoMap?.geotransform && at ? nativeToPixel(geoMap.geotransform, at.x, at.y) : null),
    [geoMap, at],
  );
  const outside =
    !!pixel &&
    !!geoMap &&
    (pixel[0] < 0 || pixel[1] < 0 || pixel[0] > geoMap.width || pixel[1] > geoMap.height);
  useEffect(() => {
    if (!map || !pixel || outside) return;
    const el = document.createElement("div");
    el.dataset.testid = "map-at-marker";
    el.className = "h-4 w-4 rounded-full border-2 border-accent bg-accent/30";
    const marker = new Overlay({
      element: el,
      position: toOl(pixel[0], pixel[1]),
      positioning: "center-center",
      stopEvent: false,
    });
    map.addOverlay(marker);
    map.getView().setCenter(toOl(pixel[0], pixel[1]));
    map.getView().setResolution(1); // one map pixel per screen pixel
    return () => {
      map.removeOverlay(marker);
    };
  }, [map, pixel, outside]);
  return { outside };
}
```

`frontend/src/maps/MapContextMenu.tsx`:

```tsx
import { useEffect } from "react";
import type { PointCloud } from "@/api/clouds";
import { Button } from "@/ui";

export interface MapMenu {
  x: number;
  y: number;
  px: number;
  py: number;
}

/** The map's one-item right-click menu (spec §10): "Open this spot in 3D". */
export function MapContextMenu({
  menu,
  clouds,
  onOpen,
  onClose,
}: {
  menu: MapMenu;
  clouds: PointCloud[];
  onOpen(cloud: PointCloud): void;
  onClose(): void;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <div
      role="menu"
      aria-label="Map"
      className="absolute z-20 flex min-w-48 flex-col gap-0.5 rounded-md border border-line bg-panel p-1 shadow-float"
      style={{ left: menu.x, top: menu.y }}
    >
      {clouds.length === 0 ? (
        <p className="px-2 py-1.5 text-xs text-muted">Link a point cloud to this map to open spots in 3D.</p>
      ) : (
        clouds.map((c) => (
          <Button key={c.id} role="menuitem" size="sm" variant="ghost" icon="cloud" onClick={() => onOpen(c)}>
            {clouds.length === 1 ? "Open this spot in 3D" : `Open this spot in 3D: ${c.name}`}
          </Button>
        ))
      )}
    </div>
  );
}
```

In `frontend/src/screens/MapsScreen.tsx` (additive edits):

1. Imports: `listPointClouds, type PointCloud` from `@/api/clouds`; `cloudsForMap, jumpQuery, mapPixelToCloud, parseAt, type XY` from `@/clouds/jump`; `MapContextMenu, type MapMenu` from `@/maps/MapContextMenu`; `useAtMarker` from `@/maps/useAtMarker`.
2. State and data, next to the other state:

```tsx
  const [clouds, setClouds] = useState<PointCloud[]>([]);
  const [menu, setMenu] = useState<MapMenu | null>(null);
  useEffect(() => {
    if (readOnly) return;
    void listPointClouds(api, projectId)
      .then(setClouds)
      .catch(() => setClouds([])); // no clouds is a normal state; the jump simply is not offered
  }, [api, projectId, readOnly]);
```

3. After `const active = …`:

```tsx
  const linkedClouds = useMemo(
    () => (active?.geotransform && active.proj4 ? cloudsForMap(clouds, active.id) : []),
    [clouds, active],
  );
  const openIn3d = useCallback(
    (cloud: PointCloud, px: number, py: number, box?: BoxGeom) => {
      if (!active) return;
      const at = mapPixelToCloud(active, cloud, px, py);
      const fp: XY[] | undefined = box
        ? [
            [box.x, box.y],
            [box.x + box.w, box.y],
            [box.x + box.w, box.y + box.h],
            [box.x, box.y + box.h],
          ].map(([x, y]) => mapPixelToCloud(active, cloud, x, y))
        : undefined;
      navigate(`/p/${projectId}/clouds/${cloud.id}${jumpQuery(at, fp)}`);
    },
    [active, navigate, projectId],
  );
  const at = useMemo(() => parseAt(searchParams), [searchParams]);
  const { outside: atOutside } = useAtMarker(olMap, active, at);
  useEffect(() => {
    if (atOutside) toast("info", "This spot is outside the map");
  }, [atOutside]);
  useEffect(() => {
    if (!olMap) return;
    const viewport = olMap.getViewport();
    const onContext = (e: MouseEvent) => {
      e.preventDefault();
      const [px, py] = fromOl(olMap.getEventCoordinate(e));
      const r = viewport.getBoundingClientRect();
      setMenu({ x: e.clientX - r.left, y: e.clientY - r.top, px, py });
    };
    viewport.addEventListener("contextmenu", onContext);
    return () => viewport.removeEventListener("contextmenu", onContext);
  }, [olMap]);
```

4. The popover remembers its box: its state type becomes `{ x: number; y: number; facts: BoxFacts; box: BoxGeom } | null`, and the `singleclick` handler calls `setPopover({ x: e.pixel[0], y: e.pixel[1], facts: boxFacts(active, box, classes, confidence), box })`.
5. Inside the popover `<div>`, after its last `<p>`:

```tsx
                {linkedClouds.length > 0 && (
                  <div className="mt-1 flex flex-col gap-0.5 border-t border-line pt-1.5">
                    {linkedClouds.map((c) => (
                      <Button
                        key={c.id}
                        size="sm"
                        variant="ghost"
                        icon="cloud"
                        onClick={() => openIn3d(c, popover.box.x + popover.box.w / 2, popover.box.y + popover.box.h / 2, popover.box)}
                      >
                        {linkedClouds.length === 1 ? "Open in 3D" : `Open in 3D: ${c.name}`}
                      </Button>
                    ))}
                  </div>
                )}
```

6. Next to the popover, inside the same `<>` of the ready map:

```tsx
            {menu && (
              <MapContextMenu
                menu={menu}
                clouds={linkedClouds}
                onOpen={(c) => {
                  setMenu(null);
                  openIn3d(c, menu.px, menu.py);
                }}
                onClose={() => setMenu(null)}
              />
            )}
```

- [ ] **Step 7: Write the e2e tests** (spec §16 e2e 5 and 6)

Append to `frontend/e2e/clouds.spec.ts`:

```ts
const MAP = "a0000000-6666-4000-8000-000000000009";
const RUN = "r0000000-7777-4000-8000-000000000009";
const EXC = "c1a2b3c4-0000-4000-8000-000000000001";
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkaGhgAAAChACB8f3CzwAAAABJRU5ErkJggg==",
  "base64",
);
const siteMap = {
  id: MAP,
  name: "Chimney ortho",
  status: "ready",
  error: null,
  source_path: "D:/orthos/chimney.tif",
  source_size: 1,
  width: 2000,
  height: 2000,
  band_count: 3,
  dtype: "uint8",
  crs_wkt: 'PROJCRS["WGS 84 / UTM zone 39N"]',
  epsg: 32639,
  proj4: "+proj=utm +zone=39 +datum=WGS84 +units=m +no_defs",
  geotransform: [243500, 0.05, 0, 3178100, 0, -0.05],
  bounds_native: [243500, 3178000, 243600, 3178100],
  bounds_wgs84: [48.3744, 28.7038, 48.3755, 28.7048],
  gsd_cm: 5,
  tile_grid: { tile_size: 256, max_zoom: 3 },
  labels_version: 0,
  job_id: null,
  created_at: "2026-09-24T09:00:00Z",
  captured_on: "2026-05-04",
};
const siteRun = {
  id: RUN,
  map_id: MAP,
  kind: "local_model",
  model_id: "m0000000-2222-4000-8000-000000000001",
  provider: null,
  model_name: "machinery-v3",
  query: "",
  tile_size: 1280,
  overlap: 0.2,
  nms_iou: 0.5,
  conf: 0.25,
  target_gsd_cm: null,
  job_id: null,
  state: "succeeded",
  counts: { [EXC]: 1 },
  detection_count: 1,
  created_at: "2026-09-24T10:00:00Z",
};

async function mapRoutes(page: Page) {
  const cors = { "Access-Control-Allow-Origin": "*" };
  const j = (pattern: (u: URL) => boolean, body: unknown) =>
    page.route(pattern, (r) =>
      r.fulfill({ contentType: "application/json", headers: cors, body: JSON.stringify(body) }),
    );
  await page.route(
    (u) => u.pathname.includes(`/maps/${MAP}/tiles/`),
    (r) => r.fulfill({ contentType: "image/png", headers: cors, body: PNG }),
  );
  await j((u) => u.pathname === `/api/v1/projects/${P}/maps`, { items: [siteMap] });
  await j((u) => u.pathname.endsWith(`/maps/${MAP}/runs`), { items: [siteRun] });
  await j((u) => u.pathname.endsWith(`/maps/${MAP}/labels`), { items: [] });
  await j((u) => u.pathname.endsWith(`/maps/${MAP}/zones`), { items: [] });
  await j((u) => u.pathname.endsWith("/density"), {
    cell_size: 2000,
    cells: [{ gx: 0, gy: 0, class_id: EXC, count: 1 }],
  });
  // one big detection over the middle of the map: a click at the canvas centre lands on it
  await j((u) => u.pathname.endsWith("/detections"), {
    items: [{ id: "d1", class_id: EXC, confidence: 0.9, x: 900, y: 900, w: 200, h: 200, angle: null }],
    truncated: false,
  });
  await j((u) => u.pathname === `/api/v1/projects/${P}/pointclouds`, { items: [cloudJson({ map_id: MAP })] });
  await jsonRoute(page, `/api/v1/projects/${P}/pointclouds/${CLOUD}`, cloudJson({ map_id: MAP }));
  await routeOctree(
    page,
    CLOUD,
    buildOctree(redGreenGrid({ origin: [243500, 3178000, 0], size: 100, step: 1 })),
  );
}

test("a detection on the map opens the same spot in 3D, and a pick goes back to the map", async ({
  page,
}) => {
  await mapRoutes(page);
  await page.goto(`/p/${P}/maps/${MAP}`);
  await page.getByRole("checkbox", { name: /Show machinery-v3/ }).check();
  const mapBox = (await page.getByTestId("map-view").boundingBox())!;
  await page.mouse.click(mapBox.x + mapBox.width / 2, mapBox.y + mapBox.height / 2);
  await page.getByRole("button", { name: "Open in 3D" }).click();
  // box centre (1000, 1000) px -> 243500 + 1000 * 0.05, 3178100 - 1000 * 0.05
  await expect(page).toHaveURL(
    new RegExp(`/p/${P}/clouds/${CLOUD}\\?at=243550\\.000,3178050\\.000&fp=243545\\.000,3178055\\.000;`),
  );
  await expect
    .poll(() => page.evaluate(() => window.__kestrelCloudViewer?.overlays() ?? []), { timeout: 20_000 })
    .toContain("pin");
  const pick = await page.evaluate(() => window.__kestrelCloudViewer!.pickCenter());
  expect(Math.hypot(pick!.x - 243550, pick!.y - 3178050)).toBeLessThan(2);

  const canvas = (await page.getByTestId("cloud-canvas").boundingBox())!;
  await page.mouse.click(canvas.x + canvas.width / 2, canvas.y + canvas.height / 2);
  await page.getByRole("button", { name: "Show on map" }).click();
  await expect(page).toHaveURL(new RegExp(`/p/${P}/maps/${MAP}\\?at=243`));
  await expect(page.getByTestId("map-at-marker")).toBeVisible();
});

test("right-click on the map opens that spot in 3D; a spot outside the cloud says so", async ({ page }) => {
  await mapRoutes(page);
  await page.goto(`/p/${P}/maps/${MAP}`);
  const mapBox = (await page.getByTestId("map-view").boundingBox())!;
  await page.mouse.click(mapBox.x + mapBox.width / 2, mapBox.y + mapBox.height / 2, { button: "right" });
  await page.getByRole("menuitem", { name: "Open this spot in 3D" }).click();
  await expect(page).toHaveURL(new RegExp(`/p/${P}/clouds/${CLOUD}\\?at=`));
  await page.goto(`/p/${P}/clouds/${CLOUD}?at=100.000,200.000`);
  await expect(page.getByText("This spot is outside the cloud")).toBeVisible({ timeout: 20_000 });
});
```

(Add `type Page` to the `@playwright/test` import at the top of the file if it is not there yet.)

Run: `pnpm -C frontend e2e -- clouds.spec.ts maps.spec.ts pointcloud-foundation.spec.ts` (free ports)
Expected: PASS, and `maps.spec.ts` unchanged and green (the Maps screen's existing flows are untouched).

- [ ] **Step 8: Unit tests, gate and commit**

Run: `pnpm -C frontend test` and the full gate.

```powershell
git add frontend/src/clouds/jump.ts frontend/src/clouds/jump.test.ts frontend/src/clouds/useJumpArrival.ts frontend/src/clouds/CloudViewer.tsx frontend/src/maps/MapContextMenu.tsx frontend/src/maps/useAtMarker.ts frontend/src/screens/MapsScreen.tsx frontend/src/screens/CloudsScreen.tsx frontend/e2e/clouds.spec.ts
git commit -m "feat(clouds): map <-> 3D jumps - Open in 3D from a detection or a right-click, pin and Z refine, Show on map

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 18: The CSP directive, the packaged-webview check and the CSP ADR (unit W1)

**Files:**
- Modify: `frontend/src-tauri/tauri.conf.json` (`worker-src blob:`)
- Modify: `frontend/src/app/csp.test.ts`
- Create: `frontend/scripts/check-packaged-webview.ps1`, `frontend/scripts/check-packaged-webview.mjs`
- Modify: `frontend/package.json` (`check:webview`)
- Modify: `frontend/scripts/build-installer.ps1` (run the check before Inno Setup)
- Create: `vault/decisions/2026-09-23-gotcha-packaged-webview-needs-worker-src-blob.md`

**Interfaces:**
- Consumes: Task 15 `kestrel-backend.exe pointcloud-selftest --write-fixture`; Task 14 the import API; Task 10 octree serving; Task 13 the Clouds screen; Task 6 `window.__kestrelCloudViewer`; the existing `sidecar.rs` `APP_BACKEND_URL`/`APP_BACKEND_TOKEN` override.
- Produces:
  - `pnpm -C frontend check:webview` → prints `webview ok points=<n> red=<f> green=<f>` and exits 0, or `webview FAIL <reason>` and exits 1.
  - `check-packaged-webview.ps1 [-Cloud <las|laz>] [-Driver <mjs>] [-Budget <n>] [-Keep]`: starts the frozen backend, imports the cloud into a fresh detection project, launches the release exe with CDP on a free port and a temporary WebView2 profile, runs the driver with `KESTREL_CDP_PORT`, `KESTREL_PROJECT_ID`, `KESTREL_CLOUD_ID`, `KESTREL_BACKEND_URL`, `KESTREL_TOKEN`, `KESTREL_BUDGET`, `KESTREL_WEBVIEW_DIR`, `KESTREL_WORK_DIR` in its environment, then kills both trees and removes the temp dir. Task 19's measurement driver reuses it.

- [ ] **Step 1: Write the failing CSP tests**

Append to the `describe` in `frontend/src/app/csp.test.ts`:

```ts
it("lets potree-core start its inline blob workers (spec §13)", () => {
  expect(directive("worker-src")).toEqual(["blob:"]);
});

it("changes nothing else: default-src, script-src and connect-src stay as they were", () => {
  expect(directive("default-src")).toEqual(["'self'"]);
  expect(directive("script-src")).toEqual([]);
  expect(directive("connect-src")).toEqual([
    "'self'",
    "ipc:",
    "http://ipc.localhost",
    "http://127.0.0.1:*",
    "ws://127.0.0.1:*",
  ]);
  expect(conf.app.security.csp).not.toMatch(/unsafe-eval|wasm-unsafe-eval/);
});
```

Run: `pnpm -C frontend test -- src/app/csp`
Expected: FAIL — `worker-src` is `[]`.

- [ ] **Step 2: Add the directive**

In `frontend/src-tauri/tauri.conf.json`, append `; worker-src blob:` to `app.security.csp`, so it reads:

```
default-src 'self'; img-src 'self' http://127.0.0.1:* data: blob:; connect-src 'self' ipc: http://ipc.localhost http://127.0.0.1:* ws://127.0.0.1:*; style-src 'self' 'unsafe-inline'; worker-src blob:
```

Run: `pnpm -C frontend test -- src/app/csp`
Expected: PASS (4 tests).

- [ ] **Step 3: Write the check's orchestrator**

`frontend/scripts/check-packaged-webview.ps1`:

```powershell
<#
.SYNOPSIS
  Proves the packaged app's 3D viewer renders (spec §13). build-installer.ps1 runs it before Inno Setup.

.DESCRIPTION
  pnpm dev and tauri dev render point clouds even with a CSP that blanks the packaged app, so only a
  check on the packaged exe catches that trap. This script: refuses to run while Kestrel AI is open;
  starts the frozen backend on a free port with a temp app-data dir; writes the fixture LAZ (or takes
  -Cloud); imports it into a fresh detection project; launches the release exe against that backend
  (APP_BACKEND_URL/APP_BACKEND_TOKEN) with a CDP port and a temp WebView2 profile; runs the driver
  (check-packaged-webview.mjs by default); then kills both process trees and removes the temp dir.

.EXAMPLE
  pnpm -C frontend check:webview
#>
[CmdletBinding()]
param([string] $Cloud, [string] $Driver, [int] $Budget = 3000000, [switch] $Keep)

$ErrorActionPreference = "Stop"
$frontend = Split-Path $PSScriptRoot -Parent
if (-not $Driver) { $Driver = Join-Path $PSScriptRoot "check-packaged-webview.mjs" }
$backendExe = Join-Path $frontend "src-tauri\binaries\kestrel-backend-x86_64-pc-windows-msvc.exe"
$appExe = Join-Path $frontend "src-tauri\target\release\kestrel-ai.exe"
foreach ($p in @($backendExe, $appExe, $Driver)) {
  if (-not (Test-Path $p)) { throw "missing $p (freeze the backend with backend\scripts\build.ps1 and build the release app first)" }
}
if (Get-Process -Name "kestrel-ai" -ErrorAction SilentlyContinue) {
  throw "Kestrel AI is running; close it first (a WebView2 profile cannot be shared across different browser arguments)"
}

function Get-FreePort {
  $l = [System.Net.Sockets.TcpListener]::new([System.Net.IPAddress]::Loopback, 0); $l.Start()
  $port = $l.LocalEndpoint.Port; $l.Stop(); return $port
}

$T = Join-Path $env:TEMP ("kestrel-webview-" + [guid]::NewGuid().ToString("N").Substring(0, 8))
New-Item -ItemType Directory -Force $T, (Join-Path $T "appdata"), (Join-Path $T "project") | Out-Null
$token = -join ((48..57 + 65..90 + 97..122) | Get-Random -Count 32 | ForEach-Object { [char]$_ })
$backend = $null; $app = $null; $script:Base = $null

function Invoke-Api([string] $Method, [string] $Path, $Body) {
  $request = @{ Method = $Method; Uri = "$script:Base/api/v1$Path"; Headers = @{ Authorization = "Bearer $token" }; UseBasicParsing = $true; TimeoutSec = 900 }
  if ($null -ne $Body) { $request.Body = ($Body | ConvertTo-Json -Depth 8); $request.ContentType = "application/json" }
  $response = Invoke-WebRequest @request
  if ($response.Content) { return ($response.Content | ConvertFrom-Json) }
  return $null
}

try {
  $env:APP_TOKEN = $token; $env:APP_PORT = "0"; $env:APP_DATA_DIR = Join-Path $T "appdata"
  $stdout = Join-Path $T "stdout.txt"
  $backend = Start-Process -FilePath $backendExe -PassThru -WindowStyle Hidden -RedirectStandardOutput $stdout -RedirectStandardError (Join-Path $T "stderr.txt")
  $port = $null; $deadline = (Get-Date).AddSeconds(30)
  while ((Get-Date) -lt $deadline -and -not $port) {
    if ($backend.HasExited) { throw "the frozen backend exited with code $($backend.ExitCode)" }
    $line = Get-Content $stdout -ErrorAction SilentlyContinue | Where-Object { $_ -match '"port":\s*(\d+)' }
    if ($line) { $port = [int]$Matches[1] }
    Start-Sleep -Milliseconds 100
  }
  if (-not $port) { throw "the frozen backend printed no startup line within 30 s" }
  $script:Base = "http://127.0.0.1:$port"
  $deadline = (Get-Date).AddSeconds(20); $up = $false
  while ((Get-Date) -lt $deadline -and -not $up) { try { Invoke-Api GET "/health" | Out-Null; $up = $true } catch { Start-Sleep -Milliseconds 200 } }
  if (-not $up) { throw "the frozen backend did not answer /health" }

  if (-not $Cloud) {
    $Cloud = Join-Path $T "fixture.laz"
    $written = & $backendExe pointcloud-selftest --write-fixture $Cloud 2>&1 | Out-String
    if ($LASTEXITCODE -ne 0) { throw "could not write the fixture: $written" }
  }
  $project = Invoke-Api POST "/projects" @{ name = "Webview check"; folder = (Join-Path $T "project"); classes = @(@{ name = "excavator"; colour = "#f97316" }); kind = "detect" }
  $created = Invoke-Api POST "/projects/$($project.id)/pointclouds" @{ path = $Cloud }
  $deadline = (Get-Date).AddMinutes(30)
  do {
    Start-Sleep -Milliseconds 500
    $job = Invoke-Api GET "/projects/$($project.id)/jobs/$($created.job.id)"
  } while ($job.state -in @("queued", "running") -and (Get-Date) -lt $deadline)
  if ($job.state -ne "succeeded") { throw "the cloud import did not succeed: $($job.state) $($job.error)" }

  $cdp = Get-FreePort
  $env:APP_BACKEND_URL = $script:Base
  $env:APP_BACKEND_TOKEN = $token
  $env:WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS = "--remote-debugging-port=$cdp"
  $env:WEBVIEW2_USER_DATA_FOLDER = Join-Path $T "webview"
  $app = Start-Process -FilePath $appExe -PassThru
  $deadline = (Get-Date).AddSeconds(60); $cdpUp = $false
  while ((Get-Date) -lt $deadline -and -not $cdpUp) {
    try { Invoke-WebRequest -UseBasicParsing "http://127.0.0.1:$cdp/json/version" -TimeoutSec 1 | Out-Null; $cdpUp = $true } catch { Start-Sleep -Milliseconds 300 }
  }
  if (-not $cdpUp) { throw "the packaged app opened no CDP endpoint on $cdp within 60 s" }

  $env:KESTREL_CDP_PORT = "$cdp"; $env:KESTREL_PROJECT_ID = $project.id; $env:KESTREL_CLOUD_ID = $created.cloud.id
  $env:KESTREL_BACKEND_URL = $script:Base; $env:KESTREL_TOKEN = $token; $env:KESTREL_BUDGET = "$Budget"
  $env:KESTREL_WEBVIEW_DIR = Join-Path $T "webview"; $env:KESTREL_WORK_DIR = $T
  $ErrorActionPreference = "Continue"
  & node $Driver 2>&1 | ForEach-Object { "$_" }
  $code = $LASTEXITCODE
  $ErrorActionPreference = "Stop"
  if ($code -ne 0) { throw "the packaged-webview check failed (driver exit $code)" }
} finally {
  foreach ($p in @($app, $backend)) {
    if ($p -and -not $p.HasExited) { & taskkill /T /F /PID $p.Id 2>&1 | Out-Null }
  }
  foreach ($n in "APP_TOKEN", "APP_PORT", "APP_DATA_DIR", "APP_BACKEND_URL", "APP_BACKEND_TOKEN", "WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS", "WEBVIEW2_USER_DATA_FOLDER", "KESTREL_CDP_PORT", "KESTREL_PROJECT_ID", "KESTREL_CLOUD_ID", "KESTREL_BACKEND_URL", "KESTREL_TOKEN", "KESTREL_BUDGET", "KESTREL_WEBVIEW_DIR", "KESTREL_WORK_DIR") {
    Remove-Item "Env:$n" -ErrorAction SilentlyContinue
  }
  if ($Keep) { Write-Host "work dir kept: $T" } else { Start-Sleep -Seconds 1; Remove-Item $T -Recurse -Force -ErrorAction SilentlyContinue }
}
```

- [ ] **Step 4: Write the CDP driver**

`frontend/scripts/check-packaged-webview.mjs`:

```js
// The packaged-webview check's driver (spec §13 step 6-7). Run by check-packaged-webview.ps1, which
// sets KESTREL_* in the environment. Imports chromium from @playwright/test (a direct dependency).
import { chromium } from "@playwright/test";

const env = process.env;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const fail = (reason) => {
  console.log(`webview FAIL ${reason}`);
  process.exit(1);
};
const CSP = /Content Security Policy|Refused to/;

const browser = await chromium.connectOverCDP(`http://127.0.0.1:${env.KESTREL_CDP_PORT}`);
const context = browser.contexts()[0];
let page = context.pages()[0];
for (let i = 0; !page && i < 100; i += 1) {
  await sleep(100);
  page = context.pages()[0];
}
if (!page) fail("the packaged app has no page");

const csp = [];
const octree = [];
page.on("console", (m) => CSP.test(m.text()) && csp.push(m.text()));
const cdp = await context.newCDPSession(page);
await cdp.send("Log.enable");
await cdp.send("Runtime.enable");
await cdp.send("Network.enable");
cdp.on("Log.entryAdded", (e) => CSP.test(e.entry.text) && csp.push(e.entry.text));
cdp.on("Network.responseReceived", (e) => {
  if (e.response.url.includes("/octree/") && e.response.status >= 400)
    octree.push(`${e.response.status} ${e.response.url}`);
});
cdp.on("Network.loadingFailed", (e) => {
  if (e.canceled) return;
  octree.push(
    `loadingFailed ${e.errorText}${e.blockedReason ? ` blocked:${e.blockedReason}` : ""}${e.corsErrorStatus ? ` cors:${e.corsErrorStatus.corsError}` : ""}`,
  );
});

await page.waitForFunction(() => document.readyState === "complete", null, { timeout: 30_000 });
await page.evaluate(
  (budget) => {
    localStorage.setItem("kestrel.diagnostics", "1");
    localStorage.setItem("kestrel.clouds.pointBudget", String(budget));
  },
  Number(env.KESTREL_BUDGET ?? 3000000),
);
await page.evaluate((path) => {
  history.pushState({}, "", path);
  dispatchEvent(new PopStateEvent("popstate"));
}, `/p/${env.KESTREL_PROJECT_ID}/clouds/${env.KESTREL_CLOUD_ID}`);

let stats = null;
const deadline = Date.now() + 30_000;
while (Date.now() < deadline) {
  stats = await page.evaluate(() => window.__kestrelCloudViewer?.stats() ?? null);
  if (stats && stats.numVisiblePoints > 0 && stats.nodesLoading === 0) break;
  await sleep(250);
}
if (csp.length) fail(`CSP: ${csp[0]}`);
if (!stats) fail("the viewer never mounted (no diagnostics hook)");
if (!(stats.numVisiblePoints > 0 && stats.nodesLoading === 0))
  fail(`no settled points after 30 s: ${JSON.stringify(stats)}`);
if (octree.length) fail(`octree request failed: ${octree[0]}`);

const colours = await page.evaluate(() => window.__kestrelCloudViewer.sampleColours());
const red = colours.red / colours.total;
const green = colours.green / colours.total;
if (red < 0.01 || green < 0.01)
  fail(
    `colours: red=${red.toFixed(4)} green=${green.toFixed(4)} white=${colours.white} (the white-colour trap paints every point white)`,
  );

const cloud = await (
  await fetch(
    `${env.KESTREL_BACKEND_URL}/api/v1/projects/${env.KESTREL_PROJECT_ID}/pointclouds/${env.KESTREL_CLOUD_ID}`,
    {
      headers: { Authorization: `Bearer ${env.KESTREL_TOKEN}` },
    },
  )
).json();
const pick = await page.evaluate(() => window.__kestrelCloudViewer.pickCenter());
const b = cloud.bounds_native;
if (
  !pick ||
  pick.x < b[0] ||
  pick.x > b[3] ||
  pick.y < b[1] ||
  pick.y > b[4] ||
  pick.z < b[2] - 1 ||
  pick.z > b[5] + 1
) {
  fail(`pickCenter ${JSON.stringify(pick)} is not inside the cloud ${JSON.stringify(b)}`);
}
console.log(`webview ok points=${stats.numVisiblePoints} red=${red.toFixed(3)} green=${green.toFixed(3)}`);
process.exit(0);
```

`frontend/package.json` `scripts`: add `"check:webview": "powershell -NoProfile -ExecutionPolicy Bypass -File scripts/check-packaged-webview.ps1"`.

`frontend/scripts/build-installer.ps1` — after `if (-not (Test-Path $appExe)) { throw … }` and before the WebView2 bootstrapper block:

```powershell
# The packaged 3D viewer must render (spec §13; ADR 2026-09-23 "packaged webview needs worker-src
# blob:"). pnpm dev and tauri dev hide a blank viewer; only the release exe shows it. No installer
# is built when the check fails.
& powershell -NoProfile -ExecutionPolicy Bypass -File (Join-Path $PSScriptRoot "check-packaged-webview.ps1")
if ($LASTEXITCODE -ne 0) { throw "the packaged-webview check failed; no installer was built (the reason is above)" }
```

Also add a line to its `.DESCRIPTION`: "Before Inno Setup it runs check-packaged-webview.ps1, which needs Kestrel AI closed."

- [ ] **Step 5: Run the check on a real release build**

Run (from `frontend`): `pnpm tauri build --no-bundle` (with the Task 15 frozen sidecar in `src-tauri/binaries`), then `pnpm check:webview`
Expected: `webview ok points=… red=0.… green=0.…`, exit 0, and no `kestrel-ai.exe`/`kestrel-backend*.exe` left running.

- [ ] **Step 6: The negative proof (once)**

1. Remove `; worker-src blob:` from `tauri.conf.json`; run `pnpm tauri build --no-bundle`; run `pnpm check:webview`.
   Expected: `webview FAIL CSP: Refused to create a worker from 'blob:…' because it violates the following Content Security Policy directive: …` (or `no settled points after 30 s` with `nodesLoading: 1` if the CSP line is not surfaced first; either way exit 1). Save the full output.
2. Run `pnpm build:installer -SkipTauriBuild` with that broken build.
   Expected: it throws "the packaged-webview check failed; no installer was built" and no new `Kestrel AI_*_x64-setup.exe` appears in `src-tauri\target\release\bundle\inno`.
3. Restore the directive (`git checkout frontend/src-tauri/tauri.conf.json`, which is committed with it after Step 8 — until then, re-add it by hand), rebuild, rerun `pnpm check:webview` → `webview ok …`.

- [ ] **Step 7: Write the CSP ADR**

`vault/decisions/2026-09-23-gotcha-packaged-webview-needs-worker-src-blob.md`:

```markdown
---
type: decision
date: 2026-09-23
status: accepted
tags: [adr, gotcha, csp, webview2, pointclouds, packaging]
related: ["[[2026-09-23-point-clouds-design]]", "[[2026-09-20-gotcha-tauri-capability-allowlist-is-runtime]]"]
---

# The packaged webview needs `worker-src blob:` (and dev hides it)

**Trap.** potree-core 2.0.15 decodes octree nodes in inline workers it creates from `blob:` URLs.
The app's CSP (`default-src 'self'`) has no `worker-src`, so it falls back to `default-src` and the
packaged WebView2 refuses the worker. Nothing errors in the UI: the viewer stays blank,
`nodesLoading` is stuck at 1, and the violation is only in the console. `pnpm dev` and
`tauri dev` render fine with the old CSP, because the dev server's page is not under the packaged
CSP — so every test outside the packaged exe passes.

**Decision.** `tauri.conf.json` gains exactly one directive, `worker-src blob:` — no
`'unsafe-eval'`, no `'wasm-unsafe-eval'`, no new origins (`src/app/csp.test.ts` pins that).

**Two neighbours of the same trap.**

- The loader sends `Range` and `content-type: multipart/byteranges`, which makes every octree
  request a CORS preflight. The backend's `CORSMiddleware` allows `Range` and exposes
  `Content-Range`, `Accept-Ranges` and `Content-Length` (F0; `tests/test_cors.py`).
- Colours need `inputColorEncoding = outputColorEncoding = 1`, or every RGB point renders pure
  white (`makeMaterialOptions()`, pinned by a unit test).
- The URL passed to `loadPointCloud` must end in `metadata.json`: potree-core picks its Potree 2
  loader with `endsWith("metadata.json")`, so the token goes on through `RequestManager.getUrl`.

**The permanent guard.** `frontend/scripts/check-packaged-webview.{ps1,mjs}` (`pnpm check:webview`)
starts the frozen backend, imports a red/green fixture, launches the release exe over CDP, and
fails unless points render with both colours, no CSP line appears, no octree request fails, and a
centre pick lands inside the cloud. `build-installer.ps1` runs it before Inno Setup: a blank viewer
means no installer.

**Negative proof** (Task 18 Step 6):

- without `worker-src blob:` — <the `webview FAIL …` line from Step 6.1>
- `build:installer` on that build — <the throw line from Step 6.2>
- with it — <the `webview ok …` line from Step 6.3>
```

Replace the three `<…>` spans with the actual output lines of Step 6 (measurements, not text to invent).

- [ ] **Step 8: Gate and commit**

Run the full gate, plus `pnpm -C frontend build:installer` (it now includes the check).

```powershell
git add frontend/src-tauri/tauri.conf.json frontend/src/app/csp.test.ts frontend/scripts/check-packaged-webview.ps1 frontend/scripts/check-packaged-webview.mjs frontend/package.json frontend/scripts/build-installer.ps1 vault/decisions/2026-09-23-gotcha-packaged-webview-needs-worker-src-blob.md
git commit -m "fix(packaging): worker-src blob: for the 3D viewer, and a packaged-webview check that blocks the installer

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 19: Acceptance on the real file, evidence, docs and the merge (unit G)

This task measures; it writes one new script (the viewer measurement driver) and the documents. Every number in spec §17 is produced by a command below and saved under `docs/evidence/2026-09-24-point-clouds/`.

**Files:**
- Create: `frontend/scripts/measure-cloud-viewer.mjs`
- Create: `docs/evidence/2026-09-24-point-clouds/` (JSON results, logs, screenshots)
- Create: `docs/usability/2026-09-24-point-clouds-walkthrough.md`
- Modify: `docs/progress.md` (ledger entry at the top)
- Test: the whole gate; `backend/tests/test_pointcloud_api.py::test_195m_points_refused_with_4_gb_free` (added in Task 14) is spec §17.3's check.

**Interfaces:**
- Consumes: everything above; `backend/scripts/{make_test_ortho,check_picks,make_tiled_cloud,pointcloud_acceptance}.py` (Task 7); `check-packaged-webview.ps1 -Cloud -Driver -Budget` (Task 18).
- Produces: `measure-cloud-viewer.mjs` (modes `perf`, `picks`, `uncertainty` from `KESTREL_MODE`; writes `KESTREL_OUT` JSON and screenshots into `KESTREL_SHOTS`).

**The real file** (from the brief; it is not in the spec): `\\DanNas\Work Data\Inspections\Kuwait\Chemney Stack POC\I2 3D Modeling\Chimney stack 3D\Chimney stack 3D\2_densification\point_cloud\Chimney stack 3D_group1_densified_point_cloud.las` (21 697 184 points, 738 MB, LAS 1.2, EPSG:32639). Only ever read.

- [ ] **Step 1: Bring the integration branch up to date and gate it**

In `.claude/worktrees/pointclouds`: every sub-worktree is merged and removed (`git worktree list` shows none of `pc-t*`). `git fetch; git rebase main` (resolve nothing silently: a conflict with S2/S3 work on `main` is read and resolved by keeping both sides). Then the full gate with the overlay `$PY` (Global Constraints), including `& $PY -m pytest -m potreeconverter` with the payload present.
Expected: all green; `EXPECTED_STUBS` holds no S1 operationId.

- [ ] **Step 2: Write the measurement driver**

`frontend/scripts/measure-cloud-viewer.mjs`:

```js
// Acceptance measurements on the packaged viewer (spec §17.6, 17.7, 17.9, 17.10). Run through
// check-packaged-webview.ps1 -Driver, which starts the backend and the app and sets KESTREL_*.
// KESTREL_MODE: perf (default) | picks | uncertainty. Results go to KESTREL_OUT as JSON.
import { chromium } from "@playwright/test";
import { execFile } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const env = process.env;
const mode = env.KESTREL_MODE ?? "perf";
const out = env.KESTREL_OUT ?? path.join(env.KESTREL_WORK_DIR, `measure-${mode}.json`);
const shots = env.KESTREL_SHOTS ?? env.KESTREL_WORK_DIR;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const api = (p, init = {}) =>
  fetch(`${env.KESTREL_BACKEND_URL}/api/v1/projects/${env.KESTREL_PROJECT_ID}${p}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${env.KESTREL_TOKEN}`,
      "Content-Type": "application/json",
      ...(init.headers ?? {}),
    },
  }).then((r) => r.json());

function webviewBytes() {
  // WebView2 processes of this run only: their command line carries the temp user-data folder.
  const dir = env.KESTREL_WEBVIEW_DIR.replace(/'/g, "''");
  const ps = `(Get-CimInstance Win32_Process -Filter "Name='msedgewebview2.exe'" | Where-Object { $_.CommandLine -like '*${dir}*' } | Measure-Object -Property WorkingSetSize -Sum).Sum`;
  return new Promise((resolve) =>
    execFile("powershell", ["-NoProfile", "-Command", ps], (_e, stdout) =>
      resolve(Number(String(stdout).trim()) || 0),
    ),
  );
}

const browser = await chromium.connectOverCDP(`http://127.0.0.1:${env.KESTREL_CDP_PORT}`);
const context = browser.contexts()[0];
const page = context.pages()[0];
await page.waitForFunction(() => document.readyState === "complete", null, { timeout: 30_000 });
await page.evaluate((b) => {
  localStorage.setItem("kestrel.diagnostics", "1");
  localStorage.setItem("kestrel.clouds.pointBudget", String(b));
}, Number(env.KESTREL_BUDGET));
const cloud = await api(`/pointclouds/${env.KESTREL_CLOUD_ID}`);
const go = (search = "") =>
  page.evaluate((p) => {
    history.pushState({}, "", p);
    dispatchEvent(new PopStateEvent("popstate"));
  }, `/p/${env.KESTREL_PROJECT_ID}/clouds/${env.KESTREL_CLOUD_ID}${search}`);
const stats = () => page.evaluate(() => window.__kestrelCloudViewer?.stats() ?? null);
async function settle(timeoutMs = 60_000) {
  const t0 = Date.now();
  let s = null;
  let quietSince = null;
  while (Date.now() - t0 < timeoutMs) {
    s = await stats();
    const quiet = s && s.numVisiblePoints > 0 && s.nodesLoading === 0;
    quietSince = quiet ? (quietSince ?? Date.now()) : null;
    if (quietSince && Date.now() - quietSince > 1500) return s;
    await sleep(100);
  }
  return s;
}
const canvasCentre = async () => {
  const b = await page.getByTestId("cloud-canvas").boundingBox();
  return { x: b.x + b.width / 2, y: b.y + b.height / 2, w: b.width, h: b.height };
};
const result = {
  mode,
  budget: Number(env.KESTREL_BUDGET),
  cloud: { id: cloud.id, points: cloud.point_count },
};

if (mode === "perf") {
  let peak = 0;
  let sampling = true;
  const sampler = (async () => {
    while (sampling) {
      peak = Math.max(peak, await webviewBytes());
      await sleep(500);
    }
  })();
  await go();
  const s = await settle();
  result.firstPointsMs = s.firstPointsMs;
  result.settledMs = s.settledMs;
  result.points = s.numVisiblePoints;
  await page.screenshot({ path: path.join(shots, `viewer-${result.budget / 1e6}M-site.png`) });
  const c = await canvasCentre();
  await page.evaluate(() => {
    window.__frames = [];
    window.__framing = true;
    const f = (t) => {
      window.__frames.push(t);
      if (window.__framing) requestAnimationFrame(f);
    };
    requestAnimationFrame(f);
  });
  await page.mouse.move(c.x, c.y);
  await page.mouse.down();
  const t0 = Date.now();
  for (let i = 0; Date.now() - t0 < 10_000; i += 1) {
    await page.mouse.move(c.x + Math.sin(i / 20) * c.w * 0.3, c.y + Math.cos(i / 35) * c.h * 0.05);
    await sleep(16);
  }
  await page.mouse.up();
  const deltas = await page.evaluate(() => {
    window.__framing = false;
    const f = window.__frames;
    return f
      .slice(1)
      .map((t, i) => t - f[i])
      .sort((a, b) => a - b);
  });
  result.orbitFrames = deltas.length;
  result.orbitP50Ms = deltas[Math.floor(deltas.length * 0.5)];
  result.orbitP95Ms = deltas[Math.floor(deltas.length * 0.95)];
  await settle();
  const colours = await page.evaluate(() => window.__kestrelCloudViewer.sampleColours());
  result.colours = colours;
  result.whiteShareOfPoints = colours.white / Math.max(1, colours.total - colours.background);
  sampling = false;
  await sampler;
  result.webviewPeakGB = +(peak / 1e9).toFixed(2);
  await page.screenshot({ path: path.join(shots, `viewer-${result.budget / 1e6}M-after-orbit.png`) });
}

if (mode === "picks") {
  const b = cloud.bounds_native;
  const cx = (b[0] + b[3]) / 2;
  const cy = (b[1] + b[4]) / 2;
  const spots = env.KESTREL_SPOTS
    ? JSON.parse(env.KESTREL_SPOTS)
    : [-1, 0, 1].flatMap((i) => [-1, 0, 1].map((j) => [cx + i * 15, cy + j * 15])).concat([[cx + 5, cy - 7]]);
  result.picks = [];
  for (const [x, y] of spots.slice(0, 10)) {
    await go(`?at=${x.toFixed(3)},${y.toFixed(3)}`);
    await settle();
    await sleep(3000); // the jump's Z refine
    await settle();
    const p = await page.evaluate(() => window.__kestrelCloudViewer.pickCenter());
    if (!p) continue;
    const m = await api(`/pointclouds/${env.KESTREL_CLOUD_ID}/measurements`, {
      method: "POST",
      body: JSON.stringify({
        kind: "point",
        points: [{ x: p.x, y: p.y, z: p.z, uncertainty_m: p.uncertainty_m }],
      }),
    });
    result.picks.push({ at: [x, y], pick: p, measurement: m.id });
  }
  await page.screenshot({ path: path.join(shots, "viewer-picks.png") });
}

if (mode === "uncertainty") {
  const [rx, ry] = env.KESTREL_RIM.split(",").map(Number);
  await go(`?at=${rx.toFixed(3)},${ry.toFixed(3)}`);
  await settle();
  await sleep(3000);
  const c = await canvasCentre();
  await page.mouse.move(c.x, c.y);
  const b = cloud.bounds_native;
  const diagonal = Math.hypot(b[3] - b[0], b[4] - b[1], b[5] - b[2]);
  for (let i = 0; i < 60 && (await stats()).cameraDistance < 0.8 * diagonal; i += 1) {
    await page.mouse.wheel(0, 400);
    await sleep(50);
  }
  const far = await settle();
  const siteWide = await page.evaluate(() => window.__kestrelCloudViewer.pickCenter());
  await page.screenshot({ path: path.join(shots, "uncertainty-site.png") });
  for (let i = 0; i < 200 && (await stats()).cameraDistance > 30; i += 1) {
    await page.mouse.wheel(0, -200);
    await sleep(50);
  }
  const near = await settle();
  const close = await page.evaluate(() => window.__kestrelCloudViewer.pickCenter());
  await page.screenshot({ path: path.join(shots, "uncertainty-close.png") });
  result.siteWide = { cameraDistance: far.cameraDistance, pick: siteWide };
  result.close = { cameraDistance: near.cameraDistance, pick: close };
  result.ratio = siteWide && close ? siteWide.uncertainty_m / close.uncertainty_m : null;
}

fs.writeFileSync(out, JSON.stringify(result, null, 2));
console.log(`measure ${mode} ok ${out}`);
process.exit(0);
```

- [ ] **Step 3: Build everything and run the packaged checks**

From the integration worktree: `powershell -ExecutionPolicy Bypass -File backend\scripts\fetch_potreeconverter.ps1` (if the payload is not there), `backend\scripts\build.ps1 -Venv <worktree>\backend\.venv`, `backend\scripts\smoke_frozen.ps1`, then `pnpm -C frontend build:installer`.
Expected: `pointcloud ok 50000 32639 BROTLI laz 50000`, `cloud ok 50000 206`, `smoke ok`, `webview ok points=…`, and the installer line. Save all output to `docs/evidence/2026-09-24-point-clouds/build.log` (spec §17.8, §17.15).

- [ ] **Step 4: Prepare the acceptance data** (local SSD, outside any repo)

```powershell
$acc = "D:\kestrel-acceptance"; New-Item -ItemType Directory -Force $acc | Out-Null
$nas = "\\DanNas\Work Data\Inspections\Kuwait\Chemney Stack POC\I2 3D Modeling\Chimney stack 3D\Chimney stack 3D\2_densification\point_cloud\Chimney stack 3D_group1_densified_point_cloud.las"
(Measure-Command { Copy-Item $nas "$acc\chimney.las" }).TotalSeconds   # the NAS read time, for the ledger
cd <worktree>\backend
& $PY scripts\make_tiled_cloud.py "$acc\chimney.las" "$acc\chimney-3x3.las"
& $PY scripts\make_test_ortho.py "$acc\chimney.las" "$acc\chimney-ortho.tif" --cell 0.05
```

Expected: `tiled ok 195274656` and `ortho ok …x… 0.05 EPSG:32639`. (If `D:` is not the local SSD, use any local SSD folder; record which.)

- [ ] **Step 5: Start the frozen backend for the backend acceptance**

```powershell
$env:APP_TOKEN = "acceptance"; $env:APP_PORT = "8799"; $env:APP_DATA_DIR = "$acc\appdata"
$be = Start-Process -FilePath <worktree>\frontend\src-tauri\binaries\kestrel-backend-x86_64-pc-windows-msvc.exe -PassThru -WindowStyle Hidden -RedirectStandardOutput "$acc\be.out" -RedirectStandardError "$acc\be.err"
$be.Id
```

- [ ] **Step 6: Chimney import (spec §17.1)**

```powershell
& $PY scripts\pointcloud_acceptance.py import --base http://127.0.0.1:8799 --token acceptance --project-folder "$acc\project" --source "$acc\chimney.las" --backend-pid $be.Id | Tee-Object "$ev\import-chimney-local.json"
& $PY -c "import laspy, numpy as np; r = laspy.open(r'$acc\chimney.las'); mn = np.full(3, np.inf); mx = -mn
for p in r.chunk_iterator(2_000_000):
    a = np.column_stack([p.x, p.y, p.z]); mn = np.minimum(mn, a.min(0)); mx = np.maximum(mx, a.max(0))
print([*mn.round(3), *mx.round(3)])" | Tee-Object "$ev\independent-scan.txt"
```

(`$ev` = `<worktree>\docs\evidence\2026-09-24-point-clouds`.) Expected: `state succeeded`, `point_count 21697184`, `epsg 32639`, `bounds_repaired true`, `bounds_native` equal to the independent scan to 0.001, `octree_ratio ≤ 0.25`, `wall_s ≤ 60`. Then run the same `import` with `--source $nas --project-id <the project id from the first JSON>` and record its `wall_s` (NAS time, spec §17.1).

- [ ] **Step 7: The 195 M cloud (spec §17.2) and the refusal (spec §17.3)**

`& $PY scripts\pointcloud_acceptance.py import … --source "$acc\chimney-3x3.las" --project-id <id> --backend-pid $be.Id | Tee-Object "$ev\import-195m.json"`
Expected: `succeeded`, `point_count 195274656`, `wall_s ≤ 300`, `converter_peak_rss_gb ≤ 10`, `backend_rss_growth_gb ≤ 1`.
Refusal: `& $PY -m pytest tests/test_pointcloud_api.py -k 195m -v | Tee-Object "$ev\refusal.txt"` → PASS (422 `insufficient_memory`, "…about 9.9 GB…; 4.0 GB is free…", no row).

- [ ] **Step 8: Cancel and crash (spec §17.4, §17.5)**

Cancel: `& $PY scripts\pointcloud_acceptance.py cancel … --source "$acc\chimney-3x3.las" --project-id <id> | Tee-Object "$ev\cancel.json"` → `job_state cancelled`, `converter_gone_s ≤ 5`, `cloud_status failed`, `cloud_error "import cancelled"`, `cloud_folder_exists false`.

Crash:

```powershell
$r = Invoke-RestMethod -Method Post -Uri "http://127.0.0.1:8799/api/v1/projects/<id>/pointclouds" -Headers @{Authorization="Bearer acceptance"} -ContentType application/json -Body (@{ path = "$acc\chimney-3x3.las" } | ConvertTo-Json)
while (-not (Get-Process PotreeConverter -ErrorAction SilentlyContinue)) { Start-Sleep -Milliseconds 200 }
Stop-Process -Id $be.Id -Force            # the sidecar dies without cleanup; only the Job Object can kill the converter
$t = [Diagnostics.Stopwatch]::StartNew(); while ((Get-Process PotreeConverter -ErrorAction SilentlyContinue) -and $t.Elapsed.TotalSeconds -lt 10) { Start-Sleep -Milliseconds 100 }
"converter gone after $($t.Elapsed.TotalSeconds) s" | Tee-Object "$ev\crash.txt"
# restart the backend exactly as in Step 5, then:
Invoke-RestMethod -Uri "http://127.0.0.1:8799/api/v1/projects/<id>/pointclouds/$($r.cloud.id)" -Headers @{Authorization="Bearer acceptance"} | ConvertTo-Json | Tee-Object -Append "$ev\crash.txt"
Test-Path "$acc\project\pointclouds\$($r.cloud.id)\.work" | Tee-Object -Append "$ev\crash.txt"
```

Expected: gone in ≤ 5 s; after the restart (opening the project runs the sweep) `status failed`, `error` "import interrupted by application restart; import the file again"; `.work` → `False`.

- [ ] **Step 9: Packaged viewer performance and colours (spec §17.6, §17.7)**

Stop the Step 5 backend. For each run (`-Budget 3000000` and `8000000` on the chimney, `3000000` on the 195 M cloud):

```powershell
$env:KESTREL_MODE = "perf"; $env:KESTREL_OUT = "$ev\viewer-chimney-3M.json"; $env:KESTREL_SHOTS = $ev
powershell -NoProfile -ExecutionPolicy Bypass -File <worktree>\frontend\scripts\check-packaged-webview.ps1 -Cloud "$acc\chimney.las" -Driver <worktree>\frontend\scripts\measure-cloud-viewer.mjs -Budget 3000000
```

Expected, chimney 3 M: `firstPointsMs ≤ 1000`, `settledMs ≤ 5000`, `orbitP50Ms ≤ 20`, `webviewPeakGB ≤ 2.5`, `whiteShareOfPoints < 0.05`. Chimney 8 M: `webviewPeakGB ≤ 3`. 195 M at 3 M: `settledMs ≤ 8000`, `orbitP50Ms ≤ 20`.

- [ ] **Step 10: Picks are real points; the uncertainty shrinks (spec §17.9, §17.10)**

Picks: run the driver with `KESTREL_MODE=picks` (and `-Keep`, so the project survives), then export the cloud's LAZ with measurements from the app (Details → Export LAZ) or with `pointcloud_acceptance.py export`, and:
`& $PY scripts\check_picks.py "$acc\chimney.las" "<export folder>\cloud-chimney-stack-3d-measurements.csv" | Tee-Object "$ev\picks.txt"` → ten `nearest … mm` lines ≤ 1.000 mm and `picks ok 10`.

Uncertainty: in the app, pick the stack rim once from above and note its E/N (the readout); run the driver with `KESTREL_MODE=uncertainty`, `KESTREL_RIM="<E>,<N>"`, `KESTREL_OUT=$ev\uncertainty.json`. Expected: `close.cameraDistance ≤ 30`, `close.pick.uncertainty_m ≤ 0.05`, `ratio ≥ 4`; and in the app, a pick with u > 0.10 m shows its precision line in the warn tone (screenshot `uncertainty-warn.png`).

- [ ] **Step 11: Map ↔ 3D on the synthetic ortho (spec §17.12) and the export (spec §17.13)**

In the packaged app (installed from Step 3's installer), in the acceptance project: import `chimney-ortho.tif` as a map, link it on the chimney's Details tab (it ranks first, "likely same flight" only if both dates match). Then:

1. Right-click a recognisable pixel of the stack on the map → **Open this spot in 3D**. Note the URL's `at=`; compute the expected position with `& $PY -c "gt = <the map's geotransform>; px, py = <the clicked pixel from the map readout>; print(gt[0] + px*gt[1] + py*gt[2], gt[3] + px*gt[4] + py*gt[5])"` → the pin's `at` is within 0.01 m.
2. The Z refine lands on the surface (the view settles on the stack, not below it) — screenshot `jump-3d.png`.
3. Pick a point → **Show on map** → the marker sits within 1 map pixel of the picked spot (the readout's pixel coordinate) — screenshot `jump-map.png`.

Export: `& $PY scripts\pointcloud_acceptance.py export … --project-id <id> --cloud-id <chimney id>` → `laz_ratio ≤ 0.25`, `wall_s ≤ 30`; the same for the 195 M cloud → `wall_s ≤ 180`. Open the chimney LAZ in QGIS (Layer → Add Point Cloud Layer): it lands on the stack in EPSG:32639 — screenshot `qgis.png`.

- [ ] **Step 12: Write the walkthrough**

`docs/usability/2026-09-24-point-clouds-walkthrough.md` — frontmatter `type: walkthrough`, then a numbered "how to test this" list the operator follows in the installed app:

1. Open a detection project → **Point clouds** in the rail (after Site areas).
2. **Import** → Browse to the chimney LAS on the NAS → the dialog shows 21.7 M points, EPSG:32639, and no refusal → name it → Import. The row shows a progress bar ("copying …", "scanning …", "building the 3D view copy: INDEXING …") and turns **ready**; Details says "header bounds repaired".
3. The cloud opens in 3D in true colours within a second or two; drag to orbit, right-drag to pan, wheel to zoom towards the cursor, double-click to retarget; **F** fits, **T** looks from the top.
4. **View**: switch the budget to 8 M and back; switch to Elevation and move the range; RGB is greyed out on a cloud without colour.
5. **Measure** → Vertical check → click the base, then the top of the stack → read the offset, lean, direction (from grid north), mm/m and ± uncertainty → Save. Zoom in and repeat: the ± shrinks. Try a 0.3 m tall pair: it is refused with "pick points further apart vertically".
6. **Copy all as CSV** and paste into a spreadsheet.
7. Link the ortho on **Details**; on the map, click a detection → **Open in 3D** → the same spot, with a pin; pick → **Show on map** → the marker.
8. **Export LAZ** → the toast's **Show folder** opens the export; open the LAZ in QGIS: it sits on the stack.
9. Start a second import of the 3 × 3 cloud and cancel it from Jobs: no PotreeConverter process remains, the cloud says "import cancelled".
10. App settings → **About Kestrel AI**: nine components with their licence texts.

- [ ] **Step 13: The ledger, the evidence index, and the finish**

`docs/progress.md` — a new section at the top, in the file's style: `## Point clouds (S1) — 2026-09-24/<date> (merged)`, with *What changed* (the import pipeline, the display copy, the viewer, measurements, the jumps, the LAZ export, the packaged check, About), *Evidence* (a table of every spec §17 criterion → the measured value → the evidence file), the NAS import time, the bundle size delta (from the converter ADR), and *Gate* (the command lines and their result). `docs/evidence/2026-09-24-point-clouds/README.md` lists the files.

Commit the evidence and the documents (the tree must be clean before `finish-task.ps1`):

```powershell
git add frontend/scripts/measure-cloud-viewer.mjs docs/evidence/2026-09-24-point-clouds docs/usability/2026-09-24-point-clouds-walkthrough.md docs/progress.md
git commit -m "docs(pointclouds): acceptance on the chimney and the 195 M cloud, walkthrough, ledger

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

Then:

1. Load `superpowers:finishing-a-development-branch` and follow it (option: merge locally).
2. `scripts\finish-task.ps1` from `.claude/worktrees/pointclouds`, normally — no `-SkipGate`. It gates with the shared interpreter, which has F0's packages since F0 landed (F0 plan Task 10 Step 3, the operator's additive install). If the gate fails only because a package is missing from the shared interpreter, stop and report it to the coordinator; never land with `-SkipGate` to get around it. Never install into the shared venv from S1.
3. Give the operator the numbered walkthrough (Step 12) in the session.
4. Run `/wrapup` (session note in `vault/sessions/`, bump `vault/00-north-star.md`).
