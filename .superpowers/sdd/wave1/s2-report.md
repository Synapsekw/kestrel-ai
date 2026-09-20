# S2 report: annotation UI (Data Manager, editor, review queue, settings)

Branch `s2-annotation-ui` in worktree `E:\Dev\Yolo\app\.worktrees\s2-annotation-ui`, 22 commits on top of main `d30fa90`
(`7ae6c6f..b9f51ba`). Working tree clean. Contract untouched (`git status --porcelain -- contract` empty;
`pnpm --dir contract check` passes). No process outside my own Playwright runs was started or stopped; ports 1420 and 4010
are free at the end. I never ran `git clean` nor touched `backend/.venv`.

## Final verification (all from `frontend/`)

| Command | Result |
|---|---|
| `pnpm lint` | eslint clean, 0 warnings; "All matched files use Prettier code style!" |
| `pnpm test` | 29 files, 95 tests passed (S0's 7 plus 88 new) |
| `pnpm build` | `tsc -b` silent, `vite build` "built in 1.46s" |
| `pnpm e2e` | 24 passed (boot 1, data-manager 6, editor 12, review 1, settings 4), run twice back to back: 24/24 both times |
| `pnpm --dir contract check` | Spectral no errors, generated client unchanged |

## Per-task notes with RED/GREEN evidence

Every task: failing test written first, run, implementation, run again, then `pnpm format`, `pnpm exec tsc -b`, `pnpm lint`
and (from Task 10) the relevant `pnpm e2e` before the commit. The first three commits were gated on `grep`'s exit code by
mistake (see "Process notes"); from Task 5 on every gate reads vitest's, tsc's, eslint's and Playwright's own exit codes.

1. **Task 1** `7ae6c6f` fixtures, fake fetch, `errors.ts`. RED: `Failed to resolve import "./errors"`. GREEN: 6 passed.
2. **Task 2** `65cece8` geometry. RED: unresolved import. GREEN: 10 passed.
3. **Task 3** `d49eb6e` editor store. RED: unresolved import; then 1 real failure ("fits when the viewport arrives after
   the image") caused by test isolation, see deviations. GREEN: 7 passed.
4. **Task 4** `890bd68` + fix `6d49def` history and hotkey map. RED: both unresolved. GREEN after the `isTypingTarget` fix: 8 passed.
5. **Task 5** `49353ad` api wrappers. RED: 3 unresolved. GREEN: `src/api` 5 files, 18 passed (includes an extra `unreview` case).
6. **Task 6** `8c9d93d` changes/navigation stores + `App.tsx` bridge. RED: 2 unresolved. GREEN: 12 files, 49 passed.
7. **Task 7** `efa3429` list model, selection, virtualiser, image list hook. RED: 4 unresolved. GREEN: 13 passed. `tsc`
   flagged the plan's `FakeRoute.body` type (fixed in fixtures, below).
8. **Task 8** `39bad44` + fix `6e1a61b` Data Manager screen. RED: 2 unresolved. GREEN: 6 data files, 15 passed. Lint fix for
   the React Compiler `refs` rule (below).
9. **Task 9** `9f130d9` bulk actions. RED: 2 unresolved. GREEN: 20 files, 68 passed after two fixes (RTL cleanup, contract
   defaults `conf`/`seed`, below).
10. **Task 10** `f32c0b1` Konva stage. RED (e2e): `editor-canvas` never appears. GREEN: editor "loads…" + boot, 2 passed.
11. **Task 11** `7d9d869` commands with compensating undo, box layer, draw/move/resize. RED: `commands.test.ts` unresolved
    and the store `reviewed_at` assertion. GREEN: 79 unit; e2e loads/drawing/dragging 3 passed.
12. **Task 12** `e4960e4` region list, class sidebar, toolbar, hotkeys. RED: 2 unresolved. GREEN: 82 unit; 6 editor e2e.
13. **Task 13** `3559c27` review controls + pre-annotation on open. RED (e2e): `proposal-count` and "Show rejected" missing.
    GREEN: 9 editor e2e.
14. **Task 14** `f5ba0e3` navigation with auto-save wait. RED: hook unresolved; e2e `position` missing (the Ctrl+Z/Ctrl+Y
    e2e already passed because Task 12 wired those keys). GREEN: 11 editor e2e after one test fix (below).
15. **Task 15** `0c5facf` review queue. RED: "Unable to find … 81%". GREEN: 25 files, 85 passed.
16. **Task 16** `8165cb5` settings. RED: 4 unresolved. GREEN: 29 files, 95 passed.
17. **Task 17** `b822f42` (+ fix `0947ec8`) data-manager e2e: 6 passed after three fixes surfaced by the spec (below).
18. **Task 18** `b5424a4` review e2e: 1 passed first time.
19. **Task 19** `54eb0b1` settings e2e: 4 passed first time.
20. **Task 20** `b9f51ba` verification pass: adds a handle-resize e2e (the one spec interaction nothing covered), a
    "Keys" tooltip built from the plan's `HOTKEY_HELP` (which the plan defined but never displayed), drops the unused
    `mockRoutes` fixture, silences the fast-refresh warning on the test-only `render.tsx`.

## Rulings applied (they override the plan)

- **Ruling 1, undo via `unreview`** (`editor/commands.ts`): `cmdReview` undo issues `unreview` and puts the store back to
  `unreviewed` with `reviewed_at: null` (store `patchStates` now clears the time for `unreviewed`). An edit (`cmdUpdateRect`,
  `cmdSetClass`) on a proposal records the review state before the PATCH; undo PATCHes the old values back and then restores
  that state through the review endpoint: `unreview` when it was `unreviewed`, `accept`/`reject` when it had been decided,
  nothing when it was already `edited` (a PATCH-back leaves it `edited`). Person boxes never get a review call.
- **Ruling 2, delete on a proposal = reject** (`cmdDelete`): a box whose `provenance.kind` is not `person` is rejected
  through `POST .../boxes/review`, never `DELETE`; the row stays and is hidden unless "Show rejected". Undo restores the
  previous state (`unreview` for an unreviewed proposal, `accept` for one that had been accepted). `DELETE` and the
  re-create-on-undo path apply to person boxes only. This removes the plan's contract gap 2.
- **Ruling 3**: digits select classes, `0`/`Ctrl+1` are 1:1, `F` fits; shown in the toolbar tooltips and the Keys tooltip.
- **Ruling 4**: min-boxes and capture range filter client-side over the loaded rows; the group filter is free text.

Interpretation to confirm: for a proposal that had been **accepted** and is then deleted (rejected), undo issues `accept`
rather than the literal `unreview` of ruling 2, so the box comes back as ground truth instead of a pending proposal.
An `edited` proposal that is deleted comes back as `accepted` on undo (the review endpoint cannot produce `edited`); a
unit test pins each case (`commands.test.ts`).

## Deviations from the plan, with reasons

1. `store/editor.test.ts`: the plan's second test assumed a fresh viewport, but `reset()` keeps the viewport by design
   (test 7 asserts it), so test 1's 1000x700 leaked in. `beforeEach` now also clears viewport/activeClassId/showRejected.
2. `editor/hotkeys.ts` `isTypingTarget`: jsdom has no `isContentEditable`, so the plan's expression returned `undefined`
   for a `<div>`; compares `=== true` now (commit `6d49def`).
3. `test/fixtures.ts` `FakeRoute.body`: the plan's `unknown | ((req) => unknown)` collapses to `unknown`, so `body: (req) =>`
   lost its parameter type under `tsc`. Narrowed to `FakeBody | ((req: RecordedRequest) => FakeBody)`.
4. `data/ImageTable.tsx`, `data/ImageGrid.tsx`: the React Compiler `react-hooks/refs` rule rejects reading `vp.containerRef`
   through the hook's return object during render; the hook result is destructured at the top instead (commit `6e1a61b`).
5. `src/test-setup.ts` (S0 file): added `afterEach(cleanup)`. Testing Library only auto-cleans when `afterEach` is global,
   and Vitest runs without globals here, so the first SelectionBar test's DOM leaked into the second.
6. **Contract wins**: the generated client marks `QueryRunCreate.conf` and `DatasetCreate.seed` required (they carry
   defaults in the contract), so `bulkActions.ts` sends `conf: 0.25` and `seed: 42` explicitly; the unit and e2e body
   assertions include them.
7. `data/SelectionBar.tsx` / `DataManagerScreen.tsx`: after a bulk delete the selection is cleared, which unmounted the bar
   together with its "N images deleted" status; `onDeleted(message)` now hands the message to the screen, which shows it
   in a `role="status"` line. Message uses proper singular ("1 image deleted"); the e2e accepts either form.
8. `data/FilterBar.tsx`: explicit `aria-label`s on every control. A `<label>` wrapping a `<select>` gets an accessible name
   that includes the option text, so Playwright's `getByLabel("Labeled")` also matched the "Sort by" select.
9. `data/ImageGrid.tsx`: the thumbnail fallback shows "no thumbnail" instead of the file name, which the caption already
   shows (under the mock every thumbnail fails, so `getByText(file name)` hit two elements per tile).
10. `e2e/editor.spec.ts` navigation test: the plan pressed Ctrl+Left right after the URL changed, while the second image
    was still loading; hotkeys are disabled during a load (`enabled: !loading`) so the key was dropped. The test now waits
    for the second image's boxes response and for "Loading…" to clear. The Data Manager J/K/Enter e2e got the same wait.
11. `e2e/editor.spec.ts` "R rejects…" test: replaced `page.reload()` + `openEditor` with `openEditor` alone (it navigates).
12. `editor/labels.ts` and `useEditorActions.ts` expose a `ReviewDecision` (`accept | reject`) type distinct from the
    contract's `ReviewAction` (which includes `unreview`), so UI code cannot issue `unreview` by accident.

## Contract gaps found (no contract change made)

1. **`edited` cannot be restored** through `POST /boxes/review`; undo of a delete on an edited proposal yields `accepted`.
   Minor; noted in `commands.ts`. Plan gap 1 (`unreview`) is closed by main `d30fa90`; plan gap 2 by ruling 2.
2. **No server-side filters for box count or capture time** (plan gap 3): client-side over loaded rows, exact only once every
   page is loaded.
3. **No endpoint lists group keys** (plan gap 4): free-text group filter.
4. **Create has no idempotency key** (plan gap 5): redo of a draw re-posts and gets a new id; `BoxRef` tracks it.
5. `QueryRunCreate.conf` and `DatasetCreate.seed` are required in the generated client although optional-with-default in
   the YAML (openapi-typescript's default-non-nullable behaviour); the UI sends the defaults. Harmless, but the backend must
   accept them.

## Process notes and concerns

- The Task 4 commit `890bd68` and the Task 8 commit `39bad44` landed with a failing test / lint errors because my shell chain
  gated on `grep`'s or `tail`'s exit code; both were fixed in the immediately following commits (`6d49def`, `6e1a61b`) and
  every later gate reads the tool's own exit code. History is honest rather than amended.
- Hotkeys are disabled while an image loads; a key pressed in that window is dropped (also the cause of deviation 10).
  Acceptable for now; if it annoys, only `next`/`prev` need to stay live during a load.
- `useVirtualRows` measures only through `ResizeObserver`; jsdom falls back to a 600 px viewport, so the table/grid unit tests
  render every row (fine at two rows).
- `useEditorNavigation` loads up to 1000 image ids on a deep link (contract `limit` maximum); larger projects walk only the
  first 1000 in path order when the editor is opened directly rather than from a list.
- The `DataManagerScreen` delete notice persists until the next delete; it is hidden while a selection exists.
- Under the mock, `POST .../boxes` always answers with box `b…0001`, so a drawn box replaces the person box in the store and
  the region list keeps showing two rows; the e2e tests assert request bodies as the plan says.
- Not done: an interactive manual pass in a real browser window. Every step of the plan's walk (grid, list, filters, select
  two, run model, delete, zoom, pan, F, 0, draw, drag, resize, Ctrl+D, Delete, A, R, Show rejected, Ctrl+Z/Y, Ctrl+Right/Left,
  review queue, settings) is driven end to end by Playwright against the mock in the 24 e2e tests; the guide below is for
  the goal owner's own pass.

## Files changed (78; A = added, M = modified)

- e2e: A `data-manager.spec.ts`, `editor.spec.ts`, `review.spec.ts`, `settings.spec.ts`
- src/api: M `client.tsx` (exports `ApiContext`, `ApiContextValue`); A `errors.ts`, `images.ts`, `boxes.ts`, `project.ts` + tests
- src/app: M `Shell.tsx` (editor route without padding)
- src: M `App.tsx` (events bridge feeds `useChangesStore`), M `test-setup.ts` (RTL cleanup)
- src/store: A `editor.ts`, `changes.ts`, `navigation.ts` + tests
- src/editor: A `geometry.ts`, `hotkeys.ts`, `history.ts`, `commands.ts`, `labels.ts`, `useKonvaImage.ts`, `EditorCanvas.tsx`,
  `BoxLayer.tsx`, `RegionList.tsx`, `ClassSidebar.tsx`, `EditorToolbar.tsx`, `useEditorImage.ts`, `useHistory.ts`,
  `useEditorActions.ts`, `useEditorHotkeys.ts`, `useEditorNavigation.ts` + tests
- src/data: A `listModel.ts`, `selection.ts`, `useVirtualRows.ts`, `useImageList.ts`, `bulkActions.ts`, `FilterBar.tsx`,
  `ImageTable.tsx`, `ImageGrid.tsx`, `SelectionBar.tsx` + tests
- src/settings: A `classesModel.ts`, `ClassesSection.tsx`, `PreannotationSection.tsx`, `ImportDefaultsSection.tsx`,
  `ProvidersPlaceholder.tsx` + tests
- src/screens: M `DataManagerScreen.tsx`, `EditorScreen.tsx`, `ReviewScreen.tsx`, `SettingsScreen.tsx`; A `ReviewScreen.test.tsx`
- src/test: A `fixtures.ts`, `render.tsx`

No dependency added; `package.json` and the lockfile are unchanged.

## Manual testing guide (mock server)

1. In one terminal `pnpm --dir contract mock` (port 4010), in another `pnpm dev` inside `frontend/` (port 1420). Open
   `http://127.0.0.1:1420/`, click **Open** on Ahmadia.
2. **Data Manager**: two tiles ("no thumbnail" placeholders: the mock serves no JPEG). Grid/List toggle; in List the seven
   columns sort by header click (watch the query string in devtools: `sort=`, `order=`). Filters: Source, Group, Labeled,
   Pending review, Min boxes, Captured from/to, Sort by, order arrow, debounced search. Tick both checkboxes: the selection
   bar offers Label selected, Run model (POST query-runs, "1 active job" in the header), Add to dataset (inline form),
   Delete (confirm/cancel; the mock reports 1 deleted). J/K move the focus ring, Space toggles, Enter opens.
3. **Editor** (`/p/<project>/edit/<image>`): slate placeholder 4000x2667 fitted; wheel zooms around the pointer; hold Space
   and drag to pan; `F` fits, `0` or `Ctrl+1` is 1:1, zoom % in the toolbar. Left sidebar: classes with swatch, count and
   hotkey; `1`..`8` change the active class (also reclassifies the selected box). Drag on empty image to draw a box (POST
   in image pixels); drag a box to move it (PATCH); select it and drag a corner handle to resize; `Ctrl+D` duplicates with a
   12 px offset; `Delete`/`Backspace` deletes a person box (DELETE) or rejects a proposal (review reject). The dashed box is the
   model proposal: `A` accepts all visible proposals, `R` rejects them, the region list rows have Accept/Reject/Delete per
   box; "Show rejected" reveals rejected rows dimmed. `Ctrl+Z`/`Ctrl+Y` undo/redo through compensating calls (watch the
   network tab: DELETE after a draw, `unreview` after an accept). `Ctrl+Right`/`Ctrl+Left` walk the list that opened the
   editor; the toolbar shows "n / count" and "Saving…"/"Saved". Hover **Keys** in the toolbar for the hotkey list.
   Note: the mock answers every create with box `b…0001`, so a drawn box replaces the person box on screen.
4. **Review**: `/p/<project>/review` lists both mock images with "81%" top confidence; Enter opens the editor with
   "1 / 2"; `A` accepts the proposal.
5. **Settings**: rename/recolour/rehotkey/reorder/remove classes, Save classes (PUT; the mock returns the unchanged
   project, so edits appear to revert); pre-annotation model select (PATCH); import defaults (PATCH); provider placeholder.
   To see the `class_in_use` explanation or the 501 registry note, use the settings e2e (`pnpm e2e e2e/settings.spec.ts`),
   which stubs those responses.

---

# Fix round 1 (review of d30fa90..b9f51ba)

Commit `75fb5ef` on `s2-annotation-ui` (22 files, +508/-121). Tree clean, contract untouched (`git status --porcelain -- contract`
empty), ports 1420/4010 free afterwards, no `git clean`, `backend/.venv` untouched. TDD per finding: 10 new unit tests and
3 new e2e tests were written and seen RED (9 unit failures in one run: unresolved `dragRect`/`enqueue`/`run`/`alias`,
repeat-key, store guards; the e2e ones fail on the old behaviour) before the code changed.

## What changed, per finding

1. **Click created a 2x2 box** (`geometry.ts`, `EditorScreen.tsx`). New pure `dragRect(start, end, view, image)`: a drag
   under `MIN_DRAG_PX = 4` display px on both axes, or a raw image rect under `MIN_BOX_SIDE`, is `null`; only a real drag
   is clamped/rounded. The screen keeps the drag's display start/end in refs and decides on mouse up; the draft rect is
   visual only. Tests: `geometry.test.ts` "dragRect" (click, 3 px jitter, zero-height drag, both drag directions, clamp
   from outside the image); e2e "a click or a few pixels of jitter on the image never creates a box" (records every POST,
   asserts none to `/boxes`).
2. **Undo/redo re-entrancy** (`history.ts`, `hotkeys.ts`, `useEditorHotkeys.ts`, `EditorToolbar.tsx`). `History.undo/redo`
   return `null` while one is in flight (`busy` flag; a throwing command still stays in place). `actionForKey` returns
   `null` for a repeated Ctrl+Z / Ctrl+Y / Ctrl+Shift+Z. The hotkey handler and the toolbar buttons only undo/redo when
   `pending === 0`. Tests: `history.test.ts` "ignores a second undo or redo while one is in flight" (slow fake command);
   `hotkeys.test.ts` "returns null for a held Ctrl+Z or Ctrl+Y".
3. **Redo chain after a re-created box** (`history.ts`, `commands.ts`). `History.alias(from, to)` / `resolve(id)` keep a
   per-image id map (cleared with the history); `cmdCreateBox` redo and `cmdDelete` (person) undo record the new server id;
   `cmdUpdateRect` / `cmdSetClass` undo and redo resolve their captured id first. Test: `commands.test.ts` "redo of a move
   after a re-created box patches the new id" (draw, move, undo x2, redo x2: the PATCH targets `new-2`, then undo again).
4. **Stale responses** (`store/editor.ts`). `upsertBox` ignores a box whose `image_id` is not the open image; `select`
   ignores an id that is not in the store. Test: `editor.test.ts` "drops an upsert whose image_id is not the open image
   and a select of an absent box".
5. **Node desync after a failed move** (`BoxLayer.tsx`). `onCommitRect` now returns the command's promise; after it settles
   the layer re-applies the store rect to the Konva node (`syncNode`): the saved rect on success, the old rect on failure.
   E2E "a failed move reports the error envelope and keeps the box where it was" (PATCH stubbed to 500 `disk full`:
   alert text, back to Saved, Undo stays disabled because nothing was pushed). The node position itself is not readable
   from the DOM; the re-sync path is exercised by every move e2e (success branch).
6. **Space-drag over a box** (`BoxLayer.tsx`). Boxes and the Transformer get `listening={!spaceHeld}`, and the box
   mousedown returns before `cancelBubble` while Space is held. E2E "space-drag that starts on a box pans the stage
   instead of moving the box" (stage x moves by 60, no PATCH recorded).
7. **History order = action order** (`commands.ts` `enqueue`, `history.ts` `run`, `useEditorActions.ts`). Every action is
   queued per image through `History.run`; `enqueue` increments `pending` at submission so "Saving…" and `waitForIdle`
   cover queued work. Test: `history.test.ts` "runs queued work one at a time in submission order, even when the first is
   slower" (plus rejection does not block the queue); `commands.test.ts` "queued commands run in submission order and
   history follows it" (first move sleeps 30 ms, second is instant: requests and undo order are 600 then 700, pending 2
   while queued, 0 after).
8. **next/prev live while loading** (`useEditorHotkeys.ts`): the listener is always attached; navigation keys work
   regardless of `enabled`, every other key still waits for the load.
9. **Busy guard** in `PreannotationSection.choose`: ignores a change while a PATCH is in flight and disables the select.
10. **`Number("")`** in `ImportDefaultsSection`: the form owns strings, inputs are `required`, and submit refuses an
    empty or non-numeric field with "Every import default needs a value." Test: `ImportDefaultsSection.test.tsx`
    "refuses to save an emptied number field" (no request sent).
11. **ARIA**: region rows keep `role="listitem"` but mark the selection with `aria-current="true"` (a listbox/option
    pattern would nest the class `<select>`'s options inside an option, which is what the first attempt did and both a unit
    test and an e2e caught); rows are focusable (`tabIndex=0`) and Enter selects. The image grid is a `role="listbox"`
    (`aria-multiselectable`) of `role="option"` cells instead of `row`s; the table keeps `grid`/`row`/`gridcell`. The Keys
    help is a focusable `<button aria-label="Keyboard shortcuts">`. Tests updated: `RegionList.test.tsx` and the editor e2e
    assert `aria-current`.

## Verification (all from `frontend/`, after the changes)

- `pnpm lint`: eslint clean, 0 warnings; "All matched files use Prettier code style!"
- `pnpm test`: 29 files, 105 passed (95 + 10 new), 6.4 s
- `pnpm build`: `tsc -b` silent; "built in 1.45s"
- `pnpm e2e`: 27 passed (boot 1, data-manager 6, editor 15, review 1, settings 4), run twice: 27/27 and 27/27
- `git status --porcelain -- contract`: empty

## Notes

- With every action queued, a second Ctrl+Z pressed while a save is pending is dropped (pending > 0) rather than queued;
  once idle, Ctrl+Z works as before. The toolbar Undo/Redo are disabled while saving for the same reason.
- `enqueue` counts queued work in `pending`, so the "Saving…" indicator now also covers commands waiting in the queue.

---

# Fix round 2 (re-review of 75fb5ef)

Commit `f1a6d64` on `s2-annotation-ui` (7 files). Tree clean, contract untouched, ports free, `backend/.venv` untouched.
Tests first: 3 new/changed unit tests seen RED (hotkeys repeat for next/prev; `dragRect` with an image-pixel anchor,
including a view change mid-drag) before the code changed.

1. **ImageGrid roles** (`src/data/ImageGrid.tsx`): the grid is `role="list"` (`aria-label="Images"`) of `role="listitem"`
   cells; the focused cell carries `aria-current="true"` like the region rows, so the checkbox inside stays a real control
   (no `nested-interactive`). J/K/Enter/Space/Ctrl+A/Escape unchanged (they act on the container). No test asserted the
   grid's roles (the Data Manager e2e uses `role="row"` only in list view, which keeps `grid`/`row`/`gridcell`).
2. **Draw anchor in image pixels** (`geometry.ts`, `EditorScreen.tsx`): `dragRect(anchor, start, end, view, image)` takes
   the image pixel captured at mouse down plus the display start/end; only the current pointer is converted with the
   current view, so a wheel zoom or space-pan mid-drag leaves the anchor put. The display-pixel click threshold stays.
   The screen keeps `drawAnchor` (image) next to `drawStart`/`drawEnd` (display) and the rubber band uses the anchor too.
   Test: `geometry.test.ts` "keeps the anchor at the same image pixel when the view changes mid-drag" (anchor from a
   0.25 view, mouse up under a 0.5 view with an offset: rect still starts at image (400, 400)).
3. **Repeat-safe navigation keys** (`hotkeys.ts`): `Ctrl+Right` / `Ctrl+Left` return `null` on auto-repeat, like undo/redo.
   Test: `hotkeys.test.ts` "returns null for a held Ctrl+Right or Ctrl+Left".
4. **`.catch` on the commit promise** (`BoxLayer.tsx`): a rejecting `commitRect` is logged through `pushLog` and can no
   longer become an unhandled rejection; the node re-sync still runs afterwards.

## Verification (from `frontend/`)

- `pnpm lint`: eslint clean, 0 warnings; "All matched files use Prettier code style!"
- `pnpm test`: 29 files, 107 passed
- `pnpm build`: `tsc -b` silent; "built in 1.47s"
- `pnpm e2e`: 27 passed (boot 1, data-manager 6, editor 15, review 1, settings 4)
- `git status --porcelain -- contract`: empty

---

# Fix round 3 (re-review of f1a6d64)

Commit `f64d9b7` on `s2-annotation-ui` (2 files: `src/data/ImageGrid.test.tsx` new, `src/screens/EditorScreen.tsx`).
Tree clean, contract untouched, ports free, `backend/.venv` untouched.

1. **ImageGrid unit test** (`src/data/ImageGrid.test.tsx`, Testing Library). It renders the real `DataManagerScreen`
   (fake routes for project, images, sources) so J/K/Enter and the selection use the screen's actual key handling:
   - `role="list"` named "Images" (the `data-testid="image-grid"` container) with two `role="listitem"` cells;
   - exactly one cell carries `aria-current="true"` (the first); `j` moves it to the second, another `j` still leaves
     exactly one, `k` moves it back;
   - each cell keeps a real `role="checkbox"` ("Select IX-…0001.jpg"): clicking toggles it, "1 selected" appears and
     the editor route does not open; unticking clears it; `Enter` on the grid opens the editor route.
   RED/GREEN evidence: the test passes against the round-2 markup (it characterises the fix), so it was also run once
   against the round-1 grid (`git show 75fb5ef:frontend/src/data/ImageGrid.tsx` written over the file, restored from
   `HEAD` afterwards): both tests FAIL with `Unable to find role="list" and name "Images"`; with the current file: 2 passed.
2. **`.catch` on `drawBox`** (`EditorScreen.tsx` mouse up): a rejecting `actions.drawBox(...)` is logged through `pushLog`
   like the BoxLayer commit, so it can never become an unhandled rejection.

## Verification (from `frontend/`)

- `pnpm lint`: eslint clean, 0 warnings; "All matched files use Prettier code style!"
- `pnpm test`: 30 files, 109 passed (2 new)
- `pnpm build`: `tsc -b` silent; "built in 1.46s"
- `pnpm e2e`: 27 passed (boot 1, data-manager 6, editor 15, review 1, settings 4)
- `git status --porcelain -- contract`: empty
