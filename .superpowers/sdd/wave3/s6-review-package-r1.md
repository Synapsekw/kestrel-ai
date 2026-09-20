# Review package: 02359a9..6cdd435

## Commits
6cdd435 fix(s6): acceptance driver review findings (round 1)
b96c6d9 build: inno setup installer (nsis and msi cap payloads at 2 gb)

## Files changed
 .gitignore                                 |   1 +
 README.md                                  |  41 +-
 backend/app/projects/service.py            |   8 +-
 backend/machinery_backend.spec             |   8 +-
 backend/scripts/smoke_frozen.ps1           |  13 +-
 backend/tests/conftest.py                  |   9 +-
 backend/tests/test_health.py               |  10 +-
 backend/tests/test_job_startup.py          |  15 +
 backend/tests/test_ultralytics_env.py      |   8 +-
 docs/progress.md                           |  27 +-
 frontend/installer/machinery-detection.iss | 100 ++++
 frontend/package.json                      |   2 +
 frontend/pnpm-lock.yaml                    |  10 +
 frontend/scripts/acceptance.mjs            | 775 +++++++++++++++++------------
 frontend/scripts/build-installer.ps1       |  94 ++++
 frontend/src-tauri/tauri.conf.json         |  10 +-
 scripts/acceptance.md                      |  85 ++--
 17 files changed, 821 insertions(+), 395 deletions(-)

## Diff
diff --git a/.gitignore b/.gitignore
index 8454d7a..d2f3368 100644
--- a/.gitignore
+++ b/.gitignore
@@ -7,20 +7,21 @@ __pycache__/
 .hypothesis/
 backend/build/
 backend/dist/
 # node
 node_modules/
 frontend/dist/
 frontend/test-results/
 frontend/playwright-report/
 # rust / tauri
 frontend/src-tauri/target/
