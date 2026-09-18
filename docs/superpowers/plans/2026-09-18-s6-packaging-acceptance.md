# S6: Packaging and Acceptance Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn `main` into an installable Windows app: a PyInstaller one-folder backend that bundles CUDA PyTorch and Ultralytics, a Tauri NSIS installer that carries it as the sidecar, a frozen-build smoke test, startup under 15 s, the hardening items deferred from Waves 1 and 2 that affect packaged behaviour, the acceptance script (spec 13.5) with an automated driver, and the final README.

**Architecture:** The S0 `machinery_backend.spec` loses its torch exclusion and gains explicit collection of `ultralytics` (data files, configs), `torch`/`torchvision` (binaries incl. the CUDA runtime DLLs shipped inside the wheels), `cv2`, `onnx`, `onnxruntime`, `anthropic`, `openai`, `keyring` backends and `alembic` migrations. The frozen exe keeps the `worker` subcommand (training/export subprocess) and `multiprocessing.freeze_support()`. `backend/scripts/build.ps1` builds and copies into `frontend/src-tauri/binaries/`; `pnpm tauri build` produces `Machinery Detection_<version>_x64-setup.exe`. The acceptance driver attaches to the installed app's WebView2 over CDP (`WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=--remote-debugging-port=9222`) exactly like the checkpoint drivers.

**Tech Stack:** PyInstaller 6, Tauri 2 bundler (NSIS), Playwright (CDP), PowerShell.

**Spec:** `docs/superpowers/specs/2026-09-17-machinery-detection-app-design.md` sections 10, 11, 13.4 (checkpoint 4), 13.5 (acceptance), plus success criteria in section 1 (installer under 6 GB, cold start under 15 s).

## Global Constraints

- Nothing installed system-wide (Rust already present). Builds run from `backend/.venv` and `frontend/node_modules`.
- Pins unchanged: torch 2.14.0+cu130, torchvision 0.29.0+cu130, ultralytics 8.4.154.
- The frozen backend must: start and answer `/api/v1/health` in under 5 s; report `torch.cuda.is_available() == True` on the reference machine through a smoke endpoint or script; run one YOLO prediction; run a training subprocess (`<exe> worker train <params.json>`) with DataLoader workers (freeze_support); export ONNX; store keys through keyring's Windows backend.
- Installer under 6 GB; cold start of the installed app (double-click to Projects screen) under 15 s.
- Never write secrets; never touch `E:\Dev\Yolo` outside `E:\Dev\Yolo\app`; acceptance imports read `E:\Dev\Yolo\Ahmadia Construction Data` read-only (the import job only reads sources) and writes into a project folder the operator chooses (a temp folder in the driver).
- Ports 8080/9090 untouched. Stop only processes you started.
- TDD where code changes (Python tests for hardening items; the build steps are verified by scripts whose output is recorded).
- Run everything with `E:\Dev\Yolo\app\backend\.venv\Scripts\python.exe` from the worktree's `backend` directory; never `git clean`.

## File structure

```
backend/machinery_backend.spec        full build (replaces the S0 excludes)
backend/scripts/build.ps1             unchanged interface; adds a size report
backend/scripts/smoke_frozen.ps1      starts dist/machinery-backend/machinery-backend.exe, checks health, cuda, one prediction, a 1-epoch worker run
backend/app/health.py                 (+) gpu block: {"available", "name"} computed lazily on first call (spec 10 smoke)
backend/app/jobs/startup.py           orphan sweep: jobs left running/queued from a previous process -> failed/cancelled at startup
backend/app/main.py                   calls the sweep in lifespan after the registry opens recent projects lazily (sweep per project on open)
frontend/src-tauri/tauri.conf.json    csp, version, resources, nsis options (per-user install, license absent, shortcut)
frontend/src-tauri/src/sidecar.rs     backend log file under app data (stdout/stderr tee) so the failure dialog can show a path
frontend/src/api/client.tsx           failure dialog shows the log path from `backend_info`
scripts/acceptance.md                 the 8 steps with expected results and evidence names
frontend/scripts/acceptance.mjs       CDP driver for the installed app (steps 1-8), writes docs/evidence/acceptance/
README.md                             build, install, dev, tests, troubleshooting
```

