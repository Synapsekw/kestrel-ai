# Review package: 6cdd435..9f3aa01

## Commits
9f3aa01 fix(s6): review round 2 (installed sidecar name in docs, filtered selection, installer flags)

## Files changed
 README.md                                  |  13 ++-
 backend/scripts/smoke_frozen.ps1           |  22 ++++-
 docs/progress.md                           |   2 +-
 frontend/installer/machinery-detection.iss |  10 +-
 frontend/scripts/acceptance.mjs            | 144 +++++++++++++++++++++--------
 frontend/scripts/build-installer.ps1       |   8 +-
 scripts/acceptance.md                      |  22 +++--
 7 files changed, 162 insertions(+), 59 deletions(-)

## Diff
diff --git a/README.md b/README.md
index 424128e..fe40a10 100644
--- a/README.md
+++ b/README.md
@@ -118,39 +118,48 @@ acceptance drivers use.
    ```powershell
    cd frontend
    pnpm build:installer    # -> src-tauri/target/release/bundle/inno/Machinery Detection_<version>_x64-setup.exe
    ```
 
    `frontend/scripts/build-installer.ps1` runs `pnpm tauri build --no-bundle` and then compiles
    `frontend/installer/machinery-detection.iss` with the Inno Setup 6 compiler that ships inside
    `node_modules/innosetup-compiler` - nothing is installed system-wide, and the version comes from
    `tauri.conf.json`. Pass `-SkipTauriBuild` to repackage the release binary that is already built.
 
+   The installer packs the frozen backend from `frontend/src-tauri/binaries/`, not from the Tauri
+   output, and only checks that it is there: re-run step 1 whenever the backend changed, or the
+   installer ships the previous freeze.
+
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
   install is per user into `%LOCALAPPDATA%\Programs\Machinery Detection`: no administrator rights,
   no shared install directory.
 - WebView2: the installer runs Microsoft's bootstrapper only when the runtime is missing, and only
   when a copy of `MicrosoftEdgeWebview2Setup.exe` was present at build time (see troubleshooting).
   Windows 11 ships the runtime.
-- The app installs next to the sidecar: `machinery-backend-x86_64-pc-windows-msvc.exe` with its
-  `_internal/` folder beside it. Both must stay together.
+- The app installs next to the sidecar: `machinery-app.exe`, `machinery-backend.exe` and the
+  sidecar's `_internal/` folder, all in the install directory. The names matter: the shell plugin
+  resolves a sidecar as `<folder of the running exe>\machinery-backend.exe`, and the frozen
+  backend loads `_internal/` from beside its own exe. The target triple
+  (`machinery-backend-x86_64-pc-windows-msvc.exe`) is only how the file is named in the build
+  slot, `frontend/src-tauri/binaries/`; the installer renames it on the way in. Do not rename or
+  separate them.
 - Per-user data lives in `%APPDATA%\ai.synapse-solutions.machinery-app`: `logs/`,
   `recent_projects.json`, `settings.json` and `ultralytics/` (the pre-seeded plot font). Uninstall
   removes the program directory and leaves that data alone.
 - Project data (images, labels, datasets, runs, models, `project.db`) lives in the project folder
   the operator chooses, never under the install directory.
 
 ## Run the tests
 
 ```powershell
 cd backend;  .\.venv\Scripts\python -m pytest -q; .\.venv\Scripts\python -m ruff check .
diff --git a/backend/scripts/smoke_frozen.ps1 b/backend/scripts/smoke_frozen.ps1
index ccde306..c106a39 100644
--- a/backend/scripts/smoke_frozen.ps1
+++ b/backend/scripts/smoke_frozen.ps1
@@ -6,39 +6,47 @@
   Starts dist/machinery-backend/machinery-backend.exe exactly as the Tauri sidecar does
   (APP_TOKEN / APP_PORT / APP_DATA_DIR, stdio on a pipe), then proves in one run that the bundle
   carries everything the app needs: the API answers, CUDA torch is inside, one YOLO prediction
   runs, the `worker` subcommand trains with DataLoader workers (freeze_support), ONNX export
   works, and keyring reaches Windows Credential Manager without setuptools entry points.
 
   Prints `health ok`, `cuda True <gpu name>`, `predict ok <n> boxes` and `worker ok`, and exits
   non-zero on any failure. Sample frames are copied out of the read-only source folder first.
 
 .PARAMETER Keep
-  Leave the temporary work dir behind; it is deleted on the way out by default.
+  Leave the generated work dir behind; it is deleted on the way out by default.
+
+.PARAMETER WorkDir
+  Run in this folder instead of a fresh one under TEMP. A folder given here is never deleted.
 
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
-  [switch] $Keep,  # leave the work dir (project folder, run artefacts, ONNX) on disk
-  [string] $WorkDir = (Join-Path $env:TEMP ("machinery-smoke-" + [guid]::NewGuid().ToString("N").Substring(0, 8)))
+  [switch] $Keep,  # leave the generated work dir (project folder, run artefacts, ONNX) on disk
+  [string] $WorkDir  # defaults to a fresh folder under $env:TEMP, which is the only one deleted
 )
 
 $ErrorActionPreference = "Stop"
 # $PSScriptRoot is not set yet while parameter defaults are evaluated on PowerShell 5.1.
 if (-not $Dist) { $Dist = Join-Path (Split-Path $PSScriptRoot -Parent) "dist\machinery-backend" }
+# Only a work dir this run generated is ever deleted; one the caller named is left alone.
+$generatedWorkDir = -not $WorkDir
+if ($generatedWorkDir) {
+  $WorkDir = Join-Path $env:TEMP ("machinery-smoke-" + [guid]::NewGuid().ToString("N").Substring(0, 8))
+}
 $exe = Join-Path $Dist "machinery-backend.exe"
 if (-not (Test-Path $exe)) { throw "no frozen build at $exe; run backend\scripts\build.ps1 first" }
 if (-not (Test-Path $Weights)) { throw "no weights at $Weights" }
 if (-not (Test-Path $Source)) { throw "no sample frames at $Source" }
 
 $script:Base = $null
 $script:Token = -join ((48..57 + 65..90 + 97..122) | Get-Random -Count 32 | ForEach-Object { [char]$_ })
 $timings = [ordered]@{}
 $total = [Diagnostics.Stopwatch]::StartNew()
 $step = [Diagnostics.Stopwatch]::StartNew()
@@ -225,18 +233,22 @@ try {
   Write-Host ""
   Write-Host ("bundle: {0:N1} MB at {1}" -f ($bytes / 1MB), $Dist)
   Write-Host "timings (s): $(($timings.GetEnumerator() | ForEach-Object { "$($_.Key)=$($_.Value)" }) -join ' ')"
   Write-Host "smoke ok"
 } finally {
   if (-not $proc.HasExited) {
     # /T: a training run may still own worker children of our own process tree
     & taskkill /T /F /PID $proc.Id 2>&1 | Out-Null
     $proc.WaitForExit(10000) | Out-Null
   }
-  if ($Keep) {
+  if ($Keep -or -not $generatedWorkDir) {
     Write-Host "work dir kept: $WorkDir"
   } else {
     # A run leaves a project folder, training run folders, weights and a 10 MB ONNX behind.
     Remove-Item $WorkDir -Recurse -Force -ErrorAction SilentlyContinue
-    Write-Host "work dir removed: $WorkDir (pass -Keep to inspect it)"
+    if (Test-Path $WorkDir) {
+      Write-Host "work dir could not be removed: $WorkDir"
+    } else {
+      Write-Host "work dir removed: $WorkDir (pass -Keep to inspect it)"
+    }
   }
 }
diff --git a/docs/progress.md b/docs/progress.md
index 38750c5..9a68e37 100644
--- a/docs/progress.md
+++ b/docs/progress.md
@@ -152,21 +152,21 @@ ultralytics 8.4.154, PyInstaller 6.22.3, Tauri CLI 2.11.4.
 
 | Step | Command | Result |
 |---|---|---|
 | Freeze the backend | `backend\scripts\build.ps1` | 127 s; `dist/machinery-backend` 3,457.8 MB in 14,113 files |
 | Frozen smoke test | `backend\scripts\smoke_frozen.ps1` | pass in 23.8 s: health 0.57 s, `cuda True NVIDIA GeForce RTX 5070 Ti` 3.8 s, predict, 1-epoch worker train 11.0 s, ONNX export 3.2 s, keyring round trip |
 | App binary | `pnpm tauri build` (cargo release) | 65 s; `machinery-app.exe` 11.1 MB |
 | Install tree that the installer would write | - | 3,468.9 MB (app 11.1 MB + sidecar exe and `_internal` 3,457.8 MB), well under the 6 GB success criterion |
 | NSIS installer | `pnpm tauri build` | **fails**: `makensis` `Internal compiler error #12345: error mmapping file (2057025505, 33554432) is out of range` |
 | MSI installer | `pnpm tauri build --bundles msi` | **fails**: `light.exe : error LGHT0001 : Catastrophic failure ... at Microsoft.Tools.WindowsInstallerXml.Cab.Interop.NativeMethods.CreateCabFinish` |
 | Installed layout, run from a temp copy without installing | `machinery-app.exe` from the would-be install tree | sidecar spawned, `GET /api/v1/health` 200 with `gpu {available: true, name: NVIDIA GeForce RTX 5070 Ti}`, page served from `http://tauri.localhost/`; closing the window terminated the sidecar |
