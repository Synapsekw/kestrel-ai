# S6 packaging and acceptance - implementer report

Branch `s6-packaging-acceptance` (worktree `E:\Dev\Yolo\app\.worktrees\s6-packaging-acceptance`),
based on main `f52267c`. Nothing pushed, `main` untouched, no `git clean`.

| Commit | Subject |
|---|---|
| `eb3189b` | build: full pyinstaller bundle with cuda torch; frozen smoke script |
| `4268a96` | chore: packaging hardening (orphan sweep, font pre-seed, sidecar log, csp) |
| `2e1b36c` | docs: installer build and install evidence |
| `3f49daf` | test: acceptance script and driver |
| `02359a9` | docs: readme for build, install, run and tests |

**Status: tasks 1, 2, 4 and 5 are done. Task 3 is BLOCKED on a decision the goal owner owns:
neither Tauri bundler can package a 3.4 GB sidecar.** Details and options in "Task 3" below and in
`docs/progress.md` under "S6 packaging evidence".

A directory junction `backend/.venv` -> `E:\Dev\Yolo\app\backend\.venv` was created in the worktree
(the Wave 1 mechanic recorded in `docs/progress.md`); `build.ps1` resolves the interpreter that way.
No package was installed, upgraded or removed.

---

## Task 1 - full PyInstaller spec and frozen smoke script (`eb3189b`)

### What I implemented

- `backend/machinery_backend.spec`: the S0 `excludes` line is gone. `hiddenimports` is
  `collect_submodules("app") + collect_submodules("ultralytics")` plus the list from the brief;
  `datas` is the Alembic migrations plus `collect_data_files` for ultralytics and torch; `binaries`
  is `collect_dynamic_libs` for torch, torchvision and onnxruntime. `collect_all("ultralytics")`
  was not needed - `_internal/ultralytics/cfg/` carries `default.yaml`, `models/` and `trackers/`.
- Two deviations from the brief's literal list, both commented in the spec:
  - **added** `torchvision._C_stable` and `torchvision.image_stable`. torchvision 0.29 renamed its
    extension and loads it through `torch.ops.load_library(<path>)`, not an import, so PyInstaller
    cannot see it. Without it the bundle starts and health passes, but the first prediction dies
    with `RuntimeError: operator torchvision::nms does not exist`. This is what the first smoke run
    found (see "TDD evidence" below); the upstream hook still names the pre-0.29 `torchvision._C`
    and `torchvision.image`, which no longer exist.
  - **omitted** `pywin32_system32`. It is not a module in this venv (`find_spec` returns None);
    keyring reaches Credential Manager through `win32ctypes.pywin32` (pywin32-ctypes, pure ctypes),
    which is in the list. Naming it would only add a build warning. The keyring round trip in the
    smoke script proves the omission is safe.
- `console=False`, as the brief prefers. Verified two ways: the smoke script reads the startup JSON
  line off a redirected stdout, and `pnpm tauri dev` with the real sidecar logged
  `[backend] {"event": "starting", "port": 62367, "pid": 46800}` - that line arrived as
  `CommandEvent::Stdout`. A windowed exe also keeps the training worker subprocess (which the frozen
  exe spawns for every run) from flashing a console window.
- `backend/app/health.py`: `GpuProbe` runs `probe_cuda()` once in a background thread, started by
  the first health request. `snapshot()` never blocks: `None` (so `gpu` is absent) while the probe
  runs, `{"available": false, "name": null}` once it has taken longer than 10 s, and the real answer
  as soon as it arrives - a late answer replaces the fallback. `create_app` owns the probe.
- `backend/scripts/smoke_frozen.ps1`: starts `dist/machinery-backend/machinery-backend.exe` with
  `APP_TOKEN` / `APP_PORT=0` / `APP_DATA_DIR` exactly as the sidecar does, parses the port from the
  JSON line, polls health (fail after 20 s), waits for the `gpu` block, then creates a project,
  imports 3 frames copied out of `E:\Dev\Yolo\data\raw\ahmadia`, imports `yolo11n.pt`, pre-annotates
  one image at `imgsz 640`, labels the frames, freezes a dataset, trains 1 epoch through the frozen
  `worker` subcommand (DataLoader workers, so `freeze_support()` is exercised), exports ONNX, runs a
  keyring round trip and kills the process tree by PID. Prints `health ok`, `cuda True <name>`,
  `predict ok <n> boxes`, `worker ok`, per-step timings and the bundle size; non-zero on any failure.
- `backend/scripts/build.ps1`: unchanged interface, plus a size and duration report at the end.

### TDD evidence

**`Health.gpu`** - RED (`backend`, `.venv\Scripts\python -m pytest tests/test_health.py -q`):

```
tests\test_health.py:4: in <module>
    from app.health import GpuProbe
E   ImportError: cannot import name 'GpuProbe' from 'app.health'
1 error in 0.18s
```

GREEN, same command:

```
......                                                                   [100%]
6 passed in 0.61s
```

The six cases: health omits `gpu` while the probe runs; health reports it once the probe answers;
the probe runs exactly once; it falls back to "no GPU" after the timeout and still self-heals when
a late answer arrives; a raising probe reports no GPU; and the real candidate list resolves.

**`torchvision._C_stable`** - the RED here was the smoke script against the first full bundle:

```
startup ok port 57276 pid 35488
health ok
cuda True NVIDIA GeForce RTX 5070 Ti
import ok 3 images
model ok yolo11n-coco 80 classes
POST /projects/.../images/.../preannotate failed: (500) Internal Server Error
```

with, in the sidecar's own log:

```
  File "ultralytics\nn\autobackend.py", line 357, in warmup
    import torchvision  # noqa (import here triggers torchvision NMS use in nms.py)
  File "torchvision\_meta_registrations.py", line 163, in <module>
    @torch.library.register_fake("torchvision::nms")
RuntimeError: operator torchvision::nms does not exist
```

`_internal/torchvision/` had no `_C_stable.pyd`. GREEN is the smoke output below.

### `build.ps1` output (rebuild with the fix)

```
sidecar copied to E:\Dev\Yolo\app\.worktrees\s6-packaging-acceptance\backend\..\frontend\src-tauri\binaries
dist/machinery-backend: 3,457.8 MB in 14,113 files; build took 127 s
```

The only build warnings are from upstream hooks (`torchvision._C` / `torchvision.image` not found -
the pre-0.29 names; `tzdata`, `scipy.special._cdflib`, `pysqlite2`, `MySQLdb`, `tensorboard`).

### `smoke_frozen.ps1` output (exit code 0)

```
startup ok port 62974 pid 10680
health ok
cuda True NVIDIA GeForce RTX 5070 Ti
import ok 3 images
model ok yolo11n-coco 80 classes
predict ok 0 boxes
dataset ok train 2 val 1
worker ok mAP50 0.0
font ok C:\Users\D\AppData\Local\Temp\machinery-smoke-9623c93b\appdata\ultralytics\Arial.ttf
export ok ...\project\models\smoke-7024be09.onnx 10.1 MB
keyring ok (stored and removed a placeholder through Credential Manager)

bundle: 3,457.8 MB at ...\backend\dist\machinery-backend
timings (s): startup_line=1.23 health=0.57 cuda=3.82 create_project=0.11 import=1.1
             import_model=0.37 predict=1.86 dataset=0.6 worker_train=10.95 export_onnx=3.16
             keyring=0.06 total=23.83
smoke ok
```

