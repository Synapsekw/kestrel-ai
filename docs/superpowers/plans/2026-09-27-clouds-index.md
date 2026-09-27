# Point clouds (sub-project C): execution index

> **For agentic workers:** this is the coordinator's map of the fourteen Point clouds unit plans.
> Each unit is executed with superpowers:subagent-driven-development in its own worktree. Read the
> unit plan you were given, this index, the programme rulings and the spec. Do not execute this
> index itself.

**Spec:** `docs/superpowers/specs/2026-09-26-point-cloud-workspace-design.md` (umbrella:
`2026-09-26-inspection-platform-design.md` §6, §7, §10; Foundation: `2026-09-26-foundation-design.md`;
what Foundation built: `main` at `4ebcac1` and `docs/evidence/foundation/rulings.md`).

**Binding rulings:** `.superpowers/sdd/imc-common/programme-rulings.md` (R1–R10) win over the spec.
The controller rulings below win over a unit plan where they differ.

**Goal:** land sub-project C on `main`:

- the full-bleed `CloudWorkspace`;
- engine additions: pan and fly, views, colour modes, EDL, clip box, pose camera, slab sampler,
  occlusion, capture, normal at pick;
- area, rings and profile measurements;
- 3D findings as pins;
- the photo link;
- the stored report views that Reports prints.

## Unit plans

| Unit | Plan | Tasks | Worktree / branch | Cut after |
|---|---|---|---|---|
| C-C0 contract + migration `0013` | `2026-09-27-clouds-c0.md` | 5 | `c-c0` / `task/c-c0` | I-C0 and M-C0 on `main` (R3) |
| C-B1 area, rings, CRUD, CSV, M headline | `2026-09-27-clouds-b1.md` | 9 | `c-b1` / `task/c-b1` | all three C0s on `main` |
| C-B2 profile job | `2026-09-27-clouds-b2.md` | 6 | `c-b2` / `task/c-b2` | all three C0s on `main` |
| C-B3 cameras, delete guard | `2026-09-27-clouds-b3.md` | 5 | `c-b3` / `task/c-b3` | all three C0s on `main` |
| C-B4 report views backend | `2026-09-27-clouds-b4.md` | 5 | `c-b4` / `task/c-b4` | all three C0s on `main` |
| C-X1 pure TS | `2026-09-27-clouds-x1.md` | 8 | `c-x1` / `task/c-x1` | all three C0s on `main` |
| C-V1 engine split | `2026-09-27-clouds-v1.md` | 8 | `c-v1` / `task/c-v1` | all three C0s on `main` |
| C-V2 engine part 2 (+ normal at pick) | `2026-09-27-clouds-v2.md` | 10 | `c-v2` / `task/c-v2` | C-V1 |
| C-W1 workspace layout | `2026-09-27-clouds-w1.md` | 12 | `c-w1` / `task/c-w1` | C-V1, C-X1, C-B3 |
| C-R1 report-view client | `2026-09-27-clouds-r1.md` | 8 | `c-r1` / `task/c-r1` | C-W1, C-V2, C-B4 |
| C-P1 pins, Findings tab | `2026-09-27-clouds-p1.md` | 12 | `c-p1` / `task/c-p1` | C-W1, C-V2, C-X1, C-B4 |
| C-M1 measure tools UI | `2026-09-27-clouds-m1.md` | 10 | `c-m1` / `task/c-m1` | C-W1, C-V2, C-B1, C-B2, C-X1 |
| C-L1 cameras layer, photo link | `2026-09-27-clouds-l1.md` | 12 | `c-l1` / `task/c-l1` | C-W1, C-V2, C-B3, C-X1 |
| C-G evidence | `2026-09-27-clouds-g.md` | 12 | `c-g` / `task/c-g` | every C unit above |

## Execution DAG

**Batches.** Worktrees in one batch are built concurrently. Merges into `main` are serialized by the
coordinator (R5), and each later unit rebases onto the new `main` before its gate.

