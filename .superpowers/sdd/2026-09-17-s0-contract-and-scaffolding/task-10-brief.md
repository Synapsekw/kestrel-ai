### Task 10: Dev script and CI

**Files:**
- Create: `scripts/dev.ps1`, `.github/workflows/ci.yml`

**Interfaces:**
- Produces: `scripts/dev.ps1 -Mode mock|backend` starts the mock server or the real backend on 8765 with a generated token and then Vite with `APP_BACKEND_URL` and `APP_BACKEND_TOKEN` set.

- [ ] **Step 1: `scripts/dev.ps1`**

```powershell
param([ValidateSet("mock", "backend")] [string] $Mode = "mock")
$root = Split-Path $PSScriptRoot -Parent
if ($Mode -eq "mock") {
  Start-Process powershell -ArgumentList "-NoExit", "-Command", "cd '$root\contract'; pnpm mock"
  Set-Location "$root\frontend"
  pnpm dev
} else {
  $token = -join ((48..57 + 65..90 + 97..122) | Get-Random -Count 32 | ForEach-Object { [char]$_ })
  Start-Process powershell -ArgumentList "-NoExit", "-Command", "cd '$root\backend'; `$env:APP_TOKEN='$token'; `$env:APP_PORT='8765'; .\.venv\Scripts\python -m app"
  $env:APP_BACKEND_URL = "http://127.0.0.1:8765"
  $env:APP_BACKEND_TOKEN = $token
  Set-Location "$root\frontend"
  pnpm dev
}
```

- [ ] **Step 2: `.github/workflows/ci.yml`**

Jobs on `windows-latest`: `contract` (pnpm install in `contract/`, `pnpm check`), `backend` (uv with Python 3.11.15, install `requirements-dev.txt` with the CPU torch index override `--index-url https://download.pytorch.org/whl/cpu` for the runner and `torch==2.14.0` without the local version tag, `ruff check`, `pytest`), `frontend` (pnpm install, `pnpm lint`, `pnpm test`, `pnpm build`, Playwright with chromium, `pnpm e2e`). A fourth job `sidecar-smoke` builds the PyInstaller folder and curls health; it runs on `workflow_dispatch` only because it takes long. GPU tests (`-m gpu`) do not run in CI.

- [ ] **Step 3: Commit**

```bash
git add scripts .github && git commit -m "chore: dev script and ci workflow"
```

---

