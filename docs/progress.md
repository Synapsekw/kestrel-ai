# Progress log

Resume instructions for a new session: read this file top to bottom, then the plan for the
sub-project whose state is not `merged`, then continue from its first unchecked task.

## Current state

| Wave | Sub-project | Branch | Worktree | State | Blockers |
|---|---|---|---|---|---|
| 0 | S0 contract and scaffolding | main (merged from s0-backend, s0-frontend) | - | merged, checkpoint 1 passed | none |
| 1 | S1 dataset backend | main (merged cdafe95) | - | merged; checkpoint 2 backend half passed | none |
| 1 | S2 annotation UI | main (merged 9ed2fd4) | - | merged; checkpoint 2 editor half passed | none |
| 1 | S3 training backend and registry | main (merged 1224343) | - | merged; GPU test passes on main | none |
| 2 | S4 inference and providers | main (merged 6635f71) | - | merged after 2 fix rounds; JobCancelled relocation follow-up open | none |
| 2 | S5 training and inference UI | main (merged 04a879f) | - | merged after 2 fix rounds | none |
| 3 | S6 packaging and acceptance | main (merged from s6-packaging-acceptance at 9f3aa01) | - | merged after 2 fix rounds; checkpoint 4 and the acceptance run pending | none |

Last verified checkpoint: 3 (after Wave 2) on main 6635f71 (dev backend from the full venv, Tauri dev app in env mode), 2026-09-18.

## Plans

- S0: `docs/superpowers/plans/2026-09-17-s0-contract-and-scaffolding.md` (ledger: `2026-09-17-s0-ledger.md`)
- S1: `docs/superpowers/plans/2026-09-17-s1-dataset-backend.md`
- S2: `docs/superpowers/plans/2026-09-17-s2-annotation-ui.md`
- S3: `docs/superpowers/plans/2026-09-17-s3-training-backend.md`
- S4: `docs/superpowers/plans/2026-09-18-s4-inference-providers.md`
- S5: `docs/superpowers/plans/2026-09-18-s5-training-inference-ui.md`
- Wave 2 ledger (rulings, deferred minors): `docs/superpowers/plans/2026-09-18-wave2-ledger.md`
- S6: `docs/superpowers/plans/2026-09-18-s6-packaging-acceptance.md`
- Wave 2 ledger: `.superpowers/sdd/wave2/ledger.md`
- Wave 1 ledger: `.superpowers/sdd/wave1/ledger.md` (git-ignored; copied into docs at wave end)

Wave 1 mechanics: each worktree's `backend/.venv` is a directory junction to `backend/.venv` in the root checkout
(one shared environment; sub-agents must not install packages). Implementer reports land in
`.superpowers/sdd/wave1/<s>-report.md` (git-ignored). Merge order after review: S1, S3, then S2.

## Decisions the spec does not cover (question, chosen default)

1. Where do the shared job runner, event bus, SQLite models, migrations and project store live?
   Default: in S0. Three Wave 1 sub-projects need them and would otherwise each invent one.
   S1, S3 and S4 register job types through `app.jobs.registry.register_job_type`.
2. Are jobs global or per project? Default: per project (`/projects/{p}/jobs`), because the Job
   table is in `project.db` (spec section 4). The websocket `/api/v1/events` is global and
   every event carries `project_id`.
3. How does the browser get the token for the websocket? Default: `?token=` query parameter,
   because browsers cannot set headers on websocket connects. Rejected connects close with 4401.
4. Mock server and client generator: Stoplight Prism serves `openapi.yaml` on 127.0.0.1:4010;
   `openapi-typescript` generates `contract/client/schema.d.ts`; `openapi-fetch` wraps it.
5. Ports: backend dev 8765 (the launcher picks a free port in the packaged app), mock 4010,
   Vite 1420. 8080 and 9090 are left to the existing Label Studio workflow.