1. **C-C0**. It merges third of the three C0s: I-C0, then M-C0, then C-C0 (R3). Its merge step
   re-checks `alembic heads` (R4).
2. **B1 ∥ B2 ∥ B3 ∥ B4 ∥ X1 ∥ V1**. Cut after all three C0s are on `main`. They merge in any order.
   Suggested order: V1 first (critical path), then X1 and B3 (W1 needs them), then B4, B1 and B2.
   B1 and B2 each carry a conditional step for whichever of them merges second (the profile branch
   `finding_id` pass-through and the `BACKEND_PENDING["createCloudMeasurement"]` removal).
3. **V2 ∥ W1**.
   - V2 is cut after V1.
   - W1 is cut after V1, X1 and B3.
   - **V2 merges first.** W1 rebases onto it. Both edit `CloudViewer.tsx` at different anchors, and
     W1 enables Fly and Clip only when V2's members exist.
4. **R1 ∥ P1 ∥ M1 ∥ L1**. All four are cut after W1 and V2. Each also needs its backend units: R1 and
   P1 need B4, M1 needs B1 and B2, L1 needs B3.
   - Merge order: **R1 first**, so P1's and M1's capture requests go live the moment they merge.
   - Then P1 and M1.
   - **L1 last**: it folds M1's `polygon` overlay into its `overlayObject`.
5. **G**.

**Critical path:** C0 → V1 → V2 → P1 → G. P1 is the largest UI unit.

**Near-critical:**
- V1 → V2 → R1 → G. The Reports sub-project's R9-C acceptance waits on R1 and B4.
- V1 → W1 → M1, where M1 also waits on B2.

**Slack:** B1, B3, B4 and X1.

## Budget

**Background jobs:**
- `pointcloud_profile` (B2). It streams the source file with progress, cancel and a restart sweep. It
  holds one 2 M-point chunk plus a buffer of at most 2 M points (about 14 B each).
- `pointcloud_import` and `pointcloud_export` stay as they are. Export's CSV gains columns (B1).
- "Capture missing views" (R1) is the one long operation that is not a backend job, because only
  the webview can render. It runs in the foreground, is cancellable, shows progress in the hint bar,
  and is bounded by the 500-pin and 1 000-measurement caps.

**Bounded reads:**
- Cameras: one column-only query capped at 20 000 rows, plus one COUNT for `without_gps`. No image
  file is opened.
- Pins: F's paged list, capped at 500 drawn. The "500 of N" count walks at most 10 extra pages.
- Measurements: at most 1 000 per cloud.
- Profile body: at most 500 000 points, gzip on its one route.
- Slab preview: at most 300 000 points from nodes already loaded, throttled to 5 Hz.
- View uploads: at most 6 MiB, one Pillow header read then one bounded decode.
- `listCloudViews`: at most 1 500 rows, metadata only.
- Capture: one 1600 × 1000 RGBA read-back.
- Octree: S1's point budget and Range endpoint.
- No request loads the image set or the point set into memory.

## Controller rulings (binding on executors)

1. **Workspace seams (W1).** `frontend/src/clouds/workspace/seams.tsx` exports `ViewSubject`
   (`finding` | `cloud_measurement`), `CaptureReason`, `WorkspaceSeams`, `WorkspaceSeamsContext`,
   `useWorkspaceSeams()` and `DEFAULT_SEAMS`.
   - `WorkspaceSeams` holds `requestViewCapture`, `ReportViewCard` and `LikelyViews`.
     `LikelyViews` takes `{point, normal, findingId?, limit?}`.
   - `CloudWorkspace.tsx` fills the seams under the anchor `// seams: R1 and L1 fill these`, one line
     per seam. R1 fills `requestViewCapture` and `ReportViewCard`; L1 fills `LikelyViews`.
   - **Feature hooks read `ctx.seams`**, because they run above the provider. Only components
     rendered inside the provider call `useWorkspaceSeams()`.
