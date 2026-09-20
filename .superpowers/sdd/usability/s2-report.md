# S2 Datasets screen — implementation report

Branch `s2-datasets-screen`, worktree `E:\Dev\Yolo\app\.worktrees\s2-datasets-screen`.

## Commits (in order)

1. `6cb373a` contract: deleteDataset (S2) — pre-existing on the branch before this run (client already
   regenerated), per the task brief.
2. `d84d7e1` feat(datasets): delete a dataset (S2) — Task 1.
3. `c7726a1` feat(datasets): api helpers and split advice (S2, S3) — Task 2.
4. `cd273bf` feat(datasets): Datasets screen (S2) — Task 3.
5. `05cde47` feat(datasets): links from the dataset dialog and the Train form; e2e (S2) — Task 4.

Range for review: `0d8bef2..05cde47` (`0d8bef2` = branch base, merge of usability-wave1).

## What was built

- Backend: `DELETE /api/v1/projects/{projectId}/datasets/{datasetId}` (`app/datasets/materialise.py:
  delete_dataset`, wired in `app/datasets/router.py`). Removes the `Dataset`/`DatasetImage` rows and the
  frozen `datasets/<name>` folder; refuses with 409 `conflict` while a `train` job whose
  `params.dataset_id` matches, or the dataset's own materialise job, is queued or running. Folder removal
  refuses anything whose resolved path is not inside `<project>/datasets` (`_remove_dataset_folder`).
  Tests: `backend/tests/test_dataset_delete.py` (4 tests: removes folder+rows+keeps images and frees the
  name, refuses while a train job uses it, a model trained on a deleted dataset still lists, unknown id
  is 404).
- Frontend API: `deleteDataset` in `frontend/src/api/datasets.ts` (`fetchDatasetStats` already existed).
- `frontend/src/datasets/splitAdvice.ts`: warns when `val_count === 0`, or when a `by_group`/`by_tile`
  split's achieved validation fraction differs from the requested one by more than 0.1 (walk-through S3,
  the 14-image / 8-6 / 43% example). Never warns for `random`.
- Screen: `frontend/src/screens/DatasetsScreen.tsx` at the new route `/p/:projectId/datasets`, sidebar
  entry "Datasets" between Review and Models (`Shell.tsx`). Parts: `DatasetList` (click or Enter on a
  focused, `tabIndex=0` row), `DatasetDetail` (split advice, per-class and per-group stats from
  `getDatasetStats`, folder path, "Train on this dataset" link, inline-confirmed "Delete dataset" that
  surfaces a 409 as an alert), `NewDatasetForm` (freezes every labeled image, no `image_ids` in the
  request; same name rule/hint as `AddToDatasetDialog`, never a `pattern` attribute). The list reloads via
  `useOnJobsFinished("dataset", reload)`.
- `nextStep.ts`: both dataset-related steps now link to `/p/<id>/datasets` (was `/data`); `nextStep.test.ts`
  updated.
- `TrainForm`/`TrainScreen`: added `initialDatasetId` prop / `?dataset=` query param so
  "Train on this dataset" preselects the right dataset instead of relying on it being the newest
  (`datasets[0]`). "Create dataset" link now targets `/datasets`; parenthetical is now "(or select images
  in the Data Manager and use Add to dataset)".
- `AddToDatasetDialog`: once its job succeeds, refetches the dataset (a failed job discards it, so the
  fetch only happens post-success) and then shows the split advice and an "Open dataset" link to
  `/p/:id/datasets?dataset=<id>`, alongside the existing "Train on it" link.
- `e2e/datasets.spec.ts` (2 tests): the example dataset `v1` lists with its train/val split, opening it
  shows per-class (`excavator`) and per-group (`0031`/`0033`) stats and the "Train on this dataset" link,
  delete asks for confirmation and sends the `DELETE` request; a second test opens the new-dataset form
  and confirms the POST body has no `image_ids`. `e2e/train.spec.ts` updated for the new "Create dataset"
  href.

## Test counts (final run, this session)