---

### Task 1: Full PyInstaller spec and frozen smoke script

**Interfaces:** `backend/scripts/smoke_frozen.ps1` prints `health ok`, `cuda True <gpu name>`, `predict ok <n> boxes`, `worker ok` and exits non-zero on any failure.

- [ ] Replace the S0 excludes in `machinery_backend.spec` with: `hiddenimports=collect_submodules("app") + collect_submodules("ultralytics") + ["torch", "torchvision", "cv2", "onnx", "onnxslim", "onnxruntime", "anthropic", "openai", "keyring.backends.Windows", "win32ctypes.pywin32", "pywin32_system32", "alembic", "sqlalchemy.dialects.sqlite", "uvicorn.logging", "uvicorn.loops.auto", "uvicorn.protocols.http.auto", "uvicorn.protocols.websockets.auto", "uvicorn.lifespan.on", "websockets", "anyio._backends._asyncio"]`, `datas=[("app/db/migrations", "app/db/migrations")] + collect_data_files("ultralytics") + collect_data_files("torch", include_py_files=False)`, `binaries=collect_dynamic_libs("torch") + collect_dynamic_libs("torchvision") + collect_dynamic_libs("onnxruntime")`. Use `collect_all("ultralytics")` if plain collection misses `cfg/*.yaml`. Set `console=False` for the exe (the launcher captures stdout/stderr through the shell plugin regardless) only after confirming the stdout JSON line still reaches Tauri (`CommandEvent::Stdout`); keep `console=True` otherwise and document why.
- [ ] Add `backend/app/health.py` `gpu` field (`{"available": bool, "name": str | null}`) computed on first request in a thread with a 10 s timeout so health stays fast; contract: add the optional `gpu` object to `Health` (goal owner edits the contract; ask before you change it).
- [ ] Write `smoke_frozen.ps1`: run the exe with `APP_TOKEN`, `APP_PORT=0`, parse the port from the JSON line, poll health until 200 (fail after 20 s), check `gpu.available`, create a temp project, import 3 sample frames, import `E:\Dev\Yolo\models\yolo11n.pt`, call preannotate on one image (`imgsz 640`), train 1 epoch on a hand-made dataset (reuse the checkpoint script logic) to prove the frozen `worker` path with DataLoader workers, export ONNX, then stop the process by PID. Record timings.
- [ ] Run `build.ps1` then `smoke_frozen.ps1` on the reference machine; paste the output in the report; record the `dist/machinery-backend` size in MB.
- [ ] Commit `build: full pyinstaller bundle with cuda torch; frozen smoke script`.

---

### Task 2: Hardening items that affect packaged behaviour

- [ ] Orphan sweep (`app/jobs/startup.py`): when a project is opened, any `Job` row in `queued` or `running` from a previous process (no live context in the runner) is marked `failed` with error "interrupted by application restart" (queued -> `cancelled`); test with a project DB prepared by hand.
- [ ] Pre-seed `Arial.ttf` for Ultralytics plots: copy the font Ultralytics expects into the user config dir on first run (or set `YOLO_CONFIG_DIR` under app data and ship the font in the bundle); no network on first training; test by asserting the file exists after the worker's setup step.
- [ ] Backend log file: `sidecar.rs` tees the sidecar's stdout/stderr lines to `<app_data>/logs/sidecar.log` (rotating at 5 MB) in addition to the console; `backend_info` returns `log_path`; the failure dialog (`client.tsx`) shows it (spec 11).
- [ ] `tauri.conf.json`: `app.security.csp` = `default-src 'self'; img-src 'self' http://127.0.0.1:* data: blob:; connect-src 'self' http://127.0.0.1:* ws://127.0.0.1:*; style-src 'self' 'unsafe-inline'`; `bundle.windows.nsis` `installMode: "currentUser"`; `version` 0.1.0; verify `pnpm tauri dev` still boots with the CSP (Konva uses canvas; check no CSP violations in the webview console).
- [ ] Commit `chore: packaging hardening (orphan sweep, font pre-seed, sidecar log, csp)`.