+frontend/installer/MicrosoftEdgeWebview2Setup.exe
 frontend/src-tauri/gen/
 frontend/src-tauri/binaries/*
 !frontend/src-tauri/binaries/.gitkeep
 # worktrees and local data
 .worktrees/
 *.db
 *.db-journal
 *.db-wal
 *.db-shm
 *.pt
diff --git a/README.md b/README.md
index 80182a5..424128e 100644
--- a/README.md
+++ b/README.md
@@ -110,39 +110,45 @@ acceptance drivers use.
    an import, one YOLO prediction, a 1-epoch training run through the frozen `worker` subcommand
    (DataLoader workers, so `multiprocessing.freeze_support()` is exercised), the Ultralytics font
    pre-seed, an ONNX export and a keyring round trip through Windows Credential Manager. It prints
    `health ok`, `cuda True <gpu name>`, `predict ok <n> boxes`, `worker ok` and exits non-zero on
    any failure. About 25 seconds.
 
 3. Build the installer:
 
    ```powershell
    cd frontend
-   pnpm tauri build        # bundle under frontend/src-tauri/target/release/bundle/
+   pnpm build:installer    # -> src-tauri/target/release/bundle/inno/Machinery Detection_<version>_x64-setup.exe
    ```
 
-   The app binary builds in about a minute; the install tree it would write is 3.47 GB, inside the
-   6 GB success criterion.
+   `frontend/scripts/build-installer.ps1` runs `pnpm tauri build --no-bundle` and then compiles
+   `frontend/installer/machinery-detection.iss` with the Inno Setup 6 compiler that ships inside
+   `node_modules/innosetup-compiler` - nothing is installed system-wide, and the version comes from
+   `tauri.conf.json`. Pass `-SkipTauriBuild` to repackage the release binary that is already built.
 
-   **Known limit - no installer yet.** Neither Tauri bundler can package a 3.4 GB sidecar. NSIS
-   addresses its payload with 32-bit offsets, so `makensis` dies at 2 GB
-   (`Internal compiler error #12345: error mmapping file (2057025505, 33554432) is out of range`),
-   and `--bundles msi` puts everything in one embedded cabinet, which the cabinet format caps at
-   the same 2 GB (`light.exe : error LGHT0001 : Catastrophic failure ... CreateCabFinish`). The
-   measurements, why trimming the CUDA payload does not help, and the options are in
-   `docs/progress.md` under "S6 packaging evidence"; the format is the goal owner's decision.
+   Inno Setup rather than Tauri's own bundlers because both of those cap their payload at 2 GB and
+   this one is 3.4 GB: NSIS addresses its data with 32-bit offsets
+   (`Internal compiler error #12345: error mmapping file ... is out of range`) and the WiX template
+   puts everything in one embedded cabinet
+   (`light.exe : error LGHT0001 : Catastrophic failure ... CreateCabFinish`). `bundle.targets` in
+   `tauri.conf.json` is therefore empty; the rest of the `bundle` block still drives the exe icon
+   and the sidecar and resource staging that `pnpm tauri dev` needs. Measurements are in
+   `docs/progress.md` under "S6 packaging evidence".
 
 ## Install and run the packaged app
 
-- Run the generated installer (`/S` for a silent NSIS install, `msiexec /i "<file>.msi" /qn` for
-  an MSI). The install is per user: no administrator rights, no shared install directory.
-- The WebView2 runtime is fetched by the bootstrapper if the machine does not already have it.
+- Run the generated setup exe (`/VERYSILENT /SUPPRESSMSGBOXES` for an unattended install). The
+  install is per user into `%LOCALAPPDATA%\Programs\Machinery Detection`: no administrator rights,
+  no shared install directory.
+- WebView2: the installer runs Microsoft's bootstrapper only when the runtime is missing, and only
+  when a copy of `MicrosoftEdgeWebview2Setup.exe` was present at build time (see troubleshooting).
+  Windows 11 ships the runtime.
 - The app installs next to the sidecar: `machinery-backend-x86_64-pc-windows-msvc.exe` with its
   `_internal/` folder beside it. Both must stay together.
 - Per-user data lives in `%APPDATA%\ai.synapse-solutions.machinery-app`: `logs/`,
   `recent_projects.json`, `settings.json` and `ultralytics/` (the pre-seeded plot font). Uninstall
   removes the program directory and leaves that data alone.
 - Project data (images, labels, datasets, runs, models, `project.db`) lives in the project folder
   the operator chooses, never under the install directory.
 
 ## Run the tests
 
@@ -186,21 +192,24 @@ the variable is absent. No key is ever written to a file, a fixture or a log.
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
-  first only if the install directory itself is damaged.
-- **The first `pnpm tauri build` downloads** NSIS or the WiX toolset and the WebView2 bootstrapper
-  into the Tauri cache under `%LOCALAPPDATA%\tauri`; that needs network access once.
+  removes `%LOCALAPPDATA%\Programs\Machinery Detection` and leaves app data and projects alone.
+- **"The WebView2 runtime is missing" on a fresh machine.** The installer only carries Microsoft's
+  bootstrapper when `frontend/installer/MicrosoftEdgeWebview2Setup.exe` exists at build time; the
+  redistributable is never committed. Drop a copy there (or leave one in the Tauri bundler cache,
+  which the build script picks up) and rebuild, or install the Evergreen runtime on the target
+  machine first. Windows 11 already has it, so the reference machine does not need it.
 - **Training cannot reach the network.** It must not need to: the AMP probe is skipped
   (`app/training/worker.py`), Ultralytics auto-install is off and the plot font is seeded from the
   machine's own fonts (`app/training/fonts.py`).
 
 ## Changing the API
 
 Only the goal owner edits `contract/openapi.yaml`. After a change: `cd contract; pnpm check`
 (regenerates `client/schema.d.ts`), then run the backend contract tests.
diff --git a/backend/app/projects/service.py b/backend/app/projects/service.py
index 458fecd..ffa94ef 100644
--- a/backend/app/projects/service.py
+++ b/backend/app/projects/service.py
@@ -1,12 +1,13 @@
 """Project registry: opens project folders, owns their engines, tracks recent projects."""
 
+import logging
 import threading
 from collections.abc import Callable, Iterator
 from contextlib import contextmanager
 from pathlib import Path
 
 from fastapi import Request
 from sqlalchemy import func, select
 from sqlalchemy.orm import Session
 
 from app.appdata import AppData
@@ -17,20 +18,22 @@ from app.errors import AppError, not_found
 
 SUBDIRS = ("images", "labels", "datasets", "runs", "models", "cache/thumbs")
 DEFAULT_IMPORT_SETTINGS = {
     "max_side": 4000,
     "quality": 95,
     "dedupe_threshold": 4,
     "group_regex": r"^(?P<camera>[A-Za-z0-9-]+)_(?P<flight>\d+)_(?P<frame>\d+)",
 }
 DEFAULT_COLOUR = "#4f46e5"
 
+log = logging.getLogger(__name__)
+
 
 class ProjectHandle:
     def __init__(self, id: str, folder: Path, engine):
         self.id, self.folder, self.engine = id, folder, engine
         self._factory = make_session_factory(engine)
 
     images_dir = property(lambda s: s.folder / "images")
     labels_dir = property(lambda s: s.folder / "labels")
     datasets_dir = property(lambda s: s.folder / "datasets")
     runs_dir = property(lambda s: s.folder / "runs")
@@ -140,21 +143,24 @@ class ProjectRegistry:
     def _name(h: ProjectHandle) -> str:
         with h.session() as s:
             return h.row(s).name
 
     def _cache(self, pid: str, folder: Path, engine, name: str, remember: bool) -> ProjectHandle:
         h = ProjectHandle(pid, folder, engine)
         self._handles[pid] = h
         if remember:
             self.appdata.remember(pid, name, str(folder))
         if self.on_open is not None:
-            self.on_open(h)
+            try:
+                self.on_open(h)
+            except Exception:  # opening the project is what the operator asked for
+                log.exception("on_open hook failed for project %s at %s", pid, folder)
         return h
 
     def get(self, project_id: str) -> ProjectHandle:
         if project_id in self._handles:
             return self._handles[project_id]
         for r in self.appdata.recent():
             if r["id"] == project_id and (Path(r["folder"]) / "project.db").exists():
                 return self.open(Path(r["folder"]), remember=False)
         raise not_found("project", project_id)
 
diff --git a/backend/machinery_backend.spec b/backend/machinery_backend.spec
index f2bb532..1cb9347 100644
--- a/backend/machinery_backend.spec
+++ b/backend/machinery_backend.spec
@@ -53,15 +53,17 @@ binaries = (
 )
 
 a = Analysis(
     ["app/__main__.py"],
     pathex=["."],
     hiddenimports=hiddenimports,
     datas=datas,
     binaries=binaries,
 )
 pyz = PYZ(a.pure)
-# console=False: the shell plugin gives the sidecar piped stdio either way, so the startup JSON
-# line still reaches Tauri as CommandEvent::Stdout, and a windowed exe keeps the training worker
-# subprocess (which the frozen exe spawns for every run) from flashing a console window.
+# console=False: a windowed exe still writes to whatever stdio handles its parent gives it, so
+# the startup JSON line survives - scripts/smoke_frozen.ps1 starts the exe with stdout
+# redirected to a file and parses the port out of it, which is the same pipe the shell plugin
+# hands the sidecar. Windowed also keeps the training worker subprocess (which the frozen exe
+# spawns for every run) from flashing a console window.
 exe = EXE(pyz, a.scripts, exclude_binaries=True, name="machinery-backend", console=False)
 coll = COLLECT(exe, a.binaries, a.datas, name="machinery-backend")
diff --git a/backend/scripts/smoke_frozen.ps1 b/backend/scripts/smoke_frozen.ps1
index 1e247f6..ccde306 100644
--- a/backend/scripts/smoke_frozen.ps1
+++ b/backend/scripts/smoke_frozen.ps1
@@ -5,30 +5,34 @@
 .DESCRIPTION
   Starts dist/machinery-backend/machinery-backend.exe exactly as the Tauri sidecar does
   (APP_TOKEN / APP_PORT / APP_DATA_DIR, stdio on a pipe), then proves in one run that the bundle
   carries everything the app needs: the API answers, CUDA torch is inside, one YOLO prediction
   runs, the `worker` subcommand trains with DataLoader workers (freeze_support), ONNX export
   works, and keyring reaches Windows Credential Manager without setuptools entry points.
 
   Prints `health ok`, `cuda True <gpu name>`, `predict ok <n> boxes` and `worker ok`, and exits
   non-zero on any failure. Sample frames are copied out of the read-only source folder first.
 
+.PARAMETER Keep
+  Leave the temporary work dir behind; it is deleted on the way out by default.
+
 .EXAMPLE
   powershell -ExecutionPolicy Bypass -File backend\scripts\smoke_frozen.ps1
 #>
 [CmdletBinding()]
 param(
   [string] $Dist,  # defaults to <backend>/dist/machinery-backend once $PSScriptRoot is set
   [string] $Weights = "E:\Dev\Yolo\models\yolo11n.pt",
   [string] $Source = "E:\Dev\Yolo\data\raw\ahmadia",
   [int] $Frames = 3,
   [int] $Imgsz = 640,
+  [switch] $Keep,  # leave the work dir (project folder, run artefacts, ONNX) on disk
   [string] $WorkDir = (Join-Path $env:TEMP ("machinery-smoke-" + [guid]::NewGuid().ToString("N").Substring(0, 8)))
 )
 
 $ErrorActionPreference = "Stop"
 # $PSScriptRoot is not set yet while parameter defaults are evaluated on PowerShell 5.1.
 if (-not $Dist) { $Dist = Join-Path (Split-Path $PSScriptRoot -Parent) "dist\machinery-backend" }
 $exe = Join-Path $Dist "machinery-backend.exe"
 if (-not (Test-Path $exe)) { throw "no frozen build at $exe; run backend\scripts\build.ps1 first" }
 if (-not (Test-Path $Weights)) { throw "no weights at $Weights" }
 if (-not (Test-Path $Source)) { throw "no sample frames at $Source" }
@@ -219,13 +223,20 @@ try {
   $timings["total"] = [math]::Round($total.Elapsed.TotalSeconds, 2)
   $bytes = (Get-ChildItem $Dist -Recurse -File | Measure-Object -Sum Length).Sum
   Write-Host ""
   Write-Host ("bundle: {0:N1} MB at {1}" -f ($bytes / 1MB), $Dist)
   Write-Host "timings (s): $(($timings.GetEnumerator() | ForEach-Object { "$($_.Key)=$($_.Value)" }) -join ' ')"
   Write-Host "smoke ok"
 } finally {
   if (-not $proc.HasExited) {
     # /T: a training run may still own worker children of our own process tree
     & taskkill /T /F /PID $proc.Id 2>&1 | Out-Null
+    $proc.WaitForExit(10000) | Out-Null
+  }
+  if ($Keep) {
+    Write-Host "work dir kept: $WorkDir"
+  } else {
+    # A run leaves a project folder, training run folders, weights and a 10 MB ONNX behind.
+    Remove-Item $WorkDir -Recurse -Force -ErrorAction SilentlyContinue
+    Write-Host "work dir removed: $WorkDir (pass -Keep to inspect it)"
   }
-  Write-Host "work dir: $WorkDir"
 }
diff --git a/backend/tests/conftest.py b/backend/tests/conftest.py
index 657191f..8fa47fc 100644
--- a/backend/tests/conftest.py
+++ b/backend/tests/conftest.py
@@ -2,20 +2,21 @@ import shutil
 import time
 from pathlib import Path
 
 import numpy as np
 import piexif
 import pytest
 from fastapi.testclient import TestClient
 from PIL import Image
 
 from app.config import Settings
+from app.health import GpuProbe
 from app.main import create_app
 from app.providers.keys import MemoryKeyStore
 
 TOKEN = "test-token"
 AHMADIA_RAW = Path(r"E:\Dev\Yolo\data\raw\ahmadia")
 SAMPLE_FRAMES = 20
 EIGHT_CLASSES = [
     "excavator",
     "wheel_loader",
     "bulldozer",
@@ -28,23 +29,29 @@ EIGHT_CLASSES = [
 COLOURS = ["#f97316", "#eab308", "#22c55e", "#06b6d4", "#3b82f6", "#a855f7", "#ec4899", "#ef4444"]
 
 
 @pytest.fixture
 def settings(tmp_path: Path) -> Settings:
     return Settings(token=TOKEN, data_dir=tmp_path / "appdata", port=0)
 
 
 @pytest.fixture
 def app(settings):
-    """Every test app keeps its API keys in memory: no test may touch Credential Manager."""
+    """A test app that touches nothing outside the process.
+
+    Keys stay in memory (no test may reach Credential Manager) and the CUDA probe is a stub, so
+    a health request does not import torch into the pytest process. `test_health.py` keeps one
+    test for the real probe.
+    """
     created = create_app(settings)
     created.state.keys = MemoryKeyStore()
+    created.state.gpu_probe = GpuProbe(probe=lambda: {"available": False, "name": "test-gpu"})
     return created
 
 
 @pytest.fixture
 def client(app):
     with TestClient(app, headers={"Authorization": f"Bearer {TOKEN}"}) as c:
         yield c
 
 
 @pytest.fixture
diff --git a/backend/tests/test_health.py b/backend/tests/test_health.py
index d7a0937..d2693ef 100644
--- a/backend/tests/test_health.py
+++ b/backend/tests/test_health.py
@@ -1,14 +1,14 @@
 import threading
 import time
 
-from app.health import GpuProbe
+from app.health import GpuProbe, probe_cuda
 
 
 def answered(probe: GpuProbe, timeout: float = 5.0) -> dict:
     """Poll the probe until its background thread has an answer."""
     deadline = time.time() + timeout
     while time.time() < deadline:
         value = probe.snapshot()
         if value is not None:
             return value
         time.sleep(0.01)
@@ -71,10 +71,18 @@ def test_gpu_probe_reports_no_gpu_after_the_timeout_and_still_self_heals():
         time.sleep(0.01)
     assert probe.snapshot() == {"available": True, "name": "Late GPU"}
 
 
 def test_gpu_probe_reports_no_gpu_when_the_probe_raises():
     def boom() -> dict:
         raise RuntimeError("no cuda here")
 
     probe = GpuProbe(probe=boom)
     assert answered(probe) == {"available": False, "name": None}
+
+
+def test_probe_cuda_answers_for_real_on_this_machine():
+    """The one place the suite runs the real probe; the app fixture stubs it everywhere else."""
+    value = probe_cuda()
+    assert set(value) == {"available", "name"}
+    assert isinstance(value["available"], bool)
+    assert value["name"] is None or isinstance(value["name"], str)
diff --git a/backend/tests/test_job_startup.py b/backend/tests/test_job_startup.py
index e58d78f..6787107 100644
--- a/backend/tests/test_job_startup.py
+++ b/backend/tests/test_job_startup.py
@@ -76,10 +76,25 @@ def test_nothing_to_sweep_is_a_no_op(handle, app):
 
 def test_opening_a_project_in_a_fresh_registry_sweeps_it(handle, app, tmp_path: Path):
     """The sweep runs where a project becomes live: projects open lazily, one at a time."""
     running, queued = add_jobs(handle, "running", "queued")
     registry = ProjectRegistry(tmp_path / "other-appdata", on_open=lambda h: sweep_orphans(h, app.state.jobs))
 
     reopened = registry.open(handle.folder)
 
     assert states(reopened) == {running: "failed", queued: "cancelled"}
     registry.close_all()
+
+
+def test_a_failing_sweep_never_blocks_opening_a_project(handle, tmp_path: Path, caplog):
+    """The project is what the operator asked for; a sweep that raises is a log line, not a 500."""
+
+    def boom(_handle):
+        raise RuntimeError("sweep exploded")
+
+    registry = ProjectRegistry(tmp_path / "third-appdata", on_open=boom)
+
+    reopened = registry.open(handle.folder)
+
+    assert reopened.folder == handle.folder
+    assert "sweep exploded" in caplog.text
+    registry.close_all()
diff --git a/backend/tests/test_ultralytics_env.py b/backend/tests/test_ultralytics_env.py
index 451bb5b..33375c7 100644
--- a/backend/tests/test_ultralytics_env.py
+++ b/backend/tests/test_ultralytics_env.py
@@ -31,46 +31,46 @@ def test_ensure_font_gives_up_quietly_when_no_font_is_installed(tmp_path: Path,
     monkeypatch.setattr(fonts, "font_candidates", lambda: [tmp_path / "nope.ttf"])
     assert fonts.ensure_font(tmp_path / "cfg") is None
 
 
 def test_this_machine_has_a_font_candidate():
     """The real candidate list has to resolve on the reference machine, frozen or not."""
     assert any(c.is_file() for c in fonts.font_candidates()), fonts.font_candidates()
 
 
 def test_configure_ultralytics_points_the_config_dir_at_app_data(tmp_path: Path, monkeypatch):
-    monkeypatch.delenv("YOLO_CONFIG_DIR", raising=False)
+    monkeypatch.setenv("YOLO_CONFIG_DIR", "")  # empty reads as unset and is restored
 
     config_dir = fonts.configure_ultralytics(tmp_path / "appdata")
 
     assert config_dir == tmp_path / "appdata" / "ultralytics"
     assert os.environ["YOLO_CONFIG_DIR"] == str(config_dir)
     assert (config_dir / "Arial.ttf").is_file()
 
 
 def test_configure_ultralytics_honours_a_config_dir_the_launcher_already_chose(tmp_path: Path, monkeypatch):
     monkeypatch.setenv("YOLO_CONFIG_DIR", str(tmp_path / "chosen"))
     assert fonts.configure_ultralytics(tmp_path / "appdata") == tmp_path / "chosen"
 
 
 def test_configure_ultralytics_falls_back_to_app_data_dir_from_the_environment(tmp_path: Path, monkeypatch):
-    monkeypatch.delenv("YOLO_CONFIG_DIR", raising=False)
+    monkeypatch.setenv("YOLO_CONFIG_DIR", "")  # empty reads as unset and is restored
     monkeypatch.setenv("APP_DATA_DIR", str(tmp_path / "inherited"))
     assert fonts.configure_ultralytics() == tmp_path / "inherited" / "ultralytics"
 
 
 def test_configure_ultralytics_is_a_no_op_without_anywhere_to_put_it(monkeypatch):
-    monkeypatch.delenv("YOLO_CONFIG_DIR", raising=False)
+    monkeypatch.setenv("YOLO_CONFIG_DIR", "")  # empty reads as unset and is restored
     monkeypatch.delenv("APP_DATA_DIR", raising=False)
     assert fonts.configure_ultralytics() is None
 
 
 def test_the_worker_seeds_the_font_before_it_does_anything_else(tmp_path: Path, monkeypatch):
     """The worker's setup step runs even when the run itself cannot start."""
-    monkeypatch.delenv("YOLO_CONFIG_DIR", raising=False)
+    monkeypatch.setenv("YOLO_CONFIG_DIR", "")  # empty reads as unset and is restored
     monkeypatch.setenv("APP_DATA_DIR", str(tmp_path / "appdata"))
     run_dir = tmp_path / "run"
     run_dir.mkdir()
 
     assert worker.main(["train", str(run_dir / "params.json")]) == 1  # no params file: setup still ran
 
     assert (tmp_path / "appdata" / "ultralytics" / "Arial.ttf").is_file()
diff --git a/docs/progress.md b/docs/progress.md
index ab8a7d9..38750c5 100644
--- a/docs/progress.md
+++ b/docs/progress.md
@@ -151,43 +151,46 @@ Measured, not estimated. Reference machine: Windows 11 Pro 26200, RTX 5070 Ti, t
 ultralytics 8.4.154, PyInstaller 6.22.3, Tauri CLI 2.11.4.
 
 | Step | Command | Result |
 |---|---|---|
 | Freeze the backend | `backend\scripts\build.ps1` | 127 s; `dist/machinery-backend` 3,457.8 MB in 14,113 files |
 | Frozen smoke test | `backend\scripts\smoke_frozen.ps1` | pass in 23.8 s: health 0.57 s, `cuda True NVIDIA GeForce RTX 5070 Ti` 3.8 s, predict, 1-epoch worker train 11.0 s, ONNX export 3.2 s, keyring round trip |
 | App binary | `pnpm tauri build` (cargo release) | 65 s; `machinery-app.exe` 11.1 MB |
 | Install tree that the installer would write | - | 3,468.9 MB (app 11.1 MB + sidecar exe and `_internal` 3,457.8 MB), well under the 6 GB success criterion |
 | NSIS installer | `pnpm tauri build` | **fails**: `makensis` `Internal compiler error #12345: error mmapping file (2057025505, 33554432) is out of range` |
 | MSI installer | `pnpm tauri build --bundles msi` | **fails**: `light.exe : error LGHT0001 : Catastrophic failure ... at Microsoft.Tools.WindowsInstallerXml.Cab.Interop.NativeMethods.CreateCabFinish` |
+| Installed layout, run from a temp copy without installing | `machinery-app.exe` from the would-be install tree | sidecar spawned, `GET /api/v1/health` 200 with `gpu {available: true, name: NVIDIA GeForce RTX 5070 Ti}`, page served from `http://tauri.localhost/`; closing the window terminated the sidecar |
+| **Inno Setup installer** | `pnpm build:installer` | **1,797.3 MB in 377 s** (ISCC alone 352.3 s) -> `frontend/src-tauri/target/release/bundle/inno/Machinery Detection_0.1.0_x64-setup.exe` |
 
 Both failures are the same 2 GB wall, reached from two directions: an NSIS installer addresses its
 payload with 32-bit offsets, and Tauri's WiX template puts everything in one embedded cabinet
 (`<Media Id="1" Cabinet="app.cab" EmbedCab="yes" />`), which the cabinet format caps at 2 GB. The
 payload cannot be brought under 2 GB by trimming: `torch/lib` alone is 2.78 GB and its large CUDA
 DLLs (`cublasLt` 456 MB, `torch_cuda` 404 MB, `cufft` 272 MB, `cudnn_engines_precompiled` 212 MB,
 `cusparse` 144 MB, `cusolver` 121 MB) are imported by name from `torch_cuda.dll`; dropping
 `cufft`/`cusolver`/`cusparse` was tried and `torch.cuda.is_available()` went false (the frozen
 smoke test caught it). Only about 205 MB is genuinely unreferenced (`cusolverMg`,
 `nvrtc64_130_0.alt`, `nvperf_host`).
 
-Open decision for the goal owner (spec 10 says NSIS; checkpoint 4 and the acceptance run wait on it):
+Resolved by decision 13: the installer is built with Inno Setup 6, which has no 2 GB limit, from
+`frontend/installer/machinery-detection.iss` via `pnpm build:installer` (`ISCC.exe` comes from the
+`innosetup-compiler` npm package, so nothing is installed system-wide). `bundle.targets` in
+`tauri.conf.json` is now empty; the rest of the `bundle` block still drives the exe icon and the
+sidecar and resource staging `pnpm tauri dev` needs.
 
-1. Custom WiX template (`bundle.windows.wix.template`) using `<MediaTemplate EmbedCab="yes"
-   MaximumUncompressedMediaSize="..."/>`, which splits the payload over several cabinets. Smallest
-   change that keeps a single-file installer; changes the format from NSIS to MSI.
-2. A third-party installer that supports large payloads (Inno Setup 6 handles >2 GB), built outside
-   the Tauri bundler from `target/release` plus `src-tauri/binaries`.
-3. Ship the app and the sidecar payload separately (a small installer plus a downloaded or
-   side-loaded `_internal`), or distribute a portable folder.
-
-Everything downstream of the installer (install, cold start under 15 s, checkpoint 4, the
-acceptance run on the installed app) is blocked until this is chosen.
+Still open for the goal owner: install from the setup exe, measure cold and warm start, run
+checkpoint 4 and the acceptance run on the installed app. The WebView2 bootstrapper is not in the
+installer - nothing on this machine had a copy of `MicrosoftEdgeWebview2Setup.exe` (Tauri's
+`downloadBootstrapper` mode fetches it at install time, so the cache holds none) and the
+redistributable is not committed. The installer's `[Run]` entry and its registry check appear only
+when `frontend/installer/MicrosoftEdgeWebview2Setup.exe` exists at build time; Windows 11 ships the
+runtime, so the reference machine does not need it.
 
 ## S0 status detail
 
 | Task | Owner | State | Commit |
 |---|---|---|---|
 | 1 skeleton | goal owner | done | c5b5722 |
 | 2 contract + mock | goal owner | done, mock verified | 4d71fcd |
 | 3 TS client | goal owner | done | 4d71fcd |
 | 4 backend shell | goal owner | done | 715e772 (s0-backend) |
 | 5 DB + projects | goal owner | done | f74ba9a |
@@ -211,11 +214,11 @@ SDD ledger (rulings, deferred minors): `.superpowers/sdd/2026-09-17-s0-contract-
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
-- 2026-09-18: S6 tasks 1, 2, 4 and 5 done on `s6-packaging-acceptance`: full CUDA PyInstaller bundle with a frozen smoke test, packaging hardening (orphan sweep, Arial pre-seed, sidecar log tee, CSP), the acceptance script and its CDP driver (dry-run green on 20 frames), and the README. Task 3 is blocked: neither Tauri bundler can package the 3.4 GB sidecar (see S6 packaging evidence above).
+- 2026-09-18: S6 tasks 1, 2, 4 and 5 done on `s6-packaging-acceptance`: full CUDA PyInstaller bundle with a frozen smoke test, packaging hardening (orphan sweep, Arial pre-seed, sidecar log tee, CSP), the acceptance script and its CDP driver (dry-run green on 20 frames), and the README. Task 3 landed after the ruling on decision 13: the installer is built with Inno Setup 6 (1,797.3 MB in 377 s); install, cold start and checkpoint 4 are the goal owner's.
diff --git a/frontend/installer/machinery-detection.iss b/frontend/installer/machinery-detection.iss
new file mode 100644
index 0000000..8fc9a71
--- /dev/null
+++ b/frontend/installer/machinery-detection.iss
@@ -0,0 +1,100 @@
+; Inno Setup script for the Machinery Detection installer (spec section 10).
+;
+; Tauri's own bundlers cannot carry this app: the frozen backend is a 3.4 GB one-folder PyInstaller
+; build, and both NSIS (32-bit payload offsets) and the WiX template (one embedded cabinet) stop at
+; 2 GB. Inno Setup 6 has no such limit. See docs/progress.md, "S6 packaging evidence".
+;
+; Compiled by frontend/scripts/build-installer.ps1, which passes the version in with /DAppVersion.
+; Every path below is relative to this file's folder, which is Inno's default SourceDir.
+
+#define AppName "Machinery Detection"
+#define AppPublisher "Synapse Solutions"
+#ifndef AppVersion
+  #define AppVersion "0.0.0"
+#endif
+
+#define AppExe "..\src-tauri\target\release\machinery-app.exe"
+#define SidecarExe "..\src-tauri\binaries\machinery-backend-x86_64-pc-windows-msvc.exe"
+#define InternalDir "..\src-tauri\binaries\_internal"
+#define IconFile "..\src-tauri\icons\icon.ico"
+#define OutputDir "..\src-tauri\target\release\bundle\inno"
+
+; Shipped only when the build script found a copy; the runtime is present on Windows 11 anyway.
+#define WebView2Setup "MicrosoftEdgeWebview2Setup.exe"
+#define HaveWebView2Setup FileExists(AddBackslash(SourcePath) + WebView2Setup)
+
+[Setup]
+AppId={{B7E0B1F4-4C2E-4D6D-9C3A-2F5E6A1D9C77}
+AppName={#AppName}
+AppVersion={#AppVersion}
+AppPublisher={#AppPublisher}
+VersionInfoVersion={#AppVersion}
+; Per user: no administrator rights and no shared install directory.
+PrivilegesRequired=lowest
+DefaultDirName={localappdata}\Programs\Machinery Detection
+DefaultGroupName={#AppName}
+DisableProgramGroupPage=yes
+ArchitecturesAllowed=x64compatible
+ArchitecturesInstallIn64BitMode=x64compatible
+OutputDir={#OutputDir}
+OutputBaseFilename=Machinery Detection_{#AppVersion}_x64-setup
+Compression=lzma2/max
+SolidCompression=yes
+WizardStyle=modern
+SetupIconFile={#IconFile}
+UninstallDisplayName={#AppName}
+UninstallDisplayIcon={app}\machinery-app.exe
+
+[Files]
+; The sidecar exe and its `_internal` folder must land beside machinery-app.exe: the shell plugin
+; resolves a sidecar as `<folder of the running exe>\<name>.exe`, and a PyInstaller one-folder
+; build loads `_internal` from beside its own exe. The target triple is only part of the file name
+; in the source slot, which is why the sidecar is renamed on the way in - exactly what the Tauri
+; CLI does when it stages `target\release\machinery-backend.exe`.
+Source: "{#AppExe}"; DestDir: "{app}"; Flags: ignoreversion
+Source: "{#SidecarExe}"; DestDir: "{app}"; DestName: "machinery-backend.exe"; Flags: ignoreversion
+Source: "{#InternalDir}\*"; DestDir: "{app}\_internal"; Flags: ignoreversion recursesubdirs createallsubdirs
+#if HaveWebView2Setup
+Source: "{#WebView2Setup}"; DestDir: "{tmp}"; Flags: deleteafterinstall
+#endif
+
+[Icons]
+Name: "{autoprograms}\{#AppName}"; Filename: "{app}\machinery-app.exe"
+
+#if HaveWebView2Setup
+[Run]
+Filename: "{tmp}\{#WebView2Setup}"; Parameters: "/silent /install"; \
+  StatusMsg: "Installing the WebView2 runtime..."; Check: NeedsWebView2
+#endif
+
+[UninstallDelete]
+; Leave the install directory empty of leftovers. Per-user app data (logs, recent projects,
+; settings, the Ultralytics config dir) lives under %APPDATA% and is deliberately kept, as are the
+; operator's project folders.
+Type: filesandordirs; Name: "{app}"
+
+[Code]
+const
+  WebView2Client = '{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}';
+
+function HasVersion(RootKey: Integer; SubKey: String): Boolean;
+var
+  Version: String;
+begin
+  Result := RegQueryStringValue(RootKey, SubKey, 'pv', Version) and (Version <> '') and
+    (Version <> '0.0.0.0');
+end;
+
+{ The Evergreen runtime registers itself per machine (32-bit view on x64) or per user. }
+function WebView2Installed: Boolean;
+begin
+  Result :=
+    HasVersion(HKEY_LOCAL_MACHINE, 'SOFTWARE\WOW6432Node\Microsoft\EdgeUpdate\Clients\' + WebView2Client) or
+    HasVersion(HKEY_LOCAL_MACHINE, 'SOFTWARE\Microsoft\EdgeUpdate\Clients\' + WebView2Client) or
+    HasVersion(HKEY_CURRENT_USER, 'Software\Microsoft\EdgeUpdate\Clients\' + WebView2Client);
+end;
+
+function NeedsWebView2: Boolean;
+begin
+  Result := not WebView2Installed;
+end;
diff --git a/frontend/package.json b/frontend/package.json
index a5139ac..b2337f8 100644
--- a/frontend/package.json
+++ b/frontend/package.json
@@ -4,20 +4,21 @@
   "private": true,
   "type": "module",
   "scripts": {
     "dev": "vite",
     "build": "tsc -b && vite build",
     "preview": "vite preview",
     "test": "vitest run",
     "lint": "eslint src && prettier --check src",
     "format": "prettier --write src",
     "e2e": "playwright test",
+    "build:installer": "powershell -NoProfile -ExecutionPolicy Bypass -File scripts/build-installer.ps1",
     "tauri": "tauri"
   },
   "dependencies": {
     "@tauri-apps/api": "^2.11.1",
     "@tauri-apps/plugin-dialog": "^2.7.3",
     "@tauri-apps/plugin-shell": "^2.3.6",
     "konva": "^9.3.22",
     "openapi-fetch": "~0.13.8",
     "react": "^18.3.1",
     "react-dom": "^18.3.1",
@@ -33,20 +34,21 @@
     "@testing-library/react": "^16.3.3",
     "@types/node": "^22.20.3",
     "@types/react": "^18.3.31",
     "@types/react-dom": "^18.3.7",
     "@vitejs/plugin-react": "^4.7.0",
     "autoprefixer": "^10.6.1",
     "eslint": "^9.39.5",
     "eslint-plugin-react-hooks": "^7.1.1",
     "eslint-plugin-react-refresh": "^0.5.7",
     "globals": "^17.12.0",
+    "innosetup-compiler": "^6.3.1",
     "jsdom": "^30.1.0",
     "postcss": "^8.5.28",
     "prettier": "^3.9.7",
     "tailwindcss": "^3.4.19",
     "typescript": "^5.9.3",
     "typescript-eslint": "^8.70.0",
     "vite": "^6.4.3",
     "vitest": "^3.2.7"
   },
   "packageManager": "pnpm@10.24.0",
diff --git a/frontend/pnpm-lock.yaml b/frontend/pnpm-lock.yaml
index 85e1bc6..ef4a7a3 100644
--- a/frontend/pnpm-lock.yaml
+++ b/frontend/pnpm-lock.yaml
@@ -74,20 +74,23 @@ importers:
         version: 9.39.5(jiti@1.21.7)
       eslint-plugin-react-hooks:
         specifier: ^7.1.1
         version: 7.1.1(eslint@9.39.5(jiti@1.21.7))
       eslint-plugin-react-refresh:
         specifier: ^0.5.7
         version: 0.5.7(eslint@9.39.5(jiti@1.21.7))
       globals:
         specifier: ^17.12.0
         version: 17.12.0
+      innosetup-compiler:
+        specifier: ^6.3.1
+        version: 6.3.1
       jsdom:
         specifier: ^30.1.0
         version: 30.1.0
       postcss:
         specifier: ^8.5.28
         version: 8.5.28
       prettier:
         specifier: ^3.9.7
         version: 3.9.7
       tailwindcss:
@@ -1282,20 +1285,25 @@ packages:
     engines: {node: '>=6'}
 
   imurmurhash@0.1.4:
     resolution: {integrity: sha512-JmXMZ6wuvDmLiHEml9ykzqO6lwFbof0GG4IkcGaENdCRDDmMVnny7s5HsIgHCbaq0w2MyPhDqkhTUgS2LU2PHA==}
     engines: {node: '>=0.8.19'}
 
   indent-string@4.0.0:
     resolution: {integrity: sha512-EdDDZu4A2OyIK7Lr/2zG+w5jmbuk1DVBnEwREQvBzspBJkCEbRa8GxU1lghYcaGJCnRWibjDXlq779X1/y5xwg==}
     engines: {node: '>=8'}
 
+  innosetup-compiler@6.3.1:
+    resolution: {integrity: sha512-Qynw7Xjv7ZN/beBvS7Kt+QL50Q/Zbf7cJDHZmxmwNbxqgZEWCZ+5tggC6naF4ij/9PqRfpvDP1ecZLFwusu6Lw==}
+    engines: {node: '>= 0.8.0'}
+    hasBin: true
+
   is-binary-path@2.1.0:
     resolution: {integrity: sha512-ZMERYes6pDydyuGidse7OsHxtbI7WVeUEozgR/g7rd0xUimYNlvZRE/K2MgZTjWy725IfelLeVcEM97mmtRGXw==}
     engines: {node: '>=8'}
 
   is-core-module@2.17.0:
     resolution: {integrity: sha512-J/vG0zBCbIKOQFfufSwyXdMrsohyJIUNkrnmo6WZGzoM7tr/lsbfW5b2BvisL6zsyMzK9UxV9L6c7AoFbyXHOA==}
     engines: {node: '>= 0.4'}
 
   is-extglob@2.1.1:
     resolution: {integrity: sha512-SbKbANkN603Vi4jEZv49LeVJMn4yGwsbzZworEoyEiutsN3nJYdbO36zfhGJ6QEDpOZIFkDtnq5JRxmvl3jsoQ==}
@@ -3077,20 +3085,22 @@ snapshots:
 
   import-fresh@3.3.1:
     dependencies:
       parent-module: 1.0.1
       resolve-from: 4.0.0
 
   imurmurhash@0.1.4: {}
 
   indent-string@4.0.0: {}
 
+  innosetup-compiler@6.3.1: {}
+
   is-binary-path@2.1.0:
     dependencies:
       binary-extensions: 2.3.0
 
   is-core-module@2.17.0:
     dependencies:
       hasown: 2.0.4
 
   is-extglob@2.1.1: {}
 
diff --git a/frontend/scripts/acceptance.mjs b/frontend/scripts/acceptance.mjs
index 02b93ae..9a51fe1 100644
--- a/frontend/scripts/acceptance.mjs
+++ b/frontend/scripts/acceptance.mjs
@@ -2,23 +2,23 @@
 //
 // Attaches to a running app (installed or `pnpm tauri dev`) started with
 // WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=--remote-debugging-port=9222, performs the eight steps
 // with real UI actions and asserts the results through the API reached via `backend_info`.
 // Screenshots and a JSON summary land in the evidence folder. `scripts/acceptance.md` is the
 // prose version of the same run and the source of truth for what passing means.
 //
 // Usage:
 //   node scripts/acceptance.mjs --project-folder E:\tmp\acceptance [--evidence docs\evidence\acceptance]
 // Every expected value is a flag, so the script can be dry-run on a small copy of the frames:
-//   node scripts/acceptance.mjs --project-folder E:\tmp\dry --source E:\tmp\frames20 \
-//     --expect-images 20 --expect-flights 0031 --label-count 5 --epochs 1 --imgsz 640 \
-//     --preannotate-images 3 --query-images 5 --cloud-images 2
+//   node scripts/acceptance.mjs --project-folder E:\tmp\dry --source E:\tmp\frames60 \
+//     --expect-images 60 --expect-flights 0031 --epochs 1 --imgsz 640 --batch 2 \
+//     --preannotate-images 3 --min-proposals 0 --min-query-boxes 0
 import { chromium } from "@playwright/test";
 import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
 import { join } from "node:path";
 
 const argv = process.argv.slice(2);
 const flag = (name, fallback) => {
   const i = argv.indexOf(`--${name}`);
   return i >= 0 && argv[i + 1] !== undefined ? argv[i + 1] : fallback;
 };
 const number = (name, fallback) => Number(flag(name, String(fallback)));
@@ -36,33 +36,48 @@ const cfg = {
   expectFlights: flag("expect-flights", "0031,0033,0034,0035,0038,0040,0042").split(",").filter(Boolean),
   preannotateImages: number("preannotate-images", 10),
   // Spec 13.5 step 3 expects proposals on at least one of the opened images; a dry run over a
   // handful of frames may legitimately see none, so the bar is a flag.
   minProposals: number("min-proposals", 1),
   labelCount: number("label-count", 30),
   epochs: number("epochs", 3),
   imgsz: number("imgsz", 1280),
   batch: number("batch", 4),
   queryImages: number("query-images", 50),
+  minQueryBoxes: number("min-query-boxes", 1),
   cloudImages: number("cloud-images", 5),
+  minCloudBoxes: number("min-cloud-boxes", 1),
   conf: flag("conf", "0.25"),
   importTimeoutMin: number("import-timeout-min", 60),
   // Resume a run whose project already exists (the 3299-frame import takes a while).
   projectId: flag("project-id", ""),
 };
 if (!cfg.projectFolder) {
   throw new Error("usage: acceptance.mjs --project-folder <folder> [--evidence <dir>] [see the header]");
 }
 mkdirSync(cfg.evidence, { recursive: true });
 
 const CLASSES = 8;
-const result = { project_id: null, steps: [], skipped: [], config: cfg };
+const CLASS_NAMES = [
+  "excavator",
+  "wheel_loader",
+  "bulldozer",
+  "dump_truck",
+  "crane",
+  "concrete_mixer",
+  "roller",
+  "backhoe",
+];
+/** `ROW_HEIGHT` in frontend/src/data/ImageTable.tsx; the table is virtualised on that grid. */
+const ROW_HEIGHT = 36;
+
+const result = { project_id: null, steps: [], skipped: [], failed_step: null, config: cfg };
 const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
 
 function step(name, ok, detail = "", extra = {}) {
   result.steps.push({ name, ok, detail, ...extra });
   console.log(`${ok ? "PASS" : "FAIL"} ${name} ${detail}`);
   if (!ok) throw new Error(`step failed: ${name}`);
 }
 
 const shot = (page, name) => page.screenshot({ path: join(cfg.evidence, `acceptance-${name}.png`) });
 
