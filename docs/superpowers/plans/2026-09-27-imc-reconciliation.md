# I / M / C cross-sub-project reconciliation (2026-09-27)

Scope: only the seams **between** Images (I), Maps (M) and Point clouds (C). Each sub-project's index
already reconciled its own units. Inputs: the three indexes, the unit plans they name, the programme
rulings (`.superpowers/sdd/imc-common/programme-rulings.md`, with the amended R3), umbrella spec §6
and §10, and the code on `main` at `a3e6567`.

The three `*-c0.md` plans are being executed, so they are not edited here. What a C0 must change is
listed under "C0 hand-offs" below. Every other plan named in a "Files changed" line was edited in place.
Each edit is marked in the plan with "IMC reconciliation item N".

## Log

1. **Frontend job-label maps: I says four, C says five.** On `main` there are **five**
   `Record<Job["type"], …>` maps: `agent/project/ToolRow.tsx` `JOB_NAME`, `app/jobVerbs.ts`
   `JOB_VERB`, `jobs/JobCard.tsx` `TYPE_ICON`, `jobs/jobLabels.ts` `TYPE_LABEL` and
   `ui/useJobToasts.ts` `TYPE_NAME`. There are also **two** exhaustive switches with declared return
   types: `jobToastText` (`useJobToasts.ts`) and `resultTarget` (`jobLabels.ts`). That makes seven
   edit points.
   - M-C0 and C-C0 edit all seven.
   - I-C0 edits four maps and neither switch. With I's three new JobTypes, `tsc -b` would fail with
     TS2741 (`TYPE_NAME` is missing keys) and TS2366 (both switches lack an ending return).
   - **Resolution:** an I-C0 hand-off (below).
   - Files changed: `images-index.md` (the shared-touch row and the cross-edge text).

2. **Duplicate icon `area`.** M-W1 and C-W1 both add `area` to `ui/Icon.tsx`, with different paths.
   A repeated key in the `PATHS` object literal fails `tsc` (TS1117). Both edits are at the same
   anchor, after `elevation`, and so are their `Feedback.test.tsx` loops. The other 20 new names do
   not collide with each other or with `main`. I adds no icon.
   - **Resolution:** whichever W1 merges second deletes its own `| "area"` line and `area:` entry and
     keeps the one on `main`. Its `toContain("area")` still passes. Keep both blocks otherwise.
   - Files changed: `maps-w1.md`, `clouds-w1.md`, `maps-index.md`, `clouds-index.md`.

3. **`store/changes.ts`: two `if`s for one event.** `applyEvent` returns on the first matching `if`,
   so a second `if` for the same event never runs.
   - C-W1 adds `if (ev.type === "pointclouds.changed") return { pointcloudsRevision … }`.
   - M-W6 adds `if (… "map_measurements.changed" || … "pointclouds.changed") return { measurementsRevision … }`.
   - M-W1 already returns on `map_measurements.changed` (`mapMeasurementsRevision`).

   In any merge order, either `measurementsRevision` or `pointcloudsRevision` / `mapMeasurementsRevision`
   silently stops bumping. That would break M-W6's live refresh, or M-W3's and C's refetches.
   `PROJECT_SCOPED_EVENTS` also got `"pointclouds.changed"` from both.
   - **Resolution:** one `if` per event, returning every revision it bumps.
   - M-W6 extends W1's `map_measurements.changed` return, and extends C-W1's `pointclouds.changed`
     line if it is present; otherwise M-W6 adds a single-event line that C-W1 later extends.
   - Both add `"pointclouds.changed"` to the set only if it is absent.
   - M-W6 gains a test that `map_measurements.changed` still bumps `mapMeasurementsRevision`.
   - Files changed: `maps-w6.md`, `clouds-w1.md`, `clouds-index.md`.

