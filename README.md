# Kestrel AI (working name `kestrel-ai`)

Windows desktop app for aerial construction-machinery detection: dataset preparation,
bounding-box annotation, YOLO training with a model registry, and inference with local
models or OpenAI / Anthropic vision models.

Use **Setup agent** in the header to describe a new detector to GPT or Claude using the provider
already configured in App settings. Review its project name, classes and YOLO starter, choose local
project and image folders, then select up to 24 images for a first cloud labeling run. The drawer
shows a cost estimate before starting and takes you to Review when suggestions are ready. Drafts
stay while the app is open; imports, model downloads and labeling continue as background jobs.

**Models → Starter models** offers 44 compatible box-detection checkpoints across YOLO26, YOLO12,
YOLO11, YOLOv10, YOLOv9, YOLOv8, YOLOv5u and YOLOv3u. Choose the family and size; only the selected
weights download, and cached or bundled weights work offline. These are starting weights for
training on your classes. Segmentation, pose, classification and rotated-box training are separate
tasks and are not offered by this detection workflow.

- Design and PRD: `docs/superpowers/specs/2026-09-17-kestrel-ai-app-design.md`
- Progress, decisions and resume instructions: `docs/progress.md`
- API contract (source of truth): `contract/openapi.yaml`
- Acceptance run (spec 13.5): `scripts/acceptance.md`

## Layout

| Part | What | Tooling |
|---|---|---|
| `backend/` | FastAPI sidecar: projects, datasets, annotation storage, jobs, training, inference | Python 3.11.15 in `backend/.venv` (uv), pytest, ruff, PyInstaller |
| `backend/starter_weights/` | The bundled base models (`yolo11n/s/m.pt`, COCO); git-ignored, filled by `scripts/fetch_starter_weights.ps1` | - |
| `frontend/` | Tauri 2 shell with the React/TypeScript/Vite UI | pnpm, Vitest, Playwright, Rust stable MSVC |
| `contract/` | `openapi.yaml`, generated TypeScript client, Prism mock server, Spectral lint | pnpm |
| `vault/` | Tracked Obsidian dev-memory vault: project state, decisions, session notes | Obsidian (optional) |

New to this repo? `AGENTS.md` carries the working agreement, `CONTRIBUTING.md` the contributor
detail, and `vault/00-north-star.md` is the project's own entry point — read it first, on any
machine. `scripts/start-task.ps1` / `scripts/finish-task.ps1` cut and land task worktrees; see
`CONTRIBUTING.md` → "Branching workflow".

## Prerequisites (reference machine)

- Windows 11, NVIDIA GPU with driver 591.86 or newer (CUDA 13 runtime is bundled by the torch wheels).
  The build and the numbers below were measured on an RTX 5070 Ti.
- Node 24 and pnpm 10.
- uv 0.11 or newer (it fetches CPython 3.11.15 on demand).
- Rust stable for `x86_64-pc-windows-msvc` (`winget install Rustlang.Rustup`; `%USERPROFILE%\.cargo\bin` must be on the `PATH` of the shell that runs `pnpm tauri ...` or `pnpm build:installer`, which is the case in a new shell after rustup) and the MSVC C++
  build tools with a Windows 10 SDK. WebView2 runtime (present on Windows 11).
- About 20 GB free for the frozen backend, the bundle and the installer.

Nothing is installed system-wide except Rust. Ports 8080 and 9090 are left alone; the app uses
8765 (dev backend), 4010 (mock), 1420 (Vite), 9222 (WebView2 debugging for the drivers) and a
random free port when packaged.

Pins that matter: torch 2.14.0+cu130, torchvision 0.29.0+cu130, ultralytics 8.4.154, PyInstaller 6,
Tauri 2. `backend/requirements.txt` holds the ML stack, `requirements-lock.txt` everything else.

## Set up once

```powershell
cd backend
uv venv --python 3.11.15 .venv
uv pip install --python .venv\Scripts\python.exe -r requirements-dev.txt   # ~4 GB with CUDA torch

cd ..\contract
pnpm install

cd ..\frontend
pnpm install
pnpm exec playwright install chromium
```

## Run in development

Against the mock server (UI work, no Python needed):

```powershell
.\scripts\dev.ps1 -Mode mock      # Prism on 127.0.0.1:4010 + Vite on 127.0.0.1:1420
```

Against the real backend:

```powershell
.\scripts\dev.ps1 -Mode backend   # backend on 127.0.0.1:8765 with a generated token + Vite
```

The script exports `APP_BACKEND_URL` and `APP_BACKEND_TOKEN` for Vite; without them the UI falls
back to the mock server. To run the backend by hand:

```powershell
cd backend
$env:APP_TOKEN = "dev"; $env:APP_PORT = "8765"; .\.venv\Scripts\python -m app
```

`APP_PORT=0` picks a free port and prints `{"event": "starting", "port": ..., "pid": ...}` on
stdout, which is how the Tauri launcher learns the port. Every request needs
`Authorization: Bearer <token>` or `?token=<token>`.

The desktop shell in development:

```powershell
cd frontend
pnpm tauri dev
```

