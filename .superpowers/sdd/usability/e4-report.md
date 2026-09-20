# E4 Negative Images — Implementation Report

Branch: `e4-negative-images`, worktree `E:\Dev\Yolo\app\.worktrees\e4-negative-images`.
Base (already on branch, not mine): `916942c` contract: marked_empty on Image, updateImage,
bulkMarkEmpty (E4); `3a34ecf` merge of `usability-wave1`.

## Commits (this work), oldest first

| Commit | Subject |
|---|---|
| `0afa7da` | feat(images): marked_empty column; labeled means boxes or marked empty (E4) |
| `5bb236f` | feat(images): mark images empty, single and bulk (E4) |
| `2aa1a10` | feat(datasets): negatives enter datasets; new ground truth clears the empty mark (E4) |
| `03d6886` | feat(editor): No machinery action with hotkey N (E4) |
| `45c7217` | feat(data): mark selected images empty; empty shows in the list, grid and dataset dialog (E4) |

Range: `0afa7da..45c7217` (5 commits) on top of `916942c`.

## What was built

- **Backend**: `image.marked_empty` column (migration `0002`, additive, `server_default=false`).
  `labeled` = has a ground-truth box OR `marked_empty`, applied consistently in `images.py`
  (filter, sort), `schemas.py` (`ImageOut`), and `stats.py` (`labeled_count`/`unlabeled_count`).
  New module `app/datasets/empties.py`: `set_marked_empty`, `bulk_mark_empty`,
  `clear_mark_for_ground_truth`. New routes `PATCH /images/{imageId}` (`updateImage`) and
  `POST /images/bulk-mark-empty` (`bulkMarkEmpty`), both publishing `images.changed` and, when
  proposals were rejected, `boxes.changed`. Marking rejects unreviewed proposals in the same
  transaction and is refused (409 `conflict`) while the image has accepted/edited boxes.
  `clear_mark_for_ground_truth` is called from `boxes.create_box`, `boxes.update_box` (edit path),
  `boxes.review_boxes` (accept path), and `inference.service.promote` (skipped on `dry_run`).
  `materialise._select_images`'s default selection (no explicit `image_ids`) now includes
  ground-truth images OR marked-empty images, so a dataset created without an explicit list
  includes negatives with an empty label file.
- **Frontend editor**: `api/images.ts` gained `setMarkedEmpty`/`bulkMarkEmpty`. Editor store gained
  `setImage` (guarded against a stale reply for another image). New `editor/EmptyToggle.tsx`
  component (extracted per the plan's fallback, since `EditorScreen` cannot be rendered in jsdom
  through Konva) renders the "No machinery (N)" / "Marked empty - undo (N)" toolbar button, wired
  into `EditorScreen.tsx`'s `reviewControls` group; disabled with the required title while the
  image has an accepted/edited box in the store. Hotkey `N` added to `hotkeys.ts` (+ `HOTKEY_HELP`)
  and wired through `useEditorHotkeys.ts` / `useEditorActions.ts` to a new `commands.cmdToggleEmpty`
  (not on the undo stack; shows the backend's 409 message verbatim as the editor error).
  `cmdCreateBox` clears `marked_empty` locally on success, mirroring the backend's own transaction.
  `RegionList`'s empty text is "Marked empty: no machinery on this image." when marked, otherwise
  the existing sentence plus " Nothing here? Press N."
- **Frontend Data Manager**: `listModel.ts`'s `Labeled` column renders `yes` / `empty` / `no`.
  `ImageGrid.tsx` shows a slate "empty" badge in place of the green boxes badge. `SelectionBar.tsx`
  gained a "Mark as empty" action (`bulkActions.markImagesEmpty`) reporting
  "`{updated}` marked as empty" plus ", `{skipped}` skipped because they have accepted boxes" when
  `skipped > 0`; the selection is cleared afterwards (see Deviations). `AddToDatasetDialog` takes a
  new `emptyCount` prop and, when it is greater than 0, says "... (N of them marked empty, used as
  negative examples) ...". `DataManagerScreen.tsx` computes `selectedEmptyCount` from the loaded
  rows and threads it through.

## Test counts

- Backend `python -m pytest -q` (cwd `backend/`): **439 passed, 9 deselected** (gpu/live marks,
  unaffected by this change).