2. **Feature slots (W1).** Each batch-4 unit replaces the body of one W1 file and edits no other W1
   file, apart from the seams lines above:
   - `workspace/features/pins.tsx` (P1)
   - `workspace/features/measure.tsx` (M1)
   - `workspace/features/cameras.tsx` (L1)
   - `workspace/features/reportViews.tsx` (R1)

   Each returns a `WorkspaceFeature` and reads `FeatureContext` (both in `workspace/types.ts`). Tool
   ids are W1's `CloudToolId`: the photo-link tool is `"photo"` and the pin tool is `"pin"`.
3. **`subject_kind`** is `finding | cloud_measurement` everywhere: the API, the table and the file
   names `pointclouds/<cloud_id>/views/<subject_kind>-<subject_id>.<png|jpg>`. This follows R's
   spec §3.
4. **Normal hand-off.** `frontend/src/clouds/views/normals.ts` exports `setAnchorNormal(id, n)` and
   `getAnchorNormal(id)`. R1 owns the file; P1 creates the same file if it merges first. P1 calls
   `setAnchorNormal` before `requestViewCapture`, and R1 puts the normal into the upload meta.
5. **Normal at pick (V2).** `viewer/normal.ts::pcaNormal` and the handle member
   `pickWithNormal(clientX, clientY)` implement spec §9.1. P1 uses it for the pin and L1 for the
   photo-link facing test. The eigenvalue ratio is read ascending: smallest ÷ middle > 0.3 gives
   null.
6. **EDL in captures.** potree-core 2.0.15's EDL cannot render into a target (V1 Ruling 3), so every
   capture records `render.edl = false`. This is the spec's own fallback (§7, §18).
7. **`pointclouds.changed` on the client.** `store/changes.ts` did not handle it. W1 adds
   `pointcloudsRevision` (project-scoped), and R1, P1, M1 and L1 refetch on it. No new event is
   added.
8. **Frontend API wrappers.**
   - `api/cloudViews.ts`: W1 creates it with `listCloudViews`. R1 appends the PUTs (multipart, `meta`
     as a JSON Blob) and `view3dUrl`.
   - `api/cloudCameras.ts`: L1.
   - `api/cloudMeasurements.ts`: M1 adds the profile wrappers and the 202 branch.
   - `api/cloudFindings.ts`: P1.
   - `api/clouds.ts::deletePointCloud`: B3 adds the `{deleteFindings}` option, and W1's
     `DeleteCloudDialog` uses it.
9. **`CloudCameraSet.without_gps`.** C0 adds the field and B3 fills it. It gives the panel's
   "*n* photos without GPS".
10. **Measure vectors.** B1 adds new top-level keys (`area_fields`, `area_cases`, `ring_fields`,
    `ring_cases`, `refusal_cases`) and leaves S1's bytes untouched. X1 carries a local copy
    (`frontend/src/test/cloud-measure-vectors-c.json`), and M1 deletes it.
11. **Profile seam.** B2 writes the `profile` branch of `createCloudMeasurement` and calls
    `profile.create_profile_measurement(handle, runner, cloud_id, body, *, finding_id=None)`. B1
    validates `finding_id` first. Whichever of B1 and B2 merges second completes the pass-through
    and deletes `BACKEND_PENDING["createCloudMeasurement"]`.
12. **e2e split.** Each unit adds focused e2e for its own flows:

    | Unit | Spec §15 items | Spec file |
    |---|---|---|
    | W1 | 1–2 | `clouds-workspace.spec.ts` |
    | V1 | 7 | `clouds-engine.spec.ts` |
    | V2 | engine checks | `clouds-engine-v2.spec.ts` |
    | M1 | 5–6 | `clouds-measure.spec.ts` |
    | P1 | 3–4, 11 | `clouds-pins.spec.ts` |
    | L1 | 8–10 | `clouds-cameras.spec.ts` |
    | R1 | 12 (bulk capture, cancel, PNG, pose) | `cloud-report-views.spec.ts` |

    G rewrites the three S1 specs and owns the journey (including the rest of item 12: the PUT after
    a pin create, and Refresh view), item 13 and any gaps.
    - If W1 cannot keep an S1 e2e green, it marks it with a one-line `test.fixme`, and G removes
      the fixmes.
    - The `pins()` diagnostics member (P1) and `frameTimes()` (V1) are hard dependencies of G.