-| **Inno Setup installer** | `pnpm build:installer` | **1,797.3 MB in 377 s** (ISCC alone 352.3 s) -> `frontend/src-tauri/target/release/bundle/inno/Machinery Detection_0.1.0_x64-setup.exe` |
+| **Inno Setup installer** | `pnpm build:installer` | **1,797.3 MB in 387 s** (ISCC alone 361.8 s), built without a WebView2 bootstrapper -> `frontend/src-tauri/target/release/bundle/inno/Machinery Detection_0.1.0_x64-setup.exe` |
 
 Both failures are the same 2 GB wall, reached from two directions: an NSIS installer addresses its
 payload with 32-bit offsets, and Tauri's WiX template puts everything in one embedded cabinet
 (`<Media Id="1" Cabinet="app.cab" EmbedCab="yes" />`), which the cabinet format caps at 2 GB. The
 payload cannot be brought under 2 GB by trimming: `torch/lib` alone is 2.78 GB and its large CUDA
 DLLs (`cublasLt` 456 MB, `torch_cuda` 404 MB, `cufft` 272 MB, `cudnn_engines_precompiled` 212 MB,
 `cusparse` 144 MB, `cusolver` 121 MB) are imported by name from `torch_cuda.dll`; dropping
 `cufft`/`cusolver`/`cusparse` was tried and `torch.cuda.is_available()` went false (the frozen
 smoke test caught it). Only about 205 MB is genuinely unreferenced (`cusolverMg`,
 `nvrtc64_130_0.alt`, `nvperf_host`).