- Backend `pytest -q`: **452 passed, 9 deselected**, exit 0.
- Backend `ruff check .`: all checks passed, exit 0.
- `contract/pnpm check` (spectral lint + regenerate + `git diff --exit-code`): passed, exit 0, no diff
  (contract was not modified this session beyond the pre-existing `deleteDataset` commit).
- Frontend `pnpm lint` (eslint + prettier --check): passed, exit 0.
- Frontend `npx tsc --noEmit -p .`: passed, exit 0.
- Frontend `npx vitest run`: **357 passed** (96 files), exit 0.
- Frontend `pnpm build`: succeeded, exit 0 (one pre-existing >500kB chunk-size warning, unrelated to this
  change).
- Frontend `pnpm e2e`: **50 passed**, exit 0 (includes the 2 new `datasets.spec.ts` tests).

## Deviations from the plan, with reasons

- The plan's Task 1 test sketch names a `labeled_dataset` fixture as if already present in
  `tests/test_datasets.py`; it isn't (that file has `labelled_project`, British spelling, plus a local
  `_create_dataset` helper). I added a local `labeled_dataset` fixture directly in
  `test_dataset_delete.py`, built the same way (nine labelled frames in two flights, one dataset `v1`),
  rather than importing private helpers across test modules.
- Plan's Task 3 wording for "Train on this dataset" says to link to `/p/:id/train?dataset=<id>` and "check
  how the dataset job card's 'Train on it' link is built and reuse it". The existing `resultTarget()` for
  a `dataset` job (`frontend/src/jobs/jobLabels.ts`) only ever links to `/train` with no query param
  (relying on the newest dataset being `datasets[0]`, noted in the walk-through as "already fine" for that
  one case). Since the Datasets screen must let a user pick *any* dataset, not just the newest, I extended
  `TrainForm`/`TrainScreen` with a real `initialDatasetId`/`?dataset=` mechanism instead of only copying
  the existing (param-less) link. `JobCard`'s own "Train on it" link for a `dataset` job was left
  unchanged (still `/train`, no param) since the plan did not ask for that one to change and its behavior
  (newest dataset) is already covered by the walk-through's "verified as already fine" note.
- `AddToDatasetDialog`'s existing "Train on it" link was left pointing at plain `/p/:id/train` (unchanged);
  only the new "Open dataset" link and the split-advice line were added, per the plan's Task 4 wording.
- Minor: `DatasetDetail`'s folder path is shown as a single `<dl>/<dt>/<dd>` pair rather than the wider
  `ModelDetail`-style 4-column grid, since a dataset detail has only one such fact (the plan only asks
  for "folder path", not a `dl` layout specifically).

## Not done / open points

- Nothing from the plan's four tasks was skipped. All checkboxes' test-then-implement steps were done
  test-first (each failing for the expected reason — 405 for the missing DELETE route, then the
  component/screen tests failing on missing modules — before implementation).
- No installer/build.ps1/smoke_frozen.ps1 run, no dev backend was started (all backend verification used
  the existing pytest suite; no manual E2E-against-a-live-backend check was performed beyond the Prism-
  mocked Playwright suite the plan asks for).

## Fix round 1 (code review of 0d8bef2..05cde47), frontend only

Scope: frontend only, per the goal owner's instruction; `backend/` untouched this round (the owner is
fixing `delete_dataset` on another branch). Commit range: `bf547af..917ad49` on `s2-datasets-screen`.