4. **`store/changes.ts` `findings.changed` branch: I-FB and M-W4 edit the same line.**
   - I-FB replaces the line with its echo-ledger block.
   - M-W4 adds `lastFindingIds: idsOf(ev)` to the same line.
   - A latent bug: M-W4's `waitForFindingIds(rev)` resolves on `findingsRevision > rev &&
     lastFindingIds.length`. An own write inside the 3 s wait (FB's `ownFindingsWrite`, or any
     `bumpFindings()`) bumps the revision while `lastFindingIds` still holds an older event's ids. W4
     would then select the wrong finding.
   - **Resolution:** the merged branch is FB's block, with `lastFindingIds: idsOf(ev)` on its
     non-echo return only. A skipped echo is an own write with known ids, never a review-created
     finding. `bumpFindings` also sets `lastFindingIds: []`, and W4 gains a test for that.
   - Files changed: `maps-w4.md`, `images-fb.md`.

5. **`app/routeModel.ts` anchor moves.** C-W1 inserts its line after
   `if (tab === "maps" && detail) return "fullbleed";`, but M-W1 rewrites that line to
   `if (tab === "maps") return "fullbleed";`. I-FW rewrites the images line, which does not collide.
   - **Resolution:** C-W1 anchors on "the `maps` line", in either form.
   - Files changed: `clouds-w1.md`, `clouds-index.md`.

6. **`GET /measurements` cloud headlines: two designs.** M-B4 exposes the dict
   `CLOUD_HEADLINES[sub_kind] -> Headline` with the anchor `# C-B1: add "area" and "profile" entries here`
   and maps the status itself (`CLOUD_STATUS`). C-B1 instead planned to patch M's row builder with
   `headline_for`, `method_label` and `list_status`. It also used the unit `"m²"`, which is not an M-C0
   `MeasurementUnit` (`m|m2|m3|deg|mm_per_m`), so the union response would fail its schema. It also
   headlined a computing profile with its line length, where the contract says the headline is "null
   while computing".
   - **Resolution, one design:**
     - M-B4's `CLOUD_HEADLINES` is the only seam. C-B1 ships only
       `app/pointclouds/headline.py::headline_for` (`(area_m2, "m2")`, `(profile_length_m, "m")`, value
       None until computed).
     - Whichever of C-B1 and M-B4 merges second adds exactly two entries under the anchor:
       `"area": lambda m: _headline(*headline_for("area", m.params, m.results, m.points))`, and the
       same for `"profile"`.
     - C-B1 does this in Task 8. M-B4 does it in its new Task 6 Step 7, with a test.
     - `method_label` and `list_status` are dropped. M's item has no label field, so the rings label
       is not shown, and the status is M's.
   - Files changed: `clouds-b1.md` (header, rulings, interfaces, Task 7 code and tests, Task 8),
     `maps-b4.md`, `maps-index.md`, `clouds-index.md`.

7. **"Show on map" link into the map workspace.** M-X edits `screens/CloudsScreen.tsx:311`. But C-W1
   turns `CloudsScreen` into a ~20-line shim, and the navigate moves to
   `clouds/workspace/CloudWorkspace.tsx` (`<Readout onShowOnMap=…>`, still
   `/p/:pid/maps/:mapId?at=…`).
   - **Resolution:** M-X edits whichever file holds the link on `main` at its cut, and stages that
     file. M-X's `MapRedirect` keeps `at` verbatim, so the old URL also keeps working if C-W1 lands
     later. C-W1 is unchanged.
   - Files changed: `maps-x.md`, `maps-index.md`.

8. **`e2e/clouds.spec.ts` has two owners.**
   - C-G replaces the whole file, copying S1's map-side block "verbatim from lines 318-523 of `main`".
   - M-X rewrites `mapRoutes` and the two map-start tests onto the workspace.

   Either merge order would drop the other's work.
   - **Resolution:** M-X owns `mapRoutes` and the two map-start tests. C-G owns the rest.
   - C-G copies the block from `main` at its rebase (by content, not by line numbers), taking M-X's
     versions if M-X merged first, and applies its one canvas-click edit.
   - M-X, if C-G merged first, edits the same tests by name in C-G's file and keeps that edit.
   - Files changed: `clouds-g.md`, `maps-x.md`, `maps-index.md`, `clouds-index.md`.

