# S6 review: tasks 1, 2, 4, 5 on `s6-packaging-acceptance` (f52267c..02359a9)

Reviewer lens: the briefs in `.superpowers/sdd/wave3/s6-task-{1,2,4,5}-brief.md`, the plan header, spec
sections 10, 11, 13.4, 13.5 and the global constraints. Every finding below was checked against the
code in the worktree, not taken from the report. Task 3 (installer) is out of scope; nothing in this
diff touches it beyond the README/progress notes. File:line references are to the worktree
`E:\Dev\Yolo\app\.worktrees\s6-packaging-acceptance`.

## A. Spec compliance

### Task 1: full PyInstaller spec and frozen smoke script - ✅

| Brief item | Status | Where |
|---|---|---|
| S0 excludes replaced with the hiddenimports / datas / binaries lists | ✅ | `backend/machinery_backend.spec:7-53` |
| `pywin32_system32` from the brief's list | ⚠ omitted, documented | `spec:25-28`. Verified: `.venv/Lib/site-packages` has `pywin32_ctypes-0.2.3` + `win32ctypes`, no `pywin32_system32` package, so the omission is correct. |
| `torchvision._C_stable` / `image_stable` (not in the brief) | ⚠ added, documented | `spec:13-18`. Verified: `.venv/Lib/site-packages/torchvision/_C_stable.pyd` and `image_stable.pyd` exist; the report's RED (`operator torchvision::nms does not exist`) is consistent. |
| `console=False` only after confirming the JSON line reaches Tauri as `CommandEvent::Stdout` | ⚠ | `spec:63-66`. The cited evidence (`[backend] {"event": "starting"...}` in the dev console) cannot distinguish Stdout from Stderr: `sidecar.rs:63` prints the same prefix for both arms. Harmless: the launcher never reads the port from that line (it chooses `free_port()` and passes `APP_PORT`, `sidecar.rs:49-58`), and `smoke_frozen.ps1:96-106` parses it from a redirected stdout, which does prove the channel. See M13. |
| `health.gpu` computed on first request in a thread, 10 s timeout | ✅ | `backend/app/health.py:33-74`; the contract already carries the optional nullable `gpu` (`contract/openapi.yaml:1035-1044`), untouched. |
| `smoke_frozen.ps1`: APP_TOKEN / APP_PORT=0 / parse port / health within 20 s / gpu.available / temp project / 3 frames / yolo11n / preannotate imgsz 640 / 1-epoch worker train / ONNX / stop by PID / timings | ✅ | `backend/scripts/smoke_frozen.ps1:91-231`. Extra (not in the brief, but required by the global constraints): keyring round trip (`:202-217`) and the font check (`:189-191`). Sample frames are copied out of `E:\Dev\Yolo\data\raw\ahmadia` (`:88-89`); the read-only original imagery is not touched. |
| Run build + smoke, paste output, record size | ✅ | report (3,457.8 MB, 23.8 s, timings) and the `docs/progress.md` table. |
| Commit message | ✅ | `eb3189b` |

### Task 2: hardening - ✅ (with minor notes)

| Brief item | Status | Where |
|---|---|---|
| Orphan sweep on project open: running -> failed "interrupted by application restart", queued -> cancelled; hand-prepared DB test | ✅ | `backend/app/jobs/startup.py:22-46`, hooked through `ProjectRegistry(on_open=...)` (`app/projects/service.py:98-102, 146-151`, `app/main.py:35-38`). `JobRunner.is_live` (`runner.py:141-144`) keeps this process's jobs untouched. Tests insert rows directly (`tests/test_job_startup.py:23-32`) and exercise a real live job (`:54-69`). |
| Arial pre-seed, no network on first training, test asserts the file after the worker's setup step | ✅ | `backend/app/training/fonts.py`, called first thing in `worker.main` (`worker.py:216`); `tests/test_ultralytics_env.py:67-76`. Note M9: only the worker gets the app-data config dir; the API process (preannotate) still uses Ultralytics' default. The matplotlib fallback is unexercised in the frozen build (the reference machine has Arial). |
| Sidecar log tee `<app_data>/logs/sidecar.log`, 5 MB rotation, `backend_info.log_path`, dialog shows it | ✅ | `frontend/src-tauri/src/logfile.rs`, `sidecar.rs:60-83`, `lib.rs:10-15`, `frontend/src/api/backend.ts:8-30`, `client.tsx:132-137`; tests `logfile.rs:88-154`, `client.test.tsx`, `backend.test.ts`. |
| CSP verbatim, nsis `installMode currentUser`, version 0.1.0, dev boot verified | ✅ | `frontend/src-tauri/tauri.conf.json:25, 47-49`; version already 0.1.0. No external URLs, fonts or workers in `frontend/src` / `index.html`, so `default-src 'self'` plus the listed sources cover the app; thumbnails/images are `http://127.0.0.1:<port>` (img-src), API + events are connect-src http/ws. The dev-mode "0 CSP violations" is the implementer's observation and could not be re-run here. |
| Commit message | ✅ | `4268a96` |