It spawns the frozen sidecar from `src-tauri/binaries/` (build it first, below). Set
`APP_BACKEND_URL` and `APP_BACKEND_TOKEN` in the environment instead and the shell attaches to a
backend you started yourself rather than spawning one - that is the mode the checkpoint and
acceptance drivers use.

## Build

0. Fetch the starter weights (once per checkout; the three files are git-ignored and `build.ps1`
   refuses to run without them):

   ```powershell
   powershell -ExecutionPolicy Bypass -File backend\scripts\fetch_starter_weights.ps1
   ```

   For each of the three sizes: copies it from `E:\Dev\Yolo\models\` when it exists there,
   downloads it from the Ultralytics GitHub release otherwise, and skips a file already in
   `backend/starter_weights/` that is over 1 MB. Whatever the source, every file's SHA-256 is
   checked against a pinned value; a mismatch deletes the file and fails the script.

1. Freeze the backend and copy it into the Tauri sidecar slot:

   ```powershell
   cd backend
   .\scripts\build.ps1     # PyInstaller one-folder -> frontend/src-tauri/binaries/
   ```

   From a git worktree (which has no `backend\.venv` and must not link to the shared one) pass the
   environment explicitly: `.\scripts\build.ps1 -Venv E:\Dev\Yolo\app\backend\.venv`. The worktree
   also needs its own `backend\starter_weights` (step 0 fetches them).

   On the reference machine: about 2 minutes, `dist/kestrel-backend` is 3.4 GB in ~14,100 files.
   The bundle carries CUDA torch, torchvision, Ultralytics, OpenCV and the ONNX stack, because the
   same exe is also the training and export worker (`kestrel-backend.exe worker train <params>`).

2. Prove the frozen build before wrapping it in an installer:

   ```powershell
   powershell -ExecutionPolicy Bypass -File backend\scripts\smoke_frozen.ps1
   ```

   It starts the exe the way the sidecar does, then checks health, `torch.cuda.is_available()`,
   the three bundled starter weights, an import, one YOLO prediction, a 1-epoch training run
   through the frozen `worker` subcommand (DataLoader workers, so
   `multiprocessing.freeze_support()` is exercised), the Ultralytics font pre-seed, an ONNX export
   and a keyring round trip through Windows Credential Manager. It prints `health ok`,
   `cuda True <gpu name>`, `starter ok 3`, `predict ok <n> boxes`, `worker ok` and exits non-zero
   on any failure. About 25 seconds.

3. Build the installer:

   ```powershell
   cd frontend
   pnpm build:installer    # -> src-tauri/target/release/bundle/inno/Kestrel AI_<version>_x64-setup.exe
   ```

   `frontend/scripts/build-installer.ps1` runs `pnpm tauri build --no-bundle` and then compiles
   `frontend/installer/kestrel-ai.iss` with the Inno Setup 6 compiler that ships inside
   `node_modules/innosetup-compiler` - nothing is installed system-wide, and the version comes from
   `tauri.conf.json`. Pass `-SkipTauriBuild` to repackage the release binary that is already built.

   The installer packs the frozen backend from `frontend/src-tauri/binaries/`, not from the Tauri
   output, and only checks that it is there: re-run step 1 whenever the backend changed, or the
   installer ships the previous freeze.

   Inno Setup rather than Tauri's own bundlers because both of those cap their payload at 2 GB and
   this one is 3.4 GB: NSIS addresses its data with 32-bit offsets
   (`Internal compiler error #12345: error mmapping file ... is out of range`) and the WiX template
   puts everything in one embedded cabinet
   (`light.exe : error LGHT0001 : Catastrophic failure ... CreateCabFinish`). `bundle.targets` in
   `tauri.conf.json` is therefore empty; the rest of the `bundle` block still drives the exe icon
   and the sidecar and resource staging that `pnpm tauri dev` needs. Measurements are in
   `docs/progress.md` under "S6 packaging evidence".

## Install and run the packaged app

- Run the generated setup exe (`/VERYSILENT /SUPPRESSMSGBOXES` for an unattended install). The
  install is per user into `%LOCALAPPDATA%\Programs\Kestrel AI`: no administrator rights,
  no shared install directory.
- WebView2: the installer runs Microsoft's bootstrapper only when the runtime is missing, and only
  when a copy of `MicrosoftEdgeWebview2Setup.exe` was present at build time (see troubleshooting).
  Windows 11 ships the runtime.
- The app installs next to the sidecar: `kestrel-ai.exe`, `kestrel-backend.exe` and the
  sidecar's `_internal/` folder, all in the install directory. The names matter: the shell plugin
  resolves a sidecar as `<folder of the running exe>\kestrel-backend.exe`, and the frozen
  backend loads `_internal/` from beside its own exe. The target triple
  (`kestrel-backend-x86_64-pc-windows-msvc.exe`) is only how the file is named in the build
  slot, `frontend/src-tauri/binaries/`; the installer renames it on the way in. Do not rename or
  separate them.