| Finding | Commit | Evidence |
|---|---|---|
| I4: a model pointing at a deleted dataset must read "deleted dataset", not a UUID | `bf547af` | `useDatasetNames` now returns `{names, loaded}`; new tests `src/models/useDatasetNames.test.tsx` (2), `src/models/ModelTable.test.tsx` (3, new file), plus 2 new cases in `ModelDetail.test.tsx`. All fail-then-pass verified while writing (hook test written and watched fail before the hook change; component behaviour is a straight consequence of the same type change, verified pass). |
| I5: an unknown `?dataset=`/`initialDatasetId` must not stick once the list loads | `76f439a` | `TrainForm`'s list-arrival effect: `datasetId` now falls back to `datasets[0]?.id ?? ""` once a non-empty list arrives and does not contain it, but survives while the list is still empty. New tests in `TrainForm.lists.test.tsx`; manually reverted the fix and reran — the new "falls back" test failed with the wrong dataset id selected, confirming it exercises the change; restored and reran green. |
| I6: the "reloads once the job is closed" test must really test it; add a delete test that fails when the production line is removed | `917ad49` | `DatasetsScreen.test.tsx` rewritten: the reload test now drives a `dataset` job through `useJobsStore` from `running` to `succeeded` and asserts a second `GET /datasets` plus the new row; the delete test uses a deliberately-hanging second `GET /datasets` (custom `fetch` impl, not the simple `fakeClient`) to prove the row and detail disappear, and `?dataset=` clears, before that request even resolves. Verified by temporarily deleting the `useOnJobsFinished("dataset", datasets.reload)` line: the reload test failed (`dataset-table` never got its row); restored, reran, green (9/9). Also verified by temporarily reverting `DatasetsScreen.tsx` to the pre-fix `onDeleted` (no `remove()`): the delete test failed with the row still visible; restored, reran, green. |
| M2: `splitAdvice` wording per split method, actionable closing sentence | `9e6de98` | "was asked" → "was requested"; `by_group` → "whole flights stay together" / "more flights", `by_tile` → "whole map tiles stay together" / "more places"; new closing sentence. `splitAdvice.test.ts` updated + a new by_tile case; watched both fail against the old strings before editing `splitAdvice.ts`. |
| M3: advisory text is `role="note"`, not `role="alert"`; compute `splitAdvice` once in the dialog | `6909c76` | `DatasetDetail.tsx` and `AddToDatasetDialog.tsx` advice paragraphs are now `role="note"`; the dialog computes `advice = succeeded ? splitAdvice(succeeded) : null` once. New/updated tests assert `getByRole("note")` and that no stray `alert` exists. |
| M4: "Loading…" while dataset stats load; drop the redundant stale-stats guard, keep the parent's `key` | `6909c76` | `useDatasetStats` no longer re-checks `state.datasetId === datasetId` (the caller's `key={dataset.id}` on `DatasetDetail` already forces a fresh mount per dataset). New test asserts "Loading…" shows then disappears; watched it fail first (no such text) before adding the paragraph. |
| M5a: unknown `?dataset=` says "That dataset no longer exists." once loaded | `917ad49` | New paragraph, `role="note"`, gated on `selectedId && !selected && !loading && !unavailable`. Test checks it is absent while loading and present once the (non-matching) list has loaded. |
| M5b: the deleted row disappears at once, before the reload lands | `917ad49` | `useDatasets` gained `remove(id)` (optimistic local filter); `DatasetsScreen.onDeleted` calls `remove(id)` before `reload()`. Proven with the hanging-GET test above (M5b and I6 share the same commit and test). |
| M5c: "1 dataset" / "N datasets" | `917ad49` | Ternary on `datasets.datasets.length === 1`. New singular test; the existing plural case already read correctly (no regression risk there). |
| M5d: "Datasets are not available." (drop the parenthetical) | `917ad49` | Text changed in the 501 branch; test updated to the new exact copy. |
| M5e: a dataset whose materialise job is queued/running shows "being written…", failed/cancelled shows "incomplete", both hide "Train on this dataset" | `538b3ee` | `DatasetDetail` reads `dataset.job_id` from the jobs store only (`useJobsStore` selector, no extra fetch — recent jobs are already loaded project-wide via `useInitialJobs`); two new tests seed the store with a running/failed job sharing the dataset's `job_id` and assert the badge text and the absent Train link. Kept deliberately simple per the finding's own allowance ("keep it simple"): an old dataset whose job has aged out of the recently-loaded set is treated as normal, which matches how every other job-derived UI in this app already behaves (e.g. `ModelTable`'s "Training job" column). |
| M6: `NewDatasetForm` sends the validated name verbatim (no `trim()`) | `8416767` | Dead-code removal only (the regex already rejects all whitespace, so `.trim()` was always a no-op after validation passed); no test could distinguish before/after, so this one is not "test-first" in the failing-test sense — the existing exact-body assertion in `NewDatasetForm.test.tsx` already covers the sent value. |
| M7: "Open dataset" needs only the created id + a succeeded job, not a refetch; "Train on it" carries `?dataset=` | `6909c76` | `AddToDatasetDialog` no longer imports `fetchDataset`; it keeps the `Dataset` object from the creation response directly. `advice`/"Open dataset" gate on `job?.state === "succeeded" && createdDataset`; "Train on it" carries `?dataset=<id>` as soon as the id is known (not gated on success). Updated `AddToDatasetDialog.test.tsx` (including a new "while running, neither shows" case) and the two e2e files (`data-manager.spec.ts`, `datasets.spec.ts`) that asserted the old plain `/train` href. |
| M9: `DatasetList` selects via a real `<button>`, drops the redundant `role="row"` and the custom Enter handling | `d95dbcd` | Matches `ModelTable`'s pattern: the dataset name is a `button` (native Tab/Enter/Space), the row keeps a click-anywhere handler. `DatasetList.test.tsx` rewritten around `getByRole("button", { name: "Select dataset v1" })`; watched it fail against the old `<tr tabIndex>` markup before editing `DatasetList.tsx`. |

Not touched, as instructed: M1 (backend, the goal owner's), M8, M10.

### Verification (this round)

- Frontend `pnpm lint`: exit 0 — `eslint src && prettier --check src`, "All matched files use Prettier code style!"
- Frontend `npx tsc --noEmit -p .`: exit 0, no output.
- Frontend `npx vitest run`: exit 0 — **377 passed** (99 files).
- Frontend `pnpm build`: exit 0 (`tsc -b && vite build`; one pre-existing >500 kB chunk-size warning, unrelated).
- Frontend `pnpm e2e`: exit 0 — **50 passed** (all existing specs plus the 2 `datasets.spec.ts` tests).
- `contract/pnpm check`: exit 0 (spectral lint clean, regenerated `client/schema.d.ts` matches the committed
  one — the contract was not touched this round).
- Backend `python -m pytest -q` (unchanged by this round; run once for the record): see below.

Backend suite was re-run for the record only; no backend files were edited this round: `python -m
pytest -q` → **452 passed, 9 deselected** in 131.6s, exit 0 (unchanged from the S2 report above).

## Fix round 2 (scoped re-review of bf547af..917ad49), frontend only

Scope: frontend only, per instruction; `backend/` not touched (the goal owner is reworking
`delete_dataset` elsewhere). New rule this round: before every git write, ran `git branch
--show-current` and confirmed `s2-datasets-screen` before committing — done before every commit
below. Commit range: `917ad49..3f509c9` on `s2-datasets-screen`.

| Finding | Commit | Evidence |
|---|---|---|
| I-B1: `AddToDatasetDialog` "Train on it" only carries `?dataset=` once the job has succeeded (same rule as "Open dataset"); plain otherwise (running, failed/cancelled) | `55271c9` | `succeeded` (already computed for "Open dataset") now also gates the "Train on it" href. New tests for running (plain), succeeded (carries id; disambiguated with `getAllByRole` since the finished `JobCard` shows its own "Train on it"), and failed (plain). Watched all 4 changed/new assertions fail first (the running-case assertion also had to flip from asserting the id to asserting plain, since that was the bug). Updated `e2e/data-manager.spec.ts` (the mock's job never reaches "succeeded", so it now asserts the plain link) and dropped the now-unused `DATASET` constant there. |
| I-B2: `TrainForm` shows a note next to the Dataset picker when a non-empty `initialDatasetId` is not in a loaded, non-empty list | `7dbb314` | Pure derived boolean (`initialDatasetMissing`) from props, no new state. New tests: shows the exact copy once the list arrives and the id is missing; absent while still loading; absent for a valid id or no id at all. |
| Minor: `splitAdvice`'s closing sentence follows the method (by_group: "one flight"; by_tile: "one place") | `06bbefc` | New `RANDOM_RISK` map keyed by split method. Fixed the by_tile test, which had pinned the by_group wording; watched it fail against the old shared string first. |
| Minor: `DatasetsScreen` "not available" gives a real recovery step | `aae61a0` | Read `AppSettingsScreen.tsx` (only renders `ProvidersSection`, no log path anywhere) and `ErrorBoundary.tsx` (has a "Copy diagnostics" button) to pick the true copy: "Datasets are not available. Restart the app; if it persists, use Copy diagnostics in the error dialog." Test updated to the exact new copy. |
| Minor: zero datasets + unknown `?dataset=` shows only the empty state | `aae61a0` | Added `datasets.datasets.length > 0` to the "no longer exists" note's condition (same commit as the copy fix, both in `DatasetsScreen.tsx`). New test: zero datasets + bad `?dataset=` shows the empty state and not the "no longer exists" note. |
| Minor: `DatasetList` name-button click must not also fire the row's `onClick` | `4259f54` | The button's `onClick` now calls `e.stopPropagation()` before `onSelect`. New test asserts `onSelect` is called exactly once per click on the button (it was 2 before the fix — reproduced and watched fail first). |
| Minor: `AddToDatasetDialog` sends the validated name as-is (no `trim()`) | `55271c9` | Same commit as I-B1 (both touch this file); dead-code removal, same reasoning as round 1's `NewDatasetForm` fix — the regex already rejects all whitespace. |
| Minor: remove dead `fetchDataset` (api/datasets.ts + its test) and the unread `StatsState.datasetId` | `8d6e4e1` | Confirmed with `grep -rn "fetchDataset\b" src` that nothing outside its own definition/test called it (the I-B1/M7 work in round 1 already stopped using it). Removed both; updated `api/datasets.test.ts` to drop the now-removed call and its now-unmatched fake route, and renumbered the request-index assertion. |
| Minor: keep "incomplete" reachable when the job is not yet in the jobs store (fetch once) | `8d6e4e1` | `DatasetDetail` now uses `useTrackedJob(projectId, dataset.job_id)` (checks the store first, fetches once otherwise, matching the hook's existing, already-tested behaviour) instead of a bare `useJobsStore` selector. New test: jobs store starts empty, `GET /jobs/{id}` mocked to return a failed job sharing the dataset's `job_id`; "incomplete" appears and the Train link is hidden. Watched it fail first (no fetch ever happened, so the badge never appeared). |
| Minor: `useDatasetNames.test.tsx`'s bare `setTimeout(10)` | `3f509c9` | Replaced with `await act(async () => { await fetchDatasets(api, PROJECT_ID).catch(() => {}); })` — an explicit flush of the same rejected request the hook awaits internally, run 3× locally to confirm it is not flaky. |

### Verification (this round)

- Frontend `pnpm lint`: exit 0 — `eslint src && prettier --check src`, "All matched files use Prettier code style!"
- Frontend `npx tsc --noEmit -p .`: exit 0, no output.
- Frontend `npx vitest run`: exit 0 — **382 passed** (99 files).
- Frontend `pnpm build`: exit 0 (`tsc -b && vite build`; the same pre-existing >500 kB chunk-size warning).
- `contract/pnpm check`: exit 0 (spectral lint clean, regenerated `client/schema.d.ts` matches the
  committed one — the contract was not touched this round).
- Frontend `pnpm e2e`: **NOT RUN.** Ports 1420 and 4010 were held throughout this session by
  persistent `node` processes rooted in the *main checkout* (`E:\Dev\Yolo\app\frontend`'s `vite` and
  `E:\Dev\Yolo\app\contract`'s `prism mock`, confirmed via each PID's command line), not a
  transient test run: I checked and waited in several rounds (roughly 30 minutes total, re-checking
  every ~10s within each wait and retrying the whole wait multiple times) and the PIDs kept
  changing (a dev server being restarted) while the ports stayed occupied throughout. Per the hard
  rules I did not start Playwright against someone else's server (it would have silently tested the
  main checkout's code instead of this branch's) and did not touch those processes. This is the one
  gate not completed this round; everything else (lint, tsc, vitest, build, contract check) is green.

Backend: not run this round (not requested, and out of scope — `backend/` was not touched).

