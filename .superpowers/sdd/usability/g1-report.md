# G1 starter weights — implementation report

Worktree: `E:\Dev\Yolo\app\.worktrees\g1-starter-weights`, branch `g1-starter-weights`.
Base commit before this work: `fd71e19` (contract+plan: starter-models endpoints and the G1 plan).

## Commits

| Hash | Subject |
|---|---|
| `67d759c` | feat(models): starter weights catalogue and import (G1) |
| `c025aa3` | feat(models): starter-models endpoints (G1) |
| `d585297` | build: bundle the starter weights and prove them in the frozen smoke test (G1) |
| `e4b378b` | feat(models): starter models on the Models screen (G1) |
| `de74e00` | feat(train,query): point to the starter models when the registry is empty (G1) |

Commit range: `fd71e19..de74e00`. Nothing merged, rebased or pushed.

## Test counts per suite (final run, after all 5 tasks)

- Backend `python -m pytest -q` (cwd `backend/`): **420 passed, 9 deselected** (gpu/live markers, excluded by default).
- Backend `python -m ruff check .`: **All checks passed!**
- `pnpm --dir contract check` (spectral lint + regenerate `client/schema.d.ts` + `git diff --exit-code`): **passed, no diff** — the committed client already matched (goal owner had regenerated it on this branch).
- Frontend `pnpm lint` (eslint + prettier over `src`): **clean**.
- Frontend `npx vitest run`: **74 files, 244 tests passed** (up from 241 before this work; +2 in `starterModels.test.ts`, +2 in `StarterModels.test.tsx`, +1 in `ModelsScreen.test.tsx`, +2 in `TrainForm.test.tsx`, +1 in `QueryScreen.test.tsx`).
- Frontend `pnpm build`: **succeeded** (`tsc -b && vite build`, one pre-existing >500kB chunk warning, unrelated to this change).
- Frontend `pnpm e2e`: **44 passed** (2 new cases in `e2e/models.spec.ts`: "offers the bundled starter weights and imports one with a click", plus the pre-existing suite unaffected). Mock server on 4010 and Vite on 1420 were free before the run and used by Playwright's own `webServer` config; nothing was left running afterwards.

## Fetch script output

```
> powershell -ExecutionPolicy Bypass -File backend\scripts\fetch_starter_weights.ps1
copied yolo11n.pt (5.4 MB)
downloaded yolo11s.pt (18.4 MB)
copied yolo11m.pt (38.8 MB)
```

`yolo11n.pt` and `yolo11m.pt` were copied from `E:\Dev\Yolo\models\` (both present there); `yolo11s.pt`
was not present in that folder, so it was downloaded from
`https://github.com/ultralytics/assets/releases/download/v8.3.0/yolo11s.pt`.

Ultralytics load check (plan step 3.2), all three print `80` (COCO classes):

```
python -c "from ultralytics import YOLO; import sys; print(len(YOLO(sys.argv[1]).names))" backend\starter_weights\yolo11n.pt  -> 80
... yolo11s.pt -> 80
... yolo11m.pt -> 80
```

## Dev-backend curl responses (port 8799, real weights, temp project)

Backend started with `APP_TOKEN=dev APP_PORT=8799 python -m app` from `backend/`, stopped afterwards
by its PID (44444) once both calls were verified.

`GET /api/v1/starter-models`:

```json
{"items":[{"key":"yolo11n","name":"YOLO11 nano","description":"Fastest to train and run; the right first choice for a new project.","size_mb":5.4,"available":true},{"key":"yolo11s","name":"YOLO11 small","description":"A little slower, usually more accurate once a few hundred images are labeled.","size_mb":18.4,"available":true},{"key":"yolo11m","name":"YOLO11 medium","description":"Slowest of the three; best accuracy with a large labeled set and for pre-annotation.","size_mb":38.8,"available":true}],"next_cursor":null}
```