9. **Cloud → image jump without a pixel.** C-X1's `imageJumpHref(…, null)` sends
   `/p/:pid/images/:imageId?from=cloud:<cloudId>` with no `at`, and C-L1 expects the "Back to 3D"
   chip. I-FW's `parseArrival` returns `null` without a valid `at`, so no chip appears. With a
   pixel, the URL shapes agree exactly: `at=px,py&r=rpx&from=cloud:<id>`, 1-decimal pixels, `r` an
   integer ≥ 1, parsed by FW's `NUM` regex, and image → cloud `?from_image=<id>&px=u,v`.
   - **Resolution:** I-FW's `Arrival` gains `{kind: "back", cloudId}`. It is used when `from=cloud:`
     is valid but `at` is missing or malformed. It gives the chip only: no centring, no ring, keys
     stripped. There are two new parser tests and one hook test.
   - Files changed: `images-fw.md` (Task 2 and Task 8 amendments).

10. **Finding writes in M and C and I-FB's `ownFindingsWrite`.** Several units call `bumpFindings()`
    after a finding write. Each such echo costs one bounded re-read, as R8 notes.
    - C-P1: move, patch, delete, create.
    - C-L1: attachment.
    - M-W1: delete.
    - M-W3: create.

    **Resolution:** when `store/changesOwnWrite.ts` is on `main` at the unit's cut or rebase:
    - known-id writes go through `ownFindingsWrite([id], …)`;
    - a `finally` bump becomes `{bumpOnError: true}`;
    - creates keep `bumpFindings()`, because their id is unknown before the answer.

    Without I-FB, nothing changes. M-W4's review-created findings are not wrapped (item 4).
    Files changed: `clouds-p1.md`, `clouds-l1.md`, `maps-w1.md`, `maps-w3.md` (a Global Constraints bullet).

11. **Backend files shared by I and M that neither index listed as cross-sub-project.**
    - `detect/runs.py::create_runs`: I-BP moves the segment refusal to map targets only; M-B5 adds
      region runs just below it.
    - `detect/review.py`: I-BA edits the import and the **photo** branch of `run_accept_above`; M-B5
      rewrites the **map** branch, `_apply` and `review_map_detections`.
    - `findings/service.py`: I-BA edits three lazy imports; M-B5 adds a `delete_in_session` hook.
    - `tests/test_detect_runs.py`: edited by both.

    The hunks are distinct but adjacent. M-B5 called `runs.py`/`review.py` "B5-owned".
    **Resolution:** keep both hunks on a rebase. M-B5 edits only the map branch. A region run is a map
    target, so I-BP's refusal still applies to it.
    Files changed: `maps-b5.md`, `images-bp.md`, `images-ba.md` (a Global Constraints bullet).

12. **`docs/progress.md`: three "top" entries.** I-E, M-X and C-G all insert "above
    `## Foundation lands`", so a later entry would land under an earlier one.
    - **Resolution:** each inserts directly after the resume paragraph, above the first existing
      `## ` section, so the newest is on top. Never edit another sub-project's entry.
    - Files changed: `images-e.md`, `maps-x.md`, `clouds-g.md`.

13. **`backend/tests/test_contract.py`: M-C0's anchor disappears.** M-C0 anchors on the literal line
    `EXPECTED_STUBS: set[str] = set()`, which I-C0 replaces with a `{…}` literal. C-C0 already
    anchors on "the statement that defines `EXPECTED_STUBS`".
    - **Resolution:** an M-C0 hand-off (below).

14. **`cloud_measurement` is touched by both M-C0 and C-C0.** This is the only table two migrations
    touch.
    - M-C0 (`0012`) adds the index `ix_cloud_measurement_created (created_at, id)`, both in the
      migration and in `CloudMeasurement.__table_args__`.
    - C-C0 (`0013`) replaces the `CloudMeasurement` body "through `__table_args__`" with two indexes
      (`_cloud`, `_finding`). That would drop M's index from the ORM.
    - C-C0 rebuilds the table in batch mode (`create_foreign_key`) on upgrade and downgrade. Its test
      checks only its own indexes.
    - The columns do not conflict: M adds none to `cloud_measurement`, and C adds
      `params, status, error, job_id, finding_id`.
    - **Resolution:** a C-C0 hand-off (below).