13. **Nobody but G's walkthrough file** records the C walkthrough. Units do not edit this index.

## Rules while C is in flight

- The contract and the migration are edited only in C-C0. `schema.d.ts` is regenerated in the same
  commit.
- Each unit removes only its own stubs, from `router.STUBS`/`UPLOAD_STUBS` and `EXPECTED_STUBS`.
- No installer is built from `main` for C. IMC-X builds one installer after I, M and C (R9).
- Backend work uses `E:\Dev\Yolo\app\backend\.venv\Scripts\python.exe` from `<worktree>\backend`.
  No plan adds a Python package.
- `scripts/start-task.ps1` and `finish-task.ps1` are not used, because they fail on Windows
  PowerShell 5.1 (R10). The coordinator cuts worktrees and merges by hand.
- Every unit's last task runs the AGENTS.md §4 gate. `cargo test` runs only when the frozen sidecar
  is present.

## Shared-file touches (outside C's own packages)

C's own packages are `backend/app/pointclouds/` and `frontend/src/clouds/`, plus C's new
`frontend/src/api/cloud*.ts` files. Every touch outside them is one additive line or block at the
anchor named. Serial rebases resolve them.

| File | Unit | Anchor | What |
|---|---|---|---|
| `contract/openapi.yaml`, `contract/client/schema.d.ts`, `contract/client/index.ts` | C0 | C's `pointclouds` path groups and schemas; the two `…/findings/{findingId}/view3d` paths; `JobType` enum (append) | Contract rows 1–18, `without_gps`, aliases |
| `backend/app/db/migrations/versions/0013_cloud_workspace.py`, `backend/app/db/models.py` | C0 | new file; append models | `cloud_measurement` columns, `cloud_camera_offset`, `cloud_view` |
| `backend/tests/test_contract.py` | C0; B1, B2, B3, B4 | the C `EXPECTED_STUBS \|= {…}` block; `BACKEND_PENDING`; the end of `REFUSES_VALID_DATA` | C0 adds; each B unit deletes its own lines. B1 adds `updateCloudMeasurement: {422}`, B4 two entries |
| `backend/tests/test_pointcloud_schemas.py` | C0, B1 | `NAMES` | C0 drops `CloudMeasurementCreate` and `CloudMeasurementUpdate`; B1 re-adds them |
| `contract/fixtures/cloud-measure-vectors.json` | B1 | end of file | five new keys |
| M's cloud provider for `GET /measurements` | B1 (Task 8, WAITING on M-B4) | the cloud row builder | one call to `headline.headline_for`, `method_label` and `list_status` |
| Frontend job label maps (`ToolRow.tsx`, `jobVerbs.ts`, `JobCard`, …) | C0 | after the `pointcloud_export` entries | `pointcloud_profile` "Cross-section profile" |
| `frontend/src/ui/Icon.tsx`, `ui/Feedback.test.tsx` | W1 | the `IconName` union's last member; `PATHS` | 11 palette icons (R6: added, not changed) |
| `frontend/src/store/changes.ts` | W1 | `ChangesState`, the initial state, `PROJECT_SCOPED_EVENTS`, `applyEvent` | `pointcloudsRevision` |
| `frontend/src/app/routeModel.ts` (+ test) | W1 | after `if (tab === "maps" && detail) return "fullbleed";` | `clouds/:id` is full-bleed |
| `frontend/src/screens/CloudsScreen.tsx` (+ test deleted) | V1 (props), W1 (shim) | whole file | ~20-line shim rendering `CloudWorkspace` |
| `frontend/src/routes/projectRoutes.tsx` | X1 | the comment `//   /p/:projectId/maps/:mapId?at=x,y` | four comment lines documenting C's arrivals |
| `frontend/src/api/clouds.ts` | B3 | `export async function deletePointCloud(` | optional `{deleteFindings}` |
| `frontend/e2e/fixtures/potreeOctree.ts` | V1, V2 | `buildOctree(...)`; after `hollowStack` | optional attributes; `hollowBox` |
| `frontend/e2e/clouds.spec.ts`, `pointcloud-foundation.spec.ts`, `clouds-no-webgl.spec.ts` | V1, W1, M1, G | named tests | V1 and W1 adapt; M1 drops the S1 distance test; G rewrites all three |
| `frontend/scripts/check-packaged-webview.{ps1,mjs}` | G | after the cloud import loop; before `webview ok` | EDL on, 50 pins, one capture (IMC-X runs it) |
| `backend/scripts/pointcloud_acceptance.py` (+ `tests/test_pointcloud_scripts.py`) | G | `client()`, `new_project()`, `main()` | six scenarios |
| `docs/progress.md` | G | top | one section |