@@ -81,82 +96,133 @@ async function connect() {
       /* the app is not up yet */
     }
     await sleep(1000);
   }
   throw new Error("could not attach to the app webview on port 9222");
 }
 
 const { browser, page } = await connect();
 const info = await page.evaluate(() => window.__TAURI_INTERNALS__.invoke("backend_info"));
 
-const api = async (method, path, body) => {
+/**
+ * One API call. `redact` keeps a response body out of the error message: the 422 handler echoes
+ * the request value it rejected, which for the provider key endpoint would be the key itself.
+ */
+const api = async (method, path, body, { redact = false } = {}) => {
   const r = await fetch(`${info.base_url}/api/v1${path}`, {
     method,
     headers: { Authorization: `Bearer ${info.token}`, "Content-Type": "application/json" },
     body: body ? JSON.stringify(body) : undefined,
   });
   const text = await r.text();
-  if (!r.ok) throw new Error(`${method} ${path} -> ${r.status} ${text.slice(0, 300)}`);
+  if (!r.ok) {
+    throw new Error(`${method} ${path} -> ${r.status} ${redact ? "<body redacted>" : text.slice(0, 300)}`);
+  }
   return text ? JSON.parse(text) : {};
 };
 
 /**
  * Router navigation without a page load: the installed app is served from `tauri.localhost`,
  * where a deep URL is not a file the asset protocol can serve.
  */
 async function go(path) {
   await page.evaluate((to) => {
     window.history.pushState({}, "", to);
     window.dispatchEvent(new PopStateEvent("popstate"));
   }, path);
 }
 
 /** The sidebar link, which is how a person moves between screens. */
 async function openScreen(label, heading) {
   await page.getByRole("link", { name: label, exact: true }).click();
   await page.getByRole("heading", { name: heading, exact: true }).waitFor({ timeout: 60_000 });
 }
 
-/** Poll a job to a terminal state, collecting the distinct progress messages seen on the way. */
+/** Poll a job to a terminal state, collecting the distinct progress lines seen on the way. */
 async function waitJob(projectId, jobId, timeoutMs = 3_600_000) {
   const t0 = Date.now();
   const progress = [];
   while (Date.now() - t0 < timeoutMs) {
     const job = await api("GET", `/projects/${projectId}/jobs/${jobId}`);
     const line = `${job.progress.toFixed(2)} ${job.message}`;
     if (progress[progress.length - 1] !== line) progress.push(line);
     if (["succeeded", "failed", "cancelled"].includes(job.state)) return { ...job, progress };
     await sleep(1000);
   }
   throw new Error(`job ${jobId} timed out`);
 }
 
+/**
+ * The app's own event websocket (spec section 9), which is how the UI learns about progress.
+ * Subscribe before the work starts and read `events` afterwards.
+ */
+async function openEventStream() {
+  const url = `${info.base_url.replace(/^http/, "ws")}/api/v1/events?token=${encodeURIComponent(info.token)}`;
+  const socket = new WebSocket(url);
+  const events = [];
+  socket.addEventListener("message", (e) => {
+    try {
+      events.push(JSON.parse(e.data));
+    } catch {
+      /* not our event */
+    }
+  });
+  await new Promise((resolve, reject) => {
+    socket.addEventListener("open", resolve, { once: true });
+    socket.addEventListener("error", () => reject(new Error(`could not open ${url.split("?")[0]}`)), {
+      once: true,
+    });
+  });
+  return { events, close: () => socket.close() };
+}
+
 /**
  * Open one image in the editor and wait until the canvas can take a drag.
  *
  * `data-view-scale` alone is not enough: it starts at the store's default 1 and only becomes the
  * fitted scale once the image record has arrived, so it reads "loaded" the instant the route
  * changes. `data-image` is set from the image record and the Konva stage only mounts once the
  * viewport is measured, so both together mean the background node exists.
  */
 async function openEditor(projectId, imageId) {
   await go(`/p/${projectId}/edit/${imageId}`);
   await page.waitForFunction(
     () => {
       const el = document.querySelector('[data-testid="editor-canvas"]');
       return Boolean(el?.getAttribute("data-image")) && el.querySelectorAll("canvas").length > 0;
     },
     null,
     { timeout: 180_000 },
   );
 }
 
+/**
+ * Open an image and wait for the editor's pre-annotation round trip, then return its boxes.
+ *
+ * The canvas appears as soon as the image record and its existing boxes have loaded; only then
+ * does `useEditorImage` POST `/preannotate`, and that call takes seconds. Reading the boxes any
+ * earlier undercounts the proposals. The hook skips pre-annotation when the image already has
+ * unreviewed proposals, so the wait is skipped in exactly the same case.
+ */
+async function openAndPreannotate(projectId, imageId) {
+  const before = await api("GET", `/projects/${projectId}/images/${imageId}/boxes`);
+  const pending = before.items.some((b) => b.review_state === "unreviewed");
+  const preannotated = pending
+    ? Promise.resolve(null)
+    : page.waitForResponse((r) => r.url().includes(`/images/${imageId}/preannotate`), {
+        timeout: 300_000,
+      });
+  await openEditor(projectId, imageId);
+  await preannotated;
+  return api("GET", `/projects/${projectId}/images/${imageId}/boxes`);
+}
+
 const regionCount = () =>
   page.evaluate(() => document.querySelectorAll('[aria-label="Regions"] [role="listitem"]').length);
 
 /**
  * One box drawn with the mouse, offset so repeated runs do not stack boxes on one spot.
  *
  * Pre-annotation runs on open and the full-size frame is still downloading behind the canvas, so
  * the first drag can land before the stage takes pointer events; the drag is repeated until a new
  * region shows up.
  */
@@ -180,344 +246,431 @@ async function drawBox(index, attempts = 3) {
       );
       return;
     } catch (e) {
       if (attempt === attempts) throw e;
       console.log(`  retrying the box on image ${index} (attempt ${attempt} drew nothing)`);
       await sleep(1000);
     }
   }
 }
 
