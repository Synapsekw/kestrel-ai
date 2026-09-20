# Review package: f52267c..02359a9

## Commits
02359a9 docs: readme for build, install, run and tests
2e1b36c docs: installer build and install evidence
3f49daf test: acceptance script and driver
4268a96 chore: packaging hardening (orphan sweep, font pre-seed, sidecar log, csp)
eb3189b build: full pyinstaller bundle with cuda torch; frozen smoke script

## Files changed
 README.md                             | 116 +++++++-
 backend/app/health.py                 |  74 ++++-
 backend/app/jobs/runner.py            |   5 +
 backend/app/jobs/startup.py           |  46 +++
 backend/app/main.py                   |   8 +-
 backend/app/projects/service.py       |   8 +-
 backend/app/training/fonts.py         |  72 +++++
 backend/app/training/worker.py        |   3 +
 backend/machinery_backend.spec        |  67 ++++-
 backend/scripts/build.ps1             |   6 +
 backend/scripts/smoke_frozen.ps1      | 231 +++++++++++++++
 backend/tests/test_health.py          |  72 +++++
 backend/tests/test_job_startup.py     |  85 ++++++
 backend/tests/test_ultralytics_env.py |  76 +++++
 docs/progress.md                      |  38 +++
 frontend/scripts/acceptance.mjs       | 523 ++++++++++++++++++++++++++++++++++
 frontend/src-tauri/src/lib.rs         |   8 +-
 frontend/src-tauri/src/logfile.rs     | 155 ++++++++++
 frontend/src-tauri/src/sidecar.rs     |  16 +-
 frontend/src-tauri/tauri.conf.json    |   5 +-
 frontend/src/api/backend.test.ts      |  18 +-
 frontend/src/api/backend.ts           |  21 +-
 frontend/src/api/client.test.tsx      |  53 ++++
 frontend/src/api/client.tsx           |   6 +
 frontend/src/test/render.tsx          |   2 +-
 scripts/acceptance.md                 | 118 ++++++++
 26 files changed, 1799 insertions(+), 33 deletions(-)

## Diff
diff --git a/README.md b/README.md
index 1a37dce..80182a5 100644
--- a/README.md
+++ b/README.md
@@ -1,57 +1,61 @@
 # Machinery Detection (working name `machinery-app`)
 
 Windows desktop app for aerial construction-machinery detection: dataset preparation,
 bounding-box annotation, YOLO training with a model registry, and inference with local
 models or OpenAI / Anthropic vision models.
 
 - Design and PRD: `docs/superpowers/specs/2026-09-17-machinery-detection-app-design.md`
 - Progress, decisions and resume instructions: `docs/progress.md`
 - API contract (source of truth): `contract/openapi.yaml`
+- Acceptance run (spec 13.5): `scripts/acceptance.md`
 
 ## Layout
 
 | Part | What | Tooling |
 |---|---|---|
 | `backend/` | FastAPI sidecar: projects, datasets, annotation storage, jobs, training, inference | Python 3.11.15 in `backend/.venv` (uv), pytest, ruff, PyInstaller |
 | `frontend/` | Tauri 2 shell with the React/TypeScript/Vite UI | pnpm, Vitest, Playwright, Rust stable MSVC |
 | `contract/` | `openapi.yaml`, generated TypeScript client, Prism mock server, Spectral lint | pnpm |
 
 ## Prerequisites (reference machine)
 
 - Windows 11, NVIDIA GPU with driver 591.86 or newer (CUDA 13 runtime is bundled by the torch wheels).
+  The build and the numbers below were measured on an RTX 5070 Ti.
 - Node 24 and pnpm 10.
 - uv 0.11 or newer (it fetches CPython 3.11.15 on demand).
 - Rust stable for `x86_64-pc-windows-msvc` (`winget install Rustlang.Rustup`) and the MSVC C++
   build tools with a Windows 10 SDK. WebView2 runtime (present on Windows 11).
+- About 20 GB free for the frozen backend, the bundle and the installer.
 
 Nothing is installed system-wide except Rust. Ports 8080 and 9090 are left alone; the app uses
-8765 (dev backend), 4010 (mock), 1420 (Vite) and a random free port when packaged.
+8765 (dev backend), 4010 (mock), 1420 (Vite), 9222 (WebView2 debugging for the drivers) and a
+random free port when packaged.
+
+Pins that matter: torch 2.14.0+cu130, torchvision 0.29.0+cu130, ultralytics 8.4.154, PyInstaller 6,
+Tauri 2. `backend/requirements.txt` holds the ML stack, `requirements-lock.txt` everything else.
 
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
 
-`backend/requirements.txt` pins the ML stack to the reference machine (torch 2.14.0+cu130,
-ultralytics 8.4.154, ...); `requirements-lock.txt` freezes everything else.
-
 ## Run in development
 
 Against the mock server (UI work, no Python needed):
 
 ```powershell
 .\scripts\dev.ps1 -Mode mock      # Prism on 127.0.0.1:4010 + Vite on 127.0.0.1:1420
 ```
 
 Against the real backend:
 
@@ -64,51 +68,139 @@ back to the mock server. To run the backend by hand:
 
 ```powershell
 cd backend
 $env:APP_TOKEN = "dev"; $env:APP_PORT = "8765"; .\.venv\Scripts\python -m app
 ```
 
 `APP_PORT=0` picks a free port and prints `{"event": "starting", "port": ..., "pid": ...}` on
 stdout, which is how the Tauri launcher learns the port. Every request needs
 `Authorization: Bearer <token>` or `?token=<token>`.
 
-The desktop shell in development (spawns the sidecar built below, or targets `APP_BACKEND_URL`
-when that variable is set in the environment):
+The desktop shell in development:
 
 ```powershell
 cd frontend
 pnpm tauri dev
 ```
 
+It spawns the frozen sidecar from `src-tauri/binaries/` (build it first, below). Set
+`APP_BACKEND_URL` and `APP_BACKEND_TOKEN` in the environment instead and the shell attaches to a
+backend you started yourself rather than spawning one - that is the mode the checkpoint and
+acceptance drivers use.
+
 ## Build
 
 1. Freeze the backend and copy it into the Tauri sidecar slot:
 
    ```powershell
    cd backend
    .\scripts\build.ps1     # PyInstaller one-folder -> frontend/src-tauri/binaries/
    ```
 
-2. Build the installer:
+   On the reference machine: about 2 minutes, `dist/machinery-backend` is 3.4 GB in ~14,100 files.
+   The bundle carries CUDA torch, torchvision, Ultralytics, OpenCV and the ONNX stack, because the
+   same exe is also the training and export worker (`machinery-backend.exe worker train <params>`).
+
+2. Prove the frozen build before wrapping it in an installer:
+
+   ```powershell
+   powershell -ExecutionPolicy Bypass -File backend\scripts\smoke_frozen.ps1
+   ```
+
+   It starts the exe the way the sidecar does, then checks health, `torch.cuda.is_available()`,
+   an import, one YOLO prediction, a 1-epoch training run through the frozen `worker` subcommand
+   (DataLoader workers, so `multiprocessing.freeze_support()` is exercised), the Ultralytics font
+   pre-seed, an ONNX export and a keyring round trip through Windows Credential Manager. It prints
+   `health ok`, `cuda True <gpu name>`, `predict ok <n> boxes`, `worker ok` and exits non-zero on
+   any failure. About 25 seconds.
+
+3. Build the installer:
 
    ```powershell
    cd frontend
-   pnpm tauri build        # NSIS installer under frontend/src-tauri/target/release/bundle/nsis/
+   pnpm tauri build        # bundle under frontend/src-tauri/target/release/bundle/
    ```
 
+   The app binary builds in about a minute; the install tree it would write is 3.47 GB, inside the
+   6 GB success criterion.
+
+   **Known limit - no installer yet.** Neither Tauri bundler can package a 3.4 GB sidecar. NSIS
+   addresses its payload with 32-bit offsets, so `makensis` dies at 2 GB
+   (`Internal compiler error #12345: error mmapping file (2057025505, 33554432) is out of range`),
+   and `--bundles msi` puts everything in one embedded cabinet, which the cabinet format caps at
+   the same 2 GB (`light.exe : error LGHT0001 : Catastrophic failure ... CreateCabFinish`). The
+   measurements, why trimming the CUDA payload does not help, and the options are in
+   `docs/progress.md` under "S6 packaging evidence"; the format is the goal owner's decision.
+
+## Install and run the packaged app
+
+- Run the generated installer (`/S` for a silent NSIS install, `msiexec /i "<file>.msi" /qn` for
+  an MSI). The install is per user: no administrator rights, no shared install directory.
+- The WebView2 runtime is fetched by the bootstrapper if the machine does not already have it.
+- The app installs next to the sidecar: `machinery-backend-x86_64-pc-windows-msvc.exe` with its
+  `_internal/` folder beside it. Both must stay together.
+- Per-user data lives in `%APPDATA%\ai.synapse-solutions.machinery-app`: `logs/`,
+  `recent_projects.json`, `settings.json` and `ultralytics/` (the pre-seeded plot font). Uninstall
+  removes the program directory and leaves that data alone.
+- Project data (images, labels, datasets, runs, models, `project.db`) lives in the project folder
+  the operator chooses, never under the install directory.
+
 ## Run the tests
 
 ```powershell
-cd backend;  .\.venv\Scripts\python -m pytest -q; .\.venv\Scripts\ruff check .
+cd backend;  .\.venv\Scripts\python -m pytest -q; .\.venv\Scripts\python -m ruff check .
 cd contract; pnpm check                    # lint + regenerate client, fails on a stale client
 cd frontend; pnpm lint; pnpm test; pnpm build; pnpm e2e   # e2e starts the mock server itself
+cd frontend\src-tauri; cargo test --lib    # the sidecar log file
 ```
 
-Backend markers: `-m gpu` runs the GPU training test, `-m live` runs cloud-provider tests
-(they read API keys from environment variables and skip when absent). Both are excluded by default.
-`tests/test_contract.py` validates every response against `contract/openapi.yaml` with
+Backend markers: `-m gpu` runs the GPU training and inference tests, `-m live` runs cloud-provider
+tests (they read API keys from environment variables and skip when absent). Both are excluded by
+default. `tests/test_contract.py` validates every response against `contract/openapi.yaml` with
 schemathesis.
 
+### Drivers against the real app
+
+The integration checkpoints and the acceptance run drive the real webview over CDP. Start the app
+with the debugging port open, then run the driver in another shell:
+
+```powershell
+$env:WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS = "--remote-debugging-port=9222"
+# ... start `pnpm tauri dev` (dev) or the installed app (acceptance)
+node frontend\scripts\checkpoint3.mjs <projectFolder> <sampleFolder> <evidenceDir> <weightsPath>
+node frontend\scripts\acceptance.mjs --project-folder <folder> --evidence docs\evidence\acceptance
+```
+
+`scripts/acceptance.md` is the eight-step acceptance run in prose, with the expected values and
+the evidence file names; `acceptance.mjs` takes every expected value as a flag, so it can be
+dry-run against a small copy of the frames before the real run.
+
+Cloud-provider steps read `ANTHROPIC_API_KEY` from the environment, store it through the providers
+key endpoint for the duration of the run, delete it afterwards and skip with a clear message when
+the variable is absent. No key is ever written to a file, a fixture or a log.
+
+## Troubleshooting
+
+- **The app opens with "The backend is not responding".** The dialog names the sidecar log,
+  `%APPDATA%\ai.synapse-solutions.machinery-app\logs\sidecar.log` (rolled over once at 5 MB); the
+  backend's own log with timestamps is `backend.log` next to it. **Restart** in the dialog respawns
+  the sidecar without restarting the app.
+- **`torch.cuda.is_available()` is false / the GPU is not detected.** `GET /api/v1/health` reports
+  `gpu: {available, name}`; the field is absent for the first few seconds because the probe runs in
+  the background. False on a machine with an NVIDIA GPU means the driver is older than the bundled
+  CUDA 13 runtime needs - update the driver, then re-run `smoke_frozen.ps1`.
+- **A port is busy.** The packaged app picks a free port per launch, so only the dev setup has
+  fixed ports: 8765 (backend), 1420 (Vite), 4010 (mock), 9222 (WebView2 debugging).
+- **Jobs stuck in "running" after a crash.** Opening the project marks them `failed` with
+  "interrupted by application restart" (queued ones become `cancelled`); start the work again.
+- **Re-running the installer** upgrades in place and keeps app data and project folders. Uninstall
+  first only if the install directory itself is damaged.
+- **The first `pnpm tauri build` downloads** NSIS or the WiX toolset and the WebView2 bootstrapper
+  into the Tauri cache under `%LOCALAPPDATA%\tauri`; that needs network access once.
+- **Training cannot reach the network.** It must not need to: the AMP probe is skipped
+  (`app/training/worker.py`), Ultralytics auto-install is off and the plot font is seeded from the
+  machine's own fonts (`app/training/fonts.py`).
+
 ## Changing the API
 
 Only the goal owner edits `contract/openapi.yaml`. After a change: `cd contract; pnpm check`
 (regenerates `client/schema.d.ts`), then run the backend contract tests.
diff --git a/backend/app/health.py b/backend/app/health.py
index 628a738..c1eef23 100644
--- a/backend/app/health.py
+++ b/backend/app/health.py
@@ -1,16 +1,88 @@
+"""Health endpoint and the CUDA probe that fills its `gpu` block (spec section 10).
+
+Asking torch whether CUDA is available costs seconds on a cold process — importing the CUDA
+runtime DLLs in the packaged build is the expensive part — so the answer is never computed on
+the request thread: the first health request starts a background probe and every request reports
+whatever the probe has produced so far.
+"""
+
+import logging
 import os
+import threading
+import time
+from collections.abc import Callable
 
 from fastapi import APIRouter, Request
 
 router = APIRouter()
+log = logging.getLogger(__name__)
+
+PROBE_TIMEOUT_S = 10.0
+NO_GPU: dict = {"available": False, "name": None}
+
+
+def probe_cuda() -> dict:
+    """Import torch and ask CUDA for the first device's name."""
+    import torch
+
+    if not torch.cuda.is_available():
+        return dict(NO_GPU)
+    return {"available": True, "name": torch.cuda.get_device_name(0)}
+
+
+class GpuProbe:
+    """Runs `probe` once in a background thread, started by the first `snapshot()`.
+
+    `snapshot()` never blocks. It returns `None` while the probe is still running (the contract
+    leaves `gpu` absent then) and falls back to "no GPU" once the probe has taken longer than
+    `timeout_s`: a machine whose CUDA stack is that slow is not one the UI should wait for. A late
+    answer still replaces the fallback, so the field becomes correct as soon as the probe returns.
+    """
+
+    def __init__(
+        self,
+        probe: Callable[[], dict] = probe_cuda,
+        timeout_s: float = PROBE_TIMEOUT_S,
+        clock: Callable[[], float] = time.monotonic,
+    ):
+        self._probe = probe
+        self._timeout_s = timeout_s
+        self._clock = clock
+        self._lock = threading.Lock()
+        self._started_at: float | None = None
+        self._result: dict | None = None
+
+    def snapshot(self) -> dict | None:
+        with self._lock:
+            if self._result is not None:
+                return self._result
+            if self._started_at is None:
+                self._started_at = self._clock()
+                threading.Thread(target=self._run, name="gpu-probe", daemon=True).start()
+                return None
+            expired = self._clock() - self._started_at >= self._timeout_s
+        return dict(NO_GPU) if expired else None
+
+    def _run(self) -> None:
+        try:
+            value = self._probe()
+        except Exception as e:
+            log.warning("gpu probe failed: %s: %s", type(e).__name__, e)
+            value = dict(NO_GPU)
+        with self._lock:
+            self._result = value
 
 
 @router.get("/health")
 def health(request: Request) -> dict:
     s = request.app.state.settings