`dist/machinery-backend` is **3,457.8 MB**. `predict ok 0 boxes` is the expected result for COCO
yolo11n on a nadir aerial frame at `imgsz 640` (checkpoint 3 saw the same); the prediction path is
still proven - it is where the missing `torchvision::nms` used to fail - and the training run's
validation exercises `torchvision.ops.nms` for real.

The keyring step reads the stored-key state first and skips with a message if a key is already
there, so it can never destroy an operator's own Anthropic key. The placeholder it writes
(`frozen-smoke-placeholder-not-a-key`) is not a secret and is deleted in the same step.

---

## Task 2 - hardening (`4268a96`)

### What I implemented

- **Orphan sweep** `backend/app/jobs/startup.py`. `sweep_orphans(project, runner)` turns `running`
  rows into `failed` with error `interrupted by application restart` and `queued` rows into
  `cancelled`, both with `finished_at`, and publishes the usual `job.state` events. Rows whose job
  the runner is still holding (`JobRunner.is_live`, new) belong to this process and are left alone.
  Projects open lazily, so the sweep hangs off `ProjectRegistry(data_dir, on_open=...)` (new
  optional constructor argument, wired in `create_app`'s lifespan) rather than running once at
  startup.
- **Arial pre-seed** `backend/app/training/fonts.py`. `configure_ultralytics()` points
  `YOLO_CONFIG_DIR` at `<app data>/ultralytics` (or whatever the launcher already chose, else the
  inherited `APP_DATA_DIR`) and copies a font into it as `Arial.ttf` - the machine's own
  `%WINDIR%\Fonts\arial.ttf` first, then matplotlib's `DejaVuSans.ttf`, which is inside the frozen
  bundle. Nothing is redistributed and nothing is downloaded. Called from `worker.main()` next to
  the existing `YOLO_VERBOSE` / `YOLO_AUTOINSTALL` defaults, so it is part of the worker's setup
  step and covers both training and export.
- **Sidecar log** `frontend/src-tauri/src/logfile.rs` (new): `RotatingLog` appends one line per
  event and rolls over once at 5 MB (`sidecar.log` -> `sidecar.log.1`). `sidecar.rs` tees every
  `CommandEvent::Stdout`/`Stderr` (and the termination line) into
  `<app data>/logs/sidecar.log` in addition to the console, and carries `log_path`, which is `None`
  in env mode because that backend is not ours to log. `backend_info` returns `log_path`,
  `resolveBackend` maps it to `BackendInfo.logPath`, and the backend failure dialog shows a **Log**
  row when there is one.
- **`tauri.conf.json`**: the CSP from the brief verbatim, `bundle.windows.nsis.installMode`
  `currentUser`; `version` was already 0.1.0.

### TDD evidence

**Orphan sweep** - RED (`python -m pytest tests/test_job_startup.py -q`):

```
tests\test_job_startup.py:11: in <module>
    from app.jobs.startup import RESTART_ERROR, sweep_orphans
E   ModuleNotFoundError: No module named 'app.jobs.startup'
1 error in 0.35s
```

GREEN: `4 passed in 0.81s` (running -> failed with the message and `finished_at`, queued ->
cancelled with no error, a live job of this process untouched, a terminal-only project is a no-op,
and opening the project in a fresh `ProjectRegistry` sweeps it).

**Font pre-seed** - RED (`python -m pytest tests/test_ultralytics_env.py -q`):

```
tests\test_ultralytics_env.py:6: in <module>
    from app.training import fonts, worker
E   ImportError: cannot import name 'fonts' from 'app.training'
1 error in 0.19s
```

GREEN: `9 passed in 0.09s`, including "this machine has a font candidate" and "the worker seeds the
font before it does anything else" (calling `worker.main(["train", <missing params>])` returns 1 and
the font is on disk anyway). The frozen smoke script asserts the same file after a real training
run: `font ok ...\appdata\ultralytics\Arial.ttf`.

**Rotating sidecar log** - RED with rotation not yet wired in (`cargo test --lib`):

```
running 3 tests
test logfile::tests::rolls_over_once_the_limit_is_reached ... FAILED
test logfile::tests::keeps_only_one_previous_file ... FAILED
test logfile::tests::appends_lines_and_creates_the_folder ... ok
...
called `Result::unwrap()` on an `Err` value: Os { code: 2, kind: NotFound }
test result: FAILED. 1 passed; 2 failed
```