**Inside C's package, co-edited in the same batch** (both edits are additive, and the second to
merge rebases):

| File | Batch | Units and anchors |
|---|---|---|
| `backend/app/pointclouds/router.py` | 2 | B2, B3 and B4 each delete their own `STUBS` lines and append to `SUB_ROUTERS` |
| `backend/app/pointclouds/routes_measurements.py` | 2 | B1: validation, first statement of create. B2: the `profile` branch. B4: `from_row(..., view=)` in list and update |
| `backend/app/pointclouds/measurements.py` | 2 | B1 owns it. B4 adds one line at the end of `def delete(` |
| `backend/app/pointclouds/schemas.py` | 2 | `CreatableCloudMeasurementKind`: B1 adds `area`, B2 adds `profile`. `params` added with identical text by whichever lands first |
| `frontend/src/clouds/CloudViewer.tsx` | 3, 4 | V2 adds members; W1 adds props, `setEdl` and deletes the status bar; P1 adds `pins: () => readPins()` in `installHook` |
| `frontend/src/clouds/viewer/diagnostics.ts` | 4 | P1: `pins()`, `setPinsProbe`, `readPins` |
| `frontend/src/clouds/viewer/overlay.ts`, `viewer/engine.ts` `setOverlay`, `viewer/capture.ts` `shapeObject` | 4 | M1 adds `polygon` and `polygonMesh` (merges before L1). L1 adds `segments` and `overlayObject`, and folds M1's `polygon` into it on rebase |
| `frontend/src/clouds/workspace/CloudWorkspace.tsx` | 4 | R1: the `useViewCapture` call and two seam lines. L1: one seam line |
| `frontend/src/api/cloudViews.ts` | 3, 4 | W1 creates it; R1 appends |
| `frontend/src/clouds/views/normals.ts` | 4 | R1 or P1, identical content |

## Cross-sub-project edges (R7)

- **C reads I's pose columns** (`0011`) only in `app/pointclouds/cameras.py`, through `POSE_COLUMNS`
  and `_pose_columns`.
  - B3's Task 1 checks the real column names on `main`. A renamed column is a one-line fix; a
    missing column means BLOCKED.
  - Without pose data, everything still works as "by distance".
- **`GET /measurements` belongs to M (M-B4).** B1's Task 8 adds the `area`/`profile` headline, the
  rings label and `status` in M's cloud provider.
  - The task is WAITING, not blocking: it is skipped when M-B4 is not on `main`.
  - In that case M-B4, merging second, calls B1's `headline.headline_for`, `method_label` and
    `list_status`.