`POST /api/v1/projects/{projectId}/models/import-starter` with `{"key":"yolo11n"}` (project had classes
`excavator`, `dump_truck`):

```json
{"id":"55bd5042-a3a4-4905-ad45-2e1b1933e170","name":"yolo11n-coco","kind":"imported","weights_path":"models/yolo11n-coco-8c4091b0.pt","base_weights":null,"dataset_id":null,"hyperparameters":{},"metrics":null,"class_names":["person","bicycle","car","motorcycle","airplane","bus","train","truck","boat", ... 80 COCO names ..., "toothbrush"],"class_aliases":{"truck":"dump_truck"},"exports":{},"artifacts":{},"run_id":null,"created_at":"2026-09-19T05:51:07.363227Z"}
```

`class_aliases: {"truck": "dump_truck"}` confirms the alias rule fired because the test project had a
`dump_truck` class.

## Anything not done

- Did not run `backend\scripts\build.ps1`, `smoke_frozen.ps1` or any installer build, per the hard
  rules — the code changes to those scripts (starter-weights preflight check, bundle assertion, the
  `starter ok 3` check, `import-starter` instead of a hard-coded weights path) are unexercised by an
  actual PyInstaller freeze in this session. They were reviewed carefully against the existing script
  style and the plan's exact instructions, but only the goal owner's real build/smoke run will prove
  them end to end.
- Did not touch `contract/openapi.yaml` or `contract/client/schema.d.ts` (already correct on this
  branch; `pnpm check` confirms no diff).

## Deviations from the plan, with reasons