- Backend `python -m ruff check .`: **All checks passed.**
- `contract/` `pnpm check` (spectral lint + regenerate + diff): **clean**, no diff against
  `client/schema.d.ts` (the contract was already correct on this branch; nothing here needed
  editing).
- Frontend `pnpm lint` (eslint + prettier): **clean**.
- Frontend `npx tsc --noEmit -p .`: **clean**.
- Frontend `npx vitest run`: **296 passed** across **85 files** (up from the pre-existing baseline;
  new/updated files: `api/images.test.ts`, `data/listModel.test.ts`, `data/ImageGrid.test.tsx`,
  `data/SelectionBar.test.tsx`, `data/AddToDatasetDialog.test.tsx`, `editor/hotkeys.test.ts`,
  `editor/RegionList.test.tsx`, `editor/commands.test.ts`, `editor/EmptyToggle.test.tsx` (new),
  `store/editor.test.ts`).
- Frontend `pnpm build`: **succeeds** (pre-existing >500 kB chunk-size warning, unrelated).
- Frontend `pnpm e2e` (Playwright, 47 tests): **46 passed, 1 failed** — the failure is
  `e2e/query.spec.ts` "estimates and starts a cloud query, then reviews results, promotes and lists
  the run" (expects the Query screen's `Start` button disabled before an estimate; it is enabled).
  This is **pre-existing and unrelated to E4**: none of my 5 commits touch
  `frontend/src/screens/QueryScreen.tsx`, `frontend/src/query/*` or `frontend/e2e/query.spec.ts`
  (verified with `git diff 916942c..HEAD -- frontend/src/screens/QueryScreen.tsx frontend/src/query`,
  which is empty), and the same failure reproduces in isolation
  (`npx playwright test e2e/query.spec.ts -g "estimates and starts a cloud query"`). It looks like a
  regression from the Q5 fix already on the branch (`77d23bf fix(query,models,build): G1 re-review
  findings and Q5`, which changed the local-vs-cloud `Start` gating) that its e2e spec was never
  updated for. Left untouched: fixing Query screen behaviour is out of scope for this negative-images
  sub-project.
  My own two new/edited specs (`e2e/editor.spec.ts` "N marks the image empty..." and
  `e2e/data-manager.spec.ts` "multi-select and mark as empty...") pass, individually and in the full
  run.

## Deviations from the plan, with reasons

1. **Editor e2e "pressed state" assertion**: Prism's static mock (`pnpm --dir ../contract mock`)
   always echoes the canned `Image` example (`marked_empty: false`, `box_count: 3`) for
   `PATCH /images/{imageId}` regardless of the request body or path — confirmed by hand with
   `curl -X PATCH .../images/{id} -d '{"marked_empty": true}'`, which came back with
   `"marked_empty": false"`. A literal "press N, check `aria-pressed`" test against the default mock
   would therefore always read `false`, whichever direction was requested. I used
   `page.route(...)` in `e2e/editor.spec.ts` to intercept just that one PATCH and echo the actual
   `marked_empty` sent (the same technique the existing spec already uses for the query-run polling
   route), which lets the test genuinely assert `aria-pressed` flips both ways. Not a scope change,
   just how the assertion is made to work against a static mock.
2. **`bulk_mark_empty`'s "already marked" case**: per the plan's own test snippet
   (`{"updated": 0, "skipped": 0}` for a second, no-op mark-true call), an image that is already
   marked empty counts as neither updated nor skipped. Implemented exactly that; flagging it because
   it is easy to misread as a bug.