- **The cloud → image arrival is I's (I-FW).** C builds
  `/p/:pid/images/:imageId?at=px,py&r=rpx&from=cloud:<cid>` (X1's `imageJumpHref`).
  - L1's and G's e2e assert only the URL unless I-FW has merged; G greps for I-FW's parser.
  - The image → cloud URL `?from_image=<id>&px=u,v` is C's arrival. Any "View in 3D" button on the
    Images side is I's.
- **Reports (R) reads** `GET …/findings/{findingId}/view3d`, `GET …/measurements/{id}/view3d` and
  `listCloudViews`, exactly as R §3 and §9 name them (B4).
  - `ETag` is the sha256; a missing view answers 404 `no_view`.
  - R9-C acceptance waits on C-R1 and C-B4. The R part of success criterion 10 is deferred to R.
- **F's finding routes are not edited.** C's view3d routes are mounted by C's own router. Move pin
  uses F's `FindingAnchorPatch {x, y, z, uncertainty_m}` for cloud anchors.

## Deviations from the spec caused by what Foundation built

- **Stubs.** They live in `app/pointclouds/router.py::STUBS`/`UPLOAD_STUBS`, not `app/stubs.py`
  (C0).
- **Keymap.** `ui/keymap.ts` already has the `clouds` and `clouds.fly` scopes. X1 adds
  `clouds/keys.ts` and does not edit the keymap.
- **Move pin.** It PATCHes `anchor {x, y, z, uncertainty_m}`, not `anchor.geometry`, which is the map
  anchor's (P1).
- **Job label maps.** There are five `Record<Job["type"], …>` maps on `main`, not six (C0).
- **Findings total.** F's findings page has no total, so "500 of N" walks at most 10 extra pages and
  shows "5,500+" beyond that (P1).
- **Warning toasts.** F's toasts have no warning tone, so the spec's "quiet warning toast" is
  `toast("info")` (R1).
- **`Switch` reasons.** F's `Switch` has no reason prop, so disabled reasons are a muted line (L1,
  W1).
- **EDL in captures.** potree-core 2.0.15 cannot render EDL into a target (V1, V2).

## Open questions for the operator

None. Every ambiguity is ruled on above or in the unit plans' "Rulings" sections.

## Evidence unit (R9)

C-G, `2026-09-27-clouds-g.md`:

- **e2e:** the rewrites, the journey, the frame-time harness and any gaps.
- **Packaged check code:** `check:webview` gains EDL on, 50 pins and one capture; IMC-X runs it on
  the packaged exe.
- **Acceptance and performance:** dev mode (the venv backend, Vite, Edge over CDP) on the chimney
  cloud and a posed DJI flight. Results go under `docs/evidence/clouds/`.
- **Records:** a `docs/progress.md` entry, and the operator walkthrough in
  `docs/evidence/clouds/walkthrough.md`.
- **Missing data:** if the operator's data is missing, the unit reports NEEDS_DATA.
- **Out of scope:** G builds no installer and runs no `/wrapup`; both are the coordinator's.

## Reconciliation log (2026-09-27)

One line per change: what, and which plan files (`c0`, `b1`, `b2`, `b3`, `b4`, `x1`, `v1`, `v2`,
`w1`, `r1`, `m1`, `p1`, `l1`, `g`, `index`).

1. **Workspace seams.** W1 owns the seams with defaults. R1 and L1 fill separate lines at one
   anchor, and P1 and M1 never import them (ruling 1). Files: w1, r1, l1, p1, m1.
2. **Schema-mirror test.** C0 widened the contract's `CloudMeasurementCreate` and `Update` but not
   their pydantic mirrors, which would fail `test_pointcloud_schemas.py`. C0 Task 2 now drops the two
   names and B1 Task 3 re-adds them. Files: c0, b1.
3. **"*n* photos without GPS".** The count (§14) had no source. C0 adds
   `CloudCameraSet.without_gps` to the YAML, the example and the pydantic model; B3 Task 2 fills it
   with one COUNT and a test. B3's deviation line is updated. Files: c0, b3, l1.
4. **Profile seam.** B1 was told to call B2's seam; B2 instead writes the route branch itself. B1 now
   validates `finding_id` first and passes it through, and the second of B1/B2 to merge completes the
   branch and deletes `BACKEND_PENDING` (ruling 11). Files: b1, b2.