15. **Same-anchor additive blocks of the three C0s.** These are the blocks the amended R3 says to keep
    both of:
    - `contract/client/index.ts`: I-C0 and M-C0 both add after `export type TrainingRun = …`.
      C-C0 adds after `export type CloudMeasurement = …`.
    - The `JobType` enum: I adds 3 values, M 2, C 1.
    - The five job maps: I and M both add after `dataset_build:`. C adds after `pointcloud_export`.
    - `components/parameters`.

    No names collide: the new schemas, operationIds, parameters, aliases, JobTypes (`image_metadata`,
    `summary_rebuild`, `assist_acquire`, `elevation_import`, `drawing_import`, `pointcloud_profile`)
    and events are all distinct.
    **Resolution:** keep both, in merge order, and regenerate `schema.d.ts`; never hand-merge it
    (M-C0 hand-off).

**Checked and consistent (no change):**

16. **Migration chain.**
    - `0011` (I, `down_revision "0010"`) → `0012` (M, `"0010"` while building, then `"0011"` in its
      Task 9) → `0013` (C, `"0012"`, re-checked by `alembic heads` in its Task 1 and before merge).
    - Tables:
      - I: `image`, `box`, new `image_summary` and `image_measurement`.
      - M: `surface`, `volume_measurement`, `map_run`, `map_detection`, `site_area`, an index on
        `cloud_measurement`, and new `map_workspace`, `drawing`, `map_measurement`.
      - C: `cloud_measurement` columns, FK and index, and new `cloud_camera_offset`, `cloud_view`.
    - The only overlap is item 14.

17. **C reads I's pose columns.**
    - C-B3's `POSE_COLUMNS` reads `gimbal_yaw, gimbal_pitch, gimbal_roll, flight_yaw, focal_px,
      focal_mm, sensor_w_mm, orig_w, orig_h`. All nine are in I-C0's `IMAGE_COLUMNS` under exactly
      these names.
    - C also reads `lat, lon, alt, capture_time, width, height, source_id` and `source.kind`, which
      are already on `main`.
    - C-B3's Task 1 re-verifies them. Under the amended R3, C's batch 2 is cut after C-C0, which
      merges after I-C0, so the columns are there.

18. **Links and routes.**
    - **Finding deep links.** F's `findingHref` emits
      `images/:imageId?finding=`, `maps?map=<id>&finding=` and `clouds/:cloudId?finding=`. I-FW's
      `parseArrival`, M-W1's arrivals and C-X1/C-P1 read exactly these.
    - **Map ↔ 3D.** M-W1 and M-W4's `openIn3dHref` reuse S1's `clouds/:id?at=` shape, which C-X1
      keeps unchanged.
    - **I-FW's "Open in 3D".** It sends `clouds/:cloudId?from_image=<id>&px=u,v`, which C-X1's
      `parseFromImage` accepts. The id regexes differ (FW `^[A-Za-z0-9-]{1,64}$`, C
      `^[A-Za-z0-9_-]{1,128}$`), but both accept the UUID ids.

19. **VolumesScreen → `/measurements/volumes`.**
    - No I or C plan links to `/measurements` or `/volumes`.
    - C's job targets go to `clouds` (C-C0's `pointcloud_profile` → `clouds/<id>`).
    - The one F link (`ImportElevationDialog`) and the `resultTarget` group are M-W6's.
    - M-W6's cloud rows link to `clouds/<data_id>`, and C defines no measurement-selection
      parameter.

20. **Keymap.**
    - New `ui/keymap.ts` entries: only I-FC's four `Alt+Shift+Arrow` chords on the `images` nudge row.
      That is a workspace scope, and no global, review or other key uses `Alt+Shift+Arrow`.
    - M adds no key. C-X1 adds no key: its `clouds/keys.ts` resolves the existing `clouds` and
      `clouds.fly` scopes.
    - I-FA's 1–9 is F's `review` row, the same action as C-P1's and M-W4's.
    - `findCollisions(KEYMAP)` stays `[]`.

21. **Dependencies and packaging.**
    - M-B3 adds `pypdfium2==5.13.0` in `requirements*.txt`, `test_dependency_pins.py`,
      `kestrel_backend.spec` (`datas`, `binaries`), `smoke_frozen.ps1` (after `Complete-Step "design"`),
      `__main__.py` and `CONTRIBUTING.md`.
    - I-BS adds no package (Ultralytics 8.4.154 carries SAM 2.1). It edits `test_packaging_spec.py`
      and `smoke_frozen.ps1` (the `$SamWeights` param and a block before `# 7.`).
    - The anchors are disjoint. `test_dependency_pins` checks only named pins, so the shared venv
      gaining `pypdfium2` does not fail other worktrees.
    - Every new dynamically imported module is covered by the spec's `collect_submodules("app")`:
      I's `app.imagery.router`, `app.assist.router`; M's `app.workspace.*`, `app.drawings.*`,
      `app.mapmeasure.router`, `app.measurements.union`.

