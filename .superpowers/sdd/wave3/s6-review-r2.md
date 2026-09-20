# S6 review round 2: `9f3aa01` ("fix(s6): review round 2")

Range `6cdd435..9f3aa01`, checked against the worktree
`E:\Dev\Yolo\app\.worktrees\s6-packaging-acceptance` and the diff package
`s6-review-package-r2.md`. Read-only: no builds, no process starts. A2 and A5 (deferred by the
goal owner) are not re-raised.

## Status table

| # | Severity (r1) | Status | Evidence |
|---|---|---|---|
| **A1** | Important | **Addressed** | `README.md:149-154` now reads "the app installs next to the sidecar: `machinery-app.exe`, `machinery-backend.exe` and the sidecar's `_internal/` folder... the shell plugin resolves a sidecar as `<folder of the running exe>\machinery-backend.exe`... the target triple (`machinery-backend-x86_64-pc-windows-msvc.exe`) is only how the file is named in the build slot". `scripts/acceptance.md:12-13` says the same for the operator installing before the acceptance run. `grep -n machinery-backend README.md scripts/acceptance.md docs/progress.md` shows no remaining reference to the triple-named exe as an installed artifact, and `## Troubleshooting` (`README.md:196-` onward) does not name the sidecar at all, so there is nothing stale left there either. |
| **N1** | Important | **Addressed** | `frontend/scripts/acceptance.mjs:322-350` (`selectRows`). Verified against the actual React source, not just the diff: `total` passed in is `page.total` from `useImageList.ts:62/97`, documented in `contract/openapi.yaml:1329` as "number of images matching the filter" (i.e. the server's full count for that filter, independent of page size) and rendered as `{loaded} of {total} images` in a single `<span>` in `FilterBar.tsx:155-158`. `selectRows` waits for that exact text (`:325`), then `aria-rowcount >= count` (`:326-330`, `aria-rowcount={p.items.length}` at `ImageTable.tsx:46`), then scrolls to 0 and waits for the first row's text to contain `items[0].file_name` before indexing (`:335-345`) — `[data-testid="image-table"] [role="row"]` only matches rows inside the scrollable container (`ImageTable.tsx:70-96`); the header row is a sibling outside that container (`ImageTable.tsx:47-67`), so `rows[0]` is genuinely the first data row, not the header. `${count} selected` is matched with `{ exact: true }` (`:349`), and `SelectionBar.tsx:49` renders `{n} selected` as the sole text of its `<span>`, so exact match is sound (no longer a substring hazard). Both closing-the-loop assertions are real: step 4 (`:497-524`) reads `images/train` + `images/val` in the dataset folder, strips the `<site>__` prefix that `materialise.py:44-50` (`images/<site>/<file>` -> `<site>__<file>`, verified: import writes flat `images/<site>/` with no further subfolders per `importer.py:72`) adds, and compares the resulting filename set against the first 30 labeled images sorted by path; step 6 (`:634-637`) asserts `run.image_ids` is exactly the set of unlabeled ids the driver picked before calling `selectRows`. Both are exercised in the implementer's dry run: `frozen images match the 30 labeled ones: true`, `50 images (the intended unlabelled ones: true)`. One phrasing nuance versus the literal instruction: the code does not wait for `aria-rowcount` to equal the *total* (that's infeasible for the 3269-image unlabeled set, arriving 200 rows at a time) — it waits for the filter-bar *text* to equal total, then for `aria-rowcount >= count`. This is a sound substitute for the same race and does not weaken the fix. |
| A3 | Minor | **Addressed** | `frontend/installer/machinery-detection.iss:36-39`: `DisableDirPage=yes` + `UsePreviousAppDir=yes`, with a comment tying it to the whole-`{app}` uninstall delete. |
| A4 | Minor | **Addressed** | `machinery-detection.iss:40-43`: `ArchitecturesAllowed=x64os` / `ArchitecturesInstallIn64BitMode=x64os`, comment explains the ARM64-emulation rationale. `x64os` is a valid Inno Setup 6.3+ constant and the pinned compiler is `innosetup-compiler ^6.3.1`. |
| A6 | Minor | **Addressed** | `frontend/scripts/build-installer.ps1:98-99`: summary line now includes `"with"`/`"without a WebView2 bootstrapper"`, confirmed in the implementer's rebuild log (`... 1,797.3 MB, without a WebView2 bootstrapper ... in 387 s`). |
| A7 | Minor | **Addressed** | `build-installer.ps1:44-48`: `if ($version -notmatch '^\d+(\.\d+){0,3}$') { throw ... }` before ISCC ever sees the version, with a message naming the offending value and a valid example. |
| A8 | Minor | **Addressed** | `backend/scripts/smoke_frozen.ps1:29`: `$WorkDir` param now has no default expression; `:36-39`: `$generatedWorkDir = -not $WorkDir` computed before the default is substituted in, so a caller-supplied folder leaves `$generatedWorkDir = $false`. `:238-250`: deletion only runs when `-not ($Keep -or -not $generatedWorkDir)`, i.e. never for a caller-supplied dir; the "kept" message covers both `-Keep` and a supplied `-WorkDir`, and a failed `Remove-Item` now reports "work dir could not be removed" instead of falsely claiming success. |
| N2 | Minor | **Addressed** | `acceptance.mjs:281-303` (`clickRow`): the `.click()` call moved inside the scroll-retry loop, wrapped in try/catch so an unmount-between-check-and-click failure just retries with a fresh scroll instead of throwing. |
| N3 | Minor | **Addressed** | `acceptance.mjs:252-257` (`current`/`begin()`) and `:694` (`result.failed_step = current` in the `catch`). All eight steps call `begin("N. ...")` at their top (`:366, 388, 418, 459, 524, 595, 654, 708` — verified by grep, every step covered), so a throw from inside a step now names that step, not the last one that completed. |
| N4 | Minor | **Addressed** | `acceptance.mjs:430-442`: `projectAfterModel.preannotation_model_id` is polled (up to 20×500ms) and asserted equal to `preModel?.id` **before** the `preannotateImages` loop that calls `openAndPreannotate`/waits on the `/preannotate` response; if the button click did not take, this now throws immediately with a named error instead of the loop stalling for a 300s `waitForResponse` timeout. |
| N5 | Minor | **Addressed** | `acceptance.mjs:552-573`: `epochText` is read (normalized via `.replace(/\s+/g," ").trim()`) and required to equal exactly `` `${cfg.epochs} / ${cfg.epochs}` `` alongside the websocket progress-event count. Cross-checked against `TrainProgress.tsx:47-49`, which renders `{epoch.epoch} / {epoch.epochs}` as a single JSX expression (no stray whitespace), so the exact-string comparison is sound. Dry run shows `epoch card "1 / 1"` passing. |
| N6 | Minor | **Addressed** | `acceptance.mjs:617-624`: `reviewRows` now reads `role="grid"`'s `aria-rowcount` instead of counting mounted `role="row"` + checkbox elements, which is the queue's real size regardless of the virtualised viewport. |