### Task 4: acceptance script and driver - ❌

| Brief item | Status | Where |
|---|---|---|
| `scripts/acceptance.md`: eight steps, exact UI actions, expected values, evidence names | ✅ (minor text issues, M4) | `scripts/acceptance.md` |
| Driver performs steps 1-8 with UI actions + API assertions | ❌ | `frontend/scripts/acceptance.mjs`. With the default parameters (30 labelled, 50 query images) the driver cannot get past step 4: the image table is virtualised and rows beyond the viewport are not in the DOM (C1). Step 3 reads boxes before pre-annotation has run (I1). Step 7 never asserts provider provenance, which is the spec's expected result (I3). Step 5's pass criterion in the md (>= 3 websocket `job.progress` events) is not what the driver checks (I4). |
| Screenshots per step into `docs/evidence/acceptance/` | ✅ | `acceptance.mjs:67`, `:231, 259, 291, 337, 393, 434, 437, 444, 484, 512` |
| `ANTHROPIC_API_KEY` from the environment, stored through the providers endpoint at runtime, deleted afterwards, never written, clean skip | ⚠ | `acceptance.mjs:454-497`: read at runtime, never written to a file or the JSON (`config: cfg` holds no key), deleted in `finally`, clean skip. But it overwrites and then deletes an operator's existing key (I2). |
| Import polls progress, up to 60 minutes | ✅ | `:48, 253` |
| Parametrised for a 20-frame dry run, defaults = real values | ✅ | `:26-51` (3299 / 0 / 7 flights / 10 images / 30 labels / 3 epochs / 50 / 5 / 0.25). |
| Run end to end on the installed app; fix what breaks | ⚠ not possible | Blocked on Task 3; a dry run on 20 frames in the dev shell was done (7 passed, 1 skipped). The dry run used 6 and 5 rows and so never touched the failure in C1. |
| Commit message | ✅ | `3f49daf` |

### Task 5: README and final verification - ✅

| Brief item | Status | Where |
|---|---|---|
| Build, install, dev against mock and real backend | ✅ | `README.md:52-145` (`scripts/dev.ps1 -Mode mock|backend` exists; `requirements-dev.txt` exists) |
| Tests: backend incl. `gpu` and `live` markers, contract, frontend unit and e2e, checkpoint and acceptance drivers | ✅ | `README.md:147-179`; `pnpm test/lint/build/e2e` scripts exist in `frontend/package.json:6-16` |
| Troubleshooting: sidecar log path, ports, GPU not detected, re-running the installer | ✅ | `README.md:181-201` |
| Environment facts (reference machine, pins) | ✅ | `README.md:20-35` |
| Run the suites and paste the results | ✅ (on the branch head, not on `main`; acceptable since the branch is what is under review) | report table |
| Commit message | ✅ | `02359a9` |

## B. Quality findings

### Critical

**C1. The driver cannot tick 30 or 50 rows: the image table is virtualised and off-screen rows do not exist in the DOM.**
`frontend/scripts/acceptance.mjs:191-198` (`selectRows`), used at `:319` (30 labelled rows) and `:415` (50 unlabelled rows).
`frontend/src/data/ImageTable.tsx:32-36` renders only `computeWindow(scrollTop, height, ROW_HEIGHT=36, count)` with an overscan of 4 (`useVirtualRows.ts:11-25`). In the 900 px app window the list viewport holds roughly 20 rows, so about 25 rows are mounted. `page.getByLabel("Select <file>")` for row 26+ resolves to nothing; `scrollIntoViewIfNeeded()` waits for attachment and times out (30 s), and the run aborts in step 4 before any training. Ticking a checkbox does not scroll the container, so the window never moves. The dry run passed only because it selected 6 and 5 rows; `checkpoint3.mjs:151-155` has the same pattern and got away with about 12 rows.
Fix: scroll the grid's scrolling container to `index * 36` before locating each row (`page.evaluate` on the `overflow-auto` element inside `[data-testid="image-table"]`, then `waitFor` the checkbox), or use the table's own range selection (click row 0, scroll, shift-click row N-1 through `onRowClick` mods) and assert `${count} selected`. Then re-run the dry run with `--label-count 30 --query-images 50` on a copy of at least 60 frames so the fix is actually exercised.

