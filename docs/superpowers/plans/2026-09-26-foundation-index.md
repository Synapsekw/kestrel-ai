# Foundation: execution index

> **For agentic workers:** this is the coordinator's map of the nine Foundation unit plans. Each
> unit is executed with superpowers:subagent-driven-development in its own worktree. Read the unit
> plan you were given, this index, and the spec. Do not execute this index itself.

**Spec:** `docs/superpowers/specs/2026-09-26-foundation-design.md` (umbrella:
`2026-09-26-inspection-platform-design.md`)

**Goal:** land Foundation (sub-project F) on `main`:
- the Aero glass design system and shell
- projects without a kind
- the Data list
- the catalogue and severity scale
- the Finding core
- the Models section
- migration
- the Overview dashboard, Jobs and the app screens

## Unit plans

| Unit | Plan | Worktree / branch | Cut after |
|---|---|---|---|
| C0 contract | `2026-09-26-foundation-c0-contract.md` | `f-c0` / `task/f-c0` | nothing (current `main`) |
| DS design system | `2026-09-26-foundation-ds-design-system.md` | `f-ds` / `task/f-ds` | C0 merged (DS needs no contract, but cut after C0 so its gate runs on the new client) |
| BK kind removal, data list, search, jobs | `2026-09-26-foundation-bk-kind-removal-data-list.md` | `f-bk` / `task/f-bk` | C0 merged |
| MG-framework | `2026-09-26-foundation-mg-migration.md` Part A | `f-mg-framework` | C0 merged |
| BC catalogue, findings, `0010` | `2026-09-26-foundation-bc-catalogue-findings.md` | `f-bc` | C0 merged (rebases onto BK and MG-framework before merging) |
| BM models backend, library `0002` | `2026-09-26-foundation-bm-models-backend.md` | `f-bm` | C0 merged (swaps its catalogue stub for BC's after BC merges) |
| SH shell | `2026-09-26-foundation-sh-shell.md` | `f-sh` | DS and C0 merged |
| MG-steps | `2026-09-26-foundation-mg-migration.md` Part B | `f-mg-steps` | MG-framework, BC and BM merged |
| S1 project screens | `2026-09-26-foundation-s1-project-screens.md` | `f-s1` | SH, BC and BK merged |
| S2 app screens | `2026-09-26-foundation-s2-app-screens.md` | `f-s2` | SH, BC and BM merged |
| X evidence | this file, section "Unit X" | `f-x` | everything above merged |

## Batches and merge order

Worktrees in the same batch are built **concurrently**. Merges into `main` are **serialized**:
one `scripts\finish-task.ps1` at a time, and each later unit rebases onto the new `main` before
its gate.

1. **C0** alone.
2. **DS ∥ BK ∥ MG-framework ∥ BC ∥ BM.** They build together, and merge in this order:
   1. BK (removes the kind guard the others' tests would hit)
   2. MG-framework (the backup guard must be on `main` before BC's `0010`; this supersedes spec
      §18's order)
   3. BC
   4. BM
   5. DS (independent of the backend units; it may merge at any point in this batch, whenever it
      is ready)
3. **SH ∥ MG-steps.** Neither waits for the other.
4. **S1 ∥ S2.**
5. **X.**

**Critical path:** C0 → DS → SH → S1 → X. The backend chain C0 → BC → BM → MG-steps must finish
before X.

## Rules while Foundation is in flight

- **No installer is built from `main`** from the C0 merge until X passes. Between BK and SH, the
  real app's frontend reads `kind` through C0's `legacyKind.ts` shim and treats every project as
  `train`, so detection screens are unreachable in a real build. The mock-backed e2e gate is
  unaffected. The operator keeps using the installed build of `3ad69e4`.
- The main checkout must be clean before any `finish-task.ps1`. The `.superpowers/brainstorm/`
  mockups are git-ignored once this plans branch merges; merge `task/inspection-specs` to `main`
  **before** C0 starts.
- Deprecated contract paths (C0) are removed by the unit that deletes their last caller:
  - `PUT /classes`: S2 (reconciled: S2's Task 15 deletes `ClassesSection`, its last caller)
  - `/datasets*` and `/train`: S2 (BM retires the backend routes)
  - `/maps/{mapId}/move`: SH (BK deletes the backend route)
- `legacyKind.ts` (C0) is deleted by SH.
- The `?` shortcut sheet is owned by SH (it renders DS's keymap table; there are no new keys).
- The project type list editor in project settings is owned by S2 (its Task 15, no longer
  conditional).

## Unit X: evidence

X is small enough to specify here. It runs in worktree `f-x` after every unit has merged.

- [ ] **Step 1:** Cut `f-x` from `main`. Run the full gate (AGENTS.md item 4). Expected: green.
- [ ] **Step 2:** Add or complete the e2e specs of spec §16 that the units left to X. Each unit
  plan lists its own specs; X adds only the cross-unit flows. The full journey is:
  1. create a project
  2. Add data (images)
  3. set the type list
  4. accept a detection as a finding
  5. set its severity
  6. see it in Findings and on the Overview
  7. build a dataset in Models from that project
  8. see the training form accept it

  Commit it as `frontend/e2e/foundation-journey.spec.ts`.
- [ ] **Step 3:** Frame-time check (spec §4.3 and §16): run DS's probe e2e on the Overview and the
  Findings tab with effects Full, and record the p95 frame time in the evidence. Expected: under the
  spec's budget, or the Auto mode switches to Reduced.
- [ ] **Step 4:** Run the real-folder migration dry run (MG Part B, its final task), again on
  `main`. Store its report in `docs/evidence/foundation-migration/`.
- [ ] **Step 5:** Build the frozen sidecar and the installer. Install it. Run the operator
  walkthrough below and capture native screenshots into `docs/evidence/foundation/`.
- [ ] **Step 6:** Add a `docs/progress.md` entry, run `/wrapup`, then `finish-task.ps1`.

**Operator walkthrough (on the installed build):**
1. Open the app. Projects appear as cards; each migrated one shows "Upgraded".
2. Open AHTest. The Overview shows KPI tiles counting up, the map hero, severity bars and activity.
3. Catalogue: the migrated types are listed as Object, with a banner asking you to classify them.
   Mark one as Defect, run the backfill, and see findings appear.
4. Findings tab: filter by severity, open a finding, set severity with the keys 1–4, add a note, a
   photo and a comment, and copy its link.
5. Add data: the five tiles open the right importers.
6. Models: build a dataset across two projects, and start training on it.
7. Jobs: the running training shows progress, a log and cancel.
8. Settings → Appearance: switch effects to Reduced. The glass becomes solid and the app stays
   smooth.
9. Press Ctrl K and jump to a finding by its number.

## Operator decisions carried into execution

1. The primary button's white-on-violet contrast is 3.26:1 (DS), below the 4.5:1 target.
   **Decided:** darken the gradient so white text on the primary button reaches 4.5:1, keeping the
   violet→indigo look (DS: `--primary-from` #7258ff, `--primary-to` #3766ff; the contrast test
   asserts ≥ 4.5:1 with no named exception).
2. A recent project whose folder or `project.db` is gone (MG). **Decided:** it is **listed**, as a
   card in the state "Folder not found" with "Remove from list" and "Locate folder…". C0 adds
   `Project.availability: ok | missing`; MG lists it and makes Remove and Locate work; S1 renders
   the card. Locate reuses `POST /projects/open`; no new path.
3. The comment author's name. BC reads `operator_name` from backend `settings.json`; S2 stores
   "Your name" in localStorage. **Decided:** S2 writes the name through `GET/PUT /settings/operator`
   (C0 adds it, BC builds it), and BC stays the reader. Nothing is kept in localStorage.
4. **Decided:** the installer freeze stays as written in "Rules while Foundation is in flight".

## Coordinator rulings after reconciliation (binding on executors)

1. **`updateClasses`** is retired by **S2** (its Task 15 deletes the last caller). Confirmed.
2. **`JobsPanel`, `JobsButton` and `panelOpen`** (spec §5.1) are deleted by **S2**, in its Jobs-section
   task. Whichever of S1 and S2 merges second fixes the other's leftovers. If S1 is on `main`
   first, S2 also removes S1's test resets of `panelOpen`.
3. **The Findings keys** (J/K/Enter, Shift+O/R/C) are registered by **S1** as a `findings` scope in
   DS's `ui/keymap.ts`, not in a private `FINDINGS_KEYS`. This way they appear in SH's `?` sheet and
   the collision test covers them. S1's Task 7 adds the entries and runs the keymap collision test.
4. **MG step 6 through BC's `findings_from_annotations`:**
   - The MG Part B executor confirms the `created_by`, `lon`/`lat` and `data_id` expectations
     against BC's `create_in_session` as merged.
   - It closes or commits the step's own session before calling BC's function, so two writers never
     hold the SQLite database at once.
   - A test runs step 6 on a project with more than 1000 boxes, and asserts no `database is locked`
     error.

## Reconciliation log (2026-09-26)

One line per change: what, and which plan files (`bk`, `bc`, `bm`, `c0`, `ds`, `mg`, `s1`, `s2`, `sh`, `index`).

1. Merge order is BK → MG-framework → BC → BM (DS any time) in every header, DAG text and precondition. Files: bk (DAG position), bc (header, DAG position, Task 14 Step 3), bm (DAG position, Task 11 precondition and its log check), mg (merge-order note now says the index adopts it).
2. BC is cut after C0 alone; before Task 5 it waits for BK and rebases (new Step 0), and before its merge it confirms BK and MG-framework are on `main`. Files: bc.
3. DS preflight checks that C0 has merged (DS is cut after C0 per this index). Files: ds.
4. BK keeps C0's `RETIRING` entry for `moveMapToProject` (the path stays `deprecated` until SH); its preflight now expects `/move:` in the contract. Files: bk.
5. BC and BM keep C0's `RETIRING` entries when they delete the `/classes`, `/datasets*` and `/train` routes (they no longer delete "allowances"). Files: bc, bm.
6. `updateClasses` is retired by S2, not S1: S2's Task 15 deletes `ClassesSection`, its last caller. `x-retire-with: F-S2` in C0's YAML, tests and hand-off table; the index's deprecated-paths line updated. Files: c0, index, s2.
7. S2 retires the deprecated contract operations whose last callers it deletes: new Task 11 Step 6b (the five `/datasets*` operations and `trainModel`) and Task 15 Step 4b (`updateClasses`, `saveClasses`), each with its `RETIRING` entry and a regenerated client; the "S2 edits neither" constraint now allows exactly this. Files: s2.
8. S2's Task 15 (project type list editor) is unconditional; its skip precondition is gone. SH and S1 have no competing task. Files: s2.
9. SH deletes `legacyKind.ts` and its test in Task 11, replaces `legacyKind`/`legacyCreateBody`/`withLegacyKind` in the remaining importers, and its grep gate checks all three names and `Test-Path`. Files: sh.
10. SH retires `moveMapToProject` and `MapMoveRequest` from the contract (new Task 11 Step 4b) and may now edit `contract/` for that only; SH's deviation 10 no longer claims C0 removed the dataset and train endpoints; Task 15 expects a regenerated `schema.d.ts`. Files: sh.
11. SH owns the `?` shortcut sheet: new Task 10b (`app/ShortcutSheet.tsx` renders DS's `keysFor(scope)`, with a test), deviation 12 and spec coverage updated. Files: sh.
12. SH uses DS's real props: `CommandSource {id, label, minQuery?, search → Command[]}` (search split into two sources sharing one request), `MenuButton` for "More", `Tabs` `value?`, and `StatusDot` `idle` for the idle dot. Files: sh.
13. S2 uses DS's real names: `DataTable` `rowKey`/`activeKey`, `Column<T>` (was `DataColumn`), `InspectorPane` with `label`, `Tabs` items with `id`, `SeverityPicker` `allowNone`, and `SeverityScaleContext.Provider` (DS ships no `SeverityScaleProvider`). Files: s2.
14. S1 uses DS's real names: `DataTable` `label`/`onSelectionChange`, `Column<T>` with string widths, `InspectorPane` (was `InspectorLayout`), `InspectorSection title`, `ComboboxList onSelect` inside its `Popover`, `SeverityPicker allowNone`. Files: s1.
15. Finding creation from boxes: MG step 6 calls BC's `app.findings.backfill.findings_from_annotations(handle, None, …)`; MG's `create_findings_for_boxes` and its three finding ports (`next_finding_number`, `created_by`, `insert_image_finding`) are removed from Tasks 9 and 14. Files: mg, bc (hand-off line).
16. `runner.catalogue` is wired by BC (its Task 1 already sets `app.state.jobs.catalogue`); MG-steps only verifies it. Files: mg, bc (hand-off line).
17. Operator name: C0 adds `GET/PUT /settings/operator` (`getOperatorSettings`/`putOperatorSettings`, schema `OperatorSettings`) to Task 3; BC builds it in Task 10 (`operator_router.py`, keeps the other `settings.json` keys) and stays the comment-author reader; S2's `operatorName.ts` calls the API instead of localStorage; S1 shows the server's `author`. Files: c0, bc, s2.
18. `POST /catalogue/classification/done` and `CatalogueTypePage.needs_classification` (in C0, assigned to BC) were not in BC's plan: BC Task 4 now builds both; S2 reads the typed field. Files: bc, s2.
19. `revealProjectBackup` (in C0, assigned to MG) was in no plan: MG Task 7 builds it on `app.exports.reveal.launch`; S1's Details dialog gets "Reveal backup". Files: mg, s1.
20. Migration warnings on the Overview (spec §9.1, and BC expects MG to register one) were in no plan: MG Task 15 Step 4b adds `app/migration/banners.py` with a test. Files: mg.
21. Operator decision 1 (contrast): DS adds `--primary-from`/`--primary-to` (#7258ff, #3766ff), builds `--grad-primary` from them, drops the named exception and asserts ≥ 4.5:1 for white on both stops (white on `--accent` stays as a 3:1 non-text boundary). Files: ds, index.
22. Operator decision 2 (missing folders): C0 adds `ProjectAvailability` and a required `Project.availability`, and changes `listProjects`' summary; MG lists missing folders, makes `forget` work for them, dedupes `AppData.remember` by project id, and deliberately changes `test_recent_skips_deleted_folders`; S1 adds the "Folder not found" card with Remove from list and Locate folder…, with tests; SH's palette skips projects that do not open. Files: c0, mg, s1, sh, index.
23. Operator decisions 3 and 4 recorded as decided (operator name through the backend; installer freeze unchanged). Files: index.
24. S2 creates `e2e/datasets.spec.ts` (SH deletes the old one) instead of "modifying" it. Files: s2.
25. SH's deviation 3 no longer claims that S2 deletes `JobsPanel`, `JobsButton` and `panelOpen`: S2's plan deletes only `InterimJobs`. Files: sh.

Verified unchanged: migration ids (project `0010` BC, library `0002` BM, catalogue `0001` BC, no Foundation plan takes catalogue `0002`, MG writes none); `tests/project_factory.py::new_project(client, folder, *, name="T", classes=None)` is BK's and BC's with one signature, and MG's helpers do not duplicate it; event names (`data.changed`, `findings.changed`, `catalogue.changed`, `migration.changed`), store names (`dataRevision`, `findingsRevision`, `projectsRevision`, `catalogueRevision`), job types and the `appRoutes`/`projectRoutes` paths agree across plans; every operationId and `/api/v1` path the other plans use exists in C0 or today's contract; S1's `openAddData(tile?)` is its own thin wrapper over SH's `useAddData.show`; S2 uses only `useProvideRouteActions` with `variant?`/`to?`.