-/** Tick `count` rows of the image table, scrolling each into view first. */
-async function selectRows(items, count) {
-  for (const image of items.slice(0, count)) {
-    const cb = page.getByLabel(`Select ${image.file_name}`);
-    await cb.scrollIntoViewIfNeeded();
-    await cb.check();
+const tableRow = (image) =>
+  page.getByRole("row").filter({ has: page.getByLabel(`Select ${image.file_name}`) });
+
+/**
+ * Scroll the virtualised container until a row is mounted, and hand back its locator.
+ *
+ * One scroll is not enough: the list grows page by page, and a scrollTop past the current
+ * `scrollHeight` is clamped, so a scroll issued before the rows arrived leaves the window at the
+ * top and the row never mounts.
+ */
+async function revealRow(image, index, timeoutMs = 60_000) {
+  const locator = tableRow(image);
+  const deadline = Date.now() + timeoutMs;
+  while (Date.now() < deadline) {
+    await page.getByTestId("image-table").evaluate((el, top) => {
+      el.scrollTop = top;
+    }, index * ROW_HEIGHT);
+    await sleep(250);
+    if ((await locator.count()) > 0) return locator;
   }
-  await page.getByText(`${count} selected`).waitFor({ timeout: 15_000 });
+  throw new Error(`row ${index} (${image.file_name}) never entered the virtualised window`);
+}
+
+/**
+ * Select the first `count` rows of the image table.
+ *
+ * The table renders only the rows in its viewport plus a small overscan, so ticking 30 or 50
+ * checkboxes by label cannot work: rows past the window are not in the DOM at all. This uses the
+ * table's own range selection instead - click the first row to set the anchor, shift-click the
+ * last one - which needs only those two rows mounted.
+ */
+async function selectRows(items, count) {
+  if (items.length < count) throw new Error(`only ${items.length} rows listed, need ${count}`);
+  // The table loads a page at a time; `aria-rowcount` is how many rows it currently holds.
+  await page.waitForFunction(
+    (n) => Number(document.querySelector('[role="grid"]')?.getAttribute("aria-rowcount")) >= n,
+    count,
+    { timeout: 120_000 },
+  );
+  await (await revealRow(items[0], 0)).click();
+  const last = await revealRow(items[count - 1], count - 1);
+  await last.click({ modifiers: ["Shift"] });
+  await page.getByText(`${count} selected`).waitFor({ timeout: 30_000 });
 }
 
 async function importWeights(name, path) {
   await page.getByRole("button", { name: "Import weights" }).click();
   await page.getByLabel("Model name").fill(name);
   await page.getByLabel("Weights path").fill(path);
   await page.getByRole("button", { name: "Import", exact: true }).click();
   await page.getByTestId("model-detail").waitFor({ timeout: 300_000 });
 }
 
-// Start from the Projects screen wherever the app was left (a resumed run reattaches to a
-// window that is still on a project screen).
-await go("/");
-await page.getByRole("heading", { name: "Projects" }).waitFor({ timeout: 120_000 });
+/** Every box the run wrote, across its images. */
+async function runBoxes(projectId, run) {
+  const boxes = [];
+  for (const imageId of run.image_ids) {
+    const page1 = await api("GET", `/projects/${projectId}/images/${imageId}/boxes`);
+    boxes.push(...page1.items.filter((b) => b.provenance.query_run_id === run.id));
+  }
+  return boxes;
+}
 
 const timer = () => {
   const t0 = Date.now();
   return () => Math.round((Date.now() - t0) / 100) / 10;
 };
 
-// ---------------------------------------------------------------- 1. project
+// Start from the Projects screen wherever the app was left (a resumed run reattaches to a
+// window that is still on a project screen).
+await go("/");
+await page.getByRole("heading", { name: "Projects" }).waitFor({ timeout: 120_000 });
+
 let projectId = cfg.projectId;
-let elapsed = timer();
-if (projectId) {
-  await go(`/p/${projectId}/data`);
-  step("1. resume on an existing project", true, projectId);
-} else {
-  await page.fill("#project-name", cfg.projectName);
-  await page.fill("#project-folder", cfg.projectFolder);
-  await page.getByRole("button", { name: "Create project" }).click();
-  await page.waitForURL(/\/p\/[0-9a-f-]+\/data/, { timeout: 60_000 });
-  projectId = page.url().split("/p/")[1].split("/")[0];
-  const project = await api("GET", `/projects/${projectId}`);
-  await shot(page, "01-project");
+try {
+  // -------------------------------------------------------------- 1. project
+  let elapsed = timer();
+  if (projectId) {
+    await go(`/p/${projectId}/data`);
+    step("1. resume on an existing project", true, projectId);
+  } else {
+    await page.fill("#project-name", cfg.projectName);
+    await page.fill("#project-folder", cfg.projectFolder);
+    await page.getByRole("button", { name: "Create project" }).click();
+    await page.waitForURL(/\/p\/[0-9a-f-]+\/data/, { timeout: 60_000 });
+    projectId = page.url().split("/p/")[1].split("/")[0];
+    const project = await api("GET", `/projects/${projectId}`);
+    await shot(page, "01-project");
+    step(
+      "1. create project with the eight classes",
+      project.name === cfg.projectName && project.classes.length === CLASSES,
+      `${projectId} classes ${project.classes.map((c) => c.name).join(",")}`,
+      { seconds: elapsed() },
+    );
+  }
+  result.project_id = projectId;
+
+  // --------------------------------------------------------------- 2. import
+  elapsed = timer();
+  let stats = await api("GET", `/projects/${projectId}/stats`);
+  if (stats.image_count === 0) {
+    await page.getByRole("button", { name: "Import images" }).click();
+    const dialog = page.getByRole("dialog", { name: "Import images" });
+    await dialog.waitFor({ timeout: 15_000 });
+    await dialog.getByLabel("Folder").fill(cfg.source);
+    await dialog.getByLabel("Site name").fill(cfg.site);
+    await dialog.getByRole("button", { name: "Start import" }).click();
+    await page.getByRole("dialog", { name: "Jobs" }).waitFor({ timeout: 30_000 });
+    const jobs = await api("GET", `/projects/${projectId}/jobs?type=import`);
+    const job = await waitJob(projectId, jobs.items[0].id, cfg.importTimeoutMin * 60_000);
+    if (job.state !== "succeeded") throw new Error(`import failed: ${job.error}`);
+    await page.keyboard.press("Escape");
+    stats = await api("GET", `/projects/${projectId}/stats`);
+  }
+  await page.getByTestId("image-grid").waitFor({ timeout: 60_000 });
+  await shot(page, "02-import");
+  const flights = stats.groups.map((g) => g.group_key).sort();
   step(
-    "1. create project with the eight classes",
-    project.name === cfg.projectName && project.classes.length === CLASSES,
-    `${projectId} classes ${project.classes.map((c) => c.name).join(",")}`,
-    { seconds: elapsed() },
+    "2. import the source folder",
+    stats.image_count === cfg.expectImages &&
+      stats.duplicate_count === cfg.expectDuplicates &&
+      flights.length === cfg.expectFlights.length &&
+      cfg.expectFlights.every((f) => flights.some((k) => k.includes(f))),
+    `images ${stats.image_count} duplicates ${stats.duplicate_count} flights ${flights.join(",")}`,
+    { seconds: elapsed(), image_count: stats.image_count, flights },
   );
-}
-result.project_id = projectId;
-
-// ----------------------------------------------------------------- 2. import
-elapsed = timer();
-let stats = await api("GET", `/projects/${projectId}/stats`);
-if (stats.image_count === 0) {
-  await page.getByRole("button", { name: "Import images" }).click();
-  const dialog = page.getByRole("dialog", { name: "Import images" });
-  await dialog.waitFor({ timeout: 15_000 });
-  await dialog.getByLabel("Folder").fill(cfg.source);
-  await dialog.getByLabel("Site name").fill(cfg.site);
-  await dialog.getByRole("button", { name: "Start import" }).click();
-  await page.getByRole("dialog", { name: "Jobs" }).waitFor({ timeout: 30_000 });
-  const jobs = await api("GET", `/projects/${projectId}/jobs?type=import`);
-  const job = await waitJob(projectId, jobs.items[0].id, cfg.importTimeoutMin * 60_000);
-  if (job.state !== "succeeded") throw new Error(`import failed: ${job.error}`);
-  await page.keyboard.press("Escape");
-  stats = await api("GET", `/projects/${projectId}/stats`);
-}
-await page.getByTestId("image-grid").waitFor({ timeout: 60_000 });
-await shot(page, "02-import");
-const flights = stats.groups.map((g) => g.group_key).sort();
-step(
-  "2. import the source folder",
-  stats.image_count === cfg.expectImages &&
-    stats.duplicate_count === cfg.expectDuplicates &&
-    flights.length === cfg.expectFlights.length &&
-    cfg.expectFlights.every((f) => flights.some((k) => k.includes(f))),
-  `images ${stats.image_count} duplicates ${stats.duplicate_count} flights ${flights.join(",")}`,
-  { seconds: elapsed(), image_count: stats.image_count, flights },
-);
-
-// ------------------------------------------------- 3. pre-annotation model
-elapsed = timer();
-await openScreen("Models", "Models");
-let models = await api("GET", `/projects/${projectId}/models`);
-let preModel = models.items.find((m) => m.name === "yolo11m-coco");
-if (!preModel) {
-  await importWeights("yolo11m-coco", cfg.preannotateWeights);
-  await page.getByRole("button", { name: "Use as pre-annotation model" }).click();
-  await sleep(1500);
-  preModel = (await api("GET", `/projects/${projectId}/models`)).items.find((m) => m.name === "yolo11m-coco");
-}
-const projectAfterModel = await api("GET", `/projects/${projectId}`);
-const page1 = await api("GET", `/projects/${projectId}/images?limit=${cfg.labelCount}&sort=path`);
-let proposals = 0;
-for (const image of page1.items.slice(0, cfg.preannotateImages)) {
-  await openEditor(projectId, image.id);
-  await sleep(500);
-  const boxes = await api("GET", `/projects/${projectId}/images/${image.id}/boxes`);
-  proposals += boxes.items.filter((b) => b.provenance.kind === "local_model").length;
-}
-await shot(page, "03-preannotation");
-step(
-  "3. pre-annotation model proposes on at least one of the opened images",
-  preModel !== undefined &&
-    projectAfterModel.preannotation_model_id === preModel.id &&
-    proposals >= cfg.minProposals,
-  `${preModel?.name} (${preModel?.class_names.length} classes), ${proposals} local_model proposals over ${cfg.preannotateImages} images`,
-  { seconds: elapsed(), proposals },
-);
-
-// -------------------------------------------------- 4. label and cut dataset
-elapsed = timer();
-stats = await api("GET", `/projects/${projectId}/stats`);
-if (stats.labeled_count < cfg.labelCount) {
-  for (const [i, image] of page1.items.slice(0, cfg.labelCount).entries()) {
-    await openEditor(projectId, image.id);
-    await drawBox(i);
-    await sleep(200);
+
+  // ----------------------------------------------- 3. pre-annotation model
+  elapsed = timer();
+  await openScreen("Models", "Models");
+  let models = await api("GET", `/projects/${projectId}/models`);
+  let preModel = models.items.find((m) => m.name === "yolo11m-coco");
+  if (!preModel) {
+    await importWeights("yolo11m-coco", cfg.preannotateWeights);
+    await page.getByRole("button", { name: "Use as pre-annotation model" }).click();
+    await sleep(1500);
+    preModel = (await api("GET", `/projects/${projectId}/models`)).items.find(
+      (m) => m.name === "yolo11m-coco",
+    );
+  }
+  const projectAfterModel = await api("GET", `/projects/${projectId}`);
+  const page1 = await api("GET", `/projects/${projectId}/images?limit=${cfg.labelCount}&sort=path`);
+  let proposals = 0;
+  for (const image of page1.items.slice(0, cfg.preannotateImages)) {
+    const boxes = await openAndPreannotate(projectId, image.id);
+    proposals += boxes.items.filter((b) => b.provenance.kind === "local_model").length;
   }
+  await shot(page, "03-preannotation");
+  step(
+    "3. pre-annotation model proposes on at least one of the opened images",
+    preModel !== undefined &&
+      projectAfterModel.preannotation_model_id === preModel.id &&
+      proposals >= cfg.minProposals,
+    `${preModel?.name} (${preModel?.class_names.length} classes), ${proposals} local_model proposals over ${cfg.preannotateImages} images (minimum ${cfg.minProposals})`,
+    { seconds: elapsed(), proposals },
+  );
+
+  // ------------------------------------------------ 4. label and cut dataset
+  elapsed = timer();
   stats = await api("GET", `/projects/${projectId}/stats`);
-}
-let datasets = await api("GET", `/projects/${projectId}/datasets`);
-if (datasets.items.length === 0) {
+  if (stats.labeled_count < cfg.labelCount) {
+    for (const [i, image] of page1.items.slice(0, cfg.labelCount).entries()) {
+      await openEditor(projectId, image.id);
+      await drawBox(i);
+      await sleep(200);
+    }
+    stats = await api("GET", `/projects/${projectId}/stats`);
+  }
+  let datasets = await api("GET", `/projects/${projectId}/datasets`);
+  if (datasets.items.length === 0) {
+    await openScreen("Data", "Data Manager");
+    await page.getByLabel("Labeled").selectOption("yes");
+    await page.getByRole("button", { name: "List" }).click();
+    await page.getByTestId("image-table").waitFor({ timeout: 60_000 });
+    const labeled = await api("GET", `/projects/${projectId}/images?labeled=true&limit=200&sort=path`);
+    await selectRows(labeled.items, cfg.labelCount);
+    await page.getByRole("button", { name: "Add to dataset" }).click();
+    const dialog = page.getByRole("dialog", { name: "Add to dataset" });
+    await dialog.waitFor({ timeout: 15_000 });
+    await dialog.getByLabel("Dataset name").fill("v1");
+    await dialog.getByRole("button", { name: "Create dataset" }).click();
+    await page.getByTestId(/^job-/).first().waitFor({ timeout: 30_000 });
+    const jobs = await api("GET", `/projects/${projectId}/jobs?type=dataset`);
+    const job = await waitJob(projectId, jobs.items[0].id);
+    if (job.state !== "succeeded") throw new Error(`dataset failed: ${job.error}`);
+    datasets = await api("GET", `/projects/${projectId}/datasets`);
+  }
+  const dataset = datasets.items[0];
+  const datasetDir = join(cfg.projectFolder, dataset.path);
+  const dataYaml = join(datasetDir, "data.yaml");
+  const yamlText = existsSync(dataYaml) ? readFileSync(dataYaml, "utf8") : "";
+  writeFileSync(join(cfg.evidence, "acceptance-04-data-yaml.txt"), yamlText);
+  const folders = ["images/train", "images/val", "labels/train", "labels/val"];
+  await shot(page, "04-dataset");
+  step(
+    "4. label images and freeze dataset v1 by group",
+    stats.labeled_count >= cfg.labelCount &&
+      dataset.name === "v1" &&
+      dataset.split_method === "by_group" &&
+      dataset.train_count > 0 &&
+      dataset.val_count > 0 &&
+      dataset.train_count + dataset.val_count === cfg.labelCount &&
+      folders.every((f) => existsSync(join(datasetDir, f))) &&
+      /(^|\n)train:/.test(yamlText) &&
+      /(^|\n)val:/.test(yamlText) &&
+      CLASS_NAMES.every((name) => yamlText.includes(name)),
+    `labeled ${stats.labeled_count}, train ${dataset.train_count} val ${dataset.val_count}, split ${dataset.split_method}`,
+    { seconds: elapsed(), data_yaml: dataYaml },
+  );
+
+  // ---------------------------------------------------------------- 5. train
+  elapsed = timer();
+  await openScreen("Models", "Models");
+  models = await api("GET", `/projects/${projectId}/models`);
+  let baseModel = models.items.find((m) => m.name === "yolo11n-coco");
+  if (!baseModel) {
+    await importWeights("yolo11n-coco", cfg.baseWeights);
+    baseModel = (await api("GET", `/projects/${projectId}/models`)).items.find(
+      (m) => m.name === "yolo11n-coco",
+    );
+  }
+  let trained = models.items.find((m) => m.name === "ahmadia-v1");
+  let trainJob = null;
+  let progressEvents = [];
+  if (!trained) {
+    const stream = await openEventStream();
+    try {
+      await openScreen("Train", "Train");
+      await page
+        .getByLabel("Dataset", { exact: true })
+        .locator("option", { hasText: "v1" })
+        .waitFor({ state: "attached", timeout: 60_000 });
+      await page
+        .getByLabel("Base model", { exact: true })
+        .locator("option", { hasText: "yolo11n-coco" })
+        .waitFor({ state: "attached", timeout: 60_000 });
+      await sleep(500);
+      await page.getByLabel("Base model", { exact: true }).selectOption({ label: "yolo11n-coco (Imported)" });
+      await page.getByLabel("Model name").fill("ahmadia-v1");
+      await page.getByLabel("Epochs").fill(String(cfg.epochs));
+      await page.getByLabel("Image size").fill(String(cfg.imgsz));
+      await page.getByLabel("Automatic batch size").uncheck();
+      await page.getByLabel("Batch size", { exact: true }).fill(String(cfg.batch));
+      await page.getByRole("button", { name: "Start training" }).click();
+      await page.getByTestId("train-progress").waitFor({ timeout: 60_000 });
+      await page.waitForURL(/\?job=/, { timeout: 60_000 });
+      const trainJobId = new URL(page.url()).searchParams.get("job");
+      trainJob = await waitJob(projectId, trainJobId);
+      if (trainJob.state !== "succeeded") throw new Error(`training failed: ${trainJob.error}`);
+      await sleep(1500); // the last events are still in flight when the job row goes terminal
+      progressEvents = stream.events.filter(
+        (e) => e.type === "job.progress" && e.job_id === trainJobId,
+      );
+    } finally {
+      stream.close();
+    }
+    trained = await api("GET", `/projects/${projectId}/models/${trainJob.result.model_id}`);
+  }
+  const epochText = await page
+    .getByTestId("epoch")
+    .innerText()
+    .catch(() => "");
+  await shot(page, "05-training");
+  step(
+    "5. train for the requested epochs and register the model",
+    trained.kind === "trained" &&
+      typeof trained.metrics?.map50 === "number" &&
+      typeof trained.metrics?.map50_95 === "number" &&
+      (trainJob === null || progressEvents.length >= cfg.epochs),
+    `model ${trained.name} mAP50 ${trained.metrics?.map50?.toFixed(4)} epoch card "${epochText.replace(/\s+/g, " ")}" job.progress events ${trainJob === null ? "resumed" : progressEvents.length}`,
+    {
+      seconds: elapsed(),
+      metrics: trained.metrics,
+      progress_events: progressEvents.map((e) => e.message),
+    },
+  );
+
+  // ---------------------------------------- 6. query run, review, promote
+  elapsed = timer();
   await openScreen("Data", "Data Manager");
-  await page.getByLabel("Labeled").selectOption("yes");
+  await page.getByLabel("Labeled").selectOption("no");
   await page.getByRole("button", { name: "List" }).click();
   await page.getByTestId("image-table").waitFor({ timeout: 60_000 });
-  const labeled = await api("GET", `/projects/${projectId}/images?labeled=true&limit=200&sort=path`);
-  await selectRows(labeled.items, cfg.labelCount);
-  await page.getByRole("button", { name: "Add to dataset" }).click();
-  const dialog = page.getByRole("dialog", { name: "Add to dataset" });
-  await dialog.waitFor({ timeout: 15_000 });
-  await dialog.getByLabel("Dataset name").fill("v1");
-  await dialog.getByRole("button", { name: "Create dataset" }).click();
-  await page.getByTestId(/^job-/).first().waitFor({ timeout: 30_000 });
-  const jobs = await api("GET", `/projects/${projectId}/jobs?type=dataset`);
-  const job = await waitJob(projectId, jobs.items[0].id);
-  if (job.state !== "succeeded") throw new Error(`dataset failed: ${job.error}`);
-  datasets = await api("GET", `/projects/${projectId}/datasets`);
-}
-const dataset = datasets.items[0];
-const datasetDir = join(cfg.projectFolder, dataset.path);
-const dataYaml = join(datasetDir, "data.yaml");
-const yamlText = existsSync(dataYaml) ? readFileSync(dataYaml, "utf8") : "";
-writeFileSync(join(cfg.evidence, "acceptance-04-data-yaml.txt"), yamlText);
-const folders = ["images/train", "images/val", "labels/train", "labels/val"];
-await shot(page, "04-dataset");
-step(
-  "4. label images and freeze dataset v1 by group",
-  stats.labeled_count >= cfg.labelCount &&
-    dataset.name === "v1" &&
-    dataset.train_count > 0 &&
-    dataset.val_count > 0 &&
-    dataset.train_count + dataset.val_count === cfg.labelCount &&
-    folders.every((f) => existsSync(join(datasetDir, f))) &&
-    /(^|\n)train:/.test(yamlText) &&
-    /(^|\n)val:/.test(yamlText),
-  `labeled ${stats.labeled_count}, train ${dataset.train_count} val ${dataset.val_count}, split ${dataset.split_method}`,
-  { seconds: elapsed(), data_yaml: dataYaml },
-);
-
-// ------------------------------------------------------------------ 5. train
-elapsed = timer();
-await openScreen("Models", "Models");
-models = await api("GET", `/projects/${projectId}/models`);
-let baseModel = models.items.find((m) => m.name === "yolo11n-coco");
-if (!baseModel) {
-  await importWeights("yolo11n-coco", cfg.baseWeights);
-  baseModel = (await api("GET", `/projects/${projectId}/models`)).items.find(
-    (m) => m.name === "yolo11n-coco",
+  const unlabeled = await api(
+    "GET",
+    `/projects/${projectId}/images?labeled=false&limit=${cfg.queryImages}&sort=path`,
   );
-}
-let trained = models.items.find((m) => m.name === "ahmadia-v1");
-let trainJob = null;
-if (!trained) {
-  await openScreen("Train", "Train");
+  await selectRows(unlabeled.items, cfg.queryImages);
+  await page.getByRole("button", { name: "Run model" }).click();
+  await page.getByRole("heading", { name: "Query", exact: true }).waitFor({ timeout: 60_000 });
   await page
-    .getByLabel("Dataset", { exact: true })
-    .locator("option", { hasText: "v1" })
+    .getByLabel("Model", { exact: true })
+    .locator("option", { hasText: trained.name })
     .waitFor({ state: "attached", timeout: 60_000 });
-  await page
-    .getByLabel("Base model", { exact: true })
-    .locator("option", { hasText: "yolo11n-coco" })
-    .waitFor({ state: "attached", timeout: 60_000 });
-  await sleep(500);
-  await page.getByLabel("Base model", { exact: true }).selectOption({ label: "yolo11n-coco (Imported)" });
-  await page.getByLabel("Model name").fill("ahmadia-v1");
-  await page.getByLabel("Epochs").fill(String(cfg.epochs));
-  await page.getByLabel("Image size").fill(String(cfg.imgsz));
-  await page.getByLabel("Automatic batch size").uncheck();
-  await page.getByLabel("Batch size", { exact: true }).fill(String(cfg.batch));
-  await page.getByRole("button", { name: "Start training" }).click();
-  await page.getByTestId("train-progress").waitFor({ timeout: 60_000 });
-  await page.waitForURL(/\?job=/, { timeout: 60_000 });
-  trainJob = await waitJob(projectId, new URL(page.url()).searchParams.get("job"));
-  if (trainJob.state !== "succeeded") throw new Error(`training failed: ${trainJob.error}`);
-  trained = await api("GET", `/projects/${projectId}/models/${trainJob.result.model_id}`);
-}
-const epochText = await page
-  .getByTestId("epoch")
-  .innerText()
-  .catch(() => "");
-await shot(page, "05-training");
-step(
-  "5. train for the requested epochs and register the model",
-  trained.kind === "trained" &&
-    Boolean(trained.metrics) &&
-    // Progress has to arrive and move: the poll sees the queued/running line and then at least
-    // one epoch line. How many more depends on the epoch count and the poll interval.
-    (trainJob === null || (trainJob.state === "succeeded" && trainJob.progress.length >= 2)),
-  `model ${trained.name} mAP50 ${trained.metrics?.map50?.toFixed(4)} epoch card "${epochText.replace(/\s+/g, " ")}" progress updates ${trainJob?.progress.length ?? "resumed"}`,
-  { seconds: elapsed(), metrics: trained.metrics, progress: trainJob?.progress ?? [] },
-);
-
-// -------------------------------------------- 6. query run, review, promote
-elapsed = timer();
-await openScreen("Data", "Data Manager");
-await page.getByLabel("Labeled").selectOption("no");
-await page.getByRole("button", { name: "List" }).click();
-await page.getByTestId("image-table").waitFor({ timeout: 60_000 });
-const unlabeled = await api(
-  "GET",
-  `/projects/${projectId}/images?labeled=false&limit=${cfg.queryImages}&sort=path`,
-);
-await selectRows(unlabeled.items, cfg.queryImages);
-await page.getByRole("button", { name: "Run model" }).click();
-await page.getByRole("heading", { name: "Query", exact: true }).waitFor({ timeout: 60_000 });
-await page
-  .getByLabel("Model", { exact: true })
-  .locator("option", { hasText: trained.name })
-  .waitFor({ state: "attached", timeout: 60_000 });
-await page.getByLabel("Model", { exact: true }).selectOption({ label: `${trained.name} (Trained)` });
-await page.getByLabel("Confidence", { exact: true }).fill(cfg.conf);
-await page.getByRole("button", { name: "Estimate" }).click();
-await page.getByTestId("estimate").waitFor({ timeout: 30_000 });
-await page.getByRole("button", { name: "Start" }).click();
-await page.waitForURL(/\?run=/, { timeout: 60_000 });
-const runId = new URL(page.url()).searchParams.get("run");
-let run = await api("GET", `/projects/${projectId}/query-runs/${runId}`);
-const inferJob = await waitJob(projectId, run.job_id);
-if (inferJob.state !== "succeeded") throw new Error(`query run failed: ${inferJob.error}`);
-run = await api("GET", `/projects/${projectId}/query-runs/${runId}`);
-await sleep(2000);
-await shot(page, "06-query-run");
-await page.getByRole("link", { name: "Review results" }).click();
-await page.getByRole("heading", { name: "Review queue" }).waitFor({ timeout: 60_000 });
-await shot(page, "06-review");
-await page.goBack();
-await page.getByTestId("run-card").waitFor({ timeout: 60_000 });
-await page.getByLabel("Minimum confidence").fill("0");
-await page.getByRole("button", { name: "Promote" }).click();
-await sleep(2500);
-run = await api("GET", `/projects/${projectId}/query-runs/${runId}`);
-await shot(page, "06-promoted");
-step(
-  "6. run the trained model over unlabeled images, review and promote",
-  run.image_ids.length === cfg.queryImages && Boolean(run.promoted_at),
-  `${run.image_ids.length} images, ${run.box_count} boxes, promoted_at ${run.promoted_at}`,
-  { seconds: elapsed(), box_count: run.box_count },
-);
-
-// ------------------------------------------------- 7. anthropic vision query
-elapsed = timer();
-const key = process.env.ANTHROPIC_API_KEY;
-if (key) {
-  // The key only ever travels from the environment into Credential Manager and back out again.
-  await api("PUT", "/providers/anthropic/key", { api_key: key });
-  try {
-    await openScreen("Query", "Query");
-    await page
-      .getByRole("button", { name: "New query" })
-      .click({ timeout: 3000 })
-      .catch(() => {}); // only there when a run is open
-    await page.getByLabel("Cloud provider").check();
-    await page.getByLabel("Query", { exact: true }).fill("dump trucks");
-    await page.getByLabel("Images", { exact: true }).selectOption({ label: "First N images" });
-    await page.getByLabel("Number of images").fill(String(cfg.cloudImages));
-    await page.getByLabel("Tiling").check();
-    await page.getByRole("button", { name: "Estimate" }).click();
-    await page.getByTestId("estimate").waitFor({ timeout: 30_000 });
-    await page.getByRole("button", { name: "Start" }).click();
-    await page.waitForURL(/\?run=/, { timeout: 60_000 });
-    const cloudRunId = new URL(page.url()).searchParams.get("run");
-    let cloud = await api("GET", `/projects/${projectId}/query-runs/${cloudRunId}`);
-    const cloudJob = await waitJob(projectId, cloud.job_id);
-    if (cloudJob.state !== "succeeded") throw new Error(`anthropic run failed: ${cloudJob.error}`);
-    cloud = await api("GET", `/projects/${projectId}/query-runs/${cloudRunId}`);
-    const boxes = await api(
-      "GET",
-      `/projects/${projectId}/images/${cloud.image_ids[0]}/boxes`,
-    );
-    const provided = boxes.items.filter((b) => b.provenance.kind === "cloud_provider");
-    await sleep(1500);
-    await shot(page, "07-cloud-run");
-    step(
-      "7. anthropic vision query with tiling",
-      cloud.image_ids.length === cfg.cloudImages && cloud.tiling.enabled,
-      `${cloud.box_count} boxes, tiling ${cloud.tiling.tile_size}px, provenance on the first image: ${JSON.stringify(provided[0]?.provenance ?? null)}`,
-      { seconds: elapsed(), box_count: cloud.box_count },
-    );
-  } finally {
-    await api("DELETE", "/providers/anthropic/key");
+  await page.getByLabel("Model", { exact: true }).selectOption({ label: `${trained.name} (Trained)` });
+  await page.getByLabel("Confidence", { exact: true }).fill(cfg.conf);
+  await page.getByRole("button", { name: "Estimate" }).click();
+  await page.getByTestId("estimate").waitFor({ timeout: 30_000 });
+  await page.getByRole("button", { name: "Start" }).click();
+  await page.waitForURL(/\?run=/, { timeout: 60_000 });
+  const runId = new URL(page.url()).searchParams.get("run");
+  let run = await api("GET", `/projects/${projectId}/query-runs/${runId}`);
+  const inferJob = await waitJob(projectId, run.job_id);
+  if (inferJob.state !== "succeeded") throw new Error(`query run failed: ${inferJob.error}`);
+  run = await api("GET", `/projects/${projectId}/query-runs/${runId}`);
+  await sleep(2000);
+  await shot(page, "06-query-run");
+  // Review: open the run's images in the review queue, which is where a person accepts or rejects.
+  await page.getByRole("link", { name: "Review results" }).click();
+  await page.getByRole("heading", { name: "Review queue" }).waitFor({ timeout: 60_000 });
+  // Data rows only: every one carries a select checkbox, the header row does not.
+  const reviewRows = await page
+    .getByRole("row")
+    .filter({ has: page.getByRole("checkbox") })
+    .count()
+    .catch(() => 0);
+  await shot(page, "06-review");
+  await page.goBack();
+  await page.getByTestId("run-card").waitFor({ timeout: 60_000 });
+  await page.getByLabel("Minimum confidence").fill("0");
+  await page.getByRole("button", { name: "Promote" }).click();
+  await sleep(2500);
+  run = await api("GET", `/projects/${projectId}/query-runs/${runId}`);
+  await shot(page, "06-promoted");
+  step(
+    "6. run the trained model over unlabeled images, review and promote",
+    run.image_ids.length === cfg.queryImages &&
+      run.box_count >= cfg.minQueryBoxes &&
+      Boolean(run.promoted_at),
+    `${run.image_ids.length} images, ${run.box_count} boxes (minimum ${cfg.minQueryBoxes}), ${reviewRows} review rows, promoted_at ${run.promoted_at}`,
+    { seconds: elapsed(), box_count: run.box_count },
+  );
+
+  // ----------------------------------------------- 7. anthropic vision query
+  elapsed = timer();
+  const providers = await api("GET", "/providers");
+  const anthropic = providers.items.find((p) => p.name === "anthropic");
+  // An operator's stored key is used as it is and never replaced or deleted; only a key this run
+  // put there from the environment is removed again.
+  const alreadyStored = Boolean(anthropic?.has_key);
+  const key = process.env.ANTHROPIC_API_KEY;
+  if (alreadyStored || key) {
+    if (!alreadyStored) {
+      await api("PUT", "/providers/anthropic/key", { api_key: key }, { redact: true });
+    }
+    try {
+      await openScreen("Query", "Query");
+      await page
+        .getByRole("button", { name: "New query" })
+        .click({ timeout: 3000 })
+        .catch(() => {}); // only there when a run is open
+      await page.getByLabel("Cloud provider").check();
+      await page.getByLabel("Query", { exact: true }).fill("dump trucks");
+      await page.getByLabel("Images", { exact: true }).selectOption({ label: "First N images" });
+      await page.getByLabel("Number of images").fill(String(cfg.cloudImages));
+      await page.getByLabel("Tiling").check();
+      await page.getByRole("button", { name: "Estimate" }).click();
+      await page.getByTestId("estimate").waitFor({ timeout: 30_000 });
+      await page.getByRole("button", { name: "Start" }).click();
+      await page.waitForURL(/\?run=/, { timeout: 60_000 });
+      const cloudRunId = new URL(page.url()).searchParams.get("run");
+      let cloud = await api("GET", `/projects/${projectId}/query-runs/${cloudRunId}`);
+      const cloudJob = await waitJob(projectId, cloud.job_id);
+      if (cloudJob.state !== "succeeded") throw new Error(`anthropic run failed: ${cloudJob.error}`);
+      cloud = await api("GET", `/projects/${projectId}/query-runs/${cloudRunId}`);
+      const boxes = await runBoxes(projectId, cloud);
+      const fromProvider = boxes.filter(
+        (b) => b.provenance.kind === "cloud_provider" && b.provenance.provider === "anthropic",
+      );
+      await sleep(1500);
+      await shot(page, "07-cloud-run");
+      step(
+        "7. anthropic vision query with tiling",
+        cloud.image_ids.length === cfg.cloudImages &&
+          cloud.tiling.enabled &&
+          fromProvider.length >= cfg.minCloudBoxes,
+        `${cloud.box_count} boxes, ${fromProvider.length} with anthropic provenance (minimum ${cfg.minCloudBoxes}), tiling ${cloud.tiling.tile_size}px, key ${alreadyStored ? "already stored" : "from the environment"}`,
+        { seconds: elapsed(), box_count: cloud.box_count, provider_boxes: fromProvider.length },
+      );
+    } finally {
+      if (!alreadyStored) await api("DELETE", "/providers/anthropic/key");
+    }
+  } else {
+    result.skipped.push("7. anthropic vision query: ANTHROPIC_API_KEY is not set in the environment");
+    console.log("SKIP 7. anthropic vision query (no ANTHROPIC_API_KEY)");
   }
-} else {
-  result.skipped.push("7. anthropic vision query: ANTHROPIC_API_KEY is not set in the environment");
-  console.log("SKIP 7. anthropic vision query (no ANTHROPIC_API_KEY)");
-}
 
-// ------------------------------------------------------------- 8. onnx export
-elapsed = timer();
-await openScreen("Models", "Models");
-await page.getByRole("button", { name: `Select model ${trained.name}` }).click();
-await page.getByTestId("model-detail").waitFor({ timeout: 60_000 });
-await page.getByRole("button", { name: "Export ONNX" }).click();
-await page.getByTestId(/^job-/).first().waitFor({ timeout: 30_000 });
-const exportJobs = await api("GET", `/projects/${projectId}/jobs?type=export`);
-const exportJob = await waitJob(projectId, exportJobs.items[0].id);
-if (exportJob.state !== "succeeded") throw new Error(`export failed: ${exportJob.error}`);
-const exported = await api("GET", `/projects/${projectId}/models/${trained.id}`);
-const onnx = join(cfg.projectFolder, exported.exports.onnx ?? "");
-await sleep(1000);
-await shot(page, "08-export");
-step(
-  "8. export the trained model to ONNX",
-  Boolean(exported.exports?.onnx) && existsSync(onnx) && exported.exports.onnx.startsWith("models/"),
-  `${exported.exports?.onnx}`,
-  { seconds: elapsed() },
-);
-
-writeFileSync(join(cfg.evidence, "acceptance.json"), JSON.stringify(result, null, 2));
-console.log(`\nacceptance: ${result.steps.length} steps passed, ${result.skipped.length} skipped`);
-for (const s of result.skipped) console.log(`  skipped: ${s}`);
-await browser.close();
+  // ----------------------------------------------------------- 8. onnx export
+  elapsed = timer();
+  await openScreen("Models", "Models");
+  await page.getByRole("button", { name: `Select model ${trained.name}` }).click();
+  await page.getByTestId("model-detail").waitFor({ timeout: 60_000 });
+  await page.getByRole("button", { name: "Export ONNX" }).click();
+  await page.getByTestId(/^job-/).first().waitFor({ timeout: 30_000 });
+  const exportJobs = await api("GET", `/projects/${projectId}/jobs?type=export`);
+  const exportJob = await waitJob(projectId, exportJobs.items[0].id);
+  if (exportJob.state !== "succeeded") throw new Error(`export failed: ${exportJob.error}`);
+  const exported = await api("GET", `/projects/${projectId}/models/${trained.id}`);
+  const onnx = join(cfg.projectFolder, exported.exports.onnx ?? "");
+  await sleep(1000);
+  await shot(page, "08-export");
+  step(
+    "8. export the trained model to ONNX",
+    Boolean(exported.exports?.onnx) && existsSync(onnx) && exported.exports.onnx.startsWith("models/"),
+    `${exported.exports?.onnx}`,
+    { seconds: elapsed() },
+  );
+} catch (e) {
+  result.failed_step = result.steps.length ? result.steps[result.steps.length - 1].name : "attach";
+  result.error = e instanceof Error ? e.message : String(e);
+  throw e;
+} finally {
+  // Evidence for a failed run matters more than for a passing one.
+  result.project_id = projectId || result.project_id;
+  writeFileSync(join(cfg.evidence, "acceptance.json"), JSON.stringify(result, null, 2));
+  const passed = result.steps.filter((s) => s.ok).length;
+  console.log(`\nacceptance: ${passed} steps passed, ${result.skipped.length} skipped`);
+  for (const s of result.skipped) console.log(`  skipped: ${s}`);
+  if (result.error) console.log(`  failed after: ${result.failed_step}`);
+  await browser.close();
+}
diff --git a/frontend/scripts/build-installer.ps1 b/frontend/scripts/build-installer.ps1
new file mode 100644
index 0000000..e9da7d2
--- /dev/null
+++ b/frontend/scripts/build-installer.ps1
@@ -0,0 +1,94 @@
+<#
+.SYNOPSIS
+  Build the Windows installer with Inno Setup 6 (spec section 10).
+
+.DESCRIPTION
+  Builds the Tauri app without a bundler (`pnpm tauri build --no-bundle`) and wraps the result,
+  the frozen sidecar and its `_internal` folder into a per-user setup exe with Inno Setup. Tauri's
+  own NSIS and WiX bundlers both stop at a 2 GB payload and the CUDA backend is 3.4 GB; see
+  docs/progress.md, "S6 packaging evidence".
+
+  The compiler is `node_modules/innosetup-compiler`, so nothing is installed system-wide. The
+  version comes from src-tauri/tauri.conf.json, so it is not duplicated.
+
+  Freeze the backend first: `backend\scripts\build.ps1`.
+
+.PARAMETER SkipTauriBuild
+  Compile the installer around the release binary that is already in target/release.
+
+.EXAMPLE
+  pnpm build:installer
+#>
+[CmdletBinding()]
+param([switch] $SkipTauriBuild)
+
+$ErrorActionPreference = "Stop"
+# $PSScriptRoot is not set yet while parameter defaults are evaluated on PowerShell 5.1, so every
+# path is resolved here in the body.
+$frontend = Split-Path $PSScriptRoot -Parent
+Set-Location $frontend
+$started = Get-Date
+
+$binaries = Join-Path $frontend "src-tauri\binaries"
+$sidecar = Join-Path $binaries "machinery-backend-x86_64-pc-windows-msvc.exe"
+$internal = Join-Path $binaries "_internal"
+if (-not (Test-Path $sidecar) -or -not (Test-Path $internal)) {
+  throw "the frozen backend is missing from $binaries. Run backend\scripts\build.ps1 first; it freezes the backend with PyInstaller and copies the exe and its _internal folder into the sidecar slot."
+}
+
+$iscc = Join-Path $frontend "node_modules\innosetup-compiler\bin\ISCC.exe"
+if (-not (Test-Path $iscc)) {
+  throw "the Inno Setup compiler is missing at $iscc. Run pnpm install in frontend/."
+}
+
+$version = (Get-Content (Join-Path $frontend "src-tauri\tauri.conf.json") -Raw | ConvertFrom-Json).version
+Write-Host "building the installer for version $version"
+
+if (-not $SkipTauriBuild) {
+  # pnpm and cargo write progress on stderr; PowerShell 5.1 would turn every line into an error
+  # under "Stop", so the exit code is checked by hand instead.
+  $ErrorActionPreference = "Continue"
+  & pnpm tauri build --no-bundle 2>&1 | ForEach-Object { "$_" }
+  $code = $LASTEXITCODE
+  $ErrorActionPreference = "Stop"
+  if ($code -ne 0) { throw "pnpm tauri build --no-bundle failed with exit code $code" }
+}
+
+$appExe = Join-Path $frontend "src-tauri\target\release\machinery-app.exe"
+if (-not (Test-Path $appExe)) { throw "no release binary at $appExe; run without -SkipTauriBuild" }
+
+# The WebView2 bootstrapper is Microsoft's redistributable, never committed. It is shipped only
+# when a copy is already on this machine: dropped into frontend/installer/ by hand, or left in the
+# Tauri bundler cache by an earlier NSIS build. Without it the installer still works on a machine
+# that has the runtime, which every Windows 11 machine does.
+$installerDir = Join-Path $frontend "installer"
+$bootstrapper = Join-Path $installerDir "MicrosoftEdgeWebview2Setup.exe"
+if (-not (Test-Path $bootstrapper)) {
+  $cache = Join-Path $env:LOCALAPPDATA "tauri"
+  $cached = if (Test-Path $cache) {
+    Get-ChildItem $cache -Recurse -File -Filter "MicrosoftEdgeWebview2Setup.exe" -ErrorAction SilentlyContinue |
+      Select-Object -First 1
+  } else { $null }
+  if ($cached) {
+    Copy-Item $cached.FullName $bootstrapper -Force
+    Write-Host "webview2 bootstrapper copied from the tauri cache"
+  } else {
+    Write-Warning "no MicrosoftEdgeWebview2Setup.exe found; the installer will not be able to install the WebView2 runtime on a machine that lacks it (see the README troubleshooting section)"
+  }
+}
+if (Test-Path $bootstrapper) { Write-Host "webview2 bootstrapper: $bootstrapper" }
+
+$output = Join-Path $frontend "src-tauri\target\release\bundle\inno"
+New-Item -ItemType Directory -Force $output | Out-Null
+
+$ErrorActionPreference = "Continue"
+& $iscc "/DAppVersion=$version" (Join-Path $installerDir "machinery-detection.iss") 2>&1 |
+  ForEach-Object { "$_" }
+$code = $LASTEXITCODE
+$ErrorActionPreference = "Stop"
+if ($code -ne 0) { throw "ISCC failed with exit code $code" }
+
+$setup = Join-Path $output "Machinery Detection_${version}_x64-setup.exe"
+if (-not (Test-Path $setup)) { throw "ISCC reported success but $setup is missing" }
+$elapsed = (Get-Date) - $started
+Write-Host ("installer: {0} ({1:N1} MB) in {2:N0} s" -f $setup, ((Get-Item $setup).Length / 1MB), $elapsed.TotalSeconds)
diff --git a/frontend/src-tauri/tauri.conf.json b/frontend/src-tauri/tauri.conf.json
index c58352c..360d2f7 100644
--- a/frontend/src-tauri/tauri.conf.json
+++ b/frontend/src-tauri/tauri.conf.json
@@ -20,32 +20,24 @@
         "resizable": true,
         "fullscreen": false
       }
     ],
     "security": {
       "csp": "default-src 'self'; img-src 'self' http://127.0.0.1:* data: blob:; connect-src 'self' http://127.0.0.1:* ws://127.0.0.1:*; style-src 'self' 'unsafe-inline'"
     }
   },
   "bundle": {
     "active": true,
-    "targets": ["nsis"],
+    "targets": [],
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
-    },
-    "windows": {
-      "webviewInstallMode": {
-        "type": "downloadBootstrapper"
-      },
-      "nsis": {
-        "installMode": "currentUser"
-      }
     }
   }
 }