### Important

**I1. Step 3 counts proposals before pre-annotation has had a chance to run.**
`acceptance.mjs:285-290`: `openEditor` returns as soon as `data-image` is set and the Konva canvases exist, sleeps 500 ms, then reads boxes through the API. In `frontend/src/editor/useEditorImage.ts:29-39` the image record and existing boxes are loaded first (that is what sets `data-image`), and only then is `preannotateImage` called; yolo11m at the project's imgsz takes seconds on the first call (the smoke test measured 1.9 s for yolo11n at 640 including model load) and hundreds of milliseconds afterwards. The driver therefore undercounts, and with the default `--min-proposals 1` can fail step 3 (or, with `0`, pass vacuously) even when the model proposed. The dry run's "0 proposals over 3 images" cannot be separated from this race. Moving to the next image sets `cancelled` in the hook, but the server still writes the proposals, so the count for image k can land after the read for image k.
Fix: after `openEditor`, `await page.waitForResponse(r => r.url().includes('/preannotate'))` (skip when the image already has unreviewed boxes, `useEditorImage.ts:36-37`), or wait for the editor notice / `data-testid="proposal-count"` to settle, then read boxes.

**I2. Step 7 destroys an operator's stored Anthropic key.**
`acceptance.mjs:457` stores the environment key with `PUT /providers/anthropic/key` unconditionally and `:492` deletes it in `finally`. If the machine already holds a key (any operator who has used the Settings screen; checkpoint 3 ran on the reference machine), it is overwritten and then removed. `smoke_frozen.ps1:204-216` does this correctly (reads `has_key` first and refuses to touch an existing key); the driver must do the same.
Fix: `GET /providers` first; when `anthropic.has_key` is true, run the step with the stored key and do not delete; only store+delete when nothing was stored.

**I3. Step 7 does not assert the spec's expected result (boxes with provider provenance).**
`acceptance.mjs:485-490` asserts `cloud.image_ids.length === cloudImages && cloud.tiling.enabled`; provenance is only printed in the detail string (`provided[0]?.provenance ?? null`). Spec 13.5 step 7: "expect boxes with provider provenance"; `scripts/acceptance.md:97-100` promises "boxes ... carry provenance kind cloud_provider with provider: anthropic". A run that returns zero boxes, or boxes without provenance, passes.
Fix: collect boxes across the run's images and assert at least one with `provenance.kind === "cloud_provider" && provenance.provider === "anthropic"` (and `cloud.box_count > 0`); choose the 5 images in the md so that dump trucks are present.

**I4. The md and the driver disagree on what passes step 5, and neither checks websocket events.**
`scripts/acceptance.md:73-76`: "at least 3 `job.progress` events arrive over the websocket". `acceptance.mjs:398-400`: `trainJob.progress.length >= 2`, where `progress` is the list of distinct `GET /jobs/{id}` lines seen by a 1 s poll (`:120-131`); no websocket is involved. The md declares itself the source of truth for what passing means (`acceptance.md:7-8`). The epoch card read at `:389-392` is UI evidence that events reach the page, but it is not asserted either (`.catch(() => "")`).
Fix: either subscribe to `/api/v1/events` from the driver (or count `job.progress` messages in the page via `page.evaluate` with a WebSocket) and assert `>= epochs` events, or change the md to state the polled criterion and assert the epoch card shows `${epochs} / ${epochs}`.

### Minor

**M1.** `acceptance.mjs:338-347` step 4 does not assert `dataset.split_method === "by_group"` (spec: "split by group") nor that `data.yaml` has `names:` with the eight classes; it relies on the dialog default (`frontend/src/data/AddToDatasetDialog.tsx:27`). Add both assertions.

**M2.** `acceptance.mjs:396-397` `Boolean(trained.metrics)` passes for `{}`; the md promises `map50`, `map50_95`, `precision`, `recall`. Assert `typeof trained.metrics.map50 === "number"`.

