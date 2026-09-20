### Task 9: Rust toolchain and Tauri shell with sidecar boot

**Files:**
- Create: `frontend/src-tauri/Cargo.toml`, `frontend/src-tauri/build.rs`, `frontend/src-tauri/tauri.conf.json`, `frontend/src-tauri/capabilities/default.json`, `frontend/src-tauri/src/main.rs`, `frontend/src-tauri/src/lib.rs`, `frontend/src-tauri/src/sidecar.rs`, `frontend/src-tauri/icons/*` (generated with `pnpm tauri icon` from a placeholder 1024 px PNG), `frontend/src-tauri/binaries/.gitkeep`, `backend/machinery_backend.spec`, `backend/scripts/build.ps1`

**Interfaces:**
- Produces: Tauri commands `backend_info() -> {base_url, token}` and `restart_backend()`; sidecar named `machinery-backend` (binary at `src-tauri/binaries/machinery-backend-x86_64-pc-windows-msvc.exe` plus its `_internal` folder as a resource); when `APP_BACKEND_URL` is set in the process environment at launch, the sidecar is not spawned and `backend_info` returns that URL with `APP_BACKEND_TOKEN`.

- [ ] **Step 1: Install Rust (the single allowed system install) and record it**

```powershell
winget install --id Rustlang.Rustup -e --accept-package-agreements --accept-source-agreements
rustup default stable-x86_64-pc-windows-msvc
rustc --version; cargo --version
```

Then add a line to `docs/progress.md` under "System installs": the rustup version, the toolchain, and the date.

- [ ] **Step 2: Scaffold Tauri**

```powershell
cd E:\Dev\Yolo\app\frontend
pnpm tauri init --app-name "Machinery Detection" --window-title "Machinery Detection" --frontend-dist ../dist --dev-url http://127.0.0.1:1420 --before-dev-command "pnpm dev" --before-build-command "pnpm build"
```

`tauri.conf.json` additions:

```json
{
  "identifier": "ai.synapse-solutions.machinery-app",
  "productName": "Machinery Detection",
  "bundle": {
    "active": true,
    "targets": ["nsis"],
    "externalBin": ["binaries/machinery-backend"],
    "resources": { "binaries/_internal/": "_internal/" },
    "windows": { "webviewInstallMode": { "type": "downloadBootstrapper" } }
  },
  "app": {
    "windows": [{ "title": "Machinery Detection", "width": 1400, "height": 900, "minWidth": 1024, "minHeight": 700 }]
  }
}
```

`Cargo.toml` dependencies: `tauri = { version = "2", features = [] }`, `tauri-plugin-shell = "2"`, `tauri-plugin-dialog = "2"`, `serde = { version = "1", features = ["derive"] }`, `serde_json = "1"`, `rand = "0.8"`. Library name `machinery_app_lib` (`[lib] name = "machinery_app_lib"`, `crate-type = ["staticlib", "cdylib", "rlib"]`). `capabilities/default.json` grants `core:default`, `shell:allow-execute` and `shell:allow-spawn` restricted to the `machinery-backend` sidecar, `shell:allow-kill`, `dialog:allow-open`, `dialog:allow-save`.

- [ ] **Step 3: Implement `src/sidecar.rs`**

```rust
use std::net::TcpListener;
use std::sync::Mutex;
use tauri::{AppHandle, Manager};
use tauri_plugin_shell::process::{CommandChild, CommandEvent};
use tauri_plugin_shell::ShellExt;

pub struct Backend {
    pub base_url: String,
    pub token: String,
    pub child: Option<CommandChild>,
}
pub struct BackendState(pub Mutex<Option<Backend>>);

fn free_port() -> u16 {
    TcpListener::bind("127.0.0.1:0").unwrap().local_addr().unwrap().port()
}

fn random_token() -> String {
    use rand::{distributions::Alphanumeric, Rng};
    rand::thread_rng().sample_iter(&Alphanumeric).take(48).map(char::from).collect()
}

pub fn start(app: &AppHandle) -> Result<Backend, String> {
    if let Ok(url) = std::env::var("APP_BACKEND_URL") {
        return Ok(Backend { base_url: url, token: std::env::var("APP_BACKEND_TOKEN").unwrap_or_default(), child: None });
    }
    let port = free_port();
    let token = random_token();
    let data_dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    let (mut rx, child) = app
        .shell()
        .sidecar("machinery-backend")
        .map_err(|e| e.to_string())?
        .env("APP_PORT", port.to_string())
        .env("APP_TOKEN", &token)
        .env("APP_DATA_DIR", data_dir.to_string_lossy().to_string())
        .spawn()
        .map_err(|e| e.to_string())?;
    tauri::async_runtime::spawn(async move {
        while let Some(ev) = rx.recv().await {
            match ev {
                CommandEvent::Stdout(l) | CommandEvent::Stderr(l) => eprintln!("[backend] {}", String::from_utf8_lossy(&l)),
                CommandEvent::Terminated(t) => {
                    eprintln!("[backend] terminated {:?}", t);
                    break;
                }
                _ => {}
            }
        }
    });
    Ok(Backend { base_url: format!("http://127.0.0.1:{port}"), token, child: Some(child) })
}

pub fn stop(state: &BackendState) {
    if let Some(b) = state.0.lock().unwrap().take() {
        if let Some(c) = b.child {
            let _ = c.kill();
        }
    }
}
```