22. **Backend wiring anchors are disjoint.**
    - `api.py`: I-C0's loop right after `api_router = APIRouter(…)`, before `datasets_router`; M-C0's
      block at the end of the file; C none (its `SUB_ROUTERS`).
    - `main.py` `project_opened`: I-BX before and I-BK after `("model adoption", …)`; M-C0 after
      `"stale design inspection sweep"`; C-C0 after `"interrupted point cloud import sweep"`.
    - `projects/service.py`: I-BX in `__init__`; M-C0 after `volumes_dir`.
    - `models.py`: I edits `Image`, `Box` and adds classes after `Box`; M and C append at the end of
      the file (keep both).

23. **Multi-unit frontend files with adjacent hunks; the rebase keeps both.**
    - `e2e/shell.spec.ts` "old addresses land on the new tabs": I-FW changes the `/data` and
      `image-canvas` lines, M-W6 the `/volumes` line. M-W1 and M-X touch other tests.
    - `routes/projectRoutes.tsx`: import lines from I-FW, M-W1, M-W6 and M-X; route blocks from
      I-FW (images, review, query), M-W1 (maps), M-W6 (measurements) and M-X (`maps/:mapId`).
      C-X1 adds comment lines after `//   /p/:projectId/maps/:mapId?at=x,y`, a line nobody edits.
    - `routes/legacyRedirects.tsx` and `routes/routes.test.tsx` `CASES`: I-FW, M-W6, M-X.
    - `review/DetectReview.tsx` (+ test): I-FW changes the photo branch, M-X the map branch's
      `onOpenMap`.

## C0 hand-offs

For the coordinator to forward. The C0 plans themselves are not edited.

- **I-C0 (Task 5 Step 5, item 1).** Also edit `frontend/src/ui/useJobToasts.ts` and the two
  exhaustive switches; otherwise `tsc -b` fails.
  - `useJobToasts.ts` `TYPE_NAME`, after `dataset_build: "Dataset build",`:
    `image_metadata: "Camera metadata",`, `summary_rebuild: "Image summary rebuild",` and
    `assist_acquire: "Smart polygon model",`.
  - `useJobToasts.ts` `jobToastText`, after `case "dataset_build": return "Dataset built";`:
    `case "image_metadata": return "Camera metadata read";`,
    `case "summary_rebuild": return "Image summaries rebuilt";` and
    `case "assist_acquire": return "Smart polygon model ready";`.
  - `jobs/jobLabels.ts` `resultTarget`, directly before `case "import":`:
    `case "image_metadata": case "summary_rebuild": return { label: "Open images", to: \`${p}/images\` };`
    and `case "assist_acquire": return null;`.
  - Add `src/ui/useJobToasts.ts` to the step's `prettier --write` and to the commit's `git add`.