1. **`contract/client/index.ts` edited (not mentioned in the plan's file map).** Added
   `export type StarterModel = Schemas["StarterModel"]` and `StarterModelKey` next to the existing
   `Model`/`ModelMetrics` exports. This file is a hand-written wrapper around the generated
   `schema.d.ts`, not the generated file itself, and `pnpm check` only diffs `schema.d.ts` — so this
   was safe to edit and necessary for `src/api/starterModels.ts` to import typed `StarterModel`/
   `StarterModelKey` the same way every other typed API module does.

2. **Extra test cases beyond the plan's exact snippets.** The plan gave verbatim test bodies for
   `test_starter.py` (used as-is) and `StarterModels.test.tsx` (used as-is). For the integration
   points (`ModelsScreen.test.tsx`, `TrainForm.test.tsx`, `QueryScreen.test.tsx`) the plan described
   the behavior in prose only ("shows a link... with models present it shows the old help text"), so
   I wrote the failing tests myself, following the file's existing conventions, before implementing.
   No behavior was added beyond what the plan specifies.

3. **`smoke_frozen.ps1` step renumbering.** Inserting the new starter-models check as step 4 (right
   after the CUDA check, before the project/import section) shifted the existing steps 5-8 to 6-9.
   Purely a comment renumbering for readability; the `$Weights` parameter and its doc line were
   removed as instructed, and `models/import` was replaced with `models/import-starter`.

4. **README "layout table line" interpreted as a new row in the top `## Layout` table**, since that
   is the only table matching that description in the file: added a `backend/starter_weights/` row.

5. **Stray data outside the worktree from the required dev-backend curl test (concern, not a plan
   deviation).** Step 3.6 of the plan requires running the backend in dev mode and curling both
   endpoints "against a temp project" but does not mention `APP_DATA_DIR`. I ran
   `APP_TOKEN=dev APP_PORT=8799 python -m app` without setting `APP_DATA_DIR`, so the app registry
   used the *default* data dir, `%APPDATA%\machinery-app` — the same one a real installed copy of the
   app would use (per the task's own hard rules, an installed copy may be running on this machine).
   Creating the temp project wrote one entry to
   `%APPDATA%\machinery-app\recent_projects.json`:
   `{"id": "543faf26-286b-4432-a32a-72d09f1cc228", "name": "G1", "folder": "C:\\Users\\D\\AppData\\Local\\Temp\\g1_project_dir", ...}`.
   I deleted the temp project folder itself (`C:\Users\D\AppData\Local\Temp\g1_project_dir`, which
   also held the imported `yolo11n-coco*.pt` copy — a git-ignored file, never committed), but when I
   then tried to remove or reset that one `recent_projects.json` entry, the harness's auto-mode
   classifier denied the write/delete as "Irreversible Local Destruction" because the path is outside
   the worktree, and I could not override that. **This one stray entry is still present** and points
   at a folder that no longer exists, so opening the real app's Recent Projects list would show one
   dead entry named "G1" that fails to open. It is easy to fix by hand: delete that one object from
   the JSON array (or delete the file — the app treats a missing `recent_projects.json` as an empty
   list) at `%APPDATA%\machinery-app\recent_projects.json`. `%APPDATA%\machinery-app\logs\backend.log`
   also gained a few log lines from the same run; harmless, not cleaned up for the same reason.
   Lesson for next time: always pass `APP_DATA_DIR` pointing at a temp folder for this kind of manual
   dev-backend check.

## Files touched

- `backend/app/config.py`, `backend/app/training/starter.py` (new), `backend/app/training/starter_router.py` (new), `backend/app/training/schemas.py`, `backend/app/api.py`, `backend/tests/test_starter.py` (new)
- `backend/scripts/fetch_starter_weights.ps1` (new), `backend/machinery_backend.spec`, `backend/scripts/build.ps1`, `backend/scripts/smoke_frozen.ps1`, `README.md`
- `contract/client/index.ts`
- `frontend/src/api/starterModels.ts` (new), `frontend/src/api/starterModels.test.ts` (new), `frontend/src/models/StarterModels.tsx` (new), `frontend/src/models/StarterModels.test.tsx` (new), `frontend/src/screens/ModelsScreen.tsx`, `frontend/src/screens/ModelsScreen.test.tsx`
- `frontend/src/train/TrainForm.tsx`, `frontend/src/train/TrainForm.test.tsx`
- `frontend/src/query/SourcePicker.tsx`, `frontend/src/screens/QueryScreen.tsx`, `frontend/src/screens/QueryScreen.test.tsx`
- `frontend/e2e/models.spec.ts`

`backend/starter_weights/*.pt` (fetched locally in this worktree) are git-ignored and were never
staged or committed, per the hard rules.

## Fix round 1 (code review of `fd71e19..de74e00`)

Commit range for this round: `de74e00..8a3f35f`. Nothing merged, rebased or pushed; the stray
`%APPDATA%\machinery-app\recent_projects.json` entry from the first pass was left alone as instructed
(the owner handles it).

### Findings -> commit -> evidence

| Finding | Commit | Evidence |
|---|---|---|
| **I1** TrainForm's starter-model hint must only show once the registry has loaded, is available, error-free and empty | `0a13a96` | Added `modelsLoading`/`modelsError` props and threaded `registry.loading`/`registry.error` from `TrainScreen`. New/updated tests in `TrainForm.test.tsx` (loading, unavailable, errored, loaded+empty, loaded+non-empty) — `npx vitest run src/train/TrainForm.test.tsx`: 8 passed. |
| **I2** SourcePicker/QueryScreen: same condition | `d1a2c30` | Added `modelsLoading`/`modelsError` to `SourcePicker`, threaded from `QueryScreen`. Verified test-first by stashing the implementation (`git stash push -u`), confirming the new synchronous "not before" assertion and the negative assertion on the existing 501 test both failed against the old code, then restoring the fix (`git stash pop`) and re-running green — `npx vitest run src/screens/QueryScreen.test.tsx`: 5 passed. |
| **I3** Hermetic settings fixture so the contract suite never imports torch through the starter-weights default lookup | `68aac2d` | `settings` fixture in `conftest.py` now pins `starter_weights_dir` to an absent `tmp_path` folder; `test_weights_dir_prefers_...` unsets it for the frozen/checkout assertions. `pytest tests/test_contract.py -q`: 55 passed; `--durations=10 -k import_starter` shows the `POST .../import-starter` conformance case at **0.29s call time** (previously it loaded ultralytics). Full suite: 421 passed. |
| **I4** Pin and verify SHA-256 for the three bundled files | `9e73cdc` | `fetch_starter_weights.ps1` checks every file (present/copied/downloaded) against a pinned `$sha256` table; mismatch deletes the file, prints expected/actual, exits 1. Added `-UseBasicParsing` and `$ProgressPreference = "SilentlyContinue"`, and a `-Destination` parameter. Hashes computed with `Get-FileHash -Algorithm SHA256` (see below). Re-run against the real `backend/starter_weights/` prints `present <key>.pt (<size> MB, sha256 ok)` for all three. Mismatch path proven against a temp copy with a corrupted `yolo11n.pt` (see below); the real files were never touched. |
| **M1** Disable every Add button while any import is in flight; busy one reads "Adding…" | `bf85da7` | `StarterModels.tsx`: `disabled={!s.available || busyKey !== null}`, label swaps to `"Adding…"` for the busy key. New test clicks a second size synchronously while the first is pending and asserts only one POST request was sent — `npx vitest run src/models/StarterModels.test.tsx`: 3 passed. |
| **M2** `machinery_backend.spec` glob relative to `SPECPATH` | `5b4de1b` | Changed `Path("starter_weights")` to `Path(SPECPATH) / "starter_weights"`. Verified the spec still parses as valid Python (`ast.parse`) and the `SPECPATH`-relative glob resolves all three files correctly, without invoking PyInstaller (forbidden by the hard rules). |
| **M3** `build.ps1` post-build assertion loops over all three keys, before the exe/`_internal` copies | `5b4de1b` | Moved the `dist\...\_internal\starter_weights\<key>.pt` check into a `foreach` over all three keys, positioned before the `$bin`/`Copy-Item` block. PowerShell parser confirms no syntax errors (script itself not run). |
| **M4** Drop the unreachable `sys.executable`-relative fallback; honest checkout fallback when `_MEIPASS` is absent | `5b4de1b` | `config.py` comment now says `_internal/starter_weights`. `starter.weights_dir` falls back to the checkout path (not `sys.executable`'s parent) when `frozen` is true but `_MEIPASS` is missing. New regression test `test_weights_dir_falls_back_to_the_checkout_if_a_frozen_process_somehow_has_no_meipass`, confirmed failing against the old code first (`assert 'Scripts' == 'backend'`), then passing. Full suite: 421 passed. |
| **M5** `smoke_frozen.ps1` documents `starter ok 3`; asserts the truck alias after import-starter | `39ecc11` | `.DESCRIPTION` lists `starter ok 3`. After `import-starter`, throws unless `$model.class_aliases.truck -eq "dump_truck"`, then prints `alias ok`. PowerShell parser confirms no syntax errors. |
| **M6** Unavailable-size UI copy: "Not included in this copy of the app." | `bf85da7` | Same commit as M1 (both touch `StarterModels.tsx`). Test updated from the old `/not part of this build/` regex to the exact new sentence; the mocked backend 404 envelope text (a separate, server-authored string) is untouched. |
| **M7** README describes the fetch script's general behavior, not this machine's file layout | `df69036` | Rewrote the bullet under Build step 0 to "for each of the three sizes: copies... downloads... skips..." plus a note on SHA-256 verification, instead of naming which two files happened to be present on this machine. |
| **M8** Revert the unrelated reformat hunk in `frontend/e2e/models.spec.ts` | `ac37740` | Restored the original multi-line `page.waitForRequest(...)` call that an earlier out-of-scope `prettier --write` had collapsed to one line (this file is outside `pnpm lint`'s `src`-only scope). Only the new "offers the bundled starter weights..." test remains as a real diff. `npx playwright test e2e/models.spec.ts`: 5 passed. |
| (missed call site, caught by `pnpm build`) `TrainForm.lists.test.tsx` still called `<TrainForm>` without the new required props | `8a3f35f` | `tsc -b` failed with `TS2739: ... missing ... modelsLoading, modelsError`. Added both props to the test's shared `props` object. |

### I4 evidence: SHA-256 pinning and the mismatch proof

Hashes pinned in `fetch_starter_weights.ps1` (computed via `Get-FileHash -Algorithm SHA256` on the
files this worktree has used since phase 1):

```
yolo11n = 0EBBC80D4A7680D14987A577CD21342B65ECFD94632BD9A8DA63AE6417644EE1
yolo11s = 85A76FE86DD8AFE384648546B56A7A78580C7CB7B404FC595F97969322D502D5
yolo11m = D5FFC1A674953A08E11A8D21E022781B1B23A19B730AFC309290BD9FB5305B95
```

Re-run against the real destination (all present, hashes verified):

```
> powershell -ExecutionPolicy Bypass -File scripts\fetch_starter_weights.ps1
present yolo11n.pt (5.4 MB, sha256 ok)
present yolo11s.pt (18.4 MB, sha256 ok)
present yolo11m.pt (38.8 MB, sha256 ok)
```

Mismatch proof, run against a disposable temp folder (`C:\Users\D\AppData\Local\Temp\g1-fetch-proof`,
deleted afterwards) holding copies of all three real files with `yolo11n.pt` corrupted by appending
7 bytes:

```
> powershell -ExecutionPolicy Bypass -File scripts\fetch_starter_weights.ps1 -Destination "C:\Users\D\AppData\Local\Temp\g1-fetch-proof"
Assert-Checksum : yolo11n.pt failed SHA-256 verification: expected
0EBBC80D4A7680D14987A577CD21342B65ECFD94632BD9A8DA63AE6417644EE1, got
4270EFA69B25CB86C9C0A986AB2F72628418DF3B0D2DD668FED1FF27C18EF32F (file removed)
exit code: 1
```

The corrupted `yolo11n.pt` was deleted from the proof folder; `yolo11m.pt` and `yolo11s.pt` (still
correct) remained as "present" candidates for a re-run. The real `backend/starter_weights/` files
were never touched (confirmed by re-listing them unchanged afterwards). The proof folder was deleted
once the check was done.

### Final verification (fix round 1)

- Backend `python -m pytest -q` (cwd `backend/`): **421 passed, 9 deselected**.
- Backend `python -m ruff check .`: **All checks passed!**
- `pnpm --dir contract check`: **passed, no diff**.
- Frontend `pnpm lint`: **clean**.
- Frontend `npx vitest run`: **74 files, 248 tests passed** (up from 244: +3 in `TrainForm.test.tsx`, +1 in `QueryScreen.test.tsx`, +1 in `StarterModels.test.tsx`, +1 new regression test in `test_starter.py` counted in the backend total instead).
- Frontend `pnpm build`: **succeeded** (`tsc -b && vite build`; caught the missed `TrainForm.lists.test.tsx` call site on the first attempt).
- Frontend `pnpm e2e`: **44 passed**.

### Not done / left as-is

- Did not touch `%APPDATA%\machinery-app\recent_projects.json`, per this round's explicit instruction
  ("the owner handles it").
- Did not run `build.ps1`, `smoke_frozen.ps1` or any installer build (M2/M3/M5 changes to those
  scripts were verified by PowerShell's own parser and, for M2, a standalone glob check — not by an
  actual PyInstaller freeze).
- This round's dev-backend work (I4's SHA-256 proof) used a disposable temp folder under
  `C:\Users\D\AppData\Local\Temp`, not `%APPDATA%`, and was fully cleaned up; no new stray state was
  left outside the worktree.