6. Extra endpoints beyond the literal spec section 9 list, each tied to another spec section:
   `GET /projects` (recent), `PATCH /projects/{p}` (settings), `POST .../images/{id}/preannotate`,
   `POST .../models/train`, `POST .../query-runs/estimate`, `POST .../images/bulk-delete`,
   `GET /projects/{p}/stats`. Recorded in the S0 plan.
7. The S0 sidecar is a PyInstaller build that excludes torch so checkpoint 1 can prove the
   boot mechanism quickly; S6 produces the full CUDA build.
8. Python dependency management: `uv venv --python 3.11.15` under `backend/.venv` and
   `uv pip install -r requirements-dev.txt`. The ML stack is pinned to the reference machine;
   app libraries are pinned by `requirements-lock.txt` produced after the first install.
9. Tauri identifier `ai.synapse-solutions.machinery-app`, product name "Machinery Detection".
10. Contract additions during Wave 1 (goal owner): `ModelImport.weights_path` minLength 1 (S3 can answer 422);
    `ExportRequest.half` documented (onnx on CPU, engine on GPU 0); `BoxReview.action` gains `unreview`
    (undo of accept/reject; person boxes ignored). In the editor, Delete on a proposal means reject.
11. ONNX export needs `onnx`/`onnxslim`/`onnxruntime`; added to `requirements.txt` (S6 decides TensorRT).
13. Installer format: NSIS (`makensis` 32-bit payload offsets) and MSI (compound file with 512-byte sectors, one embedded cab) both fail above 2 GB, and the CUDA sidecar is 3.46 GB with no trimmable margin (torch_cuda.dll imports the big CUDA DLLs by name; the frozen smoke test catches removal). Chosen: Inno Setup 6 (LZMA2, no 2 GB limit, per-user install, Start Menu shortcut, uninstaller) compiled by the `innosetup-compiler` npm package inside `frontend/node_modules` (no system install), wrapping `tauri build --no-bundle` output plus the WebView2 bootstrapper. Rejected: WiX external cabs (multi-file distribution) and a split/side-loaded payload (spec asks for one installer). Spec section 10 updated.
12. Packaged smoke test needs GPU visibility: optional `Health.gpu` `{available, name}` in the contract (f52267c), probed once in a background thread after the first health request so health stays fast.

## System installs (the single allowed exception)

- 2026-09-17: rustup 1.29.1 via `winget install Rustlang.Rustup`; toolchain stable-x86_64-pc-windows-msvc (rustc 1.98.1, cargo 1.98.1). MSVC 14.29 and Windows SDK 10.0.19041 were already present. Playwright downloaded Chromium into the user profile (not a system install).

## Checkpoints

### Checkpoint 3 (after Wave 2) — PASS on main 6635f71, 2026-09-18

Spec 13.4 #3: import, label with pre-annotation, create a dataset, train, run a query with the trained model and promote, all from the real app (Tauri dev shell in env mode, `WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=--remote-debugging-port=9222`) against the dev backend started from the full venv on port 8765. Driver: `frontend/scripts/checkpoint3.mjs` (Playwright over CDP; UI actions, API assertions). The run took three driver invocations because of two driver defects, fixed in place; nothing was re-done: the driver resumes on `CP3_PROJECT_ID` and `CP3_TRAIN_JOB_ID`. Evidence in `docs/evidence/checkpoint3/` (`checkpoint3-run1.log`, `-run2.log`, `-run3.log`, `checkpoint3.json`, screenshots 01–09).