diff --git a/frontend/installer/machinery-detection.iss b/frontend/installer/machinery-detection.iss
index 8fc9a71..016d0f2 100644
--- a/frontend/installer/machinery-detection.iss
+++ b/frontend/installer/machinery-detection.iss
@@ -27,22 +27,28 @@
 AppId={{B7E0B1F4-4C2E-4D6D-9C3A-2F5E6A1D9C77}
 AppName={#AppName}
 AppVersion={#AppVersion}
 AppPublisher={#AppPublisher}
 VersionInfoVersion={#AppVersion}
 ; Per user: no administrator rights and no shared install directory.
 PrivilegesRequired=lowest
 DefaultDirName={localappdata}\Programs\Machinery Detection
 DefaultGroupName={#AppName}
 DisableProgramGroupPage=yes
-ArchitecturesAllowed=x64compatible
-ArchitecturesInstallIn64BitMode=x64compatible
+; The install location is fixed because uninstall removes {app} whole: an operator who pointed
+; the install at an existing folder would lose whatever else was in it.
+DisableDirPage=yes
+UsePreviousAppDir=yes
+; x64os, not x64compatible: ARM64 Windows runs x64 code under emulation, where the CUDA sidecar
+; cannot work, so the install would succeed and the app would die on the first torch import.
+ArchitecturesAllowed=x64os
+ArchitecturesInstallIn64BitMode=x64os
 OutputDir={#OutputDir}
 OutputBaseFilename=Machinery Detection_{#AppVersion}_x64-setup
 Compression=lzma2/max
 SolidCompression=yes
 WizardStyle=modern
 SetupIconFile={#IconFile}
 UninstallDisplayName={#AppName}
 UninstallDisplayIcon={app}\machinery-app.exe
 
 [Files]
diff --git a/frontend/scripts/acceptance.mjs b/frontend/scripts/acceptance.mjs
index 9a51fe1..c8f52ea 100644
--- a/frontend/scripts/acceptance.mjs
+++ b/frontend/scripts/acceptance.mjs
@@ -6,21 +6,21 @@
 // Screenshots and a JSON summary land in the evidence folder. `scripts/acceptance.md` is the
 // prose version of the same run and the source of truth for what passing means.
 //
 // Usage:
 //   node scripts/acceptance.mjs --project-folder E:\tmp\acceptance [--evidence docs\evidence\acceptance]
 // Every expected value is a flag, so the script can be dry-run on a small copy of the frames:
 //   node scripts/acceptance.mjs --project-folder E:\tmp\dry --source E:\tmp\frames60 \
 //     --expect-images 60 --expect-flights 0031 --epochs 1 --imgsz 640 --batch 2 \
 //     --preannotate-images 3 --min-proposals 0 --min-query-boxes 0
 import { chromium } from "@playwright/test";
-import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
+import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
 import { join } from "node:path";
 
 const argv = process.argv.slice(2);
 const flag = (name, fallback) => {
   const i = argv.indexOf(`--${name}`);
   return i >= 0 && argv[i + 1] !== undefined ? argv[i + 1] : fallback;
 };
 const number = (name, fallback) => Number(flag(name, String(fallback)));
 
 const cfg = {
@@ -66,20 +66,27 @@ const CLASS_NAMES = [
   "concrete_mixer",
   "roller",
   "backhoe",
 ];
 /** `ROW_HEIGHT` in frontend/src/data/ImageTable.tsx; the table is virtualised on that grid. */
 const ROW_HEIGHT = 36;
 
 const result = { project_id: null, steps: [], skipped: [], failed_step: null, config: cfg };
 const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
 
+/** The step being worked on, so a throw from anywhere inside it names the right one. */
+let current = "attach";
+const begin = (name) => {
+  current = name;
+  return timer();
+};
+
 function step(name, ok, detail = "", extra = {}) {
   result.steps.push({ name, ok, detail, ...extra });
   console.log(`${ok ? "PASS" : "FAIL"} ${name} ${detail}`);
   if (!ok) throw new Error(`step failed: ${name}`);
 }
 
 const shot = (page, name) => page.screenshot({ path: join(cfg.evidence, `acceptance-${name}.png`) });
 
 /** The webview of the running app: `127.0.0.1:1420` in dev, `tauri.localhost` when installed. */
 async function connect() {
@@ -256,53 +263,80 @@ async function drawBox(index, attempts = 3) {
 const tableRow = (image) =>
   page.getByRole("row").filter({ has: page.getByLabel(`Select ${image.file_name}`) });
 
 /**
  * Scroll the virtualised container until a row is mounted, and hand back its locator.
  *
  * One scroll is not enough: the list grows page by page, and a scrollTop past the current
  * `scrollHeight` is clamped, so a scroll issued before the rows arrived leaves the window at the
  * top and the row never mounts.
  */
-async function revealRow(image, index, timeoutMs = 60_000) {
+async function clickRow(image, index, options = {}, timeoutMs = 60_000) {
   const locator = tableRow(image);
   const deadline = Date.now() + timeoutMs;
+  let last = null;
   while (Date.now() < deadline) {
     await page.getByTestId("image-table").evaluate((el, top) => {
       el.scrollTop = top;
     }, index * ROW_HEIGHT);
     await sleep(250);
-    if ((await locator.count()) > 0) return locator;
+    if ((await locator.count()) === 0) continue;
+    try {
+      await locator.click({ timeout: 5_000, ...options });
+      return;
+    } catch (e) {
+      last = e; // the row was unmounted again between the check and the click; scroll back
+    }
   }
-  throw new Error(`row ${index} (${image.file_name}) never entered the virtualised window`);
+  throw new Error(
+    `row ${index} (${image.file_name}) never stayed in the virtualised window long enough to click: ${last}`,
+  );
 }
 
 /**
- * Select the first `count` rows of the image table.
+ * Select the first `count` rows of the image table, which must already be showing exactly the
+ * `total` images the caller's filter matches.
  *
  * The table renders only the rows in its viewport plus a small overscan, so ticking 30 or 50
  * checkboxes by label cannot work: rows past the window are not in the DOM at all. This uses the
  * table's own range selection instead - click the first row to set the anchor, shift-click the
  * last one - which needs only those two rows mounted.
+ *
+ * The range is resolved from the ids the table currently holds, so indexing an unfiltered list
+ * would select the wrong images while the `N selected` count still matched. Opening the Data
+ * Manager remounts it at `labeled: all` and it fetches a page before the filter is applied, so
+ * two things are confirmed first: the filter bar reports the filtered total, and the row at the
+ * top of the list is the caller's first image.
  */
-async function selectRows(items, count) {
+async function selectRows(items, count, total) {
   if (items.length < count) throw new Error(`only ${items.length} rows listed, need ${count}`);
-  // The table loads a page at a time; `aria-rowcount` is how many rows it currently holds.
+  await page.getByText(new RegExp(`of ${total} images`)).waitFor({ timeout: 120_000 });
   await page.waitForFunction(
     (n) => Number(document.querySelector('[role="grid"]')?.getAttribute("aria-rowcount")) >= n,
     count,
     { timeout: 120_000 },
   );
-  await (await revealRow(items[0], 0)).click();
-  const last = await revealRow(items[count - 1], count - 1);
-  await last.click({ modifiers: ["Shift"] });
-  await page.getByText(`${count} selected`).waitFor({ timeout: 30_000 });
+  await page.getByTestId("image-table").evaluate((el) => {
+    el.scrollTop = 0;
+  });
+  await page.waitForFunction(
+    (name) => {
+      const rows = document.querySelectorAll('[data-testid="image-table"] [role="row"]');
+      return rows.length > 0 && rows[0].textContent.includes(name);
+    },
+    items[0].file_name,
+    { timeout: 60_000 },
+  );
+
+  await clickRow(items[0], 0);
+  await clickRow(items[count - 1], count - 1, { modifiers: ["Shift"] });
+  await page.getByText(`${count} selected`, { exact: true }).waitFor({ timeout: 30_000 });
 }
 
 async function importWeights(name, path) {
   await page.getByRole("button", { name: "Import weights" }).click();
   await page.getByLabel("Model name").fill(name);
   await page.getByLabel("Weights path").fill(path);
   await page.getByRole("button", { name: "Import", exact: true }).click();
   await page.getByTestId("model-detail").waitFor({ timeout: 300_000 });
 }
 
@@ -322,21 +356,21 @@ const timer = () => {
 };
 
 // Start from the Projects screen wherever the app was left (a resumed run reattaches to a
 // window that is still on a project screen).
 await go("/");
 await page.getByRole("heading", { name: "Projects" }).waitFor({ timeout: 120_000 });
 
 let projectId = cfg.projectId;
 try {
   // -------------------------------------------------------------- 1. project
-  let elapsed = timer();
+  let elapsed = begin("1. create or resume the project");
   if (projectId) {
     await go(`/p/${projectId}/data`);
     step("1. resume on an existing project", true, projectId);
   } else {
     await page.fill("#project-name", cfg.projectName);
     await page.fill("#project-folder", cfg.projectFolder);
     await page.getByRole("button", { name: "Create project" }).click();
     await page.waitForURL(/\/p\/[0-9a-f-]+\/data/, { timeout: 60_000 });
     projectId = page.url().split("/p/")[1].split("/")[0];
     const project = await api("GET", `/projects/${projectId}`);
@@ -344,21 +378,21 @@ try {
     step(
       "1. create project with the eight classes",
       project.name === cfg.projectName && project.classes.length === CLASSES,
       `${projectId} classes ${project.classes.map((c) => c.name).join(",")}`,
       { seconds: elapsed() },
     );
   }
   result.project_id = projectId;
 
   // --------------------------------------------------------------- 2. import
-  elapsed = timer();
+  elapsed = begin("2. import the source folder");
   let stats = await api("GET", `/projects/${projectId}/stats`);
   if (stats.image_count === 0) {
     await page.getByRole("button", { name: "Import images" }).click();
     const dialog = page.getByRole("dialog", { name: "Import images" });
     await dialog.waitFor({ timeout: 15_000 });
     await dialog.getByLabel("Folder").fill(cfg.source);
     await dialog.getByLabel("Site name").fill(cfg.site);
     await dialog.getByRole("button", { name: "Start import" }).click();
     await page.getByRole("dialog", { name: "Jobs" }).waitFor({ timeout: 30_000 });
     const jobs = await api("GET", `/projects/${projectId}/jobs?type=import`);
@@ -374,104 +408,127 @@ try {
     "2. import the source folder",
     stats.image_count === cfg.expectImages &&
       stats.duplicate_count === cfg.expectDuplicates &&
       flights.length === cfg.expectFlights.length &&
       cfg.expectFlights.every((f) => flights.some((k) => k.includes(f))),
     `images ${stats.image_count} duplicates ${stats.duplicate_count} flights ${flights.join(",")}`,
     { seconds: elapsed(), image_count: stats.image_count, flights },
   );
 
   // ----------------------------------------------- 3. pre-annotation model
-  elapsed = timer();
+  elapsed = begin("3. pre-annotation model proposes on at least one of the opened images");
   await openScreen("Models", "Models");
   let models = await api("GET", `/projects/${projectId}/models`);
   let preModel = models.items.find((m) => m.name === "yolo11m-coco");
   if (!preModel) {
     await importWeights("yolo11m-coco", cfg.preannotateWeights);
     await page.getByRole("button", { name: "Use as pre-annotation model" }).click();
     await sleep(1500);
     preModel = (await api("GET", `/projects/${projectId}/models`)).items.find(
       (m) => m.name === "yolo11m-coco",
     );
   }
-  const projectAfterModel = await api("GET", `/projects/${projectId}`);
+  // The editor only POSTs /preannotate when the project has a pre-annotation model, so this is
+  // checked before the loop: otherwise the wait inside it would sit there for its full timeout.
+  let projectAfterModel = await api("GET", `/projects/${projectId}`);
+  for (let i = 0; i < 20 && projectAfterModel.preannotation_model_id !== preModel?.id; i++) {
+    await sleep(500);
+    projectAfterModel = await api("GET", `/projects/${projectId}`);
+  }
+  if (projectAfterModel.preannotation_model_id !== preModel?.id) {
+    throw new Error(
+      `the project's pre-annotation model is ${projectAfterModel.preannotation_model_id}, not ${preModel?.id}: "Use as pre-annotation model" did not take`,
+    );
+  }
   const page1 = await api("GET", `/projects/${projectId}/images?limit=${cfg.labelCount}&sort=path`);
   let proposals = 0;
   for (const image of page1.items.slice(0, cfg.preannotateImages)) {
     const boxes = await openAndPreannotate(projectId, image.id);
     proposals += boxes.items.filter((b) => b.provenance.kind === "local_model").length;
   }
   await shot(page, "03-preannotation");
   step(
     "3. pre-annotation model proposes on at least one of the opened images",
     preModel !== undefined &&
       projectAfterModel.preannotation_model_id === preModel.id &&
       proposals >= cfg.minProposals,
     `${preModel?.name} (${preModel?.class_names.length} classes), ${proposals} local_model proposals over ${cfg.preannotateImages} images (minimum ${cfg.minProposals})`,
     { seconds: elapsed(), proposals },
   );
 
   // ------------------------------------------------ 4. label and cut dataset
-  elapsed = timer();
+  elapsed = begin("4. label images and freeze dataset v1 by group");
   stats = await api("GET", `/projects/${projectId}/stats`);
   if (stats.labeled_count < cfg.labelCount) {
     for (const [i, image] of page1.items.slice(0, cfg.labelCount).entries()) {
       await openEditor(projectId, image.id);
       await drawBox(i);
       await sleep(200);
     }
     stats = await api("GET", `/projects/${projectId}/stats`);
   }
   let datasets = await api("GET", `/projects/${projectId}/datasets`);
   if (datasets.items.length === 0) {
     await openScreen("Data", "Data Manager");
     await page.getByLabel("Labeled").selectOption("yes");
     await page.getByRole("button", { name: "List" }).click();
     await page.getByTestId("image-table").waitFor({ timeout: 60_000 });
     const labeled = await api("GET", `/projects/${projectId}/images?labeled=true&limit=200&sort=path`);
-    await selectRows(labeled.items, cfg.labelCount);
+    await selectRows(labeled.items, cfg.labelCount, labeled.total);
     await page.getByRole("button", { name: "Add to dataset" }).click();
     const dialog = page.getByRole("dialog", { name: "Add to dataset" });
     await dialog.waitFor({ timeout: 15_000 });
     await dialog.getByLabel("Dataset name").fill("v1");
     await dialog.getByRole("button", { name: "Create dataset" }).click();
     await page.getByTestId(/^job-/).first().waitFor({ timeout: 30_000 });
     const jobs = await api("GET", `/projects/${projectId}/jobs?type=dataset`);
     const job = await waitJob(projectId, jobs.items[0].id);
     if (job.state !== "succeeded") throw new Error(`dataset failed: ${job.error}`);
     datasets = await api("GET", `/projects/${projectId}/datasets`);
   }
   const dataset = datasets.items[0];
   const datasetDir = join(cfg.projectFolder, dataset.path);
   const dataYaml = join(datasetDir, "data.yaml");
   const yamlText = existsSync(dataYaml) ? readFileSync(dataYaml, "utf8") : "";
   writeFileSync(join(cfg.evidence, "acceptance-04-data-yaml.txt"), yamlText);
   const folders = ["images/train", "images/val", "labels/train", "labels/val"];
+  // Close the loop on the selection: the dataset folder is flat and each file is named
+  // `<site>__<file name>`, so its contents are the ids that were actually frozen.
+  const labeledNow = await api("GET", `/projects/${projectId}/images?labeled=true&limit=200&sort=path`);
+  const intendedFiles = new Set(labeledNow.items.slice(0, cfg.labelCount).map((i) => i.file_name));
+  const frozenFiles = new Set(
+    ["images/train", "images/val"]
+      .flatMap((f) => (existsSync(join(datasetDir, f)) ? readdirSync(join(datasetDir, f)) : []))
+      .map((name) => name.split("__").slice(1).join("__") || name),
+  );
+  const membersMatch =
+    frozenFiles.size === intendedFiles.size && [...intendedFiles].every((f) => frozenFiles.has(f));
   await shot(page, "04-dataset");
   step(
     "4. label images and freeze dataset v1 by group",
     stats.labeled_count >= cfg.labelCount &&
       dataset.name === "v1" &&
       dataset.split_method === "by_group" &&
       dataset.train_count > 0 &&
       dataset.val_count > 0 &&
       dataset.train_count + dataset.val_count === cfg.labelCount &&
       folders.every((f) => existsSync(join(datasetDir, f))) &&
       /(^|\n)train:/.test(yamlText) &&
       /(^|\n)val:/.test(yamlText) &&
-      CLASS_NAMES.every((name) => yamlText.includes(name)),
-    `labeled ${stats.labeled_count}, train ${dataset.train_count} val ${dataset.val_count}, split ${dataset.split_method}`,
+      CLASS_NAMES.every((name) => yamlText.includes(name)) &&
+      membersMatch,
+    `labeled ${stats.labeled_count}, train ${dataset.train_count} val ${dataset.val_count}, split ${dataset.split_method}, frozen images match the ${intendedFiles.size} labeled ones: ${membersMatch}`,
     { seconds: elapsed(), data_yaml: dataYaml },
   );
 
   // ---------------------------------------------------------------- 5. train
-  elapsed = timer();
+  elapsed = begin("5. train for the requested epochs and register the model");
   await openScreen("Models", "Models");
   models = await api("GET", `/projects/${projectId}/models`);
   let baseModel = models.items.find((m) => m.name === "yolo11n-coco");
   if (!baseModel) {
     await importWeights("yolo11n-coco", cfg.baseWeights);
     baseModel = (await api("GET", `/projects/${projectId}/models`)).items.find(
       (m) => m.name === "yolo11n-coco",
     );
   }
   let trained = models.items.find((m) => m.name === "ahmadia-v1");
@@ -504,50 +561,55 @@ try {
       if (trainJob.state !== "succeeded") throw new Error(`training failed: ${trainJob.error}`);
       await sleep(1500); // the last events are still in flight when the job row goes terminal
       progressEvents = stream.events.filter(
         (e) => e.type === "job.progress" && e.job_id === trainJobId,
       );
     } finally {
       stream.close();
     }
     trained = await api("GET", `/projects/${projectId}/models/${trainJob.result.model_id}`);
   }
-  const epochText = await page
-    .getByTestId("epoch")
-    .innerText()
-    .catch(() => "");
+  // The epoch card is the UI half of the evidence: it only reaches `n / N` because the same
+  // progress events arrived in the page. A resumed run is not on the Train screen, so there is
+  // nothing to read.
+  const epochText =
+    trainJob === null
+      ? ""
+      : (await page.getByTestId("epoch").innerText()).replace(/\s+/g, " ").trim();
   await shot(page, "05-training");
   step(
     "5. train for the requested epochs and register the model",
     trained.kind === "trained" &&
       typeof trained.metrics?.map50 === "number" &&
       typeof trained.metrics?.map50_95 === "number" &&
-      (trainJob === null || progressEvents.length >= cfg.epochs),
-    `model ${trained.name} mAP50 ${trained.metrics?.map50?.toFixed(4)} epoch card "${epochText.replace(/\s+/g, " ")}" job.progress events ${trainJob === null ? "resumed" : progressEvents.length}`,
+      (trainJob === null ||
+        (progressEvents.length >= cfg.epochs && epochText === `${cfg.epochs} / ${cfg.epochs}`)),
+    `model ${trained.name} mAP50 ${trained.metrics?.map50?.toFixed(4)} epoch card "${epochText}" job.progress events ${trainJob === null ? "resumed" : progressEvents.length}`,
     {
       seconds: elapsed(),
       metrics: trained.metrics,
       progress_events: progressEvents.map((e) => e.message),
     },
   );
 
   // ---------------------------------------- 6. query run, review, promote
-  elapsed = timer();
+  elapsed = begin("6. run the trained model over unlabeled images, review and promote");
   await openScreen("Data", "Data Manager");
   await page.getByLabel("Labeled").selectOption("no");
   await page.getByRole("button", { name: "List" }).click();
   await page.getByTestId("image-table").waitFor({ timeout: 60_000 });
   const unlabeled = await api(
     "GET",
     `/projects/${projectId}/images?labeled=false&limit=${cfg.queryImages}&sort=path`,
   );
-  await selectRows(unlabeled.items, cfg.queryImages);
+  const intendedIds = new Set(unlabeled.items.slice(0, cfg.queryImages).map((i) => i.id));
+  await selectRows(unlabeled.items, cfg.queryImages, unlabeled.total);
   await page.getByRole("button", { name: "Run model" }).click();
   await page.getByRole("heading", { name: "Query", exact: true }).waitFor({ timeout: 60_000 });
   await page
     .getByLabel("Model", { exact: true })
     .locator("option", { hasText: trained.name })
     .waitFor({ state: "attached", timeout: 60_000 });
   await page.getByLabel("Model", { exact: true }).selectOption({ label: `${trained.name} (Trained)` });
   await page.getByLabel("Confidence", { exact: true }).fill(cfg.conf);
   await page.getByRole("button", { name: "Estimate" }).click();
   await page.getByTestId("estimate").waitFor({ timeout: 30_000 });
@@ -556,45 +618,47 @@ try {
   const runId = new URL(page.url()).searchParams.get("run");
   let run = await api("GET", `/projects/${projectId}/query-runs/${runId}`);
   const inferJob = await waitJob(projectId, run.job_id);
   if (inferJob.state !== "succeeded") throw new Error(`query run failed: ${inferJob.error}`);
   run = await api("GET", `/projects/${projectId}/query-runs/${runId}`);
   await sleep(2000);
   await shot(page, "06-query-run");
   // Review: open the run's images in the review queue, which is where a person accepts or rejects.
   await page.getByRole("link", { name: "Review results" }).click();
   await page.getByRole("heading", { name: "Review queue" }).waitFor({ timeout: 60_000 });
-  // Data rows only: every one carries a select checkbox, the header row does not.
+  // The queue is virtualised, so its size is `aria-rowcount`, not the number of mounted rows.
   const reviewRows = await page
-    .getByRole("row")
-    .filter({ has: page.getByRole("checkbox") })
-    .count()
+    .getByRole("grid")
+    .getAttribute("aria-rowcount")
+    .then(Number)
     .catch(() => 0);
   await shot(page, "06-review");
   await page.goBack();
   await page.getByTestId("run-card").waitFor({ timeout: 60_000 });
   await page.getByLabel("Minimum confidence").fill("0");
   await page.getByRole("button", { name: "Promote" }).click();
   await sleep(2500);
   run = await api("GET", `/projects/${projectId}/query-runs/${runId}`);
   await shot(page, "06-promoted");
+  // Close the loop on the selection: these have to be the unlabelled images the driver picked,
+  // not just fifty of something.
+  const runsIntended =
+    run.image_ids.length === intendedIds.size && run.image_ids.every((id) => intendedIds.has(id));
   step(
     "6. run the trained model over unlabeled images, review and promote",
-    run.image_ids.length === cfg.queryImages &&
-      run.box_count >= cfg.minQueryBoxes &&
-      Boolean(run.promoted_at),
-    `${run.image_ids.length} images, ${run.box_count} boxes (minimum ${cfg.minQueryBoxes}), ${reviewRows} review rows, promoted_at ${run.promoted_at}`,
+    runsIntended && run.box_count >= cfg.minQueryBoxes && Boolean(run.promoted_at),
+    `${run.image_ids.length} images (the intended unlabelled ones: ${runsIntended}), ${run.box_count} boxes (minimum ${cfg.minQueryBoxes}), ${reviewRows} rows in the review queue, promoted_at ${run.promoted_at}`,
     { seconds: elapsed(), box_count: run.box_count },
   );
 
   // ----------------------------------------------- 7. anthropic vision query
-  elapsed = timer();
+  elapsed = begin("7. anthropic vision query with tiling");
   const providers = await api("GET", "/providers");
   const anthropic = providers.items.find((p) => p.name === "anthropic");
   // An operator's stored key is used as it is and never replaced or deleted; only a key this run
   // put there from the environment is removed again.
   const alreadyStored = Boolean(anthropic?.has_key);
   const key = process.env.ANTHROPIC_API_KEY;
   if (alreadyStored || key) {
     if (!alreadyStored) {
       await api("PUT", "/providers/anthropic/key", { api_key: key }, { redact: true });
     }
@@ -634,43 +698,43 @@ try {
       );
     } finally {
       if (!alreadyStored) await api("DELETE", "/providers/anthropic/key");
     }
   } else {
     result.skipped.push("7. anthropic vision query: ANTHROPIC_API_KEY is not set in the environment");
     console.log("SKIP 7. anthropic vision query (no ANTHROPIC_API_KEY)");
   }
 
   // ----------------------------------------------------------- 8. onnx export
-  elapsed = timer();
+  elapsed = begin("8. export the trained model to ONNX");
   await openScreen("Models", "Models");
   await page.getByRole("button", { name: `Select model ${trained.name}` }).click();
   await page.getByTestId("model-detail").waitFor({ timeout: 60_000 });
   await page.getByRole("button", { name: "Export ONNX" }).click();
   await page.getByTestId(/^job-/).first().waitFor({ timeout: 30_000 });
   const exportJobs = await api("GET", `/projects/${projectId}/jobs?type=export`);
   const exportJob = await waitJob(projectId, exportJobs.items[0].id);
   if (exportJob.state !== "succeeded") throw new Error(`export failed: ${exportJob.error}`);
   const exported = await api("GET", `/projects/${projectId}/models/${trained.id}`);
   const onnx = join(cfg.projectFolder, exported.exports.onnx ?? "");
   await sleep(1000);
   await shot(page, "08-export");
   step(
     "8. export the trained model to ONNX",
     Boolean(exported.exports?.onnx) && existsSync(onnx) && exported.exports.onnx.startsWith("models/"),
     `${exported.exports?.onnx}`,
     { seconds: elapsed() },
   );
 } catch (e) {
-  result.failed_step = result.steps.length ? result.steps[result.steps.length - 1].name : "attach";
+  result.failed_step = current;
   result.error = e instanceof Error ? e.message : String(e);
   throw e;
 } finally {
   // Evidence for a failed run matters more than for a passing one.
   result.project_id = projectId || result.project_id;
   writeFileSync(join(cfg.evidence, "acceptance.json"), JSON.stringify(result, null, 2));
   const passed = result.steps.filter((s) => s.ok).length;
   console.log(`\nacceptance: ${passed} steps passed, ${result.skipped.length} skipped`);
   for (const s of result.skipped) console.log(`  skipped: ${s}`);
-  if (result.error) console.log(`  failed after: ${result.failed_step}`);
+  if (result.error) console.log(`  failed in: ${result.failed_step}`);
   await browser.close();
 }
diff --git a/frontend/scripts/build-installer.ps1 b/frontend/scripts/build-installer.ps1
index e9da7d2..fc081dd 100644
--- a/frontend/scripts/build-installer.ps1
+++ b/frontend/scripts/build-installer.ps1
@@ -35,20 +35,25 @@ $internal = Join-Path $binaries "_internal"
 if (-not (Test-Path $sidecar) -or -not (Test-Path $internal)) {
   throw "the frozen backend is missing from $binaries. Run backend\scripts\build.ps1 first; it freezes the backend with PyInstaller and copies the exe and its _internal folder into the sidecar slot."
 }
 
 $iscc = Join-Path $frontend "node_modules\innosetup-compiler\bin\ISCC.exe"
 if (-not (Test-Path $iscc)) {
   throw "the Inno Setup compiler is missing at $iscc. Run pnpm install in frontend/."
 }
 
 $version = (Get-Content (Join-Path $frontend "src-tauri\tauri.conf.json") -Raw | ConvertFrom-Json).version
+# Inno writes the version into VersionInfoVersion, which Windows requires to be numeric: a
+# pre-release version such as 0.2.0-rc1 would otherwise fail deep inside ISCC.
+if ($version -notmatch '^\d+(\.\d+){0,3}$') {
+  throw "the version in src-tauri\tauri.conf.json is '$version'; the installer needs a numeric version such as 0.1.0 (up to four dot-separated numbers)"
+}
 Write-Host "building the installer for version $version"
 
 if (-not $SkipTauriBuild) {
   # pnpm and cargo write progress on stderr; PowerShell 5.1 would turn every line into an error
   # under "Stop", so the exit code is checked by hand instead.
   $ErrorActionPreference = "Continue"
   & pnpm tauri build --no-bundle 2>&1 | ForEach-Object { "$_" }
   $code = $LASTEXITCODE
   $ErrorActionPreference = "Stop"
   if ($code -ne 0) { throw "pnpm tauri build --no-bundle failed with exit code $code" }
@@ -84,11 +89,12 @@ New-Item -ItemType Directory -Force $output | Out-Null
 $ErrorActionPreference = "Continue"
 & $iscc "/DAppVersion=$version" (Join-Path $installerDir "machinery-detection.iss") 2>&1 |
   ForEach-Object { "$_" }
 $code = $LASTEXITCODE
 $ErrorActionPreference = "Stop"
 if ($code -ne 0) { throw "ISCC failed with exit code $code" }
 
 $setup = Join-Path $output "Machinery Detection_${version}_x64-setup.exe"
 if (-not (Test-Path $setup)) { throw "ISCC reported success but $setup is missing" }
 $elapsed = (Get-Date) - $started
-Write-Host ("installer: {0} ({1:N1} MB) in {2:N0} s" -f $setup, ((Get-Item $setup).Length / 1MB), $elapsed.TotalSeconds)
+$webview2 = if (Test-Path $bootstrapper) { "with the WebView2 bootstrapper" } else { "without a WebView2 bootstrapper" }
+Write-Host ("installer: {0} ({1:N1} MB, {2}) in {3:N0} s" -f $setup, ((Get-Item $setup).Length / 1MB), $webview2, $elapsed.TotalSeconds)
diff --git a/scripts/acceptance.md b/scripts/acceptance.md
index 9775644..7b02adf 100644
--- a/scripts/acceptance.md
+++ b/scripts/acceptance.md
@@ -3,20 +3,22 @@
 The acceptance run is performed **on the installed app** (`Machinery Detection` from the Inno
 Setup installer, `pnpm build:installer`), not on a dev build. Every step below names the exact UI
 action, what to expect, and the evidence file it produces under `docs/evidence/acceptance/`.
 
 `frontend/scripts/acceptance.mjs` performs all eight steps automatically over CDP; this document
 is the source of truth for what "passing" means and is what a person follows when driving by hand.
 
 ## Preparation
 
 1. Install the app (`Machinery Detection_0.1.0_x64-setup.exe`, per-user install, no admin needed).
+   It writes `machinery-app.exe`, `machinery-backend.exe` and the sidecar's `_internal/` folder
+   into `%LOCALAPPDATA%\Programs\Machinery Detection`; those three stay together.
 2. Launch it with the WebView2 debugging port so the driver can attach:
 
    ```powershell
    $env:WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS = "--remote-debugging-port=9222"
    Start-Process "$env:LOCALAPPDATA\Programs\Machinery Detection\machinery-app.exe"
    ```
 
 3. Choose an empty project folder on a disk with room for 3299 imported frames (about 20 GB).
 4. For step 7, either leave the Anthropic key that is already in Credential Manager (the driver
    uses it and does not touch it) or put one in the environment of the shell that runs the driver
@@ -61,52 +63,56 @@ is the source of truth for what "passing" means and is what a person follows whe
   model**. Then open the first 10 images in the editor one after another; pre-annotation runs on
   open.
 - **Expect**: the model is registered with 80 COCO class names and is the project's
   `preannotation_model_id`; at least one of the 10 images carries a box with provenance
   `local_model`.
 - **Evidence**: `acceptance-03-preannotation.png`
 
 ### 4. Label 30 images and freeze dataset "v1"
 
 - **UI**: for each of 30 images, open the editor, press hotkey `1` (excavator) and drag one box on
-  the canvas. Then Data Manager -> `Labeled` = `yes` -> **List** -> select the 30 rows (click the
-  first, shift-click the last) -> **Add to dataset** -> `Dataset name` = `v1` -> **Create dataset**
-  (split method `by_group`, the dialog's default).
+  the canvas. Then Data Manager -> `Labeled` = `yes` -> **List** -> wait until the filter bar reads
+  the labeled total -> select the 30 rows (click the first, shift-click the last) -> **Add to
+  dataset** -> `Dataset name` = `v1` -> **Create dataset** (split method `by_group`, the dialog's
+  default).
 - **Expect**: `GET /stats` reports `labeled_count` >= 30; the dataset job succeeds; the dataset
   is named `v1` with `split_method` `by_group` and `train_count + val_count` == 30, both above
   zero; on disk `datasets/v1/images/train`, `datasets/v1/images/val`, `datasets/v1/labels/train`
   and `datasets/v1/labels/val` exist, and `datasets/v1/data.yaml` lists `path`, `train`, `val`
-  and all eight class names.
+  and all eight class names; the images frozen into the dataset folder are exactly the 30 labeled
+  ones.
 - **Evidence**: `acceptance-04-dataset.png`, `acceptance-04-data-yaml.txt`
 
 ### 5. Train YOLO11n for 3 epochs
 
 - **UI**: the base model for this run is YOLO11n, so import `E:\Dev\Yolo\models\yolo11n.pt` on the
   Models screen as `yolo11n-coco` first (**Import weights**, same dialog as step 3). Then Train ->
   `Dataset` = `v1`, `Base model` = `yolo11n-coco`, `Model name` = `ahmadia-v1`, `Epochs` = `3`,
   `Image size` = `1280`, `Automatic batch size` off, `Batch size` = `4` -> **Start training**.
 - **Expect**: the Train screen shows a live epoch card; the job reaches `succeeded`; at least one
   `job.progress` event per epoch - 3 for this run - arrives on the `/api/v1/events` websocket for
   the training job; the resulting model is registered with `kind: trained` and numeric `metrics`
   (`map50`, `map50_95`, `precision`, `recall`).
 - **Evidence**: `acceptance-05-training.png`
 
 ### 6. Query run over 50 unlabeled images, review and promote
 
-- **UI**: Data Manager -> `Labeled` = `no` -> **List** -> select the first 50 rows (click the first,
-  shift-click the last) -> **Run model**. On the Query screen `Model` = `ahmadia-v1`,
+- **UI**: Data Manager -> `Labeled` = `no` -> **List** -> wait until the filter bar reads the
+  unlabeled total -> select the first 50 rows (click the first, shift-click the last) -> **Run
+  model**. On the Query screen `Model` = `ahmadia-v1`,
   `Confidence` = `0.25` -> **Estimate** -> **Start**. **Review** when it finishes: follow
   **Review results** on the run card, which opens the Review queue narrowed to the run's images
   (that queue is where a person opens each image and accepts or rejects the proposals with A and
   R). Then back on the run card set `Minimum confidence` = `0` and press **Promote**.
-- **Expect**: the inference job succeeds over exactly 50 images and writes at least one box; the
-  Review queue lists the run's images; after promotion `GET /query-runs/{id}` has a non-null
+- **Expect**: the inference job succeeds over exactly the 50 unlabeled images that were selected
+  (`run.image_ids` is that set, not just 50 of anything) and writes at least one box; the Review
+  queue lists the run's images; after promotion `GET /query-runs/{id}` has a non-null
   `promoted_at` and the promoted boxes carry provenance `local_model` with the run's model id.
 - **Evidence**: `acceptance-06-query-run.png`, `acceptance-06-review.png`,
   `acceptance-06-promoted.png`
 
 ### 7. Anthropic vision query "dump trucks" over 5 images with tiling
 
 - **UI**: Query -> tick `Cloud provider`, `Query` = `dump trucks`, `Tiling` on, 5 images ->
   **Estimate** -> **Start**.
 - **Expect**: the job succeeds over exactly 5 images with tiling enabled, and at least one box the
   run wrote carries provenance kind `cloud_provider` with `provider: anthropic`. A key that was