diff --git a/scripts/acceptance.md b/scripts/acceptance.md
index 470789d..9775644 100644
--- a/scripts/acceptance.md
+++ b/scripts/acceptance.md
@@ -1,43 +1,46 @@
 # Acceptance run (spec 13.5)
 
-The acceptance run is performed **on the installed app** (`Machinery Detection` from the NSIS
-setup), not on a dev build. Every step below names the exact UI action, what to expect, and the
-evidence file it produces under `docs/evidence/acceptance/`.
+The acceptance run is performed **on the installed app** (`Machinery Detection` from the Inno
+Setup installer, `pnpm build:installer`), not on a dev build. Every step below names the exact UI
+action, what to expect, and the evidence file it produces under `docs/evidence/acceptance/`.
 
 `frontend/scripts/acceptance.mjs` performs all eight steps automatically over CDP; this document
 is the source of truth for what "passing" means and is what a person follows when driving by hand.
 
 ## Preparation
 
 1. Install the app (`Machinery Detection_0.1.0_x64-setup.exe`, per-user install, no admin needed).
 2. Launch it with the WebView2 debugging port so the driver can attach:
 
    ```powershell
    $env:WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS = "--remote-debugging-port=9222"
-   Start-Process "$env:LOCALAPPDATA\Machinery Detection\Machinery Detection.exe"
+   Start-Process "$env:LOCALAPPDATA\Programs\Machinery Detection\machinery-app.exe"
    ```
 
 3. Choose an empty project folder on a disk with room for 3299 imported frames (about 20 GB).