- **M-C0 (Task 9 rebase on I-C0, items 13 and 15).**
  - `backend/tests/test_contract.py`: I-C0 replaced `EXPECTED_STUBS: set[str] = set()` with an
    `EXPECTED_STUBS: set[str] = {…}` literal. Put `EXPECTED_STUBS |= workspace_stub_operation_ids()`
    on its own line directly after that literal's closing `}`, and keep the import.
  - At every shared additive anchor, keep I-C0's lines first and M's after them:
    - `contract/client/index.ts`: I's `// Images` alias block, then M's block, both after
      `export type TrainingRun`;
    - the `JobType` enum and `components/parameters`;
    - the five job maps after `dataset_build:`, and `jobToastText` after `case "dataset_build"`.
  - Then regenerate `contract/client/schema.d.ts`. Never hand-merge it.
- **C-C0 (Task 1, item 14).**
  - `backend/app/db/models.py`: the replacement body of `class CloudMeasurement` keeps M-C0's
    `Index("ix_cloud_measurement_created", "created_at", "id"),` in `__table_args__`, so there are
    three entries: `ix_cloud_measurement_cloud`, `ix_cloud_measurement_created` and
    `ix_cloud_measurement_finding`.
  - `backend/tests/test_migration_0013.py`, in the legacy-row upgrade test: the index assertion
    becomes `assert {"ix_cloud_measurement_cloud", "ix_cloud_measurement_created", "ix_cloud_measurement_finding"} <= indexes`.
  - In `test_0013_downgrades_to_the_previous_head`, add
    `assert "ix_cloud_measurement_created" in {r[1] for r in con.execute("PRAGMA index_list(cloud_measurement)")}`.
    Both batch rebuilds (`create_foreign_key` up, `drop_constraint` down) must carry M's index.

## Merge-order notes across sub-projects

No non-C0 unit has a **hard** cross-sub-project merge order. Every seam above is written so that
either order works, and the second unit to merge does the joining edit. What each pair's second
merger does, and the orders that save work:

1. **C0s:** I-C0 → M-C0 → C-C0, strictly (R3/R4; the 0011 → 0012 → 0013 chain and the item 13–15
   hand-offs). Under the amended R3, each sub-project's batch 2 is cut once its own C0 is on `main`.
   C's batch 2 therefore always sees `0011`, which C-B3 needs.
2. **C-B1 ↔ M-B4** (item 6): either order. The second adds the two `CLOUD_HEADLINES` entries: C-B1
   Task 8, or M-B4 Task 6 Step 7. M-B4 is held until M-B1 is on `main` (M's own rule).
3. **M-W1 ↔ C-W1** (items 2 and 5): either order. The second drops its duplicate `area` icon.
   C-W1's routeModel line anchors on either form of the `maps` line.
4. **M-W6 ↔ C-W1** (item 3): either order. The second extends the existing `pointclouds.changed`
   `if`. M-W6 is always after M-W1 (M batch 3).
5. **M-W4 ↔ I-FB** (item 4): either order. The second merges the `findings.changed` branch as
   specified.
6. **I-FB before M-W1, M-W3, C-P1 and C-L1** (item 10): preferred, not required. It lets them wrap
   known-id finding writes in `ownFindingsWrite`. A unit that lands first keeps `bumpFindings()`.
7. **C-W1 before M-X** (item 7): preferred. M-X then edits the workspace's "Show on map" directly.
   Otherwise the old URL is carried by M-X's `MapRedirect`.
8. **M-X ↔ C-G** (item 8): either order. The second keeps the other's `clouds.spec.ts` tests.
9. **I-FW before C-L1 and C-G** (item 9, R7): preferred. C's e2e asserts only the arrival URL until
   I-FW is on `main`. With I-FW in, C-G can assert the ring and "Back to 3D" chip, including the
   pixel-less `?from=cloud:` chip.
10. **I-BA and I-BP ↔ M-B5** (item 11): either order. Keep both hunks in `detect/runs.py`,
    `detect/review.py`, `findings/service.py` and `tests/test_detect_runs.py`.
11. **I-E, M-X and C-G** (item 12): any order. Each puts its `docs/progress.md` entry on top.
    **IMC-X** runs last, after all three evidence units (R9). It runs `smoke_frozen.ps1` with both
    I-BS's `sam ok` and M-B3's `drawings-selftest` steps.