**Counts: 12 Addressed, 0 Partially addressed, 0 Not addressed.**

## New defects introduced by this commit

None found at Critical or Important severity. Specifically checked and ruled out:

- Whether `[data-testid="image-table"] [role="row"]` in the new top-row check (`acceptance.mjs:338-345`) could match the header row instead of the first data row — it cannot: the header `role="row"` div is a sibling outside the `data-testid="image-table"` scroll container (`ImageTable.tsx:44-67` vs `:70-96`), so the query is scoped to data rows only.
- Whether the `${count} selected` exact-text match could fail to find its target because of extra surrounding markup — `SelectionBar.tsx:49` renders `{n} selected` as the sole content of its `<span>`, so it's a clean single text node.
- Whether the dataset-folder membership check (`materialised_name`-reversal in `acceptance.mjs:497-505`) could mis-parse filenames containing extra `__` — ruled out: images are imported flat into `images/<site>/` (`importer.py:72`), so `path` is always exactly `images/<site>/<file>`, one `__` boundary, matching the frontend's `split("__").slice(1).join("__")` reversal.
- `node --check frontend/scripts/acceptance.mjs` and a read of the full diff hunk for `smoke_frozen.ps1` and `machinery-detection.iss` found no syntax or logic regressions.

## Verdict

**Approved.**

Both blocking findings from round 1 (A1, N1) are substantively resolved, not just reworded: the
README/acceptance.md/troubleshooting text is internally consistent with what the installer
actually writes, and the range-selection race is closed with a filter-total wait, a pinned first
row, an exact-match count, and API-level set-equality assertions on both directions (dataset
membership in step 4, `run.image_ids` in step 6) that the implementer's dry run shows actually
firing (`true`/`true`). All ten minors (A3, A4, A6, A7, A8, N2-N6) are also addressed with concrete
code changes matching their fixes. No new Critical or Important defect was introduced.
