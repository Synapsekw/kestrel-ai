# Machinery Detection (working name `machinery-app`)

Windows desktop app for aerial construction-machinery detection: dataset preparation,
bounding-box annotation, YOLO training with a model registry, and inference with local
models or OpenAI / Anthropic vision models.

- Design and PRD: `docs/superpowers/specs/2026-09-17-machinery-detection-app-design.md`
- Progress, decisions and resume instructions: `docs/progress.md`
- API contract (source of truth): `contract/openapi.yaml`

## Layout

| Part | What | Tooling |
|---|---|---|
| `backend/` | FastAPI sidecar: projects, datasets, annotation storage, jobs, training, inference | Python 3.11.15 in `backend/.venv` (uv), pytest, ruff, PyInstaller |
| `frontend/` | Tauri 2 shell with the React/TypeScript/Vite UI | pnpm, Vitest, Playwright, Rust stable MSVC |
| `contract/` | `openapi.yaml`, generated TypeScript client, Prism mock server, Spectral lint | pnpm |

## Prerequisites (reference machine)

- Windows 11, NVIDIA GPU with driver 591.86 or newer (CUDA 13 runtime is bundled by the torch wheels).
- Node 24 and pnpm 10.
- uv 0.11 or newer (it fetches CPython 3.11.15 on demand).
- Rust stable for `x86_64-pc-windows-msvc` (`winget install Rustlang.Rustup`) and the MSVC C++
  build tools with a Windows 10 SDK. WebView2 runtime (present on Windows 11).

Nothing is installed system-wide except Rust. Ports 8080 and 9090 are left alone; the app uses
8765 (dev backend), 4010 (mock), 1420 (Vite) and a random free port when packaged.

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

`backend/requirements.txt` pins the ML stack to the reference machine (torch 2.14.0+cu130,
ultralytics 8.4.154, ...); `requirements-lock.txt` freezes everything else.

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

The desktop shell in development (spawns the sidecar built below, or targets `APP_BACKEND_URL`
when that variable is set in the environment):

```powershell
cd frontend
pnpm tauri dev
```

## Build

1. Freeze the backend and copy it into the Tauri sidecar slot:

   ```powershell
   cd backend
   .\scripts\build.ps1     # PyInstaller one-folder -> frontend/src-tauri/binaries/
   ```

2. Build the installer:

   ```powershell
   cd frontend
   pnpm tauri build        # NSIS installer under frontend/src-tauri/target/release/bundle/nsis/
   ```

## Run the tests

```powershell
cd backend;  .\.venv\Scripts\python -m pytest -q; .\.venv\Scripts\ruff check .
cd contract; pnpm check                    # lint + regenerate client, fails on a stale client
cd frontend; pnpm lint; pnpm test; pnpm build; pnpm e2e   # e2e starts the mock server itself
```

Backend markers: `-m gpu` runs the GPU training test, `-m live` runs cloud-provider tests
(they read API keys from environment variables and skip when absent). Both are excluded by default.
`tests/test_contract.py` validates every response against `contract/openapi.yaml` with
schemathesis.

## Changing the API

Only the goal owner edits `contract/openapi.yaml`. After a change: `cd contract; pnpm check`
(regenerates `client/schema.d.ts`), then run the backend contract tests.