-4. For step 7, put the Anthropic key in the environment of the shell that runs the driver
-   (`$env:ANTHROPIC_API_KEY`). The driver stores it through `PUT /providers/anthropic/key` at
-   runtime and deletes it again afterwards; it is never written to a file, a log or a commit.
-   Without the variable the step is skipped with a clear message and the run still passes.
+4. For step 7, either leave the Anthropic key that is already in Credential Manager (the driver
+   uses it and does not touch it) or put one in the environment of the shell that runs the driver
+   (`$env:ANTHROPIC_API_KEY`). A key from the environment is stored through
+   `PUT /providers/anthropic/key` for the run and deleted again afterwards; it is never written to
+   a file, a log or a commit. With neither, the step is skipped with a clear message and the run
+   still passes.
 5. Run the driver:
 
    ```powershell
    node frontend\scripts\acceptance.mjs --project-folder E:\tmp\acceptance --evidence docs\evidence\acceptance
    ```
 
    The defaults are the real acceptance values; `--source`, `--expect-images`, `--expect-flights`,
-   `--label-count`, `--epochs`, `--query-images` and `--cloud-images` parametrise it for a dry run
-   on a small copy of the frames.
+   `--preannotate-images`, `--min-proposals`, `--label-count`, `--epochs`, `--imgsz`, `--batch`,
+   `--query-images`, `--min-query-boxes`, `--cloud-images` and `--min-cloud-boxes` parametrise it
+   for a dry run on a small copy of the frames. `--project-id` resumes a run whose import is done.
 
 ## Steps
 
 ### 1. Create project "Ahmadia" with the eight classes
 
 - **UI**: Projects screen -> `Name` = `Ahmadia`, `Folder` = the chosen folder -> **Create project**.
 - **Expect**: the app navigates to the project's Data Manager; `GET /projects/{id}` reports the
   eight default classes `excavator, wheel_loader, bulldozer, dump_truck, crane, concrete_mixer,
   roller, backhoe` with hotkeys 1-8.
 - **Evidence**: `acceptance-01-project.png`