A second RED after the first live run showed blank lines between entries (the shell plugin hands
over the child's line ending):

```
---- logfile::tests::writes_one_line_per_event_whatever_line_ending_it_arrived_with stdout ----
assertion `left == right` failed
  left: "plain\nwith crlf\n\nwith lf\n\n"
 right: "plain\nwith crlf\nwith lf\n"
```

GREEN: `test result: ok. 4 passed; 0 failed`. `cargo fmt --check` is clean.

**Log path in the dialog** - RED (`npx vitest run src/api/client.test.tsx src/api/backend.test.ts`):

```
expect(screen.getByText("Log")).toBeInTheDocument();
Unable to find an element with the text: Log
 Test Files  1 failed | 1 passed (2)
      Tests  1 failed | 6 passed (7)
```

GREEN: `Test Files 2 passed (2) / Tests 8 passed (8)` - the dialog shows the path reported by
`backend_info` and leaves the row out when this launch owns no sidecar log; `backend.test.ts` gained
a case for `logPath` being null in env mode.

### Live verification (not just unit tests)

`pnpm tauri dev` with the frozen sidecar and `WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=--remote-debugging-port=9222`:

```
backend_info: {"base_url":"http://127.0.0.1:62367",
               "log_path":"C:\\Users\\D\\AppData\\Roaming\\ai.synapse-solutions.machinery-app\\logs\\sidecar.log",
               "token":"..."}
console messages:
  debug: [vite] connecting... / connected.
  info: Download the React DevTools ...
  warning: React Router Future Flag Warning ...
  warning: WebSocket ... closed before the connection is established   (the reload race, pre-existing)
csp violations: 0
```

and the file itself:

```
C:\Users\D\AppData\Roaming\ai.synapse-solutions.machinery-app\logs\sidecar.log
{"event": "starting", "port": 62367, "pid": 46800}
INFO:     Started server process [46800]
INFO:     Waiting for application startup.
...
```

So: the CSP does not break the app (Konva draws on a canvas, no violations), the sidecar spawns from
the frozen build, the tee works and `backend_info` carries the path.

**Keyring pin in the frozen build** (the Wave 2 deferred item): verified through the real providers
key endpoint inside the frozen exe, not a `--selftest` path - `smoke_frozen.ps1` stores a
placeholder through `PUT /providers/anthropic/key`, sees `has_key` become true, deletes it and sees
it become false again (`keyring ok` above). That exercises `KeyringKeyStore._keyring()` pinning
`WinVaultKeyring` with no entry points present.

---

## Task 3 - installer build: BLOCKED (`2e1b36c`)

`pnpm tauri build` builds the app (65 s, `machinery-app.exe` 11.1 MB) and then fails in the bundler:

```
     Running makensis to produce ...\bundle\nsis\Machinery Detection_0.1.0_x64-setup.exe
Internal compiler error #12345: error mmapping file (2057025505, 33554432) is out of range.
failed to bundle project: `Failed to bundle app with makensis`
```

NSIS addresses its payload with 32-bit offsets and gives up at 2 GB; the payload is 3.4 GB. I then
tested the other Windows target Tauri offers (CLI flag only, no config change committed):

```
pnpm tauri build --bundles msi --verbose
...
light.exe : error LGHT0001 : Catastrophic failure (Exception from HRESULT: 0x8000FFFF)
Exception Type: System.Runtime.InteropServices.COMException
   at Microsoft.Tools.WindowsInstallerXml.Cab.Interop.NativeMethods.CreateCabFinish(...)
   at Microsoft.Tools.WindowsInstallerXml.Cab.WixCreateCab.Complete(...)
failed to bundle project: `failed to run ...\WixTools314\light.exe`
```

Same 2 GB wall from the other side: Tauri's generated `main.wxs` uses a single embedded cabinet
(`<Media Id="1" Cabinet="app.cab" EmbedCab="yes" />`) and the cabinet format caps a cab at 2 GB.

**Trimming does not get under it.** `_internal` is 3,426 MB, of which `torch` is 2,905 MB and
`torch/lib` 2,782 MB: `cublasLt64_13` 456, `torch_cuda` 404, `torch_cpu` 292, `cufft64_12` 272,
`cudnn_engines_precompiled64_9` 212, `cusparse64_12` 144, `cusolver64_12` 121, `cudnn_graph64_9`
106, `cudnn_adv64_9` 102 MB. I removed 741 MB of plausible-looking CUDA libraries and re-ran the
smoke test, which caught it immediately:

```
startup ok port 56252 pid 42752
health ok
cuda False: the frozen build cannot see the GPU
```

`torch_cuda.dll` names `cufft64_12.dll`, `cusolver64_12.dll` and `cusparse64_12.dll` in its imports
and `torch_cpu.dll` names `cupti64_2025.3.0.dll`, so those have to stay. Scanning every DLL in
`torch/lib` for reverse references leaves only `cusolverMg64_12` (91 MB), `nvrtc64_130_0.alt`
(87 MB) and `nvperf_host` (27 MB) genuinely unreferenced - 205 MB, plus about 107 MB of build-only
`torch/include` and `torch/lib/*.lib`. Nowhere near the 1.5 GB that would be needed, and the only
way past that is to stop shipping CUDA torch, which the spec requires.

**What is measured and fine:** the install tree the installer would write is **3,468.9 MB**
(app 11.1 MB + sidecar exe and `_internal` 3,457.8 MB), comfortably inside the 6 GB success
criterion. The `_internal` resource mapping is correct - `pnpm tauri dev` resolves the sidecar next
to its `_internal` and the sidecar starts, and `target/release/_internal` is staged beside the exe.

**Decision needed (goal owner).** Written up in `docs/progress.md`:

1. A custom WiX template (`bundle.windows.wix.template`) with
   `<MediaTemplate EmbedCab="yes" MaximumUncompressedMediaSize="..."/>`, which splits the payload
   over several cabinets. Smallest change that still yields one installer file; changes the format
   from NSIS to MSI, which is a spec-10 change and not mine to make.
2. A third-party installer that handles >2 GB (Inno Setup 6), built outside the Tauri bundler from
   `target/release` plus `src-tauri/binaries`.
3. Ship the app and the sidecar payload separately, or distribute a portable folder.

Everything downstream - install, cold start, checkpoint 4, the acceptance run on the installed app -
waits on that choice. Per the brief I did not install anything, time a cold start, or run the
acceptance flow on an installed app.

---

## Task 4 - acceptance script and driver (`3f49daf`)

- `scripts/acceptance.md`: preparation (including how to launch the installed app with the CDP port
  and how the Anthropic key is handled), then the eight steps of spec 13.5 with the exact UI
  actions, the expected values (3299 images, 0 duplicates, the 7 flights, at least one proposal over
  10 images, 30 labeled, dataset `v1` by group with train/val folders and a valid `data.yaml`,
  YOLO11n for 3 epochs with progress and metrics, 50 unlabeled images run/reviewed/promoted, an
  Anthropic "dump trucks" query over 5 images with tiling and provider provenance, an ONNX export
  under `models/`) and the evidence file name for each.
- `frontend/scripts/acceptance.mjs`: the same eight steps over CDP, following `checkpoint3.mjs`.
  Attaches to `127.0.0.1:1420` **or** `tauri.localhost`, so it works in dev and against the
  installed app. Screens are opened by clicking the sidebar links; per-image editor routes use
  `pushState` + `popstate` instead of `page.goto`, because a deep URL under `tauri.localhost` is not
  a file the asset protocol serves. Assertions go through the API reached from `backend_info`.
  Screenshots and `acceptance.json` (per step: name, ok, detail, seconds, measured values, plus the
  skip list) land in the evidence folder. The import allows 60 minutes.
  Every expected value is a flag (`--source`, `--expect-images`, `--expect-flights`,
  `--label-count`, `--epochs`, `--imgsz`, `--batch`, `--preannotate-images`, `--min-proposals`,
  `--query-images`, `--cloud-images`, `--conf`, `--import-timeout-min`), defaulting to the real
  acceptance values; `--project-id` resumes a run whose import has already finished.
  The Anthropic step reads `ANTHROPIC_API_KEY` from the environment, stores it through
  `PUT /providers/anthropic/key` for the run, deletes it in a `finally`, and skips with
  `SKIP 7. anthropic vision query (no ANTHROPIC_API_KEY)` when the variable is absent.

### Dry run

Dev app in env mode (dev backend from the venv on 8765, `pnpm tauri dev` with `APP_BACKEND_URL` /
`APP_BACKEND_TOKEN` and `WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=--remote-debugging-port=9222`), on a
20-frame copy of `E:\Dev\Yolo\data\raw\ahmadia` in a temp folder. Final clean run, exit code 0:

```
node scripts\acceptance.mjs --project-folder ...\project3 --evidence ...\evidence3
  --project-name "Ahmadia dry run" --source ...\frames20 --expect-images 20 --expect-flights 0031
  --preannotate-images 3 --min-proposals 0 --label-count 6 --epochs 1 --imgsz 640 --batch 2
  --query-images 5 --cloud-images 2 --conf 0.01

PASS 1. create project with the eight classes 72468d81-... classes excavator,wheel_loader,bulldozer,dump_truck,crane,concrete_mixer,roller,backhoe
PASS 2. import the source folder images 20 duplicates 0 flights 0031
PASS 3. pre-annotation model proposes on at least one of the opened images yolo11m-coco (80 classes), 0 local_model proposals over 3 images (minimum 0)
PASS 4. label images and freeze dataset v1 by group labeled 6, train 5 val 1, split by_group
PASS 5. train for the requested epochs and register the model model ahmadia-v1 mAP50 0.0000 epoch card "1 / 1" progress updates 2
PASS 6. run the trained model over unlabeled images, review and promote 5 images, 0 boxes, promoted_at 2026-09-18T09:19:29.666662Z
SKIP 7. anthropic vision query (no ANTHROPIC_API_KEY)
PASS 8. export the trained model to ONNX models/ahmadia-v1-125e7290.onnx

acceptance: 7 steps passed, 1 skipped
  skipped: 7. anthropic vision query: ANTHROPIC_API_KEY is not set in the environment
```

Evidence written: `acceptance.json`, `acceptance-01-project.png` ... `acceptance-08-export.png` and
`acceptance-04-data-yaml.txt`, which contains

```
path: '...\project3\datasets\v1'
train: images/train
val: images/val
names:
  0: 'excavator'
  ... 7: 'backhoe'
```

An earlier run of the same driver also exercised the resume path (`--project-id`) end to end.

### What the dry run broke, and the fixes

1. **Training progress assertion too strict.** `trainJob.progress.length >= 3` fails for a 1-epoch
   dry run. Changed to `>= 2` (the queued/running line plus at least one epoch line) - how many
   more arrive depends on the epoch count and the poll interval, so a fixed number is the wrong
   assertion. Driver-only.
2. **The driver assumed the app was on the Projects screen.** A resumed run reattaches to a window
   that is still on a project screen. The driver now routes to `/` first. Driver-only.
3. **The editor readiness wait was wrong, and it cost a labelling step.** `data-view-scale > 0` is
   true immediately after a route change, because the store's `INITIAL_VIEW.scale` is `1` and only
   becomes the fitted scale once the image record arrives. On images that had already been opened
   the load was fast enough to hide it; the first cold image failed - the drag landed before the
   Konva stage existed and no box was written (confirmed through the API: 3 boxes on the three
   warm images, 0 on the fourth). The driver now waits for `data-image` to be set **and** the
   stage's canvases to exist, and retries the drag up to three times with a logged message. This is
   a driver bug, not an app bug - the app draws the box correctly once the stage is up (verified by
   a probe that repeated the exact same actions on the same image and got `regions 1`, `boxes via
   api 1`).
   **Note for the goal owner:** `frontend/scripts/checkpoint3.mjs` has the same weak wait. It passed
   its run, but it is the same latent race.

### Open risk in step 3 that the goal owner should know about

The dry run was passed with `--min-proposals 0`. COCO yolo11m produced **no** proposals on the three
nadir frames it saw, which matches the checkpoint 3 note ("COCO weights rarely fire on nadir
frames"). Spec 13.5 step 3 expects proposals on at least one of ten images; that is the default
(`--min-proposals 1`) and the real run has 3299 frames and ten opened images to find one in, but if
it comes back zero that is a genuine acceptance finding about the COCO weights, not a driver
failure.

---

## Task 5 - README and final verification (`02359a9`)

`README.md` now covers: prerequisites and the pins, one-time setup, development against the mock
server / a real backend / the Tauri shell (including env mode), the build (freeze, smoke, bundle)
with the measured numbers and the installer limit, install and the per-user data layout, the whole
test matrix (backend with the `gpu` and `live` markers, contract, frontend unit and e2e, `cargo
test`, the checkpoint and acceptance drivers with how keys are handled), and troubleshooting
(sidecar log path, GPU not detected, ports, orphaned jobs, re-running the installer, the bundler
cache, offline training).

### Verification run on the branch head

| Suite | Command | Result |
|---|---|---|
| Backend | `.venv\Scripts\python -m pytest -q` | `401 passed, 9 deselected in 80.36s` |
| Backend GPU | `.venv\Scripts\python -m pytest -m gpu -q` | `4 passed, 406 deselected in 23.63s` |
| Lint | `.venv\Scripts\python -m ruff check .` | `All checks passed!` |
| Format | `ruff format --check` | the same 6 pre-existing files as on main (`app/inference/jobs.py`, `app/inference/service.py`, `app/providers/tiling.py`, `tests/test_providers_router.py`, `tests/test_query_runs.py`, `tests/test_tiling.py`); every file this branch touched is formatted |
| Contract | `pnpm --dir contract check` | spectral clean, client regenerated, no diff |
| Frontend lint | `pnpm lint` | eslint clean, `All matched files use Prettier code style!` |
| Frontend unit | `npx vitest run` | `68 files, 209 tests passed` |
| Frontend build | `pnpm build` | built in 1.6 s |
| Frontend e2e | `pnpm e2e` | `42 passed (25.5s)` |
| Rust | `cargo test --lib` | `4 passed`; `cargo fmt --check` clean |
| Frozen bundle | `backend\scripts\smoke_frozen.ps1` | `smoke ok` (output above) |
| Acceptance driver | `node frontend\scripts\acceptance.mjs` (dry run) | 7 passed, 1 skipped (output above) |

Backend tests went from 388 (main plus my first change) to 401: +6 health, +4 orphan sweep, +9 font,
minus the one health test that was already there.

---

## Files changed

```
README.md                             docs: build, install, tests, troubleshooting
backend/app/health.py                 GpuProbe + the gpu block on /health
backend/app/jobs/runner.py            JobRunner.is_live
backend/app/jobs/startup.py           new: sweep_orphans
backend/app/main.py                   wires the probe and the sweep
backend/app/projects/service.py       ProjectRegistry(on_open=...)
backend/app/training/fonts.py         new: YOLO_CONFIG_DIR + Arial pre-seed
backend/app/training/worker.py        calls configure_ultralytics() in the setup step
backend/machinery_backend.spec        full CUDA bundle
backend/scripts/build.ps1             size and duration report
backend/scripts/smoke_frozen.ps1      new: frozen smoke test
backend/tests/test_health.py          +5 cases
backend/tests/test_job_startup.py     new
backend/tests/test_ultralytics_env.py new
docs/progress.md                      S6 packaging evidence + log entry
frontend/scripts/acceptance.mjs       new: the acceptance driver
frontend/src-tauri/src/lib.rs         backend_info returns log_path
frontend/src-tauri/src/logfile.rs     new: RotatingLog
frontend/src-tauri/src/sidecar.rs     tees stdout/stderr to the log
frontend/src-tauri/tauri.conf.json    csp, nsis installMode
frontend/src/api/backend.ts           BackendInfo.logPath
frontend/src/api/backend.test.ts      +2 cases, fixed an escaped path
frontend/src/api/client.tsx           the dialog shows the log path
frontend/src/api/client.test.tsx      new
frontend/src/test/render.tsx          fixture keeps up with BackendInfo
scripts/acceptance.md                 new: the eight steps
```

`contract/` untouched.

## Self-review findings I fixed before reporting

- `smoke_frozen.ps1` assigned its response to `$source`, which is the same variable as the typed
  `[string] $Source` parameter (PowerShell is case-insensitive), so the response was coerced to a
  string. Renamed.
- `$PSScriptRoot` is not set while PowerShell 5.1 evaluates parameter defaults; `$Dist` now resolves
  in the body, with a comment.
- The smoke script's API helper now includes the response body in its error, which is what turned an
  opaque `(500) Internal Server Error` into the `torchvision::nms` finding.
- The sidecar log wrote a blank line between entries; fixed with a test.
- Test-only API on `GpuProbe` (an `add_done_callback` I had added for the tests) removed; the tests
  poll `snapshot()` instead.
- `eslint`/`prettier` on the frontend files this branch touched.

## Concerns and anything left undone

1. **Task 3 is blocked** as described. No installer artefact exists, so there is no installer size
   or bundler time to record; checkpoint 4 and the acceptance run on the installed app cannot start.
2. **The acceptance driver has only been dry-run**, on 20 frames in the dev shell in env mode. The
   real run needs the installed app; step 2 (3299 frames), step 5 (3 epochs at imgsz 1280) and step
   6 (50 rows ticked in a virtualised table) are all bigger than anything the dry run exercised. The
   50-row selection in particular is 4x what checkpoint 3 did.
3. **Step 3's proposal expectation** may legitimately come back zero with COCO weights on nadir
   frames (see above).
4. **`frontend/scripts/checkpoint3.mjs`** carries the same weak editor-readiness wait I fixed in the
   acceptance driver. I did not touch it (it is not S6's file and it passed its run), but it is a
   latent flake.
5. **`frontend/scripts/acceptance.mjs` is 523 lines.** It is linear and follows `checkpoint3.mjs`,
   but it is the biggest single file this branch adds.
6. **`gpu` probe fallback.** After 10 s without an answer health reports `{"available": false}` and
   corrects itself when the probe returns. On the reference machine the probe answers in 3.8 s, but
   a slow machine could briefly show "no GPU" in the UI. The alternative (leave the field absent
   forever) hides a genuinely stuck probe, so I kept the timeout the brief asked for.
7. **Vite watches `src-tauri/target`** in dev, so copying the sidecar into `target/debug/_internal`
   triggered a page reload (`[vite] page reload src-tauri/target/debug/_internal/...`). Harmless
   here, but the Tauri template usually sets `server.watch.ignored: ["**/src-tauri/**"]`. Not mine
   to change without a decision; flagging it.
8. `backend/.venv` in the worktree is a directory junction to the shared venv (the Wave 1 mechanic).
   Anyone deleting the worktree should delete the junction, not follow it.

---

# Task 3 (resumed): Inno Setup installer (`b96c6d9`)

Ruling received: build the installer with Inno Setup 6 wrapping the Tauri output (decision 13 on
main). Everything below is measured on the reference machine.

## What I implemented

- **Compiler, no system install.** `innosetup-compiler@6.3.1` is now a `frontend/` devDependency;
  it ships the whole Inno Setup 6.3.1 toolchain (`ISCC.exe`, `ISPP.dll`, `islzma*.exe`) inside
  `node_modules`. Verified before use: `ISCC.exe /?` prints
  "Inno Setup 6 Command-Line Compiler / Copyright (C) 1997-2024 Jordan Russell".
- **`frontend/installer/machinery-detection.iss`.** Per-user (`PrivilegesRequired=lowest`,
  `DefaultDirName={localappdata}\Programs\Machinery Detection`), `Compression=lzma2/max` with
  `SolidCompression=yes`, `ArchitecturesAllowed` / `ArchitecturesInstallIn64BitMode=x64compatible`,
  no license page, a `{autoprograms}` Start Menu shortcut, and an uninstaller with
  `[UninstallDelete] Type: filesandordirs; Name: "{app}"` so the install directory goes away while
  app data under `%APPDATA%` and the operator's project folders stay. Every source path is relative
  to the .iss folder (Inno's default `SourceDir`), so only `/DAppVersion` is passed in.
- **`frontend/scripts/build-installer.ps1`** plus `pnpm build:installer`. It checks
  `src-tauri/binaries/machinery-backend-x86_64-pc-windows-msvc.exe` and its `_internal` folder
  first and, when either is missing, fails with "run `backend\scripts\build.ps1` first; it freezes
  the backend with PyInstaller and copies the exe and its `_internal` folder into the sidecar
  slot." It reads the version from `src-tauri/tauri.conf.json`, runs `pnpm tauri build --no-bundle`
  (skippable with `-SkipTauriBuild`), compiles the .iss and reports the size and elapsed time.
- **`tauri.conf.json`**: `bundle.targets` is now `[]` and the dead `bundle.windows` block (NSIS
  install mode, WebView2 install mode) is gone. `bundle.active`, `icon`, `externalBin` and
  `resources` stay, because `pnpm tauri dev` uses them to stage the sidecar and `_internal`;
  verified by booting `pnpm tauri dev` after the change (sidecar spawned, uvicorn up).

## The sidecar name, and the layout check that found it

`sidecar("machinery-backend")` resolves to `<folder of the running exe>\machinery-backend.exe`
(tauri-plugin-shell 2.3.6, `src/process/mod.rs:120-143`), and the Tauri CLI stages exactly that
name next to the app exe in `target/debug` and `target/release`. The target triple is only part of
the source file name, so the installer renames on the way in
(`Source: "{#SidecarExe}"; DestDir: "{app}"; DestName: "machinery-backend.exe"`). I found this by
reading the plugin before compiling, then proved the layout without installing anything:

```
copy machinery-app.exe, machinery-backend.exe (renamed) and _internal into a temp folder
tree MB: 3468.9
$env:WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS = "--remote-debugging-port=9222"
Start-Process "<temp>\machinery-app.exe"
app pid=42976

   Id Name              Path
   -- ----              ----
42976 machinery-app     C:\...\scratchpad\installtree\machinery-app.exe
34596 machinery-backend C:\...\scratchpad\installtree\machinery-backend.exe

node check_install_layout.mjs
page url: http://tauri.localhost/
backend_info: {"base_url":"http://127.0.0.1:64445",
               "log_path":"C:\Users\D\AppData\Roaming\ai.synapse-solutions.machinery-app\logs\sidecar.log",
               "token":"Uwd0..."}
health: {"status":200,"body":{"status":"ok","version":"0.1.0","pid":34596,
         "started_at":"2026-09-18T09:40:38.619212+00:00",
         "gpu":{"available":true,"name":"NVIDIA GeForce RTX 5070 Ti"}}}

(Get-Process -Id 42976).CloseMainWindow()
CloseMainWindow returned True
both machinery-app and machinery-backend exited
```

The health `pid` is the sidecar process, the page is served from `http://tauri.localhost/` (which is
what the acceptance driver's URL match expects), and a graceful close took the sidecar with it.

## Installer build

```
pnpm build:installer
building the installer for version 0.1.0
WARNING: no MicrosoftEdgeWebview2Setup.exe found; the installer will not be able to install the
WebView2 runtime on a machine that lacks it (see the README troubleshooting section)
...
Successful compile (352.281 sec). Resulting Setup program filename is:
E:\...\frontend\src-tauri\target\release\bundle\inno\Machinery Detection_0.1.0_x64-setup.exe
installer: ... (1,797.3 MB) in 377 s
```

**Installer: 1,797.3 MB, 377 s end to end** (ISCC alone 352.3 s; the rest is
`pnpm tauri build --no-bundle`). Well inside the 6 GB success criterion, and 52% of the 3,468.9 MB
it installs. A second run with `-SkipTauriBuild` reproduced the same size in 345 s and confirmed the
script's exit code:

```
Successful compile (344.781 sec).
installer: ... (1,797.3 MB) in 345 s
direct script exit=0
```

I did **not** run the setup exe: install, cold start and warm start are the goal owner's
(checkpoint 4).

## WebView2 bootstrapper: not shipped, and why

Nothing on this machine has a copy. Tauri's `webviewInstallMode` was `downloadBootstrapper`, which
fetches the runtime at install time rather than embedding it, so the bundler cache
(`%LOCALAPPDATA%\tauri`, which holds `NSIS/` and `WixTools314/`) contains no
`MicrosoftEdgeWebview2Setup.exe`, and the redistributable must not be committed. The build script
looks in `frontend/installer/` and then through the Tauri cache, copies a file it finds, and
otherwise warns. The .iss compiles the `[Files]` and `[Run]` entries and the
`HKLM` / `HKLM\WOW6432Node` / `HKCU` `pv` check only when the file is there
(`#if HaveWebView2Setup`), so the installer produced here has no WebView2 step. The README
troubleshooting section says how to add one. The reference machine runs Windows 11, which ships the
runtime.

## Files changed in Task 3

```
.gitignore                                 ignore the uncommitted WebView2 bootstrapper
README.md                                  build section, install section, WebView2 troubleshooting
docs/progress.md                           S6 packaging evidence: the Inno row and the decision
frontend/installer/machinery-detection.iss new
frontend/package.json                      build:installer + the innosetup-compiler devDependency
frontend/pnpm-lock.yaml                    innosetup-compiler 6.3.1
frontend/scripts/build-installer.ps1       new
frontend/src-tauri/tauri.conf.json         bundle.targets [], dead windows block removed
scripts/acceptance.md                      the installer is the Inno one; installed path
```

---

# Fix round 1 (`6cdd435`)

Review: `.superpowers/sdd/wave3/s6-review.md`. Tasks 1, 2 and 5 approved; Task 4 rejected on C1 and
I1-I4. All Critical, Important and the assigned Minor findings are fixed below. M9 and M11 were
deferred by the goal owner and are untouched.

## C1 - the driver could not select 30 or 50 rows

`frontend/src/data/ImageTable.tsx` renders only the rows `computeWindow` returns, so
`getByLabel("Select <file>")` for a row past the viewport resolves to nothing. `selectRows` now uses
the table's own range selection - click the first row, shift-click the last - and `revealRow`
scrolls the virtualised container until each of those two rows is mounted. `selectRows` also waits
for the grid's `aria-rowcount` to reach the count first.

RED (the driver against the dev app with `--label-count 30`):

```
PASS 3. pre-annotation model proposes on at least one of the opened images ...
locator.waitFor: Timeout 30000ms exceeded.
  - waiting for getByRole('row').filter({ has: getByLabel('Select IX-12-02491_0031_0030.jpg') }) to be visible
    at selectRows (...\acceptance.mjs:282:14)
```

The first shape of the fix scrolled once, before the list had loaded its page; a scrollTop past
`scrollHeight` is clamped, so the window never moved. `revealRow` retries until the row is mounted.
GREEN: the dry run below selects 30 rows in step 4 and 50 in step 6.

## I1 - step 3 counted proposals before pre-annotation ran

`openAndPreannotate` reads the image's boxes first, and only waits for the `/preannotate` response
when the editor will actually make the call (the hook skips it when unreviewed proposals already
exist). Then it reads the boxes. Covered by the dry run's step 3, which now takes seconds per image
instead of returning immediately.

## I2 - step 7 destroyed an operator's stored key

The step now reads `GET /providers` first. A stored key is used as it is: never PUT, never DELETE.
Otherwise the key is PUT from `ANTHROPIC_API_KEY` and DELETEd in a `finally`. The skip only happens
when neither a stored key nor the variable is there, and the message is the one the md documents.

## I3 - step 7 did not assert provider provenance

`runBoxes` collects every box whose `provenance.query_run_id` is the run, and the step asserts that
at least `--min-cloud-boxes` (default 1) of them have `provenance.kind === "cloud_provider"` and
`provenance.provider === "anthropic"`, alongside the image count and `tiling.enabled`.

## I4 - md and driver disagreed on step 5

`openEventStream` subscribes to `/api/v1/events?token=...` before the training form is filled in and
collects every event; the step asserts at least one `job.progress` event per epoch for the training
job (3 at the acceptance defaults), and `scripts/acceptance.md` now says exactly that. The dry run
with `--epochs 1` reported `job.progress events 1`.

## Minors

| # | Change | Covered by |
|---|---|---|
| M1 | step 4 asserts `split_method === "by_group"` and that `data.yaml` names all eight classes | dry run step 4 |
| M2 | step 5 asserts `typeof metrics.map50 === "number"` and the same for `map50_95` | dry run step 5 |
| M3 | `acceptance.json` is written in a `finally`, with `failed_step` and the error | the failing run recorded `failed_step` for step 3 |
| M4 | md: step 6 evidence names `acceptance-06-review.png`, step 5's UI line rewritten, the skip message matches the driver's | `scripts/acceptance.md` |
| M5 | md defines what "review" means; the driver asserts `run.box_count >= --min-query-boxes` (default 1) and reports the review queue's data-row count | dry run step 6 |
| M6 | `api(..., { redact: true })` for the provider key PUT keeps the echoed request value out of the error | code |
| M7 | `monkeypatch.setenv("YOLO_CONFIG_DIR", "")` so the variable is restored | `tests/test_ultralytics_env.py` |
| M8 | the conftest `app` fixture installs a stub CUDA probe, like `MemoryKeyStore`; `test_probe_cuda_answers_for_real_on_this_machine` keeps one real call | `tests/conftest.py`, `tests/test_health.py` |
| M10 | the smoke script removes its work dir unless `-Keep` | smoke output below |
| M12 | `on_open` is wrapped in try/except with a log line | `test_a_failing_sweep_never_blocks_opening_a_project` |
| M13 | the spec comment cites the smoke script's redirected-stdout parse instead of the console line | `machinery_backend.spec` |
| M14 | README install instructions are the Inno Setup ones | Task 3 |

### M12 TDD evidence

RED (`python -m pytest tests/test_job_startup.py -q`):

```
    def boom(_handle):
>       raise RuntimeError("sweep exploded")
E       RuntimeError: sweep exploded
tests\test_job_startup.py:91: RuntimeError
1 failed, 4 passed in 1.79s
```

GREEN: `5 passed in 0.79s`.

### M7 / M8 evidence

`python -m pytest tests/test_health.py tests/test_ultralytics_env.py -q` gives `16 passed in 2.79s`
(seven health tests including the one real `probe_cuda` call, nine font tests). The full backend
suite went from 401 to 403 tests.

### M10 evidence

```
powershell -File backend\scripts\smoke_frozen.ps1
startup ok port 49966 pid 49828
health ok
cuda True NVIDIA GeForce RTX 5070 Ti
import ok 3 images
model ok yolo11n-coco 80 classes
predict ok 0 boxes
dataset ok train 2 val 1
worker ok mAP50 0.0
font ok C:\...\machinery-smoke-b3af390b\appdata\ultralytics\Arial.ttf
export ok C:\...\project\models\smoke-a10b54b4.onnx 10.1 MB
keyring ok (stored and removed a placeholder through Credential Manager)
bundle: 3,457.8 MB at ...\backend\dist\machinery-backend
timings (s): startup_line=0.67 health=0.59 cuda=1.89 create_project=0.1 import=1.1
             import_model=0.32 predict=1.74 dataset=0.62 worker_train=10.38 export_onnx=3.16
             keyring=0.06 total=20.64
smoke ok
work dir removed: C:\...\machinery-smoke-b3af390b (pass -Keep to inspect it)
```

## Dry run with the review's parameters

90 frames copied from `E:\Dev\Yolo\data\raw\ahmadia` (30 labelled plus 50 unlabelled needs more than
60; a first attempt on 60 frames stopped with "only 30 rows listed, need 50"), dev app in env mode.
Final run against exactly the committed driver, exit code 0:

```
node scripts\acceptance.mjs --project-folder ...\project5 --evidence ...\evidence5
  --project-id 03248822-2380-4af0-ad09-664d26fc7bd5 --source ...\frames90 --expect-images 90
  --expect-flights 0031 --preannotate-images 3 --min-proposals 0 --label-count 30 --epochs 1
  --imgsz 640 --batch 2 --query-images 50 --min-query-boxes 0 --cloud-images 2 --conf 0.01

PASS 1. resume on an existing project 03248822-2380-4af0-ad09-664d26fc7bd5
PASS 2. import the source folder images 90 duplicates 0 flights 0031
PASS 3. pre-annotation model proposes on at least one of the opened images yolo11m-coco (80 classes), 0 local_model proposals over 3 images (minimum 0)
PASS 4. label images and freeze dataset v1 by group labeled 30, train 24 val 6, split by_group
PASS 5. train for the requested epochs and register the model model ahmadia-v1 mAP50 0.0000 epoch card "" job.progress events resumed
PASS 6. run the trained model over unlabeled images, review and promote 50 images, 0 boxes (minimum 0), 0 review rows, promoted_at 2026-09-18T10:01:18.071386Z
SKIP 7. anthropic vision query (no ANTHROPIC_API_KEY)
PASS 8. export the trained model to ONNX models/ahmadia-v1-4efd17e6.onnx

acceptance: 7 steps passed, 1 skipped
  skipped: 7. anthropic vision query: ANTHROPIC_API_KEY is not set in the environment
```

The run before it did steps 1-8 from scratch on the same 90 frames (creating the project, labelling
30 images through the editor, training) and is where the 30-row and 50-row selections and the
websocket count were first exercised:

```
  retrying the box on image 11 (attempt 1 drew nothing)
PASS 4. label images and freeze dataset v1 by group labeled 30, train 24 val 6, split by_group
PASS 5. train for the requested epochs and register the model model ahmadia-v1 mAP50 0.0000 epoch card "1 / 1" job.progress events 1
PASS 6. run the trained model over unlabeled images, review and promote 50 images, 0 boxes (minimum 0), 1 review rows, promoted_at 2026-09-18T09:59:48.725182Z
PASS 8. export the trained model to ONNX models/ahmadia-v1-4efd17e6.onnx
```

Dry-run caveats, all parameter-driven and not driver defects: COCO yolo11m proposes nothing on
these three nadir frames (`--min-proposals 0`), and a 1-epoch model over 50 frames writes no boxes
(`--min-query-boxes 0`). The acceptance defaults are 1 and 1.

## Verification after the fix round

| Suite | Command | Result |
|---|---|---|
| Backend | `.venv\Scripts\python -m pytest -q` | `403 passed, 9 deselected in 83.28s` |
| Lint | `.venv\Scripts\python -m ruff check .` | `All checks passed!` |
| Format | `ruff format --check` | still only the 6 files that were already unformatted on main |
| Contract | `pnpm --dir contract check` | spectral clean, client regenerated, no diff |
| Frontend lint | `pnpm lint` | eslint clean, `All matched files use Prettier code style!` |
| Frontend unit | `npx vitest run` | `68 files, 209 tests passed` |
| Frontend build | `pnpm build` | built in 1.65 s |
| Frontend e2e | `pnpm e2e` | `42 passed (26.3s)` |
| Rust | `cargo test --lib` | `4 passed` |
| Frozen bundle | `backend\scripts\smoke_frozen.ps1` | `smoke ok` |
| Installer | `pnpm build:installer` | 1,797.3 MB in 377 s |

## Still open after this round

1. The acceptance run itself needs the installed app, which is the goal owner's step. The dry run
   covers 90 frames, 30 labels, 50 query images and 1 epoch; the real one is 3299 frames, 3 epochs
   at imgsz 1280 and the Anthropic step.
2. Step 7 has never executed - there is no key on this machine and none in the environment - so the
   provenance assertion (I3) and the "use a stored key, do not touch it" path (I2) are code-reviewed
   but not exercised.
3. Spec 13.5 step 3 may still legitimately return zero COCO proposals on nadir frames; the default
   `--min-proposals 1` will then fail the step, which is an acceptance finding about the weights
   rather than a driver defect.
4. `frontend/scripts/checkpoint3.mjs` still has the editor-readiness race and the virtualised-table
   selection pattern this round fixed in the acceptance driver. Out of S6's scope, flagged again.

---

# Fix round 2 (`9f3aa01`)

Review: `.superpowers/sdd/wave3/s6-review-r1.md`. The installer commit was approved on spec
compliance and every round-1 finding was accepted (M3 and M14 partially). Two Important findings
remained, A1 and N1, plus minors. A2 and A5 were deferred by the goal owner; A2's documentation half
is done.

## A1 - the README named the wrong installed sidecar

`README.md` said the install dir holds `machinery-backend-x86_64-pc-windows-msvc.exe`. The installer
writes `machinery-backend.exe`: the triple is only how the file is named in the build slot
(`frontend/src-tauri/binaries/`), and the shell plugin resolves a sidecar as
`<folder of the running exe>\<name>.exe`. Someone comparing the install dir against the README would
have found a "missing" file, or renamed the working one back to the triple form and broken the app.

The README install section now lists the three things the installer writes (`machinery-app.exe`,
`machinery-backend.exe`, `_internal/`), says why the names matter and that the installer renames on
the way in, and `scripts/acceptance.md` step 1 says the same for the operator who installs before
the acceptance run. That completes M14.

The deferred half of A2 is a line in the README build section: the installer packs the freeze from
`frontend/src-tauri/binaries/` and only checks that it is there, so step 1 has to be re-run whenever
the backend changed or the installer ships the previous freeze.

## N1 - the row range could be taken from an unfiltered list

Opening the Data Manager remounts it at `labeled: all` and it fetches a page before the driver
applies the filter. The old gate was `aria-rowcount >= count`, which the unfiltered list satisfies
too, and `clickSelect` resolves a shift-range from the ids the table currently holds - so the run
could be over the wrong images while `N selected` still read 50 (and that check was a substring
match, so "150 selected" would have satisfied it).

`selectRows(items, count, total)` now:

1. waits for the filter bar to read `of <total> images`, where `total` comes from the same filtered
   API query - that is the server count for the filter, so it only appears once the filter took;
2. waits for `aria-rowcount >= count`, which is what the table currently holds (the real run's
   unlabelled list is 3269 images arriving 200 at a time, so equality with the total is not a
   condition that can be waited on);
3. scrolls to the top and confirms the first rendered row is `items[0]`, which pins the offset the
   range depends on;
4. clicks first and shift-clicks last, then matches the selection count with `exact: true`.

Both callers then close the loop through the API rather than trusting the count:

- step 4 lists the dataset folder (flat, `<site>__<file name>`) and asserts the frozen images are
  exactly the 30 labelled ones;
- step 6 asserts `run.image_ids` is exactly the set of unlabelled ids the driver picked.

The dry run reports both: `frozen images match the 30 labeled ones: true` and
`50 images (the intended unlabelled ones: true)`.

## Minors

| # | Change | Evidence |
|---|---|---|
| A3 | `DisableDirPage=yes` + `UsePreviousAppDir=yes`, because uninstall removes `{app}` whole | `machinery-detection.iss` |
| A4 | `ArchitecturesAllowed` / `ArchitecturesInstallIn64BitMode` are `x64os`: ARM64 emulation cannot run the CUDA sidecar | `machinery-detection.iss` |
| A6 | the summary line says whether a bootstrapper went in | `installer: ... (1,797.3 MB, without a WebView2 bootstrapper) in 387 s` |
| A7 | the version is validated before ISCC sees it | `build-installer.ps1` throws "the version in src-tauri\tauri.conf.json is ...; the installer needs a numeric version such as 0.1.0" |
| A8 | only a generated work dir is deleted; a `-WorkDir` the caller named is kept, and the message reports what happened | `smoke_frozen.ps1` (`$generatedWorkDir`, plus a "work dir could not be removed" branch) |
| N2 | the click happens inside the retry loop; the table can scroll back to the focused row between the check and the click | `clickRow` in `acceptance.mjs` |
| N3 | `current` is set at the top of each step, so `failed_step` names the step that was running | `begin()`; the log line is now "failed in:" |
| N4 | `preannotation_model_id` is polled and asserted before the editor loop | a click that did not take now fails at once with a message naming the button, instead of a 300 s `waitForResponse` timeout |
| N5 | the epoch card is asserted, not swallowed: it must equal `<epochs> / <epochs>` alongside the websocket count | dry run step 5: `epoch card "1 / 1" job.progress events 1` |
| N6 | the review queue size is `aria-rowcount`, not the mounted rows | dry run step 6: `0 rows in the review queue` - a 1-epoch model wrote no boxes, so the queue really is empty; the previous two runs printed 0 and 1 for the same situation |

## Installer rebuild

```
pnpm build:installer
building the installer for version 0.1.0
WARNING: no MicrosoftEdgeWebview2Setup.exe found; the installer will not be able to install the
WebView2 runtime on a machine that lacks it (see the README troubleshooting section)
...
Successful compile (361.781 sec).
installer: E:\...\bundle\inno\Machinery Detection_0.1.0_x64-setup.exe (1,797.3 MB, without a WebView2 bootstrapper) in 387 s
```

Same size as round 1 - the flag changes do not touch the payload. `docs/progress.md` carries the new
numbers (387 s, ISCC 361.8 s, and the bootstrapper note).

## Dry run, fresh project, 90 frames, 30 labelled / 50 query

```
node scripts\acceptance.mjs --project-folder ...\project6 --evidence ...\evidence6
  --project-name "Ahmadia dry run" --source ...\frames90 --expect-images 90 --expect-flights 0031
  --preannotate-images 3 --min-proposals 0 --label-count 30 --epochs 1 --imgsz 640 --batch 2
  --query-images 50 --min-query-boxes 0 --cloud-images 2 --conf 0.01

PASS 1. create project with the eight classes 564354b9-4b56-483f-aec8-3b231b1be579 classes excavator,wheel_loader,bulldozer,dump_truck,crane,concrete_mixer,roller,backhoe
PASS 2. import the source folder images 90 duplicates 0 flights 0031
PASS 3. pre-annotation model proposes on at least one of the opened images yolo11m-coco (80 classes), 0 local_model proposals over 3 images (minimum 0)
PASS 4. label images and freeze dataset v1 by group labeled 30, train 24 val 6, split by_group, frozen images match the 30 labeled ones: true
PASS 5. train for the requested epochs and register the model model ahmadia-v1 mAP50 0.0000 epoch card "1 / 1" job.progress events 1
PASS 6. run the trained model over unlabeled images, review and promote 50 images (the intended unlabelled ones: true), 0 boxes (minimum 0), 0 rows in the review queue, promoted_at 2026-09-18T10:36:14.843494Z
SKIP 7. anthropic vision query (no ANTHROPIC_API_KEY)
PASS 8. export the trained model to ONNX models/ahmadia-v1-ab26719a.onnx

acceptance: 7 steps passed, 1 skipped
  skipped: 7. anthropic vision query: ANTHROPIC_API_KEY is not set in the environment
```

Exit code 0. This was a fresh project, so every step ran for real: 30 images labelled through the
editor (two of them needed the drag retry), a training run with the websocket subscription open, and
a 50-image query run.

## Verification after round 2

| Suite | Command | Result |
|---|---|---|
| Backend | `.venv\Scripts\python -m pytest -q` | `403 passed, 9 deselected in 85.26s` |
| Lint | `.venv\Scripts\python -m ruff check .` | `All checks passed!` |
| Format | `ruff format --check` | still only the 6 files already unformatted on main |
| Contract | `pnpm --dir contract check` | spectral clean, client regenerated, no diff |
| Frontend lint | `pnpm lint` | eslint clean, `All matched files use Prettier code style!` |
| Frontend unit | `npx vitest run` | `68 files, 209 tests passed` |
| Frontend build | `pnpm build` | built in 1.64 s |
| Frontend e2e | `pnpm e2e` | `42 passed (25.4s)` |
| Rust | `cargo test --lib`, `cargo fmt --check` | `4 passed`, fmt clean |
| PowerShell | `Parser::ParseFile` on both scripts | both parse |
| Installer | `pnpm build:installer` | 1,797.3 MB in 387 s |

## Still open after round 2

1. The acceptance run on the installed app is the goal owner's (install, cold start, checkpoint 4).
2. Step 7 has still never executed: no key on this machine and none in the environment, so I2's
   "use a stored key and leave it alone" path and I3's provenance assertion remain code-reviewed
   rather than exercised.
3. Spec 13.5 step 3 may legitimately return zero COCO proposals on nadir frames; the default
   `--min-proposals 1` would then fail the step as an acceptance finding about the weights.
4. `frontend/scripts/checkpoint3.mjs` still carries the editor-readiness race and the
   virtualised-table selection pattern that rounds 1 and 2 fixed in the acceptance driver.