3. **"Mark as empty" clears the selection** (`SelectionBar`'s `onMarked` behaves like `onDeleted`):
   the plan does not say whether the selection should persist. `DataManagerScreen`'s result-message
   slot only renders when there is no active selection (the same slot the delete flow uses), so
   leaving the selection in place after marking would silently swallow the
   "`N` marked as empty..." message. Clearing it, like delete does, was the smallest change that
   keeps the message visible; documented as a deviation since the plan's wording ("the selection
   bar... result message") did not specify this.
4. **Schemas ordering**: `ImageUpdate`, `BulkMarkEmpty`, `BulkMarkEmptyResult` pydantic models
   landed in `schemas.py` in the Task 1 commit (needed there so the module imports cleanly) rather
   than strictly in Task 2 as the file map suggests; harmless, noted for completeness.
5. Backend `test_empties.py` needed local `with_key` / `use_provider` / `no_sleep` fixture copies
   (rather than importing them from `test_query_runs.py`) because importing pytest fixtures whose
   names are then also used as test-function parameter names trips ruff's `F811` (redefinition);
   `FakeProvider` and the plain helper `run_and_wait` are imported directly since they are not
   fixtures.

## Nothing else outstanding

All five plan tasks are complete and committed; every step's failing-test-first requirement was
followed (verified by temporarily neutering `clear_mark_for_ground_truth` and the `materialise`
default-selection change and re-running the new tests to confirm they fail for the right reason,
then restoring the fix). No weights, databases or keys were committed. No file outside the worktree
was touched other than this report.

## Fix round 1 (goal-owner review of `3a34ecf..45c7217`)

Range `45c7217..71acab2` (12 commits). Each finding was fixed test-first: the test was written or
changed, run and watched fail for the right reason (or, where the change was a straight refactor
with no behavioural delta, verified by temporarily reverting the fix and confirming the new/changed
assertion catches it), then the fix landed and the test re-run green.

| Finding | Commit | Evidence |
|---|---|---|
| I1 (store owns "ground truth ⇒ not marked empty") | `f25478e` | `frontend/src/store/editor.test.ts`: three new tests for `upsertBox`, `patchStates`, `setBoxes`, each confirmed to fail when the corresponding invariant clause was temporarily removed. `frontend/src/editor/commands.test.ts`: "the store's ground-truth invariant reached through commands" describes the two reachable sequences (a) accept a rejected proposal after N, (b) a box re-created by `cmdRedo` — (b) confirmed failing before the `upsertBox` fix (`expected true to be false`). The special case in `cmdCreateBox` is deleted. |
| I2a (mark/unmark on the undo stack) | `f25478e` | `commands.test.ts` "marks the image empty… and undoes/redoes" and "N on a marked image (unmark) is also undoable/redoable": undo of a mark sends `PATCH {marked_empty:false}` then `POST /boxes/review {action:"unreview"}` for exactly the rejected ids; redo re-marks. |
| I2b (confirm before marking; Unmark empty) | `f3025ba` | `frontend/src/data/SelectionBar.test.tsx`: "confirms before marking, mentioning pending proposals…" (asserts zero requests before confirming, the exact sentence with/without the pending-proposals clause), "offers Unmark empty with no confirmation…". `e2e/data-manager.spec.ts` updated to click through the confirm step. |
| I3 (migration downgrade must not drop the table) | `05b8596` | `backend/tests/test_empties.py::test_downgrade_does_not_cascade_delete_boxes`: runs the migration through a connection with `PRAGMA foreign_keys=ON` (a bare `sqlite3.connect` does not enforce FKs, so an earlier version of this same test passed even with the bug — rewritten to open the DB the way `app/db/session.py` really does); confirmed failing (`assert 0 == 1`, the box vanished) against the old `batch_alter_table` downgrade, passing after switching to `ALTER TABLE ... DROP COLUMN`. |
| I4 (skip pre-annotation on a marked image) | `7c1bf22` (backend), `8d09263` (frontend) | `backend/tests/test_preannotate.py::test_a_marked_empty_image_is_skipped_before_the_gpu_is_touched`. `frontend/src/editor/useEditorImage.test.tsx::"stays silent for a marked-empty image, without calling preannotate"` (the test file already existed on the wave branch; extended it). |
| I5 (N ignores key repeat; stale comment) | `50d182c` | `frontend/src/editor/hotkeys.test.ts` "N ignores key repeat (I5)"; comment above `actionForKey` now lists `n` alongside `a`, `r`, `f`. |
| M1 (set-based `bulk_mark_empty`, chunked by 500) | `dca5f36` | Rewrote to a handful of bulk SELECT/UPDATE statements; `test_empties.py` extended to assert the actual `rejected` DB state of a bulk-marked image's proposals and to add a bulk-unmark case. |
| M2 (capture ids before the await; bail on a stale image) | `f25478e` | `commands.test.ts` "bails out of every store write once the store has moved to another image (M2)": a deferred PATCH resolves after the store has already loaded a different image; confirmed failing (leaked notice) before adding the `imageId` guard to every store write inside `markEmpty`/`unmarkEmpty`. |
| M3 (one 409 wording, singular/plural, used everywhere incl. locally) | `7c1bf22` (backend), `f25478e` (frontend) | `empties.ground_truth_message`; `test_empties.py::test_the_ground_truth_message_is_pluralised`. Frontend `GROUND_TRUTH_MESSAGE` constant used by the toolbar's disabled `title`, the local refusal in `cmdToggleEmpty`, and the 409 catch path; `commands.test.ts` "refuses locally, without a request, while the store already has a ground-truth box (M3)". |
| M4 (refuse a dataset with nothing to train on) | `92a8463` | `test_datasets.py::test_dataset_without_labelled_images_is_refused_as_nothing_to_train_on`, `test_empties.py::test_default_selection_of_only_marked_images_has_nothing_to_train_on` — confirmed the gap first (an all-marked-empty project produced a 202 with an all-empty dataset before this fix). **Deviation**: kept the existing 409 `conflict` code instead of the requested 422 `validation_error` — `image_ids: []` (or an all-negative default selection) is schema-valid data, and the contract's schemathesis "positive data acceptance" check (already relied on elsewhere, see the comment in `router.create_source`) fails a 422 response to schema-valid input; verified this concretely: switching to 422 broke `test_contract.py::test_responses_conform[POST /datasets]`. Same message text as requested. |
| M5 (AddToDatasetDialog full truth + unlabeled warning) | `4ac33f8` | `AddToDatasetDialog.test.tsx`: new message assertion, new "warns when part of the selection is not labeled yet" test. `labeledCount`/`unlabeledCount` computed in `DataManagerScreen.tsx` from the loaded selected rows and threaded through `SelectionBar`. |
| M6 (log cleared empty marks in promote) | `7c1bf22` | `inference/service.py::promote` logs at info via `empties.count_marked_empty`; no API change, no new test (logging only, per the finding). |
| M7 (shared events helper; drop redundant bumpImages) | `6b288e0` (backend), `1c147f3` (frontend) | `app/events_util.py::publish_image_ids_event` used by both `datasets/router.py` and `inference/router.py`. `SelectionBar.tsx`'s mark/unmark handlers no longer call `bumpImages()` (bulk-delete still does, since it publishes no event). |
| M9 (test additions/replacement) | `71acab2` (backend); the "replace the impossible scenario" part is in `f25478e` (frontend) | `test_empties.py`: `test_sorting_by_labeled_puts_marked_and_boxed_images_first`, `test_by_group_dataset_places_a_negative_in_its_own_groups_split`, `test_a_marked_image_counts_as_labeled_everywhere` now asserts the exact `labeled=false` id list (`image_ids[1:]`) instead of just excluding one id. `test_stats.py::test_source_scoped_stats_count_a_marked_empty_image`. The "impossible against the real backend" scenario the finding flagged was `commands.test.ts`'s old `cmdToggleEmpty` fixture, which loaded a ground-truth `personBox` alongside the proposal and then marked the image anyway (only reachable because the fake client doesn't enforce the 409); its `beforeEach` now loads only `[proposalBox]`, and the ground-truth case is its own dedicated test. |
| M10 (fuller bulk result message) | `f3025ba` | `SelectionBar.test.tsx` "mentions already-marked images in the result, computed from the selection (M10)"; `already` is computed on the frontend from `emptyCount` (the selected rows' `marked_empty`), since the backend's `updated` count already excludes both skipped and already-marked images. |

### Verification after fix round 1

- Backend `python -m pytest -q` (cwd `backend/`): **447 passed, 9 deselected**.
- Backend `python -m ruff check .`: **All checks passed.**
- `contract/` `pnpm check`: **clean**, no diff.
- Frontend `pnpm lint`: **clean**. `npx tsc --noEmit -p .`: **clean**.
- Frontend `npx vitest run`: **310 passed** across **85 files**.
- Frontend `pnpm build`: **succeeds** (same pre-existing >500 kB chunk-size warning).
- Frontend `pnpm e2e` (47 tests): **46 passed, 1 failed** — `e2e/query.spec.ts` "estimates and
  starts a cloud query…" still fails in this worktree exactly as before this round (`Start` button
  expected disabled, found enabled). Per the coordinator's note this is already fixed on the wave
  branch and this spec was not to be touched; ignored as instructed. All of my own specs
  (`editor.spec.ts`'s N test, both `data-manager.spec.ts` mark/unmark-adjacent tests) pass.

### Anything not done

Nothing from the fix-round list was skipped. The one deviation (M4's error code, 409 instead of
422) is explained above with the concrete contract-test evidence for the choice.
