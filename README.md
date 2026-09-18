# Machinery Detection (working name `machinery-app`)

Windows desktop app for aerial construction-machinery detection: dataset preparation,
bounding-box annotation, YOLO training with a model registry, and inference with local
models or OpenAI / Anthropic vision models.

- Design and PRD: `docs/superpowers/specs/2026-09-17-machinery-detection-app-design.md`
- Progress, decisions and resume instructions: `docs/progress.md`
- API contract (source of truth): `contract/openapi.yaml`
- Acceptance run (spec 13.5): `scripts/acceptance.md`

## Layout

| Part | What | Tooling |
|---|---|---|
| `backend/` | FastAPI sidecar: projects, datasets, annotation storage, jobs, training, inference | Python 3.11.15 in `backend/.venv` (uv), pytest, ruff, PyInstaller |
| `frontend/` | Tauri 2 shell with the React/TypeScript/Vite UI | pnpm, Vitest, Playwright, Rust stable MSVC |
| `contract/` | `openapi.yaml`, generated TypeScript client, Prism mock server, Spectral lint | pnpm |

## Prerequisites (reference machine)

- Windows 11, NVIDIA GPU with driver 591.86 or newer (CUDA 13 runtime is bundled by the torch wheels).
  The build and the numbers below were measured on an RTX 5070 Ti.
- Node 24 and pnpm 10.
- uv 0.11 or newer (it fetches CPython 3.11.15 on demand).
- Rust stable for `x86_64-pc-windows-msvc` (`winget install Rustlang.Rustup`) and the MSVC C++
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

1. Freeze the backend and copy it into the Tauri sidecar slot:

   ```powershell
   cd backend
   .\scripts\build.ps1     # PyInstaller one-folder -> frontend/src-tauri/binaries/
   ```

   On the reference machine: about 2 minutes, `dist/machinery-backend` is 3.4 GB in ~14,100 files.
   The bundle carries CUDA torch, torchvision, Ultralytics, OpenCV and the ONNX stack, because the
   same exe is also the training and export worker (`machinery-backend.exe worker train <params>`).

2. Prove the frozen build before wrapping it in an installer:

   ```powershell
   powershell -ExecutionPolicy Bypass -File backend\scripts\smoke_frozen.ps1
   ```

   It starts the exe the way the sidecar does, then checks health, `torch.cuda.is_available()`,
   an import, one YOLO prediction, a 1-epoch training run through the frozen `worker` subcommand
   (DataLoader workers, so `multiprocessing.freeze_support()` is exercised), the Ultralytics font
   pre-seed, an ONNX export and a keyring round trip through Windows Credential Manager. It prints
   `health ok`, `cuda True <gpu name>`, `predict ok <n> boxes`, `worker ok` and exits non-zero on
   any failure. About 25 seconds.

3. Build the installer:

   ```powershell
   cd frontend
   pnpm tauri build        # bundle under frontend/src-tauri/target/release/bundle/
   ```

   The app binary builds in about a minute; the install tree it would write is 3.47 GB, inside the
   6 GB success criterion.

   **Known limit - no installer yet.** Neither Tauri bundler can package a 3.4 GB sidecar. NSIS
   addresses its payload with 32-bit offsets, so `makensis` dies at 2 GB
   (`Internal compiler error #12345: error mmapping file (2057025505, 33554432) is out of range`),
   and `--bundles msi` puts everything in one embedded cabinet, which the cabinet format caps at
   the same 2 GB (`light.exe : error LGHT0001 : Catastrophic failure ... CreateCabFinish`). The
   measurements, why trimming the CUDA payload does not help, and the options are in
   `docs/progress.md` under "S6 packaging evidence"; the format is the goal owner's decision.

## Install and run the packaged app

- Run the generated installer (`/S` for a silent NSIS install, `msiexec /i "<file>.msi" /qn` for
  an MSI). The install is per user: no administrator rights, no shared install directory.
- The WebView2 runtime is fetched by the bootstrapper if the machine does not already have it.
- The app installs next to the sidecar: `machinery-backend-x86_64-pc-windows-msvc.exe` with its
  `_internal/` folder beside it. Both must stay together.
- Per-user data lives in `%APPDATA%\ai.synapse-solutions.machinery-app`: `logs/`,
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

Cloud-provider steps read `ANTHROPIC_API_KEY` from the environment, store it through the providers
key endpoint for the duration of the run, delete it afterwards and skip with a clear message when
the variable is absent. No key is ever written to a file, a fixture or a log.

## Troubleshooting

- **The app opens with "The backend is not responding".** The dialog names the sidecar log,
  `%APPDATA%\ai.synapse-solutions.machinery-app\logs\sidecar.log` (rolled over once at 5 MB); the
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
- **Re-running the installer** upgrades in place and keeps app data and project folders. Uninstall
  first only if the install directory itself is damaged.
- **The first `pnpm tauri build` downloads** NSIS or the WiX toolset and the WebView2 bootstrapper
  into the Tauri cache under `%LOCALAPPDATA%\tauri`; that needs network access once.
- **Training cannot reach the network.** It must not need to: the AMP probe is skipped
  (`app/training/worker.py`), Ultralytics auto-install is off and the plot font is seeded from the
  machine's own fonts (`app/training/fonts.py`).

## Changing the API

Only the goal owner edits `contract/openapi.yaml`. After a change: `cd contract; pnpm check`
(regenerates `client/schema.d.ts`), then run the backend contract tests.