- Per-user data lives in `%APPDATA%\ai.synapse-solutions.kestrel-ai`: `logs/`,
  `recent_projects.json`, `settings.json` and `ultralytics/` (the pre-seeded plot font). Uninstall
  removes the program directory and leaves that data alone.
- Project data (images, labels, datasets, runs, models, `project.db`) lives in the project folder
  the operator chooses, never under the install directory.

## Run the tests

```powershell
cd backend;  .\.venv\Scripts\python -m pytest -q; .\.venv\Scripts\python -m ruff check .
cd contract; pnpm check                    # lint + regenerate client, fails on a stale client
cd frontend; pnpm lint; pnpm test; pnpm build; pnpm e2e   # e2e starts the mock server itself
cd frontend\src-tauri; cargo test --lib    # the sidecar log file
```

Backend markers: `-m gpu` runs the GPU training and inference tests, `-m live` runs cloud-provider
tests (they read API keys from environment variables and skip when absent). Both are excluded by
default. `tests/test_contract.py` validates every response against `contract/openapi.yaml` with
schemathesis.

### Drivers against the real app

The integration checkpoints and the acceptance run drive the real webview over CDP. Start the app
with the debugging port open, then run the driver in another shell:

```powershell
$env:WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS = "--remote-debugging-port=9222"
# ... start `pnpm tauri dev` (dev) or the installed app (acceptance)
node frontend\scripts\checkpoint3.mjs <projectFolder> <sampleFolder> <evidenceDir> <weightsPath>
node frontend\scripts\acceptance.mjs --project-folder <folder> --evidence docs\evidence\acceptance
```

`scripts/acceptance.md` is the eight-step acceptance run in prose, with the expected values and
the evidence file names; `acceptance.mjs` takes every expected value as a flag, so it can be
dry-run against a small copy of the frames before the real run.

`frontend/scripts/usability_walkthrough.mjs` replays the new-user flow (project, import, starter
model, labeling, dataset, training, detection run, review, accept and undo, ONNX export) and checks
the usability fixes of `docs/usability/2026-09-19-walkthrough.md`, one screenshot per step:

```powershell
node frontend\scripts\usability_walkthrough.mjs --project-folder <new folder> --frames <copy of sample frames> --evidence docs\evidence\usability\<run>
```

`--project-id <id> --from-step <n>` resumes on an existing project. To drive a second instance while
the installed app is open, give it its own WebView2 profile: set `WEBVIEW2_USER_DATA_FOLDER` to a
scratch folder next to the debugging-port variable.

Cloud-provider steps read `ANTHROPIC_API_KEY` from the environment, store it through the providers
key endpoint for the duration of the run, delete it afterwards and skip with a clear message when
the variable is absent. No key is ever written to a file, a fixture or a log.

## Troubleshooting

- **The app opens with "The backend is not responding".** The dialog names the sidecar log,
  `%APPDATA%\ai.synapse-solutions.kestrel-ai\logs\sidecar.log` (rolled over once at 5 MB); the
  backend's own log with timestamps is `backend.log` next to it. **Restart** in the dialog respawns
  the sidecar without restarting the app.
- **`torch.cuda.is_available()` is false / the GPU is not detected.** `GET /api/v1/health` reports
  `gpu: {available, name}`; the field is absent for the first few seconds because the probe runs in
  the background. False on a machine with an NVIDIA GPU means the driver is older than the bundled
  CUDA 13 runtime needs - update the driver, then re-run `smoke_frozen.ps1`.
- **A port is busy.** The packaged app picks a free port per launch, so only the dev setup has
  fixed ports: 8765 (backend), 1420 (Vite), 4010 (mock), 9222 (WebView2 debugging).
- **Jobs stuck in "running" after a crash.** Opening the project marks them `failed` with
  "interrupted by application restart" (queued ones become `cancelled`); start the work again.
- **"The starter model ... is not included in this copy of the app" when adding a base model.** The checkout has
  not fetched them: run `backend\scripts\fetch_starter_weights.ps1` (dev) or rebuild the installer
  after that script has populated `backend/starter_weights/` (packaged app).
- **Re-running the installer** upgrades in place and keeps app data and project folders. Uninstall
  removes `%LOCALAPPDATA%\Programs\Kestrel AI` and leaves app data and projects alone.
- **"The WebView2 runtime is missing" on a fresh machine.** The installer only carries Microsoft's
  bootstrapper when `frontend/installer/MicrosoftEdgeWebview2Setup.exe` exists at build time; the
  redistributable is never committed. Drop a copy there (or leave one in the Tauri bundler cache,
  which the build script picks up) and rebuild, or install the Evergreen runtime on the target
  machine first. Windows 11 already has it, so the reference machine does not need it.
- **Training cannot reach the network.** It must not need to: the AMP probe is skipped
  (`app/training/worker.py`), Ultralytics auto-install is off and the plot font is seeded from the
  machine's own fonts (`app/training/fonts.py`).

## Changing the API

Only the goal owner edits `contract/openapi.yaml`. After a change: `cd contract; pnpm check`
(regenerates `client/schema.d.ts`), then run the backend contract tests.

## License

MIT — see `LICENSE`.