**M3.** `acceptance.mjs:520` writes `acceptance.json` only after all steps pass; `step()` throws on the first failure (`:64`), so a failed run leaves no JSON evidence. Write it in a `finally` (with the failing step recorded).

**M4.** `scripts/acceptance.md`: the evidence list for step 6 omits `acceptance-06-review.png` (written at `acceptance.mjs:437`); step 5's UI line (`:70-72`) is garbled ("`Base model` = `yolo11m-coco` is the imported COCO model, so import ... first and pick it"); the step 7 skip message (`:101`) differs from the driver's (`acceptance.mjs:496`).

**M5.** Step 6 "review" (`acceptance.mjs:435-438`) opens the Review queue and goes back; nothing is reviewed and promotion is vacuous when `box_count` is 0 (the dry run had 0 boxes). Define "review" in the md and, for the real run, assert `run.box_count > 0` (or at least that the queue lists the run's images).

**M6.** `acceptance.mjs:91-100` puts the first 300 bytes of an error body into the thrown error, and the backend's 422 handler echoes pydantic's `input` (`backend/app/errors.py:38-41`). For `PUT /providers/anthropic/key` that would print the key. Unreachable today (`api_key: min_length=1`, and the driver skips on an empty variable), but redact the body for that one call.

**M7.** `backend/tests/test_ultralytics_env.py:40-47, 55-58, 67-76` leak `YOLO_CONFIG_DIR` into the pytest process: `monkeypatch.delenv(..., raising=False)` records nothing when the variable is absent, and `configure_ultralytics` then sets it (`fonts.py:70`). Later tests and any worker subprocess they spawn inherit a config dir inside a finished test's `tmp_path`. Use `monkeypatch.setenv("YOLO_CONFIG_DIR", "")` (treated as unset by `_config_dir`) so it is restored.

**M8.** `backend/app/health.py:61`: every test app that hits `/health` (`test_health_ok`, the schemathesis contract tests) starts a real `probe_cuda` thread that imports torch inside the pytest process. Have the conftest `app` fixture install a stub probe, the way it installs `MemoryKeyStore` (`tests/conftest.py:37-41`), and keep one explicit test for the real probe.

**M9.** `backend/app/training/fonts.py` is only called by the worker (`worker.py:216`). The API process (pre-annotation inference) still lets Ultralytics use `%APPDATA%\Ultralytics`, which contradicts `README.md:141-142` ("`ultralytics/` (the pre-seeded plot font)" as the app-data layout). Either call `configure_ultralytics(settings.data_dir)` in `create_app` as well or document that only the worker is redirected. The DejaVuSans fallback path has never run in the frozen build.

**M10.** `backend/scripts/smoke_frozen.ps1:84-89, 230`: the work dir (project folder with copied frames, run folders, best.pt, a 10 MB ONNX) is never removed. Add a `-Keep` switch and delete by default. Process lifetime is fine (`taskkill /T /F`, `:225-229`).

**M11.** `frontend/src-tauri/src/logfile.rs:54-65`: when the rename fails (another process holds `sidecar.log` open: an editor, a `Get-Content -Wait`), the line is dropped and the file keeps growing past 5 MB until released. Consider appending anyway when the rename fails, and retrying rotation on the next line.

**M12.** `backend/app/projects/service.py:146-151`: `on_open` runs under the registry lock after `_handles[pid]` is set; a sweep that raises fails the opening request while the project stays open and unswept for the rest of the process. Wrap the callback in try/except and log; a sweep failure should not block opening a project.

**M13.** `machinery_backend.spec:63-66` / report: the "arrived as `CommandEvent::Stdout`" claim is not what the cited log line shows (`sidecar.rs:63` prints Stdout and Stderr identically). Reword the comment to cite the smoke script's redirected-stdout parse, which is the real evidence.

**M14.** `README.md:136-137` gives `/S` and `msiexec` instructions for an installer that does not exist yet; mark them as pending Task 3 so nobody follows them.

Not a finding, for the goal owner: after a sidecar crash the training worker subprocess (spawned with `CREATE_NEW_PROCESS_GROUP`, `trainer.py:211-217`) can outlive the parent; the sweep marks the row failed but does not stop the orphaned worker. Out of the Task 2 brief's scope.

## C. Verified claims

| Report claim | How checked | Result |
|---|---|---|
| `torchvision._C_stable` / `image_stable` needed; upstream hook names the old modules | `ls backend/.venv/Lib/site-packages/torchvision/*.pyd` | `_C_stable.pyd` and `image_stable.pyd` exist; no `_C.pyd` / `image.pyd`. Consistent. |
| `pywin32_system32` is not a module in this venv | `ls site-packages` | `pywin32_ctypes-0.2.3` + `win32ctypes` only. Correct. |
| Keyring pin holds in the frozen build | `app/providers/keys.py:28-44` pins `WinVaultKeyring` on first use; `smoke_frozen.ps1:202-217` exercises `PUT/DELETE /providers/anthropic/key` in the frozen exe | Code path matches the claim; the smoke output is the implementer's run. |
| Health stays fast; `gpu` absent while probing, fallback after 10 s, late answer wins | `health.py:55-73`, `tests/test_health.py:28-80` | Matches. Tests use an injected probe and a fake clock but exercise the real thread and lock. |
| Orphan sweep leaves live jobs alone | `startup.py:36`, `runner.py:141-144`; contexts inserted at submit (`runner.py:125-126`) and popped after the terminal write (`:190-193`) | Correct. The only window (context popped between the sweep's select and its `is_live`) cannot occur in production because the sweep runs at the first open per process and jobs need an open project. |
| Sweep hand-prepared DB test is real | `tests/test_job_startup.py:23-32` inserts rows through the session; the `handle` fixture is the app's real registry handle (`conftest.py:170-172`) | Real behaviour, no mocks. |
| Font seed test asserts the file after the worker's setup step | `tests/test_ultralytics_env.py:67-76` runs `worker.main` for real with a missing params file | Real; see M7 for the env leak. |
| Sidecar log: one line per event, rollover at 5 MB, one backup | `logfile.rs:39-65`, tests `:100-154` use real files | Matches; the report's RED/GREEN sequence is plausible (the two rotation tests fail without `rotate_if_full`). |
| `backend_info.log_path` null in env mode; dialog shows the Log row only when present | `sidecar.rs:44-51`, `lib.rs:14`, `backend.ts:19-30`, `client.tsx:132-137`, `client.test.tsx` | Matches. The frontend test mocks `invoke` and `waitForHealth` (the process boundary) and renders the real provider/dialog. |
| CSP verbatim, nsis `currentUser`, version 0.1.0 | `tauri.conf.json:25, 47-49`; version line unchanged | Matches. Dev-mode "0 CSP violations" not reproducible here. |
| Worker inherits `APP_DATA_DIR` so the seed lands under app data | `trainer.py:211-217` passes no `env=` (inherits) | Correct; the smoke's `font ok` path is consistent. |
| Driver: key read at runtime, never written, deleted in `finally`, clean skip | `acceptance.mjs:454-497`, `:58` (`config: cfg` has no key) | Matches, except the overwrite hazard in I2. |
| Driver selectors exist in the UI | grep of every `getByRole/getByLabel/getByTestId` string against `frontend/src` | All present (`Select model`, `Export ONNX`, `Run model`, `Review results`, `run-card`, `Tiling`, `First N images`, `Labeled` yes/no, ...). |
| Driver's editor-readiness wait | `EditorCanvas.tsx:55-66` (`data-image` set from the record; `Stage` mounts once the viewport is measured) | The wait is correct for drawing; it is not sufficient for counting proposals (I1). |
| Dry run "7 passed, 1 skipped" on 20 frames | Not reproducible here; the parameters (6 labels, 5 query rows) explain why C1 was not hit | Taken as reported, with that caveat. |
| Test counts (401 / 4 gpu / 68 files 209 / 42 e2e / 4 cargo) | Not re-run (no builds or processes per the review rules) | Taken as reported. |
| `main`'s `test_health.py` had one test; the branch has six | `git show f52267c:backend/tests/test_health.py` | One test before, six after. |

## D. Overall verdict

**Not approved** (as a whole). Tasks 1, 2 and 5 are approved as implemented (only Minor items). Task 4 is not: the driver cannot execute the real acceptance run with its default parameters (C1), step 3's measurement is racy (I1), step 7 endangers an operator's stored key (I2) and does not assert the spec's expected result (I3), and the md and driver disagree on step 5's pass criterion (I4). Fix C1 and I1-I4, re-run the dry run with `--label-count 30 --query-images 50` on a copy of at least 60 frames, and resubmit Task 4.

Counts: Critical 1, Important 4, Minor 14.