-    return {
+    body = {
         "status": "ok",
         "version": s.version,
         "pid": os.getpid(),
         "started_at": request.app.state.started_at,
     }
+    gpu = request.app.state.gpu_probe.snapshot()
+    if gpu is not None:
+        body["gpu"] = gpu
+    return body
diff --git a/backend/app/jobs/runner.py b/backend/app/jobs/runner.py
index e8489ae..e1430a3 100644
--- a/backend/app/jobs/runner.py
+++ b/backend/app/jobs/runner.py
@@ -131,20 +131,25 @@ class JobRunner:
         with self._lock:
             ctx = self._contexts.get(job_id)
         if ctx is not None:
             ctx.cancelled.set()
             return self.get(project, job_id)
         job = self.get(project, job_id)
         if job.state == "queued":  # left over from a previous process
             return self.update(project, job_id, state="cancelled", finished_at=datetime.now(UTC))
         return job
 
+    def is_live(self, job_id: str) -> bool:
+        """True while this process holds the job: queued in the pool or running right now."""
+        with self._lock:
+            return job_id in self._contexts
+
     def get(self, project: ProjectHandle, job_id: str) -> Job:
         with project.session() as s:
             job = s.get(Job, job_id)
             if job is None:
                 raise not_found("job", job_id)
             s.expunge(job)
             return job
 
     def update(self, project: ProjectHandle, job_id: str, **fields) -> Job:
         with project.session() as s:
diff --git a/backend/app/jobs/startup.py b/backend/app/jobs/startup.py
new file mode 100644
index 0000000..683fc1c
--- /dev/null
+++ b/backend/app/jobs/startup.py
@@ -0,0 +1,46 @@
+"""Orphan job sweep, run when a project becomes live in this process (spec section 10).
+
+A crash, a killed sidecar or a plain quit leaves `queued` and `running` rows in the project DB.
+Nothing will ever finish them, so without this sweep the Jobs panel shows work that is frozen
+forever. Projects open lazily, so the sweep runs per project on open rather than once at startup.
+"""
+
+import logging
+from datetime import UTC, datetime
+
+from sqlalchemy import select
+
+from app.db.models import Job
+from app.jobs.runner import JobRunner
+from app.projects.service import ProjectHandle
+
+RESTART_ERROR = "interrupted by application restart"
+ORPHAN_STATES = {"running": "failed", "queued": "cancelled"}
+log = logging.getLogger(__name__)
+
+
+def sweep_orphans(project: ProjectHandle, runner: JobRunner) -> list[dict]:
+    """Close out unfinished jobs this process does not own; returns `[{id, type, state}]`.
+
+    A `running` row becomes `failed` with a plain explanation an operator can act on, a `queued`
+    one was never started so it becomes `cancelled`. Jobs the runner is holding right now belong
+    to this process and are left alone: a project can be reopened while its own jobs run.
+    """
+    with project.session() as s:
+        rows = [
+            (j.id, j.type, j.state)
+            for j in s.execute(select(Job).where(Job.state.in_(ORPHAN_STATES))).scalars()
+        ]
+    swept = []
+    for job_id, job_type, state in rows:
+        if runner.is_live(job_id):
+            continue
+        new_state = ORPHAN_STATES[state]
+        fields = {"state": new_state, "finished_at": datetime.now(UTC)}
+        if new_state == "failed":
+            fields["error"] = RESTART_ERROR
+        runner.update(project, job_id, **fields)
+        swept.append({"id": job_id, "type": job_type, "state": new_state})
+    if swept:
+        log.info("swept %d orphaned job(s) in project %s: %s", len(swept), project.id, swept)
+    return swept
diff --git a/backend/app/main.py b/backend/app/main.py
index 31a9767..f086d32 100644
--- a/backend/app/main.py
+++ b/backend/app/main.py
@@ -4,60 +4,66 @@ import os
 import socket
 from contextlib import asynccontextmanager
 from datetime import UTC, datetime
 
 from fastapi import FastAPI
 from fastapi.middleware.cors import CORSMiddleware
 
 from app.appdata import AppData
 from app.config import Settings
 from app.errors import install_error_handlers
+from app.health import GpuProbe
 from app.logging_setup import configure_logging
 from app.providers.config import ProviderConfigStore
 from app.providers.keys import KeyringKeyStore
 
 
 def create_app(settings: Settings | None = None) -> FastAPI:
     settings = settings or Settings()
     settings.data_dir.mkdir(parents=True, exist_ok=True)
     configure_logging(settings.data_dir, settings.log_level)
 
     @asynccontextmanager
     async def lifespan(app: FastAPI):
         from app.jobs.events import EventBus
         from app.jobs.runner import JobRunner
+        from app.jobs.startup import sweep_orphans
         from app.projects.service import ProjectRegistry
 
         app.state.events = EventBus()
         app.state.events.bind(asyncio.get_running_loop())
-        app.state.projects = ProjectRegistry(settings.data_dir)
         app.state.jobs = JobRunner(app.state.events)
+        # Projects open lazily, so the orphan sweep hangs off the registry rather than startup.
+        app.state.projects = ProjectRegistry(
+            settings.data_dir, on_open=lambda handle: sweep_orphans(handle, app.state.jobs)
+        )
         # jobs reach the key store and provider settings through the runner: a job's params are
         # persisted in the project DB, so a key must never travel that way.
         app.state.jobs.keys = app.state.keys
         app.state.jobs.provider_config = app.state.provider_config
         app.state.jobs.start()
         yield
         app.state.jobs.stop()
         app.state.projects.close_all()
 
     app = FastAPI(
         title="machinery-backend",
         version=settings.version,
         lifespan=lifespan,
         docs_url=None,
         redoc_url=None,
         openapi_url=None,
     )
     app.state.settings = settings
     app.state.started_at = datetime.now(UTC).isoformat()
     app.state.keys = KeyringKeyStore()
+    app.state.gpu_probe = GpuProbe()
     app.state.provider_config = ProviderConfigStore(AppData(settings.data_dir))
     app.add_middleware(
         CORSMiddleware,
         allow_origins=settings.cors_origins,
         allow_methods=["*"],
         allow_headers=["Authorization", "Content-Type"],
         allow_credentials=False,
         max_age=600,
     )
     install_error_handlers(app)
diff --git a/backend/app/projects/service.py b/backend/app/projects/service.py
index b2a88a4..458fecd 100644
--- a/backend/app/projects/service.py
+++ b/backend/app/projects/service.py
@@ -1,14 +1,14 @@
 """Project registry: opens project folders, owns their engines, tracks recent projects."""
 
 import threading
-from collections.abc import Iterator
+from collections.abc import Callable, Iterator
 from contextlib import contextmanager
 from pathlib import Path
 
 from fastapi import Request
 from sqlalchemy import func, select
 from sqlalchemy.orm import Session
 
 from app.appdata import AppData
 from app.db.base import new_id
 from app.db.models import Box, Project
@@ -88,22 +88,24 @@ def check_removed_classes_unused(s: Session, before: list[dict], after: list[dic
         if n:
             raise AppError(
                 "class_in_use",
                 f"class {c['name']!r} still has {n} boxes; reassign or delete them first",
                 409,
                 {"class_id": c["id"], "box_count": n},
             )
 
 
 class ProjectRegistry:
-    def __init__(self, data_dir: Path):
+    def __init__(self, data_dir: Path, on_open: Callable[[ProjectHandle], None] | None = None):
+        """`on_open` runs once per project, the moment it becomes live in this process."""
         self.appdata = AppData(data_dir)
+        self.on_open = on_open
         self._handles: dict[str, ProjectHandle] = {}
         self._lock = threading.Lock()
 
     def create(self, name: str, folder: Path, classes: list[dict]) -> ProjectHandle:
         folder = folder.resolve()
         with self._lock:
             if (folder / "project.db").exists():
                 raise AppError("already_exists", f"{folder} already contains a project", 409)
             for sub in SUBDIRS:
                 (folder / sub).mkdir(parents=True, exist_ok=True)
@@ -137,20 +139,22 @@ class ProjectRegistry:
     @staticmethod
     def _name(h: ProjectHandle) -> str:
         with h.session() as s:
             return h.row(s).name
 
     def _cache(self, pid: str, folder: Path, engine, name: str, remember: bool) -> ProjectHandle:
         h = ProjectHandle(pid, folder, engine)
         self._handles[pid] = h
         if remember:
             self.appdata.remember(pid, name, str(folder))
+        if self.on_open is not None:
+            self.on_open(h)
         return h
 
     def get(self, project_id: str) -> ProjectHandle:
         if project_id in self._handles:
             return self._handles[project_id]
         for r in self.appdata.recent():
             if r["id"] == project_id and (Path(r["folder"]) / "project.db").exists():
                 return self.open(Path(r["folder"]), remember=False)
         raise not_found("project", project_id)
 
diff --git a/backend/app/training/fonts.py b/backend/app/training/fonts.py
new file mode 100644
index 0000000..d9c0e33
--- /dev/null
+++ b/backend/app/training/fonts.py
@@ -0,0 +1,72 @@
+"""Seed the font Ultralytics plots with, so a packaged app never needs the network (spec 10).
+
+Ultralytics draws its label and result plots with `Arial.ttf` and downloads it from GitHub into
+`YOLO_CONFIG_DIR` the first time a machine trains. An installed app may well be offline, and a
+failed download costs a long timeout in the middle of a run, so the worker points the config dir
+at the app data folder and copies a font that is already on the machine into it. Nothing is
+redistributed: the candidates are the machine's own Arial and the DejaVuSans that ships with
+matplotlib (an Ultralytics dependency, so it is inside the frozen bundle as well).
+"""
+
+import importlib.util
+import logging
+import os
+import shutil
+from pathlib import Path
+
+FONT_NAME = "Arial.ttf"
+log = logging.getLogger(__name__)
+
+
+def font_candidates() -> list[Path]:
+    """Fonts to seed from, best first."""
+    candidates = [Path(os.environ.get("WINDIR", r"C:\Windows")) / "Fonts" / "arial.ttf"]
+    spec = importlib.util.find_spec("matplotlib")
+    if spec and spec.origin:
+        candidates.append(Path(spec.origin).parent / "mpl-data" / "fonts" / "ttf" / "DejaVuSans.ttf")
+    return candidates
+
+
+def ensure_font(config_dir: Path) -> Path | None:
+    """Put `Arial.ttf` in `config_dir` if it is not there yet; None when no candidate exists."""
+    config_dir = Path(config_dir)
+    dest = config_dir / FONT_NAME
+    if dest.is_file():
+        return dest
+    for source in font_candidates():
+        if not source.is_file():
+            continue
+        config_dir.mkdir(parents=True, exist_ok=True)
+        tmp = dest.with_suffix(f".{os.getpid()}.tmp")
+        shutil.copy2(source, tmp)
+        os.replace(tmp, dest)  # atomic: a half-copied font would break every plot
+        log.info("seeded %s from %s", dest, source)
+        return dest
+    log.warning("no font to seed %s from; ultralytics will try to download one", dest)
+    return None
+
+
+def _config_dir(data_dir: str | Path | None) -> Path | None:
+    existing = os.environ.get("YOLO_CONFIG_DIR")
+    if existing:
+        return Path(existing)
+    root = data_dir or os.environ.get("APP_DATA_DIR")
+    return Path(root) / "ultralytics" if root else None
+
+
+def configure_ultralytics(data_dir: str | Path | None = None) -> Path | None:
+    """Point `YOLO_CONFIG_DIR` at app data and seed the font. Run before ultralytics is imported.
+
+    The config dir is whatever the launcher already chose, else `<data_dir>/ultralytics`, else the
+    inherited `APP_DATA_DIR`. With none of those there is nowhere sensible to write, and Ultralytics
+    keeps its own default; that is logged rather than raised, because a plot font is not worth
+    failing a training run over.
+    """
+    config_dir = _config_dir(data_dir)
+    if config_dir is None:
+        log.warning("no app data dir: ultralytics keeps its default config dir")
+        return None
+    config_dir.mkdir(parents=True, exist_ok=True)
+    os.environ["YOLO_CONFIG_DIR"] = str(config_dir)
+    ensure_font(config_dir)
+    return config_dir
diff --git a/backend/app/training/worker.py b/backend/app/training/worker.py
index 9699e93..1e0c4e7 100644
--- a/backend/app/training/worker.py
+++ b/backend/app/training/worker.py
@@ -6,20 +6,21 @@ and `done.json` into the run folder and mirrors progress lines on stdout for the
 """
 
 import json
 import os
 import sys
 import time
 import traceback
 from collections.abc import Callable
 from pathlib import Path
 
+from app.training.fonts import configure_ultralytics
 from app.training.presets import TrainParams, to_ultralytics_kwargs
 
 LOSS_NAMES_FALLBACK = ("box_loss", "cls_loss", "dfl_loss")
 
 
 def _is_number(v) -> bool:
     try:
         float(v)
     except (TypeError, ValueError):
         return False
@@ -204,20 +205,22 @@ def run_export(params: dict) -> dict:
         device=params.get("device", "0"),
     )
     return {"ok": True, "path": str(Path(str(path)).resolve())}
 
 
 def main(argv: list[str]) -> int:
     os.environ.setdefault("YOLO_VERBOSE", "False")
     # Never let ultralytics pip-install into the user's environment; a missing optional
     # dependency (for example onnx) has to surface as a job error, not as a silent install.
     os.environ.setdefault("YOLO_AUTOINSTALL", "False")
+    # Keep the config dir (and the plot font it would otherwise download) inside app data.
+    configure_ultralytics()
     if len(argv) < 2 or argv[0] not in ("train", "export"):
         print("usage: worker (train|export) <params.json>", file=sys.stderr)
         return 2
     command, params_json = argv[0], Path(argv[1])
     run_dir = params_json.parent  # the launcher writes params.json into the run folder
     try:
         params = json.loads(params_json.read_text(encoding="utf-8"))
         run_dir = Path(params.get("run_dir") or run_dir)
         payload = run_train(params) if command == "train" else run_export(params)
     except Exception as e:
diff --git a/backend/machinery_backend.spec b/backend/machinery_backend.spec
index 4921228..f2bb532 100644
--- a/backend/machinery_backend.spec
+++ b/backend/machinery_backend.spec
@@ -1,16 +1,67 @@
 # -*- mode: python -*-
-from PyInstaller.utils.hooks import collect_submodules
+# One-folder freeze of the backend (spec section 10). The exe doubles as the training/export
+# worker (`machinery-backend.exe worker train <params.json>`), so torch, torchvision, ultralytics
+# and the ONNX stack all have to be inside the bundle: nothing is installed on the user's machine.
+from PyInstaller.utils.hooks import collect_data_files, collect_dynamic_libs, collect_submodules
+
+hiddenimports = (
+    collect_submodules("app")
+    + collect_submodules("ultralytics")
+    + [
+        "torch",
+        "torchvision",
+        # torchvision 0.29 loads its C++ ops through torch.ops.load_library(<path>), not an
+        # import, so PyInstaller cannot see them: without these the bundle starts but every
+        # prediction dies on "operator torchvision::nms does not exist". (The upstream hook
+        # still names the pre-0.29 `torchvision._C` and `torchvision.image`, which are gone.)
+        "torchvision._C_stable",
+        "torchvision.image_stable",
+        "cv2",
+        "onnx",
+        "onnxslim",
+        "onnxruntime",
+        "anthropic",
+        "openai",
+        # keyring resolves its backend by entry point at runtime; the frozen build has no entry
+        # points, so the Windows Credential Manager backend and its ctypes bindings are named here.
+        # (The brief also lists `pywin32_system32`; it is not a module in this venv - keyring uses
+        # pywin32-ctypes, which is pure ctypes - so naming it would only produce a build warning.)
+        "keyring.backends.Windows",
+        "win32ctypes.pywin32",
+        "alembic",
+        "sqlalchemy.dialects.sqlite",
+        "uvicorn.logging",
+        "uvicorn.loops.auto",
+        "uvicorn.protocols.http.auto",
+        "uvicorn.protocols.websockets.auto",
+        "uvicorn.lifespan.on",
+        "websockets",
+        "anyio._backends._asyncio",
+    ]
+)
+
+datas = (
+    [("app/db/migrations", "app/db/migrations")]
+    + collect_data_files("ultralytics")  # cfg/*.yaml, the default trackers and assets
+    + collect_data_files("torch", include_py_files=False)
+)
+
+binaries = (
+    collect_dynamic_libs("torch")  # torch/lib: the CUDA runtime, cuDNN and cuBLAS DLLs
+    + collect_dynamic_libs("torchvision")
+    + collect_dynamic_libs("onnxruntime")
+)
 
 a = Analysis(
     ["app/__main__.py"],
     pathex=["."],
-    hiddenimports=collect_submodules("app") + [
-        "uvicorn.logging", "uvicorn.loops.auto", "uvicorn.protocols.http.auto",
-        "uvicorn.protocols.websockets.auto", "uvicorn.lifespan.on", "websockets.legacy",
-    ],
-    datas=[("app/db/migrations", "app/db/migrations")],
-    excludes=["torch", "torchvision", "ultralytics", "cv2", "sahi"],  # S0 only; S6 removes this line
+    hiddenimports=hiddenimports,
+    datas=datas,
+    binaries=binaries,
 )
 pyz = PYZ(a.pure)
-exe = EXE(pyz, a.scripts, exclude_binaries=True, name="machinery-backend", console=True)
+# console=False: the shell plugin gives the sidecar piped stdio either way, so the startup JSON
+# line still reaches Tauri as CommandEvent::Stdout, and a windowed exe keeps the training worker
+# subprocess (which the frozen exe spawns for every run) from flashing a console window.
+exe = EXE(pyz, a.scripts, exclude_binaries=True, name="machinery-backend", console=False)
 coll = COLLECT(exe, a.binaries, a.datas, name="machinery-backend")
diff --git a/backend/scripts/build.ps1 b/backend/scripts/build.ps1
index 8c6618e..ea56755 100644
--- a/backend/scripts/build.ps1
+++ b/backend/scripts/build.ps1
@@ -1,18 +1,24 @@
 # Freeze the backend with PyInstaller (one-folder) and copy it into the Tauri sidecar slot.
 $ErrorActionPreference = "Stop"
 $backend = Split-Path $PSScriptRoot -Parent
 Set-Location $backend
+$started = Get-Date
 
 # PyInstaller logs to stderr; PowerShell 5.1 would turn every line into an error under "Stop".
 $ErrorActionPreference = "Continue"
 & .\.venv\Scripts\pyinstaller.exe machinery_backend.spec --noconfirm --log-level WARN 2>&1 | ForEach-Object { "$_" }
 $code = $LASTEXITCODE
 $ErrorActionPreference = "Stop"
 if ($code -ne 0) { throw "pyinstaller failed with exit code $code" }
 
 $bin = Join-Path $backend "..\frontend\src-tauri\binaries"
 New-Item -ItemType Directory -Force $bin | Out-Null
 Copy-Item "dist\machinery-backend\machinery-backend.exe" (Join-Path $bin "machinery-backend-x86_64-pc-windows-msvc.exe") -Force
 if (Test-Path (Join-Path $bin "_internal")) { Remove-Item (Join-Path $bin "_internal") -Recurse -Force }
 Copy-Item "dist\machinery-backend\_internal" (Join-Path $bin "_internal") -Recurse
 Write-Host "sidecar copied to $bin"
+
+$bytes = (Get-ChildItem "dist\machinery-backend" -Recurse -File | Measure-Object -Sum Length).Sum
+$elapsed = (Get-Date) - $started
+Write-Host ("dist/machinery-backend: {0:N1} MB in {1:N0} files; build took {2:N0} s" -f `
+  ($bytes / 1MB), (Get-ChildItem "dist\machinery-backend" -Recurse -File).Count, $elapsed.TotalSeconds)
diff --git a/backend/scripts/smoke_frozen.ps1 b/backend/scripts/smoke_frozen.ps1
new file mode 100644
index 0000000..1e247f6
--- /dev/null
+++ b/backend/scripts/smoke_frozen.ps1
@@ -0,0 +1,231 @@
+<#
+.SYNOPSIS
+  Smoke test for the frozen backend (spec section 10).
+
+.DESCRIPTION
+  Starts dist/machinery-backend/machinery-backend.exe exactly as the Tauri sidecar does
+  (APP_TOKEN / APP_PORT / APP_DATA_DIR, stdio on a pipe), then proves in one run that the bundle
+  carries everything the app needs: the API answers, CUDA torch is inside, one YOLO prediction
+  runs, the `worker` subcommand trains with DataLoader workers (freeze_support), ONNX export
+  works, and keyring reaches Windows Credential Manager without setuptools entry points.
+
+  Prints `health ok`, `cuda True <gpu name>`, `predict ok <n> boxes` and `worker ok`, and exits
+  non-zero on any failure. Sample frames are copied out of the read-only source folder first.
+
+.EXAMPLE
+  powershell -ExecutionPolicy Bypass -File backend\scripts\smoke_frozen.ps1
+#>
+[CmdletBinding()]
+param(
+  [string] $Dist,  # defaults to <backend>/dist/machinery-backend once $PSScriptRoot is set
+  [string] $Weights = "E:\Dev\Yolo\models\yolo11n.pt",
+  [string] $Source = "E:\Dev\Yolo\data\raw\ahmadia",
+  [int] $Frames = 3,
+  [int] $Imgsz = 640,
+  [string] $WorkDir = (Join-Path $env:TEMP ("machinery-smoke-" + [guid]::NewGuid().ToString("N").Substring(0, 8)))
+)
+
+$ErrorActionPreference = "Stop"
+# $PSScriptRoot is not set yet while parameter defaults are evaluated on PowerShell 5.1.
+if (-not $Dist) { $Dist = Join-Path (Split-Path $PSScriptRoot -Parent) "dist\machinery-backend" }
+$exe = Join-Path $Dist "machinery-backend.exe"
+if (-not (Test-Path $exe)) { throw "no frozen build at $exe; run backend\scripts\build.ps1 first" }
+if (-not (Test-Path $Weights)) { throw "no weights at $Weights" }
+if (-not (Test-Path $Source)) { throw "no sample frames at $Source" }
+
+$script:Base = $null
+$script:Token = -join ((48..57 + 65..90 + 97..122) | Get-Random -Count 32 | ForEach-Object { [char]$_ })
+$timings = [ordered]@{}
+$total = [Diagnostics.Stopwatch]::StartNew()
+$step = [Diagnostics.Stopwatch]::StartNew()
+
+function Complete-Step([string] $Name) {
+  $timings[$Name] = [math]::Round($step.Elapsed.TotalSeconds, 2)
+  $step.Restart()
+}
+
+function Invoke-Api([string] $Method, [string] $Path, $Body, [int] $TimeoutSec = 900) {
+  $request = @{
+    Method          = $Method
+    Uri             = "$script:Base/api/v1$Path"
+    Headers         = @{ Authorization = "Bearer $script:Token" }
+    UseBasicParsing = $true
+    TimeoutSec      = $TimeoutSec
+  }
+  if ($null -ne $Body) {
+    $request.Body = ($Body | ConvertTo-Json -Depth 8)
+    $request.ContentType = "application/json"
+  }
+  try {
+    $response = Invoke-WebRequest @request
+  } catch {
+    $detail = ""
+    if ($_.Exception.Response) {
+      $reader = New-Object IO.StreamReader($_.Exception.Response.GetResponseStream())
+      $detail = ": " + $reader.ReadToEnd()
+      $reader.Close()
+    }
+    throw "$Method $Path failed: $($_.Exception.Message)$detail"
+  }
+  if ($response.Content) { return ($response.Content | ConvertFrom-Json) }
+  return $null
+}
+
+function Wait-ApiJob([string] $ProjectId, [string] $JobId, [int] $TimeoutSec = 1800) {
+  $deadline = (Get-Date).AddSeconds($TimeoutSec)
+  while ((Get-Date) -lt $deadline) {
+    $job = Invoke-Api GET "/projects/$ProjectId/jobs/$JobId"
+    if ($job.state -in @("succeeded", "failed", "cancelled")) { return $job }
+    Start-Sleep -Milliseconds 500
+  }
+  throw "job $JobId did not finish within $TimeoutSec s"
+}
+
+New-Item -ItemType Directory -Force $WorkDir | Out-Null
+$sample = Join-Path $WorkDir "sample"
+$projectFolder = Join-Path $WorkDir "project"
+New-Item -ItemType Directory -Force $sample, $projectFolder, (Join-Path $WorkDir "appdata") | Out-Null
+Get-ChildItem $Source -Filter *.jpg | Sort-Object Name | Select-Object -First $Frames |
+  ForEach-Object { Copy-Item $_.FullName $sample }
+
+$env:APP_TOKEN = $script:Token
+$env:APP_PORT = "0"   # the exe picks a free port and prints it as a JSON line
+$env:APP_DATA_DIR = Join-Path $WorkDir "appdata"
+$stdout = Join-Path $WorkDir "stdout.txt"
+$stderr = Join-Path $WorkDir "stderr.txt"
+$proc = Start-Process -FilePath $exe -PassThru -WindowStyle Hidden `
+  -RedirectStandardOutput $stdout -RedirectStandardError $stderr
+
+try {
+  # 1. startup: the JSON line the Tauri launcher reads off the sidecar's stdout
+  $port = $null
+  $deadline = (Get-Date).AddSeconds(30)
+  while ((Get-Date) -lt $deadline -and -not $port) {
+    if ($proc.HasExited) { throw "the exe exited with code $($proc.ExitCode); stderr:`n$(Get-Content $stderr -Raw)" }
+    $line = Get-Content $stdout -ErrorAction SilentlyContinue | Where-Object { $_ -match '"port":\s*(\d+)' }
+    if ($line) { $port = [int]$Matches[1] }
+    Start-Sleep -Milliseconds 100
+  }
+  if (-not $port) { throw "the exe printed no startup JSON line within 30 s" }
+  $script:Base = "http://127.0.0.1:$port"
+  Complete-Step "startup_line"
+  Write-Host "startup ok port $port pid $($proc.Id)"
+
+  # 2. health within 20 s
+  $health = $null
+  $deadline = (Get-Date).AddSeconds(20)
+  while ((Get-Date) -lt $deadline -and -not $health) {
+    try { $health = Invoke-Api GET "/health" -TimeoutSec 5 } catch { Start-Sleep -Milliseconds 200 }
+  }
+  if (-not $health) { throw "health did not answer within 20 s" }
+  Complete-Step "health"
+  Write-Host "health ok"
+
+  # 3. the gpu block is filled by a background probe, so poll until it appears
+  $deadline = (Get-Date).AddSeconds(90)
+  while ((Get-Date) -lt $deadline -and -not $health.gpu) {
+    Start-Sleep -Milliseconds 250
+    $health = Invoke-Api GET "/health"
+  }
+  if (-not $health.gpu) { throw "the gpu probe produced no answer within 90 s" }
+  if (-not $health.gpu.available) { throw "cuda False: the frozen build cannot see the GPU" }
+  Complete-Step "cuda"
+  Write-Host "cuda $($health.gpu.available) $($health.gpu.name)"
+
+  # 4. project, import, weights
+  $names = @("excavator", "wheel_loader", "bulldozer", "dump_truck", "crane", "concrete_mixer", "roller", "backhoe")
+  $colours = @("#f97316", "#eab308", "#22c55e", "#06b6d4", "#3b82f6", "#a855f7", "#ec4899", "#ef4444")
+  $classes = 0..7 | ForEach-Object { @{ name = $names[$_]; colour = $colours[$_]; hotkey = "$($_ + 1)" } }
+  $project = Invoke-Api POST "/projects" @{ name = "Frozen smoke"; folder = $projectFolder; classes = $classes }
+  $pid1 = $project.id
+  Complete-Step "create_project"
+
+  $imported = Invoke-Api POST "/projects/$pid1/sources" @{ folder = $sample; site = "ahmadia" }
+  $job = Wait-ApiJob $pid1 $imported.job.id
+  if ($job.state -ne "succeeded") { throw "import failed: $($job.error)" }
+  $stats = Invoke-Api GET "/projects/$pid1/stats"
+  if ($stats.image_count -ne $Frames) { throw "imported $($stats.image_count) images, expected $Frames" }
+  Complete-Step "import"
+  Write-Host "import ok $($stats.image_count) images"
+
+  $model = Invoke-Api POST "/projects/$pid1/models/import" @{ name = "yolo11n-coco"; weights_path = $Weights }
+  Complete-Step "import_model"
+  Write-Host "model ok $($model.name) $($model.class_names.Count) classes"
+
+  # 5. one prediction through the packaged torch/ultralytics stack
+  $images = Invoke-Api GET "/projects/$pid1/images?limit=$Frames&sort=path"
+  $first = $images.items[0]
+  $predicted = Invoke-Api POST "/projects/$pid1/images/$($first.id)/preannotate" `
+    @{ model_id = $model.id; imgsz = $Imgsz; conf = 0.05 }
+  Complete-Step "predict"
+  Write-Host "predict ok $($predicted.items.Count) boxes"
+
+  # 6. a dataset and a 1-epoch run: the `worker` subcommand with DataLoader workers
+  foreach ($image in $images.items) {
+    Invoke-Api POST "/projects/$pid1/images/$($image.id)/boxes" `
+      @{ class_id = $project.classes[0].id; x = 400; y = 600; w = 180; h = 120 } | Out-Null
+  }
+  $dataset = Invoke-Api POST "/projects/$pid1/datasets" `
+    @{ name = "v1"; split_method = "random"; val_fraction = 0.34; seed = 42 }
+  $job = Wait-ApiJob $pid1 $dataset.job.id
+  if ($job.state -ne "succeeded") { throw "dataset failed: $($job.error)" }
+  $frozen = Invoke-Api GET "/projects/$pid1/datasets/$($dataset.dataset.id)"
+  Complete-Step "dataset"
+  Write-Host "dataset ok train $($frozen.train_count) val $($frozen.val_count)"
+
+  $training = Invoke-Api POST "/projects/$pid1/models/train" @{
+    name = "smoke"; dataset_id = $frozen.id; base_model_id = $model.id
+    epochs = 1; imgsz = $Imgsz; batch = 2; patience = 5; augmentation = "aerial"; device = "0"
+  }
+  $job = Wait-ApiJob $pid1 $training.job.id
+  if ($job.state -ne "succeeded") {
+    $log = Invoke-Api GET "/projects/$pid1/jobs/$($training.job.id)/log?tail=40"
+    throw "training failed: $($job.error)`n$($log.lines -join "`n")"
+  }
+  $trained = Invoke-Api GET "/projects/$pid1/models/$($job.result.model_id)"
+  Complete-Step "worker_train"
+  Write-Host "worker ok mAP50 $([math]::Round($trained.metrics.map50, 4))"
+
+  $fontSeeded = Test-Path (Join-Path $env:APP_DATA_DIR "ultralytics\Arial.ttf")
+  if (-not $fontSeeded) { throw "the worker did not seed Arial.ttf into the app data config dir" }
+  Write-Host "font ok $($env:APP_DATA_DIR)\ultralytics\Arial.ttf"
+
+  # 7. ONNX export, again through the frozen worker
+  $export = Invoke-Api POST "/projects/$pid1/models/$($trained.id)/export" @{ format = "onnx"; imgsz = $Imgsz }
+  $job = Wait-ApiJob $pid1 $export.job.id
+  if ($job.state -ne "succeeded") { throw "export failed: $($job.error)" }
+  $trained = Invoke-Api GET "/projects/$pid1/models/$($trained.id)"
+  $onnx = Join-Path $projectFolder $trained.exports.onnx
+  Complete-Step "export_onnx"
+  Write-Host "export ok $onnx $([math]::Round((Get-Item $onnx).Length / 1MB, 1)) MB"
+
+  # 8. keyring: the frozen build has no entry points, so the Windows backend must be pinned.
+  #    A key that is already stored belongs to the operator and is never touched.
+  $providers = (Invoke-Api GET "/providers").items
+  $anthropic = $providers | Where-Object { $_.name -eq "anthropic" }
+  if ($anthropic.has_key) {
+    Write-Host "keyring skip (a key is already stored for anthropic; not touching it)"
+  } else {
+    Invoke-Api PUT "/providers/anthropic/key" @{ api_key = "frozen-smoke-placeholder-not-a-key" } | Out-Null
+    $after = (Invoke-Api GET "/providers").items | Where-Object { $_.name -eq "anthropic" }
+    Invoke-Api DELETE "/providers/anthropic/key" | Out-Null
+    $cleared = (Invoke-Api GET "/providers").items | Where-Object { $_.name -eq "anthropic" }
+    if (-not $after.has_key) { throw "keyring stored nothing: the Windows backend is not in the bundle" }
+    if ($cleared.has_key) { throw "keyring did not delete the placeholder" }
+    Write-Host "keyring ok (stored and removed a placeholder through Credential Manager)"
+  }
+  Complete-Step "keyring"
+
+  $timings["total"] = [math]::Round($total.Elapsed.TotalSeconds, 2)
+  $bytes = (Get-ChildItem $Dist -Recurse -File | Measure-Object -Sum Length).Sum
+  Write-Host ""
+  Write-Host ("bundle: {0:N1} MB at {1}" -f ($bytes / 1MB), $Dist)
+  Write-Host "timings (s): $(($timings.GetEnumerator() | ForEach-Object { "$($_.Key)=$($_.Value)" }) -join ' ')"
+  Write-Host "smoke ok"
+} finally {
+  if (-not $proc.HasExited) {
+    # /T: a training run may still own worker children of our own process tree
+    & taskkill /T /F /PID $proc.Id 2>&1 | Out-Null
+  }
+  Write-Host "work dir: $WorkDir"
+}
diff --git a/backend/tests/test_health.py b/backend/tests/test_health.py
index 29adb77..d7a0937 100644
--- a/backend/tests/test_health.py
+++ b/backend/tests/test_health.py
@@ -1,8 +1,80 @@
+import threading
+import time
+
+from app.health import GpuProbe
+
+
+def answered(probe: GpuProbe, timeout: float = 5.0) -> dict:
+    """Poll the probe until its background thread has an answer."""
+    deadline = time.time() + timeout
+    while time.time() < deadline:
+        value = probe.snapshot()
+        if value is not None:
+            return value
+        time.sleep(0.01)
+    raise AssertionError("the gpu probe never answered")
+
+
 def test_health_ok(client):
     r = client.get("/api/v1/health")
     assert r.status_code == 200
     body = r.json()
     assert body["status"] == "ok"
     assert body["version"]
     assert isinstance(body["pid"], int)
     assert body["started_at"]
+
+
+def test_health_omits_gpu_until_the_probe_answers(app, client):
+    """The first request only starts the probe: health must not wait for the CUDA stack."""
+    blocked = threading.Event()
+    app.state.gpu_probe = GpuProbe(probe=lambda: blocked.wait(5) and {"available": True, "name": "X"})
+    try:
+        assert "gpu" not in client.get("/api/v1/health").json()
+    finally:
+        blocked.set()
+
+
+def test_health_reports_the_gpu_once_the_probe_finishes(app, client):
+    app.state.gpu_probe = GpuProbe(probe=lambda: {"available": True, "name": "NVIDIA Test GPU"})
+    client.get("/api/v1/health")
+    assert answered(app.state.gpu_probe) == {"available": True, "name": "NVIDIA Test GPU"}
+    assert client.get("/api/v1/health").json()["gpu"] == {"available": True, "name": "NVIDIA Test GPU"}
+
+
+def test_gpu_probe_runs_the_probe_once():
+    calls: list[int] = []
+    probe = GpuProbe(probe=lambda: calls.append(1) or {"available": False, "name": None})
+    assert probe.snapshot() is None
+    assert answered(probe) == {"available": False, "name": None}
+    assert probe.snapshot() == {"available": False, "name": None}
+    assert calls == [1]
+
+
+def test_gpu_probe_reports_no_gpu_after_the_timeout_and_still_self_heals():
+    """A probe that outlives the timeout must not hold health back; a late answer still wins."""
+    blocked = threading.Event()
+    now = [0.0]
+    probe = GpuProbe(
+        probe=lambda: blocked.wait(5) and {"available": True, "name": "Late GPU"},
+        timeout_s=10.0,
+        clock=lambda: now[0],
+    )
+    assert probe.snapshot() is None
+    now[0] = 9.9
+    assert probe.snapshot() is None
+    now[0] = 10.0
+    assert probe.snapshot() == {"available": False, "name": None}
+    blocked.set()
+    deadline = time.time() + 5
+    while probe.snapshot() != {"available": True, "name": "Late GPU"} and time.time() < deadline:
+        time.sleep(0.01)
+    assert probe.snapshot() == {"available": True, "name": "Late GPU"}
+
+
+def test_gpu_probe_reports_no_gpu_when_the_probe_raises():
+    def boom() -> dict:
+        raise RuntimeError("no cuda here")
+
+    probe = GpuProbe(probe=boom)
+    assert answered(probe) == {"available": False, "name": None}
diff --git a/backend/tests/test_job_startup.py b/backend/tests/test_job_startup.py
new file mode 100644
index 0000000..e58d78f
--- /dev/null
+++ b/backend/tests/test_job_startup.py
@@ -0,0 +1,85 @@
+"""Orphan job sweep: rows a previous process left behind can never finish (spec section 10)."""
+
+import threading
+import time
+from pathlib import Path
+
+from sqlalchemy import select
+
+from app.db.models import Job
+from app.jobs.registry import register_job_type
+from app.jobs.startup import RESTART_ERROR, sweep_orphans
+from app.projects.service import ProjectRegistry
+
+BLOCKED = threading.Event()
+
+
+@register_job_type("test_sweep_block")
+def _blocking_job(ctx):
+    BLOCKED.wait(10)
+    return {}
+
+
+def add_jobs(handle, *states: str) -> list[str]:
+    """Rows as a killed process would leave them: no runner context anywhere."""
+    ids = []
+    with handle.session() as s:
+        for i, state in enumerate(states):
+            job = Job(type="train", state=state, params={}, log_path=f"runs/{i}/job.log")
+            s.add(job)
+            s.flush()
+            ids.append(job.id)
+    return ids
+
+
+def states(handle) -> dict[str, str]:
+    with handle.session() as s:
+        return {j.id: j.state for j in s.execute(select(Job)).scalars()}
+
+
+def test_running_jobs_fail_and_queued_jobs_are_cancelled(handle, app):
+    running, queued, done = add_jobs(handle, "running", "queued", "succeeded")
+
+    swept = sweep_orphans(handle, app.state.jobs)
+
+    assert {j["id"]: j["state"] for j in swept} == {running: "failed", queued: "cancelled"}
+    assert states(handle) == {running: "failed", queued: "cancelled", done: "succeeded"}
+    with handle.session() as s:
+        row = s.get(Job, running)
+        assert row.error == RESTART_ERROR
+        assert row.finished_at is not None
+        assert s.get(Job, queued).error is None
+
+
+def test_jobs_of_this_process_are_left_alone(handle, app):
+    """Reopening a project while its own jobs run must not kill them."""
+    orphan = add_jobs(handle, "running")[0]
+    BLOCKED.clear()
+    live = app.state.jobs.submit(handle, "test_sweep_block", {})
+    try:
+        deadline = time.time() + 5
+        while states(handle).get(live.id) != "running" and time.time() < deadline:
+            time.sleep(0.02)
+
+        swept = sweep_orphans(handle, app.state.jobs)
+
+        assert [j["id"] for j in swept] == [orphan]
+        assert states(handle)[live.id] == "running"
+    finally:
+        BLOCKED.set()
+
+
+def test_nothing_to_sweep_is_a_no_op(handle, app):
+    add_jobs(handle, "succeeded", "failed", "cancelled")
+    assert sweep_orphans(handle, app.state.jobs) == []
+
+
+def test_opening_a_project_in_a_fresh_registry_sweeps_it(handle, app, tmp_path: Path):
+    """The sweep runs where a project becomes live: projects open lazily, one at a time."""
+    running, queued = add_jobs(handle, "running", "queued")
+    registry = ProjectRegistry(tmp_path / "other-appdata", on_open=lambda h: sweep_orphans(h, app.state.jobs))
+
+    reopened = registry.open(handle.folder)
+
+    assert states(reopened) == {running: "failed", queued: "cancelled"}
+    registry.close_all()
diff --git a/backend/tests/test_ultralytics_env.py b/backend/tests/test_ultralytics_env.py
new file mode 100644
index 0000000..451bb5b
--- /dev/null
+++ b/backend/tests/test_ultralytics_env.py
@@ -0,0 +1,76 @@
+"""The packaged app has to train offline, so Ultralytics' Arial.ttf is seeded, never downloaded."""
+
+import os
+from pathlib import Path
+
+from app.training import fonts, worker
+
+
+def test_ensure_font_copies_the_first_candidate_that_exists(tmp_path: Path, monkeypatch):
+    source = tmp_path / "somewhere" / "arial.ttf"
+    source.parent.mkdir()
+    source.write_bytes(b"ttf-bytes")
+    monkeypatch.setattr(fonts, "font_candidates", lambda: [tmp_path / "missing.ttf", source])
+
+    seeded = fonts.ensure_font(tmp_path / "cfg")
+
+    assert seeded == tmp_path / "cfg" / "Arial.ttf"
+    assert seeded.read_bytes() == b"ttf-bytes"
+
+
+def test_ensure_font_keeps_a_font_that_is_already_there(tmp_path: Path, monkeypatch):
+    config_dir = tmp_path / "cfg"
+    config_dir.mkdir()
+    (config_dir / "Arial.ttf").write_bytes(b"mine")
+    monkeypatch.setattr(fonts, "font_candidates", lambda: [])
+
+    assert fonts.ensure_font(config_dir).read_bytes() == b"mine"
+
+
+def test_ensure_font_gives_up_quietly_when_no_font_is_installed(tmp_path: Path, monkeypatch):
+    monkeypatch.setattr(fonts, "font_candidates", lambda: [tmp_path / "nope.ttf"])
+    assert fonts.ensure_font(tmp_path / "cfg") is None
+
+
+def test_this_machine_has_a_font_candidate():
+    """The real candidate list has to resolve on the reference machine, frozen or not."""
+    assert any(c.is_file() for c in fonts.font_candidates()), fonts.font_candidates()
+
+
+def test_configure_ultralytics_points_the_config_dir_at_app_data(tmp_path: Path, monkeypatch):
+    monkeypatch.delenv("YOLO_CONFIG_DIR", raising=False)
+
+    config_dir = fonts.configure_ultralytics(tmp_path / "appdata")
+
+    assert config_dir == tmp_path / "appdata" / "ultralytics"
+    assert os.environ["YOLO_CONFIG_DIR"] == str(config_dir)
+    assert (config_dir / "Arial.ttf").is_file()
+
+
+def test_configure_ultralytics_honours_a_config_dir_the_launcher_already_chose(tmp_path: Path, monkeypatch):
+    monkeypatch.setenv("YOLO_CONFIG_DIR", str(tmp_path / "chosen"))
+    assert fonts.configure_ultralytics(tmp_path / "appdata") == tmp_path / "chosen"
+
+
+def test_configure_ultralytics_falls_back_to_app_data_dir_from_the_environment(tmp_path: Path, monkeypatch):
+    monkeypatch.delenv("YOLO_CONFIG_DIR", raising=False)
+    monkeypatch.setenv("APP_DATA_DIR", str(tmp_path / "inherited"))
+    assert fonts.configure_ultralytics() == tmp_path / "inherited" / "ultralytics"
+
+
+def test_configure_ultralytics_is_a_no_op_without_anywhere_to_put_it(monkeypatch):
+    monkeypatch.delenv("YOLO_CONFIG_DIR", raising=False)
+    monkeypatch.delenv("APP_DATA_DIR", raising=False)
+    assert fonts.configure_ultralytics() is None
+
+
+def test_the_worker_seeds_the_font_before_it_does_anything_else(tmp_path: Path, monkeypatch):
+    """The worker's setup step runs even when the run itself cannot start."""
+    monkeypatch.delenv("YOLO_CONFIG_DIR", raising=False)
+    monkeypatch.setenv("APP_DATA_DIR", str(tmp_path / "appdata"))
+    run_dir = tmp_path / "run"
+    run_dir.mkdir()
+
+    assert worker.main(["train", str(run_dir / "params.json")]) == 1  # no params file: setup still ran
+
+    assert (tmp_path / "appdata" / "ultralytics" / "Arial.ttf").is_file()
diff --git a/docs/progress.md b/docs/progress.md
index 1ed9e59..ab8a7d9 100644
--- a/docs/progress.md
+++ b/docs/progress.md
@@ -138,20 +138,57 @@ WebView2 over CDP and drove the UI.
 | Restart respawns a new sidecar (new pid) and the UI recovers | `checkpoint1-04-after-restart.png` |
 | Closing the window terminates the sidecar and the dev server (no leftover processes, ports 1420/9222 free) | PowerShell check in the session log |
 | Mock server serves the contract (`pnpm mock`, 200 with token, 401 without) | S0 Task 2 verification |
 
 Suites on main 389687c: backend 97 passed + ruff clean; contract `pnpm check` clean; frontend lint, 7 unit tests, build, 1 e2e passed.
 
 Found and fixed during the checkpoint: the WebView2 origin's CORS preflight was answered 405 (Prism had masked it); CORS is now
 restricted to `tauri.localhost` and the Vite origin (`Settings.cors_origins`). Cold-start timing is measured against the
 installed app in S6 (dev mode includes the cargo build).
 
+## S6 packaging evidence (reference machine, 2026-09-18)
+
+Measured, not estimated. Reference machine: Windows 11 Pro 26200, RTX 5070 Ti, torch 2.14.0+cu130,
+ultralytics 8.4.154, PyInstaller 6.22.3, Tauri CLI 2.11.4.
+
+| Step | Command | Result |
+|---|---|---|
+| Freeze the backend | `backend\scripts\build.ps1` | 127 s; `dist/machinery-backend` 3,457.8 MB in 14,113 files |
+| Frozen smoke test | `backend\scripts\smoke_frozen.ps1` | pass in 23.8 s: health 0.57 s, `cuda True NVIDIA GeForce RTX 5070 Ti` 3.8 s, predict, 1-epoch worker train 11.0 s, ONNX export 3.2 s, keyring round trip |
+| App binary | `pnpm tauri build` (cargo release) | 65 s; `machinery-app.exe` 11.1 MB |
+| Install tree that the installer would write | - | 3,468.9 MB (app 11.1 MB + sidecar exe and `_internal` 3,457.8 MB), well under the 6 GB success criterion |
+| NSIS installer | `pnpm tauri build` | **fails**: `makensis` `Internal compiler error #12345: error mmapping file (2057025505, 33554432) is out of range` |
+| MSI installer | `pnpm tauri build --bundles msi` | **fails**: `light.exe : error LGHT0001 : Catastrophic failure ... at Microsoft.Tools.WindowsInstallerXml.Cab.Interop.NativeMethods.CreateCabFinish` |
+
+Both failures are the same 2 GB wall, reached from two directions: an NSIS installer addresses its
+payload with 32-bit offsets, and Tauri's WiX template puts everything in one embedded cabinet
+(`<Media Id="1" Cabinet="app.cab" EmbedCab="yes" />`), which the cabinet format caps at 2 GB. The
+payload cannot be brought under 2 GB by trimming: `torch/lib` alone is 2.78 GB and its large CUDA
+DLLs (`cublasLt` 456 MB, `torch_cuda` 404 MB, `cufft` 272 MB, `cudnn_engines_precompiled` 212 MB,
+`cusparse` 144 MB, `cusolver` 121 MB) are imported by name from `torch_cuda.dll`; dropping
+`cufft`/`cusolver`/`cusparse` was tried and `torch.cuda.is_available()` went false (the frozen
+smoke test caught it). Only about 205 MB is genuinely unreferenced (`cusolverMg`,
+`nvrtc64_130_0.alt`, `nvperf_host`).
+
+Open decision for the goal owner (spec 10 says NSIS; checkpoint 4 and the acceptance run wait on it):
+
+1. Custom WiX template (`bundle.windows.wix.template`) using `<MediaTemplate EmbedCab="yes"
+   MaximumUncompressedMediaSize="..."/>`, which splits the payload over several cabinets. Smallest
+   change that keeps a single-file installer; changes the format from NSIS to MSI.
+2. A third-party installer that supports large payloads (Inno Setup 6 handles >2 GB), built outside
+   the Tauri bundler from `target/release` plus `src-tauri/binaries`.
+3. Ship the app and the sidecar payload separately (a small installer plus a downloaded or
+   side-loaded `_internal`), or distribute a portable folder.
+
+Everything downstream of the installer (install, cold start under 15 s, checkpoint 4, the
+acceptance run on the installed app) is blocked until this is chosen.
+
 ## S0 status detail
 
 | Task | Owner | State | Commit |
 |---|---|---|---|
 | 1 skeleton | goal owner | done | c5b5722 |
 | 2 contract + mock | goal owner | done, mock verified | 4d71fcd |
 | 3 TS client | goal owner | done | 4d71fcd |
 | 4 backend shell | goal owner | done | 715e772 (s0-backend) |
 | 5 DB + projects | goal owner | done | f74ba9a |
 | 6 jobs + events | goal owner | done | ebe00de |
@@ -174,10 +211,11 @@ SDD ledger (rulings, deferred minors): `.superpowers/sdd/2026-09-17-s0-contract-
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
+- 2026-09-18: S6 tasks 1, 2, 4 and 5 done on `s6-packaging-acceptance`: full CUDA PyInstaller bundle with a frozen smoke test, packaging hardening (orphan sweep, Arial pre-seed, sidecar log tee, CSP), the acceptance script and its CDP driver (dry-run green on 20 frames), and the README. Task 3 is blocked: neither Tauri bundler can package the 3.4 GB sidecar (see S6 packaging evidence above).
diff --git a/frontend/scripts/acceptance.mjs b/frontend/scripts/acceptance.mjs
new file mode 100644
index 0000000..02b93ae
--- /dev/null
+++ b/frontend/scripts/acceptance.mjs
@@ -0,0 +1,523 @@
+// Acceptance run (spec 13.5), steps 1-8, driven through the app's own UI over CDP.
+//
+// Attaches to a running app (installed or `pnpm tauri dev`) started with
+// WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=--remote-debugging-port=9222, performs the eight steps
+// with real UI actions and asserts the results through the API reached via `backend_info`.
+// Screenshots and a JSON summary land in the evidence folder. `scripts/acceptance.md` is the
+// prose version of the same run and the source of truth for what passing means.
+//
+// Usage:
+//   node scripts/acceptance.mjs --project-folder E:\tmp\acceptance [--evidence docs\evidence\acceptance]
+// Every expected value is a flag, so the script can be dry-run on a small copy of the frames:
+//   node scripts/acceptance.mjs --project-folder E:\tmp\dry --source E:\tmp\frames20 \
+//     --expect-images 20 --expect-flights 0031 --label-count 5 --epochs 1 --imgsz 640 \
+//     --preannotate-images 3 --query-images 5 --cloud-images 2
+import { chromium } from "@playwright/test";
+import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
+import { join } from "node:path";
+
+const argv = process.argv.slice(2);
+const flag = (name, fallback) => {
+  const i = argv.indexOf(`--${name}`);
+  return i >= 0 && argv[i + 1] !== undefined ? argv[i + 1] : fallback;
+};
+const number = (name, fallback) => Number(flag(name, String(fallback)));
+
+const cfg = {
+  projectFolder: flag("project-folder"),
+  evidence: flag("evidence", "docs/evidence/acceptance"),
+  projectName: flag("project-name", "Ahmadia"),
+  source: flag("source", "E:\\Dev\\Yolo\\Ahmadia Construction Data"),
+  site: flag("site", "ahmadia"),
+  preannotateWeights: flag("preannotate-weights", "E:\\Dev\\Yolo\\models\\yolo11m.pt"),
+  baseWeights: flag("base-weights", "E:\\Dev\\Yolo\\models\\yolo11n.pt"),
+  expectImages: number("expect-images", 3299),
+  expectDuplicates: number("expect-duplicates", 0),
+  expectFlights: flag("expect-flights", "0031,0033,0034,0035,0038,0040,0042").split(",").filter(Boolean),
+  preannotateImages: number("preannotate-images", 10),
+  // Spec 13.5 step 3 expects proposals on at least one of the opened images; a dry run over a
+  // handful of frames may legitimately see none, so the bar is a flag.
+  minProposals: number("min-proposals", 1),
+  labelCount: number("label-count", 30),
+  epochs: number("epochs", 3),
+  imgsz: number("imgsz", 1280),
+  batch: number("batch", 4),
+  queryImages: number("query-images", 50),
+  cloudImages: number("cloud-images", 5),
+  conf: flag("conf", "0.25"),
+  importTimeoutMin: number("import-timeout-min", 60),
+  // Resume a run whose project already exists (the 3299-frame import takes a while).
+  projectId: flag("project-id", ""),
+};
+if (!cfg.projectFolder) {
+  throw new Error("usage: acceptance.mjs --project-folder <folder> [--evidence <dir>] [see the header]");
+}
+mkdirSync(cfg.evidence, { recursive: true });
+
+const CLASSES = 8;
+const result = { project_id: null, steps: [], skipped: [], config: cfg };
+const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
+
+function step(name, ok, detail = "", extra = {}) {
+  result.steps.push({ name, ok, detail, ...extra });
+  console.log(`${ok ? "PASS" : "FAIL"} ${name} ${detail}`);
+  if (!ok) throw new Error(`step failed: ${name}`);
+}
+
+const shot = (page, name) => page.screenshot({ path: join(cfg.evidence, `acceptance-${name}.png`) });
+
+/** The webview of the running app: `127.0.0.1:1420` in dev, `tauri.localhost` when installed. */
+async function connect() {
+  for (let i = 0; i < 180; i++) {
+    try {
+      const browser = await chromium.connectOverCDP("http://127.0.0.1:9222", { timeout: 2000 });
+      const page = browser
+        .contexts()
+        .flatMap((c) => c.pages())
+        .find((p) => p.url().includes("127.0.0.1:1420") || p.url().includes("tauri.localhost"));
+      if (page) return { browser, page };
+      await browser.close();
+    } catch {
+      /* the app is not up yet */
+    }
+    await sleep(1000);
+  }
+  throw new Error("could not attach to the app webview on port 9222");
+}
+
+const { browser, page } = await connect();
+const info = await page.evaluate(() => window.__TAURI_INTERNALS__.invoke("backend_info"));
+
+const api = async (method, path, body) => {
+  const r = await fetch(`${info.base_url}/api/v1${path}`, {
+    method,
+    headers: { Authorization: `Bearer ${info.token}`, "Content-Type": "application/json" },
+    body: body ? JSON.stringify(body) : undefined,
+  });
+  const text = await r.text();
+  if (!r.ok) throw new Error(`${method} ${path} -> ${r.status} ${text.slice(0, 300)}`);
+  return text ? JSON.parse(text) : {};
+};
+
+/**
+ * Router navigation without a page load: the installed app is served from `tauri.localhost`,
+ * where a deep URL is not a file the asset protocol can serve.
+ */
+async function go(path) {
+  await page.evaluate((to) => {
+    window.history.pushState({}, "", to);
+    window.dispatchEvent(new PopStateEvent("popstate"));
+  }, path);
+}
+
+/** The sidebar link, which is how a person moves between screens. */
+async function openScreen(label, heading) {
+  await page.getByRole("link", { name: label, exact: true }).click();
+  await page.getByRole("heading", { name: heading, exact: true }).waitFor({ timeout: 60_000 });
+}
+
+/** Poll a job to a terminal state, collecting the distinct progress messages seen on the way. */
+async function waitJob(projectId, jobId, timeoutMs = 3_600_000) {
+  const t0 = Date.now();
+  const progress = [];
+  while (Date.now() - t0 < timeoutMs) {
+    const job = await api("GET", `/projects/${projectId}/jobs/${jobId}`);
+    const line = `${job.progress.toFixed(2)} ${job.message}`;
+    if (progress[progress.length - 1] !== line) progress.push(line);
+    if (["succeeded", "failed", "cancelled"].includes(job.state)) return { ...job, progress };
+    await sleep(1000);
+  }
+  throw new Error(`job ${jobId} timed out`);
+}
+
+/**
+ * Open one image in the editor and wait until the canvas can take a drag.
+ *
+ * `data-view-scale` alone is not enough: it starts at the store's default 1 and only becomes the
+ * fitted scale once the image record has arrived, so it reads "loaded" the instant the route
+ * changes. `data-image` is set from the image record and the Konva stage only mounts once the
+ * viewport is measured, so both together mean the background node exists.
+ */
+async function openEditor(projectId, imageId) {
+  await go(`/p/${projectId}/edit/${imageId}`);
+  await page.waitForFunction(
+    () => {
+      const el = document.querySelector('[data-testid="editor-canvas"]');
+      return Boolean(el?.getAttribute("data-image")) && el.querySelectorAll("canvas").length > 0;
+    },
+    null,
+    { timeout: 180_000 },
+  );
+}
+
+const regionCount = () =>
+  page.evaluate(() => document.querySelectorAll('[aria-label="Regions"] [role="listitem"]').length);
+
+/**
+ * One box drawn with the mouse, offset so repeated runs do not stack boxes on one spot.
+ *
+ * Pre-annotation runs on open and the full-size frame is still downloading behind the canvas, so
+ * the first drag can land before the stage takes pointer events; the drag is repeated until a new
+ * region shows up.
+ */
+async function drawBox(index, attempts = 3) {
+  const canvas = page.getByTestId("editor-canvas");
+  for (let attempt = 1; attempt <= attempts; attempt++) {
+    const box = await canvas.boundingBox();
+    const before = await regionCount();
+    await page.keyboard.press("1");
+    const x = box.x + box.width * (0.3 + 0.01 * (index % 10));
+    const y = box.y + box.height * (0.3 + 0.01 * (index % 10));
+    await page.mouse.move(x, y);
+    await page.mouse.down();
+    await page.mouse.move(x + 140, y + 90, { steps: 8 });
+    await page.mouse.up();
+    try {
+      await page.waitForFunction(
+        (n) => document.querySelectorAll('[aria-label="Regions"] [role="listitem"]').length > n,
+        before,
+        { timeout: 15_000 },
+      );
+      return;
+    } catch (e) {
+      if (attempt === attempts) throw e;
+      console.log(`  retrying the box on image ${index} (attempt ${attempt} drew nothing)`);
+      await sleep(1000);
+    }
+  }
+}
+
+/** Tick `count` rows of the image table, scrolling each into view first. */
+async function selectRows(items, count) {
+  for (const image of items.slice(0, count)) {
+    const cb = page.getByLabel(`Select ${image.file_name}`);
+    await cb.scrollIntoViewIfNeeded();
+    await cb.check();
+  }
+  await page.getByText(`${count} selected`).waitFor({ timeout: 15_000 });
+}
+
+async function importWeights(name, path) {
+  await page.getByRole("button", { name: "Import weights" }).click();
+  await page.getByLabel("Model name").fill(name);
+  await page.getByLabel("Weights path").fill(path);
+  await page.getByRole("button", { name: "Import", exact: true }).click();
+  await page.getByTestId("model-detail").waitFor({ timeout: 300_000 });
+}
+
+// Start from the Projects screen wherever the app was left (a resumed run reattaches to a
+// window that is still on a project screen).
+await go("/");
+await page.getByRole("heading", { name: "Projects" }).waitFor({ timeout: 120_000 });
+
+const timer = () => {
+  const t0 = Date.now();
+  return () => Math.round((Date.now() - t0) / 100) / 10;
+};
+
+// ---------------------------------------------------------------- 1. project
+let projectId = cfg.projectId;
+let elapsed = timer();
+if (projectId) {
+  await go(`/p/${projectId}/data`);
+  step("1. resume on an existing project", true, projectId);
+} else {
+  await page.fill("#project-name", cfg.projectName);
+  await page.fill("#project-folder", cfg.projectFolder);
+  await page.getByRole("button", { name: "Create project" }).click();
+  await page.waitForURL(/\/p\/[0-9a-f-]+\/data/, { timeout: 60_000 });
+  projectId = page.url().split("/p/")[1].split("/")[0];
+  const project = await api("GET", `/projects/${projectId}`);
+  await shot(page, "01-project");
+  step(
+    "1. create project with the eight classes",
+    project.name === cfg.projectName && project.classes.length === CLASSES,
+    `${projectId} classes ${project.classes.map((c) => c.name).join(",")}`,
+    { seconds: elapsed() },
+  );
+}
+result.project_id = projectId;
+
+// ----------------------------------------------------------------- 2. import
+elapsed = timer();
+let stats = await api("GET", `/projects/${projectId}/stats`);
+if (stats.image_count === 0) {
+  await page.getByRole("button", { name: "Import images" }).click();
+  const dialog = page.getByRole("dialog", { name: "Import images" });
+  await dialog.waitFor({ timeout: 15_000 });
+  await dialog.getByLabel("Folder").fill(cfg.source);
+  await dialog.getByLabel("Site name").fill(cfg.site);
+  await dialog.getByRole("button", { name: "Start import" }).click();
+  await page.getByRole("dialog", { name: "Jobs" }).waitFor({ timeout: 30_000 });
+  const jobs = await api("GET", `/projects/${projectId}/jobs?type=import`);
+  const job = await waitJob(projectId, jobs.items[0].id, cfg.importTimeoutMin * 60_000);
+  if (job.state !== "succeeded") throw new Error(`import failed: ${job.error}`);
+  await page.keyboard.press("Escape");
+  stats = await api("GET", `/projects/${projectId}/stats`);
+}
+await page.getByTestId("image-grid").waitFor({ timeout: 60_000 });
+await shot(page, "02-import");
+const flights = stats.groups.map((g) => g.group_key).sort();
+step(
+  "2. import the source folder",
+  stats.image_count === cfg.expectImages &&
+    stats.duplicate_count === cfg.expectDuplicates &&
+    flights.length === cfg.expectFlights.length &&
+    cfg.expectFlights.every((f) => flights.some((k) => k.includes(f))),
+  `images ${stats.image_count} duplicates ${stats.duplicate_count} flights ${flights.join(",")}`,
+  { seconds: elapsed(), image_count: stats.image_count, flights },
+);
+
+// ------------------------------------------------- 3. pre-annotation model
+elapsed = timer();
+await openScreen("Models", "Models");
+let models = await api("GET", `/projects/${projectId}/models`);
+let preModel = models.items.find((m) => m.name === "yolo11m-coco");
+if (!preModel) {
+  await importWeights("yolo11m-coco", cfg.preannotateWeights);
+  await page.getByRole("button", { name: "Use as pre-annotation model" }).click();
+  await sleep(1500);
+  preModel = (await api("GET", `/projects/${projectId}/models`)).items.find((m) => m.name === "yolo11m-coco");
+}
+const projectAfterModel = await api("GET", `/projects/${projectId}`);
+const page1 = await api("GET", `/projects/${projectId}/images?limit=${cfg.labelCount}&sort=path`);
+let proposals = 0;
+for (const image of page1.items.slice(0, cfg.preannotateImages)) {
+  await openEditor(projectId, image.id);
+  await sleep(500);
+  const boxes = await api("GET", `/projects/${projectId}/images/${image.id}/boxes`);
+  proposals += boxes.items.filter((b) => b.provenance.kind === "local_model").length;
+}
+await shot(page, "03-preannotation");
+step(
+  "3. pre-annotation model proposes on at least one of the opened images",
+  preModel !== undefined &&
+    projectAfterModel.preannotation_model_id === preModel.id &&
+    proposals >= cfg.minProposals,
+  `${preModel?.name} (${preModel?.class_names.length} classes), ${proposals} local_model proposals over ${cfg.preannotateImages} images`,
+  { seconds: elapsed(), proposals },
+);
+
+// -------------------------------------------------- 4. label and cut dataset
+elapsed = timer();
+stats = await api("GET", `/projects/${projectId}/stats`);
+if (stats.labeled_count < cfg.labelCount) {
+  for (const [i, image] of page1.items.slice(0, cfg.labelCount).entries()) {
+    await openEditor(projectId, image.id);
+    await drawBox(i);
+    await sleep(200);
+  }
+  stats = await api("GET", `/projects/${projectId}/stats`);
+}
+let datasets = await api("GET", `/projects/${projectId}/datasets`);
+if (datasets.items.length === 0) {
+  await openScreen("Data", "Data Manager");
+  await page.getByLabel("Labeled").selectOption("yes");
+  await page.getByRole("button", { name: "List" }).click();
+  await page.getByTestId("image-table").waitFor({ timeout: 60_000 });
+  const labeled = await api("GET", `/projects/${projectId}/images?labeled=true&limit=200&sort=path`);
+  await selectRows(labeled.items, cfg.labelCount);
+  await page.getByRole("button", { name: "Add to dataset" }).click();
+  const dialog = page.getByRole("dialog", { name: "Add to dataset" });
+  await dialog.waitFor({ timeout: 15_000 });
+  await dialog.getByLabel("Dataset name").fill("v1");
+  await dialog.getByRole("button", { name: "Create dataset" }).click();
+  await page.getByTestId(/^job-/).first().waitFor({ timeout: 30_000 });
+  const jobs = await api("GET", `/projects/${projectId}/jobs?type=dataset`);
+  const job = await waitJob(projectId, jobs.items[0].id);
+  if (job.state !== "succeeded") throw new Error(`dataset failed: ${job.error}`);
+  datasets = await api("GET", `/projects/${projectId}/datasets`);
+}
+const dataset = datasets.items[0];
+const datasetDir = join(cfg.projectFolder, dataset.path);
+const dataYaml = join(datasetDir, "data.yaml");
+const yamlText = existsSync(dataYaml) ? readFileSync(dataYaml, "utf8") : "";
+writeFileSync(join(cfg.evidence, "acceptance-04-data-yaml.txt"), yamlText);
+const folders = ["images/train", "images/val", "labels/train", "labels/val"];
+await shot(page, "04-dataset");
+step(
+  "4. label images and freeze dataset v1 by group",
+  stats.labeled_count >= cfg.labelCount &&
+    dataset.name === "v1" &&
+    dataset.train_count > 0 &&
+    dataset.val_count > 0 &&
+    dataset.train_count + dataset.val_count === cfg.labelCount &&
+    folders.every((f) => existsSync(join(datasetDir, f))) &&
+    /(^|\n)train:/.test(yamlText) &&
+    /(^|\n)val:/.test(yamlText),
+  `labeled ${stats.labeled_count}, train ${dataset.train_count} val ${dataset.val_count}, split ${dataset.split_method}`,
+  { seconds: elapsed(), data_yaml: dataYaml },
+);
+
+// ------------------------------------------------------------------ 5. train
+elapsed = timer();
+await openScreen("Models", "Models");
+models = await api("GET", `/projects/${projectId}/models`);
+let baseModel = models.items.find((m) => m.name === "yolo11n-coco");
+if (!baseModel) {
+  await importWeights("yolo11n-coco", cfg.baseWeights);
+  baseModel = (await api("GET", `/projects/${projectId}/models`)).items.find(
+    (m) => m.name === "yolo11n-coco",
+  );
+}
+let trained = models.items.find((m) => m.name === "ahmadia-v1");
+let trainJob = null;
+if (!trained) {
+  await openScreen("Train", "Train");
+  await page
+    .getByLabel("Dataset", { exact: true })
+    .locator("option", { hasText: "v1" })
+    .waitFor({ state: "attached", timeout: 60_000 });
+  await page
+    .getByLabel("Base model", { exact: true })
+    .locator("option", { hasText: "yolo11n-coco" })
+    .waitFor({ state: "attached", timeout: 60_000 });
+  await sleep(500);
+  await page.getByLabel("Base model", { exact: true }).selectOption({ label: "yolo11n-coco (Imported)" });
+  await page.getByLabel("Model name").fill("ahmadia-v1");
+  await page.getByLabel("Epochs").fill(String(cfg.epochs));
+  await page.getByLabel("Image size").fill(String(cfg.imgsz));
+  await page.getByLabel("Automatic batch size").uncheck();
+  await page.getByLabel("Batch size", { exact: true }).fill(String(cfg.batch));
+  await page.getByRole("button", { name: "Start training" }).click();
+  await page.getByTestId("train-progress").waitFor({ timeout: 60_000 });
+  await page.waitForURL(/\?job=/, { timeout: 60_000 });
+  trainJob = await waitJob(projectId, new URL(page.url()).searchParams.get("job"));
+  if (trainJob.state !== "succeeded") throw new Error(`training failed: ${trainJob.error}`);
+  trained = await api("GET", `/projects/${projectId}/models/${trainJob.result.model_id}`);
+}
+const epochText = await page
+  .getByTestId("epoch")
+  .innerText()
+  .catch(() => "");
+await shot(page, "05-training");
+step(
+  "5. train for the requested epochs and register the model",
+  trained.kind === "trained" &&
+    Boolean(trained.metrics) &&
+    // Progress has to arrive and move: the poll sees the queued/running line and then at least
+    // one epoch line. How many more depends on the epoch count and the poll interval.
+    (trainJob === null || (trainJob.state === "succeeded" && trainJob.progress.length >= 2)),
+  `model ${trained.name} mAP50 ${trained.metrics?.map50?.toFixed(4)} epoch card "${epochText.replace(/\s+/g, " ")}" progress updates ${trainJob?.progress.length ?? "resumed"}`,
+  { seconds: elapsed(), metrics: trained.metrics, progress: trainJob?.progress ?? [] },
+);
+
+// -------------------------------------------- 6. query run, review, promote
+elapsed = timer();
+await openScreen("Data", "Data Manager");
+await page.getByLabel("Labeled").selectOption("no");
+await page.getByRole("button", { name: "List" }).click();
+await page.getByTestId("image-table").waitFor({ timeout: 60_000 });
+const unlabeled = await api(
+  "GET",
+  `/projects/${projectId}/images?labeled=false&limit=${cfg.queryImages}&sort=path`,
+);
+await selectRows(unlabeled.items, cfg.queryImages);
+await page.getByRole("button", { name: "Run model" }).click();
+await page.getByRole("heading", { name: "Query", exact: true }).waitFor({ timeout: 60_000 });
+await page
+  .getByLabel("Model", { exact: true })
+  .locator("option", { hasText: trained.name })
+  .waitFor({ state: "attached", timeout: 60_000 });
+await page.getByLabel("Model", { exact: true }).selectOption({ label: `${trained.name} (Trained)` });
+await page.getByLabel("Confidence", { exact: true }).fill(cfg.conf);
+await page.getByRole("button", { name: "Estimate" }).click();
+await page.getByTestId("estimate").waitFor({ timeout: 30_000 });
+await page.getByRole("button", { name: "Start" }).click();
+await page.waitForURL(/\?run=/, { timeout: 60_000 });
+const runId = new URL(page.url()).searchParams.get("run");
+let run = await api("GET", `/projects/${projectId}/query-runs/${runId}`);
+const inferJob = await waitJob(projectId, run.job_id);
+if (inferJob.state !== "succeeded") throw new Error(`query run failed: ${inferJob.error}`);
+run = await api("GET", `/projects/${projectId}/query-runs/${runId}`);
+await sleep(2000);
+await shot(page, "06-query-run");
+await page.getByRole("link", { name: "Review results" }).click();
+await page.getByRole("heading", { name: "Review queue" }).waitFor({ timeout: 60_000 });
+await shot(page, "06-review");
+await page.goBack();
+await page.getByTestId("run-card").waitFor({ timeout: 60_000 });
+await page.getByLabel("Minimum confidence").fill("0");
+await page.getByRole("button", { name: "Promote" }).click();
+await sleep(2500);
+run = await api("GET", `/projects/${projectId}/query-runs/${runId}`);
+await shot(page, "06-promoted");
+step(
+  "6. run the trained model over unlabeled images, review and promote",
+  run.image_ids.length === cfg.queryImages && Boolean(run.promoted_at),
+  `${run.image_ids.length} images, ${run.box_count} boxes, promoted_at ${run.promoted_at}`,
+  { seconds: elapsed(), box_count: run.box_count },
+);
+
+// ------------------------------------------------- 7. anthropic vision query
+elapsed = timer();
+const key = process.env.ANTHROPIC_API_KEY;
+if (key) {
+  // The key only ever travels from the environment into Credential Manager and back out again.
+  await api("PUT", "/providers/anthropic/key", { api_key: key });
+  try {
+    await openScreen("Query", "Query");
+    await page
+      .getByRole("button", { name: "New query" })
+      .click({ timeout: 3000 })
+      .catch(() => {}); // only there when a run is open
+    await page.getByLabel("Cloud provider").check();
+    await page.getByLabel("Query", { exact: true }).fill("dump trucks");
+    await page.getByLabel("Images", { exact: true }).selectOption({ label: "First N images" });
+    await page.getByLabel("Number of images").fill(String(cfg.cloudImages));
+    await page.getByLabel("Tiling").check();
+    await page.getByRole("button", { name: "Estimate" }).click();
+    await page.getByTestId("estimate").waitFor({ timeout: 30_000 });
+    await page.getByRole("button", { name: "Start" }).click();
+    await page.waitForURL(/\?run=/, { timeout: 60_000 });
+    const cloudRunId = new URL(page.url()).searchParams.get("run");
+    let cloud = await api("GET", `/projects/${projectId}/query-runs/${cloudRunId}`);
+    const cloudJob = await waitJob(projectId, cloud.job_id);
+    if (cloudJob.state !== "succeeded") throw new Error(`anthropic run failed: ${cloudJob.error}`);
+    cloud = await api("GET", `/projects/${projectId}/query-runs/${cloudRunId}`);
+    const boxes = await api(
+      "GET",
+      `/projects/${projectId}/images/${cloud.image_ids[0]}/boxes`,
+    );
+    const provided = boxes.items.filter((b) => b.provenance.kind === "cloud_provider");
+    await sleep(1500);
+    await shot(page, "07-cloud-run");
+    step(
+      "7. anthropic vision query with tiling",
+      cloud.image_ids.length === cfg.cloudImages && cloud.tiling.enabled,
+      `${cloud.box_count} boxes, tiling ${cloud.tiling.tile_size}px, provenance on the first image: ${JSON.stringify(provided[0]?.provenance ?? null)}`,
+      { seconds: elapsed(), box_count: cloud.box_count },
+    );
+  } finally {
+    await api("DELETE", "/providers/anthropic/key");
+  }
+} else {
+  result.skipped.push("7. anthropic vision query: ANTHROPIC_API_KEY is not set in the environment");
+  console.log("SKIP 7. anthropic vision query (no ANTHROPIC_API_KEY)");
+}
+
+// ------------------------------------------------------------- 8. onnx export
+elapsed = timer();
+await openScreen("Models", "Models");
+await page.getByRole("button", { name: `Select model ${trained.name}` }).click();
+await page.getByTestId("model-detail").waitFor({ timeout: 60_000 });
+await page.getByRole("button", { name: "Export ONNX" }).click();
+await page.getByTestId(/^job-/).first().waitFor({ timeout: 30_000 });
+const exportJobs = await api("GET", `/projects/${projectId}/jobs?type=export`);
+const exportJob = await waitJob(projectId, exportJobs.items[0].id);
+if (exportJob.state !== "succeeded") throw new Error(`export failed: ${exportJob.error}`);
+const exported = await api("GET", `/projects/${projectId}/models/${trained.id}`);
+const onnx = join(cfg.projectFolder, exported.exports.onnx ?? "");
+await sleep(1000);
+await shot(page, "08-export");
+step(
+  "8. export the trained model to ONNX",
+  Boolean(exported.exports?.onnx) && existsSync(onnx) && exported.exports.onnx.startsWith("models/"),
+  `${exported.exports?.onnx}`,
+  { seconds: elapsed() },
+);
+
+writeFileSync(join(cfg.evidence, "acceptance.json"), JSON.stringify(result, null, 2));
+console.log(`\nacceptance: ${result.steps.length} steps passed, ${result.skipped.length} skipped`);
+for (const s of result.skipped) console.log(`  skipped: ${s}`);
+await browser.close();
diff --git a/frontend/src-tauri/src/lib.rs b/frontend/src-tauri/src/lib.rs
index 9f9955e..ea7f1bd 100644
--- a/frontend/src-tauri/src/lib.rs
+++ b/frontend/src-tauri/src/lib.rs
@@ -1,19 +1,25 @@
+mod logfile;
 mod sidecar;
 
 use tauri::Manager;
 
 #[tauri::command]
 fn backend_info(state: tauri::State<sidecar::BackendState>) -> Result<serde_json::Value, String> {
     let guard = state.0.lock().unwrap();
     let backend = guard.as_ref().ok_or("backend not started")?;
-    Ok(serde_json::json!({ "base_url": backend.base_url, "token": backend.token }))
+    Ok(serde_json::json!({
+        "base_url": backend.base_url,
+        "token": backend.token,
+        // Spec section 11: the failure dialog points the operator at the sidecar log.
+        "log_path": backend.log_path.as_ref().map(|p| p.to_string_lossy()),
+    }))
 }
 
 #[tauri::command]
 fn restart_backend(
     app: tauri::AppHandle,
     state: tauri::State<sidecar::BackendState>,
 ) -> Result<(), String> {
     sidecar::stop(&state);
     let backend = sidecar::start(&app)?;
     *state.0.lock().unwrap() = Some(backend);
diff --git a/frontend/src-tauri/src/logfile.rs b/frontend/src-tauri/src/logfile.rs
new file mode 100644
index 0000000..a7c30fb
--- /dev/null
+++ b/frontend/src-tauri/src/logfile.rs
@@ -0,0 +1,155 @@
+//! Append-only log file with one rollover, used to tee the sidecar's output to disk.
+//!
+//! Spec section 11: when the backend dies the dialog has to point the operator at a file, so the
+//! console the shell plugin writes to is not enough. Volume is low (startup lines, job warnings),
+//! so each line opens and closes the file: that keeps rotation safe on Windows, where a rename
+//! fails while the file is still open.
+
+use std::fs::{self, OpenOptions};
+use std::io::Write;
+use std::path::{Path, PathBuf};
+
+/// Roll over at 5 MB, keeping one previous file (`sidecar.log.1`).
+pub const MAX_BYTES: u64 = 5 * 1024 * 1024;
+
+pub struct RotatingLog {
+    path: PathBuf,
+    max_bytes: u64,
+}
+
+impl RotatingLog {
+    pub fn new(path: impl Into<PathBuf>, max_bytes: u64) -> Self {
+        Self {
+            path: path.into(),
+            max_bytes,
+        }
+    }
+
+    pub fn path(&self) -> &Path {
+        &self.path
+    }
+
+    /// Append one line. Logging must never take the app down, so failures are reported and dropped.
+    pub fn append(&self, line: &str) {
+        if let Err(e) = self.try_append(line) {
+            eprintln!("[backend] could not write {}: {e}", self.path.display());
+        }
+    }
+
+    fn try_append(&self, line: &str) -> std::io::Result<()> {
+        // The shell plugin hands over whatever line ending the child wrote, so trim it: the file
+        // holds one line per event rather than a blank line between every two.
+        let line = line.trim_end_matches(['\r', '\n']);
+        if let Some(dir) = self.path.parent() {
+            fs::create_dir_all(dir)?;
+        }
+        self.rotate_if_full(line.len() as u64 + 1)?;
+        let mut file = OpenOptions::new()
+            .create(true)
+            .append(true)
+            .open(&self.path)?;
+        writeln!(file, "{line}")
+    }
+
+    fn rotate_if_full(&self, incoming: u64) -> std::io::Result<()> {
+        let size = match fs::metadata(&self.path) {
+            Ok(m) => m.len(),
+            Err(_) => return Ok(()), // nothing written yet
+        };
+        if size + incoming <= self.max_bytes {
+            return Ok(());
+        }
+        let previous = self.previous_path();
+        let _ = fs::remove_file(&previous);
+        fs::rename(&self.path, &previous)
+    }
+
+    fn previous_path(&self) -> PathBuf {
+        let name = self
+            .path
+            .file_name()
+            .map(|n| n.to_string_lossy().into_owned())
+            .unwrap_or_else(|| "sidecar.log".into());
+        self.path.with_file_name(format!("{name}.1"))
+    }
+}
+
+#[cfg(test)]
+mod tests {
+    use super::*;
+
+    fn temp_dir(name: &str) -> PathBuf {
+        let dir =
+            std::env::temp_dir().join(format!("machinery-logfile-{name}-{}", std::process::id()));
+        let _ = fs::remove_dir_all(&dir);
+        dir
+    }
+
+    #[test]
+    fn appends_lines_and_creates_the_folder() {
+        let dir = temp_dir("append");
+        let log = RotatingLog::new(dir.join("logs").join("sidecar.log"), MAX_BYTES);
+
+        log.append("first");
+        log.append("second");
+
+        assert_eq!(fs::read_to_string(log.path()).unwrap(), "first\nsecond\n");
+        fs::remove_dir_all(&dir).unwrap();
+    }
+
+    #[test]
+    fn writes_one_line_per_event_whatever_line_ending_it_arrived_with() {
+        let dir = temp_dir("endings");
+        let log = RotatingLog::new(dir.join("sidecar.log"), MAX_BYTES);
+
+        log.append("plain");
+        log.append("with crlf\r\n");
+        log.append("with lf\n");
+
+        assert_eq!(
+            fs::read_to_string(log.path()).unwrap(),
+            "plain\nwith crlf\nwith lf\n"
+        );
+        fs::remove_dir_all(&dir).unwrap();
+    }
+
+    #[test]
+    fn rolls_over_once_the_limit_is_reached() {
+        let dir = temp_dir("rotate");
+        let log = RotatingLog::new(dir.join("sidecar.log"), 12);
+
+        log.append("0123456789"); // 11 bytes with the newline
+        log.append("next");
+
+        assert_eq!(
+            fs::read_to_string(dir.join("sidecar.log.1")).unwrap(),
+            "0123456789\n"
+        );
+        assert_eq!(
+            fs::read_to_string(dir.join("sidecar.log")).unwrap(),
+            "next\n"
+        );
+        fs::remove_dir_all(&dir).unwrap();
+    }
+
+    #[test]
+    fn keeps_only_one_previous_file() {
+        let dir = temp_dir("rotate-twice");
+        let log = RotatingLog::new(dir.join("sidecar.log"), 12);
+
+        log.append("0123456789");
+        log.append("aaaaaaaaaa");
+        log.append("bbbb");
+
+        assert_eq!(
+            fs::read_to_string(dir.join("sidecar.log.1")).unwrap(),
+            "aaaaaaaaaa\n"
+        );
+        assert_eq!(
+            fs::read_to_string(dir.join("sidecar.log")).unwrap(),
+            "bbbb\n"
+        );
+        assert_eq!(fs::read_dir(&dir).unwrap().count(), 2);
+        fs::remove_dir_all(&dir).unwrap();
+    }
+}
diff --git a/frontend/src-tauri/src/sidecar.rs b/frontend/src-tauri/src/sidecar.rs
index f42a7a5..2bfb422 100644
--- a/frontend/src-tauri/src/sidecar.rs
+++ b/frontend/src-tauri/src/sidecar.rs
@@ -1,21 +1,25 @@
+use crate::logfile::{RotatingLog, MAX_BYTES};
 use std::net::TcpListener;
+use std::path::PathBuf;
 use std::sync::atomic::{AtomicBool, Ordering};
 use std::sync::{Arc, Mutex};
 use tauri::{AppHandle, Emitter, Manager};
 use tauri_plugin_shell::process::{CommandChild, CommandEvent};
 use tauri_plugin_shell::ShellExt;
 
 pub struct Backend {
     pub base_url: String,
     pub token: String,
     pub child: Option<CommandChild>,
+    /// Where this launch tees the sidecar's output; `None` when the backend is not ours to log.
+    pub log_path: Option<PathBuf>,
     /// Set by [`stop`] so a deliberate kill is not reported as a crash.
     pub stopping: Arc<AtomicBool>,
 }
 
 pub struct BackendState(pub Mutex<Option<Backend>>);
 
 fn free_port() -> u16 {
     TcpListener::bind("127.0.0.1:0")
         .unwrap()
         .local_addr()
@@ -33,61 +37,71 @@ fn random_token() -> String {
 }
 
 /// Start the backend: an externally started one when `APP_BACKEND_URL` is set,
 /// otherwise the bundled sidecar on a free port with a fresh token.
 pub fn start(app: &AppHandle) -> Result<Backend, String> {
     if let Ok(url) = std::env::var("APP_BACKEND_URL") {
         return Ok(Backend {
             base_url: url,
             token: std::env::var("APP_BACKEND_TOKEN").unwrap_or_default(),
             child: None,
+            log_path: None,
             stopping: Arc::new(AtomicBool::new(false)),
         });
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
+    let log = Arc::new(RotatingLog::new(
+        data_dir.join("logs").join("sidecar.log"),
+        MAX_BYTES,
+    ));
+    let log_path = Some(log.path().to_path_buf());
     let stopping = Arc::new(AtomicBool::new(false));
     let watcher = stopping.clone();
     let app = app.clone();
     tauri::async_runtime::spawn(async move {
         while let Some(ev) = rx.recv().await {
             match ev {
                 CommandEvent::Stdout(l) | CommandEvent::Stderr(l) => {
-                    eprintln!("[backend] {}", String::from_utf8_lossy(&l))
+                    let line = String::from_utf8_lossy(&l).into_owned();
+                    eprintln!("[backend] {line}");
+                    log.append(&line);
                 }
                 CommandEvent::Terminated(t) => {
                     eprintln!("[backend] terminated {:?}", t);
+                    log.append(&format!("terminated {t:?}"));
                     // A kill from `stop` is expected; anything else is a crash the UI must show.
                     if !watcher.load(Ordering::SeqCst) {
                         let _ =
                             app.emit("backend-terminated", serde_json::json!({ "code": t.code }));
                     }
                     break;
                 }
                 _ => {}
             }
         }
     });
     Ok(Backend {
         base_url: format!("http://127.0.0.1:{port}"),
         token,
         child: Some(child),
+        log_path,
         stopping,
     })
 }
 
 /// Kill the sidecar, if this launch owns one.
 pub fn stop(state: &BackendState) {
     if let Some(b) = state.0.lock().unwrap().take() {
         b.stopping.store(true, Ordering::SeqCst);
         if let Some(c) = b.child {
             let _ = c.kill();
diff --git a/frontend/src-tauri/tauri.conf.json b/frontend/src-tauri/tauri.conf.json
index 72cf81b..c58352c 100644
--- a/frontend/src-tauri/tauri.conf.json
+++ b/frontend/src-tauri/tauri.conf.json
@@ -15,34 +15,37 @@
         "title": "Machinery Detection",
         "width": 1400,
         "height": 900,
         "minWidth": 1024,
         "minHeight": 700,
         "resizable": true,
         "fullscreen": false
       }
     ],
     "security": {
-      "csp": null
+      "csp": "default-src 'self'; img-src 'self' http://127.0.0.1:* data: blob:; connect-src 'self' http://127.0.0.1:* ws://127.0.0.1:*; style-src 'self' 'unsafe-inline'"
     }
   },
   "bundle": {
     "active": true,
     "targets": ["nsis"],
     "icon": [
       "icons/32x32.png",
       "icons/128x128.png",
       "icons/128x128@2x.png",
       "icons/icon.icns",
       "icons/icon.ico"
     ],
     "externalBin": ["binaries/machinery-backend"],
     "resources": {
       "binaries/_internal/": "_internal/"
     },
     "windows": {
       "webviewInstallMode": {
         "type": "downloadBootstrapper"
+      },
+      "nsis": {
+        "installMode": "currentUser"
       }
     }
   }
 }
diff --git a/frontend/src/api/backend.test.ts b/frontend/src/api/backend.test.ts
index 4e8a9fd..b853dd1 100644
--- a/frontend/src/api/backend.test.ts
+++ b/frontend/src/api/backend.test.ts
@@ -7,46 +7,62 @@ describe("resolveBackend", () => {
     delete (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__;
   });
 
   it("falls back to the mock server", async () => {
     vi.stubEnv("APP_BACKEND_URL", "");
     const { resolveBackend } = await import("./backend");
     expect(await resolveBackend()).toEqual({
       baseUrl: "http://127.0.0.1:4010",
       token: "mock",
       mode: "mock",
+      logPath: null,
     });
   });
 
   it("uses APP_BACKEND_URL when set", async () => {
     vi.stubEnv("APP_BACKEND_URL", "http://127.0.0.1:8765");
     vi.stubEnv("APP_BACKEND_TOKEN", "abc");
     const { resolveBackend } = await import("./backend");
     expect(await resolveBackend()).toEqual({
       baseUrl: "http://127.0.0.1:8765",
       token: "abc",
       mode: "env",
+      logPath: null,
     });
   });
 
   it("asks tauri when running inside the shell", async () => {
     (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__ = {};
     vi.doMock("@tauri-apps/api/core", () => ({
-      invoke: vi.fn().mockResolvedValue({ base_url: "http://127.0.0.1:5555", token: "t" }),
+      invoke: vi.fn().mockResolvedValue({
+        base_url: "http://127.0.0.1:5555",
+        token: "t",
+        log_path: "C:\\logs\\sidecar.log",
+      }),
     }));
     const { resolveBackend } = await import("./backend");
     expect(await resolveBackend()).toEqual({
       baseUrl: "http://127.0.0.1:5555",
       token: "t",
       mode: "tauri",
+      logPath: "C:\\logs\\sidecar.log",
     });
   });
+
+  it("reports no log path when the shell attached to an external backend", async () => {
+    (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__ = {};
+    vi.doMock("@tauri-apps/api/core", () => ({
+      invoke: vi.fn().mockResolvedValue({ base_url: "http://127.0.0.1:8765", token: "t", log_path: null }),
+    }));
+    const { resolveBackend } = await import("./backend");
+    expect((await resolveBackend()).logPath).toBeNull();
+  });
 });
 
 describe("terminationMessage", () => {
   it("names the exit code when the sidecar reports one", async () => {
     const { terminationMessage } = await import("./backend");
     expect(terminationMessage({ code: 3 })).toBe("Backend process exited (code 3)");
   });
 
   it("falls back when the sidecar reports no code", async () => {
     const { terminationMessage } = await import("./backend");
diff --git a/frontend/src/api/backend.ts b/frontend/src/api/backend.ts
index 1159741..fcb666a 100644
--- a/frontend/src/api/backend.ts
+++ b/frontend/src/api/backend.ts
@@ -1,33 +1,46 @@
 import type { ApiClient, Health } from "@contract/client";
 
 export type BackendMode = "tauri" | "env" | "mock";
 
 export interface BackendInfo {
   baseUrl: string;
   token: string;
   mode: BackendMode;
+  /** The sidecar log this launch tees to, when the shell owns the backend (spec section 11). */
+  logPath: string | null;
 }
 
 /**
  * Where the backend lives: the Tauri sidecar when running inside the shell,
  * an externally started backend when `APP_BACKEND_URL` is set, else the mock server.
  */
 export async function resolveBackend(): Promise<BackendInfo> {
   if ((window as unknown as Record<string, unknown>).__TAURI_INTERNALS__) {
     const { invoke } = await import("@tauri-apps/api/core");
-    const info = await invoke<{ base_url: string; token: string }>("backend_info");
-    return { baseUrl: info.base_url, token: info.token, mode: "tauri" };
+    const info = await invoke<{ base_url: string; token: string; log_path?: string | null }>("backend_info");
+    return {
+      baseUrl: info.base_url,
+      token: info.token,
+      mode: "tauri",
+      logPath: info.log_path ?? null,
+    };
   }
   const url = import.meta.env.APP_BACKEND_URL;
-  if (url) return { baseUrl: url, token: import.meta.env.APP_BACKEND_TOKEN ?? "", mode: "env" };
-  return { baseUrl: "http://127.0.0.1:4010", token: "mock", mode: "mock" };
+  if (url)
+    return {
+      baseUrl: url,
+      token: import.meta.env.APP_BACKEND_TOKEN ?? "",
+      mode: "env",
+      logPath: null,
+    };
+  return { baseUrl: "http://127.0.0.1:4010", token: "mock", mode: "mock", logPath: null };
 }
 
 /** Poll `GET /api/v1/health` until it answers or the timeout elapses. */
 export async function waitForHealth(
   client: ApiClient,
   timeoutMs = 60_000,
   intervalMs = 500,
 ): Promise<Health> {
   const t0 = Date.now();
   let lastError = "";
diff --git a/frontend/src/api/client.test.tsx b/frontend/src/api/client.test.tsx
new file mode 100644
index 0000000..b3fb329
--- /dev/null
+++ b/frontend/src/api/client.test.tsx
@@ -0,0 +1,53 @@
+import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
+import { render, screen, waitFor } from "@testing-library/react";
+
+/** Spec section 11: when the backend never answers, the dialog has to say where the log is. */
+describe("ApiProvider backend failure dialog", () => {
+  beforeEach(() => {
+    vi.resetModules();
+    vi.unstubAllEnvs();
+    vi.stubEnv("APP_BACKEND_URL", "");
+  });
+
+  afterEach(() => {
+    delete (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__;
+    vi.restoreAllMocks();
+  });
+
+  async function renderFailing(backendInfo: Record<string, unknown>) {
+    (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__ = {};
+    vi.doMock("@tauri-apps/api/core", () => ({ invoke: vi.fn().mockResolvedValue(backendInfo) }));
+    vi.doMock("@tauri-apps/api/event", () => ({ listen: vi.fn().mockResolvedValue(() => {}) }));
+    vi.doMock("./backend", async () => {
+      const real = await vi.importActual<typeof import("./backend")>("./backend");
+      return { ...real, waitForHealth: vi.fn().mockRejectedValue(new Error("backend not healthy")) };
+    });
+    const { ApiProvider } = await import("./client");
+    render(
+      <ApiProvider>
+        <div>app</div>
+      </ApiProvider>,
+    );
+    await waitFor(() => expect(screen.getByRole("alertdialog")).toBeInTheDocument());
+  }
+
+  it("shows the sidecar log path reported by backend_info", async () => {
+    await renderFailing({
+      base_url: "http://127.0.0.1:5555",
+      token: "t",
+      log_path: "C:\\Users\\D\\AppData\\Roaming\\machinery-app\\logs\\sidecar.log",
+    });
+
+    expect(screen.getByText("backend not healthy")).toBeInTheDocument();
+    expect(screen.getByText("Log")).toBeInTheDocument();
+    expect(
+      screen.getByText("C:\\Users\\D\\AppData\\Roaming\\machinery-app\\logs\\sidecar.log"),
+    ).toBeInTheDocument();
+  });
+
+  it("leaves the log row out when this launch owns no sidecar log", async () => {
+    await renderFailing({ base_url: "http://127.0.0.1:5555", token: "t", log_path: null });
+
+    expect(screen.queryByText("Log")).not.toBeInTheDocument();
+  });
+});
diff --git a/frontend/src/api/client.tsx b/frontend/src/api/client.tsx
index 84110b5..eff77a5 100644
--- a/frontend/src/api/client.tsx
+++ b/frontend/src/api/client.tsx
@@ -122,20 +122,26 @@ function BackendFailure({
       >
         <h1 id="backend-failure-title" className="mb-2 text-xl font-semibold text-orange-400">
           The backend is not responding
         </h1>
         <p className="mb-4 whitespace-pre-wrap text-sm text-slate-300">{error}</p>
         <dl className="mb-6 grid grid-cols-[6rem_1fr] gap-x-4 gap-y-1 text-sm">
           <dt className="text-slate-400">URL</dt>
           <dd className="font-mono">{info?.baseUrl ?? "unknown"}</dd>
           <dt className="text-slate-400">Mode</dt>
           <dd className="font-mono">{info?.mode ?? "unknown"}</dd>
+          {info?.logPath ? (
+            <>
+              <dt className="text-slate-400">Log</dt>
+              <dd className="break-all font-mono">{info.logPath}</dd>
+            </>
+          ) : null}
         </dl>
         <button
           type="button"
           onClick={onRestart}
           className="rounded bg-orange-600 px-4 py-2 font-medium hover:bg-orange-500"
         >
           Restart
         </button>
       </div>
     </div>
diff --git a/frontend/src/test/render.tsx b/frontend/src/test/render.tsx
index 19ad7ac..607a53a 100644
--- a/frontend/src/test/render.tsx
+++ b/frontend/src/test/render.tsx
@@ -3,21 +3,21 @@
 import { useMemo, type ReactElement, type ReactNode } from "react";
 import { MemoryRouter, Route, Routes } from "react-router-dom";
 import { render } from "@testing-library/react";
 import type { ApiClient } from "@contract/client";
 import { ApiContext, type ApiContextValue } from "@/api/client";
 
 export function TestApiProvider({ api, children }: { api: ApiClient; children: ReactNode }) {
   const value = useMemo<ApiContextValue>(
     () => ({
       client: api,
-      info: { baseUrl: "http://fake", token: "t", mode: "mock" },
+      info: { baseUrl: "http://fake", token: "t", mode: "mock", logPath: null },
       health: { status: "ok", version: "test", pid: 1, started_at: "2026-09-17T00:00:00Z" },
     }),
     [api],
   );
   return <ApiContext.Provider value={value}>{children}</ApiContext.Provider>;
 }
 
 /** Renders `ui` inside the API context and a memory router; `path` mounts it as a route so `useParams` works. */
 export function renderWithProviders(
   ui: ReactElement,
diff --git a/scripts/acceptance.md b/scripts/acceptance.md
new file mode 100644
index 0000000..470789d
--- /dev/null
+++ b/scripts/acceptance.md
@@ -0,0 +1,118 @@
+# Acceptance run (spec 13.5)
+
+The acceptance run is performed **on the installed app** (`Machinery Detection` from the NSIS
+setup), not on a dev build. Every step below names the exact UI action, what to expect, and the
+evidence file it produces under `docs/evidence/acceptance/`.
+
+`frontend/scripts/acceptance.mjs` performs all eight steps automatically over CDP; this document
+is the source of truth for what "passing" means and is what a person follows when driving by hand.
+
+## Preparation
+
+1. Install the app (`Machinery Detection_0.1.0_x64-setup.exe`, per-user install, no admin needed).
+2. Launch it with the WebView2 debugging port so the driver can attach:
+
+   ```powershell
+   $env:WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS = "--remote-debugging-port=9222"
+   Start-Process "$env:LOCALAPPDATA\Machinery Detection\Machinery Detection.exe"
+   ```
+
+3. Choose an empty project folder on a disk with room for 3299 imported frames (about 20 GB).
+4. For step 7, put the Anthropic key in the environment of the shell that runs the driver
+   (`$env:ANTHROPIC_API_KEY`). The driver stores it through `PUT /providers/anthropic/key` at
+   runtime and deletes it again afterwards; it is never written to a file, a log or a commit.
+   Without the variable the step is skipped with a clear message and the run still passes.
+5. Run the driver:
+
+   ```powershell
+   node frontend\scripts\acceptance.mjs --project-folder E:\tmp\acceptance --evidence docs\evidence\acceptance
+   ```
+
+   The defaults are the real acceptance values; `--source`, `--expect-images`, `--expect-flights`,
+   `--label-count`, `--epochs`, `--query-images` and `--cloud-images` parametrise it for a dry run
+   on a small copy of the frames.
+
+## Steps
+
+### 1. Create project "Ahmadia" with the eight classes
+
+- **UI**: Projects screen -> `Name` = `Ahmadia`, `Folder` = the chosen folder -> **Create project**.
+- **Expect**: the app navigates to the project's Data Manager; `GET /projects/{id}` reports the
+  eight default classes `excavator, wheel_loader, bulldozer, dump_truck, crane, concrete_mixer,
+  roller, backhoe` with hotkeys 1-8.
+- **Evidence**: `acceptance-01-project.png`
+
+### 2. Import `E:\Dev\Yolo\Ahmadia Construction Data`
+
+- **UI**: Data Manager -> **Import images** -> `Folder` = `E:\Dev\Yolo\Ahmadia Construction Data`,
+  `Site name` = `ahmadia` -> **Start import**. The source folder is only ever read.
+- **Expect**: the import job succeeds (allow up to 60 minutes); `GET /stats` reports
+  `image_count` **3299**, `duplicate_count` **0** and **7** flight groups
+  `0031, 0033, 0034, 0035, 0038, 0040, 0042`.
+- **Evidence**: `acceptance-02-import.png`
+
+### 3. Pre-annotation model and proposals on 10 images
+
+- **UI**: Models -> **Import weights** -> `Model name` = `yolo11m-coco`,
+  `Weights path` = `E:\Dev\Yolo\models\yolo11m.pt` -> **Import** -> **Use as pre-annotation
+  model**. Then open the first 10 images in the editor one after another; pre-annotation runs on
+  open.
+- **Expect**: the model is registered with 80 COCO class names and is the project's
+  `preannotation_model_id`; at least one of the 10 images carries a box with provenance
+  `local_model`.
+- **Evidence**: `acceptance-03-preannotation.png`
+
+### 4. Label 30 images and freeze dataset "v1"
+
+- **UI**: for each of 30 images, open the editor, press hotkey `1` (excavator) and drag one box on
+  the canvas. Then Data Manager -> **List** -> tick the 30 labeled rows -> **Add to dataset** ->
+  `Dataset name` = `v1` -> **Create dataset** (split method `by_group`).
+- **Expect**: `GET /stats` reports `labeled_count` >= 30; the dataset job succeeds;
+  `train_count + val_count` == 30 with both above zero; on disk
+  `datasets/v1/images/train`, `datasets/v1/images/val`, `datasets/v1/labels/train`,
+  `datasets/v1/labels/val` exist and `datasets/v1/data.yaml` lists `path`, `train`, `val` and the
+  eight class names.
+- **Evidence**: `acceptance-04-dataset.png`, `acceptance-04-data-yaml.txt`
+
+### 5. Train YOLO11n for 3 epochs
+
+- **UI**: Train -> `Dataset` = `v1`, `Base model` = `yolo11m-coco` is the imported COCO model, so
+  import `E:\Dev\Yolo\models\yolo11n.pt` as `yolo11n-coco` first and pick it, `Model name` =
+  `ahmadia-v1`, `Epochs` = `3`, `Image size` = `1280`, `Automatic batch size` off,
+  `Batch size` = `4` -> **Start training**.
+- **Expect**: the Train screen shows a live epoch card; the job reaches `succeeded`; at least 3
+  `job.progress` events arrive over the websocket; the resulting model is registered with
+  `kind: trained` and non-empty `metrics` (`map50`, `map50_95`, `precision`, `recall`).
+- **Evidence**: `acceptance-05-training.png`
+
+### 6. Query run over 50 unlabeled images, review and promote
+
+- **UI**: Query -> `Model` = `ahmadia-v1`, `Confidence` = `0.25`, images = the unlabeled ones ->
+  **Estimate** -> **Start**. When the run finishes, set `Minimum confidence` and press **Promote**.
+- **Expect**: the inference job succeeds over 50 images; the run card reports a box count; after
+  promotion `GET /query-runs/{id}` has a non-null `promoted_at` and the promoted boxes carry
+  provenance `local_model` with the run's model id.
+- **Evidence**: `acceptance-06-query-run.png`, `acceptance-06-promoted.png`
+
+### 7. Anthropic vision query "dump trucks" over 5 images with tiling
+
+- **UI**: Query -> tick `Cloud provider`, `Query` = `dump trucks`, `Tiling` on, 5 images ->
+  **Estimate** -> **Start**.
+- **Expect**: the job succeeds; the boxes written by the run carry provenance kind
+  `cloud_provider` with `provider: anthropic` and the model name. The key is removed from
+  Credential Manager afterwards.
+- **Skipped** with `SKIP anthropic query run (no ANTHROPIC_API_KEY)` when the variable is absent.
+- **Evidence**: `acceptance-07-cloud-run.png`
+
+### 8. Export the trained model to ONNX
+
+- **UI**: Models -> `ahmadia-v1` -> **Export ONNX**.
+- **Expect**: the export job succeeds and `models/<model>.onnx` exists inside the project folder
+  with a non-zero size.
+- **Evidence**: `acceptance-08-export.png`
+
+## Result
+
+The driver writes `docs/evidence/acceptance/acceptance.json` with, per step, the name, pass/fail,
+the measured values and the elapsed seconds, plus the list of skipped steps. A run passes when
+every step is `ok` and the only skips are ones this document allows.