5. **Vector keys.** B1 keeps S1's `fields`/`cases` and adds five new keys (vitest on `main` asserts
   `FIELDS == VECTORS.fields`). X1 reads those keys from a local copy, and M1 deletes the copy
   (ruling 10). Files: b1, x1, m1.
6. **API wrappers.** Frontend wrappers for C's new operations are assigned to W1, R1, L1, M1 and P1
   (ruling 8). Files: w1, r1, l1, m1, p1.
7. **EDL.** EDL cannot render to a target in potree-core 2.0.15, so captures record `edl=false`
   (ruling 6). Files: v2, r1.
8. **`pointcloudsRevision`.** `pointclouds.changed` was unhandled in `store/changes.ts`. W1 adds
   `pointcloudsRevision`; R1, M1, P1 and L1 refetch on it, and L1 drops its own-save special case
   (ruling 7). Files: w1, r1, m1, p1, l1.
9. **Normal at pick.** The surface normal (§9.1) had no owner. V2 gains Task 9 (`pcaNormal`,
   `pickWithNormal`, 8 vitests, 1 e2e), and its gate moves to Task 10. P1 and L1 consume it; L1's
   facing test is now on (ruling 5). Files: v2, p1, l1.
10. **`LikelyViews` props.** The seam type is widened to `{point, normal, findingId?, limit?}`, and
    P1 passes `findingId` and `limit={2}`. Files: w1, p1, l1.
11. **Batch-4 mounts.** R1 and L1 were written before W1's plan and now mount through W1's feature
    slots (`features/reportViews.tsx`, `features/cameras.tsx`) with `CloudToolId` (`"photo"`).
    Their W1 assumptions are replaced by W1's real names. Files: r1, l1.
12. **Bug fix: pin captures.** P1's `usePinTool` called `useWorkspaceSeams()` inside
    `usePinsFeature`, which runs above the seams provider, so every capture request would have gone
    to the no-op default. It now takes `seams` from `FeatureContext.seams`, at the call site and in
    its test (ruling 1). Files: p1.
13. **Overlay conflict.** M1 (`polygon`) and L1 (`segments`, `overlayObject`) both edit
    `overlay.ts` and `setOverlay`. M1 merges first; L1's rebase note now folds `polygon` into
    `overlayObject` with one more test. Files: l1, index.
14. **`pins()` member.** P1 adds `pins(): {id, x, y, state, …}[]` to the diagnostics hook, which C-G
    hard-depends on. Files: p1, g.
15. **Item 12 split.** Spec §15 item 12 is split: R1 covers bulk capture, cancel and the PNG and pose
    checks; G covers the PUT after a pin create and Refresh view. Files: r1, g.
16. **Walkthrough location.** G writes the walkthrough to `docs/evidence/clouds/walkthrough.md`
    only; this index is not edited by units. Files: g.
17. **W1's cut.** W1 is cut after B3 as well, because the Details dialog's retry uses B3's
    `deletePointCloud` option. Files: w1, index.
18. **Merge order.** Batch 3 merges V2 before W1. Batch 4 merges R1 first and L1 last (after M1),
    stated the same way in every plan header and here. Files: v2, w1, r1, l1, index.
19. **`currentPose()`.** V1 and V2 both define it, and it stays uncropped. R1 crops to 1.6 with V2's
    `captureFovDeg`. Confirmed consistent. Files: r1, v2.

**Verified unchanged:**
- The migration is `0013` with `down_revision` `0012` (M-C0), and no other C unit writes a
  migration.
- Every operationId has one owner that removes its stub:
  - B2: `retryCloudProfile`, `getCloudProfile`
  - B3: `getCloudCameras`, `setCloudCameraOffset`
  - B4: the five view operations
  - B1 and B2: the `createCloudMeasurement` allowance
- Job type `pointcloud_profile` is registered by C0 as a stub and replaced by B2.
- No new event names.
- The engine names in V1, V2, W1, R1, P1, M1 and L1 agree.