@@ -58,61 +61,71 @@ is the source of truth for what "passing" means and is what a person follows whe
   model**. Then open the first 10 images in the editor one after another; pre-annotation runs on
   open.
 - **Expect**: the model is registered with 80 COCO class names and is the project's
   `preannotation_model_id`; at least one of the 10 images carries a box with provenance
   `local_model`.
 - **Evidence**: `acceptance-03-preannotation.png`
 
 ### 4. Label 30 images and freeze dataset "v1"
 
 - **UI**: for each of 30 images, open the editor, press hotkey `1` (excavator) and drag one box on
-  the canvas. Then Data Manager -> **List** -> tick the 30 labeled rows -> **Add to dataset** ->
-  `Dataset name` = `v1` -> **Create dataset** (split method `by_group`).
-- **Expect**: `GET /stats` reports `labeled_count` >= 30; the dataset job succeeds;
-  `train_count + val_count` == 30 with both above zero; on disk
-  `datasets/v1/images/train`, `datasets/v1/images/val`, `datasets/v1/labels/train`,
-  `datasets/v1/labels/val` exist and `datasets/v1/data.yaml` lists `path`, `train`, `val` and the
-  eight class names.
+  the canvas. Then Data Manager -> `Labeled` = `yes` -> **List** -> select the 30 rows (click the
+  first, shift-click the last) -> **Add to dataset** -> `Dataset name` = `v1` -> **Create dataset**
+  (split method `by_group`, the dialog's default).
+- **Expect**: `GET /stats` reports `labeled_count` >= 30; the dataset job succeeds; the dataset
+  is named `v1` with `split_method` `by_group` and `train_count + val_count` == 30, both above
+  zero; on disk `datasets/v1/images/train`, `datasets/v1/images/val`, `datasets/v1/labels/train`
+  and `datasets/v1/labels/val` exist, and `datasets/v1/data.yaml` lists `path`, `train`, `val`
+  and all eight class names.
 - **Evidence**: `acceptance-04-dataset.png`, `acceptance-04-data-yaml.txt`
 
 ### 5. Train YOLO11n for 3 epochs
 
-- **UI**: Train -> `Dataset` = `v1`, `Base model` = `yolo11m-coco` is the imported COCO model, so
-  import `E:\Dev\Yolo\models\yolo11n.pt` as `yolo11n-coco` first and pick it, `Model name` =
-  `ahmadia-v1`, `Epochs` = `3`, `Image size` = `1280`, `Automatic batch size` off,
-  `Batch size` = `4` -> **Start training**.
-- **Expect**: the Train screen shows a live epoch card; the job reaches `succeeded`; at least 3
-  `job.progress` events arrive over the websocket; the resulting model is registered with
-  `kind: trained` and non-empty `metrics` (`map50`, `map50_95`, `precision`, `recall`).
+- **UI**: the base model for this run is YOLO11n, so import `E:\Dev\Yolo\models\yolo11n.pt` on the
+  Models screen as `yolo11n-coco` first (**Import weights**, same dialog as step 3). Then Train ->
+  `Dataset` = `v1`, `Base model` = `yolo11n-coco`, `Model name` = `ahmadia-v1`, `Epochs` = `3`,
+  `Image size` = `1280`, `Automatic batch size` off, `Batch size` = `4` -> **Start training**.
+- **Expect**: the Train screen shows a live epoch card; the job reaches `succeeded`; at least one
+  `job.progress` event per epoch - 3 for this run - arrives on the `/api/v1/events` websocket for
+  the training job; the resulting model is registered with `kind: trained` and numeric `metrics`
+  (`map50`, `map50_95`, `precision`, `recall`).
 - **Evidence**: `acceptance-05-training.png`
 
 ### 6. Query run over 50 unlabeled images, review and promote
 
-- **UI**: Query -> `Model` = `ahmadia-v1`, `Confidence` = `0.25`, images = the unlabeled ones ->
-  **Estimate** -> **Start**. When the run finishes, set `Minimum confidence` and press **Promote**.
-- **Expect**: the inference job succeeds over 50 images; the run card reports a box count; after
-  promotion `GET /query-runs/{id}` has a non-null `promoted_at` and the promoted boxes carry
-  provenance `local_model` with the run's model id.
-- **Evidence**: `acceptance-06-query-run.png`, `acceptance-06-promoted.png`
+- **UI**: Data Manager -> `Labeled` = `no` -> **List** -> select the first 50 rows (click the first,
+  shift-click the last) -> **Run model**. On the Query screen `Model` = `ahmadia-v1`,
+  `Confidence` = `0.25` -> **Estimate** -> **Start**. **Review** when it finishes: follow
+  **Review results** on the run card, which opens the Review queue narrowed to the run's images
+  (that queue is where a person opens each image and accepts or rejects the proposals with A and
+  R). Then back on the run card set `Minimum confidence` = `0` and press **Promote**.
+- **Expect**: the inference job succeeds over exactly 50 images and writes at least one box; the
+  Review queue lists the run's images; after promotion `GET /query-runs/{id}` has a non-null
+  `promoted_at` and the promoted boxes carry provenance `local_model` with the run's model id.
+- **Evidence**: `acceptance-06-query-run.png`, `acceptance-06-review.png`,
+  `acceptance-06-promoted.png`
 
 ### 7. Anthropic vision query "dump trucks" over 5 images with tiling
 
 - **UI**: Query -> tick `Cloud provider`, `Query` = `dump trucks`, `Tiling` on, 5 images ->
   **Estimate** -> **Start**.
-- **Expect**: the job succeeds; the boxes written by the run carry provenance kind
-  `cloud_provider` with `provider: anthropic` and the model name. The key is removed from
-  Credential Manager afterwards.
-- **Skipped** with `SKIP anthropic query run (no ANTHROPIC_API_KEY)` when the variable is absent.
+- **Expect**: the job succeeds over exactly 5 images with tiling enabled, and at least one box the
+  run wrote carries provenance kind `cloud_provider` with `provider: anthropic`. A key that was
+  already in Credential Manager is used as it is and left alone; a key this run stored from the
+  environment is removed again afterwards, including when the step fails.
+- **Skipped** with `SKIP 7. anthropic vision query (no ANTHROPIC_API_KEY)` when neither a stored
+  key nor the environment variable is there.
 - **Evidence**: `acceptance-07-cloud-run.png`
 
 ### 8. Export the trained model to ONNX
 
 - **UI**: Models -> `ahmadia-v1` -> **Export ONNX**.
 - **Expect**: the export job succeeds and `models/<model>.onnx` exists inside the project folder
   with a non-zero size.
 - **Evidence**: `acceptance-08-export.png`
 
 ## Result
 
 The driver writes `docs/evidence/acceptance/acceptance.json` with, per step, the name, pass/fail,
-the measured values and the elapsed seconds, plus the list of skipped steps. A run passes when
-every step is `ok` and the only skips are ones this document allows.
+the measured values and the elapsed seconds, plus the list of skipped steps; it is written even
+when a step fails, with `failed_step` and the error. A run passes when every step is `ok` and the
+only skips are ones this document allows.