`src/lib.rs`:

```rust
mod sidecar;
use tauri::Manager;

#[tauri::command]
fn backend_info(state: tauri::State<sidecar::BackendState>) -> Result<serde_json::Value, String> {
    let g = state.0.lock().unwrap();
    let b = g.as_ref().ok_or("backend not started")?;
    Ok(serde_json::json!({ "base_url": b.base_url, "token": b.token }))
}

#[tauri::command]
fn restart_backend(app: tauri::AppHandle, state: tauri::State<sidecar::BackendState>) -> Result<(), String> {
    sidecar::stop(&state);
    let b = sidecar::start(&app)?;
    *state.0.lock().unwrap() = Some(b);
    Ok(())
}

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_dialog::init())
        .manage(sidecar::BackendState(std::sync::Mutex::new(None)))
        .setup(|app| {
            let b = sidecar::start(app.handle())?;
            *app.state::<sidecar::BackendState>().0.lock().unwrap() = Some(b);
            Ok(())
        })
        .on_window_event(|w, e| {
            if let tauri::WindowEvent::Destroyed = e {
                sidecar::stop(&w.state::<sidecar::BackendState>());
            }
        })
        .invoke_handler(tauri::generate_handler![backend_info, restart_backend])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
```

`main.rs`:

```rust
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]
fn main() {
    machinery_app_lib::run()
}
```

- [ ] **Step 4: Build a lightweight sidecar to prove the mechanism**

`backend/machinery_backend.spec` (PyInstaller one-folder; S6 extends it with torch hidden imports and CUDA DLLs):

```python
# -*- mode: python -*-
from PyInstaller.utils.hooks import collect_submodules

a = Analysis(
    ["app/__main__.py"],
    pathex=["."],
    hiddenimports=collect_submodules("app") + [
        "uvicorn.logging", "uvicorn.loops.auto", "uvicorn.protocols.http.auto",
        "uvicorn.protocols.websockets.auto", "uvicorn.lifespan.on", "websockets.legacy",
    ],
    datas=[("app/db/migrations", "app/db/migrations")],
    excludes=["torch", "torchvision", "ultralytics", "cv2", "sahi"],  # S0 only; S6 removes this line
)
pyz = PYZ(a.pure)
exe = EXE(pyz, a.scripts, exclude_binaries=True, name="machinery-backend", console=True)
coll = COLLECT(exe, a.binaries, a.datas, name="machinery-backend")
```

`backend/scripts/build.ps1`:

```powershell
$ErrorActionPreference = "Stop"
$backend = Split-Path $PSScriptRoot -Parent
Set-Location $backend
& .\.venv\Scripts\pyinstaller.exe machinery_backend.spec --noconfirm
$bin = Join-Path $backend "..\frontend\src-tauri\binaries"
New-Item -ItemType Directory -Force $bin | Out-Null
Copy-Item "dist\machinery-backend\machinery-backend.exe" (Join-Path $bin "machinery-backend-x86_64-pc-windows-msvc.exe") -Force
if (Test-Path (Join-Path $bin "_internal")) { Remove-Item (Join-Path $bin "_internal") -Recurse -Force }
Copy-Item "dist\machinery-backend\_internal" (Join-Path $bin "_internal") -Recurse
Write-Host "sidecar copied to $bin"
```

Run: `cd backend; .\scripts\build.ps1` then `$env:APP_TOKEN="x"; $env:APP_PORT="0"; .\dist\machinery-backend\machinery-backend.exe`
Expected: prints `{"event": "starting", "port": NNNN, ...}` and serves `/api/v1/health` with the token.

- [ ] **Step 5: Run the Tauri dev app**

Run: `cd frontend; pnpm tauri dev`
Expected: the window opens, the splash shows "Starting backend", the Projects screen appears within 15 s, and the terminal shows `[backend] {"event": "starting", ...}`. Closing the window ends the backend process (check with `Get-Process machinery-backend` returning nothing).

- [ ] **Step 6: Commit**

```bash
git add frontend/src-tauri backend/machinery_backend.spec backend/scripts && git commit -m "feat(tauri): shell that boots the backend sidecar with a per-launch token"
```

---