| Step (UI unless noted) | Result | Evidence |
|---|---|---|
| Create project from the Projects screen (8 default classes) | PASS, project `ed5a8802` | run1.log |
| Import images dialog: 20 sample frames (copies from `data/raw/ahmadia`), site ahmadia | PASS: imported 20, duplicates 0, failed 0, one group `0031` | run1.log, `checkpoint3-01-import-started.png`, `-02-data-manager-imported.png` |
| Models screen: Import weights (`models/yolo11m.pt`, 80 COCO classes), Use as pre-annotation model | PASS | run1.log, `-03-model-imported.png` |
| Open 10 images in the editor: pre-annotation runs on open | PASS (0 proposals: COCO classes do not fire on nadir construction frames; the call path is exercised and answered 200) | run1.log, `-04-editor-after-preannotate.png` |
| Label 12 images (hotkey 1, drag a box each) | PASS: labeled 12, boxes 12 | run1.log, `-05-labeled.png` |
| Data Manager list view: tick the 12 labeled rows, Add to dataset, name `v1`, Create dataset | PASS: dataset job succeeded, train 10 / val 2 | run2.log, `-06-dataset-created.png` |
| Train screen: start training on `v1` from the imported weights (imgsz 640, batch 4) | PASS: job succeeded, epoch card "50 / 50", model `0c2d4482` registered with metrics (mAP50 0.068, expected for 10 images) | run2.log, `-07-training-done.png` |
| Query screen: trained model, confidence 0.01, Estimate, Start | PASS: estimate "8 images, 96 tiles, 96 requests"; run succeeded, 8 images, 96 tiles, 5263 boxes, 0 failed tiles | run3.log, `-08-query-run.png` |
| Promote at minimum confidence 0 | PASS: `promoted_at` set | run3.log, `-09-promoted.png` |
| Cloud provider query (spec 13.4 #3 "with a cloud provider") | SKIPPED: no `ANTHROPIC_API_KEY` / `OPENAI_API_KEY` in this environment. The driver runs the step when the variable is set (key stored through the providers endpoint at runtime, deleted afterwards, never written). Acceptance step 7 needs the operator to export the key before the run. | `checkpoint3.json` `skipped` |

Driver defects found and fixed during the run (not app defects): Ctrl+A selected page text instead of rows when the table lacked focus (now ticks the row checkboxes by label); `<option>` waits used visibility (now `state: "attached"`).

App observation recorded for a follow-up (not blocking the checkpoint): the Train form is keyed on the dataset and model lists, so it remounts and drops typed values when either list changes. The driver typed before the lists arrived, so the run trained with the suggested name `v1-yolo11m-coco` and the default 50 epochs instead of `cp3-model` / 1 epoch (imgsz and batch, typed after the remount, held). A user editing the form while a training job finishes would lose the edit the same way. Goal-owner fix with a test in the S6 wave.

### Checkpoint 2 (after Wave 1)

Result: PASS (backend half on cdafe95, editor half on de07f6a, 2026-09-18).

#### Backend half

Result: PASS on `main` cdafe95 (2026-09-18) through the real API (`backend/scripts/checkpoint2_backend.py`
against a dev backend on 8765). Evidence: `docs/evidence/checkpoint2/checkpoint2-backend.json`.

| Step | Evidence |
|---|---|
| Import 20 ahmadia frames (copied from `data/raw/ahmadia`): imported 20, duplicates 0, failed 0, one group `0031` | `import` step |
| Label 10 images via the boxes API: labeled_count 10, box_count 20 | `label` step |
| Dataset `v1` by_group -> 8 train / 2 val, `data.yaml` with absolute path and the eight names in order | `dataset` step |
| Import yolo11n (80 COCO class names), train 1 epoch imgsz 640 on the GPU: 21 s, progress event "epoch 1/1 mAP50 0.000", metrics + results_csv/confusion_matrix/pr_curve artifacts registered | `train` step |
| Export ONNX: 10.6 MB file under `models/` | `export onnx` step |

#### Editor half (real Tauri app, real sidecar built from main, driven over CDP)

`frontend/scripts/checkpoint2_editor.mjs`; evidence `docs/evidence/checkpoint2/checkpoint2-editor.json` and screenshots.

| Step | Evidence |
|---|---|
| Attach to the app, read the sidecar URL/token, create a project and import 20 frames through the real API | `attach and read backend info`, `import via api` |
| Open the project from the Projects screen; Data Manager lists the real images (virtualised grid) | `checkpoint2-01-data-manager.png` |
| Enter opens the editor; real frame rendered on the Konva stage; pre-annotate answered 501 (S4 pending) and was tolerated | `checkpoint2-02-editor-open.png` |
| Drag draws a box; `GET .../boxes` shows one person/accepted box | `checkpoint2-03-box-drawn.png` |
| Ctrl+Z deletes it on the server (0 boxes); Ctrl+Y recreates it (1 box) | `checkpoint2-editor.json` |
| Ctrl+Right navigates to the next image; project stats show labeled 1 / boxes 1 | `checkpoint2-04-next-image.png` |
| Window close terminates the sidecar and dev server; ports 1420/9222 free | session check |

### Checkpoint 1 (after Wave 0)

Result: PASS on `main` 389687c (2026-09-17), run by the goal owner on the reference machine.

How: `backend/scripts/build.ps1` froze the S0 backend (PyInstaller one-folder, torch excluded until S6) into
`frontend/src-tauri/binaries/`; `pnpm tauri dev` launched the real app with
`WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=--remote-debugging-port=9222`; `frontend/scripts/checkpoint1.mjs` attached to the
WebView2 over CDP and drove the UI.

| Step | Evidence |
|---|---|
| App boots, Tauri spawns the sidecar with a per-launch token and port, health passes, Projects screen renders | `docs/evidence/checkpoint1/checkpoint1-01-projects.png` |
| Create project from the UI (name, folder, classes) -> navigates to the Data Manager, `project.db` and subfolders exist | `checkpoint1-02-data-manager.png`, `checkpoint1-result.json` |
| Sidecar killed externally -> blocking dialog "Backend process exited (code -1)" with Restart | `checkpoint1-03-sidecar-died.png` |
| Restart respawns a new sidecar (new pid) and the UI recovers | `checkpoint1-04-after-restart.png` |
| Closing the window terminates the sidecar and the dev server (no leftover processes, ports 1420/9222 free) | PowerShell check in the session log |
| Mock server serves the contract (`pnpm mock`, 200 with token, 401 without) | S0 Task 2 verification |

Suites on main 389687c: backend 97 passed + ruff clean; contract `pnpm check` clean; frontend lint, 7 unit tests, build, 1 e2e passed.

Found and fixed during the checkpoint: the WebView2 origin's CORS preflight was answered 405 (Prism had masked it); CORS is now
restricted to `tauri.localhost` and the Vite origin (`Settings.cors_origins`). Cold-start timing is measured against the
installed app in S6 (dev mode includes the cargo build).

## S6 packaging evidence (reference machine, 2026-09-18)

Measured, not estimated. Reference machine: Windows 11 Pro 26200, RTX 5070 Ti, torch 2.14.0+cu130,
ultralytics 8.4.154, PyInstaller 6.22.3, Tauri CLI 2.11.4.

| Step | Command | Result |
|---|---|---|
| Freeze the backend | `backend\scripts\build.ps1` | 127 s; `dist/machinery-backend` 3,457.8 MB in 14,113 files |
| Frozen smoke test | `backend\scripts\smoke_frozen.ps1` | pass in 23.8 s: health 0.57 s, `cuda True NVIDIA GeForce RTX 5070 Ti` 3.8 s, predict, 1-epoch worker train 11.0 s, ONNX export 3.2 s, keyring round trip |
| App binary | `pnpm tauri build` (cargo release) | 65 s; `machinery-app.exe` 11.1 MB |
| Install tree that the installer would write | - | 3,468.9 MB (app 11.1 MB + sidecar exe and `_internal` 3,457.8 MB), well under the 6 GB success criterion |
| NSIS installer | `pnpm tauri build` | **fails**: `makensis` `Internal compiler error #12345: error mmapping file (2057025505, 33554432) is out of range` |
| MSI installer | `pnpm tauri build --bundles msi` | **fails**: `light.exe : error LGHT0001 : Catastrophic failure ... at Microsoft.Tools.WindowsInstallerXml.Cab.Interop.NativeMethods.CreateCabFinish` |
| Installed layout, run from a temp copy without installing | `machinery-app.exe` from the would-be install tree | sidecar spawned, `GET /api/v1/health` 200 with `gpu {available: true, name: NVIDIA GeForce RTX 5070 Ti}`, page served from `http://tauri.localhost/`; closing the window terminated the sidecar |
| **Inno Setup installer** | `pnpm build:installer` | **1,797.3 MB in 387 s** (ISCC alone 361.8 s), built without a WebView2 bootstrapper -> `frontend/src-tauri/target/release/bundle/inno/Machinery Detection_0.1.0_x64-setup.exe` |

Both failures are the same 2 GB wall, reached from two directions: an NSIS installer addresses its
payload with 32-bit offsets, and Tauri's WiX template puts everything in one embedded cabinet
(`<Media Id="1" Cabinet="app.cab" EmbedCab="yes" />`), which the cabinet format caps at 2 GB. The
payload cannot be brought under 2 GB by trimming: `torch/lib` alone is 2.78 GB and its large CUDA
DLLs (`cublasLt` 456 MB, `torch_cuda` 404 MB, `cufft` 272 MB, `cudnn_engines_precompiled` 212 MB,
`cusparse` 144 MB, `cusolver` 121 MB) are imported by name from `torch_cuda.dll`; dropping
`cufft`/`cusolver`/`cusparse` was tried and `torch.cuda.is_available()` went false (the frozen
smoke test caught it). Only about 205 MB is genuinely unreferenced (`cusolverMg`,
`nvrtc64_130_0.alt`, `nvperf_host`).

Resolved by decision 13: the installer is built with Inno Setup 6, which has no 2 GB limit, from
`frontend/installer/machinery-detection.iss` via `pnpm build:installer` (`ISCC.exe` comes from the
`innosetup-compiler` npm package, so nothing is installed system-wide). `bundle.targets` in
`tauri.conf.json` is now empty; the rest of the `bundle` block still drives the exe icon and the
sidecar and resource staging `pnpm tauri dev` needs.

Still open for the goal owner: install from the setup exe, measure cold and warm start, run
checkpoint 4 and the acceptance run on the installed app. The WebView2 bootstrapper is not in the
installer - nothing on this machine had a copy of `MicrosoftEdgeWebview2Setup.exe` (Tauri's
`downloadBootstrapper` mode fetches it at install time, so the cache holds none) and the
redistributable is not committed. The installer's `[Run]` entry and its registry check appear only
when `frontend/installer/MicrosoftEdgeWebview2Setup.exe` exists at build time; Windows 11 ships the
runtime, so the reference machine does not need it.

## S0 status detail

| Task | Owner | State | Commit |
|---|---|---|---|
| 1 skeleton | goal owner | done | c5b5722 |
| 2 contract + mock | goal owner | done, mock verified | 4d71fcd |
| 3 TS client | goal owner | done | 4d71fcd |
| 4 backend shell | goal owner | done | 715e772 (s0-backend) |
| 5 DB + projects | goal owner | done | f74ba9a |
| 6 jobs + events | goal owner | done | ebe00de |
| 7 stubs + conformance | goal owner | done, 85 backend tests | 88c7160 |
| 8 frontend shell | sub-agent | done, fix round 1 in progress | be0b87c (s0-frontend) |
| 9 tauri shell | sub-agent | done in env mode; real sidecar boot unverified | 845e149 |
| 10 dev script + CI | goal owner | done | ba8728c |
| 11 checkpoint 1 | goal owner | pending merge | |
| 12 README | goal owner | pending | |

Contract facts sub-projects must know: every path in `openapi.yaml` carries `/api/v1` (Prism 5 does not route by server base path); the token is accepted as a bearer header or a `token` query parameter; 501 `not_implemented` stubs mark the endpoints S1, S3 and S4 own.

SDD ledger (rulings, deferred minors): `.superpowers/sdd/2026-09-17-s0-contract-and-scaffolding/progress.md` (git-ignored; if lost, the git log is the record).

## Log

- 2026-09-17: session 1 started. Read spec, README, reuse files. Toolchain: node 24.11, pnpm 10.24,
  uv 0.11.32 with CPython 3.11.15 available, MSVC 14.29 (VS 2019 Build Tools) and Windows SDK
  10.0.19041 present, WebView2 153 present, Rust missing. Wrote the S0 plan.
- 2026-09-17: contract written and mock verified; backend tasks 4-7 and 10 implemented test-first (85 tests); Rust installed;
  frontend+tauri shell implemented by a sub-agent and reviewed (needs fixes, round 1 running); backend review running.
- 2026-09-18: Wave 1 started. S1 and S3 implementers dispatched in worktrees; S2 plan being written (first attempt stalled, retried).
- 2026-09-18: S3 reviewed (fable), fixed, re-reviewed (opus), merged to main 1224343; 168 backend tests, GPU training + ONNX export verified on main.
- 2026-09-18: S1 reviewed, fixed, re-reviewed, merged cdafe95 (250 backend tests). Checkpoint 2 backend half passed. Shared venv incident recovered (see wave 1 ledger).
- 2026-09-18: S2 reviewed (fable), 3 fix rounds, merged 9ed2fd4; main: 252 backend tests, 109 frontend unit, 27 e2e. Model artifact endpoint added (372d962). S4 plan written; S5 plan in progress; 'Import images' UI gap assigned to S5.
- 2026-09-18: Checkpoint 2 passed in full (editor half on the real app). Wave 2 started: S4 dispatched.
- 2026-09-18: S5 reviewed (fable), 2 fix rounds, merged 04a879f. S4 reviewed (fable), round 1 done, round 2 in progress. Contract: query minLength, query-run resume endpoint, model artifacts endpoint.
- 2026-09-18: S4 fix round 2 re-reviewed (opus) and merged 6635f71; main: 382 backend tests, 4 GPU tests, ruff, contract check clean; frontend 204 unit, 42 e2e. Wave 2 ledger copied to docs. Checkpoint 3 running on the real app (driver frontend/scripts/checkpoint3.mjs).
- 2026-09-18: Checkpoint 3 passed on the real app (cloud step skipped, no key). Wave 3 next: S6 dispatch. Goal-owner follow-ups: JobCancelled relocation (S4 M4), Train form remount on list change.
- 2026-09-18: Goal-owner follow-ups on main: JobCancelled leaf module (e85a363), Train form keeps typed values on list change (024ec6f, with tests), contract Health.gpu optional block (f52267c; client regenerated; contract test green). Wave 3 started: S6 dispatched; ledger `.superpowers/sdd/wave3/ledger.md`. Ruling: the sub-agent builds the installer and dry-runs the acceptance driver on the dev app; install, checkpoint 4 timing and the acceptance run on the installed app stay with the goal owner.
- 2026-09-18: S6 tasks 1, 2, 4 and 5 done on `s6-packaging-acceptance`: full CUDA PyInstaller bundle with a frozen smoke test, packaging hardening (orphan sweep, Arial pre-seed, sidecar log tee, CSP), the acceptance script and its CDP driver (dry-run green on 20 frames), and the README. Task 3 landed after the ruling on decision 13: the installer is built with Inno Setup 6 (1,797.3 MB in 377 s); install, cold start and checkpoint 4 are the goal owner's.
- 2026-09-18: S6 reviewed (fable: tasks 1, 2, 5 approved, task 4 rejected), Task 3 reviewed and round 1 re-reviewed (opus, approved with fixes), round 2 re-reviewed (sonnet, approved). Merged to main. Goal-owner verification at 9f3aa01: ruff clean, 403 backend, 4 gpu, contract check, frontend lint, 209 unit, build, 42 e2e. Next: install, checkpoint 4, acceptance run.