---

### Task 3: Installer build and install on the reference machine

- [ ] `pnpm tauri build` (NSIS). Record installer size (must be < 6 GB) and build time. If the `_internal` resource mapping does not land next to the sidecar exe in the install dir, adjust `bundle.resources` (Tauri puts resources under the install root on Windows; `_internal/` must sit beside `machinery-backend-x86_64-pc-windows-msvc.exe`).
- [ ] Install with the generated setup exe (silent `/S` is fine), launch from the Start Menu shortcut with a stopwatch script (`Get-Process` start time to first `GET /api/v1/health 200` in `sidecar.log`, and to the Projects heading via CDP): record cold start (< 15 s) and warm start.
- [ ] Verify the installed app: sidecar spawns (process list), health passes, project creation works, closing terminates the sidecar, uninstall removes the install dir (app data stays).
- [ ] Commit `docs: installer build and install evidence` with the numbers in `docs/progress.md` (goal owner records checkpoint 4).

---

### Task 4: Acceptance script and driver

- [ ] `scripts/acceptance.md`: the eight steps of spec 13.5 with exact UI actions, expected results (3299 images, 0 duplicates, 7 flights `0031, 0033, 0034, 0035, 0038, 0040, 0042`; yolo11m proposals on at least one of 10 images; 30 labeled images; dataset `v1` by_group with train/val folders and a valid `data.yaml`; YOLO11n 3 epochs with progress events and a registered model with metrics; run the trained model over 50 unlabeled images, review, promote; Anthropic query "dump trucks" over 5 images with tiling, boxes with provider provenance; ONNX export under `models/`), and the evidence file name for each.
- [ ] `frontend/scripts/acceptance.mjs`: CDP driver that performs steps 1-8 against the installed app, mixing UI actions (project creation, import via the Import images dialog, labeling 30 images by drawing one box each, dataset creation, training start, query run) with API reads through `backend_info` for assertions; screenshots per step into `docs/evidence/acceptance/`; the Anthropic step requires `ANTHROPIC_API_KEY` in the environment: the driver sets it through the providers key endpoint at runtime and never writes it anywhere; it skips the step with a clear message when the variable is absent. The import of 3299 frames takes a while: poll progress and allow up to 60 minutes.
- [ ] Run it once end to end on the installed app; fix what breaks (in the owning sub-project's files, with tests, or report if it is a contract change); paste the summary in the report.
- [ ] Commit `test: acceptance script and driver`.

---

### Task 5: README and final verification

- [ ] README: build, install, dev against mock and real backend, tests (backend incl. gpu and live markers, contract, frontend unit and e2e, checkpoint and acceptance drivers), troubleshooting (sidecar log path, ports, GPU not detected, re-running the installer), and the environment facts (reference machine, pins).
- [ ] Run on `main`: `pytest -q`, `pytest -m gpu -q`, `ruff`, `pnpm --dir contract check`, `pnpm lint/test/build/e2e`; paste the results.
- [ ] Commit `docs: readme for build, install, run and tests`.

## Self-review checklist

- Spec 10 (PyInstaller with hidden imports, CUDA DLLs, smoke test; NSIS with WebView2 bootstrapper; settings and env overrides; security), 11 (sidecar death dialog with log path), 13.4 checkpoint 4, 13.5 acceptance, success criteria (installer size, cold start) are each mapped to a task.
- Every step names the command and the expected output; timings and sizes are recorded, not estimated.
